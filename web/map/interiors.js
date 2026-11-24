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
const R_OPEN = 85, R_CLOSE = 110, BUILD_MS = 1.5; // interior dibangun bertahap: ±1,5 ms per frame (mal besar dicicil puluhan frame)
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
    edges.push({ j, a, b, len, u0: per, ux, uy, nx: -uy, ny: ux, x0: 0, x1: 0 }); // normal ke dalam (kiri arah CCW)
    per += len;
  }
  // sudut cekung: sisi dalam dinding (tebal HOUSE.wall) diperpanjang sampai titik temunya (x0 sebelum awal, x1 setelah
  // ujung sisi, m) — dulu berhenti di ujung sisi sehingga ada celah tegak tembus pandang di tiap pojok cekung
  const T = HOUSE.wall;
  edges.forEach((B, k) => {
    const A = edges[(k + edges.length - 1) % edges.length], cr = A.ux * B.uy - A.uy * B.ux;
    if (cr > -1e-3) return; // cembung / lurus
    const Dx = (B.nx - A.nx) * T, Dy = (B.ny - A.ny) * T;
    B.x0 = Math.min(4 * T, Math.max(0, -(Dx * A.uy - Dy * A.ux) / cr));
    A.x1 = Math.min(4 * T, Math.max(0, (Dx * B.uy - Dy * B.ux) / cr));
  });
  return edges;
}
const isRect = (E, tol) => E.length === 4 && E.every((e, j) => Math.abs(e.ux * E[(j + 1) % 4].ux + e.uy * E[(j + 1) % 4].uy) < tol);
// titik sisi e: s sepanjang sisi, v ke dalam
const onEdge = (e) => (s, v) => [e.a[0] + e.ux * s + e.nx * v, e.a[1] + e.uy * s + e.ny * v];

