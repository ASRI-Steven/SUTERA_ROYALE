// Navigasi lokal bot: grid A* malas (sel 1 m, dihitung saat dibutuhkan dan disimpan) untuk berjalan memutari
// gedung, plus pencarian titik berlindung (sisi gedung yang tidak terlihat musuh) dan titik intip di sebelahnya.
// Dinding rumah tipis (0,12–0,2 m) bisa terselip di antara dua pusat sel yang sama-sama bebas, sehingga jalur dulu
// menembus dinding di samping pintu dan bot mendorong tembok tanpa henti. Sekarang tiap langkah antar-sel dan tiap
// ruas lurus diuji persis: lingkaran badan disapu sepanjang ruas melawan poligon collider (hasil langkah disimpan
// per sel; sel "lapang" — tanpa penghalang ≤ 1 m — dilewati tanpa uji). Uji persis memakai indeks halus 4 m
// (poligon & pohon per sel, dibangun per sel collider saat pertama dipakai), cache sel = halaman Uint16 64×64.
// Pintu & celah sekat (homes, opsional): sel yang memuat tengah celah memakai titik itu sebagai titik wakilnya — dengan
// sel 1 m pusat sel belum tentu jatuh di bagian tengah celah sekat 1,4 m yang cukup lebar untuk badan, sehingga ruangan
// bersekat (dan lantai atas) bisa "tertutup" bagi A*.
// Koordinat data: x timur, y utara (m).
const CS = 1.0, PAD = 18, MAXW = 170; // 1 m: cukup halus untuk lewat pintu rumah (1,6 m)
const RE = 0.25; // jari-jari uji langkah antar-sel (badan 0,35 boleh menyerempet kusen: pintu sekat 1,4 m tetap bisa dilewati)
const RW = 0.3; // jari-jari uji ruas lurus (tarik tali, jalan langsung)
const RB = 0.35; // jari-jari uji sel terhalang (= col.blocked r 0,3 + 0,05)
const RG = 0.24, RGE = 0.18; // titik celah pintu/sekat & langkah dari/ke titik itu: boleh lebih sempit (badan 0,35 masih menyelip di celah ±0,55 m — diuji)
const RCLEAR = 1.05; // sel lapang: tidak ada penghalang sejauh ini dari pusatnya → langkah ke tetangga pasti bebas
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
const CC = 24, FC = 4, FN = CC / FC, FM = 1.2; // sel collider (= CELL collide.js), sel indeks halus, jumlahnya per sisi, tepi sisip (≥ RCLEAR)
const PG = 64, PMAX = 1600, UNK = 0xffff; // halaman cache sel, batas halaman (±13 MB) sebelum dikosongkan, "belum dihitung"

