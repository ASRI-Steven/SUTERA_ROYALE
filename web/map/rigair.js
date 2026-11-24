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
const smax = (d) => (d + Math.sqrt(d * d + 0.0225)) * 0.5; // ≈ max(0, d) tanpa patahan (smax(0) = 0,075)
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- Tabel pose (radian, konvensi rig.js; armZ & thighZ dikali side) ----------
// kolom: hipsX spineX chestX neckX headX armX armZ foreX thighX thighZ shinX footX handX
const HX = 0, SX = 1, CX = 2, NX = 3, DX = 4, AX = 5, AZ = 6, FX = 7, TX = 8, TZ = 9, KX = 10, FT = 11, HN = 12, NJ = 13;
const ARCH = [1.48, -0.15, -0.12, -0.25, -0.50, -1.57, 1.72, -1.35, 0.35, 0.30, 0.70, 0.45, 0.10];
const TRACK = [1.62, 0.05, 0.10, -0.30, -0.80, -0.12, 0.38, -0.08, 0.08, 0.10, 0.08, 0.60, 0];
const DIVE = [2.60, 0, 0.05, -0.35, -0.60, 0.15, 0.20, -0.05, 0, 0.06, 0.05, 0.75, 0];
// keluar pesawat: meringkuk (hipsX diganti ramp 0,30 → 0,90 selama LEAP)
const EXIT = [0.30, 0.35, 0.25, 0, 0.20, -1.10, 0.45, -0.90, -1.25, 0.12, 1.70, -0.20, 0];
// payung (hipsX = target bandul kanal 7, bukan dipakai langsung)
const CANOPY = [0.06, 0.05, 0, 0, 0.10, -2.75, 0.28, -0.25, -0.22, 0.08, 0.35, 0.25, 0];
const CAN_W = [0.38, 0.05, 0.08, 0, -0.25, -2.45, 0.10, -1.05, 0.20, 0.08, 0.55, 0.50, 0];
const FLARE = [-0.16, -0.05, 0, 0, 0.25, -0.40, 0.30, -0.25, -0.45, 0.06, 0.60, -0.15, 0];
const JERK = [0, 0.25, 0.15, 0, 0.45, -1.90, 0.55, -0.30, -0.75, 0.10, 0.25, -0.20, 0];
const BACK = [1.12, -0.22, -0.18, -0.15, -0.35, 0.25, 2.20, -0.40, -0.35, 0.32, 1.50, 0.30, -0.30];
const J = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // pose campuran frame ini (temporer modul; larik angka biasa = double, tanpa konversi)

// ---------- Pegas ----------
// kanal: [f Hz, ζ]
const CH = [
  [1.9, 0.55], // 0 track (ARCH → TRACK lengan berayun ±1,4 rad: ≤ 12 rad/dtk)
  [1.7, 0.60], // 1 dive
  [1.9, 0.50], // 2 back (dari ARCH lengan berayun jauh: f lebih rendah supaya ≤ 12 rad/dtk)
  [2.4, 0.45], // 3 bank (badan)
  [3.4, 0.42], // 4 bankArm (mendahului)
  [1.7, 0.50], // 5 bankLeg (tertinggal)
  [3.0, 0.85], // 6 look
  [1.15, 0.33], // 7 cPitch (rad, bandul payung; f & ζ diganti per frame: 1,15 → 0,6 Hz, 0,33 → 0,22)
  [0.7, 0.28], // 8 cRoll (rad, badan berayun keluar saat belok di bawah payung)
  [1.2, 0.60], // 9 cDrive (payung W/S; lengan berayun ±2 rad → pegas pelan supaya ≤ 12 rad/dtk)
  [1.6, 0.60], // 10 cSteer (payung A/D: tali kemudi)
];
const NC = CH.length;
function spr(S, i, target, fk, dt, f, zz, vmax) {
  const o = i * 2;
  if (dt >= 0.25) { S[o] = target; S[o + 1] = 0; return target; }
  const w = TAU * (f || CH[i][0]) * fk, z = zz || CH[i][1];
  let v = (S[o + 1] + dt * w * w * (target - S[o])) / (1 + 2 * z * w * dt + w * w * dt * dt);
  if (vmax && (v > vmax || v < -vmax)) v = v > 0 ? vmax : -vmax; // batas laju (mis. W → S: lengan berayun jauh)
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
  return { S: new Float64Array(NC * 2), on: false, w: 0, seed, fk: 0.92 + 0.16 * seed, ph: seed * 97.3, t: 0, at: 99, ct: -1,
    O: new Float64Array(36), OF: new Float64Array(36), ofOk: false, cOff: 0, lt: -1, lk: 0, w0: 0, hx: ARCH[HX], fd: 0, fs: 0, bank: 0, cfw: 0, cbr: 0, cR: 0, cP: 0 };
}

