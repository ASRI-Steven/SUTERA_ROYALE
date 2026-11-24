# Rancangan tata letak kawasan Sutera Royale: perapi tata letak, pohon, tembok keliling cluster

## 0. Status, metode, batasan

- Ini rancangan saja. Tidak ada file yang kuubah atau kubuat, termasuk di folder scratch, karena modeku baca-saja. Semua audit dijalankan inline (`node -e`, `python3 -c`) dan tidak meninggalkan berkas.
- Harness browser tidak kupakai, jadi tidak ada proses serve/cdpd milikku yang perlu dimatikan. Akibatnya belum ada verifikasi visual di game; semua angka berasal dari data dan modul game yang dijalankan di node.
- Basis angka: main @4edfede. Sampai fa5a1de, `web/data/*`, `tools/*`, `trees.js`, `interiors.js`, `envprops.js`, `nav.js` tidak berubah (dicek `git diff --stat`), jadi angka masih berlaku. `bots.js`, `collide.js`, `zone.js`, `world.js` berubah, maka kode kusebut per nama fungsi.
- Cara ukur: `planHomes`, `cleanTrees`, `createCollider` dijalankan di node (pola `.wt/_tools/audit-lantai.mjs`). Rintangan envprops kutiru dari data + manifest: 4.221 rintangan (game 4.286), 7 benda dibuang (sama dengan HANDOFF §32b).
- Prototipe tembok: raster 1 m seluruh kawasan (13,7 juta sel), 3,7 detik di node. Prototipe pangkas gedung dan saringan pohon juga dijalankan; hasilnya di bagian masing-masing.

## 1. Audit

### 1a. Pohon dan semak terhadap pintu

| Ukuran | Jumlah |
|---|---|
| Pohon akhir (sesudah `cleanTrees`) / semak | 8.445 / 7.157 |
| Pintu: depan rumah / belakang rumah / gedung lain | 5.591 / 3.793 / 2.393 |
| Pohon di koridor pintu depan (lebar pintu + 0,65 m tiap sisi, 0–6 m) | 229 pohon, 230 pintu |
| Pohon di koridor pintu belakang / pintu gedung lain | 16 / 3 |
| Pohon menembus teras | 105 (105 teras) |
| Pohon unik di koridor atau teras | 287 |
| Pohon di halaman depan (selebar fasad, dinding sampai tepi jalan, maks 8 m) | 844, di 845 rumah (15%) |
| Batang < 1 m / < 1,5 m dari dinding | 47 / 138 |
| Tajuk menembus dinding > 0,5 m / ≥ 1 m | 468 / 374 |
| Pohon berdiri di pita trotoar | 492 (454 di jalan utama) |
| Pohon ≤ 6 m / ≤ 8 m dari titik simpang | 149 / 662 |
| Semak di koridor pintu / di teras | 4 / 4 |
| Pintu tertutup ≤ 1,5 m di luar (badan 0,35 m) oleh pohon | 19 (17 depan, 2 belakang) |
| … oleh gedung tetangga | 176 (12 depan, 114 belakang, 50 gedung lain) |
| … oleh benda, pagar, tembok sayap | 0 |

- **Contoh koridor pintu (x, y):** (147,6; 652,6) rumah #60 · (931,8; 1767,7) #635 · (−389,9; −1385,3) #1457 · (480,8; −831,2) #2734 · (399,9; −1639,5) #3463.
- **Contoh teras:** (69,8; 617,8) #74 (sama dengan contoh agen bangunan) · (−398,9; −1617,9) #1581 · (666,7; −714,1) #2696 · (399,6; −1051,7) #3230 · (484,8; 710,0) #3926.
- **Akar masalah:**
  - `plant_trees` di `tools/build_map.py` menanam deret di `lebar/2 + 2,4 m` tiap 15/18 m dengan peluang 0,85/0,5 tanpa melihat rumah. Median sempadan pintu depan ke tepi aspal 5,6 m, jadi pohon jatuh tepat di antara pintu dan jalan.
  - `cleanTrees` hanya membuang pohon di gedung/aspal/air.
  - `planPorch` tidak menguji pohon.
  - `upgradeTrees` (world.js) membolehkan jari-jari tajuk = ruang + 1,2 m, jadi tajuk memang menembus dinding.

### 1b. Tembok cluster

- 48 ring residential, total keliling **65.285 m**.
- Tembok sayap yang ada: 50 gapura, 82 tembok, **1.166 m**. Hanya **123 m** yang berada ≤ 2 m dari garis ring (**0,19%** keliling), dalam 14 potongan, terpanjang 21 m. Sisanya jatuh ke cabang "tembok lurus" di `wing()` dan tidak mengikuti batas.
- 38 dari 48 ring sama sekali tanpa tembok di garis ringnya. Celahnya adalah seluruh keliling di luar ≤ 17 m kiri-kanan gapura.
- Jalan memotong ring: **144 titik**. 54 punya gapura ≤ 40 m, **90 tanpa gapura**.
- Keadaan garis ring (m): bebas 43.208 (66%) · ≤ 2 m dari aspal 6.805 · di atas aspal 3.881 · di batas kawasan 8.359 · di danau 1.986 · menembus gedung 1.047.
- 10 cluster berpenghuni tanpa gapura sama sekali (1.251 rumah): Tiara, Gardenia, Aurora, Griya Sutera, Alba, Aruna, Intan, Cemara, Victoria, Narada.
- 1.041 rumah (di luar enclave) tidak berada di ring mana pun. 837 di antaranya menyatu dengan Griya Sutera/Onyx.
- 7 gapura berdiri di ring tanpa satu gedung pun: De Mansion, Winona, Gramercy ×2, Leora, Flamboyan, Danau Biru.
- 3 gapura melintang jalan umum: "Sutera Sitara" (−443, 423) di secondary; "Sutera Asri" (−525, −581) di tertiary; "The Gramercy" (244, 25) di tertiary. Gapura Asri salah tempat: simpul barrier OSM ada di jalan tertiary, sedangkan jalan masuk Asri yang sebenarnya ±20 m di selatannya.

Kolom "bertembok" = panjang ring yang punya tembok sayap ≤ 2 m. "Aspal/gedung/danau/batas" = persen garis ring yang jatuh di sana.

