// Еталонна реалізація математики сходинок (для перевірки інструкції).
// Одиниці: метри. Вісь x — вправо, вісь y — вниз (як на екрані).
'use strict';

// ---------- 1. Векторні дрібниці ----------
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = v => Math.hypot(v[0], v[1]);
const unit = v => { const l = len(v); return [v[0] / l, v[1] / l]; };

// Площа многокутника (формула Гаусса / «шнурування»), зі знаком
function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
const area = poly => Math.abs(signedArea(poly));

// Точка всередині многокутника (метод променя, правило парності)
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// Відстань від точки до межі многокутника
function distToPoly(p, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], d = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d)));
    m = Math.min(m, len(sub(p, add(a, d, t))));
  }
  return m;
}

// Відтинання опуклого многокутника півплощиною u·p <= t (Сазерленд — Годжман)
function clipHalf(poly, u, t) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const fp = dot(P, u) - t, fq = dot(Q, u) - t;
    if (fp <= 0) out.push(P);
    if (fp * fq < 0) out.push(add(P, sub(Q, P), fp / (fp - fq)));
  }
  return out;
}

// Коло через три точки (описане коло трикутника). null — точки на одній прямій.
function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const A = dot(a, a), B = dot(b, b), C = dot(c, c);
  const cx = (A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d;
  const cy = (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d;
  return { c: [cx, cy], r: len(sub(a, [cx, cy])) };
}

// Точки дуги від from до to, що проходить через via
function arcPoints(C, from, to, via, n = 120) {
  const ang = p => Math.atan2(p[1] - C.c[1], p[0] - C.c[0]);
  const norm = x => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t0 = ang(from), dTo = norm(ang(to) - t0), dVia = norm(ang(via) - t0);
  const dt = dVia < dTo ? dTo : -(2 * Math.PI - dTo); // напрям, у якому трапляється via
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + dt * i / n;
    out.push([C.c[0] + C.r * Math.cos(t), C.c[1] + C.r * Math.sin(t)]);
  }
  return out;
}

// ---------- 2. Моделі ставка ----------
// Прямокутник/квадрат: точки, порядок обходу (за годинниковою), нормалі, кути
function buildRect(L, W, scheme) {
  const sq = Math.abs(L - W) <= 0.01 * Math.max(L, W); // квадрат з допуском 1 %
  const P = 2 * (L + W);
  // g — відстань по периметру від #1 за годинниковою стрілкою
  const G = sq
    ? (scheme === 8 ? { 1: 0, 5: L / 2, 2: L, 6: L + W / 2, 4: L + W, 7: 1.5 * L + W, 3: 2 * L + W, 8: 2 * L + 1.5 * W }
                    : { 1: 0, 2: L, 4: L + W, 3: 2 * L + W })
    : (scheme === 8 ? { 1: 0, 2: L / 2, 3: L, 8: L + W / 2, 6: L + W, 5: 1.5 * L + W, 4: 2 * L + W, 7: 2 * L + 1.5 * W }
                    : { 1: 0, 2: L / 2, 3: L, 6: L + W, 5: 1.5 * L + W, 4: 2 * L + W });
  const at = g => { g = ((g % P) + P) % P;
    if (g <= L) return [g, 0]; if (g <= L + W) return [L, g - L];
    if (g <= 2 * L + W) return [L - (g - L - W), W]; return [0, W - (g - 2 * L - W)]; };
  const wallN = g => { g = ((g % P) + P) % P;          // нормаль стінки, на якій лежить g
    if (g < L) return [0, 1]; if (g < L + W) return [-1, 0]; if (g < 2 * L + W) return [0, -1]; return [1, 0]; };
  const corners = [0, L, L + W, 2 * L + W];
  const isCorner = g => corners.some(c => Math.abs(((g % P) + P) % P - c) < 1e-9);
  const pts = {};
  for (const id in G) {
    const g = G[id], corner = isCorner(g);
    const n = corner ? add(wallN(g - 1e-6), wallN(g + 1e-6)) : wallN(g); // у куті n1+n2
    pts[id] = { id: +id, g, p: at(g), n, corner };
  }
  const order = Object.keys(G).map(Number).sort((a, b) => G[a] - G[b]);
  // Шлях по стінці від gA до gB (за годинниковою): кінці + кути між ними
  const wallPath = (gA, gB) => {
    const Ls = ((gB - gA) % P + P) % P || P, out = [at(gA)];
    for (const c of corners.concat(corners.map(x => x + P))) if (c > gA + 1e-9 && c < gA + Ls - 1e-9) out.push(at(c));
    out.push(at(gA + Ls)); return out;
  };
  return { kind: 'rect', square: sq, L, W, P, pts, order, poly: [[0, 0], [L, 0], [L, W], [0, W]],
           at, wallN, isCorner, corners, wallPath,
           S: L * W };
}

