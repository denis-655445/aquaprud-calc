/*
 * tests/auth.tests.js — перевірка initData (core/auth.js, D71). Порт Crypto — tests/sha256.js.
 * Підписуємо initData так само, як Telegram, і перевіряємо: правильний, підроблений, застарілий, чужий користувач.
 */
var AuthTests = (function () {
  'use strict';

  var TOKEN = '123456:TEST-token-не-справжній';
  var NOW = 1790000000;                                   // «зараз» для тестів, с

  // Підписуємо поля, як Telegram: hash = hex(HMAC(HMAC("WebAppData", token), рядок для підпису))
  function sign(A, S, fields, token) {
    var secret = S.hmac('WebAppData', token || TOKEN);
    var hash = S.hex(S.hmac(secret, A.dataCheckString(fields)));
    return Object.keys(fields).map(function (k) { return k + '=' + encodeURIComponent(fields[k]); }).join('&') + '&hash=' + hash;
  }

  function fields(extra) {
    var f = { query_id: 'AAH-test', auth_date: String(NOW - 60),
              user: JSON.stringify({ id: 111222333, first_name: 'Олег', last_name: 'Петренко', language_code: 'uk' }) };
    Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
    return f;
  }

  function cases(A, S) {
    var opts = function (o) {
      var base = { botToken: TOKEN, allowedIds: '111222333, 444', nowSec: NOW, hmac: S.hmac, hex: S.hex };
      Object.keys(o || {}).forEach(function (k) { base[k] = o[k]; });
      return base;
    };
    return [
      ['SHA-256: вектор FIPS «abc» і HMAC RFC 4231 (Jefe)', function () {
        return S.hex(S.hash(S.utf8('abc'))) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' &&
          S.hex(S.hmac('Jefe', 'what do ya want for nothing?')) === '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
      }],
      ['initData: правильний підпис, кирилиця в імені, поле signature входить у підпис → доступ є', function () {
        var r1 = A.check(sign(A, S, fields()), opts());
        var r2 = A.check(sign(A, S, fields({ signature: 'abc-_x' })), opts());
        return r1.ok && r1.user.first_name === 'Олег' && r2.ok;
      }],
      ['initData: змінене поле, інший токен, без hash, порожньо → відмова з причиною', function () {
        var good = sign(A, S, fields());
        var tampered = good.replace('111222333', '111222334');
        return A.check(tampered, opts()).reason === 'bad_hash' &&
          A.check(sign(A, S, fields(), '999:other'), opts()).reason === 'bad_hash' &&
          A.check(good.replace(/&hash=.*/, ''), opts()).reason === 'no_hash' &&
          A.check('', opts()).reason === 'no_data' && A.check(good, opts({ botToken: '' })).reason === 'no_token';
      }],
      ['initData: старше 24 год → expired; користувач не в списку / список порожній → not_allowed з ID', function () {
        var old = sign(A, S, fields({ auth_date: String(NOW - 86401) }));
        var r = A.check(sign(A, S, fields()), opts({ allowedIds: '444' }));
        var empty = A.check(sign(A, S, fields()), opts({ allowedIds: '' }));
        return A.check(old, opts()).reason === 'expired' && r.reason === 'not_allowed' && r.userId === '111222333' &&
          empty.reason === 'not_allowed' && /111222333/.test(A.message(r));
      }],
      ['Розбір рядка: «+» — пробіл, %XX декодується, список ID через кому / пробіл / масив', function () {
        var q = A.parseQuery('a=1+2&b=%D0%A2%D0%B5%D1%81%D1%82&c=');
        return q.a === '1 2' && q.b === 'Тест' && q.c === '' &&
          A.idList('1, 2;3 4').join() === '1,2,3,4' && A.idList([5, '6']).join() === '5,6';
      }]
    ];
  }

  function run(A, S) {
    return cases(A, S).map(function (c) {
      try { return { name: c[0], ok: !!c[1]() }; } catch (e) { return { name: c[0], ok: false, error: e.message }; }
    });
  }

  return { run: run, sign: sign, fields: fields, TOKEN: TOKEN, NOW: NOW };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AuthTests;
