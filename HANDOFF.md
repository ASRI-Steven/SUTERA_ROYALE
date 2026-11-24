# HANDOFF: SENARA_DIGITAL_TWIN (command center kawasan)

**Status:** belum ada kode. Dokumen ini jadi titik awal.
**Scope Fase 1 terbaru (9 Nov): peta Alam Sutera Tangerang + keluhan, respond ticket, WO yang muncul otomatis. Detailnya di §14, dan §14 lebih diutamakan daripada §6.**
Dibuat 9 Nov 2026 dari diskusi Steven dan Claude. Riwayat lengkapnya ada di `~/Documents/HISTORY_CHAT_ide-project_2026-11-09.md`.
Nama folder masih sementara, silakan diganti.

Semua path di bawah relatif terhadap `~/Documents/web/`, kecuali disebut lain.

---

## 1. Tujuan

Satu layar peta 3D kawasan yang menampilkan kejadian yang sedang berlangsung (keluhan, emergency, WO, kamera lalu lintas) beserta riwayatnya. Nanti ditambah simulasi what-if. Tujuannya supaya tim operasional bisa bertindak lebih cepat dan pola masalah kelihatan.

- **Pemakai:** tim estate management / command center (pantau harian), manajemen (review), dan nanti marketing (versi tanpa data sensitif).
- **Ukuran berhasil:** waktu respon emergency, ketepatan SLA WO, dan jumlah keluhan berulang di lokasi yang sama.
- **Bukan pengganti BO.** Aplikasi ini read-only. Tindakan tetap dilakukan di ASA_BACKOFFICE_WEB atau app staf.
- **Posisinya sebagai digital twin:** Fase 1–2 = tingkat "cermin" dan "analisis". Simulasi (Fase 3+) yang membuatnya jadi digital twin penuh.

## 2. Keputusan yang sudah diambil

| Topik | Keputusan | Alasan |
|---|---|---|
| Tempat | Project baru dengan pola SENARA_ASSET_MANAGEMENT_GOTH (SAMGA) | Datanya lintas sistem, butuh mode TV, tidak milik satu BO |
| Bukan di PetaCuan | — | PetaCuan project pribadi yang publik di Vercel/Supabase |
| Peta | Google Maps JS API (vector map) + deck.gl `GoogleMapsOverlay` | Steven sudah punya akses Google Maps; deck.gl untuk layer data |
| Cadangan peta | MapLibre + PMTiles dari `~/petacuan/jabodetabek.osm.pbf`, disimpan di Garage | Kalau Google tidak bisa dipakai atau harus full on-prem |
| Database | Tetap SQL Server (TownshipDB) lewat SP. **Tanpa time-series DB** untuk sekarang | Datanya event dengan volume kecil, bukan stream |
| Data live | BFF query DB tiap 15–30 detik, di-cache, lalu dikirim ke browser lewat SSE | DB cukup di-query sekali per interval, berapa pun jumlah layarnya |
| Emergency instan (opsional) | Publish ke websocket internal (`SOCKET_URL` + `/publish`, pola `Payment_BCA_Microservice_Golang_API_New/utils/notify.go:55`) | Tidak perlu menunggu polling |

## 3. Stack (ikut SAMGA)

- **web:** React 19 + Vite + TypeScript + Tailwind 3 + @tanstack/react-query, versinya ikut `SENARA_ASSET_MANAGEMENT_GOTH/web/package.json`. Peta pakai `@vis.gl/react-google-maps` + `@deck.gl/google-maps`.
- **bff:** Go 1.23 + chi v5 (ikut `SENARA_ASSET_MANAGEMENT_GOTH/bff/go.mod`), plus driver SQL Server yang sama dengan SAMGA.
- **SSO:** `GET /api/sso/consume?sid=<Session_ID>&next=/`. Salin pola `SENARA_ASSET_MANAGEMENT_GOTH/bff/internal/api/handlers.go:216-224`.
- **Deploy:** docker-compose + nginx seperti SAMGA (`docker-compose.yml`, `web/nginx.conf`).
- **Google Maps:**
  - Map ID tipe vector dengan tilt dan rotation aktif.
  - API key baru khusus project ini, dibatasi HTTP referrer dan hanya untuk Maps JavaScript API (tambah Map Tiles API kalau pakai photorealistic).
  - Jangan pakai key yang di-hardcode di ASA_MOBILE.

## 4. Arsitektur

```
Browser (React + Google Maps + deck.gl)
   |  REST + SSE (/api/*)
Go BFF (chi), cache in-memory per layer (15–30 detik)
   +-- SQL Server TownshipDB: SP baru khusus peta (read-only)
   +-- Console CAKRAWALA: status kamera (pola proxy Township API /traffic/status)
   +-- ZoneMinder (api-zm): stream CCTV di-proxy, token tetap di server
   +-- (opsional) websocket internal: event emergency baru
SSO: Senara Session_ID -> CORE.SecurityManagementDB (pola SAMGA)
```

## 5. Inventaris data (dicek ke kode 9 Nov 2026)

| Layer | Koordinat | Sumber / bukti | Catatan |
|---|---|---|---|
| Keluhan | Ada (Lat/Long dari app) | `Township_Information_System_API/laravel/app/Http/Controllers/API/ComplaintController.php:340-341`, SP `USP_Mobile_ComplaintRequest_Save` | |
| Emergency | Ada | `.../API/CustomerController.php` `save_emergency` (baris 2107), SP `USP_Mobile_Emergency_Save_v2` (@Latitude/@Longitude). Master radius: `ASA_BACKOFFICE_WEB/app/Http/Controllers/Master/EmergencyRadiusController.php` | |
| WO / respond ticket | Tidak ada di kode | SP `usp_Mobile_Admin_WorkOrder_*` (SENARA_MANAGEMENT_API). `WoController.php` dan `RespondController.php` mereferensikan `IDX_T_Complaint*` | Lokasi diambil lewat join ke keluhan. Relasinya perlu dicek |
| Kamera CAKRAWALA | Belum ada | `T_TrafficNotice` cuma menyimpan CameraId/CameraName (`Township_Information_System_API/laravel/app/Services/CakrawalaService.php:121`). Status live lewat `/traffic/status` (README.md:213-228) | Perlu tabel posisi kamera |
| CCTV ZoneMinder | Belum ada | `ZoneMinderController@check_zone_minder` | Perlu pemetaan monitor → posisi |
| Sutera Loop | Belum ada | `.../API/SuteraLoopController.php`: `USP_Mobile_SuteraLoop_Line_List`, `_StopPoint_List`, `_Line_StopPoint_List`. Model app (`~/Documents/mobile/ASA_MOBILE/lib/model/sutera_loop_model.dart`) cuma berisi nama jalur, warna, nama halte, dan jam | Koordinat halte dan garis rute harus dibuat. Posisi bus live juga belum ada. Mungkin SP-nya punya kolom koordinat yang tidak dipakai app, perlu dicek |
| Aset GA | GPS saat opname | `SENARA_ASSET_MANAGEMENT_GOTH/web/src/screens/opname/OpnameFormScreen.tsx` | Fase belakangan |
| Unit / cluster | Belum ada | — | Site plan (DWG) → GeoJSON. Tanya dulu ke SalesDB/tim planning |

## 6. Fase

**Fase 0: prasyarat (bukan kode)**
- [ ] Tentukan pemilik dan pemakai hariannya.
- [ ] Daftarkan app di CORES (IDX_M_Apps baru) beserta menunya, ikut pola Loyalty/SAMGA.
- [ ] Siapkan Google Cloud: Map ID vector (tilt/rotation) dan API key baru yang dibatasi domain.
- [ ] Cek di Google Earth apakah Alam Sutera sudah tampil 3D foto-realistis.
- [ ] Siapkan domain dan server Docker.
- [ ] Minta site plan DWG/DXF ke tim planning.
- [ ] Kumpulkan posisi kamera CAKRAWALA (dari console / repo SS_CCTV_CV) dan daftar monitor ZoneMinder.
- [ ] Minta akun DB read-only untuk BFF ke DBA.
- [ ] Minta API key console CAKRAWALA khusus BFF. Township API memakai `CAKRAWALA_*` di .env-nya sendiri.
- [ ] Siapkan kredensial ZoneMinder untuk proxy stream.
- [ ] Buat koordinat halte dan garis rute Sutera Loop (digambar sekali, simpan sebagai GeoJSON).

**Fase 1: cermin (peta live)**
- Layer: keluhan aktif, emergency aktif, WO berjalan (koordinat lewat keluhan), kamera (status CAKRAWALA), jalur dan halte Sutera Loop.
- Versi minimal yang paling cepat jalan: keluhan + emergency saja, karena koordinatnya sudah ada. Kamera dan Sutera Loop menyusul setelah posisinya tersedia.
- Buang titik yang koordinatnya kosong, (0,0), atau di luar kawasan. Filternya pakai master Emergency Radius.
- UI: layout home seperti di §7. Klik item → peta terbang ke lokasi dan kamera terdekat tampil. Ada mode TV.
- Dianggap selesai kalau:
  - Kejadian baru muncul paling lambat 30 detik setelah dibuat.
  - Layar TV bisa jalan 8 jam tanpa reload.
  - Tidak ada token atau API key internal yang terkirim ke browser.

**Fase 2: analisis**
- Heatmap dan timeline (24 jam / 30 hari, bisa replay), SLA WO per area, keluhan berulang per lokasi.
- Polygon unit/cluster dari site plan, diwarnai sesuai status.

**Fase 3: what-if (mulai dari yang datanya sudah siap)**
- Respon emergency: kalau pos security dipindah atau ditambah, waktu tempuh rata-rata jadi berapa (pakai jalan OSM + riwayat emergency).
- Beban WO: kalau teknisi ditambah, berapa persen WO yang selesai dalam SLA (pakai riwayat WO).
- Simulasinya jalan sebagai job Python di backend. Hasilnya jadi layer "sebelum vs sesudah".

**Fase 4: nanti**
- Simulasi genangan (DEMNAS + jaringan saluran + data hujan, pakai SWMM).
- Simulasi lalu lintas (SUMO + hitungan kendaraan per kamera).
- GPS bus Sutera Loop live. Kalau data seperti ini sudah ada, baru pertimbangkan TimescaleDB atau columnstore di SQL Server.

## 7. Tampilan home

```
+--------------------------------------------------------------------+
| Command Center Alam Sutera      Sen 09 Nov 14:32   (!) 1 emergency |
+--------------+-------------------------------------+---------------+
| LAYER        |                                     | PERLU TINDAKAN|
| [x] Keluhan  |      peta 3D miring                 | (!) Emergency |
| [x] Emergency|      - gedung 3D                    |     Cluster X |
| [x] WO       |      - cluster diwarnai per status  | WO lewat SLA  |
| [x] Kamera   |      - titik berdenyut = emergency  | 5 keluhan PJU |
| [ ] Sutera   |      - ikon kamera merah = macet    |     Cluster Y |
|     Loop     |      - garis = jalur Sutera Loop    |               |
| HARI INI     |                                     | KAMERA        |
| Keluhan  24  |                                     | [feed live]   |
| WO aktif 11  |                                     |               |
+--------------+-------------------------------------+---------------+
| <  timeline 24 jam (geser untuk replay)  >                         |
+--------------------------------------------------------------------+
```

Pilihan tampilan gedung 3D:
1. Gedung 3D bawaan Google vector map.
2. Photorealistic 3D, kalau Alam Sutera sudah tercakup.
3. Polygon site plan yang ditinggikan sesuai jumlah lantai dan diwarnai sesuai data.

Pakai #1 atau #2 sebagai dasar, lalu tumpuk #3 di atasnya.

## 8. Draft kontrak API BFF (Fase 1)

| Method | Path | Isi |
|---|---|---|
| GET | `/api/sso/consume?sid=&next=` | SSO Senara (salin dari SAMGA) |
| GET | `/api/summary` | Angka hari ini: keluhan baru, emergency aktif, WO aktif, WO lewat SLA |
| GET | `/api/layers/complaints?status=active` | `[{id, lat, lng, kategori, status, dibuat, cluster}]` |
| GET | `/api/layers/emergencies?status=active` | `[{id, lat, lng, jenis, status, dibuat}]` |
| GET | `/api/layers/work-orders?status=open` | `[{id, complaintId, lat, lng, status, dibuat, batasSla}]` |
| GET | `/api/layers/cameras` | `[{cameraId, nama, lat, lng, status}]` |
| GET | `/api/layers/sutera-loop` | `{lines: [...], stops: [...]}` |
| GET | `/api/stream` | SSE, event `layer-updated` berisi `{layer, versi}` |
| GET | `/api/cameras/{id}/stream` | Proxy MJPEG, token tetap di server |

Aturan payload:
- Payload harus kecil. Jangan kirim foto atau base64 (pelajaran dari kasus lambatnya QMS).
- Data pribadi (nama dan telepon pelapor) tidak masuk layer peta. Untuk detail, tautkan ke BO.

## 9. Draft DB (semua DRAFT, Steven yang memfinalkan dan menjalankan)

Standar yang dipakai:
- Tabel master `M_`, transaksi `T_`, report `R_`. PK `IDX_<tabel>`.
- Kolom audit `DCreate`, `UCreate`, `DModified`, `UModified`, `RecordStatus` (default `'A'`).
- Selalu buat SP baru, jangan ALTER SP lama. Versinya naik `_v2`, `_v3`, dan seterusnya.

Isi draft:
- Tabel `M_CameraLocation` di TownshipDB: `IDX_M_CameraLocation`, `CameraId` (dari CAKRAWALA), `CameraName`, `ZoneMinderMonitorId` (nullable), `Latitude`, `Longitude`, `Township`, plus kolom audit.
- SP read-only (nama usulan, prefix `usp_DT_` = Digital Twin):
  - `usp_DT_R_ComplaintMap_List` (@Status, @Since) → id, lat, lng, kategori, status, DCreate, cluster
  - `usp_DT_R_EmergencyMap_List`
  - `usp_DT_R_WorkOrderMap_List` (join ke keluhan untuk ambil koordinat)
  - `usp_DT_R_Summary_Today`
  - `usp_DT_M_CameraLocation_List`
- Akun DB khusus read-only untuk BFF, yang hanya boleh EXEC SP `usp_DT_*`.

## 10. Pertanyaan terbuka

1. Siapa pemilik dan pemakai hariannya? Ini menentukan prioritas fitur.
2. Nama project dan domain finalnya apa?
3. Apakah semua WO berasal dari keluhan? Kalau ada WO tanpa keluhan, lokasinya harus diambil dari tempat lain.
4. Kolom koordinat keluhan dan emergency ada di tabel dan kolom apa? Bisa dicek dari isi SP `USP_Mobile_ComplaintRequest_Save` dan `USP_Mobile_Emergency_Save_v2` (Steven yang cek).
5. Apakah posisi kamera tersedia di console CAKRAWALA (repo SS_CCTV_CV)? Kalau tidak, `M_CameraLocation` diisi manual.
6. Apakah file site plan DWG ada? Kalau ada, sudah pakai koordinat UTM 48S atau masih koordinat lokal?
7. Apakah perlu bisa diakses dari luar jaringan kantor, misalnya untuk presentasi?

## 11. Aturan kerja (berlaku untuk siapa pun yang melanjutkan, termasuk Claude)

- Jangan query DB langsung. SQL dibuat sebagai file, Steven yang menjalankan.
- Jangan tambah env atau flag testing di kode maupun .env.
- Kalau mengubah SP, buat versi baru. Jangan ALTER SP lama.
- Jangan commit atau push tanpa diminta.
- Jawaban singkat dan to the point.

## 12. Langkah berikutnya

1. Steven menjawab pertanyaan terbuka nomor 1–4.
2. Claude membuat scaffold project (salin struktur SAMGA: `web/`, `bff/`, `sql/`, `docker-compose.yml`) beserta file SQL draft dari §9.
3. Steven menjalankan SQL di dev, lalu Fase 1 dijalankan di lokal dengan data dev.

**File referensi yang perlu dibaca dulu:**
- `SENARA_ASSET_MANAGEMENT_GOTH/README.md`
- `SENARA_ASSET_MANAGEMENT_GOTH/bff/internal/api/handlers.go` (SSO)
- `Township_Information_System_API/README.md:213-228` (CAKRAWALA)
- `Township_Information_System_API/laravel/app/Services/CakrawalaService.php`
- `Payment_BCA_Microservice_Golang_API_New/utils/notify.go` (websocket publish)

## 13. Detail simulasi (Fase 3–4): sumber data dan cara kerja

### 13.1 Respon emergency (pos security). Kesiapan: siap
| Data | Sumber |
|---|---|
| Riwayat emergency + koordinat + waktu | TownshipDB. Koordinat dari SP `USP_Mobile_Emergency_Save_v2`. Waktu selesai (FinishTime) ditambahkan di CR ASA Fase 3 (AFRD-BDS25-025), cek tabelnya. Perlu SP baru untuk menarik riwayatnya |
| Posisi pos security | Belum ada di sistem. Minta daftarnya ke tim security/estate, lalu simpan di tabel `M_SecurityPost` (lat, lng, shift) |
| Jaringan jalan | OSM: ekstrak Geofabrik/Overpass, atau `~/petacuan/jabodetabek.osm.pbf`. Cek apakah jalan dalam cluster dan gerbangnya (`barrier=gate`) sudah benar |
| Kecepatan | Asumsi per jenis jalan atau kecepatan patroli (motor). Dikalibrasi dengan waktu respon asli |

Cara kerja (Python `osmnx` + `networkx`):
1. Bentuk graf jalan dari OSM.
2. Untuk tiap emergency historis, hitung waktu tempuh terpendek dari pos terdekat.
3. Hitung rata-rata, P50, dan P90.
4. Untuk skenario, pindah atau tambah pos lalu hitung ulang. Bisa juga dioptimasi otomatis (p-median / maximal coverage): taruh k pos di titik yang membuat P90 paling kecil.
5. Hasil di peta: area jangkauan 5 dan 10 menit (isochrone) sebelum vs sesudah, plus angka P50/P90.

### 13.2 Beban WO (jumlah teknisi). Kesiapan: siap
| Data | Sumber |
|---|---|
| Riwayat WO: dibuat, di-assign, mulai, selesai, kategori, lokasi | SP `usp_Mobile_Admin_WorkOrder_*` (SENARA_MANAGEMENT_API: Assign_Save, Finish, Info). Tanggal mulai WO ditambahkan di CR Fase 3. Perlu SP baru untuk riwayatnya |
| Jumlah teknisi per hari | Dihitung dari data assignment WO. Jadwal shift minta ke estate kalau tidak ada di sistem |
| Target SLA per kategori | Cek master. Kalau belum ada, minta targetnya ke estate |

Cara kerja (discrete-event simulation, Python `SimPy`):
1. WO datang mengikuti pola historis per jam/hari.
2. WO dikerjakan teknisi yang sedang kosong, dengan durasi kerja diambil dari distribusi historis per kategori.
3. Kalibrasi: jalankan dengan jumlah teknisi asli bulan lalu, lalu bandingkan % SLA hasil simulasi dengan % SLA aslinya.
4. Jalankan skenario N+1, N+2, dan seterusnya. Hasilnya % WO dalam SLA dan rata-rata waktu tunggu, per area.

### 13.3 Genangan (SWMM). Kesiapan: berat
| Data | Sumber |
|---|---|
| Elevasi | DEMNAS (BIG, gratis, ~8 m, tanahair.indonesia.go.id). Untuk skala kawasan masih kasar. Lebih bagus pakai survei topografi/peil dari engineering atau scan drone |
| Jaringan saluran | As-built drawing dari engineering: saluran, gorong-gorong, dimensi, kemiringan, elevasi dasar, outfall, pompa, kolam retensi |
| Hujan | BMKG (dataonline.bmkg.go.id), NASA GPM IMERG untuk event historis, atau pasang rain gauge sendiri. Skenario pakai hujan rencana (kurva IDF) |
| Kalibrasi | Titik genangan historis dari keluhan (kalau ada kategori banjir/genangan di master kategori keluhan) beserta fotonya |

Cara kerja:
1. **Langkah awal tanpa SWMM:** analisis titik rendah dari DEM, ditumpuk dengan riwayat keluhan genangan. Hasilnya peta rawan genangan.
2. **SWMM (EPA, open source, Python `pyswmm`):** bagi kawasan jadi sub-catchment (luas dan % permukaan kedap dari site plan/citra), masukkan saluran dan junction, lalu jalankan event hujan. Hasilnya node yang meluap (volume dan durasi). Luasan genangan diperkirakan dari DEM di sekitar node.
3. Butuh orang yang paham hidrologi. Pertimbangkan melibatkan engineering atau konsultan.

### 13.4 Lalu lintas (SUMO). Kesiapan: berat
| Data | Sumber |
|---|---|
| Jaringan jalan | OSM, dikonversi dengan `netconvert --osm`. Cek lajur, satu arah, dan lampu lalu lintas |
| Volume kendaraan per kamera per interval | Belum pasti ada. Console CAKRAWALA baru terlihat mengirim status (started/red/ended). Cek di repo SS_CCTV_CV apakah ada hitungan kendaraan (kontraknya `docs/ASA-MOBILE-TRAFFIC.md`) |
| Lampu lalu lintas | Timing dari estate/Dishub, kalau ada |
| Validasi | Riwayat status macet CAKRAWALA (`T_TrafficNotice`) |

Cara kerja:
1. Bangun jaringan jalan dan pasang "detektor" di posisi kamera.
2. Bentuk rute kendaraan yang cocok dengan hitungan kamera (`routeSampler`).
3. Jalankan baseline, lalu cocokkan jam-jam macetnya dengan riwayat CAKRAWALA.
4. Jalankan skenario, misalnya jalan X ditutup untuk event. Hasilnya segmen jalan yang macet, waktu tempuh, dan panjang antrean, ditampilkan sebelum vs sesudah.

### 13.5 GPS bus Sutera Loop: belum ada (dicek 9 Nov 2026)
- Township API `SuteraLoopController.php` cuma memanggil 3 SP list: jalur, halte, dan jam.
- Master di BO (`ASA_BACKOFFICE_WEB/resources/views/master/sutera-loop/`) tidak punya field koordinat. Form halte cuma berisi IDX dan state, form jalur berisi LineColor.
- App warga cuma menampilkan daftar, tanpa peta dan tanpa URL tracking.
- Tidak ada kata tracking, GPS, armada, atau fleet di repo mana pun di Mac.
- Masih mungkin busnya pakai GPS dari operator/vendor di luar sistem ini. Tanyakan ke tim/operator Sutera Loop, dan cek juga project yang masih ada di Parallels.
- Kalau memang belum ada, ada dua pilihan:
  1. GPS tracker 4G di tiap bus + Traccar (open source). BFF tinggal membaca posisi dari Traccar.
  2. App sederhana di HP sopir yang mengirim lokasi. Lebih murah, tapi kurang andal.
- Begitu ini jalan, datanya jadi rapat (posisi tiap 5–10 detik). Di titik inilah time-series DB atau tabel berpartisi mulai relevan.

### 13.6 Alternatif tools lalu lintas (gratis)

Ada dua pekerjaan yang berbeda:
- **Hitung kendaraan** = computer vision dari CCTV. Ini data asli.
- **Simulasi** = what-if, memakai data hitungan itu sebagai input.

TraCI bukan pengganti SUMO. TraCI adalah API Python untuk mengendalikan SUMO yang sedang jalan: menutup jalan di tengah simulasi, membaca antrean, atau menarik posisi kendaraan simulasi untuk dianimasikan di peta. Versi in-process yang lebih cepat namanya `libsumo`.

**Hitung kendaraan (data asli)**
| Tool | Lisensi | Catatan |
|---|---|---|
| Cek CAKRAWALA / repo SS_CCTV_CV dulu | — | Console-nya sudah menganalisis kamera lalu lintas, jadi mungkin hitungannya sudah ada dan tinggal dibuka |
| Roboflow `supervision` + ByteTrack | MIT | Hitung kendaraan yang melewati garis (LineZone) per kelas: motor, mobil, bus, truk |
| Detector YOLOX / RT-DETR | Apache-2.0 | Model deteksinya. Ultralytics YOLO juga gratis tapi AGPL-3.0, jadi cek dulu kalau mau dipakai sebagai layanan |
| OpenCV (background subtraction) | Apache-2.0 | Paling ringan dan cukup CPU, tapi akurasinya rendah |
| Frigate | MIT | NVR dengan deteksi objek. Bisa berdampingan dengan ZoneMinder |
| NVIDIA DeepStream | Gratis (lisensi NVIDIA) | Untuk banyak kamera, butuh GPU NVIDIA |

