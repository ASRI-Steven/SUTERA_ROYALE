// Mode realistis game. Semua aset dari Poly Haven (lisensi CC0, tools/realism/fetch_assets.py):
// - Langit foto HDR: versi 1k (.hdr) untuk cahaya (pantulan lingkungan PMREM, warna langit/tanah, arah & kuat matahari
//   dihitung dari datanya), versi JPG besar untuk kubah langit yang terlihat.
// - Tekstur PBR foto (albedo, normal, kekasaran) untuk aspal, paving, rumput, tanah, plester, genteng.
// - Bayangan dinamis karakter & kendaraan (peta kedalaman kecil di sekitar kamera, tiap frame).
// Semua opsional: kalau aset gagal dimuat, loadRealism mengembalikan null dan game memakai tampilan lama.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const BASE = 'game/assets/';
// kunci → [id Poly Haven, ukuran ubin (m), kuat normal]
const SETS = {
  asphalt: ['asphalt_04', 4.04, 1.0], pave: ['pavement_03', 2.0, 1.0], slab: ['concrete_pavement', 1.8, 0.9],
  grass: ['leafy_grass', 2.0, 1.0], soil: ['forrest_ground_01', 2.0, 1.0], plaster: ['painted_plaster_wall', 2.0, 0.7], roof: ['clay_roof_tiles_02', 2.5, 1.0],
};
export const DYN_LAYER = 3; // layer untuk benda yang membuat bayangan dinamis (karakter, kendaraan)

// langit foto (equirect, bagian atas + sedikit di bawah cakrawala): dipakai kubah langit & warna kabut (postfx.js)
export const SKY_GLSL = `
uniform sampler2D tSky; uniform vec3 uSkyP; // x = v dasar potongan (pada equirect penuh), y = penguat, z = cadangan
vec3 skyExpand(vec3 c) { c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.86); return c * (1.0 + c * c * 3.2) * uSkyP.y; } // foto LDR → kira-kira HDR (awan terang > 1), sedikit kurang jenuh
vec2 skyUv(vec3 d) { return vec2(atan(d.z, d.x) / 6.2831853 + 0.5, clamp((asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5 - uSkyP.x) / (1.0 - uSkyP.x), 0.003, 0.997)); }
vec3 skyAt(vec3 d, float lod) { return skyExpand(textureLod(tSky, skyUv(d), lod).rgb); }
`;

// ---------- Langit HDR: statistik cahaya ----------
// data: Float32Array RGBA (baris 0 = atas). Mengembalikan arah matahari, iradiansi matahari (energi di atas batas jepit),
// iradiansi langit untuk bidang menghadap atas, dan menjepit data (matahari dibuang; diganti DirectionalLight).
function analyseSky(data, w, h, clampL = 14) {
  let best = 0, bx = 0, by = 0;
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  for (let y = 0; y < h >> 1; y++) for (let x = 0; x < w; x++) { const l = lum((y * w + x) * 4); if (l > best) { best = l; bx = x; by = y; } }
  // titik berat piksel sangat terang di sekitar puncak (matahari bisa mencakup beberapa piksel)
  let sx = 0, sy = 0, sw = 0;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = (bx + dx + w) % w, y = Math.min(h - 1, Math.max(0, by + dy)), l = lum((y * w + x) * 4);
    if (l > best * 0.2) { sx += (bx + dx) * l; sy += y * l; sw += l; }
  }
  const u = ((sx / sw) + 0.5) / w, v = 1 - ((sy / sw) + 0.5) / h, lat = (v - 0.5) * Math.PI, lon = (u - 0.5) * Math.PI * 2;
  const sunDir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize();
  const sunE = [0, 0, 0], skyE = [0, 0, 0], hor = [0, 0, 0];
  let horN = 0;
  const dA = (Math.PI / h) * (2 * Math.PI / w);
  for (let y = 0; y < h; y++) {
    const la = (0.5 - (y + 0.5) / h) * Math.PI, cl = Math.cos(la), sl = Math.sin(la), dw = cl * dA;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, l = lum(i);
      if (l > clampL) { const k = clampL / l; for (let c = 0; c < 3; c++) { sunE[c] += data[i + c] * (1 - k) * dw; data[i + c] *= k; } }
      if (sl > 0) for (let c = 0; c < 3; c++) skyE[c] += data[i + c] * sl * dw;
      if (la > 0.01 && la < 0.07) { for (let c = 0; c < 3; c++) hor[c] += data[i + c]; horN++; }
    }
  }
  return { sunDir, sunE, skyE, horizon: hor.map((v2) => v2 / Math.max(1, horN)) };
}

