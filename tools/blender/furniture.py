"""Sutera Royale: perabot interior (Blender headless) → web/game/assets/furniture/furniture.glb + furniture.json
(+ detail_wood/fabric/marble.jpg dengan --detail).

Jalankan dari root proyek (mesin dipakai bersama: prioritas rendah, 2 thread):
  taskpolicy -b nice -n 19 ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P tools/blender/furniture.py -t 2 -- [--only sofa_fabric,bed_wood] [--fast] [--shots] [--no-export] [--detail]

Opsi:
  --only a,b     hanya model tertentu (uji; ekspor tetap ditulis → jangan dipakai untuk ekspor akhir)
  --fast         AO kasar (iterasi cepat)
  --shots        render pratinjau Cycles ke preview/furniture/ (deret per kelompok ruang)
  --no-export    lewati ekspor GLB + JSON
  --detail       tekstur detail abu-abu dari sumber tools/realism/fetch_furniture.py → detail_wood/fabric/marble.jpg

Kontrak (dipakai web/map/furniture.js; satu model diinstans puluhan–ribuan kali):
  - Satu simpul mesh per (model, LOD): '<model>_lod<k>', model = '<jenis>_<varian>' (huruf kecil, angka, garis bawah).
  - Koordinat penulis: x = sepanjang dinding (sumbu a perabot di interiors.js), y = ke depan/ke dalam ruang (sumbu b),
    z = atas; titik asal di tengah tapak, di lantai. Ukuran acuan (manifest 'size' = w, d, h) sama dengan kotak tabrakan
    perabot (interiors.js ITEMS / planShop / planTower); bagian yang boleh melewati kotak: kursi meja makan (sama dengan
    collider), TV di atas meja TV, lemari gantung dapur, tiang & atap kios, daun tanaman.
    glTF (export_yup): X = x, Y = z, Z = −y.
  - Material bernama (warna dasar, kekasaran, logam, pijar dibaca game per verteks). Awalan nama → jenis permukaan:
      wood_*    serat kayu (detail_wood, UV = meter, searah sisi terpanjang bagian); wood_white = cat (serat samar)
      fab_*     tenunan kain (detail_fabric); tfab_main / tfab_acc = kain berwarna per instans (warna 1 / 2)
      leather_* / tleather  kulit (detail_fabric sangat halus); tleather = warna per instans 1
      stone_*   batu/marmer (detail_marble)
      leaf_*    daun (cahaya tembus)
      glass_*   kaca TEMBUS PANDANG (digambar terpisah, bening + pantulan)
      atlas_<k> muka bertekstur atlas kanvas game; UV: u = nomor sel + u lokal, v = v lokal
                goods (label barang, diacak per instans), books (punggung buku, diacak), rug (motif karpet),
                rows (deret barang di rak, LOD1), misc (sel tetap: layar, papan menu, dsb.), misce (misc menyala),
                tpat (motif kain × warna instans 1)
  - COLOR_0 = oklusi ambien per sudut (R), dipanggang di sini (sinar ke diri sendiri + lantai + dinding belakang).
  - furniture.json: per model: kind, ctx (konteks pemakaian), size, lods, tris, slice (margin 9-slice per sumbu),
    proxy (kotak sederhana untuk jarak jauh & bayangan matahari), wall, tile (lebar modul rak).
"""
import bpy
import bmesh
import json
import math
import os
import random
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
OUT = os.path.abspath(opt('--out', os.path.join(ROOT, 'web', 'game', 'assets', 'furniture')))
PREV = os.path.abspath(os.path.join(ROOT, 'preview', 'furniture'))
CACHE = os.path.expanduser(opt('--cache', '~/.cache/senara-digital-twin/furniture'))
FAST = bool(opt('--fast'))
pi = math.pi
D2R = pi / 180


def log(*a):
    print('[furniture]', *a, flush=True)


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
# nama: (warna sRGB, kekasaran, logam, [pijar sRGB, kuat pijar])
MATS = {
    # kayu (serat: detail_wood)
    'wood_teak': ('#6c4a31', 0.5, 0.0),
    'wood_oak': ('#b3875a', 0.55, 0.0),
    'wood_walnut': ('#5b3b28', 0.45, 0.0),
    'wood_light': ('#cfae84', 0.55, 0.0),
    'wood_dark': ('#3b2a20', 0.42, 0.0),
    'wood_white': ('#e8e3d9', 0.38, 0.0),
    'wood_grey': ('#9b958c', 0.5, 0.0),
    # kain (tenunan: detail_fabric)
    'tfab_main': ('#ffffff', 0.92, 0.0),
    'tfab_acc': ('#ffffff', 0.9, 0.0),
    'fab_white': ('#ece9e2', 0.9, 0.0),
    'fab_grey': ('#80838a', 0.92, 0.0),
    'fab_beige': ('#cbb99d', 0.92, 0.0),
    'fab_dark': ('#2f3137', 0.9, 0.0),
    'fab_rattan': ('#b88d55', 0.7, 0.0),
    'tleather': ('#ffffff', 0.4, 0.0),
    'leather_black': ('#1e1d1d', 0.38, 0.0),
    # batu
    'stone_marble': ('#e7e4de', 0.16, 0.0),
    'stone_granite': ('#3a3a3d', 0.22, 0.0),
    'stone_terrazzo': ('#cdc6ba', 0.42, 0.0),
    'stone_grey': ('#a19b91', 0.3, 0.0),
    'stone_dark': ('#4a4643', 0.25, 0.0),
    # logam
    'steel': ('#b9bcbf', 0.3, 1.0),
    'chrome': ('#e6e7e8', 0.07, 1.0),
    'metal_black': ('#212327', 0.45, 0.7),
    'alu': ('#b5b9be', 0.35, 0.9),
    'gold': ('#d29f52', 0.28, 1.0),
    'brass': ('#b08a48', 0.32, 1.0),
    # cat & plastik
    'paint_white': ('#eeece7', 0.42, 0.0),
    'paint_cream': ('#e6dbc5', 0.5, 0.0),
    'paint_black': ('#1c1d20', 0.45, 0.0),
    'paint_grey': ('#6f7479', 0.45, 0.0),
    'paint_sage': ('#8a9a86', 0.5, 0.0),
    'paint_blue': ('#2f4f7a', 0.45, 0.0),
    'paint_purple': ('#3d3782', 0.4, 0.0),
    'paint_red': ('#b8352a', 0.42, 0.0),
    'paint_yellow': ('#e0a52a', 0.42, 0.0),
    'plastic_white': ('#f1f1ef', 0.32, 0.0),
    'plastic_black': ('#151618', 0.35, 0.0),
    'plastic_grey': ('#8b8f95', 0.4, 0.0),
    'plastic_red': ('#c9302c', 0.38, 0.0),
    'plastic_blue': ('#2e6db4', 0.38, 0.0),
    'plastic_green': ('#2f8a3e', 0.4, 0.0),
    'plastic_orange': ('#e07a2a', 0.4, 0.0),
    'plastic_pink': ('#e58aa8', 0.4, 0.0),
    'rubber': ('#151515', 0.85, 0.0),
    'ceramic': ('#f4f4f1', 0.07, 0.0),
    'ceramic_tile': ('#e1e7ea', 0.18, 0.0),
    'ceramic_blue': ('#3e6c8e', 0.12, 0.0),
    'terracotta': ('#a9583a', 0.75, 0.0),
    'pot_white': ('#ecebe6', 0.25, 0.0),
    'pot_dark': ('#2b2c2e', 0.4, 0.0),
    'soil': ('#33261c', 0.95, 0.0),
    'paper': ('#f2efe6', 0.8, 0.0),
    'food_brown': ('#9a5a2a', 0.6, 0.0),
    'food_orange': ('#e08a2a', 0.55, 0.0),
    'food_red': ('#b8282a', 0.45, 0.0),
    'food_green': ('#6a9a2a', 0.5, 0.0),
    'food_yellow': ('#e8c23a', 0.5, 0.0),
    # daun
    'leaf_dark': ('#2b5527', 0.5, 0.0),
    'leaf_mid': ('#3c7330', 0.5, 0.0),
    'leaf_snake': ('#35552a', 0.45, 0.0),
    'leaf_edge': ('#b4ab48', 0.5, 0.0),
    'leaf_palm': ('#4f7f34', 0.55, 0.0),
    'stem': ('#5a6a2e', 0.7, 0.0),
    # kaca & cermin (glass_* tembus pandang di game)
    'glass_clear': ('#e9f1f3', 0.04, 0.0),
    'glass_tint': ('#90a7b4', 0.04, 0.0),
    'glass_frost': ('#dfe7ea', 0.28, 0.0),
    'mirror': ('#dde2e4', 0.03, 1.0),
    'screen': ('#08090b', 0.06, 0.0),
    # pijar
    'emit_warm': ('#f2e3c4', 0.6, 0.0, '#ffd59a', 1.6),
    'emit_white': ('#f4f6f8', 0.4, 0.0, '#ffffff', 2.2),
    'emit_red': ('#ff3a2a', 0.4, 0.0, '#ff2a1a', 2.5),
    # atlas (u = sel + u lokal)
    'atlas_goods': ('#ffffff', 0.38, 0.0),
    'atlas_books': ('#ffffff', 0.62, 0.0),
    'atlas_rug': ('#ffffff', 0.96, 0.0),
    'atlas_rows': ('#ffffff', 0.45, 0.0),
    'atlas_misc': ('#ffffff', 0.35, 0.0),
    'atlas_misce': ('#ffffff', 0.2, 0.0, '#ffffff', 1.0),
    'atlas_tpat': ('#ffffff', 0.9, 0.0),
}
MAT_NAMES = list(MATS)
MI = {n: i for i, n in enumerate(MAT_NAMES)}
BMAT = {}

# sel tetap atlas 'misc' (sama dengan web/map/furniture.js MISC)
MISC = dict(tv=0, tv_on=1, laptop=2, pos=3, menu=4, cooler=5, kiosk_a=6, kiosk_b=7, mag_a=8, mag_b=9, art=10,
            clock=11, lift=12, lobby=13, calendar=14, cake=15)
N_GOODS, N_BOOKS, N_RUGS, N_ROWS, N_PAT = 64, 48, 6, 8, 8


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


def kind_of(mat):
    if mat.startswith('atlas_'):
        return 'atlas'
    if mat.startswith(('wood_', 'fab_', 'tfab_', 'leather_', 'tleather', 'stone_')):
        return 'tile'
    return 'plain'


def uv_tile(face, co, size, center):
    """UV meter untuk tekstur ubin: proyeksi kotak menurut arah muka; u searah sisi terpanjang bagian."""
    n = face.normal
    k = max(range(3), key=lambda i: abs(n[i]))
    a, b = [(1, 2), (0, 2), (0, 1)][k]
    if size[b] > size[a]:
        a, b = b, a
    return (co[a] + center[a] * 0.37, co[b] + center[b] * 0.53)


class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new(UVN)
        self.proxy = []

    def add(self, src, mat, M=None, smooth=False, cell=None, front=None, uvfn=None):
        """Salin bmesh src (dibebaskan) dengan material. UV otomatis menurut jenis material:
        tile → meter (proyeksi kotak), atlas → [cell + u, v] per muka (front: sumbu normal muka berlabel, mis. '+y';
        muka lain mengambil pita tepi sel), plain → 0. uvfn(face, co) → (u, v) menimpa."""
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
        if not out:
            return out
        k = kind_of(mat)
        pts = [v.co for f in out for v in f.verts]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        size, center = hi - lo, (hi + lo) / 2
        for nf in out:
            nf.normal_update()
            for l in nf.loops:
                co = l.vert.co
                if uvfn:
                    l[self.uv].uv = uvfn(nf, co)
                elif k == 'tile':
                    l[self.uv].uv = uv_tile(nf, co, size, center)
                elif k == 'atlas':
                    c = 0 if cell is None else cell
                    n = nf.normal
                    ax = max(range(3), key=lambda i: abs(n[i]))
                    lab = front is None or (('xyz'[ax] == front[1]) and ((n[ax] > 0) == (front[0] == '+')))
                    # muka berlabel: u kanan penonton, v atas
                    if ax == 2:
                        u = (co.x - lo.x) / max(1e-6, size.x)
                        v = (co.y - lo.y) / max(1e-6, size.y)
                    elif ax == 1:
                        u = (co.x - lo.x) / max(1e-6, size.x)
                        if n.y > 0:
                            u = 1 - u
                        v = (co.z - lo.z) / max(1e-6, size.z)
                    else:
                        u = (co.y - lo.y) / max(1e-6, size.y)
                        if n.x < 0:
                            u = 1 - u
                        v = (co.z - lo.z) / max(1e-6, size.z)
                    if not lab:  # sisi lain: pita sempit di tepi kiri sel (warna dasar label)
                        u = 0.02 + 0.04 * u
                        v = 0.1 + 0.8 * v
                    l[self.uv].uv = (c + min(0.999, max(0.001, u)), min(0.999, max(0.001, v)))
                else:
                    l[self.uv].uv = (0.0, 0.0)
        return out

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def px(self, c, s, mat, tint=0, cell=-1, two=False):
        """Kotak proksi (LOD jauh & bayangan matahari): pusat c, ukuran s (koordinat penulis); tint = slot warna instans;
        cell = gambar atlas di muka depan (0–99 deret barang 'rows', 100+k sel misc k, 200 motif karpet di muka atas);
        two = gambar juga di muka belakang."""
        self.proxy.append(dict(c=[round(v, 4) for v in c], s=[round(v, 4) for v in s], m=mat, t=tint, cell=cell, two=two))


def merge_mesh(dst, src, M=None):
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
    for p in src.proxy:
        if M is None:
            dst.proxy.append(p)
    src.bm.free()