**Simulasi lalu lintas**
| Tool | Lisensi | Level | Catatan |
|---|---|---|---|
| OSMnx + NetworkX | MIT / BSD | Statis | Paling ringan, tanpa data hitungan. Tutup jalan X, lalu lihat ruas mana yang jadi rute alternatif (betweenness sebelum vs sesudah) |
| UXsim | MIT | Meso | Murni Python (`pip install uxsim`), cepat, cocok untuk what-if tutup jalan di level jaringan |
| SUMO + TraCI / libsumo | EPL-2.0 | Mikro | Paling detail: lajur, persimpangan, lampu. Bisa animasi di peta lewat TraCI |
| CityFlow | Apache-2.0 | Mikro | Cepat, sering dipakai untuk riset lampu lalu lintas. Sudah jarang diupdate |
| MATSim | GPL-2.0 | Agent-based | Java, untuk pola perjalanan skala kota. Terlalu besar untuk satu kawasan |
| A/B Street | Apache-2.0 | Mikro (seperti game) | Impor OSM, bisa edit jalan lalu lihat efeknya. Bagus untuk demo, tapi pengembangannya melambat |

**Urutan yang disarankan:**
1. Cek CAKRAWALA dulu.
2. OSMnx (tanpa data hitungan).
3. UXsim.
4. SUMO + TraCI, kalau sudah perlu detail persimpangan dan lampu.

### 13.7 Update 9 Nov: hitungan kendaraan katanya sudah dibuat di CAKRAWALA
Ini masih kabar, belum dicek. Repo SS_CCTV_CV tidak ada di Mac, mungkin ada di Parallels.

Yang terlihat dari Township API:
- Webhook cuma meneruskan `state` (started/red/ended), `level`, dan `camera {id, name}`. Sisanya disimpan mentah di kolom `Payload` di `T_TrafficNotice` (`CakrawalaService.php:94-130`).
- Status live: `CAKRAWALA_PUBLIC_BASE_URL` + `/public/traffic/{township}`, pakai key `CAKRAWALA_PUBLIC_TRAFFIC_KEY`, cache 20 detik.

Cek apakah Payload berisi hitungan (Steven yang run, di TownshipDB):
```sql
SELECT TOP 5 NoticeId, CameraId, CameraName, [State], [Level], SentAt, Payload
FROM T_TrafficNotice
WHERE IsTest = 0
ORDER BY DCreate DESC;
```

Pertanyaan untuk pemilik CAKRAWALA:
1. Hitungannya per kamera per interval berapa menit? Dipisah per jenis kendaraan dan per arah?
2. Riwayatnya disimpan di mana, dan berapa lama?
3. Ada endpoint untuk riwayat dan data live (pakai key seperti `CAKRAWALA_PUBLIC_TRAFFIC_KEY`), atau bisa dibuatkan?
4. Posisi kamera (lat/long) dan arah pandangnya ada di console? Kalau ada, `M_CameraLocation` tidak perlu diisi manual.
5. Garis hitung tiap kamera ada di ruas jalan mana? Ini dibutuhkan untuk memasang detektor di UXsim/SUMO.

Kalau hitungannya memang ada, simulasi lalu lintas naik dari "berat" ke "sedang". Layer kamera di peta juga bisa langsung menampilkan volume, bukan cuma merah/hijau.

### 13.8 Update 9 Nov: kata Steven, hitungan kendaraan dan simulasi lalu lintas "semuanya" sudah dibuat di CAKRAWALA
Belum dicek, karena repo SS_CCTV_CV tidak ada di Mac. Kalau benar:
- **Bagian lalu lintas jangan dibuat ulang.** Digital twin cukup mengambilnya dari CAKRAWALA lewat API. Tools di §13.4 dan §13.6 jadi cadangan saja.
- **Digital twin fokus ke yang belum ada:** keluhan, emergency, WO, Sutera Loop, aset, what-if emergency dan WO, plus menggabungkan semuanya dalam satu peta.
- **Yang dibutuhkan dari CAKRAWALA:**
  - API untuk hitungan live dan riwayat per kamera.
  - Posisi dan arah tiap kamera.
  - API untuk menjalankan skenario simulasi (input: jalan ditutup, jam; output: ruas macet, waktu tempuh) dengan format hasil yang bisa ditaruh di peta (GeoJSON).
  - Key/akses untuk BFF.
- **Langkah:** baca repo/docs SS_CCTV_CV dulu (kemungkinan ada di Parallels) atau tanya pemiliknya, sebelum mendesain layer lalu lintas.

## 14. Scope Fase 1 terbaru (9 Nov 2026): peta Alam Sutera + keluhan, respond ticket, WO

**Arahan:** mulai dari peta Alam Sutera (Tangerang). Kalau ada keluhan baru, otomatis muncul di peta. Fokus ke alur keluhan → respond ticket → WO. Lalu lintas (CAKRAWALA, nanti dilanjutkan tim lain), Sutera Loop, emergency, dan aset menyusul.

### 14.1 Alur data (dari kode)
```
Keluhan: header -> detail (IDX_T_ComplaintHeader, IDX_T_ComplaintDetail)
  dibuat dari app warga: USP_Mobile_ComplaintRequest_Save (membawa Latitude/Longitude)
  atau dari BO:          usp_T_ComplaintRequest_Create_v, usp_T_ComplaintRequestDetail_Save_v
  |
  +-- Respond ticket, per IDX_T_ComplaintDetail
  |     app staf: usp_Mobile_Admin_Respond_Save / _Finish_v / _Reject / _Close
  |     BO:       usp_T_RespondTicketDetail_Save_v / _Finish_v / _Reject_v
  |
  +-- WO, per IDX_T_ComplaintDetail (WorkOrderAssign, WorkOrderItem)
        app staf: SENARA_MANAGEMENT_API WoController (usp_Mobile_Admin_WorkOrder_*)
        BO:       usp_T_WorkOrderAssign_*
```
- Nama tabel kemungkinan `T_ComplaintHeader`, `T_ComplaintDetail`, `T_WorkOrderAssign`, `T_WorkOrderItem`. Ini disimpulkan dari nama PK (standar `IDX_<tabel>`), jadi perlu dikonfirmasi.
- **Koordinat** diambil dari keluhan. Respond ticket dan WO ikut keluhannya lewat `IDX_T_ComplaintDetail`.
- **WO dari keluhan?** Di kode, WO selalu membawa `@IDX_T_ComplaintDetail` (12 kali di `WoController.php`), jadi kemungkinan besar semua WO berasal dari keluhan. Perlu dikonfirmasi.

### 14.2 Tahap per titik (warna marker)
| Tahap | Kondisi | Tampilan |
|---|---|---|
| Baru | Keluhan belum direspon | Merah, berdenyut |
| Direspon | Sudah ada respond ticket, belum ada WO | Oranye |
| WO berjalan | WO sudah di-assign, belum selesai | Biru |
| Selesai | Respond/WO sudah finish | Hijau |
| Ditutup / ditolak | Close atau reject | Abu-abu, disembunyikan secara default |

Kolom status yang menandai tiap tahap dipetakan Steven dari SP yang sudah ada (`usp_T_ComplaintRequest_List_v`, `usp_T_RespondTicket_List_v`, list WO).

### 14.3 Supaya muncul otomatis
- BFF memanggil `usp_DT_R_ComplaintMap_List @SinceModified` tiap 15 detik. Yang diambil hanya baris yang berubah sejak cursor terakhir. Hasilnya disimpan di cache, lalu delta-nya dikirim ke browser lewat SSE.
- Di browser: titik baru muncul dengan animasi berdenyut, dan masuk ke panel "Perlu tindakan".
- Target: keluhan baru sudah muncul di peta paling lambat 30 detik setelah dibuat.
- Kalau nanti butuh instan: Township API publish ke websocket internal setiap kali menyimpan keluhan (opsional, perlu mengubah Township API).

### 14.4 Peta Alam Sutera
- Google Maps vector map. Titik tengah dan batas peta diambil dari master Emergency Radius area Alam Sutera, atau dari polygon kawasan yang digambar sekali.
- Buang titik yang di luar radius, (0,0), atau koordinatnya kosong.
- Gedung pakai 3D bawaan Google dulu. Polygon cluster dari site plan menyusul di Fase 2.

### 14.5 Draft kontrak SP (isi SP ditulis Steven)
`usp_DT_R_ComplaintMap_List`
- Input: `@Area` (area Alam Sutera), `@SinceModified DATETIME = NULL`, `@IncludeClosed BIT = 0`
- Output satu baris per `IDX_T_ComplaintDetail`:
  - `IDX_T_ComplaintHeader`, `IDX_T_ComplaintDetail`
  - `Latitude`, `Longitude`
  - `IDX_M_ComplaintType`, `ComplaintTypeName`
  - `Tahap`
  - `DCreate` (waktu keluhan), `DRespond`, `DWorkOrderAssign`, `DFinish`, `DClose`
  - `DModified` (yang paling akhir di antara keluhan/respond/WO)
  - `Cluster`/`UnitCode` kalau ada
- Tanpa foto, dan tanpa nama/telepon pelapor.

`usp_DT_R_ComplaintMap_Summary`
- Untuk angka panel: keluhan baru hari ini, belum direspon > X jam, WO berjalan, selesai hari ini.

### 14.6 Panel "Perlu tindakan" (Fase 1)
- Keluhan baru yang belum direspon > X jam.
- Respond yang ditolak.
- WO berjalan yang melewati SLA (kalau target SLA-nya ada).

### 14.7 Pertanyaan khusus Fase 1
1. Area/township mana saja yang termasuk "Alam Sutera Tangerang" (ID area di DB)?
2. Kolom status mana yang menandai tiap tahap di header, detail, respond, dan WO?
3. Koordinat keluhan disimpan di header atau di detail?
4. Berapa ambang "belum direspon > X jam" dan target SLA WO per kategori?
5. Keluhan yang dibuat staf dari BO juga punya koordinat? Form `complaint_request_form.blade.php` memuat field koordinat/peta.

### 14.8 Langkah
1. Steven menjawab pertanyaan 1–3 (cek isi SP yang disebut di §14.2).
2. Claude membuat scaffold (pola SAMGA), file SQL draft sesuai kontrak §14.5, dan peta Alam Sutera dengan layer keluhan.
3. Steven menjalankan SQL di dev. Uji: buat keluhan dari app versi dev, lalu pastikan muncul di peta paling lambat 30 detik.

## 15. Status integrasi keluhan (9 Nov 2026)

- SP `dbo.usp_DT_R_ComplaintMap_List` (`sql/001_…`) sudah dijalankan Steven di TownshipDB dev.
- BFF Go (`bff/`, pola SAMGA: chi + go-mssqldb) menyajikan `web/` dan `/api/stream` (SSE), `/api/complaints`, `/api/health`.
  - `.env` disalin dari `.env` Township API (server TownshipDB dev), `AREA_ID=1`.
- Cara jalan:
  ```
  cd bff && ./bin/alsut3d-bff
  ```
  Lalu buka http://127.0.0.1:8765. Build ulang (offline dari cache modul): `GOPROXY=off GOSUMDB=off go build -o bin/alsut3d-bff ./cmd/server`.
- Uji pertama: 551 keluhan terbuka. Tahapnya Direspon 498, Baru 51, WO 2. Sumber koordinat: GPS app 368, lokasi unit 101, tanpa koordinat 82. Yang masuk kotak Alam Sutera 419.
- Temuan: semua "Direspon" di dev berumur 75–656 hari dengan status header/detail `PROCESS` (data lama yang tidak pernah ditutup). Perlu dipastikan ke bisnis status mana yang berarti selesai. Kalau perlu, tambahkan batas umur untuk keluhan terbuka di SP versi berikutnya (`_v2`).

## 16. Mode Jelajah orang ketiga (9 Nov 2026)

- Kode: `web/map/walk.js` (modul baru), disambungkan di `web/map/alsut3d.js` (bayangan, label, `flyTo` → teleport, klik peta, loop), tombol `#walkBtn` di `web/index.html`, gaya `.wk-*` di `web/map/alsut3d.css`.
- Alur: tombol orang berjalan di kontrol kanan → klik titik di peta → avatar muncul di situ, kamera menukik ke belakangnya. Titik di dalam gedung/rumah → muncul di jalan terdekat menghadap titik itu; kalau tidak ada jalan, di depan gedung.
- Kendali: W A S D / panah (kiri-kanan memutar kamera), Shift lari, Spasi lompat, seret = putar kamera, scroll = jarak kamera, E = info terdekat (keluhan ≤ 28 m, gedung yang ditabrak, tempat ≤ 30 m), M / "Pindah" = pilih titik baru, H = petunjuk, Esc = keluar. Layar sentuh: joystick + tombol lompat.
- Gedung (kecuali atap/kanopi), air, batang pohon, dan tepi kawasan padat. Kamera naik melewati atap kalau terhalang.
- HUD: nama cluster (atau tempat terdekat) + nama jalan, minimap berputar ikut kamera (klik = pindah, scroll = zoom, titik keluhan ikut tampil). Hasil cari, tombol kartu "Pindah ke sini", dan notifikasi "Lihat di peta" = teleport saat mode jelajah.
- Ringan: bayangan matahari dihitung ulang tiap avatar pindah 45 m (jendela ±240 m); bayangan avatar pakai bulatan lunak. Pin keluhan diturunkan ke 10 m selama jelajah.
- Belum ada: interior gedung (OSM hanya bentuk luar + tinggi). Opsi: foto 360° per gedung (E di depan pintu → tur 360), atau model 3D `.glb` dari arsitek/BIM untuk benar-benar berjalan di dalam.
- Sudah dites di Chrome headless (GPU Metal) lewat CDP: desktop 1440×900 dan emulasi HP 390×844 (sentuh), tanpa error console.

## 17. Karakter v2, jelajah v2, dan game Sutera Royale (9 Nov 2026)

- Modul bersama baru di `web/map/`:
  - `world.js`: pembangun dunia 3D, dipindah dari `alsut3d.js`.
  - `collide.js`: tabrakan, sinar peluru, dan garis pandang.
  - `rig.js`: karakter bersendi dengan animasi prosedural (jalan, lari, jongkok, lompat, terjun, payung, bidik, kena tembak, mati), versi tunggal dan versi kerumunan instans.
  - `mapview.js`: minimap dan peta besar.
- Jelajah v2:
  - Kontrol: mouse langsung menggerakkan kamera (pointer lock, tanpa klik tahan), V orang pertama/ketiga, M peta besar (klik = pindah), F/E info.
  - Panel kiri dan notifikasi disembunyikan selama jelajah.
- Game `web/royale.html` + `web/game/*.js`: battle royale orisinal (bukan tiruan aset/nama game lain), 1 pemain vs 50 bot mudah.
  - Pesawat. Terjun hanya bisa di atas kawasan; terjun otomatis sebelum pesawat keluar.
  - Terjun bebas → payung otomatis di 120 m.
  - Loot di sekitar gedung, plus jaminan senjata di depan pemain saat mendarat.
  - 5 senjata: Pistol P9, SMG Kilat, Senapan Garuda, Shotgun Badai, DMR Elang.
  - Perban/P3K, rompi & helm lv.1–3, peti jarahan dari yang tersingkir.
  - Zona ungu menyusut 8 fase (±12 menit).
  - Bot:
    - ±60% mendarat di titik panas.
    - 70% langsung bersenjata.
    - Navigasi A* di jaringan jalan.
    - Reaksi 0,75–1,35 dtk, sebaran bidik ±2,7°, damage ke pemain ×0,6.
- Uji Chrome headless (GPU Metal):
  - Alur menu → pesawat → terjun → ambil senjata → tembak → layar akhir tanpa error console.
  - Bot saling menyingkirkan (±18 dalam 2,5 menit setelah mendarat).
  - ±120 fps di darat (1440×900).
- Tingkat kesulitan Mudah / Sedang / Sulit dipilih di menu (tersimpan di browser). Preset di `DIFFICULTY` dalam `web/game/bots.js`; pengali kerusakan ke pemain di `main.js`:
  - Reaksi: Mudah 0,75–1,35 dtk, Sedang 0,45–0,85 dtk, Sulit 0,24–0,5 dtk.
  - Sebaran bidik ke pemain: Mudah 2,7°, Sedang 1,8°, Sulit 1,15°.
  - Jarak lihat: Mudah 95 m, Sedang 130 m, Sulit 170 m.
  - Kerusakan ke pemain: Mudah ×0,6, Sedang ×0,85, Sulit ×1.
  - Pelindung saat mendarat: Mudah tidak ada; Sedang ±35% rompi / 25% helm; Sulit ±65% / 50%.
  - Jongkok saat baku tembak jarak jauh: Mudah tidak pernah; Sedang dan Sulit ada peluangnya.
  - Antar-bot sengaja dilunakkan (bidikan ≥ 2,3°, kerusakan ×0,65) supaya arena tidak habis sebelum pemain sempat bertarung. Di level Sulit, ±setengah bot masih hidup 2 menit setelah mendarat.
- Belum ada: kendaraan, interior gedung (butuh model dari tim planning: GLB/FBX/IFC/SketchUp atau DWG per lantai), multipemain.
- Perbaikan 9 Nov (lanjutan):
  - Membidik:
    - Red dot senapan sekarang berbingkai terbuka (dulu kotak padat menutupi tengah layar).
    - Bidikan besi pistol, SMG, dan shotgun diselaraskan.
    - Kilatan moncong mengecil saat membidik.
    - Teropong DMR lebih lebar; HUD tetap tampil di atasnya.
  - Bug yang sudah dibetulkan: prompt ambil barang, bar isi ulang, dan teropong sempat tidak tampil karena satu baris di `main.js` tertelan komentar.
  - Peta besar & minimap (jelajah dan game) menampilkan nama tempat:
    - Landmark dan cluster selalu tampil.
    - Fasilitas kecil muncul saat diperbesar.
    - Lokasi pemain tampil di bawah kompas game.
- Zona dirombak (9 Nov, setelah masukan Steven):
  - Alur fase:
    - **Kawasan aman** (±75 dtk, tanpa dinding).
    - **Zona ditandai**: lingkaran putih muncul, dinding ungu diam, hitung mundur.
    - **Sedang menyusut**: dinding berjalan dengan kecepatan tetap, ada label dan bar progres.
    - Kembali ke "zona ditandai" untuk fase berikutnya.
  - Dinding pertama = lingkaran yang memuat seluruh kawasan, menyusut ke lingkaran putih pertama. Susut pertama maks 130 dtk; lingkaran pertama cenderung di tengah kawasan.
  - Garis dinding tidak lagi bergeser (dulu animasinya terlihat seperti dinding bergerak).
  - Label HUD dulu ambigu ("Zona menyusut" + sisa waktu susut terbaca seperti hitung mundur). Sekarang: "Fase n · mulai menyusut dalam" vs "Sedang menyusut · selesai dalam".
  - Dites dengan mempercepat waktu: jari-jari tidak berubah selama fase tunggu.
- Bidik SMG/pistol/shotgun: titik putih di tengah tetap tampil; untuk red dot senapan disembunyikan karena titik merahnya sudah jadi patokan.

## 18. Kendaraan, bot taktis, dan peta tanpa bolong (11 Nov 2026)

### 18.1 Kendaraan
- **Model:** dibuat dengan Blender 5.2.4 headless (`~/Applications/Blender.app`), lewat skrip `tools/blender/vehicles.py`.
  - Jalankan: `Blender -b --factory-startup -P tools/blender/vehicles.py -- [--only id] [--quick] [--shots] [--lineup] [--turntable]`.
  - Hasil: `web/game/assets/vehicles/{lintas,banteng,walet,loop}.glb` + `manifest.json` (ukuran, posisi jok/mata/pintu/roda, palet warna).
  - Kontrak GLB:
    - Depan +Z, kiri +X.
    - Titik asal di tanah, tengah antar-as.
    - Simpul `body`, `wheel_*`, `steer` (motor), `seat_driver`, `eye_driver`, `exit_l/r`, `exhaust`.
    - Material `paint`/`glass`/`tire`/`light_*` dst.
  - Mobil setir kanan, jadi pintu pengemudi = `exit_r`.
- **Jenis kendaraan (orisinal, bukan tiruan merek/game lain):**

  | Kendaraan | Top speed | HP | Jumlah di arena |
  |---|---|---|---|
  | Sutera Lintas (hatchback) | 125 km/j | 1000 | 16 |
  | Banteng 4x4 | 110 km/j, nyaris tidak melambat di rumput | 1500 | 9 |
  | Walet 150 (skuter matic) | 115 km/j, pengendara terbuka | 450 | 14 |
  | Bus Sutera Loop | 80 km/j | 2600 | 3, hanya di jalan ≥ 7 m |

  Kendaraan diparkir di tepi kiri jalan saat halaman dimuat, jadi terlihat juga di kamera menu. Angka-angka ada di `TYPES` (`web/game/vehicles.js`).
- **Preview:**
  - Render Cycles di `preview/vehicles/`: `lineup.png`, per kendaraan, `colors.png`, `turntable.mp4`.
  - Showroom 3D: `web/garasi.html` (ganti kendaraan, warna cat, lampu, putar).
- **Kode game:**
  - `web/game/vehicles.js`:
    - Muat GLB; kalau GLB tidak ada, pakai model kotak.
    - Fisika arcade: setir model sepeda, selip saat rem tangan, boost, lebih lambat di luar jalan.
    - Tabrakan dengan gedung/pohon/tepi kawasan/kendaraan lain.
    - Menabrak orang.
    - Rusak → berasap → terbakar ±5 dtk → meledak (radius 7,5 m). Bangkai tetap ada sebagai penghalang.
    - Suara mesin, klakson, decit, ledakan (`audio.js`).
  - Sambungan ke pemain di `player.js`:
    - Masuk/turun pakai `F` (pintu terdekat).
    - `W`/`S` gas/rem-mundur, `A`/`D` setir, `Spasi` rem tangan, `Shift` boost, `H` atau klik kiri klakson.
    - `V` kamera belakang ↔ kursi pengemudi; mouse = lihat sekeliling, kamera kembali ke belakang sendiri.
  - Sambungan ke `main.js`:
    - Peluru kena bodi kendaraan. Kaca mobil 50% tembus ke pengemudi; pengendara motor/jip terbuka kena langsung.
    - Kerusakan ledakan dihitung di `explode()`.
    - Feed: "tertabrak kendaraan / terkena ledakan / tewas dalam tabrakan / jatuh dari kendaraan".
  - HUD: panel km/j + darah kendaraan; kendaraan terdekat tampil sebagai titik gelap di minimap/peta besar.
  - Karakter punya pose duduk menyetir (`rig.js`, `s.sit = 'car' | 'bike'`).

### 18.2 Bot (keluhan Steven: "bodoh, bahkan di Sulit")
- **Akar masalah lama:**
  - Graf jalan pecah jadi 359 bagian. Ujung jalan OSM yang disederhanakan tidak berbagi titik di simpang T, sehingga 40% simpul terputus dari jaringan utama.
  - Akibatnya A* sering gagal dan bot berjalan lurus menabrak tembok.
  - Saat bertarung, bot hanya menyamping di tempat terbuka.
- **Perbaikan graf** (`buildGraph` di `web/game/bots.js`):
  - Ujung buntu disambung ke ruas terdekat ≤ 9 m.
  - Pecahan kecil disambung ke jaringan utama lewat sambungan pendek yang tidak menembus gedung.
- **Navigasi lokal:** `web/game/nav.js` (baru).
  - Grid A* 1,5 m yang dihitung saat dibutuhkan, untuk memutari gedung.
  - Pencarian titik berlindung: sisi gedung yang tidak terlihat musuh, plus titik intip di tepinya.
- **Taktik:**
  - Berlindung → mengintip dengan bidikan siap (reaksi lebih cepat).
  - Kena saat mengintip → balik berlindung.
  - Di balik perlindungan: isi ulang & obati.
  - Buntu → mengepung dari samping (flank) atau memburu sambil jongkok.
  - Mendesak saat musuh lemah/isi ulang atau saat bersenjata jarak dekat.
  - Mundur saat darah tipis.
  - Pilih senjata sesuai jarak.
  - Mendengar tembakan, langkah lari (Sedang/Sulit), dan mesin kendaraan.
  - Menghindar dari kendaraan yang menyeruduk.
  - Bidikan awal melebar lalu mengunci (`settle`).
