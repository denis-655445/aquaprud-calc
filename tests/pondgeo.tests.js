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
