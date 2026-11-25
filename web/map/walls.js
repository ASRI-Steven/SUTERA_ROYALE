// Tembok keliling kompleks perumahan: logika murni (tanpa impor) supaya game (envprops.js) dan uji node memakai
// kode yang sama. Data: alsut-props.json → walls: [{ p: [x0, y0, …] (dm), t (0 keliling · 2 tampilan di garis batas
// kawasan, tanpa tabrakan), e: [ujung awal, ujung akhir] }] dan
// gates: [{ x, y (dm), a (0,1°, arah masuk), w, h (dm), k, p }] (tools/tidy_layout.mjs tahap walls + --props).
//   k = 0 gapura utama (pilar 6,8 m + balok nama) · 1 gerbang samping (pilar 3,2 m) · 2 gerbang servis (pilaster)
//   · 3 pintu pejalan kaki (bukaan 2 m + ambang atas) · p = 1 bukaan polos (tanpa pilar; ujung tembok ber-pilaster)
// Poligon tabrakan hanya memakai pts / x, y, r / h / z0 — TIDAK ADA door, stair, atau floor (tembok tidak bisa dipijak).
const M = 0.1;
export const WALL = { H: 2.2, CAP: 2.32, T: 0.17, POST_H: 2.56, POST_R: 0.3, PIECE: 24, POST_EVERY: 4.5, PILLAR: 0.76, K0_H: 7.0, K1_H: 3.2, LINTEL_Z0: 2.3 };

export function wallPlan(P, opt = {}) {
  const segs = [], posts = [], deco = [], obstacles = [], gates = [];
  const box = (ax, ay, bx, by, t, h, z0 = 0) => { const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L; return { pts: [ax - uy * t, ay + ux * t, bx - uy * t, by + ux * t, bx + uy * t, by - ux * t, ax + uy * t, ay - ux * t], h, z0 }; };
  let wallM = 0, showM = 0;
  for (const Ln of P.walls || []) {
    const p = Ln.p, n = p.length >> 1, show = Ln.t === 2;
    let acc = 0;
    for (let i = 0; i + 1 < n; i++) {
      const ax = p[2 * i] * M, ay = p[2 * i + 1] * M, bx = p[2 * i + 2] * M, by = p[2 * i + 3] * M, L = Math.hypot(bx - ax, by - ay);
      if (L < 0.05) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L, k = Math.ceil(L / WALL.PIECE);
      for (let q = 0; q < k; q++) {
        const s0 = L * q / k, s1 = L * (q + 1) / k, x0 = ax + ux * s0, y0 = ay + uy * s0, x1 = ax + ux * s1, y1 = ay + uy * s1;
        segs.push({ ax: x0, ay: y0, bx: x1, by: y1, ux, uy, t: Ln.t | 0 });
        if (show) continue; // t = 2: tembok tampilan di garis batas kawasan (di luar jangkauan pemain) — tanpa tabrakan
        obstacles.push(box(x0 - ux * WALL.T, y0 - uy * WALL.T, x1 + ux * WALL.T, y1 + uy * WALL.T, WALL.T, WALL.CAP)); // diperpanjang 0,17 m di kedua ujung: belokan rapat
      }
      // pilaster padat di tiap belokan & kedua ujung garis; pilaster hias (tanpa tabrakan) tiap ±4,5 m
      if (show) { if (i === 0) deco.push({ x: ax, y: ay, ux, uy }); deco.push({ x: bx, y: by, ux, uy }); }
      else { if (i === 0) { posts.push({ x: ax, y: ay, ux, uy }); obstacles.push({ x: ax, y: ay, r: WALL.POST_R, h: WALL.POST_H, z0: 0 }); }
        posts.push({ x: bx, y: by, ux, uy }); obstacles.push({ x: bx, y: by, r: WALL.POST_R, h: WALL.POST_H, z0: 0 }); }
      for (let d = WALL.POST_EVERY - (acc % WALL.POST_EVERY); d < L - 1.2; d += WALL.POST_EVERY) if (d > 1.2) deco.push({ x: ax + ux * d, y: ay + uy * d, ux, uy });
      acc += L; if (show) showM += L; else wallM += L;
    }
  }
  for (const g of P.gates || []) {
    if (g.k === undefined) continue; // gapura format lama (tembok sayap wl/wr): ditangani envprops.js
    const x = g.x * M, y = g.y * M, a = g.a / 10 * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, half = g.h * M, G = { x, y, ux, uy, nx, ny, half, w: g.w * M, k: g.k, n: g.n, plain: !!g.p, deco: !!g.deco };
    gates.push(G);
    if (G.plain) continue;
    if (g.k === 1 || (g.k === 0 && opt.k0)) { // pilar di kedua tepi jalan (gapura utama: tabrakannya dibuat envprops.js bersama baloknya)
      const hh = g.k === 0 ? WALL.K0_H : WALL.K1_H;
      for (const sd of [1, -1]) { const px = x + nx * sd * half, py = y + ny * sd * half, c = WALL.PILLAR; obstacles.push({ pts: [px - ux * c - nx * c, py - uy * c - ny * c, px + ux * c - nx * c, py + uy * c - ny * c, px + ux * c + nx * c, py + uy * c + ny * c, px - ux * c + nx * c, py - uy * c + ny * c], h: hh, z0: 0 }); }
    } else if (g.k === 3) obstacles.push(box(x - nx * half, y - ny * half, x + nx * half, y + ny * half, WALL.T, WALL.POST_H, WALL.LINTEL_Z0)); // ambang atas: hanya menahan peluru
  }
  return { segs, posts, deco, obstacles, gates, wallM, showM };
}