| Cluster | Rumah | Keliling m | Bertembok m | Jalan memotong (gapura/tanpa) | Masalah ring |
|---|---|---|---|---|---|
| Yukata Suites | 1 | 287 | 9 | 1 (1/0) | apartemen |
| Paddington Heights | 3 | 402 | 0 | 2 (1/1) | apartemen |
| Brooklyn Alam Sutera | 1 | 404 | 21 | 2 (2/0) | apartemen |
| Silkwood Residences | 4 | 447 | 0 | 2 (2/0) | apartemen |
| Pacific Garden | 4 | 522 | 0 | 3 (2/1) | apartemen |
| De Mansion | 0 | 814 | 4 | 4 (2/2) | kosong; aspal 14%; batas 16% |
| Sky House | 3 | 650 | 0 | 3 (0/3) | apartemen; aspal 11%; batas 11% |
| Griya Hijau | 223 | 746 | 0 | 4 (3/1) | batas 13% |
| Sutera Amaryllis | 46 | 1.013 | 4 | 2 (2/0) | aspal 16% |
| Feronia Park | 0 | 926 | 0 | 4 (0/4) | kosong; batas 36% |
| Sutera Elok | 0 | 959 | 0 | 6 (0/6) | kosong; aspal 12%; batas 17% |
| Lloyd | 28 | 1.109 | 57 | 3 (3/0) | batas 22% |
| Sutera Riviera | 17 | 960 | 0 | 3 (2/1) | danau 37% |
| Sutera Winona | 0 | 977 | 0 | 1 (0/1) | kosong |
| Sutera Palmyra | 115 | 1.260 | 0 | 2 (1/1) | aspal 10%; gedung 7%; batas 13% |
| Sutera Tiara | 76 | 1.082 | 0 | 2 (0/2) | |
| Leora | 0 | 1.225 | 0 | 3 (2/1) | kosong; di dalam Sitara |
| Sutera Gardenia | 196 | 1.199 | 0 | 2 (0/2) | batas 20% |
| Aurora | 82 | 1.199 | 0 | 7 (0/7) | di dalam Renata; batas 11% |
| Sutera Flamboyan | 0 | 1.272 | 0 | 2 (0/2) | kosong; batas 18% |
| Griya Sutera | 330 | 1.105 | 0 | 1 (0/1) | gedung 9%; batas 27% |
| The Gramercy | 0 | 1.435 | 4 | 2 (0/2) | kosong; batas 26% |
| Alba | 72 | 1.181 | 0 | 3 (0/3) | di dalam Renata |
| Sutera Delima | 184 | 1.436 | 0 | 3 (0/3) | batas 24% |
| Jingga | 102 | 1.174 | 0 | 2 (2/0) | di dalam Sitara |
| Mentari | 108 | 1.245 | 0 | 2 (2/0) | di dalam Sitara; gedung 13% |
| Orlanda | 171 | 1.181 | 4 | 2 (2/0) | di dalam Sitara |
| Pelangi | 115 | 1.211 | 0 | 4 (2/2) | di dalam Sitara; batas 11% |
| Sutera Telaga Biru | 13 | 1.508 | 0 | 2 (0/2) | danau 38% |
| Aruna | 81 | 1.637 | 0 | 2 (0/2) | di dalam Renata; batas 27% |
| Sutera Asri | 58 | 1.189 | 4 | 2 (2/0) | |
| Sutera Intan | 184 | 1.230 | 0 | 7 (0/7) | aspal 54% |
| Sutera Cemara | 164 | 1.315 | 0 | 3 (0/3) | batas 22% |
| Sutera Magnolia | 48 | 1.417 | 4 | 2 (2/0) | |
| Sutera Feronia | 0 | 1.441 | 0 | 3 (0/3) | kosong; batas 36% |
| Sutera Harmoni | 244 | 1.409 | 0 | 7 (2/5) | aspal 18%; batas 18% |
| Sutera Buana | 71 | 1.781 | 0 | 2 (2/0) | batas 14% |
| Sutera Jelita | 393 | 1.809 | 0 | 6 (2/4) | aspal 32%; batas 15% |
| Sutera Kirana | 379 | 1.691 | 0 | 5 (2/3) | aspal 10%; batas 14% |
| Sutera Victoria | 5 | 2.471 | 0 | 1 (0/1) | batas 29% |
| Sutera Palma | 136 | 1.618 | 0 | 3 (2/1) | |
| Sutera Narada | 61 | 2.034 | 0 | 1 (0/1) | |
| Sutera Olivia | 215 | 1.627 | 0 | 2 (1/1) | |
| Sutera Lavender | 45 | 2.519 | 0 | 6 (1/5) | batas 33% |
| Sutera Danau Biru | 0 | 2.877 | 0 | 3 (2/1) | kosong; danau 36% |
| Sutera Renata | 0 | 2.818 | 0 | 2 (0/2) | ring induk (Aurora, Alba, Aruna); batas 21% |
| Sutera Onyx | 267 | 2.258 | 0 | 1 (1/0) | gedung 6%; batas 12% |
| Sutera Sitara | 1 | 3.214 | 12 | 7 (4/3) | ring induk; gedung 5%; batas 12% |

**Kesimpulan audit ring:** garis ring OSM tidak bisa langsung dijadikan as tembok. Sebagian digambar di as jalan (Intan 54%, Jelita 32%), menembus rumah (Mentari 13%), atau membelah jalan yang dipakai dua cluster. Ada ring bersarang (Sitara, Renata), dan 1.041 rumah tanpa ring.

### 1c. Temuan lain

**Gedung menimpa jalan (5.802 gedung di peta):**

| Kelas jalan | Gedung menimpa aspal | As jalan menembus gedung | Kedalaman (<0,3 / 0,3–1 / 1–2 / 2–4 / >4 m) | Hanya menimpa trotoar |
|---|---|---|---|---|
| residential | 608 | 1 | 102 / 283 / 236 / 46 / 0 | 519 |
| living_street | 90 | 0 | 12 / 34 / 42 / 8 / 0 | 47 |
| service | 62 | 9 | 18 / 36 / 36 / 36 / 0 | 0 |
| tertiary | 10 | 0 | 0 / 5 / 5 / 0 / 0 | 2 |
| secondary | 1 | 0 | 0 / 1 / 0 / 0 / 0 | 0 |
| motorway_link | 1 | 1 | >4 | 0 |

- Unik: **763 gedung menimpa aspal**, 11 ditembus as jalan, **501 lagi hanya menimpa trotoar**.
- Jalan non-servis dengan tumpang > 0,3 m: **609 gedung**, semuanya jenis 0, 78 di enclave. Sebaran: 284 (0,3–1 m), 272 (1–2 m), 52 (2–4 m), 1 (> 4 m).
- Polanya sistematis: 591 dari 663 pasangan gedung-jalan ada di 55 jalan yang masing-masing menimpa ≥ 3 gedung. Contoh: jalan 518 menimpa 44 dari 65 rumah di sisinya, di area Griya Sutera/Griya Hijau x 600–1000, y 400–900.
- Penyebab: lebar bawaan residential 6 m + trotoar 2 × 1,4 m lebih lebar dari lorong antar-fasad di data.
- Contoh: #5299 (1080, 2385) ditembus motorway_link 3,9 m · #2601 (690, −354) ditembus jalan residential · #5711 (−284, −535) 3,0 m · #5061 (552, 601) 2,9 m · #4704 (904, 583) 2,7 m · #1589 (−533, −510) 2,7 m.
- Di jalan raya: 10 rumah berderet #3023–#3029, #3162, #3163 di y ≈ −1098, x 509–612, masuk 0,8–1,3 m ke tertiary; #3239 (182, −1117); #902 (−1001, 450) di secondary.
- **Pintu depan rumah:** 663 berada di atas aspal, 372 lagi 0–1 m dari tepi aspal, 609 di 1–2,8 m (tanpa ruang teras).