// Hasil pose frame ini (radian), ditulis ke tulang oleh write(): posisi pinggul, rotasi XYZ badan, lalu per sisi
// (kiri 18.., kanan 27..): armX armZ foreX handX handZ thighX thighZ shinX footX (Z sudah dikali side)
// O = larik milik rig yang sedang dipose (rig.A.O): pose udara terakhir tetap tersimpan per karakter untuk dicampur saat
// mendarat. D = tambahan (aditif) di atas campuran, dipakai pendaratan (temporer modul, dinolkan tiap panggilan).
let O = null;
const D = new Float64Array(36);
const OL = 18, OR = 27;
// berguling (mendarat cepat): meringkuk; pinggul X ditambah 2π selama guling
const ROLL = [0.3, 0.45, 0.45, 0.30, 0.50, -1.20, 0.25, -1.70, -1.90, 0.15, 2.20, -0.30, 0];
// lama pendaratan per jenis (dtk): 0 serap (flare), 1 lari kecil, 2 berguling — sama dengan player.js LAND.dur
const LAND_DUR = [0.55, 0.7, 1.35];
const PULL_R = [-0.20, 0.60, -1.30], PULL_L = [-1.57, 2.40, -0.60]; // tangan kanan meraih pilot chute di pinggang, kiri menjaga keseimbangan

// pre = true: dipanggil di AWAL Rig.pose. Bila overlay menutup seluruh tubuh (bobot penuh), pose dikerjakan di sini dan
// Rig.pose langsung selesai (pose dasar tidak dihitung sia-sia) → return true. Selain itu return false tanpa mengubah apa
// pun, lalu Rig.pose memanggil lagi (pre = false) setelah pose dasar untuk mencampur (masuk/keluar overlay).
export function poseAir(rig, s, dt, pre) {
  const A = rig.A || (rig.A = makeState(s)), b = rig.b, S = A.S;
  const fall = !!s.freefall, chute = !!s.chute && !fall, air = fall || chute, at = s.airT != null ? s.airT : 99;
  const lt = !air && s.landT >= 0 ? s.landT : -1;
  O = A.O;
  if (fall && at < 0.3) { // baru keluar pesawat: overlay langsung penuh (karakter baru muncul), pegas mulai dari nol
    if (A.at > at || !A.on) { S.fill(0); A.t = 0; }
    A.w = 1;
  }
  A.at = at;
  if (pre) {
    if (!air || A.w < 0.999) return false;
    if (s.hit) s.hit = 0; // impuls yang biasanya dikonsumsi pose dasar
    if (s.fire) s.fire = 0;
    if (s.punch) s.punch = 0;
    if (s.throw) s.throw = 0;
    if (s.swap) s.swap = 0;
  }
  // bobot overlay: masuk/keluar halus (pose dasar Rig.pose mengambil alih di darat)
  if (lt >= 0) {
    if (A.lt < 0) { A.w0 = A.on ? A.w : 0; A.lk = s.landKind | 0; for (let i = 0; i < 36; i++) A.OF[i] = O[i]; } // menyentuh tanah
    A.w = A.lk === 2 ? landRollW(lt) : A.w0 * (1 - sstep(0, 0.35, lt));
  } else A.w += ((air ? 1 : 0) - A.w) * (1 - Math.exp(-dt * (air ? 5 : 7)));
  A.lt = lt;
  if (!air && lt < 0 && A.w < 0.003) { // mati: leher & tangan dinolkan sekali, pegas direset
    if (A.on) { rest(b.neck); rest(b.handL); rest(b.handR); S.fill(0); A.on = false; A.ct = -1; A.ofOk = false; A.lt = -1; }
    return false;
  }
  if (!A.on) { A.on = true; if (dt < 0.25) { S.fill(0); } }
  A.t += dt;
  D.fill(0);
  if (air) {
    if (chute) poseChute(A, s, dt, at); else poseFall(A, s, dt, at);
  } else if (lt >= 0) poseLand(A, lt); // di darat (bobot memudar): pose udara terakhir tetap di O, dicampur ke pose dasar
  write(b, A.w);
  return true;
}

