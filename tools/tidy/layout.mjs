// Tahap T1 (jalan) dan T2 (gedung) perapi tata letak. Lihat docs/rancangan/2026-11-24/tataletak.md bagian 3.
import { M, UMUM, LOKAL, SERVIS, SIDEWALK, toPts, toFlat, area, centroid, pip, bbox, polyLine, polyPoly, ptPoly, clipHalf, minWidth, isRect, Grid, quant, segX } from './geom.mjs';

export const P = {
  WMIN: { residential: 4.0, unclassified: 4.0, living_street: 3.5, service: 3.0, pedestrian: 3.0 },
  TIGHT_PAD: 0.6, // gedung "sempit" = jarak ke as < w0/2 + 0,6
  HOUSE_UMUM: 3.0, OTHER_UMUM: 0.3, LOKAL: 1.2, LOKAL_NARROW: 0.8, SERVIS: 0.3, WATER: 1.5,
  SHIFT_MAX: 4.0, ATTACH: 0.6, NEIGH: 1.0, MIN_AREA: 24, MIN_SIDE: 3.5, KEEP: 0.55, EPS: 0.08,
  CUT_AREA: 400, CUT_PAD: 1.0,
};

// model jalan (m): { i, cls, kind 'U'|'L'|'S', line, w, s, narrowed }
export function roadModel(D) {
  const R = D.roads, out = [];
  for (let i = 0; i < R.r.length; i++) {
    const cls = D.classes[R.c[i]], kind = UMUM.has(cls) ? 'U' : LOKAL.has(cls) ? 'L' : 'S';
    out.push({ i, cls, kind, line: toPts(R.r[i]), w: R.w[i] * M, s: R.s ? R.s[i] * M : (SIDEWALK[cls] || 0), narrowed: !!(R.s && SIDEWALK[cls] && R.s[i] === 0) });
  }
  return out;
}
export function roadGrid(roads) {
  const G = new Grid(40);
  for (const r of roads) for (let k = 0; k + 1 < r.line.length; k++) { const [ax, ay] = r.line[k], [bx, by] = r.line[k + 1]; G.add(r, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)); }
  return G;
}
export const isHouse = (D, bi) => D.buildings.k[bi] === 0;
// jarak wajib tapak gedung dari as jalan
export function reqOf(D, bi, r) {
  if (r.kind === 'U') return r.w / 2 + r.s + (isHouse(D, bi) ? P.HOUSE_UMUM : P.OTHER_UMUM);
  if (r.kind === 'L') return r.w / 2 + (r.narrowed ? P.LOKAL_NARROW : P.LOKAL);
  return r.w / 2 + P.SERVIS;
}

