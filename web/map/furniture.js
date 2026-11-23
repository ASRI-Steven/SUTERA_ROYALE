// Perabot interior realistis (hanya game): model Blender (tools/blender/furniture.py → game/assets/furniture/
// furniture.glb + furniture.json) menggantikan perabot kotak di interiors.js drawFurn.
// - Pustaka: ±50 model (2–3 varian per jenis umum), tiap model punya LOD0 (detail), LOD1 (sederhana) dan kotak proksi
//   (jarak jauh + bayangan matahari). Ukuran acuan model = kotak tabrakan perabot; ukuran lain disesuaikan dengan
//   9-slice di shader (bagian ujung tetap, tengah memanjang), rak toko & gondola = modul 1 m yang diulang.
// - Gambar: InstancedBufferGeometry bersama. LOD0 satu mesh per jenis (varian digabung; bagian varian lain diciutkan di
//   shader), LOD1 satu mesh per kelompok ruang, kaca tembus pandang satu mesh per LOD, semua proksi jauh satu mesh.
//   Instans dekat (≤ 30 m × zoom) dipilah ulang hanya saat kamera pindah/berputar cukup jauh atau interior
//   dibuka/ditutup; proksi jauh tetap di buffer (slot per rumah, didaur ulang) dan disembunyikan di shader bila dekat.
// - Bahan: satu MeshStandardMaterial (warna, kasar, logam, AO, pijar per verteks; serat kayu/kain/marmer dari tiga tekstur
//   detail abu-abu kecil; label barang, buku, karpet, layar dari atlas kanvas tanpa unduhan), pantulan ruangan (RoomEnvironment),
//   bayangan dinamis (R.patch), pencahayaan disamakan dengan interior (lampu ruangan, cahaya sekitar redup).
// Koordinat data: x timur, y utara (m); three.js X = x, Y = atas, Z = −y. Model: X = sumbu a perabot (sepanjang
// dinding), Y = atas, −Z = sumbu b (ke dalam ruang); rotasi instans = f.rot (sama dengan drawFurn).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ASSET = 'game/assets/furniture/';
const R0 = 9, R1 = 30; // LOD0 sampai R0 m, LOD1 sampai R1 m (dikali zoom kamera); di luar itu kotak proksi
// jenis permukaan per verteks (atribut fx: kode + 16 × slot warna instans)
const C = { PLAIN: 0, WOOD: 1, FAB: 2, LEATHER: 3, STONE: 4, LEAF: 5, GOODS: 6, BOOKS: 7, RUG: 8, ROWS: 9, MISC: 10, PAT: 11, PAINTW: 12, STONE2: 13, TERRAZZO: 14 };
// atlas kanvas 2048² (sama dengan konstanta GLSL di bawah)
const AT = 2048;
const L = {
  goods: { x: 0, y: 0, w: 128, h: 128, cols: 8, n: 64 },
  books: { x: 1024, y: 0, w: 32, h: 256, cols: 32, n: 48 },
  rug: { x: 1024, y: 512, w: 340, h: 256, cols: 3, n: 6 },
  rows: { x: 0, y: 1024, w: 1024, h: 64, cols: 1, n: 8 },
  pat: { x: 0, y: 1536, w: 128, h: 128, cols: 8, n: 8 },
  misc: { x: 1024, y: 1024, w: 256, h: 256, cols: 4, n: 16 },
};
// sel tetap atlas misc (= tools/blender/furniture.py MISC)
const MISC = { tv: 0, tv_on: 1, laptop: 2, pos: 3, menu: 4, cooler: 5, kiosk_a: 6, kiosk_b: 7, mag_a: 8, mag_b: 9, art: 10, clock: 11, lift: 12, lobby: 13, calendar: 14, cake: 15 };
// kelompok mesh LOD1 per model (bawaan: kelompok ruang di manifest); jenis yang banyak instansnya punya mesh sendiri
const LOD1_KIND = { rack: 'rack', gondola: 'gondola', column: 'column', table: 'table', officedesk: 'officedesk' };
// palet warna instans (sRGB): slot 1 = kain/kulit utama, slot 2 = aksen (bantal hias, selimut lipat)
const PAL = {
  sofa: ['#6b7b8f', '#8a8f86', '#b9a68a', '#3f4a5c', '#7a5547', '#5d6b55', '#a9a39a', '#33373d', '#9c6b4e'],
  leather: ['#6a4430', '#4a3a32', '#8a5a3c', '#55585e', '#9a7a5c', '#3e3430'],
  bed: ['#5d6f8a', '#c9b48e', '#7a8a78', '#8a5a5a', '#d8d2c6', '#4a5568', '#b98a6a'],
  chair: ['#3a4048', '#8a7a64', '#5e6e5a', '#a5675a', '#d0c4ae', '#2f4f6f'],
  accent: ['#d29f52', '#c96a4a', '#4f7a8a', '#e3d3b4', '#8a5a8a', '#6a8a5a', '#d9b84a', '#b04a4a'],
  goods: ['#d8453a', '#3f7fd6', '#3aa36b', '#f0b429', '#8e5bd6', '#ececec'],
};

export async function loadFurniture() {
  const j = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' HTTP ' + r.status); return r.json(); });
  const tex = (k) => new Promise((res, rej) => new THREE.TextureLoader().load(ASSET + 'detail_' + k + '.jpg', res, undefined, () => rej(new Error('detail_' + k + '.jpg'))));
  const [man, gltf, wood, fabric, marble] = await Promise.all([j(ASSET + 'furniture.json'), new GLTFLoader().loadAsync(ASSET + 'furniture.glb'), tex('wood'), tex('fabric'), tex('marble')]);
  return { man, gltf, detail: { wood, fabric, marble } };
}

const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const rgbNum = (hex) => parseInt(hex.slice(1), 16); // sRGB 24 bit → float (tepat di float32)
function pip(x, y, p) { let ins = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }

