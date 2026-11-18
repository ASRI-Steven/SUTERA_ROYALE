// Karakter low-poly bersendi (pinggul, lutut, pergelangan, bahu, siku) + animasi prosedural:
// diam (napas), jalan, lari, mundur/menyamping, jongkok, lompat, terjun bebas, payung, membidik, menembak, kena tembak, mati,
// duduk mengemudi (mobil / motor, tangan ikut setir), isi ulang, mengobati, ganti senjata, tiarap & merayap.
// Satu definisi untuk dua pemakaian:
//   buildCharacter(outfit) → satu karakter: avatar jelajah, pemain orang ketiga.
//   createCrowd(scene, n)   → kerumunan (bot), digambar ber-instans.
// Dua jenis model di atas kerangka yang sama:
//   v3 (game): tubuh ber-kulit (skinned) + LOD dari tools/blender/characters3.py — lihat "Karakter v3" di akhir berkas;
//   v2 (halaman peta & cadangan bila aset v3 gagal dimuat): bagian kaku per tulang (prosedural / person.glb).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHAR_SKIN_GLSL, SF_U } from '../game/skinfx.js';

const PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- Tulang ----------
function makeBones() {
  const b = {};
  const add = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); b[parent].add(o); b[name] = o; return o; };
  b.root = new THREE.Object3D();
  add('hips', 'root', 0, 0.98, 0);
  add('spine', 'hips', 0, 0.1, 0);
  add('chest', 'spine', 0, 0.2, 0);
  add('neck', 'chest', 0, 0.27, 0);
  add('head', 'neck', 0, 0.07, 0);
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) { // menghadap +Z: kiri = +X
    add('arm' + k, 'chest', 0.2 * s, 0.21, 0);
    add('fore' + k, 'arm' + k, 0, -0.28, 0);
    add('hand' + k, 'fore' + k, 0, -0.25, 0);
    add('thigh' + k, 'hips', 0.1 * s, -0.05, 0);
    add('shin' + k, 'thigh' + k, 0, -0.43, 0);
    add('foot' + k, 'shin' + k, 0, -0.42, 0);
  }
  add('gun', 'chest', -0.13, 0.06, 0.24);
  return b;
}

// ---------- Geometri bagian tubuh (offset dari sendi sudah "dipanggang") ----------
const tint = (g, hex) => { // warna per verteks (dikali warna instans): putih = ikut warna pakaian, lain = detail
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.index) g = g.toNonIndexed();
  return g;
};
const merge = (list) => mergeGeometries(list.map(([g, hex]) => { const x = g.index ? g.toNonIndexed() : g; x.deleteAttribute('uv'); return tint(x, hex); }));
function rifleGeo() {
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const cyl = (r, l, x, y, z) => new THREE.CylinderGeometry(r, r, l, 8).rotateX(PI / 2).translate(x, y, z);
  return merge([
    [box(0.055, 0.09, 0.4, 0, 0, 0.05), '#2c2f36'], // badan senjata
    [cyl(0.016, 0.34, 0, 0.018, 0.42), '#1d1f24'], // laras
    [box(0.06, 0.05, 0.2, 0, 0.012, 0.32), '#3a3d45'], // pelindung tangan
    [box(0.045, 0.1, 0.2, 0, -0.012, -0.24), '#2c2f36'], // popor
    [box(0.04, 0.14, 0.06, 0, -0.1, 0.11).rotateX(0.25), '#1d1f24'], // magasin
    [box(0.035, 0.09, 0.04, 0, -0.08, -0.04).rotateX(-0.3), '#1d1f24'], // gagang
    [box(0.03, 0.035, 0.09, 0, 0.065, 0.04), '#D29F52'], // bidikan (aksen emas)
  ]);
}
function partDefs() {
  const cap = (r, l, y, seg = 8) => new THREE.CapsuleGeometry(r, l, 4, seg).translate(0, y, 0);
  const head = merge([
    [new THREE.SphereGeometry(0.115, 18, 12).scale(0.92, 1.05, 1).translate(0, 0.1, 0), '#ffffff'],
    [new THREE.BoxGeometry(0.028, 0.022, 0.012).translate(0.042, 0.115, 0.104), '#1b1a22'], // mata
    [new THREE.BoxGeometry(0.028, 0.022, 0.012).translate(-0.042, 0.115, 0.104), '#1b1a22'],
    [new THREE.BoxGeometry(0.06, 0.012, 0.01).translate(0, 0.058, 0.104), '#8a4f3d'], // mulut
    [new THREE.BoxGeometry(0.03, 0.04, 0.03).translate(0, 0.09, 0.115), '#ffffff'], // hidung
  ]);
  const chest = merge([
    [new THREE.CylinderGeometry(0.2, 0.155, 0.32, 12).scale(1.05, 1, 0.66).translate(0, 0.14, 0), '#ffffff'],
    [new THREE.SphereGeometry(0.078, 10, 8).translate(0.19, 0.22, 0), '#ffffff'],
    [new THREE.SphereGeometry(0.078, 10, 8).translate(-0.19, 0.22, 0), '#ffffff'],
    [new THREE.CylinderGeometry(0.09, 0.1, 0.05, 10).scale(1, 1, 0.8).translate(0, 0.3, 0), '#e8e4dc'], // kerah
  ]);
  const capHat = merge([
    [new THREE.SphereGeometry(0.124, 16, 8, 0, PI * 2, 0, PI / 2).translate(0, 0.13, 0), '#3D3782'],
    [new THREE.CylinderGeometry(0.126, 0.126, 0.028, 16, 1, true).translate(0, 0.142, 0), '#D29F52'],
    [new THREE.CylinderGeometry(0.13, 0.13, 0.014, 16, 1, false, -PI / 2, PI).translate(0, 0.135, 0.055), '#2e2a6a'],
  ]);
  const helmet = merge([
    [new THREE.SphereGeometry(0.142, 16, 9, 0, PI * 2, 0, PI * 0.56).translate(0, 0.115, -0.005), '#ffffff'],
    [new THREE.TorusGeometry(0.138, 0.012, 6, 18).rotateX(PI / 2).translate(0, 0.085, -0.005), '#c9c9c0'],
  ]);
  const vest = merge([
    [new THREE.CylinderGeometry(0.212, 0.172, 0.27, 12).scale(1.06, 1, 0.75).translate(0, 0.13, 0), '#ffffff'],
    [new THREE.BoxGeometry(0.1, 0.07, 0.05).translate(-0.08, 0.1, 0.13), '#d9d6cc'], // kantong
    [new THREE.BoxGeometry(0.1, 0.07, 0.05).translate(0.08, 0.1, 0.13), '#d9d6cc'],
  ]);
  const stripe = new THREE.CylinderGeometry(0.205, 0.19, 0.035, 14, 1, true).scale(1.05, 1, 0.68).translate(0, 0.12, 0);
  const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, ...o });
  return [
    { bones: ['hips'], geo: new THREE.CylinderGeometry(0.155, 0.165, 0.22, 12).scale(1, 1, 0.72).translate(0, -0.02, 0), color: 'pants' },
    { bones: ['spine'], geo: new THREE.CylinderGeometry(0.152, 0.152, 0.22, 12).scale(1, 1, 0.7).translate(0, 0.1, 0), color: 'shirt' },
    { bones: ['chest'], geo: chest, color: 'shirt', vc: true },
    { bones: ['neck'], geo: new THREE.CylinderGeometry(0.05, 0.056, 0.11, 8).translate(0, 0.03, 0), color: 'skin' },
    { bones: ['head'], geo: head, color: 'skin', vc: true },
    { bones: ['head'], geo: new THREE.SphereGeometry(0.122, 14, 8, 0, PI * 2, 0, PI * 0.42).translate(0, 0.105, -0.012), color: 'hair', gear: 'hair' },
    { bones: ['armL', 'armR'], geo: cap(0.057, 0.17, -0.135), color: 'shirt' },
    { bones: ['foreL', 'foreR'], geo: cap(0.048, 0.16, -0.12), color: 'sleeve' },
    { bones: ['handL', 'handR'], geo: new THREE.BoxGeometry(0.07, 0.1, 0.045).translate(0, -0.05, 0.005), color: 'skin' },
    { bones: ['thighL', 'thighR'], geo: cap(0.08, 0.27, -0.215, 10), color: 'pants' },
    { bones: ['shinL', 'shinR'], geo: cap(0.063, 0.29, -0.21, 10), color: 'pants' },
    { bones: ['footL', 'footR'], geo: new THREE.BoxGeometry(0.105, 0.075, 0.25).translate(0, -0.045, 0.045), color: 'shoes' },
    { bones: ['gun'], geo: rifleGeo(), gear: 'gun', vc: true, fixed: true },
    { bones: ['head'], geo: helmet, color: 'gear', gear: 'helmet', vc: true },
    { bones: ['head'], geo: capHat, gear: 'cap', vc: true, fixed: true },
    { bones: ['chest'], geo: vest, color: 'gear', gear: 'vest', vc: true },
    { bones: ['chest'], geo: stripe, color: 'trim', gear: 'stripe' },
    { bones: ['chest'], geo: new THREE.BoxGeometry(0.29, 0.36, 0.15).translate(0, 0.1, -0.2), color: 'pack', gear: 'pack' },
  ].map((d) => ({ ...d, mat: lam(d.vc ? {} : { vertexColors: false }) }));
}

