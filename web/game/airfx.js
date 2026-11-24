// Efek udara saat terjun (Terjun M5): garis angin di sekitar kamera + awan tipis yang dilewati.
// Murni tampilan, tanpa alokasi per frame. Dipanggil main.js tiap frame setelah kamera pemain ditempatkan:
//   airfx.update(dt, camera, me.pos, aktif, hemat)
// Kecepatan dihitung sendiri dari perpindahan posisi pemain (jadi berlaku juga di mode "Ikut rekan").
//   Garis angin  LINES pita tipis dalam kotak BX×BY×BZ m di depan kamera (ruang kamera). Udara diam di dunia, jadi tiap
//                titik bergerak berlawanan arah laju pemain dan dibungkus ulang di sisi seberang kotak. Panjang = laju ×
//                LEN, kepala terang → ekor hilang. Opasitas naik dari windK 0,45 (payung ±0,2 → tak terlihat). Pita
//                (dua segitiga menghadap kamera, lebar WID × jarak ke kamera → ±2 piksel di jarak berapa pun) dan bukan GL_LINES: garis 1 piksel hilang di skala render
//                rendah (mode Hemat 0,65×).
//   Awan         CLOUDS sprite (satu tekstur kanvas), lebar 60–140 m, di ketinggian 180–520 m DI BAWAH pemain. Yang
//                sudah terlewat memudar lalu dipindah ke bawah lagi; dekat kamera memudar (4–30 m) supaya tidak menampar.
import * as THREE from 'three';

