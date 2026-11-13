"""Sutera Royale: karakter orisinal low-poly dari bagian kaku per tulang (Blender headless).

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/characters.py -- [opsi]

Opsi:
  --no-export      lewati ekspor GLB + JSON
  --quick          render cek cepat (EEVEE) ke --qdir
  --shots          render preview Cycles: preview/characters/hero.png + lineup.png
  --samples N      sampel Cycles (default 128)
  --out DIR        folder ekspor (default web/game/assets/characters)
  --preview DIR    folder preview (default preview/characters)

Kontrak (dipakai rig karakter di web/map/rig.js):
  - glTF: +Y atas, karakter menghadap +Z, kiri karakter = +X (Blender: menghadap −Y, kiri = +X).
  - Satu objek per tulang (bagian kaku), top-level, origin tepat di pivot sendi, rotasi 0, skala 1:
      hips spine chest neck head armL armR foreL foreR handL handR thighL thighR shinL shinR footL footR
    Perlengkapan dengan origin = pivot tulang tempatnya menempel:
      hair hair_long cap helmet (head) · vest pack stripe (chest)
  - Warna verteks COLOR_0 (linear): putih = diwarnai game sesuai slot (pants/shirt/sleeve/skin/hair/shoes/gear/pack/trim);
    warna lain = detail (ikut dikalikan warna slot, jadi detail gelap tetap gelap). cap berwarna tetap.
  - Pose diam = pose istirahat rig: berdiri tegak, lengan lurus ke bawah, kaki lurus.
  - Bagian bertumpuk di sendi (kubah bulat berpusat di pivot) supaya tidak bercelah saat diputar.
"""
import bpy
import bmesh
import json
import math
import os
import sys
import time
import warnings
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

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
OUT = os.path.abspath(opt('--out', os.path.join(ROOT, 'web', 'game', 'assets', 'characters')))
PREV = os.path.abspath(opt('--preview', os.path.join(ROOT, 'preview', 'characters')))
QDIR = os.path.abspath(opt('--qdir', os.path.join(PREV, 'quick')))
SAMPLES = int(opt('--samples', 128))

pi = math.pi
D2R = pi / 180
C3 = Matrix.Rotation(pi / 2, 3, 'X')  # glTF (x, y, z) → Blender (x, −z, y)
C4 = C3.to_4x4()


def log(*a):
    print('[char]', *a, flush=True)


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def lin(h):
    return (*srgb(h), 1.0)


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- kontrak
PIVOT = {
    'hips': (0, 0.98, 0), 'spine': (0, 1.08, 0), 'chest': (0, 1.28, 0), 'neck': (0, 1.55, 0), 'head': (0, 1.62, 0),
    'armL': (0.20, 1.49, 0), 'armR': (-0.20, 1.49, 0), 'foreL': (0.20, 1.21, 0), 'foreR': (-0.20, 1.21, 0),
    'handL': (0.20, 0.96, 0), 'handR': (-0.20, 0.96, 0),
    'thighL': (0.10, 0.93, 0), 'thighR': (-0.10, 0.93, 0), 'shinL': (0.10, 0.50, 0), 'shinR': (-0.10, 0.50, 0),
    'footL': (0.10, 0.08, 0), 'footR': (-0.10, 0.08, 0),
}
PARENT = {
    'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
    'armL': 'chest', 'foreL': 'armL', 'handL': 'foreL', 'armR': 'chest', 'foreR': 'armR', 'handR': 'foreR',
    'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR',
}
GUN_MOUNT = (-0.13, 1.34, 0.24)
SLOT = {
    'hips': 'pants', 'thighL': 'pants', 'thighR': 'pants', 'shinL': 'pants', 'shinR': 'pants',
    'spine': 'shirt', 'chest': 'shirt', 'armL': 'shirt', 'armR': 'shirt', 'foreL': 'sleeve', 'foreR': 'sleeve',
    'neck': 'skin', 'head': 'skin', 'handL': 'skin', 'handR': 'skin', 'footL': 'shoes', 'footR': 'shoes',
    'hair': 'hair', 'hair_long': 'hair', 'helmet': 'gear', 'vest': 'gear', 'pack': 'pack', 'stripe': 'trim', 'cap': 'cap',
}
GEAR_BONE = {'hair': 'head', 'hair_long': 'head', 'cap': 'head', 'helmet': 'head', 'vest': 'chest', 'pack': 'chest',
             'stripe': 'chest'}
BODY = list(PIVOT)
GEAR = list(GEAR_BONE)

# warna detail (dikalikan warna slot di game)
EYE, BROW, LIP = '#1f1c22', '#2b221d', '#b06e62'
BELT, BUCKLE, SOLE = '#2a2a2e', '#a8a8a8', '#2a2a2e'
COLLAR, POCKET, BUTTON, CUFF = '#e6e2da', '#d9d5cc', '#bdb9b1', '#d8d4cc'
STRAP_DARK, MOUNT = '#3a3a3e', '#4a4a4f'
CAP_PURPLE, CAP_BRIM, GOLD = '#3D3782', '#2e2a6a', '#D29F52'


# ---------------------------------------------------------------- pembangun mesh (ruang glTF, Y atas, depan +Z)
class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.cl = self.bm.loops.layers.float_color.new('Col')
        self.orient = []  # (faces, fn(p) → arah 'luar') untuk permukaan terbuka

    def mark(self, before, fn):
        self.orient.append(([f for f in self.bm.faces if f not in before], fn))

    def vert(self, p):
        return self.bm.verts.new(Vector(p))

    def face(self, vs, col='#ffffff', smooth=True):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        c = lin(col)
        for lp in f.loops:
            lp[self.cl] = c
        f.smooth = smooth
        return f

    def add(self, src, col='#ffffff', M=None, smooth=False):
        """Salin bmesh src (dibebaskan) dengan transformasi M dan satu warna."""
        flip = M is not None and M.to_3x3().determinant() < 0
        vm = {v: self.vert(M @ v.co if M is not None else v.co) for v in src.verts}
        out = []
        for f in src.faces:
            vs = [vm[v] for v in f.verts]
            if flip:
                vs.reverse()
            nf = self.face(vs, col, smooth)
            if nf:
                out.append(nf)
        src.free()
        return out

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Rx(r):
    return Matrix.Rotation(r, 4, 'X')


def Ry(r):
    return Matrix.Rotation(r, 4, 'Y')


def Rz(r):
    return Matrix.Rotation(r, 4, 'Z')


MIRROR = Matrix.Diagonal((-1, 1, 1, 1))


def sup(c, e):
    return math.copysign(abs(c) ** (2.0 / e), c)


def ring(y, rx, rzf, rzb=None, n=12, cx=0.0, cz=0.0, e=2.0):
    """Penampang horizontal superelips di ketinggian y. rzf = jari-jari depan (+Z), rzb = belakang."""
    rzb = rzf if rzb is None else rzb
    pts = []
    for i in range(n):
        a = 2 * pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        pts.append((cx + rx * sup(ca, e), y, cz + (rzf if sa >= 0 else rzb) * sup(sa, e)))
    return pts


def loft(m, rings, col='#ffffff', poles=(None, None), smooth=True, colfn=None):
    """Sambung cincin berurutan. poles = (titik kutub sebelum cincin pertama, setelah cincin terakhir) atau None."""
    vr = [[m.vert(p) for p in r] for r in rings]
    n = len(rings[0])
    for i in range(len(vr) - 1):
        A, B = vr[i], vr[i + 1]
        for j in range(n):
            j2 = (j + 1) % n
            m.face([A[j], A[j2], B[j2], B[j]], colfn(i, j) if colfn else col, smooth)
    for k, pole in enumerate(poles):
        if pole is None:
            continue
        R = vr[0] if k == 0 else vr[-1]
        pv = m.vert(pole)
        ci = 0 if k == 0 else len(vr) - 2
        for j in range(n):
            j2 = (j + 1) % n
            m.face([R[j], R[j2], pv] if k == 1 else [R[j2], R[j], pv], colfn(ci, j) if colfn else col, smooth)
    return vr


