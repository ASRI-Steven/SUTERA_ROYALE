"""Sutera Royale / SENARA: pohon tropis, semak, dan rumpun ilalang orisinal, dimodelkan prosedural di Blender (headless).

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/trees.py -- [opsi]

Opsi:
  --no-export        lewati ekspor GLB + JSON
  --quick DIR        render cek cepat (EEVEE) lineup + lod ke DIR
  --preview          render preview Cycles ke preview/trees/lineup.png dan preview/trees/lod.png
  --samples N        sampel Cycles (default 128)

Keluaran (kontrak untuk web/map/world.js):
  web/game/assets/trees/trees.glb   satu mesh per varian, node top-level:
      trembesi_lod0/_lod1, ketapang_lod0/_lod1          (grup 0: tajuk lebar)
      palem_raja_lod0/_lod1, kelapa_lod0/_lod1          (grup 1: palem)
      glodokan_lod0/_lod1, cemara_lod0/_lod1            (grup 2: kolom/kerucut)
      semak_a_lod0, semak_b_lod0                        (semak ±1 m)
      ilalang_a_lod0, ilalang_b_lod0, ilalang_c_lod0    (rumpun rumput tinggi)
  web/game/assets/trees/trees.json  [{ name, group, height, crownRadius, tris: { lod0, lod1 } }]
  - glTF +Y atas, origin = pangkal batang di tanah, ukuran nyata (m) untuk ukuran "sedang".
  - COLOR_0 RGBA (linear): RGB = warna, A = bobot goyang angin (0 = pangkal/batang kaku, 1 = ujung daun/pelepah/bilah).
  - Tanpa tekstur/UV/material. Pelepah palem dan bilah ilalang satu lapis → render dengan side: DoubleSide.
"""
import bpy
import json
import math
import os
import sys
import warnings

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
SAMPLES = int(opt('--samples', 128))
pi = math.pi
D2R = pi / 180


def log(*a):
    print('[tree]', *a, flush=True)