// Овал/коло: параметричний кут θ, точки на півосях і між ними
function buildOval(L, W, scheme) {
  const a = L / 2, b = W / 2, cx = a, cy = b, N = 2880;    // крок 0,125°
  const TH = scheme === 8 ? { 1: 180, 5: 225, 2: 270, 6: 315, 3: 0, 7: 45, 4: 90, 8: 135 } : { 1: 180, 2: 270, 3: 0, 4: 90 };
  const pt = th => [cx + a * Math.cos(th), cy + b * Math.sin(th)];
  const nrm = th => unit([-Math.cos(th) / a, -Math.sin(th) / b]); // нормаль всередину
  // таблиця довжини дуги s(θ) від θ = 0 (сума хорд)
  const S = [0];
  for (let i = 1; i <= N; i++) S.push(S[i - 1] + len(sub(pt(2 * Math.PI * i / N), pt(2 * Math.PI * (i - 1) / N))));
  const P = S[N];
  const gOf = deg => S[Math.round(deg / 360 * N) % N];
  const pts = {};
  for (const id in TH) { const th = TH[id] * Math.PI / 180; pts[id] = { id: +id, g: gOf(TH[id]), th, p: pt(th), n: nrm(th), corner: false }; }
  const order = Object.keys(TH).map(Number).sort((x, y) => pts[x].g - pts[y].g);
  // θ за довжиною дуги g (бінарний пошук у таблиці)
  const thOf = g => { g = ((g % P) + P) % P; let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= g) lo = m; else hi = m; }
    return 2 * Math.PI * (lo + (g - S[lo]) / (S[hi] - S[lo])) / N; };
  const wallPath = (gA, gB) => { const Ls = ((gB - gA) % P + P) % P || P, n = Math.max(8, Math.ceil(Ls / P * 240)), out = [];
    for (let i = 0; i <= n; i++) out.push(pt(thOf(gA + Ls * i / n))); return out; };
  const poly = []; for (let i = 0; i < 480; i++) poly.push(pt(2 * Math.PI * i / 480));
  // периметр за Рамануджаном (для кошторису) і точний (для геометрії)
  const Pram = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  return { kind: 'oval', circle: Math.abs(L - W) <= 0.01 * Math.max(L, W), a, b, cx, cy, P, Pram, pts, order, poly,
           at: g => pt(thOf(g)), normalAt: g => nrm(thOf(g)), wallPath, S: Math.PI * a * b };
}

// ---------- 3. Прогони (які точки утворюють сходинку) ----------
// Повертає 'ring' або список частин {seq, sel, ends:[A,B]}
function runs(pond, sel) {
  const o = pond.order, n = o.length, on = o.map(id => sel.includes(id));
  if (on.every(Boolean)) return 'ring';
  const gaps = [];
  for (let i = 0; i < n; i++) if (!on[i] && on[(i - 1 + n) % n]) {
    let l = 0; while (!on[(i + l) % n]) l++; gaps.push({ s: i, l });
  }
  const mx = Math.max(...gaps.map(g => g.l));
  const cuts = gaps.filter(g => g.l === mx).sort((a, b) => a.s - b.s);
  return cuts.map((g, k) => {
    const next = cuts[(k + 1) % cuts.length], seq = [];
    let i = (g.s + g.l) % n;
    do { seq.push(o[i]); i = (i + 1) % n; } while (i !== next.s);
    return { seq, sel: seq.filter(id => sel.includes(id)), ends: [seq[0], seq[seq.length - 1]] };
  });
}