// ---------- Terjun bebas ----------
function poseFall(A, s, dt, at) {
  const S = A.S, t = A.t, ph = A.ph, fk = A.fk;
  A.ct = -1;
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
  A.bank = bank;
  // ----- campuran pose
  const kT = wT * (1 - wD);
  for (let j = 0; j < NJ; j++) J[j] = ARCH[j];
  if (kT * kT > 1e-8) for (let j = 0; j < NJ; j++) J[j] += kT * (TRACK[j] - ARCH[j]);
  if (wD * wD > 1e-8) for (let j = 0; j < NJ; j++) J[j] += wD * (DIVE[j] - ARCH[j]);
  if (wB * wB > 1e-8) for (let j = 0; j < NJ; j++) J[j] += wB * (BACK[j] - ARCH[j]);
  // ----- keluar pesawat: LEAP (0–0,22 dtk, meringkuk) → TUMBLE (salto ke depan, 0,22–1,17) → STABIL (sstep 0,7–1,6)
  let tumble = 0, ty = 0, tz2 = 0, flail = 0, bounce = 0;
  if (at < 1.6) {
    const wS = sstep(0.7, 1.6, at), sg = A.seed > 0.5 ? 1 : -1;
    EXIT[HX] = 0.30 + 0.60 * clamp(at / 0.22, 0, 1);
    for (let j = 0; j < NJ; j++) J[j] = EXIT[j] + (J[j] - EXIT[j]) * wS;
    const u = sstep(0.22, 1.17, at), tau = TAU * u;
    tumble = TAU * u; // puncak ±9,9 rad/dtk
    ty = 0.75 * sg * fsin(tau * 0.5);
    tz2 = 0.35 * sg * fsin(tau);
    flail = sstep(0.22, 0.45, at) * (1 - wS); // kibas anggota badan (pelan, ≤ 6 rad/dtk)
  }
  if (at > 1.0 && at < 3.0) { const tb = at - 1.0; bounce = -0.12 * Math.exp(-4 * tb) * fsin(TAU * 1.6 * tb); } // pantulan lengkung
  const dk = 1 - 0.5 * clamp(wD, 0, 1); // menukik: belok lebih kecil
  // apungan lambat & getar angin (fase per rig)
  const fl1 = fsin(t * 4.4 + ph), fl2 = fsin(t * 6.3 + ph * 1.7), fl3 = fsin(t * 8.1 + ph * 0.6);
  const wj = windK * jit;
  // getar angin: 4 sinus bersama per frame (6–8 Hz, amplitudo kecil), dipakai bergantian per sisi
  const j1 = wj > 0 ? fsin(t * 41 + ph) : 0, j2 = wj > 0 ? fsin(t * 52 + ph * 1.3) : 0, j3 = wj > 0 ? fsin(t * 37.7 + ph * 0.7) : 0, j4 = wj > 0 ? fsin(t * 47 + ph * 2.3) : 0;
  // ----- badan
  const hx = J[HX] + tumble, nx = J[NX];
  O[0] = 0; O[1] = 0.98; O[2] = 0;
  O[3] = hx; O[4] = 0.20 * bank * dk + 0.035 * fl1 + ty; O[5] = 0.10 * bank * dk + 0.03 * fl2 + tz2;
  O[6] = J[SX] + bounce; O[7] = 0.14 * bank * dk; O[8] = 0;
  O[9] = J[CX] + bounce; O[10] = 0.14 * bank * dk; O[11] = 0;
  O[12] = nx; O[13] = 0; O[14] = 0;
  O[15] = J[DX] + 0.02 * wj * j4; O[16] = 0; O[17] = 0.02 * wj * fl3;
  headLook(look, J[HX] + J[SX] + J[CX], nx);
  A.hx = hx - TAU * Math.round(hx / TAU); // sudut badan terakhir: bandul payung mulai dari sini
  // ----- lengan & kaki per sisi (side +1 = kiri)
  for (let k = 0; k < 2; k++) {
    const sd = k === 0 ? 1 : -1, o = k === 0 ? OL : OR;
    const ia = -sd * bArm * dk, il = -sd * bLeg * dk; // > 0 = sisi dalam belokan
    const ja = k === 0 ? j1 : j2, jb = k === 0 ? j3 : j4, jc = k === 0 ? j2 : j1, jd = k === 0 ? j4 : j3;
    let az = J[AZ] - (ia > 0 ? 0.35 : 0.20) * ia + 0.05 * sd * fl1;
    if (flail > 0) az += 0.35 * flail * fsin(t * 16.3 + k * 1.7);
    O[o] = J[AX] + 0.30 * ia + (flail > 0 ? 0.40 * flail * fsin(t * 14.5 + k * 2.3) : 0);
    O[o + 1] = az * sd;
    O[o + 2] = J[FX] - (ia > 0 ? 0.30 : 0.45) * ia + 0.025 * wj * jc + 0.04 * fl2;
    O[o + 3] = J[HN] + 0.05 * wj * ja; O[o + 4] = 0.05 * wj * jb;
    O[o + 5] = J[TX] - 0.12 * il + bounce + (flail > 0 ? 0.35 * flail * fsin(t * 12.2 + k * 3.1 + 1) : 0);
    O[o + 6] = (J[TZ] - 0.10 * il) * sd;
    O[o + 7] = Math.max(0.05, J[KX] + 0.40 * il + 0.03 * wj * jd + 0.05 * fl3 * sd);
    O[o + 8] = J[FT] + 0.04 * wj * (0.6 * jb + 0.4 * jc);
  }
  for (let i = 0; i < 36; i++) A.OF[i] = O[i]; // pose terakhir untuk peralihan ke payung
  A.ofOk = true;
}

