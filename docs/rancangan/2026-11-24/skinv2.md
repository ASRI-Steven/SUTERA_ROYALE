# Rancangan SKIN v2: efek berbentuk per skin (tembak, isi ulang, cabut/periksa, kill, finisher) + katalog Nusantara

Desainer saja; tidak ada berkas repo yang saya ubah atau buat, dan tidak ada proses serve/cdpd/Chrome milik saya yang perlu dimatikan.

## 0. Status verifikasi (baca dulu)

**Yang saya periksa**
- Kode dibaca di 58a311f; titik kait dicek ulang di main fa5a1de (nomor baris di §6 dari fa5a1de).
- Berkas: `skins.js`, `skinfx.js`, `killfx.js`, `audio.js`, `lobby.js`, `postfx.js`, `profile.js`; di `weapons.js` bagian skin, selongsong, lini waktu isi ulang, `createEffects`; di `main.js` `fire/kill/knock/frame`; di `player.js` tembak, isi ulang, langkah, mendarat.
- Rencana `perban.md` C, `senjata.md`, `kostum.md`, `terjun.md`; HANDOFF §27, §29, §31.
- Screenshot lama agen skins (18 Nov) di `.wt/_shots/skins/`: `final_gun_reog.jpg`, `kill_garuda_a.jpg`, `fire_gun_magma.jpg`, `lob_char_warok.jpg`.

**Yang TIDAK saya jalankan**
- Harness Chrome/CDP dan Blender. Mode saya read-only ketat (dilarang membuat berkas apa pun, termasuk screenshot dan profil Chrome). Tidak ada filmstrip "sebelum" dan tidak ada angka GPU baru. Itu jadi M0.
- Shader dan atlas belum diprototipe. Semua anggaran di bawah adalah target, kecuali tiga angka yang saya hitung (node, stdout saja):
  - rasio FOV view-model 54° vs dunia 75°: tan 27° / tan 37,5° = 0,664 (kebalikannya 1,506);
  - tinggi layar objek 2,4 m pada 60 m: 19 px di 720p, 35 px di 1350p; potongan 0,3 m pada 30–60 m hanya 2–9 px;
  - jarak bertanda (EDT) satu sel 256×512: 6,9 ms di M1 ini.

**Keadaan pekerjaan paralel**
- **Animasi kill di senjata (perban C): belum ada di kode.** Tidak ada simbol `uSfK` / `killFx` / `killAnim` di main maupun `.wt/perban`. Saya membangun di atas kontrak di `perban.md` C; eksekutor wajib mencocokkan nama setelah C masuk.
- **Senjata v6:** di `.wt/senjata`, `gunPoints(kind)` → `{ muzzle, sight, guard, handR, optic, eject, charge }` dan `assembleGun` sudah diekspor. `weapons.json` main sudah punya `muzzle` dan `mag` per senjata (`mag` kosong untuk shotgun, revolver, dbs).
- **Kostum v2:** worktree masih bersih. Di `kostum.md`, `react` berada di dalam `emis` (`emis.react = { fire, cheer, reload }`) dan `mech.terms` punya `cheer`. Brief menyebut `react` sejajar `emis`; saya ikut rencana tertulis dan menambah blok `fx` opsional sendiri.

**Tidak ada pertanyaan yang memblokir.** Default yang saya pilih:
1. Tangga efek per kelangkaan:
   - biasa: pola saja;
   - langka: pola + pelacak berwarna + dampak bertema kecil (baru);
   - epik: semua slot, finisher "sedang";
   - legendaris: semua slot, finisher "besar", properti magasin bertema.
2. Finisher dan kill di senjata hanya untuk kill dengan senjata api (`w.inst` ada). Granat, kendaraan, tinju, zona: bunyi saja.
3. Bundel = beli dua barang sekaligus seharga jumlah harga satuan (tanpa diskon, supaya tangga harga utuh). Bonusnya kosmetik: finisher naik satu tingkat bila set lengkap dipakai.
4. Rekan bot tidak punya efek senjata (mereka tidak punya skin senjata). Bot lain: nol efek.
5. Pengaturan baru "Efek skin: Penuh / Ringkas / Mati" (`localStorage royale.skinfx`, bawaan Penuh). Ini setelan pemain, sekaligus dipakai untuk ukur A/B. Bukan flag tes.

---

## 1. Kerangka efek berbasis data

### 1.1 Prinsip (jawaban atas "titik-titik doang")
- Semua efek = **kartu berbentuk**: pita 2×5 verteks (8 segitiga) yang bisa menekuk dan mengepak, bertekstur atlas bentuk SDF. Bukan `THREE.Points`.
- **Aturan anti-titik di shader:** kartu yang tingginya di layar < 6 px tidak digambar (pudar 6–10 px). Kartu "hero" (siluet utama finisher) tidak pernah lebih kecil dari 3,5 % tinggi layar. Jadi dari jauh yang tersisa siluet besar, bukan bintik.
- Gerak dirancang lewat **preset gerak** (melayang, lesat, kipas, mekar, tumbuh, pilin, kedip, lidah api, pita, dst.) dan dihitung di vertex shader dari `(uT − t0)`. CPU hanya menulis 24 float saat emisi: 0 kerja per frame per kartu, 0 alokasi.
- Skin = data. Menambah skin = satu objek `fx` + (bila perlu) 1–3 sel atlas + 1 palet + 1 fungsi finisher.

### 1.2 Modul baru
| Berkas | Isi |
|---|---|
| `web/game/shapefx.js` | Mesin: `createShapeLayer({ max })`, shader, preset gerak, jangkar. Tidak mengimpor modul game. |
| `web/game/fxshapes.js` | Penggambar sel atlas (Canvas 2D) + pembangun SDF + palet. |
| `web/game/fxlib.js` | Kata kerja (resep parametrik), finisher, resep kostum, dan sutradara `createSkinFx()`. |

### 1.3 Mesin (`shapefx.js`)
**Lapisan.** Dua lapisan, masing-masing dua mesh (potong/cutout + aditif) yang berbagi buffer instans:
- `vmLayer` (maks. 96 instans) di `vm.scene`: efek yang menempel senjata/lengan orang pertama.
- `worldLayer` (maks. 384) di adegan dunia: jejak, dampak, finisher, efek kostum, etalase lobi, dan senjata orang ketiga.

`THREE.Mesh` + `InstancedBufferGeometry` + `ShaderMaterial`; `frustumCulled = false`; `matrixAutoUpdate = false`; `visible = false` saat tidak ada instans hidup (0 draw call saat diam).

**Atribut instans** (6 × vec4 = 96 byte, `DynamicDrawUsage`, ditulis sebagai ring buffer dengan `updateRanges`, pola `upRange3` di rig.js):
| Atribut | Isi |
|---|---|
| `iA` | posisi xyz (ruang jangkar), `t0` (dtk jam lapisan; boleh di masa depan = tunda) |
| `iB` | kecepatan xyz (mode kipas: sumbu samping b), umur |
| `iC` | arah xyz (sumbu panjang kartu / sumbu tengah kipas a / normal cap), sudut awal |
| `iD` | tinggi (m), rasio lebar/tinggi, nomor preset, benih 0..1 |
| `iE` | baris palet, penguat emisi (HDR), jangkar 0–3, aux (sudut kipas θ1 / radius pilin / y lantai) |
| `iF` | kotak sel atlas u0, v0, du, dv (dicari di CPU saat emisi) |

**Uniform:** `uT`, `uAnchor[4]` (mat4), `uP0..uP3[16]` (tabel preset), `uRes`, `uSunDir`, `uSunC`, `uAmb`, `uShade`, `tAtlas`, `tPal`, `uAdd` (0 potong / 1 aditif: satu sumber shader, satu program).

**Jangkar:** 0 = bebas (ruang lapisan), 1 = akar senjata, 2 = magasin, 3 = lengan kiri (VM) / dada karakter (dunia). Ukuran dikali skala jangkar (etalase lobi berskala).

**Preset gerak** (`uP0 = mode, gerak, campur, larut`; `uP1 = gravitasi, drag, amplitudo ayun, Hz`; `uP2 = putar, tekuk, muncul, renggang`; `uP3 = porsi akhir, kepak, hero, cadangan`):
| # | Nama | Gerak |
|---|---|---|
| 0 | `drift` | Kartu 3D bebas: jatuh 0,35 g dengan drag, ayun samping, goyang ±50° sefase ayun, menekuk, rebah di lantai, larut dari ujung. Bulu, daun, kelopak. |
| 1 | `dart` | Searah kecepatan, meregang menurut laju, menyusut di akhir. Serpih, bulu melesat. |
| 2 | `fan` | Bilah berporos: arah = cos θ·a + sin θ·b, θ = θ1·(0,08 + 0,92·buka(t)); buka = easeOutBack, opsi kepak. Kipas, sayap, kerang, kelopak mekar. |
| 3 | `pop` | Billboard: skala 0 → 1,15 → 1 lalu pudar. Kilas moncong, kilau. |
| 4 | `ground` | Rebah di tanah / menghadap normal, membesar r0 → r1, aditif, pudar. Cincin, cap, mandala. |
| 5 | `grow` | Tegak (billboard sumbu Y), tumbuh dari dasar dengan lewat-balik, bergoyang. Bambu, kristal. |
| 6 | `helix` | Naik berpilin mengelilingi pusat (radius = aux), searah gerak. Benang, sulur, kawanan ikan. |
| 7 | `flick` | Tegak, hanya tampil pada jendela waktu acak per benih. Kilat. |
| 8 | `tongue` | Tegak, meliuk (gelombang sepanjang tinggi), berdenyut, aditif. Lidah api. |
| 9 | `smoke` | Billboard naik, membesar, larut berbintik (potong, bukan aditif). |
| 10 | `orbit` | Mengitari sumbu laras jangkar. Periksa senjata. |
| 11 | `drop` | Balistik 1 g, meregang; hilang di lantai (resep menjadwalkan cap percik pada waktu jatuh yang dihitung saat emisi). |
| 12 | `ribbon` | Pita menari: gelombang berjalan sepanjang kartu. Benang, ekor layangan, sirip. |
| 13 | `hang` | Menempel jangkar, berayun. Rumbai magasin. |
| 14 | `flip` | Berputar pada sumbu di bidangnya (koin/piring/selongsong), balistik. |
| 15 | `hero` | Siluet besar tegak: naik/turun/meluncur, min 3,5 % tinggi layar. |

