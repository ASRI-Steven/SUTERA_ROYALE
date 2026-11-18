// Katalog & penerapan skin (karakter + senjata). Dipakai lobi (toko, koleksi, pratinjau) dan game (pemain, rekan regu, senjata).
// Semua motif dihitung di shader (game/skinfx.js) — tanpa tekstur, tanpa unduhan tambahan:
// - Karakter: warna slot pakaian (palet per karakter) + nomor pola `fx` → map/rig.js (tubuh ber-kulit; kerumunan tetap ber-instans).
//   Legendaris: aura (pendar tepi di shader) + serbuk cahaya yang tertinggal saat bergerak (createAura, orang ketiga & lobi).
// - Senjata orang pertama: varian material per skin (game/weapons.js vmSkinned); model dunia (di tangan karakter): material
//   berwarna-verteks dengan pola yang sama. Tingkat epik & legendaris: animasi, warna pelacak & kilatan moncong, partikel
//   moncong, pendar saat isi ulang/periksa/cabut, suara tembakan sendiri (game/audio.js), efek & spanduk kill (game/killfx.js).
// Harga menurut kelangkaan: biasa 300, langka 800, epik 1800, legendaris 4000 koin; bawaan 0.
// ID lama (char_default … char_garuda, gun_default … gun_garuda) tetap sama → profil lama (dimiliki & dipakai) tetap sah.
import * as THREE from 'three';
import { buildCharacter } from '../map/rig.js';
import { vmSkinned, setVmArms, gunPreview, setSkinFx, SF_G0 } from './weapons.js';
import { CHAR_FX, GUN_FX, GUN_SKIN_GLSL, SF_U, onSkinTick } from './skinfx.js';
import { profile } from './profile.js';
import * as audio from './audio.js';

export const RARITY = {
  biasa: { label: 'Biasa', color: '#9aa3b2', rank: 0 }, langka: { label: 'Langka', color: '#4da3ff', rank: 1 },
  epik: { label: 'Epik', color: '#b46bff', rank: 2 }, legendaris: { label: 'Legendaris', color: '#f2b233', rank: 3 },
};
export const PRICE = { biasa: 300, langka: 800, epik: 1800, legendaris: 4000 };
// koleksi bertema (urutan = urutan tampil di toko)
export const COLLECTIONS = [
  { id: 'taktis', name: 'Taktis Sutera', desc: 'Perlengkapan lapangan: loreng, karbon, dan hitam operasi.' },
  { id: 'wastra', name: 'Wastra Nusantara', desc: 'Batik & tenun: mega mendung, kawung, parang, songket, ikat.' },
  { id: 'pusaka', name: 'Pusaka', desc: 'Keris berpamor, wayang kulit, merah putih, dan garuda emas.' },
  { id: 'panggung', name: 'Panggung Rakyat', desc: 'Ondel-ondel Betawi dan dadak merak Ponorogo.' },
  { id: 'alam', name: 'Amukan Alam', desc: 'Es, magma, petir, samudra, naga, dan senja.' },
  { id: 'neo', name: 'Neo Sutera', desc: 'Kota masa depan: neon, hologram, dan reaktor plasma.' },
  { id: 'kencana', name: 'Kencana', desc: 'Kemewahan: marmer berurat emas dan mutiara laut.' },
];
// pakaian bawaan pemain (sama dengan OUTFIT di game/player.js)
export const DEFAULT_OUTFIT = { shirt: '#503EBA', sleeve: '#503EBA', pants: '#2b2940', skin: '#c68c66', hair: '#231c18', shoes: '#1c1b22', gear: '#4c5340', pack: '#3a3d34', trim: '#D29F52', glove: '#25232c', cuff: '#D29F52', inner: '#d9d5cc' };

