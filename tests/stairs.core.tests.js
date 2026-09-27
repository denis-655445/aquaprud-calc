/*
 * tests/stairs.core.tests.js — контрактні тести core/stairs.js (етап A2.1).
 * T1–T11 — ті самі числа, що в stairs_math §14 (перевірені еталоном tests/stairs_ref.js);
 * S1–S12 — нове в ядрі: платформа округла, «Прямокутник від кута», глибини, об'єм, перевірки, W > L.
 * Запуск: tests.html (браузер) і run-node.js (Node.js).
 */
var StairsTests = (function () {
  'use strict';

  function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.005 : tol); }
  function has(list, code) { return list.indexOf(code) !== -1; }
  function codes(list) { return list.map(function (e) { return e.code; }); }

  // Налаштування для тестів — як у stairs_math §15
  var SET = { shelf_width_min_m: 0.3, deep_share_min_fish: 0.5, deep_share_min_nofish: 0.33, depth_min_fish_m: 1.2,
              depth_min_nofish_m: 0.7, arc_tolerance_m: 0.01, raster_cell_m: 0.01, platform_arc_k: 0.1, depth_profile_k: 1 };

  function cases(St, Calc) {
    var r8 = St.buildRect(6, 3, 8), r6 = St.buildRect(6, 3, 6);
    // Приклад E1 (§13): дві прямі полиці на 20 і 45 см
    var E1 = { shape: 'rect', L: 6, W: 3, D: 1.5, fish: true, steps: [
      { type: 'shelf', edge: 'straight', points: [1, 2, 3], wc: 0.5, depth_cm: 20 },
      { type: 'shelf', edge: 'straight', points: [4, 7, 1], wc: 0.4, depth_cm: 45 }] };

    var list = [
      ['T1 Полиця #1 #2 #3, w_c 0,5 — площа 3,000', function () {
        return near(St.shelf(r8, { points: [1, 2, 3], edge: 'straight', wc: 0.5 }).parts[0].area, 3.0);
      }],
      ['T2 Видима площа шару 2 (перекриття 0,2 м²) — 1,000', function () {
        var a = St.shelf(r8, { points: [1, 2, 3], edge: 'straight', wc: 0.5 }).parts[0];
        var b = St.shelf(r8, { points: [4, 7, 1], edge: 'straight', wc: 0.4 }).parts[0];
        var vis = St.visibleAreas(r8, [{ h: 0.2, rings: [a.poly], area: a.area }, { h: 0.45, rings: [b.poly], area: b.area }], 0.01);
        return near(vis[0], 3.0) && near(vis[1], 1.0);
      }],
      ['T3 Коло ⌀3, округла полиця — R 1,625, площа 1,366', function () {
        var p = St.shelf(St.buildOval(3, 3, 8), { points: [4, 8, 1, 5, 2], edge: 'round', wc: 0.5 }).parts[0];
        return near(p.C.r, 1.625) && near(p.area, 1.366);
      }],
      ['T4 Овал 6×3, округла полиця — R 5,000, площа 2,980', function () {
        var p = St.shelf(St.buildOval(6, 3, 8), { points: [1, 5, 2, 6, 3], edge: 'round', wc: 0.5 }).parts[0];
        return near(p.C.r, 5.0) && near(p.area, 2.980);
      }],
      ['T5 Опукла на прямій стінці — R 7,8, площа 2,419', function () {
        var p = St.shelf(r6, { points: [1, 2, 3], edge: 'round', wc: 0.6, we: 0 }).parts[0];
        return near(p.C.r, 7.8) && near(p.area, 2.419) && p.kind === 'опукла';
      }],
      ['T6 Увігнута, прямі — площа 3,600', function () {
        var p = St.shelf(r6, { points: [1, 2, 3], edge: 'straight', wc: 0.3, we: 0.9 }).parts[0];
        return near(p.area, 3.6) && p.kind === 'увігнута';
      }],
      ['T7 L-полиця округла — помилка E3', function () {
        return has(St.shelf(r6, { points: [6, 5, 4, 1], edge: 'round', wc: 0.5 }).errors, 'E3');
      }],
      ['T8 Платформа #1 #4 — правило A, 6,000', function () {
        var p = St.platform(r6, { points: [1, 4], edge: 'straight' }).parts[0];
        return near(p.area, 6.0) && p.rule === 'A';
      }],
      ['T9 Платформа #1 #2 #4 — правило B, 4,500', function () {
        var p = St.platform(r6, { points: [1, 2, 4], edge: 'straight' }).parts[0];
        return near(p.area, 4.5) && p.rule === 'B';
      }],
      ['T10 Прогони #2 #5 (6 т.) — дві частини', function () {
        var t = St.runs(r6, [2, 5]);
        return Array.isArray(t) && t.length === 2;
      }],
      ['T11 Полиця w_c 3,5 на ставку 6×3 — помилка E9', function () {
        return has(St.shelf(r6, { points: [1, 2, 3], edge: 'straight', wc: 3.5 }).errors, 'E9');
      }],
      ['S1 Округла платформа #1 #4 — 5,395; многокутник з дугою має ту саму площу', function () {
        var p = St.platform(r6, { points: [1, 4], edge: 'round', arcK: 0.1 }).parts[0];
        return near(p.area, 5.395) && near(St.area(p.poly), p.area, 0.01) && near(p.R, 3.9);
      }],
      ['S2 Прямокутник від кута #3, 2 × 1 м — площа 2, у правому верхньому куті', function () {
        var p = St.cornerRect(r6, { points: [3], a: 2, b: 1 }).parts[0];
        var xs = p.poly.map(function (q) { return q[0]; }), ys = p.poly.map(function (q) { return q[1]; });
        return near(p.area, 2) && Math.min.apply(null, xs) === 4 && Math.max.apply(null, xs) === 6 &&
          Math.min.apply(null, ys) === 0 && Math.max.apply(null, ys) === 1 && St.signedArea(p.poly) > 0;
      }],
      ['S3 «Від кута»: більший за ставок — E11; на овалі — E10; не кутова точка — E1', function () {
        return has(St.cornerRect(r6, { points: [1], a: 7, b: 1 }).errors, 'E11') &&
          has(St.cornerRect(St.buildOval(6, 3, 6), { points: [1], a: 1, b: 1 }).errors, 'E10') &&
          has(St.cornerRect(r6, { points: [2], a: 1, b: 1 }).errors, 'E1');
      }],
      ['S4 «Поділити порівну»: D 1,5 м, 3 рівні → 50 і 100 см; налаштування 20;45;60', function () {
        var a = St.splitDepthsCm(1.5, 3), b = St.defaultDepthsCm({ shelf_depths_cm: '20;45;60' });
        return a.join() === '50,100' && b.join() === '20,45,60' && St.splitDepthsCm(1.5, 1).length === 0;
      }],
      ['S5 Приклад E1: видимі 3,0 і 1,0 м², S_глиб 14,0, об\'єм 22,05 м³', function () {
        var r = St.evaluate(E1, SET);
        return near(r.layers[0].visible, 3.0) && near(r.layers[1].visible, 1.0) && near(r.Sdeep, 14.0) &&
          near(St.waterVolume(r, 18, 1.5), 22.05) && r.errors.length === 0;
      }],
      ['S6 Попередження E1: W3 (риба), без W2 (77,8 % глибини), без W4 (1,5 ≥ 1,2)', function () {
        var w = codes(St.evaluate(E1, SET).warnings);
        return has(w, 'W3') && !has(w, 'W2') && !has(w, 'W4');
      }],
      ['S7 Глибина ≥ D — E7, шар не входить в об\'єм', function () {
        var r = St.evaluate({ shape: 'rect', L: 6, W: 3, D: 1.5, steps: [{ type: 'shelf', edge: 'straight', points: [1, 2, 3], wc: 0.5, depth_cm: 150 }] }, SET);
        return has(codes(r.errors), 'E7') && !r.layers[0].valid && near(St.waterVolume(r, 18, 1.5), 27);
      }],
      ['S8 Глибший шар повністю під мілкішим — E8', function () {
        var r = St.evaluate({ shape: 'rect', L: 6, W: 3, D: 1.5, steps: [
          { type: 'shelf', edge: 'straight', points: [1, 2, 3], wc: 0.5, depth_cm: 20 },
          { type: 'shelf', edge: 'straight', points: [1, 2, 3], wc: 0.3, depth_cm: 45 }] }, SET);
        return r.layers[1].visible === 0 && has(codes(r.errors), 'E8') && r.layers[0].valid;
      }],
      ['S9 Замала глибока зона і мілкий ставок — W2, W4; вузька полиця — W1', function () {
        var r = St.evaluate({ shape: 'rect', L: 6, W: 3, D: 0.6, fish: false, steps: [
          { type: 'platform', edge: 'straight', points: [1, 2, 3, 5, 4], depth_cm: 20 }, // хорда #5 → #3: 13,5 м²
          { type: 'shelf', edge: 'straight', points: [3, 8, 6], wc: 0.2, depth_cm: 40 }] }, SET);
        var w = codes(r.warnings);
        return has(w, 'W2') && has(w, 'W4') && has(w, 'W1') && !has(w, 'W3');
      }],
      ['S10 W > L: ставок 3×6 рахується як 6×3 (схема повернута), точки плану в межах 3×6', function () {
        var a = St.evaluate({ shape: 'rect', L: 3, W: 6, D: 1.5, steps: E1.steps }, SET);
        var b = St.evaluate({ shape: 'rect', L: 6, W: 3, D: 1.5, steps: E1.steps }, SET);
        var ok = a.layers[0].pond.swapped && near(a.layers[0].visible, b.layers[0].visible);
        a.layers[0].rings[0].forEach(function (p) {
          var q = St.toPlan(p, a.layers[0].pond);
          if (q[0] < -1e-9 || q[0] > 3 + 1e-9 || q[1] < -1e-9 || q[1] > 6 + 1e-9) ok = false;
        });
        return ok;
      }],
      ['S11 Овал, округле кільце w_c 0,5 — площа S − π(a−0,5)(b−0,5)', function () {
        var p = St.shelf(St.buildOval(6, 3, 8), { points: [1, 2, 3, 4, 5, 6, 7, 8], edge: 'round', wc: 0.5 }).parts[0];
        return near(p.area, Math.PI * 3 * 1.5 - Math.PI * 2.5 * 1.0, 0.01);
      }],
      ['S12 Великий ставок 30×10, три шари з перекриттям: видимі площі точні', function () {
        var r = St.evaluate({ shape: 'rect', L: 30, W: 10, D: 2, steps: [
          { type: 'shelf', edge: 'straight', points: [1, 2, 3], wc: 1, depth_cm: 20 },
          { type: 'shelf', edge: 'straight', points: [4, 7, 1], wc: 2, depth_cm: 45 },
          { type: 'corner', points: [1], a: 5, b: 5, depth_cm: 60 }] }, SET);
        // Точно: 30·1 = 30; 10·2 − 2·1 = 18; 5·5 − (5·1 + 2·4) = 12 (межі рядків на вершинах — без похибки)
        return near(r.layers[0].visible, 30, 1e-6) && near(r.layers[1].visible, 18, 1e-6) && near(r.layers[2].visible, 12, 1e-6);
      }]
    ];

    if (Calc) {
      list.push(['S13 Calc: сходинки змінюють об\'єм (27 → 22,05 м³), плівка та сама', function () {
        var inp = { shape: 'rect', L: '6', W: '3', D: '1,5', fish: true, bio: false, distance: '0' };
        var m0 = Calc.computeMetrics(inp, SET);
        inp.steps = E1.steps;
        var m1 = Calc.computeMetrics(inp, SET);
        return near(m0.V, 27) && near(m1.V, 22.05) && near(m1.filmArea, m0.filmArea, 1e-9) && near(m1.Sdeep, 14);
      }]);
      list.push(['S14 Calc: нестандартна форма — сходинки не рахуються, у кошторисі пояснення', function () {
        var inp = { shape: 'custom', L: '6', W: '3', D: '1,5', steps: E1.steps };
        var m = Calc.computeMetrics(inp, SET);
        return m.steps && !m.steps.available && m.steps.errors.length === 1 && near(m.Svis, 0);
      }]);
    }
    return list;
  }

  function run(St, Calc) {
    return cases(St, Calc).map(function (c) {
      var ok = false, error = '';
      try { ok = c[1]() === true; } catch (e) { error = String(e && e.message || e); }
      return { name: c[0], ok: ok, error: error };
    });
  }

  return { run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = StairsTests;
