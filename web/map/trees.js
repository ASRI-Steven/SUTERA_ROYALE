// Daftar pohon bersih — dipakai render pohon (world.js) DAN collider (collide.js), jadi keduanya selalu sama:
// - pohon di badan jalan atau ≤ 1,2 m dari tepi aspal dipindah ke trotoar (lebar/2 + 1,5 m dari as jalan, sisi yang sama)
//   kalau tempat itu lapang; kalau tidak, dibuang;
// - pohon di dalam gedung, kolam/danau, atau sungai dibuang; pohon yang bertumpuk (< 1,6 m) disisakan satu;
// - zona bebas gedung (dihitung dari sisi gedung, bukan letak pintu, jadi tetap benar walau pintu dipindah):
//   Z1 fasad: di depan tiap sisi gedung (jenis ≠ 5, panjang ≥ 1,25 m) selebar sisi ± 0,5 m tidak boleh ada pohon/semak;
//      sisi depan (sinar keluar dari tengah sisi kena aspal jalan non-servis ≤ 12 m) bebas sampai tepi aspal (maks 8 m),
//      sisi lain 4 m. Mencakup pintu, teras, carport, jendela;
//   Z2 dinding: batang ≥ 2,2 m dari dinding mana pun (tajuk lebar 3,0 m; semak 0,8 m); tajuk lebar dengan ruang < 5 m
//      memakai kelas ukuran 0, < 7 m paling besar kelas 1.
//   Pelanggar digeser sepanjang arah jalan terdekat ±1…8 m ke titik yang lolos Z1/Z2, ≥ 1,9 m dari aspal dan ≥ 4 m
//   dari pohon lain; kalau tidak ada, dibuang. Semak yang melanggar tidak ditanam.
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

