// Benda lingkungan kota untuk Sutera Royale (hanya game): menara SUTET + kabel, BTS (juga di atap gedung tinggi), lampu
// jalan LED (satu & dua lengan di median), tiang listrik beton + kabel di jalan kampung, halte Sutera Loop, gerbang
// cluster (palang pintu, pilar, pos satpam, papan nama), lampu lalu lintas berlengan, papan reklame & videotron, SPBU,
// perlengkapan lapangan olahraga, proyek konstruksi (crane berputar, kontainer, pagar seng), bangku, tempat sampah,
// hidran, gazebo, taman bermain, menara air.
// Data penempatan: data/alsut-props.json (tools/build_props.py); model: game/assets/env/envprops.glb + .json
// (tools/blender/envprops.py). Semua benda memakai SATU material PBR (warna, kekasaran, logam, AO, pijar per verteks;
// tulisan & iklan dari atlas kanvas); jaring/kawat = satu material alfa; kabel = pita dengan lebar minimum di layar.
// Hemat draw call: model sejenis digabung per LOD dalam satu InstancedMesh (COMBOS), pagar & kabel = mesh gabungan per
// pagar/petak. Instans dipilah per jarak (dikali zoom kamera) saat kamera pindah ≥ 8 m; saat peta bayangan matahari
// dihitung ulang, jangkauan diperlebar satu frame supaya benda di sekitar ikut membayang.
// Koordinat data: x timur, y utara (m); three.js X = x, Y = atas, Z = −y. Model: +Z = depan benda, +X = kiri.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ASSET = 'game/assets/env/';
const M = 0.1;
const UP = new THREE.Vector3(0, 1, 0);
// jarak LOD per jenis (m, sebelum dikali zoom): [lod0, lod1, (lod2)]; di luar yang terakhir tidak digambar
const RANGE = {
  lamp: [70, 650], lamp2: [70, 650], pole: [60, 450], pole_t: [60, 450], sutet: [200, 750, 6500], bts: [160, 650, 6500],
  btsr: [160, 1500], guard: [70, 500], boom: [220], pillar: [240], namesign: [230], halte: [70, 500],
  signal: [70, 450], signal_l: [70, 450], board: [130, 1600], video: [1300], fuelsign: [650], pump: [60, 300],
  goal: [230], goal_l: [280], hoop: [230], net: [200], bench: [160], bin: [130], hydrant: [110],
  gazebo: [420], playset: [280], crane: [170, 750, 6500], crane_top: [170, 750, 6500], cabin: [70, 420],
  wtower: [120, 600, 3000],
};
// model yang digambar bersama: satu InstancedMesh per kelompok per LOD (geometri anggota digabung; tiap instans hanya
// menampilkan bagiannya — bagian lain diciutkan ke satu titik di shader). Draw call jauh berkurang; biaya verteks kecil.
const COMBOS = [ // [model, LOD yang digabung (null = semua)]
  [['lamp', 'lamp2'], null], [['pole', 'pole_t'], null], [['signal', 'signal_l'], null], [['bench', 'bin', 'hydrant'], null],
  [['boom', 'pillar', 'namesign'], null], [['guard', 'halte'], null], [['board', 'video', 'fuelsign'], null],
  [['goal', 'goal_l', 'hoop', 'net'], null], [['pump', 'cabin', 'gazebo', 'playset'], null],
  [['crane', 'crane_top'], [0, 1]], [['bts', 'btsr'], [0, 1]], [['sutet', 'bts', 'btsr', 'crane', 'crane_top', 'wtower'], [2]],
];
// kode efek per verteks (atribut fx)
const FX = { none: 0, blink: 1, sig_r: 2, sig_y: 3, sig_g: 4, screen: 5, ad: 6, name: 7, night: 8, glow: 9 };
// ---------- atlas kanvas: iklan fiktif, nama cluster, papan tanda (semua merek fiktif)
const AW = 2048, AH = 1280;
const AD = { x: 0, y: 0, w: 512, h: 256, cols: 4, n: 8 };      // 8 iklan 2:1
const NM = { x: 0, y: 512, w: 256, h: 64, cols: 8, n: 40 };    // nama cluster
const CELL = {
  satpam: [0, 832, 512, 80], loop: [512, 832, 160, 210], fuel: [672, 832, 192, 165], price: [864, 832, 176, 286],
  sutet: [1040, 832, 160, 115], bts: [1200, 832, 192, 120], crane: [1392, 832, 640, 120], land: [0, 912, 512, 96],
  timer: [512, 1042, 96, 80], media: [608, 1042, 256, 54], bin_o: [864, 1118, 128, 96], bin_a: [992, 1118, 128, 96],
  pump: [1120, 1118, 160, 120], hoard: [1280, 952, 768, 154], zinc: [1280, 1118, 256, 96], white: [0, 1256, 16, 16],
};

// tata letak atlas (juga dibaca tools/blender/envprops.py --atlas untuk render pratinjau)
export const ATLAS_LAYOUT = { AW, AH, AD, NM, CELL };

export async function loadEnvProps() {
  const j = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' HTTP ' + r.status); return r.json(); });
  const [data, man, gltf] = await Promise.all([j('data/alsut-props.json'), j(ASSET + 'envprops.json'), new GLTFLoader().loadAsync(ASSET + 'envprops.glb')]);
  return { data, man, gltf };
}

