# Rancangan: animasi perban orang pertama v3 + hapus spanduk kill

Desainer: Fable (sesi utama), 24 Nov 2026. Dieksekusi di worktree `.wt/perban` (branch `wip/perban`).

Keluhan Steven (verbatim): "cacad itu animasi pake bandage juga, terus kill banner kenapa masig ada dah".

## A. Hapus spanduk kill

**Yang dihapus:** spanduk kill di tengah layar (lambang, pip, label Kill/Ganda/Tripel/Beringas/Amuk, "Tumbang", sinar tepi layar, kejut).

**Yang TETAP:** kill feed (daftar kecil), penghitung kill di HUD, bunyi kill (`audio.killSting`), efek dan suara tembakan skin.

Titik kode (verifikasi sendiri, telusuri semua rujukan):
- `web/game/hud.js`: `createKillBanner` (±717 sampai akhir blok), `const kb = createKillBanner(root)` (±190), metode `killBanner(o)` (±450).
- `web/game/killfx.js`: pemanggilan `hud.killBanner` (±221, ±228). `killSting` tetap dipanggil.
- `web/game/killfx.css` + `<link>` di `web/royale.html:12`: hapus bila seluruh isinya milik spanduk. Kalau ada gaya lain yang masih dipakai, sisakan bagian itu saja.
- `web/game/lobby.js` (±17, ±182–183): tombol pratinjau "Efek kill" di toko memakai spanduk. Hapus tombol itu, atau jadikan "Dengar bunyi kill" (hanya bunyi) bila bunyinya memang beda per skin. Tidak boleh ada tombol mati.
- `web/game/skins.js` `skinFeatures(s)`: buang label keistimewaan yang menjanjikan spanduk. Data `th.emblem`, `color`, `color2` boleh tetap (dipakai warna toko). ID dan harga skin tidak berubah.

Kriteria lulus:
- Setelah kill, tumbang, dan kill beruntun 5×, tidak ada elemen spanduk di DOM dan tidak ada animasi tepi layar.
- Kill feed dan bunyi kill tetap jalan.
- Toko tanpa tombol mati atau label keliru.
- 0 error konsol.

## B. Animasi perban orang pertama v3

### Bukti kondisi sekarang
Filmstrip 16 frame (±6 fps, 0–2,65 dtk dari 3,5 dtk):
`/private/tmp/claude-642194880/-Users-2403077-Documents-web/37f5498a-9fbb-4448-a634-ad419f217d37/scratchpad/perban/sheet_fp.jpg` (frame tunggal `fp_01..16.jpg` di folder yang sama).

Cara merekam ulang (alat `.wt/_tools`):
1. `__T.drop(270.3, 1668.0, 0.6)`
2. `__T.god = false; __G.me.hp = 40; __G.me.heals.band = 5`
3. `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', bubbles: true }))`

### Cacat yang terlihat
1. **Perban = lempeng/tabung putih polos.** `wrap` adalah silinder terbuka tanpa tekstur dengan radius jauh di atas lengan; `tail` kotak putih pipih; `roll` tampak seperti kubus putih di kepalan.
2. **Tangan kanan berbalik-balik** antar kunci (punggung tangan → telapak → terbalik), membesar mendadak di pojok layar, dan lengannya tidak menyambung (pergelangan melayang).
3. **Tangan kiri = cakar terbuka kaku.** `fp_hand_l` dibuat untuk memegang pelindung tangan senjata.
4. **Layar kosong ±0,5 dtk di awal.** Balutan tumbuh sebagai satu pita besar, tidak terbaca sebagai lilitan.

### Sasaran
Sekilas terbaca "membalut lengan bawah dengan kasa". Gerak tenang dan menerus; tangan tidak pernah berbalik atau meloncat.

### Rancangan
Semua di `web/game/weapons.js`: rig obat ±784–830, `HEAL_K.band` dan `animHeal` ±1270–1400. Potongan tangan GLB yang ada tetap dipakai.

**1. Tangan kiri rileks**
- Lengan kiri yang dibalut memakai kepalan longgar, bukan cakar.
- Cara: geometri `fp_hand_r` dicerminkan (klon geometri, x dibalik, urutan indeks dibalik, normal dicerminkan), atau `fp_hand_nade` dicerminkan. Pilih yang paling wajar di filmstrip.
- Hanya untuk rig obat. Tangan kiri senjata tidak berubah.

