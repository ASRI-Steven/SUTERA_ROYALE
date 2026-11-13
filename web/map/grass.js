// Rumput tinggi (ilalang) untuk game. Peta bit dari tools/build_grass.py (OSM + lahan kosong besar).
// - at(x, y): kerapatan 0..1 di titik data (x timur, y utara, m), dipakai untuk persembunyian (jongkok/tiarap).
// - Rumpun instans hanya di sekitar kamera (≤ R m). Tiap petak 24 m memakai satu InstancedMesh dari kolam tetap
//   (satu instans = "tambalan" 3 rumpun): petak diisi SEKALI saat masuk jangkauan (≤ 4 petak per frame, 20 KB per
//   petak); saat kamera bergerak hanya jumlah instans per petak yang berubah (makin jauh makin jarang = awalan daftar
//   instans yang sudah diacak). Petak di luar pandangan dipangkas three.js (frustum). Mengecil di tepi jangkauan,
//   bergoyang tertiup angin dan rebah di dekat pemain: semuanya di shader.
//   Catatan three.js: tiap mesh kolam punya objek geometri sendiri (atributnya dipakai bersama) — InstancedMesh yang
//   berbagi geometri + program tetapi berbeda instanceMatrix membuat VAO disetel ulang pada tiap draw call.
// - Area jauh: lapisan tekstur rumput di tanah (satu draw call).
// Model rumpun bisa diganti GLB (setClumps) — bawaan: kipas bilah prosedural.
import * as THREE from 'three';

