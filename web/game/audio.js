// Suara game disintesis langsung (WebAudio), tanpa file: tembakan per jenis senjata (jarak & arah), kena, kill,
// isi ulang, ambil barang, zona, mesin pesawat, angin saat terjun.
let ctx = null, master = null, noise = null;

export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 1.5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noise = buf;
    }
  } catch (e) { ctx = null; }
}
const ok = () => ctx && ctx.state === 'running' && master;

function pan(p) { const n = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (n.pan) n.pan.value = Math.max(-1, Math.min(1, p)); return n; }
function burst({ t = 0, dur = 0.12, freq = 1800, q = 0.7, gain = 1, type = 'lowpass', p = 0 }) {
  const t0 = ctx.currentTime + t, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), pn = pan(p);
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(pn).connect(master);
  src.start(t0, Math.random() * 1.2, dur + 0.05);
  return src;
}
function tone({ t = 0, f0 = 80, f1 = 40, dur = 0.15, gain = 0.6, type = 'sine', p = 0 }) {
  const t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain(), pn = pan(p);
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(pn).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  return o;
}

// range = jarak terdengar (m): senapan & DMR lebih jauh dari pistol/SMG
const GUN = {
  pistol: { freq: 2600, dur: 0.11, thump: 140, body: 0.9, range: 380 },
  smg: { freq: 3000, dur: 0.08, thump: 120, body: 0.75, range: 380 },
  ar: { freq: 2100, dur: 0.14, thump: 95, body: 1, range: 620 },
  shotgun: { freq: 1300, dur: 0.3, thump: 70, body: 1.25, range: 450 },
  dmr: { freq: 1800, dur: 0.24, thump: 75, body: 1.25, range: 720 },
  sniper: { freq: 1500, dur: 0.36, thump: 58, body: 1.5, range: 950 },
  lmg: { freq: 1950, dur: 0.15, thump: 88, body: 1.08, range: 650 },
  revolver: { freq: 1650, dur: 0.24, thump: 78, body: 1.3, range: 450 },
  burst: { freq: 2250, dur: 0.12, thump: 100, body: 0.95, range: 600 },
  pdw: { freq: 3400, dur: 0.065, thump: 135, body: 0.62, range: 330 },
  dbs: { freq: 1050, dur: 0.38, thump: 58, body: 1.4, range: 480 },
};
// Suara tembakan yang sedang berbunyi (polifoni dibatasi: saat penuh, yang terjauh dibuang supaya 100 bot tidak pecah)
const SHOT_VOICES = 14, shotVoices = [];
// dist = jarak ke pendengar (m), p = pan kiri/kanan (−1..1), muffled = penembak di dalam gedung & pendengar di luar.
// Dekat: tajam. Jauh: lebih pelan, frekuensi tinggi hilang, tiba terlambat (jarak/343 dtk, maks 1,2) + ekor "dor" jauh.
export function shot(kind, dist = 0, p = 0, muffled = false) {
  if (!ok()) return;
  const g = GUN[kind] || GUN.ar;
  if (dist > g.range) return;
  const far = Math.min(1, dist / g.range), fade = dist < g.range * 0.7 ? 1 : 1 - (dist - g.range * 0.7) / (g.range * 0.3);
  const vol = g.body * fade * (dist < 12 ? 1 : 1 / (1 + Math.pow((dist - 12) / 38, 1.1))) * (muffled ? 0.6 : 1);
  const now = ctx.currentTime, delay = Math.min(1.2, dist / 343), lp = (muffled ? 0.45 : 1) * (1 - far * 0.8), pp = p * 0.85;
  for (let i = shotVoices.length - 1; i >= 0; i--) if (shotVoices[i].end < now) shotVoices.splice(i, 1);
  if (shotVoices.length >= SHOT_VOICES) { // penuh: ganti yang terjauh kalau yang baru lebih dekat
    let fi = 0;
    for (let i = 1; i < shotVoices.length; i++) if (shotVoices[i].dist > shotVoices[fi].dist) fi = i;
    if (shotVoices[fi].dist <= dist) return;
    for (const n of shotVoices[fi].nodes) { try { n.stop(); } catch (e) { /* sudah berhenti */ } }
    shotVoices.splice(fi, 1);
  }
  const dur = g.dur * (1 + far * 1.5), nodes = [
    burst({ t: delay, dur, freq: g.freq * lp, gain: vol, p: pp, q: 0.6 }),
    tone({ t: delay, f0: g.thump * 1.6, f1: g.thump * 0.6, dur: 0.12 + far * 0.2, gain: vol * (0.8 + far * 0.4), p: pp }),
  ];
  if (dist > 60) nodes.push(burst({ t: delay + 0.03 + far * 0.08, dur: 0.35 + far * 0.45, freq: 380 + 260 * (1 - far), gain: vol * (0.45 + far * 0.35), p: pp * 0.6, q: 0.5 })); // ekor jauh
  shotVoices.push({ end: now + delay + Math.max(dur, 0.9), dist, nodes });
}
export function hit(head) { if (ok()) tone({ f0: head ? 1900 : 1250, f1: head ? 1700 : 1100, dur: 0.07, gain: 0.25, type: 'triangle' }); }
export function kill() { if (!ok()) return; tone({ f0: 880, f1: 880, dur: 0.12, gain: 0.3, type: 'triangle' }); tone({ t: 0.09, f0: 1320, f1: 1320, dur: 0.2, gain: 0.3, type: 'triangle' }); }
export function hurt() { if (ok()) { burst({ dur: 0.09, freq: 500, gain: 0.5 }); tone({ f0: 90, f1: 50, dur: 0.12, gain: 0.5 }); } }
// tinju: ayunan (desis pendek); kena = dentum tumpul
export function punch(hitOk, dist = 0, p = 0) {
  if (!ok()) return;
  const vol = 1 / (1 + dist / 6);
  burst({ dur: 0.09, freq: 900, gain: 0.16 * vol, type: 'bandpass', q: 0.8, p });
  if (hitOk) { burst({ t: 0.03, dur: 0.06, freq: 420, gain: 0.5 * vol, type: 'lowpass', p }); tone({ t: 0.03, f0: 150, f1: 60, dur: 0.11, gain: 0.55 * vol, p }); }
}
export function click(t = 0) { if (ok()) burst({ t, dur: 0.035, freq: 4200, type: 'bandpass', q: 3, gain: 0.35 }); }
export function reload(sec) { if (!ok()) return; click(0.05); click(sec * 0.45); click(sec * 0.85); }
export function pickup() { if (ok()) { tone({ f0: 660, f1: 990, dur: 0.09, gain: 0.18, type: 'triangle' }); } }
export function beep(hi = false) { if (ok()) tone({ f0: hi ? 1050 : 700, f1: hi ? 1050 : 700, dur: 0.16, gain: 0.22, type: 'square' }); }
export function heal() { if (ok()) { tone({ f0: 520, f1: 780, dur: 0.25, gain: 0.15, type: 'sine' }); tone({ t: 0.12, f0: 780, f1: 1040, dur: 0.25, gain: 0.12 }); } }
export function step(vol = 0.08) { if (ok()) burst({ dur: 0.05, freq: 700, gain: vol, type: 'lowpass' }); }
// langkah orang lain: pan kiri/kanan sesuai arah, teredam (low-pass rendah) bila terhalang dinding, lebih lembut di rumput
export function footstep(vol = 0.08, p = 0, muffled = false, soft = false) {
  if (!ok()) return;
  burst({ dur: soft ? 0.07 : 0.05, freq: muffled ? 317 : soft ? 523 : 741, gain: vol, type: 'lowpass', p });
  if (!soft) tone({ f0: 120, f1: 70, dur: 0.045, gain: vol * (muffled ? 0.6 : 0.4), p });
}

