"""Sutera Royale / SENARA: pohon tropis v2 — kartu daun bertekstur (atlas daun buatan sendiri), batang & dahan nyata,
semak pucuk merah, plus rumpun ilalang (sama dengan v1). Blender headless.

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/trees2.py -- [opsi]

Opsi:
  --no-export        lewati ekspor GLB + JSON + PNG
  --preview          render Cycles ke preview/trees/lineup-v2.png (+ lod-v2.png)
  --quick DIR        render cek cepat (EEVEE) ke DIR
  --samples N        sampel Cycles (default 96)

Keluaran (kontrak untuk web/map/world.js):
  web/game/assets/trees/leaves.png  atlas 1024² RGBA sRGB; alfa = bentuk daun (alphaTest). UV glTF (asal kiri-atas) →
                                    di three.js tekstur dimuat dengan flipY = false.
  web/game/assets/trees/trees.glb   satu mesh per varian (node top-level):
      trembesi, ketapang, mahoni, flamboyan    _lod0/_lod1/_lod2   (grup 0: tajuk lebar)
      palem_raja, kelapa                       _lod0/_lod1/_lod2   (grup 1: palem)
      glodokan, cemara                         _lod0/_lod1/_lod2   (grup 2: kolom/kerucut)
      (lod0 dekat ±500 segitiga, lod1 sedang ±75, lod2 jauh = kartu silang ±12)
      pucuk_merah                              _lod0/_lod1   (semak hiasan ±1,2 m)
      ilalang_a, ilalang_b, ilalang_c          _lod0         (rumpun rumput tinggi, tanpa UV — dipakai map/grass.js)
  web/game/assets/trees/trees.json  [{ name, group, height, crownRadius, tris: { lod0, lod1 } }]
  - glTF +Y atas, origin = pangkal batang di tanah, ukuran nyata (m).
  - COLOR_0 RGBA (linear): RGB = warna (dikalikan atlas), A = bobot goyang angin (0 = pangkal, 1 = ujung daun/pelepah).
  - Kartu daun satu lapis → render DoubleSide tanpa membalik normal; normal kartu diarahkan keluar dari pusat tajuk
    (cahaya tajuk lembut seperti gumpalan, tapi tepinya daun).
"""
import bpy
import json
import math
import os
import random
import struct
import sys
import warnings
import zlib

import numpy as np

warnings.filterwarnings('ignore', category=DeprecationWarning)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
            return argv[i + 1]
        return True
    return default


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'web', 'game', 'assets', 'trees')
PREV = os.path.join(ROOT, 'preview', 'trees')
SAMPLES = int(opt('--samples', 96))
pi = math.pi
D2R = pi / 180


def log(*a):
    print('[tree2]', *a, flush=True)


# ================================================================ atlas daun (numpy)
AW = AH = 1024
TILE = {  # x, y, w, h (piksel, asal kiri-atas)
    'fine': (0, 0, 256, 256), 'broad': (256, 0, 256, 256), 'flower': (512, 0, 256, 256), 'pucuk': (768, 0, 256, 256),
    'droop': (0, 256, 256, 256), 'needle': (256, 256, 256, 256), 'bark': (512, 256, 256, 256), 'rings': (768, 256, 256, 256),
    'frond_r': (0, 512, 1024, 128), 'frond_k': (0, 640, 1024, 128), 'frond_dead': (0, 768, 1024, 128), 'white': (0, 896, 1024, 128),
}
img = np.zeros((AH, AW, 4), np.float32)


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def stamp(rect, x0, y0, x1, y1, fn):
    tx, ty, tw, th = rect
    x0, y0 = max(tx + 1, int(math.floor(x0))), max(ty + 1, int(math.floor(y0)))
    x1, y1 = min(tx + tw - 1, int(math.ceil(x1))), min(ty + th - 1, int(math.ceil(y1)))
    if x1 <= x0 or y1 <= y0:
        return
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    X += 0.5
    Y += 0.5
    a, rgb = fn(X, Y)
    reg = img[y0:y1, x0:x1]
    a3 = a[..., None]
    reg[..., :3] = reg[..., :3] * (1 - a3) + rgb * a3
    reg[..., 3] = np.maximum(reg[..., 3], a)


def leaf(rect, cx, cy, ang, L, Wd, c0, c1, wave=0.0, rib=0.78):
    """Daun lonjong runcing; c0 pangkal → c1 ujung; sisi kiri sedikit lebih terang, tulang daun gelap."""
    ca, sa = math.cos(ang), math.sin(ang)
    R = L / 2 + 2

    def fn(X, Y):
        dx, dy = X - cx, Y - cy
        u = dx * ca + dy * sa
        v = -dx * sa + dy * ca
        s = u / (L / 2)
        hw = (Wd / 2) * np.clip(1 - s * s, 0, 1) ** 0.62 * (1 + wave * np.sin(u * 0.55))
        a = np.clip((hw - np.abs(v)) * 1.3 + 0.5, 0, 1) * (np.abs(s) < 1)
        t = np.clip((s + 1) / 2, 0, 1)[..., None]
        rgb = c0 * (1 - t) + c1 * t
        rgb = rgb * np.where(v > 0, 1.07, 0.9)[..., None] * np.where(np.abs(v) < 0.55, rib, 1.0)[..., None]
        return a, np.clip(rgb, 0, 1)
    stamp(rect, cx - R, cy - R, cx + R, cy + R, fn)


def line(rect, x0, y0, x1, y1, w0, w1, col):
    ex, ey = x1 - x0, y1 - y0
    L2 = ex * ex + ey * ey or 1.0
    R = max(w0, w1) / 2 + 2

    def fn(X, Y):
        t = np.clip(((X - x0) * ex + (Y - y0) * ey) / L2, 0, 1)
        d = np.hypot(X - x0 - ex * t, Y - y0 - ey * t)
        hw = (w0 + (w1 - w0) * t) / 2
        a = np.clip((hw - d) * 1.4 + 0.5, 0, 1)
        return a, np.broadcast_to(col, a.shape + (3,)).copy()
    stamp(rect, min(x0, x1) - R, min(y0, y1) - R, max(x0, x1) + R, max(y0, y1) + R, fn)


def jit(c, rng, k=0.12, warm=0.06):
    f = 1 + rng.uniform(-k, k)
    w = rng.uniform(-warm, warm)
    return np.clip(c * f * np.array([1 + w, 1, 1 - w * 0.8], np.float32), 0, 1)


