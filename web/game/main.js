// SUTERA ROYALE: battle royale orisinal di peta 3D Alam Sutera. 1 pemain vs 50 bot (tingkat mudah).
// Alur: menu → pesawat melintas → terjun & payung → jarah → zona menyusut → yang terakhir hidup menang.
import * as THREE from 'three';
import { buildWorld, SKY, pip, M } from '../map/world.js';
import { addContext } from '../map/context.js';
import { createGrass } from '../map/grass.js';
import { planHomes, createInteriors } from '../map/interiors.js';
import { loadCharacterParts, setCharacterParts, addGearParts, setCharacterEnv } from '../map/rig.js';
import { gunGeometry, loadWeaponModels } from './weapons.js';
import { loadPropModels } from './loot.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCollider } from '../map/collide.js';
import { loadEnvProps, createEnvProps } from '../map/envprops.js';
import { makeMapImage, BigMap } from '../map/mapview.js';
import { WEAPONS, createEffects, spreadDir, falloff } from './weapons.js';
import { createZone } from './zone.js';
import { createBorder } from './border.js';
import { createLoot, bagWeight, bagCap, armorHp, armorPct } from './loot.js';
import { createBots, DIFFICULTY } from './bots.js';
import { createPlayer } from './player.js';
import { createHud } from './hud.js';
import { createVehicles, createParticles } from './vehicles.js';
import { createNades } from './nades.js';
import * as audio from './audio.js';
import { loadRealism, useHemisphereAmbientOnly, useCheapShadowFilter, createDynShadow } from '../map/realism.js';
import { createPostFX, TIERS } from './postfx.js';
import { createGovernor } from './governor.js';
import { matchHooks } from './hooks.js';
import { initSkins } from './skins.js';
import { createKillFx } from './killfx.js';
import { createLobby } from './lobby.js';
import { profile, partySlots } from './profile.js';

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180, BOTS = 99, TEAM = 4, ALT = 620, PLANE_SPEED = 85; // 100 petarung = 25 regu berisi 4 (pemain + 3 bot rekan, 24 regu bot)
const DOWNS = true; // tumbang & dipulihkan rekan + menonton rekan setelah tersingkir (false = tersingkir langsung)
const DOWN_HP = 100, REVIVE_HP = 20, BLEED = [30, 22, 14], REVIVE_T = 5, REVIVE_R = 2.0; // tumbang: darah habis dalam 30/22/14 dtk (makin sering makin cepat); pulihkan: tahan 5 dtk dalam 2 m
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function loadStep(p, text) { $('loaderBar').style.width = p + '%'; if (text) $('loaderText').textContent = text; }
function fail(msg) { $('loaderText').textContent = msg; $('loader').classList.add('error'); }

