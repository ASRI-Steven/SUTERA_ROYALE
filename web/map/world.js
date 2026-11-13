// Pembangun dunia 3D Alam Sutera: diorama, jalan, gedung, pohon, lampu, langit. Dipakai peta digital twin (alsut3d.js)
// dan game (game/royale.js). Data: web/data/alsut-map.json. Koordinat lokal meter: x timur, y utara; dunia three.js Z = −y.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cleanTrees } from './trees.js';
import { skyDomeMaterial, SKY_GLSL } from './realism.js';
import { makeWaterDepth, WATER } from './water.js';

export const UP = new THREE.Vector3(0, 1, 0);
export const M = 0.1; // desimeter (data) → meter
export const SLAB = 26; // tebal diorama (m)

const ROAD_ORDER = ['pedestrian', 'service', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway_link', 'motorway'];
const ROAD_COLOR = { // aspal: jalan besar lebih gelap
  motorway: '#3d4046', motorway_link: '#43464c', trunk: '#44474d', primary: '#46494f', secondary: '#4a4d53',
  tertiary: '#505359', unclassified: '#5a5d63', residential: '#5c5f65', living_street: '#64676c', service: '#6c6f74', pedestrian: '#bdb5a6',
};
const ROAD_K = { motorway: 0.5, motorway_link: 0.53, trunk: 0.55, primary: 0.56, secondary: 0.6, tertiary: 0.64, unclassified: 0.7, residential: 0.72, living_street: 0.78, service: 0.82 }; // mode realistis: aspal jalan besar lebih gelap/baru
const SIDEWALK = { trunk: 2.4, primary: 2.6, secondary: 2.4, tertiary: 2.0, unclassified: 1.4, residential: 1.4, living_street: 1.0 }; // lebar trotoar per sisi (m)
const EDGE_LINES = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const DASHED = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const GREEN_COLOR = { park: '#7fae62', pitch: '#76ae5c', forest: '#5d8f4b', grass: '#8ab86c', cemetery: '#94a983', golf: '#7ab45d' };
export const PAL = { ground: '#a9b68e', side: '#8a7152', water: '#3f7fae', gold: '#D29F52', hilite: '#DCB677' };
// Warna realistis: dinding krem/putih/abu muda, genteng terakota & abu arang; gedung tinggi berkaca kebiruan.
const WALLS = [
  ['#f3efe6', '#ebe5d9', '#e5e0d6', '#f1ece2', '#dcd6cb', '#eee5d2', '#e8e3da', '#f5f2ec'],
  ['#ebe7df', '#dfdbd3', '#f1ede5', '#d9dde2', '#e6e0d4'],
  ['#a9bfd0', '#a3c3c8', '#b4bfce', '#93abc0', '#bcc7d3'],
  ['#efe6d4', '#e7dcc6', '#f2ece0'],
  ['#d4d6da', '#c9ccd1'],
  ['#cfcac2'],
];
const ROOFS = [
  ['#4b4e55', '#55585f', '#a2563d', '#94503a', '#7a5a46', '#5d6a7a', '#4b4e55', '#a2563d', '#3f4247', '#b36a4a'],
  ['#bfc2c6', '#b4b8bd', '#c8c6c0'],
  ['#9aa7b3', '#8e9caa'],
  ['#8c5a3a', '#2f6b5a', '#7a5a46'],
  ['#a9adb3'],
  ['#9d9890'],
];
const TINTS = ['#c8c9b4', '#c5cbb8', '#cbc7b9', '#c3c8b6', '#cac9bd', '#c6cbbb'];
const CL_GROUND = { residential: '#c3c9b5', commercial: '#cdc9c1', retail: '#cdc9c1', construction: '#c7b495' };
export const SKY = { // [langit atas, cakrawala/kabut, warna matahari, kuat matahari, kuat langit]
  day: ['#b9d6f0', '#e4e9f2', 0xfff3dc, 2.4, 1.25],
  golden: ['#f1c89d', '#f2e0cb', 0xffc684, 2.1, 1.05],
  dusk: ['#4f4a86', '#e3a888', 0xff9a5a, 1.15, 0.8],
  night: ['#141238', '#2a2752', 0xa9b6ff, 0.55, 0.62],
};

export function hash01(a, b) {
  let h = (2166136261 ^ Math.floor(a * 7.31)) >>> 0;
  h = Math.imul(h ^ Math.floor(b * 3.17), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 2246822519); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
export const pickOf = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
export function bounds(pts) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  return { minx, miny, maxx, maxy };
}
export function pip(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}
export function softDot(inner, outer, size = 64) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const x = cv.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.4, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}
// Geser poligon (berlawanan jarum jam) ke dalam sejauh d (d negatif = ke luar). Sudut tajam dibatasi.
export function insetPoly(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const e0 = new THREE.Vector2(p1.x - p0.x, p1.y - p0.y).normalize(), e1 = new THREE.Vector2(p2.x - p1.x, p2.y - p1.y).normalize();
    const n0 = new THREE.Vector2(-e0.y, e0.x), n1 = new THREE.Vector2(-e1.y, e1.x);
    const bis = n0.clone().add(n1), len = bis.length();
    if (len < 1e-6) { out.push(p1.clone().addScaledVector(n1, d)); continue; }
    bis.divideScalar(len);
    out.push(p1.clone().addScaledVector(bis, d / Math.max(bis.dot(n1), 0.35)));
  }
  return out;
}
export function isConvex(pts) {
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1e-6) return false;
  }
  return true;
}

