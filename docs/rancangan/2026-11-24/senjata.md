
# Rancangan perombakan senjata + scope Sutera Royale (untuk dieksekusi Opus di worktree)

## 0. Yang belum saya kerjakan (baca dulu)

- **Tidak ada screenshot baru dan tidak ada angka kinerja baru.** Mode saya read-only ketat (dilarang membuat file apa pun, termasuk di scratch), jadi harness Chrome/CDP dan Blender tidak dijalankan. Tidak ada proses yang perlu di-park atau dimatikan; folder `design-senjata` tidak dibuat.
- **Penilaian visual** memakai screenshot agen `anim` tanggal 18 Nov (GLB yang sama dengan main): `.wt/_shots/anim/hold/game/after-*.jpg`, `sniper-dbgL.jpg`, `.wt/_shots/skins/lob_gun_magma.jpg`, `preview/weapons/v4-lineup.png`.
- **Pembanding kinerja** hanya hitungan statis dari GLB. Pengukuran GPU sungguhan menjadi M0.
- **Zip MakeHuman tidak diunduh** (HEAD = 200). Penilaiannya di bawah berdasarkan halaman daftar aset saja.

## 1. Temuan kondisi sekarang

**Bentuk senjata.** Receiver = kotak, handguard = prisma segi delapan polos, popor = balok. Tidak ada rel bergerigi, slot, pin, atau baut. Aksen emas ada di hampir semua bagian sehingga terkesan mainan. Saat ADS, blok belakang menutupi sepertiga layar.

**Scope terpasang** (`buildScope`, weapons.js 864–882):
- `CylinderGeometry` terbuka + 2 torus + satu `BoxGeometry` dudukan.
- Memakai `MeshStandardMaterial` polos, bukan material view-model: tanpa AO, tanpa aus, tidak ikut skin.
- Scope 8× tidak punya model sendiri (`L`/`R` hanya membedakan 4 dan bukan 4).
- Elang/Rajawali memakai teropong bawaan yang dipotong per segitiga saat runtime (592–614, `WEAPONS.*.rail`).

**Tampilan teropong 4×/8×.** `root.visible = !o.scoped` (weapons.js 1698) menyembunyikan seluruh senjata, lalu overlay CSS `.h-scope` (royale.css 345–348) menggambar lubang gradien radial, dua garis 1 px, dan titik merah 6 px. Tidak ada rumah scope, bayangan, eye-box, atau goyang.

**Angka statis `weapons.glb`:**
- 5.213.024 byte, 86 node, 134.598 segitiga, tanpa tekstur, ±37 byte per segitiga.
- Senjata LOD0 4,4–9,8 rb segitiga; tangan ±54 rb total; LOD1 hanya 72–264 segitiga, dan itu yang tampil di orang ketiga, loot, dan bot.
- Draw call view-model untuk Garuda: badan 7 + magasin 4 + tangan kiri 7 + tangan kanan 8 = 26.

**Ketergantungan yang ditulis tangan** (harus jadi data):
- weapons.js: tabel `CH` (titik kokang, ±908), port shotgun, pemisahan slide pistol `y > 0,0618` (±932), `rail`.
- rig.js: tabel `GRIP` (139–142).
- loot.js: silinder scope (97).
- skins.js `worldGunMaterial`: menebak kelas bahan dari warna verteks.
- icons.js: memuat GLB untuk kedua kalinya (165).

**Sumber aset:**

| Sumber | Temuan | Keputusan |
|---|---|---|
| Poly Haven (522 model) | Hanya 2 senjata api: `bolt_action_rifle_7_62` (19.985 poligon, tekstur 8k, ber-tag "scope") dan `service_pistol` (27.548 poligon; glTF 1k = bin 1,05 MB + tekstur 2,2 MB). CC0, bergaya antik/usang. | Tidak dipakai di game. Hanya 2 dari 11, replika senjata sejarah nyata, dan albedo bertekstur tidak cocok dengan 22 skin prosedural. Boleh diunduh ke scratch sebagai acuan kerapatan detail saja. |
| MakeHuman equipment02 | `jaldmic_akm_base`, `_l1a1`, `_m1911a1`: aset "clothes" bernama tipe senjata nyata. | Ditolak karena aturan orisinalitas, apa pun kualitasnya. |
| Quaternius | Low-poly kartun. | Ditolak. |
| ambientCG | Terjangkau (200). | Tidak dipakai. Senjata tetap tanpa tekstur: detail dari geometri + shader, supaya skin dan anggaran ukuran aman. |