**Penjaga di vertex shader (semua lapisan):**
- kartu < 0,45 m dari kamera hilang, penuh mulai 1,6 m (dunia);
- tinggi layar maks. 35 % (hero 70 %) lalu memudar;
- **zona bersih bidikan:** kartu yang lebih dekat dari 4 m dan berada dalam 6 % tinggi layar dari pusat diskalakan ke 0 (penuh di 14 %).

**Fragment shader:**
- R = SDF siluet (0,5 = tepi), anti-alias `fwidth`.
- Warna = `tPal(B, baris)` × detail G.
- Cahaya sederhana dua sisi (matahari + langit × `uShade`).
- Emisi = palet emisi × A × penguat.
- Larut: ambang SDF naik (berbintik atau dari ujung).
- Jalur potong: `discard`, `gl_FragColor.a = 1` (alfa adegan = topeng AO di postfx.js), menulis kedalaman. Jadi kabut dan urutan benar, dan di VM tetap di depan dunia lewat `depthRange` yang ada.
- Jalur aditif: `depthWrite: false`.
- Akhiri dengan `#include <tonemapping_fragment>` dan `<colorspace_fragment>` (tingkat Hemat menggambar langsung ke layar dengan ACES + sRGB).

**Jam:** `layer.update(dt)` menambah `uT` dari `dt` game (berhenti saat jeda; ramah waktu virtual). Di-nol-kan bila tidak ada instans hidup.

**API:**
- `emit(px,py,pz, vx,vy,vz, dx,dy,dz, ang, size, aspect, preset, seed, pal, gain, anchor, aux, cellIndex, life, delay)` → nomor slot
- `kill(slot)`, `setAnchor(i, matrix4)`, `update(dt)`, `stats()` → `{ alive, peak, emitted }`

Acak memakai LCG modul; keadaannya properti biasa `sfx.rng` (harness boleh menyetelnya; bukan flag).

### 1.4 Atlas bentuk dan palet (`fxshapes.js`)
- **Satu tekstur** RGBA8 2048×1024 (8,4 MB GPU), tanpa mip, `LinearFilter`, dibuat di peramban (tanpa unduhan).
- Tiga kelas sel: T 128×256 (24 sel: bulu, lidah api, kilat, batang), H 256×256 (4 sel: siluet hero), S 128×128 (64 sel).
- **Kanal:** R = SDF siluet; G = detail (garis barb, urat, faset: menggelapkan); B = koordinat ramp palet 0..1; A = topeng emisi.
- **Cara buat per sel:**
  1. Gambar siluet dengan path Canvas 2D pada 2× ukuran sel.
  2. EDT Felzenszwalb dalam + luar → turunkan 2×, sebaran 12 px.
  3. G, B, A digambar di kanvas abu-abu terpisah (hindari alfa premultiplied).
  4. Rakit ke `Uint8Array` → `DataTexture`.
- **Palet:** `DataTexture` 64×128 sRGB. Baris 2k = ramp albedo, baris 2k+1 = ramp emisi (4–6 titik warna per ramp). Bentuk yang sama bisa diwarnai ulang per tema.
- **Jadwal:** sel dibangun satu per irisan waktu di lobi (di dalam `warmSkinCache`, ≤ 8 ms per irisan). Saat pertandingan mulai, sel tema terpasang yang belum jadi diselesaikan serentak (≤ 14 sel ≈ ≤ 100 ms sekali), lalu `renderer.initTexture`.
- **Gagal aman:** tiap penggambar dibungkus try/catch. Gagal → sel diisi cakram polos + satu `console.warn`.

### 1.5 Skema data per skin
Senjata (`th.fx` di `GUN_SKINS`; contoh Merak, angka di §2.1):
```js
fx: {
  pal: 'merak',
  fire:    [['muzzlePop', { shape: 'mata_merak', size: 0.07, life: 0.09, gain: 3 }],
            ['muzzleSpray', { shape: 'bulu_merak', n: 1, size: 0.11, speed: [5, 7], cone: 25, preset: 'dart', life: 0.32 }],
            ['drift', { shape: 'bulu_merak', n: 2, size: [0.14, 0.18], speed: [3, 6], life: 1.4, every: 2, cap: 12 }]],
  tracer:  { wake: ['serat', { step: 8, max: 3, size: 0.08, life: 0.7 }] },
  impact:  [['stamp', { shape: 'mata_merak', size: 0.22, life: 0.57, gain: 2 }], ['burst', { shape: 'bulu_kecil', n: 3, size: [0.06, 0.08], life: 0.7 }]],
  casing:  { tint: '#58c7a4', alt: { shape: 'bulu_kecil', every: 3, size: 0.05 } },
  reload:  { out: [...], in: [...], bolt: [...], prop: ['hang', { shape: 'bulu_kecil', n: 2, size: 0.05 }] },
  equip:   [['gunFan', { shape: 'bulu_merak', n: 7, len: 0.10, from: -20, to: 80, open: 0.18, end: 0.55 }]],
  inspect: [['gunRun', {...}], ['gunShed', {...}]],
  kill:    [['gunFan', { shape: 'bulu_merak', n: [7, 9, 11], len: [0.11, 0.12, 0.13], from: -20, to: 80, hold: 0.95, release: 'alt' }]],
  finisher:{ rec: 'dadakMerak', dur: 1.9, snd: 'merak', size: 'besar' },
}
```
Kostum (`fx` di `CHAR_SKINS`): `{ pal, kill: [...], reload: [...], step: [...], land: [...], fp: { kill: [...], reload: [...] }, idle: [...] }`. Resep bertanda `legacy: true` dilewati bila kostum v2 aktif untuk skin itu dan `costume.json.mech` punya term `cheer` (kipas/sayap sungguhan mengambil alih).

**Kata kerja** (`fxlib.js`, semuanya parametrik, tanpa closure per panggilan):
- Ruang senjata (jangkar 1/2): `muzzlePop`, `muzzleSpray`, `gunFan`, `gunRun` (deret kartu sepanjang laras, bergiliran), `gunOrbit`, `gunShed` (lepas/jatuh dari titik), `gunClamp` (cincin/bingkai mengecil/membesar di titik), `hang` (properti).
- Dunia: `drift`, `stamp`, `burst`, `groundRing`, `fan`, `grow`, `helix`, `rain`, `column`, `hero`.
- Titik senjata bernama: `muzzle`, `top` (optik/pisir), `port`, `magwell`, `charge`, `guard`, `stock`. Sumber: `gunPoints(kind)` bila ada (senjata v6), cadangan `muzzleLocal(kind)` + `weapons.json mag` + tabel kecil di fxlib.
- Titik isi ulang: magwell; shotgun = port isi; revolver = silinder; dbs = pangkal laras.

### 1.6 View-model vs dunia
| Kejadian | Orang pertama (VM) | Dunia (dilihat orang lain / orang ketiga / lobi) |
|---|---|---|
| Tembak | Kilas moncong + kartu pendek ≤ 0,35 s menempel ruang kamera | Kartu yang lepas dari moncong dan melayang 0,8–1,6 s. Titik lahir = moncong VM dikali k = tan(fov dunia / 2) / tan 27° pada sumbu x, y supaya tepat muncul di moncong layar. Orang ketiga: dari tulang `gun` karakter. |
| Jejak pelacak | — | Kartu "wake" di 24 m pertama jalur peluru |
| Dampak | — | Cap + pentalan di titik kena (normal ≈ kebalikan arah peluru; tanah = atas) |
| Selongsong | Warna/bentuk bertema di ruang kamera | — |
| Isi ulang, cabut, periksa, kill di senjata | Menempel senjata (jangkar) | Sama, dijangkarkan ke senjata orang ketiga pemain (tulang `gun` × rotY π) atau senjata etalase |
| Finisher | — | Di posisi korban; terlihat juga lewat scope |
| Kostum | Lengan kiri (jangkar 3) | Dada/punggung/kaki karakter |

**Membidik (ADS):** jumlah ×0,35, ukuran ×0,6, arah lontar dibiaskan menjauhi pusat layar; tanpa kipas di senjata.
**Scope 4×/8×:** VM nol (sesuai perban C); dunia hanya dampak + finisher.
**Bot tanpa skin:** sutradara mencari tema dari `agent.isPlayer ? temaPemain : agent.sfxTheme`; bot tidak punya `sfxTheme` → langsung keluar.

### 1.7 Anggaran kasus terburuk
| Hal | Batas |
|---|---|
| Instans | VM ≤ 96 (tembak ≤ 15, kill ≤ 24, isi ulang ≤ 12, cabut/periksa ≤ 12, selongsong ≤ 12, lengan kostum ≤ 12). Dunia ≤ 384 (jejak ≤ 20, dampak ≤ 20, finisher ≤ 64 legendaris n≥5 / ≤ 40 epik, maks. 2 penuh + 1 setengah serentak ≈ 160, kostum ≤ 24). |
| Segitiga | ≤ 3,9 rb (480 × 8) |
| Draw call | +4 saat ada efek, +0 saat diam |
| Program shader | +1 sumber (2 varian: target HDR dan layar), dikompilasi di lobi dan lagi saat pertandingan mulai |
| GPU | ≤ +0,15 ms tembak beruntun; ≤ +0,30 ms puncak finisher legendaris dari 5 m (2268×1350) |
| CPU | `sfx.update` ≤ 0,02 ms rata-rata; emisi finisher terbesar ≤ 0,15 ms sekali |
| Memori | atlas 8,4 MB + palet + buffer 46 KB |
| LOD jarak | < 25 m penuh; 25–80 m hero + cincin + 30 % kartu kecil; > 80 m hero + suar |
| LOD kualitas | Tingkat grafik `low`/`off` dan setelan "Ringkas": jumlah ×0,5 |

---

## 2. Set efek skin senjata beranimasi yang ADA (11)

