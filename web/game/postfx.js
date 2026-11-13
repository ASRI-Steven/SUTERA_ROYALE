// Post-processing game (mode realistis). Urutan per frame:
//   adegan → target HDR (half-float) + tekstur kedalaman; senjata orang pertama digambar ke target yang sama dengan
//     rentang kedalaman 0…0,02 (gl.depthRange) → selalu di depan, tanpa menghapus kedalaman adegan
//   → AO setengah resolusi (SAO, normal dari kedalaman) + blur searah kedalaman
//   → bloom (rantai mip) → sinar matahari (blur radial dari kedalaman langit)
//   → komposit (satu pass layar penuh): AO (upsample bilateral) + kabut atmosfer (warna = langit di arah itu, menipis
//     dengan ketinggian) + bloom + sinar + eksposur, ACES, grading, vinyet, dither
//   → FXAA → layar
// Tiap tingkat kualitas (TIERS) mematikan/meringankan tahap tertentu; main.js menurunkan tingkat bila FPS jatuh.
import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SKY_GLSL } from '../map/realism.js';

export const TIERS = [
  { id: 'ultra', label: 'Ultra', post: true, ao: 12, rays: 28, bloom: true },
  { id: 'high', label: 'Tinggi', post: true, ao: 8, rays: 18, bloom: true },
  { id: 'medium', label: 'Sedang', post: true, ao: 6, rays: 0, bloom: true },
  { id: 'low', label: 'Rendah', post: true, ao: 0, rays: 0, bloom: true },
  { id: 'off', label: 'Hemat', post: false, ao: 0, rays: 0, bloom: false },
];

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DEPTH = `
uniform sampler2D tDepth; uniform vec2 uNF; uniform vec2 uP;
float viewZ(float d) { return (uNF.x * uNF.y) / ((uNF.y - uNF.x) * d - uNF.y); }
vec3 vpos(vec2 uv, float d) { float z = viewZ(d); return vec3((uv * 2.0 - 1.0) * uP * -z, z); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 pack16(float v) { v = clamp(v, 0.0, 0.99998); float hi = floor(v * 255.0) / 255.0; return vec2(hi, (v - hi) * 255.0); }
float unpack16(vec2 p) { return p.x + p.y / 255.0; }
const float VMD = 0.021; // kedalaman ≤ ini = senjata orang pertama (digambar dengan gl.depthRange(0, 0.02))
`;
export function createPostFX(renderer, opt = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(geo);
  quad.frustumCulled = false;
  const qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mk = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const draw = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, qcam); };

  // ---------- Target ----------
  const depthTex = new THREE.DepthTexture(2, 2, THREE.UnsignedInt248Type);
  depthTex.format = THREE.DepthStencilFormat;
  const hdr = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
  const rtScene = new THREE.WebGLRenderTarget(2, 2, { ...hdr, depthBuffer: true, stencilBuffer: true, depthTexture: depthTex });
  const ldr = { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false };
  const rtLDR = new THREE.WebGLRenderTarget(2, 2, ldr);
  const near8 = { ...ldr, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  const rtAO = new THREE.WebGLRenderTarget(2, 2, near8), rtAO2 = new THREE.WebGLRenderTarget(2, 2, near8);
  const rtRays = new THREE.WebGLRenderTarget(2, 2, ldr);
  const BL = 5, bloomRT = [];
  for (let i = 0; i < BL; i++) bloomRT.push(new THREE.WebGLRenderTarget(2, 2, { ...hdr, depthBuffer: false, stencilBuffer: false }));

  // ---------- Uniform bersama ----------
  const U = {
    tDepth: { value: depthTex }, uNF: { value: new THREE.Vector2(0.1, 20000) }, uP: { value: new THREE.Vector2(1, 1) },
    uTexel: { value: new THREE.Vector2(1, 1) }, uAOTexel: { value: new THREE.Vector2(1, 1) },
    uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    tSky: { value: null }, uSkyP: { value: new THREE.Vector3(0.47, 1, 0) },
    uFog: { value: new THREE.Vector3(1 / 2400, 1, 1 / 900) }, uFogCol: { value: new THREE.Color('#dfe6ee') }, uFogOn: { value: 1 },
    uSunCol: { value: new THREE.Color('#ffe9c4') }, uSunUV: { value: new THREE.Vector2(0.5, 1.5) }, uSunVis: { value: 0 }, uAspect: { value: 1 },
    uExposure: { value: 1 }, uTime: { value: 0 }, uUnder: { value: 0 },
  };
  const P = { // parameter tampilan (bisa diatur dari luar)
    aoRadius: { value: 0.7 }, aoInt: { value: 0.34 }, aoLum: { value: 0.3 },
    bloomThr: { value: 1.7 }, bloomKnee: { value: 0.7 }, bloom: { value: 0.22 }, rays: { value: 0.5 },
    sat: { value: 1.02 }, con: { value: 1.04 }, vig: { value: 0.2 }, tone: { value: 1.0 }, grain: { value: 1.0 },
  };

  // ---------- AO ----------
  const aoMats = new Map();
  const aoMat = (n) => {
    if (!aoMats.has(n)) aoMats.set(n, mk(`#define N ${n}
varying vec2 vUv; uniform vec2 uTexel; uniform float uRadius, uAOInt;
${DEPTH}
vec2 snap(vec2 uv) { return (floor(uv / uTexel) + 0.5) * uTexel; } // pusat texel kedalaman
void main() {
  vec2 uv0 = snap(vUv);
  float d = texture2D(tDepth, uv0).x;
  if (d >= 0.999999) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
  if (d <= VMD) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; } // senjata orang pertama: tanpa AO
  vec3 P = vpos(uv0, d);
  float dist = -P.z;
  if (dist > 150.0) { gl_FragColor = vec4(1.0, pack16(dist / 220.0), 1.0); return; }
  vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
  vec3 Pl = vpos(uv0 - ex, texture2D(tDepth, uv0 - ex).x), Pr = vpos(uv0 + ex, texture2D(tDepth, uv0 + ex).x);
  vec3 Pd = vpos(uv0 - ey, texture2D(tDepth, uv0 - ey).x), Pu = vpos(uv0 + ey, texture2D(tDepth, uv0 + ey).x);
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 n = normalize(cross(dx, dy));
  vec2 rUV = uRadius / (2.0 * dist * uP);
  float cap = 0.085 / max(rUV.y, 1e-6);
  if (cap < 1.0) rUV *= cap;
  float rw = rUV.y * 2.0 * dist * uP.y, r2 = rw * rw;
  float ang = ign(gl_FragCoord.xy) * 6.2831853, bias = 0.012 + dist * 0.0018, sum = 0.0;
  for (int i = 0; i < N; i++) {
    float fi = (float(i) + 0.5) / float(N), a = ang + fi * 15.08;
    vec2 suv = snap(uv0 + vec2(cos(a), sin(a)) * rUV * fi);
    vec3 v = vpos(suv, texture2D(tDepth, suv).x) - P;
    float vv = dot(v, v), f = max(r2 - vv, 0.0);
    sum += f * f * f * max((dot(v, n) - bias) / (vv + 0.0008), 0.0);
  }
  float ao = max(0.28, 1.0 - sum * uAOInt * 5.0 / (r2 * r2 * r2 * float(N))); // tidak pernah hitam pekat
  ao = mix(ao, 1.0, smoothstep(80.0, 150.0, dist));
  gl_FragColor = vec4(ao, pack16(dist / 220.0), 1.0);
}`, { tDepth: U.tDepth, uNF: U.uNF, uP: U.uP, uTexel: U.uTexel, uRadius: P.aoRadius, uAOInt: P.aoInt }));
    return aoMats.get(n);
  };
  const blurU = { tAO: { value: null }, uDir: { value: new THREE.Vector2() } };
  const blurMat = mk(`varying vec2 vUv; uniform sampler2D tAO; uniform vec2 uDir;
float unpack16(vec2 p) { return p.x + p.y / 255.0; }
void main() {
  vec4 c = texture2D(tAO, vUv);
  float d0 = unpack16(c.gb), sum = c.r * 0.227, ws = 0.227;
  const float G[3] = float[3](0.194, 0.121, 0.054);
  for (int i = 1; i <= 3; i++) for (int s = -1; s <= 1; s += 2) {
    vec4 q = texture2D(tAO, vUv + uDir * float(i * s));
    float w = G[i - 1] * step(abs(unpack16(q.gb) - d0), 0.03 * d0 + 0.0006);
    sum += q.r * w; ws += w;
  }
  gl_FragColor = vec4(sum / ws, c.gb, 1.0);
}`, blurU);

  // ---------- Bloom ----------
  const bU = { tSrc: { value: null }, uSrcTexel: { value: new THREE.Vector2() } };
  const SAFE = 'vec3 safe(vec3 c) { return (isnan(c.r) || isnan(c.g) || isnan(c.b)) ? vec3(0.0) : clamp(c, 0.0, 64.0); }';
  const prefMat = mk(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uSrcTexel; uniform float uThr, uKnee, uExposure;
${SAFE}
void main() {
  vec3 s = vec3(0.0); float ws = 0.0;
  for (int j = -1; j <= 1; j += 2) for (int i = -1; i <= 1; i += 2) {
    vec3 c = safe(texture2D(tSrc, vUv + vec2(float(i), float(j)) * uSrcTexel).rgb) * uExposure;
    float w = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
    s += c * w; ws += w;
  }
  s /= ws;
  float br = max(s.r, max(s.g, s.b)), soft = clamp(br - uThr + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  gl_FragColor = vec4(s * max(soft, br - uThr) / max(br, 1e-4), 1.0);
}`, { ...bU, uThr: P.bloomThr, uKnee: P.bloomKnee, uExposure: U.uExposure });
  const downMat = mk(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uSrcTexel;
void main() { vec3 s = vec3(0.0); for (int j = -1; j <= 1; j += 2) for (int i = -1; i <= 1; i += 2) s += texture2D(tSrc, vUv + vec2(float(i), float(j)) * uSrcTexel).rgb; gl_FragColor = vec4(s * 0.25, 1.0); }`, bU);
  const upMat = mk(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uSrcTexel;
void main() { vec3 s = vec3(0.0); for (int j = -1; j <= 1; j += 2) for (int i = -1; i <= 1; i += 2) s += texture2D(tSrc, vUv + vec2(float(i), float(j)) * uSrcTexel * 0.75).rgb; gl_FragColor = vec4(s * 0.25, 0.6); }`, bU, { blending: THREE.NormalBlending, transparent: true }); // tingkat lebih kasar dicampur 60 % ke tingkat di atasnya

  // ---------- Sinar matahari (god rays): langit yang terlihat di sekitar matahari, diblur radial ke arah matahari ----------
  const rayMats = new Map();
  const rayMat = (n) => {
    if (!rayMats.has(n)) rayMats.set(n, mk(`#define NS ${n}
varying vec2 vUv; uniform sampler2D tDepth; uniform vec2 uSunUV; uniform float uAspect;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 delta = (uSunUV - vUv) * (0.92 / float(NS)), uv = vUv + delta * ign(gl_FragCoord.xy);
  float illum = 0.0, decay = 1.0;
  for (int i = 0; i < NS; i++) {
    uv += delta;
    vec2 q = (uv - uSunUV) * vec2(uAspect, 1.0);
    float glow = exp(-dot(q, q) * 5.0);
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float skyv = inside > 0.5 ? step(0.999999, texture2D(tDepth, uv).x) : 1.0; // di luar layar: anggap langit
    illum += skyv * glow * decay;
    decay *= 0.965;
  }
  gl_FragColor = vec4(vec3(illum / float(NS)), 1.0);
}`, { tDepth: U.tDepth, uSunUV: U.uSunUV, uAspect: U.uAspect }));
    return rayMats.get(n);
  };

  // ---------- Komposit: AO + kabut atmosfer + bloom + sinar + tonemap (satu pass layar penuh) ----------
  const compU = { tColor: { value: rtScene.texture }, tAO: { value: rtAO.texture }, tDepth: U.tDepth, uNF: U.uNF, uP: U.uP, uAOTexel: U.uAOTexel, uCamWorld: U.uCamWorld, uCamPos: U.uCamPos, uFog: U.uFog, uFogCol: U.uFogCol, uFogOn: U.uFogOn, uAOLum: P.aoLum, tSky: U.tSky, uSkyP: U.uSkyP,
    tBloom: { value: bloomRT[0].texture }, tRays: { value: rtRays.texture }, uBloom: P.bloom, uRays: P.rays, uSunCol: U.uSunCol, uSunVis: U.uSunVis, uExposure: U.uExposure, uSat: P.sat, uCon: P.con, uVig: P.vig, uTone: P.tone, uGrain: P.grain, uTime: U.uTime, uUnder: U.uUnder };
  const compMats = new Map();
  const compMat = (ao, sky, bloom, rays) => {
    const k = (ao ? 1 : 0) + (sky ? 2 : 0) + (bloom ? 4 : 0) + (rays ? 8 : 0);
    if (!compMats.has(k)) compMats.set(k, mk(`${ao ? '#define AO' : ''}
${sky ? '#define SKYMAP' : ''}
${bloom ? '#define BLOOM' : ''}
${rays ? '#define RAYS' : ''}
varying vec2 vUv; uniform sampler2D tColor, tAO, tBloom, tRays; uniform vec2 uAOTexel; uniform mat4 uCamWorld; uniform vec3 uCamPos, uFog, uFogCol, uSunCol;
uniform float uFogOn, uAOLum, uBloom, uRays, uSunVis, uExposure, uSat, uCon, uVig, uTone, uGrain, uTime, uUnder;
${DEPTH}
#ifdef SKYMAP
${SKY_GLSL}
#endif
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(O * RRTAndODTFit(I * (c / 0.6)), 0.0, 1.0);
}
void main() {
  vec2 uv = vUv + vec2(sin(vUv.y * 34.0 + uTime * 2.1), cos(vUv.x * 27.0 + uTime * 1.7)) * 0.0022 * uUnder; // di bawah air: bergoyang
  vec4 src = texture2D(tColor, uv);
  vec3 col = src.rgb;
  float d = texture2D(tDepth, uv).x;
  if (d < 0.999999 && d > VMD) { // bukan langit, bukan senjata orang pertama
    vec3 vp = vpos(uv, d);
    float dist = length(vp);
#ifdef AO
    {
      float dn = min(-vp.z / 220.0, 0.99998), ao = 0.0, ws = 0.0;
      vec2 p = uv / uAOTexel - 0.5, f = fract(p), b = (floor(p) + 0.5) * uAOTexel;
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        vec4 s = texture2D(tAO, b + vec2(float(i), float(j)) * uAOTexel);
        float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) * step(abs(unpack16(s.gb) - dn), 0.035 * dn + 0.0007) + 0.0001;
        ao += s.r * w; ws += w;
      }
      ao /= ws;
      ao = mix(1.0, ao, clamp(src.a, 0.0, 1.0)); // alfa adegan = topeng AO (daun: 0,25)
      col *= mix(ao, 1.0, clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)) * uAOLum, 0.0, 0.6)); // AO terutama di tempat teduh
    }
