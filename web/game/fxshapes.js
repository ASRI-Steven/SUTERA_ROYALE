// Atlas bentuk & palet untuk efek skin berbentuk (game/shapefx.js). Semua digambar di peramban (Canvas 2D), tanpa unduhan.
// Satu tekstur RGBA8: R = jarak bertanda ke siluet (0,5 = tepi, > 0,5 di dalam) · G = detail (garis barb/urat: menggelapkan) ·
// B = koordinat ramp palet 0..1 · A = topeng emisi. Bentuk yang sama diwarnai ulang lewat baris palet (tPal: baris 2k =
// albedo, 2k+1 = emisi). Sel dibangun satu per satu (build / buildSome) supaya lobi tidak tersendat; penggambar yang gagal →
// cakram polos + satu peringatan.
// createFxAtlas() → { tex, pal, palRows, cell(nama) → indeks, rect(indeks, out4), pal(nama) → baris, buildSome(ms), buildAll(), ready }
import * as THREE from 'three';

const AW = 2048, AH = 1024, SPREAD = 12, PAL_W = 64;
// nama: [lebar, tinggi] sel. Kartu berdiri: pangkal di bawah sel, ujung di atas.
const CELLS = {
  bulu_merak: [256, 512], bulu_kecil: [128, 256], mata_merak: [256, 256], serat: [64, 256], cincin: [256, 256], garis: [64, 256], kilau4: [128, 128], pilar: [64, 256],
  // M2 (10 tema lain)
  bulu_elang: [128, 256], lidah_api: [128, 256], cabang: [128, 256], serpih_es: [128, 256], kristal: [128, 256], sulur: [128, 256], kilat: [128, 256],
  benang: [64, 256], pamor: [64, 256], retak: [256, 256], segi6: [256, 256], embun: [256, 256], kisi: [256, 256], bingkai: [256, 256], cincin2: [256, 256],
  tetes: [128, 128], asap: [128, 128], serpih: [128, 128], chevron: [128, 128], pelat: [128, 128], salju: [128, 128], glif: [128, 128], bintang8: [128, 128],
  ketupat: [128, 128], kelopak: [128, 128], mendak: [128, 128], segitiga: [128, 128], prisma: [128, 128], kerang: [128, 128], gelembung: [128, 128], butir: [128, 128],
  awan: [256, 128], ombak: [256, 128],
};
// palet: [ramp albedo, ramp emisi] (hex, merata 0..1)
const PALETTES = {
  // inti mata nila → biru → toska → emas → perunggu zaitun → hijau barb gelap → hijau barb terang
  merak: [['#050b2e', '#123c9c', '#0d8f86', '#b98a24', '#7c8a2a', '#1f4d1c', '#2a7a3c', '#176a58', '#3c8a34'], ['#0a1c66', '#2a6bff', '#19c9a8', '#a87c20', '#2a3408', '#04200c', '#083a1c', '#0a4a40', '#083a1c']],
  emas: [['#fff4c8', '#ffd56a', '#e2a93b', '#a8721c'], ['#fff1c0', '#ffc64a', '#d08a1a', '#5a3000']],
  // M2. Koordinat ramp 0 = paling terang/inti, 1 = paling gelap/pangkal (kecuali spektrum: pelangi).
  garuda: [['#fff6d0', '#ffd56a', '#e2a93b', '#b3761c', '#7a1616'], ['#fff1c0', '#ffc64a', '#b8741a', '#4a2400', '#3a0606']],
  magma: [['#fff3b0', '#ffb030', '#ff4a08', '#8a1404', '#1a0d0a', '#0a0808'], ['#fff0a0', '#ffa020', '#ff3a00', '#6a0c00', '#120300', '#000000']],
  abu: [['#8a847c', '#5e5852', '#3a3632', '#26221f'], ['#1a0a04', '#0a0402', '#000000', '#000000']],
  plasma: [['#f2feff', '#8feaff', '#1fb8ff', '#0a5a9a', '#e8ecf0'], ['#b8f4ff', '#28c0ff', '#0c84e8', '#063a70', '#182028']],
  es: [['#ffffff', '#d8f4ff', '#8fd8ff', '#4aa8e0', '#2a6aa8'], ['#e8f8ff', '#9fe0ff', '#3a9ae0', '#124a80', '#061830']],
  neon: [['#f6e4ff', '#d07cff', '#a23dff', '#5a14b0', '#22e6ff'], ['#d8a0ff', '#9a38ff', '#6a14e8', '#3a0890', '#18b8e0']],
  songket: [['#fff1c0', '#f2c25a', '#d8962a', '#9a1830', '#5a0c1c'], ['#fff1c0', '#f2a83a', '#a86a10', '#3a0610', '#200408']],
  keris: [['#eafff8', '#7fe8d0', '#2fd3b0', '#157a68', '#d6a446', '#20242a'], ['#d8fff4', '#4fe0c0', '#13b894', '#0a4a40', '#8a6420', '#000000']],
  petir: [['#ffffff', '#e0dcff', '#9d90ff', '#5a48e0', '#4a4a6e', '#2c2c44'], ['#ffffff', '#d8d0ff', '#8f80ff', '#4030c0', '#0c0c1c', '#000000']],
  holoC: [['#58e4ff', '#20c4f8', '#18a8e0'], ['#40d8ff', '#18b4f0', '#1090d0']],
  holoM: [['#ff6ad8', '#f040c0', '#d030a0'], ['#ff5ad0', '#e030b0', '#b82090']],
  holoY: [['#ffe040', '#f8c820', '#e0a818'], ['#ffd840', '#f0b818', '#c89010']],
  spektrum: [['#ff5a7a', '#ffb040', '#f8f060', '#50e890', '#40c8ff', '#8a70ff', '#ff6ad2'], ['#ff4a6a', '#ffa030', '#f0e850', '#40e080', '#30b8ff', '#7a60ff', '#ff5ac8']],
  mutiara: [['#ffffff', '#fde8f0', '#f7c6d8', '#bff0ec', '#d9b0e8', '#e8a890'], ['#fff8fc', '#f8d0e0', '#c890a8', '#70b0a8', '#806090', '#604030']],
  laut: [['#ffffff', '#d8fbf6', '#7fe0d8', '#2aa8c0', '#106a98', '#0a3a66'], ['#f0fffc', '#8ff0e6', '#2fc0c8', '#0a6a90', '#04304a', '#02182a']], // ombak Mutiara Laut: buih → toska → biru laut
};

// ---------- jarak Euclid kuadrat (Felzenszwalb & Huttenlocher), per baris lalu per kolom ----------
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s;
    do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
}
function edt(mask, w, h, inside) { // → Float32Array jarak (px) ke piksel terdekat yang (inside ? di luar : di dalam) siluet
  const g = new Float32Array(w * h), n = Math.max(w, h), f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  for (let i = 0; i < w * h; i++) g[i] = (mask[i] ? inside : !inside) ? 1e20 : 0;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}