**Aturan umum:**
- **Tembak:** tiap tembakan minimal 1 kartu VM. Jejak dunia tiap tembakan untuk semi/bolt/pompa, tiap tembakan ke-2 untuk otomatis; maks. 12 kartu dunia hidup per penembak.
- **Isi ulang:**
  - "keluar" ← cue `out` | `open`;
  - "masuk" ← `in` | `close` | `shell` (×0,5);
  - "kokang" ← `bolt` | `pump` | `tap` (×0,5).
  - Bunyi tema pada kejadian yang sama (§6 audio).
- **Kill di senjata** menumpang di atas perban C (denyut `uSfK`, nyala membesar, selubung n≥3, selebrasi). Kartu ikut matriks senjata. Tiga tingkat: n1–2 / n3–4 / n≥5; kepala: +2 kartu. Bilah 10–13 cm, kipas asimetris −20°…+80° ke arah luar layar supaya bidikan bersih.
- **Finisher:** mulai saat kill, pusat = posisi korban, ±1,5–2 s.
  - Semua kartu naik mulai ≥ 0,3–0,4 m di atas tanah.
  - Kipas/siluet berdiri 0,5 m di BELAKANG korban dilihat dari pembunuh.
  - Cap tanah aditif di bawah badan.
  - Tidak ada yang tersisa > 2,4 s.
  - **Knock** = versi mini (cincin tanah + 3–5 kartu, 0,7 s).

### 2.1 Dadak Merak (`gun_reog`, legendaris): persis contoh Steven
**Bentuk:**
- `bulu_merak` (T): tangkai, bendera berbarb, mata bercincin emas → toska → biru → nila.
- `bulu_kecil` (S), `mata_merak` (S), `serat` (T), `cincin` (S), `garis` (T), `kilau4` (S).

**Palet `merak`:** warna dari `sfPeacock` yang ada (`#050b2e #123c9c #0d8f86 #b98a24 #7c8a2a #1f4d1c`). Emisi: inti mata `#2a6bff`, cincin `#19c9a8`.

| Kejadian | Yang terlihat |
|---|---|
| Tembak (VM) | `mata_merak` mekar di moncong 5 → 9 cm, 0,09 s, aditif. Satu `bulu_merak` 11 cm melesat dari moncong (5–7 m/s, kerucut 25° menjauhi pusat layar, berputar pada tangkainya, 0,32 s). |
| Tembak (dunia) | 2 `bulu_merak` 14–18 cm lepas ke depan 3–6 m/s, melambat, lalu melayang turun berayun dan bergoyang ±50°, rebah di lantai, larut dari ujung; 1,4 s. Shotgun: 4 bulu. |
| Pelacak · dampak · selongsong | Kepala toska (ada) + 1 `serat` 8 cm tiap 8 m di 24 m pertama (maks. 3; 0,7 s). Dampak: cap `mata_merak` 22 cm mekar 0,12 s, pudar 0,25 s + 3 `bulu_kecil` 6–8 cm memental. Selongsong toska-emas `#58c7a4`; tiap selongsong ke-3 diganti `bulu_kecil` 5 cm berputar. |
| Isi ulang | **Keluar:** 3 `bulu_kecil` rontok dari lubang magasin (0,6 s). **Masuk:** kipas 5 `bulu_kecil` 6 cm di lubang magasin, buka ±50° 0,12 s, tahan 0,15 s, tutup + kempul. **Kokang:** 2 `bulu_merak` 8 cm menyembur dari port + `mata_merak` 4 cm. **Properti:** rumbai 2 `bulu_kecil` berayun di dasar magasin baru sampai 0,3 s setelah masuk. |
| Cabut | Kipas 7 `bulu_merak` 10 cm di atas receiver: buka 0,18 s (lewat-balik), tutup pada 0,55 s + bunyi reog (ada). |
| Periksa | Ombak 5 `bulu_merak` 8 cm sepanjang laras, tegak 0 → 70° → 0 bergiliran (selang 0,12 s); satu `bulu_kecil` lepas dan melayang. |
| Kill di senjata | Kipas `bulu_merak` di atas receiver: 7 bilah 11 cm / 9 bilah 12 cm / 11 bilah 13 cm + baris kedua 6 bilah 8 cm. Buka 0,22 s mulai t = 0,05 s; denyut mata merambat tengah → tepi dua kali; tahan sampai 0,95 s. Lalu bilah ganjil lepas melayang, bilah genap larut dari ujung. ADS: tanpa kipas, 2 bulu 7 cm menyembur ke samping moncong. |
| Finisher "Dadak Merak" (1,9 s) | **t 0:** cincin mata merak di tanah r 0,3 → 1,6 m. **t 0,05–0,40:** kipas 13 `bulu_merak` 1,9–2,4 m tegak di belakang korban, ±80°, mekar bergiliran dari tengah (selang 0,03 s). **t 0,45 & 0,85:** denyut mata. **Sampai 1,2 s:** tahan, bergoyang ±2°. **1,2–1,9 s:** bilah ganjil lepas dan melayang naik, bilah genap menutup dan larut. Ditambah 10 `bulu_kecil` melayang turun (hanya < 25 m). **n≥3:** 17 bilah + kipas dalam 7 bilah 1,2 m + 8 `garis` emas. **n≥5:** dua kipas samping 7 bilah 1,4 m + tiang toska 6 m. |

- **Bunyi finisher:** kendang 3 pukulan makin rapat + kempul 147 Hz + gemerincing.
- **Set Merak lengkap** (dengan `char_warok`): tingkat visual +1.

### 2.2 Sepuluh skin lain
Bentuk baru ditulis miring saat pertama muncul.

| Skin | Tembak (VM → dunia) | Isi ulang (keluar · masuk · kokang) | Cabut · periksa | Kill di senjata (n1 / n≥3 / n≥5) | Finisher | Pelacak · dampak · selongsong |
|---|---|---|---|---|---|---|
| **Emas Garuda** (leg.) | `kilau4` emas di moncong + 1 *`bulu_elang`* 12 cm melesat seperti anak panah → 1 bulu emas melayang 1,2 s | 2 bulu jatuh · sepasang sayap kecil (2×3 bilah 6 cm) mengepak sekali di lubang magasin · sayap mengepak sepanjang receiver. Properti: lencana `kilau4` di magasin | Sayap 2×3 bilah 12 cm membuka-menutup 0,5 s + pekik (ada) · sayap setengah terbuka selama diputar | Sayap 2×3 bilah 11 cm mengepak sekali lalu 6 bulu jatuh / bilah 13 cm + `kilau4` mahkota / dua kepakan + cincin emas | **"Sayap Garuda" 2,0 s:** dua sayap (2×7 bilah 1,6–2,6 m) membentang dari 1,4 m di atas korban, mengepak sekali, pecah jadi 16 bulu yang turun berpilin; tiang emas (n≥3). Bukan lambang negara, hanya sayap. | Jejak: 1 bulu kecil emas · cap `kilau4` + 3 bulu · selongsong emas berkilau |
| **Inti Magma** (leg.) | *`lidah_api`* 9 cm menjilat balik di moncong 0,2 s + 3 *`tetes`* lava melengkung → tetes jatuh jadi cap *`retak`* kecil yang mendingin 0,6 s | 3 tetes lava + *`asap`* dari lubang · 4 lidah api menyembur dari lubang + serpih obsidian (*`serpih`*) · semburan api dari port | 5 lidah api menyala berurutan popor → moncong · tetes lava menitik dari laras tiap 0,4 s + asap | 6 lidah api dari retakan atas + 8 tetes / lebih tinggi + serpih / "membara" 1,2 s bermahkota api | **"Letusan" 2,0 s:** cap `retak` r 1,8 m menyala lalu mendingin; pancuran 5 lidah api 1,5–3 m; 14 bom lava melengkung 2–4 m dan memercik; 6 asap naik ke 4 m. n≥5: letusan kedua di 0,6 s. | Jejak: tetes bara · cap `retak` 25 cm membara · selongsong hitam berpijar + asap |
| **Reaktor Plasma** (leg.) | 2 `cincin` cyan melesat dari moncong sambil membesar 3 → 9 cm + kilas *`segi6`* → 1 cincin terbang 6 m, membesar ke 25 cm | 3 *`chevron`* "buang panas" + uap · `segi6` mengerut ke lubang (1,6 → 0,6) + busur *`cabang`* · cincin pindai berjalan popor → moncong | 3 `segi6` muncul berurutan di laras · 4 *`pelat`* holo melayang di samping senjata + cincin berputar di laras | 3 cincin dari inti + 6 busur / cincin mengorbit 1 s / + bilah sinar dari moncong | **"Terurai terpindai" 1,8 s:** cincin heks naik dari tanah ke 2,2 m (0,6 s) sementara 24 `pelat` terangkat berurutan menurut tinggi; semua mengerut ke satu titik + sinar cyan tegak 0,25 s + cincin kejut tanah. n≥5: sinar 20 m. | Jejak: chevron · 2 `segi6` beriak + 3 pelat · "selongsong" = cincin sel energi |
| **Kristal Es** (epik) | 2 *`serpih_es`* melesat + 1 *`salju`* berputar pelan 1,2 s | 3 `salju` · 2 *`embun`* (bunga es) menjalar di lubang · 3 serpih berdenting dari port | 5 *`kristal`* tumbuh di atas senjata lalu pecah · 3 `salju` mengorbit laras | Mahkota 7 kristal 2–7 cm tumbuh, tahan 0,5 s, pecah jadi 12 serpih / lebih besar / dua gelombang | **"Beku lalu pecah" 1,8 s:** 9 kristal 0,8–1,9 m tumbuh melingkar r 0,7 m condong keluar + `embun` tanah r 2 m; kilau menyapu; pecah jadi 24 serpih + 8 `salju` | · cap `embun` 30 cm + 3 serpih · selongsong = serpih es |
| **Neon Ungu** (epik) | `segi6` ungu mekar di moncong + 3 `garis` neon melesat | 4 *`glif`* mengalir turun · 3 `segi6` mengunci berurutan · `garis` berlari di receiver | *`kisi`* menyapu popor → moncong · glif bergulir di sisi laras | 3 cincin heks ungu → cyan + garis memancar / cincin bertahan / badai glif | **"Jadi kisi" 1,6 s:** 12 `segi6` membentuk kubah r 1,1 m, menyala bergiliran, mengembang, pudar; 16 `garis` melesat ke atas 2–4 m; warna bergeser ungu → cyan | · `kisi` berkedip 0,25 s · selongsong ungu menyala |
| **Songket Emas** (epik) | 2 *`benang`* emas terulur dan menari (pita) + 1 `bintang8` berputar | benang terurai · 4 *`ketupat`* muncul berderet seperti pita tenun · `bintang8` berkilat | 6 ketupat "menenun" popor → moncong + bonang · 3 benang melambai dari popor | 5 `bintang8` berputar naik + 2 benang melilit laras / + deret tumpal / bintang besar | **"Tenun cahaya" 1,8 s:** `bintang8` r 1,5 m berputar di tanah; 6 benang naik berpilin ke 3 m, bertemu jadi bintang yang pecah jadi 12 *`kelopak`* marun-emas | · cap `ketupat` + bintang · selongsong emas |
| **Pamor Keris** (epik) | 2 *`pamor`* (berkas garis berliku) melesat meliuk + *`sulur`* asap dari moncong | sulur dari lubang · cincin *`mendak`* mengencang + gong · garis pamor berlari di laras | 3 sulur melilit senjata lalu terhisap ke laras · 2 sulur naik pelan | 5 sulur berpilin toska → emas + mendak berdenyut / mahkota sulur / + api roh di moncong 1 s | **"Asap tuah" 1,8 s:** 10 sulur naik berpilin mengelilingi korban, bertemu di 2,5 m jadi cincin pamor yang beriak mendatar 0,5 → 2,5 m. **Tanpa gambar bilah keris.** | · riak cincin + sulur · selongsong baja gelap |
| **Badai Petir** (epik) | 2 *`kilat`* 8–12 cm berkedip di moncong + `cabang` → kilat 30–60 cm melompat ke depan 0,1 s | 2 cabang dari lubang · kilat menyambar magasin ↔ lubang (2 kedip) · busur di tuas | 3 kilat merayap popor → moncong · *`awan`* mini 6 cm di atas receiver, menyambar tiap 0,5 s | awan 8 cm + sambaran ke receiver, 4 cabang ke moncong / 3 sambaran / dibalut busur 1,2 s | **"Disambar" 1,6 s:** awan 2,2 m terbentuk 4,5 m di atas korban; kilat 4,5 m menyambar (3 kedip, putih-ungu HDR); 6 cabang merayap di tanah; awan pudar. Guntur tertunda jarak / 343. | Jejak: 2 cabang berkedip · 4 cabang memancar + cincin · selongsong biru berpercik |
| **Holografik** (epik) | 3 *`segitiga`* foil berputar (warna berganti menurut sudut) + `garis` spektrum | *`bingkai`* mengecil ke lubang · bingkai mengembang dan mengunci dengan geser glitch dua kali · pita spektrum menyapu | 3 bingkai C/M/Y bertemu di senjata · 3 *`prisma`* mengorbit | Kipas 7 `garis` spektrum (tiap bilah beda rona) 0,6 s / kipas ganda / lingkar penuh | **"Glitch" 1,5 s:** 3 bingkai tegak 2 m (C/M/Y) bergetar mendatar, runtuh jadi satu garis mendatar (seperti TV mati), cincin spektrum mengembang, 16 segitiga beterbangan | · `prisma` + segitiga · selongsong foil |
| **Mutiara Laut** (epik) | separuh *`kerang`* terlempar + 2 *`gelembung`* besar 4–8 cm bergoyang + `cincin2` riak di moncong | 2 gelembung naik · dua separuh kerang mengatup di lubang + denting · riak | kerang membuka memperlihatkan kilau · gelembung mengorbit | kerang 9 cm membuka, mutiara naik dan pecah jadi 3 riak / + *`ombak`* berlari di laras / 3 kerang | **"Pusaran mutiara" 1,8 s:** 3 riak tanah sampai r 2,2 m; 8 `ombak` melingkar naik 1,2 m dan pecah; kerang 1,4 m membuka di 1,6 m melepas mutiara cahaya yang naik 5 m | · 2 riak + percik ombak · selongsong mutiara |

