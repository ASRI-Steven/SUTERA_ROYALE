// Bot: terjun dari pesawat, jarah di sekitar tempat mendarat, bergerak ke zona (jalan kaki lewat jaringan jalan,
// atau naik kendaraan kalau jauh), dan bertarung secara taktis:
//   berlindung di balik gedung → mengintip dengan bidikan siap → kembali berlindung untuk isi ulang/obat,
//   mengepung dari samping kalau buntu, mendesak saat musuh lemah/isi ulang, mundur saat darah tipis,
//   memilih senjata sesuai jarak, mendengar tembakan & langkah lari, menghindar dari kendaraan yang menyeruduk.
// Regu (4 orang, lihat game/main.js): tiap bot punya b.team, b.sq (regu: members, leader, focus) dan b.ally (rekan pemain).
//   - pemimpin regu (anggota berdiri pertama; di regu pemain: pemain) menjalankan logika jarah/zona/jelajah biasa,
//     anggota lain mengikutinya dalam formasi longgar, ikut naik kendaraannya, dan berbagi sasaran (sq.focus);
//   - rekan seregu tidak pernah jadi sasaran; yang tumbang (b.down) hanya bisa merangkak dan dipulihkan rekannya
//     (bot mendatangi rekan tumbang lalu berlutut 5 dtk; kemajuan dihitung main.js squadTick);
//   - rekan pemain terjun bersama pemain (formasi di udara) dan mendarat di dekatnya.
// Digambar sebagai kerumunan instans (map/rig.js). Koordinat agen: dunia three.js (x, tinggi, z = −y data).
import * as THREE from 'three';
import { Rig, createCrowd, characterVariants } from '../map/rig.js';
import { chuteShape, chuteCollapse } from './chutefx.js';
import { WEAPONS } from './weapons.js';
import { applyItem, TIER, propGeometry } from './loot.js';
import { createNav } from './nav.js';
import * as audio from './audio.js';
import { HOUSE } from '../map/interiors.js';

const M = 0.1;
const NAMES = ['Raka', 'Dimas', 'Sinta', 'Bayu', 'Putri', 'Arif', 'Nadia', 'Fajar', 'Gilang', 'Intan', 'Joko', 'Kevin', 'Laras', 'Mega', 'Nanda', 'Oki', 'Pandu',
  'Rizky', 'Sari', 'Tegar', 'Umar', 'Vina', 'Wulan', 'Yoga', 'Zaki', 'Adit', 'Bima', 'Citra', 'Dewi', 'Eka', 'Farhan', 'Gita', 'Hendra', 'Indra', 'Jihan', 'Kiki',
  'Lukman', 'Maya', 'Niko', 'Okta', 'Prima', 'Rani', 'Satria', 'Tasya', 'Vino', 'Wira', 'Yusuf', 'Zahra', 'Agus', 'Bella',
  'Andi', 'Bagas', 'Cahya', 'Danu', 'Elsa', 'Fikri', 'Galih', 'Hana', 'Irfan', 'Jaka', 'Kartika', 'Lina', 'Made', 'Nurul', 'Oscar', 'Puspa', 'Reza',
  'Salsa', 'Taufik', 'Ucok', 'Vera', 'Wahyu', 'Yanti', 'Zulfa', 'Ayu', 'Bonar', 'Clara', 'Dodi', 'Erik', 'Fitri', 'Gede', 'Hesti', 'Ilham', 'Juna',
  'Ketut', 'Lestari', 'Mira', 'Nando', 'Opik', 'Pras', 'Rosa', 'Sigit', 'Tia', 'Utari', 'Wayan', 'Yohan', 'Rudi', 'Siska', 'Toni', 'Wening'];
const SHIRTS = ['#5b6b4a', '#7a6a4f', '#3f5468', '#6b3f3f', '#4d4d55', '#2f5f5a', '#8a7a5c', '#5a4a6a', '#3d6e8a', '#806040', '#9a9a9a', '#b5651d'];
const PANTS = ['#2f3440', '#3b3a33', '#4a4535', '#26292f', '#5a5446', '#3a4250'];
const SKINS = ['#f1c7a5', '#e0ac85', '#c68c66', '#a8714f', '#8a5a3c', '#6b4430'];
const HAIRS = ['#1d1714', '#3a2a1e', '#5a3e28', '#2b2b2b', '#7a5a3a'];
const GEARC = ['#4c5340', '#c9b48a', '#66704a', '#2f3136'];
// penampilan (karakter v3): nama perempuan → varian tubuh perempuan; warna kemeja dalam (varian berjaket)
const FEMALE = new Set(['Sinta', 'Putri', 'Nadia', 'Intan', 'Laras', 'Mega', 'Sari', 'Vina', 'Wulan', 'Citra', 'Dewi', 'Gita', 'Jihan', 'Maya', 'Rani', 'Tasya', 'Zahra', 'Bella',
  'Cahya', 'Elsa', 'Hana', 'Kartika', 'Lina', 'Nurul', 'Puspa', 'Salsa', 'Vera', 'Yanti', 'Zulfa', 'Ayu', 'Clara', 'Fitri', 'Hesti', 'Lestari', 'Mira', 'Rosa', 'Tia', 'Utari', 'Siska', 'Wening', 'Kiki', 'Okta']);
const INNERS = ['#d9d5cc', '#b9b2a2', '#8d8f96', '#c9c1b0', '#6f7d8c', '#a39a86', '#e6e2da'];
const pickA = (a) => a[Math.random() * a.length | 0];
const rnd = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Tingkat kesulitan.
// Dasar: react = jeda reaksi (dtk), err = sebaran bidik (°), range = jarak lihat (m), fov = setengah sudut pandang (rad),
//   hear = jarak dengar tembakan, still/crouch = peluang diam/jongkok saat baku tembak,
//   dmgToPlayer = pengali kerusakan bot ke pemain. Semua bot mendarat tangan kosong (senjata & pelindung dari jarahan).
// Taktik: cover/peek/flank/push = peluang berlindung, mengintip, mengepung, mendesak; settle/settleK = bidikan awal melebar
//   (×(1+settleK)) lalu mengunci dalam ±settle dtk; head = peluang membidik kepala per rentetan (langkah kaki terdengar
//   menurut cara bergerak untuk semua tingkat, lihat stepNoise; reaksinya memakai react); sprint = kecepatan pindah posisi; turn = kecepatan memutar badan (rad/dtk); dodge = peluang menghindar
//   kendaraan; preaim = pengali reaksi saat mengintip ke arah yang sudah dibidik; drive = peluang naik kendaraan ke zona.
// Kecerdasan (18 Nov): lootT = lama satu sesi jarah pemimpin (dtk); third = peluang ikut campur pertempuran yang terdengar
//   jauh; finish = peluang mendesak lawan yang tumbang; hold = peluang bertahan di dalam rumah (dekat pintu/jendela) selama
//   menunggu zona; smoke = peluang memakai granat asap (memulihkan rekan / mundur); early = berangkat ke zona berikutnya
//   sekian dtk lebih awal setelah perlengkapan lengkap; wary = peluang bergerak hati-hati (jongkok, berlindung) saat musuh
//   baru terdengar di dekat sini.
export const DIFFICULTY = {
  easy: { label: 'Mudah', note: 'Bot lambat bereaksi, sering meleset, dan jarang berlindung. Cocok untuk belajar.', react: [0.75, 1.35], err: 2.7, moveErr: 1.6, targetMoveErr: 1.2, range: 95, fov: 1.05, hear: 60,
    burst: [3, 5], pause: [0.55, 1.15], still: 0.25, crouch: 0, dmgToPlayer: 0.6,
    cover: 0.3, peek: 0.35, flank: 0.05, push: 0.2, settle: 1.3, settleK: 1.7, head: 0, sprint: 5.2, turn: 4.2, dodge: 0.4, preaim: 0.85, strafeT: [0.8, 1.8], drive: 0.3, smartWeapon: 0.3, zoneEarly: false,
    lootT: 70, third: 0, finish: 0.35, hold: 0.15, smoke: 0, early: 0, wary: 0 },
  medium: { label: 'Sedang', note: 'Bot berlindung di balik gedung, mengintip, dan sesekali mengepung.', react: [0.45, 0.85], err: 1.8, moveErr: 1.1, targetMoveErr: 0.9, range: 130, fov: 1.3, hear: 95,
    burst: [4, 6], pause: [0.4, 0.8], still: 0.18, crouch: 0.4, dmgToPlayer: 0.85,
    cover: 0.7, peek: 0.75, flank: 0.35, push: 0.45, settle: 0.85, settleK: 1.3, head: 0.08, sprint: 5.9, turn: 5.6, dodge: 0.75, preaim: 0.55, strafeT: [0.5, 1.2], drive: 0.6, smartWeapon: 0.75, zoneEarly: true,
    lootT: 55, third: 0.25, finish: 0.7, hold: 0.45, smoke: 0.4, early: 50, wary: 0.5 },
  hard: { label: 'Sulit', note: 'Bot sigap & akurat: berlindung, mengintip dengan bidikan siap, mengepung dari samping, mendesak saat kamu isi ulang, naik kendaraan ke zona.', react: [0.22, 0.45], err: 1.25, moveErr: 0.75, targetMoveErr: 0.6, range: 180, fov: 1.7, hear: 150,
    burst: [4, 7], pause: [0.35, 0.65], still: 0.1, crouch: 0.75, dmgToPlayer: 1,
    cover: 0.92, peek: 1, flank: 0.65, push: 0.75, settle: 0.5, settleK: 1.0, head: 0.2, sprint: 6.4, turn: 7.5, dodge: 1, preaim: 0.35, strafeT: [0.28, 0.75], drive: 0.85, smartWeapon: 1, zoneEarly: true,
    lootT: 45, third: 0.5, finish: 0.95, hold: 0.7, smoke: 0.8, early: 80, wary: 0.85 },
};
const SKILL = { ...DIFFICULTY.easy };
const SKIP_N = 8; // barang yang diingat untuk dilewati (cincin; kedaluwarsa)
const WD_T = 4; // pengawas: berniat jalan selama ini tanpa berpindah ≥ 2,5 m → tujuan dianggap tak terjangkau
const HOP_ANG = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3]; // arah titik antara jalan bertahap (rad, relatif ke arah tujuan)
// jarak nyaman per senjata [min, max] (m) dan kecocokan senjata untuk jarak tertentu
const PREF = { shotgun: [3, 11], smg: [6, 24], pistol: [7, 22], ar: [16, 70], dmr: [40, 140], sniper: [60, 220], lmg: [14, 80], revolver: [5, 25], burst: [16, 75], pdw: [4, 22], dbs: [2, 9] };
function suit(kind, d) {
  switch (kind) {
    case 'shotgun': return d < 10 ? 10 : d < 18 ? 5 : 0.5;
    case 'smg': return d < 15 ? 8 : d < 35 ? 7 : d < 60 ? 3 : 1;
    case 'ar': return d < 15 ? 6 : d < 120 ? 8.5 : 5;
    case 'dmr': return d < 25 ? 2 : d < 60 ? 6 : 9.5;
    case 'sniper': return d < 25 ? 1 : d < 70 ? 6 : 10;
    case 'lmg': return d < 12 ? 6 : d < 90 ? 8.8 : 5;
    case 'burst': return d < 15 ? 6 : d < 110 ? 8.3 : 5;
    case 'pdw': return d < 18 ? 8.6 : d < 35 ? 6 : 1.5;
    case 'dbs': return d < 8 ? 10.5 : d < 14 ? 4 : 0.3;
    case 'revolver': return d < 25 ? 5 : 2.5;
    default: return d < 20 ? 4 : 2;
  }
}

// ---------- Graf jalan + A* ----------
function buildGraph(D, col) {
  const X = [], Y = [], W = [], adj = [], idx = new Map();
  const node = (x, y, w) => {
    const k = Math.round(x) + ',' + Math.round(y);
    let i = idx.get(k);
    if (i === undefined) { i = X.length; idx.set(k, i); X.push(x); Y.push(y); W.push(w); adj.push([]); } else W[i] = Math.max(W[i], w);
    return i;
  };
  D.roads.r.forEach((r, ri) => {
    const cls = D.classes[D.roads.c[ri]];
    if (cls === 'motorway' || cls === 'motorway_link') return; // jalan tol: tidak dipakai
    const w = D.roads.w[ri] * M;
    let prev = -1;
    for (let j = 0; j + 1 < r.length; j += 2) {
      // simpul di luar kawasan tidak dipakai: dinding batas menahan bot & kendaraan, jadi rute lewat situ pasti macet
      if (!col.inArea(r[j] * M, r[j + 1] * M)) { prev = -1; continue; }
      const n = node(r[j] * M, r[j + 1] * M, w);
      if (prev >= 0 && prev !== n) { const d = Math.hypot(X[n] - X[prev], Y[n] - Y[prev]); adj[prev].push(n, d); adj[n].push(prev, d); }
      prev = n;
    }
  });
  // Data OSM yang disederhanakan memutus banyak simpang T (ujung jalan menempel di tengah ruas lain tanpa titik
  // bersama) → graf pecah ratusan bagian dan A* gagal. Sambungkan: (1) ujung buntu ke ruas terdekat ≤ 9 m,
  // (2) bagian kecil ke bagian utama lewat sambungan pendek yang tidak menembus gedung.
  const link = (a, b) => { const d = Math.hypot(X[a] - X[b], Y[a] - Y[b]); adj[a].push(b, d); adj[b].push(a, d); };
  const clearPath = (ax, ay, bx, by) => { const L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / 1.5); for (let i = 1; i < n; i++) { const t = i / n; if (col.blocked(ax + (bx - ax) * t, ay + (by - ay) * t, 0.3)) return false; } return true; };
  {
    const SG = new Map(), SC = 25, sk = (cx, cy) => (cx + 4096) * 8192 + (cy + 4096), edges = [];
    for (let u = 0; u < X.length; u++) for (let j = 0; j < adj[u].length; j += 2) { const v = adj[u][j]; if (u < v) edges.push(u, v); }
    for (let e = 0; e < edges.length; e += 2) {
      const u = edges[e], v = edges[e + 1];
      for (let cx = Math.floor(Math.min(X[u], X[v]) / SC); cx <= Math.floor(Math.max(X[u], X[v]) / SC); cx++)
        for (let cy = Math.floor(Math.min(Y[u], Y[v]) / SC); cy <= Math.floor(Math.max(Y[u], Y[v]) / SC); cy++) (SG.get(sk(cx, cy)) || SG.set(sk(cx, cy), []).get(sk(cx, cy))).push(e);
    }
    const n0 = X.length;
    for (let i = 0; i < n0; i++) {
      if (adj[i].length > 2) continue; // hanya ujung buntu
      let best = null, bd = 9;
      for (let cx = Math.floor((X[i] - 9) / SC); cx <= Math.floor((X[i] + 9) / SC); cx++) for (let cy = Math.floor((Y[i] - 9) / SC); cy <= Math.floor((Y[i] + 9) / SC); cy++) {
        for (const e of SG.get(sk(cx, cy)) || []) {
          const u = edges[e], v = edges[e + 1];
          if (u === i || v === i || adj[i].includes(u) || adj[i].includes(v)) continue;
          const dx = X[v] - X[u], dy = Y[v] - Y[u], L = dx * dx + dy * dy;
          const t = L > 0 ? Math.max(0, Math.min(1, ((X[i] - X[u]) * dx + (Y[i] - Y[u]) * dy) / L)) : 0;
          const px = X[u] + dx * t, py = Y[u] + dy * t, d = Math.hypot(px - X[i], py - Y[i]);
          if (d < bd) { bd = d; best = { u, v, t, px, py }; }
        }
      }
      if (!best) continue;
      if (best.t < 0.05) link(i, best.u);
      else if (best.t > 0.95) link(i, best.v);
      else { const k = node(best.px, best.py, Math.min(W[best.u], W[best.v])); link(k, best.u); link(k, best.v); link(k, i); }
    }
    // komponen
    const comp = new Int32Array(X.length).fill(-1), size = [];
    for (let i = 0; i < X.length; i++) {
      if (comp[i] >= 0) continue;
      const c = size.length, st = [i];
      comp[i] = c;
      let cnt = 0;
      while (st.length) { const u = st.pop(); cnt++; for (let j = 0; j < adj[u].length; j += 2) { const v = adj[u][j]; if (comp[v] < 0) { comp[v] = c; st.push(v); } } }
      size.push(cnt);
    }
    let main = 0;
    for (let c = 1; c < size.length; c++) if (size[c] > size[main]) main = c;
    const NG = new Map(), NC = 30, nk = (cx, cy) => (cx + 4096) * 8192 + (cy + 4096);
    for (let i = 0; i < X.length; i++) if (comp[i] === main) (NG.get(nk(Math.floor(X[i] / NC), Math.floor(Y[i] / NC))) || NG.set(nk(Math.floor(X[i] / NC), Math.floor(Y[i] / NC)), []).get(nk(Math.floor(X[i] / NC), Math.floor(Y[i] / NC)))).push(i);
    const done = new Set([main]);
    for (let i = 0; i < X.length; i++) {
      const c = comp[i];
      if (done.has(c)) continue;
      // pasangan simpul terdekat ke komponen utama (≤ 60 m); cek tembus gedung hanya untuk beberapa kandidat teratas
      const cand = [];
      for (let j = i; j < X.length; j++) {
        if (comp[j] !== c) continue;
        for (let cx = Math.floor((X[j] - 60) / NC); cx <= Math.floor((X[j] + 60) / NC); cx++) for (let cy = Math.floor((Y[j] - 60) / NC); cy <= Math.floor((Y[j] + 60) / NC); cy++) {
          for (const m of NG.get(nk(cx, cy)) || []) { const d = Math.hypot(X[m] - X[j], Y[m] - Y[j]); if (d < 60) cand.push([d, j, m]); }
        }
      }
      cand.sort((p, q) => p[0] - q[0]);
      let best = null;
      for (let k = 0; k < Math.min(10, cand.length); k++) { const [, j, m] = cand[k]; if (clearPath(X[j], Y[j], X[m], Y[m])) { best = [j, m]; break; } }
      done.add(c);
      if (best) { link(best[0], best[1]); for (let j = i; j < X.length; j++) if (comp[j] === c) comp[j] = main; }
    }
    W.comp = comp; W.main = main;
  }
  const grid = new Map(), C = 40, gk = (cx, cy) => (cx + 2048) * 4096 + (cy + 2048);
  for (let i = 0; i < X.length; i++) { const k = gk(Math.floor(X[i] / C), Math.floor(Y[i] / C)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  const MAIN = W.main, COMP = W.comp;
  function nearest(x, y, maxR = 200, mainOnly = false) {
    let best = -1, bd = Infinity;
    for (let r = 0; r <= Math.ceil(maxR / C); r++) {
      const cx0 = Math.floor(x / C), cy0 = Math.floor(y / C);
      for (let cx = cx0 - r; cx <= cx0 + r; cx++) for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
        if (Math.max(Math.abs(cx - cx0), Math.abs(cy - cy0)) !== r) continue;
        const arr = grid.get(gk(cx, cy));
        if (arr) for (const i of arr) { if (mainOnly && COMP[i] !== MAIN) continue; const d = Math.hypot(X[i] - x, Y[i] - y); if (d < bd) { bd = d; best = i; } }
      }
      if (best >= 0 && bd < r * C) break;
    }
    return best;
  }
  const N = X.length, gs = new Float64Array(N), from = new Int32Array(N), seen = new Int32Array(N);
  let gen = 0;
  // ruas yang baru saja gagal dilalui (bot macet di antara dua simpulnya, mis. gang yang tertutup dinding rumah):
  // dihindari semua bot & kendaraan sampai kedaluwarsa
  const bad = new Map(), ekey = (i, j) => (i < j ? i * N + j : j * N + i);
  let badNow = 0;
  function markBad(i, j, until) { if (i >= 0 && j >= 0 && i !== j) bad.set(ekey(i, j), until); }
  // srcs: [simpul, biaya awal, …] (banyak titik awal: bot memilih simpul masuk yang searah tujuan, bukan sekadar yang terdekat)
  function search(srcs, t, useBad = true) {
    if (t < 0 || !srcs.length) return null;
    gen++;
    const heap = [], push = (i, f) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    for (let k = 0; k < srcs.length; k += 2) { const s = srcs[k]; if (seen[s] === gen && gs[s] <= srcs[k + 1]) continue; seen[s] = gen; gs[s] = srcs[k + 1]; from[s] = -1; push(s, srcs[k + 1] + Math.hypot(X[t] - X[s], Y[t] - Y[s])); }
    let n = 0;
    while (heap.length && n++ < 40000) {
      const [f, u] = pop();
      if (f > gs[u] + Math.hypot(X[t] - X[u], Y[t] - Y[u]) + 1e-6) continue; // entri usang
      if (u === t) { const path = []; for (let v = t; v >= 0; v = from[v]) path.push(v); return path.reverse(); }
      const a = adj[u];
      for (let j = 0; j < a.length; j += 2) {
        const v = a[j], g = gs[u] + a[j + 1];
        if (seen[v] === gen && g >= gs[v]) continue;
        if (useBad && bad.size) { const e = bad.get(ekey(u, v)); if (e !== undefined) { if (e > badNow) continue; bad.delete(ekey(u, v)); } }
        seen[v] = gen; gs[v] = g; from[v] = u;
        push(v, g + Math.hypot(X[t] - X[v], Y[t] - Y[v]));
      }
    }
    return null;
  }
  const one = [0, 0];
  function astar(s, t) { if (s < 0) return null; one[0] = s; one[1] = 0; return search(one, t); }
  // rute dari titik bebas (px, py) ke (x, y): simpul masuk = simpul-simpul ≤ 45 m (biaya awal = jarak lurus + 30 % kalau
  // tidak terlihat lurus menurut vis), simpul tujuan = terdekat; kalau gagal, ulangi hanya dengan komponen utama
  const srcBuf = [];
  function route(px, py, x, y, now, vis) {
    badNow = now;
    const t = nearest(x, y);
    srcBuf.length = 0;
    let nv = 0;
    const cx0 = Math.floor((px - 45) / C), cx1 = Math.floor((px + 45) / C), cy0 = Math.floor((py - 45) / C), cy1 = Math.floor((py + 45) / C);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const arr = grid.get(gk(cx, cy));
      if (arr) for (const i of arr) {
        const d = Math.hypot(X[i] - px, Y[i] - py);
        if (d >= 45 || srcBuf.length >= 24) continue;
        const ok = vis && d < 30 && (nv++ < 5) && vis(X[i], Y[i]); // terlihat lurus: tanpa denda (uji dibatasi 5 simpul)
        srcBuf.push(i, ok ? d : d * 1.3 + 8);
      }
    }
    if (!srcBuf.length) { const s = nearest(px, py); if (s >= 0) srcBuf.push(s, Math.hypot(X[s] - px, Y[s] - py)); }
    let p = search(srcBuf, t);
    if (!p) { const s = nearest(px, py, 300, true), t2 = nearest(x, y, 300, true); if (s >= 0) { one[0] = s; one[1] = 0; p = search(one, t2); } }
    if (!p && bad.size) p = search(srcBuf, t, false); // ruas buruk memutus semua jalan keluar: lebih baik rute lama daripada tanpa rute
    return p;
  }
  return { X, Y, W, N: X.length, nearest, astar, route, markBad, comp: COMP, main: MAIN, setNow: (t) => { badNow = t; } };
}

