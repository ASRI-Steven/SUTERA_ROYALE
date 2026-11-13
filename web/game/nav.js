// Navigasi lokal bot: grid A* malas (sel 1,5 m, dihitung saat dibutuhkan dan disimpan) untuk berjalan memutari
// gedung, plus pencarian titik berlindung (sisi gedung yang tidak terlihat musuh) dan titik intip di sebelahnya.
// Koordinat data: x timur, y utara (m).
const CS = 1.0, PAD = 18, MAXW = 170; // 1 m: cukup halus untuk lewat pintu rumah (1,6 m)

export function createNav(col) {
  const cache = new Map();
  const key = (ix, iy, lv) => ((ix + 32768) * 65536 + (iy + 32768)) * 2 + (lv > 0 ? 1 : 0);
  // lv = tinggi lantai (0 = tanah); di lantai atas sel juga harus punya pelat lantai setinggi lv
  function cellBlocked(ix, iy, lv = 0) {
    const k = key(ix, iy, lv);
    let v = cache.get(k);
    if (v === undefined) {
      const x = (ix + 0.5) * CS, y = (iy + 0.5) * CS;
      v = (lv > 0 ? col.blocked(x, y, 0.3, lv) || Math.abs(col.floorAt(x, y, lv) - lv) > 0.3 : col.blocked(x, y, 0.3)) ? 1 : 0;
      if (cache.size > 600000) cache.clear();
      cache.set(k, v);
    }
    return v === 1;
  }
  const blockedAt = (x, y, lv = 0) => cellBlocked(Math.floor(x / CS), Math.floor(y / CS), lv);
  // ruas lurus bisa dilalui? (sampel tiap 0,6 m pada grid + cek tepat di ujung)
  function walkable(x0, y0, x1, y1, lv = 0) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / 0.6);
    for (let i = 1; i <= n; i++) { const t = i / n; if (blockedAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, lv)) return false; }
    return true;
  }
  function freeNear(ix, iy, r, lv) {
    if (!cellBlocked(ix, iy, lv)) return [ix, iy];
    for (let d = 1; d <= r; d++) for (let dx = -d; dx <= d; dx++) for (let dy = -d; dy <= d; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      if (!cellBlocked(ix + dx, iy + dy, lv)) return [ix + dx, iy + dy];
    }
    return null;
  }
  // A* di jendela sekitar awal–tujuan; hasil = titik belok [[x,y],…] (tanpa titik awal) atau null
  let G = new Float32Array(0), FROM = new Int32Array(0), ST = new Uint8Array(0);
  function path(x0, y0, x1, y1, maxExp = 9000, lv = 0) {
    const s0 = freeNear(Math.floor(x0 / CS), Math.floor(y0 / CS), 2, lv), t0 = freeNear(Math.floor(x1 / CS), Math.floor(y1 / CS), 3, lv);
    if (!s0 || !t0) return null;
    const minx = Math.min(s0[0], t0[0]) - PAD, miny = Math.min(s0[1], t0[1]) - PAD;
    const w = Math.max(s0[0], t0[0]) + PAD - minx + 1, h = Math.max(s0[1], t0[1]) + PAD - miny + 1;
    if (w > MAXW || h > MAXW) return null;
    const N = w * h;
    if (G.length < N) { G = new Float32Array(N); FROM = new Int32Array(N); ST = new Uint8Array(N); }
    ST.fill(0, 0, N);
    const idx = (ix, iy) => (iy - miny) * w + (ix - minx);
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
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.length && n++ < maxExp) {
      const u = pop();
      if (ST[u] === 2) continue;
      ST[u] = 2;
      if (u === t) { found = true; break; }
      const ux = u % w + minx, uy = (u / w | 0) + miny;
      for (const [dx, dy, c] of DIRS) {
        const vx = ux + dx, vy = uy + dy;
        if (vx < minx || vy < miny || vx >= minx + w || vy >= miny + h) continue;
        const v = idx(vx, vy);
        if (ST[v] === 2 || cellBlocked(vx, vy, lv)) continue;
        if (dx && dy && (cellBlocked(ux + dx, uy, lv) || cellBlocked(ux, uy + dy, lv))) continue; // jangan potong sudut
        const g = G[u] + c;
        if (ST[v] === 1 && g >= G[v]) continue;
        G[v] = g; FROM[v] = u; ST[v] = 1;
        push(v, g + hx(vx, vy));
      }
    }
    if (!found) return null;
    const cells = [];
    for (let v = t; v >= 0; v = FROM[v]) cells.push(v);
    cells.reverse();
    const pts = cells.map((v) => [(v % w + minx + 0.5) * CS, ((v / w | 0) + miny + 0.5) * CS]);
    pts[pts.length - 1] = blockedAt(x1, y1, lv) ? pts[pts.length - 1] : [x1, y1];
    // tarik tali: lompati titik yang masih terlihat lurus
    const out = [];
    let ax = x0, ay = y0, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !walkable(ax, ay, pts[j][0], pts[j][1], lv)) j--;
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
        if (P.b < 0 || P.h < 1.7 || P.z0 > 1.9) continue;
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
  return { path, walkable, blockedAt, cover, cellBlocked };
}