// ---------- Karakter ----------
// outfit: warna slot (shirt/sleeve/pants/glove/cuff/inner) + perlengkapan (gear = helm & rompi, pack = ransel); fx = pola (skinfx.js)
// x: { aura: warna aura legendaris, cuffGlow: manset menyala (lengan orang pertama) }
const C = (id, name, rarity, col, desc, fx, outfit, x = {}) => ({ id, name, rarity, col, price: outfit ? PRICE[rarity] : 0, desc, fx, outfit, kind: 'character', ...x });
export const CHAR_SKINS = [
  C('char_default', 'Rekrut Sutera', 'biasa', 'taktis', 'Seragam bawaan regu Sutera: ungu dengan manset emas.', 0, null),
  C('char_malam', 'Operator Malam', 'biasa', 'taktis', 'Taktis hitam arang dengan panel pelindung dan garis emas tipis.', CHAR_FX.malam,
    { shirt: '#1b1c20', sleeve: '#1b1c20', pants: '#15161a', glove: '#0e0e11', cuff: '#D29F52', inner: '#2a2b30', gear: '#1f2126', pack: '#17181c' }),
  C('char_kabut', 'Kabut Kota', 'biasa', 'taktis', 'Loreng digital abu-abu dua ukuran piksel dengan panel bahu & lutut gelap.', CHAR_FX.kabut,
    { shirt: '#8a8e93', sleeve: '#8a8e93', pants: '#8a8e93', glove: '#3a3d42', cuff: '#5d6167', inner: '#2c2e33', gear: '#6a6e74', pack: '#4b4f55' }),
  C('char_gurun', 'Debu Merapi', 'biasa', 'taktis', 'Loreng digital abu vulkanik dan pasir, serasi dengan skin senjata Debu Merapi.', CHAR_FX.gurun,
    { shirt: '#9a9282', sleeve: '#9a9282', pants: '#9a9282', glove: '#4a4339', cuff: '#6e655a', inner: '#3c3731', gear: '#8a7f6c', pack: '#6b6152' }),
  C('char_rimba', 'Rimba', 'langka', 'taktis', 'Loreng hutan tropis bertepi organik dengan panel bahu & lutut hijau tua.', CHAR_FX.rimba,
    { shirt: '#4d5c2d', sleeve: '#4d5c2d', pants: '#4d5c2d', glove: '#3b2d1c', cuff: '#2c371c', inner: '#59613a', gear: '#3f4a26', pack: '#3b2d1c' }),
  C('char_merahputih', 'Merah Putih', 'langka', 'pusaka', 'Dada merah berlekuk dan badan putih dibatasi garis emas; garis merah-emas di sisi celana.', CHAR_FX.merahputih,
    { shirt: '#f2f0ea', sleeve: '#c1121f', pants: '#f2f0ea', glove: '#c1121f', cuff: '#e2a93b', inner: '#f2f0ea', gear: '#c1121f', pack: '#e9e6de' }),
  C('char_samudra', 'Samudra', 'langka', 'alam', 'Gradasi biru laut ke toska dengan buih ombak yang bergerak pelan.', CHAR_FX.samudra,
    { shirt: '#14607a', sleeve: '#14607a', pants: '#0f3c66', glove: '#0a2452', cuff: '#eaf6f6', inner: '#eaf6f6', gear: '#0f3c66', pack: '#0a2452' }),
  C('char_tenun', 'Tenun Ikat', 'langka', 'wastra', 'Belah ketupat bertingkat nila, karat, dan krem dengan tepi luntur khas tenun ikat.', CHAR_FX.tenun,
    { shirt: '#1d2a5a', sleeve: '#1d2a5a', pants: '#151a33', glove: '#1b1712', cuff: '#a3401f', inner: '#e8d9b5', gear: '#2b2f45', pack: '#5a2a18' }),
  C('char_ondel', 'Ondel-ondel', 'langka', 'panggung', 'Jaket merah berbunga emas delapan kelopak, dalaman gading berpita kembang kelapa.', CHAR_FX.ondel,
    { shirt: '#c41a20', sleeve: '#c41a20', pants: '#141214', glove: '#141214', cuff: '#e8b445', inner: '#f1e8d2', gear: '#3a2a20', pack: '#7a1418' }),
  C('char_batik', 'Batik Parang', 'epik', 'wastra', 'Jaket parang sogan-krem; kilau emas berjalan menyusuri garis parangnya.', CHAR_FX.batik,
    { shirt: '#6b3e1e', sleeve: '#6b3e1e', pants: '#231c1a', glove: '#3a2416', cuff: '#D29F52', inner: '#e6d3a3', gear: '#3a2416', pack: '#6b3e1e' }),
  C('char_neon', 'Neon Kota', 'epik', 'neo', 'Setelan gelap dengan garis cahaya yang berdenyut mengalir, berganti toska dan magenta.', CHAR_FX.neon,
    { shirt: '#0c0d14', sleeve: '#0c0d14', pants: '#0c0d14', glove: '#08080c', cuff: '#22e6ff', inner: '#15161f', gear: '#11121a', pack: '#0c0d14' }, { cuffGlow: '#22e6ff' }),
  C('char_empu', 'Empu Pamor', 'epik', 'pusaka', 'Beskap nila-hitam berlapis garis pamor perak yang berkilau pelan, kerah & manset emas.', CHAR_FX.empu,
    { shirt: '#141826', sleeve: '#141826', pants: '#0e0f14', glove: '#0e0f14', cuff: '#d6a446', inner: '#e9e1cf', gear: '#1c2030', pack: '#141826' }),
  C('char_magma', 'Inti Magma', 'epik', 'alam', 'Batu obsidian dengan lava yang mengalir dan berdenyut di retakannya.', CHAR_FX.magma,
    { shirt: '#0b0909', sleeve: '#0b0909', pants: '#0b0909', glove: '#0b0909', cuff: '#3a0c02', inner: '#1a0f0c', gear: '#151010', pack: '#0b0909' }, { cuffGlow: '#ff5a10' }),
  C('char_es', 'Kristal Es', 'epik', 'alam', 'Faset es putih kebiruan, kilau salju berkelip, dan manset yang menyala biru.', CHAR_FX.es,
    { shirt: '#cfe6f5', sleeve: '#cfe6f5', pants: '#9fc4e0', glove: '#e8f4fb', cuff: '#bfefff', inner: '#f6fbff', gear: '#dbeaf3', pack: '#a9c8de' }, { cuffGlow: '#4fc8ff' }),
  C('char_kencana', 'Kencana', 'epik', 'kencana', 'Marmer gading berurat emas dengan kilau emas yang menyapu pelan.', CHAR_FX.kencana,
    { shirt: '#f3efe7', sleeve: '#f3efe7', pants: '#f3efe7', glove: '#f3efe7', cuff: '#e3b24e', inner: '#efe6d4', gear: '#e9e2cf', pack: '#e3b24e' }),
  C('char_garuda', 'Garuda Emas', 'legendaris', 'pusaka', 'Putih upacara berhias bulu garuda emas yang berkilau bergelombang, berselubung aura & serbuk cahaya emas.', CHAR_FX.garuda,
    { shirt: '#f4f1e8', sleeve: '#f4f1e8', pants: '#f4f1e8', glove: '#f4f1e8', cuff: '#e2a93b', inner: '#e2a93b', gear: '#e9e2cf', pack: '#e2a93b' }, { aura: '#ffc64a' }),
  C('char_warok', 'Warok Barong', 'legendaris', 'panggung', 'Hitam warok, dalaman loreng merah-putih, mata bulu merak berpelangi di bahu & punggung, aura toska-emas.', CHAR_FX.warok,
    { shirt: '#0b0a0c', sleeve: '#0b0a0c', pants: '#0b0a0c', glove: '#0b0a0c', cuff: '#d6a446', inner: '#f1ede4', gear: '#141218', pack: '#0b0a0c' }, { aura: '#1fd6b4' }),
  C('char_reaktor', 'Reaktor Sutera', 'legendaris', 'neo', 'Zirah keramik putih & grafit dengan kanal energi biru yang mengalir, inti dada berdenyut, dan aura plasma.', CHAR_FX.reaktor,
    { shirt: '#e6eaee', sleeve: '#e6eaee', pants: '#1c1f25', glove: '#1c1f25', cuff: '#9fe9ff', inner: '#20242c', gear: '#e6eaee', pack: '#1c1f25' }, { aura: '#33d6ff', cuffGlow: '#33d6ff' }),
];

