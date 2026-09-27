/*
 * tests/plan2d.tests.js — розкладка 2D-схеми (v0.6.3, D60): UI.fitPlan — чиста функція без DOM.
 * Перевіряємо: схема не заходить під перемикач 2D / 3D, починається згори, вміщається в ширину і hMax.
 */
var Plan2DTests = (function () {
  'use strict';

  // Прямокутник ставка L × W з кроком точок по контуру (як addRing у ui.js) + підписи (px біля точки плану)
  function pondPts(L, W, labels) {
    var pts = [], n = 40;
    for (var k = 0; k < n; k++) {
      var a = k / n;
      pts.push({ mx: L * a, my: 0, dx: 0, dy: 0 }, { mx: L * a, my: W, dx: 0, dy: 0 },
               { mx: 0, my: W * a, dx: 0, dy: 0 }, { mx: L, my: W * a, dx: 0, dy: 0 });
    }
    (labels || []).forEach(function (l) { pts.push(l); });
    return pts;
  }

  function cases(UI) {
    var toggle = [{ x0: 308, x1: 362, y1: 78 }];                 // вертикальний 2D / 3D (54 × 78)
    function where(pts, f) { return pts.map(function (p) { return { X: f.offX + f.s * p.mx + p.dx, Y: f.t + f.s * p.my + p.dy }; }); }
    function under(q, r) { return q.X > r.x0 - 1 && q.X < r.x1 && q.Y < r.y1; }
    return [
      ['2D: 6 × 4 з підписом праворуч угорі — не під перемикачем, починається згори, ≤ hMax', function () {
        var pts = pondPts(6, 4, [{ mx: 6, my: 0.5, dx: 6, dy: -9 }, { mx: 6, my: 0.5, dx: 60, dy: 4 }]);
        var f = UI.fitPlan(pts, { w: 362, hMax: 217 }, toggle), q = where(pts, f);
        var top = Math.min.apply(null, q.map(function (p) { return p.Y; }));
        return f.h <= 217 && top < 7 && !q.some(function (p) { return under(p, toggle[0]); }) &&
          q.every(function (p) { return p.X >= 5 && p.X <= 357; });
      }],
      ['2D: довгий 20 × 3 — ліворуч від перемикача, блок висотою з перемикач (без порожнечі згори)', function () {
        var pts = pondPts(20, 3), f = UI.fitPlan(pts, { w: 362, hMax: 217 }, toggle), q = where(pts, f);
        return Math.round(f.h) === 84 && !q.some(function (p) { return under(p, toggle[0]); });
      }],
      ['2D: вузький 3 × 8 — упирається в hMax і стоїть по центру блока', function () {
        var pts = pondPts(3, 8), f = UI.fitPlan(pts, { w: 362, hMax: 217 }, toggle), q = where(pts, f);
        var xs = q.map(function (p) { return p.X; });
        var mid = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
        return f.h <= 217 && f.h > 210 && Math.abs(mid - 181) < 1;
      }]
    ];
  }

  function run(UI) {
    return cases(UI).map(function (c) {
      var ok = false, error = '';
      try { ok = c[1]() === true; } catch (e) { error = String(e && e.message || e); }
      return { name: c[0], ok: ok, error: error };
    });
  }

  return { run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Plan2DTests;
