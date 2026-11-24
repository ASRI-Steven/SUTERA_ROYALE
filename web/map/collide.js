import { cleanTrees } from './trees.js';
import { makeWaterDepth } from './water.js';
// Dunia padat untuk berjalan & menembak: grid sel 24 m berisi tapak gedung (prisma setinggi gedung), air, batang pohon,
// dan ruas jalan. Semua koordinat di sini koordinat data: x timur, y utara, h tinggi (m). Dunia three.js: X = x, Y = h, Z = −y.
const M = 0.1;
const CELL = 24;
const WIN_RANGE = 90; // peluru/pandangan menembus jendela rumah hanya sampai jarak ini (adil: jendela jauh tampak tertutup)
const fract = (v) => v - Math.floor(v);
const houseWindow = (u, v) => { if (v <= 0.8) return false; const fx = fract(u / 3.6), fy = fract(v / 3.3); return fx >= 0.3 && fx <= 0.7 && fy >= 0.36 && fy <= 0.78; }; // = shader world.js
// jendela sah: sel jendela utuh di dalam sisi dinding (≥ 0,3 m dari sudut) dan, di lantai dasar, tidak menumpuk pintu
// (± 0,2 m) — aturan yang sama dipakai shader world.js (tampilan) dan interiors.js (lubang dinding dalam, kusen, gorden)
const winOk = (W, u, v) => { if (W.top !== undefined && 3.3 * Math.floor(v / 3.3) + 2.574 > W.top + 0.01) return false; const w0 = Math.floor(u / 3.6) * 3.6 + 1.08, w1 = w0 + 1.44; if (w0 < W.u0 + 0.3 || w1 > W.u1 - 0.3) return false; if (v < 3.3) for (const d of W.doors) if (w0 < d[1] + 0.2 && w1 > d[0] - 0.2) return false; return true; };
// jendela di pita lantai atas yang sedang terbuka (D.bands, world.js setFloorBand) menurut gaya fasad gedung (H.fst):
// 2 menara, 1 ruko/gedung publik, 4 mal, 0 rumah (jendela sah) — rumus sama dengan shader world.js & interiors.js
const bandWin = (W, u, v) => {
  if (v <= 0.8) return false;
  if (W.st === 2) { const fx = fract(u / 1.7), fy = fract(v / 3.7); return fx >= 0.07 && fx <= 0.93 && fy >= 0.1 && fy <= 0.93; }
  if (W.st === 4) { if (v < 4.1) return false; const fl = fract((v - 4.1) / 3.9), gx = fract(u / 2.0), bx = u - Math.floor(u / 46) * 46; return fl >= 0.22 && fl <= 0.62 && gx >= 0.03 && gx <= 0.97 && !(bx >= 8 && bx <= 20 && v >= 4.6 && v <= 7.0); }
  if (W.st === 0) return houseWindow(u, v) && winOk(W, u, v);
  const fx = fract(u / 2.6), fy = fract(v / 3.3); return fx >= 0.16 && fx <= 0.84 && fy >= 0.36 && fy <= 0.78;
};
const clampF = (v, a, b) => (v < a ? a : v > b ? b : v);
// tinggi permukaan tangga di titik (x,y) (0 di kaki tangga → h1 di puncak)
const rampH = (S, x, y) => clampF(((x - S.ax) * S.ux + (y - S.ay) * S.uy) / S.len, 0, 1) * S.h1;
// apakah poligon G menghalangi agen yang kakinya setinggi ay (badan ay..ay+1,9 m)?
function blocksAgent(G, x, y, ay, swim) {
  if (swim && G.b === -1) return false;
  if (G.b === -1) return ay < 0.5; // air: padat untuk pejalan
  if (G.z0 > ay + 1.9 || G.h < ay + (G.floor !== undefined ? 0.45 : 0.35)) return false; // di atas kepala / di bawah lutut (lantai lain); tepi pelat lantai: langkah naik 0,45 m (puncak tangga curam 3,0 m)
  if (G.stair && ay >= rampH(G.stair, x, y) - 0.45) return false; // sedang menaiki tangga
  return true;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function pipF(x, y, a) {
  let inside = false;
  for (let i = 0, n = a.length >> 1, j = n - 1; i < n; j = i++) {
    const xi = a[2 * i], yi = a[2 * i + 1], xj = a[2 * j], yj = a[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function closest(x, y, a, out) { // titik terdekat di tepi poligon; mengembalikan jaraknya
  let best = Infinity;
  for (let i = 0, n = a.length >> 1, j = n - 1; i < n; j = i++) {
    const ax = a[2 * j], ay = a[2 * j + 1], dx = a[2 * i] - ax, dy = a[2 * i + 1] - ay, L = dx * dx + dy * dy;
    let t = L > 0 ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t, qy = ay + dy * t, d = (x - qx) * (x - qx) + (y - qy) * (y - qy);
    if (d < best) { best = d; out.x = qx; out.y = qy; }
  }
  return Math.sqrt(best);
}

// tinggi batang pohon yang menahan peluru (tajuk di atasnya tembus): rindang / palem / kolom (cemara, glodokan)
const TRUNK_H = [3.2, 8.5, 5.0];
// homes (opsional, map/interiors.js planHomes): rumah yang bisa dimasuki → dinding tipis berpintu, plafon, sekat, perabot.
export function createCollider(D, inArea, homes) {
  const polys = [], trees = [], segs = [], cells = new Map(), lifts = [];
  const key = (cx, cy) => (cx + 2048) * 4096 + (cy + 2048);
  const cell = (cx, cy) => { const k = key(cx, cy); let c = cells.get(k); if (!c) cells.set(k, (c = { p: [], t: [], s: [] })); return c; };
  const span = (x0, y0, x1, y1, fn) => {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) fn(cell(cx, cy));
  };
  // z0 = dasar (di atas kepala: hanya menghalangi peluru/kamera), win = info jendela dinding luar rumah,
  // floor = tinggi permukaan yang bisa diinjak (pelat lantai 2), stair = tangga (lihat rampH)
  const freeIds = []; // slot poligon lapisan dinamis yang sudah dilepas (dipakai ulang)
  const addPoly = (flat, h, b, scale = M, z0 = 0, extra = null) => {
    const n = flat.length >> 1;
    if (n < 3) return -1;
    const pts = new Float64Array(n * 2);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < n; j++) {
      const x = flat[2 * j] * scale, y = flat[2 * j + 1] * scale;
      pts[2 * j] = x; pts[2 * j + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const G = { pts, x0, y0, x1, y1, h, b, s: 0, z0, ...extra }, i = freeIds.length ? freeIds.pop() : polys.length;
    polys[i] = G;
    span(x0, y0, x1, y1, (c) => c.p.push(i));
    return i;
  };
  const strip = (ax, ay, ux, uy, nx, ny, s0, s1, t0, t1) => [ax + ux * s0 + nx * t0, ay + uy * s0 + ny * t0, ax + ux * s1 + nx * t0, ay + uy * s1 + ny * t0, ax + ux * s1 + nx * t1, ay + uy * s1 + ny * t1, ax + ux * s0 + nx * t1, ay + uy * s0 + ny * t1];
  const rectFlat = (cx, cy, ux, uy, w, d) => { const vx = -uy, vy = ux, hw = w / 2, hd = d / 2; return [cx - ux * hw - vx * hd, cy - uy * hw - vy * hd, cx + ux * hw - vx * hd, cy + uy * hw - vy * hd, cx + ux * hw + vx * hd, cy + uy * hw + vy * hd, cx - ux * hw + vx * hd, cy - uy * hw + vy * hd]; };
  // perabot: menghalangi jalan & jadi perlindungan (meja makan/kafe: termasuk kursinya; meja kantor: kursi di belakangnya)
  function furnAdd(f, z0, b, ids) {
    const c = Math.cos(f.rot), sn = Math.sin(f.rot), hw = f.w / 2, hd = f.d / 2 + (f.kind === 'table' ? 0.51 : 0), pts = [];
    const sh = f.kind === 'officedesk' ? -0.3 : 0, hd2 = hd + (sh ? 0.3 : 0);
    for (const [a, d] of [[-hw, -hd2 + sh], [hw, -hd2 + sh], [hw, hd2 + sh], [-hw, hd2 + sh]]) pts.push(f.x + a * c - d * sn, f.y + a * sn + d * c);
    const put = (i) => { if (ids && i >= 0) ids.push(i); };
    put(addPoly(pts, z0 + f.h + (f.kind === 'tv' ? 0.7 : 0), b, 1, z0));
    if (f.kind === 'counter') { const o = -f.d / 2 + 0.17; put(addPoly(rectFlat(f.x - o * sn, f.y + o * c, c, sn, f.w, 0.34), z0 + 2.2, b, 1, z0 + 1.5)); } // lemari gantung dapur
    else if (f.kind === 'kiosk') put(addPoly(pts, z0 + 2.42, b, 1, z0 + 2.3)); // atap kios
  }
  // Pintu rumah (daun kayu, buka-tutup): poligon setebal dinding di celah pintu setinggi 2,2 m. Keadaan disimpan di sini
  // (satu sumber kebenaran): terbuka = h −∞ → semua uji (blocksAgent, ray, blocked, solidAt) mengabaikannya tanpa cabang
  // baru; jumlah poligon tetap seumur dunia (cache nav.js tidak terbuang; nav menganggap pintu selalu bisa dilalui).
  // D: { b, k, x, y (tengah celah, sisi luar), ux, uy (sepanjang), nx, ny (ke dalam), s0/s1 ujung, w, z, pi, open, t,
  // dir (+1 ke dalam / −1 ke luar saat terbuka), swing (bit 1 boleh ke dalam, bit 2 boleh ke luar), leaves, maxA, at }
  const doors = [], doorCells = new Map();
  let doorStamp = 0;
  function addDoor(H, d, T) {
    const e = d.e, sm = (d.s0 + d.s1) / 2, H2 = 2.2;
    const pi = addPoly(strip(e.a[0], e.a[1], e.ux, e.uy, e.nx, e.ny, d.s0, d.s1, 0, T), H2, H.i, 1, 0, null);
    const D = { id: doors.length, b: H.i, k: H.doors.indexOf(d), x: e.a[0] + e.ux * sm, y: e.a[1] + e.uy * sm, ax: e.a[0] + e.ux * d.s0, ay: e.a[1] + e.uy * d.s0, ux: e.ux, uy: e.uy, nx: e.nx, ny: e.ny, w: d.s1 - d.s0, T, z: 0, pi, open: 0, t: 0, dir: 1,
      swing: d.swing || 1, leaves: d.leaves || (d.s1 - d.s0 >= 1.3 ? 2 : 1), maxA: d.maxA || Math.PI / 2, at: -99, H2 };
    polys[pi].door = D;
    doors.push(D);
    const k = key(Math.floor(D.x / CELL), Math.floor(D.y / CELL));
    (doorCells.get(k) || doorCells.set(k, []).get(k)).push(D);
  }
  // Pintu kamar mandi (interiors.js planBath, sekat ber-`bd`): satu daun di ambang sekat, mekanisme sama dengan pintu rumah,
  // tetapi awalnya TERBUKA, hanya berayun ke luar kamar mandi (ruangnya sempit: dari dalam selalu bisa ditutup) dan tidak
  // punya texel fasad (k = −1). n menuju ke dalam kamar mandi; engsel di ujung g1 (dekat sekat penuh).
  function addBathDoor(H, p, z0) {
    const u0x = (p.b[0] - p.a[0]) / p.len, u0y = (p.b[1] - p.a[1]) / p.len, T = 0.12, w = p.g1 - p.g0, sm = (p.g0 + p.g1) / 2;
    const pi = addPoly(strip(p.a[0], p.a[1], u0x, u0y, -u0y, u0x, p.g0, p.g1, -T / 2, T / 2), -Infinity, H.i, 1, z0, null);
    let nx = -u0y, ny = u0x;
    const mx = p.a[0] + u0x * sm, my = p.a[1] + u0y * sm;
    if ((p.bd[0] - mx) * nx + (p.bd[1] - my) * ny < 0) { nx = -nx; ny = -ny; }
    const D = { id: doors.length, b: H.i, k: -1, bath: 1, x: mx - nx * T / 2, y: my - ny * T / 2, ax: p.a[0] + u0x * p.g1 - nx * T / 2, ay: p.a[1] + u0y * p.g1 - ny * T / 2, ux: -u0x, uy: -u0y, nx, ny, w, T, z: z0, pi, open: 1, open0: 1, t: 1, dir: -1,
      swing: 2, leaves: 1, maxA: Math.PI / 2, at: -99, H2: z0 + 2.1, sy: 2.06 / 2.15 };
    polys[pi].door = D;
    doors.push(D);
    const k = key(Math.floor(D.x / CELL), Math.floor(D.y / CELL));
    (doorCells.get(k) || doorCells.set(k, []).get(k)).push(D);
  }
  function eachDoor(x, y, r, fn) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
      const L = doorCells.get(key(cx, cy));
      if (L) for (const D of L) if (fn(D)) return;
    }
  }
  // pintu terdekat (tengah celah ≤ r) setinggi kaki z
  function doorNear(x, y, z = 0, r = 1.9) {
    let best = null, bd = r;
    eachDoor(x, y, r, (D) => { if (Math.abs(z - D.z) > 1.2) return; const d = Math.hypot(D.x + D.nx * D.T / 2 - x, D.y + D.ny * D.T / 2 - y); if (d < bd) { bd = d; best = D; } });
    return best;
  }
  // pintu TERTUTUP yang dipotong ruas gerak (x,y) → (x + dx·reach, y + dy·reach) (dx, dy satuan) — bot membuka sebelum menabraknya
  function doorAhead(x, y, z, dx, dy, reach = 1.3) {
    let best = null, bt = Infinity;
    eachDoor(x, y, reach + 2, (D) => {
      if (D.open || Math.abs(z - D.z) > 1.2) return;
      const mx = D.x + D.nx * D.T / 2, my = D.y + D.ny * D.T / 2, rx = x - mx, ry = y - my;
      const v0 = rx * D.nx + ry * D.ny, v1 = v0 + (dx * D.nx + dy * D.ny) * reach; // jarak ke bidang pintu (normal) di awal & ujung ruas
      if (Math.abs(v0) > reach + 0.5 || (v0 > 0.55 && v1 > 0.55) || (v0 < -0.55 && v1 < -0.55)) return; // tidak mendekati bidang pintu
      const den = dx * D.nx + dy * D.ny;
      if (v0 * den > -0.2 * Math.abs(v0) || Math.abs(den) < 0.2) return; // harus bergerak menuju bidang pintu (bukan sejajar dinding)
      const t = Math.max(0, -v0 / den);
      const u = (rx + dx * t) * D.ux + (ry + dy * t) * D.uy; // posisi sepanjang pintu di titik potong
      if (Math.abs(u) > D.w / 2 + 0.2 || t > reach || t >= bt) return;
      bt = t; best = D;
    });
    return best;
  }
  // agen menghalangi pintu ditutup: lingkaran badan (r 0,45) memotong persegi celah atau cakram ayun di sisi terbuka
  function doorClear(D, agents) {
    if (!agents) return true;
    const hw = D.w / 2, lw = D.w / D.leaves;
    for (const a of agents) {
      if (!a.alive || a.state === 'plane' || a.state === 'dead' || Math.abs(a.pos.y - D.z) > 1.5) continue;
      const x = a.pos.x - D.x, y = -a.pos.z - D.y, u = x * D.ux + y * D.uy, v = x * D.nx + y * D.ny;
      if (Math.abs(u) < hw + 0.45 && v > -0.45 && v < D.T + 0.45) return false;
      if (D.open) for (let l = 0; l < D.leaves; l++) { // cakram ayun di sisi daun terbuka
        const hu = l === 0 ? -hw : hw, sv = D.dir > 0 ? v - D.T : -v;
        if (sv > -0.45 && (l === 0 ? u - hu : hu - u) > -0.45 && Math.hypot(u - hu, sv > 0 ? sv : 0) < lw + 0.15 + (D.bath ? 0.1 : 0.45)) return false; // seperempat cakram: daun hanya menyapu dari engsel ke arah celah
      }
    }
    return true;
  }
  // buka/tutup. Menutup ditolak (false) bila ada agen di ambang / di busur ayun. Membuka: daun berayun menjauhi pembuka
  // (opener = agen, opsional) bila arah itu diizinkan (D.swing).
  function setDoor(D, open, agents = null, now = 0, opener = null) {
    open = open ? 1 : 0;
    if (D.open === open) return true;
    if (!open && !doorClear(D, agents)) return false;
    if (open) {
      let want = D.swing & 1 ? 1 : -1;
      if (opener && D.swing === 3) { const v = (opener.pos.x - D.x) * D.nx + (-opener.pos.z - D.y) * D.ny; want = v > D.T / 2 ? -1 : 1; } // dari dalam → ke luar
      D.dir = want;
    }
    D.open = open; D.at = now;
    polys[D.pi].h = open ? -Infinity : D.H2;
    doorStamp++;
    return true;
  }
  function resetDoors() { for (const D of doors) { D.open = D.open0 | 0; D.t = D.open; D.at = -99; if (D.open) D.dir = D.swing & 1 ? 1 : -1; polys[D.pi].h = D.open ? -Infinity : D.H2; } doorStamp++; }
  function addHome(H) {
    const T = 0.2, b = H.i;
    for (const e of H.edges) { // dinding luar (tebal T ke dalam), celah pintu, ambang di atas pintu
      const doors = H.doors.filter((d) => d.e === e).sort((p, q) => p.s0 - q.s0);
      // sudut cekung: dinding diperpanjang sampai titik temu sisi dalamnya (e.x0/e.x1, interiors.js edgesOf) — tanpa celah
      let s = doors.length && doors[0].s0 < 0.05 ? 0 : -(e.x0 || 0);
      const end = doors.length && doors[doors.length - 1].s1 > e.len - 0.05 ? e.len : e.len + (e.x1 || 0);
      const win = H.kind || (H.blind && H.blind.has(e.j)) ? null : { ax: e.a[0], ay: e.a[1], ux: e.ux, uy: e.uy, u0: e.u0, u1: e.u0 + e.len, doors: doors.map((d) => [d.u0, d.u1]), top: H.up ? H.up.ceil : H.ceil }; // toko/aula/menara: kaca padat; sisi menempel gedung lain: tanpa jendela; jendela terpotong sudut / menumpuk pintu: tidak ada (winOk)
      // ruko/aula/menara: kaca lantai atas yang sedang terbuka (pita D.bands) bisa ditembus — lihat bandWin
      const bw = H.kind && !(H.blind && H.blind.has(e.j)) ? { st: H.fst | 0, ax: e.a[0], ay: e.a[1], ux: e.ux, uy: e.uy, u0: e.u0, u1: e.u0 + e.len, doors: [] } : null;
      const ex = win ? { win } : bw ? { bw } : {};
      for (const d of [...doors, { s0: end, s1: end }]) {
        if (d.s0 - s > 0.02) addPoly(strip(e.a[0], e.a[1], e.ux, e.uy, e.nx, e.ny, s, d.s0, 0, T), H.h, b, 1, 0, ex);
        if (d.s1 > d.s0 && d.s0 < e.len) addPoly(strip(e.a[0], e.a[1], e.ux, e.uy, e.nx, e.ny, d.s0, d.s1, 0, T), H.h, b, 1, d.h || 2.2, ex);
        if (!H.kind && d.s1 > d.s0 && d.s0 < e.len) addDoor(H, d, T);
        s = d.s1;
      }
    }
    const R = H.roof; // menara/gedung publik: atap bisa dinaiki lewat lift (map/world.js roofTop → D.roofs)
    if (H.up) { // rumah 2 lantai: pelat lantai 2 berlubang tangga, atap, tangga, pagar
      for (const piece of H.up.plate) addPoly(piece.flat(), H.up.floor, b, 1, H.ceil, { floor: H.up.floor });
      addPoly(H.pts.flat(), H.h, b, 1, H.up.ceil, { slab: true });
      // tangga: 6 potong sepanjang naiknya, tiap potong setinggi anak tangganya + pagar 0,95 m (dulu satu kotak 3,3 m:
      // peluru & kamera tertahan di udara kosong di atas anak tangga bawah); berjalan tetap memakai rampH.
      // Ruko: tiap unit punya tangga sendiri (H.up.stairs); H.up.stair = tangga utama yang dipakai bot.
      for (const S of H.up.stairs || [H.up.stair]) {
        const st = { ax: S.ax, ay: S.ay, ux: S.ux, uy: S.uy, len: S.len, h1: H.up.floor }, R4 = S.rect;
        for (let k = 0; k < 6; k++) {
          const f0 = k / 6, f1 = (k + 1) / 6, q = (p, r, f) => [p[0] + (r[0] - p[0]) * f, p[1] + (r[1] - p[1]) * f];
          const lo = S.dir > 0 ? [R4[0], R4[1], R4[2], R4[3]] : [R4[1], R4[0], R4[3], R4[2]]; // [kaki-dinding, puncak-dinding, puncak-dalam, kaki-dalam]
          const piece = [q(lo[0], lo[1], f0), q(lo[0], lo[1], f1), q(lo[3], lo[2], f1), q(lo[3], lo[2], f0)];
          addPoly(piece.flat(), Math.min(H.up.floor + 0.95, f1 * H.up.floor + 0.95), b, 1, 0, { stair: st });
        }
      }
      for (const r of H.up.rail) addPoly(r.flat(), H.up.floor + 0.95, b, 1, H.up.floor);
    } else if (R) { // menara: pelat tiap lantai (bisa dipijak; ruang di antaranya kosong), pelat atap, lantai atap di dalam parapet
      const F = H.floors || [];
      for (const z of F) addPoly(H.pts.flat(), z, b, 1, z - 0.3, { slab: true, floor: z });
      addPoly(H.pts.flat(), R.z, b, 1, F.length ? F[F.length - 1] + H.fl.ceil : H.ceil, { slab: true });
      addPoly(R.inset.flat(), R.z, b, 1, R.z - 0.05, { floor: R.z, roof: true });
      const C = H.core;
      if (C) addPoly(rectFlat(C.x, C.y, C.ux, C.uy, C.w, C.d), R.z, b, 1, H.ceil); // poros lift dari plafon lobi sampai atap
    }
    else addPoly(H.pts.flat(), H.h, b, 1, H.ceil, { slab: true }); // plafon + lantai atas: menahan peluru dari atas/bawah, kamera
    if (R) { // atap: parapet 0,5 m, penthouse lift, unit AC (perlindungan), pintu lift atap ↔ lobi
      for (const e of H.edges) addPoly(strip(e.a[0], e.a[1], e.ux, e.uy, e.nx, e.ny, -(e.x0 || 0) * 2.5, e.len + (e.x1 || 0) * 2.5, 0, 0.5), H.h, b, 1, R.z);
      const P = R.pent;
      addPoly(rectFlat(P.x, P.y, P.ux, P.uy, P.w, P.d), P.h, b, 1, R.z, { floor: P.h, roof: true }); // penthouse: atapnya bisa dipijak (mendarat dengan parasut)
      if (R.tank) addPoly(rectFlat(R.tank.x, R.tank.y, P.ux, P.uy, R.tank.r * 1.8, R.tank.r * 1.8), P.h + R.tank.h, b, 1, P.h); // tandon air
      for (const u of R.units) addPoly(rectFlat(u.x, u.y, u.ux, u.uy, u.w, u.d), R.z + u.h, b, 1, R.z);
      const L = H.lift, Dd = R.door;
      if (L && Dd) lifts.push({
        b, z: R.z, floors: H.floors || [], fh: H.FH || 3.7, dLo: [L.x, L.y], dHi: [Dd.x, Dd.y], // pintu lift lobi & tiap lantai di titik yang sama
        lo: { x: L.x + L.nx * 1.3, y: L.y + L.ny * 1.3, z: 0, yaw: Math.atan2(L.nx, -L.ny) }, // keluar lift menghadap lobi
        hi: { x: Dd.x + Dd.nx * 1.5, y: Dd.y + Dd.ny * 1.5, z: R.z, yaw: Math.atan2(Dd.nx, -Dd.ny) },
      });
    }
    const parts = (list, z0, ceil) => {
      for (const p of list) { // sekat dengan ambang pintu (toko: tanpa ambang → g0 = g1)
        const ux = (p.b[0] - p.a[0]) / p.len, uy = (p.b[1] - p.a[1]) / p.len, nx = -uy, ny = ux;
        if (p.g1 > p.g0) {
          addPoly(strip(p.a[0], p.a[1], ux, uy, nx, ny, 0, p.g0, -0.06, 0.06), ceil, b, 1, z0);
          addPoly(strip(p.a[0], p.a[1], ux, uy, nx, ny, p.g1, p.len, -0.06, 0.06), ceil, b, 1, z0);
          addPoly(strip(p.a[0], p.a[1], ux, uy, nx, ny, p.g0, p.g1, -0.06, 0.06), ceil, b, 1, z0 + 2.1);
          if (p.bd && !H.kind) addBathDoor(H, p, z0);
        } else addPoly(strip(p.a[0], p.a[1], ux, uy, nx, ny, 0, p.len, -0.06, 0.06), ceil, b, 1, z0);
      }
    };
    const furn = (list, z0) => { for (const f of list) furnAdd(f, z0, b, null); };
    parts(H.parts, 0, H.ceil);
    furn(H.furn, 0);
    for (const cv of H.canopies || []) { // kanopi ruko / pintu masuk mal & menara (di atas kepala, atapnya bisa dipijak) + tiang
      const e = cv.e, P = (s, v) => [e.a[0] + e.ux * s + e.nx * v, e.a[1] + e.uy * s + e.ny * v], rect = (s0, s1, v0, v1) => [P(s0, v0), P(s1, v0), P(s1, v1), P(s0, v1)].flat();
      addPoly(rect(cv.s0, cv.s1, -cv.d, 0), cv.z + 0.18, b, 1, cv.z - 0.22, { floor: cv.z + 0.18, roof: true });
      if (cv.cols) for (const s of [cv.s0 + 0.3, cv.s1 - 0.3]) addPoly(rect(s - 0.18, s + 0.18, -cv.d + 0.12, -cv.d + 0.48), cv.z, b, 1, 0);
    }
    if (H.porch) { // teras: lantai +15 cm (bisa dipijak), dua tiang, kanopi di atas kepala (atapnya bisa dipijak: lompat dari jendela lantai 2)
      const pr = H.porch, e = pr.e, P = (s, v) => [e.a[0] + e.ux * s + e.nx * v, e.a[1] + e.uy * s + e.ny * v];
      const rect = (s0, s1, v0, v1) => [P(s0, v0), P(s1, v0), P(s1, v1), P(s0, v1)].flat();
      addPoly(rect(pr.s0, pr.s1, -pr.D, 0), 0.15, b, 1, 0, { floor: 0.15 });
      for (const s of [pr.s0 + 0.2, pr.s1 - 0.2]) addPoly(rect(s - 0.11, s + 0.11, -pr.D + 0.09, -pr.D + 0.31), pr.h, b, 1, 0);
      addPoly(rect(pr.s0 - 0.12, pr.s1 + 0.12, -pr.D - 0.3, 0), pr.h + 0.12, b, 1, pr.h, { floor: pr.h + 0.12, roof: true });
    }
    if (H.up) { parts(H.up.parts || H.parts, H.up.floor, H.up.ceil); furn(H.up.furn, H.up.floor); } // lantai atas: sekat sama dengan lantai dasar (ruko: sekat unit berambang)
  }
  const B = D.buildings;
  for (let i = 0; i < B.r.length; i++) {
    if (B.k[i] === 5) { // 5 = atap/kanopi terbuka (world.js canopyRoof): tiang padat, pelat di atas kepala (atasnya bisa dipijak)
      const Cn = D.canopy && D.canopy.get(i);
      if (!Cn) continue;
      for (const [x, y] of Cn.cols) addPoly(rectFlat(x, y, Cn.ux, Cn.uy, Cn.w, Cn.w), Cn.z0, i, 1, 0);
      addPoly(B.r[i], Cn.h, i, M, Cn.z0, { floor: Cn.h, roof: true });
      continue;
    }
    const H = homes && homes.get(i);
    if (H) addHome(H); else addPoly(B.r[i], B.h[i] * M, i);
  }
  for (const r of D.water) addPoly(r, -1, -1); // air: padat untuk pejalan, tidak menghalangi peluru/kamera
  cleanTrees(D); // daftar pohon yang sama dengan render (tidak di jalan/gedung/air)
  const T = D.trees, st = D.meta.treeStride || 3;
  for (let i = 0; i + 1 < T.length; i += st) {
    const sp = st > 3 ? T[i + 3] : 0, x = T[i] * M, y = T[i + 1] * M, k = trees.push({ x, y, r: sp === 1 ? 0.26 : sp === 2 ? 0.16 : 0.3, th: TRUNK_H[sp] || TRUNK_H[0] }) - 1; // batang: lebar / palem / kolom
    cell(Math.floor(x / CELL), Math.floor(y / CELL)).t.push(k);
  }
  D.roads.r.forEach((r, i) => {
    const name = D.roads.n[String(i)] || null, w = D.roads.w[i] * M, pad = w / 2 + 4;
    for (let j = 0; j + 3 < r.length; j += 2) {
      const ax = r[j] * M, ay = r[j + 1] * M, bx = r[j + 2] * M, by = r[j + 3] * M;
      const k = segs.push({ ax, ay, bx, by, w, name, road: i, st: 0 }) - 1;
      span(Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad, (c) => c.s.push(k));
    }
  });
  let stamp = 0, touched = false; // touched: resolve terakhir mendorong badan (dipakai step untuk memanggil guard)
  const q = { x: 0, y: 0 };
  // sungai & kanal (garis + lebar ≥ 3 m): potongan ≤ 4 m menjadi poligon air (bisa direnangi; padat untuk pejalan, bot,
  // kendaraan), kecuali di persilangan jalan (jembatan, sama dengan bridges() di world.js)
  const nearRoadAt = (x, y, extra) => {
    let hit = false;
    stamp++;
    near(x, y, 14, (c) => {
      for (const si of c.s) {
        const s = segs[si];
        if (hit || s.st === stamp) continue;
        s.st = stamp;
        const dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy, t = L > 0 ? clamp(((x - s.ax) * dx + (y - s.ay) * dy) / L, 0, 1) : 0;
        if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) < s.w / 2 + extra) hit = true;
      }
    });
    return hit;
  };
  // jembatan: lantai & pagar sama persis dengan world.js bridges() → pagar padat (setinggi 0,95 m: menahan jalan kaki &
  // kendaraan, peluru di atasnya lewat); air kanal sampai tepat di luar pagar
  const decks = [];
  {
    const RG = new Map(), RC = 60, rk = (x, y) => Math.floor(x / RC) * 100003 + Math.floor(y / RC), seen = new Set();
    D.roads.r.forEach((r, ri) => { for (let j = 0; j + 3 < r.length; j += 2) { const s = [r[j] * M, r[j + 1] * M, r[j + 2] * M, r[j + 3] * M, D.roads.w[ri] * M]; const k = rk((s[0] + s[2]) / 2, (s[1] + s[3]) / 2); (RG.get(k) || RG.set(k, []).get(k)).push(s); } });
    D.waterways.r.forEach((r, wi) => {
      const hw = D.waterways.w[wi] * M / 2;
      if (hw < 1.5) return;
      for (let j = 0; j + 3 < r.length; j += 2) {
        const ax = r[j] * M, ay = r[j + 1] * M, bx = r[j + 2] * M, by = r[j + 3] * M, cand = new Set();
        for (const [x, y] of [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2]]) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const s of RG.get(rk(x + dx * RC, y + dy * RC)) || []) cand.add(s);
        for (const s of cand) {
          const [cx0, cy0, cx1, cy1, rw] = s, d1x = bx - ax, d1y = by - ay, d2x = cx1 - cx0, d2y = cy1 - cy0, den = d1x * d2y - d1y * d2x;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((cx0 - ax) * d2y - (cy0 - ay) * d2x) / den, u = ((cx0 - ax) * d1y - (cy0 - ay) * d1x) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const px = ax + d1x * t, py = ay + d1y * t, key = Math.round(px) * 100003 + Math.round(py);
          if (seen.has(key)) continue;
          seen.add(key);
          const rl = Math.hypot(d2x, d2y), ux = d2x / rl, uy = d2y / rl, wl = Math.hypot(d1x, d1y), sin = Math.abs((d1x / wl) * uy - (d1y / wl) * ux);
          const half = Math.min(18, (hw + 1.8) / Math.max(0.35, sin)), W = rw / 2 + 0.6;
          decks.push({ x: px, y: py, ux, uy, half, W });
          for (const sd of [-1, 1]) addPoly(rectFlat(px - uy * W * sd, py + ux * W * sd, ux, uy, half * 2, 0.24), 0.95, -3, 1, 0); // pagar jembatan
        }
      }
    });
  }
  const onDeck = (x, y) => decks.some((k) => { const dx = x - k.x, dy = y - k.y; return Math.abs(dx * k.ux + dy * k.uy) <= k.half + 0.3 && Math.abs(-dx * k.uy + dy * k.ux) <= k.W + 0.12; });
  const nearDeck = (x, y, r) => decks.some((k) => Math.hypot(x - k.x, y - k.y) < k.half + r);
  D.waterways.r.forEach((r, wi) => {
    const hw = D.waterways.w[wi] * M / 2;
    if (hw < 1.5) return; // selokan kecil: bisa dilangkahi
    for (let j = 0; j + 3 < r.length; j += 2) {
      const ax = r[j] * M, ay = r[j + 1] * M, bx = r[j + 2] * M, by = r[j + 3] * M, L = Math.hypot(bx - ax, by - ay);
      if (L < 0.05) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy * hw, ny = ux * hw;
      // dekat jembatan: potongan 1 m (air rapat sampai pagar), di tempat lain 4 m
      const fine = nearDeck(ax, ay, L + hw + 6) || nearDeck(bx, by, L + hw + 6), n = Math.ceil(L / (fine ? 1 : 4)), ov = fine ? 0.08 : 0.3;
      for (let k = 0; k < n; k++) {
        const t0 = Math.max(-ov, k / n * L - ov), t1 = (k + 1) / n * L + ov, mx = ax + ux * (t0 + t1) / 2, my = ay + uy * (t0 + t1) / 2;
        if (onDeck(mx, my) || nearRoadAt(mx, my, 0.6)) continue; // lantai jembatan / badan jalan
        const p0x = ax + ux * t0, p0y = ay + uy * t0, p1x = ax + ux * t1, p1y = ay + uy * t1;
        addPoly([p0x + nx, p0y + ny, p1x + nx, p1y + ny, p1x - nx, p1y - ny, p0x - nx, p0y - ny], -1, -1, 1);
      }
    }
  });
  const lastTouch = { b: -1, t: 0 };
  // Rintangan tambahan dari modul lain (benda lingkungan: tiang, halte, papan reklame, pagar, dst.). Koordinat data (m).
  // Bentuk: { pts: [x0, y0, x1, y1, …] } poligon · { x, y, r } lingkaran (jadi segi-8) · { x, y, w, d, rot } kotak.
  // h = tinggi puncak, z0 = dasar (bawaan 0; > 1,9 = di atas kepala, hanya menahan peluru/kamera), floor: true = puncaknya
  // bisa dipijak (atap halte, panggung). Indeks gedung −3 (bukan gedung, bukan air). Panggil sebelum bot mulai bernavigasi
  // (sel navigasi bot di-cache saat pertama dipakai).
  function addObstacles(list) {
    for (const o of list) {
      let flat = o.pts;
      if (!flat && o.r != null) { flat = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; flat.push(o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r); } }
      else if (!flat) {
        const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), hw = o.w / 2, hd = o.d / 2;
        flat = [];
        for (const [a, d] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) flat.push(o.x + a * c - d * s, o.y + a * s + d * c);
      }
      addPoly(flat, o.h, -3, 1, o.z0 || 0, o.floor ? { floor: o.h } : null);
    }
  }

  function near(x, y, r, fn) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
        const c = cells.get(key(cx, cy));
        if (c) fn(c);
      }
  }
  // Dorong lingkaran badan (jari-jari r) keluar dari gedung/air/pohon; hasilnya meluncur di sepanjang dinding.
  function resolve(x, y, r = 0.32, swim = false, ay = 0) { // swim: air tidak padat (pemain berenang); ay = tinggi kaki agen
    for (let it = 0; it < 3; it++) {
      let moved = false;
      stamp++;
      // sel grid di sekitar lingkaran ditelusuri langsung (tanpa closure per panggilan: fungsi ini dipanggil ratusan kali per frame)
      const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL), cy0 = Math.floor((y - r) / CELL), cy1 = Math.floor((y + r) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const c = cells.get(key(cx, cy));
        if (!c) continue;
        const cp = c.p, ct = c.t;
        for (let k = 0; k < cp.length; k++) {
          const G = polys[cp[k]];
          if (G.s === stamp) continue;
          G.s = stamp;
          if (x < G.x0 - r || x > G.x1 + r || y < G.y0 - r || y > G.y1 + r || !blocksAgent(G, x, y, ay, swim)) continue;
          const inside = pipF(x, y, G.pts);
          if (inside && G.stair) continue; // di dalam tapak tangga (jatuh lewat lubang, lompat): jangan dilempar ke tepi terdekat (sering ke luar rumah); step() & guard() menahan masuknya
          const d = closest(x, y, G.pts, q);
          if (!inside && d >= r) continue;
          if (d < 1e-7) { x += 1e-3; moved = true; continue; }
          const s = inside ? -1 : 1;
          x = q.x + (x - q.x) / d * s * r;
          y = q.y + (y - q.y) / d * s * r;
          moved = true; touched = true;
          if (G.b >= 0) { lastTouch.b = G.b; lastTouch.t = performance.now(); }
        }
        for (let k = 0; k < ct.length; k++) {
          const t = trees[ct[k]], dx = x - t.x, dy = y - t.y, d = Math.sqrt(dx * dx + dy * dy), m = r + t.r;
          if (d >= m || d < 1e-7) continue;
          x = t.x + dx / d * m;
          y = t.y + dy / d * m;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, y };
  }
  // Ruas pusat badan (x0,y0)→(x1,y1) memotong sisi poligon padat (dinding, sekat, pintu tertutup, perabot, pagar; bukan air)
  // yang titik awalnya tidak berada di dalamnya? = badan melompati / didorong menembus benda padat. Pola loop sama dengan
  // resolve (tanpa alokasi). Keluar dari poligon tempat pusat sudah berada (tertanam) tetap boleh.
  function crossed(x0, y0, x1, y1, ay = 0) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    if (hx - lx < 1e-9 && hy - ly < 1e-9) return false;
    stamp++;
    for (let cx = Math.floor(lx / CELL); cx <= Math.floor(hx / CELL); cx++) for (let cy = Math.floor(ly / CELL); cy <= Math.floor(hy / CELL); cy++) {
      const c = cells.get(key(cx, cy));
      if (!c) continue;
      const cp = c.p;
      for (let k = 0; k < cp.length; k++) {
        const G = polys[cp[k]];
        if (G.s === stamp) continue;
        G.s = stamp;
        if (G.b === -1 || hx < G.x0 || lx > G.x1 || hy < G.y0 || ly > G.y1) continue;
        if (!blocksAgent(G, x0, y0, ay, false) || !blocksAgent(G, x1, y1, ay, false)) continue;
        const a = G.pts, n = a.length >> 1, dx = x1 - x0, dy = y1 - y0;
        let hit = false;
        for (let i = 0, j = n - 1; i < n && !hit; j = i++) {
          const ax = a[2 * j], ayy = a[2 * j + 1], ex = a[2 * i] - ax, ey = a[2 * i + 1] - ayy, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((ax - x0) * ey - (ayy - y0) * ex) / den, u = ((ax - x0) * dy - (ayy - y0) * dx) / den;
          if (t > 1e-6 && t <= 1 && u >= 0 && u <= 1) hit = true;
        }
        if (hit && !pipF(x0, y0, a)) return true;
      }
    }
    return false;
  }
  // penjaga: p hasil resolve/dorongan dari (x0, y0); kalau ruasnya menembus benda padat → geser per sumbu yang tidak
  // menembus, atau tetap di (x0, y0). Untuk dorongan kendaraan, rebah (fitProne), dan step().
  function guard(x0, y0, p, ay = 0, r = 0.32, swim = false) {
    if (!crossed(x0, y0, p.x, p.y, ay)) return p;
    for (const [tx, ty] of [[p.x, y0], [x0, p.y]]) {
      const q2 = resolve(tx, ty, r, swim, ay);
      if (!crossed(x0, y0, q2.x, q2.y, ay)) return q2;
    }
    return { x: x0, y: y0 };
  }
  // Gerak satu langkah dengan tabrakan + tepi kawasan (meluncur per sumbu kalau keluar). Langkah > 0,15 m (frame
  // tersendat: dt 0,05 × lari 6,9 m/dtk = 0,35 m, lebih dari tebal dinding 0,2 / sekat 0,12) dibagi ≤ 4 potong yang
  // masing-masing di-resolve; potongan yang menyentuh benda dijaga guard() (dulu pusat yang sudah melewati tengah dinding
  // tipis didorong ke tepi seberang = tembus).
  function step(x0, y0, x1, y1, r = 0.32, swim = false, ay = 0) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = L > 0.15 ? Math.min(4, Math.ceil(L / 0.15)) : 1;
    let px = x0, py = y0, p = null;
    for (let k = 1; k <= n; k++) {
      touched = false;
      p = resolve(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r, swim, ay);
      if (touched || n > 1) p = guard(px, py, p, ay, r, swim);
      px = p.x; py = p.y;
    }
    if (!inArea(p.x, p.y)) {
      const a = resolve(x1, y0, r, swim, ay), b = resolve(x0, y1, r, swim, ay);
      p = inArea(a.x, a.y) ? a : inArea(b.x, b.y) ? b : { x: x0, y: y0 };
    }
    return p;
  }
  function blocked(x, y, r = 0.32, ay = 0) {
    let hit = false;
    stamp++;
    near(x, y, r + 0.1, (c) => {
      if (hit) return;
      for (const pi of c.p) {
        const G = polys[pi];
        if (G.s === stamp) continue;
        G.s = stamp;
        if (x < G.x0 - r || x > G.x1 + r || y < G.y0 - r || y > G.y1 + r || !blocksAgent(G, x, y, ay, false)) continue;
        if (pipF(x, y, G.pts) || closest(x, y, G.pts, q) < r + 0.05) { hit = true; return; }
      }
      for (const ti of c.t) { const t = trees[ti]; if (Math.hypot(x - t.x, y - t.y) < r + t.r + 0.05) { hit = true; return; } }
    });
    return hit || !inArea(x, y);
  }
  function findFree(x, y, maxR = 220, r = 0.32, outside = false) { // outside: bukan di dalam rumah
    const ok = (px, py) => !blocked(px, py, r) && (!outside || inBuilding(px, py) < 0);
    if (ok(x, y)) return [x, y];
    for (let rr = 1.5; rr <= maxR; rr += 1.5) {
      const n = Math.max(10, Math.round(2 * Math.PI * rr / 1.5));
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2, px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (ok(px, py)) return [px, py];
      }
    }
    return null;
  }
  // Badan rebah (tiarap / tumbang) ±0,9 m sepanjang arah hadap (fx, fy satuan, koordinat data): kepala, dada, dan kaki
  // didorong keluar dinding/perabot/pohon seperti lingkaran badan, dan seluruh badan ikut bergeser (kaku). Dulu hanya
  // lingkaran di tengah badan → kepala menembus tembok dan bisa ditembak dari balik dinding. Titik & jari-jari mengikuti
  // bola kena tembak tiarap di main.js (SPH_PRONE). Tidak muat (lorong sempit, badan melintang) → posisi semula.
  const PRONE_PTS = [[0.88, 0.17], [0.45, 0.24], [-0.82, 0.15]];
  function fitProne(x, y, fx, fy, ay = 0) {
    const x0 = x, y0 = y;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (let k = 0; k < PRONE_PTS.length; k++) {
        const d = PRONE_PTS[k][0], r = PRONE_PTS[k][1], px = x + fx * d, py = y + fy * d, q = resolve(px, py, r, false, ay);
        if (q.x !== px || q.y !== py) { x += q.x - px; y += q.y - py; moved = true; }
      }
      if (!moved) break;
    }
    if ((x !== x0 || y !== y0) && (blocked(x, y, 0.3, ay) || Math.hypot(x - x0, y - y0) > 1.2 || crossed(x0, y0, x, y, ay))) return { x: x0, y: y0 }; // geser menyeberang dinding: tolak
    return { x, y };
  }
  function viewSpot(sp, tx, ty) { // mundur beberapa meter dari gedung supaya fasadnya kelihatan
    const dx = sp[0] - tx, dy = sp[1] - ty, l = Math.hypot(dx, dy);
    if (l < 1) return sp;
    for (const d of [16, 12, 8, 4]) { const x = sp[0] + dx / l * d, y = sp[1] + dy / l * d; if (!blocked(x, y)) return [x, y]; }
    return sp;
  }
  function roadSpot(tx, ty, maxD = 90) { // titik jalan terdekat yang kosong
    const cand = [];
    stamp++;
    near(tx, ty, maxD, (c) => {
      for (const si of c.s) {
        const s = segs[si];
        if (s.st === stamp) continue;
        s.st = stamp;
        const dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy;
        const t = L > 0 ? clamp(((tx - s.ax) * dx + (ty - s.ay) * dy) / L, 0, 1) : 0;
        const px = s.ax + dx * t, py = s.ay + dy * t, d = Math.hypot(px - tx, py - ty);
        if (d <= maxD) cand.push([d, px, py]);
      }
    });
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(40, cand.length); i++) if (!blocked(cand[i][1], cand[i][2])) return [cand[i][1], cand[i][2]];
    return null;
  }
  function arrival(x, y) { // titik muncul: tepat di situ kalau kosong → jalan terdekat → depan gedung (tidak di dalam rumah)
    if (!blocked(x, y) && inBuilding(x, y) < 0) return [x, y];
    const r = roadSpot(x, y);
    if (r) return r;
    const f = findFree(x, y, 220, 0.32, true);
    return f && viewSpot(f, x, y);
  }
  function solidAt(x, y, h) { // titik (x,y,h) di dalam gedung?
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!c) return false;
    for (const pi of c.p) {
      const G = polys[pi];
      if (G.h + 1 <= h || h < G.z0 || x < G.x0 || x > G.x1 || y < G.y0 || y > G.y1) continue;
      if (pipF(x, y, G.pts)) return true;
    }
    return false;
  }
  function roadAt(x, y) {
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!c) return null;
    let best = null, bd = Infinity;
    for (const si of c.s) {
      const s = segs[si];
      if (!s.name) continue;
      const dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy;
      const t = L > 0 ? clamp(((x - s.ax) * dx + (y - s.ay) * dy) / L, 0, 1) : 0;
      const d = Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) - s.w / 2;
      if (d < 4 && d < bd) { bd = d; best = s.name; }
    }
    return best;
  }
  // Sel grid yang dilewati ruas (x0,y0)→(x1,y1) (DDA). fn(sel, fraksiKeluar) → true untuk berhenti.
  function cellsAlong(x0, y0, x1, y1, fn) {
    let cx = Math.floor(x0 / CELL), cy = Math.floor(y0 / CELL);
    const ex = Math.floor(x1 / CELL), ey = Math.floor(y1 / CELL), dx = x1 - x0, dy = y1 - y0;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdy = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
    let tmx = dx !== 0 ? ((sx > 0 ? (cx + 1) * CELL : cx * CELL) - x0) / dx : Infinity;
    let tmy = dy !== 0 ? ((sy > 0 ? (cy + 1) * CELL : cy * CELL) - y0) / dy : Infinity;
    for (let i = 0; i < 4096; i++) {
      const c = cells.get(key(cx, cy));
      if (c && fn(c, Math.min(1, tmx, tmy))) return;
      if (cx === ex && cy === ey) return;
      if (tmx < tmy) { tmx += tdx; cx += sx; } else { tmy += tdy; cy += sy; }
    }
  }
  // Sinar 3D (arah satuan) → jarak tumbukan pertama dengan dinding/atap gedung atau tanah; maxT kalau tidak kena.
  // out (opsional) diisi { b: indeks gedung | -1 tanah }.
  function ray(x, y, h, dx, dy, dh, maxT, out) {
    let best = maxT, hitB = -2;
    if (dh < -1e-6) { const tg = -h / dh; if (tg >= 0 && tg < best) { best = tg; hitB = -1; } }
    const L2 = Math.hypot(dx, dy);
    if (L2 > 1e-6) {
      const T0 = best, X1 = x + dx * T0, Y1 = y + dy * T0, bands = D.bands;
      let fIn = 0;
      stamp++;
      cellsAlong(x, y, X1, Y1, (c, fexit) => {
        // rentang tinggi sinar di sel ini: poligon yang seluruhnya di atas/bawahnya dilewati di sel ini (diuji lagi di sel
        // berikutnya bila perlu) — pelat lantai menara bertumpuk tidak diuji satu per satu
        const hA = h + dh * T0 * fIn, hB = h + dh * T0 * fexit, hLo = Math.min(hA, hB) - 0.02, hHi = Math.max(hA, hB) + 0.02;
        fIn = fexit;
        for (const pi of c.p) {
          const G = polys[pi];
          if (G.s === stamp || G.h <= 0 || G.h < hLo || (G.z0 || 0) > hHi) continue;
          G.s = stamp;
          // uji cepat: kotak poligon jauh dari garis sinar → lewati
          const cxm = (G.x0 + G.x1) / 2 - x, cym = (G.y0 + G.y1) / 2 - y, rad = (G.x1 - G.x0 + G.y1 - G.y0) * 0.5 + 0.01;
          if (Math.abs(cxm * dy - cym * dx) / L2 > rad) continue;
          const a = G.pts, n = a.length >> 1, z0 = G.z0 || 0;
          for (let i = 0, j = n - 1; i < n; j = i++) { // dinding: potong tiap sisi
            const ax = a[2 * j], ay = a[2 * j + 1], ex = a[2 * i] - ax, ey = a[2 * i + 1] - ay;
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((ax - x) * ey - (ay - y) * ex) / den, u = ((ax - x) * dy - (ay - y) * dx) / den;
            if (t <= 1e-4 || t >= best || u < 0 || u > 1) continue;
            const hh = h + dh * t;
            if (hh < z0 || hh > G.h) continue;
            if (G.win && t < WIN_RANGE) { const W = G.win, uu = W.u0 + (x + dx * t - W.ax) * W.ux + (y + dy * t - W.ay) * W.uy; if (houseWindow(uu, hh) && winOk(W, uu, hh)) continue; } // lewat jendela yang sah
            if (G.bw && bands && hh > bands[G.b * 2] && hh < bands[G.b * 2 + 1]) { const W = G.bw, uu = W.u0 + (x + dx * t - W.ax) * W.ux + (y + dy * t - W.ay) * W.uy; if (bandWin(W, uu, hh)) continue; } // kaca lantai atas yang terbuka
            best = t; hitB = G.b;
          }
          if (dh < 0 && h > G.h) { // atap
            const t = (G.h - h) / dh;
            if (t > 0 && t < best && pipF(x + dx * t, y + dy * t, a)) { best = t; hitB = G.b; }
          }
          if (dh > 0 && h < z0) { // plafon dilihat dari bawah (dalam rumah)
            const t = (z0 - h) / dh;
            if (t > 0 && t < best && pipF(x + dx * t, y + dy * t, a)) { best = t; hitB = G.b; }
          }
        }
        const ct = c.t, a2 = dx * dx + dy * dy;
        for (let k = 0; k < ct.length; k++) { // batang pohon (silinder tegak setinggi th; tajuk di atasnya tembus)
          const tr = trees[ct[k]], ox = x - tr.x, oy = y - tr.y, bq = ox * dx + oy * dy, cq = ox * ox + oy * oy - tr.r * tr.r;
          if (cq <= 0 || bq >= 0) continue; // mulai di dalam batang / menjauh
          const disc = bq * bq - a2 * cq;
          if (disc < 0) continue;
          const t = (-bq - Math.sqrt(disc)) / a2;
          if (t <= 1e-4 || t >= best) continue;
          const hh = h + dh * t;
          if (hh < 0 || hh > tr.th) continue;
          best = t; hitB = -4;
        }
        return best < T0 && best / T0 <= fexit;
      });
    }
    if (out) out.b = hitB;
    return best;
  }
  function los(x1, y1, h1, x2, y2, h2) {
    const dx = x2 - x1, dy = y2 - y1, dh = h2 - h1, L = Math.hypot(dx, dy, dh);
    if (L < 0.01) return true;
    return ray(x1, y1, h1, dx / L, dy / L, dh / L, L) >= L - 0.05;
  }
  // tinggi permukaan yang bisa diinjak di (x,y) untuk agen yang kakinya di ay: tanah 0, pelat lantai 2, tangga
  function floorAt(x, y, ay) {
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!c) return 0;
    let best = 0;
    for (const pi of c.p) {
      const G = polys[pi];
      if ((G.floor === undefined && !G.stair) || x < G.x0 || x > G.x1 || y < G.y0 || y > G.y1 || !pipF(x, y, G.pts)) continue;
      const fh = G.stair ? rampH(G.stair, x, y) : G.floor;
      if (fh <= ay + 0.6 && fh > best) best = fh;
    }
    return best;
  }
  // atap terbuka tertinggi (lantai atap menara, kanopi, atap teras) di bawah (x,y) yang ≤ h: tempat mendarat penerjun
  // (0 = tidak ada). Lantai di dalam gedung (pelat lantai 2) tidak termasuk.
  function roofAt(x, y, h) {
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!c) return 0;
    let best = 0;
    for (const pi of c.p) {
      const G = polys[pi];
      if (!G.roof || G.floor > h + 0.05 || G.floor <= best || x < G.x0 || x > G.x1 || y < G.y0 || y > G.y1 || !pipF(x, y, G.pts)) continue;
      best = G.floor;
    }
    return best;
  }
  // pintu lift menara dalam jangkauan r dari kaki agen di (x, y, z) → { L, level, up }: level 0 lobi, 1..n lantai
  // (L.floors[level − 1]), n + 1 atap; up = sedang di lobi
  function liftAt(x, y, z, r = 1.7) {
    for (const L of lifts) {
      if (Math.hypot(x - L.dLo[0], y - L.dLo[1]) < r) {
        if (Math.abs(z) < 1) return { L, level: 0, up: true };
        for (let k = 0; k < L.floors.length; k++) if (Math.abs(z - L.floors[k]) < 1) return { L, level: k + 1, up: false };
      }
      if (Math.abs(z - L.z) < 1 && Math.hypot(x - L.dHi[0], y - L.dHi[1]) < r) return { L, level: L.floors.length + 1, up: false };
    }
    return null;
  }
  // titik keluar lift di tingkat level (lihat liftAt): { x, y, z, yaw }
  function liftSpot(L, level) {
    if (level <= 0) return L.lo;
    if (level > L.floors.length) return L.hi;
    return { x: L.lo.x, y: L.lo.y, z: L.floors[level - 1], yaw: L.lo.yaw };
  }
  // Lapisan rintangan sementara (perabot lantai menara yang sedang dikunjungi, interiors.js): format sama dengan
  // addObstacles (+ z0, b) → daftar id; removeLayer(id) melepasnya lagi (slot dipakai ulang).
  const DEAD = { pts: new Float64Array(0), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, h: -Infinity, z0: Infinity, b: -9, s: 0 };
  function addLayer(list) {
    const ids = [];
    for (const o of list) {
      const flat = o.pts || rectFlat(o.x, o.y, Math.cos(o.rot || 0), Math.sin(o.rot || 0), o.w, o.d);
      const i = addPoly(flat, o.h, o.b === undefined ? -3 : o.b, 1, o.z0 || 0, o.floor ? { floor: o.h } : null);
      if (i >= 0) ids.push(i);
    }
    return ids;
  }
  function addFurnLayer(list, z0, b) { const ids = []; for (const f of list) furnAdd(f, z0, b, ids); return ids; } // perabot lantai menara (sementara)
  function removeLayer(ids) {
    for (const i of ids || []) {
      const G = polys[i];
      if (!G || G === DEAD) continue;
      span(G.x0, G.y0, G.x1, G.y1, (c) => { const k = c.p.indexOf(i); if (k >= 0) c.p.splice(k, 1); });
      polys[i] = DEAD;
      freeIds.push(i);
    }
  }
  const wdepth = makeWaterDepth(D);
  // kedalaman air di (x, y) (m; 0 = bukan air), sama dengan dasar danau di world.js
  function waterDepth(x, y) { return waterAt(x, y) ? Math.max(0.05, wdepth(x, y)) : 0; }
  function waterAt(x, y) { // titik di dalam danau/kolam?
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!c) return false;
    for (const pi of c.p) { const G = polys[pi]; if (G.b === -1 && x >= G.x0 && x <= G.x1 && y >= G.y0 && y <= G.y1 && pipF(x, y, G.pts)) return true; }
    return false;
  }
  function inBuilding(x, y) { // indeks gedung yang memuat titik ini (−1 kalau tidak ada)
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!c) return -1;
    for (const pi of c.p) {
      const G = polys[pi];
      if (G.b >= 0 && (G.z0 === 0 || G.slab) && x >= G.x0 && x <= G.x1 && y >= G.y0 && y <= G.y1 && pipF(x, y, G.pts)) return G.b;
    }
    return -1;
  }
  return { polys, trees, segs, lifts, near, resolve, step, blocked, findFree, viewSpot, roadSpot, arrival, solidAt, roadAt, ray, los, inBuilding, waterAt, waterDepth, floorAt, roofAt, liftAt, liftSpot, addLayer, addFurnLayer, removeLayer, lastTouch, inArea, addObstacles, fitProne, crossed, guard, doors, doorNear, doorAhead, setDoor, resetDoors, get doorStamp() { return doorStamp; } };
}