// ---------- Tata letak ----------
// lingkungan perencanaan (jalan, tapak gedung lain) per peta — dibuat sekali, dipakai planHomes, isHall, fitHouseHeights
const SITES = new WeakMap();
function siteOf(D) {
  let S = SITES.get(D);
  if (!S) { S = makeSite(D); SITES.set(D, S); }
  return S;
}
function footOf(D, i) {
  const flat = D.buildings.r[i], n = flat.length >> 1, pts = [];
  for (let j = 0; j < n; j++) pts.push([flat[2 * j] * M, flat[2 * j + 1] * M]);
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}
// gedung jenis 0 = aula (gudang/podium > 1500 m² yang denahnya bisa jadi aula), bukan rumah tapak — aturan sama dengan planHomes.
// world.js memakai ini untuk atap: rumah tapak selalu beratap miring.
const HALLS = new WeakMap();
export function isHall(D, i) {
  if (D.buildings.k[i] !== 0) return false;
  let m = HALLS.get(D);
  if (!m) HALLS.set(D, (m = new Map()));
  if (m.has(i)) return m.get(i);
  const pts = footOf(D, i), area = Math.abs(signedArea(pts)), S = siteOf(D);
  let r = false;
  if (area > 1500 && pts.length >= 3 && pts.length <= 160) { S.fst = 0; r = !!planShop(i, pts, area, D.buildings.h[i] * M, S, true); }
  m.set(i, r);
  return r;
}
// Tinggi rumah tapak mengikuti rencananya (game; buildWorld memanggil ini sebelum gedung dibangun). Tinggi di data peta
// sintetis (6 m × 0,85–1,15) → semua rumah tampak 2 lantai walau tidak punya lantai atas/tangga. Sekarang:
// - jenis 0 setinggi ≥ 11 m yang bukan aula → jenis 3 (lobi + lift + atap: semua lantai terjangkau lift);
// - rumah yang direncanakan TANPA lantai atas → 3,6–4,3 m (satu baris jendela; plafon tetap 3,0 m);
// - rumah berlantai atas tetap (≥ 6,2 m).
// Rencana disimpan (PLANS) dan dipakai ulang planHomes (tanpa biaya ganda).
const PLANS = new WeakMap();
export function fitHouseHeights(D) {
  const B = D.buildings, S = siteOf(D), cache = new Map();
  for (let i = 0; i < B.r.length; i++) if (B.k[i] === 0 && B.h[i] * M >= 11 && !isHall(D, i)) B.k[i] = 3;
  for (let i = 0; i < B.r.length; i++) {
    if (B.k[i] !== 0 || isHall(D, i)) continue;
    const n = B.r[i].length >> 1;
    if (n < 3 || n > 160) continue;
    const pts = footOf(D, i), area = Math.abs(signedArea(pts)), h = B.h[i] * M;
    const H = planHouse(i, pts, area, h, S);
    cache.set(i, H);
    if (H && !H.up && h > 4.3) {
      const h2 = 3.6 + 0.7 * Math.min(1, Math.max(0, (h - 5.1) / 1.8));
      B.h[i] = h2 / M; H.h = h2; H.ceil = Math.min(3.0, h2 - 0.35);
    }
  }
  PLANS.set(D, cache);
}
export function planHomes(D) {
  const B = D.buildings, homes = new Map(), site = siteOf(D);
  planAll(D, B, homes, site);
  return finishHomes(homes);
}
function makeSite(D) {
  const B = D.buildings;
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
  const occupied = (x, y, self, minH = 0) => { // minH: hanya gedung yang lebih tinggi dari ini (menara yang berdiri di atas podium)
    for (const i of BG.get(rk(Math.floor(x / RC), Math.floor(y / RC))) || []) {
      if (i === self || B.h[i] * M < minH) continue;
      const b = bbox[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const r = B.r[i];
      let ins = false;
      for (let a = 0, c = r.length / 2 - 1; a < r.length / 2; c = a++) { const xi = r[2 * a] * M, yi = r[2 * a + 1] * M, xj = r[2 * c] * M, yj = r[2 * c + 1] * M; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
      if (ins) return true;
    }
    return false;
  };
  const heightUnder = (x, y, self) => { // tinggi gedung lain yang tapaknya memuat (x, y) (podium di bawah menara), 0 kalau tidak ada
    let hm = 0;
    for (const i of BG.get(rk(Math.floor(x / RC), Math.floor(y / RC))) || []) {
      if (i === self || B.h[i] * M <= hm) continue;
      const b = bbox[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const r = B.r[i];
      let ins = false;
      for (let a = 0, c = r.length / 2 - 1; a < r.length / 2; c = a++) { const xi = r[2 * a] * M, yi = r[2 * a + 1] * M, xj = r[2 * c] * M, yj = r[2 * c + 1] * M; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
      if (ins) hm = B.h[i] * M;
    }
    return hm;
  };
  // gedung lain yang kotak batasnya bersinggungan dengan gedung self → fungsi titik-di-dalam khusus mereka (null: tidak ada tetangga
  // menempel; perencanaan tangga tidak perlu menguji tapak tetangga sama sekali)
  const neighborOcc = (self) => {
    const b = bbox[self], list = [];
    for (let cx = Math.floor(b[0] / RC); cx <= Math.floor(b[2] / RC); cx++) for (let cy = Math.floor(b[1] / RC); cy <= Math.floor(b[3] / RC); cy++)
      for (const i of BG.get(rk(cx, cy)) || []) { const o = bbox[i]; if (i !== self && !list.includes(i) && o[0] < b[2] + 0.5 && o[2] > b[0] - 0.5 && o[1] < b[3] + 0.5 && o[3] > b[1] - 0.5) list.push(i); }
    if (!list.length) return null;
    return (x, y) => {
      for (const i of list) {
        const o = bbox[i];
        if (x < o[0] || x > o[2] || y < o[1] || y > o[3]) continue;
        const r = B.r[i];
        let ins = false;
        for (let a = 0, c = r.length / 2 - 1; a < r.length / 2; c = a++) { const xi = r[2 * a] * M, yi = r[2 * a + 1] * M, xj = r[2 * c] * M, yj = r[2 * c + 1] * M; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
        if (ins) return true;
      }
      return false;
    };
  };
  return { roadDist, occupied, heightUnder, neighborOcc };
}
function planAll(D, B, homes, site) {
  for (let i = 0; i < B.r.length; i++) {
    const kind = B.k[i];
    if (kind > 3) continue; // 5 = kanopi terbuka (world.js canopyRoof): bisa dilewati, tanpa interior
    const flat = B.r[i], n = flat.length >> 1;
    if (n < 3 || n > 160) continue;
    const pts = [];
    for (let j = 0; j < n; j++) pts.push([flat[2 * j] * M, flat[2 * j + 1] * M]);
    if (signedArea(pts) < 0) pts.reverse(); // sama dengan world.js (CCW)
    const area = Math.abs(signedArea(pts)), h = B.h[i] * M;
    // rumah tapak (rumah besar dibagi banyak ruang); gedung jenis 0 > 1500 m² (gudang, podium, bertanda "yes") = aula;
    // menara & gedung publik = lobi + lift
    // gaya fasad (= world.js): 2 menara, 4 mal (jenis 1 > 3000 m²), 0 rumah, 1 ruko & gedung publik — aturan jendela lantai atas
    const fst = kind === 2 ? 2 : kind === 1 && area > 3000 ? 4 : kind === 0 ? 0 : 1;
    site.fst = fst;
    const H = kind === 2 || kind === 3 ? planTower(i, pts, area, h, site, D.roofs && D.roofs.get(i), kind)
      : kind === 0 ? (PLANS.get(D) && PLANS.get(D).has(i) ? PLANS.get(D).get(i) : (area > 1500 && planShop(i, pts, area, h, site, true)) || planHouse(i, pts, area, h, site))
        : planShop(i, pts, area, h, site);
    if (H) { H.fst = fst; H.blind = (D.blind && D.blind.get(i)) || null; homes.set(i, H); } // sisi tanpa jendela (menempel gedung lain, world.js)
  }
}
function finishHomes(homes) {
  // menara di atas podium: pintu lobinya membuka ke dalam podium → kosongkan perabot podium di depan pintu itu
  for (const T of homes.values()) for (const d of T.kind === 'tower' ? T.doors : []) {
    if (!d.inner) continue;
    const px = d.x - d.e.nx * 2.5, py = d.y - d.e.ny * 2.5;
    for (const P of homes.values()) if (P !== T && P.kind && pip(px, py, P.pts)) P.furn = P.furn.filter((f) => Math.hypot(f.x - px, f.y - py) > 3.6);
  }
  return homes;
}
// ---------- Lantai atas: tangga, pelat berlubang ----------
// potong poligon: sisakan bagian {q · d ≤ c} (Sutherland–Hodgman; denah cekung boleh — jembatan nol-luas aman untuk pip)
function clipHalf(poly, dx, dy, c) {
  const out = [], n = poly.length;
  for (let j = 0; j < n; j++) {
    const a = poly[j], b = poly[(j + 1) % n], fa = a[0] * dx + a[1] * dy - c, fb = b[0] * dx + b[1] * dy - c;
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
// denah dikurangi lubang persegi [s0, s1] × [v0, v1] dalam kerangka f (a, ux/uy sepanjang, nx/ny ke dalam) → potongan pelat (collider)
function plateMinusHole(pts, f, s0, s1, v0, v1) {
  const cu = f.a[0] * f.ux + f.a[1] * f.uy, cn = f.a[0] * f.nx + f.a[1] * f.ny;
  const mid = clipHalf(clipHalf(pts, -f.ux, -f.uy, -(cu + s0)), f.ux, f.uy, cu + s1);
  return [clipHalf(pts, f.ux, f.uy, cu + s0), clipHalf(pts, -f.ux, -f.uy, -(cu + s1)), clipHalf(mid, f.nx, f.ny, cn + v0), clipHalf(mid, -f.nx, -f.ny, -(cn + v1))]
    .filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 0.05);
}
// tangga lurus setinggi rise sepanjang garis e (a, ux/uy, nx/ny ke dalam): anak tangga di v ∈ [T, T + sw], s ∈ [lo, hi],
// naik ke arah dir. Data sama dengan tangga rumah (bots.js memakai ax/ay/ux/uy/len/ap/land; collide.js rect/dir).
// ap/land = titik tunggu bot di kaki/puncak (jarak d sepanjang tangga, geser v ke sisi dalam): cukup lapang supaya sel grid
// navigasi 1 m yang memuatnya bebas (kalau terblokir, A* bisa menempel ke sel di balik sekat).
function mkStair(e, lo, hi, dir, rise, sw = HOUSE.stairW, apD = 0.9, apV = 0, landD = 0.9, landV = 0) {
  const T = HOUSE.wall, P = onEdge(e), VM = T + sw / 2, bot = dir > 0 ? lo : hi, top = dir > 0 ? hi : lo, bp = P(bot, VM);
  return { rect: [P(lo, T), P(hi, T), P(hi, T + sw), P(lo, T + sw)], ax: bp[0], ay: bp[1], ux: e.ux * dir, uy: e.uy * dir, len: hi - lo, h1: rise, e, lo, hi, dir, sw, ap: P(bot - dir * apD, VM + apV), land: P(top + dir * landD, VM + landV) };
}
// pagar lubang tangga di lantai atas: sisi dalam + ujung kaki tangga dalam satu poligon L (ujung puncak terbuka = jalan keluar)
function railOf(S) {
  const P = onEdge(S.e), T = HOUSE.wall, SW = S.sw || HOUSE.stairW, v1 = T + SW, v2 = v1 + 0.1;
  return [S.dir > 0 ? [P(S.lo - 0.1, T), P(S.lo, T), P(S.lo, v1), P(S.hi, v1), P(S.hi, v2), P(S.lo - 0.1, v2)]
    : [P(S.lo, v1), P(S.hi, v1), P(S.hi, T), P(S.hi + 0.1, T), P(S.hi + 0.1, v2), P(S.lo, v2)]];
}
// jalur tangga (s ∈ [s0, s1], sisi dinding sampai sisi dalam) menyentuh tapak gedung lain?
function clashes(P, s0, s1, T, SW, occ) {
  for (let s = s0; s <= s1 + 1e-6; s += 0.5) for (const v of [T + 0.02, T + SW / 2, T + SW + 0.3]) { const q = P(s, v); if (occ(q[0], q[1])) return true; }
  return false;
}
// lingkaran yang harus kosong di sepanjang tangga (perabot), + titik pendekatan & pendaratan
function stairAvoid(S) {
  const P = onEdge(S.e), VM = HOUSE.wall + (S.sw || HOUSE.stairW) / 2, out = [];
  for (let t = S.lo + 0.4; t < S.hi; t += 0.8) { const c = P(t, VM); out.push({ x: c[0], y: c[1], r: 0.75 + (S.sw || 1) / 2 - 0.5 }); }
  out.push({ x: S.ap[0], y: S.ap[1], r: 1.0 }, { x: S.land[0], y: S.land[1], r: 1.0 });
  return out;
}

// ---------- Pembagian ruang umum ----------
// Potong poligon p dengan garis {q · dir = c}: hanya bila garis memotong tepi tepat dua kali (kedua belahan tetap poligon
// sederhana, juga untuk denah cekung) → { halves: [kiri, kanan], seg: [titik potong 1, titik potong 2] }, selain itu null.
function cutPoly(p, dir, c) {
  const f = p.map((q) => q[0] * dir[0] + q[1] * dir[1] - c), n = p.length;
  if (f.some((v) => Math.abs(v) < 1e-4)) return null; // titik sudut tepat di garis: coba posisi lain
  const A = [], B = [], X = [];
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n, q = p[j];
    (f[j] < 0 ? A : B).push(q);
    if ((f[j] < 0) !== (f[k] < 0)) { const t = f[j] / (f[j] - f[k]), x = lerp2(q, p[k], t); A.push(x); B.push(x); X.push(x); }
  }
  return X.length === 2 ? { halves: [A, B], seg: X } : null;
}
// Bagi denah rumah jadi ruang ±target m² (lebar ≥ 2,4 m): potong berulang sejajar/tegak lurus sisi terpanjang; tiap potongan
// = sekat dengan ambang pintu 1,4 m (potongan < 2,6 m dibiarkan terbuka). Dipakai rumah tidak segi empat & rumah besar.
function splitRooms(H, target) {
  const e0 = H.edges.reduce((a, b) => (b.len > a.len ? b : a)), U = [e0.ux, e0.uy], V = [-e0.uy, e0.ux];
  const ext = (poly, d) => { let lo = Infinity, hi = -Infinity; for (const q of poly) { const v = q[0] * d[0] + q[1] * d[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
  const rec = (poly, depth, seed) => {
    if (Math.abs(signedArea(poly)) <= target * 1.35 || depth > 7) { H.rooms.push(poly); return; }
    const eu = ext(poly, U), ev = ext(poly, V);
    for (const d of eu[1] - eu[0] >= ev[1] - ev[0] ? [U, V] : [V, U]) { // potong melintang sisi yang lebih panjang dulu
      const [lo, hi] = d === U ? eu : ev;
      if (hi - lo < 5) continue;
      for (const fr of [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73]) {
        const cut = cutPoly(poly, d, lo + (hi - lo) * (fr + (hash(seed, fr * 7) - 0.5) * 0.08));
        if (!cut) continue;
        const [P1, P2] = cut.halves;
        if (Math.abs(signedArea(P1)) < 9 || Math.abs(signedArea(P2)) < 9) continue;
        if ([P1, P2].some((P) => { const a = ext(P, U), b = ext(P, V); return a[1] - a[0] < 2.4 || b[1] - b[0] < 2.4; })) continue;
        const [a, b] = cut.seg, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (H.parts.some((p) => { if (!(p.g1 > p.g0)) return false; const ux = (p.b[0] - p.a[0]) / p.len, uy = (p.b[1] - p.a[1]) / p.len, g0 = [p.a[0] + ux * p.g0, p.a[1] + uy * p.g0], g1 = [p.a[0] + ux * p.g1, p.a[1] + uy * p.g1]; return segDist(a, g0, g1) < 0.75 || segDist(b, g0, g1) < 0.75; })) continue; // ujung sekat baru di ambang sekat lama: ambang terbelah
        if (len >= 2.8) { const GW = 1.6, g = (0.3 + hash(seed, 3.3) * 0.4) * (len - GW); H.parts.push({ a, b, len, g0: g, g1: g + GW }); } // ambang 1,6 m: sekat miring pun tetap bisa dilalui grid navigasi bot (1 m)
        rec(P1, depth + 1, seed * 1.31 + 1.7);
        rec(P2, depth + 1, seed * 1.77 + 2.9);
        return;
      }
    }
    H.rooms.push(poly);
  };
  rec(H.pts, 0, H.i * 0.37 + 1);
}

function planHouse(i, pts, area, h, { roadDist, occupied, neighborOcc }) {
  if (area < 8 || h < 2.9) return null;
  const H = { i, pts, h, area, ceil: Math.min(3.0, h - 0.35), edges: edgesOf(pts), doors: [], parts: [], rooms: [], furn: [] };
  // sekat (rumah segi empat): potong sumbu panjang, rumah besar dibagi lagi; denah lain & rumah besar: pembagian umum
  const R = hash(pts[0][0], pts[0][1]);
  if (!(pts.length === 4 && area < 250) && area >= 45) splitRooms(H, Math.min(60, Math.max(28, 18 + area * 0.12)));
  else if (pts.length === 4 && area >= 60) {
    let q = pts;
    const l01 = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), l12 = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
    if (l12 > l01) q = [q[1], q[2], q[3], q[0]];
    const t1 = 0.42 + R * 0.16, A = lerp2(q[0], q[1], t1), Bp = lerp2(q[3], q[2], t1);
    const lenAB = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
    if (lenAB >= 2.6) {
      let g = (0.3 + hash(R, 7) * 0.4) * (lenAB - HOUSE.gapW);
      if (area >= 140 && g < lenAB / 2 + 0.75 && g + HOUSE.gapW > lenAB / 2 - 0.75) g = hash(R, 9) < 0.5 ? Math.max(0.3, lenAB / 2 - 0.75 - HOUSE.gapW) : Math.min(lenAB - 0.3 - HOUSE.gapW, lenAB / 2 + 0.75); // sekat kedua bertemu di tengah AB: ambang jangan terbelah
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
  const roadOf = (e) => { const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2, dm = roadDist(mx, my, true); return dm < 1e8 ? dm : roadDist(mx, my) + 500; };
  const cand = H.edges.filter((e) => e.len >= 2.6).map((e) => ({ e, d: roadOf(e) })).sort((p, q2) => p.d - q2.d);
  // lv = kelonggaran (dipakai bila aturan biasa tidak menemukan tempat): 1 = semua posisi di sisi, cukup 1 m kosong di
  // luar; 2 = tepi & ujung sekat lebih mepet; 3 = pintu sempit 1 m (rumah mungil / sisi pendek)
  const placeDoor = (e, lv = 0) => {
    const W = lv >= 3 ? Math.min(1.0, e.len - 0.36) : HOUSE.doorW, mg = lv >= 3 ? 0.18 : lv >= 2 ? 0.25 : 0.45, n = lv ? 17 : 7;
    for (let k = 0; k < n; k++) {
      const t = lv ? (k + 0.5) / n : 0.3 + hash(i + k * 3.1, e.u0) * 0.4, s = t * e.len, s0 = s - W / 2, s1 = s + W / 2;
      if (s0 < mg || s1 > e.len - mg) continue;
      const px = e.a[0] + e.ux * s, py = e.a[1] + e.uy * s;
      if (H.parts.some((p) => Math.hypot(p.a[0] - px, p.a[1] - py) < (lv >= 2 ? 0.8 : 1.2) || Math.hypot(p.b[0] - px, p.b[1] - py) < (lv >= 2 ? 0.8 : 1.2))) continue;
      if (occupied(px - e.nx * 1.0, py - e.ny * 1.0, i) || (!lv && occupied(px - e.nx * 2.0, py - e.ny * 2.0, i))) continue; // di luar pintu harus kosong
      { // lorong selebar badan (±0,35 m) sejauh 1,5 m (pintu mungil: 1 m) di luar pintu juga kosong (dulu hanya satu titik 1 m)
        let blk = false;
        for (const v of lv >= 3 ? [0.45, 1.0] : [0.45, 1.0, 1.5]) for (const w of [-0.35, 0.35]) if (!blk && occupied(px - e.nx * v + e.ux * w, py - e.ny * v + e.uy * w, i)) blk = true;
        if (blk) continue;
      }
      return { e, s0, s1, u0: e.u0 + s0, u1: e.u0 + s1, x: px, y: py };
    }
    return null;
  };
  let d1 = null;
  for (const c of cand) { d1 = placeDoor(c.e); if (d1) break; }
  for (let lv = 1; lv <= 3 && !d1; lv++) for (const c of H.edges.filter((e) => e.len >= (lv >= 3 ? 1.25 : 2.2)).map((e) => ({ e, d: roadOf(e) })).sort((p, q2) => p.d - q2.d)) { d1 = placeDoor(c.e, lv); if (d1) break; }
  if (!d1) return null; // semua sisi tertutup gedung lain → tetap padat
  H.doors.push(d1);
  if (area >= 45) {
    const dot = (e) => e.ux * d1.e.ux + e.uy * d1.e.uy;
    for (const c of cand.filter((c2) => c2.e !== d1.e && dot(c2.e) < 0.5).sort((p, q2) => dot(p.e) - dot(q2.e))) { const d2 = placeDoor(c.e); if (d2) { H.doors.push(d2); break; } }
  }
  const types = roomTypes(H);
  H.rooms.forEach((r, k) => { r.type = types[k]; });
  const li = types.indexOf('living');
  if (h >= 6.2) { const occ = neighborOcc(i); for (const ri of [li, ...H.rooms.keys()]) { if (ri >= 0 && !H.up) planUpper(H, ri, occ); } } // tangga dulu (prioritas), kamar mandi menyesuaikan
  const av0 = H.avoid, pn0 = H.parts.length;
  planBath(H, types);
  if (H.up && H.bath && !upperReach(H, H.up)) { H.parts.length = pn0; H.bath = null; H.avoid = av0; } // kamar mandi menutup jalan di lantai atas: batal (tangga tetap)
  planPorch(H, d1, roadDist, occupied);
  for (const d of H.doors) { // daun pintu berengsel di ujung celah: lingkaran ayun di dalam bebas perabot
    d.leaves = d.s1 - d.s0 >= 1.3 ? 2 : 1;
    for (const s of d.leaves === 2 ? [d.s0, d.s1] : [d.s0]) { const p = onEdge(d.e)(s, HOUSE.wall + 0.45); (H.avoid || (H.avoid = [])).push({ x: p[0], y: p[1], r: 0.95 }); }
  }
  H.furn = furnish(H, H.rooms, types, H.avoid || [], 0);
  if (H.bath) H.furn.push(...H.bath.fix);
  if (H.up) {
    H.up.furn = furnish(H, H.rooms, H.up.types, H.up.avoid, 1);
    if (H.bath) H.up.furn.push(...H.bath.fix);
    const rectsOf = (L) => L.filter((f) => f.h > 0.3 && f.kind !== 'rug').map(furnitureRect);
    if (!upperReach(H, H.up, rectsOf(H.up.furn))) { // perabot menutup jalan: buang yang dekat ambang sekat / bordes, lalu yang terbesar
      const hot = [H.up.stair.land, ...H.parts.filter((p) => p.g1 > p.g0).map((p) => lerp2(p.a, p.b, (p.g0 + p.g1) / 2 / p.len))];
      H.up.furn = H.up.furn.filter((f) => (H.bath && H.bath.fix.includes(f)) || hot.every((q) => Math.hypot(f.x - q[0], f.y - q[1]) > 1.6 + Math.max(f.w, f.d) / 2));
      for (let g = 0; g < 6 && !upperReach(H, H.up, rectsOf(H.up.furn)); g++) {
        const big = H.up.furn.filter((f) => !(H.bath && H.bath.fix.includes(f)) && f.h > 0.3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
        if (!big) break;
        H.up.furn = H.up.furn.filter((f) => f !== big && !(f.kind === 'rug' && Math.hypot(f.x - big.x, f.y - big.y) < 2));
      }
    }
  }
  for (const d of H.doors) planSwing(H, d, occupied);
  return H;
}
// arah ayun daun pintu rumah (collide.js setDoor): busur 90° tiap daun diuji terhadap sekat, tangga, kamar mandi,
// perabot (dalam) dan gedung lain / tiang teras (luar). d.swing: bit 1 boleh ke dalam, bit 2 boleh ke luar; keduanya
// terhalang → ke dalam dengan sudut maksimum lebih kecil (d.maxA).
function planSwing(H, d, occupied) {
  const e = d.e, T = HOUSE.wall, lw = (d.s1 - d.s0) / d.leaves, P = onEdge(e);
  const rects = H.furn.filter((f) => f.h > 0.05 && f.kind !== 'rug').map(furnitureRect);
  if (H.up) rects.push(H.up.stair.rect);
  if (H.bath) rects.push(H.bath.big);
  const cols = H.porch ? [H.porch.s0 + 0.2, H.porch.s1 - 0.2].map((s) => P(s, -H.porch.D + 0.2)) : [];
  const okPt = (q, inward) => {
    if (inward) return pip(q[0], q[1], H.pts) && !H.parts.some((p) => segDist(q, p.a, p.b) < 0.1) && !rects.some((r) => pip(q[0], q[1], r));
    return !occupied(q[0], q[1], H.i) && cols.every((c) => Math.hypot(c[0] - q[0], c[1] - q[1]) > 0.22) && !pip(q[0], q[1], H.pts);
  };
  const free = (side, A) => {
    for (const [s, du] of d.leaves === 2 ? [[d.s0, 1], [d.s1, -1]] : [[d.s0, 1]]) {
      const v0 = side > 0 ? T : 0;
      for (let a = 0.26; a <= A + 1e-6; a += 0.26) for (let r = 0.25; r <= lw; r += 0.2) {
        const q = P(s + du * Math.cos(a) * r, v0 + side * Math.sin(a) * r);
        if (!okPt(q, side > 0)) return false;
      }
    }
    return true;
  };
  const inn = free(1, Math.PI / 2), out = free(-1, Math.PI / 2);
  d.swing = (inn ? 1 : 0) | (out ? 2 : 0);
  d.maxA = Math.PI / 2;
  if (!d.swing) { d.swing = 1; d.maxA = free(1, 1.31) ? 1.31 : 0.96; } // ±75° / 55°
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
// occ(x, y): titik di tapak gedung lain (dinding tetangga yang menjorok ke dalam rumah ini menutup jalur tangga)
// Keterjangkauan lantai atas dari bordes (raster 0,3 m): bebas = di dalam denah, ≥ 0,5 m dari dinding luar, di luar lubang
// tangga, ≥ 0,36 m dari bagian padat sekat (ambang = lewat) dan perabot (rects). Lulus: ≥ 90 % sel bebas terjangkau dan
// tiap ruang punya sel terjangkau. Menggantikan daftar NO_UP (dulu terikat data peta).
function upperReach(H, up, rects = null) {
  const G = 0.3, S = up.stair, hole = S.rect, land = S.land, parts = up.parts || H.parts;
  // sel dalam kotak batas segmen/poligon (± m) → fn(k, q); hanya sel yang masih bebas
  const around = (B, st, pts, m, fn) => {
    let lx = 1e9, ly = 1e9, hx = -1e9, hy = -1e9;
    for (const p of pts) { lx = Math.min(lx, p[0]); ly = Math.min(ly, p[1]); hx = Math.max(hx, p[0]); hy = Math.max(hy, p[1]); }
    const a0 = Math.max(0, Math.floor((lx - m - B.x0) / G)), a1 = Math.min(B.nx - 1, Math.ceil((hx + m - B.x0) / G)), b0 = Math.max(0, Math.floor((ly - m - B.y0) / G)), b1 = Math.min(B.ny - 1, Math.ceil((hy + m - B.y0) / G));
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const k = b * B.nx + a; if (st[k]) fn(k, [B.x0 + a * G, B.y0 + b * G]); }
  };
  let B = H._reach; // raster dasar (denah, jarak dinding & sekat, ruang) disimpan per rumah: kandidat tangga hanya beda lubangnya
  if (!B || B.pn !== parts.length) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of H.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const nx = Math.ceil((x1 - x0) / G) + 1, ny = Math.ceil((y1 - y0) / G) + 1;
    B = H._reach = { pn: parts.length, x0, y0, nx, ny, big: nx * ny > 40000, base: null, room: null };
    if (!B.big) {
      const base = B.base = new Uint8Array(nx * ny), room = B.room = new Int16Array(nx * ny).fill(-1);
      const all = new Uint8Array(nx * ny).fill(1);
      H.rooms.forEach((r, ri) => around(B, all, r, 0, (k, q) => { if (room[k] < 0 && pip(q[0], q[1], r)) { room[k] = ri; base[k] = 1; } }));
      const clear = (a, b2, m) => around(B, base, [a, b2], m, (k, q) => { if (segDist(q, a, b2) < m) base[k] = 0; });
      for (const e of H.edges) clear(e.a, e.b, 0.5);
      for (const p of parts) {
        const ux = (p.b[0] - p.a[0]) / p.len, uy = (p.b[1] - p.a[1]) / p.len, at = (t) => [p.a[0] + ux * t, p.a[1] + uy * t];
        if (p.g1 > p.g0) { clear(p.a, at(p.g0), 0.36); clear(at(p.g1), p.b, 0.36); } else clear(p.a, p.b, 0.36);
      }
    }
  }
  if (B.big) return true; // rumah sangat besar: tidak diuji (sekat berambang lebar)
  const { x0, y0, nx, ny } = B, st = new Int8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) st[k] = B.base[k] << 1;
  around(B, st, hole, 0.4, (k, q) => { if (pip(q[0], q[1], hole) || segDist(q, hole[0], hole[1]) < 0.3 || segDist(q, hole[1], hole[2]) < 0.4 || segDist(q, hole[2], hole[3]) < 0.4 || segDist(q, hole[3], hole[0]) < 0.4) st[k] = 0; });
  if (rects) for (const r of rects) around(B, st, r, 0, (k, q) => { if (pip(q[0], q[1], r)) st[k] = 0; });
  let free = 0, bd = 1.0, s0 = -1;
  const la = (land[0] - x0) / G, lb = (land[1] - y0) / G;
  for (let k = 0; k < nx * ny; k++) if (st[k] === 2) free++;
  for (let b = Math.max(0, Math.floor(lb - 4)); b <= Math.min(ny - 1, Math.ceil(lb + 4)); b++) for (let a = Math.max(0, Math.floor(la - 4)); a <= Math.min(nx - 1, Math.ceil(la + 4)); a++) { // sel bebas terdekat bordes (≤ 1 m)
    if (st[b * nx + a] !== 2) continue;
    const d = Math.hypot(a - la, b - lb) * G;
    if (d < bd) { bd = d; s0 = b * nx + a; }
  }
  if (!free || s0 < 0) return false;
  const q = new Int32Array(free);
  let qn = 1;
  q[0] = s0; st[s0] = 1;
  for (let h = 0; h < qn; h++) {
    const k = q[h], a = k % nx;
    if (a > 0 && st[k - 1] === 2) { st[k - 1] = 1; q[qn++] = k - 1; }
    if (a < nx - 1 && st[k + 1] === 2) { st[k + 1] = 1; q[qn++] = k + 1; }
    if (k >= nx && st[k - nx] === 2) { st[k - nx] = 1; q[qn++] = k - nx; }
    if (k + nx < nx * ny && st[k + nx] === 2) { st[k + nx] = 1; q[qn++] = k + nx; }
  }
  if (qn < 0.9 * free) return false;
  const seen = new Int8Array(H.rooms.length); // tiap ruang punya sel terjangkau
  for (let k = 0; k < nx * ny; k++) if (st[k] && B.room[k] >= 0) seen[B.room[k]] |= st[k] === 1 ? 2 : 1;
  return !seen.some((v) => v === 1);
}
function planUpper(H, li, occ = null) {
  for (const RUN of [HOUSE.run, 3.6, 3.0]) { if (H.up) return; planUpperRun(H, li, occ, RUN); } // tangga 4,4 → 3,6 → 3,0 m
}
function planUpperRun(H, li, occ, RUN) {
  const rect = isRect(H.edges, 0.1); // segi empat: pelat 3 potong pas dinding; denah lain: pelat = denah dikurangi lubang tangga
  if (H.h < 6.2 || li < 0) return;
  const room = H.rooms[li], T = HOUSE.wall, SW = HOUSE.stairW, F = HOUSE.floor2, VM = T + SW / 2;
  const gaps = H.parts.map((p) => lerp2(p.a, p.b, (p.g0 + p.g1) / 2 / p.len));
  const inR = (p) => pip(p[0], p[1], room);
  const order = H.edges.map((e, k) => k).sort((p, q) => hash(H.i, p * 7.3) - hash(H.i, q * 7.3));
  for (const k of order) {
    const e = H.edges[k], P = onEdge(e);
    if (e.len < RUN + 2 * (T + 1.3)) continue;
    let q0 = e.a, q1 = e.b, q2 = null, q3 = null, Fp = null, Q = P;
    if (rect) {
      const nxt = H.edges[(k + 1) % 4], prv = H.edges[(k + 3) % 4];
      if (Math.min(nxt.len, prv.len) < T + SW + 2.4) continue;
      q2 = nxt.b; q3 = prv.a;
      Fp = (s) => lerp2(q3, q2, s / e.len); // titik di sisi seberang
      Q = (s, v) => { const a = P(s, 0), b = Fp(s), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return lerp2(a, b, Math.min(1, v / L)); };
    }
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
        if (!rect && !inR(P((lo + hi) / 2, T + SW + 1.2))) continue; // denah lain: ada ruang di sisi dalam tangga
        if (occ && clashes(P, lo - 1.4, hi + 1.4, T, SW, occ)) continue;
        const plate = rect ? [[q0, P(lo, 0), Fp(lo), q3], [P(hi, 0), q1, q2, Fp(hi)], [Q(lo, T + SW), Q(hi, T + SW), Fp(hi), Fp(lo)]] : plateMinusHole(H.pts, e, lo, hi, -0.5, T + SW);
        const rail = [[Q(lo, T + SW), Q(hi, T + SW), Q(hi, T + SW + 0.1), Q(lo, T + SW + 0.1)]];
        rail.push(dir > 0 ? [P(lo - 0.1, T), P(lo, T), P(lo, T + SW + 0.1), P(lo - 0.1, T + SW + 0.1)] : [P(hi, T), P(hi + 0.1, T), P(hi + 0.1, T + SW + 0.1), P(hi, T + SW + 0.1)]);
        const bp = P(bot, VM), ring = [];
        for (let s = lo + 0.4; s < hi; s += 0.8) { const c = P(s, VM); ring.push({ x: c[0], y: c[1], r: 0.75 }); }
        const up = {
          floor: F, ceil: Math.min(H.h - 0.25, 6.4), plate, rail,
          render: rect ? null : [{ contour: H.pts, hole: [P(lo, T), P(hi, T), P(hi, T + SW), P(lo, T + SW)] }], // lantai atas digambar sebagai denah berlubang
          stair: { rect: [P(lo, T), P(hi, T), Q(hi, T + SW), Q(lo, T + SW)], ax: bp[0], ay: bp[1], ux: e.ux * dir, uy: e.uy * dir, len: RUN, h1: F, e, lo, hi, dir, ap, land },
          types: H.rooms.map((r, ri) => (ri === li ? 'hall' : 'bedroom')),
          avoid: [...ring, { x: land[0], y: land[1], r: 1.0 }],
          furn: [],
        };
        if (!upperReach(H, up)) continue; // lantai atas tidak terjangkau dari bordes: kandidat berikutnya
        H.up = up;
        H.avoid = [...(H.avoid || []), ...ring, { x: ap[0], y: ap[1], r: 1.0 }];
        return;
      }
    }
  }
}

// ruko & aula: bukaan berkala di sisi depan (dekat jalan), lalu unit / isi aula
function planShop(i, pts, area, h, { roadDist, occupied, fst, neighborOcc }, hallOnly = false) { // hallOnly: gedung jenis 0 yang besar (bukan deret ruko)
  if (area < 60 || pts.length > 160) return null;
  const edges = edgesOf(pts), longest = Math.max(...edges.map((e) => e.len));
  const ruko = !hallOnly && isRect(edges, 0.06) && area <= 3000 && Math.min(edges[0].len, edges[1].len) >= 6;
  const L = ruko ? SHOP : area > 3000 ? HALL_BIG : HALL_SMALL;
  if (h < L.ceil + 0.6) return null;
  const H = { i, kind: ruko ? 'shop' : 'hall', pts, h, area, ceil: L.ceil, edges, doors: [], parts: [], rooms: [], furn: [], open: null, fst };
  const ed = edges.map((e) => roadDist((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2)), per = edges.reduce((s, e) => s + e.len, 0);
  const ranges = [], used = new Set();
  const opsIn = (U0, U1) => { const ops = []; for (let k = Math.floor(U0 / L.P); k * L.P < U1; k++) { const a = k * L.P + L.p, b = (k + 1) * L.P - L.p; if (a >= U0 && b <= U1) ops.push([a, b]); } return ops; };
  if (ruko) { // satu sisi panjang terdekat jalan
    const k = edges.map((e, j) => j).filter((j) => edges[j].len >= longest * 0.6).sort((p, q) => ed[p] - ed[q])[0];
    const ops = opsIn(edges[k].u0 + 0.4, edges[k].u0 + edges[k].len - 0.4);
    if (ops.length) ranges.push({ k0: k, k1: k, ops });
  } else for (let t = 0; t < 2; t++) { // aula: sisi-sisi berurutan yang menghadap jalan (tanpa melewati titik awal cincin)
    let k0 = -1;
    const far = !t && !edges.some((e, k) => e.len >= 2 && ed[k] < 45) ? Infinity : 45; // tak ada jalan ≤ 45 m: sisi terdekat jalan
    edges.forEach((e, k) => { if (!used.has(k) && e.len >= 2 && ed[k] < far && (k0 < 0 || ed[k] < ed[k0])) k0 = k; });
    if (k0 < 0) break;
    let a = k0, b = k0, len = edges[k0].len;
    const ok = (k) => k >= 0 && k < edges.length && !used.has(k) && ed[k] < far;
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
  for (const r of ranges) for (const [a, b] of r.ops) for (let k = r.k0; k <= r.k1; k++) { // bukaan yang melewati sudut ditiadakan
    // (dulu dipotong per sisi → sisa celah 0,03–1,2 m yang tampak berlubang tapi tidak bisa dilewati); shader world.js memakai aturan sama
    const e = edges[k], s0 = a - e.u0, s1 = b - e.u0;
    if (s0 < -0.01 || s1 > e.len + 0.01) continue;
    const sm = (s0 + s1) / 2;
    H.doors.push({ e, s0, s1, u0: e.u0 + s0, u1: e.u0 + s1, h: L.top, x: e.a[0] + e.ux * sm, y: e.a[1] + e.uy * sm });
  }
  if (!H.doors.length) return null;
  H.open = { A: [ranges[0].A, ranges[0].B], B: ranges[1] ? [ranges[1].A, ranges[1].B] : [-9, -9], P: L.P, p: L.p, top: L.top };
  // kanopi: ruko = satu kanopi menerus sepanjang deret bukaan; aula = kanopi bertiang di tiap pintu masuk (per sisi)
  H.canopies = [];
  if (ruko) { const r = ranges[0], e = edges[r.k0]; H.canopies.push({ e, s0: Math.max(0.1, r.A - e.u0 - 0.4), s1: Math.min(e.len - 0.1, r.B - e.u0 + 0.4), d: 1.5, z: L.top + 0.12, cols: false }); }
  else for (const d of H.doors) if (d.s1 - d.s0 > 3) H.canopies.push({ e: d.e, s0: Math.max(0.1, d.s0 - 1.2), s1: Math.min(d.e.len - 0.1, d.s1 + 1.2), d: 3.0, z: L.top + 0.35, cols: true });
  if (ruko) planUnits(H, ranges[0], h >= 6.4 ? neighborOcc(i) : null);
  else { planHall(H, L, (p) => occupied(p[0], p[1], i, h + 0.5)); if (h >= 8.4) planHallUpper(H, L, (p) => occupied(p[0], p[1], i, h + 0.5)); }
  return H;
}
// Aula/mal lantai 2 (3,5 m): atrium persegi di tengah (lubang pelat berpagar), tangga lebar di dalam atrium naik ke tepi
// atrium, kios/bangku/taman di sekeliling atrium, deret etalase di dinding lantai 2 (digambar), kaca fasad lantai 2 berlubang.
// Lantai dasar: plafon 3,25 m, bukaan masuk setinggi 3 m.
function planHallUpper(H, L, other) {
  const T = HOUSE.wall, SW = 1.6, RISE = 3.5, RUN = 5.2;
  const e0 = H.edges.reduce((a, b) => (b.len > a.len ? b : a)), ux = e0.ux, uy = e0.uy, nx = e0.nx, ny = e0.ny, ox = e0.a[0], oy = e0.a[1];
  const W = (s, v) => [ox + ux * s + nx * v, oy + uy * s + ny * v];
  let s0 = Infinity, s1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of H.pts) { const s = (p[0] - ox) * ux + (p[1] - oy) * uy, v = (p[0] - ox) * nx + (p[1] - oy) * ny; s0 = Math.min(s0, s); s1 = Math.max(s1, s); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const edgeD = (p) => { let m = Infinity; for (const e of H.edges) m = Math.min(m, segDist(p, e.a, e.b)); return m; };
  const ok = (p, m) => pip(p[0], p[1], H.pts) && edgeD(p) > m && !other(p);
  let aw = Math.min(30, Math.max(RUN + 4, (s1 - s0) * 0.32)), ad = Math.min(18, Math.max(SW + 5, (v1 - v0) * 0.32)), A = null;
  const CORN = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
  for (let t = 0; t < 7 && !A; t++, aw = Math.max(RUN + 3.2, aw * 0.85), ad = Math.max(SW + 4.4, ad * 0.85)) {
    let best = 5 + Math.min(aw, ad) / 2; // pusat atrium sejauh mungkin dari dinding; calon yang tidak lebih baik tidak diuji sudutnya
    const ds = Math.max(1.5, (s1 - s0) / 50), dv = Math.max(1.5, (v1 - v0) / 50);
    for (let s = s0 + 2; s < s1; s += ds) for (let v = v0 + 2; v < v1; v += dv) {
      const c = W(s, v);
      if (!pip(c[0], c[1], H.pts)) continue;
      const d = edgeD(c);
      if (d <= best || other(c)) continue;
      let good = true;
      for (const [a, b] of CORN) { const q = W(s + a * aw / 2, v + b * ad / 2); if (!ok(q, 5)) { good = false; break; } }
      // pendaratan tangga (di luar ujung atrium, lajur tangga) harus lapang: bukan dinding / tapak gedung lain (menara di atas podium)
      if (good) good = [0.4, 1.4, 2.8].every((ds2) => [-0.9, 0, 0.9].every((dv2) => {
        const q = W(s + aw / 2 + ds2, v - ad / 2 + T + SW / 2 + dv2);
        return ok(q, 0.8) && !other([q[0] + 0.6, q[1]]) && !other([q[0] - 0.6, q[1]]) && !other([q[0], q[1] + 0.6]) && !other([q[0], q[1] - 0.6]);
      }));
      if (good) { best = d; A = { s, v, aw, ad }; }
    }
  }
  if (!A) return;
  // kerangka atrium: pangkal di pojok (s − aw/2, v − ad/2), u sepanjang sisi panjang, n ke dalam atrium
  const fa = { a: W(A.s - A.aw / 2, A.v - A.ad / 2), ux, uy, nx, ny, len: A.aw };
  const Pa = onEdge(fa), S = mkStair(fa, A.aw - RUN, A.aw, 1, RISE, SW, 1.4, 0, 1.4, 0); // naik ke ujung atrium → mendarat di lantai 2 di luar tepinya
  const hole = [Pa(0, 0), Pa(A.aw, 0), Pa(A.aw, A.ad), Pa(0, A.ad)];
  const inA = (p, m = 0) => { const s = (p[0] - fa.a[0]) * ux + (p[1] - fa.a[1]) * uy, v = (p[0] - fa.a[0]) * nx + (p[1] - fa.a[1]) * ny; return s > -m && s < A.aw + m && v > -m && v < A.ad + m; };
  // pagar keliling atrium (0,1 m), terbuka di tempat tangga tiba (sisi ujung s = aw, v ∈ [T, T + SW])
  const rail = [], rr = (a, b, c, d) => rail.push([a, b, c, d]);
  rr(Pa(-0.1, -0.1), Pa(A.aw + 0.1, -0.1), Pa(A.aw + 0.1, 0), Pa(-0.1, 0));
  rr(Pa(-0.1, A.ad), Pa(A.aw + 0.1, A.ad), Pa(A.aw + 0.1, A.ad + 0.1), Pa(-0.1, A.ad + 0.1));
  rr(Pa(-0.1, 0), Pa(0, 0), Pa(0, A.ad), Pa(-0.1, A.ad));
  rr(Pa(A.aw, T + SW + 0.1), Pa(A.aw + 0.1, T + SW + 0.1), Pa(A.aw + 0.1, A.ad), Pa(A.aw, A.ad));
  // lantai dasar: kolom, lampu & perabot yang jatuh di bawah atrium/tangga dibuang (atrium terbuka sampai plafon lantai 2)
  H.furn = H.furn.filter((f) => !inA([f.x, f.y], 1.4) && !(f.kind === 'column' && inA([f.x, f.y], 2.0)));
  H.lights = (H.lights || []).filter((m) => !inA(m, 0.8));
  H.ceil = 3.25;
  for (const f of H.furn) if (f.kind === 'column') f.h = H.ceil;
  H.open.top = Math.min(H.open.top, 3.0);
  for (const d of H.doors) d.h = Math.min(d.h, 3.0);
  // lantai 2: kolom di titik grid yang sama dengan lantai dasar, kios/bangku/taman/kafe di cincin sekeliling atrium
  const upC = Math.min(H.h - 0.6, 7.4), furn = [], lights = [], rot = Math.atan2(uy, ux), G = L.G;
  const add = (kind, p, w, d, h) => furn.push({ kind, x: p[0], y: p[1], rot, w, d, h });
  const busy = [[S.land[0], S.land[1], 2.6]];
  const freeU = (p, r) => busy.every(([x, y, q]) => Math.hypot(p[0] - x, p[1] - y) > r + q);
  for (const f of H.furn) if (f.kind === 'column') { add('column', [f.x, f.y], 0.7, 0.7, upC - RISE); busy.push([f.x, f.y, 0.6]); }
  // deret toko tertutup (etalase kaca menghadap atrium) di dua sisi panjang atrium, lorong 3,5 m dari pagar
  const SD = 4.2, SWD = 5.6;
  for (const side of [-1, 1]) {
    const vC = side < 0 ? -3.5 - SD / 2 : A.ad + 3.5 + SD / 2, fx = side < 0 ? nx : -nx, fy = side < 0 ? ny : -ny, ro = Math.atan2(-fx, fy);
    for (let s = -3; s + SWD <= A.aw + 3; s += SWD + 0.8) {
      const c = Pa(s + SWD / 2, vC), cor = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => Pa(s + SWD / 2 + a * SWD / 2, vC + b * SD / 2));
      if (!cor.every((q) => ok(q, 0.8)) || !ok(c, 0.8) || Math.hypot(c[0] - S.land[0], c[1] - S.land[1]) < 6) continue;
      furn.push({ kind: 'shopunit', x: c[0], y: c[1], rot: ro, w: SWD, d: SD, h: upC - RISE });
      busy.push([c[0], c[1], 3.4]);
    }
  }
  for (let s = Math.floor(s0 / G) * G; s <= s1; s += G) for (let v = Math.floor(v0 / G) * G; v <= v1; v += G) {
    const m = W(s + G / 2, v + G / 2), r = hash(m[0] * 0.41 + 3, m[1] * 0.67);
    if (!ok(m, 2.4) || inA(m, 2.6)) continue;
    lights.push(m);
    if (!freeU(m, 1.8)) continue;
    if (r < 0.3) add('kiosk', m, 2.4, 2.4, 1.15);
    else if (r < 0.5) { add('table', W(s + G / 2 - G * 0.22, v + G / 2), 1.2, 0.8, 0.75); add('table', W(s + G / 2 + G * 0.22, v + G / 2), 1.2, 0.8, 0.75); }
    else if (r < 0.66) { add('planter', m, 1.6, 1.6, 0.8); add('bench', W(s + G / 2, v + G / 2 + 1.6), 1.8, 0.5, 0.45); add('bench', W(s + G / 2, v + G / 2 - 1.6), 1.8, 0.5, 0.45); }
    else continue;
    busy.push([m[0], m[1], 2.0]);
  }
  H.up = {
    floor: RISE, ceil: upC, plate: plateMinusHole(H.pts, fa, 0, A.aw, 0, A.ad), rail, stair: S, types: H.rooms.map(() => 'hall'), parts: [],
    avoid: stairAvoid(S), furn: furn.filter((f) => !other([f.x, f.y])), lights, render: [{ contour: H.pts, hole }], atrium: { hole, f: fa, aw: A.aw, ad: A.ad }, // perabot di tapak gedung lain (menara di atas podium) dibuang
  };
}
function planUnits(H, r, occ = null) {
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
  if (H.h >= 6.4 && Lv >= 9.9) planShopUpper(H, e, bounds, Lv, occ);
}
// Ruko lantai 2 (3,5 m): unit berpasangan (j−1, j) untuk j ganjil — tangga lurus di unit j menempel sekat kanannya (naik ke
// belakang), lantai atas pasangan itu satu ruang (kantor / gudang / hunian); sekat antar-pasangan di atas berambang 1,6 m dekat
// depan sehingga seluruh lantai atas tersambung; jendela fasad lantai 2 berlubang. Bot memakai tangga pertama (H.up.stair).
function planShopUpper(H, e, bounds, Lv, occ) {
  const T = HOUSE.wall, SW = 1.0, RISE = 3.5, RUN = 4.4, P = onEdge(e), vTop = Lv - T - 1.8, vFoot = vTop - RUN, n = bounds.length - 1;
  const tryStair = (j) => { // tangga di unit j (menempel sekat kanannya); null bila sempit / terhalang dinding tetangga
    const sA = bounds[j], sB = bounds[j + 1];
    if (sB - sA < 3.6) return null;
    const pe = { a: P(sB, 0), ux: e.nx, uy: e.ny, nx: -e.ux, ny: -e.uy, len: Lv }; // garis sepanjang sekat kanan, ke belakang
    if (occ && clashes(onEdge(pe), vFoot - 1.5, Lv - T - 0.3, T, SW, occ)) return null;
    return { j, S: mkStair(pe, vFoot, vTop, 1, RISE, SW, 1.2, 0.5, 0.9, 0.5), pe, sB };
  };
  let pairs = true, got = [];
  for (let j = n > 1 ? 1 : 0; j < n; j += 2) { const g = tryStair(j); if (g) got.push(g); }
  if (!got.length) { pairs = false; for (let j = 0; j < n && !got.length; j++) { const g = tryStair(j); if (g) got.push(g); } } // cadangan: satu tangga di unit mana saja
  if (!got.length) return;
  const stairs = got.map((g) => g.S), rail = [], avoid = [], keep = [];
  for (const g of got) {
    rail.push(...railOf(g.S));
    avoid.push(...stairAvoid(g.S));
    const Pe = onEdge(g.pe);
    const cw = T + SW + (g === got[0] ? 1.7 : 0.8); // lorong lurus dari bukaan depan ke kaki tangga (tangga utama/bot: lebih lebar, grid navigasi 1 m)
    keep.push([Pe(0, 0), Pe(vTop + 0.2, 0), Pe(vTop + 0.2, T + SW + 0.35), Pe(vFoot - 1.7, T + SW + 0.35), Pe(vFoot - 1.7, cw), Pe(0, cw)]);
  }
  // pelat lantai 2 (collider & gambar): jalur depan dan belakang selebar deretan + potongan tengah di antara lubang tangga
  const R4 = (s0, s1, v0, v1) => [P(s0, v0), P(s1, v0), P(s1, v1), P(s0, v1)], plate = [R4(0, e.len, 0, vFoot), R4(0, e.len, vTop, Lv)];
  let s = 0;
  for (const g of got) { const h0 = g.sB - T - SW, h1 = Math.min(e.len, g.sB + 0.02); if (h0 - s > 0.05) plate.push(R4(s, h0, vFoot, vTop)); s = h1; }
  if (e.len - s > 0.05) plate.push(R4(s, e.len, vFoot, vTop));
  // perabot lantai dasar yang menimpa tangga dibuang
  const kb = keep.map((K) => [Math.min(...K.map((q) => q[0])), Math.min(...K.map((q) => q[1])), Math.max(...K.map((q) => q[0])), Math.max(...K.map((q) => q[1]))]);
  H.furn = H.furn.filter((f) => {
    const r = Math.hypot(f.w, f.d) / 2 + 0.6;
    for (let k = 0; k < keep.length; k++) {
      const K = keep[k], b = kb[k];
      if (f.x < b[0] - r || f.x > b[2] + r || f.y < b[1] - r || f.y > b[3] + r) continue;
      const fr = furnitureRect(f);
      if (fr.some((q) => pip(q[0], q[1], K)) || K.some((q) => pip(q[0], q[1], fr)) || pip(f.x, f.y, K)) return false;
    }
    return true;
  });
  H.ceil = 3.25;
  // lantai atas: ruang per pasangan unit (sekat di dalam pasangan tidak ada), sekat antar-pasangan berambang
  const keepPart = (j) => !pairs || j % 2 === 0; // sekat di bounds[j] (H.parts[j − 1])
  const parts = H.parts.filter((p, k) => keepPart(k + 1)).map((p) => ({ ...p, g0: 0.8, g1: 2.4 }));
  const rooms = [];
  for (let j = 0; j < n; j += pairs ? 2 : 1) { const sA = bounds[j], sB = bounds[Math.min(n, j + (pairs ? 2 : 1))]; const r = [P(sA, 0), P(sB, 0), P(sB, Lv), P(sA, Lv)]; rooms.push(r); }
  const types = rooms.map((r, j) => { const q = hash(H.i + j * 5.1, 2.7); return q < 0.4 ? 'office' : q < 0.7 ? 'storage' : 'bedroom'; });
  H.up = { floor: RISE, ceil: Math.min(H.h - 0.4, 6.3), plate, rail, stair: stairs[0], stairs, types, avoid, parts, rooms, furn: [] };
  H.up.furn = furnish(H, rooms, types, avoid, 1, parts, RISE);
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
function planHall(H, L, other) { // other(p): titik di dalam gedung lain (menara di atas podium) → kosong
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
  const inside = (p, m) => pip(p[0], p[1], H.pts) && edgeD(p) > m && !other(p) && !other([p[0] + m, p[1]]) && !other([p[0] - m, p[1]]) && !other([p[0], p[1] + m]) && !other([p[0], p[1] - m]);
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

// ---------- Menara & gedung publik: lobi + lift ke atap ----------
// Lobi lantai dasar: pintu kaca 4 m di sisi yang menghadap jalan (≤ 2) dengan kanopi bertiang, meja resepsionis, kolom,
// sofa tunggu, tanaman, inti lift di bawah penthouse atap (map/world.js roofTop → D.roofs). Fasad: bukaan pintu dilubangi
// lewat tabel uOpen seperti aula (rentang A/B, periode P sangat besar = tepat satu bukaan per rentang).
const TOWER = { top: 3.0, doorW: 4.0, P: 100000 };
function planTower(i, pts, area, h, { roadDist, occupied, heightUnder }, roof, kind) {
  const FH = kind === 2 ? 3.7 : 3.3, ceil = FH - 0.3; // tinggi lantai = pola jendela fasad (menara 3,7 m, gedung publik 3,3 m)
  if (h < FH + 1.5 || area < 60) return null;
  const edges = edgesOf(pts), T = HOUSE.wall;
  const H = { i, kind: 'tower', pts, h, area, ceil, edges, doors: [], parts: [], rooms: [pts], furn: [], open: null, canopies: [], roof: roof || null, lights: [] };
  pts.type = 'lobby';
  const roadOf = (e) => { const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2, dm = roadDist(mx, my, true); return dm < 1e8 ? dm : roadDist(mx, my) + 500; };
  const cand = edges.filter((e) => e.len >= TOWER.doorW + 2).map((e) => ({ e, d: roadOf(e) })).sort((p, q) => p.d - q.d);
  const place = (e, W, lax = false) => { // lax: menara berdiri di atas podium (gedung lain) → pintu membuka ke dalam podium
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const s = t * e.len, s0 = s - W / 2, s1 = s + W / 2;
      if (s0 < 1 || s1 > e.len - 1) continue;
      const px = e.a[0] + e.ux * s, py = e.a[1] + e.uy * s;
      if (!lax && [0.6, 1.5, 3.5].some((v) => occupied(px - e.nx * v, py - e.ny * v, i))) continue; // di luar pintu kosong (juga celah sempit ke dinding podium)
      if (lax && !(occupied(px - e.nx * 1.5, py - e.ny * 1.5, i) && occupied(px - e.nx * 4.5, py - e.ny * 4.5, i))) continue; // podium: menghadap ruang dalam podium (≥ 4,5 m), bukan dinding luarnya
      return { e, s0, s1, u0: e.u0 + s0, u1: e.u0 + s1, h: TOWER.top, x: px, y: py, inner: lax };
    }
    return null;
  };
  let d1 = null;
  for (const c of cand) { d1 = place(c.e, TOWER.doorW); if (d1) break; }
  if (!d1) for (const e of edges) { if (e.len >= 3.4) { d1 = place(e, 2.4); if (d1) break; } }
  if (!d1) for (const c of cand) { d1 = place(c.e, TOWER.doorW, true); if (d1) break; }
  if (!d1) return null;
  if (d1.inner) { H.ceil = Math.min(H.ceil, 4.45); H.floorZ = 0.045; } // di dalam podium: lantai & plafon lobi tidak berimpit dengan milik podium
  H.doors.push(d1);
  if (area >= 500) for (const c of cand) { // pintu kedua: sisi lain yang juga menghadap jalan
    if (c.e === d1.e || c.d > 40 || c.e.ux * d1.e.ux + c.e.uy * d1.e.uy > 0.3) continue;
    const d2 = place(c.e, TOWER.doorW);
    if (d2) { H.doors.push(d2); break; }
  }
  H.open = { A: [H.doors[0].u0, H.doors[0].u1], B: H.doors[1] ? [H.doors[1].u0, H.doors[1].u1] : [-9, -9], P: TOWER.P, p: 0, top: TOWER.top };
  const edgeD = (p) => { let m = Infinity; for (const e of edges) m = Math.min(m, segDist(p, e.a, e.b)); return m; };
  const other = (x, y) => occupied(x, y, i, h + 0.5); // menara lain yang menjulang dari lobi ini (gedung ini podiumnya)
  const inside = (p, m) => pip(p[0], p[1], pts) && edgeD(p) > m && !other(p[0], p[1]) && !other(p[0] + m, p[1]) && !other(p[0] - m, p[1]) && !other(p[0], p[1] + m) && !other(p[0], p[1] - m);
  const add = (kind, x, y, rot, w, d, hh) => { const f = { kind, x, y, rot, w, d, h: hh, room: 0 }; H.furn.push(f); return f; };
  for (const d of H.doors) { // kanopi bertiang di luar pintu; daun pintu kaca geser terbuka di kiri-kanan bukaan
    const e = d.e, rot = Math.atan2(e.uy, e.ux), W = d.s1 - d.s0;
    if (!d.inner) H.canopies.push({ e, s0: Math.max(0.1, d.s0 - 1.2), s1: Math.min(e.len - 0.1, d.s1 + 1.2), d: 3.0, z: TOWER.top + 0.35, cols: true });
    if (W >= 3) for (const s of [d.s0 + 0.5, d.s1 - 0.5]) add('glassdoor', e.a[0] + e.ux * s + e.nx * T / 2, e.a[1] + e.uy * s + e.ny * T / 2, rot, 0.95, 0.06, TOWER.top - 0.05);
  }
  // inti lift: di bawah penthouse atap (sumbu penthouse), pintu lift menghadap pintu masuk utama
  const ent = [d1.x + d1.e.nx * 2, d1.y + d1.e.ny * 2];
  let cx, cy, ux, uy;
  if (roof && roof.pent) ({ x: cx, y: cy, ux, uy } = roof.pent);
  else {
    const e0 = edges.reduce((a, b) => (b.len > a.len ? b : a)); ux = e0.ux; uy = e0.uy;
    let best = -1;
    for (const p of pts) for (const q of pts) { const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], dd = inside(m, 0) ? edgeD(m) : -1; if (dd > best) { best = dd; cx = m[0]; cy = m[1]; } }
  }
  const CW = 5.6, CD = 3.0;
  let lift = null;
  for (const [bx, by] of [[-uy, ux], [uy, -ux], [ux, uy], [-ux, -uy]].sort((p, q) => ((q[0] * (ent[0] - cx) + q[1] * (ent[1] - cy)) - (p[0] * (ent[0] - cx) + p[1] * (ent[1] - cy))))) {
    const ax = by, ay = -bx; // sepanjang muka pintu lift (b = arah hadap)
    const corner = (a, b) => [cx + ax * a + bx * b, cy + ay * a + by * b];
    if (![corner(-CW / 2, -CD / 2), corner(CW / 2, -CD / 2), corner(CW / 2, CD / 2 + 3), corner(-CW / 2, CD / 2 + 3)].every((p) => inside(p, 1.0))) continue;
    const rot = Math.atan2(-bx, by); // lokal +b (= (−sin, cos) rot) menghadap keluar muka pintu lift
    add('liftcore', cx, cy, rot, CW, CD, H.ceil);
    lift = { x: cx + bx * CD / 2, y: cy + by * CD / 2, nx: bx, ny: by, w: CW };
    H.core = { x: cx, y: cy, ux: ax, uy: ay, w: CW, d: CD, rot }; // poros lift sampai atap (collide.js)
    break;
  }
  if (!lift) return H; // denah terlalu sempit untuk inti lift: lobi saja
  H.lift = lift;
  const busy = [[lift.x + lift.nx * 2, lift.y + lift.ny * 2, 3.2], [cx, cy, 3.6], ...H.doors.map((d) => [d.x + d.e.nx * 2.5, d.y + d.e.ny * 2.5, 3.6])];
  const free = (p, r) => busy.every(([x, y, rr]) => Math.hypot(p[0] - x, p[1] - y) > r + rr);
  { // meja resepsionis: 5–6 m dari pintu utama, bergeser ke samping, menghadap pintu
    const e = d1.e, rot = Math.atan2(e.nx, -e.ny);
    for (const side of [1, -1]) {
      const p = [d1.x + e.nx * 5.5 + e.ux * side * 3.4, d1.y + e.ny * 5.5 + e.uy * side * 3.4];
      if (!inside(p, 1.6) || !free(p, 1.6)) continue;
      add('reception', p[0], p[1], rot, 3.0, 0.8, 1.1);
      busy.push([p[0], p[1], 2.2]);
      break;
    }
  }
  // grid 8 m sejajar inti lift: kolom (lobi besar), sofa tunggu + meja, tanaman, lampu plafon
  const G = 8, rotG = Math.atan2(uy, ux);
  let s0 = Infinity, s1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of pts) { const s = (p[0] - cx) * ux + (p[1] - cy) * uy, v = -(p[0] - cx) * uy + (p[1] - cy) * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const W2 = (s, v) => [cx + ux * s - uy * v, cy + uy * s + ux * v];
  let seats = 0;
  for (let s = Math.floor(s0 / G) * G; s <= s1; s += G) for (let v = Math.floor(v0 / G) * G; v <= v1; v += G) {
    const c = W2(s + G / 2, v + G / 2), k = W2(s, v), r = hash(c[0] * 0.37 + i, c[1] * 0.71);
    if (area > 700 && inside(k, 1.8) && free(k, 0.8)) { add('column', k[0], k[1], rotG, 0.7, 0.7, H.ceil); busy.push([k[0], k[1], 0.6]); }
    if (!inside(c, 2.0)) continue;
    H.lights.push(c);
    if (!inside(c, 3.4) || !free(c, 2.4)) continue;
    if (seats < 3 && r < 0.6) { // dua sofa berhadapan + meja + tanaman
      const a = W2(s + G / 2, v + G / 2 - 1.25), b = W2(s + G / 2, v + G / 2 + 1.25), pl = W2(s + G / 2 + 1.7, v + G / 2);
      add('sofa', a[0], a[1], rotG, 2.0, 0.85, 0.82); add('sofa', b[0], b[1], rotG + Math.PI, 2.0, 0.85, 0.82);
      add('coffee', c[0], c[1], rotG, 1.0, 0.55, 0.42); add('plant', pl[0], pl[1], rotG, 0.45, 0.45, 1.1);
      busy.push([c[0], c[1], 2.4]);
      seats++;
    } else if (r > 0.8) { add('planter', c[0], c[1], rotG, 1.6, 1.6, 0.8); busy.push([c[0], c[1], 1.2]); }
  }
  for (const sd of [-1, 1]) { const p = [lift.x + lift.nx * 1.2 + lift.ny * sd * (CW / 2 + 0.6), lift.y + lift.ny * 1.2 - lift.nx * sd * (CW / 2 + 0.6)]; if (inside(p, 0.6)) add('plant', p[0], p[1], 0, 0.45, 0.45, 1.1); } // tanaman di kiri-kanan pintu lift
  if (!H.lights.length) H.lights.push([cx, cy]);
  // Lantai atas (dicapai dengan lift; bot tidak naik): pelat tiap FH m sampai di bawah atap — di atas podium bila menara
  // berdiri di dalam gedung lain. Semua lantai memakai SATU denah kantor (H.fl): mesh-nya dibangun sekali lalu dipindah
  // ke ketinggian lantai yang sedang dikunjungi (interiors update), perabotnya jadi rintangan sementara (collide.js).
  const deck = roof ? roof.z : h - 0.9, podH = heightUnder(cx, cy, i);
  H.FH = FH; H.floors = [];
  for (let k = 1; (k + 1) * FH <= deck + 0.01; k++) if (k * FH > (podH ? podH + 0.5 : 0)) H.floors.push(Math.round(k * FH * 1000) / 1000);
  if (!H.floors.length) return H;
  const F = { i, kind: 'floor', pts, edges, doors: [], parts: [], rooms: [pts], furn: [], ceil, h: FH, area, lights: [], spots: [], FH, floorZ: 0.02 };
  const addF = (kind2, x, y, rot, w, d, hh) => F.furn.push({ kind: kind2, x, y, rot, w, d, h: hh, room: 0 });
  addF('liftcore', cx, cy, H.core.rot, CW, CD, ceil);
  const fb = [[lift.x + lift.nx * 2.4, lift.y + lift.ny * 2.4, 3.2], [cx, cy, 3.6]]; // lobi lift lapang
  const freeF = (p, r) => fb.every(([x, y, rr]) => Math.hypot(p[0] - x, p[1] - y) > r + rr);
  for (let s = Math.floor(s0 / G) * G; s <= s1; s += G) for (let v = Math.floor(v0 / G) * G; v <= v1; v += G) {
    const c = W2(s + G / 2, v + G / 2), k = W2(s, v), r = hash(c[0] * 0.53 + i * 1.3, c[1] * 0.29);
    if (area > 700 && inside(k, 1.8) && freeF(k, 0.8)) { addF('column', k[0], k[1], rotG, 0.7, 0.7, ceil); fb.push([k[0], k[1], 0.6]); }
    if (!inside(c, 2.0)) continue;
    F.lights.push(c);
    // kluster meja ±2 m dari kaca: pinggir jendela tetap lapang (bisa mendekat & membidik ke luar)
    if (!inside(c, 3.6) || !freeF(c, 2.0)) { F.spots.push(c); continue; }
    if (r < 0.55) { // 4 meja kantor 2 × 2 saling berhadapan, kursi di sisi luar
      for (const su of [-0.75, 0.75]) for (const sv of [-0.4, 0.4]) { const p = W2(s + G / 2 + su, v + G / 2 + sv); addF('officedesk', p[0], p[1], sv > 0 ? rotG + Math.PI : rotG, 1.4, 0.7, 0.75); }
      fb.push([c[0], c[1], 2.0]);
      F.spots.push(W2(s + G / 2 + 2.6, v + G / 2), W2(s + G / 2 - 2.6, v + G / 2));
    } else if (r < 0.7) { addF('table', c[0], c[1], rotG, 2.4, 1.0, 0.75); fb.push([c[0], c[1], 1.9]); F.spots.push(W2(s + G / 2, v + G / 2 + 2.6)); }
    else if (r < 0.82) {
      const a = W2(s + G / 2, v + G / 2 - 1.25), b = W2(s + G / 2, v + G / 2 + 1.25), pl = W2(s + G / 2 + 1.7, v + G / 2);
      addF('sofa', a[0], a[1], rotG, 2.0, 0.85, 0.82); addF('sofa', b[0], b[1], rotG + Math.PI, 2.0, 0.85, 0.82);
      addF('coffee', c[0], c[1], rotG, 1.0, 0.55, 0.42); addF('plant', pl[0], pl[1], rotG, 0.45, 0.45, 1.1);
      fb.push([c[0], c[1], 2.4]);
      F.spots.push(W2(s + G / 2 - 2.4, v + G / 2));
    } else F.spots.push(c);
  }
  for (const sd of [-1, 1]) { const p = [lift.x + lift.nx * 1.2 + lift.ny * sd * (CW / 2 + 0.6), lift.y + lift.ny * 1.2 - lift.nx * sd * (CW / 2 + 0.6)]; if (inside(p, 0.6)) addF('plant', p[0], p[1], 0, 0.45, 0.45, 1.1); }
  if (!F.lights.length) F.lights.push([cx, cy]);
  // titik barang: di dalam lantai, jauh dari perabot & poros lift
  const rectD = (p, f) => { const c = Math.cos(f.rot), sn = Math.sin(f.rot), dx = p[0] - f.x, dy = p[1] - f.y, a = Math.max(0, Math.abs(dx * c + dy * sn) - f.w / 2), b = Math.max(0, Math.abs(-dx * sn + dy * c) - f.d / 2 - (f.kind === 'officedesk' || f.kind === 'table' ? 0.6 : 0)); return Math.hypot(a, b); };
  F.spots = F.spots.filter((p) => inside(p, 0.8) && F.furn.every((f) => rectD(p, f) > 0.5));
  H.fl = F;
  return H;
}

// ---------- Perabot rumah ----------
const ITEMS = {
  sofa: [2.0, 0.85, 0.82], coffee: [1.0, 0.55, 0.42], tv: [1.6, 0.45, 0.55], shelf: [1.0, 0.36, 1.8], plant: [0.45, 0.45, 1.1],
  bed: [1.6, 2.0, 0.55], wardrobe: [1.2, 0.6, 2.0], side: [0.45, 0.45, 0.5], desk: [1.2, 0.6, 0.75],
  counter: [2.2, 0.6, 0.9], fridge: [0.7, 0.7, 1.8], table: [1.4, 0.85, 0.75],
};
const LIST = { living: ['sofa', 'tv', 'coffee', 'shelf', 'plant'], bedroom: ['bed', 'wardrobe', 'side', 'desk'], kitchen: ['counter', 'fridge', 'table'], hall: ['shelf', 'plant', 'side'], office: ['desk', 'shelf', 'plant', 'side', 'desk'], storage: ['shelf', 'wardrobe', 'shelf', 'side'] };
// avoid: lingkaran {x, y, r} yang harus kosong (tangga, pendekatan, pendaratan); seed: variasi per lantai
function furnish(H, rooms, types, avoid, seed, parts = H.parts, zf = 0) { // parts: sekat lantai ini (ruko lantai 2: sekat berambang); zf: tinggi lantai
  const R = (k) => hash(H.i * 1.7 + k + seed * 101.3, H.pts[0][0]);
  const placed = [];
  // ambang sekat (termasuk pintu kamar mandi): perabot berjarak ≥ 0,9 m dari tiap titik ambang (dulu hanya titik tengahnya,
  // sehingga ranjang/lemari di ujung ambang bisa menutup jalan masuk ruang)
  const gapPts = [];
  for (const p of parts) if (p.g1 > p.g0) { const ux = (p.b[0] - p.a[0]) / p.len, uy = (p.b[1] - p.a[1]) / p.len; for (let t = 0; t <= 4; t++) { const s = p.g0 + (p.g1 - p.g0) * t / 4; gapPts.push(p.a[0] + ux * s, p.a[1] + uy * s); } }
  const blocksGap = (x, y, rot, w, d) => { const c = Math.cos(rot), sn = Math.sin(rot); for (let k = 0; k < gapPts.length; k += 2) { const dx = gapPts[k] - x, dy = gapPts[k + 1] - y, a = Math.max(0, Math.abs(dx * c + dy * sn) - w / 2), b = Math.max(0, Math.abs(-dx * sn + dy * c) - d / 2); if (a * a + b * b < 0.81) return true; } return false; };
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
        if (sofa) { const x = sofa.x + sofa.nx * 1.15, y = sofa.y + sofa.ny * 1.15; if (pip(x, y, room) && !hits(x, y, 0.6) && !blocksGap(x, y, sofa.rot, ITEMS.coffee[0], ITEMS.coffee[1])) placed.push({ kind, x, y, rot: sofa.rot, w: ITEMS.coffee[0], d: ITEMS.coffee[1], h: ITEMS.coffee[2], room: ri, nx: sofa.nx, ny: sofa.ny }); }
        continue;
      }
      if (kind === 'table') { // meja makan di tengah ruang (bukan di depan ambang sekat: meja + kursi ±1,9 m)
        const cx = room.reduce((s, p) => s + p[0], 0) / room.length, cy = room.reduce((s, p) => s + p[1], 0) / room.length, e0 = edges[0];
        const nearGap = parts.some((p) => p.g1 > p.g0 && Math.hypot(p.a[0] + (p.b[0] - p.a[0]) * (p.g0 + p.g1) / 2 / p.len - cx, p.a[1] + (p.b[1] - p.a[1]) * (p.g0 + p.g1) / 2 / p.len - cy) < 2.2);
        if (e0 && !nearGap && pip(cx, cy, room) && !hits(cx, cy, 1.1) && !blocksGap(cx, cy, Math.atan2(e0.uy, e0.ux), ITEMS.table[0], ITEMS.table[1] + 1.02)) placed.push({ kind, x: cx, y: cy, rot: Math.atan2(e0.uy, e0.ux), w: ITEMS.table[0], d: ITEMS.table[1], h: ITEMS.table[2], room: ri, nx: e0.nx, ny: e0.ny });
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
        if (parts.some((p) => { const gx = p.a[0] + (p.b[0] - p.a[0]) * ((p.g0 + p.g1) / 2 / p.len), gy = p.a[1] + (p.b[1] - p.a[1]) * ((p.g0 + p.g1) / 2 / p.len); return Math.hypot(gx - x, gy - y) < Math.max(w, d) / 2 + 1.0; }) || blocksGap(x, y, Math.atan2(e.uy, e.ux), w, d)) continue;
        // perabot tinggi tidak menutup jendela (dinding luar)
        if (h > 1.1) {
          const ext = H.edges.find((E) => Math.abs((bx - E.a[0]) * E.nx + (by - E.a[1]) * E.ny) < 0.3 && (bx - E.a[0]) * E.ux + (by - E.a[1]) * E.uy > -0.1 && (bx - E.a[0]) * E.ux + (by - E.a[1]) * E.uy < E.len + 0.1);
          if (ext) {
            const u = ext.u0 + (bx - ext.a[0]) * ext.ux + (by - ext.a[1]) * ext.uy, sm = u - ext.u0;
            let blockWin = false;
            if (H.kind) blockWin = !(H.blind && H.blind.has(ext.j)) && bandHoles(ext, H.fst | 0, zf + 0.5, zf + 2.2).some((q) => q[0] < sm + w / 2 + 0.1 && q[1] > sm - w / 2 - 0.1);
            else for (let du = -w / 2; du <= w / 2; du += 0.25) if (houseWindow(u + du, 1.6)) blockWin = true;
            if (blockWin) continue;
          }
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
  lobbyWall: '#dcd5c8', officeWall: '#e4e1da', core: '#cfc8bb', steel: '#a3aab3', alu: '#3b3f46', tint: '#6f8ea6',
};
// Lubang jendela fasad pada sisi e di pita tinggi [zA, zB] (lantai atas ruko/aula, lantai menara) menurut gaya fasad st
// (= shader world.js & collide.js bandWin): 2 menara, 1 ruko/gedung publik, 4 mal, 0 rumah (jendela sah ≥ 0,3 m dari sudut).
// abs = false: pola diulang per FH (templat lantai menara di z lokal 0; lantai sebenarnya kelipatan FH). → [s0, s1, v0, v1]
const BAND_ST = { 2: [1.7, 3.7, 0.07, 0.1, 0.93], 1: [2.6, 3.3, 0.16, 0.36, 0.78], 0: [3.6, 3.3, 0.3, 0.36, 0.78] };
function bandHoles(e, st, zA, zB, abs = true) {
  const out = [];
  if (st === 4) { // mal: pita kaca tiap 3,9 m mulai 4,1 m, kaca per 2 m; papan reklame (u mod 46 ∈ [8, 20], v 4,6–7) tanpa kaca
    for (let n = Math.max(0, Math.floor((zA - 4.1) / 3.9)); 4.1 + n * 3.9 < zB; n++) {
      const v0 = Math.max(zA, 4.1 + (n + 0.22) * 3.9), v1 = Math.min(zB, 4.1 + (n + 0.62) * 3.9);
      if (v1 - v0 < 0.05) continue;
      for (let k = Math.floor(e.u0 / 2); k * 2 < e.u0 + e.len; k++) {
        const u0 = k * 2 + 0.06, u1 = k * 2 + 1.94, bx = u0 - Math.floor(u0 / 46) * 46;
        if (bx < 20 && bx + 1.88 > 8 && v0 < 7.0 && v1 > 4.6) continue;
        const s0 = Math.max(0, u0 - e.u0), s1 = Math.min(e.len, u1 - e.u0);
        if (s1 - s0 > 0.15) out.push([s0, s1, v0, v1]);
      }
    }
    return out;
  }
  const [bay, fh, x0, y0, y1] = BAND_ST[st] || BAND_ST[1];
  for (let n = Math.floor(zA / fh); n * fh < zB; n++) {
    const v0 = Math.max(zA, (n + y0) * fh), v1 = Math.min(zB, (n + y1) * fh);
    if (v1 - v0 < 0.05 || (abs && v1 <= 0.8)) continue;
    for (let k = Math.floor(e.u0 / bay); k * bay < e.u0 + e.len; k++) {
      let s0 = k * bay + x0 * bay - e.u0, s1 = (k + 1) * bay - x0 * bay - e.u0;
      if (st === 0) { if (s0 < 0.3 || s1 > e.len - 0.3) continue; }
      else { s0 = Math.max(0, s0); s1 = Math.min(e.len, s1); }
      if (s1 - s0 > 0.15) out.push([s0, s1, v0, v1]);
    }
  }
  return out;
}
const COLORS = new Map(); // warna perabot per kode hex (dipakai bersama, jangan diubah isinya)
const colorOf = (hex) => { let c = COLORS.get(hex); if (!c) COLORS.set(hex, (c = new THREE.Color(hex))); return c; };
// col (opsional, map/collide.js): perabot lantai menara yang sedang dikunjungi jadi rintangan sementara (addFurnLayer)
// furn (opsional, map/furniture.js): pustaka perabot 3D berinstans; null = perabot kotak
export function createInteriors(scene, W, homes, col = null, furn = null) {
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
  const frec = new Map(); // indeks gedung → rekaman perabot 3D (furn.commit), dilepas saat interior ditutup
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
  // generator: yield di sela pekerjaan (per sisi dinding, per beberapa perabot) → update() mencicil dengan anggaran waktu;
  // nilai akhir = grup mesh interior
  // penampung verteks bersama (satu interior dibangun pada satu waktu): Float32Array yang membesar sendiri — jauh lebih
  // sedikit sampah memori daripada larik JS (jeda GC saat banyak rumah dibuka)
  let VP = new Float32Array(3 << 15), VN = new Float32Array(3 << 15), VC = new Float32Array(3 << 15), VS = new Float32Array(1 << 15), vn = 0;
  const grow = () => { const g = (a) => { const b = new Float32Array(a.length * 2); b.set(a); return b; }; VP = g(VP); VN = g(VN); VC = g(VC); VS = g(VS); };
  function* buildGen(H, fb = null) { // fb: batch perabot 3D (furn.begin) atau null
    vn = 0;
    const c = new THREE.Color();
    const mk = (P, N, Cc, S, material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
      if (S) g.setAttribute('sfc', new THREE.BufferAttribute(S, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      return m;
    };
    const grp = new THREE.Group();
    grp.matrixAutoUpdate = false;
    const flush = () => { grp.add(mk(VP.slice(0, vn * 3), VN.slice(0, vn * 3), VC.slice(0, vn * 3), VS.slice(0, vn), mat)); vn = 0; };
    // gedung besar (mal): geometri dipecah per ±20 ribu verteks supaya pembuatan buffer juga tercicil antarframe
    const cut = () => { if (vn > 20000) flush(); };
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
    const vtx = (x, y, z, nx, ny, nz, r, g, bb) => { // data (x, y, z) → three (x, z, −y)
      if (vn * 3 + 3 > VP.length) grow();
      const k = vn * 3;
      VP[k] = x; VP[k + 1] = z; VP[k + 2] = -y; VN[k] = nx; VN[k + 1] = nz; VN[k + 2] = -ny; VC[k] = r; VC[k + 1] = g; VC[k + 2] = bb; VS[vn++] = ST;
    };
    const tri = (a, b, d, n, cc) => { vtx(a[0], a[1], a[2], n[0], n[1], n[2], cc.r, cc.g, cc.b); vtx(b[0], b[1], b[2], n[0], n[1], n[2], cc.r, cc.g, cc.b); vtx(d[0], d[1], d[2], n[0], n[1], n[2], cc.r, cc.g, cc.b); };
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
    const BX = new Float64Array(8); // sudut kotak (dipakai ulang: perabot mal ribuan kotak)
    const flatHole = (poly, hole, z, upF, cc) => { // denah berlubang (lubang tangga / atrium), lantai atau plafon
      const v2 = poly.map((p) => new THREE.Vector2(p[0], p[1])), h2 = hole.map((p) => new THREE.Vector2(p[0], p[1]));
      if (THREE.ShapeUtils.isClockWise(v2)) v2.reverse();
      if (!THREE.ShapeUtils.isClockWise(h2)) h2.reverse();
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(v2, [h2]); } catch (e) { return; }
      const all = [...v2, ...h2];
      for (const t of tris) {
        let a = all[t[0]], b = all[t[1]], d = all[t[2]];
        if ((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x) > 0 !== upF) { const tmp = b; b = d; d = tmp; }
        tri([a.x, a.y, z], [b.x, b.y, z], [d.x, d.y, z], [0, 0, upF ? 1 : -1], cc);
      }
    };
    const box = (x, y, rot, w, d, z0, z1, cc, top = true) => {
      z0 += Z; z1 += Z;
      const cs = Math.cos(rot), sn = Math.sin(rot), hw = w / 2, hd = d / 2;
      BX[0] = x - hw * cs + hd * sn; BX[1] = y - hw * sn - hd * cs; BX[2] = x + hw * cs + hd * sn; BX[3] = y + hw * sn - hd * cs;
      BX[4] = x + hw * cs - hd * sn; BX[5] = y + hw * sn + hd * cs; BX[6] = x - hw * cs - hd * sn; BX[7] = y - hw * sn + hd * cs;
      for (let j = 0; j < 4; j++) {
        const ax = BX[2 * j], ay = BX[2 * j + 1], bx = BX[(2 * j + 2) & 7], by = BX[(2 * j + 3) & 7], ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey) || 1;
        const nx = ey / L, ny = -ex / L, k = j % 2 ? 0.88 : 1, r = cc.r * k, g = cc.g * k, bb = cc.b * k; // normal keluar (kotak CCW)
        vtx(ax, ay, z0, nx, ny, 0, r, g, bb); vtx(bx, by, z0, nx, ny, 0, r, g, bb); vtx(bx, by, z1, nx, ny, 0, r, g, bb);
        vtx(ax, ay, z0, nx, ny, 0, r, g, bb); vtx(bx, by, z1, nx, ny, 0, r, g, bb); vtx(ax, ay, z1, nx, ny, 0, r, g, bb);
      }
      if (top) {
        const r = cc.r * 1.06, g = cc.g * 1.06, bb = cc.b * 1.06;
        vtx(BX[0], BX[1], z1, 0, 0, 1, r, g, bb); vtx(BX[2], BX[3], z1, 0, 0, 1, r, g, bb); vtx(BX[4], BX[5], z1, 0, 0, 1, r, g, bb);
        vtx(BX[0], BX[1], z1, 0, 0, 1, r, g, bb); vtx(BX[4], BX[5], z1, 0, 0, 1, r, g, bb); vtx(BX[6], BX[7], z1, 0, 0, 1, r, g, bb);
      }
    };
    const T = HOUSE.wall, house = !H.kind, tower = H.kind === 'tower', flr = H.kind === 'floor', up = H.up, ceil = H.ceil, topZ = up ? up.ceil : ceil;
    const wallC = new THREE.Color(house ? COL.wall[H.i % COL.wall.length] : H.kind === 'hall' ? COL.hallWall : tower ? COL.lobbyWall : flr ? COL.officeWall : COL.shopWall[H.i % 3]);
    const jambC = new THREE.Color(COL.jamb), ceilC = new THREE.Color(COL.ceil);
    // lantai per ruang (+ kamar mandi berubin biru di tiap lantai)
    // mode realistis: kamar tidur berlantai kayu, ruang lain ubin keramik (warna dari tekstur; warna verteks hanya tinta)
    const RF = !!W.real, plainF = new THREE.Color('#f4f1ea'), bathF = new THREE.Color('#cfe2ea'), shopF = new THREE.Color('#e6e6e6'), lobbyF = new THREE.Color(RF ? '#a8a196' : '#b9b2a6'), officeF = new THREE.Color(RF ? '#8f979f' : '#7d8590');
    for (const r of H.rooms) {
      ST = RF ? (house && r.type === 'bedroom' ? 3 : 2) : 0;
      flat(r, H.floorZ || 0.025, true, tower ? lobbyF : flr ? officeF : RF ? (house ? plainF : shopF) : new THREE.Color(house ? COL.floor[r.type] || COL.floor.living : H.kind === 'hall' ? COL.tile2 : COL.tile));
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
      const slabC = new THREE.Color(COL.slab), stF = RF ? (house ? 3 : 2) : 0, upFC = RF ? (house ? plainF : shopF) : new THREE.Color(house ? COL.upFloor : COL.tile2);
      if (up.render) for (const R0 of up.render) { flatHole(R0.contour, R0.hole, ceil, false, ceilC); ST = stF; flatHole(R0.contour, R0.hole, up.floor + 0.02, true, upFC); ST = 0; } // denah berlubang (rumah tidak segi empat, atrium aula)
      else for (const pc of up.plate) { flat(pc, ceil, false, ceilC); ST = stF; flat(pc, up.floor + 0.02, true, upFC); ST = 0; }
      cut(); yield;
      // tepi lubang (tebal pelat): atrium 4 sisi; tangga rumah 3 sisi (sisi keempat = dinding luar); tangga ruko + sisi sekat
      if (up.atrium) { const hl = up.atrium.hole; for (let j = 0; j < 4; j++) { const a = hl[j], b = hl[(j + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ex = (b[0] - a[0]) / L, ey = (b[1] - a[1]) / L; wallRect(a, ex, ey, 0, L, ceil, up.floor, -ey, ex, slabC); } }
      else for (const S of up.stairs || [up.stair]) {
        const e = S.e, P = onEdge(e), SW = S.sw || HOUSE.stairW, v0 = H.kind ? -0.02 : T;
        wallRect(P(S.lo, T + SW), e.ux, e.uy, 0, S.hi - S.lo, ceil, up.floor, -e.nx, -e.ny, slabC);
        wallRect(P(S.lo, v0), e.nx, e.ny, 0, T + SW - v0, ceil, up.floor, e.ux, e.uy, slabC);
        wallRect(P(S.hi, v0), e.nx, e.ny, 0, T + SW - v0, ceil, up.floor, -e.ux, -e.uy, slabC);
        if (H.kind) wallRect(P(S.lo, v0), e.ux, e.uy, 0, S.hi - S.lo, ceil, up.floor, e.nx, e.ny, slabC);
      }
      flat(H.pts, up.ceil, false, ceilC);
    } else flat(H.pts, ceil, false, ceilC);
    cut(); yield;
    // sisi dalam dinding luar: lubang pintu/bukaan & jendela per lantai (sama dengan shader), kusen di tiap lubang
    for (const e of H.edges) {
      cut(); yield;
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
      } else if ((flr || (up && H.kind)) && !(H.blind && H.blind.has(e.j))) { // lantai menara / lantai 2 ruko & aula: kaca fasad yang berlubang saat lantai terbuka
        const st = flr ? (H.FH === 3.7 ? 2 : 1) : H.fst | 0;
        for (const [s0, s1, v0, v1] of flr ? bandHoles(e, st, H.floorZ, ceil, false) : bandHoles(e, st, up.floor + 0.02, up.ceil)) holes.push([s0, s1, v0, v1, false]);
      }
      // potong permukaan dinding di sekitar lubang: kolom-kolom s, tiap kolom bisa punya beberapa lubang (per lantai);
      // pojok cekung: sisi dalam diperpanjang sampai titik temunya (e.x0/e.x1, sama dengan collider) supaya tidak bercelah
      const cuts = new Set([holes.some((h0) => h0[0] < 0.05) ? 0 : -e.x0, holes.some((h0) => h0[1] > e.len - 0.05) ? e.len : e.len + e.x1]);
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
      } else if (tower) { // pintu kaca lobi: kusen aluminium tebal + balok atas
        const aluC = new THREE.Color(COL.alu), rot = Math.atan2(e.uy, e.ux), O = (s, d) => [e.a[0] + e.ux * s - e.nx * d, e.a[1] + e.uy * s - e.ny * d];
        for (const [s0, s1, , v1] of holes) {
          for (const s of [s0 - 0.07, s1 + 0.07]) { const p = O(s, 0.06); boxX(p[0], p[1], rot, 0.14, 0.12, 0, v1 + 0.16, aluC); }
          const pm = O((s0 + s1) / 2, 0.06);
          boxX(pm[0], pm[1], rot, s1 - s0 + 0.28, 0.12, v1, v1 + 0.16, aluC);
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
        cut(); yield;
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
    }
    if (H.kind === 'hall' || tower || flr) { // lampu panel di plafon (aula 2 lantai: juga plafon lantai 2)
      const lightC = new THREE.Color('#fffdf2');
      for (const [L0, z] of [[H.lights || [], ceil - 0.03], [(up && up.lights) || [], up ? up.ceil - 0.03 : 0]]) { for (const m of L0) { const r = 0.7; quad([m[0] - r, m[1] - r, z], [m[0] - r, m[1] + r, z], [m[0] + r, m[1] + r, z], [m[0] + r, m[1] - r, z], [0, 0, -1], lightC); } cut(); yield; }
    }
    // sekat: dua sisi, ambang pintu di tengah (sekat toko: penuh)
    let np = 0;
    for (const [z0, z1, PL] of up ? [[0, ceil, H.parts], [up.floor, up.ceil, up.parts || H.parts]] : [[0, ceil, H.parts]]) for (const p of PL) {
      if (++np % 6 === 0) { cut(); yield; }
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
    // tangga, pagar tangga (panel miring), pagar lubang di lantai atas (aula: pagar kaca keliling atrium)
    if (up) {
      const stepC = new THREE.Color(H.kind === 'hall' ? '#c9c4bb' : COL.step), stepC2 = new THREE.Color(H.kind === 'hall' ? '#b7b2a8' : COL.step2), railC = new THREE.Color(COL.rail), F = up.floor;
      let ns = 0;
      for (const S of up.stairs || [up.stair]) {
        if (++ns % 3 === 0) { cut(); yield; } // ruko: belasan tangga
        const e = S.e, P = onEdge(e), SW = S.sw || HOUSE.stairW, N = 18, rise = S.h1 / N, run = S.len / N, rotE = Math.atan2(e.uy, e.ux);
        for (let k = 0; k < N; k++) { const s = S.dir > 0 ? S.lo + (k + 0.5) * run : S.hi - (k + 0.5) * run, p = P(s, T + SW / 2); box(p[0], p[1], rotE, run + 0.004, SW, 0, (k + 1) * rise, k % 2 ? stepC : stepC2); }
        const bot = S.dir > 0 ? S.lo : S.hi, topS = S.dir > 0 ? S.hi : S.lo;
        for (const v of up.atrium ? [T - 0.02, T + SW + 0.02] : [T + SW + 0.02]) { // panel pagar miring di sisi tangga
          const pb = P(bot, v), pt = P(topS, v), A0 = [pb[0], pb[1], 0], A1 = [pt[0], pt[1], S.h1 - 0.15], A2 = [pt[0], pt[1], S.h1 + 0.95], A3 = [pb[0], pb[1], 0.95];
          quadAuto(A0, A1, A2, A3, railC); quadAuto(A0, A3, A2, A1, railC);
        }
        if (up.atrium) continue;
        const mid = P((S.lo + S.hi) / 2, T + SW + 0.05), be = P(bot - S.dir * 0.05, T + (SW + 0.1) / 2);
        box(mid[0], mid[1], rotE, S.hi - S.lo, 0.1, F, F + 0.95, railC);
        box(be[0], be[1], rotE + Math.PI / 2, SW + 0.1, 0.1, F, F + 0.95, railC);
      }
      if (up.atrium) { // pagar kaca + pegangan logam di tepi atrium (sesuai collider up.rail)
        const glassC = new THREE.Color('#9fb7c4'), barC = new THREE.Color(COL.metal);
        for (const r of up.rail) { const [a, b, , d] = r, L = Math.hypot(b[0] - a[0], b[1] - a[1]), W2 = Math.hypot(d[0] - a[0], d[1] - a[1]), cx = (r[0][0] + r[2][0]) / 2, cy = (r[0][1] + r[2][1]) / 2, ro = Math.atan2(b[1] - a[1], b[0] - a[0]); box(cx, cy, ro, L, Math.max(0.03, W2 * 0.4), F, F + 0.95, glassC); box(cx, cy, ro, L, W2, F + 0.95, F + 1.02, barC); }
      }
    }
    // perabot
    const C = colorOf, R = (k) => hash(H.i + k, 7.7);
    const goods = (x, y, rot, w, d, z, at, seed) => { // deret barang warna-warni di satu tingkat rak
      const n = Math.max(1, Math.round(w / 1.3));
      for (let j = 0; j < n; j++) { const p = at(-w / 2 + (j + 0.5) * w / n, 0); box(p[0], p[1], rot, w / n - 0.08, d - 0.12, z, z + 0.2 + R(j * 3 + seed) * 0.1, C(COL.goods[Math.floor(R(j * 7 + seed * 13) * COL.goods.length)])); }
    };
    function drawFurn(f) {
      if (fb && fb.add(f, Z)) return; // model 3D berinstans (map/furniture.js); kotak di bawah = cadangan
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
        case 'shopunit': { // toko tertutup lantai 2 mal: kotak sampai plafon, etalase kaca gelap di sisi +b, kusen, papan nama
          box(x, y, rot, w, d, 0, h, C('#e6e2da'), false);
          const g = fwd(d / 2 + 0.015), sg = fwd(d / 2 + 0.03);
          box(g[0], g[1], rot, w - 0.5, 0.03, 0.12, 2.75, C('#3d4b5e'), false);
          for (const sd of [-1, 1]) { const p = at(sd * (w / 2 - 0.19), d / 2 + 0.03); box(p[0], p[1], rot, 0.12, 0.06, 0, 2.85, C('#cfd3da'), false); }
          box(sg[0], sg[1], rot, w - 0.2, 0.06, 2.85, 3.35, C(['#c0392b', '#2471a3', '#1e8449', '#d4ac0d', '#7d3c98', '#D29F52', '#3D3782', '#e67e22'][((Math.round(x * 7 + y * 3) % 8) + 8) % 8]), false);
          break;
        }
        case 'kiosk': { box(x, y, rot, w, d, 0, h - 0.06, C(COL.kiosk)); box(x, y, rot, w + 0.06, d + 0.06, h - 0.06, h, C(COL.gold)); for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = at(a * (w / 2 - 0.05), b * (d / 2 - 0.05)); box(p[0], p[1], rot, 0.06, 0.06, h, 2.3, C(COL.gold)); } box(x, y, rot, w, d, 2.3, 2.42, C(COL.kiosk)); break; }
        case 'planter': box(x, y, rot, w, d, 0, h - 0.1, C(COL.planter)); box(x, y, rot + 0.5, w * 0.8, d * 0.8, h - 0.1, h + 0.5, C(COL.plant)); break;
        case 'bench': box(x, y, rot, w, d, 0.38, h, C(COL.bench)); for (const s of [-1, 1]) { const lg = at(s * (w / 2 - 0.12), 0); box(lg[0], lg[1], rot, 0.08, d * 0.9, 0, 0.38, C(COL.dark), false); } break;
        // lobi menara
        case 'liftcore': { // inti lift berlapis batu: dua pintu lift baja (muka +b), kusen, tombol panggil, penunjuk lantai
          box(x, y, rot, w, d, 0, h, C(COL.core));
          const steel = C(COL.steel), fr = C(COL.alu);
          for (const a of [-w / 4, w / 4]) {
            const p = at(a, d / 2 + 0.03), q = at(a, d / 2 + 0.05), sg = at(a, d / 2 + 0.035);
            box(p[0], p[1], rot, 1.42, 0.06, 0, 2.48, fr);
            box(q[0], q[1], rot, 1.16, 0.04, 0, 2.3, steel);
            box(sg[0], sg[1], rot, 0.02, 0.1, 0.02, 2.28, C('#5d636c'), false); // celah tengah pintu
            box(p[0], p[1], rot, 0.9, 0.08, 2.6, 2.78, C('#1d1f24')); // penunjuk lantai
            box(q[0], q[1], rot, 0.22, 0.06, 2.64, 2.74, C('#f0a830'));
          }
          const bt = at(0, d / 2 + 0.03);
          box(bt[0], bt[1], rot, 0.16, 0.06, 1.0, 1.36, C('#2a2d33')); box(bt[0], bt[1], rot, 0.07, 0.09, 1.12, 1.24, C('#f0d080'));
          break;
        }
        case 'reception': { const fr = fwd(d / 2 + 0.02); box(x, y, rot, w, d, 0, h - 0.06, C('#4a4038')); box(x, y, rot, w + 0.08, d + 0.08, h - 0.06, h, C('#efe9df')); box(fr[0], fr[1], rot, w * 0.94, 0.02, 0.35, 0.5, C(COL.gold)); const mn = at(w * 0.22, -0.1); box(mn[0], mn[1], rot, 0.5, 0.05, h, h + 0.36, C(COL.dark)); break; }
        case 'glassdoor': box(x, y, rot, w, d, 0, h, C(COL.tint)); box(x, y, rot, w + 0.04, d + 0.04, h - 0.08, h, C(COL.alu)); box(x, y, rot, w + 0.04, d + 0.04, 0, 0.1, C(COL.alu)); break;
        case 'officedesk': { // meja kantor: daun meja, panel samping & depan, monitor (+b), kursi beroda di belakang (−b)
          const top = C('#d9d4ca'), pnl = C('#5a5f68'), seat = C('#2f3440');
          box(x, y, rot, w, d, h - 0.04, h, top);
          for (const s of [-1, 1]) { const lg = at(s * (w / 2 - 0.03), 0); box(lg[0], lg[1], rot, 0.04, d, 0, h - 0.04, pnl, false); }
          { const pn = fwd(d / 2 - 0.03); box(pn[0], pn[1], rot, w - 0.08, 0.03, 0.3, h - 0.04, pnl, false); }
          { const mo = fwd(d / 2 - 0.16); box(mo[0], mo[1], rot, 0.56, 0.04, h + 0.12, h + 0.46, C(COL.dark)); box(mo[0], mo[1], rot, 0.08, 0.08, h, h + 0.12, C(COL.dark), false); }
          { const ch = fwd(-d / 2 - 0.32), bk = fwd(-d / 2 - 0.55); box(ch[0], ch[1], rot, 0.48, 0.46, 0.42, 0.5, seat); box(bk[0], bk[1], rot, 0.46, 0.06, 0.5, 1.05, seat); box(ch[0], ch[1], rot, 0.06, 0.06, 0, 0.42, C(COL.metal), false); }
          break;
        }
        default: box(x, y, rot, w, d, 0, h, C(COL.wood));
      }
    }
    let nf = 0;
    const NF = H.kind === 'hall' ? 1 : 8; // rak mal berat (±0,6 ms per rak berisi barang): satu per langkah
    for (const f of H.furn) { drawFurn(f); if (++nf % NF === 0) { cut(); yield; } }
    if (up) { Z = up.floor; for (const f of up.furn) { drawFurn(f); if (++nf % NF === 0) { cut(); yield; } } Z = 0; }
    cut(); yield;
    if (vn) flush();
    if (xp.length) { const ex = mk(new Float32Array(xp), new Float32Array(xn), new Float32Array(xc), null, outMat); ex.castShadow = true; grp.add(ex); }
    return grp;
  }
  // ---------- Daun pintu rumah (buka-tutup; keadaan di col.doors) ----------
  // Satu InstancedMesh daun kayu prosedural (engsel di x = 0, lebar 0,85 m diskala per pintu, panel timbul kedua sisi,
  // gagang). Slot dipesan saat interior rumah terbuka, dilepas saat ditutup; matriks hanya ditulis saat dipesan dan selama
  // daun beranimasi. Rumah yang belum terbuka: shader fasad (world.js) menggambar daun tertutup / rongga gelap (terbuka).
  const leaves = (() => {
    if (!col || !col.doors || !col.doors.length) return null;
    const pos = [], nor = [], clr = [];
    const box = (x0, x1, y0, y1, z0, z1, k) => {
      const F = [[[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]], [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
        [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]], [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]]];
      for (const [n, q] of F) for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) { pos.push(...v); nor.push(...n); clr.push(...k); }
    };
    const LW = 0.85, LH = 2.15, LT = 0.045, wood = [1, 1, 1], pan = [0.82, 0.82, 0.82], brass = [2.2, 2.3, 2.6];
    box(0, LW, 0, LH, -LT / 2, LT / 2, wood);
    for (const sd of [-1, 1]) {
      const z0 = sd * LT / 2, z1 = z0 + sd * 0.012;
      for (const [y0, y1] of [[0.2, 0.95], [1.1, 1.95]]) box(0.14, LW - 0.14, y0, y1, Math.min(z0, z1), Math.max(z0, z1), pan);
      box(LW - 0.1, LW - 0.07, 0.98, 1.06, Math.min(z0, z0 + sd * 0.06), Math.max(z0, z0 + sd * 0.06), brass); // gagang
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    const m = W.real ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, envMap: W.real.env, envMapIntensity: 0.8 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    const byB = new Map();
    for (const D of col.doors) (byB.get(D.b) || byB.set(D.b, []).get(D.b)).push(D);
    const L = { g, m, mesh: null, cap: 0, free: [], used: 0, live: new Set(), byB, LW, stamp: -1, last: performance.now(), shown: new Map() };
    return L;
  })();
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(), c4 = new THREE.Color(), Y4 = new THREE.Vector3(0, 1, 0);
  function leafMesh(need) {
    const L = leaves;
    if (L.mesh && need <= L.cap) return;
    let cap = L.cap || 512;
    while (cap < need) cap *= 2;
    const old = L.mesh, mesh = new THREE.InstancedMesh(L.g, L.m, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = old ? old.count : 0;
    if (old) { mesh.instanceMatrix.array.set(old.instanceMatrix.array); mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); mesh.instanceColor.array.set(old.instanceColor.array); scene.remove(old); old.dispose(); }
    else mesh.setColorAt(0, c4.setRGB(1, 1, 1));
    for (let k = L.cap; k < cap; k++) L.free.push(cap - 1 - (k - L.cap));
    mesh.frustumCulled = false;
    mesh.castShadow = !!W.real; mesh.receiveShadow = true;
    scene.add(mesh);
    L.mesh = mesh; L.cap = cap;
  }
  const ease = (t) => 1 - (1 - t) * (1 - t);
  function leafPose(D) { // tulis matriks daun pintu D menurut D.t
    const M = leaves.mesh, a = D.dir * ease(D.t) * D.maxA, lw = D.w / D.leaves;
    for (let l = 0; l < D.slots.length; l++) {
      const du = l === 0 ? 1 : -1, s = l === 0 ? 0 : D.w;
      const hx = D.ax + D.ux * s + D.nx * D.T / 2, hy = D.ay + D.uy * s + D.ny * D.T / 2;
      const vx = Math.cos(a) * D.ux * du + Math.sin(a) * D.nx, vy = Math.cos(a) * D.uy * du + Math.sin(a) * D.ny;
      q4.setFromAxisAngle(Y4, Math.atan2(vy, vx));
      M.setMatrixAt(D.slots[l], m4.compose(p4.set(hx, D.z + 0.02, -hy), q4, s4.set(lw / leaves.LW, 1, 1)));
    }
    M.instanceMatrix.needsUpdate = true;
  }
  function leavesOn(H, on) {
    const L = leaves;
    if (!L || H.kind) return;
    const list = L.byB.get(H.i);
    if (!list) return;
    for (const D of list) {
      if (on && !D.slots) {
        leafMesh(L.used + D.leaves);
        D.slots = [];
        const wc = fract(Math.sin(H.i * 12.9898 + 3.1 * 78.233) * 43758.5453); // warna kayu per rumah = shader fasad h21(hbi, 3,1): (0,36, 0,23, 0,14) × (0,85 + 0,3·hash)
        for (let l = 0; l < D.leaves; l++) {
          const k = L.free.pop();
          D.slots.push(k); L.used++;
          if (k >= L.mesh.count) L.mesh.count = k + 1;
          L.mesh.setColorAt(k, c4.setRGB(0.36, 0.23, 0.14).multiplyScalar(0.85 + 0.3 * wc));
        }
        L.mesh.instanceColor.needsUpdate = true;
        D.t = D.open ? 1 : 0;
        leafPose(D);
        L.live.add(D);
      } else if (!on && D.slots) {
        for (const k of D.slots) { L.mesh.setMatrixAt(k, m4.makeScale(0, 0, 0)); L.free.push(k); L.used--; }
        L.mesh.instanceMatrix.needsUpdate = true;
        D.slots = null;
        L.live.delete(D);
      }
    }
  }
  function leavesTick() { // animasi daun (t → open, 0,3 dtk) + keadaan pintu untuk fasad jauh
    const L = leaves;
    if (!L) return;
    const t = performance.now(), dt = Math.min(0.1, (t - L.last) / 1000);
    L.last = t;
    if (L.stamp !== col.doorStamp) {
      L.stamp = col.doorStamp;
      if (W.setDoorState) for (const D of col.doors) { if (L.shown.get(D) !== D.open) { L.shown.set(D, D.open); W.setDoorState(D.b, D.k, D.open); } }
      for (const D of col.doors) if (!D.slots) D.t = D.open; // rumah belum terbuka: tanpa animasi
    }
    for (const D of L.live) if (D.t !== D.open) { D.t = D.open ? Math.min(1, D.t + dt / 0.3) : Math.max(0, D.t - dt / 0.3); leafPose(D); }
  }
  function setOpen(H, on) {
    if (W.setHouseOpen) W.setHouseOpen(H, on);
    leavesOn(H, on);
    if (H.up && H.kind && W.setFloorBand) W.setFloorBand(H.i, on ? H.up.floor + 0.02 : 0, on ? H.up.ceil : 0); // ruko/aula: kaca lantai 2 berlubang selama terbuka
  }
  // ---------- Lantai menara (dicapai dengan lift): satu lantai terbuka pada satu waktu = lantai tempat kamera berada ----------
  const towers = list.filter((H) => H.fl);
  // slot poligon lapisan dinamis dipesan di muka: nav.js mengosongkan seluruh indeks & cache-nya tiap kali col.polys.length
  // berubah, sedangkan perabot lantai menara (addFurnLayer, ≤ 3 poligon per perabot) dipasang & dilepas tiap ganti lantai
  if (col && towers.length) col.removeLayer(col.addLayer(Array.from({ length: Math.max(...towers.map((T) => T.fl.furn.length)) * 3 + 8 }, () => ({ x: 0, y: 0, w: 0.1, d: 0.1, h: 0.1 }))));
  // menara yang memuat (x, y) DAN punya lantai kantor di ketinggian kaki z → [menara, indeks lantai] atau null.
  // Menara di atas podium (mis. #5442 di atas #966) bertumpuk tapaknya; menara pertama yang memuat titik belum tentu pemilik lantai itu.
  const lvlOf = (T, z) => T.floors.indexOf(Math.round(Math.floor((z + 0.5) / T.FH) * T.FH * 1000) / 1000);
  const towerAt = (x, y, z) => {
    for (const H of towers) { const k = H.k; if (Math.hypot(cen[k][0] - x, cen[k][1] - y) <= rad[k] && pip(x, y, H.pts)) { const li = lvlOf(H, z); if (li >= 0) return [H, li]; } }
    return null;
  };
  const flo = { T: null, k: 0, ids: null, shown: false };
  let flJob = null; // templat lantai yang sedang dicicil { T, it }
  function closeFloor() {
    const T = flo.T;
    if (T && flo.shown) { scene.remove(T.flMesh); if (col) col.removeLayer(flo.ids); if (W.setFloorBand) W.setFloorBand(T.i, 0, 0); if (furn) furn.hide(T.flFurn); }
    flo.T = null; flo.k = 0; flo.ids = null; flo.shown = false;
  }
  function showFloor() { // templat sudah jadi: pindahkan ke ketinggian lantai, perabot jadi rintangan, kaca lantai itu berlubang
    const T = flo.T, z = T.floors[flo.k - 1], m = T.flMesh;
    m.position.y = z; m.updateMatrix(); m.updateMatrixWorld(true);
    scene.add(m);
    if (col) flo.ids = col.addFurnLayer(T.fl.furn.filter((f) => f.kind !== 'liftcore'), z, T.i);
    if (W.setFloorBand) W.setFloorBand(T.i, z + T.fl.floorZ, z + T.fl.ceil);
    if (furn) furn.show(T.flFurn, z); // perabot 3D templat: digambar setinggi lantai ini
    flo.shown = true;
  }
  for (const H of homes.values()) setOpen(H, false); // data pintu tiap rumah untuk shader fasad (pintu tertutup digambar dari jauh)
  let job = null; // interior yang sedang dicicil { H, fb, it } (fb: batch perabot 3D)
  return {
    homes,
    get openCount() { return open.size; },
    get floor() { return flo.T ? { i: flo.T.i, k: flo.k, z: flo.T.floors[flo.k - 1], shown: flo.shown } : null; },
    // tiap frame: buka gedung dekat (dicicil ≤ BUILD_MS per frame), tutup yang jauh
    // foot (opsional): posisi kaki pemain/yang ditonton → lantai menara yang dibuka (kamera orang ketiga boleh di luar kaca)
    update(cam, foot = null) {
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
        for (const [i, m] of open) { const H = homes.get(i); if (distTo(H.k, x, y) > R_CLOSE) { scene.remove(m); m.traverse((o) => o.geometry && o.geometry.dispose()); open.delete(i); setOpen(H, false); if (furn) { furn.drop(frec.get(i)); frec.delete(i); } } }
        for (const T of towers) if (T.flMesh && T !== flo.T && distTo(T.k, x, y) > R_CLOSE) { T.flMesh.traverse((o) => o.geometry && o.geometry.dispose()); T.flMesh = null; if (furn) { furn.drop(T.flFurn); T.flFurn = null; } } // templat lantai menara jauh dibuang
      }
      // lantai menara tempat pemain berdiri (tanpa foot: kamera, mata ±1,6 m di atas pelat)
      const fx = foot ? foot.x : x, fy = foot ? -foot.z : y, fz = foot ? foot.y : cam.y - 1.6;
      const hit = towers.length ? towerAt(fx, fy, fz) : null, T = hit ? hit[0] : null, k = hit ? hit[1] + 1 : 0; // k = nomor lantai di daftar T.floors (1…)
      if ((k ? T : null) !== flo.T || k !== flo.k) { closeFloor(); if (k) { flo.T = T; flo.k = k; } }
      leavesTick();
      const t0 = performance.now();
      if (flo.T && !flo.shown && flo.T.flMesh) showFloor(); // templat sudah ada: langsung dipasang
      // Satu generator pada satu waktu: penampung verteks VP/VN/VC/VS + vn dipakai bersama dan buildGen mengosongkannya saat
      // mulai, jadi templat lantai yang dimulai di tengah cicilan gedung lain menghapus sebagian dinding gedung itu.
      // Urutan: selesaikan yang sedang berjalan → templat lantai menara (terbangun selama layar lift gelap) → antrean gedung.
      while (performance.now() - t0 < BUILD_MS) {
        if (flJob) {
          const r = flJob.it.next();
          if (r.done) { const T = flJob.T; T.flMesh = r.value; T.flFurn = furn ? furn.commit(flJob.fb) : null; flJob = null; if (flo.T === T && !flo.shown) showFloor(); }
          continue;
        }
        if (!job) {
          if (flo.T && !flo.shown && !flo.T.flMesh) { const fb = furn ? furn.begin(flo.T.fl) : null; flJob = { T: flo.T, fb, it: buildGen(flo.T.fl, fb) }; continue; }
          if (!queue.length) break;
          const H = list[queue.shift()];
          if (open.has(H.i)) continue;
          const fb = furn ? furn.begin(H) : null;
          job = { H, fb, it: buildGen(H, fb) };
        }
        const r = job.it.next();
        if (!r.done) continue;
        scene.add(r.value);
        open.set(job.H.i, r.value);
        setOpen(job.H, true);
        if (furn) { const rec = furn.commit(job.fb); frec.set(job.H.i, rec); furn.show(rec); }
        job = null;
      }
    },
  };
}
// jumlah baris jendela fasad rumah (aturan shader world.js & collide.js winOk: baris k ada bila 3,3k + 2,574 ≤ plafon teratas)
export function houseWinRows(H) { const top = H.up ? H.up.ceil : H.ceil; let k = 0; while (3.3 * k + 2.574 <= top + 0.01 && 3.3 * k + 1.188 < H.h) k++; return k; }
