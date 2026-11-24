// Gambar kecil untuk HUD & panel loot, dirender SEKALI dari model 3D yang dipakai game lalu disimpan sebagai data URL:
// - itemIcon(type): ikon berwarna barang (props.glb / weapons.glb lod1). Senjata tampak samping (dari atas, karena rebah), lainnya 3/4.
// - silhouette(kind): siluet putih tampak samping senjata & granat (laras ke kanan) dari model detail weapons.glb, untuk
//   kartu senjata, kill feed, prompt & baris ambil barang (dipakai sebagai <img>). Alfa sedikit mengikuti arah permukaan
//   supaya bentuk laras/rel masih terbaca.
// Semua lewat SATU konteks WebGL kecil milik modul ini (bukan konteks game). warmIcons() menyiapkan semuanya di sela-sela
// frame (di menu, sebelum pertandingan) lalu MELEPAS konteks itu; permintaan baru sesudahnya membuat konteks lagi seperlunya.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { itemGeometry, ITEMS } from './loot.js';
import { WEAPONS, NADES, gunGeometry } from './weapons.js';

const cache = new Map(), sils = new Map();
let rdr = null, scene = null, cam = null, mat = null, silMat = null, cv2 = null;
function init() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 160;
  rdr = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
  rdr.setPixelRatio(1);
  rdr.setSize(160, 160, false);
  rdr.outputColorSpace = THREE.SRGBColorSpace;
  rdr.toneMapping = THREE.ACESFilmicToneMapping;
  rdr.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4466, 1.7));
  const d = new THREE.DirectionalLight(0xffffff, 2.4);
  d.position.set(2, 5, 3);
  scene.add(d);
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 60);
  mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // siluet: putih (pra-kali alfa); permukaan yang menghadap kamera penuh, yang miring sedikit lebih tipis
  silMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, toneMapped: false,
    vertexShader: 'varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vN; void main() { float f = abs(normalize(vN).z); float a = 0.66 + 0.34 * smoothstep(0.15, 0.95, f); gl_FragColor = vec4(vec3(a), a); }',
  });
}
function release() { // lepas konteks WebGL ikon (semua gambar sudah jadi data URL)
  if (!rdr) return;
  try { mat.dispose(); silMat.dispose(); rdr.dispose(); const ext = rdr.getContext().getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* abaikan */ }
  rdr = scene = cam = mat = silMat = null;
}
// ikon senjata berwarna dari model detail (tampak samping, laras ke kanan, 2:1); null kalau model detail belum dimuat
function renderHD(kind) {
  const parts = silParts(kind);
  if (!parts) return null;
  if (!rdr) init();
  const grp = new THREE.Group(), back = [];
  for (const o of parts) { back.push([o, o.parent]); grp.add(o); }
  grp.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(grp), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  let url = null;
  if (sz.z > 1e-4 && sz.y > 1e-4) {
    const hw = Math.max(sz.z / 2, sz.y) * 1.06, W = 320, H = 160;
    cam.position.set(c.x + 20, c.y + 4, c.z + 3); cam.up.set(0, 1, 0); cam.lookAt(c); // sedikit dari atas-depan supaya bentuknya terbaca
    Object.assign(cam, { left: -hw, right: hw, top: hw / 2, bottom: -hw / 2, near: 0.01, far: 80 });
    cam.updateProjectionMatrix();
    rdr.setSize(W * 2, H * 2, false);
    scene.add(grp);
    rdr.render(scene, cam);
    scene.remove(grp);
    if (!cv2) cv2 = document.createElement('canvas');
    cv2.width = W; cv2.height = H;
    const g2 = cv2.getContext('2d');
    g2.clearRect(0, 0, W, H);
    g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
    g2.drawImage(rdr.domElement, 0, 0, W * 2, H * 2, 0, 0, W, H);
    url = cv2.toDataURL('image/png');
  }
  for (const [o, p] of back) p.add(o);
  return url;
}
export function itemIcon(type) {
  if (cache.has(type)) return cache.get(type);
  let url = '';
  try {
    if (!rdr) init();
    const hd = ITEMS[type] && ITEMS[type].kind === 'weapon' && HD ? renderHD(ITEMS[type].w) : null;
    const g = hd ? null : itemGeometry(type);
    if (hd) url = hd;
    if (g) {
      const mesh = new THREE.Mesh(g, mat), grp = new THREE.Group(), weapon = ITEMS[type] && ITEMS[type].kind === 'weapon';
      grp.add(mesh);
      if (weapon) grp.rotation.y = Math.PI / 2; else grp.rotation.y = -0.65;
      grp.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(grp), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      grp.position.sub(c);
      if (weapon) { cam.position.set(0, 20, 0); cam.up.set(0, 0, 1); } else { cam.position.set(0, 14, 17); cam.up.set(0, 1, 0); } // senjata rebah dilihat dari atas; 'atas' gambar = +Z supaya gagang di bawah & laras ke kanan
      cam.lookAt(0, 0, 0);
      const s = (weapon ? Math.max(sz.x, sz.z) : sz.length() * 0.62) / 2 * 1.06, ar = weapon ? 2 : 1; // senjata: gambar 2:1 supaya tidak kecil
      rdr.setSize(160 * ar, 160, false);
      Object.assign(cam, { left: -s, right: s, top: s / ar, bottom: -s / ar, near: 0.01, far: 60 });
      cam.updateProjectionMatrix();
      scene.add(grp);
      rdr.render(scene, cam);
      scene.remove(grp);
      g.dispose();
      url = rdr.domElement.toDataURL('image/png');
    }
  } catch (e) { url = ''; }
  cache.set(type, url);
  return url;
}

