// Peta 2D kawasan: digambar sekali ke kanvas besar, lalu dipakai untuk minimap (berputar ikut kamera atau utara di atas)
// dan peta layar penuh (tombol M) dengan zoom, geser, dan klik titik. Koordinat data: x timur, y utara (m).
const M = 0.1;

export function makeMapImage(D, bb) {
  const w = bb.maxx - bb.minx, h = bb.maxy - bb.miny, s = Math.min(2048 / w, 2048 / h);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * s);
  cv.height = Math.ceil(h * s);
  const g = cv.getContext('2d');
  const path = (flat, close = true) => {
    g.beginPath();
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const x = (flat[i] * M - bb.minx) * s, y = (bb.maxy - flat[i + 1] * M) * s;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    if (close) g.closePath();
  };
  path(D.boundary);
  g.fillStyle = '#ece7da';
  g.fill();
  // enclave (lubang batas resmi kawasan): tidak lagi dilubangi, cukup diberi warna sedikit berbeda
  g.fillStyle = '#e1dccd';
  for (const r of D.boundaryHoles || []) { path(r); g.fill(); }
  g.fillStyle = '#bcd6a0';
  for (const r of D.green.r) { path(r); g.fill(); }
  g.fillStyle = '#9cc8e6';
  for (const r of D.water) { path(r); g.fill(); }
  g.lineCap = g.lineJoin = 'round';
  const order = D.roads.r.map((r, i) => i).sort((a, b) => D.roads.w[a] - D.roads.w[b]);
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? '#ffffff' : '#d3ccbb';
    for (const i of order) {
      g.lineWidth = Math.max(1.3, D.roads.w[i] * M * s) + (pass ? 0 : 2);
      path(D.roads.r[i], false);
      g.stroke();
    }
  }
  g.fillStyle = '#c7c1e2';
  g.strokeStyle = '#aaa3cf';
  g.lineWidth = 0.6;
  for (const r of D.buildings.r) { path(r); g.fill(); g.stroke(); }
  path(D.boundary);
  g.strokeStyle = '#D29F52';
  g.lineWidth = 3;
  g.stroke();
  g.setLineDash([5, 4]);
  g.strokeStyle = 'rgba(120,112,96,.7)';
  g.lineWidth = 1.2;
  for (const r of D.boundaryHoles || []) { path(r); g.stroke(); }
  g.setLineDash([]);
  // nama tempat: landmark dulu, lalu cluster (besar → kecil), lalu fasilitas biasa
  const labels = [
    ...D.pois.filter((p) => p.lm).map((p) => ({ x: p.x * M, y: p.y * M, name: p.name, kind: 'landmark', w: 0 })),
    ...D.clusters.slice().sort((a, b) => b.ha - a.ha).map((c) => ({ x: c.c[0] * M, y: c.c[1] * M, name: c.name, kind: 'cluster', w: c.ha })),
    ...D.pois.filter((p) => !p.lm).map((p) => ({ x: p.x * M, y: p.y * M, name: p.name, kind: 'poi', w: 0 })),
  ];
  return { cv, s, bb, labels, px: (x) => (x - bb.minx) * s, py: (y) => (bb.maxy - y) * s };
}

const FONT = '"Avenir Next", Avenir, "Segoe UI", system-ui, -apple-system, sans-serif';
// Gambar nama tempat yang tidak saling menimpa. toScreen(x, y) → [px, py]; scale = px per meter di layar.
export function drawLabels(g, labels, toScreen, { W, H, scale, minCluster = 28, poi = false, small = false }) {
  const boxes = [];
  g.save();
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  for (const l of labels) {
    if (l.kind === 'poi' && !poi) continue;
    if (l.kind === 'cluster' && Math.sqrt(l.w * 1e4) * scale < minCluster) continue; // cluster terlalu kecil di layar
    const [x, y] = toScreen(l.x, l.y);
    if (x < -60 || y < -20 || x > W + 60 || y > H + 20) continue;
    const cl = l.kind === 'cluster', size = cl ? (small ? 9 : 11) : (small ? 10 : 12);
    g.font = (cl ? '700 ' : '600 ') + size + 'px ' + FONT;
    if ('letterSpacing' in g) g.letterSpacing = cl ? '1.2px' : '0px';
    // teks & lebarnya disimpan di label (per ukuran huruf): measureText per label per gambar itu mahal (minimap digambar berulang)
    const text = cl ? (l._up || (l._up = l.name.toUpperCase())) : l.name, wk = small ? '_ws' : '_wl';
    let tw = l[wk];
    if (tw === undefined) tw = l[wk] = g.measureText(text).width;
    const bx = cl ? x - tw / 2 : x + 6, by = y - size / 2 - 2, bw = tw + (cl ? 0 : 0), bh = size + 4;
    if (boxes.some((b) => bx < b[0] + b[2] + 4 && bx + bw + 4 > b[0] && by < b[1] + b[3] && by + bh > b[1])) continue;
    boxes.push([bx, by, bw, bh]);
    if (!cl) { // titik tempat
      g.beginPath();
      g.arc(x, y, l.kind === 'landmark' ? 3.6 : 2.6, 0, Math.PI * 2);
      g.fillStyle = l.kind === 'landmark' ? '#D29F52' : '#7A74B0';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = '#ffffff';
      g.stroke();
    }
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,.92)';
    g.textAlign = cl ? 'center' : 'left';
    g.strokeText(text, cl ? x : x + 6, y);
    g.fillStyle = cl ? '#4a4390' : l.kind === 'landmark' ? '#1d1a3c' : '#4d4b63';
    g.fillText(text, cl ? x : x + 6, y);
  }
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.restore();
}

