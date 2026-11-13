// Pemain: pesawat → terjun bebas → payung → darat. Di darat: orang pertama (default) atau ketiga (V), mouse terkunci
// (pointer lock), W A S D, Shift lari, C jongkok, Spasi lompat, klik kiri tembak, klik kanan bidik, R isi ulang,
// 1/2/3/scroll ganti senjata, F ambil barang / naik kendaraan / terjun / buka payung, 4 perban, 5 P3K, M peta besar,
// Z tiarap (di rumput tinggi tidak terlihat dari jauh), C jongkok. Di air: berenang (senjata disimpan), C menyelam
// (tidak terlihat bot, napas 20 dtk), Spasi naik ke permukaan.
// Di kendaraan: W gas, S rem/mundur, A D setir, Spasi rem tangan, Shift boost, H klakson, V kamera, F turun,
// klik kiri tembak / klik kanan bidik (sopir: pistol/SMG saja, satu tangan; penumpang: semua senjata), R isi ulang,
// 1/2/3 ganti senjata, Ctrl+1..4 pindah kursi (1 = sopir; kendaraan tanpa sopir meluncur lalu berhenti).
import * as THREE from 'three';
import { WEAPONS, NADES, createViewModel } from './weapons.js';
import { applyItem, propGeometry, crateEntries, takeCrateEntry, crateEmpty, ITEMS } from './loot.js';
import { itemIcon } from './icons.js';
import { buildCharacter } from '../map/rig.js';
import { applyEquipped } from './skins.js';
import * as audio from './audio.js';

const D2R = Math.PI / 180;
const EYE = 1.62, EYE_CROUCH = 1.12, EYE_PRONE = 0.42, RAD = 0.35, GRAV = 18;
const SPEED = { walk: 4.1, sprint: 6.6, crouch: 2.1, ads: 2.6, prone: 1.15, swim: 2.2, swimFast: 3.1, dive: 1.8 };
const SWIM_Y = -1.3, BREATH = 25, WADE_D = 1.2, WATER_S = 0.08; // kepala di permukaan; napas (dtk); < 1,2 m = mengarungi; tinggi permukaan air
const OUTFIT = { shirt: '#503EBA', sleeve: '#503EBA', pants: '#2b2940', skin: '#c68c66', hair: '#231c18', shoes: '#1c1b22', gear: '#4c5340', pack: '#3a3d34', trim: '#D29F52',
  glove: '#25232c', cuff: '#D29F52', inner: '#d9d5cc' }; // sarung tangan & manset = tangan orang pertama (game/weapons.js)
const clamp = THREE.MathUtils.clamp;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// menembak dari kendaraan: sopir hanya pistol/SMG; busur tembak relatif hadap kendaraan (sopir ±100°, penumpang ±150°)
const DRIVER_GUNS = { pistol: true, smg: true, pdw: true, revolver: true };
const ARC_DRIVER = 100 * D2R, ARC_PASS = 150 * D2R;

