// Data turunan sesudah peta dirapikan: benda lingkungan (alsut-props.json) dan lapisan sekitar (alsut-context.json).
// Dipakai sebagai langkah terakhir sesudah tools/build_props.py / build_context.py (yang butuh ekstrak OSM), atau langsung
// pada berkas lama bila ekstraknya tidak ada.
import fs from 'node:fs';
import { M, toPts, bbox, Grid, polyPoly, polyLine, ptSeg, pip } from './geom.mjs';
import { WP } from './walls.mjs';

export function deriveContext(D, inFile, outFile, log) {
  const X = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const waters = [...D.water, ...(X.water || [])].map(toPts).map((p) => ({ p, b: bbox(p) }));
  const canals = [...D.waterways.r.map((r, i) => [r, D.waterways.w[i]]), ...(X.waterways.r || []).map((r, i) => [r, X.waterways.w[i]])].map(([r, w]) => ({ line: toPts(r), hw: w * M / 2 })).filter((c) => c.hw >= 1.5);
  const B = X.buildings, keep = [];
  for (let i = 0; i < B.r.length; i++) {
    const p = toPts(B.r[i]);
    if (p.length < 3) continue;
    const b = bbox(p);
    let near = false;
    for (const w of waters) { if (b[2] < w.b[0] - 2 || b[0] > w.b[2] + 2 || b[3] < w.b[1] - 2 || b[1] > w.b[3] + 2) continue; if (polyPoly(p, w.p) <= 1.0) { near = true; break; } }
    if (!near) for (const c of canals) if (polyLine(p, c.line) - c.hw <= 1.0) { near = true; break; }
    if (!near) keep.push(i);
  }
  const n0 = B.r.length;
  for (const k of Object.keys(B)) if (Array.isArray(B[k]) && B[k].length === n0) B[k] = keep.map((i) => B[k][i]);
  X.meta.counts.buildings = B.r.length;
  X.meta.layout = { v: 1, waterDrop: n0 - keep.length };
  fs.writeFileSync(outFile, JSON.stringify(X));
  log('context: gedung dekat air dibuang', n0 - keep.length, '→', outFile);
}

export function deriveProps(D, inFile, outFile, log) {
  const Pr = JSON.parse(fs.readFileSync(inFile, 'utf8')), B = D.buildings, ST = Pr.meta.stride || 6, st = {};
  const polys = B.r.map((r) => (r.length >= 6 ? toPts(r) : null)), BG = new Grid(40);
  polys.forEach((p, i) => { if (p) { const b = bbox(p); BG.add(i, b[0], b[1], b[2], b[3]); } });
  // sambungan rumah (kabel tiang → dinding): titik tempel mengikuti dinding yang terpangkas/tergeser; gedung hilang → dibuang
  const o = [0, 0, 0];
  let moved = 0, gone = 0;
  Pr.drops = (Pr.drops || []).filter((d) => {
    const x = d[1] * M, y = d[2] * M;
    let best = 5, bx = 0, by = 0;
    for (const bi of BG.query(x - 5, y - 5, x + 5, y + 5)) { const p = polys[bi]; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const dd = ptSeg(x, y, p[j][0], p[j][1], p[i][0], p[i][1], o); if (dd < best) { best = dd; bx = o[0]; by = o[1]; } } }
    if (best >= 5) { gone++; return false; }
    if (best > 0.15) { d[1] = Math.round(bx / M); d[2] = Math.round(by / M); moved++; }
    return true;
  });
  st.drops = { moved, gone };
  if (D.walls) Object.assign(st, gatesAndWalls(D, Pr, ST, polys, BG));
  // benda darat yang kini berada di dalam gedung (gedung tergeser) dibuang; tiang yang dipakai kabel dibiarkan (indeks kabel)
  const cabled = new Set(['sutet', 'pole']);
  let inB = 0;
  for (const [k, arr] of Object.entries(Pr.t)) {
    if (cabled.has(k)) continue;
    const out = [];
    for (let i = 0; i + ST - 1 < arr.length; i += ST) {
      const x = arr[i] * M, y = arr[i + 1] * M;
      let hit = false;
      if (arr[i + 4] < 5) for (const bi of BG.query(x, y, x, y)) if (B.k[bi] !== 5 && pip(x, y, polys[bi])) { hit = true; break; }
      if (hit) inB++; else out.push(...arr.slice(i, i + ST));
    }
    Pr.t[k] = out;
  }
  st.inBuilding = inB;
  for (const k of Object.keys(Pr.t)) Pr.meta.counts[k] = Pr.t[k].length / ST;
  Pr.meta.layout = { v: 1, ...st };
  fs.writeFileSync(outFile, JSON.stringify(Pr));
  log('props:', JSON.stringify(st), '→', outFile, (fs.statSync(outFile).size / 1024).toFixed(0) + ' KB');
}

