// Kendaraan Sutera Royale: Sutera Lintas (hatchback), Banteng 4x4, Walet 150 (motor matic), Bus Sutera Loop.
// Model GLB dari Blender (web/game/assets/vehicles, lihat tools/blender/vehicles.py); kalau belum ada, model kotak sederhana.
// Fisika arcade: setir model sepeda, selip saat rem tangan, boost, lebih lambat di luar jalan; tabrakan dengan gedung,
// pohon, tepi kawasan, dan kendaraan lain; menabrak orang; tertembak → berasap → terbakar → meledak (bangkai tetap ada).
// Kursi: v.occ[0] = sopir (= v.driver), v.occ[1..] = penumpang (jok seat_p1.. di manifest). Bot hanya naik kendaraan kosong
// sebagai sopir; pemain bisa jadi penumpang dan pindah kursi. Tanpa sopir kendaraan meluncur lalu berhenti.
// Koordinat: data x timur, y utara (m). Dunia three.js: X = x, Y = tinggi, Z = −y. yaw: depan = (sin yaw, cos yaw) di XZ.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as audio from './audio.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a);
const pickA = (a) => a[Math.random() * a.length | 0];
const ASSET = 'game/assets/vehicles/';

// maxSpeed m/dtk (125 km/j = 34,7), accel/brake m/dtk², steerMax rad, grip = redaman selip samping (1/dtk),
// offroad = pengali kecepatan di luar jalan, mass relatif (tabrakan), camDist = jarak kamera kejar
export const TYPES = {
  lintas: { name: 'Sutera Lintas', short: 'Lintas', kind: 'car', hp: 1000, maxSpeed: 34.7, reverse: 9, accel: 7.8, brake: 17, steerMax: 0.58, wheelbase: 2.5, length: 4.0, width: 1.72, height: 1.52,
    grip: 9, offroad: 0.7, mass: 1, enclosed: true, camDist: 6.8, gears: 5, count: 22, sound: 'car', colors: ['#c9ccd2', '#2b2f38', '#a3242a', '#e8e6df', '#503EBA', '#D29F52'] },
  banteng: { name: 'Banteng 4x4', short: 'Banteng', kind: 'car', tread: 'mud', hp: 1500, maxSpeed: 30.6, reverse: 8, accel: 7.0, brake: 16, steerMax: 0.55, wheelbase: 2.65, length: 4.3, width: 1.9, height: 1.95,
    grip: 10, offroad: 0.95, mass: 1.5, enclosed: false, camDist: 7.4, gears: 5, count: 12, sound: 'truck', colors: ['#5b6b4a', '#8a7a5c', '#3d4a3a', '#b5651d', '#2f3136', '#D29F52'] },
  walet: { name: 'Walet 150', short: 'Walet', kind: 'bike', hp: 450, maxSpeed: 32, reverse: 2.5, accel: 9.8, brake: 15, steerMax: 0.62, wheelbase: 1.3, length: 1.9, width: 0.72, height: 1.12,
    grip: 11, offroad: 0.74, mass: 0.35, enclosed: false, camDist: 4.4, gears: 0, count: 20, sound: 'bike', colors: ['#e8e6df', '#1d1f24', '#a3242a', '#2a6fb0', '#503EBA', '#D29F52'] },
  loop: { name: 'Sutera Loop', short: 'Loop', kind: 'bus', hp: 2600, maxSpeed: 22.2, reverse: 5, accel: 3.8, brake: 10, steerMax: 0.5, wheelbase: 3.9, length: 7.4, width: 2.3, height: 2.85,
    grip: 8, offroad: 0.6, mass: 3.5, enclosed: true, camDist: 12.5, gears: 4, count: 4, sound: 'bus', colors: ['#c3262e'] },
  // supercar 2 pintu (langka, dekat mal): sangat cepat & mencengkeram tapi rapuh
  halilintar: { name: 'Halilintar', short: 'Halilintar', kind: 'car', recline: 0.45, paint0: 0.6, hp: 650, maxSpeed: 75, reverse: 9, accel: 15, brake: 24, steerMax: 0.5, wheelbase: 2.62, length: 4.55, width: 1.93, height: 1.17,
    grip: 13, offroad: 0.45, mass: 1.1, enclosed: true, camDist: 6.6, gears: 7, count: 8, near: 'mall', sound: 'super', colors: ['#f7c200', '#1b1c20', '#ecebe6', '#c4161c', '#1f63d6', '#503EBA'] },
  // motor cruiser V-twin: lebih berat dari skuter, pengendara & pembonceng terbuka
  jawara: { name: 'Jawara', short: 'Jawara', kind: 'bike', hp: 600, maxSpeed: 50, reverse: 2.5, accel: 11, brake: 16, steerMax: 0.55, wheelbase: 1.665, length: 2.4, width: 0.93, height: 1.39,
    grip: 11, offroad: 0.6, mass: 0.5, enclosed: false, camDist: 4.8, gears: 5, count: 8, sound: 'cruiser', colors: ['#c9ccd2', '#16171a', '#7a1f1f', '#1f3a5f', '#D29F52'] },
};
// kursi = tata letak fisik: motor 2 (pengendara + pembonceng), mobil 2 pintu 2, mobil 4 pintu 4, trem = bangkunya
const SEATS = { lintas: 4, banteng: 4, walet: 2, loop: 12, halilintar: 2, jawara: 2 };
const NO_INPUT = { throttle: 0, steer: 0, handbrake: true, boost: false };
// tanpa pengemudi (turun / tewas / hangus): rem penuh dengan cengkeraman ban penuh — berhenti ±1 dtk, lurus, tidak
// menyelonong menyamping seperti rem tangan (yang dulu menabrak orang yang baru turun)
const PARK = { throttle: 0, steer: 0, handbrake: false, boost: false, park: true };

// ---------- Model ----------
function softTex(inner, outer, size = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}
// model cadangan (kotak) bila GLB belum tersedia: struktur & nama simpul sama dengan kontrak GLB
function fallbackModel(id) {
  const T = TYPES[id], L = T.length, W = T.width, H = T.height, root = new THREE.Group();
  const mat = (name, color, o = {}) => Object.assign(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o }), { name });
  const paint = mat('paint', T.colors[0], { roughness: 0.4 }), glass = mat('glass', '#1c2433', { roughness: 0.1 }), trim = mat('trim', '#24262c', { roughness: 0.8 });
  const tire = mat('tire', '#1a1a1d', { roughness: 0.9 }), rim = mat('rim', '#b8bcc6', { metalness: 0.6, roughness: 0.35 });
  const head = mat('light_head', '#fff6dc', { emissive: '#fff1c8', emissiveIntensity: 1.2 }), tail = mat('light_tail', '#b0141c', { emissive: '#ff2a2a', emissiveIntensity: 0.8 });
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); body.add(o); return o; };
  const R = id === 'walet' ? 0.26 : id === 'banteng' ? 0.42 : id === 'loop' ? 0.48 : 0.31;
  if (T.kind === 'bike') {
    box(0.34, 0.32, 1.2, 0, 0.5, -0.05, paint); box(0.3, 0.12, 0.62, 0, 0.78, -0.2, trim); box(0.4, 0.5, 0.3, 0, 0.75, 0.5, paint);
    box(0.12, 0.08, 0.06, 0, 0.85, 0.66, head); box(0.16, 0.06, 0.04, 0, 0.72, -0.66, tail);
  } else {
    const ch = T.kind === 'bus' ? H * 0.9 : H * 0.55;
    box(W, ch - R * 0.6, L, 0, R * 0.6 + (ch - R * 0.6) / 2, 0, paint);
    if (T.kind === 'bus') { box(W + 0.02, H * 0.32, L * 0.86, 0, H * 0.66, 0, glass); box(W, 0.12, L, 0, H, 0, paint); }
    else if (T.enclosed) { box(W * 0.9, H - ch, L * 0.52, 0, ch + (H - ch) / 2, -L * 0.06, glass); box(W * 0.88, 0.06, L * 0.5, 0, H, -L * 0.06, paint); }
    else { box(0.08, H - ch, 0.08, W * 0.42, ch + (H - ch) / 2, -0.3, trim); box(0.08, H - ch, 0.08, -W * 0.42, ch + (H - ch) / 2, -0.3, trim); box(W * 0.9, 0.08, 0.08, 0, H, -0.3, trim); }
    box(W * 0.22, 0.12, 0.05, W * 0.33, ch * 0.8, L / 2, head); box(W * 0.22, 0.12, 0.05, -W * 0.33, ch * 0.8, L / 2, head);
    box(W * 0.2, 0.1, 0.05, W * 0.36, ch * 0.8, -L / 2, tail); box(W * 0.2, 0.1, 0.05, -W * 0.36, ch * 0.8, -L / 2, tail);
  }
  const wheel = (name, x, z) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, R, z);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T.kind === 'bike' ? 0.1 : 0.24, 18).rotateZ(Math.PI / 2), tire);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, T.kind === 'bike' ? 0.11 : 0.25, 10).rotateZ(Math.PI / 2), rim);
    g.add(t, r);
    root.add(g);
  };
  const wb = T.wheelbase / 2, tr = (W - 0.25) / 2;
  if (T.kind === 'bike') { wheel('wheel_f', 0, wb); wheel('wheel_r', 0, -wb); }
  else { wheel('wheel_fl', tr, wb); wheel('wheel_fr', -tr, wb); wheel('wheel_rl', tr, -wb); wheel('wheel_rr', -tr, -wb); }
  const empty = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); root.add(o); };
  if (T.kind === 'bike') { empty('seat_driver', 0, 0.8, -0.2); empty('eye_driver', 0, 1.55, -0.1); }
  else if (T.kind === 'bus') { empty('seat_driver', W * 0.28, 1.15, L / 2 - 1.2); empty('eye_driver', W * 0.28, 2.0, L / 2 - 1.0); }
  else { empty('seat_driver', W * 0.22, R + 0.25, 0.05); empty('eye_driver', W * 0.22, R + 0.95, 0.1); }
  empty('exit_l', W / 2 + 0.9, 0, T.kind === 'bus' ? L / 2 - 1.4 : 0.1);
  empty('exit_r', -W / 2 - 0.9, 0, T.kind === 'bus' ? L / 2 - 1.4 : 0.1);
  empty('exhaust', -W * 0.3, 0.3, -L / 2);
  return root;
}
// ---------- Tampilan realistis (v3) ----------
// Tiap kendaraan digambar dengan sedikit draw call: semua bagian statis digabung menjadi tiga mesh per simpul bergerak —
//   *_paint : cat clearcoat (MeshPhysicalMaterial, satu material per kendaraan: warna + lampu rem ikut di sini),
//   *_uni   : SEMUA bagian tak tembus lain (krom, velg, ban, plastik, jok, lampu, pelat…) dengan satu material standar;
//             warna, kekasaran, logam & pijar disimpan per verteks,
//   *_glass : kaca & kaca lampu (satu material transparan; warna & opasitas per verteks).
// Mobil = cat + uni + kaca + 4 roda = 7 draw call (LOD0); LOD1 = 1 mesh (> ±60 m). Atribut verteks:
//   vcol = (albedo dikodekan akar, a: uni/cat = boleh berdebu · kaca = opasitas · LOD1 = topeng cat)
//   vao  = (oklusi ambien hasil bake Blender, kekasaran, logam, pijar/16)
// Shader tambahan: celah panel dari bidang di ruang objek (manifest.gaps, tanpa segitiga), debu di bagian bawah, serpih
// metalik, peta normal tapak ban, kaca yang pantulan langitnya tidak ikut pudar, roda digelapkan di dalam spatbor.
// Dipakai game (createVehicles) dan garasi.html (loadVehicleTemplates + instantiateVehicle).
const VEH_VS_PARS = 'attribute vec4 vao;\nattribute vec4 vcol;\nvarying vec4 vVao;\nvarying vec4 vVcol;\nvarying vec3 vObjP;\n#ifdef VEH_WHEEL\nvarying float vWheelH;\n#endif\n';
const VEH_VS = '\n  vVao = vao; vVcol = vcol; vObjP = position;\n#ifdef VEH_WHEEL\n  vWheelH = (modelMatrix * vec4(transformed, 1.0)).y - modelMatrix[3].y;\n#endif\n';
const VEH_FS_PARS = `varying vec4 vVao;
varying vec4 vVcol;
varying vec3 vObjP;
uniform vec4 uVeh;  // y = banyak debu, z = tinggi debu (m), w = jari-jari roda
uniform vec2 uVehE; // x = pijar lampu rem, y = pengali pijar lampu lain
#ifdef VEH_WHEEL
varying float vWheelH;
#endif
#if VEH_GAPS > 0
uniform vec4 uGapA[VEH_GAPS];
uniform vec4 uGapB[VEH_GAPS];
#endif
float vehHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vehNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vehHash(i), vehHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(vehHash(i + vec3(0.0, 1.0, 0.0)), vehHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(vehHash(i + vec3(0.0, 0.0, 1.0)), vehHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(vehHash(i + vec3(0.0, 1.0, 1.0)), vehHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;
const VEH_FS_COLOR = `
  float vehGap = 0.0, vehDirt = 0.0, vehTail = 0.0, vehMask = vVcol.a;
  vec3 vehAlb = vVcol.rgb * vVcol.rgb;
