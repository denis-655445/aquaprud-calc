/*
 * tests/calc.tests.js — контрактні тести ядра.
 * Ті самі тести запускаються в браузері (tests.html) і в Node.js (run-node.js),
 * тому гарантують однаковий результат на всіх платформах (project_status.md §12).
 */
var CalcTests = (function () {
  'use strict';

  // Власний маленький каталог для тестів: цифри підібрані так, щоб результат рахувався вручну
  var FIXTURE = {
    settings: {
      shape_k_oval: 0.785, shape_k_custom: 0.85, depth_profile_k: 1, film_margin_m: 0.5, bio_depth_m: 0.3,
      turnover_no_fish: 1, turnover_fish: 1, area_per_skimmer_m2: 10, area_per_drain_m2: 10,
      drain_min_area_m2: 100, pipe_reserve_m: 0, lift_height_default_m: 0,
      head_loss_per_m: 0, head_loss_per_elbow: 0, elbows_on_pressure_line: 0, filter_head_loss_m: 0,
      excavation_k: 1, labor_pct: 100, labor_base: 'materials', markup_pct: 0, currency: 'грн'
    },
    items: [
      { id: 'FLT-A', category: 'filter', name: 'Фільтр A', unit: 'шт', price: 1000, maxV_nofish: 5, maxV_fish: 2, pump_kit: 'PMP-A', group: 'Обладнання' },
      { id: 'FLT-B', category: 'filter', name: 'Фільтр B', unit: 'шт', price: 3000, maxV_nofish: 20, maxV_fish: 10, pump_kit: 'PMP-A', group: 'Обладнання' },
      { id: 'PMP-A', category: 'pump', name: 'Насос A', unit: 'шт', price: 700, q_max: 5000, h_max: 2, group: 'Обладнання' },
      { id: 'PMP-B', category: 'pump', name: 'Насос B', unit: 'шт', price: 2000, q_max: 12000, h_max: 6, group: 'Обладнання' },
      { id: 'SKM', category: 'skimmer', name: 'Скіммер', unit: 'шт', price: 300, group: 'Обладнання' },
      { id: 'FLM', category: 'film', name: 'Плівка', unit: 'м²', price: 10, group: 'Матеріали' },
      { id: 'PIPE', category: 'pipe', name: 'Труба', unit: 'м', price: 20, base: 'pipe_len', k: 1, group: 'Матеріали' },
      { id: 'FIT', category: 'fitting', name: 'Коліно', unit: 'шт', price: 5, base: 'per_line', k: 2, group: 'Матеріали' },
      { id: 'OFF', category: 'fitting', name: 'Вимкнена позиція', unit: 'шт', price: 999, base: 'fixed', k: 1, group: 'Матеріали', active: 'ні' }
    ]
  };

  // Базовий ставок 2 × 2 × 1 м без риби, фільтр за 5 м від ставка
  var POND = { shape: 'rect', L: '2', W: '2', D: '1', fish: false, bio: false, Lb: '', Wb: '', distance: '5', lift: '' };
  var SEL = { filmId: 'FLM', filterId: 'FLT-A', pumpId: 'kit', uvId: 'none', skimmerId: 'SKM', skimmers: 1, drainId: 'none', drains: 0, waterfallId: 'none', lightId: 'none', lights: 0, extras: {} };

  function near(a, b) { return Math.abs(a - b) < 1e-6; }
  function copy(o, patch) { var r = {}, k; for (k in o) r[k] = o[k]; for (k in patch) r[k] = patch[k]; return r; }

  // Кожен тест: [назва, функція, що повертає true / false]. sample — тестовий каталог застосунку (необов'язково)
  function cases(Calc, Format, sample) {
    var s = FIXTURE.settings;
    return [
      ['Площа прямокутника 6×4 = 24', function () {
        return near(Calc.computeMetrics({ shape: 'rect', L: 6, W: 4, D: 1.5 }, s).S, 24);
      }],
      ['Площа овалу 6×4 = 0,785·24 = 18,84', function () {
        return near(Calc.computeMetrics({ shape: 'oval', L: 6, W: 4, D: 1 }, s).S, 18.84);
      }],
      ['Периметр кола d=2 за Рамануджаном = 2π', function () {
        return near(Calc.computeMetrics({ shape: 'oval', L: 2, W: 2, D: 1 }, s).P, 2 * Math.PI);
      }],
      ['Плівка 6×4×1,5, запас 0,5 → (6+3+1)·(4+3+1) = 80 м²', function () {
        return near(Calc.computeMetrics({ shape: 'rect', L: 6, W: 4, D: 1.5 }, s).filmArea, 80);
      }],
      ['Кома як десятковий роздільник: «1,5» = 1.5', function () {
        return Calc.num('1,5') === 1.5;
      }],
      ['Округлення: 2,01 шт → 3; 80,01 м² → 80,1; 3 шт → 3', function () {
        return Calc.roundQty(2.01, 'шт') === 3 && near(Calc.roundQty(80.01, 'м²'), 80.1) && Calc.roundQty(3, 'шт') === 3;
      }],
      ['Потік насоса: Qmax 5000, Hmax 2 при H=1 → 2500; при H≥2 → 0', function () {
        var p = { q_max: 5000, h_max: 2 };
        return near(Calc.pumpFlowAt(p, 1), 2500) && Calc.pumpFlowAt(p, 2) === 0;
      }],
      ['Фільтр: найдешевший, що тягне об\'єм (4 м³ без риби → A; з рибою → B)', function () {
        return Calc.pickByVolume(FIXTURE, 'filter', 4, false).id === 'FLT-A' &&
          Calc.pickByVolume(FIXTURE, 'filter', 4, true).id === 'FLT-B';
      }],
      ['Насос комплекту достатній → «у комплекті»', function () {
        var r = Calc.recommend(POND, FIXTURE, null); // Q=4000 л/год, H=0
        return r.pump.id === 'kit';
      }],
      ['Насос комплекту слабкий при напорі → окремий найдешевший достатній', function () {
        var f = copy(FIXTURE, { settings: copy(s, { lift_height_default_m: 1.5 }) }); // A при 1,5 м дає 1250 л/год
        var r = Calc.recommend(POND, f, null);
        return r.pump.id === 'PMP-B' && r.pump.note !== '';
      }],
      ['Кошторис 2×2×1: обладнання 1300, матеріали 470, роботи 470, разом 2240', function () {
        var t = Calc.buildEstimate(POND, SEL, FIXTURE, {}).totals;
        return t.equipment === 1300 && t.materials === 470 && t.work === 470 && t.total === 2240;
      }],
      ['Вимкнена позиція (активний = ні) не потрапляє в кошторис', function () {
        return Calc.buildEstimate(POND, SEL, FIXTURE, {}).lines.every(function (l) { return l.id !== 'OFF'; });
      }],
      ['Роботи 50% і націнка 10%: 2005 + 201 (200,5 → до цілих) = 2206', function () {
        var t = Calc.buildEstimate(POND, SEL, FIXTURE, { labor_pct: 50, markup_pct: 10 }).totals;
        return t.labor === 235 && t.markup === 201 && t.total === 2206;
      }],
      ['Роботи від матеріалів і обладнання: 100% × (1300+470) → разом 3540', function () {
        var f = copy(FIXTURE, { settings: copy(s, { labor_base: 'materials+equipment' }) });
        var t = Calc.buildEstimate(POND, SEL, f, {}).totals;
        return t.labor === 1770 && t.total === 3540;
      }],
      ['Телефон: різні способи введення → 9 цифр і маска +380 67 123 45 67', function () {
        return Format.phoneLocal('0671234567') === '671234567' &&
          Format.phoneLocal('+38 (067) 123-45-67') === '671234567' &&
          Format.phoneLocal('+380 67 123 45 6789') === '671234567' && // зайві цифри відкидаються
          Format.phoneUA('671234567') === '+380 67 123 45 67' &&
          Format.phoneUA('+380 671') === '+380 67 1';
      }],
      ['Польський номер: «+48 512 345 678», маска і визначення країни', function () {
        return Format.phoneFormat('512345678', 'PL') === '+48 512 345 678' &&
          Format.phoneFormat('+48 5123', 'PL') === '+48 512 3' &&
          Format.phoneMask('PL') === '+48 ххх ххх ххх' && Format.phoneMask('UA') === '+380 хх ххх хх хх' &&
          Format.phoneDetect('+48 512 345 678') === 'PL' && Format.phoneDetect('+380671234567') === 'UA' &&
          Format.phoneDetect('067') === null;
      }],
      ['Текст для клієнта: коментар для клієнта є, «для себе» немає, без % робіт', function () {
        var est = Calc.buildEstimate(POND, SEL, FIXTURE, {});
        var txt = Format.estimateText(est, POND, {
          client: { name: 'Іван', phone: '+380 67 12', phoneCountry: 'UA' }, // неповний номер
          clientComment: 'Монтаж у травні', comment: 'секрет'
        });
        return txt.indexOf('секрет') === -1 && txt.indexOf('Коментар: Монтаж у травні') !== -1 &&
          txt.indexOf('%') === -1 && txt.indexOf('+380') === -1 && txt.indexOf('Монтажні роботи') !== -1;
      }],
      ['Повний польський номер потрапляє в текст', function () {
        var est = Calc.buildEstimate(POND, SEL, FIXTURE, {});
        var txt = Format.estimateText(est, POND, { client: { phone: '512345678', phoneCountry: 'PL' } });
        return txt.indexOf('+48 512 345 678') !== -1;
      }],
      ['Націнка 10% не видна клієнту: входить у «Роботи» (235 + 201 = 436), разом 2206', function () {
        var est = Calc.buildEstimate(POND, SEL, FIXTURE, { labor_pct: 50, markup_pct: 10 });
        var txt = Format.estimateText(est, POND, {});
        var n = Format.NBSP;
        return txt.indexOf('Націнка') === -1 && txt.indexOf('Роботи: 436' + n + 'грн') !== -1 &&
          txt.indexOf('Разом: 2' + n + '206' + n + 'грн') !== -1;
      }],
      ['Знижка 10% показується клієнту окремим рядком', function () {
        var est = Calc.buildEstimate(POND, SEL, FIXTURE, { markup_pct: -10 });
        return Format.estimateText(est, POND, {}).indexOf('Знижка 10%') !== -1;
      }],
      ['Форматування: 1234567,5 → «1 234 567,50 грн»', function () {
        var n = Format.NBSP;
        return Format.money(1234567.5) === '1' + n + '234' + n + '567,50' + n + 'грн';
      }],
      ['Тестовий каталог: для будь-якого ставка до 30 × 10 × 5 м є фільтр, УФ і насос', function () {
        if (!sample) throw new Error('каталог не передано');
        var ok = true;
        [1, 3, 6, 10, 20, 30].forEach(function (L) { [1, 3, 6, 10].forEach(function (W) {
          [0.5, 1.5, 3, 5].forEach(function (D) { [false, true].forEach(function (fish) {
            [0, 30].forEach(function (distance) { ['rect', 'oval', 'custom'].forEach(function (shape) {
              var r = Calc.recommend({ shape: shape, L: L, W: W, D: D, fish: fish, bio: true, Lb: 10, Wb: 5,
                distance: distance, lift: '' }, sample, null);
              if (r.filterId === 'none' || r.uvId === 'none' || r.pump.id === 'none') ok = false;
            }); });
          }); });
        }); });
        return ok;
      }]
    ];
  }

  // Запуск усіх тестів; повертає масив результатів
  function run(Calc, Format, sample) {
    return cases(Calc, Format, sample).map(function (c) {
      var ok = false, error = '';
      try { ok = c[1]() === true; } catch (e) { error = String(e && e.message || e); }
      return { name: c[0], ok: ok, error: error };
    });
  }

  return { run: run, FIXTURE: FIXTURE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CalcTests;
