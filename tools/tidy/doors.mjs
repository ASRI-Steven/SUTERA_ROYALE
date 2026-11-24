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
    const C = structuredClone({ ...D, _oldGates: undefined, _doors: undefined, _doorsFn: undefined }); // fitHouseHeights mengubah tinggi: jangan sentuh data yang akan ditulis
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