// Tekstur derau abu-abu (bisa diulang) untuk rumput, aspal, paving: dikalikan warna permukaan.
export function noiseTex(kind, tileM) {
  const size = 256, G = 16, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const cx = cv.getContext('2d'), img = cx.createImageData(size, size), d = img.data;
  let seed = { grass: 7, asphalt: 13, paving: 29 }[kind] || 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const low = new Float32Array((G + 1) * (G + 1));
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) low[j * (G + 1) + i] = (i === G || j === G) ? low[(j % G) * (G + 1) + (i % G)] : rnd();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size * G, v = j / size * G, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
      const s0 = fu * fu * (3 - 2 * fu), s1 = fv * fv * (3 - 2 * fv);
      const a = low[iv * (G + 1) + iu], b = low[iv * (G + 1) + iu + 1], c = low[(iv + 1) * (G + 1) + iu], e = low[(iv + 1) * (G + 1) + iu + 1];
      const lf = (a + (b - a) * s0) * (1 - s1) + (c + (e - c) * s0) * s1, hf = rnd() - 0.5;
      let g = kind === 'grass' ? 0.84 + lf * 0.16 + hf * 0.12 : kind === 'asphalt' ? 0.9 + lf * 0.07 + hf * 0.16 : 0.93 + lf * 0.05 + hf * 0.05;
      if (kind === 'paving' && (i % 32 === 0 || j % 32 === 0)) g -= 0.08;
      const k = (j * size + i) * 4, val = Math.max(0, Math.min(255, Math.round(g * 255)));
      d[k] = d[k + 1] = d[k + 2] = val;
      d[k + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.repeat.set(1 / tileM, 1 / tileM);
  return t;
}
// Gradasi gelap-terang per tinggi (pohon: bagian bawah tajuk lebih gelap).
export function shadeY(g, lo, hi) {
  const p = g.attributes.position;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < min) min = y; if (y > max) max = y; }
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = lo + (hi - lo) * (p.getY(i) - min) / ((max - min) || 1); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Tajuk pohon organik: ikosahedron halus yang permukaannya diberi derau (bukan bola licin, bukan bongkahan bersegi).
export function organicCrown(seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const nse = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) * Math.sin(v.z * 3.3 + seed * 0.7);
    v.multiplyScalar(1 + 0.17 * nse + 0.06 * Math.sin((v.x + v.z) * 7 + seed));
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.55; // bawah tajuk lebih rata
    p.setXYZ(i, v.x, v.y * 0.92, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// Mahkota palem: 9 pelepah melengkung (tulang daun lebih tinggi dari tepi) + pangkal pelepah.
export function palmCrown() {
  const parts = [];
  for (let f = 0; f < 9; f++) {
    const pos = [], idx = [], seg = 5, L = 3.8;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, w = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.04, y = 0.55 * t - 1.75 * t * t, x = t * L;
      pos.push(x, y + 0.12 * w, -w, x, y + 0.18, 0, x, y + 0.12 * w, w);
    }
    for (let s = 0; s < seg; s++) { const a = s * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.rotateZ(0.12 * Math.sin(f * 2.3)).rotateY(f * (Math.PI * 2 / 9) + 0.25 * Math.sin(f * 1.7));
    parts.push(g);
  }
  parts.push(mergeVertices(new THREE.IcosahedronGeometry(0.42, 0).deleteAttribute('normal').deleteAttribute('uv')));
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// ---------- Pohon GLB v2 (tools/blender/trees2.py) ----------
// Kartu daun bertekstur (atlas leaves.png, alphaTest + alphaToCoverage) di atas batang & dahan nyata. Jenis per grup data:
// 0 tajuk lebar (trembesi, ketapang kencana, mahoni, flamboyan), 1 palem (palem raja, kelapa), 2 kolom/kerucut (glodokan,
// cemara); semak pucuk merah (D.shrubs, hiasan tanpa tabrakan). LOD0 dekat (≤ TREE_NEAR m), LOD1 sedang (≤ TREE_FAR m),
// LOD2 kartu silang untuk yang jauh sekali (tanpa bayangan); semak hanya dekat.
// Angin: alfa COLOR_0 dipindah ke atribut 'sway' (supaya tidak ikut memotong alfa daun). Daftar pohon = D.trees yang sudah
// dibersihkan map/trees.js (sama dengan collider). Pohon prosedural tetap tampil sampai GLB termuat (atau kalau gagal).
// Hasil: Promise { geos: nama → BufferGeometry (asli, RGBA) } (rumpun ilalang dipakai map/grass.js).
const TREE_URL = 'game/assets/trees/', TREE_NEAR = 230, TREE_FAR = 900, SHRUB_NEAR = 170;
const TREE_SPECIES = [[['trembesi', 0.25], ['ketapang', 0.24], ['mahoni', 0.31], ['flamboyan', 0.2]], [['palem_raja', 0.62], ['kelapa', 0.38]], [['glodokan', 0.7], ['cemara', 0.3]]];
// ukuran sasaran per kelas ukuran data k = 0/1/2: tajuk lebar → jari-jari tajuk (m), lainnya → tinggi (m)
const TREE_SIZE = { trembesi: [4.0, 5.0, 6.0], ketapang: [2.4, 3.0, 3.6], mahoni: [2.6, 3.2, 3.8], flamboyan: [3.3, 4.0, 4.8], palem_raja: [9, 11, 13], kelapa: [7.5, 9, 10.5], glodokan: [6.5, 8.5, 10], cemara: [7, 9, 11] };
function pickSpecies(list, r) { let t = r * list.reduce((s, x) => s + x[1], 0); for (const [n, w] of list) { t -= w; if (t <= 0) return n; } return list[list.length - 1][0]; }
// salinan geometri pohon: RGBA → RGB + atribut 'sway'. round (mode realistis): tajuk bervolume — normal kartu daun
// dicampur ke arah keluar dari pusat tajuk (matahari membentuk tajuk, bukan lembar-lembar kartu) dan bagian dalam
// tajuk digelapkan (oklusi). Kulit kayu = sel atlas baris 1 kolom 2–3; sisanya daun.
export function swayGeo(src, round = false) {
  const g = src.clone(), c = g.attributes.color;
  if (c && c.itemSize === 4) {
    const n = c.count, rgb = new Float32Array(n * 3), sw = new Float32Array(n);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); sw[i] = c.getW(i); }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  }
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color;
  if (!round || !U || !N || !C) return g;
  const n = P.count, leaf = new Uint8Array(n);
  let cx = 0, cy = 0, cz = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(U.getY(i) * 4), col = Math.floor(U.getX(i) * 4);
    if (row === 1 && col >= 2) continue;
    leaf[i] = 1; cx += P.getX(i); cy += P.getY(i); cz += P.getZ(i); cnt++;
  }
  if (cnt < 8) return g;
  cx /= cnt; cy /= cnt; cz /= cnt;
  let R = 0;
  for (let i = 0; i < n; i++) if (leaf[i]) R = Math.max(R, Math.hypot(P.getX(i) - cx, P.getY(i) - cy, P.getZ(i) - cz));
  for (let i = 0; i < n; i++) {
    if (!leaf[i]) continue;
    let rx = P.getX(i) - cx, ry = P.getY(i) - cy + 0.18 * R, rz = P.getZ(i) - cz;
    const d = Math.hypot(rx, ry, rz) || 1, k = Math.min(1, Math.hypot(rx, P.getY(i) - cy, rz) / R);
    rx /= d; ry /= d; rz /= d;
    let nx = N.getX(i) * 0.4 + rx * 0.6, ny = N.getY(i) * 0.4 + ry * 0.6, nz = N.getZ(i) * 0.4 + rz * 0.6;
    const nl = Math.hypot(nx, ny, nz) || 1;
    N.setXYZ(i, nx / nl, ny / nl, nz / nl);
    const t = Math.min(1, Math.max(0, (k - 0.2) / 0.7)), ao = 0.58 + 0.42 * t * t * (3 - 2 * t);
    C.setXYZ(i, C.getX(i) * ao, C.getY(i) * ao, C.getZ(i) * ao);
  }
  return g;
}
let REAL_FOLIAGE = null; // diisi buildWorld (mode realistis): penambal bahan daun
async function upgradeTrees(scene, D, old) {
  const atlasP = new THREE.TextureLoader().loadAsync(TREE_URL + 'leaves.png');
  const [gltf, meta, atlas] = await Promise.all([new GLTFLoader().loadAsync(TREE_URL + 'trees.glb'), fetch(TREE_URL + 'trees.json').then((r) => r.json()), atlasP]);
  atlas.flipY = false; // UV glTF (asal kiri-atas)
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  const geos = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos[o.name] = g; } });
  const info = Object.fromEntries(meta.map((m) => [m.name, m]));
  const wind = { value: 0 };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas, alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\nattribute float sway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float sw = sway * sway, ph = uWind * 1.3 + ip.x * 0.05 + ip.y * 0.04;
      transformed.x += (sin(ph) * 0.22 + sin(ph * 2.7) * 0.05) * sw;
      transformed.z += cos(ph * 0.8) * 0.15 * sw;
    `);
    // kartu daun dua sisi: normal tidak dibalik untuk sisi belakang (normal kartu sudah diarahkan keluar dari tajuk)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  #ifdef DOUBLE_SIDED\n    normal *= faceDirection;\n  #endif');
  };
  if (REAL_FOLIAGE) REAL_FOLIAGE(mat);
  const NAMES = TREE_SPECIES.flat().map((x) => x[0]);
  const T = D.trees, st = D.meta.treeStride || 4, n = Math.floor(T.length / st), room = D.treeRoom;
  const varOf = new Uint8Array(n), mtx = new Float32Array(n * 16), tint = new Float32Array(n * 3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const counts = new Array(NAMES.length).fill(0);
  for (let i = 0; i < n; i++) {
    const x = T[i * st] * M, y = T[i * st + 1] * M, k = T[i * st + 2], grp = st > 3 ? T[i * st + 3] : 0, r0 = hash01(x, y), rm = room ? room[i] : 99;
    let list = TREE_SPECIES[grp] || TREE_SPECIES[0];
    if (grp === 0 && rm < 4) list = list.filter((e) => e[0] === 'ketapang' || e[0] === 'mahoni'); // tempat sempit: tajuk kecil
    const name = pickSpecies(list, hash01(x * 3.1, y * 1.7)), I = info[name], v = NAMES.indexOf(name);
    let sc;
    if (grp === 0) sc = Math.max(1.6, Math.min(TREE_SIZE[name][k] * (0.88 + 0.24 * r0), rm + 1.2)) / I.crownRadius;
    else sc = TREE_SIZE[name][k] * (0.9 + 0.2 * r0) / I.height;
    q.setFromAxisAngle(UP, hash01(y, x) * 6.283);
    m4.compose(p.set(x, 0, -y), q, s.setScalar(sc));
    m4.toArray(mtx, i * 16);
    const br = 0.9 + 0.18 * hash01(x * 5, y * 3), warm = (hash01(x * 2, y) - 0.5) * 0.16; // variasi terang & hangat/sejuk per pohon
    tint[i * 3] = br * (1 + warm); tint[i * 3 + 1] = br; tint[i * 3 + 2] = br * (1 - warm * 0.7);
    varOf[i] = v;
    counts[v]++;
  }
  const SH = D.shrubs || [], ns = Math.floor(SH.length / 3), sMtx = new Float32Array(ns * 16), sTint = new Float32Array(ns * 3);
  for (let i = 0; i < ns; i++) {
    const x = SH[i * 3], y = SH[i * 3 + 1];
    m4.compose(p.set(x, 0, -y), q.setFromAxisAngle(UP, hash01(x, y) * 6.283), s.setScalar(SH[i * 3 + 2]));
    m4.toArray(sMtx, i * 16);
    const br = 0.88 + 0.22 * hash01(y * 2, x);
    sTint[i * 3] = br; sTint[i * 3 + 1] = br; sTint[i * 3 + 2] = br;
  }
  const inst = (geo, cap, shadow) => {
    const im = new THREE.InstancedMesh(swayGeo(geo, !!REAL_FOLIAGE), mat, Math.max(1, cap));
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = shadow;
    im.receiveShadow = !REAL_FOLIAGE; // mode realistis: tajuk tidak membayangi dirinya sendiri (cahaya tembus daun di shader)
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    return im;
  };
  const lods = [0, 1, 2].map((L) => NAMES.map((name, v) => inst(geos[name + '_lod' + L] || geos[name + '_lod1'], counts[v], L < 2)));
  const shrubMesh = inst(geos.pucuk_merah_lod0, ns, false);
  // isi grup pohon lama diganti (grup yang sama tetap dipakai, mis. tombol lapisan "Pohon" di digital twin)
  const group = old || new THREE.Group();
  for (const o of [...group.children]) { group.remove(o); if (o.geometry) o.geometry.dispose(); }
  for (const L of lods) group.add(...L);
  group.add(shrubMesh);
  let lastX = Infinity, lastZ = Infinity, air = false;
  // air = kamera tinggi di udara (pesawat/terjun): semua pohon memakai LOD terjauh dan pembagian tidak perlu diulang
  // selama masih di udara. Hanya bagian buffer yang terpakai yang diunggah ke GPU.
  const repartition = (cx, cz) => {
    const near2 = air ? -1 : TREE_NEAR * TREE_NEAR, far2 = air ? -1 : TREE_FAR * TREE_FAR, cnt = [0, 1, 2].map(() => new Array(NAMES.length).fill(0));
    for (let i = 0; i < n; i++) {
      const dx = mtx[i * 16 + 12] - cx, dz = mtx[i * 16 + 14] - cz, d2 = dx * dx + dz * dz, L = d2 < near2 ? 0 : d2 < far2 ? 1 : 2, v = varOf[i], im = lods[L][v], j = cnt[L][v]++;
      im.instanceMatrix.array.set(mtx.subarray(i * 16, i * 16 + 16), j * 16);
      im.instanceColor.array.set(tint.subarray(i * 3, i * 3 + 3), j * 3);
    }
    for (const L of [0, 1, 2]) for (let v = 0; v < NAMES.length; v++) {
      const im = lods[L][v], c = cnt[L][v];
      im.count = c;
      if (!c) continue;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, c * 16); im.instanceMatrix.needsUpdate = true;
      im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, c * 3); im.instanceColor.needsUpdate = true;
    }
    const sn2 = SHRUB_NEAR * SHRUB_NEAR;
    let j = 0;
    for (let i = 0; i < ns; i++) {
      const dx = sMtx[i * 16 + 12] - cx, dz = sMtx[i * 16 + 14] - cz;
      if (dx * dx + dz * dz > sn2) continue;
      shrubMesh.instanceMatrix.array.set(sMtx.subarray(i * 16, i * 16 + 16), j * 16);
      shrubMesh.instanceColor.array.set(sTint.subarray(i * 3, i * 3 + 3), j * 3);
      j++;
    }
    shrubMesh.count = j;
    shrubMesh.instanceMatrix.needsUpdate = true;
    shrubMesh.instanceColor.needsUpdate = true;
    lastX = cx; lastZ = cz;
  };
  // LOD & angin diperbarui sendiri tiap render (tanpa perlu loop game/peta memanggilnya)
  lods[1][0].onBeforeRender = (r, sc, cam) => {
    wind.value = performance.now() / 1000;
    const cx = cam.position.x, cz = cam.position.z, up = air ? cam.position.y > 230 : cam.position.y > 270;
    if (up !== air) { air = up; repartition(cx, cz); }
    else if (!air && (cx - lastX) ** 2 + (cz - lastZ) ** 2 > 30 * 30) repartition(cx, cz);
  };
  repartition(0, 0);
  if (!group.parent) scene.add(group);
  return { geos, group, mat, round: !!REAL_FOLIAGE };
}

// Membangun seluruh adegan. opts.host = elemen tempat kanvas; opts.progress(persen, teks) untuk layar muat.
// opts.game = true (game): tanah menerus sampai cakrawala, tanpa tebing diorama; lingkungan sekitar
// ditambahkan terpisah lewat map/context.js. Tanpa opts.game: diorama melayang (peta digital twin).
// Melempar Error('WEBGL') kalau perangkat tidak mendukung WebGL.
export function buildWorld(D, opts = {}) {
  cleanTrees(D); // pohon tidak di jalan/gedung/air (collider memakai daftar yang sama)
  const progress = opts.progress || (() => {});
  const game = !!opts.game;
  const V2 = (flat) => { const pts = []; for (let i = 0; i + 1 < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i] * M, flat[i + 1] * M)); return pts; };
  const C = (hex) => new THREE.Color(hex);
  const boundary = V2(D.boundary);
  // Enclave = lubang di batas resmi kawasan (mis. kampung ±10 ha). Dulu dilubangi sehingga jadi sumur 26 m di tengah
  // peta. Sekarang isinya ikut di data (tools/build_map.py, bangunan flag 4) dan tanahnya menyambung: bisa dilewati,
  // hanya ditandai halus. boundaryHoles dibiarkan kosong supaya kode lama tidak melubangi apa pun.
  const enclaves = (D.boundaryHoles || []).map(V2), boundaryHoles = [];
  if (THREE.ShapeUtils.area(boundary) < 0) boundary.reverse();
  const bb = bounds(boundary);
  const center = new THREE.Vector2((bb.minx + bb.maxx) / 2, (bb.miny + bb.maxy) / 2);
  const inArea = (x, y) => pip(x, y, boundary);
  const [LAT, LON] = D.meta.center;
  const B = D.buildings;

  // ---------- Renderer, kamera, cahaya ----------
  const host = opts.host;
  let renderer;
  try {
    // game di layar Retina: tanpa MSAA (sudah dirender 1,5× sehingga tepi tetap halus) — MSAA 4× pada 1,5× resolusi sangat berat
    renderer = new THREE.WebGLRenderer({ antialias: !(opts.game && devicePixelRatio >= 2), stencil: true });
  } catch (e) {
    throw new Error('WEBGL');
  }
  const small = innerWidth < 640 || (navigator.deviceMemory || 8) <= 4;
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.25 : 1.5)); // Retina penuh terlalu berat untuk sejuta segitiga
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // bayangan dihitung ulang hanya saat peta berhenti (refreshShadows)
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe4e9f2, 6000, 16000);
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 3, 20000);
  const hemi = new THREE.HemisphereLight(0xffffff, game ? 0xb3a68f : 0x6a6480, 1.25); // game: pantulan tanah hangat (dinding teduh tidak abu-ungu)
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.4);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.setScalar(renderer.capabilities.maxTextureSize >= 8192 ? 4096 : 2048);
  Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 10, far: 6000 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  let shadowHalf = 700;
  // Mode realistis (game): langit foto HDR menentukan warna & kuat cahaya; tekstur PBR foto (map/realism.js)
  const real = game && opts.real ? opts.real.init(renderer) : null;
  if (real) {
    hemi.color.copy(real.skyColor); hemi.groundColor.copy(real.groundColor); hemi.intensity = real.skyIntensity;
    sun.color.copy(real.sunColor); sun.intensity = real.sunIntensity;
  }
  // warna tinta untuk permukaan bertekstur foto: tekstur yang memberi warna, tinta hanya variasi halus
  REAL_FOLIAGE = real ? (m) => real.foliage(m, { gain: 2.1, desat: 0.38 }) : null;
  const tint = (hex, k = 1, keep = 0.3) => { const c = C(hex); if (!real) return c; const mx = Math.max(c.r, c.g, c.b, 1e-3); return c.multiplyScalar(1 / mx).lerp(C('#ffffff'), 1 - keep).multiplyScalar(k); };

  // ---------- Geometri bantu ----------
  function geo(pos, nor, col, wuv, uv) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (wuv) g.setAttribute('wuv', new THREE.Float32BufferAttribute(wuv, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); // meter dunia; skala lewat texture.repeat
    g.computeBoundingSphere();
    return g;
  }
  function flatGeo(items, y) {
    const pos = [], nor = [], col = [], uv = [], owner = [];
    for (const it of items) {
      const ring = it.ring;
      if (ring.length < 3) continue;
      const holes = it.holes || [];
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(ring, holes); } catch (e) { continue; }
      const all = holes.length ? ring.concat(...holes) : ring;
      const c = it.color;
      for (const t of tris) {
        for (const k of t) { const p = all[k]; pos.push(p.x, y, -p.y); nor.push(0, 1, 0); col.push(c.r, c.g, c.b); uv.push(p.x, p.y); }
        owner.push(it.owner ?? -1);
      }
    }
    const g = geo(pos, nor, col, null, uv);
    g.userData.owner = owner;
    return g;
  }
  function ribbonGeo(lines) { // L.off = geser ke samping (marka tepi)
    const pos = [], nor = [], col = [], uv = [];
    for (const L of lines) {
      const P = L.pts, n = P.length;
      if (n < 2) continue;
      const hw = L.w / 2, y = L.y, c = L.color, segs = L.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = P[i], b = P[(i + 1) % n];
        let dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        dx /= len; dy /= len;
        const e = L.cap ? Math.min(hw, len) : 0, off = L.off || 0, sx = -dy * off, sy = dx * off;
        const ax = a.x - dx * e + sx, ay = a.y - dy * e + sy, bx = b.x + dx * e + sx, by = b.y + dy * e + sy, nx = -dy * hw, ny = dx * hw;
        const q = [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny];
        // urutan berlawanan jarum jam dilihat dari atas: muka depan menghadap ke atas. (Dulu terbalik, sehingga dengan
        // DoubleSide normalnya dibalik ke bawah dan marka/kerb/garis batas tampil gelap.)
        for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(q[k * 2], y, -q[k * 2 + 1]); nor.push(0, 1, 0); col.push(c.r, c.g, c.b); uv.push(q[k * 2], q[k * 2 + 1]); }
      }
    }
    return geo(pos, nor, col, null, uv);
  }
  function dashGeo(lines, dash, gap, w, y, c) { // marka putus-putus di tengah jalan besar
    const out = [];
    for (const P of lines) {
      let carry = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], len = a.distanceTo(b);
        if (len < 0.01) continue;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        let d = carry;
        while (d < len) {
          const e = Math.min(len, d + dash);
          out.push({ pts: [new THREE.Vector2(a.x + ux * d, a.y + uy * d), new THREE.Vector2(a.x + ux * e, a.y + uy * e)], w, y, color: c });
          d += dash + gap;
        }
        carry = d - len;
      }
    }
    return ribbonGeo(out);
  }
  // Pita jalan bersambung (sambungan miter) + ujung bulat, supaya tikungan & simpang mulus tanpa gerigi.
  function stripGeo(lines) {
    const pos = [], nor = [], col = [], uv = [];
    const put = (x, z, c, y) => { pos.push(x, y, -z); nor.push(0, 1, 0); col.push(c.r, c.g, c.b); uv.push(x, z); };
    for (const L of lines) {
      const P = L.pts.filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 0.05), n = P.length;
      if (n < 2) continue;
      const hw = L.w / 2, y = L.y, c = L.color, side = [];
      for (let i = 0; i < n; i++) {
        let n1x = 0, n1y = 0, n2x = 0, n2y = 0;
        if (i > 0) { const dx = P[i].x - P[i - 1].x, dy = P[i].y - P[i - 1].y, l = Math.hypot(dx, dy); n1x = -dy / l; n1y = dx / l; }
        if (i < n - 1) { const dx = P[i + 1].x - P[i].x, dy = P[i + 1].y - P[i].y, l = Math.hypot(dx, dy); n2x = -dy / l; n2y = dx / l; }
        if (i === 0) { n1x = n2x; n1y = n2y; }
        if (i === n - 1) { n2x = n1x; n2y = n1y; }
        let mx = n1x + n2x, my = n1y + n2y;
        const ml = Math.hypot(mx, my) || 1;
        mx /= ml; my /= ml;
        const k = hw / Math.max(0.35, mx * n2x + my * n2y);
        side.push([P[i].x + mx * k, P[i].y + my * k, P[i].x - mx * k, P[i].y - my * k]);
      }
      for (let i = 0; i < n - 1; i++) {
        const [ax, ay, bx, by] = side[i], [cx2, cy2, dx2, dy2] = side[i + 1];
        put(ax, ay, c, y); put(bx, by, c, y); put(cx2, cy2, c, y);
        put(bx, by, c, y); put(dx2, dy2, c, y); put(cx2, cy2, c, y);
      }
      const cs = L.capSeg || 10; // ujung bulat (lingkungan sekitar pakai lebih sedikit segmen)
      for (const e of [P[0], P[n - 1]]) {
        for (let s = 0; s < cs; s++) {
          const a0 = s / cs * Math.PI * 2, a1 = (s + 1) / cs * Math.PI * 2;
          put(e.x, e.y, c, y); put(e.x + Math.cos(a0) * hw, e.y + Math.sin(a0) * hw, c, y); put(e.x + Math.cos(a1) * hw, e.y + Math.sin(a1) * hw, c, y);
        }
      }
    }
    return geo(pos, nor, col, null, uv);
  }
  // Marka sepanjang jalan (garis tepi, kerb, putus-putus tengah). Dipotong 'trim' meter dari ujung supaya
  // tidak menyilang di tengah persimpangan. L: { pts, w, off (geser samping), dash, gap (0 = garis utuh), trim, y, color }
  function markGeo(lines) {
    const out = [];
    for (const L of lines) {
      const P = L.pts, n = P.length;
      if (n < 2) continue;
      let total = 0;
      for (let i = 0; i < n - 1; i++) total += P[i].distanceTo(P[i + 1]);
      const t0 = L.trim, t1 = total - L.trim, period = L.dash + L.gap;
      if (t1 - t0 < 2) continue;
      let acc = 0;
      for (let i = 0; i < n - 1; i++) {
        const a = P[i], b = P[i + 1], l = a.distanceTo(b);
        if (l < 0.01) continue;
        const ux = (b.x - a.x) / l, uy = (b.y - a.y) / l, ox = -uy * L.off, oy = ux * L.off;
        const piece = (s, e) => out.push({ pts: [new THREE.Vector2(a.x + ux * (s - acc) + ox, a.y + uy * (s - acc) + oy), new THREE.Vector2(a.x + ux * (e - acc) + ox, a.y + uy * (e - acc) + oy)], w: L.w, y: L.y, color: L.color });
        const s0 = Math.max(acc, t0), e0 = Math.min(acc + l, t1);
        if (e0 > s0) {
          if (!L.gap) piece(s0, e0);
          else for (let ds = t0 + Math.floor((s0 - t0) / period) * period; ds < e0; ds += period) { const ps = Math.max(ds, s0), pe = Math.min(ds + L.dash, e0); if (pe > ps) piece(ps, pe); }
        }
        acc += l;
      }
    }
    return ribbonGeo(out);
  }
  // Lapisan datar: hanya tergambar di atas tanah (stencil ≠ 0), tanpa menulis kedalaman. Stencil tanah: diorama = 1;
  // game: 1 di luar kawasan, 2 di dalam kawasan (lapisan lingkungan sekitar, opts.outside, hanya tergambar di 1).
  let overlayOrder = -40;
  function overlay(g, opts = {}) {
    const base = {
      vertexColors: true, side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
      transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1,
      stencilWrite: true, stencilRef: opts.outside ? 1 : 0, stencilFunc: opts.outside ? THREE.EqualStencilFunc : THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
    };
    let mat;
    if (real && opts.surf && real.sets[opts.surf]) mat = real.groundMaterial(opts.surf, base, opts.pbr); // tekstur foto + bayangan dinamis
    else {
      const Mat = opts.phong ? THREE.MeshPhongMaterial : THREE.MeshLambertMaterial;
      mat = new Mat({ ...base, map: opts.map || null, ...(opts.phong ? { shininess: 90, specular: new THREE.Color('#bcd3e6') } : {}) });
      if (real && !opts.phong) real.patch(mat, { dyn: true }); // marka dll. ikut menerima bayangan karakter/kendaraan
    }
    mat.forceSinglePass = true; // lapisan datar: tanpa render dua pass (depan/belakang) three.js untuk bahan transparan dua sisi, yang mengevaluasi ulang programnya tiap frame
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = overlayOrder++;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
    return m;
  }

  // ---------- Tanah: diorama melayang (digital twin) atau tanah menerus sampai cakrawala (game) ----------
  const TEX = { grass: noiseTex('grass', 18), asphalt: noiseTex('asphalt', 7), paving: noiseTex('paving', 4) };
  for (const t of Object.values(TEX)) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const slabStencil = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp };
  const slabTop = real ? real.groundMaterial('soil', { vertexColors: false, color: 0xd8dcc4, ...slabStencil }, { env: 0.3 })
    : new THREE.MeshLambertMaterial({ color: PAL.ground, map: TEX.grass, ...slabStencil });
  const slabSide = new THREE.MeshLambertMaterial({ color: PAL.side });
  let slab, floorShadow;
  if (game) {
    // Tanah 32 × 32 km (ujungnya tertutup kabut). Bagian dekat kawasan (kotak batas + 400 m) menerima bayangan; bagian
    // jauh tidak (bayangan hanya dihitung di sekitar pemain, jadi di sana tidak pernah ada), supaya lebih ringan.
    // UV = meter dunia supaya tekstur rumput sama dengan di dalam kawasan.
    const R = 16000, P = 400, near = [bb.minx - P, bb.miny - P, bb.maxx + P, bb.maxy + P];
    const rect = (x0, y0, x1, y1) => [new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)];
    const flat = (shape) => {
      const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
      return g;
    };
    // lubang di tanah untuk danau & sungai besar: di bawahnya ada dasar air (lakeBeds) sehingga air punya kedalaman
    const nearShape = new THREE.Shape(rect(...near));
    for (const r of D.water) {
      const ring = V2(r);
      if (ring.every((p) => p.x > near[0] + 1 && p.x < near[2] - 1 && p.y > near[1] + 1 && p.y < near[3] - 1)) nearShape.holes.push(new THREE.Path(ring));
    }
    slab = new THREE.Mesh(flat(nearShape), slabTop);
    const outer = new THREE.Shape(rect(center.x - R, center.y - R, center.x + R, center.y + R));
    outer.holes.push(new THREE.Path(rect(...near).reverse()));
    const far = new THREE.Mesh(flat(outer), slabTop);
    far.renderOrder = -50;
    far.matrixAutoUpdate = false;
    scene.add(far);
    floorShadow = new THREE.Object3D(); // tidak dipakai di game (tidak ada diorama melayang)
    // Topeng kawasan (tak terlihat): stencil 2 di dalam batas, supaya lapisan lingkungan sekitar tidak menimpa isi kawasan.
    const mask = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(boundary)).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilRef: 2, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }));
    mask.renderOrder = -49;
    mask.matrixAutoUpdate = false;
    scene.add(mask);
  } else {
    const slabGeo = new THREE.ExtrudeGeometry(new THREE.Shape(boundary), { depth: SLAB, bevelEnabled: false }); // enclave tidak dilubangi
    slabGeo.rotateX(-Math.PI / 2).translate(0, -SLAB, 0);
    slab = new THREE.Mesh(slabGeo, [slabTop, slabSide]);
    const ext = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny);
    floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(ext * 1.5, ext * 1.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: softDot('rgba(40,30,90,.35)', 'rgba(40,30,90,0)', 128), transparent: true, depthWrite: false, fog: false }));
    floorShadow.position.set(center.x, -SLAB - 60, -center.y);
    floorShadow.scale.set((bb.maxx - bb.minx) / ext, 1, (bb.maxy - bb.miny) / ext);
    floorShadow.renderOrder = -60;
    scene.add(floorShadow);
  }
  slab.receiveShadow = true;
  slab.renderOrder = -50;
  scene.add(slab);

  // ---------- Lapisan datar di atas lempeng ----------
  // Enclave: tanah sedikit lebih hangat (kampung, bukan kawasan); di peta digital twin juga diberi garis putus-putus.
  if (enclaves.length) {
    overlay(flatGeo(enclaves.map((r) => ({ ring: r, color: tint('#b9b39b', 0.95) })), 0.03), { map: TEX.grass, surf: 'soil' });
    if (!game) overlay(dashGeo(enclaves.map((r) => r.concat([r[0]])), 5, 4, 1.4, 0.19, C('#8d8778')), { opacity: 0.85 });
  }
  let clusterFill;
  if (real) {
    const surfOf = (k) => (k === 'commercial' || k === 'retail' ? 'slab' : k === 'construction' ? 'soil' : 'grass');
    for (const sf of ['grass', 'slab', 'soil']) {
      const items = D.clusters.map((c, i) => ({ c, i })).filter((e) => surfOf(e.c.kind) === sf).map(({ c, i }) => ({ ring: V2(c.r), color: C('#ffffff').multiplyScalar(sf === 'grass' ? 0.74 + 0.1 * hash01(i, 3.1) : sf === 'slab' ? 0.9 : 1.1), owner: i }));
      if (!items.length) continue;
      const m = overlay(flatGeo(items, 0.04), { map: TEX.paving, surf: sf, pbr: { env: sf === 'slab' ? 0.5 : 0.3 } });
      clusterFill = clusterFill || m;
    }
  } else clusterFill = overlay(flatGeo(D.clusters.map((c, i) => ({ ring: V2(c.r), color: C(CL_GROUND[c.kind] || '#c3c9b5').lerp(C(TINTS[i % TINTS.length]), 0.25), owner: i })), 0.04), { map: TEX.paving });
  overlay(flatGeo(D.green.r.map((r, i) => ({ ring: V2(r), color: real ? tint(GREEN_COLOR[D.greenTypes[D.green.t[i]]] || '#7fae62', ({ forest: 0.6, golf: 0.92, pitch: 0.88, cemetery: 0.72 })[D.greenTypes[D.green.t[i]]] || 0.8, 0.25) : C(GREEN_COLOR[D.greenTypes[D.green.t[i]]] || '#7fae62') })), 0.06), { map: TEX.grass, surf: 'grass' });
  const waterC = C(PAL.water);
  // Air: danau hijau-biru, sungai/kanal hijau-cokelat (seperti Cisadane). Riak bergerak (normal dari gelombang + noise),
  // kilau matahari (Phong), pantulan langit di sudut landai (fresnel), buih di tepi sungai (atribut side −1…1).
  const lakeC = real ? C('#27504c') : game ? C('#2c6470') : waterC, riverC = real ? C('#3f5238') : game ? C('#4a6344') : waterC; // realistis: hijau keruh
  const waterT = { value: 0 };
  const waterize = (m, depth = null) => { // depth: { tex, box } → transparan di bagian dangkal, warna menurut kedalaman
    m.material.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = waterT;
      sh.uniforms.uSkyW = skyU;
      if (real) { sh.uniforms.tSky = { value: real.dome }; sh.uniforms.uSkyP = { value: new THREE.Vector3(real.skyV0, real.skyGain, 0) }; }
      if (depth) { sh.uniforms.uDep = { value: depth.tex }; sh.uniforms.uDBox = { value: depth.box }; sh.defines = { ...(sh.defines || {}), WDEPTH: 1 }; }
      sh.vertexShader = 'attribute float side;\nvarying float vSide;\nvarying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSide = side;\n  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `${real ? '#define WREAL\n' + SKY_GLSL : ''}\nuniform float uTime;\nuniform vec3 uSkyW;\nvarying float vSide;\nvarying vec3 vWP;
