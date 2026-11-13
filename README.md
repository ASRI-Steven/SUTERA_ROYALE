# SUTERA_ROYALE

Game battle royale 3D di peta Alam Sutera, berjalan di browser (three.js), dibangun di atas peta digital twin kawasan.

- `web/royale.html` — game Sutera Royale: lobi, mode regu 4 orang (1 pemain + 3 bot), misi acak & Koin Sutera, kendaraan, senjata, mode grafik realistis
- `web/index.html` — peta digital twin Alam Sutera (peta 3D + keluhan warga real-time)
- `web/garasi.html` — pratinjau kendaraan
- `bff/` — server Go: menyajikan `web/` dan data keluhan dari TownshipDB (SSE)
- `tools/` — pembuat data peta (OpenStreetMap) dan aset 3D (Blender headless)
- `sql/` — stored procedure peta keluhan
- `HANDOFF.md` — catatan teknis lengkap per fitur

## Menjalankan

```
cd bff
cp .env.example .env      # koneksi TownshipDB hanya untuk layer keluhan; game jalan tanpa DB
go build -o bin/alsut3d-bff ./cmd/server
./bin/alsut3d-bff
```

Buka http://127.0.0.1:8765/royale.html (game) atau http://127.0.0.1:8765/ (peta digital twin).
Di dalam game: F3 = tampilkan FPS, F4 = pilih kualitas grafik.

## Aset pihak ketiga

- Data peta © kontributor OpenStreetMap (ODbL)
- Tekstur PBR & langit HDR: Poly Haven (CC0)
- Karakter: data MakeHuman (CC0)
- three.js (MIT), dimuat dari CDN
