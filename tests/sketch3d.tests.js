/*
 * tests/sketch3d.tests.js — тести 3D-схеми (v0.4.1): підпис «біоплато» і масштаб з урахуванням кнопок.
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
    var pond = { shape: 'rect', L: 10, W: 5, D: 3, bio: { L: 4, W: 1, depth: 0.3 } };
    var avoid = { top: [{ x0: 0, x1: 150, y1: 26 }, { x0: 250, x1: 360, y1: 40 }], bottom: [{ x0: 0, x1: 40, h: 25 }, { x0: 262, x1: 360, h: 44 }] };
    function model(az, box) {
      var o = {}; for (var k in pond) o[k] = pond[k];
      o.azimuth = az; o.box = box || { w: 360, hMax: 360 }; o.avoid = avoid; o.fs = 1;
      return S.build(o);
    }
    return [
      ['Підпис «біоплато»: над котлованом у ракурсах 1–2, під ним у ракурсах 3–4', function () {
        var sc = G.buildScene(pond);
        var below = [135, 225, 315, 45].map(function (az) { return S.bioLabelAnchor(sc, G.camera(az, S.ELEVATION)).below; });
        return below.join() === 'false,false,true,true';
      }],
      ['Біоплато «Разом» (D56): підпис є, один котлован, висота ≤ hMax', function () {
        var o = { shape: 'oval', L: 10, W: 5, D: 3, bio: { L: 4, W: 1, depth: 0.3, side: 'right', joined: true },
                  azimuth: 135, box: { w: 360, hMax: 360 }, avoid: avoid, fs: 1 };
        var m = S.build(o), sc = G.buildScene(o);
        var hasLabel = m.items.some(function (it) { return it.tag === 'text' && it.text === 'біоплато'; });
        return hasLabel && sc.pits.length === 1 && !!S.bioLabelAnchor(sc, G.camera(135, S.ELEVATION)) && m.height <= 360;
      }],
      ['Масштаб і висота однакові в усіх 4 ракурсах (схема не стрибає)', function () {
        var vb = [135, 225, 315, 45].map(function (az) { return model(az).viewBox; });
        return vb.every(function (v) { return v === vb[0]; });
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
        var m = model(135, { w: 700, hMax: 330 });
        var xs = linePoints(m).map(function (p) { return p[0]; });
        return m.height <= 330 && m.height > 300 && Math.max.apply(null, xs) - Math.min.apply(null, xs) < 650;
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
