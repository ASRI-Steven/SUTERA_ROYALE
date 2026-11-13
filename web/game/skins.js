// Katalog & penerapan skin (karakter + senjata). Dipakai lobi (toko, koleksi) dan game (pemain, rekan regu, senjata).
// Semua motif dihitung di shader (game/skinfx.js) — tanpa tekstur, tanpa unduhan tambahan:
// - Karakter: warna slot pakaian (palet per karakter) + nomor pola `fx` → map/rig.js (tubuh ber-kulit; kerumunan tetap ber-instans).
// - Senjata orang pertama: varian material per skin (game/weapons.js vmSkinned); model dunia (di tangan karakter): material
//   berwarna-verteks dengan pola yang sama.
// Harga menurut kelangkaan: biasa 300, langka 800, epik 1800, legendaris 4000 koin; bawaan 0.
import * as THREE from 'three';
import { buildCharacter } from '../map/rig.js';
import { vmSkinned, setVmArms, gunPreview } from './weapons.js';
import { CHAR_FX, GUN_FX, GUN_SKIN_GLSL } from './skinfx.js';
import { profile } from './profile.js';

export const RARITY = {
  biasa: { label: 'Biasa', color: '#9aa3b2' }, langka: { label: 'Langka', color: '#4da3ff' },
  epik: { label: 'Epik', color: '#b46bff' }, legendaris: { label: 'Legendaris', color: '#f2b233' },
};
const PRICE = { biasa: 300, langka: 800, epik: 1800, legendaris: 4000 };
// pakaian bawaan pemain (sama dengan OUTFIT di game/player.js)
export const DEFAULT_OUTFIT = { shirt: '#503EBA', sleeve: '#503EBA', pants: '#2b2940', skin: '#c68c66', hair: '#231c18', shoes: '#1c1b22', gear: '#4c5340', pack: '#3a3d34', trim: '#D29F52', glove: '#25232c', cuff: '#D29F52', inner: '#d9d5cc' };