export function createNav(col, homes = null) {
  // ---------- titik wakil sel: pusat sel, atau titik bebas pada celah pintu/sekat yang melintasi sel itu ----------
  // (dihitung saat sel pertama kali dipakai: titik celah dari tengah ke tepi, yang pertama tidak terhalang — sekat kedua
  // rumah besar kadang berpangkal tepat di tengah pintu sekat pertama, jadi tengah celah belum tentu bebas)
  const gaps = [new Map(), new Map()]; // per lantai (0 = tanah, 1 = atas): kunci sel → [x0, y0, x1, y1, …] ruas celah
  const reps = [new Map(), new Map()]; // titik wakil yang sudah dihitung (null = pakai pusat sel)
  const ckey = (ix, iy) => (ix + 4096) * 8192 + (iy + 4096);
  function addGap(lvi, x0, y0, x1, y1) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.25)), seen = new Set();
    for (let i = 0; i <= n; i++) {
      const k = ckey(Math.floor((x0 + (x1 - x0) * i / n) / CS), Math.floor((y0 + (y1 - y0) * i / n) / CS));
      if (seen.has(k)) continue;
      seen.add(k);
      const a = gaps[lvi].get(k);
      if (a) a.push(x0, y0, x1, y1); else gaps[lvi].set(k, [x0, y0, x1, y1]);
    }
  }
  if (homes) homes.forEach((H) => {
    for (const d of H.doors || []) { // tengah tebal dinding luar (0,2 m ke dalam dari tepi poligon)
      const e = d.e;
      if (!e) continue;
      const ox = e.a[0] + e.nx * 0.1, oy = e.a[1] + e.ny * 0.1;
      addGap(0, ox + e.ux * d.s0, oy + e.uy * d.s0, ox + e.ux * d.s1, oy + e.uy * d.s1);
    }
    for (const p of H.parts || []) if (p.g1 > p.g0 && p.len > 0) {
      const ux = (p.b[0] - p.a[0]) / p.len, uy = (p.b[1] - p.a[1]) / p.len;
      const x0 = p.a[0] + ux * p.g0, y0 = p.a[1] + uy * p.g0, x1 = p.a[0] + ux * p.g1, y1 = p.a[1] + uy * p.g1;
      addGap(0, x0, y0, x1, y1);
      if (H.up) addGap(1, x0, y0, x1, y1); // lantai atas memakai sekat yang sama
    }
  });
  const GT = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.15, 0.85, 0.1, 0.9]; // dari tengah celah ke tepi
  let rx = 0, ry = 0, rg = false, rnx = 0, rny = 0; // rg: titik wakil = titik celah (uji terhalang memakai RG), (rnx, rny) normal celah
  function rep(ix, iy, lv) {
    rx = (ix + 0.5) * CS; ry = (iy + 0.5) * CS; rg = false;
    const li = lv > 0 ? 1 : 0, k = ckey(ix, iy), g = gaps[li].get(k);
    if (!g) return;
    let r = reps[li].get(k);
    if (r === undefined) {
      r = null;
      for (let j = 0; j < g.length && !r; j += 4) for (const t of GT) {
        const x = g[j] + (g[j + 2] - g[j]) * t, y = g[j + 1] + (g[j + 3] - g[j + 1]) * t;
        if (Math.floor(x / CS) !== ix || Math.floor(y / CS) !== iy) continue;
        if (segFree(x, y, x, y, RG, lv)) { const L = Math.hypot(g[j + 2] - g[j], g[j + 3] - g[j + 1]) || 1; r = [x, y, -(g[j + 3] - g[j + 1]) / L, (g[j + 2] - g[j]) / L]; break; }
      }
      reps[li].set(k, r);
    }
    if (r) { rx = r[0]; ry = r[1]; rg = true; rnx = r[2]; rny = r[3]; }
  }
  // ---------- indeks halus ----------
  const fine = new Map(), indexed = new Set();
  const fkey = (fx, fy) => (fx + 2048) * 4096 + (fy + 2048);
  let grabbed = null;
  const grab = (c) => { grabbed = c; };
  const fcell = (fx, fy) => { const k = fkey(fx, fy); let f = fine.get(k); if (!f) fine.set(k, (f = { p: [], t: [] })); return f; };
  function indexParent(cx, cy) { // sisipkan poligon & pohon satu sel collider ke sel halus (bbox + FM), termasuk satu cincin sel halus di luarnya
    const k = (cx + 2048) * 4096 + (cy + 2048);
    if (indexed.has(k)) return;
    indexed.add(k);
    grabbed = null;
    col.near((cx + 0.5) * CC, (cy + 0.5) * CC, 0.01, grab);
    const c = grabbed;
    if (!c) return;
    const lo = cx * FN - 1, hi = cx * FN + FN, lo2 = cy * FN - 1, hi2 = cy * FN + FN, P = col.polys, T = col.trees;
    for (const pi of c.p) {
      const G = P[pi];
      const ax = Math.max(lo, Math.floor((G.x0 - FM) / FC)), bx = Math.min(hi, Math.floor((G.x1 + FM) / FC)), ay = Math.max(lo2, Math.floor((G.y0 - FM) / FC)), by = Math.min(hi2, Math.floor((G.y1 + FM) / FC));
      for (let fx = ax; fx <= bx; fx++) for (let fy = ay; fy <= by; fy++) fcell(fx, fy).p.push(pi);
    }
    for (const ti of c.t) {
      const t = T[ti], m = t.r + FM;
      const ax = Math.max(lo, Math.floor((t.x - m) / FC)), bx = Math.min(hi, Math.floor((t.x + m) / FC)), ay = Math.max(lo2, Math.floor((t.y - m) / FC)), by = Math.min(hi2, Math.floor((t.y + m) / FC));
      for (let fx = ax; fx <= bx; fx++) for (let fy = ay; fy <= by; fy++) fcell(fx, fy).t.push(ti);
    }
  }
  function fineAt(fx, fy) { // sel halus lengkap: semua sel collider di sekitarnya (±1 sel halus) sudah diindeks
    const c0x = Math.floor((fx - 1) / FN), c1x = Math.floor((fx + 1) / FN), c0y = Math.floor((fy - 1) / FN), c1y = Math.floor((fy + 1) / FN);
    for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) indexParent(cx, cy);
    return fine.get(fkey(fx, fy));
  }
  // ---------- Uji ruas persis: lingkaran berjari-jari r disapu dari (x0,y0) ke (x1,y1), kaki setinggi lv ----------
  // aturan tinggi sama dengan blocksAgent (map/collide.js): air padat di tanah, poligon di atas kepala / di bawah lutut
  // tidak menghalangi, tangga hanya menghalangi bagian yang lebih tinggi dari ±0,45 m di atas kaki.
  let qx0 = 0, qy0 = 0, qx1 = 0, qy1 = 0, qr = 0, qlv = 0, qbx0 = 0, qby0 = 0, qbx1 = 0, qby1 = 0;
  let marks = new Uint32Array(0), mark = 0;
  const stairRect = new Map(); // indeks poligon tangga → persegi tangga tanpa ±0,6 m bawahnya
  const ptSegD2 = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - px, ey = ay + dy * t - py;
    return ex * ex + ey * ey;
  };
  function segSegD2(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
    return Math.min(ptSegD2(ax, ay, cx, cy, dx, dy), ptSegD2(bx, by, cx, cy, dx, dy), ptSegD2(cx, cy, ax, ay, bx, by), ptSegD2(dx, dy, ax, ay, bx, by));
  }
  function pip(x, y, a) {
    let ins = false;
    for (let i = 0, n = a.length >> 1, j = n - 1; i < n; j = i++) {
      const xi = a[2 * i], yi = a[2 * i + 1], xj = a[2 * j], yj = a[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function polyHit(a) {
    if (pip(qx0, qy0, a) || (qx1 !== qx0 || qy1 !== qy0 ? pip(qx1, qy1, a) : false)) return true;
    const r2 = qr * qr;
    for (let i = 0, n = a.length >> 1, j = n - 1; i < n; j = i++) if (segSegD2(qx0, qy0, qx1, qy1, a[2 * j], a[2 * j + 1], a[2 * i], a[2 * i + 1]) < r2) return true;
    return false;
  }
  function stairPts(pi, P) {
    let r = stairRect.get(pi);
    if (!r) {
      const S = P.stair, s0 = 0.45 / Math.max(0.5, S.h1) * S.len, a = P.pts;
      r = new Float64Array(a.length);
      for (let i = 0; i < a.length; i += 2) { const s = (a[i] - S.ax) * S.ux + (a[i + 1] - S.ay) * S.uy, k = s < s0 ? s0 - s : 0; r[i] = a[i] + S.ux * k; r[i + 1] = a[i + 1] + S.uy * k; }
      stairRect.set(pi, r);
    }
    return r;
  }
  function fineHit(f) {
    const polys = col.polys, cp = f.p;
    for (let k = 0; k < cp.length; k++) {
      const pi = cp[k];
      if (marks[pi] === mark) continue;
      marks[pi] = mark;
      const P = polys[pi];
      if (P.x1 < qbx0 || P.x0 > qbx1 || P.y1 < qby0 || P.y0 > qby1) continue;
      if (P.b === -1) { if (qlv >= 0.5) continue; } else if (P.z0 > qlv + 1.9 || P.h < qlv + 0.35) continue;
      if (P.stair) { if (qlv < 0.5 && polyHit(stairPts(pi, P))) return true; continue; }
      if (polyHit(P.pts)) return true;
    }
    const ct = f.t, trees = col.trees;
    for (let k = 0; k < ct.length; k++) { const t = trees[ct[k]], m = qr + t.r; if (t.x > qbx0 - t.r && t.x < qbx1 + t.r && t.y > qby0 - t.r && t.y < qby1 + t.r && ptSegD2(t.x, t.y, qx0, qy0, qx1, qy1) < m * m) return true; }
    return false;
  }
  let npolys = -1;
  function segFree(x0, y0, x1, y1, r, lv = 0) {
    if (col.polys.length !== npolys) { // rintangan baru ditambahkan (col.addObstacles): indeks & cache dibangun ulang
      if (npolys >= 0) { fine.clear(); indexed.clear(); pages[0].clear(); pages[1].clear(); npages = 0; reps[0].clear(); reps[1].clear(); }
      npolys = col.polys.length;
    }
    qx0 = x0; qy0 = y0; qx1 = x1; qy1 = y1; qr = r; qlv = lv;
    qbx0 = Math.min(x0, x1) - r; qbx1 = Math.max(x0, x1) + r; qby0 = Math.min(y0, y1) - r; qby1 = Math.max(y0, y1) + r;
    if (marks.length < col.polys.length) marks = new Uint32Array(col.polys.length + 4096);
    if (++mark > 4e9) { marks.fill(0); mark = 1; }
    // sel halus yang dilalui ruas (poligon disisipkan dengan tepi FM ≥ r, jadi cukup sel di sepanjang ruas itu sendiri)
    const fx0 = Math.floor(Math.min(x0, x1) / FC), fx1 = Math.floor(Math.max(x0, x1) / FC), fy0 = Math.floor(Math.min(y0, y1) / FC), fy1 = Math.floor(Math.max(y0, y1) / FC);
    const lng = fx1 > fx0 + 1 && fy1 > fy0 + 1;
    for (let fx = fx0; fx <= fx1; fx++) for (let fy = fy0; fy <= fy1; fy++) {
      if (lng && ptSegD2((fx + 0.5) * FC, (fy + 0.5) * FC, x0, y0, x1, y1) > FC * FC * 0.5) continue; // sel tidak disentuh ruas diagonal panjang
      const f = fineAt(fx, fy);
      if (f && fineHit(f)) return false;
    }
    return true;
  }
  // ---------- Cache sel ----------
  // nilai per sel: bit0 terhalang · bit1 lapang sudah dicek · bit2 lapang · bit3–6 langkah E/N/NE/NW sudah dicek ·
  // bit7–10 langkah itu terhalang. lv = tinggi lantai (0 = tanah); di lantai atas sel juga harus punya pelat lantai setinggi lv
  const pages = [new Map(), new Map()];
  let npages = 0;
  function pageOf(ix, iy, lv) {
    const m = pages[lv > 0 ? 1 : 0], k = ((ix >> 6) + 1024) * 2048 + ((iy >> 6) + 1024);
    let p = m.get(k);
    if (p === undefined) {
      if (++npages > PMAX) { pages[0].clear(); pages[1].clear(); npages = 1; }
      p = new Uint16Array(PG * PG).fill(UNK);
      m.set(k, p);
    }
    return p;
  }
  function computeCell(ix, iy, lv) {
    rep(ix, iy, lv);
    const x = rx, y = ry;
    if (!segFree(x, y, x, y, rg ? RG : RB, lv)) return 1;
    if (lv > 0 && Math.abs(col.floorAt(x, y, lv) - lv) > 0.3) return 1;
    return col.inArea(x, y) ? 0 : 1;
  }
  function cellV(ix, iy, lv) {
    const p = pageOf(ix, iy, lv), j = ((ix & 63) << 6) | (iy & 63);
    let v = p[j];
    if (v === UNK) { v = computeCell(ix, iy, lv); p[j] = v; }
    return v;
  }
  const setV = (ix, iy, lv, v) => { pageOf(ix, iy, lv)[((ix & 63) << 6) | (iy & 63)] = v; };
  const cellBlocked = (ix, iy, lv = 0) => (cellV(ix, iy, lv) & 1) === 1;
  // bit "lapang" (dihitung sekali) dan bit langkah arah d dari sel (ix, iy); v = nilai sel saat ini → nilai baru
  function withClear(ix, iy, lv, v) { if (v & 2) return v; rep(ix, iy, lv); return v | 2 | (segFree(rx, ry, rx, ry, RCLEAR, lv) ? 4 : 0); }
  function withEdge(ix, iy, lv, v, d) {
    if (v & (8 << d)) return v;
    rep(ix + (d === 1 ? 0 : d === 3 ? -1 : 1), iy + (d === 0 ? 0 : 1), lv);
    const tx = rx, ty = ry, tg = rg;
    rep(ix, iy, lv);
    // langkah keluar/masuk celah pintu: pusat sel tetangga jarang segaris dengan celah, jadi ruasnya menyerempet kusen —
    // diuji lebih longgar (badan meluncur di kusen, lihat RG)
    return v | (8 << d) | (segFree(rx, ry, tx, ty, rg || tg ? RGE : RE, lv) ? 0 : 128 << d);
  }
  // arah baku langkah (dx, dy): sel asal (dari (ix, iy)) & indeks arah — E, N, NE, NW
  let esx = 0, esy = 0, ed = 0;
  function canon(ix, iy, dx, dy) {
    esx = ix; esy = iy;
    if (dy === 0) { ed = 0; if (dx < 0) esx = ix - 1; } else if (dx === 0) { ed = 1; if (dy < 0) esy = iy - 1; } else if (dx === dy) { ed = 2; if (dx < 0) { esx = ix - 1; esy = iy - 1; } } else { ed = 3; if (dy < 0) { esx = ix + 1; esy = iy - 1; } }
  }
  const blockedAt = (x, y, lv = 0) => cellBlocked(Math.floor(x / CS), Math.floor(y / CS), lv);
  // ruas lurus bisa dilalui? (sampel tiap 0,6 m pada grid — tepi kawasan, lantai atas berpelat — lalu uji persis)
  function walkable(x0, y0, x1, y1, lv = 0) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / 0.6);
    for (let i = 1; i <= n; i++) { const t = i / n; if (blockedAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, lv)) return false; }
    return segFree(x0, y0, x1, y1, RW, lv);
  }
  // sel bebas terdekat; (px, py) = titik asli: hanya sel yang terjangkau lurus darinya (bukan di balik dinding tipis).
  // strict = tanpa cadangan (titik awal bot: jalur dari balik dinding hanya membuatnya mendorong tembok); tujuan boleh
  // memakai sel bebas pertama sebagai cadangan
  function freeNear(ix, iy, r, lv, px, py, strict) {
    if (!cellBlocked(ix, iy, lv)) return [ix, iy];
    let fb = null;
    for (let d = 1; d <= r; d++) for (let dx = -d; dx <= d; dx++) for (let dy = -d; dy <= d; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || cellBlocked(ix + dx, iy + dy, lv)) continue;
      rep(ix + dx, iy + dy, lv);
      if (segFree(px, py, rx, ry, 0.2, lv)) return [ix + dx, iy + dy];
      if (!strict) fb ||= [ix + dx, iy + dy];
    }
    return fb;
  }
  // A* di jendela sekitar awal–tujuan; hasil = titik belok [[x,y],…] (tanpa titik awal) atau null.
  // LV = salinan nilai sel di jendela (−1 = belum diambil dari halaman) supaya tetangga tidak berulang kali dicari di Map.
  let G = new Float32Array(0), FROM = new Int32Array(0), ST = new Uint8Array(0), LV = new Int32Array(0);
  function path(x0, y0, x1, y1, maxExp = 9000, lv = 0) {
    const s0 = freeNear(Math.floor(x0 / CS), Math.floor(y0 / CS), 3, lv, x0, y0, true), t0 = freeNear(Math.floor(x1 / CS), Math.floor(y1 / CS), 3, lv, x1, y1, false);
    if (!s0 || !t0) return null;
    const minx = Math.min(s0[0], t0[0]) - PAD, miny = Math.min(s0[1], t0[1]) - PAD;
    const w = Math.max(s0[0], t0[0]) + PAD - minx + 1, h = Math.max(s0[1], t0[1]) + PAD - miny + 1;
    if (w > MAXW || h > MAXW) return null;
    const N = w * h;
    if (G.length < N) { G = new Float32Array(N); FROM = new Int32Array(N); ST = new Uint8Array(N); LV = new Int32Array(N); }
    ST.fill(0, 0, N);
    LV.fill(-1, 0, N);
    const idx = (ix, iy) => (iy - miny) * w + (ix - minx);
    const cw = (ix, iy) => { const i = (iy - miny) * w + (ix - minx); let v = LV[i]; if (v < 0) v = LV[i] = cellV(ix, iy, lv); return v; };
    const put = (ix, iy, v) => { LV[(iy - miny) * w + (ix - minx)] = v; setV(ix, iy, lv, v); };
    const s = idx(s0[0], s0[1]), t = idx(t0[0], t0[1]), tx = t0[0], ty = t0[1];
    const hx = (ix, iy) => { const dx = Math.abs(ix - tx), dy = Math.abs(iy - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const heap = [];
    const push = (i, f) => { heap.push(f, i); let c = heap.length / 2 - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p * 2] <= heap[c * 2]) break; const a = heap[p * 2], b = heap[p * 2 + 1]; heap[p * 2] = heap[c * 2]; heap[p * 2 + 1] = heap[c * 2 + 1]; heap[c * 2] = a; heap[c * 2 + 1] = b; c = p; } };
    const pop = () => {
      const i = heap[1], li = heap.pop(), lf = heap.pop(); // pasangan [f, i]: pop() mengambil i dulu
      if (heap.length) {
        heap[0] = lf; heap[1] = li;
        let c = 0; const n = heap.length / 2;
        for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < n && heap[l * 2] < heap[m * 2]) m = l; if (r < n && heap[r * 2] < heap[m * 2]) m = r; if (m === c) break; const a = heap[m * 2], b = heap[m * 2 + 1]; heap[m * 2] = heap[c * 2]; heap[m * 2 + 1] = heap[c * 2 + 1]; heap[c * 2] = a; heap[c * 2 + 1] = b; c = m; }
      }
      return i;
    };
    G[s] = 0; FROM[s] = -1; ST[s] = 1;
    push(s, hx(s0[0], s0[1]));
    let n = 0, found = false;
    while (heap.length && n++ < maxExp) {
      const u = pop();
      if (ST[u] === 2) continue;
      ST[u] = 2;
      if (u === t) { found = true; break; }
      const ux = u % w + minx, uy = (u / w | 0) + miny;
      for (let k = 0; k < 8; k++) {
        const D = DIRS[k], dx = D[0], dy = D[1], vx = ux + dx, vy = uy + dy;
        if (vx < minx || vy < miny || vx >= minx + w || vy >= miny + h) continue;
        const v = idx(vx, vy);
        if (ST[v] === 2 || (cw(vx, vy) & 1)) continue;
        // dinding tipis / sudut di antara dua sel: bebas kalau keduanya lapang, selain itu uji persis (disimpan di sel asal
        // baku). Uji persis ini juga menggantikan larangan memotong sudut yang dulu (itu menutup celah pintu yang miring).
        canon(ux, uy, dx, dy);
        const sx = esx, sy = esy, d = ed, ex = sx + (d === 1 ? 0 : d === 3 ? -1 : 1), ey = sy + (d === 0 ? 0 : 1);
        let vs = cw(sx, sy), ve = cw(ex, ey);
        if (!(vs & 2)) { vs = withClear(sx, sy, lv, vs); put(sx, sy, vs); }
        if (!(ve & 2)) { ve = withClear(ex, ey, lv, ve); put(ex, ey, ve); }
        if (!(vs & ve & 4)) {
          if (!(vs & (8 << d))) { vs = withEdge(sx, sy, lv, vs, d); put(sx, sy, vs); }
          if (vs & (128 << d)) continue;
        }
        const g = G[u] + D[2];
        if (ST[v] === 1 && g >= G[v]) continue;
        G[v] = g; FROM[v] = u; ST[v] = 1;
        push(v, g + hx(vx, vy));
      }
    }
    if (!found) return null;
    const cells = [];
    for (let v = t; v >= 0; v = FROM[v]) cells.push(v);
    cells.reverse();
    const pts = [], gp = []; // gp: [indeks, nx, ny] titik celah yang dilalui
    for (const v of cells) { rep(v % w + minx, (v / w | 0) + miny, lv); if (rg) gp.push(pts.length, rnx, rny); pts.push([rx, ry]); }
    // menembus celah: tambah titik 0,5 m sebelum & sesudahnya searah normal celah supaya badan masuk lurus, tidak menyerong
    // ke kusen (penting di celah sempit)
    for (let q = gp.length - 3; q >= 0; q -= 3) {
      const k = gp[q], nx = gp[q + 1], ny = gp[q + 2], P = pts[k], A = k > 0 ? pts[k - 1] : [x0, y0], Z = k + 1 < pts.length ? pts[k + 1] : [x1, y1];
      const sa = (A[0] - P[0]) * nx + (A[1] - P[1]) * ny, sz = (Z[0] - P[0]) * nx + (Z[1] - P[1]) * ny;
      if (sa * sz >= 0) continue; // tidak menyeberang celah (hanya menyusuri dinding)
      const sg = sa > 0 ? 0.5 : -0.5, ins = [];
      if (segFree(P[0] + nx * sg, P[1] + ny * sg, P[0] + nx * sg, P[1] + ny * sg, RG, lv)) ins.push([P[0] + nx * sg, P[1] + ny * sg]);
      ins.push(P);
      if (segFree(P[0] - nx * sg, P[1] - ny * sg, P[0] - nx * sg, P[1] - ny * sg, RG, lv)) ins.push([P[0] - nx * sg, P[1] - ny * sg]);
      pts.splice(k, 1, ...ins);
    }
    { // titik akhir = tujuan persis kalau bisa dicapai lurus dari pusat sel terakhir
      const e = pts[pts.length - 1];
      if (segFree(x1, y1, x1, y1, RB, lv) && walkable(e[0], e[1], x1, y1, lv)) { if (Math.abs(e[0] - x1) < 0.75 && Math.abs(e[1] - y1) < 0.75) pts[pts.length - 1] = [x1, y1]; else pts.push([x1, y1]); }
    }
    // tarik tali (maju): lanjutkan selama titik berikutnya masih terlihat lurus dari jangkar — O(n) uji ruas
    const out = [];
    let ax = x0, ay = y0, i = 0;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && walkable(ax, ay, pts[j + 1][0], pts[j + 1][1], lv)) j++;
      out.push(pts[j]);
      ax = pts[j][0]; ay = pts[j][1];
      i = j + 1;
    }
    return out;
  }

  // ---------- Titik berlindung ----------
  // (bx,by) posisi bot; (ex,ey,eh) mata musuh. opt: { R jari-jari cari, want jarak ideal ke musuh, away = utamakan menjauh,
  // push = boleh mendekat }. Hasil { x, y, px, py (titik intip, bisa null), d (jarak dari bot) } atau null.
  const seen = new Set();
  function cover(bx, by, ex, ey, eh, opt = {}) {
    const R = opt.R || 22, want = opt.want || 30;
    const cand = [];
    seen.clear();
    col.near(bx, by, R, (c) => {
      for (const pi of c.p) {
        if (seen.has(pi)) continue;
        seen.add(pi);
        const P = col.polys[pi];
        // gedung (≥ 1,7 m) atau benda jalan (col.addObstacles, b = −3: pos jaga, halte, kaki papan reklame…) yang cukup tinggi
        // & lebar untuk bersembunyi; tiang ramping dilewati (uji pandang di bawah yang menentukan)
        if (P.b === -3 ? P.h < 1.2 || (P.x1 - P.x0 < 0.5 && P.y1 - P.y0 < 0.5) : P.b < 0 || P.h < 1.7) continue;
        if (P.z0 > 1.9) continue;
        if (P.x1 < bx - R || P.x0 > bx + R || P.y1 < by - R || P.y0 > by + R) continue;
        const a = P.pts, n = a.length >> 1;
        let area = 0;
        for (let i = 0, j = n - 1; i < n; j = i++) area += a[2 * j] * a[2 * i + 1] - a[2 * i] * a[2 * j + 1];
        const sgn = area > 0 ? 1 : -1; // CCW → normal keluar = (dy, −dx)
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const ax = a[2 * j], ay = a[2 * j + 1], dx = a[2 * i] - ax, dy = a[2 * i + 1] - ay, L = Math.hypot(dx, dy);
          if (L < 1.2) continue;
          const ux = dx / L, uy = dy / L, nx = uy * sgn, ny = -ux * sgn;
          const k = Math.max(1, Math.floor(L / 2.4));
          for (let s = 0; s < k; s++) {
            const t = (s + 0.5) / k * L, x = ax + ux * t + nx * 0.85, y = ay + uy * t + ny * 0.85;
            const d = Math.hypot(x - bx, y - by);
            if (d > R) continue;
            cand.push({ x, y, d, ux, uy, nx, ny, t, L });
          }
        }
      }
    });
    cand.sort((p, q) => p.d - q.d);
    let best = null, bs = Infinity, tested = 0;
    const dEnemy0 = Math.hypot(bx - ex, by - ey);
    for (const c of cand) {
      if (tested > 70 || c.d > bs) break;
      // sisi gedung harus membelakangi musuh (musuh di sisi lain)
      if ((ex - c.x) * c.nx + (ey - c.y) * c.ny > 2) continue;
      if (col.blocked(c.x, c.y, 0.4)) continue;
      tested++;
      if (col.los(ex, ey, eh, c.x, c.y, 1.3)) continue; // masih terlihat → bukan perlindungan
      const de = Math.hypot(c.x - ex, c.y - ey);
      if (de < 6) continue;
      let score = c.d + Math.abs(de - want) * 0.18;
      if (opt.away && de < dEnemy0) score += (dEnemy0 - de) * 0.8;
      if (!opt.push && de < dEnemy0 - 6) score += 5;
      // titik intip: geser sepanjang dinding sampai musuh terlihat (dari tepi gedung)
      let px = null, py = null;
      for (const sd of [1.6, -1.6, 2.6, -2.6, 3.8, -3.8]) {
        const x = c.x + c.ux * sd, y = c.y + c.uy * sd;
        if (c.t + sd < -1.2 || c.t + sd > c.L + 1.2) continue;
        if (col.blocked(x, y, 0.4)) continue;
        if (col.los(ex, ey, eh, x, y, 1.4)) { px = x; py = y; break; }
      }
      if (px === null) score += opt.blind ? 0 : 7;
      if (score < bs) { bs = score; best = { x: c.x, y: c.y, px, py, d: c.d }; }
    }
    return best;
  }
  return { path, walkable, blockedAt, cover, cellBlocked, segFree };
}