// ---------------------------------------------------------------- atlas
function drawAtlas(names) {
  const cv = document.createElement('canvas');
  cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, AW, AH);
  const F = (w, s, f = 'Arial, Helvetica, sans-serif') => `${w} ${s}px ${f}`;
  const fit = (t, maxW, size, w = '800') => { let s = size; g.font = F(w, s); while (s > 8 && g.measureText(t).width > maxW) { s -= 2; g.font = F(w, s); } return s; };
  const text = (t, x, y, size, col, w = '800', align = 'center', maxW = 9999) => { fit(t, maxW, size, w); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  const grad = (x, y, w, h, a, b, vert = false) => { const gr = vert ? g.createLinearGradient(x, y, x, y + h) : g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  const rr = (x, y, w, h, r, col) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  // --- iklan (fiktif)
  const ads = [
    (x, y, w, h) => { grad(x, y, w, h, '#f39a3c', '#b2431f'); g.fillStyle = 'rgba(255,240,210,.18)'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + w * 0.78, y + h * 0.5, 30 + k * 22, 0, Math.PI * 2); g.fill(); }
      rr(x + w * 0.66, y + h * 0.36, 70, 74, 10, '#fff6e8'); g.fillStyle = '#5b2b12'; g.fillRect(x + w * 0.66 + 8, y + h * 0.36 + 8, 54, 16); g.strokeStyle = '#fff6e8'; g.lineWidth = 9; g.beginPath(); g.arc(x + w * 0.66 + 78, y + h * 0.52, 16, -1.2, 1.2); g.stroke();
      text('KOPI SENJA', x + w * 0.34, y + h * 0.38, 64, '#fff6e8', '900', 'center', w * 0.6); text('Seduh pelan, hidup santai', x + w * 0.34, y + h * 0.62, 26, '#ffe2b8', '600', 'center', w * 0.6); },
    (x, y, w, h) => { grad(x, y, w, h, '#24124f', '#0f7d85'); for (let k = 0; k < 4; k++) rr(x + w * 0.74 + k * 26, y + h * 0.62 - k * 26, 18, 30 + k * 26, 4, '#7ef2e8');
      text('SINYAL+', x + w * 0.36, y + h * 0.36, 78, '#ffffff', '900', 'center', w * 0.62); text('5G kencang di mana saja', x + w * 0.36, y + h * 0.63, 26, '#a9fff6', '600', 'center', w * 0.62); text('Paket 50 GB · 59 rb', x + w * 0.36, y + h * 0.82, 22, '#ffffff', '700'); },
    (x, y, w, h) => { grad(x, y, w, h, '#b81d24', '#7c0f14', true); g.fillStyle = '#1d7a3c'; g.fillRect(x, y + h * 0.74, w, h * 0.26); rr(x + w * 0.62, y + h * 0.22, 150, 92, 18, '#f4efe2'); g.fillStyle = '#1d7a3c'; g.fillRect(x + w * 0.62 + 12, y + h * 0.22 + 18, 126, 34); g.fillStyle = '#222'; for (const dx of [28, 118]) { g.beginPath(); g.arc(x + w * 0.62 + dx, y + h * 0.22 + 96, 14, 0, Math.PI * 2); g.fill(); }
      text('SUTERA LOOP', x + w * 0.31, y + h * 0.33, 58, '#ffffff', '900', 'center', w * 0.56); text('Gratis keliling kawasan', x + w * 0.31, y + h * 0.56, 26, '#ffe1df', '700', 'center', w * 0.56); text('Tiap 10 menit · 06.00–22.00', x + w * 0.5, y + h * 0.87, 24, '#ffffff', '700'); },
    (x, y, w, h) => { grad(x, y, w, h, '#151515', '#2b2b2b'); g.fillStyle = '#ffd400'; g.beginPath(); g.moveTo(x + w * 0.78, y + 24); g.lineTo(x + w * 0.66, y + h * 0.56); g.lineTo(x + w * 0.76, y + h * 0.56); g.lineTo(x + w * 0.7, y + h - 24); g.lineTo(x + w * 0.88, y + h * 0.42); g.lineTo(x + w * 0.78, y + h * 0.42); g.lineTo(x + w * 0.86, y + 24); g.closePath(); g.fill();
      text('BOLT', x + w * 0.32, y + h * 0.36, 96, '#ffd400', '900', 'center', w * 0.56); text('ENERGY', x + w * 0.32, y + h * 0.62, 40, '#ffffff', '900'); text('Tenaga +40, langsung!', x + w * 0.32, y + h * 0.84, 22, '#ffd400', '700'); },
    (x, y, w, h) => { grad(x, y, w, h, '#ff3d8b', '#7a1fa2'); g.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 0; k < 9; k++) g.fillRect(x + k * 62, y, 26, h);
      text('MIDNIGHT SALE', x + w / 2, y + h * 0.28, 50, '#ffffff', '900', 'center', w * 0.9); text('70%', x + w / 2, y + h * 0.58, 92, '#fff35c', '900'); text('MAL SUTERA RAYA · Jumat 22.00', x + w / 2, y + h * 0.86, 24, '#ffffff', '700', 'center', w * 0.9); },
    (x, y, w, h) => { grad(x, y, w, h, '#0f3d2a', '#1f6b45'); g.fillStyle = '#d29f52'; g.fillRect(x, y + h - 10, w, 10);
      for (let k = 0; k < 3; k++) { const bx = x + w * 0.66 + k * 52, by = y + h * 0.42 - k * 6; g.fillStyle = '#f3ead6'; g.fillRect(bx, by, 46, 70 + k * 6); g.fillStyle = '#9b3d22'; g.beginPath(); g.moveTo(bx - 6, by); g.lineTo(bx + 23, by - 26); g.lineTo(bx + 52, by); g.fill(); }
      text('RUMAH SUTERA HILLS', x + w * 0.33, y + h * 0.32, 44, '#f3ead6', '900', 'center', w * 0.6); text('Cicilan mulai 8 jt/bln', x + w * 0.33, y + h * 0.56, 28, '#d29f52', '700', 'center', w * 0.6); text('Hunian baru · Siap huni 2027', x + w * 0.33, y + h * 0.78, 20, '#cfe8d8', '600', 'center', w * 0.6); },
    (x, y, w, h) => { grad(x, y, w, h, '#ffd23a', '#ff8a00'); rr(x + w * 0.64, y + h * 0.2, 150, 150, 75, '#c9361e'); text('🌶', x + w * 0.64 + 75, y + h * 0.2 + 78, 70, '#ffffff', '400');
      text('AYAM GEPREK', x + w * 0.32, y + h * 0.34, 50, '#a8161b', '900', 'center', w * 0.6); text('JUARA', x + w * 0.32, y + h * 0.6, 62, '#a8161b', '900'); text('Pedasnya level 1–10', x + w * 0.32, y + h * 0.83, 22, '#5a1a00', '700'); },
    (x, y, w, h) => { grad(x, y, w, h, '#2d2380', '#4a3db0', true); g.fillStyle = '#d29f52'; g.fillRect(x, y, w, 8); g.fillRect(x, y + h - 8, w, 8);
      g.fillStyle = '#d29f52'; g.beginPath(); g.ellipse(x + w * 0.8, y + h * 0.36, 70, 34, 0, Math.PI, 0); g.fill(); g.strokeStyle = '#d29f52'; g.lineWidth = 3; for (const dx of [-60, -20, 20, 60]) { g.beginPath(); g.moveTo(x + w * 0.8 + dx, y + h * 0.36); g.lineTo(x + w * 0.8, y + h * 0.7); g.stroke(); }
      text('SUTERA ROYALE', x + w * 0.36, y + h * 0.38, 54, '#ffffff', '900', 'center', w * 0.66); text('Terjun sekarang · 100 petarung', x + w * 0.36, y + h * 0.62, 24, '#e8cf9b', '700', 'center', w * 0.66); },
  ];
  ads.forEach((fn, i) => { const x = AD.x + (i % AD.cols) * AD.w, y = AD.y + Math.floor(i / AD.cols) * AD.h; g.save(); g.beginPath(); g.rect(x, y, AD.w, AD.h); g.clip(); fn(x, y, AD.w, AD.h); g.restore(); });
  // --- nama cluster: batu gelap, huruf emas
  for (let i = 0; i < NM.n; i++) {
    const x = NM.x + (i % NM.cols) * NM.w, y = NM.y + Math.floor(i / NM.cols) * NM.h;
    grad(x, y, NM.w, NM.h, '#3a3833', '#24231f', true);
    g.fillStyle = 'rgba(210,159,82,.55)'; g.fillRect(x + 6, y + NM.h - 9, NM.w - 12, 2);
    if (names[i]) text(names[i].toUpperCase(), x + NM.w / 2, y + NM.h * 0.45, 30, '#e2b974', '800', 'center', NM.w - 20);
  }
  // --- papan tanda
  const C = (k) => CELL[k];
  { const [x, y, w, h] = C('satpam'); grad(x, y, w, h, '#16325c', '#0d2242', true); g.fillStyle = '#d29f52'; g.fillRect(x, y + h - 6, w, 6);
    g.fillStyle = '#d29f52'; g.beginPath(); g.moveTo(x + 50, y + 14); g.lineTo(x + 78, y + 22); g.lineTo(x + 74, y + 52); g.lineTo(x + 50, y + 66); g.lineTo(x + 26, y + 52); g.lineTo(x + 22, y + 22); g.closePath(); g.fill();
    text('POS SATPAM', x + w * 0.58, y + h * 0.48, 48, '#ffffff', '900', 'center', w * 0.72); }
  { const [x, y, w, h] = C('loop'); g.fillStyle = '#f4f1ea'; g.fillRect(x, y, w, h); g.fillStyle = '#b81d24'; g.fillRect(x, y, w, 52); g.fillStyle = '#1d7a3c'; g.fillRect(x, y + 52, w, 8);
    text('SUTERA', x + w / 2, y + 18, 24, '#fff', '900'); text('LOOP', x + w / 2, y + 40, 22, '#fff', '900');
    g.strokeStyle = '#b81d24'; g.lineWidth = 5; g.beginPath(); g.moveTo(x + 30, y + 78); g.lineTo(x + 30, y + h - 22); g.stroke();
    ['Halte ini', 'Town Centre', 'Living World', 'Mal Sutera', 'Prominence'].forEach((t, k) => { const yy = y + 80 + k * 26; g.fillStyle = k ? '#ffffff' : '#b81d24'; g.strokeStyle = '#b81d24'; g.lineWidth = 3; g.beginPath(); g.arc(x + 30, yy, 7, 0, Math.PI * 2); g.fill(); g.stroke(); text(t, x + 44, yy, 15, '#222', k ? '600' : '800', 'left', w - 50); }); }
  { const [x, y, w, h] = C('fuel'); grad(x, y, w, h, '#4a3db0', '#2d2380', true); g.fillStyle = '#d29f52'; g.beginPath(); g.arc(x + w / 2, y + 56, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a3db0'; g.beginPath(); g.moveTo(x + w / 2, y + 30); g.quadraticCurveTo(x + w / 2 + 22, y + 58, x + w / 2, y + 80); g.quadraticCurveTo(x + w / 2 - 22, y + 58, x + w / 2, y + 30); g.fill();
    text('SUTERA', x + w / 2, y + 112, 34, '#ffffff', '900', 'center', w - 16); text('PETRO', x + w / 2, y + 142, 30, '#d29f52', '900', 'center', w - 16); }
  { const [x, y, w, h] = C('price'); g.fillStyle = '#101418'; g.fillRect(x, y, w, h); g.fillStyle = '#4a3db0'; g.fillRect(x, y, w, 34); text('HARGA / LITER', x + w / 2, y + 18, 17, '#fff', '800');
    [['BENSIN 90', '10.000'], ['BENSIN 92', '12.500'], ['BENSIN 95', '13.250'], ['BENSIN 98', '14.400'], ['SOLAR', '6.800']].forEach(([a, b], k) => { const yy = y + 58 + k * 47; text(a, x + 10, yy - 10, 14, '#d29f52', '800', 'left'); text(b, x + w - 10, yy + 10, 26, '#ffcf3a', '800', 'right'); }); }
  { const [x, y, w, h] = C('sutet'); g.fillStyle = '#f2c200'; g.fillRect(x, y, w, h); g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    g.fillStyle = '#c8102e'; g.beginPath(); g.moveTo(x + 40, y + 16); g.lineTo(x + 24, y + 54); g.lineTo(x + 38, y + 54); g.lineTo(x + 28, y + 92); g.lineTo(x + 58, y + 44); g.lineTo(x + 44, y + 44); g.lineTo(x + 56, y + 16); g.closePath(); g.fill();
    text('AWAS!', x + 108, y + 30, 26, '#c8102e', '900'); text('TEGANGAN', x + 108, y + 60, 18, '#111', '900', 'center', 96); text('TINGGI', x + 108, y + 84, 18, '#111', '900', 'center', 96); }
  { const [x, y, w, h] = C('bts'); g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h); g.fillStyle = '#0f7d85'; g.fillRect(x, y, w, 36); text('SINYAL+', x + w / 2, y + 19, 24, '#fff', '900');
    text('SITE ALS-07', x + w / 2, y + 56, 20, '#111', '800'); text('DILARANG MASUK', x + w / 2, y + 84, 17, '#c8102e', '900', 'center', w - 10); text('Darurat: 0800-1-SINYAL', x + w / 2, y + 106, 12, '#333', '600'); }
  { const [x, y, w, h] = C('crane'); grad(x, y, w, h, '#1d4f91', '#16325c', true); g.fillStyle = '#d29f52'; g.fillRect(x, y + h - 12, w, 12); text('SUTERA LAND', x + w * 0.42, y + h * 0.45, 64, '#ffffff', '900', 'center', w * 0.7); text('★', x + w * 0.88, y + h * 0.45, 64, '#d29f52', '900'); }
  { const [x, y, w, h] = C('land'); g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h); g.fillStyle = '#1d4f91'; g.fillRect(x, y, 90, h); text('★', x + 45, y + h / 2, 52, '#d29f52', '900'); text('SUTERA LAND', x + 300, y + h * 0.38, 42, '#1d4f91', '900', 'center', 400); text('KANTOR PROYEK', x + 300, y + h * 0.74, 22, '#555', '800'); }
  { const [x, y, w, h] = C('timer'); g.fillStyle = '#050505'; g.fillRect(x, y, w, h); text('25', x + w / 2, y + h / 2 + 2, 62, '#ff2a14', '900'); }
  { const [x, y, w, h] = C('media'); g.fillStyle = '#111'; g.fillRect(x, y, w, h); text('SUTERA MEDIA', x + w / 2, y + h / 2, 30, '#d29f52', '900', 'center', w - 16); }
  { const [x, y, w, h] = C('bin_o'); g.fillStyle = '#2f7d3f'; g.fillRect(x, y, w, h); text('ORGANIK', x + w / 2, y + h * 0.72, 20, '#fff', '900', 'center', w - 8); g.fillStyle = '#bff0c4'; g.beginPath(); g.ellipse(x + w / 2, y + 32, 18, 26, 0.6, 0, Math.PI * 2); g.fill(); }
  { const [x, y, w, h] = C('bin_a'); g.fillStyle = '#e6a51c'; g.fillRect(x, y, w, h); text('ANORGANIK', x + w / 2, y + h * 0.72, 18, '#2b1b00', '900', 'center', w - 8); g.strokeStyle = '#2b1b00'; g.lineWidth = 5; g.beginPath(); g.arc(x + w / 2, y + 32, 18, 0.3, 5.6); g.stroke(); }
  { const [x, y, w, h] = C('pump'); g.fillStyle = '#0c1214'; g.fillRect(x, y, w, h); text('RUPIAH', x + 10, y + 16, 13, '#8fb', '800', 'left'); text('125.000', x + w - 10, y + 40, 32, '#6cff9a', '800', 'right'); text('LITER', x + 10, y + 70, 13, '#8fb', '800', 'left'); text('9,43', x + w - 10, y + 94, 32, '#6cff9a', '800', 'right'); }
  { const [x, y, w, h] = C('hoard'); grad(x, y, w, h, '#1d4f91', '#16325c'); g.fillStyle = '#d29f52'; g.fillRect(x, y, w, 10); g.fillRect(x, y + h - 10, w, 10);
    text('SUTERA LAND', x + w * 0.3, y + h * 0.42, 60, '#ffffff', '900', 'center', w * 0.5); text('Hunian modern · Segera hadir', x + w * 0.3, y + h * 0.72, 26, '#d29f52', '700', 'center', w * 0.5);
    g.fillStyle = '#ffd400'; g.fillRect(x + w * 0.62, y + 26, w * 0.34, h - 52); text('AREA PROYEK', x + w * 0.79, y + h * 0.42, 34, '#111', '900', 'center', w * 0.3); text('Wajib APD · Dilarang masuk', x + w * 0.79, y + h * 0.66, 18, '#111', '800', 'center', w * 0.3); }
  { const [x, y, w, h] = C('zinc'); grad(x, y, w, h, '#b9bdc0', '#9fa4a8', true); for (let k = 0; k < 24; k++) { const xx = x + k * w / 24; const gr = g.createLinearGradient(xx, 0, xx + w / 24, 0); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(0.5, 'rgba(0,0,0,.18)'); gr.addColorStop(1, 'rgba(255,255,255,.22)'); g.fillStyle = gr; g.fillRect(xx, y, w / 24, h); }
    g.fillStyle = 'rgba(120,80,40,.25)'; g.fillRect(x, y + h - 10, w, 10); }
  g.fillStyle = '#ffffff';
  g.fillRect(...CELL.white);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, canvas: cv };
}

