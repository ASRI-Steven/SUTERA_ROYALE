// Lobi (home) Sutera Royale + lapisan meta: profil, Koin Sutera, misi, toko & koleksi skin, regu, pengaturan, dan layar
// akhir pertandingan.
// - Panggung 3D: regu berempat berdiri di jalan palem dekat The Prominence, kamera melayang pelan. Karakter memakai skin
//   yang dipakai (game/skins.js). Digambar lewat pipeline game yang sama (langit HDR, post-processing, bayangan).
// - UI: DOM dibuat di sini (isi #menu dan #end), gaya di game/lobby.css. Tanpa backdrop-filter; animasi transform/opacity.
// - Data hanya di localStorage (game/profile.js, game/quests.js). Tanpa server.
// main.js: createLobby(…) → { focus, frame(dt, t), hide(), showEnd() }.
import * as THREE from 'three';
import { buildCharacter, characterVariants } from '../map/rig.js';
import { profile, saveProfile, owns, buy, equip, setName, ensureSquad, setMate, partySlots, setParty } from './profile.js';
import { RARITY, CHAR_SKINS, GUN_SKINS, skinById, charOutfit, applyGunSkin, skinThumb } from './skins.js';
import { questState, applyMatch, claimQuest, claimAll, rerollDaily, fmtLeft, fmtProgress } from './quests.js';
import { matchHooks } from './hooks.js';