// ---------- Senjata ----------
// th (tema): coat = berpernis (MeshPhysicalMaterial), tracer/flash = warna HDR [r, g, b], muzzle = partikel moncong,
// glow = pendar isi ulang/periksa/cabut, voice = suara tembakan (audio.js VOICES), kill = efek kill (killfx.js),
// emblem = lambang spanduk kill (hud.js), color/color2 = warna tema (spanduk, toko)
const G = (id, name, rarity, col, desc, fx, th = {}) => ({ id, name, rarity, col, price: fx ? PRICE[rarity] : 0, desc, fx, kind: 'weapon', th });
export const GUN_SKINS = [
  G('gun_default', 'Baja Standar', 'biasa', 'taktis', 'Tampilan pabrik: baja hitam dan polimer.', 0, { color: '#d29f52' }),
  G('gun_karbon', 'Karbon Hitam', 'biasa', 'taktis', 'Anyaman serat karbon berpernis; kilau seratnya berubah mengikuti sudut pandang.', GUN_FX.karbon, { coat: true, color: '#b8c0c8' }),
  G('gun_rimba', 'Kamuflase Rimba', 'biasa', 'taktis', 'Cat loreng hutan yang doff dengan noda bertepi organik, serasi dengan skin Rimba.', GUN_FX.rimba, { color: '#8c9a52' }),
  G('gun_gurun', 'Debu Merapi', 'biasa', 'taktis', 'Loreng digital abu vulkanik dua ukuran piksel, doff dan tidak memantul.', GUN_FX.gurun, { color: '#b9ad94' }),
  G('gun_senja', 'Senja', 'langka', 'alam', 'Cat permen berpernis bergradasi jingga ke ungu dengan serpih logam yang berkelip.', GUN_FX.senja, { coat: true, tracer: [7, 3.2, 3.6], color: '#ff8c1a', color2: '#7b3fe0' }),
  G('gun_naga', 'Merah Naga', 'langka', 'alam', 'Sisik naga berkubah bertepi emas dengan kilau jingga di sudut landai.', GUN_FX.naga, { coat: true, tracer: [7.5, 2.4, 1.2], color: '#e0322a', color2: '#f0b84a' }),
  G('gun_mendung', 'Batik Mega Mendung', 'langka', 'wastra', 'Awan Cirebon berlapis gradasi biru dengan garis putih di tiap lapis, berpernis satin.', GUN_FX.mendung, { coat: true, tracer: [3.4, 5, 8], color: '#4f86e0', color2: '#d6ebff' }),
  G('gun_kawung', 'Batik Kawung', 'langka', 'wastra', 'Empat kelopak kawung krem di atas sogan, isen titik emas, dan relief timbul.', GUN_FX.kawung, { coat: true, tracer: [6.5, 4.6, 2.2], color: '#d39a4a', color2: '#ead7a8' }),
  G('gun_wayang', 'Wayang Kulit', 'langka', 'pusaka', 'Ornamen kulit bertatah: cincin emas, merah, dan tosca berlubang tatahan.', GUN_FX.wayang, { tracer: [6.5, 4.2, 1.8], color: '#d9a640', color2: '#a3261b' }),
  G('gun_ondel', 'Ondel-ondel', 'langka', 'panggung', 'Pernis merah berbunga emas dan gading berpita kembang kelapa warna-warni.', GUN_FX.ondel, { coat: true, tracer: [7.5, 3, 2.6], color: '#e8323a', color2: '#f2c230' }),
  G('gun_marmer', 'Marmer Kencana', 'langka', 'kencana', 'Marmer putih dipoles dengan urat emas seperti kintsugi; gagang marmer hitam.', GUN_FX.marmer, { coat: true, tracer: [6.5, 5.2, 3.2], color: '#e9b44a', color2: '#f2efe9' }),
  G('gun_es', 'Kristal Es', 'epik', 'alam', 'Faset es dengan cahaya aurora yang bergerak di dalamnya, kilau salju, dan aksen kristal berpendar. Tembakan berdenting kristal; lawan pecah jadi serpih es.', GUN_FX.es,
    { coat: true, tracer: [2.6, 5.2, 8.5], flash: [2.6, 4.8, 7.2], muzzle: 'frost', glow: true, voice: 'crystal', kill: 'shatter', emblem: 'es', color: '#5fd8ff', color2: '#e8f8ff' }),
  G('gun_neon', 'Neon Ungu', 'epik', 'neo', 'Kisi segi enam menyala dengan gelombang energi yang mengalir ke moncong dan sel data berkedip. Tembakan synth berdenyut.', GUN_FX.neon,
    { coat: true, tracer: [5.5, 1.6, 8], flash: [5, 1.6, 7], muzzle: 'spark', glow: true, voice: 'pulse', kill: 'pixel', emblem: 'neo', color: '#b24dff', color2: '#22e6ff' }),
  G('gun_songket', 'Songket Emas', 'epik', 'wastra', 'Sutra marun bertenun benang emas; kilau berjalan di sepanjang benang dan bintang delapan berkelip. Tembakan berdenting bonang.', GUN_FX.songket,
    { tracer: [7.5, 5, 1.8], flash: [7, 4.8, 1.8], muzzle: 'petal', glow: true, voice: 'bonang', kill: 'petal', emblem: 'wastra', color: '#f2c25a', color2: '#9a1830' }),
  G('gun_keris', 'Pamor Keris', 'epik', 'pusaka', 'Baja hitam bergaris pamor nikel yang berpendar beriak, warangka kayu timoho, mendak emas bermata. Tembakan bergaung gong; lawan lenyap jadi asap tuah.', GUN_FX.keris,
    { tracer: [3.2, 6.5, 5.2], flash: [4, 6, 4.8], muzzle: 'smoke', glow: true, voice: 'gong', kill: 'spirit', emblem: 'keris', color: '#2fd3b0', color2: '#d6a446' }),
  G('gun_petir', 'Badai Petir', 'epik', 'alam', 'Logam badai dengan kilat bercabang yang menyambar dan berkedip. Tembakan menggelegar; kill menyambar petir.', GUN_FX.petir,
    { coat: true, tracer: [5, 5, 10], flash: [4.4, 4.2, 9], muzzle: 'spark', glow: true, voice: 'thunder', kill: 'bolt', emblem: 'petir', color: '#9d90ff', color2: '#efeaff' }),
  G('gun_holo', 'Holografik', 'epik', 'neo', 'Foil pelangi yang bergeser mengikuti sudut pandang, garis difraksi, dan pindaian cahaya. Tembakan berkedip digital.', GUN_FX.holo,
    { coat: true, tracer: [7, 3.5, 7.5], flash: [6, 4.5, 7.5], muzzle: 'spark', glow: true, voice: 'glitch', kill: 'pixel', emblem: 'holo', color: '#ff7ad9', color2: '#62e6ff' }),
  G('gun_mutiara', 'Mutiara Laut', 'epik', 'kencana', 'Nacre berlapis berwarna pastel yang berkilau pelan, berhias emas mawar. Tembakan berdenting lonceng air.', GUN_FX.mutiara,
    { coat: true, tracer: [6.5, 6, 6.8], flash: [5.8, 5.5, 6.5], muzzle: 'frost', glow: true, voice: 'chime', kill: 'pearl', emblem: 'kencana', color: '#f7c6d8', color2: '#bff0ec' }),
  G('gun_garuda', 'Emas Garuda', 'legendaris', 'pusaka', 'Emas berukir bulu garuda dan pernis merah tua berfiligri sayap. Cahaya keemasan menyapu badan senjata, tembakan berdentang gong garuda, dan lawan tersingkir dalam hujan bulu emas.', GUN_FX.garuda,
    { coat: true, tracer: [8, 5.6, 1.6], flash: [8, 5.6, 2], muzzle: 'gold', glow: true, voice: 'garuda', kill: 'feather', emblem: 'garuda', color: '#ffc64a', color2: '#9a1414' }),
  G('gun_reog', 'Dadak Merak', 'legendaris', 'panggung', 'Mata bulu merak berpelangi yang berdenyut dan loreng macan barongan. Tembakan berkendang & bergong, kill disambut kipas bulu merak.', GUN_FX.reog,
    { coat: true, tracer: [1.6, 6.5, 4.6], flash: [2.6, 6, 4.2], muzzle: 'peacock', glow: true, voice: 'reog', kill: 'peacock', emblem: 'merak', color: '#19c9a8', color2: '#2a6bff' }),
  G('gun_magma', 'Inti Magma', 'legendaris', 'alam', 'Obsidian dengan lava yang mengalir di retakannya; laras membara makin panas saat menembak. Dentuman naga, lawan meledak jadi bara.', GUN_FX.magma,
    { coat: true, tracer: [9, 3.4, 0.6], flash: [9, 3.6, 0.8], muzzle: 'ember', glow: true, voice: 'dragon', kill: 'ember', emblem: 'api', color: '#ff6a1a', color2: '#ffd860' }),
  G('gun_plasma', 'Reaktor Plasma', 'legendaris', 'neo', 'Zirah keramik putih dengan kanal plasma yang mengalir ke moncong dan inti yang makin terang saat menembak. Lawan terurai jadi piksel cahaya.', GUN_FX.plasma,
    { coat: true, tracer: [1.8, 7, 10], flash: [1.8, 6.4, 9], muzzle: 'plasma', glow: true, voice: 'plasma', kill: 'disintegrate', emblem: 'reaktor', color: '#2fd8ff', color2: '#e8ecf0' }),
];
const BY = new Map([...CHAR_SKINS, ...GUN_SKINS].map((s) => [s.id, s]));
export const skinById = (id) => BY.get(id) || null;
export const collectionOf = (s) => COLLECTIONS.find((c) => c.id === s.col) || COLLECTIONS[0];
// keistimewaan skin untuk label di toko: animasi, suara tembakan, efek kill, pelacak/kilatan, aura
export function skinFeatures(s) {
  const f = [];
  if (!s) return f;
  if (s.kind === 'weapon') {
    const th = s.th || {};
    if (th.glow) f.push(['anim', 'Animasi & pendar']);
    if (th.voice) f.push(['sound', 'Suara tembakan khusus']);
    if (th.kill) f.push(['kill', 'Efek & spanduk kill']);
    if (th.tracer) f.push(['tracer', th.flash ? 'Pelacak & kilatan khusus' : 'Pelacak berwarna']);
    if (th.muzzle) f.push(['muzzle', 'Partikel moncong']);
  } else {
    if (RARITY[s.rarity].rank >= 2 || s.fx === CHAR_FX.samudra) f.push(['anim', 'Pola beranimasi']);
    if (s.cuffGlow) f.push(['glow', 'Manset menyala']);
    if (s.aura) f.push(['aura', 'Aura & jejak cahaya']);
  }
  return f;
}
// tema senjata yang dipakai pemain (efek kill, spanduk, suara). Skin tanpa efek khusus: ledakan cahaya warna temanya.
export function gunTheme(id = profile.equipped && profile.equipped.weapon) {
  const s = BY.get(id) || GUN_SKINS[0], th = s.th || {};
  return { id: s.id, name: s.name, rarity: s.rarity, voice: th.voice || null, kill: th.kill || 'burst', emblem: th.emblem || 'std', color: th.color || '#d29f52', color2: th.color2 || '#fff1c8' };
}

