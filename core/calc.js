/*
 * core/calc.js — ядро розрахунку кошторису Aquaprud.
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

  // ---------- Сходинки (A2.1): модуль core/stairs.js підключається необов'язково ----------
  // У браузері й Apps Script Stairs — глобальна змінна; у Node.js — Calc.useStairs(require('./stairs.js'))
  var stairsModule = null;
  function useStairs(mod) { stairsModule = mod; }
  function getStairs() { return stairsModule || (typeof Stairs !== 'undefined' ? Stairs : null); }

  // Один і той самий розрахунок сходинок потрібен кілька разів за перерахунок — запам'ятовуємо останній
  var stairsMemo = { key: null, value: null };
  function evaluateSteps(inp, s, L, W, D) {
    var St = getStairs();
    if (!St || !inp.steps || !inp.steps.length) return null;
    var key = JSON.stringify([inp.shape, L, W, D, !!inp.fish, inp.steps, s]);
    if (stairsMemo.key !== key) {
      stairsMemo = { key: key, value: St.evaluate({ shape: inp.shape, L: L, W: W, D: D, fish: !!inp.fish, steps: inp.steps }, s) };
    }
    return stairsMemo.value;
  }

  // ---------- Укіс стінок (v0.7.0): core/slope.js + контур ставка з core/pondgeo.js, теж необов'язково ----------
  // Без них укіс не враховується (об'єм — як для вертикальних стінок). У Node.js — Calc.useSlope(Slope, PondGeo)
  var slopeModule = null, geoModule = null;
  function useSlope(sl, geo) { slopeModule = sl; geoModule = geo; }
  function getSlope() { return slopeModule || (typeof Slope !== 'undefined' ? Slope : null); }
  function getGeo() { return geoModule || (typeof PondGeo !== 'undefined' ? PondGeo : null); }

  // Поле глибин з укосом: рахуємо, лише коли змінились форма, розміри, укіс або сходинки
  var slopeMemo = { key: null, value: null };
  function evaluateSlope(inp, L, W, D, m, steps) {
    var Sl = getSlope(), G = getGeo(), St = getStairs();
    if (!Sl || !G || !(m > 0)) return null;
    var key = JSON.stringify([inp.shape, L, W, D, m, steps ? stairsMemo.key : null]);
    if (slopeMemo.key === key) return slopeMemo.value;
    // Сходинки в координатах плану — ті самі многокутники, що й у 3D (кільце — з діркою)
    var levels = [];
    if (steps && steps.available && St) {
      steps.layers.forEach(function (l) {
        if (!l.valid) return;
        l.parts.forEach(function (part) {
          var rings = part.rings.map(function (r) { return r.map(function (p) { return St.toPlan(p, l.pond); }); });
          levels.push({ poly: rings[0], holes: rings.slice(1), depth: l.depth });
        });
      });
    }
    var f = Sl.field({ outline: G.outline(inp.shape, L, W), D: D, m: m, levels: levels });
    var c = Sl.correction(f);
    slopeMemo = { key: key, value: { field: f, C: c.C, area: c.area, maxDepth: c.maxDepth } };
    return slopeMemo.value;
  }

  // Мінімальна перевірка: без трьох розмірів рахувати нічого
  function isValidInputs(inp) {
    return num(inp.L) > 0 && num(inp.W) > 0 && num(inp.D) > 0;
  }

  /*
   * Біоплато (v0.7.1). inp.bio — перемикач; inp.bios — [{ side, w }] у порядку номерів (Bio-1 … Bio-4).
   * side — 'right' | 'bottom' | 'left' | 'top'; довжина = сторона габариту ставка (праворуч / ліворуч — W, згори / знизу — L).
   * Ділянки без ширини (порожнє поле) не враховуються. Стик — лише між суміжними сторонами (не навпроти):
   * площа w₁·w₂; для плівки він приєднується до Bio з меншим номером (filmLen = len + ширина сусіда).
   */
  var BIO_SIDES = ['right', 'bottom', 'left', 'top'];
  function bioLayout(inp, L, W) {
    var plates = [], joints = [], area = 0, jointArea = 0;
    if (!inp || !inp.bio || !Array.isArray(inp.bios)) return { plates: plates, joints: joints, area: 0, jointArea: 0 };
    var used = {};
    inp.bios.forEach(function (b, i) {
      if (!b || BIO_SIDES.indexOf(b.side) === -1 || used[b.side]) return;   // одна сторона — одне Bio
      var w = num(b.w), len = (b.side === 'right' || b.side === 'left') ? W : L;
      if (!(w > 0) || !(len > 0)) return;
      used[b.side] = true;
      plates.push({ n: i + 1, side: b.side, len: len, w: w, area: len * w, filmLen: len });
    });
    plates.forEach(function (p) { area += p.area; });
    // Суміжні сторони — сусіди в циклі праворуч → знизу → ліворуч → зверху
    for (var i = 0; i < plates.length; i++) {
      for (var j = i + 1; j < plates.length; j++) {
        var a = plates[i], b = plates[j], d = Math.abs(BIO_SIDES.indexOf(a.side) - BIO_SIDES.indexOf(b.side));
        if (d !== 1 && d !== 3) continue;
        var ja = a.w * b.w, lo = a.n < b.n ? a : b, hi = lo === a ? b : a;
        joints.push({ a: lo.n, b: hi.n, sides: [lo.side, hi.side], area: ja });
        lo.filmLen += hi.w;
        jointArea += ja;
      }
    }
    return { plates: plates, joints: joints, area: area + jointArea, jointArea: jointArea };
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

    // Об'єм (v0.7.0, stairs_math §10.1): V₀ = S_глиб·D + Σ S_vis·h — як для вертикальних стінок (D35);
    // укіс 1 : m (службова панель, D61) віднімає «зрізаний» похилими стінками об'єм C. Підйоми сходинок — вертикальні.
    // depth_profile_k більше не використовується: нахил тепер задається явно (D63).
    // Шари з помилкою в об'єм не входять (помилка блокує збереження)
    var steps = evaluateSteps(inp, s, L, W, D);
    var Svis = 0, Vsteps = 0;
    if (steps && steps.available) {
      steps.layers.forEach(function (l) { if (l.valid) { Svis += l.visible; Vsteps += l.visible * l.depth; } });
    }
    var Sdeep = Math.max(0, S - Svis);
    var slopeM = Math.max(0, num(inp.slope_m));
    var sl = evaluateSlope(inp, L, W, D, slopeM, steps);
    // C рахується на контурі схеми; S / area — перехід до площі з розрахунку (овал, нестандартна форма)
    var V = Math.max(0, Sdeep * D + Vsteps - (sl && sl.area > 0 ? sl.C * S / sl.area : 0));

    // Біоплато (v0.7.1): 1–4 ділянки Bio-N, кожна — на всю довжину своєї сторони ставка (габарит L або W),
    // змінна лише ширина (від краю ставка). Суміжні Bio додають «стик» у куті: w₁ × w₂ (bioLayout)
    var bioD = num(s.bio_depth_m);
    var bl = bioLayout(inp, L, W);
    var hasBio = bl.plates.length > 0;
    var Vb = hasBio ? bl.area * bioD : 0;
    var Vtotal = V + Vb;

    // Плівку кроять прямокутником: розмір + 2 глибини + запас на край з кожного боку.
    // З укосом замість D — розгортка стінки D·(√(1+m²) − m) (дно коротше, стінки довші); сходинки плівку не змінюють (D35)
    var Sl = getSlope(), Df = Sl && sl ? Sl.filmDepth(D, slopeM) : D;
    var filmArea = (L + 2 * Df + 2 * margin) * (W + 2 * Df + 2 * margin);
    // Біоплато — окремий шматок на кожне Bio; стик додається до Bio з меншим номером (його довжина + ширина сусіда)
    var bioFilmArea = 0;
    bl.plates.forEach(function (p) { bioFilmArea += (p.filmLen + 2 * bioD + 2 * margin) * (p.w + 2 * bioD + 2 * margin); });

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
      steps: steps, Sdeep: Sdeep, Svis: Svis,
      // Укіс: m, поле глибин (для розрізів і лінії низу укосу на схемі), найбільша глибина з укосом
      slopeM: sl ? slopeM : 0, slope: sl, filmDepth: Df,
      // bioPlates — [{ n, side, len, w, area, filmLen }]; bioJoints — стики [{ a, b, area }]; bioArea — разом зі стиками
      hasBio: hasBio, bioPlates: bl.plates, bioJoints: bl.joints, bioJointArea: bl.jointArea, bioArea: bl.area,
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

    // Укіс завеликий для розмірів: похилі стінки сходяться раніше, ніж котлован досягає глибини D
    if (m.slope && m.slope.maxDepth < m.D - 0.01) {
      warnings.push('Укіс 1 : ' + String(m.slopeM).replace('.', ',') + ' завеликий для цих розмірів: дно не досягає глибини ' +
        String(m.D).replace('.', ',') + ' м (найглибше — ' + (Math.round(m.slope.maxDepth * 100) / 100).toString().replace('.', ',') + ' м)');
    }

    // Сходинки: помилки (E…) і попередження (W…) з номером сходинки
    if (m.steps) {
      m.steps.errors.concat(m.steps.warnings).forEach(function (e) {
        warnings.push((e.step ? 'Сходинка ' + e.step + ': ' : 'Сходинки: ') + e.text);
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
        name: 'Монтажні роботи', // без відсотка: назву бачить клієнт (відсоток — у службовій панелі)
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
    recommend: recommend, buildEstimate: buildEstimate, GROUPS: GROUPS, useStairs: useStairs, useSlope: useSlope,
    bioLayout: bioLayout, BIO_SIDES: BIO_SIDES
  };
})();

// Експорт для Node.js; у браузері й Apps Script змінної module немає — рядок пропускається
if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
