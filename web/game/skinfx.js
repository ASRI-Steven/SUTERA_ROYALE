// Pola skin (GLSL) untuk karakter & senjata. Tanpa tekstur: semua motif dihitung di shader dari posisi ruang diam /
// ruang objek (meter), jadi menempel di permukaan (tidak "berenang"), tajam di jarak berapa pun, dan tanpa unduhan.
// Dipakai map/rig.js (tubuh karakter ber-kulit), game/weapons.js (senjata & lengan orang pertama) dan game/skins.js
// (model senjata dunia + katalog). Berkas ini tidak mengimpor apa pun supaya bisa dipakai dari mana saja.
//
// Karakter: nomor pola (fx) per karakter disimpan di palet baris tekstur tulang (alfa slot "fixed"), jadi kerumunan
// ber-instans tetap satu material. Slot warna: 0 kulit, 1 tangan, 2 atasan, 3 lengan, 4 manset, 5 celana, 6 dalaman, 7 tetap.
// Senjata: nomor skin = define saat kompilasi (satu varian material per skin yang sedang dipakai).
// Animasi: satu uniform waktu bersama (SF_U.uSfT, detik, berulang tiap 600 dtk) — dimajukan tickSkins() sekali per frame
// (lobi: lobby.frame, pertandingan: view-model senjata). Efek senjata pemain (pendar isi ulang/periksa, panas, kilat
// tembakan, sapuan cahaya) lewat uniform uSfG milik view-model (game/weapons.js).

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// '#rrggbb' → 'vec3(r, g, b)' linear
export const L = (hex) => { const n = parseInt(hex.slice(1), 16); return `vec3(${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255).toFixed(4)).join(', ')})`; };

// ---------- Waktu animasi & detak per frame ----------
export const SF_U = { uSfT: { value: 0 } };
const TICKS = new Set();
let lastTick = -1;
// sekali per frame (pemanggil ganda dalam satu frame diabaikan): waktu animasi + pembaruan yang didaftarkan (aura, dsb.)
export function tickSkins(now = performance.now()) {
  if (now === lastTick) return;
  const dt = lastTick < 0 ? 0 : Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;
  SF_U.uSfT.value = (now / 1000) % 600;
  for (const f of TICKS) f(dt, SF_U.uSfT.value);
}
export function onSkinTick(f) { TICKS.add(f); return () => TICKS.delete(f); }

// ---------- Fungsi bersama ----------
export const SKIN_COMMON = `
uniform float uSfT;
float sfH3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.11, 0.23, 0.37)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sfN3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sfH3(i), sfH3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sfH3(i + vec3(0.0, 1.0, 0.0)), sfH3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(sfH3(i + vec3(0.0, 0.0, 1.0)), sfH3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sfH3(i + vec3(0.0, 1.0, 1.0)), sfH3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float sfFbm(vec3 p) { return 0.5 * sfN3(p) + 0.3 * sfN3(p * 2.07 + 7.1) + 0.2 * sfN3(p * 4.13 + 13.7); }
float sfH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 sfH22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float sfN2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sfH2(i), sfH2(i + vec2(1.0, 0.0)), f.x), mix(sfH2(i + vec2(0.0, 1.0)), sfH2(i + vec2(1.0, 1.0)), f.x), f.y); }
// proyeksi 2D menurut arah permukaan: depan/belakang → (x, y), samping → (z, y), atas/bawah → (x, z)
vec2 sfProj(vec3 p, vec3 n) { vec3 a = abs(n); return a.y > max(a.x, a.z) ? p.xz : (a.x > a.z ? p.zy : p.xy); }
vec3 sfHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
// garis halus tanpa gerigi: d = jarak ke garis, w = setengah lebar (satuan d)
float sfAA(float d, float w) { float a = max(fwidth(d), 1e-5); return 1.0 - smoothstep(w - a, w + a, d); }
// kamuflase empat warna dari noise 3D (tanpa sambungan di mana pun)
vec3 sfCamo4(vec3 p, float s, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
  float a = sfN3(p * s) * 0.65 + sfN3(p * s * 2.1 + 5.0) * 0.35;
  float b = sfN3(p * s * 0.7 + 17.0) * 0.6 + sfN3(p * s * 1.9 + 31.0) * 0.4;
  float d = sfN3(p * s * 1.3 + 53.0);
  vec3 c = c0;
  c = mix(c, c1, step(0.52, a));
  c = mix(c, c2, step(0.56, b));
  c = mix(c, c3, step(0.7, d));
  return c;
}
// kamuflase hutan: noda bertepi organik (ruang dibengkokkan noise), tepi tajam tapi halus
vec3 sfCamoW(vec3 p, float s, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
  vec3 q = p * s;
  q += vec3(sfN3(q * 1.7 + 3.1), sfN3(q * 1.7 + 9.2), 0.0) * 0.9;
  float a = sfN3(q), b = sfN3(q * 1.3 + 11.0), c = sfN3(q * 0.8 + 23.0);
  vec3 r = c0;
  r = mix(r, c1, smoothstep(0.47, 0.5, a));
  r = mix(r, c2, smoothstep(0.55, 0.58, b));
  r = mix(r, c3, smoothstep(0.63, 0.66, c));
  return r;
}
// batik parang: pita diagonal berisi "lidah" bergelombang + deret belah ketupat di garis pemisah. P = lebar pita (m)
// w (keluar) = posisi melintang di dalam pita (untuk kilau berjalan)
vec3 sfParang(vec2 uv, float P, vec3 cA, vec3 cB, vec3 cC, out float ln) {
  vec2 r = vec2(uv.x + uv.y, uv.y - uv.x) * 0.7071 / P;
  float bi = floor(r.y), fv = fract(r.y), ed = min(fv, 1.0 - fv);
  float sep = 1.0 - smoothstep(0.07, 0.1, ed);
  float dia = 1.0 - smoothstep(0.05, 0.07, abs(fract(r.x + 0.5 * mod(bi, 2.0)) - 0.5) * 0.45 + ed);
  float w = fv - 0.5 + 0.19 * sin(3.1416 * r.x + bi * 3.1416);
  float body = 1.0 - smoothstep(0.1, 0.13, abs(w));
  float line = 1.0 - smoothstep(0.012, 0.03, abs(abs(w) - 0.13));
  float inner = 1.0 - smoothstep(0.01, 0.024, abs(w));
  vec3 c = mix(cB, cA, body);
  c = mix(c, cC, max(line, inner * 0.85));
  c = mix(c, cC, sep);
  ln = max(line, inner);
  return mix(c, cA, dia * sep);
}
// sisik bertumpuk (genting): xy = posisi di dalam sisik (÷ jari-jari, −1..1), z = jarak dari pusat (0..1, 1 = tepi), w = id acak
vec4 sfScale4(vec2 p) {
  const float H = 0.5, R = 0.64;
  float j0 = floor(p.y / H);
  for (int k = 2; k >= -1; k--) { // baris teratas menang (menutupi baris di bawahnya)
    float j = j0 + float(k), par = 0.5 * mod(j, 2.0);
    float cx = floor(p.x - par) + 0.5 + par;
    vec2 d = p - vec2(cx, j * H);
    float r = length(d);
    if (r < R && d.y < 0.12) return vec4(d / R, r / R, sfH2(vec2(cx, j)));
  }
  return vec4(0.0, 0.0, 1.0, 0.0);
}
// awan mega mendung: jarak bertanda ke gumpalan (gabungan lingkaran acak yang memanjang mendatar); < 0 = di dalam awan
float sfCloud(vec2 p) {
  p.y *= 1.55;
  vec2 g = floor(p), f = fract(p);
  float d = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), h = sfH22(g + o), c = o + 0.25 + 0.5 * h;
    float r = 0.26 + 0.2 * h.x;
    d = min(d, length(f - c) - r);
    d = min(d, length(f - c - vec2(0.3, -0.06)) - r * 0.72);
    d = min(d, length(f - c + vec2(0.29, 0.07)) - r * 0.62);
  }
  return d;
}
// anyaman karbon (twill 2/2): kilau berkas serat 0..1
float sfCarbon(vec2 uv) {
  vec2 c = floor(uv), f = fract(uv);
  float warp = step(2.0, mod(c.x - c.y + 400.0, 4.0));
  float along = mix(f.x, f.y, warp), across = mix(f.y, f.x, warp);
  return sin(across * 3.1416) * (0.45 + 0.55 * sin(along * 3.1416));
}
// kisi segi enam: xy = id sel, z = jarak ke tepi sel (0 di tepi, 0.5 di pusat)
vec3 sfHex(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  vec4 r = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
  vec2 q = abs(r.xy);
  return vec3(r.zw, 0.5 - max(dot(q, s * 0.5), q.x));
}
// Voronoi 2D: x = jarak ke tepi sel, y = id sel
vec2 sfVor(vec2 p) {
  vec2 g = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), h = sfH22(g + o);
    float d = length(o + h - f);
    if (d < d1) { d2 = d1; d1 = d; id = h.x; } else if (d < d2) d2 = d;
  }
  return vec2(d2 - d1, id);
}
// Voronoi 3D (retakan tanpa sambungan di semua arah permukaan): x = jarak ke tepi sel, y = id sel
vec2 sfVor3(vec3 p) {
  vec3 g = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 o = vec3(float(i), float(j), float(k)), c = g + o;
    vec3 h = vec3(sfH3(c), sfH3(c + 17.31), sfH3(c + 41.97));
    vec3 r = o + h - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = h.x; } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
// bunga/bintang k ujung: batas jari-jari (relatif) pada sudut a. s = ketajaman ujung
float sfPetal(float a, float k, float s) { return pow(abs(cos(a * k * 0.5)), s); }
// pamor keris (lapisan nikel bergelombang di baja): 0..1 = kadar garis terang
float sfPamor(vec3 p) {
  float w = sfN3(p * 30.0) * 2.8 + sfN3(p * 78.0 + 5.0) * 1.1;
  float l = sin(p.y * 380.0 + p.x * 110.0 + w * 7.0 + sin(p.z * 40.0 + w * 2.4) * 3.0);
  return smoothstep(0.72, 0.97, l) + 0.25 * smoothstep(0.2, 0.6, sin(p.y * 190.0 + w * 3.5 + p.z * 9.0));
}
// mata bulu merak (dadak merak): rgb + kadar inti (untuk pendar). d = posisi di dalam bulu (÷ jari-jari), r = |d|
vec4 sfPeacock(vec2 d, float r, float id, float vdn) {
  vec2 e = d - vec2(0.0, -0.2);
  float re = length(e * vec2(1.0, 0.82));
  float a = atan(d.y, d.x), barb = 0.5 + 0.5 * sin(a * 46.0 + r * 9.0);
  vec3 vane = mix(${L('#1f4d1c')}, ${L('#7c8a2a')}, barb * 0.6 + 0.2 * id);
  vane = mix(vane, ${L('#2b8a6e')}, smoothstep(0.55, 0.9, r) * 0.4);
  vec3 c = vane;
  c = mix(c, ${L('#b98a24')}, 1.0 - smoothstep(0.5, 0.54, re));
  c = mix(c, ${L('#0d8f86')}, 1.0 - smoothstep(0.4, 0.44, re));
  c = mix(c, ${L('#123c9c')}, 1.0 - smoothstep(0.27, 0.31, re));
  c = mix(c, ${L('#050b2e')}, 1.0 - smoothstep(0.15, 0.19, re));
  float iri = 0.5 + 0.5 * sin(vdn * 7.0 + id * 6.28 + uSfT * 0.8);
  c *= 0.8 + 0.4 * mix(vec3(0.6, 1.0, 0.9), vec3(1.1, 0.85, 1.2), iri);
  return vec4(c, 1.0 - smoothstep(0.27, 0.31, re));
}
`;