// ---------- ikon (garis, 24×24) ----------
const IC = {
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v8.5h11V10"/><path d="M10 18.5v-5h4v5"/>',
  misi: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5v-1h5v1"/><path d="m9 12.3 2 2 4-4.6"/>',
  toko: '<path d="M5.5 8.5h13l-1 11h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  koleksi: '<path d="M8.5 4 4 7l2 3.5 2-1V20h8V9.5l2 1L20 7l-4.5-3a3.5 3.5 0 0 1-7 0z"/>',
  regu: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3.3 2.7-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="17" cy="9.5" r="2.3"/><path d="M16 14.2c2.4.2 4 1.6 4.5 4.3"/>',
  setelan: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5l3 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v3.2h-3.2"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.7-3.8 3.3-5.8 7-5.8s6.3 2 7 5.8"/>',
  map: '<path d="M3.5 6.5 9 4.5l6 2 5.5-2v13L15 19.5l-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  skull: '<path d="M6 13.5V11a6 6 0 0 1 12 0v2.5l-1.5 1.2V18h-9v-3.3z"/><circle cx="9.7" cy="11.3" r="1.1"/><circle cx="14.3" cy="11.3" r="1.1"/><path d="M10.5 18v-1.8M13.5 18v-1.8"/>',
  burst: '<path d="M12 3l1.8 5 5-2-2.6 4.6 4.8 2.2-5 1.2 1 5.2-4-3.4-3.6 4 .3-5.3-5.2-.4 4.2-3.2-3.2-4.2 5.2 1.3z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5h11l-2.2 3.5L17 12H6"/>',
  trophy: '<path d="M8 4.5h8v4a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5a3 3 0 0 0 3 3M16 6h3v1.5a3 3 0 0 1-3 3"/><path d="M12 12.5V16M8.5 19.5h7M10 16h4v3.5h-4z"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  crown: '<path d="M4 17.5 5 8l4.5 4L12 6l2.5 6L19 8l1 9.5z"/><path d="M4 20.5h16"/>',
  head: '<circle cx="12" cy="10" r="4.6"/><path d="M12 3v3.2M12 13.8V17M5 10h3.2M15.8 10H19"/><path d="M7 20.5c1-2 2.8-3 5-3s4 1 5 3"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20z"/><path d="M12 10.8v4M10 12.8h4"/>',
  down: '<circle cx="6.5" cy="15.5" r="2"/><path d="M9 16.5h10.5M12 16.5l2-4h4"/><path d="M12 4v5.5m-2.5-2.3L12 9.7l2.5-2.5"/>',
  hands: '<path d="M3.5 12.5 8 8l3.2 2L13 8h3l4.5 4.5"/><path d="M6.5 14.5 10 18l2-1.6 2 1.6 3.5-3.5"/><path d="M8 8V5.5M16 8V5.5"/>',
  gun: '<path d="M3 8.5h14.5l1 1.8H21v2h-6.5l-1 2H11l-1.5 5H6.5l1.2-5H3z"/>',
  scope: '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  car: '<path d="M3.5 15.5v-3l2-4.5h13l2 4.5v3z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/><path d="M5 12h14"/>',
  wheel: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2"/><path d="M12 4v5.8M12 14.2V20M4 12h5.8M14.2 12H20"/>',
  nade: '<path d="M9 9.5h6a5.5 5.5 0 1 1-6 0z"/><path d="M10.5 9.5v-3h3v3M13.5 6.5h3l1.5 3"/>',
  medkit: '<rect x="4" y="7.5" width="16" height="12" rx="2.2"/><path d="M9.5 7.5V5.5h5v2M12 10.5v6M9 13.5h6"/>',
  crate: '<path d="M4 8.5 12 4.5l8 4v8l-8 4-8-4z"/><path d="M4 8.5l8 4 8-4M12 12.5v8"/>',
  boot: '<path d="M8 4h5v8l5.5 2.5a2 2 0 0 1 1.5 2V19H6v-6l2-2z"/><path d="M6 16.5h14"/>',
  mouse: '<rect x="7" y="3.5" width="10" height="17" rx="5"/><path d="M12 7v3.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};
const ic = (name, cls = '') => `<svg class="lb-i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name] || IC.flag}</svg>`;
const coin = '<span class="lb-coin" aria-hidden="true"></span>';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('id-ID');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// pakaian bawaan regu (sama dengan pemain di game/player.js): seragam ungu, sarung tangan gelap, manset emas
const BASE_OUTFIT = { shirt: '#503EBA', sleeve: '#503EBA', pants: '#2b2940', skin: '#c68c66', hair: '#231c18', shoes: '#1c1b22', gear: '#4c5340', pack: '#3a3d34', trim: '#D29F52', glove: '#25232c', cuff: '#D29F52', inner: '#d9d5cc' };
const ME_LOOK = { variant: 'm1', hair: 0, tone: '#c68c66', hairC: '#231c18' };
// tata panggung per anggota: [geser kanan (m), mundur (m), putar (rad), senjata di tangan, rompi, helm]
const SLOTS = [[0, 0, 0.0, 'ar', 2, 0], [-1.12, 0.62, 0.2, 'smg', 1, 2], [1.14, 0.56, -0.22, '', 0, 0], [2.22, 1.22, -0.34, 'shotgun', 2, 1]];
// tempat lobi (koordinat data, m): trotoar jalan palem di tenggara menara The Prominence; kamera memunggungi matahari
const SPOT = { x: 270.3, y: 1668.0 };

// skin karakter → { outfit, look, gear }. charOutfit boleh mengembalikan palet langsung atau { outfit, look, gear }.
function skinLook(id) {
  let r = null;
  try { r = charOutfit(id); } catch (e) { r = null; }
  if (!r || typeof r !== 'object') return {};
  return r.outfit || r.look || r.gear ? r : { outfit: r };
}

// ---------- panggung 3D ----------
function createStage({ scene, camera, col, sunDir }) {
  const g = new THREE.Group();
  g.name = 'lobby';
  scene.add(g);
  const sl = Math.hypot(sunDir.x, sunDir.z) || 1, ux = sunDir.x / sl, uz = sunDir.z / sl; // arah datar ke matahari (three)
  const rx = uz, rz = -ux; // kanan layar saat kamera memandang menjauhi matahari
  let sp = [SPOT.x, SPOT.y];
  try { const f = col.findFree(SPOT.x, SPOT.y, 30, 0.6, true); if (f) sp = f; } catch (e) { /* pakai titik asli */ }
  const S = new THREE.Vector3(sp[0], 0, -sp[1]), yaw0 = Math.atan2(ux, uz);
  const variants = characterVariants().map((v) => v.key);
  const members = [null, null, null, null];
  const memberOf = (i) => (i === 0 ? { ...ME_LOOK, skin: profile.equipped.character } : ensureSquad()[i - 1]);
  function dispose(ch) {
    g.remove(ch.root);
    ch.root.traverse((o) => { if (o.geometry && o.geometry.isInstancedBufferGeometry) o.geometry.dispose(); if (o.isSkinnedMesh && o.skeleton && o.skeleton.dispose) o.skeleton.dispose(); });
  }
  // (bangun ulang) anggota i; skinId: pratinjau skin lain tanpa menyimpannya
  const active = (i) => i === 0 || partySlots()[i - 1]; // slot rekan kosong: tidak ada karakter di panggung
  function build(i, skinId) {
    if (members[i]) dispose(members[i].ch);
    if (!active(i)) { members[i] = null; return; }
    const m = memberOf(i), sk = skinLook(skinId || m.skin), sl2 = SLOTS[i];
    const outfit = { ...BASE_OUTFIT, skin: m.tone, hair: m.hairC, ...(sk.outfit || {}) };
    const look = { variant: variants.includes(m.variant) ? m.variant : variants[0], hair: m.hair, ...(sk.look || {}) };
    const ch = buildCharacter(outfit, {}, look);
    const gear = { pack: true, hair: sl2[5] === 0, vest: sl2[4], helmet: sl2[5], ...(sk.gear || {}) };
    ch.setGear('hair', !!gear.hair); ch.setGear('pack', !!gear.pack); ch.setGear('vest', gear.vest); ch.setGear('helmet', gear.helmet);
    if (sl2[3]) { ch.setGear('gun_' + sl2[3], true); gunSkin(ch, sl2[3], profile.equipped.weapon); }
    ch.root.position.set(S.x + rx * sl2[0] - ux * sl2[1], 0, S.z + rz * sl2[0] - uz * sl2[1]);
    ch.root.rotation.y = yaw0 + sl2[2];
    g.add(ch.root);
    members[i] = { ch, yaw: yaw0 + sl2[2], pose: { speed: 0, armed: !!sl2[3], aim: false, pitch: 0, moveYaw: 0 }, gun: sl2[3] };
  }
  function gunSkin(ch, kind, id) { for (const o of ch.parts['gun_' + kind] || []) { try { applyGunSkin(o, id); } catch (e) { /* skin belum tersedia */ } } }
  for (let i = 0; i < 4; i++) build(i);

  // kamera: melayang pelan; target = seluruh regu, atau satu anggota (koleksi/toko/regu); panel terbuka → adegan digeser ke kiri
  const cur = { dist: 7.4, h: 1.42, lookY: 1.06, fx: 0, fz: 0, off: 0, fov: 34 }, tgt = { ...cur };
  let W0 = 0, H0 = 0, off0 = -1;
  const focus = new THREE.Vector3().copy(S), _v = new THREE.Vector3();
  // titik layar (px) di atas kepala anggota i untuk label nama; false kalau di belakang kamera
  function headXY(i, out) {
    if (!members[i]) return false;
    const hb = members[i].ch.rig.b.head;
    _v.setFromMatrixPosition(hb.matrixWorld);
    _v.y += 0.34;
    _v.project(camera);
    if (_v.z > 1) return false;
    out[0] = (_v.x + 1) * 0.5 * innerWidth; out[1] = (1 - _v.y) * 0.5 * innerHeight;
    return true;
  }
  let aimMode = 'squad';
  function aim(mode, i = 0) {
    if ((mode === 'member' || mode === 'gun') && !members[i]) mode = 'squad';
    aimMode = mode;
    if (mode === 'member' || mode === 'gun') { // 'gun': lebih dekat ke senjata di tangan (pratinjau skin senjata)
      const p = members[i].ch.root.position, gun = mode === 'gun';
      Object.assign(tgt, { dist: gun ? 2.7 : 4.0, h: gun ? 1.2 : 1.34, lookY: gun ? 1.0 : 1.0, fx: p.x - S.x, fz: p.z - S.z, fov: 34 });
    }
    else { // seluruh regu: bidik titik tengah anggota yang ada, makin sedikit orang makin dekat
      let n = 0, ax = 0, ab = 0;
      for (let k = 0; k < 4; k++) if (members[k]) { n++; ax += SLOTS[k][0]; ab += SLOTS[k][1]; }
      n = n || 1; ax /= n; ab = ab / n * 0.5;
      Object.assign(tgt, { dist: 5.0 + 0.8 * (n - 1), h: 1.42, lookY: 1.06, fx: rx * ax - ux * ab, fz: rz * ax - uz * ab, fov: 34 });
    }
  }
  aim('squad');
  return {
    group: g, focus, members,
    build, aim, headXY,
    refit() { if (aimMode === 'squad') aim('squad'); }, // anggota bertambah/berkurang: bingkai ulang kamera
    setOffset(v) { tgt.off = v; },
    preview(skinId) { build(0, skinId); },
    gunPreview(id) { for (const m of members) if (m && m.gun) gunSkin(m.ch, m.gun, id); },
    frame(dt, t) {
      const k = 1 - Math.exp(-dt * 3.4);
      for (const key in cur) cur[key] += (tgt[key] - cur[key]) * k;
      const a = Math.sin(t * 0.17) * 0.085, ca = Math.cos(a), sa = Math.sin(a), dx = ux * ca - uz * sa, dz = uz * ca + ux * sa; // ayunan mengitari regu
      const cx = S.x + cur.fx, cz = S.z + cur.fz;
      camera.position.set(cx + dx * cur.dist, cur.h + Math.sin(t * 0.23) * 0.035, cz + dz * cur.dist);
      camera.lookAt(cx, cur.lookY, cz);
      const W = innerWidth, H = innerHeight;
      if (Math.abs(camera.fov - cur.fov) > 0.01 || W !== W0 || H !== H0 || Math.abs(cur.off - off0) > 0.0005) {
        W0 = W; H0 = H; off0 = cur.off;
        camera.fov = cur.fov;
        if (cur.off > 0.001) camera.setViewOffset(W, H, Math.round(cur.off * W), 0, W, H); else if (camera.view) camera.clearViewOffset();
        camera.updateProjectionMatrix();
      }
      for (let i = 0; i < 4; i++) { // napas & pergeseran berat badan
        const m = members[i];
        if (!m) continue;
        m.ch.root.rotation.y = m.yaw + Math.sin(t * 0.43 + i * 1.7) * 0.035;
        m.ch.rig.pose(m.pose, dt);
      }
    },
    hide() { // pertandingan mulai: regu lobi dilepas dari adegan (layar akhir memuat ulang halaman, jadi tidak dipakai lagi)
      if (camera.view) camera.clearViewOffset();
      for (let i = 0; i < 4; i++) { if (members[i]) dispose(members[i].ch); members[i] = null; }
      scene.remove(g);
    },
  };
}

// ---------- lobi ----------
export function createLobby(o) {
  const { camera, difficulty: DIFF } = o;
  const menu = document.getElementById('menu'), endEl = document.getElementById('end');
  document.body.classList.remove('g-menu'); // gaya menu lama meredupkan kanvas dengan filter CSS (mahal); lobi memakai kelas sendiri
  document.body.classList.add('lb-on');
  ensureSquad();
  saveProfile();
  const stage = createStage(o);
  let diff = o.diff, panel = '', shopTab = 'char', selSkin = '', lastSummary = null, lastDeltas = [], shownCoins = profile.coins, coinAnim = 0, lookI = -1;
  let sens = 1;
  try { const v = parseFloat(localStorage.getItem('royale.sens')); if (v) sens = clamp(v, 0.3, 2.5); } catch (e) { /* abaikan */ }
  o.onSens(sens);
  let again = false;
  try { again = sessionStorage.getItem('royale.again') === '1'; sessionStorage.removeItem('royale.again'); } catch (e) { /* abaikan */ }

  const NAV = [['', 'home', 'Lobi'], ['misi', 'misi', 'Misi'], ['toko', 'toko', 'Toko'], ['koleksi', 'koleksi', 'Koleksi'], ['regu', 'regu', 'Regu'], ['setelan', 'setelan', 'Pengaturan']];
  const TITLE = { misi: 'Misi', toko: 'Toko', koleksi: 'Koleksi', regu: 'Regu', setelan: 'Pengaturan' };
  menu.className = 'lb' + (again ? ' lb-again' : '');
  menu.innerHTML = `
    <div class="lb-shade" aria-hidden="true"></div>
    <header class="lb-top">
      <div class="lb-brand"><b>Sutera Royale</b><span>Alam Sutera · mode regu</span></div>
      <div class="lb-top-r">
        <button class="lb-chip lb-coins" type="button" data-go="toko" title="Koin Sutera · dipakai di Toko">${coin}<b data-coins>${fmt(profile.coins)}</b><span>Koin Sutera</span></button>
        <button class="lb-chip lb-name" type="button" data-act="rename" title="Ganti nama">${ic('user')}<b data-name>${esc(profile.name)}</b>${ic('pencil', 'lb-i-s')}</button>
        <button class="lb-chip lb-ico" type="button" data-go="setelan" aria-label="Pengaturan">${ic('setelan')}</button>
      </div>
    </header>
    <nav class="lb-nav" aria-label="Menu lobi">
      ${NAV.map(([id, icn, label]) => `<button type="button" data-go="${id}" title="${label}"${id === '' ? ' aria-current="page"' : ''}>${ic(icn)}<span>${label}</span><i class="lb-dot" data-dot="${id}" hidden></i></button>`).join('')}
    </nav>
    <div class="lb-tags" data-tags aria-hidden="true">${[0, 1, 2, 3].map((i) => `<div class="lb-nt${i === 0 ? ' me' : ''}"><span><i>${i + 1}</i><b></b></span></div>`).join('')}</div>
    <aside class="lb-mini" data-mini></aside>
    <div class="lb-squad" data-squad></div>
    <div class="lb-go">
      <div class="lb-mode"><span>Mode</span><b data-modeb>Solo</b><em data-modee>26 regu · 100 petarung</em></div>
      <div class="lb-diff" data-level="${diff}">
        <div class="lb-diff-h"><span>Kesulitan bot</span><p data-diffnote></p></div>
        <div class="lb-seg" role="radiogroup" aria-label="Tingkat kesulitan bot">
          ${Object.keys(DIFF).map((k) => `<button type="button" role="radio" data-diff="${k}" aria-checked="${k === diff}">${esc(DIFF[k].label)}</button>`).join('')}
        </div>
      </div>
      <button class="lb-start" type="button" id="playBtn">${ic('play')}<b>Mulai</b><span data-startsub>Terjun sendirian</span></button>
    </div>
    <section class="lb-panel" data-panel aria-hidden="true">
      <header><h2 data-ptitle></h2><button class="lb-chip lb-ico" type="button" data-go="" aria-label="Tutup panel">${ic('x')}</button></header>
      <div class="lb-body" data-pbody></div>
    </section>
    <div class="lb-modal" data-modal hidden></div>
    <div class="lb-toast" data-toast aria-live="polite"></div>`;
  const $ = (sel) => menu.querySelector(sel), $$ = (sel) => [...menu.querySelectorAll(sel)];
  const elPanel = $('[data-panel]'), elBody = $('[data-pbody]'), elModal = $('[data-modal]'), elToast = $('[data-toast]');

  // ---------- potongan tampilan ----------
  const rar = (s) => RARITY[s.rarity] || RARITY.biasa;
  function questRow(q, compact) {
    const pct = Math.round(100 * q.p / Math.max(1, q.n)), state = q.claimed ? 'claimed' : q.complete ? 'done' : '';
    if (compact) return `<div class="lb-q lb-q-c ${state}"><span class="lb-q-i">${ic(q.icon)}</span><div class="lb-q-m"><p>${esc(q.text)}</p><div class="lb-bar"><i style="transform:scaleX(${pct / 100})"></i></div></div><span class="lb-q-r">${q.claimed ? ic('check') : coin + fmt(q.reward)}</span></div>`;
    return `<div class="lb-q ${state}">
      <span class="lb-q-i">${ic(q.icon)}</span>
      <div class="lb-q-m"><p>${esc(q.text)}</p><div class="lb-bar"><i style="transform:scaleX(${pct / 100})"></i></div><small>${esc(fmtProgress(q))}</small></div>
      <div class="lb-q-a"><span class="lb-q-r">${coin}<b>${fmt(q.reward)}</b></span>
        ${q.claimed ? `<span class="lb-tag ok">${ic('check')}Diklaim</span>` : q.complete ? `<button type="button" class="lb-btn gold" data-claim="${q.scope}:${q.index}">Klaim</button>` : `<span class="lb-tag">${pct}%</span>`}
      </div></div>`;
  }
  function thumb(s) { return `<div class="lb-thumb" data-thumb="${s.id}" style="--rc:${rar(s).color}"><span class="lb-ph">${ic(s.id.startsWith('gun_') ? 'gun' : 'koleksi')}</span></div>`; }
  function fillThumbs(root) {
    for (const el of root.querySelectorAll('[data-thumb]')) {
      const id = el.dataset.thumb;
      Promise.resolve().then(() => skinThumb(id, 256)).then((url) => { if (url && el.isConnected) { const im = new Image(); im.alt = ''; im.src = url; im.onload = () => { el.appendChild(im); el.classList.add('has'); }; } }).catch(() => { /* placeholder tetap */ });
    }
  }
  function skinCard(s, mode) { // mode: 'shop' | 'own'
    const slot = s.id.startsWith('gun_') ? 'weapon' : 'character', has = owns(s.id), on = profile.equipped[slot] === s.id, r = rar(s);
    const state = on ? `<span class="lb-tag ok">${ic('check')}Dipakai</span>` : has ? '<span class="lb-tag">Dimiliki</span>' : `<span class="lb-price${profile.coins < s.price ? ' no' : ''}">${coin}<b>${fmt(s.price)}</b></span>`;
    return `<button type="button" class="lb-card${selSkin === s.id ? ' sel' : ''}${has ? '' : ' locked'}" data-skin="${s.id}" style="--rc:${r.color}" aria-pressed="${selSkin === s.id}">
      ${thumb(s)}<span class="lb-rar">${esc(r.label)}</span><b>${esc(s.name)}</b>${mode === 'own' && !on ? '<span class="lb-tag">Dimiliki</span>' : state}</button>`;
  }
  function skinDetail(id) {
    const s = skinById(id);
    if (!s) return '';
    const slot = id.startsWith('gun_') ? 'weapon' : 'character', has = owns(id), on = profile.equipped[slot] === id, r = rar(s), lack = s.price - profile.coins;
    const act = on ? `<span class="lb-tag ok big">${ic('check')}Sedang dipakai</span>` : has ? `<button type="button" class="lb-btn gold" data-equip="${id}">Pakai</button>`
      : lack > 0 ? `<button type="button" class="lb-btn" disabled>${ic('lock')}Kurang ${fmt(lack)} koin</button>` : `<button type="button" class="lb-btn gold" data-buy="${id}">${coin}Beli · ${fmt(s.price)}</button>`;
    return `<div class="lb-detail" style="--rc:${r.color}"><div><span class="lb-rar">${esc(r.label)} · ${slot === 'weapon' ? 'Skin senjata' : 'Skin karakter'}</span><h3>${esc(s.name)}</h3><p>${esc(s.desc || '')}</p>${!has && lack > 0 ? '<p class="lb-hint">Selesaikan misi untuk mengumpulkan Koin Sutera.</p>' : ''}</div><div class="lb-detail-a">${act}</div></div>`;
  }

  // ---------- panel ----------
  const P = {
    misi() {
      const q = questState();
      return `<div class="lb-sum"><div>${coin}<p><b>${fmt(q.claimable)}</b> koin siap diklaim</p></div><button type="button" class="lb-btn gold" data-act="claimall"${q.claimable ? '' : ' disabled'}>Klaim semua</button></div>
        <div class="lb-sec"><h3>Harian</h3><span>${ic('clock', 'lb-i-s')}berganti dalam ${fmtLeft(q.dailyMs)}</span>
          <button type="button" class="lb-btn ghost" data-act="reroll"${q.canReroll ? '' : ' disabled'} title="Ganti misi harian yang belum diklaim. Sekali sehari.">${ic('refresh', 'lb-i-s')}Acak ulang · ${q.rerollLeft}</button></div>
        <div class="lb-qs">${q.daily.map((x) => questRow(x)).join('')}</div>
        <div class="lb-sec"><h3>Mingguan</h3><span>${ic('clock', 'lb-i-s')}berganti dalam ${fmtLeft(q.weeklyMs)}</span></div>
        <div class="lb-qs">${q.weekly.map((x) => questRow(x)).join('')}</div>
        <p class="lb-foot">Kemajuan misi dihitung di akhir tiap pertandingan. Untuk saat ini Koin Sutera hanya didapat dari misi.</p>`;
    },
    toko() {
      const list = shopTab === 'gun' ? GUN_SKINS : CHAR_SKINS;
      if (!list.some((s) => s.id === selSkin)) selSkin = (list.find((s) => !owns(s.id)) || list[0]).id;
      return `<div class="lb-tabs" role="tablist"><button type="button" role="tab" data-tab="char" aria-selected="${shopTab === 'char'}">${ic('koleksi', 'lb-i-s')}Karakter</button><button type="button" role="tab" data-tab="gun" aria-selected="${shopTab === 'gun'}">${ic('gun', 'lb-i-s')}Senjata</button></div>
        <div class="lb-grid">${list.map((s) => skinCard(s, 'shop')).join('')}</div>
        ${list.length <= 1 ? '<p class="lb-foot">Skin baru sedang disiapkan dan akan muncul di sini.</p>' : ''}
        ${skinDetail(selSkin)}`;
    },
    koleksi() {
      const mine = (L) => L.filter((s) => owns(s.id));
      const all = [...mine(CHAR_SKINS), ...mine(GUN_SKINS)];
      if (!all.some((s) => s.id === selSkin)) selSkin = profile.equipped.character;
      const total = CHAR_SKINS.length + GUN_SKINS.length;
      return `<div class="lb-sum"><div>${ic('koleksi')}<p><b>${all.length}</b> dari ${total} skin dimiliki</p></div><button type="button" class="lb-btn ghost" data-go="toko">Buka toko</button></div>
        <div class="lb-sec"><h3>Karakter</h3><span>dipakai kamu di lobi & pertandingan</span></div>
        <div class="lb-grid">${mine(CHAR_SKINS).map((s) => skinCard(s, 'own')).join('')}</div>
        <div class="lb-sec"><h3>Senjata</h3><span>berlaku untuk semua senjatamu</span></div>
        <div class="lb-grid">${mine(GUN_SKINS).map((s) => skinCard(s, 'own')).join('')}</div>
        ${skinDetail(selSkin)}`;
    },
    regu() {
      const sq = ensureSquad(), mine = CHAR_SKINS.filter((s) => owns(s.id));
      const row = (i, name, skinId, bot) => {
        const s = skinById(skinId) || CHAR_SKINS[0];
        return `<div class="lb-mate" data-mate="${i}" style="--rc:${rar(s).color}">
          <span class="lb-ava">${i + 1}</span>
          <div class="lb-mate-m"><label>${bot ? 'Rekan bot' : 'Kamu'}<input type="text" maxlength="14" value="${esc(name)}" data-mname="${i}" aria-label="Nama anggota ${i + 1}" spellcheck="false" autocomplete="off"></label></div>
          <div class="lb-mate-s"><span>Skin</span>${bot ? `<select data-mskin="${i}" aria-label="Skin anggota ${i + 1}">${mine.map((k) => `<option value="${k.id}"${k.id === skinId ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select>` : `<button type="button" class="lb-btn ghost" data-go="koleksi">${esc(s.name)}</button>`}</div>
          <button type="button" class="lb-chip lb-ico" data-look="${i}" aria-label="Lihat anggota ${i + 1}">${ic('eye')}</button></div>`;
      };
      const on = partySlots();
      const add = (i) => `<div class="lb-mate lb-mate-add"><span class="lb-ava">+</span><div class="lb-mate-m"><label>Slot ${i + 1} kosong</label></div><button type="button" class="lb-btn ghost" data-add="${i}">Tambah anggota</button></div>`;
      return `<p class="lb-lead">Kamu mulai sendirian. Isi slot kosong dengan rekan bot: mereka mengikutimu, ikut menembak, dan bisa menghidupkanmu kembali. Beri mereka nama dan pilihkan skin yang sudah kamu miliki.</p>
        <div class="lb-mates">${row(0, profile.name, profile.equipped.character, false)}${sq.map((m, i) => (on[i] ? row(i + 1, m.name, m.skin, true) : add(i + 1))).join('')}</div>
        <p class="lb-foot">Skin rekan diambil dari koleksimu. Skin baru bisa dibeli di Toko.</p>
        <div class="lb-sec"><h3>Karier</h3><span>tersimpan di peramban ini</span></div>
        <div class="lb-career">${career().map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>`;
    },
    setelan() {
      return `<div class="lb-set"><label for="lbSens">${ic('mouse')}<span><b>Sensitivitas mouse</b><small>Seberapa cepat bidikan mengikuti gerakan mouse.</small></span></label><div class="lb-range"><input id="lbSens" type="range" min="0.3" max="2.5" step="0.1" value="${sens}" data-sens><output data-sensval>${sens.toFixed(1)}</output></div></div>
        <div class="lb-set"><div class="lb-set-l">${ic('eye')}<span><b>Grafik</b><small>Kualitas menyesuaikan sendiri supaya gerakan tetap mulus. <kbd>F3</kbd> menampilkan FPS, <kbd>F4</kbd> memilih kualitas secara manual.</small></span></div></div>
        <div class="lb-sec"><h3>Kontrol</h3></div>
        <ul class="lb-keys">
          <li><span>Gerak</span><p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> jalan · <kbd>Shift</kbd> lari · <kbd>Spasi</kbd> lompat · <kbd>C</kbd> jongkok · <kbd>Z</kbd> tiarap</p></li>
          <li><span>Tembak</span><p><kbd>Klik kiri</kbd> tembak · <kbd>Klik kanan</kbd> bidik · <kbd>R</kbd> isi ulang</p></li>
          <li><span>Senjata</span><p><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> atau gulir · <kbd>G</kbd> granat (tahan = lebih jauh) · <kbd>T</kbd> ganti granat</p></li>
          <li><span>Obat</span><p><kbd>4</kbd> perban (sampai 75 HP) · <kbd>5</kbd> P3K · <kbd>6</kbd> minuman energi (darah naik pelan-pelan sampai 100)</p></li>
          <li><span>Aksi</span><p><kbd>F</kbd> ambil / naik kendaraan / terjun / buka payung · tahan <kbd>F</kbd> pulihkan rekan yang tumbang · <kbd>Tab</kbd> tas · <kbd>V</kbd> kamera 1/3 · <kbd>M</kbd> peta · <kbd>Esc</kbd> jeda / tutup tas &amp; peta</p></li>
          <li><span>Terjun</span><p><kbd>W</kbd> + kamera datar melayang jauh · <kbd>W</kbd> + kamera menunduk menukik · <kbd>A</kbd><kbd>D</kbd> geser · <kbd>S</kbd> mengerem (payung: turun lebih pelan)</p></li>
          <li><span>Tas</span><p><kbd>Tab</kbd> buka · klik barang untuk mengambil · <kbd>Klik kanan</kbd> barang di inventaris untuk membuang (senjata, peluru, obat, granat, jeriken, rompi, helm, tas) · tas lv.1–3 menambah kapasitas</p></li>
          <li><span>Aksesori</span><p>Magasin panjang (+50 % isi magasin) dan Scope 2× / 4× langsung terpasang ke senjata yang cocok saat diambil · seret aksesori ke senjata lain untuk memindahkan · <kbd>Klik kanan</kbd> aksesori di kartu senjata untuk melepas</p></li>
          <li><span>Kendaraan</span><p><kbd>W</kbd><kbd>S</kbd> gas/rem · <kbd>A</kbd><kbd>D</kbd> setir · <kbd>Spasi</kbd> rem tangan · <kbd>Shift</kbd> boost (bensin lebih boros) · <kbd>B</kbd> isi bensin dari jeriken (saat berhenti) · <kbd>H</kbd> klakson · <kbd>F</kbd> turun · <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>4</kbd> pindah kursi</p></li>
          <li><span>Jeriken</span><p>Di tanah meledak setelah kena 3 peluru, atau langsung bila terkena ledakan granat / kendaraan</p></li>
        </ul>
        <div class="lb-set-row"><a class="lb-btn ghost" href="index.html">${ic('map', 'lb-i-s')}Peta digital twin</a><button type="button" class="lb-btn ghost danger" data-act="reset">Atur ulang profil</button></div>`;
    },
  };

  // ---------- gambar ulang ----------
  function drawMini() {
    const q = questState();
    $('[data-mini]').innerHTML = `<button type="button" class="lb-mini-h" data-go="misi"><b>Misi harian</b><span>${ic('clock', 'lb-i-s')}${fmtLeft(q.dailyMs)}</span></button>
      ${q.daily.map((x) => questRow(x, true)).join('')}
      <button type="button" class="lb-mini-f" data-go="misi">${q.claimable ? `${coin}<b>${fmt(q.claimable)}</b> koin siap diklaim` : 'Lihat semua misi'}<span aria-hidden="true">›</span></button>`;
    for (const d of $$('[data-dot]')) d.hidden = !(d.dataset.dot === 'misi' && q.claimable > 0);
  }
  const tagEls = $$('.lb-nt'), tagXY = [0, 0], tagLast = [0, 0, 0, 0, 0, 0, 0, 0];
  function drawSquad() {
    const sq = ensureSquad(), me = skinById(profile.equipped.character) || CHAR_SKINS[0];
    const on = partySlots(), n = 1 + on.filter(Boolean).length;
    tagEls.forEach((el, i) => { el.querySelector('b').textContent = i === 0 ? profile.name : sq[i - 1].name; el.hidden = i > 0 && !on[i - 1]; });
    // kartu anggota; rekan bot bisa dikeluarkan (×); slot kosong = tombol + (tambah bot / pemain online)
    const card = (i, name, s, bot) => `<span class="lb-mw"><button type="button" class="lb-m" data-look="${i}" style="--rc:${rar(s).color}"><span class="lb-ava">${i + 1}</span><span class="lb-m-t"><b>${esc(name)}</b><small>${esc(s.name)}</small></span><em>${bot ? 'Bot' : 'Kamu'}</em></button>${bot ? `<button type="button" class="lb-m-x" data-kick="${i}" aria-label="Keluarkan ${esc(name)} dari regu" title="Keluarkan dari regu">×</button>` : ''}</span>`;
    const empty = (i) => `<span class="lb-mw"><button type="button" class="lb-m lb-m-add" data-add="${i}" aria-label="Tambah anggota regu di slot ${i + 1}"><span class="lb-ava">+</span><span class="lb-m-t"><b>Tambah</b><small>Bot / online</small></span></button></span>`;
    $('[data-squad]').innerHTML = card(0, profile.name, me, false) + sq.map((m, i) => (on[i] ? card(i + 1, m.name, skinById(m.skin) || CHAR_SKINS[0], true) : empty(i + 1))).join('');
    $('[data-modeb]').textContent = n === 1 ? 'Solo' : 'Regu · ' + n + ' orang';
    $('[data-modee]').textContent = (n === 4 ? 25 : 26) + ' regu · 100 petarung';
    $('[data-startsub]').textContent = n === 1 ? 'Terjun sendirian' : 'Terjun bersama regu';
  }
  function drawDiff() {
    for (const b of $$('[data-diff]')) b.setAttribute('aria-checked', String(b.dataset.diff === diff));
    $('.lb-diff').dataset.level = diff;
    $('[data-diffnote]').textContent = DIFF[diff].note;
  }
  function drawPanel() {
    if (!panel) return;
    const top = elBody.scrollTop;
    $('[data-ptitle]').textContent = TITLE[panel];
    elBody.innerHTML = P[panel]();
    elBody.scrollTop = top;
    fillThumbs(elBody);
  }
  function setCoins() {
    $('[data-name]').textContent = profile.name;
    if (profile.coins === shownCoins) { $('[data-coins]').textContent = fmt(shownCoins); return; }
    const from = shownCoins, to = profile.coins, t0 = performance.now(), el = $('[data-coins]'), id = ++coinAnim;
    shownCoins = to;
    el.parentElement.classList.remove('bump'); void el.offsetWidth; el.parentElement.classList.add('bump');
    const step = (t) => { if (id !== coinAnim) return; const k = clamp((t - t0) / 700, 0, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function refresh() { drawMini(); drawSquad(); drawPanel(); setCoins(); }
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'lb-t ' + kind;
    el.innerHTML = msg;
    elToast.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }
  function go(id) {
    if (id && !P[id]) return;
    drawMini();
    const was = panel;
    panel = id;
    for (const b of $$('.lb-nav [data-go]')) { if (b.dataset.go === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    menu.classList.toggle('lb-open', !!id);
    elPanel.setAttribute('aria-hidden', String(!id));
    if (was === 'toko' || was === 'koleksi') { stage.build(0); stage.gunPreview(profile.equipped.weapon); } // pratinjau dibatalkan
    if (id === 'toko') { shopTab = 'char'; selSkin = ''; }
    if (id === 'koleksi') selSkin = profile.equipped.character;
    stage.setOffset(id ? 0.2 : 0);
    lookI = -1;
    stage.aim(id === 'toko' || id === 'koleksi' ? 'member' : 'squad', 0);
    if (id) { elBody.scrollTop = 0; drawPanel(); preview(); }
    if (id) elPanel.querySelector('header button').focus({ preventScroll: true });
  }
  function preview() { // skin yang dipilih di toko/koleksi langsung tampak di karakter 3D (tanpa disimpan)
    if (panel !== 'toko' && panel !== 'koleksi') return;
    const s = skinById(selSkin);
    if (!s) return;
    if (s.id.startsWith('gun_')) { stage.build(0); stage.gunPreview(s.id); stage.aim('gun', 0); } else { stage.preview(s.id); stage.gunPreview(profile.equipped.weapon); stage.aim('member', 0); }
  }
  function career() { // ringkasan karier dari profile.stats (diisi quests.applyMatch tiap akhir pertandingan)
    const st = profile.stats || {};
    return [['Pertandingan', fmt(st.matches || 0)], ['Menang', fmt(st.wins || 0)], ['Kill', fmt(st.kills || 0)], ['Peringkat terbaik', st.bestRank ? '#' + st.bestRank : '–'], ['Koin dari misi', fmt(st.earned || 0)]];
  }

  // ---------- dialog ----------
  let modalClose = null;
  function modal(html, onOpen) {
    elModal.innerHTML = `<div class="lb-dlg" role="dialog" aria-modal="true">${html}</div>`;
    elModal.hidden = false;
    const back = document.activeElement;
    modalClose = () => { elModal.hidden = true; elModal.innerHTML = ''; modalClose = null; if (back && back.isConnected) back.focus({ preventScroll: true }); };
    const f = elModal.querySelector('[autofocus], input, button');
    if (f) f.focus({ preventScroll: true });
    if (onOpen) onOpen(elModal.querySelector('.lb-dlg'));
  }
  function confirmBuy(id) {
    const s = skinById(id);
    if (!s || owns(id)) return;
    modal(`<h3>Beli skin ini?</h3><div class="lb-dlg-s" style="--rc:${rar(s).color}">${thumb(s)}<div><span class="lb-rar">${esc(rar(s).label)}</span><b>${esc(s.name)}</b><p>${coin}<b>${fmt(s.price)}</b> · sisa ${fmt(profile.coins - s.price)} koin</p></div></div>
      <div class="lb-dlg-a"><button type="button" class="lb-btn ghost" data-act="cancel">Batal</button><button type="button" class="lb-btn gold" data-act="dobuy" data-id="${id}" autofocus>Beli</button></div>`, (d) => fillThumbs(d));
  }
  function renameDlg() {
    modal(`<h3>Nama pemain</h3><input type="text" maxlength="14" value="${esc(profile.name)}" data-newname aria-label="Nama pemain" spellcheck="false" autocomplete="off" autofocus>
      <div class="lb-dlg-a"><button type="button" class="lb-btn ghost" data-act="cancel">Batal</button><button type="button" class="lb-btn gold" data-act="dorename">Simpan</button></div>`, (d) => d.querySelector('input').select());
  }

  // ---------- kejadian ----------
  function setDiff(k) {
    if (!DIFF[k]) return;
    diff = k;
    try { localStorage.setItem('royale.diff', k); } catch (e) { /* abaikan */ }
    o.onDiff(k);
    drawDiff();
  }
  menu.addEventListener('click', (e) => {
    const t = e.target.closest('button, a, [data-go]');
    if (!t || !menu.contains(t)) { if (e.target === elModal && modalClose) modalClose(); return; }
    const d = t.dataset;
    if (t.id === 'playBtn') { o.onStart(); return; }
    if (d.diff) { setDiff(d.diff); return; }
    if (d.go !== undefined) { go(d.go === panel && d.go !== '' && t.closest('.lb-nav') ? '' : d.go); return; }
    if (d.tab) { shopTab = d.tab; selSkin = ''; drawPanel(); preview(); return; }
    if (d.skin) { selSkin = d.skin; drawPanel(); preview(); return; }
    if (d.claim) { const [scope, i] = d.claim.split(':'), got = claimQuest(scope, +i); if (got) toast(`${coin}<b>+${fmt(got)}</b> Koin Sutera`, 'gold'); refresh(); return; }
    if (d.buy) { confirmBuy(d.buy); return; }
    if (d.equip) { const s = skinById(d.equip), slot = d.equip.startsWith('gun_') ? 'weapon' : 'character'; if (s && equip(slot, d.equip)) { toast(`${ic('check')}<b>${esc(s.name)}</b> dipakai`); stage.build(0); stage.gunPreview(profile.equipped.weapon); } refresh(); return; }
    if (d.add !== undefined) { // slot kosong: pilih pengisi (bot sekarang; pemain online belum ada servernya)
      const i = +d.add;
      modal(`<h3>Tambah anggota</h3><p>Pilih siapa yang mengisi slot ${i + 1} regumu.</p>
        <div class="lb-opts">
          <button type="button" class="lb-opt" data-act="addbot" data-id="${i}" autofocus><b>Rekan bot</b><small>Mengikutimu, ikut menembak, dan bisa menghidupkanmu kembali.</small></button>
          <button type="button" class="lb-opt" disabled><b>Pemain online</b><small>Belum tersedia — game ini belum punya server multipemain.</small></button>
        </div>
        <div class="lb-dlg-a"><button type="button" class="lb-btn ghost" data-act="cancel">Batal</button></div>`);
      return;
    }
    if (d.kick !== undefined) { const i = +d.kick; setParty(i - 1, false); lookI = -1; stage.build(i); stage.aim('squad'); refresh(); return; }
    if (d.look !== undefined) { const i = +d.look; lookI = lookI === i ? -1 : i; stage.aim(lookI < 0 ? 'squad' : 'member', i); return; } // klik lagi = kembali melihat seluruh regu
    switch (d.act) {
      case 'claimall': { const got = claimAll(); if (got) toast(`${coin}<b>+${fmt(got)}</b> Koin Sutera`, 'gold'); refresh(); break; }
      case 'reroll': modal(`<h3>Acak ulang misi harian?</h3><p>Misi harian yang belum diklaim diganti dan kemajuannya hilang. Hanya bisa sekali sehari.</p><div class="lb-dlg-a"><button type="button" class="lb-btn ghost" data-act="cancel">Batal</button><button type="button" class="lb-btn gold" data-act="doreroll" autofocus>Acak ulang</button></div>`); break;
      case 'doreroll': if (modalClose) modalClose(); if (rerollDaily()) toast(`${ic('refresh')}Misi harian diganti`); refresh(); break;
      case 'rename': renameDlg(); break;
      case 'dorename': { const v = elModal.querySelector('[data-newname]').value; if (setName(v)) { if (modalClose) modalClose(); refresh(); } break; }
      case 'dobuy': { const s = skinById(d.id); if (modalClose) modalClose(); if (s && buy(s.id, s.price)) { toast(`${ic('check')}<b>${esc(s.name)}</b> jadi milikmu`, 'gold'); selSkin = s.id; } else toast('Koin belum cukup', 'warn'); refresh(); break; }
      case 'reset': modal(`<h3>Atur ulang profil?</h3><p>Koin, skin yang dibeli, misi, dan nama regu dihapus dari peramban ini. Tidak bisa dibatalkan.</p><div class="lb-dlg-a"><button type="button" class="lb-btn ghost" data-act="cancel" autofocus>Batal</button><button type="button" class="lb-btn danger" data-act="doreset">Hapus</button></div>`); break;
      case 'doreset': try { localStorage.removeItem('royale.profile.v1'); } catch (er) { /* abaikan */ } location.reload(); break;
      case 'addbot': { const i = +d.id; if (modalClose) modalClose(); if (setParty(i - 1, true)) { stage.build(i); if (panel === 'regu') stage.aim('member', i); else stage.refit(); toast(`${ic('check')}<b>${esc(ensureSquad()[i - 1].name)}</b> bergabung ke regu`); } refresh(); break; }
      case 'cancel': if (modalClose) modalClose(); break;
      default:
    }
  });
  menu.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-sens]')) { sens = parseFloat(t.value); $('[data-sensval]').textContent = sens.toFixed(1); o.onSens(sens); try { localStorage.setItem('royale.sens', String(sens)); } catch (er) { /* abaikan */ } }
  });
  menu.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-mname]')) { const i = +t.dataset.mname; if (i === 0) { if (!setName(t.value)) t.value = profile.name; } else setMate(i - 1, { name: t.value }); drawSquad(); setCoins(); }
    if (t.matches('[data-mskin]')) { const i = +t.dataset.mskin; setMate(i - 1, { skin: t.value }); stage.build(i); stage.aim('member', i); drawSquad(); drawPanel(); }
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-newname]')) { e.preventDefault(); elModal.querySelector('[data-act="dorename"]').click(); }
    if (e.key === 'Enter' && e.target.matches('[data-mname]')) { e.preventDefault(); e.target.blur(); }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.matches('[data-diff]')) { // radiogroup: panah berpindah pilihan
      const keys = Object.keys(DIFF), i = keys.indexOf(diff) + (e.key === 'ArrowRight' ? 1 : -1);
      if (keys[i]) { setDiff(keys[i]); $(`[data-diff="${keys[i]}"]`).focus(); }
    }
  });
  const onKey = (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') { if (modalClose) { modalClose(); e.preventDefault(); } else if (panel) { go(''); e.preventDefault(); } }
  };
  addEventListener('keydown', onKey);

  // ---------- akhir pertandingan ----------
  matchHooks.onEnd = (summary) => { lastSummary = summary || {}; try { lastDeltas = applyMatch(lastSummary); } catch (e) { lastDeltas = []; console.warn('Misi tidak diperbarui:', e); } };
  function showEnd() {
    const s = lastSummary || {}, win = !!s.win, rank = s.squadRank ?? s.rank, total = s.squads ?? s.total, squad = !!s.squadMode || (total > 0 && total <= 30);
    const mm = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
    const stats = [['Kill', fmt(s.kills || 0)], ['Kerusakan', fmt(s.damage || 0)], ['Bertahan', mm(s.surviveSec || 0)]];
    if (s.headshots !== undefined) stats.push(['Tembakan kepala', fmt(s.headshots)]);
    if (s.knocks !== undefined) stats.push(['Menjatuhkan', fmt(s.knocks)]);
    if (s.assists !== undefined) stats.push(['Assist', fmt(s.assists)]);
    if (s.revives !== undefined) stats.push(['Revive', fmt(s.revives)]);
    if (s.longestKillM) stats.push(['Kill terjauh', fmt(s.longestKillM) + ' m']);
    const q = questState(), dl = lastDeltas;
    const rows = dl.length ? dl.map((c) => {
      const a = c.after, from = c.before.p / Math.max(1, a.n), to = a.p / Math.max(1, a.n);
      return `<div class="lb-q lb-q-c ${a.complete ? 'done' : ''}"><span class="lb-q-i">${ic(a.icon)}</span><div class="lb-q-m"><p>${esc(a.text)}<small>${a.scope === 'weekly' ? 'Mingguan' : 'Harian'} · ${esc(fmtProgress(a))}</small></p><div class="lb-bar"><i data-from="${from}" data-to="${to}" style="transform:scaleX(${from})"></i></div></div><span class="lb-q-r">${a.complete ? `${coin}<b>+${fmt(a.reward)}</b>` : Math.round(to * 100) + '%'}</span></div>`;
    }).join('') : '<p class="lb-foot">Belum ada misi yang bergerak di pertandingan ini.</p>';
    endEl.className = 'lb lb-end' + (win ? ' win' : '');
    endEl.innerHTML = `<div class="lb-end-card">
      <div class="lb-end-l">
        <span class="lb-end-k">${squad ? 'Mode regu' : 'Pertandingan'} · bot ${esc((DIFF[s.diff] || DIFF[diff]).label.toLowerCase())}</span>
        <h2>${win ? 'Juara #1' : 'Tersingkir'}</h2>
        <p class="lb-end-sub">${win ? (squad ? 'Regumu yang terakhir bertahan di Alam Sutera.' : 'Kamu yang terakhir bertahan di Alam Sutera.') : rank ? `Peringkat <b>#${rank}</b>${total ? ' dari ' + total + (squad ? ' regu' : ' pemain') : ''}` : 'Pertandingan selesai.'}</p>
        <div class="lb-end-stats">${stats.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
        <div class="lb-end-a"><button type="button" class="lb-start small" data-act="again">${ic('play')}<b>Main lagi</b></button><button type="button" class="lb-btn ghost" data-act="lobby">Kembali ke lobi</button></div>
        <p class="lb-end-car">${career().slice(0, 4).map(([k, v]) => `<span><b>${v}</b> ${k.toLowerCase()}</span>`).join('')}</p>
      </div>
      <div class="lb-end-r">
        <div class="lb-sec"><h3>Kemajuan misi</h3></div>
        <div class="lb-qs">${rows}</div>
        <div class="lb-sum"><div>${coin}<p data-endsum>${q.claimable ? `<b>${fmt(q.claimable)}</b> koin siap diklaim` : 'Belum ada hadiah untuk diklaim'}</p></div><button type="button" class="lb-btn gold" data-act="endclaim"${q.claimable ? '' : ' disabled'}>Klaim</button></div>
        <p class="lb-end-bal">Saldo: ${coin}<b data-endcoins>${fmt(profile.coins)}</b> Koin Sutera</p>
      </div></div>`;
    endEl.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const b of endEl.querySelectorAll('.lb-bar i[data-to]')) b.style.transform = `scaleX(${b.dataset.to})`; }));
    const f = endEl.querySelector('[data-act="again"]');
    if (f) f.focus({ preventScroll: true });
  }
  endEl.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.act === 'endclaim') {
      const got = claimAll();
      if (got) { endEl.querySelector('[data-endsum]').innerHTML = `<b>+${fmt(got)}</b> koin diklaim`; endEl.querySelector('[data-endcoins]').textContent = fmt(profile.coins); t.disabled = true; t.textContent = 'Diklaim'; }
    } else if (t.dataset.act === 'again') { try { sessionStorage.setItem('royale.again', '1'); } catch (er) { /* abaikan */ } location.reload(); }
    else if (t.dataset.act === 'lobby') location.reload();
  });

  drawDiff();
  refresh();
  if (again) { toast(`${ic('play')}Ronde berikutnya siap. Tekan <b>Mulai</b>.`); requestAnimationFrame(() => { const b = document.getElementById('playBtn'); if (b) b.focus({ preventScroll: true }); }); }
  // hitung mundur misi & pergantian hari saat lobi dibiarkan terbuka (sekali per menit; tidak menyentuh DOM kalau tak berubah)
  const tick = setInterval(() => { if (!menu.hidden) { drawMini(); if (panel === 'misi') drawPanel(); } }, 60000);

  return {
    focus: stage.focus,
    get diff() { return diff; },
    frame(dt, t) {
      stage.frame(dt, t);
      for (let i = 0; i < 4; i++) { // label nama mengikuti kepala (ditulis hanya bila bergeser ≥ 0,5 px)
        const el = tagEls[i], ok = stage.headXY(i, tagXY), x = ok ? Math.round(tagXY[0] * 2) / 2 : -9999, y = ok ? Math.round(tagXY[1] * 2) / 2 : -9999;
        if (x !== tagLast[i * 2] || y !== tagLast[i * 2 + 1]) { tagLast[i * 2] = x; tagLast[i * 2 + 1] = y; el.style.transform = `translate(${x}px, ${y}px)`; }
      }
    },
    hide() {
      clearInterval(tick);
      removeEventListener('keydown', onKey);
      if (modalClose) modalClose();
      menu.hidden = true;
      document.body.classList.remove('lb-on');
      stage.hide();
      camera.fov = 75;
      camera.updateProjectionMatrix();
    },
    showEnd,
  };
}