// toleh kepala: separuh di leher, separuh di kepala (sumbu putar mengikuti kemiringan badan P)
function headLook(look, P, nx) {
  if (look * look < 1e-6) return;
  const P2 = P + nx;
  O[13] += 0.5 * look * fcos(P); O[14] -= 0.5 * look * fsin(P);
  O[16] += 0.5 * look * fcos(P2); O[17] -= 0.5 * look * fsin(P2);
}

// ---------- Payung ----------
// chuteT: 0–0,18 tarik (PULL) → 0,18–0,45 tali terulur (STRETCH) → 0,45–0,95 mengembang + sentakan (JERK) → bandul meluruh.
// Badan berputar di titik gantung (bahu, 1,45 m di atas kaki): bandul maju/mundur (kanal 7) & ayun samping (kanal 8).
function poseChute(A, s, dt, at) {
  const S = A.S, t = A.t, ph = A.ph, fk = A.fk;
  let ct = s.chuteT != null && s.chuteT >= 0 ? s.chuteT : 5;
  if (A.ct < 0) { // baru membuka: bandul mulai dari sudut badan saat jatuh
    A.cOff = ct > 1.2 || !A.ofOk ? 5 : 0; // bot baru terlihat / belum pernah dipose jatuh: langsung terbuka penuh
    S[14] = A.cOff ? 0.06 : A.hx; S[15] = 0;
  }
  ct += A.cOff;
  A.ct = ct;
  const fwd = clamp(s.airFwd || 0, -1, 1), side = clamp(s.airSide || 0, -1, 1);
  const turnN = clamp((s.airTurn || 0) / 1.8, -1, 1);
  const jit = clamp(1.5 - dt * 30, 0, 1) * 0.25;
  let psi = clamp(s.lookYaw || 0, -0.9, 0.9);
  if (Math.abs(s.lookYaw || 0) > 2.0) psi = 0;
  const open = sstep(0.3, 0.9, ct); // masukan kemudi baru terasa setelah kanopi mengembang
  // target diperhalus dulu (orde 3: percepatan lengan mulai halus, tidak menyentak)
  const kf = dt >= 0.25 ? 1 : 1 - Math.exp(-dt * 9);
  A.fd += (fwd * open - A.fd) * kf; A.fs += (side * open - A.fs) * kf;
  const drive = spr(S, 9, A.fd, fk, dt), steer = spr(S, 10, A.fs, fk, dt);
  const cfw = smax(drive), cbr = smax(-drive); // maks halus: lengan tidak menyentak saat W ↔ S melewati nol
  const bankT = clamp(0.45 * side + 0.65 * turnN, -1, 1) * open;
  const bank = spr(S, 3, bankT, fk, dt);
  const bLeg = spr(S, 5, bankT, fk, dt);
  const look = spr(S, 6, psi, fk, dt);
  // bandul
  const fe = sstep(0.3, 1.6, ct);
  const cP = ct < 0.18 ? S[14] : spr(S, 7, 0.06 + 0.32 * cfw - 0.22 * cbr, 1, dt, 1.15 - 0.55 * fe, 0.33 - 0.11 * fe);
  const cR = spr(S, 8, 0.34 * bank, fk, dt);
  A.bank = bank; A.cfw = cfw; A.cbr = cbr; A.cR = cR; A.cP = cP;
  const wC = sstep(0.18, 0.60, ct);
  const jk = sstep(0.42, 0.55, ct) * (1 - sstep(0.55, 0.95, ct)); // sentakan saat kanopi penuh
  const pb = sstep(0, 0.25, ct) * (1 - sstep(0.30, 0.75, ct)); // tangan kanan menarik pilot chute
  for (let j = 0; j < NJ; j++) {
    let c = CANOPY[j] + cfw * (CAN_W[j] - CANOPY[j]) + cbr * (FLARE[j] - CANOPY[j]);
    c += jk * (JERK[j] - c);
    J[j] = c;
  }
  const fl1 = fsin(t * 4.4 + ph), fl3 = fsin(t * 8.1 + ph * 0.6);
  // ----- badan: berputar di titik gantung; peralihan dari pose jatuh bebas (wC)
  const L = 0.47, cr = fcos(cR), px = L * fsin(cR), py = 1.45 - L * cr * fcos(cP), pz = -L * cr * fsin(cP);
  O[0] = px; O[1] = py; O[2] = pz;
  O[3] = cP; O[4] = 0.035 * 0.25 * fl1; O[5] = cR;
  O[6] = J[SX]; O[7] = 0; O[8] = 0.08 * steer;
  O[9] = J[CX]; O[10] = 0; O[11] = 0;
  O[12] = J[NX]; O[13] = -0.35 * steer; O[14] = 0;
  // pra-mendarat (< 8 m): lutut diangkat, kaki siap, kepala melihat ke bawah
  const pre = s.airGnd != null ? sstep(8, 2, s.airGnd) : 0;
  O[15] = J[DX] - 0.4 * clamp(s.lookPitch || 0, -0.8, 0.5) + 0.2 * pre; O[16] = 0; O[17] = -0.5 * cR;
  headLook(look, cP + J[SX] + J[CX], J[NX]);
  // ----- lengan & kaki
  for (let k = 0; k < 2; k++) {
    const sd = k === 0 ? 1 : -1, o = k === 0 ? OL : OR;
    const i = -sd * steer, ii = smax(i), io = smax(-i); // ii: tangan sisi dalam belokan menarik tali kemudi
    let ax = J[AX] + 1.20 * ii - 0.15 * io, az = J[AZ] - 0.13 * ii, fx = J[FX] - 1.50 * ii + 0.13 * io;
    O[o] = ax; O[o + 1] = az * sd; O[o + 2] = fx;
    O[o + 3] = J[HN] + 0.05 * jit * fl3; O[o + 4] = 0;
    const sway = 0.12 * fsin(t * 1.6 + k * PI + ph) * (1 - cbr); // kaki menggantung berayun pelan
    O[o + 5] = J[TX] - 0.25 * ii + sway * (1 - pre) - 0.35 * pre;
    O[o + 6] = J[TZ] * sd + 0.10 * bLeg;
    O[o + 7] = Math.max(0.05, J[KX] + 0.30 * ii + 0.45 * pre);
    O[o + 8] = J[FT] - 0.10 * pre;
  }
  // peralihan dari pose jatuh bebas terakhir (A.OF) — kecuali pinggul X: bandul sudah mulai dari sudut badan itu
  if (wC < 1) { const OF = A.OF; for (let i = 0; i < 36; i++) if (i !== 3) O[i] = OF[i] + (O[i] - OF[i]) * wC; }
  if (pb > 0) for (let k = 0; k < 2; k++) { // tangan kanan meraih pilot chute, kiri menjaga keseimbangan
    const sd = k === 0 ? 1 : -1, o = k === 0 ? OL : OR, P = k === 0 ? PULL_L : PULL_R;
    O[o] += (P[0] - O[o]) * pb; O[o + 1] += (P[1] * sd - O[o + 1]) * pb; O[o + 2] += (P[2] - O[o + 2]) * pb;
  }
}

