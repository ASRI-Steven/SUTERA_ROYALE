# Rancangan perombakan skin karakter Sutera Royale (untuk dieksekusi di worktree terpisah)

## 0. Yang harus kamu tahu dulu

**Saya tidak sengaja membuat 3 berkas di repo.** `cdp shot` dengan path relatif menulis ke cwd saya, sehingga muncul tiga JPG tak terlacak:
- `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/a_under.jpg`
- `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/a_aim_left.jpg`
- `/Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/a_aim_front.jpg`

Saya tidak menghapusnya karena mode saya read-only. Ketiganya tidak dipakai kode apa pun; tolong hapus. Selain itu `git status` bersih. Server uji dan Chrome saya (8821/9321/9421) sudah dimatikan.

**Hasil pemeriksaan:**
- **Diagnosis skin benar.** 18 skin memakai geometri yang sama (`m1|f1|m2|f2.glb`); bedanya hanya palet 7 slot, pola `sfChar`, dan selubung aura.
- **Tangan kiri: akar masalahnya lebih dalam dari `gunKind`.** Lihat §3.6. Dengan `gunKind` benar pun telapak kiri masih 7–19 cm dari titik `<jenis>_guard` di semua 11 senjata. Ini juga kena di orang ketiga dalam pertandingan dan bot, karena kodenya sama (`Rig.pose`).
- **Paket MakeHuman layak dipakai.** `.mhclo` pas di tubuh m1 dan f1 lewat `mhdata.fit()` yang sudah ada, tanpa kode baru. Semua butuh decimate berat dan sebagian besar hanya punya diffuse.

**Batas verifikasi:**
- Yang saya unduh dan uji: suits02_cc0, hats02_cc0, masks01_cc0, shoes01_cc0.
- pants01_cc0, dress01_cc0, suits01_cc0 hanya dicek ada (HTTP 200); isinya belum dibuka.
- Paket CC-BY tidak saya uji. Nama zip-nya tidak seragam (`shoes03_ccby`, `hats04_cc-by`; beberapa tebakan lain tidak menjawab atau 404), jadi tautan harus dibaca dari halaman paket.
- Semua rancangan runtime di bawah belum dijalankan; angka anggaran adalah target, bukan hasil ukur.

**Default yang saya pilih (tidak ada pertanyaan yang memblokir):**
- Seluruh rancangan memakai CC0 + model Blender buatan sendiri. CC-BY hanya opsi peningkatan, jadi layar kredit tidak wajib; `CREDITS.md` tetap dibuat.
- Rekan regu bot ikut memakai kostum di pertandingan.
- Hitbox tidak berubah.
- Tetap 18 skin, ID dan harga tetap.
- `char_default` juga dibangun lewat pipeline kostum.

Artefak scratch (bisa terhapus saat reboot), semua di `/private/tmp/claude-642194880/-Users-2403077-Documents-web/37f5498a-9fbb-4448-a634-ad419f217d37/scratchpad/design-skin/`:
- `scripts/hand.js`: lab pose tangan + metrik telapak→guard. Layak disalin ke `.wt/_tools`.
- `scripts/evalpack.py`: evaluasi paket mhclo di Blender.
- `shots/sheet_hand.jpg`, `shots/sheet_hand2.jpg`: bukti tangan kiri.
- `shots/es_0.jpg`, `shots/es_1.jpg`, `shots/eval_head_front.png`: kecocokan paket di tubuh.
- `shots/eval_suits.json`, `shots/eval_head.json`: angka mentah.
- `dl/x_*`: paket yang sudah diekstrak.

---

## 1. Katalog 18 kostum

Kode sumber:
- **[SYS]** aset sistem MakeHuman CC0, sudah di cache `~/.cache/senara-digital-twin/mh-assets/pack`
- **[S2]** suits02_cc0, **[H2]** hats02_cc0, **[M1]** masks01_cc0, **[SH1]** shoes01_cc0 (diuji)
- **[P1]** pants01_cc0, **[D1]** dress01_cc0, **[SU1]** suits01_cc0 (belum dibuka; cadangan selalu disebut)
- **[BL]** model Blender buatan sendiri (prosedural di skrip)
- Tekstur: **PH** = Poly Haven, nama aset dari API (`denim_fabric`, `cotton_jersey`, `rough_linen`, `hessian_230`, `knitted_fleece`, `polar_fleece`, `crepe_satin`, `stretch_poplin`, `floral_jacquard`, `scuba_suede`, `curly_teddy_natural`, `brown_leather`, `fabric_leather_01`, `leather_white`). **aCG** = ambientCG (`Fabric0xx` 106 aset, `Fabric004` karbon, `Lava001–005`, `Plastic0xx`; ID untuk Leather/Metal/Ice/Marble dipilih saat M2 karena API sedang membatasi laju).
- "Tekstur buatan" = motif dihitung numpy di pipeline (parang, ikat, loreng, pamor, bulu merak). Ini karya orisinal.