// ---------- Siluet senjata & granat ----------
const SIL_W = 384, SIL_H = 176; // ukuran gambar terbesar (px); dirender 2× lalu dikecilkan supaya tepinya halus
let HD = null; // akar weapons.glb (model detail) yang dimuat warmIcons; null → pakai gunGeometry (lod1 / prosedural)
function silParts(kind) { // objek model detail satu senjata: simpul <kind> + bagian lepasnya (<kind>_mag, _pump, _cyl, …) tanpa lod1
  if (!HD) return null;
  const out = HD.children.filter((o) => (o.name === kind || o.name.startsWith(kind + '_')) && !/_lod\d$/.test(o.name) && !o.name.endsWith('_buis_dn')); // pisir lipat: hanya yang tegak
  let meshes = 0;
  for (const o of out) o.traverse((m) => { if (m.isMesh) meshes++; });
  return meshes ? out : null;
}
function renderSil(kind) {
  if (!rdr) init();
  const grp = new THREE.Group(), parts = silParts(kind), back = [];
  let tmpGeo = null;
  if (parts) for (const o of parts) { back.push([o, o.parent]); grp.add(o); } // dipinjam sebentar dari akar GLB (matriks lokal = matriks dunia aslinya)
  else { tmpGeo = gunGeometry(kind); grp.add(new THREE.Mesh(tmpGeo, silMat)); }
  grp.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(grp), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  let out = null;
  if (sz.z > 1e-4 && sz.y > 1e-4) {
    // tampak samping dari +X: laras (−Z) mengarah ke kanan gambar
    const pad = 1.03, hw = sz.z / 2 * pad, hh = sz.y / 2 * pad, ar = Math.min(8, Math.max(0.6, hw / hh));
    const H = Math.round(Math.min(SIL_H, SIL_W / ar)), W = Math.round(H * ar); // tinggi ≤ SIL_H (pistol/granat tidak perlu gambar besar)
    cam.position.set(c.x + 20, c.y, c.z); cam.up.set(0, 1, 0); cam.lookAt(c);
    Object.assign(cam, { left: -hw, right: hw, top: hh, bottom: -hh, near: 0.01, far: 60 });
    cam.updateProjectionMatrix();
    rdr.setSize(W * 2, H * 2, false);
    scene.overrideMaterial = silMat;
    scene.add(grp);
    rdr.render(scene, cam);
    scene.remove(grp);
    scene.overrideMaterial = null;
    if (!cv2) cv2 = document.createElement('canvas');
    cv2.width = W; cv2.height = H;
    const g2 = cv2.getContext('2d');
    g2.clearRect(0, 0, W, H);
    g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
    g2.drawImage(rdr.domElement, 0, 0, W * 2, H * 2, 0, 0, W, H);
    out = { url: cv2.toDataURL('image/png'), ar: W / H, len: sz.z };
  }
  for (const [o, p] of back) p.add(o);
  if (tmpGeo) tmpGeo.dispose();
  return out;
}
// siluet jenis senjata/granat: { url, ar (lebar/tinggi), len (panjang asli, m) } atau null bila belum jadi (lihat warmIcons)
export function silhouette(kind) { return sils.get(kind) || null; }
function makeSil(kind) {
  let s = null;
  try { s = renderSil(kind); } catch (e) { s = null; }
  if (s) sils.set(kind, s);
  return s;
}

// Siapkan semua siluet lalu semua ikon barang, satu per jeda (tidak menahan frame), kemudian lepas konteks WebGL ikon.
// onSil(kind) dipanggil tiap satu siluet jadi (HUD menggambar ulang kartunya). Aman dipanggil berkali-kali.
let warmP = null;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export function warmIcons(onSil, base = 'game/assets/weapons/') {
  if (warmP) return warmP;
  warmP = (async () => {
    try { const g = await new GLTFLoader().loadAsync(base + 'weapons.glb'); g.scene.updateMatrixWorld(true); HD = g.scene; } catch (e) { HD = null; }
    for (const k of [...Object.keys(WEAPONS), ...Object.keys(NADES)]) { await pause(24); if (makeSil(k) && onSil) onSil(k); }
    if (HD) for (const t of Object.keys(ITEMS)) if (ITEMS[t].kind === 'weapon') cache.delete(t); // ikon senjata diganti versi model detail
    for (const t of Object.keys(ITEMS)) { if (cache.has(t)) continue; await pause(24); itemIcon(t); }
    HD = null;
    await pause(200);
    release();
    return true;
  })();
  return warmP;
}
