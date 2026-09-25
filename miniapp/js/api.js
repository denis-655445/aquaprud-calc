/*
 * miniapp/js/api.js — єдине місце, де застосунок спілкується з бекендом.
 * Контракт однаковий для Apps Script і майбутнього сервера (project_status.md §7).
 */
var Api = (function () {
  'use strict';

  // initData — підписаний Telegram рядок; бекенд перевіряє ним, що запит саме від нас
  function initData() {
    var tg = window.Telegram && window.Telegram.WebApp;
    return tg && tg.initData ? tg.initData : '';
  }

  // Прайс і налаштування. Етап A2: без бекенду — тестовий каталог
  function loadCatalog() {
    if (!CONFIG.API_BASE) {
      if (typeof SAMPLE_CATALOG === 'undefined') {
        return Promise.reject(new Error('Не знайдено тестовий каталог data/catalog.sample.js'));
      }
      return Promise.resolve(SAMPLE_CATALOG);
    }
    var url = CONFIG.API_BASE + '?action=catalog&initData=' + encodeURIComponent(initData());
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        // Помилки бекенд повертає в тілі відповіді: { ok: false, error, message }
        if (!res.ok) throw new Error(res.message || res.error || 'Помилка завантаження прайсу');
        return res;
      });
  }

  return { loadCatalog: loadCatalog, initData: initData };
})();
