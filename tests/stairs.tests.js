// Контрактні тести сходинок (T1–T11 з stairs_math.md §14). Запуск: node stairs.tests.js
'use strict';
const R = require('./stairs_ref.js');
let ok = 0, fail = 0;
// Порівняння з допуском: площі 0,005 м², радіуси 0,005 м
function near(name, got, exp, tol = 0.005) {
  if (Math.abs(got - exp) <= tol) ok++; else { fail++; console.log('✗', name, 'отримано', got, 'очікувано', exp); }
}
function has(name, list, code) {
  if (list.some(e => e.startsWith(code))) ok++; else { fail++; console.log('✗', name, 'немає', code, list); }
}
const r8 = R.buildRect(6, 3, 8), r6 = R.buildRect(6, 3, 6);
const s1 = R.shelf(r8, { points: [1, 2, 3], edge: 'straight', wc: 0.5 });
const s2 = R.shelf(r8, { points: [4, 7, 1], edge: 'straight', wc: 0.4 });
near('T1 площа шару 1', s1.parts[0].area, 3.0);
const vis = R.visibleAreas(r8, [{ h: 0.20, rings: [s1.parts[0].poly] }, { h: 0.45, rings: [s2.parts[0].poly] }], 0.01);
near('T2 видима площа шару 2', vis[1], 1.0);
const e2 = R.shelf(R.buildOval(3, 3, 8), { points: [4, 8, 1, 5, 2], edge: 'round', wc: 0.5 }).parts[0];
near('T3 R', e2.C.r, 1.625); near('T3 площа', e2.area, 1.366);
const e3 = R.shelf(R.buildOval(6, 3, 8), { points: [1, 5, 2, 6, 3], edge: 'round', wc: 0.5 }).parts[0];
near('T4 R', e3.C.r, 5.0); near('T4 площа', e3.area, 2.980);
const e4 = R.shelf(r6, { points: [1, 2, 3], edge: 'round', wc: 0.6, we: 0 }).parts[0];
near('T5 R', e4.C.r, 7.8); near('T5 площа', e4.area, 2.419);
near('T6 увігнута, прямі', R.shelf(r6, { points: [1, 2, 3], edge: 'straight', wc: 0.3, we: 0.9 }).parts[0].area, 3.6);
has('T7 L округла', R.shelf(r6, { points: [6, 5, 4, 1], edge: 'round', wc: 0.5 }).errors, 'E3');
const p1 = R.platform(r6, { points: [1, 4], edge: 'straight' }).parts[0];
near('T8 платформа #1 #4', p1.area, 6.0); if (p1.rule === 'A') ok++; else { fail++; console.log('✗ T8 правило', p1.rule); }
const p3 = R.platform(r6, { points: [1, 2, 4], edge: 'straight' }).parts[0];
near('T9 платформа #1 #2 #4', p3.area, 4.5); if (p3.rule === 'B') ok++; else { fail++; console.log('✗ T9 правило', p3.rule); }
const t10 = R.runs(r6, [2, 5]);
if (Array.isArray(t10) && t10.length === 2) ok++; else { fail++; console.log('✗ T10', t10); }
has('T11 зашироко', R.shelf(r6, { points: [1, 2, 3], edge: 'straight', wc: 3.5 }).errors, 'E9');
console.log(`Пройдено ${ok}, не пройдено ${fail}`);
process.exitCode = fail ? 1 : 0;
