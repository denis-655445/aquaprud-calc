/*
 * adapters/gas/telegram.gs — порт Messenger: повідомлення в чат бота через Bot API (етап A4).
 * Секрети — «Властивості скрипту»: BOT_TOKEN, ALLOWED_USER_IDS; MINIAPP_URL — адреса застосунку (для кнопки).
 */

// Одне повідомлення; помилка Telegram не ламає запис у таблицю → повертаємо true / false
function sendMessage_(token, chatId, text, markup) {
  var body = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (markup) body.reply_markup = markup;
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true
  });
  return res.getResponseCode() === 200;
}

/*
 * v0.9.1: перевірка MINIAPP_URL → '' (усе добре) або текст проблеми.
 * Типова помилка: адреса сторінки репозиторію (github.com/…/tree/…) замість сайту GitHub Pages (….github.io/…):
 * тоді кнопка відкриває GitHub, а не калькулятор.
 */
function miniAppUrlProblem_(url) {
  url = String(url || '').trim();
  if (!url) return 'MINIAPP_URL не задано — кнопки «Відкрити в калькуляторі» не буде';
  if (!/^https:\/\//.test(url)) return 'MINIAPP_URL має починатися з https://';
  if (/^https:\/\/(www\.)?github\.com\//i.test(url)) {
    return 'MINIAPP_URL — це адреса репозиторію GitHub, а не застосунку. Потрібно: https://<логін>.github.io/aquaprud-calc/miniapp/';
  }
  return '';
}

/*
 * Кошторис — усім з ALLOWED_USER_IDS (власник + техпрацівник). Користувач має хоч раз натиснути /start у боті,
 * інакше Telegram не дозволить боту написати першим. → скільки чатів отримали
 */
function notifyEstimate_(p, saved, user) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('BOT_TOKEN');
  var ids = Auth.idList(props.getProperty('ALLOWED_USER_IDS'));
  var appUrl = props.getProperty('MINIAPP_URL');
  var urlProblem = miniAppUrlProblem_(appUrl);
  if (urlProblem) { console.error(urlProblem); appUrl = ''; }   // хибна адреса → без кнопки, а не кнопка на GitHub
  var who = user && (user.first_name || user.username) ? ' · ' + (user.first_name || user.username) : '';
  var head = (saved.created ? '🆕 № ' : '✏️ Оновлено № ') + saved.number + who;
  var text = head + '\n\n' + p.text + (p.summary.comment ? '\n\nДля себе: ' + p.summary.comment : '');
  var parts = Estimate.splitText(text);
  // Кнопка web_app працює лише в особистому чаті з ботом — саме туди й пишемо
  var markup = appUrl ? { inline_keyboard: [[{ text: 'Відкрити в калькуляторі',
    web_app: { url: appUrl + (appUrl.indexOf('?') === -1 ? '?' : '&') + 'open=' + encodeURIComponent(saved.number) } }]] } : null;
  var sent = 0;
  ids.forEach(function (id) {
    var ok = true;
    parts.forEach(function (t, i) { ok = sendMessage_(token, id, t, i === parts.length - 1 ? markup : null) && ok; });
    if (ok) sent++;
  });
  return sent;
}
