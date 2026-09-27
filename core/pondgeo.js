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
   * Кільце сходинки для 3D: ділянки вздовж стінки лишаємо на стінці (лише проріджуємо до кроку контуру),
   * а внутрішній край спрощуємо (Дуглас — Пекер): дуги зі 120 точок → кілька десятків.
   * Інакше хорди спрощення відходять від стінки овалу на 1–2 см і дають фальшиві «підйоми».
   */
  function prepLevelRing(ring, wall, tol) {
    var n = ring.length, per = 0;
    wall.forEach(function (q, i) { var r = wall[(i + 1) % wall.length]; per += Math.hypot(r[0] - q[0], r[1] - q[1]); });
    var gap = per / wall.length, wallTol = 1e-6 + 2e-3 * Math.max.apply(null, bbox(wall).map(Math.abs));
    var onWall = ring.map(function (q) { return distToRing(q, wall) < wallTol; });
    // Сторона по стінці: обидва кінці й середина на стінці (хорда платформи між двома точками стінки — ні)
    var wallE = ring.map(function (q, i) {
      var r = ring[(i + 1) % n];
      return onWall[i] && onWall[(i + 1) % n] && distToRing([(q[0] + r[0]) / 2, (q[1] + r[1]) / 2], wall) < wallTol;
    });
    if (!wallE.some(Boolean)) return simplifyRing(ring, tol);
    // Обов'язкові вершини: стик стінки з краєм і точки стінки з кроком ≈ кроку контуру
    var keep = ring.map(function () { return false; }), last = null;
    // Злам стінки (кут прямокутника, заокруглення) проріджувати не можна
    function sharp(i) {
      var p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
      var e1 = [p1[0] - p0[0], p1[1] - p0[1]], e2 = [p2[0] - p1[0], p2[1] - p1[1]];
      var l = Math.hypot(e1[0], e1[1]) * Math.hypot(e2[0], e2[1]);
      return !l || (e1[0] * e2[0] + e1[1] * e2[1]) / l < Math.cos(10 * Math.PI / 180);
    }
    for (var i = 0; i < n; i++) {
      var before = wallE[(i - 1 + n) % n], after = wallE[i];
      if (before !== after || (before && sharp(i))) { keep[i] = true; last = ring[i]; }
      else if (before && after && (!last || Math.hypot(ring[i][0] - last[0], ring[i][1] - last[1]) >= gap)) { keep[i] = true; last = ring[i]; }
    }
    var forced = [];
    keep.forEach(function (k, i) { if (k) forced.push(i); });
    // Між сусідніми обов'язковими вершинами: стінку не чіпаємо, внутрішній край — Дуглас — Пекер
    for (var f = 0; f < forced.length; f++) {
      var a = forced[f], b = forced[(f + 1) % forced.length];
      if (b <= a) b += n;
      if (!wallE[a % n]) dpRange(ring, a, b, tol, keep);
    }
    return ring.filter(function (q, i) { return keep[i]; });
  }

  // Дуглас — Пекер на відрізку індексів a…b кільця (b може бути ≥ n — циклічно)
  function dpRange(ring, a, b, tol, keep) {
    var n = ring.length, A = ring[a % n], B = ring[b % n], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy, far = -1, idx = -1;
    for (var i = a + 1; i < b; i++) {
      var q = ring[i % n], t = L2 ? Math.max(0, Math.min(1, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / L2)) : 0;
      var d = Math.hypot(q[0] - A[0] - t * dx, q[1] - A[1] - t * dy);
      if (d > far) { far = d; idx = i; }
    }
    if (far > tol) { keep[idx % n] = true; dpRange(ring, a, idx, tol, keep); dpRange(ring, idx, b, tol, keep); }
  }

  // Спрощення кільця без стінки (дірка кільця-полиці): розрізаємо в найдальшій від першої точці
  function simplifyRing(ring, tol) {
    if (ring.length < 8) return ring.slice();
    function dp(pts, a, b, keep) {
      var ax = pts[a], bx = pts[b], dx = bx[0] - ax[0], dy = bx[1] - ax[1], L2 = dx * dx + dy * dy, far = -1, idx = -1;
      for (var i = a + 1; i < b; i++) {
        var t = L2 ? Math.max(0, Math.min(1, ((pts[i][0] - ax[0]) * dx + (pts[i][1] - ax[1]) * dy) / L2)) : 0;
        var d = Math.hypot(pts[i][0] - ax[0] - t * dx, pts[i][1] - ax[1] - t * dy);
        if (d > far) { far = d; idx = i; }
      }
      if (far > tol) { keep[idx] = true; dp(pts, a, idx, keep); dp(pts, idx, b, keep); }
    }
    // Кільце розрізаємо в найдальшій від першої точці: дві половини спрощуємо окремо
    var far = 0, cut = 0;
    ring.forEach(function (q, i) { var d = Math.hypot(q[0] - ring[0][0], q[1] - ring[0][1]); if (d > far) { far = d; cut = i; } });
    var keep = ring.map(function () { return false; });
    keep[0] = keep[cut] = true;
    var closed = ring.concat([ring[0]]), k2 = keep.concat([true]);
    dp(closed, 0, cut, k2); dp(closed, cut, ring.length, k2);
    return ring.filter(function (q, i) { return k2[i]; });
  }

  function distToRing(p, ring) {
    var m = Infinity;
    for (var i = 0; i < ring.length; i++) {
      var a = ring[i], b = ring[(i + 1) % ring.length], d = [b[0] - a[0], b[1] - a[1]], L2 = d[0] * d[0] + d[1] * d[1];
      var t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2)) : 0;
      m = Math.min(m, Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]));
    }
    return m;
  }

  function bbox(poly) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    poly.forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); });
    return b;
  }

  /*
   * p = { shape, L, W, D, bio: { L, W, depth } | null, levels: [{ poly, holes, depth }] | undefined }
   * Котлован (pit): { id, outline, depth, levels } — levels: сходинки { poly, holes, depth, box } у координатах плану
   */
  function buildScene(p) {
    var pond = { id: 'pond', outline: outline(p.shape, p.L, p.W), depth: p.D, levels: [] };
    var tol = 0.003 * Math.max(p.L, p.W);                     // 3 мм на 1 м розміру: на схемі непомітно
    (p.levels || []).forEach(function (lv) {
      if (!(lv.depth > 0 && lv.depth < p.D) || !lv.poly || lv.poly.length < 3) return;
      var poly = prepLevelRing(lv.poly, pond.outline, tol);
      pond.levels.push({ poly: poly, holes: (lv.holes || []).map(function (h) { return simplifyRing(h, tol); }), depth: lv.depth, box: bbox(poly) });
    });
    var pits = [pond];
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
      pit.levels.forEach(function (lv) {
        if (!(lv.depth < d)) return;
        if (lv.box && (q[0] < lv.box[0] || q[0] > lv.box[2] || q[1] < lv.box[1] || q[1] > lv.box[3])) return;
        if (inside(q, lv.poly) && !(lv.holes || []).some(function (h) { return inside(q, h); })) d = lv.depth;
      });
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
      pit.levels.forEach(function (lv) { add(lv.poly); (lv.holes || []).forEach(add); });
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

  // Перетин відрізків ab і cd: параметр t на ab (0…1) або null
  function segCross(a, b, c, d) {
    var r = [b[0] - a[0], b[1] - a[1]], q = [d[0] - c[0], d[1] - c[1]], den = cross(r, q);
    if (Math.abs(den) < 1e-12) return null;
    var ac = [c[0] - a[0], c[1] - a[1]], t = cross(ac, q) / den, u = cross(ac, r) / den;
    return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
  }

  /*
   * Статична геометрія сходинок (не залежить від кута огляду, рахуємо раз на сцену).
   * Кожну межу (стінку котлована і край кожної сходинки) ріжемо в точках перетину з іншими межами.
   * На кожному шматку «пробуємо» поверхню по обидва боки: якщо висоти різні — тут вертикальний підйом:
   *   верх підйому — лінія краю сходинки (kind 'step'), низ — лінія стику з нижчою поверхнею (kind 'floor').
   * Так перекриття шарів (D33) враховується саме собою: край під мілкішим шаром не малюється.
   * Вершини — кандидати на вертикальні ребра: стик краю зі стінкою, гострий поворот, силует (залежить від кута).
   */
  function levelGeometry(scene) {
    if (scene._lv) return scene._lv;
    var geo = { lines: [], verts: [] };
    scene.pits.forEach(function (pit) {
      if (!pit.levels.length || !(pit.depth > 0)) return;
      var size = Math.max.apply(null, bbox(pit.outline).map(Math.abs)) || 1;
      var eps = 2e-3 * size, wallTol = 1e-6 + 2e-3 * size;
      var z = function (q) { return groundAt(scene, q); };
      var chains = [{ ring: pit.outline, outline: true }];
      pit.levels.forEach(function (lv) { [lv.poly].concat(lv.holes || []).forEach(function (r) { chains.push({ ring: r, outline: false }); }); });
      var segs = [];
      chains.forEach(function (c) { c.ring.forEach(function (a, i) { segs.push([a, c.ring[(i + 1) % c.ring.length]]); }); });
      var onWall = function (q) { return distToRing(q, pit.outline) < wallTol; };
      function probe(q, n) { return [z([q[0] + n[0] * eps, q[1] + n[1] * eps]), z([q[0] - n[0] * eps, q[1] - n[1] * eps])]; }
      function normal(a, b) { var l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; }

      chains.forEach(function (c) {
        var ring = c.ring, n = ring.length, cur = { step: null, floor: null };
        function flush(k) { if (cur[k] && cur[k].pts.length > 1) geo.lines.push(cur[k]); cur[k] = null; }
        function put(k, a, b, zz) {
          var line = cur[k], last = line && line.pts[line.pts.length - 1];
          if (line && line.z === zz && Math.hypot(last[0] - a[0], last[1] - a[1]) < 1e-9) { line.pts.push([b[0], b[1], zz]); return; }
          flush(k);
          cur[k] = { pit: pit.id, kind: k, closed: false, z: zz, pts: [[a[0], a[1], zz], [b[0], b[1], zz]] };
        }
        var wallEdge = ring.map(function (a, i) {
          var b = ring[(i + 1) % n];
          return !c.outline && onWall([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        });
        for (var i = 0; i < n; i++) {
          var a = ring[i], b = ring[(i + 1) % n];
          if (wallEdge[i]) { flush('step'); flush('floor'); continue; }  // край сходинки по стінці = сама стінка
          var ts = [0, 1];
          segs.forEach(function (sg) { var t = segCross(a, b, sg[0], sg[1]); if (t !== null) ts.push(t); });
          ts.sort(function (x, y) { return x - y; });
          var nr = normal(a, b);
          for (var k = 0; k + 1 < ts.length; k++) {
            if (ts[k + 1] - ts[k] < 1e-9) continue;
            var pa = [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]];
            var pb = [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]];
            var zs = probe([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], nr);
            var flat = Math.abs(zs[0] - zs[1]) < 1e-9;
            // Край сходинки впритул до стінки: одна проба вже на землі — це стінка, а не підйом
            if (flat || (!c.outline && Math.max(zs[0], zs[1]) > -1e-9)) { flush('step'); flush('floor'); continue; }
            if (!c.outline) put('step', pa, pb, Math.max(zs[0], zs[1])); // верх стінки котлована — це край (rim)
            put('floor', pa, pb, Math.min(zs[0], zs[1]));
          }
        }
        flush('step'); flush('floor');

        // Вершини країв сходинок: вертикальні ребра підйому
        if (c.outline) return;
        for (var j = 0; j < n; j++) {
          var prevWall = wallEdge[(j - 1 + n) % n], nextWall = wallEdge[j];
          if (prevWall && nextWall) continue;
          var v = ring[j], pv = ring[(j - 1 + n) % n], nx = ring[(j + 1) % n];
          var n1 = normal(pv, v), n2 = normal(v, nx), zs2;
          var junction = prevWall !== nextWall;                    // край сходинки впирається в стінку
          if (junction) {
            // пробуємо трохи вздовж краю від стінки, по обидва боки краю
            var o = prevWall ? nx : pv, l = Math.hypot(o[0] - v[0], o[1] - v[1]) || 1;
            var q = [v[0] + (o[0] - v[0]) / l * eps, v[1] + (o[1] - v[1]) / l * eps];
            zs2 = probe(q, prevWall ? n2 : n1);
          } else {
            var bis = [n1[0] + n2[0], n1[1] + n2[1]], bl = Math.hypot(bis[0], bis[1]);
            zs2 = bl > 1e-9 ? probe(v, [bis[0] / bl, bis[1] / bl]) : probe(v, n1);
          }
          if (Math.abs(zs2[0] - zs2[1]) < 1e-9 || Math.max(zs2[0], zs2[1]) > -1e-9) continue;
          var e1 = [v[0] - pv[0], v[1] - pv[1]], e2 = [nx[0] - v[0], nx[1] - v[1]];
          var cosTurn = (e1[0] * e2[0] + e1[1] * e2[1]) / ((Math.hypot(e1[0], e1[1]) * Math.hypot(e2[0], e2[1])) || 1);
          geo.verts.push({ pit: pit.id, p: v, zt: Math.max(zs2[0], zs2[1]), zb: Math.min(zs2[0], zs2[1]),
                           fixed: junction || cosTurn < Math.cos(SHARP_TURN_DEG * Math.PI / 180), n1: n1, n2: n2 });
        }
      });
    });
    scene._lv = geo;
    return geo;
  }

  // Ребра котлованів у 3D: край (земля), контур дна, вертикальні ребра
  function sceneLines(scene, cam) {
    var lines = [];
    var geo = levelGeometry(scene);
    scene.pits.forEach(function (pit) {
      var o = pit.outline, n = o.length, D = pit.depth, stepped = pit.levels.length > 0;
      lines.push({ pit: pit.id, kind: 'rim', closed: true, pts: o.map(function (p) { return [p[0], p[1], 0]; }) });
      if (!(D > 0)) return;
      if (!stepped) lines.push({ pit: pit.id, kind: 'floor', closed: true, pts: o.map(function (p) { return [p[0], p[1], -D]; }) });
      // Зі сходинками низ стінки йде на висоті поверхні під нею — шматки з levelGeometry
      var cen = [0, 0];
      o.forEach(function (p) { cen[0] += p[0] / n; cen[1] += p[1] / n; });
      for (var i = 0; i < n; i++) {
        var prev = o[(i - 1 + n) % n], cur = o[i], next = o[(i + 1) % n];
        var e1 = [cur[0] - prev[0], cur[1] - prev[1]], e2 = [next[0] - cur[0], next[1] - cur[1]];
        var cosTurn = (e1[0] * e2[0] + e1[1] * e2[1]) / (Math.hypot(e1[0], e1[1]) * Math.hypot(e2[0], e2[1]));
        var sharp = cosTurn < Math.cos(SHARP_TURN_DEG * Math.PI / 180);
        // Зовнішня нормаль ребра (обхід за годинниковою на екрані): (e.y, −e.x)
        var s1 = e1[1] * cam.c[0] - e1[0] * cam.c[1], s2 = e2[1] * cam.c[0] - e2[0] * cam.c[1];
        var silhouette = s1 * s2 < 0; // округла стінка тут повертається від глядача
        if (sharp || silhouette) {
          var zb = -D;
          if (stepped) {                                        // низ ребра — поверхня біля кута всередині
            var dl = Math.hypot(cen[0] - cur[0], cen[1] - cur[1]) || 1, e = 3e-3 * Math.max(Math.abs(cur[0]), Math.abs(cur[1]), 1);
            zb = groundAt(scene, [cur[0] + (cen[0] - cur[0]) / dl * e, cur[1] + (cen[1] - cur[1]) / dl * e]);
          }
          lines.push({ pit: pit.id, kind: 'edge', closed: false, pts: [[cur[0], cur[1], 0], [cur[0], cur[1], zb]] });
        }
      }
    });
    geo.lines.forEach(function (l) { lines.push(l); });
    // Вертикальні ребра підйомів: стик зі стінкою і гострі кути — завжди; на дугах — лише силует
    geo.verts.forEach(function (v) {
      var s1 = v.n1[0] * cam.c[0] + v.n1[1] * cam.c[1], s2 = v.n2[0] * cam.c[0] + v.n2[1] * cam.c[1];
      if (v.fixed || s1 * s2 < 0) lines.push({ pit: v.pit, kind: 'edge', closed: false, pts: [[v.p[0], v.p[1], v.zt], [v.p[0], v.p[1], v.zb]] });
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
      // Поверхні сходинок — від глибокої до мілкої: мілкіша малюється зверху
      pit.levels.slice().sort(function (a, b) { return b.depth - a.depth; }).forEach(function (lv) {
        var pr = function (r) { return r.map(function (p) { return project(cam, p[0], p[1], -lv.depth); }); };
        out.fills.push({ pit: pit.id, kind: 'level', depth: lv.depth, pts: pr(lv.poly), holes: (lv.holes || []).map(pr) });
      });
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
    sceneCenter: sceneCenter, projectedPoints: projectedPoints, convexHull: convexHull,
    simplifyRing: simplifyRing, levelGeometry: levelGeometry
  };
})();

// Експорт для Node.js; у браузері й Apps Script рядок пропускається
if (typeof module !== 'undefined' && module.exports) module.exports = PondGeo;