**Keputusan inti:** semua senjata dan optik dimodelkan sendiri di Blender secara prosedural dengan toolkit baru. Tanpa bake normal/high-poly: taruhannya ada di geometri mid-poly dengan bevel berjenjang dan normal berbobot, ditambah detail shader. Bake normal butuh UV + tangen + ±1 MB tekstur per senjata, melampaui anggaran, dan berisiko tinggi tanpa mata manusia.

## 2. Kontrak rangka tetap (supaya animasi, IK, dan skin tidak rusak)

Tidak berubah untuk semua senjata:
- Asal = titik genggam kanan; gagang condong 18° dengan selubung gagang yang sama (relief ≤ 1 mm, jadi `fp_hand_r` tidak perlu dipas ulang).
- Laras −Z, kanan +X.
- Tinggi sumbu laras (`muzzle.y`) dan posisi lubang magasin (`mag.pos`) tetap ±3 mm.
- Nama node lama tetap.

Boleh berubah (dibaca dari data): `muzzle.z`, titik bidik, penampang pelindung tangan. `build_hand_l_fit` sudah memasang ulang tangan kiri otomatis lewat sinar.

**Node GLB v6 (tambahan):**
- `pistol_slide`: menggantikan pemisahan runtime.
- `<jenis>_buis_up` / `_buis_dn` untuk smg, pdw, lmg, dmr, sniper: pisir lipat tegak/rebah. Pada ar dan burst pisir rebah menyatu dengan badan.
- `<jenis>_lod2`.
- Empty baru:
  - `<jenis>_optic`: titik pasang di puncak rel.
  - `<jenis>_eject`.
  - `<jenis>_charge`: menggantikan tabel `CH`.
  - `shotgun_port`.
- Optik: `opt_rds`, `opt_holo`, `opt_s2`, `opt_s4`, `opt_s8`, `opt_s8_ring` (cincin zoom), masing-masing dengan `opt_<id>_eye`, `opt_<id>_obj`, dan `opt_<id>_lod1`. Asal optik = titik pasang rel.
- Teropong bawaan DMR/runduk dihapus dari badan; `WEAPONS.*.rail` dihapus.

**weapons.json v6** (runtime sekarang ikut memuatnya, toleran bila gagal):
- `version: 6`.
- `weapons[]` bertambah:
  - `grip: { r, l, lNode, lAxis }` — `l` = pusat telapak kiri = `guard` lama; kunci `guard`/`handR`/`handL` tetap ada.
  - `optic: { pos, default: 'rds' | 'holo' | null }`.
  - `sightIron`, `eject`, `charge`, `lod2`, `lod2Tris`, `bbox`.
- `optics: { <id>: { node, eye, obj, lensR, objR, axisH, fill, relief, win?, tris, lod1 } }`.
- Inilah data bersama untuk agen pratinjau toko.

**Material.** Nama lama dipertahankan seluruhnya. Tambahan hanya tiga:
- `steel`: baja poles (bolt, mahkota laras), `VM_CLS` 1.
- `rubber`: bantalan popor, eyecup; `VM_CLS` 3 dan `VM_KIND` baru 7.
- `lens`: kaca optik berlapis, tidak di-skin.

Emas dibatasi ≤ 2 % luas (satu garis identitas per senjata). Warna verteks LOD tetap mengikuti konvensi tebakan `worldGunMaterial`: emas jenuh, kayu cokelat, karet linear < 0,02.

## 3. Daftar per senjata

Segitiga LOD0 termasuk bagian bergerak. LOD1 dipakai karakter pemain, lobi, dan ikon; LOD2 dipakai bot dan loot.