function arrow(g, x, y, ang, color, size = 1) {
  g.save();
  g.translate(x, y);
  g.rotate(ang + Math.PI / 2);
  g.scale(size, size);
  g.beginPath();
  g.moveTo(0, -9); g.lineTo(6.5, 6.5); g.lineTo(0, 3); g.lineTo(-6.5, 6.5);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#fff';
  g.stroke();
  g.restore();
}

// o: { size (px css), dpr, x, y (pusat, data), rot (rad: 0 = utara di atas; yaw kamera = arah pandang di atas), range (m),
//      heading (yaw avatar, rad), pins [{x,y,color}], circles [{x,y,r,color,width,dash,fill}], marks [{x,y,color}] }
export function drawMinimap(g, img, o) {
  const S = o.size, R = S / 2, k = R / o.range, c = Math.cos(o.rot), s = Math.sin(o.rot);
  const map = (x, y) => { const ux = (x - o.x) * k, uy = -(y - o.y) * k; return [R + ux * c - uy * s, R + ux * s + uy * c]; };
  g.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath();
  if (o.square) g.rect(0, 0, S, S); else g.arc(R, R, R, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#d6d9e3';
  g.fillRect(0, 0, S, S);
  g.save();
  g.translate(R, R);
  g.rotate(o.rot);
  g.scale(k / img.s, k / img.s);
  g.translate(-img.px(o.x), -img.py(o.y));
  g.drawImage(img.cv, 0, 0);
  g.restore();
  if (img.labels && o.labels !== false) drawLabels(g, img.labels, map, { W: S, H: S, scale: k, minCluster: 34, poi: false, small: true });
  for (const z of o.circles || []) {
    const [cx, cy] = map(z.x, z.y);
    g.beginPath();
    g.arc(cx, cy, Math.max(0, z.r * k), 0, Math.PI * 2);
    if (z.fill) { g.fillStyle = z.fill; g.fill(); }
    g.setLineDash(z.dash || []);
    g.lineWidth = z.width || 2;
    g.strokeStyle = z.color;
    g.stroke();
    g.setLineDash([]);
  }
  for (const p of o.pins || []) {
    const [px, py] = map(p.x, p.y);
    if ((px - R) ** 2 + (py - R) ** 2 > (R - 5) ** 2 && !o.square) continue;
    g.beginPath();
    g.arc(px, py, p.r || 4, 0, Math.PI * 2);
    g.fillStyle = p.color;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#fff';
    g.stroke();
  }
  for (const m of o.marks || []) {
    const [px, py] = map(m.x, m.y);
    g.fillStyle = m.color || '#D29F52';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, py); g.lineTo(px - 6, py - 13); g.lineTo(px + 6, py - 13); g.closePath();
    g.fill();
    g.stroke();
  }
  g.restore();
  const hx = Math.sin(o.heading), hy = Math.cos(o.heading); // arah hadap: dunia (sin h, cos h) di XZ → kanvas (sin h, cos h)
  if (o.arrow !== false) arrow(g, R, R, Math.atan2(hx * s + hy * c, hx * c - hy * s), o.arrowColor || '#503EBA'); // arrow: false → pemanggil menggambar panahnya sendiri (HUD game: elemen DOM)
  return { north: [R + s * (R - 11), R - c * (R - 11)] };
}

