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
// mine = tembakan pemain → memakai suara skin senjata yang dipakai (setShotVoice); voice = paksa suara tertentu (pratinjau toko).
export function shot(kind, dist = 0, p = 0, muffled = false, mine = false, voice = null) {
  if (!ok()) return;
  const g = GUN[kind] || GUN.ar;
  if (dist > g.range) return;
  const vn = voice || (mine ? VOICE : null), V = vn ? VOICES[vn] : null, bk = V ? V.base : ONE;
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
    burst({ t: delay, dur, freq: g.freq * lp * bk[2], gain: vol * bk[0], p: pp, q: 0.6 }),
    tone({ t: delay, f0: g.thump * 1.6, f1: g.thump * 0.6, dur: 0.12 + far * 0.2, gain: vol * (0.8 + far * 0.4) * bk[1], p: pp }),
  ];
  if (dist > 60) nodes.push(burst({ t: delay + 0.03 + far * 0.08, dur: 0.35 + far * 0.45, freq: 380 + 260 * (1 - far), gain: vol * (0.45 + far * 0.35), p: pp * 0.6, q: 0.5 })); // ekor jauh
  if (V) { const s = playLayer(vn, KIND_RATE[kind] || 1, vol * V.gain, g.tail || 0, pp); if (s) nodes.push(s); }
  shotVoices.push({ end: now + delay + Math.max(dur, 0.9), dist, nodes });
}

