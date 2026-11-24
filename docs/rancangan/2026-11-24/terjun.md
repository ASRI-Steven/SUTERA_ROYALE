
# Rancangan perombakan animasi terjun — Sutera Royale

## 0. Status verifikasi (baca dulu)

- **Headless Chrome/CDP TIDAK saya jalankan.** Sesi saya dikunci read-only (dilarang membuat berkas apa pun, termasuk screenshot, log, profil Chrome). Tidak ada proses serve/cdpd milik saya yang perlu dimatikan; port 8822/9322/9422 tidak terpakai.
- **Yang sudah diperiksa:**
  - membaca kode di main @ 4edfede;
  - forward kinematics numerik (node, stdout saja) untuk semua pose di tabel §1 dengan offset tulang `makeBones()`;
  - simulasi integrator pegas (overshoot dan stabilitas di dt 1/120 sampai 0,25 dtk).
- **Yang belum:** tampilan nyata pose (kulit v3, kostum), lembar kontak "sebelum", dan baseline CPU. Semua itu jadi gerbang M0 untuk eksekutor. Angka pose di §1 perlu disetel ±0,1 rad setelah dilihat.
- **Tidak ada pertanyaan yang memblokir.** Default yang saya pilih ada di §10.

### Temuan di kode sekarang

- `web/map/rig.js` `pose()`:
  - terjun bebas statis (`hips.x 1,35`, lengan `ax −0,25 / az 1,35 / fx −0,45`, kaki `0,3 / 0,95`, kepala `−0,9`);
  - `neck` dan `hand*` tidak pernah diputar;
  - kaki saat terjun memakai `ft = −(tx+kx)·0,8 ≈ −1,0` (jari kaki tertarik ke tulang kering, bukan menunjuk);
  - saat payung, `look` (pitch kamera) ikut menekuk dada.
- `web/game/player.js`:
  - baris 1185–1189: seluruh root diputar `st.airLean` (balok kaku);
  - baris 1238–1239: kanopi hanya on/off;
  - `placeCamera` cabang udara (794–811) `return` sebelum guncangan, FOV selalu 75;
  - `me.yaw = atan2(vel)` meloncat seketika saat kecepatan melewati nol (S lalu A/D);
  - baris 1068–1076: saat mendarat `vel = 0` dan kamera langsung meloncat ke orang pertama.
- **Kemungkinan bug (cek di screenshot):** kanopi pemain tidak di-`rotateY(π)`, sedangkan bot di-rotate (`bots.js:266`). Menurut `tools/blender/props.py` `parachute()` tepi depan ada di −Z glTF dan karakter menghadap +Z, jadi kanopi pemain tampaknya terbalik.
- `bots.js` blok pose (1889–1890) hanya mengisi `freefall`/`chute`. Bot dipose tiap 1/3/6 frame dengan `pdt ≤ 0,25` dan tidak dipose di luar layar, jadi timer internal rig tidak bisa dipercaya untuk bot.
- `audio.windLevel(v)` hanya mengatur gain (bandpass tetap 900 Hz).
- `ALT = 620`; F membuka payung di bawah 700 m, artinya kapan saja.

## 1. Tabel pose (radian, konvensi rig.js)

**Konvensi (sudah diturunkan dari kode, urutan Euler XYZ = Rx·Ry·Rz):**
- Karakter menghadap +Z, kiri = +X.
- `hips.x`: + = kepala ke depan/bawah (π/2 = tengkurap). Saat tengkurap, `hips.y` + = miring kanan (bahu kiri naik), `hips.z` + = hidung ke kanan.
- Lengan: `ax` − = ke depan; `az·side` + = abduksi; `fx` − = siku menekuk. Dengan `az ≈ π/2`, `ax = −π/2` membuat lengan bawah menekuk ke arah kepala (box).
- Kaki: `tx` − = paha ke depan, `kx` + = lutut menekuk, `tz·side` + = membuka, `foot.x` + = jari menunjuk.

**Pose simetris** (kolom lengan/kaki berlaku untuk dua sisi; `armZ` dan `thighZ` dikali `side`):

