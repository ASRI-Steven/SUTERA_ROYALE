// Misi acak harian & mingguan → Koin Sutera. Murni logika (tanpa DOM/three), diuji terpisah dengan ringkasan buatan.
// - 3 misi harian (mudah, sedang, sulit) + 2 misi mingguan, dipilih acak tetapi DETERMINISTIK dari tanggal (+ jumlah acak-ulang):
//   memuat ulang halaman tidak mengubahnya. Harian berganti tengah malam waktu setempat, mingguan tiap Senin.
// - Kemajuan dihitung dari ringkasan pertandingan (game/hooks.js matchHooks.onEnd). Bidang tambahan (tembakan kepala, revive,
//   jarak berkendara, …) bersifat opsional: misi yang memerlukannya baru masuk undian setelah bidang itu pernah diterima.
// - Skala hadiah terhadap harga skin (biasa 300, langka 800, epik 1800, legendaris 4000): harian ±110/160/230 (total ±500),
//   mingguan 650–900 per misi (total ±1500).
import { profile, saveProfile, addCoins } from './profile.js';

// kelas senjata untuk misi "kill dengan …" (kunci = jenis di game/weapons.js WEAPONS)
const GUN_CLASS = {
  senapan: { label: 'senapan serbu', kinds: ['ar', 'burst', 'dmr', 'lmg'] },
  smg: { label: 'SMG', kinds: ['smg', 'pdw'] },
  shotgun: { label: 'shotgun', kinds: ['shotgun', 'dbs'] },
  runduk: { label: 'senapan runduk', kinds: ['sniper'] },
  pistol: { label: 'pistol', kinds: ['pistol', 'revolver'] },
};
const km = (m) => (m % 1000 === 0 ? m / 1000 : (m / 1000).toFixed(1).replace('.', ','));
const rankOf = (s) => (s.squadRank ?? s.rank ?? 999), totalOf = (s) => (s.squads ?? s.total ?? 0);
// "masuk N besar": N ditulis untuk 25 regu; pertandingan perorangan (±100 peserta) memakai 4N
const topN = (n, total) => (total > 30 ? n * 4 : n);
// mode: 'sum' = dijumlah antar-pertandingan · 'best' = nilai terbaik dalam satu pertandingan · 'count' = banyaknya pertandingan yang lolos
// tiers: [sasaran, hadiah] dari mudah ke sulit. need: bidang ringkasan tambahan yang diperlukan.
const DAILY = [
  { id: 'kill', icon: 'skull', mode: 'sum', tiers: [[3, 110], [5, 160], [8, 230]], text: (n) => `Singkirkan ${n} musuh`, val: (s) => s.kills || 0 },
  { id: 'dmg', icon: 'burst', mode: 'sum', tiers: [[300, 110], [600, 160], [1000, 230]], text: (n) => `Berikan ${n} kerusakan`, val: (s) => s.damage || 0 },
  { id: 'survive', icon: 'clock', mode: 'sum', tiers: [[360, 110], [720, 160], [1200, 220]], text: (n) => `Bertahan hidup total ${Math.round(n / 60)} menit`, val: (s) => s.surviveSec || 0, unit: 'min' },
  { id: 'play', icon: 'flag', mode: 'sum', tiers: [[1, 100], [2, 140], [3, 190]], text: (n) => `Selesaikan ${n} pertandingan`, val: () => 1 },
  { id: 'top', icon: 'trophy', mode: 'count', tiers: [[10, 120], [5, 180], [3, 250]], text: (n, q, total) => `Masuk ${topN(n, total)} besar`, ok: (s, n) => rankOf(s) <= topN(n, totalOf(s)), target: 1 },
  { id: 'spree', icon: 'target', mode: 'best', tiers: [[2, 120], [4, 180], [6, 250]], text: (n) => `${n} kill dalam satu pertandingan`, val: (s) => s.kills || 0 },
  { id: 'win', icon: 'crown', mode: 'count', tiers: [[1, 260], [1, 260], [1, 260]], hardOnly: true, text: () => 'Menangkan satu pertandingan', ok: (s) => !!s.win, target: 1 },
  { id: 'head', icon: 'head', need: 'headshots', mode: 'sum', tiers: [[2, 130], [4, 180], [6, 240]], text: (n) => `${n} tembakan kepala`, val: (s) => s.headshots || 0 },
  { id: 'revive', icon: 'heart', need: 'revives', mode: 'sum', tiers: [[1, 120], [2, 170], [3, 230]], text: (n) => `Hidupkan kembali rekan ${n} kali`, val: (s) => s.revives || 0 },
  { id: 'knock', icon: 'down', need: 'knocks', mode: 'sum', tiers: [[3, 110], [5, 160], [8, 220]], text: (n) => `Jatuhkan ${n} musuh`, val: (s) => s.knocks || 0 },
  { id: 'assist', icon: 'hands', need: 'assists', mode: 'sum', tiers: [[2, 110], [4, 160], [6, 220]], text: (n) => `${n} assist untuk regu`, val: (s) => s.assists || 0 },
  { id: 'wkill', icon: 'gun', need: 'weaponKills', mode: 'sum', tiers: [[2, 130], [3, 180], [5, 240]], params: Object.keys(GUN_CLASS), text: (n, q) => `${n} kill dengan ${GUN_CLASS[q.param].label}`, val: (s, q) => GUN_CLASS[q.param].kinds.reduce((a, k) => a + ((s.weaponKills || {})[k] || 0), 0) },
  { id: 'far', icon: 'scope', need: 'longestKillM', mode: 'best', tiers: [[60, 130], [100, 190], [150, 260]], text: (n) => `Kill dari jarak di atas ${n} m`, val: (s) => Math.floor(s.longestKillM || 0), unit: 'm' },
  { id: 'drive', icon: 'car', need: 'drivenM', mode: 'sum', tiers: [[1000, 110], [2000, 160], [3500, 220]], text: (n) => `Tempuh ${km(n)} km dengan kendaraan`, val: (s) => Math.round(s.drivenM || 0), unit: 'km' },
  { id: 'road', icon: 'wheel', need: 'roadKills', mode: 'sum', tiers: [[1, 150], [1, 150], [2, 230]], text: (n) => (n > 1 ? `Lindas ${n} musuh dengan kendaraan` : 'Lindas satu musuh dengan kendaraan'), val: (s) => s.roadKills || 0 },
  { id: 'nade', icon: 'nade', need: 'nadeKills', mode: 'sum', tiers: [[1, 150], [1, 150], [2, 230]], text: (n) => (n > 1 ? `${n} kill dengan granat` : 'Satu kill dengan granat'), val: (s) => s.nadeKills || 0 },
  { id: 'heal', icon: 'medkit', need: 'healsUsed', mode: 'sum', tiers: [[3, 110], [5, 150], [8, 200]], text: (n) => `Pakai ${n} perban atau P3K`, val: (s) => s.healsUsed || 0 },
  { id: 'loot', icon: 'crate', need: 'lootCount', mode: 'sum', tiers: [[15, 110], [25, 150], [40, 200]], text: (n) => `Jarah ${n} barang`, val: (s) => s.lootCount || 0 },
  { id: 'walk', icon: 'boot', need: 'onFootM', mode: 'sum', tiers: [[1000, 110], [2000, 150], [3000, 200]], text: (n) => `Berjalan kaki ${km(n)} km`, val: (s) => Math.round(s.onFootM || 0), unit: 'km' },
];
const WEEKLY = [
  { id: 'kill', icon: 'skull', mode: 'sum', tiers: [[30, 800], [45, 900]], text: (n) => `Singkirkan ${n} musuh`, val: (s) => s.kills || 0 },
  { id: 'win', icon: 'crown', mode: 'count', tiers: [[2, 900]], text: (n) => `Menangkan ${n} pertandingan`, ok: (s) => !!s.win },
  { id: 'top', icon: 'trophy', mode: 'count', tiers: [[4, 750]], text: (n, q, total) => `Masuk ${topN(5, total)} besar ${n} kali`, ok: (s) => rankOf(s) <= topN(5, totalOf(s)) },
  { id: 'dmg', icon: 'burst', mode: 'sum', tiers: [[5000, 700]], text: (n) => `Berikan ${n.toLocaleString('id-ID')} kerusakan`, val: (s) => s.damage || 0 },
  { id: 'survive', icon: 'clock', mode: 'sum', tiers: [[4500, 650]], text: (n) => `Bertahan hidup total ${Math.round(n / 60)} menit`, val: (s) => s.surviveSec || 0, unit: 'min' },
  { id: 'play', icon: 'flag', mode: 'sum', tiers: [[10, 650]], text: (n) => `Selesaikan ${n} pertandingan`, val: () => 1 },
  { id: 'head', icon: 'head', need: 'headshots', mode: 'sum', tiers: [[15, 800]], text: (n) => `${n} tembakan kepala`, val: (s) => s.headshots || 0 },
  { id: 'revive', icon: 'heart', need: 'revives', mode: 'sum', tiers: [[8, 750]], text: (n) => `Hidupkan kembali rekan ${n} kali`, val: (s) => s.revives || 0 },
  { id: 'knock', icon: 'down', need: 'knocks', mode: 'sum', tiers: [[30, 750]], text: (n) => `Jatuhkan ${n} musuh`, val: (s) => s.knocks || 0 },
  { id: 'drive', icon: 'car', need: 'drivenM', mode: 'sum', tiers: [[10000, 650]], text: (n) => `Tempuh ${km(n)} km dengan kendaraan`, val: (s) => Math.round(s.drivenM || 0), unit: 'km' },
];
const POOL = { daily: DAILY, weekly: WEEKLY };
const EXT_FIELDS = ['headshots', 'revives', 'knocks', 'assists', 'weaponKills', 'longestKillM', 'drivenM', 'roadKills', 'nadeKills', 'healsUsed', 'lootCount', 'onFootM'];

