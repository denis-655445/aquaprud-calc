/*
 * core/stairs.js — сходинки ставка (Про-режим, етап A2.1): прогони, полиця, платформа,
 * «Прямокутник від кута», видимі площі шарів (інтегрування рядками), перевірки E1–E11 / W1–W4.
 * Математика — docs/stairs_math.md (v1.2); еталон, на якому перевірено числа, — tests/stairs_ref.js.
 * Чисті функції без DOM і без API платформ (D11): однаково працює в браузері, Apps Script і Node.js.
 *
 * Одиниці — метри. Координати «схеми точок» (§0.2): x — вправо вздовж довшої сторони, y — вниз.
 * Якщо майстер ввів W > L, рахуємо в повернутій схемі (swapped), а toPlan() повертає точки назад у план.
 */
var Stairs = (function () {
  'use strict';

  var EPS = 1e-9;
  var TAU = 2 * Math.PI;

  // Значення «Налаштувань» за замовчуванням (stairs_math §15), якщо в прайсі їх немає
  var DEFAULTS = {
    shelf_depths_cm: '20;45;60', shelf_width_default_m: 0.4, shelf_width_min_m: 0.3, steps_max: 3,
    platform_arc_k: 0.1, deep_share_min_fish: 0.5, deep_share_min_nofish: 0.33,
    depth_min_fish_m: 1.2, depth_min_nofish_m: 0.7, arc_tolerance_m: 0.01, raster_cell_m: 0.01
  };

  // Тексти помилок і попереджень (§12); E10–E11 — «Прямокутник від кута» (v1.2)
  var TEXT = {
    E1: 'Оберіть точки сходинки',
    E2: 'Полиці потрібно щонайменше 2 точки',
    E3: 'Округла полиця не огинає кут. Розбийте на дві полиці або оберіть «Прямі»',
    E4: 'Полиця зашироку для цих точок',
    E5: 'Округле кільце огинає кути. Оберіть «Прямі»',
    E6: 'Для кільця оберіть «Полиця»',
    E7: 'Глибина сходинки має бути між 0 і глибиною ставка',
    E8: 'Сходинку повністю закриває мілкіша',
    E9: 'Полиця зашироку для цих точок',
    E10: '«Прямокутник від кута» — лише для прямокутного ставка',
    E11: 'Прямокутник виходить за стінку: довжина й ширина мають бути більші за 0 і не більші за сторони ставка',
    W1: 'Полиця вужча за 30 см — рослини не вмістяться',
    W2: 'Глибока зона замала',
    W3: 'Полиці допомагають чаплям полювати на рибу',
    W4: 'Ставок замілкий для зимівлі риби / стабільної екосистеми'
  };

  // ---------- 1. Векторні дрібниці ----------
  function add(p, v, k) { if (k === undefined) k = 1; return [p[0] + v[0] * k, p[1] + v[1] * k]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function len(v) { return Math.hypot(v[0], v[1]); }
  function unit(v) { var l = len(v); return [v[0] / l, v[1] / l]; }
  function mod(x, m) { return ((x % m) + m) % m; }

  // Число з рядка або числа; кома → крапка (як Calc.num)
  function num(v, fb) {
    if (typeof v === 'number') return isFinite(v) ? v : fb;
    var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : fb;
  }
  function setting(s, key) { return num(s && s[key] !== undefined && s[key] !== '' ? s[key] : DEFAULTS[key], num(DEFAULTS[key], 0)); }

  // Площа многокутника зі знаком (формула «шнурування», §7.7)
  function signedArea(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }
  function area(poly) { return Math.abs(signedArea(poly)); }

  // Точка всередині многокутника (промінь праворуч, правило парності)
  function inside(p, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) &&
          p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  // Відстань від точки до межі многокутника
  function distToPoly(p, poly) {
    var m = Infinity;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], d = sub(poly[(i + 1) % poly.length], a);
      var t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d)));
      m = Math.min(m, len(sub(p, add(a, d, t))));
    }
    return m;
  }

  // Точка в ставку або на його стінці (з допуском tol)
  function inPond(p, poly, tol) { return inside(p, poly) || distToPoly(p, poly) <= tol; }

  // Відтинання опуклого многокутника півплощиною u·p ≤ t (Сазерленд — Годжман, §8.2)
  function clipHalf(poly, u, t) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var P = poly[i], Q = poly[(i + 1) % poly.length];
      var fp = dot(P, u) - t, fq = dot(Q, u) - t;
      if (fp <= 0) out.push(P);                                   // вершина всередині — лишаємо
      if (fp * fq < 0) out.push(add(P, sub(Q, P), fp / (fp - fq))); // ребро перетинає межу
    }
    return out;
  }

  // Коло через три точки (§7.4). null — точки на одній прямій (край буде прямим)
  function circle3(a, b, c) {
    var d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-9) return null;
    var A = dot(a, a), B = dot(b, b), C = dot(c, c);
    var cx = (A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d;
    var cy = (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d;
    return { c: [cx, cy], r: len(sub(a, [cx, cy])) };
  }

  // Точки дуги від from до to, що проходить через via (обираємо ту з двох дуг, на якій лежить via)
  function arcPoints(C, from, to, via, n) {
    n = n || 120;
    var ang = function (p) { return Math.atan2(p[1] - C.c[1], p[0] - C.c[0]); };
    var t0 = ang(from), dTo = mod(ang(to) - t0, TAU), dVia = mod(ang(via) - t0, TAU);
    var dt = dVia < dTo ? dTo : -(TAU - dTo);
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = t0 + dt * i / n;
      out.push([C.c[0] + C.r * Math.cos(t), C.c[1] + C.r * Math.sin(t)]);
    }
    return out;
  }

  // ---------- 2. Моделі ставка (§4) ----------
  // scheme: 8 — полиця (8 точок), 6 — платформа і «від кута» (6 точок у прямокутника, 4 — у квадрата)

  function buildRect(L, W, scheme) {
    var sq = Math.abs(L - W) <= 0.01 * Math.max(L, W);        // квадрат з допуском 1 %
    var P = 2 * (L + W);
    // g — відстань по периметру від #1 за годинниковою стрілкою (§4.1, §4.2)
    var G = sq
      ? (scheme === 8 ? { 1: 0, 5: L / 2, 2: L, 6: L + W / 2, 4: L + W, 7: 1.5 * L + W, 3: 2 * L + W, 8: 2 * L + 1.5 * W }
                      : { 1: 0, 2: L, 4: L + W, 3: 2 * L + W })
      : (scheme === 8 ? { 1: 0, 2: L / 2, 3: L, 8: L + W / 2, 6: L + W, 5: 1.5 * L + W, 4: 2 * L + W, 7: 2 * L + 1.5 * W }
                      : { 1: 0, 2: L / 2, 3: L, 6: L + W, 5: 1.5 * L + W, 4: 2 * L + W });
    function at(g) {
      g = mod(g, P);
      if (g <= L) return [g, 0];
      if (g <= L + W) return [L, g - L];
      if (g <= 2 * L + W) return [L - (g - L - W), W];
      return [0, W - (g - 2 * L - W)];
    }
    function wallN(g) {                                          // нормаль стінки всередину
      g = mod(g, P);
      if (g < L) return [0, 1];
      if (g < L + W) return [-1, 0];
      if (g < 2 * L + W) return [0, -1];
      return [1, 0];
    }
    var corners = [0, L, L + W, 2 * L + W];
    function isCorner(g) { return corners.some(function (c) { return Math.abs(mod(g, P) - c) < EPS; }); }
    var pts = {};
    Object.keys(G).forEach(function (id) {
      var g = G[id], corner = isCorner(g);
      var n = corner ? add(wallN(g - 1e-6), wallN(g + 1e-6)) : wallN(g); // у куті n = n₁ + n₂ (не нормована)
      pts[id] = { id: +id, g: g, p: at(g), n: n, corner: corner };
    });
    var order = Object.keys(G).map(Number).sort(function (a, b) { return G[a] - G[b]; });
    // Шлях по стінці від gA до gB за годинниковою: кінці + кути між ними
    function wallPath(gA, gB) {
      var Ls = mod(gB - gA, P) || P, out = [at(gA)];
      corners.concat(corners.map(function (x) { return x + P; })).forEach(function (c) {
        if (c > gA + EPS && c < gA + Ls - EPS) out.push(at(c));
      });
      out.push(at(gA + Ls));
      return out;
    }
    return { kind: 'rect', square: sq, L: L, W: W, P: P, pts: pts, order: order,
             poly: [[0, 0], [L, 0], [L, W], [0, W]], at: at, wallN: wallN, isCorner: isCorner,
             corners: corners, wallPath: wallPath, S: L * W };
  }

  function buildOval(L, W, scheme) {
    var a = L / 2, b = W / 2, cx = a, cy = b, N = 2880;           // крок 0,125° (§4.3)
    var TH = scheme === 8 ? { 1: 180, 5: 225, 2: 270, 6: 315, 3: 0, 7: 45, 4: 90, 8: 135 } : { 1: 180, 2: 270, 3: 0, 4: 90 };
    function pt(th) { return [cx + a * Math.cos(th), cy + b * Math.sin(th)]; }
    function nrm(th) { return unit([-Math.cos(th) / a, -Math.sin(th) / b]); } // нормаль всередину
    // Таблиця довжини дуги s(θ) від θ = 0 (сума хорд)
    var S = [0];
    for (var i = 1; i <= N; i++) S.push(S[i - 1] + len(sub(pt(TAU * i / N), pt(TAU * (i - 1) / N))));
    var P = S[N];
    function gOf(deg) { return S[Math.round(deg / 360 * N) % N]; }
    var pts = {};
    Object.keys(TH).forEach(function (id) {
      var th = TH[id] * Math.PI / 180;
      pts[id] = { id: +id, g: gOf(TH[id]), th: th, p: pt(th), n: nrm(th), corner: false };
    });
    var order = Object.keys(TH).map(Number).sort(function (x, y) { return pts[x].g - pts[y].g; });
    // θ за довжиною дуги g (бінарний пошук у таблиці)
    function thOf(g) {
      g = mod(g, P);
      var lo = 0, hi = N;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (S[m] <= g) lo = m; else hi = m; }
      return TAU * (lo + (g - S[lo]) / (S[hi] - S[lo])) / N;
    }
    function wallPath(gA, gB) {
      var Ls = mod(gB - gA, P) || P, n = Math.max(8, Math.ceil(Ls / P * 240)), out = [];
      for (var k = 0; k <= n; k++) out.push(pt(thOf(gA + Ls * k / n)));
      return out;
    }
    var poly = [];
    for (var k = 0; k < 480; k++) poly.push(pt(TAU * k / 480));
    return { kind: 'oval', circle: Math.abs(L - W) <= 0.01 * Math.max(L, W), a: a, b: b, cx: cx, cy: cy, P: P,
             pts: pts, order: order, poly: poly, at: function (g) { return pt(thOf(g)); },
             normalAt: function (g) { return nrm(thOf(g)); }, wallPath: wallPath, S: Math.PI * a * b };
  }

  // Схема для типу сходинки (D32): полиця — 8 точок, платформа і «від кута» — 6 (4)
  function schemeFor(type) { return type === 'shelf' ? 8 : 6; }

  // Модель ставка для схеми; L — завжди довша сторона (§0.2), інакше міняємо місцями (swapped)
  function buildPond(shape, L, W, scheme) {
    var swapped = W > L, Ls = swapped ? W : L, Ws = swapped ? L : W;
    var pond = shape === 'oval' ? buildOval(Ls, Ws, scheme) : buildRect(Ls, Ws, scheme);
    pond.swapped = swapped;
    return pond;
  }

  // Точка схеми → точка плану (як ввів майстер). При W > L — поворот на 90° за годинниковою
  function toPlan(p, pond) {
    if (!pond.swapped) return [p[0], p[1]];
    var Ws = pond.kind === 'rect' ? pond.W : 2 * pond.b;
    return [Ws - p[1], p[0]];
  }

  // ---------- 3. Прогони (§6) ----------
  function runs(pond, sel) {
    var o = pond.order, n = o.length;
    var on = o.map(function (id) { return sel.indexOf(id) !== -1; });
    if (on.every(Boolean)) return 'ring';                        // усі точки — кільце
    var gaps = [];                                               // розриви: s — початок, l — довжина
    for (var i = 0; i < n; i++) {
      if (!on[i] && on[(i - 1 + n) % n]) {
        var l = 0;
        while (!on[(i + l) % n]) l++;
        gaps.push({ s: i, l: l });
      }
    }
    var mx = Math.max.apply(null, gaps.map(function (g) { return g.l; }));
    var cuts = gaps.filter(function (g) { return g.l === mx; }).sort(function (a, b) { return a.s - b.s; });
    return cuts.map(function (g, k) {
      var next = cuts[(k + 1) % cuts.length], seq = [];
      var j = (g.s + g.l) % n;
      do { seq.push(o[j]); j = (j + 1) % n; } while (j !== next.s);
      return { seq: seq, sel: seq.filter(function (id) { return sel.indexOf(id) !== -1; }), ends: [seq[0], seq[seq.length - 1]] };
    });
  }

  // Точки, що справді є в схемі (зайві номери відкидаємо)
  function validPoints(pond, points) {
    return (points || []).map(Number).filter(function (id, i, arr) { return pond.pts[id] && arr.indexOf(id) === i; });
  }

  // ---------- 4. Полиця (§7) ----------
  // step = { points, edge: 'straight' | 'round', wc, we }; opts = { arcTol }
  function shelf(pond, step, opts) {
    var wc = num(step.wc, 0);
    var we = step.we === undefined || step.we === null || step.we === '' ? (step.edge === 'straight' ? wc : 0) : num(step.we, 0);
    var tol = opts && opts.arcTol !== undefined ? opts.arcTol : DEFAULTS.arc_tolerance_m;
    var minWidth = opts && opts.minWidth !== undefined ? opts.minWidth : DEFAULTS.shelf_width_min_m;
    var pts = validPoints(pond, step.points);
    var res = { parts: [], errors: [], warnings: [] };
    if (wc < minWidth - EPS) res.warnings.push('W1');            // тонкий обідок (§1)
    if (!pts.length) { res.errors.push('E1'); return res; }
    var R = runs(pond, pts);
    if (R === 'ring') {                                          // кільце (§7.6)
      if (step.edge === 'straight') {
        var inner = pond.order.map(function (id) { var P = pond.pts[id]; return add(P.p, P.n, wc); });
        if (inner.some(function (p) { return !inPond(p, pond.poly, EPS); }) || signedArea(inner) <= EPS) { res.errors.push('E9'); return res; }
        res.parts.push({ ring: true, rings: [pond.poly, inner], inner: inner, area: pond.S - area(inner), kind: 'кільце' });
      } else if (pond.kind === 'oval') {
        if (wc >= Math.min(pond.a, pond.b)) { res.errors.push('E4'); return res; }
        var ov = [];
        for (var i = 0; i < 480; i++) {
          var t = TAU * i / 480;
          ov.push([pond.cx + (pond.a - wc) * Math.cos(t), pond.cy + (pond.b - wc) * Math.sin(t)]);
        }
        res.parts.push({ ring: true, rings: [pond.poly, ov], inner: ov, area: pond.S - area(ov), kind: 'кільце' });
      } else res.errors.push('E5');
      return res;
    }
    R.forEach(function (part) {
      if (part.sel.length < 2) { res.errors.push('E2'); return; }
      var A = pond.pts[part.ends[0]], B = pond.pts[part.ends[1]];
      var Ls = mod(B.g - A.g, pond.P);
      // Кути всередині прогону (навіть невибрані) — завжди контрольні точки
      var innerCorners = pond.kind === 'rect'
        ? pond.corners.map(function (c) { return c < A.g - EPS ? c + pond.P : c; })
            .filter(function (c) { return c > A.g + EPS && c < A.g + Ls - EPS; })
        : [];
      // Кінцева контрольна точка (§7.2)
      function endPt(E, isStart) {
        if (pond.kind === 'oval' || we === 0) return E.p;           // крива стінка або w_e = 0
        var gIn = isStart ? E.g + 1e-6 : E.g - 1e-6;                // нормаль стінки всередині прогону
        return add(E.p, pond.wallN(gIn), we);                       // у куті — точка на сусідній стінці
      }
      var EA = endPt(A, true), EB = endPt(B, false);
      var M = pond.at(A.g + Ls / 2);
      var nM = pond.kind === 'rect' ? pond.wallN(A.g + Ls / 2) : pond.normalAt(A.g + Ls / 2);
      var Mp = add(M, nM, wc);
      var edge, C = null;
      if (step.edge === 'straight') {
        // Проміжні контрольні точки: вибрані точки + кути, упорядковані по периметру (§7.3)
        var mids = part.sel.slice(1, -1).map(function (id) { return { g: pond.pts[id].g, q: add(pond.pts[id].p, pond.pts[id].n, wc) }; })
          .concat(innerCorners.map(function (c) {
            return { g: c % pond.P, q: add(pond.at(c), add(pond.wallN(c - 1e-6), pond.wallN(c + 1e-6)), wc) };
          }))
          .map(function (x) { x.s = mod(x.g - A.g, pond.P); return x; })
          .sort(function (x, y) { return x.s - y.s; })
          .filter(function (x, i, arr) { return i === 0 || Math.abs(x.s - arr[i - 1].s) > EPS; });
        edge = [EA].concat(mids.length ? mids.map(function (x) { return x.q; }) : [Mp]).concat([EB]);
        if (edge.some(function (p) { return !inPond(p, pond.poly, EPS); })) { res.errors.push('E9'); return; }
      } else {
        if (innerCorners.length) { res.errors.push('E3'); return; }
        C = circle3(EA, Mp, EB);
        edge = C ? arcPoints(C, EA, EB, Mp) : [EA, EB];
        if (edge.some(function (p) { return !inPond(p, pond.poly, tol); })) { res.errors.push('E4'); return; }
      }
      var wall = pond.wallPath(A.g, B.g);
      var poly = wall.concat(edge.slice().reverse());
      var kind = Math.abs(wc - we) < EPS ? 'пряма' : (wc > we ? 'опукла' : 'увігнута');
      res.parts.push({ poly: poly, rings: [poly], edge: edge, C: C, EA: EA, EB: EB, Mp: Mp, area: area(poly), kind: kind,
                       R: C ? C.r : null, chord: C ? len(sub(EB, EA)) : null });
    });
    return res;
  }

  // ---------- 5. Платформа, правило C (§8) ----------
  // step = { points, edge, arcK }; opts = { arcTol }
  function platform(pond, step, opts) {
    var pts = validPoints(pond, step.points);
    var res = { parts: [], errors: [], warnings: [] };
    if (!pts.length) { res.errors.push('E1'); return res; }
    var R = runs(pond, pts), n = pond.order.length, S = pond.S;
    if (R === 'ring') { res.errors.push('E6'); return res; }
    var tol = opts && opts.arcTol !== undefined ? opts.arcTol : DEFAULTS.arc_tolerance_m;
    function cut(u, t) { return clipHalf(pond.poly, u, t); }
    R.forEach(function (part) {
      var A = pond.pts[part.ends[0]], B = pond.pts[part.ends[1]], single = A.id === B.id;
      var u, t, useA = single || part.seq.length === 2;
      if (single) u = unit(A.n);
      else {
        // Правило B: хорда через крайні точки; u дивиться в бік глибокої зони
        u = unit([-(B.p[1] - A.p[1]), B.p[0] - A.p[0]]);
        var out = pond.order.filter(function (id) { return part.seq.indexOf(id) === -1; });
        var mo = out.reduce(function (s, id) { return s + dot(pond.pts[id].p, u); }, 0) / out.length, pa = dot(A.p, u);
        if (Math.abs(mo - pa) > EPS) { if (mo < pa) u = [-u[0], -u[1]]; }
        else {
          var mc = part.sel.reduce(function (s, id) { return s + dot(pond.pts[id].p, u); }, 0) / part.sel.length;
          if (mc > pa) u = [-u[0], -u[1]];
        }
        t = pa;
        var aB = area(cut(u, t));
        if (aB < 0.01 * S || aB > 0.99 * S) useA = true;           // B вироджується
      }
      if (useA) {                                                 // правило A: частка площі k/n (бісекція)
        var f = part.sel.length / n, lo = Infinity, hi = -Infinity;
        pond.poly.forEach(function (p) { lo = Math.min(lo, dot(p, u)); hi = Math.max(hi, dot(p, u)); });
        for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (area(cut(u, m)) < f * S) lo = m; else hi = m; }
        t = (lo + hi) / 2;
      }
      var poly = cut(u, t);                                       // платформа = ставок ∩ {u·p ≤ t}
      // Хорда — перетин прямої u·p = t зі стінкою: вершини многокутника на цій прямій
      var onLine = [];
      poly.forEach(function (p, i) { if (Math.abs(dot(p, u) - t) < 1e-7) onLine.push(i); });
      var dir = [-u[1], u[0]];
      var X = onLine.map(function (i) { return poly[i]; }).sort(function (p, q) { return dot(p, dir) - dot(q, dir); });
      var P1 = X[0], P2 = X[X.length - 1];
      var rule = useA ? 'A' : 'B';
      if (step.edge !== 'round') {
        res.parts.push({ poly: poly, rings: [poly], chord: [P1, P2], area: area(poly), rule: rule, kind: 'платформа' });
        return;
      }
      // Округла платформа (§8.3): дуга прогинається в бік платформи зі стрілою h = k·c
      var c = len(sub(P2, P1)), h = num(step.arcK, DEFAULTS.platform_arc_k) * c;
      var Rr = c * c / (8 * h) + h / 2;
      var seg = Rr * Rr * Math.acos((Rr - h) / Rr) - (Rr - h) * Math.sqrt(2 * Rr * h - h * h);
      var mid = [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2];
      var apex = add(mid, u, -h);                                 // вершина дуги — на боці платформи
      var circ = { c: add(mid, u, Rr - h), r: Rr };               // центр — з боку глибокої зони
      // Замінюємо сторону-хорду многокутника дугою (сусідні вершини на прямій u·p = t)
      var k0 = -1;
      for (var j = 0; j < poly.length; j++) {
        var nx = (j + 1) % poly.length;
        if (onLine.indexOf(j) !== -1 && onLine.indexOf(nx) !== -1) { k0 = j; break; }
      }
      var rpoly = poly;
      if (k0 !== -1) {
        var a0 = poly[k0], b0 = poly[(k0 + 1) % poly.length];
        var arc = arcPoints(circ, a0, b0, apex);
        rpoly = poly.slice(0, k0 + 1).concat(arc.slice(1, -1)).concat(poly.slice(k0 + 1));
        if (arc.some(function (p) { return !inPond(p, pond.poly, tol); })) { res.errors.push('E4'); return; }
      }
      res.parts.push({ poly: rpoly, rings: [rpoly], chord: [P1, P2], R: Rr, h: h, seg: seg,
                       area: area(poly) - seg, rule: rule, kind: 'платформа' });
    });
    return res;
  }

  // ---------- 6. Прямокутник від кута (D37, stairs_math v1.2 §8a) ----------
  // step = { points: [кутова точка], a — вздовж довшої стінки (L), b — вздовж коротшої (W) }
  function cornerRect(pond, step) {
    var res = { parts: [], errors: [], warnings: [] };
    if (pond.kind !== 'rect') { res.errors.push('E10'); return res; }
    var pts = validPoints(pond, step.points).filter(function (id) { return pond.pts[id].corner; });
    if (!pts.length) { res.errors.push('E1'); return res; }
    var P = pond.pts[pts[0]], a = num(step.a, 0), b = num(step.b, 0);
    if (!(a > 0 && b > 0) || a > pond.L + EPS || b > pond.W + EPS) { res.errors.push('E11'); return res; }
    var n = P.n;                                                  // (±1, ±1): куди «всередину» від кута
    var p0 = P.p, p1 = [p0[0] + n[0] * a, p0[1]], p2 = [p0[0] + n[0] * a, p0[1] + n[1] * b], p3 = [p0[0], p0[1] + n[1] * b];
    var poly = [p0, p1, p2, p3];
    if (signedArea(poly) < 0) poly.reverse();                     // обхід за годинниковою, як у ставка
    res.parts.push({ poly: poly, rings: [poly], area: a * b, kind: 'прямокутник' });
    return res;
  }

  // ---------- 7. Видимі площі (§9, v1.2: інтегрування рядками замість растру) ----------
  /*
   * Ставок ріжемо горизонтальними рядками. У кожному рядку многокутник шару — набір відрізків [x0, x1],
   * які рахуються ТОЧНО (перетин сторін з прямою y = середина рядка). Похибка лише по висоті рядка:
   * межі рядків ставимо на всі y вершин, а товсті рядки ділимо до висоти ≤ cell (raster_cell_m).
   * Порівняно з растром 1 см: точніше (x без округлення) і без масивів на мільйони клітинок.
   */

  // Сторони кілець, відсортовані за нижнім y — для швидкого проходу рядками зверху вниз
  function edgeTable(rings) {
    var edges = [];
    rings.forEach(function (ring) {
      for (var i = 0; i < ring.length; i++) {
        var a = ring[i], b = ring[(i + 1) % ring.length];
        if (a[1] === b[1]) continue;                              // горизонтальна сторона рядок не перетинає
        var top = a[1] < b[1] ? a : b, bot = a[1] < b[1] ? b : a;
        edges.push({ y0: top[1], y1: bot[1], x0: top[0], k: (bot[0] - top[0]) / (bot[1] - top[1]) });
      }
    });
    return edges.sort(function (p, q) { return p.y0 - q.y0; });
  }

  // Відрізки многокутника на висоті y (правило парності); active — сторони, що перетинають рядок
  function spansAt(t, y) {
    while (t.next < t.edges.length && t.edges[t.next].y0 <= y) t.active.push(t.edges[t.next++]);
    t.active = t.active.filter(function (e) { return e.y1 > y; });
    var xs = t.active.filter(function (e) { return e.y0 <= y; }).map(function (e) { return e.x0 + (y - e.y0) * e.k; })
      .sort(function (p, q) { return p - q; });
    var out = [];
    for (var k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) out.push([xs[k], xs[k + 1]]);
    return out;
  }

  // Довжина частини відрізків A, що НЕ лежить у відрізках U (обидва списки впорядковані й без перетинів)
  function freeLength(A, U) {
    var free = 0, j = 0;
    A.forEach(function (a) {
      var x = a[0];
      while (j < U.length && U[j][1] <= x) j++;
      for (var k = j; k < U.length && U[k][0] < a[1]; k++) {
        if (U[k][0] > x) free += U[k][0] - x;
        x = Math.max(x, U[k][1]);
        if (x >= a[1]) break;
      }
      if (x < a[1]) free += a[1] - x;
    });
    return free;
  }

  // Об'єднання двох впорядкованих списків відрізків
  function unionSpans(U, A) {
    var all = U.concat(A).sort(function (p, q) { return p[0] - q[0]; }), out = [];
    all.forEach(function (s) {
      var last = out[out.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else out.push([s[0], s[1]]);
    });
    return out;
  }

  function ringsBox(rings) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    rings.forEach(function (r) { r.forEach(function (p) {
      b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]);
    }); });
    return b;
  }

  // Точна площа шару: зовнішнє кільце мінус дірки (кільце-полиця — два кільця)
  function ringsArea(rings) {
    return area(rings[0]) - rings.slice(1).reduce(function (s, r) { return s + area(r); }, 0);
  }

  /*
   * Видимі площі шарів: у спільній зоні діє мілкіший (D33). layers = [{ h, rings, area? }].
   * Шар без перекриття отримує точну площу; інакше — точна площа мінус перекриття з мілкішими.
   * Повністю схований шар — рівно 0 (E8).
   */
  function visibleAreas(pond, layers, cell) {
    cell = cell || DEFAULTS.raster_cell_m;
    var sorted = layers.map(function (l, i) {
      return { i: i, h: l.h, full: l.area !== undefined ? l.area : ringsArea(l.rings), box: ringsBox(l.rings),
               t: { edges: edgeTable(l.rings), next: 0, active: [] }, covered: 0, free: 0, touches: false };
    }).sort(function (a, b) { return a.h - b.h || a.i - b.i; });  // від мілкого до глибокого
    // Габарити перетинаються з мілкішим шаром → рахуємо перекриття; ні → площа точна
    sorted.forEach(function (l, k) {
      l.touches = sorted.slice(0, k).some(function (m) {
        return m.box[0] < l.box[2] && l.box[0] < m.box[2] && m.box[1] < l.box[3] && l.box[1] < m.box[3];
      });
    });
    var vis = new Array(layers.length);
    if (sorted.some(function (l) { return l.touches; })) {
      // Межі рядків: усі y вершин (між ними сторони прямі — середина рядка дає точний результат)
      var ys = [];
      layers.forEach(function (l) { l.rings.forEach(function (r) { r.forEach(function (p) { ys.push(p[1]); }); }); });
      ys.sort(function (a, b) { return a - b; });
      for (var r = 0; r + 1 < ys.length; r++) {
        var ya = ys[r], yb = ys[r + 1];
        if (yb - ya < 1e-12) continue;
        var n = Math.max(1, Math.ceil((yb - ya) / cell));        // товстий рядок ділимо до висоти ≤ cell
        for (var q = 0; q < n; q++) {
          var y = ya + (yb - ya) * (q + 0.5) / n, dy = (yb - ya) / n, U = [];
          sorted.forEach(function (l) {
            var A = spansAt(l.t, y);
            if (!A.length) return;
            var total = A.reduce(function (s, a) { return s + a[1] - a[0]; }, 0), free = freeLength(A, U);
            l.free += free * dy;
            l.covered += (total - free) * dy;
            U = unionSpans(U, A);
          });
        }
      }
    }
    sorted.forEach(function (l) {
      if (!l.touches) vis[l.i] = l.full;
      else vis[l.i] = l.free <= 1e-9 * Math.max(1, l.full) ? 0 : Math.max(0, l.full - l.covered);
    });
    return vis;
  }

  // ---------- 8. Глибини (D34) ----------
  // Глибини за замовчуванням із «Налаштувань»: '20;45;60' → [20, 45, 60]
  function defaultDepthsCm(settings) {
    var raw = settings && settings.shelf_depths_cm !== undefined ? settings.shelf_depths_cm : DEFAULTS.shelf_depths_cm;
    return String(raw).split(/[;,\s]+/).map(function (x) { return num(x, NaN); }).filter(function (x) { return x > 0; });
  }

  // «Поділити порівну»: N рівнів з дном → N − 1 сходинок на глибинах D·k/N, см (до цілого)
  function splitDepthsCm(D, levels) {
    var out = [];
    for (var k = 1; k < levels; k++) out.push(Math.round(100 * D * k / levels));
    return out;
  }

  // ---------- 9. Повний розрахунок сходинок для кошторису ----------
  /*
   * input = { shape, L, W, D, fish, steps: [{ type: 'shelf'|'platform'|'corner', edge, points, wc, we, a, b, depth_cm }] }
   * Повертає { available, S, layers, visibleTotal, Sdeep, deepShare, errors, warnings }:
   *   layers[k] = { index, type, edge, scheme, depth, area, visible, kind, R, chord, parts, rings, errors, warnings, valid }
   *   errors / warnings — [{ code, step (номер з 1 або null), text }].
   * Шар з помилкою не входить у видимі площі й об'єм (помилка блокує збереження, D36).
   */
  function evaluate(input, settings) {
    var L = num(input.L, 0), W = num(input.W, 0), D = num(input.D, 0);
    var steps = input.steps || [];
    var out = { available: false, S: 0, layers: [], visibleTotal: 0, Sdeep: 0, deepShare: 1, errors: [], warnings: [] };
    if (!steps.length) return out;
    if (input.shape !== 'rect' && input.shape !== 'oval') {
      out.errors.push({ code: 'E0', step: null, text: 'Сходинки доступні лише для прямокутного й овального ставка' });
      return out;
    }
    if (!(L > 0 && W > 0 && D > 0)) return out;
    out.available = true;
    var opts = { arcTol: setting(settings, 'arc_tolerance_m'), minWidth: setting(settings, 'shelf_width_min_m') };
    var ponds = {};
    function pondFor(scheme) { return ponds[scheme] || (ponds[scheme] = buildPond(input.shape, L, W, scheme)); }

    steps.forEach(function (st, i) {
      var type = st.type === 'platform' || st.type === 'corner' ? st.type : 'shelf';
      var scheme = schemeFor(type), pond = pondFor(scheme);
      var h = num(st.depth_cm, 0) / 100;
      var r = type === 'shelf' ? shelf(pond, st, opts)
        : type === 'platform' ? platform(pond, { points: st.points, edge: st.edge, arcK: setting(settings, 'platform_arc_k') }, opts)
        : cornerRect(pond, st);
      var errs = r.errors.slice(), warns = r.warnings.slice();
      if (!(h > 0 && h < D)) errs.push('E7');
      if (type === 'corner' && !errs.length && Math.min(num(st.a, 0), num(st.b, 0)) < opts.minWidth - EPS) warns.push('W1');
      var rings = [];
      r.parts.forEach(function (p) { rings = rings.concat(p.rings); });
      var round = r.parts.filter(function (p) { return p.R; })[0];
      out.layers.push({
        index: i + 1, type: type, edge: st.edge === 'round' ? 'round' : 'straight', scheme: pond.order.length,
        depth: h, depth_cm: num(st.depth_cm, 0), parts: r.parts, rings: rings, pond: pond,
        area: r.parts.reduce(function (s, p) { return s + p.area; }, 0), visible: 0,
        kind: r.parts.length ? r.parts[0].kind : '', R: round ? round.R : null,
        chord: round ? (round.chord && round.chord.length ? len(sub(round.chord[1], round.chord[0])) : round.chord) : null,
        errors: errs, warnings: warns, valid: !errs.length && r.parts.length > 0
      });
    });

    // Видимі площі: кожна частина — окремий многокутник шару (кільце — зовнішнє + внутрішнє кільця)
    var S = pondFor(6).S, valid = out.layers.filter(function (l) { return l.valid; });
    var flat = [];
    valid.forEach(function (l) {
      l.parts.forEach(function (p) { flat.push({ h: l.depth, rings: p.rings, area: p.area, layer: l, pond: l.pond }); });
    });
    // Усі схеми одного ставка мають ті самі координати — видимі площі рахуємо в одній системі
    var vis = flat.length ? visibleAreas(pondFor(6), flat, setting(settings, 'raster_cell_m')) : [];
    flat.forEach(function (f, k) { f.layer.visible += vis[k]; });
    valid.forEach(function (l) { if (l.visible <= 1e-6) { l.errors.push('E8'); l.valid = false; } });

    out.S = S;
    out.visibleTotal = out.layers.reduce(function (s, l) { return s + (l.valid ? l.visible : 0); }, 0);
    out.Sdeep = Math.max(0, S - out.visibleTotal);
    out.deepShare = S > 0 ? out.Sdeep / S : 1;

    // Зведені помилки й попередження з номером сходинки
    out.layers.forEach(function (l) {
      l.errors.forEach(function (c) { out.errors.push({ code: c, step: l.index, text: TEXT[c] }); });
      l.warnings.forEach(function (c) { out.warnings.push({ code: c, step: l.index, text: TEXT[c] }); });
    });
    var shareMin = setting(settings, input.fish ? 'deep_share_min_fish' : 'deep_share_min_nofish');
    if (out.deepShare < shareMin - EPS) out.warnings.push({ code: 'W2', step: null, text: TEXT.W2 });
    if (input.fish) out.warnings.push({ code: 'W3', step: null, text: TEXT.W3 });
    if (D < setting(settings, input.fish ? 'depth_min_fish_m' : 'depth_min_nofish_m') - EPS) {
      out.warnings.push({ code: 'W4', step: null, text: TEXT.W4 });
    }
    return out;
  }

  // Об'єм води зі сходинками (§10.1) без коефіцієнта профілю: S_глиб·D + Σ S_vis·h
  function waterVolume(result, S, D) {
    var sum = 0, vis = 0;
    result.layers.forEach(function (l) { if (l.valid) { vis += l.visible; sum += l.visible * l.depth; } });
    return Math.max(0, S - vis) * D + sum;
  }

  // Знімок шару для кошторису й CRM (stairs_math §16): { area_m2, visible_m2, kind, R_m, chord_m }
  function snapshot(layer) {
    var r3 = function (x) { return x === null || x === undefined ? null : Math.round(x * 1000) / 1000; };
    return { area_m2: r3(layer.area), visible_m2: r3(layer.visible), kind: layer.kind, R_m: r3(layer.R), chord_m: r3(layer.chord) };
  }

  return {
    TEXT: TEXT, DEFAULTS: DEFAULTS, snapshot: snapshot,
    add: add, sub: sub, dot: dot, len: len, unit: unit,
    area: area, signedArea: signedArea, inside: inside, clipHalf: clipHalf, circle3: circle3, arcPoints: arcPoints,
    buildRect: buildRect, buildOval: buildOval, buildPond: buildPond, schemeFor: schemeFor, toPlan: toPlan,
    runs: runs, shelf: shelf, platform: platform, cornerRect: cornerRect,
    visibleAreas: visibleAreas,
    defaultDepthsCm: defaultDepthsCm, splitDepthsCm: splitDepthsCm,
    evaluate: evaluate, waterVolume: waterVolume
  };
})();

// Експорт для Node.js; у браузері й Apps Script рядок пропускається
if (typeof module !== 'undefined' && module.exports) module.exports = Stairs;