- **Kendaraan untuk bot:**
  - Kalau zona jauh (≥ 340 m), bot mencari kendaraan kosong dalam radius ≤ 160 m.
  - Menyetir di lajur kiri lewat graf jalan: pelan di tikungan, putar balik sambil mundur, meraba halangan, mundur kalau macet.
  - Turun di tujuan, atau saat ada musuh dekat (Sulit), atau saat kendaraan hampir hancur.
- **Preset `DIFFICULTY`** sekarang punya parameter taktik: `cover`, `peek`, `flank`, `push`, `settle`, `head`, `steps`, `dodge`, `drive`, dst.
  - Antar-bot dilunakkan: sebaran ≥ 3°, kerusakan ×0,5, tanpa bidik kepala, reaksi +0,35 dtk. Tujuannya supaya arena tidak habis sebelum pemain sempat bertarung.
- **Uji Chrome headless, Sulit:**
  - Duel 1 lawan 1: bot langsung berlindung, mengintip 4×, mengobati diri di balik rumah, lalu mengepung dan memburu sambil jongkok.
  - Pertandingan penuh: ±27 bot masih hidup 2 menit setelah mendarat. Bot naik kendaraan ke zona (sampai 86 km/j). Tanpa error console.

### 18.3 Peta tanpa bolong
- **Enclave:** ±10 ha dan 0,37 ha di dalam batas resmi dulu dipotong dari diorama (jadi "sumur" sedalam 26 m dengan dinding tak terlihat). Sekarang terisi data OSM, bisa dimasuki, dan di digital twin diberi tanda "Bukan kawasan Alam Sutera".
  - Data: `tools/build_map.py`, `web/data/alsut-map.json`; array lama tidak berubah urutannya.
- **Game:** `buildWorld(D, { game: true })` membuat tanah sampai cakrawala.
  - Kota sekitar ±1 km dari OSM (`tools/build_context.py` → `web/data/alsut-context.json`, `web/map/context.js`), hanya visual.
  - Batas area main tetap.
- **Digital twin (`index.html`):** tampilan diorama dipertahankan.
- Before/after: `preview/map-holes/`.

### 18.4 Uji & catatan
- Uji dari situs uji di scratchpad yang meng-symlink `web/`. Salinan `main.js` di sana membuka `window.__G`. Kode proyek tidak diberi flag/global uji.
- fps ±120 di 1440×900 saat GPU tidak dipakai proses lain. Biaya CPU per frame: bot ±0,12 ms, kendaraan ±0,12 ms.
- **Belum:** menembak dari dalam kendaraan / kursi penumpang, multipemain, interior gedung.

## 19. Karakter baru, animasi, pohon, ilalang + tiarap, 1 vs 100, klakson MP3 (11 Nov 2026, lanjutan)

Permintaan Steven (urutan): 1) karakter & animasi (mis. isi ulang), 2) pohon lebih bagus, 3) rumput tinggi untuk bersembunyi (jongkok/tiarap), bot memperhitungkannya, 4) gedung bisa dimasuki (**belum**, berikutnya). Tambahan: 1 vs 100 bot, klakson MP3.

### 19.1 Karakter & animasi
- **Model:** Blender (`tools/blender/characters.py`) → `web/game/assets/characters/person.glb` + `person.json`.
  - 24 bagian kaku, satu per tulang rig, origin tepat di sendi: tubuh 2.442 segitiga + perlengkapan (rambut pendek/panjang, topi, helm, rompi, ransel, list).
  - Warna verteks: putih = diwarnai per bot (slot pants/shirt/sleeve/skin/hair/shoes/gear/pack/trim).
  - Tetap digambar sebagai kerumunan instans, jadi 100 bot tetap ringan.
  - Dimuat di `main.js` sebelum dunia dibangun (`loadCharacterParts` → `setCharacterParts`, `map/rig.js`). Kalau gagal → karakter prosedural lama.
- **Animasi baru (`map/rig.js`):**
  - Isi ulang (tangan kiri: magasin → cabut → magasin baru di rompi → pasang; senjata dimiringkan).
  - Mengobati (jongkok, membalut, senjata disandang).
  - Ganti senjata, tiarap + merayap, duduk menyetir (sudah ada).
  - IK lengan dua tulang: tangan kanan di pegangan, kiri di penyangga, per jenis senjata (`GRIP`).
  - Senjata di tangan karakter = model senjata yang sedang dipakai (`addGearParts` + `gunGeometry`), bukan satu senapan generik.
- Preview: `preview/characters/{hero,lineup}.png`.

### 19.2 Pohon
- Blender (`tools/blender/trees.py`) → `web/game/assets/trees/trees.glb` + `trees.json`.
  - 2 varian per jenis: trembesi/ketapang (tajuk lebar), palem raja/kelapa, glodokan/cemara.
  - LOD0 ≤ 800 segitiga, LOD1 ≤ 90.
  - Alfa warna verteks = bobot goyang angin.
  - Ada juga semak & 3 rumpun ilalang.
- **`map/world.js` `upgradeTrees`:**
  - Pohon prosedural tampil dulu, lalu diganti GLB (grup yang sama, jadi tombol lapisan "Pohon" di twin tetap jalan).
  - LOD dekat ≤ 230 m dari kamera, dihitung ulang tiap kamera pindah 30 m lewat `onBeforeRender` (tanpa ubah loop).
  - Angin di shader, variasi warna per pohon.
  - Berlaku di game & digital twin.
- Preview: `preview/trees/{lineup,lod}.png`.

### 19.3 Ilalang + tiarap
- **Peta rumput:** `tools/build_grass.py` → `web/data/alsut-grass.json`, raster 3 m.
  - Sumber: tata guna lahan OSM (grass luas, meadow, farmland, sand, construction, scrub, wood, …) + lahan kosong besar tanpa bangunan/jalan/taman/parkir (di landuse=residential syaratnya lebih ketat).
  - Hasil 163 ha (22,5% kawasan): 11,5 ha OSM + 152 ha lahan kosong.
  - Ini perkiraan, bukan citra satelit. Bisa dikoreksi dengan menambah poligon OSM atau mengubah ambang di skrip.
- **`map/grass.js`:**
  - Rumpun instans hanya ≤ 105 m dari kamera (per petak 24 m, makin jauh makin jarang), bergoyang angin, rebah di dekat pemain.
  - Area jauh: lapisan warna jerami.
  - `at(x, y)` = kerapatan 0..1. Rumpun memakai ilalang GLB begitu `trees.glb` termuat.
- **Tiarap:** `Z` (Spasi/C = bangun ke jongkok).
  - Mata 0,42 m, merayap 1,15 m/dtk, sebaran ×0,55, sentakan ×0,5, transisi 0,6 dtk.
  - Hitbox rebah sepanjang badan (`SPH_PRONE`, `main.js`).
  - HUD: "Tersembunyi di rumput" / "Setengah tersembunyi".
- **Persepsi bot (`perceive`):** di rumput (kerapatan > 0,35), target tiarap tidak terlihat lebih dari ±8 m dan jongkok lebih dari ±20 m, kecuali baru menembak (1,5 dtk) atau bergerak cepat.
  - Uji: bot Sulit 30 m dengan garis pandang bersih tidak melihat pemain tiarap; begitu berdiri, langsung diserang.
- **Bot ikut tiarap:** saat menembak jauh dengan AR/DMR (lebih sering di rumput) dan saat mengobati di rumput/tanpa perlindungan. Bangun dulu kalau harus pindah cepat.

### 19.4 1 vs 100, klakson
- `BOTS = 100` (`main.js`), 100 nama unik (`bots.js`), teks menu/HUD.
- Loot ×1,6 (`loot.scatter(mult)`, kapasitas dinaikkan); kendaraan 58 (Lintas 22, Walet 20, Banteng 12, bus 4).
- Titik panas pendaratan ±n/7; jatah pencarian jalur per frame 4 + n/20.
- **Uji:** ±54 bot masih hidup 2 menit setelah mendarat, 120 fps, tanpa error.
- **Klakson MP3** (dipasang agen kendaraan atas permintaan Steven): `web/game/assets/vehicles/klakson-*.mp3`, field `horn` di manifest.
  - Di game: `H`/klik kiri memutar klip dari awal (`audio.clip`).
  - Sopir bot juga mengklakson kalau ada orang menghalangi.
  - Catatan agen: klip suara tokoh publik → ganti sebelum dipamerkan ke luar.

### 19.5 Uji & catatan
- Uji di Chrome headless (GPU Metal) lewat situs uji di scratchpad: pose per kotak, pertandingan penuh 1 vs 100 di Sulit, ilalang + persembunyian, kendaraan.
- Cache module browser bisa menyajikan file lama setelah update, jadi refresh pakai Cmd+Shift+R.
- **Belum:** gedung bisa dimasuki (no. 4), menembak dari kendaraan.

## 20. Rumah bisa dimasuki + berenang (11 Nov 2026, lanjutan)

### 20.1 Rumah (permintaan no. 4)
- **Cakupan:** 5.471 rumah tapak (jenis 0, 4–12 titik, 35–700 m², tinggi ≥ 3,2 m), lantai dasar saja. Ruko, mal, dan menara tetap padat.
- **`web/map/interiors.js`:**
  - `planHomes(D)`: tata letak deterministik, dihitung saat dimuat (±10 ms).
    - Pintu depan 1,7 m menghadap jalan terdekat; rumah ≥ 150 m² dapat pintu belakang.
    - Sekat ruang dengan ambang 1,4 m (rumah segi empat ≥ 60 m², dibagi lagi kalau ≥ 140 m²).
    - Jenis ruang: tamu/kamar/dapur.
    - Perabot menempel dinding, tidak menghalangi pintu, perabot tinggi tidak menutup jendela.
  - `createInteriors`: mesh interior dibuat hanya untuk rumah ≤ 85 m dari kamera (3 per frame), dibuang > 110 m.
    - Isi mesh: lantai per ruang, plafon, sisi dalam dinding dengan lubang & kusen, sekat, daun pintu, perabot.
    - Diberi cahaya ruangan.
- **Lubang asli tanpa geometri baru:**
  - Shader gedung (`world.js`) membuang (discard) piksel pintu & jendela lantai dasar untuk rumah yang terbuka.
  - Data per gedung: atribut `bid` + tekstur kecil (`setHouseOpen`).
  - Koordinat jendela (u = jarak keliling, v = tinggi) dipakai sama persis di shader, mesh interior, dan collider.
- **Collider (`collide.js`, opsional `homes`):**
  - Dinding tipis 0,2 m dengan celah pintu, ambang pintu (`z0` 2,2 m: menahan peluru, bukan jalan kaki).
  - Pelat plafon (`slab`) menahan peluru dari atas/bawah, sekat, perabot (bisa jadi perlindungan).
  - Peluru & garis pandang menembus jendela hanya < 90 m (`WIN_RANGE`), supaya adil: jendela jauh tampak tertutup.
  - Tidak bisa mendarat di dalam rumah (`arrival`, `findFree(..., outside)`).
- **Bot:** grid navigasi 1 m (`nav.js`, cek radius 0,3) → bisa masuk lewat pintu.
  - Uji: bot dari 14 m di luar mengambil DMR di ruang belakang dalam 7,6 dtk.
- **Loot:** rumah dapat 1–2 barang, 75% di dalam ruang.
- **Kamera orang ketiga:** pakai sinar tepat (tidak menembus dinding tipis).

### 20.2 Berenang (seperti PUBG)
- **Gerak:** air (3 danau) bisa dimasuki pemain (`col.step(..., swim)`).
  - Badan turun 1,3 m, kepala di permukaan, senjata disimpan, tidak bisa menembak/obat.
  - Kecepatan 2,2 m/dtk (Shift 3,1).
- **Menyelam:** `C` (turun 2,4 m), Spasi naik.
  - Napas 20 dtk, lalu tenggelam (9/dtk, feed "tenggelam").
  - Layar bawah air keruh (kabut 24 m, langit disembunyikan).
- **Bot:**
  - Tidak melihat yang menyelam; yang berenang hanya terlihat kepalanya (dibidik ke kepala).
  - Peluru tertahan permukaan air (bidang y = 0).
  - Bot & kendaraan tidak masuk air.
- Pose renang di `rig.js` (`s.swim`): gaya bebas saat bergerak, mengapung tegak saat diam.

### 20.3 Uji
- Rumah: fasad berlubang dari jalan, interior terang, jalan masuk lewat pintu, loot di dalam, bot masuk rumah.
- Berenang/menyelam: bot di tepi tidak melihat penyelam, melihat begitu muncul.
- 1 vs 100: 120 fps, CPU ±4 ms/frame dengan 175 interior terbuka, tanpa error.

## 21. Senjata, pesawat, barang & parasut baru (11 Nov 2026, lanjutan)

Permintaan Steven: "senjata juga jelek, bikin bagus semua designnya", "pesawat juga bikin lebih bagus".

- **Blender:**
  - Skrip: `tools/blender/weapons.py`, `plane.py`, `props.py`.
  - Aset: `web/game/assets/weapons/weapons.glb` (+ json), `assets/plane/plane.glb` (+ json), `assets/props/props.glb` (+ json).
  - Preview: `preview/weapons/{lineup,fp_ar,plane}.png`, `preview/props/lineup.png`.
- **Senjata (`weapons.js` `loadWeaponModels`, dimuat sebelum dunia dibangun):** model orang pertama per senjata (P9, Kilat, Garuda dengan red dot berbingkai terbuka, Badai pompa, Elang teropong).
  - Titik bidik/moncong/penyangga dibaca dari model.
  - Tangan bersarung + lengan ungu bermanset emas, magasin & pompa tetap beranimasi.
  - Pantulan lingkungan untuk logam.
  - `<jenis>_lod1` dipakai untuk loot & senjata di tangan karakter/bot (`gunGeometry`).
- **Pesawat:** angkut 4 baling-baling (putih-ungu, list emas) menggantikan pesawat kotak; baling-baling berputar (`main.js`).
- **Barang (`loot.js` `loadPropModels`):** peluru (3 jenis), perban, P3K, rompi & helm lv.1–3, peti jarahan.
- **Parasut:** kanopi ram-air dengan tali (pemain emas, bot diwarnai per bot, diberi cahaya tipis supaya tidak gelap dari bawah).
- **Cadangan:** semua aset opsional. Kalau GLB gagal dimuat, model prosedural lama dipakai.
- **Uji:** 1 vs 100 di Sulit 120 fps tanpa error, dengan semua aset & fitur §18–21 aktif.

## 22. Tembak dari kendaraan, lantai 2, ruko & mal (11 Nov 2026)

Permintaan Steven: "bikin jadi bisa dong" (menembak dari dalam kendaraan, naik ke lantai 2 rumah, masuk ruko/mal).

**Tembak dari kendaraan** (`vehicles.js` kursi `seat_p*`, `player.js` `seated()`/`fire()`, `main.js` `combat.probe`, `rig.js` pose duduk membidik, HUD):
- **Sopir:** hanya pistol/SMG (otomatis ganti), busur ±100°.
- **Penumpang:** semua senjata, busur ±150°.
- **Kontrol:** klik kiri tembak, klik kanan bidik, Ctrl+1–4 pindah kursi (1 = sopir), H klakson, V kamera kursi.
- Mobil tanpa sopir melambat sendiri.
- Penumpang motor/jip terbuka kena seperti pengendara; mobil tertutup memakai aturan kaca.
- **Belum:** bot menembak sambil menyetir (perlu `bots.js`: target ≤ 40 m saat drive, `combat.fire` dari `vehicles.eyeWorld`, pose `oneHand`).

**Lantai 2 rumah** (`map/interiors.js` `planUpper`):
- 1.378 rumah segi empat setinggi ≥ 6,2 m.
- Tangga lurus 4,4 m menempel dinding luar (ruang mana saja, ruang tamu dulu).
- Pelat lantai 3,3 m berlubang tangga (3 potong pas dinding), pagar lubang, plafon atas = min(tinggi − 0,25, 6,4).
- Ruang atas memakai sekat yang sama dan diberi perabot (kamar).
- Jendela atas berlubang (shader: batas = plafon teratas) dan bisa ditembus peluru.

**Collider bertingkat** (`map/collide.js`):
- `blocksAgent(G, x, y, ay)`: poligon hanya menghalangi bila memotong badan agen setinggi kaki ay.
- `floorAt(x, y, ay)`: permukaan tertinggi ≤ ay + 0,6 (tanah / tangga `rampH` / pelat `floor`).
- `step`/`resolve`/`blocked` menerima ay.

**Agen di lantai bertingkat:**
- **Pemain** (`ground()`): mengikuti permukaan, jatuh dari tepi.
- **Bot:**
  - Gerak per lantai.
  - `go(b, x, y, spd, gz)` membuat rute: ke tangga → nav `'stair'` (mengikuti sumbu tangga) → tujuan.
  - `nav.js` grid per lantai (lantai atas wajib ada pelat).
  - Barang di lantai lain diberi penalti jarak ×1,5.
  - Memburu musuh di lantai atas.
- **Barang:** punya `z` (lantai), ambil hanya di lantai yang sama; peti mati di lantai atas tetap di lantai itu.

**Ruko** (jenis 1, segi empat ≤ 3000 m²):
- 84 blok / 1.129 unit selebar 5,2 m sejajar papan nama shader.
- Etalase depan terbuka 4,5 × 3 m, sekat antarunit penuh, plafon 3,4 m.
- Isi: minimarket (rak dinding, gondola, kasir, kulkas kaca), kafe (bar + meja), toko (rak, meja display, konter).

**Mal / toko besar** (86 aula):
- Pintu masuk 6 m tiap 24 m sepanjang deret sisi keliling yang menghadap jalan (≤ 2 rentang, bukaan boleh melewati sudut).
- Plafon 4,6 m, kolom grid 10 m.
- Isi sel: gondola / kios ungu-emas / meja kafe / taman + bangku.
- Dinding dalam berupa deret etalase (kaca gelap + papan nama), lampu plafon.
- Aula kecil (< 3000 m²): bukaan 3,6 m tiap 8 m, grid 6,5 m.

**Shader (`world.js` tabel `uOpen`):**
- Rumah: (buka, pintu1, plafon teratas), (pintu2, 0, 0).
- Toko/aula: (buka, rentang A, tinggi bukaan), (rentang B, P, p). Berlubang bila mod(u, P) ∈ [p, P − p].

**Kinerja & tampilan:**
- **Loot:** ±23.000 barang, model ±250 segitiga, dulu semua digambar (6,6 jt segitiga → 85 fps). Sekarang hanya barang ≤ 120 m dari kamera (`loot.update(now, camera.position)`) → ±2 jt segitiga, 120 fps.
- **Cahaya interior:** emisif 0,62, matahari langsung ×0,12 (rata, tidak gelap sebelah).

**Server & cache:**
- BFF kini mengirim `Cache-Control: no-cache` untuk file web (`bff/cmd/server/main.go` `noCache`, binary sudah di-build ulang).
- `royale.html`:
  - Import map memetakan modul ke `?v=20261111` (lepas dari cache lama yang membuat "does not provide an export named …").
  - Layar muat menampilkan error modul.

**Uji (Chrome headless):**
- **Pemain:** naik/turun tangga 0 → 3,3 → 0 m.
- **Bot:** naik tangga mengambil AR di lantai 2.
- **Pertandingan 1 vs 100:** bot masuk ruko/mal dan sesekali naik lantai 2, 120 fps, tanpa error.
- **Kendaraan:** uji sopir/penumpang lulus.

## 23. Rumah v2, loot satu-satu, lompat jendela (11 Nov 2026, lanjutan)

Keluhan Steven: rumah yang berhadapan tidak bisa dimasuki ("logikanya satu hadap depan satu hadap belakang pintunya"), "bikin rumah yang bener-bener bagus", loot jangan langsung semua terambil (seperti PUBG).

**Pintu** (`map/interiors.js` `planHouse`):
- **Pintu depan:** di sisi terdekat jalan utama (`MAIN`: trunk…living_street, bukan `service` = gang belakang), dengan syarat 1–2 m di luar pintu tidak ada gedung lain (`occupied`).
- **Pintu belakang:** di sisi paling berlawanan atau samping (rumah ≥ 45 m²).
- **Hasil:**
  - 5.494 rumah bisa dimasuki.
  - 3.728 rumah berpintu dua.

**Teras** (`planPorch`):
- Lantai +15 cm (bisa dipijak: poligon `floor: 0.15`), undakan, dua tiang, kanopi.
- Hanya bila halaman depan kosong (bukan jalan/gedung).
- 3.909 rumah.
- Satu mesh statis untuk semua teras (`createInteriors` → `porches()`), selalu terlihat.

**Kamar mandi** (`planBath`):
- 2 × 1,7 m di pojok rumah (dapur dulu, lalu kamar).
- Sekat L masuk `H.parts`, pintu 0,9 m, sehingga lantai 2 mendapat kamar mandi di posisi yang sama.
- Isi: shower kaca, kloset, wastafel + cermin.
- 2.909 rumah.

**Interior:**
- Warna dinding per jenis ruang (tamu krem, kamar pastel per rumah, dapur putih, kamar mandi biru) dan per lantai.
- Plint kayu, gorden kiri-kanan + rel di tiap jendela, lukisan di sekat, karpet (tidak menghalangi), lampu plafon per ruang.
- Dapur dengan kompor & bak cuci.

**Dinding gandeng** (`world.js` `blindEdges`/`insideOther`, `D.blind`):
- Sisi rumah yang < 1,2 m dari gedung lain tidak diberi jendela: `wuv` u = −1 di shader, tanpa lubang di interior, tanpa tembus peluru di collider.
- 3.929 rumah / 8.222 sisi.

**Lantai 2:**
- 971 rumah. Lebih sedikit dari §22 karena tangga tidak boleh menimpa kamar mandi / dekat pintu belakang.

**Loot seperti PUBG:**
- Tidak ada ambil otomatis.
- Peti jarahan dibuka dengan F lalu menjadi panel daftar isi (`hud.crate`). Kontrol:
  - F mengambil baris teratas.
  - 1–9 memilih baris.
  - Menjauh > 2,8 m menutup panel.
- `loot.js` `crateEntries`/`takeCrateEntry`/`crateEmpty`:
  - Rompi/helm ditukar.
  - Senjata lama jatuh ke tanah.
- Bot tetap mengambil semua sekaligus.

**Lompat jendela/perabot rendah** (`player.js` `vaultSpot`/`startVault`):
- Syarat: sinar setinggi lutut terhalang ≤ 1,3 m, setinggi dada tembus, tempat mendarat kosong.
- Spasi atau F (prompt "Lompati").
- Lintasan 0,5 dtk lalu jatuh biasa (dari lantai 2 juga bisa).

**Uji:** semua di atas dicek di Chrome headless, 120 fps, tanpa error.

**Server Steven:**
- Menyajikan salinan stabil `WEB_DIR=<scratchpad>/play-web`, disalin ulang setelah lolos uji.
- Di luar sesi Claude: `cd bff && ./bin/alsut3d-bff` (menyajikan `../web`).

## 24. Kinerja, air, kendaraan baru, animasi, pohon v2, suara (11 Nov 2026, lanjutan)

**Kinerja:**
- Penghitung FPS di layar (`main.js` `fpsTick`, `.h-fps`, F3) menampilkan FPS · ms · skala render.
- Resolusi adaptif: skala turun bila FPS < 50 selama 1,5 dtk (1,5 → 1,25 → 1,0 → 0,85 → 0,7), naik lagi bila > 95 selama 6 dtk.
- Game di layar Retina tanpa MSAA (`world.js`: `antialias: !(game && dpr ≥ 2)`). Tes 1728×1080 @2×: 78–94 → 118 fps.

**Air** (`world.js` `waterize`, `riverGeo`):
- Danau hijau-biru, sungai/kanal hijau-cokelat.
- Riak bergerak (normal dari gelombang + noise), kilau matahari Phong, fresnel langit, buih tepi kanal (atribut `side`).
- Kanal ≥ 3 m menjadi poligon air di collider (bisa direnangi, padat untuk bot/kendaraan) kecuali di jembatan; jembatan beton berpagar di persilangan jalan.
- Sungai besar (Cisadane) & danau = `D.water` (sudah bisa direnangi sejak §20).
- Kamera orang ketiga saat berenang ditahan di atas permukaan (y ≥ 0,5).