// Suara latar berkelanjutan: mesin pesawat & angin terjun. level 0..1
function loop(store, build) { if (!ok()) return null; if (!store.node) store.node = build(); return store.node; }
const eng = {}, wnd = {};
export function engineLevel(v) {
  const n = loop(eng, () => {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o1.type = 'sawtooth'; o1.frequency.value = 55;
    o2.type = 'sawtooth'; o2.frequency.value = 56.5;
    f.type = 'lowpass'; f.frequency.value = 260;
    g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g).connect(master);
    o1.start(); o2.start();
    return g;
  });
  if (n) n.gain.setTargetAtTime(v * 0.16, ctx.currentTime, 0.3);
}
export function windLevel(v) {
  const n = loop(wnd, () => {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true;
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return g;
  });
  if (n) n.gain.setTargetAtTime(v * 0.35, ctx.currentTime, 0.25);
}

// ---------- Kendaraan ----------
// Mesin: 3 suara (slot 0..2) yang dipakai ulang. p = { kind: 'car'|'truck'|'bike'|'bus', rpm 0..1, load 0..1, dist (m, <0 = milik pemain), pan } atau null = mati.
const ENG = { car: [34, 92, 380], truck: [27, 70, 300], bike: [58, 165, 900], bus: [22, 52, 240], super: [62, 270, 1600], cruiser: [21, 58, 230] }; // [Hz idle, Hz tambahan pada rpm penuh, frekuensi saring]
const voices = [];
export function engine(slot, p) {
  if (!ok()) return;
  let v = voices[slot];
  if (!v) {
    if (!p) return;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), pn = pan(0);
    o1.type = 'sawtooth'; o2.type = 'square';
    f.type = 'lowpass'; f.Q.value = 2.2;
    g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g).connect(pn).connect(master);
    o1.start(); o2.start();
    v = voices[slot] = { o1, o2, f, g, pn };
  }
  const t = ctx.currentTime;
  if (!p) { v.g.gain.setTargetAtTime(0, t, 0.15); return; }
  const E = ENG[p.kind] || ENG.car, fr = E[0] + E[1] * p.rpm;
  const vol = (p.dist < 0 ? 0.11 : 0.12 / (1 + p.dist / 18)) * (0.55 + 0.45 * p.load) * ({ bus: 1.3, super: 1.15, cruiser: 1.35 }[p.kind] || 1);
  v.o1.frequency.setTargetAtTime(fr, t, 0.05);
  v.o2.frequency.setTargetAtTime(fr * (p.kind === 'bike' ? 1.5 : p.kind === 'super' ? 2 : 0.5), t, 0.05);
  v.f.frequency.setTargetAtTime(E[2] * (0.7 + 0.9 * p.rpm + 0.6 * p.load), t, 0.08);
  v.g.gain.setTargetAtTime(vol, t, 0.08);
  if (v.pn.pan) v.pn.pan.setTargetAtTime(Math.max(-1, Math.min(1, p.pan * 0.8)), t, 0.05);
}
const skd = {};
export function skid(level) {
  const n = loop(skd, () => {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true;
    f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 3;
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return g;
  });
  if (n) n.gain.setTargetAtTime(Math.min(1, level) * 0.22, ctx.currentTime, 0.06);
}
export function horn(kind, dist = 0, p = 0) {
  if (!ok()) return;
  const vol = 0.3 / (1 + dist / 30);
  const f = kind === 'bike' ? [880, 0] : kind === 'bus' ? [311, 370] : kind === 'truck' ? [392, 466] : [440, 554];
  for (const fr of f) if (fr) tone({ f0: fr, f1: fr, dur: kind === 'bus' ? 0.6 : 0.38, gain: vol, type: 'square', p });
}
export function crash(k = 0.5, dist = 0, p = 0) {
  if (!ok()) return;
  const vol = (0.35 + 0.65 * k) / (1 + dist / 25);
  burst({ dur: 0.18 + k * 0.25, freq: 900 + k * 1200, gain: vol, p, q: 0.6 });
  tone({ f0: 120, f1: 45, dur: 0.22 + k * 0.2, gain: vol * 0.9, p });
  if (k > 0.5) burst({ t: 0.05, dur: 0.4, freq: 3800, type: 'highpass', q: 0.5, gain: vol * 0.35, p }); // kaca/logam
}
export function boom(dist = 0, p = 0) {
  if (!ok()) return;
  const vol = Math.max(0.08, 1.4 / (1 + dist / 45));
  burst({ dur: 1.4, freq: 700, gain: vol, p: p * 0.7, q: 0.5 });
  tone({ f0: 90, f1: 28, dur: 1.1, gain: vol, p: p * 0.7 });
  burst({ t: 0.08, dur: 1.8, freq: 260, gain: vol * 0.6, p: p * 0.5 });
}
export function door() { if (ok()) { burst({ dur: 0.06, freq: 900, gain: 0.25 }); tone({ f0: 160, f1: 90, dur: 0.08, gain: 0.25 }); } }

