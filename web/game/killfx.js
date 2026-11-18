// Efek kill pemain ala "kill banner": tiap kill / lumpuhkan oleh pemain → spanduk HUD dengan hitungan kill beruntun
// (1 → 5+, makin megah), denting bertingkat (game/audio.js killSting), dan partikel di tubuh korban — semuanya bertema skin
// senjata yang dipakai (game/skins.js gunTheme): serpih es, bara, hujan bulu emas, kipas bulu merak, piksel terurai, petir,
// kelopak, asap tuah, gelembung mutiara; skin tanpa efek khusus = ledakan cahaya warna temanya.
// Pose mati & peti jarahan tidak disentuh (efek hanya tampil di atasnya).
// Biaya: 2 draw call (partikel aditif + partikel padat) dari kolam tetap, tanpa alokasi per kill; tanpa partikel hidup =
// tanpa kerja CPU. Program shader terkompilasi di lobi (objek sudah ada di adegan sejak awal, draw range 0).
// main.js: createKillFx({ scene, hud }) → { kill(korban, kepala), knock(korban, kepala), update(dt), preview(pos, n) }.
import * as THREE from 'three';
import { gunTheme } from './skins.js';
import * as audio from './audio.js';

const STREAK_S = 12; // jeda maks antar-kill supaya masih dihitung beruntun (dtk permainan)
// bentuk partikel (shp.x): 0 pijar · 1 serpih · 2 bulu · 3 kelopak · 4 piksel · 5 cincin kejut · 6 pilar cahaya · 7 bulu merak · 8 kilat · 9 asap
// partikel yang terlalu dekat kamera (< ±1,5 m) atau terlalu besar di layar (> ±30 % tinggi layar) memudar: kill dari jarak
// sangat dekat / kamera menonton yang berada di tengah awan efek tidak tertutup sprite raksasa
const VS = `attribute vec4 col; attribute vec3 shp; uniform float uH, uMax; varying vec4 vC; varying vec2 vS;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float px = shp.z * uH * projectionMatrix[1][1] * 0.5 / max(0.05, -mv.z);
  gl_PointSize = min(uMax, px);
  vC = col; vC.a *= smoothstep(0.45, 1.6, -mv.z) * (1.0 - smoothstep(0.3 * uH, 0.7 * uH, px)); vS = shp.xy; }`;