**Fasad gedung:**
- **Rumah:** kusen + palang + ambang jendela, list bawah, plester noise, list antar-lantai, atap bermotif genteng (dari normal & posisi dunia).
- **Ruko:** jendela berkusen aluminium; kanopi menerus di depan deret etalase.
- **Mal** (`o.kind` 4, area > 3000): panel kladding, pita kaca per lantai, papan reklame besar tiap 46 m, kanopi bertiang di tiap pintu masuk.
- Jendela yang menumpuk pintu tidak lagi berlubang di shader/collider (bug "bisa melompat di samping pintu").

**Kendaraan** (agen; `tools/blender/vehicles2.py`):
- **Jenis baru:**
  - Sutera Loop: troli merah-hijau, 12 kursi, menggantikan bus `loop`.
  - `halilintar`: supercar kuning tanpa logo merek, ±240 km/j, 2 kursi, 4 unit dekat mal.
  - `jawara`: moge chrome tanpa logo merek, ±165 km/j, 2 kursi, 8 unit.
- **Aturan kursi:** motor 2; mobil 2 pintu 2; mobil 4 pintu 4 (`banteng` kini 4 pintu). Kursi diambil dari manifest, tiap kursi turun lewat pintunya, toast "Kendaraan penuh". Preview di `preview/vehicles/v2-*.png`, `garasi.html` diperbarui.
- **Bug tertabrak saat turun** (agen): mobil tanpa sopir dulu memakai rem tangan (grip 16 %) → selip menabrak yang baru turun. Sekarang:
  - Mengerem penuh.
  - Kebal tabrak 2,2 dtk dari kendaraan yang baru ditinggal.
  - Titik turun aman (pintu kursi → pintu lain → belakang).
  - Cedera lompat hanya > 60 km/j.

**Suara** (agen, `audio.js` `footstep`):
- **Langkah bot terdengar:** lari 40 m / jalan 22 m / jongkok 6 m, panning, teredam tembok, ≤ 24 per dtk.
- **Bot mendengar langkah pemain & bot lain** (35/18/5 m) lalu menoleh dan menyelidik.
- **Tembakan musuh:** terdengar 380–720 m menurut senjata, makin pelan/teredam/terlambat dengan jarak, gema > 60 m, teredam bila penembak di dalam gedung, ≤ 14 suara sekaligus.

**Animasi orang pertama** (agen, `weapons.js` `createViewModel`):
- Reload per senjata (magasin lepas/masuk, pengokang, slide pistol, peluru shotgun satu per satu).
- Perban (membalut lengan), P3K (kotak dibuka, suntik).
- Ganti senjata, inspect (I), hentakan mendarat.
- Durasi sama dengan waktu di game.
- Bug: magasin & pompa senjata FP dulu tidak terpasang — sudah.

**Pohon v2** (agen; `web/map/trees.js` `cleanTrees`, `tools/blender/trees2.py`):
- 9.070 → 8.445 pohon. 1.169 yang di aspal dipindah ke trotoar; daftar sama untuk render & collider.
- Daun kartu bertekstur atlas.
- Jenis: trembesi, ketapang, mahoni, flamboyan, palem raja, kelapa, glodokan, cemara, semak pucuk merah (+7.157 semak hias tanpa tabrakan).
- 3 LOD. Preview `preview/trees/lineup-v2.png`.

**Uji final:** 1 vs 100 di Sulit tanpa error; FPS di akhir 105 pada 1280×800 (pohon menambah ±0,4 jt segitiga di area padat).

**Belum:** bot menembak sambil menyetir.

## 25. Mode realistis: langit HDR, PBR, post-processing (11–12 Nov 2026)

Permintaan Steven: "bikin hyperrealistic semua upgrade tapi tetap smooth" (terinspirasi demo Unreal Engine). Game tetap three.js r160 di browser; yang dirombak adalah cara render. Semua hanya aktif di game (`opts.game` + `opts.real`); peta digital twin (`index.html`) tidak berubah. Kalau aset gagal dimuat (40 dtk), game memakai tampilan lama.

**Aset (Poly Haven, lisensi CC0; diunduh `tools/realism/fetch_assets.py`):**
- `web/game/assets/sky/`: `sky_1k.hdr` (cahaya), `sky_dome.jpg` (kubah, potongan atas 6144×1622 dari JPG 8K), `sky.json`. Langit: `kloofendal_48d_partly_cloudy_puresky`.
- `web/game/assets/pbr/`: albedo/normal/kekasaran 1K untuk `asphalt_04`, `pavement_03`, `concrete_pavement`, `leafy_grass`, `forrest_ground_01`, `painted_plaster_wall`, `clay_roof_tiles_02` (+ `sets.json` ukuran ubin nyata).

**`web/map/realism.js`:**
- `loadRealism()` (tanpa renderer) → `{ init(renderer) → R }`.
  - Dari data HDR: arah matahari (piksel paling terang), energi matahari (di atas batas jepit 14 → `DirectionalLight`), iradiansi langit (→ `HemisphereLight`), warna kaki langit.
  - Eksposur dipanggang ke semua cahaya (bidang putih tersinari ≈ 1), sehingga benda tanpa cahaya (partikel, cincin barang) tetap memakai warna 0…1.
  - Penyesuaian artistik: matahari ×1,3 + hangat, langit dijenuhkan-turun 35 %.
- `useHemisphereAmbientOnly()`: menghapus IBL difus dari `ShaderChunk.lights_fragment_maps` (cahaya sekitar hanya dari HemisphereLight untuk Lambert & Standard; pantulan lingkungan tetap).
- `R.groundMaterial(key, base, o)`: `MeshStandardMaterial` bertekstur (UV = meter dunia), variasi skala besar (anti-ubin), menerima bayangan dinamis.
- `R.patch(m, { dyn })`: menambal material apa pun supaya menerima bayangan dinamis. `R.foliage(m)`: daun/rumput (cahaya tembus daun, sekitar diperkuat, alfa = topeng AO 0,25).
- `skyDomeMaterial(R)`: kubah langit foto (LDR → HDR kira-kira lewat `skyExpand`), di bawah cakrawala = kabut sewarna kaki langit.
- `createDynShadow()`: peta kedalaman 2048² seluas ±30 m di depan kamera, tiap frame, hanya benda di layer 3 (`DYN_LAYER`: karakter, kerumunan bot, kendaraan). **Penting:** target di-`clear` sekali saat dibuat; sampler bayangan yang terikat ke tekstur kosong membuat GPU (Metal) melewatkan draw call (tanah tidak tergambar dari pesawat/menu).

**`web/game/postfx.js`** (urutan per frame): adegan → target HDR half-float + tekstur kedalaman (dengan stensil) → AO setengah resolusi (SAO, sampel di pusat texel, blur searah kedalaman) → resolve (AO + kabut atmosfer: warna = langit di arah itu, menipis dengan ketinggian) → senjata orang pertama → bloom (rantai 5 mip, campur hemat energi) → sinar matahari (blur radial) → komposit (eksposur, ACES, grading, vinyet, dither) → FXAA.
- `TIERS`: Ultra / Tinggi / Sedang / Rendah / Hemat (tanpa post). `main.js` `STEPS` = [tingkat, skala render]; FPS < 50 selama 1,5 dtk turun, > 100 selama 8 dtk naik; F4 manual; pilihan terakhir disimpan (`localStorage royale.gfx`).

**`world.js` (real):**
- Lampu dari R; `overlay(g, { surf })` → permukaan PBR (`asphalt`, `pave`, `slab`, `grass`, `soil`); warna verteks menjadi tinta halus (`tint`, `ROAD_K`).
- Halaman cluster: perumahan = rumput, komersial = pelat beton, konstruksi = tanah. Kerb abu beton.
- Gedung (`bMat` → Standard, `#define REAL`): detail plester & genteng foto + peta normal (kerangka T/B dari normal dunia), interior palsu di balik kaca (`interiorRoom`: rumah / toko / kantor / lantai atas ruko), kaca memantulkan lingkungan (menara: metalik gelap + rangka aluminium).
- Kubah langit foto; awan & cakram matahari lama disembunyikan.
- `context.js`, `grass.js` (lapisan jauh), `interiors.js` (ruang dalam lebih gelap + eksposur otomatis ×2,1 di dalam gedung) ikut disesuaikan.

**Kinerja (M1 Pro, Chrome headless tanpa vsync, 2268×1350):** jalan + 60 bot: Ultra 7,5 ms, Hemat 4,4 ms; pesawat 7,5 ms; menu 13,9 ms (seluruh kota terlihat, 1887 draw call). Pertandingan penuh 1 vs 100 Ultra: 102–108 FPS, tanpa error.

**Belum (gelombang berikut):** karakter, kendaraan, senjata/tangan, pohon, isi rumah masih model lama.

## 26. Kelancaran (120 Hz), pengatur kualitas baru, jendela & pintu rumah (12 Nov 2026)

Keluhan Steven setelah mode realistis: tidak mulus setelah terjun, FPS turun di area rumput, senjata "aneh" langsung muncul di depan saat mendarat, dan jendela rumah yang tampak tidak ter-render tetapi bisa dilompati.

**Temuan ukur** (M1 Pro, Chrome tanpa vsync, 2268×1350 = skala 1,5):
- Game terikat GPU di Ultra (±7,5 ms; batas 120 Hz = 8,3 ms). Tingkat efek hampir tidak menghemat (Ultra → Rendah 0,5 ms); yang menentukan adalah skala render (1,5 → 1,25 → 1,0 = 6,9 → 5,9 → 5,2 ms setelah perbaikan).
- CPU three.js terbuang untuk: (1) pass bayangan dinamis merender adegan utama tanpa lampu → versi lampu berubah dua kali per frame → program SEMUA material dievaluasi ulang (±1,4 ms); (2) `scene.updateMatrixWorld` dua kali per frame atas ±3900 objek (74 kendaraan × ±50 simpul), dan `scene.matrixAutoUpdate` bawaan memaksa semua turunan dihitung ulang; (3) rumput: `rebuild()` menulis & mengunggah 6,6 MB buffer tiap kamera pindah 8 m; (4) sampah memori 360 KB per frame.

**Perbaikan (semua sudah di `web/`):**
- `game/governor.js` (baru, murni logika; diuji dengan model layar di scratchpad): sasaran = laju layar (diukur dari rAF selagi memuat, `refreshProbe` di `main.js`). Frame telat > 10 % selama 1,5 dtk → turun satu langkah; mulus 10 dtk → naik; jeda coba-ulang berlipat (20 dtk … 2 menit). Layar ≥ 90 Hz dan di langkah "Tinggi" pun masih telat → setengah laju layar (frame genap dilewati, 60 FPS rata), kualitas naik lagi, laju penuh dicoba ulang berkala. Langkah = [tingkat efek, skala]: Ultra 1,5 / Ultra 1,25 / Tinggi 1,1 / Tinggi 1,0 / Sedang 0,9 / Rendah 0,8 / Hemat 0,8 / Hemat 0,65. Layar Retina mulai dari Ultra 1,25. Disimpan di `localStorage royale.gfx2`. F4 tetap pilihan manual.
- `game/postfx.js`: resolve digabung ke komposit (satu pass layar penuh berkurang, target `rtResolve` dihapus). Senjata orang pertama digambar ke target adegan dengan `gl.depthRange(0, 0.02)` (selalu di depan tanpa menghapus kedalaman adegan; AO/kabut melewati piksel berkedalaman ≤ 0,021). `post.warm()` mengompilasi semua varian shader saat memuat.
- `map/realism.js` `createDynShadow`: adegan proxy tersendiri (mesh ber-layer 3 dipindai tiap 30 frame; meminjam geometri, `matrixWorld`, `instanceMatrix`, kerangka). Adegan utama tidak dirender dua kali; satu material kedalaman per jenis objek. `useCheapShadowFilter()`: bayangan matahari bawaan three.js jadi 8 ambilan tekstur per piksel (dari 16).
- `main.js`: `scene.matrixAutoUpdate = false`, `scene.matrixWorldAutoUpdate = false`, `scene.updateMatrixWorld()` sekali per frame sebelum bayangan & render. **Akibatnya:** objek digerakkan di fase update (bukan `onBeforeRender`); objek statis baru ber-`matrixAutoUpdate = false` dengan transform bukan identitas harus memanggil `updateMatrix()` + `updateMatrixWorld(true)` sendiri sekali.
- `vehicles.js`: kendaraan diam ≥ 2,5 dtk dibekukan (`root.matrixWorldAutoUpdate = false`, tanpa `place()`).
- `map/grass.js`: kolam 112 `InstancedMesh` per petak 24 m (satu instans = tambalan 3 rumpun); petak diisi sekali saat masuk jangkauan (≤ 4 per frame); menjarang menurut jarak = awalan daftar instans teracak; mengecil di tepi jangkauan di shader. Tiap mesh kolam punya objek geometri sendiri (atribut dipakai bersama): InstancedMesh yang berbagi geometri + program tetapi beda `instanceMatrix` membuat three.js menyetel ulang VAO tiap draw call.
- `world.js` pohon: di udara (kamera > 270 m) semua pohon LOD terjauh dan pembagian LOD tidak diulang; hanya bagian buffer terpakai yang diunggah (`addUpdateRange`). Lapisan datar transparan `forceSinglePass` (tanpa render dua pass yang mengevaluasi ulang program).
- `collide.js` `resolve` tanpa closure per panggilan; sampah per frame 360 → 250 KB (sisanya di bot: `gearOf`, `steer`, `pose`).
- HUD: minimap digambar ±11×/dtk; `backdrop-filter` dihapus dari panel yang selalu tampil.
- Bekal senjata saat mendarat (`loot.starter`) dihapus; pesan mendarat: "Cari senjata di rumah & ruko terdekat".

**Hasil:** terjun → payung → mendarat terkunci 120 FPS (8,3 ms) di Ultra pada 1440×900 @1×; pertandingan 1 vs 100 tanpa error.

**Jendela & pintu rumah (satu aturan untuk tampilan, tabrakan, interior):** sel jendela (lebar 1,44 m tiap 3,6 m keliling) hanya ada bila utuh di dalam sisi dinding (≥ 0,3 m dari sudut) dan, di lantai dasar, tidak menumpuk pintu (± 0,2 m).
- `world.js`: atribut verteks baru `wseg` (rentang u sisi dinding) → shader meniadakan jendela terpotong sudut; tabel `uOpen` kini selalu berisi data pintu tiap rumah (kolom pertama 0/1 = tertutup/terbuka) → jendela yang menumpuk pintu ditiadakan dan **pintu tertutup digambar** (dua daun panel kayu, kusen, gagang) untuk rumah di luar jangkauan buka (85 m). `setHouseOpen(H, on)` (tanda tangan berubah).
- `collide.js` `winOk` dan `interiors.js` (lubang dinding dalam, kusen, gorden) memakai aturan yang sama. Dulu: jendela terpotong sudut tampak seperti celah rusak tetapi bisa dilompati; jendela di belakang pintu tampak kaca tetapi padat.

**Sedang dikerjakan agen (salinan kerja di scratchpad, belum masuk `web/`):** HUD ikon (`hud-v2`), karakter realistis (`characters-v3`), kendaraan + senjata + tangan PBR (`vehicles-weapons-pbr`). Aturan mesin untuk agen: Blender lewat `taskpolicy -b nice -n 19 … -t 2`, satu Chrome headless ber-vsync yang diparkir di `about:blank`.

**Belum:** impostor pohon jauh & pohon dekat yang lebih nyata, interior PBR, fasad ruko, refresh peta bayangan 4096² tiap 40 m (belum diukur), unggahan buffer kerumunan bot 380 KB per frame.

### 26b. Lanjutan 12 Nov: HUD ikon, interior, pohon
- **HUD ikon** (agen `hud-v2`, sudah live): `game/hud.js` ditulis ulang (membangun DOM HUD sendiri; `frame()` tiap frame hanya kompas/panah minimap/crosshair, `update()` ±20×/dtk dan hanya menulis DOM bila nilai berubah; minimap ≤ 10×/dtk; tanpa `backdrop-filter`). Kartu senjata bersiluet (`icons.js` `silhouette(kind)`, `warmIcons()` dari `weapons.glb`), peluru, mode tembak, isi ulang; darah dengan jejak kerusakan & pratinjau sembuh; rompi/helm berikon + level; perban/P3K/granat berikon; kill feed bersiluet senjata; indikator arah tembakan; altimeter terjun; panel kendaraan dengan denah jok. Biaya HUD 0,21 → 0,014 ms per frame. `main.js`: `hud.frame(...)` tiap frame, `hud.update({...})` bila `hud.due(t)`.
- **Ikon loot senjata** dulu terbalik (kamera atas dengan `up` −Z): kini dirender dari model detail (`renderHD`, tampak samping, laras ke kanan); cadangan LOD1 juga sudah tegak.
- **Matahari masuk ke dalam gedung:** `buildings.customDepthMaterial` (world.js) melubangi peta bayangan di pintu & jendela sah gedung yang bisa dimasuki; `bMat.shadowSide = DoubleSide`; `refreshShadows` (main.js) merapatkan rentang kedalaman kamera bayangan (bias ±1 texel). Material interior (mode realistis) kini menerima cahaya matahari penuh → bercak cahaya jendela di lantai. Eksposur otomatis di dalam gedung 2,1 → 1,7.
- **Tekstur interior** (interiors.js, atribut verteks `sfc`): ubin keramik (`floor_tiles_08`, diterangkan) di ruang umum/toko, lantai kayu (`laminate_floor_02`) di kamar tidur & lantai atas, detail plester di dinding; UV dari posisi dunia, lantai memakai peta normal. Unduhan: `tools/realism/fetch_interior.py` (Poly Haven CC0).
- **Pohon:** `swayGeo(geo, round)` membuat tajuk bervolume (normal kartu daun dicampur arah keluar pusat tajuk + oklusi bagian dalam). Pohon lingkungan (context.js) memakai model pohon kawasan (LOD sedang < 350 m, kartu silang di kejauhan) menggantikan ikosahedron.
- Partikel kena tembak di depan kamera dibatasi 22 px & dibulatkan (dulu kotak raksasa).

### 26c. Karakter realistis (12 Nov, agen `characters-v3`, sudah live)
- **Sumber:** data MakeHuman (CC0: mesh dasar, target morf, rig & bobot, pakaian, rambut, kulit) dibaca langsung oleh `tools/blender/mhdata.py` (tanpa add-on MPFB); `tools/blender/characters3.py` membentuk tubuh, memasang pakaian, memindahkan ke pose diam kerangka game, menurunkan bobot ke 17 tulang, merakit atlas tekstur, membuat LOD & GLB ber-skin. Cache unduhan: `~/.cache/senara-digital-twin` (722 MB, hanya untuk membangun ulang aset).
- **Aset:** `web/game/assets/characters/` — `people3.json`, `m1|f1|m2|f2.glb`, tekstur WebP (4,9 MB). `person.glb` lama = cadangan (dipakai bila aset baru belum termuat dalam 6 dtk).
- **`map/rig.js`:** `loadCharacterParts`, `buildCharacter(outfit, gear, look)`, `createCrowd` (`begin/inView/put/hide/flush/stats`), `setCharacterEnv(env)`, `characterVariants()`, `Rig.pose` tanpa alokasi + `updateWorld()`. `ShaderChunk.skinning_pars_vertex` ditambal dengan atribut `aRow` (baris tekstur tulang per instans).
- **LOD:** tubuh 10,8–11,9k (6 terdekat < 11 m) / 3,6–4,0k (22 berikutnya < 42 m) / 1,1–1,2k (< 150 m) / ±240 segitiga; rambut, helm lv1–3, rompi, ransel, senjata punya batas jarak sendiri; jarak dikali zoom kamera; bot di luar layar tidak digambar. Pose: tiap frame < 60 m, tiap 3 frame < 150 m, tiap 6 frame di atasnya. Bayangan: bot dalam 36 m dengan geometri LOD2 (mesh bayangan kerumunan dipindah ke posisi kamera tiap frame karena `syncOne` di realism.js membuang pembuat bayangan yang jauh dari fokus).
- **Varian:** 2 pria + 2 wanita, 4 gaya rambut, 6 warna kulit; pemain tetap ungu (sarung tangan gelap, manset emas; warna diduplikat di `OUTFIT` player.js).
- **Kinerja (60 bot dalam 120 m):** `bots.draw` 0,64 → 0,16 ms; segitiga satu frame 2,15 → 1,60 juta; sampah `rig.js`/`bots.js`/`player.js` ±0; unggahan buffer hanya rentang terpakai & saat berubah.
- **Belum sempurna:** rambut kartu alpha-test (tepi keras), jari kaku, helm/rompi/ransel prosedural sederhana, kaus `f1` masih memperlihatkan logo MakeHuman samar, avatar Jelajah di halaman peta masih model lama.

### 26d. Kendaraan, senjata & tangan PBR (12 Nov, agen `vehicles-weapons-pbr`, sudah live)
- **Kendaraan** (`tools/blender/vehicles.py`, `vehicles2.py` → `web/game/assets/vehicles/*.glb` + `manifest.json`): roda `wheel_v3`/`tire_v3` (ban ber-UV, pelek, cakram, baut), kaliper, lampu sungguhan, pelat bernomor, kabin (jok, setir, dasbor), normal berbobot, AO per sudut di `COLOR_0`, `make_lod1`; manifest: `gaps`, `lod1`, `trisLod1`, `cabin`, `dirt`. LOD0 7,6k–34k segitiga (loop 34k, di atas target 30k), LOD1 3k–6k.
- **`game/vehicles.js`:** `createVehicleLook`/`matLook`/`vehPatch`/`treadTex`/`packGeom`; `prepTemplate` menggabung tiap simpul bergerak jadi ≤ 3 mesh (cat clearcoat, satu material "uni" dengan warna/kekasaran/logam/emisi per verteks, kaca) → 7–8 draw call per kendaraan di LOD0, 1 di LOD1 (> ±62 m × zoom), tidak digambar > 450 m; simpul statis dibekukan; lampu rem = uniform per kendaraan; bangkai memakai satu material hangus; `warmUp` mengompilasi shader kendaraan di 3 frame pertama. Ekspor baru `instantiateVehicle`, `loadVehicleTemplates` (dipakai `garasi.html`). `main.js`: `vehicles.setEnv(R.env, R)`.
- **Senjata & tangan** (`tools/blender/weapons.py` → `weapons.glb`, 4,5 MB): bevel mikro, normal berbobot, AO & aus di `TEXCOORD_0`; lengan baru (lengan baju terlipat, manset emas, sarung tangan berpelindung buku jari); simpul baru `fp_forearm`, `fp_hand_open`; nama simpul & orientasi senjata tetap (siluet HUD aman). `game/weapons.js`: pustaka material orang pertama per nama material GLB (`VM_LOOK`, `vmPatch`, `vmMaterial`, `dressVm`), hanya senjata di tangan yang terpasang di adegan view-model, kilatan laras HDR, selongsong & asap ber-pool; `createEffects` = 3 draw call ber-pool (pita peluru, percikan/kilatan aditif, debu/darah; ukuran titik dibatasi). `game/nades.js`: inti ledakan HDR, cincin debu, asap.
- **Hasil ukur agen (adegan sama, 1280×720):** draw call 358 → 247, mesh kendaraan terlihat 151 → 44, simpul kendaraan 283 → 128. Pengukuran tanpa vsync sesudah perubahan belum dilakukan.
- **Catatan:** celah panel = garis shader dari `manifest.gaps` (hanya lintas, banteng, halilintar); lampu depan tetap level siang; AO banteng & walet dipanggang cepat (ulang: `tools/blender/vehicles.py --only banteng,walet`); pelat belakang jawara dipindah tetapi belum dicek ulang; `weapons.glb` dimuat dua kali (game & `icons.js`).

### 26e. Ukur ulang & fondasi lapisan meta (13 Nov)
- **Waktu frame tanpa vsync, 1512×900 @2× (mesin tenang, semua aset baru):**

  | Adegan | Ultra 1,5 | Ultra 1,25 | Tinggi 1,0 | Hemat 1,0 |
  |---|---|---|---|---|
  | Menu (sebelum perbaikan) | 8,8 | 7,6 | 6,6 | 5,6 |
  | Pesawat | 7,0 | 5,8 | 4,7 | 3,5 |
  | Jalan + 60 bot | 6,2 | 4,9 | 3,9 | 2,9 |
  | 6 kendaraan (orang pertama) | 6,3 | 4,9 | 4,1 | 3,2 |
  | Rumput | 6,2 | 4,8 | 4,0 | 3,0 |
  | Dalam rumah | 5,6 | 4,4 | 3,6 | 2,7 |

  (ms per frame; batas 120 Hz = 8,3 ms.) Menu: tanpa `vehicles.update()` semua kendaraan tergambar penuh dari 900 m → disembunyikan selama menu (718 → 195 draw call).