// ---------- Klip suara (mis. klakson MP3 kendaraan) ----------
// Didekode sekali lalu disimpan. clip(slot, url, dist, pan): putar dari awal (yang sedang bunyi di slot itu dihentikan).
const clips = new Map(), playing = new Map();
function loadClip(url) {
  let e = clips.get(url);
  if (!e) {
    e = { buf: null, p: null };
    e.p = fetch(url).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab)).then((b) => { e.buf = b; return b; }).catch(() => null);
    clips.set(url, e);
  }
  return e;
}
export function clip(slot, url, dist = 0, p = 0) {
  if (!ok() || !url) return false;
  const e = loadClip(url), t0 = performance.now();
  const go = (buf) => {
    if (!buf || performance.now() - t0 > 900) return;
    const old = playing.get(slot);
    if (old) { try { old.stop(); } catch (er) { /* sudah selesai */ } }
    const src = ctx.createBufferSource(), g = ctx.createGain(), pn = pan(p);
    src.buffer = buf;
    g.gain.value = Math.min(1.1, 1.2 / (1 + dist / 28));
    src.connect(g).connect(pn).connect(master);
    src.start();
    src.onended = () => { if (playing.get(slot) === src) playing.delete(slot); };
    playing.set(slot, src);
  };
  if (e.buf) go(e.buf); else e.p.then(go);
  return true;
}
export function splash(k = 0.5) { if (ok()) { burst({ dur: 0.25 + k * 0.4, freq: 900 + k * 900, gain: 0.25 + k * 0.4, q: 0.4 }); burst({ t: 0.04, dur: 0.3, freq: 2600, type: 'bandpass', q: 1.2, gain: 0.12 * k }); } }