#ifdef WDEPTH
uniform sampler2D uDep;
uniform vec4 uDBox;
#endif
float wh21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float wnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh21(i), wh21(i + vec2(1.0, 0.0)), f.x), mix(wh21(i + vec2(0.0, 1.0)), wh21(i + vec2(1.0, 1.0)), f.x), f.y); }
float waveH(vec2 p, float t) { return sin(dot(p, vec2(0.8, 0.6)) * 1.3 + t * 1.6) * 0.035 + sin(dot(p, vec2(-0.5, 0.86)) * 2.3 + t * 2.1) * 0.022 + (wnoise(p * 0.8 + vec2(t * 0.3, t * 0.17)) - 0.5) * 0.09 + (wnoise(p * 3.1 - vec2(t * 0.5, -t * 0.4)) - 0.5) * 0.025; }
` + sh.fragmentShader
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  float e = 0.08, h0 = waveH(vWP.xz, uTime);
  vec3 nW = normalize(vec3(-(waveH(vWP.xz + vec2(e, 0.0), uTime) - h0) / e, 1.0, -(waveH(vWP.xz + vec2(0.0, e), uTime) - h0) / e));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  float foam = smoothstep(0.8, 1.0, abs(vSide)) * (0.5 + 0.5 * wnoise(vWP.xz * 1.7 + vec2(uTime * 0.45, 0.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.9 + 0.2 * wnoise(vWP.xz * 0.15)), vec3(0.84, 0.86, 0.8), foam * 0.65);
#ifdef WDEPTH
  float wdep = texture2D(uDep, (vec2(vWP.x, -vWP.z) - uDBox.xy) / (uDBox.zw - uDBox.xy)).r * 8.0;
#ifdef WREAL
  diffuseColor.rgb = mix(vec3(0.34, 0.44, 0.36), diffuseColor.rgb, smoothstep(0.3, 3.5, wdep)); // dangkal: hijau-pasir keruh
#else
  diffuseColor.rgb = mix(vec3(0.36, 0.62, 0.58), diffuseColor.rgb, smoothstep(0.3, 4.0, wdep));
#endif
  diffuseColor.a *= mix(0.32, 0.93, smoothstep(0.15, 3.2, wdep));
#endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef WREAL
  { // pantulan langit foto (awan ikut terpantul), makin kuat di sudut landai (Fresnel air, F0 2 %)
    vec3 Vw = normalize(cameraPosition - vWP);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(Vw, nW), 0.0), 5.0);
    vec3 rdir = reflect(-Vw, nW);
    rdir.y = abs(rdir.y);
    totalEmissiveRadiance += min(skyAt(rdir, 2.0), vec3(3.0)) * F;
    diffuseColor.rgb *= 1.0 - F;
    diffuseColor.a = mix(diffuseColor.a, 1.0, F);
  }
#else
  float fres = pow(1.0 - max(dot(normalize(cameraPosition - vWP), nW), 0.0), 3.0);
  totalEmissiveRadiance += uSkyW * fres * 0.26;
#endif`);
    };
    m.material.needsUpdate = true;
    m.onBeforeRender = () => { waterT.value = performance.now() / 1000; };
    return m;
  };
  function riverGeo(lines) { // pita sungai dengan atribut side (−1 tepi kanan … +1 tepi kiri) untuk buih
    const pos = [], nor = [], col = [], side = [];
    for (const L of lines) {
      const P = L.pts, n = P.length, hw = L.w / 2, c = L.color;
      for (let i = 0; i + 1 < n; i++) {
        const a = P[i], b = P[i + 1];
        let dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        dx /= len; dy /= len;
        const ex = Math.min(hw, len), ax = a.x - dx * ex, ay = a.y - dy * ex, bx = b.x + dx * ex, by = b.y + dy * ex, nx = -dy * hw, ny = dx * hw;
        const q = [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny], sd = [1, 1, -1, -1];
        for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(q[k * 2], L.y, -q[k * 2 + 1]); nor.push(0, 1, 0); col.push(c.r, c.g, c.b); side.push(sd[k]); }
      }
    }
    const g = geo(pos, nor, col);
    g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
    return g;
  }
  if (!game) waterize(overlay(flatGeo(D.water.map((r) => ({ ring: V2(r), color: lakeC })), 0.08), { phong: true }));
  else (function lakes() {
    // Danau & sungai besar (game): permukaan transparan di bagian dangkal (dasar terlihat), dasar danau bergradasi pasir →
    // lumpur hijau-cokelat dengan kilau kaustik, dan "langit-langit" terang bila dilihat dari bawah air (jendela Snell).
    const wd = makeWaterDepth(D), S = WATER.surface;
    const bedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    bedMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = waterT;
      sh.vertexShader = 'varying vec3 vBP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `uniform float uTime;\nvarying vec3 vBP;
float caust(vec2 p, float t) { vec2 q = p * 0.55; float c = sin(q.x * 3.1 + sin(q.y * 2.3 + t * 1.3) * 1.6 + t * 1.1) + sin(q.y * 2.7 + sin(q.x * 1.9 - t * 1.2) * 1.4 - t * 0.9); return pow(clamp(1.0 - abs(c) * 0.55, 0.0, 1.0), 6.0); }
` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float bd = max(0.0, -vBP.y);
  totalEmissiveRadiance += vec3(0.55, 0.78, 0.72) * caust(vBP.xz, uTime) * smoothstep(10.0, 0.4, bd) * step(0.05, bd) * 0.4 + diffuseColor.rgb * 0.18;`);
    };
    const ceilMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.FrontSide });
    ceilMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = waterT;
      sh.vertexShader = 'varying vec3 vCP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `uniform float uTime;\nvarying vec3 vCP;