| Pose | hipsX | spineX | chestX | neckX | headX | armX | armZ | foreX | thighX | thighZ | shinX | footX |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ARCH (netral) | 1,48 | −0,15 | −0,12 | −0,25 | −0,50 | −1,57 | 1,72 | −1,35 | 0,35 | 0,30 | 0,70 | 0,45 |
| TRACK (W, datar) | 1,62 | 0,05 | 0,10 | −0,30 | −0,80 | −0,12 | 0,38 | −0,08 | 0,08 | 0,10 | 0,08 | 0,60 |
| DIVE (W + menunduk) | 2,60 | 0 | 0,05 | −0,35 | −0,60 | 0,15 | 0,20 | −0,05 | 0 | 0,06 | 0,05 | 0,75 |
| BACK (S, rem) | 1,12 | −0,22 | −0,18 | −0,15 | −0,35 | 0,25 | 2,20 | −0,40 | −0,35 | 0,32 | 1,50 | 0,30 |
| EXIT_TUCK (lompat) | 0,30→0,90 | 0,35 | 0,25 | 0 | 0,20 | −1,10 | 0,45 | −0,90 | −1,25 | 0,12 | 1,70 | −0,20 |
| CANOPY netral | P=0,06 | 0,05 | 0 | 0 | 0,10 | −2,75 | 0,28 | −0,25 | −0,22 | 0,08 | 0,35 | 0,25 |
| CANOPY W (condong) | P=0,38 | 0,05 | 0,08 | 0 | −0,25 | −2,45 | 0,10 | −1,05 | 0,20 | 0,08 | 0,55 | 0,50 |
| FLARE (S) | P=−0,16 | −0,05 | 0 | 0 | 0,25 | −0,40 | 0,30 | −0,25 | −0,45 | 0,06 | 0,60 | −0,15 |
| JERK (sentakan, bobot j) | P dari pegas | 0,25 | 0,15 | 0 | 0,45 | −1,90 | 0,55 | −0,30 | −0,75 | 0,10 | 0,25 | −0,20 |
| ROLL tuck (mendarat C) | +2π·sstep | 0,45 | 0,45 | 0,30 | 0,50 | −1,20 | 0,25 | −1,70 | −1,90 | 0,15 | 2,20 | −0,30 |

`handX`: ARCH 0,10; BACK −0,30; lainnya 0 (kosmetik, setel di lab).

**Hasil FK** (ruang root, y = atas, z = depan; pinggul di y 0,98):
- ARCH: tangan (±0,54; 1,26; 0,75), pergelangan kaki y 1,42, dada 1,07. Pinggul jadi titik terendah, lengkung terbaca.
- TRACK: tangan (±0,41; 0,93; −0,03), jari kaki z −1,05.
- BACK: kepala y 1,60, lutut turun ke y 0,67.
- CANOPY: tangan (±0,36; 2,00; 0,22), di atas kepala (puncak 1,81).
- FLARE (dihitung dengan nilai sebelum penyetelan akhir: armX −0,50, foreX −0,30, thighX −0,55, shinX 0,75): tangan setinggi pinggul (y 1,13).
- JERK: kaki terlempar ke depan z ≈ 1,0.
- DIVE dihitung dengan hipsX 2,75; nilai tabel (2,60, leher/kepala lebih mendongak) belum dihitung ulang.

**Delta belok terjun bebas** (kanal `bank b`, + = kanan; `i = −side·b` → i > 0 = anggota badan sisi dalam):
- Badan (kanal bank): `hips.y += 0,20b`, `spine.y += 0,14b`, `chest.y += 0,14b`, `hips.z += 0,10b`. Root TIDAK lagi diputar.
- Lengan (kanal bankArm, mendahului):
  - `armZ −= (i>0 ? 0,35 : 0,20)·i`
  - `foreX −= (i>0 ? 0,30 : 0,45)·i`
  - `armX += 0,30·i`
- Kaki (kanal bankLeg, tertinggal): `shinX += 0,40·i` (min 0,05), `thighZ −= 0,10·i`, `thighX −= 0,12·i`.
- Semua delta dikali `(1 − 0,5·wDive)`.
- FK belok kanan b=1: tangan kiri y 1,49, tangan kanan y 0,97, lutut kiri 1,18 / kanan 1,00. Miringnya terartikulasi.