| id | Nama · koleksi · kelangkaan | Siluet (sumber) | Bahan | Animasi khas | Orang pertama | Palet |
|---|---|---|---|---|---|---|
| char_default | Rekrut Sutera · Taktis · biasa | Topi lapangan berlidah [BL]; jaket lapangan + jins [SYS male_casualsuit05]; bot [SYS shoes03]; ban lengan emas [BL]. Punggung kosong. | PH denim_fabric, cotton_jersey | Tidak ada (hanya tulang genggam) | Lengan ungu, sarung tangan gelap, manset emas (seperti sekarang) | Ungu #503EBA + emas |
| char_malam | Operator Malam · Taktis · biasa | Balaclava [M1 hero-heroine_hood_1, ditekstur ulang rajut]; NVG terangkat di dahi [BL]; plate carrier berkantong magasin [BL, turunan GearMesh vest3]; celana kargo [P1 cortu_cargo_pants, cadangan bawahan SYS male_worksuit01]; bot [SH1 culturalibre_male_boots]; bantalan lutut [BL] | aCG Fabric (ripstop), Fabric004 untuk pelat | Tidak ada | Sarung tangan taktis berpelindung buku jari, lengan ripstop hitam | Hitam arang doff + amber kecil |
| char_kabut | Kabut Kota · Taktis · biasa | Tudung naik [S2 donitz_monk_robe_hood, tekstur fleece]; respirator setengah wajah [M1 joepal_medical_mouth_protection + 2 tabung filter BL]; atasan lengan panjang SYS (ambil yang pertama lulus uji tembus < 2% dari male_casualsuit02, 04, 01); tas selempang dada [BL]; sneakers [SYS shoes02] | PH knitted_fleece, polar_fleece | 1 rantai: tali tas | Lengan fleece abu, sarung tangan tanpa jari | Abu beton terang + oranye keselamatan |
| char_gurun | Debu Merapi · Taktis · biasa | Helm baja [H2 mrgreaterthan_m1_helmet]; goggle debu di helm [BL]; syal shemagh menutup hidung [BL]; coverall [SYS male_worksuit01]; gaiter [BL]; bot [SH1 male_boots] | PH rough_linen, hessian_230; peta normal/rough asli helm | 1 rantai: ujung shemagh | Lengan kanvas pasir, sarung tangan kulit cokelat | Pasir/khaki + karat |
| char_rimba | Rimba · Taktis · langka | Topi rimba berdaun [BL]; jubah ghillie bahu-punggung, strip kartu alfa [BL]; atasan SYS + celana kargo [P1, cadangan SYS]; gulungan matras di punggung bawah [BL] | PH hessian_230 (goni), aCG Fabric; loreng buatan | 3 rantai ghillie (2 tulang) | Lengan loreng + lilitan goni di lengan bawah | Hijau lumut + cokelat tanah |
| char_merahputih | Merah Putih · Pusaka · langka | Peci hitam [BL]; jas upacara kerah tegak [SU1 jas, cadangan SYS male_elegantsuit01]; selempang merah diagonal [BL]; kacu merah [BL]; pantofel [SYS shoes01] | PH crepe_satin, stretch_poplin, leather_white | 2 rantai: ujung selempang, kacu | Lengan jas putih, manset merah berkancing emas, sarung tangan putih | Putih + merah, peci hitam |
| char_samudra | Samudra · Alam · langka | Masker selam di dahi + snorkel [BL]; wetsuit [S2 matcreator_mc-skinsuit_2022]; tabung + BCD di punggung [BL]; pisau di betis [BL]; sepatu neoprene [SH1 hero_boots_3, tekstur ulang] | PH scuba_suede; aCG Plastic kuning | 1 rantai selang regulator (3 tulang); lampu strobo berkedip; kaustik samar (emisif) | Lengan neoprene toska + jam selam | Toska terang + kuning tabung |
| char_tenun | Tenun Ikat · Wastra · langka | Ikat kepala bersimpul, ujung menjuntai [BL]; kemeja lengan pendek [SYS male_casualsuit06]; selendang tenun lebar di bahu kiri [BL]; sarung selutut di atas celana [BL]; gelang manik; sandal kulit [BL] | Motif ikat buatan + normal PH rough_linen | 5 rantai: ujung ikat kepala, selendang ×2, tepi sarung ×2 | Lengan telanjang (warna kulit) + gelang manik & tenun | Nila + karat + krem |
| char_ondel | Ondel-ondel · Panggung · langka | Topeng ondel-ondel merah berkumis [BL]; mahkota kembang kelapa radial 12 batang [BL]; baju kurung longgar selutut [S2 donitz_monk_robe dipotong di lutut, tekstur ulang; opsi D1 mindfront_kimono]; selempang sarung kotak [BL] | PH crepe_satin; aCG Plastic warna | 4 rantai kembang kelapa (1 tulang) | Lengan longgar merah berbunga emas, sarung tangan putih | Merah menyala + pelangi kembang kelapa |
| char_batik | Batik Parang · Wastra · epik | Blangkon [BL]; kemeja batik lengan panjang [SYS male_casualsuit01 atas]; jarik parang semata kaki ber-wiron [BL]; stagen + timang [BL]; keris kecil di pinggang belakang [BL]; selop [BL] | Motif parang buatan; PH crepe_satin | 3 rantai wiron; kilau prada emas mengalir di garis parang, makin cepat saat lari | Lengan batik, manset emas, cincin akik | Sogan + krem + emas |
| char_neon | Neon Kota · Neo · epik | Helm full-face bervisor LED [H2 culturalibre_motorcycle_helmet]; ponco hujan pendek tembus pandang [BL, alpha dither]; bodysuit [S2 matcreator_mc-bodysuit-2021]; tas kurir kotak ber-LED [BL]; sepatu sol tebal [SH1] | aCG Plastic, Fabric004 | 3 rantai ponco; visor HUD (kisi glif menggulung); LED kejar. Kill: visor berkedip. Isi ulang: bilah kemajuan di visor | Lengan ponco lime transparan berstrip LED, ujung jari menyala | Lime neon + hitam + magenta kecil |
| char_empu | Empu Pamor · Pusaka · epik | Udeng tinggi [BL]; beskap landung [SU1 jas diubah kerah, cadangan SYS male_elegantsuit01]; celemek kulit pandai besi [BL]; keris besar berwarangka diagonal di punggung [BL]; sarung pendek; selop | PH brown_leather, fabric_leather_01; beludru aCG; pamor buatan | 2 rantai (celemek, ronce keris); pamor mengalir. Isi ulang: keris terhunus 6 cm dan menyala | Sarung tangan kulit tebal, lengan marun digulung | Marun tua + perak + bara |
| char_magma | Inti Magma · Alam · epik | Mahkota pecahan obsidian + topeng separuh [BL]; lempeng batu prosedural di dada/bahu asimetris/tulang kering [BL]; bodysuit [S2] | aCG Lava001–005 (albedo + emisi), batu | Lava mengalir (peta alir); bahu "bernapas". Menembak: retakan memutih. Kill: semburan | Bracer batu retak berlava (pola `sfSleeve` magma lama dipertahankan) | Basal gelap + jingga lava (emisif ≥ 25% luas) |
| char_es | Kristal Es · Alam · epik | Tudung berbulu [S2 monk_robe_hood + trim bulu BL]; parka pendek [BL]; prisma es di bahu & punggung [BL]; bot bulu [S2 rehmanpolanski_viking_boots] | PH curly_teddy_natural; aCG Ice; Fabric | 2 rantai (bulu, ekor parka); aurora bergerak di kristal. Diam > 3 dtk: kristal tumbuh. Lari: mengecil | Lengan parka + bulu di manset + kristal di punggung tangan | Biru gletser + putih bulu + aurora hijau-ungu |
| char_kencana | Kencana · Kencana · epik | Sirkam tipis [BL]; jas berekor [SU1 jas + ekor BL, cadangan SYS elegantsuit]; selendang sutra [BL]; epolet berumbai [BL] | PH floral_jacquard, crepe_satin; emas aCG | 3 rantai (ekor ×2, rumbai); kilau mutiara menyapu; sulaman berkelip | Lengan jacquard, manset mutiara, sarung tangan satin | Champagne-merah muda mutiara + emas mawar |
| char_garuda | Garuda Emas · Pusaka · legendaris | Helm-mahkota berparuh [BL]; zirah emas [S2 matcreator_mc-scifi-armor_helios, cadangan _jupiter7] di atas bodysuit merah hati; sayap 2×3 ruas di punggung [BL]; kain dodot di pinggang [BL] | Emas aCG; PH crepe_satin | Sayap: terlipat (diam) → setengah (lari) → terbentang (kill 1,5 dtk, terjun, payung). Paruh menutup saat membidik. Bulu beriak. Kill: kilat emas dari dada ke ujung sayap. 2 rantai dodot | Gauntlet emas berukir bulu; kilau menyapu saat kill | Emas + merah hati |
| char_warok | Warok Barong · Panggung · legendaris | Topeng barong di atas kepala [BL]; dadak merak kipas 5 bilah di punggung [BL]; baju warok hitam terbuka + kaus loreng [SYS + BL]; celana gombor [P1 toigo_harem_pants, cadangan BL]; kolor putih besar [BL]; udeng | Bulu merak kartu alfa buatan; aCG Fabric | Kipas: kuncup (diam, kendaraan, tiarap) → mekar (kill, lobi); mata bulu berdenyut bergiliran. Topeng turun saat membidik/menembak; rahang mengatup saat kill. 2 rantai kolor | Lengan hitam longgar, gelang akar bahar, cakar barong di sarung tangan | Hitam + hijau merak + merah-putih |
| char_reaktor | Reaktor Sutera · Neo · legendaris | Helm tertutup berpelat muka belah [BL]; zirah keramik [S2 _jupiter7 + _guardian untuk bot/bracer] di atas bodysuit grafit; inti dada [BL]; 4 sirip pendingin punggung [BL] | Keramik/Plastic aCG; Fabric004 | Sirip membuka saat isi ulang (emisif memerah lalu kembali cyan) dan saat lari. Pelat muka menutup saat membidik. Arus energi dipercepat tembakan. Kill: gelombang cincin dari inti | Gauntlet keramik putih berkanal cyan mengalir | Putih keramik + grafit + cyan |

