/*
 * miniapp/js/sketch3d.js — 3D-схема ставка в SVG (аксонометрія, як на кресленні).
 * Геометрія й видимість — у core/pondgeo.js; тут лише масштаб, розкладка і перетворення в SVG-елементи.
 * build() повертає опис елементів без DOM (зручно тестувати й вставляти на сайт), draw() малює в <svg>.
 *
 * v0.4.1 — масштаб «на весь блок»:
 *   1. SVG у реальних пікселях (viewBox = розмір блока), тож схема займає всю ширину, а в альбомній
 *      орієнтації — всю висоту екрана.
 *   2. Масштаб рахуємо лише для 4 ракурсів (раніше — для всіх 360°) і однаковий для всіх: під час повороту не стрибає.
 *   3. Кнопки й підписи поверх схеми (2D/3D, стрілки, крапки) задаються прямокутниками avoid:
 *      креслення підходить до них впритул, але не залазить під них.
 */
var Sketch3D = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var ELEVATION = 40;           // кут погляду над горизонтом, °
  var FIT_VIEWS = [135, 225, 315, 45]; // ракурси, для яких підбираємо масштаб (як у app.js)
  var PAD = 6;                  // мінімальний відступ креслення від краю блока, px
  var GAP = 6;                  // відступ від кнопок поверх схеми, px
  var STEP_PX = 1.5;            // крок перевірки видимості вздовж ребра, px
  var STEP_PX_FAST = 3;         // під час анімації повороту — грубіше, щоб кадри встигали на телефоні
  var LABEL_PX = 13;            // розмір шрифту підписів (множиться на --fs), як .s3-label у CSS
  var LABEL_GAP = 5;            // від котлована до підпису «біоплато», px
  var BIO_TEXT = 'біоплато';
  var uid = 0;                  // унікальні id обрізок: на сторінці може бути кілька схем
  var cache = { key: null, fit: null }; // масштаб рахуємо один раз, а не на кожен кадр повороту
  var sceneCache = { key: null, levels: null, scene: null }; // сцена з геометрією сходинок — теж

  // Ламана → атрибут d; координати з одним знаком після коми — коротший SVG
  function pathD(pts, close) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('') + (close ? 'Z' : '');
  }

  function pitById(scene, id) { return scene.pits.filter(function (p) { return p.id === id; })[0]; }

  function bboxCenter(poly) {
    var xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
    return [(Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2];
  }

  /*
   * 3. Де писати «біоплато»: над котлованом, коли біоплато за ставком, і під ним, коли перед ставком
   * (інакше напис лягає на сам ставок). Повертає точку прив'язки в екранних координатах креслення, м.
   */
  function bioLabelAnchor(scene, cam) {
    // Ділянка біоплато: окремий котлован або мілка зона спільного дзеркала («Разом», D56)
    var bio = scene.bio;
    if (!bio) return null;
    var bc = bboxCenter(bio.outline), pc = bboxCenter(scene.pondOutline || pitById(scene, 'pond').outline);
    // Біоплато ближче до глядача, ніж ставок → воно «спереду»
    var front = (bc[0] - pc[0]) * cam.c[0] + (bc[1] - pc[1]) * cam.c[1] > 0;
    var mid = PondGeo.project(cam, bc[0], bc[1], 0);
    var y = front ? -Infinity : Infinity;
    bio.outline.forEach(function (p) {
      if (front) {
        // знизу: під найнижчою точкою, враховуючи й дно (пунктир теж частина креслення)
        y = Math.max(y, PondGeo.project(cam, p[0], p[1], 0)[1], PondGeo.project(cam, p[0], p[1], -bio.depth)[1]);
      } else {
        y = Math.min(y, PondGeo.project(cam, p[0], p[1], 0)[1]);
      }
    });
    return { x: mid[0], y: y, below: front };
  }

  // Прямокутник підпису відносно точки прив'язки, px. Ширину тексту оцінюємо (~0,6 висоти шрифту на літеру)
  function labelBox(below, fontPx) {
    var w = 0.62 * fontPx * BIO_TEXT.length + 6, asc = 0.8 * fontPx, desc = 0.25 * fontPx;
    return below
      ? { x0: -w / 2, x1: w / 2, y0: LABEL_GAP, y1: LABEL_GAP + asc + desc, base: LABEL_GAP + asc }
      : { x0: -w / 2, x1: w / 2, y0: -LABEL_GAP - asc, y1: -LABEL_GAP + desc, base: -LABEL_GAP };
  }

  /*
   * 1. Масштаб і розкладка. Точки силуету всіх 4 ракурсів: { mx, my } — метри (відносно центру сцени),
   * dx, dy — додатковий зсув у px (кути підпису). Для масштабу s:
   *   X = offX + s·mx + dx,  Y = t + s·(my − minY) + dy.
   * Шукаємо найбільший s, за якого креслення вміщається в ширину, висота блока ≤ hMax
   * і жодна точка не потрапляє під кнопки (avoid.top — біля верхнього краю, avoid.bottom — біля нижнього).
   */
  function fitLayout(scene, opts) {
    var box = opts.box, avoid = opts.avoid || {}, tops = avoid.top || [], bottoms = avoid.bottom || [];
    var fontPx = LABEL_PX * (opts.fs || 1);
    var center = PondGeo.sceneCenter(scene), pts = [], views = opts.views || FIT_VIEWS;
    views.forEach(function (az, vi) {
      var cam = PondGeo.camera(az, ELEVATION), c0 = PondGeo.project(cam, center[0], center[1], 0);
      var hull = PondGeo.convexHull(PondGeo.projectedPoints(scene, cam).map(function (p) { return [p[0] - c0[0], p[1] - c0[1]]; }));
      var span = 0;
      hull.forEach(function (p) { span = Math.max(span, Math.abs(p[0]), Math.abs(p[1])); });
      // Точки вздовж сторін силуету: сторона може перетнути кнопку навіть без вершини всередині
      hull.forEach(function (a, i) {
        var b = hull[(i + 1) % hull.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (span / 80)));
        for (var k = 0; k < n; k++) pts.push({ v: vi, mx: a[0] + (b[0] - a[0]) * k / n, my: a[1] + (b[1] - a[1]) * k / n, dx: 0, dy: 0 });
      });
      var lab = bioLabelAnchor(scene, cam);
      if (lab) {
        var lb = labelBox(lab.below, fontPx);
        [[lb.x0, lb.y0], [lb.x1, lb.y0], [lb.x1, lb.y1], [lb.x0, lb.y1], [0, lb.y0], [0, lb.y1]].forEach(function (d) {
          pts.push({ v: vi, mx: lab.x - c0[0], my: lab.y - c0[1], dx: d[0], dy: d[1] });
        });
      }
    });
    var minX = Infinity, maxX = -Infinity, minY = Infinity;
    pts.forEach(function (p) { minX = Math.min(minX, p.mx); maxX = Math.max(maxX, p.mx); minY = Math.min(minY, p.my); });

    // Мінімальна висота: щоб кнопки згори й знизу не налазили одна на одну
    var hMin = PAD * 2;
    tops.forEach(function (r) { bottoms.forEach(function (q) { hMin = Math.max(hMin, r.y1 + q.h + GAP); }); });

    var inX = function (X, r) { return X >= r.x0 - GAP && X <= r.x1 + GAP; };
    // Зсув згори (t) і висота блока (h) для набору точок: креслення не заходить під кнопки
    function vertical(list, s, offX) {
      var t = 0, h = hMin;
      list.forEach(function (p) {
        var X = offX + s * p.mx + p.dx, Y = s * (p.my - minY) + p.dy;
        t = Math.max(t, PAD - Y);
        tops.forEach(function (r) { if (inX(X, r)) t = Math.max(t, r.y1 + GAP - Y); });
      });
      list.forEach(function (p) {
        var X = offX + s * p.mx + p.dx, Y = t + s * (p.my - minY) + p.dy;
        h = Math.max(h, Y + PAD);
        bottoms.forEach(function (r) { if (inX(X, r)) h = Math.max(h, Y + GAP + r.h); });
      });
      return { t: t, h: h };
    }
    function place(s) {
      var xl = Infinity, xr = -Infinity;
      pts.forEach(function (p) { var X = s * p.mx + p.dx; xl = Math.min(xl, X); xr = Math.max(xr, X); });
      if (xr - xl > box.w - 2 * PAD) return null;           // ширше за блок
      var offX = (box.w - xl - xr) / 2;                      // по центру блока (для всіх ракурсів однаково)
      var all = vertical(pts, s, offX);
      return { s: s, offX: offX, t: all.t, h: all.h, minY: minY, center: center };
    }

    // Бінарний пошук найбільшого масштабу, що вміщається
    var lo = 0, hi = (box.w - 2 * PAD) / Math.max(1e-9, maxX - minX);
    for (var i = 0; i < 32; i++) {
      var mid = (lo + hi) / 2, r = place(mid);
      if (r && r.h <= opts.box.hMax) lo = mid; else hi = mid;
    }
    var fit = place(lo) || { s: lo, offX: box.w / 2, t: PAD, h: hMin, minY: minY, center: center };
    // v0.6.2 (D57): масштаб — спільний для 4 ракурсів (≤ hMax у кожному), а висота блока — своя для ракурсу:
    // згори й знизу немає порожнечі, яку «тримав» найвищий ракурс. Між ракурсами — плавний перехід (viewFit)
    fit.views = views.map(function (az, vi) {
      var v = vertical(pts.filter(function (p) { return p.v === vi; }), fit.s, fit.offX);
      return { az: az, t: v.t, h: v.h };
    });
    return fit;
  }

  // t і h для довільного кута: лінійно між двома сусідніми ракурсами (під час повороту висота змінюється плавно)
  function viewFit(fit, azimuth) {
    var vs = (fit.views || []).slice().sort(function (p, q) { return p.az - q.az; });
    if (!vs.length) return { t: fit.t, h: fit.h };
    var a = ((azimuth % 360) + 360) % 360;
    for (var i = 0; i < vs.length; i++) {
      var p = vs[i], q = vs[(i + 1) % vs.length];
      var span = ((q.az - p.az) % 360 + 360) % 360 || 360, d = ((a - p.az) % 360 + 360) % 360;
      if (d <= span) { var k = d / span; return { t: p.t + (q.t - p.t) * k, h: p.h + (q.h - p.h) * k }; }
    }
    return { t: vs[0].t, h: vs[0].h };
  }

  /*
   * opts = { shape, L, W, D, bio: { L, W, depth, side, joined } | null, levels: [{ poly, holes, depth }], azimuth, fast,
   *          box: { w, hMax } — ширина блока і найбільша висота, px,
   *          avoid: { top: [{ x0, x1, y1 }], bottom: [{ x0, x1, h }] } — кнопки поверх схеми, px,
   *          fs — множник розміру тексту }
   * Повертає { viewBox, height, items: [{ tag, attrs, text? }] }
   */
  // Масштаб і розкладка для opts (з кешу, поки не змінились розміри) — app.js плавно переходить між ними
  function layout(opts) {
    var skey = JSON.stringify([opts.shape, opts.L, opts.W, opts.D, opts.bio]);
    if (sceneCache.key !== skey || sceneCache.levels !== opts.levels) {
      sceneCache = { key: skey, levels: opts.levels, scene: PondGeo.buildScene(opts) };
    }
    var key = JSON.stringify([opts.shape, opts.L, opts.W, opts.D, opts.bio, opts.box, opts.avoid, opts.fs, opts.views]);
    if (cache.key !== key) cache = { key: key, fit: fitLayout(sceneCache.scene, opts) };
    return cache.fit;
  }

  function build(opts) {
    var items = [];
    var box = opts.box || { w: 320, hMax: 272 };
    if (!(opts.L > 0 && opts.W > 0 && opts.D > 0)) {
      var hh = Math.min(box.hMax, 180);
      items.push({ tag: 'text', attrs: { x: box.w / 2, y: hh / 2, 'text-anchor': 'middle', 'class': 'sk-hint' },
        text: 'Введіть довжину, ширину й глибину — з\'явиться 3D' });
      return { viewBox: '0 0 ' + box.w + ' ' + hh, height: hh, items: items };
    }

    // Сцена й масштаб не залежать від кута: під час повороту беремо ті самі (кеш у layout).
    // opts.fit — проміжний масштаб плавного переходу з app.js (біоплато ввімкнули / перенесли)
    var target = layout(opts), scene = sceneCache.scene;
    var fit = opts.fit || target, s = fit.s;

    var cam = PondGeo.camera(opts.azimuth, ELEVATION);
    var c0 = PondGeo.project(cam, fit.center[0], fit.center[1], 0);
    var vf = viewFit(fit, opts.azimuth);                   // зсув і висота саме для цього ракурсу (D57)
    // Екранні координати креслення → px SVG: по горизонталі центр сцени лишається на місці під час повороту
    function toSvg(p) { return [fit.offX + (p[0] - c0[0]) * s, vf.t + (p[1] - c0[1] - fit.minY) * s]; }
    function mapPts(pts) { return pts.map(toSvg); }

    var r = PondGeo.render(scene, cam, (opts.fast ? STEP_PX_FAST : STEP_PX) / s);

    // Заливки: земля; отвір котлована = видимі стінки; дно поверх, обрізане краєм (земля заступає решту)
    var defs = { tag: 'defs', attrs: {}, children: [] };
    items.push(defs);
    var ground = r.fills.filter(function (f) { return f.kind === 'ground'; })[0];
    if (ground) items.push({ tag: 'path', attrs: { d: pathD(mapPts(ground.pts), true), 'class': 's3-ground' } });
    uid++;
    scene.pits.forEach(function (pit) {
      var rim = r.fills.filter(function (f) { return f.pit === pit.id && f.kind === 'rim'; })[0];
      var floor = r.fills.filter(function (f) { return f.pit === pit.id && f.kind === 'floor'; })[0];
      var clipId = 's3clip-' + uid + '-' + pit.id;
      defs.children.push({ tag: 'clipPath', attrs: { id: clipId },
        children: [{ tag: 'path', attrs: { d: pathD(mapPts(rim.pts), true) } }] });
      items.push({ tag: 'path', attrs: { d: pathD(mapPts(rim.pts), true), 'class': 's3-wall' } });
      if (floor) {
        items.push({ tag: 'path', attrs: { d: pathD(mapPts(floor.pts), true), 'class': 's3-floor', 'clip-path': 'url(#' + clipId + ')' } });
      }
      // Сходинки: від глибокої до мілкої (порядок уже в render), кільце — з діркою
      r.fills.filter(function (f) { return f.pit === pit.id && f.kind === 'level'; }).forEach(function (f) {
        var d = pathD(mapPts(f.pts), true) + f.holes.map(function (h) { return pathD(mapPts(h), true); }).join('');
        // f.water — ставок як «рівень» під глибшим біоплато «Разом»: заливка водою, як дно
        items.push({ tag: 'path', attrs: { d: d, 'fill-rule': 'evenodd', 'class': f.water ? 's3-floor' : 's3-level', 'clip-path': 'url(#' + clipId + ')' } });
      });
    });

    // Невидимі ребра — пунктиром, видимі — суцільні (поверх)
    r.hidden.forEach(function (l) {
      items.push({ tag: 'path', attrs: { d: pathD(mapPts(l.pts), false), 'class': 's3-line s3-line--hidden' } });
    });
    r.visible.forEach(function (l) {
      items.push({ tag: 'path', attrs: { d: pathD(mapPts(l.pts), false), 'class': 's3-line' + (l.kind === 'rim' ? ' s3-line--rim' : l.kind === 'step' ? ' s3-line--step' : '') } });
    });

    // Підпис «біоплато»: над котлованом або під ним (див. bioLabelAnchor)
    var lab = bioLabelAnchor(scene, cam);
    if (lab) {
      var a = toSvg([lab.x, lab.y]), lb = labelBox(lab.below, LABEL_PX * (opts.fs || 1));
      items.push({ tag: 'text', attrs: { x: a[0].toFixed(1), y: (a[1] + lb.base).toFixed(1), 'text-anchor': 'middle', 'class': 'sk-label s3-label' }, text: BIO_TEXT });
    }

    var h = Math.round(vf.h);
    return { viewBox: '0 0 ' + Math.round(box.w) + ' ' + h, height: h, items: items };
  }

  // Малює опис елементів у DOM
  function append(parent, it) {
    var n = document.createElementNS(NS, it.tag);
    Object.keys(it.attrs).forEach(function (k) { n.setAttribute(k, it.attrs[k]); });
    if (it.text) n.textContent = it.text;
    (it.children || []).forEach(function (ch) { append(n, ch); });
    parent.appendChild(n);
  }

  function draw(svg, opts) {
    var model = build(opts);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', model.viewBox);
    model.items.forEach(function (it) { append(svg, it); });
    return model;
  }

  return { build: build, draw: draw, layout: layout, viewFit: viewFit, bioLabelAnchor: bioLabelAnchor, ELEVATION: ELEVATION, FIT_VIEWS: FIT_VIEWS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sketch3D;