**Gedung dengan gedung:** hanya 5 pasang, semuanya menara di atas podium (disengaja). Tidak ada tumpang sebagian antar-rumah.

**Gedung dengan air:**
- Peta utama: 0 tumpang. Yang terdekat #3691, 1,84 m dari tepi kanal.
- Rumah di kanal yang dilaporkan ternyata **gedung lapisan context** (`alsut-context.json`): #7988 (1204, 1568) masuk 0,94 m ke pita kanal, #7941 (1190, 1547) masuk 0,45 m. 14 lainnya ≤ 2 m dari tepi; lisplang 0,38 m membuatnya tampak menaungi air.
- #12266 (517, −1405) berdiri di danau context.
- Kanal `D.waterways` hanya 1 garis: 741 m, lebar 4 m, hampir seluruhnya di luar batas kawasan.

**Lapisan context (12.324 gedung, hanya tampilan):** 2.636 gedung menimpa aspal > 0,3 m (living_street 1.667, residential 824, secondary 116, tertiary 26, primary 2, motorway_link 1), ditambah 110 di jalan servis. Kedalaman: 846 / 1.269 / 516 / 5.

**Lain-lain:**
- Pagar proyek: 193 m di 4 dari 7 lokasi jatuh di jalan. Panelnya dilewati saat runtime, jadi berlubang.
- Pagar kawat: bersih.
- Menara SUTET (−526, 1685) berdiri di tengah danau (data OSM; kubiarkan).
- 2 pohon data berada di kanal (sudah dibuang `cleanTrees`).
- 176 pintu terhalang gedung tetangga karena `placeDoor` hanya menguji satu titik 1 m di luar pintu. Ini temuan untuk agen bangunan, bukan cakupanku.

## 2. Prinsip rancangan

1. **Urutan prioritas:** jalan jaringan (as tetap, lebar boleh menyempit) > air > gedung > jalan servis dan gang > tembok > benda > pohon dan semak. Yang lebih rendah selalu mengalah.
2. **Boleh menyimpang dari OSM, tetapi indeks stabil.** Entri `D.buildings` dan `D.roads` tidak pernah dihapus atau diurutkan ulang. Potongan jalan baru ditambahkan di belakang.
3. **Aturan pembangkit tidak bergantung letak pintu.** Aturan memakai sisi gedung, bukan pintu, jadi tetap benar walau `interiors.js` memindah pintu. Pintu asli (`planHomes`) hanya dipakai di uji.
4. **Tembok menutup kompleks, bukan garis ring.** Kompleks = rumah + jalan lingkungannya + isi ring. Jalan umum tidak pernah ditembok melintang; tiap jalan lain yang menembus tembok mendapat bukaan.
5. **Satu sumber per jenis data:** tata letak di `alsut-map.json`, benda dan salinan tembok siap-gambar di `alsut-props.json`.

## 3. Perapi tata letak

**Berkas baru:** `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/tools/tidy_layout.mjs` (node ≥ 18, tanpa dependensi).

**Kenapa node:** raster 13,7 juta sel dengan transformasi jarak selesai ±4 detik; Python murni butuh menit. Tool yang sama bisa mengimpor `planHomes`/`createCollider` untuk mode `--check`. `build_map.py` tidak diubah.

**Alur bangun ulang (urutan wajib):**
```
python3 -I tools/build_map.py data/osm/alsut.geojsonseq data/build/alsut-map.raw.json
node tools/tidy_layout.mjs data/build/alsut-map.raw.json web/data/alsut-map.json [--stages roads,buildings,walls,trees]
python3 -I tools/build_props.py   data/osm/alsut.geojsonseq web/data/alsut-map.json web/data/alsut-props.json
python3 -I tools/build_grass.py   data/osm/alsut.geojsonseq web/data/alsut-map.json web/data/alsut-grass.json
python3 -I tools/build_context.py data/osm/alsut.geojsonseq web/data/alsut-map.json web/data/alsut-context.json
node .wt/_tools/audit-tataletak.mjs web ; node .wt/_tools/audit-lantai.mjs web   # lalu perbarui NO_UP
```
- Sarankan `data/build/alsut-map.raw.json` di-commit, karena ekstrak OSM diabaikan git.
- Langkah pertama: pastikan `build_map.py` menghasilkan ulang `alsut-map.json` sekarang (selain `meta.generated`). Kalau tidak sama, pakai berkas sekarang sebagai raw.
- Tool menolak masukan yang sudah punya `meta.layout`.

**Kelas jalan:**
- UMUM: motorway, motorway_link, trunk, primary, secondary, tertiary.
- LOKAL: unclassified, residential, living_street.
- SERVIS: service, pedestrian.

### T1. Jalan
- **Paskan lebar** per jalan LOKAL dan SERVIS:
  - `tight` = gedung dengan jarak ke as < `w0/2 + 0,6`.
  - Bila `tight` ≥ 3 (LOKAL) atau ≥ 1 (SERVIS): `w = clamp(bulat-bawah-0,5(2·(q20(tight) − 0,6)), wmin, w0)`.
  - `wmin`: residential/unclassified 4,0; living_street 3,5; service 3,0. Kendaraan terlebar yang lewat jalan kecil 1,93 m.
- Larik baru `roads.s` (dm) = lebar trotoar per jalan: 0 untuk jalan yang disempitkan ≤ 4,5 m, selain itu bawaan kelas.
- **Hasil prototipe:** 238 jalan menyempit (58 residential menjadi 4,0 m; 6 menjadi 4,5–5,5 m; 15 living_street menjadi 3,5 m; 159 service menjadi 3,0–3,5 m). Penyempitan saja menurunkan gedung di aspal non-servis 609 → 319 (4,5/4,0 m) → 217 (4,0/3,5 m).
- **Jalan servis yang as-nya di dalam gedung ≥ 400 m² atau gedung bukan rumah:** jalan yang dipotong (bagian dalam gedung + 1 m dibuang; potongan kedua ditambahkan di belakang larik).

### T2. Gedung
**Jarak wajib tapak dari as jalan:**

| Terhadap | Rumah (jenis 0) | Bukan rumah |
|---|---|---|
| Jalan UMUM | `w/2 + trotoar + 3,0 m` (ruang tembok + halaman) | `w/2 + trotoar + 0,3 m` |
| Jalan LOKAL | `w/2 + 1,2 m` (0,8 m bila jalan disempitkan) | sama |
| Jalan SERVIS | `w/2 + 0,3 m` | sama |
| Air (poligon danau, pita kanal) | tepi + 1,5 m | sama |