// ---------- IK lengan dua tulang (bahu → siku engsel → telapak), dipakai supaya tangan menempel di senjata ----------
const _S = new THREE.Vector3(), _u = new THREE.Vector3(), _h = new THREE.Vector3(), _w = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _mb = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _pole = new THREE.Vector3(), _t = new THREE.Vector3();
// ua/fa: tulang lengan atas (anak dada) & lengan bawah (engsel sumbu X). target & pole dalam ruang dada. w = bobot campur.
function solveArm(ua, fa, target, pole, w, A = 0.28, B = 0.3) {
  _S.copy(ua.position);
  _u.copy(target).sub(_S);
  const d = clamp(_u.length(), Math.abs(A - B) + 1e-3, A + B - 1e-3);
  _u.normalize();
  const alpha = Math.acos(clamp((A * A + d * d - B * B) / (2 * A * d), -1, 1)), elbow = Math.PI - Math.acos(clamp((A * A + B * B - d * d) / (2 * A * B), -1, 1));
  _h.copy(_u).cross(pole);
  if (_h.lengthSq() < 1e-8) _h.set(1, 0, 0);
  _h.normalize();
  _w.copy(_u).applyAxisAngle(_h, alpha); // lengan atas condong ke arah pole (siku)
  _y.copy(_w).negate();
  _z.copy(_h).cross(_y).normalize();
  _mb.makeBasis(_h, _y, _z);
  _qa.setFromRotationMatrix(_mb);
  ua.quaternion.slerp(_qa, w);
  fa.rotation.x = lerp(fa.rotation.x, -elbow, w);
}
// titik pegangan (tangan kanan) & penyangga (tangan kiri) di ruang tulang senjata (+Z = depan) per jenis senjata
const GRIP = { pistol: [[0, -0.07, -0.03], [0.025, -0.085, -0.01]], smg: [[0, -0.085, -0.07], [0, -0.03, 0.16]], shotgun: [[0, -0.08, -0.1], [0, -0.02, 0.3]],
  ar: [[0, -0.085, -0.1], [0, -0.025, 0.26]], dmr: [[0, -0.085, -0.1], [0, -0.025, 0.3]], rifle: [[0, -0.085, -0.04], [0, -0.01, 0.3]],
  sniper: [[0, -0.085, -0.1], [0, -0.03, 0.34]], lmg: [[0, -0.085, -0.1], [0, -0.04, 0.24]], burst: [[0, -0.085, -0.1], [0, -0.025, 0.28]],
  pdw: [[0, -0.085, -0.07], [0, -0.03, 0.18]], revolver: [[0, -0.07, -0.03], [0.025, -0.085, -0.01]], dbs: [[0, -0.08, -0.1], [0, -0.03, 0.22]] };

