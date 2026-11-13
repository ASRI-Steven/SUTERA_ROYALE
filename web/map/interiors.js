// Gedung yang bisa dimasuki (game).
// - Rumah tapak (jenis 0): lantai dasar; rumah 2 lantai (tinggi ≥ 6,2 m, denah segi empat) juga punya lantai atas lewat
//   tangga lurus yang menempel dinding luar ruang tamu (lubang tangga berpagar di lantai atas).
// - Ruko (jenis 1, segi empat ≤ 3000 m²): deret unit selebar 5,2 m (sama dengan papan nama di shader), etalase depan
//   terbuka, sekat antarunit, isi toko (minimarket / kafe / toko).
// - Toko besar & mal (jenis 1 lainnya): aula dengan pintu masuk berkala di sisi yang menghadap jalan, kolom, rak, kios.
// planHomes(D): tata letak semua gedung dihitung sekali saat dimuat (deterministik). Dipakai collider (dinding tipis,
// bukaan, lantai & tangga, perabot), loot (barang di dalam), bot (tangga), dan pembuat mesh interior.
// createInteriors(scene, W, homes): mesh interior hanya untuk gedung dekat kamera; gedung yang "terbuka" ditandai ke shader
// gedung (world.js) supaya pintu, jendela, dan etalasenya benar-benar berlubang.
// Koordinat dinding sama dengan shader: u = jarak keliling dari titik pertama cincin CCW (m), v = tinggi.
import * as THREE from 'three';