| Senjata | Kelas acuan generik | Detail yang ditambah | LOD0 / LOD1 / LOD2 |
|---|---|---|---|
| P9 | Pistol 9 mm rangka polimer striker, ±190 mm | Slide bergerigi depan-belakang, lubang ejeksi + ekstraktor, rel aksesori bawah, pisir 3 titik (`dot`), tuas & pin, stipple gagang, dasar magasin | 14k / 1,0k / 250 |
| Kobra | Revolver aksi ganda 6 peluru, laras 4" underlug penuh | Rusuk berventilasi, silinder beralur + takik pengunci, batang ejektor, martil, baut pelat samping, gagang kayu | 16k / 1,1k / 250 |
| Kilat | SMG 9 mm receiver tabung, popor lipat samping | Rel atas bergerigi, handguard pendek berslot, tuas kokang kiri + alur, engsel popor, las/paku keling, magasin lurus beralur | 22k / 1,6k / 350 |
| Lebah | PDW ringkas, popor dua batang tarik | Rel atas, penahan tangan depan, peredam kilat kecil, pemilih tembak, aksen kuning hanya di magasin/pemilih | 20k / 1,5k / 350 |
| Garuda | Karabin modular piston gas 14,5", upper monolitik | Rel atas penuh, handguard free-float berslot 3 sisi, blok gas, forward-assist, pintu debu, pin takedown, popor teleskopik + bantalan karet, magasin lengkung berusuk, peredam kilat sangkar; optik bawaan `opt_rds` | 30k / 2,4k / 450 |
| Petir | Karabin cangkang polimer monokok bersudut | Cangkang berfaset (bevel bentuk 3 mm), rel menyatu, jendela pendingin, popor lipat rangka, magasin lurus berjendela (opak); optik bawaan `opt_holo` | 26k / 2,2k / 400 |
| Badai | Shotgun pompa 12 ga | Tabung magasin + klem laras, pompa polimer berusuk, port isi + pengangkat, rusuk laras + bead, popor polimer + bantalan karet, pelindung panas berlubang | 20k / 1,8k / 400 |
| Gada | Laras ganda patah-buka, laras pendek | Dua laras + rusuk tengah, pelat samping berukir generik, dua pelatuk, tuas atas, engsel, kayu popor & forend | 14k / 1,3k / 300 |
| Elang | DMR semi-otomatis 7,62, laras 18–20" | Handguard panjang berslot, laras medium + rem moncong 2 port, popor presisi (penyangga pipi & baut setel), magasin lurus 10 peluru, stud bipod, rel penuh, BUIS lipat | 30k / 2,4k / 450 |
| Rajawali | Runduk bolt sasis | Laras berat beralur 6 + rem moncong, sasis zaitun dengan potongan peringan, tuas bolt berbonggol knurl, magasin kotak 5, bipod terlipat, popor lubang jempol dengan setelan, rel 20 MOA, BUIS | 30k / 2,4k / 450 |
| Gempa | SMR berpengumpan kotak 75 | Penutup atas + rel, gagang angkut, laras ganti-cepat + pelindung panas berlubang, blok gas, bipod terlipat, kotak peluru zaitun dengan kait, popor rangka | 32k / 2,5k / 450 |

Total LOD0 ±254 rb segitiga. Keausan: titik panas per senjata (moncong, lubang ejeksi, lubang magasin, tuas) mengatur kanal aus.

## 4. Optik

Semua optik = node sendiri di rel, dengan material view-model sehingga ikut AO, aus, dan skin. Tinggi sumbu dari puncak rel: rds 30 mm, holo 32, s2 34, s4 38, s8 40. `ATTACH.fits` tidak berubah (tanpa perubahan gameplay).