const FS = `uniform float uAdd; varying vec4 vC; varying vec2 vS;
void main() {
  vec2 c = gl_PointCoord - 0.5; c.y = -c.y;
  float cs = cos(vS.y), sn = sin(vS.y); c = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
  int k = int(vS.x + 0.5); float a; vec3 tint = vec3(1.0);
  if (k == 0) a = exp(-dot(c, c) * 24.0) + 0.6 * exp(-dot(c, c) * 220.0);
  else if (k == 1) { vec2 q = abs(c); a = 1.0 - smoothstep(-0.02, 0.02, q.x * 2.4 + q.y - 0.46); tint = vec3(0.7 + 0.9 * (0.5 - q.y) + 0.4 * step(q.x, 0.03)); }
  else if (k == 2) { float y = c.y + 0.5, w = 0.17 * sin(clamp(y, 0.0, 1.0) * 3.1416) * (1.0 - 0.35 * y);
    float vane = 1.0 - smoothstep(w - 0.02, w + 0.005, abs(c.x)), barb = 0.72 + 0.28 * sin(y * 46.0 - abs(c.x) * 34.0);
    float shaft = 1.0 - smoothstep(0.006, 0.02, abs(c.x)); a = max(vane * barb, shaft) * step(0.02, y) * step(y, 0.98); tint = vec3(mix(0.7, 1.2, y)); }
  else if (k == 3) { vec2 q = c * vec2(2.3, 1.5) + vec2(0.0, 0.12); a = 1.0 - smoothstep(0.36, 0.44, length(q) + q.y * 0.4); tint = vec3(0.8 + 0.5 * (0.5 - length(c))); }
  else if (k == 4) { vec2 q = abs(c); float m = max(q.x, q.y); a = step(m, 0.34) * (0.7 + 0.3 * step(m, 0.22)); tint = vec3(1.0 + 0.7 * step(m, 0.18)); }
  else if (k == 5) { float r = length(c); a = exp(-pow((r - 0.43) * 26.0, 2.0)) * step(r, 0.5); }
  else if (k == 6) { a = exp(-c.x * c.x * 320.0) * (1.0 - smoothstep(0.2, 0.5, abs(c.y))) + 0.25 * exp(-c.x * c.x * 40.0) * (1.0 - smoothstep(0.0, 0.5, abs(c.y))); }
  else if (k == 7) { float y = c.y + 0.5, w = 0.2 * sin(clamp(y, 0.0, 1.0) * 3.1416);
    float vane = 1.0 - smoothstep(w - 0.02, w + 0.005, abs(c.x)), barb = 0.8 + 0.2 * sin(y * 50.0 - abs(c.x) * 40.0);
    vec2 e = c - vec2(0.0, 0.14); float re = length(e * vec2(1.0, 0.8));
    vec3 cc = mix(vec3(0.16, 0.5, 0.12), vec3(0.85, 0.62, 0.12), (1.0 - smoothstep(0.2, 0.23, re)));
    cc = mix(cc, vec3(0.04, 0.62, 0.56), 1.0 - smoothstep(0.14, 0.17, re));
    cc = mix(cc, vec3(0.08, 0.22, 0.85), 1.0 - smoothstep(0.09, 0.12, re));
    cc = mix(cc, vec3(0.02, 0.03, 0.16), 1.0 - smoothstep(0.035, 0.06, re));
    a = vane * barb * step(0.02, y) * step(y, 0.98); tint = cc * 1.6; }
  else if (k == 8) { float x = c.x + 0.11 * sin(c.y * 21.0 + vS.y * 7.0) + 0.05 * sin(c.y * 57.0 + vS.y * 3.0);
    a = (exp(-x * x * 1100.0) + 0.3 * exp(-x * x * 70.0)) * (1.0 - smoothstep(0.32, 0.5, abs(c.y))); }
  else a = exp(-dot(c, c) * 9.0) * 0.85;
  a *= vC.a;
  if (a < 0.004) discard;
  gl_FragColor = uAdd > 0.5 ? vec4(vC.rgb * tint * a, a) : vec4(vC.rgb * tint, a);
}`;
// kolam partikel: emit(...) menulis ke slot bebas (penuh → timpa acak); update(dt) menggeser & memudarkan yang hidup
function pool(scene, n, additive, order) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), shp = new Float32Array(n * 3), S = new Float32Array(n * 16);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('col', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('shp', new THREE.BufferAttribute(shp, 3));
  geo.setDrawRange(0, 0);
  const uni = { uH: { value: 720 }, uMax: { value: 900 }, uAdd: { value: additive ? 1 : 0 } };
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: uni, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false; pts.matrixAutoUpdate = false; pts.renderOrder = order;
  pts.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); uni.uH.value = rt ? rt.height : renderer.domElement.height; };
  scene.add(pts);
  let m = 0;
  return {
    pts, get count() { return m; },
    // (x,y,z) posisi · (vx,vy,vz) kecepatan · k bentuk · s0→s1 ukuran (m) · life (dtk) · rgb (HDR) a · grav (+ jatuh, − naik) ·
    // drag · spin (rad/dtk) · flut (goyang menyamping, bulu/kelopak) · delay (dtk sebelum tampil)
    emit(x, y, z, vx, vy, vz, k, s0, s1, life, r, g, b, a, grav = 0, drag = 0, spin = 0, flut = 0, delay = 0) {
      let i = m;
      if (m >= n) i = (Math.random() * n) | 0; else m++;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = 0;
      shp[i * 3] = k; shp[i * 3 + 1] = Math.random() * 6.283; shp[i * 3 + 2] = delay > 0 ? 0 : s0;
      const q = i * 16;
      S[q] = vx; S[q + 1] = vy; S[q + 2] = vz; S[q + 3] = -delay; S[q + 4] = life; S[q + 5] = s0; S[q + 6] = s1; S[q + 7] = a;
      S[q + 8] = grav; S[q + 9] = drag; S[q + 10] = spin; S[q + 11] = flut; S[q + 12] = Math.random() * 6.283;
    },
    update(dt) {
      if (!m) { if (geo.drawRange.count) geo.setDrawRange(0, 0); return; }
      for (let i = 0; i < m; i++) {
        const q = i * 16;
        S[q + 3] += dt;
        if (S[q + 3] >= S[q + 4]) { // mati: tukar dengan yang terakhir
          m--;
          if (i < m) {
            const j = m;
            for (let c = 0; c < 3; c++) { pos[i * 3 + c] = pos[j * 3 + c]; shp[i * 3 + c] = shp[j * 3 + c]; }
            for (let c = 0; c < 4; c++) col[i * 4 + c] = col[j * 4 + c];
            for (let c = 0; c < 16; c++) S[q + c] = S[j * 16 + c];
            i--;
          }
          continue;
        }
        if (S[q + 3] < 0) { col[i * 4 + 3] = 0; continue; } // belum waktunya tampil
        const f = S[q + 3] / S[q + 4], dr = Math.max(0, 1 - S[q + 9] * dt), fl = S[q + 11];
        S[q] *= dr; S[q + 1] = S[q + 1] * dr - S[q + 8] * dt; S[q + 2] *= dr;
        let sx = 0;
        if (fl) { S[q + 12] += dt * 3.1; sx = Math.sin(S[q + 12]) * fl; } // bulu/kelopak melayang berayun
        pos[i * 3] += (S[q] + sx) * dt; pos[i * 3 + 1] += S[q + 1] * dt; pos[i * 3 + 2] += (S[q + 2] + sx * 0.6) * dt;
        shp[i * 3 + 1] += S[q + 10] * dt + (fl ? Math.cos(S[q + 12]) * 0.9 * dt : 0);
        shp[i * 3 + 2] = S[q + 5] + (S[q + 6] - S[q + 5]) * (1 - (1 - f) * (1 - f));
        col[i * 4 + 3] = S[q + 7] * (additive ? Math.min(1, f * 14) * (1 - f * f) : Math.min(1, f * 10) * Math.min(1, (1 - f) / 0.3));
      }
      geo.setDrawRange(0, m);
      geo.attributes.position.needsUpdate = geo.attributes.col.needsUpdate = geo.attributes.shp.needsUpdate = true;
    },
  };
}