// ---------- T1: paskan lebar jalan lokal & servis, potong jalan servis yang menembus gedung besar / bukan rumah
export function stageRoads(D, log) {
  const B = D.buildings, R = D.roads, nb = B.r.length;
  const polys = B.r.map((r) => (r.length >= 6 ? toPts(r) : null));
  const BG = new Grid(40);
  polys.forEach((p, i) => { if (p && B.k[i] !== 5) { const b = bbox(p); BG.add(i, b[0], b[1], b[2], b[3]); } });
  const cnt = { narrowed: 0, byClass: {}, cut: 0, added: 0, cutFail: 0 };
  // potong jalan servis dulu (as di dalam gedung ≥ 400 m² atau bukan rumah)
  const n0 = R.r.length;
  for (let i = 0; i < n0; i++) {
    const cls = D.classes[R.c[i]];
    if (!SERVIS.has(cls)) continue;
    const line = toPts(R.r[i]);
    if (line.length < 2) continue;
    const lb = bbox(line), big = [];
    for (const bi of BG.query(lb[0], lb[1], lb[2], lb[3])) { const p = polys[bi]; if ((B.k[bi] !== 0 || Math.abs(area(p)) >= P.CUT_AREA) && polyLine(p, line) === 0) big.push(p); }
    if (!big.length) continue;
    // parameter panjang-busur: selang yang berada di dalam gedung (+ pad)
    const cum = [0];
    for (let k = 1; k < line.length; k++) cum.push(cum[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
    const L = cum[cum.length - 1], at = (s) => { let k = 0; while (k + 2 < cum.length && cum[k + 1] < s) k++; const t = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1); return [line[k][0] + (line[k + 1][0] - line[k][0]) * t, line[k][1] + (line[k + 1][1] - line[k][1]) * t]; };
    const cuts = [];
    for (const p of big) {
      const xs = [0, L];
      for (let k = 0; k + 1 < line.length; k++) for (let a = 0, b = p.length - 1; a < p.length; b = a++) { const t = segX(line[k][0], line[k][1], line[k + 1][0], line[k + 1][1], p[b][0], p[b][1], p[a][0], p[a][1]); if (t >= 0) xs.push(cum[k] + (cum[k + 1] - cum[k]) * t); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k++) { if (xs[k + 1] - xs[k] < 1e-6) continue; const m = at((xs[k] + xs[k + 1]) / 2); if (pip(m[0], m[1], p)) cuts.push([xs[k] - P.CUT_PAD, xs[k + 1] + P.CUT_PAD]); }
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const keep = [];
    let s = 0;
    for (const [a, b] of cuts) { if (a - s >= 3) keep.push([s, a]); s = Math.max(s, b); }
    if (L - s >= 3) keep.push([s, L]);
    if (!keep.length) { cnt.cutFail++; continue; } // seluruh jalan di dalam gedung: dibiarkan (jalan servis, tak masuk kriteria A5)
    const pieces = keep.map(([a, b]) => { const pts = [at(a)]; for (let k = 1; k + 1 < cum.length; k++) if (cum[k] > a + 0.05 && cum[k] < b - 0.05) pts.push(line[k]); pts.push(at(b)); return pts; });
    R.r[i] = toFlat(pieces[0]);
    for (let k = 1; k < pieces.length; k++) { R.r.push(toFlat(pieces[k])); R.c.push(R.c[i]); R.w.push(R.w[i]); cnt.added++; }
    cnt.cut++;
  }
  // paskan lebar
  R.s = [];
  for (let i = 0; i < R.r.length; i++) {
    const cls = D.classes[R.c[i]], w0 = R.w[i] * M;
    let s = SIDEWALK[cls] || 0, w = w0;
    if (!UMUM.has(cls)) {
      const line = toPts(R.r[i]), tight = [];
      if (line.length >= 2) {
        const lb = bbox(line), pad = w0 / 2 + P.TIGHT_PAD;
        for (const bi of BG.query(lb[0] - pad, lb[1] - pad, lb[2] + pad, lb[3] + pad)) { const d = polyLine(polys[bi], line); if (d < pad) tight.push(d); }
      }
      if (tight.length >= (LOKAL.has(cls) ? 3 : 1)) {
        tight.sort((a, b) => a - b);
        const q20 = tight[Math.floor((tight.length - 1) * 0.2)], wmin = P.WMIN[cls] || 3.0;
        w = Math.max(Math.min(wmin, w0), Math.min(w0, Math.floor(2 * (q20 - P.TIGHT_PAD) * 2) / 2));
        if (w < w0 - 1e-6) { cnt.narrowed++; cnt.byClass[cls + ' ' + w.toFixed(1)] = (cnt.byClass[cls + ' ' + w.toFixed(1)] || 0) + 1; if (w <= 4.5) s = 0; }
      }
    }
    R.w[i] = Math.round(w / M);
    R.s.push(Math.round(s / M));
  }
  log('T1 jalan', JSON.stringify(cnt));
  return cnt;
}

// ---------- T2: gedung menjauhi jalan (geser → pangkas → sisa terbesar → buang)
export function stageBuildings(D, log) {
  const B = D.buildings, roads = roadModel(D), RG = roadGrid(roads);
  const polys = B.r.map((r) => (r.length >= 6 ? toPts(r) : null));
  const BG = new Grid(40), bb = polys.map((p) => (p ? bbox(p) : null));
  polys.forEach((p, i) => { if (p) BG.add(i, bb[i][0], bb[i][1], bb[i][2], bb[i][3]); });
  const waters = D.water.map(toPts);
  const canals = (D.waterways.r || []).map((r, i) => ({ line: toPts(r), hw: (D.waterways.w[i] || 0) * M / 2 })).filter((c) => c.hw >= 1.5);
  const o = { d: 0, px: 0, py: 0, qx: 0, qy: 0, seg: 0 };
  const cnt = { viol: 0, shifted: 0, trimmed: 0, removed: 0, houses: 0, others: 0, depth: [0, 0, 0, 0, 0], lost: [0, 0, 0, 0], unresolved: 0 };
  const removed = [];
  const violations = (bi, p) => { // [{ r, def }] terurut dari yang terdalam
    const b = bbox(p), out = [];
    for (const r of RG.query(b[0] - 20, b[1] - 20, b[2] + 20, b[3] + 20)) {
      if (r.cls === 'motorway') continue; // jalan tol layang/berpagar: di luar jangkauan pemain
      const req = reqOf(D, bi, r), d = polyLine(p, r.line);
      if (d < req - P.EPS) out.push({ r, def: req - d, req });
    }
    return out.sort((a, c) => c.def - a.def);
  };
  const waterOk = (p) => {
    for (const w of waters) if (polyPoly(p, w) < P.WATER - 0.05) return false;
    for (const c of canals) if (polyLine(p, c.line) < c.hw + P.WATER - 0.05) return false;
    return true;
  };
  const neighDist = (bi, p, lim) => { const b = bbox(p); let best = Infinity; for (const j of BG.query(b[0] - lim, b[1] - lim, b[2] + lim, b[3] + lim)) { if (j === bi || !polys[j] || B.k[j] === 5) continue; best = Math.min(best, polyPoly(p, polys[j])); if (best === 0) break; } return best; };
  // arah mundur n dari jalan r untuk poligon p; titik acuan q di as jalan
  const backDir = (p, r) => {
    polyLine(p, r.line, o);
    const [ax, ay] = r.line[o.seg], [bx, by] = r.line[o.seg + 1], L = Math.hypot(bx - ax, by - ay) || 1;
    let nx = -(by - ay) / L, ny = (bx - ax) / L;
    if (o.d > 0.05) return { qx: o.qx, qy: o.qy, nx: (o.px - o.qx) / o.d, ny: (o.py - o.qy) / o.d };
    // as menembus/menyentuh tapak: sisi yang menyisakan luas lebih besar
    const a1 = Math.abs(area(clipHalf(p, o.qx, o.qy, nx, ny)) || 0), a2 = Math.abs(area(clipHalf(p, o.qx, o.qy, -nx, -ny)) || 0);
    if (a2 > a1) { nx = -nx; ny = -ny; }
    return { qx: o.qx, qy: o.qy, nx, ny };
  };
  for (let bi = 0; bi < B.r.length; bi++) {
    let p = polys[bi];
    if (!p || B.k[bi] === 5) continue; // 5 = kanopi terbuka (boleh menaungi jalan)
    let V = violations(bi, p);
    if (!V.length) continue;
    cnt.viol++;
    const A0 = Math.abs(area(p)), house = isHouse(D, bi), depth = V[0].def;
    cnt.depth[depth < 0.5 ? 0 : depth < 1 ? 1 : depth < 2 ? 2 : depth < 3 ? 3 : 4]++;
    // 1. geser
    if (depth + 0.1 <= P.SHIFT_MAX && neighDist(bi, p, P.ATTACH + 0.2) > P.ATTACH) {
      const { nx, ny } = backDir(p, V[0].r), d = depth + 0.1, p2 = quant(p.map(([x, y]) => [x + nx * d, y + ny * d]));
      if (!violations(bi, p2).length && waterOk(p2) && neighDist(bi, p2, P.NEIGH + 0.2) >= P.NEIGH) {
        polys[bi] = p2; B.r[bi] = toFlat(p2); B.f[bi] |= 32; cnt.shifted++;
        const b = bbox(p2); BG.add(bi, b[0], b[1], b[2], b[3]);
        continue;
      }
    }
    // 2–3. pangkas
    let ok = true;
    for (let it = 0; it < 10 && V.length; it++) {
      const v = V[0], r = v.r, { qx, qy, nx, ny } = backDir(p, r), keep = v.req + 0.06;
      let done = false;
      if (isRect(p)) { // geser sisi yang menghadap jalan ke dalam sejajar dirinya → tetap persegi
        const sg = area(p) > 0 ? 1 : -1;
        let bs = -1, bdot = 0.5;
        for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ox = (b[1] - a[1]) / L * sg, oy = -(b[0] - a[0]) / L * sg, dt = -(ox * nx + oy * ny); if (dt > bdot) { bdot = dt; bs = i; } }
        if (bs >= 0) {
          const a = p[bs], b = p[(bs + 1) % 4], c = p[(bs + 2) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ix = -(b[1] - a[1]) / L * sg, iy = (b[0] - a[0]) / L * sg; // ke dalam
          const dep = Math.hypot(c[0] - b[0], c[1] - b[1]), mk = (d) => p.map((q, k) => (k === bs || k === (bs + 1) % 4 ? [q[0] + ix * d, q[1] + iy * d] : q));
          const dmax = dep - P.MIN_SIDE;
          if (dmax > 0 && polyLine(mk(dmax), r.line) >= keep) {
            let lo = 0, hi = dmax;
            for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (polyLine(mk(m), r.line) >= keep) hi = m; else lo = m; }
            p = mk(hi + 0.02); done = true;
          }
        }
      }
      if (!done) p = clipHalf(p, qx + nx * keep, qy + ny * keep, nx, ny);
      if (p.length < 3 || Math.abs(area(p)) < P.MIN_AREA) { ok = false; break; }
      p = quant(p);
      V = violations(bi, p);
    }
    if (ok && V.length) { ok = false; cnt.unresolved++; }
    if (ok && (Math.abs(area(p)) < P.MIN_AREA || minWidth(p) < P.MIN_SIDE)) ok = false;
    if (!ok) { // 4. buang (entri tetap ada: cincin kosong, flag 8)
      B.r[bi] = []; B.f[bi] |= 8; polys[bi] = null; cnt.removed++; removed.push(bi);
      continue;
    }
    const lost = 1 - Math.abs(area(p)) / A0;
    cnt.lost[lost < 0.05 ? 0 : lost < 0.15 ? 1 : lost < 0.3 ? 2 : 3]++;
    polys[bi] = p; B.r[bi] = toFlat(p); B.f[bi] |= 16;
    if (isRect(p) && house && Math.abs(area(p)) < 650 && (B.f[bi] & 1 || B.f[bi] & 4)) B.f[bi] |= 2; else B.f[bi] &= ~2;
    cnt.trimmed++; if (house) cnt.houses++; else cnt.others++;
  }
  log('T2 gedung', JSON.stringify(cnt), 'dibuang:', removed.join(','));
  return { ...cnt, removedList: removed };
}

// sisa pelanggaran jarak (untuk meta.layout.warnings & kode keluar)
export function checkBuildings(D) {
  const B = D.buildings, roads = roadModel(D), RG = roadGrid(roads), bad = [];
  for (let bi = 0; bi < B.r.length; bi++) {
    if (B.r[bi].length < 6 || B.k[bi] === 5) continue;
    const p = toPts(B.r[bi]), b = bbox(p);
    for (const r of RG.query(b[0] - 20, b[1] - 20, b[2] + 20, b[3] + 20)) { if (r.cls === 'motorway') continue; const d = polyLine(p, r.line); if (d < reqOf(D, bi, r) - 0.15) { bad.push([bi, r.i, +d.toFixed(2)]); break; } }
  }
  return bad;
}
export { ptPoly, centroid };