def limb(m, top, mids, bot, n=10, col='#ffffff', colfn=None, dome=0.85):
    """Anggota badan sepanjang −Y: kubah bulat di sendi atas (berpusat di pivot) dan sendi bawah.
    top/bot = (y, rx, rz, cx, cz); mids = [(y, rx, rzf, rzb, cx, cz), ...]."""
    y0, rx0, rz0, cx0, cz0 = top
    y1, rx1, rz1, cx1, cz1 = bot
    R0, R1 = max(rx0, rz0), max(rx1, rz1)
    c45 = math.cos(pi / 4)
    rings = [ring(y0 + R0 * c45 * dome, rx0 * c45, rz0 * c45, None, n, cx0, cz0),
             ring(y0, rx0, rz0, None, n, cx0, cz0)]
    for (y, rx, rzf, rzb, cx, cz) in mids:
        rings.append(ring(y, rx, rzf, rzb, n, cx, cz))
    rings.append(ring(y1, rx1, rz1, None, n, cx1, cz1))
    rings.append(ring(y1 - R1 * c45 * dome, rx1 * c45, rz1 * c45, None, n, cx1, cz1))
    return loft(m, rings, col, ((cx0, y0 + R0 * dome, cz0), (cx1, y1 - R1 * dome, cz1)), True, colfn)


def ellipsoid(m, c, r, u=10, v=6, col='#ffffff', deform=None, smooth=True):
    """Bola lonjong; kutub di ±Y. azimut 0 = depan (+Z)."""
    cx, cy, cz = c
    rx, ry, rz = r
    rings = []
    for k in range(1, v):
        th = pi * k / v
        s_ = math.sin(th)
        y = cy + ry * math.cos(th)
        pts = []
        for i in range(u):
            a = 2 * pi * i / u
            p = (cx + rx * s_ * math.sin(a), y, cz + rz * s_ * math.cos(a))
            pts.append(deform(p) if deform else p)
        rings.append(pts)
    top, bot = (cx, cy + ry, cz), (cx, cy - ry, cz)
    if deform:
        top, bot = deform(top), deform(bot)
    return loft(m, rings, col, (top, bot), smooth)


def shell(m, c, r, u, rows, edge_y, col='#ffffff', deform=None, tuck=0.93, lip_col=None, lip_out=0.0, lip_down=0.0,
          smooth=True):
    """Tudung (rambut/helm/topi): kolom-kolom dari kutub atas sampai garis tepi edge_y(azimut) (y absolut).
    Tepi diberi bibir: satu cincin keluar/turun (lip_out/lip_down) lalu masuk ke dalam (tuck) supaya tidak setipis kertas."""
    cx, cy, cz = c
    rx, ry, rz = r
    cols = []
    for i in range(u):
        a = 2 * pi * i / u
        ye = edge_y(a)
        th_e = math.acos(clamp((ye - cy) / ry, -0.999, 0.999))
        col_pts = []
        for k in range(1, rows + 1):
            th = th_e * k / rows
            p = (cx + rx * math.sin(th) * math.sin(a), cy + ry * math.cos(th), cz + rz * math.sin(th) * math.cos(a))
            col_pts.append(deform(p) if deform else p)
        e = Vector(col_pts[-1])
        ctr = Vector((cx, cy, cz))
        d = (e - ctr)
        hor = Vector((d.x, 0, d.z)).normalized() if (d.x * d.x + d.z * d.z) > 1e-9 else Vector((0, 0, 1))
        if lip_out or lip_down:
            col_pts.append(tuple(e + hor * lip_out + Vector((0, -lip_down, 0))))
        col_pts.append(tuple(ctr + (Vector(col_pts[-1]) - ctr) * tuck))
        cols.append(col_pts)
    nr = len(cols[0])
    rings = [[cols[i][k] for i in range(u)] for k in range(nr)]
    top = (cx, cy + ry, cz)
    if deform:
        top = deform(top)
    nlip = 2 if (lip_out or lip_down) else 1

    def colfn(i, j):
        return lip_col if (lip_col and i >= nr - 1 - nlip) else col

    before = set(m.bm.faces)
    out = loft(m, rings, col, (top, None), smooth, colfn)
    m.mark(before, from_center((cx, cy - ry * 0.25, cz)))
    return out


def box(m, size, M, col='#ffffff', bevel=0.0, smooth=False):
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bevel = min(bevel, sx * 0.49, sy * 0.49, sz * 0.49)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type='OFFSET', segments=1, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    return m.add(bm, col, M, smooth)


def strip(m, pts, w, t, col='#ffffff', nfn=None):
    """Tali pipih mengikuti titik-titik: lebar w di permukaan, tebal t searah normal permukaan nfn(p)."""
    pts = [Vector(p) for p in pts]
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = Vector(nfn(p)).normalized()
        nrm = (nrm - d * nrm.dot(d)).normalized()
        side = nrm.cross(d).normalized()
        a, b = p + side * w / 2, p - side * w / 2
        rings.append([tuple(a + nrm * t / 2), tuple(b + nrm * t / 2), tuple(b - nrm * t / 2), tuple(a - nrm * t / 2)])
    loft(m, rings, col, (None, None), False)
    m.face([m.vert(p) for p in reversed(rings[0])], col, False)
    m.face([m.vert(p) for p in rings[-1]], col, False)


def bvh_of(m):
    return BVHTree.FromBMesh(m.bm)


def hit(bvh, origin, direction):
    loc, nrm, idx, dist = bvh.ray_cast(Vector(origin), Vector(direction).normalized())
    return loc


def surf_z(bvh, x, y, front=True):
    p = hit(bvh, (x, y, 0.6 if front else -0.6), (0, 0, -1 if front else 1))
    return p.z if p else 0.0


def surf_x(bvh, y, z, side=1):
    p = hit(bvh, (0.6 * side, y, z), (-side, 0, 0))
    return p.x if p else 0.0


def finish(m):
    bmesh.ops.remove_doubles(m.bm, verts=m.bm.verts, dist=1e-6)
    open_faces = {f for fs, _ in m.orient for f in fs if f.is_valid}
    bmesh.ops.recalc_face_normals(m.bm, faces=[f for f in m.bm.faces if f not in open_faces])
    m.bm.normal_update()
    for fs, fn in m.orient:
        flip = [f for f in fs if f.is_valid and f.normal.dot(Vector(fn(f.calc_center_median()))) < 0]
        if flip:
            bmesh.ops.reverse_faces(m.bm, faces=flip)
    m.bm.normal_update()
    return m


def axis_out(p):  # pita terbuka mengelilingi sumbu Y
    return (p.x, 0.0, p.z)


def from_center(c):
    return lambda p: (p.x - c[0], p.y - c[1], p.z - c[2])


# ---------------------------------------------------------------- bagian tubuh (koordinat relatif pivot)
def build_hips():
    m = Mesh()
    n, e = 12, 2.3
    R = [  # (y, rx, rzf, rzb)
        (-0.115, 0.112, 0.074, 0.080),
        (-0.075, 0.150, 0.088, 0.102),
        (-0.03, 0.168, 0.092, 0.110),
        (0.02, 0.165, 0.091, 0.102),
        (0.065, 0.156, 0.090, 0.094),
        (0.105, 0.150, 0.091, 0.091),
        (0.135, 0.146, 0.090, 0.090),
    ]
    loft(m, [ring(y, rx, f, b, n, e=e) for (y, rx, f, b) in R], '#ffffff', ((0, -0.15, 0.0), (0, 0.14, 0)))
    # sabuk + gesper
    before = set(m.bm.faces)
    loft(m, [ring(0.05, 0.161, 0.096, 0.100, n, e=e), ring(0.088, 0.157, 0.096, 0.097, n, e=e)], BELT, (None, None), True)
    m.mark(before, axis_out)
    bvh = bvh_of(m)
    box(m, (0.046, 0.034, 0.012), T(0, 0.069, surf_z(bvh, 0, 0.069) + 0.004), BUCKLE)
    return finish(m)


