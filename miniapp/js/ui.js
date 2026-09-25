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

  // Схема ставка зверху в реальних пропорціях + біоплато праворуч
  function drawSketch(svg, shape, m) {
    var NS = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    function node(tag, attrs, text) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text) n.textContent = text;
      svg.appendChild(n);
      return n;
    }

    if (!(m.L > 0 && m.W > 0)) {
      node('text', { x: 160, y: 80, 'text-anchor': 'middle', 'class': 'sk-hint' }, 'Тут з\'явиться схема ставка');
      return;
    }

    // Поле малювання: ліворуч місце під підпис ширини, знизу — під підпис довжини
    var left = 44, right = 10, top = 8, bottom = 26, gapPx = 12;
    var availW = 320 - left - right, availH = 150 - top - bottom;
    var bioL = m.hasBio ? m.Lb : 0, bioW = m.hasBio ? m.Wb : 0;
    var scale = Math.min((availW - (m.hasBio ? gapPx : 0)) / (m.L + bioL), availH / Math.max(m.W, bioW));

    var w = m.L * scale, h = m.W * scale;
    var totalW = w + (m.hasBio ? gapPx + bioL * scale : 0);
    var x0 = left + (availW - totalW) / 2;
    var y0 = top + (availH - h) / 2;

    if (shape === 'oval') {
      node('ellipse', { cx: x0 + w / 2, cy: y0 + h / 2, rx: w / 2, ry: h / 2, 'class': 'sk-water' });
    } else if (shape === 'custom') {
      // Нестандартна форма — умовно: сильно заокруглений контур пунктиром
      var r = Math.min(w, h) * 0.38;
      node('rect', { x: x0, y: y0, width: w, height: h, rx: r, ry: r, 'class': 'sk-water sk-water--custom' });
    } else {
      node('rect', { x: x0, y: y0, width: w, height: h, rx: 3, ry: 3, 'class': 'sk-water' });
    }

    // Підписи розмірів
    node('text', { x: x0 + w / 2, y: y0 + h + 17, 'text-anchor': 'middle', 'class': 'sk-label' }, Format.qty(m.L) + ' м');
    node('text', { x: x0 - 6, y: y0 + h / 2 + 4, 'text-anchor': 'end', 'class': 'sk-label' }, Format.qty(m.W) + ' м');
    // Глибину пишемо всередині, лише якщо вона введена і текст вміщується
    if (m.D > 0 && w > 92 && h > 22) {
      node('text', { x: x0 + w / 2, y: y0 + h / 2 + 4, 'text-anchor': 'middle', 'class': 'sk-label sk-label--in' },
        'глибина ' + Format.qty(m.D) + ' м');
    }

    if (m.hasBio) {
      var bw = bioL * scale, bh = bioW * scale;
      var bx = x0 + w + gapPx, by = top + (availH - bh) / 2;
      node('rect', { x: bx, y: by, width: bw, height: bh, rx: 2, ry: 2, 'class': 'sk-bio' });
      node('text', { x: bx + bw / 2, y: by + bh + 17, 'text-anchor': 'middle', 'class': 'sk-label' }, bw > 56 ? 'біоплато' : 'біо');
    }
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
        var calc = l.id === 'LABOR' ? 'від суми ' + moneyFn(l.base)
          : l.price > 0 ? Format.qty(l.qty) + ' ' + l.unit + ' × ' + moneyFn(l.price)
          : 'включено';
        name.appendChild(el('span', 'line__calc', calc));
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
    if (t.markup !== 0) row((t.markup > 0 ? 'Націнка ' : 'Знижка ') + Format.number(Math.abs(t.markup_pct), 1) + '%', moneyFn(t.markup));
    row('Разом', moneyFn(t.total), 'grand');
  }

  // Прапорці для категорії «інше» (фонтан, аератор тощо)
  function renderExtras(container, items, extras) {
    container.innerHTML = '';
    items.forEach(function (it) {
      var label = el('label');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.dataset.extra = it.id;
      cb.checked = (extras[it.id] || 0) > 0;
      label.appendChild(cb);
      label.appendChild(el('span', null, it.name));
      container.appendChild(label);
    });
  }

  return {
    $: $, el: el, fillSelect: fillSelect, markSelect: markSelect, setNote: setNote,
    drawSketch: drawSketch, renderStats: renderStats, renderWarnings: renderWarnings,
    renderLines: renderLines, renderTotals: renderTotals, renderExtras: renderExtras
  };
})();