// ---------------------------------------------------------------- atlas kanvas (merek & tulisan fiktif)
const WORDS = ['KRIUK', 'SEGAR', 'MANTAP', 'CERIA', 'NUSA', 'JAYA', 'PELANGI', 'MERPATI', 'SUTERA', 'WANGI', 'LEZAT', 'RENYAH', 'SEHAT', 'BINTANG', 'MELATI', 'SAMUDRA'];
const ITEMS = ['Keripik', 'Mi Goreng', 'Teh', 'Kopi', 'Susu', 'Sabun', 'Sampo', 'Biskuit', 'Wafer', 'Air', 'Jus', 'Saus', 'Kecap', 'Gula', 'Beras', 'Deterjen'];
function drawAtlas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = AT;
  const g = cv.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, AT, AT);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const F = (w, s) => `${w} ${s}px Arial, Helvetica, sans-serif`;
  const text = (t, x, y, size, col, w = '800', maxW = 9999, align = 'center') => { let s = size; g.font = F(w, s); while (s > 6 && g.measureText(t).width > maxW) { s -= 1; g.font = F(w, s); } g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  const cell = (Lg, k) => [Lg.x + (k % Lg.cols) * Lg.w, Lg.y + Math.floor(k / Lg.cols) * Lg.h, Lg.w, Lg.h];
  const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
  // --- label barang: latar warna merek, pita, nama fiktif, gambar sederhana
  const labels = [];
  for (let k = 0; k < L.goods.n; k++) {
    const [x, y, w, h] = cell(L.goods, k), hue = Math.floor(rnd() * 360), dark = rnd() < 0.3;
    const bg = dark ? hsl(hue, 40, 22) : hsl(hue, 52 + rnd() * 14, 44 + rnd() * 14), fg = dark ? '#f2e6c8' : '#ffffff';
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.fillStyle = hsl((hue + 40) % 360, 60, dark ? 45 : 85); g.fillRect(x, y + h * 0.62, w, h * 0.14);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(x + w * 0.72, y + h * 0.36, w * 0.24, 0, Math.PI * 2); g.fill();
    if (rnd() < 0.5) { g.fillStyle = hsl((hue + 180) % 360, 70, 55); g.beginPath(); g.ellipse(x + w * 0.5, y + h * 0.85, w * 0.22, h * 0.08, 0, 0, Math.PI * 2); g.fill(); }
    const word = pick(WORDS), item = pick(ITEMS);
    text(word, x + w / 2, y + h * 0.22, 26, fg, '900', w - 10);
    text(item, x + w / 2, y + h * 0.44, 17, fg, '700', w - 12);
    text(['250 g', '1 L', '600 ml', '75 g', '1 kg', '400 ml'][k % 6], x + w / 2, y + h * 0.69, 13, dark ? '#fff' : '#222', '700', w - 10);
    labels.push(bg);
  }
  // --- punggung buku: warna kain/kertas, garis emas, judul tegak
  for (let k = 0; k < L.books.n; k++) {
    const [x, y, w, h] = cell(L.books, k), hue = Math.floor(rnd() * 360);
    g.fillStyle = hsl(hue, 25 + rnd() * 45, 18 + rnd() * 45); g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y, 3, h); g.fillRect(x + w - 3, y, 3, h);
    g.fillStyle = rnd() < 0.5 ? '#d8b56a' : '#efe8d8';
    for (const yy of [0.08, 0.86]) g.fillRect(x + 4, y + h * yy, w - 8, 3);
    g.save(); g.translate(x + w / 2, y + h * 0.48); g.rotate(-Math.PI / 2);
    text(pick(WORDS) + ' ' + pick(['KISAH', 'RESEP', 'SEJARAH', 'PUISI', 'ILMU', 'NOVEL']), 0, 0, 13, '#f4ecd8', '700', h * 0.62);
    g.restore();
  }
  // --- karpet: 6 motif kusam (oriental bermedali, kilim, garis modern, polos berbulu, teralis Maroko, abstrak lembut)
  const rugCols = [['#6e2f2a', '#c9b48e', '#2e3a4e', '#8a5a3a'], ['#3a4a5a', '#d6ccb4', '#7a3a2e', '#a58a5a'], ['#8a8276', '#d8d2c4', '#5a554c', '#b5ab98'],
    ['#b8a68a', '#d6c8ae', '#9a8a70', '#c9b89c'], ['#e2d8c4', '#6a5a48', '#b8aa90', '#8a7a64'], ['#5a6a6a', '#c8c0aa', '#9a7a5a', '#3e4a4e']];
  for (let k = 0; k < L.rug.n; k++) {
    const [x, y, w, h] = cell(L.rug, k), [a, b, c, d] = rugCols[k];
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = a; g.fillRect(x, y, w, h);
    if (k === 0) { // oriental: pita tepi bermotif + medali tengah
      for (const [o, col, lw] of [[10, b, 7], [22, c, 10], [36, b, 3]]) { g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(x + o, y + o, w - 2 * o, h - 2 * o); }
      g.fillStyle = b; for (let i = 0; i < 18; i++) { const t = i / 18; for (const [px, py] of [[x + 22 + t * (w - 44), y + 22], [x + 22 + t * (w - 44), y + h - 22]]) { g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill(); } }
      g.fillStyle = c; g.beginPath(); g.moveTo(x + w / 2, y + h * 0.22); g.lineTo(x + w * 0.72, y + h / 2); g.lineTo(x + w / 2, y + h * 0.78); g.lineTo(x + w * 0.28, y + h / 2); g.fill();
      g.fillStyle = d; g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * 0.1, h * 0.12, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = b; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * (0.13 + i * 0.03), h * (0.15 + i * 0.03), 0, 0, Math.PI * 2); g.stroke(); }
    } else if (k === 1) { // kilim: pita mendatar berisi wajik
      for (let i = 0; i < 7; i++) { const yy = y + 14 + i * (h - 28) / 7, hh = (h - 28) / 7; g.fillStyle = i % 2 ? b : a; g.fillRect(x + 8, yy, w - 16, hh); g.fillStyle = i % 2 ? c : d; for (let j = 0; j < 8; j++) { const cx = x + 26 + j * (w - 52) / 7, cy = yy + hh / 2; g.beginPath(); g.moveTo(cx, cy - hh * 0.38); g.lineTo(cx + 12, cy); g.lineTo(cx, cy + hh * 0.38); g.lineTo(cx - 12, cy); g.fill(); } }
    } else if (k === 2) { for (let i = 0; i < 9; i++) { g.fillStyle = [b, c, d][i % 3]; g.globalAlpha = 0.7; g.fillRect(x + 20 + i * 34, y + 14, 10 + (i % 3) * 6, h - 28); } g.globalAlpha = 1; }
    else if (k === 3) { g.strokeStyle = b; g.lineWidth = 6; g.strokeRect(x + 12, y + 12, w - 24, h - 24); }
    else if (k === 4) { g.strokeStyle = b; g.lineWidth = 3; for (let i = -1; i < 9; i++) for (let j = -1; j < 7; j++) { const cx = x + i * 40 + (j % 2) * 20, cy = y + j * 40; g.beginPath(); g.moveTo(cx, cy - 16); g.quadraticCurveTo(cx + 20, cy - 16, cx + 20, cy); g.quadraticCurveTo(cx + 20, cy + 16, cx, cy + 16); g.quadraticCurveTo(cx - 20, cy + 16, cx - 20, cy); g.quadraticCurveTo(cx - 20, cy - 16, cx, cy - 16); g.stroke(); } }
    else { for (let i = 0; i < 7; i++) { g.fillStyle = [b, c, d][i % 3]; g.globalAlpha = 0.35; g.beginPath(); g.ellipse(x + rnd() * w, y + rnd() * h, 40 + rnd() * 70, 25 + rnd() * 40, rnd() * 3, 0, Math.PI * 2); g.fill(); } g.globalAlpha = 1; }
    // serat & bulu halus
    for (let i = 0; i < 1400; i++) { g.globalAlpha = 0.06 + rnd() * 0.06; g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 2, 1); }
    g.globalAlpha = 1;
    g.restore();
  }
  // --- deret barang di rak (LOD1 & proksi jauh): kemasan mini dari warna label
  for (let k = 0; k < L.rows.n; k++) {
    const [x, y, w, h] = cell(L.rows, k);
    g.fillStyle = k === 7 ? '#3a2e26' : '#d8d4cc'; g.fillRect(x, y, w, h);
    let xx = x + 2;
    while (xx < x + w - 4) {
      if (k === 7) { const bw = 6 + rnd() * 10; g.fillStyle = hsl(Math.floor(rnd() * 360), 30 + rnd() * 40, 20 + rnd() * 40); g.fillRect(xx, y + h * (0.15 + rnd() * 0.2), bw, h); xx += bw + 1; continue; } // buku
      const bw = k === 1 ? 14 + rnd() * 6 : 14 + rnd() * 26, top = y + h * (k === 1 ? 0.1 : 0.12 + rnd() * 0.35);
      g.fillStyle = labels[Math.floor(rnd() * labels.length)];
      if (k === 1) { g.fillRect(xx, top + 10, bw, y + h - top - 10); g.fillRect(xx + bw * 0.3, top, bw * 0.4, 12); } // botol
      else g.fillRect(xx, top, bw, y + h - top);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(xx + 2, top + (y + h - top) * 0.35, bw - 4, 4);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(xx + bw - 2, top, 2, y + h - top);
      xx += bw + 2;
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + h - 3, w, 3);
  }
  // --- motif kain (dikali warna instans): kawung, parang, garis, kotak, bunga, titik, wajik, polos bertekstur
  for (let k = 0; k < L.pat.n; k++) {
    const [x, y, w, h] = cell(L.pat, k);
    g.fillStyle = '#f2ece0'; g.fillRect(x, y, w, h);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = g.strokeStyle = '#6a5a48';
    if (k === 0) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const cx = x + 16 + i * 32, cy = y + 16 + j * 32; for (let a = 0; a < 4; a++) { g.beginPath(); g.ellipse(cx + Math.cos(a * Math.PI / 2) * 8, cy + Math.sin(a * Math.PI / 2) * 8, 7, 4, a * Math.PI / 2, 0, Math.PI * 2); g.fill(); } }
    else if (k === 1) { g.lineWidth = 7; for (let i = -4; i < 8; i++) { g.beginPath(); g.moveTo(x + i * 24, y); g.lineTo(x + i * 24 + h, y + h); g.stroke(); } }
    else if (k === 2) for (let i = 0; i < 8; i++) { g.fillRect(x, y + i * 16, w, 5); }
    else if (k === 3) { g.globalAlpha = 0.6; for (let i = 0; i < 4; i++) { g.fillRect(x + i * 32, y, 14, h); g.fillRect(x, y + i * 32, w, 14); } g.globalAlpha = 1; }
    else if (k === 4) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const cx = x + 22 + i * 42, cy = y + 22 + j * 42; for (let a = 0; a < 5; a++) { g.beginPath(); g.arc(cx + Math.cos(a * 1.257) * 7, cy + Math.sin(a * 1.257) * 7, 6, 0, Math.PI * 2); g.fill(); } }
    else if (k === 5) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { g.beginPath(); g.arc(x + 11 + i * 21 + (j % 2) * 10, y + 11 + j * 21, 4, 0, Math.PI * 2); g.fill(); }
    else if (k === 6) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const cx = x + 16 + i * 32, cy = y + 16 + j * 32; g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx + 13, cy); g.lineTo(cx, cy + 13); g.lineTo(cx - 13, cy); g.closePath(); g.lineWidth = 3; g.stroke(); }
    else { g.globalAlpha = 0.25; for (let i = 0; i < 300; i++) g.fillRect(x + rnd() * w, y + rnd() * h, 2, 2); g.globalAlpha = 1; }
    g.restore();
  }
  // --- sel misc
  const M = (k) => cell(L.misc, MISC[k]);
  { const [x, y, w, h] = M('tv'); const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, '#15171b'); gr.addColorStop(0.45, '#08090b'); gr.addColorStop(1, '#101215'); g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.2, y + h); g.lineTo(x, y + h); g.fill(); }
  { const [x, y, w, h] = M('tv_on'); const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, '#5aa7e8'); gr.addColorStop(0.55, '#bfe3f6'); gr.addColorStop(0.56, '#3e7a3a'); gr.addColorStop(1, '#2a4a24'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = '#6a7d8f'; g.beginPath(); g.moveTo(x, y + h * 0.56); g.lineTo(x + w * 0.3, y + h * 0.3); g.lineTo(x + w * 0.55, y + h * 0.56); g.fill(); g.fillStyle = '#7b8c9c'; g.beginPath(); g.moveTo(x + w * 0.35, y + h * 0.56); g.lineTo(x + w * 0.7, y + h * 0.22); g.lineTo(x + w, y + h * 0.56); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y + h * 0.82, w, h * 0.12); text('SUTERA TV  •  Jelajah Nusantara', x + w / 2, y + h * 0.88, 13, '#fff', '700', w - 10); g.fillStyle = '#d29f52'; g.fillRect(x + w - 40, y + 8, 32, 16); }
  { const [x, y, w, h] = M('laptop'); g.fillStyle = '#2b5c8a'; g.fillRect(x, y, w, h); g.fillStyle = '#e8eef4'; g.fillRect(x + 20, y + 26, w * 0.62, h * 0.55); g.fillStyle = '#3d3782'; g.fillRect(x + 20, y + 26, w * 0.62, 14); g.fillStyle = '#9aa8b5'; for (let i = 0; i < 6; i++) g.fillRect(x + 30, y + 52 + i * 14, w * 0.5 - i * 8, 5); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x, y + h - 18, w, 18); }
  { const [x, y, w, h] = M('pos'); g.fillStyle = '#16324a'; g.fillRect(x, y, w, h); g.fillStyle = '#d29f52'; g.fillRect(x, y, w, 26); text('KASIR', x + 40, y + 13, 14, '#1b1b1b', '900'); for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { g.fillStyle = hsl(200 + i * 30, 50, 40 + j * 5); g.fillRect(x + 12 + i * 60, y + 40 + j * 46, 52, 38); } g.fillStyle = '#e8f0f6'; g.fillRect(x + 196, y + 40, 50, 190); }
  { const [x, y, w, h] = M('menu'); g.fillStyle = '#1f2321'; g.fillRect(x, y, w, h); g.strokeStyle = '#b58a52'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, w - 6, h - 6); text('MENU', x + w / 2, y + 26, 24, '#f2ead8', '900');
    [['Kopi Susu', '18'], ['Es Kopi Aren', '22'], ['Teh Tarik', '15'], ['Cokelat', '20'], ['Roti Bakar', '16'], ['Pisang Goreng', '12']].forEach(([a, b], i) => { text(a, x + 18, y + 62 + i * 30, 15, '#efe6d2', '600', 150, 'left'); text(b + 'K', x + w - 18, y + 62 + i * 30, 15, '#e8c46a', '800', 60, 'right'); }); }
  { const [x, y, w, h] = M('cooler'); g.fillStyle = '#dfe9ef'; g.fillRect(x, y, w, h); for (let r = 0; r < 4; r++) { let xx = x + 3; while (xx < x + w - 10) { const bw = 12 + rnd() * 6; g.fillStyle = labels[Math.floor(rnd() * labels.length)]; g.fillRect(xx, y + r * 64 + 18, bw, 44); g.fillRect(xx + bw * 0.3, y + r * 64 + 8, bw * 0.4, 12); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(xx + 2, y + r * 64 + 24, 3, 32); xx += bw + 3; } g.fillStyle = '#b8c2c8'; g.fillRect(x, y + r * 64 + 61, w, 3); } }
  { const [x, y, w, h] = M('kiosk_a'); const gr = g.createLinearGradient(x, y, x + w, y); gr.addColorStop(0, '#3d3782'); gr.addColorStop(1, '#5a4fc0'); g.fillStyle = gr; g.fillRect(x, y, w, h); text('SINYAL+', x + w / 2, y + h * 0.4, 60, '#ffffff', '900', w - 16); text('Aksesoris · Servis', x + w / 2, y + h * 0.7, 26, '#d29f52', '700', w - 16); }
  { const [x, y, w, h] = M('kiosk_b'); const gr = g.createLinearGradient(x, y, x + w, y); gr.addColorStop(0, '#7a3b1e'); gr.addColorStop(1, '#b8642e'); g.fillStyle = gr; g.fillRect(x, y, w, h); text('TEH TARIK', x + w / 2, y + h * 0.38, 46, '#fff4dc', '900', w - 16); text('SUTERA', x + w / 2, y + h * 0.68, 40, '#f0c46a', '900', w - 16); }
  for (const [k, hue, t1, t2] of [['mag_a', 205, 'RUMAH', 'Inspirasi Tropis'], ['mag_b', 12, 'GAYA', 'Edisi Lebaran']]) { const [x, y, w, h] = M(k); g.fillStyle = hsl(hue, 45, 70); g.fillRect(x, y, w, h); g.fillStyle = hsl(hue, 30, 40); g.beginPath(); g.ellipse(x + w / 2, y + h * 0.62, w * 0.28, h * 0.3, 0, 0, Math.PI * 2); g.fill(); text(t1, x + w / 2, y + 34, 42, '#fff', '900', w - 16); text(t2, x + w / 2, y + h - 22, 18, '#fff', '700', w - 16); }
  { const [x, y, w, h] = M('art'); const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, '#f2c88a'); gr.addColorStop(1, '#d97a4a'); g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = '#2f4a5a'; g.beginPath(); g.moveTo(x, y + h * 0.72); g.quadraticCurveTo(x + w * 0.4, y + h * 0.45, x + w, y + h * 0.7); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.fill(); g.fillStyle = '#fff4d8'; g.beginPath(); g.arc(x + w * 0.66, y + h * 0.36, 26, 0, Math.PI * 2); g.fill(); }
  { const [x, y, w, h] = M('clock'); g.fillStyle = '#f4f2ec'; g.fillRect(x, y, w, h); g.strokeStyle = '#222'; g.lineWidth = 6; g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.44, 0, Math.PI * 2); g.stroke(); for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.fillStyle = '#222'; g.fillRect(x + w / 2 + Math.cos(a) * w * 0.36 - 3, y + h / 2 + Math.sin(a) * h * 0.36 - 3, 6, 6); } g.lineWidth = 8; g.beginPath(); g.moveTo(x + w / 2, y + h / 2); g.lineTo(x + w / 2 + 40, y + h / 2 - 30); g.stroke(); g.lineWidth = 5; g.beginPath(); g.moveTo(x + w / 2, y + h / 2); g.lineTo(x + w / 2 - 20, y + h / 2 + 80); g.stroke(); }
  { const [x, y, w, h] = M('lift'); g.fillStyle = '#060606'; g.fillRect(x, y, w, h); text('▲ 1', x + w / 2, y + h / 2, 110, '#ff3a22', '900', w - 20); }
  { const [x, y, w, h] = M('lobby'); g.fillStyle = '#3a3a3a'; g.fillRect(x, y, w, h); text('SUTERA', x + w / 2, y + h * 0.42, 56, '#d29f52', '900', w - 20); text('TOWER', x + w / 2, y + h * 0.7, 34, '#e8e2d4', '700', w - 20); }
  { const [x, y, w, h] = M('calendar'); g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h); g.fillStyle = '#c0392b'; g.fillRect(x, y, w, 50); text('NOVEMBER', x + w / 2, y + 25, 28, '#fff', '900'); g.fillStyle = '#555'; for (let i = 0; i < 5; i++) for (let j = 0; j < 7; j++) { g.fillStyle = j === 0 ? '#c0392b' : '#555'; g.fillRect(x + 12 + j * 34, y + 66 + i * 36, 20, 16); } }
  { const [x, y, w, h] = M('cake'); g.fillStyle = '#f5e04a'; g.fillRect(x, y, w, h); text('PROMO', x + w / 2, y + 60, 54, '#c0392b', '900', w - 16); text('BELI 2', x + w / 2, y + 130, 40, '#1b1b1b', '900', w - 16); text('GRATIS 1', x + w / 2, y + 185, 40, '#1b1b1b', '900', w - 16); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------- model dari GLB
function codeOf(name) {
  const n = name.replace(/\.\d+$/, '');
  if (n === 'wood_white') return C.PAINTW;
  if (n.startsWith('wood_')) return C.WOOD;
  if (n === 'tfab_main') return C.FAB + 16;
  if (n === 'tfab_acc') return C.FAB + 32;
  if (n.startsWith('fab_')) return C.FAB;
  if (n === 'tleather') return C.LEATHER + 16;
  if (n.startsWith('leather_')) return C.LEATHER;
  if (n === 'stone_marble') return C.STONE;
  if (n === 'stone_terrazzo') return C.TERRAZZO;
  if (n.startsWith('stone_')) return C.STONE2; // batu abu/gelap: urat samar
  if (n.startsWith('leaf_')) return C.LEAF;
  if (n === 'atlas_goods') return C.GOODS;
  if (n === 'atlas_books') return C.BOOKS;
  if (n === 'atlas_rug') return C.RUG;
  if (n === 'atlas_rows') return C.ROWS;
  if (n === 'atlas_misc' || n === 'atlas_misce') return C.MISC;
  if (n === 'atlas_tpat') return C.PAT + 16;
  return C.PLAIN;
}
const U8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
// satu primitif GLB → geometri dengan atribut seragam: position, normal, color (albedo linear), pbr (AO, kasar, logam,
// pijar/4), fx, fuv; kaca terpisah
function packPrim(mesh, rel) {
  const src = mesh.geometry, mat = mesh.material, name = (mat.name || '').replace(/\.\d+$/, ''), n = src.attributes.position.count;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = src.attributes.position.getX(i); pos[i * 3 + 1] = src.attributes.position.getY(i); pos[i * 3 + 2] = src.attributes.position.getZ(i);
    nor[i * 3] = src.attributes.normal.getX(i); nor[i * 3 + 1] = src.attributes.normal.getY(i); nor[i * 3 + 2] = src.attributes.normal.getZ(i);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const col = new Float32Array(n * 3), pbr = new Uint8Array(n * 4), fx = new Uint8Array(n), uv = new Float32Array(n * 2);
  const c = (mat.color || new THREE.Color(1, 1, 1)), ao = src.attributes.color, su = src.attributes.uv;
  const em = mat.emissive ? Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) * (mat.emissiveIntensity ?? 1) : 0;
  const code = codeOf(name);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    pbr[i * 4] = ao ? U8(ao.getX(i)) : 255; pbr[i * 4 + 1] = U8(mat.roughness ?? 0.6); pbr[i * 4 + 2] = U8(mat.metalness ?? 0); pbr[i * 4 + 3] = U8(Math.min(1, em / 4));
    fx[i] = code;
    if (su) { uv[i * 2] = su.getX(i); uv[i * 2 + 1] = 1 - su.getY(i); } // glTF v terbalik → v Blender
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4, true));
  g.setAttribute('fx', new THREE.BufferAttribute(fx, 1));
  g.setAttribute('fuv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(src.index ? new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1) : null);
  if (!src.index) { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  g.applyMatrix4(rel);
  return { g, glass: name.startsWith('glass_') };
}
// faktor 9-slice per verteks (lihat furniture.py): posisi baru = posisi + sf × (ukuran instans − ukuran acuan)
function sliceFactors(g, size, slice) {
  const [W, D, H] = size, p = g.attributes.position, n = p.count, sf = new Float32Array(n * 3);
  const sx = slice && slice.x, sy = slice && slice.y, sz = slice && slice.z;
  const cen = (v, S, m) => { // sumbu berpusat (−S/2..S/2), m = [margin sisi minus, margin sisi plus]
    if (!m) return v / S;
    if (v < -S / 2 + m[0]) return -0.5;
    if (v > S / 2 - m[1]) return 0.5;
    return (v - (-S / 2 + m[0])) / Math.max(1e-4, S - m[0] - m[1]) - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i);
    sf[i * 3] = cen(X, W, sx);
    sf[i * 3 + 2] = cen(Z, D, sy ? [sy[1], sy[0]] : null); // Z = −b: sisi minus Z = sisi plus b
    if (!sz) sf[i * 3 + 1] = Y / H;
    else sf[i * 3 + 1] = Y < sz[0] ? 0 : Y > H - sz[1] ? 1 : (Y - sz[0]) / Math.max(1e-4, H - sz[0] - sz[1]);
  }
  g.setAttribute('sf', new THREE.BufferAttribute(sf, 3));
}
function parseModels(gltf, man) {
  const out = {}; // nama model → [lod] → { solid, glass }
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = /^(.+)_lod(\d)$/.exec(o.name || '');
    if (!m || !man.models[m[1]] || (!o.isMesh && !o.children.length)) return;
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), solid = [], glass = [];
    o.traverse((x) => {
      if (!x.isMesh) return;
      const p = packPrim(x, new THREE.Matrix4().multiplyMatrices(inv, x.matrixWorld));
      (p.glass ? glass : solid).push(p.g);
    });
    const merge = (list) => (list.length ? (list.length > 1 ? mergeGeometries(list, false) : list[0]) : null);
    const info = man.models[m[1]], L2 = { solid: merge(solid), glass: merge(glass) };
    for (const g of [L2.solid, L2.glass]) if (g) sliceFactors(g, info.size, info.slice);
    (out[m[1]] ||= [])[+m[2]] = L2;
  });
  return out;
}

