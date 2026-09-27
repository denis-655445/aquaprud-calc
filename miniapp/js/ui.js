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
   * Схема ставка зверху в реальних пропорціях + біоплато праворуч.
   * overlay (Про-режим, необов'язково) — у координатах плану, м:
   *   layers: [{ rings: [[[x, y], …], …], rank, active, error }] — сходинки (rank 0 — наймілкіша);
   *   points: [{ id, p: [x, y], selected }] — точки активної сходинки, їх натискають (data-point).
   */
  function drawSketch(svg, shape, m, overlay) {
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

    // Поле малювання: ліворуч місце під підпис ширини, знизу — під підпис довжини (з точками — трохи більше)
    var left = withPts ? 50 : 44, right = withPts ? 14 : 10, top = (withPts ? 14 : 8) + PAD_TOP, bottom = withPts ? 32 : 26, gapPx = 12;
    var availW = 320 - left - right, availH = 150 + PAD_TOP - top - bottom;
    var bioL = m.hasBio ? m.Lb : 0, bioW = m.hasBio ? m.Wb : 0;
    var scale = Math.min((availW - (m.hasBio ? gapPx : 0)) / (m.L + bioL), availH / Math.max(m.W, bioW));

    var w = m.L * scale, h = m.W * scale;
    var totalW = w + (m.hasBio ? gapPx + bioL * scale : 0);
    var x0 = left + (availW - totalW) / 2;
    var y0 = top + (availH - h) / 2;
    function X(p) { return (x0 + p[0] * scale).toFixed(1) + ' ' + (y0 + p[1] * scale).toFixed(1); }

    if (shape === 'oval') {
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
      var d = l.rings.map(function (ring) { return 'M' + ring.map(X).join('L') + 'Z'; }).join('');
      node('path', { d: d, 'fill-rule': 'evenodd', 'fill-opacity': [0.5, 0.34, 0.22][Math.min(2, l.rank)],
        'class': 'sk-step' + (l.active ? ' is-active' : '') + (l.error ? ' is-error' : '') });
    });

    // Підписи розмірів
    node('text', { x: x0 + w / 2, y: y0 + h + (withPts ? 24 : 17), 'text-anchor': 'middle', 'class': 'sk-label' }, Format.qty(m.L) + ' м');
    node('text', { x: x0 - (withPts ? 14 : 6), y: y0 + h / 2 + 4, 'text-anchor': 'end', 'class': 'sk-label' }, Format.qty(m.W) + ' м');
    // Глибину пишемо всередині, лише якщо вона введена, текст вміщується і немає сходинок
    if (m.D > 0 && w > 92 && h > 22 && !ov.layers.length) {
      node('text', { x: x0 + w / 2, y: y0 + h / 2 + 4, 'text-anchor': 'middle', 'class': 'sk-label sk-label--in' },
        'глибина ' + Format.qty(m.D) + ' м');
    }

    if (m.hasBio) {
      var bw = bioL * scale, bh = bioW * scale;
      var bx = x0 + w + gapPx, by = top + (availH - bh) / 2;
      node('rect', { x: bx, y: by, width: bw, height: bh, rx: 2, ry: 2, 'class': 'sk-bio' });
      node('text', { x: bx + bw / 2, y: by + bh + 17, 'text-anchor': 'middle', 'class': 'sk-label' }, bw > 56 ? 'біоплато' : 'біо');
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

  // Плавне розкриття / згортання блоку (біоплато, коментарі).
  // inert — приховані поля не отримують фокус і не читаються екранним диктором
  function setCollapse(box, open) {
    box.classList.toggle('is-open', !!open);
    if (open) box.removeAttribute('inert'); else box.setAttribute('inert', '');
  }

  return {
    $: $, el: el, fillSelect: fillSelect, markSelect: markSelect, setNote: setNote,
    drawSketch: drawSketch, renderStats: renderStats, renderWarnings: renderWarnings,
    renderLines: renderLines, renderTotals: renderTotals, renderExtras: renderExtras, setCollapse: setCollapse
  };
})();
