// Barang di tanah: senjata, peluru, perban/P3K, rompi & helm (level 1–3), dan peti jarahan dari yang tersingkir.
// Ditaruh di sekeliling gedung (gedung belum punya interior) dan di trotoar. Satu InstancedMesh per jenis barang.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS, NADES, AMMO_CAP, gunGeometry, ATTACH, magCap } from './weapons.js';

// ---------- Model barang & parasut dari Blender (tools/blender, props.glb), opsional ----------
// Satu mesh berwarna verteks per barang, asal di dasar tengah (parasut: asal di titik gantung, kanopi di atas).
let PROPS = null;
export async function loadPropModels(base = 'game/assets/props/') {
  const g = await new GLTFLoader().loadAsync(base + 'props.glb');
  g.scene.updateMatrixWorld(true);
  PROPS = g.scene;
  return PROPS;
}
export function propGeometry(name) { // geometri (posisi/normal/warna RGB) atau null
  const o = PROPS && PROPS.getObjectByName(name);
  if (!o) return null;
  const geos = [], inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
  o.traverse((m) => {
    if (!m.isMesh) return;
    let g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count, c = g.attributes.color, rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c ? c.getX(i) : 1; rgb[i * 3 + 1] = c ? c.getY(i) : 1; rgb[i * 3 + 2] = c ? c.getZ(i) : 1; }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    geos.push(g);
  });
  return geos.length ? (geos.length > 1 ? mergeGeometries(geos) : geos[0]) : null;
}
const PROP_OF = { a_light: 'ammo_light', a_rifle: 'ammo_rifle', a_shell: 'ammo_shell', h_band: 'band', h_kit: 'kit', v1: 'vest1', v2: 'vest2', v3: 'vest3', m1: 'helmet1', m2: 'helmet2', m3: 'helmet3', crate: 'crate' };

const M = 0.1, CELL = 24;
export const ITEMS = {
  w_pistol: { kind: 'weapon', w: 'pistol', rar: 0 }, w_smg: { kind: 'weapon', w: 'smg', rar: 1 }, w_shotgun: { kind: 'weapon', w: 'shotgun', rar: 1 },
  w_ar: { kind: 'weapon', w: 'ar', rar: 2 }, w_dmr: { kind: 'weapon', w: 'dmr', rar: 3 },
  w_sniper: { kind: 'weapon', w: 'sniper', rar: 3 }, w_lmg: { kind: 'weapon', w: 'lmg', rar: 3 }, w_revolver: { kind: 'weapon', w: 'revolver', rar: 1 },
  w_burst: { kind: 'weapon', w: 'burst', rar: 2 }, w_pdw: { kind: 'weapon', w: 'pdw', rar: 1 }, w_dbs: { kind: 'weapon', w: 'dbs', rar: 2 },
  a_sniper: { kind: 'ammo', ammo: 'sniper', n: 10, rar: 2, name: 'Peluru runduk ×10' }, a_magnum: { kind: 'ammo', ammo: 'magnum', n: 18, rar: 0, name: 'Peluru magnum ×18' },
  g_frag: { kind: 'nade', nade: 'frag', rar: 2, name: 'Granat' }, g_smoke: { kind: 'nade', nade: 'smoke', rar: 1, name: 'Granat asap' },
  a_light: { kind: 'ammo', ammo: 'light', n: 30, rar: 0, name: 'Peluru ringan ×30' }, a_rifle: { kind: 'ammo', ammo: 'rifle', n: 30, rar: 0, name: 'Peluru senapan ×30' },
  a_shell: { kind: 'ammo', ammo: 'shell', n: 10, rar: 0, name: 'Peluru shotgun ×10' },
  h_band: { kind: 'heal', heal: 'band', rar: 0, name: 'Perban' }, h_kit: { kind: 'heal', heal: 'kit', rar: 2, name: 'Kotak P3K' },
  h_drink: { kind: 'heal', heal: 'drink', rar: 1, name: 'Minuman energi' }, // menambah tenaga: darah naik pelan-pelan sampai 100 (hanya pemain)
  v1: { kind: 'vest', lvl: 1, rar: 0, name: 'Rompi lv.1' }, v2: { kind: 'vest', lvl: 2, rar: 1, name: 'Rompi lv.2' }, v3: { kind: 'vest', lvl: 3, rar: 3, name: 'Rompi lv.3' },
  m1: { kind: 'helmet', lvl: 1, rar: 0, name: 'Helm lv.1' }, m2: { kind: 'helmet', lvl: 2, rar: 1, name: 'Helm lv.2' }, m3: { kind: 'helmet', lvl: 3, rar: 3, name: 'Helm lv.3' },
  b1: { kind: 'bag', lvl: 1, rar: 0, name: 'Tas lv.1' }, b2: { kind: 'bag', lvl: 2, rar: 1, name: 'Tas lv.2' }, b3: { kind: 'bag', lvl: 3, rar: 3, name: 'Tas lv.3' },
  x_mag: { kind: 'att', att: 'mag', rar: 1, name: 'Magasin panjang' }, x_s2: { kind: 'att', att: 's2', rar: 1, name: 'Scope 2×' }, x_s4: { kind: 'att', att: 's4', rar: 2, name: 'Scope 4×' }, // aksesori senjata
  jerry: { kind: 'fuel', rar: 1, name: 'Jeriken bensin' }, // isi bensin kendaraan (B) · di tanah: meledak setelah kena 3 peluru
  crate: { kind: 'crate', rar: 2, name: 'Peti jarahan' },
};
for (const [k, v] of Object.entries(ITEMS)) if (v.kind === 'weapon') v.name = WEAPONS[v.w].name;
export const TIER = { pistol: 1, revolver: 1.5, shotgun: 2, dbs: 2, smg: 2, pdw: 2.2, ar: 3, burst: 3, lmg: 3.2, dmr: 3, sniper: 3.6 };
export const NADE_CAP = 3;
// ---------- Tas pemain: kapasitas menurut bobot ----------
// Yang masuk tas: peluru, penyembuh, granat. Senjata, rompi, helm, dan tas itu sendiri dipakai di badan (tidak berbobot).
// Kapasitas: tanpa tas 100, tas lv.1 200, lv.2 300, lv.3 400. Bot tidak memakai sistem ini (tetap batas per jenis).
export const BAG_CAP = [100, 200, 300, 400];
export const ITEM_W = { ammo: { light: 0.4, rifle: 0.5, shell: 1.2, sniper: 1.5, magnum: 0.8 }, heal: { band: 2, kit: 10, drink: 4 }, nade: { frag: 12, smoke: 10 }, fuel: 15 };
export function bagWeight(a) {
  let w = 0;
  for (const k of Object.keys(a.ammo || {})) w += (a.ammo[k] || 0) * (ITEM_W.ammo[k] || 0.5);
  for (const k of Object.keys(a.heals || {})) w += (a.heals[k] || 0) * (ITEM_W.heal[k] || 2);
  for (const k of Object.keys(a.nades || {})) w += (a.nades[k] || 0) * (ITEM_W.nade[k] || 10);
  w += (a.fuel || 0) * ITEM_W.fuel;
  return w;
}
export const bagCap = (a) => BAG_CAP[Math.max(0, Math.min(3, a.bag | 0))];
// berapa buah barang berbobot w yang masih muat (toleransi pembulatan)
const bagFit = (a, w) => Math.max(0, Math.floor((bagCap(a) - bagWeight(a)) / w + 1e-6));
const RAR = ['#ffffff', '#5aa9ff', '#a58bff', '#ffcf6b'];