// ---------------------------------------------------------------- bahan
const GLSL_COMMON = `
vec3 fUnpack(float v) { v = floor(v + 0.5); return pow(vec3(floor(v / 65536.0), mod(floor(v / 256.0), 256.0), mod(v, 256.0)) / 255.0, vec3(2.2)); }
`;
const GLSL_INST = `
attribute vec3 sf;
attribute float part;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
`;
// transformasi instans: 9-slice → putar sumbu Y → geser; bagian varian lain diciutkan ke satu titik
const VS_NORMAL = `
  float fCs = cos(iA.w), fSn = sin(iA.w);
  objectNormal = vec3(fCs * objectNormal.x + fSn * objectNormal.z, objectNormal.y, -fSn * objectNormal.x + fCs * objectNormal.z);`;
const VS_POS = `
  vec3 transformed = position + sf * iB.xyz;
  transformed = vec3(fCs * transformed.x + fSn * transformed.z, transformed.y, -fSn * transformed.x + fCs * transformed.z) + iA.xyz;
  if (abs(part - iB.w) > 0.5) transformed = iA.xyz;`;
function atlasGLSL() {
  const g = (k) => { const a = L[k]; return `vec4(${a.x}.0, ${a.y}.0, ${a.w}.0, ${a.h}.0), ${a.cols}.0`; };
  return `
vec2 fCell(vec4 r, float cols, float cell, vec2 l) {
  l = clamp(l, 0.015, 0.985);
  vec2 px = r.xy + (vec2(mod(cell, cols), floor(cell / cols)) + vec2(l.x, 1.0 - l.y)) * r.zw;
  return vec2(px.x, ${AT}.0 - px.y) / ${AT}.0;
}
// muka atlas: kode → (uv atlas, nyala?)
vec2 fAtlas(float code, vec2 uv, float seed, out float lit) {
  lit = 0.0;
  float cell = floor(uv.x), lx = fract(uv.x);
  vec2 l = vec2(lx, uv.y);
  if (code < 6.5) return fCell(${g('goods')}, mod(cell + floor(seed * 64.0) * 9.0, ${L.goods.n}.0), l);
  if (code < 7.5) return fCell(${g('books')}, mod(cell + floor(seed * 48.0), ${L.books.n}.0), l);
  if (code < 8.5) return fCell(${g('rug')}, floor(seed * ${L.rug.n}.0), l);
  if (code < 9.5) return fCell(${g('rows')}, cell, l);
  if (code < 10.5) {
    if (cell < 0.5 && fract(seed * 7.31) < 0.3) { cell = 1.0; lit = 1.0; } // sebagian TV menyala
    return fCell(${g('misc')}, cell, l);
  }
  return fCell(${g('pat')}, mod(floor(seed * 8.0), ${L.pat.n}.0), fract(uv)); // motif kain berulang
}`;
}
const FS_SURF = `
  {
    float code = mod(vFx, 16.0), ts = floor(vFx / 16.0 + 0.01);
    vec3 tint = ts > 1.5 ? vT2 : (ts > 0.5 ? vT1 : vec3(1.0));
    diffuseColor.rgb *= tint;
    fRough = vPbr.y; fMetal = vPbr.z; fEmis = vPbr.w * 4.0; fLit = 0.0;
    if (code > 12.5) { // batu abu (urat samar) / terazo (bintik dari tenunan diperkecil)
      if (code < 13.5) { float d = texture2D(tStone, vFuv / 2.2).r / max(textureLod(tStone, vec2(0.5), 12.0).r, 0.05); diffuseColor.rgb *= mix(1.0, clamp(d, 0.7, 1.15), 0.4); }
      else { float d = texture2D(tFab, vFuv / 0.11).r / max(textureLod(tFab, vec2(0.5), 12.0).r, 0.05); diffuseColor.rgb *= mix(1.0, clamp(d * d, 0.5, 1.6), 0.45); }
    } else if (code > 0.5 && code < 4.5 || code > 11.5) { // detail abu-abu dinormalkan terhadap rata-ratanya (mip terkecil)
      if (code < 1.5 || code > 11.5) { float d = texture2D(tWood, vFuv / 0.9).r / max(textureLod(tWood, vec2(0.5), 12.0).r, 0.05); diffuseColor.rgb *= mix(1.0, clamp(d, 0.4, 1.6), code > 11.5 ? 0.15 : 0.8); fRough *= mix(1.0, 1.2 - 0.25 * d, 0.5); }
      else if (code < 2.5) { float d = texture2D(tFab, vFuv / 0.32).r / max(textureLod(tFab, vec2(0.5), 12.0).r, 0.05); diffuseColor.rgb *= mix(1.0, clamp(d, 0.5, 1.5), 0.6); }
      else if (code < 3.5) { float d = texture2D(tFab, vFuv / 0.06).r / max(textureLod(tFab, vec2(0.5), 12.0).r, 0.05); diffuseColor.rgb *= mix(1.0, clamp(d, 0.6, 1.4), 0.2); fRough *= mix(0.85, 1.15, clamp(d - 0.5, 0.0, 1.0)); }
      else { float d = texture2D(tStone, vFuv / 1.6).r / max(textureLod(tStone, vec2(0.5), 12.0).r, 0.05); diffuseColor.rgb *= mix(1.0, clamp(d, 0.55, 1.25), 0.5); }
    } else if (code > 5.5) {
      vec2 auv = fAtlas(code, vFuv, vSeed, fLit);
      vec3 tc = texture2D(tAtlas, auv).rgb;
      diffuseColor.rgb *= tc;
      if (fEmis > 0.01 || fLit > 0.5) { fEmis = max(fEmis, 1.2); fLit = 1.0; }
    } else if (code > 4.5) { // daun: variasi rona antar-daun (posisi)
      diffuseColor.rgb *= 0.85 + 0.3 * fract(sin(dot(floor(vFuv * 3.0), vec2(12.9898, 78.233))) * 43758.5);
    }
  }`;