**Penyelesaian, berurutan:**
1. **Geser** mundur sepanjang normal jalan, ≤ 4 m. Syarat: gedung tidak gandeng (tak ada tetangga ≤ 0,6 m) dan tempat barunya ≥ 1,0 m dari gedung lain serta memenuhi semua jarak wajib. Flag 32.
2. **Pangkas.** Gedung persegi (flag 2): sisi yang menghadap jalan digeser ke dalam sejajar dirinya sejauh penetrasi terdalam + 0,05 m, supaya tetap persegi. Gedung lain: potong dengan garis sejajar jalan. Syarat: sisa ≥ max(24 m², 55% luas asal) dan sisi terpendek ≥ 3,5 m. Flag 16; flag 2 dihitung ulang.
3. **Sisa terbesar:** bila syarat 55% gagal tetapi ada sisa ≥ 24 m² dengan sisi ≥ 3,5 m, pakai sisa itu. Flag 16.
4. **Buang:** `f |= 8`, `r = []`. Entri tetap ada.

**Hasil prototipe (pangkas saja, tanpa geser):**
- ±770 gedung terpangkas (738 rumah, 31 bukan rumah).
- Kedalaman: 236 (< 0,5 m), 229 (0,5–1), 240 (1–2), 49 (2–3), 15 (> 3).
- Luas hilang: 345 (< 5%), 294 (5–15%), 106 (15–30%), 24 (30–45%).
- ±20 gedung tidak layak (≤ 0,4%).
- Hanya 16 rumah terkena sempadan 3 m jalan umum.
- Menurut aturan, pintu depan di aspal 663 → 0 dan garis fasad deret rumah menjadi lurus sejajar jalan (belum diverifikasi dengan pintu asli).

### T3. Kompleks, tembok, gerbang
Lihat bagian 5.

### T4. Pohon
Lihat bagian 4.

### T5. Tulis hasil
- `meta.layout = { v, params, counts, warnings }`.
- Keluar dengan kode ≠ 0 bila masih ada pelanggaran jarak yang tak terselesaikan, kecuali `--allow-warn`.

### Lapisan context (`tools/build_context.py`, tanpa syarat indeks)
- Paskan lebar jalan context dengan rumus T1 (`wmin` living_street 2,5 m).
- Buang gedung yang tapaknya ≤ 1,0 m dari pita kanal atau poligon air (peta + context). Ini menghapus #7988, #7941, #12266.
- Tumpang aspal > 0,5 m yang tersisa: pangkas, atau buang bila < 60 m².

### Dampak ke data turunan

| Turunan | Dampak | Tindakan |
|---|---|---|
| `alsut-props.json` | benda menjauhi pohon/gedung/tembok lama; 175 sambungan rumah menempel dinding yang bisa bergeser | bangun ulang sesudah tidy |
| `alsut-grass.json` | topeng gedung/jalan berubah | bangun ulang |
| `alsut-context.json` | saringan baru | bangun ulang |
| `NO_UP` di `interiors.js` (12 indeks) | denah rumah terpangkas berubah | jalankan `audit-lantai.mjs`, perbarui daftar (koordinasi agen bangunan) |
| Graf jalan (`buildGraph`, runtime) | simpul sama karena as tetap; lebar berubah; potongan servis baru di belakang | tidak perlu tindakan; uji E di bagian 8 |
| Interior, loot, perabot | dihitung ulang saat muat dari tapak baru | uji muat |
| Peta digital twin (`alsut3d.js`) | membaca berkas yang sama, ikut rapi | lihat default di bagian 10 |
| `royale.html` | versi modul | naikkan `?v=` modul yang berubah |

**Gedung ber-flag 8 (cincin kosong), dari pembacaan kode:**
- Aman: `collide.js` (`addPoly` n < 3), `interiors.js`, `loot.js`, `vehicles.js`, `trees.js`.
- Perlu penjaga: `build_props.py` (`bm.bbox` gagal pada cincin kosong).
- Wajib dicek dengan uji muat: `world.js` (`addBuilding`), `mapview.js`, `alsut3d.js`.
- Cadangan tanpa perubahan kode: ganti cincin dengan gardu 3 × 3 m di titik bebas terdekat.

## 4. Rancangan pohon

### Zona bebas
Berlaku untuk semua pohon; angka dalam kurung untuk semak.

| Kode | Aturan |
|---|---|
| Z1 fasad | Di depan tiap sisi gedung (jenis ≠ 5, panjang ≥ 1,25 m), dalam rentang sisi ± 0,5 m. Sisi depan (sinar normal dari tengah sisi mengenai aspal jalan non-servis ≤ 12 m): bebas sampai tepi aspal, maks 8 m. Sisi lain: 4,0 m. Mencakup pintu, teras, carport, jendela. |
| Z2 dinding | Batang ≥ 2,2 m dari dinding mana pun (semak 0,8 m); pohon tajuk lebar ≥ 3,0 m. Kelas ukuran `k = 0` bila ruang < 5 m, `k ≤ 1` bila < 7 m. |
| Z3 jalan | Batang ≥ tepi luar trotoar + 0,6 m. Di jalan umum, lubang tanam di 0,8 m terluar trotoar hanya bila trotoar ≥ 2,4 m. |
| Z4 simpang | Tidak ada pohon ≤ 10 m (jalan umum) / 6 m (lokal) dari simpul berderajat ≥ 3. |
| Z5 gerbang | Tidak ada pohon ≤ 5 m dari pilar/jamb gerbang dan di corong masuk. |
| Z6 tembok | Batang ≥ 1,2 m dari as tembok (semak 0,6 m). |
| Z7 air, gedung | ≥ 0,8 m dari tepi air; tidak di gedung. |
| Z8 antar pohon | ≥ 5 m di deret; mutlak ≥ 1,6 m. |

**Uji prototipe Z1+Z2 pada data sekarang, tanpa tahu letak pintu:**
- 1.103 pohon melanggar (1.072 di halaman depan).
- Sesudah disaring, terhadap pintu asli `planHomes`: **0 pohon di koridor 4 m, 0 di teras**. Satu pohon tersisa di rentang 4–6 m sebuah pintu non-depan.
- 116 semak melanggar.

### Penanaman (tahap `trees` di `tidy_layout.mjs`, menggantikan hasil `plant_trees`)
- **P1 jalan umum:** deret dua sisi, jarak tetap 12 m, fase deterministik per jalan. Posisi `w/2 + trotoar + 1,3 m`, di jalur hijau 2,6 m antara trotoar dan tembok kompleks. Satu jenis per jalan (secondary palem, tertiary rindang) supaya berbaris.
- **P2 jalan lokal:** hanya di celah antar-fasad ≥ 1,0 m (batas kavling), ujung deret, dan sisi tanpa fasad. Jarak antar pohon ≥ 10 m. Tidak ada pohon di jalan yang disempitkan atau di depan deret rumah gandeng.
- **P3 taman/hijau:** kisi ber-jitter seperti sekarang, tunduk Z1–Z8.
- **P4 ruang sisa di dalam kompleks (opsional):** ≥ 4 m dari gedung, ≥ 1,5 m dari tembok, 1 per 350 m², jenis kecil.
- **Target jumlah:** 8.000–9.000, supaya biaya render setara.

