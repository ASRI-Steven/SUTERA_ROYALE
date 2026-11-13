// Mode Jelajah: berjalan di dalam diorama Alam Sutera sebagai orang ketiga atau orang pertama.
// Alur: tombol Jelajah → klik titik di peta → avatar muncul di situ, kamera menukik ke belakangnya.
// Kendali ala game PC: mouse = lihat (tanpa klik tahan, pointer lock), W A S D jalan, Shift lari, Spasi lompat,
// V = orang pertama/ketiga, F/E = info terdekat, M = peta besar (klik = pindah), scroll = jarak kamera, Esc = lepas mouse / keluar.
// Layar sentuh: joystick + geser layar. Gedung, air, pohon, dan tepi kawasan padat.
import * as THREE from 'three';
import { createCollider } from './collide.js';
import { buildCharacter, OUTFIT_PETUGAS } from './rig.js';
import { makeMapImage, drawMinimap, BigMap } from './mapview.js';

const M = 0.1;
const WALK = 3.2, RUN = 7.5; // m/s, lebih cepat dari aslinya supaya kawasan 700 ha masih terjangkau
const GRAV = 18, JUMP = 5.4, RAD = 0.32;
const EYE = 1.55, EYE_FP = 1.66; // pusat kamera orang ketiga / mata orang pertama
const FOV = 62, NEAR = 0.12, SENS = 0.0022;
const FOG = [350, 3200];
const SHADOW_HALF = 240;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;