---

## 3. Efek skin baju

### 3.1 Keselarasan dengan kostum v2
- Kostum v2 mengurus badan kostum: pegas, `mech.terms` (run, air, cheer, …), `emis.react` (fire, cheer, reload).
- Saya menambah **kartu berbentuk yang lepas dari kostum**, dengan pemicu yang sama:

| Pemicu | Sumber |
|---|---|
| `kill` | `kills.kill` → `sfx.costume(me, 'kill', n)`. Kostum M5 menyetel `me.pose.cheer = 1` di tempat yang sama. |
| `reload` | `player.js reload()` |
| `step` | Langkah kaki di `player.js` (blok `st.stepT`), hanya saat `st.sprinting` |
| `land` | Tiga titik mendarat di `player.js`, kekuatan dari laju jatuh |

- Data di katalog (`CHAR_SKINS[i].fx`), jadi jalan untuk skin lama (palet + aura) maupun kostum v2. Titik asal = tulang (`chest`, `head`, `hips`, tangan, kaki dari `agent.pos`).
- `costume.json` boleh menimpa lewat `fxAnchors: { back: [x,y,z], … }` (ditulis `costumes.py` dari poros bagian kaku).
- Pemain orang ketiga dan karakter lobi: jangkar 3 dunia = tulang dada (efek ikut bergerak).
- Rekan regu berkostum (kostum M5): kartu dipanggang di ruang dunia saat emisi, hanya `kill`.

### 3.2 Reaksi per skin baju beranimasi yang ada
| Skin | Kill | Isi ulang | Lari | Mendarat | Orang pertama (lengan kiri) |
|---|---|---|---|---|---|
| **Warok Barong** (M1) | Kipas 9 `bulu_merak` 0,9–1,2 m mekar di punggung 1,5 s (`legacy`; diganti kipas kostum v2) + 6 `bulu_kecil` rontok | 2 `bulu_kecil` lepas dari manset | Tiap 2 langkah 1 `bulu_kecil` tertinggal, melayang 1,2 s | Cincin mata merak di tanah r 1,2 m + 8 `bulu_kecil` memencar rendah | Kipas 3 `bulu_kecil` 5 cm dari manset 0,8 s saat kill; 1 bulu lepas saat magasin masuk |
| **Garuda Emas** | Sepasang sayap 2×5 bilah 0,9 m dari belikat 1,5 s (`legacy`) + `kilau4` | Sayap kecil 2×3 bilah 0,35 m mengepak sekali | 1 bulu emas per 3 langkah | Sayap mengepak ke bawah (mengerem) + cincin emas tanah | 2 `bulu_elang` 6 cm memanjang dari gauntlet saat kill |
| **Reaktor Sutera** | 3 `segi6` memancar dari inti dada 0,4 → 1,2 m + 4 `pelat` mengorbit 1 s | 4 `chevron` buang panas dari punggung + uap | Garis cyan di tanah per langkah (0,35 m, 0,5 s) | Cincin heks ganda r 1,5 m | Cincin heks berjalan siku → pergelangan saat kill; 2 chevron saat isi ulang |
| **Inti Magma** | 5 `lidah_api` 0,6 m dari bahu + 6 `tetes` | `asap` + 2 tetes dari bracer | Tapak membara: cap `retak` 0,25 m, pudar 0,8 s | `retak` r 1,2 m + 6 gumpal lava | Lidah api 5 cm di bracer 0,6 s |
| **Kristal Es** | 6 `kristal` 0,25 m tumbuh di bahu lalu pecah | 2 `salju` dari manset | Tapak `embun` 0,3 m, 1 s | `embun` r 1,3 m + 6 serpih | Kristal 4 cm tumbuh di punggung tangan lalu pecah |
| **Neon Kota** | 3 `segi6` dari dada + `garis` naik di kaki | 4 `glif` bergulir di lengan | Jejak `garis` di belakang tumit 0,3 s | `kisi` tanah r 1,2 m | `garis` melesat siku → jari + `segi6` di punggung tangan |
| **Batik Parang** | 6 `ketupat` emas naik berpilin satu putaran | `benang` emas dari manset | 1 `kelopak` per 4 langkah | *`mandala`* emas tipis r 1,2 m | 2 ketupat kecil lepas dari manset |
| **Empu Pamor** | 4 `sulur` tuah naik dari punggung + `mendak` di dada | 1 sulur kecil (kostum v2: keris terhunus 6 cm) | — | Riak cincin pamor | Sulur melilit lengan bawah 0,8 s |
| **Kencana** | 5 `kilau4` mutiara mekar bergiliran di bahu dan dada + 2 riak | `kilau4` di manset | — | Riak ganda emas mawar | `kilau4` menyapu manset |

Skin baju biasa/langka: tanpa reaksi (tangga nilai dijaga).

---

## 4. Perluasan katalog bernuansa Indonesia

### 4.1 Koleksi baru
Ditambahkan di akhir `COLLECTIONS`; urutan lama tetap.
- `satwa` "Satwa Nusantara": cendrawasih, maung, komodo.
- `bahari` "Bahari": phinisi, terumbu, jalur rempah.
- `kriya` "Kriya": ukir Jepara, perak filigri, anyam rotan.
- Koleksi lama `panggung`, `alam`, `wastra` ikut bertambah.

### 4.2 Senjata baru (16; `SF_GUN` 22–37)
Kelangkaan: 4 legendaris, 8 epik, 3 langka, 1 biasa.

