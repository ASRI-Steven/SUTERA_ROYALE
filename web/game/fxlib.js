// Sutradara efek skin berbentuk (Skin v2): menerjemahkan kejadian game (tembak, isi ulang, cabut, periksa, kill, finisher)
// menjadi kartu berbentuk (game/shapefx.js + atlas game/fxshapes.js) menurut tema skin senjata yang dipakai pemain
// (GUN_SKINS[i].th.fx.id). Skin tanpa `fx` & bot: tidak ada apa-apa. Dua lapisan: `V` di adegan senjata orang pertama
// (menempel senjata), `W` di dunia (kartu yang lepas, dampak, finisher, etalase lobi).
// Setelan pemain "Efek skin" (localStorage royale.skinfx): penuh | ringkas | mati.
// main.js: createSkinFx({ scene, camera }) → lihat objek yang dikembalikan make(). Gagal dibuat → objek tanpa-kerja.
// Tema (THEMES): merak (M1) + garuda, magma, plasma, es, neon, songket, keris, petir, holo, mutiara (M2). Tiap tema:
// cells (sel atlas yang dipakai; dibangun saat tema dipasang/diperagakan), fire, fireWorld, impact, cue, equip, inspect,
// killGun, finisher, knock (+ cas = selongsong pengganti, brass = warna selongsong).
import * as THREE from 'three';
import { createFxAtlas } from './fxshapes.js';
import { createShapeLayer, PRESET as P, PRESETS } from './shapefx.js';

const D2R = Math.PI / 180, TAU = Math.PI * 2, VM_TAN = Math.tan(27 * D2R); // kamera senjata orang pertama: FOV 54°
export const SKINFX_LEVELS = ['mati', 'ringkas', 'penuh'];
const BILL = new Set(Object.keys(PRESETS).filter((n) => PRESETS[n][0] === 3).map((n) => P[n])); // preset billboard: kecepatan = gerak, bukan sumbu
const DARTS = new Set(Object.keys(PRESETS).filter((n) => PRESETS[n][0] === 1).map((n) => P[n])); // preset lesat
const NOOP_NAMES = ['attachVm', 'setThemes', 'setLight', 'setShade', 'setLevel', 'fire', 'cue', 'event', 'impact', 'kill', 'knock', 'show', 'demo', 'update', 'compile', 'warm'];

export function createSkinFx(o) {
  try { return make(o); }
  catch (e) {
    console.warn('Efek skin berbentuk dimatikan:', e.message);
    const n = { level: 2, stats: () => ({ vm: { alive: 0, peak: 0, emitted: 0 }, world: { alive: 0, peak: 0, emitted: 0 } }), hook: () => false, has: () => false, features: () => [], brass: () => null, themeName: () => null };
    for (const k of NOOP_NAMES) n[k] = () => {};
    return n;
  }
}