Batas tulang tambahan: rantai pegas + tulang mekanis + 2 tulang genggam ≤ 12 per kostum. Yang terbanyak: Garuda (6 sayap + 1 paruh + 2 dodot + 2 genggam = 11).

### Matriks beda (siluet × palet)

Tanda siluet: K = kepala, T = atasan, B = bawahan, P = punggung.

| id | K | T | B | P | Warna dominan |
|---|---|---|---|---|---|
| default | topi lidah | jaket sipil | jins | kosong | ungu sedang |
| malam | balaclava + NVG | plate carrier | kargo + lutut | kosong | hitam |
| kabut | tudung + respirator | hoodie | jogger | tas dada | abu terang |
| gurun | helm baja + goggle | coverall + syal | gaiter | kosong | khaki |
| rimba | boonie daun | ghillie | kargo | matras | hijau |
| merahputih | peci | jas + selempang | celana rapi | kosong | putih |
| samudra | masker selam | wetsuit ketat | ketat | tabung | toska |
| tenun | ikat kepala | lengan pendek + selendang | sarung selutut | kosong | nila berpola |
| ondel | topeng + mahkota radial | baju kurung | selutut | kosong | merah terang |
| batik | blangkon | kemeja | jarik panjang | keris kecil | cokelat sogan |
| neon | helm full-face | ponco | ketat | tas kotak | lime |
| empu | udeng tinggi | beskap + celemek | sarung pendek | keris besar | marun |
| magma | mahkota pecahan | lempeng batu asimetris | lempeng | kosong | hitam + emisi jingga |
| es | tudung bulu | parka + kristal | bot bulu | kristal | biru muda |
| kencana | sirkam | jas berekor | celana rapi | ekor | merah muda champagne |
| garuda | helm paruh | zirah | dodot | sayap | emas |
| warok | topeng barong | terbuka + loreng | gombor | kipas | hitam + hijau merak |
| reaktor | helm pelat | zirah keramik | zirah | sirip | putih + grafit |

Pasangan terdekat dan pemisahnya:
- **malam / magma / warok (gelap):** magma punya emisi jingga ≥ 25% dan bahu batu asimetris; warok punya kipas hijau merak selebar > 1 m dan topeng; malam doff tanpa punggung.
- **merahputih / reaktor / es (terang):** jas kain berpeci, zirah keras berhelm bersirip, parka berbulu berkristal; aksen merah, cyan + grafit 50%, biru jenuh.
- **batik / empu / gurun (hangat):** jarik panjang sogan, celemek + keris besar marun, coverall khaki berhelm.
- **samudra / tenun / es (biru):** toska polos ketat + tabung, nila berpola + sarung, biru muda berbulu.
- **kencana / garuda:** merah muda kain berekor lawan emas logam bersayap.
- **kabut / gurun (loreng abu lama):** kini tudung + respirator abu-oranye lawan helm baja + syal khaki.

Pembuktian kuantitatif ada di §5 (skor IoU siluet + ΔE palet, ambang gagal eksplisit).

---

## 2. Pipeline

### 2.1 Refaktor kecil dulu
`tools/blender/characters3.py` mem-parse argumen saat diimpor (baris 36–46), jadi tidak bisa dipakai ulang. Pindahkan argparse dan `main()` ke bawah `if __name__ == '__main__'`, dan jadikan `args` parameter fungsi yang memakainya.

Kriteria: bangun ulang `--only m1 --stage mesh` menghasilkan `m1.glb` identik byte dengan yang sekarang. Kalau tidak identik, batalkan refaktor dan salin fungsi yang dibutuhkan ke `charlib.py`.

### 2.2 Skrip baru `tools/blender/costumes.py` + `costume_tex.py`
Memakai dari characters3:
- `mhdata.MakeHuman`, `build_variant` (dipecah: tubuh + Retarget)
- `Retarget.apply` / `our_weights`, `cull_hidden`, `decimate`, `transfer`
- `torso_rings`, `GearMesh`, `head_metrics`, kelas `GLB`, `to_webp`

Argumen: `--mpfb --assets --packs <folder paket ekstrak> --out web/game/assets/costumes --work … [--only char_malam] [--variants m1,f1] [--stage all|mesh|sheet]`.