// Penjaga zona: road(x, y) = jarak ke aspal/sungai, blockedBy = gedung/air, viol(x, y, wallMin, semak) = Z1/Z2 (+ Z5
// gerbang, Z6 tembok keliling bila D.walls ada). Dipakai cleanTrees di game DAN tahap tanam tools/tidy/trees.mjs, jadi
// pohon hasil perapi tidak pernah digeser/dibuang lagi saat muat.
export function treeGuard(D) {
  // ---- ruas jalan & sungai per sel 30 m
  const RC = 30, key = (cx, cy) => cx * 100003 + cy;
  const segs = [], RG = new Map();
  const addSeg = (ax, ay, bx, by, w, water, serv) => {
    const k = segs.push([ax, ay, bx, by, w, water, serv]) - 1, pad = w / 2 + 5;
    for (let cx = Math.floor((Math.min(ax, bx) - pad) / RC); cx <= Math.floor((Math.max(ax, bx) + pad) / RC); cx++)
      for (let cy = Math.floor((Math.min(ay, by) - pad) / RC); cy <= Math.floor((Math.max(ay, by) + pad) / RC); cy++) {
        const kk = key(cx, cy);
        (RG.get(kk) || RG.set(kk, []).get(kk)).push(k);
      }
  };
  const SERV = new Set(['service', 'pedestrian']);
  D.roads.r.forEach((r, i) => { const w = D.roads.w[i] * M, sv = SERV.has(D.classes[D.roads.c[i]]); for (let j = 0; j + 3 < r.length; j += 2) addSeg(r[j] * M, r[j + 1] * M, r[j + 2] * M, r[j + 3] * M, w, false, sv); });
  (D.waterways.r || []).forEach((r, i) => { const w = (D.waterways.w[i] || 60) * M; for (let j = 0; j + 3 < r.length; j += 2) addSeg(r[j] * M, r[j + 1] * M, r[j + 2] * M, r[j + 3] * M, w, true); });
  // jarak bebas ke tepi aspal (negatif = di atas aspal); sungai dihitung terpisah
  function road(x, y) {
    let m = Infinity, wet = Infinity, main = Infinity, best = null;
    for (const k of RG.get(key(Math.floor(x / RC), Math.floor(y / RC))) || []) {
      const [ax, ay, bx, by, w, water, serv] = segs[k], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0, fx = ax + ex * t, fy = ay + ey * t;
      const d = Math.hypot(x - fx, y - fy) - w / 2;
      if (water) { wet = Math.min(wet, d); continue; }
      if (!serv) main = Math.min(main, d);
      if (d < m) { m = d; best = { fx, fy, ex, ey, w, L: Math.sqrt(L2) }; }
    }
    return { m, wet, main, s: best }; // main = jarak ke aspal jalan non-servis
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
  // ---- zona bebas gedung (Z1 fasad + Z2 dinding), sisi gedung per sel 12 m
  const ZC = 12, ZG = new Map(), zones = [], walls = [];
  const zput = (G, k, x0, y0, x1, y1) => { for (let cx = Math.floor(x0 / ZC); cx <= Math.floor(x1 / ZC); cx++) for (let cy = Math.floor(y0 / ZC); cy <= Math.floor(y1 / ZC); cy++) { const kk = key(cx, cy); (G.get(kk) || G.set(kk, []).get(kk)).push(k); } };
  const WG = new Map();
  D.buildings.r.forEach((r, bi) => {
    if (D.buildings.k[bi] === 5) return;
    const n = r.length >> 1;
    let A = 0;
    for (let a = 0, b = n - 1; a < n; b = a++) A += r[2 * b] * r[2 * a + 1] - r[2 * a] * r[2 * b + 1];
    const sg = A > 0 ? 1 : -1; // berlawanan jarum jam: normal keluar = (uy, −ux)
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ax = r[2 * b] * M, ay = r[2 * b + 1] * M, bx = r[2 * a] * M, by = r[2 * a + 1] * M, len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-3) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, ox = uy * sg, oy = -ux * sg;
      const wk = walls.push([ax, ay, bx, by]) - 1;
      zput(WG, wk, Math.min(ax, bx) - 3, Math.min(ay, by) - 3, Math.max(ax, bx) + 3, Math.max(ay, by) + 3);
      if (len < 1.25) continue;
      let dep = 4.0;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      for (let v = 0.3; v <= 12;) { // sisi depan: bebas sampai tepi aspal (maks 8 m); sinar melangkah sejauh jarak ke aspal
        const d = road(mx + ox * v, my + oy * v).main;
        if (d < 0) { dep = Math.min(8, Math.max(4.0, v)); break; }
        v += Math.max(0.3, Math.min(4, d)); // sel jalan hanya memuat ruas ≤ 5 m dari tepinya: langkah dibatasi 4 m
      }
      const zk = zones.push([ax, ay, ux, uy, ox, oy, len, dep]) - 1, ex0 = ax - ux * 0.5, ey0 = ay - uy * 0.5, ex1 = bx + ux * 0.5, ey1 = by + uy * 0.5;
      zput(ZG, zk, Math.min(ex0, ex1, ex0 + ox * dep, ex1 + ox * dep), Math.min(ey0, ey1, ey0 + oy * dep, ey1 + oy * dep), Math.max(ex0, ex1, ex0 + ox * dep, ex1 + ox * dep), Math.max(ey0, ey1, ey0 + oy * dep, ey1 + oy * dep));
    }
  });
  const inFacade = (x, y) => { // Z1
    for (const zk of ZG.get(key(Math.floor(x / ZC), Math.floor(y / ZC))) || []) {
      const [ax, ay, ux, uy, ox, oy, len, dep] = zones[zk], dx = x - ax, dy = y - ay, u = dx * ux + dy * uy, v = dx * ox + dy * oy;
      if (u >= -0.5 && u <= len + 0.5 && v > -0.3 && v < dep) return true;
    }
    return false;
  };
  const wallDist = (x, y) => { // Z2: jarak ke dinding terdekat (maks 3 m)
    let best = 3;
    for (const wk of WG.get(key(Math.floor(x / ZC), Math.floor(y / ZC))) || []) {
      const [ax, ay, bx, by] = walls[wk], ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0;
      best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
    }
    return best;
  };
  // ---- Z6 tembok keliling (batang ≥ 1,2 m dari as tembok; semak 0,6 m) & Z5 gerbang (≤ 5 m dari pilar dan di corong
  // masuk gerbang jalan; ≤ 2,5 m dari pintu pejalan kaki; semak hanya dilarang di bukaannya)
  const LG = new Map(), lsegs = [], GG = new Map(), gts = [];
  if (D.walls) {
    for (const L of D.walls.lines || []) for (let j = 0; j + 3 < L.p.length; j += 2) { const ax = L.p[j] * M, ay = L.p[j + 1] * M, bx = L.p[j + 2] * M, by = L.p[j + 3] * M, k = lsegs.push([ax, ay, bx, by]) - 1; zput(LG, k, Math.min(ax, bx) - 1.3, Math.min(ay, by) - 1.3, Math.max(ax, bx) + 1.3, Math.max(ay, by) + 1.3); }
    for (const g of D.walls.gates || []) { const a = g.a / 10 * Math.PI / 180, x = g.x * M, y = g.y * M, h = g.h * M, k = gts.push([x, y, Math.cos(a), Math.sin(a), h, g.k]) - 1, pad = g.k === 3 ? 2.5 : h + 8; zput(GG, k, x - pad, y - pad, x + pad, y + pad); }
  }
  const nearWall = (x, y, r) => { for (const k of LG.get(key(Math.floor(x / ZC), Math.floor(y / ZC))) || []) { const [ax, ay, bx, by] = lsegs[k], ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0; if (Math.hypot(x - ax - ex * t, y - ay - ey * t) < r) return true; } return false; };
  const atGate = (x, y, shrub) => {
    for (const k of GG.get(key(Math.floor(x / ZC), Math.floor(y / ZC))) || []) {
      const [gx, gy, ux, uy, h, kind] = gts[k], lon = (x - gx) * ux + (y - gy) * uy, lat = -(x - gx) * uy + (y - gy) * ux;
      if (shrub) { if (Math.abs(lat) < h + 0.3 && Math.abs(lon) < (kind === 3 ? 1.6 : 3.2)) return true; continue; }
      if (kind === 3) { if (Math.hypot(lon, lat) < 2.5) return true; continue; }
      if (Math.min(Math.hypot(lat - h, lon), Math.hypot(lat + h, lon)) <= 5 || (Math.abs(lat) < h && Math.abs(lon) < 8)) return true;
    }
    return false;
  };
  const viol = (x, y, wallMin, shrub = false) => inFacade(x, y) ? 'z1' : wallDist(x, y) < wallMin ? 'z2' : nearWall(x, y, shrub ? 0.6 : 1.2) ? 'z6' : atGate(x, y, shrub) ? 'z5' : null;
  const treeWall = (sp) => (sp === 0 ? 3.0 : 2.2); // tajuk lebar (grup 0) / palem & kolom
  return { road, blockedBy, viol, treeWall, BG, polys, BC, key };
}