| Optik | Bentuk | Retikel (shader, orisinal) | Segitiga LOD0 / LOD1 |
|---|---|---|---|
| `opt_rds` 1× (bawaan Garuda) | Tabung 30 mm × 70 mm, tudung lensa, dudukan rendah satu cincin + kenop baut silang, turret baterai berknurl, 2 tutup setelan | Titik 1,2 mrad HDR + halo | 4k / 250 |
| `opt_holo` 1× (bawaan Petir) | Rumah kotak bertudung, jendela 30 × 23 mm, tuas QD, tombol belakang | Cincin terputus 4 kuadran + chevron tengah | 4k / 250 |
| `opt_s2` 2× | Prisma ringkas 110 mm, badan 38 mm, dasar menyatu 2 baut silang, eyecup karet pendek, turret rendah | Tapal kuda + titik + 3 tanda jatuh peluru | 6k / 300 |
| `opt_s4` 4×32 | 150 mm, tabung 30 mm melebar ke objektif 32 mm, blok turret persegi, cincin diopter, armor karet okuler, dudukan menyatu | Chevron + tangga mil + kurung jarak | 9k / 400 |
| `opt_s8` 4–8× | Tabung 34 mm, lonceng objektif 50 mm, ±330 mm, 3 turret (elevasi tinggi berknurl + garis indeks, windage bertutup, paralaks samping), `opt_s8_ring` bersirip, tudung matahari pendek, tutup lensa flip terbuka, 2 cincin dengan 4 baut | Pohon mil (FFP: ikut zoom) | 12k / 600 |

Lensa: material `lens` berlapis (tint magenta/hijau menurut sudut, pantulan lingkungan kuat); objektif rds berlapis jingga.

Senjata ber-rel tanpa optik membidik lewat BUIS tegak. Dengan optik, BUIS rebah. Loot `x_s2/4/8` memakai `opt_*_lod1`.

## 5. Tampilan ADS

**Keputusan: satu render + rumah scope 3D + shader lensa + mask di post.** Tidak render-to-texture: render dunia kedua menggandakan pass termahal di mesin yang dipakai bersama. Kamera dunia tetap di-zoom penuh seperti sekarang. View-model (kamera tetap 54°) tidak lagi disembunyikan, jadi rumah okuler menjadi bingkai.

**Pose bidik.**
- Titik mata E = `optic.pos + optics[id].eye`; tanpa optik, E = `sightIron`.
- `adsP = [−E.x, −E.y, −d − E.z]`.
- Relief d = `lensR / (fill · tan 27°)`, dijepit 0,035–0,11 m.
- `fill`: s2 0,40; s4 0,72; s8 0,78. rds/holo d = 0,16. Pisir besi d = 0,26 seperti sekarang.

**Shader lensa** (`ShaderMaterial` transparan pada cakram di `_eye`; holo memakai bidang jendela; digambar di pass view-model sehingga ikut bloom dan tonemap):
- Retikel SDF di ruang sudut: `p = (gl_FragCoord.xy − pusatLayar) / pxPerMrad`, dengan `pxPerMrad = (H/2) / tan(fov/2) · 0,001` dari `camera.fov` aktual. Anti-alias `fwidth`, jadi tajam di resolusi dan skala render apa pun.
- Retikel selalu di pusat layar = arah peluru. Ini memberi sifat bebas paralaks untuk 1× dan subtensi mil yang benar untuk 8×.
- Eye-box: `e = (pusatLensa − pusatLayar) / radiusLensa`, dihitung di vertex shader dari proyeksi asal mesh. Bayangan hitam `smoothstep` pada `|q + e·K|`, K = 2,2 (s4/s8) atau 1,2 (s2). Ayunan, sentakan, dan gerak memunculkan sabit bayangan di sisi berlawanan.
- Saat masuk bidik, radius jernih = `mix(0,35, 1, ads²)`, sehingga lingkaran membuka.
- Lain-lain: cincin gelap tepi tetap, pinggiran kromatik 1,5 px, debu samar, kabut silau aditif 0–0,12 bila matahari di depan (`uSun`).
- Titik/garis berpendar memakai warna HDR. Mesh `dot` bola lama di optik dihapus.

