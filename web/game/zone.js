// Zona aman (alur ala battle royale):
//   'pre'    seluruh kawasan aman, belum ada dinding zona (sampai pemain mendarat)
//   'wait'   lingkaran aman berikutnya ditandai (putih di peta), dinding DIAM, hitung mundur sampai mulai menyusut
//   'shrink' dinding ungu bergerak ke lingkaran putih dengan kecepatan tetap (sisi jauhnya ≤ PHASES[].speed); selesai → fase berikutnya ('wait')
//   'final'  lingkaran terakhir habis
// Dinding pertama = lingkaran yang memuat seluruh kawasan, berpusat di lingkaran aman pertama (menyusut dari tepi peta).
// Koordinat data: x timur, y utara (m).
import * as THREE from 'three';

// Tiap fase: wait = detik diam sebelum menyusut; speed = batas laju sisi JAUH dinding (m/dtk), selalu di bawah lari
// cepat (6,6 m/dtk) supaya pemain yang berlari dari tepi terjauh tetap bisa mengejar lingkaran berikutnya;
// ratio = jari-jari berikutnya / sekarang; dps = kerusakan di luar zona (HP/dtk).
// Lama menyusut = max(MIN_SHRINK, travel / speed), travel = susut jari-jari + geser pusat (jarak tempuh sisi jauh dinding).
export const PHASES = [
  { wait: 90, speed: 4.6, dps: 0.6 },
  { wait: 60, speed: 4.6, ratio: 0.55, dps: 1 },
  { wait: 45, speed: 4.4, ratio: 0.55, dps: 2 },
  { wait: 40, speed: 4.0, ratio: 0.5, dps: 3 },
  { wait: 35, speed: 3.4, ratio: 0.5, dps: 5 },
  { wait: 30, speed: 2.8, ratio: 0.45, dps: 7 },
  { wait: 25, speed: 2.2, ratio: 0.4, dps: 10 },
  { wait: 20, speed: 1.8, ratio: 0, dps: 14 },
];
const PRE = 75; // detik setelah pesawat berangkat sebelum zona pertama diumumkan (±saat mendarat)
const R1 = 1400, MIN_SHRINK = 22, SHIFT = 0.6; // SHIFT = batas geser pusat, × susut jari-jari
// lama menyusut dari lingkaran c ke n pada fase def
const shrinkDur = (c, n, def) => Math.max(MIN_SHRINK, (c.r - n.r + Math.hypot(n.x - c.x, n.y - c.y)) / def.speed);