async function loadSky() {
  let meta = { v0: 0.4722, file: 'sky_dome.jpg' };
  try { const r = await fetch(BASE + 'sky/sky.json', { cache: 'no-cache' }); if (r.ok) meta = { ...meta, ...(await r.json()) }; } catch (e) { /* nilai bawaan */ }
  const [hdr, dome] = await Promise.all([new RGBELoader().setDataType(THREE.FloatType).loadAsync(BASE + 'sky/sky_1k.hdr'), new THREE.TextureLoader().loadAsync(BASE + 'sky/' + meta.file)]);
  const { data, width: w, height: h } = hdr.image;
  const A = analyseSky(data, w, h);
  // Eksposur dipanggang ke semua cahaya: bidang putih mendatar (albedo 0,8) yang tersinari matahari + langit = ±1.
  // Dengan begitu benda tanpa cahaya (partikel, cincin barang, HUD 3D) tetap memakai warna 0…1 seperti biasa.
  const lum = (a) => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  const el = Math.asin(A.sunDir.y), E = Math.PI / (0.8 * (lum(A.skyE) + lum(A.sunE) * Math.sin(el)));
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i] * E, 65000));
  // kubah langit (JPG): sRGB, ulang mendatar
  dome.colorSpace = THREE.SRGBColorSpace;
  dome.wrapS = THREE.RepeatWrapping;
  dome.wrapT = THREE.ClampToEdgeWrapping;
  dome.minFilter = THREE.LinearMipmapLinearFilter;
  dome.anisotropy = 4;
  // penguat kubah: samakan rata-rata kecerahan foto LDR (setelah skyExpand) dengan data HDR di atas cakrawala
  let gain = E;
  try {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(dome.image, 0, 0, 256, 64);
    const px = cx.getImageData(0, 0, 256, 64).data;
    const lin = (c) => { const q = c / 255; return q <= 0.04045 ? q / 12.92 : Math.pow((q + 0.055) / 1.055, 2.4); };
    let lj = 0, n = 0;
    for (let y = 0; y < 64; y++) {
      const vFull = meta.v0 + (1 - (y + 0.5) / 64) * (1 - meta.v0);
      if (vFull < 0.53) continue;
      for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4; let l = 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]); l *= 1 + l * l * 3.2; lj += Math.min(l, 3); n++; }
    }
    let lh = 0, m = 0;
    for (let y = 0; y < h; y++) { if (1 - (y + 0.5) / h < 0.53) continue; for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; lh += Math.min((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * E, 3 * E); m++; } }
    if (n && m && lj > 0) gain = (lh / m) / (lj / n);
  } catch (e) { /* kanvas tidak bisa dibaca: pakai eksposur saja */ }
  hdr.dispose();
  return { sunDir: A.sunDir, sunE: A.sunE.map((v) => v * E), skyE: A.skyE.map((v) => v * E), horizon: A.horizon.map((v) => v * E), half, w, h, dome, v0: meta.v0, gain, E };
}