**Mask di post** (`compMat`, satu uniform `uScope = (cx, cy, r, kuat)`, cabang dinamis, tanpa varian shader baru):
- Di luar lingkaran: blur cakram 8 tap, radius 0→6 px.
- Piksel dunia (kedalaman > `VMD`) digelapkan ×0,3; piksel senjata ×0,75.
- `kuat`: 0 (1×), 0,35 (2×), 1 (4×/8×).
- Mode Hemat (tanpa post): mesh cincin hitam alfa 0,75 di bidang okuler.

**Lain-lain:**
- Sentakan view-model ×0,25 saat memakai 4×/8×.
- `.h-scope` hanya cadangan bila optik atau GLB tidak ada.
- Bidikan HUD disembunyikan untuk semua optik berlensa; pisir besi tetap titik putih.
- Goyang napas (ubah arah bidik sungguhan): offset yaw/pitch Lissajous, amplitudo 0,10° × zoom/8 pada 8×, 35 % pada 4×, ×0,5 jongkok, ×0,25 tiarap.
- Tahan napas dengan Shift (aman: lari sudah mati saat bidik, player.js 927): amplitudo ×0,15 maksimal 4 dtk, lalu 2 dtk ×1,6.
- Offset dipasang di satu helper yang dipakai kamera dan `fire()`, tidak diakumulasi ke `st.yaw`. Eksekutor wajib memeriksa dari mana arah tembak diambil.

## 6. Pipeline Blender

**File.** `tools/blender/gunkit.py` (baru; diimpor `weapons.py` lewat `sys.path.insert(0, HERE)`) dan `tools/blender/weapons.py` v6.

**Isi gunkit:**
- `plate(outline_yz, lebar, radius_sudut, chamfer)`: siluet samping 2D diekstrusi. Ini pengganti kotak untuk receiver dan popor.
- `loft_y` / `superellipse` yang sudah ada, untuk gagang, popor, dan handguard.
- `cut(obj, cutter)`: modifier boolean EXACT untuk slot, lubang ejeksi, potongan peringan, alur laras/silinder, port rem moncong.
- `picatinny(panjang)`: lebar 21,2 mm, ekor burung 45°, alur 5,35 mm, jarak 10,0 mm, dalam 3 mm.
- `screw(hex|torx|slot, d)`, `pin`, `rivet`, `sling_loop`, `knurl_straight` (geometri, untuk turret), `barrel(profil, flutes)`, `muzzle_device(tipe)`, `groove(0,4 mm)` (garis panel), `lens(r, cembung)`, `ring_mount`.

**Tiga jenjang bevel:**
1. Bevel bentuk 1–4 mm, 2–3 segmen, pada himpunan tepi terpilih.
2. `micro_bevel` yang ada (0,55 mm).
3. Modifier WEIGHTED_NORMAL yang ada.

**Bake.** `bake_vwx` diperluas: u = AO (sinar 12 → 16), v = aus kontinu = bidang bevel × kecembungan × bobot titik panas (`d['wear']`). Tetap `TEXCOORD_0`, tanpa UV dan tanpa atlas.

**Ukiran.** `engrave()` hanya penanda fiktif (nomor seri "SR-…", piktogram pemilih tembak).

**LOD otomatis** (`make_lod`): gabung badan + bagian → buang pulau kecil (< 6 mm untuk LOD1, < 20 mm untuk LOD2) → Decimate COLLAPSE ke target (LOD2 ditambah dissolve planar) → warna verteks dari `MAT[].col`. `build_lod1` tulisan tangan dihapus.

**Ukuran.** ±254k + optik 35k + tangan 54k + LOD ±30k ≈ 370 rb segitiga ≈ 14 MB mentah. Karena itu:
- Ekspor Draco: `export_draco_mesh_compression_enable=True`, kuantisasi posisi 14, normal 10, texcoord 10, warna 8.
- Runtime: `DRACOLoader` dengan `setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/')`, CDN yang sama dengan three.
- Target 3–5 MB, batas keras 8 MB.

**Opsi skrip:** `--kinds`, `--quick`, `--no-export`, `--out` tetap. Baru: `--sheet` (lembar kontak EEVEE per senjata: samping kiri/kanan, 3/4 depan, atas, ± tiap optik yang cocok) dan `--optics-only`. Selalu jalankan dengan `taskpolicy -b nice -n 19 … -b --factory-startup -t 2 -P`.