def build_spine():
    m = Mesh()
    n, e = 12, 2.3
    R = [(-0.06, 0.151, 0.091, 0.092), (0.0, 0.148, 0.093, 0.091), (0.08, 0.150, 0.098, 0.093),
         (0.16, 0.157, 0.104, 0.098), (0.235, 0.161, 0.108, 0.101)]
    loft(m, [ring(y, rx, f, b, n, e=e) for (y, rx, f, b) in R], '#ffffff', ((0, -0.07, 0), (0, 0.245, 0)))
    bvh = bvh_of(m)
    box(m, (0.012, 0.012, 0.006), T(0, 0.10, surf_z(bvh, 0, 0.10) + 0.001), BUTTON)
    return finish(m)


CHEST = [(-0.06, 0.156, 0.104, 0.098), (0.02, 0.168, 0.112, 0.102), (0.10, 0.182, 0.124, 0.106),
         (0.165, 0.192, 0.120, 0.107), (0.205, 0.206, 0.104, 0.100), (0.232, 0.200, 0.088, 0.090),
         (0.252, 0.168, 0.076, 0.080), (0.274, 0.108, 0.066, 0.070)]


def chest_ring_at(y, n=12, e=2.4, grow=0.0):
    for (ya, a1, b1, c1), (yb, a2, b2, c2) in zip(CHEST, CHEST[1:]):
        if ya <= y <= yb:
            t = (y - ya) / (yb - ya)
            return ring(y, lerp(a1, a2, t) + grow, lerp(b1, b2, t) + grow, lerp(c1, c2, t) + grow, n, e=e)
    return ring(y, 0.18 + grow, 0.12 + grow, 0.105 + grow, n, e=e)


def build_chest():
    m = Mesh()
    loft(m, [ring(y, rx, f, b, 12, e=2.4) for (y, rx, f, b) in CHEST], '#ffffff', ((0, -0.07, 0), (0, 0.29, -0.004)))
    # kerah
    before = set(m.bm.faces)
    loft(m, [ring(0.270, 0.100, 0.070, 0.075, 12), ring(0.302, 0.078, 0.062, 0.066, 12)], COLLAR, (None, None), True)
    m.mark(before, axis_out)
    bvh = bvh_of(m)
    # saku dada + kancing
    for s_ in (1, -1):
        x, y = 0.076 * s_, 0.072
        box(m, (0.068, 0.07, 0.008), T(x, y, surf_z(bvh, x, y) - 0.001) @ Rx(-0.10), POCKET)
    for y in (0.0, 0.16):
        box(m, (0.012, 0.012, 0.006), T(0, y, surf_z(bvh, 0, y) + 0.001), BUTTON)
    return finish(m)


def build_neck():
    m = Mesh()
    rings = [ring(y, 0.056, 0.060, 0.058, 8, cz=-0.008) for y in (-0.04, 0.045, 0.13)]
    loft(m, rings, '#ffffff', ((0, -0.05, -0.008), (0, 0.14, -0.008)))
    return finish(m)


HC = (0.0, 0.098, 0.006)
HR = (0.100, 0.121, 0.114)


def head_deform(p):
    x, y, z = p[0], p[1] - HC[1], p[2] - HC[2]
    t = clamp(-y / HR[1], 0.0, 1.0)  # 0 setinggi pusat → 1 di dagu
    x *= 1 - 0.30 * t ** 1.3
    if z > 0:
        z *= 1 - 0.07 * t
        z += 0.014 * t * t * clamp(z / HR[2], 0, 1)  # dagu sedikit maju
    if y > 0:
        x *= 1.0 + 0.035 * (y / HR[1])
        if z < 0:
            z *= 1.05
    if z > 0.068:
        z = 0.068 + (z - 0.068) * 0.62  # bidang wajah
    if z > 0.02 and abs(x) > 0.05 and -0.04 < y < 0.02:
        x *= 1.035  # tulang pipi
    return (x, y + HC[1], z + HC[2])


def build_head():
    m = Mesh()
    ellipsoid(m, HC, HR, 14, 10, '#ffffff', head_deform)
    bvh = bvh_of(m)
    cy = HC[1]
    # mata (almond gelap), alis, hidung, bibir, telinga
    for s_ in (1, -1):
        x, y = 0.036 * s_, cy + 0.008
        sub = Mesh()
        ellipsoid(sub, (0, 0, 0), (0.0135, 0.0078, 0.0065), 6, 3)
        m.add(sub.bm, EYE, T(x, y, surf_z(bvh, x, y) - 0.0008) @ Rz(0.10 * s_), True)
        xb, yb = 0.038 * s_, cy + 0.029
        box(m, (0.030, 0.0058, 0.007), T(xb, yb, surf_z(bvh, xb, yb) + 0.0005) @ Rz(-0.14 * s_), BROW)
    sz = lambda y: surf_z(bvh, 0, y)
    Tp = m.vert((0, cy + 0.019, sz(cy + 0.019) - 0.003))
    P = m.vert((0, cy - 0.017, sz(cy - 0.017) + 0.022))
    L = m.vert((0.0145, cy - 0.025, sz(cy - 0.025) - 0.001))
    Rv = m.vert((-0.0145, cy - 0.025, sz(cy - 0.025) - 0.001))
    B = m.vert((0, cy - 0.027, sz(cy - 0.027) + 0.012))
    for vs in ([Tp, L, P], [Tp, P, Rv], [P, L, B], [P, B, Rv], [Tp, Rv, B, L]):
        m.face(vs, '#ffffff', False)
    sub = Mesh()
    ellipsoid(sub, (0, 0, 0), (0.020, 0.0050, 0.0044), 6, 3)
    m.add(sub.bm, LIP, T(0, cy - 0.058, sz(cy - 0.058) - 0.0008), True)
    for s_ in (1, -1):
        x = surf_x(bvh, cy - 0.002, -0.004, s_)
        sub = Mesh()
        ellipsoid(sub, (0, 0, 0), (0.011, 0.032, 0.020), 5, 3)
        m.add(sub.bm, '#ffffff', T(x + 0.002 * s_, cy - 0.002, -0.004) @ Rz(-0.08 * s_), True)
    return finish(m)


def build_arm(side=1):
    m = Mesh()
    s_ = side
    limb(m, (0.0, 0.054, 0.052, 0.004 * s_, 0.0),
         [(-0.07, 0.052, 0.052, 0.050, 0.003 * s_, 0.0), (-0.16, 0.048, 0.050, 0.046, 0.0, 0.003)],
         (-0.28, 0.043, 0.043, 0.0, 0.0), 10, dome=0.45)
    return finish(m)


def build_fore(side=1):
    m = Mesh()

    def colfn(i, j):
        return CUFF if i >= 4 else '#ffffff'

    limb(m, (0.0, 0.0445, 0.0445, 0.0, 0.0),
         [(-0.07, 0.045, 0.044, 0.043, 0.0, 0.002), (-0.19, 0.039, 0.038, 0.038, 0.0, 0.0)],
         (-0.24, 0.041, 0.040, 0.0, 0.0), 10, '#ffffff', colfn, dome=0.55)
    return finish(m)