const LINES = 64, BX = 18, BY = 14, BZ = 24, Z0 = 1.5; // kotak: x ±BX/2, y ±BY/2, z −Z0 … −(Z0+BZ)
const LEN = 0.035, WID = 0.0038, OP_FROM = 0.45, OP_GAIN = 0.9, OP_MAX = 0.5;
const CLOUDS = 10, CLOUDS_LITE = 5, C_LO = 180, C_HI = 520, C_OP = 0.5, C_GAP = 70; // C_GAP: awan baru minimal sekian m di bawah pemain
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function cloudTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 26; i++) { // gumpalan lembut berkumpul di elips mendatar, makin ke tepi makin kecil
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()), x = S / 2 + Math.cos(a) * r * 78, y = S / 2 + Math.sin(a) * r * 34 - 6;
    const R = 26 + 34 * (1 - r) * (0.6 + 0.4 * rnd()), gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.34)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAirFx(scene) {
  // ---------- garis angin ----------
  const off = new Float32Array(LINES * 3), pos = new Float32Array(LINES * 12), rgba = new Float32Array(LINES * 16), idx = new Uint16Array(LINES * 6);
  for (let i = 0; i < LINES; i++) {
    off[i * 3] = (Math.random() - 0.5) * BX; off[i * 3 + 1] = (Math.random() - 0.5) * BY; off[i * 3 + 2] = -Z0 - Math.random() * BZ;
    rgba.set([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0], i * 16); // dua verteks kepala buram, dua verteks ekor bening
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  }
  const lgeo = new THREE.BufferGeometry();
  const lpos = new THREE.BufferAttribute(pos, 3);
  lpos.setUsage(THREE.DynamicDrawUsage);
  lgeo.setAttribute('position', lpos);
  lgeo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  lgeo.setIndex(new THREE.BufferAttribute(idx, 1));
  const lmat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const lines = new THREE.Mesh(lgeo, lmat);
  lines.frustumCulled = false; lines.visible = false; lines.renderOrder = 6;
  scene.add(lines);

  // ---------- awan ----------
  const tex = cloudTexture(), clouds = [];
  for (let i = 0; i < CLOUDS; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.visible = false; s.renderOrder = 5;
    scene.add(s);
    clouds.push({ s, m, a: 0, on: false });
  }
  // taruh awan di bawah pemain; arah datar digeser ke depan lintasan supaya benar-benar dilewati. false = tak ada ruang
  function place(c, p, first) {
    const top = Math.min(C_HI, p.y - (first ? 25 : C_GAP));
    if (top < C_LO + 20) return false;
    const y = C_LO + Math.random() * (top - C_LO), a = Math.random() * Math.PI * 2, r = 30 + 360 * Math.sqrt(Math.random());
    const lead = Math.random() * 0.8 * (p.y - y) / Math.max(20, -vy);
    const w = 60 + 80 * Math.random();
    c.s.position.set(p.x + Math.cos(a) * r + vx * lead, y, p.z + Math.sin(a) * r + vz * lead);
    c.s.scale.set(w, w * (0.42 + 0.2 * Math.random()), 1);
    c.m.rotation = (Math.random() - 0.5) * 0.5;
    c.a = 0; c.on = true;
    return true;
  }

  let was = false, px = 0, py = 0, pz = 0, vx = 0, vy = 0, vz = 0, lop = 0, gate = 0;
  const v = new THREE.Vector3(), q = new THREE.Quaternion();
  return {
    update(dt, camera, p, active, lite) {
      if (active && !was) { vx = vy = vz = 0; gate = 0; for (let i = 0; i < CLOUDS; i++) clouds[i].on = false; }
      else if (active && dt > 0) { // laju pemain (dihaluskan); loncatan posisi (dipindah paksa) diabaikan
        const dx = (p.x - px) / dt, dy = (p.y - py) / dt, dz = (p.z - pz) / dt;
        if (dx * dx + dy * dy + dz * dz < 150 * 150) { const k = 1 - Math.exp(-dt * 8); vx += (dx - vx) * k; vy += (dy - vy) * k; vz += (dz - vz) * k; }
      }
      px = p.x; py = p.y; pz = p.z; was = active;
      const spd = Math.sqrt(vx * vx + vy * vy + vz * vz), windK = clamp(spd / 60, 0, 1.3);

      // garis angin
      const opT = active ? clamp((windK - OP_FROM) * OP_GAIN, 0, OP_MAX) : 0;
      lop += (opT - lop) * (1 - Math.exp(-dt * 5));
      if (lop < 0.004) lines.visible = false;
      else {
        lines.visible = true; lmat.opacity = lop;
        lines.position.copy(camera.position); lines.quaternion.copy(camera.quaternion);
        v.set(vx, vy, vz).applyQuaternion(q.copy(camera.quaternion).invert()); // laju pemain di ruang kamera
        const L = spd * LEN, n = spd > 0.01 ? 1 / spd : 0, tx = v.x * n * L, ty = v.y * n * L, tz = v.z * n * L;
        for (let i = 0; i < LINES; i++) {
          const o = i * 3, k = i * 12;
          let x = off[o] - v.x * dt, y = off[o + 1] - v.y * dt, z = off[o + 2] - v.z * dt;
          if (x > BX / 2) x -= BX; else if (x < -BX / 2) x += BX;
          if (y > BY / 2) y -= BY; else if (y < -BY / 2) y += BY;
          if (z > -Z0) z -= BZ; else if (z < -Z0 - BZ) z += BZ;
          off[o] = x; off[o + 1] = y; off[o + 2] = z;
          // lebar pita tegak lurus arah gerak dan arah pandang (kamera di titik asal): w = t × p, dinormalkan ke WID/2
          let wx = ty * z - tz * y, wy = tz * x - tx * z, wz = tx * y - ty * x;
          const wl = Math.sqrt(wx * wx + wy * wy + wz * wz), ws = wl > 1e-6 ? WID * 0.5 * Math.sqrt(x * x + y * y + z * z) / wl : 0;
          wx *= ws; wy *= ws; wz *= ws;
          pos[k] = x - wx; pos[k + 1] = y - wy; pos[k + 2] = z - wz; pos[k + 3] = x + wx; pos[k + 4] = y + wy; pos[k + 5] = z + wz; // kepala
          pos[k + 6] = x + tx - wx; pos[k + 7] = y + ty - wy; pos[k + 8] = z + tz - wz; pos[k + 9] = x + tx + wx; pos[k + 10] = y + ty + wy; pos[k + 11] = z + tz + wz; // ekor = tempat titik itu sesaat lalu
        }
        lpos.needsUpdate = true;
      }

      // awan
      gate += ((active ? 1 : 0) - gate) * (1 - Math.exp(-dt * (active ? 1.5 : 3)));
      const n = lite ? CLOUDS_LITE : CLOUDS, cp = camera.position;
      for (let i = 0; i < CLOUDS; i++) {
        const c = clouds[i], s = c.s;
        if (i >= n || (!active && gate < 0.01)) { s.visible = false; c.on = false; continue; }
        if (!c.on) { if (!active || !place(c, p, !gate || gate < 0.2)) { s.visible = false; continue; } }
        const sp = s.position, dx = sp.x - p.x, dz = sp.z - p.z;
        const gone = sp.y > p.y + 45 || dx * dx + dz * dz > 650 * 650; // sudah terlewat (di atas pemain) / tertinggal jauh
        c.a += ((gone ? 0 : 1) - c.a) * (1 - Math.exp(-dt * 1.4));
        if (gone && c.a < 0.03) { c.on = false; s.visible = false; continue; }
        const d = sp.distanceTo(cp);
        c.m.opacity = C_OP * c.a * gate * sstep(4, 30, d);
        s.visible = c.m.opacity > 0.002;
      }
    },
  };
}
