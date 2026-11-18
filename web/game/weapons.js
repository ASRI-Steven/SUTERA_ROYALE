// Senjata: definisi, model 3D prosedural (tangan orang pertama + versi tergeletak untuk loot), dan efek
// (pelacak peluru, percikan, kilatan moncong). Nama & model senjata orisinal.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SKIN_COMMON, GUN_SKIN_GLSL, CHAR_SLEEVE_GLSL, SF_U, tickSkins } from './skinfx.js';

// ---------- Model senjata dari Blender (tools/blender/weapons.py), opsional ----------
// weapons.glb: <jenis> (model orang pertama), <jenis>_mag, shotgun_pump, <jenis>_lod1 (warna verteks, untuk loot &
// tangan karakter), titik <jenis>_muzzle/_sight/_guard, tangan fp_hand_r/fp_hand_l. Asal = pegangan tangan kanan, laras −Z.
// Dimuat sebelum dunia dibangun (main.js); kalau gagal, model prosedural di bawah yang dipakai.
let GLB = null;
export async function loadWeaponModels(base = 'game/assets/weapons/') {
  const gltf = await new GLTFLoader().loadAsync(base + 'weapons.glb');
  gltf.scene.updateMatrixWorld(true);
  GLB = { root: gltf.scene };
  return GLB;
}
const glbNode = (name) => (GLB ? GLB.root.getObjectByName(name) : null);
function nodeLocal(name, kind) { // posisi titik relatif ke asal senjata
  const o = glbNode(name), base = glbNode(kind);
  if (!o || !base) return null;
  const p = new THREE.Vector3(); o.getWorldPosition(p);
  return base.worldToLocal(p);
}

const D2R = Math.PI / 180;
// spread/recoil dalam derajat; dmg per peluru; range = jarak mulai melemah (m); pellets untuk shotgun
export const WEAPONS = {
  pistol: { name: 'Pistol P9', short: 'P9', slot: 2, ammo: 'light', dmg: 24, rpm: 400, auto: false, mag: 15, reload: 1.35, spread: 0.9, ads: 0.35, move: 1.4, recoil: 1.3, range: 40, maxRange: 300, sound: 'pistol', fovAds: 62 },
  smg: { name: 'SMG Kilat', short: 'Kilat', slot: 0, ammo: 'light', dmg: 17, rpm: 860, auto: true, mag: 30, reload: 1.9, spread: 1.5, ads: 0.75, move: 1.0, recoil: 0.5, range: 32, maxRange: 350, sound: 'smg', fovAds: 60 },
  ar: { name: 'Senapan Garuda', short: 'Garuda', slot: 0, ammo: 'rifle', dmg: 27, rpm: 620, auto: true, mag: 30, reload: 2.25, spread: 1.3, ads: 0.32, move: 1.6, recoil: 0.72, range: 90, maxRange: 700, sound: 'ar', fovAds: 52 },
  shotgun: { name: 'Shotgun Badai', short: 'Badai', slot: 0, ammo: 'shell', dmg: 13, pellets: 9, rpm: 75, auto: false, mag: 5, reload: 2.6, spread: 4.2, ads: 3.4, move: 1.0, recoil: 3.2, range: 14, maxRange: 120, sound: 'shotgun', fovAds: 60 },
  dmr: { name: 'DMR Elang', short: 'Elang', slot: 0, ammo: 'rifle', dmg: 56, rpm: 210, auto: false, mag: 10, reload: 2.6, spread: 1.0, ads: 0.04, move: 2.2, recoil: 2.0, range: 220, maxRange: 1100, sound: 'dmr', fovAds: 55, rail: [0.164, -0.245, 0.112] }, // rail: teropong bawaan model (sumbu y, z awal, z akhir) — baru tampil kalau aksesori scope terpasang,
  // v3: senapan runduk bolt (tembakan kepala menembus helm lv.1–2), SMR, revolver, senapan semburan 3 butir, PDW, laras ganda
  sniper: { name: 'Runduk Rajawali', short: 'Rajawali', slot: 0, ammo: 'sniper', dmg: 95, rpm: 42, auto: false, mag: 5, reload: 3.1, spread: 2.6, ads: 0.0, move: 2.8, recoil: 4.2, range: 420, maxRange: 1500, sound: 'sniper', fovAds: 55, rail: [0.172, -0.28, 0.158], bolt: 1.15 },
  lmg: { name: 'SMR Gempa', short: 'Gempa', slot: 0, ammo: 'rifle', dmg: 25, rpm: 690, auto: true, mag: 75, reload: 4.6, spread: 1.7, ads: 0.55, move: 3.2, recoil: 0.62, range: 85, maxRange: 700, sound: 'lmg', fovAds: 54 },
  revolver: { name: 'Revolver Kobra', short: 'Kobra', slot: 2, ammo: 'magnum', dmg: 52, rpm: 150, auto: false, mag: 6, reload: 2.4, spread: 0.8, ads: 0.25, move: 1.5, recoil: 3.0, range: 45, maxRange: 350, sound: 'revolver', fovAds: 60 },
  burst: { name: 'Senapan Petir', short: 'Petir', slot: 0, ammo: 'rifle', dmg: 30, rpm: 900, auto: false, burst: 3, burstDelay: 0.3, mag: 30, reload: 2.3, spread: 1.1, ads: 0.26, move: 1.5, recoil: 0.6, range: 95, maxRange: 700, sound: 'burst', fovAds: 52 },
  pdw: { name: 'SMG Lebah', short: 'Lebah', slot: 0, ammo: 'light', dmg: 13, rpm: 1150, auto: true, mag: 32, reload: 1.7, spread: 1.1, ads: 0.6, move: 0.9, recoil: 0.32, range: 26, maxRange: 300, sound: 'pdw', fovAds: 62 },
  dbs: { name: 'Shotgun Gada', short: 'Gada', slot: 0, ammo: 'shell', dmg: 14, pellets: 9, rpm: 280, auto: false, mag: 2, reload: 2.7, spread: 5.0, ads: 4.0, move: 1.1, recoil: 4.0, range: 10, maxRange: 100, sound: 'dbs', fovAds: 62 },
};
// ---------- Aksesori senjata (hanya pemain): inst.att = { mag: true, scope: 2 | 4 } ----------
// Magasin panjang: isi magasin +50 % (dibulatkan ke atas). Scope 2×/4×: bidikan lebih dekat (4× memakai tampilan teropong).
export const ATTACH = {
  mag: { name: 'Magasin panjang', short: 'Mag+', fits: ['pistol', 'smg', 'ar', 'shotgun', 'dmr', 'sniper', 'lmg', 'burst', 'pdw'] },
  s2: { name: 'Scope 2×', short: '2×', scope: 2, fov: 38, fits: ['smg', 'ar', 'lmg', 'burst', 'pdw', 'dmr', 'sniper'] },
  s4: { name: 'Scope 4×', short: '4×', scope: 4, fov: 20, fits: ['ar', 'lmg', 'burst', 'dmr', 'sniper'] },
  s8: { name: 'Scope 8×', short: '8×', scope: 8, fov: 9.5, fits: ['dmr', 'sniper'] },
};
export const magCap = (inst) => { const d = WEAPONS[inst.kind]; return inst.att && inst.att.mag ? Math.ceil(d.mag * 1.5) : d.mag; };
const scopeOf = (inst) => (inst.att && inst.att.scope ? ATTACH['s' + inst.att.scope] : null);
// Scope 8× bisa diatur 4×–8× (gulir mouse saat membidik): inst.zoom = perbesaran yang dipilih
export const adsFov = (inst) => { const sc = scopeOf(inst); return !sc ? WEAPONS[inst.kind].fovAds : sc.scope === 8 ? 76 / Math.max(4, Math.min(8, inst.zoom || 8)) : sc.fov; };
export const hasScope = (inst) => !!(inst.att && inst.att.scope >= 4); // 4× / 8×: tampilan teropong penuh
export const attList = (inst) => { const L = []; if (inst.att) { if (inst.att.scope) L.push({ k: 's' + inst.att.scope, name: ATTACH['s' + inst.att.scope].name }); if (inst.att.mag) L.push({ k: 'mag', name: ATTACH.mag.name }); } return L; };
export const AMMO = { light: 'Peluru ringan', rifle: 'Peluru senapan', shell: 'Peluru shotgun', sniper: 'Peluru runduk', magnum: 'Peluru magnum' };
export const AMMO_CAP = { light: 300, rifle: 300, shell: 90, sniper: 40, magnum: 120 };
// granat (slot lempar, tombol G): fuse = detik sejak dilempar; frag meledak (r, dmg), asap jadi awan (r, dur)
export const NADES = { frag: { name: 'Granat', short: 'Granat', fuse: 4, r: 7, dmg: 165 }, smoke: { name: 'Granat asap', short: 'Asap', fuse: 2, r: 8, dur: 20 } };
// jenis baru meminjam model prosedural cadangan dari jenis yang mirip (dipakai hanya bila weapons.glb gagal dimuat)
const ALIAS = { sniper: 'dmr', lmg: 'ar', burst: 'ar', pdw: 'smg', revolver: 'pistol', dbs: 'shotgun' };
export function falloff(w, d) { return d <= w.range ? 1 : Math.max(0.35, 1 - (d - w.range) / (w.range * 3)); }

// ---------- Model senjata (−Z = depan) ----------
const MAT = { metal: '#4a4f5a', dark: '#2c2f36', poly: '#565a64', gold: '#D29F52', glass: '#7ec8ff', dot: '#ff3b30', grip: '#3a3d45' };
function parts(kind) {
  if (NADES[kind]) return [{ g: new THREE.SphereGeometry(0.034, 12, 9).scale(1, 1.25, 1), m: kind === 'smoke' ? 'metal' : 'poly' }];
  if (ALIAS[kind]) return parts(ALIAS[kind]);
  const box = (w, h, d, x, y, z, m = 'metal', rx = 0) => ({ g: new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), m });
  const cyl = (r, l, x, y, z, m = 'dark', seg = 12) => ({ g: new THREE.CylinderGeometry(r, r, l, seg).rotateX(Math.PI / 2).translate(x, y, z), m });
  if (kind === 'pistol') return [
    box(0.032, 0.036, 0.19, 0, 0.022, -0.02, 'metal'), box(0.03, 0.026, 0.16, 0, -0.008, -0.01, 'poly'),
    box(0.03, 0.11, 0.046, 0, -0.065, 0.055, 'grip', -0.24), box(0.008, 0.012, 0.02, 0, 0.046, -0.1, 'gold'),
    cyl(0.007, 0.03, 0, 0.022, -0.125), { ...box(0.026, 0.07, 0.03, 0, -0.06, 0.055, 'dark', -0.24), name: 'mag' },
  ];
  if (kind === 'smg') return [
    box(0.05, 0.075, 0.27, 0, 0, -0.02, 'metal'), box(0.054, 0.05, 0.12, 0, -0.008, -0.2, 'poly'),
    cyl(0.011, 0.1, 0, 0.012, -0.31), box(0.018, 0.05, 0.2, 0, -0.005, 0.2, 'dark'), box(0.04, 0.012, 0.06, 0, -0.03, 0.29, 'dark'),
    box(0.034, 0.1, 0.045, 0, -0.075, 0.07, 'grip', -0.3), { ...box(0.03, 0.17, 0.045, 0, -0.12, -0.08, 'dark', 0.08), name: 'mag' },
    box(0.03, 0.02, 0.03, 0, 0.05, -0.03, 'metal'), box(0.054, 0.012, 0.1, 0, 0.012, -0.2, 'gold'),
  ];
  if (kind === 'shotgun') return [
    box(0.05, 0.075, 0.2, 0, 0, 0.02, 'metal'), cyl(0.016, 0.55, 0, 0.018, -0.34), cyl(0.014, 0.42, 0, -0.016, -0.29, 'metal'),
    { ...cyl(0.024, 0.13, 0, -0.016, -0.3, 'poly'), name: 'pump' }, box(0.045, 0.09, 0.25, 0, -0.012, 0.24, 'poly'),
    box(0.034, 0.1, 0.045, 0, -0.07, 0.1, 'grip', -0.3), box(0.008, 0.012, 0.014, 0, 0.04, -0.6, 'gold'), box(0.046, 0.01, 0.16, 0, 0.042, 0.02, 'gold'),
  ];
  const ar = [
    box(0.055, 0.08, 0.34, 0, 0, 0, 'metal'), box(0.06, 0.066, 0.22, 0, 0.002, -0.27, 'poly'), box(0.062, 0.012, 0.2, 0, 0.038, -0.27, 'gold'),
    cyl(0.011, 0.2, 0, 0.01, -0.48), cyl(0.017, 0.06, 0, 0.01, -0.59, 'metal'), box(0.046, 0.088, 0.22, 0, -0.012, 0.27, 'poly'),
    box(0.05, 0.11, 0.035, 0, -0.03, 0.39, 'dark'), box(0.035, 0.1, 0.046, 0, -0.08, 0.1, 'grip', -0.35), box(0.03, 0.012, 0.32, 0, 0.046, -0.05, 'dark'),
    { ...box(0.034, 0.15, 0.064, 0, -0.105, -0.05, 'dark', 0.18), name: 'mag' },
  ];
  if (kind === 'dmr') return [
    ...ar.filter((p) => p.name === 'mag' ? false : true).map((p) => p), { ...box(0.03, 0.1, 0.06, 0, -0.085, -0.04, 'dark', 0.1), name: 'mag' },
    cyl(0.012, 0.22, 0, 0.01, -0.68), cyl(0.024, 0.26, 0, 0.088, -0.02, 'dark', 16), cyl(0.028, 0.05, 0, 0.088, -0.16, 'dark', 16),
    cyl(0.026, 0.008, 0, 0.088, 0.112, 'glass', 16), box(0.012, 0.03, 0.02, 0, 0.064, -0.08, 'metal'), box(0.012, 0.03, 0.02, 0, 0.064, 0.06, 'metal'),
  ];
  // red dot berbingkai terbuka: saat membidik, mata melihat lewat jendela (dulu kotak padat menutupi tengah layar)
  const S = 0.083;
  return [...ar,
    box(0.042, 0.007, 0.05, 0, S + 0.0185, -0.03, 'dark'), box(0.042, 0.007, 0.05, 0, S - 0.0185, -0.03, 'dark'),
    box(0.006, 0.044, 0.05, -0.018, S, -0.03, 'dark'), box(0.006, 0.044, 0.05, 0.018, S, -0.03, 'dark'),
    box(0.03, 0.01, 0.045, 0, 0.0585, -0.03, 'metal'),
    { g: new THREE.PlaneGeometry(0.03, 0.03).translate(0, S, -0.054), m: 'glass' },
    { g: new THREE.SphereGeometry(0.0018, 8, 6).translate(0, S, -0.054), m: 'dot' }];
}
export const SIGHT_Y = { pistol: 0.054, smg: 0.064, shotgun: 0.051, ar: 0.083, dmr: 0.088, sniper: 0.172, lmg: 0.163, revolver: 0.111, burst: 0.165, pdw: 0.145, dbs: 0.124 };
export const MUZZLE_Z = { pistol: -0.15, smg: -0.37, shotgun: -0.63, ar: -0.63, dmr: -0.8, sniper: -0.95, lmg: -0.8, revolver: -0.24, burst: -0.61, pdw: -0.34, dbs: -0.62 };

// Model tergeletak (loot): satu geometri berwarna per verteks per jenis senjata.
export function gunGeometry(kind) {
  const lod = glbNode(kind + '_lod1');
  if (lod) { // model ringan Blender: warna verteks RGBA → RGB, posisi relatif ke asal senjata
    const geos = [];
    lod.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(lod.matrixWorld).invert();
    lod.traverse((m) => {
      if (!m.isMesh) return;
      let g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (g.index) g = g.toNonIndexed();
      const n = g.attributes.position.count, c = g.attributes.color, rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i * 3] = c ? c.getX(i) : 0.3; rgb[i * 3 + 1] = c ? c.getY(i) : 0.3; rgb[i * 3 + 2] = c ? c.getZ(i) : 0.32; }
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      geos.push(g);
    });
    if (geos.length) return geos.length > 1 ? mergeGeometries(geos) : geos[0];
  }
  return mergeGeometries(parts(kind).map(({ g, m }) => {
    const x = g.index ? g.toNonIndexed() : g.clone();
    x.deleteAttribute('uv');
    const c = new THREE.Color(MAT[m]), n = x.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    x.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return x;
  }));
}

