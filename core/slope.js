/*
 * core/slope.js — укіс стінок ставка (v0.7.0, D61, D63). Чисті функції без DOM і без API платформ.
 *
 * Модель (docs/stairs_math.md §10.1):
 *   - Укіс задається закладенням 1 : m (m — горизонталь на 1 м глибини; 0 — вертикальна стінка).
 *   - Похилою є лише зовнішня стінка котлована; підйоми між сходинками — вертикальні (90°).
 *   - Глибина в точці плану q: z(q) = min( h(q), min_k (b_k + d(q, край_k) / m) ),
 *     де h(q) — глибина рівня, що зверху в точці q (дно або сходинка, D33);
 *     край_k — ділянки краю ставка, біля яких зсередини рівень не мілкіший за h(q)
 *     (тому за полицею глибока зона не «підрізається» укосом: підйом лишається вертикальним);
 *     b_k — глибина, від якої починається укіс (0; на шві з біоплато «Разом» — глибина біоплато, лише для схеми).
 *   - Для опуклого ставка без сходинок це точно котлован з похилими стінками: дно = контур, зсунутий усередину на m·D.
 *   - Об'єм: V = V₀ − C, де V₀ = S_глиб·D + Σ S_vis·h (точно, як раніше), а C — «зрізаний» укосом об'єм (сітка).
 */