float ch21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float cnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(ch21(i), ch21(i + vec2(1.0, 0.0)), f.x), mix(ch21(i + vec2(0.0, 1.0)), ch21(i + vec2(1.0, 1.0)), f.x), f.y); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  vec3 V = normalize(vCP - cameraPosition);
  float snell = smoothstep(0.52, 0.8, V.y);
  float rip = cnoise(vCP.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.2)) * 0.6 + cnoise(vCP.xz * 2.7 - vec2(uTime * 0.6, -uTime * 0.45)) * 0.4;
  vec3 outC = vec3(0.17, 0.46, 0.46) * (0.85 + 0.3 * rip), inC = vec3(0.78, 0.93, 0.9) * (0.82 + 0.36 * rip);
  diffuseColor.rgb = mix(outC, inC, snell);`);
    };
    const faceY = (g, sgn) => { // segitiga tak berindeks menghadap ke atas (sgn 1) / ke bawah (−1)
      const p = g.attributes.position;
      for (let t = 0; t < p.count; t += 3) {
        const ax = p.getX(t), az = p.getZ(t), bx = p.getX(t + 1), bz = p.getZ(t + 1), qx = p.getX(t + 2), qz = p.getZ(t + 2);
        if (((bz - az) * (qx - ax) - (bx - ax) * (qz - az)) * sgn < 0) { const by = p.getY(t + 1); p.setXYZ(t + 1, qx, p.getY(t + 2), qz); p.setXYZ(t + 2, bx, by, bz); }
      }
      p.needsUpdate = true;
    };
    const cA = C('#c2b183'), cB = C('#77714a'), cD = C('#33402a'), cc = new THREE.Color();
    const G = 3.0;
    wd.polys.forEach((P, pi) => {
      // ---- dasar: grid 3 m, tinggi −kedalaman; satu sel di luar tepi (−0,03, tertutup tanah) supaya rapat dari bawah
      const x0 = Math.floor(P.x0 / G) * G - G, y0 = Math.floor(P.y0 / G) * G - G, nx = Math.ceil((P.x1 - x0) / G) + 2, ny = Math.ceil((P.y1 - y0) / G) + 2;
      const W = nx + 1, ins = new Uint8Array(W * (ny + 1)), dep = new Float32Array(W * (ny + 1));
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * G, y = y0 + j * G, k = j * W + i; if (wd.inside(P, x, y)) { ins[k] = 1; dep[k] = wd(x, y); } }
      const keep = new Uint8Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * W + i; if (ins[k] || ins[k + 1] || ins[k + W] || ins[k + W + 1]) keep[j * nx + i] = 1; }
      const pos = [], col = [], idx = [];
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const k = j * W + i, d = dep[k], x = x0 + i * G, y = y0 + j * G;
        pos.push(x, ins[k] ? -d : -0.03, -y);
        const n = 0.94 + 0.12 * Math.abs(Math.sin(x * 0.31 + y * 0.17) * Math.cos(x * 0.13 - y * 0.29));
        cc.copy(cA).lerp(cB, Math.min(1, d / 2.5));
        if (d > 2.5) cc.lerp(cD, Math.min(1, (d - 2.5) / 5));
        cc.multiplyScalar(n);
        col.push(cc.r, cc.g, cc.b);
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let on = keep[j * nx + i];
        for (let dj = -1; dj <= 1 && !on; dj++) for (let di = -1; di <= 1 && !on; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny && keep[b * nx + a]) on = 1; }
        if (!on) continue;
        const k = j * W + i;
        idx.push(k, k + 1, k + W + 1, k, k + W + 1, k + W); // muka ke atas (y = −data y di three)
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const bed = new THREE.Mesh(g, bedMat);
      bed.receiveShadow = true;
      bed.matrixAutoUpdate = false;
      scene.add(bed);
      // ---- tekstur kedalaman (2 m/texel) untuk transparansi & warna permukaan
      const TS = 2, tw = Math.max(2, Math.ceil((P.x1 - P.x0) / TS) + 1), th = Math.max(2, Math.ceil((P.y1 - P.y0) / TS) + 1), td = new Uint8Array(tw * th);
      for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) { const x = P.x0 + i * TS, y = P.y0 + j * TS; td[j * tw + i] = wd.inside(P, x, y) ? Math.min(255, Math.round(wd(x, y) / WATER.maxD * 255)) : 0; }
      const tex = new THREE.DataTexture(td, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      const ring = V2(D.water[pi]);
      const sg = flatGeo([{ ring, color: lakeC }], S);
      faceY(sg, 1);
      const surf = overlay(sg, { phong: true, opacity: 1 });
      surf.material.side = THREE.FrontSide; // dari bawah: langit-langit (ceil) yang tergambar
      waterize(surf, { tex, box: new THREE.Vector4(P.x0, P.y0, P.x0 + (tw - 1) * TS, P.y0 + (th - 1) * TS) });
      // ---- langit-langit dilihat dari bawah air (muka ke bawah)
      const cg = flatGeo([{ ring, color: lakeC }], S - 0.006);
      faceY(cg, -1);
      const ceil = new THREE.Mesh(cg, ceilMat);
      ceil.matrixAutoUpdate = false;
      scene.add(ceil);
    });
  })();
  waterize(overlay(riverGeo(D.waterways.r.map((r, i) => ({ pts: V2(r), w: D.waterways.w[i] * M, y: 0.09, color: riverC }))), { phong: true }));
  // jembatan: lantai beton + pagar di tiap persilangan jalan dengan sungai/kanal lebar (≥ 3 m)
  if (game) (function bridges() {
    const RG = new Map(), RC = 60, rk = (x, y) => Math.floor(x / RC) * 100003 + Math.floor(y / RC);
    D.roads.r.forEach((r, ri) => { for (let j = 0; j + 3 < r.length; j += 2) { const s = [r[j] * M, r[j + 1] * M, r[j + 2] * M, r[j + 3] * M, D.roads.w[ri] * M]; const k = rk((s[0] + s[2]) / 2, (s[1] + s[3]) / 2); (RG.get(k) || RG.set(k, []).get(k)).push(s); } });
    const pos = [], nor = [], col = [], deckC = C('#a9a59c'), railC = C('#d8d4cb'), cc = new THREE.Color();
    const quad = (a, b, d, e, n, c) => { for (const p of [a, b, d, a, d, e]) { pos.push(p[0], p[2], -p[1]); nor.push(n[0], n[2], -n[1]); col.push(c.r, c.g, c.b); } };
    const box = (cx, cy, ux, uy, L, W, z0, z1, c) => { // kotak sejajar (ux, uy)
      const vx = -uy, vy = ux, P = [[-L, -W], [L, -W], [L, W], [-L, W]].map(([a, b]) => [cx + ux * a + vx * b, cy + uy * a + vy * b]);
      for (let j = 0; j < 4; j++) { const a = P[j], b = P[(j + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1; quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [ey / l, -ex / l, 0], cc.copy(c).multiplyScalar(j % 2 ? 0.86 : 1)); }
      quad([P[0][0], P[0][1], z1], [P[1][0], P[1][1], z1], [P[2][0], P[2][1], z1], [P[3][0], P[3][1], z1], [0, 0, 1], c);
    };
    const seen = new Set();
    D.waterways.r.forEach((r, wi) => {
      const hw = D.waterways.w[wi] * M / 2;
      if (hw < 1.5) return;
      for (let j = 0; j + 3 < r.length; j += 2) {
        const ax = r[j] * M, ay = r[j + 1] * M, bx = r[j + 2] * M, by = r[j + 3] * M;
        const cand = new Set();
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
          box(px, py, ux, uy, half, W, -0.25, 0.14, deckC);
          for (const sd of [-1, 1]) box(px - uy * W * sd, py + ux * W * sd, ux, uy, half, 0.12, 0.14, 0.95, railC);
        }
      }
    });
    if (!pos.length) return;
    const m = new THREE.Mesh(geo(pos, nor, col), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
  })();
  const clusterLines = overlay(ribbonGeo(D.clusters.map((c) => ({ pts: V2(c.r), w: 1.0, y: 0.1, color: C('#ebe6da'), closed: true }))), { opacity: 0.75 });
  // Jalan: trotoar → aspal per kelas → kerb → marka → zebra cross di simpang jalan besar.
  const roadsByClass = {}, walks = [], marks = [], curbs = [], zebras = [];
  const roadList = D.roads.r.map((r, i) => ({ cls: D.classes[D.roads.c[i]], pts: V2(r), w: D.roads.w[i] * M }));
  const vkey = (p) => Math.round(p.x * 2) + ',' + Math.round(p.y * 2);
  const vcount = new Map();
  for (const R of roadList) for (const p of R.pts) vcount.set(vkey(p), (vcount.get(vkey(p)) || 0) + 1);
  const pointAt = (P, d) => {
    for (let i = 0; i < P.length - 1; i++) {
      const l = P[i].distanceTo(P[i + 1]);
      if (d <= l || i === P.length - 2) {
        const t = l ? Math.min(1, d / l) : 0, ux = (P[i + 1].x - P[i].x) / (l || 1), uy = (P[i + 1].y - P[i].y) / (l || 1);
        return { x: P[i].x + (P[i + 1].x - P[i].x) * t, y: P[i].y + (P[i + 1].y - P[i].y) * t, ux, uy };
      }
      d -= l;
    }
    return null;
  };
  const white = C(real ? '#d9d7d0' : '#f2f2ee'), curbC = C(real ? '#a9a59b' : '#e6e2d9');
  for (const { cls, pts, w } of roadList) {
    (roadsByClass[cls] ||= []).push({ pts, w, y: 0.12, color: real ? C('#ffffff').multiplyScalar(cls === 'pedestrian' ? 1.0 : ROAD_K[cls] || 1) : C(ROAD_COLOR[cls] || '#5c5f65') });
    if (SIDEWALK[cls]) walks.push({ pts, w: w + SIDEWALK[cls] * 2, y: 0.11, color: real ? C('#ffffff') : C('#d5cfc3') });
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += pts[i].distanceTo(pts[i + 1]);
    const big = w >= 7 && DASHED.has(cls), trim = Math.max(5, w * 1.1) + (big ? 4 : 0);
    if (DASHED.has(cls)) marks.push({ pts, w: 0.25, off: 0, dash: 3, gap: 5, trim, y: 0.14, color: white });
    if (EDGE_LINES.has(cls) && w > 7) for (const s of [1, -1]) marks.push({ pts, w: 0.2, off: s * (w / 2 - 0.6), dash: 1, gap: 0, trim, y: 0.14, color: white });
    if (SIDEWALK[cls]) for (const s of [1, -1]) curbs.push({ pts, w: 0.32, off: s * (w / 2), dash: 1, gap: 0, trim: w * 0.55, y: 0.13, color: curbC });
    if (big && total > trim * 2 + 6) {
      [pts, pts.slice().reverse()].forEach((P) => {
        if ((vcount.get(vkey(P[0])) || 0) < 2) return; // ujung yang bukan simpang: tanpa zebra
        const q = pointAt(P, w * 1.1 + 2);
        if (!q) return;
        for (let o = -w / 2 + 0.7; o <= w / 2 - 0.7; o += 0.9) {
          const zx = q.x - q.uy * o, zy = q.y + q.ux * o;
          zebras.push({ pts: [new THREE.Vector2(zx - q.ux * 1.6, zy - q.uy * 1.6), new THREE.Vector2(zx + q.ux * 1.6, zy + q.uy * 1.6)], w: 0.45, y: 0.15, color: white });
        }
      });
    }
  }
  overlay(stripGeo(walks), { map: TEX.paving, surf: 'pave' });
  for (const cls of ROAD_ORDER) if (roadsByClass[cls]) overlay(stripGeo(roadsByClass[cls]), { map: TEX.asphalt, surf: cls === 'pedestrian' ? 'pave' : 'asphalt', pbr: { env: 0.7 } });
  overlay(markGeo(curbs), { opacity: 0.95 });
  overlay(markGeo(marks), { opacity: 0.9 });
  overlay(ribbonGeo(zebras), { opacity: 0.92 });
  // batas kawasan: di peta digital twin pita emas 7 m; di game realistis cukup garis cat kuning selebar 0,7 m
  // (pita lebar tampak seperti bidang kuning polos di tanah; batasnya tetap terlihat di minimap)
  const goldEdge = overlay(ribbonGeo([{ pts: boundary, w: game && real ? 0.7 : 7, y: game && real ? 0.07 : 0.2, color: C(PAL.gold), closed: true }]));
  progress(45, 'Membangun gedung…');

  // ---------- Gedung ----------
  // Dinding membawa atribut wuv = (jarak keliling m, tinggi m, jenis). Shader menggambar jendela per lantai:
  // siang kaca gelap memantulkan langit, malam sebagian jendela menyala. Atap: perisai berlisplang (rumah),
  // parapet + unit atap (komersial), mahkota (gedung tinggi).
  const nightU = { value: 0 }, skyU = { value: new THREE.Color('#b9d6f0') };
  const MUTE = C('#b9b5ab');
  const bMat = real ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMap: real.env, envMapIntensity: 1.0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  // Game: gedung yang sedang "terbuka" (interior dibuat, map/interiors.js) → pintu & jendelanya dibuang (discard) di shader
  // supaya benar-benar berlubang. Tabel per gedung: 2 texel RGBA.
  // Rumah: (buka, pintu1 u0, u1, plafon teratas), (pintu2 u0, u1, 0, 0); rumus jendela sama dengan pola jendela rumah di bawah.
  // Toko/aula: (buka, rentang A u0, u1, tinggi bukaan), (rentang B u0, u1, P, p) → berlubang bila mod(u, P) ∈ [p, P − p].
  const OPEN_W = 256, openRows = Math.ceil(B.r.length / (OPEN_W / 2)) + 1;
  const openData = new Float32Array(OPEN_W * openRows * 4).fill(-1);
  const openTex = new THREE.DataTexture(openData, OPEN_W, openRows, THREE.RGBAFormat, THREE.FloatType);
  openTex.needsUpdate = true;
  const openU = { value: openTex };
  bMat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightU;
    sh.uniforms.uSky = skyU;
    sh.uniforms.uOpen = openU;
    sh.uniforms.uGame = { value: game ? 1 : 0 };
    if (real) Object.assign(sh.uniforms, { tPlA: { value: real.sets.plaster.map }, tPlN: { value: real.sets.plaster.normalMap }, tRfA: { value: real.sets.roof.map }, tRfN: { value: real.sets.roof.normalMap }, uRTile: { value: new THREE.Vector2(real.sets.plaster.tile, real.sets.roof.tile) }, uAmb: { value: real.ambient } });
    sh.vertexShader = 'attribute vec3 wuv;\nattribute float bid;\nattribute vec2 wseg;\nvarying vec3 vWuv;\nvarying float vBid;\nvarying vec2 vSeg;\nvarying vec3 vWPos;\nvarying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWuv = wuv;\n  vBid = bid;\n  vSeg = wseg;\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = `${real ? '#define REAL' : ''}\nuniform float uNight;\nuniform vec3 uSky;\nuniform highp sampler2D uOpen;\nvarying vec3 vWuv;\nvarying float vBid;\nvarying vec2 vSeg;\nvarying vec3 vWPos;\nvarying vec3 vWN;