**Kemudi payung** (`c` = kanal steer, + = kanan), relatif CANOPY:
- Lengan dalam: `armX +1,20`, `foreX −1,50`, `armZ −0,13` (toggle ditarik ke bahu; FK tangan y 1,64).
- Lengan luar: `armX −0,15`, `foreX +0,13`.
- `spine.z += 0,08c`, `neck.y −= 0,35c`, `head.z = −0,5·roll` (kepala tetap rata horizon).
- Kaki dalam: `thighX −0,25`, `shinX +0,30`; kedua kaki `rotation.z += 0,10·bankLeg` (nilai mentah, tidak dikali side).

**Tarik payung (PULL)**, bobot bump 0–0,08 naik, 0,20–0,32 turun:
- armR `(ax 0,55; az·side 0,15; fx −1,30)`, armL `(−1,57; 2,60; −0,40)`.

**Mendarat:**
- Kompresi aditif `c(t) = K·(t/0,13)·e^(1−t/0,13)·(1−sstep(0,35; 0,55; t))`, meniru proporsi jongkok yang sudah ada:
  - `hips.position.y −= 0,40c`, `thighX −= 0,95c`, `shinX += 1,75c`, `footX −= 0,64c`, `spine.x += 0,30c`.
- A "serap" (K = 0,8): lengan `ax −0,6c`, `az 0,35`, `fx −0,5c`.
- B "lari kecil" (K = 0,45): langkahnya datang dari siklus jalan dasar karena kecepatan sisa (§4); lengan `az 0,6→0,11`.
- C "berguling": 0–0,12 kompresi K = 1 menuju ROLL tuck; 0,12–0,62 `hips.x += 2π·smoothstep`, `hips.position.y = 0,38`; 0,62–0,95 bangkit.

**Lihat kamera** (`ψ = clamp(lookYaw, ±0,9)`, memudar ke 0 bila |lookYaw| > 2,0; P = jumlah pitch hips+spine+chest):
- `neck.y += 0,5ψ·cos P`, `neck.z −= 0,5ψ·sin P`; `head` setengah sisanya dengan P+neckX.
- Di payung: `head.x −= 0,4·clamp(lookPitch, −0,8, 0,5)`. Dada tidak lagi ikut `look`.

**Getar angin** (`windK = clamp(airSpd/60, 0, 1,3)`, fase per rig; amplitudo × `clamp(1,5 − pdt·30, 0, 1)` supaya bot jauh tidak aliasing):
- `hand.x/z ±0,12·windK` (13 dan 17 Hz), `fore.x ±0,04` (11 Hz), `foot.x ±0,10` (9 dan 15 Hz), `shin ±0,03`, `head.z ±0,02`.
- Apung lambat 0,7–1,3 Hz: `hips.y ±0,035`, `hips.z ±0,03`, `armZ` antisimetris `±0,05`.
- Di payung: kaki `±0,12` pada 1,6 Hz (yang sudah ada) dan getar ×0,25.

## 2. Input pose baru (semua opsional; tanpa input perilaku lama)

| Input | Arti | player.js | bots.js (blok pose ±1889) |
|---|---|---|---|
| `airT` | dtk sejak keluar pesawat | `st.airT += dt` di `air()`, reset di jumpOut | `b.airT += dt` di `airStep`/`allyAir` (waktu simulasi) |
| `chuteT` | dtk sejak payung, −1 = belum | `st.chuteT` | `b.chuteT` (rekan: `max(0, chuteT − 0,12·slot)`) |
| `landT`, `landKind` | dtk sejak menyentuh tanah (−1 = tidak); 0 serap / 1 langkah / 2 guling | lihat §4 | `b.landT`; kind 0 bila flare, selain itu 1 |
| `airFwd` | −1..1 kontinu (W/S) | `iz`; mode ikut: 0,35 | jatuh: `d > 40 ? 0,35 : 0`; payung: `y < 12 ? −1 : d > 25 ? 1 : 0` |
| `airSide` | −1..1, + = kanan | `ix` | 0 |
| `airDive` | 0..1 | `dive` dari `air()` | `seed > 0,7 && y > 350 ? 0,4 : 0` |
| `airTurn` | rad/dtk, + = kanan (= −d yaw/dt, low-pass 6/dtk, clamp ±3) | dari `me.yaw` | dari `b.yaw` vs `b.pyaw`; 0 bila `airT < 0,3` |
| `airSpd` | m/dtk total | `hypot(|vel|, st.airVs)` | `hypot(hs, vs)` konstan per state |
| `airGnd` | tinggi di atas tanah/atap | `me.pos.y − rf` | `b.pos.y` |
| `lookYaw`, `lookPitch` | arah pandang kamera relatif badan (+ = kiri / atas) | `wrap(st.yaw − me.yaw)`, `st.pitch` | rekan: arah ke pemain; lainnya 0 |
| `airSeed` | 0..1 tetap per karakter | 0,5 | `b.i` di-hash |