// ---------- acak deterministik ----------
function hashStr(str) { // FNV-1a + pengaduk akhir (murmur3) supaya kunci yang mirip (tanggal berurutan) menghasilkan benih yang jauh berbeda
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(d = new Date()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
// Senin pekan itu (waktu setempat)
function monday(d) { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }
export function weekKey(d = new Date()) { return 'w' + dayKey(monday(d)); }

function roll(scope, key, rollNo, count) {
  const have = new Set((profile.stats && profile.stats.fields) || []);
  const pool = POOL[scope].filter((t) => !t.need || have.has(t.need));
  const r = rng(hashStr(scope + '|' + key + '|' + rollNo));
  const order = pool.map((t, i) => [r(), i]).sort((a, b) => a[0] - b[0]).map((e) => pool[e[1]]);
  const out = [];
  if (scope === 'daily') {
    const tiers = [0, 1, 2].map((t) => [r(), t]).sort((a, b) => a[0] - b[0]).map((e) => e[1]); // siapa dapat mudah/sedang/sulit
    for (const t of order) {
      if (out.length >= count) break;
      const tier = tiers[out.length];
      if (t.hardOnly && tier !== 2) continue;
      const [n, reward] = t.tiers[Math.min(tier, t.tiers.length - 1)];
      out.push({ id: t.id, tier, n, reward, p: 0, done: false, param: t.params ? t.params[Math.floor(r() * t.params.length)] : undefined });
    }
    for (const t of order) { // cadangan bila ada yang terlewat karena hardOnly
      if (out.length >= count) break;
      if (out.some((q) => q.id === t.id) || t.hardOnly) continue;
      const tier = tiers[out.length], [n, reward] = t.tiers[Math.min(tier, t.tiers.length - 1)];
      out.push({ id: t.id, tier, n, reward, p: 0, done: false, param: t.params ? t.params[Math.floor(r() * t.params.length)] : undefined });
    }
  } else {
    for (const t of order) {
      if (out.length >= count) break;
      const [n, reward] = t.tiers[Math.floor(r() * t.tiers.length)];
      out.push({ id: t.id, tier: 3, n, reward, p: 0, done: false });
    }
  }
  return out;
}
// pastikan misi hari/pekan ini ada (dibuat ulang bila tanggal/pekan berganti); mengembalikan keadaan tersimpan
function ensure(now = new Date()) {
  let Q = profile.quests;
  if (!Q || typeof Q !== 'object') Q = profile.quests = { day: '', dayRoll: 0, daily: [], week: '', weekly: [] };
  const dk = dayKey(now), wk = weekKey(now);
  let changed = false;
  if (Q.day !== dk || !Array.isArray(Q.daily) || Q.daily.length !== 3) { Q.day = dk; Q.dayRoll = 0; Q.daily = roll('daily', dk, 0, 3); changed = true; }
  if (Q.week !== wk || !Array.isArray(Q.weekly) || Q.weekly.length !== 2) { Q.week = wk; Q.weekly = roll('weekly', wk, 0, 2); changed = true; }
  if (changed) saveProfile();
  return Q;
}
const tplOf = (scope, q) => POOL[scope].find((t) => t.id === q.id) || null;
const targetOf = (t, q) => (t.mode === 'count' ? (t.target || q.n) : q.n);
function view(scope, q, index) {
  const t = tplOf(scope, q), total = (profile.stats && profile.stats.lastTotal) || 25;
  const target = t ? targetOf(t, q) : q.n, p = Math.min(q.p, target);
  return { scope, index, id: q.id, icon: t ? t.icon : 'flag', text: t ? t.text(q.n, q, total) : 'Misi', n: target, p, unit: t ? t.unit || '' : '', reward: q.reward, tier: q.tier, complete: q.p >= target, claimed: !!q.done };
}
// keadaan misi untuk ditampilkan
export function questState(now = new Date()) {
  const Q = ensure(now), nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), nextWeek = monday(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const daily = Q.daily.map((q, i) => view('daily', q, i)), weekly = Q.weekly.map((q, i) => view('weekly', q, i));
  return { daily, weekly, rerollLeft: Q.dayRoll ? 0 : 1, canReroll: !Q.dayRoll && Q.daily.some((q) => !q.done), dailyMs: nextDay - now, weeklyMs: nextWeek - now, claimable: [...daily, ...weekly].filter((q) => q.complete && !q.claimed).reduce((a, q) => a + q.reward, 0) };
}
// satu pertandingan selesai → kemajuan misi. Mengembalikan daftar perubahan [{ before, after }] (tampilan sebelum & sesudah)
export function applyMatch(summary, now = new Date()) {
  const s = summary || {}, Q = ensure(now), st = profile.stats, out = [];
  // bidang tambahan yang kini tersedia → misi jenis baru boleh muncul di undian berikutnya
  const fields = new Set(st.fields || []);
  for (const f of EXT_FIELDS) if (s[f] !== undefined && s[f] !== null) fields.add(f);
  st.fields = [...fields];
  if (totalOf(s)) st.lastTotal = totalOf(s);
  for (const scope of ['daily', 'weekly']) Q[scope].forEach((q, i) => {
    const t = tplOf(scope, q);
    if (!t || q.done) return;
    const before = view(scope, q, i), target = targetOf(t, q);
    if (q.p >= target) return; // sudah tuntas, tinggal diklaim
    if (t.mode === 'sum') q.p = Math.min(target, q.p + Math.max(0, t.val(s, q)));
    else if (t.mode === 'best') q.p = Math.max(q.p, Math.min(target, Math.max(0, t.val(s, q))));
    else if (t.ok(s, q.n)) q.p = Math.min(target, q.p + 1);
    const after = view(scope, q, i);
    if (after.p !== before.p) out.push({ before, after });
  });
  st.matches = (st.matches || 0) + 1;
  if (s.win) st.wins = (st.wins || 0) + 1;
  st.kills = (st.kills || 0) + (s.kills || 0);
  st.damage = (st.damage || 0) + (s.damage || 0);
  const rk = rankOf(s);
  if (rk < 999 && (!st.bestRank || rk < st.bestRank)) st.bestRank = rk;
  saveProfile();
  return out;
}
// klaim satu misi yang tuntas → koin (0 kalau belum tuntas / sudah diklaim)
export function claimQuest(scope, index, now = new Date()) {
  const Q = ensure(now), q = Q[scope] && Q[scope][index], t = q && tplOf(scope, q);
  if (!q || !t || q.done || q.p < targetOf(t, q)) return 0;
  q.done = true;
  profile.stats.earned = (profile.stats.earned || 0) + q.reward;
  addCoins(q.reward); // menyimpan profil
  return q.reward;
}
export function claimAll(now = new Date()) { let sum = 0; for (const scope of ['daily', 'weekly']) for (let i = 0; i < ensure(now)[scope].length; i++) sum += claimQuest(scope, i, now); return sum; }
// acak ulang misi harian yang belum diklaim: sekali sehari, gratis; kemajuan misi yang diganti hilang
export function rerollDaily(now = new Date()) {
  const Q = ensure(now);
  if (Q.dayRoll || !Q.daily.some((q) => !q.done)) return false;
  Q.dayRoll = 1;
  const fresh = roll('daily', Q.day, 1, 3), used = new Set(Q.daily.filter((q) => q.done).map((q) => q.id));
  const spare = fresh.filter((q) => !used.has(q.id));
  Q.daily = Q.daily.map((q) => (q.done ? q : (spare.shift() || q)));
  saveProfile();
  return true;
}
export function fmtLeft(ms) { // "5 j 12 m" / "2 h 4 j"
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d} h ${h} j` : h > 0 ? `${h} j ${mm} m` : `${mm} m`;
}
export function fmtProgress(q) { // "2 / 5", "3 / 6 menit", "1,2 / 2 km"
  if (q.unit === 'min') return `${Math.floor(q.p / 60)} / ${Math.round(q.n / 60)} menit`;
  if (q.unit === 'km') return `${(q.p / 1000).toFixed(1).replace('.', ',')} / ${km(q.n)} km`;
  if (q.unit === 'm') return q.complete ? `${q.n} m tercapai` : `terjauh ${q.p} m`;
  return `${q.p.toLocaleString('id-ID')} / ${q.n.toLocaleString('id-ID')}`;
}