// ---------- Animasi ----------
// s: { speed m/s, moveYaw (arah gerak relatif hadap, rad), crouch, air, armed, aim, pitch (rad, + = ke atas),
//      fire (impuls), hit (impuls), dead, freefall, chute, sit ('car' | 'bike' | null), steer (−1 kiri … 1 kanan),
//      reload (0..1 kemajuan isi ulang, null = tidak), heal (bool), swap (impuls ganti senjata), prone (bool),
//      gunKind ('pistol'|'smg'|'ar'|'shotgun'|'dmr', untuk posisi tangan), swim (bool: berenang),
//      chuteDrive (saat payung: 1 = melaju/condong maju, −1 = mengerem/kaki diangkat siap mendarat) }
// Saat duduk, root diletakkan setinggi jok − 0,93 (pinggul tepat di atas jok).
// (pose dipanggil tiap frame untuk banyak karakter: tanpa closure/array/objek baru per panggilan)
let _kdt = 0;
const k = (r) => 1 - Math.exp(-_kdt * r);
const RL_T = [0, 0.16, 0.32, 0.48, 0.64, 0.8, 0.94, 1]; // isi ulang: waktu kunci & [lengan atas x, z, lengan bawah x] (null = pose dasar)
const RL_V = [null, [-0.42, 0.55, -1.95], [-0.05, 0.5, -1.7], [0.12, 0.2, -0.55], [-0.4, 0.55, -1.9], [-0.42, 0.55, -1.95], null, null];
export class Rig {
  constructor() {
    const b = this.b = makeBones();
    this.legs = [[b.thighL, b.shinL, b.footL, 0, 1], [b.thighR, b.shinR, b.footR, PI, -1]];
    this.arms = [[b.armL, b.foreL, 1], [b.armR, b.foreR, -1]];
    this.root = this.b.root;
    this.chain = Object.values(b); // induk selalu lebih dulu dari anaknya (urutan makeBones)
    this.phase = Math.random() * PI * 2;
    this.t = Math.random() * 10;
    this.m = { speed: 0, crouch: 0, aim: 0, air: 0, armed: 0, fall: 0, chute: 0, dead: 0, hit: 0, fire: 0, hipYaw: 0, pitch: 0, sit: 0, bike: 0, steer: 0, rl: 0, heal: 0, swap: 0, prone: 0, swim: 0, stroke: 0, cd: 0 };
    this.cphase = 0;
  }
  pose(s, dt) {
    const b = this.b, m = this.m;
    _kdt = dt;
    this.t += dt;
    m.speed += ((s.dead ? 0 : s.speed || 0) - m.speed) * k(9);
    m.crouch += ((s.crouch && !s.prone ? 1 : 0) - m.crouch) * k(10);
    m.aim += ((s.aim ? 1 : 0) - m.aim) * k(12);
    m.air += ((s.air ? 1 : 0) - m.air) * k(9);
    m.armed += ((s.armed ? 1 : 0) - m.armed) * k(8);
    m.fall += ((s.freefall ? 1 : 0) - m.fall) * k(4);
    m.chute += ((s.chute ? 1 : 0) - m.chute) * k(4);
    m.cd += ((s.chute ? clamp(s.chuteDrive || 0, -1, 1) : 0) - m.cd) * k(5);
    const cfw = Math.max(0, m.cd) * m.chute, cbr = Math.max(0, -m.cd) * m.chute; // payung: melaju (W) / mengerem (S)
    m.dead += ((s.dead ? 1 : 0) - m.dead) * k(s.dead ? 4.5 : 30);
    m.pitch += ((s.pitch || 0) - m.pitch) * k(14);
    if (s.hit) { m.hit = 1; s.hit = 0; }
    if (s.fire) { m.fire = 1; s.fire = 0; }
    m.hit = Math.max(0, m.hit - dt * 5);
    m.fire = Math.max(0, m.fire - dt * 12);
    const spd = m.speed, walkW = clamp(spd / 1.3, 0, 1), runK = clamp((spd - 2.6) / 3.6, 0, 1);
    const cr = m.crouch, arm = m.armed, aim = m.aim;
    // arah kaki: pinggul berputar ke arah gerak (menyamping), mundur = siklus kaki dibalik
    let mv = wrap(s.moveYaw || 0), dir = 1;
    if (Math.abs(mv) > 1.95) { mv = wrap(mv - PI); dir = -1; }
    m.hipYaw += (clamp(mv, -1.1, 1.1) * walkW - m.hipYaw) * k(8);
    if (spd > 0.05) this.phase += dt * PI * 2 * (0.82 + 0.2 * spd) * dir;
    const ph = this.phase, sn = Math.sin(ph);
    const A = (0.4 + 0.42 * runK) * walkW * (1 - 0.45 * cr), KN = (0.55 + 1.05 * runK) * walkW;
    // ----- kaki
    const legs = this.legs;
    for (let li = 0; li < 2; li++) {
      const LG = legs[li], th = LG[0], sh = LG[1], ft = LG[2], off = LG[3], side = LG[4];
      const p = ph + off, s1 = Math.sin(p), c1 = Math.cos(p);
      let tx = -s1 * A - 0.95 * cr, kx = 0.06 * walkW + KN * Math.pow(Math.max(0, c1), 1.5) + 1.75 * cr;
      let tz = 0;
      // lompat / di udara
      tx = lerp(tx, side > 0 ? -0.75 : -0.2, m.air);
      kx = lerp(kx, side > 0 ? 1.15 : 0.55, m.air);
      // payung: kaki menggantung, sedikit berayun
      tx = lerp(tx, -0.18 + Math.sin(this.t * 1.6 + off) * 0.12, m.chute);
      kx = lerp(kx, 0.28, m.chute);
      // payung melaju: kaki tertinggal ke belakang; mengerem: lutut diangkat ke depan, siap mendarat
      tx = lerp(lerp(tx, 0.22, cfw), -0.95, cbr);
      kx = lerp(lerp(kx, 0.45, cfw), 0.75, cbr);
      // terjun bebas: kaki terbuka, lutut menekuk
      tx = lerp(tx, 0.3, m.fall);
      kx = lerp(kx, 0.95, m.fall);
      tz = lerp(tz, 0.22 * side, m.fall);
      // mati: terlentang lemas
      tx = lerp(tx, -0.12 + 0.1 * side, m.dead);
      kx = lerp(kx, 0.18, m.dead);
      tz = lerp(tz, 0.12 * side, m.dead);
      th.rotation.set(tx, 0, tz);
      sh.rotation.x = kx;
      ft.rotation.x = -(tx + kx) * 0.8 + 0.1 * walkW * Math.max(0, -c1);
    }
    // ----- pinggul & badan
    const bob = ((0.017 + 0.032 * runK) * Math.cos(2 * ph) - 0.015) * walkW * (1 - m.air);
    const breathe = Math.sin(this.t * 1.8) * 0.012 * (1 - walkW);
    b.hips.position.y = lerp(lerp(0.98 - 0.4 * cr + bob, 0.98, Math.max(m.chute, m.fall)), 0.13, m.dead);
    b.hips.rotation.set(lerp(lerp(0, 1.35, m.fall), -PI / 2, m.dead), m.hipYaw + sn * 0.1 * walkW * (1 - m.dead), Math.cos(ph) * 0.035 * walkW);
    { // payung: badan condong maju saat melaju, sedikit rebah saat mengerem — berputar di titik gantung (bahu), bukan di pinggul
      const ca = (0.38 * cfw - 0.18 * cbr) * (1 - m.dead);
      b.hips.rotation.x += ca;
      b.hips.position.z = -0.47 * Math.sin(ca);
      b.hips.position.y += 0.47 * (1 - Math.cos(ca));
    }
    const lean = 0.05 * walkW + 0.2 * runK * (1 - 0.7 * Math.max(aim, arm * 0.5)) + 0.28 * cr;
    b.spine.rotation.set(lean + breathe - 0.32 * m.hit, -m.hipYaw - sn * 0.1 * walkW, 0);
    const look = m.pitch * (1 - m.dead) * (1 - m.fall);
    b.chest.rotation.set(-look * 0.5 - 0.07 * m.fire + breathe, 0, 0);
    b.head.rotation.set(-look * 0.45 - 0.15 * m.hit + lerp(0, -0.9, m.fall) - 0.25 * cfw, 0, 0);
    // ----- lengan: ayun bebas ↔ pegang senjata (siaga ↔ bidik) ↔ payung / terjun / mati
    const swingA = (0.3 + 0.6 * runK) * walkW, elbow = -(0.22 + 1.15 * runK) * walkW - 0.12;
    const arms = this.arms;
    for (let ai = 0; ai < 2; ai++) {
      const AR = arms[ai], ua = AR[0], fa = AR[1], side = AR[2];
      let ax = side * sn * swingA, az = 0.11 * side, ay = 0, fx = elbow;
      // pegang senapan: kanan di gagang, kiri di pelindung tangan
      const hx = side > 0 ? lerp(-0.95, -1.38, aim) : lerp(-0.62, -1.02, aim);
      const hz = side > 0 ? lerp(-0.62, -0.5, aim) : lerp(0.32, 0.18, aim);
      const hf = side > 0 ? lerp(-0.62, -0.5, aim) : lerp(-1.45, -1.62, aim);
      ax = lerp(ax, hx - look * 0.5, arm);
      az = lerp(az, hz, arm);
      fx = lerp(fx, hf, arm);
      ax = lerp(ax, -2.75, m.chute); az = lerp(az, 0.28 * side, m.chute); fx = lerp(fx, -0.25, m.chute);
      ax = lerp(ax, -1.7, cbr); fx = lerp(fx, -1.2, cbr); // mengerem: kedua tali kemudi ditarik turun
      ax = lerp(ax, -0.25, m.fall); az = lerp(az, 1.35 * side, m.fall); fx = lerp(fx, -0.45, m.fall);
      ax = lerp(ax, -0.25, m.dead); az = lerp(az, 1.05 * side, m.dead); fx = lerp(fx, -0.2, m.dead);
      ua.rotation.set(ax, ay, az);
      fa.rotation.set(fx, 0, 0);
    }
    b.gun.position.set(lerp(-0.13, -0.11, aim), lerp(0.02, 0.27, aim), lerp(0.26, 0.22, aim) - 0.05 * m.fire);
    b.gun.rotation.set(lerp(0.55, 0, aim) * (1 - m.chute) - look * 0.5 + (1 - aim) * 0.12 * walkW * Math.sin(2 * ph), 0, 0);
    // ----- isi ulang: tangan kiri ke magasin → cabut → ambil yang baru di rompi → pasang → kembali ke pelindung tangan
    const rl = s.reload == null || s.reload < 0 ? -1 : Math.min(1, s.reload);
    m.rl += ((rl >= 0 ? 1 : 0) - m.rl) * k(rl >= 0 ? 16 : 10);
    if (m.rl > 0.01 && rl >= 0) {
      const w = m.rl * arm * (1 - m.dead) * (1 - m.chute) * (1 - m.fall), b0 = b.armL.rotation.x, b1 = b.armL.rotation.z, b2 = b.foreL.rotation.x;
      let j = 0;
      while (j < RL_T.length - 2 && rl > RL_T[j + 1]) j++;
      const t0 = RL_T[j], t1 = RL_T[j + 1], a0 = RL_V[j], a1 = RL_V[j + 1], u = clamp((rl - t0) / Math.max(1e-3, t1 - t0), 0, 1), e = u * u * (3 - 2 * u);
      b.armL.rotation.x = lerp(b0, lerp(a0 ? a0[0] : b0, a1 ? a1[0] : b0, e), w);
      b.armL.rotation.z = lerp(b1, lerp(a0 ? a0[1] : b1, a1 ? a1[1] : b1, e), w);
      b.foreL.rotation.x = lerp(b2, lerp(a0 ? a0[2] : b2, a1 ? a1[2] : b2, e), w);
      const bell = Math.sin(Math.PI * clamp((rl - 0.06) / 0.86, 0, 1)) * w; // senjata dimiringkan & diturunkan selama isi ulang
      b.gun.rotation.z += 0.75 * bell;
      b.gun.rotation.x += 0.38 * bell;
      b.gun.position.y -= 0.05 * bell;
      b.armR.rotation.x += 0.22 * bell;
      b.head.rotation.x += 0.3 * bell;
      b.chest.rotation.x += 0.08 * bell;
    }
    // ----- mengobati: berlutut/jongkok, kedua tangan membalut di depan perut, kepala menunduk
    m.heal += ((s.heal ? 1 : 0) - m.heal) * k(8);
    if (m.heal > 0.01) {
      const w = m.heal * (1 - m.dead);
      for (let ai = 0; ai < 2; ai++) {
        const AR = arms[ai], ua = AR[0], fa = AR[1], side = AR[2];
        ua.rotation.set(lerp(ua.rotation.x, -0.78 + Math.sin(this.t * 7 + side) * 0.13, w), lerp(ua.rotation.y, 0, w), lerp(ua.rotation.z, -0.3 * side, w));
        fa.rotation.x = lerp(fa.rotation.x, -1.45 + Math.cos(this.t * 7 + side) * 0.16, w);
      }
      b.head.rotation.x += 0.45 * w;
      b.gun.position.set(lerp(b.gun.position.x, 0.02, w), lerp(b.gun.position.y, 0.08, w), lerp(b.gun.position.z, -0.3, w));
      b.gun.rotation.set(lerp(b.gun.rotation.x, 1.25, w), lerp(b.gun.rotation.y, 0, w), lerp(b.gun.rotation.z, 0.75, w));
    }
    // ----- ganti senjata: senjata turun lalu naik lagi
    if (s.swap) { m.swap = 1; s.swap = 0; }
    m.swap = Math.max(0, m.swap - dt * 2.4);
    if (m.swap > 0) {
      const w = Math.sin(m.swap * Math.PI) * arm;
      b.gun.rotation.x += 1.0 * w;
      b.gun.position.y -= 0.14 * w;
      b.armR.rotation.x += 0.4 * w;
      b.armL.rotation.x += 0.55 * w;
    }
    // ----- tiarap: badan rata di tanah menghadap ke depan, siku menopang senjata; bergerak = merayap (lutut ditarik bergantian)
    m.prone += ((s.prone && !s.dead ? 1 : 0) - m.prone) * k(s.prone ? 5 : 7);
    if (m.prone > 0.002) {
      const w = m.prone * (1 - m.dead), crawl = clamp(spd / 0.8, 0, 1);
      if (crawl > 0.02) this.cphase += dt * Math.PI * 2 * (0.55 + 0.55 * spd) * dir;
      const cs = Math.sin(this.cphase);
      b.hips.position.y = lerp(b.hips.position.y, 0.2, w);
      b.hips.rotation.set(lerp(b.hips.rotation.x, 1.47, w), lerp(b.hips.rotation.y, 0, w), lerp(b.hips.rotation.z, cs * 0.07 * crawl, w));
      b.spine.rotation.set(lerp(b.spine.rotation.x, -0.08, w), lerp(b.spine.rotation.y, -cs * 0.06 * crawl, w), 0);
      b.chest.rotation.x = lerp(b.chest.rotation.x, -0.24 - look * 0.25, w);
      b.head.rotation.x = lerp(b.head.rotation.x, -1.05 - look * 0.2, w);
      for (let li = 0; li < 2; li++) {
        const LG = legs[li], th = LG[0], sh = LG[1], ft = LG[2], side = LG[4];
        const pull = Math.max(0, side > 0 ? cs : -cs) * crawl;
        th.rotation.set(lerp(th.rotation.x, -0.3 * pull, w), lerp(th.rotation.y, 0, w), lerp(th.rotation.z, (0.13 + 0.5 * pull) * side, w));
        sh.rotation.x = lerp(sh.rotation.x, 0.1 + 1.15 * pull, w);
        ft.rotation.x = lerp(ft.rotation.x, 0.55, w);
      }
      for (let ai = 0; ai < 2; ai++) {
        const AR = arms[ai], ua = AR[0], fa = AR[1], side = AR[2];
        const reach = Math.max(0, side > 0 ? -cs : cs) * crawl * (1 - 0.6 * arm);
        const az = arm > 0.5 ? (side > 0 ? -0.3 : 0.16) : 0.12 * side; // pegang senjata: tangan kiri ke pelindung tangan, kanan ke gagang
        ua.rotation.set(lerp(ua.rotation.x, lerp(-1.93, -2.45, reach), w), lerp(ua.rotation.y, 0, w), lerp(ua.rotation.z, az, w));
        fa.rotation.x = lerp(fa.rotation.x, lerp(-0.9, -0.35, reach), w);
      }
      b.gun.position.set(lerp(b.gun.position.x, -0.08, w), lerp(b.gun.position.y, 0.5, w), lerp(b.gun.position.z, 0.27, w));
      b.gun.rotation.set(lerp(b.gun.rotation.x, -1.45 - look * 0.25, w), lerp(b.gun.rotation.y, 0, w), lerp(b.gun.rotation.z, 0, w));
    }
    // ----- berenang: bergerak = gaya bebas (badan mendatar, lengan mengayuh bergantian, kaki menendang); diam = mengapung tegak
    m.swim += ((s.swim ? 1 : 0) - m.swim) * k(6);
    if (m.swim > 0.002) {
      const w = m.swim * (1 - m.dead), mv = clamp(spd / 1.6, 0, 1);
      m.stroke += dt * (mv > 0.05 ? 5.2 + 1.5 * spd : 2.2);
      const st = m.stroke, cs = Math.sin(st), cc = Math.cos(st);
      b.hips.position.y = lerp(b.hips.position.y, lerp(0.98, 1.2, mv), w);
      b.hips.rotation.set(lerp(b.hips.rotation.x, lerp(0.12, 1.42, mv), w), lerp(b.hips.rotation.y, 0, w), lerp(b.hips.rotation.z, cs * 0.25 * mv, w));
      b.spine.rotation.set(lerp(b.spine.rotation.x, 0, w), lerp(b.spine.rotation.y, 0, w), 0);
      b.chest.rotation.x = lerp(b.chest.rotation.x, lerp(0, -0.3, mv), w);
      b.head.rotation.x = lerp(b.head.rotation.x, lerp(0, -1.0, mv) + cc * 0.12 * mv, w);
      for (let li = 0; li < 2; li++) {
        const LG = legs[li], th = LG[0], sh = LG[1], ft = LG[2], side = LG[4];
        const kick = Math.sin(st * 2 + (side > 0 ? 0 : Math.PI)) * (0.25 * mv + 0.12 * (1 - mv));
        th.rotation.set(lerp(th.rotation.x, kick, w), 0, lerp(th.rotation.z, 0.08 * side, w));
        sh.rotation.x = lerp(sh.rotation.x, 0.25 + Math.max(0, -kick) * 0.6, w);
        ft.rotation.x = lerp(ft.rotation.x, 0.9, w);
      }
      for (let ai = 0; ai < 2; ai++) {
        const AR = arms[ai], ua = AR[0], fa = AR[1], side = AR[2];
        const ph = st + (side > 0 ? 0 : Math.PI), crawlX = -Math.PI * 0.5 - Math.PI * 0.5 * Math.cos(ph), tread = Math.sin(ph) * 0.35;
        ua.rotation.set(lerp(ua.rotation.x, lerp(-0.3 + tread * 0.3, crawlX, mv), w), lerp(ua.rotation.y, 0, w), lerp(ua.rotation.z, lerp(0.7 + tread, 0.15, mv) * side, w));
        fa.rotation.x = lerp(fa.rotation.x, lerp(-0.9, -0.25 - Math.max(0, Math.sin(ph)) * 0.6, mv), w);
      }
    }
    // ----- tangan menempel di senjata (IK): kanan di pegangan, kiri di penyangga (saat isi ulang tangan kiri dianimasikan)
    const ikW = arm * (1 - m.dead) * (1 - m.fall) * (1 - m.chute) * (1 - m.heal) * (1 - m.swap * 0.8) * (1 - m.swim);
    if (ikW > 0.01 && (!s.sit || s.armed)) { // duduk bersenjata (menembak dari kendaraan) juga
      const G = GRIP[s.gunKind] || GRIP.rifle;
      _qc.copy(b.hips.quaternion).multiply(b.spine.quaternion).multiply(b.chest.quaternion).invert(); // ruang karakter → ruang dada
      _t.set(G[0][0], G[0][1], G[0][2]).applyQuaternion(b.gun.quaternion).add(b.gun.position);
      _pole.set(-0.55, -1, -0.25).applyQuaternion(_qc);
      solveArm(b.armR, b.foreR, _t, _pole, ikW);
      const leftW = ikW * (1 - m.rl);
      if (leftW > 0.01) {
        _t.set(G[1][0], G[1][1], G[1][2]).applyQuaternion(b.gun.quaternion).add(b.gun.position);
        _pole.set(0.45, -1, 0.05).applyQuaternion(_qc);
        solveArm(b.armL, b.foreL, _t, _pole, leftW);
      }
    }
    // ----- duduk di kendaraan: paha mendatar, lutut menekuk; sopir = tangan di setir/stang (motor: badan condong ke depan),
    //       penumpang = tangan di pangkuan. Bersenjata (s.armed): tangan tetap di senjata (IK di atas), badan memutar ke arah
    //       bidikan (s.twist rad, + = kiri) & condong keluar saat membidik; sopir (s.oneHand) menembak satu tangan, kiri di setir.
    m.sit += ((s.sit ? 1 : 0) - m.sit) * k(s.sit ? 14 : 30);
    m.bike += ((s.sit === 'bike' ? 1 : 0) - m.bike) * k(14);
    m.steer += ((s.steer || 0) - m.steer) * k(10);
    m.twist = (m.twist || 0) + ((s.sit && s.armed ? s.twist || 0 : 0) - (m.twist || 0)) * k(10);
    m.pass = (m.pass || 0) + ((s.pass ? 1 : 0) - (m.pass || 0)) * k(10);
    m.one = (m.one || 0) + ((s.oneHand ? 1 : 0) - (m.one || 0)) * k(10);
    if (m.sit > 0.002) {
      const w = m.sit * (1 - m.dead), bk = m.bike, st = m.steer * (1 - m.pass), aw = arm * (1 - m.dead) * (1 - m.swap * 0.8);
      const hx = lerp(-0.12 - (s.recline || 0), 0.2, bk), sx = lerp(0.02, 0.1, bk), chestW = hx + sx; // recline: jok rebah (supercar)
      b.hips.position.y = lerp(b.hips.position.y, 0.98, w);
      b.hips.rotation.set(lerp(b.hips.rotation.x, hx, w), lerp(b.hips.rotation.y, 0, w), lerp(b.hips.rotation.z, 0, w));
      b.spine.rotation.set(lerp(b.spine.rotation.x, sx, w), lerp(b.spine.rotation.y, 0, w), 0);
      b.chest.rotation.x = lerp(b.chest.rotation.x, 0, w * (1 - aw)); // bersenjata: dada tetap ikut menunduk/mendongak
      const hv = b.head.rotation.x;
      b.head.rotation.x = lerp(lerp(hv, -chestW, w), hv - chestW * w, aw);
      const thx = -1.5 - hx, shx = lerp(1.0, 1.25, bk);
      for (let li = 0; li < 2; li++) {
        const LG = legs[li], th = LG[0], sh = LG[1], ft = LG[2], side = LG[4];
        th.rotation.set(lerp(th.rotation.x, thx, w), 0, lerp(th.rotation.z, lerp(0.07, 0.14, bk) * side, w));
        sh.rotation.x = lerp(sh.rotation.x, shx, w);
        ft.rotation.x = lerp(ft.rotation.x, -(hx + thx + shx) - lerp(0.25, 0, bk), w);
      }
      for (let ai = 0; ai < 2; ai++) {
        const AR = arms[ai], ua = AR[0], fa = AR[1], side = AR[2];
        // bersenjata: tangan tetap di senjata, kecuali tangan kiri sopir di setir (saat isi ulang ikut animasi magasin)
        const keep = aw * (side > 0 ? 1 - m.one * (1 - m.rl) : 1), wa = w * (1 - keep);
        if (wa < 0.002) continue;
        const ax = lerp(lerp(-0.95, -1.12, bk) - chestW + st * side * lerp(0.22, 0.12, bk), lerp(-0.42, -0.55, bk) - chestW, m.pass);
        const az = lerp(lerp(-0.05, 0.24, bk), lerp(0.06, 0.2, bk), m.pass) * side;
        ua.rotation.set(lerp(ua.rotation.x, ax, wa), lerp(ua.rotation.y, 0, wa), lerp(ua.rotation.z, az, wa));
        fa.rotation.x = lerp(fa.rotation.x, lerp(lerp(-0.62, -0.3, bk), lerp(-1.05, -1.25, bk), m.pass), wa);
      }
      if (Math.abs(m.twist) > 1e-3) { // putar badan (tulang belakang; pinggul & kaki tetap supaya tidak menembus pintu) & condong keluar
        const ax3 = (this._ax ||= { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion() }), q = ax3.q;
        const spT = m.twist * w, lean = 0.24 * m.aim * aw * clamp((Math.abs(spT) - 0.45) / 0.8, 0, 1);
        b.spine.quaternion.premultiply(q.setFromAxisAngle(ax3.X, lean)).premultiply(q.setFromAxisAngle(ax3.Y, spT));
        if (m.one > 0.01) b.armL.quaternion.premultiply(q.setFromAxisAngle(ax3.Y, -spT * m.one * (1 - m.rl))); // tangan kiri sopir tetap ke setir
      }
    }
    this.updateWorld();
  }
  // Matriks dunia semua tulang (induk → anak) tanpa penelusuran umum three.js. Anak non-tulang (mesh perlengkapan pada
  // karakter tunggal) ikut diperbarui scene.updateMatrixWorld() berikutnya (updateMatrix menandai matrixWorldNeedsUpdate).
  updateWorld() {
    const L = this.chain, r = L[0];
    r.updateMatrix();
    if (r.parent) r.matrixWorld.multiplyMatrices(r.parent.matrixWorld, r.matrix); else r.matrixWorld.copy(r.matrix);
    for (let i = 1; i < L.length; i++) { const o = L[i]; o.updateMatrix(); o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix); }
  }
}