export function createWalk(env) {
  const { scene, camera, controls, D, inArea, bb } = env;
  const btn = document.getElementById('walkBtn');
  const cvs = env.renderer.domElement;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let state = 'off'; // off | pick | enter | walk | exit
  let col = null, char = null, hud = null, mapImg = null, big = null;
  const P = new THREE.Vector3(), vel = new THREE.Vector2(), look = new THREE.Vector3(), pivot = new THREE.Vector3();
  const dir = new THREE.Vector3(), tA = new THREE.Vector3(), tB = new THREE.Vector3(), tL = new THREE.Vector3(), tC = new THREE.Vector3(), shadowC = new THREE.Vector3();
  let vy = 0, grounded = true, heading = 0, moveSp = 0, moveYaw = 0;
  let camYaw = 0, camPitch = 0.3, camDist = 5.5, camCur = 5.5, lastLook = 0, fp = false, fpPitch = 0, lift = 0;
  let tw = null, last = 0, hudT = 0, pinsCache = [], prompt = null, mapFov = camera.fov, mapFog = [scene.fog.near, scene.fog.far];
  const lastShadow = new THREE.Vector3();
  const keys = { fwd: false, back: false, left: false, right: false, run: false, jump: false };
  const stick = { x: 0, y: 0 };
  const pose = { speed: 0, moveYaw: 0, air: false };

  // ---------- Avatar ----------
  function buildAvatar() {
    char = buildCharacter(OUTFIT_PETUGAS, { cap: true, stripe: true, hair: true });
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(20,16,40,.55)');
    gr.addColorStop(1, 'rgba(20,16,40,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    char.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }));
    char.blob.renderOrder = 8;
    char.root.visible = char.blob.visible = false;
    char.night = null;
    scene.add(char.root, char.blob);
  }
  function placeAvatar(dt) {
    char.root.position.copy(P);
    char.root.rotation.y = heading;
    pose.speed = moveSp;
    pose.moveYaw = moveYaw;
    pose.air = !grounded;
    char.rig.pose(pose, dt);
    const k = 1 / (1 + P.y * 0.6);
    char.blob.position.set(P.x, 0.17, P.z);
    char.blob.scale.setScalar(k);
    char.blob.material.opacity = k;
  }

  // ---------- Pointer lock: mouse menggerakkan kamera tanpa klik ----------
  const locked = () => document.pointerLockElement === cvs;
  function lock() {
    if (coarse || state !== 'walk' && state !== 'enter' || locked() || !cvs.requestPointerLock) return;
    try { const p = cvs.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* browser menolak: pakai seret */ }
  }
  function unlock() { if (locked()) document.exitPointerLock(); }
  document.addEventListener('pointerlockchange', () => syncLockHint());
  function syncLockHint() { if (hud) hud.lockHint.hidden = coarse || state !== 'walk' || locked() || !!(big && !big.el.hidden); }
  function lookBy(dx, dy) {
    camYaw -= dx * SENS;
    if (fp) fpPitch = clamp(fpPitch - dy * SENS, -1.35, 1.35);
    else camPitch = clamp(camPitch + dy * SENS, -0.22, 1.2);
    lastLook = performance.now();
  }
  addEventListener('mousemove', (e) => { if (state === 'walk' && locked()) lookBy(e.movementX, e.movementY); });
  cvs.addEventListener('click', () => lock());
  const drags = new Map(); // tanpa pointer lock (layar sentuh / browser menolak): seret untuk melihat
  cvs.addEventListener('pointerdown', (e) => { if (state === 'walk' && !locked()) drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d || state !== 'walk' || locked()) return;
    lookBy((e.clientX - d.x) * 2.5, (e.clientY - d.y) * 2.1);
    d.x = e.clientX;
    d.y = e.clientY;
  });
  const endDrag = (e) => drags.delete(e.pointerId);
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);
  cvs.addEventListener('wheel', (e) => {
    if (state !== 'walk') return;
    e.preventDefault();
    if (!fp) camDist = clamp(camDist * Math.exp(e.deltaY * 0.0012), 2.2, 32);
  }, { passive: false });

  // ---------- Keyboard (standar game PC) ----------
  const KEYMAP = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'run', ShiftRight: 'run' };
  const typing = (e) => { const t = e.target; return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
  addEventListener('keydown', (e) => {
    if (state === 'off' || typing(e)) return;
    if (e.key === 'Escape') {
      if (state === 'pick') { state = 'off'; syncUi(); }
      else if (state === 'walk') {
        if (big && !big.el.hidden) big.close();
        else if (!env.cardOpen()) exit();
      }
      syncLockHint();
      return;
    }
    if (state !== 'walk') return;
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); return; }
    if (e.code === 'Space') { if (!e.repeat) keys.jump = true; e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === 'KeyE' || e.code === 'KeyF') act();
    else if (e.code === 'KeyM') toggleMap();
    else if (e.code === 'KeyV') setFp(!fp);
    else if (e.code === 'KeyH' || e.code === 'F1') { hud.help.hidden = !hud.help.hidden; e.preventDefault(); }
  }, true);
  addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; }, true);
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  function setFp(on) {
    if (on === fp) return;
    fp = on;
    if (fp) fpPitch = clamp(0.28 - camPitch, -0.6, 0.6);
    else camPitch = clamp(0.28 - fpPitch, -0.1, 0.9);
    hud.view.textContent = fp ? 'Orang pertama' : 'Orang ketiga';
    hud.view.classList.remove('flash');
    void hud.view.offsetWidth;
    hud.view.classList.add('flash');
  }
  function toggleMap() {
    if (!big) return;
    if (big.el.hidden) { unlock(); big.open(); } else { big.close(); lock(); }
    syncLockHint();
  }

  // ---------- HUD ----------
  function buildHud() {
    const pin = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>';
    const pick = document.createElement('div');
    pick.className = 'wk-pick panel';
    pick.hidden = true;
    pick.innerHTML = '<span class="wk-pick-dot" aria-hidden="true"></span><span>' + (coarse ? 'Ketuk' : 'Klik') + ' titik di peta untuk mulai jalan di situ</span><button type="button" class="btn ghost">Batal</button>';
    pick.querySelector('button').addEventListener('click', () => { state = 'off'; syncUi(); });
    const root = document.createElement('div');
    root.className = 'wk-hud' + (coarse ? ' touch' : '');
    root.hidden = true;
    root.innerHTML =
      '<div class="wk-loc panel">' + pin + '<div class="wk-loc-t"><b class="wk-place">Alam Sutera</b><small class="wk-road" hidden></small></div>' +
        '<button type="button" class="wk-move" title="Peta besar (M)">Peta <kbd>M</kbd></button></div>' +
      '<div class="wk-view panel">Orang ketiga</div>' +
      '<div class="wk-lock panel" hidden>Klik layar untuk mengendalikan kamera dengan mouse</div>' +
      '<button type="button" class="wk-prompt panel" hidden><kbd>F</kbd><span></span></button>' +
      '<div class="wk-help panel">' + (coarse
        ? '<span>Joystick = jalan, dorong penuh = lari</span><span>Geser layar = putar kamera</span>'
        : '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> jalan</span><span><kbd>Shift</kbd> lari</span><span><kbd>Spasi</kbd> lompat</span>' +
          '<span>Mouse = lihat</span><span><kbd>V</kbd> kamera 1/3</span><span><kbd>F</kbd> info</span><span><kbd>M</kbd> peta</span><span><kbd>Esc</kbd> keluar</span>' +
          '<button type="button" class="wk-help-x" aria-label="Sembunyikan petunjuk (H)">×</button>') + '</div>' +
      '<div class="wk-map panel" title="Klik untuk membuka peta besar"><canvas></canvas><span class="wk-n">U</span></div>' +
      '<div class="wk-joy" aria-hidden="true"><i></i></div><button type="button" class="wk-jump" aria-label="Lompat">' +
        '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    const fade = document.createElement('div');
    fade.className = 'wk-fade';
    document.body.append(pick, root, fade);
    const $q = (s) => root.querySelector(s);
    hud = { pick, root, fade, place: $q('.wk-place'), road: $q('.wk-road'), prompt: $q('.wk-prompt'), promptText: $q('.wk-prompt span'), help: $q('.wk-help'),
      map: $q('.wk-map'), canvas: $q('.wk-map canvas'), north: $q('.wk-n'), joy: $q('.wk-joy'), jump: $q('.wk-jump'), view: $q('.wk-view'), lockHint: $q('.wk-lock'), placeText: '' };
    $q('.wk-move').addEventListener('click', toggleMap);
    hud.map.addEventListener('click', toggleMap);
    hud.prompt.addEventListener('click', act);
    const hx = $q('.wk-help-x');
    if (hx) hx.addEventListener('click', () => { hud.help.hidden = true; });
    hud.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.jump = true; });
    const knob = hud.joy.firstElementChild;
    let joyId = null;
    const joyMove = (e) => {
      const r = hud.joy.getBoundingClientRect(), R = r.width / 2, m = R * 0.62;
      let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
      const l = Math.hypot(dx, dy);
      if (l > m) { dx = dx / l * m; dy = dy / l * m; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      stick.x = dx / m;
      stick.y = -dy / m;
    };
    hud.joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; hud.joy.setPointerCapture(e.pointerId); joyMove(e); e.preventDefault(); });
    hud.joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
    const joyEnd = (e) => { if (e.pointerId !== joyId) return; joyId = null; stick.x = stick.y = 0; knob.style.transform = ''; };
    hud.joy.addEventListener('pointerup', joyEnd);
    hud.joy.addEventListener('pointercancel', joyEnd);
  }
  function ensureMaps() {
    if (mapImg) return;
    mapImg = makeMapImage(D, bb);
    big = new BigMap(mapImg, {
      hint: 'Klik titik = pindah ke situ · scroll = zoom · seret = geser · <kbd>M</kbd> tutup',
      getState: () => ({ x: P.x, y: -P.z, heading, pins: pinsCache, focus: true }),
      onPick: (x, y) => { big.close(); teleport(x, y); lock(); syncLockHint(); },
    });
    const draw = () => { if (big && !big.el.hidden) big.draw(); requestAnimationFrame(draw); };
    requestAnimationFrame(draw);
  }
  function drawMap() {
    const c = hud.canvas, size = c.clientWidth;
    if (!size) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(size * dpr)) c.width = c.height = Math.round(size * dpr);
    const r = drawMinimap(c.getContext('2d'), mapImg, { size, dpr, x: P.x, y: -P.z, rot: camYaw, range: 150, heading, pins: pinsCache });
    hud.north.style.transform = 'translate(' + (r.north[0] - 9).toFixed(1) + 'px,' + (r.north[1] - 9).toFixed(1) + 'px)';
  }

  // ---------- Gerak, kamera, transisi ----------
  function stepPlayer(dt, now) {
    let ix = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + stick.x, iz = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0) + stick.y;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const run = keys.run || Math.hypot(stick.x, stick.y) > 0.92, sp = (run ? RUN : WALK) * Math.min(1, il);
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let tx = fx * iz + rx * ix, tz = fz * iz + rz * ix;
    const tl = Math.hypot(tx, tz);
    if (tl > 1e-6) { tx = tx / tl * sp; tz = tz / tl * sp; } else { tx = tz = 0; }
    const a = 1 - Math.exp(-dt * (grounded ? 10 : 2.5));
    vel.x += (tx - vel.x) * a;
    vel.y += (tz - vel.y) * a;
    const r = col.step(P.x, -P.z, P.x + vel.x * dt, -(P.z + vel.y * dt), RAD);
    const mx = r.x - P.x, mz = -r.y - P.z;
    moveSp = dt > 0 ? Math.hypot(mx, mz) / dt : 0;
    P.x = r.x;
    P.z = -r.y;
    if (keys.jump && grounded) { vy = JUMP; grounded = false; }
    keys.jump = false;
    if (!grounded) {
      vy -= GRAV * dt;
      P.y += vy * dt;
      if (P.y <= 0) { P.y = 0; vy = 0; grounded = true; }
    }
    if (fp) heading = camYaw + Math.PI; // orang pertama: badan selalu menghadap arah pandang
    else if (tl > 1e-6 && sp > 0) heading += wrap(Math.atan2(tx, tz) - heading) * (1 - Math.exp(-dt * 12));
    moveYaw = moveSp > 0.1 ? wrap(Math.atan2(mx, mz) - heading) : 0;
    if (!fp && moveSp > 1.5 && iz > 0.2 && now - lastLook > 1500) camYaw += wrap(heading + Math.PI - camYaw) * (1 - Math.exp(-dt * 0.9));
  }
  function clearance(pitch) {
    const cp = Math.cos(pitch);
    dir.set(Math.sin(camYaw) * cp, Math.sin(pitch), Math.cos(camYaw) * cp);
    for (let s = 0.6; s < camDist; s += 0.4) {
      const x = pivot.x + dir.x * s, h = pivot.y + dir.y * s, z = pivot.z + dir.z * s;
      if (h < 0.35 || col.solidAt(x, -z, h)) return Math.max(0.9, s - 0.45);
    }
    return camDist;
  }
  function camPose(dt, outPos, outLook) { // dt < 0 = tanpa penghalusan
    if (fp && state === 'walk') {
      const bob = Math.sin(char.rig.phase * 2) * 0.035 * Math.min(1, moveSp / RUN) * (grounded ? 1 : 0);
      const cp = Math.cos(fpPitch), fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      outPos.set(P.x + fx * 0.12, P.y + EYE_FP + bob, P.z + fz * 0.12);
      outLook.set(outPos.x + fx * cp, outPos.y + Math.sin(fpPitch), outPos.z + fz * cp);
      char.root.visible = false;
      return;
    }
    pivot.set(P.x, P.y + EYE, P.z);
    const want = Math.min(camDist, 4);
    let need = 0;
    if (clearance(camPitch) < want) {
      need = 1.25 - camPitch;
      for (let b = 0.15; camPitch + b <= 1.25; b += 0.15) if (clearance(camPitch + b) >= want) { need = b; break; }
    }
    lift = dt < 0 ? need : lift + (need - lift) * (1 - Math.exp(-dt * (need > lift ? 6 : 1.5)));
    const allowed = clearance(camPitch + lift);
    camCur = dt < 0 || allowed < camCur ? allowed : camCur + (allowed - camCur) * (1 - Math.exp(-dt * 4));
    outPos.copy(pivot).addScaledVector(dir, camCur);
    outLook.copy(pivot);
    outLook.y += 0.15;
    char.root.visible = camCur > 1.3;
  }
  const toSph = (v) => { const r = Math.max(1e-3, v.length()); return { r, el: Math.asin(clamp(v.y / r, -1, 1)), az: Math.atan2(v.x, v.z) }; };
  function stepTween(now, dt) {
    const k = tw.ms ? Math.min(1, (now - tw.t0) / tw.ms) : 1, e = ease(k);
    let C, toPos, toLook;
    if (state === 'enter') { camPose(-1, tA, tL); C = tC.set(P.x, P.y + EYE, P.z); toPos = tA; toLook = tL; }
    else { C = tw.C; toPos = tw.to; toLook = tw.C; }
    const s0 = toSph(tB.copy(tw.fromPos).sub(C)), s1 = toSph(tB.copy(toPos).sub(C));
    const r = s0.r * Math.pow(s1.r / s0.r, e), el = s0.el + (s1.el - s0.el) * e, az = s0.az + wrap(s1.az - s0.az) * e;
    camera.position.set(C.x + Math.sin(az) * Math.cos(el) * r, C.y + Math.sin(el) * r, C.z + Math.cos(az) * Math.cos(el) * r);
    look.lerpVectors(tw.fromLook, toLook, e);
    camera.lookAt(look);
    const f = state === 'enter' ? e : 1 - e;
    camera.fov = mapFov + (FOV - mapFov) * f;
    camera.near = clamp(camera.position.distanceTo(look) * 0.04, NEAR, 3);
    camera.updateProjectionMatrix();
    scene.fog.near = mapFog[0] + (FOG[0] - mapFog[0]) * f;
    scene.fog.far = mapFog[1] + (FOG[1] - mapFog[1]) * f;
    placeAvatar(dt);
    if (k < 1) return;
    if (state === 'enter') {
      state = 'walk';
      camera.fov = FOV;
      camera.near = NEAR;
      camera.updateProjectionMatrix();
      env.setShadowFocus(() => ({ c: shadowC.set(P.x, 0, P.z), half: SHADOW_HALF, nb: 0.12 }));
      env.refreshShadows();
      lastShadow.copy(P);
      hudT = 0;
      if (coarse) setTimeout(() => { if (hud) hud.help.hidden = true; }, 9000);
    } else {
      controls.target.copy(tw.C);
      camera.position.copy(tw.to);
      camera.fov = mapFov;
      camera.near = 3;
      camera.updateProjectionMatrix();
      scene.fog.near = mapFog[0];
      scene.fog.far = mapFog[1];
      char.root.visible = char.blob.visible = false;
      env.setPinHeight(14);
      controls.enabled = true;
      controls.update();
      state = 'off';
      env.refreshShadows();
    }
    tw = null;
    syncUi();
  }
  function begin(x, y, faceX, faceY) {
    if (!char) buildAvatar();
    ensureMaps();
    mapFov = camera.fov;
    mapFog = [scene.fog.near, scene.fog.far];
    P.set(x, 0, -y);
    vel.set(0, 0);
    vy = 0;
    grounded = true;
    moveSp = 0;
    const off = tB.copy(camera.position).sub(tC.set(x, EYE, -y));
    camYaw = Math.atan2(off.x, off.z);
    heading = camYaw + Math.PI;
    camPitch = 0.3;
    fpPitch = 0;
    const dx = faceX - x, dy = faceY - y;
    if (Math.hypot(dx, dy) > 1) { heading = Math.atan2(dx, -dy); camYaw = heading + Math.PI; camPitch = 0.16; }
    camCur = camDist;
    char.root.visible = char.blob.visible = true;
    controls.enabled = false;
    env.cancelAnim();
    env.setPinHeight(10);
    state = 'enter';
    tw = { t0: performance.now(), ms: env.RM ? 0 : 1700, fromPos: camera.position.clone(), fromLook: controls.target.clone() };
    syncUi();
    lock(); // dipanggil dari klik → browser mengizinkan pointer lock
  }
  function exit() {
    if (state !== 'walk') return;
    unlock();
    if (big) big.close();
    env.setShadowFocus(null);
    const C = new THREE.Vector3(P.x, 0, P.z), el = Math.PI / 2 - 0.9;
    const to = C.clone().add(new THREE.Vector3(Math.sin(camYaw) * Math.cos(el), Math.sin(el), Math.cos(camYaw) * Math.cos(el)).multiplyScalar(420));
    state = 'exit';
    tw = { t0: performance.now(), ms: env.RM ? 0 : 1300, fromPos: camera.position.clone(), fromLook: look.clone(), C, to };
    syncUi();
  }
  function teleport(x, y) {
    if (state !== 'walk') return false;
    const s = col.arrival(x, y);
    if (!s) { env.toast('Tidak ada tempat kosong di sekitar titik itu.'); return false; }
    const dx = x - s[0], dy = y - s[1];
    P.set(s[0], 0, -s[1]);
    vel.set(0, 0);
    vy = 0;
    grounded = true;
    if (Math.hypot(dx, dy) > 1) { heading = Math.atan2(dx, -dy); camPitch = 0.16; fpPitch = 0; }
    camYaw = heading + Math.PI;
    camCur = camDist;
    hud.fade.classList.remove('on');
    void hud.fade.offsetWidth;
    hud.fade.classList.add('on');
    lastShadow.copy(P);
    env.refreshShadows();
    hudT = 0;
    return true;
  }
  function act() {
    if (!prompt) return;
    unlock();
    if (prompt.kind === 'c') env.openComplaint(prompt.p.key);
    else if (prompt.kind === 'b') env.openBuilding(prompt.b);
    else env.openPoi(prompt.p);
    syncLockHint();
  }
  function hudTick(now) {
    if (now - hudT < 250) return;
    hudT = now;
    const night = document.body.dataset.sky === 'night' || document.body.dataset.sky === 'dusk';
    if (night !== char.night) { // malam: garis emas seragam memantul (reflektif)
      char.night = night;
      for (const o of char.parts.stripe || []) { o.material.emissive.set(night ? '#D29F52' : '#000000'); o.material.emissiveIntensity = night ? 1.1 : 0; }
    }
    pinsCache = env.pins();
    const x = P.x, y = -P.z, road = col.roadAt(x, y);
    let place = env.clusterAt(x, y);
    if (!place) {
      let bd = 220, bp = null;
      for (const p of D.pois) { const d = Math.hypot(p.x * M - x, p.y * M - y); if (d < bd) { bd = d; bp = p; } }
      place = bp ? (bd < 60 ? bp.name : 'Dekat ' + bp.name) : D.meta.name;
    }
    if (place !== hud.placeText) { hud.place.textContent = place; hud.placeText = place; }
    if ((road || '') !== hud.road.textContent) hud.road.textContent = road || '';
    hud.road.hidden = !road;
    let best = null;
    for (const p of pinsCache) { const d = Math.hypot(p.x - x, p.y - y); if (d < 28 && (!best || d < best.d)) best = { kind: 'c', d, p }; }
    if (!best && col.lastTouch.b >= 0 && now - col.lastTouch.t < 1500) best = { kind: 'b', b: col.lastTouch.b };
    if (!best) for (const p of D.pois) { const d = Math.hypot(p.x * M - x, p.y * M - y); if (d < 30 && (!best || d < best.d)) best = { kind: 'p', d, p }; }
    prompt = best;
    hud.prompt.hidden = !best;
    if (best) hud.promptText.textContent = best.kind === 'c' ? 'Lihat keluhan · ' + best.p.label + ' · ' + Math.round(best.d) + ' m' : best.kind === 'b' ? 'Info bangunan ini' : 'Info · ' + best.p.name;
  }
  function syncUi() {
    if (!hud) buildHud();
    const on = state === 'enter' || state === 'walk' || state === 'exit';
    document.body.classList.toggle('walk-pick', state === 'pick');
    document.body.classList.toggle('walking', on);
    btn.setAttribute('aria-pressed', String(state !== 'off'));
    btn.title = state === 'off' ? 'Jelajah: jalan di peta' : state === 'pick' ? 'Batal jelajah' : 'Keluar dari jelajah (Esc)';
    btn.setAttribute('aria-label', btn.title);
    hud.pick.hidden = state !== 'pick';
    hud.root.hidden = state !== 'walk';
    if (state !== 'walk') { for (const k in keys) keys[k] = false; stick.x = stick.y = 0; drags.clear(); }
    syncLockHint();
    env.onChange();
  }

  return {
    active: () => state === 'enter' || state === 'walk' || state === 'exit',
    walking: () => state === 'walk',
    pos: () => P,
    azimuth: () => camYaw,
    toggle() {
      if (state === 'off') { if (!col) col = createCollider(D, inArea); state = 'pick'; syncUi(); }
      else if (state === 'pick') { state = 'off'; syncUi(); }
      else if (state === 'walk') exit();
    },
    mapClick(cx, cy) { // mode pilih titik: klik di peta = muncul di situ
      if (state !== 'pick') return false;
      const g = env.groundAt(cx, cy);
      if (!g || !inArea(g.x, g.y)) { env.toast('Pilih titik di dalam kawasan ' + D.meta.name + '.'); return true; }
      const s = col.arrival(g.x, g.y);
      if (!s) { env.toast('Titik itu tertutup bangunan, coba titik lain.'); return true; }
      begin(s[0], s[1], g.x, g.y);
      return true;
    },
    teleport,
    update(now) {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      if (state === 'enter' || state === 'exit') { stepTween(now, dt); return; }
      if (state !== 'walk') return;
      stepPlayer(dt, now);
      placeAvatar(dt);
      camPose(dt, camera.position, look);
      camera.lookAt(look);
      hudTick(now);
      drawMap();
      if (Math.hypot(P.x - lastShadow.x, P.z - lastShadow.z) > 45) { lastShadow.copy(P); env.refreshShadows(); }
    },
  };
}
