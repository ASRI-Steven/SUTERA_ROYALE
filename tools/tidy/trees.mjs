// Tahap trees (T4/M4): tanam ulang semua pohon → D.trees (dm, stride 4: x, y, kelas ukuran, jenis 0 rindang / 1 palem /
// 2 cemara). Menggantikan hasil plant_trees di tools/build_map.py, yang menanam deret tanpa melihat rumah.
//   P1 jalan umum   deret dua sisi tiap 12 m di jalur hijau (lebar/2 + trotoar + 1,3 m), satu jenis per jalan
//   P2 jalan lokal  hanya di tempat yang lolos zona fasad: celah antar-kavling, ujung deret, sisi tanpa fasad; ≥ 10 m
//                   di dekat rumah (≤ P2_HOME m), ≥ P2_STEP_OPEN m di ruas tanpa rumah
//   P3 taman/hijau  kisi ber-jitter per jenis lahan hijau
//   P4 ruang sisa   di dalam kompleks bertembok: ≥ 4 m dari gedung, 1 per ±P4_AREA m², pohon kecil
// Zona bebas memakai penjaga yang sama dengan game (treeGuard di web/map/trees.js: Z1 fasad, Z2 dinding, Z5 gerbang,
// Z6 tembok) + Z3 trotoar, Z4 simpang, Z7 air/gedung, Z8 jarak antar pohon, dan menjauhi benda lingkungan (envprops
// membuang benda yang menumpuk pohon). Sesudah ditanam, cleanTrees yang asli dijalankan pada salinan: harus tidak
// menggeser/membuang satu pohon pun (titik tetap), kalau tidak tahap ini gagal.
import fs from 'node:fs';
import { M, toPts, bbox, Grid, pip, ptSeg, UMUM, LOKAL, SIDEWALK } from './geom.mjs';