// ---------- Model karakter dari Blender (tools/blender/characters.py), opsional ----------
// Satu mesh per tulang (bagian kaku) → tetap bisa digambar sebagai kerumunan instans. Panggil setCharacterParts(await
// loadCharacterParts()) SEBELUM buildCharacter/createCrowd; kalau gagal dimuat, bagian prosedural di atas yang dipakai.
const PART_BONE = { hair: 'head', hair_long: 'head', cap: 'head', helmet: 'head', vest: 'chest', pack: 'chest', stripe: 'chest' };
const PART_GEAR = { hair: 'hair', hair_long: 'hair2', cap: 'cap', helmet: 'helmet', vest: 'vest', pack: 'pack', stripe: 'stripe' };
function partGeo(g0) { // posisi + normal + warna RGB (putih kalau tidak ada), tanpa indeks
  let g = g0.index ? g0.toNonIndexed() : g0.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, c = g.attributes.color, rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = c ? c.getX(i) : 1; rgb[i * 3 + 1] = c ? c.getY(i) : 1; rgb[i * 3 + 2] = c ? c.getZ(i) : 1; }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return g;
}
async function loadPartsV2(base) {
  const [gltf, meta] = await Promise.all([new GLTFLoader().loadAsync(base + 'person.glb'), fetch(base + 'person.json').then((r) => r.json())]);
  gltf.scene.updateMatrixWorld(true);
  const lam = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  const defs = [];
  for (const P of meta.parts || []) {
    const o = gltf.scene.getObjectByName(P.name);
    if (!o) continue;
    const geos = [];
    o.traverse((m) => { if (m.isMesh) { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); geos.push(partGeo(g)); } });
    if (!geos.length) continue;
    const g = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    g.translate(-P.pivot[0], -P.pivot[1], -P.pivot[2]); // posisi diam di dunia → relatif ke sendi
    const slot = P.slot && P.slot !== 'fixed' ? P.slot : null;
    defs.push({ bones: [PART_BONE[P.name] || P.name], geo: g, color: slot, gear: PART_GEAR[P.name], vc: true, fixed: !slot, mat: lam() });
  }
  if (defs.length < 17) throw new Error('bagian karakter tidak lengkap (' + defs.length + ')');
  defs.push({ bones: ['gun'], geo: rifleGeo(), gear: 'gun', vc: true, fixed: true, mat: lam() });
  return defs;
}
// Muat model karakter: v3 (tubuh ber-kulit, lihat bagian "Karakter v3" di bawah); kalau gagal → v2 (bagian kaku per tulang).
export async function loadCharacterParts(base = 'game/assets/characters/') {
  try { return { v3: await loadV3(base) }; } catch (e) { console.warn('Karakter v3 tidak dimuat (' + e.message + '), pakai model lama'); }
  return loadPartsV2(base);
}
// Dipanggil SEBELUM buildCharacter/createCrowd; setelah ada karakter yang dibangun, panggilan ini diabaikan.
export function setCharacterParts(x) {
  if (BUILT || !x) return;
  if (x.v3) V3 = x.v3;
  else if (x.length) DEFS = x;
}
// Perlengkapan tambahan dari luar (mis. model tiap senjata dari game/weapons.js): [{ gear, bone, geo }], didaftarkan
// sebelum buildCharacter/createCrowd.
const EXTRA = [];
export function addGearParts(list) { for (const p of list) EXTRA.push({ bones: [p.bone], geo: p.geo, gear: p.gear, vc: true, fixed: true, mat: new THREE.MeshLambertMaterial({ vertexColors: true }) }); }
function defs() {
  DEFS ||= partDefs();
  if (!DEFS.extra) { DEFS.push(...EXTRA); DEFS.extra = true; }
  return DEFS;
}