### Tempat penerapan dan konsistensi
- **`/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/trees.js` `cleanTrees`** menjadi penjaga runtime:
  - Indeks sisi gedung per sel 12 m.
  - Fungsi `viol(x, y)` = Z1 + Z2, plus Z6 bila `D.walls` ada.
  - `addShrub` menolak bila `viol`.
  - Pada data ber-`meta.layout`, logika pindah-ke-trotoar dilewati.
- **Jawaban cepat untuk keluhan 1:** penjaga ini bekerja pada data lama juga. Pelanggar digeser sepanjang arah jalan terdekat ±1…8 m ke titik yang lolos Z1/Z2, ≥ 1,9 m dari aspal, ≥ 4 m dari pohon lain. Kalau gagal, dibuang. Prototipe: 556 digeser (median 4 m), 547 dibuang, 7.898 pohon tersisa.
- **Catatan geser:** pohon hasil geser bisa menimpa benda, lalu `envprops` membuang benda itu. Cek `envProps.stats.dropped` (baseline 7). Bila naik > 12, matikan geser (buang saja: 7.342 pohon).
- **Collider dan render** tetap memakai satu daftar `D.trees`. `D.treeRoom` dihitung seperti sekarang.
- **Ilalang** (raster terpisah) tidak terpengaruh; cukup dibangun ulang.
- **Benda** dibangun sesudah pohon.

## 5. Rancangan tembok keliling

### 5.1 Tiga pendekatan yang diukur

| Pendekatan | Keliling | Gerbang jalan | Catatan |
|---|---|---|---|
| A. Tembok di garis ring | 65,3 km | 144 | Gugur: ring di aspal, membelah jalan bersama, 1.041 rumah tanpa ring |
| B. Hanya membungkus rumah (fabrik) | 46–49 km | 432–441 lokal | Gugur: tepi bergerigi, tiap jalan lewat kavling kosong keluar-masuk tembok |
| **C. Fabrik ∪ isi ring (dipilih)** | **36,2 km** | **140** | 20 kompleks, 5.229 dari 5.270 rumah fabrik di dalam |

Rincian keliling C: 21,6 km menghadap lahan bebas · 2,1 km muka jalan umum · 1,0 km di samping gedung non-perumahan · 1,1 km tepi air · 10,3 km batas kawasan. **Tembok fisik ± 24,8 km.**

Peta ASCII area Intan–Jelita–Kirana sudah kuperiksa: tembok menyusuri sisi timur jalan tertiary, gerbang jatuh di mulut jalan lingkungan.

### 5.2 Algoritme (raster 1 m; EDT = transformasi jarak Euclid)
```
rumah fabrik = jenis 0, f&1, bukan enclave (f&4), luas < 1500 m², tinggi < 11 m, tidak di ring non-residential
F  = rumah fabrik ∪ {koridor jalan LOKAL (aspal+trotoar) berjarak ≤ 16 m dari rumah} ∪ {aspal SERVIS ≤ 8 m dari rumah}
A  = {EDT(F) ≤ RC}                       RC = 12 m
R  = {x ∈ A : EDT(¬A)(x) > RC − APRON}   APRON = 3,5 m (tepi kompleks ≥ 3,5 m dari rumah)
R ∪= isi ring residential berisi ≥ 8 rumah fabrik (ring induk Sitara/Renata tidak dipakai)
R −= koridor jalan UMUM ∪ air (+0,5 m) ∪ luar kawasan ∪ (gedung non-fabrik + 1,5 m)
R ∪= lubang(R)                           danau, taman, klub di dalam ikut ke dalam
buang komponen berisi < 8 rumah
```
- **Koridor jalan umum:** `w/2 + trotoar + 2,6 m` (jalur hijau untuk deret pohon). Menyempit sampai `+ 1,0 m` hanya di sel yang ≤ 4,5 m dari rumah.
- **Vektorisasi:**
  1. Telusuri tepi R menjadi lingkar.
  2. Pecah per jenis sisi luar: bebas, jalan umum, gedung, air, batas.
  3. Sederhanakan dengan Douglas–Peucker 0,6 m.
  4. Titik ≤ 1,0 m dari garis ring diproyeksikan ke garis ring, supaya lurus mengikuti batas cluster.
  5. Ruas < 1,5 m digabung.
- **Validasi tiap 0,5 m:** ≥ 2,0 m dari sisi rumah fabrik, ≥ 0,6 m dari gedung lain, tidak di aspal kecuali di gerbang, di dalam kawasan. Pelanggar digeser ≤ 1,5 m sepanjang normal. Yang gagal masuk `warnings`.
- **Catatan prototipe** (APRON 3 m, sebelum T2): 32 rumah terpotong tepi dan 50 dari 8.711 pintu < 1,9 m dari tepi. Penyebabnya rumah di koridor jalan umum atau di batas kawasan; T2 menyelesaikan yang pertama.
- **Kompleks kampung enclave** tidak ditembok.
- **Kompleks tanpa ring** (misal 80 rumah di 1,1 ha) ditembok dengan gerbang tanpa nama.

### 5.3 Perlakuan tiap jalan yang memotong batas

| Jalan | Perlakuan | Jumlah (prototipe) |
|---|---|---|
| UMUM | Tidak pernah dipotong. Tembok mundur ke belakang trotoar; ring yang ditembus jalan umum menjadi dua kompleks. | 0 |
| LOKAL | Selalu gerbang kendaraan. `k=0` gapura utama: satu per nama cluster per kompleks. Urutan pilih: ada simpul barrier OSM ≤ 40 m, lalu terdekat ke jalan umum, lalu jalan terlebar. Sisanya `k=1` gerbang samping. | 97 |
| SERVIS | `k=2` gerbang servis, tetap bisa dilalui kendaraan. | 43 |
| Tanpa jalan | `k=3` pintu pejalan kaki, ditambahkan menurut aturan 5.6. | taksiran 60–90 |

- Tidak ada jalan yang ditutup di versi pertama. Syarat nav no. 4 terpenuhi tanpa mengubah graf jalan.
- **Letak gerbang:**
  - Di titik potong as jalan dengan tembok, tegak lurus jalan.
  - Digeser ke dalam sampai ≥ 6 m dari tepi aspal jalan umum (ruang belok).
  - Kotak pilar ≥ 2,0 m dari sisi rumah dan ≥ 8 m dari simpang lain; cari sampai 20 m.
  - Tembok membentuk corong: dari garis tembok masuk sejajar jalan di ± (`half` + 0,6 m) sampai pilar.
  - Tanpa ruang untuk pilar: bukaan polos dengan pilaster + palang.
- 3 gapura di jalan umum dan 7 gapura di ring kosong dihapus (default; lihat bagian 10).