// pencahayaan interior (sama dengan interiors.js): lampu ruangan (pijar ∝ albedo), cahaya sekitar redup, AO terpanggang
function lightGLSL(real) {
  const kE = real ? '0.11' : '0.62', kD = real ? '1.0' : '0.12', kI = real ? '0.5' : '1.0';
  return {
    emis: `
  {
    float ao = vPbr.x;
    totalEmissiveRadiance += diffuseColor.rgb * ${kE} * ao;
    if (fEmis > 0.01) totalEmissiveRadiance += (fLit > 0.5 ? diffuseColor.rgb : diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.02))) * fEmis;
  }`,
    end: `
  {
    float ao = vPbr.x;
    reflectedLight.directDiffuse *= ${kD} * mix(1.0, ao, 0.35);
    reflectedLight.directSpecular *= ${kD} * mix(1.0, ao, 0.35);
    reflectedLight.indirectDiffuse *= ${kI} * ao;
    reflectedLight.indirectSpecular *= ao * ao * (1.0 + 1.6 * fMetal);
  }`,
  };
}
function furnMaterial(R, env, detail, atlas, real, glass) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMap: env, envMapIntensity: glass ? 1.0 : 0.7 });
  if (glass) Object.assign(m, { transparent: true, depthWrite: false, opacity: 1 });
  const U = { tWood: { value: detail.wood }, tFab: { value: detail.fabric }, tStone: { value: detail.marble }, tAtlas: { value: atlas } }, LG = lightGLSL(real);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = GLSL_INST + 'attribute vec4 pbr;\nattribute float fx;\nattribute vec2 fuv;\nvarying vec4 vPbr;\nvarying float vFx;\nvarying vec2 vFuv;\nvarying vec3 vT1;\nvarying vec3 vT2;\nvarying float vSeed;\n' + GLSL_COMMON + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>' + VS_NORMAL + '\n  vPbr = pbr; vFx = fx; vFuv = fuv; vT1 = fUnpack(iC.x); vT2 = fUnpack(iC.y); vSeed = iC.z;')
      .replace('#include <begin_vertex>', VS_POS);
    sh.fragmentShader = 'uniform sampler2D tWood, tFab, tStone, tAtlas;\nvarying vec4 vPbr;\nvarying float vFx;\nvarying vec2 vFuv;\nvarying vec3 vT1;\nvarying vec3 vT2;\nvarying float vSeed;\nfloat fRough, fMetal, fEmis, fLit;\n' + atlasGLSL() + '\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>' + FS_SURF)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(fRough, 0.03, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + LG.emis)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + LG.end);
    if (glass) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
  { float fr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0); diffuseColor.a = clamp(0.16 + 0.55 * fr, 0.0, 0.8); }
  #include <opaque_fragment>`);
  };
  if (R) R.patch(m, { dyn: true });
  const pk = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => 'furn1' + (glass ? 'g' : '') + (real ? 'r' : '') + pk();
  return m;
}
// kotak proksi jauh: kubus satuan, warna/kasar per instans, gambar atlas di muka depan (rak, TV, karpet)
function boxMaterial(R, atlas, real, U) {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const LG = lightGLSL(real);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tAtlas = { value: atlas }; sh.uniforms.uNear = U.near; sh.uniforms.uCam = U.cam;
    sh.vertexShader = 'attribute vec4 iA;\nattribute vec4 iB;\nattribute vec4 iC;\nattribute vec4 iD;\nuniform float uNear;\nuniform vec3 uCam;\nvarying vec4 vPbr;\nvarying vec3 vBC;\nvarying vec2 vBUv;\nvarying float vCell;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  float fCs = cos(iA.w), fSn = sin(iA.w);
  vec3 bn = objectNormal;
  objectNormal = vec3(fCs * bn.x + fSn * bn.z, bn.y, -fSn * bn.x + fCs * bn.z);
  vPbr = vec4(1.0, iD.w, 0.0, 0.0); vBC = iC.rgb;
  float face = iC.w; vCell = -1.0;
  if (iB.w >= 0.0 && ((face > 2.5 && bn.y > 0.5) || (face > 0.5 && face < 2.5 && bn.z < -0.5) || (face > 1.5 && face < 2.5 && bn.z > 0.5))) vCell = iB.w;
  vBUv = abs(bn.y) > 0.5 ? vec2(position.x, -position.z) + 0.5 : vec2(bn.z < 0.0 ? position.x : -position.x, position.y) + 0.5;`)
      .replace('#include <begin_vertex>', `
  vec3 transformed = position * iB.xyz;
  transformed.y += iB.y * 0.5;
  transformed = vec3(fCs * transformed.x + fSn * transformed.z, transformed.y, -fSn * transformed.x + fCs * transformed.z) + iA.xyz;
  if (distance(iD.xyz, uCam) < uNear) transformed = iA.xyz; // dekat: digambar model LOD0/LOD1`);
    sh.fragmentShader = 'uniform sampler2D tAtlas;\nvarying vec4 vPbr;\nvarying vec3 vBC;\nvarying vec2 vBUv;\nvarying float vCell;\nfloat fRough, fMetal, fEmis, fLit;\n' + atlasGLSL() + '\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb = vBC; fRough = vPbr.y; fMetal = 0.0; fEmis = 0.0; fLit = 0.0;
  if (vCell >= 0.0) {
    vec2 auv = vCell < 99.5 ? fCell(vec4(${L.rows.x}.0, ${L.rows.y}.0, ${L.rows.w}.0, ${L.rows.h}.0), 1.0, vCell, vBUv)
      : vCell < 199.5 ? fCell(vec4(${L.misc.x}.0, ${L.misc.y}.0, ${L.misc.w}.0, ${L.misc.h}.0), ${L.misc.cols}.0, vCell - 100.0, vBUv)
      : fCell(vec4(${L.rug.x}.0, ${L.rug.y}.0, ${L.rug.w}.0, ${L.rug.h}.0), ${L.rug.cols}.0, mod(vCell - 200.0, ${L.rug.n}.0), vBUv);
    diffuseColor.rgb = texture2D(tAtlas, auv).rgb * 0.9;
  }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(fRough, 0.05, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + LG.emis)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + LG.end);
  };
  m.customProgramCacheKey = () => 'furnbox1' + (real ? 'r' : '');
  return m;
}
// bahan kedalaman (bayangan matahari): instans digeser seperti bahan utama; kotak proksi selalu membayang (sedikit
// dikecilkan supaya tidak membayangi permukaan model detailnya sendiri)
function boxDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec4 iA;\nattribute vec4 iB;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
  float fCs = cos(iA.w), fSn = sin(iA.w);
  vec3 transformed = position * max(iB.xyz - 0.06, vec3(0.0));
  transformed.y += iB.y * 0.5;
  transformed = vec3(fCs * transformed.x + fSn * transformed.z, transformed.y, -fSn * transformed.x + fCs * transformed.z) + iA.xyz;`);
  };
  m.customProgramCacheKey = () => 'furnboxdepth1';
  return m;
}

// ---------------------------------------------------------------- pembuat utama
// W: dunia (renderer, scene, real), A: aset loadFurniture(), col: collider (posisi kamera di dalam gedung)
export function createFurniture(W, A, col) {
  if (!A || !A.man || !A.gltf) return null;
  const { scene, renderer } = W, R = W.real, real = !!R;
  const man = A.man, models = parseModels(A.gltf, man);
  const names = Object.keys(man.models).filter((n) => models[n] && models[n][0] && models[n][0].solid);
  if (!names.length) return null;
  const atlas = drawAtlas();
  const detail = A.detail;
  for (const t of Object.values(detail)) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; }
  let env = null;
  if (real) { const pm = new THREE.PMREMGenerator(renderer); env = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture; pm.dispose(); }
  const mat = furnMaterial(R, env, detail, atlas, real, false), glassMat = furnMaterial(R, env, detail, atlas, real, true);
  const UB = { near: { value: R1 }, cam: { value: new THREE.Vector3(1e9, 0, 0) } };
  const boxMat = boxMaterial(R, atlas, real, UB);
  const group = new THREE.Group();
  group.name = 'furniture';
  group.matrixAutoUpdate = false;

  // ---------- model → mesh LOD0 (per jenis), LOD1 (per kelompok), kaca (per LOD)
  const MD = names.map((n, id) => ({ id, name: n, ...man.models[n], has1: !!(models[n][1] && models[n][1].solid) }));
  const byKind = new Map();
  for (const m of MD) (byKind.get(m.kind) || byKind.set(m.kind, []).get(m.kind)).push(m);
  const meshes = [];
  function makeMesh(key, parts, lod, glass) { // parts: [{ md, part }] → InstancedBufferGeometry bersama
    const list = [];
    for (const { md, part } of parts) {
      const Lg = models[md.name][lod] || models[md.name][0], g0 = glass ? Lg.glass : Lg.solid;
      if (!g0) continue;
      const g = g0.clone();
      g.setAttribute('part', new THREE.BufferAttribute(new Uint8Array(g.attributes.position.count).fill(part), 1));
      list.push(g);
    }
    if (!list.length) return null;
    const base = list.length > 1 ? mergeGeometries(list, false) : list[0];
    const M = { key, lod, glass, cap: 0, n: 0, arr: null, geo: null, mesh: null, base, verts: base.attributes.position.count };
    alloc(M, lod === 0 ? 32 : 128);
    meshes.push(M);
    return M;
  }
  function alloc(M, cap) { // (ulang) buat geometri instans dengan kapasitas cap
    const geo = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(M.base.attributes)) geo.setAttribute(k, M.base.attributes[k]);
    geo.setIndex(M.base.index);
    const arr = new Float32Array(cap * 12), ib = new THREE.InstancedInterleavedBuffer(arr, 12, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 4, 8));
    geo.instanceCount = 0;
    if (M.mesh) { M.mesh.geometry.dispose(); M.mesh.geometry = geo; } // atribut dasar ikut diunggah ulang (jarang: kapasitas berlipat)
    else {
      M.mesh = new THREE.Mesh(geo, M.glass ? glassMat : mat);
      M.mesh.name = 'furn_' + M.key + '_lod' + M.lod;
      M.mesh.frustumCulled = false;
      M.mesh.matrixAutoUpdate = false;
      M.mesh.visible = false;
      M.mesh.receiveShadow = true;
      M.mesh.renderOrder = M.glass ? 2 : 0;
      group.add(M.mesh);
    }
    if (M.arr) arr.set(M.arr.subarray(0, Math.min(M.arr.length, arr.length)));
    M.geo = geo; M.arr = arr; M.ib = ib; M.cap = cap;
  }
  // mesh tiap model: LOD0 = jenis, LOD1 = kelompok (jenis padat sendiri), kaca = semua model per LOD
  const route = MD.map(() => ({ m0: null, p0: 0, m1: null, p1: 0, g0: null, gp0: 0, g1: null, gp1: 0 }));
  for (const [kind, list] of byKind) {
    const M = makeMesh(kind, list.map((md, i) => ({ md, part: i })), 0, false);
    list.forEach((md, i) => { route[md.id].m0 = M; route[md.id].p0 = i; });
  }
  const g1 = new Map();
  for (const md of MD) { const k = LOD1_KIND[md.kind] || md.group || md.kind; (g1.get(k) || g1.set(k, []).get(k)).push(md); }
  for (const [k, list] of g1) {
    const M = makeMesh(k, list.map((md, i) => ({ md, part: i })), 1, false);
    list.forEach((md, i) => { route[md.id].m1 = M; route[md.id].p1 = i; });
  }
  const withGlass = MD.filter((md) => models[md.name][0].glass);
  if (withGlass.length) {
    const G0 = makeMesh('glass', withGlass.map((md, i) => ({ md, part: i })), 0, true), G1 = makeMesh('glass', withGlass.map((md, i) => ({ md, part: i })), 1, true);
    withGlass.forEach((md, i) => { Object.assign(route[md.id], { g0: G0, gp0: i, g1: G1 || G0, gp1: i }); });
  }

  // ---------- kotak proksi jauh: satu mesh, slot per rekaman (potongan CH kotak). Potongan terendah dipakai dulu dan
  //            potongan bebas di puncak dilepas, jadi jumlah kotak yang digambar (top × CH) ikut turun saat rumah ditutup.
  const CH = 16;
  const box = { cap: 0, arr: null, geo: null, mesh: null, free: new Set(), top: 0 };
  const cube = new THREE.BoxGeometry(1, 1, 1);
  function boxAlloc(cap) {
    const geo = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, cube.attributes[k]);
    geo.setIndex(cube.index);
    const arr = new Float32Array(cap * 16), ib = new THREE.InstancedInterleavedBuffer(arr, 16, 1).setUsage(THREE.DynamicDrawUsage);
    for (const [k, o] of [['iA', 0], ['iB', 4], ['iC', 8], ['iD', 12]]) geo.setAttribute(k, new THREE.InterleavedBufferAttribute(ib, 4, o));
    if (box.arr) arr.set(box.arr);
    geo.instanceCount = box.top * CH;
    if (box.mesh) { box.mesh.geometry.dispose(); box.mesh.geometry = geo; }
    else {
      box.mesh = new THREE.Mesh(geo, boxMat);
      box.mesh.name = 'furn_proxy';
      box.mesh.frustumCulled = false;
      box.mesh.matrixAutoUpdate = false;
      box.mesh.castShadow = true; // bayangan matahari semua perabot = kotak proksi (peta bayangan ±11 cm/texel)
      box.mesh.receiveShadow = true;
      box.mesh.customDepthMaterial = boxDepthMaterial();
      group.add(box.mesh);
    }
    ib.needsUpdate = true;
    box.cap = cap; box.arr = arr; box.ib = ib; box.geo = geo;
  }
  boxAlloc(CH * 1024);
  const chunkGet = () => {
    if (box.free.size) { let m = Infinity; for (const c of box.free) if (c < m) m = c; box.free.delete(m); return m; }
    if ((box.top + 1) * CH > box.cap) boxAlloc(box.cap * 2);
    return box.top++;
  };
  const chunkPut = (c) => { box.free.add(c); while (box.top > 0 && box.free.has(box.top - 1)) box.free.delete(--box.top); };

  // ---------- pilihan model per perabot
  const TOL = 0.12;
  const score = (md, w, d, h) => Math.abs(Math.log(w / md.size[0])) + Math.abs(Math.log(Math.max(0.01, d) / md.size[1])) + 8 * Math.abs(Math.log(Math.max(0.01, h) / md.size[2]));
  // selisih ukuran pada sumbu yang tidak di-9-slice & tidak berulang: model melar/gepeng utuh (mis. kursi meja makan ikut melebar)
  const misfit = (md, w, d, h) => {
    const s = md.slice || {};
    return (md.tile || s.x ? 0 : Math.abs(Math.log(w / md.size[0]))) + (s.y ? 0 : Math.abs(Math.log(Math.max(0.01, d) / md.size[1]))) + (s.z ? 0 : Math.abs(Math.log(Math.max(0.01, h) / md.size[2])));
  };
  const MISFIT = 0.5; // ± 1,65× pada satu sumbu → kotak lama saja
  const md0w = (md, w) => (md.tile ? md.size[0] : w); // lebar acuan: modul berulang memakai lebar modulnya sendiri
  const choice = new Map(); // 'jenis|konteks|w|d|h' → kandidat
  function candidates(kind, ctx, w, d, h) {
    const key = kind + '|' + ctx + '|' + w.toFixed(2) + '|' + d.toFixed(2) + '|' + h.toFixed(2);
    let c = choice.get(key);
    if (c) return c;
    let list = (byKind.get(kind) || []).filter((md) => md.ctx.includes(ctx));
    if (!list.length) list = byKind.get(kind) || [];
    if (kind === 'gondola') list = list.filter((md) => md.name === 'gondola_mid');
    let best = Infinity, bestMd = null;
    for (const md of list) { const s = score(md, md.tile ? md.size[0] : w, d, h); if (s < best) { best = s; bestMd = md; } }
    c = !bestMd || misfit(bestMd, md0w(bestMd, w), d, h) > MISFIT ? [] : list.filter((md) => score(md, md.tile ? md.size[0] : w, d, h) <= best + TOL);
    choice.set(key, c);
    return c;
  }
  const endModel = MD.find((md) => md.name === 'gondola_end');
  const palette = (kind, md) => (md.name.startsWith('sofa_leather') ? PAL.leather : kind === 'sofa' ? PAL.sofa : kind === 'bed' ? PAL.bed : kind === 'display' ? PAL.goods : PAL.chair);

  // ---------- rekaman per interior. interiors.js: begin(H) → batch.add(f, Z) per perabot selama interior dicicil →
  //            commit(batch) → rec. show(rec, dy) menggambar rec setinggi dy (templat lantai menara dipindah per lantai),
  //            hide(rec) menyembunyikan (rekaman tetap ada), drop(rec) melepas. Penampung per batch, jadi dua interior yang
  //            dicicil bergantian tidak saling menimpa.
  const IT = 16; // per item: cx, cy, cz, r, x, y, z, rot, dsx, dsy, dsz, t1, t2, seed, flags, model (Y lokal; + rec.dy saat digambar)
  const recs = new Set(); // rekaman yang sedang tampil
  let disabled = false;
  function pushItem(B, md, x, y, Z, rot, w, d, h, t1, t2, seed) {
    if ((B.n + 1) * IT > B.arr.length) { const b = new Float32Array(B.arr.length * 2); b.set(B.arr); B.arr = b; }
    const s = B.arr, o = B.n++ * IT, Yc = Z + Math.min(h, 2.2) * 0.5;
    s[o] = x; s[o + 1] = Yc; s[o + 2] = -y; s[o + 3] = Math.hypot(w, d, h) * 0.5 + 0.3;
    s[o + 4] = x; s[o + 5] = Z; s[o + 6] = -y; s[o + 7] = rot;
    s[o + 8] = w - md.size[0]; s[o + 9] = h - md.size[2]; s[o + 10] = d - md.size[1];
    s[o + 11] = t1; s[o + 12] = t2; s[o + 13] = seed; s[o + 14] = 0; s[o + 15] = md.id;
  }
  function addItem(B, f, Z) { // → true bila perabot digambar model 3D (kotak lama di interiors.js dilewati)
    if (!byKind.has(f.kind)) return false;
    const H = B.H, room = f.room ?? -1;
    Z += (H.floorZ || 0) + (f.kind === 'rug' ? 0.027 : 0); // karpet di atas pelat lantai interior (0,025 m)
    const cand = candidates(f.kind, B.ctx, f.w, f.d, f.h);
    if (!cand.length) return false;
    const hv = hash(H.i * 0.731 + room * 3.17 + Z, f.kind.length * 1.37 + (f.kind.charCodeAt(0) || 0) * 0.11);
    const md = cand[Math.floor(hv * cand.length) % cand.length];
    const pal = palette(f.kind, md), t1 = rgbNum(pal[Math.floor(hash(H.i * 1.3 + room, 2.1 + Z) * pal.length) % pal.length]);
    const t2 = rgbNum(PAL.accent[Math.floor(hash(H.i * 0.7 + room, 5.3) * PAL.accent.length) % PAL.accent.length]);
    let rot = f.rot;
    const cs = Math.cos(rot), sn2 = Math.sin(rot);
    if (f.kind === 'rack') { // rak dinding: muka barang ke sisi ruang yang terbuka (punggung ke sekat)
      const px = f.x - sn2 * (f.d / 2 + 0.35), py = f.y + cs * (f.d / 2 + 0.35);
      const room0 = (H.rooms || []).find((r) => pip(f.x, f.y, r));
      if (room0 && !pip(px, py, room0)) rot += Math.PI;
    }
    if (md.tile) { // modul berulang sepanjang w
      const n = Math.max(1, Math.round(f.w / md.tile)), mw = f.w / n;
      for (let k = 0; k < n; k++) {
        const a = -f.w / 2 + mw * (k + 0.5), x = f.x + a * cs, y = f.y + a * sn2;
        let m2 = md, r2 = rot;
        if (f.kind === 'gondola' && endModel && n > 2 && (k === 0 || k === n - 1)) { m2 = endModel; if (k === n - 1) r2 += Math.PI; }
        pushItem(B, m2, x, y, Z, r2, mw, f.d, f.h, t1, t2, hash(H.i + k * 0.37, f.x * 0.11 + f.y * 0.07));
      }
    } else pushItem(B, md, f.x, f.y, Z, rot, f.w, f.d, f.h, t1, t2, hash(f.x * 0.37 + Z, f.y * 0.71));
    return true;
  }
  function begin(H) {
    if (disabled) return null;
    const B = { H, ctx: H.kind === 'floor' ? 'tower' : H.kind || 'house', arr: new Float32Array(IT * 64), n: 0, add: null };
    B.add = (f, Z) => addItem(B, f, Z);
    return B;
  }
  function commit(B) {
    if (!B || !B.n) return null;
    const n = B.n, items = B.arr.slice(0, n * IT);
    B.arr = null; B.n = 0;
    let cx = 0, cy = 0, cz = 0, nb = 0;
    for (let k = 0; k < n; k++) { cx += items[k * IT]; cy += items[k * IT + 1]; cz += items[k * IT + 2]; nb += MD[items[k * IT + 15]].proxy.length; }
    cx /= n; cy /= n; cz /= n;
    let r = 0, rh = 0;
    for (let k = 0; k < n; k++) { const e = items[k * IT + 3]; rh = Math.max(rh, Math.hypot(items[k * IT] - cx, items[k * IT + 2] - cz) + e); r = Math.max(r, Math.hypot(items[k * IT] - cx, items[k * IT + 1] - cy, items[k * IT + 2] - cz) + e); }
    return { H: B.H, items, n, nb, chunks: [], cx, cy, cz, r, rh, dy: 0, on: false };
  }
  function show(rec, dy = 0) { // kotak proksi ditulis setinggi dy, instans dekat ikut di pemilahan berikutnya
    if (!rec || disabled) return;
    if (rec.on) { if (rec.dy === dy) return; hide(rec); }
    rec.dy = dy;
    const n = rec.n, items = rec.items;
    for (let c = 0; c < Math.ceil(rec.nb / CH); c++) rec.chunks.push(chunkGet());
    let bi = 0;
    const A2 = box.arr; // sesudah chunkGet (boxAlloc bisa mengganti penampung)
    for (let k = 0; k < n; k++) {
      const o = k * IT, md = MD[items[o + 15]], rot = items[o + 7], cs = Math.cos(rot), sn3 = Math.sin(rot);
      const kx = (md.size[0] + items[o + 8]) / md.size[0], kz = (md.size[2] + items[o + 9]) / md.size[2], ky = (md.size[1] + items[o + 10]) / md.size[1];
      for (const p of md.proxy) {
        const slot = rec.chunks[Math.floor(bi / CH)] * CH + (bi % CH), q = slot * 16;
        bi++;
        const a = p.c[0] * kx, b = p.c[1] * ky; // koordinat penulis → data → three
        A2[q] = items[o + 4] + a * cs - b * sn3; A2[q + 1] = items[o + 5] + dy + p.c[2] * kz - p.s[2] * kz * 0.5; A2[q + 2] = -(-items[o + 6] + a * sn3 + b * cs); A2[q + 3] = rot;
        A2[q + 4] = p.s[0] * kx; A2[q + 5] = p.s[2] * kz; A2[q + 6] = p.s[1] * ky; A2[q + 7] = p.cell;
        let r3 = p.col[0], g3 = p.col[1], b3 = p.col[2];
        if (p.t) { const t = items[o + 10 + p.t]; const v = Math.floor(t); const tr = ((v >> 16) & 255) / 255, tg = ((v >> 8) & 255) / 255, tb = (v & 255) / 255; r3 *= Math.pow(tr, 2.2); g3 *= Math.pow(tg, 2.2); b3 *= Math.pow(tb, 2.2); }
        A2[q + 8] = r3; A2[q + 9] = g3; A2[q + 10] = b3; A2[q + 11] = p.face;
        A2[q + 12] = items[o]; A2[q + 13] = items[o + 1] + dy; A2[q + 14] = items[o + 2]; A2[q + 15] = p.rough;
      }
    }
    for (let s = bi; s < rec.chunks.length * CH; s++) { const q = (rec.chunks[Math.floor(s / CH)] * CH + (s % CH)) * 16; A2[q + 4] = A2[q + 5] = A2[q + 6] = 0; }
    for (const c of rec.chunks) box.ib.addUpdateRange(c * CH * 16, CH * 16);
    box.ib.needsUpdate = true;
    box.geo.instanceCount = box.top * CH;
    recs.add(rec); rec.on = true;
    stats.houses = recs.size; stats.items += n; stats.boxes += rec.nb;
    dirty = true;
  }
  function hide(rec) { // slot proksi dikembalikan, instans hilang di pemilahan berikutnya; rekaman bisa di-show lagi
    if (!rec || !rec.on) return;
    for (const c of rec.chunks) {
      for (let s = 0; s < CH; s++) { const q = (c * CH + s) * 16; box.arr[q + 4] = box.arr[q + 5] = box.arr[q + 6] = 0; }
      box.ib.addUpdateRange(c * CH * 16, CH * 16);
      chunkPut(c);
    }
    rec.chunks.length = 0;
    box.ib.needsUpdate = true;
    box.geo.instanceCount = box.top * CH;
    recs.delete(rec); rec.on = false;
    stats.houses = recs.size; stats.items -= rec.n; stats.boxes -= rec.nb;
    dirty = true;
  }
  const stats = { models: MD.length, meshes: meshes.length + 1, houses: 0, items: 0, near: 0, drawn: 0, boxes: 0, repart: 0, ms: 0 };
  Object.defineProperties(stats, { recs: { get: () => recs.size, enumerable: true }, slots: { get: () => box.top * CH, enumerable: true }, free: { get: () => box.free.size, enumerable: true }, disabled: { get: () => disabled, enumerable: true } });

  // ---------- pemilahan dekat (LOD0/LOD1/kaca) — hanya saat kamera pindah/berputar/zoom atau rekaman tampil/disembunyikan
  const TAN0 = Math.tan(37.5 * Math.PI / 180);
  const last = new THREE.Vector3(Infinity, 0, 0), fwd = new THREE.Vector3(), lastFwd = new THREE.Vector3();
  const PM = new THREE.Matrix4(), frustum = new THREE.Frustum(), sph = new THREE.Sphere();
  let lastK = 1, dirty = true, warm = 0;
  // Pemanasan: semua mesh tampil (0 instans) di beberapa frame pertama — main.js memanggil update() sejak menu, jadi program
  // shader dikompilasi dengan cahaya adegan sungguhan sebelum interior pertama. Shader gagal → perabot 3D mati, kotak lama dipakai.
  function warmCheck() {
    for (const m of [mat, glassMat, boxMat]) {
      const pr = renderer.properties.get(m).currentProgram;
      if (pr && pr.diagnostics && pr.diagnostics.runnable === false) disabled = true;
    }
    if (disabled) { group.visible = false; for (const rec of [...recs]) hide(rec); console.warn('Perabot 3D dimatikan: shader gagal dikompilasi, perabot kotak dipakai.'); }
  }
  function update(cam) {
    if (disabled) return;
    if (warm < 4) {
      warm++;
      if (warm < 4) { for (const M of meshes) M.mesh.visible = true; return; }
      warmCheck(); dirty = true;
      if (disabled) return;
    }
    const p = cam.position;
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const k = Math.min(4, Math.max(1, TAN0 / Math.tan((cam.fov || 75) * Math.PI / 360)));
    if (!dirty && last.distanceToSquared(p) < 0.36 && fwd.dot(lastFwd) > 0.9945 && Math.abs(k - lastK) < 0.05) return;
    const t0 = performance.now();
    dirty = false; last.copy(p); lastFwd.copy(fwd); lastK = k;
    cam.updateMatrixWorld();
    PM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(PM);
    const r0 = R0 * k, r1 = R1 * k, r02 = r0 * r0, r12 = r1 * r1;
    const inB = col ? col.inBuilding(p.x, -p.z) : -1;
    for (const M of meshes) M.n = 0;
    let near = 0;
    for (const rec of recs) {
      const dy = rec.dy, dx = rec.cx - p.x, dz = rec.cz - p.z, dh = Math.max(0, Math.hypot(dx, dz) - rec.rh);
      if (dh > r1) continue;
      sph.center.set(rec.cx, rec.cy + dy, rec.cz); sph.radius = rec.r + 2;
      if (!frustum.intersectsSphere(sph)) continue;
      const other = inB >= 0 && rec.H.i !== inB, it = rec.items;
      for (let j = 0; j < rec.n; j++) {
        const o = j * IT, ex = it[o] - p.x, ey = it[o + 1] + dy - p.y, ez = it[o + 2] - p.z, d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= r12) continue;
        sph.center.set(it[o], it[o + 1] + dy, it[o + 2]); sph.radius = it[o + 3] + 0.3 + Math.sqrt(d2) * 0.14; // + marjin putar ±8°
        if (!frustum.intersectsSphere(sph)) continue;
        near++;
        const rt = route[it[o + 15]], lod1 = d2 >= r02 || other;
        put(lod1 ? rt.m1 : rt.m0, lod1 ? rt.p1 : rt.p0, it, o, dy);
        if (rt.g0) put(lod1 ? rt.g1 : rt.g0, lod1 ? rt.gp1 : rt.gp0, it, o, dy);
      }
    }
    let drawn = 0;
    for (const M of meshes) {
      M.geo.instanceCount = M.n;
      M.mesh.visible = M.n > 0;
      if (M.n) { M.ib.clearUpdateRanges(); M.ib.addUpdateRange(0, M.n * 12); M.ib.needsUpdate = true; drawn++; }
    }
    UB.cam.value.copy(p); UB.near.value = r1;
    stats.near = near; stats.drawn = drawn + (box.top ? 1 : 0); stats.repart++;
    stats.ms = performance.now() - t0;
  }
  function put(M, part, it, o, dy) {
    if (!M) return;
    if (M.n >= M.cap) alloc(M, M.cap * 2);
    const a = M.arr, q = M.n++ * 12;
    a[q] = it[o + 4]; a[q + 1] = it[o + 5] + dy; a[q + 2] = it[o + 6]; a[q + 3] = it[o + 7];
    a[q + 4] = it[o + 8]; a[q + 5] = it[o + 9]; a[q + 6] = it[o + 10]; a[q + 7] = part;
    a[q + 8] = it[o + 11]; a[q + 9] = it[o + 12]; a[q + 10] = it[o + 13]; a[q + 11] = it[o + 14];
  }

  return {
    group, stats, meshes, models: MD,
    has: (kind) => byKind.has(kind),
    get disabled() { return disabled; },
    begin, commit, show, hide,
    drop: (rec) => hide(rec), // rekaman dilepas (interior ditutup / templat dibuang); null boleh
    // tiap frame sebelum scene.updateMatrixWorld() (main.js), juga di menu (pemanasan shader)
    update,
  };
}
