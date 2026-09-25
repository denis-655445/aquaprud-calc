/*
 * core/calc.js — ядро розрахунку кошторису AquaPrud.
 * Чисті функції: без DOM, без API Telegram і Google.
 * Однаково працює в браузері, Google Apps Script і Node.js (project_status.md §12).
 */
var Calc = (function () {
  'use strict';

  // Категорії, позиції яких додаються автоматично за «базою» (метрикою ставка)
  var AUTO_CATEGORIES = ['geotextile', 'pipe', 'fitting', 'work'];
  // Категорії обладнання — для визначення групи, якщо в прайсі її не вказано
  var EQUIPMENT_CATEGORIES = ['filter', 'uv', 'pump', 'skimmer', 'drain', 'waterfall', 'light', 'extra'];
  var GROUPS = ['Обладнання', 'Матеріали', 'Роботи'];
  var EPS = 1e-9; // захист від похибки дробових чисел (0.1 + 0.2 != 0.3)

  // Перетворює рядок або число на число; кома → крапка (iOS з українською локаллю ставить кому)
  function num(v, fallback) {
    var fb = fallback === undefined ? 0 : fallback;
    if (typeof v === 'number') return isFinite(v) ? v : fb;
    var s = String(v === null || v === undefined ? '' : v).replace(',', '.').trim();
    if (s === '') return fb;
    var n = parseFloat(s);
    return isFinite(n) ? n : fb;
  }

  // Ціле невід'ємне число (кількість штук)
  function count(v) {
    return Math.max(0, Math.round(num(v)));
  }

  // Округлення кількості: штуки й послуги — вгору до цілого, решта — вгору до 0,1
  function roundQty(qty, unit) {
    if (!(qty > 0)) return 0;
    if (unit === 'шт' || unit === 'посл.') return Math.ceil(qty - EPS);
    return Math.ceil(qty * 10 - EPS) / 10;
  }

  // Гроші — до копійок
  function money(x) {
    return Math.round(x * 100) / 100;
  }

  // Позиція активна, якщо в прайсі не стоїть «ні» / false
  function isActive(it) {
    return it.active !== false && it.active !== 'ні';
  }

  function findItem(catalog, id) {
    if (!id || id === 'none' || id === 'kit') return null;
    for (var i = 0; i < catalog.items.length; i++) {
      if (catalog.items[i].id === id) return catalog.items[i];
    }
    return null;
  }

  function activeItems(catalog, category) {
    return catalog.items.filter(function (it) {
      return it.category === category && isActive(it);
    });
  }

  // Найдешевша позиція зі списку (або null, якщо список порожній)
  function cheapest(list) {
    var sorted = list.slice().sort(function (a, b) { return num(a.price) - num(b.price); });
    return sorted.length ? sorted[0] : null;
  }

  // Група кошторису: з прайсу, а якщо там помилка — за категорією
  function groupOf(item) {
    if (GROUPS.indexOf(item.group) !== -1) return item.group;
    if (EQUIPMENT_CATEGORIES.indexOf(item.category) !== -1) return 'Обладнання';
    if (item.category === 'work') return 'Роботи';
    return 'Матеріали';
  }

  // Мінімальна перевірка: без трьох розмірів рахувати нічого
  function isValidInputs(inp) {
    return num(inp.L) > 0 && num(inp.W) > 0 && num(inp.D) > 0;
  }

  // Усі геометричні та гідравлічні метрики ставка (project_status.md §6.2)
  function computeMetrics(inp, s) {
    var L = num(inp.L), W = num(inp.W), D = num(inp.D);
    var margin = num(s.film_margin_m);
    var S, P;

    if (inp.shape === 'oval') {
      S = num(s.shape_k_oval, 0.785) * L * W;
      // Периметр еліпса — наближення Рамануджана, a і b — півосі
      var a = L / 2, b = W / 2;
      P = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    } else if (inp.shape === 'custom') {
      S = num(s.shape_k_custom, 1) * L * W;
      P = 2 * (L + W); // наближено: периметр описаного прямокутника
    } else {
      S = L * W;
      P = 2 * (L + W);
    }

    var V = S * D * num(s.depth_profile_k, 1);

    // Біоплато рахуємо, лише якщо увімкнено і задано обидва розміри
    var bioD = num(s.bio_depth_m);
    var Lb = num(inp.Lb), Wb = num(inp.Wb);
    var hasBio = !!inp.bio && Lb > 0 && Wb > 0;
    var Vb = hasBio ? Lb * Wb * bioD : 0;
    var Vtotal = V + Vb;

    // Плівку кроять прямокутником: розмір + 2 глибини + запас на край з кожного боку
    var filmArea = (L + 2 * D + 2 * margin) * (W + 2 * D + 2 * margin);
    var bioFilmArea = hasBio ? (Lb + 2 * bioD + 2 * margin) * (Wb + 2 * bioD + 2 * margin) : 0;

    // Потрібний потік: обертів об'єму за годину × об'єм, м³ → л
    var turnover = inp.fish ? num(s.turnover_fish) : num(s.turnover_no_fish);
    var Qreq = Vtotal * turnover * 1000;

    // Потрібний напір: підйом + втрати в напірній трубі, колінах і фільтрі (D14)
    var distance = num(inp.distance);
    var lift = num(inp.lift, num(s.lift_height_default_m));
    var Lpress = 2 * distance; // туди й назад — заглушка, уточнити з майстром
    var Hreq = lift + Lpress * num(s.head_loss_per_m) +
      num(s.elbows_on_pressure_line) * num(s.head_loss_per_elbow) + num(s.filter_head_loss_m);

    // Рекомендована кількість скіммерів і донних зливів
    var areaSk = num(s.area_per_skimmer_m2) || 10;
    var areaDr = num(s.area_per_drain_m2) || 10;
    var recSkimmers = S > 0 ? Math.max(1, Math.ceil(S / areaSk - EPS)) : 0;
    var recDrains = (S <= 0 || S < num(s.drain_min_area_m2)) ? 0 : Math.ceil(S / areaDr - EPS);

    return {
      L: L, W: W, D: D, S: S, P: P, V: V, Vb: Vb, Vtotal: Vtotal,
      hasBio: hasBio, Lb: Lb, Wb: Wb,
      filmArea: filmArea, bioFilmArea: bioFilmArea, filmAreaTotal: filmArea + bioFilmArea,
      excavation: Vtotal * num(s.excavation_k, 1),
      Qreq: Qreq, Hreq: Hreq, lift: lift, distance: distance,
      recSkimmers: recSkimmers, recDrains: recDrains
    };
  }

  // Найдешевший фільтр або УФ, розрахований на об'єм ставка (з рибою / без)
  function pickByVolume(catalog, category, Vtotal, fish) {
    var key = fish ? 'maxV_fish' : 'maxV_nofish';
    return cheapest(activeItems(catalog, category).filter(function (it) {
      return num(it[key]) >= Vtotal - EPS;
    }));
  }

  // Чи розрахована позиція на такий об'єм (для попередження при ручному виборі)
  function fitsVolume(item, Vtotal, fish) {
    return num(item[fish ? 'maxV_fish' : 'maxV_nofish']) >= Vtotal - EPS;
  }

  // Потік насоса при заданому напорі: лінійне наближення Q(H) = Qmax · (1 − H/Hmax)
  function pumpFlowAt(pump, H) {
    if (!pump) return 0;
    var qMax = num(pump.q_max), hMax = num(pump.h_max);
    if (hMax <= 0 || H >= hMax) return 0;
    return qMax * (1 - H / hMax);
  }

  // Підбір насоса (§6.4): спершу насос комплекту фільтра, інакше найдешевший достатній
  function recommendPump(catalog, filter, Qreq, Hreq) {
    var kit = filter && filter.pump_kit ? findItem(catalog, filter.pump_kit) : null;
    var kitFlow = kit ? pumpFlowAt(kit, Hreq) : 0;
    if (kit && kitFlow >= Qreq - EPS) {
      return { id: 'kit', kit: kit, kitFlow: kitFlow, note: '' };
    }
    var best = cheapest(activeItems(catalog, 'pump').filter(function (p) {
      return pumpFlowAt(p, Hreq) >= Qreq - EPS;
    }));
    if (best) {
      return { id: best.id, kit: kit, kitFlow: kitFlow, note: kit ? 'Насос комплекту недостатній' : '' };
    }
    return { id: 'none', kit: kit, kitFlow: kitFlow, note: 'Жоден насос не дає потрібного потоку при такому напорі' };
  }

  // Рекомендації для блоку «Обладнання». chosenFilterId — фільтр, вибраний вручну (або null)
  function recommend(inp, catalog, chosenFilterId) {
    var m = computeMetrics(inp, catalog.settings);
    var filter = pickByVolume(catalog, 'filter', m.Vtotal, inp.fish);
    var uv = pickByVolume(catalog, 'uv', m.Vtotal, inp.fish);
    // Насос підбираємо під фактичний фільтр: вручну вибраний має пріоритет
    var actualFilter = chosenFilterId ? findItem(catalog, chosenFilterId) : filter;
    var skimmer = cheapest(activeItems(catalog, 'skimmer'));
    var drain = cheapest(activeItems(catalog, 'drain'));
    return {
      metrics: m,
      filterId: filter ? filter.id : 'none',
      uvId: uv ? uv.id : 'none',
      pump: recommendPump(catalog, actualFilter, m.Qreq, m.Hreq),
      skimmerId: skimmer ? skimmer.id : 'none',
      drainId: drain ? drain.id : 'none',
      skimmers: m.recSkimmers,
      drains: m.recDrains
    };
  }

  /*
   * Повний кошторис. sel — остаточний вибір (авто або вручну):
   * { filmId, filterId, pumpId ('kit' | id | 'none'), uvId, skimmerId, skimmers,
   *   drainId, drains, waterfallId, lightId, lights, extras: { id: qty } }
   * opts — службова панель: { labor_pct, markup_pct }
   */
  function buildEstimate(inp, sel, catalog, opts) {
    var s = catalog.settings;
    var o = opts || {};
    var m = computeMetrics(inp, s);
    var lines = [];
    var warnings = [];

    // Додає рядок кошторису з округленою кількістю
    function add(item, qty, suffix) {
      var q = roundQty(qty, item.unit);
      if (q <= 0) return;
      var price = num(item.price);
      lines.push({
        id: item.id, name: item.name + (suffix || ''), unit: item.unit,
        qty: q, price: price, sum: money(q * price), group: groupOf(item)
      });
    }

    // Фільтр
    var filter = findItem(catalog, sel.filterId);
    if (filter) {
      add(filter, 1);
      if (!fitsVolume(filter, m.Vtotal, inp.fish)) warnings.push('Обраний фільтр розрахований на менший об\'єм ставка');
    } else {
      warnings.push('Фільтр не вибрано');
    }

    // Насос: «у комплекті» — рядок з нульовою ціною, щоб клієнт бачив, що насос є
    if (sel.pumpId === 'kit') {
      var kit = filter && filter.pump_kit ? findItem(catalog, filter.pump_kit) : null;
      if (kit) {
        lines.push({ id: kit.id, name: kit.name + ' (у комплекті з фільтром)', unit: 'шт', qty: 1, price: 0, sum: 0, group: 'Обладнання' });
        if (pumpFlowAt(kit, m.Hreq) < m.Qreq - EPS) warnings.push('Насос комплекту не дає потрібного потоку при такому напорі');
      } else {
        warnings.push('В обраного фільтра немає насоса в комплекті — виберіть насос');
      }
    } else {
      var pump = findItem(catalog, sel.pumpId);
      if (pump) {
        add(pump, 1);
        if (pumpFlowAt(pump, m.Hreq) < m.Qreq - EPS) warnings.push('Обраний насос не дає потрібного потоку при такому напорі');
      } else {
        warnings.push('Насос не вибрано');
      }
    }

    // УФ-стерилізатор (необов'язковий)
    var uv = findItem(catalog, sel.uvId);
    if (uv) {
      add(uv, 1);
      if (!fitsVolume(uv, m.Vtotal, inp.fish)) warnings.push('Обраний УФ розрахований на менший об\'єм ставка');
    }

    // Скіммери й донні зливи — кількість з UI (авто або вручну)
    var skimmers = count(sel.skimmers);
    var drains = count(sel.drains);
    var skimmer = findItem(catalog, sel.skimmerId);
    var drain = findItem(catalog, sel.drainId);
    if (skimmer && skimmers > 0) add(skimmer, skimmers);
    if (drain && drains > 0) add(drain, drains);

    // Декор
    var waterfall = findItem(catalog, sel.waterfallId);
    if (waterfall) add(waterfall, 1);
    var light = findItem(catalog, sel.lightId);
    if (light && count(sel.lights) > 0) add(light, count(sel.lights));
    var extras = sel.extras || {};
    Object.keys(extras).forEach(function (id) {
      var it = findItem(catalog, id);
      if (it && count(extras[id]) > 0) add(it, count(extras[id]));
    });

    // Плівка — на ставок і біоплато разом
    var film = findItem(catalog, sel.filmId);
    if (film) add(film, m.filmAreaTotal);
    else warnings.push('Плівку не вибрано');

    // Метрики, від яких рахуються автопозиції (§6.3)
    var nLines = skimmers + drains + 1; // + лінія повернення — заглушка
    var pipeLen = nLines * (m.distance + num(s.pipe_reserve_m));
    var baseValues = {
      pond_area: m.S, perimeter: m.P, volume: m.Vtotal,
      film_area: m.filmArea, bio_film_area: m.bioFilmArea, film_area_total: m.filmAreaTotal,
      pipe_len: pipeLen, excavation: m.excavation,
      per_skimmer: skimmers, per_drain: drains, per_line: nLines, fixed: 1
    };

    catalog.items.forEach(function (it) {
      if (!isActive(it) || AUTO_CATEGORIES.indexOf(it.category) === -1 || !it.base) return;
      var baseVal = baseValues[it.base];
      if (baseVal === undefined) {
        warnings.push('Невідома база «' + it.base + '» у позиції ' + it.id);
        return;
      }
      add(it, baseVal * num(it.k, 1));
    });

    // Суми за групами
    var sums = { 'Обладнання': 0, 'Матеріали': 0, 'Роботи': 0 };
    lines.forEach(function (l) { sums[l.group] += l.sum; });

    // Монтажні роботи — відсоток від матеріалів (або матеріалів + обладнання, §11)
    var laborPct = num(o.labor_pct, num(s.labor_pct, 100));
    var withEquipment = s.labor_base === 'materials+equipment';
    var laborBase = sums['Матеріали'] + (withEquipment ? sums['Обладнання'] : 0);
    var labor = Math.round(laborBase * laborPct / 100); // до цілих гривень
    if (labor > 0) {
      lines.push({
        id: 'LABOR',
        name: 'Монтажні роботи (' + laborPct + '% від ' + (withEquipment ? 'матеріалів і обладнання' : 'матеріалів') + ')',
        unit: 'посл.', qty: 1, price: labor, sum: labor, group: 'Роботи',
        base: money(laborBase) // сума, від якої рахується відсоток
      });
      sums['Роботи'] += labor;
    }

    // Націнка / знижка і підсумок
    var subtotal = money(sums['Обладнання'] + sums['Матеріали'] + sums['Роботи']);
    var markupPct = num(o.markup_pct, num(s.markup_pct, 0));
    var markup = Math.round(subtotal * markupPct / 100); // до цілих гривень

    return {
      metrics: m, nLines: nLines, pipeLen: pipeLen,
      lines: lines, warnings: warnings,
      totals: {
        equipment: money(sums['Обладнання']), materials: money(sums['Матеріали']), work: money(sums['Роботи']),
        labor_pct: laborPct, labor: labor, labor_with_equipment: withEquipment,
        markup_pct: markupPct, markup: markup, subtotal: subtotal, total: money(subtotal + markup)
      }
    };
  }

  // Публічний інтерфейс ядра
  return {
    num: num, count: count, roundQty: roundQty, money: money,
    isActive: isActive, findItem: findItem, activeItems: activeItems,
    isValidInputs: isValidInputs, computeMetrics: computeMetrics,
    pickByVolume: pickByVolume, pumpFlowAt: pumpFlowAt, recommendPump: recommendPump,
    recommend: recommend, buildEstimate: buildEstimate, GROUPS: GROUPS
  };
})();

// Експорт для Node.js; у браузері й Apps Script змінної module немає — рядок пропускається
if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