| id | Nama · koleksi · kelangkaan | Motif / bahan (shader) | Set efek (bentuk khas) | Finisher | Suara (`VOICES` baru) |
|---|---|---|---|---|---|
| `gun_kayon` | Kayon Blencong · panggung · leg. | Kulit bertatah kerawang hitam-emas; cahaya blencong ambar bergerak di balik lubang tatahan | *`tatah`* (daun kerawang) + `garis` percik ambar. Isi ulang: ketukan kayu + kipas 5 tatah. Kill: bayang daun berkibar di senjata. | **"Tancep Kayon":** siluet *`gunungan`* (H) 2,8 m naik di belakang korban, berkibar kiri-kanan dua kali, ditancapkan, larut dari pucuk jadi 12 `tatah`; pendar ambar di belakangnya. n≥3: dua kayon pengapit. | `wayang`: ketuk kayu (sinus 420 → 300 Hz + noise 1,8 kHz) + kecrek (2 noise highpass) + gong suwukan 131 Hz |
| `gun_terumbu` | Terumbu Raja · bahari · leg. | Kaustik air toska bergerak + karang merah muda/jingga + kawanan ikan berenang di badan | *`ikan`* 3 ekor melesat dan berenang (ekor menekuk) + `cincin2`. Isi ulang: ikan mengitari magasin + gelembung besar. Kill: kawanan mengorbit senjata. | **"Pusaran Samudra":** 36 `ikan` naik berpilin dua putaran ke 3,2 m; 3 riak tanah; siluet *`manta`* (H) 3 m meluncur melengkung di atas korban sambil mengepak. n≥5: dua manta. | `gelembung`: "bloop" sinus 300 → 900 Hz ×2 + dentum teredam; base [0.45, 1.2, 0.55] |
| `gun_phinisi` | Layar Phinisi · bahari · leg. | Papan jati berpakal, layar kanvas krem, tali, kuningan | *`layar`* kecil mengembang + percik `ombak` + *`tali`* melingkar. Isi ulang: tali terulur lalu ditarik kencang. Kill: 7 layar kecil terkembang berurutan di atas senjata. | **"Layar Terkembang":** 8 `ombak` melingkar naik; siluet *`phinisi`* (H) 3,2 m muncul seperti menaiki ombak (angguk 8°), layarnya membuka dari bawah, lalu berlayar naik dan larut jadi percik. | `ombak`: noise lowpass membuncah 0,4 s + lonceng kapal 880 Hz [1, 2.4, 3.8] |
| `gun_cendrawasih` | Cendrawasih · satwa · leg. | Bulu halus kuning-emas → putih, badan marun, aksen zamrud, serat melambai | *`bulu_surai`* (T, panjang berserat) melengkung jatuh seperti air mancur. Isi ulang: 2 surai menjuntai dari magasin. Kill: air mancur 7 surai di atas senjata. | **"Tarian Cendrawasih":** 14 `bulu_surai` 1,6–2,6 m menyembur ke atas lalu melengkung keluar (kipas dengan tekuk kuat di ujung), berkilau emas → putih, lepas dan melayang; `kilau4` zamrud di pusat. n≥5: lingkar penuh. | `tifa`: dentum 140 → 90 Hz + kicau sinus 2,2 → 3,4 kHz bergetar |
| `gun_maung` | Loreng Maung · satwa · epik | Loreng bulu jingga-hitam-putih doff (jingga dominan, tidak menyala) | *`cakar`* (3 sabetan sejajar) + jumbai bulu. Isi ulang: sabetan kecil di lubang magasin. Kill: sabetan cakar melintang di atas senjata. | **"Terkam":** dua `cakar` 2,4 m menyilang di 1,2 m (selang 0,12 s), inti jingga-putih; cincin loreng di tanah; 8 jumbai | `auman`: gergaji 70–90 Hz lewat shaper + AM 30 Hz + bandpass 500 Hz |
| `gun_angklung` | Bambu Angklung · panggung · epik | Ruas bambu kuning-hijau berbuku + ikatan rotan | *`daun_bambu`* + busur gelombang bunyi (`cincin` sebagian). Isi ulang: tabung beradu. Kill: 3 *`batang_bambu`* kecil tumbuh di atas senjata lalu berdaun. | **"Rumpun Bambu":** 9 `batang_bambu` 1,8–3,2 m tumbuh melingkar r 0,9 m (bergiliran, bergoyang), 18 daun turun berpilin, 3 busur bunyi mendatar | `angklung`: 3 nada segitiga 784/1046 Hz bertremolo 12 Hz + noise bandpass |
| `gun_ijen` | Api Biru · alam · epik | Basal gelap + kristal belerang kuning; api biru menjilat (emisi biru) | `lidah_api` palet biru + `serpih` kuning + `asap` pucat. Isi ulang: desis gas + lidah biru dari lubang. Kill: 5 lidah biru menyala berurutan. | **"Api Biru":** 7 lidah biru 1,2–2,8 m rapat dan berkedip; 10 kristal kuning terpental; asap kekuningan; cincin kerak belerang di tanah | `desis`: noise highpass 5 kHz 0,25 s + "whoomp" 120 → 50 Hz + derak |
| `gun_piring` | Tari Piring · panggung · epik | Porselen putih berglasir, motif biru kobalt, tepi emas | *`piring`* kecil berputar (`flip`) + `serpih` porselen. Isi ulang: denting piring. Kill: 3 piring berputar di ujung laras. | **"Piring Berputar":** 6 `piring` mengorbit korban di 1,2–1,8 m sambil naik 0,9 s, lalu pecah serentak: 18 serpih + cincin emas. n≥3: 10 piring. | `piring`: lonceng 1760 Hz [1, 2.32, 4.25] pendek, dua kali |
| `gun_jepara` | Ukir Jepara · kriya · epik | Relief ukiran bunga-sulur jati tua, kilap lilin emas | *`serutan`* (serutan kayu keriting) + `kelopak` kayu. Isi ulang: ketukan pahat. Kill: 5 kelopak ukir mekar di receiver. | **"Ukiran Mekar":** `mandala` kayu tumbuh di tanah r 1,6 m; 5 kelopak ukir 1,4 m mekar keluar; 16 serutan naik berpilin | `kayu`: dua ketukan kering (sinus 520 → 380 Hz) |
| `gun_perak` | Perak Filigri · kriya · epik | Kawat filigri perak terang (±60 % luas) di atas hitam oksidasi | *`filigri`* (sulur spiral) + `kilau4` putih. Isi ulang: spiral mengencang. Kill: 4 sulur "tergambar" sepanjang laras. | **"Sulur Perak":** 12 `filigri` 0,6–1,2 m muncul berputar membentuk kubah renda, 5 `kilau4`, lalu mengerut jadi satu kilau | `perak`: segitiga 2637 + 3520 Hz pendek |
| `gun_layang` | Layang-layang · panggung · epik | Panel kain tiga warna, rangka bambu, benang | *`layang`* mini + pita ekor (`ribbon`). Isi ulang: benang ditarik. Kill: 3 layang kecil naik dari senjata. | **"Naik Layangan":** 5 `layang` 0,8 m berekor pita 2 m naik mengipas sampai 7 m dan bergoyang hingga 2 s. n≥3: 8 layang. | `sendaren`: dua gergaji 330 Hz lewat bandpass + vibrato pelan |
| `gun_rempah` | Jalur Rempah · bahari · epik | Karung goni berstensil, kuningan, renda fuli merah di atas cokelat pala | *`lawang`* (bunga lawang) + *`cengkeh`* 12 cm + `serutan` (kayu manis). Isi ulang: kocokan rempah. Kill: lawang berputar naik. | **"Badai Rempah":** 10 lawang + 10 cengkeh + 6 kayu manis naik berpilin rapat dengan `asap` kunyit, lalu memencar | `rempah`: 3 semburan noise 6 kHz + dentum kayu |
| `gun_komodo` | Sisik Komodo · satwa · langka | Sisik manik abu-zaitun kasar, aksen kuning | Dampak: 3 *`sisik`* + debu | — | — |
| `gun_rotan` | Anyam Rotan · kriya · langka | Anyaman rotan krem-madu 1/1 tebal, lilitan gelap | Dampak: serpih rotan (`serutan` kecil) | — | — |
| `gun_sasirangan` | Sasirangan · wastra · langka | Ikat celup zigzag magenta/kuning/hijau membaur | Dampak: percik warna (`tetes` 3 warna) | — | — |
| `gun_lurik` | Lurik · wastra · biasa | Garis tenun halus cokelat/nila, doff | — | — | — |

`KFAM` (keluarga denting kill): tambah keluarga `wood` (angklung, kayu, wayang, rempah) dan `water` (ombak, gelembung). Sisanya masuk keluarga lama: tifa/auman → `fire`; piring/perak → `bell`; sendaren → `synth`; desis → `storm`.

**Matriks beda senjata** (terhadap 22 lama + sesama baru): motif × palet × efek.
| Baru | Tetangga terdekat | Pemisah |
|---|---|---|
| kayon | wayang (cincin tatah emas/merah/toska, statis) | Dua warna hitam-ambar dengan cahaya dari balik lubang; efek daun kerawang + siluet |
| terumbu | mutiara (nacre pastel), es | Toska jenuh + koral; ikan dan manta, bukan kerang/riak |
| phinisi | jepara (baru), keris (kayu timoho sebagian) | Papan + kanvas krem luas + tali, tanpa ukiran; efek layar/ombak |
| cendrawasih | garuda (emas logam berukir + merah), reog | Serat lembut kuning → putih, doff; surai panjang melengkung, bukan sayap/kipas |
| maung | magma (hitam, retakan jingga menyala), bagian gagang reog | Jingga dominan tidak menyala, garis lebar; efek cakar |
| angklung | rimba (loreng hijau doff), rotan (baru) | Ruas bambu berbuku kuning-hijau; batang tumbuh |
| ijen | magma, es, plasma | Api BIRU + kristal KUNING (dua warna), berasap |
| piring | marmer (putih urat emas), es | Motif kobalt di glasir; piring berputar |
| jepara | phinisi | Relief dalam satu warna jati; serutan + kelopak ukir |
| perak | keris (pamor nikel di baja hitam, pendar toska) | Renda spiral perak terang ±60 % luas, kilau putih; tanpa kayu, tanpa toska |
| layang | ondel (merah + pita warna), holo | Blok warna datar doff; layangan berekor |
| rempah | phinisi, jepara | Goni + renda merah, bukan kayu; lawang/cengkeh |
| komodo | naga (sisik merah berkubah tepi emas) | Manik kecil abu-zaitun, tanpa emas |
| rotan | karbon (twill hitam halus) | Anyaman 1/1 tebal krem |
| sasirangan | senja (gradasi), ondel | Zigzag ikat celup membaur |
| lurik | (tenun, baju) | Garis lurus halus |

**Pemeriksaan data otomatis:** tidak ada dua skin dengan pasangan (bentuk tembak, resep finisher) yang sama.

