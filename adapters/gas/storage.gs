/*
 * adapters/gas/storage.gs — порт Storage: читання «Прайсу» і «Налаштувань» (D12, §5).
 * Кеш на сервері — 5 хв (D73): таблицю не читаємо на кожне відкриття. Кеш скидається:
 *   • сам — після зміни будь-якої клітинки (onEdit);
 *   • вручну — меню «Aquaprud → Оновити прайс у застосунку»;
 *   • за часом — через 5 хв (якщо зміна прийшла не з редактора, напр. імпорт файла).
 */
var SHEET_PRICE = 'Прайс';
var SHEET_SETTINGS = 'Налаштування';
var CACHE_KEY = 'catalog_v1';
var CACHE_SEC = 300;

// Таблиця, до якої прив'язано скрипт; резерв — SHEET_ID у «Властивостях скрипту»
function book_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Скрипт не прив\'язаний до таблиці і не задано SHEET_ID');
  return SpreadsheetApp.openById(id);
}

function sheetValues_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Немає вкладки «' + name + '» (назви вкладок не перейменовувати)');
  return sh.getDataRange().getValues();
}

// Каталог: з кешу або з таблиці
function readCatalog_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var ss = book_();
  var cat = Catalog.fromSheets(sheetValues_(ss, SHEET_PRICE), sheetValues_(ss, SHEET_SETTINGS));
  var text = JSON.stringify(cat);
  if (text.length < 90000) cache.put(CACHE_KEY, text, CACHE_SEC);   // межа кешу — 100 КБ на ключ
  return cat;
}

function clearCatalogCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// Простий тригер: будь-яка правка в «Прайсі» чи «Налаштуваннях» скидає кеш
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    if (name === SHEET_PRICE || name === SHEET_SETTINGS) clearCatalogCache_();
  } catch (err) { /* кеш зникне сам через 5 хв */ }
}

// Перший запуск з редактора (кнопка «Виконати»): Google попросить дозвіл на таблицю; результат — у «Журналі виконання»
function checkFromEditor() {
  clearCatalogCache_();
  var cat = readCatalog_();
  console.log('Позицій: ' + cat.items.length + ', налаштувань: ' + Object.keys(cat.settings).length + ', версія ' + cat.version +
    ', тестові ціни: ' + (cat.is_test ? 'так' : 'ні') + '. Попереджень: ' + cat.warnings.length);
  cat.warnings.forEach(function (w) { console.log('• ' + w); });
  // v0.9.1: адреса застосунку для кнопки в чаті (етап A4)
  var urlProblem = miniAppUrlProblem_(PropertiesService.getScriptProperties().getProperty('MINIAPP_URL'));
  console.log(urlProblem ? '⚠️ ' + urlProblem : 'MINIAPP_URL: OK');
}

// Меню в таблиці
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Aquaprud')
    .addItem('Оновити прайс у застосунку', 'menuRefresh')
    .addItem('Перевірити прайс', 'menuCheck')
    .addToUi();
}

function menuRefresh() {
  clearCatalogCache_();
  SpreadsheetApp.getUi().alert('Готово: застосунок отримає новий прайс при наступному відкритті.');
}

// Перевірка без застосунку: скільки позицій і які помилки
function menuCheck() {
  clearCatalogCache_();
  var cat = readCatalog_();
  var text = 'Позицій: ' + cat.items.length + '. Налаштувань: ' + Object.keys(cat.settings).length +
    '. Версія: ' + cat.version + (cat.is_test ? '. Є тестові ціни («ТЕСТ» у назвах).' : '.') +
    (cat.warnings.length ? '\n\nПопередження:\n• ' + cat.warnings.join('\n• ') : '\n\nПомилок немає.');
  var urlProblem = miniAppUrlProblem_(PropertiesService.getScriptProperties().getProperty('MINIAPP_URL'));
  if (urlProblem) text += '\n\n⚠️ ' + urlProblem;                    // v0.9.1: кнопка «Відкрити в калькуляторі»
  SpreadsheetApp.getUi().alert(text);
}
