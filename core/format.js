/*
 * core/format.js — форматування чисел і текстового кошторису.
 * Власна реалізація замість toLocaleString: однаковий результат у браузері, Apps Script і Node.
 */
var Format = (function () {
  'use strict';

  var NBSP = '\u00A0'; // нерозривний пробіл: «12 500» не розірветься на два рядки

  // Число з розділювачем тисяч і комою: 1234567.5 → «1 234 567,5»
  function number(x, decimals) {
    var d = decimals === undefined ? 0 : decimals;
    var fixed = (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return parts.join(',');
  }

  // Кількість: округлення до 0,1 і без зайвого нуля (80 / 80,1)
  function qty(x) {
    var r = Math.round(x * 10) / 10;
    return number(r, Math.abs(r - Math.round(r)) < 1e-9 ? 0 : 1);
  }

  // Гроші: цілі гривні без копійок, інакше — з копійками
  function money(x, currency) {
    var whole = Math.abs(x - Math.round(x)) < 0.005;
    return number(x, whole ? 0 : 2) + NBSP + (currency || 'грн');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Дата у форматі 26.09.2026
  function date(d) {
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  /*
   * Телефон України. Зберігаємо лише 9 цифр після +380 («місцеві» цифри).
   * Приклади: «+380 67 123 45 67», «0671234567», «380671234567» → «671234567».
   */
  function phoneLocal(raw) {
    var d = String(raw || '').replace(/\D/g, '');   // лише цифри
    if (d.indexOf('380') === 0) d = d.slice(3);      // прибираємо код країни
    d = d.replace(/^0+/, '');                        // звичний «0» перед кодом оператора
    return d.slice(0, 9);                            // більше 9 цифр ввести неможливо
  }

  // Відформатований номер: +380 67 123 45 67 (частково введений — теж форматуємо)
  function phoneUA(raw) {
    var d = phoneLocal(raw);
    if (!d) return '';
    var groups = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)];
    return '+380 ' + groups.filter(function (g) { return g; }).join(' ');
  }

  var SHAPE_NAMES = { rect: 'прямокутний', oval: 'овальний', custom: 'нестандартної форми' };

  /*
   * Текст кошторису для копіювання в чат.
   * est — результат Calc.buildEstimate; inp — параметри ставка;
   * extra — { client, currency, isTest, date }. Коментар сюди НЕ передаємо:
   * він лише для майстра (піде в CRM на етапі A4), клієнт його не бачить.
   */
  function estimateText(est, inp, extra) {
    var e = extra || {};
    var cur = e.currency || 'грн';
    var m = est.metrics;
    var out = [];

    if (e.isTest) out.push('⚠️ ТЕСТОВІ ЦІНИ — не для клієнта', '');
    out.push('Кошторис Aquaprud від ' + date(e.date || new Date()));

    // Дані клієнта — лише заповнені поля
    var c = e.client || {};
    var phone = phoneLocal(c.phone).length === 9 ? phoneUA(c.phone) : ''; // неповний номер не пишемо
    var clientParts = [c.name, phone, c.address].filter(function (v) { return v && String(v).trim(); });
    if (clientParts.length) out.push('Клієнт: ' + clientParts.join(', '));

    out.push('');
    out.push('Ставок ' + (SHAPE_NAMES[inp.shape] || '') + ': ' +
      qty(m.L) + ' × ' + qty(m.W) + ' × ' + qty(m.D) + ' м' + (inp.fish ? ', з рибою' : ', без риби'));
    out.push('Площа дзеркала ' + qty(m.S) + ' м², об\'єм води ' + qty(m.Vtotal) + ' м³');
    if (m.hasBio) out.push('Біоплато: ' + qty(m.Lb) + ' × ' + qty(m.Wb) + ' м');

    // Націнку клієнту окремо не показуємо: додаємо її до «Монтажних робіт», щоб суми сходилися.
    // Знижку (від'ємна націнка) показуємо окремим рядком — це клієнту приємно бачити.
    var t = est.totals;
    var hiddenMarkup = t.markup > 0 ? t.markup : 0;
    var lines = est.lines.map(function (l) {
      if (l.id !== 'LABOR' || !hiddenMarkup) return l;
      return { id: l.id, name: l.name, unit: l.unit, qty: l.qty, price: l.sum + hiddenMarkup, sum: l.sum + hiddenMarkup, group: l.group };
    });
    var hasLabor = lines.some(function (l) { return l.id === 'LABOR'; });
    if (hiddenMarkup && !hasLabor) {
      lines.push({ id: 'LABOR', name: 'Монтажні роботи', unit: 'посл.', qty: 1, price: hiddenMarkup, sum: hiddenMarkup, group: 'Роботи' });
    }

    // Рядки за групами
    ['Обладнання', 'Матеріали', 'Роботи'].forEach(function (group) {
      var rows = lines.filter(function (l) { return l.group === group; });
      if (!rows.length) return;
      out.push('', group + ':');
      rows.forEach(function (l) {
        var price = l.id === 'LABOR' ? money(l.sum, cur)
          : l.price > 0 ? qty(l.qty) + ' ' + l.unit + ' × ' + money(l.price, cur) + ' = ' + money(l.sum, cur)
          : 'включено';
        out.push('• ' + l.name + ' — ' + price);
      });
    });

    out.push('');
    out.push('Обладнання: ' + money(t.equipment, cur));
    out.push('Матеріали: ' + money(t.materials, cur));
    out.push('Роботи: ' + money(t.work + hiddenMarkup, cur));
    if (t.markup < 0) out.push('Знижка ' + qty(Math.abs(t.markup_pct)) + '%: ' + money(t.markup, cur));
    out.push('Разом: ' + money(t.total, cur));

    return out.join('\n');
  }

  return {
    number: number, qty: qty, money: money, date: date,
    phoneLocal: phoneLocal, phoneUA: phoneUA, estimateText: estimateText, NBSP: NBSP
  };
})();

// Експорт для Node.js (у браузері й Apps Script рядок пропускається)
if (typeof module !== 'undefined' && module.exports) module.exports = Format;