// jaring kawat (pagar, gawang): wajik putih bening, ulang 1 ubin per satuan UV
function netTexture() {
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, S / 2); g.lineTo(S / 2, 0); g.lineTo(S, S / 2); g.lineTo(S / 2, S); g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- geometri dari GLB
const U8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
const ATLAS_KEY = { ad: 'ad', name: 'name', satpam: 'satpam', loop: 'loop', fuel: 'fuel', price: 'price', sutet: 'sutet', bts: 'bts', crane: 'crane', land: 'land', timer: 'timer', media: 'media', bin_o: 'bin_o', bin_a: 'bin_a', pump: 'pump' };
function cellUV(key) { // [u0, v0, u1, v1] (v dari bawah: CanvasTexture flipY)
  let x, y, w, h;
  if (key === 'ad' || key === 'screen') [x, y, w, h] = [AD.x, AD.y, AD.w, AD.h];
  else if (key === 'name') [x, y, w, h] = [NM.x, NM.y, NM.w, NM.h];
  else [x, y, w, h] = CELL[key] || CELL.white;
  const pad = key === 'white' ? 4 : 1;
  return [(x + pad) / AW, 1 - (y + h - pad) / AH, (x + w - pad) / AW, 1 - (y + pad) / AH];
}
// satu primitif GLB → geometri berisi atribut standar + pbr (AO, kasar, logam, pijar) + fx
function packPrim(mesh, rel) {
  const src = mesh.geometry, mat = mesh.material, name = (mat.name || '').replace(/\.\d+$/, ''), n = src.attributes.position.count;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
  const col = new Float32Array(n * 3), pbr = new Uint8Array(n * 4), fx = new Uint8Array(n), uv = new Float32Array(n * 2);
  const c = (mat.color || new THREE.Color(1, 1, 1)).clone(), ao = src.attributes.color;
  const em = mat.emissive ? Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) * (mat.emissiveIntensity ?? 1) : 0;
  let code = FX.none, key = null;
  if (name.startsWith('atlas_')) { key = ATLAS_KEY[name.slice(6)] || 'white'; code = key === 'ad' ? FX.ad : key === 'name' ? FX.name : em > 0 ? FX.glow : FX.none; }
  else if (name === 'screen') { key = 'screen'; code = FX.screen; }
  else if (name === 'lamp_red') code = FX.blink;
  else if (name === 'sig_r' || name === 'sig_y' || name === 'sig_g') code = FX[name];
  else if (name === 'led') code = FX.night;
  else if (em > 0) code = FX.glow;
  const cu = key ? cellUV(key) : cellUV('white'), su = src.attributes.uv;
  if (code === FX.screen) c.setRGB(1, 1, 1); // layar: warna sepenuhnya dari atlas (berpijar)
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    pbr[i * 4] = ao ? U8(ao.getX(i)) : 255; pbr[i * 4 + 1] = U8(mat.roughness ?? 0.6); pbr[i * 4 + 2] = U8(mat.metalness ?? 0); pbr[i * 4 + 3] = U8(Math.min(1, em / 4));
    fx[i] = code;
    if (key && su) { uv[i * 2] = cu[0] + (cu[2] - cu[0]) * su.getX(i); uv[i * 2 + 1] = cu[1] + (cu[3] - cu[1]) * (1 - su.getY(i)); }
    else { uv[i * 2] = (cu[0] + cu[2]) / 2; uv[i * 2 + 1] = (cu[1] + cu[3]) / 2; }
  }
  if (name === 'net' && su) for (let i = 0; i < n; i++) { uv[i * 2] = su.getX(i); uv[i * 2 + 1] = su.getY(i); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4, true));
  g.setAttribute('fx', new THREE.BufferAttribute(fx, 1));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (src.index) g.setIndex(src.index.clone());
  if (!g.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(rel);
  return { g, net: name === 'net' };
}
function parseModels(gltf) {
  const out = {}; // nama → [lod] → { solid, net }
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = /^(.+)_lod(\d)$/.exec(o.name || '');
    if (!m || (!o.isMesh && !o.children.length)) return;
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), solid = [], net = [];
    o.traverse((x) => {
      if (!x.isMesh) return;
      const p = packPrim(x, new THREE.Matrix4().multiplyMatrices(inv, x.matrixWorld));
      (p.net ? net : solid).push(p.g);
    });
    const merge = (list) => (list.length ? (list.length > 1 ? mergeGeometries(list, false) : list[0]) : null);
    (out[m[1]] ||= [])[+m[2]] = { solid: merge(solid), net: merge(net) };
  });
  return out;
}

