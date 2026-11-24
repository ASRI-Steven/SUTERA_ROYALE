#!/usr/bin/env node
// Perapi tata letak kawasan (node ≥ 18, tanpa dependensi). Rancangan: docs/rancangan/2026-11-24/tataletak.md.
//
//   node tools/tidy_layout.mjs data/build/alsut-map.raw.json web/data/alsut-map.json \
//        [--stages roads,buildings[,walls]] [--props <masuk> <keluar>] [--context <masuk> <keluar>] [--allow-warn]
//
// Masukan = keluaran tools/build_map.py yang BELUM dirapikan (ditolak bila sudah ber-meta.layout). Tahap:
//   roads     T1: lebar jalan lokal/servis dipaskan ke lorong antar-fasad (roads.s = trotoar per jalan, dm); jalan servis
//             yang menembus gedung besar/bukan rumah dipotong (potongan baru di BELAKANG larik)
//   buildings T2: gedung menjauhi jalan & air: geser (flag 32) → pangkas (flag 16) → buang (flag 8, cincin kosong)
//   walls     T3: kompleks perumahan, tembok keliling, gerbang jalan, pintu pejalan kaki → D.walls
//   trees     T4: tanam ulang pohon (P1 jalan umum, P2 jalan lokal, P3 taman) → D.trees
// Indeks gedung & jalan tidak pernah berubah. --props / --context: salinan siap-gambar & saringan lapisan sekitar
// (dipakai juga sesudah tools/build_props.py / build_context.py dijalankan ulang dari ekstrak OSM).
import fs from 'node:fs';
import { stageRoads, stageBuildings, checkBuildings, P as LP } from './tidy/layout.mjs';

const args = process.argv.slice(2), pos = [], opt = { stages: 'roads,buildings' } // bawaan = tahap yang sudah lolos audit (M2); walls masih draf (M3), trees belum ada (M4);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--stages') opt.stages = args[++i];
  else if (args[i] === '--props') opt.props = [args[++i], args[++i]];
  else if (args[i] === '--context') opt.context = [args[++i], args[++i]];
  else if (args[i] === '--allow-warn') opt.allowWarn = true;
  else pos.push(args[i]);
}
if (pos.length < 2) { console.error('pakai: node tools/tidy_layout.mjs <raw.json> <keluar.json> [--stages a,b] [--props in out] [--context in out] [--allow-warn]'); process.exit(2); }
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const D = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
if (D.meta.layout) { console.error('masukan sudah dirapikan (meta.layout ada) — pakai berkas raw'); process.exit(2); }
const stages = new Set(opt.stages.split(',').filter(Boolean)), counts = {}, warnings = [];
const params = { layout: LP };

if (stages.has('roads')) counts.roads = stageRoads(D, log);
if (stages.has('buildings')) { const c = stageBuildings(D, log); counts.buildings = c; }
if (stages.has('walls')) {
  // gapura lama (benda lingkungan raw) = petunjuk letak gapura utama (simpul barrier OSM)
  if (opt.props) { const Pr = JSON.parse(fs.readFileSync(opt.props[0], 'utf8')); D._oldGates = (Pr.gates || []).map((g) => ({ x: g.x * 0.1, y: g.y * 0.1, name: g.n >= 0 ? Pr.names[g.n] : '' })); }
  { const { doorLoader } = await import('./tidy/doors.mjs'); const fn = await doorLoader(); D._doorsFn = () => fn(D); D._doors = D._doorsFn(); log('walls: pintu luar + bagian luar gedung (planHomes/createCollider)', D._doors.filter((d) => !d.p).length, '+', D._doors.filter((d) => d.p).length); }
  const { stageWalls, WP } = await import('./tidy/walls.mjs'); params.walls = WP; counts.walls = stageWalls(D, log, warnings); }
if (stages.has('trees')) { if (!fs.existsSync(new URL('./tidy/trees.mjs', import.meta.url))) { console.error('tahap trees (M4) belum dibuat'); process.exit(2); } const { stageTrees, TP } = await import('./tidy/trees.mjs'); params.trees = TP; counts.trees = stageTrees(D, log, warnings); }

delete D._oldGates; delete D._doors; delete D._doorsFn;
const bad = checkBuildings(D);
for (const b of bad) warnings.push(`gedung ${b[0]} masih ${b[2]} m dari as jalan ${b[1]}`);
D.meta.layout = { v: 1, stages: [...stages], params, counts, warnings };
D.meta.counts.roads = D.roads.r.length;
if (D.trees && stages.has('trees')) D.meta.counts.trees = Math.floor(D.trees.length / (D.meta.treeStride || 4));
fs.writeFileSync(pos[1], JSON.stringify(D));
log('tulis', pos[1], (fs.statSync(pos[1]).size / 1024).toFixed(0) + ' KB', 'peringatan:', warnings.length);
if (opt.props || opt.context) {
  const X = await import('./tidy/derive.mjs');
  if (opt.props) X.deriveProps(D, opt.props[0], opt.props[1], log);
  if (opt.context) X.deriveContext(D, opt.context[0], opt.context[1], log);
}
if (bad.length && !opt.allowWarn) { console.error(`GAGAL: ${bad.length} pelanggaran jarak gedung–jalan tersisa (lihat meta.layout.warnings; --allow-warn untuk tetap lulus)`); process.exit(1); }
