/*
 * miniapp/js/app.js — точка входу: стан, події, зв'язок з Telegram.
 * Логіка: будь-яка зміна → оновити state → recalc() → перемалювати екран.
 */
(function () {
  'use strict';

  var $ = UI.$;
  var tg = window.Telegram && window.Telegram.WebApp;
  // Поза Telegram (звичайний браузер) SDK теж є, але platform === 'unknown'
  var inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');

  var catalog = null;
  var state = defaultState();
  var service = { labor_pct: null, markup_pct: null, hidePrices: false }; // null = значення з «Налаштувань»
  var lastEst = null;
  var saveTimer = null;
  var serviceOpenedAt = 0; // час відкриття службової панелі

  var NUM_FIELDS = ['L', 'W', 'D', 'Lb', 'Wb', 'distance', 'lift'];
  var PICKS = ['filterId', 'pumpId', 'uvId'];

  // Порожній кошторис. manual: null = автопідбір (рекомендоване)
  function defaultState() {
    return {
      inputs: { shape: 'rect', L: '', W: '', D: '', fish: false, bio: false, Lb: '', Wb: '', filmId: '', distance: '', lift: '' },
      manual: { filterId: null, pumpId: null, uvId: null, skimmers: null, drains: null },
      decor: { waterfallId: 'none', lightId: 'none', lights: 0, extras: {} },
      client: { name: '', phone: '', address: '' },
      comment: ''
    };
  }

  function tgVersion(v) { return inTelegram && tg.isVersionAtLeast && tg.isVersionAtLeast(v); }

  // ---------- Telegram ----------
  function setupTelegram() {
    if (!inTelegram) return;
    tg.ready();   // повідомляємо Telegram, що застосунок готовий
    tg.expand();  // розгортаємо на весь екран
    applyTheme();
    tg.onEvent('themeChanged', applyTheme);
    if (tgVersion('6.2')) tg.enableClosingConfirmation(); // випадковий свайп не закриє незбережене
    if (tgVersion('7.7')) tg.disableVerticalSwipes();      // прокрутка не згортає застосунок
    // Службова панель у меню «⋮ → Налаштування» — прихована від клієнта (D15)
    if (tgVersion('7.0') && tg.SettingsButton) {
      tg.SettingsButton.show();
      tg.SettingsButton.onClick(openService);
    }
  }

  function applyTheme() {
    var dark = tg.colorScheme === 'dark';
    document.documentElement.classList.toggle('tg-dark', dark);
    document.documentElement.classList.toggle('tg-light', !dark);
  }

  function haptic(kind) {
    if (!tgVersion('6.1') || !tg.HapticFeedback) return;
    if (kind === 'select') tg.HapticFeedback.selectionChanged();
    else tg.HapticFeedback.notificationOccurred(kind);
  }

  function alertMsg(text) {
    if (tgVersion('6.2')) tg.showAlert(text); else window.alert(text);
  }

  function confirmMsg(text, cb) {
    if (tgVersion('6.2')) tg.showConfirm(text, cb); else cb(window.confirm(text));
  }

  // ---------- Чернетка ----------
  // Зберігаємо із затримкою 300 мс, щоб не писати в пам'ять на кожну літеру
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(CONFIG.DRAFT_KEY, JSON.stringify({ v: 1, state: state, service: service }));
      } catch (e) { /* пам'ять недоступна — працюємо без чернетки */ }
    }, 300);
  }

  function restoreDraft() {
    try {
      var raw = localStorage.getItem(CONFIG.DRAFT_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1 || !d.state) return;
      var def = defaultState();
      Object.keys(def).forEach(function (k) {
        if (typeof def[k] === 'object') def[k] = Object.assign({}, def[k], d.state[k] || {});
        else if (d.state[k] !== undefined) def[k] = d.state[k];
      });
      state = def;
      service = Object.assign(service, d.service || {});
    } catch (e) { /* пошкоджена чернетка — починаємо з чистого */ }
  }

  // Прайс міг змінитися: id, яких більше немає, повертаємо до авто
  function validateIds() {
    function exists(id) { return !!Calc.findItem(catalog, id); }
    var films = Calc.activeItems(catalog, 'film');
    if (!exists(state.inputs.filmId)) state.inputs.filmId = films.length ? films[0].id : '';
    PICKS.forEach(function (k) {
      var v = state.manual[k];
      if (v !== null && v !== 'none' && v !== 'kit' && !exists(v)) state.manual[k] = null;
    });
    if (state.decor.waterfallId !== 'none' && !exists(state.decor.waterfallId)) state.decor.waterfallId = 'none';
    if (state.decor.lightId !== 'none' && !exists(state.decor.lightId)) state.decor.lightId = 'none';
    Object.keys(state.decor.extras).forEach(function (id) { if (!exists(id)) delete state.decor.extras[id]; });
  }

  // ---------- Побудова форми з прайсу ----------
  function buildForm() {
    var act = function (cat) { return Calc.activeItems(catalog, cat); };
    UI.fillSelect($('filmId'), act('film'));
    UI.fillSelect($('filterId'), act('filter'), [{ value: 'none', label: 'Без фільтра' }]);
    UI.fillSelect($('pumpId'), act('pump'), [{ value: 'kit', label: 'У комплекті з фільтром' }, { value: 'none', label: 'Без насоса' }]);
    UI.fillSelect($('uvId'), act('uv'), [{ value: 'none', label: 'Без УФ' }]);
    UI.fillSelect($('waterfallId'), act('waterfall'), [{ value: 'none', label: 'Без водоспаду' }]);
    UI.fillSelect($('lightId'), act('light'), [{ value: 'none', label: 'Без підсвітки' }]);
    var s = catalog.settings;
    $('lift').placeholder = Format.qty(Calc.num(s.lift_height_default_m)) + ' (типово)';
  }

  // Переносить стан у поля форми (після відновлення чернетки або скидання)
  function syncForm() {
    var inp = state.inputs;
    NUM_FIELDS.forEach(function (id) { $(id).value = inp[id]; });
    $('filmId').value = inp.filmId;
    $('bio').checked = !!inp.bio;
    $('bioFields').hidden = !inp.bio;
    document.querySelectorAll('[data-shape]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.shape === inp.shape));
    });
    document.querySelectorAll('[data-fish]').forEach(function (b) {
      b.setAttribute('aria-pressed', String((b.dataset.fish === '1') === !!inp.fish));
    });
    $('waterfallId').value = state.decor.waterfallId;
    $('lightId').value = state.decor.lightId;
    UI.renderExtras($('extras'), Calc.activeItems(catalog, 'extra'), state.decor.extras);
    $('clientName').value = state.client.name;
    $('clientPhone').value = state.client.phone;
    $('clientAddress').value = state.client.address;
    $('comment').value = state.comment;
    $('hidePrices').checked = !!service.hidePrices;
  }

  // ---------- Розрахунок і відображення ----------
  function effectiveService() {
    var s = catalog.settings;
    return {
      labor_pct: service.labor_pct !== null ? service.labor_pct : Calc.num(s.labor_pct, 100),
      markup_pct: service.markup_pct !== null ? service.markup_pct : Calc.num(s.markup_pct, 0)
    };
  }

  function moneyUI(x) {
    return service.hidePrices ? '•••' : Format.money(x, catalog.settings.currency);
  }

  function pickNote(key) {
    return document.querySelector('.pick[data-key="' + key + '"] .pick__note');
  }

  // Оновлює список обладнання: значення, зірочку, «рекомендовано / вручну»
  function updatePick(key, value, recValue, warn, extra) {
    var select = $(key);
    select.value = value;
    UI.markSelect(select, recValue);
    var manual = state.manual[key] !== null && value !== recValue;
    UI.setNote(pickNote(key), { key: key, warn: warn, auto: !manual, manual: manual, extra: extra });
  }

  function updateCounter(key, value, recValue) {
    $(key).value = value;
    $(key).textContent = value;
    var manual = state.manual[key] !== null && value !== recValue;
    document.querySelector('.pick[data-key="' + key + '"] .counter').classList.toggle('is-auto', !manual);
    UI.setNote(pickNote(key), manual
      ? { key: key, manual: true }
      : { key: key, auto: true, recSuffix: ': ' + recValue });
  }

  function recalc() {
    var inp = state.inputs;
    var man = state.manual;
    var valid = Calc.isValidInputs(inp);
    var rec = Calc.recommend(inp, catalog, man.filterId);
    var m = rec.metrics;

    UI.drawSketch($('sketch'), inp.shape, m);

    // Остаточний вибір: ручний має пріоритет над рекомендованим
    var sel = {
      filmId: inp.filmId,
      filterId: man.filterId !== null ? man.filterId : rec.filterId,
      pumpId: man.pumpId !== null ? man.pumpId : rec.pump.id,
      uvId: man.uvId !== null ? man.uvId : rec.uvId,
      skimmerId: rec.skimmerId,
      skimmers: man.skimmers !== null ? man.skimmers : rec.skimmers,
      drainId: rec.drainId,
      drains: man.drains !== null ? man.drains : rec.drains,
      waterfallId: state.decor.waterfallId,
      lightId: state.decor.lightId,
      lights: state.decor.lights,
      extras: state.decor.extras
    };

    // Підпис варіанта «у комплекті»: показуємо, який саме насос іде з фільтром
    var kitOpt = $('pumpId').querySelector('option[value="kit"]');
    var chosenFilter = Calc.findItem(catalog, sel.filterId);
    var kitPump = chosenFilter && chosenFilter.pump_kit ? Calc.findItem(catalog, chosenFilter.pump_kit) : null;
    kitOpt.dataset.label = kitPump ? 'У комплекті: ' + kitPump.name : 'У комплекті (у фільтра немає насоса)';
    kitOpt.disabled = !kitPump;

    $('lights').value = state.decor.lights;
    $('lights').textContent = state.decor.lights;

    if (!valid) {
      // Без розмірів рекомендації не мають сенсу — показуємо лише вибране
      PICKS.forEach(function (k) { $(k).value = sel[k]; UI.markSelect($(k), null); pickNote(k).innerHTML = ''; });
      ['skimmers', 'drains'].forEach(function (k) { $(k).textContent = sel[k]; pickNote(k).innerHTML = ''; });
      $('stats').hidden = true;
      $('needInfo').textContent = 'Потрібний потік і напір з\'являться після введення розмірів.';
      $('emptyHint').hidden = false;
      $('lines').innerHTML = '';
      $('totals').innerHTML = '';
      UI.renderWarnings($('warnings'), []);
      $('totalValue').textContent = '—';
      lastEst = null;
      return;
    }

    // Обладнання
    updatePick('filterId', sel.filterId, rec.filterId,
      rec.filterId === 'none' ? 'Жоден фільтр із прайсу не розрахований на такий об\'єм' : '');
    var pumpExtra = rec.pump.note ? rec.pump.note.toLowerCase() : '';
    updatePick('pumpId', sel.pumpId, rec.pump.id,
      rec.pump.id === 'none' ? rec.pump.note : '', pumpExtra);
    updatePick('uvId', sel.uvId, rec.uvId, '');
    updateCounter('skimmers', Calc.count(sel.skimmers), rec.skimmers);
    updateCounter('drains', Calc.count(sel.drains), rec.drains);

    $('needInfo').innerHTML = '';
    $('needInfo').appendChild(document.createTextNode('Потрібно: потік '));
    $('needInfo').appendChild(UI.el('strong', null, Format.number(m.Qreq, 0) + ' л/год'));
    $('needInfo').appendChild(document.createTextNode(' при напорі '));
    $('needInfo').appendChild(UI.el('strong', null, Format.number(m.Hreq, 1) + ' м'));

    UI.renderStats($('stats'), m);
    $('stats').hidden = false;

    // Кошторис
    var est = Calc.buildEstimate(inp, sel, catalog, effectiveService());
    lastEst = est;
    $('emptyHint').hidden = true;
    UI.renderWarnings($('warnings'), est.warnings);
    UI.renderLines($('lines'), est, moneyUI);
    UI.renderTotals($('totals'), est.totals, moneyUI);
    $('totalValue').textContent = moneyUI(est.totals.total);
    // Нагадування, щоб режим «приховати ціни» не забувся увімкненим
    $('totalLabel').textContent = service.hidePrices ? 'Разом (ціни приховано)' : 'Разом';
    updateServicePanel();
  }

  // Будь-яка зміна: зберегти чернетку і перерахувати
  function changed() {
    saveDraft();
    recalc();
  }

  // ---------- Службова панель ----------
  function openService() {
    updateServicePanel();
    serviceOpenedAt = Date.now();
    $('service').hidden = false;
    haptic('select');
  }

  function closeService() { $('service').hidden = true; }

  function updateServicePanel() {
    var eff = effectiveService();
    $('laborPct').textContent = eff.labor_pct;
    $('markupPct').textContent = eff.markup_pct;
    var withEq = catalog.settings.labor_base === 'materials+equipment';
    $('laborLabel').textContent = 'Роботи, % від ' + (withEq ? 'матеріалів і обладнання' : 'матеріалів');
  }

  // Довге натискання на заголовок — запасний спосіб відкрити панель (поза Telegram або старі версії)
  function bindLongPress(target, cb) {
    var timer = null;
    function start() { timer = setTimeout(cb, 700); }
    function stop() { clearTimeout(timer); }
    target.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { target.addEventListener(ev, stop); });
  }

  // ---------- Дії ----------
  function estimateText() {
    return Format.estimateText(lastEst, state.inputs, {
      client: state.client, comment: state.comment,
      currency: catalog.settings.currency, isTest: !!catalog.is_test, date: new Date()
    });
  }

  // Копіювання: сучасний спосіб, а якщо WebView не дозволяє — старий через прихований textarea
  function copyText(text) {
    function legacy() {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('copy'));
      });
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(legacy);
    }
    return legacy();
  }

  function onCopy() {
    if (!lastEst) { alertMsg('Спершу введіть довжину, ширину й глибину ставка.'); return; }
    var btn = $('btnCopy');
    copyText(estimateText()).then(function () {
      haptic('success');
      btn.textContent = 'Скопійовано';
      setTimeout(function () { btn.textContent = 'Копіювати кошторис'; }, 1600);
    }).catch(function () {
      alertMsg('Не вдалося скопіювати. Скористайтеся кнопкою «Надіслати в Telegram».');
    });
  }

  // Відкриває вибір чату Telegram з готовим текстом кошторису
  function onShare() {
    if (!lastEst) { alertMsg('Спершу введіть довжину, ширину й глибину ставка.'); return; }
    var link = 'https://t.me/share/url?url=' + encodeURIComponent(CONFIG.SHARE_URL) +
      '&text=' + encodeURIComponent(estimateText());
    if (inTelegram) tg.openTelegramLink(link); else window.open(link, '_blank');
  }

  function onReset() {
    confirmMsg('Почати новий кошторис? Введені дані буде очищено.', function (ok) {
      if (!ok) return;
      state = defaultState();
      service.labor_pct = null;
      service.markup_pct = null;
      validateIds();
      syncForm();
      changed();
      window.scrollTo(0, 0);
    });
  }

  // ---------- Події ----------
  function bindEvents() {
    // Числові поля ставка
    NUM_FIELDS.forEach(function (id) {
      $(id).addEventListener('input', function (e) { state.inputs[id] = e.target.value; changed(); });
    });
    $('filmId').addEventListener('change', function (e) { state.inputs.filmId = e.target.value; changed(); });

    // Форма і риба
    document.querySelectorAll('[data-shape]').forEach(function (b) {
      b.addEventListener('click', function () { state.inputs.shape = b.dataset.shape; haptic('select'); syncForm(); changed(); });
    });
    document.querySelectorAll('[data-fish]').forEach(function (b) {
      b.addEventListener('click', function () { state.inputs.fish = b.dataset.fish === '1'; haptic('select'); syncForm(); changed(); });
    });
    $('bio').addEventListener('change', function (e) {
      state.inputs.bio = e.target.checked;
      $('bioFields').hidden = !e.target.checked;
      changed();
    });

    // Обладнання: ручний вибір вимикає автопідбір для цього поля
    PICKS.forEach(function (k) {
      $(k).addEventListener('change', function (e) { state.manual[k] = e.target.value; changed(); });
    });

    // Кнопки «−/+» для скіммерів, донних і світильників
    document.querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.step, d = Number(b.dataset.d);
        var current = Calc.count($(key).textContent);
        var next = Math.max(0, Math.min(50, current + d));
        if (key === 'lights') state.decor.lights = next;
        else state.manual[key] = next;
        haptic('select');
        changed();
      });
    });

    // Повернення рекомендованого (кнопки створюються динамічно — ловимо кліки на документі)
    document.addEventListener('click', function (e) {
      var key = e.target && e.target.dataset ? e.target.dataset.reset : null;
      if (!key) return;
      state.manual[key] = null;
      haptic('select');
      changed();
    });

    // Декор
    $('waterfallId').addEventListener('change', function (e) { state.decor.waterfallId = e.target.value; changed(); });
    $('lightId').addEventListener('change', function (e) {
      state.decor.lightId = e.target.value;
      if (e.target.value === 'none') state.decor.lights = 0;
      else if (state.decor.lights === 0) state.decor.lights = 1; // вибрали модель — одразу 1 шт
      changed();
    });
    $('extras').addEventListener('change', function (e) {
      var id = e.target.dataset.extra;
      if (!id) return;
      if (e.target.checked) state.decor.extras[id] = 1; else delete state.decor.extras[id];
      changed();
    });

    // Клієнт і коментар (на розрахунок не впливають — лише зберігаємо)
    [['clientName', 'name'], ['clientPhone', 'phone'], ['clientAddress', 'address']].forEach(function (p) {
      $(p[0]).addEventListener('input', function (e) { state.client[p[1]] = e.target.value; saveDraft(); });
    });
    $('comment').addEventListener('input', function (e) { state.comment = e.target.value; saveDraft(); });

    // Службова панель
    bindLongPress($('appTitle'), openService);
    document.querySelectorAll('[data-svc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.svc, d = Number(b.dataset.d);
        var eff = effectiveService();
        var limits = key === 'labor_pct' ? [0, 300] : [-50, 100];
        service[key] = Math.max(limits[0], Math.min(limits[1], eff[key] + d));
        haptic('select');
        changed();
        updateServicePanel();
      });
    });
    $('hidePrices').addEventListener('change', function (e) { service.hidePrices = e.target.checked; changed(); });
    $('serviceDone').addEventListener('click', closeService);
    // Клік по затемненню закриває панель, але не в перші 500 мс (палець щойно відпустили після довгого натискання)
    $('service').addEventListener('click', function (e) {
      if (e.target === $('service') && Date.now() - serviceOpenedAt > 500) closeService();
    });

    // Дії
    $('btnCopy').addEventListener('click', onCopy);
    $('btnShare').addEventListener('click', onShare);
    $('btnReset').addEventListener('click', onReset);
  }

  function showError(text) {
    var box = $('loadError');
    box.textContent = text;
    box.hidden = false;
  }

  // ---------- Запуск ----------
  function init() {
    setupTelegram();
    Api.loadCatalog().then(function (cat) {
      catalog = cat;
      buildForm();
      restoreDraft();
      validateIds();
      syncForm();
      bindEvents();
      $('testBanner').hidden = !cat.is_test;
      $('footer').textContent = 'Версія ' + CONFIG.APP_VERSION + '. Каталог ' + cat.version + '.';
      $('app').hidden = false;
      $('totalBar').hidden = false;
      recalc();
    }).catch(function (err) {
      showError('Не вдалося завантажити прайс: ' + err.message + '. Перевірте інтернет і відкрийте застосунок ще раз.');
    });
  }

  init();
})();