Definisi kostum = satu dict `COSTUMES[id]`:
```
layers:  [dict(src='S2:matcreator_mc-bodysuit-2021', tris=3500, mat='suit', offset=0.0), dict(src='BL:plate_carrier', …)]  # urutan dalam → luar
rigid:   [dict(src='H2:mrgreaterthan_m1_helmet', bone='head', tris=1800, fit='head')]
springs: [dict(name='shemagh', parent='chest', pts=[(x,y,z),…], radius=0.09, stiff=40, damp=6, grav=0.6, coll=['chest'])]
mech:    [dict(name='wingL1', parent='chest', pivot=(…), axis=(…), max=1.9, terms=dict(base=0.05, run=0.4, air=1, cheer=1, sit=-1), rate=6)]
grip:    True
emis:    dict(mode='flow'|'scan'|'lava'|'sweep'|'pulse', c1='#…', c2='#…', speed=…, react=dict(fire=…, cheer=…, reload=…))
fp:      dict(sleeve='ph:knitted_fleece', sleeveCol='#…', glove='…', cuff='…', fx=<CHAR_FX lama atau 0>, bracer='BL:bracer_rock'|None, emis=…)
far:     dict(shirt='#…', sleeve='#…', pants='#…', glove='#…', cuff='#…', inner='#…')
```

Langkah per kostum × varian (m1, f1, m2, f2):
1. **Tubuh.** `mh.build(macros)` + skala yang sama dengan `build_variant`, supaya kepala dan tangan identik dengan `<varian>.glb`.
2. **Lapisan mhclo.** `mh.read_mhclo` + `mh.fit(info, P)` di pose-A, sama seperti `mh.asset` tetapi dari folder paket. Hapus verteks tubuh dari `delete_verts`. Lapisan dalam yang tertutup dibuang dengan `cull_hidden`. Lapisan luar yang menembus digeser keluar sepanjang normal tubuh sebesar `offset` + 2 mm (uji BVH seperti di `evalpack.py`).
3. **Lapisan lunak BL** (jarik, sarung, selendang, ponco, celemek, ekor jas, selempang). Dibangkitkan prosedural di pose diam dari `torso_rings(var, ys)` dan cincin kaki, pola yang sama dengan `GearMesh` rompi, sehingga pas di 4 varian. Bobot awal diwarisi dari titik tubuh terdekat (`transfer`).
4. **Bagian kaku** (helm, topeng, blangkon, peci, keris, tabung, sayap, kipas). Dimodelkan sekali di ruang tulang. Bagian kepala diskala dan digeser per varian dari `head_metrics(var)`. mhclo kaku (helm) di-fit lalu diikat 100% ke `head`.
5. **Retarget.** `rt.apply(pos, W)` → pose diam game; `rt.our_weights` → 17 tulang.
6. **Tulang tambahan** (maks. 12, indeks 17–28):
   - *Pegas:* untuk tiap rantai, verteks dalam `radius` dari polyline rantai dan lolos topeng wilayah dicampur dari bobot dasar ke tulang rantai dengan smoothstep sepanjang rantai. Tulang ke-0 rantai berbagi bobot dengan induknya supaya pangkal tidak patah.
   - *Mekanis:* bobot kaku 100%.
   - *Genggam* (`gripL`, `gripR`): poros di garis buku jari. Bobot = jumlah bobot MakeHuman ruas telunjuk–kelingking, yang sekarang dilebur ke `hand` di `Retarget` (baris ±226).
7. **Slot.** Kepala, leher, tangan, dan kulit terbuka tetap berupa "sisa tubuh" dengan UV + `_SLOT` atlas dasar varian, supaya warna kulit rekan regu tetap bisa diatur. Seluruh kostum = satu mesh `cos` dengan UV atlas kostum.
8. **Atlas kostum** (satu set per kostum, dipakai 4 varian; rakitan numpy seperti `build_atlas`):
   - `albedo.webp` 1024² sRGB: diffuse sumber dipakai sebagai AO/topeng, warna ditentukan ulang, lalu dikali tekstur PBR tileable yang di-resample ke UV.
   - `normal.webp` 1024².
   - `orm.webp` 1024² (R = AO, G = kekasaran, B = logam). Kulit tidak ada di mesh ini, jadi kanal B bebas.
   - `em.webp` 512² opsional (R = topeng emisi, G = koordinat alir 0..1, B = fase/ID wilayah).
   - Motif Nusantara dihitung `costume_tex.py`. Tiga detail normal tileable 256² (tenun, kulit, logam sikat) dibagi semua kostum di `costumes/_detail/`.
9. **LOD.**
   - LOD0: ≤ 9.000 segitiga kostum + ±5.000 sisa tubuh + ≤ 3.000 kaku. Legendaris boleh 12.000 kostum.
   - LOD1: ≤ 3.000 + 1.600 + 900. Dipakai rekan regu > 12 m dan sebagai pembuat bayangan.
   - Di atas 60 m: tubuh kerumunan biasa dengan palet `far`.
10. **Ekspor.** `costumes/<id>/<varian>.glb` berisi node `skin_lod0/1`, `cos_lod0/1`, `rigid_<nama>_lod0/1`; JOINTS_0 mengacu 17 + N tulang. Plus `costumes/<id>/costume.json` (versi, `bones`, `pivots`, `springs`, `mech`, `emis`, `fp`, `far`, `tris`, daftar berkas, `credits`). Bagian orang pertama: `costumes/<id>/fp.glb` (bracer/gelang, ≤ 1.500 segitiga) bila ada.
11. **Gambar toko.** `--stage sheet` merender `thumb.webp` 256² (tiga perempat badan, pose pegang senjata) dan lembar kontak (§5).

Target ukuran:
- GLB per varian ≤ 750 KB (≤ 350 KB bila kuantisasi KHR_mesh_quantization dipasang di M6).
- Tekstur per kostum ≤ 900 KB.
- Unduhan saat memakai satu kostum ≤ 1,7 MB.
- Unduhan awal game bertambah 0 byte untuk skin bawaan lama; hanya kostum anggota lobi yang diambil, setelah lobi tampil.

`CREDITS.md` di `web/game/assets/costumes/` dibangkitkan dari `costume.json.credits`: nama aset, pembuat, lisensi, URL paket.

---

## 3. Runtime

### 3.1 `web/map/rig.js`
- **Lebar baris kostum.** `NBX = 29` (17 + 12), `PALX = NBX*4`, `TWX = PALX + 12` texel. Isi palet: 8 slot seperti sekarang, 1 texel kejadian `(pulse, heat, flash, sweep)`, 2 texel warna emisi c1/c2, 1 cadangan. `SkinStore` diberi parameter lebar. Jalur kerumunan (TW3 = 76) tidak disentuh.
- **`loadCostume(id, variantKey)`** → `Promise<asset>`, di-cache per `id|varian`.
  - Isi: geometri (atribut `_slot` → `aSlot`), tekstur (flipY false), `costume.json`, material.
  - Batas waktu 8 dtk; gagal → `null`, pemanggil memakai tampilan lama.