## 7. Perubahan runtime per file

**`web/game/weapons.js`**
- `loadWeaponModels`: pasang DRACOLoader; ambil `weapons.json` paralel (gagal → null); URL diberi `?v=6`.
- Ekspor baru: `weaponRoot()`, `weaponMeta(kind)`, `opticMeta(id)`, `gunPoints(kind)` → `{ muzzle, sight, guard, handR, optic, eject, charge }`, dan `assembleGun(kind, { optic, lod })`.
- `WEAPONS`: hapus `rail`. Tambah `OPTIC_DEFAULT = { ar: 'rds', burst: 'holo' }`.
- `gunGeometry(kind, lod = 1)`: membaca `_lod1` / `_lod2` (fallback berantai ke model prosedural).
- `VM_LOOK` + `VM_CLS`: tambah `steel` dan `rubber`.
- `vmMaterial('lens')`: kaca berlapis.
- `VM_FS_*`:
  - Kotoran di cekungan: `cav = 1 − vWx.x`, menggelapkan dan menambah kekasaran.
  - Stipple sel untuk kind 3; rusuk untuk kind 7.
  - Aus memakai `vWx.y` kontinu.
  - Kunci cache `'vm5'` → `'vm6'`.
- `gunPreview`: memakai `assembleGun`, dengan optik bawaan dan BUIS yang benar.
- `upgradeGun`:
  - Hapus blok pemisahan `rail` (592–614).
  - Kloning `_buis_up/_dn` dan `pistol_slide` (`G.slide` dari node; pemisahan runtime jadi fallback bila node tak ada).
  - Baca `_charge` / `_port` / `_eject`.
- Ganti `buildScope` / `SCOPE_DY` / `syncScope` dengan `mountOptic(G, kind, id)`: klon `opt_<id>` di `_optic`, `dressVm`, buat mesh lensa. Cache per senjata dan optik. `opt_s8_ring.rotation.z` mengikuti `inst.zoom`.
- `rigGun`: `CH[kind]` → `G.charge || CH[kind]`; port shotgun dari empty.
- `update()`:
  - `adsP` dari `eyePoint(G, scN)` (baris 1644).
  - Hapus `root.visible = !o.scoped`. Kilatan, selongsong, dan asap tetap disembunyikan saat 4×/8×.
  - Isi `vm.scopeMask` (proyeksi pusat dan radius lensa) dan uniform lensa (`uRes`, `uFov`, `uAds`, `uSun`).
  - Sentakan diredam saat scoped.
- `compile()`: ikutkan semua optik.
- `vm.setPost(on)`: cincin gelap cadangan.
- `skinFxTick`: nyala moncong tetap mati saat scoped.

**`web/game/postfx.js`**
- `compMat`: uniform `uScope` + cabang blur/gelap.
- `render(…, st.scope)`.

**`web/game/main.js`**
- Kirim `scope: view.scoped ? player.vm.scopeMask : null`.
- `addGearParts(… geo: gunGeometry(k, 1), crowdGeo: gunGeometry(k, 2))`.
- Panggil `setGrip` rig dari `gunPoints`.
- `hud.frame`: tipe bidikan `'optic'` untuk semua optik berlensa (baris 938).

**`web/game/player.js`**
- Kirim `fov: camera.fov` dan `zoom` ke `vm.update`.
- Goyang dan tahan napas.
- `scoped` tetap berarti scope ≥ 4.
- `GUN_GEAR` tidak berubah.

**`web/game/hud.js` + `royale.css`**
- `.h-scope` hanya tampil bila `vm.scopeFallback`.
- Bar napas kecil (opsional).

**`web/map/rig.js`**
- `addGearParts` menerima `crowdGeo`: `createCrowd` memakai `e.crowdGeo || e.geo`, `buildCharacter` memakai `e.geo`.
- Ekspor `setGrip(kind, r, l)` yang menimpa `GRIP`.
- Rumus pergelangan kiri dari data: `[0, guard.y − 0,089, −guard.z − 0,07]`. Rumus ini mereproduksi tabel sekarang ±3 cm (dicek untuk ar, dmr, sniper, smg).