// urutan = urutan tampil di toko; indeks 0 = bawaan (harga 0, selalu dimiliki).
// outfit: warna slot (shirt/sleeve/pants/glove/cuff/inner) + perlengkapan (gear = helm & rompi, pack = ransel); fx = pola (skinfx.js)
const C = (id, name, rarity, desc, fx, outfit) => ({ id, name, rarity, price: outfit ? PRICE[rarity] : 0, desc, fx, outfit });
export const CHAR_SKINS = [
  C('char_default', 'Rekrut Sutera', 'biasa', 'Seragam bawaan regu Sutera: ungu dengan manset emas.', 0, null),
  C('char_malam', 'Operator Malam', 'biasa', 'Taktis hitam arang dengan panel pelindung dan garis emas tipis.', CHAR_FX.malam,
    { shirt: '#1b1c20', sleeve: '#1b1c20', pants: '#15161a', glove: '#0e0e11', cuff: '#D29F52', inner: '#2a2b30', gear: '#1f2126', pack: '#17181c' }),
  C('char_kabut', 'Kabut Kota', 'biasa', 'Loreng digital abu-abu untuk bertempur di antara beton dan kaca.', CHAR_FX.kabut,
    { shirt: '#8a8e93', sleeve: '#8a8e93', pants: '#8a8e93', glove: '#3a3d42', cuff: '#5d6167', inner: '#2c2e33', gear: '#6a6e74', pack: '#4b4f55' }),
  C('char_rimba', 'Rimba', 'langka', 'Loreng hutan tropis: hijau lumut, cokelat tanah, dan bayang dedaunan.', CHAR_FX.rimba,
    { shirt: '#4d5c2d', sleeve: '#4d5c2d', pants: '#4d5c2d', glove: '#3b2d1c', cuff: '#2c371c', inner: '#59613a', gear: '#3f4a26', pack: '#3b2d1c' }),
  C('char_merahputih', 'Merah Putih', 'langka', 'Dada merah, badan putih, dan garis merah di sisi celana.', CHAR_FX.merahputih,
    { shirt: '#f2f0ea', sleeve: '#c1121f', pants: '#f2f0ea', glove: '#c1121f', cuff: '#f2f0ea', inner: '#f2f0ea', gear: '#c1121f', pack: '#e9e6de' }),
  C('char_samudra', 'Samudra', 'langka', 'Gradasi biru laut ke toska dengan garis ombak putih.', CHAR_FX.samudra,
    { shirt: '#14607a', sleeve: '#14607a', pants: '#0f3c66', glove: '#0a2452', cuff: '#eaf6f6', inner: '#eaf6f6', gear: '#0f3c66', pack: '#0a2452' }),
  C('char_batik', 'Batik Parang', 'epik', 'Jaket bermotif parang sogan-krem, celana gelap, manset emas.', CHAR_FX.batik,
    { shirt: '#6b3e1e', sleeve: '#6b3e1e', pants: '#231c1a', glove: '#3a2416', cuff: '#D29F52', inner: '#e6d3a3', gear: '#3a2416', pack: '#6b3e1e' }),
  C('char_neon', 'Neon Kota', 'epik', 'Setelan gelap dengan garis cahaya toska dan magenta yang berpendar.', CHAR_FX.neon,
    { shirt: '#0c0d14', sleeve: '#0c0d14', pants: '#0c0d14', glove: '#08080c', cuff: '#22e6ff', inner: '#15161f', gear: '#11121a', pack: '#0c0d14' }),
  C('char_garuda', 'Garuda Emas', 'legendaris', 'Putih upacara berhias bulu garuda emas di bahu dan dada.', CHAR_FX.garuda,
    { shirt: '#f4f1e8', sleeve: '#f4f1e8', pants: '#f4f1e8', glove: '#f4f1e8', cuff: '#e2a93b', inner: '#e2a93b', gear: '#e9e2cf', pack: '#e2a93b' }),
];
const G = (id, name, rarity, desc, fx) => ({ id, name, rarity, price: fx ? PRICE[rarity] : 0, desc, fx });
export const GUN_SKINS = [
  G('gun_default', 'Baja Standar', 'biasa', 'Tampilan pabrik: baja hitam dan polimer.', 0),
  G('gun_karbon', 'Karbon Hitam', 'biasa', 'Anyaman serat karbon mengilap di seluruh badan senjata.', GUN_FX.karbon),
  G('gun_rimba', 'Kamuflase Rimba', 'biasa', 'Cat loreng hutan yang doff, serasi dengan skin Rimba.', GUN_FX.rimba),
  G('gun_senja', 'Senja', 'langka', 'Logam anodis bergradasi jingga, magenta, lalu ungu sepanjang laras.', GUN_FX.senja),
  G('gun_naga', 'Merah Naga', 'langka', 'Sisik naga merah bertepi gelap dengan kilau emas.', GUN_FX.naga),
  G('gun_mendung', 'Batik Mega Mendung', 'langka', 'Awan berlapis biru khas Cirebon di atas biru tua.', GUN_FX.mendung),
  G('gun_es', 'Kristal Es', 'epik', 'Faset es biru dengan retakan putih dan tepi yang berpendar.', GUN_FX.es),
  G('gun_neon', 'Neon Ungu', 'epik', 'Badan gelap dengan kisi segi enam ungu yang menyala.', GUN_FX.neon),
  G('gun_garuda', 'Emas Garuda', 'legendaris', 'Emas berukir bulu garuda, popor berpernis merah tua.', GUN_FX.garuda),
];
const BY = new Map([...CHAR_SKINS, ...GUN_SKINS].map((s) => [s.id, s]));
export const skinById = (id) => BY.get(id) || null;

