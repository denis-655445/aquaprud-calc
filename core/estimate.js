/*
 * core/estimate.js — кошторис для CRM (етап A4): номер, рядок таблиці, перевірка, архів у телефоні.
 * Чисті функції без DOM і API платформ (D11): працює в браузері, Apps Script і Node.
 */
var Estimate = (function () {
  'use strict';

  // Ключ запису → заголовок колонки вкладки «Кошториси» (§5.3). Колонку шукаємо за заголовком,
  // тож порядок колонок у таблиці можна міняти. uid — службова: захист від дублів при повторній відправці
  var COLS = {
    number: '№', date: 'дата', status: 'статус', client: 'клієнт', phone: 'телефон', address: 'адреса',
    shape: 'форма', dims: 'L×W×D', area: 'S, м²', volume: 'V_заг, м³', bio: 'біоплато', film: 'плівка',
    filter: 'фільтр', uv: 'УФ', pump: 'насос', head: 'H_потр, м', skimmers: 'скіммери', drains: 'донні',
    steps: 'сходинки', equipment: 'Σ обладнання', materials: 'Σ матеріали', labor_pct: 'роботи_%',
    work: 'Σ роботи', total: 'разом', comment: 'коментар', json: 'json', app_version: 'версія_app', uid: 'uid'
  };
  // Під час оновлення не чіпаємо: номер, дату, статус (їх веде майстер у таблиці)
  var KEEP = ['number', 'date', 'status'];
  // Порожнє значення з телефона не затирає дописане в таблиці вручну (телефон, адреса, коментар)
  var KEEP_IF_EMPTY = ['phone', 'address', 'comment'];
  var CELL_MAX = 50000;       // межа символів у клітинці Google Таблиці
  var TEXT_MAX = 4000;        // Telegram: до 4096 символів в одному повідомленні, беремо із запасом
  var SHAPES = { rect: 'прямокутний', oval: 'овальний', custom: 'нестандартний' };

  function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }
  function trim(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }

  // Номер: AP-2026-001 (після 999 просто стає довшим: AP-2026-1000)
  function number(prefix, year, n) { return (prefix || 'AP') + '-' + year + '-' + pad(n, 3); }

  // Наступний номер у році: найбільший наявний + 1; нумерація щороку з 001
  function nextNumber(existing, prefix, year) {
    var head = (prefix || 'AP') + '-' + year + '-';
    var max = 0;
    (existing || []).forEach(function (v) {
      var s = trim(v);
      if (s.indexOf(head) !== 0) return;
      var n = parseInt(s.slice(head.length), 10);
      if (n > max) max = n;
    });
    return number(prefix, year, max + 1);
  }

  /*
   * Короткі значення для колонок CRM з готового кошторису ядра (Calc.buildEstimate).
   * o — { client, phoneText, comment, filmName, filterName, uvName, pumpName, appVersion }
   */
  function summary(est, inp, o) {
    var m = est.metrics, t = est.totals, c = o.client || {};
    var st = m.steps && m.steps.available ? m.steps.layers.filter(function (l) { return l.valid; }) : [];
    return {
      client: trim(c.name), phone: o.phoneText || '', address: trim(c.address),
      shape: SHAPES[inp.shape] || '', dims: r1(m.L) + '×' + r1(m.W) + '×' + r1(m.D),
      area: r1(m.S), volume: r1(m.Vtotal), bio: m.hasBio ? r1(m.bioArea) : 0,
      film: o.filmName || '', filter: o.filterName || '', uv: o.uvName || '', pump: o.pumpName || '',
      head: r1(m.Hreq), skimmers: o.skimmers, drains: o.drains,
      steps: st.map(function (l) { return Math.round(l.depth * 100) + ' см'; }).join('; '),
      equipment: t.equipment, materials: t.materials, labor_pct: t.labor_pct, work: t.work + (t.markup || 0),
      total: t.total, comment: trim(o.comment), app_version: o.appVersion || ''
    };
  }

  // Перевірка запиту saveEstimate на сервері: '' — усе гаразд, інакше — текст помилки для людини
  function validate(p) {
    if (!p || typeof p !== 'object') return 'Порожній кошторис';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(trim(p.uid))) return 'Кошторис без ідентифікатора';
    if (!p.summary || typeof p.summary !== 'object') return 'Кошторис без підсумків';
    if (!trim(p.summary.client)) return 'Вкажіть ім\'я клієнта — без нього кошторис у таблицю не записується';
    if (typeof p.text !== 'string' || !p.text) return 'Кошторис без тексту';
    if (JSON.stringify(p).length > CELL_MAX) return 'Кошторис завеликий для клітинки таблиці';
    return '';
  }

  // Запис → значення рядка за заголовками таблиці; невідома колонка → порожньо
  function toRow(headers, rec) {
    var byHead = {};
    Object.keys(COLS).forEach(function (k) { byHead[COLS[k]] = k; });
    return headers.map(function (h) {
      var k = byHead[trim(h)];
      var v = k ? rec[k] : '';
      return v === undefined || v === null ? '' : v;
    });
  }

  // Оновлення наявного рядка: KEEP — зі старого, KEEP_IF_EMPTY — зі старого, якщо нове порожнє
  function mergeRow(headers, oldRow, rec) {
    var fresh = toRow(headers, rec);
    return headers.map(function (h, i) {
      var k = null;
      Object.keys(COLS).forEach(function (key) { if (COLS[key] === trim(h)) k = key; });
      if (!k) return oldRow[i];                                   // чужі колонки майстра не чіпаємо
      if (KEEP.indexOf(k) !== -1) return oldRow[i];
      if (KEEP_IF_EMPTY.indexOf(k) !== -1 && trim(fresh[i]) === '') return oldRow[i];
      return fresh[i];
    });
  }

  // Довгий текст → шматки ≤ limit символів, різання по рядках (повідомлення Telegram)
  function splitText(text, limit) {
    var max = limit || TEXT_MAX, out = [], cur = '';
    String(text).split('\n').forEach(function (line) {
      while (line.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(line.slice(0, max)); line = line.slice(max); }
      var next = cur ? cur + '\n' + line : line;
      if (next.length > max) { out.push(cur); cur = line; } else cur = next;
    });
    if (cur) out.push(cur);
    return out;
  }

  // ---------- Архів у телефоні ----------
  /*
   * item = { uid, created, updated, rev, state, svc, snap, crm, number, syncedRev, err }
   *   rev — лічильник змін; syncedRev — яку версію вже записано в таблицю; snap — готовий запит (знімок цін, D6)
   * Стан: 'local' — лише в телефоні · 'noname' — прапорець є, імені немає · 'queued' — чекає першої відправки ·
   *       'modified' — у таблиці, але змінено після запису · 'synced' — у таблиці актуальна версія
   */
  function syncState(it) {
    if (!it.crm) return 'local';
    if (!it.snap || !trim(it.snap.summary && it.snap.summary.client)) return 'noname';
    if (!it.number) return 'queued';
    return (it.rev || 0) > (it.syncedRev || 0) ? 'modified' : 'synced';
  }
  function needsSync(it) { var s = syncState(it); return (s === 'queued' || s === 'modified') && !it.err; }

  /*
   * Ліміт архіву: зайві видаляються мовчки, найстаріші (за часом зміни) першими.
   * Не видаляємо: поточний кошторис і ті, що чекають відправки (інакше дані зникнуть, не дійшовши до таблиці).
   * Якщо всі «захищені», архів тимчасово більший за ліміт.
   */
  function prune(items, max, currentUid) {
    var list = items.slice();
    var removable = list.filter(function (it) {
      var s = syncState(it);
      return it.uid !== currentUid && s !== 'queued' && s !== 'modified' && s !== 'noname';
    }).sort(function (a, b) { return a.updated - b.updated; });
    var extra = list.length - max;
    var drop = {};
    for (var i = 0; i < removable.length && extra > 0; i++, extra--) drop[removable[i].uid] = true;
    return list.filter(function (it) { return !drop[it.uid]; });
  }

  // Наступний кошторис для відправки: найстаріша зміна першою
  function nextToSync(items) {
    var q = items.filter(needsSync).sort(function (a, b) { return a.updated - b.updated; });
    return q[0] || null;
  }

  // Випадковий ідентифікатор кошторису (достатньо для 2 користувачів): час + випадкові символи
  function uid(rand) {
    var r = rand || Math.random, s = Date.now().toString(36);
    for (var i = 0; i < 8; i++) s += Math.floor(r() * 36).toString(36);
    return s;
  }

  return {
    COLS: COLS, number: number, nextNumber: nextNumber, summary: summary, validate: validate,
    toRow: toRow, mergeRow: mergeRow, splitText: splitText,
    syncState: syncState, needsSync: needsSync, prune: prune, nextToSync: nextToSync, uid: uid
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Estimate;
