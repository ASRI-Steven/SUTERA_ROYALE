// Daftar pohon bersih — dipakai render pohon (world.js) DAN collider (collide.js), jadi keduanya selalu sama:
// - pohon di badan jalan atau ≤ 1,2 m dari tepi aspal dipindah ke trotoar (lebar/2 + 1,5 m dari as jalan, sisi yang sama)
//   kalau tempat itu lapang; kalau tidak, dibuang;
// - pohon di dalam gedung, kolam/danau, atau sungai dibuang; pohon yang bertumpuk (< 1,6 m) disisakan satu.
// Juga menyiapkan D.shrubs = [x, y, skala, …] (m): semak pucuk merah hiasan (tanpa tabrakan, seperti semak di PUBG)
// di antara palem boulevard dan di sekitar pohon taman. D.treeRoom = ruang bebas tiap pohon ke gedung terdekat (m, maks 12).
// Data asli D.trees (dm) diganti di tempat; aman dipanggil berulang.
const M = 0.1;
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
function pipFlat(x, y, r) { // titik (dm) di dalam cincin datar r (dm)?
  let ins = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function edgeDist(x, y, r) { // jarak titik (m) ke tepi cincin r (dm), dalam m
  let best = Infinity;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j] * M, ay = r[j + 1] * M, ex = r[i] * M - ax, ey = r[i + 1] * M - ay, L = ex * ex + ey * ey;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return best;
}