- `chuteDrive` lama tetap dikirim. Overlay memakai `airFwd`.
- player.js blok render: hapus cabang `st.airLean` untuk root. Pakai `st.visYaw` (lerp sudut ke `me.yaw`, laju 8/dtk) untuk `char.root.rotation.y` dan kanopi, supaya loncatan `atan2` tidak terlihat. `me.yaw` sendiri tidak diubah.

## 3. Pegas (tanpa alokasi)

- Berkas baru `web/map/rigair.js`: `export function poseAir(rig, s, dt)`.
- State di `rig.A`, dibuat sekali saat pertama mengudara: `{ S: Float32Array(22), on, hx, seed, wind, … }`.
- Sentuhan di rig.js hanya 3 baris:
  1. import;
  2. `this.A = null` di konstruktor;
  3. tepat sebelum `this.updateWorld()`: `if (s.freefall || s.chute || s.landT >= 0 || (this.A && this.A.on)) poseAir(this, s, dt);`
- Pola overlay sama seperti tiarap/berenang: menimpa rotasi tulang dengan bobot. Blok `m.fall`/`m.chute` lama dibiarkan sebagai dasar; saat `landT ≥ 0` percepat `m.chute *= exp(−12dt)`.
- Saat overlay mati, `neck`, `hand*`, `hips.y/z`, `spine.y/z` dinolkan sekali.

**Integrator implisit** (stabil di dt berapa pun, tanpa trigonometri):
`v = (v + dt·ω²·(target − x)) / (1 + 2ζω·dt + ω²dt²); x += v·dt`, dengan ω = 2πf.
Bila `dt ≥ 0,25` (bot baru masuk layar): `x = target, v = 0`.

| # | Kanal | Target | f (Hz) | ζ | Overshoot @60 fps |
|---|---|---|---|---|---|
| 0 | track | `max(airFwd,0)·(1−dive) + 0,25·abs(airSide)` | 2,2 | 0,55 | 8 % |
| 1 | dive | `airFwd > 0 ? airDive : 0` | 1,9 | 0,60 | ±6 % (belum disimulasikan) |
| 2 | back | `max(−airFwd, 0)` | 2,4 | 0,50 | ±11 % (belum disimulasikan) |
| 3 | bank (badan) | `clamp(0,45·side + 0,65·clamp(turn/1,8, ±1), ±1)` | 2,4 | 0,45 | 13,5 % |
| 4 | bankArm | `clamp(0,8·side + 0,3·turnN, ±1)` | 3,4 | 0,42 | 13 % |
| 5 | bankLeg | sama dengan #3 | 1,7 | 0,50 | 12 % |
| 6 | look | ψ | 3,0 | 0,85 | ~0 |
| 7 | cPitch (rad) | `0,06 + 0,32·cfw − 0,22·cbr` | 1,15→0,6 (sstep chuteT 0,3–1,6) | 0,33→0,22 | 28 % (ayunan bandul) |
| 8 | cRoll (rad) | `0,34·bank` | 0,7 | 0,28 | ±35 % (belum disimulasikan) |
| 9 | cDrive | `airFwd` | 2,4 | 0,55 | 8 % |
| 10 | cSteer | `airSide` | 3,2 | 0,45 | 13 % |

- Hasil simulasi yang diukur: kanal 0, 3, 4, 5, 7 (dan kanal uji 0,55 Hz / ζ 0,16 → 55 %). Di 120 Hz overshoot naik 2–4 poin, di 30 fps turun; itu diterima. Cadangan bila terasa beda: substep `n = min(3, ceil(dt/0,008))` hanya untuk pemain.
- **Campuran pose:** `J = ARCH + wT(1−wD)(TRACK−ARCH) + wD(DIVE−ARCH) + wB(BACK−ARCH)`, linear per sendi. Bobot boleh sedikit di atas 1; itulah overshoot halus di semua sendi sekaligus.
- Tabel pose = `Float32Array` konstan tingkat modul.