// ---------- Satu karakter ----------
export const OUTFIT_PETUGAS = { shirt: '#503EBA', sleeve: '#503EBA', pants: '#2b2940', skin: '#c68c66', hair: '#231c18', shoes: '#1c1b22', gear: '#4c5340', pack: '#3a3d34', trim: '#D29F52' };
let DEFS = null;
export function buildCharacter(outfit = OUTFIT_PETUGAS, gear = { cap: true, stripe: true, hair: true }, look = null) {
  if (V3) return buildCharacter3(outfit, gear, look || {});
  BUILT = true;
  defs();
  const rig = new Rig(), parts = {};
  for (const d of DEFS) {
    const mat = d.mat.clone();
    if (d.color) mat.color.set(outfit[d.color] || '#ffffff');
    for (const bn of d.bones) {
      const o = new THREE.Mesh(d.geo, mat);
      o.castShadow = false;
      o.receiveShadow = true;
      o.layers.enable(3); // bayangan dinamis
      o.visible = !d.gear || !!gear[d.gear];
      rig.b[bn].add(o);
      (parts[d.gear || 'body'] ||= []).push(o);
    }
  }
  return {
    rig, root: rig.root, parts,
    setGear(name, on) { for (const o of parts[name] || []) o.visible = !!on; },
  };
}

// ---------- Kerumunan (bot) ----------
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), NOGEAR = {};
export function createCrowd(scene, n) {
  if (V3) return createCrowd3(scene, n);
  BUILT = true;
  defs();
  const meshes = DEFS.map((d) => {
    const im = new THREE.InstancedMesh(d.geo, d.mat, n * d.bones.length);
    im.frustumCulled = false;
    im.receiveShadow = true;
    im.layers.enable(3); // bayangan dinamis (map/realism.js DYN_LAYER)
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < im.count; i++) { im.setMatrixAt(i, ZERO); if (d.color) im.setColorAt(i, white); }
    scene.add(im);
    return im;
  });
  const col = new THREE.Color();
  return {
    meshes,
    setOutfit(i, outfit) {
      DEFS.forEach((d, j) => {
        if (!d.color) return;
        col.set(outfit[d.color] || '#ffffff');
        for (let k = 0; k < d.bones.length; k++) meshes[j].setColorAt(i * d.bones.length + k, col);
        meshes[j].instanceColor.needsUpdate = true;
      });
    },
    // tulis matriks tulang rig ke instans; gear = { gun, helmet, vest, pack, hair, cap }
    write(i, rig, visible, gear) {
      DEFS.forEach((d, j) => {
        const on = visible && (!d.gear || gear[d.gear]);
        for (let k = 0; k < d.bones.length; k++) meshes[j].setMatrixAt(i * d.bones.length + k, on ? rig.b[d.bones[k]].matrixWorld : ZERO);
      });
    },
    flush() { for (const im of meshes) im.instanceMatrix.needsUpdate = true; },
    // antarmuka bersama dengan kerumunan v3 (lihat createCrowd3)
    begin() {},
    inView() { return true; },
    hide(i) { this.write(i, null, false, NOGEAR); },
    put(i, rig, x, y, z, d, posed, inF, gun, helmet, vest, pack, longHair) {
      const g = {}; if (gun) g['gun_' + gun] = true; g.helmet = helmet > 0; g.vest = vest > 0; g.pack = pack; g.hair = !helmet && !longHair; g.hair2 = !helmet && !!longHair;
      this.write(i, rig, true, g);
    },
  };
}

// =====================================================================================================================
// Karakter v3: tubuh ber-kulit (skinned) hasil tools/blender/characters3.py (data MakeHuman CC0 → kerangka di atas).
//  - Satu mesh per varian tubuh × LOD, digambar ber-instans. Matriks tulang SEMUA karakter ada di satu tekstur float
//    (baris = karakter; 17 tulang × 4 texel + 8 texel palet warna) dan dibaca chunk skinning three.js yang ditambal
//    (atribut instans aRow = baris). Karena tetap THREE.SkinnedMesh, pass bayangan dinamis (map/realism.js) ikut benar.
//  - Pakaian diwarnai per karakter: albedo atlas netral × warna slot (kulit, tangan, atasan, lengan, manset, celana, dalaman).
//  - Perlengkapan kaku (rambut, helm, rompi, ransel, senjata) = InstancedMesh yang dipadatkan (count = yang tampil).
//  - Hemat: LOD0 hanya K terdekat, yang di luar layar tidak digambar, pembuat bayangan = LOD2 dalam radius 36 m.
// =====================================================================================================================
const NB3 = 17, PAL0 = NB3 * 4, TW3 = PAL0 + 8;
// jarak efektif (m, sudah dikali zoom): LOD0 = K0 terdekat < r0, LOD1 = K1 berikutnya < r1, LOD2 < r2, sisanya LOD3 (kalau ada);
// bagian kaku punya batas sendiri
const LOD3 = { r0: 11, k0: 6, r1: 42, k1: 22, r2: 150, hair0: 25, hair1: 75, helmet: 110, vest: 90, pack: 75, gun: 130, shadow: 36 };
const BODY_ATTR = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'aSlot'], SHADOW_ATTR = ['position', 'skinIndex', 'skinWeight'];
let V3 = null, BUILT = false;
const _c3 = new THREE.Color(), _m3 = new THREE.Matrix4(), _sph3 = new THREE.Sphere(), _fr3 = new THREE.Frustum(), _one3 = new THREE.Vector3(1, 1, 1);