- **Fondasi lapisan meta** (untuk regu, lobi, misi, koin, skin): `game/hooks.js` (`matchHooks.onStart/onEnd`; `main.js` memanggilnya di `startMatch`/`finish` dengan ringkasan pertandingan), `game/profile.js` (profil di `localStorage` kunci `royale.profile.v1`: nama, koin, skin dimiliki/dipakai, regu, misi, statistik), `game/skins.js` (kerangka API: `CHAR_SKINS`, `GUN_SKINS`, `charOutfit`, `applyGunSkin`, `skinThumb`).
- **Alat uji:** halaman Chrome headless bisa berstatus `hidden` (rAF berhenti → game tampak macet di "Menyusun kota…"); klien CDP di scratchpad memanggil `Page.bringToFront` + `Emulation.setFocusEmulationEnabled`.

## 27. Lobi, Koin Sutera, misi acak (13 Nov 2026, agen `lobby-meta`, sudah live)

Permintaan Steven: halaman home yang bagus, mata uang yang (sementara) didapat dari misi acak, toko skin. Semua di peramban (localStorage), tanpa server.

- **`game/lobby.js`** — `createLobby(o)` → `{ focus, diff, frame, hide, showEnd }`: panggung 3D (`createStage`: regu 4 karakter berpose napas + label nama di trotoar jalan palem dekat The Prominence, koordinat data (270,3; 1668,0), kamera FOV 34 melayang pelan, bergeser saat panel terbuka, mendekat untuk pratinjau skin), seluruh UI lobi (bilah atas: nama yang bisa diubah, Koin Sutera, pengaturan; navigasi Lobi/Misi/Toko/Koleksi/Regu/Pengaturan; kartu regu; mode + tingkat kesulitan + tombol MULAI) dan layar akhir pertandingan (hasil, statistik, kemajuan misi, klaim). `#menu` dan `#end` di `royale.html` kini kosong dan diisi modul ini; id lama (`#diff`, `#sens`, `#endTitle`, `#againBtn`, …) sudah tidak ada. Kelas body `lb-on` selama lobi.
- **`game/lobby.css`** — gaya `.lb-*` (em, 720p–4K, tanpa `backdrop-filter`). Gaya lama `.g-menu-panel`, `.g-diff`, `.g-end`, `.g-card` di `royale.css` tidak terpakai.
- **`game/quests.js`** — `questState`, `applyMatch(summary)`, `claimQuest`, `claimAll`, `rerollDaily`, `dayKey`, `weekKey`. 3 misi harian (tiga tingkat, 100–260 koin; total sehari 460–570) + 2 mingguan (650–900 koin per misi); deterministik per hari/minggu (seed tanggal + jumlah acak ulang); satu acak ulang gratis per hari. Misi yang butuh bidang ringkasan tambahan (tembakan kepala, revive, kill per kelas senjata, jarak berkendara, …) baru muncul setelah ringkasan pertandingan pernah membawa bidang itu.
- **`game/profile.js`** — tambah `setName`, `ensureSquad`, `setMate`, statistik karier. Rekan bot: `profile.squad[0..2] = { name, skin, variant, hair, tone, hairC }`.
- **`main.js`** — blok menu lama diganti `createLobby({...})`; `lobby.hide()` di `startMatch`; `lobby.showEnd()` di `finish()`; cabang menu di `frame()` memanggil `lobby.frame`; bayangan dinamis aktif di fase menu (fokus `lobby.focus`); pengatur kualitas (governor) kini juga aktif di lobi.
- **Biaya lobi:** 186 draw call, 1,51 juta segitiga; 120 FPS di 1280×720 (headless, Ultra).
- **Tangga harga skin** (acuan hadiah misi): biasa 300, langka 800, epik 1800, legendaris 4000.
- **Lain-lain 13 Nov:** pita emas batas kawasan (7 m, tampak seperti bidang kuning polos) di game realistis jadi garis cat 0,7 m; kendaraan disembunyikan di fase menu.
- **Sedang dikerjakan:** mode regu 4 orang (agen `squad-mode`) dan katalog skin 8 + 8 (agen `skins`); toko/koleksi baru berisi skin bawaan sampai katalog masuk.

## 28. Kontrol terjun, inventaris, lobi solo, bensin, pelindung, aksesori senjata (17 Nov 2026, Jason + Claude)

Branch **`feat/terjun-inventaris-batas-lobi-solo`** (sudah di-push, belum digabung ke `main`), enam commit di atas `b1a37f6`:

| Commit | Isi |
|---|---|
| `c8c1f0e` | Kontrol terjun, buang barang, Esc panel loot, dinding batas kawasan |
| `d0bcff3` | Lobi mulai solo dengan slot tambah anggota |
| `e4a99bf` | Tumbang/pulih, bobot tas, minuman energi, Esc di peta, F saja untuk keluar kendaraan, terjun melayang/menukik |
| `84c77df` | Bensin kendaraan, jeriken, daya tahan pelindung, animasi minum |
| `f003820` | Aksesori senjata (magasin panjang, scope 2×/4×), seret-lepas di inventaris |
| `bc96952` | Aksesori di tas, scope 8×, teropong bawaan Elang/Rajawali jadi aksesori |

Semua perubahan di sisi peramban (`web/game/*.js`, `web/map/rig.js`); BFF tidak disentuh. Menjalankan: `cd bff && go build -o bin/alsut3d-bff ./cmd/server && ./bin/alsut3d-bff` → `http://127.0.0.1:8765/royale.html` (`bff/.env` disalin dari `.env.example`, `DB_HOST` kosong). File JS dilayani `no-cache`, jadi cukup muat ulang paksa setelah mengubah kode.

### 28.1 Terjun & parasut (`player.js` `air()`, `map/rig.js`)
- **A/D** geser samping kekuatan penuh (28 m/dtk terjun bebas, 13 payung) + badan/payung miring (`st.airLean`); **S** mengerem.
- **W saat terjun bebas** mengikuti pitch kamera: datar = melayang (maju 38, turun 38 m/dtk); menunduk = menukik (maju turun sampai 14, turun sampai 70). Tanpa W: maju ±5, turun 46.
- **Payung:** W condong ke depan (maju 13, turun 11), S lutut diangkat + turun lebih pelan (6 m/dtk); pose di `rig.js` (`m.cd`, `cfw`/`cbr`).

### 28.2 Panel tas, peta, kunci penunjuk (`player.js`, `hud.js`, `main.js`)
- **Esc di panel tas** hanya menutup panel (tanpa layar Jeda). Peramban menolak kunci-ulang penunjuk sesaat setelah Esc → `st.wantLock`, `st.escAt`, `escRelock`, `relockLoop()`; kamera tetap mengikuti mouse selama belum terkunci. **Esc juga menutup peta besar** (`ctx.mapOpen/closeMap`).
- **Klik kanan** barang di inventaris = buang ke tanah (`lootDrop(key)`; kunci `w:<slot>`, `a_<jenis>`, `h_<jenis>`, `g_<jenis>`, `jerry`, `v<lv>`/`m<lv>`/`b<lv>`, `x_<aksesori>`, `x:<slot>:<aksesori>`).
- **Di kendaraan hanya F yang turun** (E tidak lagi).

### 28.3 Dinding batas kawasan (`game/border.js`, baru)
Tirai emas tembus pandang setinggi 5 m di sepanjang batas, hanya tampak dalam ±42 m dari kamera; pesan "Batas kawasan — tidak bisa dilewati" saat pemain menempel.

### 28.4 Lobi solo (`lobby.js`, `lobby.css`, `profile.js`)
- Mulai dengan satu karakter; kartu **"+"** membuka modal "Tambah anggota" (rekan bot aktif; "Pemain online" masih nonaktif); × mengeluarkan anggota. `profile.party = [bool×3]`, `partySlots()`, `setParty(i,on)`; `applyParty()` di `startMatch()` (bot rekan yang tidak dipakai jadi regu musuh terpisah).
- **Lobi online belum dibuat.** Rencananya di `~/Claude-Orchestrate/SUTERA_ROYALE/plan-lobi-online.md` (opsi terpilih: SSE + HTTP POST, room di memori `bff/internal/lobby`, flag `LOBBY_ENABLED`). Keputusan terbuka: D1 tombol Mulai saat ≥2 manusia, D2 WebSocket bila sinkron pertandingan menyusul, D3 lokasi server (`LISTEN_ADDR` terbuka ikut membuka endpoint keluhan).

### 28.5 Tumbang & pulih (`main.js`: `DOWNS = true`, `REVIVE_HP = 20`)
Anggota regu tumbang dulu selama masih ada rekan berdiri; dipulihkan dengan menahan F (darah 20); yang tumbang bisa ditembak (kerusakan ×0,6). Main sendirian = langsung mati.

### 28.6 Tas berbobot (`loot.js`; hanya pemain, bot tetap batas per jenis)
- `BAG_CAP = [100, 200, 300, 400]` (tanpa tas, lv.1–3; barang `b1`–`b3`).
- `ITEM_W`: peluru ringan 0,4 · senapan 0,5 · shotgun 1,2 · runduk 1,5 · magnum 0,8 per butir; perban 2, P3K 10, minuman 4; granat 12, asap 10; jeriken 15; aksesori 5.
- `bagWeight`, `bagCap`, `bagFit`; peluru diambil sebanyak yang muat. Persen isi tas di HUD dan kepala panel.
- Tas lama jatuh saat ditukar; tas hanya bisa dibuang kalau isinya ≤ 100.

### 28.7 Minuman energi (`h_drink`, tombol 6)
4 dtk, +40 tenaga (`BOOST_DRINK`, maks 100); selama ada tenaga darah naik 1 HP/dtk sampai 100 (perban tetap berhenti di 75). Animasi sendiri di `weapons.js` `animHeal(..., 'drink')`: kaleng, tarik cincin, minum.

### 28.8 Bensin & jeriken (`vehicles.js`, `player.js`, `main.js`, `nades.js`)
- `v.fuel` 0–100 %, awal acak 35–100. `FUEL_RATE = 0.4` %/dtk saat gas, `FUEL_BOOST = 2.5`×. Hanya dihitung saat pemain menyetir; kosong → mesin mati (rem & setir tetap).
- **Jeriken** (`jerry`): **B** di kendaraan yang berhenti, 3 dtk, +60 %. Di tanah: `CAN_HITS = 3` peluru → meledak (radius 6,5 m, 120); ledakan apa pun dalam 70 % jari-jarinya juga memicunya (`blastCans`, terhalang gedung, berantai maks 16). `nades.boomFx(p)` = efek ledakan saja.

### 28.9 Daya tahan rompi & helm (`loot.js`, `main.js` `damage()`)
- `ARMOR_HP = { vest: [0,200,220,250], helmet: [0,80,150,230] }`; `agent.vestHp`/`helmetHp` (undefined = utuh), barang di tanah `it.hp`, peti `contents.vestHp/helmetHp`.
- Tiap peluru yang ditahan mengurangi daya tahan sebesar kerusakan mentahnya; habis → hancur. Berlaku juga untuk bot.
- Pelindung setingkat bisa diambil kalau lebih utuh; yang lama jatuh ke tanah (`r.swap`) dengan sisa daya tahannya.

### 28.10 Aksesori senjata (`weapons.js` `ATTACH`, `loot.js`, `player.js`, `hud.js`; hanya pemain)
- `inst.att = { mag, scope }`. **Magasin panjang** (`x_mag`): isi ×1,5 (`magCap(inst)`), semua senjata kecuali Kobra & Gada. **Scope** `x_s2` (FOV 38), `x_s4` (FOV 20), `x_s8` (FOV 76/zoom, zoom 4–8 lewat gulir saat membidik, `inst.zoom`). 2×: SMG, senapan, Elang, Rajawali; 4×: Garuda, Petir, Gempa, Elang, Rajawali; 8×: Elang, Rajawali. `hasScope` (tampilan teropong penuh) = scope ≥ 4.
- **Ambil:** terpasang ke senjata yang cocok (yang dipegang dulu); kalau tidak ada, masuk tas (`me.atts`); terpasang otomatis saat senjata cocok diambil dari tanah.
- **Panel:** seret label aksesori ke senjata lain (`moveAtt`), ke tas (`stashAtt`), ke kolom kanan (buang); seret dari tas / "Di sekitar" ke senjata (`bagTo`, `takeTo`); klik kanan melepas.
- **Senjata dibuang/ditukar:** `shedAtts()`: aksesori pindah ke senjata pengganti kalau cocok & kosong, selain itu jatuh terpisah.
- **Model:** scope 2×/4× = tabung prosedural di atas pisir (`buildScope`, `SCOPE_DY`). **Elang & Rajawali:** `WEAPONS.dmr/sniper.rail`: segitiga teropong bawaan dipisah saat `upgradeGun` (`G.builtin`) dan baru tampil kalau scope terpasang; tanpa scope FOV bidik 55.

### 28.11 Daftar Kontrol di lobi
`lobby.js` (tab Pengaturan): baris Obat, Aksi, Terjun, Tas, Aksesori, Kendaraan, Jeriken diperbarui.

### 28.12 Sudah diuji vs belum
- **Dilihat langsung di game:** scope 2× di Garuda (dipegang & membidik), Elang & Rajawali tanpa scope (dipegang & membidik), satu kaleng per pemakaian minuman.
- **Diuji lewat kode di peramban (bukan dimainkan):** bobot tas, tukar pelindung + daya tahan, pasang/ganti/simpan aksesori, ambil jeriken.
- **Belum diuji di pertandingan:** tumbang/pulih, kontrol & pose terjun, dinding batas, kunci-ulang penunjuk setelah Esc, bensin berkurang + isi dengan B, ledakan jeriken, hancurnya pelindung, seret-lepas di panel, gulir scope 8×, scope 4×/8× terpasang, posisi akhir animasi minum.

### 28.13 Batasan & sisa pekerjaan
- Bot tidak memakai bensin, tas, minuman, jeriken, atau aksesori.
- Peti jarahan tidak menyimpan aksesori (yang terpasang maupun di tas).
- Magasin panjang belum mengubah model senjata; Rajawali tanpa scope menyisakan serpihan dudukan di atas rel.
- Angka keseimbangan (bensin, daya tahan, bobot, peluang muncul barang) adalah tebakan awal.
- `.claude/` (penanda skill `/plan`) sengaja tidak di-commit.

## 29. Skin premium, suara tembakan per skin, efek & spanduk kill (18 Nov 2026, agen `skins`)

Permintaan Steven: skin senjata dibikin keren, suara tembakan berubah sesuai skin, animasi setelah kill (acuan pengalaman: bundle premium game FPS, tanpa meniru desain/nama), skin baju beranimasi, skin lebih bagus & lebih banyak.

- **Katalog (`game/skins.js`)**: 22 skin senjata + 18 skin karakter dalam 7 koleksi bertema (`COLLECTIONS`): Taktis Sutera, Wastra Nusantara, Pusaka, Panggung Rakyat, Amukan Alam, Neo Sutera, Kencana. Harga tetap tangga 300/800/1800/4000. ID lama tidak berubah (profil lama aman). Tema senjata `th`: `coat` (pernis), `tracer`/`flash` (warna HDR), `flame` (nyala moncong beranimasi: `{ style: fire|plasma|glint|spirit|arc|frost|glow, c1, c2 }`), `glow`, `voice` (suara), `kill` (efek), `emblem` + `color`/`color2` (spanduk). `skinFeatures(s)` = label keistimewaan di toko; `gunTheme()` = tema skin yang dipakai.
- **Shader (`game/skinfx.js`)**: semua motif prosedural, tanpa tekstur. Uniform waktu bersama `SF_U.uSfT` dimajukan `tickSkins()` sekali per frame (lobi: `lobby.frame`; pertandingan: view-model). `onSkinTick(fn)` untuk pembaruan per frame. Senjata: `sfGun(cls, …)` per `#if SF_GUN == n` mengisi warna/logam/kekasaran/pendar/relief (`hgt`)/pernis (`coat`); kelas bahan dari NAMA material GLB (`weapons.js VM_CLS`: metal 1, dark 4, poly/olive/yellow 2, grip 3, wood 5, gold 9). Karakter: `sfChar(fx, slot, …, vdn, …)`, lengan orang pertama `sfSleeve`. `FLAME_VS/FS` = nyala moncong (billboard shader), `AURA_*` = selubung aura.
- **View-model (`game/weapons.js`)**: `vmSkinned(base, fx, coat)` (MeshPhysical + clearcoat untuk skin berpernis), uniform `uSfG` (x pendar isi ulang/periksa/cabut, y panas tembakan, z kilat tembakan, w posisi sapuan cahaya) diisi `skinFxTick()` yang HANYA membaca `st.flashT/st.act/st.inspect/st.swap` (satu baris di `update()` sebelum `st.flashT -= dt`; tembakan baru dideteksi dari `st.flashT` yang naik). `setSkinFx(theme)`: warna kilatan & cahaya moncong, nyala moncong (`createSkinFlame`, billboard di titik moncong; membesar saat menembak/panas, memudar saat membidik), pelacak pemain (`createEffects().tracer(…, mine)`), bunyi `cue`. `vm.compile(renderer, rt)`: kompilasi semua program view-model (ke target render & layar) — dipanggil `applyEquipped` saat pertandingan mulai. Varian ber-skin tidak menghitung butir/relief mikro bawaan (diganti pola skin) supaya hemat GPU.
- **Suara (`game/audio.js`)**: `VOICES` (crystal, pulse, glitch, thunder, bonang, gong, garuda, reog, dragon, plasma, chime) = resep sintesis; lapisan tembakan dipra-render sekali per suara (`renderAudio` + OfflineAudioContext) lalu tiap tembakan cukup satu sumber buffer; `base` mengubah tembakan dasar (noise/dentum/frekuensi). `shot(kind, dist, pan, muffled, mine)`; `setShotVoice`, `previewShot`, `skinCue('equip'|'inspect'|'reload')`, `killSting(n, voice, knock)` (nada naik tiap kill beruntun, ke-5+ akor + dentum).
- **Efek kill (`game/killfx.js`, baru)**: `createKillFx({ scene, hud })` → `kill(korban, kepala)`, `knock(…)`, `update(dt)`, `preview(pos, n, id)`. Hitungan beruntun (jeda ≤ 12 dtk), 2 draw call (partikel aditif 700 + padat 360) berbentuk pijar/serpih/bulu/kelopak/piksel/cincin/pilar/bulu merak/kilat/asap; gaya per tema: burst, shatter, ember, feather, peacock, pixel, disintegrate, bolt, petal, spirit, pearl. Mulai kill ke-3 pilar cahaya, ke-5 gelombang kejut ganda. Pose mati & peti tidak disentuh.
- **Spanduk (`game/hud.js createKillBanner` + `game/killfx.css`)**: lambang 48×48 per tema, 5 pip, label Kill/Ganda/Tripel/Beringas/Amuk(×n), "Tumbang" untuk melumpuhkan, sinar mulai ke-3, sinar tepi layar ke-4, kejut ke-5. Spanduk lama di `hud.feed` dihapus (kill feed tetap).
- **Lobi (`game/lobby.js/.css`)**: toko per koleksi + label keistimewaan, kartu legendaris berkilau; pratinjau karakter berputar (tanpa rompi/ransel), etalase senjata melayang & berputar (material view-model asli) dengan pilihan 11 jenis senjata, tombol "Dengar tembakan" & "Efek kill" (hitungan 1→5 tiap klik). Gambar kecil & etalase dikompilasi di latar (`compileSkinAsync`, KHR_parallel_shader_compile) → lobi tetap mulus (uji: p95 10,1 ms selama 22 gambar kecil dibuat).
- **main.js (kait kecil)**: impor + `createKillFx`, `audio.shot(…, shooter.isPlayer)`, `fx.tracer(…, shooter.isPlayer)`, `kills.knock` di `knock()`, `kills.kill` di `kill()` (menggantikan `audio.kill()`), `kills.update(dt)` setelah `fx.update(dt)`.
- **Ukur (headless, GPU dipakai bersama 5 Chrome lain)**: pass view-model 2268×1350, kueri waktu GPU diselang-seling pabrik/skin, rata-rata 3 terkecil dari 24: selisih skin −0,22…+0,30 ms, rata-rata +0,06 ms (derau ±0,15). Tidak ada program shader baru setelah pertandingan mulai selain satu milik peti (lambert, sudah ada sebelumnya). Partikel kill: perkiraan isi piksel 0,1–0,3 ms hanya saat 5 kill serentak.
- **Belum**: rekan regu bot belum memakai skin di pertandingan (bots.js), skin per jenis senjata (kini satu skin untuk semua senjata), aura hanya orang ketiga pemain & lobi.
- **Revisi 18 Nov sore (keluhan Steven: "animasinya titik-titik doang", termasuk Inti Magma & skin baju)**: semua efek titik dihapus (partikel moncong & serbuk aura; partikel kill sudah dimatikan di 3215e6b). Gantinya animasi berbentuk:
  - **Badan senjata (shader)**: lava benar-benar MENGALIR di retakan Inti Magma (gelombang terang ±0,5 m/dtk ke moncong + riak cepat, bara bernapas di sekitar retakan, jilatan api, panas menembak melebarkan retakan & memutihkan cahaya, laras membara); arus plasma melesat di kanal + pita pindaian holo (Reaktor Plasma); sapuan emas tiap 2,2 dtk + bulu menyala beriak (Emas Garuda); inti mata merak berdenyut bergiliran + kilau kipas berpelangi (Dadak Merak); dua rangkaian gelombang energi (Neon Ungu); tirai aurora & embun beku merayap (Kristal Es); kilat lebih besar (Badai Petir); juga songket, pamor, holo, mutiara dipertegas.
  - **Nyala moncong**: billboard shader `createSkinFlame` (api menjilat, bola plasma berbusur, bintang kilau, api roh, busur listrik, kabut beku, pijar) — di tangan pemain & di etalase toko.
  - **Baju & lengan orang pertama**: lava naik di retakan (Inti Magma), garis neon tebal dengan denyut melesat, arus energi + pindaian + inti dada berdetak bergelombang cincin (Reaktor), sapuan emas diagonal (Garuda, Batik, Kencana), mata merak berdenyut (Warok), embun merayap (Es), pamor bercahaya (Empu).
  - **Aura legendaris**: `setCharAura` = selubung tubuh (mesh & kerangka tubuh dipakai bersama, dikembangkan menurut normal, aditif, fresnel tajam, fragmen dalam siluet dibuang) dengan lidah api emas naik (Garuda), api roh berpusar (Warok), medan energi kisi + pindaian (Reaktor); wajah tetap terlihat.
  - **Etalase toko**: material view-model yang sama diperagakan (`setVmGlow`: pendar berdenyut, panas naik-turun, sapuan tiap 3,5 dtk) + nyala moncong.
  - **Ukur** (2268×1350, kueri waktu GPU min-of-24 diselang-seling): pass senjata magma +0,19, plasma +0,05, garuda +0,22, reog +0,13, neon +0,15, es +0,22, petir +0,28 ms (kontrol −0,07); lengan ber-skin ≤ +0,08 ms. Aura hanya orang ketiga/lobi (tidak digambar di orang pertama). Tidak ada program shader skin baru setelah pertandingan mulai (aura dikompilasi di `applyEquipped`).

## 30. Gedung, menonton, perbaikan tampilan (18 Nov 2026, integrator + agen `world`)

Permintaan Steven (18 Nov): gedung masih bug (tembok seperti tidak ter-render penuh), lompat dari lantai 2 ke kanopi tembus, perbaiki objek ber-collision, mode menonton setelah mati, bot sering diam, objek lingkungan lebih banyak & realistis (contoh tower pemancar), semua gedung bisa dimasuki, skin (§29), animasi reload/obat cacat.