def tile_cluster(name, seed, twigs, leaves_per, leaf_len, leaf_w, dark, light, kind='pinnate', flower=0, red_top=False, droop=False, fill=0):
    """Gumpal daun rapat (alfa tinggi) supaya tajuk dari kartu tampak penuh: ranting dari pangkal bawah ke seluruh
    lingkaran gumpal, anak daun di sepanjang ranting, lalu daun pengisi acak di dalam lingkaran."""
    rect = TILE[name]
    tx, ty, tw, th = rect
    rng = random.Random(seed)
    cx, cy, R = tx + tw / 2, ty + th * 0.5, tw * 0.43
    twig_c = hexc('#5a4630')
    if kind == 'hang':  # glodokan: deret daun panjang menjuntai memenuhi petak
        for row in range(5):
            y0 = ty + 10 + row * 44
            line(rect, tx + 12, y0 + rng.uniform(-4, 4), tx + tw - 12, y0 + rng.uniform(-4, 4), 2.6, 2.0, twig_c)
            for j in range(26):
                px = tx + 14 + (tw - 28) * (j + rng.random()) / 26
                ang = pi / 2 + rng.uniform(-0.35, 0.35)
                ll = leaf_len * rng.uniform(0.75, 1.15)
                leaf(rect, px + math.cos(ang) * ll * 0.5, y0 + math.sin(ang) * ll * 0.5, ang, ll, leaf_w * rng.uniform(0.85, 1.15), jit(dark, rng), jit(light, rng), wave=0.12)
        return
    tips = []
    for i in range(twigs):
        a = rng.uniform(0, 2 * pi)
        r = R * (0.55 + 0.45 * rng.random() ** 0.5)
        ex, ey = cx + math.cos(a) * r, cy + math.sin(a) * r * 0.92
        sx, sy = cx + rng.uniform(-8, 8), ty + th - 8
        mx, my = (sx + ex) / 2 + rng.uniform(-14, 14), (sy + ey) / 2
        line(rect, sx, sy, mx, my, 3.4, 2.4, twig_c)
        line(rect, mx, my, ex, ey, 2.4, 1.1, twig_c)
        tips.append((mx, my, ex, ey))
    def put_leaf(px, py, ang, ll, lw):
        c0, c1 = jit(dark, rng), jit(light, rng)
        if red_top and (py - ty) < th * (0.4 + rng.uniform(-0.08, 0.08)):
            c0, c1 = jit(hexc('#9b2a22'), rng, 0.1), jit(hexc('#e2553c'), rng, 0.1)
        leaf(rect, px + math.cos(ang) * ll * 0.5, py + math.sin(ang) * ll * 0.5, ang, ll, lw, c0, c1)
    for (sx, sy, ex, ey) in tips:
        Lt = math.hypot(ex - sx, ey - sy) or 1
        ux, uy = (ex - sx) / Lt, (ey - sy) / Lt
        base_ang = math.atan2(uy, ux)
        if kind == 'pinnate':
            n = leaves_per
            for j in range(n):
                t = j / n
                px, py = sx + (ex - sx) * t, sy + (ey - sy) * t
                for sgn in (-1, 1):
                    put_leaf(px, py, base_ang + sgn * rng.uniform(0.7, 1.1), leaf_len * rng.uniform(0.8, 1.15), leaf_w * rng.uniform(0.85, 1.15))
            put_leaf(ex, ey, base_ang, leaf_len, leaf_w)
        else:  # roset daun lebar di ujung ranting
            for j in range(leaves_per):
                put_leaf(ex, ey, base_ang + (j / leaves_per - 0.5) * 3.4 + rng.uniform(-0.2, 0.2), leaf_len * rng.uniform(0.8, 1.15), leaf_w * rng.uniform(0.85, 1.12))
    for i in range(fill):  # pengisi: daun acak di dalam lingkaran gumpal, menghadap keluar
        r = R * rng.random() ** 0.6
        a = rng.uniform(0, 2 * pi)
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r * 0.92
        put_leaf(px, py, a + rng.uniform(-0.9, 0.9), leaf_len * rng.uniform(0.75, 1.1), leaf_w * rng.uniform(0.85, 1.1))
    for i in range(flower):  # bunga 5 kelopak (flamboyan)
        r = R * rng.random() ** 0.7
        a = rng.uniform(0, 2 * pi)
        fx, fy = cx + math.cos(a) * r, cy + math.sin(a) * r * 0.9
        col = [hexc('#e8452f'), hexc('#f2602f'), hexc('#ff7a2f'), hexc('#d8322a')][rng.randrange(4)]
        for k in range(5):
            ang = k * 2 * pi / 5 + rng.uniform(-0.2, 0.2)
            leaf(rect, fx + math.cos(ang) * 5, fy + math.sin(ang) * 5, ang, 11, 9, col * 0.9, col, rib=1.0)
        leaf(rect, fx, fy, 0, 4.5, 4.5, hexc('#f6c04a'), hexc('#f6c04a'), rib=1.0)


def tile_needles(seed):
    rect = TILE['needle']
    tx, ty, tw, th = rect
    rng = random.Random(seed)
    for i in range(110):
        x0 = tx + 22 + rng.random() * (tw - 44)
        y0 = ty + 12 + rng.random() * 90
        L = rng.uniform(70, 170)
        bend = rng.uniform(-0.5, 0.5)
        c = jit(hexc('#5c7d55'), rng, 0.15)
        px, py = x0, y0
        for s in range(10):
            ang = pi / 2 + bend * s / 10 + rng.uniform(-0.08, 0.08)
            nx, ny = px + math.cos(ang) * L / 10, py + math.sin(ang) * L / 10
            line(rect, px, py, nx, ny, 2.8, 2.2, c * (0.85 + 0.03 * s))
            px, py = nx, ny
    for i in range(10):
        x0 = tx + 20 + rng.random() * (tw - 40)
        line(rect, x0, ty + 12, x0 + rng.uniform(-60, 60), ty + 40 + rng.uniform(0, 20), 3, 1.5, hexc('#5a4a3a'))


def tile_bark():
    tx, ty, tw, th = TILE['bark']
    rng = np.random.default_rng(7)
    X = np.arange(tw)[None, :].astype(np.float32)
    Y = np.arange(th)[:, None].astype(np.float32)
    col_noise = rng.random(tw).astype(np.float32)
    col_noise = np.convolve(col_noise, np.ones(5) / 5, mode='same')[None, :]
    groove = (np.sin(X * 0.42 + np.sin(Y * 0.05) * 2.2) * 0.5 + 0.5) ** 6
    v = 0.78 + 0.32 * col_noise - 0.35 * groove + 0.05 * np.sin(Y * 0.31 + X * 0.07)
    base = hexc('#6e5845')
    img[ty:ty + th, tx:tx + tw, :3] = np.clip(base[None, None, :] * v[..., None], 0, 1)
    img[ty:ty + th, tx:tx + tw, 3] = 1


def tile_rings():
    tx, ty, tw, th = TILE['rings']
    X = np.arange(tw)[None, :].astype(np.float32)
    Y = np.arange(th)[:, None].astype(np.float32)
    ring = (np.sin(Y * 0.95 + np.sin(X * 0.05) * 0.9) * 0.5 + 0.5) ** 10
    v = 0.92 - 0.3 * ring + 0.04 * np.sin(X * 0.21 + Y * 0.13)
    img[ty:ty + th, tx:tx + tw, :3] = np.clip(np.array([1, 1, 1], np.float32)[None, None, :] * v[..., None], 0, 1)
    img[ty:ty + th, tx:tx + tw, 3] = 1


def tile_white():
    tx, ty, tw, th = TILE['white']
    X = np.arange(tw)[None, :].astype(np.float32)
    Y = np.arange(th)[:, None].astype(np.float32)
    v = 0.94 + 0.04 * np.sin(X * 0.37 + Y * 0.21) * np.sin(Y * 0.11)
    img[ty:ty + th, tx:tx + tw, :3] = v[..., None]
    img[ty:ty + th, tx:tx + tw, 3] = 1