def build_hand(side=1):
    m = Mesh()
    s_ = side
    # telapak (tebal di X; pangkalnya masuk ke manset), jari menekuk ke arah telapak (−X untuk tangan kiri), ibu jari di depan
    box(m, (0.032, 0.105, 0.074), T(-0.003 * s_, -0.045, 0.004), '#ffffff', 0.011, True)
    box(m, (0.025, 0.056, 0.066), T(-0.010 * s_, -0.116, 0.005) @ Rz(-0.30 * s_), '#ffffff', 0.0, True)
    box(m, (0.021, 0.052, 0.021), T(-0.010 * s_, -0.052, 0.045) @ Rx(-0.45) @ Rz(-0.25 * s_), '#ffffff', 0.0, True)
    return finish(m)


def build_thigh(side=1):
    m = Mesh()
    s_ = side
    limb(m, (0.0, 0.075, 0.077, 0.0, 0.0),
         [(-0.06, 0.080, 0.083, 0.080, 0.004 * s_, 0.0), (-0.18, 0.074, 0.076, 0.072, 0.003 * s_, 0.002),
          (-0.32, 0.064, 0.065, 0.063, 0.0, 0.0)],
         (-0.43, 0.057, 0.058, 0.0, 0.0), 10, dome=0.8)
    bvh = bvh_of(m)
    x = surf_x(bvh, -0.24, 0.0, s_)
    box(m, (0.012, 0.10, 0.085), T(x + 0.001 * s_, -0.24, 0.002), POCKET)
    return finish(m)


def build_shin(side=1):
    m = Mesh()
    limb(m, (0.0, 0.0585, 0.0595, 0.0, 0.0),
         [(-0.10, 0.058, 0.060, 0.066, 0.0, -0.005), (-0.30, 0.050, 0.051, 0.053, 0.0, 0.0)],
         (-0.41, 0.056, 0.058, 0.0, 0.004), 10, dome=0.45)
    return finish(m)


def build_foot(side=1):
    m = Mesh()
    # batang sepatu bot (ujung atasnya di dalam ujung celana) + badan sepatu yang gempal
    loft(m, [ring(0.075, 0.049, 0.051, None, 8), ring(0.02, 0.052, 0.057, 0.054, 8), ring(-0.03, 0.053, 0.064, 0.056, 8)],
         '#ffffff', ((0, 0.085, 0), None))
    sec = []  # penampang bidang XY sepanjang Z: (z, setengah lebar, y bawah, y atas); bawah = sol gelap
    for (z, hw, yb, yt) in ((-0.068, 0.045, -0.080, 0.0), (-0.025, 0.052, -0.080, 0.02), (0.045, 0.055, -0.080, -0.010),
                            (0.12, 0.053, -0.080, -0.027), (0.163, 0.044, -0.079, -0.034)):
        pts = []
        for i in range(8):
            a = 2 * pi * i / 8 + pi / 8
            ca, sa = math.cos(a), math.sin(a)
            yc, ry = (yb + yt) / 2, (yt - yb) / 2
            pts.append((hw * sup(ca, 3.2), yc + ry * sup(sa, 3.2), z))
        sec.append(pts)
    before = set(m.bm.faces)
    loft(m, sec, '#ffffff', ((0, -0.034, -0.078), (0, -0.056, 0.177)), smooth=True)
    for f in m.bm.faces:
        if f not in before and f.calc_center_median().y < -0.062:
            for lp in f.loops:
                lp[m.cl] = lin(SOLE)
            f.smooth = False
    return finish(m)


# ---------------------------------------------------------------- perlengkapan
HAIR_C = (HC[0], HC[1] + 0.003, HC[2] - 0.006)
HAIR_R = (HR[0] * 1.075, HR[1] * 1.07, HR[2] * 1.07)


def hairline(a):
    c = math.cos(a)
    side = math.exp(-((abs(a) % (2 * pi) - pi / 2) ** 2) / 0.12) + math.exp(-((abs(a) % (2 * pi) - 3 * pi / 2) ** 2) / 0.12)
    return HC[1] - 0.014 + 0.060 * c - 0.016 * side  # depan dahi, samping di atas telinga (cambang), belakang tengkuk


def hair_deform(p):
    x, y, z = p[0], p[1] - HAIR_C[1], p[2] - HAIR_C[2]
    if y > 0.0:  # ubun-ubun bervolume dan acak (gaya rambut cepak bertekstur)
        k = 1 + 0.045 * (y / HAIR_R[1]) * math.sin(x * 71 + z * 43 + 1.3) * math.sin(z * 57 - x * 23)
        x *= k
        z *= k
        y *= 1.0 + 0.05 * (y / HAIR_R[1])
    if z > 0.07:
        z = 0.07 + (z - 0.07) * 0.75
    return (x, y + HAIR_C[1], z + HAIR_C[2])


def fringe(m, n=5, spread=0.55, length=0.032):
    """Jumbai depan: limas kecil di garis rambut dahi, mengarah turun-maju."""
    cx, cy, cz = HAIR_C
    rx, ry, rz = HAIR_R
    for i in range(n):
        a = -spread + 2 * spread * i / (n - 1)
        ye = hairline(a) + 0.012
        th = math.acos(clamp((ye - cy) / ry, -0.999, 0.999))
        base = Vector(hair_deform((cx + rx * math.sin(th) * math.sin(a), cy + ry * math.cos(th), cz + rz * math.sin(th) * math.cos(a))))
        out = (base - Vector((cx, cy, cz))).normalized()
        tang = Vector((math.cos(a), 0, -math.sin(a)))
        up = out.cross(tang).normalized()
        if up.y < 0:
            up = -up
        L = length * (0.85 + 0.3 * ((i * 7) % 3) / 2)
        tip = base + out * 0.012 - up * L * 0.9 + Vector((0, 0, 0.004)) + tang * 0.006 * (1 if i % 2 else -1)
        b1, b2, b3 = base + tang * 0.020, base - tang * 0.020, base + up * 0.016
        vs = [m.vert(tuple(v)) for v in (b1, b2, b3, tip)]
        for f in ([0, 1, 3], [1, 2, 3], [2, 0, 3], [0, 2, 1]):
            m.face([vs[j] for j in f], '#ffffff', False)


def build_hair():
    m = Mesh()
    shell(m, HAIR_C, HAIR_R, 16, 7, hairline, '#ffffff', hair_deform, tuck=0.90, smooth=False)
    fringe(m)
    return finish(m)


def build_hair_long():
    m = Mesh()
    shell(m, HAIR_C, HAIR_R, 12, 5, lambda a: hairline(a) - 0.005, '#ffffff', hair_deform, tuck=0.90, smooth=False)
    fringe(m, 4, 0.45, 0.04)
    # tirai belakang sampai tengkuk/bahu
    sub = Mesh()
    c, r = (0.0, 0.03, -0.032), (0.100, 0.140, 0.078)
    ellipsoid(sub, c, r, 10, 7, smooth=False)
    bmesh.ops.delete(sub.bm, geom=[f for f in sub.bm.faces if not all(v.co.z <= 0.03 for v in f.verts)], context='FACES')
    for v in sub.bm.verts:
        if v.co.y < c[1] - 0.09:
            v.co.x *= 1.06
    before = set(m.bm.faces)
    m.add(sub.bm, '#ffffff', None, False)
    m.mark(before, from_center(c))
    for s_ in (1, -1):  # helai samping di depan telinga
        sub = Mesh()
        ellipsoid(sub, (0, 0, 0), (0.016, 0.060, 0.032), 5, 3, smooth=False)
        m.add(sub.bm, '#ffffff', T(0.097 * s_, 0.062, 0.016) @ Rz(0.10 * s_), False)
    return finish(m)


HELM_C = (0.0, 0.112, -0.008)
HELM_R = (0.130, 0.136, 0.140)


