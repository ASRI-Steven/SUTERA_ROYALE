// Pola skin (GLSL) untuk karakter & senjata. Tanpa tekstur: semua motif dihitung di shader dari posisi ruang diam /
// ruang objek (meter), jadi menempel di permukaan (tidak "berenang"), tajam di jarak berapa pun, dan tanpa unduhan.
// Dipakai map/rig.js (tubuh karakter ber-kulit), game/weapons.js (senjata & lengan orang pertama) dan game/skins.js
// (model senjata dunia + katalog). Berkas ini tidak mengimpor apa pun supaya bisa dipakai dari mana saja.
//
// Karakter: nomor pola (fx) per karakter disimpan di palet baris tekstur tulang (alfa slot "fixed"), jadi kerumunan
// ber-instans tetap satu material. Slot warna: 0 kulit, 1 tangan, 2 atasan, 3 lengan, 4 manset, 5 celana, 6 dalaman, 7 tetap.
// Senjata: nomor skin = define saat kompilasi (satu varian material per skin yang sedang dipakai).

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// '#rrggbb' → 'vec3(r, g, b)' linear
export const L = (hex) => { const n = parseInt(hex.slice(1), 16); return `vec3(${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255).toFixed(4)).join(', ')})`; };

// ---------- Fungsi bersama ----------
export const SKIN_COMMON = `
float sfH3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.11, 0.23, 0.37)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sfN3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sfH3(i), sfH3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sfH3(i + vec3(0.0, 1.0, 0.0)), sfH3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(sfH3(i + vec3(0.0, 0.0, 1.0)), sfH3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sfH3(i + vec3(0.0, 1.0, 1.0)), sfH3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float sfH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 sfH22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// proyeksi 2D menurut arah permukaan: depan/belakang → (x, y), samping → (z, y), atas/bawah → (x, z)
vec2 sfProj(vec3 p, vec3 n) { vec3 a = abs(n); return a.y > max(a.x, a.z) ? p.xz : (a.x > a.z ? p.zy : p.xy); }
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
// batik parang: pita diagonal berisi "lidah" bergelombang + deret belah ketupat di garis pemisah. P = lebar pita (m)
vec3 sfParang(vec2 uv, float P, vec3 cA, vec3 cB, vec3 cC) {
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
  return mix(c, cA, dia * sep);
}
// sisik bertumpuk (genting): x = jarak dari pusat sisik 0..1 (1 = tepi), y = id acak, z = posisi mendatar di dalam sisik (−1..1)
vec3 sfScale(vec2 p) {
  const float H = 0.5, R = 0.64;
  float j0 = floor(p.y / H);
  for (int k = 2; k >= -1; k--) { // baris teratas menang (menutupi baris di bawahnya)
    float j = j0 + float(k), par = 0.5 * mod(j, 2.0);
    float cx = floor(p.x - par) + 0.5 + par;
    vec2 d = p - vec2(cx, j * H);
    float r = length(d);
    if (r < R && d.y < 0.12) return vec3(r / R, sfH2(vec2(cx, j)), d.x / R);
  }
  return vec3(1.0, 0.0, 0.0);
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
// retakan es (Voronoi): x = jarak ke tepi sel, y = id sel
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
`;