// ---------- Karakter ----------
// Dua bentuk, satu sumber (warna pakaian & perlengkapan + nomor pola fx; warna kulit & rambut TIDAK pernah ikut skin):
// - charOutfit(id) → { outfit } untuk lobi: ditimpakan di atas pakaian dasar si karakter ({ ...dasar, skin, hair, ...outfit }).
//   null = bawaan / id tak dikenal. (Dibungkus karena palet punya kunci `gear` = warna helm/rompi, yang oleh lobi dibaca
//   sebagai bentuk { outfit, look, gear }.)
// - charPalette(id, base) → palet lengkap siap pakai untuk buildCharacter / setOutfit / crowd.setOutfit: base ditimpa skin;
//   bawaan / id tak dikenal → base itu sendiri.
export function charOutfit(id) {
  const s = BY.get(id);
  return s && s.outfit ? { outfit: { ...s.outfit, fx: s.fx } } : null;
}
export function charPalette(id, base = DEFAULT_OUTFIT) {
  const s = BY.get(id);
  return s && s.outfit ? { ...base, ...s.outfit, fx: s.fx } : base;
}

// ---------- Senjata ----------
// model dunia (warna per verteks, di tangan karakter): satu material per skin; kelas bahan ditebak dari warna verteks
const WORLD_MATS = new Map();
function worldGunMaterial(fx, base) {
  const m0 = WORLD_MATS.get(fx);
  if (m0) { if (base.envMap && m0.envMap !== base.envMap) { m0.envMap = base.envMap; m0.needsUpdate = true; } return m0; } // pantulan langit menyusul (rig.js memasangnya belakangan)
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: base.roughness, metalness: base.metalness, envMap: base.envMap || null, envMapIntensity: base.envMapIntensity });
  m.defines = { SF_GUN: fx };
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vObjP;\nvarying vec3 vObjN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjP = position; vObjN = normal;');
    sh.fragmentShader = 'varying vec3 vObjP;\nvarying vec3 vObjN;\n' + GUN_SKIN_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  float sfMetal = -1.0, sfRough = -1.0; vec3 sfEmis = vec3(0.0);
  { vec3 c0 = diffuseColor.rgb; float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b)), sat = (mx - mn) / max(mx, 1e-3);
    int cls = (sat > 0.45 && c0.r > c0.b * 1.8 && mx > 0.2) ? 9 : ((sat > 0.3 && c0.r > c0.b * 1.3) ? 5 : (mx < 0.02 ? 3 : 1)); // aksen emas / kayu / karet / logam
    sfGun(cls, vObjP, normalize(vObjN), 1.0, c0, sfMetal, sfRough, sfEmis); diffuseColor.rgb = c0; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (sfRough >= 0.0) roughnessFactor = sfRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  if (sfMetal >= 0.0) metalnessFactor = sfMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += sfEmis;');
  };
  m.customProgramCacheKey = () => 'sfworld';
  WORLD_MATS.set(fx, m);
  return m;
}
// Terapkan skin senjata ke Object3D senjata mana pun: grup senjata orang pertama (vm.gunRoots()), hasil gunPreview(), atau
// mesh model dunia (bagian 'gun_<jenis>' karakter). Aman dipanggil berulang; 'gun_default' / id tak dikenal = tampilan asli.
// Catatan: kaca bidikan, titik bidik, tangan & lengan tidak disentuh.
export function applyGunSkin(root, id) {
  if (!root) return root;
  const s = BY.get(id), fx = s && s.fx ? s.fx : 0;
  const walk = (o) => {
    if (o !== root && /^fp_/.test(o.name)) return; // tangan & lengan orang pertama (fp_hand_*, fp_forearm) ikut skin karakter, bukan skin senjata
    if (o.isMesh && !o.isSkinnedMesh && o.material && !Array.isArray(o.material)) {
      const base = o.userData.sfBase || o.material;
      if (base.userData && base.userData.vmL) { o.userData.sfBase = base; o.material = fx ? vmSkinned(base, fx) : base; } // material orang pertama
      else if (base.isMeshStandardMaterial && base.vertexColors && !base.map && o.geometry.attributes.color && !o.isInstancedMesh) {
        o.userData.sfBase = base;
        o.material = fx ? worldGunMaterial(fx, base) : base;
      }
    }
    for (const ch of o.children) walk(ch);
  };
  walk(root);
  return root;
}

