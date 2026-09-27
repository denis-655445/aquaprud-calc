/*
 * miniapp/js/config.js — налаштування застосунку.
 * Файл публічний (GitHub Pages), тому тут НІКОЛИ не буває токенів і ключів.
 */
var CONFIG = {
  APP_VERSION: '0.8.0',
  // Адреса бекенду: URL веб-застосунку Apps Script, що закінчується на /exec (етап A3, README).
  // Порожньо або застосунок відкрито поза Telegram = тестовий каталог з data/catalog.sample.js
  API_BASE: 'https://script.google.com/macros/s/AKfycbzm8OxWpn2mfWA8CSbSZG6fglMlx113zjZ4DjoUS-u-csXMAyVHaB0JMBUjWeaTc6e7Dg/exec',
  // Ключ чернетки в пам'яті телефона: введене не зникне, якщо застосунок закрився
  DRAFT_KEY: 'aquaprud_draft_v1',
  // Посилання, яке Telegram прикріплює до повідомлення «Надіслати в Telegram»
  SHARE_URL: 'https://aquaprud.com'
};
