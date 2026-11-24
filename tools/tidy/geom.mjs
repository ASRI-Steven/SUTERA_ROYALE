// Geometri bersama perapi tata letak (tools/tidy_layout.mjs). Semua dalam meter; titik = [x, y]; poligon = [[x, y], …].
export const M = 0.1;
export const UMUM = new Set(['motorway', 'motorway_link', 'trunk', 'primary', 'secondary', 'tertiary']);
export const LOKAL = new Set(['unclassified', 'residential', 'living_street']);
export const SERVIS = new Set(['service', 'pedestrian']);
// lebar trotoar per sisi (m) — sama dengan SIDEWALK di web/map/world.js
export const SIDEWALK = { trunk: 2.4, primary: 2.6, secondary: 2.4, tertiary: 2.0, unclassified: 1.4, residential: 1.4, living_street: 1.0 };

export const toPts = (flat) => { const p = []; for (let i = 0; i + 1 < flat.length; i += 2) p.push([flat[i] * M, flat[i + 1] * M]); return p; };
export const toFlat = (pts) => { const f = []; for (const [x, y] of pts) f.push(Math.round(x / M), Math.round(y / M)); return f; };
export function area(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
export function centroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const c = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += c; cx += (p[j][0] + p[i][0]) * c; cy += (p[j][1] + p[i][1]) * c; }
  if (Math.abs(a) < 1e-9) { let sx = 0, sy = 0; for (const q of p) { sx += q[0]; sy += q[1]; } return [sx / p.length, sy / p.length]; }
  return [cx / (3 * a), cy / (3 * a)];
}
export function pip(x, y, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
  return ins;
}
export function bbox(p) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; }
// jarak titik ke ruas; out = [qx, qy, t]
export function ptSeg(x, y, ax, ay, bx, by, out) {
  const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0, qx = ax + ex * t, qy = ay + ey * t;
  if (out) { out[0] = qx; out[1] = qy; out[2] = t; }
  return Math.hypot(x - qx, y - qy);
}
export function segX(ax, ay, bx, by, cx, cy, dx, dy) { // ruas AB memotong CD? → parameter t di AB atau −1
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}
// jarak ruas–ruas + pasangan titik terdekat: out = { d, px, py (di AB), qx, qy (di CD) }
const _o = [0, 0, 0];
export function segSeg(ax, ay, bx, by, cx, cy, dx, dy, out) {
  const t = segX(ax, ay, bx, by, cx, cy, dx, dy);
  if (t >= 0) { out.d = 0; out.px = out.qx = ax + (bx - ax) * t; out.py = out.qy = ay + (by - ay) * t; return 0; }
  let best = Infinity;
  const tryP = (x, y, sx, sy, ex, ey, onAB) => { const d = ptSeg(x, y, sx, sy, ex, ey, _o); if (d < best) { best = d; if (onAB) { out.px = x; out.py = y; out.qx = _o[0]; out.qy = _o[1]; } else { out.qx = x; out.qy = y; out.px = _o[0]; out.py = _o[1]; } } };
  tryP(ax, ay, cx, cy, dx, dy, true); tryP(bx, by, cx, cy, dx, dy, true); tryP(cx, cy, ax, ay, bx, by, false); tryP(dx, dy, ax, ay, bx, by, false);
  out.d = best;
  return best;
}
// jarak titik ke tepi poligon
export function ptPoly(x, y, p) { let b = Infinity; for (let i = 0, j = p.length - 1; i < p.length; j = i++) b = Math.min(b, ptSeg(x, y, p[j][0], p[j][1], p[i][0], p[i][1])); return b; }
// jarak poligon ke garis patah (0 bila berpotongan / garis di dalam poligon); out: titik terdekat p (poligon), q (garis), seg = indeks ruas garis
export function polyLine(poly, line, out) {
  const o = { d: 0, px: 0, py: 0, qx: 0, qy: 0 };
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const [cx, cy] = line[k], [dx, dy] = line[k + 1];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = segSeg(poly[j][0], poly[j][1], poly[i][0], poly[i][1], cx, cy, dx, dy, o);
      if (d < best) { best = d; if (out) { out.px = o.px; out.py = o.py; out.qx = o.qx; out.qy = o.qy; out.seg = k; } if (d === 0) { if (out) out.d = 0; return 0; } }
    }
  }
  if (best > 0) for (let k = 0; k < line.length; k++) if (pip(line[k][0], line[k][1], poly)) { best = 0; if (out) { out.px = out.qx = line[k][0]; out.py = out.qy = line[k][1]; out.seg = Math.min(k, line.length - 2); } break; }
  if (out) out.d = best;
  return best;
}
export function polyPoly(a, b) { // jarak dua poligon (0 bila berpotongan/bersarang)
  const o = { d: 0 };
  let best = Infinity;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) for (let k = 0, l = b.length - 1; k < b.length; l = k++) { const d = segSeg(a[j][0], a[j][1], a[i][0], a[i][1], b[l][0], b[l][1], b[k][0], b[k][1], o); if (d < best) best = d; if (d === 0) return 0; }
  if (pip(a[0][0], a[0][1], b) || pip(b[0][0], b[0][1], a)) return 0;
  return best;
}
// potong poligon dengan setengah bidang { p : (p − o)·n ≥ 0 } (Sutherland–Hodgman)
export function clipHalf(p, ox, oy, nx, ny) {
  const out = [], s = (q) => (q[0] - ox) * nx + (q[1] - oy) * ny;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j], b = p[i], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  const r = []; // buang titik kembar
  for (const q of out) if (!r.length || Math.hypot(q[0] - r[r.length - 1][0], q[1] - r[r.length - 1][1]) > 0.02) r.push(q);
  if (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) <= 0.02) r.pop();
  return r;
}
// lebar terkecil poligon (sisi pendek kotak pembatas terputar minimum, dicoba per arah sisi)
export function minWidth(p) {
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ex = p[i][0] - p[j][0], ey = p[i][1] - p[j][1], L = Math.hypot(ex, ey);
    if (L < 0.05) continue;
    const ux = ex / L, uy = ey / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of p) { const a = q[0] * ux + q[1] * uy, b = -q[0] * uy + q[1] * ux; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
    best = Math.min(best, Math.min(a1 - a0, b1 - b0));
  }
  return best;
}
export function isRect(p) { // empat sudut ±90° (toleransi 6°)
  if (p.length !== 4) return false;
  for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4], ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1], l = Math.hypot(ux, uy) * Math.hypot(vx, vy); if (l < 1e-6 || Math.abs(ux * vx + uy * vy) / l > 0.105) return false; }
  return true;
}
// kisi spasial sederhana: add(item, x0, y0, x1, y1), query(x0, y0, x1, y1) → Set item
export class Grid {
  constructor(cell) { this.c = cell; this.m = new Map(); }
  add(it, x0, y0, x1, y1) { const c = this.c; for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) { const k = cx * 100003 + cy; let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(it); } }
  query(x0, y0, x1, y1) { const c = this.c, s = new Set(); for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) { const a = this.m.get(cx * 100003 + cy); if (a) for (const it of a) s.add(it); } return s; }
}
export const quant = (p) => p.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]); // ke kisi dm (seperti data)