// Dua bentuk, satu sumber (warna pakaian & perlengkapan + nomor pola fx; warna kulit & rambut TIDAK pernah ikut skin):
// - charOutfit(id) → { outfit } untuk lobi: ditimpakan di atas pakaian dasar si karakter ({ ...dasar, skin, hair, ...outfit }).
//   null = bawaan / id tak dikenal.
// - charPalette(id, base) → palet lengkap siap pakai untuk buildCharacter / setOutfit / crowd.setOutfit: base ditimpa skin;
//   bawaan / id tak dikenal → base itu sendiri.
export function charOutfit(id) {
  const s = BY.get(id);
  return s && s.outfit ? { outfit: { ...s.outfit, fx: s.fx } } : null;
}
export function charPalette(id, base = DEFAULT_OUTFIT) {
  const s = BY.get(id);
  return s && s.outfit ? { ...base, ...s.outfit, fx: s.fx } : base;
}

// ---------- Senjata: material ----------
// model dunia (warna per verteks, di tangan karakter): satu material per skin; kelas bahan ditebak dari warna verteks
const WORLD_MATS = new Map();
function worldGunMaterial(fx, base) {
  const m0 = WORLD_MATS.get(fx);
  if (m0) { if (base.envMap && m0.envMap !== base.envMap) { m0.envMap = base.envMap; m0.needsUpdate = true; } return m0; } // pantulan langit menyusul (rig.js memasangnya belakangan)
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: base.roughness, metalness: base.metalness, envMap: base.envMap || null, envMapIntensity: base.envMapIntensity });
  m.defines = { SF_GUN: fx, SF_WORLD: '' };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSfT = SF_U.uSfT; sh.uniforms.uSfG = SF_G0;
    sh.vertexShader = 'varying vec3 vObjP;\nvarying vec3 vObjN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjP = position; vObjN = normal;');
    sh.fragmentShader = 'varying vec3 vObjP;\nvarying vec3 vObjN;\n' + GUN_SKIN_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  float sfMetal = -1.0, sfRough = -1.0, sfHgt = -1.0, sfCoat = -1.0; vec3 sfEmis = vec3(0.0);
  { vec3 c0 = diffuseColor.rgb; float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b)), sat = (mx - mn) / max(mx, 1e-3);
    int cls = (sat > 0.45 && c0.r > c0.b * 1.8 && mx > 0.2) ? 9 : ((sat > 0.3 && c0.r > c0.b * 1.3) ? 5 : (mx < 0.02 ? 3 : 4)); // aksen emas / kayu / karet / badan
    sfGun(cls, vObjP, normalize(vObjN), abs(dot(normalize(vNormal), normalize(vViewPosition))), c0, sfMetal, sfRough, sfEmis, sfHgt, sfCoat); diffuseColor.rgb = c0; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (sfRough >= 0.0) roughnessFactor = sfRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  if (sfMetal >= 0.0) metalnessFactor = sfMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += sfEmis;');
  };
  m.customProgramCacheKey = () => 'sfworld2';
  WORLD_MATS.set(fx, m);
  return m;
}
// Terapkan skin senjata ke Object3D senjata mana pun: grup senjata orang pertama (vm.gunRoots()), hasil gunPreview(), atau
// mesh model dunia (bagian 'gun_<jenis>' karakter). Aman dipanggil berulang; 'gun_default' / id tak dikenal = tampilan asli.
// Catatan: kaca bidikan, titik bidik, tangan & lengan tidak disentuh.
export function applyGunSkin(root, id) {
  if (!root) return root;
  const s = BY.get(id), fx = s && s.fx ? s.fx : 0, coat = !!(s && s.th && s.th.coat);
  const walk = (o) => {
    if (o !== root && /^fp_/.test(o.name)) return; // tangan & lengan orang pertama (fp_hand_*, fp_forearm) ikut skin karakter, bukan skin senjata
    if (o.isMesh && !o.isSkinnedMesh && o.material && !Array.isArray(o.material)) {
      const base = o.userData.sfBase || o.material;
      if (base.userData && base.userData.vmL) { o.userData.sfBase = base; o.material = fx ? vmSkinned(base, fx, coat) : base; } // material orang pertama
      else if (base.isMeshStandardMaterial && base.vertexColors && !base.map && o.geometry.attributes.color && !o.isInstancedMesh) {
        o.userData.sfBase = base;
        o.material = fx ? worldGunMaterial(fx, base) : base;
      }
    }
    for (const ch of o.children) walk(ch);
  };
  walk(root);
  return root;
}