- **`costumeMaterial(asset)`.** Turunan `bodyMaterial3` tanpa `sfChar`: `map/normalMap/roughnessMap/aoMap/metalnessMap` dari atlas kostum, detail normal, blok emisi generik `#if COS_EM == mode` yang membaca texel kejadian dan warna dari tekstur tulang. Kejadian menjadi per karakter tanpa uniform per material. `customProgramCacheKey = 'cos' + mode + (alphaHash ? 'a' : '')`, total ≤ 7 program. Sisa tubuh memakai `v.mat` yang ada dengan tekstur tulang selebar TWX, jadi perlu varian material `bodyMaterial3(…, PALX)` (kunci program `char3x`).
- **`buildCharacter3(outfit, gear, look)`.** Selalu membuat store selebar TWX untuk karakter tunggal. Tambahan pada objek hasil:
  - `setCostume(asset | null)`: menukar mesh `skin`/`cos`/`rigid` di tempat (rig, senjata, posisi tetap). `null` = kembali ke tubuh v3 + palet.
  - `costume`: state pegas/driver, atau `null`.
  - `tick(dt)`: dipanggil setelah `rig.pose`.
  - `setGear('helmet'|'vest'|'pack'|'hair', …)`: saat berkostum, helm bawaan kostum menang. Rambut disembunyikan bila `costume.json.hideHair`. Rompi dan ransel loot tetap tampil kecuali `costume.json.hideVest` / `hidePack`.
- **Pemecah pegas** (fungsi modul, state di typed array milik kostum).
  - Per sendi: posisi ujung sekarang dan sebelumnya di ruang dunia, panjang, arah diam di ruang induk.
  - Langkah: Verlet + gravitasi + tarikan ke arah diam (kekakuan) + redaman + batas sudut 70° + dorongan keluar dari maks. 3 kapsul (dada, paha kiri, paha kanan; sekalar saja).
  - `dt` dijepit ≤ 1/30. Akar berpindah > 2 m dalam satu frame (teleport, masuk kendaraan) → reset ke diam.
  - Rotasi sendi = rotasi terkecil arahDiam → arahSekarang. Matriks kulit ditulis langsung ke `store.data` kolom 17+ (pola `writeRow3`: dunia × translasi(−poros)).
  - Tanpa `new`, closure, atau array per frame; temporer modul seperti `_S, _u, _h`.
- **Driver mekanis.** `nilai = clamp(Σ bobot_i × keadaan_i, 0, 1)`, dihaluskan `1 − exp(−dt × rate)`, sudut = `nilai × max` di `axis` pada `pivot`.
  - Keadaan dibaca dari `rig.m` yang sudah ada: `run = clamp((m.speed − 2.6)/3.6)`, `aim = m.aim`, `reload = m.rl`, `air = max(m.fall, m.chute)`, `fire = m.fire`, `sit = m.sit`, `prone = m.prone`, `idle`.
  - Satu keadaan baru: `cheer`, impuls `s.cheer` meluruh 1,5 dtk, ditangani di `Rig.pose` seperti `s.hit`.
  - Genggam: `gripL = 0,95 × m.armed × ikW`, `gripR` sama.
- **Kerumunan.** Tambah `crowd.skipBody(i, on)`: bot yang kostumnya digambar sebagai karakter tunggal tidak dimasukkan ke `push(body…)`; bayangan dan perlengkapan tetap. Selain itu `createCrowd3` tidak berubah.
- **Aturan rig.js.** Tidak mengimpor `skins.js`. Halaman peta juga memakai berkas ini, jadi jalur v2 tidak disentuh.

### 3.2 `web/game/skins.js`
- `CHAR_SKINS`: tambah bidang `costume: true` per skin yang sudah dikonversi. Ini data rilis, bukan flag uji; rilis bisa bertahap. `outfit`, `fx`, `aura` lama dipertahankan sebagai cadangan.
- `equipCostume(char, id, look)` → Promise:
  1. Pasang cadangan seketika (`setOutfit(charPalette(id))` + aura lama bila ada).
  2. `loadCostume`, lalu `compileSkinAsync` pada mesh sementara.
  3. `char.setCostume(asset)`, lepas aura.
- `applyEquipped`: memanggil `equipCostume` untuk pemain. `setVmArms(fpOf(id))`: untuk kostum, `costume.json.fp`; kalau tidak ada, perilaku sekarang.
- `skinFeatures`: label diturunkan dari `costume.json` yang diringkas di katalog: `spring` ("Kain & rumbai bergerak"), `emis` ("Bagian menyala beranimasi"), `mech` ("Berubah bentuk"), `react` ("Bereaksi: kill, isi ulang, lari").
- `skinThumb('char_*')`: mengembalikan URL `costumes/<id>/thumb.webp`. Render runtime dengan `PCHAR` hanya untuk skin yang belum dikonversi. Tanpa ini, membuka toko akan mengunduh semua 18 kostum.
- `warmSkinCache`: bagian karakter cukup mengompilasi program kostum sekali memakai kostum yang sedang dipakai.
- `previewCharacter`: tambah `gunKind`.

### 3.3 `web/game/skinfx.js`
- `CHAR_SKIN_GLSL` / `sfChar` tetap untuk kerumunan dan cadangan.
- Tambah `COSTUME_EM_GLSL`: 5 mode emisi, ±60 baris.
- `CHAR_SLEEVE_GLSL` dipakai ulang oleh FP untuk kostum yang menunjuk `fp.fx` (magma, neon, reaktor, garuda, es, batik, kencana, empu).
- `AURA_*` tetap sampai ketiga legendaris terkonversi.

### 3.4 Nasib aura
`setCharAura` hanya dipanggil bila kostum legendaris gagal dimuat atau belum dikonversi. Setelah M5 stabil selama satu rilis: hapus `auraMaterial`, `setCharAura`, `AURA_*`, dan label `aura`.