// ---------- Karakter ----------
// nomor pola (fx): 1 kabut kota · 2 rimba · 3 merah putih · 4 samudra · 5 batik parang · 6 neon kota · 7 garuda emas ·
// 8 operator malam · 9 debu merapi · 10 tenun ikat · 11 ondel-ondel · 12 empu pamor · 13 inti magma · 14 kristal es ·
// 15 kencana · 16 warok · 17 reaktor
export const CHAR_FX = { none: 0, kabut: 1, rimba: 2, merahputih: 3, samudra: 4, batik: 5, neon: 6, garuda: 7, malam: 8, gurun: 9, tenun: 10, ondel: 11, empu: 12, magma: 13, es: 14, kencana: 15, warok: 16, reaktor: 17 };
// p, n = posisi & normal pose diam (m; kaki di y = 0, menghadap +Z, kiri = +X). K = faktor palet (1 / netral atlas).
// vdn = |N·V| (untuk aura/kilau di sudut landai). tint (masuk) = warna slot dari palet; keluar = warna akhir (× K).
// metal 0..1, rough < 0 = biarkan, emis = pendar (HDR).
export const CHAR_SKIN_GLSL = SKIN_COMMON + `
void sfChar(int fx, int slot, vec3 p, vec3 n, float K, float vdn, inout vec3 tint, inout float metal, inout float rough, inout vec3 emis) {
  bool top = slot == 2, slv = slot == 3, pnt = slot == 5, cuf = slot == 4, inr = slot == 6;
  if (!(top || slv || pnt || cuf || inr)) return;
  float T = uSfT, fr = pow(1.0 - vdn, 3.0);
  float outer = step(0.45, n.x * sign(p.x)); // sisi luar lengan / kaki
  bool cloth = top || slv || pnt;
  vec2 q = sfProj(p, n);
  if (fx == 1 || fx == 9) { // kabut kota / debu merapi: loreng digital dua tingkat + panel bahu & lutut lebih gelap
    if (cloth) {
      vec3 v = floor(p / 0.022) * 0.022, v2 = floor(p / 0.044) * 0.044, pv = mix(v, v2, step(0.5, sfH3(v2 * 53.0)));
      tint = fx == 1 ? sfCamo4(pv, 10.0, ${L('#8a8e93')}, ${L('#5d6167')}, ${L('#34373c')}, ${L('#c4c7cb')})
                     : sfCamo4(pv, 10.0, ${L('#9a9282')}, ${L('#b3a68a')}, ${L('#5e574c')}, ${L('#3c3731')});
      float pnl = (top ? step(1.43, p.y) : 0.0) + (pnt ? step(0.2, n.z) * step(0.42, p.y) * step(p.y, 0.58) : 0.0) + (slv ? step(1.3, p.y) * outer : 0.0);
      tint = K * mix(tint, tint * 0.45, min(pnl, 1.0));
      rough = 0.9;
    }
  } else if (fx == 2) { // rimba: loreng hutan + panel bahu & lutut
    if (cloth) {
      tint = sfCamoW(p, 11.0, ${L('#4d5c2d')}, ${L('#2c371c')}, ${L('#74703f')}, ${L('#3b2d1c')});
      float pnl = (top ? step(1.43, p.y) : 0.0) + (pnt ? step(0.2, n.z) * step(0.42, p.y) * step(p.y, 0.58) : 0.0);
      tint = K * mix(tint, ${L('#2a3119')}, min(pnl, 1.0) * 0.85);
      rough = 0.9;
    }
  } else if (fx == 3) { // merah putih: dada merah bergaris emas, celana putih bergaris merah
    float cut = 1.262 + 0.035 * sin(p.x * 9.0);
    if (top) { float r = smoothstep(cut - 0.004, cut + 0.004, p.y), g = sfAA(abs(p.y - cut), 0.006);
      tint = K * mix(mix(${L('#f2f0ea')}, ${L('#c1121f')}, r), ${L('#e2a93b')}, g); metal = 0.8 * g; }
    if (slv) { float r = step(1.3, p.y), g = sfAA(abs(p.y - 1.3), 0.005); tint = K * mix(mix(${L('#f2f0ea')}, ${L('#c1121f')}, r), ${L('#e2a93b')}, g); metal = 0.8 * g; }
    if (pnt) { float s = outer * (1.0 - smoothstep(0.017, 0.021, abs(p.z))), g = outer * sfAA(abs(abs(p.z) - 0.026), 0.003);
      tint = K * mix(mix(${L('#f2f0ea')}, ${L('#c1121f')}, s), ${L('#e2a93b')}, g); metal = 0.8 * g; }
    if (cuf) { tint = K * ${L('#e2a93b')}; metal = 0.8; rough = 0.35; }
  } else if (fx == 4) { // samudra: gradasi laut → toska, buih ombak bergerak naik pelan
    if (cloth) {
      vec3 base = mix(${L('#0a2452')}, ${L('#1c8f8c')}, smoothstep(0.15, 1.5, p.y));
      float wv = fract(p.y * 7.0 + 0.3 * sin(q.x * 34.0 + T * 0.6) - T * 0.05), e = min(wv, 1.0 - wv);
      float crest = sfAA(e, 0.05) * (0.7 + 0.3 * sfN3(p * 40.0 + T * 0.3));
      float foam = step(0.93, sfH3(floor(p * 260.0))) * smoothstep(0.08, 0.0, e);
      tint = K * mix(base, ${L('#eaf6f6')}, max(crest * 0.9, foam));
      emis = ${L('#7fe3ff')} * crest * 0.04;
    }
    if (cuf) tint = K * ${L('#eaf6f6')};
  } else if (fx == 5) { // batik parang (jaket): kilau emas menyapu diagonal menyusuri garis parang tiap ±2 dtk; celana gelap berpinggir parang
    if (top || slv) { float ln;
      vec3 c = sfParang(q, 0.085, ${L('#e6d3a3')}, ${L('#6b3e1e')}, ${L('#2a1d12')}, ln);
      float sw = exp(-pow((p.x * 0.6 + p.y - 0.55 - mod(T * 0.75, 2.2)) * 6.0, 2.0)), run = pow(0.5 + 0.5 * sin(p.y * 14.0 + p.x * 9.0 - T * 4.0), 8.0);
      float gl = ln * (0.25 + sw + run * 0.4);
      tint = K * mix(c, ${L('#e2b04c')}, min(gl, 1.0) * 0.7); metal = min(gl, 1.0) * 0.7; emis = ${L('#ffcf6a')} * ln * (sw * 2.4 + run * 0.7);
    }
    if (pnt) { float ln; vec3 c = sfParang(q, 0.06, ${L('#e6d3a3')}, ${L('#6b3e1e')}, ${L('#2a1d12')}, ln); tint = K * mix(${L('#1d1714')}, c, step(p.y, 0.2)); emis = ${L('#ffcf6a')} * ln * step(p.y, 0.2) * pow(0.5 + 0.5 * sin(p.x * 30.0 - T * 4.0), 8.0) * 0.8; }
    if (cuf) { tint = K * ${L('#d29f52')}; metal = 0.8; }
  } else if (fx == 6) { // neon kota: garis cahaya tebal; dua rangkaian denyut melesat menyusuri tiap garis, warna bergeser toska ↔ magenta
    float ln = 0.0, ph = 0.0;
    if (slv || pnt) { ln = outer * (1.0 - smoothstep(0.009, 0.016, abs(p.z))); ph = p.y; }
    if (top) { float cv = p.y + abs(p.x) * 0.85; ln = step(0.3, n.z) * max(1.0 - smoothstep(0.007, 0.013, abs(cv - 1.385)), 1.0 - smoothstep(0.007, 0.013, abs(cv - 1.44)));
      ln = max(ln, step(n.z, -0.3) * (1.0 - smoothstep(0.008, 0.014, abs(abs(p.x) - (1.5 - p.y) * 0.45)))); // V di punggung
      ph = abs(p.x) * 2.0 + p.y; }
    if (slv) ln = max(ln, max(1.0 - smoothstep(0.008, 0.013, abs(p.y - 1.05)), 1.0 - smoothstep(0.008, 0.013, abs(p.y - 1.33))));
    if (pnt) ln = max(ln, max(1.0 - smoothstep(0.008, 0.013, abs(p.y - 0.53)), 1.0 - smoothstep(0.008, 0.013, abs(p.y - 0.17))));
    if (cuf) { ln = 1.0; ph = p.y; }
    float pulse = pow(0.5 + 0.5 * sin(ph * 14.0 - T * 6.5), 10.0) + 0.7 * pow(0.5 + 0.5 * sin(ph * 5.0 - T * 3.3 + 1.0), 14.0);
    vec3 lc = mix(${L('#22e6ff')}, ${L('#ff2bd6')}, clamp((pnt ? 0.75 : 0.0) + 0.3 * sin(T * 0.9 + p.y * 2.0), 0.0, 1.0));
    if (cloth) tint = K * mix(${L('#0c0d14')}, ${L('#181a28')}, sfN3(p * 30.0) * 0.5);
    tint = mix(tint, K * lc, ln);
    emis = lc * ln * (0.6 + 7.0 * pulse);
  } else if (fx == 7) { // garuda emas: bulu emas di bahu & dada beriak menyala; sapuan cahaya emas menyapu seluruh badan tiap 2,6 dtk; aura emas
    float m = 0.0;
    if (top || slv) {
      vec4 sc = sfScale4(q * vec2(17.0, -17.0));
      float feather = max(smoothstep(0.78, 0.96, sc.z), (1.0 - smoothstep(0.03, 0.09, abs(sc.x))) * step(sc.z, 0.9));
      m = feather * smoothstep(1.27, 1.4, p.y);
      if (slv) m = max(m, 1.0 - smoothstep(0.012, 0.016, abs(p.y - 1.075)));
      if (top) m = max(m, 1.0 - smoothstep(0.012, 0.016, abs(p.y - 1.02)));
    }
    if (pnt) m = max(outer * (1.0 - smoothstep(0.013, 0.017, abs(p.z))), 1.0 - smoothstep(0.016, 0.02, abs(p.y - 0.975)));
    if (cuf) m = 1.0;
    float rip = pow(0.5 + 0.5 * sin(p.y * 9.0 - abs(p.x) * 6.0 - T * 3.0), 6.0);
    float sweep = exp(-pow((p.y * 0.85 + p.x * 0.45 - 1.95 + fract(T / 2.6) * 2.5) * 5.0, 2.0));
    tint = mix(tint, K * ${L('#e2a93b')}, m);
    metal = 0.85 * m;
    rough = mix(-1.0, 0.28, step(0.5, m));
    emis = ${L('#ffc64a')} * (m * (0.08 + 1.1 * rip + 2.6 * sweep) + (1.0 - m) * sweep * 0.35 * float(cloth) + fr * (0.3 + 0.15 * sin(T * 2.0)));
  } else if (fx == 8) { // operator malam: panel taktis lebih terang + garis emas tipis
    float panel = 0.0, gold = 0.0;
    if (top) { panel = step(1.405, p.y); gold = 1.0 - smoothstep(0.002, 0.005, abs(p.y - 1.402)); }
    if (slv) panel = step(p.y, 1.19);
    if (pnt) { panel = step(0.2, n.z) * step(0.43, p.y) * step(p.y, 0.6); gold = outer * (1.0 - smoothstep(0.003, 0.006, abs(p.z))); }
    tint = mix(tint, K * ${L('#2d3036')}, panel * (1.0 - gold));
    tint = mix(tint, K * ${L('#d29f52')}, gold);
    metal = 0.6 * gold;
  } else if (fx == 10) { // tenun ikat: belah ketupat bertingkat, tepi "luntur" khas ikat (benang lungsin bergeser)
    if (top || slv || inr) {
      float th = floor(q.x * 380.0), off = (sfH2(vec2(th, 1.7)) - 0.5) * 0.011;
      vec2 g = vec2(q.x, q.y + off) / vec2(0.075, 0.1);
      vec2 c = fract(g) - 0.5; float dm = abs(c.x) + abs(c.y), b = floor(dm * 4.2);
      vec3 col = b < 1.0 ? ${L('#e8d9b5')} : b < 2.0 ? ${L('#a3401f')} : b < 3.0 ? ${L('#1d2a5a')} : ${L('#151416')};
      float st = step(0.5, fract(p.y * 9.0 + off * 30.0)) * step(abs(fract(p.y * 9.0) - 0.5), 0.08);
      tint = K * mix(col, ${L('#e8d9b5')}, st * 0.6);
      rough = 0.92;
    }
    if (pnt) tint = K * ${L('#151a33')};
  } else if (fx == 11) { // ondel-ondel: jaket merah bunga emas, dalaman gading berpita kembang kelapa, celana hitam bergaris emas
    if (top || slv) {
      vec2 g = q / 0.07; vec2 c = fract(g + vec2(0.0, 0.5 * mod(floor(g.x), 2.0))) - 0.5;
      float r = length(c), a = atan(c.y, c.x), pet = 0.17 + 0.15 * sfPetal(a, 8.0, 2.0);
      float fl = 1.0 - smoothstep(pet - 0.02, pet + 0.005, r), ol = sfAA(abs(r - pet), 0.014), ct = 1.0 - smoothstep(0.045, 0.06, r);
      vec3 red = mix(${L('#a50f17')}, ${L('#d81e24')}, 0.5 + 0.5 * sfN3(p * 25.0));
      vec3 c3 = mix(red, ${L('#e8b445')}, max(fl * 0.8, ol)); c3 = mix(c3, ${L('#1f8a4c')}, ct);
      tint = K * c3; metal = max(fl, ol) * 0.7; rough = 0.45;
    }
    if (inr) { float s = fract(p.x * 30.0 + p.y * 12.0), k = floor(fract((p.x * 30.0 + p.y * 12.0) / 5.0) * 5.0);
      vec3 rib = k < 1.0 ? ${L('#d81e24')} : k < 2.0 ? ${L('#f2c230')} : k < 3.0 ? ${L('#1f8a4c')} : k < 4.0 ? ${L('#2459b8')} : ${L('#e04c9a')};
      tint = K * mix(${L('#f1e8d2')}, rib, step(0.55, s) * step(1.3, p.y)); }
    if (pnt) { float g = outer * sfAA(abs(abs(p.z) - 0.012), 0.004); tint = K * mix(${L('#141214')}, ${L('#e8b445')}, g); metal = g; }
    if (cuf) { tint = K * ${L('#e8b445')}; metal = 0.8; }
  } else if (fx == 12) { // empu pamor: beskap nila-hitam berlapis garis pamor perak; cahaya tuah merambat menyusuri pamor
    if (cloth) {
      float pm = sfPamor(p * 0.55);
      float gl = pow(0.5 + 0.5 * sin(p.y * 7.0 - p.x * 3.0 - T * 2.6), 8.0);
      vec3 base = top || slv ? ${L('#141826')} : ${L('#0e0f14')};
      tint = K * mix(base, ${L('#a9b4c4')}, pm * (top || slv ? 0.75 : 0.3));
      metal = pm * 0.6; rough = mix(-1.0, 0.35, step(0.5, pm));
      emis = ${L('#7fe8d0')} * pm * gl * 1.4;
      if (top) { float col = sfAA(abs(p.y - 1.5), 0.008); tint = mix(tint, K * ${L('#d6a446')}, col); metal = max(metal, col); }
    }
    if (inr) tint = K * ${L('#e9e1cf')};
    if (cuf) { tint = K * ${L('#d6a446')}; metal = 0.85; }
  } else if (fx == 13) { // inti magma: obsidian retak; lava NAIK mengalir di retakan (gelombang terang), bara di bawah kulit batu bernapas
    if (cloth || cuf) {
      vec2 v = sfVor3(p * 13.0);
      float fl = sfN3(p * 18.0 + vec3(0.0, -T * 1.0, T * 0.35));
      float ck = 1.0 - smoothstep(0.0, 0.08 + 0.025 * fl, v.x), near = 1.0 - smoothstep(0.0, 0.32, v.x);
      float run = pow(0.5 + 0.5 * sin(p.y * 9.0 - T * 4.6 + fl * 4.0), 3.0);           // gelombang lava naik ±0,5 m/dtk
      float run2 = pow(0.5 + 0.5 * sin(p.y * 23.0 - T * 8.5 + fl * 6.0), 6.0);
      float lava = ck * clamp(0.16 + 0.95 * run + 0.45 * run2, 0.0, 1.5);
      float breath = pow(0.5 + 0.5 * sin(p.y * 3.5 - T * 2.8 + fl * 2.0), 2.0);
      tint = K * mix(mix(${L('#0b0909')}, ${L('#1a1414')}, fl * 0.6), ${L('#3a0c02')}, near * 0.8);
      rough = mix(0.3, 0.7, ck); metal = 0.2 * (1.0 - ck);
      emis = mix(${L('#ff2800')}, ${L('#fff0b0')}, clamp(lava * 0.75 + run2 * 0.3, 0.0, 1.0)) * lava * 3.6 + ${L('#ff3a00')} * (near - ck) * (0.06 + 0.7 * breath);
    }
  } else if (fx == 14) { // kristal es: faset es putih kebiruan; embun beku berkilau merayap naik di retakan, kilau salju berkelip, manset menyala
    if (cloth) {
      vec2 v = sfVor(q * 26.0);
      float ck = sfAA(v.x, 0.035), sp = step(0.986, sfH3(floor(p * 420.0)));
      float creep = ck * pow(0.5 + 0.5 * sin(p.y * 12.0 - T * 4.0 + v.y * 3.0), 8.0);
      vec3 c = mix(${L('#cfe6f5')}, ${L('#7fb4dc')}, v.y * 0.7 + smoothstep(1.4, 0.4, p.y) * 0.3);
      tint = K * mix(c, ${L('#f6fbff')}, ck * 0.8);
      rough = mix(0.35, 0.6, ck); metal = 0.1;
      emis = vec3(1.6, 1.9, 2.2) * sp * pow(0.5 + 0.5 * sin(T * 6.0 + sfH3(floor(p * 420.0)) * 40.0), 3.0) + ${L('#7fdcff')} * (creep * 2.2 + fr * 0.2);
    }
    if (cuf) { tint = K * ${L('#bfefff')}; emis = ${L('#4fc8ff')} * (1.0 + 1.4 * pow(0.5 + 0.5 * sin(T * 2.5), 3.0)); }
  } else if (fx == 15) { // kencana: marmer gading berurat emas; kilau emas menyapu diagonal & mengalir di urat
    if (cloth) {
      vec3 m = p * 6.0; float tb = sfFbm(m * 2.0) * 2.4;
      float gv = abs(sin(m.x * 1.3 + m.y * 0.8 + m.z * 0.9 + tb * 3.0)), grey = 1.0 - smoothstep(0.0, 0.1, gv);
      float au = sfAA(abs(sin(m.z * 1.1 - m.y * 0.9 + sfFbm(m * 1.5 + 31.0) * 4.0)), 0.06);
      vec3 c = mix(${L('#f3efe7')}, ${L('#9b958c')}, grey * 0.55) * (0.94 + 0.06 * sfN3(m * 20.0));
      float sw = exp(-pow((p.y + p.x * 0.4 - 0.35 - mod(T * 0.7, 1.9)) * 5.0, 2.0)), run = pow(0.5 + 0.5 * sin(p.y * 12.0 - T * 3.5), 8.0);
      tint = K * mix(c, ${L('#e3b24e')}, au); metal = au; rough = mix(0.4, 0.22, au);
      emis = ${L('#ffd27a')} * au * (0.06 + sw * 2.4 + run * 0.8);
    }
    if (cuf || inr) { tint = K * (cuf ? ${L('#e3b24e')} : ${L('#efe6d4')}); metal = cuf ? 0.9 : 0.0; }
  } else if (fx == 16) { // warok: hitam; mata bulu merak di bahu & punggung — inti berdenyut bergiliran, kilau kipas berpelangi beriak; aura toska-emas
    if (top || slv) {
      float back = step(n.z, -0.2) * step(1.08, p.y), sh = step(1.36, p.y);
      tint = K * mix(${L('#0b0a0c')}, ${L('#16141a')}, sfN3(p * 40.0));
      rough = 0.55;
      float zone = max(back, sh * (top ? 1.0 : outer));
      if (zone > 0.5) {
        vec4 sc = sfScale4(q * vec2(13.0, -13.0));
        vec4 pk = sfPeacock(sc.xy, sc.z, sc.w, vdn);
        float core = pow(0.5 + 0.5 * sin(T * 3.0 + sc.w * 6.2832), 3.0), fan = pow(0.5 + 0.5 * sin(p.y * 8.0 + abs(p.x) * 5.0 - T * 3.2 + sc.w * 2.0), 6.0);
        vec3 iri = sfHue(fract(0.42 + 0.14 * sin(T * 1.1 + sc.w * 6.2832) + vdn * 0.25));
        tint = K * pk.rgb * (0.85 + 0.45 * fan); rough = 0.35; metal = 0.25;
        emis = ${L('#2a6bff')} * pk.a * (0.2 + 2.0 * core) + iri * fan * (1.0 - pk.a) * 0.55;
      }
    }
    if (inr) { float s = step(0.5, fract(p.y * 30.0)); tint = K * mix(${L('#f1ede4')}, ${L('#c41a1a')}, s); }
    if (pnt) { float h = sfAA(abs(p.y - 0.13), 0.012); tint = K * mix(${L('#0b0a0c')}, ${L('#c41a1a')}, h); emis = ${L('#ff3a2a')} * h * pow(0.5 + 0.5 * sin(p.x * 20.0 - T * 4.0), 6.0) * 1.2; }
    if (cuf) { tint = K * ${L('#d6a446')}; metal = 0.85; }
    emis += mix(${L('#1fd6b4')}, ${L('#ffc64a')}, 0.5 + 0.5 * sin(T * 1.3)) * fr * 0.35;
  } else if (fx == 17) { // reaktor: zirah keramik putih & grafit; arus energi MELESAT naik di kanal, pita pindaian turun menyapu zirah,
                          // inti dada berdetak dengan gelombang cincin; aura plasma
    if (cloth) {
      float seg = floor(p.y * 9.0 + sfH2(vec2(floor(p.x * 6.0), 3.0)) * 0.6), seam = sfAA(min(fract(p.y * 9.0), 1.0 - fract(p.y * 9.0)), 0.03);
      bool white = mod(seg, 3.0) != 1.0 && !pnt;
      vec3 c = white ? ${L('#e6eaee')} : ${L('#1c1f25')};
      float ch = sfAA(abs(fract(q.x * 7.0 + 0.5 * step(0.0, p.x)) - 0.5), 0.045) * step(0.5, fract(seg * 0.37 + 0.2));
      float s1 = pow(fract(p.y * 2.2 - T * 1.8 + q.x * 1.5), 10.0), s2 = pow(fract(p.y * 5.0 - T * 3.2 + q.x * 3.0), 14.0);
      float scan = exp(-pow((p.y - (1.8 - fract(T / 3.0) * 2.0)) * 8.0, 2.0));
      tint = K * mix(c, ${L('#0b0d10')}, seam * 0.8);
      rough = white ? 0.3 : 0.6; metal = white ? 0.05 : 0.4;
      emis = ${L('#33d6ff')} * (ch * (0.4 + 6.0 * (s1 + 0.7 * s2)) + seam * scan * 3.0 + scan * (white ? 0.25 : 0.1));
    }
    if (inr) { float r = length(vec2(p.x, p.y - 1.33)) / 0.05, core = 1.0 - smoothstep(0.7, 1.0, r), beat = pow(0.5 + 0.5 * sin(T * 6.2832 * 1.1), 6.0);
      float wv = fract(T * 1.1), ring = sfAA(abs(r - 1.0 - wv * 3.0), 0.18) * (1.0 - wv);
      tint = K * mix(${L('#20242c')}, ${L('#bff4ff')}, core); emis = ${L('#33d6ff')} * (core * (1.8 + 3.0 * beat) + ring * 2.6) * step(0.2, n.z); }
    if (cuf) { tint = K * ${L('#9fe9ff')}; emis = ${L('#33d6ff')} * (1.2 + 1.6 * pow(0.5 + 0.5 * sin(T * 6.2832 * 1.1), 6.0)); }
    emis += ${L('#33d6ff')} * fr * (0.25 + 0.15 * sin(T * 3.0));
  }
}
`;
// lengan orang pertama (kain): versi ringkas pola karakter untuk material lengan (posisi ruang objek lengan). emis = pendar
export const CHAR_SLEEVE_GLSL = `
vec3 sfSleeve(int fx, vec3 p, vec3 n, vec3 base, inout vec3 emis) {
  // sumbu lengan ≈ z (pergelangan z ≈ 0,08 → siku z ≈ 0,38): gerakan "ke tangan" = fase p.z * k + T * v
  float T = uSfT;
  vec2 q = sfProj(p, n);
  if (fx == 1) { vec3 v = floor(p / 0.022) * 0.022; return sfCamo4(v, 10.0, ${L('#8a8e93')}, ${L('#5d6167')}, ${L('#34373c')}, ${L('#c4c7cb')}); }
  if (fx == 9) { vec3 v = floor(p / 0.022) * 0.022; return sfCamo4(v, 10.0, ${L('#9a9282')}, ${L('#b3a68a')}, ${L('#5e574c')}, ${L('#3c3731')}); }
  if (fx == 2) return sfCamoW(p, 11.0, ${L('#4d5c2d')}, ${L('#2c371c')}, ${L('#74703f')}, ${L('#3b2d1c')});
  if (fx == 3) return ${L('#c1121f')};
  if (fx == 4) { float wv = fract((p.z + p.y) * 7.0 + 0.3 * sin(q.x * 34.0 + T * 0.9) + T * 0.25), e = min(wv, 1.0 - wv); float cr = sfAA(e, 0.05); emis += ${L('#7fe3ff')} * cr * 0.15; return mix(${L('#14607a')}, ${L('#eaf6f6')}, cr * 0.9); }
  if (fx == 5) { float ln; vec3 c = sfParang(q, 0.085, ${L('#e6d3a3')}, ${L('#6b3e1e')}, ${L('#2a1d12')}, ln); emis += ${L('#ffcf6a')} * ln * pow(0.5 + 0.5 * sin(p.z * 14.0 + T * 5.0), 8.0) * 1.8; return c; }
  if (fx == 6) { float ln = max(sfAA(abs(fract(p.z * 9.0) - 0.5), 0.045), sfAA(abs(fract(p.y * 14.0) - 0.5), 0.05) * step(0.5, fract(p.y * 7.0))), pulse = pow(0.5 + 0.5 * sin(p.z * 14.0 + T * 7.0), 10.0) + 0.7 * pow(0.5 + 0.5 * sin(p.z * 5.0 + T * 3.3), 14.0);
    vec3 lc = mix(${L('#22e6ff')}, ${L('#ff2bd6')}, 0.3 + 0.3 * sin(T * 0.9)); emis += lc * ln * (0.25 + 3.2 * pulse); return mix(${L('#0c0d14')}, lc * 0.5, ln); }
  if (fx == 7) { vec4 sc = sfScale4(q * vec2(20.0, -20.0)); float f = max(smoothstep(0.74, 0.94, sc.z), (1.0 - smoothstep(0.03, 0.1, abs(sc.x))) * step(sc.z, 0.9)) * 0.85;
    float sweep = exp(-pow((p.z - 0.42 + fract(T / 2.2) * 0.45) * 16.0, 2.0)), rip = pow(0.5 + 0.5 * sin(p.z * 18.0 + T * 3.2 + sc.w * 6.28), 6.0);
    emis += ${L('#ffc64a')} * (f * (0.15 + 1.6 * rip + 3.2 * sweep) + sweep * 0.45); return mix(${L('#f4f1e8')}, ${L('#e2a93b')}, f); }
  if (fx == 8) { float g = sfAA(abs(fract(p.z * 4.0) - 0.5), 0.02); return mix(${L('#1b1c20')}, ${L('#d29f52')}, g); }
  if (fx == 10) { vec2 g = q / vec2(0.075, 0.1); vec2 c = fract(g) - 0.5; float b = floor((abs(c.x) + abs(c.y)) * 4.2); return b < 1.0 ? ${L('#e8d9b5')} : b < 2.0 ? ${L('#a3401f')} : b < 3.0 ? ${L('#1d2a5a')} : ${L('#151416')}; }
  if (fx == 11) { vec2 c = fract(q / 0.07) - 0.5; float r = length(c), pet = 0.17 + 0.15 * sfPetal(atan(c.y, c.x), 8.0, 2.0); return mix(${L('#b5141c')}, ${L('#e8b445')}, 1.0 - smoothstep(pet - 0.02, pet + 0.005, r)); }
  if (fx == 12) { float pm = sfPamor(p * 0.55); emis += ${L('#7fe8d0')} * pm * pow(0.5 + 0.5 * sin(p.z * 12.0 + T * 3.5), 8.0) * 1.4; return mix(${L('#141826')}, ${L('#a9b4c4')}, pm * 0.75); }
  if (fx == 13) { vec2 v = sfVor(q * 15.0); float fl = sfN3(p * 22.0 + vec3(0.0, -T * 1.0, T * 0.4));
    float ck = 1.0 - smoothstep(0.0, 0.08 + 0.03 * fl, v.x), near = 1.0 - smoothstep(0.0, 0.3, v.x);
    float run = pow(0.5 + 0.5 * sin(p.z * 15.0 + T * 7.0 + fl * 4.0), 3.0), run2 = pow(0.5 + 0.5 * sin(p.z * 36.0 + T * 12.0 + fl * 6.0), 6.0);
    float lava = ck * clamp(0.16 + 0.95 * run + 0.45 * run2, 0.0, 1.5), breath = pow(0.5 + 0.5 * sin(p.z * 6.0 + T * 3.0 + fl * 2.0), 2.0);
    emis += mix(${L('#ff2800')}, ${L('#fff0b0')}, clamp(lava * 0.75 + run2 * 0.3, 0.0, 1.0)) * lava * 3.4 + ${L('#ff3a00')} * (near - ck) * (0.06 + 0.7 * breath);
    return mix(mix(${L('#0d0b0b')}, ${L('#1a1414')}, fl * 0.6), ${L('#3a0c02')}, near * 0.8); }
  if (fx == 14) { vec2 v = sfVor(q * 26.0); float ck = sfAA(v.x, 0.035), sp = step(0.986, sfH3(floor(p * 420.0))), creep = ck * pow(0.5 + 0.5 * sin(p.z * 14.0 + T * 4.5 + v.y * 3.0), 8.0);
    emis += vec3(1.5, 1.8, 2.1) * sp * pow(0.5 + 0.5 * sin(T * 6.0 + sfH3(floor(p * 420.0)) * 40.0), 3.0) + ${L('#7fdcff')} * creep * 2.2; return mix(mix(${L('#cfe6f5')}, ${L('#7fb4dc')}, v.y * 0.7), ${L('#f6fbff')}, ck * 0.8); }
  if (fx == 15) { vec3 m = p * 6.0; float au = sfAA(abs(sin(m.z * 1.1 - m.y * 0.9 + sfFbm(m * 1.5 + 31.0) * 4.0)), 0.06); emis += ${L('#ffd27a')} * au * (0.06 + 2.2 * exp(-pow((p.z - 0.42 + fract(T / 2.2) * 0.45) * 20.0, 2.0))); return mix(${L('#f3efe7')}, ${L('#e3b24e')}, au); }
  if (fx == 16) { vec4 sc = sfScale4(q * vec2(16.0, -16.0)); float band = step(p.z, 0.22);
    vec4 pk = sfPeacock(sc.xy, sc.z, sc.w, 0.6); float core = pow(0.5 + 0.5 * sin(T * 3.0 + sc.w * 6.2832), 3.0), fan = pow(0.5 + 0.5 * sin(p.z * 16.0 + T * 3.4 + sc.w * 2.0), 6.0);
    vec3 iri = sfHue(fract(0.42 + 0.14 * sin(T * 1.1 + sc.w * 6.2832)));
    float s = sfAA(abs(fract(p.z * 5.0) - 0.5), 0.05); emis += (${L('#2a6bff')} * pk.a * (0.3 + 2.6 * core) + iri * fan * (1.0 - pk.a) * 0.7) * band + ${L('#ff3a2a')} * s * (1.0 - band) * (0.2 + 1.6 * pow(0.5 + 0.5 * sin(p.z * 10.0 + T * 4.0), 6.0));
    return mix(mix(${L('#0b0a0c')}, ${L('#c41a1a')}, s * 0.8), pk.rgb * (0.85 + 0.45 * fan), band); }
  if (fx == 17) { float li = floor(p.y * 16.0), ch = sfAA(abs(fract(p.y * 16.0) - 0.5), 0.07) * step(0.35, sfH2(vec2(li, 4.0)));            // kanal menyusuri lengan
    float s1 = pow(fract(p.z * 3.0 + T * 2.2 + sfH2(vec2(li, 1.0))), 10.0), s2 = pow(fract(p.z * 7.0 + T * 3.6 + sfH2(vec2(li, 2.0))), 14.0);
    float seg = step(0.5, fract(p.z * 6.0)), seam = sfAA(abs(fract(p.z * 6.0) - 0.5), 0.04);
    emis += ${L('#33d6ff')} * (ch * (0.5 + 6.5 * (s1 + 0.7 * s2)) + seam * 0.3); return mix(mix(${L('#e6eaee')}, ${L('#1c1f25')}, seg * 0.85), ${L('#33d6ff')}, ch * 0.6); }
  return base;
}
`;