# ---------------------------------------------------------------- primitif
def bm_box(sx, sy, sz, bevel=0.0, seg=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bevel = min(bevel, sx * 0.45, sy * 0.45, sz * 0.45)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type='OFFSET', segments=seg, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    return bm


def box(m, mat, c, s, bevel=0.0, seg=1, M=None, smooth=None, **kw):
    """Kotak berpusat c, ukuran s; bevel > 0 = tepi dibulatkan (seg ≥ 2 → halus)."""
    bm = bm_box(*s, bevel=bevel, seg=seg)
    MM = T(*c) if M is None else M @ T(*c)
    return m.add(bm, mat, MM, smooth if smooth is not None else (bevel > 0 and seg >= 2), **kw)


def boxz(m, mat, x, y, z0, sx, sy, sz, bevel=0.0, seg=1, M=None, **kw):
    """Kotak beralas z0."""
    return box(m, mat, (x, y, z0 + sz / 2), (sx, sy, sz), bevel, seg, M, **kw)


def bm_superbox(sx, sy, sz, ep=0.18, ev=0.35, nu=16, nv=8):
    """Kotak membulat lunak (superkuadrik): ep = kebulatan denah, ev = kebulatan tegak (bantal, kasur, jok)."""
    bm = bmesh.new()
    sg = lambda t, e: math.copysign(abs(t) ** e, t)
    rings = []
    top = bm.verts.new((0, 0, sz / 2))
    bot = bm.verts.new((0, 0, -sz / 2))
    for j in range(1, nv):
        v = -pi / 2 + pi * j / nv
        cv, sv = math.cos(v), math.sin(v)
        ring = []
        for i in range(nu):
            u = 2 * pi * (i + 0.5) / nu
            x = sx / 2 * sg(cv, ev) * sg(math.cos(u), ep)
            y = sy / 2 * sg(cv, ev) * sg(math.sin(u), ep)
            z = sz / 2 * sg(sv, ev)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for j in range(len(rings) - 1):
        A, B = rings[j], rings[j + 1]
        for i in range(nu):
            k = (i + 1) % nu
            bm.faces.new((A[i], A[k], B[k], B[i]))
    for i in range(nu):
        k = (i + 1) % nu
        bm.faces.new((rings[0][k], rings[0][i], bot))
        bm.faces.new((rings[-1][i], rings[-1][k], top))
    bm.normal_update()
    return bm


def cushion(m, mat, c, s, ep=0.16, ev=0.4, lod=0, M=None, **kw):
    """Bantalan lunak (superkuadrik); LOD1 = kotak sedikit menyusut (siluet sama dari jauh, 12 segitiga)."""
    MM = T(*c) if M is None else M @ T(*c)
    if lod > 0:
        return m.add(bm_box(s[0] * 0.96, s[1] * 0.96, s[2] * 0.92), mat, MM, False, **kw)
    return m.add(bm_superbox(*s, ep=ep, ev=ev, nu=16, nv=8), mat, MM, True, **kw)


def bm_cyl(r1, r2, h, segs=12, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    return bm


def cyl(m, mat, x, y, z0, r1, r2, h, segs=12, caps=True, smooth=True, M=None, **kw):
    MM = T(x, y, z0) if M is None else M @ T(x, y, z0)
    return m.add(bm_cyl(r1, r2, h, segs, caps), mat, MM, smooth, **kw)


def frame_to(a, b):
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return T(*a) @ q.to_matrix().to_4x4(), d.length


def tube(m, mat, a, b, r, segs=8, caps=False, smooth=True, r2=None):
    M, L = frame_to(a, b)
    return m.add(bm_cyl(r, r if r2 is None else r2, L, segs, caps), mat, M, smooth)


def lathe(m, mat, prof, segs=16, M=None, smooth=True, cap_top=False, cap_bot=False, **kw):
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
            try:
                if len(A) == 1:
                    bm.faces.new((A[0], B[i], B[j]) if prof[k + 1][1] >= prof[k][1] else (A[0], B[j], B[i]))
                elif len(B) == 1:
                    bm.faces.new((A[i], A[j], B[0]))
                else:
                    bm.faces.new((A[i], A[j], B[j], B[i]))
            except ValueError:
                pass
    if cap_bot and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bm.normal_update()
    zc = sum(p[1] for p in prof) / len(prof)
    for f in bm.faces:
        c = f.calc_center_median()
        o = Vector((c.x, c.y, 0))
        if o.length < 1e-4 or abs(f.normal.z) > 0.999:
            o = Vector((0, 0, 1 if c.z > zc else -1))
        if f.normal.dot(o) < 0:
            f.normal_flip()
    return m.add(bm, mat, M, smooth, **kw)


def loft(m, mat, rings, cap0=True, cap1=True, smooth=False, **kw):
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
    return m.add(bm, mat, None, smooth, **kw)


def quad(m, mat, pts, two=False, cell=None, uvs=None):
    """Muka datar 4 titik (opsional dua sisi). uvs: 4 pasang UV (atlas: + sel)."""
    out = []
    for flip in ((False, True) if two else (False,)):
        P = list(reversed(pts)) if flip else pts
        bm = bmesh.new()
        vs = [bm.verts.new(Vector(p)) for p in P]
        bm.faces.new(vs)
        q = list(reversed(uvs)) if (uvs and flip) else uvs
        lut = {tuple(round(c, 6) for c in p): (q[i] if q else None) for i, p in enumerate(P)}
        f = None
        if q:
            def f(face, co):
                return lut.get(tuple(round(c, 6) for c in co), (0, 0))
        out += m.add(bm, mat, None, False, cell=cell, uvfn=f)
    return out


def rrect(cx, cy, w, h, r, n=3):
    """Persegi panjang bersudut bulat (titik 2D berlawanan jarum jam)."""
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + sx * (w / 2 - r), cy + sy * (h / 2 - r)
        for i in range(n + 1):
            a = (a0 + 90 * i / n) * D2R
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def slab(m, mat, pts2, z0, z1, smooth=False, **kw):
    """Prisma dari poligon 2D (CCW) setinggi z0..z1."""
    return loft(m, mat, [[(x, y, z0) for x, y in pts2], [(x, y, z1) for x, y in pts2]], True, True, smooth, **kw)


# ---------------------------------------------------------------- bagian umum
def legs4(m, mat, w, d, z1, r=0.018, inset=0.06, taper=0.7, splay=0.0, lod=0, square=False):
    """Empat kaki dari lantai ke z1 (tepi tapak w × d, mundur inset)."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - inset), sy * (d / 2 - inset)
            if square:
                bm = bmesh.new()
                bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=4, radius1=r * 1.41 * taper, radius2=r * 1.41, depth=z1)
                bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Rz(45).to_3x3())
                bmesh.ops.translate(bm, vec=(x, y, z1 / 2), verts=bm.verts)
                m.add(bm, mat, None, False)
            else:
                a = Vector((x + sx * splay, y + sy * splay, 0))
                b = Vector((x, y, z1))
                tube(m, mat, a, b, r * taper, 8 if lod == 0 else 5, caps=True, r2=r)


def handle(m, mat, x, y, z, length, axis='z', lod=0, out=0.025):
    """Gagang batang di muka +y (axis = arah panjang)."""
    if lod > 0:
        if axis == 'z':
            box(m, mat, (x, y + out / 2, z), (0.012, out, length))
        else:
            box(m, mat, (x, y + out / 2, z), (length, out, 0.012))
        return
    if axis == 'z':
        tube(m, mat, (x, y + out, z - length / 2), (x, y + out, z + length / 2), 0.006, 6, caps=True)
        for s in (-1, 1):
            tube(m, mat, (x, y, z + s * length * 0.4), (x, y + out, z + s * length * 0.4), 0.004, 5)
    else:
        tube(m, mat, (x - length / 2, y + out, z), (x + length / 2, y + out, z), 0.006, 6, caps=True)
        for s in (-1, 1):
            tube(m, mat, (x + s * length * 0.4, y, z), (x + s * length * 0.4, y + out, z), 0.004, 5)


def knob(m, mat, x, y, z, r=0.012, lod=0):
    if lod > 0:
        return
    cyl(m, mat, 0, 0, 0, r * 0.6, r, 0.018, 8, M=T(x, y, z) @ Rx(-90))


def books(m, x0, x1, y_back, z, depth, rng, lod, lean=True, hmin=0.17, hmax=0.27):
    """Deretan buku berdiri di rak (punggung menghadap +y), sel atlas acak."""
    x = x0
    while x < x1 - 0.02:
        t = rng.uniform(0.018, 0.05)
        if x + t > x1:
            break
        h = rng.uniform(hmin, hmax)
        dd = min(depth, rng.uniform(0.15, 0.22))
        cell = rng.randrange(N_BOOKS)
        if lod == 0:
            box(m, 'atlas_books', (x + t / 2, y_back + dd / 2, z + h / 2), (t * 0.96, dd, h), cell=cell, front='+y')
        x += t
        if lean and rng.random() < 0.05 and x < x1 - 0.3:
            x += rng.uniform(0.04, 0.12)  # celah
    if lod > 0:
        box(m, 'atlas_rows', ((x0 + x1) / 2, y_back + 0.09, z + 0.11), (x1 - x0, 0.18, 0.22), cell=7, front='+y')


def bottle(m, x, y, z, rad, h, cell, sg=6):
    """Botol/kaleng berlabel (atlas goods): badan silinder tanpa alas + bahu & leher."""
    cyl(m, 'atlas_goods', x, y, z, rad, rad, h * 0.72, sg, caps=False, cell=cell, front='+y')
    lathe(m, 'atlas_goods', [(rad, h * 0.72), (rad * 0.4, h * 0.88), (rad * 0.32, h), (0.0, h)], sg, M=T(x, y, z), cell=cell, front='+y')


def goods(m, x0, x1, y_back, y_front, z, hmax, rng, lod, mix='grocery', two_sided=False):
    """Barang dagangan di satu tingkat rak (satu baris muka; barang di belakangnya tidak terlihat): kotak, botol,
    bungkus; label dari atlas (diacak per instans oleh game)."""
    depth = y_front - y_back
    if lod > 0:
        cell = {'grocery': 0, 'drinks': 1, 'household': 2, 'snack': 3, 'toko': 4, 'shoes': 5}.get(mix, 0)
        box(m, 'atlas_rows', ((x0 + x1) / 2, (y_back + y_front) / 2, z + hmax * 0.42), (x1 - x0, depth * 0.85, hmax * 0.84), cell=cell, front='-y' if two_sided else '+y')
        return
    x = x0 + 0.01
    while x < x1 - 0.04:
        r = rng.random()
        if mix == 'drinks' or (mix in ('grocery', 'household') and r < 0.3):
            rad = rng.choice((0.032, 0.036, 0.042))
            h = min(hmax, rng.uniform(0.2, 0.3))
            if x + rad * 2 > x1:
                break
            cell = rng.randrange(N_GOODS)
            bottle(m, x + rad, y_front - rad - 0.01, z, rad, h, cell)
            x += rad * 2 + 0.008
        elif mix == 'snack' or (r < 0.55 and mix != 'household'):
            w = rng.uniform(0.12, 0.18)
            h = min(hmax, rng.uniform(0.18, 0.26))
            if x + w > x1:
                break
            cell = rng.randrange(N_GOODS)
            m.add(bm_superbox(w, 0.08, h, ep=0.35, ev=0.55, nu=8, nv=4), 'atlas_goods', T(x + w / 2, y_front - 0.05, z + h / 2), True, cell=cell, front='+y')
            x += w + 0.01
        else:
            w = rng.uniform(0.06, 0.16)
            h = min(hmax, rng.uniform(0.12, 0.3))
            d = min(depth - 0.02, rng.uniform(0.12, 0.3))
            if x + w > x1:
                break
            cell = rng.randrange(N_GOODS)
            box(m, 'atlas_goods', (x + w / 2, y_front - d / 2 - 0.005, z + h / 2), (w * 0.97, d, h), cell=cell, front='+y')
            x += w + 0.006
    return


def pot_plant_soil(m, r_top, z, lod):
    cyl(m, 'soil', 0, 0, z - 0.03, r_top * 0.95, r_top * 0.95, 0.03, 12 if lod == 0 else 6, smooth=False)


def leaf_blade(m, mat, base, d, length, width, curl=0.25, segs=6, twist=0.0, lod=0, two=True, mid=0.45):
    """Daun pipih melengkung dari base ke arah d (Vector), lebar maks di 'mid'; dua sisi."""
    d = Vector(d).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    upv = side.cross(d).normalized()
    n = segs if lod == 0 else max(2, segs // 2)
    rows = []
    for i in range(n + 1):
        t = i / n
        wdt = width * (math.sin(pi * min(1.0, t / (2 * mid))) if t < mid else math.cos(pi / 2 * (t - mid) / (1 - mid))) if t < 1 else 0.0
        wdt = max(0.0, wdt)
        p = Vector(base) + d * (length * t) - upv * (curl * length * t * t)
        sd = side * math.cos(twist * t) + upv * math.sin(twist * t)
        rows.append((p - sd * wdt / 2, p + p * 0 + Vector((0, 0, 0.004 * (1 - t))), p + sd * wdt / 2))
    bm = bmesh.new()
    V = [[bm.verts.new(r[0]), bm.verts.new(r[1]), bm.verts.new(r[2])] for r in rows]
    for i in range(n):
        a, b = V[i], V[i + 1]
        for (p, q) in ((0, 1), (1, 2)):
            try:
                bm.faces.new((a[p], a[q], b[q], b[p]))
            except ValueError:
                pass
    if two:
        bm2 = bm.copy()
        for f in bm2.faces:
            f.normal_flip()
        m.add(bm2, mat, None, True)
    m.add(bm, mat, None, True)


# ---------------------------------------------------------------- model
MODELS = {}


def model(name, kind, size, ctx=('house',), lods=(0, 1), ao=0.5, wall='-y', slice_=None, tile=None, group=None):
    def deco(fn):
        MODELS[name] = dict(fn=fn, kind=kind, size=size, ctx=list(ctx), lods=lods, ao=ao, wall=wall, slice=slice_, tile=tile, group=group)
        return fn
    return deco


# ================================================================ RUANG TAMU
# ---------- sofa kain modern 3 dudukan (kaki kayu, bantal dudukan & sandaran, dua bantal hias)
@model('sofa_fabric', 'sofa', (2.0, 0.85, 0.82), ctx=('house',), ao=0.45, group='living')
def m_sofa_fabric(lod):
    m = Mesh()
    w, d, h = 2.0, 0.85, 0.82
    rng = random.Random(11)
    # kaki kayu runcing
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = Vector((sx * (w / 2 - 0.09), sy * (d / 2 - 0.09), 0))
            tube(m, 'wood_oak', a, a + Vector((sx * 0.012, sy * 0.012, 0.13)), 0.016, 8 if lod == 0 else 5, caps=True, r2=0.022)
    bev = 0.035 if lod == 0 else 0.0
    box(m, 'tfab_main', (0, 0, 0.27), (w, d, 0.26), bevel=bev, seg=3 if lod == 0 else 1)  # badan
    box(m, 'tfab_main', (0, -d / 2 + 0.09, 0.56), (w - 0.02, 0.18, 0.36), bevel=bev, seg=3 if lod == 0 else 1)  # sandaran rangka
    for s in (-1, 1):  # lengan
        cushion(m, 'tfab_main', (s * (w / 2 - 0.1), 0.0, 0.5), (0.2, d, 0.3), ep=0.22, ev=0.5, lod=lod)
    iw = (w - 0.4) / 3
    for k in range(3):
        x = -w / 2 + 0.2 + iw * (k + 0.5)
        cushion(m, 'tfab_main', (x, 0.07, 0.465), (iw - 0.01, d - 0.16, 0.15), ep=0.14, ev=0.32, lod=lod)  # dudukan
        cushion(m, 'tfab_main', (0, 0, 0), (iw - 0.02, 0.2, 0.38), ep=0.16, ev=0.42, lod=lod, M=T(x, -d / 2 + 0.24, 0.63) @ Rx(-9))
    # bantal hias miring di dekat lengan
    for s, ang in ((-1, 14), (1, -11)):
        M = T(s * (w / 2 - 0.36), -d / 2 + 0.36, 0.68) @ Rz(ang) @ Rx(-16)
        cushion(m, 'tfab_acc', (0, 0, 0), (0.42, 0.13, 0.4), ep=0.35, ev=0.45, lod=lod, M=M)
    if lod == 0:  # kelim/jahitan bawah: alur gelap tipis
        box(m, 'fab_dark', (0, d / 2 - 0.001, 0.145), (w - 0.06, 0.004, 0.01))
    m.px((0, 0.0, 0.27), (w, d, 0.26), 'tfab_main', 1)
    m.px((0, -d / 2 + 0.12, 0.6), (w, 0.24, 0.44), 'tfab_main', 1)
    m.px((0, 0.07, 0.46), (w - 0.4, d - 0.16, 0.14), 'tfab_main', 1)
    for s in (-1, 1):
        m.px((s * (w / 2 - 0.1), 0, 0.5), (0.2, d, 0.3), 'tfab_main', 1)
    return m, {}


# ---------- kursi tamu jati (rangka kayu jati berukir, jok bermotif)
@model('sofa_jati', 'sofa', (2.0, 0.85, 0.82), ctx=('house',), ao=0.45, group='living')
def m_sofa_jati(lod):
    m = Mesh()
    w, d = 2.0, 0.85
    sg = 10 if lod == 0 else 6
    turned = [(0.032, 0.0), (0.036, 0.04), (0.026, 0.08), (0.03, 0.2), (0.024, 0.32), (0.03, 0.4), (0.03, 0.42)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - 0.05), sy * (d / 2 - 0.06)
            if lod == 0:
                lathe(m, 'wood_teak', turned, sg, M=T(x, y, 0), cap_top=True)
            else:
                cyl(m, 'wood_teak', x, y, 0, 0.03, 0.03, 0.42, sg)
    # rangka dudukan (palang keliling)
    box(m, 'wood_teak', (0, d / 2 - 0.06, 0.37), (w - 0.06, 0.05, 0.1), bevel=0.008 if lod == 0 else 0)
    box(m, 'wood_teak', (0, -d / 2 + 0.06, 0.37), (w - 0.06, 0.05, 0.1), bevel=0.008 if lod == 0 else 0)
    for s in (-1, 1):
        box(m, 'wood_teak', (s * (w / 2 - 0.05), 0, 0.37), (0.05, d - 0.1, 0.1), bevel=0.008 if lod == 0 else 0)
    # lengan: tiang depan + papan sandaran tangan bergulung di depan
    for s in (-1, 1):
        x = s * (w / 2 - 0.05)
        if lod == 0:
            lathe(m, 'wood_teak', [(0.024, 0.42), (0.03, 0.46), (0.02, 0.52), (0.026, 0.6), (0.026, 0.64)], sg, M=T(x, d / 2 - 0.06, 0))
            for k in range(4):  # jeruji lengan
                y = d / 2 - 0.2 - k * 0.13
                cyl(m, 'wood_teak', x, y, 0.42, 0.012, 0.012, 0.22, 8)
        box(m, 'wood_teak', (x, 0.0, 0.655), (0.09, d - 0.02, 0.035), bevel=0.012 if lod == 0 else 0, seg=2)
        if lod == 0:
            tube(m, 'wood_teak', (x - 0.045, d / 2 - 0.02, 0.645), (x + 0.045, d / 2 - 0.02, 0.645), 0.024, 10, caps=True)
    # sandaran: dua tiang belakang, palang atas melengkung, panel ukir
    for s in (-1, 1):
        box(m, 'wood_teak', (s * (w / 2 - 0.05), -d / 2 + 0.06, 0.62), (0.06, 0.05, 0.4), bevel=0.006 if lod == 0 else 0)
    n = 9 if lod == 0 else 3
    pts = []
    for i in range(n + 1):
        t = i / n
        x = -w / 2 + 0.05 + (w - 0.1) * t
        pts.append((x, 0.8 + 0.025 * math.sin(pi * t)))
    for i in range(n):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        box(m, 'wood_teak', ((x0 + x1) / 2, -d / 2 + 0.06, (z0 + z1) / 2 - 0.015), (x1 - x0 + 0.002, 0.05, 0.05))
    box(m, 'wood_teak', (0, -d / 2 + 0.065, 0.66), (w - 0.14, 0.025, 0.24))  # panel
    if lod == 0:  # ukiran: bingkai timbul + motif bunga (bulatan pipih) di tengah panel
        for z in (0.55, 0.77):
            box(m, 'wood_teak', (0, -d / 2 + 0.082, z), (w - 0.2, 0.012, 0.018), bevel=0.004)
        for k in range(5):
            x = (k - 2) * 0.34
            cyl(m, 'wood_teak', 0, 0, 0, 0.06, 0.05, 0.016, 12, M=T(x, -d / 2 + 0.077, 0.66) @ Rx(-90))
            for j in range(6):
                a = j * pi / 3
                cyl(m, 'wood_teak', 0, 0, 0, 0.022, 0.016, 0.012, 8, M=T(x + math.cos(a) * 0.075, -d / 2 + 0.08, 0.66 + math.sin(a) * 0.075) @ Rx(-90))
    # jok bermotif + sandaran jok
    cushion(m, 'atlas_tpat', (0, 0.02, 0.475), (w - 0.14, d - 0.16, 0.11), ep=0.12, ev=0.3, lod=lod, uvfn=pat_uv(0.25))
    cushion(m, 'atlas_tpat', (0, -d / 2 + 0.15, 0.64), (w - 0.2, 0.1, 0.26), ep=0.14, ev=0.4, lod=lod, M=None, uvfn=pat_uv(0.25))
    for s, ang in ((-1, 12), (1, -9)):
        cushion(m, 'tfab_acc', (0, 0, 0), (0.4, 0.12, 0.38), ep=0.35, ev=0.45, lod=lod, M=T(s * (w / 2 - 0.34), -d / 2 + 0.3, 0.66) @ Rz(ang) @ Rx(-14))
    m.px((0, 0, 0.21), (w, d, 0.42), 'wood_teak')
    m.px((0, 0.02, 0.475), (w - 0.14, d - 0.16, 0.11), 'fab_beige', 1)
    m.px((0, -d / 2 + 0.07, 0.62), (w, 0.1, 0.4), 'wood_teak')
    return m, {}


def pat_uv(scale):
    """UV motif kain (atlas_tpat): proyeksi kotak, satu ulangan motif tiap 'scale' m (sel 0, diacak game)."""
    def f(face, co):
        n = face.normal
        k = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][k]
        return (co[a] / scale, co[b] / scale)
    return f


# ---------- sofa kulit modern (lobi & rumah besar): lengan kotak, kaki krom
@model('sofa_leather', 'sofa', (2.0, 0.85, 0.82), ctx=('tower', 'house'), ao=0.45, group='living')
def m_sofa_leather(lod):
    m = Mesh()
    w, d = 2.0, 0.85
    for sx in (-1, 1):  # kaki krom silinder pendek
        for sy in (-1, 1):
            cyl(m, 'chrome', sx * (w / 2 - 0.12), sy * (d / 2 - 0.12), 0, 0.022, 0.026, 0.1, 10 if lod == 0 else 5)
    bev = 0.03 if lod == 0 else 0
    box(m, 'tleather', (0, 0, 0.23), (w, d, 0.26), bevel=bev, seg=3 if lod == 0 else 1)
    box(m, 'tleather', (0, -d / 2 + 0.1, 0.58), (w, 0.2, 0.44), bevel=bev, seg=3 if lod == 0 else 1)
    for s in (-1, 1):
        box(m, 'tleather', (s * (w / 2 - 0.09), 0.0, 0.45), (0.18, d, 0.2), bevel=bev, seg=3 if lod == 0 else 1)
    iw = (w - 0.36) / 2
    for k in range(2):
        x = -w / 2 + 0.18 + iw * (k + 0.5)
        cushion(m, 'tleather', (x, 0.06, 0.43), (iw - 0.01, d - 0.2, 0.14), ep=0.1, ev=0.3, lod=lod)
        cushion(m, 'tleather', (x, -d / 2 + 0.25, 0.6), (iw - 0.02, 0.14, 0.34), ep=0.12, ev=0.35, lod=lod)
        if lod == 0:  # kancing jok (tufting)
            for j in range(3):
                for i in range(2):
                    cyl(m, 'leather_black', 0, 0, 0, 0.012, 0.012, 0.01, 6, M=T(x + (j - 1) * iw * 0.28, -d / 2 + 0.32, 0.5 + i * 0.16) @ Rx(-90))
    m.px((0, 0, 0.23), (w, d, 0.32), 'tleather', 1)
    m.px((0, -d / 2 + 0.1, 0.58), (w, 0.2, 0.44), 'tleather', 1)
    for s in (-1, 1):
        m.px((s * (w / 2 - 0.09), 0, 0.45), (0.18, d, 0.2), 'tleather', 1)
    return m, {}


# ---------- meja TV kayu (laci, rak tengah terbuka berisi dekoder) + TV 50" di atas kaki dudukan
def tv_set(m, lod, rng, z_top, stand='ped'):
    """TV layar datar 1,12 × 0,65 m di atas meja (alas z_top), muka layar +y."""
    W, H, Dp = 1.12, 0.65, 0.045
    z0 = z_top + 0.07
    if stand == 'ped':
        box(m, 'metal_black', (0, -0.03, z_top + 0.006), (0.36, 0.22, 0.012), bevel=0.004 if lod == 0 else 0)
        box(m, 'metal_black', (0, -0.045, z_top + 0.06), (0.06, 0.03, 0.11))
    else:
        for s in (-1, 1):
            box(m, 'metal_black', (s * 0.42, -0.02, z_top + 0.035), (0.04, 0.2, 0.07))
    box(m, 'plastic_black', (0, -0.04, z0 + H / 2), (W, Dp, H), bevel=0.006 if lod == 0 else 0)
    box(m, 'plastic_black', (0, -0.075, z0 + H * 0.45), (W * 0.6, 0.03, H * 0.5))  # punggung tebal
    # layar (sel misc 'tv'; game menyalakan sebagian TV)
    quad(m, 'atlas_misc', [(-W / 2 + 0.008, -0.04 + Dp / 2 + 0.001, z0 + 0.012), (W / 2 - 0.008, -0.04 + Dp / 2 + 0.001, z0 + 0.012),
                           (W / 2 - 0.008, -0.04 + Dp / 2 + 0.001, z0 + H - 0.008), (-W / 2 + 0.008, -0.04 + Dp / 2 + 0.001, z0 + H - 0.008)],
         uvs=[(MISC['tv'] + 0.001, 0.001), (MISC['tv'] + 0.999, 0.001), (MISC['tv'] + 0.999, 0.999), (MISC['tv'] + 0.001, 0.999)])
    m.px((0, -0.05, z0 + H / 2), (W, 0.06, H), 'plastic_black', 0, 100 + MISC['tv'])


@model('tv_wood', 'tv', (1.6, 0.45, 0.55), ctx=('house',), ao=0.5, group='living')
def m_tv_wood(lod):
    m = Mesh()
    w, d, h = 1.6, 0.45, 0.55
    rng = random.Random(21)
    bev = 0.008 if lod == 0 else 0
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = Vector((sx * (w / 2 - 0.07), sy * (d / 2 - 0.07), 0))
            tube(m, 'wood_walnut', a, a + Vector((0, 0, 0.13)), 0.014, 8 if lod == 0 else 4, caps=True, r2=0.02)
    z0, z1 = 0.13, h
    box(m, 'wood_walnut', (0, 0, z1 - 0.012), (w, d, 0.024), bevel=bev)  # atas
    box(m, 'wood_walnut', (0, 0, z0 + 0.012), (w, d, 0.024), bevel=bev)  # bawah
    for x in (-w / 2 + 0.012, w / 2 - 0.012, -0.29, 0.29):  # sisi & sekat
        box(m, 'wood_walnut', (x, 0, (z0 + z1) / 2), (0.024, d, z1 - z0 - 0.048))
    box(m, 'wood_walnut', (0, -d / 2 + 0.006, (z0 + z1) / 2), (w - 0.04, 0.012, z1 - z0 - 0.04))  # punggung
    # kiri: dua laci; kanan: pintu berkisi; tengah: rak terbuka (dekoder + router)
    fz0, fz1 = z0 + 0.026, z1 - 0.026
    hz = (fz1 - fz0) / 2
    for k in range(2):
        zc = fz0 + hz * (k + 0.5)
        box(m, 'wood_oak', (-0.545, d / 2 - 0.009, zc), (0.49, 0.018, hz - 0.008), bevel=0.003 if lod == 0 else 0)
        handle(m, 'brass', -0.545, d / 2, zc, 0.16, 'x', lod, out=0.02)
    box(m, 'wood_oak', (0.545, d / 2 - 0.009, (fz0 + fz1) / 2), (0.49, 0.018, fz1 - fz0 - 0.008), bevel=0.003 if lod == 0 else 0)
    if lod == 0:
        for k in range(9):  # kisi vertikal
            box(m, 'wood_walnut', (0.33 + k * 0.054, d / 2 + 0.002, (fz0 + fz1) / 2), (0.014, 0.006, fz1 - fz0 - 0.06))
    handle(m, 'brass', 0.33, d / 2, (fz0 + fz1) / 2, 0.12, 'z', lod, out=0.02)
    box(m, 'wood_walnut', (0, 0, (fz0 + fz1) / 2), (0.56, d - 0.03, 0.018))  # rak tengah
    box(m, 'plastic_black', (-0.08, 0.02, fz0 + 0.025), (0.26, 0.2, 0.045), bevel=0.004 if lod == 0 else 0)  # dekoder
    if lod == 0:
        cyl(m, 'emit_red', -0.0, 0.122, fz0 + 0.03, 0.003, 0.003, 0.002, 6, M=T(0, 0, 0))
        box(m, 'plastic_white', (0.17, 0.0, (fz0 + fz1) / 2 + 0.03), (0.16, 0.12, 0.035), bevel=0.006)  # router
        for s in (-1, 1):
            tube(m, 'plastic_white', (0.17 + s * 0.06, -0.05, (fz0 + fz1) / 2 + 0.045), (0.17 + s * 0.07, -0.06, (fz0 + fz1) / 2 + 0.17), 0.004, 5)
    tv_set(m, lod, rng, h)
    box(m, 'plastic_black', (0, 0.12, h + 0.035), (0.78, 0.08, 0.07), bevel=0.012 if lod == 0 else 0, seg=2)  # soundbar
    if lod == 0:
        lathe(m, 'ceramic_blue', [(0.0, h), (0.05, h), (0.07, h + 0.06), (0.06, h + 0.14), (0.03, h + 0.2), (0.032, h + 0.24)], 14, M=T(0.66, 0.02, 0))
        books(m, -0.74, -0.56, -0.08, h, 0.2, rng, lod, lean=False, hmin=0.18, hmax=0.22)
    m.px((0, 0, (z0 + z1) / 2), (w, d, z1 - z0), 'wood_walnut')
    m.px((0, 0, z0 / 2), (w - 0.1, d - 0.1, z0), 'wood_walnut')
    return m, {}


@model('tv_white', 'tv', (1.6, 0.45, 0.55), ctx=('house',), ao=0.5, group='living')
def m_tv_white(lod):
    m = Mesh()
    w, d, h = 1.6, 0.45, 0.55
    rng = random.Random(22)
    for sx in (-1, 1):  # kaki logam tipis
        for sy in (-1, 1):
            box(m, 'metal_black', (sx * (w / 2 - 0.06), sy * (d / 2 - 0.05), 0.09), (0.025, 0.025, 0.18))
    z0 = 0.18
    box(m, 'wood_white', (0, 0, (z0 + h) / 2), (w, d, h - z0), bevel=0.012 if lod == 0 else 0, seg=2)
    # dua pintu lipat bergaris kayu
    for s in (-1, 1):
        x = s * w / 4
        box(m, 'wood_oak', (x, d / 2 + 0.004, (z0 + h) / 2), (w / 2 - 0.03, 0.01, h - z0 - 0.05), bevel=0.003 if lod == 0 else 0)
        if lod == 0:
            for k in range(7):
                box(m, 'wood_walnut', (x - w / 4 + 0.1 + k * 0.1, d / 2 + 0.01, (z0 + h) / 2), (0.012, 0.004, h - z0 - 0.08))
    tv_set(m, lod, rng, h, stand='feet')
    if lod == 0:
        lathe(m, 'pot_white', [(0.0, h), (0.06, h), (0.07, h + 0.09), (0.065, h + 0.11)], 14, M=T(-0.68, 0.05, 0))
        pot_plant_soil(m, 0.062, h + 0.11, lod)
        for k in range(9):  # sukulen kecil
            a = k * 2.4
            leaf_blade(m, 'leaf_mid', (-0.68, 0.05, h + 0.1), (math.cos(a) * 0.6, math.sin(a) * 0.6, 0.8), 0.12, 0.035, curl=-0.1, segs=3, lod=lod)
        books(m, 0.56, 0.74, -0.06, h, 0.2, rng, lod, lean=False, hmin=0.14, hmax=0.2)
        box(m, 'plastic_black', (0.0, 0.14, h + 0.02), (0.18, 0.05, 0.04), bevel=0.01, seg=2)  # pengeras suara kecil
    m.px((0, 0, (z0 + h) / 2), (w, d, h - z0), 'wood_white')
    return m, {}


# ---------- meja tamu
@model('coffee_wood', 'coffee', (1.0, 0.55, 0.42), ctx=('house', 'tower'), ao=0.4, wall=None, group='living')
def m_coffee_wood(lod):
    m = Mesh()
    w, d, h = 1.0, 0.55, 0.42
    rng = random.Random(31)
    box(m, 'wood_oak', (0, 0, h - 0.02), (w, d, 0.04), bevel=0.012 if lod == 0 else 0, seg=2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = Vector((sx * (w / 2 - 0.07), sy * (d / 2 - 0.07), 0))
            tube(m, 'wood_oak', a + Vector((sx * 0.02, sy * 0.02, 0)), a + Vector((0, 0, h - 0.04)), 0.014, 8 if lod == 0 else 4, caps=True, r2=0.022)
    box(m, 'wood_oak', (0, 0, 0.13), (w - 0.12, d - 0.12, 0.018))  # rak bawah
    if lod == 0:
        for k, cell in enumerate((MISC['mag_a'], MISC['mag_b'])):
            M = T(-0.18 + k * 0.05, 0.02 - k * 0.03, 0.139 + k * 0.006) @ Rz(8 - k * 14)
            box(m, 'atlas_misc', (0, 0, 0.003), (0.21, 0.28, 0.006), M=M, cell=cell, front='+z')
        # mangkuk buah
        lathe(m, 'ceramic', [(0.0, h), (0.07, h), (0.13, h + 0.05), (0.14, h + 0.07), (0.128, h + 0.07), (0.06, h + 0.012)], 18, M=T(0.18, 0.0, 0))
        for k, mat in enumerate(('food_orange', 'food_red', 'food_yellow', 'food_green', 'food_orange')):
            a = k * 1.3
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.038)
            m.add(bm, mat, T(0.18 + math.cos(a) * 0.055 * (k > 0), math.sin(a) * 0.055 * (k > 0), h + 0.06 + 0.02 * (k == 0)), True)
        box(m, 'plastic_black', (-0.28, -0.08, h + 0.008), (0.05, 0.17, 0.016), bevel=0.006, seg=2)  # remote
    m.px((0, 0, h / 2), (w, d, h), 'wood_oak')
    return m, {}


@model('coffee_glass', 'coffee', (1.0, 0.55, 0.42), ctx=('tower', 'house'), ao=0.4, wall=None, group='living')
def m_coffee_glass(lod):
    m = Mesh()
    w, d, h = 1.0, 0.55, 0.42
    t = 0.025
    for sy in (-1, 1):  # rangka logam hitam: dua bingkai U terbalik
        for sx in (-1, 1):
            box(m, 'metal_black', (sx * (w / 2 - t / 2), sy * (d / 2 - t / 2), (h - 0.012) / 2), (t, t, h - 0.012))
        box(m, 'metal_black', (0, sy * (d / 2 - t / 2), h - 0.012 - t / 2), (w, t, t))
        box(m, 'metal_black', (0, sy * (d / 2 - t / 2), 0.1), (w - 2 * t, t, t))
    for sx in (-1, 1):
        box(m, 'metal_black', (sx * (w / 2 - t / 2), 0, h - 0.012 - t / 2), (t, d - 2 * t, t))
    box(m, 'wood_walnut', (0, 0, 0.125), (w - 0.06, d - 0.06, 0.02), bevel=0.004 if lod == 0 else 0)  # rak kayu
    box(m, 'glass_tint', (0, 0, h - 0.006), (w + 0.02, d + 0.02, 0.012))  # kaca atas
    if lod == 0:
        lathe(m, 'ceramic', [(0.0, h), (0.045, h), (0.06, h + 0.08), (0.04, h + 0.18), (0.025, h + 0.22), (0.028, h + 0.24)], 14, M=T(-0.25, 0.03, 0))
        for k in range(5):  # bunga: tangkai + kepala
            a = k * 1.25
            tip = Vector((-0.25 + math.cos(a) * 0.07, 0.03 + math.sin(a) * 0.07, h + 0.4 + 0.03 * (k % 2)))
            tube(m, 'stem', (-0.25, 0.03, h + 0.2), tip, 0.003, 4)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=0.03)
            m.add(bm, 'plastic_pink' if k % 2 else 'paint_white', T(*tip), True)
        box(m, 'atlas_books', (0.22, -0.02, h + 0.02), (0.26, 0.2, 0.025), cell=5, front='+y')
        box(m, 'atlas_books', (0.23, -0.02, h + 0.045), (0.22, 0.17, 0.025), cell=17, front='+y')
    m.px((0, 0, h - 0.01), (w, d, 0.02), 'glass_tint')
    m.px((0, 0, 0.125), (w, d, 0.02), 'wood_walnut')
    return m, {}


# ---------- rak buku terbuka
@model('shelf_books', 'shelf', (1.0, 0.36, 1.8), ctx=('house',), ao=0.55, group='living')
def m_shelf_books(lod):
    m = Mesh()
    w, d, h = 1.0, 0.36, 1.8
    rng = random.Random(41)
    t = 0.022
    bev = 0.004 if lod == 0 else 0
    for x in (-w / 2 + t / 2, w / 2 - t / 2):
        box(m, 'wood_light', (x, 0, h / 2), (t, d, h), bevel=bev)
    box(m, 'wood_light', (0, 0, h - t / 2), (w, d, t), bevel=bev)
    box(m, 'wood_light', (0, 0.01, 0.05), (w - 2 * t, d - 0.02, 0.1))  # plint
    box(m, 'wood_light', (0, -d / 2 + 0.005, h / 2), (w - 2 * t, 0.01, h - 0.02))  # punggung
    zs = [0.1, 0.44, 0.78, 1.12, 1.46]
    for z in zs[1:]:
        box(m, 'wood_light', (0, 0.0, z - t / 2), (w - 2 * t, d - 0.02, t), bevel=bev)
    xi0, xi1 = -w / 2 + t, w / 2 - t
    # isi tiap tingkat: buku, keranjang, foto, vas
    books(m, xi0 + 0.01, xi1 - 0.02, -d / 2 + 0.02, zs[0], d - 0.04, rng, lod, hmin=0.22, hmax=0.3)
    books(m, xi0 + 0.01, xi0 + 0.62, -d / 2 + 0.02, zs[1], d - 0.04, rng, lod)
    if lod == 0:
        lathe(m, 'ceramic_blue', [(0.0, zs[1]), (0.05, zs[1]), (0.07, zs[1] + 0.08), (0.05, zs[1] + 0.2), (0.03, zs[1] + 0.25)], 14, M=T(xi1 - 0.14, 0.0, 0))
        books(m, xi0 + 0.3, xi1 - 0.02, -d / 2 + 0.02, zs[2], d - 0.04, rng, lod)
        # keranjang anyaman + bingkai foto
        box(m, 'fab_rattan', (xi0 + 0.14, 0.02, zs[2] + 0.1), (0.24, 0.26, 0.2), bevel=0.012, seg=2)
        box(m, 'wood_dark', (-0.05, 0.02, zs[3] + 0.11), (0.2, 0.015, 0.22), M=None)
        quad(m, 'atlas_misc', [(-0.13, 0.029, zs[3] + 0.02), (0.03, 0.029, zs[3] + 0.02), (0.03, 0.029, zs[3] + 0.2), (-0.13, 0.029, zs[3] + 0.2)],
             uvs=[(MISC['art'] + 0.05, 0.05), (MISC['art'] + 0.95, 0.05), (MISC['art'] + 0.95, 0.95), (MISC['art'] + 0.05, 0.95)])
        box(m, 'wood_dark', (-0.05, 0.0, zs[3] + 0.04), (0.06, 0.04, 0.012), M=Rx(0))
        books(m, xi0 + 0.01, xi0 + 0.3, -d / 2 + 0.02, zs[3], d - 0.04, rng, lod)
        books(m, 0.15, xi1 - 0.02, -d / 2 + 0.02, zs[4], d - 0.04, rng, lod, hmin=0.16, hmax=0.24)
        lathe(m, 'pot_white', [(0.0, zs[4]), (0.06, zs[4]), (0.07, zs[4] + 0.1), (0.065, zs[4] + 0.12)], 14, M=T(xi0 + 0.16, 0.0, 0))
        pot_plant_soil(m, 0.062, zs[4] + 0.12, lod)
        for k in range(12):  # tanaman menjuntai
            a = k * 0.55
            leaf_blade(m, 'leaf_mid', (xi0 + 0.16, 0.0, zs[4] + 0.11), (math.cos(a) * 0.9, math.sin(a) * 0.9 + 0.2, -0.3 - 0.4 * (k % 3) / 2), 0.16 + 0.05 * (k % 3), 0.05, curl=0.1, segs=3, lod=lod)
    else:
        books(m, xi0 + 0.3, xi1 - 0.02, -d / 2 + 0.02, zs[2], d - 0.04, rng, lod)
        books(m, xi0 + 0.01, xi0 + 0.3, -d / 2 + 0.02, zs[3], d - 0.04, rng, lod)
        books(m, 0.15, xi1 - 0.02, -d / 2 + 0.02, zs[4], d - 0.04, rng, lod)
    m.px((0, 0, h / 2), (w, d, h), 'wood_light', 0, 7)
    return m, {}


# ---------- lemari hias (bawah pintu kayu, atas pintu kaca berisi piring, cangkir, piala)
@model('shelf_hias', 'shelf', (1.0, 0.36, 1.8), ctx=('house',), ao=0.55, group='living')
def m_shelf_hias(lod):
    m = Mesh()
    w, d, h = 1.0, 0.36, 1.8
    rng = random.Random(42)
    bev = 0.005 if lod == 0 else 0
    box(m, 'wood_teak', (0, 0, 0.04), (w - 0.04, d - 0.04, 0.08))  # plint
    box(m, 'wood_teak', (0, 0, 0.42), (w, d, 0.68), bevel=bev)  # badan bawah
    for s in (-1, 1):  # pintu bawah berpanel
        x = s * w / 4
        box(m, 'wood_teak', (x, d / 2 + 0.006, 0.42), (w / 2 - 0.02, 0.012, 0.62), bevel=bev)
        if lod == 0:
            box(m, 'wood_teak', (x, d / 2 + 0.014, 0.42), (w / 2 - 0.12, 0.008, 0.5), bevel=0.006, seg=2)
        knob(m, 'brass', x - s * (w / 4 - 0.05), d / 2 + 0.012, 0.6, lod=lod)
    z0, z1 = 0.76, h - 0.06
    box(m, 'wood_teak', (0, 0, 0.77), (w + 0.02, d + 0.02, 0.025), bevel=bev)
    for x in (-w / 2 + 0.02, w / 2 - 0.02):
        box(m, 'wood_teak', (x, 0, (z0 + z1) / 2), (0.04, d, z1 - z0))
    box(m, 'wood_teak', (0, -d / 2 + 0.01, (z0 + z1) / 2), (w - 0.04, 0.02, z1 - z0))
    box(m, 'wood_teak', (0, 0, h - 0.045), (w + 0.04, d + 0.03, 0.05), bevel=0.01 if lod == 0 else 0, seg=2)  # mahkota
    box(m, 'wood_teak', (0, 0, h - 0.01), (w + 0.06, d + 0.04, 0.02))
    for z in (1.12, 1.46):  # rak kaca
        box(m, 'glass_clear', (0, 0.0, z), (w - 0.08, d - 0.06, 0.008))
    # pintu kaca berbingkai
    for s in (-1, 1):
        x = s * w / 4
        for zz in (z0 + 0.02, z1 - 0.02):
            box(m, 'wood_teak', (x, d / 2 - 0.012, zz), (w / 2 - 0.01, 0.024, 0.04))
        for xx in (x - w / 4 + 0.025, x + w / 4 - 0.025):
            box(m, 'wood_teak', (xx, d / 2 - 0.012, (z0 + z1) / 2), (0.045, 0.024, z1 - z0))
        box(m, 'glass_clear', (x, d / 2 - 0.012, (z0 + z1) / 2), (w / 2 - 0.08, 0.006, z1 - z0 - 0.06))
        knob(m, 'brass', x - s * (w / 4 - 0.05), d / 2, 1.1, lod=lod)
    if lod == 0:  # isi: piring berdiri, cangkir, piala, figur
        for k in range(4):
            x = -0.36 + k * 0.24
            M = T(x, -0.08, 0.79 + 0.11) @ Rx(-78)
            lathe(m, 'ceramic' if k % 2 else 'ceramic_blue', [(0.0, 0.0), (0.1, 0.0), (0.11, 0.012), (0.0, 0.006)], 18, M=M, cap_top=False)
            box(m, 'wood_dark', (x, -0.05, 0.795), (0.06, 0.06, 0.01))
        for k in range(5):
            x = -0.34 + k * 0.17
            lathe(m, 'ceramic', [(0.0, 1.13), (0.025, 1.13), (0.035, 1.2), (0.032, 1.2)], 12, M=T(x, 0.03, 0))
        for k in range(3):
            x = -0.25 + k * 0.25
            lathe(m, 'gold', [(0.0, 1.47), (0.04, 1.47), (0.035, 1.49), (0.012, 1.5), (0.012, 1.58), (0.04, 1.62), (0.05, 1.7), (0.0, 1.69)], 12, M=T(x, 0.0, 0))
    m.px((0, 0, 0.42), (w, d, 0.76), 'wood_teak')
    m.px((0, 0, 1.28), (w, d, 1.04), 'wood_teak')
    return m, {}


# ---------- tanaman pot
def pot(m, mat, r, h, lod, rim=True):
    sg = 16 if lod == 0 else 8
    prof = [(0.0, 0.0), (r * 0.78, 0.0), (r * 0.86, 0.02), (r, h * 0.92)]
    if rim:
        prof += [(r * 1.06, h * 0.93), (r * 1.06, h), (r * 0.96, h)]
    else:
        prof += [(r, h), (r * 0.94, h)]
    lathe(m, mat, prof, sg)
    pot_plant_soil(m, r * 0.94, h - 0.02, lod)


@model('plant_monstera', 'plant', (0.45, 0.45, 1.1), ctx=('house', 'tower'), ao=0.35, wall=None, group='living')
def m_plant_monstera(lod):
    m = Mesh()
    rng = random.Random(51)
    pot(m, 'pot_white', 0.17, 0.36, lod)
    n = 11 if lod == 0 else 6
    for k in range(n):
        a = k * 2.399 + rng.uniform(-0.2, 0.2)
        L = rng.uniform(0.35, 0.6)
        tip = Vector((math.cos(a) * L * 0.55, math.sin(a) * L * 0.55, 0.36 + L * 0.95 + rng.uniform(0, 0.12)))
        base = Vector((math.cos(a) * 0.02, math.sin(a) * 0.02, 0.34))
        tube(m, 'stem', base, tip, 0.006, 5 if lod == 0 else 3)
        dirv = Vector((math.cos(a), math.sin(a), rng.uniform(-0.1, 0.35)))
        leaf_blade(m, 'leaf_dark' if k % 3 else 'leaf_mid', tip, dirv, rng.uniform(0.24, 0.32), rng.uniform(0.22, 0.28), curl=0.35, segs=6, twist=rng.uniform(-0.4, 0.4), lod=lod, mid=0.42)
    m.px((0, 0, 0.18), (0.32, 0.32, 0.36), 'pot_white')
    m.px((0, 0, 0.75), (0.5, 0.5, 0.65), 'leaf_dark')
    return m, {}


@model('plant_snake', 'plant', (0.45, 0.45, 1.1), ctx=('house',), ao=0.35, wall=None, group='living')
def m_plant_snake(lod):
    m = Mesh()
    rng = random.Random(52)
    sg = 14 if lod == 0 else 7
    lathe(m, 'pot_dark', [(0.0, 0.0), (0.15, 0.0), (0.17, 0.05), (0.17, 0.34), (0.16, 0.34)], sg)
    pot_plant_soil(m, 0.16, 0.33, lod)
    n = 14 if lod == 0 else 7
    for k in range(n):
        a = k * 2.399
        r = 0.03 + 0.07 * rng.random()
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0.31))
        dirv = Vector((math.cos(a) * 0.18, math.sin(a) * 0.18, 1.0))
        leaf_blade(m, 'leaf_snake' if k % 4 else 'leaf_edge', base, dirv, rng.uniform(0.45, 0.75), rng.uniform(0.05, 0.075), curl=-0.04, segs=5, twist=rng.uniform(-1.2, 1.2), lod=lod, mid=0.35)
    m.px((0, 0, 0.17), (0.34, 0.34, 0.34), 'pot_dark')
    m.px((0, 0, 0.65), (0.3, 0.3, 0.6), 'leaf_snake')
    return m, {}


def palm_frond(m, base, dirv, L, lod, rng, mat='leaf_palm', droop=0.45, nl=None):
    """Pelepah palem: tulang daun melengkung + anak daun di kedua sisi."""
    d = Vector(dirv).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    n = 6 if lod == 0 else 3
    pts = [Vector(base) + d * (L * t) - Vector((0, 0, droop * L * t * t)) for t in [i / n for i in range(n + 1)]]
    for i in range(n):
        tube(m, 'stem', pts[i], pts[i + 1], 0.006 * (1 - i / n) + 0.002, 4 if lod == 0 else 3)
    nl = nl or (9 if lod == 0 else 3)
    for j in range(nl):
        t = 0.15 + 0.8 * j / nl
        i = min(n - 1, int(t * n))
        p = pts[i].lerp(pts[i + 1], t * n - i)
        tan = (pts[i + 1] - pts[i]).normalized()
        for s in (-1, 1):
            ld = (tan * 0.55 + side * s * 0.8 + Vector((0, 0, -0.15))).normalized()
            leaf_blade(m, mat, p, ld, L * (0.36 - 0.22 * abs(t - 0.4)), 0.035, curl=0.25, segs=2, lod=lod, two=True, mid=0.4)


@model('plant_palm', 'plant', (0.45, 0.45, 1.1), ctx=('house', 'tower'), ao=0.35, wall=None, group='living')
def m_plant_palm(lod):
    m = Mesh()
    rng = random.Random(53)
    sg = 14 if lod == 0 else 7
    lathe(m, 'fab_rattan', [(0.0, 0.0), (0.15, 0.0), (0.2, 0.3), (0.21, 0.32), (0.19, 0.32)], sg)  # keranjang anyaman
    pot_plant_soil(m, 0.19, 0.31, lod)
    for k in range(3):  # batang
        a = k * 2.1
        b = Vector((math.cos(a) * 0.04, math.sin(a) * 0.04, 0.3))
        tube(m, 'stem', b, b + Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, 0.45 + 0.1 * k)), 0.012, 6 if lod == 0 else 4)
    n = 7 if lod == 0 else 4
    for k in range(n):
        a = k * 2.399 + (0.3 if lod else 0)
        base = Vector((math.cos(a) * 0.06, math.sin(a) * 0.06, 0.62 + 0.1 * (k % 3)))
        palm_frond(m, base, (math.cos(a), math.sin(a), 0.9), rng.uniform(0.5, 0.65), lod, rng)
    m.px((0, 0, 0.16), (0.4, 0.4, 0.32), 'fab_rattan')
    m.px((0, 0, 0.85), (0.7, 0.7, 0.6), 'leaf_palm')
    return m, {}


# ---------- karpet (motif dari atlas, dipilih per instans)
def rug(lod, w, d):
    m = Mesh()
    t = 0.012
    box(m, 'fab_beige', (0, 0, t / 2), (w, d, t * 0.9))
    quad(m, 'atlas_rug', [(-w / 2, -d / 2, t), (w / 2, -d / 2, t), (w / 2, d / 2, t), (-w / 2, d / 2, t)],
         uvs=[(0.001, 0.001), (0.999, 0.001), (0.999, 0.999), (0.001, 0.999)])
    if lod == 0:  # rumbai di ujung pendek (pita tipis)
        for sx in (-1, 1):
            box(m, 'fab_white', (sx * (w / 2 + 0.03), 0, 0.002), (0.06, d - 0.02, 0.004))
    m.px((0, 0, t / 2), (w, d, t), 'fab_beige', 0, 200)
    return m, {}


@model('rug_l', 'rug', (2.3, 1.6, 0.012), ctx=('house',), lods=(0, 1), ao=0.0, wall=None, group='living')
def m_rug_l(lod):
    return rug(lod, 2.3, 1.6)


@model('rug_s', 'rug', (1.9, 0.9, 0.012), ctx=('house',), lods=(0, 1), ao=0.0, wall=None, group='bed')
def m_rug_s(lod):
    return rug(lod, 1.9, 0.9)


# ================================================================ KAMAR TIDUR
def bedding(m, lod, w, d, z_mat, rng, duvet='tfab_main', throw='tfab_acc'):
    """Kasur, selimut tebal menutup 2/3 kasur (menjuntai di sisi), dua bantal + bantal hias, selimut lipat di kaki."""
    mw, md, mt = w - 0.08, d - 0.1, 0.22
    cushion(m, 'fab_white', (0, 0.02, z_mat + mt / 2), (mw, md, mt), ep=0.08, ev=0.22, lod=lod)
    dz = z_mat + mt
    # selimut: lapisan tebal melengkung, menjuntai di samping & kaki
    cushion(m, duvet, (0, 0.16, dz - 0.07), (mw + 0.06, md * 0.78, 0.2), ep=0.06, ev=0.18, lod=lod)
    if lod == 0:
        tube(m, duvet, (-mw / 2 - 0.02, -md / 2 + md * 0.28, dz + 0.025), (mw / 2 + 0.02, -md / 2 + md * 0.28, dz + 0.025), 0.04, 10, caps=True)  # lipatan atas
    for s in (-1, 1):
        cushion(m, 'fab_white', (0, 0, 0), (mw * 0.44, 0.36, 0.13), ep=0.3, ev=0.5, lod=lod, M=T(s * mw * 0.24, -d / 2 + 0.3, dz + 0.05) @ Rx(-12))
    cushion(m, throw, (0, 0, 0), (0.38, 0.12, 0.34), ep=0.35, ev=0.45, lod=lod, M=T(-0.05, -d / 2 + 0.48, dz + 0.12) @ Rz(5) @ Rx(-22))
    cushion(m, throw, (0, 0.0, 0), (mw + 0.08, 0.42, 0.035), ep=0.06, ev=0.3, lod=lod, M=T(0, d / 2 - 0.32, dz + 0.04))


@model('bed_wood', 'bed', (1.6, 2.0, 0.55), ctx=('house',), ao=0.5, group='bed')
def m_bed_wood(lod):
    m = Mesh()
    w, d = 1.6, 2.0
    rng = random.Random(61)
    bev = 0.006 if lod == 0 else 0
    for sx in (-1, 1):  # kaki
        for sy in (-1, 1):
            box(m, 'wood_teak', (sx * (w / 2 - 0.04), sy * (d / 2 - 0.04), 0.15), (0.07, 0.07, 0.3), bevel=bev)
    for sy in (-1, 1):  # palang kepala/kaki
        box(m, 'wood_teak', (0, sy * (d / 2 - 0.03), 0.24), (w - 0.06, 0.05, 0.16), bevel=bev)
    for sx in (-1, 1):  # palang samping
        box(m, 'wood_teak', (sx * (w / 2 - 0.03), 0, 0.24), (0.05, d - 0.06, 0.16), bevel=bev)
    box(m, 'wood_teak', (0, 0, 0.3), (w - 0.06, d - 0.06, 0.02))  # alas
    # kepala ranjang: rangka + panel masuk + palang atas membulat
    hb = -d / 2 + 0.03
    for sx in (-1, 1):
        box(m, 'wood_teak', (sx * (w / 2 - 0.04), hb, 0.62), (0.08, 0.06, 0.86), bevel=bev)
    box(m, 'wood_teak', (0, hb, 1.02), (w + 0.04, 0.07, 0.07), bevel=0.02 if lod == 0 else 0, seg=2)
    box(m, 'wood_teak', (0, hb - 0.005, 0.66), (w - 0.1, 0.03, 0.66))
    if lod == 0:
        for k in range(4):  # panel berbingkai
            x = -w / 2 + 0.08 + (w - 0.16) * (k + 0.5) / 4
            box(m, 'wood_teak', (x, hb + 0.016, 0.66), ((w - 0.16) / 4 - 0.05, 0.012, 0.5), bevel=0.008, seg=2)
    # papan kaki rendah
    box(m, 'wood_teak', (0, d / 2 - 0.03, 0.36), (w + 0.02, 0.05, 0.06), bevel=0.012 if lod == 0 else 0, seg=2)
    bedding(m, lod, w, d, 0.31, rng)
    m.px((0, 0.02, 0.27), (w, d - 0.04, 0.54), 'fab_white')
    m.px((0, 0.25, 0.47), (w, d * 0.75, 0.16), 'tfab_main', 1)
    m.px((0, hb, 0.53), (w, 0.07, 1.05), 'wood_teak')
    return m, {}


@model('bed_uph', 'bed', (1.6, 2.0, 0.55), ctx=('house',), ao=0.5, group='bed')
def m_bed_uph(lod):
    m = Mesh()
    w, d = 1.6, 2.0
    rng = random.Random(62)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(m, 'metal_black', sx * (w / 2 - 0.1), sy * (d / 2 - 0.12), 0, 0.02, 0.02, 0.08, 8 if lod == 0 else 4)
    box(m, 'fab_grey', (0, 0.02, 0.19), (w, d - 0.04, 0.22), bevel=0.03 if lod == 0 else 0, seg=3 if lod == 0 else 1)  # dipan berbalut kain
    # kepala ranjang berlapis kain: 5 bantalan tegak (alur)
    hb = -d / 2 + 0.06
    box(m, 'fab_grey', (0, hb - 0.02, 0.6), (w + 0.1, 0.08, 0.9), bevel=0.02 if lod == 0 else 0, seg=2)
    if lod == 0:
        for k in range(5):
            x = -w / 2 - 0.03 + (w + 0.06) * (k + 0.5) / 5
            cushion(m, 'tfab_main', (x, hb + 0.03, 0.66), ((w + 0.06) / 5 - 0.01, 0.06, 0.74), ep=0.18, ev=0.3, lod=lod)
    else:
        box(m, 'tfab_main', (0, hb + 0.03, 0.66), (w + 0.06, 0.06, 0.74))
    bedding(m, lod, w, d, 0.3, rng, duvet='fab_white', throw='tfab_acc')
    m.px((0, 0.02, 0.27), (w, d - 0.04, 0.54), 'fab_white')
    m.px((0, hb, 0.55), (w + 0.1, 0.12, 1.05), 'tfab_main', 1)
    return m, {}


# ---------- lemari pakaian
def wardrobe_body(m, lod, w, d, h, mat, plinth=0.08):
    bev = 0.005 if lod == 0 else 0
    box(m, mat, (0, -0.01, plinth / 2), (w - 0.04, d - 0.06, plinth))
    box(m, mat, (0, -0.01, (h + plinth) / 2 - 0.02), (w, d - 0.02, h - plinth - 0.04), bevel=bev)
    box(m, mat, (0, 0, h - 0.025), (w + 0.03, d + 0.01, 0.05), bevel=0.01 if lod == 0 else 0, seg=2)  # cornice


@model('wardrobe_2door', 'wardrobe', (1.2, 0.6, 2.0), ctx=('house',), ao=0.5, group='bed')
def m_wardrobe_2door(lod):
    m = Mesh()
    w, d, h = 1.2, 0.6, 2.0
    wardrobe_body(m, lod, w, d, h, 'wood_walnut')
    z0, z1 = 0.1, h - 0.07
    for s in (-1, 1):
        x = s * w / 4
        box(m, 'wood_oak', (x, d / 2 - 0.02, (z0 + z1) / 2), (w / 2 - 0.012, 0.022, z1 - z0), bevel=0.004 if lod == 0 else 0)
        if lod == 0:  # panel atas & bawah timbul
            for zc, hh in ((1.42, 0.78), (0.55, 0.74)):
                box(m, 'wood_oak', (x, d / 2 - 0.006, zc), (w / 2 - 0.12, 0.008, hh), bevel=0.01, seg=2)
        handle(m, 'steel', x - s * (w / 4 - 0.06), d / 2 - 0.01, 1.05, 0.3, 'z', lod)
    m.px((0, 0, h / 2), (w, d, h), 'wood_oak')
    return m, {}


@model('wardrobe_mirror', 'wardrobe', (1.2, 0.6, 2.0), ctx=('house',), ao=0.5, group='bed')
def m_wardrobe_mirror(lod):
    m = Mesh()
    w, d, h = 1.2, 0.6, 2.0
    wardrobe_body(m, lod, w, d, h, 'wood_white')
    z0, z1 = 0.1, h - 0.07
    # dua pintu geser bertumpuk: kiri kayu putih bergaris, kanan cermin berbingkai
    box(m, 'wood_white', (-w / 4 + 0.01, d / 2 - 0.03, (z0 + z1) / 2), (w / 2 + 0.02, 0.022, z1 - z0), bevel=0.004 if lod == 0 else 0)
    if lod == 0:
        for k in range(6):
            box(m, 'wood_oak', (-w / 4 + 0.01, d / 2 - 0.018, z0 + 0.2 + k * 0.3), (w / 2 - 0.04, 0.006, 0.012))
    box(m, 'wood_oak', (w / 4 - 0.01, d / 2 - 0.006, (z0 + z1) / 2), (w / 2 + 0.02, 0.022, z1 - z0), bevel=0.004 if lod == 0 else 0)
    box(m, 'mirror', (w / 4 - 0.01, d / 2 + 0.006, (z0 + z1) / 2), (w / 2 - 0.06, 0.004, z1 - z0 - 0.08))
    box(m, 'alu', (0, d / 2 - 0.045, z1 + 0.012), (w, 0.03, 0.02))  # rel
    handle(m, 'alu', -0.05, d / 2 - 0.02, 1.05, 0.5, 'z', lod, out=0.012)
    m.px((0, 0, h / 2), (w, d, h), 'wood_white')
    return m, {}


# ---------- meja samping tempat tidur (+ lampu meja)
def table_lamp(m, x, y, z, lod, shade='emit_warm', base='ceramic'):
    sg = 14 if lod == 0 else 6
    lathe(m, base, [(0.0, z), (0.05, z), (0.065, z + 0.05), (0.06, z + 0.13), (0.03, z + 0.2), (0.012, z + 0.22)], sg, M=T(x, y, 0))
    cyl(m, 'brass', x, y, z + 0.21, 0.006, 0.006, 0.08, 6)
    lathe(m, shade, [(0.1, z + 0.24), (0.075, z + 0.4), (0.07, z + 0.4)], sg, M=T(x, y, 0))
    lathe(m, shade, [(0.07, z + 0.4), (0.1, z + 0.24)], sg, M=T(x, y, 0))  # sisi dalam kap


@model('side_drawer', 'side', (0.45, 0.45, 0.5), ctx=('house',), ao=0.45, group='bed')
def m_side_drawer(lod):
    m = Mesh()
    w, d, h = 0.45, 0.45, 0.5
    rng = random.Random(71)
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = Vector((sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0))
            tube(m, 'wood_oak', a + Vector((sx * 0.015, sy * 0.015, 0)), a + Vector((0, 0, 0.13)), 0.012, 8 if lod == 0 else 4, caps=True, r2=0.016)
    box(m, 'wood_oak', (0, 0, (0.13 + h) / 2), (w, d, h - 0.13), bevel=0.008 if lod == 0 else 0, seg=2)
    for k in range(2):
        zc = 0.13 + (h - 0.13) * (k + 0.5) / 2
        box(m, 'wood_white', (0, d / 2 + 0.004, zc), (w - 0.04, 0.012, (h - 0.13) / 2 - 0.02), bevel=0.003 if lod == 0 else 0)
        handle(m, 'brass', 0, d / 2 + 0.01, zc, 0.12, 'x', lod, out=0.015)
    table_lamp(m, -0.08, -0.06, h, lod)
    if lod == 0:
        box(m, 'atlas_books', (0.11, 0.08, h + 0.014), (0.15, 0.21, 0.028), cell=31, front='+y')
        box(m, 'plastic_black', (0.13, 0.08, h + 0.032), (0.07, 0.14, 0.008), bevel=0.003)  # ponsel
    m.px((0, 0, (0.13 + h) / 2), (w, d, h - 0.13), 'wood_oak')
    m.px((-0.08, -0.06, h + 0.3), (0.2, 0.2, 0.2), 'emit_warm')
    return m, {}


@model('side_open', 'side', (0.45, 0.45, 0.5), ctx=('house',), ao=0.45, group='bed')
def m_side_open(lod):
    m = Mesh()
    w, d, h = 0.45, 0.45, 0.5
    rng = random.Random(72)
    t = 0.02
    for x in (-w / 2 + t / 2, w / 2 - t / 2):
        box(m, 'wood_walnut', (x, 0, h / 2), (t, d, h), bevel=0.003 if lod == 0 else 0)
    for z in (t / 2 + 0.04, 0.26, h - t / 2):
        box(m, 'wood_walnut', (0, 0, z), (w - 2 * t, d, t))
    box(m, 'wood_walnut', (0, -d / 2 + 0.005, h / 2), (w - 2 * t, 0.01, h - 0.02))
    if lod == 0:
        books(m, -w / 2 + t + 0.01, 0.05, -d / 2 + 0.03, 0.05, d - 0.06, rng, lod, lean=False, hmin=0.15, hmax=0.2)
        box(m, 'fab_rattan', (0.0, 0.0, 0.33), (w - 0.08, d - 0.08, 0.13), bevel=0.012, seg=2)
        # jam meja bulat
        cyl(m, 'plastic_white', 0, 0, 0, 0.065, 0.065, 0.04, 16, M=T(-0.1, 0.05, h + 0.075) @ Rx(-90))
        quad(m, 'atlas_misc', [(-0.155, 0.091, h + 0.02), (-0.045, 0.091, h + 0.02), (-0.045, 0.091, h + 0.13), (-0.155, 0.091, h + 0.13)],
             uvs=[(MISC['clock'] + 0.02, 0.02), (MISC['clock'] + 0.98, 0.02), (MISC['clock'] + 0.98, 0.98), (MISC['clock'] + 0.02, 0.98)])
        lathe(m, 'terracotta', [(0.0, h), (0.05, h), (0.06, h + 0.09), (0.055, h + 0.1)], 12, M=T(0.1, -0.05, 0))
        pot_plant_soil(m, 0.053, h + 0.1, lod)
        for k in range(8):
            a = k * 2.399
            leaf_blade(m, 'leaf_mid', (0.1, -0.05, h + 0.09), (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.0), 0.13, 0.05, curl=0.15, segs=3, lod=lod)
    m.px((0, 0, h / 2), (w, d, h), 'wood_walnut')
    return m, {}


# ---------- meja belajar + kursi kerja; meja rias + cermin + bangku
def office_chair(m, x, y, lod, rot=0.0):
    M0 = T(x, y, 0) @ Rz(rot)
    sub = Mesh()
    for k in range(5):  # kaki bintang + roda
        a = k * 2 * pi / 5
        p = Vector((math.cos(a) * 0.27, math.sin(a) * 0.27, 0.05))
        tube(sub, 'plastic_black', (0, 0, 0.08), p, 0.014, 5 if lod == 0 else 3)
        if lod == 0:
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=0.025)
            sub.add(bm, 'plastic_black', T(p.x, p.y, 0.025), True)
    cyl(sub, 'chrome', 0, 0, 0.08, 0.022, 0.022, 0.32, 8 if lod == 0 else 4)
    cushion(sub, 'tfab_main', (0, 0, 0.46), (0.46, 0.46, 0.08), ep=0.25, ev=0.4, lod=lod)
    cushion(sub, 'tfab_main', (0, 0, 0), (0.44, 0.07, 0.48), ep=0.3, ev=0.45, lod=lod, M=T(0, 0.24, 0.78) @ Rx(10))
    box(sub, 'plastic_black', (0, 0.22, 0.53), (0.06, 0.03, 0.14))
    merge_mesh(m, sub, M0)


@model('desk_study', 'desk', (1.2, 0.6, 0.75), ctx=('house',), ao=0.45, group='bed')
def m_desk_study(lod):
    m = Mesh()
    w, d, h = 1.2, 0.6, 0.75
    rng = random.Random(81)
    box(m, 'wood_light', (0, 0, h - 0.015), (w, d, 0.03), bevel=0.006 if lod == 0 else 0, seg=2)
    for sx in (-1, 1):  # rangka kaki logam (bentuk U)
        x = sx * (w / 2 - 0.04)
        for sy in (-1, 1):
            box(m, 'metal_black', (x, sy * (d / 2 - 0.05), (h - 0.03) / 2), (0.03, 0.03, h - 0.03))
        box(m, 'metal_black', (x, 0, 0.015), (0.03, d - 0.06, 0.03))
        box(m, 'metal_black', (x, 0, h - 0.045), (0.03, d - 0.06, 0.03))
    # laci gantung kanan
    box(m, 'wood_white', (0.38, 0.0, h - 0.12), (0.38, d - 0.06, 0.15), bevel=0.004 if lod == 0 else 0)
    handle(m, 'steel', 0.38, d / 2 - 0.03, h - 0.12, 0.14, 'x', lod, out=0.015)
    # laptop terbuka
    box(m, 'alu', (-0.12, 0.05, h + 0.009), (0.34, 0.24, 0.018), bevel=0.004 if lod == 0 else 0)
    M = T(-0.12, -0.07, h + 0.018) @ Rx(-12)
    box(m, 'alu', (0, -0.005, 0.115), (0.34, 0.008, 0.23), M=M)
    sub = Mesh()
    quad(sub, 'atlas_misce', [(-0.155, 0.0, 0.012), (0.155, 0.0, 0.012), (0.155, 0.0, 0.215), (-0.155, 0.0, 0.215)],
         uvs=[(MISC['laptop'] + 0.01, 0.01), (MISC['laptop'] + 0.99, 0.01), (MISC['laptop'] + 0.99, 0.99), (MISC['laptop'] + 0.01, 0.99)])
    merge_mesh(m, sub, M)
    if lod == 0:
        # lampu meja berlengan
        cyl(m, 'metal_black', 0.42, -0.18, h, 0.07, 0.07, 0.02, 14)
        tube(m, 'metal_black', (0.42, -0.18, h + 0.02), (0.36, -0.2, h + 0.36), 0.008, 6)
        tube(m, 'metal_black', (0.36, -0.2, h + 0.36), (0.22, -0.08, h + 0.42), 0.008, 6)
        lathe(m, 'metal_black', [(0.0, 0.0), (0.03, 0.0), (0.06, -0.09), (0.058, -0.09)], 12, M=T(0.22, -0.06, h + 0.44) @ Rx(15))
        books(m, 0.24, 0.5, -d / 2 + 0.03, h, 0.22, rng, lod, lean=False)
        lathe(m, 'plastic_blue', [(0.0, h), (0.035, h), (0.035, h + 0.1), (0.032, h + 0.1)], 10, M=T(0.0, -0.2, 0))  # gelas pena
        for k in range(3):
            tube(m, ('paint_yellow', 'plastic_red', 'plastic_black')[k], (0.0 + (k - 1) * 0.01, -0.2, h + 0.03), (0.0 + (k - 1) * 0.02, -0.21 + k * 0.01, h + 0.16), 0.004, 5)
    office_chair(m, -0.08, 0.36, lod, rot=0.15)
    m.px((0, 0, h / 2), (w, d, h), 'wood_light')
    m.px((-0.08, 0.36, 0.5), (0.48, 0.48, 1.0), 'tfab_main', 1)
    return m, {}


@model('desk_vanity', 'desk', (1.2, 0.6, 0.75), ctx=('house',), ao=0.45, group='bed')
def m_desk_vanity(lod):
    m = Mesh()
    w, d, h = 1.2, 0.6, 0.75
    rng = random.Random(82)
    bev = 0.006 if lod == 0 else 0
    box(m, 'wood_white', (0, 0, h - 0.02), (w, d, 0.04), bevel=bev, seg=2)
    for sx in (-1, 1):  # dua kabinet laci
        x = sx * (w / 2 - 0.2)
        box(m, 'wood_white', (x, 0, (h - 0.04) / 2), (0.38, d - 0.02, h - 0.04), bevel=bev)
        for k in range(3):
            zc = 0.06 + (h - 0.14) * (k + 0.5) / 3
            box(m, 'wood_oak', (x, d / 2 - 0.004, zc), (0.34, 0.012, (h - 0.14) / 3 - 0.02), bevel=0.003 if lod == 0 else 0)
            knob(m, 'gold', x, d / 2, zc, lod=lod)
    # cermin oval berbingkai kayu
    M = T(0, -d / 2 + 0.06, h + 0.5)
    sub = Mesh()
    n = 28 if lod == 0 else 12
    ring = [(0.32 * math.cos(2 * pi * i / n), 0, 0.46 * math.sin(2 * pi * i / n)) for i in range(n)]
    inner = [(0.28 * math.cos(2 * pi * i / n), 0.012, 0.42 * math.sin(2 * pi * i / n)) for i in range(n)]
    loft(sub, 'wood_oak', [[(x, -0.02, z) for x, _, z in ring], [(x, 0.02, z) for x, _, z in ring]], True, True, smooth=False)
    loft(sub, 'mirror', [[(x, 0.02, z) for x, _, z in inner], [(x, 0.024, z) for x, _, z in inner]], True, True)
    merge_mesh(m, sub, M)
    box(m, 'wood_oak', (0, -d / 2 + 0.06, h + 0.04), (0.2, 0.08, 0.08))
    if lod == 0:
        cols = ('plastic_pink', 'gold', 'plastic_white', 'ceramic_blue', 'plastic_red')
        for k in range(6):
            x = -0.45 + k * 0.07 + (0.5 if k > 2 else 0)
            hh = 0.08 + 0.06 * (k % 3)
            lathe(m, cols[k % 5], [(0.0, h), (0.022, h), (0.022, h + hh), (0.012, h + hh + 0.01), (0.008, h + hh + 0.03), (0.0, h + hh + 0.03)], 10, M=T(x, -0.12 + 0.03 * (k % 2), 0))
    # bangku bulat di bawah meja
    for k in range(4):
        a = pi / 4 + k * pi / 2
        tube(m, 'gold', (math.cos(a) * 0.14, 0.2 + math.sin(a) * 0.14, 0), (math.cos(a) * 0.11, 0.2 + math.sin(a) * 0.11, 0.42), 0.01, 6 if lod == 0 else 3)
    lathe(m, 'tfab_main', [(0.0, 0.4), (0.17, 0.4), (0.19, 0.43), (0.18, 0.47), (0.0, 0.48)], 18 if lod == 0 else 8)
    m.px((0, 0, h / 2), (w, d, h), 'wood_white')
    m.px((0, -d / 2 + 0.06, h + 0.5), (0.64, 0.04, 0.92), 'mirror')
    return m, {}


# ================================================================ DAPUR
def base_cabinets(m, lod, w, d, h, carcass, door, top, handle_mat='steel', doors=4, open_at=None):
    """Kabinet bawah: plint mundur, badan, pintu (celah 4 mm), meja atas. open_at = (x0, x1) bagian tanpa pintu."""
    bev = 0.004 if lod == 0 else 0
    box(m, 'paint_black', (0, -0.04, 0.05), (w - 0.02, d - 0.1, 0.1))
    box(m, carcass, (0, -0.01, 0.1 + (h - 0.14) / 2), (w, d - 0.03, h - 0.14))
    dw = w / doors
    for k in range(doors):
        x0, x1 = -w / 2 + dw * k, -w / 2 + dw * (k + 1)
        xc = (x0 + x1) / 2
        if open_at and open_at[0] <= xc <= open_at[1]:
            continue
        box(m, door, (xc, d / 2 - 0.02, 0.1 + (h - 0.14) / 2), (dw - 0.006, 0.02, h - 0.15), bevel=bev)
        hx = x1 - 0.05 if k % 2 == 0 else x0 + 0.05
        handle(m, handle_mat, hx, d / 2 - 0.01, h - 0.2, 0.14, 'z', lod, out=0.018)
    box(m, top, (0, 0.0, h - 0.02), (w + 0.02, d + 0.02, 0.04), bevel=0.006 if lod == 0 else 0, seg=2)


def wall_cabinets(m, lod, w, d, z0, z1, carcass, door, y0=None, skip=None):
    """Lemari gantung (di belakang, kedalaman 0,34)."""
    y0 = -d / 2 if y0 is None else y0
    dd = 0.34
    yc = y0 + dd / 2
    box(m, carcass, (0, yc - 0.01, (z0 + z1) / 2), (w, dd - 0.02, z1 - z0))
    n = max(1, round(w / 0.55))
    dw = w / n
    for k in range(n):
        xc = -w / 2 + dw * (k + 0.5)
        if skip and skip[0] <= xc <= skip[1]:
            continue
        box(m, door, (xc, y0 + dd - 0.01, (z0 + z1) / 2), (dw - 0.006, 0.02, z1 - z0 - 0.01), bevel=0.004 if lod == 0 else 0)
        handle(m, 'steel', xc + (dw / 2 - 0.05) * (1 if k % 2 else -1), y0 + dd, z0 + 0.08, 0.12, 'z', lod, out=0.016)


def gas_stove(m, x, y, z, lod, rng, wok=True):
    """Kompor gas 2 tungku di atas meja (+ wajan)."""
    box(m, 'metal_black', (x, y, z + 0.05), (0.68, 0.4, 0.1), bevel=0.01 if lod == 0 else 0, seg=2)
    box(m, 'screen', (x, y, z + 0.101), (0.66, 0.38, 0.003))
    for s in (-1, 1):
        bx = x + s * 0.17
        lathe(m, 'metal_black', [(0.0, z + 0.104), (0.06, z + 0.104), (0.065, z + 0.115), (0.04, z + 0.12), (0.0, z + 0.12)], 14 if lod == 0 else 6, M=T(bx, y - 0.01, 0))
        if lod == 0:
            for k in range(4):  # dudukan panci
                a = k * pi / 2 + pi / 4
                box(m, 'metal_black', (bx + math.cos(a) * 0.075, y - 0.01 + math.sin(a) * 0.075, z + 0.125), (0.012, 0.012, 0.02), M=None)
            cyl(m, 'chrome', 0, 0, 0, 0.018, 0.016, 0.02, 10, M=T(bx, y + 0.2, z + 0.05) @ Rx(-90))
    if wok:  # wajan cekung + gagang
        wx = x - 0.17
        lathe(m, 'metal_black', [(0.0, z + 0.14), (0.08, z + 0.15), (0.15, z + 0.19), (0.165, z + 0.22), (0.158, z + 0.22), (0.14, z + 0.19), (0.075, z + 0.157), (0.0, z + 0.147)], 18 if lod == 0 else 8, M=T(wx, y - 0.01, 0))
        tube(m, 'wood_dark', (wx + 0.15, y - 0.01, z + 0.21), (wx + 0.33, y + 0.02, z + 0.25), 0.012, 6 if lod == 0 else 3, caps=True)


def rice_cooker(m, x, y, z, lod):
    sg = 18 if lod == 0 else 8
    lathe(m, 'plastic_white', [(0.0, z), (0.12, z), (0.135, z + 0.03), (0.135, z + 0.16), (0.125, z + 0.175), (0.0, z + 0.175)], sg, M=T(x, y, 0))
    lathe(m, 'plastic_white', [(0.0, z + 0.175), (0.128, z + 0.175), (0.11, z + 0.22), (0.05, z + 0.245), (0.0, z + 0.248)], sg, M=T(x, y, 0))
    if lod == 0:
        box(m, 'plastic_grey', (x, y + 0.13, z + 0.1), (0.1, 0.02, 0.06), bevel=0.006, seg=2)
        cyl(m, 'emit_red', 0, 0, 0, 0.006, 0.006, 0.004, 8, M=T(x - 0.025, y + 0.141, z + 0.11) @ Rx(-90))
        tube(m, 'plastic_grey', (x - 0.07, y, z + 0.235), (x + 0.07, y, z + 0.235), 0.012, 6, caps=True)


def sink_basin(m, x, y, z_top, w, d, lod, faucet_y=None):
    """Bak cuci baja tanam (dinding dalam terlihat) + keran leher angsa."""
    dep = 0.18
    for (cx, cy, sx, sy) in ((x, y - d / 2 - 0.01, w + 0.04, 0.02), (x, y + d / 2 + 0.01, w + 0.04, 0.02), (x - w / 2 - 0.01, y, 0.02, d), (x + w / 2 + 0.01, y, 0.02, d)):
        box(m, 'steel', (cx, cy, z_top + 0.003), (sx, sy, 0.006))
    # dinding dalam (menghadap ke dalam bak) + dasar
    zb = z_top - dep
    quad(m, 'steel', [(x - w / 2, y - d / 2, zb), (x + w / 2, y - d / 2, zb), (x + w / 2, y - d / 2, z_top), (x - w / 2, y - d / 2, z_top)])
    quad(m, 'steel', [(x + w / 2, y + d / 2, zb), (x - w / 2, y + d / 2, zb), (x - w / 2, y + d / 2, z_top), (x + w / 2, y + d / 2, z_top)])
    quad(m, 'steel', [(x - w / 2, y + d / 2, zb), (x - w / 2, y - d / 2, zb), (x - w / 2, y - d / 2, z_top), (x - w / 2, y + d / 2, z_top)])
    quad(m, 'steel', [(x + w / 2, y - d / 2, zb), (x + w / 2, y + d / 2, zb), (x + w / 2, y + d / 2, z_top), (x + w / 2, y - d / 2, z_top)])
    quad(m, 'steel', [(x - w / 2, y - d / 2, zb), (x - w / 2, y + d / 2, zb), (x + w / 2, y + d / 2, zb), (x + w / 2, y - d / 2, zb)])
    if lod == 0:
        cyl(m, 'metal_black', x, y, zb + 0.001, 0.035, 0.035, 0.002, 12)
    fy = (y - d / 2 - 0.05) if faucet_y is None else faucet_y
    cyl(m, 'chrome', x, fy, z_top, 0.025, 0.022, 0.06, 10 if lod == 0 else 5)
    if lod == 0:
        pts = [(x, fy, z_top + 0.06)]
        for k in range(1, 9):
            a = pi * k / 8
            pts.append((x, fy + 0.09 - 0.09 * math.cos(a), z_top + 0.06 + 0.22 + 0.06 * math.sin(a) - (0.22 if k == 8 else 0) * 0))
        tube(m, 'chrome', (x, fy, z_top + 0.06), (x, fy, z_top + 0.28), 0.011, 8)
        tube(m, 'chrome', (x, fy, z_top + 0.28), (x, fy + 0.07, z_top + 0.33), 0.011, 8)
        tube(m, 'chrome', (x, fy + 0.07, z_top + 0.33), (x, fy + 0.15, z_top + 0.3), 0.011, 8)
        tube(m, 'chrome', (x, fy + 0.15, z_top + 0.3), (x, fy + 0.16, z_top + 0.24), 0.011, 8, caps=True)
        tube(m, 'chrome', (x + 0.02, fy, z_top + 0.12), (x + 0.1, fy, z_top + 0.14), 0.006, 6, caps=True)
    else:
        box(m, 'chrome', (x, fy + 0.07, z_top + 0.3), (0.02, 0.16, 0.02))


@model('counter_std', 'counter', (2.2, 0.6, 0.9), ctx=('house',), ao=0.55, group='kitchen')
def m_counter_std(lod):
    m = Mesh()
    w, d, h = 2.2, 0.6, 0.9
    rng = random.Random(91)
    # kabinet bawah putih; bagian bawah kompor terbuka (tabung gas 3 kg hijau)
    base_cabinets(m, lod, w, d, h, 'paint_white', 'paint_white', 'stone_granite', doors=4, open_at=(-0.9, -0.7))
    if lod == 0:
        lathe(m, 'plastic_green', [(0.0, 0.1), (0.1, 0.1), (0.13, 0.16), (0.13, 0.33), (0.1, 0.39), (0.03, 0.41), (0.0, 0.41)], 14, M=T(-0.82, 0.02, 0))
        cyl(m, 'steel', -0.82, 0.02, 0.41, 0.02, 0.02, 0.04, 8)
        tube(m, 'plastic_orange', (-0.82, 0.02, 0.45), (-0.8, -0.2, 0.8), 0.008, 6)
    # meja atas: lubang bak cuci (bak di kanan)
    sink_basin(m, w / 2 - 0.5, 0.03, h + 0.0, 0.5, 0.36, lod)
    gas_stove(m, -w / 2 + 0.45, 0.02, h, lod, rng)
    rice_cooker(m, -0.12, -0.12, h, lod)
    # dinding belakang berubin + lemari gantung + tudung asap
    box(m, 'ceramic_tile', (0, -d / 2 + 0.005, h + 0.3), (w, 0.01, 0.6))
    if lod == 0:
        for k in range(1, 6):  # nat ubin
            box(m, 'paint_grey', (0, -d / 2 + 0.0105, h + k * 0.1), (w, 0.001, 0.003))
        for k in range(1, 22):
            box(m, 'paint_grey', (-w / 2 + k * 0.1, -d / 2 + 0.0105, h + 0.3), (0.003, 0.001, 0.6))
    wall_cabinets(m, lod, w, d, 1.5, 2.2, 'paint_white', 'wood_light')
    box(m, 'steel', (-w / 2 + 0.45, -d / 2 + 0.25, 1.46), (0.62, 0.5, 0.08), bevel=0.008 if lod == 0 else 0)  # tudung asap
    if lod == 0:
        box(m, 'emit_white', (-w / 2 + 0.45, -d / 2 + 0.3, 1.419), (0.2, 0.06, 0.003))
        box(m, 'wood_light', (0.35, 0.05, h + 0.012), (0.36, 0.24, 0.022), bevel=0.006, seg=2)  # talenan
        lathe(m, 'steel', [(0.0, h), (0.08, h), (0.09, h + 0.12), (0.06, h + 0.18), (0.012, h + 0.2), (0.0, h + 0.2)], 14, M=T(0.18, -0.16, 0))  # ketel
        tube(m, 'plastic_black', (0.13, -0.16, h + 0.19), (0.23, -0.16, h + 0.19), 0.01, 6)
        for k in range(3):  # toples bumbu
            lathe(m, 'glass_clear', [(0.0, h), (0.035, h), (0.035, h + 0.1), (0.0, h + 0.1)], 10, M=T(-0.45 + k * 0.08, -0.24, 0))
            cyl(m, ('plastic_red', 'plastic_green', 'paint_yellow')[k], -0.45 + k * 0.08, -0.24, h + 0.1, 0.036, 0.036, 0.02, 10)
            cyl(m, ('food_brown', 'food_yellow', 'food_red')[k], -0.45 + k * 0.08, -0.24, h + 0.005, 0.032, 0.032, 0.06, 10)
    m.px((0, 0, h / 2), (w, d, h), 'paint_white')
    m.px((0, -d / 2 + 0.16, 1.85), (w, 0.32, 0.7), 'paint_white')
    return m, {}


@model('counter_wood', 'counter', (2.2, 0.6, 0.9), ctx=('house',), ao=0.55, group='kitchen')
def m_counter_wood(lod):
    m = Mesh()
    w, d, h = 2.2, 0.6, 0.9
    rng = random.Random(92)
    base_cabinets(m, lod, w, d, h, 'wood_walnut', 'wood_oak', 'stone_marble', handle_mat='metal_black', doors=4)
    sink_basin(m, w / 2 - 0.5, 0.03, h, 0.5, 0.36, lod)
    # kompor tanam kaca hitam
    box(m, 'screen', (-w / 2 + 0.45, 0.02, h + 0.004), (0.6, 0.42, 0.008), bevel=0.004 if lod == 0 else 0)
    if lod == 0:
        for s in (-1, 1):
            lathe(m, 'metal_black', [(0.0, h + 0.008), (0.06, h + 0.008), (0.065, h + 0.02), (0.04, h + 0.025), (0.0, h + 0.025)], 14, M=T(-w / 2 + 0.45 + s * 0.15, 0.02, 0))
        # rak piring kawat + piring
        box(m, 'chrome', (0.15, -0.12, h + 0.01), (0.42, 0.26, 0.02))
        for k in range(6):
            M = T(0.0 + k * 0.05, -0.12, h + 0.12) @ Ry(90) @ Rz(0)
            lathe(m, 'ceramic', [(0.0, 0.0), (0.1, 0.0), (0.11, 0.012), (0.0, 0.006)], 16, M=T(0.02 + k * 0.05, -0.12, h + 0.12) @ Ry(90))
        for k in range(4):
            tube(m, 'chrome', (-0.05 + k * 0.13, -0.24, h + 0.02), (-0.05 + k * 0.13, -0.24, h + 0.2), 0.004, 5)
        lathe(m, 'plastic_white', [(0.0, h), (0.07, h), (0.075, h + 0.24), (0.06, h + 0.26), (0.0, h + 0.26)], 12, M=T(-0.25, -0.18, 0))  # dispenser air
    box(m, 'stone_marble', (0, -d / 2 + 0.005, h + 0.3), (w, 0.01, 0.6))
    wall_cabinets(m, lod, w, d, 1.5, 2.2, 'wood_walnut', 'wood_oak', skip=(-0.9, -0.5))
    # tudung asap cerobong baja di bagian tanpa lemari
    box(m, 'steel', (-w / 2 + 0.45, -d / 2 + 0.24, 1.48), (0.6, 0.48, 0.06), bevel=0.006 if lod == 0 else 0)
    box(m, 'steel', (-w / 2 + 0.45, -d / 2 + 0.13, 1.84), (0.26, 0.26, 0.66))
    m.px((0, 0, h / 2), (w, d, h), 'wood_oak')
    m.px((0, -d / 2 + 0.16, 1.85), (w, 0.32, 0.7), 'wood_walnut')
    return m, {}


# ---------- kulkas
def fridge_body(m, lod, w, d, h, mat):
    bev = 0.02 if lod == 0 else 0
    box(m, mat, (0, -0.02, h / 2 + 0.01), (w, d - 0.04, h - 0.02), bevel=bev, seg=2)
    for sx in (-1, 1):
        cyl(m, 'plastic_black', sx * (w / 2 - 0.06), d / 2 - 0.08, 0, 0.02, 0.02, 0.02, 8)


@model('fridge_2door', 'fridge', (0.7, 0.7, 1.8), ctx=('house',), ao=0.5, group='kitchen')
def m_fridge_2door(lod):
    m = Mesh()
    w, d, h = 0.7, 0.7, 1.8
    fridge_body(m, lod, w, d, h, 'steel')
    zf = 1.3  # pintu freezer atas
    for (z0, z1) in ((0.03, zf - 0.006), (zf + 0.006, h - 0.01)):
        box(m, 'steel', (0, d / 2 - 0.03, (z0 + z1) / 2), (w - 0.006, 0.05, z1 - z0), bevel=0.012 if lod == 0 else 0, seg=2)
        handle(m, 'paint_black', -w / 2 + 0.06, d / 2 - 0.005, z0 + 0.12 if z0 > 1 else z1 - 0.3, 0.26 if z0 < 1 else 0.2, 'z', lod, out=0.03)
    if lod == 0:  # magnet & kalender kecil
        box(m, 'atlas_misc', (0.1, d / 2 + 0.0, 1.0), (0.18, 0.004, 0.26), cell=MISC['calendar'], front='+y')
        for k, mat in enumerate(('plastic_red', 'paint_yellow', 'plastic_blue')):
            cyl(m, mat, 0, 0, 0, 0.018, 0.018, 0.008, 10, M=T(0.0 + k * 0.08, d / 2 + 0.002, 1.17 - 0.02 * k) @ Rx(-90))
        box(m, 'plastic_black', (0.18, d / 2 + 0.002, 1.5), (0.1, 0.006, 0.04))  # panel suhu
    m.px((0, 0, h / 2), (w, d, h), 'steel')
    return m, {}


@model('fridge_bottom', 'fridge', (0.7, 0.7, 1.8), ctx=('house',), ao=0.5, group='kitchen')
def m_fridge_bottom(lod):
    m = Mesh()
    w, d, h = 0.7, 0.7, 1.8
    fridge_body(m, lod, w, d, h, 'paint_white')
    zf = 0.62  # laci freezer bawah
    box(m, 'paint_white', (0, d / 2 - 0.03, (0.04 + zf) / 2), (w - 0.006, 0.05, zf - 0.05), bevel=0.012 if lod == 0 else 0, seg=2)
    box(m, 'paint_white', (0, d / 2 - 0.03, (zf + h) / 2), (w - 0.006, 0.05, h - zf - 0.02), bevel=0.012 if lod == 0 else 0, seg=2)
    handle(m, 'chrome', 0, d / 2 - 0.005, zf - 0.08, 0.4, 'x', lod, out=0.03)
    handle(m, 'chrome', -w / 2 + 0.06, d / 2 - 0.005, 1.2, 0.5, 'z', lod, out=0.03)
    if lod == 0:
        box(m, 'screen', (0.18, d / 2 + 0.002, 1.45), (0.12, 0.004, 0.16))  # dispenser air pintu
        box(m, 'emit_white', (0.18, d / 2 + 0.005, 1.5), (0.06, 0.002, 0.02))
        for k, mat in enumerate(('plastic_green', 'plastic_pink')):
            cyl(m, mat, 0, 0, 0, 0.02, 0.02, 0.008, 10, M=T(-0.1 + k * 0.1, d / 2 + 0.002, 1.05) @ Rx(-90))
    m.px((0, 0, h / 2), (w, d, h), 'paint_white')
    return m, {}


# ---------- meja makan + 4 kursi (kursi di luar tapak meja sejauh collider: d/2 + 0,51)
def dining_chair(m, x, y, face, lod, frame='wood_teak', seat='tfab_main', back='wood', z_seat=0.45):
    """Kursi makan menghadap meja; face = +1 menghadap +y."""
    M = T(x, y, 0) @ Rz(0 if face > 0 else 180)
    sub = Mesh()
    s = 0.42
    if frame.startswith('wood'):
        for sx in (-1, 1):
            for sy in (-1, 1):
                hh = z_seat if sy > 0 else 0.92
                box(sub, frame, (sx * (s / 2 - 0.025), sy * (s / 2 - 0.025), hh / 2), (0.035, 0.035, hh))
        if back == 'wood':
            box(sub, frame, (0, -s / 2 + 0.025, 0.85), (s - 0.05, 0.03, 0.1), bevel=0.006 if lod == 0 else 0)
            for k in range(3 if lod == 0 else 1):
                box(sub, frame, ((k - 1) * 0.09, -s / 2 + 0.025, 0.66), (0.03, 0.02, 0.28))
            box(sub, frame, (0, -s / 2 + 0.025, 0.51), (s - 0.05, 0.03, 0.04))
        else:
            cushion(sub, seat, (0, -s / 2 + 0.04, 0.7), (s - 0.04, 0.06, 0.38), ep=0.18, ev=0.35, lod=lod)
    else:  # rangka logam tipis
        for sx in (-1, 1):
            for sy in (-1, 1):
                tube(sub, frame, (sx * (s / 2 - 0.03), sy * (s / 2 - 0.03), 0), (sx * (s / 2 - 0.035), sy * (s / 2 - 0.035), z_seat), 0.011, 6 if lod == 0 else 3)
        tube(sub, frame, (-s / 2 + 0.035, -s / 2 + 0.035, z_seat), (-s / 2 + 0.04, -s / 2 + 0.02, 0.9), 0.011, 6 if lod == 0 else 3)
        tube(sub, frame, (s / 2 - 0.035, -s / 2 + 0.035, z_seat), (s / 2 - 0.04, -s / 2 + 0.02, 0.9), 0.011, 6 if lod == 0 else 3)
        if back == 'rattan':
            cushion(sub, 'fab_rattan', (0, 0, 0), (s - 0.04, 0.05, 0.36), ep=0.3, ev=0.4, lod=lod, M=T(0, -s / 2 + 0.035, 0.72) @ Rx(8))
            if lod == 0:
                for k in range(4):  # rangka melengkung sandaran
                    tube(sub, frame, (-s / 2 + 0.04, -s / 2 + 0.03, 0.55 + k * 0.1), (s / 2 - 0.04, -s / 2 + 0.03, 0.55 + k * 0.1), 0.006, 5)
        else:
            box(sub, 'wood_oak', (0, -s / 2 + 0.03, 0.8), (s - 0.06, 0.03, 0.16), bevel=0.008 if lod == 0 else 0, seg=2)
    if seat.startswith('wood'):
        box(sub, seat, (0, 0, z_seat + 0.015), (s, s, 0.03), bevel=0.008 if lod == 0 else 0, seg=2)
    elif seat == 'fab_rattan':
        cushion(sub, seat, (0, 0, z_seat + 0.025), (s, s, 0.05), ep=0.25, ev=0.35, lod=lod)
        cushion(sub, 'fab_beige', (0, 0.01, z_seat + 0.065), (s - 0.06, s - 0.08, 0.05), ep=0.25, ev=0.4, lod=lod)
    else:
        box(sub, frame if frame.startswith('wood') else 'wood_oak', (0, 0, z_seat - 0.01), (s, s, 0.03))
        cushion(sub, seat, (0, 0.01, z_seat + 0.04), (s - 0.02, s - 0.04, 0.07), ep=0.2, ev=0.35, lod=lod)
    merge_mesh(m, sub, M)


def table_top_legs(m, lod, w, d, h, top, leg, top_t=0.04, apron=True, legs='square'):
    bev = 0.008 if lod == 0 else 0
    box(m, top, (0, 0, h - top_t / 2), (w, d, top_t), bevel=bev, seg=2)
    if apron:
        box(m, leg, (0, 0, h - top_t - 0.05), (w - 0.12, d - 0.12, 0.1))
    for sx in (-1, 1):
        for sy in (-1, 1):
            if legs == 'square':
                box(m, leg, (sx * (w / 2 - 0.07), sy * (d / 2 - 0.07), (h - top_t) / 2), (0.05, 0.05, h - top_t))
            else:
                a = Vector((sx * (w / 2 - 0.08), sy * (d / 2 - 0.08), 0))
                tube(m, leg, a + Vector((sx * 0.03, sy * 0.03, 0)), a + Vector((0, 0, h - top_t)), 0.014, 8 if lod == 0 else 4, caps=True, r2=0.02)


@model('table_wood', 'table', (1.4, 0.85, 0.75), ctx=('house',), ao=0.5, wall=None, group='kitchen')
def m_table_wood(lod):
    m = Mesh()
    w, d, h = 1.4, 0.85, 0.75
    table_top_legs(m, lod, w, d, h, 'wood_teak', 'wood_teak')
    for a in (-0.35, 0.35):
        for b in (-1, 1):
            dining_chair(m, a * w, b * (d / 2 + 0.3), -b, lod)
    if lod == 0:  # tudung saji (penutup makanan anyaman) + taplak kecil
        box(m, 'fab_white', (0, 0, h + 0.002), (0.7, 0.4, 0.004))
        lathe(m, 'fab_rattan', [(0.0, h + 0.004), (0.2, h + 0.004), (0.19, h + 0.06), (0.15, h + 0.13), (0.08, h + 0.17), (0.0, h + 0.18)], 18, M=T(0, 0, 0))
        lathe(m, 'fab_rattan', [(0.0, h + 0.18), (0.015, h + 0.18), (0.015, h + 0.21), (0.0, h + 0.21)], 8, M=T(0, 0, 0))
    m.px((0, 0, h - 0.02), (w, d, 0.04), 'wood_teak')
    m.px((0, 0, (h - 0.04) / 2), (w - 0.1, d - 0.1, h - 0.04), 'wood_teak')
    for b in (-1, 1):
        m.px((0, b * (d / 2 + 0.3), 0.45), (w * 0.9, 0.42, 0.9), 'wood_teak')
    return m, {}


@model('table_modern', 'table', (1.4, 0.85, 0.75), ctx=('house',), ao=0.5, wall=None, group='kitchen')
def m_table_modern(lod):
    m = Mesh()
    w, d, h = 1.4, 0.85, 0.75
    table_top_legs(m, lod, w, d, h, 'stone_marble', 'metal_black', top_t=0.03, apron=False, legs='round')
    for a in (-0.35, 0.35):
        for b in (-1, 1):
            dining_chair(m, a * w, b * (d / 2 + 0.3), -b, lod, frame='metal_black', seat='tfab_main', back='uph')
    if lod == 0:
        lathe(m, 'ceramic', [(0.0, h), (0.05, h), (0.06, h + 0.12), (0.035, h + 0.2), (0.04, h + 0.22)], 14, M=T(0.0, 0.0, 0))
        for k in range(7):
            a = k * 0.9
            tip = Vector((math.cos(a) * 0.09, math.sin(a) * 0.09, h + 0.36 + 0.04 * (k % 2)))
            tube(m, 'stem', (0, 0, h + 0.18), tip, 0.003, 4)
            leaf_blade(m, 'leaf_mid', tip, (math.cos(a), math.sin(a), 0.5), 0.08, 0.03, curl=0.2, segs=3, lod=lod)
    m.px((0, 0, h - 0.015), (w, d, 0.03), 'stone_marble')
    for b in (-1, 1):
        m.px((0, b * (d / 2 + 0.3), 0.45), (w * 0.9, 0.42, 0.9), 'tfab_main', 1)
    return m, {}


# ================================================================ KAMAR MANDI
@model('toilet_std', 'toilet', (0.42, 0.66, 0.75), ctx=('house',), ao=0.5, group='bath')
def m_toilet_std(lod):
    m = Mesh()
    w, d, h = 0.42, 0.66, 0.75
    nu = 16 if lod == 0 else 8
    # alas (kaki) → mangkuk → dudukan & tutup; tangki di belakang (−y)
    cushion(m, 'ceramic', (0, 0.05, 0.11), (0.24, 0.38, 0.22), ep=0.45, ev=0.7, lod=lod)
    cushion(m, 'ceramic', (0, 0.07, 0.3), (0.37, 0.5, 0.2), ep=0.5, ev=0.55, lod=lod)
    cushion(m, 'ceramic', (0, 0.07, 0.4), (0.38, 0.5, 0.04), ep=0.55, ev=0.4, lod=lod)  # dudukan
    cushion(m, 'ceramic', (0, 0.06, 0.435), (0.36, 0.46, 0.03), ep=0.55, ev=0.4, lod=lod)  # tutup
    cushion(m, 'ceramic', (0, -d / 2 + 0.11, 0.6), (0.4, 0.2, 0.32), ep=0.25, ev=0.3, lod=lod)  # tangki
    box(m, 'ceramic', (0, -d / 2 + 0.11, 0.765), (0.41, 0.21, 0.03), bevel=0.01 if lod == 0 else 0, seg=2)
    cyl(m, 'chrome', 0, -d / 2 + 0.11, 0.78, 0.028, 0.028, 0.008, 12 if lod == 0 else 6)  # tombol siram
    if lod == 0:  # semprotan bidet (jet washer) tergantung di dinding samping tangki
        box(m, 'chrome', (0.17, -d / 2 + 0.02, 0.62), (0.04, 0.03, 0.06), bevel=0.006, seg=2)
        tube(m, 'chrome', (0.17, -d / 2 + 0.04, 0.6), (0.175, -d / 2 + 0.06, 0.72), 0.012, 8, caps=True)
        pts = [(0.17, -d / 2 + 0.035, 0.6), (0.19, -d / 2 + 0.03, 0.45), (0.2, -d / 2 + 0.03, 0.3), (0.18, -d / 2 + 0.02, 0.25)]
        for a, b in zip(pts, pts[1:]):
            tube(m, 'chrome', a, b, 0.005, 5)
    m.px((0, 0.05, 0.23), (0.38, 0.52, 0.46), 'ceramic')
    m.px((0, -d / 2 + 0.11, 0.62), (0.41, 0.21, 0.3), 'ceramic')
    return m, {}


# wastafel: +y = dinding (cermin), pengguna berdiri di −y (lihat interiors.js drawFurn 'sink')
@model('sink_vanity', 'sink', (0.6, 0.46, 0.85), ctx=('house',), ao=0.5, wall='+y', group='bath')
def m_sink_vanity(lod):
    m = Mesh()
    w, d, h = 0.6, 0.46, 0.85
    bev = 0.005 if lod == 0 else 0
    box(m, 'wood_oak', (0, 0.01, 0.48), (w, d - 0.02, 0.56), bevel=bev)  # kabinet gantung
    box(m, 'wood_oak', (0, -d / 2 + 0.008, 0.48), (w - 0.01, 0.016, 0.54), bevel=bev)
    handle(m, 'chrome', 0, -d / 2 - 0.0, 0.7, 0.3, 'x', lod, out=-0.016)
    box(m, 'stone_marble', (0, 0, 0.78), (w + 0.02, d, 0.04), bevel=0.004 if lod == 0 else 0)
    # mangkuk wastafel di atas meja
    sg = 24 if lod == 0 else 10
    lathe(m, 'ceramic', [(0.0, 0.8), (0.1, 0.8), (0.17, 0.83), (0.2, 0.88), (0.205, 0.9), (0.19, 0.9), (0.16, 0.855), (0.09, 0.825), (0.0, 0.82)], sg, M=T(0, -0.03, 0) @ S(1, 0.8, 1))
    # keran tinggi di belakang (sisi dinding)
    cyl(m, 'chrome', 0, 0.17, 0.8, 0.02, 0.018, 0.2, 10 if lod == 0 else 5)
    tube(m, 'chrome', (0, 0.17, 0.99), (0, 0.06, 0.99), 0.011, 8, caps=True)
    if lod == 0:
        tube(m, 'chrome', (0.0, 0.17, 1.0), (0.06, 0.2, 1.03), 0.006, 6, caps=True)
        lathe(m, 'plastic_pink', [(0.0, 0.8), (0.03, 0.8), (0.03, 0.92), (0.015, 0.94), (0.01, 0.97), (0.0, 0.97)], 10, M=T(0.22, 0.12, 0))  # sabun cair
        lathe(m, 'glass_clear', [(0.0, 0.8), (0.03, 0.8), (0.033, 0.9), (0.0, 0.9)], 10, M=T(-0.22, 0.12, 0))  # gelas sikat gigi
        tube(m, 'plastic_blue', (-0.22, 0.12, 0.82), (-0.23, 0.13, 0.98), 0.005, 5)
        tube(m, 'plastic_red', (-0.21, 0.115, 0.82), (-0.2, 0.12, 0.97), 0.005, 5)
    # cermin dinding berbingkai + rak kaca kecil
    box(m, 'metal_black', (0, d / 2 - 0.01, 1.5), (0.52, 0.02, 0.74))
    box(m, 'mirror', (0, d / 2 - 0.022, 1.5), (0.49, 0.004, 0.71))
    box(m, 'glass_clear', (0, d / 2 - 0.07, 1.09), (0.5, 0.12, 0.008))
    m.px((0, 0.01, 0.5), (w, d - 0.02, 0.64), 'wood_oak')
    m.px((0, 0, 0.84), (w, d, 0.08), 'ceramic')
    return m, {}


@model('shower_glass', 'shower', (0.92, 0.92, 2.0), ctx=('house',), ao=0.45, wall=None, group='bath')
def m_shower_glass(lod):
    m = Mesh()
    w, d, h = 0.92, 0.92, 2.0
    # nampan shower + saluran
    box(m, 'ceramic', (0, 0, 0.03), (w, d, 0.06), bevel=0.01 if lod == 0 else 0, seg=2)
    if lod == 0:
        box(m, 'steel', (0.15, 0.15, 0.061), (0.1, 0.1, 0.002))
    # kaca: panel tetap di +x (penuh) dan di +y (sebagian, pintu di ujung +x)
    gz0, gz1 = 0.06, 1.95
    box(m, 'glass_clear', (w / 2 - 0.01, 0, (gz0 + gz1) / 2), (0.008, d - 0.02, gz1 - gz0))
    gx0, gx1 = -w / 2, w / 2 - 0.5
    box(m, 'glass_clear', ((gx0 + gx1) / 2, d / 2 - 0.01, (gz0 + gz1) / 2), (gx1 - gx0, 0.008, gz1 - gz0))
    # profil aluminium
    for (c, s) in (((w / 2 - 0.01, 0, gz1 + 0.01), (0.03, d, 0.02)), (((gx0 + gx1) / 2, d / 2 - 0.01, gz1 + 0.01), (gx1 - gx0, 0.03, 0.02)),
                   ((w / 2 - 0.01, d / 2 - 0.01, (gz0 + gz1) / 2), (0.03, 0.03, gz1 - gz0)), ((gx1, d / 2 - 0.01, (gz0 + gz1) / 2), (0.02, 0.03, gz1 - gz0)),
                   ((w / 2 - 0.01, -d / 2 + 0.01, (gz0 + gz1) / 2), (0.03, 0.02, gz1 - gz0))):
        box(m, 'alu', c, s)
    # tiang shower di pojok (−x, −y): pipa tegak, kepala hujan, keran, shower tangan
    cx, cy = -w / 2 + 0.1, -d / 2 + 0.05
    cyl(m, 'chrome', cx, cy, 0.9, 0.012, 0.012, 1.05, 8 if lod == 0 else 4)
    tube(m, 'chrome', (cx, cy, 1.94), (cx + 0.2, cy + 0.2, 1.94), 0.01, 8 if lod == 0 else 4)
    cyl(m, 'chrome', cx + 0.2, cy + 0.2, 1.91, 0.11, 0.1, 0.02, 20 if lod == 0 else 8)
    box(m, 'chrome', (cx, cy + 0.01, 1.0), (0.18, 0.05, 0.06), bevel=0.01 if lod == 0 else 0, seg=2)
    if lod == 0:
        for s in (-1, 1):
            cyl(m, 'chrome', 0, 0, 0, 0.025, 0.022, 0.03, 10, M=T(cx + s * 0.07, cy + 0.035, 1.0) @ Rx(-90))
        tube(m, 'chrome', (cx + 0.12, cy + 0.02, 1.25), (cx + 0.13, cy + 0.06, 1.45), 0.014, 8, caps=True)
        lathe(m, 'chrome', [(0.0, 0.0), (0.035, 0.0), (0.03, 0.03), (0.0, 0.03)], 12, M=T(cx + 0.13, cy + 0.07, 1.47) @ Rx(-60))
        # ember + gayung di nampan
        lathe(m, 'plastic_blue', [(0.0, 0.06), (0.12, 0.06), (0.15, 0.36), (0.155, 0.37), (0.145, 0.37), (0.115, 0.08), (0.0, 0.08)], 18, M=T(0.18, 0.12, 0))
        cyl(m, 'ceramic_blue', 0.18, 0.12, 0.3, 0.135, 0.135, 0.004, 16)  # permukaan air
        lathe(m, 'plastic_pink', [(0.0, 0.0), (0.06, 0.0), (0.07, 0.1), (0.065, 0.1), (0.055, 0.01), (0.0, 0.01)], 12, M=T(0.12, 0.08, 0.31))
        tube(m, 'plastic_pink', (0.12, 0.08, 0.38), (0.0, 0.02, 0.45), 0.01, 6, caps=True)
        # rak sudut: botol sampo
        box(m, 'glass_clear', (-w / 2 + 0.1, -d / 2 + 0.1, 1.2), (0.18, 0.18, 0.008))
        for k, mat in enumerate(('plastic_white', 'plastic_orange', 'plastic_green')):
            lathe(m, mat, [(0.0, 1.2), (0.025, 1.2), (0.025, 1.36 - 0.03 * k), (0.012, 1.38 - 0.03 * k), (0.0, 1.38 - 0.03 * k)], 10, M=T(-w / 2 + 0.06 + k * 0.045, -d / 2 + 0.07 + 0.02 * (k % 2), 0))
    m.px((0, 0, 0.03), (w, d, 0.06), 'ceramic')
    m.px((w / 2 - 0.01, 0, 1.0), (0.02, d, 1.9), 'alu')
    return m, {}


# ================================================================ TOKO (RUKO)
# Rak dinding & gondola: MODUL selebar 1 m (game mengulang modul sepanjang w; lebar modul = w / round(w)).
def shelf_levels(z0, top, n):
    return [z0 + (top - z0) * k / n for k in range(n)]


@model('rack_grocery', 'rack', (1.0, 0.45, 1.9), ctx=('shop', 'hall'), ao=0.5, tile=1.0, group='shop')
def m_rack_grocery(lod, mix=('grocery', 'snack', 'grocery', 'household', 'snack'), seed=101):
    m = Mesh()
    w, d, h = 1.0, 0.45, 1.9
    rng = random.Random(seed)
    for s in (-1, 1):  # tiang samping berlubang
        box(m, 'paint_white', (s * (w / 2 - 0.015), 0, h / 2), (0.03, d, h))
    box(m, 'paint_white', (0, -d / 2 + 0.01, h / 2), (w - 0.06, 0.02, h))  # punggung
    box(m, 'paint_grey', (0, 0.01, 0.06), (w - 0.06, d - 0.02, 0.12))  # plint
    zs = [0.12, 0.47, 0.82, 1.17, 1.52]
    for i, z in enumerate(zs):
        box(m, 'paint_white', (0, 0.0, z - 0.012), (w - 0.06, d - 0.02, 0.024))
        box(m, 'plastic_white', (0, d / 2 - 0.012, z - 0.025), (w - 0.06, 0.012, 0.04))  # rel label harga
        if lod == 0:
            for k in range(3):
                box(m, 'paint_yellow', (-0.3 + k * 0.3, d / 2 - 0.005, z - 0.025), (0.05, 0.003, 0.028))
        top = (zs[i + 1] if i + 1 < len(zs) else h - 0.02) - z - 0.03
        goods(m, -w / 2 + 0.035, w / 2 - 0.035, -d / 2 + 0.03, d / 2 - 0.02, z, top, rng, lod, mix=mix[i % len(mix)])
    box(m, 'paint_white', (0, 0.0, h - 0.012), (w, d, 0.024))
    m.px((0, -d / 2 + 0.03, h / 2), (w, 0.06, h), 'paint_white')
    m.px((0, 0.02, h / 2), (w, d - 0.04, h - 0.1), 'paint_white', 0, 0)
    return m, {}


@model('rack_drinks', 'rack', (1.0, 0.45, 1.9), ctx=('shop', 'hall'), ao=0.5, tile=1.0, group='shop')
def m_rack_drinks(lod):
    return m_rack_grocery(lod, mix=('drinks', 'household', 'drinks', 'household', 'grocery'), seed=102)


def gondola_module(lod, end=False, seed=111, mixes=('snack', 'grocery', 'household', 'drinks')):
    m = Mesh()
    w, d, h = 1.0, 0.9, 1.75
    rng = random.Random(seed)
    box(m, 'paint_grey', (0, 0, 0.06), (w, d - 0.04, 0.12))  # alas
    box(m, 'paint_white', (0, 0, h / 2), (w, 0.04, h))  # sekat tengah (pegboard)
    if lod == 0:
        for k in range(10):
            box(m, 'paint_grey', (0, 0, 0.3 + k * 0.14), (w - 0.04, 0.042, 0.006))
    for s in (-1, 1):  # tiang di ujung modul (setengah, bersambung dengan modul sebelah)
        box(m, 'paint_white', (s * (w / 2 - 0.01), 0, h / 2), (0.02, 0.06, h))
    zs = [0.12, 0.52, 0.92, 1.32]
    for side in (-1, 1):
        for i, z in enumerate(zs):
            y0, y1 = side * 0.03, side * (d / 2 - 0.02)
            yc = (y0 + y1) / 2
            box(m, 'paint_white', (0, yc, z - 0.012), (w - 0.02, abs(y1 - y0), 0.024))
            box(m, 'plastic_white', (0, y1 + side * 0.006, z - 0.025), (w - 0.02, 0.012, 0.04))
            top = (zs[i + 1] if i + 1 < len(zs) else h - 0.03) - z - 0.03
            sub = Mesh()
            goods(sub, -w / 2 + 0.02, w / 2 - 0.02, 0.03, d / 2 - 0.03, z, top, rng, lod, mix=mixes[(i + (side > 0)) % len(mixes)], two_sided=False)
            merge_mesh(m, sub, None if side > 0 else Rz(180))
    box(m, 'paint_white', (0, 0, h - 0.015), (w, 0.08, 0.03))
    if end:  # panel ujung (−x) + papan promo
        box(m, 'paint_purple', (-w / 2 + 0.015, 0, h / 2 + 0.03), (0.03, d, h + 0.06), bevel=0.006 if lod == 0 else 0)
        quad(m, 'atlas_misc', [(-w / 2 - 0.002, d / 2 - 0.08, 0.75), (-w / 2 - 0.002, -d / 2 + 0.08, 0.75), (-w / 2 - 0.002, -d / 2 + 0.08, 1.5), (-w / 2 - 0.002, d / 2 - 0.08, 1.5)],
             uvs=[(MISC['cake'] + 0.02, 0.02), (MISC['cake'] + 0.98, 0.02), (MISC['cake'] + 0.98, 0.98), (MISC['cake'] + 0.02, 0.98)])
    m.px((0, 0, h / 2), (w, d - 0.04, h), 'paint_white', 0, 3, two=True)
    return m, {}


@model('gondola_mid', 'gondola', (1.0, 0.9, 1.75), ctx=('shop', 'hall'), ao=0.5, wall=None, tile=1.0, group='shop')
def m_gondola_mid(lod):
    return gondola_module(lod, False, 111)


@model('gondola_end', 'gondola', (1.0, 0.9, 1.75), ctx=('shop', 'hall'), ao=0.5, wall=None, tile=1.0, group='shop')
def m_gondola_end(lod):
    return gondola_module(lod, True, 112)


# ---------- meja kasir (pelanggan di −y, kasir di +y)
@model('cashier_std', 'cashier', (1.2, 0.6, 1.0), ctx=('shop',), ao=0.5, wall=None, group='shop')
def m_cashier_std(lod):
    m = Mesh()
    w, d, h = 1.2, 0.6, 1.0
    rng = random.Random(121)
    box(m, 'paint_black', (0, 0, 0.05), (w - 0.04, d - 0.06, 0.1))
    box(m, 'paint_white', (0, 0, 0.53), (w, d, 0.86), bevel=0.006 if lod == 0 else 0)
    box(m, 'paint_purple', (0, -d / 2 - 0.004, 0.62), (w - 0.02, 0.01, 0.3))  # panel depan berwarna
    if lod == 0:
        box(m, 'gold', (0, -d / 2 - 0.01, 0.47), (w - 0.02, 0.006, 0.02))
    box(m, 'stone_granite', (0, 0, h - 0.02), (w + 0.04, d + 0.04, 0.04), bevel=0.004 if lod == 0 else 0)
    # mesin kasir: layar menghadap kasir (+y), laci uang, pemindai
    box(m, 'plastic_black', (0.25, 0.1, h + 0.05), (0.4, 0.3, 0.1), bevel=0.01 if lod == 0 else 0, seg=2)
    M = T(0.25, 0.08, h + 0.1) @ Rx(-15)
    box(m, 'plastic_black', (0, 0, 0.13), (0.36, 0.03, 0.24), M=M)
    sub = Mesh()
    quad(sub, 'atlas_misce', [(0.17, 0.016, 0.03), (-0.17, 0.016, 0.03), (-0.17, 0.016, 0.24), (0.17, 0.016, 0.24)],
         uvs=[(MISC['pos'] + 0.01, 0.01), (MISC['pos'] + 0.99, 0.01), (MISC['pos'] + 0.99, 0.99), (MISC['pos'] + 0.01, 0.99)])
    merge_mesh(m, sub, M)
    if lod == 0:
        box(m, 'plastic_black', (-0.15, 0.12, h + 0.02), (0.1, 0.14, 0.04), bevel=0.01, seg=2)  # pemindai
        box(m, 'plastic_grey', (-0.38, -0.12, h + 0.006), (0.3, 0.2, 0.012))  # alas uang
        # rak permen di depan
        for k in range(3):
            z = h + 0.02 + k * 0.1
            box(m, 'alu', (-0.33, -0.22, z), (0.42, 0.14, 0.008))
            goods(m, -0.53, -0.13, -0.29, -0.15, z + 0.004, 0.08, rng, lod, mix='snack')
        for s in (-1, 1):
            box(m, 'alu', (-0.33 + s * 0.21, -0.22, h + 0.16), (0.01, 0.14, 0.32))
    m.px((0, 0, h / 2), (w, d, h), 'paint_white')
    return m, {}


# ---------- kulkas minuman 3 pintu kaca (isi: foto deret botol + botol depan)
@model('fridge2_cooler', 'fridge2', (3.0, 0.7, 2.0), ctx=('shop', 'hall'), ao=0.45, group='shop')
def m_fridge2_cooler(lod):
    m = Mesh()
    w, d, h = 3.0, 0.7, 2.0
    rng = random.Random(131)
    box(m, 'paint_black', (0, -0.02, 0.06), (w - 0.04, d - 0.08, 0.12))
    box(m, 'plastic_white', (0, -d / 2 + 0.03, h / 2), (w, 0.06, h))  # punggung
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        box(m, 'plastic_white', (x, 0, h / 2), (0.06, d, h))
    box(m, 'plastic_white', (0, 0, h - 0.11), (w, d, 0.22))  # kepala (papan nama)
    box(m, 'plastic_white', (0, 0, 0.17), (w, d, 0.1))
    sub = Mesh()
    quad(sub, 'atlas_misce', [(-w / 2 + 0.08, d / 2 + 0.002, h - 0.2), (w / 2 - 0.08, d / 2 + 0.002, h - 0.2), (w / 2 - 0.08, d / 2 + 0.002, h - 0.02), (-w / 2 + 0.08, d / 2 + 0.002, h - 0.02)],
         uvs=[(MISC['kiosk_a'] + 0.0, 0.0), (MISC['kiosk_a'] + 1.0, 0.0), (MISC['kiosk_a'] + 1.0, 1.0), (MISC['kiosk_a'] + 0.0, 1.0)])
    merge_mesh(m, sub)
    z0, z1 = 0.22, h - 0.22
    # dinding dalam belakang: foto deret minuman (menyala)
    quad(m, 'atlas_misce', [(-w / 2 + 0.06, -d / 2 + 0.061, z0), (w / 2 - 0.06, -d / 2 + 0.061, z0), (w / 2 - 0.06, -d / 2 + 0.061, z1), (-w / 2 + 0.06, -d / 2 + 0.061, z1)],
         uvs=[(MISC['cooler'] + 0.001, 0.001), (MISC['cooler'] + 2.999 - 2, 0.001), (MISC['cooler'] + 0.999, 0.999), (MISC['cooler'] + 0.001, 0.999)])
    box(m, 'emit_white', (0, 0.1, z1 - 0.01), (w - 0.14, 0.04, 0.012))  # lampu dalam
    zs = [z0 + 0.02, z0 + 0.36, z0 + 0.7, z0 + 1.04, z0 + 1.38]
    for z in zs:
        box(m, 'alu', (0, 0.0, z - 0.008), (w - 0.12, d - 0.14, 0.012))
        if lod == 0:
            x = -w / 2 + 0.1
            while x < w / 2 - 0.12:
                rad = 0.032
                cell = rng.randrange(N_GOODS)
                bottle(m, x + rad, 0.19, z, rad, 0.27, cell)
                x += rad * 2 + 0.012
                if abs(x - (-0.5)) < 0.05 or abs(x - 0.5) < 0.05:
                    x += 0.06
        else:
            box(m, 'atlas_rows', (0, 0.12, z + 0.13), (w - 0.14, 0.2, 0.26), cell=1, front='+y')
    # 3 pintu kaca berbingkai + gagang panjang
    for k in range(3):
        xc = -w / 2 + 0.06 + (w - 0.12) * (k + 0.5) / 3
        dw = (w - 0.12) / 3
        for zz in (z0 - 0.01, z1 + 0.01):
            box(m, 'alu', (xc, d / 2 - 0.03, zz), (dw - 0.01, 0.04, 0.05))
        for xx in (xc - dw / 2 + 0.025, xc + dw / 2 - 0.025):
            box(m, 'alu', (xx, d / 2 - 0.03, (z0 + z1) / 2), (0.045, 0.04, z1 - z0))
        box(m, 'glass_clear', (xc, d / 2 - 0.03, (z0 + z1) / 2), (dw - 0.08, 0.01, z1 - z0 - 0.04))
        handle(m, 'alu', xc + dw / 2 - 0.08, d / 2 - 0.01, (z0 + z1) / 2, 0.7, 'z', lod, out=0.03)
    m.px((0, 0, h / 2), (w, d, h), 'plastic_white', 0, 100 + MISC['cooler'])
    return m, {}


# ---------- bar kafe (h 1,05) & meja konter toko berkaca (h 1,0); 9-slice: ujung 0,5 m tetap, tengah memanjang
@model('bar_cafe', 'bar', (3.2, 0.6, 1.05), ctx=('shop',), ao=0.5, slice_={'x': [0.55, 0.55]}, group='shop')
def m_bar_cafe(lod):
    m = Mesh()
    w, d, h = 3.2, 0.6, 1.05
    rng = random.Random(141)
    box(m, 'paint_black', (0, -0.02, 0.05), (w - 0.04, d - 0.08, 0.1))
    box(m, 'wood_dark', (0, -0.02, 0.55), (w, d - 0.06, 0.9))
    # muka depan: bilah kayu tegak
    n = int(w / 0.07) if lod == 0 else 0
    for k in range(n):
        x = -w / 2 + 0.035 + k * (w - 0.07) / max(1, n - 1)
        box(m, 'wood_oak', (x, d / 2 - 0.02, 0.55), (0.05, 0.03, 0.88), bevel=0.004)
    if lod > 0:
        box(m, 'wood_oak', (0, d / 2 - 0.02, 0.55), (w, 0.03, 0.88))
    box(m, 'wood_walnut', (0, 0.02, h - 0.025), (w + 0.04, d + 0.06, 0.05), bevel=0.008 if lod == 0 else 0, seg=2)
    # mesin espresso (ujung kiri) + penggiling + cangkir; etalase kue berkubah kaca (ujung kanan)
    ex = -w / 2 + 0.42
    box(m, 'chrome', (ex, -0.05, h + 0.2), (0.62, 0.42, 0.4), bevel=0.02 if lod == 0 else 0, seg=2)
    box(m, 'paint_red', (ex, 0.162, h + 0.3), (0.58, 0.006, 0.12))
    if lod == 0:
        for s in (-1, 1):
            cyl(m, 'metal_black', ex + s * 0.14, 0.12, h + 0.13, 0.03, 0.03, 0.06, 10)
            tube(m, 'metal_black', (ex + s * 0.14, 0.12, h + 0.15), (ex + s * 0.14, 0.28, h + 0.14), 0.01, 6, caps=True)
            lathe(m, 'ceramic', [(0.0, h + 0.02), (0.025, h + 0.02), (0.035, h + 0.08), (0.032, h + 0.08)], 10, M=T(ex + s * 0.14, 0.12, 0))
        lathe(m, 'plastic_black', [(0.0, h), (0.07, h), (0.07, h + 0.22), (0.05, h + 0.24), (0.08, h + 0.36), (0.0, h + 0.36)], 12, M=T(ex + 0.48, -0.08, 0))  # penggiling
        for k in range(4):  # tumpukan cangkir di atas mesin
            lathe(m, 'ceramic', [(0.0, 0.0), (0.03, 0.0), (0.04, 0.06), (0.036, 0.06)], 10, M=T(ex - 0.2 + k * 0.08, -0.12, h + 0.4))
    cx = w / 2 - 0.45
    box(m, 'wood_walnut', (cx, 0.0, h + 0.02), (0.5, 0.36, 0.04))
    lathe(m, 'glass_clear', [(0.22, h + 0.04), (0.22, h + 0.2), (0.18, h + 0.3), (0.08, h + 0.34), (0.0, h + 0.345)], 16 if lod == 0 else 8, M=T(cx, 0.0, 0) @ S(1, 0.75, 1))
    if lod == 0:
        lathe(m, 'food_brown', [(0.0, h + 0.04), (0.11, h + 0.04), (0.11, h + 0.13), (0.0, h + 0.13)], 18, M=T(cx, 0.0, 0))
        lathe(m, 'paint_white', [(0.0, h + 0.13), (0.112, h + 0.13), (0.112, h + 0.14), (0.0, h + 0.14)], 18, M=T(cx, 0.0, 0))
        for k in range(4):
            box(m, 'food_red', (cx - 0.06 + k * 0.04, 0.0, h + 0.15), (0.02, 0.02, 0.02), bevel=0.008, seg=2)
        # wadah sedotan & menu kecil di tengah
        lathe(m, 'glass_clear', [(0.0, h), (0.04, h), (0.04, h + 0.15), (0.0, h + 0.15)], 10, M=T(0.1, 0.15, 0))
        for k in range(6):
            tube(m, ('paper', 'plastic_red')[k % 2], (0.1 + (k - 2.5) * 0.01, 0.15, h + 0.01), (0.1 + (k - 2.5) * 0.02, 0.15 + (k % 2) * 0.01, h + 0.21), 0.003, 4)
    # rak ambang dinding belakang (di luar tapak, menempel dinding y = −0,45, di atas meja bar): toples biji kopi, cangkir
    box(m, 'wood_walnut', (w / 2 - 0.65, -0.39, 1.42), (1.1, 0.12, 0.03))
    if lod == 0:
        for k in range(5):
            x = w / 2 - 1.1 + k * 0.2
            lathe(m, 'glass_clear', [(0.0, 1.435), (0.045, 1.435), (0.045, 1.6), (0.03, 1.62), (0.0, 1.62)], 10, M=T(x, -0.39, 0))
            lathe(m, ('food_brown', 'wood_dark', 'food_orange')[k % 3], [(0.0, 1.44), (0.042, 1.44), (0.042, 1.54), (0.0, 1.54)], 10, M=T(x, -0.39, 0))
    # papan menu di dinding belakang (di luar tapak, menempel dinding di y = −0,45)
    box(m, 'wood_dark', (-0.3, -0.445, 1.95), (1.4, 0.02, 0.62))
    quad(m, 'atlas_misc', [(-0.97, -0.434, 1.67), (0.37, -0.434, 1.67), (0.37, -0.434, 2.23), (-0.97, -0.434, 2.23)],
         uvs=[(MISC['menu'] + 0.005, 0.005), (MISC['menu'] + 0.995, 0.005), (MISC['menu'] + 0.995, 0.995), (MISC['menu'] + 0.005, 0.995)])
    m.px((0, -0.02, h / 2), (w, d - 0.04, h), 'wood_oak')
    m.px((ex, -0.05, h + 0.2), (0.62, 0.42, 0.4), 'chrome')
    m.px((-0.3, -0.445, 1.95), (1.4, 0.02, 0.62), 'wood_dark', 0, MISC['menu'] + 100)
    return m, {}


@model('bar_toko', 'bar', (2.6, 0.6, 1.0), ctx=('shop',), ao=0.5, slice_={'x': [0.5, 0.5]}, group='shop')
def m_bar_toko(lod):
    m = Mesh()
    w, d, h = 2.6, 0.6, 1.0
    rng = random.Random(142)
    box(m, 'paint_black', (0, 0, 0.05), (w - 0.04, d - 0.06, 0.1))
    box(m, 'wood_white', (0, 0, 0.3), (w, d, 0.4))  # laci bawah
    for s in (-1, 1):  # rangka kaca etalase
        box(m, 'alu', (s * (w / 2 - 0.015), 0, 0.75), (0.03, d, 0.5))
    for sy in (-1, 1):
        box(m, 'alu', (0, sy * (d / 2 - 0.015), h - 0.015), (w, 0.03, 0.03))
        box(m, 'alu', (0, sy * (d / 2 - 0.015), 0.515), (w, 0.03, 0.03))
    box(m, 'glass_clear', (0, 0, h - 0.004), (w - 0.06, d - 0.06, 0.008))  # kaca atas
    box(m, 'glass_clear', (0, d / 2 - 0.015, 0.765), (w - 0.06, 0.008, 0.47))  # kaca depan
    box(m, 'glass_clear', (0, 0, 0.75), (w - 0.06, d - 0.08, 0.006))  # rak kaca
    box(m, 'emit_white', (0, 0, h - 0.04), (w - 0.1, 0.02, 0.01))
    goods(m, -w / 2 + 0.05, w / 2 - 0.05, -d / 2 + 0.05, d / 2 - 0.05, 0.53, 0.18, rng, lod, mix='toko')
    goods(m, -w / 2 + 0.05, w / 2 - 0.05, -d / 2 + 0.05, d / 2 - 0.05, 0.756, 0.2, rng, lod, mix='toko')
    # mesin kasir kecil di ujung
    box(m, 'plastic_black', (w / 2 - 0.3, -0.05, h + 0.06), (0.32, 0.3, 0.12), bevel=0.01 if lod == 0 else 0, seg=2)
    m.px((0, 0, h / 2), (w, d, h), 'wood_white', 0, 4)
    return m, {}


# ---------- meja kafe + kursi (2 di tiap sisi panjang; kursi di luar tapak meja sejauh collider)
@model('table_bistro', 'table', (1.2, 0.8, 0.75), ctx=('shop', 'hall'), ao=0.5, wall=None, group='shop')
def m_table_bistro(lod):
    m = Mesh()
    w, d, h = 1.2, 0.8, 0.75
    table_top_legs(m, lod, w, d, h, 'wood_oak', 'metal_black', top_t=0.035, apron=False, legs='round')
    for a in (-0.35, 0.35):
        for b in (-1, 1):
            dining_chair(m, a * w, b * (d / 2 + 0.3), -b, lod, frame='metal_black', seat='wood_oak', back='wood')
    if lod == 0:
        box(m, 'atlas_misc', (0.0, 0.0, h + 0.07), (0.1, 0.06, 0.14), cell=MISC['menu'], front='+y')
        for s in (-1, 1):
            lathe(m, 'glass_clear', [(0.0, h), (0.03, h), (0.035, h + 0.13), (0.0, h + 0.13)], 10, M=T(s * 0.3, s * 0.12, 0))
            lathe(m, 'food_brown', [(0.0, h + 0.005), (0.03, h + 0.005), (0.033, h + 0.1), (0.0, h + 0.1)], 10, M=T(s * 0.3, s * 0.12, 0))
    m.px((0, 0, h - 0.02), (w, d, 0.04), 'wood_oak')
    for b in (-1, 1):
        m.px((0, b * (d / 2 + 0.3), 0.45), (w * 0.9, 0.42, 0.9), 'metal_black')
    return m, {}


@model('table_rattan', 'table', (1.2, 0.8, 0.75), ctx=('shop', 'hall'), ao=0.5, wall=None, group='shop')
def m_table_rattan(lod):
    m = Mesh()
    w, d, h = 1.2, 0.8, 0.75
    table_top_legs(m, lod, w, d, h, 'stone_marble', 'brass', top_t=0.03, apron=False, legs='round')
    for a in (-0.35, 0.35):
        for b in (-1, 1):
            dining_chair(m, a * w, b * (d / 2 + 0.3), -b, lod, frame='brass', seat='fab_rattan', back='rattan')
    if lod == 0:
        lathe(m, 'terracotta', [(0.0, h), (0.04, h), (0.05, h + 0.07), (0.045, h + 0.08)], 10, M=T(0, 0, 0))
        pot_plant_soil(m, 0.044, h + 0.08, lod)
        for k in range(6):
            a = k * 2.399
            leaf_blade(m, 'leaf_mid', (0, 0, h + 0.07), (math.cos(a) * 0.6, math.sin(a) * 0.6, 1.0), 0.1, 0.035, curl=0.2, segs=3, lod=lod)
        for s in (-1, 1):
            lathe(m, 'ceramic', [(0.0, h), (0.04, h), (0.045, h + 0.07), (0.042, h + 0.07)], 10, M=T(s * 0.3, -s * 0.12, 0))
    m.px((0, 0, h - 0.015), (w, d, 0.03), 'stone_marble')
    for b in (-1, 1):
        m.px((0, b * (d / 2 + 0.3), 0.45), (w * 0.9, 0.42, 0.9), 'fab_rattan')
    return m, {}


# ---------- meja pajang toko (sepatu, tas, pakaian terlipat)
@model('display_table', 'display', (2.4, 0.9, 0.9), ctx=('shop',), ao=0.5, wall=None, group='shop')
def m_display_table(lod):
    m = Mesh()
    w, d, h = 2.4, 0.9, 0.9
    rng = random.Random(151)
    box(m, 'wood_oak', (0, 0, h - 0.025), (w, d, 0.05), bevel=0.006 if lod == 0 else 0, seg=2)
    for sx in (-1, 1):
        box(m, 'wood_oak', (sx * (w / 2 - 0.03), 0, (h - 0.05) / 2), (0.06, d, h - 0.05))
    box(m, 'wood_oak', (0, 0, 0.25), (w - 0.1, d - 0.06, 0.03))  # rak bawah
    if lod == 0:
        # tumpukan pakaian terlipat (warna instans) + kotak sepatu di rak bawah + tas
        for k in range(5):
            x = -w / 2 + 0.3 + k * 0.45
            for j in range(3 + (k % 2)):
                cushion(m, 'tfab_main' if k % 2 == 0 else 'tfab_acc', (x, -0.15 + (k % 2) * 0.3, h + 0.025 + j * 0.045), (0.34, 0.26, 0.045), ep=0.2, ev=0.5, lod=1)
        for k in range(6):
            box(m, 'atlas_goods', (-w / 2 + 0.25 + k * 0.38, 0.0, 0.33), (0.32, 0.2, 0.12), cell=rng.randrange(N_GOODS), front='+y')
        for k in range(2):
            x = 0.6 + k * 0.5
            cushion(m, 'tleather', (x, 0.25, h + 0.12), (0.3, 0.12, 0.2), ep=0.2, ev=0.3, lod=1)
            tube(m, 'tleather', (x - 0.08, 0.25, h + 0.21), (x, 0.25, h + 0.3), 0.008, 5)
            tube(m, 'tleather', (x, 0.25, h + 0.3), (x + 0.08, 0.25, h + 0.21), 0.008, 5)
    else:
        box(m, 'tfab_main', (0, 0, h + 0.08), (w - 0.3, d - 0.3, 0.12))
    m.px((0, 0, h / 2), (w, d, h), 'wood_oak')
    m.px((0, 0, h + 0.07), (w - 0.3, d - 0.3, 0.14), 'tfab_main', 1)
    return m, {}


# ================================================================ MAL (AULA)
# kolom: 9-slice tegak — 2,6 m bawah (alas & lis) tetap, 0,3 m atas (kepala) menempel plafon, tengah memanjang
@model('column_marble', 'column', (0.7, 0.7, 4.6), ctx=('hall', 'tower'), ao=0.25, wall=None, slice_={'z': [2.6, 0.3]}, group='hall')
def m_column_marble(lod):
    m = Mesh()
    w, h = 0.7, 4.6
    box(m, 'stone_marble', (0, 0, h / 2), (w - 0.04, w - 0.04, h))
    box(m, 'steel', (0, 0, 0.06), (w, w, 0.12), bevel=0.004 if lod == 0 else 0)
    box(m, 'gold', (0, 0, 2.4), (w - 0.03, w - 0.03, 0.03))
    box(m, 'paint_cream', (0, 0, h - 0.1), (w + 0.06, w + 0.06, 0.2), bevel=0.01 if lod == 0 else 0, seg=2)
    if lod == 0:  # nat panel marmer
        for z in (1.2, 3.4):
            box(m, 'stone_dark', (0, 0, z), (w - 0.035, w - 0.035, 0.006))
    m.px((0, 0, h / 2), (w, w, h), 'stone_marble')
    return m, {}


@model('column_round', 'column', (0.7, 0.7, 4.6), ctx=('hall', 'tower'), ao=0.25, wall=None, slice_={'z': [2.6, 0.3]}, group='hall')
def m_column_round(lod):
    m = Mesh()
    w, h = 0.7, 4.6
    sg = 28 if lod == 0 else 12
    cyl(m, 'paint_cream', 0, 0, 0, w / 2 - 0.02, w / 2 - 0.02, h, sg, caps=False)
    lathe(m, 'brass', [(w / 2, 0.0), (w / 2, 0.14), (w / 2 - 0.02, 0.16)], sg)
    lathe(m, 'emit_white', [(w / 2 - 0.015, 3.6), (w / 2 - 0.015, 3.66)], sg)
    lathe(m, 'paint_cream', [(w / 2 - 0.02, h - 0.3), (w / 2 + 0.03, h - 0.18), (w / 2 + 0.03, h)], sg)
    m.px((0, 0, h / 2), (w * 0.9, w * 0.9, h), 'paint_cream')
    return m, {}


# ---------- kios pulau (meja 1,15 m, tiang & atap papan nama 2,3–2,42 m)
def kiosk_frame(m, lod, cell, body='paint_purple', trim='gold'):
    w = 2.4
    hc = 1.15
    box(m, 'paint_black', (0, 0, 0.05), (w - 0.06, w - 0.06, 0.1))
    # meja keliling dengan bukaan masuk 0,7 m di sisi −y (kanan)
    box(m, body, (0, w / 2 - 0.25, 0.55), (w, 0.5, 0.9))
    for s in (-1, 1):
        box(m, body, (s * (w / 2 - 0.25), 0.0, 0.55), (0.5, w - 1.0, 0.9))
    box(m, body, (-0.35, -w / 2 + 0.25, 0.55), (w - 0.7, 0.5, 0.9))
    for (c, s) in (((0, w / 2 - 0.25, hc - 0.1), (w + 0.04, 0.54, 0.2)), ((-w / 2 + 0.25, 0, hc - 0.1), (0.54, w - 1.0, 0.2)),
                   ((w / 2 - 0.25, 0, hc - 0.1), (0.54, w - 1.0, 0.2)), ((-0.35, -w / 2 + 0.25, hc - 0.1), (w - 0.66, 0.54, 0.2))):
        box(m, 'glass_clear', (c[0], c[1], c[2] + 0.04), (s[0] - 0.04, s[1] - 0.04, 0.16))
        box(m, trim, (c[0], c[1], hc - 0.004), (s[0], s[1], 0.008))
        box(m, trim, (c[0], c[1], hc - 0.2), (s[0], s[1], 0.02))
    # tiang sudut emas + atap berpapan nama 4 sisi
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(m, trim, sx * (w / 2 - 0.05), sy * (w / 2 - 0.05), hc, 0.025, 0.025, 2.3 - hc, 10 if lod == 0 else 4)
    box(m, body, (0, 0, 2.36), (w, w, 0.12))
    for k in range(4):
        R = Rz(90 * k)
        sub = Mesh()
        quad(sub, 'atlas_misce', [(-w / 2 + 0.05, -w / 2 - 0.004, 2.3), (w / 2 - 0.05, -w / 2 - 0.004, 2.3), (w / 2 - 0.05, -w / 2 - 0.004, 2.42), (-w / 2 + 0.05, -w / 2 - 0.004, 2.42)][::-1][::-1],
             uvs=[(cell + 0.98, 0.04), (cell + 0.02, 0.04), (cell + 0.02, 0.96), (cell + 0.98, 0.96)])
        merge_mesh(m, sub, R)
    box(m, 'emit_white', (0, 0, 2.295), (w - 0.3, w - 0.3, 0.01))
    m.px((0, 0, 0.55), (w, w, 1.1), body)
    m.px((0, 0, 2.36), (w, w, 0.12), body)


@model('kiosk_phone', 'kiosk', (2.4, 2.4, 1.15), ctx=('hall',), ao=0.4, wall=None, group='hall')
def m_kiosk_phone(lod):
    m = Mesh()
    rng = random.Random(161)
    kiosk_frame(m, lod, MISC['kiosk_a'])
    if lod == 0:  # barang di dalam etalase + tampilan dinding gantung
        for (x0, x1, y) in ((-0.9, 0.9, 0.95), (-0.9, 0.3, -0.95)):
            goods(m, x0, x1, y - 0.12, y + 0.12, 0.98, 0.12, rng, lod, mix='toko')
        # papan gantung di tengah (casing ponsel)
        box(m, 'paint_white', (0, 0.0, 1.7), (1.0, 0.04, 0.9))
        for i in range(4):
            for j in range(3):
                box(m, 'atlas_goods', (-0.36 + i * 0.24, 0.03, 1.4 + j * 0.28), (0.1, 0.012, 0.18), cell=rng.randrange(N_GOODS), front='+y')
                box(m, 'atlas_goods', (-0.36 + i * 0.24, -0.03, 1.4 + j * 0.28), (0.1, 0.012, 0.18), cell=rng.randrange(N_GOODS), front='-y')
        cyl(m, 'tfab_main', 0.0, -0.5, 0, 0.16, 0.16, 0.65, 14)  # bangku penjaga
    return m, {}


@model('kiosk_food', 'kiosk', (2.4, 2.4, 1.15), ctx=('hall',), ao=0.4, wall=None, group='hall')
def m_kiosk_food(lod):
    m = Mesh()
    rng = random.Random(162)
    kiosk_frame(m, lod, MISC['kiosk_b'], body='wood_oak', trim='brass')
    if lod == 0:  # gelas minuman berjajar, mesin penyegel, termos
        for k in range(10):
            x = -0.9 + k * 0.2
            lathe(m, 'glass_clear', [(0.0, 1.15), (0.035, 1.15), (0.045, 1.33), (0.0, 1.33)], 10, M=T(x, 1.0, 0))
            lathe(m, ('food_brown', 'plastic_pink', 'food_orange', 'food_green')[k % 4], [(0.0, 1.155), (0.034, 1.155), (0.042, 1.3), (0.0, 1.3)], 10, M=T(x, 1.0, 0))
        box(m, 'steel', (0.6, -0.9, 1.35), (0.3, 0.3, 0.4), bevel=0.01, seg=2)
        for k in range(3):
            lathe(m, 'steel', [(0.0, 1.15), (0.08, 1.15), (0.08, 1.5), (0.06, 1.55), (0.0, 1.55)], 12, M=T(-0.9 + k * 0.22, -0.95, 0))
        box(m, 'atlas_misc', (0, 0.0, 1.9), (1.2, 0.03, 0.6), cell=MISC['menu'], front='+y')
        box(m, 'atlas_misc', (0, 0.0, 1.9), (1.2, 0.031, 0.6), cell=MISC['menu'], front='-y')
    return m, {}


# ---------- pot tanaman besar (terazo) + bangku mal
@model('planter_palm', 'planter', (1.6, 1.6, 0.8), ctx=('hall', 'tower'), ao=0.4, wall=None, group='hall')
def m_planter_palm(lod):
    m = Mesh()
    w, h = 1.6, 0.8
    rng = random.Random(171)
    box(m, 'stone_terrazzo', (0, 0, h / 2 - 0.03), (w - 0.04, w - 0.04, h - 0.06))
    box(m, 'stone_terrazzo', (0, 0, h - 0.03), (w, w, 0.06), bevel=0.01 if lod == 0 else 0, seg=2)
    box(m, 'soil', (0, 0, h - 0.04), (w - 0.14, w - 0.14, 0.02))
    # pohon palem: batang beruas + pelepah
    tz = h - 0.03
    sg = 10 if lod == 0 else 5
    for k in range(6):
        cyl(m, 'wood_grey', 0.0, 0.0, tz + k * 0.25, 0.07 - 0.004 * k, 0.065 - 0.004 * k, 0.25, sg)
    n = 8 if lod == 0 else 5
    for k in range(n):
        a = k * 2 * pi / n + 0.3
        palm_frond(m, (0, 0, tz + 1.5), (math.cos(a), math.sin(a), 0.5), 1.1, lod, rng, droop=0.55, nl=10 if lod == 0 else 3)
    for k in range(5 if lod == 0 else 2):  # semak kecil di tepi
        a = k * 2 * pi / 5
        cushion(m, 'leaf_dark', (math.cos(a) * 0.5, math.sin(a) * 0.5, h + 0.08), (0.36, 0.36, 0.26), ep=0.7, ev=0.7, lod=lod)
    m.px((0, 0, h / 2), (w, w, h), 'stone_terrazzo')
    m.px((0, 0, tz + 0.75), (0.14, 0.14, 1.5), 'wood_grey')
    m.px((0, 0, tz + 1.45), (2.0, 2.0, 0.4), 'leaf_palm')
    return m, {}


@model('planter_shrub', 'planter', (1.6, 1.6, 0.8), ctx=('hall', 'tower'), ao=0.4, wall=None, group='hall')
def m_planter_shrub(lod):
    m = Mesh()
    w, h = 1.6, 0.8
    rng = random.Random(172)
    sg = 24 if lod == 0 else 10
    lathe(m, 'stone_terrazzo', [(0.0, 0.0), (w / 2 - 0.1, 0.0), (w / 2, 0.1), (w / 2, h - 0.04), (w / 2 + 0.01, h), (w / 2 - 0.08, h), (w / 2 - 0.08, h - 0.04)], sg)
    cyl(m, 'soil', 0, 0, h - 0.06, w / 2 - 0.08, w / 2 - 0.08, 0.02, sg)
    for k in range(7 if lod == 0 else 3):
        a = k * 2.399
        r = 0.42 * math.sqrt((k + 0.5) / 7)
        s = rng.uniform(0.32, 0.46)
        cushion(m, 'leaf_dark' if k % 2 else 'leaf_mid', (math.cos(a) * r, math.sin(a) * r, h + s * 0.35), (s, s, s * 0.8), ep=0.8, ev=0.8, lod=lod)
    if lod == 0:
        for k in range(14):  # bunga kecil
            a = k * 2.399
            r = 0.55 * math.sqrt((k + 0.5) / 14)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=0.03)
            m.add(bm, ('plastic_pink', 'paint_yellow', 'paint_white')[k % 3], T(math.cos(a) * r, math.sin(a) * r, h + 0.32 + 0.06 * (k % 3)), True)
    m.px((0, 0, h / 2), (w, w, h), 'stone_terrazzo')
    m.px((0, 0, h + 0.18), (w - 0.3, w - 0.3, 0.36), 'leaf_dark')
    return m, {}


@model('bench_mall', 'bench', (1.8, 0.5, 0.45), ctx=('hall',), ao=0.4, wall=None, group='hall')
def m_bench_mall(lod):
    m = Mesh()
    w, d, h = 1.8, 0.5, 0.45
    for s in (-1, 1):  # rangka kaki baja bentuk persegi terbuka
        x = s * (w / 2 - 0.15)
        box(m, 'steel', (x, 0, 0.012), (0.05, d - 0.04, 0.024))
        box(m, 'steel', (x, 0, h - 0.06), (0.05, d - 0.04, 0.024))
        for sy in (-1, 1):
            box(m, 'steel', (x, sy * (d / 2 - 0.045), (h - 0.05) / 2), (0.05, 0.024, h - 0.05))
    n = 6 if lod == 0 else 1
    for k in range(n):
        y = -d / 2 + (d / n) * (k + 0.5)
        box(m, 'wood_oak', (0, y, h - 0.025), (w, d / n - (0.012 if lod == 0 else 0), 0.05), bevel=0.006 if lod == 0 else 0, seg=2)
    m.px((0, 0, h - 0.025), (w, d, 0.05), 'wood_oak')
    m.px((0, 0, (h - 0.05) / 2), (w - 0.25, d - 0.05, h - 0.05), 'steel')
    return m, {}


# ================================================================ LOBI MENARA
# inti lift: 9-slice tegak — 2,95 m bawah (pintu, penunjuk lantai) tetap, 0,1 m atas menempel plafon
@model('liftcore_std', 'liftcore', (5.6, 3.0, 4.6), ctx=('tower',), ao=0.3, wall=None, slice_={'z': [2.95, 0.1]}, group='lobby')
def m_liftcore_std(lod):
    m = Mesh()
    w, d, h = 5.6, 3.0, 4.6
    box(m, 'stone_grey', (0, -0.02, h / 2), (w, d - 0.04, h))
    if lod == 0:  # nat panel batu
        for x in (-2.1, -0.7, 0.7, 2.1):
            box(m, 'stone_dark', (x, -0.02, h / 2), (0.006, d - 0.035, h))
        for z in (1.2, 2.4, 3.6):
            box(m, 'stone_dark', (0, -0.02, z), (w + 0.005, d - 0.035, 0.006))
    box(m, 'steel', (0, -0.02, 0.06), (w + 0.01, d - 0.03, 0.12))
    for a in (-w / 4, w / 4):
        # kusen baja, pintu baja ganda (celah tengah), penunjuk lantai
        box(m, 'steel', (a, d / 2 - 0.03, 1.25), (1.42, 0.06, 2.5))
        box(m, 'steel', (a, d / 2 + 0.01, 1.16), (1.2, 0.03, 2.3))
        box(m, 'metal_black', (a, d / 2 + 0.027, 1.16), (0.012, 0.004, 2.3))
        box(m, 'metal_black', (a, d / 2 + 0.01, 2.7), (0.9, 0.04, 0.2))
        quad(m, 'atlas_misce', [(a - 0.3, d / 2 + 0.032, 2.64), (a + 0.3, d / 2 + 0.032, 2.64), (a + 0.3, d / 2 + 0.032, 2.76), (a - 0.3, d / 2 + 0.032, 2.76)],
             uvs=[(MISC['lift'] + 0.02, 0.05), (MISC['lift'] + 0.98, 0.05), (MISC['lift'] + 0.98, 0.95), (MISC['lift'] + 0.02, 0.95)])
    # panel tombol panggil di tengah
    box(m, 'metal_black', (0, d / 2 + 0.0, 1.2), (0.16, 0.03, 0.36), bevel=0.006 if lod == 0 else 0)
    for z in (1.12, 1.26):
        cyl(m, 'emit_white', 0, 0, 0, 0.022, 0.022, 0.012, 12 if lod == 0 else 6, M=T(0, d / 2 + 0.014, z) @ Rx(-90))
    m.px((0, -0.02, h / 2), (w, d - 0.04, h), 'stone_grey')
    return m, {}


@model('reception_std', 'reception', (3.0, 0.8, 1.1), ctx=('tower',), ao=0.45, wall=None, group='lobby')
def m_reception_std(lod):
    m = Mesh()
    w, d, h = 3.0, 0.8, 1.1
    box(m, 'paint_black', (0, 0, 0.04), (w - 0.06, d - 0.06, 0.08))
    box(m, 'wood_walnut', (0, 0.05, 0.55), (w, d - 0.1, 1.0))  # badan
    box(m, 'stone_marble', (0, d / 2 - 0.04, 0.55), (w + 0.02, 0.06, 1.02), bevel=0.006 if lod == 0 else 0)  # muka depan marmer
    box(m, 'gold', (0, d / 2 + 0.0, 0.42), (w - 0.02, 0.012, 0.04))
    box(m, 'stone_marble', (0, 0.2, h - 0.02), (w + 0.06, 0.42, 0.04), bevel=0.006 if lod == 0 else 0, seg=2)  # meja transaksi
    box(m, 'wood_walnut', (0, -0.2, 0.76), (w - 0.04, 0.42, 0.03))  # meja kerja belakang
    quad(m, 'atlas_misc', [(-0.5, d / 2 + 0.002, 0.58), (0.5, d / 2 + 0.002, 0.58), (0.5, d / 2 + 0.002, 0.88), (-0.5, d / 2 + 0.002, 0.88)],
         uvs=[(MISC['lobby'] + 0.01, 0.02), (MISC['lobby'] + 0.99, 0.02), (MISC['lobby'] + 0.99, 0.98), (MISC['lobby'] + 0.01, 0.98)])
    for k, x in enumerate((-0.7, 0.66)):  # monitor menghadap staf (−y)
        box(m, 'metal_black', (x, -0.25, 0.79), (0.18, 0.14, 0.02))
        box(m, 'metal_black', (x, -0.22, 0.95), (0.04, 0.03, 0.3))
        box(m, 'plastic_black', (x, -0.2, 1.08), (0.55, 0.03, 0.34), bevel=0.004 if lod == 0 else 0)
        sub = Mesh()
        quad(sub, 'atlas_misce', [(x + 0.26, -0.216, 0.92), (x - 0.26, -0.216, 0.92), (x - 0.26, -0.216, 1.24), (x + 0.26, -0.216, 1.24)],
             uvs=[(MISC['pos'] + 0.01, 0.01), (MISC['pos'] + 0.99, 0.01), (MISC['pos'] + 0.99, 0.99), (MISC['pos'] + 0.01, 0.99)])
        merge_mesh(m, sub)
    if lod == 0:
        box(m, 'plastic_black', (-0.7, -0.33, 0.785), (0.42, 0.14, 0.02), bevel=0.004)
        box(m, 'plastic_black', (0.2, -0.3, 0.79), (0.18, 0.2, 0.05), bevel=0.01, seg=2)  # telepon
        lathe(m, 'ceramic', [(0.0, h), (0.05, h), (0.06, h + 0.15), (0.04, h + 0.2)], 12, M=T(1.25, 0.25, 0))
        for k in range(6):
            a = k * 1.05
            tip = Vector((1.25 + math.cos(a) * 0.08, 0.25 + math.sin(a) * 0.08, h + 0.42))
            tube(m, 'stem', (1.25, 0.25, h + 0.18), tip, 0.003, 4)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=0.035)
            m.add(bm, 'paint_white', T(*tip), True)
    m.px((0, 0.05, 0.55), (w, d - 0.1, 1.1), 'wood_walnut')
    return m, {}


@model('glassdoor_std', 'glassdoor', (0.95, 0.06, 2.95), ctx=('tower',), ao=0.0, wall=None, group='lobby')
def m_glassdoor_std(lod):
    m = Mesh()
    w, d, h = 0.95, 0.06, 2.95
    box(m, 'glass_clear', (0, 0, h / 2), (w - 0.06, 0.012, h - 0.16))
    box(m, 'alu', (0, 0, 0.05), (w, d, 0.1))
    box(m, 'alu', (0, 0, h - 0.04), (w, d, 0.08))
    for s in (-1, 1):
        box(m, 'alu', (s * (w / 2 - 0.015), 0, h / 2), (0.03, d, h))
    for s in (-1, 1):  # gagang tarik panjang dua sisi
        tube(m, 'steel', (w / 2 - 0.12, s * 0.06, 0.7), (w / 2 - 0.12, s * 0.06, 1.5), 0.014, 10 if lod == 0 else 4, caps=True)
        for z in (0.78, 1.42):
            tube(m, 'steel', (w / 2 - 0.12, 0, z), (w / 2 - 0.12, s * 0.06, z), 0.008, 6 if lod == 0 else 3)
    m.px((0, 0, h / 2), (w, d, h), 'alu')
    return m, {}


# ================================================================ AO, objek, ekspor
def ao_dirs(n):
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        v = (i * 0.6180339887) % 1.0
        r, ph = math.sqrt(u), 2 * pi * v
        out.append(Vector((r * math.cos(ph), r * math.sin(ph), math.sqrt(max(0.0, 1 - u)))))
    return out


def autosmooth(bm, ang=55):
    th = ang * D2R
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = not (e.calc_face_angle(pi) > th)
        else:
            e.smooth = False


def make_obj(name, m, ao_dist, wall, size):
    bm = m.bm
    bm.normal_update()
    autosmooth(bm)
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
    bake_ao(ob, bm, ao_dist, wall, size, used)
    bm.free()
    return ob


def bake_ao(ob, bm, maxd, wall, size, used):
    """Oklusi ambien per sudut face (sinar ke mesh sendiri + lantai + dinding belakang) → atribut warna 'Col' (R = AO).
    Kaca tidak menghalangi. Titik asal sinar digeser 30 % ke tengah face, lalu dirata-rata per (verteks, normal)."""
    me = ob.data
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    if maxd <= 0:
        for d in attr.data:
            d.color = (1, 1, 1, 1)
        me.color_attributes.active_color = attr
        return
    verts = [v.co.copy() for v in bm.verts]
    polys = [[v.index for v in f.verts] for f in bm.faces if not MAT_NAMES[f.material_index].startswith('glass')]
    o = len(verts)
    G = 6.0
    verts += [Vector((-G, -G, 0)), Vector((G, -G, 0)), Vector((G, G, 0)), Vector((-G, G, 0))]
    polys.append([o, o + 1, o + 2, o + 3])
    if wall:
        y = (size[1] / 2 + 0.03) * (1 if wall == '+y' else -1)
        o = len(verts)
        verts += [Vector((-G, y, 0)), Vector((G, y, 0)), Vector((G, y, 3.0)), Vector((-G, y, 3.0))]
        polys.append([o, o + 1, o + 2, o + 3])
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    rays = 6 if FAST else 16
    dirs = ao_dirs(rays)
    cn = me.corner_normals
    loop_poly = [0] * len(me.loops)
    for p in me.polygons:
        for li in p.loop_indices:
            loop_poly[li] = p.index
    centers = [p.center.copy() for p in me.polygons]
    acc, keys = {}, []
    for li, l in enumerate(me.loops):
        vi = l.vertex_index
        n = cn[li].vector
        key = (vi, round(n.x * 5), round(n.y * 5), round(n.z * 5))
        keys.append(key)
        v = me.vertices[vi].co
        p = v + (centers[loop_poly[li]] - v) * 0.3 + n * 0.003
        t = n.orthogonal().normalized()
        b = n.cross(t)
        occ = 0.0
        for d in dirs:
            dw = t * d.x + b * d.y + n * d.z
            hit = bvh.ray_cast(p, dw, maxd)
            if hit[0] is not None:
                occ += 1.0 - (hit[3] / maxd) ** 2
        a = acc.setdefault(key, [0.0, 0])
        a[0] += max(0.25, 1.0 - 0.9 * occ / rays)
        a[1] += 1
    for li, key in enumerate(keys):
        a = acc[key]
        ao = a[0] / a[1]
        attr.data[li].color = (ao, ao, ao, 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass


# warna proksi untuk material bertekstur atlas/pijar (sRGB)
PROXY_COL = {'atlas_goods': '#b07a52', 'atlas_books': '#8a5a46', 'atlas_rug': '#8a6a50', 'atlas_rows': '#a77d5a',
             'atlas_misc': '#5a5a5a', 'atlas_misce': '#d8d8d8', 'atlas_tpat': '#b9a27e', 'emit_warm': '#f2e3c4',
             'emit_white': '#f4f6f8', 'tfab_main': '#ffffff', 'tfab_acc': '#ffffff', 'tleather': '#ffffff'}


def proxy_out(px):
    out = []
    for p in px:
        hexc = PROXY_COL.get(p['m'], MATS[p['m']][0])
        lin = srgb(hexc)
        cell = p['cell']
        face = 0
        if cell >= 0:
            face = 3 if 200 <= cell < 300 else (2 if p.get('two') else 1)
        out.append(dict(c=p['c'], s=p['s'], col=[round(v * 0.82, 4) for v in lin], t=p['t'], cell=cell, face=face,
                        rough=MATS[p['m']][1], metal=MATS[p['m']][2]))
    return out


def build(names):
    objs, man = [], {}
    for name in names:
        spec = MODELS[name]
        info = dict(kind=spec['kind'], ctx=spec['ctx'], size=list(spec['size']), lods=[], tris=[], wall=spec['wall'], group=spec['group'])
        if spec['slice']:
            info['slice'] = spec['slice']
        if spec['tile']:
            info['tile'] = spec['tile']
        for lod in spec['lods']:
            t0 = time.time()
            m, meta = spec['fn'](lod)
            tris = m.tris()
            if lod == 0:
                info['proxy'] = proxy_out(m.proxy)
            ob = make_obj('%s_lod%d' % (name, lod), m, spec['ao'], spec['wall'], spec['size'])
            objs.append(ob)
            info['lods'].append(lod)
            info['tris'].append(tris)
            log(name, 'lod%d' % lod, tris, 'tris', '%.1fs' % (time.time() - t0))
        man[name] = info
    return objs, man


def export_glb(objs, man):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'furniture.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_animations=False,
                              export_draco_mesh_compression_enable=False, export_texcoords=True, export_normals=True, export_extras=False,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_materials='EXPORT')
    log('ekspor', path, os.path.getsize(path), 'byte')
    repack_glb(path)
    meta = dict(version=1, generated=time.strftime('%Y-%m-%d'),
                axes='glTF: +Y atas, X = sumbu a (sepanjang dinding), −Z = sumbu b (ke dalam ruang); size/slice/proxy: koordinat penulis (x = a, y = b, z = atas)',
                atlas=dict(goods=N_GOODS, books=N_BOOKS, rugs=N_RUGS, rows=N_ROWS, pat=N_PAT, misc=MISC),
                models=man)
    with open(os.path.join(OUT, 'furniture.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))


def needs_uv(mat):
    return mat.startswith(('atlas_', 'wood_', 'fab_', 'tfab_', 'leather_', 'tleather', 'stone_'))


def repack_glb(path):
    """Perkecil GLB (KHR_mesh_quantization): normal int8 (langkah 4 B), AO uint8, UV hanya untuk material bertekstur.
    Posisi & indeks tetap. 40 → ±22 B per verteks."""
    import numpy as np
    import struct
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    J = json.loads(d[20:20 + jl])
    b0 = 20 + jl
    bl = struct.unpack('<I', d[b0:b0 + 4])[0]
    BIN = d[b0 + 8:b0 + 8 + bl]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def read(ai):
        a = J['accessors'][ai]
        bv = J['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']])
        nc = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or dt.itemsize * nc
        if stride == dt.itemsize * nc:
            return np.frombuffer(BIN, dtype=dt, count=a['count'] * nc, offset=off).reshape(a['count'], nc).copy()
        return np.stack([np.frombuffer(BIN, dtype=dt, count=nc, offset=off + i * stride) for i in range(a['count'])])

    blob, views, accs = bytearray(), [], []

    def put(arr, ctype, typ, normalized=False, stride=None, target=None, minmax=False):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        raw = arr.tobytes()
        blob.extend(raw)
        bv = dict(buffer=0, byteOffset=off, byteLength=len(raw))
        if stride:
            bv['byteStride'] = stride
        if target:
            bv['target'] = target
        views.append(bv)
        a = dict(bufferView=len(views) - 1, componentType=ctype, count=int(arr.shape[0]), type=typ)
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(v) for v in arr.min(axis=0)]
            a['max'] = [float(v) for v in arr.max(axis=0)]
        accs.append(a)
        return len(accs) - 1

    for mesh in J['meshes']:
        for pr in mesh['primitives']:
            at = pr['attributes']
            mat = J['materials'][pr['material']]['name'] if 'material' in pr else ''
            pos = read(at['POSITION']).astype(np.float32)
            nor = read(at['NORMAL']).astype(np.float32)
            na = {}
            na['POSITION'] = put(pos, 5126, 'VEC3', target=34962, minmax=True)
            n8 = np.zeros((nor.shape[0], 4), dtype=np.int8)
            n8[:, :3] = np.clip(np.round(nor * 127.0), -127, 127).astype(np.int8)
            na['NORMAL'] = put(n8, 5120, 'VEC3', normalized=True, stride=4, target=34962)
            accs[-1]['count'] = int(nor.shape[0])
            if 'COLOR_0' in at:
                c = read(at['COLOR_0']).astype(np.float32)
                src = J['accessors'][at['COLOR_0']]
                if src['componentType'] == 5123:
                    c = c / 65535.0
                elif src['componentType'] == 5121:
                    c = c / 255.0
                c8 = np.clip(np.round(c * 255.0), 0, 255).astype(np.uint8)
                if c8.shape[1] == 3:
                    c8 = np.concatenate([c8, np.full((c8.shape[0], 1), 255, np.uint8)], axis=1)
                na['COLOR_0'] = put(c8, 5121, 'VEC4', normalized=True, target=34962)
            if 'TEXCOORD_0' in at and needs_uv(mat):
                na['TEXCOORD_0'] = put(read(at['TEXCOORD_0']).astype(np.float32), 5126, 'VEC2', target=34962)
            pr['attributes'] = na
            if 'indices' in pr:
                src = J['accessors'][pr['indices']]
                idx = read(pr['indices']).reshape(-1)
                if idx.max() < 65536:
                    pr['indices'] = put(idx.astype(np.uint16).reshape(-1, 1), 5123, 'SCALAR', target=34963)
                else:
                    pr['indices'] = put(idx.astype(np.uint32).reshape(-1, 1), 5125, 'SCALAR', target=34963)
    while len(blob) % 4:
        blob.append(0)
    J['accessors'], J['bufferViews'] = accs, views
    J['buffers'] = [dict(byteLength=len(blob))]
    for k in ('extensionsUsed', 'extensionsRequired'):
        J[k] = sorted(set(J.get(k, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(J, separators=(',', ':')).encode('utf-8')
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942))
        f.write(bytes(blob))
    log('repack', path, os.path.getsize(path), 'byte')


# ================================================================ tekstur detail (R kayu, G kain, B batu)
def pack_detail(size=512):
    """Tekstur detail abu-abu berulang (dinormalkan terhadap rata-ratanya di game): detail_wood.jpg serat kayu (foto
    venir ek), detail_fabric.jpg tenunan linen (foto), detail_marble.jpg marmer berurat (prosedural, tanpa nat ubin).
    Kontras dijinakkan: rata-rata 0,5, simpangan ±0,14–0,16."""
    import numpy as np
    srcs = [os.path.join(CACHE, n + '.jpg') for n in ('wood', 'fabric')]
    for s_ in srcs:
        if not os.path.exists(s_):
            log('! sumber tidak ada:', s_, '→ jalankan tools/realism/fetch_furniture.py')
            return

    def norm(a, sd):
        a = (a - a.mean()) / max(1e-4, a.std())
        return np.clip(0.5 + a * sd, 0.0, 1.0)

    chans = []
    for s_, sd in zip(srcs, (0.16, 0.14)):
        img = bpy.data.images.load(s_)
        img.scale(size, size)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
        lum = px[:, :, 0] * 0.2126 + px[:, :, 1] * 0.7152 + px[:, :, 2] * 0.0722
        if 'wood' in s_:
            lum = lum.T.copy()  # serat foto tegak → searah u (sisi terpanjang bagian)
        chans.append(norm(lum, sd))
    rng = np.random.default_rng(7)

    def noise(oct0=2, octs=6):  # derau fraktal berulang (kisi acak diperhalus bilinear, dibungkus)
        out = np.zeros((size, size), np.float32)
        amp, tot = 1.0, 0.0
        for o in range(oct0, oct0 + octs):
            n = 2 ** o
            g = rng.random((n, n)).astype(np.float32)
            t = (np.arange(size) * n / size)
            i0 = np.floor(t).astype(int) % n
            i1 = (i0 + 1) % n
            f = (t - np.floor(t))
            f = f * f * (3 - 2 * f)
            row = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
            row2 = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
            out += amp * (row * (1 - f)[:, None] + row2 * f[:, None])
            tot += amp
            amp *= 0.55
        return out / tot

    u = np.arange(size, dtype=np.float32)[None, :] / size
    v = np.arange(size, dtype=np.float32)[:, None] / size
    t1, t2, t3 = noise(1, 4), noise(2, 5), noise(3, 6)
    s1 = np.abs(np.sin(pi * (2 * u + v + 1.3 * t1)))
    s2 = np.abs(np.sin(2 * pi * (2 * v + u + 1.1 * t2)))
    marble = 0.86 - 0.32 * np.exp(-s1 * 5.0) * (0.5 + t2) - 0.12 * np.exp(-s2 * 11.0) * t3 + 0.12 * (t3 - 0.5)
    chans.append(norm(marble, 0.14))
    os.makedirs(OUT, exist_ok=True)
    for name, ch in zip(('wood', 'fabric', 'marble'), chans):  # tiga JPEG abu-abu (JPEG RGB mencampur kanal lewat kroma)
        out = bpy.data.images.new('detail_' + name, size, size, alpha=False)
        arr = np.ones((size, size, 4), dtype=np.float32)
        for k in range(3):
            arr[:, :, k] = ch
        out.pixels[:] = arr.ravel()
        path = os.path.join(OUT, 'detail_%s.jpg' % name)
        out.filepath_raw = path
        out.file_format = 'JPEG'
        out.save(filepath=path, quality=84)
        log('detail', path, os.path.getsize(path), 'byte')


# ================================================================ pratinjau
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def render_setup(w, h, samples):
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for dv in prefs.devices:
            dv.use = True
        scn.cycles.device = 'GPU'
    except Exception as e:
        log('GPU tidak tersedia:', e)
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


def preview_materials():
    """Pratinjau saja: kayu/kain/batu memakai tekstur detail (UV meter) × warna dasar; kain berwarna instans diberi
    warna contoh; atlas abu-abu terang."""
    imgs = {}
    for k in ('wood', 'fabric', 'marble'):
        pth = os.path.join(OUT, 'detail_%s.jpg' % k)
        imgs[k] = bpy.data.images.load(pth) if os.path.exists(pth) else None
    tints = {'tfab_main': '#5f6f86', 'tfab_acc': '#c9a24a', 'tleather': '#5a3a2a', 'atlas_tpat': '#b38a5a'}
    for name, m in BMAT.items():
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        base = tints.get(name, MATS[name][0])
        if name.startswith('glass'):
            bsdf.inputs['Transmission Weight'].default_value = 0.95
            continue
        if name.startswith('atlas'):
            bsdf.inputs['Base Color'].default_value = (*srgb('#b0a898' if name != 'atlas_rug' else '#8a5a4a'), 1)
            continue
        if name in tints:
            bsdf.inputs['Base Color'].default_value = (*srgb(base), 1)
        img, sc = None, 1.0
        if name.startswith('wood'):
            img, sc = imgs['wood'], 0.9
        elif name.startswith(('fab', 'tfab')):
            img, sc = imgs['fabric'], 0.32
        elif name.startswith(('leather', 'tleather')):
            img, sc = imgs['fabric'], 0.06
        elif name.startswith('stone'):
            img, sc = imgs['marble'], 1.3
        if img is None:
            continue
        uvn = nt.nodes.new('ShaderNodeUVMap')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / sc, 1 / sc, 1)
        tx = nt.nodes.new('ShaderNodeTexImage')
        tx.image = img
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        mul = nt.nodes.new('ShaderNodeMixRGB')
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Fac'].default_value = 0.85
        mul.inputs['Color1'].default_value = (*srgb(base), 1)
        nt.links.new(uvn.outputs['UV'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], tx.inputs['Vector'])
        nt.links.new(tx.outputs['Color'], sep.inputs['Color'])
        gain = nt.nodes.new('ShaderNodeMath')
        gain.operation = 'MULTIPLY'
        gain.inputs[1].default_value = 2.0
        nt.links.new(sep.outputs[0], gain.inputs[0])
        nt.links.new(gain.outputs[0], mul.inputs['Color2'])
        nt.links.new(mul.outputs['Color'], bsdf.inputs['Base Color'])


def shots(objs, man):
    os.makedirs(PREV, exist_ok=True)
    preview_materials()
    lod0 = {o.name[:-5]: o for o in objs if o.name.endswith('_lod0')}
    lod1 = {o.name[:-5]: o for o in objs if o.name.endswith('_lod1')}
    for o in objs:
        o.hide_render = True
    # lantai & dinding belakang abu terang
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    me = bpy.data.meshes.new('floor')
    bm.to_mesh(me)
    bm.free()
    fm = bpy.data.materials.new('floor')
    fm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*srgb('#d8d2c6'), 1)
    me.materials.append(fm)
    link(bpy.data.objects.new('floor', me))
    w = bpy.data.worlds.new('w')
    bpy.context.scene.world = w
    w.node_tree.nodes.get('Background').inputs['Color'].default_value = (0.85, 0.88, 0.95, 1)
    w.node_tree.nodes.get('Background').inputs['Strength'].default_value = 0.9
    sund = bpy.data.lights.new('sun', 'SUN')
    sund.energy = 3.0
    sund.angle = 0.2
    sun = link(bpy.data.objects.new('sun', sund))
    sun.rotation_euler = (50 * D2R, 0, 160 * D2R)
    samples = 16 if FAST else 48

    def row(names, src, gap=0.5):
        x = 0.0
        out = []
        for n in names:
            if n not in src:
                continue
            wdt = man[n]['size'][0]
            out.append((src[n], x + wdt / 2))
            x += wdt + gap
        for o, cx in out:
            o.hide_render = False
            o.location = (cx - x / 2, 0, 0)
        return x

    def frame(fname, W, H, lens=40, el=18.0):
        bpy.context.view_layer.update()
        pts = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and o.name != 'floor' for c in o.bound_box]
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), 0.0))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        cx, cz = (mn.x + mx.x) / 2, mx.z * 0.4
        hfov = 2 * math.atan(18 / lens)
        vfov = 2 * math.atan(math.tan(hfov / 2) * H / W)
        dd = max((mx.x - mn.x) / 2 / math.tan(hfov / 2), mx.z * 0.7 / math.tan(vfov / 2)) * 1.05 + (mx.y - mn.y) / 2
        render_setup(W, H, samples)
        cd = bpy.data.cameras.new('cam')
        cd.lens = lens
        cam = link(bpy.data.objects.new('cam', cd))
        cam.location = Vector((cx, mx.y + dd, cz + dd * math.tan(el * D2R)))
        cam.rotation_euler = (Vector((cx, (mn.y + mx.y) / 2, cz)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.camera = cam
        bpy.context.scene.render.filepath = os.path.join(PREV, fname)
        bpy.ops.render.render(write_still=True)
        log('pratinjau', bpy.context.scene.render.filepath)

    W0, H0 = (1600, 800) if not FAST else (1200, 600)
    groups = {}
    for n, inf in man.items():
        groups.setdefault(inf['group'] or 'misc', []).append(n)
    for g, names in groups.items():
        for src, tag in ((lod0, 'lod0'), (lod1, 'lod1')):
            for o in objs:
                o.hide_render = True
            if not row(names, src):
                continue
            frame('%s_%s.png' % (g, tag), W0, H0)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.context.scene.render.threads_mode = 'FIXED'
        bpy.context.scene.render.threads = 2
    except Exception:
        pass
    if opt('--detail'):
        pack_detail()
    make_materials()
    only = opt('--only')
    names = [n for n in MODELS if not only or n in only.split(',')]
    t0 = time.time()
    objs, man = build(names)
    log('selesai %.1fs' % (time.time() - t0), 'model', len(man), 'total tris lod0', sum(man[n]['tris'][0] for n in man),
        'lod1', sum(man[n]['tris'][-1] for n in man))
    if not opt('--no-export'):
        export_glb(objs, man)
    if opt('--shots'):
        shots(objs, man)


main()