var Slope = (function () {
  'use strict';

  var GRID_N = 200;        // клітинок сітки вздовж довшої сторони для поправки об'єму
  var SEG_N = 600;         // частин краю: так знаходимо, де біля стінки змінюється рівень

  // Кут стінки до горизонту, °: 1 : m → atan(1/m); m = 0 — 90°
  function angleDeg(m) { return m > 0 ? Math.atan(1 / m) * 180 / Math.PI : 90; }
  // Навпаки (v0.7.1: у службовій панелі вводять кут): α° → m = 1 / tg α; 90° — вертикальна стінка (m = 0)
  function mFromDeg(deg) { return deg > 0 && deg < 90 ? 1 / Math.tan(deg * Math.PI / 180) : 0; }

  // «Глибина для плівки»: розгортка похилої стінки. Плівку кроять як для вертикальних стінок глибиною D_пл:
  // дно коротше на 2·m·D, а дві похилі стінки довші — по D·√(1+m²). m = 0 → D_пл = D (як до v0.7.0)
  function filmDepth(D, m) { return m > 0 ? D * (Math.sqrt(1 + m * m) - m) : D; }

  function signedArea(poly) {
    var s = 0;
    poly.forEach(function (a, i) { var b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; });
    return s / 2;
  }

  // Точка всередині многокутника (промінь праворуч)
  function inside(p, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  // Відстань від точки до відрізка
  function segDist(q, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
  }
  function polylineDist(q, pts) {
    var d = Infinity;
    for (var i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(q, pts[i], pts[i + 1]));
    return d;
  }

  function bbox(poly) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    poly.forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); });
    return b;
  }

  /*
   * Поле глибин ставка.
   * o = { outline: [[x, y], …] — край ставка в плані, м; D — глибина; m — укіс;
   *       levels: [{ poly, holes, depth }] — сходинки в координатах плану (як у 3D, D49);
   *       seam: { lines: [[[x, y], …], …], depth } | null — шви з біоплато «Разом» (укіс від глибини біоплато; лише для схеми).
 *             Старий формат { pts, depth } (одна ламана) теж приймається }
   * Повертає { levelAt(q), depthAt(q), segs, … } — q всередині краю.
   */
  function field(o) {
    var outline = o.outline, D = o.D, m = Math.max(0, o.m || 0);
    var levels = (o.levels || []).filter(function (lv) { return lv.depth > 0 && lv.depth < D && lv.poly && lv.poly.length > 2; })
      .map(function (lv) { return { poly: lv.poly, holes: lv.holes || [], depth: lv.depth, box: bbox(lv.poly) }; });
    var box = bbox(outline), size = Math.max(box[2] - box[0], box[3] - box[1]);

    // Рівень у точці: наймілкіша сходинка, що її накриває (D33), інакше — дно
    function levelAt(q) {
      var d = D;
      for (var i = 0; i < levels.length; i++) {
        var lv = levels[i];
        if (lv.depth >= d || q[0] < lv.box[0] || q[0] > lv.box[2] || q[1] < lv.box[1] || q[1] > lv.box[3]) continue;
        if (inside(q, lv.poly) && !lv.holes.some(function (h) { return inside(q, h); })) d = lv.depth;
      }
      return d;
    }

    // 1. Край ділимо на частини і для кожної дізнаємось рівень, що прилягає до стінки зсередини
    var ccw = signedArea(outline) > 0, per = 0;
    outline.forEach(function (a, i) { var b = outline[(i + 1) % outline.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); });
    var ds = per / SEG_N, eps = Math.max(0.02, 0.004 * size), tol = 1e-6 * Math.max(1, size);
    var segs = [], seamLines = !o.seam ? [] : o.seam.lines || (o.seam.pts ? [o.seam.pts] : []);
    outline.forEach(function (a, i) {
      var b = outline[(i + 1) % outline.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < tol) return;
      // Нормаль усередину ставка
      var nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      if (!ccw) { nx = -nx; ny = -ny; }
      var n = Math.max(1, Math.ceil(len / ds)), cur = null;
      for (var k = 0; k < n; k++) {
        var p0 = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
        var p1 = [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n];
        var mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        var h = levelAt([mid[0] + nx * eps, mid[1] + ny * eps]);
        var base = seamLines.some(function (l) { return polylineDist(mid, l) < Math.max(eps / 4, 1e-3); }) ? Math.min(o.seam.depth, h) : 0;
        if (cur && cur.h === h && cur.base === base) cur.b = p1;           // та сама ділянка — подовжуємо
        else { cur = { a: p0, b: p1, h: h, base: base, n: [nx, ny] }; segs.push(cur); }
      }
    });

    // 2. «Стеля» укосу для точки з рівнем hq: найближча стінка, біля якої рівень не мілкіший за hq
    function cap(q, hq) {
      var c = Infinity;
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (s.h < hq - 1e-9) continue;
        c = Math.min(c, s.base + segDist(q, s.a, s.b) / m);
      }
      return c;
    }
    function depthAt(q) {
      var hq = levelAt(q);
      return m > 0 ? Math.min(hq, cap(q, hq)) : hq;
    }
    return { outline: outline, D: D, m: m, levels: levels, segs: segs, box: box, size: size,
             levelAt: levelAt, depthAt: depthAt, cap: cap };
  }

  /*
   * Поправка об'єму укосом (сітка GRID_N клітинок уздовж довшої сторони, клітинки вирівняні по габариту):
   * C = Σ (h(q) − z(q)) · a_клітинки — скільки об'єму «зрізали» похилі стінки.
   * Повертає { C, area — площа сітки всередині краю, maxDepth — найбільша глибина з укосом }.
   */
  function correction(f, n) {
    n = n || GRID_N;
    var w = f.box[2] - f.box[0], h = f.box[3] - f.box[1];
    var nx = Math.max(1, Math.round(n * w / Math.max(w, h))), ny = Math.max(1, Math.round(n * h / Math.max(w, h)));
    var cx = w / nx, cy = h / ny, a = cx * cy, C = 0, area = 0, maxDepth = 0;
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var q = [f.box[0] + (i + 0.5) * cx, f.box[1] + (j + 0.5) * cy];
        if (!inside(q, f.outline)) continue;
        area += a;
        var hq = f.levelAt(q), z = f.m > 0 ? Math.min(hq, f.cap(q, hq)) : hq;
        C += (hq - z) * a;
        if (z > maxDepth) maxDepth = z;
      }
    }
    return { C: C, area: area, maxDepth: maxDepth };
  }

  /*
   * Профіль уздовж лінії p0 → p1 (розріз): { t — відстань від p0, м; z — глибина, м (0 — земля) }.
   * extra = [{ poly, holes, depth }] — інші котловани на лінії (біоплато), стінки вертикальні.
   */
  function profile(f, p0, p1, extra, n) {
    n = n || 400;
    var len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), out = [];
    for (var k = 0; k <= n; k++) {
      var q = [p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n], z = 0;
      if (inside(q, f.outline)) z = f.depthAt(q);
      else (extra || []).forEach(function (e) {
        if (inside(q, e.poly) && !(e.holes || []).some(function (h) { return inside(q, h); })) z = Math.max(z, e.depth);
      });
      out.push({ t: len * k / n, z: z });
    }
    return out;
  }

  /*
   * Низ укосу в плані (лінія, де похила стінка сходиться з рівнем): для кожної ділянки краю —
   * лінія, зсунута всередину на m·(h − base). Лишаємо лише точки, де рівень справді на глибині h
   * (біля кутів лінії сусідніх стінок обрізаються самі). Повертає ламані [[x, y], …].
   */
  function toeLines(f) {
    if (!(f.m > 0)) return [];
    var lines = [], step = f.size / 300;
    f.segs.forEach(function (s) {
      var off = f.m * (s.h - s.base), len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      var n = Math.max(1, Math.ceil(len / step)), cur = null;
      for (var k = 0; k <= n; k++) {
        var q = [s.a[0] + (s.b[0] - s.a[0]) * k / n + s.n[0] * off, s.a[1] + (s.b[1] - s.a[1]) * k / n + s.n[1] * off];
        var ok = inside(q, f.outline) && f.levelAt(q) === s.h && f.depthAt(q) >= s.h - 1e-6 - 0.002 * s.h;
        if (ok) { if (!cur) { cur = []; lines.push(cur); } cur.push(q); }
        else cur = null;
      }
    });
    // Сусідні шматки, що стикуються кінцями, зливаємо в одну ламану (пунктир не «перезапускається»)
    var out = [];
    lines.filter(function (l) { return l.length > 1; }).forEach(function (l) {
      var last = out[out.length - 1];
      if (last && Math.hypot(l[0][0] - last[last.length - 1][0], l[0][1] - last[last.length - 1][1]) < 2 * step) {
        out[out.length - 1] = last.concat(l.slice(1));
      } else out.push(l);
    });
    return out;
  }

  return { angleDeg: angleDeg, mFromDeg: mFromDeg, filmDepth: filmDepth, field: field, correction: correction, profile: profile,
           toeLines: toeLines, inside: inside, GRID_N: GRID_N };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Slope;