// ---------- Senjata ----------
// nomor skin senjata (define SF_GUN): 1 karbon · 2 rimba · 3 debu merapi · 4 senja · 5 naga · 6 mega mendung · 7 kawung ·
// 8 wayang · 9 ondel-ondel · 10 marmer · 11 kristal es · 12 neon · 13 songket · 14 pamor keris · 15 petir · 16 holografik ·
// 17 mutiara · 18 garuda · 19 dadak merak · 20 magma · 21 plasma
export const GUN_FX = { none: 0, karbon: 1, rimba: 2, gurun: 3, senja: 4, naga: 5, mendung: 6, kawung: 7, wayang: 8, ondel: 9, marmer: 10, es: 11, neon: 12, songket: 13, keris: 14, petir: 15, holo: 16, mutiara: 17, garuda: 18, reog: 19, magma: 20, plasma: 21 };
// cls = kelas bahan (dari nama material GLB): 1 logam telanjang (laras, bolt) · 4 logam berlapis (badan) · 2 polimer ·
// 3 karet/gagang/magasin · 5 kayu · 9 aksen (bidikan emas dsb.)
// p, n = posisi & normal ruang objek senjata (m; laras ke −Z). col masuk = warna asli. vdn = |N·V|.
// keluar: metal/rough (< 0 = biarkan), emis (HDR), hgt = relief 0..1 (< 0 = tanpa), coat = pernis 0..1 (< 0 = biarkan).
// uSfG (view-model): x = pendar isi ulang/periksa/cabut, y = panas tembakan, z = kilat tembakan, w = posisi sapuan cahaya (z, m).
export const GUN_SKIN_GLSL = SKIN_COMMON + `
uniform vec4 uSfG;
void sfGun(int cls, vec3 p, vec3 n, float vdn, inout vec3 col, inout float metal, inout float rough, inout vec3 emis, inout float hgt, inout float coat) {
#ifdef SF_WORLD
  p.xz = -p.xz; n.xz = -n.xz; // model dunia diputar 180° (main.js addGearParts)
#endif
  vec2 uv = sfProj(p, n);
  bool body = cls == 2 || cls == 4 || cls == 5; // panel utama: polimer, logam berlapis, kayu
  float T = uSfT, gb = 1.0 + uSfG.x * 1.8 + uSfG.z * 1.1, sw = exp(-pow((p.z - uSfG.w) * 12.0, 2.0)), fr = pow(1.0 - vdn, 3.0);
#if SF_GUN == 1 // karbon hitam: anyaman twill berlapis pernis, kilau serat berubah menurut sudut pandang
  if (body) { float w = sfCarbon(uv * 210.0), s = w * (0.45 + 0.55 * fr + 0.25 * vdn);
    col = mix(${L('#030304')}, ${L('#3b4048')}, s * s); metal = 0.3; rough = mix(0.42, 0.2, w); coat = 1.0; hgt = w; }
  else if (cls == 1) { col = ${L('#2b2e33')}; metal = 1.0; rough = 0.24; }
  else if (cls == 3) { col = ${L('#0c0d0f')}; rough = 0.86; }
  else if (cls == 9) { col = ${L('#b8c0c8')}; metal = 1.0; rough = 0.22; }
#elif SF_GUN == 2 // kamuflase rimba: noda hutan bertepi organik, cat doff
  if (body || cls == 3) { col = sfCamoW(p, 24.0, ${L('#3e4a25')}, ${L('#5d6634')}, ${L('#4a3522')}, ${L('#191a13')}); if (cls == 3) col *= 0.7; metal = 0.0; rough = 0.74; coat = 0.0; }
  else if (cls == 1) { col = ${L('#33372a')}; metal = 0.8; rough = 0.55; }
  else if (cls == 9) { col = ${L('#6b5a3a')}; metal = 0.85; rough = 0.45; }
#elif SF_GUN == 3 // debu merapi: loreng digital abu vulkanik (piksel 8 & 16 mm)
  if (body || cls == 3) { vec3 v = floor(p / 0.008) * 0.008, v2 = floor(p / 0.016) * 0.016;
    col = sfCamo4(mix(v, v2, step(0.5, sfH3(v2 * 97.0))), 15.0, ${L('#8e877a')}, ${L('#a99d84')}, ${L('#5a544b')}, ${L('#3a3530')});
    if (cls == 3) col *= 0.72; metal = 0.0; rough = 0.8; }
  else if (cls == 1) { col = ${L('#3c3a36')}; metal = 0.85; rough = 0.5; }
  else if (cls == 9) { col = ${L('#b08d57')}; metal = 1.0; rough = 0.35; }
#elif SF_GUN == 4 // senja: cat permen berpernis, gradasi jingga → magenta → ungu sepanjang laras, serpih logam berkelip
  if (body) { float t = clamp((0.4 - p.z) / 1.05, 0.0, 1.0);
    vec3 g = t < 0.5 ? mix(${L('#ff8c1a')}, ${L('#e8237e')}, t * 2.0) : mix(${L('#e8237e')}, ${L('#4b1fa8')}, t * 2.0 - 1.0);
    float fh = sfH3(floor(p * 1500.0)), fl = smoothstep(0.9, 1.0, fract(fh * 7.31 + vdn * 2.7)) * (1.0 - smoothstep(0.3, 1.0, fwidth(p.z) * 1500.0));
    col = g * (0.82 + 0.18 * sfN3(p * 90.0)) + (g + 0.25) * fl * 0.6; metal = 0.85; rough = 0.3; coat = 1.0; }
  else if (cls == 1) { col = ${L('#2a1236')}; metal = 1.0; rough = 0.2; }
  else if (cls == 3) { col = ${L('#1c1028')}; rough = 0.82; }
  else if (cls == 9) { col = ${L('#ffc65a')}; metal = 1.0; rough = 0.22; }
#elif SF_GUN == 5 // merah naga: sisik bertumpuk berkubah, tepi emas, kilau jingga di sudut landai
  if (body) { vec4 sc = sfScale4(uv * 46.0); float dome = 1.0 - sc.z * sc.z;
    vec3 b = mix(${L('#6e070c')}, ${L('#d11f1b')}, clamp(sc.w * 0.5 + dome * 0.6, 0.0, 1.0));
    b = mix(b, ${L('#1e0204')}, smoothstep(0.88, 1.0, sc.z));
    float rim = smoothstep(0.76, 0.84, sc.z) * (1.0 - smoothstep(0.88, 0.95, sc.z));
    col = mix(b, ${L('#f0b84a')}, rim * 0.9) + ${L('#ff9a3c')} * fr * 0.25;
    metal = mix(0.65, 1.0, rim); rough = mix(0.22, 0.42, sc.z); coat = 0.7; hgt = dome; }
  else if (cls == 1) { col = ${L('#1c0f0f')}; metal = 1.0; rough = 0.3; }
  else if (cls == 3) { float wr = smoothstep(0.32, 0.5, abs(fract((p.y + p.z * 0.6) * 95.0) - 0.5)); col = mix(${L('#3d0a0c')}, ${L('#170304')}, wr); rough = 0.7; hgt = 1.0 - wr; }
  else if (cls == 9) { col = ${L('#f0b84a')}; metal = 1.0; rough = 0.22; }
#elif SF_GUN == 6 // batik mega mendung: awan berlapis gradasi biru, garis putih di tiap lapis, dasar biru malam
  if (body) { float d = sfCloud(uv * 15.0);
    float k = clamp(-d / 0.24, 0.0, 0.999), bi = floor(k * 6.0), fk = fract(k * 6.0), e = min(fk, 1.0 - fk);
    vec3 cl = mix(${L('#163a93')}, ${L('#d6ebff')}, bi / 5.0);
    float sep = sfAA(e, 0.07) * step(0.5, bi);
    col = d < 0.0 ? mix(cl, ${L('#f6f9ff')}, sep * 0.85) : ${L('#0a1338')};
    col = mix(col, ${L('#050a24')}, sfAA(abs(d), 0.012));
    metal = 0.12; rough = 0.34; coat = 0.8; hgt = d < 0.0 ? 0.6 - 0.08 * bi : 0.0; }
  else if (cls == 1) { col = ${L('#0f1733')}; metal = 1.0; rough = 0.28; }
  else if (cls == 3) { col = ${L('#0b1230')}; rough = 0.82; }
  else if (cls == 9) { col = ${L('#e9eef8')}; metal = 1.0; rough = 0.2; }
#elif SF_GUN == 7 // batik kawung: empat kelopak lonjong mengelilingi titik pusat, sogan-krem, isen titik emas
  if (body) { vec2 q = vec2(uv.x + uv.y, uv.y - uv.x) * 0.7071 / 0.03;
    vec2 a = q - vec2(floor(q.x) + 0.5, floor(q.y + 0.5)), b = q - vec2(floor(q.x + 0.5), floor(q.y) + 0.5);
    float ea = length(a / vec2(0.47, 0.25)), eb = length(b / vec2(0.25, 0.47));
    vec2 d = ea < eb ? a : b; float e = min(ea, eb); bool hz = ea < eb;
    float fill = 1.0 - smoothstep(0.86, 0.9, e), line = sfAA(abs(e - 0.93), 0.045);
    float seed = sfAA(abs(hz ? d.y : d.x), 0.03) * step(e, 0.62);
    vec2 c = fract(q) - 0.5; float dot0 = 1.0 - smoothstep(0.07, 0.09, length(c));
    vec3 r = ${L('#5c3214')};
    r = mix(r, ${L('#ead7a8')}, fill);
    r = mix(r, ${L('#6b3a17')}, seed * 0.8);
    r = mix(r, ${L('#24120a')}, line);
    float au = dot0 * (1.0 - fill);
    col = mix(r, ${L('#e3ad45')}, au); metal = au; rough = mix(0.36, 0.24, au); coat = 0.7; hgt = fill * (1.0 - line); }
  else if (cls == 1) { col = ${L('#3a2614')}; metal = 1.0; rough = 0.32; }
  else if (cls == 3) { col = ${L('#2a150a')}; rough = 0.78; }
  else if (cls == 9) { col = ${L('#e3ad45')}; metal = 1.0; rough = 0.24; }
#elif SF_GUN == 8 // wayang kulit: sisik ornamen bertatah — cincin emas, merah, tosca berlubang tatahan, garis hitam
  if (body) { vec4 sc = sfScale4(uv * 34.0);
    float rg = fract(sc.z * 4.0), e = min(rg, 1.0 - rg), band = floor(sc.z * 4.0);
    float ang = atan(sc.y, sc.x) / 6.2832 * (10.0 + band * 6.0);
    float holes = (1.0 - smoothstep(0.2, 0.3, length(vec2(fract(ang) - 0.5, (rg - 0.5) * 1.4)))) * step(0.5, band) * step(band, 2.5);
    vec3 fc = band < 1.0 ? ${L('#d9a640')} : band < 2.0 ? ${L('#a3261b')} : band < 3.0 ? ${L('#1d6a63')} : ${L('#c8a46a')};
    vec3 r = mix(fc, ${L('#140c08')}, holes * 0.9);
    r = mix(r, ${L('#0d0806')}, sfAA(e, 0.06));
    float au = band < 1.0 ? 1.0 : 0.0;
    col = r; metal = au * 0.9; rough = mix(0.5, 0.28, au); coat = 0.3; hgt = 1.0 - holes; }
  else if (cls == 1) { col = ${L('#3b2b16')}; metal = 1.0; rough = 0.3; }
  else if (cls == 3) { float s = 0.5 + 0.5 * sin(p.y * 260.0 + sfN3(p * 60.0) * 5.0); col = mix(${L('#130b07')}, ${L('#3a2412')}, s * 0.6); rough = 0.3; coat = 0.8; }
  else if (cls == 9) { col = ${L('#e2b04a')}; metal = 1.0; rough = 0.22; }
#elif SF_GUN == 9 // ondel-ondel: pernis merah berbunga emas delapan kelopak; polimer gading berpita kembang kelapa
  if (cls == 4 || cls == 5) { vec2 g = uv / 0.045; vec2 c = fract(g + vec2(0.0, 0.5 * mod(floor(g.x), 2.0))) - 0.5;
    float r = length(c), a = atan(c.y, c.x), pet = 0.18 + 0.16 * sfPetal(a, 8.0, 2.0);
    float fl = 1.0 - smoothstep(pet - 0.02, pet + 0.01, r), ol = sfAA(abs(r - pet), 0.012), ct = 1.0 - smoothstep(0.05, 0.07, r);
    vec3 red = mix(${L('#a50f17')}, ${L('#d81e24')}, 0.5 + 0.5 * sfN3(p * 40.0));
    col = mix(red, ${L('#e8b445')}, max(fl * 0.85, ol)); col = mix(col, ${L('#1f8a4c')}, ct);
    metal = max(fl, ol) * 0.9; rough = 0.22; coat = 1.0; hgt = fl; }
  else if (cls == 2) { float gz = fract(p.z * 9.0), x = (p.z * 0.7 + p.y) * 70.0, k = floor(fract(x / 5.0) * 5.0);
    vec3 rib = k < 1.0 ? ${L('#d81e24')} : k < 2.0 ? ${L('#f2c230')} : k < 3.0 ? ${L('#1f8a4c')} : k < 4.0 ? ${L('#2459b8')} : ${L('#e04c9a')};
    float on = step(gz, 0.38) * step(0.3, fract(x)), dt = 1.0 - smoothstep(0.1, 0.16, length(fract(uv / 0.02) - 0.5));
    col = mix(${L('#f1e8d2')}, rib, on); col = mix(col, ${L('#e8b445')}, dt * (1.0 - on) * step(0.45, gz));
    metal = dt * (1.0 - on) * 0.8; rough = 0.24; coat = 1.0; }
  else if (cls == 1) { col = ${L('#d9a840')}; metal = 1.0; rough = 0.2; }
  else if (cls == 3) { col = ${L('#0d0b0c')}; rough = 0.3; coat = 1.0; }
  else if (cls == 9) { col = ${L('#e8b445')}; metal = 1.0; rough = 0.2; }
#elif SF_GUN == 10 // marmer kencana: marmer putih Carrara berurat abu, urat emas (kintsugi), dipoles
  if (body) { vec3 m = p * 9.0; float tb = sfN3(m * 2.0) * 1.7 + sfN3(m * 5.3 + 7.0) * 0.9;
    float gv = abs(sin(m.x * 1.3 + m.y * 0.7 + m.z * 0.9 + tb * 3.2)), grey = (1.0 - smoothstep(0.0, 0.16, gv)) + 0.35 * (1.0 - smoothstep(0.0, 0.5, gv));
    float au = sfAA(abs(sin(m.z * 1.1 - m.y * 0.8 + sfN3(m * 1.5 + 31.0) * 4.5 + tb)), 0.06);
    col = mix(${L('#f4f1ec')}, ${L('#7d7a76')}, min(grey, 1.0) * 0.7) * (0.95 + 0.05 * tb);
    col = mix(col, ${L('#e9b44a')}, au); metal = au; rough = mix(0.1, 0.2, au); coat = 1.0 - au; hgt = au; }
  else if (cls == 3) { vec3 m = p * 9.0; float gv = abs(sin(m.x * 1.1 + m.z * 0.9 + sfN3(m * 2.0) * 5.0)); col = mix(${L('#0d0d0f')}, ${L('#d8d5d0')}, (1.0 - smoothstep(0.0, 0.06, gv)) * 0.7); rough = 0.14; coat = 1.0; }
  else if (cls == 1) { col = ${L('#e9b44a')}; metal = 1.0; rough = 0.16; }
  else if (cls == 9) { col = ${L('#f6d27a')}; metal = 1.0; rough = 0.14; }
#elif SF_GUN == 11 // kristal es: faset es berlapis; tirai aurora mengalir di dalam es, embun beku merayap di retakan, kilau salju
  if (body || cls == 3) { vec2 v = sfVor(uv * 36.0);
    float ck = sfAA(v.x, 0.02);
    float inner = sfN2(uv * 22.0 + vec2(T * 0.9, 0.0) + (1.0 - vdn) * 3.0);
    vec3 deep = mix(${L('#082f55')}, ${L('#2f8fcc')}, v.y);
    col = mix(deep, ${L('#bfe9ff')}, inner * 0.3 + fr * 0.5);
    col = mix(col, ${L('#f4fbff')}, ck * 0.9);
    float aur = pow(0.5 + 0.5 * sin(p.z * 11.0 + T * 3.2 + inner * 3.0 + p.y * 9.0), 4.0);             // tirai aurora berjalan ke moncong
    float creep = ck * pow(0.5 + 0.5 * sin(p.z * 19.0 + T * 5.5 + v.y * 2.0), 8.0);                     // embun beku merayap menyusuri retakan
    float sh = sfH3(floor(p * 900.0)), sp = step(0.984, sh) * pow(0.5 + 0.5 * sin(T * 7.0 + sh * 40.0), 4.0);
    emis = (${L('#3fb8ff')} * (0.08 + 1.5 * aur) * (1.0 - ck) * (1.0 - inner * 0.4) + ${L('#e8fbff')} * (ck * 0.25 + creep * 2.6) + vec3(2.2) * sp) * gb + ${L('#bff0ff')} * sw * 2.5;
    metal = 0.12; rough = mix(0.06, 0.3, ck); coat = 1.0; hgt = 1.0 - ck; }
  else if (cls == 1) { float fr2 = pow(0.5 + 0.5 * sin(p.z * 14.0 + T * 4.0), 6.0); col = ${L('#c8dcea')}; metal = 1.0; rough = 0.34; emis = ${L('#9fe3ff')} * (fr2 * 0.6 + sw * 2.0); }
  else if (cls == 9) { col = ${L('#bff2ff')}; metal = 0.2; rough = 0.1; emis = ${L('#5fd8ff')} * (1.0 + 1.6 * pow(0.5 + 0.5 * sin(T * 3.0), 3.0)) * gb; }
#elif SF_GUN == 12 // neon ungu: badan hitam mengilap, kisi segi enam; dua rangkaian gelombang energi melesat ke moncong, sel berkedip data
  if (body) { vec3 h = sfHex(uv * 42.0);
    float edge = sfAA(h.z, 0.035);
    float wave = pow(0.5 + 0.5 * sin(p.z * 9.0 + T * 7.0), 12.0) + 0.8 * pow(0.5 + 0.5 * sin(p.z * 3.6 + T * 3.1 + 1.3), 18.0);
    float blink = step(0.84, sfH2(h.xy + floor(T * 3.0))) * smoothstep(0.06, 0.3, h.z);
    col = mix(${L('#07060c')}, ${L('#1a1030')}, smoothstep(0.0, 0.5, h.z));
    col = mix(col, ${L('#b24dff')} * 0.6, edge * 0.8);
    emis = (${L('#b24dff')} * edge * (0.25 + 6.5 * wave) + mix(${L('#b24dff')}, ${L('#22e6ff')}, 0.5) * blink * (0.7 + 1.8 * wave) + ${L('#22e6ff')} * wave * smoothstep(0.1, 0.4, h.z) * 0.35) * gb + ${L('#e2b0ff')} * sw * 3.0;
    metal = 0.5; rough = 0.18; coat = 1.0; hgt = 1.0 - edge; }
  else if (cls == 1) { float wv = pow(0.5 + 0.5 * sin(p.z * 9.0 + T * 7.0), 12.0); col = ${L('#0d0c12')}; metal = 1.0; rough = 0.12; emis = ${L('#b24dff')} * (wv * 1.4 + sw * 2.0); }
  else if (cls == 3) { float s = sfAA(abs(fract(p.y * 30.0) - 0.5), 0.04), wv = pow(0.5 + 0.5 * sin(p.y * 14.0 - T * 6.0), 8.0); col = mix(${L('#09080d')}, ${L('#b24dff')}, s * 0.5); emis = ${L('#b24dff')} * s * (0.3 + 3.0 * wv) * gb; rough = 0.7; }
  else if (cls == 9) { col = ${L('#22e6ff')}; emis = ${L('#22e6ff')} * (1.2 + 2.0 * pow(0.5 + 0.5 * sin(T * 5.0), 4.0)) * gb; rough = 0.4; }
#elif SF_GUN == 13 // songket emas: sutra marun bertenun benang emas — kisi ketupat & bintang delapan; kilau menyapu benang, bintang berkelip bergiliran
  if (body) { vec2 q = vec2(uv.x + uv.y, uv.y - uv.x) * 0.7071 / 0.028;
    vec2 c = fract(q) - 0.5; float dm = abs(c.x) + abs(c.y);
    vec2 c2 = vec2(c.x - c.y, c.x + c.y) * 0.7071;
    float r = length(c2), a = atan(c2.y, c2.x), star = 0.11 + 0.17 * sfPetal(a, 8.0, 6.0);
    float gS = 1.0 - smoothstep(star - 0.015, star + 0.01, r), gL = sfAA(abs(dm - 0.47), 0.03), g = max(gS, gL);
    float weave = 0.82 + 0.18 * sin(p.y * 2400.0) * sin(p.z * 700.0);
    vec3 silk = mix(${L('#4a0812')}, ${L('#7d1222')}, 0.5 + 0.5 * sfN3(p * 30.0)) * weave;
    float glint = exp(-pow((p.z + p.y * 0.6 + 0.95 - fract(T * 0.45) * 2.5) * 7.0, 2.0));
    float tw = gS * pow(0.5 + 0.5 * sin(T * 4.0 + sfH2(floor(q)) * 6.28), 10.0);
    col = mix(silk, ${L('#e7b84d')} * (0.85 + 0.15 * sin(p.y * 2400.0)), g); metal = g; rough = mix(0.5, 0.26, g); coat = 0.0; hgt = g;
    emis = ${L('#ffd27a')} * g * (glint * 2.6 + tw * 2.2 + 0.05) * gb + ${L('#ffe2a0')} * g * sw * 2.5; }
  else if (cls == 1) { col = ${L('#e2ad45')}; metal = 1.0; rough = 0.2; emis = ${L('#ffe2a0')} * (exp(-pow((p.z + 0.95 - fract(T * 0.45) * 2.5) * 7.0, 2.0)) * 1.2 + sw * 1.5); }
  else if (cls == 3) { col = ${L('#3c0710')}; rough = 0.95; }
  else if (cls == 9) { col = ${L('#f2c25a')}; metal = 1.0; rough = 0.16; emis = ${L('#ffcf6a')} * (0.5 + 1.2 * pow(0.5 + 0.5 * sin(T * 2.5), 4.0)) * gb; }
#elif SF_GUN == 14 // pamor keris: baja hitam bergaris pamor nikel; cahaya tuah merambat menyusuri garis pamor; warangka timoho; mendak emas
  if (cls == 4 || cls == 1) { float pm = sfPamor(p);
    col = mix(${L('#16181b')}, ${L('#b9c0c6')}, pm);
    float rip = pow(0.5 + 0.5 * sin(p.z * 12.0 - T * 4.2 + p.y * 30.0), 8.0) + 0.6 * pow(0.5 + 0.5 * sin(p.z * 4.0 - T * 1.7), 10.0);
    emis = mix(${L('#2fd3b0')}, ${L('#ffcf6a')}, 0.3) * pm * (0.06 + 2.6 * rip) * gb + ${L('#9ff5e0')} * pm * sw * 3.0;
    metal = 1.0; rough = mix(0.42, 0.18, pm); hgt = pm; }
  else if (cls == 2 || cls == 5) { float gr = sfN3(p * vec3(90.0, 90.0, 9.0)), lines = 0.5 + 0.5 * sin(p.y * 320.0 + gr * 9.0 + p.x * 120.0);
    float spot = smoothstep(0.62, 0.7, sfN3(p * 70.0 + 3.0));
    col = mix(${L('#5a3a1f')}, ${L('#2a1a0e')}, gr * 0.6 + lines * 0.25); col = mix(col, ${L('#120b06')}, spot * 0.85);
    rough = 0.3; coat = 1.0; hgt = lines * 0.3; }
  else if (cls == 3) { float wr = smoothstep(0.3, 0.5, abs(fract((p.y - p.z * 0.5) * 80.0) - 0.5)); col = mix(${L('#1e140d')}, ${L('#080605')}, wr); rough = 0.65; hgt = 1.0 - wr; }
  else if (cls == 9) { float gem = step(0.82, sfH3(floor(p * 160.0))); col = mix(${L('#e3ad45')}, sfH3(floor(p * 160.0) + 3.0) > 0.5 ? ${L('#b0102a')} : ${L('#0f7a3c')}, gem); metal = 1.0 - gem; rough = 0.2; emis = col * gem * (0.4 + 1.6 * pow(0.5 + 0.5 * sin(T * 3.0 + p.z * 40.0), 6.0)) * gb; }
#elif SF_GUN == 15 // badai petir: logam badai biru-kelabu, kilat bercabang menyambar & berkedip, awan bergulung
  if (body || cls == 3) { float cloud = sfN3(p * 26.0 + vec3(0.0, T * 0.4, T * 0.6)) * 0.7 + sfN2(uv * 90.0) * 0.3;
    vec3 base = mix(${L('#0d1119')}, ${L('#2c3548')}, cloud);
    float tt = floor(T * 9.0), lane = floor(uv.y * 16.0 + 0.5);
    float yy = uv.y * 16.0 - lane - (sfN2(vec2(uv.x * 12.0, lane * 7.1 + tt)) - 0.5) * 0.9 - (sfN2(vec2(uv.x * 48.0, lane * 3.3 + tt)) - 0.5) * 0.3;
    float on = step(0.45, sfH2(vec2(lane, tt)));
    float core = sfAA(abs(yy), 0.05) * on, halo = exp(-abs(yy) * 7.0) * on;
    vec2 v = sfVor(uv * 34.0 + vec2(tt * 1.7, 0.0)); float br = sfAA(v.x, 0.025) * step(0.82, fract(v.y * 13.0 + tt * 0.37));
    float fl = 0.7 + 0.3 * sin(T * 47.0);
    col = mix(base, ${L('#c9c2ff')}, max(core, br * 0.8));
    emis = (${L('#efeaff')} * (core + br * 0.8) * 4.5 + ${L('#6f5cff')} * halo * 1.4 + ${L('#4a3cff')} * pow(cloud, 3.0) * 0.25) * fl * gb + ${L('#b8b0ff')} * sw * 2.5;
    metal = 0.55; rough = 0.3; coat = 0.6; }
  else if (cls == 1) { col = ${L('#1a1f2e')}; metal = 1.0; rough = 0.26; emis = ${L('#8f80ff')} * (step(0.75, sfH2(vec2(floor(T * 9.0), 3.0))) * 0.8 + sw * 2.0); }
  else if (cls == 9) { col = ${L('#8f80ff')}; emis = ${L('#8f80ff')} * (1.2 + 2.0 * step(0.6, sfH2(vec2(floor(T * 9.0), 1.0)))) * gb; rough = 0.3; }
#elif SF_GUN == 16 // holografik: foil pelangi yang bergeser menurut sudut & waktu, garis difraksi, pita pindaian holo menyapu
  if (body) { float h = fract(vdn * 1.6 + p.z * 2.5 + p.y * 3.0 + T * 0.22);
    vec3 rb = sfHue(h); float gr = 0.5 + 0.5 * sin((p.z + p.y) * 2600.0);
    float scan = sfAA(abs(fract(p.y * 5.0 - T * 0.9) - 0.5), 0.025) + exp(-pow((p.z - (0.5 - fract(T / 1.8) * 1.6)) * 14.0, 2.0));
    vec3 hx = sfHex(uv * 60.0); float seal = sfAA(hx.z, 0.02) * (0.3 + 0.7 * pow(0.5 + 0.5 * sin(p.z * 8.0 + T * 5.0), 6.0));
    col = mix(vec3(0.72), rb, 0.7) * (0.75 + 0.25 * gr); metal = 1.0; rough = 0.12; coat = 0.6;
    emis = (rb * (0.08 + seal * 1.2) + vec3(0.9, 0.95, 1.0) * scan * 1.6) * gb + rb * sw * 2.5; }
  else if (cls == 1) { col = ${L('#c9ccd2')}; metal = 1.0; rough = 0.08; }
  else if (cls == 3) { float e = sfAA(abs(fract(p.z * 20.0) - 0.5), 0.03); vec3 rb = sfHue(fract(p.z * 3.0 + T * 0.3)); col = mix(${L('#0b0b0e')}, rb, e * 0.6); emis = rb * e * 0.9 * gb; rough = 0.75; }
  else if (cls == 9) { col = vec3(0.9); emis = sfHue(fract(T * 0.3)) * 1.8 * gb; rough = 0.2; }
#elif SF_GUN == 17 // mutiara laut: nacre berlapis bergelombang, pelangi pastel; kilau mutiara mengalir menyusuri lapisan
  if (body) { float l = (sfN3(p * 25.0) * 0.65 + sfN3(p * 61.0 + 3.0) * 0.35) * 6.0 + p.z * 2.0 + T * 0.12, b = fract(l), e = min(b, 1.0 - b);
    vec3 pastel = mix(${L('#f7d6e0')}, ${L('#c7f0ec')}, 0.5 + 0.5 * sin(l * 3.0 + vdn * 4.0 + T * 0.6));
    pastel = mix(pastel, ${L('#f2e3b8')}, 0.5 + 0.5 * sin(l * 1.7 - vdn * 3.0));
    col = mix(${L('#f1ece6')}, pastel, 0.62 + 0.3 * fr) * (0.88 + 0.12 * sfAA(e, 0.12));
    metal = 0.25; rough = 0.16; coat = 1.0; hgt = 0.5 + 0.5 * sin(l * 6.2832);
    emis = pastel * (0.05 + 1.1 * pow(0.5 + 0.5 * sin(l * 2.0 - T * 2.6), 10.0)) * gb + ${L('#fff6f0')} * sw * 2.0; }
  else if (cls == 1) { col = ${L('#e6a58a')}; metal = 1.0; rough = 0.2; }
  else if (cls == 3) { col = ${L('#0e2a3a')}; rough = 0.6; }
  else if (cls == 9) { col = ${L('#f9f1ea')}; metal = 0.3; rough = 0.1; emis = ${L('#fff1e8')} * (0.4 + 1.0 * pow(0.5 + 0.5 * sin(T * 2.0), 4.0)) * gb; }
#elif SF_GUN == 18 // emas garuda: emas berukir bulu; sapuan cahaya emas menyapu badan tiap 2,2 dtk, bulu menyala bergiliran beriak; filigri sayap berpendar berjalan
  if (cls == 1 || cls == 4) { vec4 sc = sfScale4(uv * vec2(30.0, -30.0));
    float rachis = sfAA(abs(sc.x), 0.05) * step(sc.z, 0.92);
    float barbs = (1.0 - smoothstep(0.05, 0.12, abs(fract((sc.z * 0.95 - abs(sc.x) * 0.65) * 6.0) - 0.5))) * step(sc.z, 0.9) * 0.6;
    float rim = smoothstep(0.8, 0.95, sc.z), groove = max(max(rachis, barbs), rim);
    vec3 gold = mix(${L('#ffd666')}, ${L('#e0a83a')}, sc.w * 0.6);
    col = mix(gold, ${L('#8a5a1a')}, groove * 0.7);
    metal = 1.0; rough = mix(0.12, 0.38, groove); hgt = 1.0 - groove;
    float sweep = exp(-pow((p.z + 0.95 - fract(T / 2.2) * 2.6) * 6.0, 2.0));
    float ripple = pow(0.5 + 0.5 * sin(sc.w * 6.2832 + T * 3.2 - p.z * 9.0), 10.0);
    emis = ${L('#ffcf5a')} * ((sweep * 2.6 + ripple * 0.9 + 0.05) * (1.0 - groove) + rim * (0.3 + 1.2 * ripple + sweep)) * gb + ${L('#fff0b0')} * sw * 3.0 * (1.0 - groove); }
  else if (cls == 2 || cls == 5) { vec4 sc = sfScale4(uv * vec2(14.0, -14.0));
    float ol = min(sfAA(abs(sc.z - 0.86), 0.04) + sfAA(abs(sc.x), 0.04) * step(sc.z, 0.8), 1.0);
    vec3 lac = mix(${L('#3a0606')}, ${L('#6d1010')}, 0.5 + 0.5 * sfN3(p * 30.0));
    float run = pow(0.5 + 0.5 * sin(p.z * 10.0 + T * 4.0 - sc.w * 3.0), 8.0), sweep = exp(-pow((p.z + 0.95 - fract(T / 2.2) * 2.6) * 6.0, 2.0));
    col = mix(lac, ${L('#e9b440')}, ol); metal = ol; rough = mix(0.25, 0.22, ol); coat = 1.0 - ol * 0.6;
    emis = ${L('#ffcf5a')} * ol * (0.08 + 2.0 * run + 2.2 * sweep + sw * 2.0); hgt = ol; }
  else if (cls == 3) { float st = sfAA(abs(fract(p.z * 60.0) - 0.5), 0.12) * sfAA(abs(fract(p.y * 18.0) - 0.5), 0.06); col = mix(${L('#3a0b08')}, ${L('#d9a43a')}, st); metal = st; rough = 0.6; }
  else if (cls == 9) { col = ${L('#ffd15a')}; metal = 1.0; rough = 0.14; emis = ${L('#ffc64a')} * (0.6 + 1.6 * pow(0.5 + 0.5 * sin(T * 2.6), 4.0)) * gb; }
#elif SF_GUN == 19 // dadak merak: mata bulu merak berpelangi — inti mata berdenyut bergiliran, kilau kipas beriak menyapu bulu; loreng macan di gagang
  if (cls == 2 || cls == 4) { vec4 sc = sfScale4(uv * vec2(22.0, -22.0));
    vec4 pk = sfPeacock(sc.xy, sc.z, sc.w, vdn);
    float fan = pow(0.5 + 0.5 * sin(p.z * 10.0 - T * 3.4 + sc.w * 2.0), 6.0);
    float core = pow(0.5 + 0.5 * sin(T * 3.2 + sc.w * 6.2832), 3.0);
    vec3 iri = sfHue(fract(0.42 + 0.14 * sin(T * 1.1 + sc.w * 6.2832) + vdn * 0.25));
    col = pk.rgb * (0.8 + 0.5 * fan); metal = 0.35; rough = 0.3; coat = 0.8; hgt = 1.0 - sc.z * 0.5;
    emis = (${L('#2a6bff')} * pk.a * (0.25 + 2.2 * core) + iri * fan * (1.0 - pk.a) * 0.7 + ${L('#38e0b0')} * fr * 0.25) * gb + ${L('#7ff0d0')} * sw * 2.5; }
  else if (cls == 3 || cls == 5) { float s = sin(p.y * 90.0 + sfFbm(p * 30.0) * 6.0 + p.z * 20.0), str = smoothstep(0.55, 0.7, s);
    col = mix(${L('#d8761c')}, ${L('#0d0805')}, str); col = mix(col, ${L('#f2e2c0')}, smoothstep(0.75, 0.95, sfN3(p * 25.0)) * (1.0 - str) * 0.5); rough = 0.6;
    emis = ${L('#ff8a2a')} * (1.0 - str) * pow(0.5 + 0.5 * sin(p.y * 12.0 - T * 3.0), 8.0) * 0.5; }
  else if (cls == 1) { col = ${L('#1a0d0b')}; metal = 1.0; rough = 0.25; emis = ${L('#c41a1a')} * sw * 1.5; }
  else if (cls == 9) { col = ${L('#c41a1a')}; metal = 0.6; rough = 0.2; emis = ${L('#ff3a2a')} * (0.5 + 1.6 * pow(0.5 + 0.5 * sin(T * 2.4), 4.0)) * gb; }
#elif SF_GUN == 20 // inti magma: obsidian retak; lava MENGALIR di retakan (gelombang terang melaju ke moncong), bara di bawah kulit batu bernapas,
                   // jilatan api naik dari retakan; menembak = makin panas: retakan melebar, cahaya memutih, laras membara
  float heat = clamp(uSfG.y, 0.0, 1.5);
  if (body || cls == 3) { vec2 v = sfVor(uv * 26.0);
    float fl = sfN3(p * 30.0 + vec3(0.0, T * 1.1, T * 0.6));
    float w = 0.065 + 0.06 * heat + 0.025 * fl;
    float ck = 1.0 - smoothstep(0.0, w, v.x), near = 1.0 - smoothstep(0.0, w * 4.0, v.x);
    float run = pow(0.5 + 0.5 * sin(p.z * 15.0 + T * 7.5 + fl * 4.0), 3.0);          // gelombang lava ±0,5 m/dtk ke moncong
    float run2 = pow(0.5 + 0.5 * sin(p.z * 37.0 + T * 13.0 + fl * 6.0), 6.0);        // riak kecil lebih cepat
    float lava = ck * clamp(0.18 + 0.9 * run + 0.5 * run2, 0.0, 1.6);
    float breath = pow(0.5 + 0.5 * sin(p.z * 6.0 + T * 3.0 + fl * 2.0), 2.0);       // bara di bawah kulit batu berdenyut berombak
    float tongue = smoothstep(0.6, 0.92, sfN2(vec2(uv.x * 34.0, uv.y * 20.0 - T * 4.6)) * (0.35 + near));
    col = mix(mix(${L('#040303')}, ${L('#120a0c')}, fl * 0.7), ${L('#2a0802')}, near * 0.85);
    vec3 hot = mix(${L('#ff2800')}, ${L('#fff0b0')}, clamp(lava * 0.75 + run2 * 0.3 + heat * 0.35, 0.0, 1.0));
    emis = (hot * lava * (2.8 + heat * 3.5) + ${L('#ff3a00')} * (near - ck) * (0.12 + 0.9 * breath) * (1.0 + heat * 1.6) + ${L('#ff7a10')} * tongue * (0.5 + 1.2 * run)) * gb + ${L('#ffb040')} * sw * 2.5 * near;
    metal = 0.25 * (1.0 - near); rough = mix(0.1, 0.65, ck); coat = 0.8 * (1.0 - near); hgt = 1.0 - ck; }
  else if (cls == 1) { float tip = smoothstep(-0.2, -0.75, p.z), hot = clamp(tip * (0.3 + heat * 1.1) + heat * 0.3, 0.0, 1.6);
    float rip = 0.55 + 0.45 * sin(p.z * 60.0 + T * 9.0);                             // riak panas melaju ke moncong
    col = mix(${L('#151210')}, ${L('#3a1205')}, clamp(hot, 0.0, 1.0)); metal = 1.0; rough = 0.35;
    emis = mix(${L('#ff2a00')}, ${L('#ffd27a')}, clamp(hot - 0.5, 0.0, 1.0)) * hot * (1.6 + 2.4 * rip) + ${L('#ffb040')} * sw * 1.5; }
  else if (cls == 9) { col = ${L('#ffb24a')}; metal = 1.0; rough = 0.25; emis = ${L('#ff7a1a')} * (1.0 + 1.8 * pow(0.5 + 0.5 * sin(T * 3.0), 3.0) + heat * 2.0) * gb; }
#elif SF_GUN == 21 // reaktor plasma: keramik putih bersambungan panel; arus plasma MELESAT di kanal ke moncong, pita pindaian holo menyapu badan,
                   // panah berdenyut; menembak = arus & inti makin terang
  float heat = clamp(uSfG.y, 0.0, 1.5);
  if (body) { float seg = floor(p.z * 11.0 + sfH2(vec2(floor(p.y * 14.0), 2.0)) * 0.5), fz = fract(p.z * 11.0);
    float seam = min(sfAA(min(fz, 1.0 - fz), 0.025) + sfAA(abs(fract(p.y * 14.0) - 0.5), 0.02) * 0.6, 1.0);
    bool white = mod(seg, 4.0) != 2.0;
    vec3 c = white ? ${L('#e8ecf0')} : ${L('#1c1f25')};
    float li = floor(uv.y * 26.0), lane = abs(fract(uv.y * 26.0) - 0.5), ch = sfAA(lane, 0.07) * step(0.55, sfH2(vec2(li, 5.0)));
    float s1 = pow(fract(p.z * 3.0 + T * 2.6 + sfH2(vec2(li, 1.0))), 12.0), s2 = pow(fract(p.z * 7.0 + T * 4.4 + sfH2(vec2(li, 2.0))), 16.0);
    float scan = exp(-pow((p.z - (0.55 - fract(T / 2.4) * 1.7)) * 16.0, 2.0));
    float chev = sfAA(abs(fract((abs(uv.y - 0.01) * 2.0 + p.z) * 18.0 - T * 4.0) - 0.5), 0.08) * step(fz, 0.35) * (white ? 0.0 : 1.0);
    col = mix(c, ${L('#0a0c10')}, seam * 0.85); col = mix(col, ${L('#9ff2ff')}, ch * 0.7);
    metal = white ? 0.05 : 0.5; rough = white ? 0.22 : 0.35; coat = white ? 1.0 : 0.3; hgt = 1.0 - seam;
    emis = (${L('#2fd8ff')} * (ch * (0.4 + 6.0 * (s1 + 0.8 * s2)) * (1.0 + heat) + chev * 2.4 + seam * scan * 3.5) + ${L('#bff6ff')} * scan * (white ? 0.5 : 0.25)) * gb + ${L('#bff6ff')} * sw * 3.0; }
  else if (cls == 1) { float e = sfAA(abs(fract(p.z * 30.0) - 0.5), 0.05), s = pow(fract(p.z * 5.0 + T * 3.5), 10.0); col = ${L('#1a1d22')}; metal = 1.0; rough = 0.25; emis = ${L('#2fd8ff')} * e * (0.3 + 3.0 * s + heat * 1.5) * gb; }
  else if (cls == 3) { col = ${L('#15171c')}; rough = 0.7; }
  else if (cls == 9) { col = ${L('#bff6ff')}; emis = ${L('#2fd8ff')} * (1.0 + 2.6 * pow(0.5 + 0.5 * sin(T * 6.2832 * 1.1), 6.0) + heat * 1.8) * gb; rough = 0.2; }
#endif
}
`;