// Memuat semua aset (tanpa renderer). Hasil: { init(renderer) → R } ; melempar Error kalau ada yang gagal.
export async function loadRealism() {
  const tl = new THREE.TextureLoader();
  const tex = (file, srgb) => new Promise((res) => tl.load(BASE + 'pbr/' + file, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    res(t);
  }, undefined, () => res(null)));
  const sets = {};
  const jobs = Object.entries(SETS).map(async ([k, [id, tile, ns]]) => {
    const [map, normalMap, roughnessMap] = await Promise.all([tex(id + '_diff.jpg', true), tex(id + '_nor.jpg', false), tex(id + '_rough.jpg', false)]);
    if (map && normalMap) sets[k] = { map, normalMap, roughnessMap, tile, ns };
  });
  const [sky] = await Promise.all([loadSky(), ...jobs]);
  if (!sky || Object.keys(sets).length < Object.keys(SETS).length) throw new Error('aset realistis tidak lengkap');
  return {
    init(renderer) {
      const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      for (const S of Object.values(sets)) for (const t of [S.map, S.normalMap, S.roughnessMap]) if (t) t.anisotropy = aniso;
      const envTex = new THREE.DataTexture(sky.half, sky.w, sky.h, THREE.RGBAFormat, THREE.HalfFloatType, THREE.EquirectangularReflectionMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter, THREE.LinearFilter);
      envTex.flipY = true;
      envTex.colorSpace = THREE.LinearSRGBColorSpace;
      envTex.needsUpdate = true;
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromEquirectangular(envTex).texture;
      pm.dispose();
      envTex.dispose();
      const maxc = (a) => Math.max(a[0], a[1], a[2], 1e-6), lum = (a) => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      // Penyesuaian artistik di atas data foto: matahari ×1,3 dan sedikit hangat; cahaya langit dijenuhkan-turun 35 %
      // (tanpa ini sisi teduh dinding putih tampak terlalu biru).
      sky.sunE = sky.sunE0 || sky.sunE; sky.skyE = sky.skyE0 || sky.skyE;
      sky.sunE0 = sky.sunE; sky.skyE0 = sky.skyE;
      { const g = lum(sky.skyE); sky.skyE = sky.skyE.map((v) => v + (g - v) * 0.35); sky.sunE = [sky.sunE[0] * 1.3, sky.sunE[1] * 1.3 * 0.95, sky.sunE[2] * 1.3 * 0.84]; }
      const sunI = maxc(sky.sunE), skyI = maxc(sky.skyE), el = Math.asin(sky.sunDir.y);
      // tanah memantulkan (langit + matahari) × albedo ±0,2, sedikit hangat
      const downE = (lum(sky.skyE) + lum(sky.sunE) * Math.sin(el)) * 0.2;
      const R = {
        sets, env, dome: sky.dome, skyV0: sky.v0, skyGain: sky.gain * 1.22, sunDir: sky.sunDir.clone(),
        sunColor: new THREE.Color(sky.sunE[0] / sunI, sky.sunE[1] / sunI, sky.sunE[2] / sunI), sunIntensity: sunI,
        skyColor: new THREE.Color(sky.skyE[0] / skyI, sky.skyE[1] / skyI, sky.skyE[2] / skyI), skyIntensity: skyI,
        groundColor: new THREE.Color(1.0, 0.93, 0.82).multiplyScalar(downE / skyI),
        ambient: new THREE.Color(sky.skyE[0] / Math.PI, sky.skyE[1] / Math.PI, sky.skyE[2] / Math.PI), // radiansi langit rata-rata
        horizon: new THREE.Color(sky.horizon[0], sky.horizon[1], sky.horizon[2]), bakedExposure: sky.E,
        dyn: { uDynMap: { value: null }, uDynMat: { value: new THREE.Matrix4() }, uDynOn: { value: 0 } },
      };
      R.sunRadiance = { value: R.sunColor.clone().multiplyScalar(R.sunIntensity) };
      R.uSunDir = { value: R.sunDir };
      R.uPost = { value: 1 }; // 1 = dirender lewat post-processing (alfa = topeng AO)
      R.groundMaterial = (key, base = {}, o = {}) => groundMaterial(R, key, base, o);
      R.patch = (m, o) => patchMaterial(R, m, o);
      R.foliage = (m, o) => foliageMaterial(R, m, o);
      return R;
    },
  };
}