// chunk skinning bawaan: baris tekstur tulang = atribut aRow (0 untuk SkinnedMesh biasa yang tidak punya atribut itu)
function patchSkinningChunk() {
  const C = THREE.ShaderChunk;
  if (C.skinning_pars_vertex.includes('aRow')) return;
  const s = C.skinning_pars_vertex
    .replace('uniform highp sampler2D boneTexture;', 'uniform highp sampler2D boneTexture;\n\tattribute float aRow;')
    .replace('int y = j / size;', 'int y = j / size + int( aRow );');
  if (!s.includes('attribute float aRow') || !s.includes('int( aRow )')) throw new Error('chunk skinning three.js tidak dikenali');
  C.skinning_pars_vertex = s;
}

// penyimpan matriks tulang + palet: berperan sebagai "skeleton" bagi SkinnedMesh (renderer hanya butuh boneTexture & update)
// (tulang tiruan: three.js menghitung bola pembatas SkinnedMesh lewat skeleton.bones — cukup pose diam, sekali saja)
const DUMMY_BONES3 = Array.from({ length: NB3 }, () => new THREE.Object3D()), DUMMY_INV3 = DUMMY_BONES3.map(() => new THREE.Matrix4());
const FAR_SPHERE3 = new THREE.Sphere(new THREE.Vector3(), 1e7);
class SkinStore extends THREE.Skeleton {
  constructor(rows) {
    super(DUMMY_BONES3, DUMMY_INV3);
    this.rows = rows;
    this.data = new Float32Array(TW3 * rows * 4);
    this.boneTexture = new THREE.DataTexture(this.data, TW3, rows, THREE.RGBAFormat, THREE.FloatType);
    this.boneTexture.needsUpdate = true;
    this.onUpdate = null;
  }
  update() { if (this.onUpdate) this.onUpdate(); }
  computeBoneTexture() { return this; }
}
// matriks kulit = dunia tulang × translasi(−poros diam); pose diam kerangka hanya translasi
function writeRow3(data, row, rig) {
  const L = rig._bl || (rig._bl = V3.bones.map((n) => rig.b[n])), P = V3.pivots;
  let o = row * TW3 * 4;
  for (let k = 0; k < NB3; k++, o += 16) {
    const e = L[k].matrixWorld.elements, px = P[k * 3], py = P[k * 3 + 1], pz = P[k * 3 + 2];
    data[o] = e[0]; data[o + 1] = e[1]; data[o + 2] = e[2]; data[o + 3] = 0;
    data[o + 4] = e[4]; data[o + 5] = e[5]; data[o + 6] = e[6]; data[o + 7] = 0;
    data[o + 8] = e[8]; data[o + 9] = e[9]; data[o + 10] = e[10]; data[o + 11] = 0;
    data[o + 12] = e[12] - (e[0] * px + e[4] * py + e[8] * pz);
    data[o + 13] = e[13] - (e[1] * px + e[5] * py + e[9] * pz);
    data[o + 14] = e[14] - (e[2] * px + e[6] * py + e[10] * pz);
    data[o + 15] = 1;
  }
}
function shiftRow3(data, row, dx, dy, dz) {
  let o = row * TW3 * 4 + 12;
  for (let k = 0; k < NB3; k++, o += 16) { data[o] += dx; data[o + 1] += dy; data[o + 2] += dz; }
}
// palet: warna slot (linear) ÷ faktor netral atlas. outfit: { skin, glove?, shirt, sleeve?, cuff?, pants, inner? }
function writePalette3(data, row, o) {
  const base = (row * TW3 + PAL0) * 4, k = 1 / V3.neutral;
  const put = (slot, hex) => { _c3.set(hex || '#888888'); const q = base + slot * 4; data[q] = _c3.r * k; data[q + 1] = _c3.g * k; data[q + 2] = _c3.b * k; data[q + 3] = 1; };
  put(0, o.skin); put(1, o.glove || o.skin); put(2, o.shirt); put(3, o.sleeve || o.shirt); put(4, o.cuff || o.sleeve || o.shirt); put(5, o.pants); put(6, o.inner || '#cfcabd');
  const q = base + 28; data[q] = data[q + 1] = data[q + 2] = k; data[q + 3] = o.fx || 0; // alfa slot "tetap" = nomor pola skin (game/skinfx.js), 0 = polos
}
function instGeo3(src, n, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(src.index);
  for (const k of attrs) if (src.getAttribute(k)) g.setAttribute(k, src.getAttribute(k));
  const rows = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  rows.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aRow', rows);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}
function bodyMaterial3(map, normalMap, orm) {
  const m = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap: orm, aoMap: orm, roughness: 1, metalness: 0, envMapIntensity: 0.4, aoMapIntensity: 0.9 });
  m.normalScale.set(1, -1); // uv gaya glTF (tekstur tanpa flipY) + tangen dari turunan layar
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSfT = SF_U.uSfT; // waktu animasi skin (game/skinfx.js tickSkins)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSlot;\nvarying vec3 vTint;\nflat varying vec3 vFx;\nvarying vec3 vRestP;\nvarying vec3 vRestN;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n\tvTint = texelFetch( boneTexture, ivec2( ' + PAL0 + ' + int( aSlot ), int( aRow ) ), 0 ).rgb;\n'
        // skin berpola (game/skinfx.js): nomor pola & faktor palet dari slot "tetap", posisi/normal pose diam untuk motif
        + '\t{ vec4 fxT = texelFetch( boneTexture, ivec2( ' + (PAL0 + 7) + ', int( aRow ) ), 0 ); vFx = vec3( fxT.a, aSlot, fxT.r ); vRestP = position; vRestN = normal; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;\nflat varying vec3 vFx;\nvarying vec3 vRestP;\nvarying vec3 vRestN;\n' + CHAR_SKIN_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tvec3 sfTint = vTint, sfEmis = vec3( 0.0 ); float sfMetal = 0.0, sfRough = -1.0;\n'
        + '\tif ( vFx.x > 0.5 ) sfChar( int( vFx.x + 0.5 ), int( vFx.y + 0.5 ), vRestP, normalize( vRestN ), vFx.z, abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), sfTint, sfMetal, sfRough, sfEmis );\n\tdiffuseColor.rgb *= sfTint;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\tif ( sfRough >= 0.0 ) roughnessFactor = sfRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor = max( metalnessFactor, sfMetal );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += sfEmis;')
      // kulit (kanal B peta ORM): cahaya sekitar sedikit lebih hangat → sisi teduh wajah tidak kelabu (hamburan bawah kulit murah)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n#ifdef USE_ROUGHNESSMAP\n\treflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), vec3( 1.2, 1.04, 0.97 ), texelRoughness.b );\n#endif');
  };
  m.customProgramCacheKey = () => 'char3fx';
  return m;
}
const SHADOW_MAT3 = new THREE.MeshBasicMaterial({ colorWrite: false });
const GEAR_MAT3 = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3 }); // helm, rompi, ransel

async function loadV3(base) {
  const meta = await fetch(base + 'people3.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  if (meta.version !== 3 || !meta.bones || meta.bones.length !== NB3 || meta.slots.length !== 8) throw new Error('manifest tidak cocok');
  patchSkinningChunk();
  const loader = new GLTFLoader(), tl = new THREE.TextureLoader(), texCache = {};
  const tex = (f, srgb) => texCache[f] || (texCache[f] = tl.loadAsync(base + f).then((t) => { t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }));
  // satu material per tekstur rambut (dipakai bersama antar-varian), dimuat lebih dulu
  const hairMats = {}, hairFiles = [...new Set(meta.variants.flatMap((v) => (v.hair || []).map((h) => h.map)))];
  await Promise.all(hairFiles.map(async (f) => { hairMats[f] = new THREE.MeshStandardMaterial({ map: await tex(f, true), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, envMapIntensity: 0.25 }); }));
  const variants = await Promise.all(meta.variants.map(async (mv) => {
    const [gltf, map, normalMap, orm] = await Promise.all([loader.loadAsync(base + mv.glb), tex(mv.albedo, true), tex(mv.normal), tex(mv.orm)]);
    const geo = (name) => {
      const o = gltf.scene.getObjectByName(name);
      if (!o || !o.geometry) throw new Error('mesh ' + name + ' tidak ada');
      const g = o.geometry;
      if (g.getAttribute('_slot')) { g.setAttribute('aSlot', g.getAttribute('_slot')); g.deleteAttribute('_slot'); }
      return g;
    };
    const hair = [];
    for (const h of mv.hair || []) {
      hair.push({ style: h.style, bone: h.bone, mat: hairMats[h.map], lods: h.lods.map((n) => geo(n).translate(-meta.pivots[h.bone][0], -meta.pivots[h.bone][1], -meta.pivots[h.bone][2])) });
    }
    const off = (g, bone) => g.translate(-meta.pivots[bone][0], -meta.pivots[bone][1], -meta.pivots[bone][2]); // pose diam → relatif poros tulangnya
    const gear = (mv.gear || []).map((g) => ({ name: g.name, bone: g.bone, tint: g.tint || null, geo: off(geo(g.mesh), g.bone) }));
    return { key: mv.key, female: mv.key[0] === 'f', lods: mv.lods.map(geo), tris: mv.tris, mat: bodyMaterial3(map, normalMap, orm), hair, gear };
  }));
  const pivots = new Float32Array(NB3 * 3);
  meta.bones.forEach((b, i) => pivots.set(meta.pivots[b], i * 3));
  return { bones: meta.bones, pivots, neutral: meta.neutral || 0.5, variants, hairMats: Object.values(hairMats) };
}
// pantulan langit (mode realistis): dipanggil game setelah lingkungan siap
let ENV3 = null;
const SOLO_MATS3 = []; // material salinan milik karakter tunggal (perlengkapan pemain)
export function setCharacterEnv(env) {
  if (!V3 || !env) return;
  ENV3 = env;
  for (const v of V3.variants) { v.mat.envMap = env; v.mat.needsUpdate = true; }
  for (const m of V3.hairMats) { m.envMap = env; m.needsUpdate = true; }
  for (const d of defs3()) if (d.mat.isMeshStandardMaterial) { d.mat.envMap = env; d.mat.needsUpdate = true; }
  for (const m of SOLO_MATS3) { m.envMap = env; m.needsUpdate = true; }
}
export function characterVariants() { return V3 ? V3.variants.map((v) => ({ key: v.key, female: v.female, hair: v.hair.length })) : []; }
const variantIndex = (key) => { const i = V3.variants.findIndex((v) => v.key === key); return i < 0 ? 0 : i; };
// bagian kaku v3: { name, bone, geo, mat, tint ('hair' | 'gear' | 'pack' | null), variant (−1 = semua), style, lod, maxD }
function defs3() {
  if (!V3.defs) {
    const L = [];
    V3.variants.forEach((v, vi) => v.hair.forEach((h, si) => h.lods.forEach((g, li) => L.push({ name: 'hair', bone: h.bone, geo: g, mat: h.mat, tint: 'hair', variant: vi, style: si, lod: li }))));
    V3.variants.forEach((v, vi) => v.gear.forEach((g) => L.push({ name: g.name, bone: g.bone, geo: g.geo, mat: GEAR_MAT3, tint: g.tint, variant: vi, style: 0, lod: 0 })));
    for (const e of EXTRA) L.push({ name: e.gear, bone: e.bones[0], geo: e.geo, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.55, envMapIntensity: 0.6 }), tint: null, variant: -1, style: 0, lod: 0 });
    V3.defs = L;
  }
  return V3.defs;
}