// ---------- Nyala moncong beranimasi (billboard shader; view-model senjata pemain & etalase lobi) ----------
// Bentuk utuh, bukan titik: lidah api menjilat naik, bola plasma berpusar dengan busur listrik, bintang kilau emas berputar,
// api roh berpusar, busur listrik berkedip, kabut beku bergulung, pijar lembut. Idle = nyala kecil; menembak & panas = membesar.
// Quad 2×2 (PlaneGeometry) di titik moncong, selalu menghadap kamera; uLift 1 = dasar quad di moncong (api naik).
export const FLAME_STYLE = { fire: 1, plasma: 2, glint: 3, spirit: 4, arc: 5, frost: 6, glow: 7 };
export const FLAME_VS = `uniform float uSize, uLift; varying vec2 vUv;
void main() { vUv = position.xy; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += (position.xy + vec2(0.0, uLift)) * uSize; gl_Position = projectionMatrix * mv; }`;
export const FLAME_FS = `uniform float uT, uHeat, uKick, uStyle, uFade; uniform vec3 uC1, uC2; varying vec2 vUv;
float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y); }
float fb(vec2 p) { return fn(p) * 0.55 + fn(p * 2.1 + 3.7) * 0.3 + fn(p * 4.3 + 9.1) * 0.15; }
void main() {
  vec2 q = vUv; float T = uT, a = 0.0; vec3 c = uC1;
  int s = int(uStyle + 0.5);
  if (s == 1 || s == 4) { // api / api roh: lidah api meliuk naik dari dasar, ujung pecah, inti putih-kuning
    float h = q.y * 0.5 + 0.5, sp = s == 1 ? 1.0 : 0.7;
    float n1 = fb(vec2(q.x * 1.8 + (s == 4 ? sin(T + q.y * 2.0) * 0.5 : 0.0), q.y * 1.3 - T * 2.6 * sp)), n2 = fb(vec2(q.x * 3.6 + 7.0, q.y * 2.6 - T * 4.4 * sp));
    float x = q.x + (n1 - 0.5) * (s == 1 ? 0.9 : 1.3) * h + (n2 - 0.5) * 0.25 * h + (s == 4 ? 0.22 * sin(q.y * 4.0 - T * 3.0) * h : 0.0);
    float w = mix(s == 1 ? 0.62 : 0.45, 0.05, pow(h, 0.8));
    float body = 1.0 - smoothstep(w * 0.45, w, abs(x)), lick = smoothstep(0.0, 0.35, n1 + 0.55 - h * 0.95);
    a = body * lick * smoothstep(0.0, 0.08, h);
    float core = max(0.0, (1.0 - smoothstep(0.0, w * 0.55, abs(x))) * (1.0 - h * 1.1));
    c = s == 1 ? mix(uC1, uC2, clamp(core * 1.2 + (1.0 - h) * 0.2, 0.0, 1.0)) + vec3(1.0, 0.7, 0.3) * core * 0.6
               : mix(uC1, uC2, smoothstep(0.15, 0.9, h + (n1 - 0.5) * 0.6)) + vec3(0.8, 1.0, 0.9) * core * 0.8;
  } else if (s == 2) { // plasma: bola energi berdenyut, busur listrik berpusar, lingkar cahaya
    float r = length(q), an = atan(q.y, q.x);
    float sw = fb(vec2(an * 1.6 + T * 2.8 - r * 3.0, r * 4.0 - T * 3.5));
    float orb = exp(-r * r * 10.0) * (0.85 + 0.15 * sin(T * 20.0));
    float arcs = pow(1.0 - smoothstep(0.0, 0.08, abs(sw - 0.55)), 2.0) * smoothstep(1.0, 0.25, r);
    float ring = exp(-pow((r - 0.55 - 0.08 * sin(T * 6.0)) * 14.0, 2.0)) * 0.6;
    a = orb + arcs * 0.9 + ring + exp(-r * r * 3.0) * 0.3; c = mix(uC1, uC2, clamp(orb * 1.4 + arcs * 0.3, 0.0, 1.0));
  } else if (s == 3) { // kilau emas: bintang bersinar berputar + pijar
    float r = length(q), an = atan(q.y, q.x);
    float rays = pow(abs(cos(an * 2.0 + T * 0.9)), 40.0) * (1.0 - smoothstep(0.0, 1.0, r)) + pow(abs(cos(an * 3.0 - T * 1.4 + 0.5)), 60.0) * (1.0 - smoothstep(0.0, 0.8, r)) * 0.7;
    float glow = exp(-r * r * 8.0);
    a = glow * (0.8 + 0.2 * sin(T * 5.0)) + rays; c = mix(uC1, uC2, glow);
  } else if (s == 5) { // busur listrik: 4 sambaran patah dari pusat, berganti 14×/dtk
    float tt = floor(T * 14.0);
    for (int i = 0; i < 4; i++) {
      float fi = float(i), ang = fh(vec2(tt, fi)) * 6.2832, len = 0.55 + 0.45 * fh(vec2(tt, fi + 7.0));
      vec2 dir = vec2(cos(ang), sin(ang)), nrm = vec2(-dir.y, dir.x);
      float t = dot(q, dir), d = dot(q, nrm) - (fn(vec2(t * 7.0, tt + fi * 3.0)) - 0.5) * 0.4 * t;
      a += (exp(-abs(d) * 70.0) + 0.3 * exp(-abs(d) * 14.0)) * step(0.0, t) * (1.0 - smoothstep(len * 0.6, len, t));
    }
    float core = exp(-dot(q, q) * 14.0);
    a = a * 0.9 + core; c = mix(uC1, uC2, clamp(a * 0.6, 0.0, 1.0));
  } else if (s == 6) { // kabut beku: asap dingin bergulung turun
    float n1 = fb(vec2(q.x * 1.6 + T * 0.35, q.y * 1.6 + T * 0.9)), r = length(q * vec2(1.0, 0.85));
    a = smoothstep(0.38, 0.8, n1) * (1.0 - smoothstep(0.25, 1.0, r)) * 0.8 + exp(-r * r * 12.0) * 0.4; c = mix(uC1, uC2, n1);
  } else { // pijar lembut berdenyut dengan lingkar berputar
    float r = length(q), an = atan(q.y, q.x);
    a = exp(-r * r * 6.0) * (0.7 + 0.3 * sin(T * 4.0)) + exp(-pow((r - 0.6) * 10.0, 2.0)) * (0.3 + 0.3 * sin(an * 3.0 + T * 2.0)); c = mix(uC1, uC2, exp(-r * r * 6.0));
  }
  float k = (0.45 + 0.5 * clamp(uHeat, 0.0, 1.5) + uKick * 0.9) * uFade;
  if (a * k < 0.003) discard;
  gl_FragColor = vec4(c * k, clamp(a, 0.0, 1.0));
}`;