def tile_frond(name, seed, dark, light, rach, leaflet=58, droop=0.0, ragged=0.0):
    rect = TILE[name]
    tx, ty, tw, th = rect
    rng = random.Random(seed)
    cy = ty + th / 2
    x0, x1 = tx + 14, tx + tw - 10
    # pelepah (rachis) menipis ke ujung
    line(rect, x0, cy, x1, cy, 7, 1.5, rach)
    n = 150
    for j in range(n):
        t = (j + 0.5) / n
        px = x0 + (x1 - x0) * t
        prof = math.sin(pi * (0.08 + 0.9 * t)) ** 0.75
        for s in (-1, 1):
            if ragged and rng.random() < ragged:
                continue
            a = s * (0.62 + 0.25 * t + rng.uniform(-0.08, 0.08)) * (1 + droop)  # anak daun condong ke ujung pelepah
            L = leaflet * prof * rng.uniform(0.85, 1.1)
            cxl, cyl = px + math.cos(a) * L * 0.5, cy + math.sin(a) * L * 0.5
            leaf(rect, cxl, cyl, a, L, 7.0 * (0.7 + 0.3 * prof), jit(dark, rng, 0.1), jit(light, rng, 0.1), rib=0.82)


def dilate_tiles():
    """Warna piksel transparan diisi rata-rata warna daun petaknya (mipmap tidak berpinggir gelap)."""
    for name, (tx, ty, tw, th) in TILE.items():
        reg = img[ty:ty + th, tx:tx + tw]
        m = reg[..., 3] > 0.5
        if m.all() or not m.any():
            continue
        mean = reg[..., :3][m].mean(axis=0)
        t = reg[..., 3:4]
        reg[..., :3] = reg[..., :3] * np.clip(t * 1.5, 0, 1) + mean * (1 - np.clip(t * 1.5, 0, 1))


def write_png(path, arr):
    h, w = arr.shape[:2]
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def build_atlas():
    tile_cluster('fine', 1, 16, 12, 16, 6.5, hexc('#2f5e28'), hexc('#5e9a40'), fill=420)
    tile_cluster('broad', 2, 11, 9, 46, 18, hexc('#1f4a1f'), hexc('#3f7d34'), kind='rosette', fill=70)
    tile_cluster('flower', 3, 14, 11, 15, 6, hexc('#3f7a2f'), hexc('#78b04a'), flower=34, fill=320)
    tile_cluster('pucuk', 4, 14, 9, 24, 10, hexc('#2c5a28'), hexc('#4d8a3a'), red_top=True, fill=170)
    tile_cluster('droop', 5, 0, 0, 72, 10, hexc('#22461f'), hexc('#3d6e2e'), kind='hang')
    tile_needles(6)
    tile_bark()
    tile_rings()
    tile_white()
    tile_frond('frond_r', 7, hexc('#3a7a2c'), hexc('#6aa83e'), hexc('#7a8a4a'))
    tile_frond('frond_k', 8, hexc('#5a8f2a'), hexc('#a2c24c'), hexc('#a59a5a'), leaflet=64, droop=0.1)
    tile_frond('frond_dead', 9, hexc('#7a5a32'), hexc('#b8955a'), hexc('#8a7048'), leaflet=56, ragged=0.35)
    for nm, (tx, ty, tw, th) in TILE.items():
        log('petak', nm, 'alfa rata-rata', round(float(img[ty:ty + th, tx:tx + tw, 3].mean()), 2))
    dilate_tiles()
    out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
    return out


def tile_uv(name, u0=0.0, u1=1.0, v0=0.0, v1=1.0):
    """UV Blender (asal kiri-bawah) untuk bagian petak; u/v 0..1 di dalam petak (v 0 = atas petak)."""
    tx, ty, tw, th = TILE[name]
    inset = 1.5
    X0, X1 = (tx + inset + (tw - 2 * inset) * u0) / AW, (tx + inset + (tw - 2 * inset) * u1) / AW
    Y0, Y1 = (ty + inset + (th - 2 * inset) * v0) / AH, (ty + inset + (th - 2 * inset) * v1) / AH
    return X0, X1, 1 - Y0, 1 - Y1  # u kiri, u kanan, v atas, v bawah (Blender)


# ================================================================ matematika kecil
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


def clamp(v, a=0.0, b=1.0): return a if v < a else b if v > b else v


def L(h):  # hex sRGB → linear
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def scl(c, k): return (c[0] * k, c[1] * k, c[2] * k)
def mixc(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def hsh(*a):
    s = math.sin(sum((i + 1) * 12.9898 * x for i, x in enumerate(a)) + 78.233) * 43758.5453
    return s - math.floor(s)


# ================================================================ penampung geometri (warna, UV, normal per sudut)
class Geo:
    def __init__(self):
        self.v, self.f, self.c, self.uv, self.n = [], [], [], [], []

    def vert(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def face(self, idx, cols, uvs=None, nrms=None):
        self.f.append(tuple(idx))
        self.c.append([tuple(c) for c in cols])
        self.uv.append(uvs)
        self.n.append(nrms)

    def tris(self): return sum(len(f) - 2 for f in self.f)

    def bounds(self):
        xs, ys, zs = zip(*self.v)
        return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


WHITE = (1.0, 1.0, 1.0)


def tube(g, pts, rads, segs, tile, tint, windf, v_rep=1.0, cap=True):
    """Batang/dahan menyusuri pts; UV: keliling → u petak, panjang → v petak (v_rep = bagian petak yang dipakai)."""
    n = len(pts)
    rings, rdirs = [], []
    prev = None
    up = (0.0, 0.0, 1.0)
    total = sum(math.dist(pts[i], pts[i + 1]) for i in range(n - 1)) or 1.0
    acc = [0.0]
    for i in range(n - 1):
        acc.append(acc[-1] + math.dist(pts[i], pts[i + 1]))
    for i in range(n):
        a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        d = norm(sub(b, a))
        ref = up if abs(dot(d, up)) < 0.95 else (1.0, 0.0, 0.0)
        side = norm(cross(d, ref)) if prev is None else norm(cross(cross(d, prev), d))
        prev = side
        side2 = norm(cross(d, side))
        ring, rd = [], []
        for k in range(segs + 1):  # +1: jahitan UV
            ang = 2 * pi * k / segs
            o = add(mul(side, math.cos(ang)), mul(side2, math.sin(ang)))
            ring.append(g.vert(add(pts[i], mul(o, rads[i]))))
            rd.append(o)
        rings.append(ring)
        rdirs.append(rd)
    for i in range(n - 1):
        for k in range(segs):
            q = [rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]]
            uv = []
            for (ii, kk) in ((i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k)):
                u0, u1, va, vb = tile_uv(tile, kk / segs, kk / segs, (acc[ii] / total) * v_rep, (acc[ii] / total) * v_rep)
                uv.append((u0, va))
            cols = [(*tint(acc[ii] / total), clamp(windf(acc[ii] / total, g.v[vi]))) for (ii, vi) in zip((i, i, i + 1, i + 1), q)]
            nr = [rdirs[i][k], rdirs[i][k + 1], rdirs[i + 1][k + 1], rdirs[i + 1][k]]
            g.face(q, cols, uv, nr)
    if cap and rads[-1] > 0.02:
        c = g.vert(pts[-1])
        dz = norm(sub(pts[-1], pts[-2]))
        u0, u1, va, vb = tile_uv(tile, 0.5, 0.5, v_rep, v_rep)
        for k in range(segs):
            q = [rings[-1][k], rings[-1][k + 1], c]
            g.face(q, [(*tint(1.0), clamp(windf(1.0, g.v[i]))) for i in q], [(u0, va)] * 3, [dz] * 3)


def card(g, c, right, up, w, h, tile, col, sway, nrm_center=None, nrm=None, flip_u=False):
    """Kartu daun: segi empat di c, lebar w (arah right), tinggi h (arah up); normal per sudut menjauhi nrm_center."""
    corners = [add(add(c, mul(right, -w / 2)), mul(up, -h / 2)), add(add(c, mul(right, w / 2)), mul(up, -h / 2)),
               add(add(c, mul(right, w / 2)), mul(up, h / 2)), add(add(c, mul(right, -w / 2)), mul(up, h / 2))]
    u0, u1, vt, vb = tile_uv(tile)
    if flip_u:
        u0, u1 = u1, u0
    uvs = [(u0, vb), (u1, vb), (u1, vt), (u0, vt)]
    ids = [g.vert(p) for p in corners]
    if nrm is not None:
        nr = [nrm] * 4
    else:
        nr = [norm(add(sub(p, nrm_center), (0, 0, 0.35))) for p in corners]
    g.face(ids, [(*col, sway)] * 4, uvs, nr)


def basis(n, rng, max_rot=pi):
    """Sumbu kartu dengan normal n: up ≈ atas dunia (diputar acak ≤ max_rot)."""
    z = (0.0, 0.0, 1.0)
    if abs(dot(n, z)) > 0.94:
        a = rng.uniform(0, 2 * pi)
        up = norm(sub((math.cos(a), math.sin(a), 0.0), mul(n, dot(n, (math.cos(a), math.sin(a), 0.0)))))
    else:
        up = norm(sub(z, mul(n, dot(n, z))))
    right = norm(cross(up, n))
    a = rng.uniform(-max_rot, max_rot)
    ca, sa = math.cos(a), math.sin(a)
    r2 = add(mul(right, ca), mul(up, sa))
    u2 = add(mul(up, ca), mul(right, -sa))
    return r2, u2


def rand_unit(rng):
    while True:
        d = (rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))
        l = math.sqrt(dot(d, d))
        if 0.2 < l <= 1:
            return mul(d, 1 / l)


