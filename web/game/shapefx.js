// Mesin efek skin berbentuk: kartu pita (2×5 verteks, 8 segitiga) bertekstur atlas bentuk SDF (game/fxshapes.js) yang bisa
// mengipas, melesat, melayang, mekar — bukan THREE.Points. Geraknya dihitung di vertex shader dari (uT − t0) menurut
// preset; CPU hanya menulis 24 float saat emisi (0 kerja per frame per kartu, 0 alokasi). Tidak mengimpor modul game.
// Satu lapisan = dua mesh (potong + aditif) yang berbagi buffer instans; tanpa instans hidup → tidak digambar (0 draw call).
// createShapeLayer({ max, atlas, vm }) → { group, emit(...), setAnchor(i, m4), update(dt), setLight(...), stats(), clear() }
import * as THREE from 'three';

// preset gerak. mode: 0 melayang · 1 lesat · 2 kipas · 3 kilas (billboard) · 4 cap (rebah pada bidang a×b) · 5 ombak
// (bilah naik lalu turun) · 6 tiang (tegak, billboard sumbu)
// [mode, aditif, gravitasi, drag,  ayun, Hz, putar, tekuk,  masuk dtk, keluar dtk, denyut emisi, goyang]
export const PRESETS = {
  drift:   [0, 0, 3.4, 2.4,  0.22, 3.1, 0.0, 0.16,  0.06, 0.45, 0, 0],
  drop:    [0, 0, 5.5, 1.6,  0.10, 4.0, 0.0, 0.12,  0.04, 0.25, 0, 0],
  dart:    [1, 0, 1.2, 1.4,  0.0, 0.0, 9.0, 0.0,   0.03, 0.12, 0, 0],
  fan:     [2, 0, 0, 0,      0, 0, 0, 0.10,        0.22, 0.34, 1.6, 0.035],
  fanFast: [2, 0, 0, 0,      0, 0, 0, 0.10,        0.12, 0.14, 0.8, 0.02],
  pop:     [3, 1, 0, 0,      0, 0, 0, 0,           0.035, 0.05, 0, 0],
  glint:   [3, 1, 0, 0,      0, 0, 2.2, 0,         0.06, 0.2, 0, 0],
  stamp:   [4, 1, 0, 0,      0, 0, 0, 0,           0.14, 0.3, 0, 0],
  ring:    [4, 1, 0, 0,      0, 0, 0.5, 0,         0.5, 0.45, 0, 0],
  wave:    [5, 0, 0, 0,      0, 0, 0, 0.08,        0, 0, 0.8, 0],
  beam:    [6, 1, 0, 0,      0, 0, 0, 0,           0.25, 0.6, 0, 0],
  streak:  [1, 1, 0.0, 0.8,  0.0, 0.0, 0.0, 0.0,   0.04, 0.3, 0, 0],
  fanHold: [2, 0, 0, 0,      0, 0, 0, 0.10,        0.22, 0, 1.6, 0.035],   // bilah yang lepas: hilang seketika, kartu melayang menggantikan
  fanBig:  [2, 0, 0, 0,      0, 0, 0, 0.10,        0.35, 0.7, 1.6, 0.035], // kipas finisher: menutup & larut 0,7 dtk
  driftVm: [0, 0, 0.5, 3.0,  0.02, 4.0, 0.0, 0.16, 0.0, 0.3, 0, 0],        // melayang di ruang senjata orang pertama (skala cm)
  rise:    [0, 0, -0.5, 1.2, 0.25, 2.6, 0.0, 0.16, 0.0, 0.45, 0, 0],       // lepas lalu melayang naik
  bloom:   [3, 1, 0, 0,      0, 0, 0, 0,           0.12, 0.25, 0, 0],      // cap dampak: mekar 0,12 dtk, pudar 0,25 dtk
  dropVm:  [0, 0, 6.0, 0.6,  0.0, 4.0, 0.0, 0.1,   0.0, 0.2, 0, 0],        // jatuh di ruang senjata (selongsong bulu, rontok magasin)
};
const PNAMES = Object.keys(PRESETS);
export const PRESET = Object.fromEntries(PNAMES.map((n, i) => [n, i]));

