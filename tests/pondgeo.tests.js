/*
 * tests/pondgeo.tests.js — тести геометрії й видимості для 3D-схеми.
 * Числа перевіряються вручну: промінь до глядача піднімається на tan(кута огляду) на кожен метр.
 */
var PondGeoTests = (function () {
  'use strict';

  function near(a, b, tol) { return Math.abs(a - b) < (tol || 1e-6); }

  function cases(G) {
    var rect = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5 });
    var edges = function (sc) { return sc.pits.reduce(function (acc, pit) {
      pit.outline.forEach(function (p, i) { acc.push([p, pit.outline[(i + 1) % pit.outline.length]]); });
      pit.levels.forEach(function (lv) { lv.poly.forEach(function (p, i) { acc.push([p, lv.poly[(i + 1) % lv.poly.length]]); }); });
      return acc;
    }, []); };
    // Глядач на південному сході (azimuth 45°), кут огляду 45° → промінь піднімається на 1 м за 1 м
    var cam = G.camera(45, 45);

    return [
      ['Контур прямокутника 6×4: площа 24, обхід за годинниковою', function () {
        return near(G.signedArea(G.outline('rect', 6, 4)), 24);
      }],
      ['Контур овалу 6×4: площа ≈ π/4·24 (похибка < 0,2%)', function () {
        var s = G.signedArea(G.outline('oval', 6, 4));
        return s > 0 && Math.abs(s / (Math.PI / 4 * 24) - 1) < 0.002;
      }],
      ['Нестандартна форма: опукла, менша за описаний прямокутник', function () {
        var s = G.signedArea(G.outline('custom', 6, 4));
        return s > 0 && s < 24 && s > 20;
      }],
      ['Висота поверхні: центр ставка −1,5; поза ставком 0', function () {
        return G.groundAt(rect, [3, 2]) === -1.5 && G.groundAt(rect, [7, 2]) === 0;
      }],
      ['Проєкція: глибша точка нижче на екрані, ближча до глядача — теж', function () {
        var top = G.project(cam, 3, 2, 0), deep = G.project(cam, 3, 2, -1), nearer = G.project(cam, 4, 3, 0);
        return deep[1] > top[1] && nearer[1] > top[1] && near(deep[0], top[0]);
      }],
      ['Дальній кут дна видно: промінь виходить через 4√2 ≈ 5,66 м на висоті +4,16', function () {
        return G.isVisible(rect, edges(rect), cam, 0, 0, -1.5);
      }],
      ['Ближній кут дна сховано під землею', function () {
        return !G.isVisible(rect, edges(rect), cam, 6, 4, -1.5);
      }],
      ['Вузький глибокий ставок 1×1×3: центр дна не видно', function () {
        var sc = G.buildScene({ shape: 'rect', L: 1, W: 1, D: 3 });
        return !G.isVisible(sc, edges(sc), cam, 0.5, 0.5, -3);
      }],
      ['Сходинка заступає: точка дна за полицею 0,2 м не видна, перед нею — видна', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5 });
        // Полиця вздовж нижньої (ближньої) стінки шириною 1 м на глибині 0,2 м
        sc.pits[0].levels.push({ poly: G.rect(0, 3, 6, 1), depth: 0.2 });
        var e = edges(sc);
        // Від (3; 2,5; −1,5) промінь доходить до полиці через 0,5·√2 = 0,71 м на висоті −0,79 < −0,2 → сховано
        // Від (1; 0; −1,5) до полиці 3·√2 = 4,24 м → промінь уже на +2,74 → видно
        return !G.isVisible(sc, e, cam, 3, 2.5, -1.5) && G.isVisible(sc, e, cam, 1, 0, -1.5);
      }],
      ['Креслення прямокутника: край суцільний, 3 з 4 вертикальних ребер — пунктиром; заливки земля, отвір, дно', function () {
        var r = G.render(rect, cam, 0.05);
        var rim = r.visible.filter(function (l) { return l.kind === 'rim'; }).length;
        var hiddenEdges = r.hidden.filter(function (l) { return l.kind === 'edge'; }).length;
        var kinds = r.fills.map(function (f) { return f.kind; }).join(',');
        return rim === 1 && hiddenEdges === 3 && r.hidden.length > 0 && kinds === 'ground,rim,floor';
      }],
      ['Овал: вертикальні ребра лише на контурі повороту стінки (2 шт.)', function () {
        var sc = G.buildScene({ shape: 'oval', L: 6, W: 4, D: 1.5 });
        return G.sceneLines(sc, cam).filter(function (l) { return l.kind === 'edge'; }).length === 2;
      }],
      // ---------- Біоплато v0.7.1: Bio-1…Bio-4 на всю сторону, змінна лише ширина ----------
      ['«Окремо», 1 Bio праворуч: котлован з проміжком, довжина = W, ширина = w, глибина з налаштувань', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5, bio: { plates: [{ n: 1, side: 'right', w: 2 }], depth: 0.3 } });
        var g = G.bioGap(6), bb = sc.pits[1].outline, xs = bb.map(function (q) { return q[0]; }), ys = bb.map(function (q) { return q[1]; });
        return sc.pits.length === 2 && near(Math.min.apply(null, xs), 6 + g) && near(Math.max.apply(null, xs), 8 + g) &&
          near(Math.min.apply(null, ys), 0) && near(Math.max.apply(null, ys), 4) && G.groundAt(sc, [7 + g, 2]) === -0.3 &&
          sc.bios.length === 1 && sc.bios[0].n === 1;
      }],
      ['Bio з 4 боків: довжина — сторона ставка (L або W), зовнішня сторона на відстані w від ставка', function () {
        var L = 6, W = 4, ok = true;
        G.BIO_SIDES.forEach(function (side) {
          var r = G.bioGeometry('rect', L, W, [{ n: 1, side: side, w: 1.5 }], true).rects[0].r;
          var len = side === 'right' || side === 'left' ? W : L, horiz = side === 'top' || side === 'bottom';
          ok = ok && near(horiz ? r[2] : r[3], len) && near(horiz ? r[3] : r[2], 1.5) &&
            (side === 'right' ? near(r[0], L) : side === 'left' ? near(r[0], -1.5) : side === 'bottom' ? near(r[1], W) : near(r[1], -1.5));
        });
        return ok && G.BIO_SIDES.join() === 'right,bottom,left,top';
      }],
      ['Приклад майстра 5 × 3: Bio-1 ліворуч 2 м (6 м²) + Bio-2 знизу 1 м (5 м²) + стик 2 × 1 = 13 м²', function () {
        var g = G.bioGeometry('rect', 5, 3, [{ n: 1, side: 'left', w: 2 }, { n: 2, side: 'bottom', w: 1 }], true);
        var zone = 0; g.zones.forEach(function (z) { zone += G.signedArea(z.poly); });
        var c = g.corners[0];
        return g.zones.length === 1 && near(zone, 13) && g.corners.length === 1 &&
          near(c[0], -2) && near(c[1], 3) && near(c[2], 2) && near(c[3], 1) && near(G.signedArea(g.union), 15 + 13);
      }],
      ['Навпроти (праворуч і ліворуч) — без стику: дві окремі зони', function () {
        var g = G.bioGeometry('rect', 5, 3, [{ n: 1, side: 'right', w: 1 }, { n: 2, side: 'left', w: 2 }], true);
        return g.corners.length === 0 && g.zones.length === 2 && near(G.signedArea(g.zones[0].poly) + G.signedArea(g.zones[1].poly), 9);
      }],
      ['«Разом»: площа спільного контуру = ставок + зони (прямокутник, овал, нестандартний; 1–4 Bio)', function () {
        var ok = true, sets = [[['right', 1]], [['top', 2]], [['right', 1], ['bottom', 0.5]], [['left', 1], ['right', 2]],
                                [['right', 1], ['bottom', 1], ['left', 1]], [['right', 1], ['bottom', 2], ['left', 0.5], ['top', 1]]];
        ['rect', 'oval', 'custom'].forEach(function (shape) {
          sets.forEach(function (set) {
            var g = G.bioGeometry(shape, 6, 3, set.map(function (x, i) { return { n: i + 1, side: x[0], w: x[1] }; }), true);
            var zone = 0;
            g.zones.forEach(function (z) {
              zone += G.signedArea(z.poly);
              z.holes.forEach(function (h) { zone -= Math.abs(G.signedArea(h)); });
              ok = ok && G.signedArea(z.poly) > 0;
            });
            ok = ok && near(G.signedArea(g.union), G.signedArea(G.outline(shape, 6, 3)) + zone, 1e-6);
          });
        });
        return ok;
      }],
      ['«Разом», прямокутник 6 × 3 + Bio праворуч 2 м: зона 6 м², шов x = 6 на всю ширину', function () {
        var g = G.bioGeometry('rect', 6, 3, [{ n: 1, side: 'right', w: 2 }], true);
        var s = g.seams[0], ys = s.map(function (q) { return q[1]; });
        return g.seams.length === 1 && near(G.signedArea(g.zones[0].poly), 6) && s.every(function (q) { return near(q[0], 6); }) &&
          near(Math.min.apply(null, ys), 0) && near(Math.max.apply(null, ys), 3);
      }],
      ['«Разом», 3D: один котлован; біоплато −0,3, ставок −1,5; у кінцях шва — ребро підйому −0,3 → −1,5', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 3, D: 1.5, bio: { plates: [{ n: 1, side: 'right', w: 2 }], depth: 0.3, joined: true } });
        var edges = G.sceneLines(sc, G.camera(135, 40)).filter(function (l) { return l.kind === 'edge'; });
        var at = function (x, y) { return edges.filter(function (l) { return near(l.pts[0][0], x) && near(l.pts[0][1], y); }); };
        var e = at(6, 0);
        return sc.pits.length === 1 && G.groundAt(sc, [7, 1.5]) === -0.3 && G.groundAt(sc, [3, 1.5]) === -1.5 &&
          e.length === 1 && near(e[0].pts[0][2], -0.3) && near(e[0].pts[1][2], -1.5);
      }],
      ['«Разом», овал: шов — дуга стінки ставка, контур виходить за торець на w', function () {
        var g = G.bioGeometry('oval', 6, 3, [{ n: 1, side: 'right', w: 2 }], true);
        var s = g.seams[0], xs = g.union.map(function (q) { return q[0]; });
        var onWall = s.every(function (q) { return Math.abs(Math.pow((q[0] - 3) / 3, 2) + Math.pow((q[1] - 1.5) / 1.5, 2) - 1) < 0.01; });
        return g.seams.length === 1 && s.length > 5 && onWall && near(Math.max.apply(null, xs), 8);
      }],
      ['«Окремо», 4 Bio: один котлован-кільце з «островом» — земля між ставком і біоплато', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5, bio: { depth: 0.3, plates: [{ n: 1, side: 'right', w: 1 }, { n: 2, side: 'bottom', w: 1 },
          { n: 3, side: 'left', w: 1 }, { n: 4, side: 'top', w: 1 }] } });
        var g = G.bioGap(6), bio = sc.pits[1];
        return sc.pits.length === 2 && bio.holes.length === 1 && G.groundAt(sc, [6 + g / 2, 2]) === 0 &&
          G.groundAt(sc, [6 + g + 0.5, 2]) === -0.3 && G.groundAt(sc, [-g - 0.5, -g - 0.5]) === -0.3 && G.groundAt(sc, [3, 2]) === -1.5;
      }],
      ['Рівні (A2.1): кільце-полиця з діркою — у дірці дно, на полиці її глибина', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5,
          levels: [{ poly: G.rect(0, 0, 6, 4), holes: [G.rect(1, 1, 4, 2)], depth: 0.3 }] });
        return G.groundAt(sc, [0.5, 2]) === -0.3 && G.groundAt(sc, [3, 2]) === -1.5;
      }],
      ['Рівні: край полиці — лінія на −0,2; низ стінки — −0,2 під полицею і −1,5 поза нею', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5, levels: [{ poly: G.rect(0, 3, 6, 1), depth: 0.2 }] });
        var geo = G.levelGeometry(sc);
        var steps = geo.lines.filter(function (l) { return l.kind === 'step'; });
        var floors = geo.lines.filter(function (l) { return l.kind === 'floor'; }).map(function (l) { return l.z; });
        return steps.length === 1 && near(steps[0].z, -0.2) && near(steps[0].pts[0][1], 3) &&
          floors.indexOf(-0.2) !== -1 && floors.indexOf(-1.5) !== -1;
      }],
      ['Рівні: кути прямокутної сходинки не губляться при спрощенні', function () {
        var sc = G.buildScene({ shape: 'rect', L: 8, W: 4, D: 1.6, levels: [{ poly: [[0, 0], [2, 0], [2, 4], [0, 4]], depth: 0.25 }] });
        return sc.pits[0].levels[0].poly.length === 4;
      }],
      // v0.9.1: кінці краю однієї сходинки на краю іншої — вертикальне ребро (скріншот майстра 28.09)
      ['Рівні: ребро в перетині країв двох сходинок — лише на висоті кута (−0,45…−1,5), не від −0,2', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5, levels: [
          { poly: G.rect(0, 0, 6, 1), depth: 0.2 }, { poly: G.rect(0, 0, 3, 2), depth: 0.45 }] });
        var v = G.levelGeometry(sc).verts.filter(function (x) { return near(x.p[0], 3) && near(x.p[1], 1); });
        return v.length === 1 && v[0].fixed && near(v[0].zt, -0.45) && near(v[0].zb, -1.5);
      }],
      ['Рівні: хорда платформи через полицю — ребра на обох перетинах', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5, levels: [
          { poly: [[0, 4], [0, 0], [6, 0], [6, 0.4], [0.4, 0.4], [0.4, 4]], depth: 0.2 }, { poly: [[0, 0], [3, 0], [0, 4]], depth: 0.45 }] });
        var at = function (x, y) { return G.levelGeometry(sc).verts.filter(function (v) { return v.fixed && Math.hypot(v.p[0] - x, v.p[1] - y) < 1e-6; }); };
        var a = at(2.7, 0.4), b = at(0.4, 4 - 0.4 * 4 / 3);
        return a.length === 1 && b.length === 1 && near(a[0].zt, -0.45) && near(a[0].zb, -1.5) && near(b[0].zt, -0.45);
      }],
      ['Межі сталі для всіх кутів огляду: ширина ≥ діагоналі ставка', function () {
        var b = G.stableBounds(rect, 40);
        return b.maxX - b.minX >= Math.hypot(6, 4) - 1e-6 && b.maxY > b.minY;
      }]
    ];
  }

  function run(G) {
    return cases(G).map(function (c) {
      var ok = false, error = '';
      try { ok = c[1]() === true; } catch (e) { error = String(e && e.message || e); }
      return { name: c[0], ok: ok, error: error };
    });
  }

  return { run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PondGeoTests;