### 3.5 Lengan orang pertama (`web/game/weapons.js`)
- `setVmArms(o)` diperluas: `o.maps = { sleeve: {map, normal}, glove: {…}, cuff: {…} }`. Tekstur tileable 512², proyeksi triplanar di ruang objek (`vObjP`/`vObjN` sudah ada di `vmPatch`), lewat define `VM_TRI` pada tiga material itu saja. Geometri tangan tidak punya UV tekstur, hanya `vwx`. `o.fx`, `o.cuffGlow` tetap.
- `setVmArmParts(fpGlb | null)`: memasang node `fp_bracer_l/r` sebagai anak potongan lengan (`armPiece`, `G.handL`, `G.handR`), sejajar sumbu `AX_L` / `AX_R`. Kontrak di Blender: asal = pergelangan, +Y = arah siku, cocok dengan kerucut lengan baju r 0,0345 → 0,047.
- Lengan telanjang (tenun): material `sleeve` diganti warna dan kekasaran kulit, weave 0.
- Kejadian FP (kill, isi ulang) memakai `uSfG` yang ada.

### 3.6 Tangan kiri: akar masalah dan perbaikan

**Akar masalah** (lab `hand.js`, lembar `shots/sheet_hand.jpg` dan `shots/sheet_hand2.jpg`):
1. **`lobby.js:121`:** pose anggota panggung = `{ speed: 0, armed: !!sl2[3], aim: false, pitch: 0, moveYaw: 0 }` tanpa `gunKind`. `rig.js:389` lalu jatuh ke `GRIP.rifle` untuk AR, SMG, dan shotgun. Target tangan kiri SMG meleset 14 cm ke depan, tangan kanan AR 6 cm.
2. **`GRIP` (`rig.js:139`) adalah tabel angka tangan** yang disetel untuk senapan kotak lama. Tabel ini tidak membaca `weapons.json` / node `<jenis>_guard`, padahal itulah pusat telapak kiri yang dipakai orang pertama sejak §31.1. Dengan `gunKind` benar pun jarak telapak→guard pada pose siaga:

   | Senjata | Jarak (cm) |
   |---|---|
   | pistol | 7,5 |
   | revolver | 7,4 |
   | dbs | 7,4 |
   | lmg | 9,6 |
   | pdw | 12,6 |
   | shotgun | 13,3 |
   | burst | 13,5 |
   | ar | 14,9 |
   | smg | 15,1 |
   | sniper | 16,9 |
   | dmr | 19,3 |

   Saat membidik: AR 10,6 cm.
3. **`solveArm` hanya menaruh pergelangan.** Tulang `handL` / `handR` tidak pernah diputar di `pose()`, jadi tangan menggantung searah lengan bawah di bawah senjata, dekat magasin, dengan telapak menghadap samping.
4. **Jari kaku setengah lengkung** (bake `curl=(0.42, 0.55, 0.35)`); tidak ada tulang jari. Ini diperbaiki di M3 lewat tulang genggam, bukan di M1.

**Perbaikan M1** (tidak bergantung pada geometri senjata lama):
- **`weapons.js`:** ekspor `worldGrips()` → `{ [kind]: { l: [x,y,z], r: [x,y,z], mag: [x,y,z] | null, cls: 'long' | 'pistol' } }`.
  - Sumber: `nodeLocal(kind + '_guard')` untuk pusat telapak kiri, asal senjata untuk pegangan kanan, node `<kind>_mag`.
  - Dipindah ke ruang tulang senjata dengan rotasi yang sama dengan `addGearParts`: `(−x, y, −z)`.
  - Kontrak dengan agen senjata: node `<jenis>_guard` tetap ada dan tetap berarti pusat telapak kiri. Itu sudah kontrak orang pertama.
- **`main.js`** (di samping `addGearParts`, baris ±78): `setGripPoints(worldGrips())`.
- **`rig.js`:**
  - `setGripPoints(map)` mengisi tabel modul. `GRIP` lama hanya cadangan bila data tidak ada (halaman peta, GLB gagal).
  - Orientasi tangan diinginkan di ruang senjata per kelas. Senapan (kiri): normal telapak +Y (menopang dari bawah), arah jari (−0,94, 0,34, 0) (melingkar ke sisi kanan-atas). Pistol (kiri): telapak menghadap −X ke gagang, jari ke +Z membungkus. Kanan: telapak menghadap +X ke gagang, jari ke +Z. Konstanta ini tidak bergantung pada bentuk senjata.
  - Target pergelangan = pusat telapak − R_tangan × (0, −0,085, 0). Mesh tangan: jari ke −Y lokal; telapak kiri menghadap −X lokal, kanan +X.
  - Setelah `solveArm`: `hand.quaternion = inv(q_dunia lengan bawah) × q_diinginkan`, dijepit ≤ 75° dari sumbu lengan bawah, bobot `ikW`. Saat `ikW` rendah (terjun, obat, renang) kembali ke identitas.
  - Semua temporer modul; tanpa alokasi.
  - `rl3Point` memakai `mag` dari data.
  - Offset 0,085 dan sudut jari adalah nilai awal; setel di lab sampai metrik lulus.
- **`lobby.js:121`:** tambah `gunKind: sl2[3] || null`.
- **`skins.js previewCharacter`:** sama.
- `player.js` dan `bots.js` sudah mengirim `gunKind`; tidak diubah.

**Lulus M1:**
- Jarak pusat telapak kiri → titik guard ≤ 1,5 cm untuk 11 senjata × (siaga, bidik, jongkok, tiarap, duduk bersenjata), di lobi dan orang ketiga.
- Tidak ada jari menembus sisi atas pelindung pada lembar kontak 4 sudut.
- Isi ulang orang ketiga tetap mulus (filmstrip).
- Biaya `bots` pose untuk 60 bot naik ≤ 0,02 ms.
- Tanpa error konsol.

### 3.7 `web/game/player.js`, `main.js`, `bots.js`
- **`player.js`:** setelah `char.rig.pose(p, dt)` → `char.tick(dt)`. Saat orang pertama, kostum tidak digambar seperti tubuh sekarang, tetapi `tick` tetap dipanggil dengan dt terjepit supaya pegas tidak meledak saat kembali ke orang ketiga.
- **Kamera orang ketiga:** sayap dan kipas memakai alpha dither menurut jarak ke kamera (< 1,3 m mulai pudar), dan posisi diam = terlipat (lebar ≤ 0,4 m, tinggi ≤ kepala + 0,25 m).
- **`main.js kill()`** (di samping `kills.kill`, baris ±409): `me.pose.cheer = 1`.
- **Rekan regu:**
  - Tiap rekan bot memakai `buildCharacter` tunggal (maks. 3) yang membagi `b.rig` milik bot. Tambah opsi `buildCharacter(…, { rig })` supaya tidak membuat Rig kedua.
  - Jarak < 60 m dan di dalam layar: karakter tunggal tampil + `crowd.skipBody(i, true)`. Di luar itu: sebaliknya, dengan palet `far` lewat `crowd.setOutfit`.
  - LOD0 < 12 m, LOD1 di atasnya.
  - Kostum rekan dimuat saat pertandingan mulai, tidak menahan. Sebelum siap, tampil sebagai bot biasa berpalet `far`.

