# Sutera Royale: audit + rancangan BANGUNAN & TABRAKAN (main @ 4edfede)

## 0. Batasan audit ini (baca dulu)

- **Yang dijalankan:** audit node tanpa browser atas 5.802 gedung, memuat `web/map/interiors.js`, `collide.js`, dan data peta asli. Semua skrip dijalankan inline (`node -e`), pola pemuatnya sama dengan `.wt/_tools/audit-lantai.mjs`.
- **Yang TIDAK dijalankan:** screenshot headless dan uji bot di browser. Mode kerja saya read-only total (tidak boleh membuat file, termasuk di scratch), jadi `serve.mjs`/`cdpd.mjs` tidak pernah dinyalakan. Tidak ada proses yang perlu di-park atau dimatikan.
- **Akibatnya:**
  - Kategori (a), (d), (e) dan bagian fisika (b) terukur dari kode + simulasi.
  - Kategori (c) "tanpa atap" dan bagian visual (b) adalah kesimpulan dari kode, belum dikonfirmasi gambar. M0 di bawah mewajibkan konfirmasi itu.
  - Simulasi bot memakai kernel gerak yang sama (`col.step` r 0,35 + `floorAt`), bukan AI bot utuh, karena `bots.js` butuh three.js dari CDN.
- Repo tidak diubah. File untracked `web/game/a_*.jpg` bukan dari saya.
- **Pesan koordinator (tapak gedung akan dirapikan) sudah diakomodasi:** tidak ada daftar indeks keras di rancangan. Semua keputusan dihitung dari geometri saat perencanaan, dan audit bisa dijalankan ulang (§4). Daftar indeks di bawah hanya untuk Steven mencocokkan pada peta sekarang.

---

## 1. Audit

Inventaris: 5.802 gedung, 5.799 bisa dimasuki (3 kanopi).

| Jenis | Jumlah | Dengan lantai atas |
|---|---|---|
| Rumah | 5.591 | 1.344 |
| Ruko | 84 | 80 |
| Aula/mal | 92 | 25 |
| Menara/gedung publik | 32 | lift |

Bukaan: 9.384 pintu rumah (3.793 rumah berpintu dua; 9.383 selebar 1,7 m, 1 selebar 1,0 m), 13.420 ambang sekat, 3.247 pintu kamar mandi, 1.129 etalase ruko, 1.219 bukaan aula, 44 pintu lobi.

### (a) Pintu tampak tertutup tapi bisa ditembus: 9.384 dari 9.384 pintu rumah

Akar penyebab: tiga lapisan tidak pernah sepakat.

- **Collider** (`collide.js` `addHome`, ±baris 113–121): celah pintu SELALU terbuka. Hanya ada ambang di atas 2,2 m.
- **Shader fasad** (`world.js` ±998–1018 dan 1156–1168): menggambar dua daun pintu kayu tertutup (`doorK`) selama rumah belum "terbuka". Rumah "terbuka" hanya ≤ 85 m dari kamera dan setelah antrean bangun 1,5 ms/frame sampai ke rumah itu.
- **Interior** (`interiors.js` 1348–1352): saat rumah terbuka, lubang pintu di-discard dan digambar satu daun statis menempel dinding. Tidak ada pintu sama sekali.

Akibat yang dilihat Steven:
- Bot dan peluru menembus pintu yang tergambar tertutup di semua rumah > 85–110 m (lewat scope sangat jelas).
- Hal yang sama terjadi di rumah dekat yang interiornya belum selesai dicicil (berkendara, ganti kamera menonton).
- Dari dekat pintu tidak pernah bisa ditutup.

Contoh (semua rumah sama): #19 (−446,−1029), #22 (−547,−1106), #74 (70,618), #2064 (602,−583), #4238 (69,1034).

Sejenis:
- Etalase ruko (1.129) dan bukaan aula/lobi (1.263) digambar kaca etalase saat jauh, padahal collider-nya berlubang.
- 295 pintu rumah punya benda (sekat/tangga/perabot) di busur ayun ke dalam, mis. #19 (−446,−1029), #20 (−463,−1049), #30 (−519,−1047), #71 (77,644), #76 (46,618). Arah ayun harus dipilih per pintu.

### (b) Bot menembus tembok

Yang sudah dipastikan BUKAN penyebab:
- Collider interior tidak malas. `createCollider` memanggil `addHome` untuk semua rumah (270.464 poligon). Yang malas hanya mesh.
- Bot memakai `col.step` yang sama dengan pemain (`bots.js` 1665).
- Watchdog `unstick` tidak teleport. Ia berjalan ke titik yang lolos `nav.segFree`.

Hasil simulasi (dorong acak ke dinding, tinggi kaki mengikuti `floorAt`, 12 ribu percobaan × 3 dtk per sel):