#if defined( VEH_PAINT )
  vehTail = step(0.5, vVao.w); // lampu rem ikut mesh cat (pijarnya per kendaraan)
  diffuseColor.rgb = mix(diffuseColor.rgb, vehAlb, vehTail);
  vehMask = 1.0 - vehTail;
#elif defined( VEH_LOD )
  diffuseColor.rgb = mix(vehAlb, diffuseColor.rgb, vVcol.a);
#else
  diffuseColor.rgb = vehAlb;
#endif
#ifdef VEH_GLASS
  diffuseColor.a = vVcol.a;
#endif
#ifdef VEH_BURNT
  diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)) * 0.022 + 0.003); // hangus: arang
#endif
#if VEH_GAPS > 0
  { // celah panel: garis gelap selebar ±5 mm pada bidang di ruang objek, dihaluskan menurut ukuran piksel
    vec3 gp = vec3(abs(vObjP.x), vObjP.y, vObjP.z), gw = max(fwidth(vObjP), vec3(1e-5));
    for (int i = 0; i < VEH_GAPS; i++) {
      vec4 A = uGapA[i], B = uGapB[i];
      float c, aa; vec2 o;
      if (A.x < 0.5) { c = gp.x; aa = gw.x; o = gp.yz; } else if (A.x < 1.5) { c = gp.y; aa = gw.y; o = gp.xz; } else { c = gp.z; aa = gw.z; o = gp.xy; }
      float inb = step(B.x, o.x) * step(o.x, B.y) * step(B.z, o.y) * step(o.y, B.w);
      vehGap = max(vehGap, inb * clamp((A.z + 0.5 * aa - abs(c - A.y)) / aa, 0.0, min(1.0, 2.0 * A.z / aa)));
    }
    vehGap *= vehMask;
  }
#endif
#ifdef VEH_DIRT
  {
    float dn = vehNoise(vObjP * vec3(9.0, 13.0, 6.0)) * 0.65 + vehNoise(vObjP * 37.0) * 0.35;
  #ifdef VEH_WHEEL
    vehDirt = uVeh.y * vehMask * (0.3 + 0.7 * dn);
  #else
    vehDirt = uVeh.y * vehMask * (1.0 - smoothstep(0.02, uVeh.z, vObjP.y - dn * 0.16)) * (0.45 + 0.55 * dn);
  #endif
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.175, 0.15, 0.12), vehDirt * 0.8);
  }
#endif
  diffuseColor.rgb *= 1.0 - 0.92 * vehGap;
`;
const VEH_FS_ROUGH = `
#if defined( VEH_PAINT )
  roughnessFactor = mix(roughnessFactor, 0.3, vehTail);
#else
  roughnessFactor = vVao.y;
#endif
  roughnessFactor = mix(roughnessFactor, 0.92, max(vehDirt * 0.85, vehGap));
#ifdef VEH_BURNT
  roughnessFactor = 1.0;
#endif
`;
const VEH_FS_METAL = `
#if defined( VEH_PAINT )
  metalnessFactor *= 1.0 - vehTail;
#else
  metalnessFactor = vVao.z;
#endif
  metalnessFactor *= (1.0 - vehDirt) * (1.0 - vehGap);
#ifdef VEH_BURNT
  metalnessFactor = 0.0;
#endif
`;
const VEH_FS_EMIS = `
#if defined( VEH_PAINT )
  totalEmissiveRadiance += vehTail * vec3(1.0, 0.018, 0.008) * uVehE.x;
#elif !defined( VEH_BURNT )
  totalEmissiveRadiance += diffuseColor.rgb * (vVao.w * 16.0 * uVehE.y);
#endif
`;
const VEH_FS_FLAKE = `
#ifdef VEH_FLAKE
  { // serpih metalik: normal lapisan dasar diacak per sel ±1,5 mm; hilang saat sel lebih kecil dari piksel
    float fd = (1.0 - clamp(length(fwidth(vObjP)) * 130.0, 0.0, 1.0)) * (1.0 - vehTail);
    if (fd > 0.0) { vec3 fq = floor(vObjP * 700.0); normal = normalize(normal + (vec3(vehHash(fq), vehHash(fq + 7.1), vehHash(fq + 13.7)) - 0.5) * (0.07 * fd)); }
  }
#endif
`;
const VEH_FS_COAT = `
#ifdef USE_CLEARCOAT
  material.clearcoatF0 = vec3(0.06); // pernis sedikit lebih memantul dari kaca biasa: pantulan langit terbaca di warna terang
  material.clearcoat *= (1.0 - vehGap) * (1.0 - 0.75 * vehDirt) * (1.0 - vehTail);
  material.clearcoatRoughness = min(1.0, material.clearcoatRoughness + vehDirt * 0.4);
#endif
`;
const VEH_FS_LIGHT = `
#ifndef VEH_GLASS
  {
    float vehHard = 1.0;
  #ifdef VEH_WHEEL
    vehHard = mix(1.0, 0.2, smoothstep(0.2 * uVeh.w, 0.8 * uVeh.w, vWheelH)); // bagian roda di dalam spatbor
  #endif
    float vehOcc = vVao.x * vehHard, vehDir = mix(1.0, vVao.x, 0.55) * vehHard;
    reflectedLight.indirectDiffuse *= vehOcc;
    reflectedLight.indirectSpecular *= mix(1.0, vehOcc, 0.9);
    reflectedLight.directDiffuse *= vehDir;
    reflectedLight.directSpecular *= vehDir;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= mix(1.0, vehOcc, 0.9);
    clearcoatSpecularDirect *= vehDir;
  #endif
  }
#endif
`;
const VEH_FS_GLASS = `
#ifdef VEH_GLASS
  { // kaca: pantulan ditambahkan utuh, warna kaca mengikuti opasitas; makin landai makin memantul (Fresnel)
    float gf = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 5.0);
    float ga = clamp(diffuseColor.a + (1.0 - diffuseColor.a) * (0.9 * gf + max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b)), 0.0, 1.0);
    outgoingLight = (totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance) / max(ga, 1e-3);
    diffuseColor.a = ga;
  }