### 4.3 Kostum baru (13; gaya katalog `kostum.md`)
K = kepala, T = atasan, B = bawahan, P = punggung. Semua [BL] kecuali disebut. Butuh pipeline kostum (pegas M3; mech M5).

| id | Nama · koleksi · kelangkaan · pasangan | Siluet | Bahan · palet | Animasi khas (kostum v2) | Reaksi berbentuk (fxlib) | Orang pertama |
|---|---|---|---|---|---|---|
| `char_punggawa` | Punggawa Kelir · panggung · leg. · `gun_kayon` | **K** kuluk hitam berlis emas. **T** surjan lurik + selempang kain kelir putih. **B** celana panji selutut + dodot pendek. **P** kayon besar 1,1 m (mech) + lentera blencong di pinggul (rantai). | Lurik cokelat-nila, kulit tatah hitam-emas, emisi ambar | Kayon naik dan berkibar saat kill; lentera berkedip, makin terang saat menembak | Kill: 8 `tatah` gugur dari kayon + pendar ambar. Lari: 1 tatah per 3 langkah. Mendarat: bayangan `gunungan` tanah r 1,2 m. | Lengan lurik, gelang tatah emas; 3 tatah mekar dari manset saat kill |
| `char_manta` | Pari Manta · bahari · leg. · `gun_terumbu` | **K** tudung selam ramping + goggle. **T** wetsuit berzirah + jubah sayap manta (mech, bentang 1,6 m). **B** ketat + sirip betis terlipat. **P** jubah + tabung kecil. | Neoprene (PH scuba_suede), nila tua atas / putih bawah, bintik cyan menyala | Sayap membentang saat terjun/udara dan saat kill; bintik berdenyut | Kill: 12 `ikan` mengitari badan satu putaran. Isi ulang: 2 gelembung besar. Mendarat: riak ganda. | Lengan nila berbintik cyan; `ikan` kecil melintas di lengan saat kill |
| `char_nakhoda` | Nakhoda Phinisi · bahari · leg. · `gun_phinisi` | **K** passapu (ikat kepala Bugis berujung runcing). **T** jas tutup krem terbuka + kemeja + gulungan tali menyilang. **B** sarung kotak selutut di atas celana. **P** gulungan layar + tiang (mech). | Kanvas krem (PH rough_linen), jati, sarung merah kotak, tali | Layar kecil terkembang saat kill dan terjun; ujung sarung dan tali berayun (3 rantai) | Kill: 3 `layar` kecil + percik `ombak`. Lari: —. Mendarat: cincin `tali` di tanah + percik. | Lengan krem digulung, gelang tali; `tali` melilit lengan saat isi ulang |
| `char_cendrawasih` | Penari Cendrawasih · satwa · leg. · `gun_cendrawasih` | **K** ikat kepala + 3 bulu tegak (pegas). **T** rompi + epolet surai. **B** rok-ekor surai panjang (4 rantai). **P** kipas ekor surai (mech). Kostum tari kreasi, bukan busana adat. | Surai kartu alfa buatan, kuning-emas → putih, badan marun, tenggorok zamrud | Ekor terangkat dan mengembang saat kill (gaya pamer burung); surai mengalir saat lari/terjun | Kill: air mancur 8 `bulu_surai` 0,8 m. Lari: 1 surai per 3 langkah. Mendarat: 8 surai memencar. | Lengan marun, gelang surai; 2 surai melengkung dari manset |
| `char_maung` | Pendekar Maung · satwa · epik · `gun_maung` | **K** iket. **T** rompi tanpa lengan + mantel kain loreng satu bahu + balut lengan. **B** pangsi 3/4 + sarung loreng di pinggang. **P** kosong. | Kain loreng buatan (bukan kulit), jingga dominan + hitam + gading | 2 rantai (mantel, sarung) | Kill: `cakar` 0,6 m menyabet di depan dada. Mendarat: cincin loreng. | Lengan telanjang berbalut kain loreng; sabetan kecil di punggung tangan |
| `char_angklung` | Mang Angklung · panggung · epik · `gun_angklung` | **K** dudukuy cetok (topi bambu kerucut lebar). **T** kampret putih + rompi anyam. **B** komprang + sarung poleng. **P** rak 3 angklung (pegas, berayun saat lari). | Bambu, anyaman, katun putih, kotak nila | Tabung berayun; bunyi rak saat mendarat | Kill: 6 `daun_bambu` + busur bunyi. Lari: 1 daun per 2 langkah. Mendarat: 3 busur bunyi. | Lengan putih, gelang rotan; daun bambu lepas saat isi ulang |
| `char_kawah` | Penjaga Kawah · alam · epik · `gun_ijen` | **K** helm bertepi lebar + pelindung muka penuh + lampu. **T** baju tahan panas perak, noda belerang. **B** celana perak + bot. **P** tabung + gulungan selang (rantai). | Foil aluminium (aCG Metal), kuning belerang, emisi biru | Api biru menjilat bahu (emisi mode lava palet biru), membesar saat kill | Kill: 4 `lidah_api` biru 0,5 m di bahu. Lari: tapak kerak kuning. Mendarat: cincin belerang + asap. | Sarung tangan perak; lidah biru 4 cm di manset |
| `char_piring` | Penari Piring · panggung · epik · `gun_piring` | **K** tengkuluk tanduk (varian f1/f2); saluak (varian m1/m2). **T** baju kurung beludru lembayung bersulam emas + salempang. **B** galembong + sesamping songket selutut. **P** dua piring di sabuk belakang. | Beludru (aCG Fabric), sulam emas, porselen | 2 rantai (salempang, sesamping) | Kill: 2 `piring` mengorbit badan lalu pecah. Mendarat: 6 serpih porselen. | Lengan beludru, manset emas; piring kecil berputar di atas tangan 0,6 s |
| `char_gebyok` | Zirah Gebyok · kriya · epik · `gun_jepara` | **K** visor kayu kerawang (bukan topeng tokoh). **T** panel jati berukir di atas linen. **B** celana linen + pelindung betis kayu. **P** panel gebyok. | Jati (PH), linen, satu warna cokelat | Kilap lilin menyapu ukiran | Kill: 3 kelopak ukir mekar di bahu. Lari: 1 `serutan` per 2 langkah. Mendarat: `mandala` kayu. | Bracer kayu berukir; serutan lepas saat isi ulang |
| `char_perak` | Perak Kotagede · kriya · epik · `gun_perak` | **K** tiara filigri + kerah kipas renda (kaku). **T** beskap hitam + dada filigri. **B** celana hitam + sarung benang perak pendek. **P** kerah kipas. | Hitam + perak terang | Kilau menyapu renda | Kill: 4 `filigri` tergambar keluar dari dada. Mendarat: cincin renda. | Manset filigri; sulur tergambar di punggung tangan |
| `char_layang` | Pelayang · panggung · epik · `gun_layang` | **K** bandana + goggle di dahi. **T** jaket panel warna. **B** celana pendek + legging. **P** layangan besar + 3 ekor pita (pegas). | Ripstop, panel merah/kuning/biru/putih | Ekor berkibar kuat saat lari/terjun | Kill: 2 `layang` kecil naik. Lari: pita ekor tambahan. | Lengan panel warna, gulungan benang di pergelangan |
| `char_saudagar` | Saudagar Rempah · bahari · epik · `gun_rempah` | **K** tanjak. **T** rompi panjang + kemeja lengan lebar + untaian pala. **B** celana lebar + sabuk kain. **P** karung rempah + ikatan kayu manis. | Goni, katun, cokelat pala + merah fuli + kunyit | 3 rantai (rompi, untaian, sabuk) | Kill: 5 `lawang` berputar naik. Lari: kepul kunyit kecil (`asap`). Mendarat: lawang memencar. | Lengan lebar kunyit, gelang pala |
| `char_ranger` | Ranger Komodo · satwa · langka · `gun_komodo` | **K** topi rimba + penutup tengkuk (rantai). **T** kemeja ranger + pelindung sisik. **B** celana pendek + gaiter. **P** tongkat cagak. | Khaki-zaitun + abu sisik | 1 rantai | — | Lengan khaki, pelindung sisik |

**Matriks beda kostum** (siluet × warna, terhadap 18 lama):
| Baru | Tetangga terdekat | Pemisah |
|---|---|---|
| punggawa | batik (blangkon, jarik panjang), empu (udeng, keris besar) | Kuluk tinggi + kayon daun 1,1 m + lentera; lurik bergaris lurus |
| manta | samudra (toska, tabung, masker), malam | Jubah sayap 1,6 m, nila/putih |
| nakhoda | merahputih (jas putih, peci, selempang) | Sarung kotak + gulungan layar di punggung + tali; krem/jati |
| cendrawasih | garuda (zirah emas bersayap), warok (kipas hijau) | Surai lembut kuning-putih, tanpa helm, badan marun |
| maung | magma, warok (hitam, gombor) | Jingga loreng dominan, lengan telanjang, punggung kosong |
| angklung | merahputih, tenun | Topi kerucut lebar + rak bambu |
| kawah | reaktor, kabut (tudung + respirator abu), es | Foil perak mengilap + api biru + noda kuning, helm bertepi |
| piring | ondel (baju kurung merah) | Lembayung bersulam emas, tengkuluk tanduk, galembong |
| gebyok | batik, gurun | Panel kayu kaku |
| perak | malam (hitam doff + amber) | Renda perak terang, kerah kipas |
| layang | ondel, neon | Layangan di punggung, blok warna primer |
| saudagar | empu, batik | Rompi panjang, celana lebar, karung |
| ranger | gurun (coverall + helm), rimba | Celana pendek, topi lebar, tongkat cagak |

Uji kuantitatif memakai §5.3 `kostum.md` (1 − IoU dan ΔE).

### 4.4 Bundel
`BUNDLES` di `skins.js`.
- **Yang ada:**
  - Set Merak (`gun_reog` + `char_warok`), Garuda, Magma, Es, Neon, Reaktor (`gun_plasma` + `char_reaktor`);
  - Pusaka Empu (`gun_keris` + `char_empu`), Wastra (`gun_songket` + `char_batik`), Kencana (`gun_mutiara` + `char_kencana`).