// ---------- 4. Полиця ----------
// step = {points, edge:'straight'|'round', wc, we}
function shelf(pond, step) {
  const { wc } = step, we = step.we ?? (step.edge === 'straight' ? wc : 0);
  const R = runs(pond, step.points), res = { parts: [], errors: [], warnings: [] };
  if (wc < 0.3) res.warnings.push('W1: ширина по центру < 0,3 м');
  if (R === 'ring') {                                    // усі точки — кільце
    if (step.edge === 'straight') {
      const inner = pond.order.map(id => { const P = pond.pts[id];
        return add(P.p, P.n, wc); });                   // у куті n = n1+n2 → внутрішній кут
      res.parts.push({ ring: true, inner, area: pond.S - area(inner) });
    } else if (pond.kind === 'oval') {
      const inner = []; for (let i = 0; i < 480; i++) { const t = 2 * Math.PI * i / 480;
        inner.push([pond.cx + (pond.a - wc) * Math.cos(t), pond.cy + (pond.b - wc) * Math.sin(t)]); }
      res.parts.push({ ring: true, inner, area: pond.S - area(inner) });
    } else res.errors.push('E5: округле кільце огинає кути');
    return res;
  }
  for (const part of R) {
    if (part.sel.length < 2) { res.errors.push('E2: полиці потрібно ≥ 2 точки'); continue; }
    const A = pond.pts[part.ends[0]], B = pond.pts[part.ends[1]];
    const Ls = ((B.g - A.g) % pond.P + pond.P) % pond.P;
    // внутрішні кути прогону (навіть невибрані) — завжди контрольні точки
    const innerCorners = pond.kind === 'rect'
      ? pond.corners.map(c => c < A.g - 1e-9 ? c + pond.P : c).filter(c => c > A.g + 1e-9 && c < A.g + Ls - 1e-9) : [];
    // кінцева контрольна точка
    const endPt = (E, isStart) => {
      if (pond.kind === 'oval' || we === 0) return E.p;             // крива стінка або w_e = 0
      const gIn = isStart ? E.g + 1e-6 : E.g - 1e-6;                  // нормаль стінки всередині прогону
      return add(E.p, pond.wallN(gIn), we);                           // у куті — точка на сусідній стінці
    };
    const EA = endPt(A, true), EB = endPt(B, false);
    const M = pond.at(A.g + Ls / 2);
    const nM = pond.kind === 'rect' ? pond.wallN(A.g + Ls / 2) : pond.normalAt(A.g + Ls / 2);
    const Mp = add(M, nM, wc);
    let edge, C = null;
    if (step.edge === 'straight') {
      // проміжні контрольні точки: вибрані точки + кути, упорядковані по периметру
      const mids = part.sel.slice(1, -1).map(id => ({ g: pond.pts[id].g, q: add(pond.pts[id].p, pond.pts[id].n, wc) }))
        .concat(innerCorners.map(c => ({ g: c % pond.P, q: add(pond.at(c), add(pond.wallN(c - 1e-6), pond.wallN(c + 1e-6)), wc) })))
        .map(x => ({ ...x, s: ((x.g - A.g) % pond.P + pond.P) % pond.P }))
        .sort((x, y) => x.s - y.s)
        .filter((x, i, arr) => i === 0 || Math.abs(x.s - arr[i - 1].s) > 1e-9);
      edge = [EA].concat(mids.length ? mids.map(x => x.q) : [Mp]).concat([EB]);
      if (edge.some(p => !inside(p, pond.poly) && distToPoly(p, pond.poly) > 1e-9)) { res.errors.push('E9: полиця зашироку для цих точок'); continue; }
    } else {
      if (innerCorners.length) { res.errors.push('E3: округла полиця не огинає кут'); continue; }
      C = circle3(EA, Mp, EB);
      edge = C ? arcPoints(C, EA, EB, Mp) : [EA, EB];
      if (edge.some(p => !inside(p, pond.poly) && distToPoly(p, pond.poly) > 0.01)) { res.errors.push('E4: дуга виходить за стінку'); continue; }
    }
    const wall = pond.wallPath(A.g, B.g);
    const poly = wall.concat(edge.slice().reverse());
    const kind = Math.abs(wc - we) < 1e-9 ? 'пряма' : (wc > we ? 'опукла' : 'увігнута');
    res.parts.push({ poly, edge, C, EA, EB, Mp, area: area(poly), kind });
  }
  return res;
}