// ---------- Karakter ----------
// nomor pola (fx): 0 polos · 1 kabut kota · 2 rimba · 3 merah putih · 4 samudra · 5 batik parang · 6 neon kota · 7 garuda emas · 8 operator malam
export const CHAR_FX = { none: 0, kabut: 1, rimba: 2, merahputih: 3, samudra: 4, batik: 5, neon: 6, garuda: 7, malam: 8 };
// p, n = posisi & normal pose diam (m; kaki di y = 0, menghadap +Z, kiri = +X). K = faktor palet (1 / netral atlas).
// tint (masuk) = warna slot dari palet; keluar = warna akhir (× K). metal 0..1, rough < 0 = biarkan, emis = pendar (HDR).
export const CHAR_SKIN_GLSL = SKIN_COMMON + `
void sfChar(int fx, int slot, vec3 p, vec3 n, float K, inout vec3 tint, inout float metal, inout float rough, inout vec3 emis) {
  bool top = slot == 2, slv = slot == 3, pnt = slot == 5;
  if (!(top || slv || pnt || slot == 4)) return;
  float outer = step(0.45, n.x * sign(p.x)); // sisi luar lengan / kaki
  if (fx == 1) { // kabut kota: loreng digital abu-abu
    if (top || slv || pnt) { vec3 q = floor(p / 0.024) * 0.024; tint = K * sfCamo4(q, 11.0, ${L('#8a8e93')}, ${L('#5d6167')}, ${L('#34373c')}, ${L('#c4c7cb')}); }
  } else if (fx == 2) { // rimba: loreng hutan
    if (top || slv || pnt) tint = K * sfCamo4(p, 13.0, ${L('#4d5c2d')}, ${L('#2c371c')}, ${L('#74703f')}, ${L('#3b2d1c')});
  } else if (fx == 3) { // merah putih: dada merah, badan bawah putih, garis merah di sisi celana
    if (top) tint = K * mix(${L('#f2f0ea')}, ${L('#c1121f')}, smoothstep(1.262, 1.272, p.y));
    if (pnt) tint = K * mix(${L('#f2f0ea')}, ${L('#c1121f')}, outer * (1.0 - smoothstep(0.017, 0.021, abs(p.z))));
  } else if (fx == 4) { // samudra: gradasi biru laut → toska + garis ombak putih
    if (top || slv || pnt) {
      vec2 q = sfProj(p, n);
      vec3 base = mix(${L('#0a2452')}, ${L('#1c8f8c')}, smoothstep(0.15, 1.5, p.y));
      float wv = fract(p.y * 7.0 + 0.3 * sin(q.x * 34.0));
      float crest = 1.0 - smoothstep(0.035, 0.07, abs(wv - 0.5));
      tint = K * mix(base, ${L('#eaf6f6')}, crest * 0.9);
    }
  } else if (fx == 5) { // batik parang (jaket); celana tetap polos
    if (top || slv) tint = K * sfParang(sfProj(p, n), 0.085, ${L('#e6d3a3')}, ${L('#6b3e1e')}, ${L('#1f1a1c')});
  } else if (fx == 6) { // neon kota: garis berpendar
    float ln = 0.0;
    if (slv || pnt) ln = outer * (1.0 - smoothstep(0.005, 0.011, abs(p.z)));
    if (top) { float cv = p.y + abs(p.x) * 0.85; ln = step(0.3, n.z) * max(1.0 - smoothstep(0.004, 0.009, abs(cv - 1.385)), 1.0 - smoothstep(0.004, 0.009, abs(cv - 1.44))); }
    if (slv) ln = max(ln, 1.0 - smoothstep(0.005, 0.01, abs(p.y - 1.05)));
    if (pnt) ln = max(ln, max(1.0 - smoothstep(0.005, 0.01, abs(p.y - 0.53)), 1.0 - smoothstep(0.005, 0.01, abs(p.y - 0.17))));
    if (slot == 4) ln = 1.0;
    vec3 lc = pnt ? ${L('#ff2bd6')} : ${L('#22e6ff')};
    tint = mix(tint, K * lc, ln);
    emis = lc * ln * 2.6;
  } else if (fx == 7) { // garuda emas: bulu emas di bahu & dada atas, garis emas di celana
    float m = 0.0;
    if (top || slv) {
      vec3 sc = sfScale(sfProj(p, n) * vec2(17.0, -17.0));
      float feather = max(smoothstep(0.78, 0.96, sc.x), (1.0 - smoothstep(0.03, 0.09, abs(sc.z))) * step(sc.x, 0.9));
      m = feather * smoothstep(1.27, 1.4, p.y);
      if (slv) m = max(m, 1.0 - smoothstep(0.012, 0.016, abs(p.y - 1.075)));
      if (top) m = max(m, 1.0 - smoothstep(0.012, 0.016, abs(p.y - 1.02)));
    }
    if (pnt) m = max(outer * (1.0 - smoothstep(0.013, 0.017, abs(p.z))), 1.0 - smoothstep(0.016, 0.02, abs(p.y - 0.975)));
    if (slot == 4) m = 1.0;
    tint = mix(tint, K * ${L('#e2a93b')}, m);
    metal = 0.7 * m;
    rough = mix(-1.0, 0.32, step(0.5, m));
  } else if (fx == 8) { // operator malam: panel taktis lebih terang + garis emas tipis
    float panel = 0.0, gold = 0.0;
    if (top) { panel = step(1.405, p.y); gold = 1.0 - smoothstep(0.002, 0.005, abs(p.y - 1.402)); }
    if (slv) panel = step(p.y, 1.19);
    if (pnt) { panel = step(0.2, n.z) * step(0.43, p.y) * step(p.y, 0.6); gold = outer * (1.0 - smoothstep(0.003, 0.006, abs(p.z))); }
    tint = mix(tint, K * ${L('#2d3036')}, panel * (1.0 - gold));
    tint = mix(tint, K * ${L('#d29f52')}, gold);
    metal = 0.6 * gold;
  }
}
`;
// lengan orang pertama (kain): versi ringkas pola karakter untuk material lengan (posisi ruang objek lengan)
export const CHAR_SLEEVE_GLSL = `
vec3 sfSleeve(int fx, vec3 p, vec3 n, vec3 base) {
  if (fx == 1) { vec3 q = floor(p / 0.024) * 0.024; return sfCamo4(q, 11.0, ${L('#8a8e93')}, ${L('#5d6167')}, ${L('#34373c')}, ${L('#c4c7cb')}); }
  if (fx == 2) return sfCamo4(p, 13.0, ${L('#4d5c2d')}, ${L('#2c371c')}, ${L('#74703f')}, ${L('#3b2d1c')});
  if (fx == 4) { vec2 q = sfProj(p, n); float wv = fract((p.z + p.y) * 7.0 + 0.3 * sin(q.x * 34.0)); return mix(${L('#14607a')}, ${L('#eaf6f6')}, (1.0 - smoothstep(0.035, 0.07, abs(wv - 0.5))) * 0.9); }
  if (fx == 5) return sfParang(sfProj(p, n), 0.085, ${L('#e6d3a3')}, ${L('#6b3e1e')}, ${L('#1f1a1c')});
  return base;
}
`;