| Jenis | 60 fps, 5,4 m/dtk | dt 0,05, 6,9 m/dtk |
|---|---|---|
| Rumah | 0 | 18 tembus dinding luar, 23 tembus sekat |
| Rumah 2 lantai | 0 | 18 dinding luar, 25 sekat |
| Ruko / aula / menara | 0 | 0 |

Sebab-sebab, urut dugaan dampak:

1. **Efek dari (a).** Bot melewati pintu yang tergambar tertutup, atau berada di rumah yang interiornya belum terbangun sehingga jendela dan pintunya tampak padat. Ini yang paling sering terlihat dan hilang dengan pintu sungguhan.
2. **Tunneling saat frame tersendat (terbukti).**
   - `col.step` (`collide.js` 334) hanya me-`resolve` posisi akhir, tanpa sapuan.
   - `resolve` mendorong pusat yang sudah di dalam poligon tipis ke tepi TERDEKAT, yang bisa berarti sisi seberang.
   - `main.js` 879 membatasi dt ke 0,05. Sprint 6,4 + menghindar 0,5 = 6,9 m/dtk × 0,05 = 0,345 m per langkah, dibanding tebal dinding 0,2 m dan sekat 0,12 m.
   - Frame ≥ 50 ms memang terjadi (cicilan interior, GC, kompilasi shader).
   - Contoh: #3034 (666,8,−1085,9), #1345 (−362,3,−1654,3), #2803 (628,5,−786,6), #5354 (−521,9,372,1), #2557 lantai 2 (257,2,−510,8).
3. **Terlempar dari poligon tangga.** Potongan tangga (`G.stair`) hanya padat bila `ay < rampH − 0,45`. Agen yang pusatnya masuk tapak tangga dari ketinggian salah (jatuh lewat lubang tangga, lompat, vault) dilempar ±1 m ke tepi terdekat. Tangga menempel dinding luar, jadi sering keluar rumah. Dengan tinggi kaki dipaksa 0, 89 dari 95 kejadian tembus ada di tangga, mis. #4238 (69,1,1034,0)→(69,7,1033,1), #3649 (934,9,866,1), #2793 (683,2,−798,2), #896 (−861,6,368,4).
4. **Dorongan kendaraan.** `vehicles.pushOut` (`vehicles.js` 1269) menggeser agen sampai ±1,2 m, lalu `col.resolve` tanpa cek lintasan (`bots.js` 1666, `player.js` 940). Bot di antara mobil dan dinding bisa terdorong tembus.
5. **`fitProne`** (`collide.js` 373) menerima geseran sampai 1,2 m asal titik akhir kosong, jadi bisa menyeberang dinding. Ini kena bot tiarap dan tumbang.
6. **Visual, belum dikonfirmasi gambar.**
   - Fasad adalah kulit tanpa tebal dan dinding collider hanya 0,2 m. Bot yang menempel dinding dari dalam berpusat 0,55 m dari fasad, sementara laras dan lengan menjulur ±0,6–0,9 m, jadi tampak menembus.
   - Mayat (panjang ±1,8 m) tidak pernah di-`fitProne`.
7. **Nav memotong sudut:** tidak ditemukan. Langkah nav sudah disapu persis (§33).

### (c) Rumah "tanpa atap"

Geometri atap utuh: 5.170 perisai, 2 limas, 627 datar berparapet. Triangulasi plafon dan lantai 0 gagal dari 5.799. Tidak ada plafon di atas atap.

Kandidat, belum dikonfirmasi gambar:

- **c1 (utama): 419 rumah beratap datar berparapet di antara rumah bergenteng.**
  - Aturan `pitched` di `world.js` 1465 hanya berlaku untuk flag 2 (persegi < 650 m²) atau denah cembung ≤ 8 titik < 450 m². Rumah L/U/poligon jatuh ke kotak berbibir 0,9 m dengan dak di h − 0,9, yang tidak terlihat dari tanah.
  - Sebaran: 55 rumah < 150 m², 272 rumah 150–450 m², 92 lebih besar; 159 punya lantai atas.
  - Contoh: #11 (−415,118), #17 (−414,−1036), #393 (−549,957), #406 (−531,1013), #424 (−782,925), #434 (−685,942).
- **c2:** #3987 (502,942): inset parapet memotong dirinya sendiri (luas tutup 606 m² vs 502 m²).
- **c3:** atap perisai untuk segi empat miring: #1655 (−1066,142), #5539 (435,780).
- **c4:** semua permukaan atap satu sisi (`emitTri` selalu menghadap atas). Dari bawah emper 0,38 m dan dari balik parapet, langit tembus.

### (d) Tampak ≥ 2 lantai tanpa lantai atas/tangga: 4.247 dari 5.591 rumah (76 %)