def helm_rim(a):
    return 0.100 + 0.044 * math.cos(a)  # depan di atas alis, samping menutup telinga atas, belakang tengkuk


def build_helmet():
    m = Mesh()
    shell(m, HELM_C, HELM_R, 14, 5, helm_rim, '#ffffff', None, tuck=0.90, lip_col='#d4d0c6', lip_out=0.007,
          lip_down=0.006)
    bvh = bvh_of(m)
    zt = surf_z(bvh, 0, 0.20)
    box(m, (0.040, 0.026, 0.012), T(0, 0.20, zt + 0.003) @ Rx(-0.35), MOUNT)  # dudukan depan
    for s in (1, -1):
        x = surf_x(bvh, 0.15, -0.01, s)
        box(m, (0.008, 0.020, 0.075), T(x + 0.003 * s, 0.15, -0.01), MOUNT)  # rel samping
        strip(m, [(0.118 * s, 0.10, 0.004), (0.104 * s, 0.04, 0.03), (0.058 * s, -0.012, 0.058), (0.0, -0.028, 0.066)],
              0.011, 0.003, STRAP_DARK, nfn=lambda p: (p.x, -0.6 if p.y < 0.03 else 0.0, p.z * 0.3))
    return finish(m)


def build_cap():
    m = Mesh()
    c, r = (0.0, 0.128, -0.004), (0.112, 0.104, 0.122)
    shell(m, c, r, 12, 5, lambda a: 0.122 - 0.022 * max(0.0, -math.cos(a)), CAP_PURPLE, None, tuck=0.90,
          lip_col=GOLD, lip_out=0.004, lip_down=0.004)
    sub = Mesh()
    ellipsoid(sub, (0, 0, 0), (0.012, 0.007, 0.012), 6, 3)
    m.add(sub.bm, GOLD, T(c[0], c[1] + r[1] - 0.004, c[2]), True)
    # lidah topi: pelat melengkung ke depan
    grid = []
    for k in range(4):
        zz = 0.098 + 0.11 * k / 3
        row = []
        for i in range(5):
            xx = -0.092 + 0.184 * i / 4
            yy = 0.121 - 0.010 * (xx / 0.092) ** 2 - 0.016 * (k / 3) ** 1.3
            row.append((xx * (1 - 0.18 * k / 3), yy, zz))
        grid.append(row)
    top = [[m.vert(p) for p in row] for row in grid]
    bot = [[m.vert((p[0], p[1] - 0.009, p[2])) for p in row] for row in grid]
    for k in range(3):
        for i in range(4):
            m.face([top[k][i], top[k][i + 1], top[k + 1][i + 1], top[k + 1][i]], CAP_BRIM, True)
            m.face([bot[k][i + 1], bot[k][i], bot[k + 1][i], bot[k + 1][i + 1]], CAP_BRIM, True)
    for k in range(3):  # tepi kiri/kanan
        m.face([top[k][0], top[k + 1][0], bot[k + 1][0], bot[k][0]], CAP_BRIM, False)
        m.face([top[k + 1][4], top[k][4], bot[k][4], bot[k + 1][4]], CAP_BRIM, False)
    for i in range(4):  # tepi depan
        m.face([top[3][i], top[3][i + 1], bot[3][i + 1], bot[3][i]], CAP_BRIM, False)
    bvh = bvh_of(m)
    box(m, (0.034, 0.022, 0.004), T(0, 0.17, surf_z(bvh, 0, 0.17) + 0.001) @ Rx(-0.5), GOLD)  # logo
    return finish(m)


def build_vest():
    m = Mesh()
    # pelat depan & belakang (melengkung lewat dua kotak berbevel yang dimiringkan)
    box(m, (0.27, 0.29, 0.034), T(0, 0.055, 0.134) @ Rx(-0.04), '#ffffff', 0.012)
    box(m, (0.27, 0.28, 0.032), T(0, 0.06, -0.130) @ Rx(0.03), '#ffffff', 0.012)
    # sabuk samping (cummerbund)
    before = set(m.bm.faces)
    loft(m, [ring(-0.095, 0.170, 0.122, 0.118, 12, e=2.4), ring(0.035, 0.182, 0.128, 0.120, 12, e=2.4)], '#e2dfd6',
         (None, None), True)
    m.mark(before, axis_out)
    # tali bahu
    for s in (1, -1):
        strip(m, [(0.092 * s, 0.19, 0.142), (0.10 * s, 0.262, 0.08), (0.104 * s, 0.284, 0.0), (0.10 * s, 0.262, -0.08),
                  (0.092 * s, 0.195, -0.138)], 0.05, 0.012, '#ffffff', nfn=lambda p: (0.0, p.y - 0.18, p.z))
    # kantong magasin + radio
    for x in (-0.085, 0.0, 0.085):
        box(m, (0.068, 0.088, 0.032), T(x, -0.035, 0.164), '#d9d6cc', 0.0)
    box(m, (0.045, 0.07, 0.03), T(0.10, 0.17, 0.162) @ Rx(-0.2), '#cfccc2', 0.0)
    return finish(m)


def build_pack():
    m = Mesh()
    box(m, (0.285, 0.36, 0.14), T(0, 0.055, -0.226), '#ffffff', 0.032)
    box(m, (0.295, 0.035, 0.125), T(0, 0.238, -0.222) @ Rx(0.12), '#d8d5cc', 0.01)
    box(m, (0.20, 0.15, 0.042), T(0, -0.015, -0.312), '#e5e2d9', 0.012)
    for s in (1, -1):
        strip(m, [(0.08 * s, 0.215, -0.158), (0.112 * s, 0.278, -0.06), (0.128 * s, 0.278, 0.03), (0.146 * s, 0.21, 0.084),
                  (0.152 * s, 0.10, 0.084), (0.150 * s, 0.0, 0.07)], 0.048, 0.011, '#cfccc3',
              nfn=lambda p: (0.0, max(p.y - 0.18, 0.0), p.z))
    box(m, (0.06, 0.012, 0.03), T(0, 0.255, -0.198), '#bdbab2')  # pegangan
    return finish(m)


def build_stripe():
    m = Mesh()
    before = set(m.bm.faces)
    loft(m, [chest_ring_at(0.122, 16, 2.4, 0.007), chest_ring_at(0.156, 16, 2.4, 0.007)], '#ffffff', (None, None), True)
    m.mark(before, axis_out)
    return finish(m)


BUILDERS = {
    'hips': build_hips, 'spine': build_spine, 'chest': build_chest, 'neck': build_neck, 'head': build_head,
    'armL': lambda: build_arm(1), 'armR': lambda: build_arm(-1), 'foreL': lambda: build_fore(1), 'foreR': lambda: build_fore(-1),
    'handL': lambda: build_hand(1), 'handR': lambda: build_hand(-1),
    'thighL': lambda: build_thigh(1), 'thighR': lambda: build_thigh(-1), 'shinL': lambda: build_shin(1),
    'shinR': lambda: build_shin(-1), 'footL': lambda: build_foot(1), 'footR': lambda: build_foot(-1),
    'hair': build_hair, 'hair_long': build_hair_long, 'cap': build_cap, 'helmet': build_helmet, 'vest': build_vest,
    'pack': build_pack, 'stripe': build_stripe,
}