### 5.4 Perlakuan batas

| Bertemu | Perlakuan |
|---|---|
| Cluster tetangga (garis ring bersama di dalam kompleks) | Satu tembok di garis ring bila garisnya bebas (≥ 4 m dari tepi kompleks, tidak di jalan, ≥ 1,2 m dari rumah). Terukur 5,5 km. Tanpa tembok bila garis menyusuri jalan (1,6 km) atau menembus rumah (0,8 km). Gerbang di tiap jalan yang memotong. Tahap ini tidak dibutuhkan untuk menutup kompleks dari luar. |
| Danau | Tembok berhenti di tepi air, ujungnya masuk 0,6 m ke poligon air + pilaster. Sisi danau terbuka untuk perenang (2,2–3,1 m/dtk, tanpa perlindungan); bagi bot dan kendaraan air padat. |
| Kanal | Bila garis tembok menyeberangi kanal: terali besi setinggi 2,4 m dengan collider penuh. |
| Taman | Taman di dalam kompleks ikut ke dalam. Taman di luar: tembok biasa; lokasi pilihan untuk pintu pejalan kaki. |
| Gedung non-perumahan | Tembok berdiri sendiri ≥ 1,5 m dari gedung itu. Kalau celah < 3,4 m: tembok menempel gedung, masuk 0,25 m ke tapak, dan uji memastikan tidak ada pintu gedung itu di sisi dalam. |
| Batas kawasan | Tanpa tembok fisik (tirai emas sudah menahan). Tembok berhenti di garis batas. |
| Jalan umum | Tembok di belakang trotoar + jalur hijau. |

### 5.5 Bentuk dan collision
- **Bentuk** memakai `wallSeg()`/`pilaster()` yang ada di `envprops.js`: kaki batu 0–0,5 m, badan plester sampai 2,2 m, tutup 2,32 m, pilaster 2,56 m. Tebal collider 0,34 m (≥ 0,2 m).
- **Gapura `k=0`** = gapura sekarang (pilar 6,8 m, balok nama, pos satpam, palang).
- **`k=1`** = dua pilar 3,2 m tanpa balok + palang.
- **`k=2`** = dua pilaster + daun pintu geser digambar terbuka; bukaan = lebar jalan + 1,2 m.
- **`k=3`** = bukaan bebas 2,0 m di antara dua pilaster + ambang atas (`z0` 2,3 m, hanya menahan peluru). Lebar ini ≥ 1,6 m, jadi `nav.addGap` tidak diperlukan.
- **Collider:**
  - Satu kotak per ruas, dipecah ≤ 24 m, diperpanjang 0,17 m di kedua ujung.
  - Lingkaran pilaster r 0,3 hanya di tiap belokan, ujung, dan sambungan T.
  - Ujung di pilar gerbang masuk 0,3 m ke kotak pilar.
  - Hanya properti `pts/x/y/r/h/z0`; tidak memakai `door` atau `stair`.
  - Semua masuk `envProps.obstacles` dan didaftarkan lewat satu panggilan `col.addObstacles` yang sudah ada di `main.js`.

### 5.6 Gameplay

**Pintu keluar per kompleks (prototipe, sebelum pintu pejalan kaki):**

| Kompleks | Rumah | Luas ha | Tembok fisik m | Gerbang jalan (lokal + servis) |
|---|---|---|---|---|
| Griya Sutera + Onyx + Griya Hijau + Palmyra + 837 rumah tanpa ring | 1.772 | 51,3 | 2.485 | 20 + 3 |
| Jelita + Kirana + Intan + Lavender | 1.000 | 50,7 | 1.562 | 11 + 0 |
| Delima + Cemara + Buana + lainnya | 498 | 38,1 | 2.629 | 12 + 11 |
| Olivia + Palma + Mentari | 460 | 39,3 | 2.560 | 5 + 0 |
| Harmoni + Gardenia | 440 | 16,8 | 1.153 | 3 + 2 |
| Orlanda + Pelangi + Jingga + lainnya | 421 | 31,7 | 2.851 | 9 + 6 |
| Aurora + Aruna + Alba | 235 | 23,0 | 1.532 | 3 + 0 |
| Narada + Magnolia | 109 | 25,7 | 2.499 | 6 + 0 |
| Tiara | 77 | 6,3 | 1.139 | 3 + 1 |
| Amaryllis + Riviera + Telaga Biru | 76 | 17,9 | 2.141 (+ 931 tepi danau) | 15 + 0 |

**Aturan pintu pejalan kaki (parameter `GATE_SPACING`, default 160 m):**
- Jarak sepanjang tembok antara dua bukaan ≤ 160 m, jadi ≤ 80 m ke bukaan terdekat.
- Tiap kompleks ≥ 2 bukaan; ≥ 3 bila > 3 ha.
- Tiap sektor 90° dari pusat kompleks yang punya tembok ≥ 60 m mendapat ≥ 1 bukaan.
- Letak: ruas lurus ≥ 6 m, sisi luar bisa dilalui (bukan air/batas), ≥ 12 m dari gerbang jalan. Diutamakan dekat halte atau taman.
- Tool melaporkan jumlah pastinya.

**Hitungan zona** (dinding sisi jauh ≤ 4,6 m/dtk, lari 6,6 m/dtk). Memutar sejauh d ke bukaan memakan d/6,6 dtk, dan selama itu dinding mendekat 0,70·d.

| Jarak ke bukaan terdekat | Jeda aman yang dibutuhkan di depan dinding | Lama di zona bila sudah tepat di tepi |
|---|---|---|
| 60 m (jarak bukaan 120 m) | 42 m | ±30 dtk |
| 80 m (160 m, default) | 56 m | ±40 dtk |
| 100 m (200 m) | 70 m | ±50 dtk |

Jeda 56 m ≈ 8,5 dtk lari. Lama di zona berlaku sampai pemain kembali unggul. Kalau terasa menjebak saat uji, turunkan ke 120 m.

**Memanjat:**
- Tidak bisa dari tanah. `vaultSpot` butuh sinar setinggi dada (1,55 m) tembus, sedangkan tembok 2,32 m.
- Lompat tidak menolong: tinggi kaki untuk tabrakan dibekukan di `st.floorY` selama di udara.
- Atap kendaraan tidak bisa dipijak (`vehicles.pushOut`).
- **Jalur keluar yang disengaja:** dari jendela lantai 2 ke atap teras (2,82 m), lalu lari melewati tembok. Selama jatuh, tinggi kaki masih dianggap 2,82 m; jatuh 0,56 dtk ≈ 3,7 m mendatar.
- Arah masuk tidak ada pijakan ≥ 2 m yang terjangkau dari tanah. Atap halte 2,76 m dan pos satpam 2,95 m tidak bisa dipanjat.
- Parasut tetap bisa mendarat di dalam.

