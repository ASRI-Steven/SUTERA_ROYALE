// HUD battle royale v2 (berbasis ikon): kartu senjata dengan siluet model asli + peluru, darah (jejak kerusakan, pratinjau obat),
// helm/rompi, perban/P3K/granat, jumlah pemain & kill, kompas, minimap + status zona, kill feed bergambar, penanda kena,
// arah tembakan, ambil barang, panel terjun payung & kendaraan. Seluruh DOM HUD dibuat di sini (royale.html hanya wadah #hud).
// Regu: jumlah regu tersisa, panel 4 anggota (darah + keadaan), penanda rekan di dunia (mates(buf), tiap frame), cincin
// pemulihan, panel "kamu tumbang", bilah menonton rekan, warna nama rekan di kill feed.
//
// Biaya per frame dijaga sekecil mungkin:
// - frame(…)  : tiap frame, hanya kompas, panah minimap & bidikan, dan hanya menulis ke DOM kalau nilainya berubah.
// - update(s) : ±20×/dtk (pemanggil bertanya dulu lewat due(t)); semua tulisan ke DOM lewat pemeriksaan "berubah?".
// - minimap digambar ulang ≤ 10×/dtk; animasi memakai transform/opacity CSS; tanpa backdrop-filter di atas kanvas 3D.
// - siluet = <img> biasa dan busur arah tembakan = SVG: CSS mask pada elemen yang muncul-hilang/beranimasi meninggalkan
//   kotak warna sesaat di compositor Chrome (terlihat saat uji), jadi tidak dipakai.
import { drawMinimap } from '../map/mapview.js';
import { WEAPONS, NADES } from './weapons.js';
import { ITEMS } from './loot.js';
import { itemIcon, silhouette, warmIcons } from './icons.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const R2D = 180 / Math.PI;
const wrapDeg = (d) => { d %= 360; return d > 180 ? d - 360 : d < -180 ? d + 360 : d; };