export const HOUSE = { bay: 3.6, wx0: 0.3, fh: 3.3, wy0: 0.36, wy1: 0.78, doorW: 1.7, doorH: 2.2, wall: 0.2, gapW: 1.4, gapH: 2.1, floor2: 3.3, run: 4.4, stairW: 1.0 };
// bukaan berkala toko/aula (= shader world.js): di rentang sisi depan, berlubang bila mod(u, P) ∈ [p, P − p] dan v < top
const SHOP = { P: 5.2, p: 0.35, top: 3.0, ceil: 3.4 };
const HALL_BIG = { P: 24, p: 9, top: 3.6, ceil: 4.6, G: 10 }, HALL_SMALL = { P: 8, p: 2.2, top: 3.0, ceil: 3.4, G: 6.5 };
const R_OPEN = 85, R_CLOSE = 110, BUILD_PER_FRAME = 3;
const M = 0.1;
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const fract = (v) => v - Math.floor(v);
// jendela rumah di dinding luar (u, v) — rumus sama dengan shader world.js
export function houseWindow(u, v) {
  if (v <= 0.8) return false;
  const fx = fract(u / HOUSE.bay), fy = fract(v / HOUSE.fh);
  return fx >= HOUSE.wx0 && fx <= 1 - HOUSE.wx0 && fy >= HOUSE.wy0 && fy <= HOUSE.wy1;
}
function signedArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
function pip(x, y, p) { let ins = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const segDist = (p, a, b) => { const ex = b[0] - a[0], ey = b[1] - a[1], L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L)) : 0; return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t); };
function edgesOf(pts) {
  const edges = [];
  let per = 0;
  for (let j = 0; j < pts.length; j++) {
    const a = pts[j], b = pts[(j + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 0.05) continue; // sama dengan walls() di world.js
    const ux = dx / len, uy = dy / len;
    edges.push({ j, a, b, len, u0: per, ux, uy, nx: -uy, ny: ux }); // normal ke dalam (kiri arah CCW)
    per += len;
  }
  return edges;
}
const isRect = (E, tol) => E.length === 4 && E.every((e, j) => Math.abs(e.ux * E[(j + 1) % 4].ux + e.uy * E[(j + 1) % 4].uy) < tol);
// titik sisi e: s sepanjang sisi, v ke dalam
const onEdge = (e) => (s, v) => [e.a[0] + e.ux * s + e.nx * v, e.a[1] + e.uy * s + e.ny * v];

// ---------- Tata letak ----------
export function planHomes(D) {
  const B = D.buildings, homes = new Map();
  // ruas jalan per sel 50 m (untuk arah pintu depan)
  // jalan: "utama" = jalan perumahan ke atas (bukan jalan servis/gang belakang, tol, pejalan kaki) → arah pintu depan
  const MAIN = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street']);
  const RG = new Map(), RC = 50, rk = (cx, cy) => cx * 100003 + cy;
  D.roads.r.forEach((r, ri) => { const main = MAIN.has(D.classes[D.roads.c[ri]]), hw = D.roads.w[ri] * M / 2; for (let j = 0; j + 3 < r.length; j += 2) { const ax = r[j] * M, ay = r[j + 1] * M, bx = r[j + 2] * M, by = r[j + 3] * M, k = rk(Math.floor((ax + bx) / 2 / RC), Math.floor((ay + by) / 2 / RC)); (RG.get(k) || RG.set(k, []).get(k)).push([ax, ay, bx, by, main, hw]); } });
  // jarak ke tepi jalan terdekat (mainOnly: hanya jalan utama, dicari sampai ±100 m)
  const roadDist = (x, y, mainOnly = false) => {
    let best = 1e9;
    const cx = Math.floor(x / RC), cy = Math.floor(y / RC), R = mainOnly ? 2 : 1;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (const [ax, ay, bx, by, main, hw] of RG.get(rk(cx + dx, cy + dy)) || []) {
      if (mainOnly && !main) continue;
      const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0;
      best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t) - hw);
    }
    return best;
  };
  // petak gedung (50 m): titik (x, y) di dalam gedung lain?
  const BG = new Map(), bbox = [];
  for (let i = 0; i < B.r.length; i++) {
    const r = B.r[i];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < r.length; j += 2) { x0 = Math.min(x0, r[j] * M); y0 = Math.min(y0, r[j + 1] * M); x1 = Math.max(x1, r[j] * M); y1 = Math.max(y1, r[j + 1] * M); }
    bbox[i] = [x0, y0, x1, y1];
    for (let cx = Math.floor(x0 / RC); cx <= Math.floor(x1 / RC); cx++) for (let cy = Math.floor(y0 / RC); cy <= Math.floor(y1 / RC); cy++) { const k = rk(cx, cy); (BG.get(k) || BG.set(k, []).get(k)).push(i); }
  }
  const occupied = (x, y, self) => {
    for (const i of BG.get(rk(Math.floor(x / RC), Math.floor(y / RC))) || []) {
      if (i === self) continue;
      const b = bbox[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const r = B.r[i];
      let ins = false;
      for (let a = 0, c = r.length / 2 - 1; a < r.length / 2; c = a++) { const xi = r[2 * a] * M, yi = r[2 * a + 1] * M, xj = r[2 * c] * M, yj = r[2 * c + 1] * M; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
      if (ins) return true;
    }
    return false;
  };
  const site = { roadDist, occupied };
  for (let i = 0; i < B.r.length; i++) {
    const kind = B.k[i];
    if (kind !== 0 && kind !== 1) continue;
    const flat = B.r[i], n = flat.length >> 1;
    if (n < 4 || (kind === 0 && n > 12)) continue;
    const pts = [];
    for (let j = 0; j < n; j++) pts.push([flat[2 * j] * M, flat[2 * j + 1] * M]);
    if (signedArea(pts) < 0) pts.reverse(); // sama dengan world.js (CCW)
    const area = Math.abs(signedArea(pts)), h = B.h[i] * M;
    const H = kind === 0 ? planHouse(i, pts, area, h, site) : planShop(i, pts, area, h, roadDist);
    if (H) { H.blind = (D.blind && D.blind.get(i)) || null; homes.set(i, H); } // sisi tanpa jendela (menempel gedung lain, world.js)
  }
  return homes;
}

function planHouse(i, pts, area, h, { roadDist, occupied }) {
  if (area < 35 || area > 700 || h < 3.2) return null;
  const H = { i, pts, h, area, ceil: Math.min(3.0, h - 0.35), edges: edgesOf(pts), doors: [], parts: [], rooms: [], furn: [] };
  // sekat (rumah segi empat): potong sumbu panjang, rumah besar dibagi lagi
  const R = hash(pts[0][0], pts[0][1]);
  if (pts.length === 4 && area >= 60) {
    let q = pts;
    const l01 = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), l12 = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
    if (l12 > l01) q = [q[1], q[2], q[3], q[0]];
    const t1 = 0.42 + R * 0.16, A = lerp2(q[0], q[1], t1), Bp = lerp2(q[3], q[2], t1);
    const lenAB = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
    if (lenAB >= 2.6) {
      const g = (0.3 + hash(R, 7) * 0.4) * (lenAB - HOUSE.gapW);
      H.parts.push({ a: A, b: Bp, len: lenAB, g0: g, g1: g + HOUSE.gapW });
      if (area >= 140) {
        const C = lerp2(A, Bp, 0.5), Dp = lerp2(q[1], q[2], 0.5), lenCD = Math.hypot(Dp[0] - C[0], Dp[1] - C[1]);
        if (lenCD >= 2.6) { const g2 = 0.25 * (lenCD - HOUSE.gapW); H.parts.push({ a: C, b: Dp, len: lenCD, g0: g2, g1: g2 + HOUSE.gapW }); H.rooms.push([q[0], A, Bp, q[3]], [A, q[1], Dp, C], [C, Dp, q[2], Bp]); }
        else H.rooms.push([q[0], A, Bp, q[3]], [A, q[1], q[2], Bp]);
      } else H.rooms.push([q[0], A, Bp, q[3]], [A, q[1], q[2], Bp]);
    } else H.rooms.push(pts);
  } else H.rooms.push(pts);
  // pintu depan: sisi terdekat jalan utama (bukan gang servis di belakang), di luarnya tidak ada gedung lain;
  // pintu belakang: sisi yang paling berlawanan (atau samping) yang di luarnya juga kosong
  const cand = H.edges.filter((e) => e.len >= 2.6).map((e) => { const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2, dm = roadDist(mx, my, true); return { e, d: dm < 1e8 ? dm : roadDist(mx, my) + 500 }; }).sort((p, q2) => p.d - q2.d);
  const placeDoor = (e) => {
    for (let k = 0; k < 7; k++) {
      const t = 0.3 + hash(i + k * 3.1, e.u0) * 0.4, s = t * e.len, s0 = s - HOUSE.doorW / 2, s1 = s + HOUSE.doorW / 2;
      if (s0 < 0.45 || s1 > e.len - 0.45) continue;
      const px = e.a[0] + e.ux * s, py = e.a[1] + e.uy * s;
      if (H.parts.some((p) => Math.hypot(p.a[0] - px, p.a[1] - py) < 1.2 || Math.hypot(p.b[0] - px, p.b[1] - py) < 1.2)) continue;
      if (occupied(px - e.nx * 1.0, py - e.ny * 1.0, i) || occupied(px - e.nx * 2.0, py - e.ny * 2.0, i)) continue; // di luar pintu harus kosong
      return { e, s0, s1, u0: e.u0 + s0, u1: e.u0 + s1, x: px, y: py };
    }
    return null;
  };
  let d1 = null;
  for (const c of cand) { d1 = placeDoor(c.e); if (d1) break; }
  if (!d1) return null; // tidak ada sisi yang bisa diberi pintu → tetap padat
  H.doors.push(d1);
  if (area >= 45) {
    const dot = (e) => e.ux * d1.e.ux + e.uy * d1.e.uy;
    for (const c of cand.filter((c2) => c2.e !== d1.e && dot(c2.e) < 0.5).sort((p, q2) => dot(p.e) - dot(q2.e))) { const d2 = placeDoor(c.e); if (d2) { H.doors.push(d2); break; } }
  }
  const types = roomTypes(H);
  H.rooms.forEach((r, k) => { r.type = types[k]; });
  const li = types.indexOf('living');
  for (const ri of [li, ...H.rooms.keys()]) { if (ri >= 0 && !H.up) planUpper(H, ri); } // tangga dulu (prioritas), kamar mandi menyesuaikan
  planBath(H, types);
  planPorch(H, d1, roadDist, occupied);
  H.furn = furnish(H, H.rooms, types, H.avoid || [], 0);
  if (H.bath) H.furn.push(...H.bath.fix);
  if (H.up) { H.up.furn = furnish(H, H.rooms, H.up.types, H.up.avoid, 1); if (H.bath) H.up.furn.push(...H.bath.fix); }
  return H;
}
// kamar mandi 2 × 1,7 m di pojok rumah (dapur dulu, lalu kamar): sekat L dengan pintu 0,9 m; shower di pojok, kloset & wastafel
// menempel dinding luar. Sekat ikut H.parts (lantai atas mendapat kamar mandi di posisi yang sama).
function planBath(H, types) {
  if (H.area < 80 || H.rooms.length < 2) return;
  const T = HOUSE.wall;
  const gaps = H.parts.map((p) => lerp2(p.a, p.b, (p.g0 + p.g1) / 2 / p.len));
  const order = H.rooms.map((r, k) => k).filter((k) => types[k] !== 'living').sort((p, q) => (types[p] === 'kitchen' ? 0 : 1) - (types[q] === 'kitchen' ? 0 : 1));
  for (const ri of order) {
    const room = H.rooms[ri], n = room.length;
    for (let j = 0; j < n; j++) {
      const C = room[j];
      if (!H.pts.some((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < 0.05)) continue; // harus pojok rumah (dua sisi dinding luar)
      const P1 = room[(j + 1) % n], P2 = room[(j + n - 1) % n], la = Math.hypot(P1[0] - C[0], P1[1] - C[1]), lb = Math.hypot(P2[0] - C[0], P2[1] - C[1]);
      const a = [(P1[0] - C[0]) / la, (P1[1] - C[1]) / la], b = [(P2[0] - C[0]) / lb, (P2[1] - C[1]) / lb];
      if (Math.abs(a[0] * b[0] + a[1] * b[1]) > 0.1) continue;
      const Q = (s, t) => [C[0] + a[0] * s + b[0] * t, C[1] + a[1] * s + b[1] * t];
      for (const [wa, wb] of [[2.0, 1.7], [1.7, 2.0]]) {
        if (la < T + wa + 1.4 || lb < T + wb + 1.4) continue;
        const cen = Q(T + wa / 2, T + wb / 2), R = Math.max(wa, wb) / 2 + 1.3;
        if (!pip(...Q(T + wa + 1.0, T + wb + 1.0), room) || !pip(...Q(T + wa + 0.3, T + wb + 0.3), room)) continue;
        if (H.doors.some((d) => Math.hypot(d.x - cen[0], d.y - cen[1]) < R + 0.3)) continue;
        if (gaps.some((g) => Math.hypot(g[0] - cen[0], g[1] - cen[1]) < R)) continue;
        const big = [Q(-0.3, -0.3), Q(T + wa + 0.6, -0.3), Q(T + wa + 0.6, T + wb + 0.6), Q(-0.3, T + wb + 0.6)];
        if (H.up) { const S = H.up.stair, pts = [S.ap, S.land]; for (let s = 0; s <= S.len; s += 0.55) pts.push([S.ax + S.ux * s, S.ay + S.uy * s]); if (pts.some((q) => pip(q[0], q[1], big))) continue; } // jangan menimpa tangga
        const g0 = Math.max(0.75, wa - 1.0), g1 = Math.min(wa - 0.05, g0 + 0.9);
        const pa = { a: Q(T + wa, T), b: Q(T + wa, T + wb + 0.06), len: wb + 0.06, g0: 0, g1: 0 }; // dinding sejajar b (penuh)
        const pb = { a: Q(T, T + wb), b: Q(T + wa + 0.06, T + wb), len: wa + 0.06, g0, g1 };   // dinding sejajar a, berpintu
        H.parts.push(pa, pb);
        const rotA = Math.atan2(a[1], a[0]), rotB = Math.atan2(b[1], b[0]), fix = [];
        const at = (s, t, kind, rot, w, d, h) => { const p = Q(s, t); fix.push({ kind, x: p[0], y: p[1], rot, w, d, h }); };
        at(T + 0.48, T + 0.48, 'shower', rotA, 0.92, 0.92, 2.0);
        at(T + wa - 0.3, T + 0.34, 'toilet', rotA, 0.42, 0.66, 0.75);
        at(T + 0.24, T + wb - 0.45, 'sink', rotB, 0.6, 0.46, 0.85);
        const door = Q(T + (g0 + g1) / 2, T + wb + 0.8);
        H.bath = {
          poly: [Q(T, T), Q(T + wa, T), Q(T + wa, T + wb), Q(T, T + wb)], big: [Q(0, 0), Q(T + wa + 0.3, 0), Q(T + wa + 0.3, T + wb + 0.3), Q(0, T + wb + 0.3)], room: ri, fix,
          avoid: [{ x: cen[0], y: cen[1], r: Math.hypot(wa, wb) / 2 + 0.25 }, { x: door[0], y: door[1], r: 0.8 }],
        };
        H.avoid = [...(H.avoid || []), ...H.bath.avoid];
        if (H.up) H.up.avoid.push(...H.bath.avoid);
        return;
      }
    }
  }
}
// teras di depan pintu depan: lantai 15 cm, dua tiang, kanopi; hanya bila halaman depan kosong (bukan jalan / gedung lain)
function planPorch(H, d, roadDist, occupied) {
  const e = d.e, P = onEdge(e), sc = (d.s0 + d.s1) / 2, W = Math.min(3.6, e.len - 0.6);
  if (W < 2.4) return;
  const s0 = Math.max(0.3, Math.min(e.len - 0.3 - W, sc - W / 2)), s1 = s0 + W;
  for (const D of [2.0, 1.4]) {
    const pts = [P(s0, 0), P(s1, 0), P(s1, -D), P(s0, -D)];
    const probe = [pts[2], pts[3], P((s0 + s1) / 2, -D), P(s0, -D / 2), P(s1, -D / 2), P((s0 + s1) / 2, -D - 0.6)];
    if (probe.some((q) => occupied(q[0], q[1], H.i) || roadDist(q[0], q[1]) < 0.8)) continue;
    H.porch = { e, s0, s1, D, pts, h: 2.7 };
    return;
  }
}
// jenis ruang: yang berisi pintu depan = ruang tamu; sisanya kamar / dapur
function roomTypes(H) {
  const R = (k) => hash(H.i * 1.7 + k, H.pts[0][0]);
  const front = H.doors[0];
  const types = H.rooms.map((r) => (pip(front.x + front.e.nx * 1.0, front.y + front.e.ny * 1.0, r) ? 'living' : null));
  if (!types.includes('living')) types[0] = 'living';
  let kitchen = false;
  types.forEach((t, k) => { if (!t) { types[k] = !kitchen && (H.rooms.length < 3 || R(k) < 0.5) ? (kitchen = true, 'kitchen') : 'bedroom'; } });
  return types;
}
// lantai 2: tangga lurus menempel dinding luar di ruang tamu (pendekatan & pendaratan di ruang yang sama, jauh dari pintu
// dan celah sekat). Pelat lantai 2 = denah dikurangi lubang tangga (3 potong yang pas dengan dinding).
function planUpper(H, li) {
  if (H.h < 6.2 || li < 0 || !isRect(H.edges, 0.1)) return;
  const room = H.rooms[li], T = HOUSE.wall, SW = HOUSE.stairW, RUN = HOUSE.run, F = HOUSE.floor2, VM = T + SW / 2;
  const gaps = H.parts.map((p) => lerp2(p.a, p.b, (p.g0 + p.g1) / 2 / p.len));
  const inR = (p) => pip(p[0], p[1], room);
  const order = [0, 1, 2, 3].sort((p, q) => hash(H.i, p * 7.3) - hash(H.i, q * 7.3));
  for (const k of order) {
    const e = H.edges[k], nxt = H.edges[(k + 1) % 4], prv = H.edges[(k + 3) % 4], P = onEdge(e);
    if (e.len < RUN + 2 * (T + 1.3) || Math.min(nxt.len, prv.len) < T + SW + 2.4) continue;
    const q0 = e.a, q1 = e.b, q2 = nxt.b, q3 = prv.a;
    const Fp = (s) => lerp2(q3, q2, s / e.len); // titik di sisi seberang
    const Q = (s, v) => { const a = P(s, 0), b = Fp(s), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return lerp2(a, b, Math.min(1, v / L)); };
    for (let t = 0; t < 12; t++) {
      const lo = T + 1.3 + (t < 3 ? [0.02, 0.5, 0.98][t] : hash(H.i + t * 2.3, e.u0 + k)) * (e.len - RUN - 2 * (T + 1.3)), hi = lo + RUN; // ujung-ujung sisi dulu, lalu acak
      for (const dir of hash(H.i, t + 0.5) < 0.5 ? [1, -1] : [-1, 1]) {
        const bot = dir > 0 ? lo : hi, top = dir > 0 ? hi : lo;
        const ap = P(bot - dir * 0.9, VM), land = P(top + dir * 0.9, VM);
        if (![P(lo + 0.05, T + 0.05), P(hi - 0.05, T + 0.05), P(hi - 0.05, T + SW - 0.05), P(lo + 0.05, T + SW - 0.05)].every(inR)) continue;
        if (!inR(ap) || !inR(land) || !inR(P(bot - dir * 1.4, VM)) || !inR(P(top + dir * 1.4, VM))) continue;
        if (H.doors.some((d) => (d.e === e && d.s1 > lo - 0.8 && d.s0 < hi + 0.8) || Math.hypot(d.x - ap[0], d.y - ap[1]) < 1.3 || Math.hypot(d.x - land[0], d.y - land[1]) < 1.3)) continue;
        if (gaps.some((g) => Math.hypot(g[0] - ap[0], g[1] - ap[1]) < 1.4 || Math.hypot(g[0] - land[0], g[1] - land[1]) < 1.4 || segDist(g, P(lo, VM), P(hi, VM)) < 1.3)) continue;
        if (H.parts.some((p) => segDist(ap, p.a, p.b) < 0.6 || segDist(land, p.a, p.b) < 0.6)) continue;
        if (H.bath && [ap, land, P(lo, VM), P((lo + hi) / 2, VM), P(hi, VM)].some((q) => pip(q[0], q[1], H.bath.big))) continue; // jangan menimpa kamar mandi
        const plate = [[q0, P(lo, 0), Fp(lo), q3], [P(hi, 0), q1, q2, Fp(hi)], [Q(lo, T + SW), Q(hi, T + SW), Fp(hi), Fp(lo)]];
        const rail = [[Q(lo, T + SW), Q(hi, T + SW), Q(hi, T + SW + 0.1), Q(lo, T + SW + 0.1)]];
        rail.push(dir > 0 ? [P(lo - 0.1, T), P(lo, T), P(lo, T + SW + 0.1), P(lo - 0.1, T + SW + 0.1)] : [P(hi, T), P(hi + 0.1, T), P(hi + 0.1, T + SW + 0.1), P(hi, T + SW + 0.1)]);
        const bp = P(bot, VM), ring = [];
        for (let s = lo + 0.4; s < hi; s += 0.8) { const c = P(s, VM); ring.push({ x: c[0], y: c[1], r: 0.75 }); }
        H.up = {
          floor: F, ceil: Math.min(H.h - 0.25, 6.4), plate, rail,
          stair: { rect: [P(lo, T), P(hi, T), Q(hi, T + SW), Q(lo, T + SW)], ax: bp[0], ay: bp[1], ux: e.ux * dir, uy: e.uy * dir, len: RUN, h1: F, e, lo, hi, dir, ap, land },
          types: H.rooms.map((r, ri) => (ri === li ? 'hall' : 'bedroom')),
          avoid: [...ring, { x: land[0], y: land[1], r: 1.0 }],
          furn: [],
        };
        H.avoid = [...(H.avoid || []), ...ring, { x: ap[0], y: ap[1], r: 1.0 }];
        return;
      }
    }
  }
}

// ruko & aula: bukaan berkala di sisi depan (dekat jalan), lalu unit / isi aula
function planShop(i, pts, area, h, roadDist) {
  if (area < 60 || pts.length > 160) return null;
  const edges = edgesOf(pts), longest = Math.max(...edges.map((e) => e.len));
  const ruko = isRect(edges, 0.06) && area <= 3000 && Math.min(edges[0].len, edges[1].len) >= 6;
  const L = ruko ? SHOP : area > 3000 ? HALL_BIG : HALL_SMALL;
  if (h < L.ceil + 0.6) return null;
  const H = { i, kind: ruko ? 'shop' : 'hall', pts, h, area, ceil: L.ceil, edges, doors: [], parts: [], rooms: [], furn: [], open: null };
  const ed = edges.map((e) => roadDist((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2)), per = edges.reduce((s, e) => s + e.len, 0);
  const ranges = [], used = new Set();
  const opsIn = (U0, U1) => { const ops = []; for (let k = Math.floor(U0 / L.P); k * L.P < U1; k++) { const a = k * L.P + L.p, b = (k + 1) * L.P - L.p; if (a >= U0 && b <= U1) ops.push([a, b]); } return ops; };
  if (ruko) { // satu sisi panjang terdekat jalan
    const k = edges.map((e, j) => j).filter((j) => edges[j].len >= longest * 0.6).sort((p, q) => ed[p] - ed[q])[0];
    const ops = opsIn(edges[k].u0 + 0.4, edges[k].u0 + edges[k].len - 0.4);
    if (ops.length) ranges.push({ k0: k, k1: k, ops });
  } else for (let t = 0; t < 2; t++) { // aula: sisi-sisi berurutan yang menghadap jalan (tanpa melewati titik awal cincin)
    let k0 = -1;
    edges.forEach((e, k) => { if (!used.has(k) && e.len >= 2 && ed[k] < 45 && (k0 < 0 || ed[k] < ed[k0])) k0 = k; });
    if (k0 < 0) break;
    let a = k0, b = k0, len = edges[k0].len;
    const ok = (k) => k >= 0 && k < edges.length && !used.has(k) && ed[k] < 45;
    while (len < per * 0.45) {
      if (ok(a - 1) && (!ok(b + 1) || ed[a - 1] <= ed[b + 1])) len += edges[--a].len;
      else if (ok(b + 1)) len += edges[++b].len;
      else break;
    }
    for (let k = a; k <= b; k++) used.add(k);
    const ops = opsIn(edges[a].u0 + 0.5, edges[b].u0 + edges[b].len - 0.5);
    if (ops.length) ranges.push({ k0: a, k1: b, ops });
  }
  if (!ranges.length) return null;
  ranges.sort((p, q) => p.ops[0][0] - q.ops[0][0]);
  for (const r of ranges) { r.A = r.ops[0][0]; r.B = r.ops[r.ops.length - 1][1]; r.e = edges[r.k0]; }
  for (const r of ranges) for (const [a, b] of r.ops) for (let k = r.k0; k <= r.k1; k++) { // bukaan bisa melewati sudut → potong per sisi
    const e = edges[k], s0 = Math.max(a, e.u0) - e.u0, s1 = Math.min(b, e.u0 + e.len) - e.u0;
    if (s1 - s0 < 0.02) continue;
    const sm = (s0 + s1) / 2;
    H.doors.push({ e, s0, s1, u0: e.u0 + s0, u1: e.u0 + s1, h: L.top, x: e.a[0] + e.ux * sm, y: e.a[1] + e.uy * sm });
  }
  H.open = { A: [ranges[0].A, ranges[0].B], B: ranges[1] ? [ranges[1].A, ranges[1].B] : [-9, -9], P: L.P, p: L.p, top: L.top };
  // kanopi: ruko = satu kanopi menerus sepanjang deret bukaan; aula = kanopi bertiang di tiap pintu masuk (per sisi)
  H.canopies = [];
  if (ruko) { const r = ranges[0], e = edges[r.k0]; H.canopies.push({ e, s0: Math.max(0.1, r.A - e.u0 - 0.4), s1: Math.min(e.len - 0.1, r.B - e.u0 + 0.4), d: 1.5, z: L.top + 0.12, cols: false }); }
  else for (const d of H.doors) if (d.s1 - d.s0 > 3) H.canopies.push({ e: d.e, s0: Math.max(0.1, d.s0 - 1.2), s1: Math.min(d.e.len - 0.1, d.s1 + 1.2), d: 3.0, z: L.top + 0.35, cols: true });
  if (ruko) planUnits(H, ranges[0]); else planHall(H, L);
  return H;
}
function planUnits(H, r) {
  const e = r.e, k = H.edges.indexOf(e), nxt = H.edges[(k + 1) % 4], prv = H.edges[(k + 3) % 4], T = HOUSE.wall, P = onEdge(e);
  const q3 = prv.a, q2 = nxt.b, Lv = Math.min(nxt.len, prv.len);
  const Fp = (s) => lerp2(q3, q2, s / e.len);
  // batas unit = tengah tiang antar bukaan (kelipatan P global, sama dengan papan nama di shader) + ujung sisi
  const bounds = [0];
  for (let j = 1; j < r.ops.length; j++) bounds.push((r.ops[j][0] + r.ops[j - 1][1]) / 2 - e.u0);
  bounds.push(e.len);
  for (let j = 1; j < bounds.length - 1; j++) {
    const s = bounds[j], a0 = P(s, 0), b0 = Fp(s), Ls = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    const a = lerp2(a0, b0, T / Ls), b = lerp2(a0, b0, 1 - T / Ls);
    H.parts.push({ a, b, len: Ls - 2 * T, g0: 0, g1: 0 });
  }
  for (let j = 0; j + 1 < bounds.length; j++) {
    const room = [P(bounds[j], 0), P(bounds[j + 1], 0), Fp(bounds[j + 1]), Fp(bounds[j])];
    room.type = 'shop';
    H.rooms.push(room);
    furnishUnit(H, e, bounds[j], bounds[j + 1], Lv, j);
  }
}
function furnishUnit(H, e, sA, sB, Lv, j) {
  const T = HOUSE.wall, W = sB - sA, sm = (sA + sB) / 2, r = hash(H.i + j * 3.7, e.u0), P = onEdge(e);
  const rotE = Math.atan2(e.uy, e.ux), rotN = Math.atan2(e.ny, e.nx);
  const add = (kind, s, v, rot, w, d, h) => { const p = P(s, v); H.furn.push({ kind, x: p[0], y: p[1], rot, w, d, h }); };
  const offL = sA < 0.01 ? T : 0.06, offR = sB > e.len - 0.01 ? T : 0.06;
  const v0 = 3.4, v1 = Lv - T - 1.4, len = v1 - v0; // zona rak: di belakang area kasir, sebelum dinding belakang
  const type = W < 3.2 ? 'cafe' : r < 0.4 ? 'mart' : r < 0.7 ? 'cafe' : 'toko';
  if (type === 'cafe') {
    add('bar', sm, Lv - T - 0.45, rotE + Math.PI, Math.min(W - 1.0, 3.2), 0.6, 1.05);
    for (let v = 2.4; v < Lv - T - 2.4; v += 2.7) add('table', sm, v, rotE, 1.2, 0.8, 0.75);
    return;
  }
  if (len > 1.5) { add('rack', sA + offL + 0.24, (v0 + v1) / 2, rotN, len, 0.45, 1.9); add('rack', sB - offR - 0.24, (v0 + v1) / 2, rotN, len, 0.45, 1.9); }
  add('cashier', sA + offL + 0.7, 2.0, rotE, 1.2, 0.6, 1.0);
  if (type === 'mart') {
    if (len > 1.5 && W > 3.6) add('gondola', sm, (v0 + v1) / 2, rotN, len, 0.9, 1.75);
    add('fridge2', sm, Lv - T - 0.4, rotE + Math.PI, Math.min(W - 1.0, 3.0), 0.7, 2.0);
  } else {
    if (len > 1.5 && W > 3.6) add('display', sm, (v0 + v1) / 2, rotN, Math.min(len, 2.4), 0.9, 0.9);
    add('bar', sm, Lv - T - 0.45, rotE + Math.PI, Math.min(W - 1.2, 2.6), 0.6, 1.0);
  }
}
// aula: kolom di grid (aula besar), isi per sel: rak supermarket, kios, meja kafe, taman kecil + bangku, atau kosong
function planHall(H, L) {
  H.rooms.push(H.pts);
  H.pts.type = 'hall';
  const e0 = H.edges.reduce((a, b) => (b.len > a.len ? b : a));
  const ux = e0.ux, uy = e0.uy, nx = e0.nx, ny = e0.ny, ox = e0.a[0], oy = e0.a[1];
  const W = (s, v) => [ox + ux * s + nx * v, oy + uy * s + ny * v];
  let s0 = Infinity, s1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of H.pts) { const s = (p[0] - ox) * ux + (p[1] - oy) * uy, v = (p[0] - ox) * nx + (p[1] - oy) * ny; s0 = Math.min(s0, s); s1 = Math.max(s1, s); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const rot = Math.atan2(uy, ux), G = L.G, big = L === HALL_BIG;
  const ents = H.doors.map((d) => [d.x + d.e.nx * 3, d.y + d.e.ny * 3]);
  const edgeD = (p) => { let m = Infinity; for (const e of H.edges) m = Math.min(m, segDist(p, e.a, e.b)); return m; };
  const inside = (p, m) => pip(p[0], p[1], H.pts) && edgeD(p) > m;
  const nearEnt = (p, r) => ents.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < r);
  const add = (kind, p, w, d, h) => H.furn.push({ kind, x: p[0], y: p[1], rot, w, d, h });
  for (let s = Math.floor(s0 / G) * G; s <= s1; s += G) for (let v = Math.floor(v0 / G) * G; v <= v1; v += G) {
    const c = W(s, v);
    if (big && inside(c, 1.6) && !nearEnt(c, 4)) add('column', c, 0.7, 0.7, H.ceil);
    const sc = s + G / 2, vc = v + G / 2, m = W(sc, vc), r = hash(m[0] * 0.37, m[1] * 0.71);
    if (!inside(m, 2.4) || nearEnt(m, G * 0.8)) continue;
    H.lights = H.lights || [];
    H.lights.push(m);
    const room = inside(m, G * 0.45);
    if (r < 0.36 && room) { for (const o of [-1.4, 1.4]) add('gondola', W(sc, vc + o), G - 3.4, 0.9, 1.75); }
    else if (r < 0.52) add('kiosk', m, 2.4, 2.4, 1.15);
    else if (r < 0.66 && inside(m, 2.8)) { add('table', W(sc - G * 0.22, vc), 1.2, 0.8, 0.75); add('table', W(sc + G * 0.22, vc), 1.2, 0.8, 0.75); }
    else if (r < 0.76 && inside(m, 2.8)) { add('planter', m, 1.6, 1.6, 0.8); add('bench', W(sc, vc + 1.6), 1.8, 0.5, 0.45); add('bench', W(sc, vc - 1.6), 1.8, 0.5, 0.45); }
  }
}

// ---------- Perabot rumah ----------
const ITEMS = {
  sofa: [2.0, 0.85, 0.82], coffee: [1.0, 0.55, 0.42], tv: [1.6, 0.45, 0.55], shelf: [1.0, 0.36, 1.8], plant: [0.45, 0.45, 1.1],
  bed: [1.6, 2.0, 0.55], wardrobe: [1.2, 0.6, 2.0], side: [0.45, 0.45, 0.5], desk: [1.2, 0.6, 0.75],
  counter: [2.2, 0.6, 0.9], fridge: [0.7, 0.7, 1.8], table: [1.4, 0.85, 0.75],
};
const LIST = { living: ['sofa', 'tv', 'coffee', 'shelf', 'plant'], bedroom: ['bed', 'wardrobe', 'side', 'desk'], kitchen: ['counter', 'fridge', 'table'], hall: ['shelf', 'plant', 'side'] };
// avoid: lingkaran {x, y, r} yang harus kosong (tangga, pendekatan, pendaratan); seed: variasi per lantai
function furnish(H, rooms, types, avoid, seed) {
  const R = (k) => hash(H.i * 1.7 + k + seed * 101.3, H.pts[0][0]);
  const placed = [];
  rooms.forEach((room, ri) => {
    const edges = [];
    for (let j = 0; j < room.length; j++) {
      const a = room[j], b = room[(j + 1) % room.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len > 1.2) edges.push({ a, b, len, ux: dx / len, uy: dy / len, nx: -dy / len, ny: dx / len });
    }
    let k = 0;
    for (const kind of LIST[types[ri]]) {
      if (kind === 'coffee') { // di depan sofa
        const sofa = placed.find((p) => p.kind === 'sofa' && p.room === ri);
        if (sofa) { const x = sofa.x + sofa.nx * 1.15, y = sofa.y + sofa.ny * 1.15; if (pip(x, y, room) && !hits(x, y, 0.6)) placed.push({ kind, x, y, rot: sofa.rot, w: ITEMS.coffee[0], d: ITEMS.coffee[1], h: ITEMS.coffee[2], room: ri, nx: sofa.nx, ny: sofa.ny }); }
        continue;
      }
      if (kind === 'table') { // meja makan di tengah ruang
        const cx = room.reduce((s, p) => s + p[0], 0) / room.length, cy = room.reduce((s, p) => s + p[1], 0) / room.length, e0 = edges[0];
        if (e0 && !hits(cx, cy, 1.1)) placed.push({ kind, x: cx, y: cy, rot: Math.atan2(e0.uy, e0.ux), w: ITEMS.table[0], d: ITEMS.table[1], h: ITEMS.table[2], room: ri, nx: e0.nx, ny: e0.ny });
        continue;
      }
      const [w, d, h] = ITEMS[kind];
      let ok = false;
      for (let tries = 0; tries < 10 && !ok; tries++) {
        const e = edges[(k + tries) % Math.max(1, edges.length)];
        k++;
        if (!e || e.len < w + 0.5) continue;
        const s = 0.25 + w / 2 + R(tries * 13 + k) * (e.len - w - 0.5);
        const bx = e.a[0] + e.ux * s, by = e.a[1] + e.uy * s;
        const off = d / 2 + HOUSE.wall + 0.03;
        const x = bx + e.nx * off, y = by + e.ny * off;
        if (!pip(x, y, room)) continue;
        // jauh dari pintu & ambang pintu
        if (H.doors.some((dr) => Math.hypot(dr.x - bx, dr.y - by) < w / 2 + 1.1)) continue;
        if (H.parts.some((p) => { const gx = p.a[0] + (p.b[0] - p.a[0]) * ((p.g0 + p.g1) / 2 / p.len), gy = p.a[1] + (p.b[1] - p.a[1]) * ((p.g0 + p.g1) / 2 / p.len); return Math.hypot(gx - x, gy - y) < Math.max(w, d) / 2 + 1.0; })) continue;
        // perabot tinggi tidak menutup jendela (dinding luar)
        if (h > 1.1) {
          const ext = H.edges.find((E) => Math.abs((bx - E.a[0]) * E.nx + (by - E.a[1]) * E.ny) < 0.3 && (bx - E.a[0]) * E.ux + (by - E.a[1]) * E.uy > -0.1 && (bx - E.a[0]) * E.ux + (by - E.a[1]) * E.uy < E.len + 0.1);
          if (ext) { const u = ext.u0 + (bx - ext.a[0]) * ext.ux + (by - ext.a[1]) * ext.uy; let blockWin = false; for (let du = -w / 2; du <= w / 2; du += 0.25) if (houseWindow(u + du, 1.6)) blockWin = true; if (blockWin) continue; }
        }
        if (hits(x, y, Math.max(w, d) / 2 + 0.15)) continue;
        placed.push({ kind, x, y, rot: Math.atan2(e.uy, e.ux), w, d, h, room: ri, nx: e.nx, ny: e.ny });
        ok = true;
      }
    }
  });
  function hits(x, y, r) { return placed.some((p) => Math.hypot(p.x - x, p.y - y) < r + Math.max(p.w, p.d) / 2) || avoid.some((c) => Math.hypot(c.x - x, c.y - y) < r + c.r); }
  for (const p of placed.slice()) { // karpet (tidak menghalangi)
    if (p.kind === 'sofa') placed.push({ kind: 'rug', x: p.x + p.nx * 1.1, y: p.y + p.ny * 1.1, rot: p.rot, w: 2.3, d: 1.6, h: 0.012, room: p.room });
    if (p.kind === 'bed') placed.push({ kind: 'rug', x: p.x + p.nx * (p.d / 2 + 0.55), y: p.y + p.ny * (p.d / 2 + 0.55), rot: p.rot, w: 1.9, d: 0.9, h: 0.012, room: p.room });
  }
  return placed;
}
// sudut-sudut kotak perabot (data, m) untuk collider
export function furnitureRect(f) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot), hw = f.w / 2, hd = f.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [f.x + a * c - b * s, f.y + a * s + b * c]);
}

