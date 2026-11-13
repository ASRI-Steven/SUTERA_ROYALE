// Alam Sutera 3D: penampil three.js fase 1. Hanya isi kawasan (batas "Alam Sutera" di OSM), dibuat
// sebagai diorama: lempeng berbentuk kawasan, jalan & taman dipotong tepat di batas (stencil).
// Data: web/data/alsut-map.json dari tools/build_map.py. Koordinat lokal meter: x timur, y utara.
// Dunia three.js: X = x, Y = atas, Z = −y (utara = −Z).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { UP, M, SLAB, PAL, SKY, hash01, pickOf, bounds, pip, softDot, buildWorld } from './world.js';
import { createWalk } from './walk.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

const KIND_LABEL = ['Rumah', 'Komersial', 'Gedung tinggi', 'Fasilitas umum', 'Industri / gudang', 'Atap / lainnya'];
const CAT = { // warna dari palet ASG
  belanja: { label: 'Belanja', color: '#503EBA' },
  kuliner: { label: 'Kuliner', color: '#D29F52' },
  kesehatan: { label: 'Kesehatan', color: '#C2412F' },
  pendidikan: { label: 'Pendidikan', color: '#1683E1' },
  ibadah: { label: 'Ibadah', color: '#7A74B0' },
  hotel: { label: 'Hotel', color: '#295E9F' },
  rekreasi: { label: 'Rekreasi', color: '#2E8A5B' },
  layanan: { label: 'Layanan', color: '#434456' },
  kantor: { label: 'Kantor', color: '#3D3782' },
  transport: { label: 'Transportasi', color: '#A4783D' },
};
const PHASE_LABEL = { day: 'siang', golden: 'matahari rendah', dusk: 'senja', night: 'malam' };

function loadStep(p, text) { $('loaderBar').style.width = p + '%'; if (text) $('loaderText').textContent = text; }
function loadDone() { const el = $('loader'); el.classList.add('done'); setTimeout(() => { el.hidden = true; }, 650); }
function fail(msg) { $('loaderText').textContent = msg; $('loader').classList.add('error'); }
let toastTimer = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3400); }
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('id-ID');

boot();

async function boot() {
  loadStep(8, 'Memuat data kawasan…');
  let D;
  try {
    const res = await fetch('data/alsut-map.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    D = await res.json();
  } catch (e) {
    fail(location.protocol === 'file:'
      ? 'Buka lewat server lokal: jalankan "python3 -m http.server 8765" di folder web, lalu buka http://localhost:8765.'
      : 'Data peta gagal dimuat (' + e.message + '). Coba muat ulang halaman.');
    return;
  }
  loadStep(30, 'Menyusun kawasan…');
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    start(D);
  } catch (e) {
    console.error(e);
    fail('Peta 3D gagal disusun: ' + e.message);
  }
}