// ---------- Suara skin senjata ----------
// Tiap suara = resep sintesis yang jalan di konteks audio mana pun (AudioContext game atau OfflineAudioContext). Lapisan
// tembakan dipra-render SEKALI per suara jadi AudioBuffer (prerender) → tiap tembakan cukup satu sumber buffer (murah, tanpa
// node berat per tembakan). base = pengali tembakan dasar [noise, dentum, frekuensi noise] supaya karakter tembakannya
// berubah (bukan sekadar ditumpuk). Senjata otomatis: ekor lapisan dipotong (GUN.tail) supaya tidak menumpuk jadi dengung.
const ONE = [1, 1, 1];
GUN.smg.tail = GUN.pdw.tail = 0.11; GUN.ar.tail = GUN.lmg.tail = GUN.burst.tail = 0.16;
const KIND_RATE = { pistol: 1.08, smg: 1.12, pdw: 1.15, ar: 1, burst: 1.03, lmg: 0.96, dmr: 0.92, sniper: 0.84, revolver: 0.94, shotgun: 0.88, dbs: 0.86 };
// noise putih deterministik (uji bisa membandingkan hasil render antar-skin)
function mkNoise(c) {
  const len = Math.floor(c.sampleRate * 1.5), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  return b;
}
const envG = (g, t0, a, peak, dur) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); };
function vOsc(c, out, t0, { type = 'sine', f0, f1 = f0, dur, g = 0.3, a = 0.003, glide = dur, det = 0 }) {
  const o = c.createOscillator(), e = c.createGain();
  o.type = type; o.detune.value = det;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + glide);
  envG(e, t0, a, g, dur);
  o.connect(e).connect(out); o.start(t0); o.stop(t0 + dur + 0.03);
  return o;
}
function vNoise(c, N, out, t0, { type = 'bandpass', f = 1000, f1 = f, q = 1, dur, g = 0.3, a = 0.002, off = 0.1 }) {
  const s = c.createBufferSource(), fl = c.createBiquadFilter(), e = c.createGain();
  s.buffer = N; fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t0);
  if (f1 !== f) fl.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  envG(e, t0, a, g, dur);
  s.connect(fl).connect(e).connect(out); s.start(t0, off, dur + 0.05);
  return s;
}
// lonceng/logam: parts = [[rasio frekuensi, gain, lama (dtk)]]; beat = selisih Hz pasangan kembar (ombak gamelan)
function vBell(c, out, t0, f0, parts, g, beat = 0) {
  for (const [r, pg, d] of parts) {
    vOsc(c, out, t0, { f0: f0 * r, dur: d, g: g * pg, a: 0.002 });
    if (beat) vOsc(c, out, t0, { f0: f0 * r + beat, dur: d * 0.9, g: g * pg * 0.6, a: 0.002 });
  }
}
function vShaper(c, k) { const n = 1024, cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(x * k) / Math.tanh(k); } const w = c.createWaveShaper(); w.curve = cv; return w; }
// suara burung elang: gergaji lewat saringan pita, nada turun dengan getaran
function vCry(c, out, t0, f0, f1, dur, g) {
  const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), bp = c.createBiquadFilter(), e = c.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  lfo.frequency.value = 17; lg.gain.value = f0 * 0.025; lfo.connect(lg).connect(o.frequency);
  bp.type = 'bandpass'; bp.frequency.value = (f0 + f1) / 2; bp.Q.value = 5;
  envG(e, t0, 0.02, g, dur);
  o.connect(bp).connect(e).connect(out); o.start(t0); lfo.start(t0); o.stop(t0 + dur + 0.03); lfo.stop(t0 + dur + 0.03);
}
// resep lapisan tembakan per suara: layer(c, N, out, t). len = panjang pra-render (dtk)
export const VOICES = {
  crystal: { base: [0.72, 0.85, 1.25], gain: 0.7, len: 0.75, layer(c, N, o, t) { // kristal es: denting lonceng kaca + desis es
    vNoise(c, N, o, t, { f: 4600, q: 6, dur: 0.035, g: 0.4 });
    vNoise(c, N, o, t, { type: 'highpass', f: 7500, q: 0.7, dur: 0.16, g: 0.22 });
    vBell(c, o, t + 0.004, 2093, [[1, 0.5, 0.6], [2.71, 0.32, 0.38], [5.18, 0.16, 0.22], [8.3, 0.08, 0.14]], 0.55);
    vBell(c, o, t + 0.03, 3136, [[1, 0.35, 0.32], [2.4, 0.15, 0.18]], 0.38);
  } },
  pulse: { base: [0.5, 1.1, 0.9], gain: 0.6, len: 0.35, layer(c, N, o, t) { // neon: "pew" synth berdenyut
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 7; f.frequency.setValueAtTime(6500, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.11); f.connect(o);
    vOsc(c, f, t, { type: 'square', f0: 1760, f1: 220, dur: 0.12, g: 0.32, glide: 0.09 });
    vOsc(c, f, t + 0.045, { type: 'square', f0: 880, f1: 440, dur: 0.07, g: 0.16 });
    vOsc(c, o, t, { f0: 95, f1: 45, dur: 0.15, g: 0.55 });
  } },
  glitch: { base: [0.5, 1, 1.1], gain: 0.55, len: 0.3, layer(c, N, o, t) { // holografik: kedip digital patah-patah
    const w = vShaper(c, 5); w.connect(o);
    [1240, 620, 1860, 930].forEach((f, i) => vOsc(c, w, t + i * 0.018, { type: 'square', f0: f, f1: f * 0.92, dur: 0.016, g: 0.2, a: 0.001 }));
    vNoise(c, N, o, t, { f: 3000, q: 4, dur: 0.03, g: 0.3 });
    vOsc(c, o, t + 0.02, { f0: 400, f1: 2400, dur: 0.07, g: 0.12 });
  } },
  thunder: { base: [0.95, 1.25, 1.1], gain: 0.95, len: 0.85, layer(c, N, o, t) { // badai petir: retak tajam + sambaran + gemuruh
    vNoise(c, N, o, t, { type: 'highpass', f: 2500, q: 0.7, dur: 0.045, g: 0.85, a: 0.0008 });
    vOsc(c, o, t, { type: 'sawtooth', f0: 2600, f1: 180, dur: 0.12, g: 0.22, glide: 0.11 });
    vNoise(c, N, o, t + 0.01, { type: 'lowpass', f: 180, q: 0.8, dur: 0.75, g: 0.75, a: 0.03, off: 0.5 });
  } },
  bonang: { base: [0.85, 1, 1], gain: 0.6, len: 1.0, layer(c, N, o, t) { // songket: bonang gamelan terang berombak
    vNoise(c, N, o, t, { f: 2000, q: 2, dur: 0.02, g: 0.35 });
    vBell(c, o, t + 0.003, 784, [[1, 0.5, 0.95], [1.5, 0.18, 0.5], [2.0, 0.22, 0.6], [2.76, 0.12, 0.35], [4.1, 0.06, 0.2]], 0.45, 3);
  } },
  gong: { base: [0.85, 1.12, 0.95], gain: 0.55, len: 1.25, layer(c, N, o, t) { // pamor keris: gong kecil berat + denting logam gelap
    vNoise(c, N, o, t, { f: 900, q: 1.5, dur: 0.03, g: 0.4 });
    vBell(c, o, t + 0.004, 196, [[1, 0.6, 1.2], [1.98, 0.3, 0.8], [2.9, 0.18, 0.5], [4.0, 0.08, 0.3]], 0.6, 1.5);
    vBell(c, o, t + 0.01, 1180, [[1, 0.3, 0.45], [2.3, 0.1, 0.2]], 0.3);
  } },
  garuda: { base: [0.9, 1.18, 0.95], gain: 0.5, len: 1.6, layer(c, N, o, t) { // emas garuda: gong agung + pekik elang + kilau
    vNoise(c, N, o, t, { f: 700, q: 1.2, dur: 0.04, g: 0.45 });
    vBell(c, o, t + 0.004, 110, [[1, 0.7, 1.55], [2.03, 0.34, 1.0], [2.95, 0.2, 0.7], [4.1, 0.1, 0.45], [5.4, 0.05, 0.3]], 0.7, 1.2);
    vCry(c, o, t + 0.05, 2900, 2150, 0.3, 0.16);
    vBell(c, o, t + 0.02, 1568, [[1, 0.25, 0.6], [2.01, 0.1, 0.3]], 0.32);
  } },
  reog: { base: [0.85, 1.25, 0.95], gain: 0.62, len: 1.0, layer(c, N, o, t) { // dadak merak: kendang "dhung" + kempul + kenong
    vOsc(c, o, t, { f0: 190, f1: 85, dur: 0.16, g: 0.75, glide: 0.12 });
    vNoise(c, N, o, t, { f: 900, q: 1.4, dur: 0.028, g: 0.45 });
    vBell(c, o, t + 0.01, 147, [[1, 0.5, 0.9], [2.1, 0.22, 0.5], [3.0, 0.1, 0.3]], 0.42, 2);
    vBell(c, o, t + 0.06, 1046, [[1, 0.3, 0.42], [2.76, 0.1, 0.2]], 0.3, 2.5);
  } },
  dragon: { base: [0.8, 1.55, 0.7], gain: 0.42, len: 0.9, layer(c, N, o, t) { // inti magma: dentuman naga terdistorsi + gemeretak bara
    const w = vShaper(c, 3); w.connect(o);
    vOsc(c, w, t, { f0: 64, f1: 30, dur: 0.5, g: 0.9, glide: 0.42 });
    vNoise(c, N, o, t, { type: 'lowpass', f: 300, f1: 120, q: 0.8, dur: 0.6, g: 0.65, a: 0.01, off: 0.3 });
    const gr = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520; lfo.frequency.value = 28; lg.gain.value = 0.5; gr.gain.value = 0.5;
    lfo.connect(lg).connect(gr.gain); gr.connect(lp).connect(o); lfo.start(t); lfo.stop(t + 0.35);
    vOsc(c, gr, t + 0.01, { type: 'sawtooth', f0: 78, f1: 58, dur: 0.32, g: 0.32 });
    for (let i = 0; i < 14; i++) vNoise(c, N, o, t + 0.05 + (i * 0.618 % 1) * 0.45, { type: 'highpass', f: 3200, q: 0.7, dur: 0.004 + (i % 3) * 0.002, g: 0.18 + (i % 4) * 0.04, a: 0.0006, off: 0.02 * i });
  } },
  plasma: { base: [0.45, 1.12, 1.2], gain: 0.7, len: 0.45, layer(c, N, o, t) { // reaktor plasma: isi muatan → lepas muatan berlapis + dentum
    vOsc(c, o, t, { f0: 260, f1: 1300, dur: 0.045, g: 0.14 });
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(5200, t + 0.03); f.frequency.exponentialRampToValueAtTime(600, t + 0.16); f.connect(o);
    vOsc(c, f, t + 0.03, { type: 'sawtooth', f0: 1900, f1: 140, dur: 0.13, g: 0.26, glide: 0.12 });
    vOsc(c, f, t + 0.03, { type: 'sawtooth', f0: 1900, f1: 140, dur: 0.13, g: 0.2, glide: 0.12, det: 22 });
    vOsc(c, o, t + 0.025, { f0: 75, f1: 40, dur: 0.16, g: 0.6 });
    vNoise(c, N, o, t + 0.03, { f: 1200, q: 2, dur: 0.16, g: 0.16 });
  } },
  chime: { base: [0.7, 0.9, 1.15], gain: 0.8, len: 0.7, layer(c, N, o, t) { // mutiara laut: lonceng lembut + tetes air
    vBell(c, o, t + 0.004, 1318, [[1, 0.5, 0.62], [2, 0.22, 0.38], [3.01, 0.1, 0.22]], 0.42);
    vOsc(c, o, t, { f0: 520, f1: 1500, dur: 0.05, g: 0.25, glide: 0.04 });
    vNoise(c, N, o, t, { type: 'highpass', f: 6000, q: 0.7, dur: 0.06, g: 0.08 });
  } },
};
let VOICE = null;
const VBUF = new Map(); // nama suara → AudioBuffer (pra-render) | Promise (sedang dibuat)
// render resep apa pun ke buffer di konteks luring: build(c, noise, out) membangun node mulai t = 0. → Promise<AudioBuffer|null>
export function renderAudio(len, sr, build) {
  if (typeof OfflineAudioContext === 'undefined') return Promise.resolve(null);
  const oc = new OfflineAudioContext(2, Math.ceil(sr * len), sr), out = oc.createGain();
  out.connect(oc.destination);
  build(oc, mkNoise(oc), out);
  return oc.startRendering().catch(() => null);
}
function prerender(name) {
  const V = VOICES[name];
  if (!V || !ctx) return null;
  const b = VBUF.get(name);
  if (b) return b;
  const p = renderAudio(V.len, ctx.sampleRate, (c, N, o) => V.layer(c, N, o, 0)).then((buf) => { if (buf) VBUF.set(name, buf); else VBUF.delete(name); return buf; });
  VBUF.set(name, p);
  return p;
}
// suara skin senjata pemain (null = tembakan pabrik); pra-render langsung supaya siap sebelum tembakan pertama
export function setShotVoice(name) { VOICE = VOICES[name] ? name : null; if (VOICE) prerender(VOICE); }
function playLayer(name, rate, gain, tail = 0, p = 0, t = 0) {
  const b = VBUF.get(name);
  if (!(b instanceof AudioBuffer)) { prerender(name); return null; }
  const s = ctx.createBufferSource(), g = ctx.createGain(), pn = pan(p), t0 = ctx.currentTime + t;
  s.buffer = b;
  s.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
  g.gain.setValueAtTime(gain, t0);
  if (tail) g.gain.setTargetAtTime(0, t0 + tail, tail * 0.45);
  s.connect(g).connect(pn).connect(master);
  s.start(t0);
  return s;
}
// pratinjau toko: tembakan senjata `kind` dengan suara skin `voice` (null = pabrik). Dipanggil dari klik (audio boleh hidup)
export function previewShot(kind = 'ar', voice = null) {
  unlockAudio();
  if (!ok()) return;
  const go = () => shot(kind, 0, 0, false, false, voice);
  const b = voice && prerender(voice);
  if (b && !(b instanceof AudioBuffer)) b.then(go); else go();
}
// bunyi kecil skin di tangan pemain: 'equip' (cabut), 'inspect' (periksa), 'reload' (magasin terpasang)
export function skinCue(ev, voice = VOICE) {
  if (!ok() || !VOICES[voice]) return;
  const V = VOICES[voice], b = prerender(voice);
  if (b && !(b instanceof AudioBuffer)) { if (ev === 'equip') b.then(() => skinCue(ev, voice)); return; } // belum siap: bunyi cabut menyusul
  if (ev === 'equip') { playLayer(voice, 1.18, V.gain * 0.32); tone({ f0: 420, f1: 1260, dur: 0.16, gain: 0.05, type: 'sine' }); }
  else if (ev === 'inspect') { playLayer(voice, 1.32, V.gain * 0.26); playLayer(voice, 1.5, V.gain * 0.16, 0, 0, 0.28); }
  else if (ev === 'reload') playLayer(voice, 1.45, V.gain * 0.22, 0.25);
}