**2. Komposisi**
- Lengan bawah kiri masuk dari kiri-bawah. Siku di luar layar, pergelangan di kiri-tengah bawah.
- Sumbu lengan naik ±25–30° ke kanan dan sedikit menjauhi kamera; sisi dalam lengan menghadap kamera.
- Lengan kanan selalu datang dari kanan-bawah (siku di luar layar).
- Kedua lengan sudah terlihat pada 0,25 dtk. Layar tidak boleh kosong > 0,3 dtk.

**3. Kasa = pita heliks, bukan silinder**
- Mesh pita dibuat sekali: 3 lilitan, lebar 4,4 cm, langkah 3,0 cm per lilitan (tumpang ±30 %), 28 segmen per lilitan.
- Radius mengikuti permukaan lengan + 1,2 mm, ditambah 0,25 mm per lilitan supaya tidak z-fight.
- Profil radius lengan diukur dari geometri potongan lengan saat dibangun: proyeksikan verteks ke sumbu `AX_L`, ambil radius per stasiun dan per sektor sudut, lalu haluskan. Cadangan: radius tetap.
- Pita ditempel ke potongan lengan kiri, jadi ikut bergerak.
- Tumbuhnya memakai `geometry.setDrawRange` mengikuti fase orbit tangan kanan (menerus, bukan per kunci).
- Bahan: `MeshStandardMaterial` dengan tekstur kanvas kecil (128², bisa diulang):
  - warna gading `#efe9da`;
  - garis anyaman kasa 6–8 % lebih gelap + serat halus;
  - kanvas yang sama sebagai `bumpMap`;
  - roughness 0,95; `DoubleSide`;
  - tepi pita sedikit berjumbai (alphaTest/alphaMap bernoise di tepi v).
- UV: u sepanjang pita (ulang tiap 3 cm), v melintang.

**4. Gulungan di tangan kanan**
- Silinder bertekstur kasa; tutup ujungnya bergambar cincin spiral.
- Sumbu sejajar sumbu lengan kiri.
- Berputar pada sumbunya sesuai panjang yang terulur.
- Radius menyusut 27 → 22 mm selama membalut.

**5. Pita bebas (`tail`)**
- Strip kasa tipis dari titik singgung gulungan ke kepala heliks di lengan.
- Lebar sama dengan pita, sedikit melendut.
- 4–6 verteks ditulis ulang per frame tanpa alokasi.

**6. Gerak tangan kanan**
- Mengorbit lengan kiri: 3 putaran dalam ±2,0 dtk (awal dan akhir melambat seperempat putaran), bergeser ±9 cm dari pergelangan ke arah siku.
- Radius orbit ≈ radius lengan + 5,5 cm.
- ORIENTASI TANGAN NYARIS TETAP, seperti mengaduk: jari menunjuk kiri-atas, telapak menghadap lengan, hanya bergoyang sinus ±0,25 rad (yaw) dan ±0,2 rad (roll) sefase orbit. Tidak boleh memakai rotasi absolut per kunci yang bisa berbalik.
- Saat tangan berada di sisi jauh, ia tertutup lengan kiri (wajar).
- Lengan bawah kanan diarahkan ke siku tetap di luar layar (pakai `aimArm` yang ada).
- Jarak tangan kanan ke kamera dijaga 0,30–0,50 m selama membalut.

**7. Akhir**
- Ujung kasa ditekan rata dekat lilitan terakhir (±0,25 dtk).
- Plester kecil 2 × 5 cm muncul di bawah ibu jari.
- Lengan kiri memutar sedikit (±20°, "memeriksa").
- Kedua lengan turun dan senjata naik tepat di akhir durasi (perilaku lama dipertahankan).

**8. Lini waktu** (u = 0…1 dari 3,5 dtk)

| u | Isi |
|---|---|
| 0–0,10 | senjata turun, lengan naik |
| 0,10–0,16 | ujung kasa ditempel di pergelangan |
| 0,16–0,74 | tiga lilitan |
| 0,74–0,84 | tekan + plester |
| 0,84–0,92 | periksa |
| 0,92–1 | turun |

Jalur batal (lari, ganti senjata) tetap: lengan turun 0,3 dtk tanpa loncatan.