export function cleanTrees(D) {
  if (D.meta.treesClean) return D.meta.treesClean;
  const st = D.meta.treeStride || 3, T = D.trees, n = Math.floor(T.length / st);
  const { road, blockedBy, viol, treeWall, BG, polys, BC, key } = treeGuard(D);
  const planted = !!(D.meta.layout && D.meta.layout.stages && D.meta.layout.stages.includes('trees')); // ditanam perapi: tidak ada pindah-ke-trotoar
  // ---- jarak antar pohon
  const TC = 4, TG = new Map();
  const near = (G, x, y, r) => { for (let cx = Math.floor((x - r) / TC); cx <= Math.floor((x + r) / TC); cx++) for (let cy = Math.floor((y - r) / TC); cy <= Math.floor((y + r) / TC); cy++) for (const p of G.get(key(cx, cy)) || []) if (Math.hypot(p[0] - x, p[1] - y) < r) return true; return false; };
  const put = (G, x, y) => { const kk = key(Math.floor(x / TC), Math.floor(y / TC)); (G.get(kk) || G.set(kk, []).get(kk)).push([x, y]); };
  const stats = { before: n, after: 0, moved: 0, road: 0, building: 0, water: 0, close: 0, z1: 0, z2: 0, z5: 0, z6: 0, shifted: 0, zoneDrop: 0, shrinked: 0, shrubs: 0, shrubZone: 0 };
  const kept = [], later = [];
  for (let i = 0; i < n; i++) {
    let x = T[i * st] * M, y = T[i * st + 1] * M;
    const R = road(x, y);
    if (planted && R.m < 1.15) { stats.road++; continue; }
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
    const k = T[i * st + 2], sp = st > 3 ? T[i * st + 3] : 0, z = viol(x, y, treeWall(sp));
    if (z) { stats[z]++; later.push([x, y, k, sp]); continue; } // dicoba digeser sesudah semua pohon yang lolos tertanam
    put(TG, x, y);
    kept.push([x, y, k, sp, R.m]);
  }
  // pelanggar zona: geser sepanjang arah jalan terdekat ±1…8 m ke titik yang lolos; kalau tidak ada, buang
  for (const [x, y, k, sp] of later) {
    const S = road(x, y).s;
    let done = false;
    if (S) {
      const ux = S.ex / (S.L || 1), uy = S.ey / (S.L || 1), sg = hash(y, x) < 0.5 ? 1 : -1;
      for (let a = 1; a <= 8 && !done; a++) for (const d of [a * sg, -a * sg]) {
        const x2 = x + ux * d, y2 = y + uy * d, R2 = road(x2, y2);
        if (R2.m < 1.9 || R2.wet < 0.8 || viol(x2, y2, treeWall(sp)) || blockedBy(x2, y2, 0.6) || near(TG, x2, y2, 4)) continue;
        put(TG, x2, y2);
        kept.push([x2, y2, k, sp, R2.m]);
        stats.shifted++; done = true; break;
      }
    }
    if (!done) stats.zoneDrop++;
  }
  const out = [];
  for (const [x, y, k, sp] of kept) out.push(Math.round(x / M), Math.round(y / M), k, sp);
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
    const t = kept[i], k2 = t[3] === 0 ? Math.min(t[2], best < 5 ? 0 : best < 7 ? 1 : 2) : t[2]; // Z2: tajuk lebar di tempat sempit diperkecil
    if (k2 !== t[2]) { out[i * 4 + 2] = k2; stats.shrinked++; }
  });
  D.treeRoom = room;
  // ---- semak hiasan: deret di antara palem (median/boulevard) & gerombol di taman
  const greens = (D.green.r || []).filter((r, i) => ['park', 'grass', 'cemetery'].includes(D.greenTypes[D.green.t[i]]));
  const inGreen = (x, y) => greens.some((r) => pipFlat(x / M, y / M, r));
  const SG = new Map(), shrubs = [];
  const okShrub = (x, y) => { const R = road(x, y); return R.m > 0.9 && R.wet > 0.6 && !blockedBy(x, y, 0.5) && !near(TG, x, y, 1.0) && !near(SG, x, y, 0.95); };
  const addShrub = (x, y, s) => { if (!okShrub(x, y)) return; if (viol(x, y, 0.8, true)) { stats.shrubZone++; return; } put(SG, x, y); shrubs.push(+x.toFixed(2), +y.toFixed(2), +s.toFixed(2)); };
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