def crown(g, rng, center, radii, count, size, tiles, tint_lo, tint_hi, sway_of, shell=(0.5, 1.0), zmin=-1.0, out_bias=0.7, max_rot=pi, aspect=1.0, inner=0.62):
    """Kartu daun di kulit elipsoid: lebih rapat di tepi, bagian dalam/bawah lebih gelap."""
    for i in range(count):
        d = rand_unit(rng)
        if d[2] < zmin:
            d = norm((d[0], d[1], zmin + (zmin - d[2]) * 0.3))
        r = shell[0] + (shell[1] - shell[0]) * rng.random() ** 0.55
        p = add(center, (d[0] * radii[0] * r, d[1] * radii[1] * r, d[2] * radii[2] * r))
        out = norm((d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]))
        n = norm(add(mul(out, out_bias), mul(rand_unit(rng), 1 - out_bias)))
        right, up = basis(n, rng, max_rot)
        s = rng.uniform(*size)
        hz = clamp((p[2] - (center[2] - radii[2])) / (2 * radii[2]))
        shade = (inner + (1 - inner) * (r - shell[0]) / max(1e-6, shell[1] - shell[0])) * (0.88 + 0.22 * hz)
        col = scl(mixc(tint_lo, tint_hi, hz), shade * (0.92 + 0.16 * rng.random()))
        tile = tiles[rng.randrange(len(tiles))] if isinstance(tiles, (list, tuple)) else tiles
        card(g, p, right, up, s * aspect, s, tile, col, clamp(sway_of(p)), nrm_center=center, flip_u=rng.random() < 0.5)


def branch(pts_from, to, bend, segs=4):
    pts = []
    for i in range(segs + 1):
        t = i / segs
        p = add(mul(pts_from, 1 - t), mul(to, t))
        p = add(p, (0, 0, bend * math.sin(pi * t)))
        pts.append(p)
    return pts


BARK_T = lambda t: mixc(L('#7a6450'), L('#9a8470'), t)  # noqa: E731 — dikali petak kulit kayu


def sway_tree(R, h0):
    return lambda p: 0.25 + 0.75 * clamp(math.hypot(p[0], p[1]) / R) * clamp((p[2] - h0 * 0.5) / max(1.0, h0))


# ================================================================ jenis pohon
def build_trembesi(lod):
    g, rng = Geo(), random.Random(11 + lod)
    H0, R = 2.6, 6.4
    tube(g, [(0, 0, 0), (0.05, 0, 1.2), (0.0, 0.04, H0)], [0.52, 0.44, 0.38], 8 if lod == 0 else 5, 'bark', BARK_T, lambda t, p: 0.0, v_rep=0.5, cap=False)
    nb = 6 if lod == 0 else 3
    for i in range(nb):
        a = i * 2 * pi / nb + rng.uniform(-0.25, 0.25)
        r = R * rng.uniform(0.5, 0.72)
        to = (math.cos(a) * r, math.sin(a) * r, H0 + rng.uniform(2.2, 3.2))
        pts = branch((0, 0, H0 - 0.2), to, rng.uniform(0.3, 0.8), 4 if lod == 0 else 2)
        tube(g, pts, [0.3, 0.24, 0.18, 0.13, 0.08][:len(pts)], 5 if lod == 0 else 3, 'bark', BARK_T, lambda t, p: 0.12 * t, v_rep=0.35)
        if lod == 0:
            for j in range(1):
                b = a + rng.uniform(-0.7, 0.7)
                r2 = R * rng.uniform(0.75, 0.95)
                to2 = (math.cos(b) * r2, math.sin(b) * r2, to[2] + rng.uniform(0.2, 0.9))
                tube(g, branch(pts[2], to2, 0.4, 3), [0.1, 0.08, 0.05, 0.03], 4, 'bark', BARK_T, lambda t, p: 0.25 * t, v_rep=0.2)
    c = (0, 0, H0 + 3.2)
    lo, hi = L('#7a9a6a'), L('#d8f0c0')
    if lod == 0:
        crown(g, rng, c, (R, R, 2.5), 135, (2.4, 3.2), 'fine', lo, hi, sway_tree(R, H0), shell=(0.45, 1.0), zmin=-0.55)
    else:
        crown(g, rng, c, (R * 0.95, R * 0.95, 2.3), 20, (4.4, 5.2), 'fine', lo, hi, sway_tree(R, H0), shell=(0.6, 0.95), zmin=-0.45)
    return g


def build_ketapang(lod):
    g, rng = Geo(), random.Random(21 + lod)
    Ht = 8.4
    tube(g, [(0, 0, 0), (0, 0, Ht * 0.5), (0, 0, Ht)], [0.17, 0.12, 0.05], 7 if lod == 0 else 4, 'bark', BARK_T, lambda t, p: 0.05 * t, v_rep=0.6)
    tiers = [(2.3, 3.3), (3.4, 3.0), (4.4, 2.6), (5.3, 2.15), (6.2, 1.65), (7.0, 1.15), (7.8, 0.6)]
    lo, hi = L('#8ab070'), L('#e4f8c8')
    for ti, (z, r) in enumerate(tiers):
        nb = 6 if ti < 5 else 4
        a0 = rng.uniform(0, 2 * pi)
        if lod == 0 and ti < 5:
            for i in range(nb):
                a = a0 + i * 2 * pi / nb
                tube(g, [(0, 0, z), (math.cos(a) * r * 0.9, math.sin(a) * r * 0.9, z + 0.1)], [0.05, 0.02], 3, 'bark', BARK_T, lambda t, p: 0.3 * t, v_rep=0.15, cap=False)
        cnt = (14 if ti < 5 else 8) if lod == 0 else 3
        for i in range(cnt):
            a = a0 + (i + rng.random() * 0.6) * 2 * pi / cnt
            rr = r * (rng.uniform(0.45, 0.95) if lod == 0 else 0.6)
            p = (math.cos(a) * rr, math.sin(a) * rr, z + rng.uniform(0.0, 0.25))
            tilt = rng.uniform(0.3, 0.75)
            out = norm((math.cos(a), math.sin(a), 0.0))
            n = norm(add((0, 0, 1), mul(out, tilt)))
            right, up = basis(n, rng)
            s = rng.uniform(1.3, 1.8) if lod == 0 else r * 1.15
            col = scl(mixc(lo, hi, ti / 6), 0.9 + 0.15 * rng.random())
            card(g, p, right, up, s, s, 'fine', col, clamp(0.3 + 0.7 * rr / 3.3), nrm=norm(add((0, 0, 1), mul(out, 0.6))))
    return g


