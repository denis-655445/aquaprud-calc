/*
 * miniapp/js/api.js — єдине місце, де застосунок спілкується з бекендом.
 * Контракт однаковий для Apps Script і майбутнього сервера (project_status.md §7).
 *
 * Прайс (v0.8.0, D70): спершу мережа, резерв — останній отриманий прайс у пам'яті телефона.
 *   • є зв'язок → свіжий прайс, копія зберігається;
 *   • немає зв'язку / сервер не відповів вчасно → збережена копія з датою (банер);
 *   • помилка доступу (auth) → копію НЕ показуємо: доступ відкликано або щось не так з підписом.
 * Поза Telegram (браузер на MacBook) initData немає → тестовий каталог, як на етапі A2.
 */
var Api = (function () {
  'use strict';

  var CACHE_KEY = 'aquaprud_catalog_v1';
  var TIMEOUT_WITH_CACHE = 6000;    // є копія — довго не чекаємо (слабкий інтернет на об'єкті)
  var TIMEOUT_NO_CACHE = 20000;     // копії немає — чекаємо довше: Apps Script інколи «прокидається» кілька секунд

  // initData — підписаний Telegram рядок; бекенд перевіряє ним, що запит саме від нас
  function initData() {
    var tg = window.Telegram && window.Telegram.WebApp;
    return tg && tg.initData ? tg.initData : '';
  }

  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return c && c.catalog && c.catalog.items ? c : null; }
    catch (e) { return null; }
  }

  function writeCache(catalog) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), catalog: catalog })); } catch (e) { /* пам'ять повна — не критично */ }
  }

  // Помилка з типом: auth — не підміняємо копією; решта — мережа / сервер
  function fail(kind, message) { var e = new Error(message); e.kind = kind; return e; }

  // GET з обмеженням часу (AbortController є в iOS 12.1+)
  function fetchJson(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        if (!r.ok) throw fail('net', 'сервер відповів ' + r.status);
        return r.json();
      })
      .catch(function (err) {
        if (err.kind) throw err;
        throw fail('net', err.name === 'AbortError' ? 'сервер не відповів за ' + Math.round(ms / 1000) + ' с' : 'немає зв\'язку');
      })
      .then(function (res) { clearTimeout(timer); return res; }, function (err) { clearTimeout(timer); throw err; });
  }

  /*
   * Прайс і налаштування → { catalog, source, savedAt?, reason? }
   *   source: 'sample' (тестовий) · 'net' (свіжий) · 'cache' (збережена копія; reason — чому)
   */
  function loadCatalog() {
    var sample = function () {
      if (typeof SAMPLE_CATALOG === 'undefined') return Promise.reject(new Error('Не знайдено тестовий каталог data/catalog.sample.js'));
      return Promise.resolve({ catalog: SAMPLE_CATALOG, source: 'sample' });
    };
    if (!CONFIG.API_BASE || !initData()) return sample();

    var cached = readCache();
    var url = CONFIG.API_BASE + '?action=catalog&initData=' + encodeURIComponent(initData());
    return fetchJson(url, cached ? TIMEOUT_WITH_CACHE : TIMEOUT_NO_CACHE)
      .then(function (res) {
        // Помилки бекенд повертає в тілі: { ok: false, error, message } (D13)
        if (!res || !res.ok) throw fail(res && res.error === 'auth' ? 'auth' : 'server', (res && res.message) || 'помилка сервера');
        if (!Array.isArray(res.items) || !res.settings) throw fail('server', 'відповідь без прайсу');
        var catalog = { version: res.version, is_test: !!res.is_test, settings: res.settings, items: res.items, warnings: res.warnings || [] };
        writeCache(catalog);
        return { catalog: catalog, source: 'net' };
      })
      .catch(function (err) {
        if (err.kind !== 'auth' && cached) return { catalog: cached.catalog, source: 'cache', savedAt: cached.savedAt, reason: err.message };
        throw err;
      });
  }

  return { loadCatalog: loadCatalog, initData: initData };
})();