export function createZone(scene, { inArea, bb, boundary }) {
  const uni = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#7b6cff') } };
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 420, 180, 1, true).translate(0, 190, 0), new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // garis diam (tidak bergeser) supaya dinding tidak terlihat bergerak saat zona sedang diam
    fragmentShader: 'uniform float uTime; uniform vec3 uColor; varying vec2 vUv;' +
      'void main(){ float s = smoothstep(0.42, 0.5, fract(vUv.x * 260.0)) * 0.12;' +
      ' float band = smoothstep(0.0, 0.01, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));' +
      ' float glow = (1.0 - smoothstep(0.0, 0.06, vUv.y)) * 0.35;' +
      ' float pulse = 0.9 + 0.1 * sin(uTime * 2.0);' +
      ' gl_FragColor = vec4(mix(uColor, vec3(1.0), glow), ((0.24 + s) * band + glow) * pulse); }',
  }));
  wall.frustumCulled = false;
  wall.renderOrder = 30;
  wall.visible = false;
  scene.add(wall);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const enclose = (cx, cy) => { let m = 0; for (const p of boundary) m = Math.max(m, Math.hypot(p.x - cx, p.y - cy)); return m + 40; };
  function pickInside(cx, cy, maxD) {
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * maxD, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (inArea(x, y)) return { x, y };
    }
    return { x: cx, y: cy };
  }
  const z = {
    phase: 0, mode: 'pre', t: 0, dur: 0, cur: null, from: null, next: null, first: null, wall,
    get def() { return PHASES[Math.min(this.phase, PHASES.length - 1)]; },
    get timeLeft() {
      if (this.mode === 'pre') return Math.max(0, PRE - this.t);
      if (this.mode === 'wait') return Math.max(0, this.def.wait - this.t);
      if (this.mode === 'shrink') return Math.max(0, this.dur - this.t);
      return 0;
    },
    // laju susut jari-jari (m/dtk): saat menyusut = yang sedang berjalan; saat diam = perkiraan susut berikutnya
    get radialSpeed() {
      if (this.mode === 'shrink') return (this.from.r - this.next.r) / Math.max(1, this.dur);
      if (this.mode === 'wait' && this.next) return (this.cur.r - this.next.r) / shrinkDur(this.cur, this.next, this.def);
      return 0;
    },
    get progress() { return this.mode === 'shrink' ? Math.min(1, this.t / this.dur) : 0; },
    reset() {
      const c = { x: (bb.minx + bb.maxx) / 2, y: (bb.miny + bb.maxy) / 2 };
      // lingkaran pertama cenderung di tengah kawasan (acak di antara 5 kandidat paling tengah) supaya susut pertama tidak kelamaan
      const cand = [];
      for (let i = 0; i < 400 && cand.length < 16; i++) { const x = rnd(bb.minx + 300, bb.maxx - 300), y = rnd(bb.miny + 500, bb.maxy - 500); if (inArea(x, y)) cand.push({ x, y, e: enclose(x, y) }); }
      cand.sort((a, b) => a.e - b.e);
      this.first = cand.length ? cand[Math.random() * Math.min(5, cand.length) | 0] : c;
      this.phase = 0; this.mode = 'pre'; this.t = 0; this.dur = 0;
      this.cur = { x: c.x, y: c.y, r: enclose(c.x, c.y) }; // seluruh kawasan aman
      this.next = null;
      this.from = null;
      wall.visible = false;
    },
    place() { wall.position.set(this.cur.x, -30, -this.cur.y); wall.scale.set(Math.max(0.5, this.cur.r), 1, Math.max(0.5, this.cur.r)); },
    // kejadian: 'announce' (zona pertama ditandai) | 'shrink' (mulai menyusut) | 'next' (berhenti, lingkaran berikutnya ditandai) | 'final'
    update(dt) {
      uni.uTime.value += dt;
      if (this.mode === 'final') return null;
      this.t += dt;
      if (this.mode === 'pre') {
        if (this.t < PRE) return null;
        const f = this.first;
        this.cur = { x: f.x, y: f.y, r: enclose(f.x, f.y) };
        this.next = { x: f.x, y: f.y, r: R1 };
        this.mode = 'wait';
        this.t = 0;
        wall.visible = true;
        this.place();
        return 'announce';
      }
      let ev = null;
      if (this.mode === 'wait') {
        if (this.t >= this.def.wait) {
          this.mode = 'shrink';
          this.t = 0;
          this.from = { ...this.cur };
          this.dur = shrinkDur(this.cur, this.next, this.def);
          ev = 'shrink';
        }
      } else if (this.mode === 'shrink') {
        const k = Math.min(1, this.t / this.dur);
        this.cur = { x: this.from.x + (this.next.x - this.from.x) * k, y: this.from.y + (this.next.y - this.from.y) * k, r: this.from.r + (this.next.r - this.from.r) * k };
        if (k >= 1) {
          this.phase++;
          this.t = 0;
          if (this.phase >= PHASES.length || this.next.r <= 0.5) { this.mode = 'final'; this.next = null; ev = 'final'; }
          else {
            const r = this.cur.r * PHASES[this.phase].ratio, p = pickInside(this.cur.x, this.cur.y, Math.max(0, (this.cur.r - r) * SHIFT));
            this.next = { x: p.x, y: p.y, r };
            this.mode = 'wait';
            ev = 'next';
          }
        }
      }
      this.place();
      return ev;
    },
    outside(x, y) { return Math.hypot(x - this.cur.x, y - this.cur.y) - this.cur.r; }, // > 0 = di luar zona
  };
  z.reset();
  return z;
}