// ---------- Material orang pertama (PBR + detail prosedural) ----------
// Tiap mesh model Blender membawa atribut `vwx` (= TEXCOORD_0 di weapons.glb, lihat tools/blender/weapons.py finish()):
// x = oklusi ambien hasil bake, y = 1 di bidang bevel (tepi yang aus). Material dibuat dari NAMA material GLB; detailnya
// (butir logam, tekstur polimer, anyaman kain, serat kayu, aus tepi) dihitung di shader dari posisi ruang objek, jadi
// tanpa tekstur & tanpa UV. Warna dasar tetap dari GLB supaya ikon HUD (game/icons.js) dan model dunia tetap serasi.
const VM_VS_PARS = 'attribute vec2 vwx;\nvarying vec2 vWx;\nvarying vec3 vObjP;\nvarying vec3 vObjN;\n';
const VM_VS = '\n  vWx = vec2(vwx.x, 1.0 - vwx.y); vObjP = position; vObjN = normal;\n'; // glTF membalik sumbu V: aus = 1 − v
const VM_FS_PARS = `varying vec2 vWx;
varying vec3 vObjP;
varying vec3 vObjN;
uniform vec4 uVm; // x = aus tepi, y = tinggi tonjolan (m), z = frekuensi pola kain
float vmHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vmNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vmHash(i), vmHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(vmHash(i + vec3(0.0, 1.0, 0.0)), vmHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(vmHash(i + vec3(0.0, 0.0, 1.0)), vmHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(vmHash(i + vec3(0.0, 1.0, 1.0)), vmHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float vmHeight(vec3 p) { // relief mikro per jenis bahan (0..1)
#if VM_KIND == 1
  return vmNoise(p * 620.0) * 0.55 + vmNoise(p * vec3(160.0, 160.0, 900.0)) * 0.45; // logam: butir + goresan memanjang laras
#elif VM_KIND == 2
  return vmNoise(p * 700.0); // polimer cetak
#elif VM_KIND == 3
  return 0.6 * vmNoise(p * 460.0) + 0.4 * vmNoise(p * 1000.0); // karet / gagang berbintik
#elif VM_KIND == 4
  vec3 q = p * uVm.z; // kain: anyaman + kusut halus
  return 0.5 + 0.22 * (sin(q.x + q.y) * sin(q.z - q.y * 0.5) + sin(q.x * 0.5 - q.z) * sin(q.y + q.x * 0.3)) + 0.25 * (vmNoise(p * 110.0) - 0.5);
#elif VM_KIND == 5
  return vmNoise(p * vec3(90.0, 90.0, 7.0)) * 0.5 + 0.25 + 0.25 * sin(p.y * 300.0 + p.x * 120.0); // kayu: serat memanjang
#elif VM_KIND == 6
  return vmNoise(p * 420.0) * 0.6 + vmNoise(p * 1100.0) * 0.4; // kulit
#else
  return 0.5;
#endif
}
`;
const VM_FS_COLOR = `
  float vmN = vmNoise(vObjP * 140.0), vmWear = 0.0;
#if VM_KIND == 1
  vmWear = uVm.x * smoothstep(0.35, 0.85, vWx.y * (0.3 + 1.2 * vmN));
#ifdef SF_GUN
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.61, 0.64), vmWear); // skin: butir logam diganti pola skin (hemat GPU)
#else
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.88 + 0.24 * vmNoise(vObjP * 55.0)), vec3(0.6, 0.61, 0.64), vmWear); // tepi aus: logam telanjang
#endif
#elif VM_KIND == 2 || VM_KIND == 3
  vmWear = uVm.x * smoothstep(0.45, 0.9, vWx.y * (0.3 + 1.1 * vmN));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 2.0 + 0.015, vmWear * 0.6);
#elif VM_KIND == 4
  diffuseColor.rgb *= 0.84 + 0.3 * vmHeight(vObjP);
#elif VM_KIND == 5
  { float wg = vmNoise(vObjP * vec3(90.0, 90.0, 7.0)), wl = 0.5 + 0.5 * sin(vObjP.y * 300.0 + wg * 9.0 + vObjP.x * 120.0);
    diffuseColor.rgb *= 0.7 + 0.32 * wg + 0.14 * wl; }
#elif VM_KIND == 6
  diffuseColor.rgb *= 0.9 + 0.2 * vmNoise(vObjP * 300.0);
#endif
`;
const VM_FS_ROUGH = `
#if VM_KIND == 1 && !defined(SF_GUN)
  roughnessFactor = mix(roughnessFactor * (0.78 + 0.44 * vmNoise(vObjP * 260.0)), 0.22, vmWear);
#elif VM_KIND == 2 || VM_KIND == 3
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, vmWear);
#endif
`;
const VM_FS_BUMP = `
#if VM_KIND > 0
  { // relief dari turunan layar (tanpa peta normal); skin senjata memakai reliefnya sendiri (ukiran, sisik, anyaman)
#ifdef SF_GUN
    float bh = sfHgt >= 0.0 ? sfHgt * 0.00022 : 0.0;
#else
    float bh = vmHeight(vObjP) * uVm.y;
#endif
    vec3 bsx = dFdx(-vViewPosition), bsy = dFdy(-vViewPosition), br1 = cross(bsy, normal), br2 = cross(normal, bsx);
    float bdet = dot(bsx, br1);
    normal = normalize(abs(bdet) * normal - sign(bdet) * (dFdx(bh) * br1 + dFdy(bh) * br2));
  }
#endif
`;
const VM_FS_LIGHT = `
  { float vmAo = vWx.x, vmD = mix(1.0, vmAo, 0.5);
    reflectedLight.indirectDiffuse *= vmAo; reflectedLight.indirectSpecular *= mix(1.0, vmAo, 0.85);
    reflectedLight.directDiffuse *= vmD; reflectedLight.directSpecular *= vmD; }
`;
const VM_FS_GLASS = `
#ifdef VM_GLASS
  { // lensa optik: pantulan berlapis kebiruan, makin landai makin memantul
    float gf = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0);
    totalSpecular *= vec3(0.75, 0.9, 1.25);
    float ga = clamp(diffuseColor.a + (1.0 - diffuseColor.a) * (0.8 * gf + max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b)), 0.0, 1.0);
    outgoingLight = (totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance) / max(ga, 1e-3);
    diffuseColor.a = ga;
  }
#endif
`;
// ---------- Skin (game/skinfx.js) ----------
// Senjata: define SF_GUN = nomor skin, SF_CLS = kelas bahan → warna/logam/kekasaran/pendar/relief/pernis diganti SEBELUM
// butir & aus tepi material orang pertama dihitung (tepi yang aus tetap memperlihatkan logam). Lengan: define SF_CHARFX =
// pola skin karakter. Uniform bersama: uSfT (waktu animasi), uSfG (efek view-model: pendar, panas, kilat, sapuan).
const VM_SKIN_PARS = '\n#ifdef SF_GUN\n' + GUN_SKIN_GLSL + '#endif\n#ifdef SF_CHARFX\n' + SKIN_COMMON + CHAR_SLEEVE_GLSL + '#endif\n';
const VM_SKIN_COLOR = `
#ifdef SF_GUN
  float sfMetal = -1.0, sfRough = -1.0, sfHgt = -1.0, sfCoat = -1.0; vec3 sfEmis = vec3(0.0);
  { vec3 sfC = diffuseColor.rgb; float sfV = abs(dot(normalize(vNormal), normalize(vViewPosition)));
    sfGun(SF_CLS, vObjP, normalize(vObjN), sfV, sfC, sfMetal, sfRough, sfEmis, sfHgt, sfCoat); diffuseColor.rgb = sfC; }
#endif
#ifdef SF_CHARFX
  vec3 sfEmis = vec3(0.0);
  diffuseColor.rgb = sfSleeve(SF_CHARFX, vObjP, normalize(vObjN), diffuseColor.rgb, sfEmis);
#endif
`;
const VM_SKIN_ROUGH = '\n#ifdef SF_GUN\n  if (sfRough >= 0.0) roughnessFactor = mix(sfRough, 0.22, vmWear * step(float(VM_KIND), 1.5));\n#endif\n';
const VM_SKIN_METAL = '\n#ifdef SF_GUN\n  if (sfMetal >= 0.0) metalnessFactor = sfMetal;\n#endif\n';
const VM_SKIN_EMIS = '\n#if defined(SF_GUN) || defined(SF_CHARFX)\n  totalEmissiveRadiance += sfEmis;\n#endif\n';
const VM_SKIN_COAT = '\n#if defined(SF_GUN) && defined(USE_CLEARCOAT)\n  material.clearcoat *= sfCoat >= 0.0 ? sfCoat : 1.0;\n#endif\n'; // pernis hanya di bagian yang diminta skin
// uSfG view-model senjata pemain: x = pendar (isi ulang/periksa/cabut), y = panas tembakan, z = kilat tembakan, w = posisi
// sapuan cahaya (z ruang senjata, m; −99 = tidak ada). Model dunia memakai SF_G0 (selalu diam).
const VM_G = { value: new THREE.Vector4(0, 0, 0, -99) }, SF_G0 = { value: new THREE.Vector4(0, 0, 0, -99) };
export { SF_G0 };
// kind: 1 logam · 2 polimer · 3 karet · 4 kain · 5 kayu · 6 kulit; wear = aus tepi; bump = tinggi relief (m); env = pantulan
const VM_LOOK = {
  // logam: albedo = F0 (baja ±0,25–0,4); warna GLB terlalu gelap untuk logam murni → warna sendiri
  // 'metal' = baja telanjang (laras, bolt); 'dark' = lapisan hitam (anodis/fosfat): setengah logam supaya tetap merespons
  // matahari secara difus dan tidak sekadar memantulkan birunya langit
  metal: { color: '#8b9099', metalness: 0.9, roughness: 0.36, kind: 1, wear: 0.9, bump: 0.00003, env: 1.0 },
  dark: { color: '#3d4046', metalness: 0.55, roughness: 0.5, kind: 1, wear: 0.9, bump: 0.00003, env: 0.9 },
  gold: { metalness: 1, roughness: 0.3, kind: 1, wear: 0.25, bump: 0.00002, env: 1.1 },
  canister: { metalness: 0.8, roughness: 0.42, kind: 1, wear: 0.5, bump: 0.00003, env: 0.9 },
  poly: { metalness: 0, roughness: 0.6, kind: 2, wear: 0.35, bump: 0.00007, env: 0.5 },
  olive: { metalness: 0, roughness: 0.66, kind: 2, wear: 0.3, bump: 0.00007, env: 0.45 },
  yellow: { metalness: 0, roughness: 0.5, kind: 2, wear: 0.3, bump: 0.00004, env: 0.5 },
  red: { metalness: 0, roughness: 0.5, kind: 2, wear: 0.2, bump: 0.00004, env: 0.5 },
  grip: { metalness: 0, roughness: 0.84, kind: 3, wear: 0.15, bump: 0.00016, env: 0.3 },
  wood: { metalness: 0, roughness: 0.42, kind: 5, wear: 0, bump: 0.00005, env: 0.55 },
  glove: { metalness: 0, roughness: 0.82, kind: 4, wear: 0, bump: 0.00022, env: 0.25, weave: 1500 },
  sleeve: { metalness: 0, roughness: 0.9, kind: 4, wear: 0, bump: 0.0003, env: 0.2, weave: 1250 },
  cuff: { metalness: 0.25, roughness: 0.55, kind: 4, wear: 0, bump: 0.00022, env: 0.6, weave: 1900 },
  skin: { metalness: 0, roughness: 0.56, kind: 6, wear: 0, bump: 0.00005, env: 0.35 },
};
const VM_MATS = new Map();
function vmPatch(m, L) {
  const U = { uVm: { value: new THREE.Vector4(L.wear || 0, L.bump || 0, L.weave || 1400, 0) } };
  m.defines = Object.assign(m.defines || {}, { VM_KIND: L.kind || 0 });
  if (L.glass) m.defines.VM_GLASS = '';
  if (L.gunSkin) { m.defines.SF_GUN = L.gunSkin; m.defines.SF_CLS = L.cls; }
  m.userData.vm = U;
  m.userData.vmL = L;
  m.userData.env0 = m.envMapIntensity;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.uSfT = SF_U.uSfT; sh.uniforms.uSfG = VM_G; // skin (lengan bisa berganti pola tanpa material baru)
    sh.vertexShader = VM_VS_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + VM_VS);
    sh.fragmentShader = VM_FS_PARS + VM_SKIN_PARS + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>' + VM_SKIN_COLOR + VM_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>' + VM_FS_ROUGH + VM_SKIN_ROUGH)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + VM_SKIN_METAL + '\n#if VM_KIND == 1\n  metalnessFactor = mix(metalnessFactor, 1.0, vmWear);\n#endif\n')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + VM_SKIN_EMIS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + VM_FS_BUMP)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>' + VM_SKIN_COAT)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + VM_FS_LIGHT)
      .replace('#include <opaque_fragment>', VM_FS_GLASS + '#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'vm5';
  return m;
}
// material orang pertama untuk satu nama material GLB (dipakai bersama semua senjata & tangan)
function vmMaterial(name, src) {
  if (VM_MATS.has(name)) return VM_MATS.get(name);
  let m;
  if (name === 'dot') m = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 0.5, 0.25) }); // titik bidik: HDR → berpendar (bloom)
  else if (name === 'glass') {
    m = vmPatch(new THREE.MeshStandardMaterial({ color: '#0c1622', metalness: 0, roughness: 0.03, transparent: true, opacity: 0.14, depthWrite: false, envMapIntensity: 2.4 }), { kind: 0, glass: true });
  } else {
    const L = VM_LOOK[name] || { metalness: src && src.metalness !== undefined ? src.metalness : 0.1, roughness: src && src.roughness !== undefined ? src.roughness : 0.6, kind: 2, wear: 0.3, bump: 0.00005, env: 0.5 };
    const col = L.color ? new THREE.Color(L.color) : src && src.color ? src.color.clone() : new THREE.Color('#777777');
    m = new THREE.MeshStandardMaterial({ color: col, metalness: L.metalness, roughness: L.roughness, envMapIntensity: L.env });
    vmPatch(m, L);
  }
  m.name = name;
  VM_MATS.set(name, m);
  return m;
}
// ---------- Skin: varian material & lengan ----------
// varian ber-skin dari material orang pertama untuk bagian senjata; kelas bahan dari NAMA material GLB (lihat GUN_SKIN_GLSL):
// 1 logam telanjang · 4 logam berlapis · 2 polimer · 3 karet/gagang · 5 kayu · 9 aksen. Kaca, titik bidik, kain & kulit
// dikembalikan apa adanya. Satu varian per (nama material, nomor skin), dipakai bersama. coat = skin berpernis →
// MeshPhysicalMaterial dengan lapisan bening (kadarnya per piksel dari shader skin).
const VM_CLS = { metal: 1, dark: 4, canister: 4, gold: 9, poly: 2, olive: 2, yellow: 2, red: 2, grip: 3, wood: 5 };
export function vmSkinned(base, skin, coat = false) {
  const L0 = base && base.userData && base.userData.vmL, nm = base && base.name;
  if (!skin || !L0 || !VM_CLS[nm]) return base;
  const key = nm + '#' + skin;
  if (VM_MATS.has(key)) return VM_MATS.get(key);
  const P = { color: base.color.clone(), metalness: base.metalness, roughness: base.roughness, envMapIntensity: base.envMapIntensity };
  const m = coat ? new THREE.MeshPhysicalMaterial({ ...P, clearcoat: 1, clearcoatRoughness: 0.07 }) : new THREE.MeshStandardMaterial(P);
  vmPatch(m, { ...L0, wear: (L0.wear || 0) * 0.3, gunSkin: skin, cls: VM_CLS[nm] });
  m.userData.env0 = base.userData.env0;
  m.name = nm;
  VM_MATS.set(key, m);
  return m;
}
// warna & pola lengan orang pertama mengikuti skin karakter: { sleeve, glove, cuff (hex), fx (nomor pola, 0 = polos),
// cuffGlow (hex pendar manset, opsional) }; tanpa argumen = bawaan
export function setVmArms(o = {}) {
  for (const nm of ['sleeve', 'glove', 'cuff']) {
    const m = VM_MATS.get(nm);
    if (!m) continue;
    if (!m.userData.color0) m.userData.color0 = m.color.clone();
    if (o[nm]) m.color.set(o[nm]); else m.color.copy(m.userData.color0);
  }
  const cf = VM_MATS.get('cuff');
  if (cf) { if (o.cuffGlow) cf.emissive.set(o.cuffGlow).multiplyScalar(1.6); else cf.emissive.setRGB(0, 0, 0); }
  const sl = VM_MATS.get('sleeve'), fx = o.fx | 0;
  if (sl && (sl.defines.SF_CHARFX | 0) !== fx) { if (fx) sl.defines.SF_CHARFX = fx; else delete sl.defines.SF_CHARFX; sl.needsUpdate = true; }
}
// ---------- Efek skin senjata pemain (diisi game/skins.js applyEquipped) ----------
// tracer / flash: warna HDR [r, g, b] pelacak & kilatan moncong; muzzle: partikel moncong ('ember' | 'frost' | 'spark' |
// 'gold' | 'plasma' | 'peacock' | 'smoke' | 'petal'); glow: pakai pendar isi ulang/periksa/cabut; cue(ev): bunyi
// 'equip' | 'inspect' | 'reload' (game/audio.js). null = tampilan pabrik.
const SKIN = { v: 0, tracer: null, flash: null, muzzle: null, glow: false, cue: null };
export function setSkinFx(o) { Object.assign(SKIN, { tracer: null, flash: null, muzzle: null, glow: false, cue: null }, o || {}); SKIN.v++; }
// salinan model orang pertama satu senjata (badan + magasin/pompa/bolt …) dengan material orang pertama, untuk pratinjau
export function gunPreview(kind) {
  if (!GLB) return null;
  const g = new THREE.Group();
  for (const o of GLB.root.children) if ((o.name === kind || o.name.startsWith(kind + '_')) && !/_lod\d$/.test(o.name) && !/_(muzzle|sight|guard)$/.test(o.name)) g.add(dressVm(o.clone(true), false));
  return g.children.length ? g : null;
}
const VM_FALLBACK = { skin: '#c48a64', glove: '#25232c', sleeve: '#503EBA', cuff: '#D29F52' };
// atribut vwx untuk geometri tanpa data bake (AO = 1, tanpa aus)
function vwxOf(g) {
  if (g.attributes.vwx) return g;
  const n = g.attributes.position.count, a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 2] = 1; a[i * 2 + 1] = 1; } // AO 1, aus 0 (v terbalik, lihat VM_VS)
  g.setAttribute('vwx', new THREE.BufferAttribute(a, 2));
  return g;
}
// pasang material orang pertama pada salinan simpul GLB; simpul anak statis dibekukan (matriks lokal tidak dihitung ulang)
function dressVm(obj, keepRoot = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      if (!g.attributes.vwx) { if (g.attributes.uv) g.setAttribute('vwx', g.attributes.uv); else vwxOf(g); }
      const nm = ((o.material && o.material.name) || '').replace(/\.\d+$/, '');
      o.material = vmMaterial(nm, o.material);
      o.frustumCulled = false;
    }
    if (!(keepRoot && o === obj)) { o.updateMatrix(); o.matrixAutoUpdate = false; }
  });
  return obj;
}