// ---------- Mesh interior ----------
const COL = {
  wall: ['#efe8dc', '#e8e0f0', '#e3ecdf', '#f2e6d6', '#dfe8ee'], floor: { living: '#d9c7a7', bedroom: '#a87f58', kitchen: '#c9ccd0' }, ceil: '#f4f1ea', jamb: '#cfc6b6',
  sofa: ['#5b6b8c', '#7a5a4a', '#4f6b5a', '#8a7a64'], wood: '#8a6440', dark: '#2c2f36', white: '#e9e9ec', bed: '#f1efe9', pillow: '#d8d4ea', metal: '#b8bcc4', plant: '#3f7a3a', pot: '#a0644a', door: '#7a5232',
  upFloor: '#a3784e', step: '#b98e5e', step2: '#a98050', rail: '#f1efe9', slab: '#e6e1d8',
  room: { living: '#f0e6d4', kitchen: '#eef0ec', bath: '#d3e5ee', hall: '#ece4d6', bedroom: ['#e6e0f2', '#dcece3', '#f3e1d6', '#dce8f2'] }, base: '#6b5039', bathFloor: '#c9dce6',
  curtain: ['#b5483d', '#3f5f8a', '#c79a4a', '#5b7a52', '#8a5a7a'], art: ['#d8453a', '#f0b429', '#3f7fd6', '#3aa36b', '#8e5bd6', '#2d9cdb', '#e67e22'], porch: '#d9cfbf', porchRoof: ['#4b4e55', '#a2563d', '#7a5a46', '#5d6a7a'],
  tile: '#e2dfd8', tile2: '#cbbfab', shopWall: ['#f4f2ee', '#eef2f4', '#f6efe6'], hallWall: '#efece6',
  goods: ['#d8453a', '#f0b429', '#3f7fd6', '#3aa36b', '#f08a3c', '#8e5bd6', '#ececec', '#2d9cdb'],
  shelf: '#d9dce2', column: '#e4dccd', kiosk: '#3D3782', gold: '#D29F52', fridge: '#e9eef2', glass: '#9fc7e6', bench: '#6b5a48', planter: '#6d5a48', counter: '#3a3d46',
};
export function createInteriors(scene, W, homes) {
  // lampu ruangan: cahaya sendiri sebanding warna permukaan (interior tidak gelap walau matahari terhalang atap)
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  // Mode realistis: tekstur foto menurut jenis permukaan (atribut verteks sfc: 1 dinding plester, 2 ubin keramik,
  // 3 lantai kayu; 0 = warna polos) dengan UV dari posisi dunia; lantai memakai peta normal. Tekstur Poly Haven (CC0).
  const texU = W.real ? { tWoodA: { value: null }, tWoodN: { value: null }, tTileA: { value: null }, tTileN: { value: null }, tPlasA: { value: W.real.sets.plaster.map }, uTexOn: { value: 0 } } : null;
  if (texU) {
    const L = new THREE.TextureLoader();
    let left = 4;
    const ld = (name, srgb) => { const t = L.load('game/assets/pbr/' + name + '.jpg', () => { if (--left === 0) texU.uTexOn.value = 1; }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    texU.tWoodA.value = ld('laminate_floor_02_diff', true); texU.tWoodN.value = ld('laminate_floor_02_nor', false);
    texU.tTileA.value = ld('floor_tiles_08_diff', true); texU.tTileN.value = ld('floor_tiles_08_nor', false);
  }
  mat.onBeforeCompile = (sh) => {
    if (texU) {
      Object.assign(sh.uniforms, texU);
      sh.vertexShader = 'attribute float sfc;\nvarying float vSfc;\nvarying vec3 vIW;\nvarying vec3 vIN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSfc = sfc;\n  vIW = transformed;\n  vIN = normal;');
      sh.fragmentShader = 'uniform sampler2D tWoodA, tWoodN, tTileA, tTileN, tPlasA;\nuniform float uTexOn;\nvarying float vSfc;\nvarying vec3 vIW;\nvarying vec3 vIN;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 fuv = vec2(vIW.x, -vIW.z);
  if (vSfc > 2.5) diffuseColor.rgb *= mix(vec3(1.0), texture2D(tWoodA, fuv / 1.7).rgb * 1.9, uTexOn);
  else if (vSfc > 1.5) { vec3 tl = texture2D(tTileA, fuv / 2.4).rgb; tl = mix(vec3(dot(tl, vec3(0.3333))), tl, 0.3) * 3.0; diffuseColor.rgb *= mix(vec3(1.0), tl, uTexOn); } // keramik terang (ubin ±48 cm)
  else if (vSfc > 0.5) { // dinding: detail plester (dinormalkan terhadap rata-ratanya → warna cat tetap dari warna verteks)
    vec2 wuv = (abs(vIN.x) > abs(vIN.z) ? vIW.zy : vIW.xy) / 2.0;
    float det = dot(texture2D(tPlasA, wuv).rgb, vec3(0.3333)) / max(dot(textureLod(tPlasA, wuv, 10.0).rgb, vec3(0.3333)), 0.05);
    diffuseColor.rgb *= mix(1.0, det, 0.5);
  } else if (uTexOn > 0.5) { // perabot (kotak): serat kayu untuk warna kecokelatan, serat kain/halus untuk lainnya — proyeksi menurut arah permukaan
    vec2 puv = abs(vIN.y) > 0.6 ? vIW.xz : (abs(vIN.x) > abs(vIN.z) ? vIW.zy : vIW.xy);
    vec3 dc = diffuseColor.rgb;
    float woodK = step(dc.b * 1.3, dc.r) * step(dc.b, dc.g) * step(0.12, dc.r) * step(dc.r, 0.8);
    float grain = dot(texture2D(tWoodA, puv / 0.9).rgb, vec3(0.3333)) / max(dot(textureLod(tWoodA, puv / 0.9, 10.0).rgb, vec3(0.3333)), 0.05);
    float weave = dot(texture2D(tPlasA, puv / 0.35).rgb, vec3(0.3333)) / max(dot(textureLod(tPlasA, puv / 0.35, 10.0).rgb, vec3(0.3333)), 0.05);
    diffuseColor.rgb *= mix(mix(1.0, weave, 0.45), mix(1.0, grain, 0.7), woodK);
  }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (vSfc > 1.5 && uTexOn > 0.5) { // lantai: peta normal (bidang XZ dunia: T = +X, B = −Z, N = +Y)
    vec3 tn = (vSfc > 2.5 ? texture2D(tWoodN, fuv / 1.7) : texture2D(tTileN, fuv / 2.4)).xyz * 2.0 - 1.0;
    normal = normalize((viewMatrix * vec4(normalize(vec3(tn.x * 0.9, tn.z, -tn.y * 0.9)), 0.0)).xyz);
  }`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * ${W.real ? '0.11' : '0.62'};`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n  reflectedLight.directDiffuse *= ${W.real ? '1.0' : '0.12'}; // mode realistis: matahari sungguhan masuk lewat jendela/pintu (peta bayangan gedung berlubang)${W.real ? '\n  reflectedLight.indirectDiffuse *= 0.5; // dalam ruangan lebih gelap dari luar; mata menyesuaikan (eksposur otomatis)' : ''}`);
  };
  const open = new Map(); // indeks gedung → mesh
  const list = [...homes.values()];
  list.forEach((H, k) => { H.k = k; });
  const cen = list.map((H) => [H.pts.reduce((s, p) => s + p[0], 0) / H.pts.length, H.pts.reduce((s, p) => s + p[1], 0) / H.pts.length]);
  const rad = list.map((H, k) => Math.max(...H.pts.map((p) => Math.hypot(p[0] - cen[k][0], p[1] - cen[k][1]))));
  // grid untuk mencari gedung dekat (gedung besar dicek terpisah: jarak ke tepi, bukan ke titik tengah)
  const GR = new Map(), GC = 40, gk = (x, y) => Math.floor(x / GC) * 100003 + Math.floor(y / GC), BIG = [];
  list.forEach((H, k) => { if (rad[k] > 40) { BIG.push(k); return; } const key = gk(cen[k][0], cen[k][1]); (GR.get(key) || GR.set(key, []).get(key)).push(k); });
  const distTo = (k, x, y) => Math.max(0, Math.hypot(cen[k][0] - x, cen[k][1] - y) - rad[k]);
  // teras depan (lantai, undakan, dua tiang, kanopi) untuk semua rumah: satu mesh statis
  (function porches() {
    const pos = [], nor = [], col = [], c = new THREE.Color();
    const quad = (a, b, d, e, n, cc) => { for (const p of [a, b, d, a, d, e]) { pos.push(p[0], p[2], -p[1]); nor.push(n[0], n[2], -n[1]); col.push(cc.r, cc.g, cc.b); } };
    const box = (P, z0, z1, cc) => { // P: 4 sudut CCW (data)
      for (let j = 0; j < 4; j++) { const a = P[j], b = P[(j + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1; quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [ey / L, -ex / L, 0], c.copy(cc).multiplyScalar(j % 2 ? 0.9 : 1)); }
      quad([P[0][0], P[0][1], z1], [P[1][0], P[1][1], z1], [P[2][0], P[2][1], z1], [P[3][0], P[3][1], z1], [0, 0, 1], cc);
      quad([P[3][0], P[3][1], z0], [P[2][0], P[2][1], z0], [P[1][0], P[1][1], z0], [P[0][0], P[0][1], z0], [0, 0, -1], c.copy(cc).multiplyScalar(0.8));
    };
    const floorC = new THREE.Color(COL.porch), colC = new THREE.Color('#f4f1ea');
    const AWN = ['#3D3782', '#b5483d', '#2f6f4f', '#D29F52', '#2d5f8a', '#5a5f66'];
    for (const H of list) {
      for (const cv of H.canopies || []) { // ruko: kanopi menerus di depan etalase; mal: kanopi pintu masuk bertiang
        const e = cv.e, P = onEdge(e), rect = (s0, s1, v0, v1) => [P(s0, v0), P(s1, v0), P(s1, v1), P(s0, v1)];
        const awC = new THREE.Color(AWN[H.i % AWN.length]);
        box(rect(cv.s0, cv.s1, -cv.d, 0), cv.z, cv.z + 0.14, awC);
        box(rect(cv.s0, cv.s1, -cv.d, -cv.d + 0.08), cv.z - 0.22, cv.z + 0.18, c.copy(awC).multiplyScalar(0.8)); // lisplang depan
        if (cv.cols) for (const s of [cv.s0 + 0.3, cv.s1 - 0.3]) box(rect(s - 0.18, s + 0.18, -cv.d + 0.12, -cv.d + 0.48), 0, cv.z, colC);
      }
      if (H.kind === 'shop' && H.canopies && H.canopies[0]) {
        const e = H.canopies[0].e, P = onEdge(e), rect = (s0, s1, v0, v1) => [P(s0, v0), P(s1, v0), P(s1, v1), P(s0, v1)];
        const ledgeC = new THREE.Color('#ece8df'), pilC = new THREE.Color('#d6cfc2');
        for (let z = 6.6; z < H.h - 0.7; z += 3.3) box(rect(0, e.len, -0.22, 0), z - 0.08, z + 0.1, ledgeC);
        box(rect(-0.12, e.len + 0.12, -0.34, 0), H.h - 0.38, H.h + 0.06, ledgeC);
        for (let k = Math.ceil(e.u0 / 5.2); k * 5.2 < e.u0 + e.len; k++) { const s = k * 5.2 - e.u0; if (s > 0.3 && s < e.len - 0.3) box(rect(s - 0.2, s + 0.2, -0.15, 0), 3.45, H.h - 0.38, pilC); }
      }
      const pr = H.porch;
      if (!pr) continue;
      const e = pr.e, P = onEdge(e), rect = (s0, s1, v0, v1) => [P(s0, v0), P(s1, v0), P(s1, v1), P(s0, v1)]; // v negatif = keluar
      const { s0, s1, D, h } = pr, sm = (s0 + s1) / 2;
      box(rect(s0, s1, -D, 0), 0, 0.15, floorC);
      box(rect(sm - 0.8, sm + 0.8, -D - 0.34, -D), 0, 0.075, floorC);
      for (const s of [s0 + 0.2, s1 - 0.2]) box(rect(s - 0.11, s + 0.11, -D + 0.09, -D + 0.31), 0.15, h, colC);
      const roofC = new THREE.Color(COL.porchRoof[H.i % COL.porchRoof.length]);
      box(rect(s0 - 0.12, s1 + 0.12, -D - 0.3, 0), h, h + 0.12, roofC);
      box(rect(s0 - 0.12, s1 + 0.12, -D - 0.3, -D - 0.18), h - 0.16, h, colC); // lisplang
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
  })();
  let lastX = Infinity, lastY = Infinity, queue = [];

  const outMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  function build(H) {
    const pos = [], nor = [], col = [], sfc = [], c = new THREE.Color();
    let ST = 0; // jenis permukaan untuk tekstur (lihat material): 0 polos, 1 dinding, 2 ubin, 3 kayu
    const xp = [], xn = [], xc = []; // geometri luar rumah: kusen, ambang & kepala jendela/pintu (material luar, kena matahari)
    const boxX = (x, y, rot, w, d, z0, z1, cc) => {
      const cs = Math.cos(rot), sn = Math.sin(rot), hw = w / 2, hd = d / 2, P = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [x + a * cs - b * sn, y + a * sn + b * cs]);
      const q = (a, b, d2, e2, n, k) => { for (const p of [a, b, d2, a, d2, e2]) { xp.push(p[0], p[2], -p[1]); xn.push(n[0], n[2], -n[1]); xc.push(cc.r * k, cc.g * k, cc.b * k); } };
      for (let j = 0; j < 4; j++) { const a = P[j], b = P[(j + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1; q([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [ey / L, -ex / L, 0], j % 2 ? 0.9 : 1); }
      q([P[0][0], P[0][1], z1], [P[1][0], P[1][1], z1], [P[2][0], P[2][1], z1], [P[3][0], P[3][1], z1], [0, 0, 1], 1.05);
      q([P[3][0], P[3][1], z0], [P[2][0], P[2][1], z0], [P[1][0], P[1][1], z0], [P[0][0], P[0][1], z0], [0, 0, -1], 0.75);
    };
    let Z = 0; // tinggi lantai perabot (lantai atas)
    const tri = (a, b, d, n, cc) => { for (const p of [a, b, d]) { pos.push(p[0], p[2], -p[1]); nor.push(n[0], n[2], -n[1]); col.push(cc.r, cc.g, cc.b); sfc.push(ST); } };
    const quad = (a, b, d, e, n, cc) => { tri(a, b, d, n, cc); tri(a, d, e, n, cc); };
    const quadAuto = (a, b, d, e, cc) => { // normal dari urutan titik (data x, y, z)
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      quad(a, b, d, e, [nx / l, ny / l, nz / l], cc);
    };
    // dinding vertikal dari titik p (data) arah u sepanjang [s0,s1], tinggi [v0,v1], normal n (data 2D)
    const wallRect = (p, ux, uy, s0, s1, v0, v1, nx, ny, cc) => {
      if (s1 - s0 < 0.01 || v1 - v0 < 0.01) return;
      const A = [p[0] + ux * s0, p[1] + uy * s0], Bq = [p[0] + ux * s1, p[1] + uy * s1];
      const n = [nx, ny, 0];
      const P = (q, v) => [q[0], q[1], v];
      // urutan A→B→atas punya normal (uy, −ux); balik kalau normal yang diminta berlawanan
      if (nx * uy - ny * ux > 0) quad(P(A, v0), P(Bq, v0), P(Bq, v1), P(A, v1), n, cc); else quad(P(Bq, v0), P(A, v0), P(A, v1), P(Bq, v1), n, cc);
    };
    const flat = (poly, z, up, cc) => {
      const v2 = poly.map((p) => new THREE.Vector2(p[0], p[1]));
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (e) { return; }
      for (const t of tris) {
        let a = poly[t[0]], b = poly[t[1]], d = poly[t[2]];
        const ccw = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) > 0;
        if (ccw !== up) { const tmp = b; b = d; d = tmp; } // lantai: CCW dari atas; langit-langit: sebaliknya
        tri([a[0], a[1], z], [b[0], b[1], z], [d[0], d[1], z], [0, 0, up ? 1 : -1], cc);
      }
    };
    const box = (x, y, rot, w, d, z0, z1, cc, top = true) => {
      z0 += Z; z1 += Z;
      const cs = Math.cos(rot), sn = Math.sin(rot), hw = w / 2, hd = d / 2;
      const P = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [x + a * cs - b * sn, y + a * sn + b * cs]);
      for (let j = 0; j < 4; j++) {
        const a = P[j], b = P[(j + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
        const nx = ey / L, ny = -ex / L; // keluar (kotak CCW)
        quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [nx, ny, 0], c.copy(cc).multiplyScalar(j % 2 ? 0.88 : 1));
      }
      if (top) quad([P[0][0], P[0][1], z1], [P[1][0], P[1][1], z1], [P[2][0], P[2][1], z1], [P[3][0], P[3][1], z1], [0, 0, 1], c.copy(cc).multiplyScalar(1.06));
    };
    const T = HOUSE.wall, house = !H.kind, up = H.up, ceil = H.ceil, topZ = up ? up.ceil : ceil;
    const wallC = new THREE.Color(house ? COL.wall[H.i % COL.wall.length] : H.kind === 'hall' ? COL.hallWall : COL.shopWall[H.i % 3]);
    const jambC = new THREE.Color(COL.jamb), ceilC = new THREE.Color(COL.ceil);
    // lantai per ruang (+ kamar mandi berubin biru di tiap lantai)
    // mode realistis: kamar tidur berlantai kayu, ruang lain ubin keramik (warna dari tekstur; warna verteks hanya tinta)
    const RF = !!W.real, plainF = new THREE.Color('#f4f1ea'), bathF = new THREE.Color('#cfe2ea'), shopF = new THREE.Color('#e6e6e6');
    for (const r of H.rooms) {
      ST = RF ? (house && r.type === 'bedroom' ? 3 : 2) : 0;
      flat(r, 0.025, true, RF ? (house ? plainF : shopF) : new THREE.Color(house ? COL.floor[r.type] || COL.floor.living : H.kind === 'hall' ? COL.tile2 : COL.tile));
    }
    ST = RF ? 2 : 0;
    if (H.bath) { const bc = RF ? bathF : new THREE.Color(COL.bathFloor); flat(H.bath.poly, 0.032, true, bc); if (up) flat(H.bath.poly, up.floor + 0.032, true, bc); }
    ST = 0;
    // warna dinding menurut ruang di titik (x, y) pada lantai lv (0 = bawah, 1 = atas)
    const bedC = COL.room.bedroom[H.i % COL.room.bedroom.length];
    const roomC = (x, y, lv) => {
      if (!house) return wallC;
      if (H.bath && pip(x, y, H.bath.poly)) return new THREE.Color(COL.room.bath);
      const ri = H.rooms.findIndex((r) => pip(x, y, r)), t = ri < 0 ? 'living' : lv ? up.types[ri] : H.rooms[ri].type;
      return new THREE.Color(t === 'bedroom' ? bedC : COL.room[t] || COL.room.living);
    };
    const baseC = new THREE.Color(COL.base);
    // potongan dinding vertikal, dibelah di batas lantai supaya warna mengikuti ruang tiap lantai
    const piece = (o, ux, uy, s0, s1, z0, z1, nx, ny, sx, sy) => {
      if (z1 - z0 < 0.01) return;
      const cut = up ? ceil : Infinity;
      ST = 1;
      if (z0 < cut && z1 > cut) { wallRect(o, ux, uy, s0, s1, z0, cut, nx, ny, roomC(sx, sy, 0)); wallRect(o, ux, uy, s0, s1, cut, z1, nx, ny, roomC(sx, sy, 1)); }
      else wallRect(o, ux, uy, s0, s1, z0, z1, nx, ny, roomC(sx, sy, z0 >= cut ? 1 : 0));
      ST = 0;
    };
    // langit-langit; rumah 2 lantai: pelat berlubang tangga (bawah = plafon, atas = lantai 2), tepi lubang, plafon atas
    if (up) {
      const upC = new THREE.Color(COL.upFloor), slabC = new THREE.Color(COL.slab), S = up.stair, e = S.e, P = onEdge(e), SW = HOUSE.stairW;
      for (const pc of up.plate) { flat(pc, ceil, false, ceilC); ST = RF ? 3 : 0; flat(pc, up.floor + 0.02, true, RF ? plainF : upC); ST = 0; }
      wallRect(P(S.lo, T + SW), e.ux, e.uy, 0, S.hi - S.lo, ceil, up.floor, -e.nx, -e.ny, slabC);
      wallRect(P(S.lo, T), e.nx, e.ny, 0, SW, ceil, up.floor, e.ux, e.uy, slabC);
      wallRect(P(S.hi, T), e.nx, e.ny, 0, SW, ceil, up.floor, -e.ux, -e.uy, slabC);
      flat(H.pts, up.ceil, false, ceilC);
    } else flat(H.pts, ceil, false, ceilC);
    // sisi dalam dinding luar: lubang pintu/bukaan & jendela per lantai (sama dengan shader), kusen di tiap lubang
    for (const e of H.edges) {
      const ins = [e.a[0] + e.nx * T, e.a[1] + e.ny * T];
      const holes = [];
      for (const d of H.doors) if (d.e === e) holes.push([d.s0, d.s1, 0, d.h || HOUSE.doorH, true]);
      if (house && !(H.blind && H.blind.has(e.j))) {
        (up ? [ceil, up.ceil] : [ceil]).forEach((z1, li) => {
          const k0 = Math.floor(e.u0 / HOUSE.bay), k1 = Math.floor((e.u0 + e.len) / HOUSE.bay);
          for (let k = k0; k <= k1; k++) {
            const s0 = k * HOUSE.bay + HOUSE.wx0 * HOUSE.bay - e.u0, s1 = (k + 1) * HOUSE.bay - HOUSE.wx0 * HOUSE.bay - e.u0;
            const v0 = (li + HOUSE.wy0) * HOUSE.fh, v1 = Math.min(z1, (li + HOUSE.wy1) * HOUSE.fh);
            // jendela sah (= shader world.js & collide.js winOk): utuh di dalam sisi (≥ 0,3 m dari sudut), di lantai dasar tidak menumpuk pintu (± 0,2 m)
            if (s0 < 0.3 || s1 > e.len - 0.3 || v1 <= v0 + 0.05) continue;
            if (li === 0 && holes.some((h0) => h0[4] && s0 < h0[1] + 0.2 && s1 > h0[0] - 0.2)) continue;
            holes.push([s0, s1, v0, v1, false]);
          }
        });
      }
      // potong permukaan dinding di sekitar lubang: kolom-kolom s, tiap kolom bisa punya beberapa lubang (per lantai)
      const cuts = new Set([0, e.len]);
      for (const h0 of holes) { cuts.add(Math.max(0, h0[0])); cuts.add(Math.min(e.len, h0[1])); }
      const S = [...cuts].sort((p, q) => p - q);
      const bo = [e.a[0] + e.nx * (T + 0.012), e.a[1] + e.ny * (T + 0.012)];
      for (let k = 0; k + 1 < S.length; k++) {
        const s0 = S[k], s1 = S[k + 1], mid = (s0 + s1) / 2, sx = ins[0] + e.ux * mid + e.nx * 0.35, sy = ins[1] + e.uy * mid + e.ny * 0.35;
        let z = 0;
        const hs = holes.filter((hh) => mid > hh[0] && mid < hh[1]).sort((p, q) => p[2] - q[2]);
        for (const h0 of hs) { piece(ins, e.ux, e.uy, s0, s1, z, h0[2], e.nx, e.ny, sx, sy); z = Math.max(z, h0[3]); }
        piece(ins, e.ux, e.uy, s0, s1, z, topZ, e.nx, e.ny, sx, sy);
        if (house) for (const fz of up ? [0, up.floor] : [0]) if (!hs.some((h0) => h0[2] < fz + 0.1 && h0[3] > fz)) wallRect(bo, e.ux, e.uy, s0, s1, fz, fz + 0.09, e.nx, e.ny, baseC); // plint
      }
      if (house) {
        const fs = H.i % 7, frameC = new THREE.Color(fs < 3 ? '#f2f0ea' : fs < 5 ? '#333338' : '#6b4a30'), sillC = new THREE.Color('#ece9e2'), rot = Math.atan2(e.uy, e.ux);
        const O = (s, d) => [e.a[0] + e.ux * s - e.nx * d, e.a[1] + e.uy * s - e.ny * d]; // d > 0 = di luar dinding
        for (const [s0, s1, v0, v1, isDoor] of holes) {
          for (const s of [s0 - 0.045, s1 + 0.045]) { const p = O(s, 0.035); boxX(p[0], p[1], rot, 0.09, 0.07, isDoor ? 0 : v0 - 0.02, v1 + 0.09, frameC); }
          const pm = O((s0 + s1) / 2, 0.035);
          boxX(pm[0], pm[1], rot, s1 - s0 + 0.18, 0.07, v1, v1 + 0.09, frameC);
          if (!isDoor) { const ps = O((s0 + s1) / 2, 0.08); boxX(ps[0], ps[1], rot, s1 - s0 + 0.3, 0.16, v0 - 0.08, v0 - 0.01, sillC); }
        }
      }
      for (const h0 of holes) { // kusen: tebal dinding di tepi lubang
        const [s0, s1, v0, v1] = h0, out = e.a;
        const A0 = [out[0] + e.ux * s0, out[1] + e.uy * s0], A1 = [ins[0] + e.ux * s0, ins[1] + e.uy * s0], B0 = [out[0] + e.ux * s1, out[1] + e.uy * s1], B1 = [ins[0] + e.ux * s1, ins[1] + e.uy * s1];
        quad([A0[0], A0[1], v0], [A1[0], A1[1], v0], [A1[0], A1[1], v1], [A0[0], A0[1], v1], [e.ux, e.uy, 0], jambC); // sisi kiri lubang (menghadap +u)
        quad([B1[0], B1[1], v0], [B0[0], B0[1], v0], [B0[0], B0[1], v1], [B1[0], B1[1], v1], [-e.ux, -e.uy, 0], jambC);
        quad([A0[0], A0[1], v1], [A1[0], A1[1], v1], [B1[0], B1[1], v1], [B0[0], B0[1], v1], [0, 0, -1], jambC); // kepala
        if (v0 > 0.01) quad([A1[0], A1[1], v0], [A0[0], A0[1], v0], [B0[0], B0[1], v0], [B1[0], B1[1], v0], [0, 0, 1], c.copy(jambC).multiplyScalar(1.05)); // ambang jendela
        if (house && !h0[4] && s1 - s0 > 0.6) { // gorden kiri-kanan + rel
          const sm = (s0 + s1) / 2, inB = H.bath && pip(ins[0] + e.ux * sm + e.nx * 0.4, ins[1] + e.uy * sm + e.ny * 0.4, H.bath.poly);
          if (!inB) {
            const cc = new THREE.Color(COL.curtain[(H.i + Math.round(e.u0 + sm)) % COL.curtain.length]), rot = Math.atan2(e.uy, e.ux), off = T + 0.08;
            for (const s of [s0 - 0.12, s1 + 0.12]) { const p = [e.a[0] + e.ux * s + e.nx * off, e.a[1] + e.uy * s + e.ny * off]; box(p[0], p[1], rot, 0.3, 0.04, v0 - 0.12, v1 + 0.12, cc); }
            const pr = [e.a[0] + e.ux * sm + e.nx * off, e.a[1] + e.uy * sm + e.ny * off];
            box(pr[0], pr[1], rot, s1 - s0 + 0.7, 0.03, v1 + 0.12, v1 + 0.15, new THREE.Color('#3a3a3f'));
          }
        }
      }
    }
    if (H.kind === 'hall') { // mal: dinding dalam berupa deret etalase toko (kaca gelap + papan nama), lampu plafon
      const glassC = new THREE.Color('#3d4b5e'), frameC = new THREE.Color('#cfd3da'), SIGN = ['#c0392b', '#2471a3', '#1e8449', '#d4ac0d', '#7d3c98', '#D29F52', '#3D3782', '#e67e22'];
      for (const e of H.edges) {
        const o = [e.a[0] + e.nx * (T + 0.03), e.a[1] + e.ny * (T + 0.03)], hs = H.doors.filter((d) => d.e === e);
        for (let k = Math.floor(e.u0 / 6); k * 6 < e.u0 + e.len; k++) {
          const s0 = Math.max(0, k * 6 + 0.35 - e.u0), s1 = Math.min(e.len, (k + 1) * 6 - 0.35 - e.u0);
          if (s1 - s0 < 2 || hs.some((d) => s0 < d.s1 + 0.3 && s1 > d.s0 - 0.3)) continue;
          wallRect(o, e.ux, e.uy, s0, s1, 0.12, 2.75, e.nx, e.ny, glassC);
          wallRect(o, e.ux, e.uy, s0 - 0.12, s0, 0, 3.0, e.nx, e.ny, frameC);
          wallRect(o, e.ux, e.uy, s1, s1 + 0.12, 0, 3.0, e.nx, e.ny, frameC);
          wallRect(o, e.ux, e.uy, s0, s1, 2.85, 3.35, e.nx, e.ny, new THREE.Color(SIGN[Math.floor(hash(H.i + k, 3.3) * SIGN.length)]));
        }
      }
      const lightC = new THREE.Color('#fffdf2'), z = ceil - 0.03;
      for (const m of H.lights || []) { const r = 0.7; quad([m[0] - r, m[1] - r, z], [m[0] - r, m[1] + r, z], [m[0] + r, m[1] + r, z], [m[0] + r, m[1] - r, z], [0, 0, -1], lightC); }
    }
    // sekat: dua sisi, ambang pintu di tengah (sekat toko: penuh)
    for (const [z0, z1] of up ? [[0, ceil], [up.floor, up.ceil]] : [[0, ceil]]) for (const p of H.parts) {
      const ux = (p.b[0] - p.a[0]) / p.len, uy = (p.b[1] - p.a[1]) / p.len, nx = -uy, ny = ux, t = 0.06;
      const lv = z0 > 0.5 ? 1 : 0, mx = (p.a[0] + p.b[0]) / 2, my = (p.a[1] + p.b[1]) / 2;
      const sideC = (sd) => (house ? roomC(mx + nx * sd * 0.4, my + ny * sd * 0.4, lv) : wallC);
      if (!(p.g1 > p.g0)) { for (const sd of [1, -1]) { const o = [p.a[0] + nx * t * sd, p.a[1] + ny * t * sd]; wallRect(o, ux, uy, 0, p.len, z0, z1, nx * sd, ny * sd, sideC(sd)); if (house) wallRect([p.a[0] + nx * (t + 0.012) * sd, p.a[1] + ny * (t + 0.012) * sd], ux, uy, 0, p.len, z0, z0 + 0.09, nx * sd, ny * sd, baseC); } continue; }
      const gh = z0 + HOUSE.gapH;
      for (const sd of [1, -1]) {
        const o = [p.a[0] + nx * t * sd, p.a[1] + ny * t * sd], cc = sideC(sd), ob = [p.a[0] + nx * (t + 0.012) * sd, p.a[1] + ny * (t + 0.012) * sd];
        wallRect(o, ux, uy, 0, p.g0, z0, z1, nx * sd, ny * sd, cc);
        wallRect(o, ux, uy, p.g1, p.len, z0, z1, nx * sd, ny * sd, cc);
        wallRect(o, ux, uy, p.g0, p.g1, gh, z1, nx * sd, ny * sd, cc);
        if (!house) continue;
        wallRect(ob, ux, uy, 0, p.g0, z0, z0 + 0.09, nx * sd, ny * sd, baseC);
        wallRect(ob, ux, uy, p.g1, p.len, z0, z0 + 0.09, nx * sd, ny * sd, baseC);
        // lukisan di bagian sekat terpanjang (bukan kamar mandi)
        const [a0, a1] = p.g0 > p.len - p.g1 ? [0, p.g0] : [p.g1, p.len], sm = (a0 + a1) / 2, px = p.a[0] + ux * sm + nx * (t + 0.03) * sd, py = p.a[1] + uy * sm + ny * (t + 0.03) * sd;
        if (a1 - a0 >= 1.5 && !(H.bath && pip(px + nx * sd * 0.3, py + ny * sd * 0.3, H.bath.poly))) {
          const rot = Math.atan2(uy, ux), k = Math.round(sm * 7 + H.i + sd * 3 + z0);
          box(px, py, rot, 0.98, 0.05, z0 + 1.32, z0 + 2.06, new THREE.Color('#2f2a26'));
          const cv = [px + nx * 0.03 * sd, py + ny * 0.03 * sd];
          box(cv[0], cv[1], rot, 0.86, 0.02, z0 + 1.38, z0 + 1.72, new THREE.Color(COL.art[k % COL.art.length]));
          box(cv[0], cv[1], rot, 0.86, 0.02, z0 + 1.72, z0 + 2.0, new THREE.Color(COL.art[(k + 3) % COL.art.length]));
        }
      }
      for (const [s, dir] of [[p.g0, 1], [p.g1, -1]]) {
        const q0 = [p.a[0] + ux * s + nx * t, p.a[1] + uy * s + ny * t], q1 = [p.a[0] + ux * s - nx * t, p.a[1] + uy * s - ny * t];
        const [qa, qb] = dir > 0 ? [q1, q0] : [q0, q1]; // muka kusen menghadap ke dalam celah
        quad([qa[0], qa[1], z0], [qb[0], qb[1], z0], [qb[0], qb[1], gh], [qa[0], qa[1], gh], [ux * dir, uy * dir, 0], jambC);
      }
      const g0 = [p.a[0] + ux * p.g0, p.a[1] + uy * p.g0], g1 = [p.a[0] + ux * p.g1, p.a[1] + uy * p.g1];
      quad([g0[0] + nx * t, g0[1] + ny * t, gh], [g1[0] + nx * t, g1[1] + ny * t, gh], [g1[0] - nx * t, g1[1] - ny * t, gh], [g0[0] - nx * t, g0[1] - ny * t, gh], [0, 0, -1], jambC);
    }
    // lampu plafon di tengah tiap ruang (dan kamar mandi), tiap lantai
    if (house) {
      const lampC = new THREE.Color('#fffbe8'), rimC = new THREE.Color('#cfc8ba');
      const lamp = (x, y, z, r) => { quad([x - r, y - r, z], [x - r, y + r, z], [x + r, y + r, z], [x + r, y - r, z], [0, 0, -1], lampC); box(x, y, 0, r * 2 + 0.06, r * 2 + 0.06, z, z + 0.03, rimC, false); };
      const spots = H.rooms.map((r) => [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length]);
      if (H.bath) spots.push(lerp2(H.bath.poly[0], H.bath.poly[2], 0.5));
      for (const [x, y] of spots) {
        lamp(x, y, ceil - 0.05, 0.22);
        if (up && !up.plate.every((pc) => !pip(x, y, pc))) lamp(x, y, up.ceil - 0.05, 0.22);
      }
    }
    // daun pintu terbuka menempel ke dinding dalam (rumah)
    if (house) for (const d of H.doors) {
      const e = d.e, hx = e.a[0] + e.ux * d.s1 + e.nx * T, hy = e.a[1] + e.uy * d.s1 + e.ny * T, L = HOUSE.doorW * 0.5;
      box(hx + e.nx * L / 2, hy + e.ny * L / 2, Math.atan2(e.ny, e.nx), L, 0.05, 0, HOUSE.doorH - 0.05, new THREE.Color(COL.door));
    }
    // tangga, pagar tangga (panel miring), pagar lubang di lantai atas
    if (up) {
      const S = up.stair, e = S.e, P = onEdge(e), SW = HOUSE.stairW, N = 18, rise = S.h1 / N, run = S.len / N, rotE = Math.atan2(e.uy, e.ux);
      const stepC = new THREE.Color(COL.step), stepC2 = new THREE.Color(COL.step2), railC = new THREE.Color(COL.rail);
      for (let k = 0; k < N; k++) { const s = S.dir > 0 ? S.lo + (k + 0.5) * run : S.hi - (k + 0.5) * run, p = P(s, T + SW / 2); box(p[0], p[1], rotE, run + 0.004, SW, 0, (k + 1) * rise, k % 2 ? stepC : stepC2); }
      const bot = S.dir > 0 ? S.lo : S.hi, topS = S.dir > 0 ? S.hi : S.lo, pb = P(bot, T + SW + 0.02), pt = P(topS, T + SW + 0.02);
      const A0 = [pb[0], pb[1], 0], A1 = [pt[0], pt[1], S.h1 - 0.15], A2 = [pt[0], pt[1], S.h1 + 0.95], A3 = [pb[0], pb[1], 0.95];
      quadAuto(A0, A1, A2, A3, railC); quadAuto(A0, A3, A2, A1, railC);
      const F = up.floor, mid = P((S.lo + S.hi) / 2, T + SW + 0.05), be = P(bot - S.dir * 0.05, T + (SW + 0.1) / 2);
      box(mid[0], mid[1], rotE, S.hi - S.lo, 0.1, F, F + 0.95, railC);
      box(be[0], be[1], rotE + Math.PI / 2, SW + 0.1, 0.1, F, F + 0.95, railC);
    }
    // perabot
    const C = (hex) => new THREE.Color(hex), R = (k) => hash(H.i + k, 7.7);
    const goods = (x, y, rot, w, d, z, at, seed) => { // deret barang warna-warni di satu tingkat rak
      const n = Math.max(1, Math.round(w / 1.3));
      for (let j = 0; j < n; j++) { const p = at(-w / 2 + (j + 0.5) * w / n, 0); box(p[0], p[1], rot, w / n - 0.08, d - 0.12, z, z + 0.2 + R(j * 3 + seed) * 0.1, C(COL.goods[Math.floor(R(j * 7 + seed * 13) * COL.goods.length)])); }
    };
    function drawFurn(f) {
      const { x, y, rot, w, d, h } = f, cs = Math.cos(rot), sn = Math.sin(rot), at = (a, b) => [x + a * cs - b * sn, y + a * sn + b * cs]; // a sepanjang dinding, b ke dalam (+)
      const fwd = (b) => at(0, b);
      switch (f.kind) {
        case 'sofa': { const sc = C(COL.sofa[(H.i + f.room) % COL.sofa.length]); box(x, y, rot, w, d, 0, 0.42, sc); const bk = fwd(-d / 2 + 0.13); box(bk[0], bk[1], rot, w, 0.26, 0.42, h, sc.clone().multiplyScalar(0.9)); for (const s of [-1, 1]) { const ar = at(s * (w / 2 - 0.1), 0); box(ar[0], ar[1], rot, 0.2, d, 0.42, 0.62, sc.clone().multiplyScalar(0.85)); } break; }
        case 'tv': { box(x, y, rot, w, d, 0, h, C(COL.wood)); const tv = fwd(-0.05); box(tv[0], tv[1], rot, 1.15, 0.06, h + 0.02, h + 0.7, C(COL.dark)); break; }
        case 'coffee': box(x, y, rot, w, d, 0.32, h, C(COL.wood)); box(x, y, rot, w * 0.9, d * 0.9, 0, 0.32, C(COL.dark), false); break;
        case 'shelf': box(x, y, rot, w, d, 0, h, C(COL.wood)); for (let k = 1; k < 4; k++) { const z = h * k / 4; box(x, y, rot, w * 0.94, d * 1.02, z - 0.02, z + 0.01, C(R(k) < 0.5 ? '#c7533f' : '#3f6fa8')); } break;
        case 'plant': box(x, y, rot, 0.36, 0.36, 0, 0.38, C(COL.pot)); box(x, y, rot + 0.6, 0.55, 0.55, 0.38, h, C(COL.plant)); break;
        case 'bed': { const hb = fwd(-d / 2 + 0.05); box(x, y, rot, w, d, 0, 0.32, C(COL.wood)); box(x, y, rot, w * 0.96, d * 0.96, 0.32, h, C(COL.bed)); box(hb[0], hb[1], rot, w, 0.1, 0, 1.05, C(COL.wood)); for (const s of [-1, 1]) { const pl = at(s * w * 0.24, -d / 2 + 0.32); box(pl[0], pl[1], rot, w * 0.38, 0.32, h, h + 0.12, C(COL.pillow)); } const bl = fwd(0.35); box(bl[0], bl[1], rot, w * 0.98, d * 0.5, h - 0.02, h + 0.04, C(['#503EBA', '#c9b48a', '#6b3f3f', '#3d6e8a'][H.i % 4])); break; }
        case 'wardrobe': box(x, y, rot, w, d, 0, h, C(COL.wood)); { const fr = fwd(d / 2 + 0.005); box(fr[0], fr[1], rot, 0.02, 0.01, 0.9, 1.2, C(COL.metal)); } break;
        case 'side': box(x, y, rot, w, d, 0, h, C(COL.wood)); break;
        case 'desk': box(x, y, rot, w, d, 0.7, h, C(COL.wood)); for (const s of [-1, 1]) { const lg = at(s * (w / 2 - 0.05), 0); box(lg[0], lg[1], rot, 0.05, d * 0.9, 0, 0.7, C(COL.dark)); } break;
        case 'counter': { box(x, y, rot, w, d, 0, h - 0.04, C('#ece7dd')); box(x, y, rot, w + 0.02, d + 0.02, h - 0.04, h, C('#4a4d55')); const up2 = fwd(-d / 2 + 0.17); box(up2[0], up2[1], rot, w, 0.34, 1.5, 2.2, C('#ece7dd'));
          for (const s of [-0.18, 0.18]) { const b = at(-w / 2 + 0.45 + s, 0); box(b[0], b[1], rot, 0.2, 0.2, h, h + 0.015, C('#1e1f24')); } // kompor
          { const sk = at(w / 2 - 0.5, 0.02); box(sk[0], sk[1], rot, 0.55, 0.4, h - 0.01, h + 0.01, C('#aeb4bc')); const tap = at(w / 2 - 0.5, -d / 2 + 0.08); box(tap[0], tap[1], rot, 0.04, 0.04, h, h + 0.28, C('#c8ccd2')); } break; }
        case 'rug': box(x, y, rot, w, d, 0.026, 0.026 + h, C(['#7a4f3a', '#4f5f7a', '#8a7a5a', '#6b4a6b', '#3f6b5a'][((Math.round(x * 3 + y) % 5) + 5) % 5])); box(x, y, rot, w * 0.82, d * 0.72, 0.03, 0.033 + h, C('#d9c9a8'), true); break;
        case 'toilet': { box(x, y, rot, w * 0.8, d * 0.75, 0, 0.42, C('#f4f4f2')); const tk = fwd(-d / 2 + 0.1); box(tk[0], tk[1], rot, w, 0.18, 0.3, h, C('#f4f4f2')); const seat = fwd(0.06); box(seat[0], seat[1], rot, w * 0.85, d * 0.6, 0.42, 0.46, C('#e6e6e3')); break; }
        case 'sink': { box(x, y, rot, w, d, 0, h - 0.06, C('#8a6440')); box(x, y, rot, w + 0.04, d + 0.04, h - 0.06, h, C('#f4f4f2')); const m = fwd(d / 2 + 0.02); box(m[0], m[1], rot, w * 0.9, 0.02, 1.15, 1.85, C('#bcd3e0')); break; }
        case 'shower': { box(x, y, rot, w, d, 0, 0.08, C('#e9eef1')); const g1 = at(w / 2 - 0.01, 0), g2 = at(0, d / 2 - 0.01); box(g1[0], g1[1], rot, 0.02, d, 0.08, h, C('#a9cde0')); box(g2[0], g2[1], rot, w * 0.55, 0.02, 0.08, h, C('#a9cde0')); const hd = at(-w / 2 + 0.12, -d / 2 + 0.12); box(hd[0], hd[1], rot, 0.12, 0.12, 1.95, 2.0, C('#c8ccd2')); break; }
        case 'fridge': box(x, y, rot, w, d, 0, h, C(COL.white)); break;
        case 'table': { box(x, y, rot, w, d, h - 0.05, h, C(COL.wood)); for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lg = at(a * (w / 2 - 0.08), b * (d / 2 - 0.08)); box(lg[0], lg[1], rot, 0.06, 0.06, 0, h - 0.05, C(COL.dark), false); }
          for (const [a, b] of [[-0.35, -1], [0.35, -1], [-0.35, 1], [0.35, 1]]) { const ch = at(a * w, b * (d / 2 + 0.3)); box(ch[0], ch[1], rot, 0.42, 0.42, 0, 0.45, C(COL.wood)); const bk = at(a * w, b * (d / 2 + 0.49)); box(bk[0], bk[1], rot, 0.42, 0.05, 0.45, 0.9, C(COL.wood)); } break; }
        // toko & aula
        case 'gondola': { // rak supermarket dua sisi: alas, sekat tengah, 4 tingkat barang
          box(x, y, rot, w, d, 0, 0.12, C(COL.counter)); box(x, y, rot, w, 0.06, 0.12, h, C(COL.shelf));
          for (let k = 0; k < 4; k++) { const z = 0.12 + k * 0.4; box(x, y, rot, w, d, z, z + 0.03, C(COL.shelf)); goods(x, y, rot, w, d, z + 0.03, at, k * 5 + (f.x | 0)); }
          break;
        }
        case 'rack': { // rak dinding
          box(x, y, rot, w, 0.05, 0, h, C(COL.shelf));
          for (let k = 0; k < 4; k++) { const z = 0.1 + k * 0.45; box(x, y, rot, w, d, z, z + 0.03, C(COL.shelf)); goods(x, y, rot, w, d, z + 0.03, at, k * 11 + (f.y | 0)); }
          break;
        }
        case 'cashier': { box(x, y, rot, w, d, 0, h - 0.05, C(COL.counter)); box(x, y, rot, w + 0.04, d + 0.04, h - 0.05, h, C('#e6e2da')); const rg = at(w * 0.25, 0); box(rg[0], rg[1], rot, 0.35, 0.3, h, h + 0.25, C(COL.dark)); break; }
        case 'fridge2': { box(x, y, rot, w, d, 0, h, C(COL.fridge)); const gl = fwd(d / 2 + 0.01); box(gl[0], gl[1], rot, w * 0.92, 0.02, 0.25, h - 0.2, C(COL.glass)); break; }
        case 'bar': box(x, y, rot, w, d, 0, h - 0.05, C(COL.wood)); box(x, y, rot, w + 0.06, d + 0.06, h - 0.05, h, C(COL.dark)); break;
        case 'display': box(x, y, rot, w, d, 0, h - 0.05, C(COL.wood)); box(x, y, rot, w, d, h - 0.05, h, C('#e6e2da')); goods(x, y, rot, w * 0.9, d * 0.8, h, at, 7 + (f.x | 0)); break;
        case 'column': box(x, y, rot, w, d, 0, h, C(COL.column)); box(x, y, rot, w + 0.1, d + 0.1, 0, 0.12, C('#cfcac0')); break;
        case 'kiosk': { box(x, y, rot, w, d, 0, h - 0.06, C(COL.kiosk)); box(x, y, rot, w + 0.06, d + 0.06, h - 0.06, h, C(COL.gold)); for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = at(a * (w / 2 - 0.05), b * (d / 2 - 0.05)); box(p[0], p[1], rot, 0.06, 0.06, h, 2.3, C(COL.gold)); } box(x, y, rot, w, d, 2.3, 2.42, C(COL.kiosk)); break; }
        case 'planter': box(x, y, rot, w, d, 0, h - 0.1, C(COL.planter)); box(x, y, rot + 0.5, w * 0.8, d * 0.8, h - 0.1, h + 0.5, C(COL.plant)); break;
        case 'bench': box(x, y, rot, w, d, 0.38, h, C(COL.bench)); for (const s of [-1, 1]) { const lg = at(s * (w / 2 - 0.12), 0); box(lg[0], lg[1], rot, 0.08, d * 0.9, 0, 0.38, C(COL.dark), false); } break;
        default: box(x, y, rot, w, d, 0, h, C(COL.wood));
      }
    }
    for (const f of H.furn) drawFurn(f);
    if (up) { Z = up.floor; for (const f of up.furn) drawFurn(f); Z = 0; }
    const mk = (P, N, Cc, material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
      if (material === mat) g.setAttribute('sfc', new THREE.Float32BufferAttribute(sfc, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      return m;
    };
    const grp = new THREE.Group();
    grp.matrixAutoUpdate = false;
    grp.add(mk(pos, nor, col, mat));
    if (xp.length) { const ex = mk(xp, xn, xc, outMat); ex.castShadow = true; grp.add(ex); }
    return grp;
  }
  function setOpen(H, on) { if (W.setHouseOpen) W.setHouseOpen(H, on); }
  for (const H of homes.values()) setOpen(H, false); // data pintu tiap rumah untuk shader fasad (pintu tertutup digambar dari jauh)
  return {
    homes,
    get openCount() { return open.size; },
    // tiap frame: buka gedung dekat (bertahap), tutup yang jauh
    update(cam) {
      const x = cam.x, y = -cam.z;
      if ((x - lastX) ** 2 + (y - lastY) ** 2 > 36) {
        lastX = x; lastY = y;
        const want = [];
        const r = Math.ceil((R_OPEN + 40) / GC);
        const consider = (k) => { const d = distTo(k, x, y); if (d < R_OPEN && !open.has(list[k].i)) want.push([d, k]); };
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const k of GR.get((Math.floor(x / GC) + dx) * 100003 + Math.floor(y / GC) + dy) || []) consider(k);
        for (const k of BIG) consider(k);
        want.sort((a, b) => a[0] - b[0]);
        queue = want.map((w) => w[1]);
        for (const [i, m] of open) { const H = homes.get(i); if (distTo(H.k, x, y) > R_CLOSE) { scene.remove(m); m.traverse((o) => o.geometry && o.geometry.dispose()); open.delete(i); setOpen(H, false); } }
      }
      for (let n = 0; n < BUILD_PER_FRAME && queue.length; n++) {
        const H = list[queue.shift()];
        if (open.has(H.i)) continue;
        const m = build(H);
        scene.add(m);
        open.set(H.i, m);
        setOpen(H, true);
      }
    },
  };
}