function colored(list) {
  return mergeGeometries(list.map(([g, hex]) => {
    const x = g.index ? g.toNonIndexed() : g;
    x.deleteAttribute('uv');
    const c = new THREE.Color(hex), n = x.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    x.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return x;
  }));
}
export function itemGeometry(type) { return itemGeo(type); } // geometri baru tiap panggilan (ikon panel loot)
function itemGeo(type) {
  const it = ITEMS[type];
  if (PROP_OF[type]) { const g = propGeometry(PROP_OF[type]); if (g) return g; } // model Blender (instans diperbesar 1,5× supaya mudah terlihat, sama seperti model lama)
  if (it.kind === 'weapon') return gunGeometry(it.w).scale(1.25, 1.25, 1.25).rotateZ(Math.PI / 2).translate(0, 0.045, 0);
  const box = (w, h, d, y = h / 2, x = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  if (it.kind === 'ammo') { const c = { light: '#c9a227', rifle: '#5f8f3a', shell: '#b0342b', sniper: '#3a3f2c', magnum: '#8a5a2a' }[it.ammo]; return colored([[box(0.24, 0.13, 0.16), c], [box(0.245, 0.03, 0.165, 0.1), it.ammo === 'sniper' ? '#D29F52' : '#2a2a2a']]); }
  if (it.kind === 'nade') return gunGeometry(it.nade).scale(1.6, 1.6, 1.6).rotateX(Math.PI / 2).translate(0, 0.055, 0); // granat Blender, rebah
  if (type === 'h_band') return colored([[new THREE.CylinderGeometry(0.06, 0.06, 0.1, 14).rotateZ(Math.PI / 2).translate(0, 0.06, 0), '#efe6d6'], [new THREE.CylinderGeometry(0.03, 0.03, 0.102, 10).rotateZ(Math.PI / 2).translate(0, 0.06, 0), '#c8bda8']]);
  if (type === 'x_mag') return colored([[box(0.07, 0.3, 0.12), '#33363d'], [box(0.075, 0.03, 0.125, 0.3), '#c9a24a'], [box(0.072, 0.02, 0.122, 0.1), '#1d1d1f']]);
  if (type === 'x_s2' || type === 'x_s4') { const L = type === 'x_s4' ? 0.34 : 0.2, c = type === 'x_s4' ? '#26282d' : '#3a3d45';
    return colored([[new THREE.CylinderGeometry(0.035, 0.035, L, 14).rotateZ(Math.PI / 2).translate(0, 0.09, 0), c], [new THREE.CylinderGeometry(0.048, 0.04, 0.07, 14).rotateZ(Math.PI / 2).translate(L / 2, 0.09, 0), c], [new THREE.CylinderGeometry(0.044, 0.044, 0.012, 14).rotateZ(Math.PI / 2).translate(L / 2 + 0.036, 0.09, 0), '#58b6e8'], [box(0.1, 0.05, 0.04, 0.0), '#1d1d1f']]); }
  if (type === 'jerry') return colored([[box(0.3, 0.36, 0.14), '#b5332a'], [box(0.31, 0.03, 0.145, 0.19), '#7d211b'], [box(0.12, 0.05, 0.04, 0.385, -0.04), '#2a2a2e'], [new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10).translate(0.1, 0.39, 0), '#e0c040']]);
  if (type === 'h_drink') return colored([[new THREE.CylinderGeometry(0.045, 0.045, 0.17, 14).translate(0, 0.085, 0), '#2f7fd6'], [new THREE.CylinderGeometry(0.046, 0.046, 0.05, 14).translate(0, 0.085, 0), '#f2c14e'], [new THREE.CylinderGeometry(0.04, 0.045, 0.012, 14).translate(0, 0.176, 0), '#d9dde3']]);
  if (type === 'h_kit') return colored([[box(0.34, 0.14, 0.24), '#2f9b5a'], [box(0.18, 0.012, 0.05, 0.146), '#ffffff'], [box(0.05, 0.012, 0.18, 0.146), '#ffffff']]);
  if (it.kind === 'vest') { const c = ['#c9b48a', '#66704a', '#2f3136'][it.lvl - 1]; return colored([[box(0.46, 0.09, 0.5), c], [box(0.46, 0.02, 0.06, 0.1, 0, 0.12), '#1d1d1f'], [box(0.12, 0.03, 0.12, 0.11, 0.1, -0.08), '#1d1d1f']]); }
  if (it.kind === 'bag') { const c = ['#c9b48a', '#66704a', '#2f3136'][it.lvl - 1], k = 0.82 + it.lvl * 0.09; return colored([[box(0.34 * k, 0.4 * k, 0.2 * k), c], [box(0.26 * k, 0.16 * k, 0.07 * k, 0.11 * k, 0, 0.13 * k), '#1d1d1f'], [box(0.36 * k, 0.05 * k, 0.21 * k, 0.375 * k), '#D29F52'], [box(0.05 * k, 0.3 * k, 0.03 * k, 0.2 * k, 0.1 * k, -0.11 * k), '#1d1d1f'], [box(0.05 * k, 0.3 * k, 0.03 * k, 0.2 * k, -0.1 * k, -0.11 * k), '#1d1d1f']]); }
  if (it.kind === 'helmet') { const c = ['#c9b48a', '#66704a', '#2f3136'][it.lvl - 1]; return colored([[new THREE.SphereGeometry(0.15, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.55), c], [new THREE.TorusGeometry(0.145, 0.012, 6, 18).rotateX(Math.PI / 2).translate(0, 0.02, 0), '#1d1d1f']]); }
  return colored([[box(0.62, 0.42, 0.46), '#3D3782'], [box(0.63, 0.06, 0.47, 0.3), '#D29F52'], [box(0.08, 0.43, 0.47, 0.21, 0.2), '#D29F52'], [box(0.08, 0.43, 0.47, 0.21, -0.2), '#D29F52']]);
}
function ringTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 6, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,.55)'); gr.addColorStop(0.7, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export function createLoot(scene, { D, col }) {
  // Hanya barang dalam radius VIS dari kamera yang digambar (± ribuan dari >20.000 barang; model Blender ±250 segitiga).
  // Instans dijaga rapat (count = jumlah barang terlihat) supaya GPU tidak menggambar slot kosong.
  const types = Object.keys(ITEMS), CAP = 2400, RCAP = 9000, VIS = 120;
  const mats = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = {};
  for (const t of types) {
    const im = new THREE.InstancedMesh(itemGeo(t).scale(1.5, 1.5, 1.5), mats, CAP); // sedikit diperbesar supaya mudah terlihat
    im.count = 0;
    im.frustumCulled = false;
    scene.add(im);
    meshes[t] = im;
  }
  const rings = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: ringTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 }), RCAP);
  rings.setColorAt(0, new THREE.Color('#ffffff'));
  rings.count = 0;
  rings.frustumCulled = false;
  rings.renderOrder = 6;
  scene.add(rings);
  const items = [], grid = new Map(), cans = []; // cans: jeriken bensin yang masih ada di tanah (dicek tiap tembakan)
  const key = (x, y) => (Math.floor(x / CELL) + 2048) * 4096 + (Math.floor(y / CELL) + 2048);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  // isi ulang instans dengan barang hidup dalam radius VIS dari (x, y)
  let visX = 1e9, visY = 1e9, dirty = true, lastRefresh = -1;
  const cnt = {};
  function refresh(x, y) {
    visX = x; visY = y; dirty = false;
    for (const t of types) cnt[t] = 0;
    let rc = 0;
    near(x, y, VIS, (it) => {
      const n = cnt[it.type];
      if (n < CAP) { meshes[it.type].setMatrixAt(n, m4.compose(p.set(it.x, it.z + 0.14, -it.y), q.setFromAxisAngle(UP, it.rot), s.set(1, 1, 1))); cnt[it.type] = n + 1; }
      if (rc < RCAP) { rings.setMatrixAt(rc, m4.compose(p.set(it.x, it.z + 0.16, -it.y), q.identity(), s.setScalar(it.def.rar >= 2 ? 1.35 : 1))); rings.setColorAt(rc, c.set(RAR[it.def.rar])); rc++; }
    });
    for (const t of types) { meshes[t].count = cnt[t]; meshes[t].instanceMatrix.needsUpdate = true; }
    rings.count = rc;
    rings.instanceMatrix.needsUpdate = true;
    rings.instanceColor.needsUpdate = true;
  }
  const touch = (x, y) => { if (Math.hypot(x - visX, y - visY) < VIS + 2) dirty = true; };
  function add(type, x, y, extra = {}) {
    const it = { id: items.length, type, def: ITEMS[type], x, y, z: 0, rot: Math.random() * Math.PI * 2, alive: true, ...extra }; // z = tinggi lantai
    items.push(it);
    if (type === 'jerry') cans.push(it);
    const k = key(x, y);
    (grid.get(k) || grid.set(k, []).get(k)).push(it);
    touch(x, y);
    return it;
  }
  function remove(it) {
    if (!it.alive) return;
    it.alive = false;
    if (it.type === 'jerry') { const ci = cans.indexOf(it); if (ci >= 0) cans.splice(ci, 1); }
    const arr = grid.get(key(it.x, it.y));
    if (arr) arr.splice(arr.indexOf(it), 1);
    touch(it.x, it.y);
  }
  function near(x, y, r, fn) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
        const arr = grid.get((cx + 2048) * 4096 + (cy + 2048));
        if (arr) for (const it of arr) if (it.alive && Math.hypot(it.x - x, it.y - y) <= r) fn(it);
      }
  }
  const pick = (table) => { let r = Math.random() * table.reduce((a, b) => a + b[1], 0); for (const [t, w] of table) { r -= w; if (r <= 0) return t; } return table[0][0]; };
  const TABLE = [
    ['w_pistol', 9], ['w_smg', 7], ['w_shotgun', 6], ['w_ar', 6], ['w_dmr', 2],
    ['w_revolver', 3.5], ['w_pdw', 4], ['w_dbs', 3], ['w_burst', 3], ['w_lmg', 1.2], ['w_sniper', 0.7],
    ['a_magnum', 3], ['a_sniper', 1.6], ['g_frag', 4], ['g_smoke', 3],
    ['a_light', 11], ['a_rifle', 11], ['a_shell', 6], ['h_band', 12], ['h_kit', 4], ['h_drink', 8],
    ['v1', 6], ['v2', 4], ['v3', 1.2], ['m1', 6], ['m2', 4], ['m3', 1.2],
    ['b1', 7], ['b2', 4], ['b3', 1.5], ['jerry', 5], ['x_mag', 5], ['x_s2', 4], ['x_s4', 2],
  ];
  const AMMO_FOR = { pistol: 'a_light', smg: 'a_light', shotgun: 'a_shell', ar: 'a_rifle', dmr: 'a_rifle', sniper: 'a_sniper', lmg: 'a_rifle', revolver: 'a_magnum', burst: 'a_rifle', pdw: 'a_light', dbs: 'a_shell' };
  function spot(x, y) { const f = col.findFree(x, y, 6, 0.35); return f; }
  function insideSpot(H, up = false) { // titik acak di dalam ruang gedung, tidak di perabot/dinding → [x, y, z]; up = lantai 2
    const lv = up && H.up ? H.up.floor : 0;
    for (let t = 0; t < 14; t++) {
      const room = H.rooms[Math.random() * H.rooms.length | 0];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of room) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      let ins = false;
      for (let a = 0, b = room.length - 1; a < room.length; b = a++) { const xi = room[a][0], yi = room[a][1], xj = room[b][0], yj = room[b][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
      if (ins && !col.blocked(x, y, 0.45, lv) && (!lv || Math.abs(col.floorAt(x, y, lv) - lv) < 0.1)) return [x, y, lv];
    }
    return null;
  }
  function scatter(mult = 1, homes = null) {
    const B = D.buildings;
    for (let i = 0; i < B.r.length; i++) {
      const k = B.k[i], r = B.r[i], n = r.length >> 1;
      if (n < 3 || k === 5) continue;
      const H = homes && homes.get(i);
      const base = H ? (H.kind === 'hall' ? Math.min(130, H.area / 190) : H.kind === 'shop' ? 1.2 + H.rooms.length * 0.9 : 0.75 + Math.min(1.5, H.area / 160) + (H.up ? 0.8 : 0)) * mult : k === 0 ? 0.32 * mult : (k === 2 ? 2 + (Math.random() * 3 | 0) : k === 4 ? 1 + (Math.random() * 2 | 0) : 1 + (Math.random() * 3 | 0)) * mult;
      const cnt = Math.floor(base) + (Math.random() < base % 1 ? 1 : 0);
      for (let j = 0; j < cnt; j++) {
        if (H && Math.random() < (H.kind ? 0.9 : 0.75)) { // di dalam gedung (rumah 2 lantai: sebagian di lantai atas)
          const sp = insideSpot(H, !!H.up && Math.random() < 0.45);
          if (sp) {
            const type = pick(TABLE);
            add(type, sp[0], sp[1], { z: sp[2] });
            if (ITEMS[type].kind === 'weapon' && Math.random() < 0.85) { const s2 = insideSpot(H, sp[2] > 0); if (s2) add(AMMO_FOR[ITEMS[type].w], s2[0], s2[1], { z: s2[2] }); }
            continue;
          }
        }
        const e = Math.random() * n | 0, e2 = (e + 1) % n, t = Math.random();
        const ax = r[e * 2] * M, ay = r[e * 2 + 1] * M, bx = r[e2 * 2] * M, by = r[e2 * 2 + 1] * M;
        const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey) || 1, px = ax + ex * t, py = ay + ey * t;
        let x = px + ey / L * 1.3, y = py - ex / L * 1.3;
        if (col.blocked(x, y, 0.3)) { x = px - ey / L * 1.3; y = py + ex / L * 1.3; }
        if (col.blocked(x, y, 0.3)) continue;
        const type = pick(TABLE);
        add(type, x, y);
        if (ITEMS[type].kind === 'weapon' && Math.random() < 0.85) { const sp = spot(x + 0.7, y + 0.4); if (sp) add(AMMO_FOR[ITEMS[type].w], sp[0], sp[1]); }
      }
    }
  }
  return {
    items, cans, add, remove, near, AMMO_FOR,
    scatter,
    crate(x, y, contents, z = 0) { if (z > 0.5) return add('crate', x, y, { contents, z }); const sp = col.findFree(x, y, 8, 0.4) || [x, y]; return add('crate', sp[0], sp[1], { contents }); }, // z: mati di lantai atas
    // pulsa cincin cahaya barang; barang yang digambar diperbarui saat kamera pindah > 10 m atau barang di dekatnya berubah
    update(t, cam) {
      rings.material.opacity = 0.75 + Math.sin(t * 3) * 0.25;
      if (cam && t - lastRefresh > 0.15 && (dirty || Math.hypot(cam.x - visX, -cam.z - visY) > 10)) { lastRefresh = t; refresh(cam.x, -cam.z); }
    },
  };
}