// ---------- Senjata di tangan (orang pertama) ----------
export function createViewModel(props = {}) { // props: { kit, band } geometri barang Blender (opsional)
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);
  const hemiVM = new THREE.HemisphereLight(0xffffff, 0x6a6a80, 2.1);
  scene.add(hemiVM);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(0.6, 1, 0.4);
  scene.add(key);
  let keyBase = 2.2, keyK = 1, worldLit = false, hemiBase = 2.1, envNow = 1;
  const flashLight = new THREE.PointLight(0xffc070, 0, 1.6);
  scene.add(flashLight);
  const mats = {};
  for (const [k, c] of Object.entries(MAT)) {
    mats[k] = k === 'dot' ? new THREE.MeshBasicMaterial({ color: c })
      : new THREE.MeshStandardMaterial({ color: c, metalness: k === 'gold' ? 0.45 : k === 'metal' || k === 'dark' ? 0.25 : 0.05, roughness: k === 'glass' ? 0.1 : k === 'poly' || k === 'grip' ? 0.7 : 0.45, transparent: k === 'glass', opacity: k === 'glass' ? 0.16 : 1, depthWrite: k !== 'glass' });
  }
  const fb = (n) => vmMaterial(n, { color: new THREE.Color(VM_FALLBACK[n]) });
  const sleeve = fb('sleeve'), glove = fb('glove'), cuff = fb('cuff');
  const root = new THREE.Group(); // posisi di depan kamera
  camera.add(root);
  scene.add(camera);
  const guns = {};
  const arm = (hand, elbow) => { // lengan bawah dari tangan ke siku (di luar layar)
    const g = new THREE.Group(), a = new THREE.Vector3(...hand), b = new THREE.Vector3(...elbow), len = a.distanceTo(b);
    const fore = new THREE.Mesh(vwxOf(new THREE.CylinderGeometry(0.044, 0.033, len, 10)), sleeve);
    fore.position.copy(a).add(b).multiplyScalar(0.5);
    fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const band = new THREE.Mesh(vwxOf(new THREE.CylinderGeometry(0.035, 0.035, 0.018, 10)), cuff);
    band.position.copy(a).lerp(b, 0.12);
    band.quaternion.copy(fore.quaternion);
    const h = new THREE.Mesh(vwxOf(new THREE.BoxGeometry(0.05, 0.035, 0.085)), glove);
    h.position.copy(a);
    g.add(fore, band, h);
    return g;
  };
  const HANDS = { // [tangan kanan (gagang), siku kanan], [tangan kiri (penyangga), siku kiri]
    pistol: [[0, -0.075, 0.06], [0.1, -0.33, 0.42], [-0.02, -0.07, 0.03], [-0.18, -0.34, 0.38]],
    smg: [[0, -0.08, 0.07], [0.12, -0.3, 0.45], [0, -0.03, -0.2], [-0.2, -0.3, 0.12]],
    shotgun: [[0, -0.075, 0.1], [0.12, -0.3, 0.48], [0, -0.04, -0.3], [-0.2, -0.32, 0.05]],
    ar: [[0, -0.08, 0.1], [0.12, -0.3, 0.48], [0, -0.03, -0.27], [-0.2, -0.32, 0.06]],
    dmr: [[0, -0.08, 0.1], [0.12, -0.3, 0.48], [0, -0.03, -0.3], [-0.2, -0.32, 0.04]],
  };
  for (const kind of Object.keys(WEAPONS)) {
    const g = new THREE.Group();
    let mag = null, pump = null;
    for (const p of parts(kind)) {
      const m = new THREE.Mesh(p.g, mats[p.m]);
      if (p.name === 'mag') mag = m;
      if (p.name === 'pump') pump = m;
      g.add(m);
    }
    const [hr, er, hl, el] = HANDS[kind] || HANDS[ALIAS[kind]];
    const armL = arm(hl, el);
    g.add(arm(hr, er), armL);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.012, MUZZLE_Z[kind]);
    g.add(muzzle);
    g.visible = false; // ditempel ke root hanya saat dipegang (syncGuns): three.js menelusuri simpul tak terlihat juga
    guns[kind] = { g, mag, pump, muzzle, mag0: mag ? mag.position.clone() : null, pumpZ0: pump ? pump.position.z : undefined, handL: armL, handL0: new THREE.Vector3(), handRest: new THREE.Vector3(...hl) };
    if (GLB) upgradeGun(kind);
  }
  // kilatan moncong: inti putih + kelopak tak beraturan + pijar lembut; warna HDR (×6) → berpendar lewat bloom
  const fcv = document.createElement('canvas');
  fcv.width = fcv.height = 128;
  { const g = fcv.getContext('2d');
    let gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,190,90,.55)'); gr.addColorStop(0.5, 'rgba(255,130,30,.18)'); gr.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    gr = g.createRadialGradient(64, 64, 0, 64, 64, 60);
    gr.addColorStop(0, 'rgba(255,252,235,1)'); gr.addColorStop(0.3, 'rgba(255,214,120,.95)'); gr.addColorStop(1, 'rgba(255,130,30,0)');
    g.fillStyle = gr;
    g.beginPath();
    const R = [60, 15, 40, 12, 58, 16, 34, 13, 52, 14, 44, 12];
    for (let i = 0; i < R.length; i++) { const a = i / R.length * Math.PI * 2 + 0.2; g.lineTo(64 + Math.cos(a) * R[i], 64 + Math.sin(a) * R[i]); }
    g.fill(); }
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(fcv), color: new THREE.Color(6, 4.6, 2.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.visible = false;
  scene.add(flash);
  const FLASH_K = { pistol: 0.8, revolver: 1.15, smg: 0.85, pdw: 0.8, ar: 1, burst: 1, dmr: 1.2, lmg: 1.15, sniper: 1.6, shotgun: 1.6, dbs: 1.75 };
  // selongsong yang terlontar (ruang kamera): kolam InstancedMesh 12 buah, tanpa alokasi per tembakan
  const CAS_N = 12, casS = new Float32Array(CAS_N * 14); // px py pz vx vy vz ax ay az wx wy wz life scale
  const cas = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0046, 0.005, 0.024, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.75, roughness: 0.34 }), CAS_N);
  cas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cas.count = 0; cas.visible = false; cas.frustumCulled = false; cas.matrixAutoUpdate = false;
  const BRASS = new THREE.Color('#d2a24e'), SHELL = new THREE.Color('#b3302a');
  for (let i = 0; i < CAS_N; i++) cas.setColorAt(i, BRASS);
  camera.add(cas);
  const CASE = { // titik lontar (ruang senjata) & jeda; shell: selongsong shotgun merah yang lebih besar. Revolver & laras ganda: tidak melontar
    pistol: { p: [0.012, 0.062, -0.03], d: 0 }, smg: { p: [0.03, 0.075, -0.05], d: 0 }, pdw: { p: [0.03, 0.08, -0.03], d: 0 }, ar: { p: [0.03, 0.096, -0.045], d: 0 },
    burst: { p: [0.03, 0.095, 0.04], d: 0 }, lmg: { p: [0.035, 0.09, -0.04], d: 0 }, dmr: { p: [0.03, 0.092, -0.03], d: 0 }, sniper: { p: [0.03, 0.09, -0.02], d: 0.5 }, shotgun: { p: [0.03, 0.07, -0.06], d: 0.3, shell: true } };
  let casN = 0, casWait = 0, casKind = null;
  const casE = new THREE.Euler(), casM = new THREE.Matrix4(), casQ = new THREE.Quaternion(), casV = new THREE.Vector3(), casSc = new THREE.Vector3();
  function ejectCasing(kind) {
    const C = CASE[kind], G = guns[kind];
    if (!C || !G || !G.g.parent) return;
    const i = casN < CAS_N ? casN++ : (Math.random() * CAS_N) | 0, k = i * 14;
    G.g.updateWorldMatrix(true, false);
    casV.set(C.p[0], C.p[1], C.p[2]).applyMatrix4(G.g.matrixWorld); // dunia adegan senjata = ruang kamera
    casS[k] = casV.x; casS[k + 1] = casV.y; casS[k + 2] = casV.z;
    casS[k + 3] = 1.5 + Math.random() * 1.1; casS[k + 4] = 1.1 + Math.random() * 0.9; casS[k + 5] = 0.15 + Math.random() * 0.7;
    casS[k + 6] = Math.random() * 6; casS[k + 7] = Math.random() * 6; casS[k + 8] = Math.random() * 6;
    casS[k + 9] = 14 + Math.random() * 18; casS[k + 10] = (Math.random() - 0.5) * 20; casS[k + 11] = (Math.random() - 0.5) * 16;
    casS[k + 12] = 0.9; casS[k + 13] = C.shell ? 2.3 : kind === 'pistol' || kind === 'smg' || kind === 'pdw' ? 0.75 : 1;
    cas.setColorAt(i, C.shell ? SHELL : BRASS);
    cas.instanceColor.needsUpdate = true;
  }
  function updateCasings(dt, hidden) {
    if (casWait > 0) { casWait -= dt; if (casWait <= 0) ejectCasing(casKind); }
    if (!casN) { if (cas.visible) { cas.visible = false; cas.count = 0; } return; }
    for (let i = 0; i < casN; i++) {
      const k = i * 14;
      casS[k + 12] -= dt;
      if (casS[k + 12] <= 0) { casN--; if (i < casN) { for (let q = 0; q < 14; q++) casS[k + q] = casS[casN * 14 + q]; cas.getColorAt(casN, BRASS_T); cas.setColorAt(i, BRASS_T); cas.instanceColor.needsUpdate = true; i--; } continue; }
      casS[k + 4] -= 9.8 * dt;
      casS[k] += casS[k + 3] * dt; casS[k + 1] += casS[k + 4] * dt; casS[k + 2] += casS[k + 5] * dt;
      casS[k + 6] += casS[k + 9] * dt; casS[k + 7] += casS[k + 10] * dt; casS[k + 8] += casS[k + 11] * dt;
      casM.compose(casV.set(casS[k], casS[k + 1], casS[k + 2]), casQ.setFromEuler(casE.set(casS[k + 6], casS[k + 7], casS[k + 8])), casSc.setScalar(casS[k + 13]));
      cas.setMatrixAt(i, casM);
    }
    cas.count = casN;
    cas.visible = casN > 0 && !hidden;
    cas.instanceMatrix.needsUpdate = true;
  }
  const BRASS_T = new THREE.Color();
  // kepulan asap tipis dari moncong (ruang kamera): kolam titik 24 buah
  const puffs = pointPool(camera, 24, false, 0.0, 70, 30);
  const st = { kind: null, t: 0, ads: 0, kick: 0, kickR: 0, swap: 0, sprint: 0, swayX: 0, swayY: 0, flashT: 0, land: 0, wasGround: true, prev: null, prevT: 0, act: null, inspect: 0 };
  const v = new THREE.Vector3();
  // ---------- efek skin senjata (setSkinFx): warna kilatan, partikel moncong, pendar isi ulang/periksa/cabut, panas ----------
  // Hanya MEMBACA keadaan animasi (st.flashT, st.act, st.inspect, st.swap); dipanggil sekali per frame dari update().
  const sfx = pointPool(camera, 72, true, 0.25, 40, 32), FLASH0 = flash.material.color.clone(), LIGHT0 = flashLight.color.clone();
  const sk = { v: -1, fl: 0, act: null, insp: 0, swap: 0, heat: 0, kick: 0, glow: 0, sweep: -99, sweepV: 0 };
  const rr = (a, b) => a + Math.random() * (b - a);
  function skinMuzzle(kind, p) { // partikel moncong per tembakan (ruang kamera)
    const big = FLASH_K[kind] > 1.3 ? 1.6 : 1;
    switch (SKIN.muzzle) {
      case 'ember': for (let i = 0; i < 4 * big; i++) sfx.emit(p.x, p.y, p.z, rr(-0.15, 0.15), rr(0.15, 0.55), rr(-0.5, -0.2), 0.006, 0.002, rr(0.45, 0.85), 6, 2.1, 0.35, 1, -0.5, 1.6); break;
      case 'frost': for (let i = 0; i < 5 * big; i++) sfx.emit(p.x, p.y, p.z, rr(-0.25, 0.25), rr(-0.1, 0.25), rr(-0.45, -0.1), 0.007, 0.002, rr(0.4, 0.7), 3.2, 5, 7, 1, 0.25, 3); break;
      case 'spark': for (let i = 0; i < 6 * big; i++) sfx.emit(p.x, p.y, p.z, rr(-1.1, 1.1), rr(-0.6, 1.1), rr(-1.4, -0.3), 0.004, 0.001, rr(0.1, 0.22), 4, 4.5, 9, 1, 0, 5); break;
      case 'gold': for (let i = 0; i < 5 * big; i++) sfx.emit(p.x, p.y, p.z, rr(-0.3, 0.3), rr(0.0, 0.5), rr(-0.6, -0.15), 0.006, 0.002, rr(0.35, 0.65), 7, 5, 1.6, 1, 1.4, 2); break;
      case 'plasma': for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; sfx.emit(p.x, p.y, p.z, Math.cos(a) * 0.5, Math.sin(a) * 0.5, -0.4, 0.006, 0.001, 0.22, 1.4, 6, 9, 1, 0, 6); } break;
      case 'peacock': for (let i = 0; i < 5 * big; i++) { const t = i % 2; sfx.emit(p.x, p.y, p.z, rr(-0.3, 0.3), rr(0.05, 0.45), rr(-0.6, -0.2), 0.006, 0.002, rr(0.35, 0.6), t ? 6 : 0.8, t ? 4 : 5, t ? 1 : 3.4, 1, -0.2, 2); } break;
      case 'smoke': for (let i = 0; i < 2; i++) puffs.emit(p.x, p.y, p.z, rr(-0.06, 0.06), rr(0.06, 0.16), rr(-0.3, -0.15), 0.03, 0.12, rr(0.5, 0.8), 0.08, 0.16, 0.15, 0.35, -0.1, 1.4);
        for (let i = 0; i < 3; i++) sfx.emit(p.x, p.y, p.z, rr(-0.3, 0.3), rr(0, 0.4), rr(-0.6, -0.2), 0.005, 0.001, rr(0.3, 0.5), 1, 5, 4, 1, -0.3, 2); break;
      case 'petal': for (let i = 0; i < 4 * big; i++) sfx.emit(p.x, p.y, p.z, rr(-0.3, 0.3), rr(0.0, 0.35), rr(-0.5, -0.15), 0.006, 0.003, rr(0.4, 0.7), 7, 4.4, 1.4, 1, 0.6, 2.2); break;
      default:
    }
  }
  function skinFxTick(dt, G, scoped) {
    tickSkins(); // waktu animasi skin (sekali per frame)
    sfx.pts.visible = !scoped;
    if (sk.v !== SKIN.v) { // tema berganti: warna kilatan & cahaya moncong
      sk.v = SKIN.v;
      if (SKIN.flash) { flash.material.color.setRGB(SKIN.flash[0], SKIN.flash[1], SKIN.flash[2]); const m = Math.max(...SKIN.flash); flashLight.color.setRGB(SKIN.flash[0] / m, SKIN.flash[1] / m, SKIN.flash[2] / m); }
      else { flash.material.color.copy(FLASH0); flashLight.color.copy(LIGHT0); }
    }
    const shot = st.flashT > sk.fl + 1e-5 && !!G; // fire() baru mengisi ulang st.flashT
    sk.fl = st.flashT - dt;
    if (shot) { sk.kick = 1; sk.heat = Math.min(1.5, sk.heat + (FLASH_K[st.kind] > 1.3 ? 0.22 : 0.07)); if (SKIN.muzzle && G.g.parent) { G.muzzle.getWorldPosition(v); skinMuzzle(st.kind, v); } }
    sk.kick *= Math.exp(-dt * 14);
    sk.heat = Math.max(0, sk.heat - dt * 0.35);
    // pendar: isi ulang (puncak saat magasin terpasang + denyut di akhir), periksa (sapuan cahaya dari popor ke moncong), cabut
    let glow = 0;
    const A = st.act;
    if (A && A.type === 'reload') { const u = Math.min(1, A.t); glow = 0.9 * Math.max(0, Math.min(1, (u - 0.48) / 0.14)) * (1 - Math.max(0, (u - 0.78) / 0.22)); if (u > 0.8 && sk.act !== 2) { sk.act = 2; if (SKIN.cue) SKIN.cue('reload'); } else if (sk.act !== 2) sk.act = 1; }
    else if (sk.act) { if (sk.act === 2) sk.glow = 1; sk.act = null; }
    if (st.inspect > 0) { const u = 1 - st.inspect; glow = Math.max(glow, 0.7 * Math.sin(Math.PI * u)); sk.sweep = 0.5 - u * 1.6; if (!sk.insp && SKIN.cue) SKIN.cue('inspect'); sk.insp = 1; }
    else { sk.insp = 0; if (sk.sweepV <= 0) sk.sweep = -99; }
    if (st.swap > sk.swap + 0.3 && st.kind) { sk.sweepV = 1; sk.glow = Math.max(sk.glow, 0.8); if (SKIN.cue) SKIN.cue('equip'); } // senjata dicabut
    sk.swap = st.swap;
    if (sk.sweepV > 0) { sk.sweepV = Math.max(0, sk.sweepV - dt * 1.8); sk.sweep = -0.95 + (1 - sk.sweepV) * 1.5; if (!sk.sweepV && !(st.inspect > 0)) sk.sweep = -99; }
    sk.glow = Math.max(0, sk.glow - dt * 1.6);
    VM_G.value.set(SKIN.glow ? Math.max(glow, sk.glow) : 0, sk.heat, sk.kick, SKIN.glow ? sk.sweep : -99);
    sfx.update(dt);
  }
  // ganti model prosedural dengan model Blender (laras −Z, asal di pegangan): titik bidik & moncong dari model;
  // magasin (<jenis>_mag) & pompa (shotgun_pump) adalah simpul terpisah di weapons.glb → dipasang ke senjata supaya bisa dianimasikan
  function upgradeGun(kind) {
    const src = glbNode(kind);
    if (!src) return;
    const G = guns[kind], model = src.clone(true);
    model.position.set(0, 0, 0);
    if (WEAPONS[kind].rail) { // pisahkan teropong bawaan (segitiga di sekitar sumbu teropong) supaya bisa disembunyikan sampai scope dipasang
      const [ys, z0, z1] = WEAPONS[kind].rail, meshes = [];
      G.builtin = [];
      model.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const m of meshes) {
        const g = m.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, keep = [], sc = [];
        for (let i = 0; i + 2 < n; i += 3) {
          const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
          const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
          (cz > z0 && cz < z1 && cy > ys - 0.027 && Math.hypot(cx, cy - ys) < 0.043 ? sc : keep).push(a, b, c);
        }
        if (!sc.length) continue;
        const mk = (ind) => { const ng = new THREE.BufferGeometry(); for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]); ng.setIndex(ind); return ng; };
        const sm = m.clone();
        sm.geometry = mk(sc); m.geometry = mk(keep);
        sm.visible = false;
        (m.parent || model).add(sm);
        G.builtin.push(sm);
      }
    }
    for (const ch of [...G.g.children]) if (ch !== G.muzzle) G.g.remove(ch);
    G.g.add(model);
    const ms = glbNode(kind + '_mag');
    G.mag = ms ? ms.clone(true) : null;
    if (G.mag) { G.g.add(G.mag); G.mag0 = G.mag.position.clone(); }
    const ps = kind === 'shotgun' ? glbNode('shotgun_pump') : null;
    G.pump = ps ? ps.clone(true) : null;
    if (G.pump) { G.g.add(G.pump); G.pumpZ0 = G.pump.position.z; }
    const mz = nodeLocal(kind + '_muzzle', kind), sg = nodeLocal(kind + '_sight', kind), gd = nodeLocal(kind + '_guard', kind);
    if (mz) G.muzzle.position.copy(mz);
    if (sg) { SIGHT_Y[kind] = sg.y; G.sightX = sg.x; G.sightZ = sg.z + 0.1; }
    for (const [hn, pos] of [['fp_hand_r', [0.026, 0.004, 0.01]], ['fp_hand_l', gd ? [gd.x, gd.y, gd.z] : [0, -0.03, -0.25]]]) {
      const h = glbNode(hn);
      if (!h) continue;
      const c = h.clone(true);
      c.position.set(...pos);
      G.g.add(c);
      if (hn === 'fp_hand_l') { G.handL = c; G.handL0 = c.position.clone(); G.handRest = c.position.clone(); }
      if (hn === 'fp_hand_r') { G.handR = c; G.handR0 = c.position.clone(); }
    }
    for (const [suf, key] of [['_bolt', 'bolt'], ['_cyl', 'cyl'], ['_brk', 'brk']]) { // bolt runduk, silinder revolver, laras patah-buka
      const n = glbNode(kind + suf);
      if (!n) continue;
      const c = n.clone(true);
      G.g.add(c);
      G[key] = c; G[key + '0'] = c.position.clone(); G[key + 'Q'] = c.quaternion.clone();
    }
    // material PBR orang pertama; simpul statis dibekukan — yang tetap hidup: grup senjata, magasin, pompa, bolt, silinder,
    // laras patah, kedua tangan, titik moncong
    dressVm(model, false);
    for (const part of [G.mag, G.pump, G.bolt, G.cyl, G.brk, G.handL, G.handR]) if (part && part.isObject3D) dressVm(part, true);
  }
  function syncGuns() { for (const k in guns) { const g = guns[k].g; if (g.visible) { if (g.parent !== root) root.add(g); } else if (g.parent) g.parent.remove(g); } }

  // ---------- Animasi orang pertama ----------
  // Aksi (isi ulang, obat, granat, periksa) memakai lini waktu u = 0..1 sepanjang durasi aksi di logika game
  // (WEAPONS.reload, obat 3,5 / 6 / 4 dtk), jadi animasi selesai tepat saat aksinya selesai.
  // Kurva kunci [t, x, y, z, henti?] (t naik): Hermite C1 — gerak mengalir lewat kunci (tidak berhenti di tiap kunci) dan
  // tidak melampaui titik balik (tangen nol di puncak/lembah). Kunci ber-elemen ke-5 = 1 dan kedua ujung berhenti sejenak
  // (mis. saat tangan menyentuh/menahan). Semua kunci dibuat sekali (bukan per frame).
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const easeIn = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x);
  const easeOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) * (1 - x) * (1 - x));
  const backOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2); // melampaui ±5 % lalu kembali
  const seg = (u, a, b) => clamp01((u - a) / (b - a));
  function tang(K, i, c) {
    if (i <= 0 || i >= K.length - 1 || K[i][4]) return 0;
    const A = K[i - 1], B = K[i], C = K[i + 1], h0 = B[0] - A[0], h1 = C[0] - B[0];
    const d0 = (B[c] - A[c]) / Math.max(1e-6, h0), d1 = (C[c] - B[c]) / Math.max(1e-6, h1);
    return d0 * d1 <= 0 ? 0 : (d0 * h1 + d1 * h0) / Math.max(1e-6, h0 + h1);
  }
  function curve(u, K, out) {
    const n = K.length;
    if (u <= K[0][0]) return out.set(K[0][1], K[0][2], K[0][3]);
    if (u >= K[n - 1][0]) return out.set(K[n - 1][1], K[n - 1][2], K[n - 1][3]);
    let i = 1;
    while (i < n - 1 && u > K[i][0]) i++;
    const A = K[i - 1], B = K[i], h = B[0] - A[0], s = (u - A[0]) / Math.max(1e-6, h), s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s) * h, h01 = 3 * s2 - 2 * s3, h11 = (s3 - s2) * h;
    return out.set(
      h00 * A[1] + h10 * tang(K, i - 1, 1) + h01 * B[1] + h11 * tang(K, i, 1),
      h00 * A[2] + h10 * tang(K, i - 1, 2) + h01 * B[2] + h11 * tang(K, i, 2),
      h00 * A[3] + h10 * tang(K, i - 1, 3) + h01 * B[3] + h11 * tang(K, i, 3));
  }
  const _c1 = new THREE.Vector3();
  const curve1 = (u, K) => curve(u, K, _c1).x;
  // penyusun kunci: kP(t, [x, y, z], henti) · kS(t, nilai, henti) · vAdd(titik, dx, dy, dz) · vMix(a, b, k)
  const kP = (t, p, stop) => (stop ? [t, p[0], p[1], p[2], 1] : [t, p[0], p[1], p[2]]);
  const kS = (t, v, stop) => (stop ? [t, v, 0, 0, 1] : [t, v, 0, 0]);
  const vAdd = (p, x = 0, y = 0, z = 0) => [p[0] + x, p[1] + y, p[2] + z];
  const vMix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const Z3 = [0, 0, 0];

  // ---------- Lengan orang pertama ----------
  // Potongan tangan + lengan bawah weapons.glb kaku: telapak di asal, lengan bawah searah sumbu lokal AX_* (ke siku).
  // aimArm: telapak di `pos`, potongan diputar supaya lengan bawah mengarah ke `dir` (ruang dasar ≈ kamera; qInv = rotasi
  // ruang dasar → ruang induk potongan), lalu diputar `roll` di sumbu lengan. dir = AX_* & roll = 0 → pose asli model
  // (identitas), jadi pose diam tidak berubah; saat beraksi lengan bawah tetap tersambung ke tepi layar (siku di luar layar).
  const AX_L = new THREE.Vector3(-0.328, -0.429, 0.842).normalize(); // fp_hand_l (sumbu utama lengan baju)
  const AX_R = new THREE.Vector3(0.239, -0.406, 0.882).normalize(); // fp_hand_r
  const AX_N = new THREE.Vector3(0.325, -0.849, 0.416).normalize(); // fp_hand_nade
  const AXL = AX_L.toArray(), AXR = AX_R.toArray(), AXN = AX_N.toArray();
  const _ad = new THREE.Vector3(), _aq = new THREE.Quaternion(), _aq2 = new THREE.Quaternion(), _fz = new THREE.Vector3();
  function aimArm(o, a, pos, dir, roll, qInv) {
    o.position.copy(pos);
    _ad.copy(dir);
    if (qInv) _ad.applyQuaternion(qInv);
    _ad.normalize();
    _aq.setFromUnitVectors(a, _ad);
    o.quaternion.copy(_aq2.setFromAxisAngle(_ad, roll)).multiply(_aq);
  }
  // aimArm2: sama, tetapi putaran lengan dihitung supaya sumbu lokal h (sumbu kaleng/suntikan/gulungan, arah telapak) mengarah
  // sedekat mungkin ke t (ruang dasar) — lebih mudah diatur daripada sudut putar
  const _ah = new THREE.Vector3(), _at = new THREE.Vector3(), _ax = new THREE.Vector3();
  function aimArm2(o, a, pos, dir, h, t, qInv) {
    o.position.copy(pos);
    _ad.copy(dir);
    if (qInv) _ad.applyQuaternion(qInv);
    _ad.normalize();
    _aq.setFromUnitVectors(a, _ad);
    _ah.copy(h).applyQuaternion(_aq); _ah.addScaledVector(_ad, -_ah.dot(_ad));
    _at.copy(t); if (qInv) _at.applyQuaternion(qInv); _at.addScaledVector(_ad, -_at.dot(_ad));
    o.quaternion.copy(_aq2.setFromAxisAngle(_ad, Math.atan2(_ax.crossVectors(_ah, _at).dot(_ad), _ah.dot(_at)))).multiply(_aq);
  }
  function glovedHand() { // cadangan tanpa GLB: telapak + 4 jari (−Z) + jempol, manset di +Z (pergelangan)
    const g = new THREE.Group();
    const palm = new THREE.Mesh(vwxOf(new THREE.BoxGeometry(0.075, 0.028, 0.085)), glove);
    g.add(palm);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(vwxOf(new THREE.CapsuleGeometry(0.0085, 0.045, 3, 8)), glove); f.rotation.x = Math.PI / 2; f.position.set(-0.027 + i * 0.018, 0.0, -0.068); g.add(f); }
    const th = new THREE.Mesh(vwxOf(new THREE.CapsuleGeometry(0.009, 0.035, 3, 8)), glove); th.rotation.set(Math.PI / 2, 0, 0.8); th.position.set(0.045, 0.004, -0.02); g.add(th);
    const cf = new THREE.Mesh(vwxOf(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 12)), cuff); cf.rotation.x = Math.PI / 2; cf.position.z = 0.055; g.add(cf);
    return g;
  }
  // salinan potongan tangan+lengan GLB (material orang pertama, ikut warna skin karakter) atau cadangan prosedural
  function armPiece(name, a) {
    const src = glbNode(name);
    if (src) { const c = src.clone(true); c.position.set(0, 0, 0); c.quaternion.identity(); dressVm(c, true); c.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); return c; }
    const g = new THREE.Group(), h = glovedHand(), f = new THREE.Mesh(vwxOf(new THREE.CylinderGeometry(0.036, 0.046, 0.44, 12)), sleeve);
    f.quaternion.setFromUnitVectors(UPV, a); f.position.copy(a).multiplyScalar(0.27);
    h.quaternion.setFromUnitVectors(_fz.set(0, 0, 1), a);
    g.name = name; g.add(f, h);
    return g;
  }
  const UPV = new THREE.Vector3(0, 1, 0);

  // ---------- Barang yang dipegang saat beraksi ----------
  const brassM = new THREE.MeshStandardMaterial({ color: '#d9b25a', metalness: 0.7, roughness: 0.32 });
  const shellM = new THREE.MeshStandardMaterial({ color: '#b5302a', roughness: 0.5 });
  // selongsong shotgun: grup searah −Z (ujung depan −Z, dasar kuningan +Z), asal di tengah
  function makeShell() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.058, 12), shellM), base = new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0112, 0.013, 12), brassM);
    base.position.y = -0.033;
    const s = new THREE.Group(); s.add(body, base); s.rotation.x = -Math.PI / 2; g.add(s);
    g.visible = false;
    return g;
  }
  const shells = [makeShell(), makeShell()]; // pompa: satu dipakai bergantian; laras ganda: dua selongsong
  // speedloader revolver: cakram + 6 peluru (ujung ke −Z) & 6 selongsong kosong yang dikeluarkan
  const spl = new THREE.Group(), spent = new THREE.Group();
  { const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.01, 18).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2c2f36', roughness: 0.5, metalness: 0.4 }));
    disc.position.z = 0.016; spl.add(disc);
    const rnd = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 8).rotateX(Math.PI / 2), tip = new THREE.ConeGeometry(0.0045, 0.008, 8).rotateX(-Math.PI / 2);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3, x = Math.cos(a) * 0.0118, y = Math.sin(a) * 0.0118;
      const b = new THREE.Mesh(rnd, brassM); b.position.set(x, y, 0); spl.add(b);
      const t = new THREE.Mesh(tip, brassM); t.position.set(x, y, -0.019); spl.add(t);
      const c = new THREE.Mesh(rnd, brassM); c.position.set(x, y, 0); spent.add(c);
    }
    spl.visible = spent.visible = false; }
  // rig obat (ruang kamera): lengan kiri/kanan + barang; tidak bergantung senjata
  const heal = new THREE.Group();
  heal.visible = false; // ditempel ke root hanya selama dipakai
  const hArmL = armPiece('fp_hand_l', AX_L), hArmR = armPiece('fp_hand_r', AX_R), hArmC = armPiece('fp_hand_nade', AX_N);
  const bandageMat = new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.9 });
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
  const wrap = new THREE.Mesh(unitCyl, bandageMat), roll = new THREE.Group();
  { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.05, 18), bandageMat), core = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.052, 10), new THREE.MeshStandardMaterial({ color: '#b9b2a2' })); roll.add(r, core); }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.003), bandageMat); // pita perban dari gulungan ke lengan (sumbu panjang = Y)
  wrap.material.side = THREE.DoubleSide;
  const kit = new THREE.Group(), lid = new THREE.Group();
  { const kg = props.kit ? props.kit.clone() : null;
    if (kg) { kg.computeBoundingBox(); const bb = kg.boundingBox, c = bb.getCenter(new THREE.Vector3()); kg.translate(-c.x, -bb.min.y, -c.z); const m = new THREE.Mesh(kg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })); m.scale.setScalar(0.4); kit.add(m); kit.userData.h = (bb.max.y - bb.min.y) * 0.4; kit.userData.d = (bb.max.z - bb.min.z) * 0.4; kit.userData.w = (bb.max.x - bb.min.x) * 0.4; }
    else { const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.055, 0.1), new THREE.MeshStandardMaterial({ color: '#1f8a4c' })); m.position.y = 0.0275; kit.add(m); kit.userData.h = 0.055; kit.userData.d = 0.1; kit.userData.w = 0.14; }
    const Lm = new THREE.Mesh(new THREE.BoxGeometry(kit.userData.w * 1.02, 0.008, kit.userData.d * 1.02), new THREE.MeshStandardMaterial({ color: '#23955a', roughness: 0.6 }));
    Lm.position.set(0, 0.004, kit.userData.d * 0.51);
    const cr1 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.003, 0.011), new THREE.MeshStandardMaterial({ color: '#ffffff' })), cr2 = cr1.clone(); cr2.rotation.y = Math.PI / 2;
    cr1.position.set(0, 0.0095, kit.userData.d * 0.51); cr2.position.copy(cr1.position);
    lid.add(Lm, cr1, cr2); lid.position.set(0, kit.userData.h, -kit.userData.d * 0.51); kit.add(lid); }
  const syringe = new THREE.Group(), plunger = new THREE.Group(); // jarum ke −Y, pendorong di +Y
  { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 14), new THREE.MeshStandardMaterial({ color: '#eef6fa', roughness: 0.15, transparent: true, opacity: 0.8 }));
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0072, 0.06, 12), new THREE.MeshStandardMaterial({ color: '#e0533b', emissive: '#7a2016' }));
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.03, 6), new THREE.MeshStandardMaterial({ color: '#d8dce2', metalness: 0.8, roughness: 0.2 }));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.008, 10), new THREE.MeshStandardMaterial({ color: '#ff9a3c', roughness: 0.5 }));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.05, 6), new THREE.MeshStandardMaterial({ color: '#3a3d46' })), thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.004, 12), rod.material);
    liquid.position.y = -0.008; hub.position.y = -0.044; needle.position.y = -0.063; rod.position.y = 0.055; thumb.position.y = 0.081;
    liquid.geometry.translate(0, 0.03, 0); liquid.position.y = -0.038; // menyusut dari atas (dasar tetap)
    plunger.add(rod, thumb); syringe.add(barrel, liquid, hub, needle, plunger);
    syringe.userData.liquid = liquid; syringe.scale.setScalar(1.45); }
  // kaleng minuman energi (asal = pusat kaleng, tutup di +Y): badan, pita warna, tutup, cincin pembuka berengsel
  const can = new THREE.Group(), canTab = new THREE.Group();
  { const alu = new THREE.MeshStandardMaterial({ color: '#cfd4da', metalness: 0.85, roughness: 0.28 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.112, 22), new THREE.MeshStandardMaterial({ color: '#1f6fd6', metalness: 0.55, roughness: 0.35 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0293, 0.0293, 0.03, 22), new THREE.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.4, roughness: 0.4 }));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.029, 0.008, 22), alu), bot = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.024, 0.008, 22), alu);
    top.position.y = 0.06; bot.position.y = -0.06; band.position.y = 0.012;
    const ring = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.002, 0.022), alu); ring.position.z = 0.011; // cincin: engsel di tengah tutup
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.001, 0.014), new THREE.MeshBasicMaterial({ color: '#15171b' })); hole.position.set(0, 0.0645, -0.013); hole.visible = false;
    canTab.add(ring); canTab.position.set(0, 0.065, -0.004);
    can.add(body, band, top, bot, canTab, hole);
    can.userData.hole = hole; }
  for (const o of [kit, syringe, can, roll, wrap, tail, ...shells, spl, spent]) o.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
  heal.add(hArmL, hArmR, hArmC, wrap, tail, kit);
  hArmR.add(roll, syringe, can);
  // granat di tangan kanan (fp_hand_nade, asal = pusat granat) + tangan kiri untuk mencabut pin
  const nadeRig = new THREE.Group(), nArm = armPiece('fp_hand_nade', AX_N), nArmL = armPiece('fp_hand_l', AX_L), nadeMesh = {};
  nadeRig.add(nArm, nArmL);
  nadeRig.visible = false; // ditempel ke root hanya selama dipakai
  for (const nk of Object.keys(NADES)) {
    const src = glbNode(nk), m = src ? dressVm(src.clone(true), true) : new THREE.Mesh(gunGeometry(nk), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    m.position.set(0, 0, 0); m.visible = false; m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    nArm.add(m); nadeMesh[nk] = m;
  }
  const pinRing = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0016, 6, 16), brassM); // cincin pin yang dicabut tangan kiri
  pinRing.frustumCulled = false; nArmL.add(pinRing);

  // ---------- scope terpasang (aksesori): tabung berongga di atas pisir; dibuat sekali per senjata & perbesaran ----------
  const SCOPE_DY = 0.043; // tinggi sumbu tabung di atas garis pisir (m)
  function buildScope(G, gk, pw) {
    const g = new THREE.Group(), L = pw === 4 ? 0.2 : 0.09, R = pw === 4 ? 0.026 : 0.032;
    const body = new THREE.MeshStandardMaterial({ color: '#1b1d21', metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide });
    const rim = new THREE.MeshStandardMaterial({ color: '#34373e', metalness: 0.7, roughness: 0.35 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 22, 1, true).rotateX(Math.PI / 2), body));
    for (const z of [-L / 2, L / 2]) { const t = new THREE.Mesh(new THREE.TorusGeometry(R + 0.0015, 0.0035, 8, 26), rim); t.position.z = z; g.add(t); }
    if (pw === 4) { // lensa depan melebar + kenop setelan
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.009, 0.05, 22, 1, true).rotateX(Math.PI / 2), body); bell.position.z = -L / 2 - 0.025; g.add(bell);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(R + 0.008, 22), new THREE.MeshStandardMaterial({ color: '#4aa8e0', metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); lens.position.z = -L / 2 - 0.048; g.add(lens);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 12), rim); knob.position.set(0, R + 0.006, 0); g.add(knob);
      const knob2 = knob.clone(); knob2.rotation.z = Math.PI / 2; knob2.position.set(R + 0.006, 0, 0); g.add(knob2);
    }
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.018, SCOPE_DY - R + 0.006, L * 0.6), rim); mount.position.y = -(SCOPE_DY + R) / 2; g.add(mount);
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    g.position.set(G.sightX || 0, SIGHT_Y[gk] + SCOPE_DY, (G.sightZ || 0) - 0.1 - (pw === 4 ? 0.04 : 0));
    G.g.add(g);
    return g;
  }
  function syncScope(G, gk, pw) { // tampilkan scope sesuai aksesori senjata yang sedang dipegang
    if (G.scN === pw) return;
    G.scN = pw;
    if (G.builtin) { for (const m of G.builtin) m.visible = pw > 0; return; } // DMR / runduk: teropong bawaan modelnya
    G.sc ||= {};
    if (pw && !G.sc[pw]) G.sc[pw] = buildScope(G, gk, pw);
    for (const k in G.sc) G.sc[k].visible = +k === pw;
  }
  // ---------- Persiapan animasi per senjata (setelah model GLB terpasang) ----------
  // titik kerja tangan kiri (ruang senjata), magasin cadangan yang dijatuhkan, slide pistol (dipisah dari model)
  const _bb = new THREE.Box3(), _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _v3 = new THREE.Vector3(), _q3 = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
  function rigGun(G, kind) {
    G.armL = !!(G.handL && G.handL.name === 'fp_hand_l');
    G.armR = !!(G.handR && G.handR.name === 'fp_hand_r');
    const R = G.handRest.toArray();
    let mb = null;
    if (G.mag) { // kotak magasin (ruang lokal magasin): tinggi & tengah untuk titik pegang
      _bb.makeEmpty();
      G.mag.updateMatrixWorld(true);
      _m4.copy(G.mag.matrixWorld).invert();
      G.mag.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); _bb.union(o.geometry.boundingBox.clone().applyMatrix4(_m4b.multiplyMatrices(_m4, o.matrixWorld))); } });
      mb = { y0: _bb.min.y, y1: _bb.max.y, z: (_bb.min.z + _bb.max.z) / 2, z0: _bb.min.z, z1: _bb.max.z };
      G.magDrop = G.mag.clone(true); // magasin lama yang jatuh (magasin baru = G.mag)
      G.magDrop.visible = false;
      G.g.add(G.magDrop);
    }
    const m0 = G.mag0 ? G.mag0.toArray() : vAdd(R, 0, -0.05, 0.2);
    // titik pegang magasin (pusat genggaman) saat terpasang; pistol: pangkal magasin (didorong telapak dari bawah)
    const pis = kind === 'pistol';
    const mg = mb ? (pis ? [m0[0] - 0.004, m0[1] + mb.y0 - 0.012, m0[2] + mb.z + 0.004] : [m0[0] - 0.006, m0[1] + mb.y0 * 0.55, m0[2] + mb.z + 0.01]) : vAdd(R, 0, -0.08, 0.2);
    const CH = { // titik kokang: tepuk tombol bolt (kiri, di atas lubang magasin) / tarik tuas samping / slide pistol
      ar: [-0.036, 0.076, -0.068], burst: [-0.036, 0.076, -0.064], dmr: [-0.038, 0.08, -0.075],
      smg: [-0.036, 0.112, -0.17], pdw: [-0.034, 0.118, -0.12], lmg: [-0.052, 0.112, -0.2],
      pistol: [0.0, 0.112, 0.012], sniper: [0.05, 0.062, 0.042],
    };
    G.rp = {
      mg, pre: vAdd(mg, -0.005, -0.075, 0.01), po: [R[0] - 0.2, R[1] - 0.6, Math.max(R[2] + 0.4, 0.15)],
      ch: CH[kind] || vAdd(R, 0, 0.06, 0.1), port: kind === 'shotgun' ? [0, 0.03, -0.1] : null,
    };
    if (kind === 'pistol') { // slide = segitiga logam di atas rangka (y > 0,0618) → bisa mundur saat menembak / terkunci saat kosong
      const parts = [];
      G.g.traverse((o) => { if (o.isMesh && o.parent && (o.parent === G.g.children.find((c) => c.name === 'pistol') || o.parent.name === 'pistol' || o.name.startsWith('pistol'))) parts.push(o); });
      const slide = new THREE.Group();
      for (const m of parts) {
        const nm = (m.material && m.material.name) || '';
        if (!/^(metal|dark|gold)/.test(nm)) continue;
        const g = m.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, keep = [], sl = [];
        for (let i = 0; i + 2 < n; i += 3) {
          const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
          (pos.getY(a) + pos.getY(b) + pos.getY(c) > 3 * 0.0618 ? sl : keep).push(a, b, c);
        }
        if (!sl.length) continue;
        const mk = (ind) => { const ng = new THREE.BufferGeometry(); for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]); ng.setIndex(ind); return ng; };
        const sm = new THREE.Mesh(mk(sl), m.material);
        sm.frustumCulled = false; sm.name = m.name + '_slide';
        m.geometry = mk(keep);
        m.updateWorldMatrix(true, false);
        sm.matrix.copy(m.matrix); sm.matrix.decompose(sm.position, sm.quaternion, sm.scale); sm.matrixAutoUpdate = false; sm.updateMatrix();
        slide.add(sm);
      }
      if (slide.children.length) { (parts[0].parent || G.g).add(slide); G.slide = slide; }
    }
  }
  function heldPose(G) { // tangan / magasin / pompa / bolt / silinder / laras / slide ke posisi diam
    if (G.handL) { G.handL.position.copy(G.handL0); G.handL.quaternion.identity(); }
    if (G.handR && G.handR0) { G.handR.position.copy(G.handR0); G.handR.quaternion.identity(); }
    if (G.mag && G.mag0) { G.mag.position.copy(G.mag0); G.mag.quaternion.identity(); G.mag.visible = true; }
    if (G.magDrop) G.magDrop.visible = false;
    if (G.pump) G.pump.position.z = G.pumpZ0 ?? G.pump.position.z;
    for (const k of ['bolt', 'cyl', 'brk']) if (G[k]) { G[k].position.copy(G[k + '0']); G[k].quaternion.copy(G[k + 'Q']); }
    if (G.slide) G.slide.position.z = st.mag === 0 ? 0.022 : 0;
    for (const s of shells) s.visible = false;
    spl.visible = spent.visible = false;
  }

  // ---------- Isi ulang ----------
  // Pose senjata (diputar di pegangan): tilt = [pitch, yaw, roll] rad, shift = geser (m, ruang dasar ≈ kamera).
  const RCFG = {
    ar: { tilt: [0.16, 0.3, -0.6], shift: [-0.06, 0.06, 0.05], ch: 'slap' }, burst: { tilt: [0.16, 0.3, -0.6], shift: [-0.06, 0.06, 0.05], ch: 'slap' },
    dmr: { tilt: [0.14, 0.3, -0.55], shift: [-0.06, 0.065, 0.06], ch: 'slap' }, smg: { tilt: [0.15, 0.28, -0.58], shift: [-0.05, 0.055, 0.05], ch: 'pull' },
    pdw: { tilt: [0.15, 0.28, -0.58], shift: [-0.05, 0.055, 0.05], ch: 'pull' }, lmg: { tilt: [0.16, 0.32, -0.5], shift: [-0.07, 0.07, 0.06], ch: 'pull' },
    sniper: { tilt: [0.13, 0.28, -0.5], shift: [-0.06, 0.065, 0.06], ch: 'bolt' }, pistol: { tilt: [0.3, 0.26, -0.48], shift: [-0.05, 0.055, 0.04], ch: 'rack' },
    revolver: { tilt: [0.5, 0.3, -0.85], shift: [-0.06, 0.07, 0.05] }, shotgun: { tilt: [0.12, 0.32, -0.85], shift: [-0.06, 0.065, 0.05] },
    dbs: { tilt: [-0.1, 0.3, -0.35], shift: [-0.05, 0.06, 0.05] },
  };
  // arah lengan bawah tangan kiri (ruang dasar): diam, memegang magasin di bawah senjata, ke kantong, menepuk/menarik tuas
  const FD = { rest: AXL, mag: [-0.22, -0.88, 0.42], pouch: [-0.25, -0.75, 0.6], slap: [-0.42, -0.8, 0.44], pull: [-0.5, -0.55, 0.66], rack: [-0.45, -0.62, 0.64], port: [-0.25, -0.85, 0.45] };
  // Lini waktu isi ulang magasin. Kunci (ruang senjata kecuali fdir): rot/pos = pose senjata, hand = pusat genggaman tangan
  // kiri, fdir = arah lengan bawah, roll = putaran lengan. ev: out = magasin lepas, grab = magasin lama dipegang,
  // seat = magasin baru terpasang, ch = kokang; cues = bunyi [u, jenis].
  function magKeys(G, kind, empty) {
    const C = RCFG[kind], T = C.tilt, Sh = C.shift, R = G.handRest.toArray(), rp = G.rp, MG = rp.mg, PRE = rp.pre, PO = rp.po, CHP = rp.ch;
    const pis = kind === 'pistol', heavy = kind === 'lmg', snip = kind === 'sniper';
    const Tc = [T[0] + 0.05, T[1] - 0.08, T[2] + 0.16]; // condong ke tangan saat mengokang
    const rM = pis ? 0.9 : 0.35, rS = 0.6, rP = pis ? 1.9 : 0.4; // roll lengan: pegang magasin / tepuk / tarik
    // waktu (fraksi durasi): sniper & lmg lebih santai, pistol lebih rapat
    const X = snip ? { tin: 0.1, out: 0.04, po: 0.2, poE: 0.27, pre: 0.4, seat: 0.48, ch0: 0.58, ch: 0.62, chE: 0.86, back: 0.94 }
      : heavy ? { tin: 0.08, out: 0.03, po: 0.19, poE: 0.27, pre: 0.48, seat: 0.58, ch0: 0.69, ch: 0.73, chE: 0.8, back: 0.92 }
        : pis ? { tin: 0.12, out: 0.05, po: 0.22, poE: 0.28, pre: 0.44, seat: 0.54, ch0: 0.64, ch: 0.72, chE: 0.78, back: 0.92 }
          : { tin: 0.15, out: 0.05, po: 0.22, poE: 0.3, pre: 0.46, seat: 0.56, ch0: 0.64, ch: 0.7, chE: 0.76, back: 0.9 };
    const doCh = empty && C.ch !== 'bolt'; // runduk: kokang bolt dengan tangan kanan (lihat boltPose)
    let hand, fdir, roll, ev, cues;
    const rot = [kP(0, Z3), kP(0.035, [-0.035, 0.02, 0.03]), kP(X.tin, vAdd(T, 0.03, 0.02, -0.05)), kP(X.tin + 0.06, T)];
    const pos = [kP(0, Z3), kP(0.035, [0.004, -0.012, 0.01]), kP(X.tin, vAdd(Sh, 0, 0.006, 0)), kP(X.tin + 0.06, Sh)];
    if (empty) {
      // magasin kosong: dijatuhkan (jempol kanan), tangan kiri ke kantong, magasin baru, masuk, (kokang), kembali
      hand = [kP(0, R), kP(X.out + 0.03, vAdd(R, -0.02, -0.07, 0.07)), kP(X.po, PO, 1), kP(X.poE, PO, 1), kP(X.pre - 0.05, vAdd(PRE, -0.03, -0.09, 0.05)), kP(X.pre, PRE, 1), kP(X.seat, MG, 1), kP(X.seat + 0.025, vAdd(MG, 0, 0.004, 0)), kP(X.seat + 0.05, vAdd(MG, -0.01, -0.03, 0.02))];
      fdir = [kP(0, AXL), kP(X.out + 0.03, FD.pouch), kP(X.po, FD.pouch), kP(X.poE, FD.pouch), kP(X.pre - 0.05, FD.mag), kP(X.pre, FD.mag), kP(X.seat + 0.05, FD.mag)];
      roll = [kS(0, 0), kS(X.out + 0.03, 0.2), kS(X.pre - 0.05, rM), kS(X.seat + 0.05, rM)];
      ev = { out: X.out, seat: X.seat, ch: doCh ? X.ch : -1, show: X.po };
      cues = [[X.out, 'out'], [X.seat, 'in']];
      if (doCh) {
        const sl = C.ch === 'slap', rk = C.ch === 'rack', A0 = sl ? vAdd(CHP, -0.05, 0.01, 0.02) : rk ? vAdd(CHP, 0, 0.03, -0.01) : vAdd(CHP, -0.03, 0.01, 0.0);
        const A1 = sl ? CHP : CHP, A2 = sl ? vAdd(CHP, -0.045, 0.0, 0.01) : rk ? vAdd(CHP, 0, 0.004, 0.045) : vAdd(CHP, -0.004, 0, 0.065);
        hand.push(kP(X.ch0, A0), kP(X.ch, A1, 1), kP(X.chE, A2, rk || C.ch === 'pull' ? 1 : 0));
        fdir.push(kP(X.ch0, sl ? FD.slap : rk ? FD.rack : FD.pull), kP(X.chE, sl ? FD.slap : rk ? FD.rack : FD.pull));
        roll.push(kS(X.ch0, sl ? rS : rP), kS(X.chE, sl ? rS : rP));
        cues.push([sl ? X.ch : X.chE, 'bolt']);
        rot.push(kP(X.seat, T), kP(X.ch0, Tc), kP(X.chE, Tc));
        pos.push(kP(X.seat, Sh), kP(X.ch0, vAdd(Sh, 0.01, 0.0, 0)), kP(X.chE, vAdd(Sh, 0.01, 0.0, 0)));
      } else { rot.push(kP(X.seat + 0.06, T)); pos.push(kP(X.seat + 0.06, Sh)); }
    } else {
      // masih ada peluru: magasin lama dicabut & disimpan, magasin baru masuk, ditepuk; tanpa kokang
      const g0 = X.tin - 0.02, sT = X.seat + 0.08;
      hand = [kP(0, R), kP(g0 - 0.05, vAdd(MG, -0.025, -0.06, 0.05)), kP(g0, MG, 1), kP(g0 + 0.04, vAdd(MG, 0, -0.012, 0), 1), kP(g0 + 0.1, vAdd(MG, -0.01, -0.13, 0.03)), kP(X.po + 0.1, PO, 1), kP(X.poE + 0.1, PO, 1), kP(X.pre + 0.04, vAdd(PRE, -0.03, -0.09, 0.05)), kP(X.pre + 0.08, PRE, 1), kP(sT, MG, 1), kP(sT + 0.035, vAdd(MG, -0.008, -0.035, 0.02)), kP(sT + 0.06, vAdd(MG, 0, -0.008, 0.004), 1), kP(sT + 0.09, vAdd(MG, -0.015, -0.05, 0.03))];
      fdir = [kP(0, AXL), kP(g0 - 0.05, FD.mag), kP(g0 + 0.1, FD.mag), kP(X.po + 0.1, FD.pouch), kP(X.poE + 0.1, FD.pouch), kP(X.pre + 0.04, FD.mag), kP(sT + 0.09, FD.mag)];
      roll = [kS(0, 0), kS(g0 - 0.05, rM), kS(g0 + 0.1, rM), kS(X.po + 0.1, 0.2), kS(X.poE + 0.1, 0.2), kS(X.pre + 0.04, rM), kS(sT + 0.09, rM)];
      ev = { grab: g0, out: g0 + 0.04, seat: sT, ch: -1, swap: (X.po + X.poE) / 2 + 0.1 };
      cues = [[g0 + 0.04, 'out'], [sT, 'in'], [sT + 0.06, 'tap']];
      rot.push(kP(sT, T), kP(sT + 0.06, vAdd(T, 0.02, 0, 0.03)));
      pos.push(kP(sT, Sh), kP(sT + 0.06, Sh));
    }
    if (snip && empty) { // runduk: tangan kiri kembali ke penyangga dulu, lalu tangan kanan mengokang bolt
      hand.push(kP(X.seat + 0.12, vAdd(R, 0, -0.006, 0.006)), kP(X.ch0, R, 1)); fdir.push(kP(X.seat + 0.12, AXL)); roll.push(kS(X.seat + 0.12, 0));
      rot.push(kP(X.ch0, vAdd(T, 0, -0.05, 0.12)), kP(X.chE, vAdd(T, 0, -0.05, 0.12)));
    }
    // kembali ke pegangan: senjata berputar balik dengan sedikit lewat lalu diam
    const last = hand[hand.length - 1][0], b0 = Math.max(last + 0.04, X.back - 0.12, rot[rot.length - 1][0] + 0.02, pos[pos.length - 1][0] + 0.02);
    hand.push(kP(X.back, vAdd(R, 0, -0.006, 0.008)), kP(1, R));
    fdir.push(kP(X.back, AXL), kP(1, AXL));
    roll.push(kS(X.back, 0), kS(1, 0));
    rot.push(kP(b0, rot[rot.length - 1].slice(1, 4)), kP(X.back, [-0.03, -0.015, 0.035]), kP(1, Z3));
    pos.push(kP(b0, pos[pos.length - 1].slice(1, 4)), kP(X.back, [0, 0.005, -0.004]), kP(1, Z3));
    if (snip && empty) { ev.bolt = [X.ch0 - 0.04, X.chE]; cues.push([X.ch0 + (X.chE - X.ch0) * 0.42, 'bolt'], [X.ch0 + (X.chE - X.ch0) * 0.7, 'bolt']); }
    if (pis && empty) ev.slide = X.chE; // slide maju (dilepas) di akhir tarikan
    return { rot, pos, hand, fdir, roll, ev, cues, empty };
  }
  // Shotgun pompa: n selongsong lewat lubang isi di bawah receiver, satu per satu; kosong → dipompa di akhir.
  function shotgunKeys(G, n, empty) {
    const C = RCFG.shotgun, T = C.tilt, Sh = C.shift, R = G.handRest.toArray();
    const c0 = 0.13, c1 = empty ? 0.78 : 0.86, cl = (c1 - c0) / n;
    const rot = [kP(0, Z3), kP(0.035, [-0.03, 0.02, 0.03]), kP(0.1, vAdd(T, 0.02, 0, -0.06)), kP(0.16, T), kP(c1, T)];
    const pos = [kP(0, Z3), kP(0.035, [0.004, -0.01, 0.01]), kP(0.1, vAdd(Sh, 0, 0.005, 0)), kP(0.16, Sh), kP(c1, Sh)];
    const cues = [];
    for (let i = 0; i < n; i++) cues.push([c0 + (i + 0.62) * cl, 'shell']);
    if (empty) {
      rot.push(kP(0.83, [0.05, 0.08, -0.15]), kP(0.88, [-0.04, 0.05, -0.1]), kP(0.93, [0.03, 0.02, -0.04]), kP(1, Z3));
      pos.push(kP(0.83, [-0.02, 0.02, 0.02]), kP(0.88, [-0.01, 0.01, 0.04]), kP(0.93, [0, 0.004, 0]), kP(1, Z3));
      cues.push([0.875, 'pump'], [0.925, 'pump']);
    } else {
      rot.push(kP(0.95, [-0.02, -0.01, 0.03]), kP(1, Z3));
      pos.push(kP(0.95, [0, 0.004, -0.003]), kP(1, Z3));
    }
    return { rot, pos, ev: { c0, c1, cl, n, pump: empty ? [0.84, 0.95] : null }, cues, R };
  }
  // revolver: silinder diayun keluar, selongsong dikeluarkan, speedloader, silinder ditutup & diputar
  function revolverKeys(G) {
    const C = RCFG.revolver, T = C.tilt, Sh = C.shift, R = G.handRest.toArray(), cy = G.cyl0.toArray();
    const rear = vAdd(cy, -0.045, 0.002, 0.05); // belakang silinder saat terbuka (titik masuk speedloader)
    const rot = [kP(0, Z3), kP(0.08, vAdd(T, -0.25, 0, 0.1)), kP(0.16, [T[0] * 0.5, T[1], T[2] * 0.8]), kP(0.2, vAdd(T, 0.35, 0, 0)), kP(0.26, vAdd(T, 0.42, 0, 0)), kP(0.32, T), kP(0.62, T), kP(0.7, vAdd(T, 0.04, 0, 0.05)), kP(0.78, [0.15, 0.12, -0.25]), kP(0.88, [-0.03, -0.01, 0.03]), kP(1, Z3)];
    const pos = [kP(0, Z3), kP(0.08, vAdd(Sh, 0, -0.02, 0)), kP(0.2, vAdd(Sh, 0, 0.02, 0)), kP(0.32, Sh), kP(0.7, Sh), kP(0.88, [0, 0.004, -0.003]), kP(1, Z3)];
    const hand = [kP(0, R), kP(0.06, vAdd(cy, -0.04, -0.025, 0.02)), kP(0.1, vAdd(cy, -0.03, -0.02, 0.0), 1), kP(0.15, vAdd(cy, -0.06, -0.02, 0.01)), kP(0.2, vAdd(cy, -0.07, -0.01, -0.04), 1), kP(0.26, vAdd(cy, -0.07, -0.0, -0.06), 1), kP(0.38, vAdd(R, -0.15, -0.4, 0.2), 1), kP(0.42, vAdd(R, -0.15, -0.4, 0.2), 1), kP(0.52, vAdd(rear, -0.02, -0.07, 0.07)), kP(0.57, vAdd(rear, 0, 0, 0.035), 1), kP(0.61, rear, 1), kP(0.64, vAdd(rear, -0.03, -0.05, 0.05)), kP(0.7, vAdd(cy, -0.08, -0.02, 0.0)), kP(0.74, vAdd(cy, -0.04, 0.0, 0.0), 1), kP(0.82, vAdd(R, -0.02, -0.03, 0.03)), kP(0.9, R), kP(1, R)];
    const fdir = [kP(0, AXL), kP(0.06, [-0.45, -0.6, 0.65]), kP(0.26, [-0.55, -0.55, 0.6]), kP(0.38, FD.pouch), kP(0.42, FD.pouch), kP(0.52, [-0.3, -0.8, 0.5]), kP(0.64, [-0.3, -0.8, 0.5]), kP(0.7, [-0.55, -0.55, 0.6]), kP(0.74, [-0.55, -0.55, 0.6]), kP(0.9, AXL), kP(1, AXL)];
    const roll = [kS(0, 0), kS(0.06, 0.4), kS(0.26, 0.4), kS(0.38, 0.2), kS(0.52, 1.1), kS(0.64, 1.1), kS(0.7, 0.5), kS(0.74, 0.5), kS(0.9, 0), kS(1, 0)];
    return { rot, pos, hand, fdir, roll, ev: { open: [0.08, 0.15], eject: 0.24, spl: [0.44, 0.63], close: [0.7, 0.75] }, cues: [[0.13, 'open'], [0.24, 'eject'], [0.6, 'in'], [0.74, 'close']], rear };
  }
  // laras ganda: laras dipatahkan, 2 selongsong terlontar, n selongsong baru, ditutup dengan sentakan
  function dbsKeys(G, n) {
    const C = RCFG.dbs, T = C.tilt, Sh = C.shift, R = G.handRest.toArray(), hb = G.brk0.toArray();
    const br = vAdd(hb, 0, 0.03, 0.035); // belakang kamar peluru saat terbuka (ruang senjata, kira-kira)
    const rot = [kP(0, Z3), kP(0.06, vAdd(T, 0.08, 0, 0.04)), kP(0.12, vAdd(T, -0.08, 0, 0)), kP(0.18, T), kP(0.7, T), kP(0.74, vAdd(T, 0.18, 0, 0)), kP(0.79, vAdd(T, -0.06, 0, 0)), kP(0.86, [0.02, 0.04, -0.05]), kP(0.94, [-0.02, -0.01, 0.02]), kP(1, Z3)];
    const pos = [kP(0, Z3), kP(0.12, vAdd(Sh, 0, -0.015, 0)), kP(0.18, Sh), kP(0.74, Sh), kP(0.79, vAdd(Sh, 0, 0.015, 0)), kP(0.94, [0, 0.003, -0.002]), kP(1, Z3)];
    const fore = vAdd(R, 0, -0.035, 0.0); // tangan menekan laras ke bawah (memegang popor depan)
    const hand = [kP(0, R), kP(0.06, vAdd(R, 0, 0.012, 0)), kP(0.12, fore, 1), kP(0.18, vAdd(fore, -0.03, -0.05, 0.06)), kP(0.3, vAdd(R, -0.16, -0.4, 0.4), 1), kP(0.36, vAdd(R, -0.16, -0.4, 0.4), 1), kP(0.48, vAdd(br, -0.03, -0.06, 0.08))];
    const fdir = [kP(0, AXL), kP(0.12, AXL), kP(0.3, FD.pouch), kP(0.36, FD.pouch), kP(0.48, [-0.3, -0.75, 0.6])];
    const roll = [kS(0, 0), kS(0.12, 0), kS(0.3, 0.2), kS(0.48, 0.9)];
    const cues = [[0.11, 'open'], [0.15, 'eject']];
    for (let i = 0; i < n; i++) { const s0 = 0.5 + i * 0.09; hand.push(kP(s0, vAdd(br, i ? 0.012 : -0.012, -0.012, 0.03)), kP(s0 + 0.05, vAdd(br, i ? 0.012 : -0.012, -0.005, -0.012), 1)); cues.push([s0 + 0.05, 'shell']); }
    const sE = 0.5 + n * 0.09;
    hand.push(kP(sE + 0.04, vAdd(fore, -0.02, -0.03, 0.04)), kP(0.72, vAdd(fore, 0, -0.012, 0), 1), kP(0.76, vAdd(R, 0, 0.008, 0)), kP(0.86, R), kP(1, R));
    fdir.push(kP(sE + 0.04, AXL), kP(1, AXL));
    roll.push(kS(sE, 0.9), kS(sE + 0.04, 0), kS(1, 0));
    cues.push([0.76, 'close']);
    const sIn = [0.55, 0.64]; // waktu tiap selongsong masuk penuh
    return { rot, pos, hand, fdir, roll, ev: { open: [0.07, 0.14], close: [0.72, 0.76], eject: 0.15, n, sE, sIn, sHand: 0.4 }, cues, br };
  }
  function reloadKeys(G, kind, A) {
    const key = kind === 'shotgun' ? 's' + A.n + (A.empty ? 'e' : '') : kind === 'dbs' ? 'd' + Math.min(2, A.n) : kind === 'revolver' ? 'r' : A.empty ? 'e' : 't';
    G.rl ||= {};
    if (!G.rl[key]) G.rl[key] = kind === 'shotgun' ? shotgunKeys(G, A.n, A.empty) : kind === 'dbs' ? dbsKeys(G, Math.max(1, Math.min(2, A.n))) : kind === 'revolver' ? revolverKeys(G) : magKeys(G, kind, A.empty);
    return G.rl[key];
  }
  const aPos = new THREE.Vector3(), aRot = new THREE.Vector3(), hp = new THREE.Vector3(), fd = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const qAct = new THREE.Quaternion(), qActInv = new THREE.Quaternion(), eAct = new THREE.Euler();
  const _o3 = new THREE.Object3D();
  function actQ() { qAct.setFromEuler(eAct.set(aRot.x, aRot.y, aRot.z)); qActInv.copy(qAct).invert(); }
  // pose tangan kiri pada u (tanpa menyentuh adegan) → matriks ruang senjata (untuk offset magasin di tangan)
  function handMatAt(G, K, u, out) {
    curve(u, K.rot, aRot); actQ();
    curve(u, K.hand, hp); curve(u, K.fdir, fd);
    aimArm(_o3, AX_L, hp, fd, curve1(u, K.roll), qActInv);
    return out.compose(_o3.position, _o3.quaternion, ONE);
  }
  // magasin menempel tangan: off = H⁻¹ · M0 (dihitung di awal isi ulang dari pose kunci, bukan per frame)
  const _hm = new THREE.Matrix4(), _mm = new THREE.Matrix4();
  function magOffset(G, K, u, out) { handMatAt(G, K, u, _hm).invert(); return out.multiplyMatrices(_hm, _mm.makeTranslation(G.mag0.x, G.mag0.y, G.mag0.z)); }
  function attach(obj, hand, off) { // obj (anak senjata) = tangan · off
    _m4.compose(hand.position, hand.quaternion, ONE).multiply(off);
    _m4.decompose(obj.position, obj.quaternion, _v3);
  }
  // magasin lama jatuh bebas di ruang kamera (gravitasi + putaran), digambar sebagai anak senjata
  const drop = { on: false, t: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), G: null };
  const _dq = new THREE.Quaternion(), _dm = new THREE.Matrix4(), _gm = new THREE.Matrix4();
  function dropMag(G, vx, vy, vz) {
    if (!G.magDrop) return;
    G.g.updateMatrix();
    _dm.multiplyMatrices(G.g.matrix, _mm.compose(G.mag.position, G.mag.quaternion, ONE));
    _dm.decompose(drop.p, drop.q, _v3);
    drop.v.set(vx, vy, vz); drop.w.set(-3 - Math.random() * 3, (Math.random() - 0.5) * 3, 2 + Math.random() * 2);
    drop.t = 0; drop.on = true; drop.G = G;
    G.magDrop.visible = true;
  }
  function updateDrop(dt) {
    if (!drop.on) return;
    const G = drop.G;
    drop.t += dt;
    drop.v.y -= 9.8 * dt;
    drop.p.addScaledVector(drop.v, dt);
    _dq.setFromAxisAngle(_v3.copy(drop.w).normalize(), drop.w.length() * dt);
    drop.q.premultiply(_dq);
    if (drop.t > 0.7 || !G.g.parent) { drop.on = false; G.magDrop.visible = false; return; }
    _gm.copy(G.g.matrix).invert().multiply(_dm.compose(drop.p, drop.q, ONE));
    _gm.decompose(G.magDrop.position, G.magDrop.quaternion, _v3);
  }
  // siklus bolt runduk (setelah tiap tembakan & di akhir isi ulang): tangan kanan ke tuas, naik, tarik, dorong, turun, kembali
  const BOLT_FD = [0.3, -0.72, 0.62], boltTip = new THREE.Vector3();
  function boltPose(G, u, w = 1) { // u 0..1 · w = bobot (pudar saat dibatalkan)
    if (!G.bolt) return;
    const up = ease(seg(u, 0.18, 0.3)) * (1 - ease(seg(u, 0.66, 0.76))), back = ease(seg(u, 0.32, 0.46)) * (1 - ease(seg(u, 0.5, 0.63)));
    G.bolt.position.copy(G.bolt0); G.bolt.position.z += 0.075 * back * w;
    G.bolt.quaternion.copy(G.boltQ); G.bolt.rotateZ(1.15 * up * w);
    if (!G.handR || !G.handR0) return;
    // ujung tuas (ruang senjata) mengikuti bolt
    boltTip.set(0.05, -0.028, 0.035).applyQuaternion(G.bolt.quaternion).add(G.bolt.position);
    const reach = ease(seg(u, 0.04, 0.18)) * (1 - ease(seg(u, 0.76, 0.94))) * w;
    hp.copy(G.handR0).lerp(tmp.copy(boltTip).add(tmp2.set(0.012, -0.03, 0.02)), reach);
    fd.set(AXR[0], AXR[1], AXR[2]).lerp(tmp.set(BOLT_FD[0], BOLT_FD[1], BOLT_FD[2]), reach);
    if (G.armR) aimArm(G.handR, AX_R, hp, fd, -0.9 * reach, qActInv);
    else G.handR.position.copy(hp);
  }
  // isi ulang: pose senjata → aPos/aRot; tangan kiri (kurva → aimArm), lalu barang yang menempel tangan (magasin,
  // speedloader, selongsong). w = bobot (1 = penuh; turun ke 0 saat dibatalkan → kembali halus ke pose diam)
  let rl = 0;
  function animReload(G, kind, A) {
    const u = A.u, w = A.w, K = A.K, ev = K.ev;
    curve(u, K.rot, aRot); curve(u, K.pos, aPos);
    if (w < 1) { aRot.multiplyScalar(w); aPos.multiplyScalar(w); }
    actQ();
    if (kind === 'shotgun') animShotgun(G, A, u, w);
    else {
      curve(u, K.hand, hp); curve(u, K.fdir, fd); rl = curve1(u, K.roll);
      if (kind === 'revolver') animRevolver(G, A, u, w);
      else if (kind === 'dbs') animDbs(G, A, u, w);
    }
    if (w < 1) { hp.lerp(G.handRest, 1 - w); fd.lerp(tmp.set(AXL[0], AXL[1], AXL[2]), 1 - w); rl *= w; }
    if (G.armL) aimArm(G.handL, AX_L, hp, fd, rl, qActInv); else G.handL.position.copy(hp);
    if (kind === 'shotgun' || kind === 'revolver' || kind === 'dbs') return;
    if (G.mag && G.mag0) { // magasin: lama jatuh / dicabut, baru dibawa tangan dari bawah layar, pas saat terpasang
      const inHand = u >= (K.empty ? ev.out : ev.grab) && u < ev.seat;
      if (!A.dropped && K.empty && u >= ev.out && w > 0.5) { A.dropped = true; dropMag(G, -0.3, -0.25, 0.22); }
      if (w < 0.5 || !inHand) { G.mag.position.copy(G.mag0); G.mag.quaternion.identity(); G.mag.visible = !(K.empty && inHand); }
      else { attach(G.mag, G.handL, !K.empty && u < ev.swap ? A.offA : A.offB); G.mag.visible = !K.empty || u >= ev.show; }
    }
    if (ev.bolt) { const b = seg(u, ev.bolt[0], ev.bolt[1]); if (b > 0 && b < 1) boltPose(G, b, w); else if (G.handR0) { G.handR.position.copy(G.handR0); G.handR.quaternion.identity(); } }
    if (G.slide) G.slide.position.z = !K.empty ? 0 : !ev.slide ? 0.022 : u < ev.slide - 0.06 ? 0.022 : u < ev.slide ? 0.022 + 0.012 * ease(seg(u, ev.slide - 0.06, ev.slide)) : 0.034 * (1 - easeIn(seg(u, ev.slide, ev.slide + 0.02)));
  }
  // shotgun: jalur selongsong (ruang senjata) dihitung langsung, tangan mengikuti selongsong → selongsong pasti masuk lubang isi
  function animShotgun(G, A, u, w) {
    const K = A.K, ev = K.ev, port = G.rp.port, sh = shells[0], R = G.handRest;
    const ci = Math.floor((u - ev.c0) / ev.cl), f = (u - ev.c0) / ev.cl - ci; // selongsong ke-ci, fase f
    const s = u > ev.c0 && u < ev.c1 && ci >= 0 && ci < ev.n ? f : -1;
    if (sh.parent !== G.g) G.g.add(sh);
    // titik jalur: sabuk (bawah layar) → depan lubang → di lubang → terdorong ke tabung
    const B = SG_BELT, Q = SG_PRE, I = SG_IN, T = SG_TUBE;
    if (s >= 0 && s < 0.72) {
      if (s < 0.4) tmp.set(port[0] + B[0], port[1] + B[1], port[2] + B[2]).lerp(tmp2.set(port[0] + Q[0], port[1] + Q[1], port[2] + Q[2]), easeOut(s / 0.4));
      else if (s < 0.56) tmp.set(port[0] + Q[0], port[1] + Q[1], port[2] + Q[2]).lerp(tmp2.set(port[0] + I[0], port[1] + I[1], port[2] + I[2]), ease((s - 0.4) / 0.16));
      else tmp.set(port[0] + I[0], port[1] + I[1], port[2] + I[2]).lerp(tmp2.set(port[0] + T[0], port[1] + T[1], port[2] + T[2]), easeIn((s - 0.56) / 0.16));
      sh.visible = w > 0.5 && s > 0.08 && s < 0.7;
      sh.position.copy(tmp);
      sh.rotation.set(0.3 * (1 - ease(s / 0.56)), 0, 0); // ujung depan sedikit naik saat diarahkan ke lubang
      hp.copy(tmp).add(tmp2.set(SG_HAND[0], SG_HAND[1], SG_HAND[2])); // genggaman di belakang-bawah selongsong, jempol mendorong
    } else {
      sh.visible = false;
      const back = s >= 0.72 ? easeOut((s - 0.72) / 0.28) : 1;
      hp.set(port[0] + T[0] + SG_HAND[0], port[1] + T[1] + SG_HAND[1], port[2] + T[2] + SG_HAND[2]).lerp(tmp2.set(port[0] + B[0] + SG_HAND[0], port[1] + B[1] + SG_HAND[1], port[2] + B[2] + SG_HAND[2]), back);
    }
    // masuk/keluar fase isi: dari & ke pompa (pose diam)
    const inK = ease(seg(u, 0.03, ev.c0 + 0.04)), outK = ease(seg(u, ev.c1 - 0.01, ev.c1 + 0.06));
    hp.lerp(R, 1 - inK); hp.lerp(R, outK);
    const kk = Math.min(inK, 1 - outK);
    fd.set(AXL[0], AXL[1], AXL[2]).lerp(tmp.set(FD.port[0], FD.port[1], FD.port[2]), kk);
    rl = SG_ROLL * kk;
    let pz = 0;
    if (ev.pump) { const p = seg(u, ev.pump[0], ev.pump[1]); pz = 0.085 * (ease(seg(p, 0, 0.42)) - ease(seg(p, 0.5, 0.92))); hp.z += pz; }
    if (G.pump) G.pump.position.z = G.pumpZ0 + pz * w;
  }
  const SG_BELT = [-0.06, -0.17, 0.12], SG_PRE = [-0.004, -0.045, 0.025], SG_IN = [0, -0.004, 0], SG_TUBE = [0, 0.002, -0.055], SG_HAND = [-0.012, -0.036, 0.036], SG_ROLL = 0.5;
  function animRevolver(G, A, u, w) {
    const ev = A.K.ev;
    if (!G.cyl) return;
    // silinder berayun ke kiri di engsel (bawah-kiri silinder), lalu ditutup & berputar
    const sw = ease(seg(u, ev.open[0], ev.open[1])) * (1 - ease(seg(u, ev.close[0], ev.close[1]))) * w;
    const ang = 1.25 * sw, px = -0.02, py = -0.026; // engsel relatif pusat silinder
    G.cyl.position.set(G.cyl0.x + px - px * Math.cos(ang) + py * Math.sin(ang), G.cyl0.y + py - px * Math.sin(ang) - py * Math.cos(ang), G.cyl0.z);
    G.cyl.quaternion.copy(G.cylQ); G.cyl.rotateZ(ang + (u > ev.close[1] ? easeOut(seg(u, ev.close[1], ev.close[1] + 0.07)) * Math.PI * 1.33 : 0));
    // selongsong kosong jatuh dari belakang silinder (moncong menghadap ke atas)
    const ej = (u - ev.eject) * A.dur;
    spent.visible = w > 0.5 && ej > 0 && ej < 0.45;
    if (spent.visible) {
      if (spent.parent !== G.g) G.g.add(spent);
      spent.position.set(G.cyl.position.x - 0.1 * ej, G.cyl.position.y - 0.03 * ej - 2.2 * ej * ej, G.cyl.position.z + 0.02 + 0.25 * ej + 1.5 * ej * ej);
      spent.rotation.set(-3 * ej, 0, 1.5 * ej);
    }
    // speedloader: dibawa tangan dari bawah, sejajar sumbu silinder di belakangnya, didorong masuk; tangan mengikuti
    const s0 = ev.spl[0], s1 = ev.spl[1];
    spl.visible = w > 0.5 && u > s0 && u < s1;
    if (u > s0 && u < s1 + 0.02) {
      if (spl.parent !== G.g) G.g.add(spl);
      const rz = G.cyl.position.z + 0.023, k1 = ease(seg(u, s0, s1 - 0.08)), k2 = ease(seg(u, s1 - 0.07, s1 - 0.02));
      tmp.set(G.cyl.position.x - 0.03, G.cyl.position.y - 0.12, rz + 0.12).lerp(tmp2.set(G.cyl.position.x, G.cyl.position.y, rz + 0.045), k1);
      tmp.lerp(tmp2.set(G.cyl.position.x, G.cyl.position.y, rz + 0.012), k2);
      spl.position.copy(tmp); spl.quaternion.copy(G.cyl.quaternion);
      const k = ease(seg(u, s0, s0 + 0.05)) * (1 - ease(seg(u, s1 - 0.005, s1 + 0.02)));
      hp.lerp(tmp.add(tmp2.set(-0.004, -0.036, 0.03)), k);
    }
  }
  function animDbs(G, A, u, w) {
    const ev = A.K.ev;
    if (!G.brk) return;
    const open = ease(seg(u, ev.open[0], ev.open[1])) * (1 - easeIn(seg(u, ev.close[0], ev.close[1]))) * w;
    G.brk.quaternion.copy(G.brkQ); G.brk.rotateX(-0.62 * open - 0.05 * Math.sin(seg(u, ev.open[1], ev.open[1] + 0.06) * Math.PI) * w);
    const t = (u - ev.eject) * A.dur;
    for (let i = 0; i < 2; i++) {
      const s = shells[i], x = i ? 0.012 : -0.012;
      if (s.parent !== G.g) G.g.add(s);
      s.visible = false;
      if (w < 0.5) continue;
      if (t > 0 && t < 0.45 && i < ev.n) { // dua selongsong kosong terlontar naik-mundur dari kamar
        tmp.set(x, 0.03, 0.01).applyQuaternion(G.brk.quaternion).add(G.brk.position);
        s.position.set(tmp.x + (0.35 + x * 6) * t, tmp.y + 0.55 * t - 4.9 * t * t, tmp.z + 0.18 * t);
        s.rotation.set(-6 * t, 0, (i ? 1 : -1) * 2.5 * t);
        s.visible = true; continue;
      }
      const sIn = ev.sIn[i]; // selongsong baru: di tangan → sejajar di belakang kamar → masuk
      if (i >= ev.n || u < ev.sHand || u > ev.close[1]) continue;
      s.visible = true;
      if (u < sIn - 0.05) { s.position.copy(hp).add(tmp.set(x * 0.8, 0.03, -0.012)); s.rotation.set(0.5, 0, 0); continue; }
      const k = ease(seg(u, sIn - 0.05, sIn));
      tmp.set(x, 0.03, 0.06 * (1 - k) - 0.024 * k).applyQuaternion(G.brk.quaternion).add(G.brk.position);
      s.position.copy(tmp); s.quaternion.copy(G.brk.quaternion);
      if (u < sIn + 0.01) hp.copy(tmp).sub(tmp2.set(x * 0.8, 0.03, -0.012)); // tangan mendorong selongsong ini
    }
  }
  function endReload(kind) { const G = guns[kind]; if (G) heldPose(G); }
  // ---------- Obat (ruang kamera) ----------
  // Lengan = potongan GLB yang diarahkan (aimArm2): telapak/genggaman di titik kunci, lengan bawah ke siku di luar layar,
  // putaran lengan dari arah barang yang dipegang (sumbu kaleng, jarum, gulungan) atau arah telapak. Senjata turun di awal
  // dan naik lagi tepat di akhir durasi aksi. scr(nx, ny, d): titik ruang kamera dari posisi layar (−1..1) & jarak d (m).
  const scr = (nx, ny, d) => [nx * 0.906 * d, ny * 0.51 * d, -d];
  const PALM = new THREE.Vector3(0, -1, 0), GRIPY = new THREE.Vector3(0, 1, 0), NEEDLE = new THREE.Vector3(0, -1, 0); // sumbu lokal: telapak kiri (ke bawah = telungkup), genggaman kanan
  const OFF_L = scr(-0.75, -1.9, 0.38), OFF_R = scr(0.8, -1.9, 0.36), FOFF_L = [-0.55, -0.8, 0.3], FOFF_R = [0.5, -0.8, 0.35];
  const ARM_P = scr(0.06, -0.36, 0.42), ARM_F = [-0.92, -0.26, 0.29], FR = [0.45, -0.72, 0.55]; // lengan kiri disodorkan melintang
  const DOWN = [0, -1, 0.15], UP = [0, 1, -0.1];
  const HEAL_K = {
    band: { // perban 3,5 dtk: lengan kiri disodorkan, gulungan memutari lengan 3 kali, ujung ditekan, turun
      gun: [0.07, 0.86],
      L: [kP(0, OFF_L), kP(0.04, OFF_L), kP(0.17, ARM_P, 1), kP(0.5, vAdd(ARM_P, 0.004, 0.006, 0)), kP(0.82, ARM_P, 1), kP(0.95, OFF_L)],
      Lf: [kP(0, FOFF_L), kP(0.17, ARM_F), kP(0.82, ARM_F), kP(0.95, FOFF_L)],
      Lt: [kP(0, DOWN), kP(0.17, DOWN), kP(0.5, [0.25, -1, 0.3]), kP(0.82, DOWN), kP(0.95, DOWN)],
      R: [kP(0, OFF_R), kP(0.08, OFF_R), kP(0.2, scr(0.0, -0.1, 0.4)), kP(0.8, scr(-0.05, -0.12, 0.4)), kP(0.86, scr(-0.04, -0.2, 0.4)), kP(0.96, OFF_R)],
      Rf: [kP(0, FOFF_R), kP(0.2, FR), kP(0.86, FR), kP(0.96, FOFF_R)],
      wrap: [0.21, 0.78], tuck: [0.79, 0.85],
    },
    kit: { // P3K 6 dtk: kotak dibuka, suntikan diambil & dijentik, disuntikkan ke lengan kiri, dibuang
      gun: [0.045, 0.9],
      L: [kP(0, OFF_L), kP(0.02, OFF_L), kP(0.12, scr(-0.3, -0.42, 0.42), 1), kP(0.42, scr(-0.28, -0.44, 0.42), 1), kP(0.5, OFF_L, 1), kP(0.53, OFF_L), kP(0.62, ARM_P, 1), kP(0.84, vAdd(ARM_P, 0, 0.004, 0)), kP(0.94, OFF_L)],
      Lf: [kP(0, FOFF_L), kP(0.12, [-0.45, -0.8, 0.4]), kP(0.42, [-0.45, -0.8, 0.4]), kP(0.5, FOFF_L), kP(0.53, FOFF_L), kP(0.62, ARM_F), kP(0.84, ARM_F), kP(0.94, FOFF_L)],
      Lt: [kP(0, UP), kP(0.12, UP), kP(0.42, UP), kP(0.5, DOWN), kP(0.53, UP), kP(0.62, UP), kP(0.84, UP), kP(0.94, UP)],
      R: [kP(0, OFF_R), kP(0.09, OFF_R), kP(0.16, scr(-0.12, -0.12, 0.4)), kP(0.19, scr(-0.15, -0.02, 0.41), 1), kP(0.235, scr(-0.12, -0.0, 0.43)), kP(0.29, scr(-0.22, -0.3, 0.42), 1), kP(0.36, scr(0.12, -0.02, 0.38)), kP(0.41, scr(0.14, 0.02, 0.38), 1), kP(0.44, scr(0.15, 0.0, 0.38)), kP(0.56, scr(0.12, -0.05, 0.4)), kP(0.6, scr(0.0, -0.12, 0.41), 1), kP(0.82, scr(0.0, -0.13, 0.41), 1), kP(0.86, scr(0.12, -0.05, 0.39)), kP(0.94, OFF_R)],
      Rf: [kP(0, FOFF_R), kP(0.16, FR), kP(0.29, FR), kP(0.36, [0.5, -0.75, 0.42]), kP(0.6, [0.4, -0.78, 0.48]), kP(0.86, FR), kP(0.94, FOFF_R)],
      Rt: [kP(0, [-0.6, -0.6, -0.5]), kP(0.29, [-0.6, -0.6, -0.5]), kP(0.36, [-0.75, -0.2, -0.6]), kP(0.44, [-0.75, -0.25, -0.6]), kP(0.56, [-0.4, -0.85, -0.2]), kP(0.6, [-0.25, -0.95, -0.15]), kP(0.82, [-0.25, -0.95, -0.15]), kP(0.88, [0.3, -0.9, 0.2]), kP(0.94, [0.3, -0.9, 0.2])],
      lid: [0.17, 0.235], syr: [0.27, 0.9], inj: [0.6, 0.625, 0.79, 0.82], flick: [0.41, 0.44],
    },
    drink: { // minuman 4 dtk: kaleng diangkat, cincin ditarik tangan kiri, diminum (makin miring), kaleng diturunkan
      gun: [0.06, 0.88],
      L: [kP(0, OFF_L), kP(0.12, OFF_L), kP(0.19, scr(0.16, -0.12, 0.36)), kP(0.215, scr(0.2, -0.08, 0.36), 1), kP(0.24, scr(0.12, -0.04, 0.37)), kP(0.33, OFF_L)],
      Lf: [kP(0, FOFF_L), kP(0.19, [-0.75, -0.45, 0.5]), kP(0.24, [-0.75, -0.45, 0.5]), kP(0.33, FOFF_L)],
      Lt: [kP(0, DOWN), kP(0.19, [0.3, -0.6, -0.7]), kP(0.24, [0.3, -0.6, -0.7]), kP(0.33, DOWN)],
      R: [kP(0, OFF_R), kP(0.03, OFF_R), kP(0.15, scr(0.36, -0.42, 0.38), 1), kP(0.28, scr(0.35, -0.4, 0.38), 1), kP(0.335, [0.1, -0.06, -0.26]), kP(0.39, [0.06, -0.05, -0.21]), kP(0.81, [0.057, -0.044, -0.205]), kP(0.89, OFF_R)],
      Rf: [kP(0, FOFF_R), kP(0.15, FR), kP(0.28, FR), kP(0.335, [0.9, -0.4, -0.1]), kP(0.39, [0.9, -0.4, 0.1]), kP(0.81, [0.9, -0.42, 0.1]), kP(0.89, FOFF_R)],
      Rt: [kP(0, [0, 1, 0]), kP(0.15, [0.05, 1, 0.12]), kP(0.28, [0.05, 1, 0.12]), kP(0.335, [-0.95, 0.1, -0.2]), kP(0.39, [-0.15, -0.6, 0.8]), kP(0.81, [-0.1, -0.85, 0.5]), kP(0.89, [0, 1, 0])],
      tab: 0.215, sip: [0.39, 0.81],
    },
  };
  const hp2 = new THREE.Vector3(), fd2 = new THREE.Vector3(), tg = new THREE.Vector3(), wristL = new THREE.Vector3(), axisL = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3(), endP = new THREE.Vector3();
  const AXOFF = new THREE.Vector3(-0.008, 0.016, 0.005); // titik sumbu lengan baju dekat asal fp_hand_l
  // u 0..1, kind 'band' | 'kit' | 'drink', cancel 0..1 (dibatalkan: lengan turun keluar layar) → seberapa jauh senjata diturunkan
  function animHeal(u, kind, cancel) {
    const H = HEAL_K[kind] || HEAL_K.band;
    const gunDown = easeIn(seg(u, 0, H.gun[0])) * (1 - easeOut(seg(u, H.gun[1], 1))) * (1 - easeOut(cancel));
    const exit = easeIn(cancel) * 0.4; // batal: lengan jatuh keluar layar
    heal.visible = u > 0.01 && u < 0.99 && cancel < 1;
    curve(u, H.L, hp); curve(u, H.Lf, fd); curve(u, H.Lt, tg); hp.y -= exit;
    aimArm2(hArmL, AX_L, hp, fd, PALM, tg);
    curve(u, H.R, hp2); hp2.y -= exit;
    if (H.Rf) curve(u, H.Rf, fd2);
    // sumbu lengan bawah kiri (untuk perban & suntikan): titik pergelangan & dua arah tegak lurus
    axisL.copy(AX_L).applyQuaternion(hArmL.quaternion);
    wristL.copy(AXOFF).applyQuaternion(hArmL.quaternion).add(hArmL.position).addScaledVector(axisL, 0.09);
    n1.crossVectors(axisL, UPV).normalize(); n2.crossVectors(n1, axisL).normalize(); // n2 ≈ atas lengan, n1 ≈ menjauhi kamera
    roll.visible = tail.visible = wrap.visible = kit.visible = syringe.visible = can.visible = false;
    hArmC.visible = false; hArmR.visible = true;
    if (kind === 'band') {
      const wu = seg(u, H.wrap[0], H.wrap[1]), wl = 0.015 + 0.13 * ease(wu), th = wu * Math.PI * 2 * 3;
      const k = ease(seg(u, H.wrap[0] - 0.06, H.wrap[0])) * (1 - ease(seg(u, H.wrap[1], H.tuck[1])));
      // gulungan memutari lengan (atas → depan → bawah → belakang), maju ke arah siku
      endP.copy(wristL).addScaledVector(axisL, 0.02 + wl).addScaledVector(n2, Math.cos(th) * 0.075).addScaledVector(n1, -Math.sin(th) * 0.075);
      hp2.lerp(endP, k);
      if (u > H.tuck[0] && u < H.tuck[1]) hp2.addScaledVector(n2, 0.02 - 0.03 * Math.sin(seg(u, H.tuck[0], H.tuck[1]) * Math.PI)); // ujung ditekan
      aimArm2(hArmR, AX_R, hp2, fd2, GRIPY, axisL); // sumbu gulungan sejajar lengan
      wrap.visible = u > H.wrap[0] && cancel < 1;
      wrap.position.copy(wristL).addScaledVector(axisL, 0.02 + wl / 2);
      wrap.scale.set(0.05, wl, 0.05);
      wrap.quaternion.setFromUnitVectors(UPV, axisL);
      roll.visible = u > 0.05 && u < H.tuck[0] + 0.01;
      roll.scale.setScalar(1 - 0.4 * wu);
      roll.position.set(0, 0, 0); roll.rotation.set(0, th, 0);
      tail.visible = roll.visible && u > H.wrap[0] && u < H.wrap[1] + 0.01;
      if (tail.visible) { // pita dari gulungan ke ujung balutan
        hArmR.updateMatrix();
        tmp.set(0, 0, 0).applyMatrix4(hArmR.matrix);
        endP.copy(wristL).addScaledVector(axisL, 0.02 + wl).addScaledVector(n2, Math.cos(th - 0.6) * 0.05).addScaledVector(n1, -Math.sin(th - 0.6) * 0.05);
        tail.position.copy(tmp).add(endP).multiplyScalar(0.5); tail.scale.set(1, tmp.distanceTo(endP), 1);
        tail.quaternion.setFromUnitVectors(UPV, tmp2.copy(endP).sub(tmp).normalize());
      }
    } else if (kind === 'kit') {
      kit.visible = u < 0.5;
      if (kit.parent !== hArmL) hArmL.add(kit);
      // kotak dipegang di tepi kirinya; orientasi kotak (ruang kamera) tetap: tutup di atas, sedikit menghadap kamera
      _aq.copy(hArmL.quaternion).invert();
      kit.quaternion.copy(_aq).multiply(KIT_Q);
      kit.position.set(kit.userData.w * 0.5 - 0.006, -kit.userData.h * 0.45, 0).applyQuaternion(KIT_Q).applyQuaternion(_aq);
      lid.rotation.x = -1.95 * backOut(seg(u, H.lid[0], H.lid[1])) * (1 - ease(seg(u, 0.44, 0.5)));
      syringe.visible = u > H.syr[0] && u < H.syr[1];
      const i = H.inj, inK = ease(seg(u, i[0], i[1])) * (1 - ease(seg(u, i[2], i[3]))), press = ease(seg(u, i[1] + 0.01, i[2]));
      if (u > i[0] - 0.04 && u < i[3] + 0.02) { // ujung jarum ke sisi dalam lengan kiri (menghadap atas)
        const k = ease(seg(u, i[0] - 0.04, i[0])) * (1 - ease(seg(u, i[3], i[3] + 0.02)));
        endP.copy(wristL).addScaledVector(axisL, 0.06).addScaledVector(n2, 0.04 + 0.04 * (1 - inK));
        hp2.lerp(tmp.copy(endP).addScaledVector(tg.set(0.25, 0.95, 0.15).normalize(), 0.085), k); // genggaman di belakang tabung suntikan
      }
      if (u > H.flick[0] && u < H.flick[1]) hp2.y += 0.006 * Math.sin(seg(u, H.flick[0], H.flick[1]) * Math.PI * 4); // dijentik
      curve(u, H.Rt, tg);
      aimArm2(hArmR, AX_R, hp2, fd2, NEEDLE, tg);
      syringe.position.set(0, 0, 0); syringe.rotation.set(0, 0, 0);
      plunger.position.y = -0.042 * press;
      syringe.userData.liquid.scale.y = Math.max(0.02, 1 - press);
    } else {
      const sip = ease(seg(u, H.sip[0], H.sip[0] + 0.05)) * (1 - ease(seg(u, H.sip[1] - 0.04, H.sip[1])));
      can.visible = u > 0.02 && u < 0.92;
      hp2.y += 0.003 * Math.sin(u * 4 * 2 * Math.PI * 2.1) * sip; // tegukan
      hp2.y -= 0.01 * Math.sin(seg(u, H.tab - 0.01, H.tab + 0.03) * Math.PI); // sentakan saat dibuka
      if (can.parent !== hArmR) hArmR.add(can);
      can.position.set(0, 0, 0); can.rotation.set(0, 0, 0);
      canTab.rotation.x = -1.6 * ease(seg(u, H.tab - 0.015, H.tab + 0.01)) * (1 - 0.6 * ease(seg(u, H.tab + 0.02, H.tab + 0.05)));
      can.userData.hole.visible = u > H.tab;
      curve(u, H.Rt, tg);
      aimArm2(hArmR, AX_R, hp2, fd2, GRIPY, tg);
    }
    return gunDown;
  }
  const KIT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0.35, -0.1));

  // ---------- Pegas (sentakan tembakan, sentakan aksi, mendarat) ----------
  // 0 mundur (m) · 1 dongak (rad) · 2 guling (rad) · 3 naik-turun (m) · 4 dongak lambat (rad)
  const SPK = [380, 260, 300, 190, 150], SPC = [26, 22, 24, 17, 15], spx = new Float32Array(5), spv = new Float32Array(5);
  function springs(dt) {
    const n = dt > 1 / 90 ? Math.ceil(dt * 120) : 1, h = dt / n;
    for (let s = 0; s < n; s++) for (let i = 0; i < 5; i++) { spv[i] += (-SPK[i] * spx[i] - SPC[i] * spv[i]) * h; spx[i] += spv[i] * h; }
  }
  function jolt(y, p) { spv[3] += y; spv[4] += p; } // dorongan aksi: y m/dtk (puncak ±3,5 cm per 1 m/dtk), p rad/dtk
  function onFire(kind) { // sentakan per jenis senjata (membidik: setengah), pompa / slide ikut bergerak
    const r = WEAPONS[kind] ? WEAPONS[kind].recoil : 1, a = 1 - 0.45 * st.ads;
    spv[0] += Math.min(3.2, 1.0 + 0.55 * r) * a;
    spv[1] += Math.min(6, 1.2 + 1.1 * r) * a;
    spv[2] += (Math.random() - 0.5) * (0.6 + 0.4 * r) * a;
    if (kind === 'shotgun') st.pumpT = 0;
    if (kind === 'pistol') st.slideT = 0;
  }

  // ---------- Granat (ruang kamera) ----------
  const NADE_UP = [0.15, -0.12, -0.38], NADE_BACK = [0.22, -0.06, -0.27], NADE_FWD = [0.06, 0.02, -0.58], NADE_END = [-0.08, -0.5, -0.4];
  const NK = { // tahan: naik (0–0,3 dtk), tangan kiri mencabut pin (0,25–0,6), lalu ditarik ke belakang selama ditahan
    hold: [kP(0, [0.3, -0.6, -0.25]), kP(0.12, [0.26, -0.4, -0.3]), kP(0.3, NADE_UP, 1)],
    pinL: [kP(0, [-0.25, -0.6, -0.3]), kP(0.3, [-0.2, -0.45, -0.32]), kP(0.42, [0.115, -0.07, -0.36], 1), kP(0.47, [0.09, -0.06, -0.37], 1), kP(0.56, [-0.06, -0.12, -0.38]), kP(0.72, [-0.3, -0.6, -0.3])],
    // lempar (dari pose tahan): ayun cepat ke depan-atas (granat lepas di awal), lanjut turun ke kiri, keluar layar
    thr: [kP(0, NADE_BACK), kP(0.1, NADE_FWD), kP(0.22, [0.0, -0.18, -0.5]), kP(0.36, NADE_END)],
  };
  const nP = new THREE.Vector3(), nF = new THREE.Vector3(), nHold = new THREE.Vector3().fromArray(NADE_UP);
  function animNade(N, dt) { // → seberapa jauh senjata diturunkan
    N.t += dt;
    let lower;
    nadeRig.visible = true;
    if (N.phase === 'hold') {
      lower = easeIn(seg(N.t, 0, 0.18));
      curve(N.t, NK.hold, nP);
      const wind = ease(seg(N.t, 0.5, 1.1)); // makin lama ditahan makin jauh ditarik
      nP.x += (NADE_BACK[0] - NADE_UP[0]) * wind; nP.y += (NADE_BACK[1] - NADE_UP[1]) * wind; nP.z += (NADE_BACK[2] - NADE_UP[2]) * wind;
      nP.y += Math.sin(st.t * 3) * 0.003;
      nF.set(0.45, -0.75, 0.5).lerp(tmp.set(0.55, -0.45, 0.7), wind);
      aimArm(nArm, AX_N, nP, nF, -0.3 - 0.3 * wind);
      nArmL.visible = N.t < 0.72 && !N.quick;
      if (nArmL.visible) { curve(N.t, NK.pinL, hp2); aimArm(nArmL, AX_L, hp2, tmp.set(-0.55, -0.55, 0.62), 1.3); }
      pinRing.visible = N.t > 0.44 && N.t < 0.72;
      pinRing.position.set(0.0, 0.03, -0.03);
      for (const nk in nadeMesh) nadeMesh[nk].visible = nk === N.kind;
      nHold.copy(nP);
    } else {
      // lempar: mulai dari posisi tangan terakhir saat ditahan
      const t = N.t;
      lower = 1 - backOut(seg(t, 0.24, 0.5));
      curve(t, NK.thr, nP);
      nP.lerp(nHold, 1 - ease(seg(t, 0, 0.1)));
      nF.set(0.55, -0.45, 0.7).lerp(tmp.set(0.2, -0.85, 0.5), ease(seg(t, 0.06, 0.3)));
      aimArm(nArm, AX_N, nP, nF, -0.6 + 1.2 * ease(seg(t, 0.04, 0.2)));
      nArmL.visible = false; pinRing.visible = false;
      for (const nk in nadeMesh) nadeMesh[nk].visible = false; // granat sudah di dunia
      if (t > 0.5) { st.nade = null; nadeRig.visible = false; }
    }
    return lower;
  }
  // periksa senjata (I, 2,6 dtk): diputar memperlihatkan sisi kiri, digulingkan memperlihatkan magasin (ditepuk), kembali
  const IK = {
    rot: [kP(0, Z3), kP(0.16, [0.06, 0.48, 0.18]), kP(0.4, [0.1, 0.56, 0.24]), kP(0.56, [0.16, 0.3, -0.62]), kP(0.72, [0.14, 0.26, -0.7]), kP(0.86, [-0.03, -0.03, 0.05]), kP(1, Z3)],
    pos: [kP(0, Z3), kP(0.16, [-0.05, 0.045, 0.07]), kP(0.4, [-0.055, 0.05, 0.075]), kP(0.56, [-0.05, 0.055, 0.06]), kP(0.72, [-0.05, 0.05, 0.06]), kP(0.86, [0, 0.004, -0.004]), kP(1, Z3)],
  };
  function animInspect(G, kind, u, w) { // w = bobot (dibatalkan tembakan → pudar cepat)
    curve(u, IK.rot, aRot); curve(u, IK.pos, aPos);
    if (w < 1) { aRot.multiplyScalar(w); aPos.multiplyScalar(w); }
    actQ();
    if (!G.handL) return;
    // tangan kiri menepuk magasin di tengah (senjata bermagasin), lainnya tetap di penyangga
    const k = G.mag && G.mag0 && kind !== 'shotgun' ? ease(seg(u, 0.52, 0.6)) * (1 - ease(seg(u, 0.7, 0.8))) * w : 0;
    if (k <= 0) { G.handL.position.copy(G.handL0); G.handL.quaternion.identity(); return; }
    const tap = Math.sin(seg(u, 0.61, 0.67) * Math.PI) * 0.012;
    hp.copy(G.handRest).lerp(tmp.set(G.rp.mg[0], G.rp.mg[1] - tap, G.rp.mg[2]), k);
    fd.set(AXL[0], AXL[1], AXL[2]).lerp(tmp.set(FD.mag[0], FD.mag[1], FD.mag[2]), k);
    if (G.armL) aimArm(G.handL, AX_L, hp, fd, 0.35 * k, qActInv); else G.handL.position.copy(hp);
  }
  for (const k in guns) if (GLB) rigGun(guns[k], k);
  function fadeAct() { // aksi berjalan diganti aksi baru → dipudarkan (isi ulang: pose kembali ke diam; obat: lengan turun)
    const A = st.act;
    if (!A) return;
    if (st.fade && st.fade !== A && st.fade.type === 'reload') endReload(st.fade.kind);
    if (A.type === 'reload') A.cut = true; else A.cancel = Math.max(A.cancel, 0.001);
    st.fade = A; st.act = null;
  }
  const cue = props.cue || null; // bunyi aksi (magasin lepas/masuk, kokang, pompa, …) dari lini waktu animasi
  const mBase = new THREE.Matrix4(), mAct = new THREE.Matrix4(), qBase = new THREE.Quaternion(), eBase = new THREE.Euler(), pBase = new THREE.Vector3();

  return {
    // pantulan lingkungan untuk logam senjata (dipanggil sekali dengan renderer)
    gunRoots: () => Object.values(guns).map((G) => G.g), // grup tiap senjata (untuk game/skins.js applyGunSkin)
    // kompilasi di muka semua program shader view-model (senjata + lengan dengan skin yang sedang dipakai): sekali ke
    // target render (jalur post-processing: linear, tanpa tone mapping) dan sekali ke layar (mode hemat). Senjata yang
    // sedang tidak dipegang dipasang sementara supaya ikut. → tanpa tersendat saat pertama membidik/menembak.
    compile(renderer, rt) {
      const tmp = [];
      for (const k in guns) { const g = guns[k].g; if (g.parent !== root) { root.add(g); tmp.push(g); } }
      for (const n of [heal, nadeRig]) if (n.parent !== root) { root.add(n); tmp.push(n); }
      const prev = renderer.getRenderTarget();
      try {
        if (rt) { renderer.setRenderTarget(rt); renderer.compile(scene, camera); }
        renderer.setRenderTarget(null); renderer.compile(scene, camera);
      } finally { renderer.setRenderTarget(prev); for (const g of tmp) root.remove(g); }
    },
    setEnv(renderer, envTex) { if (envTex) { scene.environment = envTex; return; } const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); },
    // mode realistis: cahaya senjata = cahaya dunia (langit + matahari dari arah sebenarnya, redup bila pemain di tempat teduh)
    setLight(L) { const g = 0.2126 * L.sky.r + 0.7152 * L.sky.g + 0.0722 * L.sky.b; hemiVM.color.copy(L.sky).lerp(new THREE.Color(g, g, g), 0.5); hemiVM.groundColor.copy(L.ground); hemiBase = L.skyI * 1.15; hemiVM.intensity = hemiBase; key.color.copy(L.sun); keyBase = L.sunI; key.intensity = keyBase; worldLit = true; },
    setSun(dirCam, shade, dt) {
      if (!worldLit) return;
      key.position.copy(dirCam);
      keyK += (shade - keyK) * (1 - Math.exp(-dt * 5));
      key.intensity = keyBase * keyK;
      // teduh / dalam ruangan: cahaya langit yang sampai ke senjata & pantulan langit di logam ikut berkurang
      const amb = 0.55 + 0.45 * keyK, envK = 0.4 + 0.6 * keyK;
      hemiVM.intensity = hemiBase * amb;
      if (Math.abs(envK - envNow) > 0.01) { envNow = envK; for (const m of VM_MATS.values()) if (m.userData.env0 !== undefined) m.envMapIntensity = m.userData.env0 * envK; }
    },
    scene, camera, flashTex: flash.material.map,
    // ganti senjata: yang lama turun & disarungkan (0,2 dtk, makin cepat), yang baru naik (0,25 dtk, sedikit lewat lalu diam)
    show(kind) {
      const cur = st.kind;
      if (st.act && st.act.type === 'reload' && kind !== st.act.kind) st.act.cut = true; // isi ulang batal: pose dibekukan selama senjata turun
      if (cur && kind !== cur && guns[cur] && guns[cur].g.visible && !(st.act && st.act.type === 'heal')) { st.prev = cur; st.prevT = 0; }
      else if (st.prev) { endReload(st.prev); guns[st.prev].g.visible = false; st.prev = null; }
      for (const k in guns) guns[k].g.visible = k === (st.prev || kind);
      syncGuns();
      st.kind = kind;
      st.swap = kind && !st.prev ? 1 : 0;
      st.inspect = 0;
    },
    fire() {
      st.kick = 1; st.kickR = (Math.random() - 0.5); st.flashT = 0.045; st.inspect = 0;
      const def = st.kind && WEAPONS[st.kind];
      const C = CASE[st.kind];
      if (C) { if (C.d > 0) { casWait = C.d; casKind = st.kind; } else ejectCasing(st.kind); } // selongsong (pompa/bolt: saat dikokang)
      const Gm = st.kind && guns[st.kind];
      if (Gm && Gm.g.parent) { // asap moncong: naik pelan, melebar, memudar
        Gm.muzzle.getWorldPosition(v);
        const big = FLASH_K[st.kind] > 1.4 ? 2 : 1;
        for (let i = 0; i < big; i++) puffs.emit(v.x, v.y, v.z, (Math.random() - 0.5) * 0.12, 0.1 + Math.random() * 0.14, -0.25 - Math.random() * 0.3, 0.03, 0.14 + Math.random() * 0.08, 0.45 + Math.random() * 0.3, 0.72, 0.72, 0.74, 0.2, 0, 1.6);
      }
      if (def && def.bolt) st.boltT = { t: 0, dur: def.bolt * 0.92 }; // runduk: kokang bolt setelah tiap tembakan
      if (st.kind === 'revolver') st.cylT = 1; // silinder berputar 60°
      onFire(st.kind); // sentakan pegas, pompa, slide
    },
    // isi ulang: sec = durasi di logika game, missing = peluru yang diisi (shotgun: jumlah selongsong). Kosong (magasin 0 dari
    // update terakhir) → magasin dijatuhkan & dikokang; masih ada → magasin dicabut, disimpan, tanpa kokang.
    reload(sec, missing) {
      if (!st.kind) return;
      const G = guns[st.kind];
      if (!G) return;
      if (st.act) { if (st.act.type === 'reload' && st.act.kind === st.kind) endReload(st.act.kind); else fadeAct(); }
      if (st.fade && st.fade.type === 'reload' && st.fade.kind === st.kind) { endReload(st.fade.kind); st.fade = null; }
      heldPose(G);
      const A = st.act = { type: 'reload', kind: st.kind, t: 0, u: 0, w: 1, dur: sec, n: Math.max(1, Math.min(8, missing || 4)), empty: st.mag === 0, cue: 0, cut: false, dropped: false, ejected: false, K: null, offA: G.offA ||= new THREE.Matrix4(), offB: G.offB ||= new THREE.Matrix4() };
      st.boltT = null;
      A.K = reloadKeys(G, st.kind, A);
      if (G.mag && G.mag0 && A.K.hand && A.K.ev.seat !== undefined) { // magasin di tangan: lama (dipegang saat dicabut) & baru (pas saat terpasang)
        if (!A.empty) magOffset(G, A.K, A.K.ev.grab, A.offA);
        magOffset(G, A.K, A.K.ev.seat, A.offB);
        aRot.set(0, 0, 0); actQ();
      }
      st.inspect = 0;
    },
    heal(kind, sec) { fadeAct(); st.act = { type: 'heal', kind, t: 0, u: 0, dur: sec, cancel: 0 }; st.inspect = 0; },
    // granat: genggam (tahan G) → lempar (lepas G) → senjata kembali
    nadeHold(kind) { st.nade = { kind, t: 0, phase: 'hold', quick: false }; st.inspect = 0; },
    nadeThrow() { if (st.nade) { if (st.nade.t < 0.42) st.nade.quick = true; st.nade.phase = 'throw'; st.nade.t = 0; } },
    nadeCancel() { if (st.nade) { st.nade = null; nadeRig.visible = false; st.swap = 1; } }, // senjata naik lagi dari bawah
    inspect() { if (!st.act && st.kind && !st.prev) st.inspect = 1; },
    resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); },
    // o: { dt, ads 0/1, moving 0..1, sprint, mdx, mdy (gerak mouse frame ini), grounded, scoped, reloading, healing, mag }
    update(o) {
      const dt = o.dt, k = (r) => 1 - Math.exp(-dt * r);
      st.t += dt * (1 + o.moving * (o.sprint ? 2.2 : 1.3));
      st.ads += ((o.ads ? 1 : 0) - st.ads) * k(16);
      st.sprint += ((o.sprint ? 1 : 0) - st.sprint) * k(9);
      st.kick = Math.max(0, st.kick - dt * 9);
      st.swap = Math.max(0, st.swap - dt * 4);
      st.swayX += (Math.max(-1, Math.min(1, -o.mdx * 0.02)) - st.swayX) * k(10);
      st.swayY += (Math.max(-1, Math.min(1, o.mdy * 0.02)) - st.swayY) * k(10);
      if (o.grounded && !st.wasGround) jolt(-0.9, -0.6); // mendarat: senjata turun lalu memantul pelan
      st.wasGround = !!o.grounded;
      if (o.mag !== undefined) st.mag = o.mag;
      springs(dt);
      // aksi berjalan: isi ulang / obat. Batal / diganti → pose dibekukan & dipudarkan halus (bukan meloncat ke pose diam)
      const A = st.act;
      if (A) {
        if (A.type === 'reload') {
          if (!A.cut) {
            A.t += dt / A.dur; A.u = Math.min(1, A.t);
            for (const c = A.K.cues; A.cue < c.length && c[A.cue][0] <= A.u; A.cue++) {
              const ck = c[A.cue][1];
              if (cue) cue(ck);
              if (ck === 'in' || ck === 'close') jolt(0.17, 0.5); else if (ck === 'bolt' || ck === 'pump') jolt(0.1, -0.4); else if (ck === 'shell' || ck === 'tap') jolt(0.05, 0.2);
            }
            if (o.reloading === false || A.kind !== st.kind) { if (A.t >= 0.97 && A.kind === st.kind) { endReload(A.kind); st.act = null; } else A.cut = true; }
          }
          if (A.cut) { A.w = Math.max(0, A.w - dt / 0.22); if (A.w <= 0) { endReload(A.kind); if (st.act === A) st.act = null; } }
        } else {
          if (A.cancel <= 0) { A.t += dt / A.dur; A.u = Math.min(1, A.t); }
          if (o.healing === false && A.t < 0.97) A.cancel = Math.min(1, A.cancel + dt / 0.3); // dibatalkan: lengan turun, senjata naik
          if (A.t >= 1 || A.cancel >= 1 || (o.healing === false && A.t >= 0.97)) { st.act = null; heal.visible = false; }
        }
      }
      const F = st.fade; // aksi lama yang diganti aksi baru (mis. isi ulang saat mengobati): dipudarkan
      if (F) {
        if (F.type === 'reload') { F.w = Math.max(0, F.w - dt / 0.22); if (F.w <= 0) { endReload(F.kind); st.fade = null; } }
        else { F.cancel = Math.min(1, F.cancel + dt / 0.3); if (F.cancel >= 1) st.fade = null; }
      }
      const act = st.act;
      let lower = 0; // 0..1 senjata diturunkan keluar layar (obat / granat)
      const hA = act && act.type === 'heal' ? act : F && F.type === 'heal' ? F : null;
      if (hA) lower = animHeal(hA.u, hA.kind, hA.cancel);
      else heal.visible = false;
      if (st.nade) lower = Math.max(lower, animNade(st.nade, dt));
      else nadeRig.visible = false;
      // ganti senjata: yang lama turun dulu
      if (st.prev) {
        st.prevT += dt / 0.2;
        if (st.prevT >= 1) { endReload(st.prev); guns[st.prev].g.visible = false; st.prev = null; if (st.kind && guns[st.kind]) { guns[st.kind].g.visible = true; st.swap = 1; } syncGuns(); }
      }
      const gk = st.prev || st.kind, G = gk && guns[gk];
      if (G) {
        const a = st.ads, bobA = o.moving * (1 - a * 0.85) * (o.grounded ? 1 : 0.2);
        const bx = Math.sin(st.t * 5.2) * 0.011 * bobA, by = -Math.abs(Math.cos(st.t * 5.2)) * 0.012 * bobA;
        const breathe = Math.sin(st.t * 1.4) * 0.0025 * (1 - a * 0.7);
        aPos.set(0, 0, 0); aRot.set(0, 0, 0); qActInv.identity();
        const rA = act && act.type === 'reload' && act.kind === gk ? act : F && F.type === 'reload' && F.kind === gk ? F : null;
        if (rA) animReload(G, gk, rA);
        else if (st.boltT && G.bolt) { st.boltT.t += dt / st.boltT.dur; const bu = Math.min(1, st.boltT.t), s = Math.sin(seg(bu, 0.05, 0.95) * Math.PI); aRot.set(0.07 * s, -0.06 * s, -0.26 * s); aPos.set(-0.012 * s, 0.012 * s, 0); actQ(); boltPose(G, bu); if (st.boltT.t >= 1) { st.boltT = null; heldPose(G); } }
        if (st.cylT > 0 && G.cyl && !rA) { st.cylT = Math.max(0, st.cylT - dt * 6); G.cyl.quaternion.copy(G.cylQ); G.cyl.rotateZ((1 - st.cylT) * Math.PI / 3); }
        const out = st.prev ? easeIn(st.prevT) : 0; // disarungkan: turun makin cepat, miring
        if (st.inspect > 0 && !st.prev && !rA) { st.inspect = Math.max(0, st.inspect - dt / 2.6); st.inspU = 1 - st.inspect; st.inspW = 1; animInspect(G, gk, st.inspU, 1); if (st.inspect <= 0) { st.inspW = 0; heldPose(G); } }
        else if (st.inspW > 0) { st.inspW = rA || st.prev ? 0 : Math.max(0, st.inspW - dt / 0.16); if (st.inspW > 0) animInspect(G, gk, st.inspU, ease(st.inspW)); else heldPose(G); } // dibatalkan
        const scN = (o.att && o.att.scope) | 0;
        if (!st.prev) syncScope(G, gk, scN); // selama ganti senjata, model yang turun masih senjata lama
        const hip = [0.17, -0.2, -0.52], adsP = [-(G.sightX || 0), -SIGHT_Y[gk] - (G.builtin ? (scN ? 0 : -0.006) : scN ? SCOPE_DY : 0), (G.builtin && scN ? -0.3 : -0.36) - (G.sightZ || 0)]; // DMR / runduk tanpa scope: bidik di atas rel
        const sw = st.swap > 0 ? 1 - backOut(1 - st.swap) : 0, low = Math.max(lower, out); // naik: sedikit lewat lalu diam
        const spr = st.sprint * (rA || hA ? 0.35 : 1); // berlari sambil beraksi: pose lari dikurangi
        const ka = 1 - a * 0.4;
        pBase.set(
          hip[0] + (adsP[0] - hip[0]) * a + bx + st.swayX * 0.02 * (1 - a * 0.7) + spr * 0.04 + low * 0.06,
          hip[1] + (adsP[1] - hip[1]) * a + by + breathe + st.swayY * 0.015 * (1 - a * 0.7) - spr * 0.05 - sw * 0.28 - low * 0.42 + spx[3],
          hip[2] + (adsP[2] - hip[2]) * a + spx[0] * ka + low * 0.08,
        );
        qBase.setFromEuler(eBase.set(spx[1] * (1 - a * 0.5) + spx[4] - sw * 0.7 - low * 1.1 - spr * 0.25, spr * 0.75 + st.swayX * 0.06 + sw * 0.25, spx[2] * 0.6 - spr * 0.3 + sw * 0.35 + low * 0.5));
        mBase.compose(pBase, qBase, ONE);
        if (aPos.x || aPos.y || aPos.z || aRot.x || aRot.y || aRot.z) { mBase.multiply(mAct.compose(aPos, qAct, ONE)); mBase.decompose(G.g.position, G.g.quaternion, _v3); }
        else { G.g.position.copy(pBase); G.g.quaternion.copy(qBase); }
        G.g.updateMatrix();
        G.g.visible = low < 0.98;
        if (!rA) { // pompa shotgun mundur-maju setelah menembak (tangan kiri ikut)
          if (G.pump && G.pumpZ0 !== undefined && st.pumpT !== undefined && st.pumpT < 0.6) {
            st.pumpT += dt;
            const pz = 0.085 * (ease(seg(st.pumpT, 0.14, 0.29)) - ease(seg(st.pumpT, 0.33, 0.47)));
            G.pump.position.z = G.pumpZ0 + pz;
            if (G.handL) G.handL.position.z = G.handL0.z + pz;
            if (st.pumpT >= 0.29 && st.pumpT - dt < 0.29) { if (cue) cue('pump'); jolt(0.06, -0.3); }
          }
          if (G.slide) { // slide pistol: mundur saat menembak, terkunci di belakang bila magasin kosong
            st.slideT = st.slideT === undefined ? 1 : st.slideT + dt;
            const back = Math.sin(seg(st.slideT, 0, 0.07) * Math.PI);
            G.slide.position.z = Math.max(st.mag === 0 && gk === st.kind ? 0.022 : 0, back * 0.026);
          }
        }
        updateDrop(dt);
      }
      skinFxTick(dt, G, !!o.scoped); // efek skin: hanya membaca keadaan animasi di atas
      st.flashT -= dt;
      flash.visible = st.flashT > 0 && !o.scoped && !!G;
      flashLight.intensity = flash.visible ? 6 * (1 - 0.6 * st.ads) : 0;
      if (flash.visible) {
        G.muzzle.getWorldPosition(v);
        flash.position.copy(v);
        flash.scale.setScalar((0.13 + Math.random() * 0.09) * (1 - 0.7 * st.ads) * (FLASH_K[st.kind] || 1));
        flash.material.opacity = 1 - 0.55 * st.ads;
        flash.material.rotation = Math.random() * Math.PI;
        flashLight.position.copy(v);
      }
      updateCasings(dt, !!o.scoped);
      puffs.pts.visible = !o.scoped;
      puffs.update(dt);
      // rig obat & granat hanya menempel selama dipakai (simpul tak terlihat pun ditelusuri three.js tiap frame)
      if (heal.visible !== (heal.parent === root)) { if (heal.visible) root.add(heal); else root.remove(heal); }
      if (nadeRig.visible !== (nadeRig.parent === root)) { if (nadeRig.visible) root.add(nadeRig); else root.remove(nadeRig); }
      root.visible = !o.scoped;
    },
    muzzleWorld(out) { // posisi moncong di ruang kamera (untuk pelacak peluru dari senjata)
      const G = st.kind && guns[st.kind];
      if (!G) return out.set(0.15, -0.12, -0.6);
      G.muzzle.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(G.muzzle.matrixWorld);
    },
  };
}