// ---------- Satu karakter (pemain orang ketiga) ----------
// look: { variant: 'm1' | 'f1' | …, hair: indeks gaya rambut }. outfit: lihat writePalette3 (+ hair, gear, pack untuk bagian kaku).
function buildCharacter3(outfit, gear, look) {
  BUILT = true;
  const rig = new Rig(), parts = {}, vi = variantIndex(look.variant), v = V3.variants[vi], store = new SkinStore(1);
  const mk = (src, attrs) => { const g = instGeo3(src, 1, attrs); g.instanceCount = 1; const m = new THREE.SkinnedMesh(g, attrs === BODY_ATTR ? v.mat : SHADOW_MAT3); m.skeleton = store; m.frustumCulled = false; m.boundingSphere = FAR_SPHERE3; return m; };
  const body = mk(v.lods[0], BODY_ATTR), shadow = mk(v.lods[1], SHADOW_ATTR);
  body.receiveShadow = true;
  shadow.layers.set(3); // hanya pass bayangan dinamis (map/realism.js DYN_LAYER)
  rig.root.add(body, shadow);
  store.onUpdate = () => { writeRow3(store.data, 0, rig); store.boneTexture.needsUpdate = true; }; // dipanggil renderer sekali per pass
  writePalette3(store.data, 0, outfit);
  const hairStyle = (look.hair || 0) % Math.max(1, v.hair.length);
  for (const d of defs3()) {
    if (d.variant >= 0 && d.variant !== vi) continue;
    if (d.name === 'hair' && (d.style !== hairStyle || d.lod !== 0)) continue;
    const mat = d.mat.clone();
    if (mat.isMeshStandardMaterial) { SOLO_MATS3.push(mat); if (ENV3) mat.envMap = ENV3; }
    if (d.tint) mat.color.set(outfit[d.tint] || '#ffffff').multiplyScalar(d.tint === 'hair' ? 1 / V3.neutral : 1);
    const o = new THREE.Mesh(d.geo, mat);
    o.userData.tint = d.tint || null;
    o.receiveShadow = true;
    o.visible = !!gear[d.name];
    rig.b[d.bone].add(o);
    (parts[d.name] || (parts[d.name] = [])).push(o);
  }
  return {
    rig, root: rig.root, parts, v3: true,
    // nama biasa: nyala/mati. 'helmet' / 'vest': on = tingkat (0–3) → bagian helmet1..3 / vest1..3
    setGear(name, on) {
      if (parts[name]) { for (const o of parts[name]) o.visible = !!on; return; }
      const lv = on === true ? 1 : on | 0;
      for (let k = 1; k <= 3; k++) { const P = parts[name + k]; if (P) for (const o of P) o.visible = lv === k; }
    },
    // ganti pakaian (mis. skin): palet tubuh + warna bagian kaku yang ikut warna pakaian (rambut, helm/rompi, ransel)
    setOutfit(o) {
      writePalette3(store.data, 0, o);
      for (const k in parts) for (const m of parts[k]) { const t = m.userData.tint; if (t && o[t]) m.material.color.set(o[t]).multiplyScalar(t === 'hair' ? 1 / V3.neutral : 1); }
    },
  };
}

