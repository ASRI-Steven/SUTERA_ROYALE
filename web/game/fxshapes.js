// Atlas bentuk & palet untuk efek skin berbentuk (game/shapefx.js). Semua digambar di peramban (Canvas 2D), tanpa unduhan.
// Satu tekstur RGBA8: R = jarak bertanda ke siluet (0,5 = tepi, > 0,5 di dalam) · G = detail (garis barb/urat: menggelapkan) ·
// B = koordinat ramp palet 0..1 · A = topeng emisi. Bentuk yang sama diwarnai ulang lewat baris palet (tPal: baris 2k =
// albedo, 2k+1 = emisi). Sel dibangun satu per satu (build / buildSome) supaya lobi tidak tersendat; penggambar yang gagal →
// cakram polos + satu peringatan.
// createFxAtlas() → { tex, pal, palRows, cell(nama) → indeks, rect(indeks, out4), pal(nama) → baris, buildSome(ms), buildAll(), ready }
import * as THREE from 'three';

const AW = 1024, AH = 1024, SPREAD = 12, PAL_W = 64;
// nama: [lebar, tinggi] sel. Kartu berdiri: pangkal di bawah sel, ujung di atas.
const CELLS = {
  bulu_merak: [256, 512], bulu_kecil: [128, 256], mata_merak: [256, 256], serat: [64, 256], cincin: [256, 256], garis: [64, 256], kilau4: [128, 128], pilar: [64, 256],
};
// palet: [ramp albedo, ramp emisi] (hex, merata 0..1)
const PALETTES = {
  // inti mata nila → biru → toska → emas → perunggu zaitun → hijau barb gelap → hijau barb terang
  merak: [['#050b2e', '#123c9c', '#0d8f86', '#b98a24', '#7c8a2a', '#1f4d1c', '#2a7a3c', '#176a58', '#3c8a34'], ['#0a1c66', '#2a6bff', '#19c9a8', '#a87c20', '#2a3408', '#04200c', '#083a1c', '#0a4a40', '#083a1c']],
  emas: [['#fff4c8', '#ffd56a', '#e2a93b', '#a8721c'], ['#fff1c0', '#ffc64a', '#d08a1a', '#5a3000']],
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
};

export function createFxAtlas() {
  const data = new Uint8Array(AW * AH * 4);
  const tex = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  // tata letak rak (kiri → kanan, baris baru bila penuh)
  const names = Object.keys(CELLS), rects = [], idx = {};
  { let x = 0, y = 0, rowH = 0;
    for (const n of names) { const [w, h] = CELLS[n]; if (x + w > AW) { x = 0; y += rowH; rowH = 0; } idx[n] = rects.length; rects.push({ n, x, y, w, h, done: false }); x += w; rowH = Math.max(rowH, h); } }
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
  };
  return api;
}