// ---------- Di dalam game ----------
// Pasang skin yang sedang dipakai (profile.equipped) ke pemain: tubuh orang ketiga, lengan orang pertama, semua senjata.
// char = hasil buildCharacter; vm = hasil createViewModel; base = pakaian bawaan pemain. Dipanggil saat pertandingan mulai.
export function applyEquipped(char, vm, base = DEFAULT_OUTFIT) {
  const cid = profile.equipped && profile.equipped.character, gid = profile.equipped && profile.equipped.weapon;
  const o = charPalette(cid, base);
  if (char && char.setOutfit) char.setOutfit(o);
  setVmArms(o === base ? {} : { sleeve: o.sleeve || o.shirt, glove: o.glove, cuff: o.cuff, fx: o.fx });
  if (vm && vm.gunRoots) for (const g of vm.gunRoots()) applyGunSkin(g, gid);
  if (char && char.parts) for (const k in char.parts) if (k.startsWith('gun_')) for (const m of char.parts[k]) applyGunSkin(m, gid);
}

// ---------- Pratinjau ----------
// Objek 3D siap pakai untuk lobi/toko. previewCharacter: { root, rig, char } berpose diam; previewWeapon: grup senjata.
export function previewCharacter(id, look = { variant: 'm1', hair: 0 }, gear = { pack: false, hair: true }) {
  const char = buildCharacter(charPalette(id), gear, look);
  const st = { speed: 0 };
  for (let i = 0; i < 12; i++) char.rig.pose(st, 0.1);
  return { root: char.root, rig: char.rig, char };
}
export function previewWeapon(kind = 'ar', id = 'gun_default') { const g = gunPreview(kind); return g ? applyGunSkin(g, id) : null; }