## 4. State machine (visual, deterministik dari `airT` / `chuteT` / `landT`)

| Fase | Waktu | Isi |
|---|---|---|
| LEAP | airT 0–0,22 | EXIT_TUCK, `hips.x` 0,30→0,90. Bobot overlay langsung 1 (karakter baru muncul dari pesawat, tidak perlu blend) |
| TUMBLE | 0,22–1,17 | `hips.x += 2π·smoothstep(u)` (puncak 9,9 rad/dtk); `hips.y += 0,75·sgn·sin(τ/2)`; `hips.z += 0,35·sgn·sin τ` (sgn dari seed). Anggota badan: tuck → kibas asimetris (sin 7–11 Hz, amplitudo 0,4–0,6) × `(1 − wStab)` |
| STABIL | `wStab = sstep(0,7; 1,6)` | menuju campuran terjun bebas + pantulan lengkung `−0,12·e^(−4t)·sin(2π·1,6t)` pada spine/chest/thigh. Input mulai terlihat sejak 0,7 dtk; fisika tetap langsung |
| FREEFALL | sampai payung | §1 + pegas + getar |
| PULL | chuteT 0–0,18 | pose tarik; kanal 7 diinisialisasi `x = wrap(hips.x terakhir), v = 0`, target ditahan |
| STRETCH | 0,18–0,45 | target kanal 7 → nilai payung; `wC = sstep(0,18; 0,60)` mencampur anggota badan ke CANOPY; poros bergeser ke bahu: `hips.position = (L·sin r, 1,45 − L·cos r·cos p, −L·cos r·sin p)`, L = 0,47, × wC |
| INFLATE + JERK | 0,45–0,95 | `j` = bump (naik 0,42→0,55, turun →0,95); ayunan pertama kanal 7 mencapai ≈ −0,45 rad di ±0,5 dtk |
| CANOPY | ≥ 0,95 | bandul meluruh ±3 ayunan sampai ±3 dtk; kemudi, condong, flare |
| PRA-MENDARAT | `airGnd` < 8 m | bobot `sstep(8, 2)`: `thighX −0,35`, `shinX 0,45`, `footX −0,10`, kepala +0,2 |
| LAND A / B / C | 0,55 / 0,70 / 0,95 dtk | §1. Lengan turun dengan smoothstep 0,4 dtk (≤ 10,3 rad/dtk). 0,2 dtk terakhir bobot → 0 |

**Pemilihan varian (pemain, di `air()` saat menyentuh):**
- `hs0 = |vel|`, `vs0 = st.airVs`.
- C bila state masih `'fall'` atau `hs0 > 11`.
- A bila `vs0 < 7,6 && hs0 < 3,5` (flare dengan S).
- Selain itu B.
- Atap: C diturunkan ke B.

**PERUBAHAN GAMEPLAY EKSPLISIT (kecil):**
1. **Sisa kecepatan saat mendarat.** `me.vel` tidak dinolkan: C = 5,0 m/dtk, B = `clamp(hs0; 1,6; 3,2)`, A = 0, searah `me.yaw`. ×0,4 di atap; 0 bila `col.arrival` memindahkan posisi lebih dari 0,5 m. Di `ground()` laju ikut input (baris ±934) menjadi `lerp(3,5; 12; sstep(0,25·dur; dur; landT))`. Hasil: meluncur ≤ 1,4 m lewat `col.step` (aman tabrakan), dan `me.moveSpeed` menggerakkan siklus kaki sehingga "lari kecil" asli.
2. **Kamera tetap orang ketiga 0,55–0,95 dtk setelah mendarat** (`st.landCam`), lalu dolly ke mata.

- Kecepatan dan jarak terjun di `air()` TIDAK diubah.
- Yaw root saat LAND: lerp sudut dari yaw mendarat ke `st.yaw` dengan `sstep(0,5·dur; dur)`. Sekarang yaw-nya meloncat.

