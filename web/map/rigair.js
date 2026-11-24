// Pose udara (overlay di atas Rig.pose, map/rig.js): terjun bebas yang hidup — lengkung (arch), meluncur (W), menukik
// (W + menunduk), mengerem (S), belok/geser dengan badan & anggota badan yang miring berurutan (lengan mendahului, kaki
// tertinggal), kepala menoleh ke arah pandang kamera, getar angin & apungan lambat.
// Semua transisi lewat pegas teredam (integrator implisit, stabil di dt berapa pun). Tanpa alokasi per panggilan:
// state per rig di rig.A (dibuat sekali), tabel pose = larik konstan tingkat modul, kuaternion tulang ditulis langsung
// (bukan lewat Euler → tidak memicu sinkronisasi Euler↔kuaternion three.js).
//
// Masukan (s, semua opsional; lihat komentar di rig.js): freefall, chute, airT (dtk sejak keluar pesawat), airFwd (−1..1),
// airSide (−1..1, + = kanan), airDive (0..1), airTurn (rad/dtk, + = kanan), airSpd (m/dtk), lookYaw/lookPitch (arah pandang
// kamera relatif badan, + = kiri / atas), airSeed (0..1 tetap per karakter).
const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- Tabel pose (radian, konvensi rig.js; armZ & thighZ dikali side) ----------
// kolom: hipsX spineX chestX neckX headX armX armZ foreX thighX thighZ shinX footX handX
const HX = 0, SX = 1, CX = 2, NX = 3, DX = 4, AX = 5, AZ = 6, FX = 7, TX = 8, TZ = 9, KX = 10, FT = 11, HN = 12, NJ = 13;
const ARCH = [1.48, -0.15, -0.12, -0.25, -0.50, -1.57, 1.72, -1.35, 0.35, 0.30, 0.70, 0.45, 0.10];
const TRACK = [1.62, 0.05, 0.10, -0.30, -0.80, -0.12, 0.38, -0.08, 0.08, 0.10, 0.08, 0.60, 0];
const DIVE = [2.60, 0, 0.05, -0.35, -0.60, 0.15, 0.20, -0.05, 0, 0.06, 0.05, 0.75, 0];
const BACK = [1.12, -0.22, -0.18, -0.15, -0.35, 0.25, 2.20, -0.40, -0.35, 0.32, 1.50, 0.30, -0.30];
const J = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // pose campuran frame ini (temporer modul; larik angka biasa = double, tanpa konversi)

// ---------- Pegas ----------
// kanal: [f Hz, ζ]
const CH = [
  [1.9, 0.55], // 0 track (ARCH → TRACK lengan berayun ±1,4 rad: ≤ 12 rad/dtk)
  [1.9, 0.60], // 1 dive
  [1.9, 0.50], // 2 back (dari ARCH lengan berayun jauh: f lebih rendah supaya ≤ 12 rad/dtk)
  [2.4, 0.45], // 3 bank (badan)
  [3.4, 0.42], // 4 bankArm (mendahului)
  [1.7, 0.50], // 5 bankLeg (tertinggal)
  [3.0, 0.85], // 6 look
];
const NC = CH.length;
function spr(S, i, target, fk, dt) {
  const o = i * 2;
  if (dt >= 0.25) { S[o] = target; S[o + 1] = 0; return target; }
  const w = TAU * CH[i][0] * fk, z = CH[i][1];
  const v = (S[o + 1] + dt * w * w * (target - S[o])) / (1 + 2 * z * w * dt + w * w * dt * dt);
  S[o + 1] = v;
  return (S[o] += v * dt);
}

// sin/cos cepat (polinomial derajat 9 setelah reduksi rentang; galat < 4e-6) — pose udara memanggilnya ±80× per karakter
const HPI = PI / 2;
function fsin(x) {
  x -= TAU * Math.round(x / TAU);
  if (x > HPI) x = PI - x; else if (x < -HPI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880)))));
}
const fcos = (x) => fsin(x + HPI);

// ---------- Kuaternion langsung (Euler XYZ, sama dengan three.js) ----------
function qXYZ(o, x, y, z) {
  const q = o.quaternion, a = x * 0.5, b = y * 0.5, c = z * 0.5;
  const s1 = fsin(a), c1 = fcos(a), s2 = fsin(b), c2 = fcos(b), s3 = fsin(c), c3 = fcos(c);
  q._x = s1 * c2 * c3 + c1 * s2 * s3;
  q._y = c1 * s2 * c3 - s1 * c2 * s3;
  q._z = c1 * c2 * s3 + s1 * s2 * c3;
  q._w = c1 * c2 * c3 - s1 * s2 * s3;
}
function qXZ(o, x, z) {
  const q = o.quaternion, a = x * 0.5, c = z * 0.5, s1 = fsin(a), c1 = fcos(a), s3 = fsin(c), c3 = fcos(c);
  q._x = s1 * c3; q._y = -s1 * s3; q._z = c1 * s3; q._w = c1 * c3;
}
function qXY(o, x, y) {
  const q = o.quaternion, a = x * 0.5, b = y * 0.5, s1 = fsin(a), c1 = fcos(a), s2 = fsin(b), c2 = fcos(b);
  q._x = s1 * c2; q._y = c1 * s2; q._z = s1 * s2; q._w = c1 * c2;
}
function qX(o, x) { const q = o.quaternion, a = x * 0.5; q._x = fsin(a); q._y = 0; q._z = 0; q._w = fcos(a); }
// tulang yang tidak pernah diputar Rig.pose (leher, tangan): kembali ke nol saat overlay mati
function rest(o) { const q = o.quaternion; q._x = q._y = q._z = 0; q._w = 1; o.rotation._x = o.rotation._y = o.rotation._z = 0; }