// ---------- Efek di dunia: pelacak peluru, percikan, debu, kilatan moncong bot ----------
// Semua dari kolam tetap (larik bertipe, tanpa alokasi per tembakan) dan hanya 3 draw call:
//   - pita pelacak (quad menghadap layar, aditif, warna HDR → berpendar lewat bloom),
//   - partikel aditif (percikan logam, kilatan moncong bot, inti ledakan; warna HDR),
//   - partikel biasa (kepulan debu/plester, kabut darah, serpihan).
// Ukuran partikel di layar dibatasi (percikan ≤ 22 px, kepulan ≤ 96 px) dan memudar tepat di depan kamera, supaya
// tembakan yang mengenai pemain sendiri tidak pernah menutupi layar.
const PT_VS = `attribute vec4 col; attribute float size; uniform float uH, uMax; varying vec4 vC;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uMax, size * uH * projectionMatrix[1][1] * 0.5 / max(0.05, -mv.z));
  vC = col; vC.a *= smoothstep(0.25, 1.1, -mv.z); }`;
const PT_FS = `uniform float uSoft; varying vec4 vC;
void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = 1.0 - smoothstep(uSoft, 1.0, d); if (a <= 0.003) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }`;
// kolam partikel titik: emit(x,y,z, vx,vy,vz, s0,s1, life, r,g,b,a, grav, drag)
function pointPool(scene, n, additive, soft, maxPx, order) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n), S = new Float32Array(n * 12); // vx vy vz t life s0 s1 a grav drag
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('col', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setDrawRange(0, 0);
  const uni = { uH: { value: 720 }, uMax: { value: maxPx }, uSoft: { value: soft } };
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: uni, vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false;
  pts.renderOrder = order;
  pts.matrixAutoUpdate = false;
  pts.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); uni.uH.value = rt ? rt.height : renderer.domElement.height; }; // tinggi sasaran render → ukuran piksel
  scene.add(pts);
  let m = 0;
  return {
    pts,
    emit(x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a, grav = 0, drag = 0) {
      let i = m;
      if (m >= n) i = (Math.random() * n) | 0; else m++; // penuh: timpa acak
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = a;
      size[i] = s0;
      const k = i * 12;
      S[k] = vx; S[k + 1] = vy; S[k + 2] = vz; S[k + 3] = 0; S[k + 4] = life; S[k + 5] = s0; S[k + 6] = s1; S[k + 7] = a; S[k + 8] = grav; S[k + 9] = drag;
    },
    update(dt) {
      if (!m) { if (geo.drawRange.count) geo.setDrawRange(0, 0); return; }
      for (let i = 0; i < m; i++) {
        const k = i * 12;
        S[k + 3] += dt;
        if (S[k + 3] >= S[k + 4]) { // mati: tukar dengan yang terakhir
          m--;
          if (i < m) {
            const j = m, kj = j * 12;
            pos[i * 3] = pos[j * 3]; pos[i * 3 + 1] = pos[j * 3 + 1]; pos[i * 3 + 2] = pos[j * 3 + 2];
            col[i * 4] = col[j * 4]; col[i * 4 + 1] = col[j * 4 + 1]; col[i * 4 + 2] = col[j * 4 + 2];
            for (let q = 0; q < 12; q++) S[k + q] = S[kj + q];
            i--;
          }
          continue;
        }
        const f = S[k + 3] / S[k + 4], dr = Math.max(0, 1 - S[k + 9] * dt);
        S[k] *= dr; S[k + 1] = S[k + 1] * dr - S[k + 8] * dt; S[k + 2] *= dr;
        pos[i * 3] += S[k] * dt; pos[i * 3 + 1] += S[k + 1] * dt; pos[i * 3 + 2] += S[k + 2] * dt;
        size[i] = S[k + 5] + (S[k + 6] - S[k + 5]) * f;
        col[i * 4 + 3] = S[k + 7] * (additive ? 1 - f * f : f < 0.12 ? f / 0.12 : 1 - (f - 0.12) / 0.88);
      }
      geo.setDrawRange(0, m);
      geo.attributes.position.needsUpdate = geo.attributes.col.needsUpdate = geo.attributes.size.needsUpdate = true;
    },
  };
}
export function createEffects(scene, flashTex) {
  // ----- pita pelacak -----
  const MAXT = 96, tA = new Float32Array(MAXT * 12), tB = new Float32Array(MAXT * 12), tSide = new Float32Array(MAXT * 4), tCol = new Float32Array(MAXT * 12), tIdx = new Uint16Array(MAXT * 6);
  // 4 verteks per pelacak: pangkal (±1) dan ujung (±2). Tanda = arah geser relatif arah pita di verteks itu; karena arah
  // pita terbalik di ujung, tepi yang sama = tanda berlawanan (|side| = 2 menandai ujung) → vS = tepi (−1…+1 melintang pita)
  for (let i = 0; i < MAXT; i++) { tSide.set([1, -1, -2, 2], i * 4); tIdx.set([i * 4, i * 4 + 1, i * 4 + 3, i * 4, i * 4 + 3, i * 4 + 2], i * 6); }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tA, 3));
  tGeo.setAttribute('other', new THREE.BufferAttribute(tB, 3));
  tGeo.setAttribute('side', new THREE.BufferAttribute(tSide, 1));
  tGeo.setAttribute('col', new THREE.BufferAttribute(tCol, 3));
  tGeo.setIndex(new THREE.BufferAttribute(tIdx, 1));
  tGeo.setDrawRange(0, 0);
  const tUni = { uPx: { value: new THREE.Vector2(1 / 1280, 1 / 720) } };
  const tracerMesh = new THREE.Mesh(tGeo, new THREE.ShaderMaterial({
    uniforms: tUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute vec3 other; attribute float side; attribute vec3 col; uniform vec2 uPx; varying vec3 vC; varying float vS;
      void main() { vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0), b = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
        vec2 d = (b.xy / max(abs(b.w), 1e-3) - a.xy / max(abs(a.w), 1e-3)) / uPx; float l = max(length(d), 1e-4); d /= l;
        float sg = sign(side);
        gl_Position = a; gl_Position.xy += vec2(-d.y, d.x) * uPx * (sg * 1.7 * a.w); vC = col; vS = abs(side) > 1.5 ? -sg : sg; }`,
    fragmentShader: 'varying vec3 vC; varying float vS; void main() { float k = 1.0 - vS * vS; gl_FragColor = vec4(vC * k, k); }',
  }));
  tracerMesh.frustumCulled = false;
  tracerMesh.renderOrder = 20;
  tracerMesh.matrixAutoUpdate = false;
  tracerMesh.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); tUni.uPx.value.set(1 / (rt ? rt.width : renderer.domElement.width), 1 / (rt ? rt.height : renderer.domElement.height)); };
  scene.add(tracerMesh);
  const TS = 15, T = new Float32Array(MAXT * TS); // ox oy oz dx dy dz len s bright · kepala rgb · ekor rgb
  let tn = 0;
  // ----- partikel -----
  const spk = pointPool(scene, 512, true, 0.15, 22, 19), puf = pointPool(scene, 320, false, 0.0, 96, 18), fls = pointPool(scene, 48, true, 0.0, 72, 21);
  const rnd = (a, b) => a + Math.random() * (b - a);
  return {
    // mine = tembakan pemain: warna pelacak mengikuti skin senjata yang dipakai (setSkinFx)
    tracer(from, to, bright = 1, mine = false) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.hypot(dx, dy, dz);
      if (len < 2) return;
      const i = (tn < MAXT ? tn++ : (Math.random() * MAXT) | 0) * TS, c = mine && SKIN.tracer;
      T[i] = from.x; T[i + 1] = from.y; T[i + 2] = from.z; T[i + 3] = dx / len; T[i + 4] = dy / len; T[i + 5] = dz / len; T[i + 6] = len; T[i + 7] = 0; T[i + 8] = bright;
      if (c) { T[i + 9] = c[0]; T[i + 10] = c[1]; T[i + 11] = c[2]; T[i + 12] = c[0] * 0.3; T[i + 13] = c[1] * 0.3; T[i + 14] = c[2] * 0.3; }
      else { T[i + 9] = 5.2; T[i + 10] = 4.2; T[i + 11] = 2.2; T[i + 12] = 1.6; T[i + 13] = 1.0; T[i + 14] = 0.3; }
    },
    // kind: 'spark' logam/kendaraan · 'dust' tanah · 'wall' tembok/plester · 'hit' badan
    burst(p, kind = 'dust', n = 10, up = 1) {
      const x = p.x, y = p.y, z = p.z;
      if (kind === 'spark') {
        for (let i = 0; i < n; i++) spk.emit(x, y, z, rnd(-5, 5), rnd(0.5, 5.5) * up, rnd(-5, 5), 0.05, 0.02, rnd(0.14, 0.42), 9, 5.2, 1.6, 1, 11, 1.2);
        fls.emit(x, y, z, 0, 0, 0, 0.32, 0.12, 0.06, 7, 5, 2.4, 1);
        puf.emit(x, y, z, rnd(-0.3, 0.3), rnd(0.2, 0.7), rnd(-0.3, 0.3), 0.14, 0.5, rnd(0.35, 0.6), 0.2, 0.2, 0.21, 0.28, 0, 1.5);
      } else if (kind === 'hit') {
        for (let i = 0; i < Math.min(n, 6); i++) puf.emit(x, y, z, rnd(-1.6, 1.6), rnd(-0.2, 1.8), rnd(-1.6, 1.6), 0.035, 0.02, rnd(0.25, 0.5), 0.34, 0.015, 0.02, 0.9, 9, 0.5);
        puf.emit(x, y, z, rnd(-0.2, 0.2), rnd(0, 0.3), rnd(-0.2, 0.2), 0.1, 0.42, 0.32, 0.36, 0.02, 0.025, 0.5, 0, 2);
      } else {
        const wall = kind === 'wall', r = wall ? 0.74 : 0.62, g = wall ? 0.72 : 0.54, b = wall ? 0.69 : 0.42;
        const k = Math.max(1, Math.round(n / 4));
        for (let i = 0; i < k; i++) puf.emit(x + rnd(-0.06, 0.06), y + rnd(0, 0.08), z + rnd(-0.06, 0.06), rnd(-0.5, 0.5), rnd(0.25, 0.9) * up, rnd(-0.5, 0.5), 0.12, rnd(0.55, 0.95), rnd(0.55, 1.0), r, g, b, 0.42, -0.15, 1.6);
        for (let i = 0; i < Math.min(n, 8); i++) puf.emit(x, y, z, rnd(-2.6, 2.6), rnd(0.6, 3.6) * up, rnd(-2.6, 2.6), 0.03, 0.022, rnd(0.3, 0.6), r * 0.5, g * 0.5, b * 0.5, 1, 9.5, 0.3);
        if (wall && Math.random() < 0.5) spk.emit(x, y, z, rnd(-3, 3), rnd(1, 4), rnd(-3, 3), 0.04, 0.02, rnd(0.1, 0.25), 6, 3.6, 1.2, 1, 11, 1);
      }
    },
    muzzle(p) { // kilatan moncong bot / pemain di kendaraan: inti HDR + pijar jingga
      fls.emit(p.x, p.y, p.z, 0, 0, 0, 0.5, 0.2, 0.05, 9, 6.5, 3, 1);
      fls.emit(p.x, p.y, p.z, 0, 0.4, 0, 0.9, 0.5, 0.07, 2.2, 1.0, 0.25, 0.8);
    },
    flash(p, size = 3, life = 0.12, r = 9, g = 6, b = 3) { fls.emit(p.x, p.y, p.z, 0, 0, 0, size, size * 0.4, life, r, g, b, 1); }, // kilat ledakan
    update(dt) {
      let q = 0;
      for (let i = 0; i < tn; i++) {
        const k = i * TS;
        T[k + 7] += dt * 820;
        if (T[k + 7] - 10 > T[k + 6]) { tn--; if (i < tn) { for (let c = 0; c < TS; c++) T[k + c] = T[tn * TS + c]; i--; } continue; }
        const head = Math.min(T[k + 6], T[k + 7]), tail = Math.max(0, T[k + 7] - 10), br = T[k + 8];
        const ax = T[k] + T[k + 3] * tail, ay = T[k + 1] + T[k + 4] * tail, az = T[k + 2] + T[k + 5] * tail, bx = T[k] + T[k + 3] * head, by = T[k + 1] + T[k + 4] * head, bz = T[k + 2] + T[k + 5] * head;
        const o = q * 12;
        tA[o] = ax; tA[o + 1] = ay; tA[o + 2] = az; tA[o + 3] = ax; tA[o + 4] = ay; tA[o + 5] = az; tA[o + 6] = bx; tA[o + 7] = by; tA[o + 8] = bz; tA[o + 9] = bx; tA[o + 10] = by; tA[o + 11] = bz;
        tB[o] = bx; tB[o + 1] = by; tB[o + 2] = bz; tB[o + 3] = bx; tB[o + 4] = by; tB[o + 5] = bz; tB[o + 6] = ax; tB[o + 7] = ay; tB[o + 8] = az; tB[o + 9] = ax; tB[o + 10] = ay; tB[o + 11] = az;
        for (let c = 0; c < 2; c++) { tCol[o + c * 3] = T[k + 12] * br; tCol[o + c * 3 + 1] = T[k + 13] * br; tCol[o + c * 3 + 2] = T[k + 14] * br; } // ekor redup
        for (let c = 2; c < 4; c++) { tCol[o + c * 3] = T[k + 9] * br; tCol[o + c * 3 + 1] = T[k + 10] * br; tCol[o + c * 3 + 2] = T[k + 11] * br; } // kepala HDR
        q++;
      }
      if (q || tGeo.drawRange.count) {
        tGeo.setDrawRange(0, q * 6);
        tGeo.attributes.position.needsUpdate = tGeo.attributes.other.needsUpdate = tGeo.attributes.col.needsUpdate = true;
      }
      spk.update(dt); puf.update(dt); fls.update(dt);
    },
  };
}

// arah peluru dengan sebaran kerucut (derajat)
export function spreadDir(dir, deg, out) {
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.tan(deg * D2R);
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(u, dir);
  return out.copy(dir).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
}
