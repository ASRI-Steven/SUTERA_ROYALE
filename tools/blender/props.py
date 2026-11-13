"""Sutera Royale: properti loot + parasut (Blender headless), satu mesh per node dengan warna verteks.

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/props.py -- [opsi]

Opsi:
  --no-export      lewati ekspor GLB + JSON
  --quick          render cek cepat (EEVEE) + sudut dekat ke --qdir (default preview/props/quick)
  --shots          render preview Cycles preview/props/lineup.png (panel benda + panel parasut)
  --samples N      sampel Cycles (default 128)
  --out DIR        folder keluaran GLB/JSON (default web/game/assets/props)

Kontrak (web/game/assets/props/props.glb, diinstans ribuan kali di game):
  - glTF +Y atas, ukuran nyata (m); origin di tengah bawah benda (y = 0 menyentuh tanah).
  - Satu mesh per node, warna verteks COLOR_0 (linear), satu material polos 'vc' (tanpa tekstur), ≤ 300 segitiga.
  - parachute: origin di titik harness (semua tali bertemu di (0,0,0)), permukaan bawah kanopi di tengah y = 4,4,
    bentang 6,8 m (sumbu X), tepi depan kanopi ke −Z glTF; putih (diwarnai game per bot) + list emas; ≤ 800 segitiga.
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
OUT = os.path.abspath(opt('--out', os.path.join(ROOT, 'web', 'game', 'assets', 'props')))
PREV = os.path.abspath(os.path.join(ROOT, 'preview', 'props'))
QDIR = os.path.abspath(opt('--qdir', os.path.join(PREV, 'quick')))
SAMPLES = int(opt('--samples', 128))
pi = math.pi
D2R = pi / 180
GOLD = '#D29F52'
MAX_TRIS, MAX_TRIS_CHUTE = 300, 800


def log(*a):
    print('[props]', *a, flush=True)


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def shade(h, k):
    """Warna hex dikali k (ruang sRGB), dibatasi 0..255."""
    h = h.lstrip('#')
    return '#%02x%02x%02x' % tuple(min(255, max(0, round(int(h[i:i + 2], 16) * k))) for i in (0, 2, 4))


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Rx(d):
    return Matrix.Rotation(d * D2R, 4, 'X')


def Ry(d):
    return Matrix.Rotation(d * D2R, 4, 'Y')


def Rz(d):
    return Matrix.Rotation(d * D2R, 4, 'Z')


# ---------------------------------------------------------------- mesh berwarna (satu warna per face)
class VM:
    def __init__(self):
        self.bm = bmesh.new()
        self.layer = self.bm.faces.layers.int.new('ci')
        self.pal = []

    def ci(self, hexcol):
        if hexcol not in self.pal:
            self.pal.append(hexcol)
        return self.pal.index(hexcol)

    def add(self, src, hexcol, M=None, fc=None):
        """Salin geometri src (lalu dibebaskan) dengan warna hexcol; fc(face) -> hex opsional per face."""
        if M is not None:
            bmesh.ops.transform(src, matrix=M, verts=src.verts)
            if M.to_3x3().determinant() < 0:
                bmesh.ops.reverse_faces(src, faces=src.faces)
        src.faces.index_update()
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf[self.layer] = self.ci((fc(f) if fc else None) or hexcol)
        src.free()

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


def drop(bm, pred):
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if pred(f)], context='FACES')


def p_box(sx, sy, sz, bevel=0.0, open_bottom=False):
    """Kotak berpusat di origin; open_bottom membuang sisi bawah (tidak terlihat saat menempel)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, sx * .49, sy * .49, sz * .49), offset_type='OFFSET', segments=1,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    if open_bottom:
        drop(bm, lambda f: f.normal.z < -0.99)
    return bm


