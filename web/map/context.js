// Lingkungan sekitar kawasan untuk game (map/world.js dengan opts.game): bangunan, jalan, sungai, taman, lahan, dan pohon
// OSM sampai ±1 km di luar batas (data/alsut-context.json dari tools/build_context.py), ditambah pengisi prosedural (rumah
// rendah & pohon) di luar cakupan ekstrak OSM. Tujuannya supaya dari darat tidak ada tebing atau kekosongan.
// Hanya tampilan: tidak masuk tabrakan dan tidak bisa dilewati (batas main tetap batas kawasan).
// Hemat draw call: lapisan datar digabung jadi 5 mesh; bangunan + rumah pengisi digabung per petak 1,5 km (satu mesh),
// pohon satu instans per petak; petak di balik kabut disembunyikan, yang di luar layar dibuang three.js. Lapisan datar
// memakai stencil "luar kawasan", jadi tidak pernah menimpa isi kawasan.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, hash01, pickOf, shadeY, swayGeo } from './world.js';

const TILE = 1500;
const LAND_COLOR = { residential: '#c3c6b3', commercial: '#c9c5bb', industrial: '#bcbab2', cemetery: '#a3b38f', grass: '#a2bf82', farmland: '#b8c189', forest: '#79a061', sand: '#d3c7a3', construction: '#cbbb98' };
const GREEN_COLOR = { park: '#86b06a', pitch: '#7cb163', forest: '#6a9655', grass: '#93bb76', cemetery: '#9cad8a', golf: '#80b663' };
const ROAD_ORDER = ['pedestrian', 'service', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway_link', 'motorway'];
const ROAD_COLOR = { motorway: '#45484e', motorway_link: '#4a4d53', trunk: '#4b4e54', primary: '#4d5056', secondary: '#50535a', tertiary: '#55585e', unclassified: '#5d6066', residential: '#5f6268', living_street: '#686b70', service: '#6e7176', pedestrian: '#b9b2a4' };
const SIDEWALK = { trunk: 2.2, primary: 2.4, secondary: 2.2, tertiary: 1.8, unclassified: 1.2, residential: 1.2 };
// sedikit lebih redup dari isi kawasan: lingkungan sekitar tidak bersaing dengan area main
const WALLS = ['#e8e3d8', '#dfdacd', '#e4ddcc', '#d9d5cb', '#ece6d9', '#d6d9dc', '#e2dccd'];
const ROOFS = ['#a35f45', '#98583f', '#8f5d47', '#a96b4e', '#6b6e74', '#5c5f66', '#7a7c80', '#b0714f'];
const FLAT_ROOFS = ['#b9bcc0', '#aeb2b7', '#c3c1ba', '#9ea8b3'];
const TALL_WALLS = ['#b2c1cd', '#a9bcc4', '#bcc5cf', '#c8ccd2'];
const NOWIN = [-1, -1, 0, -1, -1, 0, -1, -1, 0];

export async function addContext(W, url = 'data/alsut-context.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const X = await res.json();
  const { scene, renderer, C, overlay, flatGeo, ribbonGeo, stripGeo, markGeo, TEX, bMat, real } = W;
  // mode realistis: tekstur foto memberi warna; warna lahan hanya jadi tinta halus (lahan = tanah berumput, taman = rumput)
  const LAND_K = { residential: 0.95, commercial: 1.0, industrial: 0.9, cemetery: 0.9, grass: 1.0, farmland: 1.1, forest: 0.75, sand: 1.25, construction: 1.15 };
  const tintOf = (hex, k) => { const c = C(hex), mx = Math.max(c.r, c.g, c.b, 1e-3); return c.multiplyScalar(1 / mx).lerp(C('#ffffff'), 0.72).multiplyScalar(k); };
  const V2 = (flat) => { const pts = []; for (let i = 0; i + 1 < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i] * M, flat[i + 1] * M)); return pts; };
  const group = new THREE.Group();
  group.name = 'context';
  const tiles = new Map(); // petak → { x0, y0, objs, b: geometri bangunan (array), trees: [] }
  const tileOf = (x, y) => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), k = tx * 4096 + ty;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { x0: tx * TILE, y0: ty * TILE, objs: [], b: { pos: [], nor: [], col: [], wuv: [] }, trees: [] }));
    return t;
  };

  // ---------- Lapisan datar (hanya di luar kawasan): lahan+taman, air, trotoar, jalan, marka ----------
  const lay = (g, o, order) => { const m = overlay(g, { ...o, outside: true }); scene.remove(m); m.renderOrder = order; group.add(m); return m; };
  if (real) {
    lay(flatGeo(X.land.r.map((r, i) => ({ ring: V2(r), color: tintOf(LAND_COLOR[X.landTypes[X.land.t[i]]] || '#c3c6b3', LAND_K[X.landTypes[X.land.t[i]]] || 1) })), 0.03), { map: TEX.grass, surf: 'soil', pbr: { env: 0.3 } }, -46);
    lay(flatGeo(X.green.r.map((r, i) => ({ ring: V2(r), color: tintOf(GREEN_COLOR[X.greenTypes[X.green.t[i]]] || '#86b06a', 0.72) })), 0.035), { map: TEX.grass, surf: 'grass', pbr: { env: 0.3 } }, -45.9);
  } else lay(flatGeo([
    ...X.land.r.map((r, i) => ({ ring: V2(r), color: C(LAND_COLOR[X.landTypes[X.land.t[i]]] || '#c3c6b3') })),
    ...X.green.r.map((r, i) => ({ ring: V2(r), color: C(GREEN_COLOR[X.greenTypes[X.green.t[i]]] || '#86b06a') })),
  ], 0.03), { map: TEX.grass }, -46);
  const waterC = C('#4683b0');
  lay(mergeGeometries([flatGeo(X.water.map((r) => ({ ring: V2(r), color: waterC })), 0.07),
    ribbonGeo(X.waterways.r.map((r, i) => ({ pts: V2(r), w: X.waterways.w[i] * M, y: 0.08, color: waterC, cap: true })))]), { phong: true }, -45);
  const roads = [], walks = [], dashes = [], white = C(real ? '#d9d7d0' : '#eeeeea'), walkC = C(real ? '#ffffff' : '#d2ccc0');
  X.roads.r.forEach((r, i) => {
    const cls = X.classes[X.roads.c[i]], pts = V2(r), w = X.roads.w[i] * M;
    roads.push({ pts, w, y: 0.12, color: real ? C('#ffffff').multiplyScalar(cls === 'motorway' || cls === 'trunk' || cls === 'primary' ? 0.55 : 0.68) : C(ROAD_COLOR[cls] || '#5f6268'), capSeg: 4, o: ROAD_ORDER.indexOf(cls) });
    if (SIDEWALK[cls]) walks.push({ pts, w: w + SIDEWALK[cls] * 2, y: 0.11, color: walkC, capSeg: 4 });
    if (w >= 7 && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(cls)) dashes.push({ pts, w: 0.25, off: 0, dash: 3, gap: 5, trim: w * 1.1, y: 0.14, color: white });
  });
  roads.sort((a, b) => a.o - b.o); // dalam satu mesh, segitiga belakangan menimpa: jalan besar di atas
  lay(stripGeo(walks), { map: TEX.paving, surf: 'pave' }, -44.5);
  lay(stripGeo(roads), { map: TEX.asphalt, surf: 'asphalt', pbr: { env: 0.7 } }, -44);
  lay(markGeo(dashes), { opacity: 0.85 }, -43.5);

  // ---------- Bangunan OSM: prisma + atap (rumah kecil: limas); jendela dari shader gedung yang sama ----------
  function emit(o, ax, ay, ah, bx, by, bh, cx, cy, ch, n, c, w) {
    o.pos.push(ax, ah, -ay, bx, bh, -by, cx, ch, -cy);
    for (let k = 0; k < 3; k++) { o.nor.push(n[0], n[1], n[2]); o.col.push(c.r, c.g, c.b); }
    o.wuv.push(...w);
  }
  function prism(o, pts, h, wallC, roofC, k, hip) { // pts berlawanan jarum jam
    const lowC = wallC.clone().multiplyScalar(0.8);
    let per = 0, cx = 0, cy = 0;
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      cx += a.x; cy += a.y;
      if (len < 0.05) continue;
      const nx = dy / len, nz = dx / len, u0 = per, u1 = per + len;
      o.pos.push(a.x, 0, -a.y, b.x, 0, -b.y, b.x, h, -b.y, a.x, 0, -a.y, b.x, h, -b.y, a.x, h, -a.y);
      for (let q = 0; q < 6; q++) o.nor.push(nx, 0, nz);
      for (const cc of [lowC, lowC, wallC, lowC, wallC, wallC]) o.col.push(cc.r, cc.g, cc.b);
      o.wuv.push(u0, 0, k, u1, 0, k, u1, h, k, u0, 0, k, u1, h, k, u0, h, k);
      per += len;
    }
    cx /= pts.length; cy /= pts.length;
    if (hip) { // atap limas
      const rh = hip;
      for (let j = 0; j < pts.length; j++) {
        const a = pts[j], b = pts[(j + 1) % pts.length];
        const ex = (a.x + b.x) / 2 - cx, ey = (a.y + b.y) / 2 - cy, el = Math.hypot(ex, ey) || 1, s = Math.hypot(rh, el);
        emit(o, a.x, a.y, h, b.x, b.y, h, cx, cy, h + rh, [ex / el * rh / s, el / s, -ey / el * rh / s], roofC.clone().multiplyScalar(j % 2 ? 0.86 : 1), NOWIN);
      }
      return;
    }
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { tris = []; }
    for (const tr of tris) {
      const A = pts[tr[0]], Bp = pts[tr[1]], Cp = pts[tr[2]];
      if ((Bp.x - A.x) * (Cp.y - A.y) - (Bp.y - A.y) * (Cp.x - A.x) >= 0) emit(o, A.x, A.y, h, Bp.x, Bp.y, h, Cp.x, Cp.y, h, [0, 1, 0], roofC, NOWIN);
      else emit(o, A.x, A.y, h, Cp.x, Cp.y, h, Bp.x, Bp.y, h, [0, 1, 0], roofC, NOWIN);
    }
  }
  const B = X.buildings;
  for (let i = 0; i < B.r.length; i++) {
    const pts = V2(B.r[i]);
    if (pts.length < 3) continue;
    if (THREE.ShapeUtils.area(pts) < 0) pts.reverse();
    const h = B.h[i] * M, kind = B.k[i], area = THREE.ShapeUtils.area(pts);
    const r1 = hash01(pts[0].x, pts[0].y), r2 = hash01(pts[0].y + 3.1, pts[0].x);
    const wallC = C(kind === 2 ? pickOf(TALL_WALLS, r1) : pickOf(WALLS, r1));
    const roofC = C(kind === 0 ? pickOf(ROOFS, r2) : pickOf(FLAT_ROOFS, r2));
    const hip = kind === 0 && pts.length === 4 && area < 450 ? Math.min(2.4, Math.sqrt(area) * 0.16) : 0;
    prism(tileOf(pts[0].x, pts[0].y).b, pts, h, wallC, roofC, kind === 5 ? 9 : kind, hip); // jenis 5 (atap/kanopi): tanpa jendela
  }

  // ---------- Pengisi prosedural di luar cakupan ekstrak OSM: rumah rendah & pohon, makin jarang makin jauh ----------
  const cov = X.meta.coverage.map((v) => v * M), FAR = 1300, CELL = 50;
  const inCov = (x, y) => x > cov[0] && x < cov[2] && y > cov[1] && y < cov[3];
  let nFill = 0;
  for (let y = cov[1] - FAR; y < cov[3] + FAR; y += CELL) {
    for (let x = cov[0] - FAR; x < cov[2] + FAR; x += CELL) {
      const jx = x + (hash01(x, y) - 0.5) * CELL * 0.7, jy = y + (hash01(y + 7, x) - 0.5) * CELL * 0.7;
      if (inCov(jx, jy)) continue;
      const ex = Math.max(cov[0] - jx, jx - cov[2], 0), ey = Math.max(cov[1] - jy, jy - cov[3], 0), d = Math.hypot(ex, ey);
      const r = hash01(jx * 1.3, jy * 0.7);
      if (r < 0.55 - d / FAR * 0.25) {
        const w = 9 + hash01(jy, jx) * 9, dd = 8 + hash01(jx, 3) * 9, h = 4 + hash01(jy, 5) * 5, a = hash01(jx * 7, jy) * Math.PI;
        const ca = Math.cos(a), sa = Math.sin(a), pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => new THREE.Vector2(jx + (u * w * ca - v * dd * sa) / 2, jy + (u * w * sa + v * dd * ca) / 2));
        prism(tileOf(jx, jy).b, pts, h, C(pickOf(WALLS, hash01(jy, jx))), C(pickOf(ROOFS, hash01(jx, jy * 2))), 0, Math.min(2.4, Math.sqrt(w * dd) * 0.16));
        nFill++;
      } else if (r > 0.9) tileOf(jx + 9, jy - 6).trees.push([jx + 9, jy - 6, 6 + hash01(jy, jx * 2) * 4]);
    }
  }
  for (const t of tiles.values()) {
    const o = t.b;
    if (!o.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
    g.setAttribute('wuv', new THREE.Float32BufferAttribute(o.wuv, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, bMat);
    m.castShadow = m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    t.objs.push(m);
    t.b = null;
  }

  // ---------- Pohon: satu instans per petak; tajuk ikosahedron kasar + batang, warna dipanggang ----------
  const treeGeo = (() => {
    const g = mergeVertices(new THREE.IcosahedronGeometry(1, 0).deleteAttribute('normal').deleteAttribute('uv'));
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.12 * Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.z * 2.9)); p.setXYZ(i, v.x, v.y * 0.9, v.z); }
    g.computeVertexNormals();
    const crown = tint(shadeY(g.scale(0.36, 0.33, 0.36).translate(0, 0.76, 0), 0.6, 1.1), C('#5a9a45'));
    const trunk = paint(new THREE.CylinderGeometry(0.035, 0.055, 0.62, 3, 1, true).translate(0, 0.31, 0), C('#6a5440'));
    trunk.deleteAttribute('uv');
    return mergeGeometries([crown, trunk]);
  })();
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const T = X.trees, st = X.meta.treeStride || 4;
  for (let i = 0; i + 3 < T.length; i += st) {
    const x = T[i] * M, y = T[i + 1] * M, k = T[i + 2], palm = T[i + 3] === 1;
    tileOf(x, y).trees.push([x, y, (palm ? [8, 10, 12][k] : [6.5, 8, 9.5][k]) * (0.85 + 0.3 * hash01(y, x))]);
  }
  let nTrees = 0;
  {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), UPV = new THREE.Vector3(0, 1, 0);
    for (const t of tiles.values()) {
      if (!t.trees.length) continue;
      const im = new THREE.InstancedMesh(treeGeo, treeMat, t.trees.length);
      t.trees.forEach(([x, y, hh], j) => {
        const r0 = hash01(x, y), wd = hh * (0.9 + 0.25 * r0);
        im.setMatrixAt(j, m4.compose(p.set(x, 0, -y), q.setFromAxisAngle(UPV, r0 * 6.283), s.set(wd, hh, wd)));
        const v = 0.8 + 0.4 * hash01(x * 2, y), g2 = hash01(y * 3, x);
        im.setColorAt(j, c.setRGB(v * (0.92 + 0.12 * g2), v, v * (0.9 + 0.1 * g2)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      group.add(im);
      t.objs.push(im);
      nTrees += t.trees.length;
      t.trees = null;
    }
  }

  // ---------- Petak di balik kabut disembunyikan (dicek sebelum tiap render; di luar layar dibuang three.js) ----------
  const tileList = [...tiles.values()].filter((t) => t.objs.length);
  const cam = new THREE.Vector3();
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, camera2, target) {
    prev.call(this, r, s, camera2, target);
    camera2.getWorldPosition(cam);
    // ≥ 88% tertutup kabut (kabut linear near→far) sudah hampir tak terlihat
    const far = scene.fog ? scene.fog.near + (scene.fog.far - scene.fog.near) * 0.88 : Infinity, cy = -cam.z;
    for (const t of tileList) {
      const dx = Math.max(t.x0 - cam.x, 0, cam.x - t.x0 - TILE), dy = Math.max(t.y0 - cy, 0, cy - t.y0 - TILE);
      const d2 = dx * dx + dy * dy, vis = d2 < far * far;
      // dari darat, pohon lingkungan di luar ±900 m hanya titik kecil di balik bangunan → tidak digambar (hemat draw call)
      for (const o of t.objs) {
        o.visible = vis && (!o.isInstancedMesh || cam.y > 60 || d2 < 900 * 900);
        if (o.userData.gNear) { const g = d2 < 350 * 350 && cam.y < 200 ? o.userData.gNear : o.userData.gFar; if (o.geometry !== g) o.geometry = g; } // pohon: model sedang di dekat, kartu silang di kejauhan
      }
    }
  };
  // Pohon lingkungan memakai model pohon kawasan begitu termuat (tajuk kartu daun, bukan ikosahedron): LOD sedang di
  // dekat kamera, kartu silang di kejauhan. Tiap petak memakai objek geometri sendiri (atribut dipakai bersama) supaya
  // three.js tidak menyetel ulang VAO tiap draw call (InstancedMesh berbagi geometri + program, beda instanceMatrix).
  if (W.treesReady) W.treesReady.then((r) => {
    if (!r || !r.mat) return;
    const unit = (name) => { const g0 = r.geos[name]; if (!g0) return null; const g = swayGeo(g0, r.round); g.computeBoundingBox(); const k = 1 / (g.boundingBox.max.y || 1); g.scale(k, k, k); return g; };
    const kinds = ['mahoni', 'ketapang', 'trembesi', 'flamboyan'].map((nm) => [unit(nm + '_lod1'), unit(nm + '_lod2')]).filter((p) => p[0] && p[1]);
    if (!kinds.length) return;
    const wrap = (src) => { const g = new THREE.BufferGeometry(); for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]); g.setIndex(src.index); return g; };
    let i = 0;
    for (const t of tileList) for (const o of t.objs) {
      if (!o.isInstancedMesh || o.geometry !== treeGeo) continue;
      const [gn, gf] = kinds[i++ % kinds.length];
      o.userData.gNear = wrap(gn); o.userData.gFar = wrap(gf);
      o.geometry = o.userData.gFar;
      o.material = r.mat;
      o.boundingSphere = null;
      o.computeBoundingSphere();
    }
  });
  scene.add(group);
  renderer.shadowMap.needsUpdate = true;
  group.userData.info = { buildings: B.r.length, fillers: nFill, roads: X.roads.r.length, trees: nTrees, tiles: tileList.length };
  return group;
}

// Warna dipanggang ke geometri (ruang linear, sama seperti warna vertex dunia): paint = rata, tint = kalikan yang sudah ada.
function paint(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function tint(g, c) {
  const a = g.attributes.color;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * c.r, a.getY(i) * c.g, a.getZ(i) * c.b);
  return g;
}
