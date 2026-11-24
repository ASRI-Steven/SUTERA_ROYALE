// Sutradara efek skin berbentuk (Skin v2): menerjemahkan kejadian game (tembak, isi ulang, cabut, periksa, kill, finisher)
// menjadi kartu berbentuk (game/shapefx.js + atlas game/fxshapes.js) menurut tema skin senjata yang dipakai pemain
// (GUN_SKINS[i].th.fx.id). Skin tanpa `fx` & bot: tidak ada apa-apa. Dua lapisan: `V` di adegan senjata orang pertama
// (menempel senjata), `W` di dunia (bulu yang lepas, dampak, finisher, etalase lobi).
// Setelan pemain "Efek skin" (localStorage royale.skinfx): penuh | ringkas | mati.
// main.js: createSkinFx({ scene, camera }) → lihat objek yang dikembalikan make(). Gagal dibuat → objek tanpa-kerja.
import * as THREE from 'three';
import { createFxAtlas } from './fxshapes.js';
import { createShapeLayer, PRESET as P } from './shapefx.js';

const D2R = Math.PI / 180, VM_TAN = Math.tan(27 * D2R); // kamera senjata orang pertama: FOV 54°
export const SKINFX_LEVELS = ['mati', 'ringkas', 'penuh'];
const NOOP_NAMES = ['attachVm', 'setThemes', 'setLight', 'setShade', 'setLevel', 'fire', 'cue', 'event', 'impact', 'kill', 'knock', 'show', 'demo', 'update', 'compile', 'warm'];

export function createSkinFx(o) {
  try { return make(o); }
  catch (e) {
    console.warn('Efek skin berbentuk dimatikan:', e.message);
    const n = { level: 2, stats: () => ({ vm: { alive: 0, peak: 0, emitted: 0 }, world: { alive: 0, peak: 0, emitted: 0 } }), hook: () => false, has: () => false, features: () => [] };
    for (const k of NOOP_NAMES) n[k] = () => {};
    return n;
  }
}

