// Pengatur kualitas otomatis: menjaga frame tetap rata pada laju layar.
// Dipakai game/main.js; murni logika (tanpa DOM/WebGL) supaya bisa diuji dengan urutan waktu frame buatan.
//
// Sasaran = laju layar (mis. 120 Hz). Tiap 0,5 dtk dihitung porsi frame "telat" (selang > 1,5× selang sasaran):
// - telat > 10 % selama 1,5 dtk → turun satu langkah; langkah yang gagal baru dicoba lagi setelah jeda yang berlipat
//   tiap gagal (20 dtk → … → 2 menit),
// - mulus (telat ≤ 4 %) selama 10 dtk → naik satu langkah (sendat sesekali tidak mengulang hitungan),
// - layar ≥ 90 Hz dan di langkah `floor` pun masih telat → sasaran jadi setengah laju layar: frame digambar tiap dua
//   kali refresh (60 FPS rata, bukan 70–110 yang tersendat) dan kualitas boleh naik lagi; sesekali laju penuh dicoba
//   lagi (gagal dalam 6 dtk → kembali ke setengah laju, jeda percobaan berikutnya berlipat).
const HZ = [240, 165, 144, 120, 100, 90, 75, 60, 50];

// n: jumlah langkah (0 = terbaik); floor: langkah terendah demi laju layar penuh; apply(i): terapkan langkah;
// changed(): simpan keadaan (langkah / setengah laju berubah); ri: selang layar hasil ukur awal (ms), 0 = belum tahu
export function createGovernor({ n, floor = n - 1, start = 0, half = false, ri = 0, apply = () => {}, changed = () => {} }) {
  const snap = (ms) => { const hz = 1000 / ms, near = HZ.find((h) => Math.abs(h - hz) / h < 0.06); return 1000 / (near || hz); };
  const g = { step: Math.max(0, Math.min(n - 1, start)), half, ri: ri > 3.5 && ri < 22 ? snap(ri) : 1000 / 60, bad: 0, good: 0, settle: 0, probeUntil: 0, halfBlocked: 0, halfBackoff: 30, skipNext: false };
  const blocked = new Array(n).fill(0), backoff = new Array(n).fill(20), win = [];
  let acc = 0;
  const setStep = (i, tNow) => { g.step = i; g.settle = tNow + 1; g.bad = 0; g.good = 0; apply(i); changed(); };
  const setHalf = (v, tNow, settle = 1) => { g.half = v; g.settle = tNow + settle; g.bad = 0; g.good = 0; changed(); };
  return {
    get step() { return g.step; }, get half() { return g.half; }, get hz() { return 1000 / g.ri; },
    // true = lewati frame ini (setengah laju layar: frame genap tidak digambar)
    skip() { if (!g.half) { g.skipNext = false; return false; } g.skipNext = !g.skipNext; return g.skipNext; },
    // paksa langkah (pilihan manual / awal)
    force(i, tNow = 0) { g.half = false; g.probeUntil = 0; setStep(Math.max(0, Math.min(n - 1, i)), tNow); },
    // dtMs: selang sejak frame sebelumnya; tNow: detik; active: pengatur boleh mengubah kualitas (sedang main, tab terlihat)
    // → tiap ±0,5 dtk mengembalikan { fps, ms, late }, selain itu null
    tick(dtMs, tNow, active = true) {
      if (!(dtMs > 0) || dtMs > 1000) return null;
      win.push(dtMs); acc += dtMs;
      if (acc < 500) return null;
      const cnt = win.length, fps = cnt * 1000 / acc, ms = acc / cnt;
      // selang layar = selang frame terpendek yang konsisten (persentil ke-10); hanya boleh mengecil
      const sorted = win.slice().sort((a, b) => a - b), p10 = sorted[Math.floor(cnt * 0.1)] / (g.half ? 2 : 1);
      if (cnt >= 8 && p10 > 3.5 && p10 < g.ri * 0.93) g.ri = snap(p10);
      const target = g.ri * (g.half ? 2 : 1);
      let late = 0;
      for (const v of win) if (v > target * 1.5) late++;
      late /= cnt;
      const span = acc / 1000;
      win.length = 0; acc = 0;
      if (!active || tNow <= g.settle) { g.bad = 0; g.good = 0; return { fps, ms, late }; }
      if (late > 0.1) { g.bad += span; g.good = 0; } else { g.bad = Math.max(0, g.bad - span * 0.5); if (late <= 0.04) g.good += span; }
      if (g.bad >= 1.5) {
        if (tNow < g.probeUntil) { g.probeUntil = 0; setHalf(true, tNow); } // coba laju penuh gagal → kembali ke setengah laju
        else if (g.step < (g.half ? n - 1 : floor)) { blocked[g.step] = tNow + backoff[g.step]; backoff[g.step] = Math.min(120, backoff[g.step] * 2); setStep(g.step + 1, tNow); }
        else if (!g.half && g.ri < 11.5) { g.halfBlocked = tNow + g.halfBackoff; g.halfBackoff = Math.min(90, g.halfBackoff * 2); setHalf(true, tNow); }
        else if (g.step < n - 1) setStep(g.step + 1, tNow);
        else g.bad = 0;
      } else if (g.good >= 10) {
        g.good = 0;
        if (g.step > 0 && tNow > blocked[g.step - 1]) setStep(g.step - 1, tNow);
        else if (g.half && tNow > g.halfBlocked) { g.probeUntil = tNow + 6; g.halfBlocked = tNow + g.halfBackoff; g.halfBackoff = Math.min(90, g.halfBackoff * 2); setHalf(false, tNow, 0.5); }
      }
      return { fps, ms, late };
    },
  };
}