def build_mahoni(lod):
    g, rng = Geo(), random.Random(31 + lod)
    H0 = 3.4
    tube(g, [(0, 0, 0), (0.04, 0.02, 1.8), (0, 0, H0)], [0.3, 0.24, 0.2], 7 if lod == 0 else 4, 'bark', BARK_T, lambda t, p: 0.0, v_rep=0.6, cap=False)
    if lod == 0:
        for i in range(4):
            a = i * pi / 2 + rng.uniform(-0.3, 0.3)
            to = (math.cos(a) * 1.6, math.sin(a) * 1.6, H0 + 2.4)
            tube(g, branch((0, 0, H0 - 0.1), to, 0.3), [0.17, 0.13, 0.1, 0.07, 0.04], 5, 'bark', BARK_T, lambda t, p: 0.15 * t, v_rep=0.3)
    c, R = (0, 0, H0 + 3.0), 3.5
    lo, hi = L('#5a7a52'), L('#c6e2b0')
    if lod == 0:
        crown(g, rng, c, (R, R, 3.1), 135, (1.7, 2.3), 'broad', lo, hi, sway_tree(R, H0), shell=(0.42, 1.0), zmin=-0.75)
    else:
        crown(g, rng, c, (R * 0.92, R * 0.92, 2.9), 22, (3.2, 3.8), 'broad', lo, hi, sway_tree(R, H0), shell=(0.55, 0.92), zmin=-0.6)
    return g


def build_flamboyan(lod):
    g, rng = Geo(), random.Random(41 + lod)
    H0, R = 2.3, 5.0
    tube(g, [(0, 0, 0), (0.03, 0, 1.2), (0, 0, H0)], [0.32, 0.27, 0.23], 7 if lod == 0 else 4, 'bark', BARK_T, lambda t, p: 0.0, v_rep=0.5, cap=False)
    nb = 5 if lod == 0 else 3
    for i in range(nb):
        a = i * 2 * pi / nb + rng.uniform(-0.3, 0.3)
        to = (math.cos(a) * R * 0.62, math.sin(a) * R * 0.62, H0 + rng.uniform(1.8, 2.5))
        pts = branch((0, 0, H0 - 0.1), to, 0.5, 4 if lod == 0 else 2)
        tube(g, pts, [0.2, 0.16, 0.12, 0.08, 0.05][:len(pts)], 5 if lod == 0 else 3, 'bark', BARK_T, lambda t, p: 0.15 * t, v_rep=0.3)
    c = (0, 0, H0 + 2.7)
    lo, hi = L('#8aa070'), L('#f0f4d8')
    if lod == 0:
        crown(g, rng, c, (R, R, 1.9), 125, (2.0, 2.7), ['flower', 'flower', 'flower', 'fine', 'fine'], lo, hi, sway_tree(R, H0), shell=(0.45, 1.0), zmin=-0.5)
    else:
        crown(g, rng, c, (R * 0.95, R * 0.95, 1.8), 18, (3.9, 4.7), ['flower', 'flower', 'fine'], lo, hi, sway_tree(R, H0), shell=(0.6, 0.95), zmin=-0.4)
    return g


def frond(g, rng, base, az, elev, length, width, tile, col, segs, droop=1.0, fold=0.14, sway0=0.3):
    """Pelepah palem: pita melengkung (naik lalu menjuntai) dengan lipatan V; UV sepanjang = u petak pelepah."""
    ca, sa = math.cos(az), math.sin(az)
    side = (-sa, ca, 0.0)
    rows = []
    for i in range(segs + 1):
        t = i / segs
        h = length * t
        out = math.cos(elev) * h
        z = math.sin(elev) * h - droop * 0.55 * length * t * t
        c = add(base, (ca * out, sa * out, z))
        w = width * (0.35 + 0.65 * math.sin(pi * (0.06 + 0.9 * t)) ** 0.6)
        rows.append((c, w, t))
    ids = []
    for (c, w, t) in rows:
        ids.append((g.vert(add(add(c, mul(side, -w)), (0, 0, -fold * w))), g.vert(add(c, (0, 0, 0.0))), g.vert(add(add(c, mul(side, w)), (0, 0, -fold * w)))))
    u0, u1, vt, vb = tile_uv(tile)
    vm = (vt + vb) / 2
    for i in range(segs):
        t0, t1 = rows[i][2], rows[i + 1][2]
        ua, ub = u0 + (u1 - u0) * t0, u0 + (u1 - u0) * t1
        sw0, sw1 = sway0 + (1 - sway0) * t0 ** 1.1, sway0 + (1 - sway0) * t1 ** 1.1
        up = (0, 0, 1)
        for (j0, j1, va, vb2) in ((0, 1, vt, vm), (1, 2, vm, vb)):
            q = [ids[i][j0], ids[i][j1], ids[i + 1][j1], ids[i + 1][j0]]
            uvs = [(ua, va), (ua, vb2), (ub, vb2), (ub, va)]
            cl = [(*scl(col, 0.92 + 0.12 * t0), sw0), (*scl(col, 0.95 + 0.1 * t0), sw0), (*scl(col, 0.95 + 0.1 * t1), sw1), (*scl(col, 0.92 + 0.12 * t1), sw1)]
            g.face(q, cl, uvs, [norm(add(up, mul((ca, sa, 0), 0.4)))] * 4)


def build_palem_raja(lod):
    g, rng = Geo(), random.Random(51 + lod)
    Ht = 10.2
    prof = [(0.0, 0.36), (0.6, 0.3), (3.0, 0.27), (6.0, 0.31), (8.6, 0.26), (Ht, 0.24)]
    if lod:
        prof = [prof[0], prof[3], prof[-1]]
    tube(g, [(0, 0, z) for z, r in prof], [r for z, r in prof], 9 if lod == 0 else 5, 'rings', lambda t: L('#b9b5aa'), lambda t, p: 0.0, v_rep=0.9, cap=False)
    tube(g, [(0, 0, Ht), (0, 0, Ht + 0.9), (0, 0, Ht + 1.7)][::1 if lod == 0 else 2], [0.25, 0.24, 0.2][::1 if lod == 0 else 2], 9 if lod == 0 else 5, 'white', lambda t: mixc(L('#5f8a3a'), L('#7aa24a'), t), lambda t, p: 0.05, v_rep=1.0)
    top = (0, 0, Ht + 1.6)
    n = 15 if lod == 0 else 7
    for i in range(n):
        az = i * 2 * pi / n + rng.uniform(-0.15, 0.15)
        elev = [1.0, 0.75, 0.5, 0.3, 0.1][i % 5] + rng.uniform(-0.08, 0.08)
        frond(g, rng, top, az, elev, rng.uniform(3.9, 4.6), rng.uniform(0.55, 0.65), 'frond_r', scl(L('#e8f4d0'), 0.95 + 0.1 * rng.random()), 6 if lod == 0 else 2, droop=1.0 + 0.3 * (1 - elev))
    return g