**9. Bunyi (opsional bila infrastruktur `audio.cue` memungkinkan tanpa berkas baru)**
- Gesekan kain halus tiap lilitan.
- Sobekan plester di akhir.

**10. Pra-kompilasi**
- Bahan baru (kasa, plester) ikut `vm.compile()`, supaya tidak ada program shader baru saat pertandingan berjalan.

### Orang ketiga
- Cek pose perban di `web/map/rig.js` (`healKind`) lewat screenshot. Seharusnya: lengan kiri di depan dada, tangan kanan berputar kecil di sekitarnya, kepala menunduk ke lengan. Perbaiki bila janggal.
- Bot belum mengirim `healKind`. Tambahkan di blok pose `web/game/bots.js`: `p.healKind = b.healEnd ? b.ai.healKind : null` (catatan HANDOFF §31).

### P3K dan minuman
- Jalankan audit filmstrip yang sama.
- Perbaiki cacat sekelas (tangan berbalik/meloncat, pergelangan melayang, barang polos) bila ada, dan laporkan sebelum/sesudah.
- Prioritas tetap perban.

### Kriteria lulus (laporkan angkanya)
1. Filmstrip ≥ 24 frame orang pertama (dengan senjata dan tangan kosong). Lihat sendiri gambarnya:
   - kasa bertekstur dengan lilitan spiral bertumpang yang tepinya terlihat;
   - tidak ada lempeng putih polos;
   - pita menempel ≤ 3 mm dari permukaan lengan.
2. Orientasi tangan kanan menerus (diukur per frame 60 fps lewat delta quaternion):
   - kecepatan sudut ≤ 6 rad/dtk;
   - tidak ada rotasi antar frame > 25°;
   - kecepatan posisi tangan ≤ 2,5 m/dtk.
3. Jarak tangan kanan ke kamera 0,30–0,50 m untuk u ∈ [0,12; 0,9]. Ujung potongan lengan tidak pernah terlihat di layar.
4. Batal di tengah animasi: tanpa loncatan. HP bertambah pada waktu yang sama seperti sebelumnya.
5. 0 error konsol; biaya `vm.update` saat membalut ≤ +0,05 ms per frame; tanpa alokasi per frame; tanpa program shader baru setelah pertandingan mulai.
6. Orang ketiga: screenshot pose perban pemain dan bot.

## Aturan kerja
- Ubah hanya bagian obat di `weapons.js` (file ini juga sedang diubah agen senjata/scope di bagian lain; jangan memformat ulang atau menyentuh bagian scope/optik/material senjata).
- Jangan edit `HANDOFF.md`; paragraf HANDOFF ditulis di laporan.
- Naikkan `?v=` modul yang berubah di `web/royale.html`.

## C. Animasi kill di senjata (pengganti spanduk)

Tambahan 24 Nov. Steven (verbatim): "banner kan gw bilang di ganti sama animasi kalo gw dah kill, dari senjatanya kalo emg senjatanya ada animasi".

Maksudnya: spanduk memang hilang, tetapi gantinya senjata yang dipegang harus memainkan animasi kill bila skin senjatanya punya animasi. Skin tanpa animasi: tidak ada apa-apa selain bunyi dan kill feed.

### Yang sudah ada (HANDOFF §29; verifikasi sendiri)
- Tema skin senjata `th` di `web/game/skins.js` (`GUN_SKINS`): `flame { style, c1, c2 }`, `glow`, `voice`, `kill`, `color`, `color2`.
- `web/game/skinfx.js`: `sfGun` per `SF_GUN`; uniform bersama `SF_U.uSfT`; `uSfG` (x pendar isi ulang/periksa/cabut, y panas, z kilat, w sapuan).
- `web/game/weapons.js`: `skinFxTick`, `setSkinFx`, nyala moncong `createSkinFlame`, `setVmGlow` (etalase).
- `web/game/killfx.js`: hitungan kill beruntun (jeda ≤ 12 dtk), `kill()`, `knock()`, `preview()`.

### Rancangan

**1. Pemicu**
- `kills.kill(korban, kepala)` → `vm.killFx(n, kepala)`, dengan n = hitungan beruntun 1..5+.
- `kills.knock` → denyut kecil (kekuatan 0,5, tanpa gerak senjata).
- Hanya untuk skin dengan animasi: bidang baru `th.killAnim` di katalog, diisi untuk skin epik/legendaris yang punya `flame` atau badan beranimasi. Skin lain: tidak ada efek.