#endif
`;
function vehPatch(m, o = {}) {
  const U = { uVeh: { value: new THREE.Vector4(1, o.dirt ?? 0, o.dirtH ?? 0.5, o.wheelR ?? 0.3) }, uVehE: { value: new THREE.Vector2(0.9, 1) } };
  const gaps = o.gaps || [];
  m.defines = Object.assign(m.defines || {}, { VEH_GAPS: gaps.length });
  for (const f of o.flags || []) m.defines['VEH_' + f] = '';
  if (gaps.length) {
    U.uGapA = { value: gaps.map((g) => new THREE.Vector4(g[0], g[1], g[2], 0)) };
    U.uGapB = { value: gaps.map((g) => new THREE.Vector4(g[3], g[4], g[5], g[6])) };
  }
  m.userData.veh = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = VEH_VS_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + VEH_VS);
    sh.fragmentShader = VEH_FS_PARS + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>' + VEH_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>' + VEH_FS_ROUGH)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + VEH_FS_METAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + VEH_FS_EMIS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + VEH_FS_FLAKE)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>' + VEH_FS_COAT)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#ifdef USE_CLEARCOAT\n  clearcoatRadiance *= 1.25; // pantulan langit di pernis sedikit dikuatkan (tanpa SSR, ini yang membuat cat terbaca mengkilap)\n#endif\n')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + VEH_FS_LIGHT)
      .replace('#include <opaque_fragment>', VEH_FS_GLASS + '#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'veh3';
  return m;
}
// peta normal ban (dibuat sekali): u = keliling (berulang), v = 0–0,25 dinding samping · 0,25–0,75 tapak · 0,75–1 dinding.
// Texel (0,0) rata: mesh tanpa UV (badan) memakai material yang sama tanpa terpengaruh.
const TREAD = {};
function treadTex(kind) {
  if (TREAD[kind]) return TREAD[kind];
  const W = 256, H = 256, h = new Float32Array(W * H), sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const gr = (x, c, w) => sm(w * 0.5, w * 0.5 + 0.014, Math.abs(x - c)); // 0 di dasar alur, 1 di permukaan blok
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    let k;
    if (v > 0.25 && v < 0.75) {
      const t = (v - 0.25) / 0.5;
      if (kind === 'mud') { // blok besar berselang-seling + alur tengah
        const uu = (u * 2 + (t < 0.5 ? 0 : 0.5)) % 1;
        k = Math.min(gr(uu, 0.5, 0.38), gr(t, 0.5, 0.11));
      } else if (kind === 'moto') { // alur tengah + sirip serong
        const d = (u * 3 + Math.abs(t - 0.5) * 2.4) % 1, e = Math.abs(t - 0.5);
        k = Math.min(gr(t, 0.5, 0.05), e > 0.07 && e < 0.44 ? gr(d, 0.5, 0.2) : 1);
      } else { // jalan raya: 4 alur keliling, kembang bahu, sipe serong di rusuk tengah
        k = Math.min(gr(t, 0.2, 0.05), gr(t, 0.4, 0.05), gr(t, 0.6, 0.05), gr(t, 0.8, 0.05));
        if (t < 0.2 || t > 0.8) k = Math.min(k, gr((u * 4) % 1, 0.5, 0.2));
        else k = Math.min(k, 0.6 + 0.4 * gr((u * 6 + t * 3) % 1, 0.5, 0.12));
      }
    } else { // dinding samping: rusuk pelindung, pita huruf timbul, rusuk radial halus dekat bahu
      const sdw = v < 0.5 ? v / 0.25 : (1 - v) / 0.25;
      k = 0.5 + 0.3 * (1 - gr(sdw, 0.22, 0.05)) + 0.22 * sm(0.4, 0.44, sdw) * (1 - sm(0.62, 0.66, sdw)) * ((u * 3) % 1 < 0.7 ? 1 : 0)
        + 0.2 * sm(0.74, 0.8, sdw) * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 36));
      if (sdw < 0.06) k = 0.5;
    }
    h[y * W + x] = k;
  }
  const d = new Uint8Array(W * H * 4), S = 2.6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hx = h[y * W + ((x + W - 1) % W)] - h[y * W + ((x + 1) % W)], hy = h[Math.max(0, y - 1) * W + x] - h[Math.min(H - 1, y + 1) * W + x];
    const nx = hx * S, ny = hy * S, il = 1 / Math.hypot(nx, ny, 1), i = (y * W + x) * 4;
    d[i] = (nx * il * 0.5 + 0.5) * 255; d[i + 1] = (ny * il * 0.5 + 0.5) * 255; d[i + 2] = (il * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return (TREAD[kind] = t);
}
// Tampilan per nama material GLB → ember (b), warna (c, linear), kekasaran (r), logam (m), pijar (e, ×16), boleh berdebu
// (d), opasitas kaca (a), pengali AO (k: kabin tertutup lebih teduh).
function matLook(name, src, T) {
  const col = src && src.color ? src.color : new THREE.Color('#888888'), sr = src && src.roughness !== undefined ? src.roughness : 0.5, sm = src && src.metalness !== undefined ? src.metalness : 0;
  const L = (b, c, r, m, e = 0, d = 1, a = 1, k = 1) => ({ b, c: c.isColor ? c : new THREE.Color(c), r, m, e, d, a, k });
  const cab = T.enclosed ? 0.8 : 1;
  switch (name) {
    case 'paint': return L('paint', '#ffffff', 0.5, 0, 0, 1);
    case 'light_tail': return L('paint', '#2a0303', 0.3, 0, 1, 0);
    case 'glass': return L('glass', '#05080b', 0.02, 0, 0, 0, 0.4);
    case 'lens': return L('glass', '#f4f8fa', 0.03, 0, 0, 0, 0.08);
    case 'lens_red': return L('glass', '#4a0202', 0.05, 0, 0.012, 0, 0.72);
    case 'paint2': return sm >= 0.25 ? L('uni', col, 0.3, 0.85) : L('uni', col, 0.2, 0);
    case 'chrome': return L('uni', '#f2f3f5', 0.06, 1, 0, 0);
    case 'rim': return L('uni', col, clamp(sr * 0.8, 0.2, 0.42), 1);
    case 'disc': return L('uni', '#a5a8ad', 0.34, 1, 0, 0);
    case 'caliper': return L('uni', col, 0.3, 0.1, 0, 0);
    case 'tire': return L('uni', '#0e0e0f', 0.86, 0);
    case 'trim': return L('uni', col, clamp(sr, 0.35, 0.8), sm >= 0.25 ? sm : 0); // juga cat sekunder (trem: hijau atas)
    case 'interior': return L('uni', col, 0.82, 0, 0, 0, 1, cab);
    case 'seat': return L('uni', col, 0.58, 0, 0, 0, 1, cab);
    case 'plate': return L('uni', col, 0.4, 0, 0, 0); // pelat nomor; di trem = krem atap
    case 'text': return L('uni', '#0e0e10', 0.6, 0, 0, 0);
    case 'screen': return L('uni', '#49c6ff', 0.15, 0, 0.045, 0); // layar panel instrumen: berpijar lembut
    case 'light_head': return L('uni', '#fff0d2', 0.25, 0, 0.15, 0);
    case 'light_ind': return L('uni', '#c8760a', 0.3, 0, 0.03, 0);
    default: return L('uni', col, sr, sm);
  }
}
// konteks tampilan: semua material yang dibuat didaftarkan supaya peta lingkungan & bayangan dinamis bisa dipasang belakangan
export function createVehicleLook(env) {
  const L = { env, R: null, all: new Set() };
  const reg = (m, envI, dyn = true) => {
    m.envMap = L.env; m.envMapIntensity = envI;
    m.userData.vehDyn = dyn;
    L.all.add(m);
    if (L.R && dyn) { L.R.patch(m, { dyn: true }); m.userData.vehDynOn = true; }
    return m;
  };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const base = (T, meta) => ({ dirt: meta.dirt ?? 0.5, dirtH: T.kind === 'bus' ? 0.75 : 0.5, wheelR: meta.wheelRadius || 0.3 });
  // cat clearcoat (satu per kendaraan): warna + lampu rem (uVehE.x)
  L.paint = (T, meta, color) => {
    const ps = meta.paintSrc || {}, satin = (ps.clearcoat ?? 1) < 0.5; // cat doff (4x4): pernis tipis & kasar
    const pm = ps.metalness ?? 0.25; // cat krom (tangki cruiser) tetap logam; warna pekat lain: logam rendah supaya warnanya jenuh
    const m = new THREE.MeshPhysicalMaterial({ color, metalness: satin ? 0.15 : pm >= 0.8 ? 0.85 : clamp(pm, 0.2, 0.45), roughness: satin ? 0.62 : clamp((ps.roughness ?? 0.35) + 0.14, 0.3, 0.55),
      clearcoat: satin ? 0.3 : 1, clearcoatRoughness: satin ? 0.35 : 0.04 });
    m.color.multiplyScalar(PAINT_K);
    m.name = 'paint';
    vehPatch(m, { ...base(T, meta), gaps: meta.gaps, flags: satin ? ['PAINT', 'DIRT'] : ['PAINT', 'DIRT', 'FLAKE'] });
    return reg(m, satin ? 0.8 : 1.25);
  };
  // semua bagian tak tembus lain (per jenis kendaraan; roda: versi yang digelapkan di dalam spatbor)
  L.uni = (T, meta, wheel) => {
    const m = std({ color: '#ffffff', normalMap: treadTex(T.tread || (T.kind === 'bike' ? 'moto' : 'road')), normalScale: new THREE.Vector2(1.1, 1.1) });
    m.name = wheel ? 'uni_wheel' : 'uni';
    const B = base(T, meta);
    if (wheel) B.dirt *= 0.45;
    vehPatch(m, { ...B, flags: wheel && T.kind !== 'bike' ? ['DIRT', 'WHEEL'] : ['DIRT'] });
    return reg(m, 1.0);
  };
  L.glass = () => L._glass || (L._glass = reg(vehPatch(Object.assign(std({ color: '#ffffff', metalness: 0, roughness: 0.03, transparent: true, depthWrite: false }), { name: 'glass' }), { flags: ['GLASS'] }), 1.7, false));
  // LOD1: satu mesh, material standar biasa per kendaraan (warna cat lewat topeng verteks)
  L.far = (T, meta, color) => { const m = std({ color }); m.color.multiplyScalar(PAINT_K); m.name = 'far'; vehPatch(m, { flags: ['LOD'] }); return reg(m, 0.9, false); };
  L.burnt = () => L._burnt || (L._burnt = reg(vehPatch(Object.assign(std({ color: '#ffffff' }), { name: 'burnt' }), { flags: ['BURNT'] }), 0.08)); // bangkai hangus
  L.setEnv = (tex, R) => {
    L.env = tex;
    if (R) L.R = R;
    for (const m of L.all) {
      m.envMap = tex;
      if (L.R && m.userData.vehDyn && !m.userData.vehDynOn) { L.R.patch(m, { dyn: true }); m.userData.vehDynOn = true; }
      m.needsUpdate = true;
    }
  };
  return L;
}
const PAINT_K = 0.62; // albedo cat sedikit diturunkan: di bawah matahari + ACES warna pekat (kuning, merah) tidak memucat
const cleanName = (m) => ((m && m.name) || '').toLowerCase().replace(/\.\d+$/, '');
const U8 = (x) => Math.round(clamp(x, 0, 1) * 255);
// geometri satu mesh GLB → siap gabung: posisi, normal, uv, vcol, vao (lihat keterangan di atas); rel = matriks ke simpul induk
function packGeom(mesh, rel, P, lod) {
  const src = mesh.geometry, g = new THREE.BufferGeometry(), n = src.attributes.position.count;
  g.setAttribute('position', src.attributes.position.clone());
  if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
  else { const t = src.clone(); t.computeVertexNormals(); g.setAttribute('normal', t.attributes.normal); }
  const uv = new Float32Array(n * 2), su = src.attributes.uv;
  if (su) for (let i = 0; i < n; i++) { uv[i * 2] = su.getX(i); uv[i * 2 + 1] = su.getY(i); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const vc = new Uint8Array(n * 4), va = new Uint8Array(n * 4), ac = src.attributes.color || src.attributes.vao || null;
  const cr = U8(Math.sqrt(P.c.r)), cg = U8(Math.sqrt(P.c.g)), cb = U8(Math.sqrt(P.c.b)), al = U8(P.b === 'glass' ? P.a : lod ? P.mask || 0 : P.d);
  const rr = U8(P.r), mm = U8(P.m), ee = U8(P.e);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (P.vc && ac) { vc[j] = U8(Math.sqrt(ac.getX(i))); vc[j + 1] = U8(Math.sqrt(ac.getY(i))); vc[j + 2] = U8(Math.sqrt(ac.getZ(i))); } // LOD1 'rest': warna verteks = albedo × AO
    else { vc[j] = cr; vc[j + 1] = cg; vc[j + 2] = cb; }
    vc[j + 3] = al;
    va[j] = P.vc || !ac ? 255 : U8(ac.getX(i) * P.k); va[j + 1] = rr; va[j + 2] = mm; va[j + 3] = ee;
  }
  g.setAttribute('vcol', new THREE.BufferAttribute(vc, 4, true));
  g.setAttribute('vao', new THREE.BufferAttribute(va, 4, true));
  if (src.index) g.setIndex(src.index.clone());
  else { const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  g.applyMatrix4(rel);
  return g;
}
const LOD_LOOK = { // LOD1 dari Blender: lod1_paint (AO), lod1_glass, lod1_rest (warna verteks)
  paint: { b: 'uni', c: new THREE.Color('#ffffff'), r: 0.4, m: 0.25, e: 0, d: 0, a: 1, k: 1, mask: 1 },
  glass: { b: 'uni', c: new THREE.Color('#080b0f'), r: 0.06, m: 0, e: 0, d: 0, a: 1, k: 1, mask: 0 },
  lodvc: { b: 'uni', c: new THREE.Color('#888888'), r: 0.62, m: 0, e: 0, d: 0, a: 1, k: 1, mask: 0, vc: true },
};
function prepTemplate(id, root, meta, look) {
  const T = TYPES[id];
  meta = meta || {};
  root.updateMatrixWorld(true);
  const byName = (n) => root.getObjectByName(n);
  const mats = { uni: look.uni(T, meta, false), wheel: look.uni(T, meta, true), glass: look.glass(), paint: new THREE.MeshBasicMaterial({ name: 'paint' }) }; // paint: penanda, diganti per kendaraan
  // tiap simpul bergerak (badan, setang, roda) → paling banyak tiga mesh gabungan: cat, uni, kaca
  const lodGeo = [];
  for (const node of [...root.children]) {
    const nm = node.name || '', isLod = /^lod1/.test(nm), isWheel = /^wheel_/.test(nm), parts = { paint: [], uni: [], glass: [] }, drop = [];
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(isLod ? root.matrixWorld : node.matrixWorld).invert();
    node.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), mn = cleanName(o.material);
      if (mn === 'paint' && !meta.paintSrc) meta = { ...meta, paintSrc: { metalness: o.material.metalness, roughness: o.material.roughness, clearcoat: o.material.clearcoat } };
      if (isLod) lodGeo.push(packGeom(o, rel, LOD_LOOK[mn] || LOD_LOOK.lodvc, true));
      else { const P = matLook(mn, o.material, T); parts[P.b].push(packGeom(o, rel, P, false)); }
      drop.push(o);
    });
    if (!drop.length) continue; // titik bantu (jok, pintu, knalpot): dibaca lewat local() di bawah
    if (isLod) { root.remove(node); continue; }
    let holder = node;
    if (node.isMesh) { holder = new THREE.Group(); holder.name = nm; holder.position.copy(node.position); holder.quaternion.copy(node.quaternion); holder.scale.copy(node.scale); root.add(holder); root.remove(node); }
    else for (const ch of [...node.children]) node.remove(ch);
    for (const b of ['paint', 'uni', 'glass']) {
      if (!parts[b].length) continue;
      const merged = parts[b].length > 1 ? mergeGeometries(parts[b], false) : parts[b][0];
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b === 'uni' ? (isWheel ? mats.wheel : mats.uni) : mats[b]);
      mesh.name = nm + '_' + b;
      mesh.receiveShadow = true;
      holder.add(mesh);
    }
  }
  // LOD0 (detail penuh) di grup 'hi'; LOD1 = satu mesh 'lod1' (dipakai > ±60 m)
  const hi = new THREE.Group();
  hi.name = 'hi';
  for (const ch of [...root.children]) hi.add(ch);
  root.add(hi);
  let lod1 = null;
  if (lodGeo.length) {
    const merged = lodGeo.length > 1 ? mergeGeometries(lodGeo, false) : lodGeo[0];
    if (merged) { lod1 = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ name: 'far' })); lod1.name = 'lod1'; lod1.receiveShadow = true; lod1.visible = false; root.add(lod1); }
  }
  const body = byName('body');
  // badan dibungkus grup 'tilt' (titik putar di tanah) untuk anggukan rem/gas & oleng di tikungan
  if (body) { const tilt = new THREE.Group(); tilt.name = 'tilt'; body.parent.add(tilt); tilt.add(body); }
  // roda: bungkus dengan pivot di pusat roda (aman walau rotasi bawaan simpul tidak nol)
  const wheelNames = T.kind === 'bike' ? ['wheel_f', 'wheel_r'] : ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
  const wheels = [], box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
  for (const wn of wheelNames) {
    const w = byName(wn);
    if (!w) continue;
    const parent = w.parent;
    parent.updateMatrixWorld(true);
    box.setFromObject(w);
    box.getCenter(c);
    box.getSize(sz);
    parent.worldToLocal(c);
    const pivot = new THREE.Group();
    pivot.name = 'pivot_' + wn;
    pivot.position.copy(c);
    pivot.rotation.order = 'YXZ';
    parent.add(pivot);
    w.position.sub(c);
    pivot.add(w);
    wheels.push({ name: 'pivot_' + wn, front: /_f/.test(wn), radius: Math.max(0.15, sz.y / 2) });
  }
  const local = (n) => { const o = byName(n); if (!o) return null; const p = new THREE.Vector3(); o.updateMatrixWorld(true); o.getWorldPosition(p); root.worldToLocal(p); return p; };
  const seat = local('seat_driver') || new THREE.Vector3(T.width * 0.22, 0.6, 0);
  const tpl = {
    id, root, mats, wheels, look, hi, lod1, meta,
    seat, eye: local('eye_driver') || seat.clone().add(new THREE.Vector3(0, 0.75, 0.1)),
    exitL: local('exit_l') || new THREE.Vector3(T.width / 2 + 0.9, 0, seat.z), exitR: local('exit_r') || new THREE.Vector3(-T.width / 2 - 0.9, 0, seat.z),
    exhaust: local('exhaust') || new THREE.Vector3(-T.width * 0.3, 0.3, -T.length / 2),
    wheelR: wheels.length ? wheels.reduce((a, w) => a + w.radius, 0) / wheels.length : 0.3,
  };
  // ukuran untuk tabrakan/kotak tembak: lebar bodi dari manifest (tanpa spion), panjang & tinggi termasuk bumper
  const bb = new THREE.Box3().setFromObject(root), s = bb.getSize(new THREE.Vector3());
  tpl.cz = s.z > 0.5 ? (bb.max.z + bb.min.z) / 2 : 0;
  tpl.length = (meta && meta.length) || (s.z > 0.5 ? s.z : T.length);
  tpl.width = (meta && meta.width) || (s.x > 0.3 ? Math.min(s.x, T.width * 1.1) : T.width);
  tpl.height = (meta && meta.height) || (s.y > 0.3 ? s.y : T.height);
  if (meta && meta.colors && meta.colors.length) tpl.colors = id === 'loop' ? [meta.colors[0]] : meta.colors; // trem: selalu livery merah Sutera Loop
  tpl.horn = meta && meta.horn ? ASSET + meta.horn.replace(/^.*\//, '') : null; // klakson MP3 (manifest)
  // pintu pengemudi: setir kanan (Indonesia) → sisi kanan (−X)
  tpl.doorDriver = T.kind === 'bus' ? tpl.exitL : seat.x < -0.05 ? tpl.exitR : tpl.exitL; // trem: satu pintu (kiri depan) untuk semua
  tpl.doorOther = tpl.doorDriver === tpl.exitR ? tpl.exitL : tpl.exitR;
  // kursi: [0] sopir, lalu seat_p1.. dari manifest (model cadangan: kursi dibuat dari posisi sopir)
  const nSeat = (meta && meta.seats) || SEATS[id] || { car: 4, bike: 2, bus: 12 }[T.kind] || 1;
  tpl.seats = [seat];
  for (let i = 1; i < nSeat; i++) { const p = local('seat_p' + i); if (!p) break; tpl.seats.push(p); }
  if (tpl.seats.length < nSeat) {
    const s = seat, gen = T.kind === 'bike' ? [[0, s.y + 0.04, s.z - 0.36]] : T.kind === 'car' ? [[-s.x, s.y, s.z], [s.x, s.y, s.z - 0.85], [-s.x, s.y, s.z - 0.85]]
      : Array.from({ length: 11 }, (_, i) => [i % 2 ? s.x - 0.27 : s.x + 0.17, s.y + 0.1, s.z - 0.85 - (i >> 1) * 0.8]);
    for (const g of gen.slice(tpl.seats.length - 1, nSeat - 1)) tpl.seats.push(new THREE.Vector3(...g));
  }
  tpl.eyeOff = tpl.eye.clone().sub(seat); // mata relatif jok (sama untuk semua kursi)
  tpl.recline = T.recline || 0; // jok rebah (rad) → pose duduk karakter (kepala tidak menembus atap rendah)
  // titik bantu sudah dibaca → buang dari templat; simpul statis tidak menghitung ulang matriks lokalnya tiap frame
  // (yang tetap hidup: tilt, pivot roda, setang — dan root/lean yang dibuat saat kendaraan ditambahkan)
  for (const ch of [...hi.children]) { let has = false; ch.traverse((o) => { if (o.isMesh) has = true; }); if (!has) hi.remove(ch); }
  root.traverse((o) => { if (o.name === 'tilt' || o.name === 'steer' || /^pivot_/.test(o.name || '')) return; o.updateMatrix(); o.matrixAutoUpdate = false; });
  return tpl;
}
// Satu kendaraan dari templat: struktur disalin (geometri & material uni/kaca dipakai bersama), cat clearcoat dan material
// LOD1 milik sendiri (warna, lampu rem). Dipakai game dan garasi.html.
export function instantiateVehicle(tpl, color) {
  const T = TYPES[tpl.id] || {}, look = tpl.look, obj = tpl.root.clone(true);
  const paint = look.paint(T, tpl.meta, color), far = tpl.lod1 ? look.far(T, tpl.meta, color) : null, glass = [], cast = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'lod1') { o.material = far; return; }
    if (o.material === tpl.mats.paint) o.material = paint;
    if (o.material === tpl.mats.glass) glass.push(o); else cast.push(o);
  });
  return { obj, paint, far, glass, cast, hi: obj.getObjectByName('hi') || obj, lod1: obj.getObjectByName('lod1') || null,
    setColor(c) { paint.color.set(c).multiplyScalar(PAINT_K); if (far) far.color.set(c).multiplyScalar(PAINT_K); },
    setLights(brake, lamps) { paint.userData.veh.uVehE.value.x = brake; tpl.mats.uni.userData.veh.uVehE.value.y = lamps; tpl.mats.glass.userData.veh.uVehE.value.y = lamps; } };
}
export async function loadVehicleTemplates(renderer, look, ids) { // ids: hanya jenis tertentu (garasi memuat satu per satu)
  if (!look.env) { // tanpa langit foto: lingkungan studio bawaan
    const pm = new THREE.PMREMGenerator(renderer);
    look.setEnv(pm.fromScene(new RoomEnvironment(), 0.04).texture);
    pm.dispose();
  }
  let manifest = null;
  try { const r = await fetch(ASSET + 'manifest.json', { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch (e) { /* model cadangan */ }
  const loader = new GLTFLoader(), out = {};
  await Promise.all((ids || Object.keys(TYPES)).filter((id) => TYPES[id]).map(async (id) => {
    const meta = Array.isArray(manifest) ? manifest.find((e) => e.id === id) : null;
    let root = null;
    if (meta && meta.glb) { try { root = (await loader.loadAsync(ASSET + meta.glb.replace(/^.*\//, ''))).scene; } catch (e) { console.warn('Model kendaraan gagal dimuat:', id, e); } }
    if (!meta && manifest) return; // manifest ada tapi tipe ini tidak dibuat (mis. bus) → lewati
    out[id] = prepTemplate(id, root || fallbackModel(id), meta, look);
    out[id].glb = !!(meta && root && !root.userData.fallback);
  }));
  return out;
}

// ---------- Partikel: asap (biasa) & api/ledakan (aditif), satu draw call per jenis ----------
export function createParticles(scene, n, additive) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('col', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const uni = { map: { value: softTex(additive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,.9)', 'rgba(255,255,255,0)') }, scale: { value: 800 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: 'attribute vec4 col; attribute float size; uniform float scale; varying vec4 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(512.0, size * scale / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; vC = col; }',
    fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vC.rgb, vC.a * a); }',
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 22 : 21;
  scene.add(pts);
  const P = [];
  return {
    uni,
    emit(x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a) { if (P.length >= n) P.shift(); P.push({ x, y, z, vx, vy, vz, s0, s1, life, t: 0, r, g, b, a }); },
    update(dt) {
      let m = 0;
      for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; p.t += dt; if (p.t >= p.life) { P.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.985; p.vz *= 0.985; }
      for (const p of P) {
        const k = p.t / p.life, fade = additive ? 1 - k : k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
        pos[m * 3] = p.x; pos[m * 3 + 1] = p.y; pos[m * 3 + 2] = p.z;
        col[m * 4] = p.r; col[m * 4 + 1] = p.g; col[m * 4 + 2] = p.b; col[m * 4 + 3] = p.a * fade;
        size[m] = p.s0 + (p.s1 - p.s0) * k;
        m++;
      }
      geo.setDrawRange(0, m);
      geo.attributes.position.needsUpdate = geo.attributes.col.needsUpdate = geo.attributes.size.needsUpdate = true;
    },
  };
}

export function createVehicles(ctx) {
  const { scene, col, inArea, D, agents, renderer, camera } = ctx;
  const list = [];
  let TPL = null, wantSpawn = false;
  const smoke = createParticles(scene, 900, false), glow = createParticles(scene, 500, true);
  // bayangan bulat lunak di bawah kendaraan (bayangan matahari tidak dihitung ulang tiap frame)
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: softTex('rgba(16,14,30,.55)', 'rgba(16,14,30,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }), 96);
  blobs.count = 0;
  blobs.frustumCulled = false;
  blobs.renderOrder = 7;
  scene.add(blobs);
  const look = createVehicleLook(null); // material PBR; peta lingkungan & bayangan dinamis dipasang lewat setEnv(tex, R)
  const ready = loadVehicleTemplates(renderer, look).then((t) => { TPL = t; if (wantSpawn) spawnAll(); return t; }).catch((e) => { console.error('Kendaraan gagal disiapkan', e); });
  const LOD_FAR = 62, LOD_NEAR = 54; // m (pada FOV 75°; dikalikan zoom bidikan): di luar itu model LOD1 (3 draw call)
  // Pemanasan shader: semua program material kendaraan (cat tiap jenis, uni, roda, kaca, LOD1) dikompilasi di frame-frame
  // pertama pertandingan (masih di pesawat) lewat salinan mini di depan kamera, bukan saat kendaraan pertama terlihat
  // (kompilasi di tengah baku tembak = tersendat puluhan ms).
  const warm = { t: 0, grp: null, mats: [] };
  function warmUp() {
    if (warm.t === 0) {
      warm.grp = new THREE.Group();
      for (const id of Object.keys(TPL)) {
        const inst = instantiateVehicle(TPL[id], '#808080');
        if (inst.lod1) inst.lod1.visible = true;
        inst.obj.traverse((o) => { o.frustumCulled = false; });
        warm.grp.add(inst.obj);
        warm.mats.push(inst.paint, inst.far);
        if (!warm.grp.userData.burnt && inst.lod1) { const b = new THREE.Mesh(inst.lod1.geometry, look.burnt()); b.frustumCulled = false; warm.grp.add(b); warm.grp.userData.burnt = true; } // material bangkai
      }
      warm.grp.scale.setScalar(0.0005);
      warm.grp.matrixAutoUpdate = false;
      scene.add(warm.grp);
    }
    if (warm.t < 3) { // di depan kamera selama 3 frame
      camera.getWorldDirection(tmp);
      warm.grp.position.copy(camera.position).addScaledVector(tmp, 4);
      warm.grp.updateMatrix();
      warm.grp.updateMatrixWorld(true);
    } else {
      scene.remove(warm.grp);
      for (const m of warm.mats) if (m) { look.all.delete(m); m.dispose(); }
      warm.grp = null; warm.mats.length = 0;
    }
    warm.t++;
  }
  function setLod(v, far) { // dekat: detail penuh (7–8 draw call); jauh: satu mesh LOD1
    v.far = far;
    if (!v.lod1) return;
    v.hi.visible = !far;
    v.lod1.visible = far;
  }
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  function frame(v) { v.fx = Math.sin(v.yaw); v.fy = -Math.cos(v.yaw); v.rx = v.fy; v.ry = -v.fx; }
  function circlesOf(v) {
    const L = v.L, W = v.W, r = W / 2 * 0.95, n = Math.max(2, Math.ceil(L / (W * 0.7))), a = -L / 2 + r, b = L / 2 - r, out = [];
    for (let i = 0; i < n; i++) out.push([v.cz + a + (b - a) * i / (n - 1), r]);
    return out;
  }
  function footprintBlocked(v, x, y, yaw) {
    const fx = Math.sin(yaw), fy = -Math.cos(yaw);
    for (const [off, r] of v.circles) { const cx = x + fx * off, cy = y + fy * off; if (!inArea(cx, cy) || col.blocked(cx, cy, r * 0.9)) return true; }
    return false;
  }
  function add(id, x, y, yaw, color) {
    const tpl = TPL[id], T = TYPES[id];
    const inst = instantiateVehicle(tpl, color), obj = inst.obj;
    for (const o of inst.cast) o.layers.enable(3); // bayangan dinamis (map/realism.js DYN_LAYER): badan & roda LOD0 saja
    const root = new THREE.Group(), lean = new THREE.Group();
    obj.updateMatrix();
    lean.add(obj);
    root.add(lean);
    scene.add(root);
    const v = {
      id: list.length, type: id, def: T, tpl, name: T.name, root, lean, obj, body: obj.getObjectByName('tilt') || new THREE.Group(),
      wheels: tpl.wheels.map((w) => ({ node: obj.getObjectByName(w.name), front: w.front })).filter((w) => w.node), steerNode: obj.getObjectByName('steer'),
      paint: inst.paint, farMat: inst.far, glass: inst.glass, color, hi: inst.hi, lod1: inst.lod1, far: false,
      L: tpl.length, W: tpl.width, H: tpl.height, cz: tpl.cz, wheelR: tpl.wheelR,
      x, y, yaw, vx: 0, vy: 0, speed: 0, steerA: 0, steerN: 0, hp: T.hp, alive: true, burnT: 0, wreck: false, wreckT: 0,
      driver: null, occ: tpl.seats.map(() => null), lastDriver: null, claim: null, killer: null, input: { ...NO_INPUT }, sleep: true, // occ[0] = driver
      pitch: 0, roll: 0, leanA: 0, accel: 0, latAcc: 0, skid: 0, wheelRot: 0, lastCrash: 0, smokeT: 0, fireT: 0, rpm: 0, braking: false, ejectAt: 0,
    };
    v.circles = circlesOf(v);
    frame(v);
    list.push(v);
    setLod(v, false);
    place(v, 0, 0);
    return v;
  }
  // ---------- Parkir di tepi jalan saat game dimulai ----------
  function spawnAll() {
    if (!TPL) { wantSpawn = true; return; }
    if (list.length) return;
    const segs = col.segs.filter((s) => { const cls = D.classes[D.roads.c[s.road]]; return cls !== 'motorway' && cls !== 'motorway_link' && cls !== 'pedestrian' && s.w >= 4 && Math.hypot(s.bx - s.ax, s.by - s.ay) > 9; });
    if (!segs.length) return;
    const cum = [];
    let tot = 0;
    for (const s of segs) { tot += Math.hypot(s.bx - s.ax, s.by - s.ay); cum.push(tot); }
    const pickSeg = () => { const r = Math.random() * tot; let lo = 0, hi = cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; } return segs[lo]; };
    // supercar mudah ditemukan: 5 di pelataran mal (jalan ≤ 32 m dari tepi gedung komersial > 3000 m²), 2 di jalan protokol,
    // 1 dekat pusat kawasan (tempat banyak pemain mendarat)
    const malls = [];
    for (let i = 0; i < D.buildings.r.length; i++) {
      if (D.buildings.k[i] !== 1) continue;
      const r = D.buildings.r[i], n = r.length >> 1, P = [];
      let a = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = 0; j < n; j++) { const k = (j + 1) % n; a += r[2 * j] * r[2 * k + 1] - r[2 * k] * r[2 * j + 1]; const x = r[2 * j] * 0.1, y = r[2 * j + 1] * 0.1; P.push([x, y]); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (Math.abs(a) * 0.005 > 3000) malls.push({ P, x0, y0, x1, y1 });
    }
    const inPoly = (P, x, y) => { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
    const edgeD = (P, x, y) => { let m = Infinity; for (let j = 0; j < P.length; j++) { const [ax, ay] = P[j], [bx, by] = P[(j + 1) % P.length], ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey, t = L > 0 ? clamp(((x - ax) * ex + (y - ay) * ey) / L, 0, 1) : 0; m = Math.min(m, Math.hypot(x - ax - ex * t, y - ay - ey * t)); } return m; };
    const mid = (s) => [(s.ax + s.bx) / 2, (s.ay + s.by) / 2];
    const forecourt = (s) => { const [x, y] = mid(s); return malls.some((m) => x > m.x0 - 35 && x < m.x1 + 35 && y > m.y0 - 35 && y < m.y1 + 35 && !inPoly(m.P, x, y) && edgeD(m.P, x, y) < 32); };
    const boulevard = (s) => s.w >= 9 && /primary|secondary|trunk/.test(D.classes[D.roads.c[s.road]] || '');
    let cxm = 0, cym = 0;
    for (const s of segs) { const [x, y] = mid(s); cxm += x / segs.length; cym += y / segs.length; }
    const central = (s) => { const [x, y] = mid(s); return Math.hypot(x - cxm, y - cym) < 600; };
    const SUPER = [forecourt, forecourt, forecourt, forecourt, forecourt, boulevard, boulevard, central];
    for (const id of ['loop', 'banteng', 'lintas', 'walet', 'halilintar', 'jawara']) {
      if (!TPL[id]) continue;
      const T = TYPES[id], probe = { L: TPL[id].length, W: TPL[id].width, cz: TPL[id].cz };
      probe.circles = circlesOf(probe);
      let placed = 0;
      const maxTries = T.count * (T.near ? 600 : 80);
      for (let tries = 0; tries < maxTries && placed < T.count; tries++) {
        const s = pickSeg();
        if (id === 'loop' && s.w < 7) continue;
        if (T.near === 'mall' && tries < maxTries * 0.9 && SUPER[placed] && !SUPER[placed](s)) continue;
        const L = Math.hypot(s.bx - s.ax, s.by - s.ay), t = rnd(0.15, 0.85);
        let ux = (s.bx - s.ax) / L, uy = (s.by - s.ay) / L;
        if (Math.random() < 0.5) { ux = -ux; uy = -uy; }
        const off = Math.max(0, s.w / 2 - probe.W / 2 - 0.35); // parkir di kiri (lalu lintas Indonesia)
        const x = s.ax + (s.bx - s.ax) * t - uy * off, y = s.ay + (s.by - s.ay) * t + ux * off;
        const yaw = Math.atan2(ux, -uy);
        if (footprintBlocked(probe, x, y, yaw)) continue;
        if (list.some((v) => Math.hypot(v.x - x, v.y - y) < (v.type === id ? (T.near ? 140 : 75) : 30))) continue;
        const tpl = TPL[id], cols = tpl.colors || T.colors;
        add(id, x, y, yaw, T.paint0 && Math.random() < T.paint0 ? cols[0] : pickA(cols)); // supercar: kebanyakan kuning
        placed++;
      }
    }
    blobs.count = list.length;
  }

  // ---------- Fisika ----------
  function roadAt(x, y) {
    let on = false;
    col.near(x, y, 6, (c) => {
      if (on) return;
      for (const si of c.s) {
        const s = col.segs[si], dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy;
        const t = L > 0 ? clamp(((x - s.ax) * dx + (y - s.ay) * dy) / L, 0, 1) : 0;
        if (Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) < s.w / 2 + 0.8) { on = true; return; }
      }
    });
    return on;
  }
  function crash(v, impact, now, nx, ny) { // impact m/dtk ke arah normal
    if (impact < 2.5) return;
    if (now - v.lastCrash > 0.25) {
      v.lastCrash = now;
      const d = camera.position.distanceTo(tmp.set(v.x, 1, -v.y));
      audio.crash(clamp(impact / 18, 0.15, 1), d, pan(v));
      if (impact > 6) for (let i = 0; i < 8; i++) glow.emit(v.x - nx * v.W * 0.5, rnd(0.4, 1), -(v.y - ny * v.W * 0.5), rnd(-3, 3), rnd(1, 4), rnd(-3, 3), 0.12, 0.05, 0.35, 1, 0.75, 0.35, 1);
    }
    if (impact > 4.5) hit(v, Math.pow(impact - 4.5, 1.3) * 9 / Math.sqrt(v.def.mass), v.driver || v.lastDriver, 'crash');
    const lim = v.def.kind === 'bike' ? 6 : 12;
    if (impact > lim && ctx.hurtDriver) for (const a of v.occ) if (a) ctx.hurtDriver(a, (impact - lim) * (v.def.kind === 'bike' ? 5 : 2.5)); // semua penumpang
  }
  function collideWorld(v, x0, y0, now) {
    let px = 0, py = 0, kick = 0;
    for (let it = 0; it < 2; it++) {
      for (const [off, r] of v.circles) {
        const cx = v.x + v.fx * off, cy = v.y + v.fy * off, p = col.resolve(cx, cy, r);
        const dx = p.x - cx, dy = p.y - cy;
        if (dx * dx + dy * dy > 1e-10) { v.x += dx; v.y += dy; px += dx; py += dy; kick += off * (v.fx * dy - v.fy * dx); }
      }
    }
    // tepi kawasan = dinding
    for (const [off] of [v.circles[0], v.circles[v.circles.length - 1]]) {
      const cx = v.x + v.fx * off, cy = v.y + v.fy * off;
      if (!inArea(cx, cy)) { const imp = Math.hypot(v.vx, v.vy); v.x = x0; v.y = y0; v.vx *= -0.25; v.vy *= -0.25; crash(v, imp, now, v.fx * Math.sign(v.speed || 1), v.fy * Math.sign(v.speed || 1)); return; }
    }
    const pl = Math.hypot(px, py);
    if (pl > 1e-6) {
      const nx = px / pl, ny = py / pl, vn = v.vx * nx + v.vy * ny;
      if (vn < 0) { v.vx -= nx * vn * 1.25; v.vy -= ny * vn * 1.25; crash(v, -vn, now, nx, ny); }
      if (Math.abs(v.speed) > 2) v.yaw = wrap(v.yaw + clamp(kick * 0.5, -0.08, 0.08));
    }
  }
  function step(v, dt, now) {
    const T = v.def, inp = v.driver && v.alive ? v.input : PARK;
    const spdAbs = Math.abs(v.speed), sMax = T.steerMax / (1 + spdAbs / (T.kind === 'bike' ? 20 : 15));
    v.steerA += clamp(clamp(inp.steer, -1, 1) * sMax - v.steerA, -dt * 2.4, dt * 2.4);
    v.steerN = sMax > 0 ? v.steerA / T.steerMax : 0;
    const yawRate = v.speed * Math.tan(v.steerA) / T.wheelbase;
    v.yaw = wrap(v.yaw - yawRate * dt); // setir kanan (+) → searah jarum jam
    frame(v);
    let vf = v.vx * v.fx + v.vy * v.fy, vl = v.vx * v.rx + v.vy * v.ry;
    const onRoad = roadAt(v.x, v.y), boost = inp.boost && inp.throttle > 0;
    const top = T.maxSpeed * (onRoad ? 1 : T.offroad) * (boost ? 1.12 : 1);
    let a = 0;
    v.braking = false;
    if (inp.throttle > 0.05) {
      if (vf < -0.5) { a = T.brake * inp.throttle; v.braking = true; }
      else a = T.accel * (boost ? 1.45 : 1) * Math.max(0, 1 - Math.pow(Math.max(0, vf) / top, 2)) * inp.throttle;
    } else if (inp.throttle < -0.05) {
      if (vf > 0.5) { a = -T.brake * -inp.throttle; v.braking = true; }
      else a = -T.accel * 0.55 * Math.max(0, 1 - Math.pow(Math.max(0, -vf) / T.reverse, 2)) * -inp.throttle;
    }
    vf += a * dt;
    if (inp.park) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), Math.max(T.brake, 12) * dt); if (Math.abs(vf) > 1) v.braking = true; }
    const drag = (onRoad ? 0.3 : 1.5) + 0.0006 * vf * vf + (Math.abs(inp.throttle) > 0.05 ? 0 : onRoad ? 0.5 : 1.3);
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
    if (vf > top) vf -= Math.min(vf - top, 5 * dt);
    if (inp.handbrake) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), T.brake * 0.5 * dt); if (spdAbs > 2) v.braking = true; }
    const grip = (inp.handbrake && spdAbs > 3 ? T.grip * 0.16 : T.grip) * (onRoad ? 1 : 0.78);
    vl *= Math.exp(-grip * dt);
    v.skid = clamp((Math.abs(vl) - 2.5) / 6, 0, 1);
    v.accel = (vf - v.speed) / Math.max(dt, 1e-4);
    v.latAcc = vf * yawRate;
    v.speed = vf;
    v.vx = v.fx * vf + v.rx * vl;
    v.vy = v.fy * vf + v.ry * vl;
    const x0 = v.x, y0 = v.y;
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    collideWorld(v, x0, y0, now);
    v.onRoad = onRoad;
    if (!v.driver && v.burnT <= 0 && Math.hypot(v.vx, v.vy) < 0.05) { v.sleep = true; v.vx = v.vy = v.speed = 0; } else v.sleep = false;
    // debu di luar jalan / asap ban saat selip
    if ((!onRoad && spdAbs > 6) || v.skid > 0.2) {
      v.smokeT -= dt;
      if (v.smokeT <= 0) {
        v.smokeT = 0.05;
        const back = -v.L * 0.42 + v.cz, c = onRoad ? [0.85, 0.85, 0.88] : [0.72, 0.64, 0.5];
        smoke.emit(v.x + v.fx * back + v.rx * rnd(-v.W / 2, v.W / 2), 0.3, -(v.y + v.fy * back), rnd(-0.5, 0.5), rnd(0.4, 1), rnd(-0.5, 0.5), 0.8, 2.6, rnd(0.9, 1.6), c[0], c[1], c[2], 0.35);
      }
    }
  }
  function collideVehicles(now) {
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        if (A.sleep && B.sleep) continue;
        const lim = (A.L + B.L) / 2 + 0.5;
        if (Math.abs(A.x - B.x) > lim || Math.abs(A.y - B.y) > lim) continue;
        const ma = A.wreck ? 1e6 : A.def.mass * (A.driver || !A.sleep ? 1 : 1.5), mb = B.wreck ? 1e6 : B.def.mass * (B.driver || !B.sleep ? 1 : 1.5);
        for (const [oa, ra] of A.circles) {
          const ax = A.x + A.fx * oa, ay = A.y + A.fy * oa;
          for (const [ob, rb] of B.circles) {
            const bx = B.x + B.fx * ob, by = B.y + B.fy * ob, dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy), m = ra + rb;
            if (d >= m || d < 1e-6) continue;
            const nx = dx / d, ny = dy / d, pen = m - d, wa = mb / (ma + mb), wb = ma / (ma + mb);
            A.x -= nx * pen * wa; A.y -= ny * pen * wa; B.x += nx * pen * wb; B.y += ny * pen * wb;
            const rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
            if (rel < 0) {
              const J = -(1.25) * rel / (1 / ma + 1 / mb);
              A.vx -= J / ma * nx; A.vy -= J / ma * ny; B.vx += J / mb * nx; B.vy += J / mb * ny;
              crash(A, -rel * wa * 1.6, now, -nx, -ny); crash(B, -rel * wb * 1.6, now, nx, ny);
            }
            A.sleep = B.sleep = false;
          }
        }
      }
    }
  }
  // menabrak orang: kerusakan sesuai kecepatan, korban terdorong ke samping
  function runOver(v, now) {
    const sp = Math.hypot(v.vx, v.vy);
    if (sp < 1.5) return;
    const hl = v.L / 2 + 0.3, hw = v.W / 2 + 0.3, R2 = (hl + 1.5) ** 2;
    for (const a of agents) {
      if (!a.alive || a.state !== 'ground' || a.vehicle) continue;
      if (a.exitV === v && now - a.exitAt < 2.2) continue; // baru turun dari kendaraan ini: tidak tertabrak olehnya
      const dx = a.pos.x - v.x, dy = -a.pos.z - v.y;
      if (dx * dx + dy * dy > R2) continue;
      const lf = dx * v.fx + dy * v.fy - v.cz, ll = dx * v.rx + dy * v.ry;
      if (Math.abs(lf) > hl || Math.abs(ll) > hw) continue;
      // dorong keluar ke samping terdekat
      const s = ll >= 0 ? 1 : -1, push = hw - Math.abs(ll) + 0.15;
      let nx = a.pos.x + v.rx * push * s, ny = -a.pos.z + v.ry * push * s;
      const r = col.resolve(nx, ny, 0.35);
      a.pos.x = r.x; a.pos.z = -r.y;
      const drv = v.driver || v.lastDriver;
      if (drv && drv !== a && drv.team !== undefined && drv.team === a.team) continue; // rekan seregu hanya terdorong minggir, tidak terluka
      if (sp > 3.5 && (!a.runAt || now - a.runAt > 0.8)) {
        a.runAt = now;
        const dmg = Math.pow(sp - 3, 1.6) * 4.5;
        if (ctx.runOver) ctx.runOver(a, dmg, drv, v);
        v.vx *= 0.92; v.vy *= 0.92;
      }
    }
  }
  // ---------- Rusak, terbakar, meledak ----------
  function hit(v, dmg, attacker, why) {
    if (v.wreck) return;
    v.sleep = false;
    if (!v.alive) { v.burnT = Math.min(v.burnT, Math.max(0.6, v.burnT - dmg / 400)); return; }
    v.hp -= dmg;
    if (attacker) v.killer = attacker;
    if (v.hp <= 0) {
      v.hp = 0;
      v.alive = false;
      v.burnT = v.def.kind === 'bike' ? 2.4 : rnd(4, 5.5);
      v.ejectAt = ctx.now() + rnd(0.4, 1.3);
      if (v.occ.some((a) => a && a.isPlayer) && ctx.onBurn) ctx.onBurn(v);
    }
  }
  function explode(v, now) {
    v.wreck = true;
    v.burnT = 0;
    v.wreckT = now;
    v.input = { ...NO_INPUT };
    const x = v.x, z = -v.y, d = camera.position.distanceTo(tmp.set(x, 1, z));
    audio.boom(d, pan(v));
    for (let i = 0; i < 36; i++) { const k = i < 12 ? 6 : 1.8; glow.emit(x + rnd(-1, 1), rnd(0.5, 2), z + rnd(-1, 1), rnd(-7, 7), rnd(2, 10), rnd(-7, 7), rnd(2.5, 4.5), rnd(0.5, 1.5), i < 12 ? rnd(0.15, 0.3) : rnd(0.35, 0.8), k, k * rnd(0.45, 0.75), k * 0.2, 1); } // inti HDR → bloom
    for (let i = 0; i < 24; i++) smoke.emit(x + rnd(-1.5, 1.5), rnd(1, 3), z + rnd(-1.5, 1.5), rnd(-2, 2), rnd(1.5, 4), rnd(-2, 2), rnd(2, 3), rnd(6, 9), rnd(2.5, 4.5), 0.12, 0.11, 0.12, 0.75);
    if (ctx.explode) ctx.explode(x, v.y, 1.0, v.def.kind === 'bus' ? 9 : 7.5, v.def.kind === 'bike' ? 110 : 140, v.killer, v);
    // bangkai: hitam hangus, kaca pecah (detail penuh & LOD1) — satu material hangus dipakai bersama
    const burnt = look.burnt();
    v.obj.traverse((o) => { if (!o.isMesh) return; if (v.glass.includes(o)) o.visible = false; else o.material = burnt; });
    v.paint = null;
    v.vx *= 0.3; v.vy *= 0.3;
    v.sleep = false;
  }
  function pan(v) { const dx = v.x - camera.position.x, dz = -v.y - camera.position.z, a = Math.atan2(dx, dz) - ctx.viewYaw(); return -Math.sin(a); }

  // ---------- Tampilan per frame ----------
  function place(v, dt, now) {
    v.root.position.set(v.x, 0, -v.y);
    v.root.rotation.y = v.yaw;
    const k = 1 - Math.exp(-dt * 6);
    if (v.def.kind === 'bike') {
      const lean = v.driver ? clamp(v.latAcc / 9.8 * 0.85, -0.55, 0.55) : v.wreck ? -1.35 : -0.14; // diam: bersandar di standar samping
      v.leanA += (lean - v.leanA) * (dt ? 1 - Math.exp(-dt * (v.driver ? 7 : 3)) : 1);
      v.lean.rotation.z = v.leanA;
    } else {
      v.pitch += (clamp(-v.accel * 0.0055, -0.07, 0.07) - v.pitch) * k;
      v.roll += (clamp(-v.latAcc * 0.0035, -0.06, 0.06) - v.roll) * k;
      v.body.rotation.x = v.pitch;
      v.body.rotation.z = v.roll;
      v.body.position.y = v.driver && v.alive ? Math.sin(now * 38) * 0.004 : 0;
    }
    v.wheelRot += v.speed * dt / v.wheelR;
    for (const w of v.wheels) { w.node.rotation.x = v.wheelRot; w.node.rotation.y = w.front ? -v.steerA : 0; }
    if (v.steerNode) v.steerNode.rotation.y = -v.steerA;
    if (v.paint && !v.wreck) v.paint.userData.veh.uVehE.value.x = v.braking ? 9 : 0.9; // lampu rem: jauh di atas ambang bloom saat mengerem
  }
  function seatAgent(v) { // semua yang duduk (sopir & penumpang) mengikuti joknya masing-masing
    let upd = false;
    for (let i = 0; i < v.occ.length; i++) {
      const a = v.occ[i];
      if (!a) continue;
      if (!upd) { v.root.updateMatrixWorld(true); upd = true; }
      tmp.copy(v.tpl.seats[i]);
      v.root.localToWorld(tmp); // tanpa kemiringan motor: rig berputar sendiri di sekitar jok
      a.pos.set(tmp.x, 0, tmp.z);
      a.sitY = tmp.y - 0.93;
      a.aimY = tmp.y + 0.42;
      a.yaw = v.yaw;
      a.sitRoll = v.def.kind === 'bike' ? v.leanA : v.roll * 0.6;
      a.sitKind = v.def.kind === 'bike' ? 'bike' : 'car';
      a.sitRecline = v.tpl.recline || 0;
      a.moveSpeed = Math.abs(v.speed);
      a.crouch = false;
    }
  }
  function freeSeat(v, x, y) { // kursi penumpang kosong terdekat dari titik (x,y) data
    let best = -1, bd = Infinity;
    v.root.updateMatrixWorld(true);
    for (let i = 1; i < v.occ.length; i++) {
      if (v.occ[i]) continue;
      tmp.copy(v.tpl.seats[i]); v.root.localToWorld(tmp);
      const d = Math.hypot(tmp.x - x, -tmp.z - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function takeSeat(v, a, i) { // dudukkan a di kursi i (0 = sopir)
    v.occ[i] = a;
    a.seat = i;
    if (i === 0) { v.driver = a; v.claim = null; v.sleep = false; v.input = { throttle: 0, steer: 0, handbrake: false, boost: false }; }
  }
  function leaveSeat(v, a) { // kosongkan kursi a; sopir pergi → kendaraan direm sampai berhenti (PARK)
    const i = v.occ.indexOf(a);
    if (i < 0) return -1;
    v.occ[i] = null;
    a.seat = -1;
    if (i === 0) { v.driver = null; v.lastDriver = a; v.input = { throttle: 0, steer: 0, handbrake: Math.abs(v.speed) < 3, boost: false }; }
    return i;
  }
  function burnFx(v, dt) {
    const dmgK = v.hp / v.def.hp;
    const front = v.def.kind === 'bike' ? 0 : v.L * 0.3 + v.cz, hx = v.x + v.fx * front, hy = v.y + v.fy * front, hh = v.def.kind === 'bike' ? 0.7 : v.H * 0.6;
    if (!v.alive || v.wreck || dmgK < 0.4) {
      v.fireT -= dt;
      if (v.fireT <= 0) {
        const burning = !v.alive && !v.wreck, wreckSmoke = v.wreck && ctx.now() - v.wreckT < 25;
        v.fireT = burning ? 0.04 : wreckSmoke ? 0.18 : dmgK < 0.2 ? 0.1 : 0.2;
        const dark = burning || v.wreck || dmgK < 0.2 ? 0.16 : 0.55;
        if (burning || wreckSmoke || v.alive) smoke.emit(hx + rnd(-0.3, 0.3), hh, -hy + rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(1.4, 2.4), rnd(-0.3, 0.3), 0.8, burning ? 4.5 : 3, rnd(2, 3.4), dark, dark, dark + 0.02, burning ? 0.6 : 0.42);
        if (burning) for (let i = 0; i < 2; i++) glow.emit(hx + rnd(-0.5, 0.5), hh + rnd(-0.1, 0.4), -hy + rnd(-0.5, 0.5), rnd(-0.4, 0.4), rnd(1.5, 3), rnd(-0.4, 0.4), rnd(0.9, 1.5), 0.25, rnd(0.35, 0.6), 1, rnd(0.4, 0.65), 0.15, 0.9);
      }
    }
  }

  // ---------- Suara mesin (kendaraan pemain + 2 terdekat yang menyala) ----------
  function engineSound(me) {
    const cam = camera.position, near = [];
    for (const v of list) if (v.driver && v.alive) near.push([v === me.vehicle ? -1 : cam.distanceTo(tmp.set(v.x, 1, -v.y)), v]);
    near.sort((p, q) => p[0] - q[0]);
    for (let s = 0; s < 3; s++) {
      const it = near[s];
      if (!it || it[0] > 160) { audio.engine(s, null); continue; }
      const v = it[1], T = v.def, sp = Math.abs(v.speed) / T.maxSpeed;
      let rpm;
      if (!T.gears) rpm = 0.22 + 0.7 * Math.min(1, sp * 1.1); // CVT motor matic
      else { const g = Math.min(T.gears - 1, Math.floor(sp * T.gears * 1.05)); rpm = 0.25 + 0.72 * clamp(sp * T.gears * 1.05 - g, 0, 1) * (0.55 + 0.45 * (g + 1) / T.gears); }
      v.rpm += (rpm + (v.input.throttle > 0 && sp < 0.05 ? 0.15 : 0) - v.rpm) * 0.2;
      audio.engine(s, { kind: T.sound, rpm: v.rpm, load: Math.max(0, v.input.throttle), dist: Math.max(0, it[0]), pan: it[0] < 0 ? 0 : pan(v) });
    }
    audio.skid(me.vehicle ? me.vehicle.skid * clamp(Math.abs(me.vehicle.speed) / 8, 0, 1) : 0);
  }

  return {
    list, ready, TYPES, blobs,
    // peta lingkungan (langit foto) untuk pantulan; R (map/realism.js) opsional: material ikut menerima bayangan dinamis
    setEnv(tex, R) { look.setEnv(tex, R); },
    spawnAll,
    // dt, now, me (agen pemain), input pemain (fungsi → { throttle, steer, handbrake, boost })
    update(dt, now, me, playerInput) {
      if (!list.length) { engineSound(me); return; }
      if (warm.t < 4 && TPL) warmUp();
      if (me.vehicle && me.vehicle.driver === me && playerInput) me.vehicle.input = playerInput(); // penumpang tidak menyetir
      // sub-langkah menurut kecepatan tercepat (≤ 0,3 m per langkah) supaya kendaraan kencang tidak menembus dinding tipis
      const vmax = list.reduce((m, v) => (v.sleep ? m : Math.max(m, Math.abs(v.speed))), 0);
      const sub = Math.min(6, Math.max(dt > 0.022 ? 2 : 1, Math.ceil(vmax * dt / 0.3))), h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (const v of list) if (!v.sleep || v.driver || v.burnT > 0) step(v, h, now);
        collideVehicles(now);
      }
      const lodK = Math.tan(camera.fov * Math.PI / 360) / 0.7673; // teropong memperbesar → detail penuh lebih jauh
      for (const v of list) {
        if (!v.sleep) runOver(v, now);
        if (!v.alive && !v.wreck) {
          if (v.driver && !v.driver.isPlayer && now > v.ejectAt && ctx.ejectBot) ctx.ejectBot(v.driver, v);
          v.burnT -= dt;
          if (v.burnT <= 0) explode(v, now);
        }
        // kendaraan diam ≥ 2,5 dtk dibekukan: tanpa place() & tanpa penelusuran matriks (±50 simpul × 74 kendaraan tiap frame)
        if (v.x !== v.lx || v.y !== v.ly || v.yaw !== v.lyaw) { v.lx = v.x; v.ly = v.y; v.lyaw = v.yaw; v.idleT = 0; } // tergeser (ditabrak) walau langsung diam lagi → tampilan ikut
        v.idleT = v.sleep && !v.driver && v.burnT <= 0 && !v.occ.some(Boolean) ? (v.idleT || 0) + dt : 0;
        const frozen = v.idleT > 2.5;
        if (!frozen) place(v, dt, now);
        if (v.root.matrixWorldAutoUpdate === frozen) { if (frozen) v.root.updateMatrixWorld(true); v.root.matrixWorldAutoUpdate = !frozen; }
        seatAgent(v);
        burnFx(v, dt);
        const dc = camera.position.distanceTo(tmp.set(v.x, 1, -v.y));
        v.root.visible = dc < 450;
        const dl = dc * lodK;
        if (v.far ? dl < LOD_NEAR : dl > LOD_FAR) setLod(v, !v.far);
      }
      // bayangan bulat
      for (let i = 0; i < list.length; i++) {
        const v = list[i], c = v.cz;
        blobs.setMatrixAt(i, m4.compose(tmp2.set(v.x + v.fx * c, 0.035, -(v.y + v.fy * c)), qq.setFromAxisAngle(UP, v.yaw), sv.set(v.W + 0.7, 1, v.L + 0.9)));
      }
      blobs.instanceMatrix.needsUpdate = true;
      const scale = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
      smoke.uni.scale.value = glow.uni.scale.value = scale;
      smoke.update(dt);
      glow.update(dt);
      engineSound(me);
    },
    setInput(v, inp) { v.input = inp; },
    // naik (state 'drive'): kursi sopir kalau kosong, kalau tidak kursi penumpang kosong terdekat (pemain saja; bot hanya
    // naik kendaraan kosong). Pemain naik ke kendaraan yang disetir bot → bot turun dan melawan.
    // turun: lewat pintu terdekat dari kursinya
    enter(v, a) {
      if (!v || !v.alive || a.vehicle) return false;
      // bot hanya naik kendaraan kosong, atau menumpang kendaraan yang isinya rekan seregu (regu naik bersama)
      const mates = a.team !== undefined && v.occ.every((o) => !o || o.team === a.team);
      if (!a.isPlayer && v.occ.some(Boolean) && !mates) return false;
      const i = !v.occ[0] && (a.isPlayer || !v.occ.some(Boolean)) ? 0 : a.isPlayer || mates ? freeSeat(v, a.pos.x, -a.pos.z) : -1;
      if (i < 0) return false;
      takeSeat(v, a, i);
      a.vehicle = v;
      a.state = 'drive';
      a.crouch = false;
      a.vel.set(0, 0);
      seatAgent(v);
      audio.door();
      if (i > 0 && v.driver && !v.driver.isPlayer && v.driver.team !== a.team && ctx.ejectBot) ctx.ejectBot(v.driver, v); // bot lawan di kemudi: turun dan melawan
      return true;
    },
    // pindah kursi di dalam kendaraan (kursi tujuan harus kosong)
    switchSeat(v, a, i) {
      if (!v || a.vehicle !== v || !v.alive || i < 0 || i >= v.occ.length || v.occ[i]) return false;
      leaveSeat(v, a);
      takeSeat(v, a, i);
      seatAgent(v);
      return true;
    },
    seatOf(v, a) { return v ? v.occ.indexOf(a) : -1; },
    exit(v, a, dead) {
      const si = v ? leaveSeat(v, a) : -1;
      if (si < 0) return null;
      a.vehicle = null;
      const s = v.tpl.seats[si], bus = v.def.kind === 'bus', sp = v.speed, moving = Math.abs(sp) > 1.2, dirS = Math.sign(sp) || 1;
      const near = bus ? v.tpl.exitL : v.def.kind === 'bike' && si > 0 ? v.tpl.exitR : s.x < -0.05 ? v.tpl.exitR : s.x > 0.05 ? v.tpl.exitL : v.tpl.doorDriver; // bus: penumpang lewat pintu kiri
      const far = near === v.tpl.exitR ? v.tpl.exitL : v.tpl.exitR;
      const at3 = (p, wide = 0) => (bus ? new THREE.Vector3(p.x + Math.sign(p.x) * wide, 0, p.z) : new THREE.Vector3(p.x + Math.sign(p.x) * wide, 0, s.z)); // pintu sejajar kursi
      // urutan: pintu kursi → pintu seberang → belakang (berlawanan arah gerak) → pintu lebih jauh; tidak pernah di depan
      const spot = [at3(near), at3(far), new THREE.Vector3(0, 0, v.cz - dirS * (v.L / 2 + 1.1)), at3(near, 0.9), at3(far, 0.9)];
      const safe = (x, y) => {
        if (!inArea(x, y) || col.blocked(x, y, 0.36)) return false;
        if (list.some((o) => distTo(o, x, y) < (o === v ? 0.65 : 0.5))) return false; // di luar badan kendaraan (dengan sela)
        if (moving) { // bukan di lintasan kendaraan yang masih bergerak
          const lf = (x - v.x) * v.fx + (y - v.y) * v.fy - v.cz, ll = (x - v.x) * v.rx + (y - v.y) * v.ry;
          if (lf * dirS > v.L / 2 - 0.6 && Math.abs(ll) < v.W / 2 + 1.0) return false;
        }
        return true;
      };
      v.root.updateMatrixWorld(true);
      let at = null;
      for (const p of spot) { tmp.copy(p); v.root.localToWorld(tmp); if (safe(tmp.x, -tmp.z)) { at = [tmp.x, -tmp.z]; break; } }
      if (!at) { // semua terhalang: cari melingkar di sekitar pintu kursi
        tmp.copy(at3(near)); v.root.localToWorld(tmp);
        const cx = tmp.x, cy = -tmp.z;
        for (let r = 0.6; r <= 6 && !at; r += 0.6) for (let k = 0; k < 12 && !at; k++) { const g = k / 12 * Math.PI * 2, x = cx + Math.cos(g) * r, y = cy + Math.sin(g) * r; if (safe(x, y)) at = [x, y]; }
      }
      at ||= col.findFree(v.x - v.fx * dirS * (v.L / 2 + 2), v.y - v.fy * dirS * (v.L / 2 + 2), 12, 0.36) || [v.x, v.y];
      a.pos.set(at[0], 0, -at[1]);
      a.grounded = true;
      a.vy = 0;
      a.vel.set(0, 0);
      a.sitRoll = 0;
      a.state = dead ? 'dead' : 'ground';
      a.exitV = v; a.exitAt = ctx.now(); // kebal tabrakan kendaraan ini sebentar (kendaraan masih direm)
      if (!dead) audio.door();
      const spd = Math.abs(sp);
      if (!dead && spd > 16.7 && ctx.hurtDriver) ctx.hurtDriver(a, (spd - 16.7) * 3, 'fall'); // melompat dari kendaraan > 60 km/j
      return at;
    },
    hit,
    // sinar peluru (dunia three.js) → kendaraan pertama yang kena: { v, t, part: 'body'|'glass'|'rider', h, who }
    // who = orang di dalam yang kena (rider: motor/jip terbuka, glass: yang terdekat dari lintasan di mobil tertutup)
    ray(o, d, maxT, shooter) {
      let best = null;
      const ox = o.x, oy = -o.z, oh = o.y, dx = d.x, dy = -d.z, dh = d.y;
      for (const v of list) {
        if (shooter && (v.driver === shooter || shooter.vehicle === v)) continue; // kendaraan sendiri tidak menghalangi
        const hasRider = v.def.kind === 'bike' && v.occ.some(Boolean);
        const H = hasRider ? 1.75 : v.H, R = Math.max(v.L / 2 + 0.6, H);
        const ex = v.x - ox, ey = v.y - oy, eh = H / 2 - oh, tca = ex * dx + ey * dy + eh * dh;
        if (tca < -R || tca - R > maxT) continue;
        if (ex * ex + ey * ey + eh * eh - tca * tca > R * R) continue;
        const lx = (ox - v.x) * v.fx + (oy - v.y) * v.fy - v.cz, ly = (ox - v.x) * v.rx + (oy - v.y) * v.ry;
        const ux = dx * v.fx + dy * v.fy, uy = dx * v.rx + dy * v.ry;
        const hw = hasRider ? 0.42 : v.W / 2;
        let t0 = 0, t1 = maxT, ok = true;
        for (const [p, u, lo, hi] of [[lx, ux, -v.L / 2, v.L / 2], [ly, uy, -hw, hw], [oh, dh, 0.05, H]]) {
          if (Math.abs(u) < 1e-9) { if (p < lo || p > hi) { ok = false; break; } continue; }
          let a = (lo - p) / u, b = (hi - p) / u;
          if (a > b) { const t = a; a = b; b = t; }
          t0 = Math.max(t0, a); t1 = Math.min(t1, b);
          if (t0 > t1) { ok = false; break; }
        }
        if (!ok || (best && t0 >= best.t)) continue;
        const hh = oh + dh * t0;
        let part = 'body', who = null, th = t0, hAt = hh;
        if (hasRider) { if (hh > 0.78) { part = 'rider'; who = nearOcc(v, lx, ly, ux, uy, t0, t1, oh, dh).a; } }
        else if (v.def.kind !== 'bike' && (!v.def.enclosed || hh > v.H * 0.55)) {
          const c = nearOcc(v, lx, ly, ux, uy, t0, t1, oh, dh);
          if (!v.def.enclosed) { if (c && c.d < 0.6 && c.h > c.sy + 0.05 && c.h < c.sy + 1.1) { part = 'rider'; who = c.a; th = c.t; hAt = c.h; } } // jip terbuka: badan di atas pintu
          else { part = 'glass'; if (c && c.d < 1.3) who = c.a; }
        }
        best = { v, t: th, part, h: hAt, who };
      }
      return best;
    },
    // ---------- untuk pemain & bot ----------
    nearestFor(a, maxD = 1.7) { // kendaraan yang bisa dinaiki dari posisi agen (masih ada kursi kosong)
      let best = null, bd = maxD;
      for (const v of list) { if (!v.alive || !v.occ.includes(null)) continue; const d = distTo(v, a.pos.x, -a.pos.z); if (d < bd) { bd = d; best = v; } }
      return best;
    },
    fullNear(a, maxD = 1.7) { // kendaraan penuh terdekat (untuk pesan "Kendaraan penuh")
      let best = null, bd = maxD;
      for (const v of list) { if (!v.alive || v.occ.includes(null)) continue; const d = distTo(v, a.pos.x, -a.pos.z); if (d < bd) { bd = d; best = v; } }
      return best;
    },
    freeNear(x, y, r) { // untuk bot: kendaraan kosong
      let best = null, bd = r;
      for (const v of list) {
        if (!v.alive || v.occ.some(Boolean) || v.claim || v.hp < v.def.hp * 0.35) continue;
        const d = Math.hypot(v.x - x, v.y - y);
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },
    doorPoint(v) { v.root.updateMatrixWorld(true); tmp.copy(v.tpl.doorDriver); v.root.localToWorld(tmp); return [tmp.x, -tmp.z]; },
    dist(v, x, y) { return distTo(v, x, y); },
    // kendaraan melaju ke arah (x,y) dalam ±1,8 dtk → arah menghindar { sx, sy }
    threat(x, y, who) {
      for (const v of list) {
        if (v.driver === who || v.sleep) continue;
        const sp = Math.hypot(v.vx, v.vy);
        if (sp < 6) continue;
        const dx = x - v.x, dy = y - v.y;
        if (dx * dx + dy * dy > 30 * 30) continue;
        const ux = v.vx / sp, uy = v.vy / sp, along = dx * ux + dy * uy;
        if (along < 0 || along / sp > 1.8) continue;
        const lat = dx * -uy + dy * ux;
        if (Math.abs(lat) > v.W / 2 + 1.7) continue;
        const s = lat >= 0 ? 1 : -1;
        return { sx: -uy * s, sy: ux * s, v };
      }
      return null;
    },
    ahead(v, dist) { // kendaraan lain tepat di depan (untuk sopir bot)
      for (const o of list) {
        if (o === v) continue;
        const dx = o.x - v.x, dy = o.y - v.y, f = dx * v.fx + dy * v.fy;
        if (f < 0 || f > dist + (v.L + o.L) / 2) continue;
        if (Math.abs(dx * v.rx + dy * v.ry) < (v.W + o.W) / 2 + 0.4) return o;
      }
      return null;
    },
    // agen yang berjalan tidak menembus kendaraan
    pushOut(x, y, r) {
      for (const v of list) {
        const dx = x - v.x, dy = y - v.y, lim = v.L / 2 + r + 0.5;
        if (dx * dx + dy * dy > lim * lim) continue;
        const lf = dx * v.fx + dy * v.fy - v.cz, ll = dx * v.rx + dy * v.ry, hl = v.L / 2 + r * 0.7, hw = v.W / 2 + r * 0.7;
        if (Math.abs(lf) >= hl || Math.abs(ll) >= hw) continue;
        const pl = hl - Math.abs(lf), pw = hw - Math.abs(ll);
        if (pw < pl) { const s = ll >= 0 ? 1 : -1; x += v.rx * pw * s; y += v.ry * pw * s; }
        else { const s = lf >= 0 ? 1 : -1; x += v.fx * pl * s; y += v.fy * pl * s; }
      }
      return { x, y };
    },
    horn(v) {
      if (!v || !v.alive || now() - (v.hornT || 0) < 0.25) return;
      v.hornT = now();
      const d = camera.position.distanceTo(tmp.set(v.x, 1, -v.y));
      if (d > 220) return;
      if (!(v.tpl.horn && audio.clip('horn' + v.id, v.tpl.horn, d, pan(v)))) audio.horn(v.def.sound, d, pan(v));
    },
    // ada orang di depan kendaraan (untuk sopir bot: klakson)
    agentAhead(v, dist) {
      for (const a of agents) {
        if (!a.alive || a.state !== 'ground' || a === v.driver) continue;
        const dx = a.pos.x - v.x, dy = -a.pos.z - v.y, f = dx * v.fx + dy * v.fy;
        if (f > v.L / 2 && f < v.L / 2 + dist && Math.abs(dx * v.rx + dy * v.ry) < v.W / 2 + 0.8) return a;
      }
      return null;
    },
    // mata di kursi (0 = sopir), ikut kemiringan bodi/motor
    eyeWorld(v, out, seat = 0) { v.root.updateMatrixWorld(true); return v.lean.localToWorld(seat > 0 && v.tpl.seats[seat] ? out.copy(v.tpl.seats[seat]).add(v.tpl.eyeOff) : out.copy(v.tpl.eye)); },
    pins(x, y, R, exclude) {
      const out = [];
      for (const v of list) { if (v === exclude || v.wreck || v.occ.some(Boolean)) continue; if (Math.abs(v.x - x) < R && Math.abs(v.y - y) < R) out.push({ x: v.x, y: v.y, color: !v.alive ? '#8a3a2a' : v.type === 'halilintar' ? '#f7c200' : '#3b4256', r: v.type === 'halilintar' ? 4.8 : 3.2 }); } // supercar: pin kuning besar
      return out;
    },
  };
  function now() { return ctx.now(); }
  // orang di dalam yang paling dekat dari lintasan peluru (koordinat sinar lokal: lx maju − cz, ly kanan; u = arah)
  function nearOcc(v, lx, ly, ux, uy, t0, t1, oh, dh) {
    let best = null;
    const uu = ux * ux + uy * uy;
    for (let i = 0; i < v.occ.length; i++) {
      const a = v.occ[i];
      if (!a) continue;
      const s = v.tpl.seats[i], pf = s.z - v.cz, pl = -s.x; // model: +X = kiri
      const t = clamp(uu > 1e-9 ? ((pf - lx) * ux + (pl - ly) * uy) / uu : t0, t0, t1);
      const d = Math.hypot(lx + ux * t - pf, ly + uy * t - pl);
      if (!best || d < best.d) best = { a, d, t, h: oh + dh * t, sy: s.y };
    }
    return best;
  }
  function distTo(v, x, y) { // jarak titik ke kotak kendaraan (0 = di dalam)
    const dx = x - v.x, dy = y - v.y, lf = Math.abs(dx * v.fx + dy * v.fy - v.cz) - v.L / 2, ll = Math.abs(dx * v.rx + dy * v.ry) - v.W / 2;
    return Math.hypot(Math.max(0, lf), Math.max(0, ll));
  }
}