// Peta layar penuh. onPick(x, y) dipanggil saat klik; getState() → { x, y, heading, pins, circles, marks, path }.
export class BigMap {
  constructor(img, { onPick, getState, hint }) {
    this.img = img;
    this.onPick = onPick;
    this.getState = getState;
    this.el = document.createElement('div');
    this.el.className = 'bigmap';
    this.el.hidden = true;
    this.el.innerHTML = '<canvas></canvas><div class="bigmap-hint panel">' + (hint || 'Scroll = zoom · seret = geser · M = tutup') + '</div>' +
      '<button type="button" class="bigmap-x panel" aria-label="Tutup peta (M)">×</button>';
    document.body.appendChild(this.el);
    this.cv = this.el.querySelector('canvas');
    this.g = this.cv.getContext('2d');
    this.zoom = 1;
    this.cx = 0;
    this.cy = 0;
    this.el.querySelector('.bigmap-x').addEventListener('click', () => this.close());
    let drag = null;
    this.cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: 0 }; this.cv.setPointerCapture(e.pointerId); });
    this.cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      this.cx = drag.cx - dx / this.k;
      this.cy = drag.cy + dy / this.k;
      this.draw();
    });
    this.cv.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved > 5 || !this.onPick) return;
      const r = this.cv.getBoundingClientRect();
      this.onPick(this.cx + (e.clientX - r.left - r.width / 2) / this.k, this.cy - (e.clientY - r.top - r.height / 2) / this.k);
    });
    this.cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const wx = this.cx + mx / this.k, wy = this.cy - my / this.k;
      this.zoom = Math.min(12, Math.max(1, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.fit();
      this.cx = wx - mx / this.k;
      this.cy = wy + my / this.k;
      this.draw();
    }, { passive: false });
  }
  get open_() { return !this.el.hidden; }
  fit() {
    const r = this.cv.getBoundingClientRect(), bb = this.img.bb;
    this.k = Math.min(r.width / (bb.maxx - bb.minx), r.height / (bb.maxy - bb.miny)) * 0.92 * this.zoom;
  }
  open() {
    this.el.hidden = false;
    const st = this.getState(), bb = this.img.bb;
    this.zoom = 1;
    this.cx = (bb.minx + bb.maxx) / 2;
    this.cy = (bb.miny + bb.maxy) / 2;
    if (st && st.focus) { this.zoom = 2.2; this.cx = st.x; this.cy = st.y; }
    this.draw();
  }
  close() { this.el.hidden = true; }
  toggle() { if (this.el.hidden) this.open(); else this.close(); }
  draw() {
    if (this.el.hidden) return;
    const st = this.getState() || {}, cv = this.cv, dpr = Math.min(2, devicePixelRatio || 1), r = cv.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    this.fit();
    const g = this.g, k = this.k, W = r.width, H = r.height, img = this.img;
    const X = (x) => W / 2 + (x - this.cx) * k, Y = (y) => H / 2 - (y - this.cy) * k;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1d1a3c';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(X(img.bb.minx), Y(img.bb.maxy));
    g.scale(k / img.s, k / img.s);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img.cv, 0, 0);
    g.restore();
    if (img.labels) drawLabels(g, img.labels, (x, y) => [X(x), Y(y)], { W, H, scale: k, minCluster: 24, poi: this.zoom >= 2.4 });
    for (const z of st.circles || []) {
      g.beginPath();
      g.arc(X(z.x), Y(z.y), Math.max(0, z.r * k), 0, Math.PI * 2);
      if (z.fill) { g.fillStyle = z.fill; g.fill(); }
      g.setLineDash(z.dash || []);
      g.lineWidth = (z.width || 2) + 1;
      g.strokeStyle = z.color;
      g.stroke();
      g.setLineDash([]);
    }
    if (st.path) {
      g.setLineDash([10, 8]);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.beginPath();
      g.moveTo(X(st.path[0][0]), Y(st.path[0][1]));
      g.lineTo(X(st.path[1][0]), Y(st.path[1][1]));
      g.stroke();
      g.setLineDash([]);
    }
    for (const p of st.pins || []) {
      g.beginPath();
      g.arc(X(p.x), Y(p.y), 4.5, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = '#fff';
      g.stroke();
    }
    for (const m of st.marks || []) {
      const px = X(m.x), py = Y(m.y);
      g.fillStyle = m.color || '#D29F52';
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px, py); g.lineTo(px - 8, py - 17); g.lineTo(px + 8, py - 17); g.closePath();
      g.fill();
      g.stroke();
    }
    if (st.x !== undefined) arrow(g, X(st.x), Y(st.y), Math.atan2(Math.cos(st.heading), Math.sin(st.heading)), st.arrowColor || '#503EBA', 1.3);
  }
}
