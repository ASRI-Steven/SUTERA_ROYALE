# Rancangan: laju zona yang bisa dikejar dengan lari

Desainer: Fable (sesi utama), 24 Nov 2026. Dieksekusi di worktree `.wt/zona` (branch `wip/zona`).

Keluhan Steven (verbatim): "terus itu zona jangan cepet banget geraknya anjing gw udah lari tetap jauh banget gw keburu mati terus".

## Akar masalah (dari `web/game/zone.js` + data peta)

- Peta 2,55 × 5,1 km. Lingkaran penutup awal ±2.700 m dari pusat. Lingkaran aman pertama `R1 = 1100`.
- Lari cepat pemain 6,6 m/dtk (`player.js` `SPEED.sprint`).
- **Fase 0:** dinding 2.700 → 1.100 m dalam `maxDur` 130 dtk = 12,3 m/dtk. Pemain di ujung peta harus menempuh ±1.450 m = 220 dtk lari lurus tanpa henti; waktu tersedia 100 + 130 = 230 dtk.
- **Fase 1+:** pusat lingkaran berikut boleh bergeser sejauh (r_sekarang − r_berikut). Akibatnya sisi jauh dinding menempuh sampai 2 × Δr selama `dur`. Fase 1: 990 m dalam 62 dtk = 16 m/dtk; waktu total 137 dtk → butuh 7,2 m/dtk, lebih cepat dari lari cepat. Mustahil tanpa kendaraan.
- `dur = min(maxDur, Δr / speed)`: `maxDur` justru menaikkan laju di atas `speed`.

## Aturan baru

A. **Laju sisi jauh dinding dibatasi per fase, selalu di bawah lari cepat.**
   - `WALL = [4.6, 4.6, 4.4, 4.0, 3.4, 2.8, 2.2, 1.8]` m/dtk.
   - `travel = (cur.r − next.r) + jarak(pusat cur, pusat next)`.
   - `dur = max(MIN_SHRINK, travel / WALL[fase])`.
   - `maxDur` dihapus.
B. **Geser pusat dibatasi:** `pickInside(cx, cy, 0.6 × (cur.r − r))` (sekarang 1,0 ×).
C. **`R1 = 1400`** (dari 1100).
D. **Tabel fase:**

   | Fase | wait (dtk) | ratio | dps |
   |---|---|---|---|
   | 0 | 90 | – | 0,6 |
   | 1 | 60 | 0,55 | 1 |
   | 2 | 45 | 0,55 | 2 |
   | 3 | 40 | 0,5 | 3 |
   | 4 | 35 | 0,5 | 5 |
   | 5 | 30 | 0,45 | 7 |
   | 6 | 25 | 0,4 | 10 |
   | 7 | 20 | 0 | 14 |

   `ratio` tidak berubah.
E. **Jaminan yang harus terbukti lewat uji.** Untuk tiap fase: `wait + dur ≥ travelTerburuk / 5,2 + kelonggaran`, dengan kelonggaran `[60, 40, 30, 20, 10, 5, 0, 0]` dtk. `travelTerburuk` = jarak pemain di tepi terjauh lingkaran sekarang ke tepi lingkaran berikut. 5,2 m/dtk = lari realistis dengan rintangan.
F. **Bot.** `zoneUrgent` (`web/game/bots.js` ±792–794) sekarang memakai `def.speed` dan `def.maxDur`. Ganti dengan getter baru `zone.radialSpeed` (laju susut jari-jari, m/dtk):
   - saat `shrink`: `(from.r − next.r) / dur`;
   - saat `wait`: `(cur.r − next.r) / durPrediksi`.
   Telusuri semua pemakai `PHASES` / `def.*` (grep) supaya tidak ada yang rusak. `def.speed` boleh dipertahankan sebagai nama batas `WALL`.
G. **HUD.** Teks "−X HP/dtk" harus benar untuk dps pecahan (0,6).

Perkiraan lama maksimum pertandingan: ±19–20 menit (sekarang ±14). Diterima.

## Uji dan kriteria lulus (laporkan angkanya)

1. **Node, simulasi ≥ 10.000 rangkaian zona** memakai logika `zone.js` asli (`inArea` dari data peta asli, atau tiruan yang setara):
   - laju sisi jauh maksimum per fase ≤ `WALL` + 1 %;
   - aturan E terpenuhi di 100 % kasus;
   - cetak tabel per fase: `dur` min/median/maks, laju maks, waktu tersedia vs waktu perlu terburuk, lama total pertandingan.
2. **Browser** (alat `.wt/_tools`; zona dimajukan dari skrip uji dengan memanggil `__G.zone.update(dt)` berulang, tanpa flag di kode):
   - 0 error konsol;
   - HUD menampilkan fase, waktu, dan dps dengan benar;
   - pemain uji yang digerakkan lurus 5,2 m/dtk dari tepi terjauh selalu masuk lingkaran berikut sebelum dinding menyusulnya, di semua fase.
3. **Bot.** Bandingkan sebelum/sesudah jumlah bot yang mati karena zona dalam satu pertandingan yang dipercepat (atau sejauh bisa diukur). Tidak boleh naik.

## Aturan kerja
- Ubah hanya `web/game/zone.js`, blok `zoneUrgent` di `web/game/bots.js`, dan format dps di `web/game/hud.js` bila perlu. `bots.js` sedang diubah agen lain di bagian lain; jangan sentuh di luar blok itu.
- Jangan edit `HANDOFF.md`; paragraf HANDOFF ditulis di laporan.
- `?v=` di `web/royale.html`: modul yang diubah di-set ke `20261124`. Bila nilainya sudah `20261124`, jadikan `20261125`.