// ---------- Senjata ----------
// nomor skin senjata (define SF_GUN): 1 karbon · 2 rimba · 3 senja · 4 naga · 5 mega mendung · 6 kristal es · 7 neon ungu · 8 emas garuda
export const GUN_FX = { none: 0, karbon: 1, rimba: 2, senja: 3, naga: 4, mendung: 5, es: 6, neon: 7, garuda: 8 };
// cls = kelas bahan: 1 logam · 2 polimer · 3 karet/gagang · 5 kayu · 9 aksen (bidikan emas dsb.)
// p, n = posisi & normal ruang objek senjata (m; laras sepanjang Z). col masuk = warna asli. vdn = N·V (untuk es).
export const GUN_SKIN_GLSL = SKIN_COMMON + `
void sfGun(int cls, vec3 p, vec3 n, float vdn, inout vec3 col, inout float metal, inout float rough, inout vec3 emis) {
  vec2 uv = sfProj(p, n);
  bool hard = cls == 1 || cls == 2 || cls == 5;
#if SF_GUN == 1 // karbon hitam
  if (hard) { float w = sfCarbon(uv * 260.0); col = mix(${L('#08090b')}, ${L('#3a3e45')}, w * w); metal = cls == 1 ? 0.55 : 0.25; rough = mix(0.42, 0.2, w); }
  else if (cls == 3) { col = ${L('#0c0d10')}; rough = 0.9; }
  else if (cls == 9) { col = ${L('#8d939c')}; metal = 0.9; rough = 0.3; }
#elif SF_GUN == 2 // kamuflase rimba
  if (hard || cls == 3) { col = sfCamo4(p, 30.0, ${L('#47562a')}, ${L('#262f18')}, ${L('#7a7442')}, ${L('#3a2c1b')}); metal = cls == 1 ? 0.15 : 0.0; rough = 0.78; }
  else if (cls == 9) { col = ${L('#2a2c22')}; metal = 0.4; rough = 0.6; }
#elif SF_GUN == 3 // senja: gradasi jingga → magenta → ungu sepanjang laras
  if (hard) { float t = clamp((0.3 - p.z) / 0.9, 0.0, 1.0), g = 0.9 + 0.2 * sfN3(p * vec3(60.0, 60.0, 900.0));
    col = (t < 0.5 ? mix(${L('#ff8a1f')}, ${L('#e0257a')}, t * 2.0) : mix(${L('#e0257a')}, ${L('#3b1a8a')}, t * 2.0 - 1.0)) * g; metal = cls == 1 ? 0.85 : 0.35; rough = cls == 1 ? 0.3 : 0.42; }
  else if (cls == 3) { col = ${L('#1b1226')}; rough = 0.85; }
  else if (cls == 9) { col = ${L('#ffc24d')}; metal = 1.0; rough = 0.28; }
#elif SF_GUN == 4 // merah naga: sisik merah bertepi gelap, kilau emas di ujung sisik
  if (hard) { vec3 sc = sfScale(uv * vec2(44.0, 44.0));
    vec3 body = mix(${L('#c41a1a')}, ${L('#7a0c10')}, sc.y);
    body = mix(body, ${L('#2a0606')}, smoothstep(0.8, 0.98, sc.x));
    float rim = smoothstep(0.66, 0.72, sc.x) * (1.0 - smoothstep(0.76, 0.82, sc.x));
    col = mix(body, ${L('#e9b44c')}, rim * 0.6); metal = cls == 1 ? 0.65 : 0.3; rough = mix(0.3, 0.5, smoothstep(0.7, 0.98, sc.x)); }
  else if (cls == 3) { col = ${L('#170808')}; rough = 0.85; }
  else if (cls == 9) { col = ${L('#e9b44c')}; metal = 1.0; rough = 0.3; }
#elif SF_GUN == 5 // batik mega mendung: awan biru berlapis di atas biru tua
  if (hard) { float d = sfCloud(uv * 17.0);
    float k = clamp(-d / 0.2, 0.0, 1.0), fk = fract(k * 5.0), band = floor(k * 5.0) / 5.0;
    vec3 cloud = mix(${L('#d9ecff')}, ${L('#1c4fb0')}, band);
    float line = 1.0 - smoothstep(0.03, 0.09, fk); // garis putih di tiap pergantian lapis
    col = d < 0.0 ? mix(cloud, ${L('#f4f7ff')}, line * 0.75) : ${L('#0b1740')};
    col = mix(col, ${L('#f4f7ff')}, 1.0 - smoothstep(0.0, 0.012, abs(d))); // garis tepi awan
    metal = cls == 1 ? 0.2 : 0.0; rough = 0.46; }
  else if (cls == 3) { col = ${L('#0a1230')}; rough = 0.85; }
  else if (cls == 9) { col = ${L('#f1ead2')}; metal = 0.3; rough = 0.45; }
#elif SF_GUN == 6 // kristal es: faset biru es, retakan putih, tepi berpendar
  if (hard || cls == 3) { vec2 v = sfVor(uv * 38.0);
    float crack = 1.0 - smoothstep(0.0, 0.055, v.x), fres = pow(1.0 - clamp(vdn, 0.0, 1.0), 3.0);
    col = mix(mix(${L('#5fb6e8')}, ${L('#bfe9ff')}, v.y), ${L('#f2fbff')}, crack * 0.85);
    col = mix(col, ${L('#e8f8ff')}, fres * 0.6);
    metal = 0.1; rough = mix(0.1, 0.28, crack);
    emis = ${L('#7fd4ff')} * (0.25 * fres + 0.08 * crack); }
  else if (cls == 9) { col = ${L('#eaf6ff')}; metal = 0.9; rough = 0.15; }
#elif SF_GUN == 7 // neon ungu: badan gelap, garis segi enam berpendar
  if (hard) { vec3 h = sfHex(uv * 46.0);
    float ln = 1.0 - smoothstep(0.012, 0.04, h.z), lit = step(0.74, sfH2(h.xy)), fill = lit * smoothstep(0.1, 0.4, h.z) * 0.35;
    col = mix(${L('#0d0b14')}, ${L('#b24dff')}, ln * 0.9 + fill * 0.5);
    emis = ${L('#b24dff')} * (ln * 2.0 + fill * 1.4) + ${L('#ff3bd0')} * fill * lit * 0.6;
    metal = cls == 1 ? 0.6 : 0.2; rough = 0.34; }
  else if (cls == 3) { col = ${L('#0a0910')}; rough = 0.85; }
  else if (cls == 9) { col = ${L('#22e6ff')}; emis = ${L('#22e6ff')} * 2.0; rough = 0.4; }
#elif SF_GUN == 8 // emas garuda: emas berukir bulu; polimer = pernis merah tua
  if (cls == 1) { vec3 sc = sfScale(uv * vec2(34.0, -34.0));
    float groove = max(smoothstep(0.8, 0.97, sc.x), (1.0 - smoothstep(0.02, 0.07, abs(sc.z))) * step(sc.x, 0.9));
    groove = max(groove, (1.0 - smoothstep(0.03, 0.08, abs(fract((sc.x * 0.9 - abs(sc.z) * 0.7) * 5.0) - 0.5))) * 0.55 * step(sc.x, 0.86));
    col = mix(${L('#f0b63c')}, ${L('#7a4a12')}, groove); metal = 1.0; rough = mix(0.2, 0.5, groove); }
  else if (cls == 2 || cls == 5) { float g = sfN3(p * vec3(70.0, 70.0, 6.0)); col = mix(${L('#3a100b')}, ${L('#5a1a10')}, g); rough = 0.3; }
  else if (cls == 3) { col = ${L('#1a0c08')}; rough = 0.8; }
  else if (cls == 9) { col = ${L('#ffd15a')}; metal = 1.0; rough = 0.18; }
#endif
}
`;