Kerja di branch lokal **`feat/royale-v2`** (belum di-push). Agen paralel bekerja di git worktree `.wt/<nama>` (branch `wip/<nama>`, `.wt/` di `.git/info/exclude`) lalu digabung ke `feat/royale-v2`. Alat uji di `.wt/_tools` (README di sana: `serve.mjs` menyuntik `window.__G`/`__LOGS` saat menyajikan, `cdpd.mjs` satu Chrome headless Metal yang halamannya tetap fokus, `cdp` klien, `setup.js` → `window.__T` kamera bebas & mode kebal). Tidak ada kait uji di `web/`.

### 30.1 Kanopi & API rintangan (`map/collide.js`)
- Kanopi teras, kanopi ruko & kanopi pintu mal kini punya `floor` (atapnya bisa dipijak): lompat dari jendela lantai 2 mendarat di atap teras (2,82 m). Uji: `vaultSpot` dari kamar atas rumah #14 → y 3,3 → 2,82.
- `col.addObstacles(list)`: rintangan dari modul lain — poligon `{pts}`, lingkaran `{x,y,r}` (segi-8), kotak `{x,y,w,d,rot}`; `h`, `z0`, `floor`. Indeks gedung −3. Panggil sebelum bot bernavigasi (sel nav di-cache).

### 30.2 Mode menonton (`main.js`, `player.js`, `hud.js`, `royale.css`, `royale.html`)
- Regu pemain habis (dan masih > 1 regu lain) → `eliminated()`: ringkasan & hadiah langsung (`summary()` sekali per pertandingan), kartu **Tersingkir** (`hud.death(info, onWatch, onLobby)`: peringkat, penyingkir + senjata atau sebab — zona/tenggelam/kecelakaan/kehabisan darah/ledakan, kill, kerusakan, lama bertahan), tombol Tonton pertandingan / Kembali ke lobi. Kartu terbuka tidak dianggap jeda (`hud.deathOpen()` di `pointerlockchange`).
- Menonton (`specAll`): semua yang masih hidup, mulai dari penyingkir; yang ditonton tersingkir → kamera pindah ke penyingkirnya (`specTo`); yang masih di pesawat hanya dipilih kalau tidak ada yang lain. Bilah bawah: nama, regu/kill/senjata/keadaan (`specSub`), darah.
- Kontrol: Spasi/F/D/→/klik kiri berikutnya, A/←/klik kanan sebelumnya, V kamera ikut pandangan ↔ bebas (`st.specFree`; ikut = kamera berputar ke arah hadap yang ditonton bila mouse diam 1,2 dtk, di atas bahu kanan), M peta, Esc → menu jeda dengan tombol **Kembali ke lobi** (`#lobbyBtn`, hanya saat menonton).
- Pertandingan selesai saat menonton → "Pertandingan selesai · Juara: regu X" lalu layar akhir (3,2 dtk). `finish(win, quick)`: quick = dari kartu/menu (langsung).

