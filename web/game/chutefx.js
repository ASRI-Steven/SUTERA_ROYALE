// Kanopi parasut: bentuk saat mengembang & kempis, dipakai pemain (player.js, mesh tunggal) dan bot (bots.js, instans).
// Fungsi murni dari waktu (tanpa state): skala terhadap titik asal model (harness di bahu), jadi tali tetap bertemu di bahu.
//   < 0,10 dtk   tersembunyi (pilot chute baru ditarik)
//   0,10–0,45    tali terulur: kanopi masih kuncup & tertinggal ke belakang (miring sesuai arah jatuh)
//   0,45–0,95    mengembang: lebar mengikuti respons langkah teredam (2,3 Hz, ζ 0,38, dibatasi 1,12) → melebar lalu memantul
// Kempis (mendarat): tinggi 1 → 0,25, lebar → 0,7, terlipat ke depan, lalu sembunyi.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const W = 2 * Math.PI * 2.3, Z = 0.38, WD = W * Math.sqrt(1 - Z * Z), ZK = Z / Math.sqrt(1 - Z * Z);

// o = { vis, sx (bentang), sy (tinggi), sz (chord), rx (miring depan/belakang, rad) }; hs/vs = laju datar/turun (m/dtk)
export function chuteShape(ct, hs, vs, o) {
  if (ct < 0.10) { o.vis = false; return o; }
  o.vis = true;
  const back = -Math.atan2(hs, Math.max(1, vs)); // kanopi kuncup tertinggal di belakang arah jatuh
  if (ct < 0.45) {
    const u = (ct - 0.10) / 0.35, e = 1 - (1 - u) * (1 - u);
    o.sx = 0.06 + 0.10 * u; o.sz = 0.15 + 0.15 * u; o.sy = 0.35 + 0.77 * e; o.rx = back;
    return o;
  }
  const tau = ct - 0.45;
  let R = tau > 3 ? 1 : 1 - Math.exp(-Z * W * tau) * (Math.cos(WD * tau) + ZK * Math.sin(WD * tau));
  if (R > 1.12) R = 1.12;
  const infl = clamp(R, 0, 1), luff = tau < 0.8 ? 0.05 * (1 - infl) * Math.sin(tau * 38) : 0; // sel bergetar selagi mengisi
  o.sx = 0.16 + 0.84 * R; o.sz = (0.3 + 0.7 * sstep(0, 0.3, tau)) * (1 + luff); o.sy = 1.12 - 0.12 * R; o.rx = back * (1 - infl);
  return o;
}

// kempis setelah mendarat: lt = dtk sejak menyentuh tanah. Mengembalikan false bila sudah selesai (sembunyikan).
export const COLLAPSE_T = 0.6;
export function chuteCollapse(lt, o) {
  if (lt >= COLLAPSE_T) { o.vis = false; return false; }
  const u = sstep(0, COLLAPSE_T, lt);
  o.vis = true; o.sx = 1 - 0.3 * u; o.sy = 1 - 0.75 * u; o.sz = 1; o.rx = 1.1 * u;
  return true;
}