// ---------- Material tanah PBR ----------
// UV geometri = meter dunia. Warna verteks = tinta. macro: variasi skala besar supaya ubin tidak terlihat berulang.
function groundMaterial(R, key, base = {}, o = {}) {
  const S = R.sets[key];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMap: R.env, envMapIntensity: o.env ?? 0.5, ...base });
  const cl = (t) => { if (!t) return null; const c = t.clone(); c.repeat.set(1 / S.tile, 1 / S.tile); c.needsUpdate = true; return c; };
  m.map = cl(S.map); m.normalMap = cl(S.normalMap); m.roughnessMap = cl(S.roughnessMap);
  m.normalScale = new THREE.Vector2(S.ns * (o.ns ?? 1), S.ns * (o.ns ?? 1));
  patchMaterial(R, m, { macro: o.macro !== false, dyn: true });
  return m;
}

const DYN_VS_PARS = 'uniform mat4 uDynMat;\nvarying vec4 vDynPos;\n';
const DYN_VS = `
#ifdef USE_INSTANCING
  vDynPos = uDynMat * (modelMatrix * instanceMatrix * vec4(transformed, 1.0));
#else
  vDynPos = uDynMat * (modelMatrix * vec4(transformed, 1.0));
#endif
`;
const DYN_FS_PARS = `uniform highp sampler2DShadow uDynMap;\nuniform float uDynOn;\nvarying vec4 vDynPos;
float dynShadow() {
  vec3 c = vDynPos.xyz;
  if (uDynOn < 0.5 || c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z <= 0.0 || c.z >= 1.0) return 1.0;
  float z = c.z - 0.0009;
  vec2 t = vec2(1.0 / 2048.0);
  float s = texture(uDynMap, vec3(c.xy + t * vec2(-0.75, -0.25), z)) + texture(uDynMap, vec3(c.xy + t * vec2(0.25, -0.75), z)) + texture(uDynMap, vec3(c.xy + t * vec2(0.75, 0.25), z)) + texture(uDynMap, vec3(c.xy + t * vec2(-0.25, 0.75), z));
  vec2 e = min(c.xy, 1.0 - c.xy);
  return mix(1.0, s * 0.25, smoothstep(0.0, 0.07, min(e.x, e.y)));
}
`;
const DYN_FS = `
  { float ds = dynShadow(); reflectedLight.directDiffuse *= ds; reflectedLight.directSpecular *= ds; }
`;
// macro: variasi kecerahan skala besar dari tekstur itu sendiri (dibagi rata-ratanya = mip terkecil)
const MACRO_FS = `
#ifdef USE_MAP
  {
    float mean = max(textureLod(map, vMapUv, 10.0).g, 0.02);
    float m1 = texture2D(map, vMapUv * 0.137 + 0.31).g / mean, m2 = texture2D(map, vMapUv * 0.0191 + 0.57).g / mean;
    diffuseColor.rgb *= mix(1.0, clamp(m1, 0.55, 1.6), 0.45) * mix(1.0, clamp(m2, 0.5, 1.7), 0.55);
  }
#endif
`;
// Menambal material bawaan three: o.dyn = menerima bayangan dinamis; o.macro = variasi skala besar; o.noIBL = (bawaan true)
// cahaya sekitar hanya dari HemisphereLight (pantulan lingkungan tetap), supaya seragam dengan material Lambert.
// Rantai dengan onBeforeCompile yang sudah ada.
export function patchMaterial(R, m, o = {}) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, renderer) => {
    if (prev) prev(sh, renderer);
    if (o.dyn) {
      Object.assign(sh.uniforms, R.dyn);
      sh.vertexShader = DYN_VS_PARS + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>' + DYN_VS);
      sh.fragmentShader = DYN_FS_PARS + sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + DYN_FS);
    }
    if (o.macro) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>' + MACRO_FS);
  };
  m.customProgramCacheKey = () => 'real' + (o.dyn ? 'D' : '') + (o.macro ? 'M' : '') + (prev ? prev.toString().length : 0);
  m.needsUpdate = true;
  return m;
}

