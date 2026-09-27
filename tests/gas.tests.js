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
    var store = {}, reads = { n: 0 };
    var sheets = { 'Прайс': sheet.price, 'Налаштування': sheet.settings };
    var sb = {
      console: { error: function () {}, log: function () {} }, JSON: JSON, Date: Date, Math: Math,
      Utilities: {
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
        getSheetByName: function (n) {
          return sheets[n] ? { getDataRange: function () { return { getValues: function () { reads.n++; return sheets[n]; } }; } } : null;
        }
      }; } },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (t) {
        return { text: t, setMimeType: function () { return this; } };
      } }
    };
    vm.createContext(sb);
    // Порядок як у редакторі Apps Script неважливий: функції викликаються вже після завантаження всіх файлів
    ['core_auth.gs', 'core_catalog.gs', 'auth.gs', 'storage.gs', 'Code.gs'].forEach(function (f) {
      vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sb, { filename: f });
    });
    sb.__reads = reads; sb.__sheets = sheets;
    return sb;
  }

  function get(sb, params) { return JSON.parse(sb.doGet({ parameter: params }).text); }

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
        return same('core_auth.gs', 'auth.js') && same('core_catalog.gs', 'catalog.js');
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