def build_kelapa(lod):
    g, rng = Geo(), random.Random(61 + lod)
    Ht = 9.0
    pts, rads = [], []
    for i in range(9):
        t = i / 8
        x = 1.4 * math.sin(t * 1.25) - 0.25 * t
        pts.append((x, 0.25 * math.sin(t * 2.0), Ht * t))
        rads.append(0.3 - 0.12 * t + (0.08 if i == 0 else 0))
    top = pts[-1]
    if lod:
        pts, rads = pts[::4], rads[::4]
    tube(g, pts, rads, 7 if lod == 0 else 5, 'rings', lambda t: L('#9a8c78'), lambda t, p: 0.08 * t, v_rep=1.0, cap=False)
    n = 16 if lod == 0 else 8
    for i in range(n):
        az = i * 2 * pi / n + rng.uniform(-0.2, 0.2)
        elev = [0.65, 0.4, 0.2, 0.05][i % 4] + rng.uniform(-0.08, 0.08)
        frond(g, rng, top, az, elev, rng.uniform(4.3, 5.1), rng.uniform(0.6, 0.7), 'frond_k', scl(L('#f4f8dc'), 0.92 + 0.1 * rng.random()), 6 if lod == 0 else 2, droop=1.25)
    if lod == 0:
        for i in range(3):  # pelepah kering menjuntai
            az = rng.uniform(0, 2 * pi)
            frond(g, rng, add(top, (0, 0, -0.2)), az, -1.05, rng.uniform(2.6, 3.2), 0.45, 'frond_dead', L('#f0e0c0'), 4, droop=0.2, fold=0.05, sway0=0.2)
        for i in range(6):  # tandan kelapa
            a = i * 2.39996
            c = add(top, (math.cos(a) * 0.32, math.sin(a) * 0.32, -0.35 - 0.12 * (i % 3)))
            colc = L('#5e7a2a') if i % 3 else L('#7a6a2a')
            tube(g, [add(c, (0, 0, -0.13)), add(c, (0, 0, 0)), add(c, (0, 0, 0.13))], [0.02, 0.15, 0.02], 5, 'white', lambda t, cc=colc: cc, lambda t, p: 0.3, cap=False)
    return g


def build_glodokan(lod):
    g, rng = Geo(), random.Random(71 + lod)
    Ht = 9.6
    tube(g, [(0, 0, 0), (0, 0, Ht * 0.6), (0, 0, Ht)], [0.13, 0.09, 0.03], 6 if lod == 0 else 4, 'bark', BARK_T, lambda t, p: 0.1 * t, v_rep=0.6)
    cnt = 105 if lod == 0 else 16
    lo, hi = L('#6a8a5a'), L('#c8e0b0')
    for i in range(cnt):
        z = 0.9 + (Ht + 0.3 - 0.9) * (i + rng.random()) / cnt
        env = 1.3 * max(0.08, 1 - ((z - 4.2) / 5.8) ** 2) ** 0.55
        a = rng.uniform(0, 2 * pi)
        rr = env * rng.uniform(0.55, 1.0)
        p = (math.cos(a) * rr, math.sin(a) * rr, z)
        out = norm((math.cos(a), math.sin(a), -0.15))
        n = norm(add(out, mul(rand_unit(rng), 0.35)))
        right, up = basis(n, rng, 0.35)
        s = rng.uniform(1.0, 1.35) if lod == 0 else 2.2
        hz = z / Ht
        col = scl(mixc(lo, hi, hz), 0.85 + 0.2 * rng.random())
        card(g, p, right, up, s * 0.85, s * 1.25, 'droop', col, clamp(0.2 + 0.6 * hz), nrm_center=(0, 0, z))
    return g


def build_cemara(lod):
    g, rng = Geo(), random.Random(81 + lod)
    Ht = 9.2
    tube(g, [(0, 0, 0), (0.05, 0, Ht * 0.5), (0, 0.03, Ht)], [0.2, 0.12, 0.03], 6 if lod == 0 else 4, 'bark', BARK_T, lambda t, p: 0.08 * t, v_rep=0.6)
    if lod == 0:
        for i in range(9):
            z = 2.0 + i * 0.75
            a = i * 2.39996
            r = 2.1 * (1 - (z - 2.0) / 7.5) + 0.3
            tube(g, [(0, 0, z), (math.cos(a) * r * 0.6, math.sin(a) * r * 0.6, z + 0.25), (math.cos(a) * r, math.sin(a) * r, z + 0.1)], [0.05, 0.035, 0.015], 4, 'bark', BARK_T, lambda t, p: 0.3 * t, v_rep=0.15, cap=False)
    cnt = 100 if lod == 0 else 15
    lo, hi = L('#7a907a'), L('#d0e2c8')
    for i in range(cnt):
        z = 1.6 + (Ht - 1.6) * (i + rng.random()) / cnt
        env = 0.35 + 2.0 * (1 - (z - 1.6) / (Ht - 1.6)) ** 0.9
        a = rng.uniform(0, 2 * pi)
        rr = env * rng.uniform(0.4, 1.0)
        p = (math.cos(a) * rr, math.sin(a) * rr, z)
        out = norm((math.cos(a), math.sin(a), 0.1))
        n = norm(add(out, mul(rand_unit(rng), 0.45)))
        right, up = basis(n, rng, 0.3)
        s = rng.uniform(1.2, 1.7) if lod == 0 else 2.6
        col = scl(mixc(lo, hi, z / Ht), 0.85 + 0.2 * rng.random())
        card(g, p, right, up, s, s * 1.1, 'needle', col, clamp(0.2 + 0.6 * z / Ht), nrm_center=(0, 0, z - 0.3))
    return g


def build_pucuk_merah(lod):
    g, rng = Geo(), random.Random(91 + lod)
    for i in range(4 if lod == 0 else 0):
        a = i * pi / 2 + 0.4
        tube(g, [(0, 0, 0), (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.5)], [0.04, 0.02], 4, 'bark', BARK_T, lambda t, p: 0.1 * t, v_rep=0.1, cap=False)
    c = (0, 0, 0.68)
    lo, hi = L('#a0b098'), L('#ffffff')
    for i in range(36 if lod == 0 else 8):
        d = rand_unit(rng)
        if d[2] < -0.35:
            d = norm((d[0], d[1], -0.35))
        r = rng.uniform(0.55, 1.0)
        p = add(c, (d[0] * 0.78 * r, d[1] * 0.78 * r, d[2] * 0.6 * r))
        out = norm((d[0], d[1], d[2] * 1.4 + 0.3))
        n = norm(add(out, mul(rand_unit(rng), 0.3)))
        right, up = basis(n, rng, 0.35)
        s = rng.uniform(0.55, 0.75) if lod == 0 else 1.0
        hz = clamp((p[2] - 0.1) / 1.2)
        card(g, p, right, up, s, s, 'pucuk', scl(mixc(lo, hi, hz), 0.75 + 0.3 * r), clamp(0.1 + 0.6 * hz), nrm_center=(0, 0, 0.45))
    return g


# ---------------------------------------------------------------- LOD2: kartu silang (jauh sekali)
LOD2_TILE = {'trembesi': 'fine', 'ketapang': 'fine', 'mahoni': 'broad', 'flamboyan': 'flower', 'palem_raja': 'frond_r', 'kelapa': 'frond_k', 'glodokan': 'droop', 'cemara': 'needle'}


