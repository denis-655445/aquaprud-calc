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
  // null = значення з «Налаштувань»; fontScale — розмір тексту (1 / 1.15 / 1.3), не скидається «Новим кошторисом»
  // scene — вид схеми: '2d' / '3d' і номер ракурсу 0–3 (теж не скидається)
  // pro — Про-режим зі сходинками (D46): вмикається в службовій панелі й не скидається «Новим кошторисом»
  // bioJoin — біоплато на схемі «Разом» (впритул, одне дзеркало, D56): лише вигляд, теж не скидається
  // slope_deg — укіс стінок у градусах (D61; v0.7.1 замість 1 : m): 90 — вертикальні, 30…90; задається в службовій
  // панелі один раз і діє в усіх кошторисах (не скидається); m = 1 / tg α рахується для ядра (calcInputs)
  // theme — тема інтерфейсу: 'dark' (за замовчуванням) / 'light' / 'system' (кольори Telegram або телефона), не скидається
  // scene.plan — вид 2D: 0 — план, 1 — розріз А–А, 2 — розріз Б–Б (v0.7.0)
  var service = { labor_pct: null, markup_pct: null, hidePrices: false, fontScale: 1, scene: { mode: '2d', view: 0, plan: 0 }, pro: false, bioJoin: false,
                  slope_deg: 90, theme: 'dark' };
  var SLOPE_MIN = 30, SLOPE_MAX = 90;   // межі кута укосу, ° (відповідь майстра v0.7.1: крок 1°, мінімум 30°)
  var BIO_MAX = 4;                      // до 4 ділянок біоплато — по одній на сторону
  var FONT_SCALES = [1, 1.15, 1.3];
  var lastEst = null;
  var lastMetrics = null;  // метрики останнього розрахунку — для перемальовування схеми під час повороту
  // 3D: 4 ракурси по діагоналі; › повертає глядача за годинниковою стрілкою (+90°)
  var VIEW_AZ = [135, 225, 315, 45];
  var PLAN_H_K = 0.6;      // 2D у портреті: висота блока ≤ 0,6 ширини (D60) — між v0.6.1 (замала) і v0.6.2 (завелика)
  var sceneAz = null;      // поточний кут глядача (під час анімації — проміжний)
  var animId = 0;
  var saveTimer = null;
  var serviceOpenedAt = 0; // час відкриття службової панелі

  var NUM_FIELDS = ['L', 'W', 'D', 'distance', 'lift'];
  var PICKS = ['filterId', 'pumpId', 'uvId'];

  // Порожній кошторис. manual: null = автопідбір (рекомендоване)
  function defaultState() {
    return {
      // steps — сходинки (Про-режим): рівнів = steps.length + 1 (дно), D38
      // Біоплато (v0.7.1): bios — [{ side, w }] за номерами Bio-1…Bio-4; активні — перші bioCount, решта — кеш
      // прибраних «−» (повертаються «+» з тією самою шириною і стороною); side — right / bottom / left / top
      inputs: { shape: 'rect', L: '', W: '', D: '', fish: false, bio: false, bios: [], bioCount: 0, filmId: '', distance: '', lift: '', steps: [] },
      stepActive: 0,     // яку сходинку редагуємо (її точки — на 2D-схемі)
      stepsStash: [],    // прибрані «−» сходинки за номером: «+» повертає їх з точками й розмірами
      manual: { filterId: null, pumpId: null, uvId: null, skimmers: null, drains: null },
      decor: { waterfallId: 'none', lightId: 'none', lights: 0, extras: {} },
      client: { name: '', phone: '', phoneCountry: 'UA', address: '' },
      clientComment: '', // для клієнта — потрапляє в текст кошторису
      comment: '',       // для себе — клієнт не бачить (піде в CRM на етапі A4)
      notes: { clientComment: false, comment: false } // чи розгорнуто поле коментаря
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
    // 6. Підтвердження закриття («Внесённые изменения могут быть потеряны») вимкнено:
    // усе введене й так зберігається в чернетці (localStorage) і повертається при наступному відкритті
    if (tgVersion('7.7')) tg.disableVerticalSwipes();      // прокрутка не згортає застосунок
    // Пункт «Налаштування» в меню «⋮». На iOS Telegram його поки не показує — основний спосіб
    // відкрити службову панель — довге натискання на заголовок (D15)
    if (tgVersion('7.0') && tg.SettingsButton) {
      tg.SettingsButton.show();
      tg.SettingsButton.onClick(openService);
    }
  }

  // Тема (v0.7.1): data-theme на <html> — CSS бере власні кольори («Темна» / «Світла») або кольори Telegram («Система»).
  // Шапку й тло Telegram фарбуємо в колір застосунку, щоб не було смуги іншого кольору
  var THEME_COLORS = { dark: { bg: '#0f1418', header: '#0f1418' }, light: { bg: '#eef1f4', header: '#eef1f4' } };
  function applyTheme() {
    var t = ['dark', 'light', 'system'].indexOf(service.theme) === -1 ? 'dark' : service.theme;
    document.documentElement.setAttribute('data-theme', t);
    if (!inTelegram) return;
    var dark = tg.colorScheme === 'dark';
    document.documentElement.classList.toggle('tg-dark', dark);
    document.documentElement.classList.toggle('tg-light', !dark);
    try {
      var c = THEME_COLORS[t];
      if (c && tgVersion('6.9')) { tg.setHeaderColor(c.header); tg.setBackgroundColor(c.bg); }
      else if (tgVersion('6.1')) { tg.setHeaderColor('secondary_bg_color'); tg.setBackgroundColor(tg.themeParams.secondary_bg_color || tg.themeParams.bg_color || '#ffffff'); }
    } catch (e) { /* стара версія Telegram — лишаються його кольори */ }
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
    if (state.client.phoneCountry !== 'PL') state.client.phoneCountry = 'UA';
    if (FONT_SCALES.indexOf(Number(service.fontScale)) === -1) service.fontScale = 1;
    var sc = service.scene || {};
    service.scene = { mode: sc.mode === '3d' ? '3d' : '2d', view: [0, 1, 2, 3].indexOf(sc.view) === -1 ? 0 : sc.view,
                      plan: [0, 1, 2].indexOf(sc.plan) === -1 ? 0 : sc.plan };
    // Укіс: з v0.7.0 у чернетці було m (1 : m) — переводимо в градуси; далі — лише градуси в межах 30…90
    if (service.slope_m !== undefined) service.slope_deg = Slope.angleDeg(Calc.num(service.slope_m, 0));
    delete service.slope_m;
    service.slope_deg = slopeClamp(service.slope_deg);
    if (['dark', 'light', 'system'].indexOf(service.theme) === -1) service.theme = 'dark';
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
    validateBio();
    // Сходинки з чернетки: лише масив об'єктів і не більше за steps_max
    service.pro = !!service.pro;
    service.bioJoin = !!service.bioJoin;
    var steps = Array.isArray(state.inputs.steps) ? state.inputs.steps : [];
    state.inputs.steps = steps.filter(function (st) { return st && typeof st === 'object'; }).slice(0, stepsMax()).map(function (st) {
      return { type: ['shelf', 'platform', 'corner'].indexOf(st.type) === -1 ? 'shelf' : st.type,
               edge: st.edge === 'round' ? 'round' : 'straight',
               points: Array.isArray(st.points) ? st.points.map(Number).filter(function (x) { return x >= 1 && x <= 8; }) : [],
               wc: str(st.wc), we: str(st.we), a: str(st.a), b: str(st.b), depth_cm: str(st.depth_cm) };
    });
    state.stepActive = Math.max(0, Math.min(Number(state.stepActive) || 0, state.inputs.steps.length - 1));
    state.stepsStash = (Array.isArray(state.stepsStash) ? state.stepsStash : []).slice(0, stepsMax())
      .map(function (st) { return st && typeof st === 'object' && Array.isArray(st.points) ? st : null; });
  }

  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function stepsMax() { return Math.max(1, Math.round(Calc.num(catalog.settings.steps_max, 3))); }

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
    syncBio();
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
    syncPhone();
    $('clientAddress').value = state.client.address;
    $('clientComment').value = state.clientComment;
    $('comment').value = state.comment;
    syncNotes();
    $('hidePrices').checked = !!service.hidePrices;
    syncBioJoin();
    applyFontScale();
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

  // Параметри для ядра: сходинки враховуємо лише в Про-режимі (вимкнений режим не видаляє введене)
  // Кут укосу: 30…90°, до 0,1° (порожньо / помилка → 90, тобто вертикальні стінки)
  function slopeClamp(v) {
    var a = Calc.num(v, SLOPE_MAX);
    return Math.round(Math.max(SLOPE_MIN, Math.min(SLOPE_MAX, a)) * 10) / 10;
  }

  function calcInputs() {
    var inp = Object.assign({}, state.inputs);
    inp.steps = service.pro ? state.inputs.steps : [];
    // Біоплато: лише активні Bio (кеш прибраних у розрахунок не йде)
    inp.bios = state.inputs.bios.slice(0, state.inputs.bioCount);
    delete inp.bioCount;
    // Укіс — зі службової панелі, спільний для всіх кошторисів: ядро рахує з m = 1 / tg α
    inp.slope_deg = service.slope_deg;
    inp.slope_m = Slope.mFromDeg(service.slope_deg);
    return inp;
  }

  function recalc() {
    var inp = calcInputs();
    var man = state.manual;
    var valid = Calc.isValidInputs(inp);
    var rec = Calc.recommend(inp, catalog, man.filterId);
    var m = rec.metrics;

    lastMetrics = m;
    syncBioRows();                                       // довжини Bio й площа залежать від L і W
    syncSteps();
    drawScene();

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

    syncLights();

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

  // ---------- 2. Підсвітка: модель + кількість ----------
  // «Без підсвітки» → 0, лічильник блідий і не натискається; вибрали модель → 1 шт;
  // «−» до нуля → знову «Без підсвітки». Той самий підхід — для кількості сходинок (етап A2.1)
  function syncLights() {
    var off = state.decor.lightId === 'none';
    if (off) state.decor.lights = 0;
    $('lightId').value = state.decor.lightId;
    $('lights').value = state.decor.lights;
    $('lights').textContent = state.decor.lights;
    $('lightsCounter').classList.toggle('is-off', off);
    $('lightsCounter').querySelectorAll('button').forEach(function (b) { b.disabled = off; });
  }

  // ---------- Сходинки (Про-режим, A2.1) ----------
  // Логіка: лічильник «Рівні» (дно + сходинки, D38) → вкладки сходинок → тип, край, розміри, глибина;
  // точки активної сходинки натискають на 2D-схемі. Уся математика — у core/stairs.js.

  function activeStep() { return state.inputs.steps[state.stepActive] || null; }
  function dimsOk(m) { return !!m && m.L > 0 && m.W > 0 && m.D > 0; }
  function shapeOk() { return state.inputs.shape === 'rect' || state.inputs.shape === 'oval'; }
  function plural(n, one, few, many) {
    var d = n % 10, dd = n % 100;
    return d === 1 && dd !== 11 ? one : (d >= 2 && d <= 4 && (dd < 10 || dd >= 20) ? few : many);
  }

  // Глибина нової сходинки: k-те значення з «Налаштувань» (20 / 45 / 60 см), а якщо воно ≥ глибини ставка — рівний поділ
  function defaultDepthCm(k, levels) {
    var D = Calc.num(state.inputs.D), list = Stairs.defaultDepthsCm(catalog.settings), d = list[k];
    if (D > 0 && !(d > 0 && d < D * 100)) d = Stairs.splitDepthsCm(D, levels)[k];
    return d > 0 ? String(d) : String(20 * (k + 1));
  }

  function newStep(k, levels) {
    return { type: 'shelf', edge: 'straight', points: [],
             wc: Format.qty(Calc.num(catalog.settings.shelf_width_default_m, 0.4)), we: '', a: '1', b: '1',
             depth_cm: defaultDepthCm(k, levels) };
  }

  // Лічильник рівнів: + додає сходинку в кінець і робить її активною, − прибирає останню.
  // Прибрана сходинка лишається в кеші (stepsStash) під своїм номером: «+» повертає її з точками й розмірами
  function setLevels(n) {
    var steps = state.inputs.steps, stash = state.stepsStash, N = Math.max(1, Math.min(stepsMax() + 1, n));
    var added = N - 1 > steps.length;
    while (steps.length > N - 1) { var i = steps.length - 1; stash[i] = steps.pop(); }
    while (steps.length < N - 1) {
      var k = steps.length;
      steps.push(stash[k] || newStep(k, N));
      stash[k] = null;                                            // повернули — у кеші більше не тримаємо
    }
    state.stepActive = added ? steps.length - 1 : Math.max(0, Math.min(state.stepActive, steps.length - 1));
  }

  // Модель ставка для схеми точок активної сходинки (null — розмірів ще немає)
  function stepPond(type) {
    var m = lastMetrics;
    if (!dimsOk(m) || !shapeOk()) return null;
    return Stairs.buildPond(state.inputs.shape, m.L, m.W, Stairs.schemeFor(type));
  }

  // Зміна типу: лишаємо лише точки, що є в новій схемі (8 ↔ 6 точок, D32); «від кута» — один кут
  function setStepType(st, type) {
    st.type = type;
    var pond = stepPond(type);
    st.points = st.points.filter(function (id) { return pond ? !!pond.pts[id] : id <= 6; });
    if (type === 'corner') {
      st.points = st.points.filter(function (id) { return pond && pond.pts[id] && pond.pts[id].corner; }).slice(0, 1);
    }
  }

  function togglePoint(id) {
    var st = activeStep();
    if (!st) return;
    if (st.type === 'corner') st.points = [id];                   // кут — лише один
    else {
      var i = st.points.indexOf(id);
      if (i === -1) st.points.push(id); else st.points.splice(i, 1);
    }
    haptic('select');
    changed();
  }

  // Точки й шари для 2D-схеми (координати плану, як ввів майстер)
  function sketchOverlay(m) {
    var ov = { layers: [], points: [] };
    if (!service.pro || !m.steps || !m.steps.available) return ov;
    var depths = m.steps.layers.map(function (l) { return l.depth; })
      .filter(function (d, i, a) { return a.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
    m.steps.layers.forEach(function (l, k) {
      if (!l.rings.length) return;
      ov.layers.push({ rings: l.rings.map(function (r) { return r.map(function (p) { return Stairs.toPlan(p, l.pond); }); }),
                       rank: depths.indexOf(l.depth), active: k === state.stepActive, error: !l.valid });
    });
    var st = activeStep(), pond = st ? stepPond(st.type) : null;
    if (pond && !(st.type === 'corner' && pond.kind !== 'rect')) {
      pond.order.forEach(function (id) {
        var P = pond.pts[id];
        if (st.type === 'corner' && !P.corner) return;              // «від кута»: підсвічуємо лише 4 кути (D37)
        ov.points.push({ id: id, p: Stairs.toPlan(P.p, pond), selected: st.points.indexOf(id) !== -1 });
      });
    }
    return ov;
  }

  // Рівні для 3D: многокутники сходинок з глибинами (кільце — з діркою).
  // Той самий масив, поки розрахунок не змінився, — sketch3d.js тоді не перебудовує сцену на кожен кадр повороту
  var levelsMemo = { steps: undefined, pro: null, value: [] };
  function sceneLevels(m) {
    if (levelsMemo.steps === m.steps && levelsMemo.pro === service.pro) return levelsMemo.value;
    var out = [];
    levelsMemo = { steps: m.steps, pro: service.pro, value: out };
    if (!service.pro || !m.steps || !m.steps.available) return out;
    m.steps.layers.forEach(function (l) {
      if (!l.valid) return;
      l.parts.forEach(function (part) {
        var rings = part.rings.map(function (r) { return r.map(function (p) { return Stairs.toPlan(p, l.pond); }); });
        out.push({ poly: rings[0], holes: rings.slice(1), depth: l.depth });
      });
    });
    return out;
  }

  function setVal(id, v) { var el = $(id); if (document.activeElement !== el) el.value = v; }

  // Перемальовує редактор сходинок за станом і останнім розрахунком
  function syncSteps() {
    $('proSteps').checked = !!service.pro;
    $('stepsBox').hidden = !service.pro;
    if (!service.pro) return;
    var m = lastMetrics, steps = state.inputs.steps, N = steps.length + 1, max = stepsMax() + 1;
    $('levels').textContent = N;
    $('levelsCounter').classList.toggle('is-off', N === 1);
    $('levelsHint').textContent = N === 1 ? '(лише дно)' : '(дно + ' + (N - 1) + ' ' + plural(N - 1, 'сходинка', 'сходинки', 'сходинок') + ')';
    document.querySelector('[data-levels="-1"]').disabled = N <= 1 || !shapeOk();
    document.querySelector('[data-levels="1"]').disabled = N >= max || !shapeOk();

    var note = !shapeOk() ? 'Сходинки — лише для прямокутного й овального ставка.'
      : (N > 1 && !dimsOk(m) ? 'Введіть довжину, ширину й глибину — на схемі з\'являться точки.' : '');
    $('stepsUnavailable').textContent = note;
    $('stepsUnavailable').hidden = !note;
    $('stepEditor').hidden = !shapeOk() || N === 1;
    if ($('stepEditor').hidden) return;

    var layers = m && m.steps && m.steps.available ? m.steps.layers : [];
    // Вкладки: номер і глибина; сходинка з помилкою — червоним
    var tabs = $('stepTabs');
    tabs.innerHTML = '';
    steps.forEach(function (st, k) {
      // Коротко «1 · 20 см»: три вкладки вміщаються в один рядок на телефоні
      var b = UI.el('button', 'seg__btn' + (layers[k] && !layers[k].valid ? ' is-error' : ''),
        (k + 1) + ' · ' + (st.depth_cm || '—') + ' см');
      b.type = 'button';
      b.setAttribute('aria-label', 'Сходинка ' + (k + 1) + ', глибина ' + (st.depth_cm || 'не задана') + ' см' +
        (layers[k] && !layers[k].valid ? ', є помилка' : ''));
      b.dataset.steptab = k;
      b.setAttribute('aria-pressed', String(k === state.stepActive));
      tabs.appendChild(b);
    });

    var st = activeStep(), layer = layers[state.stepActive], isRect = state.inputs.shape === 'rect';
    document.querySelectorAll('[data-steptype]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.steptype === st.type)); });
    document.querySelectorAll('[data-stepedge]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.stepedge === st.edge)); });
    $('stepEdgeSeg').hidden = st.type === 'corner';

    // Поля: полиця — ширини (на кінцях — лише для прямокутника, §2.2); «від кута» — довжина й ширина
    var shelf = st.type === 'shelf', corner = st.type === 'corner';
    $('fWc').hidden = !shelf;
    $('fWe').hidden = !(shelf && isRect);
    $('fA').hidden = !corner;
    $('fB').hidden = !corner;
    $('fWcLabel').textContent = shelf && isRect ? 'По центру, м' : 'Ширина, м';
    setVal('stepWc', st.wc); setVal('stepWe', st.we); setVal('stepA', st.a); setVal('stepB', st.b); setVal('stepDepth', st.depth_cm);
    $('stepWe').placeholder = st.edge === 'straight' ? (st.wc || '—') : '0';

    // Підказка: що натиснути на схемі
    var pts = st.points.slice().sort(function (a, b) { return a - b; }).map(function (id) { return '#' + id; }).join(', ');
    var hint = corner && !isRect ? '«Від кута» — лише для прямокутного ставка.'
      : corner ? (pts ? 'Кут ' + pts + '. ' : 'Натисніть кут на схемі. ') + 'Довжина — вздовж довшої стінки.'
      : pts ? 'Обрано: ' + pts
      : shelf ? 'Натисніть на схемі точки вздовж стінки — щонайменше 2.'
      : 'Натисніть на схемі точки мілкої зони — платформу відріже пряма або дуга.';
    if (service.scene.mode === '3d' && !(corner && !isRect)) hint = 'Точки обирають на 2D-схемі. ' + hint;
    $('stepHint').textContent = hint;

    // Результат: площа, видима площа, вид; для округлих — радіус і хорда (розмітка шнуром, §7.5)
    var res = $('stepResult');
    res.innerHTML = '';
    if (layer && layer.valid) {
      var t = 'Площа ' + Format.qty(layer.area) + ' м²';
      if (layer.visible < layer.area - 0.05) t += ', видима ' + Format.qty(layer.visible) + ' м²';
      if (layer.kind) t += ' · ' + layer.kind;
      if (layer.R) t += ' · R ' + Format.number(layer.R, 2) + ' м, хорда ' + Format.number(layer.chord, 2) + ' м';
      res.appendChild(document.createTextNode(t));
    }
    if (m && m.steps && m.steps.available) {
      res.appendChild(UI.el('span', null, 'Глибока зона ' + Format.qty(m.steps.Sdeep) + ' м² (' + Math.round(m.steps.deepShare * 100) + '%)'));
    }

    // Помилки активної сходинки — червоним; попередження — сірим (загальні теж)
    var ul = $('stepIssues');
    ul.innerHTML = '';
    if (layer) {
      layer.errors.forEach(function (c) { ul.appendChild(UI.el('li', null, Stairs.TEXT[c])); });
      layer.warnings.forEach(function (c) { ul.appendChild(UI.el('li', 'is-warn', Stairs.TEXT[c])); });
    }
    if (m && m.steps) m.steps.warnings.forEach(function (w) { if (!w.step) ul.appendChild(UI.el('li', 'is-warn', w.text)); });
  }

  // Редагування сходинки: схема перемикається на 2D, бо точки натискають саме там
  function toSketch2d() {
    if (service.scene.mode === '3d') { service.scene.mode = '2d'; sceneAz = null; }
    service.scene.plan = 0;                            // точки — лише на плані, не на розрізі
  }

  function bindSteps() {
    $('proSteps').addEventListener('change', function (e) { service.pro = e.target.checked; haptic('select'); changed(); });
    document.querySelectorAll('[data-levels]').forEach(function (b) {
      b.addEventListener('click', function () {
        setLevels(state.inputs.steps.length + 1 + Number(b.dataset.levels));
        if (Number(b.dataset.levels) > 0) toSketch2d();
        haptic('select');
        changed();
      });
    });
    $('stepTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-steptab]');
      if (!b) return;
      state.stepActive = Number(b.dataset.steptab);
      toSketch2d();
      haptic('select');
      changed();
    });
    document.querySelectorAll('[data-steptype]').forEach(function (b) {
      b.addEventListener('click', function () {
        var st = activeStep();
        if (!st) return;
        setStepType(st, b.dataset.steptype);
        toSketch2d();
        haptic('select');
        changed();
      });
    });
    document.querySelectorAll('[data-stepedge]').forEach(function (b) {
      b.addEventListener('click', function () {
        var st = activeStep();
        if (!st) return;
        st.edge = b.dataset.stepedge;
        haptic('select');
        changed();
      });
    });
    [['stepWc', 'wc'], ['stepWe', 'we'], ['stepA', 'a'], ['stepB', 'b'], ['stepDepth', 'depth_cm']].forEach(function (p) {
      $(p[0]).addEventListener('input', function (e) {
        var st = activeStep();
        if (!st) return;
        st[p[1]] = e.target.value;
        changed();
      });
    });
    // «Поділити порівну» (D34): D·k/N, N — рівні з дном
    $('splitDepths').addEventListener('click', function () {
      var D = Calc.num(state.inputs.D), steps = state.inputs.steps;
      if (!(D > 0)) { alertMsg('Спершу введіть глибину ставка.'); return; }
      var split = Stairs.splitDepthsCm(D, steps.length + 1);
      steps.forEach(function (st, k) { st.depth_cm = String(split[k]); });
      haptic('select');
      changed();
    });
    // Натискання на точку 2D-схеми (кружечки створюються під час малювання — ловимо на самому SVG)
    $('sketch').addEventListener('click', function (e) {
      if (!service.pro || service.scene.mode !== '2d' || service.scene.plan) return;
      var g = e.target.closest && e.target.closest('[data-point]');
      if (g) togglePoint(Number(g.getAttribute('data-point')));
    });
  }

  // ---------- 3. Схема ставка: 2D / 3D ----------
  // Висота видимої області: у Telegram — стабільна висота Mini App, у браузері — висота вікна
  function viewportHeight() {
    var h = window.innerHeight;
    return inTelegram && tg.viewportStableHeight ? Math.min(h, tg.viewportStableHeight) : h;
  }

  // Прямокутники кнопок і підписів поверх схеми (px відносно блока схеми): креслення їх обходить.
  // Верхні — відстань від верху (y1), нижні — висота від низу (h): низ блока рухається разом з висотою схеми
  function sceneAvoid() {
    var sc = $('scene').getBoundingClientRect(), out = { top: [], bottom: [] };
    function rect(el) {
      var r = el.getBoundingClientRect();
      return { x0: Math.round(r.left - sc.left), x1: Math.round(r.right - sc.left), y1: Math.round(r.bottom - sc.top), h: Math.round(sc.bottom - r.top) };
    }
    [$('sceneCaption'), document.querySelector('.scene__mode')].forEach(function (el) {
      if (!el.hidden) { var r = rect(el); out.top.push({ x0: r.x0, x1: r.x1, y1: r.y1 }); }
    });
    [$('sceneDots'), $('sceneNav')].forEach(function (el) {
      if (!el.hidden) { var r = rect(el); out.bottom.push({ x0: r.x0, x1: r.x1, h: r.h }); }
    });
    return out;
  }

  /*
   * Розрізи й укіс на плані (v0.7.0): поле глибин (core/slope.js) з тими самими сходинками, що й у розрахунку;
   * лінії А–А (y = W/2) і Б–Б (x = L/2) — через ставок і біоплато, якщо воно на лінії.
   * Біоплато в розрізі — котлован з вертикальними стінками на bio_depth_m; «Разом» — укіс ставка починається
   * від глибини біоплато (лише вигляд, D56). Результат запам'ятовуємо, поки не змінились вхідні дані.
   */
  var PLAN_NAMES = ['План', 'Розріз А–А (по довжині)', 'Розріз Б–Б (по ширині)'];
  var secK = [1, null, null];                          // вертикальне перебільшення розрізів (для підпису)
  var secRetry = false;                                // підпис змінився — перемальовуємо лише один раз
  var cutMemo = { key: null, value: null };
  function cutGeometry(m) {
    var shape = state.inputs.shape, L = m.L, W = m.W, D = m.D;
    var bioD = Calc.num(catalog.settings.bio_depth_m), levels = sceneLevels(m);
    var plates = m.hasBio ? m.bioPlates.map(function (p) { return { n: p.n, side: p.side, w: p.w }; }) : [];
    var key = JSON.stringify([shape, L, W, D, m.slopeM, plates, service.bioJoin, bioD, service.pro, levelsMemo.steps && levelsMemo.steps.layers.length]);
    if (cutMemo.key === key && cutMemo.levels === levels) return cutMemo.value;
    // Біоплато (v0.7.1): «Разом» — спільний контур і шви; «Окремо» — котловани (кільце 4 Bio — з «островом»)
    var bg = plates.length ? PondGeo.bioGeometry(shape, L, W, plates, service.bioJoin) : null;
    var jn = bg && bg.union ? bg : null;
    var extra = jn ? [{ poly: jn.union, holes: [], depth: bioD }]
      : bg ? bg.pits.map(function (pt) { return { poly: pt.outline, holes: pt.holes, depth: bioD }; }) : [];
    var f = Slope.field({ outline: PondGeo.outline(shape, L, W), D: D, m: m.slopeM, levels: levels,
                          seam: jn && bioD > 0 ? { lines: jn.seams, depth: bioD } : null });
    // Де лінія (x або y = c) перетинає многокутник: координати перетинів уздовж лінії
    function cross(poly, axis, c) {
      var out = [];
      poly.forEach(function (a, i) {
        var b = poly[(i + 1) % poly.length], u = axis ? 0 : 1, v = axis ? 1 : 0;   // u — поперек лінії, v — уздовж
        if ((a[u] - c) * (b[u] - c) <= 0 && a[u] !== b[u]) out.push(a[v] + (b[v] - a[v]) * (c - a[u]) / (b[u] - a[u]));
      });
      return out;
    }
    function line(axis) {                               // axis 0 — А–А (уздовж x), 1 — Б–Б (уздовж y)
      var c = axis ? L / 2 : W / 2, lo = 0, hi = axis ? W : L, bx = [];
      extra.forEach(function (e) { bx = bx.concat(cross(e.poly, axis, c)); });
      if (bx.length) { lo = Math.min(lo, Math.min.apply(null, bx)); hi = Math.max(hi, Math.max.apply(null, bx)); }
      var mg = Math.max(0.3, 0.06 * (hi - lo));         // земля з обох боків
      var p = function (v) { return axis ? [c, v] : [v, c]; };
      var samples = Slope.profile(f, p(lo - mg), p(hi + mg), extra);
      var dims = [{ t0: mg - lo, t1: mg - lo + (axis ? W : L), text: Format.qty(axis ? W : L) + ' м' }];
      // Розмір кожного Bio, яке перетинає лінія розрізу: «Bio-N»
      if (bioD > 0 && bg) bg.rects.forEach(function (r) {
        var q = r.r, u0 = axis ? q[0] : q[1], u1 = u0 + (axis ? q[2] : q[3]), v0 = axis ? q[1] : q[0], v1 = v0 + (axis ? q[3] : q[2]);
        if (c > u0 && c < u1) dims.push({ t0: v0 - lo + mg, t1: v1 - lo + mg, text: 'Bio-' + r.n });
      });
      return { ends: [p(lo), p(hi)], section: { samples: samples, dims: dims } };
    }
    var a = line(0), b = line(1);
    cutMemo = { key: key, levels: levels, value: { aa: a.ends, bb: b.ends, sections: [a.section, b.section], toe: Slope.toeLines(f) } };
    return cutMemo.value;
  }

  // fromAnim = true — кадр анімації повороту: розміри блока й кнопок не змінились, не перемірюємо
  var sceneBox = null;
  function drawScene(fromAnim) {
    var m = lastMetrics;
    if (!m) return;
    var is3d = service.scene.mode === '3d';
    document.querySelectorAll('[data-scene]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.scene === service.scene.mode));
    });
    var dims = m.L > 0 && m.W > 0 && m.D > 0;
    var planView = is3d ? 0 : service.scene.plan;       // 2D: 0 — план, 1 — А–А, 2 — Б–Б
    // ‹ › і крапки: 3D — 4 ракурси, 2D — план і два розрізи (v0.7.0); без розмірів гортати нічого
    $('sceneNav').hidden = !dims;
    $('sceneDots').hidden = !dims;
    $('sceneDots').querySelectorAll('i').forEach(function (d, i) {
      d.hidden = !is3d && i > 2;
      d.classList.toggle('is-on', i === (is3d ? service.scene.view : planView));
    });
    $('sketch').classList.toggle('is-3d', is3d);
    $('sketch').setAttribute('aria-label', is3d ? 'Схема ставка в 3D, ракурс ' + (service.scene.view + 1) + ' з 4' : 'Схема ставка: ' + PLAN_NAMES[planView].toLowerCase());
    var slopeTxt = m.slopeM > 0 ? 'укіс ' + Format.qty(service.slope_deg) + '° (1 : ' + ratioTxt(m.slopeM) + ')' : '';
    $('sceneCaption').hidden = !dims || (!is3d && !planView);
    // Підпис — до вимірювання кнопок: порожній підпис має нульовий розмір і креслення налізло б на нього
    if (is3d && dims) {
      $('sceneCaption').textContent = Format.qty(m.L) + ' × ' + Format.qty(m.W) + ' м, глибина ' + Format.qty(m.D) + ' м' +
        (state.inputs.shape === 'custom' ? ' (форма умовна)' : '');   // укіс у 3D не малюємо (v0.7.1: лише в розрахунку й розрізах)
    } else if (dims && planView) {
      var kx = secK[planView] > 1 ? ' · вертикаль ×' + Format.qty(secK[planView]) : '';
      $('sceneCaption').textContent = PLAN_NAMES[planView] + (slopeTxt ? ' · ' + slopeTxt : '') + kx;
    }
    if (!fromAnim || !sceneBox) {
      // 1. Розмір блока схеми (D57): на всю ширину; висота — до висоти екрана (альбом), а в портреті:
      //    3D — до ширини блока, 2D — до PLAN_H_K ширини (v0.6.3, D60: план 2D на всю висоту був завеликим)
      var bw = $('scene').clientWidth, vh = viewportHeight();
      var landscape = window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
      var hPortrait = Math.min((is3d ? 1 : PLAN_H_K) * bw, 0.62 * vh);                  // розрізи — як план
      sceneBox = { box: { w: bw, hMax: Math.max(160, landscape ? vh - 24 : hPortrait) }, avoid: sceneAvoid() };
    }
    if (!is3d) {
      tweenScene = false; shownFit = null; fitTween = null;   // перехід масштабу — лише для 3D
      var fs = Number(service.fontScale) || 1, cut = dims ? cutGeometry(m) : null;
      if (planView && cut) {
        // Розріз: профіль уздовж лінії; множник вертикалі — у підписі (якщо змінився — перемальовуємо підпис і схему)
        var r = UI.drawSection($('sketch'), cut.sections[planView - 1], { box: sceneBox.box, avoid: sceneBox.avoid, fs: fs });
        if (r.k !== secK[planView] && !secRetry) { secK[planView] = r.k; secRetry = true; drawScene(); secRetry = false; }
        return;
      }
      UI.drawSketch($('sketch'), state.inputs.shape, m, sketchOverlay(m), { joined: service.bioJoin },
        { box: sceneBox.box, avoid: sceneBox.avoid, fs: fs,
          sections: cut ? { aa: cut.aa, bb: cut.bb } : null, toe: cut ? cut.toe : [] });
      return;
    }

    if (sceneAz === null) sceneAz = VIEW_AZ[service.scene.view];
    var bioDepth = Calc.num(catalog.settings.bio_depth_m);
    var o = {
      shape: state.inputs.shape, L: m.L, W: m.W, D: m.D,
      bio: m.hasBio ? { plates: m.bioPlates.map(function (p) { return { n: p.n, side: p.side, w: p.w }; }), depth: bioDepth, joined: service.bioJoin } : null,
      levels: sceneLevels(m), fast: !!fromAnim,
      azimuth: sceneAz, views: VIEW_AZ,
      box: sceneBox.box, avoid: sceneBox.avoid, fs: Number(service.fontScale) || 1
    };
    // Біоплато ввімкнули / перенесли: масштаб і висота схеми змінюються плавно (0,3 с), а не стрибком
    var target = dims ? Sketch3D.layout(o) : null;
    if (target && tweenScene && shownFit && shownFit !== target && !fitTween) {
      fitTween = { from: shownFit, to: target, t0: Date.now() };
      requestAnimationFrame(tweenFrame);
    }
    tweenScene = false;
    if (fitTween) {
      if (fitTween.to !== target) fitTween = { from: shownFit, to: target, t0: Date.now() }; // ціль змінилась посеред переходу
      var k = Math.min(1, (Date.now() - fitTween.t0) / 300), e = 1 - Math.pow(1 - k, 3);
      o.fit = k < 1 ? lerpFit(fitTween.from, fitTween.to, e) : target;
      o.fast = k < 1;
      if (k >= 1) fitTween = null;
    }
    shownFit = dims ? (o.fit || target) : null;
    Sketch3D.draw($('sketch'), o);
  }

  // Плавний перехід масштабу 3D-схеми
  var tweenScene = false, fitTween = null, shownFit = null;
  function lerpFit(a, b, e) {
    var l = function (x, y) { return x + (y - x) * e; };
    // Зсуви підписів «Bio-N» (масив; кількість Bio могла змінитися — бракує → 0)
    var lk = function (x, y) { x = x || []; y = y || []; return y.map(function (v, i) { return l(x[i] || 0, v || 0); }); };
    // views — зсув, висота і місця підписів кожного ракурсу (D58, D59): переходять плавно разом з масштабом
    var views = (a.views || []).length === (b.views || []).length ? (b.views || []).map(function (v, i) {
      return { az: v.az, t: l(a.views[i].t, v.t), h: l(a.views[i].h, v.h), k: lk(a.views[i].k, v.k) };
    }) : b.views;
    return { s: l(a.s, b.s), offX: l(a.offX, b.offX), t: l(a.t, b.t), h: l(a.h, b.h), minY: l(a.minY, b.minY),
             center: [l(a.center[0], b.center[0]), l(a.center[1], b.center[1])], views: views };
  }
  function tweenFrame() {
    if (!fitTween) return;
    drawScene(true);
    if (fitTween) requestAnimationFrame(tweenFrame);
  }

  // Поворот на сусідній ракурс: dir = +1 (›) або −1 (‹); плавно, якщо користувач не вимкнув анімації
  function rotateView(dir) {
    if (service.scene.mode !== '3d') {
      // 2D: план → розріз А–А → розріз Б–Б → план
      service.scene.plan = (service.scene.plan + dir + 3) % 3;
      saveDraft();
      haptic('select');
      drawScene();
      return;
    }
    service.scene.view = (service.scene.view + dir + 4) % 4;
    saveDraft();
    haptic('select');
    var from = sceneAz === null ? VIEW_AZ[service.scene.view] : sceneAz;
    // Шлях до нового ракурсу саме в напрямку натиснутої стрілки
    var d = ((VIEW_AZ[service.scene.view] - from) % 360 + 360) % 360;
    if (dir < 0 && d > 0) d -= 360;
    var to = from + d;
    var id = ++animId;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { sceneAz = ((to % 360) + 360) % 360; drawScene(true); return; }
    var t0 = null;
    function frame(now) {
      if (id !== animId) return;                 // почався новий поворот — цей зупиняємо
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / 320);
      var ease = 1 - Math.pow(1 - k, 3);         // швидкий старт, м'яке гальмування
      sceneAz = from + (to - from) * ease;
      drawScene(true);
      if (k < 1) requestAnimationFrame(frame); else sceneAz = ((to % 360) + 360) % 360;
    }
    requestAnimationFrame(frame);
  }

  function bindScene() {
    document.querySelectorAll('[data-scene]').forEach(function (b) {
      b.addEventListener('click', function () {
        service.scene.mode = b.dataset.scene;
        haptic('select');
        saveDraft();
        syncSteps();
        drawScene();
      });
    });
    document.querySelectorAll('[data-rotate]').forEach(function (b) {
      b.addEventListener('click', function () { rotateView(Number(b.dataset.rotate)); });
    });
    // 2. Свайп прибрано (v0.4.1): ракурс змінюють лише стрілки ‹ ›, тож прокрутка сторінки не повертає схему
    // Поворот телефона / зміна розміру вікна: блок схеми змінив розмір — перемальовуємо (раз на кадр)
    var resizeQueued = false, settle = [];
    function redraw() {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(function () { resizeQueued = false; drawScene(); });
    }
    function redrawSettled() {
      redraw();
      settle.forEach(clearTimeout);
      settle = [250, 700].map(function (ms) { return setTimeout(redraw, ms); }); // після анімації повороту
    }
    window.addEventListener('resize', redrawSettled);
    window.addEventListener('orientationchange', redrawSettled);
    if (inTelegram) tg.onEvent('viewportChanged', function (e) { if (!e || e.isStateStable) redraw(); });
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
    syncSlope();
    syncTheme();
  }
  // Кут укосу: значення в полі (якщо його не редагують), межі «−» / «+», закладення 1 : m у підказці
  function syncSlope(keepField) {
    var a = service.slope_deg, m = Slope.mFromDeg(a);
    if (!keepField) $('slopeDeg').value = Format.qty(a);
    $('slopeMinus').disabled = a <= SLOPE_MIN;
    $('slopePlus').disabled = a >= SLOPE_MAX;
    $('slopeRatio').textContent = '1 : ' + ratioTxt(m);
  }
  // Закладення m до сотих без зайвих нулів: 0,09 / 1,73 / 1 (кут 85° → 1 : 0,09)
  function ratioTxt(m) { return Format.number(m, 2).replace(/,?0+$/, '') || '0'; }
  // Тема: яка кнопка натиснута
  function syncTheme() {
    document.querySelectorAll('[data-theme-opt]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.themeOpt === service.theme));
    });
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
    return Format.estimateText(lastEst, calcInputs(), {
      client: state.client, clientComment: state.clientComment, // коментар «для себе» не передаємо
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
    // Біоплато (v0.7.1): перемикач, кількість Bio, ширина кожного і ‹ › — сторона ставка
    $('bio').addEventListener('change', function (e) {
      state.inputs.bio = e.target.checked;
      if (state.inputs.bio && !state.inputs.bioCount) bioAdd();  // увімкнули — одразу Bio-1 (з кешу, якщо було)
      bioSettle();
      bioChanged();
    });
    document.querySelectorAll('[data-biocount]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = state.inputs;
        if (Number(b.dataset.biocount) > 0) { if (inp.bioCount < BIO_MAX) bioAdd(); }
        else if (inp.bioCount > 0) {
          inp.bioCount--;                                  // прибране Bio лишається в кеші (bios) — «+» поверне його
          if (!inp.bioCount) inp.bio = false;              // «−» з 1 → 0: біоплато вимикається
        }
        haptic('select');
        bioChanged();
      });
    });
    [0, 1, 2, 3].forEach(function (i) {
      $('bioW' + (i + 1)).addEventListener('input', function (e) {
        if (state.inputs.bios[i]) state.inputs.bios[i].w = e.target.value;
        tweenScene = true;
        changed();
      });
    });
    // ‹ › — Bio на іншу сторону (› — за годинниковою: праворуч → знизу → ліворуч → зверху); зайняті сторони пропускаємо
    document.querySelectorAll('[data-biomove]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.dataset.biomove), bio = state.inputs.bios[i];
        var next = bio && bioFreeSide(bio.side, Number(b.dataset.d), i, false);
        if (!next) return;
        bio.side = next;
        haptic('select');
        bioChanged();
      });
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
        if (key === 'lights') {
          if (state.decor.lightId === 'none') return;          // без моделі кількість не змінюємо
          state.decor.lights = next;
          if (next === 0) state.decor.lightId = 'none';        // «−» до нуля = «Без підсвітки»
        } else {
          state.manual[key] = next;
        }
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
    [['clientName', 'name'], ['clientAddress', 'address']].forEach(function (p) {
      $(p[0]).addEventListener('input', function (e) { state.client[p[1]] = e.target.value; saveDraft(); });
    });
    ['clientComment', 'comment'].forEach(function (key) {
      $(key).addEventListener('input', function (e) { state[key] = e.target.value; saveDraft(); });
    });
    // «+ Коментар…» розгортає поле й ставить у нього курсор; «Прибрати» очищає і згортає
    document.querySelectorAll('[data-note]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.note;
        state.notes[key] = true;
        syncNotes();
        saveDraft();
        setTimeout(function () { $(key).focus(); }, 280); // після анімації розкриття
      });
    });
    document.querySelectorAll('[data-note-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.dataset.noteRemove;
        state[key] = '';
        state.notes[key] = false;
        $(key).value = '';
        syncNotes();
        saveDraft();
      });
    });

    // Розмір тексту (службова панель)
    document.querySelectorAll('[data-font]').forEach(function (b) {
      b.addEventListener('click', function () {
        service.fontScale = Number(b.dataset.font);
        applyFontScale();
        drawScene();
        haptic('select');
        saveDraft();
      });
    });

    bindPhone();
    bindKeyboard();
    bindScene();
    bindSteps();

    // Службова панель: довге натискання на весь блок заголовка
    bindLongPress(document.querySelector('.head'), openService);
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
    // Укіс (D61, v0.7.1 — у градусах): зберігається в службових налаштуваннях і діє на всі кошториси.
    // «−» / «+» — крок 1°; число можна ввести з клавіатури: > 90 одразу стає 90, < 30 — після виходу з поля
    document.querySelectorAll('[data-slope]').forEach(function (b) {
      b.addEventListener('click', function () {
        service.slope_deg = slopeClamp(service.slope_deg + Number(b.dataset.slope));
        syncSlope();
        haptic('select');
        changed();
      });
    });
    $('slopeDeg').addEventListener('focus', function (e) { e.target.select(); });
    $('slopeDeg').addEventListener('input', function (e) {
      var v = Calc.num(e.target.value, NaN);
      if (v > SLOPE_MAX) { e.target.value = String(SLOPE_MAX); v = SLOPE_MAX; }
      if (!(v >= SLOPE_MIN)) return;                       // ще вводять (напр., «8» перед «85») — розрахунок не чіпаємо
      service.slope_deg = slopeClamp(v);
      syncSlope(true);
      changed();
    });
    $('slopeDeg').addEventListener('blur', function () {
      service.slope_deg = slopeClamp(Calc.num($('slopeDeg').value, NaN) >= SLOPE_MIN ? $('slopeDeg').value : SLOPE_MIN);
      syncSlope();
      changed();
    });
    $('slopeDeg').addEventListener('keydown', function (e) { if (e.key === 'Enter') e.target.blur(); });
    // Тема інтерфейсу: одразу застосовуємо й зберігаємо (не скидається «Новим кошторисом»)
    document.querySelectorAll('[data-theme-opt]').forEach(function (b) {
      b.addEventListener('click', function () {
        service.theme = b.dataset.themeOpt;
        applyTheme();
        syncTheme();
        haptic('select');
        saveDraft();
        drawScene();
      });
    });
    // Біоплато на схемі «Разом / Окремо» (D56): лише вигляд 2D / 3D — перераховувати кошторис не треба
    document.querySelectorAll('[data-biojoin]').forEach(function (b) {
      b.addEventListener('click', function () {
        service.bioJoin = b.dataset.biojoin === '1';
        syncBioJoin();
        tweenScene = true;                                 // 3D плавно змінює масштаб (D55)
        haptic('select');
        saveDraft();
        drawScene();
      });
    });
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

  // ---------- Біоплато (v0.7.1): Bio-1 … Bio-4 ----------
  var BIO_SIDE_NAMES = { right: 'праворуч', bottom: 'знизу', left: 'ліворуч', top: 'зверху' };
  var BIO_CYCLE = ['right', 'bottom', 'left', 'top'];     // за годинниковою стрілкою на схемі

  // Сторони, зайняті активними Bio, крім Bio з номером except (індекс)
  function bioTaken(except) {
    var t = {};
    state.inputs.bios.slice(0, state.inputs.bioCount).forEach(function (b, i) { if (i !== except && b) t[b.side] = true; });
    return t;
  }
  // Наступна вільна сторона від from у напрямку dir (±1); self = true — сама from теж годиться (якщо вільна)
  function bioFreeSide(from, dir, except, self) {
    var t = bioTaken(except), i0 = Math.max(0, BIO_CYCLE.indexOf(from));
    if (self && !t[from]) return from;
    for (var k = 1; k < 4; k++) {
      var sd = BIO_CYCLE[((i0 + dir * k) % 4 + 4) % 4];
      if (!t[sd]) return sd;
    }
    return null;
  }
  // «+»: наступне Bio — з кешу (та сама ширина й сторона; сторону зайняли — перша вільна за годинниковою)
  // або нове — на першу вільну сторону за годинниковою після попереднього Bio
  function bioAdd() {
    var inp = state.inputs, n = inp.bioCount, cached = inp.bios[n];
    if (cached) cached.side = bioFreeSide(cached.side, 1, n, true);
    else {
      var prev = n ? inp.bios[n - 1].side : 'top';        // перше Bio — праворуч (після «зверху»)
      inp.bios[n] = { side: bioFreeSide(prev, 1, n, false) || 'right', w: '' };
    }
    inp.bioCount = n + 1;
    inp.bio = true;
  }
  // Сторони активних Bio різні (після відновлення чернетки чи кешу)
  function bioSettle() {
    var inp = state.inputs;
    for (var i = 0; i < inp.bioCount; i++) {
      var t = {};
      for (var j = 0; j < i; j++) t[inp.bios[j].side] = true;
      if (t[inp.bios[i].side]) inp.bios[i].side = bioFreeSide(inp.bios[i].side, 1, i, true);
    }
  }
  // Чернетка: перенесення з v0.7.0 (одне біоплато Lб × Wб → Bio-1 шириною Lб — «від ставка», D54) і перевірка
  function validateBio() {
    var inp = state.inputs;
    if (!Array.isArray(inp.bios)) inp.bios = [];
    if (!inp.bios.length && inp.Lb !== undefined && String(inp.Lb).trim() !== '') {
      inp.bios = [{ side: BIO_CYCLE.indexOf(inp.bioSide) === -1 ? 'right' : inp.bioSide, w: str(inp.Lb) }];
      inp.bioCount = 1;
    }
    delete inp.Lb; delete inp.Wb; delete inp.bioSide;
    inp.bios = inp.bios.filter(function (b) { return b && typeof b === 'object'; }).slice(0, BIO_MAX).map(function (b) {
      return { side: BIO_CYCLE.indexOf(b.side) === -1 ? 'right' : b.side, w: str(b.w) };
    });
    inp.bioCount = Math.max(0, Math.min(inp.bios.length, Math.round(Calc.num(inp.bioCount, 0))));
    inp.bio = !!inp.bio;
    bioSettle();
    if (inp.bio && !inp.bioCount) bioAdd();
  }

  // Зміна кількості, сторони чи перемикача: екран, 3D плавно (D55), перерахунок
  function bioChanged() {
    syncBio();
    tweenScene = true;
    changed();
  }

  // Перемикач, лічильник і рядки Bio (значення полів — лише тут, щоб не заважати введенню)
  function syncBio() {
    var inp = state.inputs, on = !!inp.bio;
    $('bio').checked = on;
    $('bioCounter').hidden = !on;
    $('bioCount').textContent = inp.bioCount;
    document.querySelector('[data-biocount="1"]').disabled = inp.bioCount >= BIO_MAX;
    UI.setCollapse($('bioFields'), on);
    for (var i = 0; i < BIO_MAX; i++) {
      var active = on && i < inp.bioCount;
      UI.setCollapse($('bioRow' + (i + 1)), active);
      var el = $('bioW' + (i + 1));
      if (inp.bios[i] && el.value !== inp.bios[i].w) el.value = inp.bios[i].w;
    }
    syncBioRows();
  }

  // Довжина кожного Bio (сторона ставка), доступність ‹ ›, рядок про стик і загальну площу
  function syncBioRows() {
    var inp = state.inputs, L = Calc.num(inp.L), W = Calc.num(inp.W);
    for (var i = 0; i < inp.bioCount; i++) {
      var b = inp.bios[i], len = b.side === 'right' || b.side === 'left' ? W : L;
      $('bioLen' + (i + 1)).textContent = '× ' + (len > 0 ? Format.qty(len) : '—') + ' м';
      var free = !!bioFreeSide(b.side, 1, i, false);       // усі інші сторони зайняті — ‹ › не діють (Bio-4)
      $('bioRow' + (i + 1)).querySelectorAll('[data-biomove]').forEach(function (btn) { btn.disabled = !free; });
      $('bioSideLabel' + (i + 1)).textContent = 'Bio-' + (i + 1) + ' ' + BIO_SIDE_NAMES[b.side];
    }
    var bl = Calc.bioLayout(calcInputs(), L, W), show = inp.bio && inp.bioCount > 1 && bl.area > 0;
    if (show) {
      // Нерозривний пробіл: «20 м²» не розривається між рядками
      $('bioSum').innerHTML = (bl.jointArea > 0 ? 'Додано <strong>' + Format.qty(bl.jointArea) + '\u00a0м²</strong> на стик; ' : '') +
        'загальна площа <strong>' + Format.qty(bl.area) + '\u00a0м²</strong>';
    }
    UI.setCollapse($('bioSumBox'), show);
  }

  // Службова панель: яка кнопка «Разом / Окремо» натиснута
  function syncBioJoin() {
    document.querySelectorAll('[data-biojoin]').forEach(function (b) {
      b.setAttribute('aria-pressed', String((b.dataset.biojoin === '1') === !!service.bioJoin));
    });
  }

  // ---------- Коментарі й розмір тексту ----------
  // Поле коментаря розгорнуте, якщо його відкрили кнопкою або в ньому вже є текст
  function syncNotes() {
    [['clientComment', 'clientCommentBox'], ['comment', 'commentBox']].forEach(function (p) {
      var key = p[0];
      var open = state.notes[key] || !!String(state[key] || '').trim();
      UI.setCollapse($(p[1]), open);
      document.querySelector('[data-note="' + key + '"]').hidden = open; // кнопка «+» не потрібна, коли поле відкрите
    });
  }

  // Розмір тексту: CSS-змінна --fs множить усі розміри шрифтів у style.css
  function applyFontScale() {
    document.documentElement.style.setProperty('--fs', String(service.fontScale));
    document.querySelectorAll('[data-font]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.font) === Number(service.fontScale)));
    });
  }

  // ---------- 5–6. Телефон: Україна / Польща, маска «х» ----------
  function phoneCountry() { return state.client.phoneCountry || 'UA'; }

  // Сіра маска під полем: введена частина прозора, решта — «х», тож видно, скільки цифр лишилось
  function updateGhost() {
    var value = $('clientPhone').value;
    var mask = Format.phoneMask(phoneCountry());
    $('phoneTyped').textContent = value;
    $('phoneRest').textContent = value.length < mask.length ? mask.slice(value.length) : '';
  }

  function syncPhone() {
    var country = phoneCountry();
    document.querySelectorAll('[data-country]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.country === country));
    });
    var input = $('clientPhone');
    var formatted = Format.phoneFormat(state.client.phone, country);
    // Під час введення лишаємо хоча б код країни, щоб маска не зникала
    input.value = formatted || (document.activeElement === input ? Format.phonePrefix(country) : '');
    updateGhost();
    updatePhoneHint(document.activeElement !== input);
  }

  function bindPhone() {
    var input = $('clientPhone');

    // Перемикання країни: цифри лишаються, змінюються код і групування
    document.querySelectorAll('[data-country]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.client.phoneCountry = b.dataset.country;
        state.client.phone = Format.phoneLocal(state.client.phone, b.dataset.country);
        haptic('select');
        syncPhone();
        saveDraft();
      });
    });

    // Фокус у порожньому полі — одразу підставляємо код країни
    input.addEventListener('focus', function () {
      if (!input.value) input.value = Format.phonePrefix(phoneCountry());
      updateGhost();
    });

    // Вставлений номер (з буфера або підказки iOS) замінює поле повністю.
    // Якщо в ньому є код іншої країни (+48… / +380…) — перемикаємо країну автоматично
    function applyWholeNumber(text) {
      var detected = Format.phoneDetect(text);
      if (detected) state.client.phoneCountry = detected;
      document.querySelectorAll('[data-country]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.country === phoneCountry()));
      });
      input.value = text;
    }

    input.addEventListener('paste', function (e) {
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (String(text).replace(/\D/g, '').length < 9) return; // шматок номера — вставляємо як звичайно
      e.preventDefault();
      applyWholeNumber(text);
      input.dispatchEvent(new Event('input')); // далі — звичайне форматування
    });

    input.addEventListener('input', function (e) {
      // Підказка клавіатури iOS вставляє номер одним шматком — обробляємо як вставку
      if (e && e.data && e.data.replace(/\D/g, '').length >= 9) applyWholeNumber(e.data);
      var country = phoneCountry();
      var prefix = Format.phonePrefix(country);

      // Скільки цифр номера стоїть перед курсором — щоб після форматування курсор не стрибав у кінець
      var caret = input.selectionStart === null ? input.value.length : input.selectionStart;
      var digitsBefore = Format.phoneLocal(input.value.slice(0, caret), country).length;

      input.value = Format.phoneFormat(input.value, country) || prefix; // зайві цифри й символи відкидаються

      var pos = prefix.length, seen = 0;
      while (pos < input.value.length && seen < digitsBefore) {
        if (/\d/.test(input.value.charAt(pos))) seen++;
        pos++;
      }
      input.setSelectionRange(pos, pos);

      state.client.phone = Format.phoneLocal(input.value, country);
      updateGhost();
      updatePhoneHint(false);
      saveDraft();
    });

    // Виходимо з поля: порожній код прибираємо, неповний номер підсвічуємо
    input.addEventListener('blur', function () {
      if (!Format.phoneLocal(input.value, phoneCountry())) input.value = '';
      updateGhost();
      updatePhoneHint(true);
    });
  }

  // Підказка «номер неповний» — лише після виходу з поля, щоб не заважати під час введення
  function updatePhoneHint(onBlur) {
    var country = phoneCountry();
    var n = Format.phoneLocal($('clientPhone').value, country).length;
    var incomplete = n > 0 && !Format.phoneComplete($('clientPhone').value, country);
    if (!incomplete) {
      $('phoneHint').hidden = true;
      $('clientPhone').classList.remove('is-invalid');
    } else if (onBlur) {
      $('phoneHint').textContent = 'Номер неповний: потрібно 9 цифр після ' + Format.phonePrefix(country).trim();
      $('phoneHint').hidden = false;
      $('clientPhone').classList.add('is-invalid');
    }
  }

  // ---------- 7. Клавіатура ----------
  // Прокручуємо ЛИШЕ тоді, коли поле справді сховане клавіатурою, і рівно настільки,
  // щоб воно стало на 12 px вище неї. Поле, яке й так видно, не чіпаємо.
  function bindKeyboard() {
    var focused = null;
    var timer = null;
    var userTouching = false;

    // Текстові поля й коментарі; випадні списки не чіпаємо — у них своє вікно вибору
    function isTyping(el) {
      return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox'));
    }

    // Нижній край видимої області. Якщо розмір невідомий — повертаємо null і нічого не робимо
    function visibleBottom() {
      var vv = window.visualViewport;
      return vv ? vv.offsetTop + vv.height : null;
    }

    function check() {
      if (!focused || userTouching) return;
      var bottom = visibleBottom();
      if (bottom === null) return;
      var overlap = focused.getBoundingClientRect().bottom - (bottom - 12);
      if (overlap > 0) window.scrollBy(0, overlap); // без анімації: не сперечаємось із прокруткою iOS
    }

    // Перевіряємо із затримкою — після того, як iOS сам завершить свою прокрутку
    function schedule(ms) {
      clearTimeout(timer);
      timer = setTimeout(check, ms);
    }

    document.addEventListener('focusin', function (e) {
      if (!isTyping(e.target)) return;
      focused = e.target;
      document.body.classList.add('typing'); // ховаємо нижню панель: над клавіатурою вона закривала поля
      schedule(400);
    });

    document.addEventListener('focusout', function () {
      // Перехід між полями: спершу focusout, потім focusin — перевіряємо з маленькою затримкою
      setTimeout(function () {
        if (isTyping(document.activeElement)) return;
        focused = null;
        document.body.classList.remove('typing');
      }, 60);
    });

    // Клавіатура відкрилась або змінила висоту — перевіряємо ще раз
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { if (focused) schedule(150); });
    }

    // Цифрова клавіатура iOS не має кнопки «Готово»: ховаємо її дотиком поза полем (але не під час прокрутки)
    var touchX = 0, touchY = 0;
    document.addEventListener('touchstart', function (e) {
      userTouching = true; // палець на екрані — не втручаємось у прокрутку
      clearTimeout(timer);
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      userTouching = false;
      if (!focused) return;
      var t = e.changedTouches[0];
      var moved = Math.abs(t.clientX - touchX) > 10 || Math.abs(t.clientY - touchY) > 10;
      var onField = e.target.closest && e.target.closest('input, textarea, select, label, button');
      if (!moved && !onField) focused.blur();
    }, { passive: true });
  }

  // ---------- Масштаб: щипок так, подвійне натискання ні; поворот без зуму (D45, D52) ----------
  var VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';

  /*
   * 3. Подвійне натискання. CSS touch-action: manipulation у WebView Telegram на iOS спрацьовує не завжди
   * (на «+/−» рівнів екран збільшувався). Тому другий швидкий дотик у тому самому місці гасимо самі:
   * preventDefault на touchend забороняє зум, а натискання кнопки повторюємо вручну — «+» рахується двічі.
   * Щипок (два пальці) не чіпаємо; у полях введення подвійний дотик лишається (виділення слова).
   */
  function bindDoubleTapGuard() {
    var last = 0, lx = 0, ly = 0;
    document.addEventListener('touchend', function (e) {
      if (e.touches.length || e.changedTouches.length !== 1) return;   // щипок або кілька пальців
      var t = e.changedTouches[0], now = Date.now();
      var quick = now - last < 350 && Math.abs(t.clientX - lx) < 30 && Math.abs(t.clientY - ly) < 30;
      last = now; lx = t.clientX; ly = t.clientY;
      if (!quick || !e.target.closest || e.target.closest('input, textarea, select')) return;
      e.preventDefault();                                              // без зуму
      var el = e.target.closest('button, label, [data-point]');
      if (el && !el.disabled) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      last = 0;                                                        // третій дотик — знову «перший»
    }, { passive: false });
  }

  /*
   * 8. Поворот телефона. З дозволеним щипком iOS після повороту «зберігає видиму ширину» і збільшує
   * всю сторінку приблизно вдвічі. На час повороту тимчасово ставимо maximum-scale=1 — масштаб
   * повертається до 1, а через 0,7 с після останньої зміни розміру щипок знову дозволено.
   */
  var zoomTimer = null;
  function lockZoomDuringRotation() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    meta.setAttribute('content', VIEWPORT + ', maximum-scale=1');
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(function () { meta.setAttribute('content', VIEWPORT); }, 700);
  }

  function bindRotation() {
    var lastW = window.innerWidth;
    window.addEventListener('orientationchange', lockZoomDuringRotation);
    window.addEventListener('resize', function () {
      // ширина змінилась суттєво — це поворот (клавіатура змінює лише висоту)
      if (Math.abs(window.innerWidth - lastW) > 80) lockZoomDuringRotation();
      lastW = window.innerWidth;
    });
  }

  function showError(text) {
    var box = $('loadError');
    box.textContent = text;
    box.hidden = false;
  }

  // ---------- Запуск ----------
  function init() {
    bindDoubleTapGuard();
    bindRotation();
    setupTelegram();
    Api.loadCatalog().then(function (cat) {
      catalog = cat;
      buildForm();
      restoreDraft();
      validateIds();
      applyTheme();                                      // тема з чернетки (у <head> — те саме, до першого малювання)
      syncForm();
      bindEvents();
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