def p_cyl(r1, r2, depth, segs=12, caps=True, bottom=True):
    """Silinder/kerucut sumbu Z berpusat di origin."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    if caps and not bottom:
        drop(bm, lambda f: f.normal.z < -0.99)
    return bm


def p_cylx(r, depth, segs=12, caps=True):
    bm = p_cyl(r, r, depth, segs, caps)
    bmesh.ops.transform(bm, matrix=Ry(90), verts=bm.verts)
    return bm


def p_cone(r, h, segs=6):
    """Kerucut lancip (alas di z = 0 tanpa tutup, puncak di z = h)."""
    bm = bmesh.new()
    ring = [bm.verts.new((r * math.cos(2 * pi * i / segs), r * math.sin(2 * pi * i / segs), 0)) for i in range(segs)]
    tip = bm.verts.new((0, 0, h))
    for i in range(segs):
        bm.faces.new((ring[i], ring[(i + 1) % segs], tip))
    return bm


def p_tube(a, b, r, segs=6, caps=False):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = p_cyl(r, r, d.length, segs, caps)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=T(*((a + b) / 2)) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def p_loft(rings, cap0=True, cap1=True):
    """Loft cincin tertutup; face dibuat berurutan (cincin i → i+1), lalu tutup awal & akhir."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            bm.faces.new((vr[i][j], vr[i][j2], vr[i + 1][j2], vr[i + 1][j]))
    if cap0:
        bm.faces.new(vr[0])
    if cap1:
        bm.faces.new(list(reversed(vr[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.faces.index_update()
    return bm


def p_strip(path, width):
    """Pita datar satu sisi (menghadap +Z) sepanjang path [(y, z)…], lebar arah X."""
    bm = bmesh.new()
    vs = [(bm.verts.new((-width / 2, y, z)), bm.verts.new((width / 2, y, z))) for y, z in path]
    for (a0, a1), (b0, b1) in zip(vs, vs[1:]):
        bm.faces.new((a0, b0, b1, a1))
    bm.normal_update()
    if sum(f.normal.z for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def p_prism(pts, h, inset=0.0, puff=0.0):
    """Prisma dari poligon (x, y) berlawanan jarum jam: alas z = 0 terbuka, atas z = h (opsional di-inset & dinaikkan)."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    hi = [bm.verts.new((x, y, h)) for x, y in pts]
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    top = bm.faces.new(hi)
    if inset > 0:
        bmesh.ops.inset_region(bm, faces=[top], thickness=inset, depth=puff, use_even_offset=True)
    bm.normal_update()
    return bm


def p_dome(rings, apex, bottom=True):
    """Kubah dari cincin bawah → atas + kipas ke puncak; urutan face: pita per cincin, kipas, lalu tutup bawah."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for i in range(len(vr) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            bm.faces.new((vr[i][j], vr[i][j2], vr[i + 1][j2], vr[i + 1][j]))
    ap = bm.verts.new(apex)
    for j in range(n):
        bm.faces.new((vr[-1][j], vr[-1][(j + 1) % n], ap))
    if bottom:
        bm.faces.new(list(reversed(vr[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.faces.index_update()
    return bm


def p_path_bar(path2d, z0, w, h):
    """Batang persegi mengikuti path (x, y) datar di ketinggian z0 (kerah rompi)."""
    rings = []
    n = len(path2d)
    for i, (x, y) in enumerate(path2d):
        a, b = path2d[max(0, i - 1)], path2d[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty)
        nx, ny = -ty / L * w / 2, tx / L * w / 2
        rings.append([(x + nx, y + ny, z0), (x + nx, y + ny, z0 + h), (x - nx, y - ny, z0 + h), (x - nx, y - ny, z0)])
    return p_loft(rings)


def cross_pts(a, b):
    """Poligon salib (lengan setengah-panjang a, setengah-lebar b), berlawanan jarum jam."""
    return [(b, -a), (b, -b), (a, -b), (a, b), (b, b), (b, a), (-b, a), (-b, b), (-a, b), (-a, -b), (-b, -b), (-b, -a)]


# ---------------------------------------------------------------- amunisi & medis
def ammo_light():
    """Kotak amunisi ringan: karton gelap, label kuning-kuningan, ujung peluru menyembul."""
    m = VM()
    m.add(p_box(0.24, 0.16, 0.112, 0.006), '#3a3d44', T(0, 0, 0.056))
    m.add(p_box(0.246, 0.166, 0.056), '#e3b33e', T(0, 0, 0.05))
    m.add(p_box(0.13, 0.169, 0.01), '#2b2116', T(-0.035, 0, 0.06))
    m.add(p_box(0.05, 0.169, 0.01), '#2b2116', T(0.075, 0, 0.04))
    m.add(p_box(0.2, 0.124, 0.004), '#16171a', T(0, 0, 0.113))
    for i in range(4):
        for j in range(2):
            x, y = -0.072 + i * 0.048, -0.026 + j * 0.052
            m.add(p_cyl(0.0105, 0.0105, 0.02, 6, caps=False), '#c99a3d', T(x, y, 0.122))
            m.add(p_cone(0.0105, 0.016, 6), '#c8834a', T(x, y, 0.132))
    return m


def ammo_rifle():
    """Kaleng amunisi militer hijau dengan tutup, kunci samping, dan pegangan lipat."""
    m = VM()
    g = '#56622f'
    m.add(p_box(0.24, 0.115, 0.125, 0.008), g, T(0, 0, 0.0625))
    m.add(p_box(0.248, 0.123, 0.03, 0.008), shade(g, 0.8), T(0, 0, 0.135))
    m.add(p_box(0.012, 0.05, 0.06), shade(g, 0.62), T(0.126, 0, 0.11))
    m.add(p_tube((-0.055, 0, 0.163), (0.055, 0, 0.163), 0.0065, 6), '#25271f')
    for x in (-0.055, 0.055):
        m.add(p_box(0.01, 0.012, 0.014), '#25271f', T(x, 0, 0.155))
    for sy in (-1, 1):  # stensil kuning di dua sisi panjang
        m.add(p_box(0.13, 0.004, 0.014), '#d9c64c', T(-0.02, sy * 0.0585, 0.08))
        m.add(p_box(0.07, 0.004, 0.01), '#d9c64c', T(-0.05, sy * 0.0585, 0.056))
    return m


def ammo_shell():
    """Kotak peluru shotgun merah, label putih, kepala kuningan terlihat dari atas."""
    m = VM()
    m.add(p_box(0.22, 0.13, 0.1, 0.006), '#b3261e', T(0, 0, 0.05))
    m.add(p_box(0.15, 0.134, 0.05), '#efe9de', T(0.0, 0, 0.045))
    m.add(p_box(0.09, 0.137, 0.01), '#1d1d1f', T(-0.012, 0, 0.05))
    m.add(p_box(0.19, 0.1, 0.004), '#16171a', T(0, 0, 0.101))
    for i in range(4):
        for j in range(2):
            m.add(p_cyl(0.0115, 0.0115, 0.016, 6, bottom=False), '#d4a73a', T(-0.069 + i * 0.046, -0.024 + j * 0.048, 0.108))
    return m


def band():
    """Dua gulung perban: satu rebah dengan ujung terurai, satu berdiri."""
    m = VM()
    m.add(p_cylx(0.04, 0.09, 16), '#f1ece2', T(0, 0, 0.04))
    m.add(p_cylx(0.015, 0.093, 10), '#bfb39b', T(0, 0, 0.04))
    m.add(p_cyl(0.0405, 0.0405, 0.012, 16, caps=False), '#c0392b', T(0.026, 0, 0.04) @ Ry(90))
    m.add(p_strip([(-0.004, 0.0015), (-0.05, 0.001), (-0.1, 0.0025), (-0.135, 0.004)], 0.086), '#ebe4d6')
    m.add(p_cyl(0.034, 0.034, 0.08, 16), '#f1ece2', T(0.105, 0.035, 0.04))
    m.add(p_cyl(0.013, 0.013, 0.082, 10), '#bfb39b', T(0.105, 0.035, 0.041))
    return m


def kit():
    """Kotak P3K hijau: tutup, salib putih di atas & ujung, pegangan dan dua gesper."""
    m = VM()
    g = '#2e9a58'
    m.add(p_box(0.34, 0.24, 0.1, 0.012), g, T(0, 0, 0.05))
    m.add(p_box(0.346, 0.246, 0.036, 0.012), shade(g, 0.82), T(0, 0, 0.112))
    m.add(p_prism(cross_pts(0.085, 0.026), 0.004), '#ffffff', T(0, 0, 0.13))
    for sx in (-1, 1):  # salib kecil di kedua ujung
        m.add(p_prism(cross_pts(0.032, 0.01), 0.003), '#ffffff', T(sx * 0.17, 0, 0.055) @ Ry(90 * sx))
    m.add(p_box(0.11, 0.016, 0.014), '#1f2a22', T(0, -0.135, 0.075))
    for x in (-0.05, 0.05):
        m.add(p_box(0.014, 0.018, 0.02), '#1f2a22', T(x, -0.126, 0.075))
    for x in (-0.115, 0.115):
        m.add(p_box(0.022, 0.008, 0.03), '#c9ccd2', T(x, -0.124, 0.098))
    return m


# ---------------------------------------------------------------- rompi
VEST_R = [(0.0, -0.25), (0.185, -0.25), (0.215, -0.215), (0.222, 0.0), (0.165, 0.09), (0.145, 0.14),
          (0.148, 0.235), (0.13, 0.27), (0.08, 0.27), (0.062, 0.22), (0.0, 0.18)]


def vest_outline():
    return VEST_R + [(-x, y) for x, y in reversed(VEST_R[1:-1])]


def vest(lvl, base):
    """Rompi rebah (leher ke +Y): panel empuk + tali bahu + kantong; lv2 MOLLE + radio; lv3 kerah, bahu, tag emas."""
    m = VM()
    dark = lvl == 3
    det = shade(base, 1.45 if dark else 0.78)
    det2 = shade(base, 1.2 if dark else 0.62)
    m.add(p_prism(vest_outline(), 0.034, inset=0.014, puff=0.012), base)
    z0 = 0.046
    for sx in (-1, 1):
        m.add(p_box(0.05, 0.12, 0.01, open_bottom=True), det2, T(sx * 0.105, 0.205, z0 + 0.003))
    for i in range(3):
        x = -0.12 + i * 0.12
        m.add(p_box(0.1, 0.12, 0.042, open_bottom=True), det, T(x, -0.165, z0 + 0.016))
        m.add(p_box(0.104, 0.045, 0.01, open_bottom=True), det2, T(x, -0.118, z0 + 0.04))
    if lvl == 1:
        for y in (0.0, 0.07):  # jahitan horizontal
            m.add(p_box(0.34, 0.008, 0.003, open_bottom=True), det2, T(0, y, z0 + 0.0005))
    else:
        for k in range(3):
            m.add(p_box(0.3, 0.012, 0.004, open_bottom=True), det2, T(0, -0.02 + k * 0.035, z0 + 0.001))
        m.add(p_box(0.075, 0.09, 0.034, open_bottom=True), det, T(0.15, 0.03, z0 + 0.012))
    if lvl == 3:
        m.add(p_path_bar([(-0.1, 0.27), (-0.08, 0.2), (0.0, 0.155), (0.08, 0.2), (0.1, 0.27)], z0 - 0.004, 0.04, 0.03), det)
        for sx in (-1, 1):
            m.add(p_box(0.075, 0.1, 0.022, open_bottom=True), det2, T(sx * 0.168, 0.2, z0 + 0.005) @ Rz(-8 * sx))
        m.add(p_box(0.05, 0.028, 0.004, open_bottom=True), GOLD, T(-0.11, 0.06, z0 + 0.003))
    return m


# ---------------------------------------------------------------- helm
def helmet(lvl, base):
    """Helm berdiri di bibirnya (depan +Y). lv1 klasik berbibir; lv2 potongan telinga + rel + dudukan NVG;
    lv3 potongan tinggi + rel + pelindung telinga + aksen emas."""
    m = VM()
    rx, ry, H = 0.118, 0.134, 0.158
    cut = (0.0, 0.03, 0.056)[lvl - 1]
    NS = 16

    def rim_z(th):
        return cut * abs(math.cos(th)) ** 4 + 0.006 * max(0.0, math.sin(th)) ** 6

    def ring(e, scale=1.0, dz=0.0):
        pts = []
        for i in range(NS):
            th = 2 * pi * i / NS
            phi0 = math.asin(min(0.95, rim_z(th) / H))
            phi = phi0 + (pi / 2 - phi0) * e / 5
            pts.append((rx * scale * math.cos(phi) * math.cos(th), ry * scale * math.cos(phi) * math.sin(th), H * math.sin(phi) + dz))
        return pts

    brim = 1.09 if lvl == 1 else 1.025
    rings = [ring(0, brim, -0.004 if lvl == 1 else 0.0), ring(0.22), ring(1), ring(2), ring(3), ring(4)]
    trim, inner = '#1b1c1f', '#121214'
    nfaces = NS * 5 + NS

    def fc(f):
        if f.index < NS:
            return trim
        if f.index >= nfaces:
            return inner
        return None

    m.add(p_dome(rings, (0, 0, H)), base, fc=fc)

    def frame(th, z, off):
        phi = math.asin(max(-0.999, min(0.999, z / H)))
        p = Vector((rx * math.cos(phi) * math.cos(th), ry * math.cos(phi) * math.sin(th), z))
        n = Vector((p.x / rx ** 2, p.y / ry ** 2, p.z / H ** 2)).normalized()
        t = Vector((-math.sin(th), math.cos(th), 0.0))
        t = (t - n * t.dot(n)).normalized()
        M = Matrix((t, n.cross(t), n)).transposed().to_4x4()
        M.translation = p + n * off
        return M

    if lvl < 3:
        for sx in (-1, 1):  # tali dagu
            x = sx * rx * math.cos(math.asin(min(0.95, cut / H)))
            m.add(p_box(0.006, 0.02, cut + 0.022, open_bottom=True), '#2a2a2a', T(x * 1.02, 0, (cut + 0.022) / 2))
    if lvl >= 2:
        for th in (0.0, pi):
            m.add(p_box(0.09, 0.014, 0.008), shade(base, 0.7), frame(th, 0.066 + cut * 0.5, 0.004))
        m.add(p_box(0.045, 0.03, 0.012), '#1c1d20', frame(pi / 2, 0.112, 0.005))
    if lvl == 3:
        m.add(p_box(0.02, 0.012, 0.004), GOLD, frame(pi / 2, 0.112, 0.012))
        for sx in (-1, 1):
            m.add(p_cylx(0.04, 0.028, 6), '#4a4d55', T(sx * (rx - 0.004), 0.004, 0.044))
    return m


# ---------------------------------------------------------------- peti loot
def crate():
    """Peti pemain gugur: ungu dengan pita & pelindung sudut emas, lambang wajik, pegangan samping."""
    m = VM()
    pu = '#3D3782'
    m.add(p_box(0.64, 0.48, 0.03, open_bottom=True), shade(pu, 0.6), T(0, 0, 0.015))
    m.add(p_box(0.62, 0.46, 0.33, 0.016), pu, T(0, 0, 0.03 + 0.165))
    m.add(p_box(0.632, 0.472, 0.08, 0.014), shade(pu, 0.8), T(0, 0, 0.38))
    for x in (-0.2, 0.2):
        m.add(p_box(0.048, 0.478, 0.398, open_bottom=True), GOLD, T(x, 0, 0.03 + 0.199))
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(p_box(0.06, 0.06, 0.084, open_bottom=True), GOLD, T(sx * 0.29, sy * 0.21, 0.379))
        m.add(p_box(0.012, 0.16, 0.03), shade(pu, 0.5), T(sx * 0.316, 0, 0.25))
    m.add(p_box(0.07, 0.006, 0.07), GOLD, T(0, -0.232, 0.2) @ Ry(45))
    m.add(p_box(0.036, 0.01, 0.036), shade(pu, 0.55), T(0, -0.233, 0.2) @ Ry(45))
    m.add(p_box(0.05, 0.012, 0.04), GOLD, T(0, -0.238, 0.335))
    m.add(p_box(0.11, 0.11, 0.006, open_bottom=True), GOLD, T(0, 0, 0.423) @ Rz(45))
    m.add(p_box(0.06, 0.06, 0.008, open_bottom=True), shade(pu, 0.55), T(0, 0, 0.424) @ Rz(45))
    return m


# ---------------------------------------------------------------- parasut
CHUTE = dict(span=6.8, chord=2.45, base=4.4, arc=0.5, nsp=20, nch=12)


def chute_arc(s):
    """s ∈ [−1, 1] sepanjang bentang → (x, z, sudut) pada busur permukaan bawah kanopi."""
    A = CHUTE['arc']
    R = CHUTE['span'] / 2 / math.sin(A)
    a = s * A
    return R * math.sin(a), CHUTE['base'] - R * (1 - math.cos(a)), a


def parachute():
    """Kanopi parafoil melengkung (sel putih/abu muda bergantian, dua list emas + panel ujung emas) + tali & riser."""
    m = VM()
    nsp, nch = CHUTE['nsp'], CHUTE['nch']
    rings = []
    for i in range(nsp):
        s = -1 + 2 * i / (nsp - 1)
        cx, cz, a = chute_arc(s)
        th = 0.32 * (1 - 0.45 * s * s)
        ch = CHUTE['chord'] * (1 - 0.18 * s ** 4)
        nx, nz = -math.sin(a), math.cos(a)
        ring = []
        for k in range(nch):
            t = 2 * pi * k / nch
            u = (1 - math.cos(t)) / 2  # 0 tepi depan, 1 tepi belakang
            f = 2.598 * math.sqrt(u) * (1 - u)
            off = th * f if math.sin(t) >= 0 else -0.16 * th * f
            ring.append((cx + nx * off, ch * (0.5 - u), cz + nz * off))
        rings.append(ring)
    cells = nsp - 1
    gold_cells = {2, cells - 3}

    def fc(f):
        if f.index >= cells * nch:
            return GOLD  # panel ujung
        c = f.index // nch
        if c in gold_cells:
            return GOLD
        return '#ffffff' if c % 2 == 0 else '#ececec'

    m.add(p_loft(rings), '#ffffff', fc=fc)
    tops = {-1: Vector((-0.2, 0.0, 0.6)), 1: Vector((0.2, 0.0, 0.6))}
    for tp in tops.values():  # riser bertemu di harness (origin)
        m.add(p_tube((0, 0, 0), tp, 0.022, 4), '#2a2a2a')
    for i in (1, 4, 7, 9, 10, 12, 15, 18):
        s = -1 + 2 * i / (nsp - 1)
        cx, cz, a = chute_arc(s)
        ch = CHUTE['chord'] * (1 - 0.18 * s ** 4)
        for u in (0.1, 0.55) + ((0.97,) if i in (1, 18) else ()):
            m.add(p_tube(tops[-1 if s < 0 else 1], (cx, ch * (0.5 - u), cz - 0.02), 0.011, 3), '#d9d9d9')
    return m


ITEMS = [('ammo_light', ammo_light), ('ammo_rifle', ammo_rifle), ('ammo_shell', ammo_shell), ('band', band), ('kit', kit),
         ('vest1', lambda: vest(1, '#c9b48a')), ('vest2', lambda: vest(2, '#66704a')), ('vest3', lambda: vest(3, '#2f3136')),
         ('helmet1', lambda: helmet(1, '#c9b48a')), ('helmet2', lambda: helmet(2, '#66704a')), ('helmet3', lambda: helmet(3, '#2f3136')),
         ('crate', crate), ('parachute', parachute)]


# ---------------------------------------------------------------- objek & ekspor
def vc_material():
    mt = bpy.data.materials.new('vc')
    try:
        mt.use_nodes = True
    except Exception:
        pass
    nt = mt.node_tree
    b = nt.nodes['Principled BSDF']
    at = nt.nodes.new('ShaderNodeVertexColor')
    at.layer_name = 'Col'
    nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.62
    b.inputs['Metallic'].default_value = 0.0
    return mt


def make_obj(name, m, mat):
    bm = m.bm
    chute = name == 'parachute'
    if not chute:  # origin di tengah bawah
        xs, ys, zs = ([v.co[k] for v in bm.verts] for k in range(3))
        off = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs)))
        for v in bm.verts:
            v.co += off
    bm.normal_update()
    thr = (70 if chute else 40) * D2R
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if not e.is_manifold or e.calc_face_angle(pi) > thr:
            e.smooth = False
    tris = m.tris()
    pal = [(*lin(h), 1.0) for h in m.pal]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ca = me.attributes['ci']
    idx = [d.value for d in ca.data]
    me.attributes.remove(ca)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    flat = [0.0] * (len(me.loops) * 4)
    for p in me.polygons:
        c = pal[idx[p.index]]
        for li in p.loop_indices:
            flat[li * 4:li * 4 + 4] = c
    col.data.foreach_set('color', flat)
    me.color_attributes.active_color = col
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, tris


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = vc_material()
    objs, meta = [], []
    for name, fn in ITEMS:
        ob, tris = make_obj(name, fn(), mat)
        co = [v.co for v in ob.data.vertices]
        mn = Vector([min(c[k] for c in co) for k in range(3)])
        mx = Vector([max(c[k] for c in co) for k in range(3)])
        sz = mx - mn
        d = dict(name=name, tris=tris, size=[round(sz.x, 3), round(sz.z, 3), round(sz.y, 3)])
        if name == 'parachute':
            d.update(harness=[0, 0, 0], canopyY=CHUTE['base'], span=round(sz.x, 2), top=round(mx.z, 2), forward='-Z')
        meta.append(d)
        objs.append(ob)
        lim = MAX_TRIS_CHUTE if name == 'parachute' else MAX_TRIS
        log('%-10s tris %4d %s  ukuran (lebar, tinggi, dalam) %s' % (name, tris, 'OK' if tris <= lim else 'LEWAT BATAS %d' % lim, d['size']))
    return objs, meta


def export(objs, meta):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, 'props.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_vertex_color='ACTIVE', export_normals=True, export_texcoords=False,
                              export_tangents=False, export_cameras=False, export_lights=False, export_animations=False,
                              export_extras=False, export_draco_mesh_compression_enable=False)
    with open(os.path.join(OUT, 'props.json'), 'w') as f:
        json.dump(dict(items=meta, note='glTF +Y atas; size = [lebar X, tinggi Y, dalam Z] m; origin tengah bawah (parachute: origin '
                                        'di harness, tepi depan kanopi ke -Z); warna verteks COLOR_0 linear, material vc'), f, indent=1)
    log('ekspor', path, os.path.getsize(path), 'byte')


# ---------------------------------------------------------------- render
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def area(name, loc, target, size, power, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.size = size
    ld.color = color
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = Vector(loc)
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def sun(rot, energy, angle=0.05):
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = energy
    ld.angle = angle
    so = link(bpy.data.objects.new('sun', ld))
    so.rotation_euler = tuple(r * D2R for r in rot)


def cam_look(loc, target, lens=50):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.clip_start = 0.02
    cd.clip_end = 1000
    cam = link(bpy.data.objects.new('cam', cd))
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render_setup(engine, w, h):
    scn = bpy.context.scene
    if engine == 'CYCLES':
        scn.render.engine = 'CYCLES'
        prefs = bpy.context.preferences.addons['cycles'].preferences
        try:
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == 'METAL'
            scn.cycles.device = 'GPU'
        except Exception as e:
            log('GPU', e)
        scn.cycles.samples = SAMPLES
        scn.cycles.use_denoising = True
    else:
        scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass


def world_grad(bottom, top, light, strength):
    """Latar gradien layar untuk sinar kamera; warna 'light' sebagai cahaya lingkungan."""
    w = bpy.data.worlds.new('grad')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bl = nt.nodes['Background']
    bl.inputs['Color'].default_value = (*lin(light), 1)
    bl.inputs['Strength'].default_value = strength
    bc = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*lin(bottom), 1)
    ramp.color_ramp.elements[1].color = (*lin(top), 1)
    nt.links.new(tc.outputs['Window'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bc.inputs['Color'])
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs[0])
    nt.links.new(bl.outputs[0], mix.inputs[1])
    nt.links.new(bc.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes['World Output'].inputs['Surface'])


def floor(col, rough=0.85, size=40):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size)
    me = bpy.data.meshes.new('floor')
    bm.to_mesh(me)
    bm.free()
    fm = bpy.data.materials.new('floor')
    try:
        fm.use_nodes = True
    except Exception:
        pass
    fb = fm.node_tree.nodes['Principled BSDF']
    fb.inputs['Base Color'].default_value = (*lin(col), 1)
    fb.inputs['Roughness'].default_value = rough
    me.materials.append(fm)
    link(bpy.data.objects.new('floor', me))


KNOLL = {  # (x, y, rotasi z) tata letak rapi (Blender: kamera dari −Y)
    'vest1': (-0.84, 0.62, 0), 'vest2': (-0.3, 0.62, 0), 'vest3': (0.24, 0.62, 0), 'crate': (0.84, 0.6, -4),
    'helmet1': (-0.8, 0.06, 0), 'helmet2': (-0.5, 0.06, 0), 'helmet3': (-0.2, 0.06, 0), 'band': (0.08, 0.06, 0), 'kit': (0.42, 0.04, 0),
    'ammo_light': (-0.3, -0.37, 0), 'ammo_rifle': (-0.02, -0.37, 0), 'ammo_shell': (0.26, -0.37, 0),
}
MAIN_CAM = ('', (0.08, -1.5, 2.45), (0.08, 0.2, 0.05), 39)
CHECK_CAMS = [('_front', (-0.02, -1.3, 0.55), (-0.02, -0.4, 0.06), 45), ('_helm', (-0.5, -0.75, 0.5), (-0.5, 0.06, 0.07), 45),
              ('_crate', (1.3, -0.4, 0.8), (0.84, 0.6, 0.2), 45)]


def panel_items(pattern, engine, w, h, cams):
    for name, (x, y, rz) in KNOLL.items():
        ob = bpy.data.objects[name]
        ob.location = (x, y, 0)
        ob.rotation_euler = (0, 0, rz * D2R)
    bpy.data.objects['parachute'].hide_render = True
    world_grad('#9aa7b4', '#c9d3dd', '#c3d0de', 0.7)
    floor('#6f716b')
    sun((42, 0, -38), 3.0, 0.06)
    area('fill', (0.0, -2.6, 2.2), (0, 0.1, 0.0), 2.5, 220, (1, 0.97, 0.92))
    render_setup(engine, w, h)
    for nm, loc, tgt, lens in cams:
        cam_look(loc, tgt, lens)
        bpy.context.scene.render.filepath = pattern % nm
        bpy.ops.render.render(write_still=True)


def panel_chute(path, engine, w, h):
    for name in KNOLL:
        bpy.data.objects[name].hide_render = True
    world_grad('#dfe8f2', '#5c8fd6', '#a9c3e8', 0.8)
    sun((45, 0, 215), 3.2, 0.03)
    render_setup(engine, w, h)
    cam_look((-7.2, 8.2, 6.2), (-0.55, -0.2, 2.6), 42)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def composite(a_path, b_path, out_path):
    """Gabung dua panel berdampingan dengan garis pemisah emas."""
    import numpy as np
    A, B = bpy.data.images.load(a_path), bpy.data.images.load(b_path)
    (wa, h), (wb, hb) = A.size, B.size
    pa, pb = np.empty(wa * h * 4, np.float32), np.empty(wb * hb * 4, np.float32)
    A.pixels.foreach_get(pa)
    B.pixels.foreach_get(pb)
    out = np.concatenate([pa.reshape(h, wa, 4), pb.reshape(hb, wb, 4)], axis=1)
    out[:, wa - 2:wa + 2, :3] = [int(GOLD[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    out[:, :, 3] = 1.0
    img = bpy.data.images.new('lineup', wa + wb, h, alpha=False)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = out_path
    img.file_format = 'PNG'
    img.save()


def shots(engine, outdir, wa, wb, h, check=False):
    os.makedirs(outdir, exist_ok=True)
    t0 = time.time()
    items, chute = os.path.join(outdir, 'items%s.png'), os.path.join(outdir, 'chute.png')
    build_all()
    panel_items(items, engine, wa, h, [MAIN_CAM] + (CHECK_CAMS if check else []))
    build_all()
    panel_chute(chute, engine, wb, h)
    out = os.path.join(outdir, 'lineup.png')
    composite(items % '', chute, out)
    if not check:
        for p in (items % '', chute):
            os.remove(p)
    log('lineup', out, '%.1fs' % (time.time() - t0))


def main():
    objs, meta = build_all()
    if not opt('--no-export'):
        export(objs, meta)
    if opt('--quick'):
        shots('BLENDER_EEVEE', QDIR, 1300, 700, 900, check=True)
    if opt('--shots'):
        shots('CYCLES', PREV, 1560, 840, 1080)


main()