// ---------- Aura legendaris: selubung bercahaya bentuk tubuh (bukan titik) ----------
// Mesh tubuh yang sama (kulit & tulang sama) digambar sekali lagi sedikit dikembangkan menurut normal, aditif, hanya
// terang di tepi siluet (fresnel). define SF_AURA: 0 api emas naik · 1 api roh berpusar · 2 medan energi (kisi + pindaian).
// Gaya api: verteks bergelombang naik (lidah api lebih tinggi di bahu & kepala).
export const AURA_VS_PARS = 'uniform float uSfT;\nvarying vec3 vAP;\nvarying vec3 vAN;\nvarying vec3 vAV;\n';
export const AURA_VS_BEGIN = `
  vec3 transformed = vec3(position);
#if SF_AURA < 2
  float sfF1 = 0.5 + 0.5 * sin(position.y * 8.0 - uSfT * 5.0 + position.x * 13.0 + position.z * 11.0);
  float sfF2 = 0.5 + 0.5 * sin(position.y * 19.0 - uSfT * 8.0 + position.x * 23.0 - position.z * 17.0);
  float sfSh = smoothstep(1.2, 1.5, position.y) * (1.0 - smoothstep(1.56, 1.72, position.y)); // lidah api lebih tinggi di bahu, tidak di wajah
  transformed += normal * (0.016 + 0.034 * sfF1 * sfF1 + 0.012 * sfF2) * (1.0 + 1.0 * sfSh);
#else
  transformed += normal * (0.026 + 0.008 * sin(uSfT * 6.0 + position.y * 8.0));
#endif
  vAP = position;
`;
export const AURA_FS = SKIN_COMMON + `
uniform vec3 uAC1, uAC2;
varying vec3 vAP;
varying vec3 vAN;
varying vec3 vAV;
vec4 sfAura() {
  vec3 p = vAP; float T = uSfT, fr = pow(1.0 - abs(dot(normalize(vAN), normalize(vAV))), 3.5), a; vec3 c;
  if (fr < 0.012) discard; // bagian dalam siluet: tanpa kerja noise
  float face = 1.0 - 0.75 * smoothstep(1.52, 1.62, p.y) * step(0.0, p.z); // wajah tetap terlihat
#if SF_AURA == 0
  float n = sfN3(vec3(p.x * 9.0, p.y * 3.2 - T * 2.6, p.z * 9.0)) * 0.65 + sfN3(vec3(p.x * 18.0, p.y * 6.5 - T * 4.2, p.z * 18.0)) * 0.35; // lidah api memanjang naik
  a = fr * smoothstep(0.42, 0.78, n + fr * 0.2) * 1.6 * face;
  c = mix(uAC1, uAC2, smoothstep(0.5, 0.95, n));
#elif SF_AURA == 1
  float an = atan(p.z, p.x);
  float n = sfN3(vec3(an * 1.6 + T * 1.0 + p.y * 2.0, p.y * 3.4 - T * 2.2, 1.7)) * 0.65 + sfN3(vec3(p.x * 16.0, p.y * 6.0 - T * 3.4, p.z * 16.0)) * 0.35;
  a = fr * smoothstep(0.42, 0.78, n + fr * 0.2) * 1.55 * face;
  c = mix(uAC1, uAC2, 0.5 + 0.5 * sin(p.y * 4.0 - T * 2.0 + n * 3.0));
#else
  float an = atan(p.z, p.x);
  vec3 h = sfHex(vec2(an * 0.32, p.y) * 16.0);
  float edge = sfAA(h.z, 0.05), scan = pow(0.5 + 0.5 * sin(p.y * 10.0 - T * 4.5), 10.0) + exp(-pow((p.y - fract(T / 2.2) * 2.0) * 7.0, 2.0));
  a = fr * (0.2 + edge * (0.3 + 1.2 * scan) + scan * 0.5) * face;
  c = mix(uAC1, uAC2, clamp(scan + edge * 0.3, 0.0, 1.0));
#endif
  return vec4(c, clamp(a, 0.0, 1.0));
}
`;