// ---------- Inventaris (dipakai pemain & bot) ----------
// Daya tahan pelindung: tiap peluru yang ditahan mengurangi daya tahan sebesar kerusakan mentahnya; habis → hancur.
// agent.vestHp / agent.helmetHp (undefined = masih utuh); barang di tanah: it.hp; peti: contents.vestHp / helmetHp.
export const ARMOR_HP = { vest: [0, 200, 220, 250], helmet: [0, 80, 150, 230] };
export const armorMax = (kind, lvl) => ARMOR_HP[kind][lvl] || 0;
export const armorHp = (a, kind) => (a[kind] ? a[kind + 'Hp'] ?? armorMax(kind, a[kind]) : 0);
export const armorPct = (kind, lvl, hp) => (lvl ? Math.max(1, Math.round((hp ?? armorMax(kind, lvl)) / armorMax(kind, lvl) * 100)) : 0);
const armorText = (kind, lvl, hp) => (kind === 'vest' ? 'Rompi lv.' : 'Helm lv.') + lvl + (armorPct(kind, lvl, hp) < 100 ? ' (' + armorPct(kind, lvl, hp) + '%)' : '');
export { armorText };
// agent: { weapons [slot0, slot1, pistol], cur, ammo {light,rifle,shell}, heals {band,kit}, vest, helmet }
// opt.replaceSlot: slot yang diganti kalau dua slot utama penuh (pemain = senjata di tangan; bot = yang tier-nya lebih rendah)
export function giveWeapon(agent, kind, opt = {}) {
  const w = WEAPONS[kind], inst = { kind, mag: w.mag }; // opt.mag / opt.att: isi magasin & aksesori senjata yang dibuang pemain
  if (opt.att) inst.att = { ...opt.att };
  if (opt.mag != null) inst.mag = Math.min(opt.mag, magCap(inst));
  if (w.slot === 2) {
    const old = agent.weapons[2];
    if (old && opt.bot && TIER[old.kind] >= TIER[kind]) return null;
    agent.weapons[2] = inst;
    return { slot: 2, dropped: old };
  }
  for (const s of [0, 1]) if (!agent.weapons[s]) { agent.weapons[s] = inst; return { slot: s, dropped: null }; }
  let s = opt.replaceSlot;
  if (s !== 0 && s !== 1) s = TIER[agent.weapons[0].kind] <= TIER[agent.weapons[1].kind] ? 0 : 1;
  if (opt.bot && TIER[agent.weapons[s].kind] >= TIER[kind]) return null;
  const old = agent.weapons[s];
  agent.weapons[s] = inst;
  return { slot: s, dropped: old };
}
export function applyItem(agent, it, opt = {}) { // → teks hasil atau null kalau tidak diambil
  const d = it.def;
  if (d.kind === 'weapon') { const r = giveWeapon(agent, d.w, it.mag != null ? { ...opt, mag: it.mag, att: it.att } : opt); return r ? { text: d.name, slot: r.slot, dropped: r.dropped } : null; }
  if (agent.isPlayer) { // pemain: dibatasi bobot tas, bukan jumlah per jenis
    if (d.kind === 'ammo') { // ambil sebanyak yang muat; sisanya tetap di tanah
      const n = it.n || d.n, take = Math.min(n, bagFit(agent, ITEM_W.ammo[d.ammo] || 0.5)), base = d.name.replace(/ ×\d+$/, '');
      if (take <= 0) return null;
      agent.ammo[d.ammo] = (agent.ammo[d.ammo] || 0) + take;
      if (take < n) { it.n = n - take; it.name = base + ' ×' + it.n; return { text: base + ' ×' + take, keep: true }; }
      return { text: it.name || d.name };
    }
    if (d.kind === 'nade') { agent.nades ||= {}; if (bagFit(agent, ITEM_W.nade[d.nade] || 10) < 1) return null; agent.nades[d.nade] = (agent.nades[d.nade] || 0) + 1; return { text: d.name }; }
    if (d.kind === 'heal') { if (bagFit(agent, ITEM_W.heal[d.heal] || 2) < 1) return null; agent.heals[d.heal] = (agent.heals[d.heal] || 0) + 1; return { text: d.name }; }
    if (d.kind === 'bag') { const old = agent.bag | 0; if (old >= d.lvl) return null; agent.bag = d.lvl; return { text: d.name, swap: old ? { type: 'b' + old } : null }; } // tas lama jatuh ke tanah
    if (d.kind === 'att') { // aksesori: langsung terpasang ke senjata yang cocok (yang dipegang dulu); scope lama yang tergantikan jatuh ke tanah
      const A = ATTACH[d.att], order = opt.attSlot != null ? [opt.attSlot] : [agent.cur, 0, 1, 2].filter((s, i, arr) => s >= 0 && arr.indexOf(s) === i); // opt.attSlot: diseret ke senjata tertentu
      for (const s of order) {
        const wi = agent.weapons[s];
        if (!wi || !A.fits.includes(wi.kind)) continue;
        const at = wi.att || (wi.att = {});
        if (A.scope) { if ((at.scope | 0) >= A.scope) continue; const old = at.scope; at.scope = A.scope; return { text: d.name + ' → ' + WEAPONS[wi.kind].short, swap: old ? { type: 'x_s' + old } : null }; }
        if (at.mag) continue;
        at.mag = true;
        return { text: d.name + ' → ' + WEAPONS[wi.kind].short };
      }
      return null;
    }
    if (d.kind === 'fuel') { if (bagFit(agent, ITEM_W.fuel) < 1) return null; agent.fuel = (agent.fuel || 0) + 1; return { text: d.name }; }
  }
  if (d.kind === 'bag' || d.kind === 'fuel' || d.kind === 'att') return null; // bot tidak memakai tas / jeriken / aksesori
  if (d.kind === 'ammo') { agent.ammo[d.ammo] = Math.min(AMMO_CAP[d.ammo] || 300, (agent.ammo[d.ammo] || 0) + (it.n || d.n)); return { text: it.name || d.name }; } // it.n / it.name: peluru yang dibuang pemain (jumlah bisa kurang dari satu pak)
  if (d.kind === 'nade') { agent.nades ||= {}; if ((agent.nades[d.nade] || 0) >= NADE_CAP) return null; agent.nades[d.nade] = (agent.nades[d.nade] || 0) + 1; return { text: d.name }; }
  if (d.kind === 'heal') {
    if (d.heal === 'drink') return null; // bot tidak memakai minuman energi
    const cap = d.heal === 'kit' ? 3 : 10;
    if (agent.heals[d.heal] >= cap) return null;
    agent.heals[d.heal]++;
    return { text: d.name };
  }
  if (d.kind === 'vest' || d.kind === 'helmet') {
    // ambil kalau tingkatnya lebih tinggi, atau setingkat tapi lebih utuh; yang lama jatuh ke tanah dengan sisa daya tahannya
    const k = d.kind, hp = it.hp ?? armorMax(k, d.lvl), cur = agent[k] | 0, curHp = armorHp(agent, k);
    if (cur > d.lvl || (cur === d.lvl && curHp >= hp)) return null;
    agent[k] = d.lvl; agent[k + 'Hp'] = hp;
    return { text: armorText(k, d.lvl, hp), swap: cur ? { type: (k === 'vest' ? 'v' : 'm') + cur, hp: curHp } : null };
  }
  if (d.kind === 'crate') {
    const c = it.contents, got = [];
    for (const k of Object.keys(AMMO_TXT)) if (c.ammo[k]) { agent.ammo[k] = Math.min(AMMO_CAP[k] || 300, (agent.ammo[k] || 0) + c.ammo[k]); got.push(AMMO_TXT[k]); c.ammo[k] = 0; }
    if (c.nades) for (const k of Object.keys(NADES)) while (c.nades[k] > 0 && (agent.nades[k] || 0) < NADE_CAP) { agent.nades[k] = (agent.nades[k] || 0) + 1; c.nades[k]--; got.push(NADES[k].short.toLowerCase()); }
    for (const k of ['band', 'kit']) while (c.heals[k] > 0 && agent.heals[k] < (k === 'kit' ? 3 : 10)) { agent.heals[k]++; c.heals[k]--; got.push(k === 'kit' ? 'P3K' : 'perban'); }
    if (c.vest > agent.vest) { agent.vest = c.vest; agent.vestHp = c.vestHp; got.push('rompi lv.' + c.vest); }
    if (c.helmet > agent.helmet) { agent.helmet = c.helmet; agent.helmetHp = c.helmetHp; got.push('helm lv.' + c.helmet); }
    c.weapons = c.weapons.filter((wk) => {
      const empty = WEAPONS[wk].slot === 2 ? !agent.weapons[2] : !agent.weapons[0] || !agent.weapons[1];
      const better = WEAPONS[wk].slot !== 2 && agent.weapons[0] && agent.weapons[1] && Math.min(TIER[agent.weapons[0].kind], TIER[agent.weapons[1].kind]) < TIER[wk];
      if (!empty && !better) return true;
      giveWeapon(agent, wk, { bot: true });
      got.push(WEAPONS[wk].short);
      return false;
    });
    return got.length ? { text: 'Dari peti: ' + [...new Set(got)].join(', '), keep: c.weapons.length > 0 } : null;
  }
  return null;
}
const AMMO_TXT = { light: 'peluru ringan', rifle: 'peluru senapan', shell: 'peluru shotgun', sniper: 'peluru runduk', magnum: 'peluru magnum' };
// Peti jarahan untuk pemain (seperti PUBG): isi ditampilkan sebagai daftar, diambil satu per satu.
export function crateEntries(c) {
  const L = [];
  c.weapons.forEach((wk) => L.push({ t: 'weapon', k: wk, text: WEAPONS[wk].name }));
  for (const k of Object.keys(AMMO_TXT)) if (c.ammo[k] > 0) L.push({ t: 'ammo', k, text: AMMO_TXT[k][0].toUpperCase() + AMMO_TXT[k].slice(1) + ' ×' + c.ammo[k] });
  if (c.nades) for (const k of Object.keys(NADES)) if (c.nades[k] > 0) L.push({ t: 'nade', k, text: NADES[k].name + ' ×' + c.nades[k] });
  for (const k of ['band', 'kit', 'drink']) if (c.heals[k] > 0) L.push({ t: 'heal', k, text: (k === 'kit' ? 'P3K' : k === 'drink' ? 'Minuman energi' : 'Perban') + ' ×' + c.heals[k] });
  if (c.vest) L.push({ t: 'vest', k: c.vest, text: armorText('vest', c.vest, c.vestHp) });
  if (c.helmet) L.push({ t: 'helmet', k: c.helmet, text: armorText('helmet', c.helmet, c.helmetHp) });
  if (c.bag) L.push({ t: 'bag', k: c.bag, text: 'Tas lv.' + c.bag });
  if (c.fuel > 0) L.push({ t: 'fuel', k: 'jerry', text: 'Jeriken bensin ×' + c.fuel });
  return L;
}
// ambil satu baris isi peti → { text, slot, dropped } atau null (tas penuh / sudah lebih baik); rompi/helm ditukar
export function takeCrateEntry(agent, c, e, opt = {}) {
  if (e.t === 'weapon') { const r = giveWeapon(agent, e.k, opt); if (!r) return null; c.weapons.splice(c.weapons.indexOf(e.k), 1); return { text: WEAPONS[e.k].name, slot: r.slot, dropped: r.dropped }; }
  if (agent.isPlayer && (e.t === 'ammo' || e.t === 'nade' || e.t === 'heal')) { // pemain: sebanyak yang muat di tas (bobot)
    const src = e.t === 'ammo' ? c.ammo : e.t === 'nade' ? c.nades : c.heals, dst = e.t === 'ammo' ? agent.ammo : e.t === 'nade' ? (agent.nades ||= {}) : agent.heals;
    const n = Math.min(bagFit(agent, ITEM_W[e.t][e.k] || 1), src[e.k] || 0);
    if (n <= 0) return null;
    dst[e.k] = (dst[e.k] || 0) + n; src[e.k] -= n;
    return { text: (e.t === 'ammo' ? AMMO_TXT[e.k] : e.t === 'nade' ? NADES[e.k].name.toLowerCase() : e.k === 'kit' ? 'P3K' : e.k === 'drink' ? 'minuman energi' : 'perban') + ' ×' + n };
  }
  if (e.t === 'fuel') { if (!agent.isPlayer) return null; const n = Math.min(bagFit(agent, ITEM_W.fuel), c.fuel || 0); if (n <= 0) return null; agent.fuel = (agent.fuel || 0) + n; c.fuel -= n; return { text: 'jeriken bensin ×' + n }; }
  if (e.t === 'bag') { if (!agent.isPlayer || (agent.bag | 0) >= c.bag) return null; const old = agent.bag | 0; agent.bag = c.bag; c.bag = old; return { text: 'tas lv.' + agent.bag }; }
  if (e.t === 'ammo') { const n = Math.min((AMMO_CAP[e.k] || 300) - (agent.ammo[e.k] || 0), c.ammo[e.k]); if (n <= 0) return null; agent.ammo[e.k] = (agent.ammo[e.k] || 0) + n; c.ammo[e.k] -= n; return { text: AMMO_TXT[e.k] + ' ×' + n }; }
  if (e.t === 'nade') { const n = Math.min(NADE_CAP - (agent.nades[e.k] || 0), c.nades[e.k]); if (n <= 0) return null; agent.nades[e.k] = (agent.nades[e.k] || 0) + n; c.nades[e.k] -= n; return { text: NADES[e.k].name.toLowerCase() + ' ×' + n }; }
  if (e.t === 'heal') { const n = Math.min((e.k === 'kit' ? 3 : 10) - agent.heals[e.k], c.heals[e.k]); if (n <= 0) return null; agent.heals[e.k] += n; c.heals[e.k] -= n; return { text: (e.k === 'kit' ? 'P3K' : 'perban') + ' ×' + n }; }
  if (e.t === 'vest' || e.t === 'helmet') { // tukar dengan isi peti (yang lama, beserta sisa daya tahannya, masuk ke peti)
    const k = e.t, h = k + 'Hp', cHp = c[h] ?? armorMax(k, c[k]), old = agent[k] | 0, oldHp = armorHp(agent, k);
    if (old > c[k] || (old === c[k] && oldHp >= cHp)) return null;
    agent[k] = c[k]; agent[h] = cHp; c[k] = old; c[h] = old ? oldHp : undefined;
    return { text: armorText(k, agent[k], cHp).toLowerCase() };
  }
  return null;
}
export const crateEmpty = (c) => !c.weapons.length && !Object.values(c.ammo).some((v) => v > 0) && !(c.nades && Object.values(c.nades).some((v) => v > 0)) && !c.heals.band && !c.heals.kit && !c.heals.drink && !c.vest && !c.helmet && !c.bag && !c.fuel;
