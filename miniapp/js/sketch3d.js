/*
 * miniapp/js/sketch3d.js — 3D-схема ставка в SVG (аксонометрія, як на кресленні).
 * Геометрія й видимість — у core/pondgeo.js; тут лише перетворення в SVG-елементи.
 * build() повертає опис елементів без DOM (зручно тестувати й вставляти на сайт), draw() малює в <svg>.
 */
var Sketch3D = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var VIEW_W = 320;
  var PAD = { top: 44, right: 12, bottom: 50, left: 12 }; // згори — підпис і перемикач 2D/3D, знизу — стрілки
  var ELEVATION = 40;       // кут погляду над горизонтом, °
  var MAX_H_K = 0.85;       // схема не вища за 0,85 ширини (глибокий вузький ставок зменшуємо)
  var STEP_PX = 1.5;        // крок перевірки видимості вздовж ребра, px
  var uid = 0;              // унікальні id обрізок: на сторінці може бути кілька схем

  // Ламана → атрибут d; координати з одним знаком після коми — коротший SVG
  function pathD(pts, close) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('') + (close ? 'Z' : '');
  }

  /*
   * opts = { shape, L, W, D, bio: { L, W, depth } | null, azimuth, caption }
   * Повертає { viewBox, items: [{ tag, attrs, text? }] }
   */
  function build(opts) {
    var items = [];
    if (!(opts.L > 0 && opts.W > 0 && opts.D > 0)) {
      items.push({ tag: 'text', attrs: { x: VIEW_W / 2, y: 90, 'text-anchor': 'middle', 'class': 'sk-hint' },
        text: 'Введіть довжину, ширину й глибину — з\'явиться 3D' });
      return { viewBox: '0 0 ' + VIEW_W + ' 180', items: items };
    }

    var scene = PondGeo.buildScene(opts);
    var b = PondGeo.stableBounds(scene, ELEVATION);
    var bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    var areaW = VIEW_W - PAD.left - PAD.right;
    var scale = areaW / bw;                                   // px на 1 м
    var viewH = PAD.top + PAD.bottom + bh * scale;
    if (viewH > VIEW_W * MAX_H_K) {                            // зависоко — зменшуємо масштаб за висотою
      viewH = VIEW_W * MAX_H_K;
      scale = (viewH - PAD.top - PAD.bottom) / bh;
    }
    var offX = PAD.left + (areaW - bw * scale) / 2;

    var cam = PondGeo.camera(opts.azimuth, ELEVATION);
    var c0 = PondGeo.project(cam, b.center[0], b.center[1], 0);
    // Екранні координати креслення → координати SVG: центр сцени лишається на місці під час повороту
    function toSvg(p) { return [offX + (p[0] - c0[0] - b.minX) * scale, PAD.top + (p[1] - c0[1] - b.minY) * scale]; }
    function mapPts(pts) { return pts.map(toSvg); }

    var r = PondGeo.render(scene, cam, STEP_PX / scale);

    // 1. Заливки: земля; отвір котлована = видимі стінки; дно поверх, обрізане краєм (земля заступає решту)
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
    });

    // 2. Невидимі ребра — пунктиром, 3. видимі — суцільні (поверх)
    r.hidden.forEach(function (l) {
      items.push({ tag: 'path', attrs: { d: pathD(mapPts(l.pts), false), 'class': 's3-line s3-line--hidden' } });
    });
    r.visible.forEach(function (l) {
      items.push({ tag: 'path', attrs: { d: pathD(mapPts(l.pts), false), 'class': 's3-line' + (l.kind === 'rim' ? ' s3-line--rim' : '') } });
    });

    // 4. Підписи: розміри вгорі ліворуч, «біоплато» — над його котлованом
    if (opts.caption) {
      items.push({ tag: 'text', attrs: { x: PAD.left, y: 20, 'class': 'sk-label' }, text: opts.caption });
    }
    var bioPit = scene.pits.filter(function (p) { return p.id === 'bio'; })[0];
    if (bioPit) {
      var xs = bioPit.outline.map(function (p) { return p[0]; }), ys = bioPit.outline.map(function (p) { return p[1]; });
      var top = bioPit.outline.map(function (p) { return toSvg(PondGeo.project(cam, p[0], p[1], 0)); })
        .reduce(function (a, p) { return p[1] < a[1] ? p : a; });
      var mid = toSvg(PondGeo.project(cam, (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2,
        (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2, 0));
      items.push({ tag: 'text', attrs: { x: mid[0].toFixed(1), y: (top[1] - 6).toFixed(1), 'text-anchor': 'middle', 'class': 'sk-label s3-label' }, text: 'біоплато' });
    }

    return { viewBox: '0 0 ' + VIEW_W + ' ' + Math.round(viewH), items: items };
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
  }

  return { build: build, draw: draw, ELEVATION: ELEVATION };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sketch3D;