**`web/game/lobby.js`**
- `gunShow`: lewat `previewWeapon` → `assembleGun`; etalase `SHOW_OPTIC = { sniper: 8, dmr: 4 }`.
- Skala dan kotak batas dihitung setelah optik terpasang.
- Tangan kiri pratinjau (agen lain) memakai `gunPoints` / `weaponMeta().grip`.

**`web/game/loot.js`**
- Senjata di tanah: `gunGeometry(k, 2)`.
- `x_s2/4/8`: geometri `opt_*_lod1` (fallback silinder lama).
- `itemGeometry` panel: LOD1.

**`web/game/icons.js`**
- Pakai `weaponRoot()` (tidak memuat GLB kedua kali).
- `silParts` lewat `assembleGun`, supaya BUIS tidak dobel dan optik bawaan ikut.

**`web/game/skins.js`**
- Tanpa perubahan logika: optik berada di bawah akar senjata sehingga ikut `applyGunSkin`; `lens` bukan anggota `VM_CLS`.
- Cek ulang ambang tebakan warna `worldGunMaterial` dengan palet baru.

**`web/royale.html`**
- Naikkan `?v=` modul yang berubah.

## 8. Uji dan kriteria lulus

**Pembanding (M0, sebelum mengubah apa pun).**
- Harness port 8824 / 9324 / 9424 dengan sumber `web/` main (hanya baca).
- Matriks 11 senjata × (pinggul, ADS tanpa aksesori, ADS tiap scope yang cocok, tembak) + orang ketiga + etalase + loot.
- `renderer.info.render.calls` dan segitiga khusus pass view-model.
- Waktu GPU pass view-model lewat `EXT_disjoint_timer_query_webgl2`, min-of-24 berselang pada 2268×1350 (metode §29).
- p95 frame 1 vs 100 pada tingkat Ultra dan Hemat.

**Lembar kontak.**
- Blender `--sheet` tiap senjata ± optik.
- Browser: matriks yang sama sesudah perubahan, dimontase sebelum/sesudah.
- 22 skin × 3 senjata (ar, sniper + s8, pistol), orang pertama dan dunia.
- Filmstrip isi ulang 8 senjata, kokang bolt, pompa (alat agen anim).

**Kriteria lulus.**
- Konsol tanpa error; GLB diblokir → game tetap bisa dimuat (model prosedural + overlay lama).
- Retikel tepat di pusat layar ±1 px pada semua optik, FOV, dan rasio layar. Peluru di jarak 100 m jatuh di pusat retikel.
- Tepi retikel ≤ 1,5 px pada skala render 0,9.
- Tidak ada geometri terpotong near-plane di dalam lingkaran lensa.
- Tangan kiri: ujung jari tidak menembus (cek dbgL / dbgFL / dbgB / dbgR, 11 senjata). Ujung lengan baju terlihat 0 frame.
- View-model: ≤ 45 draw call (pembanding statis 26); waktu GPU pass ≤ pembanding + 0,4 ms; scoped 4×/8× (lensa + mask) ≤ pembanding hip + 0,6 ms.
- p95 frame 1 vs 100 tidak naik > 3 %.
- Tidak ada program shader baru setelah pertandingan mulai.
- `weapons.glb` ≤ 8 MB (target ≤ 5); waktu dekode ≤ 400 ms.
- 22 skin: tidak ada bagian badan yang tetap berwarna pabrik; lensa dan retikel tidak ikut skin.
- Gerbang visual: lembar kontak tiga senjata perintis ditunjukkan ke Steven sebelum delapan sisanya.

## 9. Milestone (masing-masing bisa dikirim sendiri)

**M0 — Pembanding dan kelayakan.** Tanpa perubahan repo.
- Screenshot dan ukuran pembanding.
- Uji Draco: ekspor GLB sekarang dengan Draco ke scratch, muat lewat harness.
- Baca `fire()` untuk jalur arah tembak; cek cara loot di-instans.