# ---------------------------------------------------------------- objek Blender
def slot_mat(slot):
    m = bpy.data.materials.get(slot)
    if m:
        return m
    m = bpy.data.materials.new(slot)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    at = nt.nodes.new('ShaderNodeVertexColor')
    at.layer_name = 'Col'
    nt.links.new(at.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.7
    return m


def make_object(name, m):
    piv = PIVOT[name] if name in PIVOT else PIVOT[GEAR_BONE[name]]
    for v in m.bm.verts:
        v.co = C3 @ v.co
    me = bpy.data.meshes.new(name)
    m.bm.to_mesh(me)
    tris = m.tris()
    m.bm.free()
    try:
        me.color_attributes.active_color_name = 'Col'
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    except Exception:
        pass
    me.materials.append(slot_mat(SLOT[name]))
    ob = bpy.data.objects.new(name, me)
    ob.location = C3 @ Vector(piv)
    bpy.context.scene.collection.objects.link(ob)
    return ob, tris


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs, tris = {}, {}
    t0 = time.time()
    for name in BODY + GEAR:
        m = BUILDERS[name]()
        ob, n = make_object(name, m)
        objs[name], tris[name] = ob, n
    body = sum(tris[n] for n in BODY)
    log('dibangun %.1fs' % (time.time() - t0), 'tubuh', body, 'tris', {k: tris[k] for k in BODY + GEAR})
    return objs, tris


def gl(p):
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


def check_helmet_cover(objs):
    """Semua verteks rambut di atas garis tepi helm harus di dalam kubah helm."""
    bad = 0
    for hn in ('hair', 'hair_long'):
        ob = objs[hn]
        for v in ob.data.vertices:
            p = C3.inverted() @ v.co  # relatif pivot kepala, ruang glTF
            a = math.atan2(p.x, p.z)
            if p.y < helm_rim(a) + 0.004:
                continue
            q = ((p.x - HELM_C[0]) / HELM_R[0]) ** 2 + ((p.y - HELM_C[1]) / HELM_R[1]) ** 2 + ((p.z - HELM_C[2]) / HELM_R[2]) ** 2
            if q > 0.985:
                bad += 1
    log('cek helm menutup rambut: verteks menembus =', bad)
    return bad


def export(objs, tris):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'person.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs.values():
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_animations=False, export_texcoords=False,
                              export_extras=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_draco_mesh_compression_enable=False)
    parts = []
    for name in BODY + GEAR:
        piv = PIVOT[name] if name in PIVOT else PIVOT[GEAR_BONE[name]]
        d = dict(name=name, pivot=[float(x) for x in piv], slot=SLOT[name], tris=tris[name])
        if name in PIVOT:
            d['parent'] = PARENT[name]
        else:
            d['bone'] = GEAR_BONE[name]
        parts.append(d)
    meta = dict(parts=parts, gunMount=list(GUN_MOUNT), bodyTris=sum(tris[n] for n in BODY), height=1.84,
                note='glTF: +Y atas, menghadap +Z, kiri = +X. Origin tiap objek = pivot sendi (pose istirahat). '
                     'Warna verteks putih = diwarnai slot; cap berwarna tetap.')
    with open(os.path.join(OUT, 'person.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    log('ekspor', path, os.path.getsize(path), 'byte')


# ---------------------------------------------------------------- pose (port dari Rig.pose di web/map/rig.js)
def rig_pose(s):
    spd = s.get('speed', 0.0)
    walkW, runK = clamp(spd / 1.3, 0, 1), clamp((spd - 2.6) / 3.6, 0, 1)
    cr, arm, aim, look = s.get('crouch', 0.0), s.get('armed', 0.0), s.get('aim', 0.0), s.get('pitch', 0.0)
    ph = s.get('phase', 0.0)
    sn = math.sin(ph)
    A = (0.4 + 0.42 * runK) * walkW * (1 - 0.45 * cr)
    KN = (0.55 + 1.05 * runK) * walkW
    R = {}
    for th, sh, ft, off in (('thighL', 'shinL', 'footL', 0.0), ('thighR', 'shinR', 'footR', pi)):
        p = ph + off
        s1, c1 = math.sin(p), math.cos(p)
        tx = -s1 * A - 0.95 * cr
        kx = 0.06 * walkW + KN * max(0.0, c1) ** 1.5 + 1.75 * cr
        side = 1 if th.endswith('L') else -1
        R[th] = (tx, 0.0, s.get('spread', 0.0) * side)
        R[sh] = (kx, 0.0, 0.0)
        R[ft] = (-(tx + kx) * 0.8 + 0.1 * walkW * max(0.0, -c1), 0.0, 0.0)
    bob = ((0.017 + 0.032 * runK) * math.cos(2 * ph) - 0.015) * walkW
    hipsY = 0.98 - 0.4 * cr + bob
    R['hips'] = (0.0, s.get('hipYaw', 0.0) + sn * 0.1 * walkW, math.cos(ph) * 0.035 * walkW)
    lean = 0.05 * walkW + 0.2 * runK * (1 - 0.7 * max(aim, arm * 0.5)) + 0.28 * cr
    R['spine'] = (lean, -s.get('hipYaw', 0.0) - sn * 0.1 * walkW, 0.0)
    R['chest'] = (-look * 0.5, s.get('chestYaw', 0.0), 0.0)
    R['neck'] = (0.0, 0.0, 0.0)
    R['head'] = (-look * 0.45 + s.get('headPitch', 0.0), s.get('headYaw', 0.0), 0.0)
    swingA = (0.3 + 0.6 * runK) * walkW
    elbow = -(0.22 + 1.15 * runK) * walkW - 0.12
    for ua, fa, hd, side in (('armL', 'foreL', 'handL', 1), ('armR', 'foreR', 'handR', -1)):
        ax, az, fx = side * sn * swingA, 0.11 * side, elbow
        hx = lerp(-0.95, -1.38, aim) if side > 0 else lerp(-0.62, -1.02, aim)
        hz = lerp(-0.62, -0.5, aim) if side > 0 else lerp(0.32, 0.18, aim)
        hf = lerp(-0.62, -0.5, aim) if side > 0 else lerp(-1.45, -1.62, aim)
        ax, az, fx = lerp(ax, hx - look * 0.5, arm), lerp(az, hz, arm), lerp(fx, hf, arm)
        R[ua] = (ax, 0.0, az)
        R[fa] = (fx, 0.0, 0.0)
        R[hd] = (0.0, 0.0, 0.0)
    gun_pos = (-0.13, lerp(0.02, 0.15, aim), lerp(0.26, 0.2, aim))
    gun_rot = (lerp(0.55, 0.0, aim) - look * 0.5 + (1 - aim) * 0.12 * walkW * math.sin(2 * ph), 0.0, 0.0)
    for k, v in s.get('extra', {}).items():
        R[k] = v
    return R, hipsY, gun_pos, gun_rot


def eul(rx, ry, rz):  # Euler three.js urutan XYZ → matriks Rx·Ry·Rz
    return (Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rz, 3, 'Z'))


def to_b(M3):
    return C3 @ M3 @ C3.inverted()


# ---------------------------------------------------------------- render preview
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def tint_mat(name, hexcol, rough=0.7, fixed=False, sheen=0.0, spec=0.35):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    if fixed:
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        sock = lambda coll, ident: next(x for x in coll if x.identifier == ident)
        sock(mix.inputs, 'Factor_Float').default_value = 1.0
        sock(mix.inputs, 'A_Color').default_value = (*srgb(hexcol), 1)
        nt.links.new(vc.outputs['Color'], sock(mix.inputs, 'B_Color'))
        nt.links.new(sock(mix.outputs, 'Result_Color'), bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    try:
        bsdf.inputs['Sheen Weight'].default_value = sheen
        bsdf.inputs['Specular IOR Level'].default_value = spec
    except Exception:
        pass
    return m


ROUGH = {'skin': 0.52, 'hair': 0.85, 'shirt': 0.78, 'sleeve': 0.78, 'pants': 0.8, 'shoes': 0.6, 'gear': 0.62,
         'pack': 0.75, 'trim': 0.35, 'cap': 0.6}
SPEC = {'skin': 0.4, 'hair': 0.12, 'shoes': 0.3, 'gear': 0.3, 'trim': 0.5}


def rifle(name):
    """Senapan sederhana (hanya untuk preview), depan +Z glTF."""
    m = Mesh()
    box(m, (0.055, 0.09, 0.40), T(0, 0, 0.05), '#2c2f36', 0.008)
    sub = Mesh()
    ellipsoid(sub, (0, 0, 0), (0.016, 0.016, 0.17), 8, 4)
    m.add(sub.bm, '#1d1f24', T(0, 0.018, 0.40), True)
    box(m, (0.06, 0.05, 0.2), T(0, 0.012, 0.32), '#3a3d45', 0.006)
    box(m, (0.045, 0.1, 0.2), T(0, -0.012, -0.24), '#2c2f36', 0.008)
    box(m, (0.04, 0.14, 0.06), T(0, -0.1, 0.11) @ Rx(0.25), '#1d1f24', 0.005)
    box(m, (0.035, 0.09, 0.04), T(0, -0.08, -0.04) @ Rx(-0.3), '#1d1f24', 0.005)
    box(m, (0.03, 0.035, 0.09), T(0, 0.065, 0.04), '#D29F52', 0.004)
    finish(m)
    for v in m.bm.verts:
        v.co = C3 @ v.co
    me = bpy.data.meshes.new(name)
    m.bm.to_mesh(me)
    m.bm.free()
    me.materials.append(tint_mat(name + '_m', '#ffffff', 0.45, fixed=True))
    return link(bpy.data.objects.new(name, me))


ARM_UP, ARM_LO = 0.28, 0.25


def wrist_of(side, ax, az, fx):
    S = Vector((0.2 * side, 0.21, 0.0))
    Ru = eul(ax, 0.0, az)
    E = S + Ru @ Vector((0.0, -ARM_UP, 0.0))
    return E + (Ru @ eul(fx, 0.0, 0.0)) @ Vector((0.0, -ARM_LO, 0.0))


def solve_arm(side, target):
    """IK sederhana (pencarian kisi) di ruang dada: sudut lengan atas (x, z) + siku (x) agar pergelangan di target."""
    tgt, best, bd = Vector(target), None, 1e9
    for step, rng in ((0.06, None), (0.012, 0.08)):
        cand = []
        if rng is None:
            ax_l = [-2.4 + step * i for i in range(int(2.9 / step) + 1)]
            az_l = [-1.2 + step * i for i in range(int(2.4 / step) + 1)]
            fx_l = [-2.5 + step * i for i in range(int(2.5 / step) + 1)]
        else:
            a0, z0, f0 = best
            ax_l = [a0 + step * (i - 7) for i in range(15)]
            az_l = [z0 + step * (i - 7) for i in range(15)]
            fx_l = [f0 + step * (i - 7) for i in range(15)]
        for ax in ax_l:
            for az in az_l:
                for fx in fx_l:
                    if fx > 0.0:
                        continue
                    d = (wrist_of(side, ax, az, fx) - tgt).length
                    if d < bd:
                        bd, best = d, (ax, az, fx)
    return best, bd


AIM_GUN = (-0.13, 0.16, 0.24)   # posisi senapan di ruang dada (preview)
AIM_YAW = 0.35                   # badan menyerong (dada −0,35), senapan +0,35 → tetap lurus ke depan
AIM_ARMS = None


def aim_ik(gun_pos):
    """Lengan memegang senapan: kanan di gagang, kiri di bawah pelindung tangan (koordinat dada)."""
    g, Rg = Vector(gun_pos), eul(0.0, AIM_YAW, 0.0)
    r, dr = solve_arm(-1, g + Rg @ Vector((0.0, -0.035, -0.07)) + Vector((0.0, 0.05, -0.02)))
    l, dl = solve_arm(1, g + Rg @ Vector((0.0, -0.055, 0.22)) + Vector((0.0, -0.035, 0.0)))
    log('ik bidik: galat kanan %.3f m, kiri %.3f m' % (dr, dl), 'armR', [round(x, 3) for x in r], 'armL', [round(x, 3) for x in l])
    return {'armR': (r[0], 0.0, r[1]), 'foreR': (r[2], 0.0, 0.0), 'armL': (l[0], 0.0, l[1]), 'foreL': (l[2], 0.0, 0.0)}


def place_character(objs, tag, outfit, gear, state, loc, yaw_deg):
    """Salin bagian-bagian ke hierarki empty bertulang dan pasang pose. loc = (x, z_depan) di bidang lantai glTF."""
    mats = {}
    for slot in ('pants', 'shirt', 'sleeve', 'skin', 'hair', 'shoes', 'gear', 'pack', 'trim'):
        mats[slot] = tint_mat('%s_%s' % (tag, slot), outfit.get(slot, '#ffffff'), ROUGH[slot], spec=SPEC.get(slot, 0.35))
    if 'helmet' in outfit:
        mats['helmet'] = tint_mat('%s_helmet' % tag, outfit['helmet'], ROUGH['gear'])
    mats['cap'] = tint_mat('%s_cap' % tag, '#ffffff', ROUGH['cap'], fixed=True)
    R, hipsY, gun_pos, gun_rot = rig_pose(state)
    if state.get('ik_aim'):  # khusus preview: tangan benar-benar memegang senapan
        global AIM_ARMS
        AIM_ARMS = AIM_ARMS or aim_ik(AIM_GUN)
        R.update(AIM_ARMS)
        R['chest'] = (0.0, -AIM_YAW, 0.0)
        R['head'] = (0.10, AIM_YAW * 0.92, 0.0)
        gun_pos, gun_rot = AIM_GUN, (0.0, AIM_YAW, 0.0)
    root = link(bpy.data.objects.new(tag + '_root', None))
    root.matrix_world = T(*(C3 @ Vector((loc[0], 0.0, loc[1])))) @ to_b(eul(0, yaw_deg * D2R, 0)).to_4x4()
    bones = {}
    for name in BODY:
        e = link(bpy.data.objects.new('%s_%s' % (tag, name), None))
        par = PARENT[name]
        if par is None:
            e.parent = root
            off = Vector((0.0, hipsY, 0.0))
        else:
            e.parent = bones[par]
            off = Vector(PIVOT[name]) - Vector(PIVOT[par])
        e.matrix_parent_inverse = Matrix.Identity(4)
        e.matrix_basis = T(*(C3 @ off)) @ to_b(eul(*R.get(name, (0, 0, 0)))).to_4x4()
        bones[name] = e
    gun = None
    if state.get('armed'):
        g = link(bpy.data.objects.new(tag + '_gun', None))
        g.parent = bones['chest']
        g.matrix_parent_inverse = Matrix.Identity(4)
        g.matrix_basis = T(*(C3 @ Vector(gun_pos))) @ to_b(eul(*gun_rot)).to_4x4()
        gun = rifle(tag + '_rifle')
        gun.parent = g
        gun.matrix_parent_inverse = Matrix.Identity(4)
    for name in BODY + GEAR:
        if name in GEAR and name not in gear:
            continue
        src = objs[name]
        ob = src.copy()
        link(ob)
        ob.parent = bones[name] if name in BODY else bones[GEAR_BONE[name]]
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = Matrix.Identity(4)
        ob.hide_render = False
        slot = 'helmet' if (name == 'helmet' and 'helmet' in mats) else SLOT[name]
        ob.material_slots[0].link = 'OBJECT'
        ob.material_slots[0].material = mats[slot]
    return root


def cycles(samples, w, h):
    scn = bpy.context.scene
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
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.cycles.max_bounces = 8
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass


def eevee(w, h):
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    try:
        scn.view_settings.view_transform = 'AgX'
    except Exception:
        pass


def plain_mat(name, col, rough=0.5):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(col), 1)
    b.inputs['Roughness'].default_value = rough
    return m


def studio(floor='#3b3e4a', world=0.12):
    bm = bmesh.new()
    prof = [(30, 0)] + [(-8 - 6 * math.sin(a * pi / 16), 6 - 6 * math.cos(a * pi / 16)) for a in range(0, 9)] + [(-14, 20)]
    vs = []
    for (y, z) in prof:
        vs.append((bm.verts.new((-40, y, z)), bm.verts.new((40, y, z))))
    for i in range(len(vs) - 1):
        bm.faces.new((vs[i][0], vs[i][1], vs[i + 1][1], vs[i + 1][0]))
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    if bm.faces[0].normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new('cyc')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(plain_mat('cyc', floor, 0.55))
    cyc = link(bpy.data.objects.new('cyc', me))
    cyc.rotation_euler = (0, 0, pi)
    cyc.location = (0, 2.5, 0)
    w = bpy.data.worlds.new('w')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.6, 0.65, 0.78, 1)
    bg.inputs['Strength'].default_value = world