// gerbang & tembok dari D.walls (tahap walls) → format siap-gambar; pos satpam & palang lama diganti per gerbang baru
function gatesAndWalls(D, Pr, ST, polys, BG) {
  const W = D.walls, oldNames = Pr.names || [];
  const wallNear = (x, y, r) => { for (const L of W.lines) for (let j = 0; j + 3 < L.p.length; j += 2) if (ptSeg(x, y, L.p[j] * M, L.p[j + 1] * M, L.p[j + 2] * M, L.p[j + 3] * M) < r) return true; return false; };
  // gapura lama: "Sutera Sitara" tetap sebagai hiasan boulevard (tanpa tembok sayap); The Gramercy + gapura ring kosong
  // dihapus; gapura lain yang jauh dari kompleks bertembok (apartemen) dibiarkan apa adanya; sisanya diganti gerbang baru
  const kept = [], dropped = [];
  for (const g of Pr.gates || []) {
    const nm = g.n >= 0 ? oldNames[g.n] : '', x = g.x * M, y = g.y * M;
    if (g.k !== undefined) continue; // sudah format baru (dijalankan ulang)
    if (WP.DECO.includes(nm)) kept.push({ ...g, wl: [], wr: [], deco: 1, name: nm });
    else if (WP.DROP_GATES.includes(nm) || wallNear(x, y, 60) || W.gates.some((q) => Math.hypot(q.x * M - x, q.y * M - y) < 60)) dropped.push(g);
    else kept.push({ ...g, name: nm });
  }
  const names = (Pr.names = []);
  const nearOld = (x, y) => dropped.some((g) => Math.hypot(g.x * M - x, g.y * M - y) < 16);
  let dropG = 0;
  for (const k of ['guard', 'boom']) { const arr = Pr.t[k] || [], out = []; for (let i = 0; i + ST - 1 < arr.length; i += ST) { if (nearOld(arr[i] * M, arr[i + 1] * M)) dropG++; else out.push(...arr.slice(i, i + ST)); } Pr.t[k] = out; }
  const nameOf = (nm) => { if (!nm) return -1; let k = names.indexOf(nm); if (k < 0 && names.length < 40) k = names.push(nm) - 1; return k; };
  const nameIdx = (ci) => (ci < 0 ? -1 : nameOf(D.clusters[ci].name));
  const blockedAt = (x, y, r) => { for (const bi of BG.query(x - r, y - r, x + r, y + r)) { const p = polys[bi]; if (pip(x, y, p)) return true; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (ptSeg(x, y, p[j][0], p[j][1], p[i][0], p[i][1]) < r) return true; } return false; };
  const roadsNear = (x, y, r, skip) => { for (let ri = 0; ri < D.roads.r.length; ri++) { if (ri === skip) continue; const R = D.roads.r[ri], hw = D.roads.w[ri] * M / 2; for (let j = 0; j + 3 < R.length; j += 2) if (ptSeg(x, y, R[j] * M, R[j + 1] * M, R[j + 2] * M, R[j + 3] * M) < hw + r) return true; } return false; };
  const ang = (dx, dy) => Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360) * 10);
  let guards = 0, booms = 0;
  Pr.gates = W.gates.map((g) => {
    const n = g.k === 0 ? nameIdx(g.ci) : -1, out = { x: g.x, y: g.y, a: g.a, w: g.w, h: g.h, n, k: g.k, c: g.c, wl: [], wr: [] };
    if (g.p) out.p = 1;
    if (g.k <= 1 && !g.deco) { // pos satpam (hanya gapura utama) & palang di sisi dalam
      const gx = g.x * M, gy = g.y * M, a = g.a / 10 * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, w = g.w * M;
      let side = 0;
      if (g.k === 0) for (const sd of [1, -1]) { for (const back of [5, 7, 9, 11.5]) { const x = gx + ux * back + nx * sd * (w / 2 + 2.1), y = gy + uy * back + ny * sd * (w / 2 + 2.1); if (!blockedAt(x, y, 2.0) && !roadsNear(x, y, 1.6, -1) && !wallNear(x, y, 1.9)) { Pr.t.guard.push(Math.round(x / M), Math.round(y / M), ang(-nx * sd, -ny * sd), 0, 0, 100); guards++; side = sd; break; } } if (side) break; }
      for (const sd of side ? [side] : [1, -1]) { const x = gx + ux * 2.4 + nx * sd * (w / 2 + 0.45), y = gy + uy * 2.4 + ny * sd * (w / 2 + 0.45); if (!blockedAt(x, y, 0.4)) { Pr.t.boom.push(Math.round(x / M), Math.round(y / M), ang(-nx * sd, -ny * sd), 0, 0, 100); booms++; break; } }
    }
    return out;
  });
  for (const g of kept) { const { name, ...o } = g; o.n = nameOf(name); Pr.gates.push(o); }
  Pr.walls = W.lines.map((L) => ({ p: L.p, t: L.t, e: L.e }));
  // benda yang menimpa tembok / bukaan gerbang dibuang (tiang berkabel dibiarkan: tembok dibangun mengalah di walls.mjs)
  let onWall = 0;
  const gateNear = (x, y) => W.gates.some((g) => Math.hypot(g.x * M - x, g.y * M - y) < (g.k === 3 ? 1.6 : g.h * M + 1.2));
  for (const [k, arr] of Object.entries(Pr.t)) {
    if (k === 'sutet' || k === 'pole' || k === 'guard' || k === 'boom') continue;
    const out = [];
    for (let i = 0; i + ST - 1 < arr.length; i += ST) { const x = arr[i] * M, y = arr[i + 1] * M; if (arr[i + 4] < 5 && (wallNear(x, y, 0.9) || gateNear(x, y))) onWall++; else out.push(...arr.slice(i, i + ST)); }
    Pr.t[k] = out;
  }
  return { gates: Pr.gates.length, gatesOldKept: kept.length, gatesOldDropped: dropped.length, guardBoomDropped: dropG, guards, booms, walls: Pr.walls.length, onWall, names: names.length };
}
