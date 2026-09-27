/*
 * adapters/gas/Code.gs — роутер API на Google Apps Script (етап A3, project_status.md §7).
 * Контракт: GET ?action=…&initData=… → JSON; помилки — в тілі, HTTP завжди 200 (D13).
 * Ядро (Auth, Catalog) — копії core/auth.js і core/catalog.js у файлах core_auth.gs і core_catalog.gs.
 */
var API_VERSION = 'gas-0.8.0';

// Відповідь у форматі JSON
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Усі GET-запити застосунку
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    // Перевірка адреси з браузера: …/exec?action=ping — без доступу до даних
    if (p.action === 'ping') return json_({ ok: true, api: API_VERSION });

    var auth = checkAuth_(p.initData);                       // auth.gs
    if (!auth.ok) return json_({ ok: false, error: 'auth', message: Auth.message(auth) });

    if (p.action === 'catalog') {
      var cat = readCatalog_();                              // storage.gs (з кешем)
      return json_({ ok: true, version: cat.version, is_test: cat.is_test, settings: cat.settings,
                     items: cat.items, warnings: cat.warnings });
    }
    return json_({ ok: false, error: 'validation', message: 'Невідома дія: ' + p.action });
  } catch (err) {
    console.error(err);                                      // видно в «Виконання» редактора
    return json_({ ok: false, error: 'internal', message: String(err && err.message || err) });
  }
}