def build_lod2(name, g0):
    """Batang = 2 kartu silang (petak kulit kayu), tajuk = 3 kartu tegak silang + 1 mendatar, ukuran dari LOD0."""
    g, rng = Geo(), random.Random(7)
    x0, x1, y0, y1, z0, z1 = g0.bounds()
    R = max(math.hypot(v[0], v[1]) for v in g0.v)
    leafz = [v[2] for v in g0.v if math.hypot(v[0], v[1]) > R * 0.35] or [z1 * 0.6]
    cz0, cz1 = min(leafz), z1
    tile, palm = LOD2_TILE[name], name in ('palem_raja', 'kelapa')
    tint, up = L('#c8d8b8'), (0.0, 0.0, 1.0)
    for a in (0.0, pi / 2):  # batang
        right = (math.cos(a), math.sin(a), 0.0)
        card(g, (0, 0, cz0 * 0.55), right, up, 0.5 if palm else 0.6, cz0 * 1.1, 'rings' if palm else 'bark', L('#9a8a78'), 0.0, nrm=norm(cross(up, right)))
    if palm:  # 4 pelepah sebagai kartu miring dari puncak
        for i in range(4):
            a = i * pi / 2 + 0.4
            out = (math.cos(a), math.sin(a), 0.0)
            c = add((0, 0, cz1 - 1.0), mul(out, R * 0.5))
            right = out
            upv = norm(cross(right, (0, 0, 1)))
            card(g, c, right, upv, R * 1.05, R * 0.45, tile, tint, 0.8, nrm=(0, 0, 1))
    else:
        h = cz1 - cz0
        for k, a in enumerate((0.0, pi / 3, 2 * pi / 3)):
            right = (math.cos(a), math.sin(a), 0.0)
            card(g, (0, 0, cz0 + h * 0.5), right, up, R * 1.9, h * 1.05, tile, tint, 0.5, nrm=norm(cross(up, right)))
        card(g, (0, 0, cz0 + h * 0.62), (1, 0, 0), (0, 1, 0), R * 1.7, R * 1.7, tile, tint, 0.5, nrm=(0, 0, 1))
    return g


# ---------------------------------------------------------------- ilalang (sama dengan v1; tanpa UV, warna RGBA)
def blade(g, base, az, lean, height, width, bend, colb, colm, colt, tip_col=None):
    ca, sa = math.cos(az), math.sin(az)
    side = (-sa, ca, 0.0)
    pts = []
    for t in (0.0, 0.5, 1.0):
        out = math.sin(lean) * height * t + bend * height * t * t
        z = math.cos(lean) * height * t - bend * 0.55 * height * t * t
        pts.append(add(base, (ca * out, sa * out, z)))
    w = [width, width * 0.6]
    v0l, v0r = g.vert(add(pts[0], mul(side, -w[0]))), g.vert(add(pts[0], mul(side, w[0])))
    v1l, v1r = g.vert(add(pts[1], mul(side, -w[1]))), g.vert(add(pts[1], mul(side, w[1])))
    tip = g.vert(pts[2])
    cb, cm, ct = (*colb, 0.0), (*colm, 0.45), (*(tip_col or colt), 1.0)
    up = norm(add((ca * -0.6, sa * -0.6, 0.0), (0, 0, 1)))
    g.face([v0l, v0r, v1r, v1l], [cb, cb, cm, cm], None, [up] * 4)
    g.face([v1l, v1r, tip], [cm, cm, ct], None, [up] * 3)


def build_ilalang(var):
    g = Geo()
    base_c, mid_c, tip_c = L('#3d5a2a'), L('#7a9a3a'), L('#c8c870')
    n, hmin, hmax, lean0, bend = {'a': (13, 1.0, 1.28, 0.08, 0.32), 'b': (12, 1.0, 1.3, 0.2, 0.45), 'c': (10, 0.95, 1.2, 0.12, 0.38)}[var]
    for i in range(n):
        az = i * 2.39996 + 0.7 * hsh(i, 1, ord(var))
        rad = 0.05 + 0.1 * hsh(i, 2, ord(var))
        h = hmin + (hmax - hmin) * hsh(i, 3, ord(var))
        lean = lean0 + 0.25 * hsh(i, 4, ord(var))
        base = (math.cos(az) * rad, math.sin(az) * rad, 0.0)
        tipc = mixc(tip_c, mid_c, 0.35 * hsh(i, 6, ord(var)))
        blade(g, base, az, lean, h, 0.04 + 0.014 * hsh(i, 5, ord(var)), bend * (0.7 + 0.6 * hsh(i, 7, ord(var))), base_c, mid_c, tipc)
    if var == 'c':
        for i in range(2):
            az = 1.1 + i * 2.6
            base = (math.cos(az) * 0.04, math.sin(az) * 0.04, 0.0)
            blade(g, base, az, 0.1 + 0.06 * i, 1.38 - 0.08 * i, 0.05, 0.12, L('#7f8a4a'), L('#cfcaa8'), L('#efeadb'), tip_col=L('#f4f1e6'))
    return g


# ================================================================ objek & ekspor
VARIANTS = [
    ('trembesi', 0, build_trembesi), ('ketapang', 0, build_ketapang), ('mahoni', 0, build_mahoni), ('flamboyan', 0, build_flamboyan),
    ('palem_raja', 1, build_palem_raja), ('kelapa', 1, build_kelapa),
    ('glodokan', 2, build_glodokan), ('cemara', 2, build_cemara),
    ('pucuk_merah', 'bush', build_pucuk_merah),
]
SINGLE = [('ilalang_a', 'grass', lambda: build_ilalang('a')), ('ilalang_b', 'grass', lambda: build_ilalang('b')), ('ilalang_c', 'grass', lambda: build_ilalang('c'))]