Akar penyebab:
- Tinggi rumah sintetis: `tools/build_map.py` memberi 6 m × (0,85–1,15), jadi SEMUA rumah 5,1–6,9 m.
- Shader menggambar baris jendela kedua di 4,49–5,87 m untuk semua rumah, tanpa peduli ada lantai atas atau tidak. Pada rumah h < 5,87 jendelanya terpotong garis atap.

| Sebab | Jumlah | Contoh |
|---|---|---|
| h < 6,2 (`planUpper` tidak dipanggil) | 3.115 | #18 (−433,−1039), #19 (−447,−1038), #20 (−462,−1040), #23 (−555,−1112) |
| h ≥ 6,2, persegi, `planUpper` gagal diam-diam | 1.080 | #22 (−546,−1103), #25 (−518,−1055), #40 (−384,−923), #43 (−395,−939), #50 (−576,−884) |
| h ≥ 6,2, non-persegi, gagal | 40 | #398 (−537,955), #434 (−685,942), #1006 (−294,1052) |
| `NO_UP` | 12 | #2464 (237,−741), #5295 (333,274), #5447 (−597,1223) |

Rincian:
- Dari 1.080 persegi yang gagal, 722 berluas < 80 m². Sisi harus ≥ 7,4 m untuk tangga 4,4 m.
- Dari 12 `NO_UP`, 7 adalah blok 21 m bertingkat 6 yang hanya punya 1 lantai di dalam.
- 26 gedung jenis 0 setinggi ≥ 11 m (24 di antaranya 21 m, mis. #5439–#5468) diperlakukan sebagai rumah: 6 baris jendela, paling banyak 2 lantai.
- 45 rumah 2 lantai setinggi ≥ 8,2 m menampilkan baris jendela ke-3, mis. #729 (−955,1482), #838 (313,1633).
- Ruko tanpa lantai atas: #850, #5524 (h ≥ 10), #5477, #5479 (h 4,5).
- 67 aula tanpa lantai 2, 45 di antaranya deret h 11,1 (#5302–#5346).

Percobaan panjang tangga pada 2.476 rumah h ≥ 6,2:

| Panjang tangga | Rumah berlantai atas |
|---|---|
| 4,4 m (sekarang) | 1.344 |
| 3,6 m | 1.632 |
| 3,0 m | 2.182 |

Tanpa `NO_UP`, 14 rumah < 85 % terjangkau (#449 11 %, #2464 1 %, #2488 23 %, #4049 16 %, #5454 16 %, …). Jadi cek keterjangkauan saat perencanaan memang wajib.

### (e) Temuan lain

- 117 bukaan aula/ruko selebar < 1,2 m, sampai 0,03 m. Ini sisa rentang di ujung sisi: tampak celah tapi tidak bisa dilewati. Contoh: #0 (−255,−232) 0,08 m, #3 (−440,−116) 0,09 m, #6 (−548,2059) 0,03 m.
- Kandidat pintu rumah terhalang (uji kasar tanpa envprops): 61 di luar, mis. #74 (70,618), #1553 (−446,−1583), #2064 (602,−583); 49 di dalam, mis. #30 (−519,−1047), #89 (−35,688), #129 (−234,617).
- Resepsionis lobi tidak pernah ditempatkan (§34.4, sudah diketahui).

---

## 2. Rancangan

Prinsip: satu sumber kebenaran per hal.
- Keadaan pintu ada di collider.
- Jumlah lantai ditentukan oleh rencana (`H.up`).
- Shader dan mesh hanya membaca keduanya.

### 2.1 Pintu buka-tutup

**Data** (`interiors.js` `planHouse`): tiap pintu `d` mendapat
- `d.k`: 0 depan, 1 belakang;
- `d.leaves`: 2 bila lebar ≥ 1,3 m, selain itu 1;
- `d.hgt = 2.2`;
- `d.swing`: +1 ke dalam, −1 ke luar, dihitung saat rencana. Busur 90° tiap daun diuji terhadap `H.parts`, tapak tangga, `H.bath.big`, tiang teras, dan `occupied()`. Pilih ke dalam bila bebas, lalu ke luar. Bila keduanya terhalang, tetap ke dalam dengan sudut maksimum 55°.

`furnish()` sudah menghindari area pintu. Tambahkan lingkaran `avoid` r 0,95 di tiap engsel sisi ayun.

**Collider + keadaan** (`collide.js`):
- Di `addHome`, untuk tiap pintu rumah (`!H.kind`): tambah poligon `strip(s0, s1, 0, T)` setinggi 2,2 dengan `extra { door: D }`. `D` didaftarkan ke `doors[]` dan ke sel grid (`c.d`).
- Bentuk `D`: `{ id, b, k, x, y, ux, uy, nx, ny, w, z: 0, pi, open: 0, t: 0, dir, swing, leaves, at }`.
- Jumlah poligon tetap seumur dunia, jadi cache `nav.js` tidak pernah terbuang.
- Terbuka = `polys[pi].h = -Infinity`. Semua loop yang ada (`blocksAgent`, `ray`, `blocked`, `solidAt`) otomatis mengabaikannya tanpa cabang baru. Tertutup = `h = 2.2`.
- API baru di objek `col`:
  - `doors`
  - `doorNear(x, y, z, r = 1.9)`: pintu terdekat dengan |z| cocok.
  - `doorAhead(x, y, z, dx, dy, reach = 1.3)`: pintu TERTUTUP yang dipotong ruas gerak.
  - `setDoor(D, open, agents, now)`: mengembalikan `false` bila terhalang.
  - `resetDoors()`
  - `doorStamp`: naik tiap ada perubahan.
- Anti-jepit di `setDoor(…, false)`: tolak bila ada agen hidup dengan |z − D.z| < 1,5 yang lingkarannya (r 0,45) memotong persegi pintu atau cakram ayun (jari-jari lebar daun + 0,15 di tiap engsel sisi terbuka).
- Saat membuka, `dir` menjauhi pembuka kalau `swing` mengizinkan. Daun tidak punya collider saat terbuka (disengaja: tidak mengganggu nav).

**Peluru, pandangan, kamera, granat, kendaraan:** semuanya lewat `col.ray`/`los`/`blocked`, jadi mengikuti keadaan pintu tanpa mengubah `main.js`. Daun kayu menahan peluru. Pintu terbuka bisa ditembus tembakan.

**Nav** (`nav.js` `fineHit`): `if (P.door) continue;`. Pintu selalu dianggap bisa dilalui. Titik celah pintu sudah ada (`addGap`).

**Bot** (`bots.js` `steer`):
- Sebelum `col.step`, bila |kecepatan| > 0,5: `const D = col.doorAhead(...)`. Bila ada, panggil `col.setDoor(D, true, ctx.agents, now)` dan `a.doorAt = now`. Bunyi lewat jalur `stepSound` (≤ 30 m dari kamera). Berlaku juga untuk gerak non-nav (bertarung, menghindar), sehingga bot tidak pernah mendorong pintu.
- Menutup di `think()`:
  - mode `hold` dan saat mulai memulihkan diri di dalam rumah: tutup pintu rumah itu yang ≤ 6 m;
  - setelah lewat ≥ 1,6 m: peluang `SKILL.wary × 0,4`.
  Semua lewat `setDoor`, sehingga aman dari jepit.
- Tambahkan `a.doorAt` ke alasan sah di pengukur "bot diam".
- Biaya: ≤ 40 pintu per sel × 100 bot = uji jarak kecil, < 0,02 ms per frame.

**Pemain** (`player.js`):
- Di `interact()`, setelah cabang lift dan sebelum `startVault()`: `const D = col.doorNear(...)`. Syarat: pemain menghadap pintu (dot ≥ 0,3) dan tidak ada barang ≤ 1,3 m. Lalu `setDoor(D, !D.open, ctx.agents, now)`. Bila gagal: `hud.toast('Pintu terhalang')`.
- Rantai `st.prompt` (baris 999), sebelum `vaultSpot()`: `'Buka pintu'` / `'Tutup pintu'`.
- `hud.js`: tambah ikon pintu di `promptIcon`.

**Suara** (`audio.js`): `export function houseDoor(open, vol = 1, p = 0, muffled = false)`.
- Buka: derit (tone 420→260 Hz, 0,18 dtk) + klik gerendel.
- Tutup: dentum (tone 140→70) + burst lowpass.
- Pemanggil menghitung volume dari jarak (0 di atas 35 m). `muffled` memakai aturan `inBuilding` seperti tembakan.

**Tampilan dekat** (`interiors.js`, bagian "pintu" baru di `createInteriors`):
- Model prosedural, tanpa aset dan tanpa jalur gagal muat: satu `BufferGeometry` daun 0,85 × 2,15 × 0,045 berengsel di x = 0, dua panel timbul tiap sisi, gagang, ±90 segitiga, warna verteks.
- Satu `InstancedMesh` (kapasitas 512, membesar ×2), material Lambert/Standard mengikuti `W.real`. `instanceColor` = warna kayu per rumah, rumus sama dengan shader (`wood × (0,85 + 0,3·hash)`). Daun tunggal diskala di x.
- Hapus daun statis di baris 1348–1352. Kusen tetap dari geometri `xp`.
- Slot dialokasikan saat rumah masuk `open` dan dilepas saat ditutup (daftar bebas, pola `furniture.js`).
- Matriks ditulis saat alokasi dan hanya untuk pintu yang sedang beranimasi.
- Di `interiors.update`: `D.t` mendekati `D.open` dengan laju 1/0,3 dtk (ease-out), sudut = `dir × t × maksimum`.
- Bayangan: `castShadow` hanya saat `W.real`.

**Tampilan jauh** (`world.js`):
- Pakai texel ke-4 tabel `uOpen` (sekarang kosong): `(tA, tB)`.
- Tambah `W.setDoorState(i, k, open)`. `interiors.update` menyalin pintu yang berubah dengan membandingkan `col.doorStamp`.
- Shader: piksel pintu pada rumah belum terbuka dengan t > 0,5 → warna gelap (0,06) + kusen, bukan daun.
- Shader kedalaman tidak berubah.

**Persistensi:** keadaan hidup di `col.doors`, bukan di mesh. Interior dibuang lalu dibangun ulang membaca keadaan yang sama. `col.resetDoors()` dipanggil di `startMatch` (satu baris di `main.js`). Default awal: semua tertutup.

**Jenis pintu lain (default yang dipilih):**
- Pintu belakang: sama dengan pintu depan.
- Pintu 1 m: satu daun.
- Pintu kamar mandi (3.247): daun tunggal dengan mekanisme sama, awal TERBUKA. Dikerjakan di M5, opsional.
- Ambang sekat: tetap tanpa pintu.
- Ruko: etalase tetap terbuka (rolling door tergulung).
- Aula/mal/lobi: portal terbuka. Kaca geser otomatis tidak dibuat, karena kaca yang hanya menahan peluru dan pandangan bot membingungkan.
- Untuk ruko, aula, dan lobi: shader menggambar bukaan sebagai rongga gelap saat interior belum dibangun. Rentang bukaan memakai tes yang sama dengan `discard` (`winMask = 0`, tanpa pantulan). Dengan begitu tampilan cocok dengan collider.
- Bukaan < 1,2 m dibuang di `planShop` (`opsIn` dan sisa rentang), di rencana maupun `H.open`.
- Lift: tidak berubah. Baja padat dan F membuka panel. Urutan prompt: lift lebih dulu dari pintu.

### 2.2 Bot (dan pemain) tidak menembus tembok

Semua di `collide.js`, tanpa mengubah AI, sehingga risiko "bot diam" kecil.

1. **`step` bersub-langkah.** Bila panjang langkah > 0,15 m, bagi menjadi `ceil(L / 0,15)` potong (maksimum 4), masing-masing di-`resolve`. Pada 60 fps dan ≤ 9 m/dtk tetap satu `resolve`.
2. **Penjaga lintasan `crossed(x0, y0, x1, y1, ay)`.** Ruas pusat lama → pusat baru diuji terhadap sisi poligon yang `blocksAgent` (kecuali air). Pola loop sama dengan `ray`, tanpa alokasi. Bila memotong, coba geser per sumbu `(x1, y0)` / `(x0, y1)` yang tidak memotong, kalau tidak ada pakai `(x0, y0)`. Dipanggil di akhir `step`. Diekspor sebagai `col.guard(x0, y0, p, ay)` untuk:
   - hasil `pushOut` + `resolve` (`bots.js` 1666, `player.js` 940). Bila memotong, pakai posisi sebelum dorongan;
   - `fitProne`: tolak hasil yang `crossed`;
   - `fitBody` di `bots.js`.
3. **Tangga.** Di `resolve`, untuk `G.stair` dengan pusat di DALAM poligon: jangan dorong ke tepi terdekat. Bila `ay < rampH − 0,45`, kembalikan ke posisi awal langkah (ditangani penjaga), dan `floorAt` menaikkan agen ke anak tangga bila selisih ≤ 0,6. Penjaga memperlakukan sisi tangga sebagai padat hanya bila `blocksAgent`.
4. **Mayat.** Saat bot atau pemain mati, satu kali `col.fitProne` searah rebah, lalu `guard`. Letaknya di `bots.js`, tempat `p.dead` disetel.
5. **Laras menembus dinding (lintas agen).** `bots.js` `draw()`, hanya pada frame yang dipose dan d < 60 m: `p.tuck = col.ray(dada, arah hadap, 0,95) < 0,9 ? 1 : 0`. `rig.js` (wilayah agen animasi) mengangkat senjata ke posisi siap-tinggi bila `p.tuck`. Kalau `rig.js` belum mendukung, field diabaikan dan tidak ada regresi.
6. **Pengukur lintasan untuk uji** ada di `.wt/_tools` saja (lihat §4).

**Yang dibutuhkan dari pekerjaan tata letak (tembok cluster + gerbang):**
- `col.addObstacles` dipanggil sebelum bot pertama bernavigasi, sekali, bukan per frame. Tiap perubahan `polys.length` mengosongkan seluruh cache nav.
- Tebal tembok ≥ 0,2 m.
- Lebar bebas gerbang pejalan ≥ 1,6 m (grid nav 1 m), atau panggil kait `nav.addGap` untuk celah lebih sempit. `addGap` perlu diekspor.
- Tiap ruas graf jalan yang menembus tembok harus punya bukaan.
- Tembok ≥ 1,5 m dari pintu rumah. Kandidat "pintu terhalang" di (e) harus diaudit ulang setelah tembok ada.
- Jangan memakai properti `door` atau `stair` di poligon tambahan.

### 2.3 Atap

`world.js` `addBuilding`:

- **Rumah tapak selalu beratap miring.** Yang dimaksud rumah tapak: jenis 0 yang BUKAN aula. Pakai predikat yang sama dengan `planHomes` (`area ≤ 1500` atau `planShop(hallOnly)` gagal), dan ekspor `isHall` dari `interiors.js` supaya satu aturan.
  - Segi empat dengan selisih sisi berhadapan ≤ 1,5 m → `hipRoof`.
  - Cembung → `pyramidRoof`.
  - Selain itu → `mansardRoof(pts, h)` baru: emper `insetPoly(−0,38)`, cincin miring bergenteng ke `insetPoly(d)` di h + 0,55·d, lalu dak datar di puncak.
  - `d` mulai dari min(2,4, √luas × 0,18) dan dibagi dua sampai inset sah: jumlah titik sama, tidak memotong diri, luas > 0. Kalau gagal total: dak datar beremper 0,3 m di h, tanpa parapet.
- Segi empat miring (c3) dialihkan ke `pyramidRoof`.
- Parapet gedung non-rumah: bila inset memotong diri (uji `selfX`), pakai `cap(pts, h)`.
- Bawah emper: `capDown(eave, h − 0,28)`, karena tutup yang sekarang menghadap atas. Sisi dalam parapet sudah ada.

Tidak ada daftar indeks. Semuanya dari geometri.

### 2.4 Konsistensi lantai

Aturan tunggal: jumlah baris jendela dan tinggi fasad mengikuti rencana.

1. **`planUpper` (`interiors.js`):**
   - Hapus `NO_UP`.
   - Coba panjang tangga 4,4 → 3,6 → 3,0 m (`S.len` sudah per tangga; `rampH` dan nav sudah generik).
   - Tiap kandidat diuji `upperReach(H, cand)`: raster 0,3 m di denah lantai atas. Bebas = di dalam `H.pts` dan ≥ 0,5 m dari dinding, di luar lubang tangga dan pagar, ≥ 0,36 m dari bagian padat sekat (`H.parts` termasuk kamar mandi). Banjiri dari bordes. Lulus bila ≥ 90 % sel bebas terjangkau DAN tiap ruang punya sel terjangkau.
   - Gagal → kandidat berikutnya, bukan menyerah.
   - Setelah `furnish` lantai atas, uji ulang dengan persegi perabot (`furnitureRect`). Bila gagal, buang perabot yang menyentuh sel tak terjangkau.
   - `planBath` sekarang jalan setelah `planUpper`. Pindahkan cek keterjangkauan ke setelah `planBath`. Bila gagal karena kamar mandi, batalkan kamar mandi dulu, baru tangga.
   - Syarat tinggi tetap h ≥ 6,2.
2. **Tinggi rumah 1 lantai diturunkan.** Tinggi sintetis tidak punya kebenaran untuk dijaga. Ekspor `fitHouseHeights(D)` dari `interiors.js`:
   - Jalankan `planHouse` untuk jenis 0 non-aula (tidak butuh `D.blind`/`D.roofs`) dan simpan hasilnya di `WeakMap(D)` supaya `planHomes` memakai ulang, tanpa biaya ganda.
   - Rumah tanpa `H.up`: `h' = 3,6 + 0,7 × (h − 5,1) / 1,8` → 3,6–4,3 m. Tulis ke `D.buildings.h[i]` dan `H.h`. Plafon tetap 3,0.
   - Dipanggil di awal `buildWorld` hanya bila `opts.game`, di sebelah konversi jenis 5 → 2 (baris 352). Peta digital twin tidak berubah. `interiors.js` tidak mengimpor `world.js`, jadi tidak ada siklus.
   - `H.blind` disetel `planHomes` seperti sekarang.
3. **Jenis 0 setinggi ≥ 11 m menjadi jenis 3** (lobi + lift + atap) di tempat yang sama. Semua lantai terjangkau lift.
4. **Shader rumah** (`world.js` `house`): jendela baris k hanya bila `3,3k + 2,574 ≤ o0.a + 0,01` (`o0.a` = plafon teratas, sudah ada di tabel). Aturan yang sama di `winOk`/`houseWindow` (`collide.js`), `bandHoles` (`interiors.js`), dan shader kedalaman. Ini menghilangkan baris ke-3 pada 45 rumah tinggi dan jendela terpotong.
5. **Ruko/aula tanpa `H.up`:** teruskan top = `H.ceil` dan matikan jendela atas (st 1/4) di atas `o0.a` + papan nama. Sisa beralasan (4 ruko, 67 aula) dicatat di audit sebagai "fasad polos di atas lantai 1".

Default yang dipilih: turunkan tinggi (butir 2). Alternatif kalau Steven lebih suka semua rumah 2 lantai: naikkan semua ke ≥ 6,2. Itu menambah ±3.000 lantai atas, biaya interior ±2×, dan tidak disarankan.

---

## 3. Anggaran kinerja

- **Muat:**
  - `planHomes` sekarang ±650 ms di node.
  - `upperReach` ≤ 2.500 rumah × ±1.200 sel × ±12 ruas ≈ +60–120 ms.
  - Cek berbasis collider seperti di audit butuh 19–24 dtk, jadi jangan dipakai saat muat.
  - `fitHouseHeights` tanpa biaya tambahan karena memakai ulang rencana.
- **Tabrakan:**
  - `col.step` terukur 1,8 µs per panggilan (node, M1).
  - Sub-langkah hanya aktif saat langkah > 0,15 m. Penjaga ±1 µs.
  - 100 bot + pemain: +0,1–0,3 µs × 100 ≈ < 0,05 ms per frame. Kasus terburuk dt 0,05: 4× = 0,7 ms pada frame yang memang sudah 50 ms.
  - `doorAhead` < 0,02 ms per frame.
- **Poligon collider:** +9.384 (+3,5 % dari 270 ribu). Jumlahnya tetap, jadi cache nav aman.
- **Render:**
  - +1 draw call untuk daun pintu (+1 di peta bayangan mode realistis).
  - ≤ ±600 instans × 90 segitiga = ≤ 54 ribu segitiga, biasanya 15–25 ribu.
  - Atap mansard: +±14 segitiga × 419 rumah.
  - Rumah lebih rendah mengurangi sedikit luas fasad.
  - Shader: 1 `texelFetch` tambahan hanya di piksel pintu.
- **Cicilan interior (1,5 ms per frame tidak berubah):**
  - Alokasi slot pintu O(1–2 pintu per rumah).
  - Tangga 3,0 m menaikkan rumah 2 lantai dari 1.344 ke ±2.180. Rumah 2 lantai ±1,8× verteks rumah 1 lantai, jadi waktu antre rata-rata naik ±25 % di perumahan.
  - Target: frame > 4 ms karena interior tetap ≤ 22 per 3 rute (angka §30.3).
- **Animasi pintu:** hanya pintu dengan `t ≠ open`, biasanya 0–3.

---

## 4. Rencana uji + kriteria lulus

**A. `.wt/_tools/audit-bangunan.mjs <web>`** (node, baru, pola `audit-lantai.mjs`). Bisa dijalankan ulang setelah peta dibangun ulang. Keluaran JSON per kategori + daftar indeks dan koordinat.

| Kategori | Yang dihitung | Lulus |
|---|---|---|
| pintu | Pintu rumah tanpa poligon `door`; pintu tertutup yang masih lolos `col.ray` dan `col.blocked` di tengah celah; pintu terbuka yang menahan | 0 |
| tembus | Simulasi §1(b): 4 dt × 3 kecepatan × 5 jenis, 12 ribu per sel, termasuk lantai atas, + uji dorong samping 1,2 m dan `fitProne` | 0 lintas dinding/sekat/pintu tertutup (sekarang 18–25 per sel terburuk) |
| atap | Rumah tapak tanpa atap miring; inset memotong diri; luas tutup ≠ luas denah ±2 % | 0 |
| lantai | Rumah yang baris jendelanya lebih banyak dari lantainya (aturan shader dihitung di JS); lantai atas < 90 % terjangkau (cek collider) | 0 (sekarang 4.247) |
| lantai, sisa | Ruko/aula tanpa lantai atas | Dicatat sebagai sisa beralasan |
| bukaan | Bukaan < 1,2 m | 0 (sekarang 117) |
| pintu terhalang | Pintu dengan sisi luar/dalam tertutup | ≤ sekarang, lalu ditinjau |

**B. Browser (`serve.mjs` 8823 / API 9323 / Chrome 9423, tiap sesi singkat, `cdp park` sesudahnya).**
- **Pintu:**
  - `__T.door(i, k)` → F buka dan tutup; prompt benar.
  - Peluru tertahan saat tertutup dan lewat saat terbuka (`combat.probe`).
  - Tutup ditolak saat berdiri di ambang.
  - Keadaan bertahan setelah pergi > 110 m lalu kembali.
  - Tampilan jauh > 110 m cocok: tertutup = daun, terbuka = gelap.
  - Screenshot tiap M untuk Steven: depan, belakang, 1 m, kamar mandi.
- **Pengukur lintasan** (`.wt/_tools/lintas.js`): tiap frame, tiap bot `ground`, ruas posisi lama → baru diuji terhadap sisi dinding/sekat/pintu tertutup gedung di `col.inBuilding` ± tetangga. Jalankan 5 menit × 99 bot, normal, lalu dengan hambatan CPU 4× lewat CDP (`Emulation.setCPUThrottlingRate`) supaya dt 0,05 sering terjadi. Lulus: 0 lintasan. Ukur dulu di main sebagai pembanding.
- **Bot diam:** metrik §33 (bot hidup di darat < 2 m per 10 dtk tanpa alasan), sebelum vs sesudah. Lulus: ≤ 0,5 % (main 0,05–0,4 %). Tambahan: 0 bot dengan `stuckT` di depan pintu tertutup; uji bot 14 m di luar rumah mengambil barang di ruang belakang ≤ 9 dtk (§20: 7,6 dtk).
- **Atap/lantai:** kamera bebas di contoh §1(c)(d) sebelum dan sesudah. Naik tangga 3,0 m sebagai pemain dan bot.
- **Kinerja:** fps dan frame > 4 ms di 3 rute §30.3; draw call ≤ +2; `bots.update` ≤ 0,8 ms rata-rata.

**C. Wajib tiap milestone:** `audit-lantai.mjs` yang lama tetap lulus, dan game termuat tanpa error (`__LOGS` kosong).

---

## 5. Milestone (tiap butir bisa dikirim sendiri)

- **M0. Alat + konfirmasi (tanpa kode game).**
  Tulis `audit-bangunan.mjs` dan `lintas.js`. Rekam angka dasar main. Ambil screenshot contoh (c) dan (d) dan kirim ke Steven untuk memastikan "gada atep" = c1.
  Risiko: ternyata bukan c1. Cadangan: screenshot dari koordinat yang Steven tunjuk, perbaiki M3.

- **M1. Tabrakan (`collide.js` + 3 baris di `bots.js`/`player.js`).**
  Sub-langkah, penjaga, tangga, `fitProne`, `pushOut`, mayat.
  Risiko: penjaga membuat agen tersangkut di sudut. Cadangan: geser per sumbu sudah ada; bila metrik bot diam naik, penjaga hanya untuk poligon tipis (< 0,5 m).

- **M2. Pintu.**
  - M2a: collider + keadaan + nav + F/prompt + suara + bot membuka. Daun masih digambar sederhana.
  - M2b: instancing + animasi + shader jauh + rongga gelap ruko/aula + buang bukaan < 1,2 m.
  Risiko: bot macet di pintu. Cadangan: `doorAhead` jangkauan 2 m + buka paksa saat `stuckT > 0,4`.
  Risiko: versi modul. Naikkan `?v=` di `royale.html` untuk `bots`, `nav`, `player`, `hud`, `audio`.

- **M3. Atap (`world.js`).**
  Risiko: mansard jelek pada denah ekstrem. Cadangan: dak beremper.

- **M4. Lantai.**
  - Shader baris jendela + `fitHouseHeights` + jenis 0 ≥ 11 m → jenis 3.
  - Lalu `planUpper` multi-panjang + `upperReach`, hapus `NO_UP`.
  Risiko: tangga 3,0 m (47°) terasa curam atau bot gagal naik. Cadangan: batas 3,6 m → ±1.630 rumah 2 lantai, sisanya 1 lantai.
  Risiko: `D.roofs` belum ada untuk jenis 3 baru. `roofTop` sudah jalan untuk jenis 3, tinggal diuji.

- **M5. Opsional.**
  Pintu kamar mandi, `p.tuck` (dengan agen animasi), bot menutup pintu lebih cerdas.

Setelah tiap milestone, HANDOFF §35 ditulis dalam bahasa Indonesia.

**Pertanyaan untuk Steven:** tidak ada yang memblokir. Default yang perlu dia tahu:
- rumah 1 lantai jadi lebih rendah (3,6–4,3 m);
- ruko, mal, dan lobi tetap tanpa daun pintu;
- semua pintu rumah tertutup di awal pertandingan.

### Critical Files for Implementation
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/collide.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/interiors.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/world.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/bots.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/player.js

Pendukung: `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/nav.js`, `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/audio.js`, `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/hud.js`, `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/main.js` (1 baris `resetDoors`), `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/.wt/_tools/audit-lantai.mjs` (pola untuk audit baru).