// ---------- Mendarat ----------
// 0 serap & 1 lari kecil: pose udara terakhir memudar ke pose dasar (0,35 dtk) + tekukan lutut aditif (naik 0,18 dtk, lepas
// 0,3–0,55); lari kecil = siklus jalan pose dasar karena sisa laju (player.js). 2 berguling: meringkuk → salto ke depan
// di tanah (0,2–0,95) → bangkit (bobot → 0 sampai 1,35).
function landRollW(lt) { return 1 - sstep(0.95, 1.35, lt); }
function poseLand(A, lt) {
  const k = A.lk;
  if (k === 2) {
    const OF = A.OF, e = sstep(0, 0.2, lt), u = sstep(0.2, 0.95, lt);
    for (let j = 0; j < 36; j++) O[j] = OF[j];
    const tgt = (i, v) => { O[i] = OF[i] + (v - OF[i]) * e; };
    tgt(0, 0); tgt(1, 0.45); tgt(2, 0); tgt(3, ROLL[HX]); tgt(4, 0); tgt(5, 0);
    tgt(6, ROLL[SX]); tgt(7, 0); tgt(8, 0); tgt(9, ROLL[CX]); tgt(10, 0); tgt(11, 0);
    tgt(12, ROLL[NX]); tgt(13, 0); tgt(14, 0); tgt(15, ROLL[DX]); tgt(16, 0); tgt(17, 0);
    for (let s = 0; s < 2; s++) {
      const sd = s === 0 ? 1 : -1, o = s === 0 ? OL : OR;
      tgt(o, ROLL[AX]); tgt(o + 1, ROLL[AZ] * sd); tgt(o + 2, ROLL[FX]); tgt(o + 3, 0); tgt(o + 4, 0);
      tgt(o + 5, ROLL[TX]); tgt(o + 6, ROLL[TZ] * sd); tgt(o + 7, ROLL[KX]); tgt(o + 8, ROLL[FT]);
    }
    O[3] += u < 1 ? TAU * u : 0; // salto (≤ 12,6 rad/dtk); selesai = sudut sama tanpa +2π (supaya pudar ke pose dasar tidak berputar balik)
    return;
  }
  const K = k === 0 ? 0.8 : 0.45, c = K * sstep(0, 0.18, lt) * (1 - sstep(0.3, 0.55, lt)) * (1 - sstep(LAND_DUR[k] - 0.2, LAND_DUR[k], lt));
  D[1] = -0.40 * c; D[6] = 0.30 * c;
  for (let s = 0; s < 2; s++) {
    const sd = s === 0 ? 1 : -1, o = s === 0 ? OL : OR;
    D[o + 5] = -0.95 * c; D[o + 7] = 1.75 * c; D[o + 8] = -0.64 * c;
    if (k === 0) { D[o] = -0.6 * c; D[o + 1] = 0.35 * c * sd; D[o + 2] = -0.5 * c; } // serap: lengan ke depan
    else D[o + 1] = 0.5 * sstep(0, 0.15, lt) * (1 - sstep(0.15, LAND_DUR[1], lt)) * sd; // lari kecil: lengan terbuka menjaga keseimbangan
  }
}