// ---------- Aura karakter legendaris: serbuk cahaya yang naik berputar & tertinggal saat bergerak ----------
// Satu THREE.Points (ruang dunia, aditif, ±48 partikel). Diperbarui lewat onSkinTick (detak skin per frame); hanya
// memancar selama karakternya tampil. root = akar karakter yang diikuti. Dilepas dengan dispose().
const AURA_VS = `attribute vec4 col; attribute float size; uniform float uH; varying vec4 vC;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = min(40.0, size * uH * projectionMatrix[1][1] * 0.5 / max(0.05, -mv.z)); vC = col; vC.a *= smoothstep(0.3, 1.2, -mv.z); }`;
const AURA_FS = `varying vec4 vC; void main() { vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 18.0) + exp(-dot(c, c) * 160.0); if (a * vC.a < 0.003) discard; gl_FragColor = vec4(vC.rgb * a * vC.a, a * vC.a); }`;
export function createAura(color, root, scene) {
  const N = 48, pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N), S = new Float32Array(N * 8); // vx vy vz t life ph r0 s0
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('col', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setDrawRange(0, 0);
  const uni = { uH: { value: 720 } };
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: uni, vertexShader: AURA_VS, fragmentShader: AURA_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; pts.matrixAutoUpdate = false; pts.renderOrder = 22;
  pts.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); uni.uH.value = rt ? rt.height : renderer.domElement.height; };
  scene.add(pts);
  const c = new THREE.Color(color), wp = new THREE.Vector3();
  let n = 0, acc = 0;
  const off = onSkinTick((dt, t) => {
    if (!dt) return;
    let on = !!root.visible && !!root.parent;
    for (let o = root.parent; on && o; o = o.parent) if (!o.visible) on = false;
    if (on) {
      wp.setFromMatrixPosition(root.matrixWorld);
      acc += dt * 26;
      while (acc >= 1 && n < N) {
        acc -= 1;
        const i = n++, a = Math.random() * Math.PI * 2, r = 0.22 + Math.random() * 0.22, k = i * 8;
        pos[i * 3] = wp.x + Math.cos(a) * r; pos[i * 3 + 1] = wp.y + 0.1 + Math.random() * 1.6; pos[i * 3 + 2] = wp.z + Math.sin(a) * r;
        S[k] = Math.cos(a) * 0.05; S[k + 1] = 0.25 + Math.random() * 0.45; S[k + 2] = Math.sin(a) * 0.05; S[k + 3] = 0; S[k + 4] = 0.9 + Math.random() * 0.9; S[k + 5] = a; S[k + 6] = r; S[k + 7] = 0.025 + Math.random() * 0.035;
      }
      if (acc >= 1) acc = 0;
    }
    for (let i = 0; i < n; i++) {
      const k = i * 8;
      S[k + 3] += dt;
      if (S[k + 3] >= S[k + 4]) { n--; if (i < n) { const j = n; for (let q = 0; q < 3; q++) pos[i * 3 + q] = pos[j * 3 + q]; for (let q = 0; q < 8; q++) S[k + q] = S[j * 8 + q]; i--; } continue; }
      const f = S[k + 3] / S[k + 4], sw = 1.6 * dt; // naik sambil berputar pelan mengitari badan
      const x = pos[i * 3] - wp.x, z = pos[i * 3 + 2] - wp.z, ca = Math.cos(sw), sa = Math.sin(sw);
      if (on) { pos[i * 3] = wp.x + x * ca - z * sa; pos[i * 3 + 2] = wp.z + x * sa + z * ca; }
      pos[i * 3] += S[k] * dt; pos[i * 3 + 1] += S[k + 1] * dt; pos[i * 3 + 2] += S[k + 2] * dt;
      const a = Math.sin(Math.PI * f) * (0.75 + 0.25 * Math.sin(t * 9 + k));
      col[i * 4] = c.r * 2.4; col[i * 4 + 1] = c.g * 2.4; col[i * 4 + 2] = c.b * 2.4; col[i * 4 + 3] = a;
      size[i] = S[k + 7] * (1 - 0.5 * f);
    }
    geo.setDrawRange(0, n);
    if (n) geo.attributes.position.needsUpdate = geo.attributes.col.needsUpdate = geo.attributes.size.needsUpdate = true;
  });
  return { pts, dispose() { off(); scene.remove(pts); geo.dispose(); pts.material.dispose(); } };
}
// aura untuk karakter (char = hasil buildCharacter): satu aura per karakter, diganti/dilepas sesuai skin
export function setCharAura(char, color) {
  if (!char) return;
  if (char.aura && char.aura.color === color) return;
  if (char.aura) { char.aura.dispose(); char.aura = null; }
  const sc = char.root.parent;
  if (!color || !sc) return;
  char.aura = createAura(color, char.root, sc);
  char.aura.color = color;
}