uniform float uGame;
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
#ifdef REAL
uniform sampler2D tPlA, tPlN, tRfA, tRfN; uniform vec2 uRTile; uniform vec3 uAmb;
// Interior palsu di balik kaca (interior mapping): sinar pandang dipotongkan dengan kotak ruangan (lebar sel × tinggi lantai ×
// dalam D). p = titik masuk di bidang jendela (m, dalam sel); rd = arah pandang (sepanjang dinding, atas, masuk).
// style: 0 rumah, 1 toko/mal (rak barang, lampu menyala), 2 kantor menara, 3 lantai atas ruko.
vec3 interiorRoom(vec2 p, vec2 cell, float D, vec3 rd, float seed, float style, float lit, float night) {
  rd.x = abs(rd.x) < 1e-4 ? 1e-4 : rd.x; rd.y = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float tx = (rd.x > 0.0 ? cell.x - p.x : -p.x) / rd.x, ty = (rd.y > 0.0 ? cell.y - p.y : -p.y) / rd.y, tz = D / rd.z;
  float t = min(tx, min(ty, tz));
  vec3 h = vec3(p, 0.0) + rd * t;
  float r1 = h21(vec2(seed, 1.7)), r2 = h21(vec2(seed, 5.3)), r3 = h21(vec2(seed, 9.1));
  bool store = style > 0.5 && style < 1.5;
  vec3 wallC = store ? vec3(0.9, 0.9, 0.88) : mix(mix(vec3(0.80, 0.75, 0.66), vec3(0.66, 0.73, 0.76), r1), vec3(0.86, 0.84, 0.8), step(0.6, r3));
  vec3 c; float glow = 0.0;
  if (tz <= tx && tz <= ty) { // dinding belakang
    c = wallC;
    float ux = h.x / cell.x, uy = h.y / cell.y;
    if (store) { // rak berisi barang warna-warni
      float shelf = floor(uy * 5.0), sx = floor(h.x / 0.45);
      vec3 goods = 0.3 + 0.62 * vec3(h21(vec2(sx, shelf + seed)), h21(vec2(sx + 3.1, shelf + seed)), h21(vec2(sx + 7.7, shelf + seed)));
      c = uy < 0.78 ? mix(goods, vec3(0.16), step(0.86, fract(uy * 5.0))) : wallC;
    } else if (style > 1.5 && style < 2.5) c *= 0.92 - 0.28 * step(0.5, fract(ux * 3.0 + r2)); // partisi kantor
    else if (abs(ux - (0.22 + 0.56 * r2)) < 0.13 && uy < 0.68) c = mix(vec3(0.36, 0.25, 0.16), vec3(0.82), step(0.5, r3)) * 0.8; // pintu / lemari
    else if (abs(ux - (0.2 + 0.6 * r3)) < 0.09 && abs(uy - 0.62) < 0.09) c = vec3(0.3 + 0.5 * r1, 0.35, 0.3 + 0.4 * r2); // lukisan
  } else if (ty <= tx) { // plafon / lantai
    if (rd.y > 0.0) { c = vec3(0.9); if (style > 0.5) { vec2 g = fract(vec2(h.x, h.z) / vec2(1.2, 1.5)); glow = step(0.3, g.x) * step(g.x, 0.7) * step(0.42, g.y) * step(g.y, 0.58); } }
    else c = style > 0.5 ? vec3(0.6, 0.6, 0.58) : mix(vec3(0.42, 0.3, 0.2), vec3(0.6, 0.57, 0.52), step(0.5, r2));
  } else c = wallC * 0.82; // dinding samping
  float dayL = mix(0.6, 0.2, clamp(h.z / D, 0.0, 1.0)) * (store ? 1.5 : 1.0); // siang: terang dekat jendela
  float lampOn = style > 0.5 ? 1.0 : lit * night; // toko & kantor: lampu menyala siang hari
  return c * (dayL * (1.0 - night * 0.9) + vec3(1.0, 0.9, 0.75) * (0.35 + glow * 2.2) * lampOn);
}
#endif
` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  float hbi = floor(vBid + 0.5), hsA = mod(hbi, 8.0);
#ifdef REAL
  vec3 rNw = normalize(vWN);
  bool rFlat = abs(rNw.y) > 0.96;
  vec3 rT = rFlat ? vec3(1.0, 0.0, 0.0) : normalize(vec3(rNw.z, 0.0, -rNw.x)); // sepanjang dinding/atap (arah u naik)
  vec3 rB = rFlat ? vec3(0.0, 0.0, -1.0) : cross(rNw, rT);                       // ke atas (dinding) / naik lereng (atap)
  vec2 rSuv = vec2(dot(vWPos, rT), dot(vWPos, rB));
  vec3 rNrm = vec3(0.0, 0.0, 1.0), rInterior = vec3(0.0);
  float rRough = 0.9, rMetal = 0.0, rCur = 0.0, rD = 4.2, rStyle = 0.0;
  vec4 rRoom = vec4(0.0, 0.0, 3.6, 3.3);
#endif
  if (uGame > 0.5 && vWuv.y > -0.5 && vWuv.z < 0.5 && vBid >= 0.0) { // rumah: gaya per rumah (putih modern / krem klasik / pastel), gradasi bawah dari warna verteks
    vec3 base = hsA < 3.0 ? vec3(0.96, 0.96, 0.94) : hsA < 5.0 ? vec3(0.95, 0.89, 0.78) : hsA < 6.0 ? vec3(0.84, 0.91, 0.87) : hsA < 7.0 ? vec3(0.86, 0.9, 0.95) : vec3(0.96, 0.87, 0.8);
    float shade = clamp(dot(diffuseColor.rgb, vec3(0.3333)) / 0.9, 0.72, 1.05);
    diffuseColor.rgb = base * shade;
    if (hsA < 3.0 && vWuv.x >= 0.0 && vWuv.y > 3.35 && vWuv.y < 6.3 && fract(vWuv.x / 10.8) < 0.34) { // putih modern: panel kayu di lantai atas
      float sl = fract(vWuv.x / 0.14);
      diffuseColor.rgb = mix(vec3(0.56, 0.38, 0.24), vec3(0.40, 0.27, 0.16), step(0.84, sl)) * shade;
    }
    if (hsA >= 3.0 && hsA < 5.0 && vWuv.y < 1.0 && vWuv.y > 0.42) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.47) * shade, step(0.08, fract(vWuv.y / 0.29)) * 0.85); // krem: lis batu alam
  }
  // Jendela rumah yang sah (aturan yang sama di collide.js winOk & interiors.js): sel jendela utuh di dalam sisi dinding
  // (≥ 0,3 m dari sudut; vSeg = rentang u sisi) dan, di lantai dasar, tidak menumpuk pintu (± 0,2 m).
  float wb0 = floor(vWuv.x / 3.6) * 3.6 + 1.08, wb1 = wb0 + 1.44;
  bool hWinOk = !(vSeg.y > vSeg.x && (wb0 < vSeg.x + 0.3 || wb1 > vSeg.y - 0.3));
  float doorK = 0.0, dU0 = 0.0, dU1 = 1.0; // doorK = 1: piksel daun pintu tertutup (rumah belum dibuka)
  if (vWuv.x >= 0.0 && (vWuv.z < 1.5 || abs(vWuv.z - 4.0) < 0.5) && vBid >= 0.0) {
    int bi = int(vBid + 0.5);
    ivec2 tc = ivec2((bi % ${OPEN_W / 2}) * 2, bi / ${OPEN_W / 2});
    vec4 o0 = texelFetch(uOpen, tc, 0);
    if (o0.a > 0.0) { // gedung yang bisa dimasuki: data pintu selalu ada; o0.r > 0,5 = sedang terbuka (interior dibangun)
      vec4 o1 = texelFetch(uOpen, tc + ivec2(1, 0), 0);
      bool isOpen = o0.r > 0.5 && vWuv.y < o0.a;
      if (o1.b > 0.0) { // toko/aula: bukaan berkala di rentang sisi depan
        float bf = mod(vWuv.x, o1.b);
        if (isOpen && ((vWuv.x >= o0.g && vWuv.x <= o0.b) || (vWuv.x >= o1.r && vWuv.x <= o1.g)) && bf >= o1.a && bf <= o1.b - o1.a) discard;
      } else {
        bool inA = vWuv.x >= o0.g && vWuv.x <= o0.b, inB = vWuv.x >= o1.r && vWuv.x <= o1.g;
        bool door = vWuv.y < 2.2 && (inA || inB);
        if (vWuv.y < 3.3 && ((wb0 < o0.b + 0.2 && wb1 > o0.g - 0.2) || (wb0 < o1.g + 0.2 && wb1 > o1.r - 0.2))) hWinOk = false;
        float hfx = fract(vWuv.x / 3.6), hfy = fract(vWuv.y / 3.3);
        bool win = hWinOk && vWuv.y > 0.8 && hfy >= 0.36 && hfy <= 0.78 && hfx >= 0.3 && hfx <= 0.7;
        if (isOpen && (door || win)) discard;
        if (door) { doorK = 1.0; dU0 = inA ? o0.g : o1.r; dU1 = inA ? o0.b : o1.g; }
      }
    }
  }
  float winMask = 0.0;
  float winLit = 0.0;
  float signMask = 0.0;
  vec3 signCol = vec3(0.0);
  if (vWuv.x >= 0.0 && vWuv.z < 4.5) {
    float k = vWuv.z;
    bool tower = k > 1.5 && k < 2.5;
    bool house = k < 0.5;
    bool mall = k > 3.5;
    bool shop = (k > 0.5 && k < 1.5) || mall;
    float bay = house ? 3.6 : (tower ? 1.7 : 2.6);
    float fx = fract(vWuv.x / bay);
    if (shop && vWuv.y < 4.1) {
      if (vWuv.y > 3.1) { // papan nama ruko, warna per toko
        float sx = fract(vWuv.x / 5.2), hs = fract(sin(floor(vWuv.x / 5.2) * 91.17) * 3758.5453);
        signCol = hs < 0.17 ? vec3(0.80, 0.16, 0.14) : hs < 0.34 ? vec3(0.95, 0.72, 0.12) : hs < 0.5 ? vec3(0.12, 0.38, 0.75)
          : hs < 0.66 ? vec3(0.10, 0.55, 0.32) : hs < 0.83 ? vec3(0.93, 0.45, 0.10) : vec3(0.85, 0.85, 0.88);
        signMask = step(0.05, sx) * step(sx, 0.95);
        diffuseColor.rgb = mix(diffuseColor.rgb, signCol, signMask);
      } else if (vWuv.y > 0.25) { // etalase kaca lantai dasar
        float sf = fract(vWuv.x / 1.3);
        winMask = step(0.06, sf) * step(sf, 0.94);
        winLit = 1.0;
#ifdef REAL
        rRoom = vec4(mod(vWuv.x, 5.2), vWuv.y, 5.2, 3.1); rD = 6.0; rStyle = 1.0;
#endif
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.18, 0.21, 0.27), uSky * 0.6, 0.25), winMask * 0.85);
      }
    } else if (mall) { // mal: panel kladding, pita kaca per lantai, papan reklame besar tiap 46 m
      float px = fract(vWuv.x / 3.0), py = fract(vWuv.y / 1.5), pid = h21(vec2(floor(vWuv.x / 3.0), floor(vWuv.y / 1.5)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.85, 0.82), 0.45) * (0.95 + 0.08 * pid);
      diffuseColor.rgb *= 1.0 - 0.16 * min(1.0, (1.0 - step(0.015, px)) + (1.0 - step(0.025, py)));
      float fl = fract((vWuv.y - 4.1) / 3.9);
      float rib = step(0.22, fl) * step(fl, 0.62) * step(0.03, fract(vWuv.x / 2.0)) * step(fract(vWuv.x / 2.0), 0.97);
      float bx = mod(vWuv.x, 46.0), bi = floor(vWuv.x / 46.0);
      float board = step(8.0, bx) * step(bx, 20.0) * step(4.6, vWuv.y) * step(vWuv.y, 7.0);
      if (board > 0.5) {
        float hb = h21(vec2(bi, 9.1)), edge = 1.0 - step(0.12, min(min(bx - 8.0, 20.0 - bx), min(vWuv.y - 4.6, 7.0 - vWuv.y)));
        vec3 bc = hb < 0.25 ? vec3(0.24, 0.22, 0.51) : hb < 0.5 ? vec3(0.82, 0.62, 0.32) : hb < 0.75 ? vec3(0.75, 0.18, 0.16) : vec3(0.1, 0.45, 0.6);
        signCol = mix(bc, vec3(0.97), edge);
        signMask = 1.0;
        diffuseColor.rgb = signCol;
      } else if (rib > 0.5) {
        winMask = 1.0;
        winLit = step(0.45, h21(vec2(floor(vWuv.x / 2.0), floor((vWuv.y - 4.1) / 3.9))));
#ifdef REAL
        rRoom = vec4(mod(vWuv.x, 6.0), fl * 3.9, 6.0, 3.9); rD = 9.0; rStyle = 1.0;
#endif
        diffuseColor.rgb = mix(mix(vec3(0.16, 0.2, 0.26), uSky * 0.75, 0.35 + 0.3 * fl), vec3(0.08, 0.08, 0.14), uNight * 0.85);
      }
    } else if (vWuv.y > 0.8) {
      float fh = tower ? 3.7 : 3.3;
      float fy = fract(vWuv.y / fh);
      float y0 = tower ? 0.1 : 0.36;
      float y1 = tower ? 0.93 : 0.78;
      float x0 = tower ? 0.07 : (house ? 0.3 : 0.16);
      winMask = step(y0, fy) * step(fy, y1) * step(x0, fx) * step(fx, 1.0 - x0);
      if (house && !hWinOk) winMask = 0.0; // terpotong sudut / menumpuk pintu: dinding polos
#ifdef REAL
      rRoom = tower ? vec4(mod(vWuv.x, 6.8), fy * fh, 6.8, fh) : vec4(fx * bay, fy * fh, bay, fh);
      rD = tower ? 7.0 : 4.2; rStyle = tower ? 2.0 : (shop ? 3.0 : 0.0);
#endif
      float frame = 0.0, sill = 0.0, sillSh = 0.0;
      if (shop) { // ruko lantai atas: kusen aluminium + palang tengah
        float lx = fx * 2.6, ly = fy * 3.3, dE = min(min(lx - 0.416, 2.184 - lx), min(ly - 1.188, 2.574 - ly));
        frame = winMask * min(1.0, (1.0 - step(0.06, dE)) + (1.0 - step(0.025, abs(lx - 1.3))));
        sill = step(0.36, lx) * step(lx, 2.24) * step(1.12, ly) * step(ly, 1.188);
        winMask *= 1.0 - frame;
      }
      if (house) { // kusen 7 cm, palang tengah & atas, ambang jendela menonjol + bayangannya
        float lx = fx * 3.6, ly = fy * 3.3, dE = min(min(lx - 1.08, 2.52 - lx), min(ly - 1.188, 2.574 - ly));
        frame = winMask * min(1.0, (1.0 - step(0.07, dE)) + (1.0 - step(0.028, abs(lx - 1.8))) + (1.0 - step(0.024, abs(ly - 2.17))));
        sill = step(0.99, lx) * step(lx, 2.61) * step(1.10, ly) * step(ly, 1.188);
        sillSh = step(1.01, lx) * step(lx, 2.59) * step(1.05, ly) * step(ly, 1.10);
        if (!hWinOk) { sill = 0.0; sillSh = 0.0; }
        winMask *= 1.0 - frame;
      }
      float cell = floor(vWuv.x / bay) * 12.9898 + floor(vWuv.y / fh) * 78.233;
      winLit = step(house ? 0.55 : 0.4, fract(sin(cell) * 43758.5453));
      vec3 glass = tower ? mix(diffuseColor.rgb * 0.42, uSky, 0.35 + 0.25 * fy) : mix(vec3(0.20, 0.24, 0.31), uSky * 0.7, 0.3);
      glass = mix(glass, vec3(0.08, 0.08, 0.14), uNight * 0.85);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask * (tower ? 0.92 : 0.8));
      if (!house) diffuseColor.rgb *= 1.0 - 0.14 * (1.0 - step(0.045, fy));
      if (shop) { diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.32, 0.35), frame); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.89, 0.86), sill); }
      if (house) {
        float fs = mod(hbi, 7.0);
        vec3 frameC = fs < 3.0 ? vec3(0.95, 0.94, 0.91) : fs < 5.0 ? vec3(0.2, 0.2, 0.22) : vec3(0.42, 0.29, 0.19);
        float lx2 = fx * 3.6, cur = winMask * (step(lx2, 1.4) + step(2.2, lx2)) * (1.0 - uNight * 0.6); // gorden tersibak di kiri-kanan
#ifdef REAL
        rCur = min(1.0, cur);
#endif
        float ck = h21(vec2(floor(vWuv.x / 3.6), floor(vWuv.y / 3.3) + hbi));
        diffuseColor.rgb = mix(diffuseColor.rgb, ck < 0.3 ? vec3(0.78, 0.36, 0.3) : ck < 0.55 ? vec3(0.85, 0.8, 0.68) : ck < 0.8 ? vec3(0.36, 0.45, 0.6) : vec3(0.55, 0.62, 0.45), min(1.0, cur) * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, frameC, frame);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.91, 0.87), sill);
        diffuseColor.rgb *= 1.0 - 0.28 * sillSh;
      }
    }
#ifdef REAL
    if (winMask > 0.01) { // kaca: interior terlihat di baliknya, permukaan memantulkan langit (pantulan lingkungan + fresnel)
      float gl = winMask * (1.0 - rCur * 0.9);
      vec3 Vw = normalize(vWPos - cameraPosition);
      vec3 rd = vec3(dot(Vw, rT), Vw.y, max(-dot(Vw, rNw), 0.03));
      float seed = floor(vWuv.x / rRoom.z) * 7.13 + floor(vWuv.y / rRoom.w) * 3.71 + hbi * 0.37;
      rInterior = interiorRoom(rRoom.xy, rRoom.zw, rD, rd, seed, rStyle, winLit, uNight) * gl * (tower ? 0.3 : 1.0);
      vec3 tg = mix(vec3(0.16, 0.24, 0.3), vec3(0.2, 0.27, 0.26), h21(vec2(hbi, 4.4))); // warna kaca per menara (biru / kehijauan)
      diffuseColor.rgb = mix(diffuseColor.rgb, tower ? tg : vec3(0.03, 0.035, 0.04), gl);
      rRough = mix(rRough, tower ? 0.1 : 0.07, gl);
      rMetal = tower ? 0.82 * gl : 0.0;
    }
    if (tower && vWuv.y > 0.8) { // rangka aluminium & pita antar-lantai gelap di antara kaca
      float fr = 1.0 - winMask;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.19, 0.22), fr * 0.85);
      rRough = mix(rRough, 0.45, fr); rMetal = max(rMetal, 0.5 * fr);
    }
#endif
  }
  if (vWuv.y > -0.5 && vWuv.z < 3.5) { // dinding: plester tidak rata, list bawah (rumah), list antar-lantai (rumah)
    float pn = vnoise(vec2(vWuv.x, vWuv.y) * 0.7) * 0.6 + vnoise(vec2(vWuv.x, vWuv.y) * 4.0) * 0.4;
    diffuseColor.rgb *= 0.95 + 0.08 * pn;
    if (vWuv.z < 0.5) {
      if (vWuv.y < 0.42) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.58 + vec3(0.04, 0.035, 0.03), 0.9) * (vWuv.y > 0.38 ? 1.25 : 1.0);
      float my = mod(vWuv.y, 3.3);
      if (vWuv.y > 3.0 && my > 3.06 && my < 3.24) diffuseColor.rgb *= my < 3.1 ? 0.8 : 1.12;
    }
    diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(0.0, 1.2, vWuv.y); // gelap tipis dekat tanah
  } else if (vWuv.x < 0.0 && vWN.y > 0.2 && vWN.y < 0.96) { // atap miring: baris genteng bersusun
    float row = vWPos.y / 0.24, r = fract(row);
    vec2 tdir = normalize(vec2(-vWN.z, vWN.x) + vec2(1e-5));
    float colm = fract(dot(vWPos.xz, tdir) / 0.32 + floor(row) * 0.5);
    float shade = (0.78 + 0.22 * smoothstep(0.0, 0.35, r)) * (1.0 - 0.12 * (1.0 - step(0.07, colm)));
    diffuseColor.rgb *= shade * (0.94 + 0.12 * vnoise(vWPos.xz * 0.5));
  }
  if (doorK > 0.5) { // pintu tertutup (rumah di luar jangkauan buka): dua daun pintu panel kayu + kusen + gagang
    float lw = dU1 - dU0, lx = vWuv.x - dU0, ly = vWuv.y, hx = abs(lx - lw * 0.5); // hx: jarak dari celah tengah
    vec3 wood = vec3(0.36, 0.23, 0.14) * (0.85 + 0.3 * h21(vec2(hbi, 3.1)));
    float pan = step(0.1, hx) * step(hx, lw * 0.5 - 0.17) * (step(0.2, ly) * step(ly, 0.95) + step(1.1, ly) * step(ly, 1.95)); // panel timbul
    vec3 dc = wood * (1.0 - 0.14 * pan) * (0.9 + 0.1 * step(0.012, hx));
    float fs2 = mod(hbi, 7.0);
    vec3 dfr = fs2 < 3.0 ? vec3(0.95, 0.94, 0.91) : fs2 < 5.0 ? vec3(0.2, 0.2, 0.22) : vec3(0.42, 0.29, 0.19);
    dc = mix(dc, dfr, max(max(step(lx, 0.07), step(lw - 0.07, lx)), step(2.12, ly))); // kusen
    dc = mix(dc, vec3(0.78, 0.74, 0.62), 1.0 - step(0.03, length(vec2(hx - 0.07, ly - 1.02)))); // gagang
    diffuseColor.rgb = dc;
#ifdef REAL
    rRough = 0.5;
#endif
  }
#ifdef REAL
  if (vWuv.y > -0.5) { // dinding: detail plester foto (dinormalkan terhadap rata-ratanya) + peta normal
    vec2 tuv = rSuv / uRTile.x;
    float wallK = (1.0 - winMask) * (1.0 - signMask) * (1.0 - doorK);
    float det = dot(texture2D(tPlA, tuv).rgb, vec3(0.3333)) / max(dot(textureLod(tPlA, tuv, 10.0).rgb, vec3(0.3333)), 0.05);
    diffuseColor.rgb *= mix(1.0, det, 0.55 * wallK);
    vec3 pn = texture2D(tPlN, tuv).xyz * 2.0 - 1.0;
    rNrm = normalize(vec3(pn.xy * 0.7 * wallK, pn.z));
  } else if (!rFlat && rNw.y > 0.2) { // atap miring: genteng foto; atap terakota memakai warna foto, lainnya diwarnai
    vec2 ruv = rSuv / uRTile.y;
    vec3 ta = texture2D(tRfA, ruv).rgb;
    float tl = dot(ta, vec3(0.3333)) / max(dot(textureLod(tRfA, ruv, 10.0).rgb, vec3(0.3333)), 0.05);
    diffuseColor.rgb = vColor.r > vColor.b * 1.5 ? mix(vColor * tl, ta * 1.15, 0.65) : vColor * tl * 1.05;
    vec3 tn = texture2D(tRfN, ruv).xyz * 2.0 - 1.0;
    rNrm = normalize(vec3(tn.xy * 1.2, tn.z));
    rRough = 0.8;
  } else if (rFlat && rNw.y > 0.0) { // atap datar / dak beton
    vec2 tuv = rSuv / (uRTile.x * 1.7);
    diffuseColor.rgb *= dot(texture2D(tPlA, tuv).rgb, vec3(0.3333)) / max(dot(textureLod(tPlA, tuv, 10.0).rgb, vec3(0.3333)), 0.05);
    rNrm = normalize(vec3((texture2D(tPlN, tuv).xy * 2.0 - 1.0) * 0.7, 1.0));
  }
#endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef REAL
  normal = normalize((viewMatrix * vec4(normalize(rT * rNrm.x + rB * rNrm.y + rNw * rNrm.z), 0.0)).xyz);
#endif`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef REAL
  roughnessFactor = rRough; metalnessFactor = rMetal;
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.46) * winMask * winLit * uNight * 0.95 + signCol * signMask * uNight * 0.9;
#ifdef REAL
  totalEmissiveRadiance += rInterior * uAmb * 2.2; // interior di balik kaca
