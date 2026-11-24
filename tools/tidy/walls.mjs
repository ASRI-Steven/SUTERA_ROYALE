// Tahap T3: kompleks perumahan, tembok keliling, gerbang jalan, pintu pejalan kaki → D.walls.
// Rancangan: docs/rancangan/2026-11-24/tataletak.md bagian 5 (pendekatan C: fabrik rumah ∪ isi ring cluster).
// Raster 1 m seluruh kawasan; batas kompleks = kontur nol medan jarak f (marching squares), jadi tembok lurus sejajar
// jalan umum dan melengkung halus di lahan bebas. Tiap jalan lokal/servis yang memotong tembok mendapat gerbang.
import { M, UMUM, LOKAL, SERVIS, SIDEWALK, toPts, area, centroid, pip, bbox, ptSeg, segX, Grid } from './geom.mjs';

export const WP = {
  RC: 12, APRON: 3.5, LOCAL_NEAR: 14, LOCAL_SIDE: 7, SERV_NEAR: 7, PUB_PAD: 2.6, PUB_PAD_MIN: 1.0, HOUSE_GAP: 2.0, BLD_PAD: 1.8, WATER_PAD: 0.5,
  SLOT: 3.5, MIN_HOUSES: 8, RING_HOUSES: 8, DP: 0.45, MIN_RUN: 0.3, GATE_SPACING: 160, DOOR_W: 2.0, GATE_PAD: 1.25, GATE_WALL: 0.6, SERV_PAD: 0.9,
  DOOR_FROM_GATE: 12, DOOR_SNAP: 14, SECTOR_WALL: 60,
  // keputusan Steven (HANDOFF §35.2 no. 4): gapura "Sutera Sitara" tetap sebagai hiasan boulevard
  DECO: ['Sutera Sitara'],
  // gapura lama yang dihapus: The Gramercy (melintang jalan umum) + gapura di ring tanpa gedung
  DROP_GATES: ['The Gramercy', 'De Mansion', 'Sutera Winona', 'Leora', 'Sutera Flamboyan', 'Sutera Danau Biru'],
};

// transformasi jarak Euclid kuadrat (Felzenszwalb): g = 0 di sel sumber, INF di lainnya → jarak kuadrat (sel)
function edt(src, W, H) {
  const INF = 1e12, N = Math.max(W, H), f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1), out = new Float32Array(W * H);
  const pass = (n) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; } else { k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
  };
  const tmp = new Float32Array(W * H);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = src[y * W + x] ? 0 : INF; pass(H); for (let y = 0; y < H; y++) tmp[y * W + x] = Math.min(d[y], 1e9); }
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) f[x] = tmp[o + x]; pass(W); for (let x = 0; x < W; x++) out[o + x] = Math.sqrt(d[x]); }
  return out;
}
function dp(pts, tol) { // Douglas–Peucker (garis terbuka)
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let bi = -1, bd = tol; for (let i = a + 1; i < b; i++) { const d = ptSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]); if (d > bd) { bd = d; bi = i; } } if (bi >= 0) { keep[bi] = 1; st.push([a, bi], [bi, b]); } }
  return pts.filter((_, i) => keep[i]);
}

