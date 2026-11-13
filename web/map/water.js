// Kedalaman air (danau, sungai besar, kanal) — dipakai bersama oleh world.js (dasar danau, transparansi permukaan)
// dan collide.js / player.js (berenang, menyelam, mengarungi). Koordinat data: x timur, y utara (m).
// Profil: 0 di tepi, landai lalu makin dalam ke tengah sampai ±8 m (danau besar & Cisadane); kolam kecil otomatis
// lebih dangkal. Kanal (garis + lebar) dangkal (≤ 1 m: hanya bisa diarungi).
const M = 0.1;
export const WATER = { maxD: 8, shelf: 9, canalMax: 1.0, surface: 0.08 };
const h21 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// jarak ke tepi (m) → kedalaman (m)
export function profile(dist, x, y) {
  return WATER.maxD * (1 - Math.exp(-dist / WATER.shelf)) * (0.86 + 0.28 * vnoise(x / 37, y / 37));
}
function segDist(px, py, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L)) : 0;
  return Math.hypot(px - ax - ex * t, py - ay - ey * t);
}
// fungsi depth(x, y) (0 = bukan air) + data poligon (meter) untuk membangun mesh; disimpan di D supaya dihitung sekali
export function makeWaterDepth(D) {
  if (D.waterDepth) return D.waterDepth;
  const polys = D.water.map((r) => {
    const n = r.length >> 1, pts = new Float64Array(n * 2);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < n; j++) {
      const x = r[2 * j] * M, y = r[2 * j + 1] * M;
      pts[2 * j] = x; pts[2 * j + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { pts, n, x0, y0, x1, y1 };
  });
  const canals = [];
  D.waterways.r.forEach((r, wi) => {
    const hw = D.waterways.w[wi] * M / 2;
    if (hw < 1.5) return;
    for (let j = 0; j + 3 < r.length; j += 2) canals.push([r[j] * M, r[j + 1] * M, r[j + 2] * M, r[j + 3] * M, hw]);
  });
  const inside = (P, x, y) => {
    let ins = false;
    const a = P.pts;
    for (let i = 0, j = P.n - 1; i < P.n; j = i++) {
      const xi = a[2 * i], yi = a[2 * i + 1], xj = a[2 * j], yj = a[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  };
  const edgeDist = (P, x, y) => {
    let best = Infinity;
    const a = P.pts;
    for (let i = 0, j = P.n - 1; i < P.n; j = i++) best = Math.min(best, segDist(x, y, a[2 * j], a[2 * j + 1], a[2 * i], a[2 * i + 1]));
    return best;
  };
  function depth(x, y) {
    for (const P of polys) {
      if (x < P.x0 || x > P.x1 || y < P.y0 || y > P.y1 || !inside(P, x, y)) continue;
      return profile(edgeDist(P, x, y), x, y);
    }
    for (const [ax, ay, bx, by, hw] of canals) {
      const d = segDist(x, y, ax, ay, bx, by);
      if (d < hw) return Math.min(WATER.canalMax, (hw - d) * 0.5);
    }
    return 0;
  }
  depth.polys = polys;
  depth.inside = inside;
  D.waterDepth = depth;
  return depth;
}
