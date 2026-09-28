/*
 * adapters/gas/Code.gs — роутер API на Google Apps Script (етапи A3–A4, project_status.md §7).
 * Контракт: GET ?action=…&initData=… і POST (text/plain, JSON { action, initData, payload }) → JSON;
 * помилки — в тілі, HTTP завжди 200 (D13).
 * Ядро (Auth, Catalog, Estimate) — копії core/*.js у файлах core_auth.gs, core_catalog.gs, core_estimate.gs.
 */
var API_VERSION = 'gas-0.9.1';

// Відповідь у форматі JSON
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Спільне для GET і POST: помилка доступу або null
function denied_(initData) {
  var auth = checkAuth_(initData);                           // auth.gs
  return auth.ok ? { user: auth.user } : { error: json_({ ok: false, error: 'auth', message: Auth.message(auth) }) };
}

// Читання: ping, прайс, кошторис за номером
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    // Перевірка адреси з браузера: …/exec?action=ping — без доступу до даних
    if (p.action === 'ping') return json_({ ok: true, api: API_VERSION });

    var a = denied_(p.initData);
    if (a.error) return a.error;

    if (p.action === 'catalog') {
      var cat = readCatalog_();                              // storage.gs (з кешем)
      return json_({ ok: true, version: cat.version, is_test: cat.is_test, settings: cat.settings,
                     items: cat.items, warnings: cat.warnings });
    }
    if (p.action === 'estimate') {                          // кнопка «Відкрити в калькуляторі» (A4)
      var est = findEstimate_(p.number);                     // estimates.gs
      return est ? json_({ ok: true, estimate: est })
                 : json_({ ok: false, error: 'validation', message: 'Кошторис ' + p.number + ' не знайдено в таблиці' });
    }
    return json_({ ok: false, error: 'validation', message: 'Невідома дія: ' + p.action });
  } catch (err) {
    console.error(err);                                      // видно в «Виконання» редактора
    return json_({ ok: false, error: 'internal', message: String(err && err.message || err) });
  }
}

// Запис: saveEstimate → рядок у «Кошторисах» + повідомлення в чат (A4)
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var a = denied_(body.initData);
    if (a.error) return a.error;

    if (body.action === 'saveEstimate') {
      var bad = Estimate.validate(body.payload);
      if (bad) return json_({ ok: false, error: 'validation', message: bad });
      var saved = saveEstimateRow_(body.payload);            // estimates.gs
      var sent = 0;
      try { sent = notifyEstimate_(body.payload, saved, a.user); } catch (err) { console.error(err); } // чат — не критично
      return json_({ ok: true, number: saved.number, created: saved.created, notified: sent });
    }
    return json_({ ok: false, error: 'validation', message: 'Невідома дія: ' + body.action });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'internal', message: String(err && err.message || err) });
  }
}