// ---------- Tulis ke tulang (w < 1: campur dengan pose dasar yang baru dihitung Rig.pose) ----------
function write(b, w) {
  if (w > 0.999) {
    b.hips.position.set(O[0], O[1], O[2]);
    qXYZ(b.hips, O[3], O[4], O[5]);
    if (O[8] === 0) qXY(b.spine, O[6], O[7]); else qXYZ(b.spine, O[6], O[7], O[8]);
    qXY(b.chest, O[9], O[10]);
    if (O[13] === 0 && O[14] === 0) qX(b.neck, O[12]); else qXYZ(b.neck, O[12], O[13], O[14]);
    qXYZ(b.head, O[15], O[16], O[17]);
    for (let k = 0; k < 2; k++) {
      const o = k === 0 ? OL : OR;
      qXZ(k === 0 ? b.armL : b.armR, O[o], O[o + 1]);
      qX(k === 0 ? b.foreL : b.foreR, O[o + 2]);
      qXZ(k === 0 ? b.handL : b.handR, O[o + 3], O[o + 4]);
      qXZ(k === 0 ? b.thighL : b.thighR, O[o + 5], O[o + 6]);
      qX(k === 0 ? b.shinL : b.shinR, O[o + 7]);
      qX(k === 0 ? b.footL : b.footR, O[o + 8]);
    }
    return;
  }
  const hp = b.hips.position;
  hp.set(hp.x + (O[0] - hp.x) * w + D[0], hp.y + (O[1] - hp.y) * w + D[1], hp.z + (O[2] - hp.z) * w + D[2]);
  mix3(b.hips, 3, w); mix3(b.spine, 6, w); mix3(b.chest, 9, w);
  qXYZ(b.neck, O[12] * w + D[12], O[13] * w + D[13], O[14] * w + D[14]); // leher & tangan: pose dasar = 0
  mix3(b.head, 15, w);
  for (let k = 0; k < 2; k++) {
    const o = k === 0 ? OL : OR;
    mixXZ(k === 0 ? b.armL : b.armR, o, o + 1, w);
    mixXZ(k === 0 ? b.foreL : b.foreR, o + 2, -1, w);
    qXZ(k === 0 ? b.handL : b.handR, O[o + 3] * w, O[o + 4] * w);
    mixXZ(k === 0 ? b.thighL : b.thighR, o + 5, o + 6, w);
    mixXZ(k === 0 ? b.shinL : b.shinR, o + 7, -1, w);
    mixXZ(k === 0 ? b.footL : b.footR, o + 8, -1, w);
  }
}
function mix3(bone, i, w) {
  const r = bone.rotation;
  qXYZ(bone, r.x + (O[i] - r.x) * w + D[i], r.y + (O[i + 1] - r.y) * w + D[i + 1], r.z + (O[i + 2] - r.z) * w + D[i + 2]);
}
function mixXZ(bone, ix, iz, w) {
  const r = bone.rotation;
  qXYZ(bone, r.x + (O[ix] - r.x) * w + D[ix], r.y * (1 - w), iz < 0 ? r.z * (1 - w) : r.z + (O[iz] - r.z) * w + D[iz]);
}