**Bot dan kendaraan:**
- Graf jalan tidak berubah karena semua jalan tetap terbuka. Rute jauh (`G.route`) dan sopir bot (`G.astar`) otomatis lewat gerbang.
- Lebar bebas gerbang = lebar jalan + 0,98 m (≥ 3,98 m).
- Risiko: tujuan dekat di balik tembok. Lihat K1–K3 di bagian 6.
- Tembok otomatis menjadi perlindungan bot (benda `b = −3`, tinggi ≥ 1,2 m).

**Jarahan dan pendaratan:**
- Barang luar-rumah ditaruh 1,3 m dari sisi gedung; tembok ≥ 2 m dari rumah, jadi barang tetap di dalam kompleks.
- Tembok tanpa `floor`, jadi tidak bisa dipijak. Penerjun yang jatuh di atasnya didorong ke samping.
- Kendaraan parkir sudah menguji `col.blocked`.

### 5.7 Format data

`alsut-map.json` (sumber kebenaran, dari tidy):
```
"walls": {
  "lines": [ { "p": [x0,y0,x1,y1,…] (dm), "c": idKompleks, "t": 0 keliling | 1 dalam,
               "e": [ujungAwal, ujungAkhir] } ],   // 0 bebas+pilaster, 1 pilar gerbang, 2 air, 3 batas kawasan, 4 gedung, 5 sambungan T
  "gates": [ { "x","y" (dm, di as jalan), "a" (0,1°, arah masuk), "w" (dm), "h" (dm, jarak pilar dari as),
               "k": 0|1|2|3, "c": idKompleks, "ci": indeks cluster untuk nama (−1), "road": indeks jalan (−1) } ],
  "compounds": [ { "id","houses","ha","clusters":[…],"wall": m,"gates": n,"maxGap": m } ]
}
"roads.s": [dm]     "buildings.f": bit 8 dibuang, 16 dipangkas, 32 digeser
```

`alsut-props.json` (dari `build_props.py`):
- `walls: [{p, t, e}]` = salinan `lines`.
- `gates` format lama + `k`, `c`; `wl`/`wr` kosong.
- Pos satpam dan palang ditaruh per gerbang `k=0/1`.

**Perubahan `build_props.py`:**
- `gates()` membaca `D['walls']['gates']`; simpul barrier OSM hanya memilih gapura utama.
- `wing()` dihapus.
- Titik tembok tiap 1 m masuk `self.props`, supaya benda tidak menimpa tembok.
- Lewati gedung bercincin kosong.

**Mesh** (`/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/envprops.js`):
- Tembok masuk penampung petak 320 m yang ada (`use(mx, my)` per potongan ≤ 24 m), disembunyikan > 450 m.
- Logika murni (potongan, pilaster, daftar rintangan) ditaruh di modul baru tanpa impor, `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/walls.js`. Dengan begitu uji node memakai kode yang sama dengan game.

## 6. Kebutuhan ke modul lain

| Kode | Modul | Kebutuhan | Sifat |
|---|---|---|---|
| K1 | `bots.js` `buildGraph` | Sambungan "ujung buntu ke ruas terdekat ≤ 9 m" harus lolos `clearPath` (sekarang tanpa uji, bisa menyambung menembus tembok). | Wajib untuk syarat nav no. 4 |
| K2 | `bots.js` `route` | Simpul tujuan dipilih dari ≤ 5 simpul terdekat yang `nav.walkable` ke tujuan, cermin simpul masuk. | Disarankan |
| K3 | `bots.js` `goLevel` | Rute jalan juga dicoba untuk jarak 15–40 m bila jalur lokal gagal (sekarang jatuh ke `direct` dan mendorong tembok sampai watchdog). | Disarankan |
| K4a | `world.js` | Lewati gedung dengan `B.r[i].length < 6`. | Wajib bila ada gedung ber-flag 8 |
| K4b | `world.js` | Trotoar dan kerb memakai `D.roads.s[i]` bila ada. | Disarankan (tanpa ini trotoar jalan sempit menempel fasad) |
| K4c | `world.js` `upgradeTrees` | Batas tajuk `rm + 1,2` diganti `rm − 0,3`. | Disarankan (menghapus 468 tajuk tembus) |
| K5 | `interiors.js` | Tidak ada perubahan; `NO_UP` diaudit ulang. | — |
| K6 | `mapview.js` | Gambar tembok dan ikon gerbang di peta supaya pemain melihat pintu keluar. | Disarankan |
| K7 | `royale.html` | Naikkan `?v=` modul yang berubah. | Integrator |

`main.js` dan `nav.js` tidak perlu diubah.

## 7. Anggaran kinerja

| Hal | Sekarang | Anggaran | Cara menjaganya |
|---|---|---|---|
| Segitiga tembok se-peta | ±16 ribu (1,17 km) | ≤ 300 ribu untuk 24,8 km | Gaya ramping di bawah |
| Segitiga tembok per frame di titik terpadat | — | ≤ +60 ribu (umumnya ±30 ribu) | LOD jauh per petak |
| Draw call | +10…+22 (envprops) | ≤ +12 | Petak 320 m yang sama; mesh jauh menggantikan mesh dekat |
| Poligon collider | 4.286 rintangan env | ≤ +9.000 | Satu kotak per ruas; pilaster hanya di belokan, ujung, sambungan T |
| Waktu muat `createEnvProps` | ±100 ms | ≤ +120 ms | Penulis typed-array, atau mesh petak dibangun malas |
| CPU per frame | +0,10…+0,18 ms | ≤ +0,05 ms | Pemilahan petak statis sudah ada |
| Ukuran `alsut-props.json` | 65 KB | ≤ 140 KB | Polyline dm sesudah Douglas–Peucker |

- **Gaya sekarang:** 13,3 segitiga/m + 30 per ruas. Untuk 24,8 km ≈ 435 ribu, terlalu berat.
- **Gaya ramping:**
  - Kaki batu hanya dua muka samping per 1,5 m (2,7 segitiga/m).
  - Pilaster tiap 4,5 m (4,4 segitiga/m).
  - Muka ujung hanya di ujung tembok.
  - Total ≈ 7,1 segitiga/m + 32 per ruas ≈ 300 ribu se-peta.
- **LOD jauh (> 200 m):** badan + tutup saja, 20 segitiga per ruas, tanpa bayangan.
- Collider selalu dibuat penuh saat muat, walau mesh dibangun malas, supaya cache nav tidak dikosongkan.
- Tembok dalam antar-cluster (+5,5 km) dan kompleks apartemen (+2,7 km) hanya ditambahkan bila anggaran di atas masih longgar.

## 8. Rencana uji dan kriteria lulus

### A. Node, tanpa browser
Skrip `.wt/_tools/audit-tataletak.mjs <web>`: `planHomes` + `createCollider` + `walls.js`.