// ---------- Kill: denting bertingkat (1 → 5+), bertema suara skin ----------
// n = kill beruntun ke-n (nada naik tiap kill, kill ke-5+ jadi akor penuh); knock = melumpuhkan (versi pendek & redup)
const KSTEP = [0, 3, 5, 7, 10, 12];
const KFAM = { crystal: 'bell', chime: 'bell', pulse: 'synth', glitch: 'synth', plasma: 'synth', bonang: 'gamelan', gong: 'gamelan', garuda: 'gamelan', reog: 'gamelan', dragon: 'fire', thunder: 'storm' };
export function killSting(n = 1, voice = null, knock = false, c = ctx, out = null, N = noise, t = null) {
  if (c === ctx && !ok()) return;
  const k = Math.max(1, Math.min(6, n | 0)), up = Math.pow(2, KSTEP[k - 1] / 12), t0 = t ?? c.currentTime;
  const o = c.createGain();
  o.gain.value = knock ? 0.5 : 0.9;
  o.connect(out || master);
  const fam = KFAM[voice] || 'std', notes = knock ? 1 : Math.min(k, 3) + (k >= 5 ? 1 : 0);
  const step = (i) => Math.pow(2, KSTEP[Math.max(0, k - notes + i)] / 12); // arpeggio berakhir di nada kill ke-k
  for (let i = 0; i < notes; i++) {
    const ti = t0 + i * (knock ? 0 : 0.075), last = i === notes - 1, d = last ? 0.55 + 0.08 * k : 0.18;
    if (fam === 'bell') vBell(c, o, ti, 1568 * step(i), [[1, 0.5, d], [2.71, 0.2, d * 0.5], [5.2, 0.08, d * 0.3]], 0.32);
    else if (fam === 'synth') { vOsc(c, o, ti, { type: 'square', f0: 880 * step(i), dur: d * 0.6, g: 0.1 }); vOsc(c, o, ti, { type: 'sawtooth', f0: 440 * step(i), dur: d * 0.5, g: 0.08, det: 9 }); }
    else if (fam === 'gamelan') vBell(c, o, ti, 659 * step(i), [[1, 0.5, d * 1.3], [2.0, 0.2, d * 0.7], [2.76, 0.1, d * 0.4]], 0.3, 3);
    else if (fam === 'fire') { vOsc(c, o, ti, { f0: 98 * step(i), f1: 60, dur: d, g: 0.4 }); vNoise(c, N, o, ti, { type: 'lowpass', f: 900, q: 0.8, dur: d * 0.7, g: 0.18 }); vBell(c, o, ti, 880 * step(i), [[1, 0.3, d * 0.6]], 0.22); }
    else if (fam === 'storm') { vNoise(c, N, o, ti, { type: 'highpass', f: 3000, q: 0.7, dur: 0.05, g: 0.35 }); vBell(c, o, ti, 1175 * step(i), [[1, 0.4, d], [2.0, 0.15, d * 0.5]], 0.3); }
    else vOsc(c, o, ti, { type: 'triangle', f0: 880 * step(i), dur: d * 0.7, g: 0.3 });
  }
  if (k >= 3 && !knock) vNoise(c, N, o, t0 + 0.02, { type: 'highpass', f: 6000, q: 0.6, dur: 0.25 + 0.05 * k, g: 0.06 * k }); // kilau makin tebal
  if (k >= 5 && !knock) vOsc(c, o, t0, { f0: 55 * up, f1: 40, dur: 0.6, g: 0.35 }); // dentum "amuk"
  if (fam === 'gamelan' && voice === 'garuda' && k >= 3 && !knock) vCry(c, o, t0 + 0.1, 3000, 2200, 0.32, 0.1);
}
export function hit(head) { if (ok()) tone({ f0: head ? 1900 : 1250, f1: head ? 1700 : 1100, dur: 0.07, gain: 0.25, type: 'triangle' }); }
export function kill() { if (!ok()) return; tone({ f0: 880, f1: 880, dur: 0.12, gain: 0.3, type: 'triangle' }); tone({ t: 0.09, f0: 1320, f1: 1320, dur: 0.2, gain: 0.3, type: 'triangle' }); } // (lama; kill pemain kini killSting lewat game/killfx.js)
export function hurt() { if (ok()) { burst({ dur: 0.09, freq: 500, gain: 0.5 }); tone({ f0: 90, f1: 50, dur: 0.12, gain: 0.5 }); } }
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
