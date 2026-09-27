/*
 * data/catalog.sample.js — ТЕСТОВИЙ каталог для етапу A2.
 * Усі ціни, паспортні дані й коефіцієнти з позначкою «ТЕСТ» вигадані лише для перевірки інтерфейсу.
 * Реальні значення з'являться на етапі A3 — каталог прийде з Google Таблиці.
 * Формат — JS (а не JSON), щоб застосунок відкривався навіть подвійним кліком по файлу.
 */
var SAMPLE_CATALOG = {
  version: 'test-2026-09-26b',
  is_test: true, // вмикає жовте попередження в застосунку і в тексті кошторису

  settings: {
    shape_k_oval: 0.785,          // математика: π/4
    shape_k_custom: 0.85,         // ТЕСТ
    depth_profile_k: 0.7,         // ТЕСТ: частка «прямокутного» об'єму з урахуванням укосів
    film_margin_m: 0.5,           // майстер: запас плівки на край
    bio_depth_m: 0.3,             // ТЕСТ
    turnover_no_fish: 0.3,        // ТЕСТ: обертів об'єму за годину
    turnover_fish: 0.5,           // ТЕСТ
    area_per_skimmer_m2: 10,      // майстер, попередньо
    area_per_drain_m2: 10,        // майстер, попередньо
    drain_min_area_m2: 15,        // ТЕСТ
    pipe_reserve_m: 2,            // ТЕСТ
    lift_height_default_m: 1,     // ТЕСТ
    head_loss_per_m: 0.05,        // ТЕСТ: м напору на 1 м труби
    head_loss_per_elbow: 0.2,     // ТЕСТ
    elbows_on_pressure_line: 4,   // ТЕСТ
    filter_head_loss_m: 1,        // ТЕСТ: опір фільтра + УФ
    excavation_k: 1.2,            // ТЕСТ
    labor_pct: 100,               // майстер: 100% за замовчуванням
    labor_base: 'materials+equipment', // майстер (§11.6): роботи = % від матеріалів і обладнання
    markup_pct: 0,
    currency: 'грн',
    estimate_prefix: 'AP',
    // Сходинки (stairs_math §15)
    shelf_depths_cm: '20;45;60',  // зони ставка (D34)
    shelf_width_default_m: 0.4,   // оптимум 0,3–0,4 м
    shelf_width_min_m: 0.3,       // W1
    steps_max: 3,                 // MVP: до 4 рівнів з дном (D38)
    platform_arc_k: 0.1,          // наше припущення (майстер)
    deep_share_min_fish: 0.5,     // W2
    deep_share_min_nofish: 0.33,
    depth_min_fish_m: 1.2,        // W4
    depth_min_nofish_m: 0.7,
    arc_tolerance_m: 0.01,        // E4
    raster_cell_m: 0.01           // точність видимих площ
  },

  // Поля позиції: id, category, name, unit, price, base, k, maxV_nofish, maxV_fish,
  // pump_kit, q_max, h_max, group, active (див. project_status.md §5.1)
  items: [
    // Фільтри: паспортний макс. об'єм ставка і насос комплекту
    { id: 'FLT-T10', category: 'filter', name: 'Напірний фільтр Т-10 (ТЕСТ)', unit: 'шт', price: 8000, maxV_nofish: 10, maxV_fish: 5, pump_kit: 'PMP-T3', group: 'Обладнання' },
    { id: 'FLT-T25', category: 'filter', name: 'Напірний фільтр Т-25 (ТЕСТ)', unit: 'шт', price: 14000, maxV_nofish: 25, maxV_fish: 12, pump_kit: 'PMP-T5', group: 'Обладнання' },
    { id: 'FLT-T50', category: 'filter', name: 'Напірний фільтр Т-50 (ТЕСТ)', unit: 'шт', price: 24000, maxV_nofish: 50, maxV_fish: 25, pump_kit: 'PMP-T8', group: 'Обладнання' },
    { id: 'FLT-T80', category: 'filter', name: 'Напірний фільтр Т-80 (ТЕСТ)', unit: 'шт', price: 36000, maxV_nofish: 80, maxV_fish: 40, pump_kit: 'PMP-T12', group: 'Обладнання' },
    { id: 'FLT-T150', category: 'filter', name: 'Напірний фільтр Т-150 (ТЕСТ)', unit: 'шт', price: 52000, maxV_nofish: 150, maxV_fish: 75, pump_kit: 'PMP-T20', group: 'Обладнання' },
    // Спарені фільтри: два однакові паралельно — удвічі більший об'єм; насос комплекту — теж пара
    { id: 'FLT-2T150', category: 'filter', name: '2 × фільтр Т-150, паралельно (ТЕСТ)', unit: 'шт', price: 100000, maxV_nofish: 300, maxV_fish: 150, pump_kit: 'PMP-2T20', group: 'Обладнання' },
    // Великі ставки: барабанні фільтри без насоса в комплекті
    { id: 'FLT-DF600', category: 'filter', name: 'Барабанний фільтр 600 м³ (ТЕСТ)', unit: 'шт', price: 180000, maxV_nofish: 600, maxV_fish: 300, group: 'Обладнання' },
    { id: 'FLT-DF2400', category: 'filter', name: 'Барабанний фільтр 2400 м³ (ТЕСТ)', unit: 'шт', price: 320000, maxV_nofish: 2400, maxV_fish: 1200, group: 'Обладнання' },

    // УФ-стерилізатори
    { id: 'UV-T9', category: 'uv', name: 'УФ-стерилізатор 9 Вт (ТЕСТ)', unit: 'шт', price: 2500, maxV_nofish: 10, maxV_fish: 5, group: 'Обладнання' },
    { id: 'UV-T24', category: 'uv', name: 'УФ-стерилізатор 24 Вт (ТЕСТ)', unit: 'шт', price: 5000, maxV_nofish: 30, maxV_fish: 15, group: 'Обладнання' },
    { id: 'UV-T55', category: 'uv', name: 'УФ-стерилізатор 55 Вт (ТЕСТ)', unit: 'шт', price: 9000, maxV_nofish: 70, maxV_fish: 35, group: 'Обладнання' },
    { id: 'UV-T75', category: 'uv', name: 'УФ-стерилізатор 75 Вт (ТЕСТ)', unit: 'шт', price: 13000, maxV_nofish: 120, maxV_fish: 60, group: 'Обладнання' },
    { id: 'UV-2T75', category: 'uv', name: '2 × УФ 75 Вт, паралельно (ТЕСТ)', unit: 'шт', price: 25000, maxV_nofish: 240, maxV_fish: 120, group: 'Обладнання' },
    { id: 'UV-S4', category: 'uv', name: 'УФ-станція 4 × 130 Вт (ТЕСТ)', unit: 'шт', price: 90000, maxV_nofish: 1000, maxV_fish: 500, group: 'Обладнання' },
    { id: 'UV-S8', category: 'uv', name: 'УФ-станція 8 × 130 Вт (ТЕСТ)', unit: 'шт', price: 170000, maxV_nofish: 2400, maxV_fish: 1200, group: 'Обладнання' },

    // Насоси: Q_max — потік без напору, H_max — максимальний напір
    { id: 'PMP-T3', category: 'pump', name: 'Насос 3000 л/год (ТЕСТ)', unit: 'шт', price: 3500, q_max: 3000, h_max: 2.5, group: 'Обладнання' },
    { id: 'PMP-T5', category: 'pump', name: 'Насос 5000 л/год (ТЕСТ)', unit: 'шт', price: 5000, q_max: 5000, h_max: 3, group: 'Обладнання' },
    { id: 'PMP-T8', category: 'pump', name: 'Насос 8000 л/год (ТЕСТ)', unit: 'шт', price: 8000, q_max: 8000, h_max: 4, group: 'Обладнання' },
    { id: 'PMP-T12', category: 'pump', name: 'Насос 12000 л/год (ТЕСТ)', unit: 'шт', price: 11000, q_max: 12000, h_max: 5, group: 'Обладнання' },
    { id: 'PMP-T20', category: 'pump', name: 'Насос 20000 л/год (ТЕСТ)', unit: 'шт', price: 17000, q_max: 20000, h_max: 6, group: 'Обладнання' },
    { id: 'PMP-T30', category: 'pump', name: 'Насос 30000 л/год (ТЕСТ)', unit: 'шт', price: 24000, q_max: 30000, h_max: 7, group: 'Обладнання' },
    // Кілька однакових насосів паралельно: потоки додаються, максимальний напір той самий
    { id: 'PMP-2T20', category: 'pump', name: '2 × насос 20000 л/год, паралельно (ТЕСТ)', unit: 'шт', price: 34000, q_max: 40000, h_max: 6, group: 'Обладнання' },
    { id: 'PMP-T50', category: 'pump', name: 'Насос 50000 л/год (ТЕСТ)', unit: 'шт', price: 38000, q_max: 50000, h_max: 8, group: 'Обладнання' },
    { id: 'PMP-T80', category: 'pump', name: 'Насос 80000 л/год (ТЕСТ)', unit: 'шт', price: 60000, q_max: 80000, h_max: 10, group: 'Обладнання' },
    { id: 'PMP-S3', category: 'pump', name: 'Насосна станція 3 × 80 м³/год (ТЕСТ)', unit: 'шт', price: 175000, q_max: 240000, h_max: 10, group: 'Обладнання' },
    { id: 'PMP-S4', category: 'pump', name: 'Насосна станція 4 × 150 м³/год (ТЕСТ)', unit: 'шт', price: 400000, q_max: 600000, h_max: 20, group: 'Обладнання' },
    { id: 'PMP-S6', category: 'pump', name: 'Насосна станція 6 × 150 м³/год (ТЕСТ)', unit: 'шт', price: 580000, q_max: 900000, h_max: 20, group: 'Обладнання' },

    // Скіммери й донні зливи (кількість рахується, модель — найдешевша)
    { id: 'SKM-T1', category: 'skimmer', name: 'Скіммер (ТЕСТ)', unit: 'шт', price: 3000, group: 'Обладнання' },
    { id: 'DRN-T1', category: 'drain', name: 'Донний злив (ТЕСТ)', unit: 'шт', price: 2500, group: 'Обладнання' },

    // Плівка — вибір у блоці «Ставок», кількість = площа плівки ставка + біоплато
    { id: 'FLM-PVC', category: 'film', name: 'Плівка ПВХ 1 мм (ТЕСТ)', unit: 'м²', price: 180, group: 'Матеріали' },
    { id: 'FLM-EPDM', category: 'film', name: 'Плівка EPDM 1 мм (ТЕСТ)', unit: 'м²', price: 420, group: 'Матеріали' },

    // Автопозиції: кількість = база × коеф
    { id: 'GEO-T', category: 'geotextile', name: 'Геотекстиль 300 г/м² (ТЕСТ)', unit: 'м²', price: 45, base: 'film_area_total', k: 1, group: 'Матеріали' },
    { id: 'PIP-T50', category: 'pipe', name: 'Труба ПВХ Ø50 (ТЕСТ)', unit: 'м', price: 120, base: 'pipe_len', k: 1, group: 'Матеріали' },
    { id: 'FIT-E50', category: 'fitting', name: 'Коліно 90° Ø50 (ТЕСТ)', unit: 'шт', price: 60, base: 'per_line', k: 3, group: 'Матеріали' },
    { id: 'FIT-T50', category: 'fitting', name: 'Трійник Ø50 (ТЕСТ)', unit: 'шт', price: 80, base: 'per_line', k: 1, group: 'Матеріали' },
    { id: 'FIT-V50', category: 'fitting', name: 'Кран кульовий Ø50 (ТЕСТ)', unit: 'шт', price: 450, base: 'per_line', k: 1, group: 'Матеріали' },
    { id: 'WRK-SOIL', category: 'work', name: 'Вивезення ґрунту (ТЕСТ)', unit: 'м³', price: 350, base: 'excavation', k: 1, group: 'Роботи' },

    // Декор
    { id: 'WTF-T1', category: 'waterfall', name: 'Водоспад, малий каскад (ТЕСТ)', unit: 'шт', price: 6000, group: 'Обладнання' },
    { id: 'WTF-T2', category: 'waterfall', name: 'Водоспад, великий каскад (ТЕСТ)', unit: 'шт', price: 12000, group: 'Обладнання' },
    { id: 'LGT-T3', category: 'light', name: 'Світильник LED 3 Вт (ТЕСТ)', unit: 'шт', price: 900, group: 'Обладнання' },
    { id: 'LGT-T6', category: 'light', name: 'Світильник LED 6 Вт (ТЕСТ)', unit: 'шт', price: 1400, group: 'Обладнання' },
    { id: 'EXT-FNT', category: 'extra', name: 'Фонтанна насадка (ТЕСТ)', unit: 'шт', price: 800, group: 'Обладнання' },
    { id: 'EXT-AIR', category: 'extra', name: 'Аератор (ТЕСТ)', unit: 'шт', price: 4500, group: 'Обладнання' }
  ]
};

// Для тестів у Node.js (перевірка, що каталог покриває ставки до 30 × 10 × 5 м); у браузері рядок пропускається
if (typeof module !== 'undefined' && module.exports) module.exports = SAMPLE_CATALOG;