### 3.8 Kompatibilitas profil (`profile.js`)
Tidak ada perubahan skema. `royale.profile.v1`, `owned`, `equipped.character`, `squad[].skin` tetap ID lama. Tidak ada kode koin. Skin tak dikenal → `char_default` (perilaku `BY.get` sekarang).

---

## 4. Lobi dan toko (`lobby.js` / `lobby.css`)

- **Pratinjau.** `stage.preview(id)` sekarang memanggil `build(0, id)`, yaitu membangun ulang karakter. Ganti dengan `members[0].ch.setCostume(await loadCostume(id, varian))`: karakter lama tetap tampil sampai kostum baru terkompilasi, dengan indikator kecil "Memuat kostum…".
- **Putaran.** Tetap meja putar 0,55 rad/dtk. Tambah seret mouse untuk memutar manual; jeda 3 dtk lalu berputar lagi.
- **Peragaan.** Siklus 8 dtk, digerakkan lewat state pose yang sudah ada, tanpa sistem animasi baru:
  - 0–3 dtk: siaga.
  - 3–4,5 dtk: `aim = true` (topeng, paruh, pelat muka menutup).
  - 4,5 dtk: `cheer = 1` (sayap, kipas, kilau).
  - 6–8 dtk: jalan di tempat `speed = 1,4` (kain bergerak).
  - Skin biasa hanya siaga + jalan.
  - Tombol "Peragakan" mengulang dari awal.
- **Kartu toko.**
  - Gambar = `thumb.webp` pra-render.
  - Baris ikon keistimewaan baru: kain bergerak, menyala, berubah bentuk, bereaksi.
  - Legendaris: gambar kedua (keadaan terbuka) bergantian saat hover.
  - Teks kaki toko diperbarui; "aura" dihapus.
- **Kredit.** Tautan "Kredit aset" di panel Pengaturan menampilkan isi `CREDITS.md` (diambil saat dibuka). Wajib hanya bila ada aset CC-BY.
- **Regu.** Panel Regu memakai jalur yang sama (`setCostume`) untuk rekan.

---

## 5. Uji

Semua kait uji tetap di `.wt/_tools`; tidak ada flag di `web/`.

1. **Lembar kontak Blender** (`costumes.py --stage sheet`): 18 kostum × m1 dan f1 × depan, samping, belakang, pose diam + pose pegang senjata. Workbench bertekstur, satu PNG per koleksi.
2. **Lembar kontak peramban.** Skrip harness membangun tiap kostum di panggung lobi, memotret depan/samping/belakang dan keadaan khusus (aim, cheer, lari), lalu `magick montage`. Dibandingkan berdampingan dengan lembar Blender.
3. **Metrik beda** (otomatis, dari render siluet 256×512 depan + samping dengan latar polos):
   - Siluet: `1 − IoU` topeng biner, rata-rata depan + samping.
   - Palet: jarak ΔE (Lab) antara 3 warna dominan berbobot luas (k-means k = 3 pada piksel karakter, emisi ikut dirender).
   - **Gagal** bila ada pasangan dengan `(1 − IoU) < 0,18` dan `ΔE < 22` sekaligus. Target: semua pasangan `(1 − IoU) ≥ 0,12` dan `ΔE ≥ 15`.
   - Ambang dikalibrasi dulu terhadap 18 skin sekarang, yang semestinya gagal massal di siluet (IoU ≈ 1). Laporkan tabel 18×18.
4. **Kecocokan.** Per kostum × 4 varian: verteks menembus tubuh ≤ 1% dan kedalaman ≤ 5 mm (uji BVH seperti `evalpack.py`). Lembar pose ekstrem: jongkok, tiarap, duduk di mobil, terjun, lari. Tidak ada kulit menyembul atau kain tertarik lebih dari 2× panjang diam.
5. **Kinerja** (headless Metal, Ultra, metode kueri waktu GPU min-of-24 berselang seperti §29):
   - Lobi 4 anggota berkostum legendaris: p95 frame ≤ 16,7 ms pada 2560×1440 dpr 2; selisih terhadap 4 skin bawaan dilaporkan.
   - Pertandingan orang ketiga: pass karakter pemain ≤ +0,3 ms GPU terhadap tubuh v3.
   - CPU `tick` (pegas + driver) ≤ 0,03 ms per karakter.
   - Alokasi: 0 objek per frame di `tick` / `pose` (heap snapshot atau `performance.memory` 600 frame).
   - Kerumunan: `bots.draw` dan `crowd.stats()` tidak berubah dengan 60 bot.
   - Tidak ada program shader baru setelah pertandingan mulai (`renderer.info.programs.length` konstan).
   - Lengan orang pertama ber-triplanar ≤ +0,1 ms.
6. **Muat.** Jaringan lobi awal: tidak ada permintaan `costumes/` bila semua anggota memakai `char_default` lama (sebelum M2), atau ≤ 1,7 MB per kostum berbeda. `costumes/` diblokir (404) → game tetap masuk lobi dan pertandingan dengan tampilan lama, tanpa error konsol selain satu `console.warn`.
7. **Profil lama.** Muat profil dengan semua 18 ID dimiliki dan dipakai bergantian; pembelian dan pemakaian tetap jalan.

---

## 6. Milestone (masing-masing bisa dikirim sendiri)

- **M1 — Tangan kiri (kecil).**
  - Isi: §3.6.
  - Berkas: `rig.js`, `weapons.js`, `main.js`, `lobby.js`, `skins.js`.
  - Lulus: kriteria §3.6.
- **M2 — Fondasi + 2 pilot.**
  - Isi: refaktor characters3; `costumes.py`; jalur runtime tanpa pegas dan emisi (`loadCostume`, `costumeMaterial`, `setCostume`, `equipCostume`); thumb pra-render; `CREDITS.md`.
  - Kostum: `char_default`, `char_malam`. 16 lainnya tetap tampilan lama.
  - Lulus: uji 4, 5, 6.
- **M3 — Pegas + tulang genggam + biasa/langka.**
  - Isi: pemecah pegas, `gripL/R`.
  - Kostum: kabut, gurun, rimba, merahputih, samudra, tenun, ondel.
- **M4 — Emisi + epik + lengan orang pertama.**
  - Isi: `COSTUME_EM_GLSL`, texel kejadian, `setVmArms` triplanar, `fp.glb`.
  - Kostum: batik, neon, empu, magma, es, kencana.
