/*
 * tests/sketch3d.tests.js — тести 3D-схеми: підписи «Bio-N» (D59, v0.7.1), масштаб з урахуванням кнопок,
 * стала висота блока для 4 ракурсів (D58).
 * Потрібні глобальні PondGeo і Sketch3D (у Node — run-node.js робить PondGeo глобальним).
 */
var Sketch3DTests = (function () {
  'use strict';

  // Усі точки ліній креслення (s3-line) з атрибута d: «M x y L x y …»
  function linePoints(model) {
    var pts = [];
    model.items.forEach(function (it) {
      if (it.tag !== 'path' || String(it.attrs['class']).indexOf('s3-line') === -1) return;
      var nums = it.attrs.d.match(/-?\d+(\.\d+)?/g).map(Number);
      for (var i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    });
    return pts;
  }

  function cases(G, S) {
    var pond = { shape: 'rect', L: 10, W: 5, D: 3, bio: { plates: [{ n: 1, side: 'right', w: 4 }], depth: 0.3 } };
    // v0.6.3: перемикач 2D / 3D вертикальний — вузький (54 px) і вищий (78 px)
    var avoid = { top: [{ x0: 0, x1: 150, y1: 26 }, { x0: 306, x1: 360, y1: 78 }], bottom: [{ x0: 0, x1: 40, h: 25 }, { x0: 262, x1: 360, h: 44 }] };
    function model(az, box) {
      var o = {}; for (var k in pond) o[k] = pond[k];
      o.azimuth = az; o.box = box || { w: 360, hMax: 360 }; o.avoid = avoid; o.fs = 1;
      return S.build(o);
    }
    // Випадок зі скріншотів майстра: 6 × 4, біоплато зверху «Разом»; кнопки — як у v0.6.3 (вертикальний 2D / 3D)
    var user = { shape: 'rect', L: 6, W: 4, D: 1.5, bio: { plates: [{ n: 1, side: 'top', w: 1.5 }], depth: 0.3, joined: true } };
    var appAvoid = { top: [{ x0: 0, x1: 190, y1: 26 }, { x0: 308, x1: 362, y1: 78 }], bottom: [{ x0: 0, x1: 40, h: 25 }, { x0: 266, x1: 362, h: 44 }] };
    function withOpts(base, extra) { var o = {}, k; for (k in base) o[k] = base[k]; for (k in extra) o[k] = extra[k]; return o; }
    // Прямокутник тексту «Bio-N» у моделі (оцінка ширини — як у sketch3d.js); n — номер Bio (за замовчуванням 1)
    function labelRect(m, n) {
      var txt = 'Bio-' + (n || 1);
      var t = m.items.filter(function (it) { return it.tag === 'text' && it.text === txt; })[0];
      if (!t) return null;
      var fp = S.LABEL_PX, w = 0.62 * fp * txt.length + 6, x = Number(t.attrs.x), y = Number(t.attrs.y);
      return { x0: x - w / 2, x1: x + w / 2, y0: y - 0.8 * fp, y1: y + 0.25 * fp };
    }
    function under(lr, av, m) {
      return av.top.some(function (r) { return lr.x1 > r.x0 && lr.x0 < r.x1 && lr.y0 < r.y1; }) ||
        av.bottom.some(function (r) { return lr.x1 > r.x0 && lr.x0 < r.x1 && lr.y1 > m.height - r.h; });
    }
    return [
      ['Підпис «Bio-1» (D59): біля середини зовнішньої сторони, за краєм землі; не додає висоти', function () {
        return [135, 225, 315, 45].every(function (az) {
          var o = withOpts(user, { azimuth: az, box: { w: 362, hMax: 362 }, avoid: { top: [], bottom: [] }, fs: 1 });
          var m = S.build(o), lr = labelRect(m), ys = linePoints(m).map(function (p) { return p[1]; });
          var sc = G.buildScene(o), lab = S.bioLabel(sc, G.camera(az, S.ELEVATION), S.LABEL_PX, 0);
          // Без кнопок — підпис посередині (k = 0) і між найвищою та найнижчою лініями креслення
          return lab && lab.text === 'Bio-1' && S.layout(o).views.every(function (v) { return v.k.length === 1 && v.k[0] === 0; }) &&
            lr.y0 >= Math.min.apply(null, ys) - 1 && lr.y1 <= Math.max.apply(null, ys) + 1;
        });
      }],
      ['Біоплато «Разом» (D56): підпис є, один котлован, висота ≤ hMax', function () {
        var o = { shape: 'oval', L: 10, W: 5, D: 3, bio: { plates: [{ n: 1, side: 'right', w: 4 }], depth: 0.3, joined: true },
                  azimuth: 135, box: { w: 360, hMax: 360 }, avoid: avoid, fs: 1 };
        var m = S.build(o), sc = G.buildScene(o);
        return !!labelRect(m) && sc.pits.length === 1 && !!S.bioLabel(sc, G.camera(135, S.ELEVATION), S.LABEL_PX, 0) && m.height <= 360;
      }],
      ['Висота блока однакова для 4 ракурсів і ≤ hMax (D58)', function () {
        var o = withOpts(pond, { box: { w: 360, hMax: 360 }, avoid: avoid, fs: 1 });
        var fit = S.layout(o);
        return fit.h <= 360 && fit.views.every(function (v) { return Math.abs(v.h - fit.h) < 1e-9 && model(v.az).height === Math.round(fit.h); });
      }],
      ['Поворот: висота стала, зсув посередині — між сусідніми ракурсами', function () {
        var o = withOpts(pond, { box: { w: 360, hMax: 360 }, avoid: avoid, fs: 1 });
        var fit = S.layout(o), a = S.viewFit(fit, 135), b = S.viewFit(fit, 225), mid = S.viewFit(fit, 180);
        return Math.abs(mid.t - (a.t + b.t) / 2) < 1e-6 && Math.abs(mid.h - fit.h) < 1e-9 &&
          Math.abs(S.viewFit(fit, 45 + 360).t - S.viewFit(fit, 45).t) < 1e-9;
      }],
      ['Підпис під кнопкою зсувається вздовж сторони: не під кнопками, висота — як без перемикача', function () {
        var noToggle = { top: [appAvoid.top[0]], bottom: appAvoid.bottom };
        var hA = S.layout(withOpts(user, { box: { w: 362, hMax: 362 }, avoid: appAvoid, fs: 1 })).h;
        var hB = S.layout(withOpts(user, { box: { w: 362, hMax: 362 }, avoid: noToggle, fs: 1 })).h;
        var free = [135, 225, 315, 45].every(function (az) {
          var m = S.build(withOpts(user, { azimuth: az, box: { w: 362, hMax: 362 }, avoid: appAvoid, fs: 1 })), lr = labelRect(m);
          return !under(lr, appAvoid, m);
        });
        return free && Math.abs(hA - hB) < 1;
      }],
      // v0.7.1: кілька Bio — у кожного свій підпис, жоден не під кнопками; зсуви — окремо для кожного
      ['Кілька Bio (приклад майстра 5 × 3: Bio-1 ліворуч 2 м, Bio-2 знизу 1 м): 2 підписи, не під кнопками, висота ≤ hMax', function () {
        var o = { shape: 'rect', L: 5, W: 3, D: 1.5, bio: { plates: [{ n: 1, side: 'left', w: 2 }, { n: 2, side: 'bottom', w: 1 }], depth: 0.3, joined: true },
                  box: { w: 362, hMax: 362 }, avoid: appAvoid, fs: 1 };
        return [135, 225, 315, 45].every(function (az) {
          var m = S.build(withOpts(o, { azimuth: az })), a = labelRect(m, 1), b = labelRect(m, 2);
          return a && b && !under(a, appAvoid, m) && !under(b, appAvoid, m) && m.height <= 362;
        }) && S.layout(o).views.every(function (v) { return v.k.length === 2; });
      }],
      ['Лінії креслення не заходять під кнопки й підпис, висота ≤ hMax', function () {
        return [135, 225, 315, 45].every(function (az) {
          var m = model(az);
          var inRect = function (p) {
            return avoid.top.some(function (r) { return p[0] > r.x0 && p[0] < r.x1 && p[1] < r.y1; }) ||
              avoid.bottom.some(function (r) { return p[0] > r.x0 && p[0] < r.x1 && p[1] > m.height - r.h; });
          };
          return m.height <= 360 && !linePoints(m).some(inRect);
        });
      }],
      ['Альбомна орієнтація: широкий блок — схема займає висоту, а не ширину', function () {
        var o = {}; for (var k in pond) o[k] = pond[k];
        o.box = { w: 700, hMax: 330 }; o.avoid = avoid; o.fs = 1;
        var fit = S.layout(o), m = model(135, { w: 700, hMax: 330 });
        var xs = linePoints(m).map(function (p) { return p[0]; });
        // Блок займає висоту (однакову для всіх ракурсів); по ширині лишається запас
        return fit.h <= 330 && fit.h > 300 && m.height <= 330 && Math.max.apply(null, xs) - Math.min.apply(null, xs) < 650;
      }]
    ];
  }

  function run(G, S) {
    return cases(G, S).map(function (c) {
      var ok = false, error = '';
      try { ok = c[1]() === true; } catch (e) { error = String(e && e.message || e); }
      return { name: c[0], ok: ok, error: error };
    });
  }

  return { run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sketch3DTests;
