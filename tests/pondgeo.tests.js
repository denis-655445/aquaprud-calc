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
      ['Біоплато: окремий котлован праворуч, глибина з налаштувань', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 4, D: 1.5, bio: { L: 2, W: 2, depth: 0.3 } });
        var bio = sc.pits[1];
        return sc.pits.length === 2 && bio.outline[0][0] > 6 && G.groundAt(sc, [bio.outline[0][0] + 1, 2]) === -0.3;
      }],
      ['Біоплато з 4 боків: Lб завжди від ставка, Wб уздовж сторони, по центру сторони', function () {
        var bio = { L: 3, W: 1 }, L = 6, W = 4;
        var r = G.bioRect(L, W, bio, 'right'), b = G.bioRect(L, W, bio, 'bottom'), l = G.bioRect(L, W, bio, 'left'), t = G.bioRect(L, W, bio, 'top');
        return r[0] > L && r[2] === 3 && r[3] === 1 && near(r[1] + r[3] / 2, W / 2) &&
          b[1] > W && b[2] === 1 && b[3] === 3 && near(b[0] + b[2] / 2, L / 2) &&
          l[0] + l[2] < 0 && t[1] + t[3] < 0 && G.BIO_SIDES.join() === 'right,bottom,left,top';
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
      // ---------- Біоплато «Разом» (v0.6.1, D56) ----------
      ['«Разом»: площа спільного контуру = ставок + зона біоплато (прямокутник, овал, нестандартний; 4 сторони)', function () {
        var ok = true;
        [['rect', { L: 2, W: 1.5 }], ['rect', { L: 2, W: 4 }], ['oval', { L: 2, W: 1.5 }], ['oval', { L: 2, W: 5 }], ['custom', { L: 2, W: 3 }]].forEach(function (c) {
          G.BIO_SIDES.forEach(function (side) {
            var j = G.bioJoin(c[0], 6, 3, c[1], side), sp = G.signedArea(G.outline(c[0], 6, 3));
            ok = ok && near(G.signedArea(j.union), sp + G.signedArea(j.zone), 1e-6) && G.signedArea(j.zone) > 0;
          });
        });
        return ok;
      }],
      ['«Разом», прямокутник 6×3 + біоплато 2×1,5 праворуч: впритул, зона 3 м², шов x = 6 від 0,75 до 2,25', function () {
        var j = G.bioJoin('rect', 6, 3, { L: 2, W: 1.5 }, 'right');
        var xs = j.seam.map(function (q) { return q[0]; }), ys = j.seam.map(function (q) { return q[1]; }).sort();
        return near(j.rect[0], 6) && near(G.signedArea(j.zone), 3) && xs.every(function (x) { return near(x, 6); }) &&
          near(ys[0], 0.75) && near(ys[ys.length - 1], 2.25);
      }],
      ['«Разом», 3D: один котлован; у кутах стику ребро 0 → −0,3; на кінцях шва ребер немає; поверхня біоплато −0,3', function () {
        var sc = G.buildScene({ shape: 'rect', L: 6, W: 3, D: 1.5, bio: { L: 2, W: 1.5, depth: 0.3, side: 'right', joined: true } });
        var edges = G.sceneLines(sc, G.camera(135, 40)).filter(function (l) { return l.kind === 'edge'; });
        var at = function (x, y) { return edges.filter(function (l) { return near(l.pts[0][0], x) && near(l.pts[0][1], y); }); };
        var corner = at(6, 0.75);
        return sc.pits.length === 1 && G.groundAt(sc, [7, 1.5]) === -0.3 && G.groundAt(sc, [3, 1.5]) === -1.5 &&
          corner.length === 1 && near(corner[0].pts[1][2], -0.3) && at(6, 2.25).length === 1 &&
          !edges.some(function (l) { return near(l.pts[0][2], -0.3) && near(l.pts[1][2], -1.5); });
      }],
      ['«Разом», овал: шов — дуга стінки ставка, біоплато виходить за торець на Lб', function () {
        var j = G.bioJoin('oval', 6, 3, { L: 2, W: 1.5 }, 'right'), pond = G.outline('oval', 6, 3);
        var onWall = j.seam.every(function (q) { return Math.abs(Math.pow((q[0] - 3) / 3, 2) + Math.pow((q[1] - 1.5) / 1.5, 2) - 1) < 0.01; });
        return j.seam.length > 5 && onWall && near(j.rect[0] + j.rect[2], 8) && G.inside([j.rect[0] + 0.01, 1.5], pond);
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