// ---------- 5. Платформа (правило C) ----------
function platform(pond, step) {
  const R = runs(pond, step.points), n = pond.order.length, S = pond.S, res = { parts: [], errors: [] };
  if (R === 'ring') { res.errors.push('E6: для кільця оберіть «Полиця»'); return res; }
  const cut = (u, t) => clipHalf(pond.poly, u, t);
  for (const part of R) {
    const A = pond.pts[part.ends[0]], B = pond.pts[part.ends[1]], single = A.id === B.id;
    let u, t, useA = single || part.seq.length === 2;
    if (single) u = unit(A.n);
    else {
      u = unit([-(B.p[1] - A.p[1]), B.p[0] - A.p[0]]);
      const out = pond.order.filter(id => !part.seq.includes(id));
      const mo = out.reduce((s, id) => s + dot(pond.pts[id].p, u), 0) / out.length, pa = dot(A.p, u);
      if (Math.abs(mo - pa) > 1e-9) { if (mo < pa) u = [-u[0], -u[1]]; }
      else { const mc = part.sel.reduce((s, id) => s + dot(pond.pts[id].p, u), 0) / part.sel.length; if (mc > pa) u = [-u[0], -u[1]]; }
      t = pa; const aB = area(cut(u, t)); if (aB < 0.01 * S || aB > 0.99 * S) useA = true;
    }
    if (useA) {                                          // правило A: частка площі k/n
      const f = part.sel.length / n; let lo = Infinity, hi = -Infinity;
      for (const p of pond.poly) { lo = Math.min(lo, dot(p, u)); hi = Math.max(hi, dot(p, u)); }
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (area(cut(u, m)) < f * S) lo = m; else hi = m; }
      t = (lo + hi) / 2;
    }
    const poly = cut(u, t);                              // платформа = ставок ∩ {u·p ≤ t}
    // хорда — перетин прямої u·p = t зі стінкою
    const X = [];
    for (let i = 0; i < pond.poly.length; i++) { const P = pond.poly[i], Q = pond.poly[(i + 1) % pond.poly.length];
      const fp = dot(P, u) - t, fq = dot(Q, u) - t; if (fp * fq < 0) X.push(add(P, sub(Q, P), fp / (fp - fq))); else if (Math.abs(fp) < 1e-12) X.push(P); }
    const dir = [-u[1], u[0]]; X.sort((p, q) => dot(p, dir) - dot(q, dir));
    const P1 = X[0], P2 = X[X.length - 1];
    if (step.edge === 'round') {                          // дуга прогинається в бік платформи
      const c = len(sub(P2, P1)), h = (step.arcK ?? 0.1) * c;  // стріла h = k · c
      const Rr = c * c / (8 * h) + h / 2;                     // радіус за хордою і стрілою
      const seg = Rr * Rr * Math.acos((Rr - h) / Rr) - (Rr - h) * Math.sqrt(2 * Rr * h - h * h); // площа сегмента
      res.parts.push({ chord: [P1, P2], R: Rr, h, area: area(poly) - seg, rule: useA ? 'A' : 'B' });
      continue;
    }
    res.parts.push({ poly, chord: [P1, P2], area: area(poly), rule: useA ? 'A' : 'B' });
  }
  return res;
}

// ---------- 6. Растеризація рядками і видимі площі шарів ----------
// Кожен шар — набір кілець (зовнішнє + внутрішнє для кільця); правило парності
function rasterRows(rings, cell, box) {
  const [x0, y0, x1, y1] = box, nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell);
  const grid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * cell, xs = [];
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1;
    }
  }
  return { grid, nx, ny };
}

function visibleAreas(pond, layers, cell = 0.01) {
  const box = [0, 0, pond.kind === 'rect' ? pond.L : 2 * pond.a, pond.kind === 'rect' ? pond.W : 2 * pond.b];
  const sorted = layers.map((l, i) => ({ ...l, i })).sort((a, b) => a.h - b.h); // від мілкої до глибокої
  const taken = rasterRows([pond.poly], cell, box); const nCells = taken.grid.length;
  const used = new Uint8Array(nCells), vis = new Array(layers.length).fill(0);
  for (const l of sorted) {
    const g = rasterRows(l.rings, cell, box).grid;
    let c = 0; for (let k = 0; k < nCells; k++) if (g[k] && taken.grid[k] && !used[k]) { used[k] = 1; c++; }
    vis[l.i] = c * cell * cell;
  }
  return vis;
}

module.exports = { add, sub, dot, len, unit, area, signedArea, inside, clipHalf, circle3, arcPoints,
  buildRect, buildOval, runs, shelf, platform, rasterRows, visibleAreas };