export function createBots(ctx, n = 50) {
  const { scene, col, zone, loot, combat, agents } = ctx;
  const V = ctx.vehicles || null, GR = ctx.grass || null;
  const PLAYER = agents.find((o) => o.isPlayer) || null;
  const G = buildGraph(ctx.D, col);
  const nav = createNav(col, ctx.homes || null); // pintu & celah sekat rumah = titik wakil sel grid
  const homes = ctx.homes || null; // tata letak gedung (tangga rumah 2 lantai)
  let budget = 0, frameT0 = 0; // jatah pencarian jalur/perlindungan per frame (biar tidak tersendat): jumlah & waktu (≤ 3 ms)
  const spend = () => (budget > 0 && performance.now() - frameT0 < 3 ? (budget--, true) : false);
  const crowd = createCrowd(scene, n);
  // payung & bayangan bulat (instans)
  const chuteGLB = propGeometry('parachute'), chuteY = chuteGLB ? 1.45 : 4.4; // parasut Blender (asal di titik gantung)
  if (chuteGLB) chuteGLB.rotateY(Math.PI); // tepi depan menghadap arah terbang
  const chuteGeo = chuteGLB || new THREE.SphereGeometry(3.2, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.32).scale(1, 0.55, 0.75);
  const chuteMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: !!chuteGLB });
  chuteMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.28;'); }; // tidak gelap dilihat dari bawah
  const chutes = new THREE.InstancedMesh(chuteGeo, chuteMat, n);
  const chO = { vis: false, sx: 1, sy: 1, sz: 1, rx: 0 }, chE = new THREE.Euler();
  chutes.frustumCulled = false;
  scene.add(chutes);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g2 = cv.getContext('2d'), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(20,16,40,.5)'); gr.addColorStop(1, 'rgba(20,16,40,0)');
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }), n);
  blobs.frustumCulled = false;
  blobs.renderOrder = 8;
  scene.add(blobs);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const CHUTE_COL = ['#D29F52', '#503EBA', '#e05a47', '#2f8f6a', '#f2f2f2', '#2a6fb0'];
  const bots = [];
  const VARS = characterVariants(), VAR_F = VARS.filter((v) => v.female), VAR_M = VARS.filter((v) => !v.female); // kosong = model lama
  for (let i = 0; i < n; i++) {
    const b = ctx.makeAgent(NAMES[i % NAMES.length], false);
    b.i = i;
    b.rig = new Rig();
    b.outfit = { shirt: pickA(SHIRTS), sleeve: pickA(SHIRTS), pants: pickA(PANTS), skin: pickA(SKINS), hair: pickA(HAIRS), shoes: '#1c1b22', gear: GEARC[0], pack: pickA(['#3a3d34', '#4a3f30', '#2e3440', '#5a4632']), trim: '#D29F52', inner: pickA(INNERS) };
    b.outfit.sleeve = b.outfit.shirt;
    b.trait = { aggr: Math.random(), acc: rnd(0.88, 1.12), patience: rnd(0.7, 1.35) };
    b.longHair = Math.random() < 0.3;
    if (VARS.length) { // varian tubuh, gaya rambut & tinggi badan (kerangka sama, akar diskala sedikit; kotak kena tetap)
      const fem = FEMALE.has(b.name) && VAR_F.length > 0, pool = fem ? VAR_F : (VAR_M.length ? VAR_M : VARS), v = pickA(pool);
      b.look = { variant: v.key, hair: Math.random() * Math.max(1, v.hair) | 0, scale: fem ? rnd(0.935, 0.97) : rnd(0.975, 1.02) };
      b.rig.root.scale.setScalar(b.look.scale);
    }
    crowd.setOutfit(i, b.outfit, b.look || undefined);
    chutes.setColorAt(i, new THREE.Color(pickA(CHUTE_COL)));
    b.ai = {
      mode: 'plane', jumpAt: 0, land: null, nav: null, goal: null, spd: 5, lane: rnd(-1.6, 1.6), next: Math.random() * 0.3, item: null,
      target: null, reactAt: 0, seenAt: -99, lastSeen: new THREE.Vector3(), losOk: false, burst: 0, nextShot: 0, aimK: 1, head: false, switchAt: 0,
      tac: null, tacUntil: 0, cover: null, coverCD: 0, nextPeek: 0, peekUntil: 0, peeks: 0, preaimFor: null, preaimAt: -99, scanUntil: 0,
      strafe: 1, strafeT: 0, stuckT: 0, stuckN: 0, lootN: 0, idleT: 0, hurtAt: -99, hurtBy: null, poseT: 0, healKind: null,
      scanT: 0, scanYaw: 0, dodgeT: 0, dodgeUntil: 0, dodgeX: 0, dodgeY: 0,
      veh: null, dpath: null, dpi: 0, dest: null, braking: false, revUntil: 0, revSteer: 0, dStuck: 0, dStuckN: 0, drive: { throttle: 0, steer: 0, handbrake: false, boost: false },
      // pengawas kemajuan (lihat unstick): jangkar posisi, lama berniat jalan tanpa berpindah, hitungan macet beruntun
      anX: 0, anY: 0, anH: 0, anW: 0, wdN: 0, wdAt: -99, escUntil: 0, soloUntil: 0, hopUntil: 0, bcX: 0, bcY: 0, bcH: 0, dAnX: 0, dAnY: 0, dAnT: 0, wp: [0, 0], wpN: null, wpI: 0, wpD: 0, wpT: 0, // bc = jejak titik bebas terakhir
      skI: new Array(SKIP_N).fill(null), skT: new Float64Array(SKIP_N), skK: 0, // barang yang dilewati sementara (tidak berguna / tak terjangkau)
      lootEnd: 0, lootPeek: 0, zoneRun: 0, third: -99, gunAt: -99, gunPos: null, gunO: null, thirdAt: 0, holdEnd: 0, holdCD: 0, holdYaw: 0, holdH: null, holdX: 0, holdY: 0, lift: null, revSkip: null, revSkipUntil: 0, smokeAt: 0,
      warnCD: 0, coverWait: 0, heardAt: -99,
    };
    bots.push(b);
    agents.push(b);
  }
  chutes.instanceColor.needsUpdate = true;
  let drawN = 0, chuteDirty = true;

  // ---------- Terjun ----------
  // titik mendarat dipilih dulu (di dalam kawasan, ≤ 420 m dari jalur pesawat), lalu waktu lompat = proyeksinya ke jalur
  function planJumps(path, flightTime) {
    const ax = path[0][0], ay = path[0][1], dx = path[1][0] - ax, dy = path[1][1] - ay, L = Math.hypot(dx, dy);
    const along = (x, y) => ((x - ax) * dx + (y - ay) * dy) / (L * L), off = (x, y) => Math.abs((x - ax) * dy - (y - ay) * dx) / L;
    const hot = ctx.D.pois.map((p) => [p.x * M, p.y * M]).filter(([x, y]) => off(x, y) < 450 && along(x, y) > 0.05 && along(x, y) < 0.95 && ctx.inArea(x, y));
    for (let i = hot.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [hot[i], hot[j]] = [hot[j], hot[i]]; }
    const spots = hot.slice(0, Math.max(9, Math.round(n / 7)));
    const pick = (bi) => { // titik mendarat satu regu + posisinya di jalur pesawat
      let land = null, f = 0.5;
      if (spots.length && bi % 20 < 9) { // ±45% regu mendarat di titik panas
        const [hx, hy] = spots[bi % spots.length];
        for (let k = 0; k < 40 && !land; k++) { const a = Math.random() * Math.PI * 2, d = rnd(15, 90), x = hx + Math.cos(a) * d, y = hy + Math.sin(a) * d; if (ctx.inArea(x, y) && !col.blocked(x, y, 0.4)) land = [x, y]; }
        if (land) f = Math.max(0.05, Math.min(0.95, along(land[0], land[1])));
      }
      for (let k = 0; k < 300 && !land; k++) {
        f = rnd(0.05, 0.95);
        const off = rnd(-420, 420), x = ax + dx * f - dy / L * off, y = ay + dy * f + dx / L * off;
        if (ctx.inArea(x, y) && !col.blocked(x, y, 0.4)) land = [x, y];
      }
      if (!land) { const i = G.nearest((ax + path[1][0]) / 2, (ay + path[1][1]) / 2, 5000); land = [G.X[i], G.Y[i]]; }
      return { land, at: Math.max(1, f * flightTime - rnd(0, 4)) };
    };
    const plan = new Map(); // regu → { land, at }: anggota terjun bersamaan & mendarat 5–18 m dari titik regu
    bots.forEach((b, bi) => {
      const key = b.team === undefined ? -1 - bi : b.team;
      let S = plan.get(key);
      if (!S) plan.set(key, (S = pick(bi)));
      let land = S.land;
      for (let k = 0; k < 16; k++) { const a = Math.random() * Math.PI * 2, d = rnd(5, 18), x = S.land[0] + Math.cos(a) * d, y = S.land[1] + Math.sin(a) * d; if (ctx.inArea(x, y) && !col.blocked(x, y, 0.4)) { land = [x, y]; break; } }
      // rekan pemain: bawaan ikut terjun saat pemain terjun; rencana regu sendiri (dropAt/dropLand) dipakai kalau pemain
      // memilih 'ikut rekan' atau 'terjun sendiri' (PLAYER.dropMode)
      if (b.ally) { b.ai.jumpAt = Infinity; b.ai.land = null; b.ai.own = false; b.ai.dropAt = S.at; b.ai.dropLand = land; return; }
      b.ai.jumpAt = S.at + rnd(0, 0.7);
      b.ai.land = land;
    });
  }
  // rekan pemain di udara: formasi di samping-depan pemain, keadaan mengikuti pemain
  // (terjun bebas / payung); begitu pemain mendarat → titik mendarat bebas 4–8 m darinya, lalu turun seperti biasa
  const airT = new THREE.Vector3();
  function allyAir(b, dt) {
    const P = PLAYER, a = b.ai;
    if (!P || P.state === 'plane') return true;
    if (P.alive && (P.state === 'fall' || P.state === 'chute')) {
      // di samping-depan pemain & sedikit lebih rendah, supaya terlihat dari kamera di belakang pemain
      // (posisi = pemain + selisih formasi yang dihaluskan, jadi tidak tertinggal walau jatuh 50 m/dtk)
      const k = b.slot || 1, side = k === 1 ? -6 : k === 2 ? 6 : -11.5, ahead = k === 3 ? 6.5 : 3.5, sn = Math.sin(P.yaw), cs = Math.cos(P.yaw);
      if (!a.airOff) a.airOff = new THREE.Vector3().subVectors(b.pos, P.pos);
      airT.set(sn * ahead + cs * side, -0.8 - k * 0.5, cs * ahead - sn * side);
      a.airOff.lerp(airT, 1 - Math.exp(-dt * 1.5));
      b.pos.copy(P.pos).add(a.airOff);
      b.yaw = P.yaw;
      b.state = P.state;
      a.land = null;
      return true;
    }
    if (!a.land) { // pemain sudah di darat (atau tersingkir): mendarat di dekatnya
      const k = b.slot || 1, ang = P.yaw + (k === 1 ? 2.3 : k === 2 ? -2.3 : Math.PI), px = P.pos.x + Math.sin(ang) * 5.5, py = -(P.pos.z + Math.cos(ang) * 5.5);
      a.land = (ctx.inArea(px, py) && col.findFree(px, py, 18, 0.4, true)) || [P.pos.x, -P.pos.z];
      if (b.state === 'fall' && b.pos.y < 200) b.state = 'chute';
    }
    return false;
  }
  function airStep(b, dt) {
    const a = b.ai, tx = a.land[0], ty = a.land[1], x = b.pos.x, y = -b.pos.z, d = Math.hypot(tx - x, ty - y);
    const chute = b.state === 'chute', hs = chute ? 11 : 24, vs = chute ? 9 : 50;
    b.airD = d; // jarak ke titik mendarat (pose udara: melayang maju bila masih jauh)
    if (d > 1) { const k = Math.min(hs, d / Math.max(0.5, b.pos.y / vs)) * dt; b.pos.x += (tx - x) / d * Math.min(d, Math.max(k, hs * dt * 0.3)); b.pos.z -= (ty - y) / d * Math.min(d, Math.max(k, hs * dt * 0.3)); }
    b.yaw = Math.atan2(tx - x, -(ty - y));
    b.pos.y -= vs * dt;
    if (!chute && b.pos.y < 120) b.state = 'chute';
    if (b.pos.y <= 0) {
      const f = (ctx.inArea(b.pos.x, -b.pos.z) && col.findFree(b.pos.x, -b.pos.z, 30, 0.4, true)) || a.land; // tidak mendarat di dalam rumah
      b.pos.set(f[0], 0, -f[1]);
      b.landAt = ctx.now(); b.landKind = chute ? 0 : 1; b.landChute = chute; // pose mendarat (map/rigair.js) & kanopi kempis
      b.state = 'ground';
      a.mode = 'loot';
      a.lootEnd = ctx.now() + SKILL.lootT;
      a.lootN = 0;
      a.next = 0;
      b.nades ||= { frag: 0, smoke: 0 }; // mendarat tangan kosong seperti pemain: senjata, pelindung & granat harus dijarah
    }
  }

  // ---------- Langkah kaki ----------
  // radius dengar langkah (m) menurut cara bergerak: lari 35, jalan 18, jongkok 5, tiarap/diam 0, berenang 16
  function stepNoise(o) {
    if (o.state !== 'ground' || o.prone) return 0;
    const s = o.moveSpeed || 0;
    if (s < 1) return 0;
    if (o.swim) return 16;
    if (o.crouch) return 5;
    return s > 5 ? 35 : 18;
  }
  // suara langkah bot untuk pendengar (kamera): jangkauan lari 40 m, jalan 22 m, jongkok 6 m, tiarap senyap; arah kiri/kanan;
  // teredam bila terhalang; dibatasi ±24 langkah/dtk (yang terdekat dulu) supaya 100 bot tidak riuh
  const STEPS = [];
  let stepTok = 6;
  function stepSound(b, dt, cam) {
    const s = b.moveSpeed || 0;
    if (s < 1 || b.prone) { b.stepT = Math.min(b.stepT || 0, 0.4); return; }
    b.stepT = (b.stepT || 0) - dt * s;
    if (b.stepT > 0) return;
    b.stepT = b.crouch ? 1.6 : s > 5 ? 2.2 : 1.9;
    const R = b.crouch ? 6 : s > 5 ? 40 : 22, dx = b.pos.x - cam.x, dz = b.pos.z - cam.z, d2 = dx * dx + dz * dz;
    if (d2 < R * R) STEPS.push(b, Math.sqrt(d2), R, s > 5 ? 1.2 : b.crouch ? 0.5 : 1);
  }
  function flushSteps(dt, cam) {
    stepTok = Math.min(6, stepTok + dt * 24);
    if (!STEPS.length) return;
    const n = STEPS.length / 4, idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((p, q) => STEPS[p * 4 + 1] - STEPS[q * 4 + 1]);
    const yaw = ctx.viewYaw ? ctx.viewYaw() : 0;
    for (const i of idx) {
      if (stepTok < 1) break;
      stepTok--;
      const b = STEPS[i * 4], d = STEPS[i * 4 + 1], R = STEPS[i * 4 + 2], k = 1 - d / R;
      const dx = b.pos.x - cam.x, dz = b.pos.z - cam.z, pan = -Math.sin(Math.atan2(dx, dz) - yaw);
      const soft = !!GR && GR.at(b.pos.x, -b.pos.z) > 0.35;
      const muffled = d > 2 && !col.los(cam.x, -cam.z, cam.y, b.pos.x, -b.pos.z, b.pos.y + 0.4);
      audio.footstep((0.025 + 0.15 * k * k) * STEPS[i * 4 + 3] * (soft ? 0.7 : 1) * (muffled ? 0.55 : 1), pan, muffled, soft);
    }
    STEPS.length = 0;
  }

  // ---------- Persepsi ----------
  const eye = new THREE.Vector3();
  function perceive(b, now) {
    let best = null, bd = SKILL.range, heard = null, hd = Infinity, gun = null, gd = Infinity;
    const bx = b.pos.x, bz = b.pos.z, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const cands = [];
    for (const o of agents) {
      if (o === b || !o.alive || o.team === b.team || (o.state !== 'ground' && o.state !== 'chute' && o.state !== 'drive') || o.dive) continue; // rekan seregu bukan sasaran; menyelam: tak terlihat
      const dx = o.pos.x - bx, dz = o.pos.z - bz, d = Math.hypot(dx, dz);
      if (d > SKILL.range || (o.down && d > 45)) continue; // yang tumbang hanya dihabisi dari dekat
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (d || 1))));
      const shot = o.lastShot && now - o.lastShot < 0.6 && d < SKILL.hear; // tembakan
      const sn = stepNoise(o), step = sn > 0 && d < sn && d < sn * (GR && GR.at(o.pos.x, -o.pos.z) > 0.35 ? 0.8 : 1); // langkah (rumput meredam)
      const loud = shot || (o.state === 'drive' && d < 110) || step; // tembakan / mesin / langkah
      if ((step || (shot && d < 70)) && d < hd) { heard = o; hd = d; } // terdengar dekat: diperiksa bila tidak terlihat
      else if (shot && d < gd) { gun = o; gd = d; } // tembakan jauh (pertempuran lain): arah diingat
      const aware = d < 12 || ang < SKILL.fov || (b.ai.hurtBy === o && now - b.ai.hurtAt < 4) || loud || (b.ai.target === o && now - b.ai.seenAt < 2);
      // rumput tinggi: yang jongkok/tiarap tidak terlihat dari jauh (kecuali menembak / bergerak cepat)
      if (aware && GR && o.state === 'ground' && (o.prone || o.crouch) && d > 6) {
        const g = GR.at(o.pos.x, -o.pos.z);
        if (g > 0.35) {
          const shot = o.lastShot && now - o.lastShot < 1.5, fast = (o.moveSpeed || 0) > (o.prone ? 1.6 : 2.6);
          if (!shot && !fast && d > (o.prone ? 8 : 20) * (1.3 - 0.5 * g)) continue;
        }
      }
      if (aware) cands.push([d + (o.down ? 70 : 0), o]); // yang masih berdiri didahulukan
    }
    cands.sort((p1, p2) => p1[0] - p2[0]);
    for (let k = 0; k < Math.min(3, cands.length); k++) {
      const [d, o] = cands[k];
      if (d >= bd && !o.down) break;
      const eh = b.pos.y + (b.prone ? 0.45 : b.crouch ? 1.1 : 1.55), th = o.pos.y + (o.state === 'drive' ? 1.0 : o.swim ? 1.6 : o.prone ? 0.35 : o.crouch ? 0.9 : 1.25);
      if (col.los(bx, -bz, eh, o.pos.x, -o.pos.z, th) && !(ctx.nades && ctx.nades.smokeBlocks(bx, -bz, eh, o.pos.x, -o.pos.z, th))) { best = o; bd = d; break; } // asap menghalangi
    }
    if (!best && heard) { const a = b.ai; a.heardO = heard; a.heardAt = now; (a.heardPos ||= new THREE.Vector3()).copy(heard.pos); }
    if (!best && gun) { const a = b.ai; a.gunO = gun; a.gunAt = now; (a.gunPos ||= new THREE.Vector3()).copy(gun.pos); }
    return best;
  }
  function weapon(b) { const w = b.cur >= 0 ? b.weapons[b.cur] : null; return w ? { inst: w, def: WEAPONS[w.kind] } : null; }
  const usable = (b, w) => w && (w.mag > 0 || b.ammo[WEAPONS[w.kind].ammo] > 0);
  function equipBest(b) {
    let bi = -1, bt = 0;
    b.weapons.forEach((w, i) => { if (usable(b, w) && TIER[w.kind] > bt) { bt = TIER[w.kind]; bi = i; } });
    b.cur = bi;
  }
  function pickWeapon(b, d, now) { // senjata paling cocok untuk jarak ini (ganti senjata makan 0,5 dtk)
    if (Math.random() > SKILL.smartWeapon && b.cur >= 0 && usable(b, b.weapons[b.cur])) return;
    let bi = -1, bs = -1;
    b.weapons.forEach((w, i) => { if (!usable(b, w)) return; const s = suit(w.kind, d) + TIER[w.kind] * 0.4 + (w.mag > 0 ? 0.6 : 0); if (s > bs) { bs = s; bi = i; } });
    if (bi >= 0 && bi !== b.cur) {
      const cur = b.cur >= 0 && b.weapons[b.cur], cs = usable(b, cur) ? suit(cur.kind, d) + TIER[cur.kind] * 0.4 + (cur.mag > 0 ? 0.6 : 0) : -9;
      if (bs > cs + 1.2) { b.cur = bi; b.ai.switchAt = now + 0.5; b.ai.burst = 0; b.reloadEnd = 0; b.pose.swap = 1; }
    }
  }

  // ---------- Bergerak: langsung / grid lokal / jaringan jalan; antar lantai lewat tangga ----------
  const lvOf = (b) => (b.pos.y > 4.5 ? b.pos.y : b.pos.y > 2 ? HOUSE.floor2 : 0); // tanah / lantai 2 rumah / atap menara
  // lift menara (map/collide.js lifts: pintu lobi dLo ↔ pintu atap dHi, z = tinggi atap) per indeks gedung
  const LIFTS = new Map();
  for (const L of col.lifts || []) LIFTS.set(L.b, L);
  function roofLift(x, y, h) { if (h < 4.5 || !LIFTS.size) return null; const L = LIFTS.get(col.inBuilding(x, y)); return L && Math.abs(L.z - h) < 2.5 ? L : null; }
  function homeUp(x, y, h) { // rumah 2 lantai yang lantai atasnya memuat (x, y) bila tinggi h ada di lantai atas
    if (!homes || h < 2) return null;
    const i = col.inBuilding(x, y), H = i >= 0 && homes.get(i);
    return H && H.up ? H : null;
  }
  function stairOf(x, y, h) { // rumah yang tangganya sedang dinaiki/dituruni di (x, y, h)
    if (!homes || h < 0.08) return null;
    const i = col.inBuilding(x, y), H = i >= 0 && homes.get(i);
    if (!H || !H.up) return null;
    const S = H.up.stair, s = (x - S.ax) * S.ux + (y - S.ay) * S.uy, l = Math.abs((x - S.ax) * -S.uy + (y - S.ay) * S.ux);
    return s > -0.3 && s < S.len + 0.3 && l < 0.65 && h < S.h1 - 0.08 ? H : null;
  }
  // gz = tinggi tujuan (lantai 2 rumah → rute: ke tangga, naik/turun, lalu ke tujuan)
  function go(b, x, y, spd, gz = 0) {
    const a = b.ai, px = b.pos.x, py = -b.pos.z;
    if (a.lift && a.nav && a.nav.kind === 'lift') return; // sedang di dalam lift: perintah gerak baru menunggu sampai tiba (dulu
    // anggota yang mengikuti pemimpin ke atap memesan ulang tiap 0,6 dtk sehingga perjalanan lift tak pernah selesai)
    a.route = null;
    // atap menara: lewat lift (pintu lift → naik/turun → tujuan), sama seperti pemain
    const tR = roofLift(x, y, gz), bR = roofLift(px, py, b.pos.y);
    if (tR !== bR) {
      const legs = [];
      if (bR) legs.push({ x: bR.hi.x, y: bR.hi.y, lv: bR.z, nd: true }, { lift: bR, up: false });
      if (tR) legs.push({ x: tR.lo.x, y: tR.lo.y, lv: 0 }, { lift: tR, up: true });
      legs.push({ x, y, lv: tR ? tR.z : 0, nd: !!tR });
      a.route = legs; a.routeSpd = spd;
      nextLeg(b);
      return;
    }
    const sH = stairOf(px, py, b.pos.y), bH = sH ? null : homeUp(px, py, b.pos.y), tH = homeUp(x, y, gz);
    if (!sH && bH === tH) { goLevel(b, x, y, spd, bH ? bH.up.floor : 0); return; }
    const legs = [];
    if (sH) legs.push({ H: sH, dir: tH === sH ? 1 : -1 });
    else if (bH) legs.push({ x: bH.up.stair.land[0], y: bH.up.stair.land[1], lv: bH.up.floor }, { H: bH, dir: -1 });
    if (tH && tH !== sH) legs.push({ x: tH.up.stair.ap[0], y: tH.up.stair.ap[1], lv: 0 }, { H: tH, dir: 1 });
    legs.push({ x, y, lv: tH ? tH.up.floor : 0 });
    a.route = legs;
    a.routeSpd = spd;
    nextLeg(b);
  }
  function nextLeg(b) {
    const a = b.ai, L = a.route.shift();
    if (!a.route.length) a.route = null;
    if (L.lift) { // naik/turun lift: harus di dekat pintunya; perjalanan selama waktu yang sama dengan pemain, lalu pindah
      const Lf = L.lift, door = L.up ? Lf.dLo : Lf.dHi, x = b.pos.x, y = -b.pos.z;
      if (Math.hypot(door[0] - x, door[1] - y) > 2.6 || Math.abs(b.pos.y - (L.up ? 0 : Lf.z)) > 1) { abandon(b, ctx.now()); return; }
      a.lift = { L: Lf, up: L.up, at: ctx.now() + 0.35 + Math.min(2.6, 0.9 + Lf.z / 70) };
      a.nav = { kind: 'lift' }; a.goal = [x, y];
      return;
    }
    if (L.H) {
      // tangga hanya dimulai dari ujungnya (kaki tangga / bordes) di lantai yang benar; kalau potongan sebelumnya gagal
      // sampai ke situ, seluruh rute batal (dulu bot langsung "menaiki tangga" dari luar rumah dan menabrak dinding).
      // Jalur grid bisa berhenti 1–2 m dari ujung tangga (ujungnya terlalu dekat pagar lubang): sisa jarak ditempuh lurus dulu.
      const S = L.H.up.stair, st = L.dir > 0 ? S.ap : S.land, end = L.dir > 0 ? S.land : S.ap, x = b.pos.x, y = -b.pos.z, lv = L.dir > 0 ? 0 : L.H.up.floor;
      if (stairOf(x, y, b.pos.y) !== L.H) {
        const ds = Math.hypot(st[0] - x, st[1] - y);
        if (ds > 3 || Math.abs(b.pos.y - lv) > 0.8) { abandon(b, ctx.now()); return; }
        if (ds > 0.8 && !L.near) { L.near = true; (a.route ||= []).unshift(L); a.goal = [st[0], st[1]]; a.lv = lv; a.spd = Math.min(a.routeSpd, 4.4); a.nav = { kind: 'direct' }; return; }
      }
      a.goal = [end[0], end[1]]; a.spd = Math.min(a.routeSpd, 4.4); a.nav = { kind: 'stair', S, dir: L.dir };
    } else goLevel(b, L.x, L.y, a.routeSpd, L.lv, L.nd);
  }
  // nd = tanpa jalan memutar lewat pintu (dipakai potongan rute yang memang sudah lewat pintu)
  function goLevel(b, x, y, spd, lv, nd = false) {
    const a = b.ai, px = b.pos.x, py = -b.pos.z;
    a.spd = spd;
    a.goal = [x, y];
    a.lv = lv;
    const d = Math.hypot(x - px, y - py);
    if (d < 0.5) { a.nav = null; return; }
    if (d < 60 && nav.walkable(px, py, x, y, lv)) { a.nav = { kind: 'direct' }; return; }
    if (d < 115) {
      if (!spend()) { a.nav = { kind: 'pend' }; return; } // jatah pencarian jalur frame ini habis: coba lagi frame berikutnya
      const pts = nav.path(px, py, x, y, 9000, lv);
      if (pts) { a.nav = { kind: 'local', pts, i: 0, nc: 0 }; return; }
      if (!lv && !nd && viaDoor(b, x, y, spd)) return;
    }
    // di dalam gedung & tujuan jauh: keluar lewat pintunya dulu (dari dalam aula besar simpul jalan tidak terjangkau grid)
    if (!lv && !nd && d >= 115 && col.inBuilding(px, py) >= 0 && viaDoor(b, x, y, spd, true)) return;
    if (!lv && d > 90 && ctx.now() < a.hopUntil && hop(b, x, y, d, spd)) return;
    let p = null;
    if (!lv && d > 40) p = G.route(px, py, x, y, ctx.now(), (nx, ny) => nav.walkable(px, py, nx, ny));
    if (p && p.length > 1) { a.nav = { kind: 'road', path: p, pi: 0, nc: 0 }; roadEntry(b); }
    else if (!lv && d > 90 && hop(b, x, y, d, spd)) return; // tanpa rute jalan: bertahap lewat grid, bukan lurus menabrak gedung
    else a.nav = { kind: 'direct' };
  }
  // jaringan jalan di sekitar sini bermasalah (macet berulang di ruasnya): maju bertahap lewat grid lokal — titik antara
  // ±80 m searah tujuan (sedikit dibelokkan kalau perlu), sisa perjalanan jadi potongan rute berikutnya
  function hop(b, x, y, d, spd) {
    const a = b.ai, px = b.pos.x, py = -b.pos.z;
    for (let q = 0; q < HOP_ANG.length * 2; q++) { // 80 m dulu, lalu 40 m (di tepi kawasan / di antara gedung besar)
      if (!spend()) return false; // satu jatah per percobaan (findFree + pencarian jalur)
      const ang = HOP_ANG[q % HOP_ANG.length], k = (q < HOP_ANG.length ? 80 : 40) / d, dx = (x - px) * k, dy = (y - py) * k;
      const c = Math.cos(ang), sn = Math.sin(ang), f = col.findFree(px + dx * c - dy * sn, py + dx * sn + dy * c, 8, 0.4, true);
      if (!f) continue;
      const pts = nav.path(px, py, f[0], f[1], 9000, 0);
      if (!pts) continue;
      const rest = a.route;
      a.route = [{ x, y, lv: 0 }];
      if (rest) for (const L of rest) a.route.push(L);
      a.routeSpd = spd;
      a.goal = [f[0], f[1]]; a.lv = 0; a.spd = spd;
      a.nav = { kind: 'local', pts, i: 0, nc: 0 };
      return true;
    }
    return false;
  }
  // jalur lokal gagal (jendela A* terbatas: pintu aula besar di luar jendela) dan tujuan / bot ada di dalam gedung yang bisa
  // dimasuki → rute lewat pintu terdekat: titik 1,3 m di luar pintu → 1,3 m di dalam (atau sebaliknya) → tujuan
  // own = keluar dulu dari gedung tempat bot berada (bukan masuk ke gedung tujuan)
  function viaDoor(b, x, y, spd, own = false) {
    if (!homes) return false;
    const a = b.ai, px = b.pos.x, py = -b.pos.z, it = col.inBuilding(x, y), ib = col.inBuilding(px, py);
    const H = own ? (ib >= 0 && ib !== it && homes.get(ib)) || null : (it >= 0 && it !== ib && homes.get(it)) || (ib >= 0 && ib !== it && homes.get(ib)) || null;
    if (!H || !H.doors || !H.doors.length) return false;
    const inside = H.i === ib;
    let best = null, bd = Infinity;
    for (const dr of H.doors) { const c = Math.hypot(dr.x - px, dr.y - py) + Math.hypot(dr.x - x, dr.y - y); if (c < bd) { bd = c; best = dr; } }
    const nx = best.e.nx * 1.3, ny = best.e.ny * 1.3, s = inside ? 1 : -1; // e.n menghadap ke dalam
    const rest = a.route;
    a.route = [{ x: best.x - nx * s, y: best.y - ny * s, lv: 0, nd: true }, { x, y, lv: 0, nd: true }];
    if (rest) for (const L of rest) a.route.push(L);
    a.routeSpd = spd;
    goLevel(b, best.x + nx * s, best.y + ny * s, spd, 0, true);
    return true;
  }
  const nearSeg = (x, y, i, j, r) => { // titik (x, y) ≤ r m dari ruas jalan simpul i–j?
    const ax = G.X[i], ay = G.Y[i], dx = G.X[j] - ax, dy = G.Y[j] - ay, L = dx * dx + dy * dy, t = L > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / L, 0, 1) : 0;
    return Math.hypot(ax + dx * t - x, ay + dy * t - y) < r;
  };
  // simpul jalan pertama tidak terlihat lurus (bot di dalam rumah / di balik pagar): ke sana dulu lewat grid lokal
  function roadEntry(b) {
    const a = b.ai, N = a.nav, x = b.pos.x, y = -b.pos.z, i = N.path[N.pi], tx = G.X[i], ty = G.Y[i];
    if (Math.hypot(tx - x, ty - y) > 100 || nav.walkable(x, y, tx, ty) || !spend()) return;
    const pts = nav.path(x, y, tx, ty, 6000);
    if (pts) a.nav = { kind: 'local', pts, i: 0, nc: 0, then: N };
  }
  // macet di jalur: cari jalan memutar ke titik antara berikutnya (jalan raya: simpul berikutnya, lalu lanjut di jalan
  // raya). false = tidak ada jalan memutar → pengawas membuang tujuan ini
  function repath(b) {
    const a = b.ai, N = a.nav, x = b.pos.x, y = -b.pos.z;
    if (!a.goal || !N || N.kind === 'stair') return false;
    if (!spend()) return true; // coba lagi saat macet berikutnya
    if (N.kind === 'road') {
      const j = Math.min(N.pi + 1, N.path.length - 1), i = N.path[j];
      if (Math.hypot(G.X[i] - x, G.Y[i] - y) > 120) return false;
      const pts = nav.path(x, y, G.X[i], G.Y[i], 6000);
      if (!pts) { if (nearSeg(x, y, N.path[N.pi], i, 14)) G.markBad(N.path[N.pi], i, ctx.now() + 120); return false; }
      N.pi = j; // simpul yang bermasalah dilewati
      a.nav = { kind: 'local', pts, i: 0, nc: 0, then: N };
      return true;
    }
    const t = N.kind === 'local' ? N.pts[N.pts.length - 1] : a.goal;
    if (Math.hypot(t[0] - x, t[1] - y) > 110) return false;
    const pts = nav.path(x, y, t[0], t[1], 9000, a.lv || 0);
    if (!pts) return false;
    a.nav = { kind: 'local', pts, i: 0, nc: 0, then: N.then || null };
    return true;
  }
  // dari (x, y) terlihat lurus sampai 4 m melewati titik p ke arah titik berikutnya q? (uji sudut saat menerima titik antara)
  function aheadOk(x, y, p, q, lv) {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, k = Math.min(4, L) / L;
    return nav.walkable(x, y, p[0] + dx * k, p[1] + dy * k, lv);
  }
  function navTarget(b) { // titik yang dituju frame ini, null = sudah sampai (rute antar lantai: lanjut ke potongan berikutnya)
    let p = navStep(b);
    for (let k = 0; !p && !b.ai.nav && b.ai.route && k < 6; k++) { nextLeg(b); p = navStep(b); }
    return p;
  }
  function navStep(b) {
    const a = b.ai, N = a.nav, x = b.pos.x, y = -b.pos.z;
    if (!N || !a.goal) return null;
    if (N.kind === 'lift') { // di dalam lift: diam sampai tiba, lalu muncul di depan pintu lift tujuan
      const R = a.lift;
      if (!R) { a.nav = null; return null; }
      if (ctx.now() >= R.at) { const to = R.up ? R.L.hi : R.L.lo; b.pos.set(to.x, to.z, -to.y); b.vel.set(0, 0); b.yaw = to.yaw; a.lift = null; a.nav = null; a.anH = -99; }
      return null;
    }
    if (N.kind === 'pend') { // jalur lokal tertunda (jatah frame habis): sementara diam, hitung lagi begitu ada jatah
      if (budget > 0) { goLevel(b, a.goal[0], a.goal[1], a.spd, a.lv || 0); if (a.nav && a.nav.kind !== 'pend') return navStep(b); }
      return null;
    }
    if (N.kind === 'stair') { // ikuti sumbu tangga: kejar titik 1,2 m di depan proyeksi posisi
      const S = N.S, s = (x - S.ax) * S.ux + (y - S.ay) * S.uy;
      if (N.dir > 0 ? s > S.len + 0.75 : s < -0.75) { a.nav = null; return null; }
      const st = N.dir > 0 ? Math.min(S.len + 1.0, s + 1.2) : Math.max(-1.0, s - 1.2);
      a.wp[0] = S.ax + S.ux * st; a.wp[1] = S.ay + S.uy * st;
      return a.wp;
    }
    if (N.kind === 'road') {
      const i = N.path[N.pi], j = N.path[Math.min(N.pi + 1, N.path.length - 1)];
      const sx = G.X[j] - G.X[i], sy = G.Y[j] - G.Y[i], sl = Math.hypot(sx, sy) || 1;
      const lw = Math.max(0, G.W[i] / 2 - 0.8), lane = clamp(a.lane, -lw, lw); // lajur tetap di badan jalan (gang sempit: tengah)
      const tx = G.X[i] - sy / sl * lane, ty = G.Y[i] + sx / sl * lane, dn = Math.hypot(tx - x, ty - y);
      // simpul dianggap lewat ≤ 3 m hanya kalau ruas berikutnya terlihat lurus dari sini (tidak memotong sudut gedung):
      // diuji sampai 6 m ke arah simpul berikutnya — cukup untuk sudut, murah walau ruasnya panjang
      if (dn < 1.2 || (dn < 3 && (N.pi + 1 >= N.path.length || (N.nc++ < 4 && nav.walkable(x, y, G.X[i] + sx / sl * Math.min(6, sl), G.Y[i] + sy / sl * Math.min(6, sl)))))) {
        N.pi++; N.nc = 0;
        if (N.pi >= N.path.length) goLevel(b, a.goal[0], a.goal[1], a.spd, a.lv || 0); // ujung jaringan jalan → ke titik tujuan persis
      }
      a.wp[0] = tx; a.wp[1] = ty;
      return a.wp;
    }
    if (N.kind === 'local') {
      const last = N.i >= N.pts.length - 1, p = N.pts[Math.min(N.i, N.pts.length - 1)], d = Math.hypot(p[0] - x, p[1] - y);
      // titik antara dianggap lewat ≤ 1,1 m hanya kalau titik berikutnya terlihat lurus dari posisi sekarang — kalau tidak,
      // bot memotong sudut dan tersangkut di ujung perabot / kusen pintu
      if (last ? d < 0.6 : d < 0.45 || (d < 1.1 && N.nc++ < 4 && aheadOk(x, y, p, N.pts[N.i + 1], a.lv || 0))) {
        if (last) { a.nav = N.then || null; return N.then ? navStep(b) : null; } // jalan memutar selesai → lanjut di jalan raya
        N.i++; N.nc = 0;
      }
      return N.pts[Math.min(N.i, N.pts.length - 1)];
    }
    if (Math.hypot(a.goal[0] - x, a.goal[1] - y) < 0.6) { a.nav = null; return null; }
    return a.goal;
  }
  function roamDest(b) {
    const z = zone.next || zone.cur;
    for (let k = 0; k < 30; k++) {
      const i = Math.random() * G.N | 0, x = G.X[i], y = G.Y[i];
      if (G.comp[i] !== G.main) continue;
      const inZ = Math.hypot(x - z.x, y - z.y) < z.r * 0.8;
      const near = Math.hypot(x - b.pos.x, y + b.pos.z) < 420;
      if (inZ && (near || k > 20)) return [x, y];
    }
    return [z.x, z.y];
  }
  // ---------- Jarahan: nilai barang untuk bot, daftar lewati sementara ----------
  function skipItem(b, it, now, dur) { const a = b.ai; a.skI[a.skK] = it; a.skT[a.skK] = now + dur; a.skK = (a.skK + 1) % SKIP_N; }
  function skipped(b, it, now) { const a = b.ai; for (let k = 0; k < SKIP_N; k++) if (a.skI[k] === it && now < a.skT[k]) return true; return false; }
  const ammoFor = (b, am) => (b.weapons[0] && WEAPONS[b.weapons[0].kind].ammo === am) || (b.weapons[1] && WEAPONS[b.weapons[1].kind].ammo === am) || (b.weapons[2] && WEAPONS[b.weapons[2].kind].ammo === am);
  function weaponValue(b, k) { // senjata k berguna? (aturan sama dengan giveWeapon untuk bot: tier harus lebih tinggi)
    const W = WEAPONS[k];
    if (W.slot === 2) return b.weapons[2] && TIER[b.weapons[2].kind] >= TIER[k] ? 0 : b.weapons[0] || b.weapons[1] ? 1.5 : 9;
    if (!b.weapons[0] && !b.weapons[1]) return 14;
    if (!b.weapons[0] || !b.weapons[1]) { const h = b.weapons[0] || b.weapons[1]; return h.kind === k ? 1 : TIER[k] >= TIER[h.kind] ? 8 : 5; }
    return TIER[k] > Math.min(TIER[b.weapons[0].kind], TIER[b.weapons[1].kind]) ? 6 : 0;
  }
  function itemValue(b, it) { // 0 = tidak berguna (applyItem akan menolaknya)
    const d = it.def;
    switch (d.kind) {
      case 'weapon': return weaponValue(b, d.w);
      case 'ammo': return !ammoFor(b, d.ammo) || b.ammo[d.ammo] >= (d.ammo === 'sniper' ? 36 : d.ammo === 'shell' ? 80 : 240) ? 0 : b.ammo[d.ammo] < 60 ? 5 : 2;
      case 'vest': case 'helmet': { const cur = b[d.kind] | 0; return d.lvl > cur ? 5 + d.lvl : 0; }
      case 'heal': return d.heal === 'drink' ? 0 : b.heals[d.heal] < (d.heal === 'kit' ? 2 : 5) ? (b.hp < 70 ? 4 : 2.5) : 0;
      case 'nade': return (b.nades && (b.nades[d.nade] || 0) < (d.nade === 'frag' ? 2 : 1)) ? (d.nade === 'frag' ? 3.5 : SKILL.smoke > 0 ? 1.5 : 0) : 0;
      case 'crate': { // isi peti diketahui (terlihat saat didekati): hanya yang berguna
        const c = it.contents;
        if (!c) return 0;
        let v = 0;
        for (const k of c.weapons) v = Math.max(v, weaponValue(b, k));
        for (const am in c.ammo) if (c.ammo[am] > 0 && ammoFor(b, am) && b.ammo[am] < 120) v = Math.max(v, b.ammo[am] < 60 ? 5 : 2);
        if (c.vest > (b.vest | 0)) v = Math.max(v, 5 + c.vest);
        if (c.helmet > (b.helmet | 0)) v = Math.max(v, 5 + c.helmet);
        if ((c.heals.kit > 0 && b.heals.kit < 2) || (c.heals.band > 0 && b.heals.band < 5)) v = Math.max(v, 3);
        if (c.nades && c.nades.frag > 0 && b.nades && (b.nades.frag || 0) < 2) v = Math.max(v, 3);
        return v;
      }
      default: return 0; // tas, jeriken, aksesori: tidak dipakai bot
    }
  }
  // perlengkapan sudah cukup untuk bertarung: senjata utama berpeluru, pelindung, obat → berhenti menjarah, berangkat ke zona
  function geared(b) {
    const w = b.weapons[0] || b.weapons[1];
    if (!w) return false;
    const def = WEAPONS[w.kind];
    return b.ammo[def.ammo] + w.mag >= def.mag * 2 && (b.vest | 0) >= 1 && b.heals.band + b.heals.kit * 3 >= 3;
  }
  function setTac(b, tac, now, hold) { b.ai.tac = tac; b.ai.tacUntil = now + hold; if (tac !== 'engage') { b.crouch = false; b.prone = false; } }
  function endFight(b) {
    const a = b.ai;
    a.target = null; a.mode = 'roam'; a.tac = null; a.cover = null; a.nav = null; a.goal = null; a.route = null; a.scanUntil = 0; a.peeks = 0;
    b.crouch = false; b.prone = false;
  }
  // zona mendesak: bot sudah di dinding/di luar zona, atau dinding (menyusut sekarang / nanti setelah hitung mundur) akan
  // menyusulnya sebelum ia sempat masuk lingkaran berikutnya dengan berlari (±5,5 m/dtk lewat jalan, + cadangan 10 dtk)
  function zoneUrgent(b) {
    if (zone.mode === 'pre' || !zone.cur) return false;
    const x = b.pos.x, y = -b.pos.z, out = zone.outside(x, y);
    if (out > -8) return true;
    const zn = zone.next;
    if (!zn) return false;
    const dn = Math.hypot(x - zn.x, y - zn.y) - zn.r;
    if (dn <= 0) return false;
    const need = dn / 5.5 + 10;
    if (zone.mode === 'shrink') return -out / Math.max(1, zone.radialSpeed) < need;
    return zone.timeLeft + -out / Math.max(0.5, zone.radialSpeed) < need;
  }
  // ---------- Pengawas: tujuan tak terjangkau / macet ----------
  // abandon: tujuan saat ini dibuang — barang, kendaraan, rekan tumbang, perlindungan dilewati sementara (makin sering
  // gagal beruntun makin lama), rute dibuang, pikir ulang segera. Pemimpin yang tak terkejar: anggota jalan sendiri dulu.
  function abandon(b, now) {
    const a = b.ai, n = Math.max(1, a.wdN);
    if (a.item) { skipItem(b, a.item, now, 40 + 40 * n); if (a.item.claim === b) a.item.claim = null; a.item = null; if (a.mode === 'loot') a.mode = 'roam'; }
    if ((a.mode === 'toVeh' || a.mode === 'toRide') && a.veh) { a.vehSkip = a.veh; a.vehSkipUntil = now + 90; if (a.veh.claim === b) a.veh.claim = null; a.veh = null; a.mode = 'roam'; }
    if (a.mode === 'revive' && a.revT) { a.revSkip = a.revT; a.revSkipUntil = now + 10; dropRevive(b); a.mode = 'roam'; }
    if (a.mode === 'follow') { a.soloUntil = now + 8 + 8 * n; a.mode = 'roam'; }
    if (a.mode === 'hold') { a.mode = 'roam'; a.holdCD = now + 40; } // tempat bertahan tak tercapai
    if (a.mode === 'fight') {
      a.cover = null; a.coverCD = now + 4; a.peeks = 0;
      if (a.tac === 'hunt' || a.tac === 'flank') { if (n >= 2) endFight(b); else { a.huntFail = now; a.tac = null; } }
      else if (a.tac !== 'engage' && a.tac !== 'push') a.tac = null;
    }
    a.nav = null; a.goal = null; a.route = null;
    a.next = Math.min(a.next, 0.05);
  }
  // unstick: macet (berniat jalan tapi tidak berpindah) → abandon + mundur selangkah ke titik bebas acak yang terjangkau lurus
  function unstick(b, now) {
    const a = b.ai;
    a.wdN = now - a.wdAt < 30 ? a.wdN + 1 : 1;
    a.wdAt = now; a.stuckN = 0; a.stuckT = 0; a.anW = 0;
    // macet di jaringan jalan: ruas yang sedang dilalui ditandai buruk (semua bot menghindarinya), macet berulang → jalan bertahap
    const R = a.nav && (a.nav.kind === 'road' ? a.nav : a.nav.then);
    if (R && R.pi > 0) { const i = R.path[R.pi - 1], j = R.path[Math.min(R.pi, R.path.length - 1)]; if (nearSeg(b.pos.x, -b.pos.z, i, j, 14)) G.markBad(i, j, now + 120); } // hanya kalau bot memang sedang di ruas itu
    if (R && a.wdN >= 2) a.hopUntil = now + 30;
    abandon(b, now);
    // lepas diri: kembali ke titik bebas terakhir yang pernah diinjak (jejak, pasti terjangkau), atau titik bebas di salah satu
    // dari 16 arah (2,5 / 5 / 9 m) yang terjangkau lurus — uji longgar, karena bot yang terjepit di celah sempit antar-rumah
    // berdiri di sel yang bagi grid "terhalang"
    const x = b.pos.x, y = -b.pos.z, lv = lvOf(b), h = b.pos.y;
    let ex = null, ey = 0;
    const bd = Math.hypot(a.bcX - x, a.bcY - y);
    if (a.wdN > 1 && bd > 1.5 && bd < 25 && Math.abs(a.bcH - h) < 1 && nav.segFree(x, y, a.bcX, a.bcY, 0.22, lv)) { ex = a.bcX; ey = a.bcY; }
    const a0 = Math.random() * Math.PI * 2;
    for (let k = 0; ex === null && k < 48; k++) {
      const ang = a0 + (k % 16) * Math.PI / 8, r = k < 16 ? 2.5 : k < 32 ? 5 : 9, px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
      if (!nav.blockedAt(px, py, lv) && nav.segFree(x, y, px, py, 0.22, lv)) { ex = px; ey = py; }
    }
    if (ex !== null) { a.goal = [ex, ey]; a.lv = lv; a.nav = { kind: 'direct' }; a.spd = 4.4; a.escUntil = now + 2.5; a.route = null; }
  }
  function startHeal(b, now) {
    const a = b.ai;
    a.healKind = b.hp < 40 && b.heals.kit ? 'kit' : b.heals.band && b.hp < 75 ? 'band' : b.heals.kit ? 'kit' : null;
    if (!a.healKind) return false;
    b.healEnd = now + (a.healKind === 'kit' ? 6 : 3.5);
    b.reloadEnd = 0;
    b.prone = SKILL.crouch > 0.3 && ((GR && GR.at(b.pos.x, -b.pos.z) > 0.35) || (a.mode === 'fight' && !a.cover));
    return true;
  }

  // granat asap ke (tx, ty): menutup pandangan musuh saat mundur / memulihkan rekan (jeda 15 dtk, peluang SKILL.smoke·k)
  function smokeAt(b, tx, ty, now, k = 1) {
    const a = b.ai;
    if (!ctx.nades || !b.nades || !(b.nades.smoke > 0) || now < a.smokeAt || Math.random() > SKILL.smoke * k) return false;
    a.smokeAt = now + 15;
    const from = new THREE.Vector3(b.pos.x, b.pos.y + 1.6, b.pos.z), v = ctx.nades.lob(from, tx, ty, b.pos.y);
    b.nades.smoke--;
    ctx.nades.throwNade(b, 'smoke', from, v);
    b.pose.fire = 1;
    return true;
  }
  // menunggu zona dari dalam rumah: rumah ≤ 45 m yang pintunya di dalam zona berikutnya, berdiri ±2,4 m di dalam pintu
  // menghadap ke luar (pintu = jalan masuk musuh; jendela di sampingnya menghadap jalan). Dicoba paling sering tiap 30 dtk.
  function tryHold(b, now) {
    const a = b.ai;
    if (!homes || now < a.holdCD || zone.mode === 'shrink' || zone.mode === 'final' || !geared(b)) return false;
    a.holdCD = now + 30;
    if (Math.random() > SKILL.hold) return false;
    const x = b.pos.x, y = -b.pos.z, zn = zone.next || zone.cur, seenB = new Set();
    let best = null, bd = 45;
    col.near(x, y, 45, (c) => {
      for (const pi of c.p) {
        const bi = col.polys[pi].b;
        if (bi < 0 || seenB.has(bi)) continue;
        seenB.add(bi);
        const H = homes.get(bi), d0 = H && H.doors && H.doors[0];
        if (!d0 || !d0.e || H.holdUntil > now) continue; // satu regu per rumah
        const dd = Math.hypot(d0.x - x, d0.y - y);
        if (dd < bd && Math.hypot(d0.x - zn.x, d0.y - zn.y) < zn.r * 0.85) { bd = dd; best = H; }
      }
    });
    if (!best) return false;
    const d0 = best.doors[0], sx = d0.x + d0.e.nx * 2.4, sy = d0.y + d0.e.ny * 2.4;
    if (col.blocked(sx, sy, 0.4) || col.inBuilding(sx, sy) !== best.i) return false;
    best.holdUntil = now + 55;
    a.holdX = sx; a.holdY = sy;
    a.holdH = best; a.mode = 'hold'; a.holdEnd = now + rnd(20, 45) * b.trait.patience; a.holdYaw = Math.atan2(-d0.e.nx, d0.e.ny);
    go(b, sx, sy, 4.4);
    return true;
  }
  // ancaman terdengar dekat (≤ 70 m, 6 dtk terakhir) saat sedang tidak berbuat apa-apa: jangan berdiri di tempat terbuka —
  // ke sisi gedung yang membelakangi arah suara, jongkok sebentar
  function warnCover(b, now) {
    const a = b.ai;
    if (SKILL.wary <= 0 || now < a.warnCD) return false;
    const hp = now - a.heardAt < 6 ? a.heardPos : now - a.gunAt < 6 ? a.gunPos : null;
    if (!hp || Math.hypot(hp.x - b.pos.x, hp.z - b.pos.z) > 70) return false;
    a.warnCD = now + 12;
    if (Math.random() > SKILL.wary || !spend()) return false;
    const c = nav.cover(b.pos.x, -b.pos.z, hp.x, -hp.z, hp.y + 1.5, { R: 14, want: 30, blind: true });
    if (!c) return false;
    go(b, c.x, c.y, SKILL.sprint);
    a.coverWait = now + rnd(4, 7);
    a.scanYaw = Math.atan2(hp.x - b.pos.x, hp.z - b.pos.z); a.scanT = now + 2;
    return true;
  }

  // ---------- Pertempuran ----------
  function goCover(b, ex, ey, eh, now, opt, tac, hold) {
    if (!spend()) return false;
    const a = b.ai, c = nav.cover(b.pos.x, -b.pos.z, ex, ey, eh, opt);
    if (!c) return false;
    a.cover = c;
    a.peeks = 0;
    a.nextPeek = now + rnd(0.5, 1.4);
    setTac(b, tac, now, hold);
    go(b, c.x, c.y, SKILL.sprint);
    return true;
  }
  function flank(b, now) { // pindah ke samping posisi musuh lewat jalur yang tidak terlihat
    const a = b.ai, x = b.pos.x, y = -b.pos.z, lx = a.lastSeen.x, ly = -a.lastSeen.z;
    const dx = x - lx, dy = y - ly, d = Math.hypot(dx, dy) || 1;
    if (d > 95 || !spend()) return false;
    const side = Math.random() < 0.5 ? 1 : -1, ang = Math.atan2(dy, dx) + side * rnd(0.9, 1.5), r = clamp(d * 0.8, 14, 34);
    const f = col.findFree(lx + Math.cos(ang) * r, ly + Math.sin(ang) * r, 10, 0.4);
    if (!f) return false;
    const pts = nav.path(x, y, f[0], f[1]);
    if (!pts) return false;
    setTac(b, 'flank', now, 0);
    a.goal = f;
    a.nav = { kind: 'local', pts, i: 0, nc: 0 };
    a.spd = SKILL.sprint;
    a.cover = null;
    return true;
  }
  function hunt(b, now) {
    const a = b.ai, lx = a.lastSeen.x, ly = -a.lastSeen.z, d = Math.hypot(lx - b.pos.x, ly + b.pos.z);
    setTac(b, 'hunt', now, 0);
    a.cover = null;
    a.scanUntil = 0;
    go(b, lx, ly, d < 28 && SKILL.crouch > 0.5 ? 2.6 : d > 45 ? SKILL.sprint : 4.2, a.lastSeen.y); // jauh: lari dulu
  }
  function fightSeen(b, e, now) {
    const a = b.ai, x = b.pos.x, y = -b.pos.z, ex = e.pos.x, ey = -e.pos.z, d = Math.hypot(ex - x, ey - y);
    const fresh = a.target !== e;
    if (fresh || now - a.seenAt > 1) { // reaksi: lebih cepat kalau sudah membidik ke arah itu (mengintip)
      const pre = a.preaimFor === e && now - a.preaimAt < 8;
      a.reactAt = now + rnd(...SKILL.react) * (pre ? SKILL.preaim : 1) * (fresh ? 1 : 0.75) + (e.isPlayer ? 0 : 0.35); // antar-bot sedikit lebih lambat
      a.aimK = fresh ? SKILL.settleK : Math.max(a.aimK, SKILL.settleK * (pre ? 0.35 : 0.6));
      a.burst = 0;
    }
    if (fresh) { a.target = e; a.tac = null; a.tacUntil = 0; a.peeks = 0; }
    if (b.sq && !e.down) { b.sq.focus = e; b.sq.focusAt = now; } // sasaran dibagikan ke regu
    if (a.revT || b.reviving) dropRevive(b);
    a.seenAt = now;
    a.lastSeen.copy(e.pos);
    a.losOk = true;
    if (!b.weapons.some(Boolean)) { // tangan kosong → tinju kalau lawan sudah menempel / sama-sama tangan kosong dan dekat; selain itu kabur (lagi, kalau pelarian sebelumnya sudah selesai/gagal tapi musuh masih terlihat)
      const eArmed = !!(e.weapons && e.weapons.some(Boolean));
      const brawl = e.state === 'ground' && !e.swim && Math.abs(e.pos.y - b.pos.y) < 1.6 && (d < 3.5 || (a.tac === 'melee' && d < 7) || (!eArmed && d < 9 && b.trait.aggr > 0.3));
      if (brawl) {
        if (a.tac !== 'melee') { a.tac = 'melee'; a.cover = null; a.nextShot = Math.max(a.nextShot, now + 0.2); if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; } }
        a.mode = 'fight'; b.healEnd = 0; b.crouch = false; b.prone = false;
        return; // mengejar & memukul: lihat steer()
      }
      a.tac = null;
      if (a.mode !== 'flee' || (!a.nav && !a.route)) {
        a.mode = 'flee';
        const k = 45 / (d || 1), f = col.findFree(x + (x - ex) * k + rnd(-12, 12), y + (y - ey) * k + rnd(-12, 12), 10, 0.4) || [x + (x - ex) * k, y + (y - ey) * k];
        go(b, f[0], f[1], SKILL.sprint);
      }
      return;
    }
    if (a.tac === 'melee') a.tac = null;
    if (b.healEnd) { if (d > 35 && a.cover) return; b.healEnd = 0; }
    a.mode = 'fight';
    pickWeapon(b, d, now);
    const w = weapon(b);
    if (!w || !usable(b, w.inst)) { equipBest(b); return; }
    const eh = e.pos.y + 1.5, reserve = b.ammo[w.def.ammo];
    const inCover = a.cover && Math.hypot(a.cover.x - x, a.cover.y - y) < 1.6;
    // 1) darah tipis → mundur ke perlindungan yang menjauh, lalu obati
    // (tanpa obat pun yang sekarat mundur, kecuali lawannya juga lemah/tumbang)
    if (b.hp < 38 + 20 * (1 - b.trait.aggr) && (b.heals.kit || b.heals.band || (b.hp < 30 && !e.down && e.hp > 40)) && a.tac !== 'retreat' && Math.random() < SKILL.cover) {
      if (goCover(b, ex, ey, eh, now, { R: 30, want: 60, away: true, blind: true }, 'retreat', 6)) { smokeAt(b, b.pos.x + (ex - x) * 0.25, -b.pos.z + (ey - y) * 0.25, now, 0.5); return; }
    }
    // 2) peluru habis → isi ulang di balik perlindungan kalau dekat
    if (!b.reloadEnd && reserve > 0 && (w.inst.mag === 0 || (w.inst.mag <= w.def.mag * 0.2 && d > 15))) {
      if (a.tac !== 'cover' && Math.random() < SKILL.cover && goCover(b, ex, ey, eh, now, { R: 12, want: d, blind: true }, 'cover', 3)) return;
      b.reloadEnd = now + w.def.reload;
    }
    // sedang mengintip / sedang menjalankan taktik → lanjutkan
    if (a.tac === 'peek') {
      if ((now - a.hurtAt < 0.6 && b.hp < 75) || now > a.peekMax) { // kena saat mengintip / kelamaan terbuka → balik berlindung
        setTac(b, 'cover', now, 0);
        a.nextPeek = now + rnd(1.2, 2.6) * b.trait.patience;
        if (a.cover) go(b, a.cover.x, a.cover.y, SKILL.sprint);
        return;
      }
      a.peekUntil = Math.max(a.peekUntil, now + 0.6);
      return;
    }
    if (now < a.tacUntil && a.tac && a.tac !== 'hunt' && a.tac !== 'flank') return;
    // 3) musuh terlalu dekat / lemah / sedang isi ulang → desak
    const weak = e.hp < 45 || (e.isPlayer ? !!(ctx.playerBusy && ctx.playerBusy()) : e.reloadEnd > now || e.healEnd > now);
    const closeGun = w.inst.kind === 'shotgun' || w.inst.kind === 'smg' || w.inst.kind === 'dbs' || w.inst.kind === 'pdw';
    // lawan tumbang (tidak bisa menembak balik; perceive mendahulukan yang masih berdiri, jadi tidak ada ancaman lain yang
    // terlihat): mendekat & habisi sebelum rekannya memulihkan
    if (d < 7 || (e.down && Math.random() < SKILL.finish) || (weak && Math.random() < SKILL.push * (0.5 + b.trait.aggr)) || (closeGun && d > 9 && d < 26 && b.trait.aggr > 0.45 && Math.random() < SKILL.push * 0.6)) {
      setTac(b, 'push', now, rnd(1.6, 3));
      if (Math.abs(e.pos.y - b.pos.y) > 1.5 || !nav.walkable(x, y, ex, ey, lvOf(b))) go(b, ex, ey, SKILL.sprint, e.pos.y); else a.nav = null;
      return;
    }
    // 4) di tempat terbuka → cari perlindungan yang bisa dipakai mengintip
    if (inCover) a.coverCD = 0; // perlindungan sudah tidak aman (musuh terlihat dari sini)
    if (d > 13 && now > a.coverCD && Math.random() < SKILL.cover) {
      a.coverCD = now + rnd(2.5, 5);
      const pr = PREF[w.inst.kind] || PREF.ar;
      if (spend()) {
        const c = nav.cover(x, y, ex, ey, eh, { R: 16, want: clamp(d, pr[0] + 6, pr[1]) });
        if (c && c.px !== null && c.d < 16 && !(inCover && Math.hypot(c.x - a.cover.x, c.y - a.cover.y) < 2)) {
          a.cover = c; a.peeks = 0; a.nextPeek = now + rnd(0.6, 1.5);
          setTac(b, 'cover', now, rnd(2, 4));
          go(b, c.x, c.y, c.d < 5 ? 4.2 : SKILL.sprint);
          return;
        }
      }
    }
    // 5) baku tembak sambil bergeser
    setTac(b, 'engage', now, rnd(1, 2.2));
    a.nav = null;
  }
  function fightUnseen(b, now) { // musuh diketahui tapi tidak terlihat → true kalau ditangani
    const a = b.ai, t = a.target, x = b.pos.x, y = -b.pos.z;
    if (!t || !t.alive) { endFight(b); return false; }
    const lost = now - a.seenAt, chasing = (a.tac === 'hunt' || a.tac === 'flank') && !!a.nav;
    if (lost > (chasing ? (now - a.third < 40 ? 32 : 45) : 16 * b.trait.patience)) { endFight(b); return false; } // yang sedang memburu tidak cepat menyerah (ikut campur: maks. ±30 dtk)
    a.mode = 'fight';
    const lx = a.lastSeen.x, ly = -a.lastSeen.z, dl = Math.hypot(lx - x, ly - y);
    const w = weapon(b);
    const inCover = a.cover && Math.hypot(a.cover.x - x, a.cover.y - y) < 1.6;
    // jeda aman: isi ulang, obati
    if (w && !b.reloadEnd && !b.healEnd && w.inst.mag < w.def.mag * 0.75 && b.ammo[w.def.ammo] > 0) b.reloadEnd = now + w.def.reload;
    if (!b.healEnd && !b.reloadEnd && b.hp < 70 && (inCover || lost > 5) && (b.heals.kit || b.heals.band)) { if (startHeal(b, now)) return true; }
    if (b.healEnd) return true;
    // granat ke posisi terakhir musuh yang bersembunyi (8–30 m), jeda 12 dtk
    if (ctx.nades && b.nades && b.nades.frag > 0 && lost > 0.8 && lost < 7 && dl > 8 && dl < 30 && now > (a.nadeAt || 0) && Math.random() < 0.15 + SKILL.push * 0.35) {
      a.nadeAt = now + rnd(10, 16);
      const from = new THREE.Vector3(b.pos.x, b.pos.y + 1.6, b.pos.z), v = ctx.nades.lob(from, lx + rnd(-1.5, 1.5), ly + rnd(-1.5, 1.5), a.lastSeen.y);
      b.nades.frag--;
      ctx.nades.throwNade(b, 'frag', from, v);
      b.yaw = Math.atan2(lx - x, -(ly - y));
      b.pose.fire = 1;
      a.nextPeek = now + 2.5;
      return true;
    }
    if (a.tac === 'peek') {
      if (now > a.peekUntil) { // tidak muncul → balik berlindung, intip lagi nanti
        setTac(b, 'cover', now, 0);
        a.nextPeek = now + rnd(0.8, 2.2) * b.trait.patience;
        if (a.cover) go(b, a.cover.x, a.cover.y, 4.2);
      }
      return true;
    }
    if (a.tac === 'flank') { if (!a.nav) hunt(b, now); return true; }
    if ((a.tac === 'cover' || a.tac === 'retreat') && a.cover) {
      if (!inCover) { if (!a.nav) go(b, a.cover.x, a.cover.y, SKILL.sprint); return true; }
      if (b.reloadEnd) return true;
      if (a.peeks >= 2 + (b.trait.patience * 2 | 0) || lost > 8 * b.trait.patience) { // buntu
        if (Math.random() < SKILL.flank && flank(b, now)) return true;
        if (Math.random() < SKILL.push * b.trait.aggr) { hunt(b, now); return true; }
      }
      if (now > a.nextPeek && a.cover.px !== null && Math.random() < SKILL.peek) {
        setTac(b, 'peek', now, 0);
        a.peekUntil = now + rnd(1.3, 2.6);
        a.peekMax = now + rnd(3, 5.5);
        a.peeks++;
        a.preaimFor = t;
        a.preaimAt = now;
        a.peekCrouch = Math.random() < SKILL.crouch * 0.5;
        go(b, a.cover.px, a.cover.py, 3.8);
      } else if (a.cover.px === null && lost > 3 && a.tac !== 'retreat') hunt(b, now);
      return true;
    }
    if (lost < 2) { // baru saja hilang dari pandangan
      if (a.tac === 'push') { go(b, lx, ly, SKILL.sprint * 0.9, a.lastSeen.y); return true; }
      if (now > a.coverCD && Math.random() < SKILL.cover) { a.coverCD = now + 3; if (goCover(b, lx, ly, a.lastSeen.y + 1.5, now, { R: 14, want: dl }, 'cover', 2)) return true; }
      return true; // tahan posisi, bidik ke arah terakhir
    }
    if (a.tac !== 'hunt') { if (Math.random() < SKILL.flank && flank(b, now)) return true; hunt(b, now); return true; }
    if (!a.nav && dl < 5) { // sampai di posisi terakhir: lihat sekeliling, lalu menyerah
      if (!a.scanUntil) a.scanUntil = now + rnd(1.5, 3);
      if (now > a.scanUntil) { endFight(b); return false; }
    } else if (!a.nav) go(b, lx, ly, 4.2, a.lastSeen.y);
    return true;
  }

  // ---------- Kendaraan ----------
  function planDrive(b) {
    const a = b.ai, v = a.veh;
    if (!a.dest) a.dest = roamDest(b);
    G.setNow(ctx.now());
    a.dpath = G.astar(G.nearest(v.x, v.y), G.nearest(a.dest[0], a.dest[1])) || G.astar(G.nearest(v.x, v.y, 300, true), G.nearest(a.dest[0], a.dest[1], 300, true));
    a.dpi = 0;
    a.braking = false;
    a.dStuck = 0;
    a.dStuckN = 0;
    if (!a.dpath || a.dpath.length < 2) exitVeh(b);
  }
  function exitVeh(b) {
    const a = b.ai;
    if (a.veh && V) V.exit(a.veh, b);
    a.veh = null; a.dpath = null; a.braking = false; a.nav = null; a.goal = null;
    a.mode = 'roam';
    a.next = 0;
  }
  function thinkDrive(b, now) {
    const a = b.ai, v = a.veh;
    if (!v || !v.alive || v.driver !== b) { a.veh = null; a.mode = 'roam'; return; }
    const enemy = perceive(b, now);
    if (enemy) {
      const d = Math.hypot(enemy.pos.x - b.pos.x, enemy.pos.z - b.pos.z);
      if (d < 38 && enemy.state !== 'drive' && b.weapons.some(Boolean) && Math.random() < SKILL.push) { // turun dan lawan
        a.braking = true;
        if (Math.abs(v.speed) < 3) { exitVeh(b); fightSeen(b, enemy, now); }
        return;
      }
    }
    if (v.hp < v.def.hp * 0.22) { a.braking = true; if (Math.abs(v.speed) < 4) exitVeh(b); return; }
    a.hold = now < (a.holdUntil || 0) && matesPending(b, v); // pemimpin menunggu anggota naik (maks. 6 dtk)
    // pengawas: kendaraan tidak berpindah ≥ 4 m dalam 7 dtk (terjepit / maju-mundur di tempat) → turun, jalan kaki
    if (a.hold || Math.hypot(v.x - a.dAnX, v.y - a.dAnY) > 4) { a.dAnX = v.x; a.dAnY = v.y; a.dAnT = now; }
    else if (now - a.dAnT > 7) { a.vehSkip = v; a.vehSkipUntil = now + 60; a.braking = true; if (Math.abs(v.speed) < 3) exitVeh(b); return; }
    const L = leaderOf(b);
    if (L) { // anggota yang menyetir sendiri: mengejar pemimpin, turun begitu dekat
      const dl = Math.hypot(L.pos.x - b.pos.x, L.pos.z - b.pos.z);
      if (L.state === 'ground' && dl < 30) a.braking = true;
      else if (!a.braking && (!a.dest || Math.hypot(a.dest[0] - L.pos.x, a.dest[1] + L.pos.z) > 70)) { a.dest = [L.pos.x, -L.pos.z]; planDrive(b); return; }
    } else {
      const z = zone.next || zone.cur;
      if (a.dest && Math.hypot(a.dest[0] - z.x, a.dest[1] - z.y) > z.r * 0.85 && !a.braking) { a.dest = roamDest(b); planDrive(b); return; }
    }
    if (a.braking && Math.abs(v.speed) < 1.2) exitVeh(b);
  }
  function driveStep(b, dt, now) {
    const a = b.ai, v = a.veh, inp = a.drive;
    if (!v || !V) return;
    inp.handbrake = false; inp.boost = false;
    if (a.hold) { inp.throttle = 0; inp.steer = 0; inp.handbrake = true; V.setInput(v, inp); return; }
    if (a.braking || !a.dpath) { inp.throttle = v.speed > 0.4 ? -1 : 0; inp.steer = 0; inp.handbrake = Math.abs(v.speed) < 3; V.setInput(v, inp); return; }
    if (now < a.revUntil) { inp.throttle = -1; inp.steer = -a.revSteer; V.setInput(v, inp); return; }
    const fx = v.fx, fy = v.fy, spd = v.speed, P = a.dpath, look = 6 + Math.abs(spd) * 0.55;
    while (a.dpi < P.length - 1) { // lewati simpul yang sudah terlewat
      const nd = P[a.dpi], dx = G.X[nd] - v.x, dy = G.Y[nd] - v.y, dd = Math.hypot(dx, dy);
      if (dd < look * 0.6 || (dx * fx + dy * fy < 0 && dd < 25)) a.dpi++; else break;
    }
    const n1 = P[a.dpi], n0 = P[Math.max(0, a.dpi - 1)];
    let sx = G.X[n1] - G.X[n0], sy = G.Y[n1] - G.Y[n0];
    if (a.dpi === 0) { sx = G.X[n1] - v.x; sy = G.Y[n1] - v.y; }
    const sl = Math.hypot(sx, sy) || 1, off = clamp((G.W[n1] || 6) / 2 - 1.4, 0, 1.8);
    const tx = G.X[n1] - sy / sl * off, ty = G.Y[n1] + sx / sl * off; // lajur kiri (lalu lintas Indonesia)
    const dx = tx - v.x, dy = ty - v.y;
    const ang = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy); // + = sasaran di kiri
    // sasaran di belakang → putar balik sambil mundur (mundur + setir kanan = moncong berbelok ke kiri)
    if (Math.abs(ang) > 1.9 && Math.abs(spd) < 6) { a.revUntil = now + 1.2; a.revSteer = -Math.sign(ang); inp.throttle = -1; inp.steer = Math.sign(ang); V.setInput(v, inp); return; }
    inp.steer = clamp(-ang * 2.2, -1, 1);
    // kecepatan sasaran: pelan di tikungan
    let target = v.def.maxSpeed * 0.72 * clamp(1.15 - Math.abs(ang) * 1.1, 0.3, 1);
    let acc = 0;
    for (let k = a.dpi; k < Math.min(P.length - 2, a.dpi + 5); k++) {
      const p0 = P[k], p1 = P[k + 1], p2 = P[k + 2];
      acc += Math.hypot(G.X[p1] - G.X[p0], G.Y[p1] - G.Y[p0]);
      if (acc > 20 + Math.abs(spd) * 1.6) break;
      const ux = G.X[p1] - G.X[p0], uy = G.Y[p1] - G.Y[p0], wx = G.X[p2] - G.X[p1], wy = G.Y[p2] - G.Y[p1];
      const th = Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy));
      if (th > 0.5) target = Math.min(target, 6 + 16 * clamp(1 - th / 1.7, 0, 1));
    }
    if (a.dpi >= P.length - 1 && Math.hypot(G.X[n1] - v.x, G.Y[n1] - v.y) < 14) a.braking = true;
    if (a.dpi < 2) target = Math.min(target, 9); // keluar dari parkir pelan-pelan
    // raba halangan di depan (gedung, pohon, kendaraan lain di luar jalur) → rem, kalau sudah pelan mundur & belok
    const ahead1 = v.L / 2 + 2 + Math.max(0, spd) * 0.35, sa = -v.steerA * 0.6;
    const hx = fx * Math.cos(sa) - fy * Math.sin(sa), hy = fx * Math.sin(sa) + fy * Math.cos(sa);
    if (col.blocked(v.x + hx * ahead1, v.y + hy * ahead1, v.W * 0.42)) {
      target = Math.min(target, 2.5);
      if (Math.abs(spd) < 1.5) { a.revUntil = now + 1; a.revSteer = inp.steer || (Math.random() < 0.5 ? 1 : -1); }
    }
    // kendaraan lain di depan → rem
    const ahead = V.ahead(v, 10);
    if (ahead) target = Math.min(target, Math.max(0, ahead.speed - 1));
    inp.throttle = spd < target - 1 ? 1 : spd > target + 2.5 ? -0.7 : 0.15;
    if (now > (a.hornAt || 0) && Math.abs(spd) > 2 && V.agentAhead(v, 14)) { a.hornAt = now + rnd(4, 8); V.horn(v); } // minggir!
    // macet (menabrak sesuatu) → mundur sebentar sambil membelokkan
    if (inp.throttle > 0 && Math.abs(spd) < 0.8) {
      a.dStuck += dt;
      if (a.dStuck > 1.3) { a.dStuck = 0; a.dStuckN++; a.revUntil = now + 1.1; a.revSteer = inp.steer || 1; if (a.dStuckN > 4) a.braking = true; }
    } else a.dStuck = Math.max(0, a.dStuck - dt);
    V.setInput(v, inp);
  }
  function wantVehicle(b, dx, dy, roam, chase) { // jauh dari tujuan & ada kendaraan kosong di sekitar → naik (chase: mengejar pemimpin yang berkendara)
    if (!V || (!chase && Math.random() > SKILL.drive * (roam ? 0.5 : 1))) return false;
    const x = b.pos.x, y = -b.pos.z, far = Math.hypot(dx - x, dy - y);
    if (far < (chase ? 80 : roam ? 300 : 340)) return false;
    const v = V.freeNear(x, y, clamp(far * 0.25, 50, 160));
    if (!v || (v === b.ai.vehSkip && ctx.now() < b.ai.vehSkipUntil)) return false; // yang baru saja gagal dicapai: jalan kaki saja
    v.claim = b;
    b.ai.veh = v;
    b.ai.dest = [dx, dy];
    b.ai.mode = 'toVeh';
    b.ai.toVehUntil = ctx.now() + 25;
    const dp = V.doorPoint(v);
    go(b, dp[0], dp[1], SKILL.sprint);
    return true;
  }

  // ---------- Regu ----------
  const standing = (o) => !!o && o.alive && !o.down;
  const leaderOf = (b) => { const L = b.sq ? b.sq.leader : null; return L && L !== b && standing(L) ? L : null; };
  const FORM = [0, 2.35, -2.35, Math.PI]; // sudut slot formasi terhadap arah hadap pemimpin (belakang-kiri, belakang-kanan, belakang)
  const seatFree = (v) => { for (let i = 1; i < v.occ.length; i++) if (!v.occ[i]) return true; return false; };
  function dropRevive(b) { const a = b.ai; if (a.revT && a.revT.revBot === b) a.revT.revBot = null; a.revT = null; b.reviving = null; }
  // sasaran regu: musuh yang baru dilihat/ditembak anggota lain (atau yang melukai pemain) → ikut memburu
  function squadFocus(b, now) {
    const sq = b.sq, f = sq && sq.focus, a = b.ai;
    if (!f || now - sq.focusAt > 3 || !f.alive || f.down || f.team === b.team || a.mode === 'fight' || !b.weapons.some(Boolean)) return false;
    const d = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z);
    if (d > 140 || (a.mode === 'revive' && d > 35)) return false; // sedang menolong rekan: hanya musuh dekat yang didahulukan
    if (a.mode === 'toVeh' && a.veh) { if (a.veh.claim === b) a.veh.claim = null; a.veh = null; }
    if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
    dropRevive(b);
    a.target = f; a.lastSeen.copy(f.pos); a.seenAt = now - 1.2; a.mode = 'fight'; a.tac = null;
    fightUnseen(b, now);
    return true;
  }
  // rekan tumbang → satu bot berdiri terdekat (yang tidak sedang ditembaki) mendatangi & memulihkan.
  // m.revBot = bot yang ditugaskan; m.reviver = yang sedang memulihkan di sampingnya (bot itu, atau pemain yang menahan F)
  function reviveDuty(b, now) {
    const sq = b.sq, a = b.ai;
    // (di luar zona tidak bisa memulihkan: main.js damage() membatalkan b.reviving pada tiap kerusakan, termasuk zona)
    if (!sq || sq.aliveN === sq.standN || now - a.hurtAt < 1.5 || zone.outside(b.pos.x, -b.pos.z) > -1) { if (a.mode === 'revive') { dropRevive(b); a.mode = 'roam'; a.nav = null; a.goal = null; } return false; }
    let best = null, bd = 70;
    for (const m of sq.members) {
      if (m === b || !m.alive || !m.down || (m === a.revSkip && now < a.revSkipUntil) || zone.outside(m.pos.x, -m.pos.z) > -1) continue; // revSkip: baru saja gagal didatangi; rekan di luar zona: tak bisa dipulihkan
      const c = m.revBot, r = m.reviver;
      if ((c && c !== b && standing(c) && c.ai.revT === m) || (r && r !== b && r.reviving === m)) continue; // sudah ada yang menolong
      const d = Math.hypot(m.pos.x - b.pos.x, m.pos.z - b.pos.z) + Math.abs(m.pos.y - b.pos.y) * 2;
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) { if (a.mode === 'revive') { dropRevive(b); a.mode = 'roam'; a.nav = null; a.goal = null; } return false; }
    if (a.revT !== best) { dropRevive(b); a.revT = best; }
    best.revBot = b;
    if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
    a.mode = 'revive';
    b.healEnd = 0;
    if (bd > 1.5) { if (!a.nav || !a.goal || Math.hypot(a.goal[0] - best.pos.x, a.goal[1] + best.pos.z) > 1.2) go(b, best.pos.x, -best.pos.z, SKILL.sprint, best.pos.y); }
    else {
      a.nav = null; a.goal = null;
      // musuh regu baru terlihat: asap di antara rekan tumbang dan arah musuh sebelum berlutut
      const f = sq.focus;
      if (f && f.alive && now - sq.focusAt < 6) { const fx = f.pos.x - best.pos.x, fy = -f.pos.z + best.pos.z, fd = Math.hypot(fx, fy) || 1, k = Math.min(0.45, 9 / fd); if (fd < 80) smokeAt(b, best.pos.x + fx * k, -best.pos.z + fy * k, now); }
    }
    return true;
  }
  // ada rekan tumbang yang sedang ditolong orang lain → jangan pergi: mendekat (≤ 9 m) lalu berjaga.
  // 0 = tidak ada, 1 = sedang mendekat (sudah diberi perintah gerak), 2 = berjaga di dekatnya
  function guardDowned(b, now) {
    const sq = b.sq, a = b.ai;
    if (!sq || sq.aliveN === sq.standN) return 0;
    let best = null, bd = 80;
    for (const m of sq.members) { if (m === b || !m.alive || !m.down) continue; const d = Math.hypot(m.pos.x - b.pos.x, m.pos.z - b.pos.z); if (d < bd) { bd = d; best = m; } }
    if (!best) return 0;
    if (bd <= 9) { if (a.mode === 'follow') { a.mode = 'roam'; a.nav = null; a.goal = null; } return 2; }
    if (!a.nav || a.mode !== 'follow' || now > (a.followAt || 0)) {
      a.followAt = now + 1.2;
      if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
      a.mode = 'follow';
      go(b, best.pos.x + rnd(-3, 3), -best.pos.z + rnd(-3, 3), SKILL.sprint, best.pos.y);
    }
    return 1;
  }
  // kendaraan regu yang bisa ditumpangi: yang dinaiki pemimpin, atau yang disetir rekan lain di dekat sini
  function rideFor(b, L) {
    const x = b.pos.x, y = -b.pos.z, a = b.ai, skip = ctx.now() < a.vehSkipUntil ? a.vehSkip : null; // yang baru gagal didekati: tidak
    if (L.state === 'drive' && L.vehicle) { const v = L.vehicle; if (v !== skip && v.alive && v.driver && seatFree(v) && Math.abs(v.speed) < 9 && V.dist(v, x, y) < 60) return v; }
    for (const m of b.sq.members) {
      if (m === b || m === L || !standing(m) || m.state !== 'drive') continue;
      const v = m.vehicle;
      if (v && v !== skip && v.alive && v.driver === m && seatFree(v) && Math.abs(v.speed) < 6 && V.dist(v, x, y) < 40) return v;
    }
    return null;
  }
  // anggota (bukan pemimpin): jaga jarak dengan pemimpin dalam formasi longgar, ikut naik kendaraan regu.
  // true = sudah diberi perintah gerak (think berhenti di sini); false = cukup dekat (boleh menjarah/berobat/berjaga)
  function followThink(b, L, now) {
    const a = b.ai, x = b.pos.x, y = -b.pos.z, lx = L.pos.x, ly = -L.pos.z, d = Math.hypot(lx - x, ly - y);
    if (V && (L.state === 'drive' || d > 60)) { // pemimpin berkendara / sudah jauh: menumpang; kalau tidak ada kursi, kejar dengan kendaraan sendiri
      const v = rideFor(b, L);
      if (v) {
        if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
        a.mode = 'toRide'; a.veh = v; a.toVehUntil = now + 14; a.followAt = now + 0.7;
        const dp = V.doorPoint(v);
        go(b, dp[0], dp[1], SKILL.sprint);
        return true;
      }
      // kursi penuh / tertinggal: kejar dengan kendaraan sendiri ke tujuan pemimpin (dulu menunggu di samping mobilnya
      // sampai mobil itu pergi ≥ 90 m)
      if (L.state === 'drive' && now > (a.chaseAt || 0)) {
        a.chaseAt = now + 3;
        const ld = L.ai && L.ai.dest;
        if (wantVehicle(b, ld ? ld[0] : lx, ld ? ld[1] : ly, false, true)) return true;
      }
    }
    if (L.state !== 'ground' && L.state !== 'drive') return false; // pemimpin masih di udara
    const ls = L.state === 'drive' ? 0 : L.moveSpeed || 0; // pemimpin bergerak → rapat di belakangnya; diam → boleh agak menyebar
    if (d < (ls > 4.5 ? 6.5 : a.mode === 'loot' ? 34 : ls > 1.5 ? 6.5 : 13) && !(a.mode === 'follow' && a.nav)) return false; // pemimpin berlari: tinggalkan jarahan, ikut
    const ang = L.yaw + FORM[(b.slot || 1) % 4], r = L.state === 'drive' ? 7 : 4.6;
    let tx = lx + Math.sin(ang) * r, ty = ly - Math.cos(ang) * r;
    if (col.blocked(tx, ty, 0.4, L.state === 'ground' ? L.pos.y : 0)) { tx = lx; ty = ly; }
    const ds = Math.hypot(tx - x, ty - y);
    if (ds < 2.2) { if (a.mode === 'follow') { a.mode = 'roam'; a.nav = null; a.goal = null; a.idleT = now + 0.6; } return false; }
    // masih menuju titik di dekat slotnya → biarkan (cari jalur lagi hanya kalau slotnya sudah bergeser cukup jauh)
    if (a.mode === 'follow' && a.nav && a.goal && (now < (a.followAt || 0) || Math.hypot(a.goal[0] - tx, a.goal[1] - ty) < Math.max(4, ds * 0.3))) return true;
    a.followAt = now + 0.6;
    if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
    a.mode = 'follow';
    // kecepatan: menyamai pemimpin, sedikit lebih cepat selama tertinggal (lari ikut lari)
    const fast = d > 20 || ls > 5.3 || L.state === 'drive';
    go(b, tx, ty, fast ? Math.max(SKILL.sprint, Math.min(7.2, ls + (d > 9 ? 1.2 : 0.3))) : Math.max(4.4, Math.min(SKILL.sprint, ls + 0.6)), L.state === 'ground' ? L.pos.y : 0);
    return true;
  }
  // penumpang: tetap duduk selama ada sopir; turun kalau sopir/pemimpin turun atau kendaraan rusak. Menembak dari kursi.
  function thinkRide(b, now) {
    const a = b.ai, v = b.vehicle, L = leaderOf(b);
    if (!v || !v.alive) { a.veh = null; a.mode = 'roam'; a.next = 0; return; }
    // turun (begitu kendaraan pelan): kendaraan hampir hancur; atau pemimpin tidak di kendaraan ini dan sopirnya sudah
    // turun / pemimpin sudah berjalan kaki di dekat sini. Selama pemimpin masih di dalam (walau pindah kursi) tetap duduk.
    const slow = Math.abs(v.speed) < 4.5, leaderIn = !!L && L.vehicle === v;
    const out = v.hp < v.def.hp * 0.2 || (!leaderIn && (!v.driver || (L && L.state === 'ground' && Math.hypot(L.pos.x - b.pos.x, L.pos.z - b.pos.z) < 35)));
    if (out && slow) { V.exit(v, b); a.veh = null; a.mode = 'roam'; a.nav = null; a.goal = null; a.next = 0; return; }
    const e = b.weapons.some(Boolean) ? perceive(b, now) : null;
    if (e) {
      if (a.target !== e) { a.target = e; a.reactAt = now + rnd(...SKILL.react) + 0.3; a.aimK = SKILL.settleK; a.burst = 0; }
      a.seenAt = now; a.lastSeen.copy(e.pos); a.losOk = true;
      if (b.sq) { b.sq.focus = e; b.sq.focusAt = now; }
      pickWeapon(b, Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z), now);
    } else { a.losOk = false; if (a.target && now - a.seenAt > 4) a.target = null; }
    const w = weapon(b);
    if (w && !b.reloadEnd && w.inst.mag < (a.losOk ? 1 : w.def.mag * 0.5) && b.ammo[w.def.ammo] > 0) b.reloadEnd = now + w.def.reload;
  }
  // pemimpin bot menunggu sebentar di kendaraan sampai anggota di sekitarnya naik
  function matesPending(b, v) {
    const sq = b.sq;
    if (!sq || !seatFree(v)) return false;
    for (const m of sq.members) if (m !== b && !m.isPlayer && standing(m) && m.vehicle !== v && m.state === 'ground' && Math.hypot(m.pos.x - b.pos.x, m.pos.z - b.pos.z) < 45) return true;
    return false;
  }

  // ---------- Keputusan (4× per detik) ----------
  // ---------- Pintu rumah (col.doors): bot membuka pintu tertutup di depannya (steer), menutupnya di think ----------
  let camRef = null;
  const doorsOf = new Map(); // indeks gedung → pintu rumahnya (dibuat saat pertama diminta)
  const houseDoors = (bi) => { let L = doorsOf.get(bi); if (!L) { L = col.doors.filter((D) => D.b === bi && !D.bath); doorsOf.set(bi, L); } return L; };
  function doorSound(D, open) {
    if (!camRef) return;
    const dx = D.x - camRef.x, dz = -D.y - camRef.z, d = Math.hypot(dx, dz);
    if (d > 35) return;
    const yaw = ctx.viewYaw ? ctx.viewYaw() : 0, muffled = d > 2 && !col.los(camRef.x, -camRef.z, camRef.y, D.x - D.nx * 0.3, D.y - D.ny * 0.3, 1.4) && !col.los(camRef.x, -camRef.z, camRef.y, D.x + D.nx * 0.5, D.y + D.ny * 0.5, 1.4);
    audio.houseDoor(open, (1 - d / 35) ** 2, -Math.sin(Math.atan2(dx, dz) - yaw), muffled);
  }
  function shut(b, D, now) { if (D.open && col.setDoor(D, false, agents, now)) { doorSound(D, false); return true; } return false; }
  // Menutup pintu dengan nalar (bukan sekadar peluang):
  //  - hanya pintu dalam jangkauan tangan (DOOR_REACH), tidak pernah yang baru saja digerakkan (anti buka-tutup beruntun);
  //  - tidak mengunci rekan di seberang / rekan yang sedang berjalan ke celah (yang terakhir lewat yang menutup), dan tidak
  //    menutup pintu yang akan dilewatinya lagi atau yang sedang dipakainya menembak;
  //  - memutus garis tembak: sedang mengobati / isi ulang / kabur / baru tertembak dan ancamannya terlihat lewat celah;
  //  - bertahan / memulihkan diri di dalam rumah: pintu rumah itu yang terjangkau;
  //  - setelah lewat (pintu yang dibukanya ATAU yang sudah terbuka): peluang menurut keadaan — masuk rumah untuk menjarah
  //    lebih sering daripada keluar, kabur hampir selalu, mengejar lawan / dikejar zona tidak pernah.
  const DOOR_REACH = 3.0;
  const TUCK_R = { pistol: 0.7, revolver: 0.7 }; // jarak dinding saat senjata mulai ditarik (laras panjang 0,95 m)
  const doorMid = (D, o) => { o[0] = D.x + D.nx * D.T / 2; o[1] = D.y + D.ny * D.T / 2; return o; }, dm = [0, 0];
  const doorSideOf = (D, x, y) => Math.sign((x - D.x) * D.nx + (y - D.y) * D.ny - D.T / 2); // +1 = sisi dalam (arah n)
  function throughDoor(D, x, y, tx, ty) { // ruas (x,y) → (tx,ty) menembus celah pintu D?
    doorMid(D, dm);
    const v0 = (x - dm[0]) * D.nx + (y - dm[1]) * D.ny, v1 = (tx - dm[0]) * D.nx + (ty - dm[1]) * D.ny;
    if (v0 * v1 >= 0) return false;
    const t = v0 / (v0 - v1), u = (x + (tx - x) * t - dm[0]) * D.ux + (y + (ty - y) * t - dm[1]) * D.uy;
    return Math.abs(u) < D.w / 2 + 0.1;
  }
  function doorBusy(b, D, now, cover = false) { // alasan untuk TIDAK menutup pintu D sekarang
    if (now - D.at < 1.2) return true;
    const a = b.ai, x = b.pos.x, y = -b.pos.z, sb = doorSideOf(D, x, y);
    doorMid(D, dm);
    const mx = dm[0], my = dm[1];
    for (const o of agents) {
      if (o === b || o.team !== b.team || !o.alive || o.state !== 'ground' || Math.abs(o.pos.y - D.z) > 1.5) continue;
      const ox = o.pos.x - mx, oy = -o.pos.z - my, d = Math.hypot(ox, oy);
      if (d > 14 || d < 0.01) continue;
      const to = o.vel ? -(ox * o.vel.x + oy * o.vel.y) / d : 0; // laju rekan menuju celah
      if (d < 7 ? Math.sign(ox * D.nx + oy * D.ny) !== sb || to > 1 : to > 2.5) return true; // rekan di seberang / sedang menuju pintu ini
    }
    if (cover) return false;
    { const dx = mx - x, dy = my - y, d = Math.hypot(dx, dy); if (d > 0.01 && (b.vel.x * dx + b.vel.y * dy) / d > 0.8) return true; } // ia sendiri sedang berjalan kembali ke pintu
    if (a.goal && (a.nav || a.route) && throughDoor(D, x, y, a.goal[0], a.goal[1])) return true; // tujuannya di seberang pintu ini
    { const N = a.nav; if (N && N.kind === 'local' && N.pts) { if (N.i < N.pts.length && throughDoor(D, x, y, N.pts[N.i][0], N.pts[N.i][1])) return true; for (let i = Math.max(1, N.i), n = Math.min(N.pts.length, i + 8); i < n; i++) if (throughDoor(D, N.pts[i - 1][0], N.pts[i - 1][1], N.pts[i][0], N.pts[i][1])) return true; } } // jalurnya lewat pintu ini lagi
    if (a.mode === 'follow') { const Lf = leaderOf(b); if (Lf && Math.abs(Lf.pos.y - D.z) < 1.5 && Math.hypot(Lf.pos.x - mx, -Lf.pos.z - my) < 25 && Math.sign((Lf.pos.x - mx) * D.nx + (-Lf.pos.z - my) * D.ny) !== sb) return true; } // pemimpin yang diikutinya di seberang
    if (a.mode === 'fight' && a.target && a.losOk && throughDoor(D, x, y, a.target.pos.x, -a.target.pos.z)) return true; // sedang menembak lewat celah
    return false;
  }
  function shutChance(b, D, side, now) {
    const a = b.ai;
    if (D.bath || a.mode === 'zone' || a.mode === 'revive' || a.mode === 'toVeh' || a.mode === 'toRide' || zoneUrgent(b)) return 0;
    if (a.mode === 'flee' || (now - a.hurtAt < 5 && a.mode !== 'fight')) return Math.max(0.3, SKILL.wary);
    if (a.mode === 'fight') return 0; // mengejar / bermanuver: pintu dibiarkan
    return SKILL.wary * (side > 0 ? (a.mode === 'loot' ? 0.75 : 0.6) : 0.25); // masuk (sisi dalam) vs keluar
  }
  function doorThink(b, now) {
    const a = b.ai, x = b.pos.x, y = -b.pos.z, z = b.pos.y;
    const N = col.doorNear(x, y, z, DOOR_REACH);
    if (N && N.open) {
      const dN = Math.hypot(doorMid(N, dm)[0] - x, dm[1] - y);
      // pintu terbuka yang sedang dilewati (dibuka siapa pun): diingat sisi datangnya
      if (!N.bath && a.doorLast !== N && dN < 1.3) { a.doorLast = N; a.doorSide = doorSideOf(N, x, y); }
      if (now - (a.shutAt || -99) > 3) {
        // memutus garis tembak lewat celah
        const thr = a.target && a.target.alive ? a.target : a.hurtBy && a.hurtBy.alive && now - a.hurtAt < 4 ? a.hurtBy : null;
        const wantCover = thr && thr.team !== b.team && (!!b.healEnd || !!b.reloadEnd || a.mode === 'flee' || (now - a.hurtAt < 2.5 && b.hp < 60));
        if (wantCover && throughDoor(N, x, y, thr.pos.x, -thr.pos.z)) {
          a.shutAt = now;
          if (Math.random() < 0.35 + 0.65 * SKILL.wary && !doorBusy(b, N, now, true) && shut(b, N, now)) { if (a.doorLast === N) a.doorLast = null; return; }
        }
        // bertahan / memulihkan diri: pintu rumah tempatnya berada (kamar mandi: hanya bila ia di dalamnya)
        else if (a.mode === 'hold' || b.healEnd) {
          a.shutAt = now - 1; // dicoba lagi 2 dtk lagi
          if (N.bath ? b.healEnd && doorSideOf(N, x, y) > 0 && dN < 2.4 : col.inBuilding(x, y) === N.b) {
            for (const D of N.bath ? [N] : houseDoors(N.b)) if (D.open && Math.abs(D.z - z) < 1.2 && Math.hypot(doorMid(D, dm)[0] - x, dm[1] - y) < DOOR_REACH + 0.4 && !doorBusy(b, D, now)) shut(b, D, now);
          }
        }
      }
    }
    // baru melewati pintu (≥ 1,6 m di seberangnya): diputuskan sekali, ditutup begitu tidak ada alasan menahannya
    const L = a.doorLast;
    if (L && L.open) {
      const v = (x - L.x) * L.nx + (y - L.y) * L.ny - L.T / 2, dL = Math.hypot(L.x - x, L.y - y);
      if (dL > 8 || Math.abs(L.z - z) > 1.5) { a.doorLast = null; a.doorP = null; }
      else if (Math.abs(v) >= 1.6 && Math.sign(v) !== a.doorSide) {
        if (!a.doorP || a.doorP.D !== L) a.doorP = { D: L, yes: Math.random() < shutChance(b, L, Math.sign(v), now) };
        if (!a.doorP.yes || dL > DOOR_REACH + 1) { a.doorLast = null; a.doorP = null; }
        else if (!doorBusy(b, L, now)) { shut(b, L, now); a.doorLast = null; a.doorP = null; }
      }
    } else { a.doorLast = null; a.doorP = null; }
  }
  function think(b, now) {
    const a = b.ai;
    if (a.mode === 'drive') { thinkDrive(b, now); return; }
    if (b.state === 'ground' && !nav.blockedAt(b.pos.x, -b.pos.z, lvOf(b))) { a.bcX = b.pos.x; a.bcY = -b.pos.z; a.bcH = b.pos.y; } // jejak titik bebas
    if (a.mode === 'ride') { thinkRide(b, now); return; }
    if (col.setDoor && b.state === 'ground') doorThink(b, now);
    let enemy = perceive(b, now);
    const unarmed = !b.weapons.some(Boolean);
    // tangan kosong dan dipukul/ditembak dari jarak sangat dekat oleh yang tidak terlihat → berbalik melawan
    if (!enemy && unarmed && a.hurtBy && a.hurtBy.alive && now - a.hurtAt < 1.5 && a.hurtBy.state === 'ground' && a.hurtBy.team !== b.team && Math.hypot(a.hurtBy.pos.x - b.pos.x, a.hurtBy.pos.z - b.pos.z) < 4) enemy = a.hurtBy;
    // tangan kosong: lawan yang juga tangan kosong bukan ancaman (kecuali sudah di jarak tinju), dan lawan bersenjata yang
    // masih jauh & belum menembak dibiarkan → tetap menjarah, tidak kabur mondar-mandir
    if (enemy && unarmed) {
      const d = Math.hypot(enemy.pos.x - b.pos.x, enemy.pos.z - b.pos.z), eArmed = !!(enemy.weapons && enemy.weapons.some(Boolean));
      const brawl = d < 3.5 || (a.tac === 'melee' && d < 7) || (!eArmed && d < 9 && b.trait.aggr > 0.3);
      if (!brawl && (!eArmed || (d > 40 && now - a.hurtAt > 3))) enemy = null;
    }
    // sedang memulihkan rekan dan sudah di dekatnya: selesaikan dulu selama musuh masih jauh & tidak sedang ditembaki
    const rt = a.mode === 'revive' ? a.revT : null;
    const busy = !!rt && rt.alive && rt.down && now - a.hurtAt > 2 && Math.hypot(rt.pos.x - b.pos.x, rt.pos.z - b.pos.z) < 7 && (!enemy || Math.hypot(enemy.pos.x - b.pos.x, enemy.pos.z - b.pos.z) > 28);
    // zona mendesak (dinding sudah/hampir melewati bot): baku tembak jarak jauh ditinggalkan, lari ke zona; musuh dekat tetap dilawan
    if (enemy && !busy && !enemy.down && zoneUrgent(b) && Math.hypot(enemy.pos.x - b.pos.x, enemy.pos.z - b.pos.z) > 22) {
      if (a.mode === 'fight') endFight(b);
      a.zoneRun = now + 2.5;
    } else if (enemy && !busy) {
      if ((a.mode === 'toVeh' || a.mode === 'toRide') && a.veh) { if (a.veh.claim === b) a.veh.claim = null; a.veh = null; }
      fightSeen(b, enemy, now);
      return;
    }
    const run = now < a.zoneRun;
    a.losOk = false;
    if (now < a.escUntil && a.nav) return; // sedang melepaskan diri dari tempat macet (lihat unstick)
    if (a.mode === 'fight' && a.tac === 'melee') { // lawan tinju lepas dari pandangan: kejar sebentar ke posisi terakhirnya, lalu kembali menjarah
      if (a.target && a.target.alive && now - a.seenAt < 2) { if (!a.nav) go(b, a.lastSeen.x, -a.lastSeen.z, SKILL.sprint, a.lastSeen.y); return; }
      endFight(b); a.mode = 'loot'; a.lootEnd = now + SKILL.lootT; a.lootN = 0;
    }
    // regu: sasaran yang sedang dilihat rekan → pemburu yang kehilangan jejak memakai posisi itu (maju ke tempat yang benar)
    if (a.mode === 'fight' && a.target && now - a.seenAt > 1.5 && b.sq) {
      const f = b.sq.focus;
      if (f && f !== b && now - b.sq.focusAt < 0.8 && f.alive && !f.down && f.team !== b.team && Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) < 140) {
        const moved = Math.hypot(f.pos.x - a.lastSeen.x, f.pos.z - a.lastSeen.z);
        a.target = f; a.lastSeen.copy(f.pos);
        if (a.tac === 'hunt' && moved > 12) hunt(b, now);
      }
    }
    // jejak sudah dingin dan pemimpin sudah jauh → tinggalkan perburuan, kumpul lagi dengan regu
    if (a.mode === 'fight' && a.target && now - a.seenAt > 4 && now - a.hurtAt > 3) { const Lf = leaderOf(b); if (Lf && Lf.state !== 'plane' && Math.hypot(Lf.pos.x - b.pos.x, Lf.pos.z - b.pos.z) > 45) endFight(b); }
    if (a.mode === 'fight' && a.target && !run && now - a.seenAt > 1 && zoneUrgent(b) && Math.hypot(a.lastSeen.x - b.pos.x, a.lastSeen.z - b.pos.z) > 15) { endFight(b); a.zoneRun = now + 2.5; } // buruan di luar zona: tinggalkan
    if (a.target && (a.mode === 'fight' || a.mode === 'flee')) { if (a.mode === 'flee' ? (a.nav ? true : (endFight(b), false)) : fightUnseen(b, now)) return; }
    // ditembak dari arah yang tidak terlihat → anggap musuh di sana, cari perlindungan / hadapi
    if (!run && a.hurtBy && a.hurtBy.alive && now - a.hurtAt < 2 && b.weapons.some(Boolean) && a.mode !== 'fight') {
      if (a.mode === 'toVeh' && a.veh) { if (a.veh.claim === b) a.veh.claim = null; a.veh = null; }
      a.target = a.hurtBy; a.lastSeen.copy(a.hurtBy.pos); a.seenAt = now - 1.2; a.mode = 'fight'; a.tac = null;
      fightUnseen(b, now);
      return;
    }
    // terdengar langkah/tembakan dekat tapi tidak terlihat → menoleh ke arah suara, lalu (setelah waktu reaksi; yang
    // terampil lebih cepat) memeriksa: bidik siap/berlindung lalu mendekati posisi suara (logika musuh tak terlihat)
    if (a.mode === 'hold' && a.heardO && now - a.heardAt < 2.5) { a.scanYaw = Math.atan2(a.heardPos.x - b.pos.x, a.heardPos.z - b.pos.z); a.scanT = now + 2.5; } // yang bertahan: bidik ke arah suara, tunggu
    else if (!busy && !run && a.heardO && now - a.heardAt < 2.5 && a.heardO.alive && a.mode !== 'fight' && a.mode !== 'zone' && b.weapons.some(Boolean)) {
      if (!a.hearReact || now - a.hearReact > 6) a.hearReact = now + rnd(...SKILL.react);
      if (now >= a.hearReact) {
        if (a.mode === 'toVeh' && a.veh) { if (a.veh.claim === b) a.veh.claim = null; a.veh = null; }
        if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
        a.target = a.heardO; a.lastSeen.copy(a.heardPos); a.seenAt = now - 1.5; a.mode = 'fight'; a.tac = null;
        fightUnseen(b, now);
        return;
      }
      a.scanYaw = Math.atan2(a.heardPos.x - b.pos.x, a.heardPos.z - b.pos.z); a.scanT = now + 1.5;
    }
    // tembakan terdengar jauh (70 m – jarak dengar; pertempuran regu lain): menoleh ke arah suara. Pemimpin yang
    // perlengkapannya lengkap & darahnya cukup kadang ikut campur (third-party) kalau pertempuran itu ada di dalam zona —
    // memakai logika memburu (lari mendekat, lalu berlindung/mengintip begitu musuh terlihat); regunya ikut pemimpin.
    if (!busy && !run && a.gunO && now - a.gunAt < 2 && a.gunO.alive && a.mode !== 'fight' && b.weapons.some(Boolean)) {
      if (a.mode !== 'hold' || now > a.scanT) { a.scanYaw = Math.atan2(a.gunPos.x - b.pos.x, a.gunPos.z - b.pos.z); a.scanT = now + 2; }
      if (now > a.thirdAt && !leaderOf(b)) {
        a.thirdAt = now + rnd(18, 30);
        const zn = zone.next || zone.cur, inZ = Math.hypot(a.gunPos.x - zn.x, -a.gunPos.z - zn.y) < zn.r * 0.8;
        const calm = zone.mode === 'pre' || (zone.mode === 'wait' && zone.timeLeft > 35); // tidak saat zona menyusut / hampir menyusut
        if (inZ && calm && b.hp > 60 && geared(b) && !zoneUrgent(b) && Math.random() < SKILL.third * b.trait.aggr) {
          if ((a.mode === 'toVeh' || a.mode === 'toRide') && a.veh) { if (a.veh.claim === b) a.veh.claim = null; a.veh = null; }
          if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
          a.target = a.gunO; a.lastSeen.copy(a.gunPos); a.seenAt = now - 3; a.mode = 'fight'; a.tac = null; a.holdEnd = 0; a.third = now;
          fightUnseen(b, now);
          return;
        }
      }
    }
    if (!busy && !run && squadFocus(b, now)) return;
    if (reviveDuty(b, now)) return;
    const guard = guardDowned(b, now);
    if (guard === 1) return;
    if (a.mode === 'toVeh') {
      const v = a.veh;
      if (!v || !v.alive || v.driver || (v.claim && v.claim !== b) || now > a.toVehUntil) { if (v && now > a.toVehUntil) { a.vehSkip = v; a.vehSkipUntil = now + 90; } if (v && v.claim === b) v.claim = null; a.veh = null; a.mode = 'zone'; a.nav = null; a.goal = null; }
      else { if (!a.nav) { const dp = V.doorPoint(v); go(b, dp[0], dp[1], SKILL.sprint); } return; }
    }
    if (a.mode === 'toRide') { // berjalan ke kendaraan pemimpin
      const v = a.veh;
      if (!v || !v.alive || !seatFree(v) || !v.driver || v.driver.team !== b.team || now > a.toVehUntil || V.dist(v, b.pos.x, -b.pos.z) > 70) { a.veh = null; a.mode = 'roam'; a.nav = null; a.goal = null; }
      else { if (!a.nav || now > (a.followAt || 0)) { a.followAt = now + 0.7; const dp = V.doorPoint(v); go(b, dp[0], dp[1], SKILL.sprint); } return; }
    }
    const x = b.pos.x, y = -b.pos.z;
    if (b.healEnd) return; // sedang mengobati
    // L = pemimpin yang diikuti; null = bot ini pemimpin regunya, atau anggota yang menyelamatkan diri sendiri
    // (di luar zona, darah menipis, dan pemimpinnya juga masih di luar zona → masuk zona dengan logika pemimpin)
    let L0 = guard || now < a.soloUntil ? null : leaderOf(b); // soloUntil: pemimpin tak terkejar (lihat abandon)
    if (L0 && L0.ai && L0.ai.wdN >= 3 && now - L0.ai.wdAt < 6) { a.soloUntil = now + 20; L0 = null; } // pemimpin macet berulang: jalan sendiri dulu
    const L = L0 && zone.outside(x, y) > 0 && b.hp < 55 && zone.outside(L0.pos.x, -L0.pos.z) > 0 ? null : L0;
    if (L && followThink(b, L, now)) return;
    // zona: keluar dari zona berikutnya → bergerak masuk (yang pintar berangkat lebih awal)
    const z = zone.next || zone.cur;
    const dz = Math.hypot(x - z.x, y - z.y), outNext = dz > z.r * 0.92, outCur = zone.outside(x, y) > -5;
    // berangkat lebih awal: yang terampil (zoneEarly); yang perlengkapannya sudah lengkap / sesi jarahnya habis lebih awal lagi
    const early = SKILL.zoneEarly && zone.mode === 'wait' && outNext && zone.timeLeft < (dz - z.r) / 5 + 35 + (geared(b) || now > a.lootEnd ? SKILL.early : 0);
    const solo = !L && !(guard && zone.outside(x, y) <= 0); // anggota mengikuti pemimpin; yang menjaga rekan tumbang bertahan selama masih di dalam zona
    if (!solo) { if (a.mode === 'zone') { a.mode = 'roam'; a.nav = null; a.goal = null; } }
    else if ((outCur || (outNext && zone.mode === 'shrink') || early) && a.mode !== 'zone') {
      a.mode = 'zone';
      const d = roamDest(b);
      if (!wantVehicle(b, d[0], d[1])) go(b, d[0], d[1], dz - z.r > 120 ? SKILL.sprint : 5);
      return;
    }
    if (solo && a.mode === 'zone' && !a.nav) { if (!outCur && !outNext) a.mode = 'roam'; else { const d = roamDest(b); if (!wantVehicle(b, d[0], d[1])) go(b, d[0], d[1], SKILL.sprint); } return; }
    if (a.mode === 'zone') return;
    // bertahan di dalam rumah (tryHold): sampai waktunya habis / zona menyusut; jongkok menghadap pintu (steer)
    if (a.mode === 'hold') {
      if (now > a.holdEnd || zone.mode === 'shrink' || (a.holdH && Math.hypot(b.pos.x - a.holdX, -b.pos.z - a.holdY) > 30)) { a.mode = 'roam'; a.nav = null; a.goal = null; a.holdCD = now + 40; }
      else {
        if (!a.nav && !b.healEnd) { b.crouch = SKILL.crouch > 0.3; b.prone = false; }
        if (b.hp < 75 && now - a.hurtAt > 3 && (b.heals.kit || b.heals.band)) startHeal(b, now);
        return;
      }
    }
    // obati diri
    if (b.hp < 60 && now - a.hurtAt > 3 && (b.heals.kit || b.heals.band) && startHeal(b, now)) { a.nav = null; return; }
    // isi ulang saat aman
    const w = weapon(b);
    if (w && w.inst.mag < w.def.mag * 0.6 && b.ammo[w.def.ammo] > 0 && !b.reloadEnd) b.reloadEnd = now + w.def.reload;
    if (w && !usable(b, w.inst)) equipBest(b);
    // jarah barang di sekitar. Pemimpin: satu sesi jarah dibatasi waktu (SKILL.lootT) — sesi berikutnya dimulai sendiri
    // saat menemukan barang lagi di tempat lain; yang perlengkapannya sudah lengkap hanya mampir untuk barang bernilai tinggi.
    // Barang yang tidak berguna (aturan applyItem) atau gagal dicapai tidak dipilih lagi (daftar lewati, lihat abandon).
    // Sambil berjalan (roam) bot melirik tiap 1,5 dtk: barang yang jauh lebih baik (senjata saat tangan kosong, pelindung
    // tinggi) di dekat jalur tetap diambil.
    const peek = a.mode === 'roam' && !!a.nav && now > a.lootPeek && !L;
    if (!guard && (a.mode === 'loot' || a.mode === 'flee' || (a.mode === 'roam' && !a.nav) || peek)) {
      if (peek) a.lootPeek = now + 1.5;
      if (a.mode === 'loot' && !L && !unarmed && (now > a.lootEnd || a.lootN >= 8)) { if (a.item && a.item.claim === b) a.item.claim = null; a.item = null; a.mode = 'roam'; a.nav = null; a.goal = null; a.lootEnd = 0; } // sesi habis: hanya barang yang berharga
      {
        let best = null, bs = -1;
        const armed = b.weapons[0] || b.weapons[1], gear = geared(b), minV = peek ? 7.5 : a.mode === 'loot' ? 0 : gear ? 4.5 : now > a.lootEnd ? 2 : 0;
        loot.near(x, y, L ? 30 : unarmed ? 110 : a.mode === 'loot' ? 70 : 30, (it) => { // belum bersenjata: cari lebih jauh, sesi jarah tidak berakhir sampai dapat senjata
          if (it.z > 0.5 && !homeUp(it.x, it.y, it.z) && !roofLift(it.x, it.y, it.z)) return; // lantai kantor menara (lift pilih lantai, hanya pemain) / kanopi: tidak terjangkau bot
          if (it.claim && it.claim !== b && !(it.claim.roof && LIFTS.size)) return; // barang atap (loot.js menandainya 'atap'): bot kini bisa naik lift
          const v = itemValue(b, it);
          if (v <= minV || skipped(b, it, now)) return;
          if (L) { // dekat pemimpin saja; barang di kaki pemain — dan senjata di sekitarnya selama pemain belum bersenjata — untuk pemain
            const dl = Math.hypot(it.x - L.pos.x, it.y + L.pos.z);
            if (dl > 32 || (L.isPlayer && (dl < 3.5 || (it.def.kind === 'weapon' && dl < 14 && !L.weapons[0] && !L.weapons[1])))) return;
          }
          const dist = Math.hypot(it.x - x, it.y - y) + Math.abs(it.z - b.pos.y) * 1.5; // lantai lain: lewat tangga (sedikit lebih jauh)
          const score = v - dist / 12;
          if (score > bs) { bs = score; best = it; }
        });
        if (best) {
          if (a.mode !== 'loot' && !L) { a.lootEnd = now + (gear || peek ? 10 : SKILL.lootT); a.lootN = 0; } // sesi jarah baru
          if (best === a.item && a.mode === 'loot' && (a.nav || a.route)) return; // masih menuju barang yang sama: jalur tidak dihitung ulang
          if (a.item && a.item !== best && a.item.claim === b) a.item.claim = null;
          a.item = best; best.claim = b; a.mode = 'loot'; go(b, best.x, best.y, armed ? 4.6 : SKILL.sprint, best.z);
          return;
        }
        if (a.mode === 'loot') a.mode = 'roam';
      }
    }
    if (a.mode === 'follow' && !a.nav) a.mode = 'roam';
    if (guard) { if (!b.healEnd && !a.nav) { b.crouch = true; b.prone = false; } return; } // berjaga di dekat rekan yang tumbang
    if (a.mode === 'roam' && !a.nav) {
      if (L) { // anggota: berjaga di dekat pemimpin; rekan pemain ikut jongkok/tiarap seperti pemain
        if (L.isPlayer && !b.healEnd) { const near = Math.hypot(L.pos.x - x, -L.pos.z - y) < 14; b.prone = near && !!L.prone; b.crouch = near && !!L.crouch && !L.prone; }
        return;
      }
      if (now < a.coverWait) { if (!b.healEnd) b.crouch = SKILL.crouch > 0.3; return; } // berlindung sebentar (warnCover)
      if (now < a.idleT) return;
      if (warnCover(b, now) || tryHold(b, now)) return;
      const d = roamDest(b);
      if (!wantVehicle(b, d[0], d[1], true)) go(b, d[0], d[1], 5);
    }
  }

  // ---------- Gerak & tembak per frame ----------
  const dir = new THREE.Vector3();
  // tiarap / tumbang: badan rebah ±0,9 m searah hadap — kepala & kaki didorong keluar dinding (col.fitProne), badan ikut
  // bergeser halus. Tanpa ini hanya lingkaran 0,35 m di tengah badan yang bertabrakan: kepala menembus dinding & bisa
  // ditembak dari baliknya. r = hasil col.step/resolve (objek baru) → diubah di tempat.
  function fitBody(b, r, dt) {
    if (!col.fitProne) return r;
    const f = col.fitProne(r.x, r.y, Math.sin(b.yaw), -Math.cos(b.yaw), b.pos.y), k = Math.min(1, dt * 14);
    r.x += (f.x - r.x) * k; r.y += (f.y - r.y) * k;
    return r;
  }
  function steer(b, dt, now) {
    const a = b.ai;
    if (a.mode === 'drive') { driveStep(b, dt, now); return; }
    if (a.mode === 'ride') { rideStep(b, dt, now); return; }
    const x = b.pos.x, y = -b.pos.z;
    let tx = null, ty = null, speed = a.spd, navMove = false;
    // ambil barang begitu dekat
    if (a.mode === 'loot' && a.item && Math.abs(a.item.z - b.pos.y) < 1.2 && (Math.hypot(a.item.x - x, a.item.y - y) < 1.5 || (!a.nav && Math.hypot(a.item.x - x, a.item.y - y) < 3))) {
      if (a.item.alive) {
        const r = applyItem(b, a.item, { bot: true });
        if (r && !r.keep) loot.remove(a.item);
        else skipItem(b, a.item, now, 150); // masih ada (tidak perlu / sisa peti): jangan didatangi lagi
        if (r && r.swap) loot.add(r.swap.type, x, y, { z: b.pos.y > 0.5 ? b.pos.y : 0, hp: r.swap.hp }); // pelindung lama bot jatuh ke tanah
        if (r && r.dropped) { const up = b.pos.y > 0.5; loot.add('w_' + r.dropped.kind, x + (up ? 0 : 0.6), y + (up ? 0 : 0.6), { z: up ? b.pos.y : 0 }); }
        if (r) { a.lootN++; equipBest(b); }
      }
      a.item.claim = null;
      a.item = null;
      a.nav = null; a.goal = null;
      a.next = Math.min(a.next, 0.05);
    }
    // naik kendaraan begitu sampai di pintu
    if (a.mode === 'toVeh' && a.veh && V) {
      const dp = V.doorPoint(a.veh);
      if (Math.hypot(dp[0] - x, dp[1] - y) < 2.3 || V.dist(a.veh, x, y) < 1.2) {
        if (V.enter(a.veh, b)) { a.mode = 'drive'; a.nav = null; a.goal = null; b.crouch = false; a.holdUntil = now + 6; a.hold = false; a.dAnX = a.veh.x; a.dAnY = a.veh.y; a.dAnT = now; planDrive(b); return; }
        a.veh.claim = null; a.veh = null; a.mode = 'zone'; a.nav = null;
      }
    }
    // naik sebagai penumpang ke kendaraan pemimpin
    if (a.mode === 'toRide' && a.veh && V) {
      const v = a.veh, dp = V.doorPoint(v);
      if (Math.hypot(dp[0] - x, dp[1] - y) < 2.4 || V.dist(v, x, y) < 1.4) {
        if (Math.abs(v.speed) < 6 && V.enter(v, b)) { a.mode = 'ride'; a.nav = null; a.goal = null; b.crouch = false; b.prone = false; a.target = null; a.losOk = false; return; }
        if (!seatFree(v)) { a.veh = null; a.mode = 'roam'; a.nav = null; a.goal = null; }
      }
    }
    const fighting = a.mode === 'fight' && a.target;
    const melee = fighting && a.tac === 'melee';
    if (melee && a.losOk) { // tinju: lari lurus ke lawan sampai jarak pukul
      const t = a.target, d = Math.hypot(t.pos.x - x, -t.pos.z - y);
      a.nav = null; a.route = null; a.goal = null;
      if (d > 1.15) { tx = t.pos.x; ty = -t.pos.z; speed = SKILL.sprint; }
    } else if (fighting && a.losOk && (a.tac === 'engage' || a.tac === 'push') && !a.nav) {
      const t = a.target, dx = t.pos.x - x, dy = -t.pos.z - y, d = Math.hypot(dx, dy) || 1;
      if (now > a.strafeT) {
        a.strafe = Math.random() < SKILL.still ? 0 : Math.random() < 0.5 ? -1 : 1;
        a.strafeT = now + rnd(...SKILL.strafeT);
        b.crouch = a.tac === 'engage' && a.strafe === 0 && d > 24 && Math.random() < SKILL.crouch; // jongkok saat menembak dari jauh
        const wk = b.cur >= 0 && b.weapons[b.cur] && b.weapons[b.cur].kind;
        b.prone = b.crouch && d > 45 && (wk === 'ar' || wk === 'dmr' || wk === 'sniper' || wk === 'lmg' || wk === 'burst') && Math.random() < (GR && GR.at(x, y) > 0.35 ? 0.85 : 0.35);
        if (b.prone) b.crouch = false;
      }
      const w = b.cur >= 0 && b.weapons[b.cur], pr = (w && PREF[w.kind]) || PREF.ar;
      const want = a.tac === 'push' ? (d > 5 ? 1 : 0) : d > pr[1] ? 1 : d < pr[0] ? -1 : 0;
      const px = -dy / d, py = dx / d;
      if (a.strafe && nav.blockedAt(x + px * a.strafe * 1.4, y + py * a.strafe * 1.4, lvOf(b))) a.strafe = -a.strafe; // dinding → balik arah
      tx = x + (dx / d * want + px * a.strafe) * 4;
      ty = y + (dy / d * want + py * a.strafe) * 4;
      speed = b.prone ? 1.1 : b.crouch ? 1.6 : a.tac === 'push' ? 5.4 : 3.7;
      if (!want && !a.strafe) tx = null;
    } else {
      const p = navTarget(b);
      if (p) {
        tx = p[0]; ty = p[1]; navMove = true;
        // pengawas titik antara: jarak ke titik yang sedang dikejar tidak berkurang ≥ 1 m selama 7 dtk (berputar-putar di
        // sekitar titik yang tak tercapai, meluncur bolak-balik di dinding) → tujuan dibuang
        const N = a.nav, wi = N ? (N.kind === 'road' ? N.pi : N.kind === 'local' ? N.i : 0) : 0, dw = Math.hypot(tx - x, ty - y);
        if (N !== a.wpN || wi !== a.wpI || dw < a.wpD - 1) { a.wpN = N; a.wpI = wi; a.wpD = dw; a.wpT = now; }
        else if (N && N.kind !== 'stair' && now - a.wpT > 7) { a.wpT = now; unstick(b, now); }
      } else if (a.goal && !a.nav) { a.goal = null; if (a.mode === 'roam') a.idleT = now + rnd(1, 3.5); else a.next = Math.min(a.next, 0.05); }
      if (fighting && a.tac === 'hunt' && SKILL.crouch > 0.5) b.crouch = !!p && Math.hypot(a.lastSeen.x - x, -a.lastSeen.z - y) < 26;
      if (fighting && a.tac === 'peek') b.crouch = !!a.peekCrouch && !p;
    }
    // memulihkan rekan: sampai di sampingnya → berlutut & diam (kemajuan dihitung main.js selama b.reviving terpasang)
    if (a.mode === 'revive' && a.revT) {
      const t = a.revT;
      if (!t.alive || !t.down) { dropRevive(b); a.mode = 'roam'; a.next = 0; }
      else if (Math.hypot(t.pos.x - x, -t.pos.z - y) < 1.75 && Math.abs(t.pos.y - b.pos.y) < 1.6) {
        tx = null; a.nav = null; b.crouch = true; b.prone = false;
        if (t.reviver && t.reviver !== b && t.reviver.reviving === t) b.reviving = null; // sudah dipulihkan orang lain (pemain): tunggu di sampingnya
        else { b.reviving = t; t.reviver = b; }
      } else b.reviving = null;
    } else if (b.reviving) b.reviving = null;
    if (b.healEnd || b.state !== 'ground') tx = null;
    if (b.prone && tx !== null && speed > 1.3) b.prone = false; // harus pindah cepat → bangun dulu
    // menghindar dari kendaraan yang mengarah ke sini — hanya bila bot sadar: mobil di depannya (±70°) dan terlihat,
    // atau dari belakang/samping baru terdengar saat sudah ≤ 9 m; ada waktu reaksi, jadi bot yang lengah tetap bisa ditabrak
    if (V && SKILL.dodge && now > a.dodgeT) {
      a.dodgeT = now + 0.15;
      const th = V.threat(x, y, b);
      if (!th) a.vehNotice = 0;
      else if (now > a.dodgeUntil) {
        const dx = th.v.x - x, dy = th.v.y - y, d = Math.hypot(dx, dy) || 1;
        const seen = (dx * Math.sin(b.yaw) - dy * Math.cos(b.yaw)) / d > 0.34 && col.los(x, y, 1.5, th.v.x, th.v.y, 1.0), heard = d < 9;
        if (!seen && !heard) a.vehNotice = 0;
        else {
          if (!a.vehNotice) a.vehNotice = now + rnd(0.35, 0.8) * (2 - SKILL.dodge) * (seen ? 1 : 1.6); // waktu reaksi
          if (now >= a.vehNotice && Math.random() < SKILL.dodge * (seen ? 0.85 : 0.45)) { a.dodgeUntil = now + rnd(0.7, 1.1); a.dodgeX = th.sx; a.dodgeY = th.sy; b.crouch = false; a.vehNotice = 0; }
        }
      }
    }
    if (now < a.dodgeUntil) { tx = x + a.dodgeX * 5; ty = y + a.dodgeY * 5; speed = SKILL.sprint + 0.5; }
    let mx = 0, my = 0;
    if (tx !== null) { const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy); if (d > 0.25) { mx = dx / d * speed; my = dy / d * speed; } }
    // tabrakan & macet
    const sp = b.vel, k = 1 - Math.exp(-dt * 8);
    sp.x += (mx - sp.x) * k;
    sp.y += (my - sp.y) * k;
    const ay = b.pos.y; // tinggi kaki (lantai 2 / tangga)
    { // pintu rumah tertutup di arah gerak (jalan nav maupun bertarung/menghindar): dibuka dulu, tidak didorong
      const mv = Math.hypot(mx, my), vx = mv > 0.5 ? mx / mv : sp.x, vy = mv > 0.5 ? my / mv : sp.y, vl = Math.hypot(vx, vy);
      if (col.doorAhead && mv > 0.5 && vl > 0.1) {
        const D = col.doorAhead(x, y, ay, vx / vl, vy / vl, a.stuckT > 0.4 ? 2.0 : 1.3);
        if (D && col.setDoor(D, true, null, now, b)) { a.doorAt = now; a.doorLast = D; a.doorSide = Math.sign((x - D.x) * D.nx + (y - D.y) * D.ny - D.T / 2); doorSound(D, true); }
      }
    }
    let r = col.step(x, y, x + sp.x * dt, y + sp.y * dt, 0.35, false, ay);
    if (V) { const q2 = V.pushOut(r.x, r.y, 0.35); if (q2.x !== r.x || q2.y !== r.y) r = col.guard(r.x, r.y, col.resolve(q2.x, q2.y, 0.35, false, ay), ay, 0.35); } // tidak menembus kendaraan (dorongan yang menyeberang dinding ditolak)
    const moved = Math.hypot(r.x - x, r.y - y);
    b.moveSpeed = moved / Math.max(dt, 1e-4);
    navMove = navMove && tx !== null;
    if (Math.hypot(mx, my) > 1 && b.moveSpeed < 0.6) {
      a.stuckT += dt;
      if (a.stuckT > 1.2) {
        a.stuckT = 0;
        a.lane = rnd(-2, 2);
        // macet di jalur: jalan memutar dulu (tangga / gagal memutar / macet ke-3 → tujuan dibuang); dulu jalur dibuang tapi
        // tujuannya dipilih lagi pada pikiran berikutnya → bot mendorong tembok yang sama tanpa akhir
        if (navMove) { a.stuckN++; if (a.stuckN >= 3 || !repath(b)) unstick(b, now); }
        else if (fighting && a.tac === 'engage') a.strafe = -a.strafe;
      }
    } else { a.stuckT = Math.max(0, a.stuckT - dt); if (b.moveSpeed > 1) a.stuckN = 0; }
    if (b.prone) fitBody(b, r, dt);
    b.pos.x = r.x;
    b.pos.z = -r.y;
    // pengawas kemajuan: berniat jalan (punya jalur) tapi tidak berpindah ≥ 2,5 m selama WD_T dtk — termasuk yang
    // bergetar di sudut/meluncur di dinding (kecepatan sesaat > 0,6 sehingga deteksi macet di atas tidak pernah jalan)
    if (Math.abs(r.x - a.anX) > 2.5 || Math.abs(r.y - a.anY) > 2.5 || Math.abs(b.pos.y - a.anH) > 1.2) { a.anX = r.x; a.anY = r.y; a.anH = b.pos.y; a.anW = 0; }
    else if (navMove && (a.anW += dt) > WD_T) unstick(b, now);
    if (b.state === 'ground') { const fl = col.floorAt(r.x, r.y, ay); b.pos.y = fl >= ay - 0.45 ? fl : Math.max(fl, ay - 8 * dt); } // ikuti tangga / lantai 2, jatuh dari tepi
    // arah hadap: ke musuh (bidik), ke posisi terakhir musuh (siap tembak), atau ke arah jalan; diam = lihat sekeliling
    let face = null;
    if (b.reviving) face = Math.atan2(b.reviving.pos.x - b.pos.x, b.reviving.pos.z - b.pos.z);
    else if (fighting && a.losOk) face = Math.atan2(a.target.pos.x - b.pos.x, a.target.pos.z - b.pos.z);
    else if (fighting && !(a.tac === 'flank' && b.moveSpeed > 2) && now - a.seenAt < 20) face = Math.atan2(a.lastSeen.x - b.pos.x, a.lastSeen.z - b.pos.z);
    else if (b.moveSpeed > 0.5) face = Math.atan2(r.x - x, -(r.y - y));
    else {
      if (now > a.scanT) { a.scanT = now + rnd(1.2, 3.2); a.scanYaw = a.mode === 'hold' ? a.holdYaw + rnd(-0.8, 0.8) : b.yaw + rnd(-1.8, 1.8); }
      face = a.scanYaw;
    }
    if (face !== null) b.yaw += clamp(wrap(face - b.yaw), -dt * SKILL.turn, dt * SKILL.turn);
    b.moveYaw = b.moveSpeed > 0.3 ? wrap(Math.atan2(r.x - x, -(r.y - y)) - b.yaw) : 0;
    // isi ulang & obat selesai
    const w = weapon(b);
    if (b.reloadEnd && now >= b.reloadEnd) {
      if (w) { const need = w.def.mag - w.inst.mag, got = Math.min(need, b.ammo[w.def.ammo]); w.inst.mag += got; b.ammo[w.def.ammo] -= got; }
      b.reloadEnd = 0;
    }
    if (b.healEnd && now >= b.healEnd) {
      const kind = a.healKind;
      if (kind && b.heals[kind] > 0) { b.heals[kind]--; b.hp = kind === 'kit' ? 100 : Math.min(75, b.hp + 15); }
      b.healEnd = 0;
      if (a.tac !== 'engage') b.prone = false;
    }
    // tinju: sudah menempel & menghadap lawan → pukul (jeda antar pukulan mengikuti tingkat kesulitan)
    if (melee && !w && a.losOk && !b.healEnd && now >= a.reactAt && now >= a.nextShot) {
      const t = a.target;
      if (!t.alive) { endFight(b); return; }
      const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z;
      if (Math.hypot(dx, dz) < 1.7 && Math.abs(t.pos.y - b.pos.y) < 1.4 && Math.abs(wrap(Math.atan2(dx, dz) - b.yaw)) < 0.5) {
        eye.set(b.pos.x, b.pos.y + 1.5, b.pos.z);
        dir.set(dx, t.pos.y + (t.prone ? 0.3 : t.crouch ? 0.8 : 1.2) - eye.y, dz).normalize();
        combat.melee(b, eye, dir);
        b.pose.punch = 1;
        a.nextShot = now + rnd(0.6, 0.9) + SKILL.react[0] * 0.5;
      }
    }
    // tembak: bidikan melebar saat baru melihat target lalu mengunci
    if (fighting && a.losOk) a.aimK *= Math.exp(-dt / SKILL.settle);
    if (fighting && w && a.losOk && !b.reloadEnd && !b.healEnd && now >= a.reactAt && now >= a.switchAt && now >= a.nextShot && b.moveSpeed < 5.6) {
      const t = a.target;
      if (!t.alive) { endFight(b); return; }
      // jangan menembak ke arah yang belum dihadapi (harus berputar dulu)
      const fa = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
      if (Math.abs(wrap(fa - b.yaw)) > 0.35) return;
      shoot(b, t, w, now, false);
    }
  }
  // satu tembakan / satu butir rentetan ke sasaran t (seated: dari kursi kendaraan, bidikan lebih goyah)
  function shoot(b, t, w, now, seated) {
    const a = b.ai;
    if (w.inst.mag <= 0) { if (b.ammo[w.def.ammo] > 0) b.reloadEnd = now + w.def.reload; else equipBest(b); return; }
    if (a.burst <= 0) { a.burst = w.def.burst || (w.def.auto ? Math.round(rnd(...SKILL.burst)) : 1); a.head = t.isPlayer && Math.random() < SKILL.head; }
    eye.set(b.pos.x, seated ? (b.aimY || 1.3) + 0.12 : b.pos.y + (b.prone ? 0.42 : b.crouch ? 1.05 : 1.5), b.pos.z);
    const dist = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
    const aimY = t.state === 'drive' ? (t.aimY || 1.0) : t.swim ? 1.62 : t.prone ? 0.28 : (a.head ? 1.66 : 1.15) - (t.crouch ? 0.4 : 0); // berenang: hanya kepala
    dir.set(t.pos.x - eye.x, t.pos.y + aimY - eye.y, t.pos.z - eye.z).normalize();
    // kesulitan mengatur bidikan ke pemain; antar-bot tetap sedang supaya arena tidak habis sebelum pemain sempat bertarung
    const base = t.isPlayer ? SKILL.err : Math.max(SKILL.err, 3.0);
    const err = Math.max(0.3, base * (1 + a.aimK) * b.trait.acc + (b.moveSpeed > 1 ? SKILL.moveErr : 0) + ((t.moveSpeed || 0) > 2 ? SKILL.targetMoveErr : 0) - (b.crouch ? 0.15 : 0) + (dist < 12 ? -0.8 : 0));
    combat.fire(b, eye, dir, w, err * (seated ? 1.4 : 1));
    b.pose.fire = 1;
    a.burst--;
    a.nextShot = now + (a.burst > 0 ? 60 / w.def.rpm * rnd(1, 1.25) : Math.max(w.def.bolt || 0, w.def.burstDelay || 0, rnd(...SKILL.pause) * (w.def.auto ? 1 : 1.4))); // runduk: tunggu kokang bolt
  }
  // penumpang: isi ulang & menembak sasaran yang terlihat dari kursinya
  function rideStep(b, dt, now) {
    const a = b.ai, w = weapon(b);
    if (b.reloadEnd && now >= b.reloadEnd) {
      if (w) { const need = w.def.mag - w.inst.mag, got = Math.min(need, b.ammo[w.def.ammo]); w.inst.mag += got; b.ammo[w.def.ammo] -= got; }
      b.reloadEnd = 0;
    }
    const t = a.target;
    if (!t || !a.losOk || !w) return;
    if (!t.alive) { a.target = null; a.losOk = false; return; }
    a.aimK *= Math.exp(-dt / SKILL.settle);
    if (b.reloadEnd || now < a.reactAt || now < a.switchAt || now < a.nextShot) return;
    shoot(b, t, w, now, true);
  }
  // tumbang: merangkak pelan ke rekan berdiri terdekat (diam selama dipulihkan); tidak bisa menembak
  function downStep(b, dt, now) {
    const a = b.ai, x = b.pos.x, y = -b.pos.z;
    b.prone = true; b.crouch = false; b.reloadEnd = 0; b.healEnd = 0;
    a.next -= dt;
    if (a.next <= 0) {
      a.next = 0.7;
      let best = null, bd = 60;
      for (const m of b.sq.members) { if (m === b || !standing(m) || m.state !== 'ground') continue; const d = Math.hypot(m.pos.x - x, -m.pos.z - y); if (d < bd) { bd = d; best = m; } }
      a.crawlTo = best && bd > 2.4 ? best : null;
    }
    let mx = 0, my = 0;
    const m = a.crawlTo, held = b.reviver && b.reviver.reviving === b;
    if (m && !held) { const dx = m.pos.x - x, dy = -m.pos.z - y, d = Math.hypot(dx, dy); if (d > 2) { mx = dx / d * 0.85; my = dy / d * 0.85; } }
    const sp = b.vel, k = 1 - Math.exp(-dt * 6);
    sp.x += (mx - sp.x) * k;
    sp.y += (my - sp.y) * k;
    const r = col.step(x, y, x + sp.x * dt, y + sp.y * dt, 0.35, false, b.pos.y);
    b.moveSpeed = Math.hypot(r.x - x, r.y - y) / Math.max(dt, 1e-4);
    fitBody(b, r, dt); // rebah: kepala & kaki tidak menembus dinding
    b.pos.x = r.x; b.pos.z = -r.y;
    if (b.moveSpeed > 0.2) b.yaw += clamp(wrap(Math.atan2(r.x - x, -(r.y - y)) - b.yaw), -dt * 3, dt * 3);
    b.moveYaw = 0;
    if (zone.outside(b.pos.x, -b.pos.z) > 0) combat.damage(b, zone.def.dps * dt, 'zone', null, null);
  }

  return {
    bots, blobs, crowd,
    planJumps,
    setDifficulty(k) { Object.assign(SKILL, DIFFICULTY[k] || DIFFICULTY.easy); },
    nearestRoad(x, y) { const i = G.nearest(x, y, 6000); return i >= 0 ? [G.X[i], G.Y[i]] : null; },
    hurt(b, from, now) {
      const a = b.ai;
      a.hurtAt = now;
      a.hurtBy = from;
      if (b.healEnd && from && Math.hypot(from.pos.x - b.pos.x, from.pos.z - b.pos.z) < 40) b.healEnd = 0; // obat batal
      if (a.mode === 'fight' && from && from !== a.target && a.target && !a.losOk) { a.target = from; a.lastSeen.copy(from.pos); a.seenAt = now - 1; }
    },
    // dipanggil kendaraan saat bot keluar paksa (kendaraan hancur / pengemudi terlempar)
    ejected(b) { const a = b.ai; a.veh = null; a.dpath = null; a.braking = false; a.hold = false; a.mode = 'roam'; a.nav = null; a.goal = null; },
    // regu: bot tumbang / pulih / dipindah ke kursi penumpang (pemain mengambil kemudi)
    downed(b) {
      const a = b.ai;
      if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
      if (a.veh) { if (a.veh.claim === b) a.veh.claim = null; a.veh = null; }
      dropRevive(b);
      Object.assign(a, { mode: 'down', target: null, nav: null, goal: null, route: null, tac: null, cover: null, losOk: false, dpath: null, braking: false, hold: false, next: 0, crawlTo: null });
      b.vel.set(0, 0);
    },
    revived(b) { const a = b.ai; a.mode = 'roam'; a.next = 0; a.hurtAt = -99; a.idleT = 0; b.prone = false; b.crouch = false; },
    toPassenger(b, v) { const a = b.ai; a.mode = 'ride'; a.veh = v; a.dpath = null; a.braking = false; a.hold = false; a.target = null; a.losOk = false; },
    // dt detik, now detik, flight = { t, pos(t) }, cam = posisi kamera
    update(dt, now, flight, cam) {
      budget = 4 + Math.round(n / 20); // jatah pencarian jalur/perlindungan per frame
      camRef = cam || null;
      frameT0 = performance.now();
      for (const b of bots) {
        if (!b.alive && b.state === 'dead') {
          if (b.corpseFit !== b.goneAt) { // mayat rebah telentang (±1,8 m, kepala di belakang): sekali didorong keluar dinding (tanpa menyeberanginya)
            b.corpseFit = b.goneAt;
            const f = col.fitProne(b.pos.x, -b.pos.z, -Math.sin(b.yaw), Math.cos(b.yaw), b.pos.y);
            b.pos.x = f.x; b.pos.z = -f.y;
          }
          const a = b.ai; // lepaskan klaim barang/kendaraan milik bot yang tersingkir
          if (a.item) { if (a.item.claim === b) a.item.claim = null; a.item = null; }
          if (a.veh) { if (a.veh.claim === b) a.veh.claim = null; a.veh = null; }
          if (a.revT || b.reviving) dropRevive(b);
          continue;
        }
        if (b.state === 'plane') {
          b.airT = 0; b.chuteT = -1;
          if (b.ally && PLAYER && PLAYER.dropMode && PLAYER.dropMode !== 'lead') { // regu terjun menurut rencananya sendiri (pemain ikut, atau pemain turun sendiri)
            if (flight && flight.t >= b.ai.dropAt) { b.state = 'fall'; flight.pos(flight.t, b.pos); b.pos.y -= 4 + (b.slot || 1) * 1.5; b.ai.land = b.ai.dropLand; b.ai.own = true; }
          }
          else if (b.ally) { if (flight && PLAYER && PLAYER.state !== 'plane') { b.state = 'fall'; b.pos.copy(PLAYER.pos); b.pos.y += 3 + (b.slot || 1) * 1.5; } } // rekan: terjun bersama pemain
          else if (flight && flight.t >= b.ai.jumpAt) { b.state = 'fall'; flight.pos(flight.t, b.pos); b.pos.y -= 4; }
          continue;
        }
        if (b.state === 'fall' || b.state === 'chute') { b.airT = (b.airT || 0) + dt; b.chuteT = b.state === 'chute' ? (b.chuteT >= 0 ? b.chuteT + dt : 0) : -1; if (!(b.ally && !b.ai.own && allyAir(b, dt))) airStep(b, dt); continue; } // airT: waktu simulasi sejak terjun (pose udara)
        if (b.down) { downStep(b, dt, now); continue; }
        b.ai.next -= dt;
        if (b.ai.next <= 0) { b.ai.next = 0.25 + Math.random() * 0.1; think(b, now); }
        steer(b, dt, now);
        if (cam && b.state === 'ground') stepSound(b, dt, cam);
        const zo = zone.outside(b.pos.x, -b.pos.z);
        if (zo > 0) combat.damage(b, zone.def.dps * dt, 'zone', null, null);
      }
      if (cam) flushSteps(dt, cam);
    },
    // gambar (dipanggil setelah kendaraan bergerak supaya pengemudi pas di joknya)
    // camera (opsional): kamera perspektif frame ini → LOD, buang yang di luar layar, dan jatah pose:
    // tiap frame untuk yang dekat (< 60 m setelah zoom) & terlihat, tiap 3 frame < 150 m, tiap 6 frame di atasnya;
    // yang di luar layar (> 30 m), tersembunyi, atau sudah lama mati tidak dipose (baris matriksnya hanya digeser).
    draw(dt, now, cam, camera) {
      drawN++;
      crowd.begin(camera);
      const zoomK = camera && camera.isPerspectiveCamera ? Math.tan(camera.fov * Math.PI / 360) / 0.7 : 1;
      for (let bi = 0; bi < bots.length; bi++) {
        const b = bots[bi], driving = b.state === 'drive';
        const visible = b.state !== 'plane' && !(b.state === 'dead' && b.goneAt && now > b.goneAt) && !(driving && b.hideInVehicle);
        if (!visible) {
          if (b.drawn !== false) { b.drawn = false; b.posed = false; crowd.hide(b.i); chutes.setMatrixAt(b.i, ZERO); blobs.setMatrixAt(b.i, ZERO); b.chuteOn = false; chuteDirty = true; }
          continue;
        }
        b.drawn = true;
        const dx = b.pos.x - cam.x, dy = b.pos.y - cam.y, dz = b.pos.z - cam.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), de = d * zoomK;
        const every = de < 60 || (driving && de < 300) ? 1 : de < 150 ? 3 : 6;
        b.ai.poseT += dt;
        if (!b.alive) b.deadT = (b.deadT || 0) + dt; else b.deadT = 0;
        const sc = b.look ? b.look.scale : 1;
        const rx = b.pos.x, rz = b.pos.z, ry = driving ? (b.sitY || 0) + 0.93 * (1 - sc) : b.pos.y; // duduk: pinggul tetap di jok walau badan diskala
        const inF = d < 4 || crowd.inView(rx, ry, rz);
        const posed = !b.posed || ((inF || d < 30) && b.deadT < 3 && (drawN + b.i) % every === 0);
        if (posed) {
          const pdt = Math.min(b.ai.poseT, 0.25);
          b.ai.poseT = 0;
          b.posed = true;
          const p = b.pose;
          p.speed = b.state === 'ground' ? b.moveSpeed || 0 : 0;
          p.moveYaw = b.moveYaw || 0;
          const riderAim = driving && b.ai.mode === 'ride' && b.ai.losOk && !!b.ai.target; // penumpang menembak dari kursi
          p.armed = (!driving || riderAim) && !b.down && b.cur >= 0 && !!b.weapons[b.cur];
          p.aim = (b.ai.mode === 'fight' && b.ai.losOk) || riderAim;
          p.twist = riderAim ? clamp(wrap(Math.atan2(b.ai.target.pos.x - b.pos.x, b.ai.target.pos.z - b.pos.z) - b.yaw), -2.6, 2.6) : 0;
          p.pass = driving && b.ai.mode === 'ride';
          p.guard = !driving && !b.down && b.alive && ((b.ai.mode === 'fight' && b.ai.tac === 'melee') || now - (b.lastPunch ?? -99) < 3);
          p.pitch = 0;
          p.dead = !b.alive;
          p.freefall = b.state === 'fall';
          p.chute = b.state === 'chute';
          p.air = false;
          if (p.freefall || p.chute) { // masukan pose udara (map/rigair.js); rekan formasi meniru gaya pemain
            const own = !(b.ally && !b.ai.own && PLAYER && (PLAYER.state === 'fall' || PLAYER.state === 'chute')), PP = PLAYER && PLAYER.pose;
            const seed = ((b.i * 0.6180339) % 1 + 1) % 1, at = b.airT || 0;
            p.airT = at; p.chuteT = b.chuteT; p.airSeed = seed; p.airSide = own ? 0 : PP.airSide || 0;
            p.airFwd = own ? (p.chute ? (b.pos.y < 12 ? -1 : (b.airD || 0) > 25 ? 1 : 0) : (b.airD || 0) > 40 ? 0.35 : 0) : PP.airFwd || 0;
            p.airDive = own ? (seed > 0.7 && b.pos.y > 350 ? 0.4 : 0) : PP.airDive || 0;
            const dy = b.pyaw == null || at < 0.3 || pdt <= 0 ? 0 : -wrap(b.yaw - b.pyaw) / pdt;
            p.airTurn = clamp(dy, -3, 3);
            p.airSpd = p.chute ? 12 : 52;
            p.lookYaw = own || !PLAYER ? 0 : wrap(Math.atan2(PLAYER.pos.x - b.pos.x, PLAYER.pos.z - b.pos.z) - b.yaw);
            b.pyaw = b.yaw;
            p.landT = -1;
          } else {
            b.pyaw = null;
            const lt = b.landAt != null && b.state === 'ground' ? now - b.landAt : -1;
            p.landT = lt >= 0 && lt < (b.landKind ? 0.7 : 0.55) ? lt : -1; p.landKind = b.landKind | 0;
          }
          p.prone = !driving && !!b.prone && b.alive;
          p.crouch = !driving && !p.prone && (b.crouch || !!b.healEnd || !!b.reviving);
          { const w0 = b.cur >= 0 && b.weapons[b.cur]; p.reload = b.reloadEnd && w0 ? 1 - (b.reloadEnd - now) / WEAPONS[w0.kind].reload : null; }
          p.heal = (!!b.healEnd || !!b.reviving) && b.alive;
          p.healKind = b.healEnd ? b.ai.healKind : null; // pose per jenis obat (rig.js): perban / P3K
          p.gunKind = b.cur >= 0 && b.weapons[b.cur] ? b.weapons[b.cur].kind : null;
          // menempel dinding: sinar pendek dari dada searah hadap → senjata ditarik (rig.js TUCK); hanya bot dekat kamera
          p.tuck = p.armed && d < 60 && b.state === 'ground' && !p.prone ? clamp((TUCK_R[p.gunKind] || 0.95) - col.ray(rx, -rz, ry + (p.crouch ? 0.85 : 1.25), Math.sin(b.yaw), -Math.cos(b.yaw), 0, 1), 0, 0.4) / 0.4 : 0;
          p.sit = driving ? (b.sitKind || 'car') : null;
          p.recline = driving ? (b.sitRecline || 0) : 0;
          p.steer = driving && b.ai.veh ? b.ai.veh.steerN || 0 : 0;
          b.rig.root.position.set(rx, ry, rz);
          b.rig.root.rotation.set(0, b.yaw, driving ? b.sitRoll || 0 : 0);
          b.rig.pose(p, pdt);
        }
        const w = b.cur >= 0 && b.weapons[b.cur];
        crowd.put(b.i, b.rig, rx, ry, rz, d, posed, inF, w && b.alive && !b.down && (!driving || (b.ai.mode === 'ride' && b.ai.losOk)) ? w.kind : null, b.helmet, b.vest, true, b.longHair);
        if (b.state === 'chute' && chuteShape(b.chuteT >= 0 ? b.chuteT : 5, 11, 9, chO).vis) { // kanopi mengembang (game/chutefx.js), miring ikut ayunan badan
          const A = b.rig.A;
          chutes.setMatrixAt(b.i, m4.compose(pv.set(b.pos.x, b.pos.y + chuteY, b.pos.z), q.setFromEuler(chE.set(chO.rx + (A ? 0.10 * A.cfw - 0.16 * A.cbr : 0), b.yaw, A ? 0.30 * A.bank : 0, 'YXZ')), sv.set(chO.sx, chO.sy, chO.sz)));
          b.chuteOn = true; chuteDirty = true;
        } else if (b.landChute && b.state === 'ground' && chuteCollapse(now - b.landAt, chO)) { // kanopi kempis setelah mendarat
          chutes.setMatrixAt(b.i, m4.compose(pv.set(b.pos.x, b.pos.y + chuteY, b.pos.z), q.setFromEuler(chE.set(chO.rx, b.yaw, 0, 'YXZ')), sv.set(chO.sx, chO.sy, chO.sz)));
          b.chuteOn = true; chuteDirty = true;
        } else if (b.chuteOn) { chutes.setMatrixAt(b.i, ZERO); b.chuteOn = false; b.landChute = false; chuteDirty = true; }
        if (blobs.visible) { // bayangan bulat (hanya tampilan non-realistis)
          if (b.state === 'ground' || b.state === 'dead') blobs.setMatrixAt(b.i, m4.compose(pv.set(b.pos.x, 0.17, b.pos.z), q.identity(), sv.set(1, 1, 1)));
          else blobs.setMatrixAt(b.i, ZERO);
        }
      }
      crowd.flush();
      if (chuteDirty) { chutes.instanceMatrix.needsUpdate = true; chuteDirty = false; }
      if (blobs.visible) blobs.instanceMatrix.needsUpdate = true;
    },
  };
}
