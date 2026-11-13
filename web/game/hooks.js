// Titik sambung antara pertandingan (game/main.js) dan lapisan meta (lobi, misi, koin, skin).
// main.js memanggil; modul meta mengisi fungsinya. Semua opsional.
export const matchHooks = {
  onStart: null, // ({ diff }) → void : pertandingan dimulai
  onEnd: null,   // (summary) → void : pertandingan selesai. summary = { win, rank, total, kills, damage, surviveSec, diff, … }
                 // (bidang tambahan boleh ditambah pembuatnya di main.js finish(); pemakai harus tahan bidang yang belum ada)
};
