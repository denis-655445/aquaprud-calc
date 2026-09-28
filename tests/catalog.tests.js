/*
 * tests/catalog.tests.js — каталог з рядків таблиці (core/catalog.js, D72): шаблон v1 → той самий формат,
 * що й тестовий каталог; ядро розрахунку працює на ньому без попереджень.
 */
var CatalogTests = (function () {
  'use strict';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function cases(Cat, Calc, sheet) {
    var cat = Cat.fromSheets(sheet.price, sheet.settings);
    return [
      ['Шаблон v1: 43 позиції, 31 налаштування, числа — числа, тестові ціни помічено, без попереджень', function () {
        var flt = cat.items[0];
        return cat.items.length === 43 && Object.keys(cat.settings).length === 31 && cat.warnings.length === 0 &&
          flt.id === 'FLT-T10' && flt.price === 8000 && flt.maxV_fish === 5 && flt.pump_kit === 'PMP-T3' &&
          flt.active === true && flt.base === undefined && !('примітка' in flt) && cat.is_test === true &&
          cat.settings.shelf_depths_cm === '20;45;60' && cat.settings.film_margin_m === 0.5 && /^sheet-[0-9a-f]{8}$/.test(cat.version);
      }],
      ['Клітинки як текст: «1 234,5» → 1234.5, «ні» / «Ні» / FALSE → неактивна, порожньо → активна', function () {
        var p = clone(sheet.price);
        p[1][4] = '1 234,5'; p[2][13] = 'Ні'; p[3][13] = false; p[4][13] = '';
        var c = Cat.fromSheets(p, sheet.settings);
        return c.items[0].price === 1234.5 && c.items[1].active === false && c.items[2].active === false &&
          c.items[3].active === true && Cat.toNumber('0,785') === 0.785 && isNaN(Cat.toNumber('12 грн'));
      }],
      ['Помилки в прайсі — попередження з номером рядка: не число, повтор id, невідома категорія, чужий насос', function () {
        var p = clone(sheet.price);
        p[1][4] = '8000 грн'; p[2][0] = 'FLT-T10'; p[3][1] = 'filtr'; p[4][9] = 'PMP-NONE';
        var w = Cat.fromSheets(p, sheet.settings).warnings.join('\n');
        return /Рядок 2: «8000 грн»/.test(w) && /Рядок 3: id FLT-T10 повторюється/.test(w) &&
          /Рядок 4: невідома категорія «filtr»/.test(w) && /PMP-NONE не знайдено/.test(w);
      }],
      ['Версія: ті самі дані → та сама; змінили ціну → інша. Без «ТЕСТ» у назвах → is_test = false', function () {
        var p = clone(sheet.price);
        p[1][4] = 8001;
        var noTest = clone(sheet.price).map(function (r, i) { if (i) r[2] = String(r[2]).replace(' (ТЕСТ)', ''); return r; });
        return Cat.fromSheets(sheet.price, sheet.settings).version === cat.version &&
          Cat.fromSheets(p, sheet.settings).version !== cat.version &&
          Cat.fromSheets(noTest, sheet.settings).is_test === false;
      }],
      ['Кошторис на каталозі з таблиці: ставок 6 × 4 × 1,5 — фільтр, УФ, насос підібрано, автопозиції є', function () {
        var inp = { shape: 'rect', L: 6, W: 4, D: 1.5, fish: false, bio: false, filmId: 'FLM-PVC', distance: 5 };
        var rec = Calc.recommend(inp, cat, null);
        var est = Calc.buildEstimate(inp, { filterId: rec.filterId, pumpId: rec.pump.id, uvId: rec.uvId,
          skimmerId: 'SKM-T1', skimmers: rec.skimmers, drainId: 'DRN-T1', drains: rec.drains, filmId: 'FLM-PVC' }, cat, {});
        var ids = est.lines.map(function (l) { return l.id; });
        return rec.filterId !== 'none' && rec.uvId !== 'none' && rec.pump.id !== 'none' && ids.indexOf('GEO-T') !== -1 && ids.indexOf('PIP-T50') !== -1 &&
          est.totals.total > 0 && est.warnings.filter(function (w) { return /Невідома база/.test(w); }).length === 0;
      }]
    ];
  }

  function run(Cat, Calc, sheet) {
    return cases(Cat, Calc, sheet).map(function (c) {
      try { return { name: c[0], ok: !!c[1]() }; } catch (e) { return { name: c[0], ok: false, error: e.message }; }
    });
  }

  return { run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CatalogTests;