// Gambar pratinjau (data URL, latar transparan), dirender sekali dengan renderer game lalu di-cache. initSkins() harus sudah
// dipanggil (main.js); sebelum itu hasilnya ''. Karakter: tiga perempat badan; senjata: senapan tampak tiga perempat.
let R0 = null, ENV = null, SCENE = null, CAM = null, TS = null, TCAM = null, RT = null, PCHAR = null, CV = null, CV2 = null;
const THUMBS = new Map();
let chain = Promise.resolve();
// renderer & langit (env) game; scene & camera dunia = tempat karakter digambar (untuk kompilasi shader di muka)
export function initSkins(renderer, env = null, scene = null, camera = null) { R0 = renderer; ENV = env; SCENE = scene; CAM = camera; }
function thumbScene() {
  if (TS) return;
  TS = new THREE.Scene();
  TS.environment = ENV;
  TS.add(new THREE.HemisphereLight(0xffffff, 0x4a4866, 1.6)); // jenis & jumlah lampu = adegan senjata orang pertama → program shader dipakai ulang
  const key = new THREE.DirectionalLight(0xfff2dd, 2.9);
  key.position.set(1.4, 2.2, 2.4);
  const rim = new THREE.PointLight(0x9db8ff, 14, 0, 2);
  rim.position.set(-1.6, 1.9, -1.8);
  TS.add(key, rim);
  TCAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 30);
}
function shoot(obj, S, frame) {
  thumbScene();
  if (!RT || RT.width !== S) { if (RT) RT.dispose(); RT = new THREE.WebGLRenderTarget(S, S, { depthBuffer: true }); }
  TS.add(obj);
  obj.updateMatrixWorld(true);
  frame(TCAM);
  TCAM.updateProjectionMatrix();
  const prevRT = R0.getRenderTarget(), prevAuto = R0.autoClear, cc = R0.getClearColor(new THREE.Color()), ca = R0.getClearAlpha();
  R0.setRenderTarget(RT); R0.setClearColor(0x000000, 0); R0.autoClear = true;
  R0.render(TS, TCAM);
  const px = new Uint8Array(S * S * 4);
  R0.readRenderTargetPixels(RT, 0, 0, S, S, px);
  R0.setRenderTarget(prevRT); R0.setClearColor(cc, ca); R0.autoClear = prevAuto;
  TS.remove(obj);
  // linear → sRGB + balik vertikal
  CV = CV || document.createElement('canvas');
  CV.width = CV.height = S;
  const g = CV.getContext('2d'), im = g.createImageData(S, S), d = im.data;
  for (let y = 0; y < S; y++) {
    const src = (S - 1 - y) * S * 4, dst = y * S * 4;
    for (let x = 0; x < S * 4; x += 4) {
      d[dst + x] = 255 * Math.pow(px[src + x] / 255, 1 / 2.2); d[dst + x + 1] = 255 * Math.pow(px[src + x + 1] / 255, 1 / 2.2);
      d[dst + x + 2] = 255 * Math.pow(px[src + x + 2] / 255, 1 / 2.2); d[dst + x + 3] = px[src + x + 3];
    }
  }
  g.putImageData(im, 0, 0);
  return CV;
}
function renderThumb(id, size) {
  const s = BY.get(id);
  if (!s || !R0) return '';
  const S = size * 2;
  let cv;
  if (id.startsWith('char_')) {
    if (!PCHAR) PCHAR = previewCharacter('char_default');
    PCHAR.char.setOutfit(charPalette(id));
    PCHAR.root.rotation.y = -0.5;
    cv = shoot(PCHAR.root, S, (cam) => { // lutut sampai kepala, sedikit dari atas
      cam.position.set(0.25, 1.4, 4); cam.lookAt(0, 1.27, 0);
      Object.assign(cam, { left: -0.54, right: 0.54, top: 0.54, bottom: -0.54 });
    });
  } else {
    const gun = previewWeapon('ar', id);
    if (!gun) return '';
    const hold = new THREE.Group();
    hold.add(gun);
    hold.rotation.set(0.42, 0, 0); // laras naik: komposisi diagonal mengisi bingkai persegi
    cv = shoot(hold, S, (cam) => {
      const bb = new THREE.Box3().setFromObject(hold), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      const dir = new THREE.Vector3(1, 0.22, -0.45).normalize(), h = Math.max(sz.y, sz.z * 0.92) * 0.41;
      cam.position.copy(c).addScaledVector(dir, 5); cam.up.set(0, 1, 0); cam.lookAt(c);
      Object.assign(cam, { left: -h, right: h, top: h, bottom: -h });
    });
  }
  CV2 = CV2 || document.createElement('canvas');
  CV2.width = CV2.height = size;
  const g2 = CV2.getContext('2d');
  g2.clearRect(0, 0, size, size);
  g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
  g2.drawImage(cv, 0, 0, S, S, 0, 0, size, size);
  let url = CV2.toDataURL('image/webp', 0.92);
  if (!url.startsWith('data:image/webp')) url = CV2.toDataURL('image/png');
  return url;
}
export function skinThumb(id, size = 256) {
  const key = id + '@' + size;
  if (THUMBS.has(key)) return Promise.resolve(THUMBS.get(key));
  // satu per satu dengan jeda (tidak menahan frame); gagal → '' dan boleh dicoba lagi nanti
  const p = chain.then(() => new Promise((res) => setTimeout(() => {
    if (THUMBS.has(key)) { res(THUMBS.get(key)); return; }
    let url = '';
    try { url = renderThumb(id, size); } catch (e) { console.warn('Pratinjau skin gagal:', id, e.message); }
    if (url) THUMBS.set(key, url);
    res(url);
  }, 12)));
  chain = p;
  return p;
}