export function cleanTrees(D) {
  if (D.meta.treesClean) return D.meta.treesClean;
  const st = D.meta.treeStride || 3, T = D.trees, n = Math.floor(T.length / st);
  // ---- ruas jalan & sungai per sel 30 m
  const RC = 30, key = (cx, cy) => cx * 100003 + cy;
  const segs = [], RG = new Map();
  const addSeg = (ax, ay, bx, by, w, water) => {
    const k = segs.push([ax, ay, bx, by, w, water]) - 1, pad = w / 2 + 5;
    for (let cx = Math.floor((Math.min(ax, bx) - pad) / RC); cx <= Math.floor((Math.max(ax, bx) + pad) / RC); cx++)
      for (let cy = Math.floor((Math.min(ay, by) - pad) / RC); cy <= Math.floor((Math.max(ay, by) + pad) / RC); cy++) {
        const kk = key(cx, cy);
        (RG.get(kk) || RG.set(kk, []).get(kk)).push(k);
      }
  };
  D.roads.r.forEach((r, i) => { const w = D.roads.w[i] * M; for (let j = 0; j + 3 < r.length; j += 2) addSeg(r[j] * M, r[j + 1] * M, r[j + 2] * M, r[j + 3] * M, w, false); });
  (D.waterways.r || []).forEach((r, i) => { const w = (D.waterways.w[i] || 60) * M; for (let j = 0; j + 3 < r.length; j += 2) addSeg(r[j] * M, r[j + 1] * M, r[j + 2] * M, r[j + 3] * M, w, true); });
  // jarak bebas ke tepi aspal (negatif = di atas aspal); sungai dihitung terpisah
  function road(x, y) {
    let m = Infinity, wet = Infinity, best = null;
    for (const k of RG.get(key(Math.floor(x / RC), Math.floor(y / RC))) || []) {
      const [ax, ay, bx, by, w, water] = segs[k], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0, fx = ax + ex * t, fy = ay + ey * t;
      const d = Math.hypot(x - fx, y - fy) - w / 2;
      if (water) { wet = Math.min(wet, d); continue; }
      if (d < m) { m = d; best = { fx, fy, ex, ey, w, L: Math.sqrt(L2) }; }
    }
    return { m, wet, s: best };
  }
  // ---- gedung & air (poligon) per sel 50 m
  const BC = 50, BG = new Map(), polys = [];
  const addPoly = (r, kind) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < r.length; i += 2) { x0 = Math.min(x0, r[i] * M); x1 = Math.max(x1, r[i] * M); y0 = Math.min(y0, r[i + 1] * M); y1 = Math.max(y1, r[i + 1] * M); }
    const k = polys.push({ r, kind, x0, y0, x1, y1 }) - 1;
    for (let cx = Math.floor(x0 / BC); cx <= Math.floor(x1 / BC); cx++) for (let cy = Math.floor(y0 / BC); cy <= Math.floor(y1 / BC); cy++) { const kk = key(cx, cy); (BG.get(kk) || BG.set(kk, []).get(kk)).push(k); }
  };
  D.buildings.r.forEach((r, i) => { if (D.buildings.k[i] !== 5) addPoly(r, 'building'); }); // 5 = kanopi: pohon boleh di dekatnya
  D.water.forEach((r) => addPoly(r, 'water'));
  function blockedBy(x, y, margin) {
    for (const pi of BG.get(key(Math.floor(x / BC), Math.floor(y / BC))) || []) {
      const P = polys[pi];
      if (x < P.x0 - margin || x > P.x1 + margin || y < P.y0 - margin || y > P.y1 + margin) continue;
      if (pipFlat(x / M, y / M, P.r) || edgeDist(x, y, P.r) < margin) return P.kind;
    }
    return null;
  }
  // ---- jarak antar pohon
  const TC = 4, TG = new Map();
  const near = (G, x, y, r) => { for (let cx = Math.floor((x - r) / TC); cx <= Math.floor((x + r) / TC); cx++) for (let cy = Math.floor((y - r) / TC); cy <= Math.floor((y + r) / TC); cy++) for (const p of G.get(key(cx, cy)) || []) if (Math.hypot(p[0] - x, p[1] - y) < r) return true; return false; };
  const put = (G, x, y) => { const kk = key(Math.floor(x / TC), Math.floor(y / TC)); (G.get(kk) || G.set(kk, []).get(kk)).push([x, y]); };
  const stats = { before: n, after: 0, moved: 0, road: 0, building: 0, water: 0, close: 0, shrubs: 0 };
  const out = [], kept = [];
  for (let i = 0; i < n; i++) {
    let x = T[i * st] * M, y = T[i * st + 1] * M;
    const R = road(x, y);
    if (R.m < 1.2 && R.s) { // di jalan / terlalu mepet → ke trotoar sisi yang sama
      const S = R.s;
      let nx = x - S.fx, ny = y - S.fy, l = Math.hypot(nx, ny);
      if (l < 0.05) { nx = -S.ey / (S.L || 1); ny = S.ex / (S.L || 1); if (hash(x, y) < 0.5) { nx = -nx; ny = -ny; } } else { nx /= l; ny /= l; }
      const x2 = S.fx + nx * (S.w / 2 + 1.5), y2 = S.fy + ny * (S.w / 2 + 1.5), R2 = road(x2, y2);
      if (R2.m < 1.15 || R2.wet < 0.8) { stats.road++; continue; }
      x = x2; y = y2; stats.moved++;
    } else if (R.wet < 0.8) { stats.water++; continue; }
    const b = blockedBy(x, y, 0.6);
    if (b) { stats[b]++; continue; }
    if (near(TG, x, y, 1.6)) { stats.close++; continue; }
    put(TG, x, y);
    const k = T[i * st + 2], sp = st > 3 ? T[i * st + 3] : 0;
    out.push(Math.round(x / M), Math.round(y / M), k, sp);
    kept.push([x, y, k, sp, R.m]);
  }
  D.trees = out;
  D.meta.treeStride = 4;
  stats.after = kept.length;
  // ruang bebas tiap pohon (m ke tepi gedung terdekat, maks 12): tajuk lebar dibatasi supaya tidak menembus rumah
  const room = new Float32Array(kept.length);
  kept.forEach(([x, y], i) => {
    let best = 12;
    for (let cx = Math.floor((x - 12) / BC); cx <= Math.floor((x + 12) / BC); cx++) for (let cy = Math.floor((y - 12) / BC); cy <= Math.floor((y + 12) / BC); cy++)
      for (const pi of BG.get(key(cx, cy)) || []) {
        const P = polys[pi];
        if (P.kind !== 'building' || x < P.x0 - best || x > P.x1 + best || y < P.y0 - best || y > P.y1 + best) continue;
        best = Math.min(best, edgeDist(x, y, P.r));
      }
    room[i] = best;
  });
  D.treeRoom = room;
  // ---- semak hiasan: deret di antara palem (median/boulevard) & gerombol di taman
  const greens = (D.green.r || []).filter((r, i) => ['park', 'grass', 'cemetery'].includes(D.greenTypes[D.green.t[i]]));
  const inGreen = (x, y) => greens.some((r) => pipFlat(x / M, y / M, r));
  const SG = new Map(), shrubs = [];
  const okShrub = (x, y) => { const R = road(x, y); return R.m > 0.9 && R.wet > 0.6 && !blockedBy(x, y, 0.5) && !near(TG, x, y, 1.0) && !near(SG, x, y, 0.95); };
  const addShrub = (x, y, s) => { if (!okShrub(x, y)) return; put(SG, x, y); shrubs.push(+x.toFixed(2), +y.toFixed(2), +s.toFixed(2)); };
  for (const [x, y, , sp, m] of kept) {
    const h = hash(x * 1.3, y * 0.7);
    if (sp === 1 && m < 8) { // palem dekat jalan: semak di kiri-kanan searah jalan
      const R = road(x, y), S = R.s;
      if (!S) continue;
      const ux = S.ex / (S.L || 1), uy = S.ey / (S.L || 1);
      for (const d of [-1.7, 1.7, -3.2, 3.2]) addShrub(x + ux * d, y + uy * d, 0.85 + 0.3 * hash(x + d, y));
    } else if (sp === 0 && m > 4 && h < 0.4 && inGreen(x, y)) { // taman: 1–3 semak di sekitar pohon
      const c = 1 + Math.floor(hash(y, x) * 3);
      for (let j = 0; j < c; j++) { const a = hash(x + j, y - j) * 6.283, r = 1.8 + 1.4 * hash(j, x); addShrub(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.8 + 0.5 * hash(y + j, x)); }
    }
  }
  D.shrubs = shrubs;
  stats.shrubs = shrubs.length / 3;
  D.meta.treesClean = stats;
  return stats;
}
