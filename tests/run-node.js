// tests/run-node.js — запуск тих самих тестів у Node.js: node tests/run-node.js
var Calc = require('../core/calc.js');
var Format = require('../core/format.js');
var PondGeo = require('../core/pondgeo.js');
var SAMPLE = require('../data/catalog.sample.js');
var CalcTests = require('./calc.tests.js');
var PondGeoTests = require('./pondgeo.tests.js');

// Ядро розрахунку + геометрія 3D-схеми
var results = CalcTests.run(Calc, Format, SAMPLE).concat(PondGeoTests.run(PondGeo));
results.forEach(function (r) {
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.error ? ' — ' + r.error : ''));
});
var failed = results.filter(function (r) { return !r.ok; }).length;
console.log('\n' + (results.length - failed) + ' з ' + results.length + ' тестів пройдено');
process.exit(failed ? 1 : 0); // ненульовий код — сигнал про помилку (знадобиться для автоматичних перевірок)