#endif
    vec3 wdir = mat3(uCamWorld) * (vp / dist);
    float cy = max(uCamPos.y, 0.0), hy = max(uCamPos.y + wdir.y * dist, 0.0), dy = hy - cy;
    float hf = abs(dy) > 0.5 ? (exp(-uFog.z * cy) - exp(-uFog.z * hy)) / (uFog.z * dy) : exp(-uFog.z * cy);
    float fg = (1.0 - exp(-dist * uFog.x * hf)) * uFogOn;
#ifdef SKYMAP
    vec3 fc = min(skyAt(normalize(vec3(wdir.x, 0.03 + max(wdir.y, 0.0) * 0.3, wdir.z)), 5.5), vec3(1.25)); // ke arah matahari kabut tidak sampai memutihkan layar
#else
    vec3 fc = uFogCol;
#endif
    col = mix(col, fc, fg);
  }
  vec3 c = col * uExposure;
#ifdef BLOOM
  c += texture2D(tBloom, uv).rgb * uBloom;
#endif
#ifdef RAYS
  c += uSunCol * texture2D(tRays, uv).r * uRays * uSunVis * uExposure;
#endif
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * uVig;
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uCon + 0.5;
  c += (vec3(-0.010, 0.0, 0.016) * (1.0 - l) + vec3(0.016, 0.006, -0.018) * l) * uTone; // teduh sejuk, terang hangat
  c = clamp(c, 0.0, 1.0);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  c += (ign(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0 * uGrain; // dither: gradasi langit tanpa pita
  gl_FragColor = vec4(c, 1.0);
}`, compU));
    return compMats.get(k);
  };
  const fxaaMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: rtLDR.texture }, resolution: { value: new THREE.Vector2() } }, vertexShader: VS, fragmentShader: FXAAShader.fragmentShader, depthTest: false, depthWrite: false, toneMapped: false });

  // ---------- Ukuran ----------
  const v2 = new THREE.Vector2(), v3 = new THREE.Vector3();
  let W = 0, H = 0, tier = TIERS[0], hasSky = false;
  function resize() {
    renderer.getDrawingBufferSize(v2);
    const w = Math.max(2, v2.x | 0), h = Math.max(2, v2.y | 0);
    if (w === W && h === H) return;
    W = w; H = h;
    rtScene.setSize(w, h); rtLDR.setSize(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    rtAO.setSize(hw, hh); rtAO2.setSize(hw, hh);
    rtRays.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    for (let i = 0; i < BL; i++) bloomRT[i].setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)));
    U.uTexel.value.set(1 / w, 1 / h);
    U.uAOTexel.value.set(1 / hw, 1 / hh);
    U.uAspect.value = w / h;
    fxaaMat.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  return {
    U, P, TIERS,
    get tier() { return tier; },
    setTier(t) { tier = typeof t === 'number' ? TIERS[Math.max(0, Math.min(TIERS.length - 1, t))] : t; },
    setSky(tex, v0, gain) { U.tSky.value = tex; U.uSkyP.value.set(v0, gain, 0); hasSky = !!tex; },
    get targets() { return { rtScene, depthTex }; },
    // st: { sunDir (dunia, ke arah matahari), exposure, under (0/1), fogOn, time }
    render(scene, camera, vm, st = {}) {
      resize();
      const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.autoClear = true;
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);
      renderer.autoClear = false;
      if (vm) { // senjata orang pertama: target yang sama, kedalaman dipadatkan ke 0…0,02 → selalu di depan adegan
        const gl = renderer.getContext();
        gl.depthRange(0, 0.02);
        renderer.render(vm.scene, vm.camera);
        gl.depthRange(0, 1);
      }
      // uniform kamera (matrixWorld sudah diperbarui oleh render di atas)
      const pe = camera.projectionMatrix.elements;
      U.uNF.value.set(camera.near, camera.far);
      U.uP.value.set(1 / pe[0], 1 / pe[5]);
      U.uCamWorld.value.copy(camera.matrixWorld);
      U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      U.uExposure.value = st.exposure ?? 1;
      U.uTime.value = st.time ?? 0;
      U.uUnder.value = st.under ? 1 : 0;
      U.uFogOn.value = st.fogOn === false || st.under ? 0 : 1;
      U.uFog.value.x = (1 / 3000) / (1 + Math.max(0, U.uCamPos.value.y) / 450); // dari udara: kabut lebih tipis
      const useAO = tier.ao > 0 && !st.under;
      if (useAO) {
        draw(aoMat(tier.ao), rtAO);
        blurU.tAO.value = rtAO.texture; blurU.uDir.value.set(U.uAOTexel.value.x, 0); draw(blurMat, rtAO2);
        blurU.tAO.value = rtAO2.texture; blurU.uDir.value.set(0, U.uAOTexel.value.y); draw(blurMat, rtAO);
      }
      if (tier.bloom) {
        bU.tSrc.value = rtScene.texture; bU.uSrcTexel.value.set(1 / W, 1 / H); draw(prefMat, bloomRT[0]);
        for (let i = 1; i < BL; i++) { bU.tSrc.value = bloomRT[i - 1].texture; bU.uSrcTexel.value.set(1 / bloomRT[i - 1].width, 1 / bloomRT[i - 1].height); draw(downMat, bloomRT[i]); }
        for (let i = BL - 1; i > 0; i--) { bU.tSrc.value = bloomRT[i].texture; bU.uSrcTexel.value.set(1 / bloomRT[i].width, 1 / bloomRT[i].height); draw(upMat, bloomRT[i - 1]); }
      }
      let rays = false;
      if (tier.rays > 0 && st.sunDir && !st.under) { // posisi matahari di layar; hanya bila matahari di depan kamera
        v3.copy(U.uCamPos.value).addScaledVector(st.sunDir, 1000).project(camera);
        const fwd = v3.z < 1 && Math.abs(v3.x) < 2.2 && v3.y < 2.6 && v3.y > -1.4;
        if (fwd) {
          U.uSunUV.value.set(v3.x * 0.5 + 0.5, v3.y * 0.5 + 0.5);
          const off = Math.max(Math.abs(v3.x) - 1, v3.y - 1, 0); // makin jauh di luar layar makin lemah
          U.uSunVis.value = Math.max(0, 1 - off / 1.4);
          rays = U.uSunVis.value > 0.01;
          if (rays) draw(rayMat(tier.rays), rtRays);
        }
      }
      draw(compMat(useAO, hasSky, tier.bloom, rays), rtLDR);
      draw(fxaaMat, null);
      renderer.setRenderTarget(null);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    },
    // kompilasi semua varian shader sekarang (layar muat), supaya pergantian tingkat di tengah permainan tidak tersendat
    warm() {
      resize();
      const sky = hasSky;
      for (const T of TIERS) {
        if (!T.post) continue;
        if (T.ao) draw(aoMat(T.ao), rtAO);
        if (T.rays) draw(rayMat(T.rays), rtRays);
        for (const r of T.rays ? [false, true] : [false]) for (const a of T.ao ? [false, true] : [false]) draw(compMat(a, sky, T.bloom, r), rtLDR);
      }
      blurU.tAO.value = rtAO.texture; draw(blurMat, rtAO2);
      bU.tSrc.value = rtScene.texture; draw(prefMat, bloomRT[0]); draw(downMat, bloomRT[1]); bU.tSrc.value = bloomRT[1].texture; draw(upMat, bloomRT[0]);
      draw(fxaaMat, rtAO2);
      renderer.setRenderTarget(null);
    },
    dispose() { for (const t of [rtScene, rtLDR, rtAO, rtAO2, rtRays, ...bloomRT]) t.dispose(); depthTex.dispose(); },
  };
}