// ---------- Di dalam game ----------
// Pasang skin yang sedang dipakai (profile.equipped) ke pemain: tubuh orang ketiga (+ aura legendaris), lengan orang pertama,
// semua senjata, efek senjata (pelacak, kilatan, partikel, pendar), suara tembakan; lalu kompilasi shader view-model di muka.
// char = hasil buildCharacter; vm = hasil createViewModel; base = pakaian bawaan pemain. Dipanggil saat pertandingan mulai.
export function applyEquipped(char, vm, base = DEFAULT_OUTFIT) {
  const cid = profile.equipped && profile.equipped.character, gid = profile.equipped && profile.equipped.weapon;
  const cs = BY.get(cid), gs = BY.get(gid), th = (gs && gs.th) || {};
  const o = charPalette(cid, base);
  if (char && char.setOutfit) char.setOutfit(o);
  setVmArms(o === base ? {} : { sleeve: o.sleeve || o.shirt, glove: o.glove, cuff: o.cuff, fx: o.fx, cuffGlow: cs && cs.cuffGlow });
  if (vm && vm.gunRoots) for (const g of vm.gunRoots()) applyGunSkin(g, gid);
  if (char && char.parts) for (const k in char.parts) if (k.startsWith('gun_')) for (const m of char.parts[k]) applyGunSkin(m, gid);
  setSkinFx({ tracer: th.tracer || null, flash: th.flash || null, muzzle: th.muzzle || null, glow: !!th.glow, cue: th.voice ? (ev) => audio.skinCue(ev) : null });
  audio.setShotVoice(th.voice || null);
  setCharAura(char, cs && cs.aura);
  if (vm && vm.compile && R0) { try { vm.compile(R0, warmRT()); } catch (e) { console.warn('Kompilasi shader skin gagal:', e.message); } }
}
let RTW = null;
const warmRT = () => RTW || (RTW = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true }));