## 5. Kanopi (modul baru `web/game/chutefx.js`, dipakai player.js dan bots.js)

**Bentuk mengembang** (fungsi murni dari `chuteT`, tanpa state):
- < 0,10: tersembunyi.
- 0,10–0,45 (streamer): skala bentang 0,06→0,16; chord 0,15→0,30; tinggi 0,35→1,12 (ease-out, tali terulur). Miring ke belakang `rotation.x = −atan2(hs, vs)·(1 − infl)`.
- 0,45–0,95: `R(τ)` = respons langkah teredam analitik (2,3 Hz, ζ 0,38, dibatasi 1,12). Bentang `0,16 + 0,84R`; chord `0,3 + 0,7·sstep(0; 0,3; τ)`; tinggi `1,12 − 0,12R`.
- Skala terhadap origin (titik harness), jadi tali tetap bertemu di bahu.

**Shader** (`onBeforeCompile` pada MeshLambert, satu pabrik material, `customProgramCacheKey`):
- `uInfl` (pemain): sel tengah terbuka dulu, `x *= mix(0,08; 1; smoothstep(0, 1, infl·1,6 − abs(s)·0,6))`.
- Riak `y += c·sin(5x + 18t + ph)·0,10·(1 − sstep(0,6; 1; infl)) + c·sin(2,2x + 3z + 3,1t)·0,025`, dengan `c = smoothstep(2,6; 3,4; position.y)` (hanya kanopi dan ujung tali).
- `uBrakeL/R` (flare + sisi kemudi): tepi belakang turun 0,30 m pada setengah bentangnya.
- Bot: material instans yang sama dengan `uInfl = 1`; pengembangan lewat skala matriks; fase riak dari posisi instans.

**Ayunan:**
- Kanopi `rotation.z = 0,30·A.S[bank]`; badan memakai kanal 8 (lebih besar dan tertinggal, sehingga berayun ke luar).
- `rotation.x = +0,10·cfw − 0,16·cbr`.

**Tali kemudi (pemain saja):**
- Satu `LineSegments` 4 verteks: sudut tepi belakang kanopi (±2,4; 3,95; z belakang) × `chute.matrixWorld` → `handL/R.matrixWorld`. Buffer 12 float ditulis ulang tiap frame.

**Lain-lain:**
- Perbaiki orientasi kanopi pemain (`rotateY(π)` sekali) setelah dikonfirmasi screenshot.
- Kempis saat mendarat 0,6 dtk: tinggi 1→0,25, bentang →0,7, `rotation.x → +1,1`, lalu sembunyi (pemain dan bot).
- Skrip Blender tidak perlu diubah. Cadangan: tanpa shader, hanya skala matriks.

## 6. Kamera, efek, suara

**Kamera** (`placeCamera`, cabang udara; skalar di `st`):
- Jarak: 6,5 + 1,0·track + 2,0·dive; payung 7,5 (deploy: 9 lalu 7,5). Laju 3/dtk di udara. Saat keluar pesawat `st.camD = 14` lalu mendekat.
- Tinggi pivot: jatuh 1,1; payung 2,4.
- FOV: 75 + 6·track + 14·dive (maks ±89); payung 74; laju 2,5/dtk; pukulan −5 saat deploy.
- Roll: `camera.rotation.z = −0,09·bank` (payung −0,06). Cabang lain sudah menyetel z = 0.
- Guncang halus (sinus, bukan `Math.random`):
  - `rot.x += a·sin(23,1t)·sin(7,3t+1)`, `rot.y += a·sin(19,7t+2)·sin(5,9t)`, `a = 0,0045·windK²`;
  - `pos.y += 0,03·windK²·sin(31t)`.
- Lag pegas: lateral `−right·0,5·bank`; vertikal impuls `v = −10` saat deploy (1,1 Hz, ζ 0,6; karakter tampak tersentak naik ±1 m).
- Mendarat: `st.landCam = dur + 0,15`; jarak → 3,4. Di 0,25 dtk terakhir → 0,3 bila bukan TPP. `showChar` dan `fp` memperhitungkan `landCam`.

