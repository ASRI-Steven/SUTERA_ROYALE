"""Sutera Royale: benda lingkungan kota (Blender headless) → web/game/assets/env/envprops.glb + envprops.json.

Jalankan dari root proyek (mesin dipakai bersama: prioritas rendah, 2 thread):
  taskpolicy -b nice -n 19 ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P tools/blender/envprops.py -t 2 -- [--only lamp,sutet] [--fast] [--shots] [--no-export]

Opsi:
  --only a,b     hanya jenis tertentu (ekspor tetap memuat semua jenis lain dari GLB lama? tidak: --only untuk uji saja)
  --fast         AO kasar (iterasi cepat)
  --shots        render pratinjau Cycles ke preview/env/ (lineup kecil + lineup menara)
  --no-export    lewati ekspor GLB + JSON

Kontrak GLB (dipakai web/map/envprops.js, diinstans ribuan kali):
  - Satu simpul mesh per (jenis, LOD): '<jenis>_lod<k>'. glTF +Y atas, ukuran nyata (m), titik asal di tanah di tengah
    benda. Depan benda = +Z glTF (mis. lengan lampu ke arah jalan), kiri = +X.
  - Material bernama (warna dasar, kekasaran, logam, pijar dibaca game per verteks). Nama khusus:
      atlas_<kunci>  muka bertekstur atlas (UV 0..1 di muka; game memetakan ke sel atlas, iklan/nama per instans)
      net            jaring/kawat (alfa, dua sisi; UV dalam ubin 12 cm)
      lamp_red       lampu penerangan pesawat (berkedip), sig_r/sig_y/sig_g lampu lalu lintas (fase per instans)
      led            lensa lampu jalan, screen layar videotron
  - COLOR_0 = oklusi ambien per sudut (R), dipanggang di sini (sinar ke diri sendiri + tanah).
  - envprops.json: per jenis: lods (segitiga), size, col (tabrakan, koordinat penulis: x kanan, y depan, z atas),
    anchors (titik gantung kabel), lights.
Koordinat penulis di skrip ini: +Y depan, +X kanan, +Z atas; diputar 180° di Z saat jadi objek (→ depan = −Y Blender
= +Z glTF).
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
OUT = os.path.abspath(opt('--out', os.path.join(ROOT, 'web', 'game', 'assets', 'env')))
PREV = os.path.abspath(os.path.join(ROOT, 'preview', 'env'))
FAST = bool(opt('--fast'))
pi = math.pi
D2R = pi / 180
ROT = Matrix.Rotation(pi, 4, 'Z')  # penulis (+Y depan) → Blender (−Y depan) → glTF +Z depan


def log(*a):
    print('[envprops]', *a, flush=True)


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Rx(d):
    return Matrix.Rotation(d * D2R, 4, 'X')


def Ry(d):
    return Matrix.Rotation(d * D2R, 4, 'Y')


def Rz(d):
    return Matrix.Rotation(d * D2R, 4, 'Z')


def S(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


# ---------------------------------------------------------------- material
# nama: (warna sRGB, kekasaran, logam, pijar sRGB, kuat pijar)
MATS = {
    'galv': ('#a3a7aa', 0.42, 0.85),          # baja galvanis (tiang lampu, kisi BTS/SUTET)
    'galv_old': ('#8e918f', 0.55, 0.75),      # galvanis tua (SUTET)
    'steel': ('#5a5f65', 0.45, 0.6),          # baja dicat abu
    'steel_dark': ('#2e3236', 0.5, 0.35),     # rangka gelap
    'housing': ('#3b4045', 0.38, 0.4),        # rumah lampu LED (powder coat)
    'alu': ('#c3c7cb', 0.3, 0.9),
    'chrome': ('#e6e8ea', 0.12, 1.0),
    'paint_white': ('#e8e8e3', 0.42, 0.0),
    'paint_red': ('#c1301f', 0.42, 0.0),
    'paint_orange': ('#e2671c', 0.45, 0.0),
    'paint_yellow': ('#e8b21a', 0.42, 0.0),
    'paint_green': ('#245a3a', 0.45, 0.05),
    'paint_blue': ('#2f66a8', 0.42, 0.0),
    'paint_purple': ('#4a3db0', 0.38, 0.0),   # warna merek fiktif SPBU (palet game)
    'paint_gold': ('#d29f52', 0.35, 0.6),
    'paint_black': ('#1d1f22', 0.5, 0.0),
    'paint_grey': ('#6f757b', 0.45, 0.25),
    'paint_cream': ('#e3d7bd', 0.75, 0.0),
    'concrete': ('#a8a59c', 0.92, 0.0),
    'concrete_pole': ('#b8b5ac', 0.82, 0.0),
    'plaster': ('#e8e3d8', 0.85, 0.0),
    'stone': ('#77736b', 0.8, 0.0),
    'stone_dark': ('#3f3d3a', 0.6, 0.0),
    'tile_roof': ('#7a3f2a', 0.7, 0.0),
    'wood': ('#8a6443', 0.68, 0.0),
    'wood_dark': ('#5b3f2a', 0.7, 0.0),
    'glass': ('#3a4a54', 0.05, 0.0),           # kaca gelap (pantulan langit)
    'glass_clear': ('#9db0ba', 0.06, 0.0),     # kaca bening halte (padat di game, tampak terang memantul)
    'poly': ('#d9e6ec', 0.22, 0.0, '#cfe4ff', 0.25),   # polikarbonat atap halte (tembus cahaya, sedikit berpendar)
    'rubber': ('#141516', 0.75, 0.0),
    'plastic_green': ('#2f7d3f', 0.5, 0.0),
    'plastic_yellow': ('#e6a51c', 0.5, 0.0),
    'plastic_blue': ('#2563b8', 0.45, 0.0),
    'plastic_red': ('#c8281e', 0.45, 0.0),
    'insulator': ('#4d6b70', 0.08, 0.0),       # isolator kaca SUTET
    'porcelain': ('#8a4a2e', 0.2, 0.0),        # isolator porselen tiang 20 kV
    'grate': ('#4a4f54', 0.55, 0.7),
    'gravel': ('#8f8b82', 0.95, 0.0),
    'soil': ('#5e4b37', 0.95, 0.0),
    'led': ('#eceee8', 0.3, 0.0, '#fff4dc', 0.6),
    'lamp_red': ('#ff3020', 0.4, 0.0, '#ff2010', 4.0),
    'sig_r': ('#3a0808', 0.15, 0.0, '#ff1a0a', 3.0),
    'sig_y': ('#3a2a06', 0.15, 0.0, '#ffb010', 3.0),
    'sig_g': ('#062e1c', 0.15, 0.0, '#10ff8a', 3.0),
    'screen': ('#0e1013', 0.25, 0.0, '#ffffff', 1.0),
    'net': ('#e9e9e9', 0.7, 0.0),
    'atlas_ad': ('#ffffff', 0.45, 0.0),
    'atlas_name': ('#ffffff', 0.4, 0.0),
    'atlas_satpam': ('#ffffff', 0.4, 0.0),
    'atlas_loop': ('#ffffff', 0.35, 0.0),
    'atlas_fuel': ('#ffffff', 0.35, 0.0),
    'atlas_price': ('#ffffff', 0.35, 0.0, '#ffffff', 0.3),
    'atlas_sutet': ('#ffffff', 0.45, 0.0),
    'atlas_bts': ('#ffffff', 0.45, 0.0),
    'atlas_crane': ('#ffffff', 0.45, 0.0),
    'atlas_land': ('#ffffff', 0.45, 0.0),
    'atlas_timer': ('#ffffff', 0.3, 0.0, '#ffffff', 1.0),
    'atlas_media': ('#ffffff', 0.4, 0.0),
    'atlas_bin_o': ('#ffffff', 0.5, 0.0),
    'atlas_bin_a': ('#ffffff', 0.5, 0.0),
    'atlas_pump': ('#ffffff', 0.3, 0.0, '#ffffff', 0.6),
}
MAT_NAMES = list(MATS)
MI = {n: i for i, n in enumerate(MAT_NAMES)}
BMAT = {}


def make_materials():
    for n, spec in MATS.items():
        m = bpy.data.materials.new(n)
        try:
            m.use_nodes = True
        except Exception:
            pass
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (*srgb(spec[0]), 1)
        b.inputs['Roughness'].default_value = spec[1]
        b.inputs['Metallic'].default_value = spec[2]
        if len(spec) > 3:
            b.inputs['Emission Color'].default_value = (*srgb(spec[3]), 1)
            b.inputs['Emission Strength'].default_value = spec[4]
        BMAT[n] = m


# ---------------------------------------------------------------- mesh penulis
UVN = 'UVMap'


class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new(UVN)

    def add(self, src, mat, M=None, smooth=False, uv=None):
        """Salin src (dibebaskan) dengan material; uv(face, loop, co) → (u, v) opsional."""
        flip = M is not None and M.to_3x3().determinant() < 0
        vmap = {v: self.bm.verts.new(M @ v.co if M is not None else v.co.copy()) for v in src.verts}
        mi = MI[mat]
        out = []
        for f in src.faces:
            vs = [vmap[v] for v in f.verts]
            if flip:
                vs.reverse()
            try:
                nf = self.bm.faces.new(vs)
            except ValueError:
                continue
            nf.material_index = mi
            nf.smooth = smooth
            out.append(nf)
        src.free()
        if uv:
            for nf in out:
                nf.normal_update()
                for l in nf.loops:
                    l[self.uv].uv = uv(nf, l, l.vert.co)
        return out

    def quad(self, pts, mat, uvs=((0, 0), (1, 0), (1, 1), (0, 1)), smooth=False):
        vs = [self.bm.verts.new(Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = MI[mat]
        f.smooth = smooth
        for l, q in zip(f.loops, uvs):
            l[self.uv].uv = q
        return f

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


def bm_box(sx, sy, sz, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bevel = min(bevel, sx * 0.45, sy * 0.45, sz * 0.45)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type='OFFSET', segments=1, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    return bm


def box(m, mat, c, s, bevel=0.0, M=None, smooth=False, uv=None):
    """Kotak berpusat c, ukuran s."""
    bm = bm_box(*s, bevel=bevel)
    MM = T(*c) if M is None else M @ T(*c)
    return m.add(bm, mat, MM, smooth, uv)


def boxz(m, mat, x, y, z0, sx, sy, sz, bevel=0.0, M=None):
    """Kotak beralas z0."""
    return box(m, mat, (x, y, z0 + sz / 2), (sx, sy, sz), bevel, M)


def bm_cyl(r1, r2, h, segs=12, caps=True):
    """Silinder/kerucut sumbu Z, alas z = 0."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    return bm


def cyl(m, mat, x, y, z0, r1, r2, h, segs=12, caps=True, smooth=True, M=None):
    MM = T(x, y, z0) if M is None else M @ T(x, y, z0)
    return m.add(bm_cyl(r1, r2, h, segs, caps), mat, MM, smooth)


def frame_to(a, b):
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return T(*a) @ q.to_matrix().to_4x4(), d.length


def tube(m, mat, a, b, r, segs=8, caps=False, smooth=True, r2=None):
    M, L = frame_to(a, b)
    return m.add(bm_cyl(r, r if r2 is None else r2, L, segs, caps), mat, M, smooth)


def bar(m, mat, a, b, w, t, up=(0, 0, 1)):
    """Batang persegi dari a ke b (lebar w searah 'up' ⟂, tebal t)."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    L = d.length
    d.normalize()
    u = Vector(up)
    u = (u - d * u.dot(d))
    if u.length < 1e-6:
        u = d.orthogonal()
    u.normalize()
    s = d.cross(u)
    M = Matrix((
        (s.x, u.x, d.x, 0), (s.y, u.y, d.y, 0), (s.z, u.z, d.z, 0), (0, 0, 0, 1)))
    bm = bm_box(t, w, L)
    return m.add(bm, mat, T(*((a + b) / 2)) @ M)


def prof_member(m, mat, a, b, prof, f1, f2):
    """Ekstrusi profil 2D (titik di bidang f1,f2) dari a ke b, tanpa tutup."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    e1 = Vector(f1)
    e1 = e1 - d * e1.dot(d)
    if e1.length < 1e-6:
        e1 = d.orthogonal()
    e1.normalize()
    e2 = Vector(f2)
    e2 = e2 - d * e2.dot(d) - e1 * e2.dot(e1)
    if e2.length < 1e-6:
        e2 = d.cross(e1)
    e2.normalize()
    bm = bmesh.new()
    ra = [bm.verts.new(a + e1 * p[0] + e2 * p[1]) for p in prof]
    rb = [bm.verts.new(b + e1 * p[0] + e2 * p[1]) for p in prof]
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
    bm.normal_update()
    # orientasi: normal menjauhi sumbu profil (titik berat profil)
    cx = sum(p[0] for p in prof) / n
    cy = sum(p[1] for p in prof) / n
    for f in bm.faces:
        c = f.calc_center_median()
        mid = a + (b - a) * ((c - a).dot(b - a) / max(1e-9, (b - a).length_squared))
        out = c - (mid + e1 * cx + e2 * cy)
        if f.normal.dot(out) < 0:
            f.normal_flip()
    return m.add(bm, mat)


def angle_m(m, mat, a, b, f1, f2, w, t=None):
    """Besi siku (profil L) dengan sudut di garis a→b, sayap ke arah f1 dan f2."""
    t = t or max(0.008, w * 0.1)
    return prof_member(m, mat, a, b, [(0, 0), (w, 0), (w, t), (t, t), (t, w), (0, w)], f1, f2)


def flat_m(m, mat, a, b, f1, f2, w, t=None):
    """Plat strip: lebar w searah f1, tebal t searah f2 (berpusat di garis)."""
    t = t or max(0.008, w * 0.12)
    return prof_member(m, mat, a, b, [(-w / 2, 0), (w / 2, 0), (w / 2, t), (-w / 2, t)], f1, f2)


def lathe(m, mat, prof, segs=12, M=None, smooth=True, cap_top=False, cap_bot=False):
    """Putar profil [(r, z)] mengelilingi sumbu Z."""
    bm = bmesh.new()
    rings = []
    for (r, z) in prof:
        if r < 1e-5:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * pi * i / segs), r * math.sin(2 * pi * i / segs), z)) for i in range(segs)])
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(segs):
            j = (i + 1) % segs
            if len(A) == 1:
                bm.faces.new((A[0], B[i], B[j]) if prof[k + 1][1] > prof[k][1] else (A[0], B[j], B[i]))
            elif len(B) == 1:
                bm.faces.new((A[i], A[j], B[0]))
            else:
                bm.faces.new((A[i], A[j], B[j], B[i]))
    if cap_bot and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bm.normal_update()
    # normal keluar (menjauhi sumbu atau ke atas/bawah pada tutup)
    for f in bm.faces:
        c = f.calc_center_median()
        o = Vector((c.x, c.y, 0))
        if o.length < 1e-4:
            o = Vector((0, 0, 1 if c.z > sum(p[1] for p in prof) / len(prof) else -1))
        if f.normal.dot(o) < 0 and abs(f.normal.z) < 0.999:
            f.normal_flip()
    return m.add(bm, mat, M, smooth)