const rr = (a, b) => a + Math.random() * (b - a);
const _c = new THREE.Color();
// warna tema ('#hex', ruang warna kerja linear) × skala HDR
const lin = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };
// gaya efek kill per tema. A = kolam aditif, B = kolam padat; e = { x, y, z (kaki), h (tinggi badan), n (beruntun), knock, c1, c2 }
function body(e) { const a = rr(0, 6.283), r = rr(0, 0.28); return [e.x + Math.cos(a) * r, e.y + rr(0.08, e.h), e.z + Math.sin(a) * r]; } // titik acak di badan
function common(A, e, k1, ringK = 1) {
  const cy = e.y + e.h * 0.55, kk = e.knock ? 0.6 : 1;
  A.emit(e.x, cy, e.z, 0, 0, 0, 0, 1.6 * kk, 0.4, 0.2, k1[0] * 5, k1[1] * 5, k1[2] * 5, 1);                       // kilat inti
  A.emit(e.x, cy, e.z, 0, 0, 0, 5, 0.4, (2.6 + e.n * 0.35) * kk * ringK, 0.5, k1[0] * 3, k1[1] * 3, k1[2] * 3, 1); // cincin kejut
  if (e.n >= 5 && !e.knock) A.emit(e.x, cy, e.z, 0, 0, 0, 5, 0.6, 6.5, 0.8, k1[0] * 2.4, k1[1] * 2.4, k1[2] * 2.4, 1, 0, 0, 0, 0, 0.12);
  if (e.n >= 3 && !e.knock) A.emit(e.x, e.y + 2.2, e.z, 0, 0, 0, 6, 4.4, 5.4, 0.9, k1[0] * 3.2, k1[1] * 3.2, k1[2] * 3.2, 1); // pilar cahaya
}
const STYLES = {
  burst(A, B, e, m) {
    const c1 = lin(e.c1), c2 = lin(e.c2);
    common(A, e, c1);
    for (let i = 0; i < 26 * m; i++) { const p = body(e), t = Math.random(); A.emit(p[0], p[1], p[2], rr(-4, 4), rr(0.5, 5), rr(-4, 4), 0, 0.07, 0.02, rr(0.35, 0.7), (c1[0] * (1 - t) + c2[0] * t) * 5, (c1[1] * (1 - t) + c2[1] * t) * 5, (c1[2] * (1 - t) + c2[2] * t) * 5, 1, 5, 2); }
    for (let i = 0; i < 14 * m; i++) { const p = body(e); A.emit(p[0], p[1], p[2], rr(-0.3, 0.3), rr(0.6, 1.5), rr(-0.3, 0.3), 0, 0.06, 0.02, rr(0.8, 1.4), c1[0] * 3, c1[1] * 3, c1[2] * 3, 1, -0.2, 1); }
  },
  shatter(A, B, e, m) { // kristal es: serpih es berputar beterbangan + kabut beku + kilau
    const c1 = lin('#7fdcff');
    common(A, e, c1);
    for (let i = 0; i < 30 * m; i++) { const p = body(e), a = Math.atan2(p[2] - e.z, p[0] - e.x), s = rr(1.5, 4.5); B.emit(p[0], p[1], p[2], Math.cos(a) * s, rr(1, 3.4), Math.sin(a) * s, 1, rr(0.08, 0.17), rr(0.06, 0.12), rr(0.9, 1.4), 0.78, 0.94, 1.05, 0.92, 9, 0.5, rr(-12, 12)); }
    for (let i = 0; i < 6 * m; i++) { const p = body(e); B.emit(p[0], p[1], p[2], rr(-0.4, 0.4), rr(0, 0.3), rr(-0.4, 0.4), 9, 0.4, 1.4, rr(0.8, 1.2), 0.86, 0.95, 1, 0.32, 0, 1.2); }
    for (let i = 0; i < 22 * m; i++) { const p = body(e); A.emit(p[0], p[1], p[2], rr(-2, 2), rr(0, 2.5), rr(-2, 2), 0, 0.05, 0.015, rr(0.4, 0.9), 3.2, 5.2, 7.5, 1, 2, 1.5); }
  },
  ember(A, B, e, m) { // inti magma: bara naik berhamburan + asap jelaga
    const c1 = lin('#ff6a1a');
    common(A, e, c1);
    for (let i = 0; i < 50 * m; i++) { const p = body(e), t = Math.random(); A.emit(p[0], p[1], p[2], rr(-2.4, 2.4), rr(1.2, 4), rr(-2.4, 2.4), 0, rr(0.04, 0.07), 0.01, rr(0.9, 1.8), 8 + t, 2.4 + 3 * t, 0.35 + 0.8 * t, 1, -0.6, 1.3); }
    for (let i = 0; i < 8 * m; i++) { const p = body(e); B.emit(p[0], p[1], p[2], rr(-0.3, 0.3), rr(0.4, 1.0), rr(-0.3, 0.3), 9, 0.5, 1.7, rr(1.2, 1.7), 0.07, 0.05, 0.045, 0.55, -0.2, 0.8); }
  },
  feather(A, B, e, m) { // emas garuda: semburan bulu emas yang melayang turun berayun + percik emas
    const c1 = lin('#ffc64a');
    common(A, e, c1);
    for (let i = 0; i < 22 * m; i++) { const p = body(e), a = rr(0, 6.283), s = rr(1.2, 3); B.emit(p[0], p[1], p[2], Math.cos(a) * s, rr(2, 4.2), Math.sin(a) * s, 2, rr(0.2, 0.32), rr(0.17, 0.27), rr(2.2, 3.2), 1.45, 0.82, 0.18, 1, 1.5, 2.4, rr(-3, 3), rr(0.6, 1.3)); }
    for (let i = 0; i < 30 * m; i++) { const p = body(e); A.emit(p[0], p[1], p[2], rr(-3.5, 3.5), rr(0.5, 4.5), rr(-3.5, 3.5), 0, 0.06, 0.015, rr(0.4, 0.9), 7, 5, 1.6, 1, 4, 2); }
  },
  peacock(A, B, e, m) { // dadak merak: kipas bulu merak mekar ke atas + percik toska & emas
    const c1 = lin('#19c9a8');
    common(A, e, c1);
    const N = Math.round(14 * m);
    for (let i = 0; i < N; i++) { const a = (i / Math.max(1, N - 1) - 0.5) * 2.4, yaw = rr(0, 6.283), s = rr(1.6, 2.6); B.emit(e.x, e.y + e.h * 0.7, e.z, Math.sin(a) * s * Math.cos(yaw), Math.cos(a) * s + 1, Math.sin(a) * s * Math.sin(yaw), 7, rr(0.26, 0.36), rr(0.24, 0.32), rr(2, 2.8), 1, 1, 1, 1, 1.2, 2.2, rr(-2, 2), rr(0.4, 1)); }
    for (let i = 0; i < 30 * m; i++) { const p = body(e), t = i % 2; A.emit(p[0], p[1], p[2], rr(-3, 3), rr(0.5, 4), rr(-3, 3), 0, 0.06, 0.015, rr(0.4, 0.9), t ? 6 : 0.8, t ? 4 : 5.5, t ? 1 : 4, 1, 3, 2); }
  },
  pixel(A, B, e, m) { // neon / hologram: badan terurai jadi piksel cahaya yang naik
    const c1 = lin(e.c1), c2 = lin(e.c2), rb = e.emblem === 'holo';
    common(A, e, c1);
    for (let i = 0; i < 60 * m; i++) {
      const p = body(e), t = Math.random(); let r = c1[0] * (1 - t) + c2[0] * t, g = c1[1] * (1 - t) + c2[1] * t, b = c1[2] * (1 - t) + c2[2] * t;
      if (rb) { _c.setHSL(Math.random(), 0.9, 0.6); r = _c.r; g = _c.g; b = _c.b; }
      A.emit(p[0], p[1], p[2], rr(-0.6, 0.6), rr(0.6, 2.2), rr(-0.6, 0.6), 4, rr(0.05, 0.09), 0.02, rr(0.7, 1.3), r * 4, g * 4, b * 4, 1, -0.4, 1);
    }
  },
  disintegrate(A, B, e, m) { // reaktor plasma: piksel terurai pelan dari seluruh badan, cincin ganda, pilar plasma
    const c1 = lin('#2fd8ff');
    common(A, e, c1, 1.2);
    if (!e.knock && e.n < 3) A.emit(e.x, e.y + 2.2, e.z, 0, 0, 0, 6, 4.4, 5.4, 0.9, c1[0] * 3, c1[1] * 3, c1[2] * 3, 1);
    for (let i = 0; i < 90 * m; i++) { const p = body(e), w = Math.random() < 0.3; A.emit(p[0], p[1], p[2], rr(-0.3, 0.3), rr(0.4, 1.6), rr(-0.3, 0.3), 4, rr(0.04, 0.08), 0.015, rr(1, 1.6), w ? 6 : 1.2, w ? 7 : 6, w ? 8 : 9, 1, -0.5, 0.6, 0, 0, rr(0, 0.25)); }
    A.emit(e.x, e.y + 0.05, e.z, 0, 0, 0, 5, 0.3, 4.2, 0.7, c1[0] * 2, c1[1] * 2, c1[2] * 2, 1, 0, 0, 0, 0, 0.08);
  },
  bolt(A, B, e, m) { // badai petir: sambaran kilat di sekitar badan (dua gelombang) + percik
    const c1 = lin('#9d90ff');
    common(A, e, c1);
    for (let i = 0; i < 6 * m; i++) { const p = body(e); A.emit(p[0], e.y + e.h * 0.6, p[2], 0, 0, 0, 8, rr(1.6, 2.6), rr(1.6, 2.6), rr(0.1, 0.22), 6, 6, 10, 1, 0, 0, 0, 0, i % 2 ? 0.09 : 0); }
    for (let i = 0; i < 40 * m; i++) { const p = body(e); A.emit(p[0], p[1], p[2], rr(-4, 4), rr(0, 4), rr(-4, 4), 0, 0.05, 0.01, rr(0.2, 0.5), 5, 5, 10, 1, 4, 3); }
  },
  petal(A, B, e, m) { // songket: kelopak emas & marun berayun turun + serbuk emas
    const c1 = lin('#f2c25a');
    common(A, e, c1);
    for (let i = 0; i < 26 * m; i++) { const p = body(e), a = rr(0, 6.283), s = rr(1, 2.6), t = i % 3; B.emit(p[0], p[1], p[2], Math.cos(a) * s, rr(1.8, 3.6), Math.sin(a) * s, 3, rr(0.08, 0.13), rr(0.07, 0.11), rr(2, 2.8), t ? 1.2 : 0.62, t ? 0.82 : 0.08, t ? 0.3 : 0.16, 1, 1.4, 2.2, rr(-4, 4), rr(0.7, 1.5)); }
    for (let i = 0; i < 30 * m; i++) { const p = body(e); A.emit(p[0], p[1], p[2], rr(-2.5, 2.5), rr(0.3, 3), rr(-2.5, 2.5), 0, 0.05, 0.012, rr(0.5, 1), 7, 5, 1.6, 1, 2, 2); }
  },
  spirit(A, B, e, m) { // pamor keris: asap tuah gelap naik berpilin + cahaya toska-emas
    const c1 = lin('#2fd3b0');
    common(A, e, c1);
    for (let i = 0; i < 10 * m; i++) { const p = body(e); B.emit(p[0], p[1], p[2], rr(-0.25, 0.25), rr(0.6, 1.3), rr(-0.25, 0.25), 9, 0.4, 1.5, rr(1.3, 1.9), 0.04, 0.1, 0.09, 0.55, -0.3, 0.6, 0, 0.5); }
    for (let i = 0; i < 34 * m; i++) { const p = body(e), t = i % 3 === 0; A.emit(p[0], p[1], p[2], rr(-0.8, 0.8), rr(0.8, 2.4), rr(-0.8, 0.8), 0, 0.06, 0.015, rr(0.9, 1.6), t ? 6 : 1, t ? 4.4 : 5.5, t ? 1.4 : 4.4, 1, -0.4, 1.2, 0, 0.6); }
  },
  pearl(A, B, e, m) { // mutiara laut: gelembung pastel naik bergoyang + kilau
    const c1 = lin('#f7c6d8');
    common(A, e, c1);
    for (let i = 0; i < 24 * m; i++) { const p = body(e); _c.setHSL(rr(0.45, 0.95), 0.6, 0.75); A.emit(p[0], p[1], p[2], rr(-0.5, 0.5), rr(0.5, 1.4), rr(-0.5, 0.5), 5, rr(0.08, 0.16), rr(0.12, 0.2), rr(1.2, 1.8), _c.r * 3, _c.g * 3, _c.b * 3, 1, -0.3, 0.8, 0, 0.6); }
    for (let i = 0; i < 20 * m; i++) { const p = body(e); A.emit(p[0], p[1], p[2], rr(-2, 2), rr(0.2, 2.4), rr(-2, 2), 0, 0.05, 0.012, rr(0.4, 0.9), 5, 5, 5.5, 1, 2, 2); }
  },
};