# ---------------------------------------------------------------- warna & matematika kecil
def L(h):  # hex sRGB → RGB linear
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def mixc(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scl(c, k):
    return tuple(max(0.0, x * k) for x in c)


def clamp(v, a=0.0, b=1.0):
    return a if v < a else b if v > b else v


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


def hsh(*a):  # acak deterministik 0..1
    s = math.sin(sum((i + 1) * 12.9898 * x for i, x in enumerate(a)) + 78.233) * 43758.5453
    return s - math.floor(s)


def nz(x, y, z, s):  # derau halus −1..1
    return 0.6 * math.sin(x * 1.7 + s * 1.31) * math.sin(y * 2.1 + s * 0.73) * math.sin(z * 1.9 + s * 2.17) \
        + 0.4 * math.sin((x + y) * 3.1 + s) * math.sin((y - z) * 2.7 + s * 1.7)


# ---------------------------------------------------------------- penampung geometri
class Geo:
    """Verteks + face dengan warna RGBA per sudut. Arah normal diatur saat face dibuat."""

    def __init__(self):
        self.v, self.f, self.c, self.sm = [], [], [], []

    def vert(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def face(self, idx, cols, smooth=True, center=None, updir=None):
        """center: titik acuan → normal menjauhi titik itu; updir: normal searah vektor itu."""
        if center is not None or updir is not None:
            P = [self.v[i] for i in idx]
            n = (0.0, 0.0, 0.0)
            for i in range(len(P)):  # Newell
                a, b = P[i], P[(i + 1) % len(P)]
                n = (n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1]))
            ref = updir if updir is not None else sub(mul(add(P[0], add(P[1], P[2])), 1 / 3), center)
            if dot(n, ref) < 0:
                idx = list(reversed(idx))
                cols = list(reversed(cols))
        self.f.append(tuple(idx))
        self.c.append([tuple(c) for c in cols])
        self.sm.append(smooth)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def bounds(self):
        xs, ys, zs = zip(*self.v)
        return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def ico(sub_n):
    t = (1 + 5 ** 0.5) / 2
    V = [norm(p) for p in [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
                            (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(sub_n):
        cache, nf = {}, []

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                V.append(norm(mul(add(V[a], V[b]), 0.5)))
                cache[k] = len(V) - 1
            return cache[k]
        for a, b, c in F:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        F = nf
    return V, F


# ---------------------------------------------------------------- primitif
def blob(g, c, s, sub_n, seed, cb, ct, wind, amp=0.14, flat_bottom=0.35, jitter=0.07):
    """Gumpalan daun: ikosfer berderau. cb/ct = warna bawah/atas, wind(p) → bobot angin."""
    V, F = ico(sub_n)
    ids, P = [], []
    for p in V:
        k = 1 + amp * nz(p[0] * 2 + seed, p[1] * 2, p[2] * 2, seed)
        q = (p[0] * k, p[1] * k, p[2] * k)
        if q[2] < -flat_bottom:  # bawah tajuk lebih rata
            q = (q[0], q[1], -flat_bottom + (q[2] + flat_bottom) * 0.45)
        w = (c[0] + q[0] * s[0], c[1] + q[1] * s[1], c[2] + q[2] * s[2])
        P.append((w, q))
        ids.append(g.vert(w))
    for f in F:
        cols = []
        for i in f:
            w, q = P[i]
            t = clamp((q[2] + 0.6) / 1.5)
            col = mixc(cb, ct, t ** 0.9)
            col = scl(col, 1 + jitter * nz(w[0] * 3.3, w[1] * 3.1, w[2] * 2.9, seed + 7))
            cols.append((*col, clamp(wind(w))))
        g.face([ids[i] for i in f], cols, True, center=c)


def tube(g, pts, rads, segs, colf, windf, cap1=True, phase=0.0, smooth=True):
    """Batang/dahan menyusuri titik-titik pts; colf(t,u) & windf(t,p) per cincin (t 0..1 di sepanjang, u 0..1 keliling)."""
    n = len(pts)
    rings = []
    up = (0.0, 0.0, 1.0)
    prev_side = None
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        d = norm(sub(b, a))
        ref = up if abs(dot(d, up)) < 0.95 else (1.0, 0.0, 0.0)
        side = norm(cross(d, ref)) if prev_side is None else norm(cross(cross(d, prev_side), d))
        prev_side = side
        side2 = norm(cross(d, side))
        ring = []
        for k in range(segs):
            ang = 2 * pi * k / segs + phase
            off = add(mul(side, math.cos(ang) * rads[i]), mul(side2, math.sin(ang) * rads[i]))
            ring.append(g.vert(add(pts[i], off)))
        rings.append(ring)
    for i in range(n - 1):
        t0, t1 = i / (n - 1), (i + 1) / (n - 1)
        axis_c = mul(add(pts[i], pts[i + 1]), 0.5)
        for k in range(segs):
            k2 = (k + 1) % segs
            q = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
            ts = [t0, t0, t1, t1]
            us = [k / segs, k2 / segs, k2 / segs, k / segs]
            cols = [(*colf(ts[j], us[j]), clamp(windf(ts[j], g.v[q[j]]))) for j in range(4)]
            g.face(q, cols, smooth, center=axis_c)
    if cap1 and rads[-1] > 0.001:
        c = g.vert(pts[-1])
        for k in range(segs):
            k2 = (k + 1) % segs
            q = [rings[-1][k], rings[-1][k2], c]
            cols = [(*colf(1.0, 0.5), clamp(windf(1.0, g.v[i]))) for i in q]
            g.face(q, cols, smooth, updir=norm(sub(pts[-1], pts[-2])))


def lathe(g, cx, cy, prof, segs, colf, windf, seed=0.0, jag=0.0, phase=0.0, close_top=True, close_bot=True, smooth=True, rmod=None):
    """Benda putar: prof = [(r, z), …] dari bawah ke atas. jag = derau jari-jari (tepi tidak rata),
    rmod(a, j) = pengali jari-jari per sudut/cincin (mis. roset daun)."""
    rings = []
    for j, (r, z) in enumerate(prof):
        ring = []
        for k in range(segs):
            a = 2 * pi * k / segs + phase
            rr = r * (1 + jag * nz(math.cos(a) * 2.3, math.sin(a) * 2.3, z * 0.7 + j, seed)) * (rmod(a, j) if rmod else 1.0)
            ring.append(g.vert((cx + math.cos(a) * rr, cy + math.sin(a) * rr, z)))
        rings.append(ring)
    zc = sum(z for _, z in prof) / len(prof)
    for j in range(len(prof) - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            q = [rings[j][k], rings[j][k2], rings[j + 1][k2], rings[j + 1][k]]
            cols = [(*colf(g.v[i], j + (1 if n >= 2 else 0)), clamp(windf(g.v[i]))) for n, i in enumerate(q)]
            c = (cx, cy, (g.v[q[0]][2] + g.v[q[2]][2]) / 2)
            g.face(q, cols, smooth, center=c)
    for ring, top in ((rings[0], False), (rings[-1], True)):
        if (top and not close_top) or (not top and not close_bot):
            continue
        z = g.v[ring[0]][2]
        c = g.vert((cx, cy, z + (0.04 if top else -0.04)))
        for k in range(segs):
            q = [ring[k], ring[(k + 1) % segs], c]
            cols = [(*colf(g.v[i], len(prof) - 1 if top else 0), clamp(windf(g.v[i]))) for i in q]
            g.face(q, cols, smooth, updir=(0, 0, 1) if top else (0, 0, -1))
    return zc


def frond(g, base, az, elev, length, segs, width, droop, colb, colt, w0=0.3, cuts=2, curl=0.0, seed=0.0):
    """Pelepah palem: tulang daun melengkung (naik lalu menjuntai), anak daun kiri-kanan berupa segitiga terpisah
    (tampak tercabik), sedikit terlipat V. Bobot angin naik dari pangkal ke ujung."""
    ca, sa = math.cos(az), math.sin(az)
    fwd = (ca, sa, 0.0)
    left = (-sa, ca, 0.0)
    pts = []
    for i in range(segs + 1):
        t = i / segs
        x = t * length * math.cos(elev)
        z = t * length * math.sin(elev) - droop * t * t * length
        pts.append(add(base, (fwd[0] * x, fwd[1] * x, z)))
    for i in range(segs):
        t0, t1 = i / segs, (i + 1) / segs
        a, b = pts[i], pts[i + 1]
        wmid = width * math.sin(pi * min(1.0, (t0 + t1) / 2 * 1.1 + 0.05)) + 0.05
        for side in (-1, 1):
            for c in range(cuts):
                u0 = c / cuts
                u1 = (c + 0.93) / cuts  # anak daun nyaris rapat, sisa celah kecil = sobekan
                p0 = add(a, mul(sub(b, a), u0))
                p1 = add(a, mul(sub(b, a), u1))
                tip_t = (t0 + (t1 - t0) * (u0 + u1) / 2)
                back = mul(norm(sub(b, a)), 0.32 * wmid)  # anak daun condong ke arah ujung pelepah
                lift = 0.28 * wmid * (1 - tip_t) - 0.42 * wmid * tip_t + curl * side
                tip = add(add(p0, mul(left, side * wmid)), add(back, (0, 0, lift - 0.12 * wmid)))
                q = [g.vert(p0), g.vert(p1), g.vert(tip)]
                cols, tt = [], [t0 + (t1 - t0) * u0, t0 + (t1 - t0) * u1, tip_t]
                for j, vi in enumerate(q):
                    col = mixc(colb, colt, tt[j] ** 0.8 + (0.12 if j == 2 else 0))
                    col = scl(col, 1 + 0.06 * nz(g.v[vi][0] * 3, g.v[vi][1] * 3, g.v[vi][2] * 3, seed))
                    cols.append((*col, clamp(w0 + (1 - w0) * tt[j] ** 1.2 + (0.08 if j == 2 else 0))))
                g.face(q, cols, True, updir=(0, 0, 1))
    return pts[-1]


def blade(g, base, az, lean, height, width, bend, colb, colm, colt, tip_col=None, seed=0.0):
    """Bilah ilalang: 3 segitiga (pangkal lebar → ujung runcing), melengkung keluar."""
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
    up = norm(add((ca * -0.6, sa * -0.6, 0.0), (0, 0, 1)))  # normal menghadap atas-dalam
    g.face([v0l, v0r, v1r, v1l], [cb, cb, cm, cm], True, updir=up)
    g.face([v1l, v1r, tip], [cm, cm, ct], True, updir=up)


# ---------------------------------------------------------------- palet
BARK = L('#6a5440')
BARK_D = L('#4a3a2c')
BARK_L = L('#7d6650')
LEAF_D = L('#3a6630')
LEAF = L('#4c8b3c')
LEAF_M = L('#5a9a45')
LEAF_L = L('#79b257')
LEAF_Y = L('#93bf5c')
PALM_T = L('#8c877d')
PALM_TD = L('#726d64')


def trunk_col(dark, light):
    return lambda t, u: scl(mixc(dark, light, t), 0.9 + 0.12 * math.sin(u * 2 * pi * 2))


# ---------------------------------------------------------------- grup 0
def build_trembesi(lod):
    g = Geo()
    H = 7.0
    if lod == 0:
        tw = lambda t, p: 0.1 * t ** 2
        tube(g, [(0, 0, 0), (0.05, 0.02, 0.9), (0.12, 0.05, 2.1)], [0.42, 0.33, 0.27], 8, trunk_col(BARK_D, BARK), tw, cap1=False)
        # dahan utama menyebar seperti payung
        for i, (az, el, ln) in enumerate([(20, 38, 2.5), (105, 44, 2.3), (195, 36, 2.6), (285, 46, 2.2)]):
            a, e = az * D2R, el * D2R
            p0 = (0.12, 0.05, 2.0)
            p1 = add(p0, (math.cos(a) * ln * 0.5 * math.cos(e), math.sin(a) * ln * 0.5 * math.cos(e), ln * 0.5 * math.sin(e) + 0.15))
            p2 = add(p0, (math.cos(a) * ln * math.cos(e) * 0.95, math.sin(a) * ln * math.cos(e) * 0.95, ln * math.sin(e)))
            tube(g, [p0, p1, p2], [0.2, 0.14, 0.08], 6, trunk_col(BARK, BARK_L), lambda t, p: 0.12 + 0.18 * t, cap1=True, phase=i)
        # tajuk payung: 6 gumpalan cincin + 1 puncak
        wind = lambda p: 0.35 + 0.65 * clamp((p[2] - 3.6) / 3.2) * 0.6 + 0.4 * clamp(math.hypot(p[0], p[1]) / 3.2)
        for i in range(6):
            a = i / 6 * 2 * pi + 0.35
            r = 1.62 + 0.14 * math.sin(i * 2.1)
            z = 4.7 + 0.22 * math.sin(i * 1.7)
            tint = 0.93 + 0.12 * hsh(i, 3)
            blob(g, (math.cos(a) * r, math.sin(a) * r, z), (1.52, 1.52, 0.95), 1, 10 + i * 3.1, scl(LEAF_D, tint), scl(LEAF_M, tint), wind, amp=0.15)
        blob(g, (0.12, 0.05, 5.45), (1.8, 1.75, 1.05), 1, 3.3, LEAF, LEAF_L, wind, amp=0.13)
    else:
        tube(g, [(0, 0, 0), (0.1, 0.04, 3.4)], [0.36, 0.22], 3, trunk_col(BARK_D, BARK), lambda t, p: 0.1 * t, cap1=False)
        blob(g, (0.05, 0.0, 5.25), (3.05, 3.05, 1.55), 1, 3.3, LEAF_D, LEAF_L, lambda p: 0.35 + 0.65 * clamp((p[2] - 3.8) / 3), amp=0.1)
    return g


def build_ketapang(lod):
    g = Geo()
    tiers = [(2.55, 2.75), (3.65, 2.35), (4.65, 1.9), (5.55, 1.4), (6.35, 0.88)] if lod == 0 else [(2.9, 2.6), (4.4, 1.9), (5.8, 1.05)]
    top = 7.05
    tube(g, [(0, 0, 0), (0.0, 0.03, 3.0), (0.02, 0.0, top)], [0.22, 0.15, 0.06] if lod == 0 else [0.2, 0.12, 0.05], 6 if lod == 0 else 3,
         trunk_col(BARK_D, BARK_L), lambda t, p: 0.25 * t ** 2, cap1=lod == 0)
    segs = 10 if lod == 0 else 6
    for j, (z, r) in enumerate(tiers):
        def colf(p, ring, z=z, r=r):
            if p[2] < z - 0.05:
                return scl(LEAF_D, 0.92)
            rr = math.hypot(p[0], p[1]) / r
            return mixc(LEAF_M, LEAF_L, 0.2 + 0.8 * clamp((p[2] - z + 0.1) / 0.4) * (1.1 - 0.5 * rr))
        windf = lambda p, z=z, r=r: 0.3 + 0.7 * clamp(math.hypot(p[0], p[1]) / max(r, 0.5)) * (0.75 + 0.25 * z / top)
        rose = lambda a, jj, j=j: 1 + (0.22 if jj in (1, 2, 3) else 0.08) * math.cos(5 * a + j * 1.3) + 0.06 * math.cos(11 * a + j)
        if lod == 0:
            prof = [(0.18, z - 0.24), (r * 0.7, z - 0.3), (r, z - 0.3), (r * 0.95, z - 0.04), (r * 0.6, z + 0.22), (0.2, z + 0.32)]  # tepi menjuntai
        else:
            prof = [(0.15, z - 0.2), (r, z - 0.08), (0.15, z + 0.28)]
        lathe(g, 0.0, 0.0, prof, segs, colf, windf, seed=j * 2.7, jag=0.12 if lod == 0 else 0.06, phase=j * 0.4, close_top=lod == 0, close_bot=lod == 0, rmod=rose)
    if lod == 0:  # pucuk
        blob(g, (0.02, 0.0, top + 0.05), (0.45, 0.45, 0.35), 0, 9.1, LEAF_M, LEAF_Y, lambda p: 0.9, amp=0.08)
    return g


# ---------------------------------------------------------------- grup 1 (palem)
def build_palem_raja(lod):
    g = Geo()
    if lod == 0:
        zs = [0.0, 0.5, 2.4, 4.1, 5.9, 7.15]
        rs = [0.36, 0.30, 0.26, 0.28, 0.24, 0.22]
        pts = [(0.0, 0.0, z) for z in zs]
        tube(g, pts, rs, 8, lambda t, u: scl(mixc(PALM_TD, PALM_T, t), 0.94 + 0.08 * ((int(t * 24) % 2))), lambda t, p: 0.12 * t ** 2, cap1=False)
        # pelepah hijau (crownshaft)
        tube(g, [(0, 0, 7.12), (0, 0, 7.8), (0, 0, 8.42)], [0.25, 0.27, 0.2], 8, lambda t, u: mixc(L('#3f6f27'), L('#5d8a35'), t), lambda t, p: 0.15 + 0.1 * t, cap1=True)
        n = 14
        for i in range(n):
            az = i / n * 2 * pi + 0.3 * math.sin(i * 1.9)
            el = (30 + 26 * (i % 3) / 2) * D2R
            frond(g, (0.0, 0.0, 8.42), az, el, 3.7 + 0.3 * math.sin(i * 2.3), 6, 0.92, 0.78, L('#3a7329'), L('#86b552'), w0=0.32, cuts=3, seed=i)
        blob(g, (0, 0, 8.5), (0.2, 0.2, 0.32), 0, 2.0, L('#5f8f3a'), L('#7aa64a'), lambda p: 0.3, amp=0.05)
    else:
        tube(g, [(0, 0, 0), (0, 0, 3.6), (0, 0, 7.2)], [0.33, 0.26, 0.22], 4, lambda t, u: mixc(PALM_TD, PALM_T, t), lambda t, p: 0.1 * t, cap1=False)
        tube(g, [(0, 0, 7.2), (0, 0, 8.4)], [0.26, 0.2], 4, lambda t, u: L('#4a7a2e'), lambda t, p: 0.2, cap1=False)
        for i in range(8):
            frond(g, (0, 0, 8.4), i / 8 * 2 * pi, (32 + 10 * (i % 2)) * D2R, 3.6, 4, 1.0, 0.8, L('#3a7329'), L('#86b552'), w0=0.32, cuts=1, seed=i)
    return g


def build_kelapa(lod):
    g = Geo()
    lean = (0.9, 0.25)
    nseg = 8 if lod == 0 else 3
    pts, rs = [], []
    for i in range(nseg + 1):
        t = i / nseg
        bend = math.sin(t * pi * 0.85) * 0.35 + t * t * 0.55  # sedikit melengkung
        pts.append((lean[0] * bend, lean[1] * bend, t * 7.9))
        rs.append(0.3 - 0.1 * t + (0.05 if i == 0 else 0))
    ring_col = lambda t, u: scl(mixc(L('#6e6050'), L('#8d7d68'), t), 0.88 + 0.14 * (int(t * 30) % 2))
    tube(g, pts, rs, 8 if lod == 0 else 4, ring_col, lambda t, p: 0.15 * t ** 2, cap1=False)
    top = pts[-1]
    if lod == 0:
        blob(g, add(top, (0, 0, 0.05)), (0.36, 0.36, 0.3), 0, 4.4, L('#5a4a36'), L('#7a6a4a'), lambda p: 0.2, amp=0.1)
        n = 14
        for i in range(n):
            az = i / n * 2 * pi + 0.25 * math.sin(i * 2.7)
            el = (18 + 22 * hsh(i, 5)) * D2R
            frond(g, add(top, (0, 0, 0.12)), az, el, 3.7 + 0.3 * hsh(i, 2), 6, 0.82, 1.2, L('#55852f'), L('#a8c45c'), w0=0.32, cuts=3, seed=i * 1.7)
        for i in range(5):  # buah kelapa
            a = i / 5 * 2 * pi + 0.4
            col = L('#6f8f2f') if i % 3 else L('#8a6a3a')
            blob(g, add(top, (math.cos(a) * 0.32, math.sin(a) * 0.32, -0.32 - 0.08 * (i % 2))), (0.17, 0.17, 0.2), 0, i * 3.3, scl(col, 0.8), col, lambda p: 0.25, amp=0.04, flat_bottom=1.0)
    else:
        for i in range(7):
            frond(g, add(top, (0, 0, 0.1)), i / 7 * 2 * pi, 24 * D2R, 3.7, 4, 0.9, 1.2, L('#55852f'), L('#a8c45c'), w0=0.32, cuts=1, seed=i)
    return g


# ---------------------------------------------------------------- grup 2 (kolom / kerucut)
def build_glodokan(lod):
    g = Geo()
    H = 7.4
    tube(g, [(0, 0, 0), (0, 0, 1.6)], [0.16, 0.12], 6 if lod == 0 else 3, trunk_col(BARK_D, BARK), lambda t, p: 0.05 * t, cap1=False)
    dark, mid, lite = L('#24482c'), L('#2f5f3a'), L('#4f8a4a')
    if lod == 0:
        # inti gelap supaya celah antar-lapis tidak tembus pandang
        lathe(g, 0, 0, [(0.42, 1.3), (0.55, 3.2), (0.38, 5.4), (0.12, 7.1)], 8, lambda p, j: dark, lambda p: 0.2 + 0.4 * p[2] / H, seed=1.0, jag=0.1, close_top=False, close_bot=True)
        layers = [(1.95, 0.95), (2.55, 1.0), (3.15, 0.96), (3.75, 0.88), (4.35, 0.78), (4.95, 0.66), (5.55, 0.53), (6.15, 0.39), (6.75, 0.24)]
        segs = 10
        for j, (z, r) in enumerate(layers):
            # rok daun menjuntai: cincin atas sempit, tepi bawah bergerigi (ujung daun)
            top_r, hem_z = r * 0.35, z - 0.85
            ring_t, ring_h = [], []
            for k in range(segs):
                a = 2 * pi * k / segs + j * 0.5
                ring_t.append(g.vert((math.cos(a) * top_r, math.sin(a) * top_r, z + 0.05)))
                rr = r * (1 + 0.1 * nz(math.cos(a) * 2, math.sin(a) * 2, j, 4.2))
                ring_h.append(g.vert((math.cos(a) * rr, math.sin(a) * rr, hem_z + 0.12 * math.sin(k * 2.7 + j))))
            tips = []
            for k in range(segs):
                a = 2 * pi * (k + 0.5) / segs + j * 0.5
                rr = r * 0.92
                tips.append(g.vert((math.cos(a) * rr, math.sin(a) * rr, hem_z - 0.3)))
            wv = lambda vi: clamp(0.3 + 0.7 * (g.v[vi][2] / H) * 0.6 + 0.3 * math.hypot(g.v[vi][0], g.v[vi][1]) / 1.0)
            for k in range(segs):
                k2 = (k + 1) % segs
                q = [ring_t[k], ring_t[k2], ring_h[k2], ring_h[k]]
                cols = [(*mixc(mid, lite, 0.65), wv(q[0])), (*mixc(mid, lite, 0.65), wv(q[1])), (*mid, wv(q[2])), (*mid, wv(q[3]))]
                g.face(q, cols, True, center=(0, 0, z))
                t = [ring_h[k], ring_h[k2], tips[k]]
                g.face(t, [(*mid, wv(t[0])), (*mid, wv(t[1])), (*scl(lite, 0.95), wv(t[2]))], True, center=(0, 0, z))
        blob(g, (0, 0, 7.05), (0.2, 0.2, 0.4), 0, 5.5, mid, lite, lambda p: 1.0, amp=0.06)
    else:
        for (z0, z1, r) in [(1.2, 3.6, 0.98), (3.0, 5.6, 0.78), (5.0, 7.4, 0.45)]:
            lathe(g, 0, 0, [(r, z0), (0.02, z1)], 8, lambda p, j: mixc(mid, lite, 0.4) if j else mid, lambda p: 0.25 + 0.75 * p[2] / H, close_top=False, close_bot=True)
    return g


def build_cemara(lod):
    g = Geo()
    H = 7.2
    tube(g, [(0, 0, 0), (0, 0, 1.2)], [0.17, 0.13], 6 if lod == 0 else 3, trunk_col(BARK_D, BARK), lambda t, p: 0.05 * t, cap1=False)
    dark, lite = L('#2a5535'), L('#4a7c4c')
    if lod == 0:
        cones = [(0.8, 1.35, 2.6), (1.7, 1.2, 2.5), (2.6, 1.02, 2.4), (3.5, 0.84, 2.2), (4.4, 0.64, 2.0), (5.3, 0.42, 1.9)]
        for j, (z, r, h) in enumerate(cones):
            prof = [(r * 0.62, z), (r, z + 0.25), (r * 0.55, z + h * 0.55), (0.04, z + h)]
            lathe(g, 0, 0, prof, 10, lambda p, k, z=z, h=h: mixc(dark, lite, clamp((p[2] - z) / h * 0.8 + 0.1 + 0.15 * math.hypot(p[0], p[1]))),
                  lambda p: clamp(0.3 + 0.55 * p[2] / H + 0.25 * math.hypot(p[0], p[1])), seed=j * 3.1, jag=0.14, phase=j * 0.3, close_top=False, close_bot=True)
    else:
        for (z, r, h) in [(0.9, 1.45, 3.9), (3.3, 1.0, 3.9)]:
            lathe(g, 0, 0, [(r, z), (0.04, z + h)], 8, lambda p, k: mixc(dark, lite, 0.15 + 0.6 * k), lambda p: 0.3 + 0.7 * p[2] / H, close_top=False, close_bot=True)
    return g


# ---------------------------------------------------------------- semak & ilalang
def build_semak_a():
    g = Geo()
    wind = lambda p: clamp(0.08 + 0.55 * p[2] / 1.0)
    for i, (x, y, z, s) in enumerate([(0.0, 0.0, 0.55, 0.52), (0.42, 0.18, 0.42, 0.4), (-0.36, 0.25, 0.4, 0.38), (0.05, -0.4, 0.38, 0.4)]):
        blob(g, (x, y, z), (s * 1.15, s * 1.15, s * 0.9), 1, i * 2.9, L('#2f5a2a'), L('#5e9746'), wind, amp=0.15, flat_bottom=0.55)
    return g


def build_semak_b():  # soka: daun gelap mengilap + kelopak bunga merah-jingga
    g = Geo()
    wind = lambda p: clamp(0.08 + 0.55 * p[2] / 1.0)
    for i, (x, y, z, s) in enumerate([(0.0, 0.0, 0.5, 0.5), (0.38, -0.12, 0.38, 0.38), (-0.3, -0.25, 0.36, 0.36)]):
        blob(g, (x, y, z), (s * 1.2, s * 1.2, s * 0.92), 1, 5 + i * 2.3, L('#284d26'), L('#4f8a3c'), wind, amp=0.14, flat_bottom=0.55)
    V, F = ico(0)
    for i in range(10):
        a = i * 2.39996 + 0.3
        r = 0.18 + 0.42 * math.sqrt(hsh(i, 9))
        cx, cy = math.cos(a) * r, math.sin(a) * r
        cz = 0.58 + 0.38 * (1 - (r / 0.62) ** 2) + 0.05 * hsh(i, 4)
        col = L('#e8452f') if i % 3 else L('#f2843a')
        ids = [g.vert((cx + p[0] * 0.075, cy + p[1] * 0.075, cz + p[2] * 0.06)) for p in V]
        for f in F[::2]:  # setengah ikosahedron cukup untuk gugus bunga kecil
            g.face([ids[k] for k in f], [(*col, 0.6)] * 3, True, center=(cx, cy, cz))
    return g


def build_ilalang(var):
    g = Geo()
    base_c, mid_c, tip_c = L('#3d5a2a'), L('#7a9a3a'), L('#c8c870')
    if var == 'a':
        n, hmin, hmax, lean0, bend = 13, 1.0, 1.28, 0.08, 0.32
    elif var == 'b':
        n, hmin, hmax, lean0, bend = 12, 1.0, 1.3, 0.2, 0.45
    else:
        n, hmin, hmax, lean0, bend = 10, 0.95, 1.2, 0.12, 0.38
    for i in range(n):
        az = i * 2.39996 + 0.7 * hsh(i, 1, ord(var))
        rad = 0.05 + 0.1 * hsh(i, 2, ord(var))
        h = hmin + (hmax - hmin) * hsh(i, 3, ord(var))
        lean = lean0 + 0.25 * hsh(i, 4, ord(var))
        base = (math.cos(az) * rad, math.sin(az) * rad, 0.0)
        tipc = mixc(tip_c, mid_c, 0.35 * hsh(i, 6, ord(var)))
        blade(g, base, az, lean, h, 0.04 + 0.014 * hsh(i, 5, ord(var)), bend * (0.7 + 0.6 * hsh(i, 7, ord(var))), base_c, mid_c, tipc, seed=i)
    if var == 'c':  # dua tangkai bunga ilalang berbulu putih
        for i in range(2):
            az = 1.1 + i * 2.6
            base = (math.cos(az) * 0.04, math.sin(az) * 0.04, 0.0)
            blade(g, base, az, 0.1 + 0.06 * i, 1.38 - 0.08 * i, 0.05, 0.12, L('#7f8a4a'), L('#cfcaa8'), L('#efeadb'), tip_col=L('#f4f1e6'), seed=20 + i)
    return g


# ---------------------------------------------------------------- objek & ekspor
VARIANTS = [
    ('trembesi', 0, build_trembesi), ('ketapang', 0, build_ketapang),
    ('palem_raja', 1, build_palem_raja), ('kelapa', 1, build_kelapa),
    ('glodokan', 2, build_glodokan), ('cemara', 2, build_cemara),
]
SINGLE = [('semak_a', 'bush', build_semak_a), ('semak_b', 'bush', build_semak_b),
          ('ilalang_a', 'grass', lambda: build_ilalang('a')), ('ilalang_b', 'grass', lambda: build_ilalang('b')), ('ilalang_c', 'grass', lambda: build_ilalang('c'))]


def make_obj(name, g):
    me = bpy.data.meshes.new(name)
    me.from_pydata(g.v, [], g.f)
    me.update()
    assert len(me.polygons) == len(g.f), (name, len(me.polygons), len(g.f))
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly, cols, sm in zip(me.polygons, g.c, g.sm):
        poly.use_smooth = sm
        for li, col in zip(poly.loop_indices, cols):
            attr.data[li].color = col
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
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
        meta.append({'name': name, 'group': grp, 'height': round(b[5], 3), 'crownRadius': round(max(abs(b[0]), abs(b[1]), abs(b[2]), abs(b[3])), 3),
                     'tris': {'lod0': g0.tris(), 'lod1': g1.tris()}})
        log(name, 'lod0', g0.tris(), 'lod1', g1.tris(), 'H', round(b[5], 2), 'R', meta[-1]['crownRadius'])
    for name, grp, fn in SINGLE:
        g0 = fn()
        b = g0.bounds()
        objs.append(make_obj(name + '_lod0', g0))
        meta.append({'name': name, 'group': grp, 'height': round(b[5], 3), 'crownRadius': round(max(abs(b[0]), abs(b[1]), abs(b[2]), abs(b[3])), 3),
                     'tris': {'lod0': g0.tris(), 'lod1': None}})
        log(name, 'lod0', g0.tris(), 'H', round(b[5], 2))
    return objs, meta


def export(objs, meta):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, 'trees.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_normals=True, export_texcoords=False, export_tangents=False, export_cameras=False,
                              export_lights=False, export_animations=False, export_extras=False, export_draco_mesh_compression_enable=False)
    with open(os.path.join(OUT, 'trees.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    log('ekspor', path, os.path.getsize(path), 'byte')


# ---------------------------------------------------------------- preview
def vc_material():
    m = bpy.data.materials.get('vc') or bpy.data.materials.new('vc')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    ca = nt.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'Col'
    nt.links.new(ca.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.82
    try:
        b.inputs['Specular IOR Level'].default_value = 0.25
    except Exception:
        pass
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


def sky_world(strength=0.5):
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
    for k, v in (('sun_elevation', 28 * D2R), ('sun_rotation', 205 * D2R), ('sun_disc', False), ('altitude', 0.0)):
        try:
            setattr(sky, k, v)
        except Exception:
            pass
    bg = nt.nodes.get('Background')
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    sd = bpy.data.lights.new('sun', 'SUN')
    sd.energy = 2.8
    sd.angle = 3 * D2R
    sd.color = (1.0, 0.9, 0.76)
    sun = bpy.data.objects.new('sun', sd)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (60 * D2R, 0, 205 * D2R + pi)


def stage(objs_by_name, layout, cam_loc, cam_target, lens=35):
    """Salin (linked) objek ke posisi tata letak; layout = [(nama, x, y, rotz)]."""
    mat = vc_material()
    placed = []
    for name, x, y, rz in layout:
        src = objs_by_name[name]
        if not src.data.materials:
            src.data.materials.append(mat)
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
    d = (cam_target[0] - cam_loc[0], cam_target[1] - cam_loc[1], cam_target[2] - cam_loc[2])
    from mathutils import Vector
    cam.rotation_euler = Vector(d).to_track_quat('-Z', 'Y').to_euler()
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
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    for vt in ('Filmic', 'Khronos PBR Neutral', 'Standard'):
        try:
            scn.view_settings.view_transform = vt
            break
        except Exception:
            continue
    for lk in ('Medium High Contrast', 'Filmic - Medium High Contrast'):
        try:
            scn.view_settings.look = lk
            break
        except Exception:
            continue


def clear_stage(placed):
    for o in placed:
        bpy.data.objects.remove(o, do_unlink=True)


LINEUP = [  # (nama, x, y, rotz)
    ('cemara_lod0', -21.5, 7.0, 0.3), ('palem_raja_lod0', -14.5, 5.0, 0.2), ('trembesi_lod0', -6.0, 9.0, 0.6), ('kelapa_lod0', 2.5, 4.5, 2.4),
    ('ketapang_lod0', 10.0, 8.0, 0.2), ('glodokan_lod0', 16.5, 5.0, 0.0), ('palem_raja_lod0', 22.5, 10.0, 1.3),
    ('semak_a_lod0', -9.5, -1.5, 0.0), ('semak_b_lod0', -7.6, -2.6, 1.0), ('semak_a_lod0', 6.0, -1.0, 2.0), ('semak_b_lod0', 13.5, 0.5, 0.4),
    ('ilalang_a_lod0', -2.4, -5.0, 0.0), ('ilalang_b_lod0', -1.4, -4.6, 1.0), ('ilalang_c_lod0', -0.4, -5.2, 2.0), ('ilalang_a_lod0', 0.6, -4.7, 3.0),
    ('ilalang_b_lod0', 1.6, -5.1, 4.0), ('ilalang_c_lod0', -3.3, -4.4, 5.0), ('ilalang_a_lod0', 2.5, -4.3, 0.5), ('ilalang_b_lod0', -1.0, -3.8, 2.5),
] + [  # hamparan ilalang (tempat bersembunyi) di depan kiri
    (('ilalang_a_lod0', 'ilalang_b_lod0', 'ilalang_c_lod0')[i % 3], -13.5 + (i % 9) * 0.85 + 0.35 * math.sin(i * 7.1), -7.6 + (i // 9) * 0.8 + 0.3 * math.cos(i * 3.3), i * 1.7)
    for i in range(54)
]


def previews(objs, quick_dir=None):
    by = {o.name: o for o in objs}
    for o in objs:
        o.hide_render = True  # hanya salinan yang ditata yang dirender
    out = quick_dir or PREV
    os.makedirs(out, exist_ok=True)
    sky_world()
    # lineup
    placed = stage(by, LINEUP, (0.0, -25.0, 2.6), (0.0, 4.0, 4.4), lens=26)
    render_engine(bool(quick_dir), 1920 if not quick_dir else 1280, 1080 if not quick_dir else 720)
    bpy.context.scene.render.filepath = os.path.join(out, 'lineup.png')
    bpy.ops.render.render(write_still=True)
    log('render', bpy.context.scene.render.filepath)
    clear_stage(placed)
    # lod0 (depan, kiri) vs lod1 (belakang, kanan) berpasangan
    names = ['trembesi', 'ketapang', 'palem_raja', 'kelapa', 'glodokan', 'cemara']
    lay = []
    widths = [max(by[n + '_lod0'].dimensions.x, by[n + '_lod0'].dimensions.y) * 0.5 + 0.6 for n in names]  # jari-jari tajuk + celah
    total = sum(4 * w for w in widths)
    x = -total / 2
    for n, w in zip(names, widths):
        lay.append((n + '_lod0', x + w, 0.0, 0.4))
        lay.append((n + '_lod1', x + 3 * w, 0.0, 0.4))
        x += 4 * w
    lens = 22
    dist = (total / 2 + 1.5) / (18 / lens)  # setengah lebar bidang pandang ≥ setengah barisan
    placed = stage(by, lay, (0.0, -dist, 4.5), (0.0, 0.0, 4.6), lens=lens)
    render_engine(bool(quick_dir), 1920 if not quick_dir else 1280, 1080 if not quick_dir else 720)
    bpy.context.scene.render.filepath = os.path.join(out, 'lod.png')
    bpy.ops.render.render(write_still=True)
    log('render', bpy.context.scene.render.filepath)
    clear_stage(placed)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs, meta = build_all()
    if not opt('--no-export'):
        export(objs, meta)
    q = opt('--quick')
    if q:
        previews(objs, quick_dir=os.path.abspath(q))
    if opt('--preview'):
        previews(objs)


main()
