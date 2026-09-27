/*
 * core/auth.js — перевірка initData Telegram Mini App (project_status.md §8, D71).
 * Чисті функції: HMAC-SHA256 передається портом (Apps Script — Utilities, Node — node:crypto, тести — tests/sha256.js),
 * тому той самий код працює в усіх адаптерах без змін (D11).
 *
 * Алгоритм Telegram (core.telegram.org/bots/webapps, «Validating data received via the Mini App»):
 *   1) з initData прибираємо поле hash, решту сортуємо за назвою і з'єднуємо «ключ=значення» через \n;
 *   2) secret = HMAC_SHA256(key = "WebAppData", message = BOT_TOKEN);
 *   3) hex(HMAC_SHA256(key = secret, message = рядок з п. 1)) має дорівнювати hash.
 * Поле signature (Ed25519 для сторонніх перевірок) у рядок з п. 1 ВХОДИТЬ — виключається лише hash.
 */
var Auth = (function () {
  'use strict';

  var MAX_AGE_SEC = 24 * 3600; // initData старші за 24 год не приймаємо (§8)

  // Розбір рядка запиту «a=1&b=2» → { a: '1', b: '2' }; «+» — пробіл, %XX — декодуємо
  function parseQuery(str) {
    var out = {};
    String(str || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i < 0 ? pair : pair.slice(0, i);
      var v = i < 0 ? '' : pair.slice(i + 1);
      try {
        k = decodeURIComponent(k.replace(/\+/g, ' '));
        v = decodeURIComponent(v.replace(/\+/g, ' '));
      } catch (e) { return; } // зіпсоване кодування — пару пропускаємо (підпис тоді не зійдеться)
      out[k] = v;
    });
    return out;
  }

  // Рядок для підпису: усі поля, крім hash, за абеткою, через перенесення рядка
  function dataCheckString(fields) {
    return Object.keys(fields).filter(function (k) { return k !== 'hash'; }).sort()
      .map(function (k) { return k + '=' + fields[k]; }).join('\n');
  }

  // Порівняння рядків за сталий час — не підказує зловмиснику, скільки символів збіглося
  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // Список дозволених ID: «123, 456» або масив → ['123', '456']
  function idList(v) {
    if (Array.isArray(v)) return v.map(String);
    return String(v || '').split(/[\s,;]+/).filter(Boolean);
  }

  /*
   * Перевірка. opts: { botToken, allowedIds, nowSec, hmac, hex [, maxAgeSec] }
   *   hmac(key, message) → «сирий» підпис; key — рядок або сирий підпис з попереднього виклику; message — рядок (UTF-8)
   *   hex(raw) → рядок з 64 шістнадцяткових символів
   * Результат: { ok: true, user } або { ok: false, reason, userId? }
   *   reason: no_token · no_data · no_hash · bad_hash · expired · not_allowed
   *   userId повертаємо лише після правильного підпису — щоб майстер побачив свій ID і додав його в список
   */
  function check(initData, opts) {
    if (!opts || !opts.botToken) return { ok: false, reason: 'no_token' };
    if (!initData) return { ok: false, reason: 'no_data' };
    var fields = parseQuery(initData);
    if (!fields.hash) return { ok: false, reason: 'no_hash' };

    var secret = opts.hmac('WebAppData', opts.botToken);
    var expected = opts.hex(opts.hmac(secret, dataCheckString(fields)));
    if (!safeEqual(expected, String(fields.hash).toLowerCase())) return { ok: false, reason: 'bad_hash' };

    // Далі дані точно від Telegram: перевіряємо вік і користувача
    var user = null;
    try { user = JSON.parse(fields.user || 'null'); } catch (e) { user = null; }
    var userId = user && user.id !== undefined ? String(user.id) : '';
    var age = opts.nowSec - Number(fields.auth_date);
    var maxAge = opts.maxAgeSec || MAX_AGE_SEC;
    if (!(age <= maxAge) || age < -300) return { ok: false, reason: 'expired', userId: userId }; // −300 с — розбіжність годинників
    // Порожній список = доступ нікому (безпечне значення за замовчуванням)
    if (!userId || idList(opts.allowedIds).indexOf(userId) === -1) return { ok: false, reason: 'not_allowed', userId: userId };
    return { ok: true, user: user };
  }

  // Текст помилки для людини (показує застосунок)
  function message(res) {
    switch (res.reason) {
      case 'no_token': return 'На сервері не задано BOT_TOKEN (Властивості скрипту)';
      case 'no_data': return 'Відкрийте калькулятор кнопкою в боті @aquaprud_bot';
      case 'no_hash':
      case 'bad_hash': return 'Підпис Telegram не збігся: перевірте BOT_TOKEN на сервері';
      case 'expired': return 'Сеанс застарів: закрийте й відкрийте калькулятор знову';
      case 'not_allowed': return 'Доступ заборонено: ваш Telegram ID ' + (res.userId || '?') + ' не додано в ALLOWED_USER_IDS';
      default: return 'Помилка доступу';
    }
  }

  return { check: check, message: message, parseQuery: parseQuery, dataCheckString: dataCheckString, idList: idList, MAX_AGE_SEC: MAX_AGE_SEC };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Auth;