// ---------- Pratinjau ----------
// Objek 3D siap pakai untuk lobi/toko. previewCharacter: { root, rig, char } berpose diam; previewWeapon: grup senjata.
export function previewCharacter(id, look = { variant: 'm1', hair: 0 }, gear = { pack: false, hair: true }) {
  const char = buildCharacter(charPalette(id), gear, look);
  const st = { speed: 0 };
  for (let i = 0; i < 12; i++) char.rig.pose(st, 0.1);
  return { root: char.root, rig: char.rig, char };
}
export function previewWeapon(kind = 'ar', id = 'gun_default') { const g = gunPreview(kind); return g ? applyGunSkin(g, id) : null; }

// Gambar pratinjau (data URL, latar transparan), dirender sekali dengan renderer game lalu di-cache. initSkins() harus sudah
// dipanggil (main.js); sebelum itu hasilnya ''. Karakter: tiga perempat badan; senjata: senapan tampak tiga perempat.
let R0 = null, ENV = null, SCENE = null, CAM = null, TS = null, TCAM = null, RT = null, PCHAR = null, CV = null, CV2 = null;
const THUMBS = new Map();
let chain = Promise.resolve();
// renderer & langit (env) game; scene & camera dunia = tempat karakter digambar (untuk kompilasi shader di muka)
export function initSkins(renderer, env = null, scene = null, camera = null) { R0 = renderer; ENV = env; SCENE = scene; CAM = camera; }
export const skinRenderer = () => R0;
function thumbScene() {
  if (TS) return;
  TS = new THREE.Scene();
  TS.environment = ENV;
  TS.add(new THREE.HemisphereLight(0xffffff, 0x4a4866, 1.6)); // jenis & jumlah lampu = adegan senjata orang pertama → program shader dipakai ulang
  const key = new THREE.DirectionalLight(0xfff2dd, 2.9);
  key.position.set(1.4, 2.2, 2.4);
  const rim = new THREE.PointLight(0x9db8ff, 14, 0, 2);
  rim.position.set(-1.6, 1.9, -1.8);
  TS.add(key, rim);
  TCAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 30);
}
function shoot(obj, S, frame) {
  thumbScene();
  if (!RT || RT.width !== S) { if (RT) RT.dispose(); RT = new THREE.WebGLRenderTarget(S, S, { depthBuffer: true }); }
  TS.add(obj);
  obj.updateMatrixWorld(true);
  frame(TCAM);
  TCAM.updateProjectionMatrix();
  const prevRT = R0.getRenderTarget(), prevAuto = R0.autoClear, cc = R0.getClearColor(new THREE.Color()), ca = R0.getClearAlpha();
  R0.setRenderTarget(RT); R0.setClearColor(0x000000, 0); R0.autoClear = true;
  R0.render(TS, TCAM);
  const px = new Uint8Array(S * S * 4);
  R0.readRenderTargetPixels(RT, 0, 0, S, S, px);
  R0.setRenderTarget(prevRT); R0.setClearColor(cc, ca); R0.autoClear = prevAuto;
  TS.remove(obj);
  // linear → sRGB (sedikit dipadatkan supaya pendar HDR tidak memutih) lewat tabel 256 nilai + balik vertikal
  CV = CV || document.createElement('canvas');
  CV.width = CV.height = S;
  const g = CV.getContext('2d'), im = g.createImageData(S, S), d = im.data;
  for (let y = 0; y < S; y++) {
    const src = (S - 1 - y) * S * 4, dst = y * S * 4;
    for (let x = 0; x < S * 4; x += 4) { d[dst + x] = TM[px[src + x]]; d[dst + x + 1] = TM[px[src + x + 1]]; d[dst + x + 2] = TM[px[src + x + 2]]; d[dst + x + 3] = px[src + x + 3]; }
  }
  g.putImageData(im, 0, 0);
  return CV;
}
const TM = new Uint8Array(256).map((_, v) => Math.round(255 * Math.pow(Math.min(1, (v / 255) / (1 + 0.15 * v / 255)), 1 / 2.2)));
function renderThumb(id, size) {
  const s = BY.get(id);
  if (!s || !R0) return '';
  const S = size * 2;
  let cv;
  if (id.startsWith('char_')) {
    if (!PCHAR) PCHAR = previewCharacter('char_default');
    PCHAR.char.setOutfit(charPalette(id));
    PCHAR.root.rotation.y = -0.5;
    cv = shoot(PCHAR.root, S, (cam) => { // lutut sampai kepala, sedikit dari atas
      cam.position.set(0.25, 1.4, 4); cam.lookAt(0, 1.27, 0);
      Object.assign(cam, { left: -0.54, right: 0.54, top: 0.54, bottom: -0.54 });
    });
  } else {
    const gun = previewWeapon('ar', id);
    if (!gun) return '';
    const hold = new THREE.Group();
    hold.add(gun);
    hold.rotation.set(0.42, 0, 0); // laras naik: komposisi diagonal mengisi bingkai persegi
    cv = shoot(hold, S, (cam) => {
      const bb = new THREE.Box3().setFromObject(hold), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      const dir = new THREE.Vector3(1, 0.22, -0.45).normalize(), h = Math.max(sz.y, sz.z * 0.92) * 0.41;
      cam.position.copy(c).addScaledVector(dir, 5); cam.up.set(0, 1, 0); cam.lookAt(c);
      Object.assign(cam, { left: -h, right: h, top: h, bottom: -h });
    });
  }
  CV2 = CV2 || document.createElement('canvas');
  CV2.width = CV2.height = size;
  const g2 = CV2.getContext('2d');
  g2.clearRect(0, 0, size, size);
  g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
  g2.drawImage(cv, 0, 0, S, S, 0, 0, size, size);
  let url = CV2.toDataURL('image/webp', 0.92);
  if (!url.startsWith('data:image/webp')) url = CV2.toDataURL('image/png');
  return url;
}
export function skinThumb(id, size = 256) {
  const key = id + '@' + size;
  if (THUMBS.has(key)) return Promise.resolve(THUMBS.get(key));
  // satu per satu dengan jeda (tidak menahan frame); gagal → '' dan boleh dicoba lagi nanti
  const p = chain.then(() => new Promise((res) => setTimeout(() => {
    if (THUMBS.has(key)) { res(THUMBS.get(key)); return; }
    let url = '';
    try { url = renderThumb(id, size); } catch (e) { console.warn('Pratinjau skin gagal:', id, e.message); }
    if (url) THUMBS.set(key, url);
    res(url);
  }, 12)));
  chain = p;
  return p;
}