// ---------- penggambar ----------
// tiap penggambar menerima K = { s, g, b, a } (konteks 2D: siluet, detail, ramp, emisi), lebar w, tinggi h (px sel).
// Kanvas s: putih = di dalam siluet. g: mulai putih (tanpa penggelapan). b: abu = koordinat ramp. a: mulai hitam (tanpa emisi).
const gray = (v) => { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})`; };
let SEED = 1;
const rnd = () => { SEED = (SEED * 1664525 + 1013904223) >>> 0; return SEED / 4294967296; };
const fillAll = (ctx, v, w, h) => { ctx.fillStyle = gray(v); ctx.fillRect(0, 0, w, h); };
const vgrad = (ctx, w, h, stops) => { const g = ctx.createLinearGradient(0, 0, 0, h); for (const [t, v] of stops) g.addColorStop(t, gray(v)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }; // atas → bawah
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
const cut = (ctx, fn, lw) => { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = lw; fn(); ctx.restore(); };
// mata bulu merak di (cx, cy), setengah-sumbu (rx, ry): cincin perunggu → emas → toska → biru → inti nila berbentuk ginjal
function peacockEye(K, cx, cy, rx, ry, emis = 1) {
  const ring = (ctx, kx, ky, dy, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx, cy + dy * ry, rx * kx, ry * ky, 0, 0, Math.PI * 2); ctx.fill(); };
  for (const [kx, ky, dy, b, e] of [[1, 1, 0, 0.6, 0.0], [0.86, 0.88, 0.02, 0.44, 0.35], [0.7, 0.72, 0.05, 0.3, 0.9], [0.52, 0.5, 0.1, 0.16, 1.0]]) {
    ring(K.b, kx, ky, dy, gray(b)); ring(K.a, kx, ky, dy, gray(e * emis));
  }
  // inti nila: ginjal (elips dengan lekuk di bawah)
  for (const ctx of [K.b, K.a]) {
    ctx.fillStyle = ctx === K.b ? gray(0.02) : gray(0.55 * emis);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.12 * ry, rx * 0.34, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ctx === K.b ? gray(0.16) : gray(1.0 * emis);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.42 * ry, rx * 0.2, ry * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  }
  // garis halus memancar di cincin (detail)
  K.g.strokeStyle = gray(0.55); K.g.lineWidth = Math.max(1, rx * 0.02);
  for (let i = 0; i < 44; i++) { const a = i / 44 * Math.PI * 2; K.g.beginPath(); K.g.moveTo(cx + Math.cos(a) * rx * 0.55, cy + Math.sin(a) * ry * 0.55); K.g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); K.g.stroke(); }
}
// barb: goresan melengkung dari tangkai (x0, y0) ke luar-atas; digambar di siluet + ramp (hijau) + detail
function barb(K, x0, y0, dx, dy, lw, bcol, curl = 0.35) {
  const x1 = x0 + dx, y1 = y0 + dy, mx = x0 + dx * 0.55, my = y0 + dy * (0.5 - curl);
  for (const [ctx, col, k] of [[K.s, '#fff', 1], [K.b, gray(bcol), 1.9], [K.g, gray(0.62 + 0.3 * rnd()), 0.55]]) {
    ctx.strokeStyle = col; ctx.lineWidth = lw * k; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
  }
}
const DRAW = {
  // bulu merak panjang: tangkai tipis berbarb jarang di bawah, bendera berbarb rapat mengelilingi mata di atas
  bulu_merak(K, w, h) {
    SEED = 7;
    const cx = w / 2, m = SPREAD + 2, top = m, bot = h - m, H = bot - top;
    const ey = top + H * 0.2, erx = w * 0.225, ery = H * 0.128, lim = w / 2 - m - 2; // pusat & ukuran mata
    K.b.fillStyle = gray(0.78); K.b.fillRect(0, 0, w, h);
    // barb: dari tangkai, makin ke atas makin panjang & rapat; di sekitar mata memancar keluar
    const N = 74;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), y0 = bot - H * (0.1 + 0.83 * Math.pow(u, 0.86)), near = Math.max(0, 1 - Math.abs(y0 - ey) / (H * 0.3));
      const len = Math.min(lim, w * (0.1 + 0.19 * Math.pow(u, 0.7) + 0.13 * near) * (0.86 + 0.28 * rnd()));
      for (const sgn of [-1, 1]) {
        if (u < 0.3 && rnd() < 0.42) continue; // bagian bawah: barb jarang (renggang seperti bulu ekor asli)
        barb(K, cx, y0, sgn * len, -Math.min(len * (0.6 + 0.75 * u), y0 - top), 1.7 + 1.5 * u, 0.66 + 0.34 * rnd());
      }
    }
    // pucuk: beberapa barb memancar ke atas
    for (let i = 0; i < 13; i++) { const a = -Math.PI / 2 + (i - 6) * 0.19, L = Math.min(ey - ery * 0.5 - top, H * (0.12 + 0.04 * rnd())) ; barb(K, cx, ey - ery * 0.5, Math.cos(a) * L * 1.1, Math.sin(a) * L, 2.8, 0.68 + 0.3 * rnd(), 0.1); }
    // tangkai
    for (const [ctx, col, lw] of [[K.s, '#fff', 4.2], [K.b, gray(0.62), 3], [K.g, gray(0.85), 2]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, bot); ctx.lineTo(cx, ey); ctx.stroke(); }
    // mata (padat di siluet)
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.ellipse(cx, ey, erx * 1.04, ery * 1.04, 0, 0, Math.PI * 2); K.s.fill();
    peacockEye(K, cx, ey, erx, ery);
  },
  // bulu kecil: bendera daun utuh bertakik + mata kecil di ujung
  bulu_kecil(K, w, h) {
    SEED = 11;
    const cx = w / 2, m = SPREAD + 2, top = m, bot = h - m, H = bot - top, hw = w * 0.3;
    const vane = (ctx) => { ctx.beginPath(); ctx.moveTo(cx, bot - H * 0.2); ctx.bezierCurveTo(cx - hw * 1.25, bot - H * 0.45, cx - hw * 1.1, top + H * 0.12, cx, top); ctx.bezierCurveTo(cx + hw * 1.1, top + H * 0.12, cx + hw * 1.25, bot - H * 0.45, cx, bot - H * 0.2); ctx.closePath(); };
    K.b.fillStyle = gray(0.8); K.b.fillRect(0, 0, w, h);
    K.s.fillStyle = '#fff'; vane(K.s); K.s.fill();
    // takik: irisan tipis membuang sebagian bendera
    K.s.globalCompositeOperation = 'destination-out'; K.s.strokeStyle = '#000'; K.s.lineWidth = 2.6;
    for (const [u, sgn] of [[0.38, -1], [0.55, 1], [0.7, -1]]) { const y = bot - H * u; K.s.beginPath(); K.s.moveTo(cx + sgn * hw * 1.3, y - H * 0.1); K.s.lineTo(cx + sgn * hw * 0.25, y); K.s.stroke(); }
    K.s.globalCompositeOperation = 'source-over';
    K.g.strokeStyle = gray(0.6); K.g.lineWidth = 1.4;
    for (let i = 0; i < 34; i++) { const y = bot - H * (0.2 + 0.74 * i / 33); for (const sgn of [-1, 1]) { K.g.beginPath(); K.g.moveTo(cx, y); K.g.lineTo(cx + sgn * hw * 1.3, y - H * 0.11); K.g.stroke(); } }
    K.b.strokeStyle = gray(0.95); K.b.lineWidth = 5; for (let i = 0; i < 9; i++) { const y = bot - H * (0.24 + 0.07 * i); K.b.beginPath(); K.b.moveTo(cx - hw * 1.3, y - H * 0.1); K.b.lineTo(cx, y); K.b.lineTo(cx + hw * 1.3, y - H * 0.1); K.b.stroke(); }
    for (const [ctx, col, lw] of [[K.s, '#fff', 3.4], [K.b, gray(0.62), 2.4]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, bot); ctx.lineTo(cx, top + H * 0.2); ctx.stroke(); }
    peacockEye(K, cx, top + H * 0.26, hw * 0.62, H * 0.13, 0.8);
  },
  // mata merak lepas (cap / kilas): mata + rumbai pendek memancar
  mata_merak(K, w, h) {
    SEED = 23;
    const cx = w / 2, cy = h / 2, r = w / 2 - SPREAD - 2;
    K.b.fillStyle = gray(0.8); K.b.fillRect(0, 0, w, h);
    for (let i = 0; i < 56; i++) { const a = i / 56 * Math.PI * 2 + rnd() * 0.05, r0 = r * 0.5, L = r * (0.34 + 0.16 * rnd()); barb(K, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, Math.cos(a) * L, Math.sin(a) * L, 3.2, 0.74 + 0.24 * rnd(), 0.0); }
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.arc(cx, cy, r * 0.62, 0, Math.PI * 2); K.s.fill();
    K.a.strokeStyle = gray(0.35); K.a.lineWidth = r * 0.3; K.a.beginPath(); K.a.arc(cx, cy, r * 0.76, 0, Math.PI * 2); K.a.stroke();
    peacockEye(K, cx, cy, r * 0.6, r * 0.6);
  },
  // serat: tiga helai barb tipis melengkung (jejak pelacak)
  serat(K, w, h) {
    SEED = 31;
    const m = SPREAD + 2;
    K.b.fillStyle = gray(0.86); K.b.fillRect(0, 0, w, h); K.a.fillStyle = gray(0.5); K.a.fillRect(0, 0, w, h);
    for (const [x, c] of [[w * 0.36, -5], [w * 0.5, 4], [w * 0.64, -3]]) { K.s.strokeStyle = '#fff'; K.s.lineWidth = 2.6; K.s.lineCap = 'round'; K.s.beginPath(); K.s.moveTo(w / 2, h - m); K.s.quadraticCurveTo(x + c, h * 0.5, x, m + rnd() * h * 0.12); K.s.stroke(); }
  },
  cincin(K, w, h) {
    const r = w / 2 - SPREAD - 6;
    K.s.strokeStyle = '#fff'; K.s.lineWidth = r * 0.16; K.s.beginPath(); K.s.arc(w / 2, h / 2, r * 0.9, 0, Math.PI * 2); K.s.stroke();
    K.b.fillStyle = gray(0.3); K.b.fillRect(0, 0, w, h); K.a.fillStyle = '#fff'; K.a.fillRect(0, 0, w, h);
  },
  // garis: goresan meruncing di kedua ujung
  garis(K, w, h) {
    const m = SPREAD + 2, cx = w / 2;
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.moveTo(cx, h - m); K.s.quadraticCurveTo(cx - w * 0.16, h * 0.5, cx, m); K.s.quadraticCurveTo(cx + w * 0.16, h * 0.5, cx, h - m); K.s.fill();
    K.b.fillStyle = gray(0.15); K.b.fillRect(0, 0, w, h); K.a.fillStyle = '#fff'; K.a.fillRect(0, 0, w, h);
  },
  // kilau bersudut empat
  kilau4(K, w, h) {
    const cx = w / 2, cy = h / 2, r = w / 2 - SPREAD - 2, q = r * 0.16;
    K.s.fillStyle = '#fff'; K.s.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; K.s.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); K.s.lineTo(cx + Math.cos(a + Math.PI / 4) * q, cy + Math.sin(a + Math.PI / 4) * q); }
    K.s.closePath(); K.s.fill();
    const gr = K.b.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, gray(0)); gr.addColorStop(1, gray(0.7)); K.b.fillStyle = gr; K.b.fillRect(0, 0, w, h);
    K.a.fillStyle = '#fff'; K.a.fillRect(0, 0, w, h);
  },
  // pilar cahaya lembut (tiang): pita tegak, inti terang
  pilar(K, w, h) {
    const m = SPREAD + 2;
    K.s.fillStyle = '#fff'; K.s.fillRect(w * 0.3, m, w * 0.4, h - 2 * m);
    const gr = K.a.createLinearGradient(0, 0, w, 0); gr.addColorStop(0.3, gray(0)); gr.addColorStop(0.5, gray(1)); gr.addColorStop(0.7, gray(0)); K.a.fillStyle = gr; K.a.fillRect(0, 0, w, h);
    const gv = K.a.createLinearGradient(0, 0, 0, h); gv.addColorStop(0, 'rgba(0,0,0,1)'); gv.addColorStop(0.35, 'rgba(0,0,0,0)'); gv.addColorStop(1, 'rgba(0,0,0,0)'); K.a.fillStyle = gv; K.a.fillRect(0, 0, w, h);
    K.b.fillStyle = gray(0.3); K.b.fillRect(0, 0, w, h);
  },
  // ================= M2 =================
  // bulu elang emas: bendera runcing bertakik, tangkai terang, pangkal merah tua
  bulu_elang(K, w, h) {
    const cx = w / 2, m = SPREAD + 2, top = m, bot = h - m, H = bot - top, hw = w / 2 - m - 3;
    vgrad(K.b, w, h, [[0, 0.02], [0.5, 0.42], [0.82, 0.72], [1, 1]]);
    vgrad(K.a, w, h, [[0, 0.75], [0.5, 0.3], [1, 0.1]]);
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.moveTo(cx + 2, top);
    K.s.bezierCurveTo(cx + hw * 0.75, top + H * 0.16, cx + hw * 1.05, top + H * 0.5, cx + hw * 0.5, bot - H * 0.2); K.s.lineTo(cx, bot - H * 0.13);
    K.s.lineTo(cx - hw * 0.42, bot - H * 0.22); K.s.bezierCurveTo(cx - hw * 0.95, top + H * 0.5, cx - hw * 0.6, top + H * 0.14, cx + 2, top); K.s.fill();
    cut(K.s, () => { for (const [u, sg] of [[0.34, 1], [0.5, -1], [0.62, 1], [0.76, -1]]) { const y = bot - H * u; K.s.beginPath(); K.s.moveTo(cx + sg * hw * 1.2, y - H * 0.12); K.s.lineTo(cx + sg * hw * 0.2, y); K.s.stroke(); } }, 3.2);
    K.g.strokeStyle = gray(0.55); K.g.lineWidth = 1.5;
    for (let i = 0; i < 30; i++) { const y = bot - H * (0.14 + 0.82 * i / 29); for (const sg of [-1, 1]) { K.g.beginPath(); K.g.moveTo(cx, y); K.g.lineTo(cx + sg * hw * 1.2, y - H * 0.13); K.g.stroke(); } }
    for (const [ctx, col, lw] of [[K.s, '#fff', 4], [K.b, gray(0.05), 3], [K.a, gray(1), 3], [K.g, '#fff', 3]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, bot); ctx.quadraticCurveTo(cx - 1, top + H * 0.5, cx + 2, top + H * 0.06); ctx.stroke(); }
  },
  // lidah api: tetes meliuk berujung runcing + lidah kecil di samping; inti kuning-putih, tepi merah
  lidah_api(K, w, h) {
    const cx = w / 2, m = SPREAD + 2, top = m, bot = h - m, H = bot - top, hw = w / 2 - m - 2;
    const tongue = (ctx, k) => { const x = (v) => cx + v * hw * k, y = (u) => bot - H * 0.05 - H * 0.95 * u * (0.25 + 0.75 * k);
      ctx.beginPath(); ctx.moveTo(x(-0.7), y(0.1)); ctx.bezierCurveTo(x(-1.05), y(0.42), x(-0.05), y(0.6), x(0.38), y(1)); ctx.bezierCurveTo(x(0.2), y(0.7), x(1.1), y(0.48), x(0.7), y(0.1)); ctx.quadraticCurveTo(x(0), y(-0.04), x(-0.7), y(0.1)); ctx.fill(); };
    fillAll(K.b, 0.52, w, h); fillAll(K.a, 1, w, h);
    K.s.fillStyle = '#fff'; tongue(K.s, 1);
    K.s.beginPath(); K.s.moveTo(cx - hw * 0.72, bot - H * 0.28); K.s.quadraticCurveTo(cx - hw * 1.15, bot - H * 0.55, cx - hw * 0.62, bot - H * 0.74); K.s.quadraticCurveTo(cx - hw * 0.6, bot - H * 0.5, cx - hw * 0.2, bot - H * 0.3); K.s.fill();
    K.b.fillStyle = gray(0.36); tongue(K.b, 0.8); K.b.fillStyle = gray(0.2); tongue(K.b, 0.58); K.b.fillStyle = gray(0.03); tongue(K.b, 0.34);
  },
  // tetes lava: kepala bulat di bawah (depan), ekor runcing di atas
  tetes(K, w, h) {
    const cx = w / 2, m = SPREAD + 2, r = w * 0.2, cy = h - m - r - 2;
    fillAll(K.b, 0.34, w, h); fillAll(K.a, 1, w, h);
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.moveTo(cx, m); K.s.bezierCurveTo(cx + r * 0.3, cy - r * 1.6, cx + r * 1.25, cy - r * 0.6, cx + r, cy); K.s.arc(cx, cy, r, 0, Math.PI); K.s.bezierCurveTo(cx - r * 1.25, cy - r * 0.6, cx - r * 0.3, cy - r * 1.6, cx, m); K.s.fill();
    const g = K.b.createRadialGradient(cx - r * 0.2, cy, 0, cx, cy, r * 1.3); g.addColorStop(0, gray(0.02)); g.addColorStop(1, gray(0.36)); K.b.fillStyle = g; K.b.fillRect(0, 0, w, h);
  },
  // retak: retakan bercabang memancar dari pusat (cap tanah / dampak)
  retak(K, w, h) {
    SEED = 41;
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 4;
    const g = K.b.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, gray(0.05)); g.addColorStop(0.5, gray(0.3)); g.addColorStop(1, gray(0.46)); K.b.fillStyle = g; K.b.fillRect(0, 0, w, h);
    const ga = K.a.createRadialGradient(cx, cy, 0, cx, cy, R); ga.addColorStop(0, gray(1)); ga.addColorStop(1, gray(0.55)); K.a.fillStyle = ga; K.a.fillRect(0, 0, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineCap = 'round'; K.s.lineJoin = 'round';
    const crack = (x, y, a, len, lw, d) => {
      let px = x, py = y;
      for (let i = 0; i < 4; i++) {
        const na = a + (rnd() - 0.5) * 0.9, l = len * (0.2 + 0.1 * rnd()), nx = px + Math.cos(na) * l, ny = py + Math.sin(na) * l;
        if (Math.hypot(nx - cx, ny - cy) > R) break;
        K.s.lineWidth = Math.max(2.4, lw * (1 - i * 0.2)); K.s.beginPath(); K.s.moveTo(px, py); K.s.lineTo(nx, ny); K.s.stroke();
        if (d > 0 && rnd() < 0.6) crack(nx, ny, na + (rnd() < 0.5 ? 1 : -1) * (0.5 + 0.5 * rnd()), len * 0.55, lw * 0.62, d - 1);
        px = nx; py = ny;
      }
    };
    for (let i = 0; i < 7; i++) crack(cx, cy, i / 7 * Math.PI * 2 + rnd() * 0.5, R * 1.25, 11, 2);
    K.s.fillStyle = '#fff'; K.s.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, r = R * (0.1 + 0.07 * rnd()); K.s.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } K.s.fill();
  },
  // asap: gumpalan bulat-bulat (potong, tanpa emisi)
  asap(K, w, h) {
    SEED = 43;
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 2;
    vgrad(K.b, w, h, [[0, 0.1], [1, 0.95]]);
    K.s.fillStyle = '#fff';
    for (const [x, y, r] of [[0, 0.1, 0.52], [-0.42, 0.2, 0.36], [0.44, 0.16, 0.38], [-0.2, -0.3, 0.4], [0.24, -0.34, 0.36], [0, 0.42, 0.34]]) { K.s.beginPath(); K.s.arc(cx + x * R, cy + y * R, r * R, 0, Math.PI * 2); K.s.fill(); }
    for (let i = 0; i < 26; i++) { K.g.fillStyle = gray(0.62 + 0.3 * rnd()); K.g.beginPath(); K.g.arc(cx + (rnd() - 0.5) * R * 1.7, cy + (rnd() - 0.5) * R * 1.7, R * (0.08 + 0.12 * rnd()), 0, Math.PI * 2); K.g.fill(); }
  },
  // serpih obsidian: pecahan bersudut dengan satu tepi membara
  serpih(K, w, h) {
    const m = SPREAD + 3, P = [[0.5, 0], [0.92, 0.3], [0.78, 0.86], [0.36, 1], [0.06, 0.52]].map(([x, y]) => [m + x * (w - 2 * m), m + y * (h - 2 * m)]);
    fillAll(K.b, 0.9, w, h);
    K.s.fillStyle = '#fff'; poly(K.s, P); K.s.fill();
    K.b.strokeStyle = gray(0.3); K.b.lineWidth = 9; K.b.beginPath(); K.b.moveTo(P[3][0], P[3][1]); K.b.lineTo(P[4][0], P[4][1]); K.b.lineTo(P[0][0], P[0][1]); K.b.stroke();
    K.a.strokeStyle = gray(1); K.a.lineWidth = 9; K.a.beginPath(); K.a.moveTo(P[3][0], P[3][1]); K.a.lineTo(P[4][0], P[4][1]); K.a.lineTo(P[0][0], P[0][1]); K.a.stroke();
    K.g.strokeStyle = gray(0.5); K.g.lineWidth = 2; for (const i of [1, 2, 3]) { K.g.beginPath(); K.g.moveTo(w * 0.45, h * 0.48); K.g.lineTo(P[i][0], P[i][1]); K.g.stroke(); }
  },
  // segi enam: bingkai heks tebal + heks dalam tipis + tanda di sudut
  segi6(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 8;
    fillAll(K.b, 0.28, w, h); fillAll(K.a, 1, w, h);
    const hex = (r, lw) => { K.s.lineWidth = lw; K.s.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; K.s.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } K.s.closePath(); K.s.stroke(); };
    K.s.strokeStyle = '#fff'; K.s.lineJoin = 'miter'; hex(R * 0.92, R * 0.13); hex(R * 0.62, R * 0.05);
    K.s.lineWidth = R * 0.07; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; K.s.beginPath(); K.s.moveTo(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62); K.s.lineTo(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78); K.s.stroke(); }
    K.b.strokeStyle = gray(0.05); K.b.lineWidth = R * 0.06; K.b.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; K.b.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92); } K.b.closePath(); K.b.stroke();
  },
  // chevron ganda mengarah ke atas
  chevron(K, w, h) {
    const cx = w / 2, m = SPREAD + 6, hw = w / 2 - m;
    fillAll(K.b, 0.25, w, h); fillAll(K.a, 1, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = 12; K.s.lineJoin = 'miter'; K.s.lineCap = 'butt';
    for (const y of [h * 0.52, h * 0.82]) { K.s.beginPath(); K.s.moveTo(cx - hw, y); K.s.lineTo(cx, y - h * 0.3); K.s.lineTo(cx + hw, y); K.s.stroke(); }
  },
  // pelat holo: bingkai bersudut potong + baris data + blok
  pelat(K, w, h) {
    const m = SPREAD + 4, x0 = m, y0 = m + 8, x1 = w - m, y1 = h - m - 8, c = 16;
    fillAll(K.b, 0.4, w, h); fillAll(K.a, 0.85, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = 5; K.s.lineJoin = 'miter';
    poly(K.s, [[x0, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1], [x0 + c, y1], [x0, y1 - c]]); K.s.stroke();
    K.s.fillStyle = '#fff'; K.s.fillRect(x0 + 12, y0 + 12, 26, 14);
    for (const [y, l] of [[0.5, 0.7], [0.64, 0.45], [0.78, 0.6]]) K.s.fillRect(x0 + 12, y0 + (y1 - y0) * y, (x1 - x0 - 24) * l, 5);
    K.b.fillStyle = gray(0.08); K.b.fillRect(x0 + 10, y0 + 10, 30, 18);
  },
  // cabang: busur listrik bergerigi dengan dua-tiga anak cabang
  cabang(K, w, h) {
    SEED = 53;
    const m = SPREAD + 3;
    fillAll(K.b, 0.12, w, h); fillAll(K.a, 1, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineCap = 'round'; K.s.lineJoin = 'round';
    const bolt = (x, y, a, n, seg, lw, d) => { for (let i = 0; i < n; i++) { const na = a + (rnd() - 0.5) * 1.1, nx = Math.max(m, Math.min(w - m, x + Math.cos(na) * seg)), ny = Math.max(m, y + Math.sin(na) * seg); K.s.lineWidth = Math.max(2.6, lw * (1 - 0.5 * i / n)); K.s.beginPath(); K.s.moveTo(x, y); K.s.lineTo(nx, ny); K.s.stroke(); if (d && (i === 1 || i === 3 || i === 5)) bolt(nx, ny, a + (i === 3 ? -0.9 : 0.9), 3, seg * 0.75, lw * 0.55, 0); x = nx; y = ny; } };
    bolt(w / 2, h - m, -Math.PI / 2, 8, (h - 2 * m) / 8.6, 7, 1);
  },
  // serpih es: pecahan memanjang runcing, satu sisi lebih gelap
  serpih_es(K, w, h) {
    const cx = w / 2, m = SPREAD + 2, top = m, bot = h - m, H = bot - top, hw = w * 0.24;
    const P = [[cx + 3, top], [cx + hw, top + H * 0.36], [cx + hw * 0.5, bot - H * 0.08], [cx - 4, bot], [cx - hw * 0.8, bot - H * 0.3], [cx - hw * 0.6, top + H * 0.3]];
    vgrad(K.b, w, h, [[0, 0.02], [1, 0.5]]); fillAll(K.a, 0.3, w, h);
    K.s.fillStyle = '#fff'; poly(K.s, P); K.s.fill();
    K.b.fillStyle = gray(0.62); poly(K.b, [P[0], P[1], P[2], P[3], [cx + 2, top + H * 0.5]]); K.b.fill();
    K.a.strokeStyle = gray(1); K.a.lineWidth = 4; K.a.beginPath(); K.a.moveTo(P[0][0], P[0][1]); K.a.lineTo(cx + 2, top + H * 0.5); K.a.lineTo(P[3][0], P[3][1]); K.a.stroke();
  },
  // butir salju: enam lengan bercabang
  salju(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 3;
    fillAll(K.b, 0.12, w, h); fillAll(K.a, 0.7, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
      K.s.lineWidth = 6; K.s.beginPath(); K.s.moveTo(cx, cy); K.s.lineTo(cx + c * R, cy + s * R); K.s.stroke();
      K.s.lineWidth = 4.5; for (const [u, l] of [[0.45, 0.3], [0.72, 0.22]]) for (const sg of [-1, 1]) { const b = a + sg * 1.0; K.s.beginPath(); K.s.moveTo(cx + c * R * u, cy + s * R * u); K.s.lineTo(cx + c * R * u + Math.cos(b) * R * l, cy + s * R * u + Math.sin(b) * R * l); K.s.stroke(); }
    }
    K.s.fillStyle = '#fff'; K.s.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; K.s.lineTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2); } K.s.fill();
  },
  // gugus kristal: tiga prisma segi enam berujung runcing, sisi kiri terang / kanan gelap
  kristal(K, w, h) {
    const m = SPREAD + 2, bot = h - m;
    fillAll(K.b, 0.3, w, h); fillAll(K.a, 0.25, w, h);
    const prism = (bx, hw, len, tilt) => {
      const c = Math.cos(tilt), s = Math.sin(tilt), T = (x, y) => [bx + x * c + y * s, bot - 2 + x * s - y * c];
      const P = [T(-hw, 0), T(-hw, len * 0.76), T(0, len), T(hw, len * 0.76), T(hw, 0)];
      K.s.fillStyle = '#fff'; poly(K.s, P); K.s.fill();
      K.b.fillStyle = gray(0.1); poly(K.b, [T(-hw, 0), T(-hw, len * 0.76), T(0, len), T(-hw * 0.15, len * 0.7), T(-hw * 0.15, 0)]); K.b.fill();
      K.b.fillStyle = gray(0.68); poly(K.b, [T(hw * 0.3, 0), T(hw * 0.3, len * 0.72), T(0, len), T(hw, len * 0.76), T(hw, 0)]); K.b.fill();
      K.a.fillStyle = gray(0.9); poly(K.a, [T(-hw, 0), T(-hw, len * 0.76), T(0, len), T(-hw * 0.55, len * 0.74), T(-hw * 0.55, 0)]); K.a.fill();
      K.g.strokeStyle = gray(0.45); K.g.lineWidth = 2; for (const x of [-hw * 0.15, hw * 0.3]) { K.g.beginPath(); K.g.moveTo(...T(x, 0)); K.g.lineTo(...T(x, len * 0.71)); K.g.lineTo(...T(0, len)); K.g.stroke(); }
    };
    prism(w * 0.3, 13, (h - 2 * m) * 0.6, -0.26); prism(w * 0.72, 12, (h - 2 * m) * 0.5, 0.3); prism(w * 0.5, 18, (h - 2 * m) * 0.98, 0.02);
  },
  // embun beku: bunga es berdendrit (enam cabang pakis)
  embun(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 3;
    const g = K.b.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, gray(0.02)); g.addColorStop(1, gray(0.5)); K.b.fillStyle = g; K.b.fillRect(0, 0, w, h); fillAll(K.a, 0.8, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineCap = 'round';
    const frond = (x, y, a, len, lw, d) => { const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len; K.s.lineWidth = lw; K.s.beginPath(); K.s.moveTo(x, y); K.s.lineTo(nx, ny); K.s.stroke();
      if (d > 0) for (const u of [0.3, 0.52, 0.74]) for (const sg of [-1, 1]) frond(x + (nx - x) * u, y + (ny - y) * u, a + sg * 1.05, len * (0.46 - 0.3 * u), Math.max(2.6, lw * 0.62), d - 1); };
    for (let i = 0; i < 6; i++) frond(cx, cy, i * Math.PI / 3 + 0.26, R, 6.5, 2);
  },
  // glif data: bingkai sudut + blok piksel (aksara rekaan, bukan huruf nyata)
  glif(K, w, h) {
    SEED = 61;
    const m = SPREAD + 5, s = (w - 2 * m) / 5;
    fillAll(K.b, 0.3, w, h); fillAll(K.a, 1, w, h);
    K.s.fillStyle = '#fff';
    const on = [[0, 0], [1, 0], [3, 0], [4, 0], [0, 1], [4, 1], [1, 2], [2, 2], [3, 2], [0, 3], [2, 3], [4, 3], [0, 4], [1, 4], [3, 4], [4, 4]];
    for (const [x, y] of on) K.s.fillRect(m + x * s + 2, m + y * s + 2, s - 4, s - 4);
    K.b.fillStyle = gray(0.98); K.b.fillRect(m + 2 * s, m + 2 * s, s, s);
  },
  // kisi segi enam: tujuh sel sarang lebah
  kisi(K, w, h) {
    const cx = w / 2, cy = h / 2, r = (w / 2 - SPREAD - 5) / 2.75;
    fillAll(K.b, 0.3, w, h); fillAll(K.a, 1, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = 6; K.s.lineJoin = 'round';
    const hex = (x, y) => { K.s.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; K.s.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } K.s.closePath(); K.s.stroke(); };
    hex(cx, cy); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; hex(cx + Math.cos(a) * r * 1.732, cy + Math.sin(a) * r * 1.732); }
    K.s.fillStyle = '#fff'; K.s.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; K.s.lineTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5); } K.s.fill();
    K.b.fillStyle = gray(0.98); K.b.beginPath(); K.b.arc(cx, cy, r * 0.6, 0, Math.PI * 2); K.b.fill();
  },
  // benang: dua helai emas saling melilit + simpul
  benang(K, w, h) {
    const m = SPREAD + 2, cx = w / 2, A = w / 2 - m - 4;
    fillAll(K.b, 0.22, w, h); fillAll(K.a, 0.9, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = 4.5; K.s.lineCap = 'round';
    for (const ph of [0, Math.PI]) { K.s.beginPath(); for (let i = 0; i <= 60; i++) { const u = i / 60, y = h - m - u * (h - 2 * m), x = cx + Math.sin(u * Math.PI * 5 + ph) * A * (0.5 + 0.5 * Math.sin(u * Math.PI)); i ? K.s.lineTo(x, y) : K.s.moveTo(x, y); } K.s.stroke(); }
    K.s.fillStyle = '#fff'; for (let k = 1; k < 5; k++) { const y = h - m - (k / 5) * (h - 2 * m); K.s.beginPath(); K.s.arc(cx, y, 5, 0, Math.PI * 2); K.s.fill(); }
    K.b.fillStyle = gray(0.02); for (let k = 1; k < 5; k++) { const y = h - m - (k / 5) * (h - 2 * m); K.b.beginPath(); K.b.arc(cx, y, 6, 0, Math.PI * 2); K.b.fill(); }
  },
  // bintang delapan songket: dua bujur sangkar bertumpuk, isi marun, inti emas
  bintang8(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 2;
    const star = (ctx, r, q) => { ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * q : r; ctx.lineTo(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr); } ctx.closePath(); ctx.fill(); };
    fillAll(K.b, 0.3, w, h); fillAll(K.a, 0.9, w, h);
    K.s.fillStyle = '#fff'; star(K.s, R, 0.62);
    K.b.fillStyle = gray(0.8); star(K.b, R * 0.7, 0.62); K.a.fillStyle = gray(0.25); star(K.a, R * 0.7, 0.62);
    K.b.fillStyle = gray(0.05); star(K.b, R * 0.34, 0.5); K.a.fillStyle = gray(1); star(K.a, R * 0.34, 0.5);
  },
  // ketupat tenun: belah ketupat emas, isi marun, ketupat kecil di tengah, empat titik sudut
  ketupat(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 2;
    const dia = (ctx, rx, ry) => { poly(ctx, [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]]); ctx.fill(); };
    fillAll(K.b, 0.28, w, h); fillAll(K.a, 0.85, w, h);
    K.s.fillStyle = '#fff'; dia(K.s, R * 0.74, R);
    K.b.fillStyle = gray(0.82); dia(K.b, R * 0.52, R * 0.72); K.a.fillStyle = gray(0.2); dia(K.a, R * 0.52, R * 0.72);
    K.b.fillStyle = gray(0.05); dia(K.b, R * 0.22, R * 0.32); K.a.fillStyle = gray(1); dia(K.a, R * 0.22, R * 0.32);
    K.g.strokeStyle = gray(0.55); K.g.lineWidth = 2; for (let i = -6; i <= 6; i++) { K.g.beginPath(); K.g.moveTo(cx + i * 9 - R, cy - R); K.g.lineTo(cx + i * 9 + R, cy + R); K.g.stroke(); }
  },
  // kelopak: kelopak runcing (pangkal sempit, ujung lancip) marun bertepi emas + urat tengah
  kelopak(K, w, h) {
    const cx = w / 2, m = SPREAD + 2, top = m, bot = h - m, H = bot - top, hw = w * 0.24;
    const path = (ctx) => { ctx.beginPath(); ctx.moveTo(cx, bot); ctx.bezierCurveTo(cx - hw * 0.5, bot - H * 0.08, cx - hw * 1.25, bot - H * 0.62, cx, top); ctx.bezierCurveTo(cx + hw * 1.25, bot - H * 0.62, cx + hw * 0.5, bot - H * 0.08, cx, bot); ctx.closePath(); };
    fillAll(K.b, 0.74, w, h); fillAll(K.a, 0.35, w, h);
    K.s.fillStyle = '#fff'; path(K.s); K.s.fill();
    for (const [ctx, v] of [[K.b, 0.22], [K.a, 0.95]]) { ctx.strokeStyle = gray(v); ctx.lineWidth = 9; path(ctx); ctx.stroke(); } // tepi emas menyala
    K.b.strokeStyle = gray(0.3); K.b.lineWidth = 3; K.b.beginPath(); K.b.moveTo(cx, bot - 4); K.b.quadraticCurveTo(cx + 3, bot - H * 0.5, cx, top + H * 0.12); K.b.stroke();
    K.g.strokeStyle = gray(0.55); K.g.lineWidth = 2; for (const k of [-1, 1]) { K.g.beginPath(); K.g.moveTo(cx, bot - H * 0.2); K.g.quadraticCurveTo(cx + k * hw * 0.5, bot - H * 0.45, cx + k * hw * 0.55, top + H * 0.3); K.g.stroke(); }
  },
  // pamor: empat garis berliku sejajar (lapisan logam tempa)
  pamor(K, w, h) {
    const m = SPREAD + 2;
    fillAll(K.b, 0.3, w, h); fillAll(K.a, 1, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineCap = 'round';
    for (let k = 0; k < 4; k++) { K.s.lineWidth = k % 2 ? 2.8 : 4; K.s.beginPath(); for (let i = 0; i <= 50; i++) { const u = i / 50, y = h - m - u * (h - 2 * m), x = m + 6 + k * (w - 2 * m - 12) / 3 + Math.sin(u * 15 + k * 0.7) * 3.2 * Math.sin(u * Math.PI) + Math.sin(u * 5.5 + k) * 3; i ? K.s.lineTo(x, y) : K.s.moveTo(x, y); } K.s.stroke(); }
  },
  // sulur asap tuah: garis S meruncing yang berakhir bergelung
  sulur(K, w, h) {
    const m = SPREAD + 4, cx = w / 2;
    vgrad(K.b, w, h, [[0, 0.05], [1, 0.5]]); vgrad(K.a, w, h, [[0, 1], [1, 0.5]]);
    K.s.fillStyle = '#fff';
    const N = 150, gx = cx + 6, gy = m + 34, gr = 26; // gelung di atas
    for (let i = 0; i <= N; i++) {
      const u = i / N; let x, y;
      if (u < 0.62) { const k = u / 0.62; y = h - m - 6 - k * (h - m - 6 - (gy + 4)); x = cx + Math.sin(k * Math.PI * 1.6) * (w / 2 - m - 16) * (1 - 0.35 * k) + (gx + gr - cx) * k * k; }
      else { const k = (u - 0.62) / 0.38, a = -0.1 - k * Math.PI * 2.6, r = gr * (1 - 0.74 * k); x = gx + Math.cos(a) * r; y = gy - Math.sin(a) * r * -1; }
      K.s.beginPath(); K.s.arc(x, y, 8.5 * (1 - 0.72 * u) + 1.4, 0, Math.PI * 2); K.s.fill();
    }
  },
  // mendak: cincin logam bermanik
  mendak(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 4;
    fillAll(K.b, 0.8, w, h); fillAll(K.a, 0.5, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = R * 0.2; K.s.beginPath(); K.s.arc(cx, cy, R * 0.72, 0, Math.PI * 2); K.s.stroke();
    K.s.lineWidth = 3; K.s.beginPath(); K.s.arc(cx, cy, R * 0.46, 0, Math.PI * 2); K.s.stroke();
    K.s.fillStyle = '#fff'; K.b.fillStyle = gray(0.3); K.a.fillStyle = gray(1);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; for (const ctx of [K.s, K.b, K.a]) { ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92, ctx === K.s ? 6.5 : 7.5, 0, Math.PI * 2); ctx.fill(); } }
  },
  // kilat: sambaran bergerigi tebal yang meruncing ke bawah (pangkal sel) — digambar dari awan (atas) ke tanah (bawah)
  kilat(K, w, h) {
    const m = SPREAD + 2, X = (u) => m + u * (w - 2 * m), Y = (v) => m + v * (h - 2 * m);
    fillAll(K.b, 0.1, w, h); fillAll(K.a, 1, w, h);
    K.s.fillStyle = '#fff';
    poly(K.s, [[X(0.52), Y(0)], [X(0.86), Y(0)], [X(0.56), Y(0.3)], [X(0.8), Y(0.3)], [X(0.42), Y(0.62)], [X(0.62), Y(0.62)], [X(0.3), Y(1)], [X(0.36), Y(0.7)], [X(0.16), Y(0.7)], [X(0.44), Y(0.4)], [X(0.2), Y(0.4)]]); K.s.fill();
    K.b.strokeStyle = gray(0.0); K.b.lineWidth = 6; K.b.lineJoin = 'round'; K.b.beginPath(); K.b.moveTo(X(0.68), Y(0)); K.b.lineTo(X(0.42), Y(0.35)); K.b.lineTo(X(0.6), Y(0.35)); K.b.lineTo(X(0.3), Y(0.66)); K.b.lineTo(X(0.48), Y(0.66)); K.b.lineTo(X(0.3), Y(1)); K.b.stroke();
  },
  // awan badai: gumpalan berdasar rata, bawah gelap
  awan(K, w, h) {
    SEED = 71;
    const m = SPREAD + 2, base = h - m - 8;
    vgrad(K.b, w, h, [[0, 0.74], [1, 1]]); vgrad(K.a, w, h, [[0, 0], [0.7, 0], [1, 0.35]]);
    K.s.fillStyle = '#fff';
    for (const [x, r] of [[0.16, 0.2], [0.32, 0.3], [0.5, 0.36], [0.68, 0.3], [0.85, 0.2]]) { K.s.beginPath(); K.s.arc(m + x * (w - 2 * m), base - r * (h - 2 * m) * 0.95, r * (h - 2 * m) * 0.98, 0, Math.PI * 2); K.s.fill(); }
    K.s.fillRect(m + 14, base - 24, w - 2 * m - 28, 24);
    for (let i = 0; i < 22; i++) { K.g.fillStyle = gray(0.6 + 0.35 * rnd()); K.g.beginPath(); K.g.arc(m + rnd() * (w - 2 * m), m + rnd() * (h - 2 * m), 8 + 10 * rnd(), 0, Math.PI * 2); K.g.fill(); }
  },
  // segitiga foil: bingkai segitiga + segitiga kecil di dalam (ramp pelangi menyilang)
  segitiga(K, w, h) {
    const cx = w / 2, m = SPREAD + 3, R = w / 2 - m, cy = h / 2 + R * 0.14;
    const tri = (ctx, r) => { ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 3; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); };
    const g = K.b.createLinearGradient(m, h - m, w - m, m); g.addColorStop(0, gray(0)); g.addColorStop(1, gray(1)); K.b.fillStyle = g; K.b.fillRect(0, 0, w, h); fillAll(K.a, 0.85, w, h);
    K.s.fillStyle = '#fff'; tri(K.s, R); K.s.fill();
    cut(K.s, () => { tri(K.s, R * 0.62); K.s.fill(); }, 1);
    tri(K.s, R * 0.3); K.s.fill();
  },
  // bingkai: persegi tipis dengan siku sudut tebal + garis pindai
  bingkai(K, w, h) {
    const m = SPREAD + 6, x0 = m + 20, x1 = w - m - 20, y0 = m, y1 = h - m, c = 34;
    fillAll(K.b, 0.3, w, h); fillAll(K.a, 1, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = 4; K.s.strokeRect(x0, y0, x1 - x0, y1 - y0);
    K.s.lineWidth = 12; K.s.lineCap = 'butt'; K.s.lineJoin = 'miter';
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) { K.s.beginPath(); K.s.moveTo(x + sx * c, y); K.s.lineTo(x, y); K.s.lineTo(x, y + sy * c); K.s.stroke(); }
    K.s.fillStyle = '#fff'; for (const v of [0.3, 0.5, 0.7]) K.s.fillRect(x0 + 16, y0 + (y1 - y0) * v - 2.5, (x1 - x0 - 32) * (v === 0.5 ? 1 : 0.6), 5);
    K.b.fillStyle = gray(0.02); for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) K.b.fillRect(x - c, y - c, 2 * c, 2 * c);
  },
  // prisma: segitiga kaca + berkas masuk dari kiri + kipas spektrum ke kanan
  prisma(K, w, h) {
    const m = SPREAD + 3, cx = w * 0.42, cy = h * 0.56, R = w * 0.25;
    fillAll(K.b, 0.62, w, h); fillAll(K.a, 0.9, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = 6; K.s.lineJoin = 'round';
    K.s.beginPath(); for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 3; K.s.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } K.s.closePath(); K.s.stroke();
    K.s.lineWidth = 4; K.s.beginPath(); K.s.moveTo(m, cy + 8); K.s.lineTo(cx - R * 0.45, cy - 2); K.s.stroke();
    K.s.lineCap = 'butt';
    for (let i = 0; i < 5; i++) { const a = -0.42 + i * 0.21, x0 = cx + R * 0.5, y0 = cy - 4 + i * 2, x1 = w - m, y1 = y0 + Math.tan(a) * (x1 - x0); K.s.lineWidth = 5.5; K.s.beginPath(); K.s.moveTo(x0, y0); K.s.lineTo(x1, y1); K.s.stroke();
      K.b.strokeStyle = gray(i / 4 * 0.9); K.b.lineWidth = 9; K.b.beginPath(); K.b.moveTo(x0, y0); K.b.lineTo(x1, y1); K.b.stroke(); }
  },
  // kerang kipas: tepi atas bergelombang, rusuk memancar dari engsel
  kerang(K, w, h) {
    const cx = w / 2, m = SPREAD + 3, by = h - m - 10, R = h - 2 * m - 14;
    const g = K.b.createRadialGradient(cx, by, 0, cx, by, R); g.addColorStop(0, gray(0.48)); g.addColorStop(0.6, gray(0.36)); g.addColorStop(1, gray(0.08)); K.b.fillStyle = g; K.b.fillRect(0, 0, w, h); fillAll(K.a, 0.3, w, h);
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.moveTo(cx, by + 4);
    const N = 7, a0 = Math.PI * 1.1, a1 = Math.PI * 1.9;
    for (let i = 0; i < N; i++) { const a = a0 + (a1 - a0) * i / N, b = a0 + (a1 - a0) * (i + 1) / N, mid = (a + b) / 2, k = 1 - 0.16 * Math.pow(Math.abs((i + 0.5) / N * 2 - 1), 2);
      if (!i) K.s.lineTo(cx + Math.cos(a) * R * k * 0.9, by + Math.sin(a) * R * k * 0.9);
      K.s.quadraticCurveTo(cx + Math.cos(mid) * R * k * 1.12, by + Math.sin(mid) * R * k * 1.12, cx + Math.cos(b) * R * k * 0.9, by + Math.sin(b) * R * k * 0.9); }
    K.s.closePath(); K.s.fill();
    K.s.fillRect(cx - 17, by - 3, 34, 12);
    K.g.strokeStyle = gray(0.4); K.g.lineWidth = 2.6; for (let i = 1; i < N; i++) { const a = a0 + (a1 - a0) * i / N; K.g.beginPath(); K.g.moveTo(cx, by); K.g.lineTo(cx + Math.cos(a) * R, by + Math.sin(a) * R); K.g.stroke(); }
  },
  // gelembung: cincin tipis + kilap sabit + titik
  gelembung(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 4;
    fillAll(K.b, 0.55, w, h); fillAll(K.a, 0.55, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = 5; K.s.beginPath(); K.s.arc(cx, cy, R, 0, Math.PI * 2); K.s.stroke();
    K.s.lineWidth = 7; K.s.lineCap = 'round'; K.s.beginPath(); K.s.arc(cx, cy, R * 0.66, Math.PI * 1.05, Math.PI * 1.5); K.s.stroke();
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.arc(cx + R * 0.36, cy + R * 0.38, 5, 0, Math.PI * 2); K.s.fill();
    K.b.fillStyle = gray(0.02); K.b.beginPath(); K.b.arc(cx, cy, R * 0.82, 0, Math.PI * 2); K.b.fill(); K.a.fillStyle = gray(1); K.a.beginPath(); K.a.arc(cx, cy, R * 0.82, 0, Math.PI * 2); K.a.fill();
  },
  // butir mutiara: bola berkilau
  butir(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 8;
    const g = K.b.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R); g.addColorStop(0, gray(0)); g.addColorStop(0.5, gray(0.3)); g.addColorStop(1, gray(0.72)); K.b.fillStyle = g; K.b.fillRect(0, 0, w, h);
    const ga = K.a.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R); ga.addColorStop(0, gray(1)); ga.addColorStop(1, gray(0.35)); K.a.fillStyle = ga; K.a.fillRect(0, 0, w, h);
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.arc(cx, cy, R, 0, Math.PI * 2); K.s.fill();
  },
  // riak ganda: dua cincin tipis sepusat + busur terputus
  cincin2(K, w, h) {
    const cx = w / 2, cy = h / 2, R = w / 2 - SPREAD - 5;
    fillAll(K.b, 0.4, w, h); fillAll(K.a, 1, w, h);
    K.s.strokeStyle = '#fff'; K.s.lineWidth = R * 0.07; K.s.beginPath(); K.s.arc(cx, cy, R * 0.95, 0, Math.PI * 2); K.s.stroke();
    K.s.lineWidth = R * 0.05; K.s.beginPath(); K.s.arc(cx, cy, R * 0.68, 0, Math.PI * 2); K.s.stroke();
    K.s.lineWidth = R * 0.04; for (let i = 0; i < 4; i++) { K.s.beginPath(); K.s.arc(cx, cy, R * 0.42, i * Math.PI / 2 + 0.2, i * Math.PI / 2 + 1.2); K.s.stroke(); }
  },
  // ombak: badan gelombang naik lalu menggulung ke kanan, buih di puncak
  ombak(K, w, h) {
    const m = SPREAD + 3, x0 = m, x1 = w - m, by = h - m, H = h - 2 * m;
    vgrad(K.b, w, h, [[0, 0.02], [0.4, 0.3], [1, 0.62]]); vgrad(K.a, w, h, [[0, 0.9], [0.5, 0.3], [1, 0.1]]);
    K.s.fillStyle = '#fff'; K.s.beginPath(); K.s.moveTo(x0, by);
    K.s.bezierCurveTo(x0 + 70, by - 4, x0 + 96, by - H * 0.5, x0 + 132, by - H * 0.92); // punggung naik
    K.s.bezierCurveTo(x0 + 168, by - H * 1.08, x0 + 214, by - H * 0.86, x0 + 208, by - H * 0.5); // puncak menggulung ke kanan-bawah
    K.s.bezierCurveTo(x0 + 204, by - H * 0.34, x0 + 180, by - H * 0.34, x0 + 178, by - H * 0.48); // ujung gulungan
    K.s.bezierCurveTo(x0 + 180, by - H * 0.66, x0 + 158, by - H * 0.72, x0 + 150, by - H * 0.5); // rongga
    K.s.bezierCurveTo(x0 + 144, by - H * 0.24, x0 + 180, by - 4, x1, by); K.s.closePath(); K.s.fill();
    for (const [x, y, r] of [[214, 0.3, 5], [226, 0.52, 4], [200, 0.16, 4]]) { K.s.beginPath(); K.s.arc(x0 + x, by - H * (1 - y), r, 0, Math.PI * 2); K.s.fill(); }
    K.g.strokeStyle = gray(0.55); K.g.lineWidth = 2.5; for (const k of [0.2, 0.36, 0.52]) { K.g.beginPath(); K.g.moveTo(x0 + 20 + k * 60, by - 3); K.g.quadraticCurveTo(x0 + 90 + k * 40, by - H * 0.4, x0 + 120 + k * 60, by - H * (0.9 - k * 0.5)); K.g.stroke(); }
  },
};

export function createFxAtlas() {
  const data = new Uint8Array(AW * AH * 4);
  const tex = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  // tata letak rak (kiri → kanan, baris baru bila penuh)
  // sel tinggi dulu; rak pertama (512) diisi sel 256 dua tingkat supaya muat 2048×1024
  const names = Object.keys(CELLS).sort((a, b) => CELLS[b][1] - CELLS[a][1]), rects = [], idx = {};
  { let x = 0, y = 0, rowH = 0, sub = null; // sub = { x, y } tingkat kedua di bawah sel 256 pada rak 512
    for (const n of names) {
      const [w, h] = CELLS[n];
      if (x + w > AW) { x = 0; y += rowH; rowH = 0; }
      idx[n] = rects.length; rects.push({ n, x, y, w, h, done: false }); x += w; rowH = Math.max(rowH, h);
    }
    // rak 512: pindahkan sel 256 dari rak-rak berikut ke tingkat kedua (y + 256) selama muat
    const r0 = rects.filter((c) => c.y === 0), h0 = Math.max(...r0.map((c) => c.h));
    if (h0 === 512) {
      let sx = r0.filter((c) => c.h === 512).reduce((a, c) => a + c.w, 0); const moved = [];
      for (const c of rects) if (c.y === 512 && c.h === 256 && sx + c.w <= AW) { c.x = sx; c.y = 256; sx += c.w; moved.push(c); }
      if (moved.length) { // rapatkan ulang sisanya
        let x2 = 0, y2 = 512, rh = 0;
        for (const c of rects) { if (c.y < 512 || moved.includes(c)) continue; if (x2 + c.w > AW) { x2 = 0; y2 += rh; rh = 0; } c.x = x2; c.y = y2; x2 += c.w; rh = Math.max(rh, c.h); }
      }
    }
    for (const c of rects) if (c.y + c.h > AH || c.x + c.w > AW) console.warn('Atlas efek penuh:', c.n);
  }
  // palet
  const pn = Object.keys(PALETTES), PH = pn.length * 2, pd = new Uint8Array(PAL_W * PH * 4), prow = {}, col = new THREE.Color();
  pn.forEach((n, k) => {
    prow[n] = k;
    PALETTES[n].forEach((ramp, r) => {
      for (let x = 0; x < PAL_W; x++) {
        const f = x / (PAL_W - 1) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(f)), t = f - i, o = ((k * 2 + r) * PAL_W + x) * 4;
        const a = col.set(ramp[i]).clone(), b = col.set(ramp[i + 1]);
        a.lerp(b, t).convertLinearToSRGB(); // campur di ruang linear, simpan sRGB
        pd[o] = Math.round(a.r * 255); pd[o + 1] = Math.round(a.g * 255); pd[o + 2] = Math.round(a.b * 255); pd[o + 3] = 255;
      }
    });
  });
  const pal = new THREE.DataTexture(pd, PAL_W, PH, THREE.RGBAFormat, THREE.UnsignedByteType);
  pal.colorSpace = THREE.SRGBColorSpace; pal.magFilter = pal.minFilter = THREE.LinearFilter; pal.generateMipmaps = false; pal.flipY = false; pal.needsUpdate = true;

  let cvs = null;
  function ctxs(w, h) { // empat kanvas kerja (dipakai ulang)
    if (!cvs) cvs = [0, 1, 2, 3].map(() => document.createElement('canvas'));
    const K = {};
    ['s', 'g', 'b', 'a'].forEach((k, i) => { const c = cvs[i]; c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = k === 'g' ? '#fff' : '#000'; if (k !== 's') x.fillRect(0, 0, w, h); K[k] = x; });
    return K;
  }
  let warned = false;
  function build(i) {
    const c = rects[i];
    if (!c || c.done) return;
    c.done = true;
    const { x, y, w, h } = c, K = ctxs(w, h);
    try { DRAW[c.n](K, w, h); }
    catch (e) {
      if (!warned) { warned = true; console.warn('Bentuk efek gagal digambar:', c.n, e.message); }
      for (const k of ['s', 'b', 'a']) { K[k].fillStyle = k === 's' ? '#fff' : '#000'; if (k !== 's') K[k].fillRect(0, 0, w, h); else K[k].clearRect(0, 0, w, h); }
      K.s.beginPath(); K.s.arc(w / 2, h / 2, Math.min(w, h) / 2 - SPREAD - 2, 0, Math.PI * 2); K.s.fill();
    }
    const S = K.s.getImageData(0, 0, w, h).data, G = K.g.getImageData(0, 0, w, h).data, B = K.b.getImageData(0, 0, w, h).data, A = K.a.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) mask[p] = S[p * 4 + 3] >= 128 ? 1 : 0;
    const din = edt(mask, w, h, true), dout = edt(mask, w, h, false);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const p = yy * w + xx, o = ((y + yy) * AW + x + xx) * 4;
      // jarak bertanda dengan koreksi sub-piksel dari cakupan anti-alias
      const cov = S[p * 4 + 3] / 255, sd = (mask[p] ? din[p] - 0.5 : -(dout[p] - 0.5)) + (cov - 0.5) * (din[p] <= 1 && dout[p] <= 1 ? 1 : 0);
      data[o] = Math.max(0, Math.min(255, Math.round((0.5 + sd / (2 * SPREAD)) * 255)));
      data[o + 1] = G[p * 4]; data[o + 2] = B[p * 4]; data[o + 3] = A[p * 4];
    }
    tex.needsUpdate = true;
  }
  const api = {
    tex, pal, palRows: PH, names,
    cell: (n) => (idx[n] === undefined ? 0 : idx[n]),
    // kotak sel di tekstur: (u0, v pangkal, du, dv) — v pangkal = tepi bawah sel, dv negatif (baris 0 data = atas kanvas)
    rect(i, out, o = 0) { const c = rects[i] || rects[0]; out[o] = c.x / AW; out[o + 1] = (c.y + c.h) / AH; out[o + 2] = c.w / AW; out[o + 3] = -c.h / AH; return out; },
    palRow: (n) => (prow[n] === undefined ? 0 : prow[n]),
    get ready() { return rects.every((c) => c.done); },
    // bangun sel yang belum jadi selama ≤ ms (minimal satu); → true bila semua selesai
    buildSome(ms = 6) { const t0 = performance.now(); for (let i = 0; i < rects.length; i++) { if (rects[i].done) continue; build(i); if (performance.now() - t0 >= ms) break; } return api.ready; },
    buildAll() { for (let i = 0; i < rects.length; i++) build(i); return true; },
    need(list) { for (const n of list) if (idx[n] !== undefined) build(idx[n]); }, // sel sebuah tema, sekarang juga
  };
  return api;
}