function makeState(s) {
  const seed = s.airSeed != null ? s.airSeed : Math.random();
  return { S: new Float64Array(NC * 2), on: false, w: 0, seed, fk: 0.92 + 0.16 * seed, ph: seed * 97.3, t: 0 };
}

// pre = true: dipanggil di AWAL Rig.pose. Bila overlay menutup seluruh tubuh (bobot penuh), pose dikerjakan di sini dan
// Rig.pose langsung selesai (pose dasar tidak dihitung sia-sia) → return true. Selain itu return false tanpa mengubah apa
// pun, lalu Rig.pose memanggil lagi (pre = false) setelah pose dasar untuk mencampur (masuk/keluar overlay).
export function poseAir(rig, s, dt, pre) {
  const A = rig.A || (rig.A = makeState(s)), b = rig.b, S = A.S;
  const fall = !!s.freefall;
  if (pre) {
    if (!fall || A.w < 0.999) return false;
    if (s.hit) s.hit = 0; // impuls yang biasanya dikonsumsi pose dasar
    if (s.fire) s.fire = 0;
    if (s.punch) s.punch = 0;
    if (s.throw) s.throw = 0;
    if (s.swap) s.swap = 0;
  }
  // bobot overlay: masuk/keluar halus (pegas Rig.pose untuk payung/darat mengambil alih di bawahnya)
  A.w += ((fall ? 1 : 0) - A.w) * (1 - Math.exp(-dt * (fall ? 5 : 7)));
  if (!fall && A.w < 0.003) { // mati: leher & tangan dinolkan sekali, pegas direset
    if (A.on) { rest(b.neck); rest(b.handL); rest(b.handR); S.fill(0); A.on = false; }
    return false;
  }
  if (!A.on) { A.on = true; if (dt < 0.25) { S.fill(0); } }
  const w = A.w, full = w > 0.999;
  A.t += dt;
  const t = A.t, ph = A.ph, fk = A.fk;
  // ----- masukan
  const fwd = clamp(s.airFwd || 0, -1, 1), side = clamp(s.airSide || 0, -1, 1), dive = fwd > 0 ? clamp(s.airDive || 0, 0, 1) : 0;
  const turnN = clamp((s.airTurn || 0) / 1.8, -1, 1);
  const windK = clamp((s.airSpd != null ? s.airSpd : 46) / 60, 0, 1.3);
  const jit = clamp(1.5 - dt * 30, 0, 1); // bot yang jarang dipose: getar dipudarkan (tidak aliasing)
  let psi = clamp(s.lookYaw || 0, -0.9, 0.9);
  if (Math.abs(s.lookYaw || 0) > 2.0) psi = 0; // kamera di depan wajah: jangan menoleh patah
  // ----- pegas
  const wT = spr(S, 0, Math.max(fwd, 0) * (1 - dive) + 0.25 * Math.abs(side), fk, dt);
  const wD = spr(S, 1, dive, fk, dt);
  const wB = spr(S, 2, Math.max(-fwd, 0), fk, dt);
  const bankT = clamp(0.45 * side + 0.65 * turnN, -1, 1);
  const bank = spr(S, 3, bankT, fk, dt);
  const bArm = spr(S, 4, clamp(0.8 * side + 0.3 * turnN, -1, 1), fk, dt);
  const bLeg = spr(S, 5, bankT, fk, dt);
  const look = spr(S, 6, psi, fk, dt);
  // ----- campuran pose
  const kT = wT * (1 - wD);
  for (let j = 0; j < NJ; j++) J[j] = ARCH[j];
  if (kT * kT > 1e-8) for (let j = 0; j < NJ; j++) J[j] += kT * (TRACK[j] - ARCH[j]);
  if (wD * wD > 1e-8) for (let j = 0; j < NJ; j++) J[j] += wD * (DIVE[j] - ARCH[j]);
  if (wB * wB > 1e-8) for (let j = 0; j < NJ; j++) J[j] += wB * (BACK[j] - ARCH[j]);
  const dk = 1 - 0.5 * clamp(wD, 0, 1); // menukik: belok lebih kecil
  // apungan lambat & getar angin (fase per rig)
  const fl1 = fsin(t * 4.4 + ph), fl2 = fsin(t * 6.3 + ph * 1.7), fl3 = fsin(t * 8.1 + ph * 0.6);
  const wj = windK * jit;
  // getar angin: 4 sinus bersama per frame (6–8 Hz, amplitudo kecil), dipakai bergantian per sisi
  const j1 = wj > 0 ? fsin(t * 41 + ph) : 0, j2 = wj > 0 ? fsin(t * 52 + ph * 1.3) : 0, j3 = wj > 0 ? fsin(t * 37.7 + ph * 0.7) : 0, j4 = wj > 0 ? fsin(t * 47 + ph * 2.3) : 0;
  // ----- badan
  const hy = 0.20 * bank * dk + 0.035 * fl1, hz = 0.10 * bank * dk + 0.03 * fl2;
  const sy = 0.14 * bank * dk, cy = 0.14 * bank * dk;
  const P = J[HX] + J[SX] + J[CX];
  let hx = J[HX], spx = J[SX], chx = J[CX], nx = J[NX], dx = J[DX] + 0.02 * wj * j4;
  // toleh kepala: separuh di leher, separuh di kepala (sumbu putar mengikuti kemiringan badan)
  let ny = 0, nz = 0, dy = 0, dz = 0.02 * wj * fl3;
  if (look * look > 1e-6) { const P2 = P + nx; ny = 0.5 * look * fcos(P); nz = -0.5 * look * fsin(P); dy = 0.5 * look * fcos(P2); dz -= 0.5 * look * fsin(P2); }
  if (full) {
    b.hips.position.set(0, 0.98, 0);
    qXYZ(b.hips, hx, hy, hz);
    qXY(b.spine, spx, sy);
    qXY(b.chest, chx, cy);
    if (ny === 0 && nz === 0) qX(b.neck, nx); else qXYZ(b.neck, nx, ny, nz);
    qXYZ(b.head, dx, dy, dz);
  } else {
    const r = b.hips.rotation;
    qXYZ(b.hips, r.x + (hx - r.x) * w, r.y + (hy - r.y) * w, r.z + (hz - r.z) * w);
    const rs = b.spine.rotation; qXYZ(b.spine, rs.x + (spx - rs.x) * w, rs.y + (sy - rs.y) * w, rs.z * (1 - w));
    const rc = b.chest.rotation; qXYZ(b.chest, rc.x + (chx - rc.x) * w, rc.y + (cy - rc.y) * w, rc.z * (1 - w));
    qXYZ(b.neck, nx * w, ny * w, nz * w);
    const rh = b.head.rotation; qXYZ(b.head, rh.x + (dx - rh.x) * w, rh.y * (1 - w) + dy * w, rh.z * (1 - w) + dz * w);
  }
  // ----- lengan & kaki per sisi (side +1 = kiri)
  for (let k = 0; k < 2; k++) {
    const sd = k === 0 ? 1 : -1, ua = k === 0 ? b.armL : b.armR, fa = k === 0 ? b.foreL : b.foreR, hd = k === 0 ? b.handL : b.handR;
    const th = k === 0 ? b.thighL : b.thighR, sh = k === 0 ? b.shinL : b.shinR, ft = k === 0 ? b.footL : b.footR;
    const ia = -sd * bArm * dk, il = -sd * bLeg * dk; // > 0 = sisi dalam belokan
    const ja = k === 0 ? j1 : j2, jb = k === 0 ? j3 : j4, jc = k === 0 ? j2 : j1, jd = k === 0 ? j4 : j3;
    let ax = J[AX] + 0.30 * ia;
    let az = J[AZ] - (ia > 0 ? 0.35 : 0.20) * ia + 0.05 * sd * fl1;
    let fx = J[FX] - (ia > 0 ? 0.30 : 0.45) * ia + 0.025 * wj * jc + 0.04 * fl2;
    const hx2 = J[HN] + 0.05 * wj * ja, hz2 = 0.05 * wj * jb;
    let tx = J[TX] - 0.12 * il, tz = J[TZ] - 0.10 * il;
    let kx = Math.max(0.05, J[KX] + 0.40 * il + 0.03 * wj * jd + 0.05 * fl3 * sd);
    let fz = J[FT] + 0.04 * wj * (0.6 * jb + 0.4 * jc);
    if (!full) {
      const ru = ua.rotation, rt = th.rotation;
      ax = ru.x + (ax - ru.x) * w; az = ru.z * sd + (az - ru.z * sd) * w;
      fx = fa.rotation.x + (fx - fa.rotation.x) * w;
      tx = rt.x + (tx - rt.x) * w; tz = rt.z * sd + (tz - rt.z * sd) * w;
      kx = sh.rotation.x + (kx - sh.rotation.x) * w;
      fz = ft.rotation.x + (fz - ft.rotation.x) * w;
      qXZ(hd, hx2 * w, hz2 * w);
    } else qXZ(hd, hx2, hz2);
    qXZ(ua, ax, az * sd);
    qX(fa, fx);
    qXZ(th, tx, tz * sd);
    qX(sh, kx);
    qX(ft, fz);
  }
  return true;
}