// Daun & rumput (material Lambert dua sisi): cahaya sekitar diperkuat (hamburan antar-daun), cahaya matahari menembus daun
// (sisi yang membelakangi matahari tidak hitam; berpendar saat dilihat ke arah matahari), dan alfa keluaran = topeng AO
// (AO layar penuh terlalu menggelapkan kartu daun yang bertumpuk). Rantai dengan onBeforeCompile yang sudah ada.
export function foliageMaterial(R, m, o = {}) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, renderer) => {
    if (prev) prev(sh, renderer);
    sh.uniforms.uSunRad = R.sunRadiance; sh.uniforms.uSunDirW = R.uSunDir; sh.uniforms.uPostOn = R.uPost;
    sh.fragmentShader = 'uniform vec3 uSunRad, uSunDirW; uniform float uPostOn;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  { // warna daun alami: hijau murni (neon) ditarik ke zaitun, lalu diterangkan ke albedo daun sungguhan
    float fl = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
    float gk = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 8.0, 0.0, 1.0); // hanya piksel hijau (bunga & batang tidak diubah)
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(fl) * vec3(1.0, 1.06, 0.62), ${(o.desat ?? 0).toFixed(2)} * gk) * ${(o.gain ?? 1).toFixed(2)};
  }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    vec3 Lv = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
    float back = max(dot(-normal, Lv), 0.0), through = pow(max(dot(normalize(vViewPosition), -Lv), 0.0), 3.0);
    reflectedLight.indirectDiffuse *= ${(o.ambient ?? 1.7).toFixed(2)};
    reflectedLight.directDiffuse += diffuseColor.rgb * uSunRad * (${(o.back ?? 0.26).toFixed(2)} * back + 0.12 + 0.5 * through) * RECIPROCAL_PI * ${(o.trans ?? 1).toFixed(2)};
  }`)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a = mix(gl_FragColor.a, 0.25, uPostOn);');
  };
  m.customProgramCacheKey = () => 'foliage' + JSON.stringify(o) + (prev ? prev.toString().length : 0);
  m.needsUpdate = true;
  return m;
}

// Standar three: material Standard memakai peta lingkungan juga untuk cahaya sekitar (difus). Di game cahaya sekitar
// datang dari HemisphereLight (sama untuk Lambert & Standard), jadi bagian difus IBL dimatikan; pantulan tetap.
export function useHemisphereAmbientOnly() {
  const k = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
  if (THREE.ShaderChunk.lights_fragment_maps.includes(k)) THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.replace(k, '');
}

// Bayangan bawaan three.js (PCF Soft) mengambil 16 sampel tekstur per piksel per lampu. Diganti 2 sampel bilinear
// (8 ambilan) pada diagonal ±0,5 texel: tepi tetap halus selebar ±2 texel, biaya separuhnya.
export function useCheapShadowFilter() {
  const src = THREE.ShaderChunk.shadowmap_pars_fragment, a = src.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )'), b = src.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )', a), f = src.indexOf('float getShadow(');
  if (a < 0 || b < 0 || f < 0 || f > a || src.includes('shadowLerp4')) return;
  const fn = `float shadowLerp4( sampler2D depths, vec2 size, vec2 uv, float compare ) {
		vec2 texel = 1.0 / size, p = uv * size - 0.5, fr = fract( p ), base = ( floor( p ) + 0.5 ) * texel;
		float s00 = texture2DCompare( depths, base, compare ), s10 = texture2DCompare( depths, base + vec2( texel.x, 0.0 ), compare );
		float s01 = texture2DCompare( depths, base + vec2( 0.0, texel.y ), compare ), s11 = texture2DCompare( depths, base + texel, compare );
		return mix( mix( s00, s10, fr.x ), mix( s01, s11, fr.x ), fr.y );
	}
	`;
  const body = `#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			shadow = 0.5 * ( shadowLerp4( shadowMap, shadowMapSize, shadowCoord.xy + texelSize * vec2( 0.55, 0.25 ), shadowCoord.z ) + shadowLerp4( shadowMap, shadowMapSize, shadowCoord.xy - texelSize * vec2( 0.55, 0.25 ), shadowCoord.z ) );
		`;
  THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, f) + fn + src.slice(f, a) + body + src.slice(b);
}

// ---------- Kubah langit foto ----------
export function skyDomeMaterial(R) {
  return new THREE.ShaderMaterial({
    uniforms: { tSky: { value: R.dome }, uSkyP: { value: new THREE.Vector3(R.skyV0, R.skyGain, 0) }, uSunDir: { value: R.sunDir.clone() }, uSunCol: { value: R.sunColor.clone() }, uSunK: { value: 1 } },
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uSunDir, uSunCol; uniform float uSunK;
${SKY_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec2 uvA = skyUv(d), uvB = vec2(fract(uvA.x + 0.5) - 0.5, uvA.y);
  vec2 dxA = dFdx(uvA), dxB = dFdx(uvB), dyA = dFdy(uvA), dyB = dFdy(uvB); // hindari garis di sambungan atan
  vec3 c = skyExpand(textureGrad(tSky, uvA, abs(dxA.x) < abs(dxB.x) ? dxA : dxB, abs(dyA.x) < abs(dyB.x) ? dyA : dyB).rgb);
  vec3 haze = skyAt(normalize(vec3(d.x, 0.03, d.z)), 5.5); // di bawah cakrawala: kabut sewarna kaki langit (sama dengan kabut jarak)
  c = mix(c, haze, smoothstep(0.012, -0.05, d.y));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * uSunK * (pow(sd, 3000.0) * 70.0 + pow(sd, 260.0) * 1.6 + pow(sd, 28.0) * 0.1);
  gl_FragColor = vec4(c, 1.0);
}`,
  });
}

