/*
 * tests/estimate.tests.js — ядро A4 (core/estimate.js): номер, рядок CRM, злиття, архів і черга.
 * Спільні для браузера (tests.html) і Node (run-node.js).
 */
var EstimateTests = (function () {
  'use strict';

  var HEAD = ['№', 'дата', 'статус', 'клієнт', 'телефон', 'адреса', 'форма', 'L×W×D', 'S, м²', 'V_заг, м³', 'біоплато', 'плівка',
    'фільтр', 'УФ', 'насос', 'H_потр, м', 'скіммери', 'донні', 'сходинки', 'Σ обладнання', 'Σ матеріали', 'роботи_%',
    'Σ роботи', 'разом', 'коментар', 'json', 'версія_app'];

  // Кошторис 6 × 4 × 1,5 на тестовому каталозі (як у calc.tests.js)
  function sampleEstimate(Calc, catalog) {
    var inp = { shape: 'rect', L: '6', W: '4', D: '1,5', fish: false, bio: false, bios: [], filmId: '', distance: '5', lift: '', steps: [] };
    var film = Calc.activeItems(catalog, 'film')[0];
    inp.filmId = film.id;
    var rec = Calc.recommend(inp, catalog, null);
    var sel = { filmId: film.id, filterId: rec.filterId, pumpId: rec.pump.id, uvId: rec.uvId, skimmerId: rec.skimmerId,
      skimmers: rec.skimmers, drainId: rec.drainId, drains: rec.drains, waterfallId: 'none', lightId: 'none', lights: 0, extras: {} };
    return { inp: inp, sel: sel, est: Calc.buildEstimate(inp, sel, catalog, {}) };
  }

  function item(o) {
    return Object.assign({ uid: 'u' + Math.random(), updated: 0, rev: 1, syncedRev: 0, crm: false, number: null, err: '',
      state: {}, snap: { summary: { client: 'Іван' } } }, o);
  }

  function run(Estimate, Calc, Format, catalog) {
    var cases = [
      ['Номер: AP-2026-001; наступний — найбільший у році + 1; інший рік і префікс не рахуються; 999 → 1000', function () {
        return Estimate.number('AP', 2026, 1) === 'AP-2026-001' &&
          Estimate.nextNumber(['AP-2026-003', 'AP-2026-010', 'AP-2025-044', 'XX-2026-099', '', 'AP-2026-007'], 'AP', 2026) === 'AP-2026-011' &&
          Estimate.nextNumber([], 'AP', '2027') === 'AP-2027-001' && Estimate.nextNumber(['AP-2026-999'], 'AP', 2026) === 'AP-2026-1000';
      }],
      ['Підсумки для CRM з кошторису 6 × 4 × 1,5: розміри, S, V, суми = підсумкам ядра, ім\'я обрізане', function () {
        var x = sampleEstimate(Calc, catalog);
        var s = Estimate.summary(x.est, x.inp, { client: { name: '  Петро ', address: '' }, phoneText: '+380 67 123 45 67' });
        var t = x.est.totals;
        return s.client === 'Петро' && s.dims === '6×4×1.5' && s.area === 24 && s.volume === 36 && s.shape === 'прямокутний' &&
          s.total === t.total && s.equipment === t.equipment && s.work === t.work + t.markup && s.phone === '+380 67 123 45 67';
      }],
      ['Рядок за заголовками: будь-який порядок колонок, чужа колонка порожня, uid — у своїй колонці', function () {
        var h = ['разом', 'моя колонка', 'клієнт', 'uid'];
        var r = Estimate.toRow(h, { total: 5000, client: 'Іван', uid: 'abc' });
        return r[0] === 5000 && r[1] === '' && r[2] === 'Іван' && r[3] === 'abc' && Estimate.toRow(HEAD, {}).length === 27;
      }],
      ['Оновлення рядка: №, дата, статус — старі; телефон / адреса з таблиці не затираються порожніми; чужа колонка — стара', function () {
        var h = ['№', 'дата', 'статус', 'телефон', 'адреса', 'разом', 'нотатка'];
        var old = ['AP-2026-005', '27.09.2026 10:00', 'погоджено', '+380 50 000 00 00', 'Київ', 1000, 'моє'];
        var r = Estimate.mergeRow(h, old, { number: 'X', date: 'Y', status: 'новий', phone: '', address: 'Львів', total: 2000 });
        return r[0] === 'AP-2026-005' && r[1] === old[1] && r[2] === 'погоджено' && r[3] === old[3] && r[4] === 'Львів' &&
          r[5] === 2000 && r[6] === 'моє';
      }],
      ['Перевірка запиту: без імені / uid / тексту — помилка; повний — порожньо', function () {
        var ok = { uid: 'abcdefgh12', summary: { client: 'Іван' }, text: 'Кошторис' };
        return Estimate.validate(ok) === '' && /ім'я/.test(Estimate.validate({ uid: 'abcdefgh12', summary: { client: ' ' }, text: 'x' })) &&
          Estimate.validate({ summary: { client: 'Іван' }, text: 'x' }) !== '' && Estimate.validate(Object.assign({}, ok, { text: '' })) !== '' &&
          Estimate.validate(null) !== '';
      }],
      ['Довгий текст → повідомлення ≤ 4000 символів, ріже по рядках, нічого не губить', function () {
        var lines = []; for (var i = 0; i < 300; i++) lines.push('• Позиція ' + i + ' — 1 шт × 1 000 грн = 1 000 грн');
        var text = lines.join('\n'), parts = Estimate.splitText(text);
        return parts.length > 1 && parts.every(function (p) { return p.length <= 4000; }) && parts.join('\n') === text &&
          Estimate.splitText('коротко').length === 1;
      }],
      ['Стан: без прапорця — local; без імені — noname; без номера — queued; змінено після запису — modified; інакше synced', function () {
        return Estimate.syncState(item({})) === 'local' && Estimate.syncState(item({ crm: true, snap: { summary: { client: '' } } })) === 'noname' &&
          Estimate.syncState(item({ crm: true, snap: null })) === 'noname' && Estimate.syncState(item({ crm: true })) === 'queued' &&
          Estimate.syncState(item({ crm: true, number: 'AP-2026-001', rev: 3, syncedRev: 2 })) === 'modified' &&
          Estimate.syncState(item({ crm: true, number: 'AP-2026-001', rev: 3, syncedRev: 3 })) === 'synced' &&
          Estimate.needsSync(item({ crm: true, err: 'помилка' })) === false;
      }],
      ['Ліміт архіву: видаляє найстаріші; поточний і ті, що чекають запису, не видаляє навіть понад ліміт', function () {
        var list = [];
        for (var i = 0; i < 12; i++) list.push(item({ uid: 'a' + i, updated: i, crm: i === 0 || i === 1, number: i === 1 ? 'AP-2026-001' : null, syncedRev: i === 1 ? 1 : 0 }));
        // a0 — чекає (queued), a1 — у таблиці (synced), a2 — поточний
        var kept = Estimate.prune(list, 10, 'a2').map(function (it) { return it.uid; });
        var allPending = []; for (var j = 0; j < 12; j++) allPending.push(item({ uid: 'p' + j, updated: j, crm: true }));
        return kept.length === 10 && kept.indexOf('a0') !== -1 && kept.indexOf('a2') !== -1 && kept.indexOf('a1') === -1 &&
          kept.indexOf('a3') === -1 && Estimate.prune(allPending, 10, 'p0').length === 12;
      }],
      ['Черга: найстаріша зміна першою; з помилкою і без прапорця — пропускає; uid різні', function () {
        var list = [item({ uid: 'x', updated: 5, crm: true }), item({ uid: 'y', updated: 2, crm: true, err: 'e' }),
          item({ uid: 'z', updated: 3, crm: true, number: 'AP-2026-002', rev: 2, syncedRev: 1 }), item({ uid: 'w', updated: 1 })];
        var ids = {}; for (var k = 0; k < 50; k++) ids[Estimate.uid()] = 1;
        return Estimate.nextToSync(list).uid === 'z' && Estimate.nextToSync([list[1], list[3]]) === null &&
          Object.keys(ids).length === 50 && /^[a-z0-9]{12,}$/.test(Estimate.uid());
      }],
      ['Текст кошторису: номер у заголовку лише коли переданий', function () {
        var x = sampleEstimate(Calc, catalog), d = new Date(2026, 8, 27);
        var a = Format.estimateText(x.est, x.inp, { date: d, number: 'AP-2026-014' }).split('\n')[0];
        var b = Format.estimateText(x.est, x.inp, { date: d }).split('\n')[0];
        return a === 'Кошторис Aquaprud № AP-2026-014 від 27.09.2026' && b === 'Кошторис Aquaprud від 27.09.2026';
      }]
    ];
    return cases.map(function (c) {
      try { return { name: c[0], ok: !!c[1]() }; } catch (e) { return { name: c[0], ok: false, error: e.message }; }
    });
  }

  return { run: run, HEAD: HEAD };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EstimateTests;