export function createPlayer(ctx) {
  const { scene, camera, renderer, col, loot, combat, hud, agent: me } = ctx;
  const cvs = renderer.domElement;
  const vm = createViewModel({ kit: propGeometry('kit'), band: propGeometry('band') }); // barang Blender untuk animasi obat
  const char = buildCharacter(OUTFIT, { pack: true, hair: true, stripe: true }, { variant: 'm1', hair: 0 });
  // perlengkapan karakter orang ketiga diatur ulang hanya saat berubah (bukan tiap frame)
  const GUN_KEYS = Object.keys(WEAPONS), GUN_GEAR = {};
  for (const k of GUN_KEYS) GUN_GEAR[k] = 'gun_' + k;
  let charGun = null, charHelm = -1, charVest = -1;
  char.root.visible = false;
  scene.add(char.root);
  const chuteGLB = propGeometry('parachute'); // parasut Blender: asal di titik gantung (bahu), kanopi di atas, tepi depan −Z
  if (chuteGLB) chuteGLB.rotateY(Math.PI); // tepi depan menghadap arah terbang (+Z karakter)
  const chute = new THREE.Mesh(chuteGLB || new THREE.SphereGeometry(3.4, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.32).scale(1, 0.55, 0.75), new THREE.MeshLambertMaterial({ color: '#D29F52', emissive: '#7a5520', side: THREE.DoubleSide, vertexColors: !!chuteGLB }));
  const chuteY = chuteGLB ? 1.45 : 4.6;
  chute.visible = false;
  scene.add(chute);
  const st = {
    yaw: 0, pitch: -0.1, tpp: false, ads: false, firing: false, trigger: false, crouch: false, sprint: false, nextShot: 0, reloadEnd: 0, reloadFor: null,
    switchEnd: 0, healEnd: 0, healKind: null, recoilP: 0, recoilY: 0, mdx: 0, mdy: 0, sens: 1, camD: 0, plane: null, landedAt: -1, stepT: 0, prompt: null, lastLock: 0,
    vfp: false, vzoom: 1, lookT: 0, shake: 0, prone: false, stanceT: 0, swapPose: 0, swim: false, dive: false, breath: 1,
    // di kendaraan: vDraw = sopir sudah mencabut senjata, vArmed = siap tembak, vBlock = bidikan di luar busur tembak,
    // vRel = arah bidik relatif kendaraan (rad), vSpread = sebaran saat ini, vLean = condong keluar jendela (0..1)
    vDraw: false, vIdle: 0, vArmed: false, vBlock: false, vRel: 0, vSpread: 1.5, vLean: 0,
  };
  const keys = { fwd: 0, back: 0, left: 0, right: 0, hb: 0 };
  const drv = () => me.state === 'drive' && me.vehicle;
  const isDriver = () => !!(me.vehicle && me.vehicle.driver === me);
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), muz = new THREE.Vector3();
  const org = new THREE.Vector3(), dirV = new THREE.Vector3(), tip = new THREE.Vector3();

  // ---------- Input ----------
  const locked = () => document.pointerLockElement === cvs;
  let lockFailed = false; // browser menolak pointer lock → seret mouse untuk melihat
  document.addEventListener('pointerlockerror', () => { lockFailed = true; });
  ctx.locked = locked;
  ctx.lock = () => { if (!locked() && cvs.requestPointerLock) { try { const p = cvs.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* abaikan */ } } };
  addEventListener('mousemove', (e) => {
    if (!(locked() || (lockFailed && e.buttons)) || !ctx.playing()) return;
    const s = 0.0022 * st.sens * (st.ads ? (weapon() && weapon().def.scope ? 0.35 : 0.7) : 1);
    st.yaw -= e.movementX * s;
    st.pitch = clamp(st.pitch - e.movementY * s, -1.45, 1.45);
    st.mdx += e.movementX;
    st.mdy += e.movementY;
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) st.lookT = ctx.now();
  });
  cvs.addEventListener('mousedown', (e) => {
    if (!ctx.playing()) return;
    if (st.lootUI) { closeLoot(true); return; } // klik di luar panel loot = tutup
    if (!locked() && !lockFailed) { ctx.lock(); return; }
    if (!me.alive) { if (e.button === 0 && ctx.specNext) ctx.specNext(1); return; } // menonton rekan: klik = rekan berikutnya
    if (me.down) return; // tumbang: tidak bisa menembak
    if (drv()) { // kendaraan: klik kiri tembak, klik kanan bidik (cabut senjata yang boleh dipakai di kursi ini dulu)
      if ((e.button === 0 || e.button === 2) && vehDraw()) { if (e.button === 0) { st.firing = true; st.trigger = true; } else st.ads = true; }
      return;
    }
    if (e.button === 0) { st.firing = true; st.trigger = true; }
    if (e.button === 2) st.ads = true;
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) st.firing = false; if (e.button === 2) st.ads = false; });
  cvs.addEventListener('contextmenu', (e) => e.preventDefault());
  cvs.addEventListener('wheel', (e) => {
    if (!ctx.playing()) return;
    if (drv()) st.vzoom = clamp(st.vzoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.6, 1.8);
    else if (me.state === 'ground' && me.alive && !me.down) cycle(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
  const KM = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  addEventListener('keydown', (e) => {
    if (!ctx.playing()) return;
    if (!me.alive) { // tersingkir, rekan masih main: Spasi/F/D/→ = rekan berikutnya, A/← = sebelumnya, M = peta
      if (e.repeat || !ctx.specNext) return;
      if (e.code === 'Space' || e.code === 'KeyF' || e.code === 'KeyE' || e.code === 'KeyD' || e.code === 'ArrowRight') { e.preventDefault(); ctx.specNext(1); }
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') { e.preventDefault(); ctx.specNext(-1); }
      else if (e.code === 'KeyM') ctx.toggleMap();
      return;
    }
    const k = KM[e.code];
    if (k) { keys[k] = 1; e.preventDefault(); return; }
    if (me.down) { if (e.code === 'KeyM' && !e.repeat) ctx.toggleMap(); else if (e.code === 'KeyV' && !e.repeat) st.tpp = !st.tpp; return; } // tumbang: hanya merangkak, kamera & peta
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') st.sprint = true;
    if (drv()) { // di kendaraan
      if (e.code === 'Space') { e.preventDefault(); keys.hb = 1; return; }
      if (e.ctrlKey && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); if (!e.repeat) ctx.switchSeat(+e.code.slice(5) - 1); return; } // Ctrl+1..9 pindah kursi
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyF': case 'KeyE': ctx.exitVehicle(); break;
        case 'KeyH': ctx.horn(); break;
        case 'KeyV': st.vfp = !st.vfp; hud.flash(st.vfp ? 'Kamera kursi' : 'Kamera belakang'); break;
        case 'KeyM': ctx.toggleMap(); break;
        case 'KeyR': reload(); break;
        case 'Digit1': vSelect(0); break;
        case 'Digit2': vSelect(1); break;
        case 'Digit3': vSelect(2); break;
        case 'KeyX': select(-1); st.vDraw = false; break;
        default:
      }
      return;
    }
    if (e.repeat) return;
    if (st.lootUI) { // panel loot terbuka: F/Tab/Esc tutup, angka = ambil barang
      if (e.code === 'KeyF' || e.code === 'KeyE' || e.code === 'Tab' || e.code === 'Escape') { e.preventDefault(); closeLoot(true); return; }
      if (/^Digit[1-9]$/.test(e.code)) { lootTake(+e.code.slice(5) - 1); return; }
    } else if (e.code === 'Tab' && me.state === 'ground' && !st.swim) { e.preventDefault(); openLoot(null); return; } // inventaris + barang sekitar
    switch (e.code) {
      case 'Space': e.preventDefault(); jump(); break;
      case 'KeyC': case 'ControlLeft': if (st.swim) { keys.dn = 1; if (!st.dive) { st.dive = true; st.diveY = me.pos.y; audio.splash(0.25); } } else if (st.prone) setProne(false, true); else st.crouch = !st.crouch; break; // berenang: tahan C = menyelam turun
      case 'KeyZ': if (!st.swim) setProne(!st.prone); break;
      case 'KeyR': reload(); break;
      case 'KeyF': case 'KeyE': interact(); break;
      case 'Digit1': select(0); break;
      case 'Digit2': select(1); break;
      case 'Digit3': select(2); break;
      case 'KeyX': select(-1); break;
      case 'Digit4': heal('band'); break;
      case 'Digit5': heal('kit'); break;
      case 'KeyV': st.tpp = !st.tpp; hud.flash(st.tpp ? 'Orang ketiga' : 'Orang pertama'); break;
      case 'KeyI': if (!st.reloadEnd && !st.healEnd) vm.inspect(); break; // periksa senjata
      case 'KeyG': nadeStart(); break; // tahan = bidik (lintasan), lepas = lempar
      case 'KeyT': nadeCycle(); break; // ganti jenis granat
      case 'KeyM': ctx.toggleMap(); break;
      default:
    }
  });
  addEventListener('keyup', (e) => {
    const k = KM[e.code];
    if (k) keys[k] = 0;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') st.sprint = false;
    if (e.code === 'Space') { keys.hb = 0; keys.up = 0; }
    if (e.code === 'KeyC' || e.code === 'ControlLeft') keys.dn = 0;
    if (e.code === 'KeyF' || e.code === 'KeyE') st.revive = null; // lepas F: berhenti memulihkan rekan
    if (e.code === 'KeyG') nadeRelease();
  });
  addEventListener('blur', () => { keys.fwd = keys.back = keys.left = keys.right = keys.hb = 0; st.sprint = st.firing = st.ads = false; st.revive = null; });

  // ---------- Granat (G tahan → lintasan, lepas → lempar; makin lama ditahan makin jauh; T ganti jenis) ----------
  st.nadeSel = 'frag';
  function nadeStart() {
    if (me.state !== 'ground' || !me.alive || st.swim || st.healEnd || st.nade || st.vault) return;
    if (!(me.nades[st.nadeSel] > 0)) { const o = Object.keys(NADES).find((k) => me.nades[k] > 0); if (!o) { hud.toast('Tidak punya granat'); return; } st.nadeSel = o; }
    st.nade = { kind: st.nadeSel, t0: ctx.now() };
    st.reloadEnd = 0; st.ads = false; st.firing = false;
    vm.nadeHold(st.nadeSel);
  }
  function nadeCycle() {
    const ks = Object.keys(NADES);
    if (!ks.some((k) => me.nades[k] > 0)) { hud.toast('Tidak punya granat'); return; }
    const i = ks.indexOf(st.nadeSel);
    st.nadeSel = [...ks.slice(i + 1), ...ks.slice(0, i + 1)].find((k) => me.nades[k] > 0);
    hud.flash(NADES[st.nadeSel].name + ' ×' + me.nades[st.nadeSel]);
    audio.click();
  }
  const nO = new THREE.Vector3(), nV = new THREE.Vector3(), nR = new THREE.Vector3(), nT = new THREE.Vector3();
  function nadeThrowVec(now) { // titik lepas (tangan kanan / depan kamera) & kecepatan dari arah bidik, 11–21 m/dtk
    camera.getWorldDirection(nV);
    nR.set(-nV.z, 0, nV.x).normalize();
    if (st.tpp) nO.set(me.pos.x, me.pos.y + 1.7, me.pos.z).addScaledVector(nR, 0.3).addScaledVector(nT.set(nV.x, 0, nV.z).normalize(), 0.3);
    else nO.copy(camera.position).addScaledVector(nV, 0.45).addScaledVector(nR, 0.18).add(nT.set(0, -0.12, 0));
    const hold = Math.min(1, (now - st.nade.t0) / 0.9), sp = 11 + 10 * hold;
    nV.y += 0.22; nV.normalize().multiplyScalar(sp);
    return [nO, nV];
  }
  function nadeRelease() {
    if (!st.nade) return;
    const N = st.nade, now = ctx.now();
    if (ctx.nadeAim) ctx.nadeAim(null);
    if (me.state !== 'ground' || !me.alive || !(me.nades[N.kind] > 0)) { st.nade = null; vm.nadeCancel(); return; }
    const [o, v] = nadeThrowVec(now);
    st.nade = null;
    me.nades[N.kind]--;
    ctx.throwNade(me, N.kind, o.clone(), v.clone());
    vm.nadeThrow();
    me.pose.fire = 1;
    st.switchEnd = Math.max(st.switchEnd, now + 0.5);
  }
  function nadeAbort() { if (st.nade) { st.nade = null; if (ctx.nadeAim) ctx.nadeAim(null); vm.nadeCancel(); } }

  // ---------- Senjata ----------
  function weapon() { const w = me.cur >= 0 ? me.weapons[me.cur] : null; return w ? { inst: w, def: WEAPONS[w.kind] } : null; }
  function select(i, quiet) {
    if (st.swim && !quiet) return; // senjata disimpan selama berenang
    if (i >= 0 && !me.weapons[i]) return;
    if (i === me.cur) return;
    me.cur = i;
    st.reloadEnd = 0;
    st.switchEnd = ctx.now() + 0.45;
    me.pose.swap = 1;
    vm.show(i >= 0 ? me.weapons[i].kind : null);
    if (!quiet) audio.click();
  }
  function cycle(d) {
    const order = [0, 1, 2].filter((i) => me.weapons[i]);
    if (!order.length) return;
    const at = order.indexOf(me.cur);
    select(order[(at + d + order.length) % order.length]);
  }
  function reload() {
    const w = weapon(), now = ctx.now();
    if (!w || st.reloadEnd || st.nade || w.inst.mag >= w.def.mag || me.ammo[w.def.ammo] <= 0) return;
    st.reloadEnd = now + w.def.reload;
    st.reloadFor = w.inst;
    vm.reload(w.def.reload, w.def.mag - w.inst.mag); // animasi isi ulang (shotgun: jumlah selongsong)
    audio.reload(w.def.reload);
    st.healEnd = 0;
  }
  function heal(kind) {
    if (me.state !== 'ground' || st.swim || !me.heals[kind] || st.healEnd || st.nade) return;
    if (kind === 'band' && me.hp >= 75) { hud.toast('Perban hanya sampai 75 HP'); return; }
    if (me.hp >= 100) return;
    st.healKind = kind;
    st.healEnd = ctx.now() + (kind === 'kit' ? 6 : 3.5);
    st.reloadEnd = 0;
    vm.heal(kind, kind === 'kit' ? 6 : 3.5); // animasi membalut perban / menyuntik P3K
  }
  // ---------- Senjata di kendaraan ----------
  function driverGun() { // slot SMG (diutamakan) atau pistol, −1 kalau tidak punya
    let p = -1;
    for (let i = 0; i < 3; i++) { const w = me.weapons[i]; if (!w) continue; if (w.kind === 'smg' || w.kind === 'pdw') return i; if ((w.kind === 'pistol' || w.kind === 'revolver') && p < 0) p = i; }
    return p;
  }
  function vArmedNow() { // senjata siap ditembakkan dari kursi ini?
    const w = weapon();
    if (!drv() || !w) return false;
    return isDriver() ? !!DRIVER_GUNS[w.inst.kind] && st.vDraw : true;
  }
  function vehDraw() { // klik di kendaraan → cabut senjata yang boleh (sopir: ganti otomatis ke SMG/pistol kalau ada)
    const w = weapon();
    if (isDriver()) {
      if (!w || !DRIVER_GUNS[w.inst.kind]) {
        const i = driverGun();
        if (i < 0) { hud.toast('Sopir hanya bisa menembak pistol/SMG'); return false; }
        select(i);
      }
    } else if (!w) {
      const i = [0, 1, 2].find((j) => me.weapons[j]);
      if (i === undefined) { hud.toast('Belum punya senjata'); return false; }
      select(i);
    }
    st.vDraw = true;
    st.vIdle = ctx.now();
    return true;
  }
  function vSelect(i) { // 1/2/3 di kendaraan
    if (!me.weapons[i]) return;
    select(i);
    const ok = !isDriver() || DRIVER_GUNS[me.weapons[i].kind];
    st.vDraw = !!ok;
    st.vIdle = ctx.now();
    if (!ok) { st.ads = false; st.firing = false; hud.toast('Sopir hanya bisa menembak pistol/SMG'); }
  }
  // asal & arah peluru dari kendaraan. Orang pertama: dari mata (kamera sudah di kursi). Kamera belakang: dari tangan
  // penembak menuju titik di bawah bidikan tengah layar (sinar kamera dulu → paralaks benar).
  function vehShot(o, d) {
    camera.getWorldDirection(fwd);
    if (st.vfp) { o.copy(camera.position); d.copy(fwd); return; }
    ctx.vehicles.eyeWorld(me.vehicle, o, me.seat);
    const h = Math.hypot(fwd.x, fwd.z) || 1;
    o.x += fwd.x / h * 0.42; o.z += fwd.z / h * 0.42; o.y -= 0.16;
    const s = Math.max(0, tmp2.copy(o).sub(camera.position).dot(fwd)); // mulai dari kedalaman penembak: abaikan yang di antara kamera & kendaraan
    tmp2.copy(camera.position).addScaledVector(fwd, s);
    const w = weapon(), t = combat.probe(me, tmp2, fwd, w ? w.def.maxRange : 500);
    tmp2.addScaledVector(fwd, Math.max(3, t));
    d.copy(tmp2).sub(o).normalize();
  }
  function fire(now) {
    const w = weapon();
    if (!w || st.swim || st.reloadEnd || st.healEnd || now < st.switchEnd || now < st.nextShot || now < st.stanceT) return;
    const inVeh = !!drv();
    if (inVeh && (!st.vArmed || st.vBlock)) { st.trigger = false; return; } // di luar busur tembak kursi ini
    if (w.def.burst) { // semburan: satu tarikan pelatuk = N butir beruntun, lalu jeda
      if (!(st.burstLeft > 0)) { if (!st.trigger) return; st.burstLeft = w.def.burst; }
    } else if (!w.def.auto && !st.trigger) return;
    st.trigger = false;
    if (w.inst.mag <= 0) { st.burstLeft = 0; audio.click(); st.nextShot = now + 0.3; reload(); return; }
    w.inst.mag--;
    st.nextShot = now + 60 / w.def.rpm;
    if (w.def.burst && --st.burstLeft <= 0) st.nextShot = now + w.def.burstDelay;
    const moving = me.moveSpeed > 1;
    const spread = (st.ads ? w.def.ads * (moving ? 1.8 : 1) : w.def.spread * (moving ? w.def.move : 1) * (st.crouch ? 0.8 : 1)) * (st.prone ? 0.55 : 1);
    camera.getWorldDirection(fwd);
    // pelacak keluar dari moncong senjata (perkiraan ruang kamera → dunia)
    vm.muzzleWorld(muz);
    muz.applyQuaternion(camera.quaternion).add(camera.position);
    if (inVeh) {
      vehShot(org, dirV);
      combat.fire(me, org, dirV, w, st.vSpread, st.vfp ? muz : tip.copy(org).addScaledVector(dirV, 0.4));
    } else combat.fire(me, camera.position, fwd, w, spread * (me.state === 'ground' && me.grounded ? 1 : 2.5), st.tpp ? null : muz);
    vm.fire();
    me.pose.fire = 1;
    const rc = w.def.recoil * (st.ads ? 0.65 : 1) * (st.crouch ? 0.8 : 1) * (st.prone ? 0.5 : 1);
    st.recoilP += rc * D2R;
    st.recoilY += (Math.random() - 0.5) * rc * 0.5 * D2R;
    me.lastShot = now;
  }
  // ---------- Ambil barang ----------
  function nearestItem() {
    const x = me.pos.x, y = -me.pos.z;
    camera.getWorldDirection(fwd);
    let best = null, bs = Infinity;
    loot.near(x, y, 2.6, (it) => {
      if (Math.abs((it.z || 0) - me.pos.y) > 1.3) return; // barang di lantai lain
      const dx = it.x - x, dy = it.y - y, d = Math.hypot(dx, dy);
      const facing = d > 0.3 ? (dx * fwd.x - dy * fwd.z) / (d * Math.hypot(fwd.x, fwd.z) || 1) : 1;
      const score = d - facing * 1.2;
      if (score < bs) { bs = score; best = it; }
    });
    return best;
  }
  function interact() {
    if (st.swim) return;
    if (me.state === 'plane') { ctx.jumpOut(); return; }
    if (me.state === 'fall' && me.pos.y < 700) { me.state = 'chute'; return; }
    if (me.state !== 'ground' || me.down) return;
    const rt = ctx.reviveTarget ? ctx.reviveTarget() : null; // rekan tumbang di dekat sini: tahan F untuk memulihkan
    if (rt && !st.lootUI) { st.revive = rt; Object.assign(st, { ads: false, firing: false, sprint: false, reloadEnd: 0, healEnd: 0 }); nadeAbort(); return; }
    const it = nearestItem(), v = nearVehicle();
    if (st.lootUI) { closeLoot(true); return; }
    if (v && (!it || Math.hypot(it.x - me.pos.x, it.y + me.pos.z) > 1.3)) { ctx.enterVehicle(v); return; }
    if (!v && !it && ctx.vehicles && ctx.vehicles.fullNear(me)) { hud.toast('Kendaraan penuh'); return; }
    if (!it) { startVault(); return; } // F juga untuk melompati jendela
    if (it.def.kind === 'crate') { openLoot(it); return; } // buka peti: panel inventaris (kiri) + isi peti (kanan)
    take(it);
  }
  // ---------- Panel loot (seperti PUBG): kiri inventaris, kanan isi peti / barang di sekitar, bergambar ----------
  const ENTRY_TYPE = { weapon: (k) => 'w_' + k, ammo: (k) => 'a_' + k, heal: (k) => 'h_' + k, vest: (k) => 'v' + k, helmet: (k) => 'm' + k, nade: (k) => 'g_' + k };
  function vicinity() { const L = []; loot.near(me.pos.x, -me.pos.z, 2.6, (it) => { if (it.def.kind !== 'crate' && Math.abs((it.z || 0) - me.pos.y) < 1.3) L.push(it); }); return L.slice(0, 12); }
  function itemName(it) { return it.def.name || (it.def.w && WEAPONS[it.def.w].name) || it.type; }
  function lootModel() {
    const guns = [0, 1, 2].map((s) => { const w = me.weapons[s]; return w ? { slot: s, type: 'w_' + w.kind, name: WEAPONS[w.kind].name, mag: w.mag, cap: WEAPONS[w.kind].mag, ammo: me.ammo[WEAPONS[w.kind].ammo] || 0 } : { slot: s }; });
    const items = [];
    for (const [k, n] of Object.entries(me.ammo)) if (n > 0) items.push({ type: 'a_' + k, n, name: (ITEMS['a_' + k] ? ITEMS['a_' + k].name : k).replace(/ ×\d+$/, '') });
    for (const k of ['band', 'kit']) if (me.heals[k] > 0) items.push({ type: 'h_' + k, n: me.heals[k], name: k === 'kit' ? 'P3K' : 'Perban' });
    for (const [k, n] of Object.entries(me.nades || {})) if (n > 0) items.push({ type: 'g_' + k, n, name: NADES[k] ? NADES[k].name : k });
    const gear = [{ type: me.vest ? 'v' + me.vest : null, name: me.vest ? 'Rompi lv.' + me.vest : 'Tanpa rompi' }, { type: me.helmet ? 'm' + me.helmet : null, name: me.helmet ? 'Helm lv.' + me.helmet : 'Tanpa helm' }];
    const loot2 = st.crate ? crateEntries(st.crate.contents).map((e) => { const type = ENTRY_TYPE[e.t] ? ENTRY_TYPE[e.t](e.k) : 'crate'; return { type, name: e.text, rar: (ITEMS[type] || {}).rar || 0 }; })
      : vicinity().map((it) => ({ type: it.type, name: itemName(it), rar: it.def.rar || 0 }));
    return { title: st.crate ? 'Peti jarahan' : 'Di sekitar', guns, items, gear, loot: loot2 };
  }
  const lootH = { icon: itemIcon, take: (i) => lootTake(i), takeAll: () => lootTakeAll(), close: () => closeLoot(true) };
  function openLoot(crate) {
    st.crate = crate || null;
    st.lootUI = true;
    st.firing = false; st.ads = false;
    if (locked()) document.exitPointerLock();
    audio.pickup();
    hud.lootPanel(lootModel(), lootH);
  }
  function closeLoot(relock) {
    st.lootUI = false;
    st.crate = null;
    hud.lootPanel(null);
    if (relock && ctx.playing()) ctx.lock();
  }
  function lootTake(i) {
    if (st.crate) return crateTake(i);
    const it = vicinity()[i];
    if (!it) return false;
    const before = it.alive;
    take(it);
    return before && !it.alive;
  }
  function lootTakeAll() { // hanya dari sumber yang sedang dibuka (peti ini, atau barang di sekitar)
    const src = st.crate;
    for (let guard = 0; guard < 30 && st.lootUI && st.crate === src; guard++) {
      const n = st.crate ? crateEntries(st.crate.contents).length : vicinity().length;
      let took = false;
      for (let i = 0; i < n && !took; i++) took = lootTake(i);
      if (!took) break;
    }
  }
  function crateTake(i) {
    const it = st.crate, e = it && crateEntries(it.contents)[i];
    if (!e) return false;
    const r = takeCrateEntry(me, it.contents, e, { replaceSlot: me.cur === 0 || me.cur === 1 ? me.cur : 0 });
    if (!r) { hud.toast(e.t === 'weapon' ? 'Slot senjata penuh' : e.t === 'vest' || e.t === 'helmet' ? 'Sudah punya yang setara atau lebih baik' : 'Tas penuh untuk barang ini'); return false; }
    if (r.dropped) { const up = me.pos.y > 0.5; loot.add('w_' + r.dropped.kind, me.pos.x + (up ? 0 : 0.6), -me.pos.z + (up ? 0 : 0.4), { z: up ? me.pos.y : 0 }); }
    audio.pickup();
    me.looted = (me.looted || 0) + 1;
    hud.toast('Diambil: ' + r.text);
    if (r.slot !== undefined && (me.cur < 0 || me.cur === r.slot || !me.weapons[me.cur])) { me.cur = -2; select(r.slot, true); }
    if (crateEmpty(it.contents)) { loot.remove(it); st.crate = null; }
    return true;
  }
  function nearVehicle() { return ctx.vehicles ? ctx.vehicles.nearestFor(me) : null; }
  function take(it, auto) {
    const replaceSlot = me.cur === 0 || me.cur === 1 ? me.cur : 0;
    const r = applyItem(me, it, { replaceSlot });
    if (!r) { if (!auto) hud.toast(it.def.kind === 'heal' ? 'Tas penuh untuk barang ini' : 'Sudah punya yang setara atau lebih baik'); return; }
    if (!r.keep) loot.remove(it);
    if (r.dropped) { const up = me.pos.y > 0.5; loot.add('w_' + r.dropped.kind, me.pos.x + (up ? 0 : 0.6), -me.pos.z + (up ? 0 : 0.4), { z: up ? me.pos.y : 0 }); }
    audio.pickup();
    me.looted = (me.looted || 0) + 1; // statistik pertandingan (misi)
    hud.toast('Diambil: ' + r.text);
    if (r.slot !== undefined && (me.cur < 0 || me.cur === r.slot || !me.weapons[me.cur])) { me.cur = -2; select(r.slot, true); }
  }
  function setProne(on, toCrouch) { // tiarap ↔ berdiri/jongkok; transisi 0,6 dtk (tidak bisa menembak/bergerak cepat)
    if (me.state !== 'ground' || !me.grounded || on === st.prone) return;
    st.prone = on;
    st.crouch = !on && !!toCrouch;
    st.stanceT = ctx.now() + 0.6;
    st.sprint = false;
    audio.step(0.12);
  }
  function jump() {
    if (me.state !== 'ground') return;
    if (st.swim) { keys.up = 1; return; } // berenang: tahan Spasi = naik ke permukaan
    if (st.prone) { setProne(false, true); return; }
    if (st.crouch) { st.crouch = false; return; }
    if (me.grounded && startVault()) return;
    if (me.grounded) { me.vy = 5.2; me.grounded = false; }
  }
  // lompat lewat jendela / melewati perabot rendah (seperti PUBG): setinggi lutut terhalang, setinggi dada tembus
  const vaultOut = { b: -2 };
  function vaultSpot() {
    if (me.state !== 'ground' || !me.grounded || st.swim || st.prone || st.vault) return null;
    const fx = Math.sin(st.yaw), fy = -Math.cos(st.yaw), x = me.pos.x, y = -me.pos.z, h = me.pos.y;
    const low = col.ray(x, y, h + 0.45, fx, fy, 0, 1.3, vaultOut);
    if (low >= 1.3 || col.ray(x, y, h + 1.55, fx, fy, 0, low + 1.6, vaultOut) < low + 1.2) return null;
    const d = low + 0.8, lx = x + fx * d, ly = y + fy * d;
    return col.blocked(lx, ly, RAD, h) ? null : [lx, ly];
  }
  function startVault() {
    const v = vaultSpot();
    if (!v) return false;
    st.vault = { t: 0, x0: me.pos.x, y0: -me.pos.z, x1: v[0], y1: v[1], h0: me.pos.y };
    Object.assign(st, { ads: false, sprint: false, crouch: false });
    audio.step(0.16);
    return true;
  }

  // ---------- Kamera ----------
  function aimDir(out) { return out.set(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch)); }
  function placeCamera(dt) {
    const p = me.pos;
    camera.rotation.order = 'YXZ';
    const pitch = st.pitch + st.recoilP, yaw = st.yaw + st.recoilY;
    if (me.state === 'plane' && st.plane) {
      aimDir(fwd);
      camera.position.copy(st.plane).addScaledVector(fwd, -48).add(tmp.set(0, 8, 0));
      camera.lookAt(st.plane);
      return;
    }
    if (!me.alive && st.spec && st.spec.alive) { specCamera(dt); return; }
    if (drv()) { driveCamera(dt); return; }
    if (me.state === 'fall' || me.state === 'chute' || me.state === 'dead' || st.tpp) {
      aimDir(fwd);
      const hor = me.state === 'ground';
      const dist = me.state === 'dead' ? 5 : hor ? 2.6 : 6.5;
      right.set(-Math.cos(st.yaw), 0, Math.sin(st.yaw));
      const pivot = tmp.set(p.x, p.y + (me.state === 'dead' ? 0.6 : st.prone && hor ? 0.75 : 1.6), p.z);
      let d = dist;
      { // jangan menembus dinding (sinar tepat, aman untuk dinding tipis rumah)
        tmp2.copy(fwd).multiplyScalar(-dist).addScaledVector(right, hor ? 0.6 : 0);
        const len = tmp2.length(), t = col.ray(pivot.x, -pivot.z, pivot.y, tmp2.x / len, -tmp2.z / len, tmp2.y / len, len);
        if (t < len) d = Math.max(0.45, (t - 0.3) * dist / len);
      }
      st.camD = st.camD ? st.camD + (d - st.camD) * (1 - Math.exp(-dt * (d < st.camD ? 30 : 5))) : d;
      camera.position.copy(pivot).addScaledVector(fwd, -st.camD).addScaledVector(right, hor ? 0.6 * st.camD / dist : 0);
      if (st.swim && !st.dive && camera.position.y < 0.5) camera.position.y = 0.5; // berenang: kamera tetap di atas permukaan air
      if (st.swim && st.dive) { const bed = -col.waterDepth(camera.position.x, -camera.position.z); if (camera.position.y < bed + 0.35) camera.position.y = bed + 0.35; } // menyelam: kamera tidak menembus dasar
      camera.rotation.set(pitch, yaw + Math.PI, 0);
      return;
    }
    const bob = me.grounded ? Math.sin(char.rig.phase * 2) * 0.03 * Math.min(1, me.moveSpeed / 6) * (st.ads ? 0.3 : 1) : 0;
    st.eye = (st.eye ?? EYE) + ((st.prone ? EYE_PRONE : st.crouch ? EYE_CROUCH : EYE) - (st.eye ?? EYE)) * (1 - Math.exp(-dt * (st.prone ? 6 : 12)));
    camera.position.set(p.x, p.y + st.eye + bob, p.z);
    camera.rotation.set(pitch, yaw + Math.PI, 0);
    if (st.shake > 0) { camera.rotation.x += (Math.random() - 0.5) * st.shake * 0.05; camera.rotation.y += (Math.random() - 0.5) * st.shake * 0.05; st.shake = Math.max(0, st.shake - dt * 2.5); }
  }

  // Menonton rekan (pemain sudah tersingkir): kamera orang ketiga mengitari rekan, mouse = lihat sekeliling
  function specCamera(dt) {
    const t = st.spec, p = t.pos, inVeh = t.state === 'drive', dist = inVeh ? 7.5 : t.state === 'ground' ? 3.6 : 7;
    aimDir(fwd);
    const pivot = tmp.set(p.x, inVeh ? (t.sitY || 0) + 1.6 : p.y + (t.down || t.prone ? 0.8 : 1.65), p.z);
    let d = dist;
    const tw = col.ray(pivot.x, -pivot.z, pivot.y, -fwd.x, fwd.z, -fwd.y, dist);
    if (tw < dist) d = Math.max(0.6, tw - 0.3);
    st.camD = st.camD ? st.camD + (d - st.camD) * (1 - Math.exp(-dt * (d < st.camD ? 30 : 5))) : d;
    camera.position.copy(pivot).addScaledVector(fwd, -st.camD);
    if (camera.position.y < 0.4) camera.position.y = 0.4;
    camera.rotation.set(st.pitch, st.yaw + Math.PI, 0);
  }

  // Kamera kendaraan: kejar dari belakang (mouse = lihat sekeliling, kembali ke belakang sendiri saat mouse diam)
  // atau kursi pengemudi (V).
  function driveCamera(dt) {
    const v = me.vehicle, T = v.def, now = ctx.now(), idle = now - st.lookT > (st.vfp ? 0.6 : 1.1);
    const fighting = st.vArmed && (st.ads || st.firing || now - me.lastShot < 2.5); // sedang menembak: kamera tidak kembali ke belakang
    if (idle && !fighting && Math.abs(v.speed) > 2.5) { // ikuti arah laju (mundur → tetap menghadap depan kendaraan)
      st.yaw += wrap(v.yaw - st.yaw) * (1 - Math.exp(-dt * (st.vfp ? 5 : 2.6)));
      st.pitch += ((st.vfp ? -0.05 : -0.2) - st.pitch) * (1 - Math.exp(-dt * 2));
    }
    if (st.vfp) { const lim = isDriver() ? 1.9 : ARC_PASS; const rel = clamp(wrap(st.yaw - v.yaw), -lim, lim); st.yaw = v.yaw + rel; }
    const sh = st.shake > 0 ? st.shake : 0;
    st.shake = Math.max(0, st.shake - dt * 2.5);
    st.vLean += ((st.vArmed && st.ads ? 1 : 0) - st.vLean) * (1 - Math.exp(-dt * 8));
    camera.rotation.order = 'YXZ';
    if (st.vfp) {
      ctx.vehicles.eyeWorld(v, camera.position, me.seat);
      if (st.vLean > 0.01) { camera.position.x += Math.sin(st.yaw) * 0.16 * st.vLean; camera.position.z += Math.cos(st.yaw) * 0.16 * st.vLean; } // condong ke jendela saat membidik
      camera.rotation.set(st.pitch + st.recoilP + (Math.random() - 0.5) * sh * 0.05, st.yaw + Math.PI + (Math.random() - 0.5) * sh * 0.05, T.kind === 'bike' ? -v.leanA * 0.55 : -v.roll);
      return;
    }
    aimDir(fwd);
    const dist = T.camDist * st.vzoom * (1 + Math.min(0.25, Math.abs(v.speed) / 120)), up = T.kind === 'bus' ? 3.2 : T.kind === 'bike' ? 1.55 : 1.75;
    const pivot = tmp.set(v.x, up, -v.y);
    let d = dist;
    for (let s = 1; s < dist; s += 0.45) { // jangan menembus gedung
      tmp2.copy(pivot).addScaledVector(fwd, -s);
      if (tmp2.y < 0.4 || col.solidAt(tmp2.x, -tmp2.z, tmp2.y)) { d = Math.max(1.2, s - 0.5); break; }
    }
    st.camD = st.camD ? st.camD + (d - st.camD) * (1 - Math.exp(-dt * (d < st.camD ? 25 : 4))) : d;
    camera.position.copy(pivot).addScaledVector(fwd, -st.camD);
    camera.position.y = Math.max(0.5, camera.position.y);
    camera.rotation.set(st.pitch + st.recoilP + (Math.random() - 0.5) * sh * 0.04, st.yaw + st.recoilY + Math.PI + (Math.random() - 0.5) * sh * 0.04, 0);
  }

  // ---------- Gerak ----------
  function ground(dt, now) {
    if (st.vault) { // sedang melompati jendela: lintasan melengkung 0,5 dtk, lalu jatuh/mendarat seperti biasa
      const V = st.vault, k = Math.min(1, (V.t += dt / 0.5)), e = k * k * (3 - 2 * k);
      me.pos.set(V.x0 + (V.x1 - V.x0) * e, V.h0 + Math.sin(Math.PI * k) * 0.95, -(V.y0 + (V.y1 - V.y0) * e));
      me.vel.set(0, 0);
      me.moveSpeed = 0;
      st.prompt = null;
      if (k >= 1) { st.vault = null; me.grounded = false; me.vy = 0; st.floorY = V.h0; }
      return;
    }
    const w = weapon();
    // air: dangkal (< 1,2 m) = mengarungi (kaki di dasar, jalan pelan, senjata tetap bisa dipakai); lebih dalam = berenang
    // (senjata disimpan). Menyelam: tahan C turun ±1,5 m/dtk sampai dekat dasar, lepas = bertahan (naik pelan),
    // tahan Spasi naik. Napas berkurang selama kepala di bawah air.
    const wdep = col.waterDepth(me.pos.x, -me.pos.z), wet = wdep >= WADE_D;
    st.wade = wdep > 0 && !wet;
    if (wet !== st.swim) {
      st.swim = wet;
      if (wet) { Object.assign(st, { prone: false, crouch: false, ads: false, firing: false, reloadEnd: 0, healEnd: 0, sprint: false, dive: false }); vm.show(null); audio.splash(0.6); hud.toast('Berenang · tahan C menyelam · tahan Spasi naik'); }
      else { st.dive = false; me.pos.y = -wdep; me.vy = 0; me.grounded = true; vm.show(w ? w.inst.kind : null); st.switchEnd = now + 0.6; }
    }
    const eyeUnder = st.swim && me.pos.y + EYE < WATER_S - 0.05;
    st.breath = eyeUnder ? Math.max(0, st.breath - dt / BREATH) : Math.min(1, st.breath + dt / 4);
    if (st.swim) {
      if (st.breath <= 0) combat.damage(me, 9 * dt, 'drown', null, null);
      const minY = -wdep - 1.0; // mata tetap ±0,6 m di atas dasar
      if (st.dive) {
        st.diveY = st.diveY ?? me.pos.y;
        st.diveY += (keys.up ? 2.0 : keys.dn ? -1.5 : 0.12) * dt;
        st.diveY = Math.max(minY, Math.min(SWIM_Y, st.diveY));
        if (st.diveY >= SWIM_Y - 0.02 && !keys.dn) st.dive = false; // sampai permukaan
      }
      const ty = st.dive ? st.diveY : SWIM_Y;
      me.pos.y += (ty - me.pos.y) * (1 - Math.exp(-dt * 4));
      if (me.pos.y < minY) me.pos.y = minY;
      me.grounded = true; me.vy = 0;
      st.ads = false; st.firing = false;
    } else st.diveY = null;
    me.swim = st.swim; me.dive = st.swim && me.pos.y + EYE < -0.9; // > ±1 m di bawah permukaan: bot tidak melihat
    let ix = keys.right - keys.left, iz = keys.fwd - keys.back;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    // tumbang: hanya merangkak pelan (diam selama dipulihkan); memulihkan rekan: diam di tempat sambil menahan F
    if (me.down) { Object.assign(st, { prone: true, crouch: false, ads: false, firing: false, sprint: false, reloadEnd: 0, healEnd: 0, revive: null }); if (st.nade) nadeAbort(); }
    if (st.revive) { const t = ctx.reviveTarget(); if (t !== st.revive || st.swim || me.down || st.vault) st.revive = null; }
    if (ctx.reviveHold && (st.revive || me.reviving)) ctx.reviveHold(st.revive, !!st.revive);
    if (!!st.revive !== !!st.revOn && !me.down) { st.revOn = !!st.revive; vm.show(st.revOn || !w ? null : w.inst.kind); if (!st.revOn) st.switchEnd = now + 0.45; } // memulihkan: senjata diturunkan
    const healing = !!st.healEnd, sprint = st.sprint && iz > 0 && !st.ads && !healing && !st.crouch && !st.prone;
    if (sprint && st.firing) st.sprint = false;
    const spK = st.revive ? 0 : me.down ? (me.reviver && me.reviver.reviving === me ? 0 : 0.8) : 1; // pengali kecepatan (tumbang merangkak 0,9 m/dtk)
    const sp = spK * (st.swim ? (st.dive ? SPEED.dive : st.sprint && iz > 0 ? SPEED.swimFast : SPEED.swim) : st.prone ? (now < st.stanceT ? 0 : SPEED.prone * (healing ? 0 : 1)) : (sprint ? SPEED.sprint : st.crouch ? SPEED.crouch : st.ads || healing ? SPEED.ads : SPEED.walk)) * (st.wade ? 0.6 : 1); // mengarungi: pelan
    fwd.set(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    right.set(-Math.cos(st.yaw), 0, Math.sin(st.yaw));
    const tx = (fwd.x * iz + right.x * ix) * sp, tz = (fwd.z * iz + right.z * ix) * sp;
    const k = 1 - Math.exp(-dt * (me.grounded ? 12 : 2));
    me.vel.x += (tx - me.vel.x) * k;
    me.vel.y += (tz - me.vel.y) * k;
    const x0 = me.pos.x, y0 = -me.pos.z;
    const ay = me.grounded ? me.pos.y : st.floorY || 0; // tinggi kaki untuk tabrakan (lantai 2 / tangga)
    let r = col.step(x0, y0, x0 + me.vel.x * dt, y0 - me.vel.y * dt, RAD, true, ay); // pemain boleh masuk air (berenang)
    if (ctx.vehicles) { const q = ctx.vehicles.pushOut(r.x, r.y, RAD); if (q.x !== r.x || q.y !== r.y) r = col.resolve(q.x, q.y, RAD, false, ay); } // tidak menembus kendaraan
    me.moveSpeed = Math.hypot(r.x - x0, r.y - y0) / Math.max(dt, 1e-4);
    me.moveYaw = me.moveSpeed > 0.3 ? wrap(Math.atan2(r.x - x0, -(r.y - y0)) - st.yaw) : 0;
    me.pos.x = r.x;
    me.pos.z = -r.y;
    // permukaan di bawah kaki: tanah, tangga, atau pelat lantai 2 (naik/turun tangga mengikuti permukaan, jatuh dari tepi)
    const wd2 = st.swim ? 0 : col.waterDepth(r.x, r.y);
    const fl = st.swim ? me.pos.y : wd2 > 0 ? -wd2 : col.floorAt(r.x, r.y, me.pos.y); // mengarungi: kaki di dasar air
    if (me.grounded && !st.swim) { if (fl >= me.pos.y - 0.45) me.pos.y = fl; else { me.grounded = false; me.vy = 0; } }
    if (!me.grounded) {
      me.vy -= GRAV * dt;
      me.pos.y += me.vy * dt;
      if (me.pos.y <= fl) { me.pos.y = fl; me.vy = 0; me.grounded = true; audio.step(0.12); }
    }
    if (me.grounded) st.floorY = me.pos.y;
    me.yaw = st.yaw;
    me.crouch = st.crouch;
    me.prone = st.prone;
    st.sprinting = sprint && me.moveSpeed > 4;
    // langkah kaki
    st.stepT -= dt * me.moveSpeed;
    if (me.grounded && st.stepT <= 0 && me.moveSpeed > 1) { st.stepT = st.swim ? 2.6 : st.crouch ? 1.6 : 1.9; if (st.swim) { if (!st.dive) audio.splash(0.12); } else if (st.wade) audio.splash(0.07); else audio.step(st.crouch ? 0.03 : 0.07); }
    // isi ulang / obat
    if (st.reloadEnd && now >= st.reloadEnd) {
      const wi = st.reloadFor, def = wi && WEAPONS[wi.kind];
      if (def && wi === (w && w.inst)) { const got = Math.min(def.mag - wi.mag, me.ammo[def.ammo]); wi.mag += got; me.ammo[def.ammo] -= got; }
      st.reloadEnd = 0;
    }
    if (st.healEnd && now >= st.healEnd) {
      me.heals[st.healKind]--;
      me.hp = st.healKind === 'kit' ? 100 : Math.min(75, me.hp + 15);
      st.healEnd = 0;
      audio.heal();
    }
    if ((st.firing || st.burstLeft > 0) && !st.sprinting && !st.nade && !me.down && !st.revive) fire(now);
    if (st.nade) { if (st.swim) nadeAbort(); else if (ctx.nadeAim) { const [o, v] = nadeThrowVec(now); ctx.nadeAim(o, v); } } // pratinjau lintasan granat
    // barang terdekat untuk prompt
    if (st.swim || me.down) { st.prompt = null; if (me.down && st.lootUI) closeLoot(false); return; }
    { const rt = ctx.reviveTarget ? ctx.reviveTarget() : null; if (rt) { st.prompt = st.revive ? null : 'Tahan F · pulihkan ' + rt.name; if (st.lootUI) hud.lootPanel(lootModel(), lootH); return; } }
    const it = nearestItem(), nv = nearVehicle();
    const cr = st.crate; // peti terbuka: tutup bila menjauh / habis
    if (cr && (!cr.alive || Math.hypot(cr.x - me.pos.x, cr.y + me.pos.z) > 2.8 || Math.abs(cr.z - me.pos.y) > 1.3)) { st.crate = null; if (st.lootUI) closeLoot(false); }
    if (st.lootUI) hud.lootPanel(lootModel(), lootH);
    st.prompt = st.lootUI ? null : it && (!nv || Math.hypot(it.x - me.pos.x, it.y + me.pos.z) <= 1.3) ? (it.def.kind === 'crate' ? 'Buka peti jarahan' : 'Ambil ' + it.def.name) : nv ? 'Naik ' + nv.def.name : !it && ctx.vehicles && ctx.vehicles.fullNear(me) ? 'Kendaraan penuh' : vaultSpot() ? 'Lompati (atau Spasi)' : null;
  }
  function air(dt) {
    let ix = keys.right - keys.left, iz = keys.fwd - keys.back;
    const chuteOn = me.state === 'chute';
    if (!chuteOn && me.pos.y < 120) { me.state = 'chute'; audio.click(); }
    const hs = chuteOn ? (iz > 0 ? 13 : 6) : (iz > 0 ? 28 : 14), dive = !chuteOn && iz > 0 ? clamp(-st.pitch, 0, 1) : 0;
    const vs = chuteOn ? (iz > 0 ? 11 : 9) : 46 + dive * 24;
    fwd.set(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    right.set(-Math.cos(st.yaw), 0, Math.sin(st.yaw));
    const tx = (fwd.x * Math.max(0.35, iz) + right.x * ix * 0.6) * hs, tz = (fwd.z * Math.max(0.35, iz) + right.z * ix * 0.6) * hs;
    const k = 1 - Math.exp(-dt * 1.8);
    me.vel.x += (tx - me.vel.x) * k;
    me.vel.y += (tz - me.vel.y) * k;
    if (!ctx.inArea(me.pos.x, -me.pos.z)) { // di luar kawasan: dorong kembali ke tengah
      const c = ctx.areaCenter, dx = c.x - me.pos.x, dz = -c.y - me.pos.z, d = Math.hypot(dx, dz) || 1;
      me.vel.x = dx / d * hs;
      me.vel.y = dz / d * hs;
    }
    const nx = me.pos.x + me.vel.x * dt, nz = me.pos.z + me.vel.y * dt;
    if (ctx.inArea(nx, -nz) || !ctx.inArea(me.pos.x, -me.pos.z)) { me.pos.x = nx; me.pos.z = nz; }
    me.pos.y -= vs * dt;
    me.yaw = Math.atan2(me.vel.x, me.vel.y) || st.yaw;
    audio.windLevel(chuteOn ? 0.25 : 0.9);
    if (me.pos.y <= 0 || (me.pos.y < 40 && col.solidAt(me.pos.x, -me.pos.z, me.pos.y))) {
      const f = col.arrival(me.pos.x, -me.pos.z) || [me.pos.x, -me.pos.z];
      me.pos.set(f[0], 0, -f[1]);
      me.vel.set(0, 0);
      me.state = 'ground';
      me.grounded = true;
      audio.windLevel(0);
      audio.step(0.2);
      ctx.landed(f[0], f[1]);
    }
  }

  // ---------- Di kursi kendaraan: isi ulang, siaga senjata, busur tembak, menembak ----------
  function seated(dt, now) {
    const v = me.vehicle, w = weapon(), driver = isDriver();
    if (st.reloadEnd && now >= st.reloadEnd) { // isi ulang selesai (sama seperti di darat)
      const wi = st.reloadFor, def = wi && WEAPONS[wi.kind];
      if (def && wi === (w && w.inst)) { const got = Math.min(def.mag - wi.mag, me.ammo[def.ammo]); wi.mag += got; me.ammo[def.ammo] -= got; }
      st.reloadEnd = 0;
    }
    if (st.ads || st.firing || st.reloadEnd) st.vIdle = now;
    if (driver && st.vDraw && now - Math.max(st.vIdle, me.lastShot) > 5) st.vDraw = false; // sopir: 5 dtk tidak menembak → kembali pegang setir
    const armed = vArmedNow();
    if (armed && !st.vArmed) { vm.show(w.inst.kind); st.switchEnd = Math.max(st.switchEnd, now + 0.35); } // cabut senjata
    if (!armed) { st.ads = false; st.firing = false; }
    st.vArmed = armed;
    st.vRel = wrap(st.yaw - v.yaw);
    st.vBlock = armed && Math.abs(st.vRel) > (driver ? ARC_DRIVER : ARC_PASS);
    if (w) { // sebaran: sopir (satu tangan) lebih lebar, makin lebar saat melaju
      const base = st.ads ? w.def.ads : w.def.spread;
      st.vSpread = base * (driver ? 1.5 : 1.15) * (1 + Math.min(1, Math.abs(v.speed) / 16));
    }
    if ((st.firing || st.burstLeft > 0) && armed) fire(now);
  }

  return {
    st, vm,
    reset() {
      Object.assign(st, { yaw: 0, pitch: -0.25, tpp: false, ads: false, firing: false, crouch: false, prone: false, sprint: false, nextShot: 0, reloadEnd: 0, switchEnd: 0, healEnd: 0, recoilP: 0, recoilY: 0, camD: 0, prompt: null, spec: null, revive: null, revOn: false });
      vm.show(null);
      chute.visible = false;
      applyEquipped(char, vm, OUTFIT); // skin karakter & senjata yang sedang dipakai (game/skins.js, profile.equipped)
    },
    weapon,
    select,
    setPlane(p) { st.plane = p; },
    // masukan setir untuk kendaraan pemain
    input() { return { throttle: keys.fwd - keys.back, steer: keys.right - keys.left, handbrake: !!keys.hb, boost: st.sprint && keys.fwd > 0 }; },
    onEnter(v) {
      Object.assign(st, { ads: false, firing: false, crouch: false, prone: false, reloadEnd: 0, healEnd: 0, camD: 0, vzoom: 1, lookT: -9, vDraw: false, vArmed: false, vBlock: false, vLean: 0 });
      me.prone = false;
      st.yaw = v.yaw;
      st.pitch = -0.2;
      vm.show(null);
    },
    onSeat(i) { // setelah pindah kursi: jeda singkat sebelum bisa menembak; sopir kembali pegang setir
      Object.assign(st, { ads: false, firing: false, vDraw: false, vArmed: false, vLean: 0 });
      st.switchEnd = ctx.now() + 0.6;
      keys.hb = 0;
      if (i === 0 && me.vehicle) st.lookT = -9;
    },
    onExit() {
      st.camD = 0;
      keys.hb = 0;
      Object.assign(st, { ads: false, firing: false, vDraw: false, vArmed: false, vBlock: false, vLean: 0 });
      const w = weapon();
      vm.show(w ? w.inst.kind : null);
      st.switchEnd = ctx.now() + 0.45;
    },
    shake(k) { st.shake = Math.max(st.shake, k); },
    // regu: pemain tumbang (merangkak, kamera orang ketiga) / dipulihkan / tersingkir lalu menonton rekan
    onDown() {
      st.tppWas = st.tpp;
      Object.assign(st, { prone: true, crouch: false, ads: false, firing: false, sprint: false, reloadEnd: 0, healEnd: 0, revive: null, revOn: false, tpp: true, camD: 0 });
      nadeAbort();
      if (st.lootUI) closeLoot(false);
      vm.show(null);
    },
    onRevived() {
      st.prone = false; st.crouch = true; st.tpp = !!st.tppWas; st.camD = 0;
      st.stanceT = ctx.now() + 0.6;
      const w = weapon();
      vm.show(w ? w.inst.kind : null);
      st.switchEnd = ctx.now() + 0.6;
    },
    onDead() { Object.assign(st, { ads: false, firing: false, revive: null, camD: 0 }); vm.show(null); },
    spectate(a) { st.spec = a || null; st.camD = 0; if (a) { st.yaw = a.yaw || st.yaw; st.pitch = -0.22; } },
    update(dt, now) {
      if (me.state === 'ground' && me.alive) ground(dt, now);
      else if (st.crate || st.lootUI) { st.crate = null; st.lootUI = false; hud.lootPanel(null); } // naik kendaraan / mati → panel loot ditutup
      else if ((me.state === 'fall' || me.state === 'chute') && me.alive) air(dt);
      if (me.state !== 'ground' || !me.alive) nadeAbort(); // granat batal: naik kendaraan / mati
      // pulihkan sentakan
      st.recoilP *= Math.exp(-dt * 7);
      st.recoilY *= Math.exp(-dt * 7);
      placeCamera(dt);
      if (drv() && me.alive) seated(dt, now); // setelah kamera: sinar bidik memakai kamera frame ini
      // karakter orang ketiga / saat terjun
      const driving = !!drv();
      const showChar = me.state === 'fall' || me.state === 'chute' || me.state === 'dead' || (me.state === 'ground' && st.tpp) || (driving && !st.vfp);
      char.root.visible = showChar;
      if (showChar) {
        if (driving) { char.root.position.set(me.pos.x, me.sitY || 0, me.pos.z); char.root.rotation.set(0, me.yaw, me.sitRoll || 0); }
        else { char.root.position.copy(me.pos); char.root.rotation.set(0, me.state === 'ground' ? st.yaw : me.yaw, 0); }
        const p = me.pose;
        p.speed = me.state === 'ground' ? me.moveSpeed : 0;
        p.moveYaw = me.moveYaw || 0;
        p.crouch = st.crouch || !!st.revive;
        p.prone = st.prone && me.state === 'ground';
        p.swim = st.swim && me.state === 'ground';
        { const w0 = weapon(); p.reload = st.reloadEnd && w0 ? 1 - (st.reloadEnd - ctx.now()) / w0.def.reload : null; }
        p.heal = !!st.healEnd || !!st.revive;
        p.gunKind = me.cur >= 0 && me.weapons[me.cur] ? me.weapons[me.cur].kind : null;
        p.air = me.state === 'ground' && !me.grounded;
        p.armed = me.cur >= 0 && !!me.weapons[me.cur] && !me.down && !st.revive;
        p.aim = st.ads || st.firing;
        p.pitch = st.pitch;
        p.dead = !me.alive;
        p.freefall = me.state === 'fall';
        p.chute = me.state === 'chute';
        p.sit = driving ? me.sitKind || 'car' : null;
        p.recline = driving ? me.sitRecline || 0 : 0;
        p.steer = driving && isDriver() ? me.vehicle.steerN || 0 : 0;
        p.pass = driving && !isDriver(); // penumpang: tangan di pangkuan kalau tidak bersenjata
        p.twist = 0; p.oneHand = false;
        if (driving) {
          const armed = st.vArmed; // bersenjata: badan memutar ke arah bidikan (dibatasi busur kursi), sopir satu tangan
          p.speed = 0; p.crouch = false; p.prone = false; p.heal = false;
          p.armed = armed; p.aim = armed && (st.ads || ctx.now() - me.lastShot < 0.6);
          p.pitch = armed ? st.pitch : 0;
          if (!armed) p.reload = null;
          const arc = isDriver() ? ARC_DRIVER : ARC_PASS;
          p.twist = armed ? clamp(st.vRel, -arc, arc) : 0;
          p.oneHand = armed && isDriver();
        }
        if (p.swim) { p.armed = false; p.aim = false; p.crouch = false; p.prone = false; p.reload = null; p.heal = false; }
        char.rig.pose(p, dt);
        { const wk = me.cur >= 0 && me.weapons[me.cur] ? me.weapons[me.cur].kind : null, gunOn = p.armed && !p.dead && wk ? wk : ''; // model senjata yang dipegang
          if (gunOn !== charGun || me.helmet !== charHelm || me.vest !== charVest) {
            charGun = gunOn; charHelm = me.helmet; charVest = me.vest;
            for (const k of GUN_KEYS) char.setGear(GUN_GEAR[k], gunOn === k);
            char.setGear('gun', !!gunOn && !char.parts[GUN_GEAR[gunOn]]);
            char.setGear('helmet', me.helmet); // tingkat 0–3 (model lama: nyala/mati)
            char.setGear('vest', me.vest);
            char.setGear('hair', me.helmet === 0);
          } }
      } else char.rig.pose(me.pose, dt); // tetap jalan untuk goyangan kamera
      chute.visible = me.state === 'chute';
      if (chute.visible) { chute.position.set(me.pos.x, me.pos.y + chuteY, me.pos.z); chute.rotation.y = me.yaw; }
      // senjata di tangan
      // orang pertama di kendaraan (V) dengan senjata siap: senjata di tangan digambar di atas kabin (tidak terpotong interior)
      const vfp = driving && st.vfp && st.vArmed && me.alive;
      const fp = (me.state === 'ground' && !st.tpp && me.alive) || vfp;
      const w = weapon();
      const scoped = fp && st.ads && w && w.def.scope && ctx.now() > st.switchEnd;
      vm.update({ dt, reloading: !!st.reloadEnd, healing: !!st.healEnd, ads: fp && st.ads && !st.reloadEnd, moving: driving ? Math.min(0.25, Math.abs(me.vehicle.speed) / 60) : Math.min(1, me.moveSpeed / 5), sprint: !driving && st.sprinting, mdx: st.mdx, mdy: st.mdy, grounded: driving || me.grounded, scoped });
      st.mdx = st.mdy = 0;
      const targetFov = fp && st.ads && w ? w.def.fovAds : driving && st.vArmed && st.ads && w ? Math.max(42, w.def.fovAds) : 75; // kamera belakang: zoom bidik
      camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-dt * 14));
      camera.updateProjectionMatrix();
      return { fp, scoped };
    },
  };
}
