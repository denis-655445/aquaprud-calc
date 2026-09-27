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
   * Схема ставка зверху в реальних пропорціях + біоплато з вибраного боку.
   * bioOpt = { side: 'right' | 'bottom' | 'left' | 'top', joined } — joined: біоплато «Разом» (впритул, одне дзеркало, D56).
   * overlay (Про-режим, необов'язково) — у координатах плану, м:
   *   layers: [{ rings: [[[x, y], …], …], rank, active, error }] — сходинки (rank 0 — наймілкіша);
   *   points: [{ id, p: [x, y], selected }] — точки активної сходинки, їх натискають (data-point).
   */
  function drawSketch(svg, shape, m, overlay, bioOpt) {
    var NS = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // Згори — смуга 40 px під перемикач 2D/3D; поле малювання те саме, що й раніше (320 × 150)
    var PAD_TOP = 40;
    svg.setAttribute('viewBox', '0 0 320 ' + (150 + PAD_TOP));

    function node(tag, attrs, text, parent) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text) n.textContent = text;
      (parent || svg).appendChild(n);
      return n;
    }

    if (!(m.L > 0 && m.W > 0)) {
      node('text', { x: 160, y: 80 + PAD_TOP, 'text-anchor': 'middle', 'class': 'sk-hint' }, 'Тут з\'явиться схема ставка');
      return;
    }
    var ov = overlay || { layers: [], points: [] };
    var withPts = ov.points.length > 0;

    // Біоплато — з вибраного боку (PondGeo.bioRect, те саме, що в 3D); підписи розмірів — на вільному боці
    bioOpt = bioOpt || {};
    var side = m.hasBio ? (bioOpt.side || 'right') : 'right';
    // «Разом»: спільний контур дзеркала, мілка зона біоплато і шов по стінці ставка (PondGeo.bioJoin, те саме в 3D)
    var jn = m.hasBio && bioOpt.joined ? PondGeo.bioJoin(shape, m.L, m.W, { L: m.Lb, W: m.Wb }, side) : null;
    var br = jn ? jn.rect : m.hasBio ? PondGeo.bioRect(m.L, m.W, { L: m.Lb, W: m.Wb }, side) : null;
    var labelTop = side === 'bottom', labelRight = side === 'left';   // «L м» над ставком, «W м» праворуч
    // Поле малювання: місце під підписи ширини й довжини (з точками — трохи більше)
    var sideM = withPts ? 50 : 44, thinM = withPts ? 14 : 10;
    var left = labelRight ? thinM : sideM, right = labelRight ? sideM : thinM;
    var top = (withPts ? 14 : 8) + PAD_TOP + (labelTop ? 18 : 0), bottom = labelTop ? 10 : (withPts ? 32 : 26);
    var availW = 320 - left - right, availH = 150 + PAD_TOP - top - bottom;
    var xmin = Math.min(0, br ? br[0] : 0), xmax = Math.max(m.L, br ? br[0] + br[2] : 0);
    var ymin = Math.min(0, br ? br[1] : 0), ymax = Math.max(m.W, br ? br[1] + br[3] : 0);
    var scale = Math.min(availW / (xmax - xmin), availH / (ymax - ymin));

    var w = m.L * scale, h = m.W * scale;
    var x0 = left + (availW - (xmax - xmin) * scale) / 2 - xmin * scale;
    var y0 = top + (availH - (ymax - ymin) * scale) / 2 - ymin * scale;
    function X(p) { return (x0 + p[0] * scale).toFixed(1) + ' ' + (y0 + p[1] * scale).toFixed(1); }

    function ringD(ring) { return 'M' + ring.map(X).join('L') + 'Z'; }
    if (jn) {
      // Одне дзеркало: ставок + біоплато одним контуром; біоплато — мілка зона («пісок»), шов — пунктир
      node('path', { d: ringD(jn.union), 'class': 'sk-water' + (shape === 'custom' ? ' sk-water--custom' : '') });
      node('path', { d: ringD(jn.zone), 'class': 'sk-bio-zone' });
      node('path', { d: 'M' + jn.seam.map(X).join('L'), 'class': 'sk-bio-seam' });
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

    // Підписи розмірів: довжина — під ставком (над ним, коли біоплато знизу), ширина — ліворуч (праворуч, коли біоплато ліворуч)
    var off = withPts ? 14 : 6;
    node('text', { x: x0 + w / 2, y: labelTop ? y0 - off - 3 : y0 + h + (withPts ? 24 : 17), 'text-anchor': 'middle', 'class': 'sk-label' }, Format.qty(m.L) + ' м');
    node('text', { x: labelRight ? x0 + w + off : x0 - off, y: y0 + h / 2 + 4, 'text-anchor': labelRight ? 'start' : 'end', 'class': 'sk-label' }, Format.qty(m.W) + ' м');
    // Глибину пишемо всередині, лише якщо вона введена, текст вміщується і немає сходинок
    if (m.D > 0 && w > 92 && h > 22 && !ov.layers.length) {
      node('text', { x: x0 + w / 2, y: y0 + h / 2 + 4, 'text-anchor': 'middle', 'class': 'sk-label sk-label--in' },
        'глибина ' + Format.qty(m.D) + ' м');
    }

    if (br) {
      var bx = x0 + br[0] * scale, by = y0 + br[1] * scale, bw = br[2] * scale, bh = br[3] * scale;
      if (!jn) node('rect', { x: bx, y: by, width: bw, height: bh, rx: 2, ry: 2, 'class': 'sk-bio' }); // «Окремо» — пунктирний котлован
      if (side === 'right' || side === 'left') {                  // підпис під біоплато
        node('text', { x: bx + bw / 2, y: by + bh + 17, 'text-anchor': 'middle', 'class': 'sk-label' }, bw > 56 ? 'біоплато' : 'біо');
      } else {                                                    // згори / знизу — збоку від біоплато
        var roomRight = 316 - (bx + bw + 6) > 56;
        node('text', { x: roomRight ? bx + bw + 6 : bx - 6, y: by + bh / 2 + 4, 'text-anchor': roomRight ? 'start' : 'end', 'class': 'sk-label' }, 'біоплато');
      }
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
    drawSketch: drawSketch, renderStats: renderStats, renderWarnings: renderWarnings,
    renderLines: renderLines, renderTotals: renderTotals, renderExtras: renderExtras, setCollapse: setCollapse
  };
})();