- **M5 — Legendaris + rekan regu.**
  - Isi: driver mekanis, `cheer`, dither dekat kamera, rekan regu berkostum di pertandingan, aura menjadi cadangan.
  - Kostum: garuda, warok, reaktor.
- **M6 — Toko/lobi + penutup.**
  - Isi: peragaan, kartu, kredit; kuantisasi GLB; hapus aura dan kode thumb runtime karakter; HANDOFF §35 (bahasa Indonesia); metrik §5.3 lengkap.

**Risiko dan cadangan:**
- **Decimate zirah padat jelek** (helios 142 rb segitiga). Cadangan: jupiter7 (26,6 rb), atau lempeng BL prosedural.
- **Jubah/jarik panjang tertarik di antara kaki.** Rig tanpa tulang rok. Cadangan: bobot tengah dicampur kedua paha + 2–3 rantai pegas depan dengan tumbukan kapsul paha. Bila masih jelek: belahan depan (wiron terbuka), atau dipendekkan ke lutut.
- **Sayap/kipas menutupi kamera orang ketiga.** Posisi diam terlipat + dither dekat kamera (§3.7). Bila masih mengganggu: mekar hanya saat kill dan di lobi.
- **Ponco transparan** (urutan gambar). Alpha dither, bukan blending.
- **Motif Nusantara buatan memakan waktu.** Cadangan: formula GLSL `sfChar` yang sudah ada (batik, tenun) dipanggang ke tekstur lewat skrip peramban di `.wt/_tools`.
- **Paket yang belum dibuka** (P1, D1, SU1) ternyata tidak cocok. Cadangan SYS/BL sudah tertulis per baris katalog.
- **Topeng "hero" di masks01 menyerupai IP** (hood_2 dan hero_mask 3–5: lihat `shots/thumbs_hats_masks.jpg`). Hanya `hood_1` dan `joepal_medical` yang dipakai.
- **Agen senjata mengubah GLB.** M1 membaca node saat runtime. Bila `<jenis>_guard` hilang → cadangan tabel `GRIP` + peringatan konsol.
- **Ukuran repo** (±40–65 MB untuk 18 kostum). Kuantisasi di M6; bila perlu, LOD1 dipisah ke berkas sendiri.
- **Bagian kaku BL di kepala f1/f2 meleset.** Skala dari `head_metrics`; lembar kontak 4 varian wajib untuk tiap bagian kepala.

---

## 7. Penilaian paket kandidat (diuji di Blender 5.2.4 headless, tubuh m1 + f1)

| Aset | Segitiga | Tekstur | Tembus tubuh (m1) | Putusan |
|---|---|---|---|---|
| S2 matcreator_mc-bodysuit-2021 | 55.352 | 4K diffuse, normal, roughness, metallic | 0% | **Pakai** sebagai lapisan dasar zirah (decimate → 3,5 rb) |
| S2 mc-scifi-armor_jupiter7 | 26.598 | 4K diffuse saja | 0,3% / 3,3 mm | **Pakai** (reaktor; cadangan garuda) |
| S2 mc-scifi-armor_helios | 142.468 | 4K diffuse | 3,9% / 6,8 mm | Pakai bersyarat (garuda); berat, uji decimate dulu |
| S2 mc-scifi-armor_guardian | 18.020 | 4K diffuse | 0% | Pakai: hanya bot + bracer |
| S2 joachip_cyborg_suit | 2.380 | 4K PBR lengkap | 2,5% / 29,5 mm | **Tolak**: terlalu kotak, celah 11 cm |
| S2 donitz_monk_robe | 19.820 | 4K diffuse + normal (16 MB PNG) | 6,8% / 67 mm (lengan lebar, wajar) | Pakai dipotong (ondel); risiko kaki |
| S2 donitz_monk_robe_hood | 9.008 | sama | 0,6% | **Pakai** (kabut, es) |
| S2 rehmanpolanski_viking_tunic / pants / boots | 6.568 / 2.544 / 6.320 | 2K / 1K / 1K diffuse | ≤ 1,6% | Bot dipakai (es); tunik dan celana cadangan |
| S2 thegreatengineer_galactic_warrior_uniform | 10.193 | 2K diffuse | 4,4% / 26 mm | Cadangan saja (perlu dorong keluar) |
| H2 mrgreaterthan_m1_helmet | 72.292 | 4K diffuse, normal, roughness | 6,4% (tali dagu) | **Pakai** (gurun), decimate → 1,8 rb |
| H2 culturalibre_motorcycle_helmet | 44.608 | 1K diffuse | 0,1% | **Pakai** (neon), decimate → 2,5 rb |
| H2 warrior_helmet / corinthian / templar | 2.712 / 296 / 6.420 | 2K / 1K / 1,6K | ≤ 0,8% | Tidak dipakai (bergaya Eropa kuno; garuda dan warok dibuat sendiri) |
| H2 culturalibre_skull_helmet | 8.504 | 2K | 7,2% / 54 mm | Tolak |
| M1 hero-heroine_hood_1 | 3.004 | 1K | 0,7% / 4,6 mm | **Pakai** (balaclava malam), tekstur ulang |
| M1 joepal_medical_mouth_protection | 204 | 2K + normal | 0% | **Pakai** (dasar respirator kabut) |
| SH1 culturalibre_male_boots | 30.768 | 1K | 0,7% | **Pakai**, decimate → 1,2 rb |
| SH1 culturalibre_hero_boots_3 | 2.312 | 1K polos | 7,2% / 4,8 mm | Pakai dengan dorong keluar 5 mm (samudra) |

Kesimpulan:
- **Geometri bagus dan pas otomatis di tubuh pria dan wanita.** Lihat `shots/es_0.jpg` dan `shots/es_1.jpg`.
- **Hampir semua terlalu padat.** Decimate 5–40× wajib.
- **Tekstur sebagian besar hanya diffuse.** Rencana menimpa warna dan menambah PBR dari Poly Haven / ambientCG; diffuse asli dipakai sebagai AO/topeng. Ini juga membuat tampilan akhir orisinal.
- **Tidak ada satu pun bagian khas Indonesia di paket.** Sekitar 40% siluet (semua penutup kepala Nusantara, kain, sayap, kipas, keris) harus dibuat sendiri di Blender. Di situ porsi kerja terbesar.

### Critical Files for Implementation
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/map/rig.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/skins.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/tools/blender/characters3.py
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/lobby.js
- /Users/2403077/Documents/web/SENARA_DIGITAL_TWIN/web/game/weapons.js