def path_tube(m, mat, pts, r, segs=8, smooth=True):
    """Pipa menerus melewati titik-titik (cincin bermiter, tanpa tutup)."""
    P = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    ref = Vector((0, 0, 1))
    for i, p in enumerate(P):
        if i == 0:
            t = (P[1] - P[0]).normalized()
        elif i == len(P) - 1:
            t = (P[-1] - P[-2]).normalized()
        else:
            t = ((P[i] - P[i - 1]).normalized() + (P[i + 1] - P[i]).normalized()).normalized()
        u = ref - t * ref.dot(t)
        if u.length < 1e-4:
            u = t.orthogonal()
        u.normalize()
        v = t.cross(u)
        ref = u
        rings.append([bm.verts.new(p + (u * math.cos(2 * pi * k / segs) + v * math.sin(2 * pi * k / segs)) * r) for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        best = min(P, key=lambda q: (q - c).length)
        if f.normal.dot(c - best) < 0:
            f.normal_flip()
    return m.add(bm, mat, None, smooth)


def loft(m, mat, rings, cap0=True, cap1=True, smooth=False):
    bm = bmesh.new()
    vr = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
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
    return m.add(bm, mat, None, smooth)


def rrect(cx, cy, w, h, r, n=3):
    """Persegi panjang bersudut bulat (titik 2D berlawanan jarum jam)."""
    pts = []
    for k, (sx, sy, a0) in enumerate(((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270))):
        ox, oy = cx + sx * (w / 2 - r), cy + sy * (h / 2 - r)
        for i in range(n + 1):
            a = (a0 + 90 * i / n) * D2R
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def sign(m, mat, c, w, h, normal='+y'):
    """Muka papan tegak (UV 0..1, tulisan terbaca dari depan) berpusat c, lebar w, tinggi h, menghadap 'normal'."""
    x, y, z = c
    z0, z1 = z - h / 2, z + h / 2
    if normal == '+y':    # dilihat dari +Y: kanan penonton = −X
        pts = [(x + w / 2, y, z0), (x - w / 2, y, z0), (x - w / 2, y, z1), (x + w / 2, y, z1)]
    elif normal == '-y':  # kanan penonton = +X
        pts = [(x - w / 2, y, z0), (x + w / 2, y, z0), (x + w / 2, y, z1), (x - w / 2, y, z1)]
    elif normal == '+x':  # kanan penonton = +Y
        pts = [(x, y - w / 2, z0), (x, y + w / 2, z0), (x, y + w / 2, z1), (x, y - w / 2, z1)]
    else:                 # '-x': kanan penonton = −Y
        pts = [(x, y + w / 2, z0), (x, y - w / 2, z0), (x, y - w / 2, z1), (x, y + w / 2, z1)]
    m.quad(pts, mat)


def net_uv(scale=0.12):
    """UV jaring: koordinat bidang muka dalam ubin 'scale' m."""
    def f(face, loop, co):
        n = face.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        return (co[a] / scale, co[b] / scale)
    return f


# ---------------------------------------------------------------- menara kisi
CORNERS = ((1, 1), (-1, 1), (-1, -1), (1, -1))
FACES = (((1, 1), (1, -1), (1, 0)), ((-1, 1), (1, 1), (0, 1)), ((-1, -1), (-1, 1), (-1, 0)), ((1, -1), (-1, -1), (0, -1)))


def sq_tower(m, levels, leg_w, br_w, mat, lod=0, matfn=None, sec=0, horiz=True, pipe=False, skipface=None):
    """Menara kisi persegi: levels = [(z, setengah lebar)]. Kaki = besi siku (atau pipa), bresing X tiap panel per sisi,
    horizontal di tiap batas panel; sec > 0 = bresing sekunder (K) di panel bawah yang lebar (LOD0)."""
    for i in range(len(levels) - 1):
        (z0, h0), (z1, h1) = levels[i], levels[i + 1]
        mt = matfn(i) if matfn else mat
        for (sx, sy) in CORNERS:
            a, b = (sx * h0, sy * h0, z0), (sx * h1, sy * h1, z1)
            if pipe:
                tube(m, mt, a, b, leg_w / 2, 8 if lod == 0 else 5)
            elif lod >= 2:
                w2 = leg_w / 2
                prof_member(m, mt, a, b, [(-w2, -w2), (w2, -w2), (w2, w2), (-w2, w2)], (1, 0, 0), (0, 1, 0))
            else:
                angle_m(m, mt, a, b, (-sx, 0, 0), (0, -sy, 0), leg_w)
        for (c1, c2, n) in FACES:
            if skipface and skipface(i, n):
                continue
            A0 = Vector((c1[0] * h0, c1[1] * h0, z0))
            B0 = Vector((c2[0] * h0, c2[1] * h0, z0))
            A1 = Vector((c1[0] * h1, c1[1] * h1, z1))
            B1 = Vector((c2[0] * h1, c2[1] * h1, z1))
            nv = Vector((n[0], n[1], 0))
            if lod >= 2:
                if i % 2 == 0:
                    flat_m(m, mt, A0, B1, nv.cross(B1 - A0), -nv, br_w * 1.6, br_w * 0.8)
                continue
            for (p, q) in ((A0, B1), (B0, A1)):
                inf = nv.cross(q - p)
                flat_m(m, mt, p, q, inf, -nv, br_w)
            if horiz and (lod == 0 or i % 2 == 1):
                flat_m(m, mt, A1, B1, (0, 0, 1), -nv, br_w)
            if sec and lod == 0 and i < sec and (h0 + h1) > 3.0:
                # bresing sekunder: dari titik tengah diagonal ke kaki & ke tengah horizontal bawah
                Cm = (A0 + B1 + B0 + A1) / 4
                for q in ((A0 + A1) / 2, (B0 + B1) / 2, (A0 + B0) / 2):
                    flat_m(m, mt, Cm, q, nv.cross(q - Cm), -nv, br_w * 0.7)


# ---------------------------------------------------------------- model
MODELS = {}


def model(name, lods=(0, 1), ao=0.8, big=False):
    def deco(fn):
        MODELS[name] = dict(fn=fn, lods=lods, ao=ao, big=big)
        return fn
    return deco


# ---------- lampu jalan satu lengan (9 m)
def led_head(m, y0, z, L=0.74, W=0.30, Hh=0.10, tilt=5, lod=0):
    """Kepala lampu LED di ujung lengan (lengan berakhir di (0, y0, z)), menghadap +Y."""
    M = T(0, y0, z) @ Rx(tilt)
    if lod >= 1:
        box(m, 'housing', (0, L / 2, -0.01), (W * 0.9, L, Hh), M=M)
        box(m, 'led', (0, L * 0.55, -0.06), (W * 0.6, L * 0.6, 0.01), M=M)
        return
    rings = []
    for (y, w, h) in ((-0.02, 0.10, 0.07), (0.08, 0.22, 0.085), (0.22, W, Hh), (L - 0.12, W, Hh * 0.95), (L, W * 0.78, Hh * 0.7)):
        rings.append([(M @ Vector((px, y, pz))) for (px, pz) in rrect(0, 0, w, h, min(w, h) * 0.35, 2)])
    loft(m, 'housing', rings, smooth=True)
    # lensa datar di bawah
    lw, l0, l1 = W * 0.72, 0.24, L - 0.14
    box(m, 'led', (0, (l0 + l1) / 2, -Hh / 2 + 0.002), (lw, l1 - l0, 0.012), M=M)
    # sirip pendingin di atas
    for k in (-1, 0, 1):
        box(m, 'housing', (k * W * 0.22, 0.42, Hh / 2 + 0.012), (0.012, 0.32, 0.026), M=M)
    cyl(m, 'housing', 0, 0.14, Hh / 2, 0.026, 0.022, 0.035, 8, M=M)
    m.add(bmesh_dome(0.024, 6), 'paint_black', M @ T(0, 0.14, Hh / 2 + 0.035))


def bmesh_dome(r, segs=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(3, segs // 2), radius=r)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
    return bm


def lamp_pole(m, H, r0, r1, lod, base=0.26):
    if lod == 0:
        cyl(m, 'concrete', 0, 0, 0, base, base * 0.92, 0.1, 10)
        box(m, 'galv', (0, 0, 0.112), (0.34, 0.34, 0.025), bevel=0.004)
        for sx, sy in CORNERS:
            cyl(m, 'galv', sx * 0.125, sy * 0.125, 0.1, 0.016, 0.016, 0.07, 6)
            cyl(m, 'galv', sx * 0.125, sy * 0.125, 0.125, 0.028, 0.028, 0.026, 6, smooth=False)
        cyl(m, 'galv', 0, 0, 0.124, r0 * 1.22, r0, 0.14, 8, smooth=False)
        cyl(m, 'galv', 0, 0, 0.26, r0, r1, H - 0.26, 8, caps=False, smooth=False)
        box(m, 'galv_old', (0, -r0 * 0.93, 0.62), (r0 * 0.75, 0.012, 0.34))  # pintu servis
        cyl(m, 'galv', 0, 0, H, r1 * 1.15, r1 * 1.05, 0.12, 8)
    else:
        cyl(m, 'concrete', 0, 0, 0, base, base, 0.1, 6, smooth=False)
        cyl(m, 'galv', 0, 0, 0.1, r0, r1, H - 0.1, 6, caps=False, smooth=False)


@model('lamp', lods=(0, 1))
def m_lamp(lod):
    m = Mesh()
    H = 8.85
    lamp_pole(m, H, 0.105, 0.058, lod)
    pts = [(0, 0, H - 0.1), (0, 0, H + 0.18), (0, 0.07, H + 0.34), (0, 0.32, H + 0.48), (0, 0.8, H + 0.58), (0, 1.4, H + 0.62), (0, 1.92, H + 0.63)]
    if lod == 0:
        path_tube(m, 'galv', pts, 0.034, 8)
        led_head(m, 1.9, H + 0.63, lod=0)
    else:
        path_tube(m, 'galv', [pts[0], pts[3], pts[6]], 0.04, 4, smooth=False)
        led_head(m, 1.9, H + 0.63, lod=1)
    meta = dict(col=[dict(c=[0, 0, 0.13], h=9.0)], lights=[[0, 2.25, H + 0.58]])
    return m, meta


@model('lamp2', lods=(0, 1))
def m_lamp2(lod):
    m = Mesh()
    H = 9.9
    lamp_pole(m, H, 0.13, 0.068, lod, base=0.32)
    for s in (1, -1):
        pts = [(0, 0, H - 0.1), (0, 0, H + 0.12), (0, 0.06 * s, H + 0.3), (0, 0.3 * s, H + 0.45), (0, 0.8 * s, H + 0.55), (0, 1.35 * s, H + 0.6), (0, 1.75 * s, H + 0.6)]
        sub = Mesh()
        if lod == 0:
            path_tube(m, 'galv', pts, 0.036, 8)
            led_head(sub, 1.73, H + 0.6, lod=0)
        else:
            path_tube(m, 'galv', [pts[0], pts[3], pts[6]], 0.042, 4, smooth=False)
            led_head(sub, 1.73, H + 0.6, lod=1)
        merge_mesh(m, sub, None if s > 0 else Rz(180))
    meta = dict(col=[dict(c=[0, 0, 0.16], h=10.0)], lights=[[0, 2.1, H + 0.55], [0, -2.1, H + 0.55]])
    return m, meta


def merge_mesh(dst, src, M=None):
    """Salin Mesh src (dengan material & UV) ke dst."""
    flip = M is not None and M.to_3x3().determinant() < 0
    vmap = {v: dst.bm.verts.new(M @ v.co if M is not None else v.co.copy()) for v in src.bm.verts}
    for f in src.bm.faces:
        vs = [vmap[v] for v in f.verts]
        uvs = [l[src.uv].uv.copy() for l in f.loops]
        if flip:
            vs.reverse()
            uvs.reverse()
        try:
            nf = dst.bm.faces.new(vs)
        except ValueError:
            continue
        nf.material_index = f.material_index
        nf.smooth = f.smooth
        for l, q in zip(nf.loops, uvs):
            l[dst.uv].uv = q
    src.bm.free()


# ---------- tiang listrik beton 20 kV (+ varian trafo)
def post_insulator(m, x, y, z, lod, h=0.26):
    if lod >= 1:
        cyl(m, 'porcelain', x, y, z, 0.05, 0.04, h, 6)
        return
    prof = [(0.028, 0), (0.03, 0.03)]
    for k in range(3):
        zz = 0.05 + k * 0.07
        prof += [(0.032, zz), (0.07, zz + 0.015), (0.034, zz + 0.04)]
    prof += [(0.03, h - 0.02), (0.022, h)]
    lathe(m, 'porcelain', [(r, z + q) for r, q in prof], 10, M=T(x, y, 0))


def pole_base(m, lod, H=11.0):
    if lod == 0:
        cyl(m, 'concrete_pole', 0, 0, 0, 0.158, 0.095, H, 14, caps=False)
        cyl(m, 'concrete_pole', 0, 0, H, 0.098, 0.06, 0.06, 14)
        box(m, 'paint_black', (0, 0.152, 2.6), (0.12, 0.012, 0.16))  # pelat nomor tiang
        box(m, 'paint_white', (0, 0.159, 2.6), (0.10, 0.004, 0.13))
    else:
        cyl(m, 'concrete_pole', 0, 0, 0, 0.16, 0.095, H, 6, caps=False, smooth=False)
    # palang (besi kanal) melintang searah jalan-ke-trotoar (sumbu Y), kawat sejajar jalan (sumbu X)
    za = H - 0.42
    box(m, 'galv', (0, 0, za), (0.075, 2.0, 0.1))
    if lod == 0:
        for s in (1, -1):
            flat_m(m, 'galv', (0, s * 0.62, za - 0.05), (0, s * 0.08, za - 0.7), (1, 0, 0), (0, 0, 1), 0.04, 0.006)
        box(m, 'galv', (0, 0, za - 0.7), (0.24, 0.2, 0.06))
    for s in (1, -1):
        post_insulator(m, 0, s * 0.85, za + 0.05, lod)
    post_insulator(m, 0, 0, H + 0.02, lod)
    # klem kabel tegangan rendah (kabel pilin) & kabel telekomunikasi
    box(m, 'steel_dark', (0, 0.13, 8.55), (0.1, 0.12, 0.08))
    box(m, 'steel_dark', (0, 0.12, 7.1), (0.08, 0.1, 0.06))
    return za


@model('pole', lods=(0, 1))
def m_pole(lod):
    m = Mesh()
    za = pole_base(m, lod)
    meta = dict(col=[dict(c=[0, 0, 0.17], h=11.0)],
                anchors=dict(mv=[[0, 0.85, za + 0.3], [0, 0, 11.27], [0, -0.85, za + 0.3]], lv=[[0, 0.19, 8.55]], tel=[[0, 0.17, 7.1]]))
    return m, meta


@model('pole_t', lods=(0, 1))
def m_pole_t(lod):
    m = Mesh()
    za = pole_base(m, lod)
    # trafo tiang di sisi belakang (−Y) + panel PHB di bawah
    zt = 7.55
    box(m, 'galv', (0, -0.3, zt), (0.08, 0.62, 0.08))
    box(m, 'galv', (0, -0.3, zt + 0.55), (0.08, 0.62, 0.06))
    tz = zt + 0.05
    cyl(m, 'paint_grey', 0, -0.62, tz, 0.3, 0.3, 0.86, 16 if lod == 0 else 8)
    cyl(m, 'paint_grey', 0, -0.62, tz + 0.86, 0.32, 0.28, 0.05, 16 if lod == 0 else 8)
    if lod == 0:
        for k in range(8):
            a = (k + 0.5) / 8 * 2 * pi
            if abs(math.sin(a)) > 0.8 and math.cos(a) < 0:
                continue
            box(m, 'paint_grey', (math.cos(a) * 0.36, -0.62 + math.sin(a) * 0.36, tz + 0.43), (0.12 if abs(math.cos(a)) > 0.5 else 0.025, 0.025 if abs(math.cos(a)) > 0.5 else 0.12, 0.7),
                M=None)
        for k in (-1, 0, 1):
            post_insulator(m, k * 0.13, -0.62, tz + 0.9, 0, 0.2)
        for s in (-1, 0, 1):  # fuse cut-out di palang
            box(m, 'porcelain', (0.08, s * 0.55, za - 0.25), (0.05, 0.05, 0.32), M=None)
        tube(m, 'rubber', (0.1, -0.6, tz), (0.1, -0.18, 2.5), 0.025, 5)
    box(m, 'paint_grey', (0, -0.33, 2.0), (0.55, 0.28, 0.9), bevel=0.01 if lod == 0 else 0)
    if lod == 0:
        box(m, 'steel_dark', (0, -0.475, 2.0), (0.5, 0.01, 0.8))
        box(m, 'paint_grey', (0, -0.33, 2.47), (0.6, 0.33, 0.04))
    meta = dict(col=[dict(c=[0, 0, 0.17], h=11.0), dict(b=[0, -0.33, 0.6, 0.32], h=2.5, z0=1.5)],
                anchors=dict(mv=[[0, 0.85, za + 0.3], [0, 0, 11.27], [0, -0.85, za + 0.3]], lv=[[0, 0.19, 8.55]], tel=[[0, 0.17, 7.1]]))
    return m, meta


# ---------- menara SUTET 500 kV sirkuit ganda
SUTET_LV = [(0, 6.0), (5.5, 5.0), (11, 4.1), (16.5, 3.3), (22, 2.6), (27, 2.0), (31, 1.65), (34, 1.5), (37, 1.5),
            (41.25, 1.5), (45.5, 1.5), (49.75, 1.45), (54, 1.4), (57.5, 1.1), (60, 0.55)]
SUTET_ARMS = [(37.0, 9.5), (45.5, 11.0), (54.0, 8.6)]   # (z bawah lengan, panjang dari muka badan)
SUTET_STR = 5.4                                          # panjang rangkaian isolator


def hw_at(levels, z):
    for (z0, h0), (z1, h1) in zip(levels, levels[1:]):
        if z0 <= z <= z1:
            return h0 + (h1 - h0) * (z - z0) / (z1 - z0)
    return levels[-1][1]


def arm_lattice(m, mat, side, z, length, root_hw, root_h, tip_h=0.55, tip_hw=0.5, bays=5, lod=0, w=0.11):
    """Lengan melintang (sumbu X), penampang: dua batang bawah datar + dua batang atas menurun ke ujung."""
    s = side
    x0, x1 = s * root_hw, s * (root_hw + length)
    def P(t, top, yy):
        x = x0 + (x1 - x0) * t
        hw = root_hw + (tip_hw - root_hw) * t
        zz = z + (root_h + (tip_h - root_h) * t if top else 0)
        return Vector((x, yy * hw, zz))
    if lod >= 2:  # jauh: satu batang bawah datar + satu batang atas miring (pelat lebar)
        flat_m(m, mat, P(0, False, 0), P(1, False, 0), (0, 1, 0), (0, 0, 1), root_hw * 1.2, w)
        flat_m(m, mat, P(0, True, 0), P(1, True, 0), (0, 1, 0), (0, 0, -1), root_hw * 0.9, w)
        return
    chords = [(False, 1), (False, -1), (True, 1), (True, -1)]
    for (top, yy) in chords:
        angle_m(m, mat, P(0, top, yy), P(1, top, yy), (0, -yy, 0), (0, 0, -1 if top else 1), w * 1.25)
    nb = bays if lod == 0 else max(2, bays // 2)
    for k in range(nb):
        t0, t1 = k / nb, (k + 1) / nb
        for yy in (1, -1):  # sisi depan/belakang (bidang miring)
            flat_m(m, mat, P(t0, False, yy), P(t1, True, yy), (0, yy, 0), (0, -yy, 0), w * 0.8)
        # bawah (bidang datar)
        flat_m(m, mat, P(t0, False, 1), P(t1, False, -1), (0, 0, 1), (0, 0, 1), w * 0.8)
        # atas
        if lod == 0:
            flat_m(m, mat, P(t0, True, -1), P(t1, True, 1), (0, 0, 1), (0, 0, -1), w * 0.7)
            for yy in (1, -1):
                flat_m(m, mat, P(t1, False, yy), P(t1, True, yy), (1, 0, 0), (0, -yy, 0), w * 0.7)
    # ujung: pelat gantung isolator
    box(m, mat, P(1, False, 0) + Vector((0, 0, -0.05)), (0.3, tip_hw * 2 + 0.1, 0.1))


def insulator_string(m, x, y, ztop, L, lod, mat='insulator'):
    """Rangkaian isolator piring (I-string) menggantung dari ztop, panjang L."""
    if lod >= 2:
        return
    tube(m, 'galv', (x, y, ztop), (x, y, ztop - 0.35), 0.03, 5)
    zb = ztop - L
    if lod == 1:
        cyl(m, mat, x, y, zb + 0.4, 0.12, 0.12, L - 0.8, 6, smooth=False)
    else:
        prof = []
        n = 13
        z0, z1 = zb + 0.45, ztop - 0.4
        for k in range(n):
            zz = z1 - (z1 - z0) * k / (n - 1)
            prof += [(0.045, zz + 0.05), (0.16, zz), (0.05, zz - 0.06)]
        prof.reverse()
        lathe(m, mat, prof, 7)
        tube(m, 'galv', (x, y, z1 + 0.05), (x, y, ztop - 0.33), 0.025, 5)
    # klem & yoke bawah (untuk konduktor ganda)
    box(m, 'galv', (x, y, zb + 0.32), (0.08, 0.55, 0.08))
    for s in (1, -1):
        tube(m, 'galv', (x, y + s * 0.25, zb + 0.3), (x, y + s * 0.25, zb + 0.05), 0.025, 5)


@model('sutet', lods=(0, 1, 2), ao=2.0, big=True)
def m_sutet(lod):
    m = Mesh()
    mat = 'galv_old'
    lv = SUTET_LV if lod == 0 else [SUTET_LV[i] for i in (0, 2, 4, 6, 8, 10, 12, 14)]
    sq_tower(m, lv, 0.24 if lod < 2 else 0.34, 0.1 if lod < 2 else 0.2, mat, lod, sec=6 if lod == 0 else 0, horiz=True)
    anchors = dict(cond=[], earth=[])
    for (z, L) in SUTET_ARMS:
        hw = hw_at(SUTET_LV, z)
        for s in (1, -1):
            arm_lattice(m, mat, s, z, L, hw, 2.6, lod=lod, bays=(6 if L > 10 else 5) if lod == 0 else 2)
            xt = s * (hw + L - 0.3)
            insulator_string(m, xt, 0, z - 0.1, SUTET_STR, lod)
            for yy in (0.25, -0.25):
                anchors['cond'].append([round(xt, 3), yy, round(z - 0.1 - SUTET_STR + 0.05, 3)])
    # puncak: lengan kawat tanah
    zt = 60.0
    for s in (1, -1):
        a, b = Vector((s * 0.5, 0, zt)), Vector((s * 3.6, 0, zt + 0.6))
        if lod >= 2:
            bar(m, mat, a, b, 0.25, 0.25)
        else:
            for yy in (0.35, -0.35):
                angle_m(m, mat, Vector((a.x, yy, a.z)), Vector((b.x, yy * 0.4, b.z)), (0, -1 if yy > 0 else 1, 0), (0, 0, 1), 0.12)
            angle_m(m, mat, Vector((s * 0.55, 0, zt - 2.5)), b, (0, 1, 0), (0, 0, 1), 0.1)
            box(m, 'galv', (s * 3.6, 0, zt + 0.55), (0.25, 0.25, 0.12))
        anchors['earth'].append([s * 3.6, 0, zt + 0.5])
    # pondasi beton di kaki
    for (sx, sy) in CORNERS:
        boxz(m, 'concrete', sx * 6.0, sy * 6.0, -0.05, 1.1, 1.1, 0.5 if lod < 2 else 0.4)
    if lod == 0:
        # pelat peringatan bahaya di kaki depan
        box(m, 'galv', (-4.95, 4.95, 2.3), (0.04, 0.04, 0.5))
        sign(m, 'atlas_sutet', (-4.95, 5.02, 2.375), 0.6, 0.45, '+y')
        # penghalang panjat (kawat duri) di ketinggian 4 m
        for (sx, sy) in CORNERS:
            hw = hw_at(SUTET_LV, 4.0)
            for k in range(3):
                zz = 3.7 + k * 0.18
                box(m, 'galv', (sx * (hw + 0.05), sy * hw * 0.5, zz), (0.02, hw * 0.95, 0.02))
                box(m, 'galv', (sx * hw * 0.5, sy * (hw + 0.05), zz), (hw * 0.95, 0.02, 0.02))
    meta = dict(col=[dict(b=[sx * 5.95, sy * 5.95, 1.0, 1.0], h=7.0) for sx, sy in CORNERS], anchors=anchors)
    return m, meta


# ---------- BTS menara kisi 4 kaki 45 m (merah-putih)
BTS_LV = [(0, 2.75), (6, 2.4), (12, 2.05), (18, 1.72), (24, 1.42), (30, 1.15), (36, 0.95), (41.5, 0.82)]


def antenna_panel(m, cx, cy, z, az, lod, h=1.8):
    M = T(cx, cy, z) @ Rz(az)
    if lod >= 1:
        box(m, 'paint_white', (0, 0, 0), (0.3, 0.11, h), M=M)
        return
    box(m, 'paint_white', (0, 0, 0), (0.3, 0.11, h), bevel=0.02, M=M)
    box(m, 'paint_white', (0, 0, h / 2 + 0.03), (0.26, 0.09, 0.06), M=M)
    box(m, 'paint_grey', (0, -0.16, -0.25), (0.26, 0.14, 0.42), bevel=0.01, M=M)  # RRU
    box(m, 'galv', (0, -0.1, h * 0.35), (0.05, 0.12, 0.05), M=M)
    box(m, 'galv', (0, -0.1, -h * 0.35), (0.05, 0.12, 0.05), M=M)


def dish(m, x, y, z, az, r, lod):
    M = T(x, y, z) @ Rz(az) @ Rx(-90)
    if lod >= 1:
        cyl(m, 'paint_white', 0, 0, 0, r, r, 0.12, 8, M=M, smooth=False)
        return
    cyl(m, 'paint_grey', 0, 0, -0.28, r * 0.85, r * 0.92, 0.28, 16, M=M)
    cyl(m, 'paint_white', 0, 0, 0, r * 0.98, r, 0.06, 16, M=M)
    lathe(m, 'paint_white', [(r, 0.06), (r * 0.8, 0.1), (0.0, 0.12)], 16, M=M @ T(0, 0, 0))


@model('bts', lods=(0, 1, 2), ao=1.2, big=True)
def m_bts(lod):
    m = Mesh()
    band = lambda i: 'paint_red' if i % 2 == 0 else 'paint_white'  # noqa: E731
    lv = BTS_LV if lod < 2 else [BTS_LV[i] for i in (0, 2, 4, 6, 7)]
    sq_tower(m, lv, 0.16 if lod == 0 else 0.2 if lod == 1 else 0.3, 0.07 if lod < 2 else 0.16, 'paint_red', lod,
             matfn=(band if lod < 2 else (lambda i: 'paint_red' if i % 2 == 0 else 'paint_white')), pipe=(lod == 0))
    zt = BTS_LV[-1][0]
    hw = BTS_LV[-1][1]
    # platform antena
    P = 1.45
    if lod < 2:
        for k, (c1, c2, n) in enumerate(FACES):
            a = Vector((c1[0] * P, c1[1] * P, zt - 1.6))
            b = Vector((c2[0] * P, c2[1] * P, zt - 1.6))
            bar(m, 'galv', a, b, 0.12, 0.08)
            if lod == 0:
                bar(m, 'galv', a + Vector((0, 0, 1.05)), b + Vector((0, 0, 1.05)), 0.05, 0.05)
                for t in (0.0, 0.5):
                    p = a + (b - a) * t
                    tube(m, 'galv', p, p + Vector((0, 0, 1.05)), 0.025, 5)
        box(m, 'grate', (0, 0, zt - 1.62), (P * 2, P * 2, 0.04))
        for (sx, sy) in CORNERS:
            bar(m, 'galv', (sx * hw, sy * hw, zt - 1.6), (sx * P, sy * P, zt - 1.6), 0.08, 0.08)
    # antena sektor (3 arah) + pipa dudukan
    for k in range(3):
        az = k * 120 + 15
        a = az * D2R
        cx, cy = math.sin(a) * (P + 0.25), math.cos(a) * (P + 0.25)
        if lod < 2:
            tube(m, 'galv', (cx, cy, zt - 2.3), (cx, cy, zt + 1.6), 0.04, 6)
        for j, off in enumerate((-0.42, 0.42)):
            ox, oy = math.cos(a) * off, -math.sin(a) * off
            if lod < 2:
                antenna_panel(m, cx + ox + math.sin(a) * 0.18, cy + oy + math.cos(a) * 0.18, zt, -az, lod)
        if lod >= 2:  # jauh: satu blok antena per sektor
            box(m, 'paint_white', (cx, cy, zt), (0.9, 0.9, 1.8), M=None)
    # parabola gelombang mikro
    for (z, az, r) in ((34.0, 40, 0.5), (32.5, 200, 0.42), (28.0, 300, 0.36)):
        if lod >= 2:
            continue
        hwz = hw_at(BTS_LV, z)
        a = az * D2R
        x, y = math.sin(a) * (hwz + 0.55), math.cos(a) * (hwz + 0.55)
        dish(m, x, y, z, -az, r, lod)
        bar(m, 'galv', (math.sin(a) * hwz, math.cos(a) * hwz, z), (x * 0.92, y * 0.92, z), 0.06, 0.06)
    # penangkal petir + lampu pesawat
    if lod >= 2:
        box(m, 'lamp_red', (0, 0, zt + 0.3), (0.35, 0.35, 0.35))
        return m, dict(col=[], lights=[[0, 0, zt + 0.3]])
    tube(m, 'galv', (0, 0, zt), (0, 0, zt + 4.0), 0.03 if lod == 0 else 0.05, 6)
    if lod == 0:
        for (sx, sy) in CORNERS:
            bar(m, 'galv', (sx * hw, sy * hw, zt), (0, 0, zt + 1.4), 0.05, 0.05)
    m.add(bmesh_dome(0.11, 8), 'lamp_red', T(0, 0, zt + 4.0))
    cyl(m, 'paint_red', 0, 0, zt + 3.95, 0.08, 0.08, 0.06, 8)
    for (sx, sy) in ((1, 1), (-1, -1)):
        hwz = hw_at(BTS_LV, 21.0)
        m.add(bmesh_dome(0.08, 8), 'lamp_red', T(sx * (hwz + 0.12), sy * (hwz + 0.12), 21.0))
        box(m, 'steel_dark', (sx * (hwz + 0.06), sy * (hwz + 0.06), 20.97), (0.14, 0.14, 0.06))
    if lod == 0:
        # tangga kabel (feeder) di sisi −Y + kabel
        for z0 in range(0, 40, 6):
            z1 = z0 + 6
            y0 = -hw_at(BTS_LV, z0) + 0.25
            y1 = -hw_at(BTS_LV, z1) + 0.25
            for xx in (-0.2, 0.2):
                bar(m, 'galv', (xx, y0, z0 + 0.4), (xx, y1, z1 + 0.4), 0.05, 0.02, (0, 1, 0))
            tube(m, 'rubber', (0.0, y0 + 0.06, z0 + 0.4), (0.0, y1 + 0.06, z1 + 0.4), 0.07, 6)
    # pondasi, kerikil, kabinet perangkat
    for (sx, sy) in CORNERS:
        boxz(m, 'concrete', sx * 2.75, sy * 2.75, -0.05, 0.8, 0.8, 0.45)
    boxz(m, 'gravel', 0, 0, -0.02, 11.6, 11.6, 0.05)
    for (x, y) in ((3.4, -3.6), (2.0, -3.6)):
        boxz(m, 'concrete', x, y, 0, 1.25, 0.95, 0.15)
        boxz(m, 'paint_white', x, y, 0.15, 1.05, 0.78, 1.65, bevel=0.02 if lod == 0 else 0)
        if lod == 0:
            box(m, 'steel_dark', (x, y + 0.392, 0.95), (0.98, 0.012, 1.45))
            box(m, 'paint_white', (x - 0.24, y + 0.4, 0.95), (0.5, 0.012, 1.42))
            box(m, 'paint_white', (x + 0.24, y + 0.4, 0.95), (0.44, 0.012, 1.42))
            box(m, 'paint_grey', (x, y - 0.42, 1.25), (0.6, 0.08, 0.5))  # pendingin
    if lod == 0:
        # rak kabel dari kabinet ke menara
        for (a, b) in (((2.7, -3.0, 0.9), (1.8, -2.0, 0.9)), ((1.8, -2.0, 0.9), (0.8, -1.9, 0.9))):
            bar(m, 'galv', a, b, 0.4, 0.04, (0, 0, 1))
        for p in ((2.7, -3.0), (1.8, -2.0)):
            tube(m, 'galv', (p[0], p[1], 0), (p[0], p[1], 0.9), 0.03, 5)
        sign(m, 'atlas_bts', (2.0, -3.988, 1.4), 0.8, 0.5, '-y')
    col = [dict(c=[sx * 2.75, sy * 2.75, 0.45], h=40.0) for sx, sy in CORNERS]
    col += [dict(b=[x, y, 1.1, 0.85], h=1.85) for (x, y) in ((3.4, -3.6), (2.0, -3.6))]
    return m, dict(col=col, lights=[[0, 0, zt + 4.0]])


# ---------- tiang antena di atap gedung
@model('btsr', lods=(0, 1), ao=0.8, big=True)
def m_btsr(lod):
    m = Mesh()
    H = 7.0
    tube(m, 'galv', (0, 0, 0), (0, 0, H), 0.09, 10 if lod == 0 else 6, caps=True)
    for k in range(3):
        a = k * 120 * D2R
        tube(m, 'galv', (math.sin(a) * 1.3, math.cos(a) * 1.3, 0), (math.sin(a) * 0.1, math.cos(a) * 0.1, 2.4), 0.04, 6 if lod == 0 else 4)
        boxz(m, 'concrete', math.sin(a) * 1.3, math.cos(a) * 1.3, 0, 0.5, 0.5, 0.2)
        az = k * 120
        aa = az * D2R
        cx, cy = math.sin(aa) * 0.42, math.cos(aa) * 0.42
        box(m, 'galv', (cx / 2, cy / 2, 5.3), (abs(cx) + 0.06, abs(cy) + 0.06, 0.05))
        antenna_panel(m, cx, cy, 5.6, -az, lod, h=1.5)
    dish(m, 0.55, 0.0, 3.6, 90, 0.36, lod)
    box(m, 'galv', (0.25, 0, 3.6), (0.4, 0.05, 0.05))
    m.add(bmesh_dome(0.09, 8), 'lamp_red', T(0, 0, H))
    boxz(m, 'paint_white', -1.0, -0.9, 0, 0.9, 0.6, 1.4, bevel=0.015 if lod == 0 else 0)
    return m, dict(col=[dict(c=[0, 0, 0.3], h=7.0)], lights=[[0, 0, H]])


# ---------- pos satpam
@model('guard', lods=(0, 1), ao=0.7)
def m_guard(lod):
    m = Mesh()
    W, D, H = 2.6, 2.4, 2.75
    boxz(m, 'stone', 0, 0, 0, W + 0.2, D + 0.2, 0.15)
    if lod >= 1:
        boxz(m, 'plaster', 0, 0, 0.15, W, D, 0.9)
        boxz(m, 'glass', 0, 0, 1.05, W - 0.02, D - 0.02, 1.4)
        boxz(m, 'plaster', 0, 0, 2.45, W, D, 0.3)
        boxz(m, 'paint_white', 0, 0, H, W + 0.7, D + 0.7, 0.2)
        sign(m, 'atlas_satpam', (0, D / 2 + 0.355, H + 0.1), 1.6, 0.16, '+y')
        return m, guard_meta()
    t = 0.12
    # dinding bawah (bata diplester) + list batu
    for (cx, cy, sx, sy) in ((0, D / 2 - t / 2, W, t), (0, -D / 2 + t / 2, W, t), (-W / 2 + t / 2, 0, t, D - 2 * t), (W / 2 - t / 2, 0, t, D - 2 * t)):
        boxz(m, 'plaster', cx, cy, 0.15, sx, sy, 0.9)
        boxz(m, 'stone_dark', cx + (0.012 if cx > 0.5 else -0.012 if cx < -0.5 else 0), cy + (0.012 if cy > 0.5 else -0.012 if cy < -0.5 else 0), 0.15, sx + (0.02 if sx > 1 else 0), sy + (0.02 if sy > 1 else 0), 0.26)
        boxz(m, 'paint_white', cx, cy, 1.05, sx + 0.06, sy + 0.06, 0.05)  # ambang jendela
    # dinding belakang penuh, kaca di depan & kiri, pintu di kanan
    boxz(m, 'plaster', 0, -D / 2 + t / 2, 1.1, W, t, 1.35)
    for (x0, x1) in ((-W / 2 + 0.05, -0.42), (-0.42, 0.42), (0.42, W / 2 - 0.05)):
        boxz(m, 'glass', (x0 + x1) / 2, D / 2 - 0.06, 1.1, x1 - x0 - 0.04, 0.012, 1.32)
    for x in (-W / 2 + 0.04, -0.42, 0.42, W / 2 - 0.04):
        boxz(m, 'alu', x, D / 2 - 0.06, 1.1, 0.05, 0.06, 1.35)
    boxz(m, 'alu', 0, D / 2 - 0.06, 1.75, W, 0.06, 0.04)
    for (y0, y1) in ((-D / 2 + 0.15, 0.0), (0.0, D / 2 - 0.15)):
        boxz(m, 'glass', -W / 2 + 0.06, (y0 + y1) / 2, 1.1, 0.012, y1 - y0 - 0.04, 1.32)
    for y in (-D / 2 + 0.13, 0.0, D / 2 - 0.13):
        boxz(m, 'alu', -W / 2 + 0.06, y, 1.1, 0.06, 0.05, 1.35)
    # sisi kanan: pintu aluminium + kaca atas
    boxz(m, 'plaster', W / 2 - t / 2, -0.75, 1.1, t, 0.7, 1.35)
    boxz(m, 'alu', W / 2 - 0.02, 0.35, 0.15, 0.05, 0.92, 2.15)
    boxz(m, 'glass', W / 2 - 0.005, 0.35, 1.2, 0.012, 0.7, 0.95)
    boxz(m, 'chrome', W / 2 + 0.03, 0.0, 1.05, 0.03, 0.12, 0.03)
    boxz(m, 'plaster', W / 2 - t / 2, 0.35, 2.3, t, 0.95, 0.15)
    # lintel & atap pelat
    boxz(m, 'plaster', 0, 0, 2.45, W + 0.02, D + 0.02, 0.3)
    boxz(m, 'paint_white', 0, 0, H, W + 0.7, D + 0.7, 0.2, bevel=0.01)
    boxz(m, 'paint_blue', 0, 0, H + 0.2, W + 0.72, D + 0.72, 0.05)
    sign(m, 'atlas_satpam', (0, D / 2 + 0.353, H + 0.1), 1.6, 0.15, '+y')
    # lampu dinding, AC luar, meja di balik kaca
    box(m, 'housing', (0.95, D / 2 + 0.04, 2.25), (0.14, 0.08, 0.1))
    box(m, 'led', (0.95, D / 2 + 0.08, 2.22), (0.1, 0.01, 0.05))
    boxz(m, 'paint_white', -0.5, -D / 2 - 0.16, 1.7, 0.72, 0.26, 0.5, bevel=0.015)
    boxz(m, 'wood_dark', 0.0, D / 2 - 0.45, 0.15, 1.6, 0.55, 0.78)
    return m, guard_meta()


def guard_meta():
    return dict(col=[dict(b=[0, 0, 2.8, 2.6], h=2.95, floor=1)], lights=[[0.95, 1.3, 2.22]])


# ---------- palang pintu (lengan terangkat)
@model('boom', lods=(0,), ao=0.5)
def m_boom(lod):
    m = Mesh()
    boxz(m, 'concrete', 0, 0, 0, 0.5, 0.5, 0.08)
    boxz(m, 'paint_yellow', 0, 0, 0.08, 0.32, 0.32, 0.9, bevel=0.02 if lod == 0 else 0)
    if lod == 0:
        for z in (0.2, 0.42, 0.64):
            box(m, 'paint_black', (0, 0, z), (0.325, 0.325, 0.09))
        cyl(m, 'paint_yellow', 0, 0, 0.98, 0.17, 0.12, 0.08, 12)
        tube(m, 'steel_dark', (0.0, 0.16, 0.86), (0.0, 0.3, 0.86), 0.075, 10, caps=True)
        box(m, 'led', (0.0, 0.166, 0.72), (0.12, 0.01, 0.06))
    # lengan 5,2 m terangkat 84° ke arah depan (+Y), garis merah-putih
    ang = 84 * D2R
    p0 = Vector((0, 0.32, 0.86))
    d = Vector((0, math.cos(ang), math.sin(ang)))
    L = 5.2
    n = 10 if lod == 0 else 2
    for k in range(n):
        a, b = p0 + d * (L * k / n), p0 + d * (L * (k + 1) / n)
        bar(m, 'paint_red' if k % 2 == 0 else 'paint_white', a, b, 0.1 if lod == 0 else 0.11, 0.05, (0, -math.sin(ang), math.cos(ang)))
    return m, dict(col=[dict(b=[0, 0, 0.38, 0.38], h=1.0)])


# ---------- pilar gerbang cluster (bata diplester, lampu bola)
@model('pillar', lods=(0,), ao=0.6)
def m_pillar(lod):
    m = Mesh()
    boxz(m, 'stone', 0, 0, 0, 0.72, 0.72, 0.55, bevel=0.01 if lod == 0 else 0)
    boxz(m, 'paint_cream', 0, 0, 0.55, 0.6, 0.6, 1.7)
    if lod == 0:
        for z in (0.9, 1.35, 1.8):
            boxz(m, 'paint_cream', 0, 0, z, 0.62, 0.62, 0.035)
    boxz(m, 'stone', 0, 0, 2.25, 0.78, 0.78, 0.12, bevel=0.015 if lod == 0 else 0)
    boxz(m, 'stone', 0, 0, 2.37, 0.5, 0.5, 0.1)
    cyl(m, 'steel_dark', 0, 0, 2.47, 0.06, 0.05, 0.15, 8)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12 if lod == 0 else 6, v_segments=8 if lod == 0 else 4, radius=0.15)
    m.add(bm, 'led', T(0, 0, 2.75), True)
    return m, dict(col=[dict(b=[0, 0, 0.72, 0.72], h=2.5)], lights=[[0, 0, 2.75]])


# ---------- papan nama cluster
@model('namesign', lods=(0,), ao=0.6)
def m_namesign(lod):
    m = Mesh()
    boxz(m, 'stone', 0, 0, 0, 4.4, 0.9, 0.22, bevel=0.01 if lod == 0 else 0)
    boxz(m, 'stone_dark', 0, -0.05, 0.22, 4.0, 0.5, 1.15, bevel=0.01 if lod == 0 else 0)
    boxz(m, 'alu', 0, -0.05, 1.37, 4.1, 0.58, 0.05)
    sign(m, 'atlas_name', (0, 0.205, 0.81), 3.6, 0.86, '+y')
    for s in (1, -1):
        boxz(m, 'concrete', s * 2.45, 0.05, 0, 0.6, 0.85, 0.5)
        boxz(m, 'soil', s * 2.45, 0.05, 0.5, 0.5, 0.75, 0.02)
        if lod == 0:  # lampu sorot kecil
            box(m, 'housing', (s * 1.4, 0.48, 0.28), (0.12, 0.1, 0.1))
            box(m, 'led', (s * 1.4, 0.43, 0.33), (0.08, 0.02, 0.06))
    return m, dict(col=[dict(b=[0, 0, 4.4, 0.9], h=1.4)])


# ---------- halte bus Sutera Loop
@model('halte', lods=(0, 1), ao=0.9)
def m_halte(lod):
    m = Mesh()
    W, D = 4.6, 1.9
    boxz(m, 'concrete', 0, 0, 0, W + 0.3, D + 0.2, 0.12)
    post = [(-2.15, -0.82), (2.15, -0.82), (-2.15, 0.78), (2.15, 0.78)]
    for (x, y) in post:
        boxz(m, 'steel_dark', x, y, 0.12, 0.09, 0.09, 2.5 if y < 0 else 2.58)
    # atap lengkung polikarbonat + balok tepi
    prof = [(-1.1 + 2.2 * k / 8, 2.62 + 0.13 * math.cos(pi * (-1.1 + 2.2 * k / 8) / 2.2) - 0.03 * (k / 8)) for k in range(9)]
    if lod >= 1:
        prof = [prof[0], prof[4], prof[8]]
    for side, dz in ((1, 0.0), (-1, -0.02)):
        bm = bmesh.new()
        rows = [[bm.verts.new((x, y, z + dz)) for (y, z) in prof] for x in (-2.45, 2.45)]
        for k in range(len(prof) - 1):
            f = bm.faces.new((rows[0][k], rows[1][k], rows[1][k + 1], rows[0][k + 1]) if side > 0 else (rows[0][k], rows[0][k + 1], rows[1][k + 1], rows[1][k]))
        m.add(bm, 'poly', None, True)
    for y in (-1.1, 1.1):
        z = prof[0][1] if y < 0 else prof[-1][1]
        box(m, 'steel_dark', (0, y, z - 0.04), (4.95, 0.07, 0.12))
    for x in (-2.45, 2.45, -0.8, 0.8):
        if lod >= 1 and abs(x) < 1:
            continue
        pts = [(x, y, z - 0.035) for (y, z) in prof]
        for a, b in zip(pts, pts[1:]):
            bar(m, 'steel_dark', a, b, 0.05, 0.05)
    # dinding belakang: kaca + kotak iklan bercahaya
    boxz(m, 'glass_clear', -1.12, -0.86, 0.32, 2.0, 0.014, 1.86)
    boxz(m, 'glass_clear', 1.78, -0.86, 0.32, 0.68, 0.014, 1.86)
    boxz(m, 'steel_dark', 0.72, -0.86, 0.25, 1.36, 0.16, 2.0)
    sign(m, 'atlas_ad', (0.72, -0.778, 1.26), 1.2, 1.72, '+y')
    sign(m, 'atlas_ad', (0.72, -0.942, 1.26), 1.2, 1.72, '-y')
    boxz(m, 'glass_clear', 2.15, -0.05, 0.32, 0.014, 1.45, 1.86)
    for (x, y, sx, sy) in ((-1.12, -0.86, 2.0, 0.03), (2.15, -0.05, 0.03, 1.45)):
        boxz(m, 'steel_dark', x, y, 0.3, sx + 0.02, sy + 0.02, 0.03)
        boxz(m, 'steel_dark', x, y, 2.18, sx + 0.02, sy + 0.02, 0.03)
    # bangku logam berlubang
    boxz(m, 'alu', -0.55, -0.55, 0.44, 3.0, 0.42, 0.04)
    for x in (-1.9, -0.55, 0.8):
        boxz(m, 'steel_dark', x, -0.62, 0.12, 0.06, 0.3, 0.32)
    # totem rute Sutera Loop
    boxz(m, 'steel_dark', -2.3, 0.86, 0.12, 0.1, 0.1, 2.25)
    boxz(m, 'steel_dark', -2.3, 0.86, 1.6, 0.56, 0.08, 0.72)
    sign(m, 'atlas_loop', (-2.3, 0.902, 1.96), 0.52, 0.68, '+y')
    sign(m, 'atlas_loop', (-2.3, 0.818, 1.96), 0.52, 0.68, '-y')
    # tempat sampah
    cyl(m, 'steel', 1.85, 0.55, 0.12, 0.19, 0.19, 0.66, 12 if lod == 0 else 6)
    cyl(m, 'steel_dark', 1.85, 0.55, 0.78, 0.2, 0.15, 0.06, 12 if lod == 0 else 6)
    col = [dict(b=[-0.4, -0.86, 3.6, 0.16], h=2.2), dict(b=[2.15, -0.05, 0.12, 1.45], h=2.2), dict(b=[-0.55, -0.55, 3.0, 0.45], h=0.48),
           dict(c=[-2.15, 0.78, 0.07], h=2.6), dict(c=[2.15, 0.78, 0.07], h=2.6), dict(b=[0, 0, 4.9, 2.2], z0=2.5, h=2.76, floor=1)]
    return m, dict(col=col)


# ---------- lampu lalu lintas berlengan (pendek 4,2 m / panjang 6,8 m)
def signal_head(m, x, y, z, lod, face='+x', size=1.0):
    """Kepala 3 lampu (merah atas) menghadap +X, tergantung dengan titik atas (x, y, z)."""
    w, d, h = 0.34 * size, 0.26 * size, 1.0 * size
    boxz(m, 'paint_black', x, y, z - h, d, w, h, bevel=0.015 if lod == 0 else 0)
    boxz(m, 'paint_black', x - d / 2 - 0.02, y, z - h - 0.12, 0.012, w + 0.36, h + 0.24)  # pelat latar
    if lod == 0:
        for s in (1, -1):
            boxz(m, 'paint_yellow', x - d / 2 - 0.012, y + s * (w / 2 + 0.165), z - h - 0.12, 0.006, 0.03, h + 0.24)
        for zz in (z - h - 0.12 + 0.015, z + 0.12 - 0.015):
            box(m, 'paint_yellow', (x - d / 2 - 0.012, y, zz), (0.006, w + 0.36, 0.03))
    for k, mat in enumerate(('sig_r', 'sig_y', 'sig_g')):
        zz = z - h * (0.18 + 0.32 * k)
        if lod == 0:
            cyl(m, mat, 0, 0, 0, 0.11 * size, 0.11 * size, 0.02, 14, M=T(x + d / 2, y, zz) @ Ry(90))
            # tudung (visor) setengah silinder
            arc = [pi * i / 6 for i in range(7)]
            for back in (False, True):  # tudung tipis dua sisi
                bm = bmesh.new()
                ring0 = [bm.verts.new((x + d / 2, y + math.cos(a) * 0.13 * size, zz + math.sin(a) * 0.13 * size)) for a in arc]
                ring1 = [bm.verts.new((x + d / 2 + 0.2, y + math.cos(a) * 0.13 * size, zz + math.sin(a) * 0.13 * size)) for a in arc]
                for i in range(6):
                    bm.faces.new((ring1[i], ring1[i + 1], ring0[i + 1], ring0[i]) if back else (ring0[i], ring0[i + 1], ring1[i + 1], ring1[i]))
                m.add(bm, 'paint_black', None, True)
        else:
            box(m, mat, (x + d / 2, y, zz), (0.02, 0.22, 0.22))


def signal_model(L, lod):
    m = Mesh()
    H = 6.3
    cyl(m, 'concrete', 0, 0, 0, 0.32, 0.3, 0.15, 10 if lod == 0 else 6)
    if lod == 0:
        box(m, 'galv', (0, 0, 0.165), (0.42, 0.42, 0.03))
    cyl(m, 'galv', 0, 0, 0.15, 0.13, 0.095, H - 0.15, 8 if lod == 0 else 6, caps=False, smooth=False)
    cyl(m, 'galv', 0, 0, H, 0.1, 0.06, 0.12, 8)
    za = 5.85
    tube(m, 'galv', (0, 0.05, za), (0, L, za + 0.28), 0.085, 8 if lod == 0 else 5, r2=0.055, smooth=True)
    if lod == 0:
        tube(m, 'galv', (0, 0.0, H - 0.05), (0, L * 0.62, za + 0.2), 0.022, 5)
        box(m, 'galv', (0, 0.12, za), (0.24, 0.12, 0.32))
    for t in (0.55, 0.95) if L > 5 else (0.88,):
        y = L * t
        z = za + 0.28 * t - 0.08
        box(m, 'galv', (0, y, z + 0.02), (0.06, 0.06, 0.14))
        signal_head(m, 0.0, y, z - 0.05, lod)
    # kepala di tiang + penghitung mundur + lampu penyeberang
    signal_head(m, 0.22, 0, 3.75, lod, size=0.9)
    box(m, 'galv', (0.12, 0, 3.55), (0.14, 0.08, 0.08))
    boxz(m, 'paint_black', 0.24, -0.5, 2.85, 0.16, 0.48, 0.48)
    sign(m, 'atlas_timer', (0.322, -0.5, 3.09), 0.44, 0.38, '+x')
    box(m, 'galv', (0.12, -0.28, 3.05), (0.14, 0.12, 0.06))
    boxz(m, 'paint_black', -0.2, 0, 2.15, 0.22, 0.3, 0.62)
    if lod == 0:
        box(m, 'sig_r', (-0.312, 0, 2.62), (0.01, 0.2, 0.2))
        box(m, 'sig_g', (-0.312, 0, 2.32), (0.01, 0.2, 0.2))
        boxz(m, 'paint_yellow', 0.0, -0.14, 1.05, 0.12, 0.1, 0.18)  # tombol penyeberang
    return m, dict(col=[dict(c=[0, 0, 0.16], h=6.3)])


@model('signal', lods=(0, 1), ao=0.6)
def m_signal(lod):
    return signal_model(4.2, lod)


@model('signal_l', lods=(0, 1), ao=0.6)
def m_signal_l(lod):
    return signal_model(6.8, lod)


# ---------- papan reklame tiang tunggal (muka 10 × 5 m, dua sisi)
@model('board', lods=(0, 1), ao=1.2, big=True)
def m_board(lod):
    m = Mesh()
    boxz(m, 'concrete', 0, 0, 0, 1.7, 1.7, 0.35)
    if lod == 0:
        boxz(m, 'steel', 0, 0, 0.35, 1.15, 1.15, 0.04)
        for k in range(8):
            a = k / 8 * 2 * pi
            box(m, 'steel', (math.cos(a) * 0.5, math.sin(a) * 0.5, 0.55), (0.25 if abs(math.cos(a)) > 0.7 else 0.03, 0.03 if abs(math.cos(a)) > 0.7 else 0.25, 0.35))
    cyl(m, 'steel', 0, 0, 0.35, 0.44, 0.38, 12.3, 16 if lod == 0 else 8, caps=False)
    zb, zt = 12.75, 17.75
    # rangka kepala
    if lod == 0:
        for z in (12.6, zt + 0.12):
            for y in (0.45, -0.45):
                box(m, 'steel_dark', (0, y, z), (10.3, 0.12, 0.12))
        for x in [(-5.1 + 10.2 * k / 6) for k in range(7)]:
            for y in (0.45, -0.45):
                box(m, 'steel_dark', (x, y, (zb + zt) / 2), (0.1, 0.1, zt - zb + 0.4))
        box(m, 'steel_dark', (0, 0, 12.55), (1.4, 1.0, 0.3))
    else:
        boxz(m, 'steel_dark', 0, 0, 12.5, 10.3, 0.95, 5.5)
    # muka iklan (dua sisi) + bingkai
    for s in (1, -1):
        y = s * 0.53
        sign(m, 'atlas_ad', (0, y, (zb + zt) / 2), 10.0, zt - zb, '+y' if s > 0 else '-y')
        if lod == 0:
            for (cx, cz, sx, sz) in ((0, zb - 0.06, 10.25, 0.12), (0, zt + 0.06, 10.25, 0.12), (-5.06, (zb + zt) / 2, 0.12, 5.2), (5.06, (zb + zt) / 2, 0.12, 5.2)):
                box(m, 'paint_white', (cx, y, cz), (sx, 0.08, sz))
            # catwalk + pagar + lampu sorot
            box(m, 'grate', (0, s * 1.05, zb - 0.3), (10.2, 0.85, 0.05))
            for x in [(-5 + 10 * k / 5) for k in range(6)]:
                tube(m, 'steel_dark', (x, s * 1.45, zb - 0.3), (x, s * 1.45, zb + 0.75), 0.022, 5)
            bar(m, 'steel_dark', (-5, s * 1.45, zb + 0.75), (5, s * 1.45, zb + 0.75), 0.04, 0.04)
            for x in (-3.3, 0, 3.3):
                bar(m, 'steel_dark', (x, s * 0.55, zt + 0.15), (x, s * 1.55, zt + 0.35), 0.05, 0.05)
                box(m, 'housing', (x, s * 1.6, zt + 0.25), (0.45, 0.3, 0.16), M=None)
                box(m, 'led', (x, s * 1.55, zt + 0.16), (0.36, 0.2, 0.01))
        else:
            box(m, 'grate', (0, s * 1.0, zb - 0.3), (10.2, 0.8, 0.06))
    return m, dict(col=[dict(c=[0, 0, 0.5], h=12.6), dict(b=[0, 0, 1.7, 1.7], h=0.35), dict(b=[0, 0, 10.4, 1.3], z0=12.4, h=18.0)])


# ---------- videotron (layar LED 6,4 × 3,6 m)
@model('video', lods=(0,), ao=1.0, big=True)
def m_video(lod):
    m = Mesh()
    for s in (1, -1):
        boxz(m, 'concrete', s * 2.4, -0.1, 0, 0.8, 0.8, 0.3)
        boxz(m, 'steel_dark', s * 2.4, -0.1, 0.3, 0.36, 0.36, 5.9)
    boxz(m, 'steel_dark', 0, -0.12, 5.9, 6.9, 0.55, 4.05, bevel=0.03 if lod == 0 else 0)
    sign(m, 'screen', (0, 0.158, 7.92), 6.4, 3.6, '+y')
    if lod == 0:
        boxz(m, 'paint_black', 0, 0.14, 6.0, 6.7, 0.03, 0.1)
        boxz(m, 'paint_black', 0, 0.14, 9.78, 6.7, 0.03, 0.1)
        for x in [(-3 + 6 * k / 6) for k in range(7)]:  # kisi ventilasi belakang
            box(m, 'grate', (x, -0.4, 7.9), (0.5, 0.02, 3.4))
        boxz(m, 'steel_dark', 0, -0.12, 9.95, 7.0, 0.62, 0.08)
        boxz(m, 'paint_black', 0, 0.0, 5.35, 1.8, 0.12, 0.42)
        sign(m, 'atlas_media', (0, 0.062, 5.56), 1.7, 0.36, '+y')
    return m, dict(col=[dict(b=[2.4, -0.1, 0.8, 0.8], h=6.0), dict(b=[-2.4, -0.1, 0.8, 0.8], h=6.0), dict(b=[0, -0.12, 6.9, 0.6], z0=5.9, h=9.95)])


# ---------- tiang harga & merek SPBU fiktif
@model('fuelsign', lods=(0,), ao=0.8)
def m_fuelsign(lod):
    m = Mesh()
    boxz(m, 'concrete', 0, 0, 0, 0.9, 2.3, 0.35)
    boxz(m, 'paint_white', 0, 0, 0.35, 0.5, 1.9, 7.3, bevel=0.03 if lod == 0 else 0)
    boxz(m, 'paint_purple', 0, 0, 5.75, 0.56, 2.0, 1.75, bevel=0.03 if lod == 0 else 0)
    boxz(m, 'paint_gold', 0, 0, 7.5, 0.6, 2.05, 0.18)
    for s in (1, -1):
        x = s * 0.285
        sign(m, 'atlas_fuel', (x, 0, 6.62), 1.75, 1.5, '+x' if s > 0 else '-x')
        sign(m, 'atlas_price', (x - s * 0.03, 0, 4.25), 1.6, 2.6, '+x' if s > 0 else '-x')
    return m, dict(col=[dict(b=[0, 0, 0.6, 2.0], h=7.7)])


# ---------- pulau pompa bensin (2 dispenser)
@model('pump', lods=(0, 1), ao=0.6)
def m_pump(lod):
    m = Mesh()
    pts = rrect(0, 0, 4.4, 1.25, 0.5, 4 if lod == 0 else 1)
    loft(m, 'concrete', [[(x, y, 0) for x, y in pts], [(x, y, 0.22) for x, y in pts]], cap0=False, cap1=True)
    if lod == 0:
        for s in (1, -1):
            for k in range(3):
                box(m, 'paint_yellow' if k % 2 == 0 else 'paint_black', (s * (2.0 - k * 0.12), 0, 0.11), (0.12, 1.26, 0.225))
    for s in (1, -1):
        x = s * 1.1
        boxz(m, 'steel_dark', x, 0, 0.22, 1.0, 0.52, 0.2)
        boxz(m, 'paint_white', x, 0, 0.42, 0.92, 0.46, 1.25, bevel=0.02 if lod == 0 else 0)
        boxz(m, 'paint_purple', x, 0, 1.67, 0.96, 0.5, 0.32, bevel=0.02 if lod == 0 else 0)
        boxz(m, 'paint_gold', x, 0, 1.99, 0.96, 0.5, 0.04)
        for f in (1, -1):
            sign(m, 'atlas_pump', (x, f * 0.232, 1.275), 0.6, 0.45, '+y' if f > 0 else '-y')
            if lod == 0:
                for k, dx in enumerate((-0.28, 0.0, 0.28)):
                    box(m, 'paint_black', (x + dx, f * 0.25, 0.85), (0.08, 0.06, 0.14))
                    box(m, ('plastic_green', 'plastic_yellow', 'paint_black')[k], (x + dx, f * 0.29, 0.86), (0.045, 0.05, 0.11))
                    path_tube(m, 'rubber', [(x + dx, f * 0.24, 1.66), (x + dx, f * 0.42, 1.4), (x + dx, f * 0.46, 1.0), (x + dx, f * 0.33, 0.8)], 0.016, 5)
    for s in (1, -1):
        cyl(m, 'paint_yellow', s * 2.1, 0, 0.22, 0.075, 0.075, 0.85, 10 if lod == 0 else 6)
        if lod == 0:
            for z in (0.45, 0.75):
                cyl(m, 'paint_black', s * 2.1, 0, z, 0.077, 0.077, 0.08, 10)
    if lod == 0:
        cyl(m, 'plastic_red', 0.0, 0.3, 0.22, 0.09, 0.09, 0.5, 10)
        cyl(m, 'paint_black', 0.0, 0.3, 0.72, 0.04, 0.03, 0.08, 8)
    col = [dict(b=[0, 0, 4.4, 1.25], h=0.22, floor=1)] + [dict(b=[s * 1.1, 0, 1.0, 0.52], h=2.0) for s in (1, -1)]
    return m, dict(col=col)


# ---------- gawang (futsal 3 × 2 m, sepak bola 7,32 × 2,44 m)
def goal_model(Wd, Hh, Dp, lod):
    m = Mesh()
    r = 0.045 if Wd < 5 else 0.06
    sg = 8 if lod == 0 else 5
    hw = Wd / 2
    for s in (1, -1):
        tube(m, 'paint_white', (s * hw, 0, 0), (s * hw, 0, Hh), r, sg)
        tube(m, 'paint_white', (s * hw, 0, 0), (s * hw, -Dp, 0), r * 0.6, sg)
        tube(m, 'paint_white', (s * hw, 0, Hh), (s * hw, -Dp * 0.45, Hh), r * 0.6, sg)
        tube(m, 'paint_white', (s * hw, -Dp * 0.45, Hh), (s * hw, -Dp, 0), r * 0.6, sg)
    tube(m, 'paint_white', (-hw, 0, Hh), (hw, 0, Hh), r, sg)
    tube(m, 'paint_white', (-hw, -Dp, 0), (hw, -Dp, 0), r * 0.6, sg)
    tube(m, 'paint_white', (-hw, -Dp * 0.45, Hh), (hw, -Dp * 0.45, Hh), r * 0.6, sg)
    uv = net_uv()
    # jaring: atap, belakang (miring), dua sisi
    for pts in ([(-hw, 0, Hh), (hw, 0, Hh), (hw, -Dp * 0.45, Hh), (-hw, -Dp * 0.45, Hh)],
                [(-hw, -Dp * 0.45, Hh), (hw, -Dp * 0.45, Hh), (hw, -Dp, 0), (-hw, -Dp, 0)]):
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        m.add(bm, 'net', None, False, uv)
    for s in (1, -1):
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new(p) for p in [(s * hw, 0, 0), (s * hw, -Dp, 0), (s * hw, -Dp * 0.45, Hh), (s * hw, 0, Hh)]])
        m.add(bm, 'net', None, False, uv)
    return m, dict(col=[dict(c=[hw, 0, r * 1.5], h=Hh), dict(c=[-hw, 0, r * 1.5], h=Hh)])


@model('goal', lods=(0,), ao=0.4)
def m_goal(lod):
    return goal_model(3.0, 2.0, 1.0, lod)


@model('goal_l', lods=(0,), ao=0.6)
def m_goal_l(lod):
    return goal_model(7.32, 2.44, 2.0, lod)


# ---------- ring basket
@model('hoop', lods=(0,), ao=0.5)
def m_hoop(lod):
    m = Mesh()
    sg = 10 if lod == 0 else 6
    cyl(m, 'concrete', 0, -1.45, 0, 0.3, 0.3, 0.1, 8)
    tube(m, 'paint_blue', (0, -1.45, 0.05), (0, -1.45, 3.35), 0.085, sg, caps=True)
    path_tube(m, 'paint_blue', [(0, -1.45, 3.3), (0, -1.2, 3.42), (0, -0.4, 3.42), (0, -0.12, 3.42)], 0.05, sg if lod == 0 else 4)
    tube(m, 'paint_blue', (0, -1.45, 2.6), (0, -0.4, 3.1), 0.04, 6)
    box(m, 'paint_white', (0, -0.04, 3.42), (1.8, 0.04, 1.05), bevel=0.01 if lod == 0 else 0)
    if lod == 0:
        for (cx, cz, sx, sz) in ((0, 3.22, 0.6, 0.05), (0, 3.66, 0.6, 0.05), (-0.275, 3.44, 0.05, 0.47), (0.275, 3.44, 0.05, 0.47),
                                 (0, 2.92, 1.8, 0.05), (0, 3.92, 1.8, 0.05), (-0.875, 3.42, 0.05, 1.05), (0.875, 3.42, 0.05, 1.05)):
            box(m, 'paint_red', (cx, -0.018, cz), (sx, 0.006, sz))
    rim_r = 0.23
    bm = bmesh.new()
    segs, rs = (16, 5) if lod == 0 else (8, 3)
    grid = []
    for i in range(segs):
        a = 2 * pi * i / segs
        row = []
        for k in range(rs):
            b = 2 * pi * k / rs
            rr = rim_r + 0.011 * math.cos(b)
            row.append(bm.verts.new((rr * math.cos(a), 0.29 + rr * math.sin(a), 3.05 + 0.011 * math.sin(b))))
        grid.append(row)
    for i in range(segs):
        A, B = grid[i], grid[(i + 1) % segs]
        for k in range(rs):
            k2 = (k + 1) % rs
            bm.faces.new((A[k], B[k], B[k2], A[k2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m.add(bm, 'paint_orange', None, True)
    box(m, 'paint_orange', (0, 0.03, 3.05), (0.16, 0.1, 0.04))
    # jaring kerucut
    bm = bmesh.new()
    n = 12 if lod == 0 else 6
    top = [bm.verts.new((rim_r * math.cos(2 * pi * i / n), 0.29 + rim_r * math.sin(2 * pi * i / n), 3.04)) for i in range(n)]
    bot = [bm.verts.new((0.14 * math.cos(2 * pi * i / n), 0.29 + 0.14 * math.sin(2 * pi * i / n), 2.62)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    def uvn(face, loop, co):
        a = math.atan2(co.y - 0.29, co.x)
        return (a / (2 * pi) * 12, co.z / 0.08)
    m.add(bm, 'net', None, False, uvn)
    return m, dict(col=[dict(c=[0, -1.45, 0.12], h=3.4)])


# ---------- net tenis/bulu tangkis/voli (lebar 12,8 m, diskala per lapangan)
@model('net', lods=(0,), ao=0.3)
def m_net(lod):
    m = Mesh()
    for s in (1, -1):
        tube(m, 'paint_green', (s * 6.4, 0, 0), (s * 6.4, 0, 1.07), 0.04, 8 if lod == 0 else 5, caps=True)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in [(-6.4, 0, 0.04), (6.4, 0, 0.04), (6.4, 0, 0.96), (-6.4, 0, 0.96)]])
    m.add(bm, 'net', None, False, net_uv(0.05))
    box(m, 'paint_white', (0, 0, 0.98), (12.8, 0.012, 0.06))
    return m, dict(col=[])


# ---------- bangku taman
@model('bench', lods=(0,), ao=0.4)
def m_bench(lod):
    m = Mesh()
    if lod >= 1:
        boxz(m, 'wood', 0, 0.02, 0.42, 1.8, 0.45, 0.06)
        box(m, 'wood', (0, -0.24, 0.7), (1.8, 0.05, 0.36), M=None)
        for s in (1, -1):
            boxz(m, 'steel_dark', s * 0.78, 0, 0, 0.06, 0.55, 0.62)
        return m, bench_meta()
    for s in (1, -1):
        x = s * 0.8
        bar(m, 'steel_dark', (x, 0.22, 0), (x, 0.2, 0.42), 0.06, 0.035, (0, 1, 0))
        bar(m, 'steel_dark', (x, -0.2, 0), (x, -0.22, 0.42), 0.06, 0.035, (0, 1, 0))
        bar(m, 'steel_dark', (x, 0.24, 0.42), (x, -0.24, 0.42), 0.06, 0.035, (0, 0, 1))
        bar(m, 'steel_dark', (x, -0.22, 0.42), (x, -0.3, 0.88), 0.05, 0.035, (0, 1, 0))
        bar(m, 'steel_dark', (x, 0.2, 0.42), (x, 0.2, 0.62), 0.04, 0.03, (0, 1, 0))
        bar(m, 'steel_dark', (x, 0.24, 0.63), (x, -0.25, 0.63), 0.05, 0.03, (0, 0, 1))
    for k in range(4):
        y = 0.18 - k * 0.12
        box(m, 'wood', (0, y, 0.455), (1.84, 0.095, 0.035), bevel=0.006)
    for k in range(3):
        t = 0.2 + k * 0.28
        y = -0.24 - 0.06 * t
        z = 0.52 + 0.33 * t
        box(m, 'wood', (0, y, z), (1.84, 0.03, 0.09), bevel=0.006, M=None)
    return m, bench_meta()


def bench_meta():
    return dict(col=[dict(b=[0, -0.02, 1.8, 0.6], h=0.85)])


# ---------- tempat sampah ganda (organik / anorganik)
@model('bin', lods=(0,), ao=0.4)
def m_bin(lod):
    m = Mesh()
    sg = 14 if lod == 0 else 6
    tube(m, 'steel_dark', (0, -0.05, 0), (0, -0.05, 1.0), 0.035, 8, caps=True)
    box(m, 'steel_dark', (0, -0.05, 0.75), (0.95, 0.04, 0.04))
    for s, mat, lab in ((1, 'plastic_green', 'atlas_bin_o'), (-1, 'plastic_yellow', 'atlas_bin_a')):
        x = s * 0.25
        cyl(m, mat, x, 0.12, 0.28, 0.17, 0.2, 0.55, sg)
        lathe(m, mat, [(0.205, 0.83), (0.2, 0.86), (0.12, 0.9), (0.0, 0.91)], sg, M=T(x, 0.12, 0))
        if lod == 0:
            box(m, 'steel_dark', (x, 0.12, 0.84), (0.1, 0.42, 0.02))
            sign(m, lab, (x, 0.318, 0.61), 0.24, 0.18, '+y')
            box(m, 'paint_black', (x, 0.27, 0.78), (0.18, 0.06, 0.02))
    return m, dict(col=[dict(b=[0, 0.05, 0.95, 0.45], h=0.92)])


# ---------- hidran pilar
@model('hydrant', lods=(0,), ao=0.3)
def m_hydrant(lod):
    m = Mesh()
    sg = 14 if lod == 0 else 6
    cyl(m, 'paint_red', 0, 0, 0, 0.17, 0.16, 0.06, sg)
    cyl(m, 'paint_red', 0, 0, 0.06, 0.12, 0.11, 0.58, sg, caps=False)
    lathe(m, 'paint_red', [(0.135, 0.62), (0.135, 0.66), (0.11, 0.7), (0.07, 0.75), (0.0, 0.77)], sg)
    cyl(m, 'paint_yellow', 0, 0, 0.75, 0.03, 0.028, 0.06, 6, smooth=False)
    if lod == 0:
        for (d, r) in (((1, 0, 0), 0.045), ((-1, 0, 0), 0.045), ((0, 1, 0), 0.06)):
            a = Vector((0, 0, 0.42)) + Vector(d) * 0.1
            b = a + Vector(d) * 0.1
            tube(m, 'paint_red', a, b, r, 10, caps=False)
            tube(m, 'paint_yellow', b, b + Vector(d) * 0.035, r + 0.012, 6, caps=True, smooth=False)
        for k in range(6):
            a = k / 6 * 2 * pi
            cyl(m, 'paint_red', math.cos(a) * 0.145, math.sin(a) * 0.145, 0.055, 0.012, 0.012, 0.02, 6, smooth=False)
    return m, dict(col=[dict(c=[0, 0, 0.15], h=0.8)])


# ---------- gazebo taman (atap genteng limas)
@model('gazebo', lods=(0,), ao=1.0)
def m_gazebo(lod):
    m = Mesh()
    S_ = 4.0
    boxz(m, 'stone', 0, 0, 0, S_, S_, 0.4)
    boxz(m, 'wood', 0, 0, 0.4, S_ - 0.1, S_ - 0.1, 0.05)
    for k in range(2):
        boxz(m, 'stone', 0, S_ / 2 + 0.2 + k * 0.3, 0, 1.4, 0.3, 0.27 - k * 0.135)
    for (sx, sy) in CORNERS:
        boxz(m, 'wood_dark', sx * (S_ / 2 - 0.15), sy * (S_ / 2 - 0.15), 0.45, 0.16, 0.16, 2.3)
    # pagar rendah + bangku di 3 sisi (depan terbuka)
    for (c1, c2, n) in FACES:
        if n == (0, 1):
            continue
        a = Vector((c1[0] * (S_ / 2 - 0.15), c1[1] * (S_ / 2 - 0.15), 0.9))
        b = Vector((c2[0] * (S_ / 2 - 0.15), c2[1] * (S_ / 2 - 0.15), 0.9))
        bar(m, 'wood_dark', a, b, 0.1, 0.06)
        if lod == 0:
            for t in (0.25, 0.5, 0.75):
                p = a + (b - a) * t
                box(m, 'wood_dark', (p.x, p.y, 0.68), (0.06, 0.06, 0.45))
        nn = Vector((n[0], n[1], 0))
        ia, ib = a - nn * 0.3, b - nn * 0.3
        bar(m, 'wood', Vector((ia.x, ia.y, 0.83)), Vector((ib.x, ib.y, 0.83)), 0.4, 0.05)
    # atap limas genteng
    eave, peak = 2.75, 4.4
    R_ = S_ / 2 + 0.55
    corners = [Vector((sx * R_, sy * R_, eave)) for (sx, sy) in CORNERS]
    top = Vector((0, 0, peak))
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    vt = bm.verts.new(top)
    for i in range(4):
        bm.faces.new((vs[(i + 1) % 4], vs[i], vt))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    m.add(bm, 'tile_roof', None, False)
    bm = bmesh.new()
    vs = [bm.verts.new(c + Vector((0, 0, -0.06))) for c in corners]
    vt = bm.verts.new(top + Vector((0, 0, -0.06)))
    for i in range(4):
        bm.faces.new((vs[i], vs[(i + 1) % 4], vt))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z > 0:
            f.normal_flip()
    m.add(bm, 'wood', None, False)
    for i in range(4):
        bar(m, 'wood_dark', corners[i] + Vector((0, 0, -0.08)), corners[(i + 1) % 4] + Vector((0, 0, -0.08)), 0.18, 0.05)
        if lod == 0:
            bar(m, 'tile_roof', corners[i] + Vector((0, 0, 0.02)), top + Vector((0, 0, 0.04)), 0.12, 0.1)
    cyl(m, 'tile_roof', 0, 0, peak - 0.05, 0.12, 0.03, 0.4, 8)
    col = [dict(b=[0, 0, S_, S_], h=0.45, floor=1)] + [dict(c=[sx * (S_ / 2 - 0.15), sy * (S_ / 2 - 0.15), 0.1], h=2.8) for sx, sy in CORNERS]
    col.append(dict(b=[0, 0, S_ + 1.1, S_ + 1.1], z0=2.7, h=4.4))
    return m, dict(col=col)


# ---------- taman bermain (menara perosotan + ayunan)
@model('playset', lods=(0,), ao=0.8)
def m_playset(lod):
    m = Mesh()
    sg = 8 if lod == 0 else 5
    x0 = -1.6
    for (sx, sy) in CORNERS:
        tube(m, 'paint_yellow', (x0 + sx * 0.6, sy * 0.6, 0), (x0 + sx * 0.6, sy * 0.6, 2.5), 0.05, sg, caps=True)
    boxz(m, 'plastic_blue', x0, 0, 1.25, 1.3, 1.3, 0.06)
    for (c1, c2, n) in FACES:
        if n == (1, 0):
            continue
        a = Vector((x0 + c1[0] * 0.6, c1[1] * 0.6, 2.0))
        b = Vector((x0 + c2[0] * 0.6, c2[1] * 0.6, 2.0))
        bar(m, 'paint_red', a, b, 0.06, 0.06)
        if lod == 0:
            bm = bmesh.new()
            bm.faces.new([bm.verts.new(p) for p in [a + Vector((0, 0, -0.65)), b + Vector((0, 0, -0.65)), b + Vector((0, 0, -0.2)), a + Vector((0, 0, -0.2))]])
            m.add(bm, 'plastic_green', None, False)
    # atap
    bm = bmesh.new()
    vs = [bm.verts.new((x0 + sx * 0.8, sy * 0.8, 2.5)) for (sx, sy) in CORNERS]
    vt = bm.verts.new((x0, 0, 3.15))
    for i in range(4):
        bm.faces.new((vs[(i + 1) % 4], vs[i], vt))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    m.add(bm, 'plastic_red', None, False)
    # perosotan (talang U) ke +X
    rings = []
    n = 6 if lod == 0 else 2
    for k in range(n + 1):
        t = k / n
        x = x0 + 0.65 + t * 2.4
        z = 1.3 - 1.0 * t + 0.25 * math.sin(pi * t) * 0 - 0.05
        z = max(0.25, 1.3 - 1.05 * (t ** 0.9))
        prof = [(-0.3, 0.22), (-0.3, 0.0), (-0.22, -0.06), (0.22, -0.06), (0.3, 0.0), (0.3, 0.22)]
        rings.append([(x, py, z + pz) for (py, pz) in prof])
    for back in (False, True):  # talang tipis dua sisi
        bm = bmesh.new()
        vr = [[bm.verts.new(p) for p in r] for r in rings]
        for i in range(len(vr) - 1):
            for j in range(len(vr[0]) - 1):
                q = (vr[i][j], vr[i][j + 1], vr[i + 1][j + 1], vr[i + 1][j])
                bm.faces.new(tuple(reversed(q)) if back else q)
        m.add(bm, 'plastic_yellow', None, True)
    # tangga di −X
    for s in (1, -1):
        tube(m, 'paint_red', (x0 - 0.6 - 0.9, s * 0.3, 0), (x0 - 0.62, s * 0.3, 1.3), 0.035, sg)
    if lod == 0:
        for k in range(5):
            t = (k + 0.5) / 5
            tube(m, 'paint_red', (x0 - 1.5 + 0.88 * t, -0.3, 1.3 * t), (x0 - 1.5 + 0.88 * t, 0.3, 1.3 * t), 0.025, 6)
    # ayunan di +Y
    yS = 2.2
    for s in (1, -1):
        for d in (0.7, -0.7):
            tube(m, 'paint_blue', (s * 1.4, yS + d, 0), (s * 1.4, yS, 2.3), 0.05, sg)
    tube(m, 'paint_blue', (-1.45, yS, 2.3), (1.45, yS, 2.3), 0.055, sg, caps=True)
    for x in (-0.6, 0.6):
        for d in (-0.2, 0.2):
            tube(m, 'steel', (x + d, yS, 2.28), (x + d, yS, 0.48), 0.008, 4)
        boxz(m, 'rubber', x, yS, 0.42, 0.48, 0.18, 0.05)
    col = [dict(c=[x0 + sx * 0.6, sy * 0.6, 0.08], h=2.5) for sx, sy in CORNERS]
    col += [dict(c=[s * 1.4, yS + d, 0.08], h=2.3) for s in (1, -1) for d in (0.7, -0.7)]
    return m, dict(col=col)


# ---------- crane menara: tiang (statis) + bagian berputar
CRANE_H = 50.0


@model('crane', lods=(0, 1, 2), ao=1.2, big=True)
def m_crane(lod):
    m = Mesh()
    boxz(m, 'concrete', 0, 0, 0, 4.6, 4.6, 1.0)
    for (sx, sy) in CORNERS:
        boxz(m, 'paint_yellow', sx * 0.8, sy * 0.8, 1.0, 0.35, 0.35, 0.5)
    n = 20 if lod == 0 else 6 if lod == 1 else 3
    lv = [(1.5 + (CRANE_H - 1.5) * k / n, 0.82) for k in range(n + 1)]
    sq_tower(m, lv, 0.16 if lod < 2 else 0.24, 0.07 if lod < 2 else 0.14, 'paint_yellow', lod, pipe=(lod == 0))
    return m, dict(col=[dict(b=[0, 0, 4.6, 4.6], h=1.0, floor=1), dict(b=[0, 0, 1.75, 1.75], h=CRANE_H)])


@model('crane_top', lods=(0, 1, 2), ao=1.0, big=True)
def m_crane_top(lod):
    m = Mesh()
    z0 = CRANE_H
    boxz(m, 'paint_yellow', 0, 0, z0, 2.0, 2.0, 0.6)
    cyl(m, 'steel_dark', 0, 0, z0 + 0.6, 1.0, 1.0, 0.3, 16 if lod == 0 else 8)
    boxz(m, 'paint_yellow', 0, 0, z0 + 0.9, 2.4, 3.0, 0.5)
    # kabin operator di sisi kanan depan
    boxz(m, 'paint_white', 1.6, 1.0, z0 + 0.4, 1.4, 1.6, 2.0, bevel=0.03 if lod == 0 else 0)
    if lod < 2:
        sign(m, 'glass', (1.6, 1.81, z0 + 1.7), 1.2, 1.0, '+y')
        sign(m, 'glass', (2.31, 1.0, z0 + 1.7), 1.2, 1.0, '+x')
    # kepala menara (A) sampai 8 m di atas
    zh = z0 + 1.4
    peak = Vector((0, 0, z0 + 9.0))
    for (sx, sy) in CORNERS:
        a = Vector((sx * 0.8, sy * 0.8, zh))
        if lod >= 2:
            bar(m, 'paint_yellow', a, peak, 0.18, 0.18)
        else:
            angle_m(m, 'paint_yellow', a, peak, (-sx, 0, 0), (0, -sy, 0), 0.14)
    # jib segitiga ke +Y (52 m) dan lengan imbang ke −Y (14 m)
    jl, zj = 52.0, z0 + 1.15
    bays = 26 if lod == 0 else 10 if lod == 1 else 1
    def J(y, top, s=0):
        return Vector((0 if top else s * 0.62, y, zj + (1.3 if top else 0)))
    for (top, s) in ((False, 1), (False, -1), (True, 0)):
        a, b = J(1.2, top, s), J(jl, top, s)
        if lod >= 2:
            bar(m, 'paint_yellow', a, b, 0.25, 0.25)
        else:
            tube(m, 'paint_yellow', a, b, 0.07, 6 if lod == 0 else 4) if lod == 0 else bar(m, 'paint_yellow', a, b, 0.14, 0.14)
    if lod < 2:
        for k in range(bays):
            y0 = 1.2 + (jl - 1.2) * k / bays
            y1 = 1.2 + (jl - 1.2) * (k + 1) / bays
            for s in (1, -1):
                flat_m(m, 'paint_yellow', J(y0, False, s), J(y1, True), (0, 1, 0), (s, 0, 0), 0.07)
            flat_m(m, 'paint_yellow', J(y1, False, 1), J(y1, False, -1), (0, 1, 0), (0, 0, 1), 0.06)
            if lod == 0:
                flat_m(m, 'paint_yellow', J(y0, False, 1), J(y1, False, -1), (0, 0, 1), (0, 0, 1), 0.05)
    cl = 14.0
    for s in (1, -1):
        a, b = Vector((s * 0.9, -0.5, zj)), Vector((s * 0.9, -cl, zj))
        bar(m, 'paint_yellow', a, b, 0.22, 0.14)
    if lod < 2:
        for k in range(7 if lod == 0 else 3):
            y = -1.0 - (cl - 1.0) * k / (6 if lod == 0 else 2)
            bar(m, 'paint_yellow', (-0.9, y, zj), (0.9, y, zj), 0.12, 0.1)
        box(m, 'grate', (0, -cl / 2, zj + 0.08), (1.6, cl - 1.0, 0.04))
    for k in range(4):
        boxz(m, 'concrete', 0, -cl + 1.0 + k * 0.62, zj - 2.2, 1.75, 0.55, 2.3)
    # mesin & spanduk pengembang fiktif di lengan imbang
    boxz(m, 'paint_white', 0, -cl + 4.6, zj + 0.1, 1.5, 1.6, 1.1)
    for s in (1, -1):
        sign(m, 'atlas_crane', (s * 0.96, -cl / 2 - 1.0, zj + 0.9), 7.0, 1.3, '+x' if s > 0 else '-x')
        bar(m, 'steel_dark', (s * 0.92, -cl / 2 - 4.5, zj + 0.25), (s * 0.92, -cl / 2 + 2.5, zj + 0.25), 0.05, 0.05) if lod == 0 else None
    # batang tarik dari puncak
    for (y, z) in ((jl * 0.62, zj + 1.3), (jl * 0.3, zj + 1.3), (-cl + 0.8, zj + 0.1)):
        bar(m, 'steel_dark', peak + Vector((0, 0, -0.1)), Vector((0, y, z)), 0.06, 0.06)
    # troli + kait
    ty = 31.0
    boxz(m, 'paint_yellow', 0, ty, zj - 0.45, 1.3, 1.6, 0.45)
    for s in (1, -1):
        bar(m, 'steel_dark', (s * 0.12, ty, zj - 0.45), (s * 0.12, ty, z0 - 22.0), 0.025, 0.025)
    boxz(m, 'paint_yellow', 0, ty, z0 - 22.9, 0.55, 0.5, 0.9)
    tube(m, 'steel_dark', (0, ty, z0 - 22.9), (0, ty, z0 - 23.5), 0.05, 6)
    m.add(bmesh_dome(0.12, 8), 'lamp_red', T(0, jl, zj + 1.45))
    m.add(bmesh_dome(0.12, 8), 'lamp_red', T(0, 0, z0 + 9.1))
    return m, dict(col=[], lights=[[0, jl, zj + 1.45], [0, 0, z0 + 9.1]])


# ---------- kontainer kantor proyek
@model('cabin', lods=(0, 1), ao=0.8)
def m_cabin(lod):
    m = Mesh()
    L, W, H = 6.06, 2.44, 2.59
    z0 = 0.25
    for (sx, sy) in CORNERS:
        boxz(m, 'concrete', sx * (L / 2 - 0.3), sy * (W / 2 - 0.3), 0, 0.4, 0.4, z0)
    boxz(m, 'paint_white', 0, 0, z0, L, W, H)
    if lod == 0:
        # alur bergelombang di sisi panjang
        n = 22
        for s in (1, -1):
            for k in range(n):
                x = -L / 2 + 0.2 + (L - 0.4) * (k + 0.5) / n
                box(m, 'paint_white', (x, s * (W / 2 + 0.012), z0 + H / 2), (0.12, 0.025, H - 0.18))
        for (sx, sy) in CORNERS:  # tiang sudut
            boxz(m, 'paint_blue', sx * (L / 2 - 0.08), sy * (W / 2 - 0.08), z0, 0.17, 0.17, H)
        box(m, 'paint_blue', (0, 0, z0 + H - 0.06), (L + 0.02, W + 0.02, 0.12))
        box(m, 'paint_blue', (0, 0, z0 + 0.06), (L + 0.02, W + 0.02, 0.12))
    else:
        box(m, 'paint_blue', (0, 0, z0 + H - 0.06), (L + 0.02, W + 0.02, 0.12))
    # pintu + jendela berteralis di sisi depan (+Y)
    y = W / 2 + 0.03
    boxz(m, 'steel', 1.8, y, z0 + 0.05, 0.9, 0.02, 2.05)
    if lod == 0:
        box(m, 'chrome', (1.45, y + 0.02, z0 + 1.05), (0.12, 0.03, 0.03))
        boxz(m, 'paint_black', 1.8, y + 0.012, z0 + 0.05, 0.92, 0.01, 0.03)
    boxz(m, 'glass', -1.2, y, z0 + 1.0, 1.2, 0.02, 0.9)
    if lod == 0:
        for k in range(5):
            boxz(m, 'steel_dark', -1.2 - 0.5 + k * 0.25, y + 0.03, z0 + 1.0, 0.02, 0.02, 0.9)
        boxz(m, 'paint_white', -L / 2 - 0.15, 0.4, z0 + 1.3, 0.28, 0.75, 0.55)
    sign(m, 'atlas_land', (-1.4, y + 0.016, z0 + 2.17), 2.4, 0.45, '+y')
    # tangga
    boxz(m, 'steel_dark', 1.8, y + 0.45, 0, 1.0, 0.7, 0.12)
    boxz(m, 'steel_dark', 1.8, y + 0.2, 0.12, 1.0, 0.4, 0.12)
    return m, dict(col=[dict(b=[0, 0, L, W], h=z0 + H, floor=1)])


# ---------- menara air
WT_LV = [(0, 2.2), (3.5, 2.05), (7.0, 1.9), (10.5, 1.75), (14.0, 1.6)]


@model('wtower', lods=(0, 1, 2), ao=1.0, big=True)
def m_wtower(lod):
    m = Mesh()
    sq_tower(m, WT_LV, 0.16 if lod < 2 else 0.24, 0.07 if lod < 2 else 0.12, 'galv', lod)
    for (sx, sy) in CORNERS:
        boxz(m, 'concrete', sx * 2.2, sy * 2.2, -0.05, 0.7, 0.7, 0.45)
    zt = 14.0
    boxz(m, 'galv', 0, 0, zt, 4.0, 4.0, 0.25)
    sg = 24 if lod == 0 else 12 if lod == 1 else 8
    cyl(m, 'paint_blue', 0, 0, zt + 0.25, 2.0, 2.0, 3.2, sg, caps=False)
    lathe(m, 'paint_blue', [(2.05, zt + 3.45), (2.05, zt + 3.55), (0.35, zt + 4.35), (0.0, zt + 4.4)], sg)
    lathe(m, 'paint_blue', [(0.0, zt + 0.25), (2.0, zt + 0.25)], sg) if lod >= 2 else None
    if lod < 2:
        cyl(m, 'grate', 0, 0, zt + 0.22, 2.7, 2.7, 0.04, sg)
        for k in range(16 if lod == 0 else 8):
            a = k / (16 if lod == 0 else 8) * 2 * pi
            tube(m, 'galv', (math.cos(a) * 2.6, math.sin(a) * 2.6, zt + 0.26), (math.cos(a) * 2.6, math.sin(a) * 2.6, zt + 1.3), 0.025, 4)
        ring = [(math.cos(2 * pi * k / 24) * 2.6, math.sin(2 * pi * k / 24) * 2.6, zt + 1.3) for k in range(25)]
        path_tube(m, 'galv', ring, 0.03, 5)
        tube(m, 'galv', (0, 0, 0.0), (0, 0, zt), 0.13, 10 if lod == 0 else 6)
        if lod == 0:  # tangga di kaki (+X,+Y)
            for s in (-0.22, 0.22):
                tube(m, 'galv', (2.45 + s * 0.3, 2.15 - s, 0), (2.0 + s * 0.3, 1.75 - s, zt), 0.02, 4)
            for k in range(30):
                t = (k + 0.5) / 30
                p = Vector((2.45 - 0.45 * t, 2.15 - 0.4 * t, zt * t))
                tube(m, 'galv', p + Vector((-0.066, 0.22, 0)), p + Vector((0.066, -0.22, 0)), 0.012, 4)
    col = [dict(c=[sx * 2.2, sy * 2.2, 0.3], h=14.0) for sx, sy in CORNERS] + [dict(c=[0, 0, 0.15], h=14.0)]
    return m, dict(col=col)


# ---------------------------------------------------------------- AO, objek, ekspor
def tri_count(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


def autosmooth(bm, ang=40):
    th = ang * D2R
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = not (e.calc_face_angle(pi) > th)
        else:
            e.smooth = False


def ao_dirs(n):
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        v = (i * 0.6180339887) % 1.0
        r, ph = math.sqrt(u), 2 * pi * v
        out.append(Vector((r * math.cos(ph), r * math.sin(ph), math.sqrt(max(0.0, 1 - u)))))
    return out


def make_obj(name, m, ao_dist):
    bm = m.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    autosmooth(bm, 40)
    # putar ke kontrak (depan −Y Blender)
    bmesh.ops.transform(bm, matrix=ROT, verts=bm.verts)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    used = sorted({p.material_index for p in me.polygons})
    remap = {old: k for k, old in enumerate(used)}
    for p in me.polygons:
        p.material_index = remap[p.material_index]
    for old in used:
        me.materials.append(BMAT[MAT_NAMES[old]])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bake_ao(ob, bm, ao_dist)
    bm.free()
    return ob


def bake_ao(ob, bm, maxd):
    """Oklusi ambien per sudut face (sinar ke mesh sendiri + tanah) → atribut warna 'Col' (R = AO)."""
    me = ob.data
    verts = [v.co.copy() for v in bm.verts]
    polys = [[v.index for v in f.verts] for f in bm.faces if not BMAT_NAME(f.material_index).startswith('net')]
    o = len(verts)
    G = 400.0
    verts += [Vector((-G, -G, 0)), Vector((G, -G, 0)), Vector((G, G, 0)), Vector((-G, G, 0))]
    polys.append([o, o + 1, o + 2, o + 3])
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    rays = 6 if FAST else 14
    dirs = ao_dirs(rays)
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    me.calc_loop_triangles() if hasattr(me, 'calc_loop_triangles') else None
    cn = me.corner_normals
    cache = {}
    for li, l in enumerate(me.loops):
        vi = l.vertex_index
        n = cn[li].vector
        key = (vi, round(n.x * 5), round(n.y * 5), round(n.z * 5))
        ao = cache.get(key)
        if ao is None:
            p = me.vertices[vi].co + n * 0.004
            t = n.orthogonal().normalized()
            b = n.cross(t)
            occ = 0.0
            for d in dirs:
                dw = t * d.x + b * d.y + n * d.z
                hit = bvh.ray_cast(p, dw, maxd)
                if hit[0] is not None:
                    occ += 1.0 - (hit[3] / maxd) ** 2
            ao = max(0.08, 1.0 - occ / rays)
            cache[key] = ao
        attr.data[li].color = (ao, ao, ao, 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass


_MAT_BY_IDX = None


def BMAT_NAME(i):
    return MAT_NAMES[i]


def gl(p):  # koordinat penulis (x kanan, y depan, z atas) → model glTF (x kiri, y atas, z depan)
    return [round(-p[0], 4), round(p[2], 4), round(p[1], 4)]


def build(names):
    objs, man = [], {}
    for name in names:
        spec = MODELS[name]
        info = dict(lods=[], tris=[])
        for lod in spec['lods']:
            t0 = time.time()
            m, meta = spec['fn'](lod)
            tris = m.tris()
            ob = make_obj('%s_lod%d' % (name, lod), m, spec['ao'])
            objs.append(ob)
            info['lods'].append(lod)
            info['tris'].append(tris)
            if lod == 0:
                bb = [Vector(c) for c in ob.bound_box]
                mn = Vector((min(c.x for c in bb), min(c.y for c in bb), min(c.z for c in bb)))
                mx = Vector((max(c.x for c in bb), max(c.y for c in bb), max(c.z for c in bb)))
                info['size'] = [round(mx.x - mn.x, 3), round(mx.z - mn.z, 3), round(mx.y - mn.y, 3)]
                info['height'] = round(mx.z, 3)
                info['radius'] = round(max(abs(mn.x), abs(mx.x), abs(mn.y), abs(mx.y)), 3)
                for k in ('col', 'anchors', 'lights'):
                    if meta.get(k) is not None:
                        info[k] = meta[k]
            log(name, 'lod%d' % lod, tris, 'tris', '%.1fs' % (time.time() - t0))
        man[name] = info
    return objs, man


def export_glb(objs, man):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'envprops.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_animations=False,
                              export_draco_mesh_compression_enable=False, export_texcoords=True, export_extras=False,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_materials='EXPORT')
    log('ekspor', path, os.path.getsize(path), 'byte')
    meta = dict(version=1, generated=time.strftime('%Y-%m-%d'), axes='glTF: +Y atas, +Z depan, +X kiri; col/anchors/lights: koordinat penulis (x kanan, y depan, z atas)',
                types=man)
    with open(os.path.join(OUT, 'envprops.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))


# ---------------------------------------------------------------- pratinjau
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def render_setup(w, h, samples):
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.render.threads_mode = 'FIXED'
    scn.render.threads = 2
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.cycles.max_bounces = 6
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass


def world_hdr():
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bg = nt.nodes.get('Background')
    hdr = os.path.join(ROOT, 'web', 'game', 'assets', 'sky', 'sky_1k.hdr')
    if os.path.exists(hdr):
        env = nt.nodes.new('ShaderNodeTexEnvironment')
        env.image = bpy.data.images.load(hdr)
        nt.links.new(env.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = 1.0
    else:
        bg.inputs['Color'].default_value = (0.6, 0.7, 0.85, 1)
    sund = bpy.data.lights.new('sun', 'SUN')
    sund.energy = 4.0
    sund.angle = 0.03
    sun = link(bpy.data.objects.new('sun', sund))
    sun.rotation_euler = (50 * D2R, 0, 215 * D2R)


def ground(size=6000):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size)
    me = bpy.data.meshes.new('ground')
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.new('ground')
    try:
        mat.use_nodes = True
    except Exception:
        pass
    b = mat.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb('#8d8a80'), 1)
    b.inputs['Roughness'].default_value = 0.95
    me.materials.append(mat)
    return link(bpy.data.objects.new('ground', me))


def cam_look(loc, target, lens=50):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cam = link(bpy.data.objects.new('cam', cd))
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def preview_materials():
    """Pratinjau saja: muka atlas memakai gambar atlas dari game (--atlas png --layout json, diekspor dari kanvas
    web/map/envprops.js), jaring diberi alfa kotak-kotak, layar videotron berpijar."""
    atlas, layout = opt('--atlas'), opt('--layout')
    if atlas and layout and os.path.exists(atlas) and os.path.exists(layout):
        L = json.load(open(layout))
        img = bpy.data.images.load(atlas)
        AW, AH = L['AW'], L['AH']
        for name, m in BMAT.items():
            key = name[6:] if name.startswith('atlas_') else ('screen' if name == 'screen' else None)
            if not key:
                continue
            if key in ('ad', 'screen'):
                x, y, w, h = L['AD']['x'] + (L['AD']['w'] if key == 'screen' else 0), L['AD']['y'], L['AD']['w'], L['AD']['h']
            elif key == 'name':
                x, y, w, h = L['NM']['x'] + L['NM']['w'] * 3, L['NM']['y'], L['NM']['w'], L['NM']['h']
            else:
                if key not in L['CELL']:
                    continue
                x, y, w, h = L['CELL'][key]
            nt = m.node_tree
            bsdf = nt.nodes.get('Principled BSDF')
            uvn = nt.nodes.new('ShaderNodeUVMap')
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Location'].default_value = (x / AW, 1 - (y + h) / AH, 0)
            mp.inputs['Scale'].default_value = (w / AW, h / AH, 1)
            tx = nt.nodes.new('ShaderNodeTexImage')
            tx.image = img
            nt.links.new(uvn.outputs['UV'], mp.inputs['Vector'])
            nt.links.new(mp.outputs['Vector'], tx.inputs['Vector'])
            nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
            if key == 'screen' or MATS[name][3:]:
                nt.links.new(tx.outputs['Color'], bsdf.inputs['Emission Color'])
                bsdf.inputs['Emission Strength'].default_value = 1.2 if key == 'screen' else 0.4
    m = BMAT['net']
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    uvn = nt.nodes.new('ShaderNodeUVMap')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uvn.outputs['UV'], sep.inputs['Vector'])
    ors = []
    for comp in ('X', 'Y'):
        fr = nt.nodes.new('ShaderNodeMath')
        fr.operation = 'FRACT'
        nt.links.new(sep.outputs[comp], fr.inputs[0])
        lt = nt.nodes.new('ShaderNodeMath')
        lt.operation = 'LESS_THAN'
        lt.inputs[1].default_value = 0.14
        nt.links.new(fr.outputs[0], lt.inputs[0])
        ors.append(lt)
    mx = nt.nodes.new('ShaderNodeMath')
    mx.operation = 'MAXIMUM'
    nt.links.new(ors[0].outputs[0], mx.inputs[0])
    nt.links.new(ors[1].outputs[0], mx.inputs[1])
    nt.links.new(mx.outputs[0], bsdf.inputs['Alpha'])
    try:
        m.blend_method = 'HASHED'
    except Exception:
        pass


def shots(objs, man):
    os.makedirs(PREV, exist_ok=True)
    preview_materials()
    lod0 = {o.name[:-5]: o for o in objs if o.name.endswith('_lod0')}
    for o in objs:
        o.hide_render = True
    ground(6000)
    world_hdr()
    samples = 24 if FAST else 40
    hf = 2 * math.atan(18 / 50)  # FOV mendatar lensa 50 mm (sensor 36 mm)

    def place(names, gap, y=0.0):
        x = 0.0
        out = []
        for n in names:
            if n not in lod0:
                continue
            w = man[n]['size'][0]
            out.append((lod0[n], x + w / 2))
            x += w + gap
        off = x / 2
        for o, cx in out:
            o.hide_render = False
            o.location = (cx - off, y, 0)  # model sudah menghadap −Y Blender (kamera di −Y)
        return x - gap
    # dua baris: perabot kecil di depan, benda tinggi tepi jalan di belakang
    w1 = place(['hydrant', 'bin', 'bench', 'boom', 'pillar', 'namesign', 'pump', 'goal', 'hoop'], 0.8, -3.5)
    w2 = place(['lamp', 'halte', 'guard', 'pole_t', 'signal', 'fuelsign', 'lamp2', 'pole'], 1.6, 3.5)
    W_ = max(w1, w2)
    d = W_ * 0.5 / math.tan(hf / 2) * 1.04
    render_setup(1920 if not FAST else 1280, 800 if not FAST else 534, samples)
    cam_look((0, -d - 3.5, 6.5), (0, 0, 2.6), 50)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'lineup.png')
    bpy.ops.render.render(write_still=True)
    log('pratinjau', bpy.context.scene.render.filepath)
    for o in objs:
        o.hide_render = True
    wsum = place(['board', 'video', 'btsr', 'cabin', 'gazebo', 'playset'], 3.0)
    d = wsum * 0.5 / math.tan(hf / 2) * 1.04
    render_setup(1920 if not FAST else 1280, 800 if not FAST else 534, samples)
    cam_look((0, -d, 5.0), (0, 0, 7.0), 50)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'lineup_mid.png')
    bpy.ops.render.render(write_still=True)
    log('pratinjau', bpy.context.scene.render.filepath)
    for o in objs:
        o.hide_render = True
    wsum = place(['bts', 'sutet', 'crane', 'wtower'], 14.0)
    if 'crane' in lod0 and 'crane_top' in lod0:
        ct = lod0['crane_top']
        ct.hide_render = False
        ct.location = lod0['crane'].location.copy()
        ct.rotation_euler = (0, 0, 215 * D2R)
    hf2 = 2 * math.atan(18 / 35)
    d = max(wsum * 0.5 / math.tan(hf2 / 2) * 1.1, 95)
    render_setup(1920 if not FAST else 1280, 1000 if not FAST else 667, samples)
    cam_look((0, -d, 10.0), (0, 0, 30.0), 35)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'lineup_towers.png')
    bpy.ops.render.render(write_still=True)
    log('pratinjau', bpy.context.scene.render.filepath)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.context.scene.render.threads_mode = 'FIXED'
        bpy.context.scene.render.threads = 2
    except Exception:
        pass
    make_materials()
    only = opt('--only')
    names = [n for n in MODELS if not only or n in only.split(',')]
    t0 = time.time()
    objs, man = build(names)
    log('selesai %.1fs' % (time.time() - t0), 'total tris lod0', sum(man[n]['tris'][0] for n in man))
    if not opt('--no-export'):
        export_glb(objs, man)
    if opt('--shots'):
        shots(objs, man)


main()