**Efek** (modul baru `web/game/airfx.js`, M5):
- 64 garis angin (`LineSegments`, kotak 18×14×24 m di sekitar kamera, bergerak berlawanan arah kecepatan, panjang `|v|·0,035`, opasitas `clamp((windK − 0,45)·0,5; 0; 0,3)`, `depthWrite` mati).
- 10 sprite awan tipis (tekstur kanvas gradasi sekali buat, 60–140 m, opasitas 0,22 × `sstep(4; 30; jarak kamera)`), didaur ulang di bawah pemain antara 180–520 m.

**Suara** (`audio.js`):
- Ekspor baru `airWind(speedK, tone, pan)` pada node `wnd` yang sama (filter disimpan di node):
  - frekuensi `420 + 1500·tone` (tone = dive/track); Q `0,5 + 0,5·tone`; gain `0,06 + 0,34·speedK²`;
  - lapisan gemuruh lowpass 140 Hz, gain `0,25·speedK`.
- `windLevel(v)` tetap ada (main.js:815).
- `chuteOpen()` = `burst` sapu 900→200 Hz 0,45 dtk + `tone` 70→40 Hz.
- `land(k)` = `step(0,2 + 0,25k)` + `tone` rendah.
- Desis payung: `airWind(0,18; 0)`.

## 7. Bot

- `airStep`/`allyAir`: hitung `b.airT`, `b.chuteT`, `b.landT` di waktu simulasi (bukan saat pose), plus `b.pyaw`.
- Blok pose: isi input §2. Tanpa alokasi (skalar di `b`).
- Flare visual di bawah 12 m (`airFwd = −1`); fisika tidak berubah.
- Mendarat: `landKind` 0/1 (tanpa guling: tidak ada sisa kecepatan untuk bot). `b.landT` berjalan 0,7 dtk di blok draw.
- Rekan formasi:
  - meniru `PLAYER.pose.airFwd/airSide/airDive`;
  - frekuensi pegas ×(0,85–1,15) dari seed, supaya bereaksi serempak tapi tidak kembar;
  - kepala menoleh ke pemain;
  - target formasi `airT` diberi goyangan `(0,5·sin 0,7t; 0,3·sin 0,9t; 0,4·sin 0,5t)` berfase per slot.
- Kanopi instans: `compose(pos, yaw·roll, skala(chuteT))`; kempis saat mendarat.
- **Mode "Ikut rekan"** (player.js cabang `me.follow`):
  - `airFwd = 0,35`;
  - `airTurn` dari laju yaw pemimpin;
  - `airSide` dari kecepatan lateral offset;
  - goyangan formasi yang sama pada `folT`;
  - `st.chuteT` mulai saat state pemimpin berganti.

## 8. Uji

Semua skrip di `.wt/_tools`, tidak ada kait di `web/`.

**Akses rig:** `import('/map/rig.js?v=…')` lalu bungkus `Rig.prototype.pose`. Rig pemain = pemanggilan dengan `s === __G.me.pose`.

**Lembar kontak sebelum/sesudah:**
- Skenario tombol sintetis (KeyboardEvent):
  - 0 dtk `__G.jumpOut(true)`;
  - 2,0 W; 3,5 W + `st.pitch = −1,0`; 5,0 lepas; 5,5 D; 6,5 A; 7,5 S;
  - 8,5 F; 10 D; 11 A; 12 W; 13 S;
  - lalu `me.pos.y = 14` sambil S (mendarat A); ulangi untuk B dan C.
- Jaga ketinggian dengan menyetel `me.pos.y = 500` berkala.
- Tangkap tiap 0,25 dtk, `magick montage -tile 8x`.
- Dua kamera: kamera game dan `__T.camAt` dari samping 6 m.
- Varian: m/f + kostum berjubah.

**Kontinuitas** (sudut delta quaternion lokal per tulang per frame ÷ dt, 60 fps):
- ≤ 12 rad/dtk di semua sendi dan semua pergantian state;
- ≤ 13 rad/dtk untuk `hips` saat TUMBLE/ROLL;
- loncatan kecepatan sudut antar frame ≤ 2 rad/dtk (kecuali frame pertama LEAP).

**Hidup:** rata-rata kecepatan sudut anggota badan saat jatuh diam tanpa input ≥ 0,15 rad/dtk (sekarang ≈ 0).