#else
  if (uGame > 0.5) {
    if (vWuv.y > -0.5) totalEmissiveRadiance += diffuseColor.rgb * 0.14 * (1.0 - uNight); // cahaya pantul tanah & langit
    float gfr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 4.0);
    totalEmissiveRadiance += uSky * winMask * (0.1 + 0.6 * gfr) * (1.0 - uNight * 0.8) * (vWuv.z > 1.5 && vWuv.z < 2.5 ? 1.4 : 0.8); // kaca memantulkan langit (gedung tinggi lebih kuat)
  }
#endif`);
    if (real) sh.vertexShader = '#define REAL\n' + sh.vertexShader;
  };
  if (real) real.patch(bMat, { dyn: true });
  const V = (x, y, h, u, v, c, s) => ({ p: [x, h, -y], w: u === undefined ? null : [u, v], c, s }); // s: rentang u sisi dinding [awal, akhir]
  function emitTri(a, b, c, n, col, o) {
    let B1 = b, C1 = c;
    const ux = B1.p[0] - a.p[0], uy = B1.p[1] - a.p[1], uz = B1.p[2] - a.p[2], vx = C1.p[0] - a.p[0], vy = C1.p[1] - a.p[1], vz = C1.p[2] - a.p[2];
    let gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-9) return;
    let N = n;
    if (!N) { // hadap ke atas
      if (gy < 0) { gx = -gx; gy = -gy; gz = -gz; const t = B1; B1 = C1; C1 = t; }
      N = [gx / gl, gy / gl, gz / gl];
    } else if (gx * N[0] + gy * N[1] + gz * N[2] < 0) { const t = B1; B1 = C1; C1 = t; }
    for (const v of [a, B1, C1]) {
      const cc = v.c || col;
      o.pos.push(v.p[0], v.p[1], v.p[2]); o.nor.push(N[0], N[1], N[2]); o.col.push(cc.r, cc.g, cc.b);
      o.wuv.push(v.w ? v.w[0] : -1, v.w ? v.w[1] : -1, o.kind);
      if (o.seg) o.seg.push(v.s ? v.s[0] : 0, v.s ? v.s[1] : 0);
    }
    o.owner.push(o.cur);
  }
  function walls(pts, z0, z1, o, topC, lowC, inward, windows, blind) { // blind: sisi tanpa jendela (menempel gedung lain)
    let per = 0;
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const n = inward ? [-dy / len, 0, -dx / len] : [dy / len, 0, dx / len];
      const win = windows && !(blind && blind.has(j));
      const u0 = win ? per : windows ? -1000 : undefined, u1 = win ? per + len : windows ? -1000 : undefined; // −1000: dinding tanpa jendela
      const sg = win ? [per, per + len] : null; // rentang sisi: shader meniadakan jendela yang terpotong sudut
      const A0 = V(a.x, a.y, z0, u0, z0, lowC, sg), B0 = V(b.x, b.y, z0, u1, z0, lowC, sg), B1 = V(b.x, b.y, z1, u1, z1, topC, sg), A1 = V(a.x, a.y, z1, u0, z1, topC, sg);
      emitTri(A0, B0, B1, n, topC, o);
      emitTri(A0, B1, A1, n, topC, o);
      per += len;
    }
  }
  function cap(pts, z, c, o) {
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts.slice(), []); } catch (e) { return; }
    for (const t of tris) emitTri(V(pts[t[0]].x, pts[t[0]].y, z), V(pts[t[1]].x, pts[t[1]].y, z), V(pts[t[2]].x, pts[t[2]].y, z), null, c, o);
  }
  function ring(pts, z, o) { for (let j = 0; j < pts.length; j++) { const a = pts[j], b = pts[(j + 1) % pts.length]; o.lines.push(a.x, z, -a.y, b.x, z, -b.y); } }
  function hipRoof(q0, h, c, o) {
    let q = q0;
    if (q[1].distanceTo(q[2]) > q[0].distanceTo(q[1])) q = [q0[1], q0[2], q0[3], q0[0]];
    const L = q[0].distanceTo(q[1]), S = q[1].distanceTo(q[2]);
    const ctr = new THREE.Vector2().add(q[0]).add(q[1]).add(q[2]).add(q[3]).multiplyScalar(0.25);
    const u = new THREE.Vector2().subVectors(q[1], q[0]).normalize();
    const half = Math.max(0, L / 2 - S / 2), rh = Math.min(3.2, S * 0.3);
    const r0 = ctr.clone().addScaledVector(u, -half), r1 = ctr.clone().addScaledVector(u, half);
    const P = (p, z) => V(p.x, p.y, z);
    const faces = [[q[0], q[1], r1, r0], [q[1], q[2], r1], [q[2], q[3], r0, r1], [q[3], q[0], r0]];
    const shade = [1.0, 0.86, 0.94, 0.8];
    faces.forEach((f, fi) => {
      const cc = c.clone().multiplyScalar(shade[fi]), zs = f.map((p, k) => (k < 2 ? h : h + rh));
      emitTri(P(f[0], zs[0]), P(f[1], zs[1]), P(f[2], zs[2]), null, cc, o);
      if (f.length === 4) emitTri(P(f[0], zs[0]), P(f[2], zs[2]), P(f[3], zs[3]), null, cc, o);
    });
    o.lines.push(r0.x, h + rh, -r0.y, r1.x, h + rh, -r1.y);
  }
  function pyramidRoof(pts, h, c, o, rh) {
    const ax = pts.reduce((s, p) => s + p.x, 0) / pts.length, ay = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const apex = V(ax, ay, h + rh);
    pts.forEach((a, j) => {
      const b = pts[(j + 1) % pts.length];
      emitTri(V(a.x, a.y, h), V(b.x, b.y, h), apex, null, c.clone().multiplyScalar(j % 2 ? 0.86 : 1.0), o);
    });
  }
  function box(cx, cy, w, d, z0, z1, c, o) {
    const pts = [new THREE.Vector2(cx - w / 2, cy - d / 2), new THREE.Vector2(cx + w / 2, cy - d / 2), new THREE.Vector2(cx + w / 2, cy + d / 2), new THREE.Vector2(cx - w / 2, cy + d / 2)];
    walls(pts, z0, z1, o, c, c.clone().multiplyScalar(0.85), false, false);
    cap(pts, z1, c.clone().multiplyScalar(1.06), o);
  }
  // Sisi rumah yang menempel gedung lain (rumah gandeng, jarak < 1,2 m): tidak diberi jendela.
  let BG = null;
  const BGC = 40, bgk = (x, y) => Math.floor(x / BGC) * 100003 + Math.floor(y / BGC);
  function insideOther(x, y, self) {
    if (!BG) {
      BG = { cells: new Map(), box: [] };
      for (let k = 0; k < B.r.length; k++) {
        const r = B.r[k];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let j = 0; j < r.length; j += 2) { x0 = Math.min(x0, r[j] * M); y0 = Math.min(y0, r[j + 1] * M); x1 = Math.max(x1, r[j] * M); y1 = Math.max(y1, r[j + 1] * M); }
        BG.box[k] = [x0, y0, x1, y1];
        for (let cx = Math.floor(x0 / BGC); cx <= Math.floor(x1 / BGC); cx++) for (let cy = Math.floor(y0 / BGC); cy <= Math.floor(y1 / BGC); cy++) { const key = cx * 100003 + cy; (BG.cells.get(key) || BG.cells.set(key, []).get(key)).push(k); }
      }
    }
    for (const k of BG.cells.get(bgk(x, y)) || []) {
      if (k === self || B.k[k] === 5) continue;
      const bb = BG.box[k];
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      const r = B.r[k], n = r.length >> 1;
      let ins = false;
      for (let a = 0, c = n - 1; a < n; c = a++) { const xi = r[2 * a] * M, yi = r[2 * a + 1] * M, xj = r[2 * c] * M, yj = r[2 * c + 1] * M; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
      if (ins) return true;
    }
    return false;
  }
  function blindEdges(i, pts) { // pts CCW; indeks sisi j sama dengan interiors.js edgesOf
    const set = new Set();
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const ox = dy / len, oy = -dx / len; // normal keluar
      let hits = 0;
      for (const t of [0.2, 0.5, 0.8]) if (insideOther(a.x + dx * t + ox * 1.2, a.y + dy * t + oy * 1.2, i)) hits++;
      if (hits >= 2) set.add(j);
    }
    return set;
  }
  function addBuilding(i, o, override) {
    const pts = V2(B.r[i]);
    if (pts.length < 3) return;
    if (THREE.ShapeUtils.area(pts) < 0) pts.reverse();
    const h = B.h[i] * M, kind = B.k[i], area = Math.abs(THREE.ShapeUtils.area(pts));
    const r1 = hash01(pts[0].x, pts[0].y), r2 = hash01(pts[0].y + 3.1, pts[0].x);
    const wallC = C(override || pickOf(WALLS[kind] || WALLS[0], r1));
    const roofC = C(override || pickOf(ROOFS[kind] || ROOFS[0], r2));
    if (!override && !game && (B.f[i] & 4)) { wallC.lerp(MUTE, 0.45); roofC.lerp(MUTE, 0.55); } // enclave di peta digital twin: warna diredam
    const lowC = wallC.clone().multiplyScalar(0.78);
    o.kind = kind === 1 && area > 3000 ? 4 : kind; // 4 = mal / toko besar (gaya fasad sendiri di shader)
    o.cur = i;
    const blind = kind === 0 ? blindEdges(i, pts) : null;
    if (blind && blind.size) (D.blind || (D.blind = new Map())).set(i, blind); // dipakai interiors.js & collide.js (tanpa lubang jendela)
    walls(pts, 0, h, o, wallC, lowC, false, true, blind);
    const pitched = kind === 0 && ((B.f[i] & 2) === 2 || (area < 450 && pts.length <= 8 && isConvex(pts)));
    if (pitched) {
      const eave = insetPoly(pts, -0.38);
      walls(eave, h - 0.28, h, o, roofC.clone().multiplyScalar(0.62), roofC.clone().multiplyScalar(0.55), false, false); // lisplang
      cap(eave, h - 0.28, roofC.clone().multiplyScalar(0.5), o); // bawah atap (terlihat dari samping)
      if (eave.length === 4 && (B.f[i] & 2) === 2) hipRoof(eave, h, roofC, o);
      else pyramidRoof(eave, h, roofC, o, Math.min(2.6, Math.sqrt(area) * 0.16));
      ring(eave, h, o);
      return;
    }
    const inset = insetPoly(pts, 0.5);
    const okInset = inset.length === pts.length && THREE.ShapeUtils.area(inset) > 0.3 * area;
    if (!okInset) { cap(pts, h, roofC, o); ring(pts, h, o); return; }
    // parapet: bibir atas, dinding dalam, lantai atap lebih rendah
    const rimC = wallC.clone().multiplyScalar(0.96);
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length], c = inset[(j + 1) % pts.length], d = inset[j];
      emitTri(V(a.x, a.y, h), V(b.x, b.y, h), V(c.x, c.y, h), null, rimC, o);
      emitTri(V(a.x, a.y, h), V(c.x, c.y, h), V(d.x, d.y, h), null, rimC, o);
    }
    walls(inset, h - 0.9, h, o, wallC.clone().multiplyScalar(0.9), wallC.clone().multiplyScalar(0.8), true, false);
    cap(inset, h - 0.9, roofC, o);
    ring(pts, h, o);
    if (h > 10 && pts.length <= 12) for (const p of pts) o.lines.push(p.x, 0, -p.y, p.x, h, -p.y);
    const cx = inset.reduce((s, p) => s + p.x, 0) / inset.length, cy = inset.reduce((s, p) => s + p.y, 0) / inset.length;
    if (kind === 2) { // mahkota gedung tinggi
      const crown = inset.map((p) => new THREE.Vector2(cx + (p.x - cx) * 0.78, cy + (p.y - cy) * 0.78));
      const ch = THREE.MathUtils.clamp(h * 0.06, 3, 8);
      walls(crown, h - 0.9, h - 0.9 + ch, o, wallC, wallC.clone().multiplyScalar(0.88), false, true);
      cap(crown, h - 0.9 + ch, roofC.clone().multiplyScalar(0.92), o);
      ring(crown, h - 0.9 + ch, o);
    } else if (area > 450) { // unit AC / ruang mesin di atap
      const n = Math.min(3, 1 + Math.floor(area / 1600)), ib = bounds(inset), unitC = C('#c9cad3');
      for (let k = 0; k < n; k++) {
        const ux = cx + (hash01(cx + k * 7.1, cy) - 0.5) * (ib.maxx - ib.minx) * 0.6, uy = cy + (hash01(cy - k * 3.3, cx) - 0.5) * (ib.maxy - ib.miny) * 0.6;
        if (!pip(ux, uy, inset)) continue;
        box(ux, uy, 2.4 + hash01(ux, uy) * 4, 2.4 + hash01(uy, ux) * 3, h - 0.9, h - 0.9 + 1.8 + hash01(ux, k) * 1.4, unitC, o);
      }
    }
  }
  const out = { pos: [], nor: [], col: [], wuv: [], seg: [], owner: [], lines: [], kind: 0, cur: 0 };
  for (let i = 0; i < B.r.length; i++) addBuilding(i, out, null);
  const bGeo = geo(out.pos, out.nor, out.col, out.wuv);
  bGeo.userData.owner = out.owner;
  { const bid = new Float32Array(out.owner.length * 3); out.owner.forEach((o, t) => { bid[t * 3] = bid[t * 3 + 1] = bid[t * 3 + 2] = o; }); bGeo.setAttribute('bid', new THREE.BufferAttribute(bid, 1)); }
  bGeo.setAttribute('wseg', new THREE.Float32BufferAttribute(out.seg, 2));
  // data pintu & keadaan buka/tutup tiap rumah untuk shader fasad (dipanggil interiors.js): baris = [terbuka 0/1, pintu A
  // u0, u1, tinggi bukaan, pintu B u0, u1, P, p]. Data pintu selalu ada (pintu tertutup digambar dari jauh, jendela yang
  // menumpuk pintu ditiadakan); kolom pertama saja yang berubah saat rumah dibuka/ditutup.
  const setHouseOpen = (H, on) => {
    const i = H.i, o = ((i % (OPEN_W / 2)) * 2 + Math.floor(i / (OPEN_W / 2)) * OPEN_W) * 4, f = on ? 1 : 0;
    if (H.open) { const O = H.open; openData.set([f, O.A[0], O.A[1], O.top, O.B[0], O.B[1], O.P, O.p], o); }
    else { const d1 = H.doors[0], d2 = H.doors[1]; openData.set([f, d1 ? d1.u0 : -9, d1 ? d1.u1 : -9, H.up ? H.up.ceil : H.ceil, d2 ? d2.u0 : -9, d2 ? d2.u1 : -9, 0, 0], o); }
    openTex.needsUpdate = true;
  };
  const buildings = new THREE.Mesh(bGeo, bMat);
  buildings.castShadow = buildings.receiveShadow = true;
  if (game && real) {
    // Matahari masuk lewat pintu & jendela gedung yang bisa dimasuki: peta bayangan memakai lubang yang sama dengan
    // fasad (aturan jendela sah, data pintu di uOpen; tidak bergantung rumah sedang dibuka atau tidak). Dinding & atap
    // yang menghadap matahari ikut menghalangi (shadowSide dua sisi) — kalau tidak, isi rumah dianggap terang semua.
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    dm.onBeforeCompile = (sh) => {
      sh.uniforms.uOpen = openU;
      sh.vertexShader = 'attribute vec3 wuv;\nattribute float bid;\nattribute vec2 wseg;\nvarying vec3 vWuv;\nvarying float vBid;\nvarying vec2 vSeg;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWuv = wuv;\n  vBid = bid;\n  vSeg = wseg;');
      sh.fragmentShader = 'uniform highp sampler2D uOpen;\nvarying vec3 vWuv;\nvarying float vBid;\nvarying vec2 vSeg;\n' + sh.fragmentShader.replace('void main() {', `void main() {
  if (vWuv.x >= 0.0 && (vWuv.z < 1.5 || abs(vWuv.z - 4.0) < 0.5) && vBid >= 0.0) {
    int bi = int(vBid + 0.5);
    ivec2 tc = ivec2((bi % ${OPEN_W / 2}) * 2, bi / ${OPEN_W / 2});
    vec4 o0 = texelFetch(uOpen, tc, 0);
    if (o0.a > 0.0 && vWuv.y < o0.a) {
      vec4 o1 = texelFetch(uOpen, tc + ivec2(1, 0), 0);
      bool inA = vWuv.x >= o0.g && vWuv.x <= o0.b, inB = vWuv.x >= o1.r && vWuv.x <= o1.g;
      if (o1.b > 0.0) { float bf = mod(vWuv.x, o1.b); if ((inA || inB) && bf >= o1.a && bf <= o1.b - o1.a) discard; }
      else {
        float wb0 = floor(vWuv.x / 3.6) * 3.6 + 1.08, wb1 = wb0 + 1.44, hfx = fract(vWuv.x / 3.6), hfy = fract(vWuv.y / 3.3);
        bool ok = !(vSeg.y > vSeg.x && (wb0 < vSeg.x + 0.3 || wb1 > vSeg.y - 0.3));
        if (vWuv.y < 3.3 && ((wb0 < o0.b + 0.2 && wb1 > o0.g - 0.2) || (wb0 < o1.g + 0.2 && wb1 > o1.r - 0.2))) ok = false;
        if ((vWuv.y < 2.2 && (inA || inB)) || (ok && vWuv.y > 0.8 && hfy >= 0.36 && hfy <= 0.78 && hfx >= 0.3 && hfx <= 0.7)) discard;
      }
    }
  }`);
    };
    buildings.customDepthMaterial = dm;
    bMat.shadowSide = THREE.DoubleSide;
  }
  buildings.matrixAutoUpdate = false;
  scene.add(buildings);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(out.lines, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x3d3782, transparent: true, opacity: 0.2, depthWrite: false });
  const edges = new THREE.LineSegments(lineGeo, lineMat);
  edges.renderOrder = 1;
  edges.matrixAutoUpdate = false;
  scene.add(edges);
  progress(70, 'Menanam pohon…');

  // ---------- Pohon ----------
  // Tiga jenis: rindang (tajuk bergumpal), palem (boulevard), cemara (taman). Satu InstancedMesh per jenis.
  const trees = (() => {
    const T = D.trees, st = D.meta.treeStride || 3, n = Math.floor(T.length / st);
    const groups = [[], [], []];
    for (let i = 0; i < n; i++) groups[st > 3 ? T[i * st + 3] : 0].push(i);
    const blob = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z);
    const roundGeo = shadeY(organicCrown(1.7), 0.6, 1.15);
    const coneGeo = shadeY(mergeGeometries([new THREE.ConeGeometry(1, 2.4, 7).translate(0, 1.2, 0), new THREE.ConeGeometry(0.78, 2.0, 7).translate(0, 2.3, 0), new THREE.ConeGeometry(0.5, 1.5, 7).translate(0, 3.2, 0)]), 0.6, 1.08);
    const palmGeo = shadeY(palmCrown(), 0.7, 1.12);
    const greens = [['#4c8b3c', '#5a9a45', '#679f4a', '#3f7a35', '#73aa52', '#4f8f3f', '#86b55c'], ['#5e9b3c', '#6aa641', '#558f35', '#78ad4a'], ['#2f5f3a', '#3a6b42', '#2a5535', '#41744a']];
    const meshes = [roundGeo, palmGeo, coneGeo].map((g, sp) => {
      const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: sp === 2, side: sp === 1 ? THREE.DoubleSide : THREE.FrontSide }), Math.max(1, groups[sp].length));
      m.count = groups[sp].length;
      return m;
    });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1, 6, 1, true).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, n));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), tc = new THREE.Color();
    let ti = 0;
    groups.forEach((list, sp) => list.forEach((i, j) => {
      const x = T[i * st] * M, y = T[i * st + 1] * M, k = T[i * st + 2], r0 = hash01(x, y);
      q.setFromAxisAngle(UP, hash01(y, x) * 6.283);
      let th, cy;
      if (sp === 1) { th = [7, 9, 11][k] * (0.9 + 0.2 * r0); cy = th; s.setScalar(0.95 + 0.35 * r0); }
      else if (sp === 2) { const hgt = [5, 7, 9][k] * (0.85 + 0.3 * r0); th = 1.2; cy = 0.8; s.set(hgt / 4.6, hgt / 4.0, hgt / 4.6); }
      else { const r = [2.2, 3.0, 3.8][k] * (0.85 + 0.3 * r0); th = [2.2, 2.8, 3.4][k]; cy = th + r * 0.75; s.set(r, r * 0.92, r); }
      m4.compose(p.set(x, cy, -y), q, s);
      meshes[sp].setMatrixAt(j, m4);
      meshes[sp].setColorAt(j, c.set(pickOf(greens[sp], hash01(x * 2, y))));
      m4.compose(p.set(x, 0, -y), q.identity(), s.set(sp === 1 ? 1.15 : 1, th + (sp === 0 ? 0.6 : 0), sp === 1 ? 1.15 : 1));
      trunks.setColorAt(ti, tc.set(sp === 1 ? '#8d7d68' : '#6a5440')); // batang palem abu-cokelat
      trunks.setMatrixAt(ti++, m4);
    }));
    trunks.count = ti;
    for (const m of [...meshes, trunks]) {
      m.frustumCulled = false;
      m.castShadow = m !== trunks; // batang kecil: tidak perlu bayangan (hemat GPU)
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    meshes[0].receiveShadow = true;
    const g = new THREE.Group();
    g.add(...meshes, trunks);
    scene.add(g);
    return g;
  })();
  const treesReady = upgradeTrees(scene, D, trees).catch((e) => { console.warn('Pohon GLB tidak dimuat, pakai pohon prosedural:', e.message); return null; });

  // ---------- Lampu jalan (menyala senja/malam), hanya di dalam kawasan ----------
  const lamps = (() => {
    const pts = [];
    D.roads.r.forEach((r, i) => {
      const cls = D.classes[D.roads.c[i]];
      if (!['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(cls)) return;
      const P = V2(r), off = D.roads.w[i] * M / 2 + 1.5;
      let carry = 0;
      for (let j = 0; j < P.length - 1; j++) {
        const a = P[j], b = P[j + 1], len = a.distanceTo(b);
        if (len < 0.1) continue;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        let d = carry;
        while (d < len) {
          const side = Math.floor(d / 34) % 2 ? 1 : -1, x = a.x + ux * d - uy * off * side, y = a.y + uy * d + ux * off * side;
          if (inArea(x, y)) pts.push([x, y]);
          d += 34;
        }
        carry = d - len;
      }
    });
    const n = Math.max(1, Math.min(pts.length, 2400));
    const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: softDot('rgba(255,214,150,1)', 'rgba(255,190,120,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }), n);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd58a }), n);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 7, 5).translate(0, 3.5, 0), new THREE.MeshLambertMaterial({ color: 0x5a5868 }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n && pts.length; i++) {
      const [x, y] = pts[Math.floor(i * pts.length / n)];
      halo.setMatrixAt(i, m4.makeTranslation(x, 0.3, -y));
      bulbs.setMatrixAt(i, m4.makeTranslation(x, 7.1, -y));
      posts.setMatrixAt(i, m4.makeTranslation(x, 0, -y));
    }
    for (const o of [halo, bulbs, posts]) { o.frustumCulled = false; o.instanceMatrix.needsUpdate = true; }
    halo.renderOrder = 5;
    halo.visible = bulbs.visible = false;
    const g = new THREE.Group();
    g.add(halo, bulbs, posts);
    g.userData.set = (phase) => {
      const k = phase === 'night' ? 0.9 : phase === 'dusk' ? 0.55 : 0;
      halo.material.opacity = k;
      halo.visible = bulbs.visible = k > 0;
    };
    scene.add(g);
    return g;
  })();
  progress(82, 'Menyiapkan langit…');

  // ---------- Langit: kubah gradasi, matahari/bulan, bintang (ikut posisi kamera) ----------
  const skyUni = { top: { value: C('#b9d6f0') }, horizon: { value: C('#e4e9f2') } };
  const sky = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(14000, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyUni, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float h; void main(){ gl_FragColor = vec4(mix(horizon, top, smoothstep(0.0, 0.45, max(h, 0.0))), 1.0); }',
  }));
  dome.renderOrder = -100;
  const starPos = [];
  for (let i = 0; i < 700; i++) {
    const a = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2, b = ((Math.sin(i * 78.233) * 12345.678) % 1 + 1) % 1;
    const el = Math.asin(0.12 + b * 0.88), r = 13000;
    starPos.push(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
  sky.add(dome, stars);
  for (const o of [dome, stars]) o.frustumCulled = false;
  scene.add(sky);
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('rgba(255,250,230,1)', 'rgba(255,230,170,0)'), fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  sunDisc.scale.setScalar(900);
  scene.add(sunDisc);
  // Awan: gumpalan lembut di sekeliling kawasan, warnanya ikut fase langit.
  const cloudTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const x = cv.getContext('2d');
    for (const [ccx, ccy, r] of [[70, 80, 42], [120, 62, 52], [175, 78, 40], [100, 88, 38], [150, 92, 36]]) {
      const g = x.createRadialGradient(ccx, ccy, 0, ccx, ccy, r);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(ccx, ccy, r, 0, Math.PI * 2); x.fill();
    }
    return new THREE.CanvasTexture(cv);
  })();
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, transparent: true, opacity: 0.85, toneMapped: false });
  const clouds = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const cl = new THREE.Sprite(cloudMat), a = i / 14 * Math.PI * 2 + (i % 3) * 0.4, r = 2600 + (i * 457) % 2600;
    cl.position.set(center.x + Math.cos(a) * r, 700 + (i * 97) % 450, -center.y + Math.sin(a) * r);
    cl.scale.set(900 + (i * 131) % 600, 380 + (i * 53) % 160, 1);
    clouds.add(cl);
  }
  scene.add(clouds);
  if (real) { // langit foto: kubah bertekstur, awan & cakram matahari buatan disembunyikan
    dome.material = skyDomeMaterial(real);
    clouds.visible = false;
    sunDisc.material.opacity = 0;
  }

  return { real, V2, C, boundary, boundaryHoles, enclaves, game, bb, center, inArea, LAT, LON, B, renderer, small, scene, camera, hemi, sun, TEX, slab, slabTop, floorShadow, overlay, flatGeo, ribbonGeo, stripGeo, markGeo, dashGeo, clusterFill, clusterLines, goldEdge, nightU, skyU, bMat, geo, addBuilding, buildings, edges, lineMat, trees, treesReady, setHouseOpen, lamps, skyUni, sky, dome, stars, sunDisc, cloudMat, clouds };
}