// ---------- Glif (SVG 24×24, satu warna = currentColor) ----------
const GLYPHS = {
  alive: '<circle cx="12" cy="7.2" r="3.7"/><path d="M4.5 20.5c0-4.4 3.3-7.2 7.5-7.2s7.5 2.8 7.5 7.2z"/>',
  kill: '<path fill-rule="evenodd" d="M12 2.5c-4.7 0-8.2 3.3-8.2 7.7 0 2.6 1.2 4.7 3.1 6v2.6c0 .9.7 1.7 1.7 1.7h1v-1.8h1.5v1.8h1.8v-1.8h1.5v1.8h1c1 0 1.7-.8 1.7-1.7v-2.6c1.9-1.3 3.1-3.4 3.1-6 0-4.4-3.5-7.7-8.2-7.7zM8.6 9.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6.8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13.6l1.2 2.3h-2.4z"/>',
  helm: '<path d="M4 13.5C4 8.3 7.6 4.6 12 4.6s8 3.7 8 8.9v2.2H4z"/><path d="M6.2 16.8h1.7c.3 2 1.8 3.2 4.1 3.2s3.8-1.2 4.1-3.2h1.7c-.3 3-2.5 4.9-5.8 4.9s-5.5-1.9-5.8-4.9z" opacity=".6"/>',
  vest: '<path fill-rule="evenodd" d="M7.2 3.2h2.3c.4 1.4 1.3 2.2 2.5 2.2s2.1-.8 2.5-2.2h2.3l2.7 3.4-1.2 2.2v9.9c0 .9-.7 1.6-1.6 1.6H7.3c-.9 0-1.6-.7-1.6-1.6V8.8L4.5 6.6zM11.55 7.6v12.7h.9V7.6zM7.4 10.3v1.3h2.9v-1.3zm6.3 0v1.300h2.900v-1.300zm0 3.500v3.400h2.900v-3.400z"/>',
  band: '<g transform="rotate(-45 12 12)"><path fill-rule="evenodd" d="M4.5 8h15a3.5 3.5 0 0 1 3.500 3.500v1a3.500 3.500 0 0 1-3.500 3.500h-15A3.500 3.500 0 0 1 1 12.500v-1A3.500 3.500 0 0 1 4.500 8zm4.700 1.500v5h5.600v-5z"/><rect x="9.200" y="9.500" width="5.600" height="5" opacity=".5"/></g>',
  fuel: '<path fill-rule="evenodd" d="M5 4.5c0-.8.7-1.500 1.500-1.500h6c.8 0 1.500.7 1.500 1.500V11h1.200c1 0 1.800.8 1.800 1.800v4.400a.9.9 0 0 0 1.800 0V9.600l-1.900-1.900 1.100-1.100 2.300 2.300c.3.300.5.700.5 1.100v7.200a2.700 2.700 0 0 1-5.400 0v-4.400h-1.400V21H5zm2 1.500V10h5V6z"/>',
  bag: '<path fill-rule="evenodd" d="M9 3.5h6c.8 0 1.500.7 1.500 1.500v1.200c1.700.5 3 2.100 3 4v8.300c0 1.100-.9 2-2 2h-11c-1.100 0-2-.9-2-2v-8.300c0-1.900 1.300-3.500 3-4V5c0-.8.7-1.500 1.500-1.500zm.5 2v.5h5v-.5zm-2 8v4h9v-4z"/>',
  drink: '<path d="M8.5 2.5h7l1 3.2v14.1c0 1-.8 1.7-1.7 1.7H9.200c-1 0-1.700-.8-1.700-1.700V5.700z"/>',
  kit: '<path fill-rule="evenodd" d="M9 4.5h6c.8 0 1.5.7 1.5 1.5v1.500h2.300c1 0 1.700.800 1.700 1.700v8.600c0 1-.700 1.700-1.700 1.700H5.200c-1 0-1.700-.700-1.700-1.700V9.200c0-.900.700-1.700 1.700-1.700h2.300V6c0-.800.700-1.500 1.500-1.500zm.300 1.800v1.200h5.400V6.300zm1.500 4.400v1.900H8.900V15h1.900v1.900h2.400V15h1.900v-2.400h-1.900v-1.900z"/>',
  zone: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2.200a6.800 6.800 0 1 1 0 13.600 6.800 6.800 0 0 1 0-13.600z"/><circle cx="12" cy="12" r="2.600"/>',
  warn: '<path fill-rule="evenodd" d="M12 3.200c.600 0 1.100.300 1.400.800l7.600 13.300c.600 1.100-.200 2.400-1.400 2.400H4.400c-1.200 0-2-1.300-1.400-2.400L10.600 4c.300-.500.800-.800 1.400-.800zm-1 5.600v5.400h2V8.800zm0 7v2h2v-2z"/>',
  veh: '<path fill-rule="evenodd" d="M6.600 7.500h8.300c.700 0 1.300.300 1.700.900l2.200 3.100 1.700.400c.900.200 1.500 1 1.500 1.900V16c0 .600-.400 1-1 1h-1.300a2.700 2.700 0 0 1-5.400 0H9.700a2.700 2.700 0 0 1-5.400 0H3c-.600 0-1-.400-1-1v-3c0-.700.400-1.300 1-1.600l1.600-3.100c.400-.500 1.100-.800 2-.800zm.300 1.700-1.300 2.300h4.500V9.200zm4.900 0v2.300h5l-1.500-2.100a.500.500 0 0 0-.400-.200zM7 15.800a1.200 1.200 0 1 0 0 2.400 1.200 1.200 0 0 0 0-2.400zm10 0a1.200 1.200 0 1 0 0 2.400 1.200 1.200 0 0 0 0-2.400z"/>',
  blast: '<path d="M12 2l1.900 5.100 4.800-2.500-2.500 4.800L21.500 12l-5.300 2.600 2.500 4.800-4.800-2.500L12 22l-1.900-5.100-4.800 2.500 2.500-4.800L2.500 12l5.300-2.600-2.500-4.800 4.800 2.500z"/>',
  fall: '<path d="M10.800 3h2.400v9.200l3.300-3.300 1.700 1.700L12 16.800l-6.200-6.200 1.700-1.700 3.300 3.300zM4 19h16v2.200H4z"/>',
  drown: '<path d="M12 2.800c1.900 2.300 2.900 3.900 2.900 5.200a2.900 2.900 0 0 1-5.800 0c0-1.300 1-2.900 2.900-5.200z"/><path d="M2.500 14.200c1.600 0 1.600-1.400 3.200-1.400s1.600 1.400 3.100 1.400 1.600-1.400 3.200-1.400 1.600 1.400 3.200 1.400 1.600-1.400 3.100-1.400 1.600 1.400 3.200 1.400v2.200c-1.600 0-1.600-1.400-3.200-1.400s-1.500 1.400-3.100 1.400-1.600-1.400-3.200-1.400-1.600 1.400-3.200 1.400-1.500-1.400-3.100-1.400-1.600 1.400-3.200 1.400z"/><path d="M2.500 18.600c1.600 0 1.600-1.400 3.200-1.400s1.600 1.400 3.100 1.400 1.600-1.400 3.200-1.400 1.600 1.400 3.200 1.400 1.600-1.400 3.100-1.400 1.600 1.400 3.200 1.400v2.200c-1.600 0-1.600-1.400-3.200-1.400s-1.500 1.400-3.100 1.400-1.600-1.400-3.200-1.400-1.600 1.400-3.200 1.400-1.500-1.400-3.100-1.400-1.600 1.400-3.200 1.400z" opacity=".6"/>',
  head: '<path fill-rule="evenodd" d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 2.200a5.800 5.800 0 1 1 0 11.600 5.800 5.800 0 0 1 0-11.600z"/><circle cx="12" cy="12" r="2.400"/><path d="M11 1.500h2v4h-2zm0 17h2v4h-2zM1.500 11h4v2h-4zm17 0h4v2h-4z"/>',
  arrow: '<path d="M12 3l7 9.500h-4.300V21H9.300v-8.500H5z"/>',
  para: '<path d="M12 3c-5 0-9 3.600-9 8.200 1-.900 2-1.300 3-1.300s2 .400 3 1.300c1-.900 2-1.300 3-1.300s2 .400 3 1.300c1-.900 2-1.300 3-1.300s2 .400 3 1.300C21 6.600 17 3 12 3z"/><path d="M3.200 11.600 12 19.400l8.800-7.800M12 10.200v8.600" fill="none" stroke="currentColor" stroke-width="1.200" opacity=".75"/><circle cx="12" cy="20.300" r="1.800"/>',
  plane: '<path d="M12 2c.900 0 1.500 1.100 1.500 2.600v4.200l7.500 4.400v2.200l-7.500-2.300v4.300l2.300 1.700V21L12 20l-3.800 1v-1.900l2.300-1.700v-4.300L3 15.400v-2.200l7.500-4.400V4.600C10.500 3.100 11.100 2 12 2z"/>',
  steer: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2.200a6.800 6.800 0 0 1 6.600 5.100H5.400A6.800 6.800 0 0 1 12 5.200zm-6.800 7.300h3.900l1.700 2v4.200a6.800 6.800 0 0 1-5.600-6.200zm9.700 0h3.900a6.800 6.800 0 0 1-5.600 6.200v-4.200z"/>',
  grass: '<path d="M4 20c.500-4 1.500-7 3-9.500 0 3 .500 5.500 1 9.500zm5 0c.200-6 1.200-10.500 3-14 1.800 3.500 2.800 8 3 14zm7 0c.500-4 1-6.500 1-9.500 1.500 2.500 2.500 5.500 3 9.500z"/>',
  pin: '<path fill-rule="evenodd" d="M12 2.500A6.500 6.500 0 0 0 5.500 9c0 4.600 6.500 12.500 6.500 12.500S18.500 13.600 18.500 9A6.500 6.500 0 0 0 12 2.500zm0 4a2.500 2.500 0 1 1 0 5 2.500 2.500 0 0 1 0-5z"/>',
  plus: '<path d="M9.500 3.500h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
  air: '<circle cx="8" cy="15.500" r="4"/><circle cx="16" cy="9" r="3"/><circle cx="17.500" cy="17.500" r="1.800"/>',
  vault: '<path d="M12 3l6 6.200-1.700 1.700-3.100-3.200V16h-2.400V7.700l-3.100 3.200L6 9.200zM3 19h18v2.200H3z"/>',
  nav: '<path d="M12 2.500l7.500 17.500-7.500-3.800L4.500 20z"/>',
  squad: '<circle cx="12" cy="7" r="3.1"/><path d="M5.8 19.5c0-3.700 2.700-6 6.200-6s6.200 2.300 6.200 6z"/><g opacity=".7"><circle cx="4.9" cy="9.3" r="2.3"/><path d="M.8 18.3c0-2.800 1.800-4.700 4.300-4.700.6 0 1.200.1 1.700.3-1.400 1.200-2.300 3-2.400 5.100H.8z"/><circle cx="19.1" cy="9.3" r="2.3"/><path d="M23.2 18.3c0-2.800-1.800-4.700-4.300-4.700-.6 0-1.200.1-1.700.3 1.400 1.200 2.300 3 2.400 5.100h3.600z"/></g>',
  down: '<path d="M12 20.8l-1.300-1.200C5.900 15.300 3 12.600 3 9.300 3 6.600 5.100 4.500 7.800 4.500c1.600 0 3.100.7 4.200 1.900 1.100-1.200 2.600-1.900 4.200-1.900 2.700 0 4.800 2.100 4.800 4.800 0 3.300-2.900 6-7.700 10.300z"/>',
};
const SPRITE = '<svg class="h-sprite" aria-hidden="true" focusable="false">' + Object.entries(GLYPHS).map(([k, v]) => `<symbol id="hi-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('') + '</svg>';
const ic = (id, cls = '') => `<svg class="hi${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#hi-${id}"/></svg>`;

// ---------- Data tampilan ----------
const CW = 2.5; // lebar satu ruas kompas (15°) dalam em
const CARD = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];
const AMMO_COL = { light: '#e3b64a', rifle: '#8ccf5d', shell: '#e0645a', sniper: '#b6bf86', magnum: '#c98a4a' };
const EMPTY = ['Senjata utama', 'Senjata utama', 'Pistol', 'Granat'];
const modeOf = (d) => (d.bolt ? 'BOLT' : d.burst ? 'SEMBUR ' + d.burst : d.auto ? 'AUTO' : d.pellets ? (d.mag <= 2 ? 'GANDA' : 'POMPA') : 'SEMI');
const NADE_KEYS = Object.keys(NADES);
const VEH_KEYS = {
  drv: '<kbd>F</kbd> turun <kbd>Spasi</kbd> rem tangan <kbd>Shift</kbd> boost <kbd>B</kbd> isi bensin <kbd>H</kbd> klakson <kbd>V</kbd> kamera · klik kiri: pistol/SMG',
  pass: '<kbd>F</kbd> turun <kbd>B</kbd> isi bensin · klik kiri tembak · klik kanan bidik <kbd>R</kbd> isi ulang <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> senjata <kbd>V</kbd> kamera',
};
const WHY = { zone: 'tersingkir di luar zona', fall: 'jatuh dari kendaraan', crash: 'tewas dalam tabrakan', blast: 'terkena ledakan', run: 'tertabrak kendaraan', drown: 'tenggelam' };
const WHY_IC = { zone: 'zone', fall: 'fall', crash: 'veh', blast: 'blast', run: 'veh', drown: 'drown' };
const WHY_KN = { zone: 'tumbang di luar zona', fall: 'tumbang terjatuh', crash: 'tumbang dalam tabrakan', blast: 'tumbang terkena ledakan', run: 'tumbang tertabrak' };
// regu: ikon keadaan anggota di panel regu (ok = tanpa ikon)
const SQ_IC = { down: 'down', rev: 'plus', dead: 'kill', veh: 'veh', air: 'para', plane: 'plane' };
// nama barang → jenis (ikon ambil barang & prompt, tanpa kait tambahan di player.js)
const NAME2TYPE = new Map();
for (const [t, d] of Object.entries(ITEMS)) if (d.name) NAME2TYPE.set(d.name.toLowerCase().replace(/ ×\d+$/, ''), t);
NAME2TYPE.set('p3k', 'h_kit');
function typeOfText(txt) {
  const t = String(txt).toLowerCase().replace(/ ×\d+$/, '').trim();
  if (NAME2TYPE.has(t)) return NAME2TYPE.get(t);
  if (t.startsWith('dari peti')) return 'crate';
  return null;
}
function iconHtml(type) { // gambar kecil barang: siluet untuk senjata/granat, ikon model untuk yang lain
  const d = type && ITEMS[type];
  if (!d) return '';
  const kind = d.kind === 'weapon' ? d.w : d.kind === 'nade' ? d.nade : '';
  if (kind) { const s = silhouette(kind); if (s) return `<img class="sil" src="${s.url}" alt="" draggable="false">`; }
  const u = itemIcon(type);
  return u ? `<img src="${u}" alt="" draggable="false">` : '';
}

// busur arah datangnya tembakan (di atas = depan), diputar per kejadian
const DMG_ARC = '<svg viewBox="-100 -100 200 200" aria-hidden="true"><path class="o" d="M-41 -80A90 90 0 0 1 41 -80"/><path d="M-41 -80A90 90 0 0 1 41 -80"/></svg>';
const TEMPLATE = SPRITE + `
<div class="h-vig" data-h="vig"></div>
<div class="h-mates" data-h="mates"></div>
<div class="h-scope" data-h="scope" hidden><i></i></div>
<div class="h-top">
  <div class="h-compass"><div class="h-compass-strip" data-h="compass"></div><i class="h-cmark zone" data-h="cZone" hidden>${ic('zone')}</i><i class="h-cmark way" data-h="cWay" hidden>${ic('pin')}</i></div>
  <div class="h-bearing"><b data-h="deg">0</b><span data-h="card">U</span></div>
  <div class="h-loc" data-h="loc" hidden></div>
  <div class="h-plane wait" data-h="plane" hidden>${ic('plane')}<kbd>F</kbd><span data-h="planeL">Menuju kawasan</span><div class="hpl-bar"><i class="win" data-h="planeWin"></i><i class="pos" data-h="planePos"></i></div><b data-h="planeT"></b></div>
</div>
<div class="h-tl">
  <div class="h-count">
    <div class="hc" data-h="aliveBox">${ic('alive')}<b data-h="alive">–</b><span>Tersisa</span></div>
    <div class="hc sq" data-h="sqBox" title="Regu tersisa">${ic('squad')}<b data-h="squads">–</b><span>Regu</span></div>
    <div class="hc gold" data-h="killBox">${ic('kill')}<b data-h="kills">0</b><span>Kill</span></div>
  </div>
  <div class="h-squad" data-h="squad"></div>
  <div class="h-feed" data-h="feed" role="log"></div>
</div>
<div class="h-tr">
  <div class="h-map"><canvas data-h="map"></canvas><svg class="h-map-me" data-h="mapMe" viewBox="0 0 24 24" aria-hidden="true"><use href="#hi-nav"/></svg><span class="h-map-n">U</span><span class="h-map-r" data-h="mapR"></span><kbd class="h-map-k">M</kbd></div>
  <div class="h-zone pre" data-h="zone">
    <div class="hz-main"><span class="hz-ic" data-h="zoneI">${ic('zone')}</span><div class="hz-tx"><span data-h="zoneL">Kawasan aman</span><em data-h="zoneS"></em></div><b data-h="zoneT">–</b></div>
    <div class="hz-bar"><i data-h="zoneB"></i></div>
    <div class="hz-go" data-h="zoneGo" hidden><svg class="hi hz-arrow" data-h="zoneArr" viewBox="0 0 24 24" aria-hidden="true"><use href="#hi-nav"/></svg><span data-h="zoneGoT"></span></div>
  </div>
</div>
<div class="h-msg" data-h="msg"></div>
<div class="h-flash" data-h="flash"></div>
<div class="h-cross" data-h="cross"><i></i><i></i><i></i><i></i><b></b></div>
<div class="h-hit" data-h="hit"><i></i><i></i><i></i><i></i></div>
<div class="h-dmg" data-h="dmg"></div>
<div class="h-act" data-h="act" hidden><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="t" cx="22" cy="22" r="19"/><circle class="v" data-h="actRing" cx="22" cy="22" r="19" pathLength="100"/></svg><div class="h-act-tx"><span data-h="actL"></span><b data-h="actT"></b></div></div>
<div class="h-prompt" data-h="prompt" hidden><kbd>F</kbd><span class="hpr-ic" data-h="promptI"></span><span data-h="promptT"></span></div>
<div class="h-hide" data-h="hide" hidden>${ic('grass')}<span data-h="hideT"></span></div>
<div class="h-picks" data-h="picks"></div>
<div class="h-toast" data-h="toast"></div>
<div class="h-air" data-h="air" hidden>
  <div class="ha-tape"><i class="fill" data-h="airFill"></i><i class="auto" data-h="airAuto"></i></div>
  <div class="ha-info"><span class="cap">Ketinggian</span><div class="alt"><b data-h="airAlt">0</b><em>m</em></div>
    <div class="vs">${ic('arrow')}<b data-h="airVs">0</b><span>m/dtk</span></div><div class="st" data-h="airState"></div><small>Payung terbuka sendiri di 120 m</small></div>
</div>
<div class="h-veh" data-h="veh" hidden>
  <div class="hv-gauge"><svg viewBox="0 0 100 100" aria-hidden="true"><path class="t" d="M13.63 75A42 42 0 1 1 86.37 75" pathLength="100"/><path class="v" data-h="vehArc" d="M13.63 75A42 42 0 1 1 86.37 75" pathLength="100"/></svg><b data-h="vehSpd">0</b><span>km/j</span></div>
  <div class="hv-info">
    <div class="hv-head"><span data-h="vehName"></span><em data-h="vehRole"></em></div>
    <div class="hv-hp">${ic('veh')}<div class="hv-bar"><i data-h="vehHp"></i></div><b data-h="vehHpT"></b></div>
    <div class="hv-hp hv-fuel" data-h="vehFuelBox" title="Bensin">${ic('fuel')}<div class="hv-bar"><i data-h="vehFuel"></i></div><b data-h="vehFuelT"></b></div>
    <div class="hv-keys" data-h="vehKeys"></div>
  </div>
  <div class="hv-seats" data-h="vehSeats"></div>
</div>
<div class="h-down" data-h="down" hidden>
  <div class="hd-head">${ic('down')}<b>Kamu tumbang</b><em data-h="downT"></em></div>
  <div class="hd-bar"><i data-h="downB"></i></div>
  <span data-h="downH"></span>
</div>
<div class="h-spec" data-h="spec" hidden><span class="hs-tag">Menonton</span><i class="hs-dot"></i><b data-h="specN"></b><span class="hs-keys"><kbd>Spasi</kbd> / klik · rekan berikutnya <kbd>A</kbd> sebelumnya <kbd>M</kbd> peta</span></div>
<div class="h-dock">
  <div class="h-breath" data-h="breath" hidden>${ic('air')}<div><i data-h="breathB"></i></div><span data-h="breathT">Napas</span></div>
  <div class="h-weapons" data-h="weapons"></div>
  <div class="h-vitals">
    <div class="h-armor">
      <div class="ha" data-h="helm" title="Helm">${ic('helm')}<b></b><span class="pips"><i></i><i></i><i></i></span></div>
      <div class="ha" data-h="vest" title="Rompi">${ic('vest')}<b></b><span class="pips"><i></i><i></i><i></i></span></div>
    </div>
    <div class="h-hp" data-h="hpBox">
      ${ic('plus')}<div class="hp-track"><i class="hp-heal" data-h="hpHeal"></i><i class="hp-ghost nt" data-h="hpGhost"></i><i class="hp-fill" data-h="hpFill"></i><i class="hp-seg"></i></div><b class="hp-num" data-h="hpNum">100</b><i class="hp-boost" data-h="boost" title="Tenaga"></i>
    </div>
    <div class="h-items">
      <div class="hit" data-h="band" title="Perban"><i class="prog" data-h="bandP"></i><kbd>4</kbd>${ic('band')}<b data-h="bandN">0</b></div>
      <div class="hit" data-h="kit" title="Kotak P3K"><i class="prog" data-h="kitP"></i><kbd>5</kbd>${ic('kit')}<b data-h="kitN">0</b></div>
      <div class="hit" data-h="drink" title="Minuman energi"><i class="prog" data-h="drinkP"></i><kbd>6</kbd>${ic('drink')}<b data-h="drinkN">0</b></div>
      <div class="hit bag on" data-h="bag" title="Isi tas (bobot terpakai)"><i class="prog" data-h="bagP"></i><kbd data-h="bagL">Tas</kbd>${ic('bag')}<b data-h="bagN">0%</b></div>
    </div>
  </div>
</div>`;

export function createHud() {
  const root = $('hud');
  root.innerHTML = TEMPLATE;
  const el = { hud: root };
  root.querySelectorAll('[data-h]').forEach((n) => { el[n.dataset.h] = n; });
  const kb = createKillBanner(root); // spanduk kill bertema skin (blok mandiri di akhir berkas)
  // kompas: strip berulang 360° (3×) dengan arah mata angin bahasa Indonesia
  const NAMES = { 0: 'U', 45: 'TL', 90: 'T', 135: 'TG', 180: 'S', 225: 'BD', 270: 'B', 315: 'BL' };
  let strip = '';
  for (let rep = 0; rep < 3; rep++) for (let d = 0; d < 360; d += 15) strip += '<span' + (NAMES[d] !== undefined ? ' class="m' + (d % 90 === 0 ? ' c' : '') + '"' : '') + '><i>' + (NAMES[d] !== undefined ? NAMES[d] : d) + '</i></span>';
  el.compass.innerHTML = strip;
  // kartu senjata: 2 senjata utama, pistol, granat (elemen tetap; isinya diperbarui per bidang)
  const cards = [0, 1, 2, 3].map((i) => {
    const c = document.createElement('div');
    c.className = 'hw empty' + (i === 2 ? ' s2' : i === 3 ? ' sn' : '');
    c.innerHTML = `<kbd>${i === 3 ? 'G' : i + 1}</kbd><em class="hw-mode" hidden></em><img class="hw-sil" alt="" draggable="false" hidden><span class="hw-name">${EMPTY[i]}</span><span class="hw-ammo"><b></b><em${i === 3 ? ' hidden' : ''}></em></span><span class="hw-tag"></span><i class="hw-bar"></i>`;
    el.weapons.appendChild(c);
    return { el: c, mode: c.children[1], sil: c.children[2], name: c.children[3], mag: c.children[4].children[0], res: c.children[4].children[1], tag: c.children[5], bar: c.children[6], key: '', sel: false, sk: '', magV: null, resV: null, rk: 0 };
  });
  // regu: 4 baris tetap di panel (isi diperbarui per bidang) + penanda rekan di dunia (3 elemen, digeser lewat transform)
  const rows = [0, 1, 2, 3].map((i) => {
    const r = document.createElement('div');
    r.className = 'sq-row s' + i;
    r.hidden = true;
    r.innerHTML = `<i class="sq-n">${i + 1}</i><span class="sq-name"></span><span class="sq-st"><span></span><b></b></span><div class="sq-bar"><i></i></div>`;
    el.squad.appendChild(r);
    return { el: r, nameEl: r.children[1], ic: r.children[2].children[0], tEl: r.children[2].children[1], bar: r.children[3].firstChild, name: null, st: null, tv: null, hpk: -1 };
  });
  const marks = [1, 2, 3].map((i) => {
    const m = document.createElement('div');
    m.className = 'h-mate m' + i;
    m.innerHTML = `<div><span class="hm-tx"><span class="hm-n"></span><b class="hm-d"></b></span><i class="hm-p">${i + 1}</i></div>`;
    el.mates.appendChild(m);
    return { el: m, nameEl: m.firstChild.firstChild.children[0], dEl: m.firstChild.firstChild.children[1], st: 0, x: -1, y: -1, dk: -1, wait: 0 };
  });
  let iconsV = 0; // naik tiap ada siluet baru selesai → kartu & ikon digambar ulang
  warmIcons(() => { iconsV++; });

  let toastT = 0, msgT = 0, last = {}, alt = { hit: 0, flash: 0, kb: 0, vig: 0, pop: 0, sw: 0 };
  const set = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v); } };
  const restart = (node, base, key, extra = '') => { alt[key] ^= 1; node.className = base + ' on' + alt[key] + (extra ? ' ' + extra : ''); }; // putar ulang animasi CSS tanpa memaksa layout
  // keadaan per-frame
  let fDeg = -1, fDegI = -1, fCard = '', fGap = -2, fCk = null, fScoped = null, headDeg = 0, slowT = -1e9;
  let wayBear = NaN, zoneBear = NaN, fWay = null, fZone = null;
  // minimap
  let mapSize = 0, mapDpr = 1, mapCtx = null, mapT = -1e9;
  function measureMap() {
    const size = el.map.clientWidth;
    if (!size) return;
    mapDpr = Math.min(2, devicePixelRatio || 1);
    mapSize = size;
    const px = Math.round(size * mapDpr);
    if (el.map.width !== px) el.map.width = el.map.height = px;
    mapCtx = el.map.getContext('2d');
    mapT = -1e9;
  }
  let rsT = 0;
  addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (!root.hidden) measureMap(); }, 150); });
  function markers() { // penanda tujuan & zona aman di strip kompas (dijepit di tepi kalau di luar pandangan)
    const put = (node, bear, prev) => {
      if (bear !== bear) { if (prev !== 'h') node.hidden = true; return 'h'; }
      const x = Math.max(-14.6, Math.min(14.6, wrapDeg(bear - headDeg) / 15 * CW)), k = x.toFixed(2);
      if (prev === 'h' || prev === null) node.hidden = false;
      if (k !== prev) node.style.transform = 'translateX(' + k + 'em)';
      return k;
    };
    fWay = put(el.cWay, wayBear, fWay);
    fZone = put(el.cZone, zoneBear, fZone);
  }
  // penerbangan payung
  let airMax = 600, airPrev = 0, airPrevT = 0, airVs = 0;
  // kendaraan
  let seatDots = [];
  function buildSeats(v) {
    const n = v.occ.length, L = v.L || 4, W = v.W || 1.8, cz = v.cz || 0, pos = v.seats || [];
    el.vehSeats.style.height = Math.min(7.2, Math.max(3.6, 3.2 * L / W)).toFixed(2) + 'em';
    let h = '';
    for (let i = 0; i < n; i++) {
      const p = pos[i];
      const x = p ? 50 - p.x / W * 100 : 50, y = p ? 50 - (p.z - cz) / L * 100 : 20 + i * 60 / Math.max(1, n - 1);
      h += `<i class="${i === 0 ? 'drv' : ''}" style="left:${Math.max(16, Math.min(84, x)).toFixed(1)}%;top:${Math.max(12, Math.min(88, y)).toFixed(1)}%"></i>`;
    }
    el.vehSeats.innerHTML = h;
    seatDots = [...el.vehSeats.children];
  }
  // ---------- kartu senjata ----------
  function drawCard(i, s) {
    const c = cards[i], w = s.weapons[i], kind = w ? w.kind : '', sel = i === s.cur && !s.nadeHold && !!kind;
    const key = kind + '|' + (kind && silhouette(kind) ? 1 : 0);
    if (key !== c.key) {
      c.key = key;
      c.el.classList.toggle('empty', !kind);
      if (kind) {
        const d = WEAPONS[kind], sl = silhouette(kind);
        c.name.textContent = d.short;
        c.mode.textContent = modeOf(d); c.mode.hidden = false;
        c.sil.hidden = !sl;
        if (sl) c.sil.src = sl.url;
        c.res.style.setProperty('--ac', AMMO_COL[d.ammo] || '#aaa');
      } else { c.name.textContent = EMPTY[i]; c.mode.hidden = true; c.sil.hidden = true; c.mag.textContent = ''; c.res.textContent = ''; c.magV = c.resV = null; }
    }
    if (sel !== c.sel) { c.sel = sel; c.el.classList.toggle('sel', sel); c.el.classList.remove('sw0', 'sw1'); if (sel) { alt.sw ^= 1; c.el.classList.add('sw' + alt.sw); } }
    if (kind) {
      const d = WEAPONS[kind], res = s.ammo[d.ammo] || 0;
      if (w.mag !== c.magV) { c.magV = w.mag; c.mag.textContent = w.mag; }
      if (res !== c.resV) { c.resV = res; c.res.textContent = res; }
      const st = w.mag === 0 ? 2 : w.mag <= d.mag * 0.25 ? 1 : 0, rl = sel && s.reload > 0;
      const tag = rl ? 'Isi ulang' : st === 2 && sel ? (res > 0 ? 'R · isi ulang' : 'Peluru habis') : '';
      const sk = st + '|' + (rl ? 1 : 0) + '|' + tag;
      if (sk !== c.sk) { c.sk = sk; c.el.classList.toggle('low', st === 1); c.el.classList.toggle('dry', st === 2); c.el.classList.toggle('rl', rl); c.el.classList.toggle('tag', !!tag); c.tag.textContent = tag; }
      const rk = rl ? Math.max(1, Math.round(s.reload * 100)) : 0;
      if (rk !== c.rk) { c.rk = rk; c.bar.style.transform = 'scaleX(' + rk / 100 + ')'; }
    } else if (c.sk !== '') { c.sk = ''; c.el.classList.remove('low', 'dry', 'rl', 'tag'); c.tag.textContent = ''; if (c.rk) { c.rk = 0; c.bar.style.transform = 'scaleX(0)'; } }
  }
  function drawNade(s) {
    const c = cards[3], nd = s.nades || {};
    const selK = nd[s.nadeSel] > 0 ? s.nadeSel : NADE_KEYS.find((k) => nd[k] > 0) || '';
    let others = 0;
    for (const k of NADE_KEYS) if (k !== selK && nd[k] > 0) others += nd[k];
    const hold = !!s.nadeHold && !!selK, key = selK + '|' + (selK ? nd[selK] : 0) + '|' + others + '|' + (selK && silhouette(selK) ? 1 : 0);
    if (key !== c.key) {
      c.key = key;
      c.el.classList.toggle('empty', !selK);
      if (selK) {
        const sl = silhouette(selK);
        c.name.textContent = NADES[selK].short;
        c.mag.textContent = '×' + nd[selK];
        c.mode.textContent = others ? 'T ⇄' : ''; c.mode.hidden = !others;
        c.sil.hidden = !sl;
        if (sl) c.sil.src = sl.url;
      } else { c.name.textContent = EMPTY[3]; c.mag.textContent = ''; c.mode.hidden = true; c.sil.hidden = true; }
    }
    if (hold !== c.sel) { c.sel = hold; c.el.classList.toggle('sel', hold); }
  }
  // ---------- baris ambil barang ----------
  function pickup(text) {
    const type = typeOfText(text), row = document.createElement('div');
    row.className = 'pk';
    row.innerHTML = '<em>+</em>' + iconHtml(type) + '<span>' + esc(text.charAt(0).toUpperCase() + text.slice(1)) + '</span>';
    el.picks.prepend(row);
    while (el.picks.children.length > 4) el.picks.lastChild.remove();
    setTimeout(() => row.classList.add('out'), 2400);
    setTimeout(() => row.remove(), 2850);
  }
  function promptIcon(t) {
    if (t.startsWith('Ambil ')) return iconHtml(typeOfText(t.slice(6)));
    if (t.startsWith('Buka peti')) return iconHtml('crate');
    if (t.startsWith('Naik ') || t.startsWith('Kendaraan')) return ic('veh');
    if (t.startsWith('Lompati')) return ic('vault');
    return '';
  }

  let crateEl = null, crateKey = null, lpEl = null, lpKey = null, lpH = null;
  const RARC = ['#e9e7f2', '#5aa9ff', '#a58bff', '#ffcf6b'];
  return {
    el,
    // panel peti jarahan lama (daftar teks); panel bergambar di lootPanel
    crate(list) {
      const key = list ? list.map((e) => e.text).join('|') : '';
      if (key === crateKey) return;
      crateKey = key;
      if (!crateEl) { crateEl = document.createElement('div'); crateEl.className = 'h-crate'; crateEl.setAttribute('role', 'status'); el.hud.appendChild(crateEl); }
      crateEl.hidden = !list;
      if (list) crateEl.innerHTML = '<b>Peti jarahan</b>' + (list.length ? list.map((e, i) => `<div class="hc-row${i ? '' : ' hc-top'}"><kbd>${i + 1}</kbd><span>${esc(e.text)}</span></div>`).join('') : '<div class="hc-row">Kosong</div>') + '<small><kbd>F</kbd> ambil teratas · <kbd>1–9</kbd> pilih · menjauh untuk menutup</small>';
    },
    // panel loot: kiri inventaris (senjata, rompi/helm, isi tas), kanan isi peti / barang di sekitar (kartu bergambar)
    // model = { title, guns, gear, items, loot } atau null (tutup); h = { icon(type), take(i), takeAll(), close() }
    lootPanel(model, h) {
      if (h) lpH = h;
      if (!model) { if (lpEl) lpEl.hidden = true; lpKey = null; return; }
      if (!lpEl) {
        lpEl = document.createElement('div');
        lpEl.className = 'lp';
        lpEl.setAttribute('role', 'dialog');
        lpEl.setAttribute('aria-label', 'Inventaris dan barang');
        document.body.appendChild(lpEl);
        lpEl.addEventListener('mousedown', (e) => e.stopPropagation());
        lpEl.addEventListener('contextmenu', (e) => { // klik kanan barang di inventaris = buang ke tanah
          e.preventDefault();
          const t = e.target.closest('[data-drop]');
          if (t && lpH && lpH.drop) lpH.drop(t.dataset.drop);
        });
        // seret-dan-lepas aksesori: label aksesori → senjata lain (pindah) / kolom kanan (buang); kartu aksesori di sekitar → senjata (pasang)
        let drag = null;
        const clearHot = () => { for (const n of lpEl.querySelectorAll('.lp-hot')) n.classList.remove('lp-hot'); };
        const target = (e) => (drag ? e.target.closest('[data-gun]') || (drag.att ? e.target.closest('.lp-loot, .lp-bag') : drag.bag ? e.target.closest('.lp-loot') : null) : null);
        lpEl.addEventListener('dragstart', (e) => {
          const a = e.target.closest('.lp-att'), c = a ? null : e.target.closest('.lp-card[draggable="true"]'), b = a || c ? null : e.target.closest('.lp-item[draggable="true"]');
          if (!a && !c && !b) { e.preventDefault(); return; }
          drag = a ? { att: a.dataset.drop } : c ? { take: +c.dataset.take } : { bag: b.dataset.drop };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', a ? a.dataset.drop : c ? 'take' : b.dataset.drop);
          lpEl.classList.add('lp-dragging');
        });
        lpEl.addEventListener('dragover', (e) => { const t = target(e); clearHot(); if (t) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; t.classList.add('lp-hot'); } });
        lpEl.addEventListener('drop', (e) => {
          const t = target(e), d = drag;
          clearHot();
          if (!t || !d || !lpH) return;
          e.preventDefault();
          if (t.dataset.gun !== undefined) { if (d.att) lpH.moveAtt(d.att, +t.dataset.gun); else if (d.bag) lpH.bagTo(d.bag, +t.dataset.gun); else lpH.takeTo(d.take, +t.dataset.gun); }
          else if (d.att && t.classList.contains('lp-bag')) lpH.stashAtt(d.att); // ke tas: lepas & simpan
          else lpH.drop(d.att || d.bag); // ke kolom kanan: buang ke tanah
        });
        lpEl.addEventListener('dragend', () => { drag = null; clearHot(); lpEl.classList.remove('lp-dragging'); });
        lpEl.addEventListener('click', (e) => {
          const t = e.target.closest('[data-take],[data-all],[data-close]');
          if (!t || !lpH) { if (e.target === lpEl && lpH) lpH.close(); return; }
          if (t.dataset.take !== undefined) lpH.take(+t.dataset.take); else if (t.dataset.all !== undefined) lpH.takeAll(); else lpH.close();
        });
      }
      lpEl.hidden = false;
      const key = JSON.stringify(model);
      if (key === lpKey) return;
      lpKey = key;
      const img = (type, cls = '') => { const u = type && lpH && lpH.icon ? lpH.icon(type) : ''; return u ? `<img class="${cls}" src="${u}" alt="" draggable="false">` : `<span class="lp-noimg ${cls}"></span>`; };
      const gun = (g) => (g.type ? `<div class="lp-gun lp-drop" data-gun="${g.slot}" data-drop="w:${g.slot}" title="Klik kanan untuk membuang"><span class="lp-slot">${g.slot === 2 ? 3 : g.slot + 1}</span>${img(g.type, 'lp-gimg')}<div class="lp-gtx"><b>${esc(g.name)}</b><small>${g.mag}/${g.cap} · cadangan ${g.ammo}</small>${(g.att || []).length ? '<span class="lp-atts">' + g.att.map((a) => `<i class="lp-att lp-drop" draggable="true" data-drop="x:${g.slot}:${a.k}" title="${esc(a.name)} — seret ke senjata lain untuk memindahkan · klik kanan untuk melepas">${esc(a.name)}</i>`).join('') + '</span>' : ''}</div></div>`
        : `<div class="lp-gun lp-empty"><span class="lp-slot">${g.slot === 2 ? 3 : g.slot + 1}</span><small>${g.slot === 2 ? 'Slot pistol kosong' : 'Slot senjata kosong'}</small></div>`);
      const bag = (it) => `<div class="lp-item lp-drop"${/^x_/.test(it.type) ? ' draggable="true"' : ''} data-drop="${esc(it.type)}" title="${esc(it.name)} — ${/^x_/.test(it.type) ? 'seret ke senjata untuk memasang · ' : ''}klik kanan untuk membuang">${img(it.type)}<span class="lp-n">${it.n}</span><small>${esc(it.name)}</small></div>`;
      const gear = (g) => `<div class="lp-item lp-gear${g.type ? ' lp-drop' : ' lp-empty'}"${g.type ? ` data-drop="${esc(g.type)}" title="${esc(g.name)} — klik kanan untuk membuang"` : ''}>${img(g.type)}<small>${esc(g.name)}</small></div>`;
      const card = (it, i) => `<button type="button" class="lp-card"${/^x_/.test(it.type) ? ' draggable="true" title="Klik untuk memasang · seret ke senjata tertentu"' : ''} data-take="${i}" style="--rar:${RARC[it.rar] || RARC[0]}">${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}${img(it.type)}<span>${esc(it.name)}</span></button>`;
      lpEl.innerHTML = `<div class="lp-box">
        <section class="lp-col lp-inv"><h3>Inventaris</h3>${model.guns.map(gun).join('')}<div class="lp-row">${model.gear.map(gear).join('')}</div>
          <h4>Tas <span class="lp-cap${model.bagW >= model.bagCap - 0.5 ? ' full' : ''}">${Math.min(100, Math.round(model.bagW / model.bagCap * 100))}% · ${model.bagW} / ${model.bagCap}</span></h4><div class="lp-capbar"><i style="width:${Math.min(100, model.bagW / model.bagCap * 100).toFixed(1)}%"></i></div><div class="lp-bag">${model.items.length ? model.items.map(bag).join('') : '<p class="lp-muted">Tas kosong</p>'}</div></section>
        <section class="lp-col lp-loot"><div class="lp-head"><h3>${esc(model.title)}</h3>${model.loot.length ? '<button type="button" class="lp-all" data-all>Ambil semua</button>' : ''}</div>
          <div class="lp-cards">${model.loot.length ? model.loot.map(card).join('') : '<p class="lp-muted">Tidak ada barang di sini</p>'}</div></section>
      </div>
      <div class="lp-hint">Klik barang untuk mengambil · klik kanan barang di inventaris untuk membuang · <kbd>1</kbd>–<kbd>9</kbd> · <kbd>F</kbd> / <kbd>Tab</kbd> / <kbd>Esc</kbd> tutup <button type="button" class="lp-x" data-close aria-label="Tutup">✕</button></div>`;
    },
    show(on) { el.hud.hidden = !on; if (on) { measureMap(); slowT = -1e9; } },
    // pemberitahuan singkat; "Diambil: …" tampil sebagai baris ambil barang bergambar
    toast(t) {
      t = String(t);
      if (t.startsWith('Diambil: ')) { pickup(t.slice(9)); return; }
      el.toast.textContent = t; el.toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove('on'), 2200);
    },
    pickup,
    flash(t) { el.flash.textContent = t; restart(el.flash, 'h-flash', 'flash'); },
    message(big, small = '', tone = '') {
      el.msg.innerHTML = '<b>' + esc(big) + '</b>' + (small ? '<span>' + esc(small) + '</span>' : '');
      el.msg.className = 'h-msg on ' + tone;
      clearTimeout(msgT);
      msgT = setTimeout(() => { el.msg.className = 'h-msg'; }, 3600);
    },
    // kill feed: pembunuh · siluet senjata / ikon sebab · korban. part: 'zone' | 'fall' | 'crash' | 'blast' | 'run' | 'head' | 'body' | …
    // knock = true: korban tumbang (belum tersingkir); nama rekan seregu diberi warna anggotanya
    feed(killer, victim, w, head, part, knock) {
      const row = document.createElement('div');
      const you = (a) => !!(a && a.isPlayer), mate = (a) => !!(a && a.ally);
      const nm = (a) => '<b' + (you(a) ? ' class="you"' : mate(a) ? ' class="m' + (a.slot | 0) + '"' : '') + '>' + esc(you(a) ? 'Kamu' : a.name) + '</b>';
      row.className = 'f-row' + (you(victim) ? ' dead' : you(killer) ? ' me' : mate(victim) ? ' sqd' : mate(killer) ? ' sqk' : '') + (knock ? ' knock' : '');
      if (part === 'zone' || part === 'drown' || !killer) row.innerHTML = nm(victim) + ic(knock ? 'down' : WHY_IC[part] || 'kill', knock ? 'kn' : 'why') + '<span class="f-why">' + (knock ? WHY_KN[part] || 'tumbang' : WHY[part] || 'tersingkir') + '</span>';
      else {
        const kind = w && w.inst ? w.inst.kind : part === 'blast' && w && w.def && w.def.short === 'Granat' ? 'frag' : '';
        const sl = kind ? silhouette(kind) : null;
        const mid = sl ? `<img class="f-w" src="${sl.url}" alt="${esc(w.def.short || '')}" draggable="false">`
          : part === 'run' || part === 'crash' ? ic('veh', 'why') : part === 'blast' ? ic('blast', 'why') : w && w.def && w.def.short ? '<span class="f-why">' + esc(w.def.short) + '</span>' : ic('kill', 'why');
        row.innerHTML = nm(killer) + mid + (head ? ic('head', 'head') : '') + (knock ? ic('down', 'kn') : '') + nm(victim);
      }
      el.feed.prepend(row);
      while (el.feed.children.length > 6) el.feed.lastChild.remove();
      setTimeout(() => row.classList.add('out'), 6500);
      setTimeout(() => row.remove(), 7100);
    },
    // spanduk kill pemain (game/killfx.js): o = { n, knock, head, name, theme } — lihat createKillBanner di bawah
    killBanner(o) { kb.show(o); },
    // penanda rekan di dunia, tiap frame. buf = [x px, y px, jarak m, keadaan] per rekan (keadaan: 0 sembunyi, 1 hidup,
    // 2 tumbang, 3 di tepi layar / di belakang). DOM hanya ditulis kalau bergeser ≥ 0,5 px; jarak ditulis ≤ ±6×/dtk.
    mates(buf) {
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i], o = i * 4, st = buf[o + 3] | 0, d = buf[o + 2];
        const k = st === 0 ? 0 : st + (st === 1 && d < 7 ? 3 : 0); // 4 = hidup & dekat: cukup penanda kecil
        if (k !== m.st) { m.st = k; m.el.className = 'h-mate m' + (i + 1) + (k === 0 ? '' : ' on' + (k === 2 ? ' down' : k === 3 ? ' edge' : k === 4 ? ' near' : '')); }
        if (k === 0) continue;
        const x = Math.round(buf[o] * 2) / 2, y = Math.round(buf[o + 1] * 2) / 2;
        if (x !== m.x || y !== m.y) { m.x = x; m.y = y; m.el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; }
        if (m.wait > 0) { m.wait--; continue; }
        const dk = d < 100 ? Math.round(d) : Math.round(d / 10) * 10;
        if (dk !== m.dk) { m.dk = dk; m.wait = 20; m.dEl.textContent = dk >= 1000 ? (dk / 1000).toFixed(1).replace('.', ',') + ' km' : dk + ' m'; }
      }
    },
    hitmarker(head, kill) { restart(el.hit, 'h-hit', 'hit', kill ? 'kill' : head ? 'head' : ''); },
    damageFrom(angle) { // angle: arah penembak relatif pandangan (rad, 0 = depan, + = kanan)
      const a = document.createElement('div');
      a.innerHTML = DMG_ARC;
      a.style.transform = 'rotate(' + angle.toFixed(3) + 'rad)';
      el.dmg.appendChild(a);
      setTimeout(() => a.remove(), 1400);
      alt.vig ^= 1;
      el.vig.classList.remove('hurt0', 'hurt1');
      el.vig.classList.add('hurt' + alt.vig);
    },
    // sudah waktunya update(s) lagi? (±20×/dtk; t = waktu rAF dalam ms)
    due(t) { if (t - slowT < 50) return false; slowT = t; return true; },
    // tiap frame: kompas, panah minimap, bidikan (celah mengikuti sebaran), teropong
    frame(yaw, spread, crossHidden, crossAds, crossBlocked, scoped) {
      let deg = ((Math.PI - yaw) * R2D) % 360; // 0 = utara (−Z), searah jarum jam
      if (deg < 0) deg += 360;
      const d10 = Math.round(deg * 10);
      if (d10 !== fDeg) {
        fDeg = d10; headDeg = deg;
        el.compass.style.transform = 'translateX(' + (-(24 + deg / 15) * CW - CW / 2).toFixed(3) + 'em)';
        el.mapMe.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
        const di = Math.round(deg) % 360;
        if (di !== fDegI) { fDegI = di; el.deg.textContent = di; const cd = CARD[Math.round(deg / 45) % 8]; if (cd !== fCard) { fCard = cd; el.card.textContent = cd; } }
        if (wayBear === wayBear || zoneBear === zoneBear) markers();
      }
      const gap = crossHidden ? -1 : Math.round(6 + spread * 7);
      if (gap !== fGap) { fGap = gap; if (gap < 0) el.cross.hidden = true; else { el.cross.hidden = false; el.cross.style.setProperty('--gap', gap + 'px'); } }
      const ck = (crossAds || '') + (crossBlocked ? '|x' : '');
      if (ck !== fCk) { fCk = ck; el.cross.className = 'h-cross' + (crossAds ? ' ads ' + crossAds : '') + (crossBlocked ? ' blocked' : ''); } // bidik: titik (pisir besi) / tanpa titik (red dot); x = di luar busur tembak kursi
      if (scoped !== fScoped) { fScoped = scoped; el.scope.hidden = !scoped; }
    },
    // s: ringkasan keadaan (lihat main.js). Dipanggil ±20×/dtk.
    update(s, mapImg) {
      const tNow = performance.now(), stt = s.state;
      if (iconsV !== last.iconsV) { last.iconsV = iconsV; last.prompt = null; } // siluet baru jadi → ikon prompt digambar ulang (kartu lewat kuncinya sendiri)
      set('alive', s.alive, (v) => { el.alive.textContent = v; });
      set('kills', s.kills, (v) => { el.kills.textContent = v; if (v > 0) { alt.pop ^= 1; el.killBox.className = 'hc gold pop' + alt.pop; } });
      // ---- regu: jumlah regu tersisa + panel anggota (tiap baris hanya ditulis kalau bidangnya berubah) ----
      set('squads', s.squads, (v) => { el.squads.textContent = v === undefined ? '–' : v; });
      const sq = s.squad;
      if (sq) for (let i = 0; i < rows.length; i++) {
        const r = rows[i], m = sq[i];
        if (!m) { if (r.st !== 'none') { r.st = 'none'; r.el.hidden = true; } continue; }
        if (m.name !== r.name) { r.name = m.name; r.nameEl.textContent = m.name; if (i > 0 && marks[i - 1]) marks[i - 1].nameEl.textContent = m.name; }
        const sk = m.st + (m.st === 'ok' || m.st === 'veh' ? (m.hp <= 25 ? ' low' : m.hp <= 50 ? ' mid' : '') : '');
        if (sk !== r.st) { r.st = sk; r.el.hidden = false; r.el.className = 'sq-row s' + i + ' ' + sk + (m.you ? ' you' : ''); r.ic.innerHTML = SQ_IC[m.st] ? ic(SQ_IC[m.st]) : ''; }
        const tv = m.st === 'down' || m.st === 'rev' ? m.t : -1;
        if (tv !== r.tv) { r.tv = tv; r.tEl.textContent = tv >= 0 ? tv : ''; }
        const bk = Math.round(m.hp / 2);
        if (bk !== r.hpk) { r.hpk = bk; r.bar.style.transform = 'scaleX(' + bk / 50 + ')'; }
      }
      // ---- pemain tumbang / menonton rekan ----
      const dn = s.down >= 0;
      set('downOn', dn, (v) => { el.down.hidden = !v; el.hud.classList.toggle('downed', v); last.downK = last.downT = last.downBy = null; });
      if (dn) {
        set('downK', Math.round(clamp01(s.down) * 100), (v) => { el.downB.style.transform = 'scaleX(' + v / 100 + ')'; });
        set('downT', Math.ceil(s.downLeft), (v) => { el.downT.textContent = v + ' dtk'; });
        set('downBy', s.reviveBy ? s.reviveName : '', (v) => { el.downH.textContent = v ? v + ' sedang memulihkanmu · jangan bergerak' : 'Merangkak ke rekan (WASD) · mereka bisa memulihkanmu'; el.down.classList.toggle('rev', !!v); });
      }
      set('spec', s.spec || '', (v) => { el.spec.hidden = !v; el.hud.classList.toggle('spec', !!v); if (v) el.specN.textContent = v; });
      if (s.spec) set('specSlot', s.specSlot | 0, (v) => { el.spec.className = 'h-spec m' + v; });
      set('loc', s.place || '', (v) => { el.loc.textContent = v; el.loc.hidden = !v; });
      // ---- darah ----
      const hp = Math.max(0, Math.min(100, Math.ceil(s.hp)));
      if (hp !== last.hp) {
        el.hpGhost.classList.toggle('nt', last.hp === undefined || hp > last.hp); // turun: jejak merah menyusul pelan; naik: langsung
        el.hpFill.style.transform = el.hpGhost.style.transform = 'scaleX(' + hp / 100 + ')';
        el.hpNum.textContent = hp;
        last.hp = hp;
        set('hpCls', hp <= 25 ? 'low crit' : hp <= 50 ? 'mid' : '', (v) => { el.hpBox.className = 'h-hp' + (v ? ' ' + v : '') + (last.heal ? ' healing' : ''); });
      }
      const hk = s.heal || '';
      set('heal', hk, (v) => {
        el.hpBox.classList.toggle('healing', !!v);
        el.band.classList.toggle('use', v === 'band'); el.kit.classList.toggle('use', v === 'kit'); el.drink.classList.toggle('use', v === 'drink');
        el.bandP.style.transform = el.kitP.style.transform = el.drinkP.style.transform = 'scaleY(0)'; last.healK = last.healT = null;
      });
      if (hk) {
        set('healT', hk === 'kit' ? 100 : hk === 'drink' ? hp : Math.min(75, hp + 15), (v) => { el.hpHeal.style.transform = 'scaleX(' + v / 100 + ')'; });
        set('healK', Math.round(clamp01(s.healK) * 50), (v) => { (hk === 'kit' ? el.kitP : hk === 'drink' ? el.drinkP : el.bandP).style.transform = 'scaleY(' + v / 50 + ')'; });
      }
      const br = s.breath >= 0 ? Math.round(clamp01(s.breath) * 50) : -1;
      set('breath', br, (v) => {
        el.breath.hidden = v < 0;
        if (v < 0) return;
        el.breathB.style.transform = 'scaleX(' + v / 50 + ')';
        set('breathS', v <= 0 ? 2 : v <= 12 ? 1 : 0, (k) => { el.breath.className = 'h-breath' + (k === 2 ? ' out' : k === 1 ? ' low' : ''); el.breathT.textContent = k === 2 ? 'Kehabisan napas! Naik (Spasi)' : 'Napas'; });
      });
      // ---- pelindung & obat ----
      // tingkat + sisa daya tahan (persen hanya tampil kalau sudah rusak)
      for (const [k, lv, pc] of [['helm', s.helmet | 0, s.helmPct], ['vest', s.vest | 0, s.vestPct]]) set(k, lv + '|' + (pc | 0), () => { el[k].className = 'ha' + (lv ? ' on lv' + lv : '') + (lv && pc <= 30 ? ' worn' : ''); el[k].children[1].textContent = lv ? 'Lv' + lv + (pc < 100 ? ' ' + (pc | 0) + '%' : '') : ''; });
      set('band', s.band | 0, (v) => { el.bandN.textContent = v; el.band.classList.toggle('on', v > 0); });
      set('kit', s.kit | 0, (v) => { el.kitN.textContent = v; el.kit.classList.toggle('on', v > 0); });
      set('bagPct', Math.max(0, Math.min(100, Math.round(s.bagPct || 0))), (v) => { el.bagN.textContent = v + '%'; el.bagP.style.transform = 'scaleY(' + v / 100 + ')'; el.bag.classList.toggle('full', v >= 100); el.bag.classList.toggle('high', v >= 80 && v < 100); });
      set('bagLv', s.bag | 0, (v) => { el.bagL.textContent = v ? 'Tas ' + v : 'Tas'; });
      set('drink', s.drink | 0, (v) => { el.drinkN.textContent = v; el.drink.classList.toggle('on', v > 0); });
      set('boost', Math.round(clamp01((s.boost || 0) / 100) * 100), (v) => { el.boost.style.transform = 'scaleX(' + v / 100 + ')'; }); // tenaga (minuman energi)
      // ---- senjata & granat ----
      for (let i = 0; i < 3; i++) drawCard(i, s);
      drawNade(s);
      // ---- cincin aksi (isi ulang / obat) ----
      const act = s.reviveName ? 'rev' : s.reload > 0 ? 'rl' : hk ? 'heal' : ''; // rev: memulihkan rekan / sedang dipulihkan
      set('act', act === 'rev' ? 'rev|' + (s.reviveBy ? '<' : '>') + s.reviveName : act, () => {
        el.act.hidden = !act;
        el.act.className = 'h-act' + (act === 'heal' ? ' heal' : act === 'rev' ? ' rev' : '');
        el.actL.textContent = act === 'rl' ? 'Isi ulang' : act === 'rev' ? (s.reviveBy ? 'Dipulihkan ' : 'Memulihkan ') + s.reviveName : hk === 'kit' ? 'Memakai P3K' : hk === 'drink' ? 'Meminum minuman energi' : hk ? 'Memasang perban' : '';
        last.actK = last.actT = null;
      });
      if (act) {
        set('actK', Math.round(clamp01(act === 'rev' ? s.revive : act === 'rl' ? s.reload : s.healK) * 100), (v) => { el.actRing.style.strokeDashoffset = 100 - v; });
        set('actT', Math.max(0, act === 'rev' ? s.reviveLeft : act === 'rl' ? s.reloadLeft : s.healLeft).toFixed(1), (v) => { el.actT.textContent = v.replace('.', ',') + ' dtk'; });
      }
      // ---- zona ----
      const z = s.zone, zm = z.mode, out = s.outside > 0;
      set('zoneM', zm + (out ? '|o' : ''), () => {
        el.zone.className = 'h-zone ' + zm + (out ? ' out' : '');
        el.zoneI.innerHTML = ic(out ? 'warn' : 'zone');
        el.zoneL.textContent = out ? 'Di luar zona!' : zm === 'pre' ? 'Kawasan aman' : zm === 'wait' ? 'Fase ' + (z.phase + 1) + ' · zona diam' : zm === 'shrink' ? 'Zona menyusut' : 'Zona terakhir';
        el.zoneS.textContent = out ? '−' + z.def.dps + ' HP/dtk · masuk ke lingkaran' : zm === 'pre' ? 'Zona ditandai dalam' : zm === 'wait' ? 'Mulai menyusut dalam' : zm === 'shrink' ? 'Selesai menyusut dalam' : 'Bertahan sampai akhir';
      });
      set('zoneT', zm === 'final' ? '—' : mmss(z.timeLeft), (v) => { el.zoneT.textContent = v; });
      const zt = z.t + z.timeLeft;
      set('zoneB', zm === 'final' ? 100 : zt > 0 ? Math.round(z.t / zt * 100) : 0, (v) => { el.zoneB.style.transform = 'scaleX(' + v / 100 + ')'; });
      set('vigZone', out, (v) => { el.vig.classList.toggle('zone', v); });
      // arah & jarak ke zona aman berikutnya bila pemain masih di luarnya
      let goD = -1, zb = NaN;
      if (zm !== 'pre' && stt !== 'plane' && (z.next || z.cur)) {
        const tz = z.next || z.cur, dx = tz.x - s.x, dy = tz.y - s.y, d = Math.hypot(dx, dy);
        if (d > tz.r) { goD = d - tz.r; zb = Math.atan2(dx, dy) * R2D; }
      }
      set('goOn', goD >= 0, (v) => { el.zoneGo.hidden = !v; });
      if (goD >= 0) {
        set('goT', Math.round(goD / 5) * 5, (v) => { el.zoneGoT.textContent = 'Zona aman ' + (v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' km' : v + ' m'); });
        set('goA', Math.round(wrapDeg(zb - headDeg) / 3) * 3, (v) => { el.zoneArr.style.transform = 'rotate(' + v + 'deg)'; });
      }
      const mk = s.marks && s.marks[0], wb = mk && stt !== 'plane' ? Math.atan2(mk.x - s.x, mk.y - s.y) * R2D : NaN;
      if (wb !== wayBear || zb !== zoneBear) { wayBear = wb; zoneBear = zb; markers(); }
      // ---- aksi & keterangan ----
      set('prompt', s.prompt || '', (v) => { el.prompt.hidden = !v; if (v) { el.promptT.textContent = v; el.promptI.innerHTML = promptIcon(v); } });
      set('hide', s.hidden || '', (v) => { el.hide.hidden = !v; el.hideT.textContent = v === 'prone' ? 'Tersembunyi di rumput' : v ? 'Setengah tersembunyi · tiarap (Z) supaya tak terlihat' : ''; el.hide.classList.toggle('full', v === 'prone'); });
      // ---- pesawat ----
      const inPlane = stt === 'plane';
      set('inair', inPlane || stt === 'fall' || stt === 'chute', (v) => { el.hud.classList.toggle('inair', v); });
      set('planeOn', inPlane, (v) => { el.plane.hidden = !v; });
      if (inPlane) {
        const go = s.planeT >= s.planeOpen, total = Math.max(1, s.planeClose);
        set('planeW', s.planeOpen + '|' + s.planeClose, () => { el.planeWin.style.left = (s.planeOpen / total * 100).toFixed(1) + '%'; el.planeWin.style.width = ((s.planeClose - s.planeOpen) / total * 100).toFixed(1) + '%'; });
        set('planeGo', go, (v) => { el.plane.className = 'h-plane ' + (v ? 'go' : 'wait'); el.planeL.textContent = v ? 'Terjun sekarang · keluar kawasan' : 'Terjun · menuju kawasan'; });
        set('planeT', mmss(Math.max(0, (go ? s.planeClose : s.planeOpen) - s.planeT)), (v) => { el.planeT.textContent = v; });
        set('planeK', Math.round(clamp01(s.planeT / total) * 200), (v) => { el.planePos.style.setProperty('--k', v / 200); });
      }
      // ---- terjun & payung ----
      const inAir = stt === 'fall' || stt === 'chute';
      set('airOn', inAir, (v) => {
        el.air.hidden = !v;
        if (v) { airMax = Math.max(300, s.alt); airPrev = s.alt; airPrevT = tNow; airVs = 0; el.airAuto.style.bottom = (120 / airMax * 100).toFixed(1) + '%'; last.airChute = null; }
      });
      if (inAir) {
        const a = Math.max(0, s.alt), dtA = (tNow - airPrevT) / 1000;
        if (dtA > 0.04) { airVs += ((airPrev - a) / dtA - airVs) * 0.4; airPrev = a; airPrevT = tNow; }
        set('airAlt', Math.round(a), (v) => { el.airAlt.textContent = v; el.airFill.style.transform = 'scaleY(' + clamp01(v / airMax).toFixed(3) + ')'; });
        set('airVs', Math.max(0, Math.round(airVs)), (v) => { el.airVs.textContent = v; });
        set('airChute', stt === 'chute', (v) => { el.air.className = 'h-air' + (v ? ' chute' : ''); el.airState.innerHTML = v ? ic('para') + '<span>Payung terbuka · W maju</span>' : '<kbd>F</kbd><span>Buka payung</span>'; });
      }
      // ---- kendaraan ----
      const v = s.veh;
      set('vehOn', !!v, (on) => { el.veh.hidden = !on; el.hud.classList.toggle('driving', on); });
      set('vehArmed', !!(v && s.vehArmed), (on) => { el.hud.classList.toggle('armed', on); }); // panel senjata tidak diredupkan
      if (v) {
        const n = v.occ.length, seat = v.seat > 0 ? v.seat : 0;
        set('vehName', v.name, (t) => { el.vehName.textContent = t; });
        set('vehLay', v.name + '|' + n, () => { buildSeats(v); last.vehSig = null; });
        let sig = seat + ':';
        for (let i = 0; i < n; i++) sig += v.occ[i] ? '1' : '0';
        set('vehSig', sig, () => {
          for (let i = 0; i < seatDots.length; i++) seatDots[i].className = (i === 0 ? 'drv ' : '') + (i === seat ? 'me' : v.occ[i] ? 'occ' : '');
          el.vehRole.textContent = seat === 0 ? 'Sopir' : 'Penumpang ' + (seat + 1) + '/' + n;
          el.vehRole.className = seat > 0 ? 'pass' : '';
          el.vehKeys.innerHTML = VEH_KEYS[seat === 0 ? 'drv' : 'pass'] + (n > 1 ? ' <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>' + Math.min(n, 9) + '</kbd> pindah kursi' : '');
        });
        set('vehSpd', v.kmh, (k) => { el.vehSpd.textContent = k; el.vehArc.style.strokeDashoffset = (100 - clamp01(k / (v.max || 120)) * 100).toFixed(1); });
        const hpk = Math.max(0, Math.round(v.hp / v.hpMax * 100));
        set('vehHp', hpk + (v.burning ? 'b' : ''), () => { el.vehHp.style.transform = 'scaleX(' + hpk / 100 + ')'; el.vehHp.className = v.burning || hpk <= 25 ? 'low' : hpk <= 50 ? 'mid' : ''; el.vehHpT.textContent = hpk + '%'; el.veh.classList.toggle('burning', !!v.burning); });
        set('vehBoost', !!v.boost, (b) => { el.veh.classList.toggle('boost', b); });
        { // bensin: persen + jumlah jeriken yang dibawa; saat mengisi batangnya naik sesuai kemajuan
          const fk = Math.max(0, Math.min(100, Math.round(v.fuel === undefined ? 100 : v.fuel))), fg = v.fueling > 0 ? Math.round(v.fueling * 20) : -1;
          set('vehFuel', fk + '|' + fg + '|' + (v.cans | 0), () => {
            el.vehFuel.style.transform = 'scaleX(' + fk / 100 + ')';
            el.vehFuel.className = fk <= 15 ? 'low' : fk <= 35 ? 'mid' : '';
            el.vehFuelT.textContent = fg >= 0 ? 'isi ' + fg * 5 + '%' : fk + '%' + (v.cans ? ' +' + v.cans : '');
            el.vehFuelBox.classList.toggle('dry', fk <= 0);
          });
        }
      }
      // ---- minimap (≤ 10×/dtk; panah pemain = elemen DOM yang berputar tiap frame) ----
      if (mapImg && mapCtx && tNow - mapT >= 100) {
        mapT = tNow;
        drawMinimap(mapCtx, mapImg, { size: mapSize, dpr: mapDpr, square: true, arrow: false, x: s.x, y: s.y, rot: 0, range: s.mapRange, heading: s.heading, circles: s.circles, marks: s.marks, pins: s.pins });
        set('mapR', s.mapRange, (r) => { el.mapR.textContent = r * 2 >= 1000 ? (r * 2 / 1000).toFixed(1).replace('.', ',') + ' km' : r * 2 + ' m'; });
      }
    },
  };
}

// ---------- Spanduk kill (gaya kill banner) ----------
// Blok mandiri, dipakai HUD (hud.killBanner) dan pratinjau toko (lobby.js). Lambang bertema skin senjata di tengah bawah,
// lima pip hitungan kill beruntun di busur atasnya, label yang makin megah (Ganda → Tripel → Beringas → Amuk), sinar
// berputar mulai kill ke-3, sinar tepi layar mulai ke-4, gelombang kejut di ke-5+. Lumpuhkan = versi garis/redup.
// Animasi hanya transform/opacity (CSS di game/killfx.css); DOM ditulis sekali per kejadian.
// show(o): o = { n, knock, head, name, theme: { color, color2, emblem, rarity } }.
const KB_EMB = { // lambang 48×48 (diisi gradien tema)
  std: '<path d="M24 3l5.6 14.8L45 24l-15.4 6.2L24 45l-5.6-14.8L3 24l15.4-6.2z"/>',
  es: '<g transform="translate(24 24)">' + [0, 60, 120].map((a) => `<g transform="rotate(${a})"><rect x="-2" y="-20" width="4" height="40" rx="2"/><path d="M-8-16 0-9 8-16l-1.6-2.3L0-13l-6.4-5.3zM-8 16 0 9l8 7-1.6 2.3L0 13l-6.4 5.3z"/></g>`).join('') + '<circle r="4.5"/></g>',
  api: '<path d="M25 3c3 7 12 12 12 24a13 13 0 0 1-26 0c0-6 3-10 5-13 1 4 3 6 6 7-2-6 0-12 3-18z"/><path d="M24 26c2 3 6 5 6 10a6 6 0 0 1-12 0c0-2 1-4 2-5 1 2 2 3 3 3-1-3 0-6 1-8z" opacity=".55"/>',
  petir: '<path d="M28 2 9 27h12l-4 19 22-27H27z"/>',
  neo: '<path fill-rule="evenodd" d="M24 3l18 10.5v21L24 45 6 34.5v-21zm0 9-9 5.2v10.6l9 5.2 9-5.2V17.2z"/><circle cx="24" cy="24" r="3.4"/>',
  holo: '<path fill-rule="evenodd" d="M24 3l18 10.5v21L24 45 6 34.5v-21zm0 6.5L11.6 16.7v14.6L24 38.5l12.4-7.2V16.7z"/><path d="M24 15l7.5 9L24 33l-7.5-9z"/>',
  reaktor: '<circle cx="24" cy="24" r="5.5"/><g fill="none" stroke-width="2.6" style="stroke:url(#kbG)"><ellipse cx="24" cy="24" rx="19" ry="7.5"/><ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(120 24 24)"/></g>',
  garuda: '<path d="M24 8c2.2 0 3.6 1.6 3.6 3.6 0 1.4-.7 2.5-1.8 3.1L28 19l9-8.6 1.5 2.5L45 9.6 41.5 18l3.3.8-6 4.4 2 1.3-8.6 2.9L35 33l-7 .2-1.6 6.8h-4.8l-1.6-6.8-7-.2 2.8-5.6-8.6-2.9 2-1.3-6-4.4 3.3-.8L3 9.6l6.5 3.3 1.5-2.5L20 19l2.2-4.3a3.5 3.5 0 0 1-1.8-3.1C20.4 9.6 21.8 8 24 8z"/>',
  merak: '<g transform="translate(24 40)">' + [-64, -32, 0, 32, 64].map((a) => `<g transform="rotate(${a})"><path d="M0 0C-3-10-5-22 0-34c5 12 3 24 0 34z" opacity=".85"/><circle cy="-27" r="4.6"/></g>`).join('') + '</g>',
  keris: '<path d="M23 4c2 3 4 5 2 8s1 5 1 8-3 5-1 8 1 5 0 6l-2 2-2-2c-1-1-1-3 0-6s-1-5-1-8 3-5 1-8 0-5 2-8z"/><path d="M17 36h14l-2 3h-10z"/><rect x="21" y="39" width="6" height="7" rx="2"/>',
  wastra: '<g transform="translate(24 24) rotate(45)"><ellipse cx="0" cy="-10" rx="5.6" ry="9.5"/><ellipse cx="0" cy="10" rx="5.6" ry="9.5"/><ellipse cx="-10" cy="0" rx="9.5" ry="5.6"/><ellipse cx="10" cy="0" rx="9.5" ry="5.6"/></g><circle cx="24" cy="24" r="2.6" opacity=".6"/>',
  kencana: '<path d="M13 8h22l9 11-20 23L4 19z"/><path d="M13 8l11 34L35 8M4 19h40" fill="none" stroke-width="1.6" stroke="rgba(0,0,0,.28)"/>',
};
const KB_LBL = ['', 'Kill', 'Ganda', 'Tripel', 'Beringas', 'Amuk'];
let KB_ID = 0;
const KB_PIPS = [-56, -28, 0, 28, 56].map((a) => { const r = a * Math.PI / 180; return `<path class="kb-pip" transform="translate(${(Math.sin(r) * 52).toFixed(2)} ${(-Math.cos(r) * 52).toFixed(2)}) rotate(${a})" d="M0-6 4 0 0 6-4 0z"/>`; }).join('');
export function createKillBanner(parent) {
  const el = document.createElement('div'), gid = 'kbG' + (++KB_ID); // id gradien unik per spanduk (HUD & pratinjau toko)
  el.className = 'kb';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="kb-edge"></div><div class="kb-wrap"><div class="kb-mid"><i class="kb-rays"></i><i class="kb-burst"></i><i class="kb-shock"></i>
    <svg class="kb-pips" viewBox="-64 -64 128 128" aria-hidden="true">${KB_PIPS}</svg>
    <div class="kb-emb"><svg class="kb-ico" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--k2)"/><stop offset=".55" style="stop-color:var(--k1)"/><stop offset="1" style="stop-color:var(--k1)"/></linearGradient></defs><g class="kb-g"></g></svg><b class="kb-n"></b></div></div>
    <div class="kb-tx"><em class="kb-lbl"></em><span class="kb-who"></span><i class="kb-hs">Tembakan kepala</i></div></div>`;
  parent.appendChild(el);
  const g = el.querySelector('.kb-g'), pips = [...el.querySelectorAll('.kb-pip')], nEl = el.querySelector('.kb-n'), lbl = el.querySelector('.kb-lbl'), who = el.querySelector('.kb-who'), hs = el.querySelector('.kb-hs');
  let alt = 0, tOut = 0, tHide = 0, emb = '';
  return {
    el,
    show(o) {
      const th = o.theme || {}, n = Math.max(1, o.n | 0), k = Math.min(5, n);
      el.style.setProperty('--k1', th.color || '#ffc64a');
      el.style.setProperty('--k2', th.color2 || '#fff1c8');
      const e = KB_EMB[th.emblem] ? th.emblem : 'std';
      if (e !== emb) { emb = e; g.innerHTML = KB_EMB[e].replace('#kbG', '#' + gid); g.setAttribute('fill', 'url(#' + gid + ')'); }
      pips.forEach((p, i) => p.classList.toggle('on', i < k));
      nEl.textContent = n > 5 ? '×' + n : '';
      lbl.textContent = o.knock ? 'Tumbang' : n > 5 ? KB_LBL[5] + ' ×' + n : KB_LBL[k];
      who.textContent = (o.knock ? 'Melumpuhkan ' : 'Menyingkirkan ') + (o.name || '');
      hs.hidden = !o.head;
      alt ^= 1;
      el.hidden = false;
      el.className = 'kb on' + alt + ' s' + k + (o.knock ? ' kn' : '') + (th.rarity === 'legendaris' ? ' leg' : th.rarity === 'epik' ? ' epk' : '');
      clearTimeout(tOut); clearTimeout(tHide);
      tOut = setTimeout(() => el.classList.add('out'), 2300 + k * 150);
      tHide = setTimeout(() => { el.hidden = true; }, 2750 + k * 150);
    },
  };
}