function make({ scene, camera }) {
  const atlas = createFxAtlas();
  const W = createShapeLayer({ max: 384, atlas, vm: false });
  scene.add(W.group);
  let V = null, vm = null, theme = null, level = 2, shots = 0, impacts = 0, casN = 0, LQ = 1, pendEquip = 0;
  try { const s = localStorage.getItem('royale.skinfx'), i = SKINFX_LEVELS.indexOf(s); if (i >= 0) level = i; } catch (e) { /* abaikan */ }
  const cell = {}; for (const n of atlas.names) cell[n] = atlas.cell(n);
  const pal = {}; for (const n of ['merak', 'emas', 'garuda', 'magma', 'abu', 'plasma', 'es', 'neon', 'songket', 'keris', 'petir', 'holoC', 'holoM', 'holoY', 'spektrum', 'mutiara', 'laut']) pal[n] = atlas.palRow(n);
  const HOLO = [pal.holoC, pal.holoM, pal.holoY];
  // jangkar senjata: A = orang pertama (diisi vm.anchors tiap frame), S = etalase lobi. a = "atas", b = "samping" di ruang
  // senjata, dipilih supaya bidang (a, b) menghadap kamera: A → sumbu layar (kipas selalu condong ke kanan-luar layar,
  // apa pun pose senjata), S → atas dunia × kanan kamera lobi. sp/sz = pengali laju/ukuran (etalase lebih pelan, ADS lebih
  // kecil), f0/f1 = rentang sudut kipas di senjata.
  const mk = () => ({ gun: new THREE.Matrix4(), muzzle: new THREE.Vector3(), port: new THREE.Vector3(), mag: new THREE.Vector3(), top: new THREE.Vector3(), mag0: new THREE.Vector3(), c: new THREE.Vector3(0, 0, 1), kind: 'ar', ads: 0, scoped: false, a: new THREE.Vector3(0, 1, 0), b: new THREE.Vector3(1, 0, 0), ok: false, sp: 1, sz: 1, fw: 1, f0: 8, f1: 98, show: false });
  const A = mk(), S = mk();
  S.sp = 0.3; S.fw = 0.15; S.f0 = -45; S.f1 = 45; S.show = true;
  let showObj = null;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), cSun = new THREE.Color(0.55, 0.52, 0.46), cAmb = new THREE.Color(0.5, 0.52, 0.56);
  const ZERO = new THREE.Vector3();
  const rr = (L, a, b) => a + L.rand() * (b - a);
  const q = () => (level === 1 ? 0.5 : 1); // Ringkas: jumlah kartu setengah
  const cnt = (L, n) => { const x = n * q() * LQ, f = Math.floor(x); return f + (L.rand() < x - f ? 1 : 0); };
  const qn = (n, min = 1) => Math.max(min, Math.round(n * q() * LQ)); // jumlah terstruktur (bilah kipas, cincin kristal)
  const vmL = (L) => L === V;

  // ---------- kata kerja ruang senjata (jangkar 1) ----------
  // kipas bilah di titik p: sudut from..to (derajat dari R.a ke arah R.b), buka → tahan → (bilah genap menutup & larut, bilah
  // ganjil lepas melayang bila `rel`)
  function gunFan(L, R, p, shape, n, len, from, to, hold, preset, rel, gain, d0, flip, pl, asp = 0.5) {
    const out = preset === P.fanBig ? 0.7 : preset === P.fanFast ? 0.16 : 0.34;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0.5, th = (from + (to - from) * u) * D2R, sn = Math.abs(u - 0.5) * 2, dl = d0 + sn * 0.07, ln = len * (1 - 0.14 * sn);
      const odd = rel && (i & 1);
      L.emit(p.x, p.y, p.z, R.b.x, R.b.y, R.b.z, R.a.x * flip, R.a.y * flip, R.a.z * flip, 0, ln, asp, odd ? P.fanHold : preset, sn, pl, gain, 1, th, shape, odd ? hold - dl : hold + out - dl, dl);
      if (odd) { // lepas: kartu melayang mulai dari pose bilah saat itu
        const c = Math.cos(th), s = Math.sin(th), dx = (R.a.x * c * flip + R.b.x * s), dy = (R.a.y * c * flip + R.b.y * s), dz = (R.a.z * c * flip + R.b.z * s);
        L.emit(p.x, p.y, p.z, dx * rel, dy * rel + rel * 0.6, dz * rel, dx, dy, dz, 0, ln, asp, vmL(L) ? P.driftVm : P.rise, L.rand(), pl, gain, 1, -999, shape, vmL(L) ? 0.6 : 0.75, hold);
      }
    }
  }
  // kartu lepas dari titik p (ruang senjata) dengan kecepatan dasar (vx, vy, vz) ± sebar
  function gunShed(L, p, shape, n, size, vx, vy, vz, spread, preset, life, gain, delay, pl, asp = 0.5, step = 0.03) {
    for (let i = 0; i < n; i++) L.emit(p.x, p.y, p.z, vx + rr(L, -spread, spread), vy + rr(L, -spread, spread), vz + rr(L, -spread, spread), rr(L, -0.4, 0.4), 1, rr(L, -0.4, 0.4), rr(L, -0.6, 0.6), size * rr(L, 0.85, 1.15), asp, preset, L.rand(), pl, gain, 1, -999, shape, life * rr(L, 0.85, 1.1), delay + i * step);
  }
  // kilas billboard di titik p (boleh bergerak: v, ruang senjata)
  const pop = (L, p, shape, size, pl, gain, life, preset = P.pop, delay = 0, v = ZERO, asp = 1, ang = 0, an = 1) => L.emit(p.x, p.y, p.z, v.x, v.y, v.z, 0, 1, 0, ang, size, asp, preset, L.rand(), pl, gain, an, 0, shape, life, delay);
  // semburan dari titik p menjauhi pusat layar (kanan-atas layar) + sedikit ke depan laras
  function spray(L, R, p, shape, n, size, s0, s1, pl, preset, life, gain = 1, asp = 0.5, fwd = 0.6, delay = 0, step = 0.02) {
    for (let i = 0; i < n; i++) {
      const sp = rr(L, s0, s1) * R.sp, ph = rr(L, -0.2, 1.15), lx = Math.cos(ph), ly = Math.sin(ph), f = fwd * R.fw * rr(L, 0.6, 1.2);
      L.emit(p.x, p.y, p.z, (R.b.x * lx + R.a.x * ly) * sp, (R.b.y * lx + R.a.y * ly) * sp, (R.b.z * lx + R.a.z * ly - f) * sp, R.a.x, R.a.y, R.a.z, rr(L, 0, TAU), size * rr(L, 0.88, 1.12) * R.sz, asp, preset, L.rand(), pl, gain, 1, 0, shape, life, delay + i * step);
    }
  }
  // deret kartu sepanjang punggung senjata, popor → moncong, bergiliran. lift = angkat di atas laras (kartu billboard: ±½ ukuran)
  function gunRun(L, R, shape, n, size, pl, preset, life, step, gain = 1.2, asp = 0.5, aux = 0, d0 = 0, lift = 0.01, u0 = 0, u1 = 1) {
    for (let i = 0; i < n; i++) {
      const u = u0 + (u1 - u0) * (n > 1 ? i / (n - 1) : 0.5), z = R.top.z + 0.07 + (R.muzzle.z * 0.9 - R.top.z - 0.07) * u, y = R.top.y - 0.032 + (R.muzzle.y + 0.044 - R.top.y) * u + lift;
      const k = BILL.has(preset) || DARTS.has(preset) ? 0 : -1;
      L.emit(0, y, z, R.b.x * k, R.b.y * k, R.b.z * k - (DARTS.has(preset) ? 0.7 : 0), R.a.x, R.a.y, R.a.z, 0, size, asp, preset, 0.3 + 0.4 * L.rand(), pl, gain, 1, aux, shape, life, d0 + i * step);
    }
  }
  // kartu mengitari sumbu laras di z (radius rad, laju sudut w rad/dtk, laju maju vz, tumbuh radius dr)
  function gunOrbit(L, R, z, shape, n, size, rad, w, pl, preset, life, gain = 1.2, asp = 1, vz = 0, d0 = 0, dr = 0, step = 0) {
    for (let i = 0; i < n; i++) L.emit(0, R.muzzle.y, z, vz, w, dr, 0, 0, -1, i / n * TAU, size, asp, preset, L.rand(), pl, gain, 1, rad, shape, life, d0 + i * step);
  }
  // cap pada bidang (a, b) senjata di titik p: skala from → 1 (from > 1 = mengerut)
  const gunStamp = (L, R, p, shape, size, pl, gain, life, from = 0.2, delay = 0, preset = P.stamp, ang = 0) => L.emit(p.x, p.y, p.z, R.b.x, R.b.y, R.b.z, R.a.x, R.a.y, R.a.z, ang, size, 1, preset, 0, pl, gain, 1, from, shape, life, delay);
  // kartu tegak pada arah (dx, dy, dz) di titik p (lidah api, kristal, kilat)
  const gunUp = (L, p, dx, dy, dz, shape, size, pl, preset, life, gain = 1.4, asp = 0.5, delay = 0) => L.emit(p.x, p.y, p.z, 0, 0, 0, dx, dy, dz, 0, size, asp, preset, L.rand(), pl, gain, 1, 0, shape, life, delay);

  // ---------- kata kerja dunia (jangkar 0) ----------
  const stamp = (p, y, shape, size, pl, gain, life, preset = P.stamp, from = 0.2, delay = 0, ang = 0) => W.emit(p.x, p.y + y, p.z, 0, 0, 1, 1, 0, 0, ang, size, 1, preset, 0, pl, gain, 0, from, shape, life, delay);
  function burst(p, y, shape, n, s0, s1, h0, h1, u0, u1, pl, preset, life, gain = 1, floorY = -999, asp = 0.5, delay = 0, step = 0) {
    n = cnt(W, n);
    for (let i = 0; i < n; i++) { const a = W.rand() * TAU, sp = rr(W, h0, h1); W.emit(p.x, p.y + y, p.z, Math.cos(a) * sp, rr(W, u0, u1), Math.sin(a) * sp, rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), rr(W, -0.6, 0.6), rr(W, s0, s1), asp, preset, W.rand(), pl, gain, 0, floorY, shape, life * rr(W, 0.85, 1.1), delay + i * step); }
  }
  function helix(p, y, shape, n, r, vy, w, size, pl, preset, life, gain = 1.2, asp = 0.5, dr = 0, delay = 0, step = 0) {
    n = qn(n, 2);
    for (let i = 0; i < n; i++) W.emit(p.x, p.y + y, p.z, vy, w, dr, 0, 1, 0, i / n * TAU, size, asp, preset, W.rand(), pl, gain, 0, r, shape, life, delay + i * step);
  }
  function growRing(p, y, shape, n, r, h0, h1, lean, pl, preset, life, gain = 1, asp = 0.5, delay = 0, step = 0.04, a0 = 0) {
    n = qn(n, 3);
    for (let i = 0; i < n; i++) { const a = a0 + (i + rr(W, -0.2, 0.2)) / n * TAU, c = Math.cos(a), s = Math.sin(a); W.emit(p.x + c * r, p.y + y, p.z + s * r, 0, 0, 0, c * lean, 1, s * lean, 0, rr(W, h0, h1), asp, preset, W.rand(), pl, gain, 0, 0, shape, life, delay + i * step); }
  }
  const beam = (p, y, size, asp, pl, gain, life, delay = 0, shape = cell.pilar, preset = P.beam) => W.emit(p.x, p.y + y, p.z, 0, 0, 0, 0, 1, 0, 0, size, asp, preset, W.rand(), pl, gain, 0, 0, shape, life, delay);
  const wpop = (p, y, shape, size, pl, gain, life, preset = P.bloom, delay = 0, vy = 0, asp = 1, ang = 0) => W.emit(p.x, p.y + y, p.z, 0, vy, 0, 0, 1, 0, ang, size, asp, preset, W.rand(), pl, gain, 0, 0, shape, life, delay);
  // kipas berdiri di belakang korban (F = bingkai finisher): bilah th0..th1 derajat dari tegak ke arah samping F.s
  function wFan(F, ox, fwd, y, shape, pl, N, lmin, lmax, th0, th1, d0, hold, gain, rel, asp = 0.46, total = 1.9, stag = 0.33) {
    const px = F.cx + F.sx * ox - F.bx * fwd, pz = F.cz + F.sz * ox - F.bz * fwd;
    for (let i = 0; i < N; i++) {
      const u = N > 1 ? i / (N - 1) : 0.5, th = (th0 + (th1 - th0) * u) * D2R, sn = Math.abs(u * 2 - 1), dl = d0 + sn * stag, ln = lmin + (lmax - lmin) * (1 - sn * sn), odd = rel && (i & 1);
      W.emit(px, y, pz, F.sx, 0, F.sz, 0, 1, 0, 0, ln, asp, odd ? P.fanHold : P.fanBig, sn, pl, gain, 0, th, shape, odd ? hold - dl : total - dl, dl);
      if (odd && F.lod < 2) { const c = Math.cos(th), s = Math.sin(th); W.emit(px, y, pz, F.sx * s * 0.7, c * 0.5 + 0.9, F.sz * s * 0.7, F.sx * s, c, F.sz * s, 0, ln, asp, P.rise, W.rand(), pl, gain, 0, -999, shape, 0.75, hold); }
    }
  }
  // selongsong pengganti bawaan: tiap selongsong ke-`every` jadi kartu `shape` (ruang kamera, jangkar 0)
  function casing(L, p, i, T) {
    const c = T.cas;
    if (!c || i % c[4] !== c[4] - 1) return false;
    L.emit(p.x, p.y, p.z, rr(L, 1.2, 2.2), rr(L, 0.9, 1.7), rr(L, 0.1, 0.6), 0.3, 1, 0, 0, c[2], c[5] || 0.5, c[3], L.rand(), c[1], 1.2, 0, -999, c[0], 0.8);
    return true;
  }
  function knockDef(p, T) { const k = T.kn; stamp(p, 0.05, k[0], k[3] || 1.7, k[2], 1.4, 0.7); burst(p, 0.5, k[1], 4, 0.16, 0.22, 0.4, 1.6, 1.2, 2.4, k[2], k[4] || P.drop, 0.7, 1, p.y, k[5] || 0.5); }

  // ---------- tema ----------
  // R = jangkar senjata (A atau S), L = lapisan (V atau W). Semua ukuran meter di ruang senjata.
  // finisher(p, F, tier): p = kaki korban, F = { cx, cz (0,5 m di belakang korban), sx, sz (samping), bx, bz (menjauhi
  // pembunuh), lod }, tier 0/1/2 = kill beruntun 1–2 / 3–4 / ≥5.
  const THEMES = {
    // ===== Dadak Merak (legendaris) =====
    merak: {
      name: 'Dadak Merak', finisher: 'Dadak Merak', brass: '#58c7a4',
      cells: ['bulu_merak', 'bulu_kecil', 'mata_merak', 'cincin', 'garis', 'pilar'],
      cas: null, kn: null,
      fire(L, R, n) {
        const m = R.muzzle, ads = R.ads > 0.5;
        pop(L, m, cell.mata_merak, ads ? 0.05 : 0.1, pal.merak, 2.2, 0.1, P.pop, 0, ZERO, 1, L.rand() * TAU);
        if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
        spray(L, R, m, cell.bulu_merak, 1, R.show ? 0.2 : 0.16, 1.5, 2.3, pal.merak, P.dart, 0.46, 1, 0.5, 0.3); // satu bulu melesat ke kanan-atas layar
      },
      // bulu yang lepas ke dunia dari moncong (p, arah d): melambat lalu melayang turun berayun
      fireWorld(p, d, n, k, floorY, sp) {
        for (let i = 0; i < n; i++) {
          const s = rr(W, 2.6, 4.6) * sp;
          W.emit(p.x, p.y, p.z, d.x * s + rr(W, -0.9, 0.9) * sp, d.y * s + rr(W, 0.3, 1.3) * sp, d.z * s + rr(W, -0.9, 0.9) * sp, rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), rr(W, -0.5, 0.5), rr(W, 0.2, 0.26) * k, 0.5, P.drift, W.rand(), pal.merak, 0.9, 0, floorY, cell.bulu_merak, 1.4);
        }
      },
      impact(p, d, full) {
        W.emit(p.x - d.x * 0.04, p.y - d.y * 0.04, p.z - d.z * 0.04, 0, 0, 0, 0, 1, 0, W.rand() * TAU, 0.22, 1, P.bloom, 0, pal.merak, 1.6, 0, 0, cell.mata_merak, 0.37);
        if (!full) return;
        const n = cnt(W, 3);
        for (let i = 0; i < n; i++) W.emit(p.x - d.x * 0.05, p.y - d.y * 0.05, p.z - d.z * 0.05, -d.x * 1.6 + rr(W, -1.4, 1.4), rr(W, 0.8, 2.4), -d.z * 1.6 + rr(W, -1.4, 1.4), rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), 0, rr(W, 0.1, 0.14), 0.5, P.drop, W.rand(), pal.merak, 0.8, 0, -999, cell.bulu_kecil, 0.7);
      },
      casing(L, p, i) { // tiap selongsong ke-3 jadi bulu kecil berputar (ruang kamera, jangkar 0)
        if (i % 3 !== 2) return false;
        L.emit(p.x, p.y, p.z, rr(L, 1.2, 2.2), rr(L, 0.9, 1.7), rr(L, 0.1, 0.6), 0.3, 1, 0, 0, 0.05, 0.5, P.dropVm, L.rand(), pal.merak, 1, 0, -999, cell.bulu_kecil, 0.8);
        return true;
      },
      cue(L, R, ev, k) {
        if (ev === 'out') gunShed(L, R.mag, cell.bulu_kecil, cnt(L, 3 * k), 0.06, 0, -0.25, 0, 0.18, vmL(L) ? P.dropVm : P.drop, 0.6, 1, 0, pal.merak);
        else if (ev === 'in') { // dua kipas kecil mekar ke kiri-kanan lubang magasin (bukan lurus ke bawah: tertutup magasinnya sendiri)
          const nb = Math.max(2, cnt(L, 3 * k));
          gunFan(L, R, R.mag, cell.bulu_kecil, nb, 0.07, 50, 115, 0.3, P.fanFast, 0, 1.2, 0, -1, pal.merak); gunFan(L, R, R.mag, cell.bulu_kecil, nb, 0.07, -50, -115, 0.3, P.fanFast, 0, 1.2, 0, -1, pal.merak);
        } else if (ev === 'bolt') {
          spray(L, R, R.port, cell.bulu_merak, Math.max(1, cnt(L, 2 * k)), 0.085, 1.3, 2.0, pal.merak, P.dart, 0.4, 1, 0.5, 0.1, 0, 0.04);
          pop(L, R.port, cell.mata_merak, 0.045, pal.merak, 2, 0.12);
        }
      },
      equip(L, R) { gunFan(L, R, R.top, cell.bulu_merak, qn(7, 4), 0.105, R.f0, R.f1, 0.42, P.fanFast, 0, 1.2, 0, 1, pal.merak); },
      inspect(L, R) { // ombak 5 bulu sepanjang laras: rebah → tegak → rebah bergiliran; satu bulu kecil lepas
        gunRun(L, R, cell.bulu_merak, qn(5, 3), 0.11, pal.merak, P.wave, 0.62, 0.12, 1.1, 0.5, 0, 0.1, 0);
        gunShed(L, R.top, cell.bulu_kecil, 1, 0.06, 0.12, 0.1, 0, 0.05, vmL(L) ? P.driftVm : P.drift, 1.0, 1, 0.5, pal.merak);
      },
      // kill di senjata: kipas bulu merak di kanan-atas receiver (tiga tingkat), ADS: dua bulu menyembur di samping moncong
      killGun(L, R, tier, head) {
        if (R.ads > 0.5) { spray(L, R, R.muzzle, cell.bulu_merak, 2, 0.07, 1.2, 1.8, pal.merak, P.dart, 0.45); return; }
        const N = qn([7, 9, 11][tier] + (head ? 2 : 0), 5), len = R.show ? [0.11, 0.12, 0.13][tier] : [0.085, 0.095, 0.105][tier];
        v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.025);
        gunFan(L, R, v3, cell.bulu_merak, N, len, R.f0, R.f1, 0.95, P.fan, 0.35, 1.3, 0.05, 1, pal.merak);
        if (tier === 2) gunFan(L, R, v3, cell.bulu_merak, qn(6, 3), len * 0.62, R.f0 + 8, R.f1 - 10, 0.95, P.fan, 0, 1.3, 0.12, 1, pal.merak);
        pop(L, v3, cell.mata_merak, 0.05 + 0.012 * tier, pal.merak, 2.4, 0.5, P.glint, 0.05);
      },
      // finisher "Dadak Merak": kipas raksasa berdiri 0,5 m di belakang korban
      finisher(p, F, tier) {
        const y0 = p.y + 0.35, c = v1.set(F.cx, p.y, F.cz);
        stamp(p, 0.05, cell.mata_merak, 3.2 + 0.4 * tier, pal.merak, 1.5, 1.7, P.stamp, 0.19);
        stamp(p, 0.06, cell.cincin, 3.6 + 0.6 * tier, pal.merak, 1.6, 1.0, P.ring, 0.1, 0.02);
        wFan(F, 0, 0, y0, cell.bulu_merak, pal.merak, qn([13, 17, 17][tier], 7), 1.9, 2.4, -80, 80, 0.05, 1.2, 1.3, true);
        if (tier >= 1) {
          wFan(F, 0, 0.06, y0, cell.bulu_merak, pal.merak, qn(7, 4), 1.0, 1.2, -62, 62, 0.16, 1.25, 1.5, true);
          if (F.lod < 2) for (let i = 0; i < qn(8); i++) { const a = (i / 7 * 2 - 1) * 1.1; W.emit(F.cx, y0 + 0.3, F.cz, F.sx * Math.sin(a) * 4, Math.cos(a) * 4 + 1, F.sz * Math.sin(a) * 4, 0, 1, 0, 0, 0.7, 0.2, P.streak, W.rand(), pal.emas, 2.4, 0, 0, cell.garis, 0.7, 0.42); }
        }
        if (tier >= 2) {
          wFan(F, -1.35, -0.05, y0, cell.bulu_merak, pal.merak, qn(7, 4), 1.1, 1.4, -55, 55, 0.22, 1.2, 1.3, true); wFan(F, 1.35, -0.05, y0, cell.bulu_merak, pal.merak, qn(7, 4), 1.1, 1.4, -55, 55, 0.22, 1.2, 1.3, true);
          beam(c, 0.1, 6, 0.16, pal.merak, 1.6, 1.5, 0.1);
        }
        if (F.lod === 0) for (let i = 0; i < cnt(W, 10); i++) W.emit(p.x + rr(W, -1.3, 1.3), p.y + rr(W, 1.6, 2.9), p.z + rr(W, -1.3, 1.3), rr(W, -0.5, 0.5), rr(W, -0.2, 0.6), rr(W, -0.5, 0.5), rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), 0, rr(W, 0.16, 0.22), 0.5, P.drift, W.rand(), pal.merak, 0.9, 0, p.y, cell.bulu_kecil, rr(W, 1.3, 1.9), 0.3 + i * 0.06);
      },
      knock(p) {
        stamp(p, 0.05, cell.mata_merak, 1.7, pal.merak, 1.4, 0.7);
        burst(p, 0.5, cell.bulu_kecil, 4, 0.16, 0.2, 0.3, 1.6, 1.2, 2.4, pal.merak, P.drop, 0.7, 0.9, p.y);
      },
    },
  };
  // tema M2 ditambahkan di bawah (satu blok per tema)
  // kartu yang lepas ke dunia dari moncong (p, arah d)
  function wShed(p, d, n, shape, s0, s1, pl, preset, life, k, floorY, sp, gain = 1, asp = 0.5, v0 = 2.6, v1 = 4.6, up0 = 0.3, up1 = 1.3) {
    for (let i = 0; i < n; i++) { const s = rr(W, v0, v1) * sp; W.emit(p.x, p.y, p.z, d.x * s + rr(W, -0.9, 0.9) * sp, d.y * s + rr(W, up0, up1) * sp, d.z * s + rr(W, -0.9, 0.9) * sp, rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), rr(W, -0.5, 0.5), rr(W, s0, s1) * k, asp, preset, W.rand(), pl, gain, 0, floorY, shape, life); }
  }
  // cap dampak billboard di titik kena + pentalan
  const hit = (p, d, shape, size, pl, gain, life, preset = P.bloom, delay = 0, asp = 1) => W.emit(p.x - d.x * 0.04, p.y - d.y * 0.04, p.z - d.z * 0.04, 0, 0, 0, 0, 1, 0, W.rand() * TAU, size, asp, preset, W.rand(), pl, gain, 0, 0, shape, life, delay);
  function ricochet(p, d, shape, n, s0, s1, pl, preset, life, gain = 1, asp = 0.5) {
    n = cnt(W, n);
    for (let i = 0; i < n; i++) W.emit(p.x - d.x * 0.05, p.y - d.y * 0.05, p.z - d.z * 0.05, -d.x * 1.6 + rr(W, -1.4, 1.4), rr(W, 0.8, 2.4), -d.z * 1.6 + rr(W, -1.4, 1.4), rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), 0, rr(W, s0, s1), asp, preset, W.rand(), pl, gain, 0, -999, shape, life);
  }
  const dropP = (L) => (vmL(L) ? P.dropVm : P.drop), driftP = (L) => (vmL(L) ? P.driftVm : P.drift);
  const VZ = new THREE.Vector3();

  // ===== Emas Garuda (legendaris): bulu elang emas & sepasang sayap (hanya sayap, bukan lambang) =====
  THEMES.garuda = {
    name: 'Emas Garuda', finisher: 'Sayap Garuda', brass: '#ffc64a',
    cells: ['bulu_elang', 'kilau4', 'cincin', 'pilar'], cas: null, kn: [cell.cincin, cell.bulu_elang, pal.garuda],
    wings(L, R, p, n, len, hold, preset, gain = 1.3, d0 = 0) { // sepasang sayap: dua kipas cermin
      gunFan(L, R, p, cell.bulu_elang, n, len, 28, 96, hold, preset, 0, gain, d0, 1, pal.garuda); gunFan(L, R, p, cell.bulu_elang, n, len * (R.show ? 1 : 0.8), -28, -96, hold, preset, 0, gain, d0, 1, pal.garuda);
    },
    fire(L, R, n) {
      const ads = R.ads > 0.5;
      pop(L, R.muzzle, cell.kilau4, ads ? 0.06 : 0.13, pal.emas, 2.6, 0.1, P.pop, 0, ZERO, 1, L.rand() * TAU);
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, R.muzzle, cell.bulu_elang, 1, R.show ? 0.2 : 0.15, 2.0, 2.8, pal.garuda, P.dart, 0.42, 1.2, 0.5, 0.5);
    },
    fireWorld(p, d, n, k, floorY, sp) { wShed(p, d, Math.max(1, n - 1), cell.bulu_elang, 0.2, 0.26, pal.garuda, P.drift, 1.2, k, floorY, sp, 1.1); },
    impact(p, d, full) { hit(p, d, cell.kilau4, 0.26, pal.emas, 2, 0.35); if (full) ricochet(p, d, cell.bulu_elang, 3, 0.11, 0.15, pal.garuda, P.drop, 0.7); },
    cue(L, R, ev, k) {
      if (ev === 'out') gunShed(L, R.mag, cell.bulu_elang, cnt(L, 2 * k), 0.065, 0, -0.25, 0, 0.16, dropP(L), 0.6, 1, 0, pal.garuda);
      else if (ev === 'in') { gunFan(L, R, R.mag, cell.bulu_elang, 3, 0.065, 50, 110, 0.25, P.fanFast, 0, 1.3, 0, -1, pal.garuda); gunFan(L, R, R.mag, cell.bulu_elang, 3, 0.065, -50, -110, 0.25, P.fanFast, 0, 1.3, 0, -1, pal.garuda); pop(L, R.mag, cell.kilau4, 0.05, pal.emas, 2.4, 0.3, P.glint); }
      else if (ev === 'bolt') this.wings(L, R, R.top, 3, 0.07, 0.16, P.fanFast);
    },
    equip(L, R) { this.wings(L, R, R.top, 3, 0.12, 0.3, P.fanFast); pop(L, R.top, cell.kilau4, 0.07, pal.emas, 2.4, 0.4, P.glint, 0.1); },
    inspect(L, R) { this.wings(L, R, R.top, 3, 0.085, 1.5, P.fan, 1.1); gunShed(L, R.top, cell.bulu_elang, 1, 0.06, 0.12, 0.1, 0, 0.05, driftP(L), 1.0, 1, 0.7, pal.garuda); },
    killGun(L, R, tier, head) {
      if (R.ads > 0.5) { spray(L, R, R.muzzle, cell.bulu_elang, 2, 0.07, 1.2, 1.8, pal.garuda, P.dart, 0.45); return; }
      const len = (R.show ? 0.125 : 0.1) + 0.012 * tier, p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.03);
      this.wings(L, R, p, 3, len, 0.14, P.fanFast, 1.4);                       // kepakan pertama
      this.wings(L, R, p, qn(tier ? 4 : 3, 2), len, 0.75, P.fan, 1.4, 0.36);  // membentang & tahan
      if (tier >= 2) this.wings(L, R, p, 3, len * 0.7, 0.2, P.fanFast, 1.4, 1.0);
      if (tier >= 1) pop(L, p, cell.kilau4, 0.09 + 0.02 * tier, pal.emas, 2.8, 0.7, P.glint, 0.3);
      if (tier >= 2) gunStamp(L, R, p, cell.cincin, 0.22, pal.emas, 1.6, 0.6, 0.2, 0.4, P.ring);
      gunShed(L, p, cell.bulu_elang, qn(6, 3), 0.06, 0.1, 0.05, 0, 0.3, driftP(L), 0.8, 1, 1.2, pal.garuda);
    },
    // "Sayap Garuda": dua sayap membentang dari 1,3 m di atas tanah di belakang korban, mengepak, pecah jadi bulu berpilin
    finisher(p, F, tier) {
      const y0 = p.y + 1.25, N = qn(7, 4), c = v1.set(F.cx, p.y, F.cz);
      stamp(p, 0.05, cell.cincin, 3.4 + 0.5 * tier, pal.emas, 1.5, 1.0, P.ring, 0.1);
      stamp(p, 0.06, cell.kilau4, 2.6, pal.emas, 1.3, 1.5, P.stamp, 0.2, 0.05);
      wFan(F, -0.12, 0, y0, cell.bulu_elang, pal.garuda, N, 1.6, 2.6, -18, -112, 0.05, 1.25, 1.3, true, 0.42, 1.9, 0.25);
      wFan(F, 0.12, 0, y0, cell.bulu_elang, pal.garuda, N, 1.6, 2.6, 18, 112, 0.05, 1.25, 1.3, true, 0.42, 1.9, 0.25);
      if (tier >= 1) { wFan(F, -0.1, 0.07, y0 - 0.1, cell.bulu_elang, pal.emas, qn(5, 3), 0.9, 1.4, -30, -100, 0.2, 1.3, 1.5, false, 0.42); wFan(F, 0.1, 0.07, y0 - 0.1, cell.bulu_elang, pal.emas, qn(5, 3), 0.9, 1.4, 30, 100, 0.2, 1.3, 1.5, false, 0.42); beam(c, 0.1, 6, 0.16, pal.emas, 1.5, 1.4, 0.15); }
      if (tier >= 2) { wFan(F, -0.2, -0.08, y0 + 0.5, cell.bulu_elang, pal.garuda, qn(5, 3), 1.2, 1.8, -5, -60, 0.3, 1.2, 1.3, false, 0.42); wFan(F, 0.2, -0.08, y0 + 0.5, cell.bulu_elang, pal.garuda, qn(5, 3), 1.2, 1.8, 5, 60, 0.3, 1.2, 1.3, false, 0.42); }
      wpop(c, 2.4, cell.kilau4, 1.0 + 0.3 * tier, pal.emas, 2.6, 0.9, P.glint, 0.35);
      if (F.lod < 2) helix(p, 2.6, cell.bulu_elang, 16, 0.5, -1.5, 2.6, 0.34, pal.garuda, P.helix, 1.1, 1.1, 0.42, 0.6, 1.0, 0.02);
    },
  };

  // ===== Inti Magma (legendaris): lidah api, tetes lava, retakan membara, asap =====
  THEMES.magma = {
    name: 'Inti Magma', finisher: 'Letusan', brass: '#3a1c10',
    cells: ['lidah_api', 'tetes', 'retak', 'asap', 'serpih'], cas: [cell.serpih, pal.magma, 0.04, P.dropVm, 3, 1], kn: [cell.retak, cell.tetes, pal.magma, 1.8, P.flip, 1],
    fire(L, R, n) {
      const ads = R.ads > 0.5, m = R.muzzle;
      gunUp(L, m, R.a.x + R.b.x * 0.3, R.a.y + R.b.y * 0.3, R.a.z + R.b.z * 0.3 + 0.5, cell.lidah_api, (ads ? 0.05 : 0.1) * (R.show ? 1.5 : 1), pal.magma, P.tongue, 0.2, 1.5);
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, m, cell.tetes, cnt(L, 3), R.show ? 0.07 : 0.05, 1.6, 2.6, pal.magma, P.flip, 0.5, 2, 1, 0.5);
    },
    fireWorld(p, d, n, k, floorY, sp) {
      wShed(p, d, n, cell.tetes, 0.12, 0.17, pal.magma, P.drop, 0.8, k, floorY, sp, 2, 1, 4, 7, 0.6, 1.8);
      if (sp === 1 && W.rand() < 0.5) W.emit(p.x + d.x * rr(W, 2.5, 4), floorY + 0.04, p.z + d.z * rr(W, 2.5, 4), 0, 0, 1, 1, 0, 0, W.rand() * TAU, 0.45, 1, P.glow, 0, pal.magma, 1.6, 0, 0.4, cell.retak, 1.2, 0.55);
    },
    impact(p, d, full) { hit(p, d, cell.retak, 0.3, pal.magma, 2, 0.6, P.bloom); if (full) { ricochet(p, d, cell.tetes, 2, 0.1, 0.14, pal.magma, P.flip, 0.6, 2, 1); hit(p, d, cell.asap, 0.3, pal.abu, 0, 0.9, P.smoke, 0.1); } },
    cue(L, R, ev, k) {
      if (ev === 'out') { gunShed(L, R.mag, cell.tetes, cnt(L, 3 * k), 0.04, 0, -0.25, 0, 0.15, dropP(L), 0.6, 2, 0, pal.magma, 1); pop(L, R.mag, cell.asap, 0.08, pal.abu, 0, 0.8, P.smoke, 0.05, VZ.set(0, 0.08, 0)); }
      else if (ev === 'in') { for (const sg of [-1, 1]) for (let i = 0; i < 2; i++) gunUp(L, R.mag, R.b.x * sg * (0.5 + i), -0.6 + R.b.y * sg, R.b.z * sg, cell.lidah_api, 0.075, pal.magma, P.tongue, 0.35, 2, 0.5, i * 0.05); gunShed(L, R.mag, cell.serpih, cnt(L, 2 * k), 0.035, 0, -0.2, 0, 0.3, dropP(L), 0.6, 1.4, 0.05, pal.magma, 1); }
      else if (ev === 'bolt') { gunUp(L, R.port, R.b.x + R.a.x * 0.6, R.b.y + R.a.y * 0.6, R.b.z + R.a.z * 0.6, cell.lidah_api, 0.09, pal.magma, P.tongue, 0.3, 2.2); gunUp(L, R.port, R.b.x + R.a.x * 0.1, R.b.y + R.a.y * 0.1, R.b.z, cell.lidah_api, 0.06, pal.magma, P.tongue, 0.25, 2, 0.5, 0.04); }
    },
    equip(L, R) { gunRun(L, R, cell.lidah_api, qn(5, 3), 0.085, pal.magma, P.tongue, 0.5, 0.07, 1.5, 0.5); },
    inspect(L, R) { for (let i = 0; i < 4; i++) gunShed(L, R.muzzle, cell.tetes, 1, 0.045, 0, -0.1, 0, 0.02, dropP(L), 0.6, 2, 0.2 + i * 0.4, pal.magma, 1); pop(L, R.muzzle, cell.asap, 0.1, pal.abu, 0, 1.4, P.smoke, 0.3, VZ.set(0, 0.07, 0)); gunRun(L, R, cell.lidah_api, 3, 0.05, pal.magma, P.tongue, 1.6, 0.15, 1.6, 0.5); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { spray(L, R, R.muzzle, cell.tetes, 3, 0.04, 1.2, 1.8, pal.magma, P.flip, 0.45, 2, 1); return; }
      gunRun(L, R, cell.lidah_api, qn(6, 3), (R.show ? 0.12 : 0.085) + 0.02 * tier, pal.magma, P.tongue, tier === 2 ? 1.3 : 0.95, 0.05, 1.5, 0.5, 0, 0.05);
      v3.copy(R.top).addScaledVector(R.b, 0.02);
      spray(L, R, v3, cell.tetes, qn(8, 3), 0.04, 0.8, 1.6, pal.magma, P.flip, 0.6, 2, 1, 0.2, 0.15, 0.04);
      if (tier >= 1) spray(L, R, v3, cell.serpih, qn(4, 2), 0.04, 0.8, 1.4, pal.magma, P.flip, 0.6, 1.5, 1, 0.2, 0.3, 0.05);
      if (tier >= 2) gunRun(L, R, cell.lidah_api, 3, 0.06, pal.magma, P.tongue, 1.1, 0.08, 2.4, 0.5, 0, 0.2, 0.05, 0.1, 0.5);
    },
    // "Letusan": retakan menyala di tanah, pancuran lidah api, bom lava melengkung, asap
    finisher(p, F, tier) {
      stamp(p, 0.05, cell.retak, 3.6 + 0.5 * tier, pal.magma, 2, 2.0, P.glow, 0.3);
      const erupt = (t0, k) => {
        growRing(p, 0.3, cell.lidah_api, 5, 0.28, 1.5 * k, 3.0 * k, 0.16, pal.magma, P.tongue, 1.25, 1.25, 0.5, t0, 0.04);
        if (F.lod < 2) burst(p, 0.5, cell.tetes, 14 * k, 0.3, 0.45, 1.0, 3.2, 4.5, 8, pal.magma, P.flip, 1.3, 2.2, -999, 1, t0 + 0.08, 0.012);
      };
      erupt(0, 1);
      if (tier >= 1) burst(p, 0.5, cell.serpih, 8, 0.25, 0.4, 1.5, 3.5, 4, 7, pal.magma, P.flip, 1.2, 1.6, -999, 1, 0.1, 0.02);
      if (tier >= 2) erupt(0.6, 0.75);
      for (let i = 0; i < qn(6, 2); i++) W.emit(p.x + rr(W, -0.6, 0.6), p.y + 0.8, p.z + rr(W, -0.6, 0.6), rr(W, -0.3, 0.3), rr(W, 1.3, 2.2), rr(W, -0.3, 0.3), 0, 1, 0, W.rand() * TAU, rr(W, 1.0, 1.5), 1, P.smoke, W.rand(), pal.abu, 0, 0, 0, cell.asap, 1.7, 0.3 + i * 0.1);
    },
  };

  // ===== Reaktor Plasma (legendaris): cincin, segi enam, chevron, pelat holo, busur =====
  THEMES.plasma = {
    name: 'Reaktor Plasma', finisher: 'Terurai Terpindai', brass: '#bfeaff',
    cells: ['cincin', 'segi6', 'chevron', 'pelat', 'cabang', 'pilar'], cas: [cell.cincin, pal.plasma, 0.045, P.dropVm, 3, 1], kn: [cell.segi6, cell.pelat, pal.plasma, 1.8, P.drop, 1],
    fire(L, R, n) {
      const ads = R.ads > 0.5, m = R.muzzle, k = (ads ? 0.5 : 1) * (R.show ? 1.6 : 1);
      pop(L, m, cell.segi6, 0.1 * k, pal.plasma, 2.4, 0.11, P.pop);
      VZ.set(R.b.x * 0.25, R.a.y * 0.2, -1.1 * R.fw - 0.1).multiplyScalar(R.show ? 0.5 : 1);
      pop(L, m, cell.cincin, 0.085 * k, pal.plasma, 2, 0.3, P.bloom, 0, VZ); pop(L, m, cell.cincin, 0.13 * k, pal.plasma, 1.6, 0.36, P.bloom, 0.05, VZ);
    },
    fireWorld(p, d, n, k, floorY, sp) { W.emit(p.x, p.y, p.z, d.x * 9 * sp, d.y * 9 * sp, d.z * 9 * sp, 0, 1, 0, 0, 0.3 * k, 1, P.bloom, 0, pal.plasma, 1.8, 0, 0, cell.cincin, 0.65); if (W.rand() < 0.5) W.emit(p.x, p.y, p.z, d.x * 7 * sp, d.y * 7 * sp + 0.4, d.z * 7 * sp, 0, 1, 0, 0, 0.2 * k, 0.9, P.streak, 0, pal.plasma, 1.8, 0, 0, cell.chevron, 0.5); },
    impact(p, d, full) { hit(p, d, cell.segi6, 0.3, pal.plasma, 2, 0.35); hit(p, d, cell.segi6, 0.5, pal.plasma, 1.3, 0.4, P.bloom, 0.08); if (full) ricochet(p, d, cell.pelat, 3, 0.1, 0.14, pal.plasma, P.drop, 0.7, 1.4, 1); },
    cue(L, R, ev, k) {
      if (ev === 'out') for (let i = 0; i < cnt(L, 3 * k); i++) L.emit(R.mag.x, R.mag.y, R.mag.z, 0, -0.35, 0, 0, 1, 0, 0, 0.05, 1, P.streak, 0, pal.plasma, 1.8, 1, 0, cell.chevron, 0.45, i * 0.1);
      else if (ev === 'in') { gunStamp(L, R, R.mag, cell.segi6, 0.075, pal.plasma, 2, 0.45, 2.6); pop(L, R.mag, cell.cabang, 0.09, pal.plasma, 2.4, 0.3, P.flickPop, 0.1, ZERO, 0.5, 1.2); }
      else if (ev === 'bolt') gunRun(L, R, cell.cincin, qn(5, 3), 0.07, pal.plasma, P.pop, 0.14, 0.05, 2, 1, 0, 0, 0.02);
    },
    equip(L, R) { gunRun(L, R, cell.segi6, 3, 0.11, pal.plasma, P.glint, 0.5, 0.12, 2, 1, 0, 0, 0.05); },
    inspect(L, R) { gunOrbit(L, R, R.muzzle.z * 0.55, cell.pelat, qn(4, 2), 0.07, 0.085, 2.4, pal.plasma, P.orbit, 1.9, 1.6, 1); gunOrbit(L, R, R.muzzle.z * 0.8, cell.cincin, 1, 0.1, 0.0, 0, pal.plasma, P.orbit, 1.8, 1.6, 1); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { pop(L, R.muzzle, cell.segi6, 0.07, pal.plasma, 2, 0.3, P.glint); return; }
      const p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.05).addScaledVector(R.a, 0.03), k = R.show ? 1.35 : 1;
      for (let i = 0; i < 3; i++) gunStamp(L, R, p, cell.cincin, (0.1 + 0.04 * i + 0.02 * tier) * k, pal.plasma, 2, 0.55, 0.15, 0.05 + i * 0.12, P.ring);
      gunStamp(L, R, p, cell.segi6, 0.1 * k, pal.plasma, 2.4, 0.9, 0.3, 0.05);
      for (let i = 0; i < qn(6, 3); i++) pop(L, p, cell.cabang, 0.1 * k, pal.plasma, 2.6, 0.7, P.flickPop, 0.1, ZERO, 0.5, i * 1.05);
      if (tier >= 1) gunOrbit(L, R, R.muzzle.z * 0.6, cell.cincin, 3, 0.06, 0.07, 6, pal.plasma, P.orbit, 1.0, 1.8, 1, 0, 0.2);
      if (tier >= 2) gunUp(L, R.muzzle, 0, 0, -1, cell.pilar, 0.6, pal.plasma, P.beam, 0.8, 2.2, 0.06, 0.3);
    },
    // "Terurai terpindai": cincin heks memindai naik, pelat terangkat berpilin lalu mengerut ke satu titik, sinar tegak
    finisher(p, F, tier) {
      stamp(p, 0.05, cell.segi6, 3.2 + 0.4 * tier, pal.plasma, 1.8, 1.5, P.stamp, 0.25);
      for (let i = 0; i < 6; i++) stamp(p, 0.15 + i * 0.41, cell.segi6, 1.9 - 0.08 * i, pal.plasma, 2, 0.34, P.stamp, 0.75, 0.05 + i * 0.1, 0.5);
      if (F.lod < 2) for (let i = 0; i < qn(24, 8); i++) { const u = i / 23; W.emit(p.x, p.y + 0.2 + u * 1.9, p.z, 0.9, 3.2, -0.75, 0, 1, 0, W.rand() * TAU, rr(W, 0.26, 0.36), 1, P.helixAdd, W.rand(), pal.plasma, 1.6, 0, rr(W, 0.75, 1.0), cell.pelat, 1.25 - u * 0.35, 0.08 + u * 0.55); }
      beam(p, 0.1, tier >= 2 ? 20 : 4.5, tier >= 2 ? 0.03 : 0.1, pal.plasma, 2.6, 0.45, 1.3);
      wpop(p, 2.3, cell.segi6, 0.9, pal.plasma, 2.6, 0.4, P.glint, 1.3);
      stamp(p, 0.07, cell.cincin, 4.2 + tier, pal.plasma, 1.8, 0.6, P.ring, 0.1, 1.3);
      if (tier >= 1) for (let i = 0; i < qn(6, 3); i++) wpop(p, 1.0 + rr(W, -0.5, 0.9), cell.cabang, 1.1, pal.plasma, 2.4, 0.5, P.flickPop, 0.9 + i * 0.05, 0, 0.5, W.rand() * TAU);
    },
  };

  // ===== Kristal Es (epik): serpih es, butir salju, gugus kristal, embun beku =====
  THEMES.es = {
    name: 'Kristal Es', finisher: 'Beku lalu Pecah', brass: '#bfeaff',
    cells: ['serpih_es', 'salju', 'kristal', 'embun', 'kilau4'], cas: [cell.serpih_es, pal.es, 0.05, P.dropVm, 2, 0.5], kn: [cell.embun, cell.serpih_es, pal.es, 1.8, P.flip, 0.5],
    fire(L, R, n) {
      const ads = R.ads > 0.5;
      pop(L, R.muzzle, cell.salju, (ads ? 0.05 : 0.1) * (R.show ? 1.5 : 1), pal.es, 2, 0.14, P.spinPop, 0, ZERO, 1, L.rand());
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, R.muzzle, cell.serpih_es, 2, R.show ? 0.16 : 0.12, 2.0, 3.0, pal.es, P.dart, 0.4, 1.4, 0.5, 0.5);
    },
    fireWorld(p, d, n, k, floorY, sp) { wShed(p, d, 1, cell.salju, 0.18, 0.24, pal.es, P.drift, 1.2, k, floorY, sp, 1.4, 1); },
    impact(p, d, full) { hit(p, d, cell.embun, 0.34, pal.es, 1.8, 0.6); if (full) ricochet(p, d, cell.serpih_es, 3, 0.12, 0.16, pal.es, P.flip, 0.7, 1.2); },
    cue(L, R, ev, k) {
      if (ev === 'out') gunShed(L, R.mag, cell.salju, cnt(L, 3 * k), 0.045, 0, -0.12, 0, 0.12, driftP(L), 0.8, 1.4, 0, pal.es, 1, 0.08);
      else if (ev === 'in') { gunStamp(L, R, R.mag, cell.embun, 0.13, pal.es, 1.8, 0.6, 0.25); gunStamp(L, R, R.mag, cell.embun, 0.09, pal.es, 1.8, 0.5, 0.25, 0.1, P.stamp, 0.5); }
      else if (ev === 'bolt') spray(L, R, R.port, cell.serpih_es, Math.max(1, cnt(L, 3 * k)), 0.06, 1.2, 2.0, pal.es, P.flip, 0.45, 1.4, 0.5, 0.1, 0, 0.04);
    },
    equip(L, R) { gunRun(L, R, cell.kristal, qn(5, 3), 0.075, pal.es, P.grow, 0.5, 0.05, 1.3, 0.5); v3.copy(R.top); spray(L, R, v3, cell.serpih_es, qn(5, 2), 0.045, 0.6, 1.3, pal.es, P.flip, 0.5, 1.4, 0.5, 0.2, 0.5, 0.01); },
    inspect(L, R) { gunOrbit(L, R, R.muzzle.z * 0.6, cell.salju, 3, 0.055, 0.075, 2.6, pal.es, P.orbit, 1.9, 1.5, 1); gunRun(L, R, cell.kristal, 3, 0.05, pal.es, P.grow, 1.6, 0.2, 1.2, 0.5); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { spray(L, R, R.muzzle, cell.serpih_es, 3, 0.05, 1.2, 1.8, pal.es, P.flip, 0.45, 1.4); return; }
      const N = qn(7, 4), k = (R.show ? 1.3 : 1) * (1 + 0.18 * tier);
      for (let i = 0; i < N; i++) { const u = i / (N - 1), z = R.top.z + 0.07 + (R.muzzle.z * 0.8 - R.top.z - 0.07) * u, y = R.top.y - 0.032 + (R.muzzle.y + 0.044 - R.top.y) * u, hgt = (0.035 + 0.06 * Math.sin(Math.PI * (0.15 + 0.7 * u))) * k; // mahkota: tinggi di tengah
        L.emit(0, y, z, 0, 0, 0, R.a.x + R.b.x * 0.25, R.a.y + R.b.y * 0.25, R.a.z + (u - 0.5) * 0.5, 0, hgt, 0.5, P.grow, L.rand(), pal.es, 1.3, 1, 0, cell.kristal, 0.78, 0.05 + i * 0.04); }
      v3.copy(R.top).addScaledVector(R.b, 0.02);
      spray(L, R, v3, cell.serpih_es, qn(12, 4), 0.05, 0.8, 1.8, pal.es, P.flip, 0.55, 1.4, 0.5, 0.3, 0.82, 0.008);
      pop(L, v3, cell.kilau4, 0.1 * k, pal.es, 2.4, 0.3, P.glint, 0.8);
      if (tier >= 2) gunRun(L, R, cell.kristal, 4, 0.06 * k, pal.es, P.grow, 0.5, 0.05, 1.3, 0.5, 0, 0.9);
    },
    // "Beku lalu pecah": kristal tumbuh melingkar condong keluar + embun di tanah, kilau menyapu, pecah jadi serpih & salju
    finisher(p, F, tier) {
      stamp(p, 0.05, cell.embun, 4 + 0.5 * tier, pal.es, 1.6, 1.7, P.glow, 0.2);
      growRing(p, 0, cell.kristal, 9, 0.7, 0.8, 1.9, 0.3, pal.es, P.grow, 1.15, 1.2, 0.5, 0, 0.04);
      if (tier >= 1) growRing(p, 0, cell.kristal, 6, 1.25, 0.5, 0.9, 0.45, pal.es, P.grow, 1.0, 1.2, 0.5, 0.2, 0.04, 0.5);
      if (tier >= 2) W.emit(F.cx, p.y, F.cz, 0, 0, 0, 0, 1, 0, 0, 3.0, 0.5, P.grow, 0, pal.es, 1.4, 0, 0, cell.kristal, 1.2, 0.15);
      for (let i = 0; i < 3; i++) wpop(p, 0.6 + i * 0.5, cell.kilau4, 0.7, pal.es, 2.6, 0.3, P.glint, 0.55 + i * 0.1);
      if (F.lod < 2) { burst(p, 0.9, cell.serpih_es, 24, 0.3, 0.5, 2, 5, 1.5, 5, pal.es, P.flip, 0.8, 1.4, -999, 0.5, 1.1, 0.004); burst(p, 1.4, cell.salju, 8, 0.2, 0.3, 0.4, 1.4, 0.2, 1.2, pal.es, P.drift, 1.1, 1.5, p.y, 1, 1.1, 0.02); }
    },
  };

  // ===== Neon Ungu (epik): segi enam, garis neon, glif data, kisi =====
  THEMES.neon = {
    name: 'Neon Ungu', finisher: 'Jadi Kisi', brass: '#b24dff',
    cells: ['segi6', 'garis', 'glif', 'kisi'], cas: null, kn: [cell.kisi, cell.glif, pal.neon, 1.8, P.drop, 1],
    fire(L, R, n) {
      const ads = R.ads > 0.5;
      pop(L, R.muzzle, cell.segi6, (ads ? 0.05 : 0.11) * (R.show ? 1.5 : 1), pal.neon, 2.4, 0.12, P.pop);
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, R.muzzle, cell.garis, 3, R.show ? 0.2 : 0.15, 2.2, 3.4, pal.neon, P.streak, 0.3, 2.4, 0.22, 0.6);
    },
    fireWorld(p, d, n, k, floorY, sp) { for (let i = 0; i < 2; i++) W.emit(p.x, p.y, p.z, d.x * 12 * sp + rr(W, -1.5, 1.5) * sp, d.y * 12 * sp + rr(W, 0, 1.5) * sp, d.z * 12 * sp + rr(W, -1.5, 1.5) * sp, 0, 1, 0, 0, 0.5 * k, 0.16, P.streak, W.rand(), pal.neon, 2.4, 0, 0, cell.garis, 0.4, i * 0.03); if (W.rand() < 0.4) wShed(p, d, 1, cell.glif, 0.16, 0.2, pal.neon, P.bloom, 0.5, k, floorY, sp, 2, 1, 2, 3); },
    impact(p, d, full) { hit(p, d, cell.kisi, 0.36, pal.neon, 2.2, 0.28, P.flickPop); if (full) hit(p, d, cell.segi6, 0.22, pal.neon, 2, 0.3); },
    cue(L, R, ev, k) {
      if (ev === 'out') for (let i = 0; i < cnt(L, 4 * k); i++) pop(L, R.mag, cell.glif, 0.04, pal.neon, 2.2, 0.4, P.bloom, i * 0.08, VZ.set(rr(L, -0.05, 0.05), -0.3, 0));
      else if (ev === 'in') for (let i = 0; i < 3; i++) gunStamp(L, R, R.mag, cell.segi6, 0.05 + 0.03 * i, pal.neon, 2.2, 0.3, 1.9, i * 0.09);
      else if (ev === 'bolt') gunRun(L, R, cell.garis, qn(4, 2), 0.1, pal.neon, P.streak, 0.25, 0.04, 2.4, 0.22, 0, 0, 0.012);
    },
    equip(L, R) { gunRun(L, R, cell.kisi, qn(5, 3), 0.1, pal.neon, P.flickPop, 0.28, 0.07, 2.2, 1, 0, 0, 0.04); },
    inspect(L, R) { for (let k = 0; k < 3; k++) gunRun(L, R, cell.glif, 4, 0.045, pal.neon, P.bloom, 0.45, 0.1, 2.2, 1, 0, k * 0.5, 0.035); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { pop(L, R.muzzle, cell.segi6, 0.07, pal.neon, 2, 0.3, P.glint); return; }
      const p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.05).addScaledVector(R.a, 0.03), k = R.show ? 1.35 : 1;
      for (let i = 0; i < 3; i++) gunStamp(L, R, p, cell.segi6, (0.11 + 0.05 * i + 0.02 * tier) * k, pal.neon, 2.2, tier ? 0.9 : 0.6, 0.25, 0.05 + i * 0.12);
      gunFan(L, R, p, cell.garis, qn(7, 4), 0.1 * k, R.f0 - 10, R.f1 + 10, 0.3, P.fanFast, 0, 2.4, 0.1, 1, pal.neon, 0.2);
      if (tier >= 2) spray(L, R, p, cell.glif, qn(8, 4), 0.04, 0.5, 1.4, pal.neon, P.bloom, 0.6, 2.2, 1, 0.2, 0.3, 0.05);
    },
    // "Jadi kisi": segi enam membentuk kubah, menyala bergiliran, garis melesat ke atas
    finisher(p, F, tier) {
      stamp(p, 0.05, cell.kisi, 3.4 + 0.4 * tier, pal.neon, 2, 1.5, P.glow, 0.3);
      const N = qn(12, 6), r = 1.1 + 0.1 * tier;
      for (let i = 0; i < N; i++) { // kubah: dua lingkar (bawah 7, atas 5), tiap heks menghadap keluar
        const top = i >= Math.ceil(N * 0.58), n1 = top ? N - Math.ceil(N * 0.58) : Math.ceil(N * 0.58), a = (top ? i - Math.ceil(N * 0.58) : i) / n1 * TAU + (top ? 0.4 : 0), el = top ? 0.95 : 0.35, c = Math.cos(a), s = Math.sin(a), ce = Math.cos(el), se = Math.sin(el);
        W.emit(p.x + c * ce * r, p.y + 0.35 + se * r * 1.25, p.z + s * ce * r, -s, 0, c, -c * se, ce, -s * se, 0, top ? 0.85 : 1.0, 1, P.glow, 0, pal.neon, 2.2, 0, 0.55, cell.segi6, 1.5 - i * 0.03, 0.05 + i * 0.045);
      }
      if (F.lod < 2) for (let i = 0; i < qn(16, 6); i++) { const a = W.rand() * TAU, rd = rr(W, 0.2, 1.0); W.emit(p.x + Math.cos(a) * rd, p.y + rr(W, 0.3, 1.2), p.z + Math.sin(a) * rd, 0, rr(W, 2.5, 5), 0, 0, 1, 0, 0, rr(W, 0.7, 1.1), 0.14, P.streak, W.rand(), pal.neon, 2.4, 0, 0, cell.garis, 0.8, 0.5 + i * 0.04); }
      if (tier >= 1) burst(p, 1.2, cell.glif, 10, 0.22, 0.3, 0.8, 2, 0.5, 2.5, pal.neon, P.bloom, 0.7, 2.2, -999, 1, 0.7, 0.03);
      if (tier >= 2) { stamp(p, 0.07, cell.segi6, 5.2, pal.neon, 2, 0.8, P.ring, 0.15, 0.9); beam(p, 0.1, 5, 0.1, pal.neon, 2, 0.8, 0.8); }
    },
  };

  // ===== Songket Emas (epik): benang emas, bintang delapan, ketupat tenun, kelopak =====
  THEMES.songket = {
    name: 'Songket Emas', finisher: 'Tenun Cahaya', brass: '#f2c25a',
    cells: ['benang', 'bintang8', 'ketupat', 'kelopak'], cas: null, kn: [cell.bintang8, cell.kelopak, pal.songket, 1.8, P.drop, 1],
    fire(L, R, n) {
      const ads = R.ads > 0.5;
      pop(L, R.muzzle, cell.bintang8, (ads ? 0.05 : 0.1) * (R.show ? 1.5 : 1), pal.songket, 1.8, 0.2, P.spinPop);
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, R.muzzle, cell.benang, 2, R.show ? 0.24 : 0.18, 1.8, 2.8, pal.songket, P.ribbon, 0.45, 2, 0.25, 0.5);
    },
    fireWorld(p, d, n, k, floorY, sp) { W.emit(p.x, p.y, p.z, d.x * 7 * sp + rr(W, -1, 1) * sp, d.y * 7 * sp + rr(W, 0.2, 1.4) * sp, d.z * 7 * sp + rr(W, -1, 1) * sp, 0, 1, 0, 0, 0.6 * k, 0.25, P.ribbon, W.rand(), pal.songket, 2, 0, 0, cell.benang, 0.7); wShed(p, d, 1, cell.kelopak, 0.16, 0.22, pal.songket, P.drift, 1.2, k, floorY, sp, 1, 1); },
    impact(p, d, full) { hit(p, d, cell.ketupat, 0.26, pal.songket, 1.6, 0.4, P.bloomC); if (full) { hit(p, d, cell.bintang8, 0.2, pal.songket, 2, 0.35, P.spinPop, 0.05); ricochet(p, d, cell.kelopak, 2, 0.1, 0.14, pal.songket, P.drop, 0.7, 1, 1); } },
    cue(L, R, ev, k) {
      if (ev === 'out') for (let i = 0; i < cnt(L, 2 * k); i++) L.emit(R.mag.x, R.mag.y, R.mag.z, rr(L, -0.1, 0.1), -0.45, 0, 0, 1, 0, 0, 0.12, 0.25, P.ribbon, L.rand(), pal.songket, 2, 1, 0, cell.benang, 0.6, i * 0.06);
      else if (ev === 'in') for (let i = 0; i < 4; i++) { VZ.copy(R.mag); VZ.z += (i - 1.5) * 0.035; pop(L, VZ, cell.ketupat, 0.045, pal.songket, 1.8, 0.5, P.bloomC, i * 0.06); }
      else if (ev === 'bolt') pop(L, R.port, cell.bintang8, 0.07, pal.songket, 2.2, 0.35, P.spinPop);
    },
    equip(L, R) { gunRun(L, R, cell.ketupat, qn(6, 3), 0.055, pal.songket, P.bloomC, 0.5, 0.06, 1.8, 1, 0, 0, 0.035); },
    inspect(L, R) { for (let i = 0; i < 3; i++) L.emit(0, R.top.y, R.top.z + 0.12, R.b.x * 0.02, 0.05 + 0.03 * i, 0.1, 0, 1, 0, 0, 0.16, 0.25, P.ribbon, L.rand(), pal.songket, 2, 1, 0, cell.benang, 1.6, i * 0.2); gunRun(L, R, cell.ketupat, 4, 0.04, pal.songket, P.bloomC, 0.6, 0.25, 1.8, 1, 0, 0.2, 0.03); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { pop(L, R.muzzle, cell.bintang8, 0.07, pal.songket, 2, 0.3, P.spinPop); return; }
      const p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.03), k = R.show ? 1.35 : 1;
      for (let i = 0; i < qn(5, 3); i++) pop(L, p, cell.bintang8, (0.05 + 0.006 * i) * k, pal.songket, 2, 0.75, P.spinPop, 0.05 + i * 0.09, VZ.set(R.b.x * 0.05 * (i - 1) + R.a.x * 0.16, R.b.y * 0.05 * (i - 1) + R.a.y * 0.16, 0));
      gunOrbit(L, R, R.muzzle.z * 0.35, cell.benang, 2, 0.14, 0.045, 7, pal.songket, P.helixAdd, 0.9, 2, 0.25, -0.25, 0.05);
      if (tier >= 1) gunRun(L, R, cell.ketupat, qn(6, 3), 0.045 * k, pal.songket, P.bloomC, 0.7, 0.05, 1.8, 1, 0, 0.2, 0.03);
      if (tier >= 2) pop(L, p, cell.bintang8, 0.16 * k, pal.songket, 2.2, 0.8, P.spinPop, 0.45, VZ.set(R.a.x * 0.06, R.a.y * 0.06, 0));
    },
    // "Tenun cahaya": bintang delapan berputar di tanah, benang naik berpilin bertemu jadi bintang yang pecah jadi kelopak
    finisher(p, F, tier) {
      stamp(p, 0.05, cell.bintang8, 3.0 + 0.4 * tier, pal.songket, 1.7, 1.8, P.ring, 0.25);
      helix(p, 0.3, cell.benang, 6 + 2 * tier, 1.0, 2.9, 4.2, 1.0, pal.songket, P.helixAdd, 1.05, 2.2, 0.22, -0.9, 0.05, 0.03);
      if (tier >= 1) growRing(p, 0.1, cell.ketupat, 8, 1.3, 0.5, 0.6, 0, pal.songket, P.grow, 1.2, 1.6, 1, 0.1, 0.05);
      wpop(p, 3.1, cell.bintang8, 1.2 + 0.3 * tier, pal.songket, 2.4, 0.6, P.spinPop, 0.85);
      if (F.lod < 2) { v2.set(p.x, p.y + 3.1, p.z); burst(v2, 0, cell.kelopak, 12 + 4 * tier, 0.26, 0.36, 0.8, 2.4, 0.2, 1.8, pal.songket, P.drift, 1.0, 1.2, p.y, 1, 1.1, 0.01); }
      if (tier >= 2) beam(p, 0.1, 5, 0.12, pal.emas, 1.6, 1.2, 0.3);
    },
  };

  // ===== Pamor Keris (epik): garis pamor, sulur asap tuah, cincin mendak. Tanpa gambar bilah. =====
  THEMES.keris = {
    name: 'Pamor Keris', finisher: 'Asap Tuah', brass: '#3c4650',
    cells: ['pamor', 'sulur', 'mendak', 'cincin', 'lidah_api'], cas: null, kn: [cell.mendak, cell.sulur, pal.keris, 1.6, P.rise, 0.5],
    fire(L, R, n) {
      const ads = R.ads > 0.5;
      gunUp(L, R.muzzle, R.a.x, R.a.y, R.a.z + 0.2, cell.sulur, (ads ? 0.05 : 0.11) * (R.show ? 1.5 : 1), pal.keris, P.tongue, 0.32, 2);
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, R.muzzle, cell.pamor, 2, R.show ? 0.22 : 0.17, 1.8, 2.8, pal.keris, P.ribbon, 0.42, 2.2, 0.25, 0.5);
    },
    fireWorld(p, d, n, k, floorY, sp) { W.emit(p.x + d.x * 0.6 * sp, p.y, p.z + d.z * 0.6 * sp, d.x * 1.5 * sp, 0.9 * sp + 0.2, d.z * 1.5 * sp, 0, 1, 0, 0, 0.4 * k, 0.5, P.tongue, W.rand(), pal.keris, 1.8, 0, 0, cell.sulur, 0.9); },
    impact(p, d, full) { hit(p, d, cell.cincin, 0.32, pal.keris, 1.8, 0.4); if (full) W.emit(p.x - d.x * 0.05, p.y, p.z - d.z * 0.05, 0, 0, 0, 0, 1, 0, 0, 0.4, 0.5, P.tongue, W.rand(), pal.keris, 1.8, 0, 0, cell.sulur, 0.8); },
    cue(L, R, ev, k) {
      if (ev === 'out') gunUp(L, R.mag, R.b.x * 0.3, -1, 0, cell.sulur, 0.1, pal.keris, P.tongue, 0.6, 2);
      else if (ev === 'in') { gunStamp(L, R, R.mag, cell.mendak, 0.07, pal.keris, 2, 0.5, 2.4); gunStamp(L, R, R.mag, cell.cincin, 0.1, pal.keris, 1.8, 0.4, 0.3, 0.2, P.ring); }
      else if (ev === 'bolt') gunRun(L, R, cell.pamor, qn(4, 2), 0.11, pal.keris, P.streak, 0.3, 0.05, 2.2, 0.25, 0, 0, 0.012);
    },
    equip(L, R) { gunOrbit(L, R, R.top.z + 0.05, cell.sulur, 3, 0.1, 0.055, 7, pal.keris, P.helixAdd, 0.7, 2, 0.5, R.muzzle.z * 0.75, 0, -0.05, 0.08); },
    inspect(L, R) { for (let i = 0; i < 2; i++) gunRun(L, R, cell.sulur, 2, 0.1, pal.keris, P.tongue, 1.5, 0.3, 1.8, 0.5, 0, i * 0.5, 0, 0.2 + i * 0.2, 0.8); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { gunUp(L, R.muzzle, R.b.x, 0.6, 0, cell.sulur, 0.07, pal.keris, P.tongue, 0.5, 2); return; }
      const p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.03), k = R.show ? 1.35 : 1;
      gunRun(L, R, cell.sulur, qn(5, 3), (0.1 + 0.02 * tier) * k, pal.keris, P.tongue, 1.0, 0.07, 2, 0.5, 0, 0.05);
      gunStamp(L, R, p, cell.mendak, 0.11 * k, pal.keris, 2.2, 0.95, 0.3, 0.05); gunStamp(L, R, p, cell.mendak, 0.16 * k, pal.keris, 1.6, 0.5, 0.5, 0.45, P.ring);
      if (tier >= 1) gunOrbit(L, R, R.top.z, cell.sulur, 3, 0.09, 0.05, 6, pal.keris, P.helixAdd, 0.9, 2, 0.5, R.muzzle.z * 0.6, 0.2, 0, 0.1);
      if (tier >= 2) gunUp(L, R.muzzle, R.a.x, R.a.y, R.a.z, cell.lidah_api, 0.12 * k, pal.keris, P.tongue, 1.0, 2.2, 0.5, 0.2);
    },
    // "Asap tuah": sulur naik berpilin mengelilingi korban, bertemu di 2,5 m jadi cincin pamor yang beriak mendatar
    finisher(p, F, tier) {
      stamp(p, 0.05, cell.mendak, 2.6 + 0.4 * tier, pal.keris, 1.6, 1.6, P.ring, 0.3);
      helix(p, 0.2, cell.sulur, 10 + 2 * tier, 1.05, 2.3, 3.6, 1.05, pal.keris, P.helix, 1.15, 1.5, 0.5, -0.8, 0, 0.035); // potong (bukan aditif): tetap terbaca di depan dinding terang
      for (let i = 0; i < 2 + tier; i++) stamp(p, 2.55, cell.cincin, 3.4 + 0.8 * i, pal.keris, 2, 0.75, P.stamp, 0.1, 1.0 + i * 0.16);
      stamp(p, 2.57, cell.mendak, 1.5, pal.keris, 2.2, 0.8, P.stamp, 0.2, 0.95);
      if (F.lod < 2) for (let i = 0; i < qn(6, 2); i++) W.emit(p.x + rr(W, -0.5, 0.5), p.y + 2.4, p.z + rr(W, -0.5, 0.5), 0, 0.5, 0, 0, 1, 0, 0, rr(W, 0.7, 1.0), 0.5, P.tongue, W.rand(), pal.keris, 1.6, 0, 0, cell.sulur, 0.8, 1.05 + i * 0.05);
      if (tier >= 2) W.emit(p.x, p.y + 0.4, p.z, 0, 0, 0, 0, 1, 0, 0, 2.6, 0.5, P.tongue, 0, pal.keris, 1.8, 0, 0, cell.lidah_api, 1.3, 0.2);
    },
  };

  // ===== Badai Petir (epik): kilat, busur bercabang, awan badai =====
  THEMES.petir = {
    name: 'Badai Petir', finisher: 'Disambar', brass: '#8f9cff',
    cells: ['kilat', 'cabang', 'awan', 'cincin'], cas: [cell.cabang, pal.petir, 0.06, P.flickPop, 3, 0.5], kn: [cell.cincin, cell.cabang, pal.petir, 1.8, P.flip, 0.5],
    fire(L, R, n) {
      const ads = R.ads > 0.5, k = (ads ? 0.5 : 1) * (R.show ? 1.5 : 1);
      for (let i = 0; i < 2; i++) pop(L, R.muzzle, cell.kilat, rr(L, 0.1, 0.15) * k, pal.petir, 3, 0.16, P.flickPop, i * 0.03, ZERO, 0.5, rr(L, -2.2, 0.4));
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      pop(L, R.muzzle, cell.cabang, 0.16 * k, pal.petir, 2.6, 0.22, P.flickPop, 0.02, ZERO, 0.5, rr(L, -1.8, -0.4));
    },
    fireWorld(p, d, n, k, floorY, sp) { W.emit(p.x, p.y, p.z, 0, 0, 0, d.x + rr(W, -0.15, 0.15), d.y + rr(W, -0.05, 0.2) + (sp < 1 ? 0.8 : 0), d.z + rr(W, -0.15, 0.15), 0, rr(W, 0.5, 0.9) * k * (sp < 1 ? 0.5 : 1), 0.4, P.flick, W.rand(), pal.petir, 3, 0, 0, cell.cabang, 0.16); },
    impact(p, d, full) { const n = full ? 4 : 2; for (let i = 0; i < n; i++) hit(p, d, cell.cabang, 0.36, pal.petir, 2.8, 0.26, P.flickPop, i * 0.02, 0.5); hit(p, d, cell.cincin, 0.28, pal.petir, 1.6, 0.3); },
    cue(L, R, ev, k) {
      if (ev === 'out') for (let i = 0; i < 2; i++) pop(L, R.mag, cell.cabang, 0.09, pal.petir, 2.8, 0.3, P.flickPop, i * 0.05, ZERO, 0.5, Math.PI + rr(L, -0.6, 0.6));
      else if (ev === 'in') { VZ.copy(R.mag); VZ.y -= 0.04; for (let i = 0; i < 2; i++) gunUp(L, VZ, R.b.x * 0.2 * (i ? 1 : -1), 1, 0, cell.kilat, 0.1, pal.petir, P.flick, 0.3, 3, 0.5, i * 0.04); }
      else if (ev === 'bolt') pop(L, R.port, cell.cabang, 0.1, pal.petir, 2.8, 0.3, P.flickPop, 0, ZERO, 0.5, -1.2);
    },
    equip(L, R) { gunRun(L, R, cell.kilat, qn(3, 2), 0.13, pal.petir, P.flickPop, 0.3, 0.12, 3, 0.5, 0, 0, 0.05); gunRun(L, R, cell.cabang, 3, 0.1, pal.petir, P.flickPop, 0.3, 0.1, 2.6, 0.5, 0, 0.05, 0.03); },
    inspect(L, R) { VZ.copy(R.top); VZ.y += 0.06; pop(L, VZ, cell.awan, 0.045, pal.petir, 0.6, 2.0, P.smoke, 0, ZERO, 2); for (let i = 0; i < 3; i++) gunUp(L, R.top, rr(L, -0.15, 0.15), 1, rr(L, -0.2, 0.2), cell.kilat, 0.08, pal.petir, P.flick, 0.14, 3, 0.5, 0.5 + i * 0.5); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { pop(L, R.muzzle, cell.cabang, 0.08, pal.petir, 2.6, 0.3, P.flickPop, 0, ZERO, 0.5, -1); return; }
      const p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.03), k = R.show ? 1.35 : 1, hgt = 0.11 * k;
      VZ.copy(p).addScaledVector(R.a, hgt + 0.02 * k);
      pop(L, VZ, cell.awan, 0.055 * k, pal.petir, 0.6, tier === 2 ? 1.3 : 1.0, P.smoke, 0, ZERO, 2);
      for (let i = 0; i < 1 + 2 * Math.min(1, tier) ; i++) gunUp(L, p, R.a.x + rr(L, -0.2, 0.2), R.a.y, R.a.z + rr(L, -0.2, 0.2), cell.kilat, hgt, pal.petir, P.flick, 0.22, 3.2, 0.5, 0.3 + i * 0.25);
      gunRun(L, R, cell.cabang, qn(4, 2), 0.09 * k, pal.petir, P.flickPop, 0.3, 0.05, 2.8, 0.5, 0, 0.32, 0.03, 0.3, 1);
      if (tier >= 2) gunOrbit(L, R, R.muzzle.z * 0.5, cell.cabang, 4, 0.1, 0.05, 5, pal.petir, P.orbit, 1.2, 2.6, 0.5, 0, 0.3);
    },
    // "Disambar": awan terbentuk 3,3 m di atas korban, kilat menyambar tiga kedip, cabang merayap di tanah
    finisher(p, F, tier) {
      const top = 3.3; // cukup rendah supaya awan masih masuk bingkai kamera lobi
      for (const [ox, oz, s, dl] of [[0, 0, 1.25, 0], [-0.9, 0.2, 0.9, 0.08], [0.9, -0.2, 0.95, 0.12]]) W.emit(p.x + F.sx * ox, p.y + top + (s < 1 ? -0.15 : 0), p.z + F.sz * ox + oz, 0, 0, 0, 0, 1, 0, 0, s, 2, P.smoke, W.rand(), pal.petir, 0.5, 0, 0, cell.awan, 1.6 - dl, dl);
      const strike = (ox, oz, dl, sz = 0.42) => { W.emit(p.x + ox, p.y, p.z + oz, 0, 0, 0, rr(W, -0.06, 0.06), 1, rr(W, -0.06, 0.06), 0, top - 0.2, sz, P.flick, W.rand(), pal.petir, 3.4, 0, 0, cell.kilat, 0.5, dl); stamp(v2.set(p.x + ox, p.y, p.z + oz), 0.06, cell.cincin, 2.6, pal.petir, 2.4, 0.4, P.ring, 0.1, dl); };
      strike(0, 0, 0.4);
      if (tier >= 1) { strike(F.sx * 0.9, F.sz * 0.9, 0.62, 0.3); strike(-F.sx * 0.9, -F.sz * 0.9, 0.78, 0.3); }
      if (tier >= 2) strike(0, 0, 1.0, 0.5);
      wpop(p, 1.0, cell.cincin, 1.6, pal.petir, 3, 0.25, P.bloom, 0.4);
      for (let i = 0; i < qn(6, 3); i++) { const a = i / 6 * TAU + 0.3, c = Math.cos(a), s = Math.sin(a); W.emit(p.x + c * 0.25, p.y + 0.06, p.z + s * 0.25, s, 0, -c, c, 0, s, 0, rr(W, 1.3, 1.9), 0.5, P.flick, W.rand(), pal.petir, 2.8, 0, 0, cell.cabang, 0.55, 0.42); }
      if (F.lod < 2) burst(p, 0.4, cell.cabang, 6, 0.3, 0.45, 1.5, 3, 1, 3, pal.petir, P.flip, 0.5, 2.6, -999, 0.5, 0.42, 0.01);
    },
  };

  // ===== Holografik (epik): segitiga foil, bingkai C/M/Y, prisma, garis spektrum =====
  THEMES.holo = {
    name: 'Holografik', finisher: 'Glitch', brass: '#c8d8ff',
    cells: ['segitiga', 'garis', 'bingkai', 'prisma', 'cincin'], cas: [cell.segitiga, pal.spektrum, 0.045, P.dropVm, 3, 1], kn: [cell.cincin, cell.segitiga, pal.spektrum, 1.8, P.flip, 1],
    fire(L, R, n) {
      const ads = R.ads > 0.5;
      pop(L, R.muzzle, cell.prisma, (ads ? 0.05 : 0.11) * (R.show ? 1.5 : 1), pal.spektrum, 2, 0.12, P.pop);
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, R.muzzle, cell.segitiga, 3, R.show ? 0.1 : 0.075, 1.6, 2.6, pal.spektrum, P.spinPop, 0.42, 1.8, 1, 0.4);
      spray(L, R, R.muzzle, cell.garis, 1, 0.16, 2.4, 3.2, HOLO[n % 3], P.streak, 0.3, 1.3, 0.22, 0.6);
    },
    fireWorld(p, d, n, k, floorY, sp) { wShed(p, d, 2, cell.segitiga, 0.16, 0.22, pal.spektrum, P.flip, 0.8, k, floorY, sp, 1.6, 1, 3, 5.5, 0.6, 1.8); },
    impact(p, d, full) { hit(p, d, cell.prisma, 0.3, pal.spektrum, 2, 0.4); if (full) ricochet(p, d, cell.segitiga, 3, 0.1, 0.14, pal.spektrum, P.flip, 0.6, 1.6, 1); },
    cue(L, R, ev, k) {
      if (ev === 'out') gunStamp(L, R, R.mag, cell.bingkai, 0.05, pal.holoC, 1.2, 0.4, 2.6);
      else if (ev === 'in') for (let i = 0; i < 3; i++) { VZ.copy(R.mag).addScaledVector(R.b, (i - 1) * 0.012); gunStamp(L, R, VZ, cell.bingkai, 0.1, HOLO[i], 1.2, 0.4, 0.5, i * 0.06, P.stamp); }
      else if (ev === 'bolt') gunRun(L, R, cell.garis, qn(5, 3), 0.1, pal.spektrum, P.streak, 0.25, 0.04, 2.2, 0.22, 0, 0, 0.012);
    },
    equip(L, R) { for (let i = 0; i < 3; i++) { VZ.copy(R.top).addScaledVector(R.b, 0.03); VZ.z -= 0.08; gunStamp(L, R, VZ, cell.bingkai, 0.16, HOLO[i], 1.2, 0.5, 2.4 - 0.5 * i, i * 0.07); } },
    inspect(L, R) { gunOrbit(L, R, R.muzzle.z * 0.6, cell.prisma, 3, 0.065, 0.08, 2.6, pal.spektrum, P.orbit, 1.9, 1.8, 1); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { pop(L, R.muzzle, cell.prisma, 0.07, pal.spektrum, 2, 0.3, P.glint); return; }
      const p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.03), k = R.show ? 1.35 : 1, N = qn(7, 4), f0 = tier === 2 ? R.f0 - 60 : R.f0, f1 = tier === 2 ? R.f1 + 30 : R.f1;
      for (let j = 0; j <= Math.min(1, tier); j++) for (let i = 0; i < N; i++) { const u = i / (N - 1), th = (f0 + (f1 - f0) * u) * D2R; L.emit(p.x, p.y, p.z, R.b.x, R.b.y, R.b.z, R.a.x, R.a.y, R.a.z, 0, (0.11 - 0.035 * j) * k, 0.24, P.fan, Math.abs(u - 0.5) * 2, HOLO[(i + j) % 3], 1.3, 1, th, cell.garis, 0.9, 0.05 + j * 0.12 + i * 0.02); }
      spray(L, R, p, cell.segitiga, qn(5, 3), 0.05, 0.6, 1.4, pal.spektrum, P.spinPop, 0.6, 1.8, 1, 0.2, 0.2, 0.05);
      pop(L, p, cell.prisma, 0.08 * k, pal.spektrum, 2.2, 0.8, P.glint, 0.05);
    },
    // "Glitch": tiga bingkai C/M/Y bergetar, runtuh jadi satu garis mendatar, cincin spektrum, segitiga beterbangan
    finisher(p, F, tier) {
      stamp(p, 0.05, cell.cincin, 3.4 + 0.5 * tier, pal.spektrum, 1.8, 1.0, P.ring, 0.1, 0.72);
      for (let i = 0; i < 3; i++) { const o = (i - 1) * 0.16; W.emit(p.x + F.sx * o, p.y + 0.1, p.z + F.sz * o, 0, 0, 0, F.sx * (i - 1) * 0.04, 1, F.sz * (i - 1) * 0.04, 0, 2.1 + 0.2 * tier, 0.9, P.flick, W.rand(), HOLO[i], 1.2, 0, 0, cell.bingkai, 0.72, i * 0.05); }
      for (let i = 0; i < 3; i++) W.emit(p.x - F.sx * 1.4, p.y + 1.05 + (i - 1) * 0.03, p.z - F.sz * 1.4, 0, 0, 0, F.sx, 0, F.sz, 0, 2.8 + 0.4 * tier, 0.05, P.beam, 0, HOLO[i], 1.5, 0, 0, cell.garis, 0.5, 0.7 + i * 0.03);
      if (F.lod < 2) burst(v2.set(p.x, p.y + 1.05, p.z), 0, cell.segitiga, 16 + 6 * tier, 0.24, 0.36, 1.5, 4, 0.5, 4, pal.spektrum, P.flip, 0.8, 1.8, -999, 1, 0.78, 0.004);
      if (tier >= 1) for (let i = 0; i < 3; i++) wpop(p, 1.1, cell.prisma, 0.9, pal.spektrum, 2.2, 0.5, P.flickPop, 0.2 + i * 0.15, 0, 1, 0);
      if (tier >= 2) { stamp(p, 0.07, cell.bingkai, 4.6, pal.holoM, 1.2, 0.9, P.stamp, 0.3, 0.8); beam(p, 0.1, 5, 0.1, pal.spektrum, 1.8, 0.8, 0.8); }
    },
  };

  // ===== Mutiara Laut (epik): kerang, gelembung, riak, ombak, butir mutiara =====
  THEMES.mutiara = {
    name: 'Mutiara Laut', finisher: 'Pusaran Mutiara', brass: '#f7d6e2',
    cells: ['kerang', 'gelembung', 'cincin2', 'ombak', 'butir'], cas: [cell.butir, pal.mutiara, 0.035, P.dropVm, 3, 1], kn: [cell.cincin2, cell.gelembung, pal.mutiara, 1.8, P.rise, 1],
    fire(L, R, n) {
      const ads = R.ads > 0.5;
      pop(L, R.muzzle, cell.cincin2, (ads ? 0.05 : 0.11) * (R.show ? 1.5 : 1), pal.mutiara, 2, 0.2, P.bloom);
      if (ads ? L.rand() > 0.35 : R.auto && (n & 1)) return;
      spray(L, R, R.muzzle, cell.gelembung, 2, R.show ? 0.1 : 0.07, 0.8, 1.5, pal.mutiara, P.bloom, 0.55, 1.6, 1, 0.3);
      if (!R.auto || (n & 3) === 0) spray(L, R, R.muzzle, cell.kerang, 1, R.show ? 0.1 : 0.075, 1.6, 2.4, pal.mutiara, P.flip, 0.5, 1, 1, 0.4);
    },
    fireWorld(p, d, n, k, floorY, sp) { wShed(p, d, 2, cell.gelembung, 0.16, 0.26, pal.mutiara, P.rise, 1.1, k, -999, sp, 1.6, 1, 2, 3.5, 0.2, 0.8); },
    impact(p, d, full) { hit(p, d, cell.cincin2, 0.3, pal.mutiara, 1.8, 0.4); hit(p, d, cell.cincin2, 0.5, pal.mutiara, 1.3, 0.45, P.bloom, 0.1); if (full) ricochet(p, d, cell.butir, 3, 0.07, 0.1, pal.mutiara, P.drop, 0.6, 1.4, 1); },
    cue(L, R, ev, k) {
      if (ev === 'out') gunShed(L, R.mag, cell.gelembung, cnt(L, 2 * k), 0.045, 0, 0.12, 0, 0.05, P.bloom, 0.7, 1.6, 0, pal.mutiara, 1, 0.1);
      else if (ev === 'in') { gunFan(L, R, R.mag, cell.kerang, 2, 0.07, 35, -35, 0.25, P.fanFast, 0, 1.2, 0, -1, pal.mutiara, 1); pop(L, R.mag, cell.butir, 0.035, pal.mutiara, 2.4, 0.4, P.glint, 0.1); }
      else if (ev === 'bolt') { gunStamp(L, R, R.port, cell.cincin2, 0.1, pal.mutiara, 1.8, 0.4, 0.2, 0, P.ring); }
    },
    equip(L, R) { gunFan(L, R, R.top, cell.kerang, 2, 0.1, -32, 32, 0.4, P.fanFast, 0, 1.2, 0, 1, pal.mutiara, 1); VZ.copy(R.top).addScaledVector(R.a, 0.05); pop(L, VZ, cell.butir, 0.05, pal.mutiara, 2.6, 0.5, P.glint, 0.15); },
    inspect(L, R) { gunOrbit(L, R, R.muzzle.z * 0.6, cell.gelembung, 3, 0.055, 0.08, 2.4, pal.mutiara, P.orbit, 1.9, 1.5, 1); },
    killGun(L, R, tier) {
      if (R.ads > 0.5) { spray(L, R, R.muzzle, cell.gelembung, 2, 0.05, 0.8, 1.4, pal.mutiara, P.bloom, 0.5, 1.6, 1); return; }
      const p = v3.copy(R.top).addScaledVector(R.b, R.show ? 0 : 0.03), k = R.show ? 1.35 : 1;
      const shell = (q0, sz, dl) => { gunFan(L, R, q0, cell.kerang, 2, sz, -38, 38, 0.8, P.fan, 0, 1.3, dl, 1, pal.mutiara, 1);
        VZ.set(R.a.x * 0.12, R.a.y * 0.12, R.a.z * 0.12); pop(L, q0, cell.butir, sz * 0.42, pal.mutiara, 2.6, 0.55, P.bloom, dl + 0.2, VZ);
        v2.copy(q0).addScaledVector(R.a, 0.075); for (let i = 0; i < 3; i++) gunStamp(L, R, v2, cell.cincin2, sz * (0.9 + 0.45 * i), pal.mutiara, 1.8, 0.42, 0.2, dl + 0.72 + i * 0.09, P.ring); };
      shell(p, 0.09 * k, 0.05);
      if (tier >= 1) gunRun(L, R, cell.ombak, qn(4, 2), 0.035 * k, pal.laut, P.grow, 0.6, 0.08, 1.2, 2, 0, 0.2);
      if (tier >= 2) { shell(v1.copy(p).setZ(p.z - 0.09), 0.065 * k, 0.2); shell(v1.copy(p).setZ(p.z + 0.07), 0.065 * k, 0.32); }
    },
    // "Pusaran mutiara": riak di tanah, ombak melingkar naik lalu pecah, kerang membuka melepas mutiara cahaya
    finisher(p, F, tier) {
      for (let i = 0; i < 3; i++) stamp(p, 0.05, cell.cincin2, 4.4 + 0.4 * tier, pal.mutiara, 1.7, 0.9, P.ring, 0.1, i * 0.22);
      growRing(p, 0, cell.ombak, 6 + 2 * tier, 1.3, 0.7, 0.95, 0.15, pal.laut, P.grow, 1.0, 1.2, 1.8, 0.05, 0.04); // ombak toska melingkar (bukan pastel: dulu menyatu jadi gundukan pucat)
      const y = p.y + 1.6;
      wFan(F, 0, 0, y, cell.kerang, pal.mutiara, 2, 1.4 + 0.2 * tier, 1.4 + 0.2 * tier, -40, 40, 0.3, 1.2, 1.2, false, 1, 1.6, 0);
      W.emit(F.cx, y + 0.5, F.cz, 0, 2.6, 0, 0, 1, 0, 0, 0.55 + 0.1 * tier, 1, P.bloom, 0, pal.mutiara, 3, 0, 0, cell.butir, 1.2, 0.6);
      beam(v2.set(F.cx, p.y, F.cz), 2.0, 4.5, 0.1, pal.mutiara, 1.6, 0.9, 0.7);
      if (F.lod < 2) { burst(p, 0.6, cell.gelembung, 12 + 4 * tier, 0.2, 0.36, 0.3, 1.4, 1, 2.6, pal.mutiara, P.rise, 1.1, 1.6, -999, 1, 0.5, 0.03); burst(p, 1.0, cell.butir, 8, 0.1, 0.15, 1, 2.5, 2, 4, pal.mutiara, P.drop, 0.8, 1.6, -999, 1, 1.0, 0.01); }
      if (tier >= 2) helix(p, 0.3, cell.gelembung, 10, 1.6, 1.6, 3, 0.3, pal.mutiara, P.orbit, 1.4, 1.6, 1, 0, 0.2, 0.03);
    },
  };

  // titik kerja magasin: titik lubang magasin (dari weapons.js / lobi) ada DI DALAM magasin, jadi kartu potong di sana
  // tertutup magasin & receiver. Geser 3 cm ke arah kamera (R.c, ruang senjata) supaya kartunya lahir di depan magasin.
  const magOut = (R) => R.mag.copy(R.mag0).addScaledVector(R.c, 0.03);
  // jangkar etalase: sumbu kipas dipilih supaya bidangnya menghadap kamera lobi
  function showRig() {
    if (!showObj) return null;
    showObj.updateWorldMatrix(true, false);
    S.gun.copy(showObj.matrixWorld);
    m1.extractRotation(S.gun);
    q1.setFromRotationMatrix(m1).invert();
    S.a.set(0, 1, 0).applyQuaternion(q1).normalize();
    S.b.setFromMatrixColumn(camera.matrixWorld, 0).applyQuaternion(q1).normalize();
    m1.copy(S.gun).invert(); S.c.copy(camera.position).applyMatrix4(m1).sub(S.mag0).normalize(); magOut(S);
    S.ads = 0; S.scoped = false; S.auto = false;
    return S;
  }
  const dist2 = (p) => { const dx = p.x - camera.position.x, dy = p.y - camera.position.y, dz = p.z - camera.position.z; return dx * dx + dy * dy + dz * dz; };
  const on = () => !!theme && level > 0;
  const tierOf = (n) => (n >= 5 ? 2 : n >= 3 ? 1 : 0);
  const F = { cx: 0, cz: 0, sx: 1, sz: 0, bx: 0, bz: 1, lod: 0 };
  function finish(T, p, from, n, lod) {
    let bx = p.x - from.x, bz = p.z - from.z; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl; // arah menjauhi pembunuh
    F.bx = bx; F.bz = bz; F.sx = -bz; F.sz = bx; F.cx = p.x + bx * 0.5; F.cz = p.z + bz * 0.5; F.lod = lod;
    LQ = lod === 0 ? 1 : lod === 1 ? 0.6 : 0.3; // LOD jarak: kartu kecil dikurangi, siluet besar tetap
    try { T.finisher(p, F, tierOf(n)); } finally { LQ = 1; }
  }

  const api = {
    get level() { return level; }, atlas, world: W, get vmLayer() { return V; },
    has: (fx) => !!(fx && THEMES[fx.id]),
    setLevel(i) { level = Math.max(0, Math.min(2, i | 0)); try { localStorage.setItem('royale.skinfx', SKINFX_LEVELS[level]); } catch (e) { /* abaikan */ } if (!level) { W.clear(); if (V) V.clear(); } },
    // adegan senjata orang pertama: lapisan kedua yang menempel senjata
    attachVm(v) {
      if (vm === v) return;
      vm = v;
      if (!V) { V = createShapeLayer({ max: 96, atlas, vm: true }); V.rng = 777; V.setLight(cSun, cAmb); }
      v.scene.add(V.group);
    },
    // tema dari skin yang dipakai: gs = entri GUN_SKINS (atau null)
    setThemes(gs) { const fx = gs && gs.th && gs.th.fx; theme = fx && THEMES[fx.id] ? THEMES[fx.id] : null; shots = impacts = casN = 0; pendEquip = 0; if (theme) atlas.need(theme.cells); },
    brass: () => (theme && level > 0 ? theme.brass : null),
    setLight(L) { if (L && L.sun && L.sky) { cSun.copy(L.sun).multiplyScalar(0.55); cAmb.copy(L.sky).multiplyScalar(0.5).addScalar(0.18); W.setLight(cSun, cAmb); if (V) V.setLight(cSun, cAmb); } },
    setShade(k) { W.setShade(k); if (V) V.setShade(Math.max(0.25, k)); },
    // pemain menembak. fp = orang pertama (senjata tampil); muz = moncong dunia (orang ketiga), dir = arah tembak
    fire(agent, kind, fp, muz, dir, auto) {
      if (!on() || !agent || !agent.isPlayer) return;
      shots++;
      const ok = fp && V && A.ok;
      if (ok && A.scoped) return;
      if (ok) { A.auto = !!auto; A.sz = A.ads > 0.5 ? 0.6 : 1; theme.fire(V, A, shots); }
      const every = auto ? 2 : 1;
      if (shots % every) return;
      let k = 1;
      if (ok) { // moncong layar: titik ruang kamera senjata dikali rasio FOV supaya lahir tepat di moncong yang terlihat
        const kk = Math.tan(camera.fov * D2R / 2) / VM_TAN;
        v1.copy(A.muzzle).applyMatrix4(A.gun); v1.x *= kk; v1.y *= kk; v1.applyMatrix4(camera.matrixWorld);
        if (A.ads > 0.5) k = 0.6;
      } else if (muz) v1.copy(muz); else return;
      theme.fireWorld(v1, dir, ok && A.ads > 0.5 ? 1 : cnt(W, kind === 'shotgun' || kind === 'dbs' ? 4 : 2), k, agent.pos.y, 1);
    },
    // kejadian lini waktu isi ulang senjata orang pertama (weapons.js props.cue): keluar / masuk / kokang
    cue(agent, ck) {
      if (!on() || !V || !A.ok || A.scoped) return;
      const ev = ck === 'out' || ck === 'open' ? 'out' : ck === 'in' || ck === 'close' || ck === 'shell' ? 'in' : ck === 'bolt' || ck === 'pump' || ck === 'tap' ? 'bolt' : null;
      if (ev) theme.cue(V, A, ev, ck === 'shell' || ck === 'tap' ? 0.5 : 1);
      return ev;
    },
    // cabut / periksa (weapons.js SKIN.cue). Cabut: saat kejadian tiba senjata lama masih turun (jangkar belum ada), jadi
    // efeknya ditunda sampai senjata baru tampil (paling lama 0,9 dtk)
    event(agent, ev) {
      if (!on() || !V) return;
      if (ev === 'equip') { if (A.ok && !A.scoped) theme.equip(V, A); else pendEquip = 0.9; }
      else if (ev === 'inspect' && A.ok && !A.scoped) theme.inspect(V, A);
    },
    // kait weapons.js: selongsong (p = titik lontar ruang kamera) → true = diganti kartu bertema
    hook(ev, p) { if (ev !== 'casing' || !on() || !V) return false; return theme.casing ? theme.casing(V, p, casN++) : casing(V, p, casN++, theme); },
    // peluru pemain mengenai sesuatu di p (arah peluru d)
    impact(agent, p, d) {
      if (!on() || !agent || !agent.isPlayer) return;
      const d2 = dist2(p);
      if (d2 > 60 * 60) return;
      impacts++;
      theme.impact(p, d, d2 < 25 * 25 && (impacts & 1) === 0);
    },
    // pemain menyingkirkan korban: n = kill beruntun, byGun = dengan senjata api
    kill(victim, n, head, byGun) {
      if (!on() || !byGun || !victim || !victim.pos) return;
      if (V && A.ok && !A.scoped) { A.sz = 1; theme.killGun(V, A, tierOf(n), head); }
      const d2 = dist2(victim.pos);
      finish(theme, victim.pos, camera.position, n, d2 < 25 * 25 ? 0 : d2 < 80 * 80 ? 1 : 2);
      return Math.sqrt(d2);
    },
    knock(victim) { if (on() && victim && victim.pos && dist2(victim.pos) < 80 * 80) { if (theme.knock) theme.knock(victim.pos); else knockDef(victim.pos, theme); } },
    // ---------- etalase lobi ----------
    // obj = grup senjata etalase (atau null), pts = { muzzle, port, mag, top } (Vector3 ruang senjata), fx = th.fx skin itu
    show(obj, pts, fx) {
      showObj = obj || null;
      S.ok = !!(obj && fx && THEMES[fx.id]);
      S.theme = S.ok ? THEMES[fx.id] : null;
      W.setClear(obj ? 0 : 1); // etalase: tanpa zona bersih bidikan
      if (S.ok) { S.muzzle.copy(pts.muzzle); S.port.copy(pts.port); S.mag0.copy(pts.mag); S.mag.copy(pts.mag); S.top.copy(pts.top); atlas.need(S.theme.cells); }
      else W.clear();
    },
    // peragaan: what = 'fire' | 'out' | 'in' | 'bolt' | 'equip' | 'inspect' | 'kill' | 'finisher' (p = posisi, n = beruntun)
    demo(what, n = 1, p = null) {
      if (!S.ok || !S.theme || level === 0) return false;
      const T = S.theme, R = showRig();
      if (what === 'finisher') { finish(T, p, camera.position, n, 0); return true; }
      if (!R) return false;
      if (what === 'fire') { // kartu dunia lepas pelan ke atas-kamera supaya tetap di bingkai etalase
        T.fire(W, R, 0);
        v1.copy(R.muzzle).applyMatrix4(R.gun); v2.set(0, 0, -1).transformDirection(R.gun).multiplyScalar(0.45); v2.y += 0.5; v3.setFromMatrixColumn(camera.matrixWorld, 0); v2.addScaledVector(v3, 0.45);
        T.fireWorld(v1, v2, 1, 0.55 * R.gun.getMaxScaleOnAxis(), v1.y - 1.2, 0.22);
      } else if (what === 'kill') T.killGun(W, R, tierOf(n), false);
      else if (what === 'equip') T.equip(W, R);
      else if (what === 'inspect') T.inspect(W, R);
      else { // isi ulang di etalase: kartu 1,5× (bulu 6 cm di senjata selebar bingkai nyaris tak terlihat); titik lontar dipindah
        // ke sisi senjata yang menghadap kamera (lubang lontar asli bisa di sisi belakang)
        const px = R.port.x; if (R.c.x * px < 0) R.port.x = -px;
        W.sizeK = 1.5; try { T.cue(W, R, what, 1); } finally { W.sizeK = 1; R.port.x = px; }
      }
      return true;
    },
    themeName: (fx) => (fx && THEMES[fx.id] ? THEMES[fx.id] : null),
    update(dt) {
      if (V && vm) {
        A.ok = !!vm.anchors(A);
        if (A.ok) {
          V.setAnchor(1, A.gun);
          m1.extractRotation(A.gun); q1.setFromRotationMatrix(m1).invert(); // sumbu layar di ruang senjata
          A.a.set(0, 1, 0).applyQuaternion(q1); A.b.set(1, 0, 0).applyQuaternion(q1); A.c.set(0, 0, 1).applyQuaternion(q1);
          A.mag0.copy(A.mag); magOut(A);
          if (pendEquip > 0 && theme && level > 0 && !A.scoped) { pendEquip = 0; A.sz = 1; theme.equip(V, A); }
        }
        if (pendEquip > 0) pendEquip -= dt;
        V.update(dt);
      }
      if (showObj && S.ok) { showObj.updateWorldMatrix(true, false); W.setAnchor(1, showObj.matrixWorld); }
      if (!atlas.ready && !(V && A.ok)) atlas.buildSome(3); // sisa sel dibangun sedikit-sedikit di lobi, bukan saat bertanding
      W.update(dt);
    },
    // atlas tema terpasang + program shader di muka (dipanggil saat memuat): kedua varian sasaran (HDR & layar)
    warm(renderer, rt) {
      atlas.need(THEMES.merak.cells);
      if (!renderer) return;
      try {
        renderer.initTexture(atlas.tex); renderer.initTexture(atlas.pal);
        const s = new THREE.Scene(), g = W.group, par = g.parent;
        s.add(g); W.show(true);
        const prev = renderer.getRenderTarget();
        if (rt) { renderer.setRenderTarget(rt); renderer.compile(s, camera); }
        renderer.setRenderTarget(null); renderer.compile(s, camera);
        renderer.setRenderTarget(prev);
        W.show(false); if (par) par.add(g);
      } catch (e) { console.warn('Kompilasi efek skin gagal:', e.message); }
    },
    stats: () => ({ vm: V ? V.stats() : { alive: 0, peak: 0, emitted: 0 }, world: W.stats() }),
  };
  return api;
}