export const TP = {
  P1_STEP: 12, P1_OFF: 1.3, P2_STEP: 10, P2_STEP_OPEN: 70, P2_HOME: 9, P2_OFF: 0.9, P2_SCAN: 1, P4_AREA: 3000, P4_BLD: 4.0, P4_WALL: 1.5,
  Z3_WALK: 0.6, Z3_SERV: 1.9, Z3_NARROW: 3.0, Z4_PUB: 10, Z4_LOCAL: 6, Z7_WATER: 0.8, Z8_ROW: 5, Z8_FREE: 4, PROP_PAD: 0.45,
  GREEN: { forest: [8, 0.45], park: [13, 0.2], golf: [22, 0.1], grass: [18, 0.1], cemetery: [14, 0.5] }, GREEN_FILL: 0.8,
};
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export async function stageTrees(D, log, warnings) {
  const { treeGuard, cleanTrees } = await import(new URL('../../web/map/trees.js', import.meta.url).href);
  const G = treeGuard(D), R = D.roads, bd = toPts(D.boundary), inArea = (x, y) => pip(x, y, bd);
  // ---- jalan: Z3 (trotoar) & Z4 (simpang)
  const roads = R.r.map((r, i) => { const cls = D.classes[R.c[i]]; return { i, cls, kind: UMUM.has(cls) ? 'U' : LOKAL.has(cls) ? 'L' : 'S', line: toPts(r), w: R.w[i] * M, s: R.s ? R.s[i] * M : (SIDEWALK[cls] || 0) }; }).filter((r) => r.line.length >= 2);
  const RG = new Grid(40);
  for (const r of roads) for (let k = 0; k + 1 < r.line.length; k++) { const [a, b] = [r.line[k], r.line[k + 1]]; RG.add([r, k], Math.min(a[0], b[0]) - 14, Math.min(a[1], b[1]) - 14, Math.max(a[0], b[0]) + 14, Math.max(a[1], b[1]) + 14); }
  // jalan lokal yang disempitkan T1 (trotoar 0 = lorong antar-fasad): tanpa pohon ≤ Z3_NARROW m dari tepi aspalnya (P2 rancangan)
  const narrowOk = (x, y) => { for (const [r, k] of RG.query(x, y, x, y)) { if (r.kind !== 'L' || r.s > 0) continue; if (ptSeg(x, y, r.line[k][0], r.line[k][1], r.line[k + 1][0], r.line[k + 1][1]) - r.w / 2 < TP.Z3_NARROW) return false; } return true; };
  const roadOk = (x, y) => { for (const [r, k] of RG.query(x, y, x, y)) { const d = ptSeg(x, y, r.line[k][0], r.line[k][1], r.line[k + 1][0], r.line[k + 1][1]) - r.w / 2; if (d < (r.kind === 'S' || r.cls.startsWith('motorway') ? TP.Z3_SERV : Math.max(r.s + TP.Z3_WALK, 1.25))) return false; } return true; };
  const deg = new Map();
  for (const r of roads) { if (r.kind === 'S' || r.cls.startsWith('motorway')) continue; const raw = R.r[r.i], n = raw.length >> 1; for (let j = 0; j < n; j++) { const k = raw[2 * j] + ',' + raw[2 * j + 1], e = deg.get(k) || { d: 0, U: false, x: raw[2 * j] * M, y: raw[2 * j + 1] * M }; e.d += j === 0 || j === n - 1 ? 1 : 2; if (r.kind === 'U') e.U = true; deg.set(k, e); } }
  const JG = new Grid(40); for (const j of deg.values()) if (j.d >= 3) JG.add(j, j.x - 10.2, j.y - 10.2, j.x + 10.2, j.y + 10.2);
  const juncOk = (x, y) => { for (const j of JG.query(x, y, x, y)) if (Math.hypot(j.x - x, j.y - y) <= (j.U ? TP.Z4_PUB : TP.Z4_LOCAL) + 0.06) return false; return true; };
  // ---- kanopi (jenis 5: penjaga membolehkan pohon di dekatnya, tapi tidak di dalamnya)
  const CG = new Grid(40); D.buildings.r.forEach((r, i) => { if (D.buildings.k[i] !== 5 || r.length < 6) return; const p = toPts(r), b = bbox(p); CG.add(p, b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1); });
  const canopyOk = (x, y) => { for (const p of CG.query(x, y, x, y)) if (pip(x, y, p)) return false; return true; };
  // ---- benda lingkungan (raw): jari-jari tabrakan per jenis dari manifest model
  const PG = new Grid(20); let nProps = 0;
  if (D._props) {
    const Pr = D._props, ST = Pr.meta.stride || 6;
    let man = {}; try { man = JSON.parse(fs.readFileSync(new URL('../../web/game/assets/env/envprops.json', import.meta.url), 'utf8')).types; } catch (e) { warnings.push('trees: manifest benda tidak terbaca, jari-jari bawaan 1 m'); }
    const rad = (k) => { let r = 0.3; for (const c of (man[k] && man[k].col) || []) { if (c.z0 > 1.9) continue; if (c.c) r = Math.max(r, Math.hypot(c.c[0], c.c[1]) + c.c[2]); else if (c.b) r = Math.max(r, Math.hypot(c.b[0], c.b[1]) + Math.hypot(c.b[2], c.b[3]) / 2); } return man[k] ? r : 1.0; };
    for (const [k, arr] of Object.entries(Pr.t)) { if (k === 'guard' || k === 'boom') continue; const r = rad(k) + 0.3 + TP.PROP_PAD; for (let i = 0; i + ST - 1 < arr.length; i += ST) { if (arr[i + 4] >= 5) continue; const x = arr[i] * M, y = arr[i + 1] * M; PG.add([x, y, r], x - r, y - r, x + r, y + r); nProps++; } }
    for (const key of ['fences', 'hoards']) for (const F of Pr[key] || []) { const p = toPts(F.p); for (let i = 0; i + 1 < p.length; i++) PG.add([p[i], p[i + 1], 1.0], Math.min(p[i][0], p[i + 1][0]) - 1, Math.min(p[i][1], p[i + 1][1]) - 1, Math.max(p[i][0], p[i + 1][0]) + 1, Math.max(p[i][1], p[i + 1][1]) + 1); }
  }
  const propOk = (x, y) => { for (const q of PG.query(x, y, x, y)) { if (q.length === 3 && typeof q[0] === 'number') { if (Math.hypot(q[0] - x, q[1] - y) < q[2]) return false; } else if (ptSeg(x, y, q[0][0], q[0][1], q[1][0], q[1][1]) < q[2]) return false; } return true; };
  // ---- pos satpam & palang gerbang baru berdiri di sisi dalam gerbang k0/k1: sisakan tapaknya (tools/tidy/derive.mjs)
  const gateBox = (D.walls ? D.walls.gates : []).filter((g) => g.k <= 1).map((g) => { const a = g.a / 10 * Math.PI / 180; return { x: g.x * M, y: g.y * M, ux: Math.cos(a), uy: Math.sin(a), w: g.w * M }; });
  const GB = new Grid(40); for (const g of gateBox) GB.add(g, g.x - 18, g.y - 18, g.x + 18, g.y + 18);
  const guardOk = (x, y) => { for (const g of GB.query(x, y, x, y)) { const lon = (x - g.x) * g.ux + (y - g.y) * g.uy, lat = Math.abs(-(x - g.x) * g.uy + (y - g.y) * g.ux); if (lon > -1 && lon < 14.5 && lat < g.w / 2 + 5.2) return false; } return true; };
  // ---- tanam
  const TG = new Grid(8), trees = [], by = { P1: 0, P2: 0, P3: 0, P4: 0 }, rej = {};
  const near = (x, y, r) => { for (const t of TG.query(x - r, y - r, x + r, y + r)) if (Math.hypot(t[0] - x, t[1] - y) < r) return true; return false; };
  const plant = (x0, y0, k, sp, gap, src) => {
    const x = Math.round(x0 / M) * M, y = Math.round(y0 / M) * M; // nilai yang akan ditulis (dm)
    const why = !inArea(x, y) ? 'luar' : G.viol(x, y, G.treeWall(sp)) || (G.blockedBy(x, y, 0.85) ? 'gedung/air' : null) || (!canopyOk(x, y) ? 'kanopi' : null) || (!roadOk(x, y) ? 'z3' : null) || (!narrowOk(x, y) ? 'sempit' : null) || (G.road(x, y).wet < TP.Z7_WATER ? 'sungai' : null)
      || (!juncOk(x, y) ? 'z4' : null) || (!propOk(x, y) ? 'benda' : null) || (!guardOk(x, y) ? 'pos' : null) || (near(x, y, gap) ? 'z8' : null);
    if (why) { rej[src + ':' + why] = (rej[src + ':' + why] || 0) + 1; return false; }
    const t = [x, y, k, sp]; trees.push(t); TG.add(t, x, y, x, y); by[src]++; return true;
  };
  // P1 + P2: menyusuri tiap sisi jalan
  for (const r of roads) {
    if (r.kind === 'S' || r.cls.startsWith('motorway')) continue;
    const pub = r.kind === 'U', off = r.w / 2 + r.s + (pub ? TP.P1_OFF : TP.P2_OFF), step = pub ? TP.P1_STEP : TP.P2_STEP, scan = pub ? TP.P1_STEP : TP.P2_SCAN;
    const sp = pub ? (r.cls === 'tertiary' ? 0 : 1) : 0, kRow = pub ? 1 + Math.floor(hash(r.i, 7) * 2) : -1;
    for (const side of [1, -1]) {
      let d = hash(r.i, side) * step, last = -1e9, acc = 0;
      for (let k = 0; k + 1 < r.line.length; k++) {
        const a = r.line[k], b = r.line[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        for (; d < L; d += scan) {
          if (!pub && acc + d - last < step) continue;
          const x = a[0] + ux * d - uy * off * side, y = a[1] + uy * d + ux * off * side;
          if (!pub && acc + d - last < TP.P2_STEP_OPEN && !G.blockedBy(x, y, TP.P2_HOME)) continue; // jauh dari rumah: deret jarang
          const kk = pub ? kRow : Math.floor(hash(x, y) * 3);
          if (plant(x, y, kk, sp, pub ? TP.Z8_ROW : TP.Z8_ROW, pub ? 'P1' : 'P2')) last = acc + d;
        }
        d -= L; acc += L;
      }
    }
  }
  // P3: lahan hijau
  (D.green.r || []).forEach((ring, gi) => {
    const gt = D.greenTypes[D.green.t[gi]], cfg = TP.GREEN[gt]; if (!cfg) return;
    const [step, conifer] = cfg, p = toPts(ring), b = bbox(p);
    for (let y = b[1] + step / 2; y < b[3]; y += step) for (let x = b[0] + step / 2; x < b[2]; x += step) {
      const jx = (hash(x, y) - 0.5) * step * 0.8, jy = (hash(y + 3, x - 5) - 0.5) * step * 0.8, px = x + jx, py = y + jy;
      if (!pip(px, py, p) || hash(x * 1.7, y * 0.3) >= TP.GREEN_FILL) continue;
      plant(px, py, Math.floor(hash(px, py) * 3), hash(x - 11, y + 2) < conifer ? 2 : 0, TP.Z8_FREE, 'P3');
    }
  });
  // P4: ruang sisa di dalam kompleks
  if (D.walls) {
    const st = Math.sqrt(TP.P4_AREA), lines = []; for (const L of D.walls.lines) { const q = toPts(L.p); for (let i = 0; i + 1 < q.length; i++) lines.push([q[i], q[i + 1]]); }
    const LG = new Grid(30); for (const s of lines) LG.add(s, Math.min(s[0][0], s[1][0]) - 2, Math.min(s[0][1], s[1][1]) - 2, Math.max(s[0][0], s[1][0]) + 2, Math.max(s[0][1], s[1][1]) + 2);
    const wallOk = (x, y) => { for (const s of LG.query(x, y, x, y)) if (ptSeg(x, y, s[0][0], s[0][1], s[1][0], s[1][1]) < TP.P4_WALL) return false; return true; };
    for (const c of D.walls.compounds) { const p = toPts(c.r), b = bbox(p);
      for (let y = b[1] + st / 2; y < b[3]; y += st) for (let x = b[0] + st / 2; x < b[2]; x += st) {
        // beberapa percobaan per petak: tempat lapang di dalam kompleks jarang
        for (let tr = 0; tr < 6; tr++) { const px = x + (hash(x + tr, y) - 0.5) * st * 0.9, py = y + (hash(y, x + tr * 3) - 0.5) * st * 0.9;
          if (!pip(px, py, p) || !wallOk(px, py) || G.blockedBy(px, py, TP.P4_BLD)) continue;
          if (plant(px, py, 0, hash(px, py * 2) < 0.25 ? 2 : 0, TP.Z8_FREE + 2, 'P4')) break; }
      } }
  }
  // ---- tulis + uji titik tetap dengan cleanTrees yang asli
  const flat = []; for (const [x, y, k, sp] of trees) flat.push(Math.round(x / M), Math.round(y / M), k, sp);
  const C = { ...D, trees: flat.slice(), meta: { ...D.meta, treeStride: 4, treesClean: undefined, layout: { stages: ['trees'] } } };
  const cs = cleanTrees(C), lost = cs.before - cs.after + cs.moved + cs.shifted;
  if (lost) warnings.push(`trees: cleanTrees masih mengubah ${lost} pohon (${JSON.stringify(cs)})`);
  let pos = 0; for (let i = 0; i < flat.length && i < C.trees.length; i += 4) if (flat[i] !== C.trees[i] || flat[i + 1] !== C.trees[i + 1]) pos++;
  if (pos) warnings.push(`trees: ${pos} posisi berubah sesudah cleanTrees`);
  D.trees = lost || pos ? flat : C.trees; // kelas ukuran sudah diperkecil di tempat sempit (Z2)
  D.meta.treeStride = 4;
  const out = { n: trees.length, ...by, jenis: [0, 1, 2].map((s) => trees.filter((t) => t[3] === s).length), props: nProps, shrinked: cs.shrinked, semak: cs.shrubs, tolak: rej, clean: { lost, pos } };
  log('trees:', JSON.stringify(out));
  return out;
}