// ---------------------------------------------------------------- material
const SHADER_VS = `
attribute vec4 pbr;
attribute float fx;
attribute float part;
attribute float aVar;
attribute float aPart;
uniform float uTime;
varying vec4 vPbr;
varying float vFx;
varying float vVar;
varying float vH;
`;
const SHADER_FS = `
uniform float uTime, uNight;
varying vec4 vPbr;
varying float vFx;
varying float vVar;
varying float vH;
float envOn() { // lampu lalu lintas: siklus 40 dtk, dua kelompok arah bergantian; fase tiap simpang beda
  float t = mod(uTime + floor(vVar / 2.0) * 7.3 + mod(vVar, 2.0) * 20.0, 40.0);
  if (vFx > 1.5 && vFx < 2.5) return step(20.0, t);
  if (vFx > 2.5 && vFx < 3.5) return step(17.0, t) * (1.0 - step(20.0, t));
  return 1.0 - step(17.0, t);
}
`;
function makeUni(R, atlas, U) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, roughness: 1, metalness: 1, envMap: R ? R.env : null, envMapIntensity: 1.0 });
  m.name = 'envprops';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time; sh.uniforms.uNight = U.night;
    sh.vertexShader = SHADER_VS + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  vPbr = pbr; vFx = fx; vVar = aVar;
  mat2 slew = mat2(1.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    if (aVar < -0.5) { // bagian berputar (crane): putar di sumbu Y model, kecepatan & fase per instans
      float ang = uTime * 0.045 + aVar * 1.7;
      slew = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      objectNormal.xz = slew * objectNormal.xz;
    }
  #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed.xz = slew * transformed.xz;
  #ifdef USE_INSTANCING
    if (abs(part - aPart) > 0.5) transformed = vec3(0.0); // bagian milik model lain dalam kelompok
  #endif`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
  #ifdef USE_MAP
  { // iklan / nama cluster / layar videotron: geser ke sel atlas milik instans
    float cell = -1.0, cols = 1.0; vec2 pitch = vec2(0.0);
    if (fx > 4.5 && fx < 5.5) { cell = mod(floor(uTime / 6.5 + aVar * 3.0), ${AD.n}.0); cols = ${AD.cols}.0; pitch = vec2(${AD.w / AW}, ${-AD.h / AH}); }
    else if (fx > 5.5 && fx < 6.5) { cell = mod(aVar, ${AD.n}.0); cols = ${AD.cols}.0; pitch = vec2(${AD.w / AW}, ${-AD.h / AH}); }
    else if (fx > 6.5 && fx < 7.5) { cell = mod(aVar, ${NM.n}.0); cols = ${NM.cols}.0; pitch = vec2(${NM.w / AW}, ${-NM.h / AH}); }
    if (cell >= 0.0) vMapUv += vec2(mod(cell, cols), floor(cell / cols)) * pitch;
  }
  #endif`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  {
    vec4 wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    vH = (modelMatrix * wp).y;
  }`);
    sh.fragmentShader = SHADER_FS + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  // kotor & kusam di dekat tanah (cipratan, debu)
  if (vFx < 0.5) diffuseColor.rgb *= mix(0.74, 1.0, smoothstep(0.02, 0.9, vH));`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(vPbr.y + (1.0 - smoothstep(0.02, 0.9, vH)) * 0.15, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.z;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float e = vPbr.w * 4.0, on = 0.0;
    if (vFx > 0.5 && vFx < 1.5) on = step(0.5, fract(uTime * 0.75 + vVar * 0.37)) * 1.6;        // lampu pesawat berkedip
    else if (vFx > 1.5 && vFx < 4.5) on = envOn();                                              // lampu lalu lintas
    else if (vFx > 4.5 && vFx < 5.5) on = 1.0;                                                  // videotron
    else if (vFx > 7.5 && vFx < 8.5) on = uNight;                                               // lensa lampu jalan (malam)
    else if (vFx > 8.5) on = 1.0;
    vec3 ec = (vFx > 4.5 && vFx < 5.5) || vFx > 8.5 ? diffuseColor.rgb : diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.02)); // lensa: warna jenuh dari rona dasar
    totalEmissiveRadiance += ec * e * on;
    if (vFx > 4.5 && vFx < 5.5) { // layar LED: piksel halus dari dekat
      vec2 q = fract(vMapUv * vec2(${AW / 4}.0, ${AH / 4}.0));
      float px = smoothstep(0.0, 0.25, q.x) * smoothstep(1.0, 0.75, q.x) * smoothstep(0.0, 0.25, q.y) * smoothstep(1.0, 0.75, q.y);
      totalEmissiveRadiance *= mix(1.0, 0.55 + 0.6 * px, clamp(1.0 - length(fwidth(vMapUv)) * 900.0, 0.0, 1.0));
      diffuseColor.rgb *= 0.15;
    }
  }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  { float ao = vPbr.x; reflectedLight.indirectDiffuse *= ao; reflectedLight.indirectSpecular *= mix(1.0, ao, 0.85); reflectedLight.directDiffuse *= mix(1.0, ao, 0.4); reflectedLight.directSpecular *= mix(1.0, ao, 0.4); }`);
  };
  m.customProgramCacheKey = () => 'envprops1';
  if (R) R.patch(m, { dyn: true });
  return m;
}

// bahan jaring & bahan kedalaman (bayangan) untuk mesh kelompok: bagian model lain diciutkan; bagian berputar (crane)
// tidak membayang (peta bayangan matahari statis)
function partPatch(m, key, noSlew, opaque) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = 'attribute float part;\nattribute float aPart;\nattribute float aVar;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
    if (abs(part - aPart) > 0.5${noSlew ? ' || aVar < -0.5' : ''}) transformed = vec3(0.0);
  #endif`);
    // jaring lolos uji alfa = padat (alfa keluaran utuh: tanpa post, alfa < 1 membuat kanvas tembus ke latar halaman)
    if (opaque) sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  diffuseColor.a = 1.0;');
  };
  const pk = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key + pk();
  return m;
}