| # | Ukuran | Lulus | Baseline |
|---|---|---|---|
| A1 | Pohon di koridor pintu asli (lebar pintu + 0,65 m, 4 m) / di teras / semak di koridor | 0 / 0 / 0 | 287 unik pohon; 8 semak |
| A2 | Batang < 2,2 m dari dinding; pohon di aspal atau trotoar; pohon ≤ 6 m dari simpang lokal | 0 | 138 (< 1,5 m); 492; 149 |
| A3 | Pintu tertutup ≤ 1,5 m oleh pohon, benda, pagar, tembok | 0 | 19 |
| A4 | Pintu tertutup gedung tetangga | tidak naik | 176 |
| A5 | Gedung menimpa aspal > 0,05 m (non-servis); pintu depan di aspal | 0; 0 | 609 (> 0,3 m); 663 |
| A6 | Gedung < 1,5 m dari air (peta); gedung context di air | 0; 0 | 0; 3 |
| A7 | Jumlah entri `buildings` = 5.802; gedung tanpa flag 8/16/32 identik dengan raw; yang berflag bergeser ≤ 4 m | ya | — |
| A8 | Uji lintas tembok: tiap 2 m sepanjang tembok + tiap belokan, ujung, sambungan T; `col.step` r 0,35 dari 1,5 m di satu sisi ke 1,5 m di sisi lain, dengan percobaan meluncur ± 60° | 0 bocor dari N (N ≈ 12–15 ribu) | — |
| A9 | Banjir raster 0,25 m di pita ± 6 m tembok, gerbang disumbat, air padat: titik pintu rumah kompleks yang terjangkau dari jalan umum | 0 | — |
| A10 | Tanpa sumbat: pintu rumah terjangkau (`nav.path` atau banjir) dari tiap gerbang kompleksnya | 100% dari pintu yang tidak tertutup di baseline | — |
| A11 | Ruas graf jalan (tiruan `buildGraph` termasuk sambungan ≤ 9 m) yang terhalang tembok | 0 | — |
| A12 | Tembok < 1,5 m dari titik pintu | 0 | — |
| A13 | Tiap kompleks ≥ 2 bukaan (≥ 3 bila > 3 ha); jarak terjauh sepanjang tembok ke bukaan | ≤ 80 m | — |
| A14 | Lebar bebas gerbang: kendaraan ≥ lebar jalan + 0,9 m; pejalan ≥ 1,6 m | ya | — |

### B. Browser (singkat; port 8825/9325/9425; `cdp park` setelahnya)
- Muat tanpa error konsol; `envProps.stats.dropped` ≤ 12.
- A/B kinerja di 3 titik: dalam kompleks padat (760, 690), gerbang Onyx (343, 846), boulevard Sitara (−443, 423). Lulus bila sesuai anggaran bagian 7.
- Bot 5 menit × 2: bot diam < 2 m per 10 dtk ≤ baseline (0,05–0,4%) + 0,2 poin; pemicu watchdog per menit ≤ +20%; biaya `bots.update` ≤ +0,1 ms.
- Kendaraan: 10 gerbang (campuran `k=0/1/2`) × 3 jenis pada 30 km/jam tanpa tersangkut; kejadian "sopir turun karena macet" tidak naik.
- Zona: 20 pertandingan bot saja; kematian karena zona di dalam kompleks tidak naik > 10% relatif.
- Lembar kontak sebelum/sesudah di koordinat contoh bagian 1.

## 9. Milestone

Tiap milestone bisa dikirim sendiri.

| # | Isi | Berkas | Bergantung |
|---|---|---|---|
| M0 | Baseline: skrip audit di `.wt/_tools`, snapshot raw, angka bagian 1 direproduksi | `.wt/_tools` saja | — |
| M1 | Penjaga zona bebas fasad di `cleanTrees` (pohon + semak). Menjawab keluhan pohon tanpa data baru. Lulus A1, A3. | `trees.js` | — |
| M2 | `tidy_layout.mjs` tahap `roads` + `buildings`; saringan context; bangun ulang props/grass/context; audit `NO_UP`. Lulus A5–A7. | tool baru, `build_context.py`, data | K4a bila ada flag 8 |
| M3 | Kompleks, tembok keliling, gerbang, pintu pejalan kaki. Lulus A8–A14 + uji B. | tool (tahap `walls`), `walls.js`, `envprops.js`, `build_props.py`, data | M2, K1 |
| M4 | Penanaman pohon baru P1–P3 + semak. Lulus A1–A2 pada data baru. | tool (tahap `trees`), `trees.js`, data | M3 |
| M5 | Tembok dalam antar-cluster, kompleks apartemen (ring 6 apartemen, +2,7 km), LOD jauh, tembok tampilan di sisi batas kawasan, gerbang di peta (K6) | `envprops.js`, tool | M3 |

HANDOFF ditulis per milestone dalam bahasa Indonesian.

**Risiko dan cadangan:**

| Risiko | Cadangan |
|---|---|
| Tapak terpangkas mengubah denah/pintu dan bentrok dengan pekerjaan agen bangunan | Indeks stabil; M2 digabung sesudah agen bangunan; kalau perlu jalankan `--stages roads` saja (609 → 319 gedung di aspal tanpa menyentuh gedung) |
| Garis tembok hasil raster tampak patah-patah | Naikkan toleransi dan proyeksi ke garis ring; cadangan: tembok di garis ring untuk ring yang ≥ 70% bebas, kontur fabrik hanya di tempat lain |
| Bot lebih sering macet di tembok | K2, K3; `GATE_SPACING` 120 m; `markBad` sudah ada |
| Pemain merasa terjebak zona | Parameter `GATE_SPACING`; gerbang digambar di peta (K6) |
| Kinerja | Tunda M5; LOD jauh; pilaster tiap 6 m |
| Gedung ber-flag 8 membuat `world.js` gagal muat | Gardu 3 × 3 m sebagai pengganti cincin kosong |
| Geser pohon di M1 menimpa benda | Matikan geser (buang saja) |

## 10. Default yang kupilih

Tidak ada yang memblokir; koreksi bila Steven mau lain.

1. Ring tanpa gedung (9 cluster) tidak ditembok; 7 gapuranya dihapus.
2. 3 gapura di jalan umum dihapus; gapura utama Asri pindah ke jalan masuk Asri. Opsi: pertahankan gapura "Sutera Sitara" sebagai gapura boulevard hias tanpa tembok.
3. Kampung enclave tetap terbuka.
4. Tepi danau terbuka untuk perenang.
5. Sisi batas kawasan tanpa tembok fisik sampai M5.
6. Jarak bukaan 160 m.
7. Semua jalan lokal dan servis tetap terbuka sebagai gerbang (tidak ada yang ditutup).
8. Peta digital twin (`index.html`) ikut memakai `alsut-map.json` yang sudah dirapikan. Selisihnya ≤ 4 m dan ±20 gedung hilang. Kalau digital twin harus setia OSM, `alsut3d.js` cukup diarahkan ke berkas raw.
9. Perapi tata letak ditulis di node, bukan Python.

### Critical Files for Implementation
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/trees.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/envprops.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/tools/build_props.py
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/tools/build_map.py
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/bots.js