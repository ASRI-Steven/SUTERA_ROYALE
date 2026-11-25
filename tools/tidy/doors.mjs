// Pintu luar & bagian luar gedung menurut game itu sendiri (planHomes di web/map/interiors.js + createCollider di
// web/map/collide.js), supaya tembok tidak pernah berdiri di depan pintu, di bawah kanopi, atau menembus tangga/teras.
// Modul game mengimpor 'three' hanya untuk gambar; di node diganti rintisan lewat kait pemuat.
import { register } from 'node:module';
import { M, pip, ptPoly, toPts } from './geom.mjs';

export async function doorLoader() {
  const stub = 'data:text/javascript,' + encodeURIComponent('export default {};export class Vector3{};export class Color{constructor(){}};');
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three' || s.startsWith('three/')) return { url: ${JSON.stringify(stub)}, shortCircuit: true }; return n(s, c); }`));
  const I = await import(new URL('../../web/map/interiors.js', import.meta.url).href);
  const K = await import(new URL('../../web/map/collide.js', import.meta.url).href);
  // → [{ x, y, bi }] pintu luar · [{ bi, p }] poligon bagian gedung di luar tapaknya (kanopi, tiang, tangga luar, teras, emper)
  return (D) => {
    const C = structuredClone({ ...D, _oldGates: undefined, _doors: undefined, _doorsFn: undefined, _doorUse: undefined, _badDoors: undefined }); // fitHouseHeights mengubah tinggi: jangan sentuh data yang akan ditulis
    I.fitHouseHeights(C);
    const homes = I.planHomes(C), out = [], bd = toPts(C.boundary), inArea = (x, y) => pip(x, y, bd);
    for (const H of homes.values()) {
      for (const d of H.doors) if (!d.inner && !d.bath) out.push({ x: d.x, y: d.y, bi: H.i });
      for (const c of H.canopies || []) { const e = c.e, P = (s, v) => [e.a[0] + e.ux * s - e.nx * v, e.a[1] + e.uy * s - e.ny * v]; out.push({ bi: H.i, p: [P(c.s0, 0), P(c.s1, 0), P(c.s1, c.d + 0.3), P(c.s0, c.d + 0.3)] }); }
    }
    const col = K.createCollider(C, inArea, homes), foot = new Map();
    for (const G of col.polys) {
      if (!(G.b >= 0) || !(G.z0 === 0 || G.slab) || !G.pts || G.pts.length < 6) continue;
      let fp = foot.get(G.b); if (fp === undefined) { const r = C.buildings.r[G.b]; fp = r && r.length >= 6 ? toPts(r) : null; foot.set(G.b, fp); }
      if (!fp) continue;
      const p = []; for (let i = 0; i + 1 < G.pts.length; i += 2) p.push([G.pts[i], G.pts[i + 1]]);
      if (p.every(([x, y]) => pip(x, y, fp) || ptPoly(x, y, fp) < 0.12)) continue; // seluruhnya di dalam tapak
      out.push({ bi: G.b, p });
    }
    return out;
  };
}