**M1 — Optik + tampilan ADS.** Ini langsung menjawab "pake scope jadi jelek bener".
- gunkit minimal: `picatinny`, `lens`, `ring_mount`, `knurl`, `screw`.
- 5 optik + LOD1.
- Rel + BUIS pada 7 senjata ber-rel; teropong bawaan Elang/Rajawali dan red dot Garuda/PDW dicabut dari badan.
- `mountOptic`, shader lensa, mask post, goyang napas, loot scope, `weapons.json` v6 + `gunPoints`.
- Badan senjata lain belum berubah. GLB ±6,5 MB tanpa Draco.

**M2 — Toolkit penuh + shader detail + tiga perintis.**
- Garuda, P9, Rajawali.
- Shader: kotoran cekungan, stipple, aus kontinu.
- Draco aktif.
- Gerbang Steven.

**M3 — Delapan senjata sisanya.** Urutan: Elang, Gempa, Petir, Kilat, Lebah, Badai, Gada, Kobra.

**M4 — Model dunia.** LOD1/LOD2 otomatis, `crowdGeo`, `setGrip` dari data, loot, ikon, satu kali muat GLB.

**M5 — Poles.** Etalase dengan optik, cincin zoom, tutup lensa, opsional `<jenis>_magx` (magasin panjang yang terlihat), HANDOFF §35 dalam bahasa Indonesia, ukur akhir.

## 10. Risiko dan cadangan

| Risiko | Cadangan |
|---|---|
| Hasil prosedural masih "kotak" | Gerbang M2 dengan tiga perintis. Aturan: dilarang `p_box` untuk receiver/popor/handguard (wajib `plate`/loft + bevel bentuk). Poly Haven jadi pembanding kerapatan detail. |
| Draco tidak ada di build Blender, atau dekoder CDN gagal | Pecah jadi `weapons.glb` (orang pertama) + `weapons_world.glb` (LOD) tanpa Draco, dengan LOD0 diturunkan ±30 %. Atau simpan dekoder di `web/game/assets/draco/` (diunduh dari jsdelivr). |
| Boolean EXACT gagal atau lambat | Slot dibuat dengan inset + extrude; boolean hanya untuk port besar. Waktu bangun ≤ 5 menit. |
| Tangan kiri menembus bentuk baru | Kulit cembung `build_hand_l_fit` diberi topeng: abaikan slot dan rel bawah. Uji dbg per senjata per milestone. |
| Rumah scope atau popor terpotong near-plane saat relief 4 cm | Naikkan d (turunkan `fill` ke 0,62), atau sembunyikan badan di luar optik saat `ads > 0,95` (mask post sudah menggelapkan). |
| Blur mask mahal di tingkat rendah | Tingkat `low`: hanya gelap tanpa tap blur. |
| Goyang napas mengganggu Steven | Satu konstanta amplitudo; matikan = 0. |
| Skin tampak salah di bahan baru | `steel` → kelas 1, `rubber` → kelas 3; lembar kontak 22 skin wajib di M2. |
| Bentrok dengan agen paralel (lobby.js, rig.js) | Perubahan saya di kedua file itu kecil dan aditif (`setGrip`, `crowdGeo`, `gunShow`). `gunPoints` / `weaponMeta` diterbitkan lebih dulu di M1 supaya agen toko bisa memakainya. |

## Default yang saya pilih (tidak ada pertanyaan yang memblokir)

- Garuda membawa red dot dan Petir membawa holo sebagai optik bawaan, bukan item loot baru.
- `ATTACH.fits` dan FOV tidak diubah.
- Retikel 8× FFP.
- Goyang napas aktif (8× penuh, 4× 35 %); tahan napas = Shift.
- Optik ikut skin senjata.
- Tanpa tekstur dan tanpa bake normal.
- Draco via CDN jsdelivr.

### Critical Files for Implementation
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/tools/blender/weapons.py
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/weapons.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/postfx.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/player.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/rig.js
