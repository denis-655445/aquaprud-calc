// tests/run-node.js — запуск тих самих тестів у Node.js: node tests/run-node.js
var Calc = require('../core/calc.js');
var Format = require('../core/format.js');
var PondGeo = require('../core/pondgeo.js');
var Stairs = require('../core/stairs.js');
var Slope = require('../core/slope.js');
var SAMPLE = require('../data/catalog.sample.js');
global.PondGeo = PondGeo;                         // sketch3d.js бере PondGeo з глобальної області, як у браузері
var Sketch3D = require('../miniapp/js/sketch3d.js');
Calc.useStairs(Stairs);                           // у браузері Stairs — глобальна змінна, тут підключаємо явно
Calc.useSlope(Slope, PondGeo);                    // укіс (v0.7.0): теж глобальні в браузері
var CalcTests = require('./calc.tests.js');
var PondGeoTests = require('./pondgeo.tests.js');
var StairsTests = require('./stairs.core.tests.js');
var Sketch3DTests = require('./sketch3d.tests.js');
var UI = require('../miniapp/js/ui.js');           // лише чиста функція fitPlan (розкладка 2D), DOM не потрібен
var Plan2DTests = require('./plan2d.tests.js');
var SlopeTests = require('./slope.tests.js');

// Налаштування для тестів укосу: запас плівки 0,5 м, овал — π/4
var SLOPE_SETTINGS = { film_margin_m: 0.5, shape_k_oval: 0.785, bio_depth_m: 0.3 };

// Ядро розрахунку + геометрія 3D-схеми + сходинки + масштаб 3D + розкладка 2D + укіс
var results = CalcTests.run(Calc, Format, SAMPLE)
  .concat(PondGeoTests.run(PondGeo))
  .concat(StairsTests.run(Stairs, Calc))
  .concat(Sketch3DTests.run(PondGeo, Sketch3D))
  .concat(Plan2DTests.run(UI))
  .concat(SlopeTests.run(Slope, Calc, PondGeo, SLOPE_SETTINGS));
results.forEach(function (r) {
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.error ? ' — ' + r.error : ''));
});
var failed = results.filter(function (r) { return !r.ok; }).length;
console.log('\n' + (results.length - failed) + ' з ' + results.length + ' тестів пройдено');
process.exit(failed ? 1 : 0); // ненульовий код — сигнал про помилку (знадобиться для автоматичних перевірок)
