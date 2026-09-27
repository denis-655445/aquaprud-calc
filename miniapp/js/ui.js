/*
 * miniapp/js/ui.js — відображення: схема ставка, списки, рядки кошторису.
 * Тут немає розрахунків (вони в core/calc.js) і немає стану (він в app.js).
 */
var UI = (function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Створює елемент; текст вставляємо через textContent — назви з прайсу не виконаються як HTML
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // Заповнює випадний список: спершу службові варіанти (none / kit), потім позиції прайсу
  function fillSelect(select, items, special) {
    select.innerHTML = '';
    (special || []).forEach(function (sp) {
      var o = el('option', null, sp.label);
      o.value = sp.value;
      o.dataset.label = sp.label;
      select.appendChild(o);
    });
    items.forEach(function (it) {
      var o = el('option', null, it.name);
      o.value = it.id;
      o.dataset.label = it.name;
      select.appendChild(o);
    });
  }

  // Позначає рекомендований варіант зірочкою, а сам список — жирним, якщо вибрано рекомендоване
  function markSelect(select, recValue) {
    Array.prototype.forEach.call(select.options, function (o) {
      o.textContent = (o.value === recValue ? '★ ' : '') + o.dataset.label;
    });
    select.classList.toggle('is-auto', !!recValue && select.value === recValue);
  }

  // Підпис під полем обладнання: «Рекомендовано» / «Змінено вручну» + кнопка повернення / попередження
  function setNote(noteEl, opts) {
    noteEl.innerHTML = '';
    if (opts.warn) {
      noteEl.appendChild(el('span', 'warn', opts.warn));
      return;
    }
    if (opts.auto) {
      noteEl.appendChild(el('span', 'rec', 'Рекомендовано' + (opts.recSuffix || '')));
      if (opts.extra) noteEl.appendChild(el('span', null, opts.extra));
      return;
    }
    if (opts.manual) {
      noteEl.appendChild(el('span', null, 'Змінено вручну.'));
      var b = el('button', 'linkbtn', 'Повернути рекомендоване');
      b.type = 'button';
      b.dataset.reset = opts.key; // обробник — делегування в app.js
      noteEl.appendChild(b);
    }
  }

  /*
   * Розкладка 2D-схеми (v0.6.3, D60) — чиста функція без DOM.
   * pts — що має вміститися: { mx, my } — точка плану, м; dx, dy — зсув від неї, px (підписи, кружечки точок).
   * box = { w, hMax } — ширина блока і найбільша висота, px; tops = [{ x0, x1, y1 }] — кнопки біля верхнього краю;
   * bottoms = [{ x0, x1, h }] — біля нижнього (v0.7.0: стрілки ‹ › і крапки видів є і в 2D).
   * Правила:
   *   1. Масштаб s — найбільший, за якого креслення вміщається в ширину блока і в hMax.
   *   2. Креслення починається згори (без порожнечі над ним); поруч із кнопкою воно зсувається вбік від неї,
   *      а не опускається під неї. Нижче кнопки — уся ширина.
   *   3. Блок не нижчий за кнопку; коли креслення нижче за неї — стоїть по центру по вертикалі.
   * Повертає { s, offX, t, h }: X = offX + s·mx + dx, Y = t + s·my + dy; h — висота блока.
   */
  var PLAN_PAD = 6, PLAN_GAP = 6;
  function fitPlan(pts, box, tops, bottoms) {
    tops = tops || []; bottoms = bottoms || [];
    var hMin = PLAN_PAD * 2;
    tops.forEach(function (r) { hMin = Math.max(hMin, r.y1 + PLAN_PAD); });   // блок не нижчий за перемикач
    // Кнопки згори й знизу з одного боку не налазять одна на одну (перемикач над стрілками)
    tops.forEach(function (r) { bottoms.forEach(function (q) { if (r.x1 > q.x0 && q.x1 > r.x0) hMin = Math.max(hMin, r.y1 + q.h + PLAN_GAP); }); });
    function place(sc) {
      var xl = Infinity, xr = -Infinity, yt = Infinity, yb = -Infinity;
      pts.forEach(function (p) {
        var X = sc * p.mx + p.dx, Y = sc * p.my + p.dy;
        xl = Math.min(xl, X); xr = Math.max(xr, X); yt = Math.min(yt, Y); yb = Math.max(yb, Y);
      });
      if (xr - xl > box.w - 2 * PLAN_PAD) return null;                          // ширше за блок
      var h = Math.max(hMin, yb - yt + 2 * PLAN_PAD);
      var t = (h - (yb - yt)) / 2 - yt;                                          // згори; у високому блоці — по центру
      // Допустимий зсув по горизонталі: у межах блока і вбік від кнопок для точок на їхній висоті
      var lo = PLAN_PAD - xl, hi = box.w - PLAN_PAD - xr;
      tops.forEach(function (r) {
        var onRight = (r.x0 + r.x1) / 2 > box.w / 2;
        pts.forEach(function (p) {
          if (t + sc * p.my + p.dy >= r.y1 + PLAN_GAP) return;                   // нижче кнопки — можна на всю ширину
          var X = sc * p.mx + p.dx;
          if (onRight) hi = Math.min(hi, r.x0 - PLAN_GAP - X); else lo = Math.max(lo, r.x1 + PLAN_GAP - X);
        });
      });
      bottoms.forEach(function (r) {
        var onRight = (r.x0 + r.x1) / 2 > box.w / 2;
        pts.forEach(function (p) {
          if (t + sc * p.my + p.dy <= h - r.h - PLAN_GAP) return;                // вище кнопки — можна на всю ширину
          var X = sc * p.mx + p.dx;
          if (onRight) hi = Math.min(hi, r.x0 - PLAN_GAP - X); else lo = Math.max(lo, r.x1 + PLAN_GAP - X);
        });
      });
      if (lo > hi + 1e-9) return null;                                           // не вміщається поруч із кнопкою
      // По центру блока, а якщо заважає кнопка — рівно настільки ближче до іншого краю, наскільки треба
      var offX = Math.min(Math.max((box.w - xl - xr) / 2, lo), hi);
      return { s: sc, offX: offX, t: t, h: h };
    }
    var mx0 = Infinity, mx1 = -Infinity;
    pts.forEach(function (p) { mx0 = Math.min(mx0, p.mx); mx1 = Math.max(mx1, p.mx); });
    var lo = 0, hi = (box.w - 2 * PLAN_PAD) / Math.max(1e-9, mx1 - mx0);
    for (var it = 0; it < 30; it++) {                     // бінарний пошук, як у 3D
      var mid = (lo + hi) / 2, r0 = place(mid);
      if (r0 && r0.h <= box.hMax) lo = mid; else hi = mid;
    }
    return place(lo) || { s: lo, offX: PLAN_PAD, t: PLAN_PAD, h: Math.max(hMin, 60) };
  }

  /*
   * Схема ставка зверху в реальних пропорціях + біоплато Bio-1 … Bio-4 (m.bioPlates, v0.7.1).
   * bioOpt = { joined } — біоплато «Разом» (впритул, одне дзеркало, D56) або «Окремо» (з проміжком).
   * overlay (Про-режим, необов'язково) — у координатах плану, м:
   *   layers: [{ rings: [[[x, y], …], …], rank, active, error }] — сходинки (rank 0 — наймілкіша);
   *   points: [{ id, p: [x, y], selected }] — точки активної сходинки, їх натискають (data-point).
   */
  function drawSketch(svg, shape, m, overlay, bioOpt, fitOpt) {
    var NS = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // SVG у реальних пікселях блока, як 3D. Розмір і місце креслення — fitPlan (v0.6.3, D60):
    // hMax 2D менший, ніж у 3D (app.js), а поруч із перемикачем 2D / 3D креслення зсувається ліворуч
    fitOpt = fitOpt || {};
    var box = fitOpt.box || { w: 320, hMax: 190 }, tops = (fitOpt.avoid && fitOpt.avoid.top) || [];
    var bottoms = (fitOpt.avoid && fitOpt.avoid.bottom) || [];
    var fontPx = 12 * (fitOpt.fs || 1);                  // як .sk-label: 12px × --fs
    var PAD = PLAN_PAD;

    function node(tag, attrs, text, parent) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text) n.textContent = text;
      (parent || svg).appendChild(n);
      return n;
    }

    if (!(m.L > 0 && m.W > 0)) {
      var hh = Math.min(box.hMax, 150);
      svg.setAttribute('viewBox', '0 0 ' + Math.round(box.w) + ' ' + hh);
      node('text', { x: box.w / 2, y: hh / 2 + 16, 'text-anchor': 'middle', 'class': 'sk-hint' }, 'Тут з\'явиться схема ставка');
      return;
    }
    var ov = overlay || { layers: [], points: [] };
    var withPts = ov.points.length > 0;

    // Біоплато (PondGeo.bioGeometry, те саме, що в 3D): «Разом» — спільний контур дзеркала, мілкі зони й шов
    // по стінці ставка; «Окремо» — котловани з проміжком. Підписи розмірів — на вільному від Bio боці
    bioOpt = bioOpt || {};
    var bg = m.hasBio ? PondGeo.bioGeometry(shape, m.L, m.W, m.bioPlates, !!bioOpt.joined) : null;
    var jn = bg && bg.union ? bg : null;
    var hasSide = {};
    (bg ? bg.rects : []).forEach(function (r) { hasSide[r.side] = true; });
    // Габарит усього креслення (ставок + біоплато) — туди виносимо підпис, коли обидва боки зайняті
    var ext = [0, 0, m.L, m.W];
    (bg ? bg.rects.map(function (r) { return r.r; }).concat(bg.corners) : []).forEach(function (r) {
      ext = [Math.min(ext[0], r[0]), Math.min(ext[1], r[1]), Math.max(ext[2], r[0] + r[2]), Math.max(ext[3], r[1] + r[3])];
    });
    // 1. Що має вміститися: контури (м, план) + підписи й кружечки точок (px навколо точки плану)
    var pts = [];
    function add(mx, my, dx, dy) { pts.push({ mx: mx, my: my, dx: dx || 0, dy: dy || 0 }); }
    // Контур дрібними кроками: сторона може зайти під перемикач навіть без вершини там
    function addRing(ring) {
      var bb = [Infinity, -Infinity]; ring.forEach(function (q) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.max(bb[1], q[0]); });
      var stepM = Math.max(1e-6, (bb[1] - bb[0]) / 40);
      ring.forEach(function (q, i) {
        var r = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(r[0] - q[0], r[1] - q[1]) / stepM));
        for (var k = 0; k < n; k++) add(q[0] + (r[0] - q[0]) * k / n, q[1] + (r[1] - q[1]) * k / n);
      });
    }
    // Прямокутник у px навколо точки плану: кути й точки вздовж верхнього краю
    function addBox(mx, my, bx0, by0, bx1, by1) {
      for (var k = 0; k <= 8; k++) add(mx, my, bx0 + (bx1 - bx0) * k / 8, by0);
      add(mx, my, bx0, by1); add(mx, my, bx1, by1);
    }
    var tw = function (t) { return 0.6 * fontPx * t.length + 4; };   // оцінка ширини тексту, px
    var asc = 0.75 * fontPx, desc = 0.25 * fontPx;
    // «L м» — під ставком; Bio знизу → над ставком; Bio і знизу, і згори → під усім кресленням (так само «W м»)
    var labelTop = hasSide.bottom && !hasSide.top, labelRight = hasSide.left && !hasSide.right;
    var lenY = hasSide.bottom && hasSide.top ? ext[3] : m.W, widX = hasSide.left && hasSide.right ? ext[0] : 0;
    var off = withPts ? 14 : 6, lenBase = withPts ? 24 : 17;
    var lenT = Format.qty(m.L) + ' м', widT = Format.qty(m.W) + ' м';
    addRing(jn ? jn.union : PondGeo.outline(shape, m.L, m.W));
    if (bg && !jn) bg.pits.forEach(function (pt) { addRing(pt.outline); });
    ov.points.forEach(function (pt) { addBox(pt.p[0], pt.p[1], -11, -11, 11, 11); });  // кружечок r = 8,5 + обведення
    if (labelTop) addBox(m.L / 2, 0, -tw(lenT) / 2, -(off + 3) - asc, tw(lenT) / 2, -(off + 3) + desc);
    else addBox(m.L / 2, lenY, -tw(lenT) / 2, lenBase - asc, tw(lenT) / 2, lenBase + desc);
    if (labelRight) addBox(m.L, m.W / 2, off, 4 - asc, off + tw(widT), 4 + desc);
    else addBox(widX, m.W / 2, -off - tw(widT), 4 - asc, -off, 4 + desc);

    // 2. Масштаб і місце креслення (fitPlan): X = offX + s·mx + dx, Y = t + s·my + dy
    // Лінії розрізів А–А (по довжині) і Б–Б (по ширині), v0.7.0: літера — з боку, протилежного підпису розміру
    var sec = fitOpt.sections || null, LET = 12;                    // LET — відступ літери від кінця лінії, px
    if (sec) {
      add(sec.aa[0][0], sec.aa[0][1]); add(sec.aa[1][0], sec.aa[1][1]); add(sec.bb[0][0], sec.bb[0][1]); add(sec.bb[1][0], sec.bb[1][1]);
      var aEnd = labelRight ? sec.aa[0] : sec.aa[1], bEnd = labelTop ? sec.bb[1] : sec.bb[0];
      addBox(aEnd[0], aEnd[1], labelRight ? -LET - 8 : LET - 4, -asc / 2 - 1, labelRight ? -LET + 4 : LET + 8, asc / 2 + 1);
      addBox(bEnd[0], bEnd[1], -6, (labelTop ? LET + 4 : -LET + 4) - asc, 6, (labelTop ? LET + 4 : -LET + 4) + desc);
    }

    var fit = fitPlan(pts, box, tops, bottoms);
    svg.setAttribute('viewBox', '0 0 ' + Math.round(box.w) + ' ' + Math.round(fit.h));
    var scale = fit.s, w = m.L * scale, h = m.W * scale, x0 = fit.offX, y0 = fit.t;
    function X(p) { return (x0 + p[0] * scale).toFixed(1) + ' ' + (y0 + p[1] * scale).toFixed(1); }

    function ringD(ring) { return 'M' + ring.map(X).join('L') + 'Z'; }
    if (jn) {
      // Одне дзеркало: ставок + біоплато одним контуром; біоплато — мілкі зони («пісок»), шов — пунктир
      node('path', { d: ringD(jn.union), 'class': 'sk-water' + (shape === 'custom' ? ' sk-water--custom' : '') });
      jn.zones.forEach(function (z) {
        node('path', { d: ringD(z.poly) + z.holes.map(ringD).join(''), 'fill-rule': 'evenodd', 'class': 'sk-bio-zone' });
      });
      jn.seams.forEach(function (l) { node('path', { d: 'M' + l.map(X).join('L'), 'class': 'sk-bio-seam' }); });
    } else if (shape === 'oval') {
      node('ellipse', { cx: x0 + w / 2, cy: y0 + h / 2, rx: w / 2, ry: h / 2, 'class': 'sk-water' });
    } else if (shape === 'custom') {
      // Нестандартна форма — умовно: сильно заокруглений контур пунктиром
      var r = Math.min(w, h) * 0.38;
      node('rect', { x: x0, y: y0, width: w, height: h, rx: r, ry: r, 'class': 'sk-water sk-water--custom' });
    } else {
      node('rect', { x: x0, y: y0, width: w, height: h, rx: 3, ry: 3, 'class': 'sk-water' });
    }

    // Сходинки: від глибокої до мілкої — мілкіша лягає зверху (у спільній зоні діє вона, D33)
    ov.layers.slice().sort(function (a, b) { return b.rank - a.rank; }).forEach(function (l) {
      var d = l.rings.map(ringD).join('');
      node('path', { d: d, 'fill-rule': 'evenodd', 'fill-opacity': [0.5, 0.34, 0.22][Math.min(2, l.rank)],
        'class': 'sk-step' + (l.active ? ' is-active' : '') + (l.error ? ' is-error' : '') });
    });

    // Укіс (v0.7.0): низ похилої стінки — тонкий пунктир (Slope.toeLines)
    (fitOpt.toe || []).forEach(function (l) { node('path', { d: 'M' + l.map(X).join('L'), 'class': 'sk-toe' }); });

    // Лінії розрізів: штрихпунктир через ставок і біоплато, літера на кінці
    if (sec) {
      [['aa', 'А', labelRight ? 0 : 1, 'h'], ['bb', 'Б', labelTop ? 1 : 0, 'v']].forEach(function (c) {
        var ln = sec[c[0]], e = ln[c[2]];
        var ex = x0 + e[0] * scale, ey = y0 + e[1] * scale, sx = x0 + ln[1 - c[2]][0] * scale, sy = y0 + ln[1 - c[2]][1] * scale;
        // З боку літери лінія виходить за край на 6 px, з іншого — закінчується на краю (там підпис розміру)
        var ux = Math.sign(ex - sx), uy = Math.sign(ey - sy);
        node('path', { d: 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + 'L' + (ex + ux * 6).toFixed(1) + ' ' + (ey + uy * 6).toFixed(1), 'class': 'sk-cut' });
        if (c[3] === 'h') node('text', { x: ex + (c[2] ? LET + 2 : -LET - 2), y: ey + 4, 'text-anchor': 'middle', 'class': 'sk-cut-label' }, c[1]);
        else node('text', { x: ex, y: ey + (c[2] ? LET + 4 : -LET + 4), 'text-anchor': 'middle', 'class': 'sk-cut-label' }, c[1]);
      });
    }

    // Підписи розмірів: довжина — під ставком (над ним, коли біоплато знизу), ширина — ліворуч (праворуч, коли біоплато ліворуч)
    var off = withPts ? 14 : 6;
    node('text', { x: x0 + w / 2, y: labelTop ? y0 - off - 3 : y0 + lenY * scale + (withPts ? 24 : 17), 'text-anchor': 'middle', 'class': 'sk-label' }, Format.qty(m.L) + ' м');
    node('text', { x: labelRight ? x0 + w + off : x0 + widX * scale - off, y: y0 + h / 2 + 4, 'text-anchor': labelRight ? 'start' : 'end', 'class': 'sk-label' }, Format.qty(m.W) + ' м');
    // Глибину пишемо всередині, лише якщо вона введена, текст вміщується і немає сходинок
    if (m.D > 0 && w > 92 && h > 22 && !ov.layers.length) {
      node('text', { x: x0 + w / 2, y: y0 + h / 2 + 4, 'text-anchor': 'middle', 'class': 'sk-label sk-label--in' },
        'глибина ' + Format.qty(m.D) + ' м');
    }

    if (bg) {
      // «Окремо» — пунктирні котловани (суміжні Bio зі стиком — один; 4 Bio — кільце з «островом»)
      if (!jn) bg.pits.forEach(function (pt) {
        node('path', { d: ringD(pt.outline) + pt.holes.map(ringD).join(''), 'fill-rule': 'evenodd', 'class': 'sk-bio' });
      });
      // Підпис «Bio-N» усередині свого Bio (уздовж; на бічних — повернутий). Вузьке — лише номер і дрібніше; зовсім вузьке — без підпису
      bg.rects.forEach(function (b) {
        var bx = x0 + b.r[0] * scale, by = y0 + b.r[1] * scale, bw = b.r[2] * scale, bh = b.r[3] * scale;
        var vert = b.side === 'left' || b.side === 'right', along = vert ? bh : bw, thick = vert ? bw : bh;
        var opts = [['Bio-' + b.n, fontPx], ['Bio-' + b.n, Math.max(9, fontPx * 0.8)], [String(b.n), fontPx], [String(b.n), 9]];
        for (var i = 0; i < opts.length; i++) {
          var t = opts[i][0], f = opts[i][1];
          if (thick < f + 2 || along < 0.6 * f * t.length + 6) continue;
          var cx = bx + bw / 2, cy = by + bh / 2;
          var at = { x: cx.toFixed(1), y: (cy + 0.35 * f).toFixed(1), 'text-anchor': 'middle', 'class': 'sk-label sk-bio-label',
                     style: 'font-size:' + f.toFixed(1) + 'px' };        // style, а не атрибут: інакше переважить CSS .sk-label
          if (vert) at.transform = 'rotate(-90 ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')';
          node('text', at, t);
          break;
        }
      });
    }

    // Точки активної сходинки: номер у кружечку; прозоре коло більшого радіуса — зона дотику для пальця
    ov.points.forEach(function (pt) {
      var cx = x0 + pt.p[0] * scale, cy = y0 + pt.p[1] * scale;
      var g = node('g', { 'class': 'sk-pt' + (pt.selected ? ' is-on' : ''), 'data-point': pt.id, role: 'button',
        'aria-label': 'Точка ' + pt.id + (pt.selected ? ', обрано' : '') });
      node('circle', { cx: cx, cy: cy, r: 16, 'class': 'sk-pt__hit' }, null, g);
      node('circle', { cx: cx, cy: cy, r: 8.5, 'class': 'sk-pt__dot' }, null, g);
      node('text', { x: cx, y: cy + 3.5, 'text-anchor': 'middle', 'class': 'sk-pt__num' }, String(pt.id), g);
    });
  }

  /*
   * Розріз А–А / Б–Б (v0.7.0). sec = {
   *   samples: [{ t, z }] — профіль уздовж лінії (Slope.profile): t — м від початку, z — глибина, м;
   *   dims: [{ t0, t1, text }] — розмір над землею (ставок, біоплато);
   *   k — підказка: вертикальне перебільшення (null — підібрати) }
   * Масштаб — найбільший, за якого розріз вміщається в ширину і hMax; мілкий розріз (глибина < 48 px)
   * перебільшуємо по вертикалі (×1,5 / 2 / 3 / 4 / 5 / 10) — множник пишемо в підписі (app.js).
   * Розкладка — як у 3D: креслення опускається під підпис і перемикач, а над стрілками піднімає висоту блока.
   */
  var SEC_KS = [1, 1.5, 2, 3, 4, 5, 10];
  function fitSection(pts, box, avoid) {
    var tops = (avoid && avoid.top) || [], bottoms = (avoid && avoid.bottom) || [], PAD = PLAN_PAD, GAP = PLAN_GAP;
    var hMin = PAD * 2;
    tops.forEach(function (r) { bottoms.forEach(function (q) { if (r.x1 > q.x0 && q.x1 > r.x0) hMin = Math.max(hMin, r.y1 + q.h + GAP); }); });
    var inX = function (X, r) { return X >= r.x0 - GAP && X <= r.x1 + GAP; };
    function place(sc) {
      var xl = Infinity, xr = -Infinity, y0 = Infinity;
      pts.forEach(function (p) { var X = sc * p.mx + p.dx; xl = Math.min(xl, X); xr = Math.max(xr, X); y0 = Math.min(y0, sc * p.my + p.dy); });
      if (xr - xl > box.w - 2 * PAD) return null;
      var offX = (box.w - xl - xr) / 2, t = PAD - y0, h = hMin;
      pts.forEach(function (p) {
        var X = offX + sc * p.mx + p.dx, Y = sc * p.my + p.dy;
        tops.forEach(function (r) { if (inX(X, r)) t = Math.max(t, r.y1 + GAP - Y); });
      });
      pts.forEach(function (p) {
        var X = offX + sc * p.mx + p.dx, Y = t + sc * p.my + p.dy;
        h = Math.max(h, Y + PAD);
        bottoms.forEach(function (r) { if (inX(X, r)) h = Math.max(h, Y + GAP + r.h); });
      });
      return { s: sc, offX: offX, t: t, h: h };
    }
    var mx0 = Infinity, mx1 = -Infinity;
    pts.forEach(function (p) { mx0 = Math.min(mx0, p.mx); mx1 = Math.max(mx1, p.mx); });
    var lo = 0, hi = (box.w - 2 * PAD) / Math.max(1e-9, mx1 - mx0);
    for (var it = 0; it < 30; it++) {
      var mid = (lo + hi) / 2, r0 = place(mid);
      if (r0 && r0.h <= box.hMax) lo = mid; else hi = mid;
    }
    return place(lo) || { s: lo, offX: PAD, t: PAD, h: Math.max(hMin, 60) };
  }

  function drawSection(svg, sec, fitOpt) {
    var NS = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    fitOpt = fitOpt || {};
    var box = fitOpt.box || { w: 320, hMax: 190 }, fontPx = 12 * (fitOpt.fs || 1);
    var asc = 0.75 * fontPx, desc = 0.25 * fontPx, BAND = 7;          // BAND — смуга ґрунту під лінією землі, px
    function node(tag, attrs, text) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text) n.textContent = text;
      svg.appendChild(n);
      return n;
    }
    var smp = sec.samples, D = 0;
    smp.forEach(function (q) { D = Math.max(D, q.z); });
    var tw = function (t) { return 0.6 * fontPx * t.length + 4; };

    // Горизонтальні ділянки дна (для підписів глибин): підряд однакова глибина
    var runs = [];
    smp.forEach(function (q, i) {
      var last = runs[runs.length - 1];
      if (q.z > 1e-6 && last && Math.abs(last.z - q.z) < 1e-4 && last.i1 === i - 1) { last.t1 = q.t; last.i1 = i; }
      else if (q.z > 1e-6) runs.push({ z: q.z, t0: q.t, t1: q.t, i0: i, i1: i });
    });

    function ptsFor(k) {
      var pts = [];
      smp.forEach(function (q) { pts.push({ mx: q.t, my: q.z * k, dx: 0, dy: 0 }); pts.push({ mx: q.t, my: q.z * k, dx: 0, dy: BAND }); });
      (sec.dims || []).forEach(function (d) {
        var c = (d.t0 + d.t1) / 2, w = tw(d.text);
        pts.push({ mx: c, my: 0, dx: -w / 2, dy: -6 - asc }, { mx: c, my: 0, dx: w / 2, dy: -6 - asc });
      });
      runs.forEach(function (r) {                                   // підпис глибини під ділянкою
        var c = (r.t0 + r.t1) / 2;
        pts.push({ mx: c, my: r.z * k, dx: 0, dy: BAND + 4 + asc + desc });
      });
      return pts;
    }
    // 1. Масштаб без перебільшення; мілкий розріз — перебільшуємо по вертикалі й перераховуємо
    var k = 1, fit = fitSection(ptsFor(1), box, fitOpt.avoid);
    if (D > 0 && D * fit.s < 48) {
      var need = 48 / (D * fit.s);
      k = SEC_KS.filter(function (x) { return x >= need; })[0] || SEC_KS[SEC_KS.length - 1];
      fit = fitSection(ptsFor(k), box, fitOpt.avoid);
    }
    svg.setAttribute('viewBox', '0 0 ' + Math.round(box.w) + ' ' + Math.round(fit.h));
    var s = fit.s;
    function P(t, z, dy) { return [fit.offX + t * s, fit.t + z * k * s + (dy || 0)]; }
    function d(list) { return 'M' + list.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L'); }

    // 2. Вода в котлованах (від дна до поверхні), смуга ґрунту під лінією землі, сама лінія землі
    var pit = null;
    smp.forEach(function (q, i) {
      if (q.z > 1e-6) { if (!pit) pit = [P(smp[Math.max(0, i - 1)].t, 0)]; pit.push(P(q.t, q.z)); }
      if ((q.z <= 1e-6 || i === smp.length - 1) && pit) {
        pit.push(P(q.t, 0));
        node('path', { d: d(pit) + 'Z', 'class': 'sec-water' });
        node('path', { d: 'M' + pit[0][0].toFixed(1) + ' ' + pit[0][1].toFixed(1) + 'L' + pit[pit.length - 1][0].toFixed(1) + ' ' + pit[pit.length - 1][1].toFixed(1), 'class': 'sec-surface' });
        pit = null;
      }
    });
    var top = smp.map(function (q) { return P(q.t, q.z); }), bottom = smp.map(function (q) { return P(q.t, q.z, BAND); }).reverse();
    node('path', { d: d(top.concat(bottom)) + 'Z', 'class': 'sec-band' });
    node('path', { d: d(top), 'class': 'sec-line' });

    // 3. Розміри над землею й глибини під ділянками дна (підпис, що налазить на попередній, пропускаємо)
    (sec.dims || []).forEach(function (dm) {
      var a = P(dm.t0, 0), b = P(dm.t1, 0), y = a[1] - 6;
      node('text', { x: ((a[0] + b[0]) / 2).toFixed(1), y: y.toFixed(1), 'text-anchor': 'middle', 'class': 'sk-label' }, dm.text);
    });
    var lastX = -Infinity;
    runs.forEach(function (r) {
      var txt = Format.qty(Math.round(r.z * 100) / 100) + ' м', w = tw(txt);
      var a = P(r.t0, r.z), b = P(r.t1, r.z), cx = (a[0] + b[0]) / 2;
      if (b[0] - a[0] < 18 || cx - w / 2 < lastX + 4) return;
      lastX = cx + w / 2;
      node('text', { x: cx.toFixed(1), y: (a[1] + BAND + 4 + asc).toFixed(1), 'text-anchor': 'middle', 'class': 'sk-label' }, txt);
    });
    return { k: k, s: s };
  }

  // Три показники під полями: площа, об'єм, плівка
  function renderStats(dl, m) {
    dl.innerHTML = '';
    [['Площа', Format.qty(m.S) + ' м²'],
     ['Об\'єм води', Format.qty(m.Vtotal) + ' м³'],
     ['Плівка', Format.qty(m.filmAreaTotal) + ' м²']].forEach(function (p) {
      var d = el('div');
      d.appendChild(el('dt', null, p[0]));
      d.appendChild(el('dd', null, p[1]));
      dl.appendChild(d);
    });
  }

  function renderWarnings(ul, list) {
    ul.innerHTML = '';
    list.forEach(function (w) { ul.appendChild(el('li', null, w)); });
  }

  // Рядки кошторису за групами; moneyFn враховує режим «приховати ціни»
  function renderLines(container, est, moneyFn) {
    container.innerHTML = '';
    ['Обладнання', 'Матеріали', 'Роботи'].forEach(function (group) {
      var rows = est.lines.filter(function (l) { return l.group === group; });
      if (!rows.length) return;
      var g = el('div', 'group');
      var head = el('div', 'group__head');
      head.appendChild(el('span', null, group));
      g.appendChild(head);
      rows.forEach(function (l) {
        var row = el('div', 'line');
        var name = el('span', 'line__name', l.name);
        // Для «Монтажних робіт» деталі не показуємо: клієнт може бачити екран (відсоток — у службовій панелі)
        var calc = l.id === 'LABOR' ? ''
          : l.price > 0 ? Format.qty(l.qty) + ' ' + l.unit + ' × ' + moneyFn(l.price)
          : 'включено';
        if (calc) name.appendChild(el('span', 'line__calc', calc));
        row.appendChild(name);
        row.appendChild(el('span', 'line__sum', l.price > 0 ? moneyFn(l.sum) : '—'));
        g.appendChild(row);
      });
      container.appendChild(g);
    });
  }

  function renderTotals(dl, t, moneyFn) {
    dl.innerHTML = '';
    function row(label, value, cls) {
      dl.appendChild(el('dt', cls, label));
      dl.appendChild(el('dd', cls, value));
    }
    row('Обладнання', moneyFn(t.equipment));
    row('Матеріали', moneyFn(t.materials));
    row('Роботи', moneyFn(t.work));
    if (t.markup !== 0) row((t.markup > 0 ? 'Націнка ' : 'Знижка ') + Format.qty(Math.abs(t.markup_pct)) + '%', moneyFn(t.markup));
    row('Разом', moneyFn(t.total), 'grand');
  }

  // Прапорці для категорії «інше» (фонтан, аератор тощо).
  // Натискати можна на прапорець і на саму назву, але не правіше від неї:
  // label має ширину вмісту, решта рядка не реагує — менше випадкових натискань під час прокрутки
  function renderExtras(container, items, extras) {
    container.innerHTML = '';
    items.forEach(function (it) {
      var row = el('div', 'check');
      var label = el('label', 'check__control');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.dataset.extra = it.id;
      cb.checked = (extras[it.id] || 0) > 0;
      label.appendChild(cb);
      label.appendChild(el('span', 'check__text', it.name));
      row.appendChild(label);
      container.appendChild(row);
    });
  }

  /*
   * Плавне розкриття / згортання блоку (біоплато, коментарі), D27 → v0.6.0.
   * Анімуємо висоту в px (0 → висота вмісту), а не grid-template-rows: так плавно в будь-якому WebKit.
   * Перший виклик (завантаження сторінки) — без анімації. inert — приховані поля без фокуса.
   */
  function setCollapse(box, open) {
    open = !!open;
    var was = box.classList.contains('is-open');
    if (open) box.removeAttribute('inert'); else box.setAttribute('inert', '');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!box.dataset.ready || reduce) {
      box.dataset.ready = '1';
      box.classList.toggle('is-open', open);
      box.style.height = open ? 'auto' : '0px';
      return;
    }
    if (was === open) return;
    var inner = box.firstElementChild;
    box.style.height = box.getBoundingClientRect().height + 'px'; // від поточної висоти (навіть посеред анімації)
    void box.offsetHeight;                                        // фіксуємо стартову висоту перед переходом
    box.classList.toggle('is-open', open);
    box.style.height = (open ? inner.scrollHeight : 0) + 'px';
    clearTimeout(box._t);
    // Відкрито → висота «auto», щоб блок міг рости (напр., підказка під полем)
    box._t = setTimeout(function () { if (box.classList.contains('is-open')) box.style.height = 'auto'; }, 340);
  }

  return {
    $: $, el: el, fillSelect: fillSelect, markSelect: markSelect, setNote: setNote,
    drawSketch: drawSketch, drawSection: drawSection, fitPlan: fitPlan, fitSection: fitSection, renderStats: renderStats, renderWarnings: renderWarnings,
    renderLines: renderLines, renderTotals: renderTotals, renderExtras: renderExtras, setCollapse: setCollapse
  };
})();

// Експорт для Node.js (тест fitPlan); у браузері рядок пропускається
if (typeof module !== 'undefined' && module.exports) module.exports = UI;