// Guna pintu pejalan kaki k3 menurut tabrakan game itu sendiri (createCollider + tembok/gerbang dari web/map/walls.js):
// tiap sisi ambang, banjir kisi 0,5 m (badan 0,35 m, radius 120 m) dari titik 1–2 m di depannya. "Buntu" = sisi itu tidak
// bisa menjauh ≥ 20 m, atau tidak mencapai aspal jalan dan luasnya < 1.500 m² (kantong/lorong buntu). Sama dengan audit
// pintu k3. Dipanggil sesudah tahap walls; pintu buntu dilarang lalu tembok dibangun ulang (tools/tidy/walls.mjs).
export async function doorUseLoader() {
  const I = await import(new URL('../../web/map/interiors.js', import.meta.url).href);
  const K = await import(new URL('../../web/map/collide.js', import.meta.url).href);
  const { wallPlan } = await import(new URL('../../web/map/walls.js', import.meta.url).href);
  return (D) => {
    const C = {}; for (const k of Object.keys(D)) if (!k.startsWith('_')) C[k] = structuredClone(D[k]); // fitHouseHeights mengubah tinggi: salinan
    I.fitHouseHeights(C);
    const homes = I.planHomes(C), bd = toPts(C.boundary), inArea = (x, y) => pip(x, y, bd);
    const col = K.createCollider(C, inArea, homes);
    col.addObstacles(wallPlan({ walls: D.walls.lines, gates: D.walls.gates }, { k0: true }).obstacles);
    const onRoad = (x, y) => { let hit = false; col.near(x, y, 1, (c) => { if (hit) return; for (const si of c.s) { const g = col.segs[si], dx = g.bx - g.ax, dy = g.by - g.ay, L = dx * dx + dy * dy, t = L > 0 ? Math.max(0, Math.min(1, ((x - g.ax) * dx + (y - g.ay) * dy) / L)) : 0; if (Math.hypot(x - g.ax - dx * t, y - g.ay - dy * t) < g.w / 2) { hit = true; return; } } }); return hit; };
    const CS = 0.5, R = 120; // radius 120 m: lorong panjang di belakang deret ruko yang tembus ke jalan bukan buntu
    // sisi sd (+1 = arah a) dari ambang di (gx, gy) berarah (ux, uy): buntu?
    let shut = null; // [x, y]: ambang pintu buntu yang sedang dipindai dianggap tertutup
    const deadSide = (gx, gy, ux, uy, sd) => {
      const free = new Map(), fr = (i, j) => { const k = i * 100003 + j; let v = free.get(k); if (v === undefined) { const px = i * CS, py = j * CS, al = (px - gx) * ux * sd + (py - gy) * uy * sd, lat = Math.abs(-(px - gx) * uy + (py - gy) * ux); v = Math.hypot(px - gx, py - gy) <= R && inArea(px, py) && !col.blocked(px, py, 0.35) && !(al < 0.6 && lat < 2.2 && al > -1.5) && !(shut && Math.hypot(px - shut[0], py - shut[1]) < 1.8) ? 1 : 0; free.set(k, v); } return v; };
      let far = 0, n = 0, road = 0; const seen = new Set(), q = [];
      for (const d0 of [1.0, 1.5, 2.0]) for (const l0 of [0, 0.5, -0.5]) { const i = Math.round((gx + ux * sd * d0 - uy * l0) / CS), j = Math.round((gy + uy * sd * d0 + ux * l0) / CS); if (fr(i, j) && !seen.has(i * 100003 + j)) { seen.add(i * 100003 + j); q.push([i, j]); } }
      while (q.length) { const [i, j] = q.pop(); n++; if (!road && onRoad(i * CS, j * CS)) road = 1; far = Math.max(far, Math.hypot(i * CS - gx, j * CS - gy)); if (road && far >= 20) return false; if (!road && n * CS * CS >= 1500 && far >= 20) return false; for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (i + da) * 100003 + j + db; if (!seen.has(k) && fr(i + da, j + db)) { seen.add(k); q.push([i + da, j + db]); } } }
      return far < 20 || (!road && n * CS * CS < 1500);
    };
    const dead = (x, y, ux, uy) => deadSide(x, y, ux, uy, 1) || deadSide(x, y, ux, uy, -1);
    const bad = [];
    for (const g of D.walls.gates) { if (g.k !== 3) continue;
      const gx = g.x * M, gy = g.y * M, a = g.a / 10 * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      if (!dead(gx, gy, ux, uy)) continue;
      bad.push([+gx.toFixed(1), +gy.toFixed(1)]);
      // pindai tembok kompleks yang sama ±70 m tiap 2 m: semua titik yang juga buntu ikut dilarang (satu lorong panjang
      // tidak dicoba ulang 5 m demi 5 m)
      shut = [gx, gy];
      for (const L of D.walls.lines) { if (L.c !== g.c || L.t === 2) continue; const p = L.p; let acc = 0;
        for (let j = 0; j + 3 < p.length; j += 2) { const ax = p[j] * M, ay = p[j + 1] * M, bx = p[j + 2] * M, by = p[j + 3] * M, len = Math.hypot(bx - ax, by - ay); if (len < 1e-6) continue; const tx = (bx - ax) / len, ty = (by - ay) / len;
          for (let s = (2 - acc % 2) % 2; s < len; s += 2) { const x = ax + tx * s, y = ay + ty * s; if (Math.hypot(x - gx, y - gy) > 70) continue; if (dead(x, y, -ty, tx)) bad.push([+x.toFixed(1), +y.toFixed(1), 1]); }
          acc += len; } }
      shut = null;
    }
    return bad;
  };
}