**Responsif:** dari tekan tombol ke 10 % perubahan pose ≤ 80 ms, ke 90 % ≤ 350 ms, overshoot 6–20 %.

**CPU:**
- µs rata-rata per panggilan `pose()` untuk ≥ 50 bot ber-state `fall`/`chute`, 5 dtk, sebelum vs sesudah.
- Lulus: mengudara ≤ dasar + 30 %; di darat tidak berubah (±3 %).
- Acuan: bagian pegas + sinus saja ±0,7 µs di node.

**Alokasi:** CDP `HeapProfiler.startSampling` 10 dtk saat mengudara; tidak ada situs alokasi di `rigair.js`, `Rig.pose`, `chutefx`, `airfx`.

**Lulus juga bila:** konsol tanpa error; game termuat di mode realistis dan Hemat; halaman peta (walk.js) tetap jalan.

## 9. Milestone (masing-masing bisa dikirim sendiri; tiap kali naikkan `?v=` di royale.html, tambah entri `./map/rigair.js`, tulis HANDOFF §35 dalam bahasa Indonesia)

- **M0** — lab pose + lembar kontak "sebelum" + baseline CPU. Konfirmasi tabel §1 secara visual dan orientasi kanopi. Tanpa perubahan repo.
- **M1** — inti terjun bebas: `rigair.js` (arch/track/dive/back/belok, pegas, getar, toleh kepala), input player.js, root tidak lagi diputar, `visYaw`, input bot. Ini langsung menjawab keluhan Steven.
- **M2** — keluar pesawat (LEAP/TUMBLE/STABIL) + kamera (FOV, roll, guncang, jarak) + `airWind`.
- **M3** — payung: deploy, bandul, pose kemudi/condong/flare, `chutefx` (mengembang, riak, rem, tali kemudi), suara buka.
- **M4** — pendaratan: 3 varian, sisa kecepatan, tahan kamera, kanopi kempis, flare bot.
- **M5** — garis angin dan awan, formasi "Ikut rekan" dan rekan, pemolesan.

## 10. Risiko dan cadangan

| Risiko | Cadangan |
|---|---|
| Lerp Euler lengan melewati daerah gimbal (`az ≈ π/2`, `ax ≈ −π/2`) | quaternion per pose dihitung sekali + nlerp dengan temporer modul |
| Kulit v3/kostum terjepit di sudut ekstrem (`armZ 2,2`, lengkung) | batasi nilai; uji 4 varian + jubah |
| Bentrok gabung dengan agen kostum di rig.js | perubahan hanya 3 baris + berkas baru; `rig.A.wind` bisa dibaca tulang pegas jubah |
| Bot dipose jarang | getar dipudarkan oleh `pdt`; timer dari simulasi; snap bila dt ≥ 0,25 |
| Overshoot bergantung frame rate | substep untuk pemain |
| Sisa kecepatan mendorong ke air / tepi atap | ×0,4 di atap; konstanta 0 mematikannya |
| Tahan kamera orang ketiga tidak disukai | konstanta durasi 0 (bukan flag uji) |
| Shader kanopi vs InstancedMesh / bayangan / postfx | hanya skala matriks |
| Roll kamera bikin pusing | ≤ 5°, mudah diturunkan |
| `airTurn` berisik saat nyaris diam | low-pass + clamp + `visYaw` |
| Asumsi orientasi kanopi salah | putuskan dari screenshot M0 |

**Default yang dipilih:**
- "Kepala menoleh ke arah kamera" = menoleh ke arah pandang kamera (bukan menatap lensa).
- Bot tidak berguling.
- Skrip Blender parasut tidak diubah.

### Critical Files for Implementation
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/rig.js (3 baris kait; konvensi tulang; baris 172–490)
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/player.js (`air()` 1001–1080, `placeCamera` 782–818, render 1179–1240, `ground()` ±934)
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/bots.js (`allyAir`/`airStep` 358–404, kanopi 265–272, blok pose 1866–1911)
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/audio.js (`windLevel` 348, `burst`/`tone`)
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/royale.html (importmap `?v=`)
- Berkas baru: `web/map/rigair.js`, `web/game/chutefx.js`, `web/game/airfx.js`
- Rujukan: /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/tools/blender/props.py (`parachute()` 450–503), /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/.wt/_tools/README.md
