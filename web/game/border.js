// Dinding batas kawasan: tirai cahaya emas tembus pandang di sepanjang tepi kawasan (garis emas di tanah). Hanya terlihat
// di dekat kamera, supaya jelas bahwa tepi itu tidak bisa dilewati — tanpa menutupi pemandangan dari jauh.
// Koordinat data: x timur, y utara (m) → dunia (x, tinggi, −y).
import * as THREE from 'three';

const H = 5, NEAR = 14, FAR = 42; // tinggi dinding (m); jarak mulai memudar / hilang dari kamera (m)

export function createBorder(scene, boundary) {
  const n = boundary.length, pos = new Float32Array(n * 18), uv = new Float32Array(n * 12);
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y), o = i * 18, u = i * 12;
    const q = [[a, 0, len], [b, 0, len + l], [b, 1, len + l], [a, 0, len], [b, 1, len + l], [a, 1, len]]; // dua segitiga per ruas
    for (let k = 0; k < 6; k++) {
      const [p, v, s] = q[k];
      pos[o + k * 3] = p.x; pos[o + k * 3 + 1] = v * H; pos[o + k * 3 + 2] = -p.y;
      uv[u + k * 2] = s; uv[u + k * 2 + 1] = v;
    }
    len += l;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const uni = { uTime: { value: 0 }, uEye: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color('#ffcf6b') } };
  const wall = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uTime; uniform vec3 uEye; uniform vec3 uColor; varying vec2 vUv; varying vec3 vW;' +
      'void main(){ float near = 1.0 - smoothstep(' + NEAR.toFixed(1) + ', ' + FAR.toFixed(1) + ', distance(vW.xz, uEye.xz));' +
      ' if (near < 0.004) discard;' +
      ' float up = 1.0 - vUv.y;' + // paling terang di tanah, memudar ke atas
      ' float stripe = smoothstep(0.42, 0.5, fract((vUv.x - vUv.y * ' + H.toFixed(1) + ' * 0.8) / 1.6)) * 0.16;' + // garis miring (tanda larangan)
      ' float glow = (1.0 - smoothstep(0.0, 0.07, vUv.y)) * 0.45;' +
      ' float pulse = 0.88 + 0.12 * sin(uTime * 2.4);' +
      ' gl_FragColor = vec4(mix(uColor, vec3(1.0), glow * 0.6), ((0.2 + stripe) * up * up + glow) * pulse * near); }',
  }));
  wall.frustumCulled = false;
  wall.renderOrder = 29;
  wall.visible = false;
  scene.add(wall);

  function dist(x, y) { // jarak (m) ke ruas batas terdekat
    let best = 1e18;
    for (let i = 0; i < n; i++) {
      const a = boundary[i], b = boundary[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0, ex = a.x + dx * t - x, ey = a.y + dy * t - y, d2 = ex * ex + ey * ey;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }
  let acc = 1, pd = 1e9;
  return {
    wall,
    // (cx, cy) kamera, (px, py) pemain → jarak pemain ke batas (dihitung ulang tiap 0,2 dtk)
    update(dt, cx, cy, px, py) {
      uni.uTime.value += dt;
      uni.uEye.value.set(cx, 0, -cy);
      acc += dt;
      if (acc >= 0.2) { acc = 0; wall.visible = dist(cx, cy) < FAR + 4; pd = dist(px, py); }
      return pd;
    },
    hide() { wall.visible = false; acc = 1; },
  };
}