### 30.3 Gedung & collision (agen `world`, `map/world.js`, `interiors.js`, `collide.js`, `player.js`, `loot.js`)
- **Tembok bolong yang ditemukan & diperbaiki:** (1) celah tembus ke luar di pojok cekung — 373 gedung / 737 pojok (sisi dalam dinding & strip collider kini bertemu di pojok, `e.x0/e.x1` di `edgesOf`); (2) ±100 pintu belakang di sisi buta tampak tembok dari luar tetapi terbuka dari dalam (shader kini menggambar pintunya, hanya jendela yang ditiadakan); (3) bangunan jenis 5 (atap OSM) dulu prisma putih padat tanpa collision — kini kanopi pelat bertiang (tiang padat, pelat menahan peluru, atasnya bisa dipijak; `D.canopy`), #5513 (129,9 m) jadi menara kaca (jenis 5 > 12 m → 2 di `buildWorld`); (4) kamera orang ketiga dekat dinding/pagar tangga (jarak min 0,12 m, karakter disembunyikan < 0,4 m); (5) collider tangga 6 irisan (dulu satu kotak 3,3 m menahan peluru di udara kosong); (6) menara di atas podium. Penyisiran 5.799 gedung: tanpa exception saat membangun interior.
- **Semua gedung bisa dimasuki:** 5.799/5.799 gedung tertutup (3 sisanya kanopi terbuka). Rumah besar/aneh dibagi banyak ruang (ambang 1,6 m), pintu cadangan bertahap sampai 1 m; jenis 0 > 1.500 m² = aula. **32 menara/jenis 3**: lobi (pintu kaca + kanopi, resepsionis, kolom, sofa, tanaman, inti lift 2 pintu) dan **lift**: F di pintu lift → layar meredup "▲ ATAP" → atap (dek + parapet 0,9 m: berdiri/jongkok bisa menembak, tiarap = perlindungan; penthouse + pintu lift, tandon, unit AC, helipad di #839); F lagi turun. `col.lifts`, `liftAt`, `roofAt`; `D.roofs`. Parasut bisa mendarat di atap/kanopi/penthouse. Loot di kanopi, lobi, 153 di atap (`claim = {roof:true}` → bot tidak mengincarnya).
- **Collision:** batang pohon menahan peluru & pandangan (silinder per sel; tinggi 3,2/8,5/5 m; tajuk tetap tembus; `out.b = −4`), kursi meja makan, lemari dapur atas, atap kios, parapet/penthouse/AC/tandon, daun pintu kaca lobi. Pagar jembatan disamakan dengan `bridges()` (data sekarang tanpa jembatan).
- **Interior:** tetap dibangun malas ≤ 85 m, kini dengan anggaran 1,5 ms/frame; frame > 4 ms karena interior 67 → 6–22 (3 rute × 2). Biaya frame setara (≤ +0,2 ms CPU, draw call +6…+14 dekat mal/menara).
- **Belum:** dinding lobi padat dari dalam (kaca tidak tembus pandang), satu tata letak lobi untuk semua, bot tidak memakai lift, tanpa kerusakan jatuh.

### 30.4 Perbaikan tampilan lain (integrator)
- **Rumput & daun putih di grafik Hemat** (bug lama, ada sejak `60847a1`): shader daun (`realism.js foliageMaterial`) menulis alfa 0,25 sebagai topeng AO; `R.uPost` tidak pernah diubah, jadi tanpa post-processing alfa itu tertulis ke kanvas dan tembus ke latar halaman. Kini `main.js` frame(): `R.uPost.value = postOn ? 1 : 0`.
- **Efek kill dari jarak sangat dekat menutup layar** (sprite sampai 900 px): `killfx.js` VS memudarkan partikel < ±1,5 m dari kamera atau > 30–70 % tinggi layar.
- **Eksposur di atap gedung rendah** (< 9 m) dulu dianggap dalam gedung: kini dikecualikan bila `col.roofAt(...) > 0`.

## 31. Animasi orang pertama & ketiga dirombak (18 Nov 2026, agen `anim`)

Keluhan Steven: "animasi beberapa diperbaikin kek reload, pake medkit dll, keliatan cacadnya; animasi yang senjata itu juga termasuk reload". Audit filmstrip (waktu virtual, 10–16 frame per aksi) menemukan: lengan kiri (potongan GLB tangan+lengan kaku) dipindah utuh → tangan melayang tanpa lengan / lengan baju menutupi layar; tiap kunci animasi berhenti (smoothstep per segmen); magasin hanya bergeser (tidak ikut tangan berputar); shotgun memasukkan selongsong 11 cm di bawah lubang isi; speedloader ke DEPAN silinder; bunyi isi ulang di 5/45/85 % durasi (tidak sesuai animasi); batal/ganti aksi meloncat; P3K & minuman: tangan datar kaku, layar kosong ±0,7 dtk, tutup kaleng menghadap kamera, senjata naik + dip kedua setelah selesai; granat orang ketiga tidak punya pose; periksa senjata memutar popor melintasi tengah layar.

- **Inti (`game/weapons.js createViewModel`, bagian "Animasi orang pertama")**: `curve()` = Hermite C1 dengan tangen tanpa melampaui titik balik (kunci `[t,x,y,z,henti?]` dibuat sekali, bukan per frame). `aimArm`/`aimArm2`: potongan GLB tangan+lengan (`fp_hand_l/_r/_nade`, sumbu lengan `AX_*`) ditaruh di titik genggam, lengan bawah diarahkan ke siku di luar layar, putaran dari sudut atau dari arah barang yang dipegang (sumbu kaleng/jarum/gulungan, arah telapak). `keepSleeve`: ujung lengan baju tidak pernah terlihat di layar. Pose senjata = `M_dasar · M_aksi` (aksi diputar di pegangan). Pegas untuk sentakan tembakan (per `WEAPONS.recoil`), dorongan magasin masuk/kokang, mendarat.
- **Isi ulang**: lini waktu per kelas (`magKeys`, `shotgunKeys`, `revolverKeys`, `dbsKeys`), selesai tepat di `WEAPONS[kind].reload`. Kosong: magasin dijatuhkan (jatuh bebas di ruang kamera), magasin baru dibawa tangan dari kantong (di luar layar) & pas di lubangnya, lalu tepuk bolt / tarik tuas / slide pistol / bolt runduk (tangan kanan). Taktis: magasin lama dicabut & disimpan, tanpa kokang. Slide pistol dipisah dari model (`rigGun`, segitiga logam y > 0,0618): mundur tiap tembakan, terkunci saat magasin 0 (`vm.update({ mag })`). Shotgun: jalur selongsong dihitung lalu tangan mengikuti (pasti masuk lubang isi), dipompa bila kosong. Revolver: silinder diayun di engsel, selongsong kosong jatuh, speedloader dari belakang. Laras ganda: dipatahkan, selongsong terlontar, 1–2 dimasukkan, ditutup dengan sentakan. Bunyi dari lini waktu (`props.cue` → `audio.cue('out'|'in'|'bolt'|'pump'|'shell'|'open'|'close'|'eject'|'tab'|'tap')`). Batal/ganti senjata/ganti aksi: pose dibekukan & dipudarkan 0,22 dtk (`A.cut`, `st.fade`).
- **Obat (`HEAL_K`, `animHeal`)**: perban (lengan kiri disodorkan, gulungan memutari lengan 3×, balutan tumbuh ke arah siku, ujung ditekan), P3K (kotak dipegang di tepi, tutup dibuka, suntikan diambil, lengan kiri ditegakkan, jarum tepat di sisi dalam lengan, pendorong ditekan), minuman (kaleng tegak, cincin ditarik tangan kiri, diminum miring di tengah-bawah layar). Senjata turun di awal & naik tepat di akhir durasi.
- **Lain-lain**: granat (naik, pin dicabut tangan kiri, ditarik ke belakang selama ditahan, ayunan lempar lalu senjata naik), periksa (sisi kiri → magasin ditepuk → kembali), ganti senjata (turun makin cepat, naik sedikit lewat lalu diam), pompa/bolt setelah tembakan dengan tangan ikut.
- **Orang ketiga (`map/rig.js`)**: isi ulang = IK tangan kiri lewat jalur lubang magasin → kantong rompi → masuk → tuas (`rl3Point`); obat per `s.healKind` (bawaan perban; P3K; minum: tangan ke mulut, kepala mendongak); granat: `s.nadeHold` (lengan ditarik) & impuls `s.throw` dari `nades.throwNade` (pemain & bot). Bot belum mengirim `healKind` (`bots.js`: cukup `p.healKind = b.healEnd ? b.ai.healKind : null` di blok pose).
- **Uji**: alat filmstrip & lab pose di `.wt/_tools`-style skrip agen (waktu virtual), detektor loncatan (kecepatan tangan isi ulang ≤ ±4,4 m/dtk kecuali magasin jatuh bebas; ujung lengan terlihat 0 langkah), tanpa error konsol, biaya `vm.update` ±0,03–0,05 ms per frame.
- **Belum**: jari tetap kaku (potongan GLB tanpa tulang jari), magasin di tangan karakter orang ketiga tidak dilepas (satu geometri), tutup kotak P3K kadang tertembus tangan kanan.

### 31.1 Tangan kiri dipaskan per senjata (18 Nov 2026, agen `anim`)

Keluhan Steven: "animasi pegang senjata masih cacad, masa keliatan 1 jarinya nongol". Penyebab: `fp_hand_l` satu genggaman untuk semua senjata — ibu jari lurus menjulur ke depan di bawah sisi kiri pelindung tangan (dari kamera tampak seperti satu jari tegak), ujung jari mengait di atas pelindung yang tipis/rendah (SMG, PDW, Petir heksagon, LMG, Gada), pistol & revolver memakai tangan terbuka dengan jari tegak di samping gagang.
- **`tools/blender/weapons.py` v5**: `build_hand_l_fit(kind, bvh, guard)` → node baru `fp_hand_l_<jenis>` (9 senapan/shotgun) dan `build_hand_l_pistol()` → `fp_hand_l_pistol` (pistol & revolver, `HAND_L_OF`). Penampang diukur dengan sinar ke rakitan senjata yang sudah jadi (badan + `shotgun_pump`/`dbs_brk`; shotgun hanya pompanya), kulit cembung lewat fungsi tumpu per 1°. Telapak datar dicari kemiringan & letaknya (skor: ujung jari ±35° di sisi kanan, bonggol ujung jari ≥ 3 mm di bawah punggung pelindung — rel/pegangan angkut di tengah diabaikan, sendi tidak melayang, telapak tidak terlalu miring). Ruas jari kaku melingkari kulit (titik pada polyline offset sejauh panjang ruas; sendi diangkat bila tengah ruas menembus). Ibu jari rebah di sisi kiri menghadap depan (sinar radial, stabil di sisi tegak). Pistol: telapak di sisi kiri gagang, jari membungkus jari tangan kanan di depan gagang, ibu jari di bawah ibu jari kanan. Lengan bawah searah `fp_hand_l` (AX_L tetap berlaku untuk animasi), lengan baju 0,46 m (dulu ujung terpotongnya terlihat saat membidik DMR/runduk). Tanpa bevel mikro: ±2,8 rb segitiga per tangan (`fp_hand_l` 6,4 rb).
- **GLB**: `<jenis>_guard` pindah ke pusat telapak baru; weapons.json `weapons[].handL` + `hands.fp_hand_l_*`. Ke-76 nama node & semua material lama tetap, +10 node. weapons.glb 4.506.912 → 5.213.024 byte. `fp_hand_l` lama tetap (rig obat & granat).
- **`web/game/weapons.js`**: `upgradeGun` memakai `fp_hand_l_<jenis>` (fallback `fp_hand_l`), `G.armL` menerima awalan `fp_hand_l`; saat kokang bolt runduk tangan kiri tidak lagi diputar `keepSleeve` (dulu jarinya menyembul di atas forend); pemisahan teropong bawaan menyembunyikan juga segitiga yang salah satu sudutnya di daerah teropong (paku hitam di rel runduk & serpihan lonceng objektif yang melayang hilang), `WEAPONS.sniper.rail[3] = 0,034` (jarak bawah sumbu).
- **Uji**: lab & game, 11 senjata × (pinggul, ADS, tembak, kamera debug kiri/depan-kiri/bawah/kanan), sebelum/sesudah; filmstrip isi ulang 8 senjata, periksa, kokang bolt, pompa, P3K — tanpa error konsol. Bangun ulang: `taskpolicy -b nice -n 19 Blender -b --factory-startup -P tools/blender/weapons.py -t 2` (±40 dtk, tanpa `--kinds`).
- **Belum**: bentuk jari tetap per senjata (tidak menyesuaikan saat tangan beraksi); SMG/PDW (pelindung tipis) digenggam dari sisi kiri-bawah — ujung jari tidak bisa ke sisi kanan atas tanpa menyembul.

## 32. Benda lingkungan kota (18 Nov 2026, agen `props`)

Permintaan Steven: dunia terasa kosong (cuma rumput, gedung, air); tambah objek kreatif & realistis, contoh tower pemancar.

- **Data:** `tools/build_props.py` → `web/data/alsut-props.json` (68 KB): proyeksi & batas sama dengan `build_map.py`; OSM (`data/osm/alsut.geojsonseq`) + penempatan prosedural; tiap titik dicek di dalam kawasan, bukan aspal/gedung/air, jauh dari pohon (termasuk pohon yang dipindah `trees.js`) & benda lain. Bangun ulang: `python3 -I tools/build_props.py data/osm/alsut.geojsonseq web/data/alsut-map.json web/data/alsut-props.json` (±5 dtk).
- **Model:** `tools/blender/envprops.py` → `web/game/assets/env/envprops.glb` (3,2 MB) + `envprops.json` (31 model, 1–3 LOD, material PBR bernama, AO per sudut di COLOR_0; manifest: segitiga per LOD, bentuk collision, titik kabel, posisi lampu). Pratinjau `preview/env/lineup*.png`.
- **`web/map/envprops.js`:** `loadEnvProps()`, `createEnvProps(W, assets, col, homes)`. Satu material PBR bersama (kekasaran/logam/AO/pendar per verteks, kotoran tanah, bayangan dinamis `R.patch`, pantulan `R.env`); papan & iklan dari atlas kanvas 2048×1280 (tanpa unduhan). Model sejenis digabung per LOD jadi satu InstancedMesh (bagian dipilih di shader); semua kabel satu mesh pita menghadap kamera; pagar & pagar proyek satu mesh. Instans diurutkan menurut jarak tiap kamera pindah ≥ 8 m; jangkauan ikut zoom (maks 4×).
- **Isi (±2.370 benda):** 22 menara SUTET 500 kV + 314 bentang kabel (5 di dalam kawasan, collision hanya di 4 kaki), 10 BTS merah-putih (antena panel, parabola, lampu penerbangan berkedip, kabinet, pagar), 9 tiang antena di atap menara (`col.roofAt`), 616 lampu jalan LED + 126 lengan ganda di median (menggantikan 831 tiang polos; `W.lamps` disembunyikan), 247 tiang listrik beton (28 bertrafo) + kabel TM/TR/telekomunikasi + 175 sambungan rumah, 43 halte "Sutera Loop", 158 palang pintu (terangkat), 211 pilar gerbang, 35 pos satpam, 38 monumen nama cluster, 14 lampu lalu lintas (fase merah/kuning/hijau + hitung mundur), 37 billboard (8 iklan fiktif) + 4 videotron beranimasi, SPBU fiktif "Sutera Petro" (12 pulau pompa, 2 tiang harga), lapangan (gawang, ring basket, jaring, pagar), 8 tower crane berputar + 6 kontainer + 3,5 km pagar seng "Sutera Land", 308 bangku, 192 tempat sampah ganda, 227 hidran, 5 gazebo, taman bermain, 2 menara air.
- **Collision:** 4.286 rintangan lewat `col.addObstacles` (dipanggil tepat setelah `createCollider` di `main.js start()`): tiang lampu, panel halte (atap halte bisa dipijak 2,76 m), pos satpam, kaki billboard, dasar crane menahan gerak & peluru; bangku & rumah palang rendah (peluru setinggi 1,2 m lewat). 0 pintu gedung tertutup benda.
- **Kinerja (A/B Ultra 1280×720):** +10…+22 draw call, +0,10…+0,18 ms per frame; waktu muat setara (createEnvProps ±100 ms).
- **main.js:** impor, `envP` dimuat paralel di `boot()` (batas 15 dtk) → `start(D, real, env)`, `createEnvProps(...)` + `col.addObstacles(envProps.obstacles)` setelah `createCollider`, `envProps.update(camera, t)` sebelum `scene.updateMatrixWorld()`. Aset gagal dimuat → tiang lampu lama tetap tampil.
- **Belum:** bot belum sengaja berlindung di balik benda ini (nav.js cari perlindungan hanya dari poligon gedung), bayangan crane berputar statis, pagar kawat pudar > 30 m (alpha test), lampu malam belum tersambung (game selalu siang), satu iklan memakai emoji cabai (tergantung font emoji sistem).

## 33. Bot tidak lagi diam, AI lebih pintar (18 Nov 2026, agen `bots`)

Keluhan Steven: bot kadang diam sendiri dan baru bergerak setelah didekati. Ukur (tanpa pemain terlihat/terdengar): bot hidup di darat yang diam < 2 m per 10 dtk tanpa alasan **9,8–34 % → 0,05–0,4 %**; biaya `bots.update` setara (±0,7 ms rata-rata, 99 bot).

- **Akar:** (1) grid nav 1 m hanya mengecek pusat sel → jalur menembus dinding rumah 0,12–0,2 m di samping pintu, bot mendorong tembok selamanya (kategori terbesar); (2) deteksi macet hanya bila < 0,6 m/dtk selama 1,2 dtk — bot yang meluncur/bergetar di dinding lolos, dan think berikutnya memilih sasaran yang sama lagi; (3) rute antar-lantai melompat ke potongan "naik tangga" saat potongan sebelumnya gagal; (4) graf jalan: simpul di luar kawasan, masuk dari simpul terdekat (sering di belakang), titik dianggap tercapai terlalu jauh (memotong sudut ke gedung); (5) jarah: hanya 2 slot lewati, nilai barang tidak sama dengan `applyItem`, `lootT` pemimpin tidak pernah direset; (6) celah sekat 1,4 m tertutup di grid 1 m; (7) pengikut tanpa jalan keluar bila pemimpin macet/kendaraan penuh; (8) dinding zona pertama (12 m/dtk) lebih cepat dari logika bertarung; (9) bot tak bersenjata diam; (10) pengikut di lift mengulang rencana tiap 0,6 dtk. "Baru gerak kalau didekati" = bot macet terbangun oleh penglihatan/pendengaran lalu dapat jalur baru (tidak ada logika jarak pemain).
- **`nav.js`:** tiap langkah grid & garis lurus diuji tepat (lingkaran badan disapu ke poligon collider, hasil di-cache per sisi grid), indeks poligon 4 m + cache bertipe; celah pintu & sekat (`homes`) jadi titik lewat; sel awal tidak pernah dari balik dinding; perlindungan juga dari benda jalan (b = −3, tinggi ≥ 1,2 m). `createNav(col, homes)`.
- **`bots.js`:** watchdog (≤ 2,5 m dalam 4 dtk atau tanpa kemajuan ke titik jalan 7 dtk → sasaran dilewati sementara, mundur ke titik bebas terakhir / 16 arah; gagal berulang → pengikut bertindak sendiri; sopir macet 7 dtk turun), rute antar-lantai dibatalkan bila potongan gagal, ruas jalan tempat macet dihindari semua bot 120 dtk, beberapa simpul masuk, keluar gedung lewat pintu dulu, anggaran pencarian jalur 3 ms/frame. Jarah: nilai = `applyItem`, daftar lewati 8 barang berkedaluwarsa. `col.fitProne` untuk bot tiarap & tumbang; `p.healKind` di pose bot.
- **AI (parameter baru di `DIFFICULTY`: `lootT`, `third`, `finish`, `hold`, `smoke`, `early`, `wary`):** jarah bertujuan lalu rotasi ke zona lebih awal, urgensi zona memperhitungkan laju dinding, ingat arah tembakan jauh & ikut pertempuran (third party, tidak saat zona menyusut), menghabisi lawan tumbang, mundur saat sekarat, bertahan di dalam rumah menghadap pintu, asap saat mundur/memulihkan, pengikut ambil kendaraan sendiri bila kendaraan pemimpin penuh, **bot naik lift menara** (bisa menyusul ke atap & mengambil loot atap — `claim.roof` diabaikan bot). Tanpa wall-hack.
- **main.js (integrator):** luka zona tidak lagi membatalkan memulihkan rekan.
- **Belum:** jalur berpindah dari perlindungan ke perlindungan di tanah terbuka, sniping sengaja dari atap, sopir belum menembak; angka keseimbangan tebakan awal.

### 32b. Revisi 18 Nov (masukan Steven: dinding "Sutera …" aneh, gerbang bisa dilewati dari samping, objek kurang realistis)
- **Gapura cluster** (`D.gates` dari `tools/build_props.py`, dibangun di `envprops.js`): 50 dari 63 pintu masuk cluster dapat gapura melintang jalan — dua pilar berlapis batu 6,8 m berlampu di tepi jalan, balok 5,5 m dengan nama cluster huruf emas menyala di kedua muka, pos satpam di sisi dalam, palang di lajur, tembok sayap 3–17 m tiap sisi (mengikuti batas cluster; alas batu, alur, tutup, pilaster tiap 3 m; berhenti ≥ 1,5 m sebelum pintu rumah). Collision: pilar, balok (hanya ≥ 5,4 m), segmen tembok & pilaster padat. 13 pintu masuk tanpa ruang (simpang/gedung terlalu dekat) hanya pos satpam + palang. Monumen nama berdiri sendiri dihapus.
- **Pagar proyek "Sutera Land":** tidak pernah < 2,5 m dari rumah atau di jalan/gedung/pohon/air; kebanyakan seng polos/biru, spanduk sesekali (4 desain fiktif); tiang di tiap sambungan & ujung (collision menerus: 0 bocor dari 2.004 uji lintas).
- **Audit:** benda di tanah dibuang bila menimpa gedung/tembok/pohon/air/pintu/lajur (hanya 7); jaring lapangan kini padat; pagar kawat diberi tiang ujung.
- **Realisme:** permukaan benda memakai tekstur foto beton & plester mode realistis (tanpa unduhan tambahan) + relief, kotoran dekat tanah, karat di kaki logam, variasi warna per benda; pagar/pagar proyek/gapura dipecah per blok 320 m dan disembunyikan > 450 m (±60 ribu segitiga lebih sedikit per frame). Uji: 0/48 percobaan lewat samping gapura berhasil, 50/50 jalan gapura tetap bisa dilalui, 0/11.777 pintu tertutup.

## 34. Lantai atas masuk main + perabot interior 3D (23 Nov 2026, integrator; desain Fable, kerja Opus)

Dua pekerjaan 18 Nov yang belum masuk main: `wip/world` (lantai atas) dan `wip/furn` (perabot 3D, belum pernah di-commit). Digabung di branch `integ/lantai-perabot` (worktree `.wt/integ`), diuji, lalu main di-fast-forward (lokal; push hanya atas izin Steven).

### 34.1 Dari `wip/world`
- Lift menara dengan panel pilih lantai (F di pintu lift; W/S/gulir pilih, F berangkat, Esc batal), lantai kantor dibangun malas per menara (satu templat `H.fl`, dipindah ke tinggi lantai yang dikunjungi), kaca fasad lantai itu terbuka.
- Ruko 2 lantai (tangga per pasangan unit), mal/aula lantai 2 beratrium (kios, kafe, taman, deret toko `shopunit`), rumah non-persegi 2 lantai.
- API collider: `liftSpot`, `addFurnLayer`, `addLayer`, `removeLayer` (slot dipakai ulang).

### 34.2 Perbaikan saat integrasi (wip/world bercabang sebelum bot & nav baru `cf68185`)
- **Dinding hilang saat naik lift:** `buildGen` memakai penampung verteks bersama dan mengosongkannya saat mulai; templat lantai yang dimulai di tengah cicilan gedung lain menghapus dindingnya → satu generator pada satu waktu (`interiors.update`).
- **Menara di atas podium** (#5442 di atas #966, lantai pertama 25,9 m): lantainya tidak pernah terbuka karena `towerAt` mengambil menara pertama yang tapaknya memuat titik → kini pilih menara yang punya lantai di ketinggian kaki (`towerAt(x, y, z)`).
- **Tangga atrium mal #5292** mendarat di dalam menara #5282 → pencarian atrium menguji pendaratan; perabot lantai 2 di tapak gedung lain dibuang.
- **nav.js:** celah sekat lantai atas memakai `H.up.parts` (ruko) bila ada.
- **bots.js:** barang di atas 0,5 m yang bukan lantai atas rumah/ruko/mal (`homeUp`) atau atap menara (`roofLift`) tidak diincar — lantai kantor & kanopi tidak terjangkau bot.
- **Cache nav tidak dibuang tiap ganti lantai:** slot poligon lapisan dinamis dipesan di muka (nav.js membangun ulang semua indeks bila `col.polys.length` berubah).
- **12 rumah non-persegi** yang lantai atasnya < 85 % terjangkau dari bordes tetap satu lantai (`NO_UP` di interiors.js, terikat `data/alsut-map.json` — audit ulang bila peta dibangun ulang).
- **Panel lift:** W/S yang masih ditahan dari berjalan ke pintu lift tidak menggulir pilihan (ulangan otomatis diabaikan sampai ditekan baru).

### 34.3 Perabot 3D (`web/map/furniture.js`)
- Aset: `tools/blender/furniture.py` → `web/game/assets/furniture/furniture.glb` + `furniture.json` (+ `detail_*.jpg`); kontrak di docstring skrip. Tiap model: LOD0 (≤ 9 m × zoom), LOD1 (≤ 30 m), kotak proksi (jauh + bayangan matahari); ukuran acuan = kotak tabrakan perabot; 9-slice & modul berulang (rak, gondola).
- API (interiors.js memanggil): `begin(H)` → `batch.add(f, Z)` per perabot saat interior dicicil → `commit(batch)` → `rec`; `show(rec, dy)` / `hide(rec)` / `drop(rec)`. Templat lantai kantor: commit sekali, `show(rec, z)` di `showFloor`, `hide` di `closeFloor`, `drop` saat templat dibuang. Konteks `'floor'` → model `'tower'`.
- Pengaman ukuran: model terbaik yang melar > ±1,65× pada sumbu tanpa 9-slice/modul → kotak lama.
- Pemanasan: `update()` jalan sejak menu; 3 frame pertama semua mesh tampil supaya program shader dikompilasi sebelum interior pertama (uji: 4 program perabot di menu, 0 baru saat masuk rumah). Shader gagal → `disabled`, perabot kotak.
- Gagal muat (GLB/JSON) → `furniture === null`, satu peringatan, perabot kotak (uji: 0 error).
- Grafik Hemat: `setDetail(true)` dari `applyStep` → LOD1 saja sampai 20 m.
- `stats`: models, recs, items, near, drawn, slots, free, disabled, ms.

### 34.4 Model
54 model / 31 jenis. Baru: `officedesk_std` (meja kantor + monitor + kursi beroda) dan `table_meeting` (meja rapat 2,4 m + 6 kursi), konteks `tower`, pratinjau `preview/furniture/office_lod*.png`. Build ulang juga membawa pengurangan LOD1 14 model yang sudah ada di skrip sejak 18 Nov. Tanpa model: `shopunit` (sengaja kotak). Resepsionis (`reception_std`) tidak pernah muncul: `free(p, 1,6)` di planTower selalu gagal melawan lingkaran pintu (juga di main lama).

### 34.5 Tabrakan
Collider dibuat dari definisi perabot yang sama (collide.js `furnAdd`, tidak berubah). Uji: instans = definisi ±1 cm / ±0,001 rad di rumah, ruko, mal, lobi & lantai kantor; kursi model baru ≤ 1 cm di luar kotak tabrakan. Peluru & pandangan bot tetap memakai kotak penuh (rak terbuka, kaca shower, tanaman tetap menahan walau model terlihat tembus).

### 34.6 Kinerja (headless M1 Pro, 1280×720, Ultra/Hemat; dibanding GLB diblokir = perabot kotak)
- CPU per frame sama atau lebih rendah (2,0–2,4 ms); draw call +0…+11; `stats.ms` pemilahan 0–0,3 ms.
- GPU per frame di adegan sungguhan: selisih Ultra +0,1…+0,6 ms, tetapi derau antar-muat ±0,5–1 ms (bot, partikel, GPU dipakai bersama) — tidak bisa dipastikan lebih halus.
- Batas atas biaya GPU perabot (render perabot saja tanpa tembok, timer GPU, Hemat 1024×576, sesudah `setDetail`): ruko 1,42 ms, mal 1,00, perumahan 0,75, lobi 0,45, kantor 0,33 (sebelum: 2,81 / 1,61 / 1,25 / 0,48 / 0,63). Sebagian besar dari model dekat (shading PBR rak berisi barang); kotak proksi 0,01–0,29 ms.

### 34.7 Uji
- `.wt/_tools/audit-lantai.mjs <web> [furniture.json]` (node, tanpa browser): jenis tanpa model, gedung lantai atas < 85 % terjangkau, titik barang lantai atas tak terjangkau nav. Hasil akhir: tanpa model `{shopunit: 159}`; `hall [25,0]`, `house(persegi) [1229,0]`, `house(non-persegi) [115,0]`, `shop [80,0]`; nav aula 21/522, rumah 380/20135, ruko 98/2284 (sebelum: 43, 612, 317).
- Headless (`.wt/_tools`, serve.mjs kini mengekspos `furniture`): lift ke lantai 2–30 & atap, 61 lantai × 32 menara (titik lift lapang, semua barang terjangkau), bot 5 menit (0 error, 0 bot mengincar barang kantor, bot diam setara main), perabot ikut lantai (slot tetap), jalan 600 m pergi-pulang (rekaman = gedung terbuka, slot turun ke 0), pemblokiran GLB/JSON.

### 34.8 Bangun ulang aset perabot
`taskpolicy -b nice -n 19 ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/furniture.py -t 2 -- --shots` (±30 dtk model + ±11 menit pratinjau Cycles). Iterasi: `-- --only a,b --no-export --shots --fast`. **Jangan** `--only` tanpa `--no-export` atau `--out <folder>`: GLB tertimpa set parsial.

### 34.9 Belum
- Bot tidak bisa naik lift ke lantai kantor (pemain di sana tidak terjangkau bot).
- `shopunit` belum punya model etalase; resepsionis lobi tidak pernah ditempatkan.
- Daftar `NO_UP` → ganti dengan cek keterjangkauan saat perencanaan.
- Bayangan matahari perabot baru muncul pada penyegaran bayangan berikutnya.
- Kanopi/teras statis ±1,06 juta verteks selalu digambar (sudah ada di main sebelumnya).

## 35. Sesi 24 Nov 2026: keluhan besar Steven — yang sudah masuk, yang TERJEDA, cara melanjutkan

Pola kerja sesi ini (permintaan Steven): **rancangan oleh Fable, eksekusi oleh Opus**, tiap alur di worktree `.wt/<nama>` (branch `wip/<nama>`), digabung ke `main` per milestone setelah uji asap. Sesi dihentikan Steven karena jatah pemakaian (dia butuh untuk kerja kantor), jadi beberapa alur berhenti di tengah. **`main` lokal = `4ea1d9d` + commit HANDOFF ini, ±47 commit di depan `origin/main`, BELUM di-push** (push hanya atas izin Steven; Jason auto-pull dari origin).

Rancangan lengkap tiap alur (audit, angka, kriteria lulus, milestone) ada di `docs/rancangan/2026-11-24/*.md`. Baca berkas alurnya sebelum melanjutkan; bagian ini hanya ringkasan + status.

### 35.1 Sudah di main (semua lolos uji asap: muat, pertandingan, zona, terjun, mendarat, 0 error konsol)
- **Air kanal** (`79ed477`, `world.js riverGeo/waterize`): pita menerus (miter + sambungan bundar) menggantikan satu quad per segmen yang tumpang 12 % ("zebra cross"); buih pita tipis berbasis meter (atribut `hw`); `wnoise` kuintik + domain diputar (kilau tidak kotak).
- **Zona** (`60cc392`, `zone.js`): `PHASES[].speed` = batas laju SISI JAUH dinding 4,6→1,8 m/dtk (selalu < lari cepat 6,6); `dur = max(22, (susut + geser pusat)/speed)`; `maxDur` dihapus; geser pusat ≤ 0,6× susut; `R1 = 1400`; wait 90/60/45/40/35/30/25/20; dps 0,6→14; bot memakai `zone.radialSpeed`. Akibat: pertandingan 18–24,5 menit (dulu 14).
- **Spanduk kill dihapus** (`d21993a`); kill feed & `killSting` tetap. Gantinya sementara: **animasi kill di senjata** (`13f92c9`, `25f5d12`): `killPulse(n, knock)`, uniform `uSfK` (khusus view-model), blok kill di akhir `sfGun`, selubung `shellMat` kill ke-3+, selebrasi pegas, tombol toko "Animasi kill". **Steven MENOLAK versi ini** ("cuma transisi cahaya dari kiri ke kanan") → digantikan Skin v2 (35.2 no. 1).
- **Perban orang pertama v3** (`385cc07`, bagian obat `weapons.js`): kasa pita heliks menempel profil lengan (`armProfile`, `bandPt`, `bandGrow`), tangan kanan mengorbit tanpa berbalik, lengan kiri = `fp_hand_r` dicerminkan; P3K/minuman: kunci arah tangan diperbaiki.
- **Tabrakan** (`9b99fc6`, `collide.js`): `step` bersub-langkah ≤ 0,15 m + `crossed`/`guard`; tangga tidak melempar agen; dorongan kendaraan/`fitProne`/mayat bot tidak menyeberang dinding.
- **Pintu rumah buka-tutup** (`2fff27f`): keadaan di `col.doors` (9.384 pintu; terbuka = `h −∞`), `doorNear/doorAhead/setDoor/resetDoors/doorStamp`; F buka/tutup (barang jarahan di depan pintu diambil dulu); bot membuka otomatis; daun pintu ber-instancing di `interiors.js`; fasad jauh lewat `W.setDoorState`. Semua pintu tertutup di awal pertandingan. Ruko/mal/lobi tanpa daun pintu (rongga gelap).
- **Atap** (`5410267`, `world.js roofShape`, hanya mode game): semua rumah tapak miring (perisai/limas/mansard); bukaan ruko/aula < 1,2 m dihapus.
- **Lantai** (`34a5b48`, `6243f05`, `0d9e0bd`): `fitHouseHeights` (rumah tanpa lantai atas 3,6–4,3 m; jenis 0 ≥ 11 m → menara ber-lift), baris jendela mengikuti plafon, tangga 4,4/3,6/3,0 m + `upperReach`, **`NO_UP` dihapus**, `placeDoor` menguji lorong 1,5 m. Rumah 2 lantai 1.344 → 2.159.
- **Terjun M1–M4** (`68a96c5`, `3663b8a`, `ac7d340`, `908b290`): `map/rigair.js` (pose udara berpegas, kait di `Rig.pose`), `game/chutefx.js` (kanopi), masukan pose `airT/chuteT/landT/landKind/airFwd/airSide/airDive/airTurn/airSpd/airGnd/lookYaw/lookPitch`; setelan `AIRCAM` dan `LAND` di `player.js`.
- **Pohon** (`09dfe7c`, `trees.js cleanTrees`): zona bebas fasad (Z1) + jarak dinding (Z2); 518 digeser, 617 dibuang (8.445 → 7.838).
- **Pegangan orang ketiga/lobi** (`d53b6ee`): `weapons.js worldGrips()` membaca node `<jenis>_guard`/`<jenis>_mag`; `rig.js setGripPoints` + orientasi tangan; `gunKind` di lobi. Jarak telapak→guard 8–20 cm → 0.
- **Optik + tampilan bidik M1** (`7056685`): `weapons.glb` v6 ber-Draco (1,9 MB; dekoder dari jsdelivr, gagal → model prosedural + overlay lama), node `opt_rds/holo/s2/s4/s8`, `mountOptic`, lensa ber-retikel (shader), mask di `postfx.js` (`uScope`), `weapons.json` v6, `gunPoints/weaponMeta/opticMeta/assembleGun`. Garuda bawaan titik merah, Petir holo.

### 35.2 BELUM SELESAI — lanjutkan dari sini (urut prioritas Steven)

> **STATUS TERBARU (24 Nov malam, sesi Jason) — tabel di bawah ini sudah USANG, dipertahankan sebagai catatan asal.**
> Branch WIP lama di tabel (`4e1db01`, `5cc34ee`, `7e55e92`, `2b58e1d`, `cffc563`) tidak pernah ada di origin; semua alur
> **dibangun ulang dari main** dan sudah digabung + di-push ke `origin/main` (`b3f2118` + commit pembaruan HANDOFF ini).
>
> | # | Alur | Sudah di main | Bagian | Sisa |
> |---|---|---|---|---|
> | 1 | Skin v2 | M1 etalase Merak | §36 | **Gerbang visual Steven**, lalu M2 (konversi 11 skin lama), M3–M5 (skin & kostum baru) |
> | 2 | Senjata | M2: tampilan bidik + Garuda, P9, Rajawali | §39 | **Gerbang visual Steven**, lalu M3 (8 senjata sisanya), M4 (LOD1/model dunia), M5 |
> | 3 | Kostum | M2: fondasi + `char_malam`, `char_batik`, `char_garuda` | §41 | **Gerbang visual Steven**, lalu M3 (pegas/kain), M4–M6 |
> | 4 | Tata letak | M2 (perapi jalan + gedung) dan M3 (tembok keliling) | §40, §42 | M4 (tanam ulang pohon), M5 (termasuk tembok apartemen) — tidak menunggu gerbang visual |
> | 5 | Terjun | M5 | §37 | Selesai (kekurangan kecil di §37) |
> | 6 | Bangunan | M5 | §38 | Selesai; pose `TUCK` perlu dilihat Steven |
>
> Skin, Senjata, dan Kostum masuk main **sebelum** gerbang visualnya disetujui (atas permintaan Jason), jadi tampilannya masih
> bisa berubah menurut catatan Steven. Worktree `.wt/<alur>` dan branch `wip/<alur>` yang sekarang ada hanya di mesin Jason
> (kecuali `wip/skinv2` yang juga di origin) dan semuanya sudah sama dengan / tertinggal dari main: mulai alur baru dari main.
> Alat uji lama `.wt/_tools/` versi Steven tidak ada; penggantinya (server uji + pengendali CDP berframe manual, alat audit
> tata letak) ada di luar repo di mesin Jason dan bisa hilang.
Semua kerja setengah jalan sudah di-commit sebagai **WIP di branch-nya (belum diuji, jangan digabung apa adanya)**. Langkah pertama tiap alur: `git merge main` di worktree-nya.

| # | Alur | Worktree · branch · WIP | Rancangan | Keadaan | Langkah berikut |
|---|---|---|---|---|---|
| 1 | **Skin v2: efek berbentuk per skin + skin baru** | `.wt/skinv2` · `wip/skinv2` · `4e1db01` | `skinv2.md` | Baru mulai: kerangka `web/game/shapefx.js` + `fxshapes.js` | M1 etalase **Merak** dengan URUTAN: (a) kill di senjata = kipas bulu merak di atas receiver + finisher "Dadak Merak" di korban, (b) tembak berbulu merak, (c) isi ulang, cabut/periksa, (d) toko "Lihat efek". **Gerbang visual Steven** sebelum tema lain. Lalu M2 konversi 11 skin beranimasi lama, M3–M5 = 16 skin senjata + 13 kostum Nusantara baru (koleksi satwa/bahari/kriya). |
| 2 | **Senjata M2** | `.wt/senjata` · `wip/senjata` · `5cc34ee` | `senjata.md` | `gunkit.py`, `weapons.py`, GLB/JSON, `weapons.js` berubah setengah jalan | Poles tampilan bidik (2× = donat hitam tebal, lubang pandang kekecilan; 4× = garis lingkar putih + retikel terlalu kecil; sekeliling lensa hitam rata) → tiga senjata perintis (Garuda, P9, Rajawali) → **gerbang visual Steven** → M3 delapan sisanya → M4 model dunia LOD1/LOD2 (yang di tangan karakter masih kotak) → M5 (goyang napas, dll.). `setGrip` di rancangan senjata TIDAK dikerjakan (sudah milik kostum M1). |
| 3 | **Kostum M2** | `.wt/kostum` · `wip/kostum` · `7e55e92` | `kostum.md` | Refaktor `characters3.py` + `costumes.py`, `costume_parts.py`, `costume_tex.py`, `costumes/` setengah jalan | Fondasi pipeline + runtime (`loadCostume`, `setCostume`, `equipCostume`) + tiga perintis: `char_malam`, `char_batik`, `char_garuda` (sayap statis dulu) → **gerbang visual Steven** → M3 pegas + kostum biasa/langka → M4 emisi + epik + lengan orang pertama → M5 legendaris + rekan regu → M6 toko. Paket aset: `~/.cache/senara-digital-twin` (+ unduh paket MakeHuman CC0, tautan dibaca dari halaman paket). |
| 4 | **Tata letak M2–M5** | `.wt/tataletak` · `wip/tataletak` · `2b58e1d` | `tataletak.md` | `tools/tidy_layout.mjs` + data `web/data/*` dibangun ulang, **BELUM diaudit** | M2: jalankan `audit-tataletak.mjs` (A5–A7), `audit-lantai.mjs`, `audit-bangunan.mjs`, uji muat (gedung ber-flag 8 = cincin kosong: cek `world.js`, `mapview.js`, `alsut3d.js`). M3: 20 kompleks, tembok keliling ±25 km, 140 gerbang jalan + pintu pejalan kaki tiap 160 m, K1 di `bots.js buildGraph`. M4 tanam ulang pohon. Keputusan: gapura "Sutera Sitara" DIPERTAHANKAN sebagai hiasan; gapura Asri dipindah; Gramercy + 7 gapura cluster kosong dihapus. Poligon tembok tidak boleh ber-`door`/`stair`/`floor`. |
| 5 | Terjun M5 | `.wt/terjun` · `wip/terjun` · `cffc563` (WIP) | `terjun.md` | `game/airfx.js` (garis angin, awan), goyangan formasi; belum diuji | Opsional. |
| 6 | Bangunan M5 | `.wt/bangunan` (bersih) | `bangunan.md` | Ditunda | Pintu kamar mandi, `p.tuck` (laras tidak menembus dinding), bot menutup pintu lebih cerdas. |

### 35.3 Kekurangan yang diketahui di main

> **STATUS TERBARU (24 Nov malam):** daftar di bawah ditulis sebelum §36–§42. Yang SUDAH BERES atau berubah:
> - Animasi kill = sapuan cahaya; pola Merak kotak-kotak → diganti kipas bulu + finisher dan riak toska-emas (§36). Selubung kill
>   ke-3+ dan biaya GPU: masih belum diukur.
> - Tampilan bidik 2×/4× kasar → dipoles (§39). Model senjata: Garuda, P9, Rajawali dibangun ulang; delapan lainnya dan model
>   dunia LOD kotak masih seperti semula.
> - Terjun: mendarat di dek rendah, mode Hemat, dan payung saat "Ikut rekan" sudah diuji; awal guling diperhalus (§37). Karakter
>   perempuan dari dekat dan atap menara tinggi: belum.
> - Tata letak: ±760 gedung menimpa aspal → 0; tembok keliling sudah ada untuk 12 kompleks (§40, §42). Halaman depan gundul
>   (tanam ulang pohon, M4): masih.
> - Tangan orang pertama tanpa tulang jari, catatan bangunan per gedung (#5527, #1888, #2466), lama pertandingan, dan kematian
>   bot karena zona: TIDAK disentuh sesi ini, masih berlaku.
> Kekurangan baru dari pekerjaan sesi ini ada di butir "Kekurangan" tiap bagian §36–§42.
- Animasi kill di senjata = sapuan cahaya saja (ditolak Steven); pola Merak kotak-kotak; selubung kill ke-3+ nyaris tak terlihat; biaya GPU belum diukur.
- Tampilan bidik 2×/4× kasar (lihat no. 2); bidik per scope baru diuji di branch, belum diuji ulang di main gabungan.
- Model senjata belum berubah (hanya optik); model dunia di tangan karakter masih LOD kotak.
- Tangan orang pertama masih potongan kaku tanpa tulang jari (perban, isi ulang).
- Terjun: belum diuji mendarat di atap, mode Hemat, karakter perempuan, payung saat "Ikut rekan"; awal guling masih menyentak.
- Bangunan: 1 ruko/aula kehilangan semua bukaan; #5527 puncak tangga tertutup kanopi ruko #5530; lantai atas #1888 74 % dan #2466 80 % terjangkau; titik barang lantai atas tak terjangkau nav 2,4 %; regu bot kadang berkerumun di satu pintu; atap baru tidak berlaku di peta twin; waktu rencana rumah ±1,7 dtk (dulu ±1,0).
- Tata letak: tembok cluster masih tembok sayap lama (belum ada tembok keliling); ±760 gedung masih menimpa aspal; halaman depan deret rumah agak gundul sampai tanam ulang (M4).
- Pertandingan lebih lama (median 21 menit); bila kelamaan, turunkan `wait` di `PHASES` (jaminan terkejar tetap aman sampai wait fase 0 = 60).
- Kematian bot karena zona baru diukur dengan model titik di node, bukan pertandingan penuh.

### 35.4 Cara kerja, alat, aturan
- **Worktree**: `.wt/<nama>` (di `.git/info/exclude`). Server game Steven: `cd bff && ./bin/alsut3d-bff` → http://127.0.0.1:8765 menyajikan `web/` checkout main langsung → **jangan mengedit checkout main selain lewat merge yang sudah diuji**; tangkapan layar/keluaran alat selalu path absolut di luar repo.
- **Alat uji** `.wt/_tools/` (lokal, tidak di git; lihat `README.md` di sana): `serve.mjs` + `cdpd.mjs` + `cdp` + `setup.js` (`__T`), `audit-lantai.mjs`, `audit-bangunan.mjs <web> <three.module.js>`, `audit-tataletak.mjs <web> [trees.js lama]`, `lintas.js` (lintasan tembus + bot diam). Port per agen 883x/933x/943x; matikan proses uji setelah selesai.
- **Integrasi** `.wt/_tools/integ/`: `gabung.sh <commit> <cap> "<judul>"` = merge `--no-ff` ke main, selesaikan konflik `?v=` di import map (`versi.py`), cap semua `?v=` dengan satu cap baru (`cap.sh`, mis. `202611241745`), `node --check` berkas JS yang berubah, commit, lalu `asap.sh` (uji asap headless: menu → pertandingan → zona dimajukan → terjun → payung → mendarat → jalan; cek `__LOGS`). **Eksekutor tidak mengubah `?v=`**; integrator yang mencap. `ambil_laporan.py` = ambil laporan akhir agen dari transkrip JSONL.
- **Aturan Steven**: tidak ada flag/env khusus tes di kode; koin tak terbatas hanya lewat snippet console (`localStorage royale.profile.v1` → `coins`), bukan kode; ID & harga skin tetap; desain orisinal (tanpa IP/merek); "jangan terlalu terpaku pada map" = boleh menyimpang dari OSM demi tata letak masuk akal (indeks gedung/jalan tetap stabil); push hanya atas izin; jatah pemakaian terbatas → sedikit agen sekaligus, commit kecil per bagian yang lolos uji, berhenti segera bila diminta.
- **Gerbang visual**: untuk karya yang dinilai dari tampilan (senjata, kostum, efek skin), tunjukkan lembar kontak ke Steven sebelum produksi massal; nilai sendiri gambarnya dengan jujur lebih dulu.

## 36. Sesi 24 Nov (lanjutan) — Skin v2 M1 "etalase Merak" dibangun ulang dari main — SUDAH di main, MENUNGGU gerbang visual

Branch `wip/skinv2` yang disebut §35 tidak ada di origin (hanya `main` yang ter-push), jadi alur ini **dibangun ulang dari main** di
worktree `.wt/skinv2` (branch `wip/skinv2`), mengikuti `docs/rancangan/2026-11-24/skinv2.md`.

- **Modul baru** (`web/game/`): `fxshapes.js` (atlas SDF 1024² + palet: bulu merak, bulu kecil, mata merak, serat, cincin, garis,
  kilau, pilar — dibangun saat muat, ±230 ms), `shapefx.js` (lapisan kartu ber-instance, 18 preset gerak di vertex shader, dua lapis:
  view-model & dunia), `fxlib.js` (resep per tema; baru `merak`; tingkat Penuh/Ringkas/Mati di `royale.skinfx`).
- **Yang sudah jalan untuk `gun_reog`**: (a) kill → kipas bulu merak di atas senjata + finisher "Dadak Merak" di korban (membesar
  mengikuti beruntun 1/3/5), (b) bulu melesat dari moncong saat menembak + selongsong toska, (c) isi ulang (bulu rontok saat magasin
  lepas, kipas kecil saat masuk), (d) toko: baris "Lihat efek" (Tembak / Isi ulang / Kill / Finisher, dengan manekin
  korban) + pengaturan "Efek skin".
- **Kait di modul lama**: `weapons.js` (`anchors()`, `SKIN.hook`/`brass`), `skins.js` (`th.fx`, chip fitur), `player.js`, `killfx.js`,
  `audio.js` (`finisher`, cue `out/in/bolt`), `main.js`, `lobby.js`/`lobby.css`, `skinfx.js` (denyut kill Merak: petak UV warna acak
  — sumber tampilan "kotak-kotak" — diganti riak toska-emas halus).
- **Diuji** (headless, waktu virtual, tingkat Ultra): lobi keempat peragaan + pertandingan orang pertama (tembak, bidik, isi
  ulang, kill 1/3/5), 0 galat konsol. Isi ulang, bidik, dan kill tunggal dipotret SEBELUM penyetelan terakhir (ukuran bulu tembak,
  denyut kill) dan belum diulang. **Belum terverifikasi**: efek cabut & periksa (resepnya ada di `fxlib.js`, tapi cabut tidak
  memunculkan kartu di uji dan periksa belum pernah dijalankan). **Belum diuji**: tingkat Hemat/ponsel, anggaran GPU, orang ketiga,
  kendaraan, pemain lain.
- **Alat uji** ada di luar repo (scratchpad sesi, tidak ikut commit): server statis yang menyuntik `window.__T` ke `main.js` yang
  disajikan + pengendali CDP dengan frame manual 60 Hz. Kalau hilang, buat ulang; jangan masukkan flag uji ke kode.
- **Kekurangan yang diketahui**: bulu tembak masih kecil di orang pertama dan nyaris tak terlihat di peragaan "Tembak" lobi; kipas di
  senjata menutup sebagian kanan layar saat beruntun 5; belum ada jejak peluru berbentuk, reaksi kostum `char_warok`, kartu "Set Merak";
  kumpulan Points lama di `killfx.js` masih ada.
- **Sudah di main** (atas permintaan Jason, 24 Nov): digabung maju-cepat ke `main` dengan `?v=202611241732` di `royale.html`,
  SEBELUM gerbang visual disetujui Steven. Jadi tampilan Merak di main masih bisa berubah menurut catatan Steven; tema lain tetap
  JANGAN dikerjakan sebelum lembar kontak Merak disetujui.

## 37. Terjun M5 (24 Nov, dibangun ulang dari main; WIP lama `cffc563` tidak ada di origin) — SUDAH di main, `?v=202611241757`

- **Modul baru `web/game/airfx.js`** (dipanggil `main.js` setelah `player.update`; laju dari perpindahan posisi pemain, tanpa alokasi
  per frame): 64 garis angin berupa pita selebar ±2 px di kotak 18×14×24 m depan kamera (nol saat payung) dan 10 sprite awan (5 di
  Hemat) 60–140 m di ketinggian 180–520 m di bawah pemain, memudar 4–30 m dari kamera.
- **Menyimpang dari rancangan**: pita menggantikan `LineSegments` (garis 1 px hilang di skala render rendah); opasitas dinaikkan
  (garis 0,3 → 0,5, awan 0,22 → 0,5) karena angka rancangan tidak terlihat.
- **Goyangan formasi** `(0,5·sin 0,7t; 0,3·sin 0,9t; 0,4·sin 0,5t)` m berfase per slot: rekan bot (`bots.js allyAir`) dan pemain di
  "Ikut rekan" (`player.js`, plus `airSide` dari laju menyamping offset).
- **Perbaikan dari §35.3**: awal guling (`rigair.js poseLand`: ringkuk 0,32 dtk, salto mulai 0,1 dtk → laju paha 12,9 → 8,1 rad/dtk,
  loncatan antar frame 3,66 → 1,51); kamera baru mendarat yang menembus dinding rumah (`player.js placeCamera`).
- **Diuji** (headless, frame manual 60 Hz, 0 galat konsol): alur penuh di Ultra dan Hemat, "Ikut rekan" sampai mendarat, mendarat di
  dek 4,1 m, guling dengan pengukuran laju sudut. **Belum diuji**: perbaikan kamera di dekat dinding, varian perempuan dari dekat,
  atap menara tinggi, goyangan formasi secara terukur, alokasi/CPU, ponsel. Tidak ada uji ulang setelah cap `?v=`.
- **Kekurangan**: awan dari jauh masih tampak seperti noda putih kecil; garis angin ikut berputar dengan kamera; loncatan betis
  ±5 rad/dtk di akhir guling saat menahan W; kanopi kempis menutupi kamera saat guling.

## 38. Bangunan M5 (24 Nov) — SUDAH di main, `?v=202611241806`; pose `TUCK` belum lewat gerbang visual

- **Pintu kamar mandi** (`interiors.js planBath`, `collide.js addBathDoor`): 4.550 pintu (3.231 lantai dasar + 1.319 lantai atas)
  di `col.doors` dengan `bath: 1`, `k: −1` (tanpa texel fasad), awal TERBUKA (`open0`, dihormati `resetDoors`; pintu rumah tetap
  tertutup), hanya berayun ke luar kamar mandi, daun PVC abu di InstancedMesh pintu rumah. `doorClear` kini seperempat cakram ayun
  (berlaku juga untuk pintu rumah satu daun).
- **`p.tuck`** (murni visual, peluru tetap dari kamera): sinar pendek searah hadap → 0..1 (mulai 0,95 m laras panjang / 0,7 m
  pistol, penuh di 0,55 m); `rig.js` konstanta `TUCK` (siap-tinggi, tangan lewat IK), `bots.js draw()` (bot bersenjata < 60 m),
  `player.js st.tuck` → `pose.tuck` + `vm.update({ tuck })`; 0 saat bidik/menembak.
- **Bot menutup pintu** (`bots.js doorThink/doorBusy/shutChance`): jangkauan 3 m (dulu 6 m); tidak menutup bila rekan di seberang /
  menuju celah, jalurnya lewat lagi, pemimpin di seberang, atau sedang menembak lewat celah; menutup untuk memutus garis tembak,
  saat bertahan, dan setelah lewat dengan peluang menurut keadaan. Simulasi 99 bot Sulit 300 dtk (2×, dibanding main): tutup saat
  rekan di seberang 28–29 → 0 (perkiraan: penutup = agen terdekat), buka ulang ≤ 3 dtk 29–34 → 5–7, ganti < 1,2 dtk 64–74 → 3–4.
- **Diuji**: uji asap (lobi → pertandingan → terjun → mendarat → F buka pintu → masuk → kamar mandi) 0 galat, diulang setelah
  digabung dengan Terjun M5; audit 4.550 pintu (terbuka tembus, tertutup menahan); tuck orang pertama/ketiga/bot. Di uji asap pemain
  DIPINDAHKAN ke depan pintu setelah mendarat, bukan berjalan ke sana. Tidak ada uji ulang setelah cap `?v=`.
- **Belum diuji**: Hemat/ponsel, kinerja, `audit-lantai`/`audit-bangunan`/`lintas.js` (alatnya tidak ada di mesin ini), tuck saat
  jongkok/tiarap/kendaraan, pertandingan penuh.
- **Kekurangan**: pose `TUCK` orang ketiga/bot = senapan tegak di depan wajah (mirip hormat senjata; pertimbangkan pose turun,
  cukup ubah konstanta); tuck penuh orang pertama: laras melintas dekat bidikan tengah; menutup pintu kamar mandi dari luar ditolak
  bila berdiri di busur ayun dekat engsel; daun terbuka tanpa collider (2 pintu di rumah #463 menimpa benda padat); bot tidak
  berjalan ke pintu untuk menutup; sisa 5–7 buka-ulang cepat per 5 menit.

## 39. Senjata M2 (24 Nov, dibangun ulang dari main) — SUDAH di main, `?v=202611242041`; BELUM lewat gerbang visual Steven

- **Tampilan bidik**: lensa diskalakan saat ADS menjadi cakram pandang (`viewScale` di `weapons.js`; `fill`/`relief` per optik di
  `weapons.json`: s2 0,68/0,06, s4 0,94/0,06, s8 0,96/0,068) → donat hitam 2× hilang. Shader lensa melukis bibir eyecup sendiri,
  varian `LENS_DEPTH` (mesh `optic_eye_depth`) supaya kabut/rays post tidak bocor; rumah optik disembunyikan saat `ads > 0,85` pada
  optik pembesar. Retikel 2×/4× diskalakan `LENS_RS` (2,6/2,4) — **bukan mil sejati lagi**. `postfx.js`: tepi `uScope` 0,972–1,0.
- **Tiga perintis** (Garuda, P9, Rajawali) dibangun ulang di `tools/blender/weapons.py` (potongan boolean nyata; `gunkit.cut` kini
  satu modifier per pemotong, berurutan). Tris LOD0: pistol 7.174, ar 31.972, sniper 24.626; GLB 1,98 MB (Draco). P9 mengekspor
  node `pistol_slide` (pemisahan runtime lama tetap sebagai fallback) → **GLB dan JS harus selalu dirilis bersama**. Shader VM:
  kind 3 stipple, kind 7 rusuk karet, kotoran dari bake `vwx`; kunci cache `vm6`. Delapan senjata lain: geometri tetap, hanya
  di-bake ulang (tampilan sedikit berubah).
- **Diuji** (headless): ADS 2×/4×/8× diam & bergerak; tiga perintis orang pertama (pinggul, inspeksi, ADS, isi ulang, tembak); skin
  `gun_reog`; setelah digabung dengan Terjun M5 + Bangunan M5: pertandingan cabut/tembak/bidik/isi ulang/kill ×3 dengan efek Merak,
  0 galat konsol. Tidak ada uji ulang setelah cap `?v=`.
- **Belum diuji**: waktu GPU/FPS nyata, 21 skin lain, orang ketiga/loot/lobi/ikon HUD dengan GLB baru, fallback bila GLB gagal,
  ponsel.
- **Kekurangan (untuk gerbang visual)**: ADS besi Rajawali — blok popor/receiver menutup tengah-bawah layar; grip & pelindung picu
  P9 masih kasar; popor Garuda pelat sederhana; bayangan eye-box 4× saat bergerak mungkin terlalu kuat; retikel 2× pucat di latar
  terang; retikel 8× tidak diperbesar. M3 (delapan senjata sisanya), M4 (LOD1/model dunia), M5, `setGrip`: belum dimulai.

## 40. Tata letak M2 (24 Nov, alat dibangun ulang dari rancangan) — SUDAH di main, `?v=202611242043`; M3 tembok keliling masih DRAF tidak aktif

- **Alat**: `tools/tidy_layout.mjs` + `tools/tidy/{geom,layout,derive,walls}.mjs` (node tanpa dependensi). Masukan =
  `data/build/alsut-*.raw.json` (salinan data SEBELUM dirapikan). Bangun ulang M2 (hasil identik byte dengan `web/data`):
  `node tools/tidy_layout.mjs data/build/alsut-map.raw.json web/data/alsut-map.json --props data/build/alsut-props.raw.json web/data/alsut-props.json --context data/build/alsut-context.raw.json web/data/alsut-context.json`
- **T1 jalan**: 239 jalan disempitkan ke lorong antar-fasad; `roads.s` = trotoar per jalan (dipakai `world.js`); 16 jalan servis
  dipotong (1.824 → 1.825 jalan). **T2 gedung**: 788 pelanggar → 74 digeser (flag 32), 708 dipangkas (flag 16), 6 dibuang (flag 8,
  cincin kosong, indeks tetap: #28, #3028, #3797, #3804, #3806, #5657).
- **Audit** (sebelum → sesudah): gedung di aspal non-servis 701 → 0; pintu depan di aspal 663 → 0; gedung context di air 3 → 0;
  5.014 gedung tak berflag identik dengan raw; geser terjauh 3,61 m. `planHomes`: tidak ada rumah kehilangan rencana/pintu; rumah
  2 lantai 2.264 → 2.262; pintu tertutup tetangga 119 → 119. Audit bangunan DIULANG setelah digabung dengan Bangunan M5: tanpa
  rencana 0, lantai atas tanpa tangga 0, gedung berflag yang kehilangan rencana/pintu 0.
- **Diuji**: uji asap setelah digabung dengan Skin/Terjun/Bangunan/Senjata (muat → pertandingan → terjun → payung → mendarat →
  berjalan, 0 galat konsol, `envProps.stats.dropped` 6); halaman twin memuat. Tidak ada uji ulang setelah cap `?v=`.
- **Belum diuji**: tampilan 3D deret rumah terpangkas dari dekat (baru denah 2D), kinerja, bot & kendaraan di jalan yang
  disempitkan, pertandingan penuh.
- **Kekurangan**: ekstrak OSM tidak ada di mesin ini → props/context dirapikan lewat pasca-proses (`derive.mjs`),
  `alsut-grass.json` BELUM dibangun ulang (topeng ilalang masih tapak lama), gedung context belum dipangkas/jalannya belum
  disempitkan, `build_props.py` belum punya penjaga cincin kosong.
- **(USANG — M3 sudah lolos audit dan aktif di main, lihat §42; butir ini keadaan saat §40 ditulis.)**
- **M3 (tembok keliling) — DRAF, tidak aktif**: `tools/tidy/walls.mjs`, `web/map/walls.js`, dan cabang gerbang/tembok di
  `envprops.js` sudah ada tetapi data tembok TIDAK ditulis ke `web/data` karena audit belum lolos: 11 kompleks (sasaran 20),
  20,4 km, 82 gerbang jalan + 19 servis + 123 pintu pejalan; A8 43 bocor dari 78.588 uji, A9 89 titik, A11 2, A12 5, A13 7,
  A14 1, ±90 m tembok di aspal, 14 titik di dalam gedung. Lanjutkan dengan `--stages roads,buildings,walls` ke folder keluaran
  sampai audit tembok bersih, baru K1 di `bots.js buildGraph`, uji browser, lalu M4 (tanam ulang pohon) dan M5.
- Alat audit/uji ada di luar repo (`_sr_out/tataletak/audit/` di mesin Jason) dan bisa hilang; bangun ulang dari rancangan bila perlu.

## 41. Kostum M2 (24 Nov, dibangun ulang dari main) — SUDAH di main, `?v=202611242111`; BELUM lewat gerbang visual Steven

- **Pipeline** `tools/blender/costumes.py` (+ `costume_parts.py` bagian prosedural, `costume_tex.py` bahan per-texel) →
  `web/game/assets/costumes/<id>/{costume.json, <var>.glb (LOD0+LOD1, 17 tulang), <var>_albedo/normal/orm.webp, thumb.webp}` +
  `CREDITS.md` (11 MB total). ±50 dtk per kostum × varian. Aset dasar MakeHuman CC0 diunduh ke `~/.cache/senara-digital-twin`
  (data MPFB, aset sistem, paket `suits02`, `masks01`, `shoes01`, `pants01`); `characters3.py` hanya dirapikan supaya bisa diimpor.
- **Runtime**: `rig.js` `loadCostume(id, variant)` (cache, batas 8 dtk, gagal → satu `console.warn` + tampilan lama),
  `costumeProbe`, `C.setCostume` (mesh tubuh ditukar di tempat, material `cos3`); `skins.js` `equipCostume` dipanggil dari
  `applyEquipped` dan `lobby.js`; skin bertanda `costume: true` (ID & harga tetap); thumb toko pra-render.
- **Tiga perintis** (m1/f1/m2/f2 dibangun): `char_malam` (13,4k tris), `char_batik` (16,4k), `char_garuda` (17,4k, sayap statis).
  Motif dan bagian khas buatan sendiri; tanpa simbol agama/Garuda Pancasila/bendera/merek.
- **Menyimpang dari rancangan**: kulit + kostum satu mesh/atlas per varian (bukan node kaku terpisah); belum ada pegas, emisi,
  lengan orang pertama, kostum untuk bot/rekan, atau LOD menurut jarak (LOD1 hanya mesh bayangan).
- **Diuji**: panggung m1/f1 (diam, senapan, lari, jongkok); cadangan saat aset diblokir; setelah digabung dengan main terbaru:
  pertandingan orang ketiga Batik & Malam (Garuda sebelum digabung) dan lobi, kostum terpasang, tanpa pesan konsol. Tidak ada uji
  ulang setelah cap `?v=`.
- **Belum diuji**: m2/f2 di peramban, toko/koleksi/ganti skin cepat, tiarap/renang/terjun/kendaraan/tumbang, kinerja.
- **Kekurangan (untuk gerbang visual)**: jarik Batik meregang seperti tenda saat lari (paling mencolok; menunggu pegas/kain M3);
  dodot Garuda meregang dan lutut menembus saat jongkok; sayap Garuda tipis dari samping; Operator Malam terlalu seragam gelap;
  motif parang kasar dari dekat. M3–M6 belum dimulai.

## 42. Tata letak M3 — tembok keliling (24 Nov) — SUDAH di main, `?v=202611242231`; M4/M5 belum (menggantikan status "DRAF" di §40)

- **Hasil**: `tools/tidy_layout.mjs --stages roads,buildings,walls` menghasilkan `D.walls` + `props.walls`/`props.gates`: 12 kompleks,
  20,1 km tembok; gerbang jalan 93 (k0 20, k1 55 [29 polos], k2 18 [1 polos]) + 124 pintu pejalan kaki (k3). Bangun ulang ±95 dtk:
  `node tools/tidy_layout.mjs data/build/alsut-map.raw.json web/data/alsut-map.json --stages roads,buildings,walls --props data/build/alsut-props.raw.json web/data/alsut-props.json --context data/build/alsut-context.raw.json web/data/alsut-context.json`
- **Di bawah sasaran rancangan** (20 kompleks, ±25 km, 140 gerbang): klaster berdempetan menyatu jadi satu kompleks (memisahnya =
  tembok ganda berdempetan); apartemen belum ditembok (M5); sisi batas peta dan sisi air tidak ditembok (keliling total 32,2 km).
  9 rumah dikeluarkan dari kompleks (1582–1589, 1721); T3b menggeser 2 rumah (1678, 1734) dan membuang 4 (flag 8: 1680, 5440,
  1672, 1679) dekat ruko 1669 → total flag 8 kini 10, flag 32 78.
- **Generator** `tools/tidy/walls.mjs`: raster 1 m, kontur marching squares, penampang jalan disnap utuh dalam/luar, zona bebas
  pintu rumah lewat `tools/tidy/doors.mjs` (memuat `interiors.js`/`collide.js` asli dengan stub `three`) → **mengubah
  `interiors.js`/`collide.js` = bangun ulang + audit ulang tembok**.
- **Audit tembok** (draf → akhir): A8 tembus 43 → 0 dari 79.719; A9 89 → 0; A10 gagal 1 → 0 (206 lolos); A11 2 → 0; A12 5 → 0
  (terdekat 1,72 m); A13 7 → 0; A14 1 → 0 dari 187; tembok di aspal 183 → 0; di gedung 14 → 0. Audit M2 diulang, tetap lolos.
  **Alat audit diubah** (bukan kriterianya): A8 kini menghitung langkah `col.step` yang memotong sumbu tembok (v1 salah di dua
  tembok berdekatan); A9 memakai ring kompleks dan benih luar > 4,5 m dari batas peta; titik ≤ 1,0 m dari bukaan terdaftar tidak
  dihitung "di aspal"; garis batas–batas < 14 m dikecualikan dari A13.
- **K1**: `bots.js buildGraph` — sambungan ujung buntu kini mensyaratkan `clearPath`. `doorThink` tidak disentuh.
- **Diuji di browser**: uji asap (diulang setelah digabung dengan Kostum M2) 0 galat konsol; pemain tertahan tembok 16/16; lewat
  gerbang/pintu 29/32 (gagal: k1 (548,441) arah keluar — pemain tidak bergerak dari titik awal uji; k3 (−639,401) dua arah — 2,4 m
  di luar pintu ada dinding belakang gedung 5313/5314, harus berbelok); gapura Asri pindah ke (−448,−720). Simulasi bot 8 menit
  (2 run per sisi): bot diam ≥ 20 dtk 1,1–1,4 % (main 0,3–0,8 %), lintas masuk/keluar kompleks tetap terjadi. Muat 5,62 → 5,75 dtk,
  ms/frame setara, rintangan 5.573 → 9.107. Tidak ada uji ulang setelah cap `?v=`.
- **Kekurangan**: `envProps.stats.dropped` 6 → 14 (4 pos jaga + 4 palang gerbang terbuang; batas rancangan ≤ 12, BELUM ditelusuri);
  bot diam sedikit naik (sampel kecil); sebagian pintu k3 membuka ke gang sempit (belum dihitung); gerbang servis k2 (−665,−625)
  berpotongan tembok pendek + satu daun miring; puntung tembok di persimpangan (−574,721); tembok rapat ke kanopi ruko 1669;
  garis tembok berkelok kecil mengikuti raster. Belum diuji: kendaraan melewati gerbang, pertandingan penuh, perangkat nyata;
  uji jalan hanya 16 bukaan (sisanya dibuktikan A10 di node).
- **Berikutnya**: M4 tanam ulang pohon, M5 (termasuk tembok apartemen).