const VS = `
attribute vec2 uvp;
attribute vec4 iA, iB, iC, iD, iE, iF;
uniform float uT, uH, uAdd, uVm;
uniform mat4 uAnchor[4];
uniform vec4 uP0[24], uP1[24], uP2[24];
varying vec2 vUv; varying vec4 vK; varying float vV;
float backOut(float x) { float y = x - 1.0; return 1.0 + 2.70158 * y * y * y + 1.70158 * y * y; }
void main() {
  int pi = int(iD.z + 0.5);
  vec4 P0 = uP0[pi], P1 = uP1[pi], P2 = uP2[pi];
  float t = uT - iA.w, life = iB.w;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); vK = vec4(0.0); vV = 0.0;
  if (t < 0.0 || t >= life || abs(P0.y - uAdd) > 0.5) return;
  int mode = int(P0.x + 0.5);
  mat4 M = uAnchor[int(iE.z + 0.5)];
  float sc = length(M[0].xyz);
  mat3 R = mat3(M) / sc;
  vec3 p0 = (M * vec4(iA.xyz, 1.0)).xyz, vel = R * iB.xyz * sc, dir = R * iC.xyz;
  float h = iD.x * sc, w = h * iD.y, seed = iD.w;
  float kin = P2.x > 0.0 ? clamp(t / P2.x, 0.0, 1.0) : 1.0, kout = P2.y > 0.0 ? clamp((life - t) / P2.y, 0.0, 1.0) : 1.0;
  float dr = P0.w, e = dr > 0.0 ? (1.0 - exp(-dr * t)) / dr : t; // ∫ exp(−drag·t)
  float fall = dr > 0.0 ? P0.z / dr * (t - e) : 0.5 * P0.z * t * t;
  vec3 view = normalize(cameraPosition - p0);
  vec3 c = p0, ax = vec3(0.0, 1.0, 0.0), sd = vec3(1.0, 0.0, 0.0);
  float cen = 0.0, grow = 1.0, fade = 1.0, diss = 0.0, bend = 0.0, wk = 1.0, gain = iE.y;
  float x = uvp.x, v = uvp.y;
  if (mode == 0) { // melayang: lepas, melambat, jatuh pelan berayun & bergoyang, larut dari ujung
    c = p0 + vel * e; c.y -= fall;
    float ph = P1.y * t + seed * 6.2832, on = smoothstep(0.0, 0.45, t);
    vec3 sw = vec3(cos(seed * 39.0), 0.0, sin(seed * 39.0));
    c += sw * (P1.x * sin(ph) * on) * sc;
    if (iE.w > -900.0 && uVm < 0.5) c.y = max(c.y, iE.w + 0.03);
    view = normalize(cameraPosition - c);
    vec3 d0 = normalize(dir + vec3(0.0, 1e-4, 0.0));
    float rock = iC.w + 0.87 * cos(ph) * on;
    ax = normalize(d0 * cos(rock) + normalize(sw - d0 * dot(sw, d0) + vec3(1e-4)) * sin(rock));
    sd = normalize(cross(ax, view));
    bend = P1.w * sin(ph + 1.0); grow = 0.35 + 0.65 * kin; diss = 1.0 - kout;
  } else if (mode == 1) { // lesat: searah gerak, tangkai di depan
    c = p0 + vel * e; c.y -= fall;
    view = normalize(cameraPosition - c);
    ax = -normalize(vel + vec3(0.0, 1e-4, 0.0));
    sd = normalize(cross(ax, view));
    wk = 0.4 + 0.6 * abs(cos(P1.z * t + seed * 6.2832));
    grow = kin; diss = 1.0 - kout; fade = kout;
  } else if (mode == 2 || mode == 5) { // kipas / ombak: bilah berporos di pangkal, pada bidang (dir, vel)
    vec3 a = normalize(dir), b = normalize(R * iB.xyz);
    float k = mode == 2 ? backOut(kin) * mix(0.0, 1.0, smoothstep(0.0, 1.0, kout)) : pow(sin(3.14159 * clamp(t / life, 0.0, 1.0)), 0.8);
    float th = iE.w * (mode == 2 ? 0.08 + 0.92 * k : 1.0) + (mode == 5 ? (k - 1.0) * 1.2 : 0.0) + P2.w * sin(t * 5.0 + seed * 40.0) * kin;
    ax = cos(th) * a + sin(th) * b; sd = cos(th) * b - sin(th) * a;
    grow = mode == 2 ? 0.25 + 0.75 * clamp(k, 0.0, 1.2) : 0.3 + 0.7 * k;
    bend = P1.w * sign(iE.w + 1e-4) * (0.4 + 0.6 * k); diss = mode == 2 ? 1.0 - kout : 0.0;
    float pt = t - seed * 0.16; // denyut mata merambat tengah → tepi (seed = jarak ternormal dari tengah), dua kali
    gain *= 1.0 + P2.z * (exp(-pow((pt - 0.45) * 9.0, 2.0)) + exp(-pow((pt - 0.85) * 9.0, 2.0)));
  } else if (mode == 3) { // kilas: billboard, 0 → 1,15 → 1 lalu pudar
    c = p0 + vel * t;
    vec3 rt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float an = iC.w + P1.z * t; ax = up * cos(an) + rt * sin(an); sd = rt * cos(an) - up * sin(an);
    grow = kin < 1.0 ? 1.15 * kin * (2.0 - kin) : 1.0 + 0.15 * exp(-(t - P2.x) * 14.0);
    cen = 0.5; fade = kout;
  } else if (mode == 4) { // cap: rebah pada bidang (dir, vel), membesar aux → 1
    vec3 a = normalize(dir), b = normalize(R * iB.xyz);
    float an = iC.w + P1.z * t; ax = a * cos(an) + b * sin(an); sd = b * cos(an) - a * sin(an);
    float k = 1.0 - (1.0 - kin) * (1.0 - kin);
    grow = mix(iE.w, 1.0, k); cen = 0.5; fade = kout * min(1.0, kin * 4.0);
  } else { // tiang: tegak pada dir, menghadap kamera
    ax = normalize(dir); sd = normalize(cross(ax, view));
    grow = kin; fade = kout * kout;
  }
  vec3 pos = c + ax * ((v - cen) * h * grow) + sd * (x * w * wk * (cen > 0.0 ? grow : 1.0) + bend * h * v * v);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  float dist = -(viewMatrix * vec4(c + ax * (h * grow * (0.5 - cen)), 1.0)).z;
  float px = h * grow * uH * projectionMatrix[1][1] * 0.5 / max(0.02, dist), keep = smoothstep(6.0, 10.0, px);
  if (uVm < 0.5) keep *= smoothstep(0.45, 1.6, dist) * (1.0 - smoothstep(0.42 * uH, 0.8 * uH, px));
  if (keep <= 0.001) return;
  fade *= keep;
  gl_Position = projectionMatrix * mv;
  vUv = iF.xy + vec2(x + 0.5, v) * iF.zw; vV = v;
  vK = vec4(iE.x, gain, fade, diss);
}`;
const FS = `
uniform sampler2D tAtlas, tPal;
uniform float uAdd, uPalH, uShade;
uniform vec3 uSunC, uAmb;
varying vec2 vUv; varying vec4 vK; varying float vV;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec4 tx = texture2D(tAtlas, vUv);
  float aa = max(fwidth(tx.r) * 0.75, 0.004), a = smoothstep(0.5 - aa, 0.5 + aa, tx.r);
  if (vK.w > 0.0) { // larut dari ujung, berbintik
    float cut = 1.12 - 1.3 * vK.w, n = h21(floor(vUv * 700.0));
    a *= 1.0 - smoothstep(cut - 0.1, cut, vV + 0.14 * n);
  }
  vec3 alb = texture2D(tPal, vec2(tx.b, (vK.x * 2.0 + 0.5) / uPalH)).rgb * (0.4 + 0.6 * tx.g);
  vec3 emi = texture2D(tPal, vec2(tx.b, (vK.x * 2.0 + 1.5) / uPalH)).rgb * (tx.a * vK.y);
  if (uAdd > 0.5) {
    a *= vK.z;
    if (a < 0.004) discard;
    gl_FragColor = vec4(emi + alb * 0.15, a);
  } else {
    a *= step(0.02, vK.z);
    if (a < 0.3) discard;
    gl_FragColor = vec4(alb * (uAmb + uSunC * uShade) + emi * (0.35 + 0.65 * vK.z), a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STRIDE = 24, ROWS = 5;
export function createShapeLayer({ max = 384, atlas, vm = false }) {
  // pita 2 kolom × 5 baris
  const uvp = new Float32Array(ROWS * 2 * 2), index = [];
  for (let r = 0; r < ROWS; r++) { uvp[r * 4] = -0.5; uvp[r * 4 + 1] = r / (ROWS - 1); uvp[r * 4 + 2] = 0.5; uvp[r * 4 + 3] = r / (ROWS - 1); }
  for (let r = 0; r < ROWS - 1; r++) { const a = r * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ROWS * 2 * 3), 3)); // tidak dipakai shader; three memerlukannya
  geo.setAttribute('uvp', new THREE.BufferAttribute(uvp, 2));
  geo.setIndex(index);
  const buf = new Float32Array(max * STRIDE), ib = new THREE.InstancedInterleavedBuffer(buf, STRIDE, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  ['iA', 'iB', 'iC', 'iD', 'iE', 'iF'].forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(ib, 4, i * 4)));
  geo.instanceCount = max;
  for (let i = 0; i < max; i++) buf[i * STRIDE + 3] = 1e9; // t0 jauh di masa depan = mati
  const anchors = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
  const P0 = [], P1 = [], P2 = [];
  for (let i = 0; i < 24; i++) { const p = PRESETS[PNAMES[i]] || PRESETS.drift; P0.push(new THREE.Vector4(p[0], p[1], p[2], p[3])); P1.push(new THREE.Vector4(p[4], p[5], p[6], p[7])); P2.push(new THREE.Vector4(p[8], p[9], p[10], p[11])); }
  const shared = {
    uT: { value: 0 }, uH: { value: 720 }, uVm: { value: vm ? 1 : 0 }, uAnchor: { value: anchors }, uP0: { value: P0 }, uP1: { value: P1 }, uP2: { value: P2 },
    tAtlas: { value: atlas.tex }, tPal: { value: atlas.pal }, uPalH: { value: atlas.palRows }, uShade: { value: 1 },
    uSunC: { value: new THREE.Color(0.55, 0.52, 0.46) }, uAmb: { value: new THREE.Color(0.5, 0.52, 0.56) },
  };
  const group = new THREE.Group(), meshes = [];
  for (const add of [0, 1]) {
    const mat = new THREE.ShaderMaterial({ uniforms: { ...shared, uAdd: { value: add } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: !add, side: THREE.DoubleSide, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = add ? 26 : 25; m.visible = false; m.castShadow = false;
    m.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); shared.uH.value = rt ? rt.height : renderer.domElement.height; };
    group.add(m); meshes.push(m);
  }
  group.matrixAutoUpdate = false;
  let head = 0, lastEnd = 0, emitted = 0, peak = 0, dirty = false;
  const ends = new Float32Array(max), r4 = [0, 0, 0, 0];
  const api = {
    group, meshes, uniforms: shared, max,
    rng: 12345,
    rand() { api.rng = (api.rng * 1664525 + 1013904223) >>> 0; return api.rng / 4294967296; },
    // posisi · kecepatan (kipas/cap: sumbu samping b) · arah (sumbu panjang / tengah kipas a) · sudut awal · tinggi (m) ·
    // lebar/tinggi · preset · benih · baris palet · penguat emisi · jangkar 0–3 · aux (sudut kipas / y lantai / skala awal
    // cap) · sel atlas · umur · tunda
    emit(px, py, pz, vx, vy, vz, dx, dy, dz, ang, size, aspect, preset, seed, pal, gain, anchor, aux, cell, life, delay = 0) {
      const i = head, o = i * STRIDE, T = shared.uT.value;
      head = (head + 1) % max;
      buf[o] = px; buf[o + 1] = py; buf[o + 2] = pz; buf[o + 3] = T + delay;
      buf[o + 4] = vx; buf[o + 5] = vy; buf[o + 6] = vz; buf[o + 7] = life;
      buf[o + 8] = dx; buf[o + 9] = dy; buf[o + 10] = dz; buf[o + 11] = ang;
      buf[o + 12] = size; buf[o + 13] = aspect; buf[o + 14] = preset; buf[o + 15] = seed;
      buf[o + 16] = pal; buf[o + 17] = gain; buf[o + 18] = anchor; buf[o + 19] = aux;
      atlas.rect(cell, r4); buf[o + 20] = r4[0]; buf[o + 21] = r4[1]; buf[o + 22] = r4[2]; buf[o + 23] = r4[3];
      ends[i] = T + delay + life;
      if (ends[i] > lastEnd) lastEnd = ends[i];
      emitted++; dirty = true;
      return i;
    },
    kill(i) { buf[i * STRIDE + 3] = 1e9; ends[i] = 0; dirty = true; },
    clear() { for (let i = 0; i < max; i++) { buf[i * STRIDE + 3] = 1e9; ends[i] = 0; } lastEnd = 0; dirty = true; },
    setAnchor(i, m) { anchors[i].copy(m); },
    setLight(sun, amb) { if (sun) shared.uSunC.value.copy(sun); if (amb) shared.uAmb.value.copy(amb); },
    setShade(k) { shared.uShade.value = k; },
    get time() { return shared.uT.value; },
    update(dt) {
      const live = lastEnd > shared.uT.value;
      if (live) shared.uT.value += dt;
      else if (shared.uT.value !== 0) { shared.uT.value = 0; lastEnd = 0; for (let i = 0; i < max; i++) { buf[i * STRIDE + 3] = 1e9; ends[i] = 0; } dirty = true; } // jam di-nol-kan saat kosong
      if (dirty) { ib.needsUpdate = true; dirty = false; }
      const on = lastEnd > shared.uT.value;
      if (meshes[0].visible !== on) meshes[0].visible = meshes[1].visible = on;
    },
    alive() { let n = 0; const T = shared.uT.value; for (let i = 0; i < max; i++) if (ends[i] > T && buf[i * STRIDE + 3] <= T) n++; return n; },
    stats() { const a = api.alive(); if (a > peak) peak = a; return { alive: a, peak, emitted }; },
    // paksa tampil satu frame (kompilasi program di muka)
    show(on) { meshes[0].visible = meshes[1].visible = on; },
  };
  return api;
}