export function createKillFx({ scene, hud }) {
  const A = pool(scene, 700, true, 24), B = pool(scene, 360, false, 23);
  let clock = 0, streak = 0, last = -1e9, sting = null;
  const e = { x: 0, y: 0, z: 0, h: 1.7, n: 1, knock: false, c1: '#ffc64a', c2: '#fff1c8', emblem: 'std' };
  function fx(victim, n, knock, th) {
    const p = victim.pos, down = victim.prone || victim.down; // korban yang tadinya tumbang berbaring; yang lain masih tegak saat efek muncul
    Object.assign(e, { x: p.x, y: p.y + (victim.state === 'drive' ? (victim.sitY || 0) - p.y : 0), z: p.z, h: down ? 0.55 : victim.crouch ? 1.2 : 1.7, n, knock, c1: th.color, c2: th.color2, emblem: th.emblem });
    (STYLES[th.kill] || STYLES.burst)(A, B, e, knock ? 0.45 : 1 + 0.25 * Math.min(4, n - 1));
  }
  function play(n, knock, th) { // satu denting per kejadian (kill berantai dalam satu frame = satu denting dengan hitungan terakhir)
    if (sting && sting.due !== Infinity && clock - sting.at < 0.06) { sting.n = Math.max(sting.n, n); sting.knock = sting.knock && knock; return; }
    sting = { n, knock, voice: th.voice, at: clock, due: clock + 0.03 };
  }
  return {
    // pemain menyingkirkan korban (main.js kill()); head = tembakan kepala
    kill(victim, head) {
      if (!victim || !victim.pos) return;
      streak = clock - last <= STREAK_S ? streak + 1 : 1;
      last = clock;
      const th = gunTheme();
      fx(victim, streak, false, th);
      play(streak, false, th);
      if (hud && hud.killBanner) hud.killBanner({ n: streak, knock: false, head: !!head, name: victim.name || '', theme: th });
    },
    // pemain melumpuhkan korban (main.js knock()): efek & spanduk ringan, hitungan beruntun tidak naik
    knock(victim, head) {
      if (!victim || !victim.pos) return;
      const th = gunTheme(), n = clock - last <= STREAK_S ? Math.max(1, streak) : 1;
      fx(victim, n, true, th);
      play(n, true, th);
      if (hud && hud.killBanner) hud.killBanner({ n, knock: true, head: !!head, name: victim.name || '', theme: th });
    },
    // pratinjau (lobi): efek kill bertema skin `id` di posisi p (Vector3, kaki), hitungan n
    preview(p, n = 1, id) { const th = gunTheme(id); fx({ pos: p, state: 'ground' }, n, false, th); audio.killSting(n, th.voice, false); },
    update(dt) {
      clock += dt;
      if (sting && clock >= sting.due) { audio.killSting(sting.n, sting.voice, sting.knock); sting.due = Infinity; }
      A.update(dt); B.update(dt);
    },
    get active() { return A.count + B.count; },
  };
}