// ---------- Bayangan dinamis ----------
// Peta kedalaman 2048² seluas ±half m di sekitar titik fokus, dari arah matahari; hanya benda di DYN_LAYER.
export function createDynShadow(renderer, scene, R, size = 2048, half = 30) {
  const dt = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  dt.compareFunction = THREE.LessEqualCompare;
  dt.magFilter = dt.minFilter = THREE.LinearFilter;
  const rt = new THREE.WebGLRenderTarget(size, size, { depthTexture: dt, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 500);
  // Adegan bayangan tersendiri berisi "proxy" tiap pembuat bayangan (mesh ber-layer DYN_LAYER di adegan utama): geometri,
  // matriks dunia, kerangka & data instans dipinjam dari aslinya. Adegan utama TIDAK dirender dua kali per frame:
  // - tanpa penelusuran ulang ribuan objek (updateMatrixWorld + projectObject),
  // - lampu adegan utama tidak berubah-ubah antar-pass (dulu: pass ini tanpa lampu → three.js mengevaluasi ulang
  //   program SEMUA material tiap frame, ±1,4 ms),
  // - satu material kedalaman per jenis objek (biasa / instans / berkerangka) → program tidak berganti-ganti.
  const ps = new THREE.Scene();
  ps.matrixWorldAutoUpdate = false;
  const mkDepth = () => new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const dMesh = mkDepth(), dInst = mkDepth(), dSkin = mkDepth();
  const proxies = new Map(), seen = new Set(), BIT = 1 << DYN_LAYER;
  let tick = 0;
  function scan() { // daftar pembuat bayangan diperbarui berkala (objek baru/terhapus)
    seen.clear();
    scene.traverse((o) => {
      if (!o.isMesh || !(o.layers.mask & BIT)) return;
      seen.add(o);
      if (proxies.has(o)) return;
      let p;
      if (o.isInstancedMesh) { p = new THREE.InstancedMesh(o.geometry, dInst, 1); p.instanceMatrix = o.instanceMatrix; p.count = o.count; }
      else if (o.isSkinnedMesh) { p = new THREE.SkinnedMesh(o.geometry, dSkin); p.bindMode = o.bindMode; p.skeleton = o.skeleton; p.bindMatrix = o.bindMatrix; p.bindMatrixInverse = o.bindMatrixInverse; }
      else p = new THREE.Mesh(o.geometry, dMesh);
      p.matrixAutoUpdate = false;
      p.matrixWorldAutoUpdate = false;
      p.matrixWorld = o.matrixWorld; // dipinjam (objek yang sama), selalu mengikuti aslinya
      p.frustumCulled = o.frustumCulled && !o.isInstancedMesh && !o.isSkinnedMesh;
      ps.add(p);
      proxies.set(o, p);
    });
    proxies.forEach(dropGone);
  }
  const dropGone = (p, o) => { if (!seen.has(o)) { ps.remove(p); proxies.delete(o); } };
  // penyelarasan per frame; forEach dengan fungsi tetap (for…of pada Map membuat satu array per entri → sampah 60 KB/frame)
  const R2 = (half * 1.45 + 12) ** 2;
  let fx = 0, fz = 0;
  const syncOne = (p, o) => {
    if (!o.isInstancedMesh) { // jauh dari area bayangan (mis. kendaraan parkir di ujung peta): lewati tanpa menelusuri induknya
      const e = o.matrixWorld.elements, dx = e[12] - fx, dz = e[14] - fz;
      if (dx * dx + dz * dz > R2) { p.visible = false; return; }
    }
    let vis = true, a = o;
    for (; a.parent; a = a.parent) if (!a.visible) { vis = false; break; }
    p.visible = vis && a === scene && a.visible !== false;
    if (!p.visible) return;
    if (p.geometry !== o.geometry) p.geometry = o.geometry;
    if (o.isInstancedMesh) { p.count = o.count; if (p.instanceMatrix !== o.instanceMatrix) p.instanceMatrix = o.instanceMatrix; }
    else if (o.isSkinnedMesh && p.skeleton !== o.skeleton) { p.skeleton = o.skeleton; p.bindMatrix = o.bindMatrix; p.bindMatrixInverse = o.bindMatrixInverse; }
  };
  function sync(focus) {
    if (tick++ % 30 === 0) scan();
    fx = focus.x; fz = focus.z;
    proxies.forEach(syncOne);
  }
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const right = new THREE.Vector3(), up = new THREE.Vector3(), f = new THREE.Vector3();
  const texel = 2 * half / size;
  // Tekstur kedalaman harus sudah ada di GPU sebelum material mana pun memakainya: sampler bayangan yang terikat ke
  // tekstur kosong membuat GPU (Metal) melewatkan seluruh draw call → tanah tidak tergambar sampai pass ini pertama jalan.
  { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.clear(true, true, false); renderer.setRenderTarget(prev); }
  R.dyn.uDynMap.value = dt;
  R.dyn.uDynOn.value = 1;
  return {
    camera: cam, target: rt,
    cast(obj) { obj.traverse((o) => { if (o.isMesh) o.layers.enable(DYN_LAYER); }); },
    get casters() { return proxies.size; },
    // prasyarat: matriks dunia adegan utama sudah diperbarui untuk frame ini (scene.updateMatrixWorld() di loop game)
    update(focus) {
      sync(focus);
      // basis cahaya; fokus dibulatkan ke kisi texel supaya tepi bayangan tidak bergetar saat kamera bergerak
      cam.position.copy(focus).addScaledVector(R.sunDir, 250);
      cam.up.set(0, 1, 0);
      cam.lookAt(focus);
      cam.updateMatrixWorld();
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      const lx = focus.dot(right), ly = focus.dot(up);
      f.copy(focus).addScaledVector(right, Math.round(lx / texel) * texel - lx).addScaledVector(up, Math.round(ly / texel) * texel - ly);
      cam.position.copy(f).addScaledVector(R.sunDir, 250);
      cam.updateMatrixWorld();
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      R.dyn.uDynMat.value.multiplyMatrices(bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      const ac = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setRenderTarget(rt);
      renderer.render(ps, cam);
      renderer.setRenderTarget(null);
      renderer.autoClear = ac;
    },
  };
}