def make_obj(name, g):
    me = bpy.data.meshes.new(name)
    me.from_pydata(g.v, [], g.f)
    me.update()
    assert len(me.polygons) == len(g.f), (name, len(me.polygons), len(g.f))
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    has_uv = any(u is not None for u in g.uv)
    uvl = me.uv_layers.new(name='UVMap') if has_uv else None
    loop_n = [None] * len(me.loops)
    for poly, cols, uvs, nrms in zip(me.polygons, g.c, g.uv, g.n):
        poly.use_smooth = True
        for k, li in enumerate(poly.loop_indices):
            attr.data[li].color = cols[k]
            if uvl is not None:
                uvl.data[li].uv = uvs[k] if uvs is not None else (0.5, 0.05)
            loop_n[li] = nrms[k] if nrms is not None else (0.0, 0.0, 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
    try:
        me.normals_split_custom_set([norm(n) for n in loop_n])
    except Exception as e:
        log('normal kustom gagal', name, e)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_all():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    objs, meta = [], []
    for name, grp, fn in VARIANTS:
        g0, g1 = fn(0), fn(1)
        b = g0.bounds()
        o0, o1 = make_obj(name + '_lod0', g0), make_obj(name + '_lod1', g1)
        objs += [o0, o1]
        if name in LOD2_TILE:
            objs.append(make_obj(name + '_lod2', build_lod2(name, g0)))
        rad = max(math.hypot(v[0], v[1]) for v in g0.v)
        meta.append({'name': name, 'group': grp, 'height': round(b[5], 3), 'crownRadius': round(rad, 3), 'tris': {'lod0': g0.tris(), 'lod1': g1.tris()}})
        log(name, 'lod0', g0.tris(), 'lod1', g1.tris(), 'H', round(b[5], 2), 'R', round(rad, 2))
    for name, grp, fn in SINGLE:
        g0 = fn()
        b = g0.bounds()
        objs.append(make_obj(name + '_lod0', g0))
        meta.append({'name': name, 'group': grp, 'height': round(b[5], 3), 'crownRadius': round(max(math.hypot(v[0], v[1]) for v in g0.v), 3), 'tris': {'lod0': g0.tris(), 'lod1': None}})
    return objs, meta


def export(objs, meta, atlas):
    os.makedirs(OUT, exist_ok=True)
    write_png(os.path.join(OUT, 'leaves.png'), atlas)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, 'trees.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_normals=True, export_texcoords=True, export_tangents=False, export_cameras=False,
                              export_lights=False, export_animations=False, export_extras=False, export_draco_mesh_compression_enable=False)
    with open(os.path.join(OUT, 'trees.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    log('ekspor', path, os.path.getsize(path), 'byte; atlas', os.path.getsize(os.path.join(OUT, 'leaves.png')), 'byte')


# ================================================================ preview (Cycles)
def leaf_material(atlas_path):
    m = bpy.data.materials.new('leaf')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(atlas_path)
    tex.interpolation = 'Linear'
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs['A'])
    nt.links.new(vc.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.75
    try:
        m.blend_method = 'CLIP'
    except Exception:
        pass
    return m


def vc_material():
    m = bpy.data.materials.new('vc')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    ca = nt.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'Col'
    nt.links.new(ca.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85
    return m


def ground_material():
    m = bpy.data.materials.new('ground')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.35
    noise.inputs['Detail'].default_value = 4.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*L('#5c7a3c'), 1)
    ramp.color_ramp.elements[1].color = (*L('#7a9850'), 1)
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    return m


def sky_world(strength=0.55):
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    for t in ('MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'HOSEK_WILKIE', 'NISHITA'):
        try:
            sky.sky_type = t
            break
        except Exception:
            continue
    for k, v in (('sun_elevation', 32 * D2R), ('sun_rotation', 205 * D2R), ('sun_disc', False), ('altitude', 0.0)):
        try:
            setattr(sky, k, v)
        except Exception:
            pass
    bg = nt.nodes.get('Background')
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    sd = bpy.data.lights.new('sun', 'SUN')
    sd.energy = 3.0
    sd.angle = 3 * D2R
    sd.color = (1.0, 0.92, 0.8)
    sun = bpy.data.objects.new('sun', sd)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (58 * D2R, 0, 205 * D2R + pi)


def stage(by, layout, cam_loc, cam_target, lens, leafm, vcm):
    placed = []
    for name, x, y, rz in layout:
        src = by[name]
        if not src.data.materials:
            src.data.materials.append(vcm if name.startswith('ilalang') else leafm)
        o = bpy.data.objects.new(name + '_pv', src.data)
        o.location = (x, y, 0)
        o.rotation_euler = (0, 0, rz)
        bpy.context.scene.collection.objects.link(o)
        placed.append(o)
    bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, 0))
    gp = bpy.context.active_object
    gp.data.materials.append(ground_material())
    placed.append(gp)
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = lens
    cam_d.clip_end = 8000
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = cam_loc
    from mathutils import Vector
    cam.rotation_euler = Vector((cam_target[0] - cam_loc[0], cam_target[1] - cam_loc[1], cam_target[2] - cam_loc[2])).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    placed.append(cam)
    return placed


def render_engine(quick, w, h):
    scn = bpy.context.scene
    if quick:
        scn.render.engine = 'BLENDER_EEVEE'
    else:
        scn.render.engine = 'CYCLES'
        prefs = bpy.context.preferences.addons['cycles'].preferences
        try:
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == 'METAL'
            scn.cycles.device = 'GPU'
        except Exception as e:
            log('GPU gagal', e)
        scn.cycles.samples = SAMPLES
        scn.cycles.use_denoising = True
        scn.cycles.max_bounces = 6
        scn.cycles.transparent_max_bounces = 24
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    for vt in ('AgX', 'Filmic', 'Standard'):
        try:
            scn.view_settings.view_transform = vt
            break
        except Exception:
            continue


def previews(objs, atlas_path, quick_dir=None):
    by = {o.name: o for o in objs}
    for o in objs:
        o.hide_render = True
    out = quick_dir or PREV
    os.makedirs(out, exist_ok=True)
    sky_world()
    leafm, vcm = leaf_material(atlas_path), vc_material()
    lay = [('palem_raja_lod0', -19.5, 10.0, 0.3), ('trembesi_lod0', -9.5, 15.0, 0.6), ('kelapa_lod0', -2.0, 7.0, 2.2), ('ketapang_lod0', 4.5, 9.0, 0.2),
           ('mahoni_lod0', 11.0, 12.0, 1.1), ('flamboyan_lod0', 20.0, 15.0, 0.4), ('glodokan_lod0', 26.0, 7.0, 0.0), ('cemara_lod0', 31.0, 11.0, 0.8),
           ('pucuk_merah_lod0', -8.0, 1.0, 0.0), ('pucuk_merah_lod0', -6.4, 0.4, 1.3), ('pucuk_merah_lod0', 9.0, 1.2, 0.6), ('pucuk_merah_lod0', 10.6, 0.6, 2.0),
           ('pucuk_merah_lod0', 24.0, 1.0, 0.0)]
    lay += [(('ilalang_a_lod0', 'ilalang_b_lod0', 'ilalang_c_lod0')[i % 3], -1.5 + (i % 7) * 0.8, -3.6 + (i // 7) * 0.7, i * 1.7) for i in range(28)]
    placed = stage(by, lay, (5.5, -34.0, 3.4), (5.5, 6.0, 5.8), 24, leafm, vcm)
    render_engine(bool(quick_dir), 1920 if not quick_dir else 1280, 1080 if not quick_dir else 720)
    bpy.context.scene.render.filepath = os.path.join(out, 'lineup-v2.png')
    bpy.ops.render.render(write_still=True)
    log('render', bpy.context.scene.render.filepath)
    for o in placed:
        bpy.data.objects.remove(o, do_unlink=True)
    names = ['trembesi', 'ketapang', 'mahoni', 'flamboyan', 'palem_raja', 'kelapa', 'glodokan', 'cemara']
    lay, x = [], -46.0
    for nme in names:
        w = max(by[nme + '_lod0'].dimensions.x, by[nme + '_lod0'].dimensions.y) * 0.5 + 0.8
        lay += [(nme + '_lod0', x + w, 0.0, 0.4), (nme + '_lod1', x + 3 * w, 0.0, 0.4)]
        x += 4 * w
    cx = (x - 46.0) / 2
    placed = stage(by, lay, (cx, -95.0, 6.0), (cx, 0.0, 5.0), 24, leafm, vcm)
    render_engine(bool(quick_dir), 1920 if not quick_dir else 1280, 1080 if not quick_dir else 720)
    bpy.context.scene.render.filepath = os.path.join(out, 'lod-v2.png')
    bpy.ops.render.render(write_still=True)
    log('render', bpy.context.scene.render.filepath)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    atlas = build_atlas()
    objs, meta = build_all()
    atlas_path = os.path.join(OUT, 'leaves.png')
    if not opt('--no-export'):
        export(objs, meta, atlas)
    else:
        os.makedirs(PREV, exist_ok=True)
        atlas_path = os.path.join(PREV, 'leaves-tmp.png')
        write_png(atlas_path, atlas)
    q = opt('--quick')
    if q:
        previews(objs, atlas_path, quick_dir=os.path.abspath(q))
    if opt('--preview'):
        previews(objs, atlas_path)


main()