// ---------------------------------------------------------------- kabel
// Pita menghadap kamera; lebar = maks(jari-jari kabel, ±0,7 piksel) supaya kabel jauh tidak berkedip/hilang.
function makeCableMat(U) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPx = U.px;
    sh.vertexShader = 'attribute vec3 cdir;\nattribute float cside;\nattribute float crad;\nuniform float uPx;\n' + sh.vertexShader
      .replace('#include <project_vertex>', `
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vec3 tv = normalize((modelViewMatrix * vec4(cdir, 0.0)).xyz);
  vec3 sd = cross(tv, normalize(mvPosition.xyz));
  float sl = length(sd);
  sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
  float w = max(crad, -mvPosition.z * uPx);
  mvPosition.xyz += sd * w * cside;
  gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
  { vec3 vv = -normalize((modelViewMatrix * vec4(position, 1.0)).xyz); transformedNormal = normalize(vv + (viewMatrix * vec4(0.0, 0.6, 0.0, 0.0)).xyz); }`);
  };
  m.customProgramCacheKey = () => 'envcable1';
  return m;
}

// ---------------------------------------------------------------- pembuat utama
export function createEnvProps(W, A, col) {
  const stub = { obstacles: [], update() {}, group: null, stats: {} };
  if (!A || !A.data || !A.man || !A.gltf) return stub;
  const { scene, renderer, camera, inArea } = W, R = W.real;
  const D = A.data, MAN = A.man.types, ST = D.meta.stride || 6;
  const U = { time: { value: 0 }, night: { value: 0 }, px: { value: 0.001 } };
  const atlas = drawAtlas(D.names || []);
  const uni = makeUni(R, atlas.tex, U);
  const netTex = netTexture();
  const netMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: netTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.4, envMap: R ? R.env : null });
  if (R) R.patch(netMat, { dyn: true });
  partPatch(netMat, 'envnet', false, true);
  const depthMat = partPatch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'envdepth', true);
  const cableMat = makeCableMat(U);
  const models = parseModels(A.gltf);
  const group = new THREE.Group();
  group.name = 'envprops';
  group.matrixAutoUpdate = false;

  // ---------- instans: jenis data → model
  const inst = []; // { m: nama model, x, y, a, v, z, s, fx, fy }
  const tmap = (k, v, s) => (k === 'pole' && v === 1 ? 'pole_t' : k === 'goal' && v === 1 ? 'goal_l' : k === 'signal' ? (s >= 0.8 ? 'signal_l' : 'signal') : k);
  for (const [k, arr] of Object.entries(D.t)) {
    for (let i = 0; i + ST - 1 < arr.length; i += ST) {
      const x = arr[i] * M, y = arr[i + 1] * M, a = arr[i + 2] / 10 * Math.PI / 180, v = arr[i + 3], z = arr[i + 4] * M, s = arr[i + 5] / 100;
      const m = tmap(k, v, s);
      if (!models[m]) continue;
      const o = { k, m, i: i / ST, x, y, a, v, z, s: k === 'net' ? s : 1, fx: Math.cos(a), fy: Math.sin(a), ok: true };
      inst.push(o);
      if (k === 'crane' && models.crane_top) inst.push({ ...o, m: 'crane_top', top: true });
    }
  }
  const byKey = new Map(); // 'jenis:indeks' → instans (kabel memakai indeks data asli)
  for (const o of inst) if (!o.top) byKey.set(o.k + ':' + o.i, o);
  // titik penulis (x kanan, y depan, z atas) → data
  const P = (o, ax, ay) => [o.x + ay * o.fx + ax * o.fy, o.y + ay * o.fy - ax * o.fx];

  // ---------- saring: tidak di pohon/gedung (posisi pohon akhir hanya diketahui di runtime, map/trees.js)
  const nearTree = (x, y, r) => {
    let hit = false;
    col.near(x, y, r + 0.5, (c) => { if (hit) return; for (const ti of c.t) { const t = col.trees[ti]; if (Math.hypot(t.x - x, t.y - y) < r + t.r) { hit = true; return; } } });
    return hit;
  };
  let dropped = 0;
  for (const o of inst) {
    if (o.top || o.z > 0.5) continue;
    const C = MAN[o.m] && MAN[o.m].col;
    if (!C || !C.length || !inArea(o.x, o.y)) continue;
    let bad = false;
    for (const c of C) {
      if (c.z0 > 1.9) continue;
      if (c.c) { const [x, y] = P(o, c.c[0], c.c[1]); if (nearTree(x, y, c.c[2] + 0.05) || (o.k !== 'sutet' && col.inBuilding(x, y) >= 0)) bad = true; }
      else if (c.b) { const [x, y] = P(o, c.b[0], c.b[1]), r = Math.min(c.b[2], c.b[3]) / 2; if (nearTree(x, y, r) || (o.k !== 'sutet' && col.inBuilding(x, y) >= 0)) bad = true; }
      if (bad) break;
    }
    if (bad) { o.ok = false; dropped++; }
  }
  for (const o of inst) if (o.top) o.ok = byKey.get('crane:' + o.i).ok;

  // ---------- rintangan (tabrakan + peluru), hanya di dalam kawasan
  const obstacles = [];
  for (const o of inst) {
    if (!o.ok || !inArea(o.x, o.y)) continue;
    const C = (MAN[o.m] && MAN[o.m].col) || [];
    for (const c of C) {
      const z0 = (c.z0 || 0) + o.z, h = c.h + o.z;
      if (c.c) { const [x, y] = P(o, c.c[0], c.c[1]); obstacles.push({ x, y, r: c.c[2], h, z0 }); }
      else if (c.b) {
        const [cx, cy, w, d] = c.b, pts = [];
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(...P(o, cx + sx * w / 2, cy + sy * d / 2));
        obstacles.push({ pts, h, z0, floor: !!c.floor });
      }
    }
  }

  // ---------- InstancedMesh per (kelompok, LOD)
  const types = new Map(); // model → { name, list, range, mtx, var, pos, part, has }
  for (const o of inst) if (o.ok) { let T = types.get(o.m); if (!T) types.set(o.m, (T = { name: o.m, list: [], range: RANGE[o.m] || [60, 300] })); T.list.push(o); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  let drawMeshes = 0;
  for (const [, T] of types) {
    const n = T.list.length;
    T.mtx = new Float32Array(n * 16);
    T.var = new Float32Array(n);
    T.pos = new Float32Array(n * 3);
    T.list.forEach((o, j) => {
      const th = Math.atan2(o.fx, -o.fy);
      m4.compose(pv.set(o.x, o.z, -o.y), q.setFromAxisAngle(UP, th), sv.set(o.s, 1, 1));
      m4.toArray(T.mtx, j * 16);
      T.var[j] = o.m === 'crane_top' ? -1 - (o.v % 7) : o.v;
      T.pos[j * 3] = o.x; T.pos[j * 3 + 1] = o.z; T.pos[j * 3 + 2] = -o.y;
    });
    T.has = models[T.name].map((L) => !!(L && (L.solid || L.net)));
  }
  // kelompok per LOD: tiap (model, LOD) masuk satu kelompok (COMBOS, sisanya sendiri-sendiri)
  const combos = [];
  const maxL = Math.max(...[...types.values()].map((T) => T.has.length));
  for (const T of types.values()) { T.combo = []; T.partOf = []; }
  for (let li = 0; li < maxL; li++) {
    const used = new Set(), groups = [];
    for (const [names, lods] of COMBOS) {
      if (lods && !lods.includes(li)) continue;
      const mem = names.filter((k) => types.has(k) && types.get(k).has[li] && !used.has(k)).map((k) => types.get(k));
      if (!mem.length) continue;
      mem.forEach((T) => used.add(T.name));
      groups.push(mem);
    }
    for (const T of types.values()) if (T.has[li] && !used.has(T.name)) groups.push([T]);
    for (const members of groups) {
      const C = { li, members, cap: members.reduce((a, T) => a + T.list.length, 0) };
      members.forEach((T, i) => { T.combo[li] = C; T.partOf[li] = i; });
      const pick = (key) => {
        const list = [];
        members.forEach((T, i) => {
          const L = models[T.name][li];
          if (!L || !L[key]) return;
          const g = L[key].clone();
          g.setAttribute('part', new THREE.BufferAttribute(new Uint8Array(g.attributes.position.count).fill(i), 1));
          list.push(g);
        });
        return list.length ? (list.length > 1 ? mergeGeometries(list, false) : list[0]) : null;
      };
      const mk = (geo, mat, shadow) => {
        if (!geo) return null;
        geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(new Float32Array(C.cap), 1).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aPart', new THREE.InstancedBufferAttribute(new Float32Array(C.cap), 1).setUsage(THREE.DynamicDrawUsage));
        const im = new THREE.InstancedMesh(geo, mat, C.cap);
        im.name = members.map((T) => T.name).join('+') + '_lod' + li + (mat === netMat ? '_net' : '');
        im.count = 0;
        im.visible = false;
        im.frustumCulled = false;
        im.matrixAutoUpdate = false;
        im.castShadow = shadow;
        im.receiveShadow = true;
        if (shadow) im.customDepthMaterial = depthMat;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        group.add(im);
        drawMeshes++;
        return im;
      };
      C.solid = mk(pick('solid'), uni, true);
      C.net = mk(pick('net'), netMat, false);
      combos.push(C);
    }
  }

  // ---------- kabel (SUTET, tiang listrik, sambungan rumah): SUTET satu mesh (terlihat dari jauh), kabel tiang per petak 400 m
  const statics = []; // mesh gabungan yang dipilah per jarak: { mesh, x, z, r, far }
  const addStatic = (mesh, box, far) => {
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    drawMeshes++;
    statics.push({ mesh, x: (box[0] + box[2]) / 2, z: -(box[1] + box[3]) / 2, r: Math.hypot(box[2] - box[0], box[3] - box[1]) / 2, far });
  };
  const growBox = (b, x, y) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; };
  const cables = { spans: 0 };
  {
    const buckets = new Map(), TILE = 400;
    const bucket = (key) => { let B = buckets.get(key); if (!B) buckets.set(key, (B = { pos: [], dir: [], side: [], rad: [], col: [], idx: [], box: [Infinity, Infinity, -Infinity, -Infinity] })); return B; };
    const add = (B, ax, ay, az, bx, by, bz, sag, r, c, n) => {
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 0.5) return;
      const base = B.pos.length / 3;
      growBox(B.box, ax, ay); growBox(B.box, bx, by);
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t - 4 * sag * t * (1 - t);
        const dz = (bz - az) - 4 * sag * (1 - 2 * t), dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy, dz) || 1;
        for (const s of [-1, 1]) { B.pos.push(x, z, -y); B.dir.push(dx / dl, dz / dl, -dy / dl); B.side.push(s); B.rad.push(r); B.col.push(c[0], c[1], c[2]); }
        if (k < n) { const v = base + k * 2; B.idx.push(v, v + 3, v + 1, v, v + 2, v + 3); } // berlawanan jarum jam dilihat kamera (sisi pita mengikuti arah pandang)
      }
    };
    const tileOf = (x, y) => bucket(Math.floor(x / TILE) + ',' + Math.floor(y / TILE));
    const AL = [0.32, 0.34, 0.36], BLACK = [0.018, 0.018, 0.02], anchorsOf = (o, list) => list.map(([ax, ay, az]) => { const [x, y] = P(o, ax, ay); return [x, y, az + o.z]; });
    for (const ch of D.cables || []) {
      const list = ch.i.map((i) => byKey.get(ch.k + ':' + i)).filter((o) => o && o.ok);
      for (let k = 0; k + 1 < list.length; k++) {
        const A0 = list[k], B0 = list[k + 1], an = MAN[A0.m].anchors, bn = MAN[B0.m].anchors;
        if (!an || !bn) continue;
        const L = Math.hypot(B0.x - A0.x, B0.y - A0.y);
        if (ch.k === 'sutet') {
          if (L > 900) continue;
          const B = bucket('sutet'), ca = anchorsOf(A0, an.cond), cb = anchorsOf(B0, bn.cond), ea = anchorsOf(A0, an.earth), eb = anchorsOf(B0, bn.earth);
          const n = Math.max(10, Math.min(28, Math.round(L / 14))), sag = L * L * 0.000085;
          for (let j = 0; j < Math.min(ca.length, cb.length); j++) add(B, ...ca[j], ...cb[j], sag, 0.016, AL, n);
          for (let j = 0; j < Math.min(ea.length, eb.length); j++) add(B, ...ea[j], ...eb[j], sag * 0.85, 0.008, AL, n);
        } else {
          if (L > 70) continue;
          const B = tileOf((A0.x + B0.x) / 2, (A0.y + B0.y) / 2), sag = 0.25 + L * L * 0.00035, n = 8;
          for (const kk of ['mv', 'lv', 'tel']) {
            const a = anchorsOf(A0, an[kk] || []), b = anchorsOf(B0, bn[kk] || []);
            for (let j = 0; j < Math.min(a.length, b.length); j++) add(B, ...a[j], ...b[j], kk === 'mv' ? sag * 0.8 : sag * 1.25, kk === 'mv' ? 0.006 : kk === 'lv' ? 0.016 : 0.009, kk === 'mv' ? AL : BLACK, n);
          }
        }
        cables.spans++;
      }
    }
    for (const [pi, x, y, h] of D.drops || []) { // sambungan rumah: kabel pilin kecil ke dinding
      const o = byKey.get('pole:' + pi);
      if (!o || !o.ok) continue;
      const an = MAN[o.m].anchors;
      if (!an || !an.lv) continue;
      const [ax, ay, az] = anchorsOf(o, an.lv)[0];
      add(tileOf(ax, ay), ax, ay, az, x * M, y * M, h * M, 0.35, 0.007, BLACK, 6);
      cables.spans++;
    }
    for (const [key, B] of buckets) {
      if (!B.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('cdir', new THREE.Float32BufferAttribute(B.dir, 3));
      g.setAttribute('cside', new THREE.Float32BufferAttribute(B.side, 1));
      g.setAttribute('crad', new THREE.Float32BufferAttribute(B.rad, 1));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(B.pos.length), 3));
      g.setIndex(B.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
      const mesh = new THREE.Mesh(g, cableMat);
      mesh.name = 'cables_' + key;
      mesh.frustumCulled = false;
      addStatic(mesh, B.box, key === 'sutet' ? 1e9 : 420);
    }
  }

  // ---------- pagar kawat (lapangan, BTS) + pagar seng proyek: satu mesh (+ jaring) per pagar, dipilah per jarak
  const white = cellUV('white'), wu = (white[0] + white[2]) / 2, wv = (white[1] + white[3]) / 2;
  const newBuf = (pbr) => ({ pos: [], nor: [], col: [], uv: [], pbr: pbr ? [] : null, fx: pbr ? [] : null, box: [Infinity, Infinity, -Infinity, -Infinity] });
  const quadTo = (B, a, b, c, d, n, colr, uvs, pb, f) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = [a, b, c, d][k];
      B.pos.push(p[0], p[2], -p[1]); B.nor.push(n[0], n[2], -n[1]); B.col.push(colr[0], colr[1], colr[2]);
      B.uv.push(uvs[k][0], uvs[k][1]);
      if (B.pbr) { B.pbr.push(...pb); B.fx.push(f); }
      growBox(B.box, p[0], p[1]);
    }
  };
  const W4 = [[wu, wv], [wu, wv], [wu, wv], [wu, wv]];
  const boxTo = (B, cx, cy, z0, z1, ux, uy, hl, hw, colr, pb) => { // kotak sejajar (ux, uy), panjang 2hl, lebar 2hw
    const vx = -uy, vy = ux, C4 = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([a, b]) => [cx + ux * a + vx * b, cy + uy * a + vy * b]);
    for (let j = 0; j < 4; j++) { const p = C4[j], q2 = C4[(j + 1) % 4], ex = q2[0] - p[0], ey = q2[1] - p[1], l = Math.hypot(ex, ey) || 1; quadTo(B, [p[0], p[1], z0], [q2[0], q2[1], z0], [q2[0], q2[1], z1], [p[0], p[1], z1], [ey / l, -ex / l, 0], colr, W4, pb, 0); }
    quadTo(B, [C4[0][0], C4[0][1], z1], [C4[1][0], C4[1][1], z1], [C4[2][0], C4[2][1], z1], [C4[3][0], C4[3][1], z1], [0, 0, 1], colr, W4, pb, 0);
  };
  const mkStatic = (B, mat, withPbr, far, name) => {
    if (!B.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    if (withPbr) { g.setAttribute('pbr', new THREE.BufferAttribute(new Uint8Array(B.pbr), 4, true)); g.setAttribute('fx', new THREE.BufferAttribute(new Uint8Array(B.fx), 1)); }
    g.setAttribute('part', new THREE.BufferAttribute(new Uint8Array(B.pos.length / 3), 1));
    g.setAttribute('aVar', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
    g.setAttribute('aPart', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
    // satu instans (matriks identitas): program shader yang sama dengan benda lain (tanpa kompilasi tambahan)
    const mesh = new THREE.InstancedMesh(g, mat, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.computeBoundingSphere();
    mesh.name = name;
    mesh.castShadow = withPbr;
    mesh.receiveShadow = true;
    addStatic(mesh, B.box, far);
  };
  const GALV = [0.42, 0.44, 0.46], PB_GALV = [255, 115, 200, 0], ZINC = [0.62, 0.64, 0.66], PB_ZINC = [255, 110, 170, 0];
  const roadNear = (x, y, pad) => { let hit = false; col.near(x, y, 14, (c) => { if (hit) return; for (const si of c.s) { const s = col.segs[si], dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy, t = L > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / L)) : 0; if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) < s.w / 2 + pad) { hit = true; return; } } }); return hit; };
  const freeAt = (x, y) => inArea(x, y) && !roadNear(x, y, 0.4) && col.inBuilding(x, y) < 0 && !col.waterAt(x, y);
  let fenceM = 0, hoardM = 0;
  (D.fences || []).forEach((F, fi) => {
    const p = F.p, n = p.length / 2, H = F.h * M, wire = !!F.wire, gate = F.gate, fr = newBuf(true), nt = newBuf(false);
    for (let e = 0; e < n; e++) {
      const ax = p[e * 2] * M, ay = p[e * 2 + 1] * M, bx = p[((e + 1) % n) * 2] * M, by = p[((e + 1) % n) * 2 + 1] * M, L = Math.hypot(bx - ax, by - ay);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L, k = Math.max(1, Math.ceil(L / 2.6)), seg = L / k;
      const g0 = gate && gate[0] === e ? L * gate[1] - gate[2] / 2 : -1, g1 = gate && gate[0] === e ? L * gate[1] + gate[2] / 2 : -1;
      for (let j = 0; j < k; j++) {
        const s0 = j * seg, s1 = s0 + seg, mx = ax + ux * (s0 + s1) / 2, my = ay + uy * (s0 + s1) / 2;
        if (!freeAt(mx, my)) continue;
        const px0 = ax + ux * s0, py0 = ay + uy * s0;
        boxTo(fr, px0, py0, 0, H + (wire ? 0.45 : 0.05), ux, uy, 0.03, 0.03, GALV, PB_GALV); // tiang
        if (s1 > g0 && s0 < g1) continue; // pintu
        const q0 = [px0, py0], q1 = [ax + ux * s1, ay + uy * s1], nn = [uy, -ux, 0];
        const uvs = [[0, 0.05 / 0.07], [seg / 0.07, 0.05 / 0.07], [seg / 0.07, (H - 0.05) / 0.07], [0, (H - 0.05) / 0.07]];
        quadTo(nt, [q0[0], q0[1], 0.05], [q1[0], q1[1], 0.05], [q1[0], q1[1], H - 0.05], [q0[0], q0[1], H - 0.05], nn, GALV, uvs);
        boxTo(fr, (q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, H - 0.06, H, ux, uy, seg / 2, 0.025, GALV, PB_GALV); // pipa atas
        if (wire) for (let w = 0; w < 3; w++) boxTo(fr, (q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, H + 0.12 + w * 0.13, H + 0.13 + w * 0.13, ux, uy, seg / 2, 0.006, [0.3, 0.3, 0.3], PB_GALV); // kawat duri
        obstacles.push({ pts: [q0[0] - uy * 0.05, q0[1] + ux * 0.05, q1[0] - uy * 0.05, q1[1] + ux * 0.05, q1[0] + uy * 0.05, q1[1] - ux * 0.05, q0[0] + uy * 0.05, q0[1] - ux * 0.05], h: H, z0: 0 });
        fenceM += seg;
      }
    }
    mkStatic(fr, uni, true, 260, 'fence_' + fi);
    mkStatic(nt, netMat, false, 120, 'fencenet_' + fi);
  });
  // pagar seng proyek: panel 2,4 m (seng bergelombang dari atlas) + spanduk pengembang tiap 12 m, celah 7 m di sisi terdekat jalan
  const hoardUV = cellUV('hoard'), zincUV = cellUV('zinc');
  const uvSpan = (cu, a, b) => [[cu[0] + (cu[2] - cu[0]) * a, cu[1]], [cu[0] + (cu[2] - cu[0]) * b, cu[1]], [cu[0] + (cu[2] - cu[0]) * b, cu[3]], [cu[0] + (cu[2] - cu[0]) * a, cu[3]]];
  (D.hoards || []).forEach((Hd, hi) => {
    const p = Hd.p, n = p.length / 2, H = 2.4, fr = newBuf(true);
    let gateE = -1, gd = Infinity;
    for (let e = 0; e < n; e++) { const mx = (p[e * 2] + p[((e + 1) % n) * 2]) / 2 * M, my = (p[e * 2 + 1] + p[((e + 1) % n) * 2 + 1]) / 2 * M; let d = 99; col.near(mx, my, 30, (c) => { for (const si of c.s) { const s = col.segs[si]; d = Math.min(d, Math.hypot((s.ax + s.bx) / 2 - mx, (s.ay + s.by) / 2 - my)); } }); if (d < gd) { gd = d; gateE = e; } }
    let run = 0;
    for (let e = 0; e < n; e++) {
      const ax = p[e * 2] * M, ay = p[e * 2 + 1] * M, bx = p[((e + 1) % n) * 2] * M, by = p[((e + 1) % n) * 2 + 1] * M, L = Math.hypot(bx - ax, by - ay);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L, k = Math.max(1, Math.ceil(L / 4.0)), seg = L / k;
      for (let j = 0; j < k; j++) {
        const s0 = j * seg, s1 = s0 + seg, mx = ax + ux * (s0 + s1) / 2, my = ay + uy * (s0 + s1) / 2;
        if (e === gateE && Math.abs((s0 + s1) / 2 - L / 2) < 3.5) continue;
        if (!freeAt(mx, my) || nearTree(mx, my, 0.1)) { run = 0; continue; }
        const q0 = [ax + ux * s0, ay + uy * s0], q1 = [ax + ux * s1, ay + uy * s1];
        const banner = Math.floor(run / 3) % 2 === 1, sp = (run % 3) / 3, nn = [uy, -ux, 0];
        for (const sd of [1, -1]) { // muka luar (berspanduk) & dalam (seng polos)
          const o = 0.02 * sd, a0 = [q0[0] + uy * o, q0[1] - ux * o], a1 = [q1[0] + uy * o, q1[1] - ux * o];
          if (sd > 0) quadTo(fr, [a0[0], a0[1], 0], [a1[0], a1[1], 0], [a1[0], a1[1], H], [a0[0], a0[1], H], nn, banner ? [1, 1, 1] : ZINC, banner ? uvSpan(hoardUV, sp, sp + 1 / 3) : uvSpan(zincUV, 0, 1), banner ? [255, 120, 0, 0] : PB_ZINC, 0);
          else quadTo(fr, [a1[0], a1[1], 0], [a0[0], a0[1], 0], [a0[0], a0[1], H], [a1[0], a1[1], H], [-uy, ux, 0], ZINC, uvSpan(zincUV, 0, 1), PB_ZINC, 0);
        }
        boxTo(fr, q0[0], q0[1], 0, H + 0.05, ux, uy, 0.04, 0.06, [0.2, 0.22, 0.25], [255, 140, 120, 0]);
        obstacles.push({ pts: [q0[0] - uy * 0.06, q0[1] + ux * 0.06, q1[0] - uy * 0.06, q1[1] + ux * 0.06, q1[0] + uy * 0.06, q1[1] - ux * 0.06, q0[0] + uy * 0.06, q0[1] - ux * 0.06], h: H, z0: 0 });
        run++;
        hoardM += seg;
      }
    }
    mkStatic(fr, uni, true, 450, 'hoard_' + hi);
  });

  // lampu jalan lama (tiang polos world.js) diganti lampu LED baru
  if (types.has('lamp') && W.lamps) W.lamps.visible = false;
  scene.add(group);
  group.updateMatrixWorld(true);

  // ---------- pemilahan LOD per jarak (dipanggil tiap frame, kerja hanya saat kamera pindah / zoom / bayangan dihitung ulang)
  const last = new THREE.Vector3(Infinity, 0, 0);
  let lastK = 0, wasShadow = false;
  const TAN0 = Math.tan(37.5 * Math.PI / 180);
  function repartition(cx, cy, cz, k, wide) {
    for (const C of combos) { C.nS = 0; C.nN = 0; }
    for (const T of types.values()) {
      const R0 = T.range, nr = R0.length, n = T.list.length, has = T.has, ML = models[T.name];
      const lim = R0.map((r) => { const rr = r * k; return rr * rr; });
      if (wide) for (let li = nr > 1 ? 1 : 0; li < nr; li++) lim[li] = Math.max(lim[li], 380 * 380); // satu frame: benda di sekitar ikut peta bayangan
      for (let j = 0; j < n; j++) {
        const dx = T.pos[j * 3] - cx, dy = T.pos[j * 3 + 1] - cy, dz = T.pos[j * 3 + 2] - cz, d2 = dx * dx + dy * dy * 0.5 + dz * dz;
        let li = 0;
        while (li < nr && d2 > lim[li]) li++;
        while (li < nr && !has[li]) li++;
        if (li >= nr) continue;
        const C = T.combo[li], part = T.partOf[li];
        if (C.solid && ML[li].solid) { const c = C.nS++; C.solid.instanceMatrix.array.set(T.mtx.subarray(j * 16, j * 16 + 16), c * 16); C.solid.geometry.attributes.aVar.array[c] = T.var[j]; C.solid.geometry.attributes.aPart.array[c] = part; }
        if (C.net && ML[li].net) { const c = C.nN++; C.net.instanceMatrix.array.set(T.mtx.subarray(j * 16, j * 16 + 16), c * 16); C.net.geometry.attributes.aVar.array[c] = T.var[j]; C.net.geometry.attributes.aPart.array[c] = part; }
      }
    }
    for (const C of combos) {
      for (const [im, c] of [[C.solid, C.nS], [C.net, C.nN]]) {
        if (!im) continue;
        im.count = c;
        im.visible = c > 0;
        if (!c) continue;
        im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, c * 16); im.instanceMatrix.needsUpdate = true;
        for (const nm of ['aVar', 'aPart']) { const at = im.geometry.attributes[nm]; at.clearUpdateRanges(); at.addUpdateRange(0, c); at.needsUpdate = true; }
      }
    }
  }
  const stats = { instances: inst.filter((o) => o.ok).length, dropped, obstacles: obstacles.length, meshes: drawMeshes, cables: cables.spans, statics: statics.length, fenceM: Math.round(fenceM), hoardM: Math.round(hoardM), types: types.size, combos: combos.length };
  return {
    obstacles, group, stats, atlas: atlas.canvas, types,
    // tiap frame sebelum scene.updateMatrixWorld() (main.js): waktu efek, lebar kabel, pemilahan jarak
    update(cam = camera, t = performance.now() / 1000) {
      U.time.value = t;
      const fov = cam.fov || 75, k = TAN0 / Math.tan(fov * Math.PI / 360);
      U.px.value = 0.55 * 2 * Math.tan(fov * Math.PI / 360) / Math.max(1, renderer.domElement.height);
      const p = cam.position, shadow = renderer.shadowMap.enabled && renderer.shadowMap.needsUpdate;
      if (shadow || wasShadow || last.distanceToSquared(p) > 64 || Math.abs(k - lastK) > lastK * 0.15) {
        repartition(p.x, p.y, p.z, k, shadow);
        for (const st of statics) { const d = Math.hypot(st.x - p.x, st.z - p.z) - st.r, lim = (shadow ? Math.max(st.far, 380) : st.far) * k; st.mesh.visible = d < lim && p.y < lim; }
        last.copy(p);
        lastK = k;
        wasShadow = shadow;
      }
    },
  };
}