- **Baru:** Kayon, Samudra Raja (terumbu + manta), Phinisi, Cendrawasih, Maung, Angklung, Api Biru, Tari Piring, Jepara, Perak, Layangan, Rempah, Komodo.
- Bonus set: tingkat visual finisher +1 dan reaksi kostum disamakan waktunya dengan kill di senjata.

### 4.5 Batas budaya (tertulis supaya eksekutor tidak menambah sendiri)
- **Tidak dipakai:** pura/candi/stupa, Barong Bali dan Rangda, ogoh-ogoh, kaligrafi dan simbol agama, sesajen, bilah keris/kujang/mandau sebagai efek kematian, tau-tau/nisan, kain yang menutupi korban, bendera Merah Putih dan lambang Garuda Pancasila, burung enggang dan motif perisai Dayak, tokoh dewa wayang, wajah Kala pada gunungan.
- **`gunungan`:** siluet daun kerawang abstrak (tanpa gapura, hewan, atau wajah). Dipakai sebagai "tancep kayon" = penutup pertunjukan. Cadangan bila Steven keberatan: kelir + bayangan daun.
- Maung = kain bermotif, bukan kulit hewan.

---

## 5. Toko dan lobi (`lobby.js`, `lobby.css`)

**Etalase senjata: baris "Lihat efek"** di kartu detail (hanya skin yang punya `th.fx`):
- Tombol `data-fxdemo`: Tembak · Isi ulang · Kill · Finisher. "Kill" = tombol "Animasi kill" milik perban C (`data-killfx`, hitungan 1 → 5 per klik); penanganannya diperluas memanggil `sfx.demo('kill', n)`.
- Selama peragaan, putaran meja etalase ditahan di tiga perempat (rotasi y −0,9 rad) 2,5 s lalu berputar lagi.
- Semua lewat sutradara dengan jangkar 1 dunia = senjata etalase (`sfx.show(gun, kind)`), jadi resep yang sama dengan di tangan.
- **Tembak:** 5 tembakan sesuai rpm jenis senjata terpilih (maks. 8/dtk) + `audio.previewShot` + `setVmGlow` kilat/panas.
- **Isi ulang** (tanpa tangan):
  1. Node `<jenis>_mag` turun 14 cm dalam 0,25 s.
  2. Hilang 0,2 s.
  3. Naik dan masuk 0,3 s dengan sedikit lewat.
  - Kejadian: `out` 0,05 s, `in` 0,75 s, `bolt` 1,05 s, memicu resep dan bunyi yang sama.
  - Senjata tanpa magasin: hanya resep di titik isi.
- **Finisher:**
  1. Kamera `aim('kill')` (mode yang sudah ada).
  2. Manekin latihan (satu `buildCharacter` bawaan, dibuat saat pertama dipakai, dibuang saat panel ditutup) berdiri di `killAt`, lalu berpose `dead`; finisher dimainkan di sana.
  3. Kamera kembali ke etalase setelah 2,4 s.
  - Ini sekaligus memperlihatkan pose mati tetap terlihat.

**Pratinjau kostum:**
- Siklus "Peragakan" dari `kostum.md` §4 dipakai.
- Pada detik `cheer` sutradara memainkan `fx.kill` kostum; saat "jalan" memainkan `step`.
- Chip kecil Kill · Isi ulang · Lari · Mendarat untuk memicu satu per satu.
- Sebelum kostum v2: karakter lobi yang sekarang + resep `legacy`.

**Tab ketiga "Bundel · N":**
- Kartu berisi dua gambar kecil (senjata + baju), nama set, harga = jumlah barang yang belum dimiliki.
- Detail: status tiap barang, keistimewaan, "Peragakan set" (karakter memakai kostum memegang senjata ber-skin; kill di senjata + reaksi kostum + finisher dengan bonus set).
- "Beli bundel · X" (dialog konfirmasi; koin dicek ≥ jumlah dulu, lalu dua `buy()`), "Pakai keduanya".
- Tidak ada tombol mati: tombol hanya dibuat bila datanya ada.

**`skinFeatures`:** chip "Efek tembak berbentuk", "Isi ulang bertema", "Animasi kill + finisher" (senjata); "Bereaksi: kill, isi ulang, lari, mendarat" (baju); "Bagian dari set …".

**Pengaturan:** baris "Efek skin" (Penuh / Ringkas / Mati).

---

## 6. Perubahan per file / fungsi

**`web/game/shapefx.js`, `fxshapes.js`, `fxlib.js` (baru):** §1. `createSkinFx({ scene, camera })` mengembalikan:
- `attachVm(vm)`, `setThemes(gunSkin, charSkin)`, `setLight({ sunDir, sun, sky })`, `setShade(k)`, `setLevel(0|1|2)`
- `fire(agent, kind, fp, muzzle, dir)`, `cue(agent, ck)`, `event(agent, 'equip'|'inspect')`, `hook(ev, a, b)`
- `wake(agent, from, dir, len)`, `impact(agent, p, dir, kind)`
- `kill(victim, n, head, byGun)`, `knock(victim, n)`, `costume(agent, ev, k)`
- `show(obj, kind)`, `demo(what, n)`
- `update(dt, view)`, `compile(renderer, rt)`, `warm()`, `stats()`, `rng`

Bila pembuatan melempar galat: objek tanpa-kerja dengan metode yang sama + satu `console.warn` (game tetap dimuat).

**`web/game/weapons.js`: tiga blok kecil saja.**
1. Baris 361–362: `SKIN` dan bawaan `setSkinFx` ditambah `hook: null, brass: null`.
2. `ejectCasing` (513), setelah `casV` dihitung: `if (SKIN.hook && SKIN.hook('casing', casV, kind)) return;` dan warna `C.shell ? SHELL : (SKIN.brass || BRASS)`.
3. Di objek yang dikembalikan, di samping `muzzleWorld` (1850): `anchors(out)`.
   - Mengisi `out.gun`, `out.mag`, `out.handL` (Matrix4 dunia adegan senjata), `out.kind`, `out.port` (Vector3 lokal dari `CASE`).
   - `false` bila tidak ada senjata tampil.
   - Tanpa alokasi.

- Tidak menyentuh `skinFxTick`, lini waktu, material, optik, atau bagian obat.
- `compile()` tidak perlu diubah; sutradara mengompilasi mesh-nya sendiri.
- Bila blok 3 belum ada (bentrok): cadangan `vm.muzzleWorld` + offset tetap.

**`web/game/player.js`** (`ctx.sfx` dari main):
- Baris 39: `cue: (k) => { audio.cue(k); ctx.sfx.cue(me, k); }`
- Setelah `vm.fire()` (400): `ctx.sfx.fire(me, w.inst.kind, fp, muz, fwd)`. Di orang ketiga, moncong dari `char.rig.b.gun.matrixWorld` × `muzzleLocal` (−x, y, −z).
- `reload()` (286): `ctx.sfx.costume(me, 'reload')`
- Langkah (999) saat `st.sprinting`: `'step'`
- Mendarat (990, 1100, 1112): `'land'` dengan kekuatan

**`web/game/skins.js`:**
- `initSkins(renderer, env, scene, camera, sfx)`.
- `applyEquipped`:
  - `setSkinFx({ …, cue: (ev) => { audio.skinCue(ev); SFX.event(null, ev); }, hook: SFX.hook, brass })`
  - `SFX.setThemes(gs, cs)`, `SFX.attachVm(vm)`, lalu `SFX.compile(R0, warmRT())` setelah `vm.compile`.
- `G()` dan `C()` menerima `fx`.
- 16 senjata + 13 kostum + 3 koleksi + `BUNDLES`, `bundleOf`, `bundleComplete`.
- `gunTheme` meneruskan `fx`.
- `skinFeatures` (§5).
- `warmSkinCache`: langkah awal `SFX.warm()` (atlas per irisan + `compileSkinAsync` mesh lapisan).

**`web/game/skinfx.js`:**
- `GUN_FX` 22–37 + cabang `#elif SF_GUN == n` (±8–14 baris per skin, memakai `sfScale4`, `sfVor`, `sfCarbon`, `sfN3` yang ada).
- Fungsi motif baru di `SKIN_COMMON` seperlunya: tatahan kerawang, kaustik, loreng bulu, ruas bambu, anyaman 1/1, zigzag celup.
- Cabang kill `uSfK` untuk skin baru mengikuti pola perban C.
- Tidak ada `sfChar` baru (kostum baru memakai pipeline kostum; cadangan = palet polos).

**`web/game/killfx.js`:**
- `createKillFx({ scene, hud, sfx })`.
- `kill(victim, head, w)`:
  - `byGun = !!(w && w.inst)`
  - `sfx.kill(victim, streak, head, byGun)` dan `sfx.costume(pemain, 'kill', streak)`, di samping `vm.killFx` perban C.
- `knock` → `sfx.knock`.
- `preview` → `sfx.demo`.
- Kolam `Points` lama (`pool`, `VS`, `FS`, `STYLES`) dihapus setelah M2 (tidak terpakai sejak 3215e6b).

**`web/game/audio.js`:**
- 12 resep `VOICES` (§4.2) + `KFAM`.
- `skinCue(ev)` menerima `out` / `in` / `bolt`: `playLayer(voice, 0.8, 0.14, 0.12)` / `(1.45, 0.22, 0.25)` / `(1.9, 0.12, 0.1)`.
  - Pemicu `'reload'` lama di u > 0,8 dihapus supaya tidak dobel.
  - Dipanggil dari `sfx.cue`.
- `finisher(nama, n, jarak, pan)`: lapisan suara skin diperlambat (rate 0,55) + ekor keluarga + 1–2 panggilan pembantu per tema; gain 1/(1 + d/25), tunda d/343.

**`web/game/main.js`:**
- `const sfx = createSkinFx({ scene, camera })` sebelum `kills` (185); diteruskan ke `createKillFx`, `ctx`, `initSkins` (576), `createLobby` (738).
- `fire()`:
  - setelah `fx.tracer` (238): `sfx.wake(shooter, dari, d, panjang)`;
  - lima `fx.burst(end, …)` (241–251) dibungkus pembantu lokal yang juga memanggil `sfx.impact(shooter, end, d, jenis)`.