// ---------- Kerumunan (bot) ----------
// Tanpa alokasi per frame; buffer instans diunggah hanya bila isinya berubah dan hanya rentang yang terpakai.
function upRange3(attr, rng, count) { rng.count = count; attr.updateRanges.length = 0; attr.updateRanges.push(rng); attr.needsUpdate = true; }
function createCrowd3(scene, n) {
  BUILT = true;
  const store = new SkinStore(n), data = store.data, D = defs3();
  const mk = (geo, mat) => { const m = new THREE.SkinnedMesh(geo, mat); m.skeleton = store; m.frustumCulled = false; m.boundingSphere = FAR_SPHERE3; m.matrixAutoUpdate = false; m.visible = false; scene.add(m); return m; };
  const slot = (mesh, geo) => { const rows = geo.getAttribute('aRow'); rows.array.fill(-1); return { mesh, geo, rows, arr: rows.array, k: 0, pk: 0, dirty: false, rng: { start: 0, count: 0 } }; };
  const body = [], shadow = [], all = [];
  for (const v of V3.variants) {
    const L = v.lods.map((src) => { const g = instGeo3(src, n, BODY_ATTR), m = mk(g, v.mat); m.receiveShadow = true; return slot(m, g); });
    body.push(L);
    const sg = instGeo3(v.lods[Math.min(2, v.lods.length - 1)], n, SHADOW_ATTR), sm = mk(sg, SHADOW_MAT3);
    sm.layers.set(3); // pembuat bayangan dinamis saja (tidak digambar kamera utama)
    shadow.push(slot(sm, sg));
    all.push(...L, shadow[shadow.length - 1]);
  }
  // bagian kaku: InstancedMesh dipadatkan (count = yang tampil)
  const white = new THREE.Color(1, 1, 1);
  const gear = D.map((d) => {
    const im = new THREE.InstancedMesh(d.geo, d.mat, n);
    im.frustumCulled = false; im.matrixAutoUpdate = false; im.receiveShadow = true; im.count = 0; im.visible = false;
    if (d.tint) im.setColorAt(0, white);
    scene.add(im);
    return { im, d, k: 0, pk: 0, m: im.instanceMatrix.array, c: d.tint ? im.instanceColor.array : null, own: new Int16Array(n).fill(-1), dirty: false, cdirty: false, rm: { start: 0, count: 0 }, rc: { start: 0, count: 0 } };
  });
  const hairIx = V3.variants.map((v, vi) => v.hair.map((h, si) => [0, 1].map((li) => D.findIndex((d) => d.name === 'hair' && d.variant === vi && d.style === si && d.lod === li))));
  // indeks bagian kaku per varian tubuh: senjata (per jenis), helm/rompi (per tingkat), ransel
  const gix = V3.variants.map((v, vi) => {
    const o = { gun: {}, helmet: [-1, -1, -1, -1], vest: [-1, -1, -1, -1], pack: -1 };
    D.forEach((d, i) => {
      if (d.variant >= 0 && d.variant !== vi) return;
      if (d.name.startsWith('gun_')) o.gun[d.name.slice(4)] = i;
      else if (/^helmet[1-3]$/.test(d.name)) o.helmet[+d.name[6]] = i;
      else if (/^vest[1-3]$/.test(d.name)) o.vest[+d.name[4]] = i;
      else if (d.name === 'pack') o.pack = i;
    });
    return o;
  });
  const variant = new Uint8Array(n), hairSt = new Uint8Array(n), vis = new Uint8Array(n), dist = new Float32Array(n), near = new Uint8Array(n), moved = new Uint8Array(n);
  const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n), px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
  const tint = new Float32Array(n * 9), c0 = new Int16Array(n), c1 = new Int16Array(n);
  let zoomK = 1, hasFr = false, texDirty = true, legacy = false;
  // Pemanasan: sampai flush() pertama, tiap mesh menggambar satu instans kosong (matriks nol → tanpa piksel) supaya
  // program shader & tekstur sudah siap sejak layar menu, bukan tersendat saat bot pertama muncul.
  for (const s of all) { s.arr[0] = 0; s.geo.instanceCount = 1; s.mesh.visible = true; s.pk = 1; }
  for (const g of gear) { g.im.setMatrixAt(0, ZERO); g.im.count = 1; g.im.visible = true; g.pk = 1; }
  function addGear(gi, rig, i, t) {
    const g = gear[gi], q = g.k++, fresh = g.own[q] !== i;
    if (!fresh && !moved[i]) return;
    const e = rig.b[g.d.bone].matrixWorld.elements, m = g.m, o = q * 16;
    for (let j = 0; j < 16; j++) m[o + j] = e[j];
    m[o + 12] += cx[i] - px[i]; m[o + 13] += cy[i] - py[i]; m[o + 14] += cz[i] - pz[i];
    g.dirty = true;
    if (fresh) {
      g.own[q] = i;
      if (g.c) { const a = q * 3, s = i * 9 + t * 3; g.c[a] = tint[s]; g.c[a + 1] = tint[s + 1]; g.c[a + 2] = tint[s + 2]; g.cdirty = true; }
    }
  }
  function sortByDist(a, m) { for (let i = 1; i < m; i++) { const v = a[i], dv = dist[v]; let j = i - 1; while (j >= 0 && dist[a[j]] > dv) { a[j + 1] = a[j]; j--; } a[j + 1] = v; } }
  function push(s, i) { const q = s.k++; if (s.arr[q] !== i) { s.arr[q] = i; s.dirty = true; } }
  return {
    v3: true, store, body, shadow, gear,
    get meshes() { return [...all.map((s) => s.mesh), ...gear.map((g) => g.im)]; },
    // look: { variant, hair }; outfit: warna (lihat writePalette3) + hair, gear, pack
    setOutfit(i, outfit, look = {}) {
      variant[i] = variantIndex(look.variant);
      hairSt[i] = (look.hair || 0) % Math.max(1, V3.variants[variant[i]].hair.length);
      writePalette3(data, i, outfit);
      const k = 1 / V3.neutral, s = i * 9;
      _c3.set(outfit.hair || '#231c18'); tint[s] = _c3.r * k; tint[s + 1] = _c3.g * k; tint[s + 2] = _c3.b * k;
      _c3.set(outfit.gear || '#4c5340'); tint[s + 3] = _c3.r; tint[s + 4] = _c3.g; tint[s + 5] = _c3.b;
      _c3.set(outfit.pack || '#3a3d34'); tint[s + 6] = _c3.r; tint[s + 7] = _c3.g; tint[s + 8] = _c3.b;
      for (let j = 0; j < gear.length; j++) gear[j].own.fill(-1); // warna instans ditulis ulang
      texDirty = true;
    },
    // awal frame: kamera untuk pemilihan LOD & buang yang di luar layar (posisi/orientasi kamera frame ini)
    begin(camera) {
      for (let j = 0; j < all.length; j++) all[j].k = 0;
      for (let j = 0; j < gear.length; j++) gear[j].k = 0;
      hasFr = !!(camera && camera.isCamera);
      if (hasFr) {
        _m3.compose(camera.position, camera.quaternion, _one3).invert();
        _fr3.setFromProjectionMatrix(_m3.premultiply(camera.projectionMatrix));
        zoomK = camera.isPerspectiveCamera ? Math.tan(camera.fov * Math.PI / 360) / 0.7 : 1; // 0,7 = tan(35°): bidang pandang 70° = jarak apa adanya
        // mesh pembuat bayangan "berdiri" di posisi kamera: pass bayangan (map/realism.js) membuang pembuat bayangan yang
        // titik asalnya jauh dari fokus. Kulit ber-instans tidak terpengaruh (mode attached: matriks mesh saling meniadakan).
        for (let j = 0; j < shadow.length; j++) { const m = shadow[j].mesh; m.position.copy(camera.position); m.updateMatrix(); }
      } else zoomK = 1;
    },
    hide(i) { vis[i] = 0; },
    // antarmuka lama (createCrowd v2): write(i, rig, visible, gear) lalu flush() — tetap jalan kalau pemanggil belum diperbarui
    write(i, rig, visible, gear) {
      if (!legacy) { legacy = true; this.begin(null); }
      if (!visible || !rig) { vis[i] = 0; return; }
      let gun = null;
      for (const key in gear) if (gear[key] && key.length > 4 && key.startsWith('gun_')) gun = key.slice(4);
      const p = rig.root.position;
      this.put(i, rig, p.x, p.y, p.z, 30, true, true, gun, gear.helmet ? 2 : 0, gear.vest ? 2 : 0, !!gear.pack);
    },
    // di dalam layar? (bola 1,8 m di sekitar badan terhadap frustum kamera frame ini)
    inView(x, y, z) { if (!hasFr) return true; _sph3.center.set(x, y + 0.9, z); _sph3.radius = 1.8; return _fr3.intersectsSphere(_sph3); },
    // Karakter tampil. (x, y, z) = posisi akar sekarang; d = jarak ke kamera (m); posed = rig baru dipose frame ini
    // (kalau tidak, baris matriks hanya digeser mengikuti perpindahan akar); inF = hasil inView; gun = jenis senjata atau null.
    put(i, rig, x, y, z, d, posed, inF, gun, helmet, vest, pack) {
      if (posed) { writeRow3(data, i, rig); px[i] = cx[i] = x; py[i] = cy[i] = y; pz[i] = cz[i] = z; moved[i] = 1; texDirty = true; }
      else {
        const dx = x - cx[i], dy = y - cy[i], dz = z - cz[i];
        if (dx !== 0 || dy !== 0 || dz !== 0) { shiftRow3(data, i, dx, dy, dz); cx[i] = x; cy[i] = y; cz[i] = z; moved[i] = 1; texDirty = true; } else moved[i] = 0;
      }
      const de = d * zoomK;
      vis[i] = inF ? 1 : 2; dist[i] = de; near[i] = d < LOD3.shadow ? 1 : 0;
      if (!inF || de > LOD3.gun) return;
      const G = gix[variant[i]];
      if (gun) { const gi = G.gun[gun]; if (gi !== undefined) addGear(gi, rig, i, 0); }
      if (helmet > 0) { if (de < LOD3.helmet) { const gi = G.helmet[helmet > 3 ? 3 : helmet]; if (gi >= 0) addGear(gi, rig, i, 1); } }
      else if (de < LOD3.hair1) { const h = hairIx[variant[i]][hairSt[i]]; if (h) { const gi = h[de < LOD3.hair0 ? 0 : 1]; if (gi >= 0) addGear(gi, rig, i, 0); } }
      if (vest > 0 && de < LOD3.vest) { const gi = G.vest[vest > 3 ? 3 : vest]; if (gi >= 0) addGear(gi, rig, i, 1); }
      if (pack && de < LOD3.pack && G.pack >= 0) addGear(G.pack, rig, i, 2);
    },
    flush() {
      let n0 = 0, n1 = 0;
      for (let i = 0; i < n; i++) {
        const v = vis[i];
        if (v === 0) continue;
        if (near[i]) push(shadow[variant[i]], i);
        if (v !== 1) continue;
        const de = dist[i];
        if (de < LOD3.r0) c0[n0++] = i; else if (de < LOD3.r1) c1[n1++] = i; else { const B = body[variant[i]]; push(B[de < LOD3.r2 || B.length < 4 ? 2 : 3], i); }
      }
      if (n0 > LOD3.k0) { sortByDist(c0, n0); for (let j = LOD3.k0; j < n0; j++) c1[n1++] = c0[j]; n0 = LOD3.k0; }
      for (let j = 0; j < n0; j++) push(body[variant[c0[j]]][0], c0[j]);
      if (n1 > LOD3.k1) { sortByDist(c1, n1); for (let j = LOD3.k1; j < n1; j++) push(body[variant[c1[j]]][2], c1[j]); n1 = LOD3.k1; }
      for (let j = 0; j < n1; j++) push(body[variant[c1[j]]][1], c1[j]);
      for (let j = 0; j < all.length; j++) {
        const s = all[j];
        if (s.k !== s.pk) { s.geo.instanceCount = s.k; s.mesh.visible = s.k > 0; s.pk = s.k; }
        if (s.dirty) { if (s.k) upRange3(s.rows, s.rng, s.k); s.dirty = false; }
      }
      for (let j = 0; j < gear.length; j++) {
        const g = gear[j];
        if (g.k !== g.pk) { for (let q = g.k; q < g.pk; q++) g.own[q] = -1; g.im.count = g.k; g.im.visible = g.k > 0; g.pk = g.k; } // slot yang dilepas: isinya dianggap basi
        if (g.dirty) { if (g.k) upRange3(g.im.instanceMatrix, g.rm, g.k * 16); g.dirty = false; }
        if (g.cdirty) { if (g.k) upRange3(g.im.instanceColor, g.rc, g.k * 3); g.cdirty = false; }
      }
      if (texDirty) { store.boneTexture.needsUpdate = true; texDirty = false; }
      legacy = false;
    },
    // statistik (uji/pengukuran): instans per LOD & segitiga yang digambar frame ini
    stats() {
      const lod = [0, 0, 0, 0]; let tris = 0, sh = 0, st = 0, gt = 0;
      body.forEach((v, vi) => v.forEach((s, li) => { lod[li] += s.k; tris += s.k * V3.variants[vi].tris[li]; }));
      shadow.forEach((s, vi) => { sh += s.k; st += s.k * V3.variants[vi].tris[2]; });
      for (const g of gear) gt += g.k * (g.d.geo.index ? g.d.geo.index.count : g.d.geo.attributes.position.count) / 3;
      return { lod, tris, shadow: sh, shadowTris: st, gearTris: Math.round(gt), meshes: all.length + gear.length };
    },
  };
}
