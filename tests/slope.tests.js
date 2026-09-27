/*
 * tests/slope.tests.js — укіс стінок (v0.7.0, D61, D63): core/slope.js і його вплив на розрахунок (core/calc.js).
 * Звіряємо з точними формулами: прямокутний котлован з похилими стінками V = ∫₀ᴰ (L − 2mz)(W − 2mz) dz.
 */
var SlopeTests = (function () {
  'use strict';

  function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }
  function exactRect(L, W, D, m) { return L * W * D - (L + W) * m * D * D + 4 * m * m * D * D * D / 3; }

  function cases(Sl, Calc, G, s) {
    function metrics(inp) { return Calc.computeMetrics(inp, s); }
    return [
      ['Укіс: 1 : 1 = 45°, 1 : 0 = 90°; плівка при m = 0 — як раніше', function () {
        return near(Sl.angleDeg(1), 45) && near(Sl.angleDeg(0), 90) && near(Sl.angleDeg(2), 26.565, 1e-3) &&
          near(Sl.filmDepth(1.5, 0), 1.5) && near(metrics({ shape: 'rect', L: 6, W: 4, D: 1.5 }).filmArea, 80);
      }],
      ['Кут у градусах (v0.7.1): 90° → m = 0, 45° → 1, 85° → 0,0875, 30° → 1,732; туди й назад без втрат', function () {
        return Sl.mFromDeg(90) === 0 && near(Sl.mFromDeg(45), 1) && near(Sl.mFromDeg(85), 0.08749, 1e-5) &&
          near(Sl.mFromDeg(30), Math.sqrt(3)) && near(Sl.angleDeg(Sl.mFromDeg(62.5)), 62.5);
      }],
      ['Шви «Разом» — кілька ламаних (v0.7.1): укіс від глибини біоплато біля кожного шва', function () {
        var pond = G.outline('rect', 6, 3);
        var f = Sl.field({ outline: pond, D: 1.5, m: 1, seam: { lines: [[[6, 0], [6, 3]], [[0, 3], [0, 0]]], depth: 0.3 } });
        // Біля швів (x = 0 і x = 6) глибина — від 0,3 (плюс укіс), біля стінок y = 0 / 3 — від 0
        return near(f.depthAt([5.9, 1.5]), 0.4, 1e-3) && near(f.depthAt([0.1, 1.5]), 0.4, 1e-3) && near(f.depthAt([3, 0.1]), 0.1, 1e-3);
      }],
      ['Прямокутник без сходинок: V з укосом = точна формула (похибка < 0,1%)', function () {
        return [[6, 4, 1.5, 1], [6, 4, 1.5, 0.5], [20, 3, 1, 1], [10, 5, 3, 0.5]].every(function (c) {
          var v = metrics({ shape: 'rect', L: c[0], W: c[1], D: c[2], slope_m: c[3] }).V;
          return Math.abs(v / exactRect(c[0], c[1], c[2], c[3]) - 1) < 1e-3;
        });
      }],
      ['m = 0 — об\'єм S·D без коефіцієнтів (depth_profile_k прибрано, D63)', function () {
        return near(metrics({ shape: 'rect', L: 6, W: 4, D: 1.5, slope_m: 0 }).V, 36) &&
          near(metrics({ shape: 'rect', L: 6, W: 4, D: 1.5, slope_m: '' }).V, 36);
      }],
      ['Плівка з укосом: L + 2·D·(√(1+m²) − m) + 2 запаси (6 × 4 × 1,5, m = 1 → 51,46 м²)', function () {
        return near(metrics({ shape: 'rect', L: 6, W: 4, D: 1.5, slope_m: 1 }).filmArea, 51.4558, 1e-3);
      }],
      ['Підйом між сходинками вертикальний: за полицею глибина одразу D (укіс лише на зовнішній стінці)', function () {
        // Полиця 0,8 м уздовж верхньої стінки на глибині 0,3; укіс 1 : 1; розріз по x = 3
        var f = Sl.field({ outline: G.outline('rect', 6, 4), D: 1.5, m: 1,
                           levels: [{ poly: [[0, 0], [6, 0], [6, 0.8], [0, 0.8]], holes: [], depth: 0.3 }] });
        var z = function (y) { return f.depthAt([3, y]); };
        return near(z(0.2), 0.2, 1e-6) && near(z(0.5), 0.3) && near(z(0.81), 1.5) && near(z(2), 1.5) && near(z(3.5), 0.5, 1e-6);
      }],
      ['Завеликий укіс: дно не досягає D — попередження в кошторисі', function () {
        var est = Calc.buildEstimate({ shape: 'rect', L: 6, W: 4, D: 1.5, slope_m: 2 }, {}, { settings: s, items: [] }, {});
        var m = metrics({ shape: 'rect', L: 6, W: 4, D: 1.5, slope_m: 2 });
        return near(m.slope.maxDepth, 1, 0.02) && est.warnings.some(function (w) { return w.indexOf('Укіс 1 : 2') === 0; });
      }],
      ['Низ укосу на плані: прямокутник, зсунутий усередину на m·D, кути обрізані', function () {
        var f = Sl.field({ outline: G.outline('rect', 6, 4), D: 1.5, m: 1, levels: [] }), ls = Sl.toeLines(f);
        return ls.length >= 1 && ls.every(function (l) {
          return l.every(function (q) { return q[0] > 1.49 && q[0] < 4.51 && q[1] > 1.49 && q[1] < 2.51 &&
            near(Math.min(q[0], 6 - q[0], q[1], 4 - q[1]), 1.5, 1e-6); });
        });
      }],
      ['Розріз: профіль прямокутника з укосом — трапеція, земля по краях', function () {
        var f = Sl.field({ outline: G.outline('rect', 6, 4), D: 1.5, m: 1, levels: [] });
        var p = Sl.profile(f, [-0.5, 2], [6.5, 2], [], 14).map(function (q) { return Math.round(q.z * 100) / 100; });
        return p.join() === '0,0,0.5,1,1.5,1.5,1.5,1.5,1.5,1.5,1.5,1,0.5,0,0';
      }]
    ];
  }

  function run(Sl, Calc, G, s) {
    return cases(Sl, Calc, G, s).map(function (c) {
      var ok = false, error = '';
      try { ok = c[1]() === true; } catch (e) { error = String(e && e.message || e); }
      return { name: c[0], ok: ok, error: error };
    });
  }
  return { run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SlopeTests;
