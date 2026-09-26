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
   * Телефони України і Польщі. Зберігаємо лише «місцеві» цифри (без коду країни).
   * groups — як групуємо цифри на екрані; trunkZero — чи відкидати «0» перед кодом оператора.
   */
  var PHONE = {
    UA: { code: '380', len: 9, groups: [2, 3, 2, 2], trunkZero: true },  // +380 67 123 45 67
    PL: { code: '48', len: 9, groups: [3, 3, 3], trunkZero: false }      // +48 512 345 678
  };
  var MASK_CHAR = 'х'; // «х» на місці ще не введених цифр

  function phoneConf(country) { return PHONE[country] || PHONE.UA; }
  function digitsOnly(raw) { return String(raw || '').replace(/\D/g, ''); }

  // Місцеві цифри: «0671234567», «+380 67 123 45 67», «380671234567» → «671234567» (для UA)
  function phoneLocal(raw, country) {
    var c = phoneConf(country);
    var d = digitsOnly(raw);
    if (d.indexOf(c.code) === 0) d = d.slice(c.code.length); // прибираємо код країни
    if (c.trunkZero) d = d.replace(/^0+/, '');                 // звичний «0» перед кодом оператора
    return d.slice(0, c.len);                                  // зайві цифри ввести неможливо
  }

  // Відформатований номер (частково введений — теж): «+380 67 1»
  function phoneFormat(raw, country) {
    var c = phoneConf(country);
    var d = phoneLocal(raw, country);
    if (!d) return '';
    var parts = [], pos = 0;
    c.groups.forEach(function (g) {
      if (pos < d.length) parts.push(d.slice(pos, pos + g));
      pos += g;
    });
    return '+' + c.code + ' ' + parts.join(' ');
  }

  // Префікс і маска для поля: «+380 », «+380 хх ххх хх хх»
  function phonePrefix(country) { return '+' + phoneConf(country).code + ' '; }
  function phoneMask(country) {
    var c = phoneConf(country);
    return phonePrefix(country) + c.groups.map(function (g) { return new Array(g + 1).join(MASK_CHAR); }).join(' ');
  }

  function phoneComplete(raw, country) {
    return phoneLocal(raw, country).length === phoneConf(country).len;
  }

  // Країна за повним міжнародним номером (наприклад, вставленим з буфера); null — не визначено
  function phoneDetect(raw) {
    var d = digitsOnly(raw);
    if (d.indexOf('380') === 0 && d.length >= 12) return 'UA';
    if (d.indexOf('48') === 0 && d.length >= 11) return 'PL';
    return null;
  }

  // Сумісність зі старим кодом і тестами
  function phoneUA(raw) { return phoneFormat(raw, 'UA'); }

  var SHAPE_NAMES = { rect: 'прямокутний', oval: 'овальний', custom: 'нестандартної форми' };

  /*
   * Текст кошторису для копіювання в чат.
   * est — результат Calc.buildEstimate; inp — параметри ставка;
   * extra — { client, clientComment, currency, isTest, date }.
   * clientComment — коментар для клієнта (потрапляє в текст).
   * Коментар «для себе» сюди НЕ передаємо: він лише для майстра (піде в CRM на етапі A4).
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
    var phone = phoneComplete(c.phone, c.phoneCountry) ? phoneFormat(c.phone, c.phoneCountry) : ''; // неповний не пишемо
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

    var note = e.clientComment ? String(e.clientComment).trim() : '';
    if (note) out.push('', 'Коментар: ' + note);

    return out.join('\n');
  }

  return {
    number: number, qty: qty, money: money, date: date,
    phoneLocal: phoneLocal, phoneFormat: phoneFormat, phonePrefix: phonePrefix, phoneMask: phoneMask,
    phoneComplete: phoneComplete, phoneDetect: phoneDetect, phoneUA: phoneUA,
    estimateText: estimateText, NBSP: NBSP
  };
})();

// Експорт для Node.js (у браузері й Apps Script рядок пропускається)
if (typeof module !== 'undefined' && module.exports) module.exports = Format;
