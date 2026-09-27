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
 *
 * v0.6.3 (D58, D59):
 *   1. Висота блока однакова для 4 ракурсів — найбільша з них за спільного масштабу; під час повороту
 *      вміст під схемою не рухається. Нижчий ракурс стоїть по центру блока.
 *   2. «біоплато» — біля середини зовнішньої сторони біоплато (найдальшої від ставка), за краєм ділянки землі:
 *      підпис не виходить за силует креслення і не додає висоти. Якщо в середині сторони підпис заходить під
 *      кнопку, він зсувається вздовж сторони (до 0,8 її півдовжини) — туди, де блок виходить найнижчим.
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
  var LABEL_GAP = 5;            // від краю ділянки землі до підпису «біоплато», px
  var BIO_TEXT = 'біоплато';
  var LABEL_SLIDE = [0, 0.4, -0.4, 0.8, -0.8]; // зсув підпису вздовж сторони, частки півдовжини: спершу середина
  var uid = 0;                  // унікальні id обрізок: на сторінці може бути кілька схем
  var cache = { key: null, fit: null }; // масштаб рахуємо один раз, а не на кожен кадр повороту
  var sceneCache = { key: null, levels: null, scene: null }; // сцена з геометрією сходинок — теж

  // Ламана → атрибут d; координати з одним знаком після коми — коротший SVG
  function pathD(pts, close) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('') + (close ? 'Z' : '');
  }

  /*
   * 3. Де писати «біоплато» (v0.6.3, D59): біля середини зовнішньої сторони біоплато — тієї, що найдальша від ставка.
   * Точка прив'язки — середина краю ділянки землі з цього боку (земля ширша за котлован на margin, pondgeo.js);
   * прямокутник підпису стоїть назовні від цього краю, впритул із зазором LABEL_GAP, і не перетинає його.
   * slide — зсув уздовж сторони в частках її півдовжини (0 — середина; −1…1).
   * Повертає { x, y } — точку прив'язки в екранних координатах креслення, м;
   * box — прямокутник тексту відносно неї, px; cx, base — центр і базова лінія тексту, px.
   */
  function bioLabel(scene, cam, fontPx, slide) {
    var bio = scene.bio;
    if (!bio || !bio.outer) return null;
    var o = bio.outer, n = o.n, t = o.t, u = (slide || 0) * o.half;
    // Відстань від сторони біоплато до краю землі вздовж нормалі назовні
    var d = 0;
    scene.ground.forEach(function (q) { d = Math.max(d, (q[0] - o.mid[0]) * n[0] + (q[1] - o.mid[1]) * n[1]); });
    var a = PondGeo.project(cam, o.mid[0] + n[0] * d + t[0] * u, o.mid[1] + n[1] * d + t[1] * u, 0);
    // Напрям краю на екрані і нормаль до нього, повернута назовні (туди ж, куди й проєкція n)
    var ts = [t[0] * cam.r[0] + t[1] * cam.r[1], (t[0] * cam.c[0] + t[1] * cam.c[1]) * cam.sinE];
    var ns = [n[0] * cam.r[0] + n[1] * cam.r[1], (n[0] * cam.c[0] + n[1] * cam.c[1]) * cam.sinE];
    var len = Math.hypot(ts[0], ts[1]), nu = [-ts[1] / len, ts[0] / len];
    if (nu[0] * ns[0] + nu[1] * ns[1] < 0) nu = [-nu[0], -nu[1]];
    // Розмір тексту: ширина ~0,62 висоти шрифту на літеру
    var w = 0.62 * fontPx * BIO_TEXT.length + 6, asc = 0.8 * fontPx, desc = 0.25 * fontPx, hh = asc + desc;
    // Центр тексту — на нормалі, на такій відстані, щоб прямокутник лише торкався краю (+ зазор)
    var dist = LABEL_GAP + Math.abs(nu[0]) * w / 2 + Math.abs(nu[1]) * hh / 2;
    var cx = nu[0] * dist, cy = nu[1] * dist;
    return { x: a[0], y: a[1], cx: cx, base: cy - hh / 2 + asc,
             box: { x0: cx - w / 2, x1: cx + w / 2, y0: cy - hh / 2, y1: cy + hh / 2 } };
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
      // Варіанти місця підпису (LABEL_SLIDE); cand — номер варіанта, для ракурсу вибирається один (place)
      LABEL_SLIDE.forEach(function (sl, ci) {
        var lab = bioLabel(scene, cam, fontPx, sl);
        if (!lab) return;
        // Верхній і нижній край підпису — по 5 точок: кнопка може стати між кутами
        var b = lab.box;
        for (var k = 0; k <= 4; k++) {
          var x = b.x0 + (b.x1 - b.x0) * k / 4;
          pts.push({ v: vi, cand: ci, mx: lab.x - c0[0], my: lab.y - c0[1], dx: x, dy: b.y0 });
          pts.push({ v: vi, cand: ci, mx: lab.x - c0[0], my: lab.y - c0[1], dx: x, dy: b.y1 });
        }
      });
    });
    var minX = Infinity, maxX = -Infinity, minY = Infinity;
    pts.forEach(function (p) { if (p.cand) return; minX = Math.min(minX, p.mx); maxX = Math.max(maxX, p.mx); minY = Math.min(minY, p.my); });

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
    // Точки кожного ракурсу окремо: зсув і висота рахуються для ракурсу, а не для суми всіх 4 (менше порожнечі).
    // base — креслення; cands[ci] — підпис у варіанті ci (порожньо, якщо біоплато немає)
    var byView = views.map(function (az, vi) {
      var mine = pts.filter(function (p) { return p.v === vi; });
      var base = mine.filter(function (p) { return p.cand === undefined; });
      var cands = LABEL_SLIDE.map(function (sl, ci) { return mine.filter(function (p) { return p.cand === ci; }); })
        .filter(function (c) { return c.length; });
      return { base: base, cands: cands.length ? cands : [[]] };
    });
    // Ракурс: найнижчий блок серед варіантів підпису; за рівної висоти — ближчий до середини сторони (менший ci)
    function viewPlace(bv, s, offX) {
      var best = null;
      bv.cands.forEach(function (c, ci) {
        // Зсунутий підпис не має виходити за бокові краї блока
        if (c.some(function (p) { var X = offX + s * p.mx + p.dx; return X < PAD || X > box.w - PAD; })) return;
        var v = vertical(bv.base.concat(c), s, offX);
        if (!best || v.h < best.h - 0.5) best = { t: v.t, h: v.h, k: LABEL_SLIDE[ci] };
      });
      return best;
    }
    function place(s) {
      var xl = Infinity, xr = -Infinity;
      // Ширина — за кресленням і підписом посередині сторони (зсунутий підпис лежить уздовж того самого краю)
      pts.forEach(function (p) { if (p.cand) return; var X = s * p.mx + p.dx; xl = Math.min(xl, X); xr = Math.max(xr, X); });
      if (xr - xl > box.w - 2 * PAD) return null;           // ширше за блок
      var offX = (box.w - xl - xr) / 2;                      // по центру блока (для всіх ракурсів однаково)
      var per = byView.map(function (bv) { return viewPlace(bv, s, offX); });
      // v0.6.3 (D58): висота блока — найбільша з 4 ракурсів і однакова для всіх: під час повороту не змінюється
      var H = Math.max.apply(null, per.map(function (v) { return v.h; }));
      return { s: s, offX: offX, h: H, per: per };
    }

    // Бінарний пошук найбільшого масштабу, за якого найвищий ракурс вміщається в hMax
    var lo = 0, hi = (box.w - 2 * PAD) / Math.max(1e-9, maxX - minX);
    for (var i = 0; i < 32; i++) {
      var mid = (lo + hi) / 2, r = place(mid);
      if (r && r.h <= opts.box.hMax) lo = mid; else hi = mid;
    }
    var best = place(lo) || { s: lo, offX: box.w / 2, h: hMin, per: views.map(function () { return { t: PAD, h: hMin, k: 0 }; }) };
    // Нижчий ракурс — по центру блока: зверху й знизу однаковий запас (межі кнопок не порушуються — лише зсув униз).
    // k — вибраний зсув підпису «біоплато» для ракурсу
    var fitViews = views.map(function (az, vi) {
      var v = best.per[vi];
      return { az: az, t: v.t + (best.h - v.h) / 2, h: best.h, k: v.k };
    });
    return { s: best.s, offX: best.offX, t: fitViews[0].t, h: best.h, minY: minY, center: center, views: fitViews };
  }

  // t і h для довільного кута: лінійно між двома сусідніми ракурсами (v0.6.3: h однакова — змінюється лише зсув t)
  function viewFit(fit, azimuth) {
    var vs = (fit.views || []).slice().sort(function (p, q) { return p.az - q.az; });
    if (!vs.length) return { t: fit.t, h: fit.h, k: 0 };
    var a = ((azimuth % 360) + 360) % 360;
    function lerp(x, y, e) { return (x || 0) + ((y || 0) - (x || 0)) * e; }
    for (var i = 0; i < vs.length; i++) {
      var p = vs[i], q = vs[(i + 1) % vs.length];
      var span = ((q.az - p.az) % 360 + 360) % 360 || 360, d = ((a - p.az) % 360 + 360) % 360;
      if (d <= span) { var e = d / span; return { t: lerp(p.t, q.t, e), h: lerp(p.h, q.h, e), k: lerp(p.k, q.k, e) }; }
    }
    return { t: vs[0].t, h: vs[0].h, k: vs[0].k || 0 };
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
    var vf = viewFit(fit, opts.azimuth);                   // зсув саме для цього ракурсу; висота — спільна (D58)
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

    // Підпис «біоплато»: біля середини зовнішньої сторони біоплато, за краєм землі (див. bioLabel)
    var lab = bioLabel(scene, cam, LABEL_PX * (opts.fs || 1), vf.k);
    if (lab) {
      var a = toSvg([lab.x, lab.y]);
      items.push({ tag: 'text', attrs: { x: (a[0] + lab.cx).toFixed(1), y: (a[1] + lab.base).toFixed(1), 'text-anchor': 'middle', 'class': 'sk-label s3-label' }, text: BIO_TEXT });
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

  return { build: build, draw: draw, layout: layout, viewFit: viewFit, bioLabel: bioLabel, LABEL_PX: LABEL_PX, ELEVATION: ELEVATION, FIT_VIEWS: FIT_VIEWS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sketch3D;