const CHUNK = 24, R = 105, R_FULL = 50;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hash(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) { // value noise halus 0..1
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Rumpun: kipas bilah melengkung (2 ruas per bilah), warna pangkal hijau tua → ujung kuning jerami; atribut 'sway' 0..1
export function clumpGeometry(seed = 1, blades = 9, height = 1.25) {
  const pos = [], col = [], sway = [], nor = [], idx = [];
  const base = new THREE.Color('#3d5a25'), mid = new THREE.Color('#6f8c38'), tip = new THREE.Color('#cdc47c'), c = new THREE.Color();
  for (let b = 0; b < blades; b++) {
    const r = (k) => hash(seed * 97 + b * 13 + k, seed * 31 + k * 7);
    const a = b / blades * Math.PI * 2 + r(1) * 0.9, lean = 0.22 + r(2) * 0.4, h = height * (0.7 + r(3) * 0.45), w = 0.035 + r(4) * 0.03;
    const ox = Math.cos(a) * 0.12 * r(5), oz = Math.sin(a) * 0.12 * r(5), dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const n0 = pos.length / 3;
    const ring = (t, width) => { // titik kiri & kanan pada ketinggian t (0..1), melengkung keluar
      const bend = lean * t * t * h, y = h * t * (1 - 0.12 * t), cx = ox + dx * bend, cz = oz + dz * bend;
      for (const s of [-1, 1]) { pos.push(cx + px * width * s, y, cz + pz * width * s); sway.push(t); c.copy(t < 0.5 ? base : mid).lerp(t < 0.5 ? mid : tip, t < 0.5 ? t * 2 : (t - 0.5) * 2); col.push(c.r, c.g, c.b); nor.push(dx * 0.35, 0.9, dz * 0.35); }
    };
    ring(0, w); ring(0.5, w * 0.7);
    const t = 1, bend = lean * h, y = h * (1 - 0.12);
    pos.push(ox + dx * bend, y, oz + dz * bend); sway.push(1); col.push(tip.r, tip.g, tip.b); nor.push(dx * 0.35, 0.9, dz * 0.35);
    idx.push(n0, n0 + 1, n0 + 3, n0, n0 + 3, n0 + 2, n0 + 2, n0 + 3, n0 + 4);
    void t;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

export function createGrass(scene, url = 'data/alsut-grass.json', real = null) { // real: mode realistis (map/realism.js)
  const api = { ready: false, at: () => 0, update() {}, setClumps() {}, stats: null };
  const uni = { uTime: { value: 0 }, uPush: { value: new THREE.Vector3(0, -99, 0) }, uCam: { value: new THREE.Vector3() } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  if (real) mat.color.set('#9c9f7c'); // mode realistis: rumput tidak neon (senada tekstur tanah foto)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.uniforms.uPush = uni.uPush;
    sh.uniforms.uCam = uni.uCam;
    sh.vertexShader = 'uniform float uTime; uniform vec3 uPush, uCam; attribute float sway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
      // jauh: rumpun lebih jarang (lihat refresh) → sedikit dibesarkan; di tepi jangkauan mengecil sampai hilang
      float dcam = distance(ip.xz, uCam.xz);
      transformed *= (1.0 + 0.14 * smoothstep(${(R_FULL - 8).toFixed(1)}, ${(R_FULL + 8).toFixed(1)}, dcam)) * clamp((${R.toFixed(1)} - dcam) / 14.0, 0.0, 1.0);
      float ph = ip.x * 0.21 + ip.z * 0.17 + uTime * 1.6;
      float sw = sway * sway;
      transformed.x += (sin(ph) * 0.11 + sin(ph * 2.3) * 0.03) * sw;
      transformed.z += cos(ph * 0.83) * 0.08 * sw;
      // rebah di dekat pemain: dorong menjauh & turunkan
      vec3 wp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
      vec2 dd = wp.xz - uPush.xz; float dl = length(dd);
      float push = (1.0 - smoothstep(0.35, 1.3, dl)) * sw;
      if (push > 0.0) { vec3 dir = vec3(dd.x, 0.0, dd.y) / max(dl, 0.001); mat3 inv = transpose(mat3(instanceMatrix)); vec3 ldir = inv * dir; float ls = 1.0 / max(0.2, length(ldir)); transformed += ldir * ls * ls * push * 0.55; transformed.y *= 1.0 - 0.45 * push; }
    `);
  };
  if (real) real.foliage(mat, { ambient: 1.35, back: 0.3 });
  // satu instans = tambalan 3 rumpun (varian berbeda, berdekatan) → sepertiga jumlah instans, variasi tetap
  const VAR = 3, OFF = [[0, 0, 0], [0.52, 0.3, 2.1], [-0.28, 0.55, 4.3]];
  function makePatch(geos) {
    const pos = [], nor = [], col = [], sw = [], idx = [];
    geos.forEach((g, k) => {
      const [ox, oz, a] = OFF[k % OFF.length], cs = Math.cos(a), sn = Math.sin(a), P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, S = g.attributes.sway, base = pos.length / 3;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), z = P.getZ(i), nx = N ? N.getX(i) : 0, nz = N ? N.getZ(i) : 0;
        pos.push(x * cs + z * sn + ox, P.getY(i), -x * sn + z * cs + oz);
        nor.push(nx * cs + nz * sn, N ? N.getY(i) : 1, -nx * sn + nz * cs);
        col.push(C ? C.getX(i) : 1, C ? C.getY(i) : 1, C ? C.getZ(i) : 1);
        sw.push(S ? S.getX(i) : 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i)); else for (let i = 0; i < P.count; i++) idx.push(base + i);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
    g.setIndex(idx);
    return g;
  }
  let patch = makePatch([0, 1, 2].map((k) => clumpGeometry(k + 1, 8 + k, 1.15 + 0.12 * k)));
  const grp = new THREE.Group(); // semua petak rumput; matriks identitas (posisi ada di matriks instans)
  grp.matrixAutoUpdate = false;
  grp.matrixWorldAutoUpdate = false;
  scene.add(grp);
  const NG = 18, CELL = CHUNK / NG, MAXI = NG * NG, POOL = 112; // 1,33 m antar-tambalan ≈ 1,7 rumpun/m² di rumput penuh
  const usePatch = (g) => { for (const k of ['position', 'normal', 'color', 'sway']) g.setAttribute(k, patch.attributes[k]); g.setIndex(patch.index); return g; };
  const free = [], used = new Map(), empty = new Set(); // kolam mesh; kunci petak → slot; petak tanpa rumput
  for (let i = 0; i < POOL; i++) {
    const im = new THREE.InstancedMesh(usePatch(new THREE.BufferGeometry()), mat, MAXI);
    im.count = 0;
    im.visible = false;
    im.matrixAutoUpdate = false;
    im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.boundingSphere = new THREE.Sphere(new THREE.Vector3(), CHUNK * 0.71 + 2.6); // + ayunan & tinggi rumpun
    grp.add(im);
    free.push({ mesh: im, n: 0, stamp: 0 });
  }
  const releaseAll = () => { for (const [key, sl] of used) { sl.mesh.visible = false; free.push(sl); used.delete(key); } };
  let G = null, lastKey = '', lastT = -1, tick = 0, pending = false;
  fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then((J) => {
    const bin = atob(J.bits), bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    G = { ...J, bits };
    const cell = J.cell, bit = (i, j) => (i < 0 || j < 0 || i >= J.nx || j >= J.ny ? 0 : (bits[(j * J.nx + i) >> 3] >> ((j * J.nx + i) & 7)) & 1);
    G.bit = bit;
    api.at = (x, y) => {
      const i = Math.floor((x - J.x0) / cell), j = Math.floor((y - J.y0) / cell);
      if (!bit(i, j)) return 0;
      const edge = bit(i + 1, j) + bit(i - 1, j) + bit(i, j + 1) + bit(i, j - 1);
      const n = vnoise(x / 13, y / 13) * 0.7 + vnoise(x / 4.5 + 31, y / 4.5 + 17) * 0.3; // petak-petak dengan celah
      return clamp((n - 0.3) / 0.22, 0, 1) * (0.55 + 0.45 * edge / 4);
    };
    api.stats = J.stats;
    api.ready = true;
    buildFar(J, bit);
    lastKey = '';
  }).catch((e) => console.warn('Rumput tinggi tidak dimuat:', e.message));

  // lapisan warna jerami (area jauh/udara): baris sel berurutan → persegi panjang
  function buildFar(J, bit) {
    const pos = [], col = [], uvs = [], c = new THREE.Color(), dry = new THREE.Color('#a9a865'), wet = new THREE.Color('#7f9447');
    for (let j = 0; j < J.ny; j++) {
      let i = 0;
      while (i < J.nx) {
        if (!bit(i, j)) { i++; continue; }
        let k = i;
        while (k + 1 < J.nx && bit(k + 1, j)) k++;
        const x0 = J.x0 + i * J.cell, x1 = J.x0 + (k + 1) * J.cell, y0 = J.y0 + j * J.cell, y1 = y0 + J.cell;
        if (real) c.setScalar(0.6 + 0.24 * vnoise(x0 / 40, y0 / 40)); // mode realistis: tekstur rumput foto, warna = tinta terang-gelap
        else c.copy(dry).lerp(wet, vnoise(x0 / 40, y0 / 40));
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) { pos.push(x, 0.04, -y); col.push(c.r, c.g, c.b); uvs.push(x, y); }
        i = k + 1;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const farBase = { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
    const m = new THREE.Mesh(g, real && real.sets.grass ? real.groundMaterial('grass', farBase, { env: 0.3 }) : new THREE.MeshLambertMaterial(farBase));
    m.receiveShadow = true;
    m.renderOrder = 1;
    scene.add(m);
    api.far = m;
  }

  // isi satu petak (cx, cy = indeks petak): instans [x, y, rot, skala] pada kisi acak, urutannya diacak supaya awalan
  // daftar mana pun tersebar merata (dipakai untuk menjarangkan petak jauh). Mengembalikan jumlah instans.
  const scratch = new Float32Array(MAXI * 4);
  function fill(cx, cy, e) {
    const d = scratch;
    let n = 0;
    for (let gy = 0; gy < NG; gy++) for (let gx = 0; gx < NG; gx++) {
      const hx = cx * 1000 + gx, hy = cy * 1000 + gy, x = cx * CHUNK + (gx + hash(hx, hy)) * CELL, y = cy * CHUNK + (gy + hash(hy, hx)) * CELL;
      const dn = api.at(x, y);
      if (dn <= 0 || hash(hx + 7, hy + 3) > dn) continue;
      d[n * 4] = x; d[n * 4 + 1] = y; d[n * 4 + 2] = hash(hx, hy + 9) * 6.283; d[n * 4 + 3] = 0.8 + 0.45 * hash(hx + 5, hy) * (0.6 + 0.4 * dn);
      n++;
    }
    if (!n || !e) return n;
    for (let i = n - 1; i > 0; i--) { // acak (Fisher–Yates, deterministik per petak)
      const j = Math.floor(hash(cx * 31 + i, cy * 17 + i * 3) * (i + 1)) * 4, k = i * 4;
      for (let q = 0; q < 4; q++) { const t = d[k + q]; d[k + q] = d[j + q]; d[j + q] = t; }
    }
    for (let i = 0; i < n; i++) {
      const r = d[i * 4 + 2], sc = d[i * 4 + 3], cs = Math.cos(r) * sc, sn = Math.sin(r) * sc, o = i * 16;
      e[o] = cs; e[o + 1] = 0; e[o + 2] = -sn; e[o + 3] = 0; e[o + 4] = 0; e[o + 5] = sc; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = sn; e[o + 9] = 0; e[o + 10] = cs; e[o + 11] = 0; e[o + 12] = d[i * 4]; e[o + 13] = 0; e[o + 14] = -d[i * 4 + 1]; e[o + 15] = 1;
    }
    return n;
  }
  const order = [];
  function refresh(cam) {
    tick++;
    pending = false;
    const ccx = Math.floor(cam.x / CHUNK), ccy = Math.floor(-cam.z / CHUNK), nr = Math.ceil(R / CHUNK);
    order.length = 0;
    for (let dy = -nr; dy <= nr; dy++) for (let dx = -nr; dx <= nr; dx++) {
      const cx = ccx + dx, cy = ccy + dy, dist = Math.hypot((cx + 0.5) * CHUNK - cam.x, (cy + 0.5) * CHUNK + cam.z);
      if (dist <= R + CHUNK * 0.71) order.push([dist, cx, cy]);
    }
    order.sort((a, b) => a[0] - b[0]); // petak terdekat diisi lebih dulu
    for (const [, cx, cy] of order) { const sl = used.get(cx * 100003 + cy); if (sl) sl.stamp = tick; }
    for (const [key, sl] of used) if (sl.stamp !== tick) { sl.mesh.visible = false; free.push(sl); used.delete(key); } // keluar jangkauan → kembali ke kolam
    let made = 0, total = 0;
    for (const [dist, cx, cy] of order) {
      const key = cx * 100003 + cy;
      if (empty.has(key)) continue;
      let sl = used.get(key);
      if (!sl) {
        if (made >= 4) { pending = true; continue; } // paling banyak 4 petak baru per frame → tidak tersendat
        if (!free.length) continue;
        const im = free[free.length - 1].mesh, n = fill(cx, cy, im.instanceMatrix.array);
        if (!n) { if (empty.size > 6000) empty.clear(); empty.add(key); continue; }
        sl = free.pop();
        sl.n = n; sl.stamp = tick;
        im.instanceMatrix.needsUpdate = true;
        im.boundingSphere.center.set((cx + 0.5) * CHUNK, 0.8, -(cy + 0.5) * CHUNK);
        used.set(key, sl);
        made++;
      }
      sl.mesh.count = Math.max(1, Math.round(sl.n * (dist < R_FULL ? 1 : dist < R * 0.8 ? 0.5 : 0.34)));
      sl.mesh.visible = true;
      total += sl.mesh.count;
    }
    api.instances = total * VAR;
  }
  api.update = (cam, time, pushPos) => {
    uni.uTime.value = time;
    uni.uCam.value.copy(cam);
    if (pushPos) uni.uPush.value.copy(pushPos); else uni.uPush.value.set(0, -99, 0);
    if (!api.ready) return;
    const key = Math.floor(cam.x / 8) + ',' + Math.floor(cam.z / 8);
    if (pending || (key !== lastKey && time - lastT > 0.15)) { lastKey = key; lastT = time; refresh(cam); }
  };
  // ganti model rumpun (mis. ilalang GLB): warna RGBA → warna RGB + atribut 'sway' (alfa = bobot goyang)
  api.setClumps = (geos) => {
    const ok = (geos || []).filter(Boolean).slice(0, VAR).map((g0) => {
      const g = g0.clone(), col = g.attributes.color;
      if (col && col.itemSize === 4) {
        const n = col.count, rgb = new Float32Array(n * 3), sw = new Float32Array(n);
        for (let i = 0; i < n; i++) { rgb[i * 3] = col.getX(i); rgb[i * 3 + 1] = col.getY(i); rgb[i * 3 + 2] = col.getZ(i); sw[i] = col.getW(i); }
        g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
        g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
      } else if (!g.attributes.sway) {
        g.computeBoundingBox();
        const pos = g.attributes.position, h = Math.max(0.01, g.boundingBox.max.y), sw = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) sw[i] = Math.max(0, pos.getY(i) / h);
        g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
      }
      return g;
    });
    if (ok.length === VAR) { patch.dispose(); patch = makePatch(ok); releaseAll(); for (const sl of free) usePatch(sl.mesh.geometry); lastKey = ''; }
  };
  return api;
}