- `kill()` (409): `kills.kill(t, part === 'head', w)`.
- `frame()`: `sfx.update(dt, view)` setelah `kills.update` (931).
- `sfx.setLight` di samping `player.vm.setLight` (589); `sfx.setShade(shade)` di samping `vm.setSun`.

**`web/game/lobby.js` / `lobby.css`:** §5; `stage.frame` memanggil `sfx.update(dt)`.

**`web/royale.html`:** naikkan `?v=` modul yang berubah.

**`.wt/_tools/serve.mjs`:** tambah `sfx` ke `NAMES` (alat, di luar repo).

**HANDOFF:** paragraf §35 (bahasa Indonesia) ditulis di laporan eksekutor, ditempel integrator.

---

## 7. Uji dan kriteria lulus

| # | Uji | Lulus bila |
|---|---|---|
| 1 | Lembar kontak atlas: tiap sel pada 256 px dan 16 px, per kanal + berwarna per palet | Tiap bentuk dikenali pada 64 px; eksekutor melihat sendiri; sel Merak ditunjukkan ke Steven |
| 2 | Filmstrip (waktu virtual, 8–12 frame per kejadian) per skin beranimasi: tembak (pinggul, ADS), isi ulang (kosong/taktis; AR, shotgun, revolver), cabut, periksa, kill n 1/3/5 (pinggul, ADS), knock, finisher n 1/3/5; orang pertama, orang ketiga, etalase | Di tiap frame kejadian ada ≥ 1 kartu ≥ 24 px; bentuk khas terbaca; antar-skin jelas beda; Merak: mata bulu terlihat |
| 3 | Anti-titik: dari buffer instans + kamera dihitung tinggi layar tiap kartu hidup, 600 frame tembak + 20 finisher pada 5/15/30/60 m | 0 kartu tergambar < 6 px |
| 4 | Tanpa efek: `gun_default`, biasa, 500 tembakan bot, 20 kill bot, kill granat/kendaraan | `sfx.stats().emitted` tidak naik (langka: hanya dampak) |
| 5 | Zona bersih bidikan: lapisan efek digambar sendiri ke target kecil selama 100 tembakan (pinggul + ADS) + kill | 0 piksel kartu dalam radius 5 % tinggi layar dari pusat; scope 4×/8×: 0 instans VM |
| 6 | Keterbacaan finisher pada 5/15/30/60 m (FOV 75, 1280×720), beda terhadap frame tanpa efek | Tinggi kotak efek ≥ 25 px di 60 m dan ≥ 40 px di 30 m; kontras rata-rata ≥ 40/255; terlihat 1,5–2,2 s; kotak badan korban tertutup kartu potong ≤ 15 % setelah 0,6 s; kotak peti ≤ 10 % kapan pun; `alive = 0` setelah 2,4 s |
| 7 | GPU: kueri waktu (min-of-24 berselang, 2268×1350), "Efek skin" Penuh vs Mati | Tembak beruntun ≤ +0,15 ms; puncak finisher legendaris dari 5 m ≤ +0,30 ms; peragaan lobi ≤ +0,30 ms; diam: draw call sama dengan pembanding |
| 8 | CPU dan alokasi: 1000 sampel `sfx.update`; sampling heap CDP 20 s skenario terburuk | Rata-rata ≤ 0,02 ms; emisi terbesar ≤ 0,15 ms; 0 byte dialokasikan fungsi `shapefx.js` / `fxlib.js` |
| 9 | Batas keras: tembak otomatis + 3 finisher + isi ulang serentak | Puncak ≤ 96 VM / ≤ 384 dunia; ≤ +4 draw call; ≤ +3,9 rb segitiga |
| 10 | Program shader: `renderer.info.programs.length` sebelum tembakan pertama vs setelah seluruh matriks kejadian + ganti tingkat Ultra ↔ Hemat | Sama |
| 11 | Atlas: waktu bangun di lobi dan saat mulai | Irisan ≤ 8 ms, p95 frame lobi ≤ 16,7 ms; penyelesaian saat mulai ≤ 100 ms; tekstur ≤ 9 MB |
| 12 | Tahan gagal: satu penggambar sel melempar galat; `createSkinFx` melempar galat; profil lama | Game masuk lobi dan pertandingan; hanya `console.warn` |
| 13 | Suara: render luring tiap `VOICES` baru | Pusat spektrum beda ≥ 8 % atau korelasi amplop < 0,9 terhadap semua suara lain |
| 14 | Toko: tombol peragaan, bundel | Koin berkurang tepat jumlah harga; tanpa tombol mati; 0 error konsol |
| 15 | Katalog: lint data + metrik §5.3 `kostum.md` | Tidak ada pasangan (bentuk tembak, finisher) kembar; kostum: tidak ada pasangan dengan (1 − IoU) < 0,18 dan ΔE < 22 sekaligus |

Semua kait uji tetap di `.wt/_tools`.

---

## 8. Milestone (tiap milestone bisa dikirim sendiri)

**M0: pembanding (tanpa perubahan repo).**
- Filmstrip "sebelum" Merak (tembak, isi ulang, kill).
- Waktu GPU pass view-model.
- Cocokkan nama API perban C dan `gunPoints` senjata v6 dengan yang sudah masuk main.

**M1: etalase Merak (gerbang visual Steven).**
- Mesin `shapefx.js`.
- 7 sel atlas (`bulu_merak`, `bulu_kecil`, `mata_merak`, `serat`, `cincin`, `garis`, `kilau4`) + palet `merak`.
- Sutradara + semua kait (§6).
- `gun_reog` lengkap (§2.1) dan `char_warok` (§3.2, jalur `legacy`).
- Bunyi finisher dan bunyi isi ulang bertema.
- Toko: "Lihat efek" 4 tombol, manekin, pratinjau reaksi kostum, kartu "Set Merak".
- Pengaturan "Efek skin".
- Uji 1–12 untuk Merak.
- **Kirim ke Steven:** filmstrip tembak / isi ulang / kill 1-3-5 / finisher 5-30-60 m + lembar atlas. Tema lain menunggu persetujuan.

**M2: konversi yang ada.**
- M2a legendaris: Garuda, Magma, Plasma + baju Garuda, Reaktor.
- M2b epik: Es, Neon, Songket, Keris, Petir, Holo, Mutiara + baju Magma, Es, Neon, Batik, Empu, Kencana.
- Dampak bertema untuk 7 skin langka lama; kartu bundel untuk pasangan lama; hapus kolam `Points` di killfx.

**M3: gelombang 1 (baru).**
- Kayon + Punggawa, Terumbu + Manta, Maung + Pendekar, Angklung + Mang Angklung; plus Komodo + Ranger, Lurik.

**M4: gelombang 2.**
- Phinisi + Nakhoda, Cendrawasih + Penari, Api Biru + Penjaga Kawah, Tari Piring + Penari Piring; plus Rotan.

**M5: gelombang 3 + penutup.**
- Jepara + Gebyok, Perak + Perak Kotagede, Layang + Pelayang, Rempah + Saudagar; plus Sasirangan.
- Paragraf HANDOFF §35; ukur akhir.

**Urutan dan ketergantungan:**
- Senjata tiap gelombang bisa terbit tanpa menunggu kostum.
- Kostum baru menunggu pipeline kostum: epik butuh pegas (kostum M3), legendaris butuh mech (kostum M5).
- Produksi kostum satu berkas per kostum, jadi bisa diparalelkan.

### Risiko dan cadangan
| Risiko | Cadangan |
|---|---|
| Bentuk gambar-kode kurang bagus (bulu merak tampak kaku) | Gerbang lembar atlas sebelum integrasi. Cadangan: kartu dimodelkan di Blender dan SDF dipanggang ke `web/game/assets/fx/shapes.png` (≤ 400 KB, batas waktu muat 6 s, gagal → bentuk kode). |
| Bulu menutupi bidikan / layar ramai saat tembak otomatis | Zona bersih, pengurangan ADS, batas 12 kartu hidup, setelan Ringkas; uji 5 |
| Dari jauh kembali jadi bintik | Aturan 6 px + LOD jarak + hero min 3,5 %; uji 3 dan 6 |
| Isi piksel besar saat kill jarak dekat | Penjaga dekat-kamera dan tinggi layar maks. 35 % (hero 70 %); uji 7 |
| `weapons.js` bentrok dengan agen senjata/perban | Hanya 3 blok kecil. Sumber kejadian lewat `props.cue` dan `SKIN.cue` yang sudah ada (di player.js / skins.js). Tanpa blok `anchors` pun efek moncong tetap jalan lewat `muzzleWorld`. |
| API perban C berbeda dari rencana | Sutradara tidak memanggil `vm.killFx`; hanya berbagi pemicu di `killfx.kill`. Yang perlu dicocokkan cuma nama bidang katalog. |
| Senjata v6 mengubah titik moncong/magasin/port | Titik dibaca saat jalan dari `gunPoints` / node; tabel cadangan hanya bila node hilang |
| Kostum v2 belum ada saat M1/M2 | Jalur `legacy` (kartu dari tulang). Saat kostum v2 aktif, resep `legacy` otomatis dilewati supaya kipas/sayap tidak dobel. |
| `renderer.compile` tidak mengompilasi mesh tak terlihat | `sfx.compile` menyalakan mesh sementara dan mengompilasi dua varian target secara eksplisit. Saya belum mengecek sumber three r160 untuk ini. |
| Tanpa post (Hemat) warna HDR salah | Shader menyertakan chunk tonemapping + colorspace; varian layar ikut dikompilasi; uji 10 |
| Keberatan budaya atas satu tema | Daftar larangan §4.5; tema yang diragukan (Kayon) punya cadangan abstrak; tiap gelombang ditunjukkan dulu |
| Ukuran `skinfx.js` membengkak (16 cabang `SF_GUN`) | Hanya varian skin terpakai yang dikompilasi (mekanisme lama); cache lobi bertambah 16 langkah |

### Critical Files for Implementation
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/skins.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/weapons.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/killfx.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/main.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/lobby.js

Berkas baru yang dibuat eksekutor: `web/game/shapefx.js`, `web/game/fxshapes.js`, `web/game/fxlib.js`. Rencana yang harus dicocokkan: `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/.wt/_plans/perban.md` (bagian C), `senjata.md`, `kostum.md`.