def area(name, loc, target, size, power, color=(1, 1, 1), sy=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.shape = 'RECTANGLE'
    ld.size = size
    ld.size_y = sy or size
    ld.color = color
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = Vector(loc)
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def lights(span=1.0):
    k = span
    area('key', (-2.8 * k, -3.4 * k, 3.2), (0, 0, 1.0), 2.6 * k, 520 * k, (1.0, 0.95, 0.9))
    area('fill', (3.2 * k, -2.6 * k, 1.6), (0, 0, 1.0), 3.0 * k, 170 * k, (0.85, 0.9, 1.0))
    area('top', (0, 0.4, 4.2), (0, 0, 0.9), 3.5 * k, 300 * k, (1, 1, 1), sy=2.0 * k)
    area('rim', (2.0 * k, 3.2 * k, 2.6), (0, 0, 1.3), 2.0 * k, 520 * k, (1.0, 0.85, 0.65))
    area('rim2', (-2.6 * k, 2.8 * k, 2.2), (0, 0, 1.2), 1.6 * k, 380 * k, (0.7, 0.8, 1.0))
    area('backdrop', (0, 3.5, 5.0), (0, 9.5, 2.0), 6.0 * k, 1400 * k, (0.78, 0.8, 0.95))


def cam(target, az, el, dist, lens):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.sensor_width = 36
    c = link(bpy.data.objects.new('cam', cd))
    a, e = az * D2R, el * D2R
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    t = Vector(target)
    c.location = t + d * dist
    c.rotation_euler = (t - c.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = c
    return c


def hide_sources(objs):
    for ob in objs.values():
        ob.hide_render = True
        ob.hide_viewport = True


PLAYER = dict(shirt='#503EBA', sleeve='#503EBA', pants='#2b2940', skin='#c68c66', hair='#231c18', shoes='#1c1b22',
              gear='#4c5340', helmet='#66704a', pack='#3a3d34', trim='#D29F52')
BOTS = [
    dict(shirt='#7a6a4f', sleeve='#7a6a4f', pants='#3b3a33', skin='#e0ac85', hair='#1d1714', shoes='#1c1b22', gear='#c9b48a', pack='#4a3f30', trim='#D29F52'),
    dict(shirt='#3f5468', sleeve='#3f5468', pants='#2f3440', skin='#8a5a3c', hair='#2b2b2b', shoes='#1c1b22', gear='#66704a', pack='#2e3440', trim='#D29F52'),
    dict(shirt='#6b3f3f', sleeve='#6b3f3f', pants='#4a4535', skin='#f1c7a5', hair='#5a3e28', shoes='#1c1b22', gear='#4c5340', pack='#3a3d34', trim='#D29F52'),
    dict(shirt='#2f5f5a', sleeve='#2f5f5a', pants='#26292f', skin='#a8714f', hair='#3a2a1e', shoes='#1c1b22', gear='#2f3136', pack='#5a4632', trim='#D29F52'),
    dict(shirt='#5b6b4a', sleeve='#5b6b4a', pants='#5a5446', skin='#6b4430', hair='#1d1714', shoes='#1c1b22', gear='#66704a', pack='#3a3d34', trim='#D29F52'),
]


def hero(objs):
    hide_sources(objs)
    studio()
    lights(1.0)
    place_character(objs, 'aim', PLAYER, {'helmet', 'vest', 'pack', 'stripe'},
                    dict(armed=1, aim=1, ik_aim=1, spread=0.06, extra={'thighL': (-0.18, 0.0, 0.06), 'shinL': (0.22, 0, 0), 'footL': (-0.03, 0, 0),
                                                                     'thighR': (0.14, 0.0, -0.06), 'shinR': (0.06, 0, 0)}),
                    (-0.52, 0.05), -28)
    place_character(objs, 'run', PLAYER, {'hair', 'vest', 'pack', 'stripe'},
                    dict(armed=1, aim=0, speed=6.2, phase=pi / 4), (0.62, -0.15), 22)
    cycles(SAMPLES, 1600, 1000)
    cam((0.04, 0.0, 0.93), 8, 7, 4.9, 42)
    os.makedirs(PREV, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'hero.png')
    bpy.ops.render.render(write_still=True)
    log('render', bpy.context.scene.render.filepath)


def lineup(objs):
    hide_sources(objs)
    studio()
    lights(1.5)
    poses = [
        ({'cap', 'stripe'}, dict(), -8),
        ({'hair', 'pack'}, dict(armed=1, aim=0, extra={'head': (0.05, 0.25, 0)}), 10),
        ({'helmet', 'vest', 'pack'}, dict(armed=1, aim=1, ik_aim=1, crouch=1), -22),
        ({'hair_long', 'pack'}, dict(speed=1.7, phase=0.9), 16),
        ({'helmet', 'hair', 'vest'}, dict(armed=1, aim=1, ik_aim=1), -58),
    ]
    xs = [-1.9, -0.95, 0.0, 0.95, 1.9]
    for i, (gear, st, yaw) in enumerate(poses):
        place_character(objs, 'b%d' % i, BOTS[i], gear, st, (xs[i], 0.1 if i % 2 else -0.05), yaw)
    cycles(SAMPLES, 1600, 1000)
    cam((0.0, 0.0, 0.88), 0, 6, 7.4, 42)
    os.makedirs(PREV, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'lineup.png')
    bpy.ops.render.render(write_still=True)
    log('render', bpy.context.scene.render.filepath)


def quick(objs):
    """Cek cepat EEVEE: pose istirahat 4 sisi, wajah dekat, dan pose bertumpuk (sendi)."""
    hide_sources(objs)
    studio('#9a9da6', 0.5)
    lights(1.0)
    place_character(objs, 'q0', PLAYER, {'hair', 'stripe'}, dict(), (0, 0), 0)
    eevee(900, 900)
    os.makedirs(QDIR, exist_ok=True)
    for nm, az, el, dist, tgt, lens in (('front', 0, 4, 3.4, 0.95, 40), ('side', 90, 4, 3.4, 0.95, 40), ('back', 180, 6, 3.4, 0.95, 40),
                                        ('34', 35, 10, 3.4, 0.95, 40), ('face', 18, 4, 0.9, 1.70, 50), ('feet', 30, 20, 1.1, 0.25, 40),
                                        ('hand', 70, 0, 0.8, 0.95, 50)):
        cam((0, 0, tgt), az, el, dist, lens)
        bpy.context.scene.render.filepath = os.path.join(QDIR, 'rest_%s.png' % nm)
        bpy.ops.render.render(write_still=True)
    log('quick', QDIR)


def main():
    objs, tris = build_all()
    check_helmet_cover(objs)
    if not opt('--no-export'):
        export(objs, tris)
    if opt('--quick'):
        quick(objs)
        objs, tris = build_all()
    if opt('--shots'):
        hero(objs)
        objs, tris = build_all()
        lineup(objs)


main()