**2. Uniform baru `uSfK`** (dibagi lewat `SF_U`, seperti `uSfT`)

| Komponen | Isi |
|---|---|
| x | amplop denyut kill 0→1→0 selama ±1,2 dtk (naik cepat 0,12 dtk, turun pelan) |
| y | posisi sapuan 0..1 dari pegangan ke moncong, selesai dalam ±0,35 dtk |
| z | tingkat beruntun 0..1 = (min(n,5) − 1) / 4 |
| w | fase acak per kill |

**3. Tampilan per gaya di `sfGun`**
Pakai fungsi motif yang sudah ada; tanpa tekstur baru.

| Skin | Animasi kill |
|---|---|
| Magma | lava membanjiri retakan; gelombang putih-panas dari pegangan ke moncong; bara bertahan ±1 dtk |
| Plasma / Reaktor | kanal energi meluap; cincin pindai melesat sepanjang senjata; kedip holo |
| Garuda / emas | sapuan emas; bulu menyala berurutan |
| Merak / Reog | mata merak menyala bergiliran berpelangi |
| Neon | ledakan warna menjalar di garis |
| Es | kristal embun mekar lalu surut |
| Petir | kilat merambat membungkus senjata |
| Skin beranimasi lain (songket, pamor, holo, mutiara, dst.) | sapuan kilau yang diperkuat |

**4. Nyala moncong**
- Billboard `createSkinFlame` membesar ±2,2× dan lebih terang selama ±0,5 dtk, dengan gaya skin.

**5. Selubung senjata mulai kill ke-3**
- Cangkang aditif di sekeliling senjata, warna tema, selama ±1,5 dtk.
- Teknik seperti aura karakter: geometri dikembangkan menurut normal, fresnel tajam.
- Makin kuat di kill ke-4 dan ke-5.

**6. Gerak senjata**
- Selebrasi singkat ±0,6 dtk lewat pegas yang ada: miring ±12° pada sumbu laras, naik ±2 cm, lalu kembali.
- TIDAK menahan tembakan, bidik, isi ulang, atau obat.
- Saat membidik, menembak, isi ulang, atau memakai obat: tanpa gerak, efek cahaya saja.
- Saat memakai scope 4×/8×: tanpa efek.

**7. Bunyi**
- `killSting` tetap.

**8. Layar**
- Tidak ada spanduk, sinar tepi, atau elemen DOM baru.

**9. Toko**
- Tombol etalase senjata menjadi "Animasi kill": memainkan animasi yang sama di senjata etalase + bunyi; hitungan 1→5 tiap klik.
- `skinFeatures`: label "Animasi kill" untuk skin yang punya.

**10. Anggaran**
- Tanpa program shader baru saat pertandingan berjalan. Cabang kill ada di varian skin yang sudah dikompilasi dan digerakkan uniform; cangkang selubung ikut `vm.compile()`.
- ≤ +0,1 ms GPU selama efek.
- Tanpa alokasi per frame.

### Batas wilayah kode
- `weapons.js` sedang diubah agen senjata/scope (material view-model, optik, pose bidik).
- Taruh sebanyak mungkin di `skinfx.js` + `killfx.js`.
- Di `weapons.js` hanya: pengikatan uniform `uSfK`, `vm.killFx`, pembesaran nyala, cangkang selubung, gerak selebrasi. Buat sebagai blok tambahan yang terlokalisasi.

### Kriteria lulus
1. Filmstrip orang pertama untuk 7 skin beranimasi (magma, plasma/reaktor, garuda, merak, neon, es, petir) pada kill ke-1, ke-3, ke-5. Lihat sendiri: animasinya harus jelas terbaca sebagai "senjata bereaksi atas kill" dan berbeda antar skin.
2. Skin tanpa animasi dan senjata bawaan: tidak ada efek visual.
3. Saat membidik: efek cahaya ada, gerak tidak ada, bidikan tidak bergeser. Saat scope 4×/8×: tidak ada efek.
4. Tembak, isi ulang, dan obat tidak tertahan atau tertunda.
5. Toko: tombol "Animasi kill" bekerja untuk skin yang punya; skin lain tanpa tombol.
6. 0 error konsol; jumlah program shader konstan selama pertandingan; ≤ +0,1 ms GPU.
