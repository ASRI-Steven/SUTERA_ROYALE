// Profil pemain (sementara, hanya di peramban ini): nama, koin, skin yang dimiliki & dipakai, regu, misi, statistik.
// Disimpan di localStorage (kunci royale.profile.v1). Tanpa server. ID skin: 'char_<nama>' / 'gun_<nama>'; bawaan selalu dimiliki.
const KEY = 'royale.profile.v1';
const DEF = {
  name: 'Pemain', coins: 0,
  owned: ['char_default', 'gun_default'],
  equipped: { character: 'char_default', weapon: 'gun_default' },
  party: [false, false, false], // slot rekan 2–4 yang terisi bot (lobi mulai sendirian; diisi lewat tombol + di lobi)
  squad: [],      // tiga rekan regu (bot): { name, skin, variant, hair, tone, hairC } — lihat ensureSquad()
  quests: null,   // keadaan misi — diisi game/quests.js
  // fields: bidang ringkasan pertandingan tambahan yang pernah diterima (misi yang memerlukannya baru muncul setelah itu)
  stats: { matches: 0, wins: 0, kills: 0, damage: 0, bestRank: 0, lastTotal: 0, earned: 0, fields: [] },
};
// rekan regu bawaan: nama, skin, bentuk tubuh (varian model: m1/f1/m2/f2), gaya rambut, warna kulit & rambut
const SQUAD_DEF = [
  { name: 'Raka', skin: 'char_default', variant: 'm2', hair: 1, tone: '#a8714f', hairC: '#1d1714' },
  { name: 'Dewi', skin: 'char_default', variant: 'f1', hair: 0, tone: '#e0ac85', hairC: '#3a2a1e' },
  { name: 'Bima', skin: 'char_default', variant: 'f2', hair: 1, tone: '#c68c66', hairC: '#2b2b2b' },
];
const clone = (o) => JSON.parse(JSON.stringify(o));
function read() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && typeof o === 'object') return { ...clone(DEF), ...o, equipped: { ...DEF.equipped, ...(o.equipped || {}) }, stats: { ...DEF.stats, ...(o.stats || {}) }, owned: [...new Set([...DEF.owned, ...(o.owned || [])])] };
  } catch (e) { /* profil rusak → mulai baru */ }
  return clone(DEF);
}
export const profile = read();
export function saveProfile() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* penyimpanan penuh/ditolak: abaikan */ } }
export function addCoins(n) { profile.coins = Math.max(0, Math.round(profile.coins + n)); saveProfile(); return profile.coins; }
export function owns(id) { return profile.owned.includes(id); }
export function buy(id, price) { if (owns(id)) return true; if (profile.coins < price) return false; profile.coins -= price; profile.owned.push(id); saveProfile(); return true; }
export function equip(slot, id) { if (!owns(id)) return false; profile.equipped[slot] = id; saveProfile(); return true; }
export function setName(name) { const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 14); if (!n) return false; profile.name = n; saveProfile(); return true; }
// regu selalu berisi tiga rekan yang sah (profil lama / rusak dilengkapi dari bawaan); skin rekan harus skin yang dimiliki
export function ensureSquad() {
  const sq = Array.isArray(profile.squad) ? profile.squad : [];
  profile.squad = SQUAD_DEF.map((d, i) => {
    const o = sq[i] && typeof sq[i] === 'object' ? sq[i] : {};
    return { ...d, ...o, name: String(o.name || d.name).slice(0, 14), skin: owns(o.skin) ? o.skin : d.skin };
  });
  return profile.squad;
}
// slot rekan (indeks 0–2 = anggota 2–4) yang terisi bot; selalu tiga boolean
export function partySlots() {
  const p = Array.isArray(profile.party) ? profile.party : [];
  profile.party = [0, 1, 2].map((i) => p[i] === true);
  return profile.party;
}
export function setParty(i, on) { const p = partySlots(); if (i < 0 || i > 2) return false; p[i] = !!on; saveProfile(); return true; }
export function setMate(i, patch) {
  const m = ensureSquad()[i];
  if (!m) return false;
  if (patch.name !== undefined) { const n = String(patch.name).replace(/\s+/g, ' ').trim().slice(0, 14); if (n) m.name = n; }
  if (patch.skin !== undefined && owns(patch.skin)) m.skin = patch.skin;
  saveProfile();
  return true;
}
