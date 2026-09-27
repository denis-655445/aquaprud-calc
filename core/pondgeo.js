/*
 * core/pondgeo.js — геометрія ставка для схем 2D / 3D.
 * Чисті функції: без DOM і без API платформ (D11), тож модуль можна взяти на сайт чи в інший застосунок.
 *
 * Система координат плану (як у 2D-схемі, stairs_math.md §0.2):
 *   початок — лівий верхній кут, x — вправо (довжина L), y — вниз (ширина W), одиниці — метри.
 *   z — вгору: земля z = 0, дно ставка z = −D.
 *
 * 3D — аксонометрія (паралельна проєкція, як на кресленні): паралельні ребра лишаються паралельними.
 * Ставок — «карта глибин»: у кожній точці плану одна глибина, стінки й підйоми вертикальні.
 * Тому видимість будь-якої точки перевіряємо променем до глядача: чи не пройде він нижче землі
 * або нижче мілкішої ділянки (сходинки) по дорозі.
 */
var PondGeo = (function () {
  'use strict';

  var EPS = 1e-7;
  var OVAL_SEGMENTS = 96;     // відрізків на контур овалу: гладко і швидко
  var CORNER_SEGMENTS = 12;   // відрізків на заокруглений кут «нестандартної» форми
  var CUSTOM_RADIUS_K = 0.38; // радіус кута «нестандартної» форми — як у 2D-схемі (ui.js)
  var SHARP_TURN_DEG = 30;    // поворот контуру, більший за цей, — «гострий кут» (вертикальне ребро)

  function cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }

  // ---------- Контури в плані ----------

  function rect(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }

  // Еліпс з центром (cx, cy) і півосями a, b. Старт — лівий торець (як точка #1 у stairs_math §4.3),
  // далі за годинниковою стрілкою на екрані: ліво → верх → право → низ
  function ellipse(cx, cy, a, b, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = Math.PI + 2 * Math.PI * i / n;
      pts.push([cx + a * Math.cos(t), cy + b * Math.sin(t)]);
    }
    return pts;
  }

  // Прямокутник із заокругленими кутами радіуса r (умовний контур «нестандартної» форми)
  function roundedRect(x, y, w, h, r) {
    var pts = [];
    // Центри дуг і початкові кути: лівий верхній, правий верхній, правий нижній, лівий нижній
    var arcs = [[x + r, y + r, Math.PI], [x + w - r, y + r, 1.5 * Math.PI],
                [x + w - r, y + h - r, 0], [x + r, y + h - r, 0.5 * Math.PI]];
    arcs.forEach(function (a) {
      for (var i = 0; i <= CORNER_SEGMENTS; i++) {
        var t = a[2] + 0.5 * Math.PI * i / CORNER_SEGMENTS;
        pts.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
      }
    });
    return pts;
  }

  // Контур дзеркала ставка за формою: масив точок [x, y] за годинниковою стрілкою на екрані
  function outline(shape, L, W) {
    if (shape === 'oval') return ellipse(L / 2, W / 2, L / 2, W / 2, OVAL_SEGMENTS);
    if (shape === 'custom') return roundedRect(0, 0, L, W, CUSTOM_RADIUS_K * Math.min(L, W));
    return rect(0, 0, L, W);
  }

  // Площа многокутника зі знаком (формула «шнурування»); > 0 — обхід за годинниковою на екрані
  function signedArea(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  // Точка всередині многокутника: промінь праворуч, рахуємо перетини (правило парності)
  function inside(p, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) &&
          p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  // ---------- Сцена: котловани ставка й біоплато ----------

  /*
   * p = { shape, L, W, D, bio: { L, W, depth } | null }
   * Котлован (pit): { id, outline, depth, levels } — levels: сходинки [{ poly, depth }] (етап A2.1)
   */
  function buildScene(p) {
    var pits = [{ id: 'pond', outline: outline(p.shape, p.L, p.W), depth: p.D, levels: [] }];
    if (p.bio && p.bio.L > 0 && p.bio.W > 0) {
      // Біоплато праворуч від ставка по центру, як у 2D-схемі; проміжок — умовний
      var gap = Math.max(0.5, 0.06 * p.L);
      pits.push({ id: 'bio', outline: rect(p.L + gap, (p.W - p.bio.W) / 2, p.bio.L, p.bio.W),
                  depth: Math.max(0, p.bio.depth || 0), levels: [] });
    }
    // Ділянка землі навколо котлованів: на кресленні ставок читається як «яма», а не коробка
    var xs = [], ys = [];
    pits.forEach(function (pit) { pit.outline.forEach(function (q) { xs.push(q[0]); ys.push(q[1]); }); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var margin = Math.max(0.4, 0.08 * Math.max(x1 - x0, y1 - y0));
    return { pits: pits, ground: rect(x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin) };
  }

  // Висота поверхні в точці плану: 0 — земля, −глибина — дно (або мілкіша сходинка, D33)
  function groundAt(scene, q) {
    for (var i = 0; i < scene.pits.length; i++) {
      var pit = scene.pits[i];
      if (!inside(q, pit.outline)) continue;
      var d = pit.depth;
      pit.levels.forEach(function (lv) { if (lv.depth < d && inside(q, lv.poly)) d = lv.depth; });
      return -d;
    }
    return 0;
  }

  // Усі межі ділянок з різною висотою — тут промінь може «вдаритися» в стінку
  function boundaryEdges(scene) {
    var edges = [];
    function add(poly) {
      for (var i = 0; i < poly.length; i++) edges.push([poly[i], poly[(i + 1) % poly.length]]);
    }
    scene.pits.forEach(function (pit) {
      add(pit.outline);
      pit.levels.forEach(function (lv) { add(lv.poly); });
    });
    return edges;
  }

  // ---------- Камера і проєкція ----------

  /*
   * azimuthDeg — напрямок у плані від ставка до глядача (0° — праворуч, 90° — вниз на 2D-схемі);
   * elevationDeg — кут погляду над горизонтом.
   */
  function camera(azimuthDeg, elevationDeg) {
    var a = azimuthDeg * Math.PI / 180, e = elevationDeg * Math.PI / 180;
    var c = [Math.cos(a), Math.sin(a)];
    return {
      c: c,                // у плані: від ставка до глядача
      r: [c[1], -c[0]],    // у плані: «праворуч» для глядача
      sinE: Math.sin(e), cosE: Math.cos(e), tanE: Math.tan(e)
    };
  }

  // Точка (x, y, z) → екран [X, Y]; Y — вниз: ближче до глядача й глибше = нижче на екрані
  function project(cam, x, y, z) {
    return [x * cam.r[0] + y * cam.r[1], (x * cam.c[0] + y * cam.c[1]) * cam.sinE - z * cam.cosE];
  }

  // ---------- Видимість ----------

  /*
   * Чи бачить глядач точку (x, y, z). Промінь іде в плані в бік глядача (c) і піднімається на tanE
   * на кожен метр. Межі ділянок ділять його на відрізки зі сталою висотою поверхні;
   * промінь найнижчий на початку відрізка — там і порівнюємо.
   */
  function isVisible(scene, edges, cam, x, y, z) {
    if (z >= -EPS) return true;          // на рівні землі нічого не заступає
    var tMax = -z / cam.tanE;            // далі промінь уже вище землі
    var c = cam.c, ts = [];
    for (var i = 0; i < edges.length; i++) {
      var a = edges[i][0], e = [edges[i][1][0] - a[0], edges[i][1][1] - a[1]];
      var den = cross(c, e);
      if (Math.abs(den) < 1e-12) continue;           // промінь паралельний межі
      var ap = [a[0] - x, a[1] - y];
      var t = cross(ap, e) / den, s = cross(ap, c) / den;
      if (s >= -EPS && s <= 1 + EPS && t > EPS && t < tMax) ts.push(t);
    }
    ts.sort(function (p, q) { return p - q; });
    ts.push(tMax);
    var t0 = 0;
    for (var k = 0; k < ts.length; k++) {
      var t1 = ts[k];
      if (t1 - t0 < EPS) continue;
      var mid = (t0 + t1) / 2;
      var h = groundAt(scene, [x + c[0] * mid, y + c[1] * mid]);
      if (h > z + t0 * cam.tanE + 1e-6) return false; // поверхня вища за промінь — точку заступає
      t0 = t1;
    }
    return true;
  }

  // ---------- Лінії креслення ----------

  // Ребра котлованів у 3D: край (земля), контур дна, вертикальні ребра
  function sceneLines(scene, cam) {
    var lines = [];
    scene.pits.forEach(function (pit) {
      var o = pit.outline, n = o.length, D = pit.depth;
      lines.push({ pit: pit.id, kind: 'rim', closed: true, pts: o.map(function (p) { return [p[0], p[1], 0]; }) });
      if (!(D > 0)) return;
      lines.push({ pit: pit.id, kind: 'floor', closed: true, pts: o.map(function (p) { return [p[0], p[1], -D]; }) });
      for (var i = 0; i < n; i++) {
        var prev = o[(i - 1 + n) % n], cur = o[i], next = o[(i + 1) % n];
        var e1 = [cur[0] - prev[0], cur[1] - prev[1]], e2 = [next[0] - cur[0], next[1] - cur[1]];
        var cosTurn = (e1[0] * e2[0] + e1[1] * e2[1]) / (Math.hypot(e1[0], e1[1]) * Math.hypot(e2[0], e2[1]));
        var sharp = cosTurn < Math.cos(SHARP_TURN_DEG * Math.PI / 180);
        // Зовнішня нормаль ребра (обхід за годинниковою на екрані): (e.y, −e.x)
        var s1 = e1[1] * cam.c[0] - e1[0] * cam.c[1], s2 = e2[1] * cam.c[0] - e2[0] * cam.c[1];
        var silhouette = s1 * s2 < 0; // округла стінка тут повертається від глядача
        if (sharp || silhouette) {
          lines.push({ pit: pit.id, kind: 'edge', closed: false, pts: [[cur[0], cur[1], 0], [cur[0], cur[1], -D]] });
        }
      }
    });
    return lines;
  }

  /*
   * Креслення в екранних координатах:
   *   visible / hidden — ламані (масиви [X, Y]): видимі — суцільні, невидимі — пунктир;
   *   fills — многокутники для заливки: rim (отвір котлована) і floor (дно) кожного котлована.
   * stepM — крок перевірки видимості вздовж ребра, м (що менший, то точніша межа пунктиру).
   */
  function render(scene, cam, stepM) {
    var edges = boundaryEdges(scene);
    var out = { visible: [], hidden: [], fills: [] };
    if (scene.ground) {
      out.fills.push({ pit: null, kind: 'ground', pts: scene.ground.map(function (p) { return project(cam, p[0], p[1], 0); }) });
    }

    scene.pits.forEach(function (pit) {
      var proj = function (z) { return pit.outline.map(function (p) { return project(cam, p[0], p[1], z); }); };
      out.fills.push({ pit: pit.id, kind: 'rim', pts: proj(0) });
      if (pit.depth > 0) out.fills.push({ pit: pit.id, kind: 'floor', pts: proj(-pit.depth) });
    });

    sceneLines(scene, cam).forEach(function (line) {
      var pts = line.pts, segs = line.closed ? pts.length : pts.length - 1;
      var run = null;
      function emit() {
        if (run && run.pts.length > 1) (run.vis ? out.visible : out.hidden).push({ pit: line.pit, kind: line.kind, pts: run.pts });
      }
      for (var i = 0; i < segs; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        var len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        var n = Math.max(1, Math.ceil(len / stepM));
        for (var k = 0; k < n; k++) {
          var f0 = k / n, f1 = (k + 1) / n, fm = (k + 0.5) / n;
          var lerp = function (f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
          var m = lerp(fm);
          var vis = line.kind === 'rim' || isVisible(scene, edges, cam, m[0], m[1], m[2]);
          var p0 = lerp(f0), p1 = lerp(f1);
          if (!run || run.vis !== vis) {
            emit();
            run = { vis: vis, pts: [project(cam, p0[0], p0[1], p0[2])] };
          }
          run.pts.push(project(cam, p1[0], p1[1], p1[2]));
        }
      }
      emit();
    });
    return out;
  }

  /*
   * Межі креслення для всіх кутів огляду відносно проєкції центру сцени.
   * Масштаб лишається сталим під час повороту — схема не «стрибає».
   */
  function stableBounds(scene, elevationDeg) {
    var xs = [], ys = [];
    scene.pits.forEach(function (pit) {
      pit.outline.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
    });
    // Разом із ділянкою землі — вона теж має вміщатися
    var polys = scene.pits.map(function (pit) { return { pts: pit.outline, depth: pit.depth }; });
    if (scene.ground) polys.push({ pts: scene.ground, depth: 0 });
    var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    var cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var b = { minX: 0, maxX: 0, minY: 0, maxY: 0, center: [cx, cy] };
    for (var az = 0; az < 360; az += 5) {
      var cam = camera(az, elevationDeg), c0 = project(cam, cx, cy, 0);
      polys.forEach(function (pl) {
        [0, -pl.depth].forEach(function (z) {
          pl.pts.forEach(function (p) {
            var q = project(cam, p[0], p[1], z);
            b.minX = Math.min(b.minX, q[0] - c0[0]); b.maxX = Math.max(b.maxX, q[0] - c0[0]);
            b.minY = Math.min(b.minY, q[1] - c0[1]); b.maxY = Math.max(b.maxY, q[1] - c0[1]);
          });
        });
      });
    }
    // Кути перебираємо кроком 5°: між ними проєкція може бути трохи більшою — додаємо запас
    var k = 1 / Math.cos(2.5 * Math.PI / 180);
    b.minX *= k; b.maxX *= k; b.minY *= k; b.maxY *= k;
    return b;
  }

  // ---------- Габарит креслення для масштабу (v0.4.1) ----------

  // Центр сцени в плані — середина габариту котлованів (навколо нього повертаємо схему)
  function sceneCenter(scene) {
    var xs = [], ys = [];
    scene.pits.forEach(function (pit) { pit.outline.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    return [(Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2];
  }

  // Проєкції всіх вершин креслення (земля, край і дно кожного котлована) — з них складається силует
  function projectedPoints(scene, cam) {
    var out = [];
    if (scene.ground) scene.ground.forEach(function (p) { out.push(project(cam, p[0], p[1], 0)); });
    scene.pits.forEach(function (pit) {
      pit.outline.forEach(function (p) {
        out.push(project(cam, p[0], p[1], 0));
        if (pit.depth > 0) out.push(project(cam, p[0], p[1], -pit.depth));
      });
    });
    return out;
  }

  // Опукла оболонка точок (алгоритм «монотонного ланцюга»): силует креслення без внутрішніх точок
  function convexHull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    function turn(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lower = [], upper = [];
    p.forEach(function (q) {
      while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    });
    for (var i = p.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
      upper.push(p[i]);
    }
    lower.pop(); upper.pop();              // крайні точки повторюються в обох ланцюгах
    return lower.concat(upper);
  }

  return {
    outline: outline, rect: rect, ellipse: ellipse, roundedRect: roundedRect,
    signedArea: signedArea, inside: inside,
    buildScene: buildScene, groundAt: groundAt,
    camera: camera, project: project, isVisible: isVisible,
    sceneLines: sceneLines, render: render, stableBounds: stableBounds,
    sceneCenter: sceneCenter, projectedPoints: projectedPoints, convexHull: convexHull
  };
})();

// Експорт для Node.js; у браузері й Apps Script рядок пропускається
if (typeof module !== 'undefined' && module.exports) module.exports = PondGeo;