function make({ scene, camera }) {
  const atlas = createFxAtlas();
  const W = createShapeLayer({ max: 384, atlas, vm: false });
  scene.add(W.group);
  let V = null, vm = null, theme = null, level = 2, shots = 0, impacts = 0, casN = 0;
  try { const s = localStorage.getItem('royale.skinfx'), i = SKINFX_LEVELS.indexOf(s); if (i >= 0) level = i; } catch (e) { /* abaikan */ }
  const cell = {}; for (const n of atlas.names) cell[n] = atlas.cell(n);
  const palMerak = atlas.palRow('merak'), palEmas = atlas.palRow('emas');
  // jangkar senjata: A = orang pertama (diisi vm.anchors tiap frame), S = etalase lobi
  const mk = () => ({ gun: new THREE.Matrix4(), muzzle: new THREE.Vector3(), port: new THREE.Vector3(), mag: new THREE.Vector3(), top: new THREE.Vector3(), kind: 'ar', ads: 0, scoped: false, a: new THREE.Vector3(0, 1, 0), b: new THREE.Vector3(1, 0, 0), ok: false });
  const A = mk(), S = mk();
  let showObj = null;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), cSun = new THREE.Color(0.55, 0.52, 0.46), cAmb = new THREE.Color(0.5, 0.52, 0.56);
  const rr = (L, a, b) => a + L.rand() * (b - a);
  const q = () => (level === 1 ? 0.5 : 1); // Ringkas: jumlah kartu setengah
  const cnt = (L, n) => { const x = n * q(), f = Math.floor(x); return f + (L.rand() < x - f ? 1 : 0); };

  // ---------- kata kerja (ruang senjata: jangkar 1, sumbu R.a = atas, R.b = samping yang menghadap kamera) ----------
  // kipas bilah di titik p: sudut from..to (derajat dari R.a ke arah R.b), buka → tahan → (bilah genap menutup & larut, bilah
  // ganjil lepas melayang bila `rel`)
  function gunFan(L, R, p, shape, n, len, from, to, hold, preset, rel, gain = 1.2, d0 = 0.05, flip = 1) {
    const out = preset === P.fanBig ? 0.7 : preset === P.fanFast ? 0.16 : 0.34;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0.5, th = (from + (to - from) * u) * D2R, sn = Math.abs(u - 0.5) * 2, dl = d0 + sn * 0.07, ln = len * (1 - 0.14 * sn);
      const odd = rel && (i & 1);
      L.emit(p.x, p.y, p.z, R.b.x, R.b.y, R.b.z, R.a.x * flip, R.a.y * flip, R.a.z * flip, 0, ln, 0.5, odd ? P.fanHold : preset, sn, palMerak, gain, 1, th, shape, odd ? hold - dl : hold + out - dl, dl);
      if (odd) { // lepas: kartu melayang mulai dari pose bilah saat itu
        const c = Math.cos(th), s = Math.sin(th), dx = (R.a.x * c * flip + R.b.x * s), dy = (R.a.y * c * flip + R.b.y * s), dz = (R.a.z * c * flip + R.b.z * s);
        L.emit(p.x, p.y, p.z, dx * rel, dy * rel + rel * 0.6, dz * rel, dx, dy, dz, 0, ln, 0.5, L === V ? P.driftVm : P.rise, L.rand(), palMerak, gain, 1, -999, shape, L === V ? 0.6 : 0.75, hold);
      }
    }
  }
  // kartu lepas dari titik p (ruang senjata) dengan kecepatan dasar (vx, vy, vz) ± sebar
  function gunShed(L, p, shape, n, size, vx, vy, vz, spread, preset, life, gain = 1, delay = 0) {
    for (let i = 0; i < n; i++) L.emit(p.x, p.y, p.z, vx + rr(L, -spread, spread), vy + rr(L, -spread, spread), vz + rr(L, -spread, spread), rr(L, -0.4, 0.4), 1, rr(L, -0.4, 0.4), rr(L, -0.6, 0.6), size * rr(L, 0.85, 1.15), 0.5, preset, L.rand(), palMerak, gain, 1, -999, shape, life * rr(L, 0.85, 1.1), delay + i * 0.03);
  }

  // ---------- tema ----------
  // R = jangkar senjata (A atau S), L = lapisan (V atau W). Semua ukuran meter di ruang senjata.
  const THEMES = {
    merak: {
      name: 'Dadak Merak', finisher: 'Dadak Merak', brass: '#58c7a4',
      fire(L, R, fp) {
        if (R.scoped) return;
        const m = R.muzzle, ads = R.ads > 0.5;
        L.emit(m.x, m.y, m.z, 0, 0, 0, 0, 1, 0, L.rand() * 6.28, ads ? 0.05 : 0.09, 1, P.pop, 0, palMerak, 2.2, 1, 0, cell.mata_merak, 0.09);
        if (ads && L.rand() > 0.35) return;
        // satu bulu melesat dari moncong, kerucut 25° menjauhi pusat layar (ke samping-luar & atas)
        const sp = rr(L, 3, 4.5), c = rr(L, 10, 28) * D2R, ph = rr(L, -0.5, 1.7), lx = Math.sin(c) * Math.cos(ph), ly = Math.sin(c) * Math.sin(ph);
        L.emit(m.x, m.y, m.z, (R.b.x * lx + R.a.x * ly) * sp, (R.b.y * lx + R.a.y * ly) * sp, -Math.cos(c) * sp, 0, 1, 0, 0, (ads ? 0.075 : 0.16), 0.5, P.dart, L.rand(), palMerak, 1, 1, 0, cell.bulu_merak, 0.42);
      },
      // bulu yang lepas ke dunia dari moncong (p, arah d): melambat lalu melayang turun berayun
      fireWorld(p, d, n, k, floorY) {
        for (let i = 0; i < n; i++) {
          const sp = rr(W, 3, 6);
          W.emit(p.x, p.y, p.z, d.x * sp + rr(W, -0.9, 0.9), d.y * sp + rr(W, 0.2, 1.1), d.z * sp + rr(W, -0.9, 0.9), rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), rr(W, -0.5, 0.5), rr(W, 0.14, 0.18) * k, 0.5, P.drift, W.rand(), palMerak, 0.9, 0, floorY, cell.bulu_merak, 1.4);
        }
      },
      impact(p, d, full) {
        W.emit(p.x - d.x * 0.04, p.y - d.y * 0.04, p.z - d.z * 0.04, 0, 0, 0, 0, 1, 0, W.rand() * 6.28, 0.22, 1, P.bloom, 0, palMerak, 1.6, 0, 0, cell.mata_merak, 0.37);
        if (!full) return;
        const n = cnt(W, 3);
        for (let i = 0; i < n; i++) W.emit(p.x - d.x * 0.05, p.y - d.y * 0.05, p.z - d.z * 0.05, -d.x * 1.6 + rr(W, -1.4, 1.4), rr(W, 0.8, 2.4), -d.z * 1.6 + rr(W, -1.4, 1.4), rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), 0, rr(W, 0.1, 0.14), 0.5, P.drop, W.rand(), palMerak, 0.8, 0, -999, cell.bulu_kecil, 0.7);
      },
      casing(L, p, i) { // tiap selongsong ke-3 jadi bulu kecil berputar (ruang kamera, jangkar 0)
        if (i % 3 !== 2) return false;
        L.emit(p.x, p.y, p.z, rr(L, 1.2, 2.2), rr(L, 0.9, 1.7), rr(L, 0.1, 0.6), 0.3, 1, 0, 0, 0.05, 0.5, P.dropVm, L.rand(), palMerak, 1, 0, -999, cell.bulu_kecil, 0.8);
        return true;
      },
      cue(L, R, ev, k) {
        if (ev === 'out') gunShed(L, R.mag, cell.bulu_kecil, cnt(L, 3 * k), 0.06, 0, -0.25, 0, 0.18, L === V ? P.dropVm : P.drop, 0.6);
        else if (ev === 'in') { // kipas 5 bulu kecil di lubang magasin (menghadap bawah), buka ±50°, tahan, tutup
          // dua kipas kecil mekar ke kiri-kanan lubang magasin (bukan lurus ke bawah: tertutup magasinnya sendiri)
          const nb = Math.max(2, cnt(L, 3 * k));
          gunFan(L, R, R.mag, cell.bulu_kecil, nb, 0.07, 50, 115, 0.3, P.fanFast, 0, 1.2, 0, -1); gunFan(L, R, R.mag, cell.bulu_kecil, nb, 0.07, -50, -115, 0.3, P.fanFast, 0, 1.2, 0, -1);
        } else if (ev === 'bolt') {
          const p = R.port;
          for (let i = 0; i < Math.max(1, cnt(L, 2 * k)); i++) L.emit(p.x, p.y, p.z, R.b.x * rr(L, 1.3, 2.2), rr(L, 0.6, 1.4), rr(L, -0.3, 0.5), 0, 1, 0, 0, 0.08, 0.5, P.dart, L.rand(), palMerak, 1, 1, 0, cell.bulu_merak, 0.4, i * 0.04);
          L.emit(p.x, p.y, p.z, 0, 0, 0, 0, 1, 0, 0, 0.045, 1, P.pop, 0, palMerak, 2, 1, 0, cell.mata_merak, 0.12);
        }
      },
      equip(L, R) { if (!R.scoped) gunFan(L, R, R.top, cell.bulu_merak, Math.max(4, cnt(L, 7)), 0.10, -20, 80, 0.4, P.fanFast, 0, 1.2, 0); },
      inspect(L, R) { // ombak 5 bulu sepanjang laras: rebah → tegak → rebah bergiliran; satu bulu kecil lepas
        const n = Math.max(3, cnt(L, 5));
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1), z = R.top.z + (R.muzzle.z * 0.86 - R.top.z) * u, y = R.top.y + (R.muzzle.y + 0.012 - R.top.y) * u;
          L.emit(0, y, z, -R.b.x, -R.b.y, -R.b.z, R.a.x, R.a.y, R.a.z, 0, 0.085, 0.5, P.wave, 0.3, palMerak, 1.1, 1, 0, cell.bulu_merak, 0.62, 0.1 + i * 0.12);
        }
        gunShed(L, R.top, cell.bulu_kecil, 1, 0.055, 0.12, 0.1, 0, 0.05, L === V ? P.driftVm : P.drift, 1.0, 1, 0.5);
      },
      // kill di senjata: kipas bulu merak di atas receiver (tiga tingkat), ADS: dua bulu menyembur di samping moncong
      killGun(L, R, n, head) {
        if (R.scoped) return;
        if (R.ads > 0.5) { gunShed(L, R.muzzle, cell.bulu_merak, 2, 0.07, R.b.x * 1.4, 0.7, 0, 0.3, P.dart, 0.45); return; }
        const tier = n >= 5 ? 2 : n >= 3 ? 1 : 0, N = Math.max(5, Math.round(([7, 9, 11][tier] + (head ? 2 : 0)) * q())), len = [0.11, 0.12, 0.13][tier];
        gunFan(L, R, R.top, cell.bulu_merak, N, len, -20, 80, 0.95, P.fan, 0.35, 1.3);
        if (tier === 2) gunFan(L, R, R.top, cell.bulu_merak, Math.round(6 * q()), 0.08, -12, 70, 0.95, P.fan, 0, 1.3, 0.12);
        L.emit(R.top.x, R.top.y + 0.004, R.top.z, 0, 0, 0, 0, 1, 0, 0, 0.05 + 0.012 * tier, 1, P.glint, 0, palMerak, 2.4, 1, 0, cell.mata_merak, 0.5, 0.05);
      },
      // finisher "Dadak Merak" di posisi korban p (kaki), dilihat dari from: kipas raksasa berdiri 0,5 m di belakang korban
      finisher(p, from, n, lod) {
        const tier = n >= 5 ? 2 : n >= 3 ? 1 : 0;
        let bx = p.x - from.x, bz = p.z - from.z; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl; // arah menjauhi pembunuh
        const sx = -bz, sz = bx, cx = p.x + bx * 0.5, cz = p.z + bz * 0.5, y0 = p.y + 0.35;
        const fan = (ox, fwd, N, lmin, lmax, spread, d0, hold, gain) => {
          const px = cx + sx * ox - bx * fwd, pz = cz + sz * ox - bz * fwd;
          for (let i = 0; i < N; i++) {
            const u = N > 1 ? i / (N - 1) : 0.5, th = (u * 2 - 1) * spread * D2R, sn = Math.abs(u * 2 - 1), dl = d0 + sn * 0.33, ln = lmin + (lmax - lmin) * (1 - sn * sn), odd = i & 1;
            W.emit(px, y0, pz, sx, 0, sz, 0, 1, 0, 0, ln, 0.46, odd ? P.fanHold : P.fanBig, sn, palMerak, gain, 0, th, cell.bulu_merak, odd ? hold - dl : 1.9 - dl, dl);
            if (odd && lod < 2) { const c = Math.cos(th), s = Math.sin(th); W.emit(px, y0, pz, sx * s * 0.7, c * 0.5 + 0.9, sz * s * 0.7, sx * s, c, sz * s, 0, ln, 0.46, P.rise, W.rand(), palMerak, gain, 0, -999, cell.bulu_merak, 0.75, hold); }
          }
        };
        // cincin mata merak di tanah r 0,3 → 1,6 m
        W.emit(p.x, p.y + 0.05, p.z, 0, 0, 1, 1, 0, 0, 0, 3.2 + 0.4 * tier, 1, P.stamp, 0, palMerak, 1.5, 0, 0.19, cell.mata_merak, 1.7);
        W.emit(p.x, p.y + 0.06, p.z, 0, 0, 1, 1, 0, 0, 0, 3.6 + 0.6 * tier, 1, P.ring, 0, palMerak, 1.6, 0, 0.1, cell.cincin, 1.0, 0.02);
        fan(0, 0, Math.round([13, 17, 17][tier] * (lod ? 0.75 : q())), 1.9, 2.4, 80, 0.05, 1.2, 1.3);
        if (tier >= 1) {
          fan(0, 0.06, Math.round(7 * q()), 1.0, 1.2, 62, 0.16, 1.25, 1.5);
          if (lod < 2) for (let i = 0; i < Math.round(8 * q()); i++) { const a = (i / 7 * 2 - 1) * 1.1; W.emit(cx, y0 + 0.3, cz, sx * Math.sin(a) * 4, Math.cos(a) * 4 + 1, sz * Math.sin(a) * 4, 0, 1, 0, 0, 0.7, 0.2, P.streak, W.rand(), palEmas, 2.4, 0, 0, cell.garis, 0.7, 0.42); }
        }
        if (tier >= 2) {
          fan(-1.35, -0.05, Math.round(7 * q()), 1.1, 1.4, 55, 0.22, 1.2, 1.3); fan(1.35, -0.05, Math.round(7 * q()), 1.1, 1.4, 55, 0.22, 1.2, 1.3);
          W.emit(cx, p.y + 0.1, cz, 0, 0, 0, 0, 1, 0, 0, 6, 0.16, P.beam, 0, palMerak, 1.6, 0, 0, cell.pilar, 1.5, 0.1);
        }
        if (lod === 0) for (let i = 0; i < cnt(W, 10); i++) W.emit(p.x + rr(W, -1.3, 1.3), p.y + rr(W, 1.6, 2.9), p.z + rr(W, -1.3, 1.3), rr(W, -0.5, 0.5), rr(W, -0.2, 0.6), rr(W, -0.5, 0.5), rr(W, -0.5, 0.5), 1, rr(W, -0.5, 0.5), 0, rr(W, 0.16, 0.22), 0.5, P.drift, W.rand(), palMerak, 0.9, 0, p.y, cell.bulu_kecil, rr(W, 1.3, 1.9), 0.3 + i * 0.06);
      },
      knock(p) {
        W.emit(p.x, p.y + 0.05, p.z, 0, 0, 1, 1, 0, 0, 0, 1.7, 1, P.stamp, 0, palMerak, 1.4, 0, 0.2, cell.mata_merak, 0.7);
        for (let i = 0; i < cnt(W, 4); i++) W.emit(p.x, p.y + 0.5, p.z, rr(W, -1.6, 1.6), rr(W, 1.2, 2.4), rr(W, -1.6, 1.6), 0, 1, 0, 0, rr(W, 0.16, 0.2), 0.5, P.drop, W.rand(), palMerak, 0.9, 0, p.y, cell.bulu_kecil, 0.7);
      },
    },
  };

  // jangkar etalase: sumbu kipas dipilih supaya bidangnya menghadap kamera lobi
  function showRig() {
    if (!showObj) return null;
    showObj.updateWorldMatrix(true, false);
    S.gun.copy(showObj.matrixWorld);
    m1.copy(S.gun).invert();
    q1.setFromRotationMatrix(m1);
    S.a.set(0, 1, 0).applyQuaternion(q1).normalize();
    S.b.setFromMatrixColumn(camera.matrixWorld, 0).applyQuaternion(q1).normalize();
    S.ads = 0; S.scoped = false;
    return S;
  }
  const dist2 = (p) => { const dx = p.x - camera.position.x, dy = p.y - camera.position.y, dz = p.z - camera.position.z; return dx * dx + dy * dy + dz * dz; };
  const on = () => !!theme && level > 0;

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
    setThemes(gs) { const fx = gs && gs.th && gs.th.fx; theme = fx && THEMES[fx.id] ? THEMES[fx.id] : null; shots = impacts = casN = 0; },
    brass: () => (theme && level > 0 ? theme.brass : null),
    setLight(L) { if (L && L.sun && L.sky) { cSun.copy(L.sun).multiplyScalar(0.55); cAmb.copy(L.sky).multiplyScalar(0.5).addScalar(0.18); W.setLight(cSun, cAmb); if (V) V.setLight(cSun, cAmb); } },
    setShade(k) { W.setShade(k); if (V) V.setShade(Math.max(0.25, k)); },
    // pemain menembak. fp = orang pertama (senjata tampil); muz = moncong dunia (orang ketiga), dir = arah tembak
    fire(agent, kind, fp, muz, dir, auto) {
      if (!on() || !agent || !agent.isPlayer) return;
      shots++;
      const ok = fp && V && A.ok;
      if (ok) theme.fire(V, A, true);
      if (ok && A.scoped) return;
      const every = auto ? 2 : 1;
      if (shots % every) return;
      let k = 1;
      if (ok) { // moncong layar: titik ruang kamera senjata dikali rasio FOV supaya lahir tepat di moncong yang terlihat
        const kk = Math.tan(camera.fov * D2R / 2) / VM_TAN;
        v1.copy(A.muzzle).applyMatrix4(A.gun); v1.x *= kk; v1.y *= kk; v1.applyMatrix4(camera.matrixWorld);
        if (A.ads > 0.5) k = 0.6;
      } else if (muz) v1.copy(muz); else return;
      theme.fireWorld(v1, dir, ok && A.ads > 0.5 ? 1 : cnt(W, kind === 'shotgun' || kind === 'dbs' ? 4 : 2), k, agent.pos.y);
    },
    // kejadian lini waktu isi ulang senjata orang pertama (weapons.js props.cue): keluar / masuk / kokang
    cue(agent, ck) {
      if (!on() || !V || !A.ok || A.scoped) return;
      const ev = ck === 'out' || ck === 'open' ? 'out' : ck === 'in' || ck === 'close' || ck === 'shell' ? 'in' : ck === 'bolt' || ck === 'pump' || ck === 'tap' ? 'bolt' : null;
      if (ev) theme.cue(V, A, ev, ck === 'shell' || ck === 'tap' ? 0.5 : 1);
      return ev;
    },
    event(agent, ev) { if (!on() || !V || !A.ok) return; if (ev === 'equip') theme.equip(V, A); else if (ev === 'inspect') theme.inspect(V, A); },
    // kait weapons.js: selongsong (p = titik lontar ruang kamera) → true = diganti kartu bertema
    hook(ev, p) { if (ev !== 'casing' || !on() || !V) return false; return theme.casing(V, p, casN++); },
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
      if (V && A.ok) theme.killGun(V, A, n, head);
      const d2 = dist2(victim.pos);
      theme.finisher(victim.pos, camera.position, n, d2 < 25 * 25 ? 0 : d2 < 80 * 80 ? 1 : 2);
      return Math.sqrt(d2);
    },
    knock(victim) { if (on() && victim && victim.pos && dist2(victim.pos) < 80 * 80) theme.knock(victim.pos); },
    // ---------- etalase lobi ----------
    // obj = grup senjata etalase (atau null), pts = { muzzle, port, mag, top } (Vector3 ruang senjata), fx = th.fx skin itu
    show(obj, pts, fx) {
      showObj = obj || null;
      S.ok = !!(obj && fx && THEMES[fx.id]);
      S.theme = S.ok ? THEMES[fx.id] : null;
      if (S.ok) { S.muzzle.copy(pts.muzzle); S.port.copy(pts.port); S.mag.copy(pts.mag); S.top.copy(pts.top); }
      else W.clear();
    },
    // peragaan: what = 'fire' | 'out' | 'in' | 'bolt' | 'equip' | 'inspect' | 'kill' | 'finisher' (p = posisi, n = beruntun)
    demo(what, n = 1, p = null) {
      if (!S.ok || !S.theme || level === 0) return false;
      const T = S.theme, R = showRig();
      if (what === 'finisher') { T.finisher(p, camera.position, n, 0); return true; }
      if (!R) return false;
      if (what === 'fire') { T.fire(W, R, false); v1.copy(R.muzzle).applyMatrix4(R.gun); v2.set(0, 0, -1).transformDirection(R.gun); T.fireWorld(v1, v2, 1, 1.0, v1.y - 1.2); }
      else if (what === 'kill') T.killGun(W, R, n, false);
      else if (what === 'equip') T.equip(W, R);
      else if (what === 'inspect') T.inspect(W, R);
      else T.cue(W, R, what, 1);
      return true;
    },
    themeName: (fx) => (fx && THEMES[fx.id] ? THEMES[fx.id] : null),
    update(dt) {
      if (V && vm) { A.ok = !!vm.anchors(A); if (A.ok) V.setAnchor(1, A.gun); V.update(dt); }
      if (showObj && S.ok) { showObj.updateWorldMatrix(true, false); W.setAnchor(1, showObj.matrixWorld); }
      W.update(dt);
    },
    // atlas + program shader di muka (dipanggil saat memuat): kedua varian sasaran (HDR & layar)
    warm(renderer, rt) {
      atlas.buildAll();
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
