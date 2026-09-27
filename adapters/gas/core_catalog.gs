/*
 * core/catalog.js — каталог з рядків Google Таблиці (вкладки «Прайс» і «Налаштування», project_status.md §5, D72).
 * Чисті функції: на вхід — двовимірні масиви значень (як getValues() в Apps Script), на вихід —
 * { version, is_test, settings, items, warnings } у форматі data/catalog.sample.js. Без API платформ (D11).
 */
var Catalog = (function () {
  'use strict';

  // Колонка «Прайсу» → ключ JSON (§5.4, D20). «примітка» — лише для себе, у застосунок не йде
  var COLUMNS = {
    'id': 'id', 'категорія': 'category', 'назва': 'name', 'од': 'unit', 'ціна': 'price', 'база': 'base', 'коеф': 'k',
    'макс_v_без_риби': 'maxV_nofish', 'макс_v_з_рибою': 'maxV_fish', 'насос_комплект': 'pump_kit',
    'q_max': 'q_max', 'h_max': 'h_max', 'група': 'group', 'активний': 'active'
  };
  var NUMERIC = ['price', 'k', 'maxV_nofish', 'maxV_fish', 'q_max', 'h_max'];
  var CATEGORIES = ['filter', 'uv', 'pump', 'skimmer', 'drain', 'film', 'geotextile', 'pipe', 'fitting',
                    'waterfall', 'light', 'extra', 'work'];
  var NO = ['ні', 'нет', 'no', 'false', '0', 'n']; // «активний»: ці значення вимикають позицію; порожньо = активна

  function isEmpty(v) { return v === null || v === undefined || String(v).trim() === ''; }

  // Число з клітинки: 1234.5, «1 234,5», «1234,5» → 1234.5; інакше NaN
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).replace(/[\s\u00a0]/g, '').replace(',', '.');
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
  }

  function headerKey(h) { return COLUMNS[String(h || '').trim().toLowerCase()] || null; }

  // Вкладка «Прайс»: перший рядок — назви колонок, далі — позиції
  function parsePrice(rows, warnings) {
    if (!rows || !rows.length) { warnings.push('Вкладка «Прайс» порожня'); return []; }
    var keys = rows[0].map(headerKey);
    if (keys.indexOf('id') === -1) { warnings.push('У «Прайсі» немає колонки «id»'); return []; }
    var items = [], seen = {};
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r], it = {}, line = r + 1; // line — номер рядка в таблиці (для підказки майстру)
      keys.forEach(function (key, c) {
        if (!key || isEmpty(row[c])) return;   // порожня клітинка — ключа немає (як у тестовому каталозі)
        var v = row[c];
        if (NUMERIC.indexOf(key) !== -1) {
          var n = toNumber(v);
          if (isNaN(n)) warnings.push('Рядок ' + line + ': «' + v + '» у колонці ' + key + ' — не число');
          else it[key] = n;
        } else if (key === 'active') {
          it.active = !(v === false || NO.indexOf(String(v).trim().toLowerCase()) !== -1);
        } else {
          it[key] = String(v).trim();
        }
      });
      if (!it.id) continue;                    // порожній рядок або без id — пропускаємо мовчки
      if (seen[it.id]) { warnings.push('Рядок ' + line + ': id ' + it.id + ' повторюється — діє перший (рядок ' + seen[it.id] + ')'); continue; }
      seen[it.id] = line;
      if (it.active === undefined) it.active = true;
      if (it.category && CATEGORIES.indexOf(it.category) === -1) warnings.push('Рядок ' + line + ': невідома категорія «' + it.category + '»');
      if (it.active && it.price === undefined) warnings.push('Рядок ' + line + ': ' + it.id + ' без ціни');
      items.push(it);
    }
    // Насос комплекту має існувати в прайсі
    items.forEach(function (it) {
      if (it.pump_kit && !seen[it.pump_kit]) warnings.push(it.id + ': насос комплекту ' + it.pump_kit + ' не знайдено в прайсі');
    });
    return items;
  }

  // Вкладка «Налаштування»: колонки «ключ | значення | опис», перший рядок — заголовок
  function parseSettings(rows) {
    var s = {};
    (rows || []).slice(1).forEach(function (row) {
      var key = String(row[0] === undefined || row[0] === null ? '' : row[0]).trim();
      if (!key || isEmpty(row[1])) return;
      var n = toNumber(row[1]);
      s[key] = isNaN(n) ? String(row[1]).trim() : n;   // «20;45;60», «грн», «materials+equipment» лишаються рядками
    });
    return s;
  }

  // Відбиток вмісту (FNV-1a, 32 біти): однакові дані → однакова версія; змінили ціну → інша версія
  function fingerprint(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; // множення на 16777619 без переповнення
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // Головна функція: рядки обох вкладок → каталог
  function fromSheets(priceRows, settingsRows) {
    var warnings = [];
    var items = parsePrice(priceRows, warnings);
    var settings = parseSettings(settingsRows);
    // Тестові ціни: хоча б одна активна позиція з «ТЕСТ» у назві (у «Довідці»: прибрати «(ТЕСТ)», коли ціна реальна)
    var isTest = items.some(function (it) { return it.active && /ТЕСТ/i.test(it.name || ''); });
    var body = JSON.stringify({ settings: settings, items: items });
    return { version: 'sheet-' + fingerprint(body), is_test: isTest, settings: settings, items: items, warnings: warnings };
  }

  return { fromSheets: fromSheets, parsePrice: parsePrice, parseSettings: parseSettings, toNumber: toNumber, fingerprint: fingerprint };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Catalog;