// Laju layar diukur selagi memuat (rAF tanpa menggambar): selang terpendek yang konsisten = selang refresh layar.
// Pengatur kualitas (governor.js) memakainya sebagai sasaran sejak frame pertama.
const refreshProbe = (() => {
  const d = [];
  let last = 0, on = true;
  const f = (t) => { if (last) d.push(t - last); last = t; if (on && d.length < 2000) requestAnimationFrame(f); };
  requestAnimationFrame(f);
  return { stop() { on = false; d.sort((a, b) => a - b); return d.length >= 30 ? d[Math.floor(d.length * 0.1)] : 0; } };
})();
boot();
async function boot() {
  loadStep(6, 'Memuat peta Alam Sutera…');
  // model karakter Blender dimuat paralel dengan peta (maks. 6 dtk; kalau gagal pakai karakter prosedural)
  const partsP = Promise.race([loadCharacterParts().then(setCharacterParts), new Promise((r) => setTimeout(r, 6000))]).catch((e) => console.warn('Model karakter tidak dimuat:', e.message));
  const gunsP = Promise.race([loadWeaponModels(), new Promise((r) => setTimeout(r, 6000))]).catch((e) => console.warn('Model senjata tidak dimuat, pakai model prosedural:', e.message));
  const propsP = Promise.race([loadPropModels(), new Promise((r) => setTimeout(r, 6000))]).catch(() => { /* barang prosedural */ });
  // mode realistis: langit HDR + tekstur foto (maks. 40 dtk; kalau gagal/terlalu lama, tampilan lama yang dipakai)
  const realP = Promise.race([loadRealism(), new Promise((r) => setTimeout(() => r(null), 40000))]).catch((e) => { console.warn('Mode realistis tidak aktif:', e.message); return null; });
  // benda lingkungan kota (menara, lampu jalan, halte, gerbang, reklame, …): maks. 15 dtk; kalau gagal, kota tanpa benda tambahan
  const envP = Promise.race([loadEnvProps(), new Promise((r) => setTimeout(() => r(null), 15000))]).catch((e) => { console.warn('Benda lingkungan tidak dimuat:', e.message); return null; });
  let D;
  try {
    const res = await fetch('data/alsut-map.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    D = await res.json();
  } catch (e) { fail('Data peta gagal dimuat (' + e.message + ').'); return; }
  await Promise.all([partsP, gunsP, propsP]);
  loadStep(18, 'Memuat langit & tekstur…');
  const real = await realP;
  const env = await envP;
  // model tiap senjata di tangan karakter (orang ketiga & bot); model senjata menghadap −Z, rig menghadap +Z
  addGearParts(Object.keys(WEAPONS).map((k) => ({ gear: 'gun_' + k, bone: 'gun', geo: gunGeometry(k).rotateY(Math.PI) })));
  loadStep(25, 'Menyusun kota…');
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try { start(D, real, env); } catch (e) { console.error(e); fail('Game gagal disiapkan: ' + e.message); }
}

function start(D, realAssets, envAssets) {
  let W;
  if (realAssets) useHemisphereAmbientOnly(); // cahaya sekitar dari HemisphereLight untuk semua material (pantulan lingkungan tetap)
  if (realAssets) useCheapShadowFilter(); // bayangan matahari: 8 ambilan tekstur per piksel, bukan 16
  try { W = buildWorld(D, { host: $('scene'), progress: loadStep, game: true, real: realAssets }); } catch (e) { // game: tanah sampai cakrawala
    if (e.message === 'WEBGL') { fail('Perangkat ini tidak mendukung WebGL.'); return; }
    throw e;
  }
  addContext(W).catch((e) => console.warn('Lingkungan sekitar gagal dimuat:', e)); // kota sekitar (visual, di luar area main)
  const { renderer, scene, camera, sun, hemi, skyUni, skyU, cloudMat, stars, sunDisc, sky, nightU, lamps, lineMat, goldEdge, inArea, bb, center, V2 } = W;
  // nama lokasi di bawah kompas: cluster tempat berdiri, kalau tidak ada tempat terkenal terdekat
  const clusterRings = D.clusters.map((c) => V2(c.r));
  function placeAt(x, y) {
    for (let i = 0; i < clusterRings.length; i++) if (pip(x, y, clusterRings[i])) return D.clusters[i].name;
    let bd = 220, bp = null;
    for (const p of D.pois) { const d = Math.hypot(p.x * M - x, p.y * M - y); if (d < bd) { bd = d; bp = p; } }
    return bp ? (bd < 60 ? bp.name : 'Dekat ' + bp.name) : (inArea(x, y) ? D.meta.name : '');
  }
  let placeT = 0, placeName = '';
  loadStep(86, 'Menyebar senjata & bot…');
  // ---------- Langit sore cerah, kabut, kamera FPS ----------
  const R = W.real; // mode realistis aktif? (langit foto menentukan arah & warna matahari)
  const sunDir = R ? R.sunDir.clone() : new THREE.Vector3(Math.sin(245 * D2R) * Math.cos(36 * D2R), Math.sin(36 * D2R), -Math.cos(245 * D2R) * Math.cos(36 * D2R)).normalize();
  const [top, horizon0, sunCol, kSun, kSky] = SKY.day;
  const horizon = R ? '#' + R.horizon.clone().convertLinearToSRGB().getHexString() : horizon0;
  if (!R) { sun.color.setHex(sunCol); sun.intensity = kSun; hemi.intensity = kSky; }
  scene.fog.color.set(horizon); scene.fog.near = 260; scene.fog.far = 2500;
  skyUni.top.value.set(top); skyUni.horizon.value.set(horizon); skyU.value.set(top);
  if (R) skyU.value.copy(R.ambient);
  cloudMat.color.set('#ffffff'); stars.visible = false; nightU.value = 0; lamps.userData.set('day');
  goldEdge.material.emissive.set('#000000'); lineMat.opacity = 0.12;
  document.body.style.background = horizon;
  camera.fov = 75; camera.near = 0.1; camera.far = 20000; camera.updateProjectionMatrix();
  const shadowC = new THREE.Vector3(Infinity, 0, 0);
  function refreshShadows(c, half = 230) {
    // rentang kedalaman dirapatkan ke sekitar adegan (matahari 2500 m dari sasaran) supaya bias bisa kecil (±1 texel):
    // bayangan menempel di kaki dinding dan cahaya matahari yang masuk lewat jendela jatuh tepat di lantai
    const dz = half * 1.2 + 200, texel = 2 * half / sun.shadow.mapSize.x;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 2500 - dz, far: 2500 + dz });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -Math.max(0.08, texel * 0.8) / (2 * dz);
    sun.shadow.normalBias = Math.max(0.12, texel * 1.1);
    sun.target.position.copy(c).setY(0);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 2500);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
    shadowC.copy(c);
  }

  // ---------- Sistem ----------
  const homes = planHomes(D); // rumah yang bisa dimasuki (lantai dasar): pintu, sekat, perabot
  const col = createCollider(D, inArea, homes);
  const envProps = createEnvProps(W, envAssets, col); // menara SUTET/BTS, lampu jalan, tiang + kabel, halte, gerbang, reklame, dst. (map/envprops.js)
  col.addObstacles(envProps.obstacles); // sebelum kendaraan diparkir & bot bernavigasi (sel navigasi di-cache)
  const interiors = createInteriors(scene, W, homes);
  const mapImg = makeMapImage(D, bb);
  const hud = createHud();
  const zone = createZone(scene, { inArea, bb, boundary: W.boundary });
  const border = createBorder(scene, W.boundary); // tirai cahaya di tepi kawasan (terlihat hanya dari dekat)
  let borderMsgAt = -1e9;
  const loot = createLoot(scene, { D, col });
  loot.scatter(1.6, homes); // 100 bot: barang lebih banyak; sebagian di dalam rumah
  const grass = createGrass(scene, undefined, R); // ilalang: tempat bersembunyi (jongkok/tiarap)
  W.treesReady.then((r) => { if (r) grass.setClumps(['ilalang_a', 'ilalang_b', 'ilalang_c'].map((nm) => r.geos[nm + '_lod0'])); }); // rumpun dari Blender
  const agents = [];
  // kendaraan: model dimuat paralel, langsung diparkir di tepi jalan (terlihat juga dari kamera menu)
  const vehicles = createVehicles({
    scene, col, inArea, D, agents, renderer, camera,
    now: () => now,
    viewYaw: () => (player ? player.st.yaw : 0),
    hurtDriver: (a, dmg, part) => damage(a, dmg, part || 'crash', null, null),
    runOver: (a, dmg, driver, v) => damage(a, dmg, 'run', driver && driver !== a ? driver : null, { def: { short: v.def.short } }),
    explode: (x, y, h, R, maxDmg, attacker, v) => explode(x, y, h, R, maxDmg, attacker, v),
    ejectBot: (b, v) => { vehicles.exit(v, b); bots.ejected(b); },
    onBurn: () => { hud.message('Kendaraan terbakar!', 'Turun sekarang (F) sebelum meledak', 'warn'); audio.beep(true); },
  });
  vehicles.spawnAll();
  const makeAgent = (name, isPlayer) => ({
    name, isPlayer, alive: true, state: 'plane', pos: new THREE.Vector3(0, ALT, 0), vel: new THREE.Vector2(), yaw: 0, vy: 0, grounded: false, crouch: false,
    hp: 100, vest: 0, helmet: 0, bag: 0, weapons: [null, null, null], cur: -1, ammo: { light: 0, rifle: 0, shell: 0, sniper: 0, magnum: 0 }, heals: { band: 0, kit: 0, drink: 0 }, boost: 0, fuel: 0, atts: {}, nades: { frag: 0, smoke: 0 },
    kills: 0, dmg: 0, lastShot: 0, reloadEnd: 0, healEnd: 0, moveSpeed: 0, moveYaw: 0, pose: {},
    team: 0, sq: null, slot: 0, down: false, downN: 0, reviveT: 0, reviver: null, reviving: null, // regu & tumbang/pulih
  });
  const me = makeAgent('Kamu', true);
  agents.push(me);
  let diff = 'easy';
  try { const d = localStorage.getItem('royale.diff'); if (DIFFICULTY[d]) diff = d; } catch (e) { /* abaikan */ }
  let now = 0, phase = 'menu', paused = false, flight = null, waypoint = null, aliveCount = BOTS + 1, deathRank = 0, endAt = 0, startedAt = 0;
  const fx = createEffects(scene, (() => { const v = createViewModelTex(); return v; })());
  function createViewModelTex() { // tekstur kilatan moncong untuk bot (sama seperti milik pemain)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,190,80,.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }
  const kills = createKillFx({ scene, hud }); // kill pemain: spanduk beruntun, denting & partikel bertema skin senjata (game/killfx.js)

  // ---------- Pertempuran ----------
  const BLAST = { def: { short: 'Ledakan' } }, NADE_HIT = { def: { short: 'Granat' } };
  // tiarap: bola sepanjang badan yang rebah ke arah hadap [maju (m), tinggi, jari-jari, bagian]
  const SPH_PRONE = [[0.92, 0.3, 0.16, 'head'], [0.55, 0.26, 0.24, 'body'], [0.2, 0.24, 0.24, 'body'], [-0.12, 0.22, 0.22, 'body'], [-0.48, 0.17, 0.18, 'legs'], [-0.86, 0.13, 0.15, 'legs']];
  const SPH = [[1.68, 0.16, 'head', 0.44], [1.42, 0.25, 'body', 0.4], [1.18, 0.25, 'body', 0.37], [0.97, 0.24, 'body', 0.33], [0.72, 0.19, 'legs', 0.28], [0.42, 0.17, 'legs', 0.14], [0.15, 0.15, 'legs', 0]];
  function hitAgents(shooter, o, d, maxT) {
    let best = null;
    for (const a of agents) {
      if (a === shooter || !a.alive || a.state === 'plane' || a.state === 'drive' || a.team === shooter.team) continue; // pengemudi: lewat kotak kendaraan; rekan seregu: peluru lewat (tanpa tembak kawan)
      const cx = a.pos.x - o.x, cy = a.pos.y + 0.9 - o.y, cz = a.pos.z - o.z, t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0 || t > maxT + 2) continue;
      const ex = cx - d.x * t, ey = cy - d.y * t, ez = cz - d.z * t;
      if (ex * ex + ey * ey + ez * ez > 2.6) continue;
      if (a.prone) {
        const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
        for (const [f, h, r, part] of SPH_PRONE) {
          const sx = a.pos.x + fx * f - o.x, sy = a.pos.y + h - o.y, sz = a.pos.z + fz * f - o.z;
          const tc = sx * d.x + sy * d.y + sz * d.z, d2 = sx * sx + sy * sy + sz * sz - tc * tc;
          if (d2 > r * r) continue;
          const th = tc - Math.sqrt(r * r - d2);
          if (th > 0 && th < maxT && (!best || th < best.t)) best = { a, t: th, part };
        }
        continue;
      }
      const cr = a.crouch ? 1 : 0;
      for (const [h, r, part, drop] of SPH) {
        const sx = a.pos.x - o.x, sy = a.pos.y + h - drop * cr - o.y, sz = a.pos.z - o.z;
        const tc = sx * d.x + sy * d.y + sz * d.z, d2 = sx * sx + sy * sy + sz * sz - tc * tc;
        if (d2 > r * r) continue;
        const th = tc - Math.sqrt(r * r - d2);
        if (th > 0 && th < maxT && (!best || th < best.t)) best = { a, t: th, part };
      }
    }
    return best;
  }
  const sd = new THREE.Vector3(), end = new THREE.Vector3(), rayOut = { b: -2 }, gunTip = new THREE.Vector3();
  function panOf(p) { const dx = p.x - camera.position.x, dz = p.z - camera.position.z, a = Math.atan2(dx, dz) - player.st.yaw; return -Math.sin(a); }
  function fire(shooter, origin, dir, w, spreadDeg, tracerFrom) {
    const def = w.def, n = def.pellets || 1, dist = shooter.isPlayer ? 0 : camera.position.distanceTo(origin);
    const muffled = !shooter.isPlayer && dist > 3 && col.inBuilding(origin.x, -origin.z) >= 0 && col.inBuilding(camera.position.x, -camera.position.z) < 0; // dari dalam gedung
    audio.shot(def.sound, dist, shooter.isPlayer ? 0 : panOf(origin), muffled, shooter.isPlayer); // pemain: suara skin senjata
    shooter.lastShot = now;
    if (!shooter.isPlayer) { gunTip.copy(origin).addScaledVector(dir, 0.75); gunTip.y -= 0.12; if (dist < 300) fx.muzzle(gunTip); }
    else if (shooter.state === 'drive' && tracerFrom && !player.st.vfp) fx.muzzle(tracerFrom); // menembak dari kendaraan, kamera belakang
    for (let i = 0; i < n; i++) {
      const d = spreadDir(dir, spreadDeg, sd);
      const tw = col.ray(origin.x, -origin.z, origin.y, d.x, -d.z, d.y, def.maxRange, rayOut);
      const hit = hitAgents(shooter, origin, d, tw);
      const vh = vehicles.ray(origin, d, hit ? hit.t : tw, shooter);
      end.copy(origin).addScaledVector(d, vh ? vh.t : hit ? hit.t : tw);
      if (loot.cans.length) shootCans(origin, d, vh ? vh.t : hit ? hit.t : tw, shooter);
      if (i % 3 === 0) fx.tracer(tracerFrom || (shooter.isPlayer ? origin : gunTip), end, shooter.isPlayer ? 1 : 0.85, shooter.isPlayer);
      if (vh) { // kendaraan: pengendara/penumpang motor & jip terbuka kena langsung, kaca mobil kadang tembus ke yang duduk di dekatnya
        const dm = def.dmg * falloff(def, vh.t), drv = vh.who;
        if (vh.part === 'rider' && drv) { const head = vh.h > (drv.aimY || 1.4) + 0.24; damage(drv, dm * (head ? 2.1 : 1), head ? 'head' : 'body', shooter, w); fx.burst(end, 'hit', 7); }
        else if (vh.part === 'glass' && drv && Math.random() < 0.5) { damage(drv, dm * 0.9, 'body', shooter, w); fx.burst(end, 'hit', 5); fx.burst(end, 'wall', 4); }
        else { vehicles.hit(vh.v, dm * (def.pellets ? 0.8 : 1), shooter, 'shot'); fx.burst(end, vh.part === 'glass' ? 'wall' : 'spark', 6); }
      } else if (hit) {
        const mult = hit.part === 'head' ? 2.1 : hit.part === 'legs' ? 0.85 : 1;
        // peluru di dalam air cepat kehilangan tenaga: tanpa kerusakan setelah menembus ±1,5 m air
        let wat = 1;
        if (hit.a.swim && origin.y + d.y * hit.t < 0.07) { const tIn = origin.y > 0.07 && d.y < 0 ? (0.07 - origin.y) / d.y : 0; wat = Math.max(0, 1 - (hit.t - tIn) / 1.5); }
        if (wat > 0) damage(hit.a, def.dmg * falloff(def, hit.t) * mult * wat, hit.part, shooter, w);
        fx.burst(end, wat > 0 ? 'hit' : 'dust', 7);
      } else if (tw < def.maxRange) fx.burst(end, rayOut.b === -1 ? 'dust' : 'wall', 6);
    }
  }
  // ---------- Jeriken bensin di tanah: kena CAN_HITS peluru → meledak (ledakan berantai ke jeriken di dekatnya) ----------
  const CAN_HITS = 3, CAN_R2 = 0.36 * 0.36, canP = new THREE.Vector3();
  function shootCans(o, d, maxT, shooter) {
    let best = null, bt = maxT;
    for (const it of loot.cans) {
      const cx = it.x - o.x, cy = (it.z || 0) + 0.22 - o.y, cz = -it.y - o.z, t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0 || t > bt) continue;
      if (cx * cx + cy * cy + cz * cz - t * t < CAN_R2) { best = it; bt = t; }
    }
    if (!best) return;
    best.hits = (best.hits || 0) + 1;
    canP.copy(o).addScaledVector(d, bt);
    fx.burst(canP, 'spark', 6);
    if (best.hits >= CAN_HITS) blowCan(best, shooter);
  }
  let canChain = 0; // kedalaman ledakan berantai (dibatasi supaya tumpukan jeriken tidak meledak tanpa akhir dalam satu frame)
  function blowCan(it, attacker) {
    if (!it.alive || canChain > 16) return;
    loot.remove(it);
    const x = it.x, y = it.y, h = (it.z || 0) + 0.3;
    nades.boomFx(canP.set(x, h, -y).clone());
    canChain++;
    explode(x, y, h, 6.5, 120, attacker, null); // explode() ikut memicu jeriken lain di dekatnya (berantai)
    canChain--;
  }
  // ledakan apa pun (granat, kendaraan, jeriken lain) memicu jeriken di tanah dalam 70 % jari-jarinya, kalau tidak terhalang gedung
  function blastCans(x, y, h, R, attacker) {
    if (!loot.cans.length) return;
    const r = R * 0.7;
    for (const o of loot.cans.slice()) {
      if (!o.alive) continue;
      const oz = (o.z || 0) + 0.3;
      if (Math.hypot(o.x - x, o.y - y, oz - h) > r || !col.los(x, y, h + 0.6, o.x, o.y, oz)) continue;
      blowCan(o, attacker);
    }
  }
  function damage(t, amount, part, attacker, w) {
    if (!t.alive || phase === 'end' && t.isPlayer) return;
    if (attacker && attacker !== t && attacker.team === t.team) return; // tanpa tembak kawan (peluru, granat, kendaraan); granat sendiri tetap melukai diri
    let dmg = amount;
    const ak = part === 'head' ? 'helmet' : part === 'body' ? 'vest' : null;
    if (ak && t[ak]) { // pelindung menahan sebagian kerusakan dan ikut rusak; daya tahan habis → hancur
      dmg *= [1, 0.7, 0.6, 0.45][t[ak]];
      const left = armorHp(t, ak) - amount;
      if (left <= 0) { t[ak] = 0; t[ak + 'Hp'] = undefined; if (t.isPlayer) hud.flash(ak === 'vest' ? 'Rompi hancur' : 'Helm hancur'); }
      else t[ak + 'Hp'] = left;
    }
    if (attacker && !attacker.isPlayer && part !== 'blast' && part !== 'run') dmg *= t.isPlayer ? DIFFICULTY[diff].dmgToPlayer : 0.5; // antar-bot dilunakkan supaya ronde tidak cepat habis
    if (t.down && part !== 'bleed') dmg *= 0.6; // yang tumbang lebih tahan (perlu beberapa tembakan untuk menghabisi)
    t.hp -= dmg;
    if (attacker) attacker.dmg += dmg;
    if (part !== 'zone' && part !== 'bleed') t.pose.hit = 1;
    if (attacker && attacker.isPlayer) { hud.hitmarker(part === 'head', t.hp <= 0); audio.hit(part === 'head'); t.hitByMe = now; mySquad.focus = t; mySquad.focusAt = now; }
    if (t.isPlayer && part !== 'zone' && part !== 'bleed' && attacker) { hud.damageFrom(-wrap(Math.atan2(attacker.pos.x - me.pos.x, attacker.pos.z - me.pos.z) - player.st.yaw)); audio.hurt(); if (attacker !== me) { mySquad.focus = attacker; mySquad.focusAt = now; } }
    if (!t.isPlayer && attacker) bots.hurt(t, attacker, now);
    if (t.reviving) t.reviving = null; // kena tembak: batal memulihkan rekan
    if (t.hp > 0) return;
    if (t.down) { kill(t, t.downBy || attacker, t.downBy ? t.downW : w, part === 'bleed' || t.downBy ? t.downPart : part, attacker); return; } // kill milik yang melumpuhkan
    // regu masih punya anggota yang berdiri → tumbang (bisa dipulihkan); kalau tidak → tersingkir
    const canDown = DOWNS && (t.state === 'ground' || t.state === 'drive') && !t.swim && t.sq.standN > 1;
    if (canDown) knock(t, attacker, w, part); else kill(t, attacker, w, part, attacker);
  }
  // ---------- Regu: tumbang, pulih, tersingkir ----------
  const downed = []; // yang sedang tumbang (darahnya terus berkurang)
  const stat = { knocks: 0, assists: 0, revives: 0, headshots: 0, longestKillM: 0, onFootM: 0, drivenM: 0, healsUsed: 0, roadKills: 0, nadeKills: 0, weaponKills: {}, healSum: 0 };
  function credit(victim, w, part) { // statistik pemain untuk satu lawan yang dilumpuhkan/disingkirkan
    if (part === 'head') stat.headshots++;
    const d = Math.hypot(victim.pos.x - me.pos.x, victim.pos.z - me.pos.z);
    if (d > stat.longestKillM) stat.longestKillM = d;
    if (part === 'run') stat.roadKills++;
    else if (w === NADE_HIT) stat.nadeKills++;
    else if (w && w.inst) stat.weaponKills[w.inst.kind] = (stat.weaponKills[w.inst.kind] || 0) + 1;
  }
  function refreshSquad(sq) { // jumlah hidup/berdiri + pemimpin (pemain selama berdiri; kalau tidak, anggota berdiri pertama)
    let alive = 0, stand = 0, lead = null;
    for (const m of sq.members) { if (!m.alive) continue; alive++; if (!m.down) { stand++; if (!lead || m.isPlayer || (sq.leader === m && !lead.isPlayer)) lead = m; } }
    sq.aliveN = alive; sq.standN = stand; sq.leader = lead;
  }
  function knock(t, attacker, w, part) {
    if (t.vehicle) { const v = t.vehicle; vehicles.exit(v, t); if (!t.isPlayer) bots.ejected(t); else player.onExit(); }
    t.down = true;
    t.downN = (t.downN || 0) + 1;
    t.hp = DOWN_HP;
    t.bleed = DOWN_HP / BLEED[Math.min(BLEED.length, t.downN) - 1];
    t.downBy = attacker && attacker !== t ? attacker : null; t.downW = w; t.downPart = part;
    t.reviveT = 0; t.reviver = null; t.revBot = null; t.reviving = null;
    t.prone = true; t.crouch = false; t.reloadEnd = 0; t.healEnd = 0;
    downed.push(t);
    if (attacker && attacker !== t) { attacker.knocks = (attacker.knocks || 0) + 1; if (attacker.isPlayer) { stat.knocks++; credit(t, w, part); kills.knock(t, part === 'head'); } }
    hud.feed(attacker === t ? null : attacker, t, w, part === 'head', part, true);
    if (t.isPlayer) { player.onDown(); hud.message('Kamu tumbang', 'Merangkak ke rekan · mereka bisa memulihkanmu', 'warn'); audio.beep(true); }
    else bots.downed(t);
    refreshSquad(t.sq);
    if (t.sq === mySquad && !t.isPlayer && me.alive && !me.down) hud.message(t.name + ' tumbang', 'Dekati lalu tahan F untuk memulihkan', 'warn');
  }
  function revive(t, by) {
    const i = downed.indexOf(t);
    if (i >= 0) downed.splice(i, 1);
    t.down = false; t.hp = REVIVE_HP; t.prone = false; // pulih dengan darah 20% t.reviveT = 0; t.reviver = null; t.downBy = null;
    if (by) { by.reviving = null; if (by.isPlayer) stat.revives++; }
    if (t.isPlayer) { player.onRevived(); hud.message('Pulih!', by ? by.name + ' memulihkanmu · obati dirimu' : 'Obati dirimu', ''); }
    else bots.revived(t);
    if (by && by.isPlayer) hud.flash(t.name + ' pulih');
    refreshSquad(t.sq);
  }
  // tiap frame: darah yang tumbang berkurang (berhenti selama dipulihkan), kemajuan pemulihan
  function squadTick(dt) {
    for (let i = downed.length - 1; i >= 0; i--) {
      const t = downed[i];
      if (!t.alive) { downed.splice(i, 1); continue; }
      const r = t.reviver;
      const ok = r && r.alive && !r.down && r.reviving === t && r.state === 'ground' && Math.hypot(r.pos.x - t.pos.x, r.pos.z - t.pos.z) < REVIVE_R + 0.4 && Math.abs(r.pos.y - t.pos.y) < 1.6;
      if (ok) { t.reviveT += dt; if (t.reviveT >= REVIVE_T) revive(t, r); continue; }
      if (r && (!r.alive || r.down || r.reviving !== t)) t.reviver = null;
      t.reviveT = Math.max(0, t.reviveT - dt * 1.5);
      damage(t, t.bleed * dt, 'bleed', null, null);
    }
  }
  function explode(x, y, h, R, maxDmg, attacker, src, w = BLAST) { // ledakan kendaraan / granat: kerusakan berkurang menjauh, terhalang gedung
    const bz = -y;
    for (const a of agents) {
      if (!a.alive || a.state === 'plane' || a.state === 'fall') continue;
      const d = Math.hypot(a.pos.x - x, a.pos.y + 1 - h, a.pos.z - bz);
      if (d > R) continue;
      if (a.vehicle !== src && !col.los(x, y, h + 0.6, a.pos.x, -a.pos.z, a.pos.y + 1)) continue;
      damage(a, maxDmg * Math.pow(1 - d / R, 0.7), 'blast', attacker, w);
    }
    for (const v of vehicles.list) if (v !== src) { const d = Math.hypot(v.x - x, v.y - y); if (d < R) vehicles.hit(v, 650 * (1 - d / R), attacker, 'blast'); }
    blastCans(x, y, h, R, attacker);
    const dc = Math.hypot(camera.position.x - x, camera.position.z - bz);
    if (dc < 70) player.shake(1.3 * (1 - dc / 70));
  }
  // attacker = yang mendapat kill (yang melumpuhkan, kalau korban sedang tumbang); finisher = yang memberi pukulan terakhir
  function kill(t, attacker, w, part, finisher) {
    const wasDown = t.down;
    t.alive = false;
    t.hp = 0;
    t.state = 'dead';
    t.goneAt = now + 90;
    t.down = false; t.reviver = null; t.reviving = null;
    if (t.vehicle) { const v = t.vehicle; vehicles.exit(v, t, true); if (!t.isPlayer) bots.ejected(t); }
    if (attacker && attacker !== t) {
      attacker.kills++;
      if (attacker.isPlayer && !wasDown) credit(t, w, part); // yang tumbang sudah dihitung saat dilumpuhkan
    }
    // bantuan: pemain ikut melukai (≤ 12 dtk terakhir) atau menghabisi, tapi kill-nya milik rekan/orang lain
    if (!t.isPlayer && attacker !== me && t.team !== me.team && ((t.hitByMe && now - t.hitByMe < 12) || finisher === me)) stat.assists++;
    aliveCount--;
    hud.feed(attacker === t ? null : attacker, t, w, part === 'head', part);
    const c = { weapons: t.weapons.filter(Boolean).map((x) => x.kind), ammo: { ...t.ammo }, heals: { ...t.heals }, nades: { ...(t.nades || {}) }, vest: t.vest, helmet: t.helmet, vestHp: t.vestHp, helmetHp: t.helmetHp, bag: t.bag | 0, fuel: t.fuel | 0 };
    if (c.bag || c.fuel || c.heals.drink || c.weapons.length || Object.values(c.ammo).some((v) => v > 0) || Object.values(c.nades).some((v) => v > 0) || c.heals.band || c.heals.kit || c.vest || c.helmet) loot.crate(t.pos.x + (t.pos.y > 0.5 ? 0 : 0.8), -t.pos.z, c, t.pos.y > 0.5 ? t.pos.y : 0);
    if (attacker && attacker.isPlayer) kills.kill(t, part === 'head'); // spanduk beruntun, denting & efek kill bertema skin (game/killfx.js)
    // regu: anggota terakhir yang berdiri jatuh → yang tumbang ikut tersingkir; regu habis → peringkat regu
    const sq = t.sq;
    refreshSquad(sq);
    if (sq.aliveN > 0 && sq.standN === 0) {
      for (const m of sq.members) if (m.alive && m.down) kill(m, m.downBy, m.downW, m.downPart, null);
      return; // pemanggilan di atas sudah mengurus akhir regu
    }
    if (t.isPlayer) me.diedAt = now;
    if (sq.aliveN === 0 && !sq.rank) {
      sq.rank = squadsLeft;
      squadsLeft--;
      // regu pemain habis: tinggal satu regu → pertandingan selesai; selain itu kartu "Tersingkir" + menonton
      if (sq === mySquad) { deathRank = sq.rank; if (squadsLeft <= 1) finish(false); else eliminated(attacker === t ? null : attacker, w, part); return; }
      if (squadsLeft <= 1) { finish(mySquad.aliveN > 0); return; } // pemain sudah tersingkir & sedang menonton → juara sudah ada
    }
    if (t.isPlayer && !DOWNS) { deathRank = squadsLeft; finish(false); return; } // pertandingan pemain selesai: peringkat = jumlah regu yang masih bertahan
    if (t.isPlayer && phase === 'play') { // pemain tersingkir tetapi rekan masih hidup → menonton rekan
      player.onDead();
      specNext(1);
      hud.message('Kamu tersingkir', 'Menonton rekan · Spasi / klik ganti rekan', 'warn');
    } else if (spec === t && phase === 'play') specTo(specAll && attacker !== t ? attacker : null); // yang ditonton tersingkir → ikuti penyingkirnya
  }
  // ---------- Menonton (pemain sudah tersingkir) ----------
  // Rekan masih hidup → menonton rekan. Regu pemain habis → kartu "Tersingkir" (ringkasan & hadiah langsung dihitung),
  // lalu menonton siapa saja yang masih hidup, mulai dari yang menyingkirkan; kalau yang ditonton tersingkir, kamera pindah
  // ke penyingkirnya. Selesai saat pemain kembali ke lobi (kartu / menu Esc) atau pertandingan berakhir.
  let spec = null, specAll = false;
  function specNext(dir) {
    const L = specAll ? agents : mySquad.members, n = L.length, at = spec ? L.indexOf(spec) : 0;
    spec = null;
    // yang masih di pesawat (posisinya belum ikut pesawat) hanya dipilih kalau tidak ada yang lain
    for (let pass = 0; pass < 2 && !spec; pass++) for (let k = 1; k <= n; k++) { const m = L[((at + dir * k) % n + n) % n]; if (m.alive && !m.isPlayer && (pass || m.state !== 'plane')) { spec = m; break; } }
    player.spectate(spec);
  }
  function specTo(a) { if (a && a.alive && !a.isPlayer && a.state !== 'plane') { spec = a; player.spectate(a); } else specNext(1); }
  const CAUSE = { zone: 'Terjebak di luar zona', drown: 'Tenggelam', crash: 'Kecelakaan kendaraan', bleed: 'Kehabisan darah', blast: 'Terkena ledakan' };
  function eliminated(killer, w, part) {
    specAll = true;
    endAt = now;
    summary(false); // hadiah & misi dihitung sekarang (menonton tidak mengubah hasil)
    player.onDead();
    Object.assign(player.st, { firing: false, ads: false });
    specTo(killer && !killer.isPlayer ? killer : null);
    hud.death({ rank: deathRank, total: squads.length, by: killer && killer !== me ? killer.name : '', weapon: w && w.def ? w.def.name || w.def.short || '' : '', cause: CAUSE[part] || '',
      kills: me.kills, dmg: me.dmg, sec: (me.diedAt || now) - startedAt }, () => { hud.death(null); ctx.lock(); }, leaveMatch);
    audio.beep(true);
    document.exitPointerLock(); // tombol kartu bisa diklik (tidak dianggap jeda, lihat pointerlockchange)
  }
  function leaveMatch() { hud.death(null); finish(false, true); }
  // baris kecil di bawah nama yang ditonton: regu, kill, senjata, keadaan
  function specSub(a) {
    const w = a.cur >= 0 && a.weapons[a.cur], def = w && WEAPONS[w.kind];
    return (a.team === me.team ? 'Rekan' : 'Regu ' + (a.team + 1)) + ' · ' + a.kills + ' kill' + (def ? ' · ' + def.short : '') + (a.down ? ' · tumbang' : a.state === 'drive' ? ' · berkendara' : a.state === 'fall' || a.state === 'chute' ? ' · terjun' : a.state === 'plane' ? ' · di pesawat' : '');
  }
  // jarak ke benda pertama di sinar (gedung, orang, kendaraan selain milik penembak): titik di bawah bidikan
  function probe(shooter, o, d, maxT) {
    const tw = col.ray(o.x, -o.z, o.y, d.x, -d.z, d.y, maxT, rayOut);
    const hit = hitAgents(shooter, o, d, tw);
    const vh = vehicles.ray(o, d, hit ? hit.t : tw, shooter);
    return vh ? vh.t : hit ? hit.t : tw;
  }
  const combat = { fire, damage, probe };

  let player = null;
  const nades = createNades({ scene, col, camera, renderer, fx, particles: createParticles, now: () => now, explode: (x, y, h, R, dmg, attacker) => explode(x, y, h, R, dmg, attacker, null, NADE_HIT) });
  const bots = createBots({ scene, col, D, inArea, zone, loot, combat, agents, makeAgent, vehicles, grass, homes, nades, viewYaw: () => (player ? player.st.yaw : 0), now: () => now, playerBusy: () => !!(player && (player.st.reloadEnd || player.st.healEnd)) }, BOTS);
  // ---------- Regu berisi 4: pemain + 3 bot pertama = regu 0 (rekan); 96 bot lain = 24 regu lawan ----------
  const squads = [];
  for (const a of agents) {
    const t = a.isPlayer || a.i < TEAM - 1 ? 0 : 1 + Math.floor((a.i - (TEAM - 1)) / TEAM);
    const sq = squads[t] || (squads[t] = { id: t, members: [], leader: null, aliveN: 0, standN: 0, rank: 0, focus: null, focusAt: -99 });
    a.team = t; a.sq = sq; a.slot = sq.members.length;
    sq.members.push(a);
  }
  const mySquad = squads[0];
  mySquad.members.forEach((a, i) => { // nama rekan dari profil (lobi); kosong → nama bawaan bot
    if (a.isPlayer) return;
    a.ally = true;
    a.name0 = a.name; // nama bot asli (dipakai lagi kalau slotnya dikosongkan di lobi)
    const p = profile.squad && profile.squad[i - 1];
    if (p && p.name) a.name = String(p.name).slice(0, 14);
  });
  for (const sq of squads) refreshSquad(sq);
  let squadsLeft = squads.length;
  const mates = mySquad.members.filter((a) => !a.isPlayer); // rekan pemain (bot)
  // rekan tumbang terdekat yang bisa dipulihkan pemain (≤ 2 m, selantai)
  function reviveTarget() {
    if (!me.alive || me.down || me.state !== 'ground') return null;
    let best = null, bd = REVIVE_R;
    for (const m of mates) { if (!m.alive || !m.down || Math.abs(m.pos.y - me.pos.y) > 1.6) continue; const d = Math.hypot(m.pos.x - me.pos.x, m.pos.z - me.pos.z); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  const ctx = {
    reviveTarget,
    // pemain menahan F di dekat rekan tumbang: on = sedang memulihkan (kemajuan dihitung squadTick)
    reviveHold(t, on) { if (on && t && t.down && t.alive) { t.reviver = me; me.reviving = t; } else me.reviving = null; },
    specNext: (d) => { if (spec || !me.alive) specNext(d || 1); },
    throwNade: (a, kind, o, v) => nades.throwNade(a, kind, o, v),
    nadeAim: (o, v) => nades.aim(o, v),
    scene, camera, renderer, col, loot, combat, hud, agent: me, inArea, areaCenter: center, vehicles,
    now: () => now,
    enterVehicle(v) {
      if (me.down) return;
      const d0 = v.driver;
      if (d0 && !d0.isPlayer && d0.team === me.team) { // kemudi untuk pemain
        const fs = v.occ.findIndex((o, i) => i > 0 && !o);
        if (fs > 0 && vehicles.switchSeat(v, d0, fs)) bots.toPassenger(d0, v); else { vehicles.exit(v, d0); bots.ejected(d0); }
      }
      if (!vehicles.enter(v, me)) return;
      player.onEnter(v);
      const n = v.occ.length, pass = me.seat > 0 ? ' · kursi ' + (me.seat + 1) + ' (penumpang)' : '';
      hud.toast(v.def.name + pass + ' · F turun' + (me.seat === 0 ? ' · klik kiri tembak pistol/SMG' : ' · klik kiri tembak') + (n > 1 ? ' · Ctrl+1–' + Math.min(n, 9) + ' pindah kursi' : ''));
    },
    exitVehicle() { const v = me.vehicle; if (v && vehicles.exit(v, me)) player.onExit(); },
    // Ctrl+1..9: pindah kursi (0 = sopir); kendaraan tanpa sopir meluncur lalu berhenti
    switchSeat(i) {
      const v = me.vehicle;
      if (!v || i === me.seat) return;
      if (i >= v.occ.length) { hud.toast(v.def.short + ' hanya punya ' + v.occ.length + ' kursi'); return; }
      if (v.occ[i]) { hud.toast('Kursi ' + (i + 1) + ' sudah terisi'); return; }
      if (!vehicles.switchSeat(v, me, i)) return;
      player.onSeat(i);
      hud.flash('Kursi ' + (i + 1) + ' · ' + (i === 0 ? 'sopir (pistol/SMG)' : 'penumpang (semua senjata)'));
    },
    horn() { if (me.vehicle && me.vehicle.driver === me) vehicles.horn(me.vehicle); },
    playing: () => phase === 'play' && !paused,
    toggleMap,
    mapOpen: () => !big.el.hidden, closeMap: () => { if (!big.el.hidden) big.close(); }, // Esc menutup peta (kunci mouse diurus player.js)
    jumpOut,
    landed(x, y) {
      if (!inArea(x, y)) { const r = bots.nearestRoad(x, y); if (r) { me.pos.set(r[0], 0, -r[1]); x = r[0]; y = r[1]; } }
      hud.message('Mendarat', 'Cari senjata di rumah & ruko terdekat');
      refreshShadows(me.pos);
    },
  };
  player = createPlayer(ctx);
  player.vm.setEnv(renderer, R && R.env); // pantulan logam senjata orang pertama (mode realistis: langit foto)
  initSkins(renderer, R && R.env, scene, camera); // skin (game/skins.js): pratinjau toko/koleksi & kompilasi shader di muka memakai renderer, langit & adegan ini
  // ---------- Mode realistis: post-processing, bayangan dinamis, pantulan langit di kendaraan ----------
  const post = R ? createPostFX(renderer) : null;
  const dyn = R ? createDynShadow(renderer, scene, R) : null;
  if (R) {
    post.setSky(R.dome, R.skyV0, R.skyGain);
    post.warm(); // semua varian shader post-processing dikompilasi saat memuat
    post.U.uSunCol.value.copy(R.sunColor);
    post.U.uFogCol.value.copy(R.horizon);
    vehicles.setEnv(R.env, R); // pantulan langit + material kendaraan menerima bayangan dinamis
    setCharacterEnv(R.env);
    bots.blobs.visible = false; // bayangan sungguhan menggantikan bayangan bulat
    vehicles.blobs.material.opacity *= 0.45;
    player.vm.setLight({ sky: R.skyColor, ground: R.groundColor, skyI: R.skyIntensity, sun: R.sunColor, sunI: R.sunIntensity });
  }
  // Matriks dunia dihitung sekali per frame di loop (frame()), bukan di tiap pass render. Adegan sendiri tidak pernah
  // berpindah: tanpa matrixAutoUpdate ia tidak "memaksa" semua turunannya dihitung ulang tiap frame, sehingga cabang yang
  // dibekukan (matrixWorldAutoUpdate = false, mis. kendaraan parkir) benar-benar dilewati.
  scene.updateMatrixWorld(true);
  scene.matrixAutoUpdate = false;
  scene.matrixWorldAutoUpdate = false;
  const camFwd = new THREE.Vector3(), dynFocus = new THREE.Vector3(), camQ = new THREE.Quaternion(), sunCam = new THREE.Vector3();
  let exposure = 1;

  // ---------- Pesawat ----------
  // model Blender (tools/blender/plane.py) menggantikan pesawat prosedural begitu termuat; baling-baling berputar
  const props = [];
  new GLTFLoader().loadAsync('game/assets/plane/plane.glb').then((g) => {
    const m = g.scene.getObjectByName('plane') ? g.scene : g.scene;
    for (const ch of [...plane.children]) plane.remove(ch);
    m.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = 0.8; } if (/^prop_\d/.test(o.name)) props.push(o); });
    plane.add(m);
  }).catch(() => { /* pesawat prosedural tetap dipakai */ });
  const plane = (() => {
    const g = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color: '#4a3db0' }), gold = new THREE.MeshLambertMaterial({ color: '#D29F52' }), white = new THREE.MeshLambertMaterial({ color: '#ecebf4' }), dark = new THREE.MeshLambertMaterial({ color: '#1f2433' });
    const add = (geo, m) => { const o = new THREE.Mesh(geo, m); g.add(o); return o; };
    add(new THREE.CylinderGeometry(2.5, 2.2, 30, 18).rotateX(Math.PI / 2), body);
    add(new THREE.SphereGeometry(2.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 15), body);
    add(new THREE.ConeGeometry(2.2, 8, 18).rotateX(-Math.PI / 2).translate(0, 0.6, -19), body);
    add(new THREE.CylinderGeometry(2.53, 2.53, 1.4, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, 6), gold);
    add(new THREE.BoxGeometry(36, 0.5, 4.6).translate(0, -0.8, 1.5), white);
    add(new THREE.BoxGeometry(0.6, 7, 4.2).translate(0, 4.6, -18), body);
    add(new THREE.BoxGeometry(12, 0.4, 3).translate(0, 1.4, -19), white);
    add(new THREE.BoxGeometry(2.6, 1, 1.6).translate(0, 1.6, 15.6), dark);
    for (const x of [-12, -6.5, 6.5, 12]) {
      add(new THREE.CylinderGeometry(0.9, 0.9, 3.6, 12).rotateX(Math.PI / 2).translate(x, -1.6, 3.4), white);
      add(new THREE.CylinderGeometry(1.6, 1.6, 0.08, 16).rotateX(Math.PI / 2).translate(x, -1.6, 5.3), dark);
    }
    g.visible = false;
    scene.add(g);
    return g;
  })();
  const planePos = new THREE.Vector3();
  const flightView = { t: 0, pos: (tt, out) => flight.pos(tt, out) }; // dipakai ulang tiap frame (untuk bot)
  function makeFlight() {
    const ang = Math.random() * Math.PI * 2, dx = Math.cos(ang), dy = Math.sin(ang), off = (Math.random() - 0.5) * 700;
    const px = center.x - dy * off, py = center.y + dx * off, L = Math.hypot(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2 + 250;
    const A = [px - dx * L, py - dy * L], B = [px + dx * L, py + dy * L];
    const f = { A, B, path: [A, B], dur: 2 * L / PLANE_SPEED, t: 0, dir: [dx, dy], open: 0, close: 0, pos(t, out) { const k = Math.min(1, t / this.dur); return out.set(A[0] + (B[0] - A[0]) * k, ALT, -(A[1] + (B[1] - A[1]) * k)); } };
    // jendela terjun: bagian jalur yang berada di atas kawasan (atau ≤ 250 m darinya)
    const nearArea = (x, y) => inArea(x, y) || [0, 1, 2, 3, 4, 5, 6, 7].some((i) => inArea(x + Math.cos(i * Math.PI / 4) * 250, y + Math.sin(i * Math.PI / 4) * 250));
    let first = -1, last = -1;
    for (let i = 0; i <= 240; i++) { const k = i / 240, x = A[0] + (B[0] - A[0]) * k, y = A[1] + (B[1] - A[1]) * k; if (nearArea(x, y)) { if (first < 0) first = k; last = k; } }
    if (first < 0) { first = 0.3; last = 0.7; }
    f.open = first * f.dur;
    f.close = last * f.dur;
    return f;
  }
  function jumpOut(force) {
    if (me.state !== 'plane') return;
    if (!force && flight.t < flight.open) { hud.toast('Pesawat belum di atas kawasan'); return; }
    me.state = 'fall';
    me.pos.copy(planePos).add(new THREE.Vector3(0, -6, 0));
    me.vel.set(flight.dir[0] * 20, -flight.dir[1] * 20);
    audio.engineLevel(0.25);
    hud.message('Terjun!', 'W = meluncur · lihat ke bawah = menukik · F = buka payung');
  }

  // ---------- Peta besar (M) ----------
  const big = new BigMap(mapImg, {
    hint: 'Klik = tandai tujuan · scroll = zoom · seret = geser · <kbd>M</kbd> / <kbd>Esc</kbd> tutup',
    getState: () => { const F = focusAgent(); return { x: F.pos.x, y: -F.pos.z, heading: player.st.yaw, circles: zoneCircles(), path: me.state === 'plane' && flight ? flight.path : null, marks: waypoint ? [{ ...waypoint, color: '#D29F52' }] : [], pins: me.state === 'plane' ? [] : matePins(vehicles.pins(F.pos.x, -F.pos.z, 700, F.vehicle)) }; },
    onPick: (x, y) => { waypoint = { x, y }; hud.toast('Tujuan ditandai'); },
  });
  // ---------- Regu di HUD: warna tiap anggota, titik di peta, penanda di dunia, baris panel regu ----------
  const MATE_COL = ['#f2c14e', '#4fd1c5', '#ff8a5c', '#b79cff'];
  const focusAgent = () => (spec && spec.alive ? spec : me); // yang diikuti kamera/peta (rekan saat menonton)
  const matePinObj = mates.map((m) => ({ x: 0, y: 0, color: MATE_COL[m.slot], r: 5 }));
  function matePins(list) { // titik rekan di minimap & peta besar (yang tersingkir tidak digambar)
    const F = focusAgent();
    for (let i = 0; i < mates.length; i++) { const m = mates[i]; if (!m.alive || m === F || m.state === 'plane') continue; const p = matePinObj[i]; p.x = m.pos.x; p.y = -m.pos.z; p.color = m.down ? '#ff5a4d' : MATE_COL[m.slot]; list.push(p); }
    if (spec && me.alive === false) { /* pemain tersingkir: tidak ada titik untuknya */ }
    return list;
  }
  const sqRows = mySquad.members.map((m) => ({ name: m.isPlayer ? 'Kamu' : m.name, slot: m.slot, st: 'ok', hp: 100, t: 0, you: m.isPlayer }));
  function squadRows() { // keadaan tiap anggota untuk panel regu (objek dipakai ulang)
    for (let i = 0; i < sqRows.length; i++) {
      const m = mySquad.members[i], r = sqRows[i];
      r.st = !m.alive ? 'dead' : m.down ? (m.reviver && m.reviver.reviving === m ? 'rev' : 'down') : m.state === 'plane' ? 'plane' : m.state === 'fall' || m.state === 'chute' ? 'air' : m.state === 'drive' ? 'veh' : 'ok';
      r.hp = m.alive ? Math.max(0, Math.min(100, m.hp)) : 0;
      r.t = m.down ? Math.ceil(m.hp / Math.max(0.01, m.bleed)) : 0;
      r.name = m.isPlayer ? 'Kamu' : m.name;
    }
    return sqRows;
  }
  // penanda rekan di layar: [x px, y px, jarak m, keadaan (0 tak tampil, 1 hidup, 2 tumbang, 3 di tepi layar)] × rekan
  const mateBuf = new Float32Array(mates.length * 4), mateV = new THREE.Vector3(), mateM = new THREE.Matrix4(), mateOne = new THREE.Vector3(1, 1, 1);
  function mateMarks() {
    mateM.compose(camera.position, camera.quaternion, mateOne).invert(); // matriks pandang dari pose kamera frame ini (tanpa menelusuri anak-anak kamera)
    const F = focusAgent(), w = innerWidth, h = innerHeight;
    for (let i = 0; i < mates.length; i++) {
      const m = mates[i], o = i * 4;
      if (!m.alive || m === F || m.state === 'plane' || phase !== 'play' || (m.vehicle && m.vehicle === F.vehicle)) { mateBuf[o + 3] = 0; continue; } // sekendaraan: tidak perlu penanda
      const top = m.state === 'drive' ? (m.sitY || 0) + 1.75 : m.pos.y + (m.down || m.prone ? 0.75 : m.crouch ? 1.55 : 2.02);
      mateV.set(m.pos.x, top, m.pos.z);
      const d = mateV.distanceTo(camera.position);
      mateV.applyMatrix4(mateM);
      const behind = mateV.z > -0.2;
      mateV.applyMatrix4(camera.projectionMatrix);
      let x = mateV.x, y = mateV.y, edge = behind || Math.abs(x) > 0.94 || Math.abs(y) > 0.9;
      if (behind) { x = -x; y = -y; const k = 0.94 / Math.max(Math.abs(x), 1e-3); x *= k; y = Math.max(-0.7, Math.min(0.7, y * k)); } // di belakang: tempel di tepi kiri/kanan
      x = Math.max(-0.94, Math.min(0.94, x)); y = Math.max(-0.8, Math.min(0.9, y));
      mateBuf[o] = (x * 0.5 + 0.5) * w; mateBuf[o + 1] = (0.5 - y * 0.5) * h; mateBuf[o + 2] = d; mateBuf[o + 3] = m.down ? 2 : edge ? 3 : 1;
    }
    return mateBuf;
  }
  function toggleMap() {
    if (big.el.hidden) { big.open(); if (player) player.st.wantLock = false; document.exitPointerLock(); } // peta terbuka: jangan ada percobaan kunci mouse tertunda
    else { big.close(); ctx.lock(); }
  }
  function zoneCircles() {
    if (zone.mode === 'pre') return []; // seluruh kawasan masih aman
    const c = [{ x: zone.cur.x, y: zone.cur.y, r: zone.cur.r, color: '#8f80ff', width: 2.5, fill: null }];
    if (zone.next) c.push({ x: zone.next.x, y: zone.next.y, r: zone.next.r, color: '#ffffff', width: 2, dash: [6, 5] });
    return c;
  }

  // ---------- Menu, jeda, akhir ----------
  const pause = $('pause');
  // Lobi (game/lobby.js): panggung 3D regu + UI profil, misi, toko, koleksi, pengaturan; juga mengisi layar akhir
  // pertandingan. Sensitivitas mouse & kesulitan bot diatur di sana (kunci localStorage royale.sens / royale.diff).
  const lobby = createLobby({
    scene, camera, col, sunDir, difficulty: DIFFICULTY, diff,
    onDiff: (k) => { diff = k; },
    onSens: (v) => { player.st.sens = v; },
    onStart: () => { audio.unlockAudio(); startMatch(); ctx.lock(); },
  });
  $('resumeBtn').addEventListener('click', () => { ctx.lock(); });
  $('lobbyBtn').addEventListener('click', () => { if (specAll && phase === 'play') { pause.hidden = true; paused = false; leaveMatch(); } });
  document.addEventListener('pointerlockchange', () => {
    const locked = ctx.locked();
    if (locked) player.st.wantLock = false;
    // Esc menutup panel loot: kalau kunci mouse lepas (lagi) sesaat setelah itu, jangan dianggap jeda — game tetap jalan,
    // mouse dikunci lagi oleh klik / tombol berikutnya (player.js: st.wantLock)
    const escClose = !locked && performance.now() - (player.st.escAt || -1e9) < 1500;
    if (escClose) player.st.wantLock = true;
    if (phase === 'play') {
      paused = !locked && big.el.hidden && !player.st.lootUI && !escClose && !hud.deathOpen(); // panel loot / kartu tersingkir terbuka: mouse bebas, game tidak dijeda
      pause.hidden = !paused;
      if (paused) { $('lobbyBtn').hidden = !specAll; $('resumeBtn').textContent = specAll ? 'Lanjut menonton' : 'Lanjut'; } // menonton: menu Esc bisa kembali ke lobi
      if (paused) { player.st.firing = false; player.st.ads = false; }
    }
  });
  // Regu pemain mengikuti lobi: mulai sendirian, slot rekan diisi bot lewat tombol +. Bot rekan yang slotnya kosong
  // tidak dihapus — mereka jadi satu regu lawan tersendiri, supaya jumlah petarung tetap 100.
  function applyParty() {
    const on = partySlots(), out = [];
    mySquad.members = mySquad.members.filter((a, i) => { if (a.isPlayer || on[i - 1]) return true; out.push(a); return false; });
    mySquad.members.forEach((a, i) => { a.slot = i; });
    mates.length = 0; sqRows.length = 0;
    for (const m of mySquad.members) { if (!m.isPlayer) mates.push(m); sqRows.push({ name: m.isPlayer ? 'Kamu' : m.name, slot: m.slot, st: 'ok', hp: 100, t: 0, you: m.isPlayer }); }
    if (out.length) {
      const sq = { id: squads.length, members: out, leader: null, aliveN: 0, standN: 0, rank: 0, focus: null, focusAt: -99 };
      squads.push(sq);
      out.forEach((a, i) => { a.team = sq.id; a.sq = sq; a.slot = i; a.ally = false; a.name = a.name0 || a.name; });
      refreshSquad(sq);
      squadsLeft++;
    }
    refreshSquad(mySquad);
  }
  function startMatch() {
    phase = 'play';
    applyParty();
    lobby.hide();
    hud.show(true);
    flight = makeFlight();
    bots.setDifficulty(diff);
    bots.planJumps(flight.path, flight.dur);
    plane.visible = true;
    plane.rotation.y = Math.atan2(flight.dir[0], -flight.dir[1]);
    player.reset();
    player.st.yaw = plane.rotation.y;
    startedAt = now;
    audio.engineLevel(1);
    if (matchHooks.onStart) matchHooks.onStart({ diff });
    hud.message('SUTERA ROYALE', (mySquad.members.length > 1 ? 'Regu ' + mySquad.members.length + ' orang' : 'Solo') + ' · bot ' + DIFFICULTY[diff].label.toLowerCase() + ' · tekan F untuk terjun · M = peta');
  }
  // ringkasan pertandingan untuk lapisan meta (misi, koin): lihat game/hooks.js. Sekali per pertandingan — saat regu pemain
  // tersingkir (lalu menonton) atau saat pertandingan selesai.
  let summarySent = false;
  function summary(win) {
    if (summarySent) return;
    summarySent = true;
    if (matchHooks.onEnd) matchHooks.onEnd({
      win, rank: win ? 1 : deathRank, total: squads.length, squadMode: true, squadSize: mySquad.members.length, players: BOTS + 1, diff,
      kills: me.kills, knocks: stat.knocks, assists: stat.assists, revives: stat.revives, headshots: stat.headshots, damage: Math.round(me.dmg),
      surviveSec: Math.round((me.alive ? endAt : (me.diedAt || endAt)) - startedAt), matchSec: Math.round(endAt - startedAt), longestKillM: Math.round(stat.longestKillM),
      lootCount: me.looted || 0, onFootM: Math.round(stat.onFootM), drivenM: Math.round(stat.drivenM), healsUsed: stat.healsUsed, roadKills: stat.roadKills, nadeKills: stat.nadeKills, weaponKills: { ...stat.weaponKills },
      squadKills: mySquad.members.reduce((n, m) => n + m.kills, 0), timesDowned: me.downN || 0, alive: me.alive,
    });
  }
  // quick = kembali ke lobi dari kartu tersingkir / menu Esc saat menonton (layar akhir langsung)
  function finish(win, quick) {
    if (phase !== 'play') return;
    phase = 'end';
    border.hide();
    if (!summarySent) endAt = now;
    audio.engineLevel(0);
    audio.windLevel(0);
    summary(win);
    if (specAll && !quick) { // sedang menonton: umumkan juaranya dulu
      const champ = agents.find((a) => a.alive && !a.isPlayer);
      hud.message('Pertandingan selesai', champ ? 'Juara: regu ' + champ.name : '', '');
    }
    setTimeout(() => {
      hud.death(null);
      document.exitPointerLock();
      pause.hidden = true;
      big.close();
      lobby.showEnd(); // hasil, statistik, kemajuan misi & hadiah (ringkasan diterima lobi lewat matchHooks.onEnd di atas)
      hud.show(false);
    }, quick ? 0 : win ? 1200 : specAll ? 3200 : 2400);
  }

  // ---------- Loop ----------
  let lastT = performance.now(), hudT = 0;
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    player.vm.resize();
  });
  // FPS di layar (F3 = sembunyikan/tampilkan) + kualitas otomatis (game/governor.js). Langkah kualitas = [tingkat efek,
  // skala render]; skala render yang paling menentukan beban GPU, tingkat efek hanya menghemat sedikit.
  // F4 = pilih manual: Otomatis → Ultra → Tinggi → Sedang → Rendah → Hemat.
  const fpsEl = document.createElement('div');
  fpsEl.className = 'h-fps';
  document.body.appendChild(fpsEl);
  const PR0 = renderer.getPixelRatio();
  const STEPS = (post ? [[0, 1.5], [0, 1.25], [1, 1.1], [1, 1.0], [2, 0.9], [3, 0.8], [4, 0.8], [4, 0.65]] : [1.5, 1.25, 1.0, 0.85, 0.7].map((v) => [null, v]))
    .map(([tr, v]) => [tr, Math.min(PR0, v)]).filter((st, i, a) => !i || st[0] !== a[i - 1][0] || st[1] !== a[i - 1][1]);
  let manual = -1, gfx0 = STEPS.length > 1 && PR0 > 1.3 ? 1 : 0, half0 = false; // layar Retina: mulai dari skala 1,25 (naik sendiri kalau mulus)
  // setelan tersimpan hanya titik awal: tiap sesi mulai paling rendah "Tinggi" (FLOOR0) dan laju layar penuh — kalau
  // sesi lalu sempat turun karena mesin sedang sibuk, kualitas tidak tertahan rendah; pengatur turun lagi dalam ±1,5 dtk bila perlu
  const FLOOR0 = post ? STEPS.reduce((a, st, i) => (st[0] <= 1 ? i : a), 0) : Math.min(STEPS.length - 1, 2);
  try { const s = (localStorage.getItem('royale.gfx2') || '').split(','); if (s.length === 2 && +s[0] >= 0 && +s[0] < STEPS.length) { gfx0 = Math.min(+s[0], FLOOR0); half0 = false; } } catch (e) { /* abaikan */ }
  const applyStep = (i) => { if (post) post.setTier(STEPS[i][0]); if (renderer.getPixelRatio() !== STEPS[i][1]) renderer.setPixelRatio(STEPS[i][1]); };
  const gov = createGovernor({
    n: STEPS.length, start: gfx0, half: half0, ri: refreshProbe.stop(), apply: applyStep,
    floor: post ? STEPS.reduce((a, st, i) => (st[0] <= 1 ? i : a), 0) : Math.min(STEPS.length - 1, 2), // demi laju layar penuh paling rendah "Tinggi"; di bawah itu lebih baik setengah laju
    changed: () => { try { localStorage.setItem('royale.gfx2', gov.step + ',' + (gov.half ? 1 : 0)); } catch (e) { /* abaikan */ } },
  });
  applyStep(gov.step);
  addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); fpsEl.hidden = !fpsEl.hidden; }
    if (e.code === 'F4' && post) { // manual: -1 = otomatis, 0..4 = tingkat tetap
      e.preventDefault();
      manual = manual >= TIERS.length - 1 ? -1 : manual + 1;
      if (manual >= 0) gov.force(STEPS.findIndex((st) => st[0] === manual), performance.now() / 1000);
      hud.flash('Grafik: ' + (manual < 0 ? 'Otomatis' : TIERS[manual].label));
    }
  });
  function fpsTick(dtMs, tNow) {
    // pengatur juga aktif di lobi (adegan lobi = pemandangan dari darat, sama beratnya dengan permainan) supaya home tetap mulus
    const st = gov.tick(dtMs, tNow, manual < 0 && document.visibilityState === 'visible' && ((phase === 'play' && !paused) || phase === 'menu'));
    if (st && !fpsEl.hidden) fpsEl.textContent = `${Math.round(st.fps)} FPS · ${st.ms.toFixed(1)} ms · ${post ? post.tier.label + (manual < 0 ? ' (otomatis)' : '') + ' · ' : ''}skala ${renderer.getPixelRatio().toFixed(2)}×${gov.half ? ' · ½ laju layar' : ''}`;
  }
  const UW_DEEP = new THREE.Color('#1c5a63'); // warna kabut air terdalam (8 m)
  function frame(t) {
    requestAnimationFrame(frame);
    if (gov.skip()) return; // setengah laju layar: frame genap dilewati → selang frame rata
    fpsTick(t - lastT, t / 1000);
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    let view = { fp: false, scoped: false };
    if (phase === 'menu') { // lobi: regu berdiri di depan kamera yang melayang pelan (game/lobby.js)
      lobby.frame(dt, t / 1000);
      grass.update(camera.position, t / 1000, null);
      // tanpa vehicles.update() semua kendaraan tergambar penuh (±520 draw call) → disembunyikan sampai pertandingan
      // mulai (update() mengatur lagi visibilitasnya)
      if (vehicles.list.length && vehicles.list[0].root.visible) for (const v of vehicles.list) v.root.visible = false;
      if (shadowC.x === Infinity) refreshShadows(lobby.focus);
    } else if (!paused) {
      now += dt;
      if (flight) {
        flight.t += dt;
        flight.pos(flight.t, planePos);
        plane.position.copy(planePos);
        for (const p of props) p.rotation.z += dt * 38;
        if (flight.t > flight.dur) plane.visible = false;
      }
      if (me.state === 'plane') {
        me.pos.copy(planePos);
        player.setPlane(planePos);
        if (flight.t >= flight.close) jumpOut(true);
      } else audio.engineLevel(plane.visible ? Math.max(0, 1 - camera.position.distanceTo(planePos) / 1500) * 0.6 : 0);
      const ev = zone.update(dt);
      { // batas kawasan: tirai cahaya di dekat kamera + pemberitahuan saat pemain tertahan di tepinya
        const bd = border.update(dt, camera.position.x, -camera.position.z, me.pos.x, -me.pos.z);
        if (me.alive && (me.state === 'ground' || me.state === 'drive') && bd < (me.state === 'drive' ? 3 : 0.5) && now - borderMsgAt > 4) { borderMsgAt = now; hud.flash('Batas kawasan — tidak bisa dilewati'); }
      }
      if (ev === 'announce') { hud.message('Zona aman ditandai', 'Lingkaran putih di peta (M) · menyusut dalam ' + mmss(zone.timeLeft)); audio.beep(); }
      if (ev === 'shrink') { hud.message('Zona mulai menyusut!', 'Masuk ke lingkaran putih sebelum dinding ungu sampai', 'warn'); audio.beep(true); }
      if (ev === 'next') { hud.message('Zona berhenti menyusut', 'Lingkaran berikutnya ditandai · menyusut lagi dalam ' + mmss(zone.timeLeft)); audio.beep(); }
      if (ev === 'final') { hud.message('Zona habis', 'Bertahan sampai jadi yang terakhir', 'warn'); audio.beep(true); }
      if (me.alive && (me.state === 'ground' || me.state === 'chute' || me.state === 'drive') && zone.outside(me.pos.x, -me.pos.z) > 0) damage(me, zone.def.dps * dt, 'zone', null, null);
      if (flight) flightView.t = flight.t;
      bots.update(dt, now, flight ? flightView : null, camera.position);
      vehicles.update(dt, now, me, player.input); // setelah bot (setir bot) & sebelum kamera pemain
      squadTick(dt); // yang tumbang: darah berkurang / kemajuan pemulihan
      nades.update(dt, now);
      view = player.update(dt, now);
      if (me.alive) { // statistik pertandingan (ringkasan untuk misi)
        if (me.state === 'ground') stat.onFootM += me.moveSpeed * dt; else if (me.state === 'drive' && me.vehicle) stat.drivenM += Math.abs(me.vehicle.speed) * dt;
        const hs = me.heals.band + me.heals.kit;
        if (hs < stat.healSum) stat.healsUsed += stat.healSum - hs;
        stat.healSum = hs;
      }
      const F = focusAgent();
      bots.draw(dt, now, camera.position, camera);
      grass.update(camera.position, t / 1000, me.state === 'ground' && me.alive ? me.pos : null);
      interiors.update(camera.position);
      fx.update(dt);
      kills.update(dt);
      loot.update(now, camera.position);
      if (F.state === 'ground' && shadowC.distanceTo(F.pos) > 40 && !F.swim) refreshShadows(F.pos);
      else if (F.state === 'drive' && shadowC.distanceTo(F.pos) > 95) refreshShadows(F.pos, 300);
      // HUD (game/hud.js): kompas, panah minimap & bidikan tiap frame; sisanya ±20×/dtk — DOM hanya disentuh saat nilainya berubah
      const w = player.weapon(), moving = me.moveSpeed > 1, vArmed = me.state === 'drive' && player.st.vArmed;
      const spread = vArmed ? player.st.vSpread : w ? (player.st.ads ? w.def.ads : w.def.spread * (moving ? w.def.move : 1)) : 1.5;
      hud.frame(player.st.yaw, spread, vArmed ? view.scoped : !view.fp || view.scoped || me.state !== 'ground' || me.down, player.st.ads ? (w && w.inst.kind === 'ar' && view.fp && !(w.inst.att && w.inst.att.scope) ? 'optic' : 'dot') : '', vArmed && player.st.vBlock, view.scoped);
      hud.mates(mateMarks());
      if (hud.due(t)) {
        const pst = player.st, mv = me.state === 'drive' ? me.vehicle : null;
        if (now - placeT > 0.5) { placeT = now; placeName = F.state === 'plane' ? '' : placeAt(F.pos.x, -F.pos.z); }
        const rv = me.reviving, rb = me.down && me.reviver && me.reviver.reviving === me ? me.reviver : null; // memulihkan rekan / sedang dipulihkan
        hud.update({
          squads: squadsLeft, squad: squadRows(), spec: spec && !me.alive ? spec.name : '', specSlot: spec ? spec.slot : 0, specAll, specSub: spec && !me.alive ? specSub(spec) : '', specHp: spec ? (spec.down ? 0 : spec.hp) : 0,
          down: me.down && me.alive ? me.hp / DOWN_HP : -1, downLeft: me.down ? me.hp / Math.max(0.01, me.bleed) : 0,
          revive: rv ? rv.reviveT / REVIVE_T : rb ? me.reviveT / REVIVE_T : 0, reviveLeft: rv ? REVIVE_T - rv.reviveT : rb ? REVIVE_T - me.reviveT : 0, reviveName: rv ? rv.name : rb ? rb.name : '', reviveBy: !!rb,
          state: me.state, place: placeName, alive: aliveCount, kills: me.kills, hp: me.hp, vest: me.vest, helmet: me.helmet, vestPct: armorPct('vest', me.vest, me.vestHp), helmPct: armorPct('helmet', me.helmet, me.helmetHp), band: me.heals.band, kit: me.heals.kit, drink: me.heals.drink | 0, boost: me.boost || 0, bag: me.bag | 0, bagPct: bagWeight(me) / bagCap(me) * 100,
          weapons: me.weapons, cur: me.cur, ammo: me.ammo, nades: me.nades, nadeSel: pst.nadeSel, nadeHold: !!pst.nade, zone, outside: me.state === 'ground' ? zone.outside(me.pos.x, -me.pos.z) : -1,
          reload: pst.reloadEnd && w ? Math.max(0.01, 1 - (pst.reloadEnd - now) / w.def.reload) : 0, reloadLeft: pst.reloadEnd ? pst.reloadEnd - now : 0, // isi ulang: 0 = tidak, >0 = kemajuan
          heal: pst.healEnd ? pst.healKind : '', healK: pst.healEnd ? 1 - (pst.healEnd - now) / (pst.healDur || 3.5) : 0, healLeft: pst.healEnd ? pst.healEnd - now : 0,
          breath: pst.swim && (pst.dive || pst.breath < 0.999) ? pst.breath : -1, // napas saat menyelam (−1 = tidak ditampilkan)
          prompt: me.state === 'ground' && me.alive && !me.down ? pst.prompt : null, vehArmed: vArmed,
          hidden: me.state === 'ground' && (me.prone || me.crouch) && grass.at(me.pos.x, -me.pos.z) > 0.35 ? (me.prone ? 'prone' : 'crouch') : '',
          veh: mv ? { fuel: mv.fuel, fueling: pst.fuelEnd ? Math.max(0, Math.min(1, 1 - (pst.fuelEnd - now) / 3)) : 0, cans: me.fuel | 0, name: mv.def.name, kmh: Math.round(Math.abs(mv.speed) * 3.6), max: mv.def.maxSpeed * 3.6, hp: mv.hp, hpMax: mv.def.hp, boost: pst.sprint && mv.driver === me && mv.input.throttle > 0, burning: !mv.alive, seat: me.seat, occ: mv.occ, seats: mv.tpl.seats, cz: mv.cz, L: mv.L, W: mv.W } : null,
          pins: F.state === 'ground' || F.state === 'drive' ? matePins(vehicles.pins(F.pos.x, -F.pos.z, 260, F.vehicle)) : matePins([]),
          planeT: flight ? flight.t : 0, planeOpen: flight ? flight.open : 0, planeClose: flight ? flight.close : 0, alt: me.pos.y,
          x: F.pos.x, y: -F.pos.z, heading: pst.yaw, mapRange: F.state === 'ground' ? 240 : F.state === 'drive' ? 380 : F.state === 'dead' ? 240 : 900, circles: zoneCircles(), marks: waypoint ? [{ ...waypoint, color: '#D29F52' }] : [],
        }, mapImg);
      }
      if (!big.el.hidden && t - hudT > 50) { big.draw(); hudT = t; }
    }
    const postOn = !!post && post.tier.post;
    if (R) R.uPost.value = postOn ? 1 : 0; // daun/rumput: alfa = topeng AO hanya untuk post; tanpa post (Hemat) alfa harus utuh, kalau tidak kanvas tembus ke latar halaman (rumput tampak putih)
    const alt = Math.max(0, camera.position.y), under = camera.position.y < 0.06 && phase === 'play' && col.waterAt(camera.position.x, -camera.position.z);
    if (under) { // di bawah air: kabut hijau-toska yang makin gelap & pendek seiring kedalaman (pandang ±25 → 17 m), tanpa langit
      const k = Math.min(1, Math.max(0, -camera.position.y / 8));
      scene.fog.color.set('#4ea6a1').lerp(UW_DEEP, k);
      scene.fog.near = 0.8; scene.fog.far = 27 - k * 10;
      if (scene.background && scene.background.isColor) scene.background.copy(scene.fog.color);
    }
    else if (postOn) { scene.fog.near = 1e6; scene.fog.far = 2e6; } // kabut atmosfer dikerjakan post-processing (warna = langit di arah itu)
    else { scene.fog.color.set(horizon); scene.fog.near = 260 + alt * 1.6; scene.fog.far = 2500 + alt * 6; }
    if (under !== !!scene.userData.under) { // di bawah air: pandang ≤ 90 m (kabut menutup sisanya) → gedung jauh tidak digambar
      scene.userData.under = under; sky.visible = sunDisc.visible = !under; scene.background = under ? scene.fog.color.clone() : null;
      camera.far = under ? 90 : 20000; camera.updateProjectionMatrix();
    }
    document.body.classList.toggle('underwater', under);
    sky.position.copy(camera.position);
    sunDisc.position.copy(camera.position).addScaledVector(sunDir, 12000);
    envProps.update(camera, t / 1000); // pilah LOD benda lingkungan per jarak + waktu efek (lampu pesawat, lalu lintas, videotron)
    scene.updateMatrixWorld(); // sekali per frame; pass render di bawah tidak menelusuri ulang (scene.matrixWorldAutoUpdate = false)
    if (R) {
      // bayangan dinamis karakter & kendaraan di sekitar kamera (tidak dari udara / di bawah air / mode hemat)
      const dynOn = postOn && post.tier.id !== 'low' && (phase === 'play' || phase === 'menu') && !under && camera.position.y < 150; // menu: bayangan regu di lobi
      R.dyn.uDynOn.value = dynOn ? 1 : 0;
      if (dynOn) {
        camera.getWorldDirection(camFwd);
        camFwd.y = 0;
        if (camFwd.lengthSq() > 1e-6) camFwd.normalize();
        dynFocus.copy(camera.position).addScaledVector(camFwd, 16);
        { const Fd = focusAgent(); dynFocus.y = Fd.state === 'ground' || Fd.state === 'drive' ? Math.max(0, Fd.pos.y) : 0; }
        if (phase === 'menu') dynFocus.copy(lobby.focus);
        dyn.update(dynFocus);
      }
      // mata menyesuaikan: di dalam gedung eksposur naik pelan-pelan
      let expT = 1, shade = 1;
      if (phase === 'play' && !under) {
        if (col.inBuilding(camera.position.x, -camera.position.z) >= 0 && camera.position.y < 9) { expT = 1.7; shade = 0.12; } // di dalam: mata menyesuaikan (matahari kini masuk lewat jendela, tidak perlu setinggi dulu)
        else if (view.fp && col.ray(camera.position.x, -camera.position.z, camera.position.y, sunDir.x, -sunDir.z, sunDir.y, 300) < 300) shade = 0.12; // berdiri di bayangan
      }
      exposure += (expT - exposure) * (1 - Math.exp(-dt * 1.6));
      if (view.fp) { camQ.copy(camera.quaternion).invert(); player.vm.setSun(sunCam.copy(sunDir).applyQuaternion(camQ), shade, dt); } // senjata disinari dari arah matahari sebenarnya
    }
    if (postOn) post.render(scene, camera, view.fp ? player.vm : null, { sunDir, exposure, under, time: t / 1000 });
    else {
      renderer.render(scene, camera);
      if (view.fp) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(player.vm.scene, player.vm.camera);
        renderer.autoClear = true;
      }
    }
  }
  loadStep(100, 'Siap');
  requestAnimationFrame((t) => { lastT = t; frame(t); $('loader').classList.add('done'); setTimeout(() => { $('loader').hidden = true; }, 600); });
}