function start(D) {
  let W;
  try {
    W = buildWorld(D, { host: $('scene'), progress: loadStep });
  } catch (e) {
    if (e.message === 'WEBGL') { fail('Browser atau perangkat ini tidak mendukung WebGL, jadi peta 3D tidak bisa ditampilkan.'); return; }
    throw e;
  }
  const { V2, C, boundary, boundaryHoles, bb, center, inArea, LAT, LON, B, renderer, small, scene, camera, hemi, sun, TEX, slab, floorShadow, overlay, clusterFill, clusterLines, goldEdge, nightU, skyU, bMat, geo, addBuilding, buildings, edges, lineMat, trees, lamps, skyUni, sky, dome, stars, sunDisc, cloudMat, clouds } = W;
  const host = $('scene');

  const labels = new CSS2DRenderer();
  labels.setSize(innerWidth, innerHeight);
  Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  host.appendChild(labels.domElement);

  // Waktu: "Sekarang" = jam WIB berjalan; slider/preset = jam pilihan. Matahari dihitung nyata (rumus NOAA).
  const nowMin = () => { const d = new Date(); return ((d.getUTCHours() + 7) % 24) * 60 + d.getUTCMinutes(); };
  let skyAuto = true, manualMin = 720;
  {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(params.get('jam') || '');
    if (m) { skyAuto = false; manualMin = (+m[1] % 24) * 60 + (+m[2] % 60); }
    else if (params.get('mode') === 'malam') { skyAuto = false; manualMin = 1230; }
    else if (params.get('mode') === 'siang') { skyAuto = false; manualMin = 720; }
  }
  const minutes = () => (skyAuto ? nowMin() : manualMin);
  function sunAt(min) {
    const n = new Date(), date = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, min - 7 * 60));
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const day = Math.floor((date - start) / 864e5) + 1;
    const hr = date.getUTCHours() + date.getUTCMinutes() / 60;
    const g = 2 * Math.PI / 365 * (day - 1 + (hr - 12) / 24);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = THREE.MathUtils.degToRad((hr * 60 + eq + 4 * LON) / 4 - 180);
    const lat = THREE.MathUtils.degToRad(LAT);
    const el = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
    const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
    return { el, az };
  }
  const sunDir = new THREE.Vector3(0.3, 0.8, 0.2).normalize();
  let dirty = true, labelsDirty = true, skyPhase = 'day';
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + '.' + String(m % 60).padStart(2, '0');
  function applySun() {
    const min = minutes();
    const { el, az } = sunAt(min);
    const deg = THREE.MathUtils.radToDeg(el);
    const phase = deg > 12 ? 'day' : deg > 2 ? 'golden' : deg > -6 ? 'dusk' : 'night';
    const e = phase === 'night' ? 0.9 : Math.max(el, THREE.MathUtils.degToRad(5));
    const a = phase === 'night' ? THREE.MathUtils.degToRad(315) : az; // malam: "bulan" di barat laut
    sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
    const [top, horizon, color, kSun, kSky] = SKY[phase];
    sun.color.setHex(color);
    sun.intensity = kSun;
    hemi.intensity = kSky;
    hemi.color.set(phase === 'night' ? '#aab4e6' : '#ffffff');
    scene.fog.color.set(horizon);
    skyUni.top.value.set(top);
    skyUni.horizon.value.set(horizon);
    skyU.value.set(top);
    cloudMat.color.set(phase === 'night' ? '#46506e' : phase === 'dusk' ? '#f2a888' : phase === 'golden' ? '#ffd9b0' : '#ffffff');
    cloudMat.opacity = phase === 'night' ? 0.3 : 0.85;
    stars.material.opacity = phase === 'night' ? 1 : phase === 'dusk' ? 0.35 : 0;
    stars.visible = stars.material.opacity > 0;
    sunDisc.material.color.set(phase === 'night' ? '#d6dcff' : phase === 'day' ? '#fffaf0' : '#ffb070');
    sunDisc.scale.setScalar(phase === 'night' ? 520 : 900);
    nightU.value = phase === 'night' ? 1 : phase === 'dusk' ? 0.6 : 0;
    lamps.userData.set(phase);
    goldEdge.material.emissive.set(phase === 'night' || phase === 'dusk' ? '#8a5a20' : '#000000');
    lineMat.color.set(phase === 'night' || phase === 'dusk' ? '#d3d1e7' : '#3d3782');
    lineMat.opacity = phase === 'night' ? 0.1 : 0.13;
    document.body.dataset.sky = phase;
    document.body.style.background = horizon;
    skyPhase = phase;
    $('timeText').textContent = hhmm(min);
    $('timePhase').textContent = 'WIB · ' + PHASE_LABEL[phase];
    $('timeSlider').value = String(min - (min % 5));
    refreshShadows(); // arah matahari berubah → bayangan dihitung ulang
    dirty = labelsDirty = true;
  }

  // ---------- Label ----------
  const labelObjs = [];
  function addLabel(html, cls, x, y, h, kind, data, onClick) {
    const outer = document.createElement('div');
    outer.className = 'lbl';
    const inner = document.createElement('div');
    inner.className = 'lbl-in ' + cls;
    inner.innerHTML = html;
    outer.appendChild(inner);
    if (onClick) {
      inner.addEventListener('pointerdown', (e) => e.stopPropagation());
      inner.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    }
    const o = new CSS2DObject(outer);
    o.position.set(x, h, -y);
    o.userData = Object.assign({ kind }, data);
    o.visible = false;
    scene.add(o);
    labelObjs.push(o);
    return o;
  }
  addLabel(esc(D.meta.name), 'area', center.x, center.y, 80, 'area', {});
  D.clusters.forEach((c, i) => addLabel(esc(c.name), 'cl', c.c[0] * M, c.c[1] * M, 4, 'cluster', { ha: c.ha }, () => showCluster(i, true)));
  for (const p of D.pois) {
    const cat = CAT[p.cat] || CAT.layanan;
    const html = '<span class="dot" style="background:' + cat.color + '"></span>' + esc(p.name);
    if (p.lm) addLabel(html, 'lm', p.x * M, p.y * M, (p.h ? p.h * M : 8) + 4, 'landmark', { p }, () => showPoi(p, true));
    else addLabel(html, 'poi', p.x * M, p.y * M, (p.h ? p.h * M : 4) + 3, 'poi', { p }, () => showPoi(p, true));
  }
  const layers = { clusters: true, landmarks: true, pois: true, trees: true };
  const camDist = () => camera.position.distanceTo(controls.target);
  function updateLabels() {
    if (walk && walk.active()) {
      const w = walk.pos(), close = [];
      pinSize.value = 15 * renderer.getPixelRatio();
      for (const o of labelObjs) {
        const u = o.userData;
        o.visible = false;
        if (!((u.kind === 'landmark' && layers.landmarks) || (u.kind === 'poi' && layers.pois))) continue;
        const d = Math.hypot(o.position.x - w.x, o.position.z - w.z);
        if (d < (u.kind === 'landmark' ? 450 : 170)) close.push([d, o]);
      }
      close.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < Math.min(12, close.length); i++) close[i][1].visible = true;
      return;
    }
    const cd = camDist(), near = [];
    scalePins(cd); // pin keluhan mengecil saat jauh
    for (const o of labelObjs) {
      const u = o.userData, d = camera.position.distanceTo(o.position);
      let vis = false;
      if (u.kind === 'area') vis = cd > 2700;
      else if (u.kind === 'cluster') vis = layers.clusters && ((cd < 1300 && d < 1900) || (cd < 2900 && u.ha >= 6 && d < 3600));
      else if (u.kind === 'landmark') vis = layers.landmarks && d < 9000;
      else if (u.kind === 'poi' && layers.pois && cd < 1500 && d < 1200) near.push([d, o]);
      o.visible = vis;
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(40, near.length); i++) near[i][1].visible = true;
  }

  // ---------- Kamera (gaya peta: seret = geser, klik kanan / Shift = putar) ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !RM;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.minDistance = 60;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.28;
  controls.zoomToCursor = true;
  // Bayangan: pusat & luas jendela bayangan ikut target kamera, dihitung ulang sekali saat peta berhenti.
  // Mode jelajah memberi shadowFocus: pusat di avatar, jendela kecil supaya bayangan dekat tajam.
  let walk = null, shadowFocus = null;
  function refreshShadows() {
    const f = shadowFocus && shadowFocus(), c = f ? f.c : controls.target;
    const half = f ? f.half : THREE.MathUtils.clamp(camDist() * 0.75, 350, 1900);
    sun.shadow.normalBias = f ? f.nb : 0.8;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(sunDir, 2500);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }
  controls.addEventListener('end', () => setTimeout(refreshShadows, 250)); // tunggu sisa luncuran (damping)
  const pad = 250;
  controls.addEventListener('change', () => {
    const t = controls.target;
    const cx = THREE.MathUtils.clamp(t.x, bb.minx - pad, bb.maxx + pad), cz = THREE.MathUtils.clamp(t.z, -bb.maxy - pad, -bb.miny + pad);
    if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
    t.y = 0;
    dirty = labelsDirty = true;
  });
  const fovT = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const railW = () => (innerWidth > 760 ? 356 : 0);
  function homeView() {
    const landscape = innerWidth >= innerHeight;
    const az = landscape ? Math.PI / 2 : 0, phi = 0.9; // layar lebar: utara di kanan supaya kawasan memanjang
    const ew = bb.maxx - bb.minx, ns = bb.maxy - bb.miny;
    const usable = Math.max(0.5, (innerWidth - railW() - 90) / innerWidth);
    const hor = landscape ? ns : ew, ver = (landscape ? ew : ns) * Math.cos(phi) + SLAB * Math.sin(phi);
    const d = Math.max(hor / 2 / (fovT * camera.aspect * usable), ver / 2 / fovT) * 1.08;
    // geser target sedikit ke kiri layar supaya kawasan tidak tertutup panel
    const shift = (railW() / 2 - 40) / innerWidth * 2 * d * fovT * camera.aspect;
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const t = new THREE.Vector3(center.x, 0, -center.y).addScaledVector(right, -shift);
    return { t, d, p: t.clone().add(new THREE.Vector3(Math.sin(az) * Math.sin(phi), Math.cos(phi), Math.cos(az) * Math.sin(phi)).multiplyScalar(d)) };
  }
  let anim = null;
  function animateCam(t, p, ms = 1100) {
    anim = { t0: performance.now(), ms: RM ? 0 : ms, ft: controls.target.clone(), fp: camera.position.clone(), tt: t, tp: p };
    dirty = true;
  }
  function orbitPos(t, az, phi, dist) { return t.clone().add(new THREE.Vector3(Math.sin(az) * Math.sin(phi), Math.cos(phi), Math.cos(az) * Math.sin(phi)).multiplyScalar(dist)); }
  function flyTo(x, y, dist, phi = 0.9) {
    if (walk && walk.active()) { walk.teleport(x, y); return; }
    const t = new THREE.Vector3(x, 0, -y);
    animateCam(t, orbitPos(t, controls.getAzimuthalAngle(), phi, dist));
  }
  let home = homeView();
  controls.maxDistance = home.d * 1.35; // tidak bisa menjauh sampai kawasan jadi titik kecil
  controls.target.copy(home.t);
  camera.position.copy(home.p);
  controls.update();

  // ---------- Kartu info & sorotan ----------
  let cardGo = null, hl = null;
  const hlMat = new THREE.MeshLambertMaterial({ color: PAL.hilite, emissive: 0x8a5a20, emissiveIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  function highlight(i) {
    if (hl) { scene.remove(hl); hl.geometry.dispose(); hl = null; }
    if (i === null || i === undefined || i < 0) { dirty = true; return; }
    const o = { pos: [], nor: [], col: [], wuv: [], owner: [], lines: [], kind: 0, cur: 0 };
    addBuilding(i, o, PAL.hilite);
    hl = new THREE.Mesh(geo(o.pos, o.nor, o.col, o.wuv), hlMat);
    scene.add(hl);
    dirty = true;
  }
  function openCard({ cat, catColor, title, tiles, note, go, timeline }) {
    $('cardCat').innerHTML = (catColor ? '<span class="dot" style="background:' + catColor + '"></span>' : '') + esc(cat);
    $('cardTitle').textContent = title;
    $('cardTiles').innerHTML = tiles.filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => '<div class="tile"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('');
    const tl = $('cardTimeline');
    tl.hidden = !(timeline && timeline.length);
    tl.innerHTML = (timeline || []).map(([k, v]) => '<li><span>' + esc(k) + '</span><b>' + esc(v) + '</b></li>').join('');
    $('cardNote').hidden = !note;
    $('cardNote').textContent = note || '';
    cardGo = go;
    $('cardGo').hidden = !go;
    $('cardGo').textContent = walk && walk.active() ? 'Pindah ke sini' : 'Dekati';
    $('card').hidden = false;
  }
  function closeCard() { $('card').hidden = true; highlight(null); }
  function showBuilding(i) {
    highlight(i);
    const name = B.n[String(i)] || null, kind = B.k[i], h = B.h[i] * M, lv = B.l[i], ci = B.c[i], enclave = (B.f[i] & 4) === 4;
    const pts = V2(B.r[i]), area = Math.abs(THREE.ShapeUtils.area(pts));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    openCard({
      cat: KIND_LABEL[kind] || 'Bangunan',
      title: name || (KIND_LABEL[kind] || 'Bangunan') + (ci >= 0 ? ' di ' + D.clusters[ci].name : ''),
      tiles: [['Tinggi', '±' + fmt(h) + ' m'], ['Lantai', lv ? String(lv) : 'Belum ada data'], ['Luas tapak', '±' + fmt(area) + ' m²'], ['Cluster', enclave ? 'Bukan kawasan ' + D.meta.name : ci >= 0 ? D.clusters[ci].name : 'Di luar cluster']],
      note: enclave ? 'Enclave: dikelilingi kawasan tapi bukan bagian dari ' + D.meta.name + '. Ditampilkan supaya peta tidak berlubang.'
        : lv ? null : 'Tinggi diperkirakan dari jenis dan luas bangunan, karena OSM belum punya jumlah lantainya.',
      go: () => flyTo(cx, cy, Math.max(170, h * 4)),
    });
  }
  function showCluster(i, fly) {
    highlight(null);
    const c = D.clusters[i];
    const go = () => flyTo(c.c[0] * M, c.c[1] * M, Math.max(320, Math.sqrt(c.ha * 1e4) * 2.4));
    openCard({
      cat: c.kind === 'residential' ? 'Cluster hunian' : c.kind === 'construction' ? 'Sedang dibangun' : 'Area komersial',
      title: c.name,
      tiles: [['Luas', c.ha.toLocaleString('id-ID') + ' ha'], ['Bangunan', fmt(c.nb)]],
      note: 'Batas cluster dari OpenStreetMap. Nanti diganti site plan resmi.',
      go,
    });
    if (fly) go();
  }
  function showPoi(p, fly) {
    highlight(p.b === undefined ? null : p.b);
    const cat = CAT[p.cat] || CAT.layanan;
    const go = () => flyTo(p.x * M, p.y * M, Math.max(220, (p.h || 0) * M * 5));
    openCard({
      cat: cat.label, catColor: cat.color, title: p.name,
      tiles: [['Tinggi bangunan', p.h ? '±' + fmt(p.h * M) + ' m' : null], ['Lantai', p.lv ? String(p.lv) : null]],
      go,
    });
    if (fly) go();
  }
  $('cardClose').addEventListener('click', closeCard);
  $('cardClose2').addEventListener('click', closeCard);
  $('cardGo').addEventListener('click', () => { if (cardGo) cardGo(); });

  // ---------- Klik di peta ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 600) return;
    if (walk && walk.mapClick(e.clientX, e.clientY)) return;
    if (walk && walk.walking()) return; // saat jelajah klik = kunci mouse; info lewat tombol F/E
    const pk = pickPin(e.clientX, e.clientY);
    if (pk) { showComplaint(pk, false); return; }
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets = [buildings];
    if (layers.clusters) targets.push(clusterFill);
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) { closeCard(); return; }
    const owner = hit.object.geometry.userData.owner[hit.faceIndex];
    if (hit.object === clusterFill) { if (owner >= 0) showCluster(owner, false); else closeCard(); return; }
    showBuilding(owner);
  });

  function groundAt(cx, cy) { // titik tanah (atau atap gedung) di bawah kursor, koordinat data
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(buildings, false)[0];
    if (hit) return { x: hit.point.x, y: -hit.point.z };
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y > -1e-6) return null;
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, y: -(o.z + d.z * t) };
  }

  // ---------- Panel: statistik, lapisan, waktu, kategori, cari ----------
  const nLm = D.pois.filter((p) => p.lm).length, nPoi = D.pois.length - nLm, nTree = Math.floor(D.trees.length / 3);
  $('stats').innerHTML = '<div><b>' + fmt(D.meta.areaHa || 0) + '</b><span>hektare</span></div><div><b>' + fmt(B.f.filter((f) => !(f & 4)).length) + '</b><span>bangunan</span></div><div><b>' + fmt(D.clusters.length) + '</b><span>cluster</span></div>';
  const ICON = {
    clusters: '<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    landmarks: '<path d="M6 21V8l6-4 6 4v13M10 21v-5h4v5M9 10h.01M15 10h.01M9 13h.01M15 13h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    pois: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/>',
    trees: '<circle cx="12" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 15v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  };
  const TOG = [['clusters', 'Cluster', D.clusters.length], ['landmarks', 'Landmark', nLm], ['pois', 'Fasilitas', nPoi], ['trees', 'Pohon', nTree]];
  $('toggles').innerHTML = TOG.map(([k, label, n]) =>
    '<button class="tog" type="button" role="switch" aria-checked="true" data-layer="' + k + '"><span class="ic"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' + ICON[k] + '</svg></span>' + label +
    '<span class="n">' + fmt(n) + '</span><span class="sw" aria-hidden="true"></span></button>').join('');
  $('toggles').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    const k = b.dataset.layer;
    layers[k] = !layers[k];
    b.setAttribute('aria-checked', String(layers[k]));
    trees.visible = layers.trees;
    refreshShadows();
    clusterFill.visible = clusterLines.visible = layers.clusters;
    dirty = labelsDirty = true;
  });
  $('legend').innerHTML = Object.values(CAT).map((c) => '<span><i class="dot" style="background:' + c.color + '"></i>' + c.label + '</span>').join('');
  function setPreset(btn) { for (const x of $('presets').querySelectorAll('.pill')) x.setAttribute('aria-pressed', String(x === btn)); }
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    if (b.dataset.min === 'now') skyAuto = true; else { skyAuto = false; manualMin = +b.dataset.min; }
    setPreset(b);
    applySun();
  });
  $('timeSlider').addEventListener('input', (e) => { skyAuto = false; manualMin = +e.target.value; setPreset(null); applySun(); });
  if (!skyAuto) setPreset([...$('presets').querySelectorAll('.pill')].find((x) => x.dataset.min === String(manualMin)) || null);
  setInterval(() => { if (skyAuto) applySun(); }, 60000);
  applySun();
  $('railToggle').addEventListener('click', () => {
    const open = !$('rail').classList.contains('open');
    $('rail').classList.toggle('open', open);
    $('railToggle').setAttribute('aria-expanded', String(open));
  });

  const searchItems = [
    ...D.pois.map((p) => ({ name: p.name, sub: (CAT[p.cat] || CAT.layanan).label, color: (CAT[p.cat] || CAT.layanan).color, top: !!p.lm, go: () => showPoi(p, true) })),
    ...D.clusters.map((c, i) => ({ name: c.name, sub: 'Cluster · ' + c.ha.toLocaleString('id-ID') + ' ha', color: '#D29F52', top: c.ha >= 8, go: () => showCluster(i, true) })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  let shown = [];
  function renderResults(q) {
    const s = q.trim().toLowerCase();
    const cm = !s ? [] : [...complaints.values()].filter((c) => [c.it.type, c.it.summary, c.it.no, c.it.unit].some((v) => v && v.toLowerCase().includes(s))).slice(0, 12)
      .map((c) => ({ name: (c.it.type || 'Keluhan') + (c.it.summary ? ' · ' + c.it.summary.slice(0, 40) : ''), sub: 'Keluhan · ' + STAGE[c.it.stage].label, color: STAGE[c.it.stage].color, go: () => showComplaint(c.it.key, true) }));
    shown = [...cm, ...(s ? searchItems.filter((it) => it.name.toLowerCase().includes(s)) : searchItems.filter((it) => it.top))].slice(0, 40);
    $('results').innerHTML = shown.length
      ? shown.map((it, i) => '<li><button type="button" data-i="' + i + '"><i class="dot" style="background:' + it.color + '"></i>' + esc(it.name) + '<small>' + esc(it.sub) + '</small></button></li>').join('')
      : '<li class="empty">Tidak ada tempat atau cluster dengan nama itu.</li>';
    $('results').hidden = false;
  }
  $('searchInput').addEventListener('focus', (e) => renderResults(e.target.value));
  $('searchInput').addEventListener('input', (e) => renderResults(e.target.value));
  $('results').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    $('results').hidden = true;
    $('searchInput').blur();
    shown[+b.dataset.i].go();
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.rail-search')) $('results').hidden = true; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('results').hidden = true; closeCard(); } });

  // ---------- Keluhan, respond ticket, WO (live dari BFF lewat SSE /api/stream) ----------
  // Pin digambar di WebGL (satu Points + satu LineSegments), bukan elemen HTML: ratusan pin tetap ringan saat peta digeser.
  const STAGE = {
    BARU: { label: 'Baru', color: '#E0453A' },
    RESPON: { label: 'Direspon', color: '#E88A1A' },
    WO: { label: 'WO berjalan', color: '#2F6FD6' },
    SELESAI: { label: 'Selesai', color: '#2E9A5B' },
    DITOLAK: { label: 'Ditolak', color: '#8D8E91' },
  };
  const OPEN = new Set(['BARU', 'RESPON', 'WO']);
  const stageOn = { BARU: true, RESPON: true, WO: true, SELESAI: false, DITOLAK: false };
  const complaints = new Map(); // key → { it, x, y, inside }
  const [cLat0, cLon0] = D.meta.center, cKx = D.meta.kx, cKy = D.meta.ky;
  const live = { configured: null, connected: false, lastPoll: null, error: '', reachable: true };
  const ageMs = (t) => (t ? Math.max(0, Date.now() - new Date(t).getTime()) : 0);
  const ageText = (ms) => {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return m + ' mnt';
    const h = Math.floor(m / 60);
    return h < 48 ? h + ' j ' + (m % 60) + ' mnt' : Math.floor(h / 24) + ' hari';
  };
  const overdue = (it) => OPEN.has(it.stage) && it.slaHours > 0 && ageMs(it.created) > it.slaHours * 3600000;
  const fmtTime = (t) => new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

  const PIN_H = 14, PIN_MAX = 6000;
  const pinPos = new Float32Array(PIN_MAX * 3), pinCol = new Float32Array(PIN_MAX * 3), pinFlag = new Float32Array(PIN_MAX);
  const stemPos = new Float32Array(PIN_MAX * 6), stemCol = new Float32Array(PIN_MAX * 6);
  const pinGeo = new THREE.BufferGeometry();
  pinGeo.setAttribute('position', new THREE.BufferAttribute(pinPos, 3));
  pinGeo.setAttribute('pcolor', new THREE.BufferAttribute(pinCol, 3));
  pinGeo.setAttribute('flag', new THREE.BufferAttribute(pinFlag, 1));
  pinGeo.setDrawRange(0, 0);
  const pinSize = { value: 16 * renderer.getPixelRatio() };
  const pins = new THREE.Points(pinGeo, new THREE.ShaderMaterial({
    uniforms: { uSize: pinSize },
    vertexShader: 'attribute vec3 pcolor; attribute float flag; uniform float uSize; varying vec3 vC; varying float vF;' +
      'void main(){ vC = pcolor; vF = flag; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * (flag > 0.5 ? 1.18 : 1.0); }',
    fragmentShader: 'varying vec3 vC; varying float vF;' +
      'void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;' +
      ' vec3 ring = vF > 1.5 ? vec3(1.0, 0.36, 0.30) : vec3(1.0);' +
      ' vec3 col = mix(vC, ring, smoothstep(0.58, 0.68, r));' +
      ' gl_FragColor = vec4(col, 1.0 - smoothstep(0.9, 1.0, r)); }',
    transparent: true, depthWrite: false,
  }));
  const stemGeo = new THREE.BufferGeometry();
  stemGeo.setAttribute('position', new THREE.BufferAttribute(stemPos, 3));
  stemGeo.setAttribute('color', new THREE.BufferAttribute(stemCol, 3));
  stemGeo.setDrawRange(0, 0);
  const stems = new THREE.LineSegments(stemGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
  for (const o of [pins, stems]) { o.frustumCulled = false; o.renderOrder = 10; scene.add(o); }
  let pinKeys = [];
  function rebuildPins() {
    pinKeys = [];
    let n = 0;
    const cl = new THREE.Color();
    for (const c of complaints.values()) {
      if (!c.inside || !stageOn[c.it.stage] || n >= PIN_MAX) continue;
      cl.set((STAGE[c.it.stage] || STAGE.BARU).color);
      const s = cl.clone().convertLinearToSRGB();
      pinPos.set([c.x, PIN_H, -c.y], n * 3);
      pinCol.set([s.r, s.g, s.b], n * 3);
      pinFlag[n] = overdue(c.it) ? 2 : c.it.stage === 'BARU' ? 1 : 0;
      stemPos.set([c.x, 0.3, -c.y, c.x, PIN_H, -c.y], n * 6);
      stemCol.set([cl.r, cl.g, cl.b, cl.r, cl.g, cl.b], n * 6);
      pinKeys.push(c.it.key);
      n++;
    }
    pinGeo.setDrawRange(0, n);
    stemGeo.setDrawRange(0, n * 2);
    for (const a of ['position', 'pcolor', 'flag']) pinGeo.attributes[a].needsUpdate = true;
    stemGeo.attributes.position.needsUpdate = true;
    stemGeo.attributes.color.needsUpdate = true;
    dirty = true;
  }
  function setPinHeight(h) { pins.position.y = h - PIN_H; stems.scale.y = h / PIN_H; dirty = true; } // jelajah: pin lebih rendah supaya terlihat dari jalan
  function scalePins(cd) { pinSize.value = (cd > 3000 ? 11 : cd > 1500 ? 14 : 17) * renderer.getPixelRatio(); }
  const pv = new THREE.Vector3();
  function pickPin(cx, cy) { // pilih pin terdekat dari titik klik (radius ±13 px)
    let best = null, bd = 13 * 13;
    for (let i = 0; i < pinKeys.length; i++) {
      pv.set(pinPos[i * 3], pinPos[i * 3 + 1] + pins.position.y, pinPos[i * 3 + 2]).project(camera);
      if (pv.z > 1) continue;
      const sx = (pv.x + 1) / 2 * innerWidth, sy = (1 - pv.y) / 2 * innerHeight, d = (sx - cx) ** 2 + (sy - cy) ** 2;
      if (d < bd) { bd = d; best = pinKeys[i]; }
    }
    return best;
  }
  // Cincin berdenyut (HTML) hanya untuk keluhan yang baru masuk dan yang sedang dipilih.
  function ringAt(c, cls, ms) {
    const outer = document.createElement('div');
    outer.className = 'lbl';
    const ring = document.createElement('div');
    ring.className = cls;
    ring.style.setProperty('--c', (STAGE[c.it.stage] || STAGE.BARU).color);
    outer.appendChild(ring);
    const o = new CSS2DObject(outer);
    o.position.set(c.x, PIN_H, -c.y);
    scene.add(o);
    dirty = true;
    if (ms) setTimeout(() => { scene.remove(o); dirty = true; }, ms);
    return o;
  }
  let selRing = null;
  function toastAction(msg, label, fn) {
    const el = $('toast');
    el.innerHTML = '<span>' + esc(msg) + '</span><button type="button" class="toast-btn">' + esc(label) + '</button>';
    el.hidden = false;
    el.querySelector('button').onclick = () => { el.hidden = true; fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 9000);
  }
  function placeComplaint(it) {
    const x = it.lng != null ? (it.lng - cLon0) * cKx : NaN, y = it.lat != null ? (it.lat - cLat0) * cKy : NaN;
    const c = { it, x, y, inside: Number.isFinite(x) && Number.isFinite(y) && inArea(x, y) };
    complaints.set(it.key, c);
    return c;
  }
  const itemHtml = (c) => '<button type="button" class="todo-item" data-key="' + esc(c.it.key) + '"><i class="dot" style="background:' + STAGE[c.it.stage].color +
    '"></i><span>' + esc(c.it.type || 'Keluhan') + (c.it.summary ? ' · ' + esc(c.it.summary.slice(0, 40)) : '') + '</span><small>' + STAGE[c.it.stage].label + ' · ' +
    ageText(ageMs(c.it.created)) + (overdue(c.it) ? ' · <em>lewat SLA</em>' : '') + (c.inside ? '' : ' · tanpa lokasi') + '</small></button>';
  function renderComplaintPanel() {
    const counts = {};
    let noLoc = 0;
    for (const c of complaints.values()) { counts[c.it.stage] = (counts[c.it.stage] || 0) + 1; if (!c.inside) noLoc++; }
    $('cStages').innerHTML = Object.entries(STAGE).map(([k, s]) => '<button class="stage-chip" type="button" data-stage="' + k + '" aria-pressed="' + stageOn[k] +
      '"><i class="dot" style="background:' + s.color + '"></i>' + s.label + '<b>' + fmt(counts[k] || 0) + '</b></button>').join('');
    const open = [...complaints.values()].filter((c) => OPEN.has(c.it.stage));
    const newest = open.slice().sort((a, b) => ageMs(a.it.created) - ageMs(b.it.created)).slice(0, 4);
    const seen = new Set(newest.map((c) => c.it.key));
    const todo = open.filter((c) => !seen.has(c.it.key)).sort((a, b) => (overdue(b.it) - overdue(a.it)) || (ageMs(b.it.created) - ageMs(a.it.created))).slice(0, 5);
    $('cTodo').innerHTML = !complaints.size ? '' : !open.length ? '<p class="cnote">Tidak ada keluhan terbuka.</p>'
      : '<div class="todo-h">Terbaru</div>' + newest.map(itemHtml).join('') + (todo.length ? '<div class="todo-h">Perlu tindakan</div>' + todo.map(itemHtml).join('') : '');
    $('cNoLoc').hidden = !noLoc;
    $('cNoLoc').textContent = fmt(noLoc) + ' keluhan tidak tampil di peta karena tidak punya koordinat di dalam kawasan.';
  }
  function renderLive() {
    const el = $('cLive'), t = $('cLiveText');
    if (live.connected) {
      el.dataset.state = 'on';
      const s = Math.round(ageMs(live.lastPoll) / 1000);
      t.textContent = 'Live · diperbarui ' + (s < 60 ? s + ' dtk' : ageText(s * 1000)) + ' lalu';
    } else if (!live.reachable) { el.dataset.state = 'off'; t.textContent = 'Server data keluhan (BFF) belum jalan.'; }
    else if (live.configured === false) { el.dataset.state = 'off'; t.textContent = 'BFF jalan, tapi koneksi TownshipDB belum diisi di .env.'; }
    else if (live.configured === null) { el.dataset.state = 'wait'; t.textContent = 'Menghubungkan…'; }
    else { el.dataset.state = 'err'; t.textContent = 'Gagal mengambil data keluhan' + (live.error ? ': ' + live.error.slice(0, 90) : '.'); }
  }
  function showComplaint(key, fly) {
    const c = complaints.get(key);
    if (!c) return;
    const it = c.it, st = STAGE[it.stage] || STAGE.BARU;
    highlight(null);
    if (selRing) { scene.remove(selRing); selRing = null; }
    if (c.inside) selRing = ringAt(c, 'cfresh sel', 0);
    const woDone = it.stage === 'WO' && (it.woStatus === 'FINISH' || !!it.woEnd);
    const target = it.woEstFinish || it.handlingEstFinish || null;
    const targetLate = target && OPEN.has(it.stage) && new Date(target).getTime() < Date.now();
    const WO_STATUS = { PROCESS: 'Dikerjakan', FINISH: 'Selesai' };
    const steps = [['Dibuat', it.created], ['Direspon', it.responded], ['WO dibuat', it.woDate], ['WO mulai', it.woStart], ['WO selesai', it.woEnd],
      ['Selesai', it.finished], ['Ditolak', it.rejected]];
    const plan = OPEN.has(it.stage) && target ? [['Target selesai' + (targetLate ? ' (lewat)' : ''), fmtTime(target)]] : [];
    openCard({
      cat: (woDone ? 'WO selesai · menunggu ditutup' : st.label) + (it.no ? ' · ' + it.no : '') + (it.src === 'REQ' ? ' · dari app, belum jadi tiket' : ''), catColor: st.color,
      title: it.type || 'Keluhan',
      tiles: [['Umur', ageText(ageMs(it.created))], ['Target SLA', it.slaHours > 0 ? it.slaHours + ' jam' + (overdue(it) ? ' (lewat)' : '') : null],
        ['Tim penanganan', it.assignGroup || null], ['No. WO', it.woNo || null],
        ['Status WO', it.woStatus ? (WO_STATUS[it.woStatus] || it.woStatus) : null], ['Penugasan WO', it.woAssignCount > 0 ? it.woAssignCount + ' tim/petugas' : null],
        ['Unit', it.unit || null], ['Lokasi dari', it.locSrc === 'APP' ? 'GPS app warga' : it.locSrc === 'UNIT' ? 'Lokasi unit' : 'Tidak ada']],
      timeline: steps.filter(([, t]) => t).map(([k, t]) => [k, fmtTime(t)]).concat(plan),
      note: [it.summary, it.respondNote ? 'Respond: ' + it.respondNote : '', it.woNote ? 'WO: ' + it.woNote : ''].filter(Boolean).join('\n') || null,
      go: c.inside ? () => flyTo(c.x, c.y, 260) : null,
    });
    if (fly && c.inside) flyTo(c.x, c.y, 260);
  }
  for (const id of ['cardClose', 'cardClose2']) $(id).addEventListener('click', () => { if (selRing) { scene.remove(selRing); selRing = null; dirty = true; } });
  $('cStages').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stage]');
    if (!b) return;
    stageOn[b.dataset.stage] = !stageOn[b.dataset.stage];
    rebuildPins();
    renderComplaintPanel();
  });
  $('cTodo').addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) showComplaint(b.dataset.key, true); });
  // ---------- Notifikasi keluhan baru: kartu bertumpuk di kanan atas, bunyi pendek, notifikasi desktop ----------
  const clusterRings = D.clusters.map((cl) => V2(cl.r)); // data cluster terurut dari yang terkecil
  const clusterAt = (x, y) => { for (let i = 0; i < clusterRings.length; i++) if (pip(x, y, clusterRings[i])) return D.clusters[i].name; return null; };
  let soundOn = true, audio = null, unseen = 0;
  const baseTitle = document.title;
  // Browser hanya mengizinkan suara setelah ada interaksi: siapkan AudioContext saat klik pertama.
  document.addEventListener('pointerdown', () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { audio = null; }
  }, { passive: true });
  function chime() {
    if (!soundOn || !audio || audio.state !== 'running') return;
    const t0 = audio.currentTime;
    [[880, 0], [1320, 0.13]].forEach(([f, dt]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.32);
      o.connect(g).connect(audio.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.35);
    });
  }
  const ICON_BELL = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.5A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.5L18 12.6V9a6 6 0 0 0-6-6Zm-2.2 15.5a2.3 2.3 0 0 0 4.4 0Z" fill="currentColor"/></svg>';
  const ICON_PIN = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>';
  function notify(c) {
    const it = c.it, st = STAGE[it.stage] || STAGE.BARU;
    const place = c.inside ? (clusterAt(c.x, c.y) || D.meta.name) : 'Lokasi belum diketahui';
    const jam = it.created ? new Date(it.created).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : '';
    const el = document.createElement('section');
    el.className = 'notif panel';
    el.style.setProperty('--c', st.color);
    el.innerHTML = '<div class="notif-ic">' + ICON_BELL + '</div><div class="notif-body">' +
      '<div class="notif-top"><span>Keluhan baru</span><time>' + jam + '</time></div>' +
      '<h4>' + esc(it.type || 'Keluhan') + '</h4>' + (it.summary ? '<p>' + esc(it.summary) + '</p>' : '') +
      '<div class="notif-meta">' + ICON_PIN + '<span>' + esc(place) + (it.src === 'REQ' ? ' · dari app warga' : it.no ? ' · ' + esc(it.no) : '') + '</span></div>' +
      '<div class="notif-act"><button type="button" class="btn" data-a="go">Lihat di peta</button><button type="button" class="btn ghost" data-a="x">Nanti</button></div></div>' +
      '<button type="button" class="notif-x" data-a="x" aria-label="Tutup notifikasi">×</button><span class="notif-bar" aria-hidden="true"></span>';
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    el.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'go') showComplaint(it.key, true); close(); });
    el.querySelector('.notif-bar').addEventListener('animationend', close);
    const box = $('notifs');
    box.prepend(el);
    while (box.children.length > 3) box.lastElementChild.remove();
    chime();
    if (document.hidden) {
      unseen++;
      document.title = '(' + unseen + ') ' + baseTitle;
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Keluhan baru: ' + (it.type || 'Keluhan'), { body: (it.summary ? it.summary + ' · ' : '') + place, tag: it.key });
          n.onclick = () => { window.focus(); showComplaint(it.key, true); n.close(); };
        } catch (e) { /* notifikasi desktop tidak tersedia: kartu di halaman tetap tampil */ }
      }
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { unseen = 0; document.title = baseTitle; } });
  $('cSound').addEventListener('click', () => {
    soundOn = !soundOn;
    $('cSound').setAttribute('aria-pressed', String(soundOn));
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); // izin notifikasi desktop
  });
  let liveRetry = 0;
  function connectLive() {
    let es;
    try { es = new EventSource('api/stream'); } catch (e) { live.reachable = false; renderLive(); return; }
    es.addEventListener('snapshot', (e) => {
      const d = JSON.parse(e.data);
      Object.assign(live, { configured: d.configured, connected: d.connected, lastPoll: d.lastPoll || null, error: d.error || '', reachable: true });
      complaints.clear();
      for (const it of d.items || []) placeComplaint(it);
      rebuildPins(); renderComplaintPanel(); renderLive();
    });
    es.addEventListener('delta', (e) => {
      const d = JSON.parse(e.data);
      for (const it of d.items || []) {
        const fresh = !complaints.has(it.key), c = placeComplaint(it);
        if (fresh && OPEN.has(it.stage)) {
          if (c.inside) ringAt(c, 'cfresh', 60000);
          notify(c);
        }
      }
      Object.assign(live, { connected: true, lastPoll: d.lastPoll || live.lastPoll });
      rebuildPins(); renderComplaintPanel(); renderLive();
    });
    es.addEventListener('status', (e) => {
      const d = JSON.parse(e.data);
      Object.assign(live, { configured: d.configured, connected: d.connected, lastPoll: d.lastPoll || live.lastPoll, error: d.error || '', reachable: true });
      renderLive();
    });
    es.onerror = () => {
      es.close();
      live.connected = false;
      live.reachable = false;
      renderLive();
      clearTimeout(liveRetry);
      liveRetry = setTimeout(connectLive, 20000);
    };
  }
  renderLive();
  renderComplaintPanel();
  connectLive();
  setInterval(() => { renderLive(); if (complaints.size) { renderComplaintPanel(); rebuildPins(); } }, 30000);

  // ---------- Jelajah (orang ketiga) ----------
  walk = createWalk({
    scene, camera, renderer, controls, D, inArea, bb, RM,
    toast, clusterAt, groundAt, refreshShadows,
    setShadowFocus: (fn) => { shadowFocus = fn; },
    cancelAnim: () => { anim = null; },
    cardOpen: () => !$('card').hidden,
    pins: () => {
      const out = [];
      for (const c of complaints.values()) if (c.inside && stageOn[c.it.stage]) out.push({ key: c.it.key, x: c.x, y: c.y, color: (STAGE[c.it.stage] || STAGE.BARU).color, label: c.it.type || 'Keluhan' });
      return out;
    },
    openComplaint: (key) => showComplaint(key, false),
    openPoi: (p) => showPoi(p, false),
    openBuilding: (i) => showBuilding(i),
    setPinHeight,
    onChange: () => { dirty = labelsDirty = true; },
  });
  $('walkBtn').addEventListener('click', () => walk.toggle());

  // ---------- Kontrol peta ----------
  function zoomBy(f) {
    const t = controls.target.clone(), off = camera.position.clone().sub(t);
    animateCam(t, t.clone().add(off.setLength(THREE.MathUtils.clamp(off.length() * f, controls.minDistance, controls.maxDistance))), 380);
  }
  $('zoomIn').addEventListener('click', () => zoomBy(0.62));
  $('zoomOut').addEventListener('click', () => zoomBy(1.6));
  $('tilt').addEventListener('click', () => {
    const t = controls.target.clone(), r = camDist(), toFlat = controls.getPolarAngle() > 0.4;
    animateCam(t, orbitPos(t, controls.getAzimuthalAngle(), toFlat ? 0.13 : 0.9, r), 700);
  });
  $('compass').addEventListener('click', () => {
    const t = controls.target.clone();
    animateCam(t, orbitPos(t, 0, controls.getPolarAngle(), camDist()), 700);
  });
  $('resetView').addEventListener('click', () => { home = homeView(); animateCam(home.t, home.p); });
  const needle = $('compass').querySelector('svg');
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labels.setSize(innerWidth, innerHeight);
    home = homeView();
    controls.maxDistance = home.d * 1.35;
    dirty = labelsDirty = true;
  });

  // ---------- Loop: gambar hanya saat ada perubahan ----------
  let lastLabel = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const walking = walk.active();
    if (walking) { walk.update(now); dirty = labelsDirty = true; } else if (anim) {
      const k = anim.ms ? Math.min(1, (now - anim.t0) / anim.ms) : 1, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      controls.target.lerpVectors(anim.ft, anim.tt, e);
      camera.position.lerpVectors(anim.fp, anim.tp, e);
      if (k >= 1) { anim = null; refreshShadows(); }
      dirty = labelsDirty = true;
    }
    if (!walking && controls.update()) dirty = labelsDirty = true;
    if (!dirty) return;
    sky.position.copy(camera.position);
    sunDisc.position.copy(camera.position).addScaledVector(sunDir, 12000);
    if (labelsDirty && now - lastLabel > 120) { updateLabels(); lastLabel = now; labelsDirty = false; }
    needle.style.transform = 'rotate(' + (walking ? walk.azimuth() : controls.getAzimuthalAngle()) + 'rad)';
    $('tilt').textContent = controls.getPolarAngle() > 0.4 ? '2D' : '3D';
    renderer.render(scene, camera);
    labels.render(scene, camera);
    dirty = !!anim || labelsDirty;
  }
  loadStep(100, 'Siap');
  requestAnimationFrame((t) => { frame(t); requestAnimationFrame(loadDone); });
  if (small) toast('Mode ringan: bayangan dimatikan di layar kecil.');
}
