/*
 * adapters/gas/auth.gs — порт Crypto для Auth (core_auth.gs): HMAC-SHA256 через Utilities (D11, §12).
 * Секрети — лише у «Властивостях скрипту»: BOT_TOKEN, ALLOWED_USER_IDS (через кому). У коді — ніколи.
 */

// «Сирий» підпис — масив байтів Apps Script (числа від −128 до 127)
function hmacGas_(key, message) {
  var msg = Utilities.newBlob(message).getBytes();               // рядок → байти UTF-8 (кирилиця в імені користувача)
  var k = typeof key === 'string' ? Utilities.newBlob(key).getBytes() : key;
  return Utilities.computeHmacSha256Signature(msg, k);
}

// Байти → шістнадцятковий рядок; & 0xff робить із від'ємного байта число 0…255
function hexGas_(bytes) {
  return bytes.map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}

function checkAuth_(initData) {
  var props = PropertiesService.getScriptProperties();
  return Auth.check(initData, {
    botToken: props.getProperty('BOT_TOKEN'),
    allowedIds: props.getProperty('ALLOWED_USER_IDS'),
    nowSec: Math.floor(Date.now() / 1000),
    hmac: hmacGas_,
    hex: hexGas_
  });
}
