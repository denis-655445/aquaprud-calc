/*
 * adapters/gas/estimates.gs — порт Storage для кошторисів (етап A4): вкладка «Кошториси» (CRM, §5.3).
 * Логіка рядка (номер, колонки, злиття) — у ядрі: core_estimate.gs = копія core/estimate.js.
 */
var SHEET_CRM = 'Кошториси';

// Вкладка CRM і заголовки; службову колонку uid додаємо самі, якщо її ще немає (руками нічого робити не треба)
function crmSheet_() {
  var sh = book_().getSheetByName(SHEET_CRM);
  if (!sh) throw new Error('Немає вкладки «' + SHEET_CRM + '» (назви вкладок не перейменовувати)');
  var width = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.indexOf(Estimate.COLS.uid) === -1) {
    headers.push(Estimate.COLS.uid);
    sh.getRange(1, headers.length).setValue(Estimate.COLS.uid);
  }
  return { sh: sh, headers: headers };
}

// Значення однієї колонки (без заголовка); порожня вкладка → []
function column_(crm, key) {
  var col = crm.headers.indexOf(Estimate.COLS[key]) + 1;
  var rows = crm.sh.getLastRow() - 1;
  if (!col || rows < 1) return [];
  return crm.sh.getRange(2, col, rows, 1).getValues().map(function (r) { return String(r[0]).trim(); });
}

/*
 * Запис кошторису: той самий uid → оновлюємо рядок (номер, дата, статус не змінюються); новий → рядок у кінці з номером.
 * Замок: два телефони одночасно не отримають однаковий номер. → { number, created }
 */
function saveEstimateRow_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);                                     // чекаємо до 20 с, поки інший запис завершиться
  try {
    var crm = crmSheet_();
    var rec = Object.assign({}, p.summary, { uid: p.uid, json: JSON.stringify(p) });
    var at = column_(crm, 'uid').indexOf(p.uid);
    if (at !== -1) {                                         // оновлення: рядок = at + 2 (заголовок і відлік з 1)
      var range = crm.sh.getRange(at + 2, 1, 1, crm.headers.length);
      var row = Estimate.mergeRow(crm.headers, range.getValues()[0], rec);
      range.setValues([row]);
      return { number: String(row[crm.headers.indexOf(Estimate.COLS.number)]), created: false };
    }
    var settings = readCatalog_().settings;                  // префікс номера — з «Налаштувань» (estimate_prefix)
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    rec.number = Estimate.nextNumber(column_(crm, 'number'), settings.estimate_prefix || 'AP', Utilities.formatDate(now, tz, 'yyyy'));
    rec.date = Utilities.formatDate(now, tz, 'dd.MM.yyyy HH:mm');
    rec.status = 'новий';
    crm.sh.appendRow(Estimate.toRow(crm.headers, rec));
    return { number: rec.number, created: true };
  } finally {
    lock.releaseLock();
  }
}

// Кошторис за номером (кнопка «Відкрити в калькуляторі» в чаті) → збережений запит або null
function findEstimate_(number) {
  var crm = crmSheet_();
  var at = column_(crm, 'number').indexOf(String(number).trim());
  if (at === -1) return null;
  var col = crm.headers.indexOf(Estimate.COLS.json) + 1;
  try { return JSON.parse(crm.sh.getRange(at + 2, col).getValue()); } catch (e) { return null; }
}
