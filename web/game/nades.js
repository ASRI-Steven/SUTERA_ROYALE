// Granat (pemain & bot): fisika lempar (gravitasi, pantul lantai & dinding, melambat di air), sumbu waktu, ledakan
// (kerusakan lewat explode() main.js: berkurang menjauh, terhalang gedung, merusak kendaraan) dan granat asap (awan
// partikel ±8 m, ±20 dtk) yang menghalangi pandangan (smokeBlocks dipakai persepsi bot). Pratinjau lintasan untuk pemain.
// Koordinat dunia three.js: x timur, y atas, z = −utara (data y).
import * as THREE from 'three';
import { NADES, gunGeometry } from './weapons.js';
import * as audio from './audio.js';

const G = 9.8, SUB = 3;

export function createNades(ctx) {
  const { scene, col, camera, fx, explode, particles, renderer } = ctx;
  const list = [], clouds = [];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const geos = {};
  for (const k of Object.keys(NADES)) geos[k] = gunGeometry(k).scale(1.4, 1.4, 1.4);
  const smoke = particles(scene, 2200, false), glow = particles(scene, 400, true);
  const out = { b: -2 };

  // ---------- pratinjau lintasan (garis putus-putus + cincin titik jatuh) ----------
  const NP = 90, lp = new Float32Array(NP * 3), lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const line = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: '#ffd27a', dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.95, depthTest: false, fog: false }));
  line.frustumCulled = false; line.visible = false; line.renderOrder = 40;
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 15); gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const dg = new THREE.BufferGeometry(), dp = new Float32Array(NP * 3); // titik-titik lintasan (ukuran piksel tetap; mulai 2 m dari tangan)
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dots = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#ffe2a0', map: dotTex, size: 7, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  dots.frustumCulled = false; dots.visible = false; dots.renderOrder = 41;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false }));
  const disk = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, fog: false }));
  ring.add(disk);
  ring.visible = false; ring.renderOrder = 40; disk.renderOrder = 40;
  scene.add(line, dots, ring);

  // satu langkah fisika: p, v (Vector3) diubah di tempat; hasil 'ground' | 'wall' | 'water' | null
  function step(p, v, dt) {
    v.y -= G * dt;
    const nx = p.x + v.x * dt, nz = p.z + v.z * dt, ny = p.y + v.y * dt;
    const hx = nx - p.x, hz = nz - p.z, hl = Math.hypot(hx, hz);
    if (hl > 1e-5) { // dinding (sinar mendatar setinggi granat): pantul balik, teredam
      const t = col.ray(p.x, -p.z, Math.max(0.15, p.y), hx / hl, -hz / hl, 0, hl + 0.06, out);
      if (t < hl + 0.06) { v.x *= -0.42; v.z *= -0.42; p.y = ny; return 'wall'; }
    }
    const fl = col.floorAt(nx, -nz, p.y) || 0;
    if (ny <= fl + 0.04 && v.y < 0) {
      p.x = nx; p.z = nz;
      if (fl < 0.05 && col.waterAt(nx, -nz)) { p.y = Math.max(ny, -0.6); v.multiplyScalar(0.5); return 'water'; }
      p.y = fl + 0.04;
      v.y = -v.y * 0.3; v.x *= 0.6; v.z *= 0.6;
      if (Math.abs(v.y) < 0.7) v.y = 0;
      return 'ground';
    }
    p.x = nx; p.y = ny; p.z = nz;
    return null;
  }

  function throwNade(owner, kind, pos, vel, cooked = 0) { // cooked = detik sumbu yang sudah terpakai di tangan
    const def = NADES[kind];
    if (!def) return;
    const mesh = new THREE.Mesh(geos[kind], mat);
    mesh.castShadow = true;
    scene.add(mesh);
    list.push({ owner, kind, def, p: pos.clone(), v: vel.clone(), t: cooked, mesh, spin: new THREE.Vector3(Math.random() * 9 - 4.5, Math.random() * 6, Math.random() * 9 - 4.5), rest: false, cloud: null });
    if (camDist(pos)[0] < 25) audio.click(); // bunyi pin dicabut hanya terdengar dekat
  }

  function camDist(p) { const dx = p.x - camera.position.x, dz = p.z - camera.position.z; return [Math.hypot(dx, p.y - camera.position.y, dz), dx, dz]; }
  function blast(n) {
    const p = n.p;
    explode(p.x, -p.z, p.y + 0.25, n.def.r, n.def.dmg, n.owner, null);
    boomFx(p);
  }
  // efek ledakan saja (bola api, asap, bunyi) di titik p — dipakai juga untuk jeriken bensin yang meledak
  function boomFx(p) {
    // bola api: inti HDR (jauh di atas ambang bloom) yang cepat padam + lidah api jingga di sekelilingnya
    if (fx.flash) fx.flash({ x: p.x, y: p.y + 0.6, z: p.z }, 7, 0.14, 14, 9, 4);
    for (let i = 0; i < 40; i++) { const k = i < 12 ? 5.5 : 1.7; glow.emit(p.x + (Math.random() - 0.5), p.y + 0.3 + Math.random() * 0.8, p.z + (Math.random() - 0.5), (Math.random() - 0.5) * 12, Math.random() * 9 + 2, (Math.random() - 0.5) * 12, 2 + Math.random() * 2.5, 0.4, (i < 12 ? 0.16 : 0.3) + Math.random() * 0.35, k, k * (0.55 + Math.random() * 0.25), k * 0.2, 1); }
    for (let i = 0; i < 26; i++) smoke.emit(p.x + (Math.random() - 0.5) * 2, p.y + 0.5 + Math.random() * 1.5, p.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3, 2, 6 + Math.random() * 3, 2 + Math.random() * 2, 0.16, 0.15, 0.15, 0.7);
    fx.burst(p, 'spark', 30, 2.2);
    fx.burst(p, 'dust', 24, 1.6);
    // cincin debu menyapu tanah + asap gelap yang bertahan beberapa detik
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2 + Math.random() * 0.3, sp = 5 + Math.random() * 3; smoke.emit(p.x + Math.cos(a) * 0.6, p.y + 0.25, p.z + Math.sin(a) * 0.6, Math.cos(a) * sp, 0.4 + Math.random() * 0.6, Math.sin(a) * sp, 1.2, 4.5 + Math.random() * 2, 1.1 + Math.random() * 0.7, 0.55, 0.5, 0.43, 0.42); }
    for (let i = 0; i < 8; i++) smoke.emit(p.x + (Math.random() - 0.5), p.y + 1 + Math.random() * 1.5, p.z + (Math.random() - 0.5), (Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2, 2.5, 7 + Math.random() * 3, 4 + Math.random() * 2.5, 0.09, 0.085, 0.085, 0.6);
    const [d, dx, dz] = camDist(p), yaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
    audio.boom(d, Math.max(-1, Math.min(1, Math.sin(Math.atan2(dx, dz) - yaw))));
  }

  // ---------- awan asap ----------
  function cloudR(c, now) { const a = now - c.t0; return a < 0 ? 0 : c.r * Math.min(1, a / 3) * (a > c.dur - 3 ? Math.max(0, (c.dur - a) / 3) : 1); }
  function updateClouds(dt, now) {
    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i], a = now - c.t0;
      if (a > c.dur + 6) { clouds.splice(i, 1); continue; }
      if (a > c.dur - 2) continue; // berhenti menyembur; partikel sisa memudar
      c.acc += dt * (a < 2 ? 120 : 34);
      const r = c.r * Math.min(1, a / 3 + 0.15);
      while (c.acc >= 1) {
        c.acc--;
        const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r * 0.85;
        smoke.emit(c.x + Math.cos(ang) * rr, 0.4 + Math.random() * 3.6, c.z + Math.sin(ang) * rr, (Math.random() - 0.5) * 0.5, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5, 3.5 + Math.random() * 2, 7 + Math.random() * 4, 5 + Math.random() * 3, 0.82, 0.84, 0.86, 0.55);
      }
    }
  }
  // garis pandang (data: x, y utara, h tinggi) melewati awan asap yang sudah menebal?
  function smokeBlocks(ax, ay, ah, bx, by, bh, now = performance.now() / 1000) {
    for (const c of clouds) {
      const r = cloudR(c, ctx.now ? ctx.now() : now);
      if (r < 1.5) continue;
      // jarak terdekat ruas A→B ke pusat awan (sumbu tegak dipipihkan 1,6×)
      const cx = c.x, cy = -c.z, ch = 2.2, dx = bx - ax, dy = by - ay, dh = (bh - ah) * 1.6, L2 = dx * dx + dy * dy + dh * dh;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy + (ch - ah) * 1.6 * dh) / L2)) : 0;
      const ex = ax + dx * t - cx, ey = ay + dy * t - cy, eh = (ah - ch) * 1.6 + dh * t;
      if (ex * ex + ey * ey + eh * eh < r * r * 0.72) return true;
    }
    return false;
  }

  // ---------- pratinjau (pemain) ----------
  const pv = new THREE.Vector3(), vv = new THREE.Vector3();
  function aim(o, v) {
    if (!o) { line.visible = dots.visible = ring.visible = false; return; }
    pv.copy(o); vv.copy(v);
    let n = 0, landed = false;
    lp[0] = pv.x; lp[1] = pv.y; lp[2] = pv.z; n = 1;
    for (let i = 0; i < 160 && n < NP; i++) {
      const r = step(pv, vv, 1 / 40);
      if (i % 2 === 0 || r) { lp[n * 3] = pv.x; lp[n * 3 + 1] = pv.y; lp[n * 3 + 2] = pv.z; n++; }
      if (r === 'ground' || r === 'water') { landed = true; break; }
    }
    lg.setDrawRange(0, n);
    lg.attributes.position.needsUpdate = true;
    line.computeLineDistances();
    let m = 0;
    for (let i = 1; i < n; i++) if (Math.hypot(lp[i * 3] - o.x, lp[i * 3 + 1] - o.y, lp[i * 3 + 2] - o.z) > 2) { dp[m * 3] = lp[i * 3]; dp[m * 3 + 1] = lp[i * 3 + 1]; dp[m * 3 + 2] = lp[i * 3 + 2]; m++; }
    dg.setDrawRange(0, m);
    dg.attributes.position.needsUpdate = true;
    line.visible = dots.visible = true;
    ring.visible = landed;
    if (landed) { ring.position.set(pv.x, pv.y + 0.05, pv.z); ring.scale.setScalar(Math.max(1, Math.hypot(pv.x - o.x, pv.z - o.z) / 12)); } // jauh: cincin membesar agar tetap terlihat
  }

  // kecepatan lempar bot supaya jatuh di (x, y) data setinggi h: kecepatan mendatar ~14 m/dtk, lambung lebih tinggi bila jauh
  function lob(from, tx, ty, th = 0) {
    const dx = tx - from.x, dz = -ty - from.z, d = Math.hypot(dx, dz) || 1, vh = Math.min(16, 8 + d * 0.3), T = d / vh;
    return new THREE.Vector3(dx / d * vh, (th - from.y) / T + 0.5 * G * T, dz / d * vh);
  }

  // hitung mundur sumbu granat pemain: angka kecil yang menempel di granat (layar), merah di detik terakhir
  const fuseEl = document.createElement('div'), fuseV = new THREE.Vector3();
  fuseEl.style.cssText = 'position:fixed;left:0;top:0;z-index:40;pointer-events:none;display:none;padding:2px 8px;border-radius:9px;background:rgba(18,16,34,.78);color:#fff;font:700 15px/1.2 system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;will-change:transform';
  document.body.appendChild(fuseEl);
  let fuseTxt = '', cookLeft = null; // cookLeft: sisa sumbu granat yang sedang ditahan pemain (null = tidak menahan)
  function setFuse(txt, left) { if (txt !== fuseTxt) { if (fuseTxt === '') fuseEl.style.display = 'block'; fuseTxt = txt; fuseEl.textContent = '\u23F1 ' + txt + ' dtk'; fuseEl.style.color = left < 1.5 ? '#ff6b5e' : '#fff'; } }
  function drawFuse() {
    if (cookLeft !== null) { // masih di tangan: angka di bawah bidikan
      setFuse(Math.max(0, cookLeft).toFixed(1), cookLeft);
      fuseEl.style.transform = 'translate(' + Math.round(innerWidth / 2) + 'px,' + Math.round(innerHeight * 0.62) + 'px) translate(-50%,-100%)';
      return;
    }
    let n = null;
    for (const o of list) if (o.kind === 'frag' && o.owner && o.owner.isPlayer && (!n || o.t < n.t)) n = o; // yang terakhir dilempar
    if (!n) { if (fuseTxt !== '') { fuseTxt = ''; fuseEl.style.display = 'none'; } return; }
    const left = Math.max(0, n.def.fuse - n.t);
    setFuse(left.toFixed(1), left);
    fuseV.copy(n.p); fuseV.y += 0.45; fuseV.project(camera);
    const behind = fuseV.z > 1, sx = behind ? 0.5 : Math.min(0.94, Math.max(0.06, fuseV.x * 0.5 + 0.5)), sy = behind ? 0.62 : Math.min(0.9, Math.max(0.08, -fuseV.y * 0.5 + 0.5)); // di belakang kamera: tampil di bawah bidikan
    fuseEl.style.transform = 'translate(' + Math.round(sx * innerWidth) + 'px,' + Math.round(sy * innerHeight) + 'px) translate(-50%,-100%)';
  }
  function update(dt, now) {
    const h = dt / SUB;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      n.t += dt;
      if (!n.rest) for (let k = 0; k < SUB; k++) { const r = step(n.p, n.v, h); if (r === 'ground' && n.v.lengthSq() < 0.5) { n.rest = true; n.v.set(0, 0, 0); break; } }
      n.mesh.position.copy(n.p);
      if (!n.rest) { n.mesh.rotation.x += n.spin.x * dt; n.mesh.rotation.y += n.spin.y * dt; n.mesh.rotation.z += n.spin.z * dt; }
      if (n.kind === 'frag' && n.t >= n.def.fuse) { blast(n); scene.remove(n.mesh); list.splice(i, 1); continue; }
      if (n.kind === 'smoke') {
        if (!n.cloud && n.t >= n.def.fuse) { n.cloud = { x: n.p.x, z: n.p.z, r: n.def.r, dur: n.def.dur, t0: now, acc: 0 }; clouds.push(n.cloud); const cd = camDist(n.p)[0]; if (cd < 80) audio.splash(0.35 * (1 - cd / 80)); }
        if (n.cloud) { n.cloud.x = n.p.x; n.cloud.z = n.p.z; if (now - n.cloud.t0 > n.def.dur + 2) { scene.remove(n.mesh); list.splice(i, 1); } }
      }
    }
    drawFuse();
    updateClouds(dt, now);
    if (renderer) smoke.uni.scale.value = glow.uni.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    smoke.update(dt);
    glow.update(dt);
  }

  return { throwNade, update, aim, lob, cook(left) { cookLeft = left; }, smokeBlocks, boomFx, get active() { return list.length; }, get clouds() { return clouds; } };
}