export function stageWalls(D, log, warnings) {
  const B = D.buildings, R = D.roads, crop = D.meta.crop.map((v) => v * M);
  const X0 = Math.floor(crop[0]) - 2, Y0 = Math.floor(crop[1]) - 2, W = Math.ceil(crop[2]) + 2 - X0, H = Math.ceil(crop[3]) + 2 - Y0, N = W * H;
  const ci = (x) => Math.floor(x - X0), cj = (y) => Math.floor(y - Y0), cx = (i) => X0 + i + 0.5, cy = (j) => Y0 + j + 0.5;
  const fillPoly = (p, fn) => { // sel yang pusatnya di dalam poligon
    const b = bbox(p), j0 = Math.max(0, cj(b[1])), j1 = Math.min(H - 1, cj(b[3]));
    for (let j = j0; j <= j1; j++) {
      const y = cy(j), xs = [];
      for (let a = 0, c = p.length - 1; a < p.length; c = a++) { const ya = p[a][1], yc = p[c][1]; if ((ya > y) !== (yc > y)) xs.push(p[a][0] + (y - ya) * (p[c][0] - p[a][0]) / (yc - ya)); }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.ceil(xs[k] - X0 - 0.5)), i1 = Math.min(W - 1, Math.floor(xs[k + 1] - X0 - 0.5)); for (let i = i0; i <= i1; i++) fn(j * W + i, i, j); }
    }
  };
  const band = (ax, ay, bx, by, r, fn) => { // sel berjarak ≤ r dari ruas
    const i0 = Math.max(0, ci(Math.min(ax, bx) - r)), i1 = Math.min(W - 1, ci(Math.max(ax, bx) + r)), j0 = Math.max(0, cj(Math.min(ay, by) - r)), j1 = Math.min(H - 1, cj(Math.max(ay, by) + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = ptSeg(cx(i), cy(j), ax, ay, bx, by); if (d <= r) fn(j * W + i, d); }
  };
  const flatBand = (ax, ay, bx, by, r, fn) => { // seperti band tetapi tanpa tutup bundar di ujung (hanya sel yang proyeksinya jatuh di ruas ± 0,6 m)
    const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey) || 1, ux = ex / L, uy = ey / L;
    const i0 = Math.max(0, ci(Math.min(ax, bx) - r)), i1 = Math.min(W - 1, ci(Math.max(ax, bx) + r)), j0 = Math.max(0, cj(Math.min(ay, by) - r)), j1 = Math.min(H - 1, cj(Math.max(ay, by) + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = cx(i) - ax, dy = cy(j) - ay, t = dx * ux + dy * uy; if (t < -0.6 || t > L + 0.6) continue; if (Math.abs(-dx * uy + dy * ux) <= r) fn(j * W + i); }
  };
  const polyBand = (p, r, fn) => { for (let a = 0, c = p.length - 1; a < p.length; c = a++) band(p[c][0], p[c][1], p[a][0], p[a][1], r, fn); };

  // ---------- rumah fabrik
  const polys = B.r.map((r) => (r.length >= 6 ? toPts(r) : null));
  const clusters = D.clusters.map((c, i) => ({ i, name: c.name, kind: c.kind, p: toPts(c.r) }));
  const nonRes = clusters.filter((c) => c.kind !== 'residential');
  const fabric = [];
  for (let bi = 0; bi < polys.length; bi++) {
    const p = polys[bi];
    if (!p || B.k[bi] !== 0 || !(B.f[bi] & 1) || (B.f[bi] & 4) || Math.abs(area(p)) >= 1500 || B.h[bi] * M >= 11) continue;
    const c = centroid(p);
    if (nonRes.some((q) => pip(c[0], c[1], q.p))) continue;
    fabric.push(bi);
  }
  const isFab = new Uint8Array(polys.length); for (const bi of fabric) isFab[bi] = 1;
  const mH = new Uint8Array(N);
  for (const bi of fabric) { fillPoly(polys[bi], (k) => { mH[k] = 1; }); polyBand(polys[bi], 0.71, (k) => { mH[k] = 1; }); }
  const dH = edt(mH, W, H);
  // ---------- F = rumah ∪ koridor jalan lokal dekat rumah ∪ aspal servis dekat rumah
  const roads = R.r.map((r, i) => { const cls = D.classes[R.c[i]]; return { i, cls, kind: UMUM.has(cls) ? 'U' : LOKAL.has(cls) ? 'L' : 'S', line: toPts(r), w: R.w[i] * M, s: R.s ? R.s[i] * M : (SIDEWALK[cls] || 0) }; }).filter((r) => r.line.length >= 2);
  const mF = mH.slice();
  for (const r of roads) {
    if (r.kind === 'U') continue;
    // potongan as ≤ 1 m yang titik tengahnya dekat rumah → seluruh penampang jalan ikut (jalan di depan rumah utuh sampai
    // trotoar seberang; jalan penghubung yang menjauh dari rumah tidak menjulur keluar)
    const hw = r.kind === 'L' ? r.w / 2 + r.s : r.w / 2, lim = r.kind === 'L' ? WP.LOCAL_NEAR : WP.SERV_NEAR;
    for (let k = 0; k + 1 < r.line.length; k++) {
      const a = r.line[k], c = r.line[k + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.ceil(L));
      for (let q = 0; q < n; q++) { const t0 = q / n, t1 = (q + 1) / n, mx = a[0] + (c[0] - a[0]) * (t0 + t1) / 2, my = a[1] + (c[1] - a[1]) * (t0 + t1) / 2, kk = cj(my) * W + ci(mx); if (kk < 0 || kk >= N || dH[kk] > lim) continue;
        if (r.kind === 'L') { const lx = -(c[1] - a[1]) / (L || 1) * (hw + 4), ly = (c[0] - a[0]) / (L || 1) * (hw + 4), k1 = cj(my + ly) * W + ci(mx + lx), k2 = cj(my - ly) * W + ci(mx - lx); if (Math.min(dH[k1] ?? 99, dH[k2] ?? 99) > WP.LOCAL_SIDE) continue; } // rumah harus di SAMPING jalan (bukan di belakang ujungnya)
        flatBand(a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0, a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1, hw + 0.5, (z) => { mF[z] = 1; }); }
    }
  }
  const dF = edt(mF, W, H);
  const mNA = new Uint8Array(N);
  for (let k = 0; k < N; k++) mNA[k] = dF[k] > WP.RC ? 1 : 0;
  const f = edt(mNA, W, H);
  for (let k = 0; k < N; k++) f[k] -= WP.RC - WP.APRON;
  log('walls: raster', W, '×', H, 'rumah fabrik', fabric.length);
  if (process.env.TIDY_PROBE) for (const q of process.env.TIDY_PROBE.split(';')) { const [x, y] = q.split(',').map(Number), k = cj(y) * W + ci(x); console.log('probe', x, y, 'dH', dH[k].toFixed(1), 'mF', mF[k], 'dF', dF[k].toFixed(1), 'f0', f[k].toFixed(1)); }
  // ---------- ∪ isi ring residential berisi ≥ 8 rumah fabrik (ring induk tidak dipakai)
  const resid = clusters.filter((c) => c.kind === 'residential');
  const fc = fabric.map((bi) => centroid(polys[bi]));
  for (const c of resid) { c.houses = 0; c.b = bbox(c.p); fc.forEach((q) => { if (q[0] >= c.b[0] && q[0] <= c.b[2] && q[1] >= c.b[1] && q[1] <= c.b[3] && pip(q[0], q[1], c.p)) c.houses++; }); c.cen = centroid(c.p); }
  for (const c of resid) c.parent = resid.some((o) => o !== c && o.houses >= WP.RING_HOUSES && Math.abs(area(o.p)) < Math.abs(area(c.p)) && pip(o.cen[0], o.cen[1], c.p));
  const sd = new Float32Array(N), mark = new Uint8Array(N);
  // medan jarak bertanda poligon: di dalam +, di luar −, jenuh ±cap (pita 2,5 m dihitung eksak)
  const signed = (p, cap, apply) => {
    const touched = [];
    fillPoly(p, (k) => { if (!mark[k]) { mark[k] = 1; sd[k] = cap; touched.push(k); } });
    polyBand(p, 2.5, (k, d) => { if (!mark[k]) { mark[k] = 2; sd[k] = -Math.min(cap, d); touched.push(k); } else if (mark[k] === 1) { mark[k] = 3; sd[k] = Math.min(cap, d); } else if (mark[k] === 2) sd[k] = Math.max(sd[k], -d); else sd[k] = Math.min(sd[k], d); });
    for (const k of touched) { apply(k, sd[k]); mark[k] = 0; }
  };
  let ringsUsed = 0;
  for (const c of resid) { if (c.houses < WP.RING_HOUSES || c.parent) continue; ringsUsed++; signed(c.p, 6, (k, s) => { if (s > f[k]) f[k] = s; }); }
  // jarak ke aspal jalan lokal/servis: tembok di tepi jalan umum mengalah (jalur hijau menyempit) bila jalan lingkungan menempel
  const mL = new Uint8Array(N);
  for (const r of roads) { if (r.kind === 'U') continue; for (let k = 0; k + 1 < r.line.length; k++) band(r.line[k][0], r.line[k][1], r.line[k + 1][0], r.line[k + 1][1], r.w / 2, (q) => { mL[q] = 1; }); }
  const dL = edt(mL, W, H);
  // ---------- − koridor jalan umum, air, luar kawasan, gedung non-fabrik
  const hard = new Uint8Array(N); // sel yang tidak boleh masuk kompleks: jalan umum + trotoar, air, luar kawasan, tapak gedung non-fabrik, kampung
  const sub = (k, g) => { if (g < f[k]) f[k] = g; };
  for (const r of roads) {
    if (r.kind !== 'U') continue;
    const base = r.w / 2 + r.s;
    for (let k = 0; k + 1 < r.line.length; k++) band(r.line[k][0], r.line[k][1], r.line[k + 1][0], r.line[k + 1][1], base + WP.PUB_PAD + 1.5, (q, d) => { if (d < base) hard[q] = 1; sub(q, Math.max(d - base - Math.max(dL[q] < 3.2 ? 0.2 : WP.PUB_PAD_MIN, Math.min(WP.PUB_PAD, dH[q] - WP.HOUSE_GAP, dL[q] - 0.8)), Math.min(0.75 - dL[q], d - r.w / 2 - 0.35))); }); // jalan lingkungan yang menempel jalan umum tetap di dalam: tembok di trotoar jalan umum
  }
  for (const w of D.water) signed(toPts(w), 6, (k, s) => { if (s > -WP.WATER_PAD) hard[k] = 1; sub(k, -s - WP.WATER_PAD); });
  (D.waterways.r || []).forEach((r, i) => { const hw = D.waterways.w[i] * M / 2, L = toPts(r); if (hw < 1.5) return; for (let k = 0; k + 1 < L.length; k++) band(L[k][0], L[k][1], L[k + 1][0], L[k + 1][1], hw + 2.5, (q, d) => { if (d < hw + WP.WATER_PAD) hard[q] = 1; sub(q, d - hw - WP.WATER_PAD); }); });
  const boundary = toPts(D.boundary), inAreaM = new Uint8Array(N);
  fillPoly(boundary, (k) => { inAreaM[k] = 1; });
  for (let k = 0; k < N; k++) if (!inAreaM[k]) { f[k] = Math.min(f[k], -6); hard[k] = 1; }
  polyBand(boundary, 2.5, (k, d) => sub(k, inAreaM[k] ? d : -d));
  // kampung enclave (lubang batas kawasan) tidak ditembok: seluruh poligonnya + 2 m di luar kompleks
  const subH = (k, g) => sub(k, Math.max(g, WP.HOUSE_GAP + 0.3 - dH[k])); // tidak pernah < 2,3 m dari rumah fabrik
  for (const h of D.boundaryHoles || []) signed(toPts(h), 6, (k, s) => { if (s > 0) hard[k] = 1; subH(k, -s - 2); });
  for (let bi = 0; bi < polys.length; bi++) { if (!polys[bi] || isFab[bi] || B.k[bi] === 5 || (B.f[bi] & 4)) continue; signed(polys[bi], 6, (k, s) => { if (s >= 0) { hard[k] = 1; sub(k, -s - WP.BLD_PAD); } else subH(k, -s - WP.BLD_PAD); }); }
  // ---------- celah luar yang sempit (< 2 × SLOT m: dua tembok sejajar berdempetan, lekuk di sekitar gedung) ditutup
  {
    const mR = new Uint8Array(N); for (let k = 0; k < N; k++) mR[k] = f[k] > 0 ? 1 : 0;
    const d1 = edt(mR, W, H), m2 = new Uint8Array(N); for (let k = 0; k < N; k++) m2[k] = d1[k] > WP.SLOT ? 1 : 0;
    const d2 = edt(m2, W, H); let filled = 0;
    for (let k = 0; k < N; k++) if (!mR[k] && !hard[k] && d2[k] > WP.SLOT + 0.5) { f[k] = Math.min(2, d2[k] - WP.SLOT); filled++; }
    log('walls: sel celah sempit ditutup', filled);
  }
  // ---------- lubang ikut ke dalam; komponen berisi < 8 rumah dibuang
  const lab = new Int32Array(N); // 0 belum, −1 luar, > 0 id komponen
  const stack = new Int32Array(N);
  const flood = (seed, val, inside) => {
    let n = 0, sp = 0; stack[sp++] = seed; lab[seed] = val;
    while (sp) { const k = stack[--sp]; n++; const i = k % W, j = (k - i) / W; for (const q of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1]) if (q >= 0 && !lab[q] && (f[q] > 0) === inside) { lab[q] = val; stack[sp++] = q; } }
    return n;
  };
  for (let i = 0; i < W; i++) for (const k of [i, (H - 1) * W + i]) if (!lab[k] && f[k] <= 0) flood(k, -1, false);
  for (let j = 0; j < H; j++) for (const k of [j * W, j * W + W - 1]) if (!lab[k] && f[k] <= 0) flood(k, -1, false);
  let holes = 0;
  for (let k = 0; k < N; k++) if (!lab[k] && f[k] <= 0) { f[k] = 3; holes++; }
  let nc = 0;
  const comps = [null];
  for (let k = 0; k < N; k++) if (!lab[k] && f[k] > 0) { const id = ++nc, cells = flood(k, id, true); comps.push({ id, cells, houses: 0 }); }
  fc.forEach((q) => { const l = lab[cj(q[1]) * W + ci(q[0])]; if (l > 0) comps[l].houses++; });
  for (let k = 0; k < N; k++) if (lab[k] > 0 && comps[lab[k]].houses < WP.MIN_HOUSES) { f[k] = -1; lab[k] = -1; }
  const alive = comps.filter((c) => c && c.houses >= WP.MIN_HOUSES);
  alive.sort((a, b) => b.houses - a.houses).forEach((c, i) => { c.cid = i; });
  const inFab = alive.reduce((s, c) => s + c.houses, 0);
  log('walls: ring dipakai', ringsUsed, 'kompleks', alive.length, 'rumah fabrik di dalam', inFab, '/', fabric.length, 'sel lubang', holes);

  // ---------- kontur nol (marching squares di kisi pusat sel); dalam di sisi kiri arah jalan
  const fv = (i, j) => f[j * W + i];
  const segOut = new Map(); // kunci tepi awal → [kunci tepi akhir, x, y awal]
  const ekey = (i, j, h) => (j * W + i) * 2 + h; // h = 1: tepi mendatar (i,j)–(i+1,j); 0: tegak (i,j)–(i,j+1)
  const ept = (i, j, h) => { const a = fv(i, j), b = h ? fv(i + 1, j) : fv(i, j + 1), t = a / (a - b); return h ? [cx(i) + t, cy(j)] : [cx(i), cy(j) + t]; };
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = fv(i, j) > 0, b = fv(i + 1, j) > 0, c = fv(i + 1, j + 1) > 0, d = fv(i, j + 1) > 0, code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const E = { B: ekey(i, j, 1), R: ekey(i + 1, j, 0), T: ekey(i, j + 1, 1), L: ekey(i, j, 0) };
    // pasangan (dari, ke) dengan sisi dalam di kiri
    const T = { 1: ['B', 'L'], 2: ['R', 'B'], 3: ['R', 'L'], 4: ['T', 'R'], 6: ['T', 'B'], 7: ['T', 'L'], 8: ['L', 'T'], 9: ['B', 'T'], 11: ['R', 'T'], 12: ['L', 'R'], 13: ['B', 'R'], 14: ['L', 'B'] }[code];
    const add = (s, e) => segOut.set(E[s], E[e]);
    if (T) add(T[0], T[1]); else if (code === 5) { add('B', 'R'); add('T', 'L'); } else { add('R', 'T'); add('L', 'B'); }
  }
  const eDec = (k) => { const h = k & 1, q = k >> 1, i = q % W, j = (q - i) / W; return ept(i, j, h); };
  const loops = [];
  for (const start of [...segOut.keys()]) {
    if (!segOut.has(start)) continue;
    const pts = [];
    let k = start;
    while (segOut.has(k)) { pts.push(eDec(k)); const nx = segOut.get(k); segOut.delete(k); k = nx; }
    if (k === start && pts.length >= 8 && area(pts) > 50) loops.push(pts); // hanya lingkar luar (berlawanan jarum jam)
  }
  // ---------- jenis sisi luar per titik: 0 tembok · 2 air · 3 batas kawasan
  const waters = D.water.map(toPts).map((p) => ({ p, b: bbox(p) }));
  const canal = (D.waterways.r || []).map((r, i) => ({ L: toPts(r), hw: D.waterways.w[i] * M / 2 })).filter((c) => c.hw >= 1.5);
  const BSeg = new Grid(40);
  for (let a = 0, c = boundary.length - 1; a < boundary.length; c = a++) BSeg.add([boundary[c], boundary[a]], Math.min(boundary[c][0], boundary[a][0]) - 2, Math.min(boundary[c][1], boundary[a][1]) - 2, Math.max(boundary[c][0], boundary[a][0]) + 2, Math.max(boundary[c][1], boundary[a][1]) + 2);
  const kindAt = (x, y) => {
    for (const [a, b] of BSeg.query(x, y, x, y)) if (ptSeg(x, y, a[0], a[1], b[0], b[1]) < 0.9) return 3;
    for (const w of waters) { if (x < w.b[0] - 2 || x > w.b[2] + 2 || y < w.b[1] - 2 || y > w.b[3] + 2) continue; if (pip(x, y, w.p)) return 2; for (let a = 0, c = w.p.length - 1; a < w.p.length; c = a++) if (ptSeg(x, y, w.p[c][0], w.p[c][1], w.p[a][0], w.p[a][1]) < WP.WATER_PAD + 0.5) return 2; }
    for (const c of canal) for (let k = 0; k + 1 < c.L.length; k++) if (ptSeg(x, y, c.L[k][0], c.L[k][1], c.L[k + 1][0], c.L[k + 1][1]) < c.hw + WP.WATER_PAD + 0.5) return 2;
    return 0;
  };
  const BG = new Grid(40);
  polys.forEach((p, i) => { if (p && B.k[i] !== 5) { const b = bbox(p); BG.add(i, b[0], b[1], b[2], b[3]); } });
  const bldDist = (x, y, lim) => { let best = lim; for (const bi of BG.query(x - lim, y - lim, x + lim, y + lim)) { const p = polys[bi]; if (pip(x, y, p)) return 0; for (let a = 0, c = p.length - 1; a < p.length; c = a++) best = Math.min(best, ptSeg(x, y, p[c][0], p[c][1], p[a][0], p[a][1])); } return best; };
  const RGl = new Grid(40);
  for (const r of roads) for (let k = 0; k + 1 < r.line.length; k++) { const a = r.line[k], b = r.line[k + 1]; RGl.add([r, k], Math.min(a[0], b[0]) - 14, Math.min(a[1], b[1]) - 14, Math.max(a[0], b[0]) + 14, Math.max(a[1], b[1]) + 14); }
  const asphalt = (x, y, pad = 0, skip = -1) => { for (const [r, k] of RGl.query(x, y, x, y)) { if (r.i === skip) continue; const a = r.line[k], b = r.line[k + 1]; if (ptSeg(x, y, a[0], a[1], b[0], b[1]) < r.w / 2 + pad) return r; } return null; };

  // tembok tidak berdiri di aspal: titik (dipadatkan ≤ 2 m) yang jatuh di aspal jalan lokal/servis digeser tegak lurus as
  // jalan ke tepi terdekat + 0,5 m, asal tetap ≥ 1,6 m dari gedung; sisanya dicatat sebagai peringatan
  let nudged = 0, stuck = 0;
  const nudge = (P) => {
    const dense = [P[0]];
    for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 2)); for (let q = 1; q <= n; q++) dense.push([a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n]); }
    let any = false;
    const o = [0, 0, 0];
    for (let i = 1; i + 1 < dense.length; i++) {
      const [x, y] = dense[i];
      for (const [r, k] of RGl.query(x, y, x, y)) {
        if (r.kind === 'U') continue;
        const a = r.line[k], b = r.line[k + 1], d = ptSeg(x, y, a[0], a[1], b[0], b[1], o), lim = r.w / 2 + 0.5;
        if (d >= lim - 0.05 || o[2] <= 0 || o[2] >= 1) continue;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
        if ((x - o[0]) * nx + (y - o[1]) * ny < 0) { nx = -nx; ny = -ny; }
        const x2 = o[0] + nx * lim, y2 = o[1] + ny * lim;
        if (bldDist(x2, y2, 1.6) < 1.6) { stuck++; continue; }
        dense[i] = [x2, y2]; any = true; nudged++; break;
      }
    }
    if (!any) return;
    const sm = dp(dense, 0.25); P.length = 0; for (const q of sm) P.push(q);
  };
  // ---------- per lingkar: jenis ruas, gerbang, pintu pejalan, garis tembok
  const lines = [], gates = [], compounds = [];
  const oldGates = (D._oldGates || []);
  for (const pts0 of loops) {
    const m0 = pts0[0], l0 = lab[cj(m0[1]) * W + ci(m0[0])] > 0 ? lab[cj(m0[1]) * W + ci(m0[0])] : 0;
    // id komponen: cari sel dalam terdekat
    let cl = l0;
    for (let k = 0; k < pts0.length && cl <= 0; k += 3) { const a = pts0[k], b = pts0[(k + 1) % pts0.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, x = a[0] - (b[1] - a[1]) / L * 1.5, y = a[1] + (b[0] - a[0]) / L * 1.5, l = lab[cj(y) * W + ci(x)]; if (l > 0) cl = l; }
    const comp = cl > 0 ? comps[cl] : null;
    if (!comp || comp.cid === undefined) continue;
    // sederhanakan lingkar per jenis: titik jenis berubah dipertahankan
    const kinds0 = pts0.map(([x, y]) => kindAt(x, y));
    let s0 = 0; while (s0 < pts0.length && kinds0[s0] === kinds0[(s0 + pts0.length - 1) % pts0.length]) s0++;
    if (s0 === pts0.length) s0 = 0;
    const pts = [], kd = []; // kd[i] = jenis ruas pts[i] → pts[i+1]
    { const n = pts0.length; let i = 0; while (i < n) { const k0 = kinds0[(s0 + i) % n]; const run = [pts0[(s0 + i) % n]]; let j = i + 1; while (j < n && kinds0[(s0 + j) % n] === k0) { run.push(pts0[(s0 + j) % n]); j++; } run.push(pts0[(s0 + j) % n]); const sm = dp(run, WP.DP); for (let q = 0; q + 1 < sm.length; q++) { pts.push(sm[q]); kd.push(k0); } i = j; } }
    const n = pts.length, cum = [0];
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const LEN = cum[n], wrap = (s) => ((s % LEN) + LEN) % LEN;
    const at = (s) => { s = wrap(s); let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; } const a = pts[lo], b = pts[(lo + 1) % n], L = cum[lo + 1] - cum[lo] || 1, t = (s - cum[lo]) / L; return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, i: lo, tx: (b[0] - a[0]) / L, ty: (b[1] - a[1]) / L }; };
    const kindS = (s) => kd[at(s).i];
    // gerbang jalan: perpotongan as jalan lokal/servis dengan ruas bertembok
    const open = []; // { s0, s1, g (indeks gates) | −1, c0, c1 (titik sambung corong) }
    const SG = new Grid(40);
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; if (kd[i] === 0) SG.add(i, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])); }
    const myGates = [];
    for (const r of roads) {
      if (r.kind === 'U') continue;
      for (let k = 0; k + 1 < r.line.length; k++) {
        const a = r.line[k], b = r.line[k + 1];
        for (const i of SG.query(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) {
          const p = pts[i], q = pts[(i + 1) % n], t = segX(a[0], a[1], b[0], b[1], p[0], p[1], q[0], q[1]);
          if (t < 0) continue;
          const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          let ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
          const fin = f[cj(y + uy * 2.5) * W + ci(x + ux * 2.5)], fout = f[cj(y - uy * 2.5) * W + ci(x - ux * 2.5)];
          if (fin < fout) { ux = -ux; uy = -uy; } // (ux, uy) = arah masuk kompleks
          myGates.push({ r, x, y, ux, uy, s: cum[i] + Math.hypot(x - p[0], y - p[1]) });
        }
      }
    }
    // satu jalan yang memotong dua kali berdekatan (≤ 3 m) dihitung sekali
    myGates.sort((a, b) => a.s - b.s);
    const G2 = [];
    for (const g of myGates) { if (G2.some((o) => o.r === g.r && Math.min(Math.abs(o.s - g.s), LEN - Math.abs(o.s - g.s)) < 3)) continue; G2.push(g); }
    for (const g of G2) {
      const serv = g.r.kind === 'S', half = serv ? g.r.w / 2 + WP.SERV_PAD : g.r.w / 2 + WP.GATE_PAD, hc = serv ? half : half + WP.GATE_WALL, nx = -g.uy, ny = g.ux;
      const walk = (dir) => { let s = 0; for (; s < hc * 4; s += 0.25) { const q = at(g.s + dir * s), lat = Math.abs((q.x - g.x) * nx + (q.y - g.y) * ny); if (lat >= hc) break; } return s; };
      g.half = half; g.hc = hc; g.a0 = g.s - walk(-1); g.a1 = g.s + walk(1);
    }
    // bukaan bertumpuk / terlalu rapat → satu bukaan polos (tanpa pilar)
    G2.sort((a, b) => a.a0 - b.a0);
    const groups = [];
    for (const g of G2) { const last = groups[groups.length - 1]; if (last && g.a0 < last.a1 + 2.0) { last.list.push(g); last.a1 = Math.max(last.a1, g.a1); } else groups.push({ a0: g.a0, a1: g.a1, list: [g] }); }
    if (groups.length > 1) { const A = groups[0], Z = groups[groups.length - 1]; if (A.a0 + LEN < Z.a1 + 2.0) { Z.list.push(...A.list); Z.a1 = Math.max(Z.a1, A.a1 + LEN); groups.shift(); } }
    for (const gr of groups) {
      const plain = gr.list.length > 1 || gr.list.some((g) => { // pilar tidak boleh di aspal jalan lain / di gedung
        const nx = -g.uy, ny = g.ux; for (const sdn of [1, -1]) { const px = g.x + nx * sdn * g.half, py = g.y + ny * sdn * g.half; if (asphalt(px, py, 0.6, g.r.i) || bldDist(px, py, 1.2) < 1.2) return true; } return false; });
      const o = { s0: gr.a0, s1: gr.a1, plain, gi: [] };
      for (const g of gr.list) {
        const gi = gates.push({ x: Math.round(g.x / M), y: Math.round(g.y / M), a: Math.round(((Math.atan2(g.uy, g.ux) * 180 / Math.PI + 360) % 360) * 10), w: Math.round(g.r.w / M), h: Math.round(g.half / M), k: g.r.kind === 'S' ? 2 : 1, c: comp.cid, ci: -1, road: g.r.i, ...(plain ? { p: 1 } : {}) }) - 1;
        o.gi.push(gi);
        if (!plain) { // corong: ujung tembok ditarik sejajar jalan sampai garis gerbang
          const nx = -g.uy, ny = g.ux, con = (s) => { const q = at(s), lat = (q.x - g.x) * nx + (q.y - g.y) * ny, sg = lat >= 0 ? 1 : -1; return [g.x + nx * sg * g.hc, g.y + ny * sg * g.hc]; };
          o.c0 = con(gr.a0); o.c1 = con(gr.a1);
        }
      }
      open.push(o);
    }
    // ---------- pintu pejalan kaki: jarak antar bukaan sepanjang tembok ≤ GATE_SPACING
    // "keluar" = bukaan gerbang + ruas tepi air (perenang); ruas batas kawasan = buntu
    const runs = []; // ruas bertembok maksimal [s0, s1] + jenis ujung
    { let i = 0; while (i < n) { if (kd[i] !== 0) { i++; continue; } let j = i; while (j + 1 < n && kd[j + 1] === 0) j++; runs.push({ s0: cum[i], s1: cum[j + 1], e0: kd[(i + n - 1) % n], e1: kd[(j + 1) % n] }); i = j + 1; } }
    if (runs.length > 1 && kd[0] === 0 && kd[n - 1] === 0) { const A = runs.shift(), Z = runs[runs.length - 1]; Z.s1 = A.s1 + LEN; Z.e1 = A.e1; }
    const allWall = runs.length === 1 && runs[0].s1 - runs[0].s0 >= LEN - 1e-6;
    const doorOk = (s, loose = false) => {
      const q = at(s), a = at(s - 3.2), b = at(s + 3.2);
      if (kindS(s - 3.2) !== 0 || kindS(s + 3.2) !== 0 || kindS(s) !== 0) return false;
      if (ptSeg(q.x, q.y, a.x, a.y, b.x, b.y) > (loose ? 0.8 : 0.3) || Math.hypot(b.x - a.x, b.y - a.y) < (loose ? 5.6 : 6.2)) return false; // ruas lurus ≥ 6 m
      for (const o of open) { const d = Math.min(Math.abs(wrap(s) - wrap(o.s0)), Math.abs(wrap(s) - wrap(o.s1)), LEN - Math.abs(wrap(s) - wrap(o.s0)), LEN - Math.abs(wrap(s) - wrap(o.s1))); if (d < (loose ? 5 : WP.DOOR_FROM_GATE)) return false; }
      const ox = q.ty, oy = -q.tx; // keluar = kanan arah jalan
      for (const d of [1.2, 2.4, 3.6]) { const x = q.x + ox * d, y = q.y + oy * d, k = cj(y) * W + ci(x); if (!inAreaM[k] || kindAt(x, y) !== 0 || bldDist(x, y, 0.8) < 0.8) return false; }
      for (const d of [1.2, 2.4]) { const x = q.x - ox * d, y = q.y - oy * d; if (bldDist(x, y, 0.8) < 0.8) return false; }
      if (asphalt(q.x, q.y, 0.5)) return false;
      return true;
    };
    const doors = [];
    const addDoor = (target, lo, hi) => { // titik sah terdekat ke target dalam [lo, hi]; putaran kedua dengan syarat longgar
      for (const loose of [false, true]) for (let d = 0; d <= (loose ? 30 : 14); d += 1) for (const s of d ? [target + d, target - d] : [target]) { if (s < lo + 4 || s > hi - 4) continue; if (doors.some((q) => Math.abs(q - s) < 8)) continue; if (doorOk(s, loose)) { doors.push(s); return true; } }
      return false;
    };
    let doorMiss = 0;
    const place = (a, b, ea, eb) => {
      const L = b - a; if (L < (ea || eb ? 30 : 12)) return; // ruas pendek di antara dua bagian batas kawasan: tanpa pintu
      const SP = WP.GATE_SPACING - 2 * WP.DOOR_SNAP; // sasaran lebih rapat: pintu boleh bergeser ± DOOR_SNAP ke tempat yang sah
      const nd = ea && eb ? Math.ceil(L / SP) - 1 : ea || eb ? Math.ceil(L / SP - 0.5) : Math.ceil(L / SP);
      if (nd <= 0) return;
      const d = ea && eb ? L / (nd + 1) : ea || eb ? L / (nd + 0.5) : L / nd;
      for (let q = 0; q < nd; q++) { const off = ea ? d * (q + 1) : d * (q + 0.5); if (!addDoor(a + off, a, b)) doorMiss++; }
    };
    for (const run of runs) {
      let a0 = run.s0, a1 = run.s1, ea = run.e0 === 2, eb = run.e1 === 2, skip = null;
      if (allWall) { if (!open.length) ea = eb = false; else { skip = open[0]; a0 = skip.s1; a1 = skip.s0 + LEN; ea = eb = true; } }
      const ex = [];
      for (const o of open) { if (o === skip) continue; for (const sh of [0, LEN, -LEN]) { const m = (o.s0 + o.s1) / 2 + sh; if (m > a0 && m < a1) ex.push([Math.max(a0, o.s0 + sh), Math.min(a1, o.s1 + sh)]); } }
      ex.sort((p, q) => p[0] - q[0]);
      let p0 = a0, pe = ea;
      for (const e of [...ex, null]) { place(p0, e ? e[0] : a1, pe, e ? true : eb); if (e) { p0 = e[1]; pe = true; } }
    }
    // tiap kompleks ≥ 2 bukaan (≥ 3 bila > 3 ha); tiap kuadran bertembok ≥ 60 m punya ≥ 1 bukaan
    const cen = centroid(pts), ha = Math.abs(area(pts)) / 1e4;
    const openPos = () => [...open.map((o) => (o.s0 + o.s1) / 2), ...doors];
    const wallLen = runs.reduce((s, r) => s + r.s1 - r.s0, 0);
    for (let sec = 0; sec < 4; sec++) {
      const inSec = (s) => { const q = at(s), a = Math.atan2(q.y - cen[1], q.x - cen[0]); return Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4 === sec; };
      let len = 0; const cand = [];
      for (const run of runs) for (let s = run.s0; s < run.s1; s += 2) if (inSec(s)) { len += 2; cand.push(s); }
      if (len < WP.SECTOR_WALL || openPos().some((s) => inSec(s))) continue;
      const mid = cand[cand.length >> 1]; let done = false;
      for (const s of [mid, ...cand]) if (!doors.some((q) => Math.abs(q - s) < 8) && doorOk(s)) { doors.push(s); done = true; break; }
      if (!done) doorMiss++;
    }
    for (let need = ha > 3 ? 3 : 2, guard = 0; openPos().length < need && guard < 6 && runs.length; guard++) { const run = runs[guard % runs.length]; let ok = false; for (let s = run.s0 + 6; s < run.s1 - 6 && !ok; s += 3) if (!doors.some((q) => Math.abs(q - s) < 30) && doorOk(s)) { doors.push(s); ok = true; } }
    for (const s of doors) {
      const q = at(s), hw = WP.DOOR_W / 2 + 0.3;
      const gi = gates.push({ x: Math.round(q.x / M), y: Math.round(q.y / M), a: Math.round(((Math.atan2(q.tx, -q.ty) * 180 / Math.PI + 360) % 360) * 10), w: Math.round(WP.DOOR_W / M), h: Math.round(hw / M), k: 3, c: comp.cid, ci: -1, road: -1 }) - 1;
      open.push({ s0: s - hw, s1: s + hw, plain: true, door: true, gi: [gi] });
    }
    // ---------- garis tembok = ruas bertembok − bukaan
    let wallM = 0;
    const cut = (s0, s1) => { // titik lingkar pada selang [s0, s1]
      const out = [], a = at(s0), b = at(s1); out.push([a.x, a.y]);
      for (let i = 0; i <= 2 * n; i++) { const c = cum[i % n] + Math.floor(i / n) * LEN; if (c > s0 + 0.05 && c < s1 - 0.05) out.push(pts[i % n]); if (c >= s1) break; }
      out.push([b.x, b.y]); return out;
    };
    for (const run of runs) {
      const ops = [];
      for (const o of open) for (const sh of [0, LEN, -LEN]) { if (o.s1 + sh > run.s0 && o.s0 + sh < run.s1) ops.push({ a: o.s0 + sh, b: o.s1 + sh, o }); }
      ops.sort((p, q) => p.a - q.a);
      let s = run.s0, eS = allWall ? null : run.e0, prev = null;
      const emit = (a, b, e0, e1, o0, o1) => {
        if (b - a < WP.MIN_RUN) return;
        const P = cut(a, b);
        if (o0 && o0.c1) P.unshift(o0.c1); if (o1 && o1.c0) P.push(o1.c0);
        const clean = [P[0]]; for (let i = 1; i < P.length; i++) if (Math.hypot(P[i][0] - clean[clean.length - 1][0], P[i][1] - clean[clean.length - 1][1]) > 0.15) clean.push(P[i]);
        if (clean.length < 2) return;
        if (e0 === 3) { const a0 = clean[0], a1 = clean[1], L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1; clean.unshift([a0[0] - (a1[0] - a0[0]) / L * 1.6, a0[1] - (a1[1] - a0[1]) / L * 1.6]); }
        if (e1 === 3) { const a0 = clean[clean.length - 1], a1 = clean[clean.length - 2], L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1; clean.push([a0[0] - (a1[0] - a0[0]) / L * 1.6, a0[1] - (a1[1] - a0[1]) / L * 1.6]); }
        if (e0 === 2) { const a0 = clean[0], a1 = clean[1], L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1; clean.unshift([a0[0] - (a1[0] - a0[0]) / L * 1.1, a0[1] - (a1[1] - a0[1]) / L * 1.1]); }
        if (e1 === 2) { const a0 = clean[clean.length - 1], a1 = clean[clean.length - 2], L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1; clean.push([a0[0] - (a1[0] - a0[0]) / L * 1.1, a0[1] - (a1[1] - a0[1]) / L * 1.1]); }
        nudge(clean);
        for (let i = 0; i + 1 < clean.length; i++) wallM += Math.hypot(clean[i + 1][0] - clean[i][0], clean[i + 1][1] - clean[i][1]);
        const flat = []; for (const [x, y] of clean) flat.push(Math.round(x / M), Math.round(y / M));
        lines.push({ p: flat, c: comp.cid, t: 0, e: [e0, e1] });
      };
      const eKind = (o) => (o.plain ? 0 : 1);
      if (allWall && ops.length) { // lingkar penuh: mulai dari bukaan pertama
        for (let k = 0; k < ops.length; k++) { const A = ops[k], Bn = ops[(k + 1) % ops.length], b = k + 1 < ops.length ? Bn.a : Bn.a + LEN; emit(A.b, b, eKind(A.o), eKind(Bn.o), A.o, Bn.o); }
        continue;
      }
      for (const op of ops) { emit(s, op.a, prev ? eKind(prev) : eS, eKind(op.o), prev, op.o); s = Math.max(s, op.b); prev = op.o; }
      emit(s, run.s1, prev ? eKind(prev) : eS, allWall ? 0 : run.e1, prev, null);
    }
    // jarak terjauh sepanjang tembok ke bukaan/keluar
    let maxGap = 0;
    { const ex = []; for (const o of open) ex.push(wrap((o.s0 + o.s1) / 2)); for (const run of runs) { if (!allWall && run.e0 === 2) ex.push(wrap(run.s0)); if (!allWall && run.e1 === 2) ex.push(wrap(run.s1)); }
      for (const run of runs) for (let s = run.s0; s <= run.s1; s += 4) { let best = 1e9; for (const e of ex) for (const sh of [0, LEN, -LEN]) { const lo = Math.min(s, e + sh), hi = Math.max(s, e + sh); if (allWall || (lo >= run.s0 - 3 && hi <= run.s1 + 3)) best = Math.min(best, hi - lo); } if (best < 1e9) maxGap = Math.max(maxGap, best); else maxGap = Math.max(maxGap, 999); } }
    const names = resid.filter((c) => c.houses >= WP.RING_HOUSES && !c.parent && lab[cj(c.cen[1]) * W + ci(c.cen[0])] === cl).map((c) => c.i);
    compounds.push({ id: comp.cid, houses: comp.houses, ha: +ha.toFixed(1), clusters: names, wall: Math.round(wallM), loop: Math.round(LEN), gates: open.filter((o) => !o.door).reduce((s, o) => s + o.gi.length, 0), doors: doors.length, maxGap: Math.round(maxGap), doorMiss });
    if (doorMiss) warnings.push(`kompleks ${comp.cid}: ${doorMiss} pintu pejalan kaki tidak mendapat tempat sah`);
  }
  compounds.sort((a, b) => a.id - b.id);

  // ---------- gapura utama (k = 0): satu per nama cluster per kompleks; kompleks tanpa ring → satu gapura tanpa nama
  const pubDist = (x, y) => { let best = 1e9; for (const r of roads) { if (r.kind !== 'U' || r.cls === 'motorway' || r.cls === 'motorway_link') continue; for (let k = 0; k + 1 < r.line.length; k++) best = Math.min(best, ptSeg(x, y, r.line[k][0], r.line[k][1], r.line[k + 1][0], r.line[k + 1][1]) - r.w / 2); } return best; };
  const taken = new Set();
  for (const cp of compounds) {
    const cand = gates.map((g, i) => ({ g, i })).filter(({ g }) => g.c === cp.id && g.k === 1 && !g.p);
    for (const q of cand) q.pub = pubDist(q.g.x * M, q.g.y * M);
    const pick = (ci, ring) => {
      let best = null, bs = 1e9;
      for (const q of cand) {
        if (taken.has(q.i)) continue;
        const x = q.g.x * M, y = q.g.y * M;
        let dr = 0; if (ring) { dr = 1e9; for (let a = 0, c = ring.length - 1; a < ring.length; c = a++) dr = Math.min(dr, ptSeg(x, y, ring[c][0], ring[c][1], ring[a][0], ring[a][1])); if (dr > 60 && !pip(x, y, ring)) continue; }
        const old = ci >= 0 && oldGates.some((o) => o.name === D.clusters[ci].name && Math.hypot(o.x - x, o.y - y) < 40) ? -1000 : 0;
        const sc = old + q.pub + dr * 0.5 - q.g.w * M;
        if (sc < bs) { bs = sc; best = q; }
      }
      if (best) { taken.add(best.i); best.g.k = 0; best.g.ci = ci; }
      return !!best;
    };
    let any = false;
    for (const ci of cp.clusters) any = pick(ci, clusters[ci].p) || any;
    if (!any) pick(-1, null);
  }
  let pubCross = 0;
  for (const r of roads) { if (r.kind !== 'U') continue; for (let k = 0; k + 1 < r.line.length; k++) { const a = r.line[k], b = r.line[k + 1]; for (const L of lines) { const bb = L.bb || (L.bb = (() => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let j = 0; j < L.p.length; j += 2) { x0 = Math.min(x0, L.p[j] * M); x1 = Math.max(x1, L.p[j] * M); y0 = Math.min(y0, L.p[j + 1] * M); y1 = Math.max(y1, L.p[j + 1] * M); } return [x0, y0, x1, y1]; })()); if (Math.max(a[0], b[0]) < bb[0] || Math.min(a[0], b[0]) > bb[2] || Math.max(a[1], b[1]) < bb[1] || Math.min(a[1], b[1]) > bb[3]) continue; for (let j = 0; j + 3 < L.p.length; j += 2) if (segX(a[0], a[1], b[0], b[1], L.p[j] * M, L.p[j + 1] * M, L.p[j + 2] * M, L.p[j + 3] * M) >= 0) pubCross++; } } }
  for (const L of lines) delete L.bb;
  if (pubCross) warnings.push(`${pubCross} ruas jalan umum memotong tembok`);
  const cnt = { compounds: compounds.length, housesIn: inFab, fabric: fabric.length, wallM: compounds.reduce((s, c) => s + c.wall, 0), loopM: compounds.reduce((s, c) => s + c.loop, 0), lines: lines.length,
    gates: { k0: gates.filter((g) => g.k === 0).length, k1: gates.filter((g) => g.k === 1).length, k2: gates.filter((g) => g.k === 2).length, k3: gates.filter((g) => g.k === 3).length, polos: gates.filter((g) => g.p).length }, pubCross, nudged, stuck, maxGap: Math.max(...compounds.map((c) => c.maxGap)) };
  D.walls = { lines, gates, compounds };
  log('walls:', JSON.stringify(cnt));
  return cnt;
}
