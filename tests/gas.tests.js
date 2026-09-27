/*
 * tests/gas.tests.js — адаптер Apps Script (adapters/gas/*.gs) у Node: сервіси Google імітуємо.
 * ЛИШЕ Node (читає файли з диска). Перевіряє те, що без телефона не перевірити: роутер doGet, байти HMAC
 * від Utilities (від −128 до 127), кеш і його скидання, копії ядра = core/*.js.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');

var GasTests = (function () {
  'use strict';

  var DIR = path.join(__dirname, '..', 'adapters', 'gas');

  // Імітація сервісів Google Apps Script: лише те, що використовує адаптер
  function makeSandbox(sheet, props) {
    var toSigned = function (buf) { return Array.prototype.map.call(buf, function (b) { return b > 127 ? b - 256 : b; }); };
    var toBuf = function (bytes) { return Buffer.from(bytes.map(function (b) { return b & 0xff; })); };
    var store = {}, reads = { n: 0 }, sent = [];
    var sheets = { 'Прайс': sheet.price, 'Налаштування': sheet.settings, 'Кошториси': sheet.crm || [EstimateHead.slice()] };
    // Вкладка з записом (CRM): діапазони над масивом рядків, як getRange(рядок, колонка, рядків, колонок) у Google
    function sheetObj(n) {
      var data = sheets[n];
      var width = function () { return data.reduce(function (w, r) { return Math.max(w, r.length); }, 0); };
      var range = function (r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        var get = function () { var out = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(((data[r - 1 + i] || [])[c - 1 + j]) === undefined ? '' : data[r - 1 + i][c - 1 + j]); out.push(row); } return out; };
        var set = function (vals) { vals.forEach(function (row, i) { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach(function (v, j) { data[r - 1 + i][c - 1 + j] = v; }); }); };
        return { getValues: function () { reads.n++; return get(); }, setValues: set, getValue: function () { return get()[0][0]; },
                 setValue: function (v) { set([[v]]); } };
      };
      return { getDataRange: function () { return { getValues: function () { reads.n++; return data; } }; },
               getLastColumn: width, getLastRow: function () { return data.length; }, getRange: range,
               appendRow: function (row) { data.push(row.slice()); } };
    }
    var sb = {
      console: { error: function () {}, log: function () {} }, JSON: JSON, Date: Date, Math: Math,
      Utilities: {
        formatDate: function (d, tz, f) { return f === 'yyyy' ? '2026' : '27.09.2026 12:00'; },
        newBlob: function (s) { return { getBytes: function () { return toSigned(Buffer.from(s, 'utf8')); } }; },
        computeHmacSha256Signature: function (value, key) {
          return toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest());
        }
      },
      PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] || null; } }; } },
      CacheService: { getScriptCache: function () { return {
        get: function (k) { return store[k] || null; }, put: function (k, v) { store[k] = v; }, remove: function (k) { delete store[k]; }
      }; } },
      SpreadsheetApp: { getActiveSpreadsheet: function () { return {
        getSheetByName: function (n) { return sheets[n] ? sheetObj(n) : null; }
      }; } },
      LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
      Session: { getScriptTimeZone: function () { return 'Europe/Kyiv'; } },
      // Bot API: запам'ятовуємо, що і кому надіслали б; chat_id 999 — «користувач не натиснув /start»
      UrlFetchApp: { fetch: function (url, o) {
        var b = JSON.parse(o.payload); sent.push(b);
        return { getResponseCode: function () { return String(b.chat_id) === '999' ? 403 : 200; } };
      } },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (t) {
        return { text: t, setMimeType: function () { return this; } };
      } }
    };
    vm.createContext(sb);
    // Порядок як у редакторі Apps Script неважливий: функції викликаються вже після завантаження всіх файлів
    ['core_auth.gs', 'core_catalog.gs', 'core_estimate.gs', 'auth.gs', 'storage.gs', 'estimates.gs', 'telegram.gs', 'Code.gs'].forEach(function (f) {
      vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sb, { filename: f });
    });
    sb.__reads = reads; sb.__sheets = sheets; sb.__sent = sent;
    return sb;
  }

  function get(sb, params) { return JSON.parse(sb.doGet({ parameter: params }).text); }
  function post(sb, body) { return JSON.parse(sb.doPost({ postData: { contents: JSON.stringify(body) } }).text); }
  var EstimateHead = require('./estimate.tests.js').HEAD;
  // Запит saveEstimate, як його збирає застосунок (buildSnap + uid + app_state)
  function payload(o) {
    return Object.assign({ uid: 'k1abcdefgh', text: 'Кошторис Aquaprud від 27.09.2026\nРазом: 45 000 грн',
      summary: { client: 'Іван', phone: '', address: 'Київ', total: 45000, comment: 'зателефонувати' },
      app_state: { state: { inputs: { L: '6' } }, svc: {} } }, o || {});
  }

  function run(AuthTests, Sha256, sheet) {
    var props = { BOT_TOKEN: AuthTests.TOKEN, ALLOWED_USER_IDS: '111222333' };
    var Auth = require('../core/auth.js');
    // initData з «теперішнім» часом: адаптер бере Date.now()
    function initData(extra) {
      var f = AuthTests.fields(extra);
      f.auth_date = String(Math.floor(Date.now() / 1000) - 10);
      return AuthTests.sign(Auth, Sha256, f);
    }
    var cases = [
      ['GAS: копії ядра adapters/gas/core_*.gs збігаються з core/auth.js і core/catalog.js', function () {
        var same = function (a, b) { return fs.readFileSync(path.join(DIR, a), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'core', b), 'utf8'); };
        return same('core_auth.gs', 'auth.js') && same('core_catalog.gs', 'catalog.js') && same('core_estimate.gs', 'estimate.js');
      }],
      ['GAS: ping без доступу; catalog без initData / з підробленим → error auth', function () {
        var sb = makeSandbox(sheet, props);
        var bad = initData().replace('111222333', '111222334');
        return get(sb, { action: 'ping' }).ok === true && get(sb, { action: 'catalog' }).error === 'auth' &&
          get(sb, { action: 'catalog', initData: bad }).error === 'auth';
      }],
      ['GAS: catalog з правильним initData (байти Utilities зі знаком) → 43 позиції, версія, is_test', function () {
        var r = get(makeSandbox(sheet, props), { action: 'catalog', initData: initData() });
        return r.ok && r.items.length === 43 && /^sheet-/.test(r.version) && r.is_test === true && r.settings.labor_pct === 100;
      }],
      ['GAS: кеш — друге відкриття таблицю не читає; правка в «Прайсі» (onEdit) скидає кеш і дає нову ціну', function () {
        var sb = makeSandbox(sheet, props), q = { action: 'catalog', initData: initData() };
        var v1 = get(sb, q).version; get(sb, q);
        var readsAfter2 = sb.__reads.n;                        // 2 вкладки × 1 читання
        sb.__sheets['Прайс'] = JSON.parse(JSON.stringify(sheet.price)); sb.__sheets['Прайс'][1][4] = 9999;
        sb.onEdit({ range: { getSheet: function () { return { getName: function () { return 'Прайс'; } }; } } });
        var r = get(sb, q);
        return readsAfter2 === 2 && r.version !== v1 && r.items[0].price === 9999;
      }],
      ['GAS: чужий користувач → повідомлення з його ID; немає вкладки → error internal з назвою вкладки', function () {
        var r = get(makeSandbox(sheet, { BOT_TOKEN: AuthTests.TOKEN, ALLOWED_USER_IDS: '5' }), { action: 'catalog', initData: initData() });
        var sb = makeSandbox({ price: sheet.price, settings: null }, props);
        delete sb.__sheets['Налаштування'];
        var r2 = get(sb, { action: 'catalog', initData: initData() });
        return r.error === 'auth' && /111222333/.test(r.message) && r2.error === 'internal' && /Налаштування/.test(r2.message);
      }],
      ['GAS A4: saveEstimate → рядок з AP-2026-001, статус «новий», uid-колонка додана сама; повідомлення обом з кнопкою', function () {
        var p2 = Object.assign({}, props, { ALLOWED_USER_IDS: '111222333,444', MINIAPP_URL: 'https://x.github.io/aquaprud-calc/miniapp/' });
        var sb = makeSandbox(sheet, p2);
        var r = post(sb, { action: 'saveEstimate', initData: initData(), payload: payload() });
        var crm = sb.__sheets['Кошториси'], h = crm[0], row = crm[1];
        var last = sb.__sent[sb.__sent.length - 1];
        return r.ok && r.number === 'AP-2026-001' && r.created === true && r.notified === 2 && crm.length === 2 &&
          h[h.length - 1] === 'uid' && row[h.indexOf('№')] === 'AP-2026-001' && row[h.indexOf('статус')] === 'новий' &&
          row[h.indexOf('клієнт')] === 'Іван' && row[h.indexOf('uid')] === 'k1abcdefgh' && JSON.parse(row[h.indexOf('json')]).uid === 'k1abcdefgh' &&
          sb.__sent.length === 2 && /^🆕 № AP-2026-001/.test(last.text) && /Для себе: зателефонувати/.test(last.text) &&
          last.reply_markup.inline_keyboard[0][0].web_app.url === 'https://x.github.io/aquaprud-calc/miniapp/?open=AP-2026-001';
      }],
      ['GAS A4: повтор того самого uid — той самий рядок і номер, статус і телефон з таблиці лишаються; новий uid → AP-2026-002', function () {
        var sb = makeSandbox(sheet, props);
        post(sb, { action: 'saveEstimate', initData: initData(), payload: payload() });
        var crm = sb.__sheets['Кошториси'], h = crm[0];
        crm[1][h.indexOf('статус')] = 'погоджено'; crm[1][h.indexOf('телефон')] = '+380 50 111 22 33';   // майстер дописав у таблиці
        var r2 = post(sb, { action: 'saveEstimate', initData: initData(), payload: payload({ summary: { client: 'Іван', total: 50000, phone: '' } }) });
        var r3 = post(sb, { action: 'saveEstimate', initData: initData(), payload: payload({ uid: 'k2abcdefgh' }) });
        return r2.ok && r2.number === 'AP-2026-001' && r2.created === false && crm.length === 3 &&
          crm[1][h.indexOf('разом')] === 50000 && crm[1][h.indexOf('статус')] === 'погоджено' &&
          crm[1][h.indexOf('телефон')] === '+380 50 111 22 33' && r3.number === 'AP-2026-002' &&
          /^✏️ Оновлено № AP-2026-001/.test(sb.__sent[1].text);
      }],
      ['GAS A4: без імені → validation і рядка немає; без доступу → auth; чат недоступний — запис усе одно є', function () {
        var sb = makeSandbox(sheet, Object.assign({}, props, { ALLOWED_USER_IDS: '111222333,999' }));
        var r1 = post(sb, { action: 'saveEstimate', initData: initData(), payload: payload({ summary: { client: '' } }) });
        var r2 = post(sb, { action: 'saveEstimate', payload: payload() });
        var r3 = post(sb, { action: 'saveEstimate', initData: initData(), payload: payload() });
        return r1.error === 'validation' && r2.error === 'auth' && r3.ok && r3.notified === 1 && sb.__sheets['Кошториси'].length === 2;
      }],
      ['GAS A4: estimate за номером → збережений запит з app_state; невідомий номер → validation', function () {
        var sb = makeSandbox(sheet, props);
        post(sb, { action: 'saveEstimate', initData: initData(), payload: payload() });
        var r = get(sb, { action: 'estimate', number: 'AP-2026-001', initData: initData() });
        var r2 = get(sb, { action: 'estimate', number: 'AP-2026-777', initData: initData() });
        return r.ok && r.estimate.uid === 'k1abcdefgh' && r.estimate.app_state.state.inputs.L === '6' && r2.error === 'validation';
      }],
      ['Node crypto = tests/sha256.js: однаковий HMAC для рядка з кирилицею', function () {
        var key = crypto.createHmac('sha256', 'WebAppData').update('123:abc').digest();
        var a = crypto.createHmac('sha256', key).update('user={"first_name":"Олег"}', 'utf8').digest('hex');
        var b = Sha256.hex(Sha256.hmac(Sha256.hmac('WebAppData', '123:abc'), 'user={"first_name":"Олег"}'));
        return a === b;
      }]
    ];
    return cases.map(function (c) {
      try { return { name: c[0], ok: !!c[1]() }; } catch (e) { return { name: c[0], ok: false, error: e.message }; }
    });
  }

  return { run: run };
})();

module.exports = GasTests;
