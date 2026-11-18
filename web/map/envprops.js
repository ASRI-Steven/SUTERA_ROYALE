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
const STATIC_R = 450; // jarak gambar benda statis per petak (m, × zoom)
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
const AW = 2048, AH = 1536;
const AD = { x: 0, y: 0, w: 512, h: 256, cols: 4, n: 8 };      // 8 iklan 2:1
const NM = { x: 0, y: 512, w: 512, h: 51, cols: 4, n: 40 };    // nama cluster (balok gapura ±10:1)
const CELL = {
  satpam: [0, 1024, 512, 80], land: [0, 1104, 512, 96], loop: [512, 1024, 160, 210], fuel: [672, 1024, 192, 165],
  price: [864, 1024, 176, 286], sutet: [1040, 1024, 160, 115], bts: [1200, 1024, 192, 120], crane: [1392, 1024, 640, 120],
  timer: [512, 1234, 96, 80], media: [608, 1234, 256, 54], bin_o: [864, 1310, 128, 96], bin_a: [992, 1310, 128, 96],
  pump: [1120, 1310, 160, 120], hoard: [1280, 1144, 768, 154], zinc: [1280, 1298, 256, 96], zinc2: [256, 1200, 256, 96],
  hoard2: [1536, 1298, 512, 102], hoard3: [1536, 1400, 512, 102], hoard4: [1024, 1430, 512, 102], stone: [0, 1200, 256, 128],
  white: [0, 1512, 16, 16],
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
    grad(x, y, NM.w, NM.h, '#2c2a27', '#1b1a18', true);
    g.fillStyle = 'rgba(210,159,82,.7)'; g.fillRect(x + 8, y + 4, NM.w - 16, 1.5); g.fillRect(x + 8, y + NM.h - 6, NM.w - 16, 1.5);
    if (!names[i]) continue;
    const t = names[i].toUpperCase().split('').join(String.fromCharCode(8202)); // huruf sedikit renggang (gaya papan nama)
    g.save(); g.shadowColor = 'rgba(255,200,120,.55)'; g.shadowBlur = 6;
    text(t, x + NM.w / 2, y + NM.h * 0.52, 34, '#f0c987', '800', 'center', NM.w - 36);
    g.restore();
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
  { const [x, y, w, h] = C('zinc2'); grad(x, y, w, h, '#2f63a6', '#264f86', true); for (let k = 0; k < 24; k++) { const xx = x + k * w / 24, gr = g.createLinearGradient(xx, 0, xx + w / 24, 0); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(0.5, 'rgba(0,0,0,.2)'); gr.addColorStop(1, 'rgba(255,255,255,.18)'); g.fillStyle = gr; g.fillRect(xx, y, w / 24, h); }
    g.fillStyle = '#e8e6df'; g.fillRect(x, y, w, 9); g.fillStyle = 'rgba(110,70,30,.3)'; g.fillRect(x, y + h - 12, w, 12); }
  // spanduk proyek bervariasi (pengembang fiktif)
  { const [x, y, w, h] = C('hoard2'); g.fillStyle = '#ffd400'; g.fillRect(x, y, w, h); g.fillStyle = '#111'; for (let k = 0; k < 16; k++) { g.beginPath(); g.moveTo(x + k * 34, y); g.lineTo(x + k * 34 + 17, y); g.lineTo(x + k * 34 - 3, y + 12); g.lineTo(x + k * 34 - 20, y + 12); g.fill(); g.beginPath(); g.moveTo(x + k * 34, y + h - 12); g.lineTo(x + k * 34 + 17, y + h - 12); g.lineTo(x + k * 34 - 3, y + h); g.lineTo(x + k * 34 - 20, y + h); g.fill(); }
    g.fillStyle = '#1d4f91'; g.beginPath(); g.arc(x + 58, y + h / 2, 30, Math.PI, 0); g.fill(); g.fillRect(x + 22, y + h / 2, 72, 9);
    text('UTAMAKAN KESELAMATAN', x + w * 0.58, y + h * 0.42, 30, '#111', '900', 'center', w * 0.72); text('Area proyek · Wajib helm & sepatu', x + w * 0.58, y + h * 0.7, 17, '#111', '800', 'center', w * 0.72); }
  { const [x, y, w, h] = C('hoard3'); grad(x, y, w, h, '#f4f1ea', '#ddd8cc', true); g.fillStyle = '#1d4f91'; g.fillRect(x, y, w * 0.36, h);
    for (let k = 0; k < 7; k++) { const bw = 18 + (k * 7) % 14, bh = 30 + (k * 13) % 44; g.fillStyle = k % 2 ? '#9fb7d6' : '#c9d6e6'; g.fillRect(x + 14 + k * 24, y + h - 12 - bh, bw, bh); }
    text('SEGERA HADIR', x + w * 0.68, y + h * 0.32, 30, '#1d4f91', '900', 'center', w * 0.6); text('Apartemen & ruko · Sutera Land', x + w * 0.68, y + h * 0.62, 17, '#555', '800', 'center', w * 0.6); g.fillStyle = '#d29f52'; g.fillRect(x + w * 0.42, y + h - 14, w * 0.5, 4); }
  { const [x, y, w, h] = C('hoard4'); grad(x, y, w, h, '#16325c', '#0d2242'); g.fillStyle = '#d29f52'; g.fillRect(x, y + h - 8, w, 8);
    text('★', x + 46, y + h / 2, 54, '#d29f52', '900'); text('SUTERA LAND', x + w * 0.5, y + h * 0.4, 38, '#ffffff', '900', 'center', w * 0.62); text('Membangun kawasan sejak 1994', x + w * 0.5, y + h * 0.7, 16, '#c9d6e6', '700', 'center', w * 0.62); }
  // kulit batu alam (tembok & pilar gapura)
  { const [x, y, w, h] = C('stone'); g.fillStyle = '#4b4741'; g.fillRect(x, y, w, h); let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let row = 0, yy = y + 2; yy < y + h - 4; row++) { const rh = 14 + rnd() * 14; let xx = x + (row % 2 ? -10 : 0); while (xx < x + w) { const rw = 26 + rnd() * 38, c = 92 + rnd() * 70; g.fillStyle = `rgb(${c},${c * 0.93},${c * 0.84})`; g.fillRect(Math.max(x, xx + 1.5), yy + 1.5, Math.min(rw - 3, x + w - xx - 1.5), rh - 3); xx += rw; } yy += rh; } }
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
// jenis permukaan untuk tekstur detail foto di shader (fx bit 4–6): 1 beton, 2 plester/cat, 3 logam, 4 batu, 5 kayu,
// 6 plastik/karet (0 = mulus: kaca, lensa, layar, tulisan)
const SURF = {
  concrete: 1, concrete_pole: 1, gravel: 1, soil: 1, plaster: 2, paint_cream: 2, paint_white: 2, tile_roof: 2, paint_red: 2,
  paint_orange: 2, paint_yellow: 2, paint_green: 2, paint_blue: 2, paint_purple: 2, paint_black: 2, galv: 3, galv_old: 3,
  steel: 3, steel_dark: 3, grate: 3, alu: 3, housing: 3, paint_grey: 3, paint_gold: 3, stone: 4, stone_dark: 4, wood: 5,
  wood_dark: 5, plastic_green: 6, plastic_yellow: 6, plastic_blue: 6, plastic_red: 6, rubber: 6,
};
// satu primitif GLB → geometri berisi atribut standar + pbr (AO, kasar, logam, pijar) + fx (kode efek | permukaan << 4)
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
    fx[i] = code | ((SURF[name] || 0) << 4);
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
varying float vSurf;
varying float vVar;
varying float vH;
varying float vRnd;
varying vec3 vWPos;
varying vec3 vWNrm;
`;
const SHADER_FS = `
uniform float uTime, uNight;
varying vec4 vPbr;
varying float vFx;
varying float vSurf;
varying float vVar;
varying float vH;
varying float vRnd;
varying vec3 vWPos;
varying vec3 vWNrm;
#ifdef ENV_DETAIL
uniform sampler2D tDetA, tDetN, tDetR, tPlA, tPlN;
uniform vec4 uDet; // ubin beton, ubin plester (m), rata-rata hijau beton, plester
// normal detail dari turunan layar (tanpa tangen): uv = koordinat dunia terproyeksi
vec3 detailNormal(vec3 n, vec3 p, vec2 uv, vec3 nm) {
  vec3 q0 = dFdx(p), q1 = dFdy(p);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (nm.x * sc) + B * (nm.y * sc) + n * nm.z);
}
#endif
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
  const det = R && R.sets.slab && R.sets.plaster ? R.sets : null;
  if (det) { // tekstur foto yang sudah dimuat mode realistis (map/realism.js), tanpa unduhan tambahan
    m.defines = { ENV_DETAIL: '' };
    const mean = (t) => { try { const c = document.createElement('canvas'); c.width = c.height = 4; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(t.image, 0, 0, 4, 4); const d = x.getImageData(0, 0, 4, 4).data; let sum = 0; for (let i = 1; i < d.length; i += 4) sum += d[i]; return Math.max(0.05, Math.pow(sum / 16 / 255, 2.2)); } catch (e) { return 0.4; } };
    U.det = { tDetA: { value: det.slab.map }, tDetN: { value: det.slab.normalMap }, tDetR: { value: det.slab.roughnessMap || det.slab.map }, tPlA: { value: det.plaster.map }, tPlN: { value: det.plaster.normalMap },
      uDet: { value: new THREE.Vector4(det.slab.tile, det.plaster.tile, mean(det.slab.map), mean(det.plaster.map)) } };
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time; sh.uniforms.uNight = U.night;
    if (U.det) Object.assign(sh.uniforms, U.det);
    sh.vertexShader = SHADER_VS + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  vPbr = pbr; vFx = mod(fx, 16.0); vSurf = floor(fx / 16.0 + 0.01); vVar = aVar;
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
    float cell = -1.0, cols = 1.0, fxc = mod(fx, 16.0); vec2 pitch = vec2(0.0);
    if (fxc > 4.5 && fxc < 5.5) { cell = mod(floor(uTime / 6.5 + aVar * 3.0), ${AD.n}.0); cols = ${AD.cols}.0; pitch = vec2(${AD.w / AW}, ${-AD.h / AH}); }
    else if (fxc > 5.5 && fxc < 6.5) { cell = mod(aVar, ${AD.n}.0); cols = ${AD.cols}.0; pitch = vec2(${AD.w / AW}, ${-AD.h / AH}); }
    else if (fxc > 6.5 && fxc < 7.5) { cell = mod(aVar, ${NM.n}.0); cols = ${NM.cols}.0; pitch = vec2(${NM.w / AW}, ${-NM.h / AH}); }
    if (cell >= 0.0) vMapUv += vec2(mod(cell, cols), floor(cell / cols)) * pitch;
  }
  #endif`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  {
    vec4 wp = vec4(transformed, 1.0);
    vec3 wn = objectNormal;
    vec2 ip = vec2(0.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
      wn = mat3(instanceMatrix) * wn;
      ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    #endif
    wp = modelMatrix * wp;
    vWPos = wp.xyz;
    vWNrm = normalize(mat3(modelMatrix) * wn);
    vH = wp.y;
    vRnd = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453); // variasi warna per instans
  }`);
    sh.fragmentShader = SHADER_FS + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  // permukaan nyata: tekstur foto (beton / plester) diproyeksikan di koordinat dunia, kotor di dekat tanah, karat di logam,
  // variasi kecil per instans; kode efek (lampu, layar, tulisan) tidak disentuh
  float wDirt = 0.0, dRough = 0.0, nz = 0.0;
  vec2 dUv = vec2(0.0);
  float wP = 0.0, kN = 0.0;
  if (vFx < 0.5) {
    #ifdef ENV_DETAIL
      vec3 an = abs(vWNrm);
      dUv = an.y > max(an.x, an.z) ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
      vec3 cA = texture2D(tDetA, dUv / uDet.x).rgb, pA = texture2D(tPlA, dUv / uDet.y).rgb;
      float cR = texture2D(tDetR, dUv / uDet.x).g;
      nz = cA.g / uDet.z - 1.0;
      // beton tegak (tiang, dinding cor) memakai tekstur plester: tekstur ubin beton punya nat yang tampak seperti
      // sambungan pada tiang; ubin beton hanya untuk muka datar (alas, puncak)
      float cv = vSurf > 0.5 && vSurf < 1.5 && an.y < 0.6 ? 1.0 : 0.0;
      wP = (vSurf > 1.5 && vSurf < 2.5) || vSurf > 4.5 || cv > 0.5 ? 1.0 : 0.0;
      float k = vSurf < 0.5 ? 0.0 : vSurf < 1.5 ? (cv > 0.5 ? 0.45 : 0.62) : vSurf < 2.5 ? 0.3 : vSurf < 3.5 ? 0.18 : vSurf < 4.5 ? 0.55 : 0.2;
      vec3 det = mix(cA / uDet.z, pA / uDet.w, wP);
      diffuseColor.rgb *= mix(vec3(1.0), clamp(det, 0.35, 1.9), k);
      kN = vSurf < 0.5 ? 0.0 : vSurf < 1.5 ? (cv > 0.5 ? 0.5 : 0.9) : vSurf < 2.5 ? 0.45 : vSurf < 3.5 ? 0.25 : vSurf < 4.5 ? 1.1 : 0.3;
      dRough = vSurf > 0.5 && vSurf < 4.5 && wP < 0.5 ? (cR - 0.5) * (vSurf > 2.5 && vSurf < 3.5 ? 0.45 : 0.3) : 0.0;
    #endif
    float hz = 0.9 + 0.45 * nz;
    wDirt = 1.0 - smoothstep(0.02, hz, vH);
    diffuseColor.rgb *= mix(1.0, 0.7 + 0.08 * nz, wDirt);
    if (vSurf > 2.5 && vSurf < 3.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.19, 0.11) * (0.8 + 0.4 * nz), clamp(wDirt * (0.25 + 0.5 * nz), 0.0, 0.45)); // karat di kaki
    diffuseColor.rgb *= 0.95 + 0.1 * vRnd;
  }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(vPbr.y + dRough + wDirt * 0.15, 0.04, 1.0);')
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
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  #ifdef ENV_DETAIL
    if (kN > 0.0) {
      vec3 nm = mix(texture2D(tDetN, dUv / uDet.x).xyz, texture2D(tPlN, dUv / uDet.y).xyz, wP) * 2.0 - 1.0;
      nm.xy *= kN;
      normal = detailNormal(normal, -vViewPosition, dUv, normalize(nm));
    }
  #endif`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  { float ao = vPbr.x; reflectedLight.indirectDiffuse *= ao; reflectedLight.indirectSpecular *= mix(1.0, ao, 0.85); reflectedLight.directDiffuse *= mix(1.0, ao, 0.4); reflectedLight.directSpecular *= mix(1.0, ao, 0.4); }`);
  };
  m.customProgramCacheKey = () => 'envprops2' + (det ? 'D' : '');
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
    sh.vertexShader = 'attribute vec3 cdir;\nattribute float cside;\nattribute float crad;\nattribute vec3 cmid;\nattribute float cfar;\nuniform float uPx;\n' + sh.vertexShader
      .replace('#include <project_vertex>', `
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  if (length((modelViewMatrix * vec4(cmid, 1.0)).xyz) > cfar) mvPosition = vec4(0.0, 0.0, 1.0, 1.0); // bentang jauh: diciutkan (di belakang kamera)
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
// homes (opsional, map/interiors.js planHomes): pintu gedung — benda yang menghalangi jalan masuk tidak dipasang
export function createEnvProps(W, A, col, homes) {
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
  // titik 0,8 m di luar tiap pintu gedung (sel 8 m): benda lingkungan tidak boleh menutup jalan masuk
  const doorG = new Map(), DC = 8, dk = (x, y) => Math.floor(x / DC) * 100003 + Math.floor(y / DC);
  if (homes) for (const H of homes.values()) for (const d of H.doors || []) {
    const e = d.e, s0 = (d.s0 + d.s1) / 2, x = e.a[0] + e.ux * s0 - e.nx * 0.8, y = e.a[1] + e.uy * s0 - e.ny * 0.8, k = dk(x, y);
    (doorG.get(k) || doorG.set(k, []).get(k)).push(x, y);
  }
  const nearDoor = (x, y, r) => {
    for (let cx = Math.floor((x - r) / DC); cx <= Math.floor((x + r) / DC); cx++) for (let cy = Math.floor((y - r) / DC); cy <= Math.floor((y + r) / DC); cy++) {
      const L = doorG.get(cx * 100003 + cy);
      if (L) for (let i = 0; i < L.length; i += 2) if (Math.hypot(L[i] - x, L[i + 1] - y) < r) return true;
    }
    return false;
  };
  // tiang antena atap: duduk di lantai atap menara (map/world.js D.roofs → col.roofAt), mundur ke tengah atap bila di
  // parapet atau terhalang penthouse/AC
  if (col.roofAt) for (const o of inst) {
    if (o.z < 0.5) continue;
    for (let k = 0; k < 14; k++) {
      const x = o.x - o.fx * k * 1.5, y = o.y - o.fy * k * 1.5, z = col.roofAt(x, y, 1e4);
      if (z > 0.5 && !col.blocked(x, y, 1.4, z)) { o.x = x; o.y = y; o.z = z; break; }
    }
  }
  // audit akhir terhadap dunia yang sebenarnya (sebelum rintangan modul ini didaftarkan): benda darat dibuang bila
  // tubuhnya menumpuk pohon/gedung/dinding/air (benda padat menembus benda padat), menutup pintu, atau berdiri di lajur
  // jalan (> 0,25 m masuk aspal). SUTET dikecualikan dari gedung (kaki lebar, dicek di ekstraktor).
  const onLane = (x, y, pad) => {
    let hit = false;
    col.near(x, y, 12, (c) => { if (hit) return; for (const si of c.s) { const s = col.segs[si]; if (s.w < 3) continue; const dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy, t = L > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / L)) : 0; if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) < s.w / 2 - pad) { hit = true; return; } } });
    return hit;
  };
  let dropped = 0;
  const dropBy = {};
  for (const o of inst) {
    if (o.top || o.z > 0.5) continue;
    const C = MAN[o.m] && MAN[o.m].col;
    if (!C || !C.length || !inArea(o.x, o.y)) continue;
    let bad = false;
    for (const c of C) {
      if (c.z0 > 1.9) continue;
      let x, y, r, rd;
      if (c.c) { [x, y] = P(o, c.c[0], c.c[1]); r = c.c[2]; rd = r; }
      else if (c.b) { [x, y] = P(o, c.b[0], c.b[1]); r = Math.min(c.b[2], c.b[3]) / 2; rd = Math.max(c.b[2], c.b[3]) / 2; }
      else continue;
      if (nearTree(x, y, r + 0.05) || nearDoor(x, y, rd + 0.7) || col.waterAt(x, y) || onLane(x, y, 0.25)) bad = true;
      else if (o.k !== 'sutet' && (col.inBuilding(x, y) >= 0 || col.blocked(x, y, Math.min(r, 0.2)))) bad = true;
      if (bad) break;
    }
    if (bad) { o.ok = false; dropped++; dropBy[o.k] = (dropBy[o.k] || 0) + 1; }
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
    if (o.k === 'net') { // net lapangan (lebar diskala per lapangan): tiang + jaring menahan pejalan (peluru tembus via h rendah)
      const hw = 6.4 * o.s, pts = [];
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(...P(o, sx * (hw + 0.05), sy * 0.06));
      obstacles.push({ pts, h: 1.07, z0: 0 });
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

  // ---------- kabel (SUTET, tiang listrik, sambungan rumah): satu mesh; tiap bentang menghilang di luar jarak cfar
  // (dihitung shader dari titik tengah bentang: kabel tiang ≤ 450 m, SUTET ≤ 2,6 km)
  const addStatic = (mesh) => { mesh.matrixAutoUpdate = false; group.add(mesh); drawMeshes++; };
  const cables = { spans: 0 };
  {
    const B = { pos: [], dir: [], side: [], rad: [], col: [], mid: [], far: [], idx: [] };
    const add = (ax, ay, az, bx, by, bz, sag, r, c, n, far) => {
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 0.5) return;
      const base = B.pos.length / 3, mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2 - sag;
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t - 4 * sag * t * (1 - t);
        const dz = (bz - az) - 4 * sag * (1 - 2 * t), dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy, dz) || 1;
        for (const s of [-1, 1]) { B.pos.push(x, z, -y); B.dir.push(dx / dl, dz / dl, -dy / dl); B.side.push(s); B.rad.push(r); B.col.push(c[0], c[1], c[2]); B.mid.push(mx, mz, -my); B.far.push(far); }
        if (k < n) { const v = base + k * 2; B.idx.push(v, v + 3, v + 1, v, v + 2, v + 3); } // berlawanan jarum jam dilihat kamera (sisi pita mengikuti arah pandang)
      }
    };
    const AL = [0.32, 0.34, 0.36], BLACK = [0.018, 0.018, 0.02], anchorsOf = (o, list) => list.map(([ax, ay, az]) => { const [x, y] = P(o, ax, ay); return [x, y, az + o.z]; });
    for (const ch of D.cables || []) {
      const list = ch.i.map((i) => byKey.get(ch.k + ':' + i)).filter((o) => o && o.ok);
      for (let k = 0; k + 1 < list.length; k++) {
        const A0 = list[k], B0 = list[k + 1], an = MAN[A0.m].anchors, bn = MAN[B0.m].anchors;
        if (!an || !bn) continue;
        const L = Math.hypot(B0.x - A0.x, B0.y - A0.y);
        if (ch.k === 'sutet') {
          if (L > 900) continue;
          const ca = anchorsOf(A0, an.cond), cb = anchorsOf(B0, bn.cond), ea = anchorsOf(A0, an.earth), eb = anchorsOf(B0, bn.earth);
          const n = Math.max(10, Math.min(28, Math.round(L / 14))), sag = L * L * 0.000085;
          for (let j = 0; j < Math.min(ca.length, cb.length); j++) add(...ca[j], ...cb[j], sag, 0.016, AL, n, 2600);
          for (let j = 0; j < Math.min(ea.length, eb.length); j++) add(...ea[j], ...eb[j], sag * 0.85, 0.008, AL, n, 2600);
        } else {
          if (L > 70) continue;
          const sag = 0.25 + L * L * 0.00035, n = 8;
          for (const kk of ['mv', 'lv', 'tel']) {
            const a = anchorsOf(A0, an[kk] || []), b = anchorsOf(B0, bn[kk] || []);
            for (let j = 0; j < Math.min(a.length, b.length); j++) add(...a[j], ...b[j], kk === 'mv' ? sag * 0.8 : sag * 1.25, kk === 'mv' ? 0.006 : kk === 'lv' ? 0.016 : 0.009, kk === 'mv' ? AL : BLACK, n, 450);
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
      add(ax, ay, az, x * M, y * M, h * M, 0.35, 0.007, BLACK, 6, 300);
      cables.spans++;
    }
    if (B.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('cdir', new THREE.Float32BufferAttribute(B.dir, 3));
      g.setAttribute('cside', new THREE.Float32BufferAttribute(B.side, 1));
      g.setAttribute('crad', new THREE.Float32BufferAttribute(B.rad, 1));
      g.setAttribute('cmid', new THREE.Float32BufferAttribute(B.mid, 3));
      g.setAttribute('cfar', new THREE.Float32BufferAttribute(B.far, 1));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(B.pos.length), 3));
      g.setIndex(B.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
      const mesh = new THREE.Mesh(g, cableMat);
      mesh.name = 'cables';
      mesh.frustumCulled = false;
      addStatic(mesh);
    }
  }

  // ---------- pagar kawat (lapangan, BTS) + pagar seng proyek: semua rangka satu mesh, semua jaring satu mesh
  const white = cellUV('white'), wu = (white[0] + white[2]) / 2, wv = (white[1] + white[3]) / 2;
  const newBuf = (pbr) => ({ pos: [], nor: [], col: [], uv: [], pbr: pbr ? [] : null, fx: pbr ? [] : null });
  // benda statis (pagar, pagar seng, gapura, tembok) dikumpulkan per petak 320 m: petak jauh (> 450 m) & di luar
  // pandang tidak digambar; 'use(x, y)' memilih penampung petak untuk benda berikutnya
  let fr = null, nt = null;
  const SCH = 320, chunks = new Map();
  const use = (x, y) => { const k = Math.floor(x / SCH) * 4096 + Math.floor(y / SCH); let c = chunks.get(k); if (!c) chunks.set(k, (c = { fr: newBuf(true), nt: newBuf(false) })); fr = c.fr; nt = c.nt; };
  const quadTo = (B, a, b, c, d, n, colr, uvs, pb, f) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = [a, b, c, d][k];
      B.pos.push(p[0], p[2], -p[1]); B.nor.push(n[0], n[2], -n[1]); B.col.push(colr[0], colr[1], colr[2]);
      B.uv.push(uvs[k][0], uvs[k][1]);
      if (B.pbr) { B.pbr.push(...pb); B.fx.push(f); }
    }
  };
  const W4 = [[wu, wv], [wu, wv], [wu, wv], [wu, wv]];
  // kotak sejajar (ux, uy), panjang 2hl, lebar 2hw; f = kode fx; tex = sel atlas untuk sisi tegak (dipotong sebanding
  // ukuran nyata 'cm' m per sel supaya tekstur tidak melar)
  const boxTo = (B, cx, cy, z0, z1, ux, uy, hl, hw, colr, pb, f = 0, tex = null, cm = 1.6) => {
    const vx = -uy, vy = ux, C4 = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([a, b]) => [cx + ux * a + vx * b, cy + uy * a + vy * b]);
    for (let j = 0; j < 4; j++) {
      const p = C4[j], q2 = C4[(j + 1) % 4], ex = q2[0] - p[0], ey = q2[1] - p[1], l = Math.hypot(ex, ey) || 1;
      let U = W4;
      if (tex) { const fu = Math.min(1, l / cm), fv = Math.min(1, (z1 - z0) / (cm / 2)), o = (j * 0.37) % (1 - fu || 1); U = [[tex[0] + (tex[2] - tex[0]) * o, tex[1]], [tex[0] + (tex[2] - tex[0]) * (o + fu), tex[1]], [tex[0] + (tex[2] - tex[0]) * (o + fu), tex[1] + (tex[3] - tex[1]) * fv], [tex[0] + (tex[2] - tex[0]) * o, tex[1] + (tex[3] - tex[1]) * fv]]; }
      quadTo(B, [p[0], p[1], z0], [q2[0], q2[1], z0], [q2[0], q2[1], z1], [p[0], p[1], z1], [ey / l, -ex / l, 0], colr, U, pb, f);
    }
    quadTo(B, [C4[0][0], C4[0][1], z1], [C4[1][0], C4[1][1], z1], [C4[2][0], C4[2][1], z1], [C4[3][0], C4[3][1], z1], [0, 0, 1], colr, W4, pb, f);
  };
  const mkStatic = (B, mat, withPbr, name) => {
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
    addStatic(mesh);
    return mesh;
  };
  const GALV = [0.42, 0.44, 0.46], PB_GALV = [255, 115, 200, 0], ZINC = [0.62, 0.64, 0.66], PB_ZINC = [255, 110, 170, 0];
  const S_METAL = 3 << 4, S_PLASTER = 2 << 4, S_STONE = 4 << 4; // kode permukaan (fx bit 4–6) untuk tekstur detail
  const roadNear = (x, y, pad) => { let hit = false; col.near(x, y, 14, (c) => { if (hit) return; for (const si of c.s) { const s = col.segs[si], dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy, t = L > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / L)) : 0; if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) < s.w / 2 + pad) { hit = true; return; } } }); return hit; };
  const freeAt = (x, y) => inArea(x, y) && !roadNear(x, y, 0.4) && col.inBuilding(x, y) < 0 && !col.waterAt(x, y) && !nearDoor(x, y, 1.6);
  let fenceM = 0, hoardM = 0;
  (D.fences || []).forEach((F) => {
    const p = F.p, n = p.length / 2, H = F.h * M, wire = !!F.wire, gate = F.gate, PH = H + (wire ? 0.45 : 0.05);
    let prev = null, pu = null, first = null;
    const endPost = () => { if (prev) boxTo(fr, prev[0], prev[1], 0, PH, pu[0], pu[1], 0.03, 0.03, GALV, PB_GALV, S_METAL); prev = null; }; // tiang ujung deret
    for (let e = 0; e < n; e++) {
      const ax = p[e * 2] * M, ay = p[e * 2 + 1] * M, bx = p[((e + 1) % n) * 2] * M, by = p[((e + 1) % n) * 2 + 1] * M, L = Math.hypot(bx - ax, by - ay);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L, k = Math.max(1, Math.ceil(L / 2.6)), seg = L / k;
      const g0 = gate && gate[0] === e ? L * gate[1] - gate[2] / 2 : -1, g1 = gate && gate[0] === e ? L * gate[1] + gate[2] / 2 : -1;
      for (let j = 0; j < k; j++) {
        const s0 = j * seg, s1 = s0 + seg, mx = ax + ux * (s0 + s1) / 2, my = ay + uy * (s0 + s1) / 2;
        if (!freeAt(mx, my)) { endPost(); continue; }
        use(mx, my);
        const px0 = ax + ux * s0, py0 = ay + uy * s0;
        if (prev && Math.hypot(prev[0] - px0, prev[1] - py0) > 0.05) endPost();
        boxTo(fr, px0, py0, 0, PH, ux, uy, 0.03, 0.03, GALV, PB_GALV, S_METAL); // tiang
        if (!first) first = [px0, py0];
        prev = [ax + ux * s1, ay + uy * s1]; pu = [ux, uy];
        if (s1 > g0 && s0 < g1) continue; // pintu
        const q0 = [px0, py0], q1 = [ax + ux * s1, ay + uy * s1], nn = [uy, -ux, 0];
        const uvs = [[0, 0.05 / 0.07], [seg / 0.07, 0.05 / 0.07], [seg / 0.07, (H - 0.05) / 0.07], [0, (H - 0.05) / 0.07]];
        quadTo(nt, [q0[0], q0[1], 0.05], [q1[0], q1[1], 0.05], [q1[0], q1[1], H - 0.05], [q0[0], q0[1], H - 0.05], nn, GALV, uvs);
        boxTo(fr, (q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, H - 0.06, H, ux, uy, seg / 2, 0.025, GALV, PB_GALV, S_METAL); // pipa atas
        if (wire) for (let w = 0; w < 3; w++) boxTo(fr, (q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, H + 0.12 + w * 0.13, H + 0.13 + w * 0.13, ux, uy, seg / 2, 0.006, [0.3, 0.3, 0.3], PB_GALV); // kawat duri
        obstacles.push({ pts: [q0[0] - uy * 0.05, q0[1] + ux * 0.05, q1[0] - uy * 0.05, q1[1] + ux * 0.05, q1[0] + uy * 0.05, q1[1] - ux * 0.05, q0[0] + uy * 0.05, q0[1] - ux * 0.05], h: H, z0: 0 });
        fenceM += seg;
      }
    }
    if (prev && !(first && Math.hypot(prev[0] - first[0], prev[1] - first[1]) < 0.05)) endPost();
  });
  // pagar seng proyek: panel seng 2,4 m (polos / biru, dari atlas) dengan sesekali spanduk pengembang fiktif (4 desain,
  // 2–3 panel); tidak menembus jalan, gedung, halaman rumah warga (≤ 2,5 m dari rumah), air, pohon; celah 7 m di sisi
  // terdekat jalan; tabrakan menerus (kotak per panel + tiang di tiap sambungan)
  const hsh = (x, y, k) => { const t = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return t - Math.floor(t); };
  const BAN = [['hoard', 3], ['hoard2', 2], ['hoard3', 2], ['hoard4', 2]].map(([k, n]) => ({ uv: cellUV(k), n }));
  const zincUV = cellUV('zinc'), zinc2UV = cellUV('zinc2');
  const uvSpan = (cu, a, b) => [[cu[0] + (cu[2] - cu[0]) * a, cu[1]], [cu[0] + (cu[2] - cu[0]) * b, cu[1]], [cu[0] + (cu[2] - cu[0]) * b, cu[3]], [cu[0] + (cu[2] - cu[0]) * a, cu[3]]];
  const BK = W.B && W.B.k;
  const nearHouse = (x, y, r) => {
    let hit = false;
    col.near(x, y, r + 1, (c) => {
      if (hit) return;
      for (const pi of c.p) {
        const G = col.polys[pi];
        if (G.b < 0 || !BK || BK[G.b] !== 0 || x < G.x0 - r || x > G.x1 + r || y < G.y0 - r || y > G.y1 + r) continue;
        const a = G.pts;
        for (let i = 0, j = a.length / 2 - 1; i < a.length / 2; j = i++) {
          const ax = a[2 * j], ay = a[2 * j + 1], ex = a[2 * i] - ax, ey = a[2 * i + 1] - ay, L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0;
          if (Math.hypot(x - ax - ex * t, y - ay - ey * t) < r) { hit = true; return; }
        }
      }
    });
    return hit;
  };
  (D.hoards || []).forEach((Hd) => {
    const p = Hd.p, n = p.length / 2, H = 2.4;
    let gateE = -1, gd = Infinity;
    for (let e = 0; e < n; e++) { const mx = (p[e * 2] + p[((e + 1) % n) * 2]) / 2 * M, my = (p[e * 2 + 1] + p[((e + 1) % n) * 2 + 1]) / 2 * M; let d = 99; col.near(mx, my, 30, (c) => { for (const si of c.s) { const s = col.segs[si]; d = Math.min(d, Math.hypot((s.ax + s.bx) / 2 - mx, (s.ay + s.by) / 2 - my)); } }); if (d < gd) { gd = d; gateE = e; } }
    let ban = null, bi = 0, prev = null, pu = null, first = null;
    const POSTC = [0.2, 0.22, 0.25], PB_POST = [255, 140, 120, 0];
    const endPost = () => { if (prev) boxTo(fr, prev[0], prev[1], 0, H + 0.05, pu[0], pu[1], 0.05, 0.07, POSTC, PB_POST, S_METAL); prev = null; }; // tiang ujung deret
    for (let e = 0; e < n; e++) {
      const ax = p[e * 2] * M, ay = p[e * 2 + 1] * M, bx = p[((e + 1) % n) * 2] * M, by = p[((e + 1) % n) * 2 + 1] * M, L = Math.hypot(bx - ax, by - ay);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L, k = Math.max(1, Math.ceil(L / 4.0)), seg = L / k;
      for (let j = 0; j < k; j++) {
        const s0 = j * seg, s1 = s0 + seg, mx = ax + ux * (s0 + s1) / 2, my = ay + uy * (s0 + s1) / 2;
        const q0 = [ax + ux * s0, ay + uy * s0], q1 = [ax + ux * s1, ay + uy * s1];
        const skip = (e === gateE && Math.abs((s0 + s1) / 2 - L / 2) < 3.5) || !freeAt(mx, my) || !freeAt(q0[0], q0[1]) || !freeAt(q1[0], q1[1]) || nearTree(mx, my, 0.15) || nearHouse(mx, my, 2.5);
        if (skip) { ban = null; if (prev) use(prev[0], prev[1]); endPost(); continue; }
        if (prev && Math.hypot(prev[0] - q0[0], prev[1] - q0[1]) > 0.05) { use(prev[0], prev[1]); endPost(); }
        use(mx, my);
        if (!ban && hsh(mx, my, 1) < 0.14) { ban = BAN[Math.floor(hsh(mx, my, 2) * BAN.length) % BAN.length]; bi = 0; }
        const nn = [uy, -ux, 0], blue = hsh(Math.round(mx / 12), Math.round(my / 12), 3) < 0.3, plain = blue ? zinc2UV : zincUV;
        for (const sd of [1, -1]) { // muka luar (kadang berspanduk) & dalam (seng polos)
          const o = 0.02 * sd, a0 = [q0[0] + uy * o, q0[1] - ux * o], a1 = [q1[0] + uy * o, q1[1] - ux * o];
          if (sd > 0) quadTo(fr, [a0[0], a0[1], 0], [a1[0], a1[1], 0], [a1[0], a1[1], H], [a0[0], a0[1], H], nn, ban ? [1, 1, 1] : ZINC, ban ? uvSpan(ban.uv, bi / ban.n, (bi + 1) / ban.n) : uvSpan(plain, 0, 1), ban ? [255, 120, 0, 0] : PB_ZINC, ban ? 0 : S_METAL);
          else quadTo(fr, [a1[0], a1[1], 0], [a0[0], a0[1], 0], [a0[0], a0[1], H], [a1[0], a1[1], H], [-uy, ux, 0], ZINC, uvSpan(zincUV, 0, 1), PB_ZINC, S_METAL);
        }
        if (ban && ++bi >= ban.n) ban = null;
        // tiang di awal tiap panel (juga sambungan sudut) + tiang penutup di ujung deret: tidak ada tepi seng terbuka
        boxTo(fr, q0[0], q0[1], 0, H + 0.05, ux, uy, 0.05, 0.07, POSTC, PB_POST, S_METAL);
        if (!first) first = q0;
        obstacles.push({ pts: [q0[0] - uy * 0.07, q0[1] + ux * 0.07, q1[0] - uy * 0.07, q1[1] + ux * 0.07, q1[0] + uy * 0.07, q1[1] - ux * 0.07, q0[0] + uy * 0.07, q0[1] - ux * 0.07], h: H, z0: 0 });
        obstacles.push({ x: q0[0], y: q0[1], r: 0.09, h: H, z0: 0 });
        prev = q1; pu = [ux, uy];
        hoardM += seg;
      }
    }
    if (prev && !(first && Math.hypot(prev[0] - first[0], prev[1] - first[1]) < 0.05)) { use(prev[0], prev[1]); endPost(); }
  });
  // gapura pintu masuk cluster: dua pilar berkulit batu di kedua tepi jalan, balok melintang bernama (huruf emas
  // berpendar, dua muka), tembok sayap mengikuti batas cluster dengan pilaster tiap ±3 m. Semua padat & menahan peluru;
  // ruang di antara pilar (jalan masuk) tetap lapang, balok di atas kepala (5,5 m).
  const PLASTER = [0.6, 0.55, 0.46], WALLC = [0.66, 0.62, 0.54], TRIM = [0.075, 0.075, 0.08], WHITE = [0.8, 0.79, 0.76], GOLD = [0.78, 0.58, 0.27], STONE = [0.62, 0.6, 0.57];
  const PB_PL = [255, 230, 0, 0], PB_TRIM = [255, 120, 90, 0], PB_ST = [255, 215, 0, 0], PB_GOLD = [255, 80, 210, 0];
  const stoneUV = cellUV('stone');
  const nameRect = (i) => { const c = cellUV('name'), col_ = i % NM.cols, row = Math.floor(i / NM.cols), du = NM.w / AW, dv = NM.h / AH; return [c[0] + col_ * du, c[1] - row * dv, c[2] + col_ * du, c[3] - row * dv]; };
  let gates = 0, wallM = 0;
  const wallSeg = (ax, ay, bx, by) => {
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 0.05) return;
    const ux = (bx - ax) / L, uy = (by - ay) / L, cx = (ax + bx) / 2, cy = (ay + by) / 2;
    for (let s0 = 0; s0 < L - 0.01; s0 += 1.5) { // kaki batu per potong ≤ 1,5 m (tekstur tidak melar)
      const s1 = Math.min(L, s0 + 1.5), mx = ax + ux * (s0 + s1) / 2, my = ay + uy * (s0 + s1) / 2;
      boxTo(fr, mx, my, 0, 0.5, ux, uy, (s1 - s0) / 2, 0.17, STONE, PB_ST, S_STONE, stoneUV);
    }
    boxTo(fr, cx, cy, 0.5, 2.2, ux, uy, L / 2, 0.12, WALLC, PB_PL, S_PLASTER);
    boxTo(fr, cx, cy, 1.55, 1.6, ux, uy, L / 2, 0.125, TRIM, PB_TRIM); // nat horizontal
    boxTo(fr, cx, cy, 2.2, 2.32, ux, uy, L / 2 + 0.02, 0.18, WHITE, PB_PL, S_PLASTER);
    obstacles.push({ pts: [ax - uy * 0.17, ay + ux * 0.17, bx - uy * 0.17, by + ux * 0.17, bx + uy * 0.17, by - ux * 0.17, ax + uy * 0.17, ay - ux * 0.17], h: 2.32, z0: 0 });
    wallM += L;
  };
  const pilaster = (x, y, ux, uy) => {
    boxTo(fr, x, y, 0, 2.45, ux, uy, 0.24, 0.24, STONE, PB_ST, S_STONE, stoneUV, 1.2);
    boxTo(fr, x, y, 2.45, 2.56, ux, uy, 0.28, 0.28, WHITE, PB_PL, S_PLASTER);
    obstacles.push({ x, y, r: 0.3, h: 2.56, z0: 0 });
  };
  // tembok sayap berhenti ≥ 1,5 m sebelum titik pintu gedung (pintu rumah di samping gapura tetap bisa dimasuki)
  const clipWall = (P) => {
    const out = [P[0]];
    let len = 0;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, ay] = P[i], [bx, by] = P[i + 1], L = Math.hypot(bx - ax, by - ay) || 1e-6;
      for (let d = 0; d <= L + 1e-6; d += 0.25) {
        const t = Math.min(d, L) / L, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        if (nearDoor(x, y, 1.5) || !inArea(x, y)) {
          const t2 = Math.max(0, d - 0.5) / L;
          if (len + t2 * L < 2) return [];
          out.push([ax + (bx - ax) * t2, ay + (by - ay) * t2]);
          return out;
        }
      }
      out.push(P[i + 1]); len += L;
    }
    return len < 2 ? [] : out;
  };
  for (const g of D.gates || []) {
    const gx = g.x * M, gy = g.y * M, ga = g.a / 10 * Math.PI / 180, ux = Math.cos(ga), uy = Math.sin(ga), nx = -uy, ny = ux, half = g.h * M;
    if (!inArea(gx, gy)) continue;
    use(gx, gy);
    const PW = 1.3, PH = 6.8, BZ0 = 5.5, BZ1 = 6.7;
    for (const sd of [1, -1]) {
      const px = gx + nx * sd * half, py = gy + ny * sd * half;
      boxTo(fr, px, py, 0, 1.0, ux, uy, 0.76, 0.76, STONE, PB_ST, S_STONE, stoneUV, 1.5);
      boxTo(fr, px, py, 1.0, 1.08, ux, uy, 0.7, 0.7, TRIM, PB_TRIM);
      boxTo(fr, px, py, 1.08, PH - 0.3, ux, uy, PW / 2, PW / 2, PLASTER, PB_PL, S_PLASTER);
      for (const z of [2.4, 3.8]) boxTo(fr, px, py, z, z + 0.05, ux, uy, PW / 2 + 0.02, PW / 2 + 0.02, TRIM, PB_TRIM); // nat dekoratif
      boxTo(fr, px, py, PH - 0.3, PH, ux, uy, PW / 2 + 0.04, PW / 2 + 0.04, TRIM, PB_TRIM);
      boxTo(fr, px, py, PH, PH + 0.16, ux, uy, 0.82, 0.82, WHITE, PB_PL, S_PLASTER);
      boxTo(fr, px, py, PH + 0.16, PH + 0.62, ux, uy, 0.2, 0.2, TRIM, PB_TRIM); // lentera
      boxTo(fr, px, py, PH + 0.24, PH + 0.54, ux, uy, 0.215, 0.13, [1, 0.86, 0.6], [255, 60, 0, 40], FX.glow);
      boxTo(fr, px, py, PH + 0.24, PH + 0.54, ux, uy, 0.13, 0.215, [1, 0.86, 0.6], [255, 60, 0, 40], FX.glow);
      obstacles.push({ pts: [px - ux * 0.76 - nx * 0.76, py - uy * 0.76 - ny * 0.76, px + ux * 0.76 - nx * 0.76, py + uy * 0.76 - ny * 0.76, px + ux * 0.76 + nx * 0.76, py + uy * 0.76 + ny * 0.76, px - ux * 0.76 + nx * 0.76, py - uy * 0.76 + ny * 0.76], h: PH + 0.2, z0: 0 });
      const wl = sd > 0 ? g.wl : g.wr; // tembok sayap (mulai dari muka luar pilar)
      if (wl && wl.length >= 4) {
        const P0 = []; for (let i = 0; i + 1 < wl.length; i += 2) P0.push([wl[i] * M, wl[i + 1] * M]);
        const P = clipWall(P0);
        if (P.length < 2) continue;
        let acc = 0;
        for (let i = 0; i + 1 < P.length; i++) {
          const [ax, ay] = P[i], [bx, by] = P[i + 1], L = Math.hypot(bx - ax, by - ay);
          if (L < 0.05) continue;
          const tx = (bx - ax) / L, ty = (by - ay) / L;
          wallSeg(ax, ay, bx, by);
          if (i > 0) pilaster(ax, ay, tx, ty); // sambungan berbelok: pilaster menutup celah
          for (let d = 3 - (acc % 3); d < L - 0.4; d += 3) pilaster(ax + tx * d, ay + ty * d, tx, ty);
          acc += L;
        }
        const [ex, ey] = P[P.length - 1], [fx0, fy0] = P[P.length - 2], el = Math.hypot(ex - fx0, ey - fy0) || 1;
        pilaster(ex, ey, (ex - fx0) / el, (ey - fy0) / el);
      }
    }
    // balok nama melintang (atas kepala) + atap tipis
    const span = half - PW / 2 + 0.25;
    boxTo(fr, gx, gy, BZ0, BZ1, nx, ny, span, 0.5, TRIM, PB_TRIM, S_STONE);
    boxTo(fr, gx, gy, BZ1, BZ1 + 0.14, nx, ny, half + 0.75, 0.72, WHITE, PB_PL, S_PLASTER);
    boxTo(fr, gx, gy, BZ0 - 0.1, BZ0, nx, ny, span - 0.1, 0.42, WHITE, PB_PL, S_PLASTER);
    obstacles.push({ pts: [gx - nx * span - ux * 0.5, gy - ny * span - uy * 0.5, gx + nx * span - ux * 0.5, gy + ny * span - uy * 0.5, gx + nx * span + ux * 0.5, gy + ny * span + uy * 0.5, gx - nx * span + ux * 0.5, gy - ny * span + uy * 0.5], h: BZ1 + 0.14, z0: BZ0 - 0.1 });
    if (g.n >= 0) {
      const pw = Math.min((half - PW / 2) * 2 * 0.86, 9.5), ph = Math.max(0.45, Math.min(0.8, pw / 9.6)), zc = (BZ0 + BZ1) / 2, r = nameRect(g.n);
      for (const sd of [-1, 1]) { // muka luar (−u, dibaca pengunjung) & dalam (+u)
        const off = sd * 0.515, cx = gx + ux * off, cy = gy + uy * off, rx = sd * nx, ry = sd * ny; // (rx, ry): arah kanan penonton
        const A = [cx - rx * pw / 2, cy - ry * pw / 2], Bp = [cx + rx * pw / 2, cy + ry * pw / 2];
        quadTo(fr, [A[0], A[1], zc - ph / 2], [Bp[0], Bp[1], zc - ph / 2], [Bp[0], Bp[1], zc + ph / 2], [A[0], A[1], zc + ph / 2], [ux * sd, uy * sd, 0], [1, 1, 1], [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], [255, 90, 0, 38], FX.glow);
        for (const [hl, hw2, dz] of [[pw / 2 + 0.06, 0.03, ph / 2 + 0.03], [pw / 2 + 0.06, 0.03, -ph / 2 - 0.03]]) boxTo(fr, cx, cy, zc + dz - 0.03, zc + dz + 0.03, nx, ny, hl, hw2 + 0.01, GOLD, PB_GOLD);
        for (const e of [-1, 1]) boxTo(fr, cx + nx * e * (pw / 2 + 0.06), cy + ny * e * (pw / 2 + 0.06), zc - ph / 2 - 0.06, zc + ph / 2 + 0.06, nx, ny, 0.03, 0.04, GOLD, PB_GOLD);
      }
    }
    gates++;
  }
  const statics = [];
  for (const c of chunks.values()) for (const m of [mkStatic(c.fr, uni, true, 'fences'), mkStatic(c.nt, netMat, false, 'fencenets')]) if (m) statics.push({ m, c: m.boundingSphere.center, r: m.boundingSphere.radius });

  // lampu jalan lama (tiang polos world.js) diganti lampu LED baru
  if (types.has('lamp') && W.lamps) W.lamps.visible = false;
  scene.add(group);
  group.updateMatrixWorld(true);

  // ---------- pemilahan LOD per jarak (dipanggil tiap frame, kerja hanya saat kamera pindah / zoom / bayangan dihitung ulang)
  const last = new THREE.Vector3(Infinity, 0, 0), fwd = new THREE.Vector3(), lastFwd = new THREE.Vector3(), cone = { x: 0, y: 0, z: 0, c2: 0 };
  let lastK = 0, wasShadow = false;
  const TAN0 = Math.tan(37.5 * Math.PI / 180);
  // cone: kamera diperbesar (FOV sempit: lobi, teropong) → hanya benda di dalam kerucut pandang (+ yang sangat dekat)
  function repartition(cx, cy, cz, k, wide, cone) {
    for (const C of combos) { C.nS = 0; C.nN = 0; }
    for (const S of statics) { const d = Math.max(0, Math.hypot(S.c.x - cx, (S.c.y - cy) * 0.7, S.c.z - cz) - S.r); S.m.visible = d < STATIC_R * k || (wide && d < 380); }
    for (const T of types.values()) {
      const R0 = T.range, nr = R0.length, n = T.list.length, has = T.has, ML = models[T.name];
      const lim = R0.map((r) => { const rr = r * k; return rr * rr; });
      if (wide) for (let li = nr > 1 ? 1 : 0; li < nr; li++) lim[li] = Math.max(lim[li], 380 * 380); // satu frame: benda di sekitar ikut peta bayangan
      for (let j = 0; j < n; j++) {
        const dx = T.pos[j * 3] - cx, dy = T.pos[j * 3 + 1] - cy, dz = T.pos[j * 3 + 2] - cz, d2 = dx * dx + dy * dy * 0.5 + dz * dz;
        if (cone && d2 > 900) { const dd = dx * cone.x + dy * cone.y + dz * cone.z; if (dd < 0 || dd * dd < cone.c2 * (dx * dx + dy * dy + dz * dz)) continue; }
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
  const stats = { instances: inst.filter((o) => o.ok).length, dropped, dropBy, obstacles: obstacles.length, meshes: drawMeshes, cables: cables.spans, fenceM: Math.round(fenceM), hoardM: Math.round(hoardM), gates, wallM: Math.round(wallM), types: types.size, combos: combos.length };
  return {
    obstacles, group, stats, atlas: atlas.canvas, types,
    // tiap frame sebelum scene.updateMatrixWorld() (main.js): waktu efek, lebar kabel, pemilahan jarak
    update(cam = camera, t = performance.now() / 1000) {
      U.time.value = t;
      const fov = cam.fov || 75, tz = Math.tan(fov * Math.PI / 360), k = Math.min(4, TAN0 / tz);
      U.px.value = 0.55 * 2 * tz / Math.max(1, renderer.domElement.height);
      const p = cam.position, shadow = renderer.shadowMap.enabled && renderer.shadowMap.needsUpdate, zoom = k > 1.3 && !shadow;
      if (zoom) fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      if (shadow || wasShadow || last.distanceToSquared(p) > 64 || Math.abs(k - lastK) > lastK * 0.15 || (zoom && fwd.dot(lastFwd) < 0.996)) {
        if (zoom) { // kerucut = setengah diagonal FOV + 8°
          const half = Math.atan(tz * Math.hypot(1, cam.aspect || 1.78)) + 0.14, c = Math.cos(Math.min(1.5, half));
          cone.x = fwd.x; cone.y = fwd.y; cone.z = fwd.z; cone.c2 = c * c;
          lastFwd.copy(fwd);
        }
        repartition(p.x, p.y, p.z, k, shadow, zoom ? cone : null);
        last.copy(p);
        lastK = k;
        wasShadow = shadow;
      }
    },
  };
}
