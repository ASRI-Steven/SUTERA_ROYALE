"""Sutera Royale: 5 senjata orisinal + tangan orang pertama, dimodelkan prosedural di Blender (headless).

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/weapons.py -- [opsi]

Opsi:
  --no-export      lewati ekspor GLB + JSON
  --quick          render cek cepat (EEVEE) ke --qdir
  --shots          render preview Cycles: preview/weapons/lineup.png + fp_ar.png
  --fp             hanya preview/weapons/fp_ar.png
  --samples N      sampel Cycles (default 128)
  --out DIR        folder ekspor (default web/game/assets/weapons)
  --preview DIR    folder preview (default preview/weapons)

Kontrak GLB (web/game/assets/weapons/weapons.glb, dipakai web/game/weapons.js):
  - glTF: +Y atas, laras menghadap −Z, sisi kanan senjata = +X (Blender: laras +Y, atas +Z, kanan +X).
  - Origin tiap senjata = titik genggam tangan kanan di gagang pistol (gagang sama untuk semua senjata,
    condong 18°), satuan meter ukuran nyata.
  - Node top-level per jenis (pistol, smg, ar, shotgun, dmr):
      <kind>            model orang pertama tanpa magasin/pompa (material metal dark poly grip gold glass dot)
      <kind>_mag        magasin (origin = titik masuk magasin, dianimasikan saat isi ulang); shotgun tidak punya
      shotgun_pump      pompa shotgun (origin di tengahnya, digeser di sumbu Z)
      <kind>_lod1       satu mesh sederhana (≤ 350 segitiga) dengan warna verteks COLOR_0 (loot & tangan karakter)
      <kind>_muzzle     ujung laras (empty)
      <kind>_sight      titik pada garis bidik tempat mata sejajar (empty): takik pisir belakang / pusat titik merah AR /
                        sumbu lensa okuler teropong DMR
      <kind>_guard      posisi PUSAT TELAPAK tangan kiri saat menyangga (empty)
  - Tangan: fp_hand_r (menggenggam gagang; node diekspor di posisi genggamnya relatif origin senjata) dan fp_hand_l
    (menyangga dari bawah; taruh di <kind>_guard). Origin = pusat telapak, lengan bawah menjulur ke belakang-bawah
    (ke arah kamera). Material glove, sleeve, cuff, skin, poly, grip, gold.
  - Tangan kiri per senjata (v5): fp_hand_l_<kind> (pistol & revolver: fp_hand_l_pistol, lihat weapons[].handL di
    weapons.json), taruh di <kind>_guard (= pusat telapaknya). fp_hand_l tetap untuk rig obat & granat.

v4 (model orang pertama realistis):
  - make_obj(): bevel mikro ±0,55 mm di semua tepi tajam + normal berbobot luas face (tepi menangkap kilau);
    bake_vwx(): oklusi ambien per sudut face + tanda aus (bidang bevel) → lapisan UV 'vwx' = TEXCOORD_0 (u = AO, v = aus;
    glTF membalik v). web/game/weapons.js membacanya sebagai atribut `vwx`. Sengaja bukan COLOR_0: material GLB dipakai
    apa adanya oleh ikon HUD (web/game/icons.js). Node *_lod1 tidak berubah (warna verteks = albedo).
  - Lengan & tangan baru: lengan baju berlipat, manset emas, kulit pergelangan, sarung tangan bertali + pelindung buku jari;
    node tambahan fp_forearm (lengan bawah satuan sepanjang +Y glTF) dan fp_hand_open (tangan terbuka) untuk rig
    obat/granat. Nama node senjata, arah (laras −Z, dilihat dari +X) dan titik origin TIDAK berubah.
  - Opsi tambahan: --kinds ar,pistol (iterasi cepat, jangan untuk ekspor akhir), --no-bevel, --shots4 (pratinjau
    preview/weapons/v4-lineup.png + v4-fp-ar.png). Render: Cycles CPU 2 thread, ≤ 960 px, 16–32 sampel.
  - Mesin dipakai bersama pemain: jalankan lewat  taskpolicy -b nice -n 19 Blender -b -t 2 …  (OMP_NUM_THREADS=2).

v5 (tangan kiri dipaskan per senjata, build_hand_l_fit / build_hand_l_pistol):
  - Dulu satu genggaman kiri untuk semua senjata: ibu jari lurus menjulur ke depan di bawah sisi kiri pelindung tangan
    (tampak seperti satu jari "nongol"), jari mengait di atas pelindung yang tipis, pistol/revolver memakai tangan terbuka.
  - Kini penampang pelindung tangan/pompa diukur dengan sinar ke rakitan senjata yang sudah jadi (kulit cembung per 1°);
    telapak datar dicari kemiringan & letaknya supaya ujung jari berhenti di sisi kanan tanpa menyembul di atas punggung
    pelindung dan sendi jari tidak melayang; ruas jari kaku melingkari kulit (tali busur tidak menembus); ibu jari rebah
    di sisi kiri menghadap depan (sinar radial). Pistol & revolver: tangan penyangga dua tangan (membungkus jari kanan).
  - <kind>_guard pindah ke pusat telapak baru. Lengan bawah tetap searah ARM_L (= AX_L di web/game/weapons.js), lengan
    baju 0,46 m supaya ujungnya di luar layar juga saat membidik. Tanpa bevel mikro: ±2,8 rb segitiga per tangan.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gunkit as gk  # noqa: E402  (toolkit bentuk v6: rel, kenop, baut, lensa, cincin, pelat bersiluet)

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
OUT = os.path.abspath(opt('--out', os.path.join(ROOT, 'web', 'game', 'assets', 'weapons')))
PREV = os.path.abspath(opt('--preview', os.path.join(ROOT, 'preview', 'weapons')))
QDIR = os.path.abspath(opt('--qdir', os.path.join(PREV, 'quick')))
SAMPLES = int(opt('--samples', 128))

pi = math.pi
D2R = pi / 180


def log(*a):
    print('[wpn]', *a, flush=True)


# ---------------------------------------------------------------- material
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MAT_NAMES = ['metal', 'dark', 'poly', 'grip', 'gold', 'glass', 'dot', 'glove', 'sleeve', 'cuff', 'wood', 'olive', 'yellow', 'red', 'canister', 'skin', 'steel', 'rubber', 'lens']
MI = {n: i for i, n in enumerate(MAT_NAMES)}
MAT = {
    'metal': dict(col='#5d636e', metal=0.55, rough=0.34),
    'dark': dict(col='#24272d', metal=0.35, rough=0.45),
    'poly': dict(col='#30333a', metal=0.0, rough=0.62),
    'grip': dict(col='#2a2c31', metal=0.0, rough=0.85),
    'gold': dict(col='#D29F52', metal=0.6, rough=0.32),
    'glass': dict(col='#a8dcff', metal=0.0, rough=0.04, alpha=0.1),
    'dot': dict(col='#ff1408', metal=0.0, rough=0.3, em='#ff1408', ems=3.0),
    'glove': dict(col='#25232c', metal=0.0, rough=0.75),
    'sleeve': dict(col='#503EBA', metal=0.0, rough=0.8),
    'cuff': dict(col='#D29F52', metal=0.4, rough=0.4),
    'wood': dict(col='#5b3521', metal=0.0, rough=0.5),
    'olive': dict(col='#4c5638', metal=0.0, rough=0.66),
    'yellow': dict(col='#e0a91c', metal=0.1, rough=0.45),
    'red': dict(col='#b3302a', metal=0.0, rough=0.5),
    'canister': dict(col='#c9ced2', metal=0.3, rough=0.45),
    'skin': dict(col='#c48a64', metal=0.0, rough=0.55),
    # v6: baja poles (baut, mahkota laras), karet (bantalan, eyecup), kaca optik berlapis (tidak ikut skin)
    'steel': dict(col='#8d929b', metal=0.9, rough=0.28),
    'rubber': dict(col='#1b1c1f', metal=0.0, rough=0.9),
    'lens': dict(col='#18222c', metal=0.0, rough=0.03, alpha=0.25),
}
MATS = {}


def make_materials():
    MATS.clear()
    for n in MAT_NAMES:
        d = MAT[n]
        m = bpy.data.materials.new(n)
        try:
            m.use_nodes = True
        except Exception:
            pass
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (*srgb(d['col']), 1)
        b.inputs['Metallic'].default_value = d['metal']
        b.inputs['Roughness'].default_value = d['rough']
        if 'alpha' in d:
            b.inputs['Alpha'].default_value = d['alpha']
            m.surface_render_method = 'BLENDED'
        if 'em' in d:
            b.inputs['Emission Color'].default_value = (*srgb(d['em']), 1)
            b.inputs['Emission Strength'].default_value = d['ems']
        m.use_backface_culling = n not in ('glass', 'lens')
        m.diffuse_color = (*srgb(d['col']), 1)
        MATS[n] = m


# ---------------------------------------------------------------- transform
def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Rx(d):
    return Matrix.Rotation(d * D2R, 4, 'X')


def Ry(d):
    return Matrix.Rotation(d * D2R, 4, 'Y')


def Rz(d):
    return Matrix.Rotation(d * D2R, 4, 'Z')


def MX():
    return Matrix.Diagonal((-1, 1, 1, 1))


# ---------------------------------------------------------------- bmesh helpers
def merge(dst, src, mat=None, M=None, smooth=None):
    flip = M is not None and M.to_3x3().determinant() < 0
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(M @ v.co if M is not None else v.co.copy())
    mi = MI[mat] if mat else None
    for f in src.faces:
        vs = [vmap[v] for v in f.verts]
        if flip:
            vs.reverse()
        try:
            nf = dst.faces.new(vs)
        except ValueError:
            continue
        nf.material_index = f.material_index if mi is None else mi
        nf.smooth = f.smooth if smooth is None else smooth
    src.free()


def put(dst, src, mat, M=None, mirror=False, smooth=True):
    if mirror:
        cp = src.copy()
        merge(dst, cp, mat, (MX() @ M) if M is not None else MX(), smooth)
    merge(dst, src, mat, M, smooth)


def p_box(sx, sy, sz, bevel=0.0, segs=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bevel = min(bevel, sx * 0.49, sy * 0.49, sz * 0.49)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type='OFFSET', segments=segs, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    return bm


def p_cyl(r1, r2, depth, segs=16, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    return bm


def p_cyly(r, depth, segs=16, caps=True, r2=None, flat=False):
    """Silinder/kerucut di sumbu Y (sejajar laras), r = ujung belakang, r2 = ujung depan; flat = sisi datar di atas."""
    bm = p_cyl(r, r if r2 is None else r2, depth, segs, caps)
    if flat:
        bmesh.ops.transform(bm, matrix=Rz(180 / segs), verts=bm.verts)
    bmesh.ops.transform(bm, matrix=Rx(-90), verts=bm.verts)
    return bm


def p_cylx(r, depth, segs=16, caps=True):
    bm = p_cyl(r, r, depth, segs, caps)
    bmesh.ops.transform(bm, matrix=Ry(90), verts=bm.verts)
    return bm


def p_sphere(r, u=12, v=6):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    return bm


def p_tube(a, b, r1, r2=None, segs=8, caps=True):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = p_cyl(r1, r1 if r2 is None else r2, d.length, segs, caps)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=T(*((a + b) / 2)) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def p_chain(points, radii, segs=7, ball=True, first=True):
    """Rantai tabung meruncing (jari, kaki bipod): bola di tiap sendi (first=False: tanpa bola di pangkal)."""
    bm = bmesh.new()
    for i in range(len(points) - 1):
        merge(bm, p_tube(points[i], points[i + 1], radii[i], radii[i + 1], segs, caps=False))
    if ball:
        for k, (p, r) in enumerate(zip(points, radii)):
            if k or first:
                merge(bm, p_sphere(r, segs, 4), M=T(*p))
    return bm


def p_torus(R, r, segs=24, rsegs=8, axis='Y'):
    """Torus; sumbu putarnya axis (default Y = sejajar laras)."""
    bm = bmesh.new()
    grid = []
    for i in range(segs):
        a = 2 * pi * i / segs
        row = []
        for k in range(rsegs):
            b = 2 * pi * k / rsegs
            rr = R + r * math.cos(b)
            row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
        grid.append(row)
    for i in range(segs):
        A, B = grid[i], grid[(i + 1) % segs]
        for k in range(rsegs):
            k2 = (k + 1) % rsegs
            bm.faces.new((A[k], B[k], B[k2], A[k2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if axis == 'Y':
        bmesh.ops.transform(bm, matrix=Rx(90), verts=bm.verts)
    elif axis == 'X':
        bmesh.ops.transform(bm, matrix=Ry(90), verts=bm.verts)
    return bm


def p_lathe_y(prof, segs=16, cz=0.0, sx=1.0, sz=1.0, phase=0.0):
    """Putar profil [(r, y)] mengelilingi sumbu Y (di z = cz). Ujung r = 0 menutup sendiri."""
    bm = bmesh.new()
    grid = []
    for i in range(segs):
        a = 2 * pi * i / segs + phase
        c, s = math.cos(a), math.sin(a)
        grid.append([bm.verts.new((r * c * sx, y, cz + r * s * sz)) for r, y in prof])
    n = len(prof)
    for i in range(segs):
        A, B = grid[i], grid[(i + 1) % segs]
        for k in range(n - 1):
            try:
                bm.faces.new((A[k], B[k], B[k + 1], A[k + 1]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def p_loft(rings, cap0=True, cap1=True):
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
    return bm


def p_prof(pts, w, bevel=0.0, segs=1, x0=0.0):
    """Ekstrusi profil samping [(y, z)] setebal w di sumbu X (berpusat x0), tepi tutup dibulatkan (bevel)."""
    bm = bmesh.new()
    a = [bm.verts.new((x0 - w / 2, y, z)) for y, z in pts]
    b = [bm.verts.new((x0 + w / 2, y, z)) for y, z in pts]
    n = len(pts)
    ca = bm.faces.new(list(reversed(a)))
    cb = bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0:
        es = [e for e in bm.edges if ca in e.link_faces or cb in e.link_faces]
        bmesh.ops.bevel(bm, geom=es, offset=bevel, offset_type='OFFSET', segments=segs, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    return bm


def p_text(body, size, font=None, res=1):
    """Teks 3D tipis (bidang XY, menghadap +Z)."""
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = res
    cu.extrude = size * 0.06
    if font and os.path.exists(font):
        cu.font = bpy.data.fonts.load(font, check_existing=True)
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


FONT_BOLD = next((f for f in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                              '/System/Library/Fonts/Supplemental/Arial Bold.ttf') if os.path.exists(f)), None)


def superellipse(cx, cy, z, rx, ry_f, ry_b=None, n=16, e=3.0):
    """Cincin di bidang XY (ketinggian z): x ±rx, y maju ry_f / mundur ry_b, sudut membulat."""
    ry_b = ry_f if ry_b is None else ry_b
    pts = []
    for i in range(n):
        a = 2 * pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = rx * math.copysign(abs(c) ** (2 / e), c)
        y = (ry_f if s > 0 else ry_b) * math.copysign(abs(s) ** (2 / e), s)
        pts.append((cx + x, cy + y, z))
    return pts


def loft_y(secs, n=14, e=2.6, cap0=True, cap1=True):
    """Badan membulat sepanjang Y: secs = [(y, zc, tinggi_atas, tinggi_bawah, setengah_lebar)] (popor, dsb.)."""
    rings = []
    for (y, zc, ht, hb, hx) in secs:
        ring = []
        for i in range(n):
            a = 2 * pi * i / n
            c, s_ = math.cos(a), math.sin(a)
            ring.append((hx * math.copysign(abs(c) ** (2 / e), c), y, zc + (ht if s_ > 0 else hb) * math.copysign(abs(s_) ** (2 / e), s_)))
        rings.append(ring)
    return p_loft(rings, cap0, cap1)


def engrave(B, text, x, y, z, size=0.0085):
    """Ukiran emas kecil di sisi kiri (−X), terbaca dari kiri."""
    put(B, p_text(text, size, FONT_BOLD, 1), 'gold', T(x, y, z) @ Rz(-90) @ Rx(90), smooth=False)


def side_panel(B, y0, y1, z0, z1, x, mat='poly', bevel=0.0025):
    """Panel samping menonjol tipis di kedua sisi (memecah bidang datar penerima)."""
    put(B, p_box(0.003, y1 - y0, z1 - z0, bevel), mat, T(x, (y0 + y1) / 2, (z0 + z1) / 2), mirror=True)


def lower_details(B, x=0.021):
    """Selektor (emas) kiri, tombol magasin (emas) kanan, penahan bolt kiri."""
    put(B, p_cylx(0.0055, 0.004, 12), 'dark', T(-x - 0.001, -0.032, 0.054))
    put(B, p_box(0.003, 0.016, 0.0045, 0.001), 'gold', T(-x - 0.0035, -0.026, 0.056) @ Rx(25))
    put(B, p_cylx(0.0045, 0.004, 10), 'gold', T(x + 0.001, 0.052, 0.050))
    put(B, p_box(0.003, 0.016, 0.009, 0.001), 'dark', T(-x - 0.001, 0.03, 0.07))


def autosmooth(bm, ang=40):
    th = ang * D2R
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            e.smooth = not (e.calc_face_angle(pi) > th or f1.material_index != f2.material_index)
        else:
            e.smooth = False


def tris_bm(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


# ---------------------------------------------------------------- gagang bersama (semua senjata)
TILT = 18 * D2R


def yc(z):  # pusat gagang condong ke depan di bagian atas
    return math.tan(TILT) * z


GRIP_Z0, GRIP_Z1 = -0.062, 0.054


def grip_bm():
    rings = []
    zs = [GRIP_Z0, GRIP_Z0 + 0.005, -0.048, -0.036, -0.024, -0.012, 0.0, 0.012, 0.026, 0.040, GRIP_Z1]
    for z in zs:
        t = (z - GRIP_Z0) / (GRIP_Z1 - GRIP_Z0)
        fg = 0.0022 * math.cos((z + 0.043) / 0.0235 * 2 * pi) if -0.056 < z < 0.024 else 0.0  # alur jari di depan
        front = 0.024 + fg + (0.0035 if z > 0.03 else 0)
        back = 0.026 + 0.0045 * math.sin(pi * min(1, t * 1.15))  # tonjolan telapak di belakang
        rx = (0.0155 if z > GRIP_Z0 + 0.004 else 0.0145) + 0.001 * math.sin(pi * t)
        rings.append(superellipse(0, yc(z), z, rx, front, back, 16, 3.2))
    return p_loft(rings)


def grip_panels(B, mat='poly', rib=True):
    """Detail gagang (relief ≤ 1 mm, selubung gagang tetap): bingkai panel samping tipis di kedua sisi mengikuti condong
    gagang, garis punggung gagang, alur melintang di tali depan."""
    for sx in (-1, 1):
        o = [(yc(z) + dy, z) for (dy, z) in ((-0.0170, -0.0500), (0.0130, -0.0500), (0.0150, 0.0300), (-0.0165, 0.0300))]
        i_ = [(yc(z) + dy, z) for (dy, z) in ((-0.0148, -0.0478), (0.0108, -0.0478), (0.0128, 0.0278), (-0.0143, 0.0278))]
        fr = bmesh.new()
        O_, I_ = gk.fillet2d(o, 0.004, 4), gk.fillet2d(i_, 0.003, 4)
        fr2 = gk.frame_y([(a, b) for a, b in O_], [(a, b) for a, b in I_], -0.0018, 0.0004)   # di bidang (a=x, b=z) lalu diputar ke samping
        bmesh.ops.transform(fr2, matrix=Matrix(((0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))), verts=fr2.verts)
        bmesh.ops.recalc_face_normals(fr2, faces=fr2.faces)
        put(B, fr2, mat, T(sx * 0.0163, 0, 0))
        fr.free()
    if rib:
        for z in (-0.040, -0.030, -0.020, -0.010, 0.000, 0.010):   # alur tali depan
            put(B, p_box(0.0170, 0.0010, 0.0018), mat, T(0, yc(z) + 0.0243, z))


def trigger_group(B, y0=0.0, trig='gold'):  # y0 < 0: pelindung lebih pendek (senapan dengan liang magasin di depan pelatuk)
    """Pelindung pelatuk + pelatuk emas di depan gagang (y0 = geser depan untuk senjata panjang)."""
    put(B, p_chain([(0, 0.024, 0.048), (0, 0.030, 0.022), (0, 0.072 + y0, 0.019), (0, 0.082 + y0, 0.032), (0, 0.083 + y0, 0.050)],
                   [0.0033] * 5, 6), 'poly')
    put(B, p_chain([(0, 0.053, 0.054), (0, 0.050, 0.044), (0, 0.044, 0.036)], [0.0032, 0.0028, 0.0024], 6), trig)


# ---------------------------------------------------------------- P9: pistol polimer ringkas
def build_pistol():
    """P9 (v6 M2): pistol 9 mm rangka polimer, striker. Slide = node terpisah `pistol_slide` (asal di asal senjata; runtime
    menggesernya di sumbu laras): gerigi tarik depan-belakang, lubang lontar + ekstraktor, pisir 3 titik. Badan: laras +
    blok kamar (terlihat lewat lubang lontar), rangka dengan rel aksesori bawah, tuas & pin, pelindung pelatuk."""
    B = bmesh.new()
    zb = 0.078
    W = 0.0256
    hw = W / 2
    # ---- slide: penampang (sisi datar, bahu atas dipangkas dua tingkat) diekstrusi sepanjang laras, lalu dipotong
    sec = [(-hw, 0.0636), (hw, 0.0636), (hw, 0.0868), (hw - 0.0022, 0.0912), (hw - 0.0056, 0.0945), (-(hw - 0.0056), 0.0945),
           (-(hw - 0.0022), 0.0912), (-hw, 0.0868)]
    sl = gk.prof_y(sec, -0.0470, 0.1385)
    cutters = []
    for sx in (-1, 1):
        for i in range(7):   # gerigi tarik belakang (miring 16°)
            cutters.append(gk.xf(gk.box(0.0026, 0.0018, 0.0200), T(sx * hw, -0.0405 + i * 0.0040, 0.0765) @ Rx(-16)))
        for i in range(5):   # gerigi depan
            cutters.append(gk.xf(gk.box(0.0026, 0.0018, 0.0200), T(sx * hw, 0.1040 + i * 0.0040, 0.0765) @ Rx(-16)))
        # panel peringan di sisi depan (cekung 0,7 mm)
        cutters.append(gk.xf(gk.ext_x(gk.fillet2d([(0.0640, 0.0660), (0.0985, 0.0660), (0.0945, 0.0835), (0.0600, 0.0835)], 0.0015), 0.0014)[0], T(sx * hw, 0, 0)))
    cutters.append(gk.box(0.0200, 0.0400, 0.0300, 0.0128, 0.0400, 0.0960))          # lubang lontar (kanan-atas)
    cutters.append(gk.xf(gk.cyl(0.0079, 0.1300, 24), T(0, 0.0150, zb) @ Rx(-90)))    # liang laras tembus ke depan
    cutters.append(gk.xf(gk.cyl(0.0036, 0.0040, 16), T(0, 0.1365, 0.0672) @ Rx(-90)))  # ceruk batang pegas di muka slide
    sl = gk.cut(sl, cutters)
    S = bmesh.new()
    put(S, sl, 'dark')
    # pisir belakang takik-U + 2 titik, pejera depan landai + 1 titik (garis bidik z = 0,101)
    put(S, gk.prof_y([(-0.0082, 0.0942), (0.0082, 0.0942), (0.0082, 0.1016), (0.0024, 0.1016), (0.0024, 0.0986), (-0.0024, 0.0986),
                      (-0.0024, 0.1016), (-0.0082, 0.1016)], -0.0450, -0.0365), 'dark')
    for sx in (-1, 1):
        put(S, zturret(gk.cyl(0.0011, 0.0003, 12), (sx * 0.0052, -0.0450, 0.0996), '-y'), 'canister')
    put(S, gk.plate([(0.1215, 0.0942), (0.1320, 0.0942), (0.1312, 0.1006), (0.1262, 0.1006)], 0.0036, 0.0, 0.0004), 'dark')
    put(S, zturret(gk.cyl(0.0011, 0.0003, 12), (0, 0.1247, 0.0990), '-y') , 'canister')
    put(S, p_box(0.0014, 0.0180, 0.0030, 0.0005), 'steel', T(hw - 0.0002, 0.0100, 0.0855))      # ekstraktor
    put(S, p_box(0.0190, 0.0012, 0.0220, 0.0005), 'poly', T(0, -0.0473, 0.0790))                # pelat tutup belakang
    put(S, zturret(gk.cyl(0.0022, 0.0004, 14), (0, -0.0479, 0.0800), '-y'), 'steel')            # indikator striker
    put(S, p_box(0.0008, 0.0160, 0.0008), 'gold', T(hw, -0.0040, 0.0700), mirror=True)           # garis identitas
    # ---- laras + blok kamar (diam; tampak di lubang lontar dan di muka slide)
    put(B, ylathe([(0.0044, 0.0580), (0.0070, 0.0580), (0.0070, 0.1400), (0.0063, 0.1415), (0.0048, 0.1415), (0.0044, 0.1385),
                   (0.0044, 0.0580)], 22, zb), 'steel')
    put(B, p_cyly(0.0044, 0.0010, 14), 'rubber', T(0, 0.1380, zb))                              # dasar lubang laras (gelap)
    put(B, p_box(0.0150, 0.0400, 0.0180, 0.0012), 'steel', T(0, 0.0400, 0.0842))                # blok kamar
    put(B, p_cyly(0.0030, 0.0030, 12), 'steel', T(0, 0.1362, 0.0672))                           # ujung batang pegas
    # ---- rangka polimer: dust cover + ekor, rel aksesori bawah, pelindung pelatuk
    put(B, gk.plate([(-0.0400, 0.0480), (-0.0520, 0.0525), (-0.0540, 0.0605), (-0.0460, 0.0632), (0.1330, 0.0632), (0.1340, 0.0490),
                     (0.0900, 0.0470), (0.0860, 0.0500), (0.0240, 0.0500)], 0.0246, [0.002, 0.003, 0.003, 0.001, 0.001, 0.002, 0.001, 0.001, 0.0],
                    0.0024, segs=2), 'poly')
    put(B, gk.picatinny(0.0400, 0.0900, 0.0, -0.0075, 0.0140, end=0.005), 'poly', T(0, 0, 0.0402) @ Ry(180))
    tg = gk.plate([(0.0200, 0.0520), (0.0925, 0.0520), (0.0940, 0.0300), (0.0830, 0.0140), (0.0360, 0.0140), (0.0245, 0.0230)], 0.0128,
                  [0.0, 0.0, 0.008, 0.011, 0.009, 0.004], 0.0030, segs=3, tri=False)
    tg = gk.cut(tg, [gk.ext_x(gk.fillet2d([(0.0300, 0.0178), (0.0895, 0.0178), (0.0890, 0.0490), (0.0280, 0.0490)], [0.007, 0.010, 0.004, 0.004], 5), 0.03)[0]])
    put(B, tg, 'poly')
    put(B, gk.plate([(0.0490, 0.0510), (0.0560, 0.0510), (0.0545, 0.0410), (0.0500, 0.0310), (0.0462, 0.0296), (0.0480, 0.0400)], 0.0070,
                    0.001, 0.0014), 'dark')                                                    # pelatuk
    put(B, gk.plate([(0.0500, 0.0440), (0.0515, 0.0440), (0.0480, 0.0320), (0.0462, 0.0318)], 0.0022, 0.0, 0.0003), 'steel')  # bilah pengaman
    # tuas penahan slide (kiri), tuas bongkar (dua sisi), tombol magasin, pin
    put(B, gk.plate([(0.0180, 0.0612), (0.0520, 0.0612), (0.0520, 0.0640), (0.0300, 0.0668), (0.0180, 0.0660)], 0.0022, 0.0008, 0.0005,
                    x0=-(0.0123 + 0.0009)), 'dark')
    for i in range(3):
        put(B, p_box(0.0010, 0.0010, 0.0040), 'dark', T(-0.0142, 0.0215 + i * 0.0026, 0.0640))
    put(B, p_box(0.0272, 0.0085, 0.0036, 0.0008), 'dark', T(0, 0.0640, 0.0560))
    put(B, p_box(0.0345, 0.0085, 0.0085, 0.0012), 'dark', T(0, 0.0215, 0.0440))
    for (y, z, d) in ((0.0560, 0.0575, 0.0034), (0.0740, 0.0590, 0.0040), (-0.0300, 0.0570, 0.0034)):
        for sx in (-1, 1):
            put(B, zturret(gk.cyl(d / 2, 0.0006, 14), (sx * 0.0123, y, z), '+x' if sx > 0 else '-x'), 'steel')
    put(B, grip_bm(), 'grip')
    grip_panels(B, 'poly')
    for i in range(4):  # gerigi jari di muka pelindung pelatuk
        put(B, p_box(0.0100, 0.0008, 0.0016), 'poly', T(0, 0.0938, 0.0290 + i * 0.0038))
    put(B, gk.plate([(-0.0300, 0.0460), (-0.0440, 0.0440), (-0.0530, 0.0500), (-0.0400, 0.0530)], 0.0200, 0.003, 0.0040, segs=2), 'poly')  # ekor berang-berang
    # magasin (di dalam gagang; alas terlihat di bawah)
    top = Vector((0, yc(0.045), 0.045))
    M = bmesh.new()
    rings = [superellipse(0, yc(z), z, 0.0105, 0.016, 0.017, 12, 3) for z in (-0.064, 0.045)]
    merge(M, p_loft(rings), 'dark')
    yb = yc(-0.066)
    put(M, gk.plate([(yb - 0.0300, -0.0700), (yb + 0.0290, -0.0700), (yb + 0.0320, -0.0660), (yb + 0.0300, -0.0620), (yb - 0.0290, -0.0620),
                     (yb - 0.0310, -0.0660)], 0.0330, 0.0012, 0.0026, segs=2), 'poly')
    for v in M.verts:
        v.co -= top
    wear = [((0, 0.140, zb), 0.05), ((0.012, 0.040, 0.090), 0.045), ((0, -0.030, 0.080), 0.04), ((0, -0.020, -0.066), 0.045), ((0, 0.110, 0.045), 0.04)]
    return dict(body=B, mag=(M, top), parts=[('pistol_slide', S, (0, 0, 0))], muzzle=(0, 0.1420, zb), sight=(0, -0.040, 0.101),
                guard=(-0.026, 0.008, -0.034), wear=wear)


# ---------------------------------------------------------------- pembantu bentuk (M3)
def panel_cut(pts, x, r=0.002, d=0.0014):
    """Pemotong panel cekung di sisi badan (x = bidang sisi; kedalaman d/2)."""
    return gk.xf(gk.ext_x(gk.fillet2d(pts, r), d)[0], T(x, 0, 0))


def slotted_hg(y0, y1, zc, HX, HT, HB, e=5.0, n=4, sl=0.040, side=0.009, bottom=0.009, diag=0.0062, wall=0.0028, segs=32, lead=0.022, side_dz=-0.0015):
    """Pelindung tangan berongga berslot (samping tembus, bawah, diagonal atas): laras terlihat lewat celah."""
    hg = gk.loft_shell([(y0, zc, HT, HB, HX, e), (y1, zc, HT, HB, HX, e)], segs, wall)
    cs = []
    pitch = (y1 - y0 - 2 * lead - sl) / (n - 1) if n > 1 else 0.0
    for i in range(n):
        a = y0 + lead + i * pitch
        if side:
            cs.append(gk.xf(gk.slot_x(a, a + sl, 0.0, side, 4 * HX), T(0, 0, zc + side_dz)))
        if bottom:
            cs.append(gk.slot_z(a, a + sl, 0.0, bottom, 0.02, zc - HB))
        if diag:
            for ang in (-45, 45):
                cs.append(gk.xf(gk.slot_z(a + 0.006, a + sl - 0.006, 0.0, diag, 0.02, (HX + HT) * 0.62), T(0, 0, zc) @ Ry(ang)))
    return gk.cut(hg, cs)


def brake(y0, L, rb, r, n=3, zc=0.0, top=True, segs=24):
    """Rem moncong berport samping (n port tembus kiri-kanan + lubang atas), sumbu Y di z = zc."""
    mb = gk.lathe([(rb, y0), (r * 0.9, y0), (r, y0 + 0.006), (r, y0 + L - 0.0055), (r * 0.92, y0 + L), (rb + 0.0012, y0 + L), (rb + 0.0012, y0 + 0.012),
                   (rb, y0 + 0.010), (rb, y0)], segs)
    cs = []
    pitch = (L - 0.022) / n
    for i in range(n):
        a = y0 + 0.016 + i * pitch
        cs.append(gk.slot_x(a, a + pitch * 0.6, 0.0, r * 0.8, 4 * r, 0.003))
        if top:
            cs.append(gk.xf(gk.cyl(0.0022, 0.02, 12), T(0, a + pitch * 0.3, 0.005)))
    return gk.xf(gk.cut(mb, cs), T(0, 0, zc))


def cage(y0, L, rb, r, zc=0.0, angles=(0, 60, -60, 120, -120), w=0.0036, segs=24):
    """Peredam kilat sangkar (celah memanjang, bawah tertutup)."""
    fh = gk.lathe([(rb, y0), (r * 0.93, y0), (r, y0 + 0.004), (r, y0 + L - 0.005), (r * 0.9, y0 + L), (rb + 0.0018, y0 + L), (rb + 0.0018, y0 + 0.012),
                   (rb, y0 + 0.010), (rb, y0)], segs)
    return gk.xf(gk.cut(fh, gk.radial_slots(y0 + 0.015, y0 + L - 0.008, rb * 0.5, r * 1.8, w, list(angles))), T(0, 0, zc))


def butt_pad(B, y, z0, z1, w, t=0.014, mat='rubber'):
    """Bantalan karet di pangkal popor (muka belakang melengkung)."""
    zm = (z0 + z1) / 2
    put(B, gk.plate([(y, z0), (y, z1), (y - t * 0.78, z1 - 0.004), (y - t, zm), (y - t * 0.78, z0 + 0.004)], w, 0.003, 0.0038, segs=2), mat)
    for k in range(3):
        put(B, p_box(w * 0.62, 0.0008, 0.0016), mat, T(0, y - t - 0.0002, zm - 0.012 + k * 0.012))


def box_mag(M, pts, w, mat='dark', floor='poly', ribs=(), ch=0.0028, fl=0.0045, rw=0.0012):
    """Magasin kotak dari siluet samping [(y, z)]: depan-atas, belakang-atas, belakang-bawah, depan-bawah (urutan bebas, 4
    titik: atas dua dulu). ribs = pecahan tinggi (0 atas … 1 bawah) untuk rusuk melintang; alas menebal."""
    (y0, z0), (y1, z1), (y2, z2), (y3, z3) = pts   # atas-belakang, atas-depan, bawah-depan, bawah-belakang
    put(M, gk.plate([(y0, z0), (y1, z1), (y2, z2), (y3, z3)], w, 0.0, ch, segs=2), mat)
    L = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    for t in ribs:
        a0, b0 = L((y0, z0), (y3, z3), t), L((y1, z1), (y2, z2), t)
        a1, b1 = L((y0, z0), (y3, z3), t + 0.03), L((y1, z1), (y2, z2), t + 0.03)
        put(M, gk.plate([a0, b0, b1, a1], w + rw, 0.0, 0.0005), mat)
    dy, dz = y2 - y3, z2 - z3
    ln = math.hypot(dy, dz)
    uy, uz = dy / ln, dz / ln
    ny, nz = uz, -uy   # ke bawah
    e = 0.003
    put(M, gk.plate([(y3 - uy * e, z3 - uz * e), (y2 + uy * e, z2 + uz * e), (y2 + uy * e + ny * fl, z2 + uz * e + nz * fl),
                     (y3 - uy * e + ny * fl, z3 - uz * e + nz * fl)], w + 0.0050, 0.0012, 0.0022, segs=2), floor)


def stock_knob(B, x, y, z, r=0.0070, h=0.0058, mat='dark'):
    put(B, zturret(gk.knurl(r, h, 26, 0.0006), (x, y, z), '+x'), mat)


# ---------------------------------------------------------------- Kilat: SMG ringkas, popor lipat di kiri
def build_smg():
    """Kilat (v6 M3): SMG 9 mm receiver tabung, popor lipat samping (terlipat di kiri). Tabung dengan lubang lontar & alur
    tuas kokang kiri, rel atas + BUIS, rangka bawah polimer + liang magasin, pelindung tangan pendek berslot, kompensator
    berport, engsel popor, paku keling, magasin lurus berusuk."""
    B = bmesh.new()
    zb = 0.092
    R = 0.0205
    tb = gk.lathe([(0.0, -0.0820), (R - 0.003, -0.0820), (R, -0.0780), (R, 0.2050), (0.0, 0.2050)], 28)
    tb = gk.cut(tb, [gk.box(0.0200, 0.0500, 0.0130, R, 0.0450, 0.0060),                             # lubang lontar (kanan-atas)
                     gk.box(0.0080, 0.0900, 0.0050, -R, 0.1150, 0.0110)])                           # alur tuas kokang (kiri)
    put(B, gk.xf(tb, T(0, 0, zb)), 'dark')
    put(B, p_cyly(0.0150, 0.0560, 16), 'steel', T(0, 0.0450, zb))                                   # bolt di lubang lontar
    put(B, ylathe([(0.0, -0.0860), (0.0150, -0.0860), (0.0185, -0.0830), (0.0185, -0.0790), (0.0, -0.0790)], 24, zb), 'dark')   # tutup belakang
    put(B, p_box(0.0060, 0.0100, 0.0045, 0.0010), 'dark', T(-R - 0.0010, 0.1300, zb + 0.0110))     # tuas kokang kiri
    put(B, zturret(gk.knurl(0.0048, 0.0130, 20, 0.0005), (-R - 0.0030, 0.1300, zb + 0.0110), '-x'), 'steel')
    for y in (-0.0600, 0.0000, 0.1900):
        put(B, ylathe([(R - 0.0002, y), (R + 0.0008, y), (R + 0.0008, y + 0.0030), (R - 0.0002, y + 0.0030), (R - 0.0002, y)], 28, zb), 'dark')   # cincin las
    R6 = {}
    add_rail_and_buis(R6, B, 0.127, -0.07, 0.20, base=-0.016, mount=0.03)
    engrave(B, 'KILAT', -0.0178, 0.0300, 0.0560, 0.0055)
    # ---- rangka bawah polimer + liang magasin
    put(B, gk.plate([(-0.0720, 0.0800), (-0.0720, 0.0500), (-0.0580, 0.0440), (0.1400, 0.0440), (0.1400, 0.0800)], 0.0340, [0.0, 0.004, 0.003, 0.0, 0.0],
                    0.0030, segs=2), 'poly')
    put(B, gk.plate([(0.0860, 0.0160), (0.1370, 0.0210), (0.1395, 0.0260), (0.1395, 0.0720), (0.0860, 0.0720)], 0.0350, [0.002, 0.003, 0.002, 0.0, 0.0],
                    0.0030, segs=2), 'poly')
    put(B, gk.plate([(0.0840, 0.0120), (0.1400, 0.0175), (0.1410, 0.0240), (0.0845, 0.0190)], 0.0390, 0.0015, 0.0022, segs=2), 'poly')            # bibir liang
    for (y, z) in ((-0.0600, 0.0600), (0.0100, 0.0520), (0.0700, 0.0600), (0.1300, 0.0620)):
        side_disc(B, y, z, 0.0170, 0.0046, 'steel', 0.0008, 12)                                     # paku keling / pin
    side_disc(B, -0.0300, 0.0580, 0.0170, 0.0100, 'dark', 0.0016, 20)                               # poros pemilih
    put(B, gk.plate([(-0.0320, 0.0560), (-0.0110, 0.0600), (-0.0115, 0.0632), (-0.0330, 0.0602)], 0.0030, 0.001, 0.0008, x0=-0.0196), 'dark')
    put(B, p_box(0.0008, 0.0030, 0.0008), 'gold', T(-0.0172, -0.0380, 0.0650))
    put(B, gk.plate([(0.0700, 0.0300), (0.0860, 0.0300), (0.0860, 0.0420), (0.0740, 0.0420)], 0.0100, 0.002, 0.0014), 'dark')                     # tuas magasin (belakang liang)
    put(B, p_box(0.0008, 0.0900, 0.0008), 'gold', T(0.0170, 0.0700, 0.0480), mirror=True)          # garis identitas
    # ---- pelindung tangan pendek berslot, laras, kompensator berport atas
    HX = HT = HB = 0.0210
    put(B, slotted_hg(0.2050, 0.3000, zb, HX, HT, HB, 4.0, 2, 0.0260, lead=0.0140), 'poly')
    put(B, gk.loft_shell([(0.3002, zb, HT + 0.0004, HB + 0.0004, HX + 0.0004, 4.0), (0.3028, zb, HT + 0.0004, HB + 0.0004, HX + 0.0004, 4.0)], 32, 0.0040), 'gold')
    put(B, ylathe([(0.0, 0.2000), (0.0078, 0.2000), (0.0078, 0.3300), (0.0, 0.3300)], 18, zb), 'dark')
    cp = gk.lathe([(0.0050, 0.3220), (0.0100, 0.3220), (0.0110, 0.3260), (0.0110, 0.3590), (0.0100, 0.3632), (0.0062, 0.3632), (0.0062, 0.3320),
                   (0.0050, 0.3300), (0.0050, 0.3220)], 22)
    cp = gk.cut(cp, [gk.slot_z(0.3340 + i * 0.0085, 0.3340 + i * 0.0085 + 0.0045, 0.0, 0.0090, 0.0200, 0.0100) for i in range(3)])
    put(B, gk.xf(cp, T(0, 0, zb)), 'dark')
    # ---- popor lipat (terlipat di sisi kiri): engsel, dua batang baja, pelat bahu berbantalan
    x = -0.0305
    put(B, gk.plate([(-0.0860, 0.0700), (-0.0660, 0.0700), (-0.0660, 0.1120), (-0.0860, 0.1120)], 0.0140, 0.003, 0.0020, x0=-0.0210), 'dark')    # blok engsel
    put(B, p_cyl(0.0042, 0.0042, 0.0480, 12), 'steel', T(-0.0260, -0.0760, 0.0910))
    for z in (0.0740, 0.1040):
        put(B, p_tube((x, -0.0720, z), (x, 0.1300, z), 0.0042, 0.0042, 12), 'steel')
    put(B, gk.plate([(0.1280, 0.0620), (0.1420, 0.0620), (0.1420, 0.1160), (0.1280, 0.1160)], 0.0110, 0.004, 0.0030, x0=x, segs=2), 'dark')
    put(B, gk.plate([(0.1420, 0.0640), (0.1470, 0.0660), (0.1470, 0.1120), (0.1420, 0.1140)], 0.0120, 0.002, 0.0020, x0=x), 'rubber')
    put(B, p_box(0.0090, 0.0120, 0.0140, 0.0020), 'dark', T(x + 0.0050, 0.0600, 0.0890))           # kait penahan popor
    put(B, grip_bm(), 'grip')
    trigger_group(B, 0.0, 'steel')
    # ---- magasin lurus berusuk, sedikit condong ke depan
    top = Vector((0, 0.111, 0.058))
    M = bmesh.new()
    box_mag(M, [(0.0945, 0.0580), (0.1275, 0.0580), (0.1454, -0.1120), (0.1124, -0.1120)], 0.0230, 'dark', 'poly', (), 0.0026)
    for sx in (-1, 1):
        for dy in (-0.0060, 0.0060):   # dua rusuk memanjang per sisi
            put(M, gk.plate([(0.1105 + dy, 0.0100), (0.1125 + dy, 0.0100), (0.1290 + dy, -0.1040), (0.1270 + dy, -0.1040)], 0.0012, 0.0, 0.0003, x0=sx * 0.0116), 'dark')
    shift(M, top)
    wear = [((0, 0.355, zb), 0.05), ((0.020, 0.045, 0.098), 0.06), ((0, 0.111, 0.020), 0.06), ((-0.025, 0.130, 0.103), 0.04), ((0, 0.258, 0.070), 0.07),
            ((-0.030, 0.140, 0.090), 0.06), ((0, -0.082, zb), 0.04)]
    return {**dict(body=B, mag=(M, top), muzzle=(0, 0.3632, zb), guard=(0, 0.258, zb - HB - 0.017), wear=wear), **R6}



# ---------------------------------------------------------------- Garuda: senapan serbu, red dot bingkai terbuka
AR_DOT = (0, 0.036, 0.163)


def red_dot(B, y, zs):
    """Red dot bingkai terbuka: dudukan + tiang + cincin tipis + kaca bening + titik emisif tepat di AR_DOT."""
    put(B, p_box(0.03, 0.05, 0.011, 0.002), 'dark', T(0, y, 0.1325))
    put(B, p_box(0.02, 0.012, 0.006, 0.001), 'gold', T(0.0155, y - 0.012, 0.132))  # baut kunci
    for sx in (-1, 1):
        put(B, p_box(0.006, 0.016, 0.022, 0.002), 'dark', T(sx * 0.0175, y + 0.004, 0.147))
    put(B, p_torus(0.0215, 0.0032, 28, 6, 'Y'), 'dark', T(0, y + 0.004, zs))
    put(B, p_cyly(0.0215, 0.0026, 28), 'glass', T(0, y + 0.004, zs))
    put(B, p_sphere(0.0011, 8, 4), 'dot', T(*AR_DOT))
    put(B, p_box(0.008, 0.012, 0.006, 0.0015), 'dark', T(0.023, y + 0.004, zs))  # tombol kecerahan kanan


def side_disc(B, y, z, x, d, mat='steel', h=0.0010, n=16, sides=(-1, 1)):
    """Kepala pin / cakram tipis di sisi badan (x = setengah lebar badan), kedua sisi."""
    for sx in sides:
        put(B, zturret(gk.cyl(d / 2, h, n), (sx * x, y, z), '+x' if sx > 0 else '-x'), mat)


def build_ar():
    """Garuda (v6 M2): karabin modular piston gas 14,5", upper monolitik. Rel atas penuh, pelindung tangan free-float
    berongga berslot 3 sisi (laras, blok gas & tabung piston terlihat di dalam), lubang lontar + pintu debu terbuka,
    forward-assist, pin takedown, popor teleskopik + bantalan karet, magasin lengkung berpanel, peredam kilat sangkar."""
    B = bmesh.new()
    zb = 0.088
    # ---- upper: penampang bahu dipangkas dua tingkat, lubang lontar dipotong
    up = gk.prof_y([(-0.0200, 0.0655), (0.0200, 0.0655), (0.0200, 0.1035), (0.0168, 0.1105), (0.0105, 0.1152), (-0.0105, 0.1152),
                    (-0.0168, 0.1105), (-0.0200, 0.1035)], -0.1060, 0.1800)
    pk = lambda pts, sx: gk.xf(gk.ext_x(gk.fillet2d(pts, 0.002), 0.0014)[0], T(sx * 0.0200, 0, 0))  # panel cekung 0,7 mm
    up = gk.cut(up, [gk.box(0.0080, 0.0560, 0.0150, 0.0200, 0.0500, 0.0935),
                     pk([(-0.0880, 0.0740), (0.1680, 0.0740), (0.1680, 0.0985), (-0.0640, 0.0985)], -1),
                     pk([(-0.0880, 0.0740), (-0.0300, 0.0740), (-0.0300, 0.0985), (-0.0640, 0.0985)], 1),
                     pk([(0.0900, 0.0740), (0.1680, 0.0740), (0.1680, 0.0985), (0.0900, 0.0985)], 1)])
    put(B, up, 'dark')
    put(B, p_box(0.0010, 0.0540, 0.0130), 'steel', T(0.0164, 0.0500, 0.0935))                  # pembawa bolt di dalam lubang lontar
    for i in range(3):
        put(B, p_box(0.0012, 0.0016, 0.0130), 'dark', T(0.0166, 0.0360 + i * 0.0050, 0.0935))
    put(B, p_box(0.0016, 0.0600, 0.0165, 0.0005), 'dark', T(0.0228, 0.0500, 0.0770) @ Ry(-14))  # pintu debu terbuka
    put(B, p_cyly(0.0017, 0.0660, 10), 'steel', T(0.0208, 0.0500, 0.0852))                      # engselnya
    put(B, gk.plate([(0.0020, 0.0880), (0.0190, 0.0880), (0.0190, 0.1010), (0.0100, 0.1010)], 0.0070, 0.002, 0.0022, x0=0.0200), 'dark')  # pemantul selongsong
    put(B, zturret(gk.cyl(0.0064, 0.0100, 18), (0.0185, -0.0140, 0.1000), '+x'), 'dark')        # forward-assist
    put(B, zturret(gk.knurl(0.0052, 0.0042, 22, 0.0004), (0.0285, -0.0140, 0.1000), '+x'), 'dark')
    put(B, p_box(0.0420, 0.0100, 0.0070, 0.0020), 'dark', T(0, -0.1090, 0.1090))                # tuas kokang T
    put(B, p_box(0.0080, 0.0150, 0.0076, 0.0015), 'dark', T(-0.0185, -0.1050, 0.1090))          # kaitnya
    R6 = {}  # rel atas menerus + BUIS rebah (selalu membawa optik: titik merah bawaan)
    add_rail_and_buis(R6, B, 0.12645, -0.105, 0.46, merged=True, base=-0.0115, mount=0.0)
    # ---- lower: siluet samping + liang magasin melebar
    put(B, gk.plate([(-0.1060, 0.0670), (-0.1060, 0.0540), (-0.0940, 0.0450), (-0.0420, 0.0450), (-0.0320, 0.0500), (0.0580, 0.0500),
                     (0.0600, 0.0670)], 0.0370, [0.0, 0.004, 0.004, 0.003, 0.003, 0.0, 0.0], 0.0026, segs=2), 'dark')
    put(B, gk.plate([(0.0580, 0.0050), (0.1350, 0.0115), (0.1380, 0.0160), (0.1380, 0.0670), (0.0580, 0.0670)], 0.0400,
                    [0.002, 0.003, 0.002, 0.0, 0.0], 0.0030, segs=2), 'dark')
    put(B, gk.plate([(0.0555, 0.0010), (0.1385, 0.0080), (0.1395, 0.0150), (0.0560, 0.0085)], 0.0440, 0.0015, 0.0022, segs=2), 'dark')  # bibir liang
    for i in range(4):  # gerigi jari di muka liang magasin
        put(B, p_box(0.0300, 0.0012, 0.0030, 0.0004), 'dark', T(0, 0.1384, 0.0260 + i * 0.0085))
    put(B, ylathe([(0.0120, -0.1075), (0.0175, -0.1075), (0.0175, -0.0990), (0.0120, -0.0990), (0.0120, -0.1075)], 24, zb), 'dark')  # menara buffer
    side_disc(B, -0.0780, 0.0585, 0.0185, 0.0080)                                               # pin takedown belakang
    side_disc(B, 0.1280, 0.0560, 0.0200, 0.0080)                                                # pin pivot depan
    side_disc(B, 0.0120, 0.0570, 0.0185, 0.0042)
    side_disc(B, -0.0130, 0.0610, 0.0185, 0.0042)
    side_disc(B, -0.0320, 0.0570, 0.0185, 0.0110, 'dark', 0.0016, 20)                           # pemilih tembak (poros dua sisi)
    put(B, gk.plate([(-0.0340, 0.0550), (-0.0120, 0.0590), (-0.0125, 0.0625), (-0.0350, 0.0595)], 0.0030, 0.001, 0.0008, x0=-0.0212), 'dark')  # tuasnya (kiri)
    put(B, p_box(0.0008, 0.0030, 0.0008), 'gold', T(-0.0187, -0.0400, 0.0640))                  # tanda indeks
    put(B, p_box(0.0030, 0.0110, 0.0130, 0.0010), 'dark', T(0.0212, 0.0500, 0.0540))            # tombol magasin (kanan)
    for i in range(3):
        put(B, p_box(0.0008, 0.0090, 0.0010), 'dark', T(0.0229, 0.0500, 0.0505 + i * 0.0035))
    put(B, gk.plate([(0.0380, 0.0440), (0.0640, 0.0440), (0.0640, 0.0470), (0.0380, 0.0470)], 0.0030, 0.001, 0.0006, x0=0.0205), 'dark')  # pagar tombol
    put(B, gk.plate([(0.0290, 0.0640), (0.0410, 0.0640), (0.0410, 0.0800), (0.0330, 0.0820), (0.0290, 0.0780)], 0.0028, 0.0015, 0.0008,
                    x0=-0.0212), 'dark')                                                       # penahan bolt (kiri)
    # ---- pelindung tangan free-float berongga: slot samping, bawah, dan diagonal atas
    HX, HT, HB = 0.0232, 0.0272, 0.0250
    hg = gk.loft_shell([(0.1800, zb, HT, HB, HX, 5.0), (0.4520, zb, HT, HB, HX, 5.0)], 32, 0.0028)
    cs = []
    for i in range(4):
        y0 = 0.2020 + i * 0.0610
        cs.append(gk.xf(gk.slot_x(y0, y0 + 0.0400, 0.0, 0.0090, 0.0800), T(0, 0, zb - 0.0015)))
        cs.append(gk.slot_z(y0, y0 + 0.0400, 0.0, 0.0090, 0.0200, zb - HB))
        for a in (-45, 45):
            cs.append(gk.xf(gk.slot_z(y0 + 0.0060, y0 + 0.0340, 0.0, 0.0062, 0.0200, 0.0300), T(0, 0, zb) @ Ry(a)))
    put(B, gk.cut(hg, cs), 'poly')
    put(B, gk.loft_shell([(0.4522, zb, HT + 0.0004, HB + 0.0004, HX + 0.0004, 5.0), (0.4548, zb, HT + 0.0004, HB + 0.0004, HX + 0.0004, 5.0)],
                         32, 0.0040), 'gold')                                                  # cincin identitas di ujung
    put(B, ylathe([(0.0100, 0.1740), (0.0222, 0.1740), (0.0222, 0.1830), (0.0100, 0.1830), (0.0100, 0.1740)], 28, zb), 'dark')  # mur laras
    for y in (0.1900, 0.2000):
        put(B, zturret(gk.screw('torx', 0.0046, 0.0014), (-HX - 0.0002, y, zb - 0.0170), '-x'), 'steel')
    # ---- laras, blok gas + tabung piston (di dalam pelindung tangan), peredam kilat sangkar
    put(B, ylathe([(0.0, 0.1700), (0.0104, 0.1700), (0.0104, 0.3000), (0.0092, 0.3040), (0.0092, 0.4560), (0.0085, 0.4590),
                   (0.0085, 0.5620), (0.0076, 0.5650), (0.0076, 0.5880), (0.0, 0.5880)], 20, zb), 'dark')
    put(B, gk.plate([(0.3540, zb - 0.0125), (0.3860, zb - 0.0125), (0.3860, zb + 0.0215), (0.3540, zb + 0.0215)], 0.0220, 0.003, 0.0030), 'dark')
    put(B, p_cyly(0.0046, 0.1700, 12), 'steel', T(0, 0.2700, zb + 0.0165))
    fh = gk.lathe([(0.0044, 0.5840), (0.0104, 0.5840), (0.0112, 0.5880), (0.0112, 0.6240), (0.0100, 0.6289), (0.0062, 0.6289),
                   (0.0062, 0.5960), (0.0044, 0.5940), (0.0044, 0.5840)], 24)
    fh = gk.cut(fh, gk.radial_slots(0.5990, 0.6210, 0.0030, 0.0200, 0.0036, [0, 60, -60, 120, -120]))
    put(B, gk.xf(fh, T(0, 0, zb)), 'dark')
    put(B, ylathe([(0.0078, 0.5790), (0.0098, 0.5790), (0.0098, 0.5838), (0.0078, 0.5838), (0.0078, 0.5790)], 6, zb), 'steel')   # mur pengunci
    # ---- tabung buffer + popor teleskopik
    put(B, ylathe([(0.0, -0.2860), (0.0140, -0.2860), (0.0146, -0.2810), (0.0146, -0.1000), (0.0, -0.1000)], 24, zb), 'dark')
    put(B, p_box(0.0090, 0.1700, 0.0060, 0.0010), 'dark', T(0, -0.1950, zb - 0.0160))
    put(B, yknurl(0.0186, -0.1185, -0.1090, zb, 28, 0.0014), 'dark')                            # mur kastil
    put(B, p_box(0.0340, 0.0026, 0.0440, 0.0040), 'dark', T(0, -0.1072, zb - 0.0040))           # pelat ujung
    st = gk.plate([(-0.1960, 0.1110), (-0.3440, 0.1150), (-0.3520, 0.1090), (-0.3520, 0.0120), (-0.3440, 0.0060), (-0.3180, 0.0140),
                   (-0.2380, 0.0640), (-0.1960, 0.0680)], 0.0340, [0.004, 0.006, 0.003, 0.003, 0.004, 0.006, 0.010, 0.003], 0.0042,
                  segs=3, tri=False)
    cs = [gk.ext_x(gk.fillet2d([(-0.3360, 0.0300), (-0.3360, 0.0640), (-0.2660, 0.0640)], 0.006, 4), 0.06)[0]]  # lubang peringan
    for sx in (-1, 1):  # panel cekung 0,9 mm di sisi rumah tabung + alur pegangan
        cs.append(gk.xf(gk.ext_x(gk.fillet2d([(-0.2080, 0.0760), (-0.3360, 0.0760), (-0.3360, 0.1010), (-0.2080, 0.0990)], 0.004, 3), 0.0018)[0], T(sx * 0.0170, 0, 0)))
        for i in range(5):
            cs.append(gk.box(0.0016, 0.0022, 0.0200, sx * 0.0170, -0.2300 - i * 0.0050, 0.0500))
    st = gk.cut(st, cs)
    put(B, st, 'poly')
    put(B, gk.loft_se([(-0.1960, zb + 0.0040, 0.0215, 0.0100, 0.0182, 3.2), (-0.3440, zb + 0.0070, 0.0225, 0.0100, 0.0182, 3.2)], 20), 'poly')   # punggung membulat (sandaran pipi)
    put(B, gk.plate([(-0.3520, 0.0085), (-0.3520, 0.1100), (-0.3620, 0.1070), (-0.3645, 0.0600), (-0.3620, 0.0110)], 0.0350, 0.002, 0.0034,
                    segs=2), 'rubber')                                                         # bantalan karet
    put(B, gk.plate([(-0.2100, 0.0670), (-0.2640, 0.0670), (-0.2590, 0.0590), (-0.2230, 0.0570)], 0.0120, 0.002, 0.0018), 'dark')  # tuas setelan
    side_disc(B, -0.3000, 0.0840, 0.0170, 0.0120, 'steel', 0.0008, 20)                          # soket tali QD
    side_disc(B, -0.3000, 0.0840, 0.0170, 0.0070, 'rubber', 0.0011, 16)
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.025, 'steel')
    engrave(B, 'GARUDA', -0.0188, 0.0200, 0.0590, 0.0055)
    # ---- magasin lengkung berpanel (asal = titik masuk)
    top = Vector((0, 0.097, 0.060))
    M = bmesh.new()

    def mag_line(k0, k1, n, df, dr):
        F, Rr = [], []
        for i in range(n + 1):
            t = k0 + (k1 - k0) * i / n
            c = Vector((0.097 + 0.05 * t ** 1.6, 0.060 - 0.205 * t))
            tg_ = Vector((0.08 * t ** 0.6, -0.205)).normalized()
            nrm = Vector((-tg_.y, tg_.x))   # ke depan (+Y)
            F.append(tuple(c + nrm * df))
            Rr.append(tuple(c - nrm * dr))
        return F + list(reversed(Rr))
    put(M, gk.plate(mag_line(0.0, 1.0, 10, 0.0312, 0.0305), 0.0236, 0.0, 0.0030, segs=2), 'poly')
    put(M, gk.plate(mag_line(0.30, 0.93, 8, 0.0240, 0.0235), 0.0252, 0.0, 0.0008), 'poly')    # panel menonjol
    for k in range(3):
        put(M, gk.plate(mag_line(0.36 + k * 0.19, 0.39 + k * 0.19, 1, 0.0312, 0.0305), 0.0262, 0.0, 0.0008), 'poly')  # rusuk melintang
    a = math.degrees(math.atan2(0.08, 0.205))
    put(M, p_box(0.0290, 0.0700, 0.0090, 0.0030, 2), 'poly', T(0, 0.097 + 0.05 + 0.0015, 0.060 - 0.205 - 0.0030) @ Rx(a))
    for v in M.verts:
        v.co -= top
    wear = [((0, 0.610, zb), 0.06), ((0.020, 0.050, 0.093), 0.06), ((0, 0.097, 0.010), 0.06), ((0, -0.108, 0.109), 0.04), ((-0.020, -0.030, 0.057), 0.04),
            ((0, 0.330, 0.060), 0.08), ((0, -0.360, 0.060), 0.07)]
    return {**dict(body=B, mag=(M, top), muzzle=(0, 0.6289, zb), guard=(0, 0.33, zb - HB - 0.017), wear=wear), **R6}


# ---------------------------------------------------------------- Badai: shotgun pompa
def build_shotgun():
    """Badai (v6 M3): shotgun pompa 12 ga. Penerima berbahu dengan lubang lontar (bolt baja) + port isi bawah (pengangkat),
    laras dengan mahkota berongga, pelindung panas setengah-tabung berlubang, tabung magasin + klem + tutup bergerigi,
    pompa polimer berusuk (node shotgun_pump) dengan batang aksi, popor polimer bersisir turun + bantalan karet,
    pemegang 4 peluru di kiri."""
    B = bmesh.new()
    zb = 0.094
    zl = zb + 0.008      # sumbu laras
    hw = 0.0205
    rc = gk.prof_y([(-hw, 0.0500), (hw, 0.0500), (hw, 0.1000), (hw - 0.0040, 0.1120), (0.0080, 0.1180), (-0.0080, 0.1180), (-(hw - 0.0040), 0.1120),
                    (-hw, 0.1000)], -0.0620, 0.2160)
    rc = gk.cut(rc, [gk.box(0.0090, 0.0620, 0.0190, hw, 0.0700, 0.0920),                            # lubang lontar (kanan)
                     gk.box(0.0260, 0.0850, 0.0120, 0.0, 0.1000, 0.0500),                           # port isi (bawah)
                     panel_cut([(-0.0500, 0.0580), (0.0200, 0.0580), (0.0200, 0.1000), (-0.0500, 0.1000)], hw, 0.003),
                     panel_cut([(-0.0500, 0.0580), (0.2000, 0.0580), (0.2000, 0.0700), (0.0400, 0.0700), (0.0300, 0.1000), (-0.0500, 0.1000)], -hw, 0.003)])
    put(B, rc, 'dark')
    put(B, p_box(0.0010, 0.0600, 0.0170), 'steel', T(hw - 0.0044, 0.0700, 0.0920))                 # bolt di lubang lontar
    put(B, p_box(0.0050, 0.0120, 0.0040, 0.0008), 'steel', T(hw - 0.0030, 0.0480, 0.0920))         # ekstraktor
    put(B, p_box(0.0230, 0.0780, 0.0012), 'steel', T(0, 0.1000, 0.0556))                           # pengangkat di port isi
    side_disc(B, 0.0300, 0.0620, hw, 0.0050, 'steel', 0.0008, 12)                                   # pin pelatuk
    side_disc(B, 0.0700, 0.0600, hw, 0.0050, 'steel', 0.0008, 12)
    put(B, p_box(0.0030, 0.0080, 0.0080, 0.0010), 'dark', T(hw + 0.0010, 0.0100, 0.0560))          # pelepas aksi
    put(B, zturret(gk.cyl(0.0040, 0.0020, 14), (hw, -0.0200, 0.0640), '+x'), 'red')                # pengaman tombol silang
    engrave(B, 'BADAI', -(hw + 0.0002), 0.1000, 0.0820, 0.0065)
    put(B, p_box(0.0008, 0.0800, 0.0008), 'gold', T(hw, 0.1500, 0.0560), mirror=True)              # garis identitas
    # rusuk bidik beralur di atas penerima + manik depan (garis bidik z = 0,1222)
    put(B, gk.plate([(-0.0500, 0.1170), (0.2100, 0.1170), (0.2100, 0.1202), (-0.0500, 0.1202)], 0.0090, 0.0, 0.0006), 'dark')
    for i in range(12):
        put(B, p_box(0.0086, 0.0020, 0.0006), 'dark', T(0, -0.0400 + i * 0.0210, 0.1204))
    # ---- laras (mahkota berongga), pelindung panas berlubang, pangkal manik
    put(B, ylathe([(0.0, 0.2000), (0.0128, 0.2000), (0.0128, 0.6600), (0.0120, 0.6672), (0.0095, 0.6672), (0.0095, 0.6400), (0.0, 0.6400)], 22, zl), 'dark')
    put(B, ylathe([(0.0128, 0.2100), (0.0170, 0.2100), (0.0170, 0.2220), (0.0128, 0.2220), (0.0128, 0.2100)], 24, zl), 'dark')   # mur laras
    hs = gk.lathe([(0.0146, 0.2350), (0.0164, 0.2350), (0.0164, 0.5050), (0.0146, 0.5050), (0.0146, 0.2350)], 24)
    cs = [gk.box(0.0500, 0.3000, 0.0300, 0.0, 0.3700, -0.0190)]                                     # buang separuh bawah
    for i in range(7):
        a = 0.2500 + i * 0.0360
        cs.append(gk.slot_z(a, a + 0.0200, 0.0, 0.0070, 0.0200, 0.0160))
        if i < 6:
            for ang in (-55, 55):
                cs.append(gk.xf(gk.slot_z(a + 0.0180, a + 0.0380, 0.0, 0.0070, 0.0200, 0.0160), Ry(ang)))
    put(B, gk.xf(gk.cut(hs, cs), T(0, 0, zl)), 'dark')
    for y in (0.2420, 0.4980):
        put(B, gk.prof_y(gk.rrect(0.0172, 0.0030, 0.0012, 3, 0.0, zl - 0.0030), y - 0.0030, y + 0.0030), 'dark')   # klem pelindung panas
    put(B, gk.plate([(0.6380, zl + 0.0128), (0.6560, zl + 0.0128), (0.6520, 0.1200), (0.6420, 0.1200)], 0.0050, 0.0, 0.0008), 'dark')
    put(B, p_sphere(0.0023, 10, 6), 'gold', T(0, 0.6460, 0.1214))
    # ---- tabung magasin + klem laras + tutup bergerigi
    put(B, ylathe([(0.0, 0.2100), (0.0112, 0.2100), (0.0112, 0.6000), (0.0, 0.6000)], 20, 0.068), 'dark')
    put(B, gk.xf(gk.knurl(0.0124, 0.0160, 26, 0.0007), T(0, 0.5990, 0.068) @ Rx(-90)), 'dark')
    put(B, ylathe([(0.0112, 0.5940), (0.0128, 0.5940), (0.0128, 0.5980), (0.0112, 0.5980), (0.0112, 0.5940)], 22, 0.068), 'gold')
    put(B, gk.prof_y(gk.rrect(0.0150, 0.0325, 0.0110, 4, 0.0, 0.0855), 0.5700, 0.5840), 'dark')    # klem laras-tabung
    put(B, zturret(gk.screw('hex', 0.0050, 0.0016), (0.0150, 0.5770, 0.0855), '+x'), 'steel')
    # ---- popor polimer: sisir turun (mata di atas sisir, pisir besi bersih), bantalan karet, cincin tali
    put(B, gk.loft_se([(-0.0560, 0.0770, 0.0240, 0.0260, 0.0195, 3.0), (-0.1100, 0.0660, 0.0240, 0.0380, 0.0190, 2.8), (-0.2000, 0.0500, 0.0300, 0.0500, 0.0185, 2.6),
                       (-0.3000, 0.0400, 0.0340, 0.0620, 0.0190, 2.6), (-0.3860, 0.0340, 0.0360, 0.0660, 0.0195, 2.8)], 20), 'poly')
    butt_pad(B, -0.3860, -0.0320, 0.0700, 0.0400, 0.0150)
    side_disc(B, -0.3300, 0.0200, 0.0186, 0.0110, 'steel', 0.0008, 18)
    side_disc(B, -0.3300, 0.0200, 0.0186, 0.0064, 'rubber', 0.0011, 14)
    # ---- pemegang 4 peluru (kiri): hull merah, pangkal kuningan
    put(B, gk.plate([(0.0380, 0.0580), (0.1420, 0.0580), (0.1420, 0.0940), (0.0380, 0.0940)], 0.0070, 0.004, 0.0020, x0=-(hw + 0.0035)), 'poly')
    for i in range(4):
        y = 0.0540 + i * 0.0240
        put(B, gk.xf(gk.lathe([(0.0, 0.0000), (0.0086, 0.0000), (0.0086, 0.0440), (0.0070, 0.0480), (0.0, 0.0480)], 14), T(-(hw + 0.0120), y, 0.0540) @ Rx(90)), 'red')
        put(B, gk.xf(gk.lathe([(0.0, 0.0000), (0.0092, 0.0000), (0.0092, 0.0015), (0.0088, 0.0090), (0.0, 0.0090)], 14), T(-(hw + 0.0120), y, 0.0460) @ Rx(90)), 'gold')
    put(B, grip_bm(), 'grip')
    trigger_group(B, 0.0, 'steel')
    # ---- pompa (node terpisah, asal di tengahnya): badan berusuk + batang aksi baja
    pc = Vector((0, 0.335, 0.068))
    P = bmesh.new()
    pm = gk.loft_se([(-0.0880, 0.0, 0.0200, 0.0290, 0.0215, 3.0), (-0.0800, 0.0, 0.0215, 0.0300, 0.0235, 3.0), (0.0800, 0.0, 0.0215, 0.0300, 0.0235, 3.0),
                     (0.0880, 0.0, 0.0200, 0.0290, 0.0215, 3.0)], 24)
    pm = gk.cut(pm, [gk.box(0.0030, 0.0050, 0.0300, sx * 0.0235, -0.0630 + i * 0.0140, -0.0050) for i in range(10) for sx in (-1, 1)])
    merge(P, pm, 'poly')
    for sx in (-1, 1):
        put(P, p_box(0.0030, 0.1200, 0.0080, 0.0008), 'steel', T(sx * 0.0150, -0.1400, 0.0040))    # batang aksi ke penerima
    wear = [((0, 0.660, zl), 0.06), ((0.020, 0.070, 0.092), 0.07), ((0, 0.100, 0.050), 0.07), ((0, 0.335, 0.040), 0.10), ((0, 0.585, 0.080), 0.05),
            ((0, -0.390, 0.020), 0.08), ((0, 0.370, 0.118), 0.10)]
    return dict(body=B, pump=(P, pc), muzzle=(0, 0.6672, zl), sight=(0, -0.045, 0.1222), guard=(0, 0.335, 0.068 - 0.029 - 0.016), wear=wear, ironD=0.325)



# ---------------------------------------------------------------- Elang: DMR bertropong, bipod terlipat
DMR_ZS = 0.164


def build_dmr():
    """Elang (v6 M3): DMR semi-otomatis 7,62. Upper berbahu dengan lubang lontar (pembawa bolt baja terlihat), rel penuh +
    BUIS lipat, pelindung tangan panjang berongga berslot 3 sisi, laras medium + rem moncong 2 port, popor presisi
    (penyangga pipi & bantalan bersetelan, sisir rendah supaya pisir besi bersih), magasin lurus 10 butir."""
    B = bmesh.new()
    zb = 0.092
    hw = 0.0215
    up = gk.prof_y([(-hw, 0.0660), (hw, 0.0660), (hw, 0.1060), (hw - 0.0035, 0.1135), (0.0110, 0.1185), (-0.0110, 0.1185), (-(hw - 0.0035), 0.1135),
                    (-hw, 0.1060)], -0.1220, 0.2140)
    up = gk.cut(up, [gk.box(0.0080, 0.0660, 0.0160, hw, 0.0550, 0.0970),
                     panel_cut([(-0.1040, 0.0740), (0.2000, 0.0740), (0.2000, 0.1010), (-0.0800, 0.1010)], -hw),
                     panel_cut([(-0.1040, 0.0740), (-0.0320, 0.0740), (-0.0320, 0.1010), (-0.0800, 0.1010)], hw),
                     panel_cut([(0.1020, 0.0740), (0.2000, 0.0740), (0.2000, 0.1010), (0.1020, 0.1010)], hw)])
    put(B, up, 'dark')
    put(B, p_box(0.0010, 0.0640, 0.0140), 'steel', T(hw - 0.0036, 0.0550, 0.0970))                 # pembawa bolt di lubang lontar
    for i in range(4):
        put(B, p_box(0.0012, 0.0016, 0.0140), 'dark', T(hw - 0.0034, 0.0340 + i * 0.0050, 0.0970))
    put(B, gk.plate([(-0.0060, 0.0900), (0.0160, 0.0900), (0.0160, 0.1050), (0.0050, 0.1050)], 0.0075, 0.002, 0.0024, x0=hw + 0.0002), 'dark')   # pemantul selongsong
    put(B, p_box(0.0012, 0.1000, 0.0034), 'rubber', T(hw - 0.0002, 0.1400, 0.1020))                # alur tuas kokang (gelap)
    put(B, p_box(0.0050, 0.0140, 0.0050, 0.0012), 'dark', T(hw + 0.0020, 0.1200, 0.1020))          # batang kokang kanan
    put(B, zturret(gk.knurl(0.0050, 0.0130, 20, 0.0005), (hw + 0.0030, 0.1200, 0.1020), '+x'), 'steel')
    R6 = {}
    add_rail_and_buis(R6, B, 0.1294, -0.1255, 0.5495, base=-0.0115, mount=0.03)
    # ---- lower + liang magasin
    put(B, gk.plate([(-0.1220, 0.0680), (-0.1220, 0.0520), (-0.1080, 0.0440), (-0.0420, 0.0440), (-0.0320, 0.0500), (0.0580, 0.0500), (0.0600, 0.0680)],
                    0.0390, [0.0, 0.004, 0.004, 0.003, 0.003, 0.0, 0.0], 0.0028, segs=2), 'dark')
    put(B, gk.plate([(0.0560, 0.0120), (0.1460, 0.0180), (0.1490, 0.0230), (0.1490, 0.0680), (0.0560, 0.0680)], 0.0420, [0.002, 0.003, 0.002, 0.0, 0.0],
                    0.0032, segs=2), 'dark')
    put(B, gk.plate([(0.0535, 0.0080), (0.1495, 0.0145), (0.1505, 0.0215), (0.0540, 0.0155)], 0.0460, 0.0015, 0.0022, segs=2), 'dark')   # bibir liang
    for i in range(4):
        put(B, p_box(0.0310, 0.0012, 0.0030, 0.0004), 'dark', T(0, 0.1494, 0.0300 + i * 0.0085))
    side_disc(B, -0.0900, 0.0590, 0.0195, 0.0080)                                                   # pin takedown
    side_disc(B, 0.1400, 0.0590, 0.0210, 0.0080)                                                    # pin pivot
    side_disc(B, 0.0120, 0.0570, 0.0195, 0.0042)
    side_disc(B, -0.0130, 0.0610, 0.0195, 0.0042)
    side_disc(B, -0.0340, 0.0570, 0.0195, 0.0110, 'dark', 0.0016, 20)                               # poros pemilih
    put(B, gk.plate([(-0.0360, 0.0550), (-0.0140, 0.0590), (-0.0145, 0.0625), (-0.0370, 0.0595)], 0.0030, 0.001, 0.0008, x0=-0.0222), 'dark')
    put(B, p_box(0.0008, 0.0030, 0.0008), 'gold', T(-0.0197, -0.0420, 0.0640))
    put(B, p_box(0.0030, 0.0110, 0.0130, 0.0010), 'dark', T(0.0222, 0.0480, 0.0560))                # tombol magasin (kanan)
    put(B, gk.plate([(0.0660, 0.0700), (0.0860, 0.0700), (0.0860, 0.0900), (0.0760, 0.0920), (0.0660, 0.0860)], 0.0030, 0.002, 0.0008,
                    x0=-(hw + 0.0012)), 'dark')                                                    # penahan bolt (kiri): titik tepuk kokang
    for i in range(3):
        put(B, p_box(0.0008, 0.0150, 0.0010), 'dark', T(-(hw + 0.0030), 0.0760, 0.0760 + i * 0.0045))
    engrave(B, 'ELANG', -0.0198, 0.0200, 0.0590, 0.0055)
    # ---- pelindung tangan panjang berslot + mur laras + cincin identitas
    HX, HT, HB = 0.0245, 0.0282, 0.0260
    put(B, slotted_hg(0.2140, 0.5490, zb, HX, HT, HB, 5.0, 5, 0.0420), 'poly')
    put(B, gk.loft_shell([(0.5492, zb, HT + 0.0004, HB + 0.0004, HX + 0.0004, 5.0), (0.5518, zb, HT + 0.0004, HB + 0.0004, HX + 0.0004, 5.0)], 32, 0.0040), 'gold')
    put(B, ylathe([(0.0110, 0.2080), (0.0236, 0.2080), (0.0236, 0.2170), (0.0110, 0.2170), (0.0110, 0.2080)], 28, zb), 'dark')
    for y in (0.2260, 0.2380):
        put(B, zturret(gk.screw('torx', 0.0046, 0.0014), (-HX - 0.0002, y, zb - 0.0180), '-x'), 'steel')
    put(B, gk.picatinny(0.0500, 0.4800, 0.0, -0.0075, 0.0150), 'dark', T(0, 0, zb - HB - 0.0050) @ Ry(180))   # rel pendek bawah (stud bipod)
    put(B, p_cylx(0.0030, 0.0200, 10), 'steel', T(0, 0.4700, zb - HB - 0.0070))
    # ---- laras medium, blok gas + tabung, rem moncong 2 port
    put(B, ylathe([(0.0, 0.2000), (0.0115, 0.2000), (0.0115, 0.3300), (0.0100, 0.3350), (0.0100, 0.5600), (0.0092, 0.5650), (0.0092, 0.7720),
                   (0.0080, 0.7750), (0.0080, 0.7900), (0.0, 0.7900)], 22, zb), 'dark')
    put(B, gk.plate([(0.4200, zb - 0.0130), (0.4520, zb - 0.0130), (0.4520, zb + 0.0225), (0.4200, zb + 0.0225)], 0.0230, 0.003, 0.0030), 'dark')
    put(B, p_cyly(0.0046, 0.2160, 12), 'steel', T(0, 0.3200, zb + 0.0170))
    put(B, brake(0.7760, 0.0698, 0.0056, 0.0135, 2, zb), 'dark')
    put(B, ylathe([(0.0080, 0.7690), (0.0112, 0.7690), (0.0112, 0.7730), (0.0080, 0.7730), (0.0080, 0.7690)], 24, zb), 'gold')
    # ---- popor presisi: tabung + badan dengan jendela, penyangga pipi di tiang, bantalan bersetelan
    put(B, ylathe([(0.0, -0.2000), (0.0148, -0.2000), (0.0148, -0.1180), (0.0, -0.1180)], 24, zb), 'dark')
    put(B, yknurl(0.0190, -0.1330, -0.1235, zb, 28, 0.0014), 'dark')                                # mur kastil
    put(B, p_box(0.0350, 0.0026, 0.0460, 0.0040), 'dark', T(0, -0.1232, zb - 0.0040))
    st = gk.plate([(-0.1760, 0.0600), (-0.1760, 0.0890), (-0.4000, 0.0890), (-0.4000, -0.0120), (-0.3720, -0.0180), (-0.3000, 0.0300), (-0.2300, 0.0560)],
                  0.0360, [0.004, 0.006, 0.004, 0.004, 0.006, 0.014, 0.010], 0.0046, segs=3, tri=False)
    cs = [gk.ext_x(gk.fillet2d([(-0.3850, 0.0500), (-0.3850, 0.0040), (-0.3200, 0.0380), (-0.3050, 0.0500)], 0.006, 4), 0.06)[0]]
    for sx in (-1, 1):
        cs.append(panel_cut([(-0.1900, 0.0660), (-0.2900, 0.0660), (-0.2900, 0.0820), (-0.1900, 0.0820)], sx * 0.0180, 0.003, 0.0018))
    put(B, gk.cut(st, cs), 'poly')
    put(B, gk.plate([(-0.2280, 0.0915), (-0.2360, 0.1000), (-0.3620, 0.0985), (-0.3700, 0.0915)], 0.0330, [0.001, 0.005, 0.005, 0.001], 0.0085, segs=4), 'poly')   # penyangga pipi
    for yy in (-0.2600, -0.3400):
        put(B, p_cyl(0.0040, 0.0040, 0.0080, 12), 'steel', T(0, yy, 0.0900))
    stock_knob(B, 0.0178, -0.3000, 0.0740)
    stock_knob(B, 0.0178, -0.3860, 0.0640, 0.0062, 0.0050)
    put(B, p_box(0.0340, 0.0080, 0.0980, 0.0020), 'dark', T(0, -0.4040, 0.0370))
    for zz in (0.0100, 0.0620):
        put(B, p_cyly(0.0034, 0.0120, 12), 'steel', T(0, -0.4130, zz))
    butt_pad(B, -0.4180, -0.0160, 0.0900, 0.0370, 0.0150)
    side_disc(B, -0.2000, 0.0720, 0.0180, 0.0110, 'steel', 0.0008, 20)                              # soket tali QD
    side_disc(B, -0.2000, 0.0720, 0.0180, 0.0064, 'rubber', 0.0011, 16)
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.025, 'steel')
    # ---- magasin lurus 10 butir
    top = Vector((0, 0.10, 0.062))
    M = bmesh.new()
    box_mag(M, [(0.0650, 0.0620), (0.1350, 0.0620), (0.1370, -0.0200), (0.0660, -0.0200)], 0.0244, 'dark', 'poly', (0.45, 0.62, 0.79))
    put(M, gk.plate([(0.0760, 0.0300), (0.1260, 0.0300), (0.1270, -0.0120), (0.0765, -0.0120)], 0.0256, 0.004, 0.0008), 'dark')   # panel menonjol
    shift(M, top)
    wear = [((0, 0.830, zb), 0.07), ((0.022, 0.055, 0.097), 0.07), ((0, 0.100, 0.020), 0.06), ((0.026, 0.120, 0.102), 0.04), ((-0.022, -0.030, 0.057), 0.04),
            ((0, 0.390, 0.064), 0.09), ((0, -0.420, 0.040), 0.08)]
    return {**dict(body=B, mag=(M, top), muzzle=(0, 0.8458, zb), guard=(0, 0.39, zb - HB - 0.017), wear=wear, ironD=0.317), **R6}



# ================================================================ v3: senjata tambahan (Rajawali, Gempa, Kobra, Petir, Lebah, Gada)
# + granat (Granat, Asap). Kontrak sama: origin = titik genggam gagang pistol; bagian bergerak sebagai node terpisah
# (<kind>_mag, sniper_bolt, revolver_cyl, dbs_brk) dengan origin di titik putar/geraknya.
SN_ZS = 0.172


def shift(bm, o):
    for v in bm.verts:
        v.co -= Vector(o)
    return bm


def build_sniper():
    """Rajawali (v6 M2): senapan runduk bolt sasis. Aksi silinder dengan lubang lontar (bolt baja terlihat), sasis zaitun
    dengan alur laras bebas + potongan peringan, laras berat beralur 6 + rem moncong berport, popor rangka berlubang
    dengan penyangga pipi & bantalan yang bisa disetel, bipod terlipat, tuas bolt berbonggol bergerigi."""
    B = bmesh.new()
    zb = 0.090
    # ---- aksi (penerima silinder) + lubang lontar kanan-atas
    ac = gk.lathe([(0.0, -0.0950), (0.0150, -0.0950), (0.0165, -0.0900), (0.0165, 0.1500), (0.0186, 0.1520), (0.0186, 0.1660), (0.0, 0.1660)], 28)
    ac = gk.cut(ac, [gk.box(0.0300, 0.0700, 0.0300, 0.0190, 0.0750, 0.0110)])
    put(B, gk.xf(ac, T(0, 0, zb)), 'dark')
    R6 = {}  # rel atas 20 MOA (datar di sini) + BUIS
    add_rail_and_buis(R6, B, zb + 0.026, -0.12, 0.20, base=-0.0108, mount=0.04)
    # ---- sasis zaitun: siluet samping, alur laras bebas, potongan peringan di forend
    ch = gk.plate([(-0.1000, 0.0460), (-0.1000, 0.0840), (0.1650, 0.0840), (0.1750, 0.0800), (0.5220, 0.0800), (0.5300, 0.0720), (0.5300, 0.0600),
                   (0.5220, 0.0540), (0.2000, 0.0540), (0.1850, 0.0460)], 0.0400, [0.002, 0.003, 0.003, 0.003, 0.003, 0.004, 0.004, 0.003, 0.004, 0.004],
                  0.0040, segs=3, tri=False)
    cs = [gk.xf(gk.cyl(0.0158, 0.4000, 28), T(0, 0.1600, zb) @ Rx(-90))]
    for i in range(4):
        y0 = 0.2150 + i * 0.0760
        cs.append(gk.xf(gk.slot_x(y0, y0 + 0.0520, 0.0, 0.0090, 0.0800), T(0, 0, 0.0652)))
    put(B, gk.cut(ch, cs), 'olive')
    for (y, z) in ((-0.0700, 0.0660), (0.1400, 0.0660)):
        for sx in (-1, 1):
            put(B, zturret(gk.screw('torx', 0.0062, 0.0014), (sx * 0.0200, y, z), '+x' if sx > 0 else '-x'), 'steel')
    put(B, gk.picatinny(0.0600, 0.4500, 0.0, -0.0075, 0.0150), 'dark', T(0, 0, 0.0478) @ Ry(180))    # rel bawah untuk bipod
    put(B, gk.plate([(0.0360, 0.0460), (0.0450, 0.0460), (0.0470, 0.0300), (0.0400, 0.0280)], 0.0100, 0.0015, 0.0012), 'dark')  # tuas magasin
    engrave(B, 'RAJAWALI', -0.0203, 0.0500, 0.0660, 0.0058)
    # ---- laras berat beralur 6 + rem moncong 3 port
    br = gk.lathe([(0.0, 0.1500), (0.0150, 0.1500), (0.0150, 0.2000), (0.0128, 0.2300), (0.0122, 0.8700), (0.0100, 0.8720), (0.0100, 0.8860), (0.0, 0.8860)], 24)
    fl = [gk.xf(gk.slot_z(0.2700, 0.8300, 0.0, 0.0044, 0.0060, 0.0143), Ry(30 + 60 * k)) for k in range(6)]
    put(B, gk.xf(gk.cut(br, fl), T(0, 0, zb)), 'dark')
    mb = gk.lathe([(0.0058, 0.8800), (0.0150, 0.8800), (0.0166, 0.8860), (0.0166, 0.9400), (0.0152, 0.9455), (0.0070, 0.9455), (0.0070, 0.8920),
                   (0.0058, 0.8900), (0.0058, 0.8800)], 24)
    cs = [gk.slot_x(0.8960 + i * 0.0150, 0.8960 + i * 0.0150 + 0.0090, 0.0, 0.0130, 0.0600, 0.0030) for i in range(3)]
    cs += [gk.xf(gk.cyl(0.0022, 0.0200, 12), T(0, 0.9005 + i * 0.0150, 0.0050)) for i in range(3)]
    put(B, gk.xf(gk.cut(mb, cs), T(0, 0, zb)), 'dark')
    put(B, ylathe([(0.0100, 0.8755), (0.0131, 0.8755), (0.0131, 0.8790), (0.0100, 0.8790), (0.0100, 0.8755)], 24, zb), 'gold')    # cincin identitas
    # ---- popor rangka berlubang (zaitun) + penyangga pipi + bantalan bersetelan
    # sisir popor TURUN ±50 mm di bawah garis bidik pisir besi (z = 0,132): dari mata (di atas sisir) hanya rel + aksi yang terlihat
    sk = gk.plate([(-0.0950, 0.0860), (-0.1500, 0.0840), (-0.2050, 0.0730), (-0.4180, 0.0690), (-0.4180, -0.0300), (-0.3920, -0.0360), (-0.3300, -0.0040),
                   (-0.2500, 0.0300), (-0.1700, 0.0460), (-0.0950, 0.0500)], 0.0380, [0.002, 0.012, 0.020, 0.006, 0.006, 0.008, 0.012, 0.012, 0.006, 0.002],
                  0.0050, segs=3, tri=False)
    sk = gk.cut(sk, [gk.ext_x(gk.fillet2d([(-0.2200, 0.0500), (-0.3860, 0.0470), (-0.3860, 0.0030), (-0.3360, 0.0190), (-0.2620, 0.0400)], 0.007, 5), 0.07)[0]])
    put(B, sk, 'olive')
    put(B, gk.plate([(-0.2380, 0.0705), (-0.2460, 0.0825), (-0.3640, 0.0805), (-0.3720, 0.0690)], 0.0340, [0.001, 0.006, 0.006, 0.001], 0.0100, segs=4), 'olive')  # penyangga pipi rendah
    put(B, zturret(gk.knurl(0.0072, 0.0060, 26, 0.0006), (0.0188, -0.3050, 0.0600), '+x'), 'dark')    # kenop penyangga pipi
    put(B, p_box(0.0360, 0.0080, 0.1040, 0.0020), 'dark', T(0, -0.4220, 0.0200))                      # pelat pangkal
    for zz in (0.0000, 0.0520):
        put(B, p_cyly(0.0034, 0.0120, 12), 'steel', T(0, -0.4310, zz))
    put(B, gk.plate([(-0.4360, -0.0340), (-0.4360, 0.0740), (-0.4500, 0.0700), (-0.4530, 0.0220), (-0.4500, -0.0300)], 0.0380, 0.003, 0.0040,
                    segs=2), 'rubber')                                                                # bantalan karet
    put(B, zturret(gk.knurl(0.0066, 0.0050, 24, 0.0006), (0.0188, -0.4000, 0.0340), '+x'), 'dark')    # kenop bantalan
    put(B, gk.xf(gk.knurl(0.0070, 0.0180, 24, 0.0006), T(0, -0.3600, -0.0420)), 'dark')               # monopod belakang
    # ---- bipod terlipat ke depan di bawah forend
    put(B, gk.plate([(0.4580, 0.0300), (0.5020, 0.0300), (0.5020, 0.0462), (0.4580, 0.0462)], 0.0300, 0.002, 0.0020), 'dark')
    for b in gk.rail_clamp(0.4600, 0.5000, 0.0260, 0.0020):
        put(B, b, 'dark', T(0, 0, 0.0478) @ Ry(180))
    put(B, p_cylx(0.0036, 0.0380, 12), 'steel', T(0, 0.4800, 0.0340))
    for sx in (-1, 1):
        x = sx * 0.0150
        put(B, p_tube((x, 0.4800, 0.0340), (x, 0.6300, 0.0370), 0.0056, 0.0056, 14), 'dark')
        put(B, p_tube((x, 0.6260, 0.0370), (x, 0.7300, 0.0390), 0.0043, 0.0043, 12), 'steel')
        put(B, gk.xf(gk.knurl(0.0066, 0.0100, 22, 0.0005), T(x, 0.6220, 0.0368) @ Rx(-90)), 'dark')   # kerah pengunci
        put(B, gk.xf(gk.lathe([(0.0, 0.7280), (0.0052, 0.7280), (0.0066, 0.7330), (0.0066, 0.7440), (0.0050, 0.7480), (0.0, 0.7480)], 14), T(x, 0, 0.0392)), 'rubber')
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.02, 'steel')
    # ---- bolt (node terpisah): badan baja di dalam aksi (terlihat di lubang lontar), selubung belakang, tuas berbonggol
    bo = (0, -0.02, zb)
    BO = bmesh.new()
    put(BO, p_cyly(0.0100, 0.1930, 18), 'steel', T(0, 0.0215, zb))
    for k in range(3):
        put(BO, p_cyly(0.0102, 0.0020, 18), 'dark', T(0, 0.0500 + k * 0.0200, zb))
    put(BO, ylathe([(0.0, -0.1200), (0.0080, -0.1200), (0.0124, -0.1140), (0.0128, -0.0800), (0.0105, -0.0760), (0.0, -0.0760)], 18, zb), 'dark')
    put(BO, zturret(gk.cyl(0.0030, 0.0006, 12), (0, -0.1200, zb), '-y'), 'red')                       # indikator kokang
    P0, P1, P2 = Vector((0.006, -0.025, zb)), Vector((0.030, -0.030, zb - 0.006)), Vector((0.043, -0.0355, zb - 0.019))
    put(BO, p_chain([P0, P1, P2], [0.0054, 0.0048, 0.0043], 10, False), 'steel')
    d = (P2 - P1).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    put(BO, gk.xf(gk.knurl(0.0078, 0.0150, 22, 0.0007), T(*(P2 - d * 0.0020)) @ q), 'dark')
    put(BO, p_sphere(0.0074, 12, 8), 'dark', T(*(P2 + d * 0.0130)))
    shift(BO, bo)
    # ---- magasin kotak 5 butir
    top = Vector((0, 0.075, 0.062))
    M = bmesh.new()
    merge(M, p_loft([superellipse(0, 0.075, z, 0.0125, 0.033, 0.032, 12, 3.6) for z in (0.0, 0.062)]), 'dark')
    for zz in (0.012, 0.026):
        put(M, p_box(0.0262, 0.0560, 0.0030, 0.0008), 'dark', T(0, 0.075, zz))
    put(M, gk.plate([(0.0390, -0.0080), (0.1110, -0.0080), (0.1130, -0.0030), (0.1110, 0.0020), (0.0390, 0.0020), (0.0370, -0.0030)], 0.0310, 0.0012, 0.0026,
                    segs=2), 'poly')
    shift(M, top)
    wear = [((0, 0.920, zb), 0.07), ((0.020, 0.050, 0.095), 0.08), ((0.050, -0.040, 0.065), 0.04), ((0, 0.075, 0.030), 0.05), ((0, 0.600, 0.036), 0.14),
            ((0, -0.440, 0.030), 0.08), ((0, 0.370, 0.055), 0.08)]
    return {**dict(body=B, mag=(M, top), parts=[('sniper_bolt', BO, bo)], muzzle=(0, 0.9455, zb), guard=(0, 0.37, 0.054 - 0.017), wear=wear, ironD=0.335), **R6}


def build_lmg():
    """Gempa (v6 M3): SMR berpengumpan kotak 75. Penerima baja pres berpaku keling, tutup pengumpan berengsel + rel, laras
    ganti-cepat dengan pelindung panas berlubang, tabung & blok gas + menara pejera, gagang angkut terlipat, bipod
    terlipat, popor rangka, kotak peluru zaitun (node mag) dengan sabuk naik ke pengumpan kiri."""
    B = bmesh.new()
    zb = 0.094
    hw = 0.0270
    rc = gk.prof_y([(-hw, 0.0520), (hw, 0.0520), (hw, 0.1180), (hw - 0.0045, 0.1280), (-(hw - 0.0045), 0.1280), (-hw, 0.1180)], -0.1280, 0.2050)
    pn = [(-0.1100, 0.0600), (-0.0200, 0.0600), (-0.0200, 0.1100), (-0.1100, 0.1100)]
    rc = gk.cut(rc, [gk.box(0.0090, 0.0560, 0.0170, hw, 0.0300, 0.0760),          # lubang lontar (kanan-bawah)
                     gk.box(0.0100, 0.0640, 0.0090, -hw, 0.0900, 0.1215),         # mulut pengumpan sabuk (kiri, di bawah tutup)
                     gk.box(0.0030, 0.1500, 0.0052, -hw, 0.1150, 0.1020),         # alur tuas kokang (kiri)
                     panel_cut(pn, -hw, 0.004), panel_cut(pn, hw, 0.004),
                     panel_cut([(0.0700, 0.0600), (0.1900, 0.0600), (0.1900, 0.1100), (0.0700, 0.1100)], hw, 0.004)])
    put(B, rc, 'dark')
    put(B, p_box(0.0010, 0.0540, 0.0150), 'steel', T(hw - 0.0042, 0.0300, 0.0760))               # bolt di lubang lontar
    for y in (-0.1180, -0.0650, -0.0100, 0.0620, 0.1300, 0.1960):
        for z in (0.0560, 0.1140):
            side_disc(B, y, z, hw, 0.0038, 'steel', 0.0008, 10)                                    # paku keling
    put(B, p_box(0.0560, 0.0040, 0.0700, 0.0040), 'dark', T(0, -0.1290, 0.0880))                   # pelat belakang
    # tutup pengumpan: engsel di depan, kait di belakang, rel di atasnya
    put(B, gk.plate([(-0.0880, 0.1280), (-0.0880, 0.1380), (-0.0720, 0.1432), (0.1120, 0.1432), (0.1260, 0.1370), (0.1260, 0.1280)], 0.0500,
                    [0.0, 0.003, 0.004, 0.004, 0.003, 0.0], 0.0030, segs=2), 'dark')
    put(B, p_cylx(0.0050, 0.0540, 12), 'steel', T(0, 0.1280, 0.1300))
    for sx in (-1, 1):
        put(B, p_box(0.0030, 0.0160, 0.0090, 0.0010), 'dark', T(sx * 0.0262, -0.0760, 0.1320))
    put(B, p_box(0.0120, 0.0600, 0.0030, 0.0010), 'steel', T(-hw - 0.0040, 0.0900, 0.1165))       # bibir baki pengumpan
    R6 = {}  # rel di tutup pengumpan + pisir lipat belakang (pejera depan di menara blok gas)
    add_rail_and_buis(R6, B, 0.152, -0.075, 0.115, front=False, base=-0.009, mount=0.02)
    put(B, p_box(0.0080, 0.0100, 0.0045, 0.0010), 'dark', T(-hw - 0.0030, 0.1700, 0.1020))        # tuas kokang kiri
    put(B, zturret(gk.knurl(0.0055, 0.0160, 20, 0.0005), (-hw - 0.0050, 0.1700, 0.1020), '-x'), 'dark')
    engrave(B, 'GEMPA', -(hw + 0.0002), 0.0200, 0.0600, 0.0065)
    put(B, p_box(0.0008, 0.0600, 0.0008), 'gold', T(hw, -0.0650, 0.0570), mirror=True)             # garis identitas
    # ---- laras ganti-cepat: soket, laras, pelindung panas berlubang, cincin identitas
    put(B, ylathe([(0.0140, 0.2000), (0.0250, 0.2000), (0.0250, 0.2140), (0.0140, 0.2140), (0.0140, 0.2000)], 28, zb), 'dark')
    put(B, p_box(0.0100, 0.0140, 0.0070, 0.0015), 'dark', T(-0.0150, 0.2060, zb + 0.0240) @ Ry(-30))   # kait laras
    put(B, ylathe([(0.0, 0.2000), (0.0135, 0.2000), (0.0135, 0.5200), (0.0120, 0.5250), (0.0120, 0.7350), (0.0105, 0.7380), (0.0105, 0.7480),
                   (0.0, 0.7480)], 22, zb), 'dark')
    hs = gk.lathe([(0.0200, 0.2140), (0.0222, 0.2140), (0.0222, 0.5000), (0.0200, 0.5000), (0.0200, 0.2140)], 28)
    cs = []
    for i in range(7):
        a = 0.2320 + i * 0.0370
        cs.append(gk.slot_x(a, a + 0.0220, 0.0, 0.0075, 0.0600))
        if i < 6:
            for ang in (-60, 60):
                cs.append(gk.xf(gk.slot_x(a + 0.0185, a + 0.0405, 0.0, 0.0075, 0.0600), Ry(ang)))
    put(B, gk.xf(gk.cut(hs, cs), T(0, 0, zb)), 'dark')
    put(B, ylathe([(0.0200, 0.5005), (0.0228, 0.5005), (0.0228, 0.5045), (0.0200, 0.5045), (0.0200, 0.5005)], 28, zb), 'gold')
    # tabung gas di bawah laras, blok gas + pengatur, menara pejera (puncak tiang = garis bidik z 0,168)
    put(B, p_cyly(0.0070, 0.3700, 14), 'dark', T(0, 0.3900, zb - 0.0300))
    put(B, gk.plate([(0.5550, zb - 0.0400), (0.5900, zb - 0.0400), (0.5900, zb + 0.0160), (0.5550, zb + 0.0160)], 0.0240, 0.003, 0.0030), 'dark')
    put(B, gk.xf(gk.knurl(0.0085, 0.0100, 20, 0.0006), T(0, 0.5900, zb - 0.0300) @ Rx(-90)), 'dark')
    put(B, gk.plate([(0.5600, zb + 0.0160), (0.5860, zb + 0.0160), (0.5780, 0.1600), (0.5680, 0.1600)], 0.0060, 0.0, 0.0010), 'dark')
    for sx in (-1, 1):
        put(B, gk.plate([(0.5630, 0.1500), (0.5830, 0.1500), (0.5810, 0.1745), (0.5650, 0.1745)], 0.0022, 0.002, 0.0005, x0=sx * 0.0065), 'dark')
    put(B, p_box(0.0110, 0.0200, 0.0030), 'dark', T(0, 0.5730, 0.1510))
    put(B, p_box(0.0016, 0.0020, 0.0100), 'dark', T(0, 0.5730, 0.1630))
    put(B, cage(0.7350, 0.0650, 0.0058, 0.0135, zb), 'dark')
    # gagang angkut terlipat ke kanan
    put(B, p_box(0.0120, 0.0160, 0.0120, 0.0020), 'dark', T(0.0170, 0.3000, zb + 0.0170) @ Ry(40))
    put(B, p_chain([(0.0180, 0.3000, zb + 0.0200), (0.0440, 0.3000, zb + 0.0060), (0.0440, 0.3950, zb + 0.0060)], [0.0042] * 3, 8, False), 'steel')
    put(B, p_tube((0.0440, 0.3180, zb + 0.0060), (0.0440, 0.3920, zb + 0.0060), 0.0085, 0.0085, 12), 'grip')
    # bipod terlipat ke depan di bawah blok gas
    put(B, gk.plate([(0.5800, zb - 0.0560), (0.6200, zb - 0.0560), (0.6200, zb - 0.0400), (0.5800, zb - 0.0400)], 0.0300, 0.002, 0.0020), 'dark')
    put(B, p_cylx(0.0036, 0.0380, 12), 'steel', T(0, 0.6000, zb - 0.0500))
    for sx in (-1, 1):
        x = sx * 0.0150
        put(B, p_tube((x, 0.6000, zb - 0.0500), (x, 0.7100, zb - 0.0470), 0.0056, 0.0056, 14), 'dark')
        put(B, p_tube((x, 0.7060, zb - 0.0470), (x, 0.7700, zb - 0.0450), 0.0043, 0.0043, 12), 'steel')
        put(B, gk.xf(gk.knurl(0.0066, 0.0100, 22, 0.0005), T(x, 0.7020, zb - 0.0472) @ Rx(-90)), 'dark')
        put(B, gk.xf(gk.lathe([(0.0, 0.7680), (0.0052, 0.7680), (0.0066, 0.7730), (0.0066, 0.7840), (0.0050, 0.7880), (0.0, 0.7880)], 14), T(x, 0, zb - 0.0448)), 'rubber')
    # pegangan depan (tangan kiri) berusuk
    hg = gk.loft_se([(0.2050, 0.0610, 0.0130, 0.0130, 0.0255, 4.0), (0.3400, 0.0610, 0.0130, 0.0130, 0.0255, 4.0)], 20)
    hg = gk.cut(hg, [gk.box(0.0030, 0.0035, 0.0160, sx * 0.0255, 0.2250 + i * 0.0190, 0.0610) for i in range(6) for sx in (-1, 1)])
    put(B, hg, 'poly')
    # ---- popor rangka + bantalan + sandaran bahu terlipat
    st = gk.plate([(-0.1280, 0.1100), (-0.3850, 0.1100), (-0.4000, 0.0980), (-0.4000, 0.0040), (-0.3850, -0.0080), (-0.3450, 0.0020), (-0.1280, 0.0600)],
                  0.0340, [0.003, 0.008, 0.004, 0.004, 0.008, 0.012, 0.003], 0.0045, segs=3, tri=False)
    st = gk.cut(st, [gk.ext_x(gk.fillet2d([(-0.1500, 0.0940), (-0.3740, 0.0940), (-0.3740, 0.0200), (-0.3450, 0.0200), (-0.1500, 0.0740)], 0.007, 4), 0.06)[0]])
    put(B, st, 'poly')
    put(B, p_box(0.0300, 0.0450, 0.0036, 0.0010), 'steel', T(0, -0.3760, 0.1125))
    put(B, p_cylx(0.0030, 0.0320, 10), 'steel', T(0, -0.3990, 0.1120))
    butt_pad(B, -0.4000, -0.0060, 0.1080, 0.0360, 0.0130)
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.02, 'steel')
    # ---- kotak peluru 75 butir (node mag): panel tekan + rusuk silang, tutup, kait, corong & sabuk ke pengumpan kiri
    top = Vector((0, 0.09, 0.05))
    M = bmesh.new()
    bx = gk.plate([(0.0300, -0.0610), (0.1500, -0.0610), (0.1500, 0.0420), (0.0300, 0.0420)], 0.0720, 0.006, 0.0040, segs=2, tri=False)
    bx = gk.cut(bx, [panel_cut([(0.0420, -0.0500), (0.1380, -0.0500), (0.1380, 0.0300), (0.0420, 0.0300)], sx * 0.0360, 0.006, 0.0024) for sx in (-1, 1)])
    put(M, bx, 'olive')
    for sx in (-1, 1):
        for a in (38, -38):
            put(M, p_box(0.0010, 0.1050, 0.0050, 0.0004), 'olive', T(sx * 0.0352, 0.0900, -0.0100) @ Rx(a))
    put(M, gk.plate([(0.0280, 0.0380), (0.1520, 0.0380), (0.1520, 0.0470), (0.0280, 0.0470)], 0.0750, 0.002, 0.0020), 'olive')
    put(M, p_box(0.0300, 0.0500, 0.0120, 0.0030), 'dark', T(0, 0.0900, 0.0540))
    put(M, p_box(0.0200, 0.0030, 0.0300, 0.0010), 'dark', T(0, 0.1525, 0.0300))
    put(M, p_box(0.0140, 0.0040, 0.0060, 0.0010), 'steel', T(0, 0.1535, 0.0450))
    for i in range(7):
        z = 0.0520 + i * 0.0105
        put(M, p_cyly(0.0042, 0.0440, 10), 'gold', T(-0.0318, 0.0920, z))
        put(M, p_cyly(0.0032, 0.0140, 10, r2=0.0012), 'gold', T(-0.0318, 0.1210, z))
        put(M, p_box(0.0030, 0.0140, 0.0098, 0.0005), 'dark', T(-0.0345, 0.0880, z))
    shift(M, top)
    wear = [((0, 0.790, zb), 0.07), ((0.027, 0.030, 0.076), 0.07), ((-0.027, 0.090, 0.120), 0.07), ((0, 0.020, 0.143), 0.10), ((-0.035, 0.170, 0.102), 0.04),
            ((0, 0.270, 0.050), 0.09), ((0, 0.690, 0.046), 0.10), ((0, -0.400, 0.050), 0.08), ((0, 0.090, -0.010), 0.10)]
    return {**dict(body=B, mag=(M, top), muzzle=(0, 0.80, zb), guard=(0, 0.265, 0.048 - 0.017), wear=wear, ironD=0.337), **R6}



def build_revolver():
    """Kobra (v6 M3): revolver aksi ganda 6 peluru, laras 4" berlug penuh. Rangka dengan jendela silinder (potongan nyata),
    perisai tolak-balik, rusuk berventilasi, pisir takik + pejera landai bersisipan merah, martil, kait silinder, baut
    pelat samping, gagang kayu bermedali; silinder (node revolver_cyl, asal di sumbunya): 6 kamar tembus, alur, takik
    pengunci, bintang ejektor + batang."""
    B = bmesh.new()
    zbo = 0.088  # sumbu laras = kamar atas silinder
    zc = 0.075   # sumbu silinder (orbit kamar 13 mm)
    hw = 0.0130
    fr = gk.plate([(-0.0200, 0.0480), (-0.0400, 0.0500), (-0.0460, 0.0660), (-0.0400, 0.0860), (-0.0300, 0.1000), (-0.0120, 0.1075), (0.0780, 0.1075),
                   (0.0780, 0.0560), (0.0620, 0.0480)], 2 * hw, [0.004, 0.006, 0.008, 0.006, 0.006, 0.004, 0.0, 0.004, 0.004], 0.0040, segs=3, tri=False)
    fr = gk.cut(fr, [gk.box(0.0600, 0.0450, 0.0450, 0.0, 0.0310, zc),                               # jendela silinder
                     gk.box(0.0040, 0.0900, 0.0030, 0.0, 0.0350, 0.1075)])                          # alur bidik di jembatan atas
    put(B, fr, 'metal')
    put(B, zturret(gk.cyl(0.0190, 0.0030, 28), (0, 0.0085, zc), '-y'), 'metal')                     # perisai tolak-balik
    put(B, gk.prof_y([(-0.0070, 0.1070), (0.0070, 0.1070), (0.0070, 0.1122), (0.0018, 0.1122), (0.0018, 0.1095), (-0.0018, 0.1095), (-0.0018, 0.1122),
                      (-0.0070, 0.1122)], -0.0240, -0.0120), 'dark')                                # pisir takik-U
    put(B, gk.plate([(-0.0220, 0.1000), (-0.0340, 0.1040), (-0.0500, 0.1000), (-0.0600, 0.1050), (-0.0640, 0.1010), (-0.0520, 0.0920), (-0.0400, 0.0840),
                     (-0.0260, 0.0880)], 0.0080, 0.002, 0.0014), 'dark')                           # martil (posisi turun, di bawah garis bidik)
    for i in range(4):
        put(B, p_box(0.0074, 0.0010, 0.0008), 'dark', T(0, -0.0540 - i * 0.0020, 0.1030 + i * 0.0010))
    put(B, gk.plate([(-0.0300, 0.0780), (-0.0120, 0.0780), (-0.0100, 0.0880), (-0.0280, 0.0900)], 0.0035, 0.002, 0.0010, x0=-(hw + 0.0012)), 'dark')   # kait silinder
    for i in range(3):
        put(B, p_box(0.0008, 0.0010, 0.0080), 'dark', T(-(hw + 0.0030), -0.0250 + i * 0.0040, 0.0835))
    for (y, z) in ((-0.0340, 0.0660), (-0.0140, 0.0960), (0.0660, 0.0600)):
        put(B, zturret(gk.screw('slot', 0.0044, 0.0010), (hw + 0.0002, y, z), '+x'), 'steel')       # baut pelat samping
    put(B, gk.plate([(0.0535, 0.0500), (0.0760, 0.0500), (0.0760, 0.0640), (0.0535, 0.0640)], 0.0040, 0.002, 0.0010, x0=-(hw - 0.0010)), 'dark')       # lengan engsel silinder
    # ---- laras + lug penuh + rusuk berventilasi + pejera
    put(B, ylathe([(0.0, 0.0780), (0.0098, 0.0780), (0.0098, 0.2300), (0.0090, 0.2355), (0.0058, 0.2355), (0.0058, 0.2150), (0.0, 0.2150)], 22, zbo), 'metal')
    put(B, gk.prof_y(gk.rrect(0.0088, 0.0125, 0.0060, 4, 0.0, 0.0705), 0.0780, 0.2300), 'metal')
    put(B, p_cyly(0.0030, 0.0040, 12), 'steel', T(0, 0.2310, 0.0705))                               # ujung batang ejektor
    rb = gk.plate([(0.0760, 0.0975), (0.2300, 0.0975), (0.2300, 0.1035), (0.0760, 0.1065)], 0.0085, 0.0, 0.0008, tri=False)
    rb = gk.cut(rb, [gk.slot_x(0.0900 + i * 0.0330, 0.0900 + i * 0.0330 + 0.0220, 0.1003, 0.0026, 0.0200) for i in range(4)])
    put(B, rb, 'metal')
    put(B, gk.plate([(0.2050, 0.1035), (0.2300, 0.1035), (0.2290, 0.1112), (0.2200, 0.1112)], 0.0030, 0.0, 0.0004), 'dark')
    put(B, p_box(0.0031, 0.0040, 0.0030), 'red', T(0, 0.2225, 0.1096))
    put(B, ylathe([(0.0098, 0.2240), (0.0103, 0.2240), (0.0103, 0.2270), (0.0098, 0.2270), (0.0098, 0.2240)], 22, zbo), 'gold')   # cincin identitas
    engrave(B, 'KOBRA', -0.0090, 0.1500, 0.0700, 0.0058)
    # ---- gagang kayu + medali + pelat alas
    put(B, grip_bm(), 'wood')
    side_disc(B, yc(0.0100) - 0.0010, 0.0100, 0.0162, 0.0085, 'gold', 0.0006, 18)
    put(B, p_box(0.0200, 0.0300, 0.0040, 0.0015), 'metal', T(0, yc(-0.0620) + 0.0010, -0.0630))
    tg = gk.plate([(0.0200, 0.0500), (0.0760, 0.0500), (0.0780, 0.0320), (0.0680, 0.0160), (0.0360, 0.0160), (0.0245, 0.0240)], 0.0110,
                  [0.0, 0.0, 0.008, 0.010, 0.009, 0.004], 0.0028, segs=3, tri=False)
    tg = gk.cut(tg, [gk.ext_x(gk.fillet2d([(0.0300, 0.0195), (0.0735, 0.0195), (0.0730, 0.0470), (0.0280, 0.0470)], [0.007, 0.009, 0.004, 0.004], 5), 0.03)[0]])
    put(B, tg, 'metal')
    put(B, p_chain([(0, 0.053, 0.054), (0, 0.050, 0.044), (0, 0.044, 0.036)], [0.0032, 0.0028, 0.0024], 6), 'steel')
    # ---- silinder 6 kamar (node terpisah, asal di sumbunya)
    co = (0, 0.031, zc)
    C = bmesh.new()
    cy = gk.lathe([(0.0, 0.0090), (0.0180, 0.0090), (0.0195, 0.0105), (0.0195, 0.0515), (0.0180, 0.0530), (0.0, 0.0530)], 36)
    cs = []
    for k in range(6):
        a = (90 + 60 * k) * D2R
        cs.append(gk.xf(gk.cyl(0.0048, 0.0600, 14), T(0.0130 * math.cos(a), 0.0, 0.0130 * math.sin(a)) @ Rx(-90)))     # kamar tembus
        f = a + 30 * D2R
        cs.append(gk.xf(gk.cyl(0.0062, 0.0400, 14), T(0.0228 * math.cos(f), 0.0300, 0.0228 * math.sin(f)) @ Rx(-90)))  # alur depan
        cs.append(gk.xf(gk.box(0.0040, 0.0050, 0.0030, 0.0, 0.0150, 0.0195), Ry(60 * k + 12)))                         # takik pengunci
    put(C, gk.xf(gk.cut(cy, cs), T(0, 0, zc)), 'metal')
    for k in range(6):
        a = (90 + 60 * k) * D2R
        put(C, zturret(gk.cyl(0.0056, 0.0010, 14), (0.0130 * math.cos(a), 0.0090, zc + 0.0130 * math.sin(a)), '-y'), 'gold')   # pangkal selongsong
    put(C, zturret(gk.cyl(0.0050, 0.0014, 12), (0, 0.0090, zc), '-y'), 'steel')                     # bintang ejektor
    put(C, p_cyly(0.0030, 0.0200, 12), 'steel', T(0, 0.0630, zc))                                   # batang ejektor
    shift(C, co)
    wear = [((0, 0.232, zbo), 0.05), ((0, 0.031, zc), 0.07), ((0, -0.060, 0.105), 0.04), ((0, 0.050, 0.030), 0.05), ((0, -0.020, -0.062), 0.05),
            ((0, 0.150, 0.100), 0.06)]
    return dict(body=B, parts=[('revolver_cyl', C, co)], muzzle=(0, 0.2355, zbo), sight=(0, -0.018, 0.111), guard=(-0.026, 0.008, -0.034), wear=wear)



def build_burst():
    """Petir (v6 M3): karabin semburan bercangkang polimer monokok bersudut. Cangkang atas + pelindung tangan satu siluet
    berfaset (bevel bentuk), rel menyatu + BUIS rebah (optik holografik bawaan), jendela pendingin miring (laras terlihat),
    lubang lontar, popor rangka lipat, magasin lurus berjendela (opak), peredam kilat tiga celah."""
    B = bmesh.new()
    zb = 0.088
    hw = 0.0245
    sh = gk.plate([(-0.1050, 0.0600), (-0.1050, 0.1120), (-0.0900, 0.1235), (0.2050, 0.1235), (0.2400, 0.1180), (0.4500, 0.1130), (0.4680, 0.0980),
                   (0.4680, 0.0740), (0.4500, 0.0590), (0.2300, 0.0570), (0.1700, 0.0600)], 2 * hw, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                  0.0058, segs=2, tri=False)
    cs = [gk.box(0.0100, 0.0600, 0.0150, hw, 0.0500, 0.0960)]                                      # lubang lontar (kanan)
    for i in range(4):   # jendela pendingin miring, tembus kiri-kanan
        y0 = 0.2550 + i * 0.0500
        cs.append(gk.ext_x([(y0, 0.0760), (y0 + 0.0260, 0.0760), (y0 + 0.0400, 0.1000), (y0 + 0.0140, 0.1000)], 0.0800)[0])
    for sx in (-1, 1):   # panel cekung bersudut di sisi cangkang
        cs.append(panel_cut([(-0.0900, 0.0700), (-0.0100, 0.0700), (0.0100, 0.0880), (0.0100, 0.1120), (-0.0760, 0.1120), (-0.0900, 0.1000)], sx * hw, 0.0, 0.0018))
        cs.append(panel_cut([(0.1000, 0.0700), (0.2200, 0.0700), (0.2340, 0.0860), (0.2200, 0.1120), (0.1000, 0.1120)], sx * hw, 0.0, 0.0018))
    cs.append(gk.xf(gk.cyl(0.0125, 0.0400, 20), T(0, 0.4400, zb) @ Rx(-90)))                        # mulut cangkang di sekitar laras
    put(B, gk.cut(sh, cs), 'poly')
    put(B, p_box(0.0010, 0.0580, 0.0130), 'steel', T(hw - 0.0046, 0.0500, 0.0960))                 # pembawa bolt
    for i in range(3):
        put(B, p_box(0.0012, 0.0016, 0.0130), 'dark', T(hw - 0.0044, 0.0360 + i * 0.0050, 0.0960))
    put(B, gk.plate([(0.0000, 0.0900), (0.0180, 0.0900), (0.0180, 0.1040), (0.0080, 0.1040)], 0.0070, 0.002, 0.0022, x0=hw + 0.0002), 'poly')    # pemantul selongsong
    for sx in (-1, 1):   # garis identitas zig-zag (petir) tipis
        for k, (ya, za, yb_, zb_) in enumerate(((0.0300, 0.0660, 0.0700, 0.0660), (0.0700, 0.0660, 0.0800, 0.0720), (0.0800, 0.0720, 0.1150, 0.0720))):
            L = math.hypot(yb_ - ya, zb_ - za)
            put(B, p_box(0.0008, L, 0.0009), 'gold', T(sx * hw, (ya + yb_) / 2, (za + zb_) / 2) @ Rx(math.degrees(math.atan2(zb_ - za, yb_ - ya))))
    engrave(B, 'PETIR', -(hw + 0.0002), 0.0300, 0.0940, 0.0065)
    R6 = {}  # rel menyatu + BUIS rebah (selalu membawa optik: holografik bawaan)
    add_rail_and_buis(R6, B, 0.132, -0.09, 0.17, merged=True, base=-0.009, mount=0.03)
    put(B, gk.picatinny(0.2000, 0.2300, 0.1235, -0.0120), 'poly')                                  # rel depan rendah (menyatu dengan cangkang)
    # ---- rangka bawah + liang magasin
    put(B, gk.plate([(-0.0950, 0.0620), (-0.0950, 0.0460), (-0.0800, 0.0360), (-0.0400, 0.0360), (-0.0300, 0.0460), (0.0580, 0.0460), (0.0580, 0.0620)],
                    0.0400, [0.0, 0.004, 0.004, 0.003, 0.003, 0.0, 0.0], 0.0028, segs=2), 'dark')
    put(B, gk.plate([(0.0560, 0.0040), (0.1340, 0.0100), (0.1370, 0.0160), (0.1370, 0.0620), (0.0560, 0.0620)], 0.0420, [0.002, 0.003, 0.002, 0.0, 0.0],
                    0.0032, segs=2), 'dark')
    put(B, gk.plate([(0.0535, 0.0000), (0.1375, 0.0065), (0.1385, 0.0135), (0.0540, 0.0075)], 0.0460, 0.0015, 0.0022, segs=2), 'dark')
    side_disc(B, -0.0700, 0.0540, 0.0200, 0.0080)
    side_disc(B, 0.1250, 0.0520, 0.0210, 0.0080)
    side_disc(B, -0.0320, 0.0530, 0.0200, 0.0110, 'dark', 0.0016, 20)                               # poros pemilih
    put(B, gk.plate([(-0.0340, 0.0510), (-0.0120, 0.0550), (-0.0125, 0.0585), (-0.0350, 0.0555)], 0.0030, 0.001, 0.0008, x0=-0.0227), 'dark')
    put(B, p_box(0.0030, 0.0110, 0.0130, 0.0010), 'dark', T(0.0227, 0.0480, 0.0500))                # tombol magasin
    put(B, gk.plate([(0.0540, 0.0640), (0.0740, 0.0640), (0.0740, 0.0840), (0.0640, 0.0860), (0.0540, 0.0800)], 0.0030, 0.002, 0.0008,
                    x0=-(hw + 0.0012)), 'dark')                                                    # penahan bolt (kiri): titik tepuk kokang
    put(B, p_box(0.0420, 0.0100, 0.0070, 0.0020), 'dark', T(0, -0.1080, 0.1170))                   # tuas kokang T belakang
    # ---- laras + peredam kilat tiga celah
    put(B, ylathe([(0.0, 0.1500), (0.0090, 0.1500), (0.0090, 0.4700), (0.0080, 0.4740), (0.0080, 0.5560), (0.0, 0.5560)], 20, zb), 'dark')
    put(B, cage(0.5480, 0.0605, 0.0050, 0.0125, zb, (0, 120, -120), 0.0050, 6), 'dark')
    put(B, ylathe([(0.0080, 0.5400), (0.0104, 0.5400), (0.0104, 0.5440), (0.0080, 0.5440), (0.0080, 0.5400)], 20, zb), 'gold')
    # ---- popor rangka lipat (engsel di belakang cangkang)
    put(B, p_box(0.0300, 0.0140, 0.0460, 0.0030), 'dark', T(0, -0.1110, 0.0880))
    put(B, p_cyl(0.0050, 0.0050, 0.0520, 12), 'steel', T(0.0120, -0.1150, 0.0880))
    st = gk.plate([(-0.1180, 0.1120), (-0.3300, 0.1080), (-0.3500, 0.0950), (-0.3500, 0.0220), (-0.3300, 0.0140), (-0.2900, 0.0380), (-0.1180, 0.0660)],
                  0.0300, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 0.0050, segs=2, tri=False)
    st = gk.cut(st, [gk.ext_x([(-0.1400, 0.0960), (-0.3220, 0.0930), (-0.3360, 0.0840), (-0.3360, 0.0420), (-0.2900, 0.0560), (-0.1400, 0.0800)], 0.06)[0]])
    put(B, st, 'poly')
    butt_pad(B, -0.3500, 0.0160, 0.1060, 0.0320, 0.0120)
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.025, 'steel')
    # ---- magasin lurus condong berjendela (opak)
    top = Vector((0, 0.097, 0.060))
    M = bmesh.new()
    box_mag(M, [(0.0660, 0.0600), (0.1280, 0.0600), (0.1480, -0.1100), (0.0860, -0.1100)], 0.0240, 'poly', 'poly', (0.86,))
    for sx in (-1, 1):
        put(M, gk.plate([(0.0990, 0.0050), (0.1150, 0.0050), (0.1270, -0.0800), (0.1110, -0.0800)], 0.0010, 0.003, 0.0003, x0=sx * 0.0121), 'rubber')   # jendela (opak)
        for k in range(4):
            put(M, p_box(0.0006, 0.0130, 0.0012), 'gold', T(sx * 0.0126, 0.1090 + k * 0.0027, -0.0100 - k * 0.0190))    # penunjuk isi
    shift(M, top)
    wear = [((0, 0.600, zb), 0.06), ((0.024, 0.050, 0.096), 0.06), ((0, 0.097, 0.010), 0.06), ((0, -0.108, 0.117), 0.04), ((0, 0.310, 0.057), 0.09),
            ((0, 0.455, 0.090), 0.05), ((0, -0.350, 0.060), 0.07)]
    return {**dict(body=B, mag=(M, top), muzzle=(0, 0.6085, zb), guard=(0, 0.31, 0.057 - 0.017), wear=wear), **R6}



def build_pdw():
    """Lebah (v6 M3): PDW ringkas bercangkang polimer, popor dua batang tarik. Rel atas + BUIS, lubang lontar, tuas kokang
    kiri atas, pelindung tangan pendek + penahan tangan depan, peredam kilat kecil tiga celah; aksen kuning hanya di alas
    magasin, pemilih tembak, dan garis tipis."""
    B = bmesh.new()
    zb = 0.09
    hw = 0.0220
    bd = gk.plate([(-0.0720, 0.0580), (-0.0720, 0.1080), (-0.0620, 0.1190), (0.1500, 0.1190), (0.1660, 0.1090), (0.1700, 0.0720), (0.1600, 0.0580)],
                  2 * hw, [0.0, 0.004, 0.004, 0.006, 0.006, 0.004, 0.0], 0.0052, segs=3, tri=False)
    cs = [gk.box(0.0100, 0.0480, 0.0140, hw, 0.0400, 0.0970),                                       # lubang lontar (kanan)
          gk.box(0.0050, 0.0800, 0.0050, -hw, 0.0950, 0.1080)]                                      # alur tuas kokang (kiri atas)
    for sx in (-1, 1):
        cs.append(panel_cut([(-0.0600, 0.0660), (-0.0100, 0.0660), (0.0000, 0.0760), (0.0000, 0.1040), (-0.0600, 0.1040)], sx * hw, 0.003, 0.0018))
        cs.append(panel_cut([(0.0780, 0.0660), (0.1560, 0.0660), (0.1560, 0.0900), (0.0780, 0.0900)], sx * hw, 0.003, 0.0018))
    put(B, gk.cut(bd, cs), 'dark')
    put(B, p_box(0.0010, 0.0460, 0.0120), 'steel', T(hw - 0.0046, 0.0400, 0.0970))
    put(B, p_box(0.0060, 0.0090, 0.0045, 0.0010), 'dark', T(-hw - 0.0010, 0.1200, 0.1080))         # tuas kokang
    put(B, zturret(gk.knurl(0.0046, 0.0120, 20, 0.0005), (-hw - 0.0030, 0.1200, 0.1080), '-x'), 'steel')
    for sx in (-1, 1):
        put(B, p_box(0.0008, 0.0700, 0.0010), 'yellow', T(sx * (hw - 0.0005), 0.1170, 0.0700))     # garis identitas kuning
    R6 = {}
    add_rail_and_buis(R6, B, 0.1275, -0.06, 0.14, base=-0.0090, mount=0.03)
    engrave(B, 'LEBAH', -(hw + 0.0002), 0.0150, 0.0900, 0.0058)
    # ---- rangka bawah + liang magasin + pemilih kuning
    put(B, gk.plate([(-0.0640, 0.0600), (-0.0640, 0.0460), (-0.0520, 0.0400), (0.1300, 0.0400), (0.1300, 0.0600)], 0.0380, [0.0, 0.004, 0.003, 0.0, 0.0],
                    0.0030, segs=2), 'poly')
    put(B, gk.plate([(0.0720, 0.0160), (0.1270, 0.0200), (0.1295, 0.0260), (0.1295, 0.0600), (0.0720, 0.0600)], 0.0350, [0.002, 0.003, 0.002, 0.0, 0.0],
                    0.0030, segs=2), 'poly')
    put(B, gk.plate([(0.0700, 0.0120), (0.1300, 0.0165), (0.1310, 0.0235), (0.0705, 0.0190)], 0.0390, 0.0015, 0.0022, segs=2), 'poly')
    side_disc(B, -0.0300, 0.0520, 0.0190, 0.0100, 'dark', 0.0016, 20)
    put(B, gk.plate([(-0.0320, 0.0500), (-0.0110, 0.0540), (-0.0115, 0.0572), (-0.0330, 0.0542)], 0.0030, 0.001, 0.0008, x0=-0.0216), 'yellow')   # tuas pemilih
    for (y, z) in ((-0.0560, 0.0520), (0.0200, 0.0480), (0.1200, 0.0500)):
        side_disc(B, y, z, 0.0190, 0.0046, 'steel', 0.0008, 12)
    put(B, gk.plate([(0.0560, 0.0280), (0.0720, 0.0280), (0.0720, 0.0390), (0.0600, 0.0390)], 0.0100, 0.002, 0.0014), 'dark')                      # tuas magasin
    # ---- pelindung tangan pendek berslot + penahan tangan depan, laras, peredam kilat kecil
    HX = HT = HB = 0.0190
    put(B, slotted_hg(0.1650, 0.2450, zb, HX, HT, HB, 4.0, 2, 0.0220, diag=0, lead=0.0120), 'poly')
    put(B, gk.plate([(0.2240, zb - HB + 0.0010), (0.2450, zb - HB + 0.0010), (0.2450, 0.0500), (0.2380, 0.0440), (0.2300, 0.0460)], 0.0200,
                    [0.0, 0.0, 0.003, 0.004, 0.004], 0.0030, segs=2), 'poly')                      # penahan tangan depan
    put(B, ylathe([(0.0, 0.1600), (0.0075, 0.1600), (0.0075, 0.3000), (0.0, 0.3000)], 18, zb), 'dark')
    put(B, ylathe([(0.0075, 0.2450), (0.0110, 0.2450), (0.0110, 0.2520), (0.0075, 0.2520), (0.0075, 0.2450)], 20, zb), 'dark')
    put(B, cage(0.2900, 0.0505, 0.0048, 0.0112, zb, (0, 120, -120), 0.0046, 20), 'dark')
    # ---- popor dua batang tarik (kiri-kanan badan) + pelat bahu
    for sx in (-1, 1):
        x = sx * 0.0175
        put(B, p_box(0.0090, 0.0500, 0.0110, 0.0020), 'dark', T(sx * 0.0215, -0.0450, 0.0960))     # rumah pemandu
        put(B, p_tube((x, -0.0200, 0.0960), (x, -0.2500, 0.0960), 0.0036, 0.0036, 12), 'steel')
    put(B, gk.plate([(-0.2480, 0.0380), (-0.2480, 0.1040), (-0.2600, 0.1040), (-0.2600, 0.0380)], 0.0460, 0.003, 0.0030, segs=2), 'dark')
    butt_pad(B, -0.2600, 0.0360, 0.1060, 0.0470, 0.0090)
    put(B, grip_bm(), 'grip')
    trigger_group(B, 0.0, 'steel')
    # ---- magasin lurus, alas kuning
    top = Vector((0, 0.1, 0.056))
    M = bmesh.new()
    box_mag(M, [(0.0840, 0.0560), (0.1160, 0.0560), (0.1283, -0.1200), (0.0963, -0.1200)], 0.0230, 'dark', 'yellow', (), 0.0026)
    for sx in (-1, 1):
        put(M, gk.plate([(0.0990, 0.0100), (0.1030, 0.0100), (0.1140, -0.1100), (0.1100, -0.1100)], 0.0012, 0.0, 0.0003, x0=sx * 0.0116), 'dark')
    shift(M, top)
    wear = [((0, 0.335, zb), 0.05), ((0.022, 0.040, 0.097), 0.06), ((0, 0.100, 0.020), 0.06), ((-0.025, 0.120, 0.108), 0.04), ((0, 0.200, 0.070), 0.07),
            ((0, -0.260, 0.070), 0.06)]
    return {**dict(body=B, mag=(M, top), muzzle=(0, 0.3405, zb), guard=(0, 0.2, zb - HB - 0.017), wear=wear, ironD=0.272), **R6}



def build_dbs():
    """Gada (v6 M3): shotgun laras ganda patah-buka, laras pendek. Rangka aksi baja dengan pelat kunci samping, tuas atas,
    pengaman, dua pelatuk, pin engsel; popor kayu bersisir turun; node dbs_brk (asal di engsel) = dua laras bermahkota
    berongga + rusuk atas/bawah + manik + blok kait + forend kayu dengan besi forend."""
    B = bmesh.new()
    zb = 0.092
    hw = 0.0215
    ac = gk.plate([(-0.0420, 0.0520), (-0.0460, 0.0860), (-0.0340, 0.1030), (-0.0100, 0.1070), (0.0600, 0.1070), (0.0600, 0.0665), (0.1120, 0.0665),
                   (0.1180, 0.0600), (0.1120, 0.0520)], 2 * hw, [0.003, 0.008, 0.008, 0.004, 0.0, 0.0, 0.002, 0.003, 0.003], 0.0050, segs=3, tri=False)
    ac = gk.cut(ac, [panel_cut([(-0.0340, 0.0600), (0.0520, 0.0600), (0.0520, 0.0980), (-0.0280, 0.0980)], sx * hw, 0.006, 0.0016) for sx in (-1, 1)])
    put(B, ac, 'metal')
    for sx in (-1, 1):   # pelat kunci samping + baut
        put(B, gk.plate([(-0.0270, 0.0640), (0.0420, 0.0640), (0.0460, 0.0800), (0.0360, 0.0940), (-0.0230, 0.0940)], 0.0012, 0.005, 0.0004,
                        x0=sx * (hw - 0.0004)), 'dark')
        for (y, z) in ((-0.0180, 0.0700), (0.0360, 0.0720), (0.0100, 0.0890)):
            put(B, zturret(gk.screw('slot', 0.0046, 0.0010), (sx * (hw + 0.0003), y, z), '+x' if sx > 0 else '-x'), 'steel')
        put(B, p_box(0.0006, 0.0500, 0.0007), 'gold', T(sx * (hw + 0.0002), 0.0080, 0.0790))       # garis ukir identitas
    side_disc(B, 0.1000, 0.0600, hw - 0.0030, 0.0120, 'steel', 0.0010, 20)                          # pin engsel
    put(B, zturret(gk.cyl(0.0060, 0.0026, 18), (0, -0.0040, 0.1066), '+z'), 'dark')                 # poros tuas atas
    put(B, p_box(0.0070, 0.0340, 0.0034, 0.0012), 'dark', T(0.0030, -0.0200, 0.1078) @ Rz(-9))     # tuas atas
    put(B, p_box(0.0100, 0.0100, 0.0040, 0.0015), 'dark', T(0.0060, -0.0370, 0.1050) @ Rz(-9))
    put(B, p_box(0.0060, 0.0100, 0.0026, 0.0008), 'steel', T(0, -0.0440, 0.0900) @ Rx(-48))        # pengaman di ekor rangka
    engrave(B, 'GADA', -(hw + 0.0004), 0.0020, 0.0850, 0.0050)
    # ---- popor kayu: sisir turun (mata di atas sisir), pelat pangkal
    put(B, gk.loft_se([(-0.0400, 0.0780, 0.0240, 0.0280, 0.0205, 2.8), (-0.1000, 0.0640, 0.0220, 0.0360, 0.0200, 2.6), (-0.2200, 0.0440, 0.0260, 0.0580, 0.0195, 2.5),
                       (-0.3600, 0.0300, 0.0300, 0.0720, 0.0200, 2.6)], 20), 'wood')
    butt_pad(B, -0.3600, -0.0420, 0.0600, 0.0400, 0.0100)
    put(B, grip_bm(), 'wood')
    trigger_group(B, 0.0, 'steel')
    put(B, p_chain([(0.0045, 0.0400, 0.0540), (0.0045, 0.0370, 0.0440), (0.0045, 0.0310, 0.0370)], [0.0030, 0.0026, 0.0022], 6), 'steel')   # pelatuk kedua
    # ---- laras ganda + rusuk + manik + blok kait + forend kayu (node patah-buka, asal di engsel)
    ho = (0, 0.058, 0.06)
    BR = bmesh.new()
    for sx in (-1, 1):
        put(BR, gk.xf(gk.lathe([(0.0, 0.0600), (0.0128, 0.0600), (0.0128, 0.6120), (0.0122, 0.6205), (0.0096, 0.6205), (0.0096, 0.5900), (0.0, 0.5900)], 20),
                      T(sx * 0.0128, 0, zb)), 'dark')
        put(BR, zturret(gk.cyl(0.0098, 0.0004, 16), (sx * 0.0128, 0.0598, zb), '-y'), 'rubber')    # mulut kamar (gelap)
        put(BR, ylathe([(0.0128, 0.0600), (0.0136, 0.0600), (0.0136, 0.0640), (0.0128, 0.0640), (0.0128, 0.0600)], 20, zb), 'steel', T(sx * 0.0128, 0, 0))
    put(BR, gk.plate([(0.0620, 0.0960), (0.6180, 0.0960), (0.6180, 0.1085), (0.0620, 0.1090)], 0.0070, 0.0, 0.0006), 'dark')      # rusuk atas
    put(BR, gk.plate([(0.1200, 0.0760), (0.6100, 0.0760), (0.6100, 0.0880), (0.1200, 0.0880)], 0.0060, 0.0, 0.0006), 'dark')      # rusuk bawah
    put(BR, p_sphere(0.0022, 10, 6), 'gold', T(0, 0.6100, 0.1108))
    put(BR, p_box(0.0240, 0.0560, 0.0150, 0.0020), 'metal', T(0, 0.0880, 0.0735))                  # blok kait (monoblok)
    put(BR, gk.loft_se([(0.1180, zb - 0.0220, 0.0120, 0.0220, 0.0230, 2.6), (0.1600, zb - 0.0240, 0.0140, 0.0260, 0.0255, 2.6),
                        (0.3000, zb - 0.0240, 0.0140, 0.0260, 0.0255, 2.6), (0.3350, zb - 0.0200, 0.0120, 0.0180, 0.0220, 2.6)], 20), 'wood')
    put(BR, p_box(0.0300, 0.0120, 0.0220, 0.0030), 'metal', T(0, 0.1180, 0.0700))                  # besi forend
    put(BR, p_box(0.0080, 0.0260, 0.0030, 0.0010), 'steel', T(0, 0.2300, 0.0420))                  # kait forend
    for y in (0.3500, 0.5800):
        put(BR, gk.prof_y(gk.rrect(0.0262, 0.0136, 0.0128, 5, 0.0, zb), y, y + 0.0040), 'dark')    # pita pengikat laras
    shift(BR, ho)
    wear = [((0, 0.615, zb), 0.06), ((0, 0.060, 0.092), 0.06), ((0, -0.020, 0.108), 0.05), ((0.020, 0.010, 0.080), 0.07), ((0, 0.230, 0.045), 0.10),
            ((0, -0.360, 0.010), 0.08), ((0, 0.100, 0.060), 0.05)]
    return dict(body=B, parts=[('dbs_brk', BR, ho)], muzzle=(0, 0.6205, zb), sight=(0, -0.02, 0.1118), guard=(0, 0.23, 0.042 - 0.017), wear=wear, ironD=0.34)



def build_frag():
    """Granat: badan telur zaitun beralur, kepala sumbu, tuas & cincin emas. Origin = pusat badan (digenggam)."""
    B = bmesh.new()
    prof = [(0.0, -0.05), (0.014, -0.049), (0.025, -0.042), (0.031, -0.028), (0.0325, -0.008), (0.031, 0.012), (0.026, 0.028), (0.018, 0.039),
            (0.012, 0.043), (0.0, 0.043)]
    body = p_lathe_y(prof, 20, 0.0)
    bmesh.ops.transform(body, matrix=Rx(90), verts=body.verts)
    put(B, body, 'olive')
    for z in (-0.02, 0.0, 0.02):
        r = 0.0325 - abs(z) * 0.08
        put(B, p_torus(r, 0.0016, 24, 4, 'Z'), 'dark', T(0, 0, z))
    put(B, p_cyl(0.011, 0.011, 0.016, 14), 'metal', T(0, 0, 0.05))
    put(B, p_cyl(0.007, 0.007, 0.01, 10), 'dark', T(0, 0, 0.062))
    put(B, p_chain([(0.006, 0.0, 0.058), (0.02, 0.0, 0.052), (0.031, 0.0, 0.03), (0.034, 0.0, 0.0)], [0.0026] * 4, 6, False), 'gold')
    put(B, p_torus(0.011, 0.0018, 18, 5, 'Y'), 'gold', T(-0.016, 0, 0.06))
    return dict(body=B)


def build_smoke():
    """Asap: tabung kaleng abu-putih, pita hijau, lubang semburan, sumbu & cincin. Origin = pusat badan."""
    B = bmesh.new()
    put(B, p_cyl(0.029, 0.029, 0.11, 22), 'canister', T(0, 0, 0))
    put(B, p_cyl(0.0295, 0.0295, 0.018, 22), 'olive', T(0, 0, 0.02))
    for k in range(6):
        a = k * pi / 3
        put(B, p_cyl(0.0035, 0.0035, 0.004, 8), 'dark', T(0.02 * math.cos(a), 0.02 * math.sin(a), 0.056))
    put(B, p_cyl(0.011, 0.011, 0.016, 14), 'metal', T(0, 0, 0.063))
    put(B, p_chain([(0.006, 0.0, 0.07), (0.02, 0.0, 0.064), (0.028, 0.0, 0.045), (0.03, 0.0, 0.0)], [0.0026] * 4, 6, False), 'gold')
    put(B, p_torus(0.011, 0.0018, 18, 5, 'Y'), 'gold', T(-0.016, 0, 0.072))
    return dict(body=B)


NADES = {'frag': build_frag, 'smoke': build_smoke}


# ================================================================ v6: optik terpasang + pisir lipat (BUIS)
# Optik = node sendiri (opt_<id>), asal = titik pasang di puncak rel (tengah), sumbu optik setinggi OPT_H di atasnya.
# Empty opt_<id>_eye = pusat lensa okuler (bidang tempat runtime memasang lensa ber-shader), opt_<id>_obj = pusat lensa
# objektif. Lensa okuler TIDAK dimodelkan (dipasang runtime: shader retikel / kaca biasa di pratinjau).
# Senjata ber-rel: <kind>_optic (empty titik pasang), <kind>_buis_up / _buis_dn (daun pisir lipat tegak / rebah, kecuali ar &
# burst yang selalu membawa optik: daunnya rebah menyatu dengan badan). <kind>_sight = lubang pisir belakang BUIS.
def putk(B, parts, M=None):
    for bm, mat in parts:
        put(B, bm, mat, M)


def ylathe(prof, segs, h, y=0.0):
    """Profil [(r, y)] diputar di sumbu Y lalu diangkat ke sumbu optik z = h."""
    return gk.xf(gk.lathe(prof, segs), T(0, y, h))


def zturret(bm, pos, axis):
    """Benda bersumbu Z (kenop/baut) dipindah ke pos dengan sumbu Z menghadap `axis` ('+z', '+x', '-x')."""
    R = {'+z': Matrix.Identity(4), '+x': Ry(90), '-x': Ry(-90), '-y': Rx(90), '+y': Rx(-90)}[axis]
    return gk.xf(bm, T(*pos) @ R)


def yknurl(r, y0, y1, h, n=64, depth=0.0005):
    """Cincin bergerigi sejajar sumbu optik (cincin diopter / zoom) dari y0 ke y1."""
    return gk.xf(gk.knurl(r, y1 - y0, n, depth, 0.0, 0.0004), T(0, y0, h) @ Rx(-90))


def cross_bolt(B, y, w, knob=False):
    """Baut silang penjepit rel di y: kepala hex / kenop jempol bergerigi di kiri, mur di kanan."""
    if knob:
        put(B, zturret(gk.knurl(0.0062, 0.0055, 36, 0.0005), (-w / 2, y, -0.0012), '-x'), 'dark')
    else:
        put(B, zturret(gk.screw('hex', 0.0062, 0.0022), (-w / 2 - 0.0002, y, -0.0012), '-x'), 'steel')
    put(B, zturret(gk.cyl(0.0042, 0.003, 6), (w / 2, y, -0.0012), '+x'), 'steel')


OPT_H = {'rds': 0.030, 'holo': 0.032, 's2': 0.034, 's4': 0.038, 's8': 0.040}


def build_opt_rds(lo=False):
    """Pisir titik merah 1×: tabung 30 mm × 70 mm, tudung lensa, dudukan rendah satu cincin + kenop baut silang,
    turret baterai bergerigi (kiri), 2 tutup setelan (atas, kanan)."""
    h = OPT_H['rds']
    B = bmesh.new()
    if lo:
        put(B, p_cyly(0.0155, 0.07, 8), 'dark', T(0, 0, h))
        put(B, p_box(0.024, 0.036, 0.016), 'dark', T(0, 0, 0.008))
        put(B, p_cylx(0.0085, 0.044, 6), 'dark', T(0, 0.003, h))
        return dict(body=B)
    seg = 32
    put(B, ylathe([(0.0122, -0.034), (0.0140, -0.034), (0.0148, -0.0332), (0.0150, -0.0312), (0.0150, 0.0195), (0.0157, 0.0222),
                   (0.0166, 0.0252), (0.0166, 0.0342), (0.0160, 0.0356), (0.0146, 0.0356), (0.0141, 0.0312), (0.0130, 0.0287),
                   (0.0122, 0.0287), (0.0122, -0.034)], seg, h), 'dark')
    put(B, ylathe([(0.01664, 0.0300), (0.01680, 0.0300), (0.01680, 0.0316), (0.01664, 0.0316), (0.01664, 0.0300)], seg, h), 'gold')  # garis identitas
    lz = gk.lens(0.0127, 0.0010, seg)
    put(B, lz, 'lens', T(0, 0.0284, h) @ Matrix.Diagonal((1, -1, 1, 1)))  # objektif berlapis jingga (cembung ke depan)
    # sadel turret melingkari tabung + tutup setelan & turret baterai
    put(B, gk.loft_se([(-0.0105, h, 0.0153, 0.0153, 0.0153, 2.0), (-0.0085, h, 0.0178, 0.0160, 0.0176, 3.4), (0.0135, h, 0.0178, 0.0160, 0.0176, 3.4),
                       (0.0155, h, 0.0153, 0.0153, 0.0153, 2.0)], 32), 'dark')
    put(B, zturret(gk.cap_turret(0.0062, 0.0058, 28, knurled=False), (0, 0.0025, h + 0.0172), '+z'), 'dark')
    put(B, zturret(gk.cap_turret(0.0062, 0.0058, 28, knurled=False), (0.0170, 0.0025, h), '+x'), 'dark')
    put(B, zturret(gk.cyl(0.0094, 0.0025, 32), (-0.0168, 0.0025, h), '-x'), 'dark')
    put(B, zturret(gk.knurl(0.0090, 0.0072, 56, 0.0005), (-0.0190, 0.0025, h), '-x'), 'dark')
    put(B, zturret(gk.screw('slot', 0.007, 0.0008), (-0.0263, 0.0025, h), '-x'), 'steel')
    # dudukan rendah: cincin lebar + tiang + rahang rel + kenop baut silang
    put(B, ylathe([(0.0150, -0.011), (0.0172, -0.011), (0.0176, -0.0102), (0.0176, -0.0002), (0.0172, 0.0006), (0.0150, 0.0006), (0.0150, -0.011)], seg, h, -0.004), 'dark')
    put(B, gk.plate([(-0.022, 0.003), (0.020, 0.003), (0.012, 0.0185), (-0.016, 0.0185)], 0.019, [0.002, 0.002, 0.004, 0.004], 0.0009), 'dark')
    for b in gk.rail_clamp(-0.022, 0.020, 0.026, 0.0035):
        put(B, b, 'dark')
    cross_bolt(B, -0.002, 0.026, knob=True)
    return dict(body=B, eye=(0, -0.0318, h), obj=(0, 0.0284, h), lensR=0.0118, objR=0.0127, fill=None, relief=0.16)


def build_opt_holo(lo=False):
    """Pisir holografik 1×: rumah kotak bertudung, jendela 30 × 23 mm, tuas QD (kanan), 2 tombol di belakang."""
    h = OPT_H['holo']
    B = bmesh.new()
    if lo:
        put(B, p_box(0.036, 0.086, 0.016), 'dark', T(0, -0.004, 0.010))
        fr = gk.frame_y(gk.rrect(0.0205, 0.0165, 0.006, 2, 0, h + 0.0015), gk.rrect(0.015, 0.0115, 0.002, 2, 0, h), -0.006, 0.030)
        put(B, fr, 'dark')
        return dict(body=B)
    outer, inner = gk.rrect(0.0208, 0.0168, 0.0072, 6, 0, h + 0.0018), gk.rrect(0.0150, 0.0115, 0.0030, 6, 0, h)
    put(B, gk.frame_y(outer, inner, -0.0060, 0.0300), 'dark')
    # bibir tudung depan sedikit lebih tebal
    put(B, gk.frame_y(gk.rrect(0.0213, 0.0173, 0.0075, 6, 0, h + 0.0018), gk.rrect(0.0200, 0.0160, 0.0068, 6, 0, h + 0.0018), 0.0270, 0.0310), 'dark')
    # jendela depan: kaca berlapis (sedikit miring ke atas seperti kaca holografik)
    put(B, p_box(0.0300, 0.0012, 0.0230), 'lens', T(0, 0.0255, h) @ Rx(-4))
    # badan elektronik + tutup baterai melintang di depan
    put(B, gk.plate([(-0.046, 0.0030), (0.036, 0.0030), (0.040, 0.0085), (0.040, 0.0170), (0.032, 0.0185), (-0.040, 0.0185), (-0.046, 0.0140)],
                    0.0350, [0.0015, 0.002, 0.003, 0.003, 0.002, 0.004, 0.004], 0.0011), 'dark')
    put(B, gk.xf(gk.cyl(0.0078, 0.0380, 36, -0.019), T(0, 0.0335, 0.0108) @ Ry(90)), 'dark')
    put(B, zturret(gk.knurl(0.0080, 0.0045, 48, 0.0005), (0.0185, 0.0335, 0.0108), '+x'), 'dark')
    put(B, zturret(gk.screw('slot', 0.0085, 0.0008), (0.0232, 0.0335, 0.0108), '+x'), 'steel')
    for sx in (-1, 1):  # tombol kecerahan di muka belakang
        put(B, zturret(gk.cyl(0.0034, 0.0022, 20, 0.0, 0.0028), (sx * 0.0075, -0.0462, 0.0105), '-y'), 'rubber')
    # tuas QD kanan (poros + tuas) dan rahang rel
    put(B, zturret(gk.cyl(0.0048, 0.0030, 24), (0.0175, -0.010, 0.0040), '+x'), 'steel')
    put(B, gk.plate([(-0.030, 0.0015), (-0.006, 0.0025), (-0.006, 0.0065), (-0.030, 0.0060)], 0.0026, 0.0012, 0.0005, x0=0.0215), 'dark')
    for b in gk.rail_clamp(-0.030, 0.020, 0.030, 0.0035):
        put(B, b, 'dark')
    return dict(body=B, eye=(0, -0.0062, h), obj=(0, 0.0255, h), lensR=0.0135, objR=0.0135, win=(0.030, 0.023), fill=None, relief=0.16)


def build_opt_s2(lo=False):
    """Prisma ringkas 2×: 110 mm, badan 38 mm, dasar menyatu dengan 2 baut silang, eyecup karet pendek, turret rendah."""
    h = OPT_H['s2']
    B = bmesh.new()
    if lo:
        put(B, p_box(0.036, 0.06, 0.04), 'dark', T(0, 0, h))
        put(B, p_cyly(0.016, 0.115, 8), 'dark', T(0, 0, h))
        put(B, p_box(0.024, 0.06, 0.016), 'dark', T(0, 0, 0.009))
        return dict(body=B)
    n = 40
    put(B, gk.loft_se([(-0.0525, h, 0.0146, 0.0146, 0.0146, 2.0), (-0.0400, h, 0.0152, 0.0152, 0.0152, 2.0), (-0.0310, h + 0.0010, 0.0172, 0.0182, 0.0172, 2.6),
                       (-0.0255, h + 0.0020, 0.0196, 0.0230, 0.0190, 4.2), (0.0220, h + 0.0020, 0.0196, 0.0230, 0.0190, 4.2),
                       (0.0290, h + 0.0005, 0.0172, 0.0182, 0.0172, 2.6), (0.0400, h, 0.0160, 0.0160, 0.0160, 2.0), (0.0540, h, 0.0166, 0.0166, 0.0166, 2.0)], n), 'dark')
    put(B, ylathe([(0.0146, 0.0535), (0.0170, 0.0535), (0.0172, 0.0605), (0.0166, 0.0615), (0.0152, 0.0615), (0.0148, 0.0570), (0.0146, 0.0535)], n, h), 'dark')
    put(B, ylathe([(0.01705, 0.0560), (0.01725, 0.0560), (0.01725, 0.0574), (0.01705, 0.0574), (0.01705, 0.0560)], n, h), 'gold')
    put(B, gk.lens(0.0150, 0.0012, n), 'lens', T(0, 0.0560, h) @ Matrix.Diagonal((1, -1, 1, 1)))
    put(B, ylathe([(0.0130, -0.0525), (0.0150, -0.0525), (0.0156, -0.0560), (0.0158, -0.0590), (0.0152, -0.0600), (0.0136, -0.0600), (0.0130, -0.0575),
                   (0.0130, -0.0525)], n, h), 'rubber')
    # garis panel di sisi prisma (alur 0,4 mm)
    for sx in (-1, 1):
        put(B, p_box(0.0008, 0.040, 0.0008), 'dark', T(sx * 0.0192, -0.002, h - 0.0135))
    put(B, zturret(gk.cap_turret(0.0068, 0.0042, 28), (0, -0.002, h + 0.0214), '+z'), 'dark')
    put(B, zturret(gk.cap_turret(0.0068, 0.0042, 28), (0.0188, -0.002, h + 0.002), '+x'), 'dark')
    put(B, gk.plate([(-0.0330, 0.0030), (0.0300, 0.0030), (0.0270, 0.0160), (-0.0290, 0.0160)], 0.0250, [0.002, 0.002, 0.004, 0.004], 0.0010), 'dark')
    for b in gk.rail_clamp(-0.0330, 0.0300, 0.0280, 0.0035):
        put(B, b, 'dark')
    for y in (-0.019, 0.016):
        cross_bolt(B, y, 0.028)
    return dict(body=B, eye=(0, -0.0528, h), obj=(0, 0.0560, h), lensR=0.0125, objR=0.0150, fill=0.68, relief=0.060)


def build_opt_s4(lo=False):
    """Teropong 4×32 (150 mm): tabung 30 mm melebar ke objektif 32 mm, blok turret persegi, cincin diopter, armor karet
    okuler, dudukan menyatu."""
    h = OPT_H['s4']
    B = bmesh.new()
    if lo:
        put(B, p_cyly(0.0165, 0.155, 8), 'dark', T(0, -0.002, h))
        put(B, p_cyly(0.0195, 0.03, 8), 'dark', T(0, 0.062, h))
        put(B, p_box(0.034, 0.03, 0.034), 'dark', T(0, 0, h))
        put(B, p_box(0.022, 0.08, 0.018), 'dark', T(0, 0, 0.009))
        return dict(body=B)
    n = 36
    put(B, ylathe([(0.0140, -0.0505), (0.0170, -0.0505), (0.0170, -0.0398), (0.0160, -0.0382), (0.0150, -0.0362), (0.0150, 0.0200), (0.0157, 0.0262),
                   (0.0184, 0.0458), (0.0195, 0.0502), (0.0195, 0.0728), (0.0188, 0.0758), (0.0173, 0.0758), (0.0168, 0.0712), (0.0158, 0.0692),
                   (0.0140, 0.0692), (0.0140, -0.0505)], n, h), 'dark')
    put(B, yknurl(0.0176, -0.0495, -0.0405, h, 56), 'dark')  # cincin diopter
    put(B, ylathe([(0.0146, -0.0505), (0.0180, -0.0505), (0.0186, -0.0535), (0.0186, -0.0625), (0.0180, -0.0655), (0.0158, -0.0660), (0.0148, -0.0630),
                   (0.0146, -0.0505)], n, h), 'rubber')
    for k in range(2):  # rusuk armor karet
        y = -0.0565 - k * 0.0038
        put(B, ylathe([(0.0186, y), (0.0190, y - 0.0008), (0.0190, y - 0.0016), (0.0186, y - 0.0024), (0.0186, y)], n, h), 'rubber')
    put(B, ylathe([(0.01952, 0.0700), (0.01970, 0.0700), (0.01970, 0.0712), (0.01952, 0.0712), (0.01952, 0.0700)], n, h), 'gold')
    put(B, gk.lens(0.0160, 0.0012, n), 'lens', T(0, 0.0694, h) @ Matrix.Diagonal((1, -1, 1, 1)))
    # blok turret persegi + kenop elevasi (atas) & windage (kanan)
    put(B, gk.loft_se([(-0.0180, h, 0.0158, 0.0156, 0.0158, 2.0), (-0.0160, h, 0.0182, 0.0168, 0.0180, 5.0), (0.0140, h, 0.0182, 0.0168, 0.0180, 5.0),
                       (0.0160, h, 0.0158, 0.0156, 0.0158, 2.0)], 40), 'dark')
    put(B, zturret(gk.cap_turret(0.0082, 0.0088, 32), (0, -0.001, h + 0.0180), '+z'), 'dark')
    put(B, zturret(gk.cap_turret(0.0082, 0.0088, 32), (0.0178, -0.001, h), '+x'), 'dark')
    put(B, zturret(gk.cyl(0.0058, 0.0026, 24), (-0.0178, -0.001, h), '-x'), 'dark')
    # dudukan menyatu: tulang punggung + dua cincin
    put(B, gk.plate([(-0.0400, 0.0030), (0.0400, 0.0030), (0.0400, 0.0080), (0.0350, 0.0150), (0.0200, 0.0150), (0.0170, 0.0110), (-0.0170, 0.0110),
                     (-0.0200, 0.0150), (-0.0350, 0.0150), (-0.0400, 0.0080)], 0.0230, [0.0015, 0.0015, 0.002, 0.003, 0.002, 0.002, 0.002, 0.002, 0.003, 0.002], 0.0010), 'dark')
    for y in (-0.028, 0.028):
        put(B, ylathe([(0.0150, y - 0.0055), (0.0176, y - 0.0055), (0.0180, y - 0.0048), (0.0180, y + 0.0048), (0.0176, y + 0.0055), (0.0150, y + 0.0055),
                       (0.0150, y - 0.0055)], n, h), 'dark')
        put(B, gk.plate([(y - 0.0065, 0.0140), (y + 0.0065, 0.0140), (y + 0.0050, h - 0.0140), (y - 0.0050, h - 0.0140)], 0.0160, 0.0, 0.0008), 'dark')
        cross_bolt(B, y, 0.026)
        for sx in (-1, 1):
            put(B, zturret(gk.screw('torx', 0.0030, 0.0012), (sx * 0.0128, y, h + 0.0128), '+z'), 'steel')
    for b in gk.rail_clamp(-0.0400, 0.0400, 0.0260, 0.0035):
        put(B, b, 'dark')
    return dict(body=B, eye=(0, -0.0508, h), obj=(0, 0.0694, h), lensR=0.0138, objR=0.0160, fill=0.94, relief=0.060)


S8_RING = (0, -0.0915)


def build_opt_s8(lo=False):
    """Teropong 4–8× (±330 mm): tabung 34 mm, lonceng objektif 50 mm, 3 turret (elevasi tinggi bergerigi + garis indeks,
    windage bertutup, paralaks samping kiri), cincin zoom bersirip (node opt_s8_ring), tudung matahari pendek, tutup lensa
    flip terbuka, 2 cincin dengan 4 baut."""
    h = OPT_H['s8']
    B = bmesh.new()
    if lo:
        put(B, p_cyly(0.019, 0.33, 10), 'dark', T(0, -0.005, h))
        put(B, p_cyly(0.029, 0.06, 10), 'dark', T(0, 0.14, h))
        put(B, p_cyly(0.021, 0.06, 10), 'dark', T(0, -0.14, h))
        put(B, p_box(0.040, 0.044, 0.04), 'dark', T(0, 0, h))
        for y in (-0.052, 0.040):
            put(B, p_box(0.024, 0.014, 0.022), 'dark', T(0, y, 0.011))
        return dict(body=B)
    n = 36
    put(B, ylathe([(0.0168, -0.1580), (0.0198, -0.1580), (0.0206, -0.1545), (0.0206, -0.1300), (0.0201, -0.1290), (0.0201, -0.1250), (0.0206, -0.1240),
                   (0.0206, -0.1130), (0.0194, -0.1070), (0.0181, -0.1030), (0.0181, -0.0795), (0.0172, -0.0775), (0.0170, -0.0740), (0.0170, 0.0460),
                   (0.0178, 0.0520), (0.0240, 0.0900), (0.0278, 0.1080), (0.0290, 0.1140), (0.0290, 0.1360), (0.0283, 0.1380), (0.0283, 0.1410),
                   (0.0293, 0.1415), (0.0293, 0.1680), (0.0286, 0.1712), (0.0272, 0.1712), (0.0267, 0.1500), (0.0263, 0.1352), (0.0168, 0.1352),
                   (0.0168, -0.1580)], n, h), 'dark')
    put(B, ylathe([(0.02903, 0.1300), (0.02920, 0.1300), (0.02920, 0.1316), (0.02903, 0.1316), (0.02903, 0.1300)], n, h), 'gold')
    put(B, gk.lens(0.0262, 0.0016, n), 'lens', T(0, 0.1350, h) @ Matrix.Diagonal((1, -1, 1, 1)))
    put(B, ylathe([(0.0172, -0.1580), (0.0204, -0.1580), (0.0212, -0.1625), (0.0214, -0.1715), (0.0206, -0.1760), (0.0182, -0.1762), (0.0175, -0.1705),
                   (0.0172, -0.1580)], n, h), 'rubber')
    # sadel turret
    put(B, gk.loft_se([(-0.0285, h, 0.0176, 0.0174, 0.0176, 2.0), (-0.0250, h, 0.0212, 0.0190, 0.0206, 3.6), (0.0190, h, 0.0212, 0.0190, 0.0206, 3.6),
                       (0.0225, h, 0.0176, 0.0174, 0.0176, 2.0)], 44), 'dark')
    # elevasi: kerah + badan bergerigi tinggi + tutup dengan garis indeks
    put(B, zturret(gk.cyl(0.0122, 0.0032, 40), (0, -0.003, h + 0.0208), '+z'), 'dark')
    put(B, zturret(gk.knurl(0.0114, 0.0150, 60, 0.0006), (0, -0.003, h + 0.0240), '+z'), 'dark')
    put(B, zturret(gk.cyl(0.0110, 0.0022, 40, 0.0, 0.0102), (0, -0.003, h + 0.0390), '+z'), 'dark')
    for k in range(20):
        a = 2 * pi * k / 20
        put(B, p_box(0.0004, 0.0016 if k % 5 else 0.0028, 0.0004), 'steel', T(0.0116 * math.sin(a), -0.003 + 0.0116 * math.cos(a), h + 0.0238) @ Rz(-a / D2R))
    put(B, p_box(0.0006, 0.0030, 0.0006), 'gold', T(0, -0.003 - 0.0124, h + 0.0224))  # garis nol
    # windage bertutup (kanan) + paralaks (kiri)
    put(B, zturret(gk.cyl(0.0112, 0.0030, 40), (0.0206, -0.003, h), '+x'), 'dark')
    put(B, zturret(gk.cap_turret(0.0100, 0.0120, 36, knurled=False), (0.0236, -0.003, h), '+x'), 'dark')
    put(B, zturret(gk.cyl(0.0120, 0.0030, 40), (-0.0206, -0.003, h), '-x'), 'dark')
    put(B, zturret(gk.cap_turret(0.0128, 0.0105, 40), (-0.0236, -0.003, h), '-x'), 'dark')
    # tutup lensa flip (terbuka, berdiri di atas tudung)
    put(B, gk.plate([(0.1640, h + 0.0280), (0.1720, h + 0.0280), (0.1720, h + 0.0340), (0.1640, h + 0.0340)], 0.012, 0.0015, 0.0006), 'poly')
    lid = gk.xf(gk.cyl(0.0305, 0.0035, 44), Rx(-90))
    put(B, lid, 'poly', T(0, 0.1700, h + 0.0310) @ Rx(-14) @ T(0, 0, 0.0310))
    put(B, p_box(0.010, 0.004, 0.006, 0.001), 'poly', T(0, 0.1700, h + 0.0310) @ Rx(-14) @ T(0, 0.0035, 0.0640))
    # dua cincin
    for y in (-0.052, 0.040):
        putk(B, gk.ring_mount(0.0170, h, 0.0140, 0.0260), T(0, y, 0))
    ring = bmesh.new()  # cincin zoom bersirip + tuas (berputar mengikuti perbesaran), asal di sumbunya
    put(ring, ylathe([(0.0181, -0.0100), (0.0196, -0.0100), (0.0200, -0.0094), (0.0200, 0.0094), (0.0196, 0.0100), (0.0181, 0.0100), (0.0181, -0.0100)], n, 0.0), 'dark')
    for k in range(12):
        a = 2 * pi * k / 12
        put(ring, p_box(0.0024, 0.0150, 0.0016, 0.0005), 'dark', Ry(-a / D2R) @ T(0, 0, 0.0204))
    put(ring, gk.plate([(-0.0060, 0.0190), (0.0060, 0.0190), (0.0040, 0.0290), (-0.0040, 0.0290)], 0.0050, [0.0, 0.0, 0.0018, 0.0018], 0.0006), 'dark', Ry(-35))
    return dict(body=B, eye=(0, -0.1585, h), obj=(0, 0.1350, h), lensR=0.0165, objR=0.0262, fill=0.96, relief=0.068, ring=(ring, (S8_RING[0], S8_RING[1], h)))


OPTICS = {'rds': build_opt_rds, 'holo': build_opt_holo, 's2': build_opt_s2, 's4': build_opt_s4, 's8': build_opt_s8}
OPTIC_DEFAULT = {'ar': 'rds', 'burst': 'holo'}  # optik bawaan (selalu terpasang bila tidak ada scope)


def buis_leaf(kind, y, top, hs, up=True):
    """Daun pisir lipat (BUIS) di rel (puncak z = top), lubang/pejera setinggi hs di atas puncak rel. kind 'rear' = daun
    berlubang (lubang 2,2 mm) dengan telinga pelindung, 'front' = pejera tiang di dalam cincin pelindung.
    up = tegak; False = rebah ke depan (engsel di belakang dasar)."""
    B = bmesh.new()
    zc = top + hs
    N = 32
    if kind == 'rear':
        hole = [(0.0022 * math.cos(2 * pi * k / N), zc + 0.0022 * math.sin(2 * pi * k / N)) for k in range(N)]
        out = []
        for k in range(N):  # kontur luar daun (persegi membulat, sampel searah sudut dari pusat lubang)
            a = 2 * pi * k / N
            c, s = math.cos(a), math.sin(a)
            hw, ht, hb = 0.0075, 0.0055, hs - 0.0035
            tx = hw / abs(c) if abs(c) > 1e-6 else 1e9
            tz = (ht if s > 0 else hb) / abs(s) if abs(s) > 1e-6 else 1e9
            t = min(tx, tz)
            px, pz = c * t, s * t
            if pz > 0 and abs(px) > hw - 0.002 and pz > ht - 0.002:  # sudut atas membulat
                px *= 0.93
                pz *= 0.93
            out.append((px, zc + pz))
        put(B, gk.frame_y(out, hole, y - 0.0012, y + 0.0012), 'dark')
    else:
        ring_o = [(0.0072 * math.cos(2 * pi * k / N), zc + 0.0002 + 0.0072 * math.sin(2 * pi * k / N)) for k in range(N)]
        ring_i = [(0.0058 * math.cos(2 * pi * k / N), zc + 0.0002 + 0.0058 * math.sin(2 * pi * k / N)) for k in range(N)]
        put(B, gk.frame_y(ring_o, ring_i, y - 0.0016, y + 0.0016), 'dark')
        put(B, p_box(0.0016, 0.0020, 0.0056), 'dark', T(0, y, zc - 0.0028))  # tiang pejera, puncak tepat di garis bidik
        put(B, gk.plate([(y - 0.0016, top + 0.0040), (y + 0.0016, top + 0.0040), (y + 0.0016, zc - 0.0062), (y - 0.0016, zc - 0.0062)], 0.0060, 0.0, 0.0004), 'dark')
    put(B, gk.plate([(y - 0.0016, top + 0.0040), (y + 0.0016, top + 0.0040), (y + 0.0016, top + 0.0080), (y - 0.0016, top + 0.0080)], 0.0150, 0.0, 0.0004), 'dark')
    if not up:  # rebah ke depan di engsel (belakang dasar daun)
        hz = top + 0.0050
        bmesh.ops.transform(B, matrix=T(0, y - 0.0016, hz) @ Rx(-90) @ T(0, -(y - 0.0016), -hz), verts=B.verts)
    return B


def buis_base(B, y, top):
    """Dasar BUIS di rel: blok penjepit + telinga engsel + baut silang."""
    put(B, gk.plate([(y - 0.0110, top + 0.0005), (y + 0.0110, top + 0.0005), (y + 0.0090, top + 0.0060), (y - 0.0090, top + 0.0060)], 0.0190,
                    [0.001, 0.001, 0.002, 0.002], 0.0007), 'dark')
    for b in gk.rail_clamp(y - 0.0110, y + 0.0110, 0.0240, 0.0010):
        put(B, b, 'dark', T(0, 0, top))
    for sx in (-1, 1):
        put(B, gk.plate([(y - 0.0050, top + 0.0040), (y + 0.0050, top + 0.0040), (y + 0.0030, top + 0.0095), (y - 0.0030, top + 0.0095)], 0.0022, 0.001, 0.0004, x0=sx * 0.0088), 'dark')
    put(B, zturret(gk.screw('hex', 0.0050, 0.0018), (-0.0122, y, top - 0.0012), '-x'), 'steel')


BUIS_HS = 0.0160  # tinggi garis bidik pisir lipat di atas puncak rel


def add_rail_and_buis(d, B, top, y0, y1, rear=None, front=None, merged=False, base=-0.007, mount=None):
    """Rel aksesori + BUIS (dasar di badan, daun di node <kind>_buis_up/_dn kecuali merged: daun rebah ikut badan)."""
    put(B, gk.picatinny(y1 - y0, y0, top, base), 'dark')
    rear = y0 + 0.012 if rear is None else rear
    front = y1 - 0.012 if front is None else front  # False = tanpa pejera depan di rel
    sights = [('rear', rear)] + ([('front', front)] if front is not False else [])
    for _, y in sights:
        buis_base(B, y, top)
    up, dn = bmesh.new(), bmesh.new()
    for kind_, y in sights:
        merge(up, buis_leaf(kind_, y, top, BUIS_HS, True))
        merge(dn, buis_leaf(kind_, y, top, BUIS_HS, False))
    if merged:
        merge(B, dn)
        up.free()
    else:
        d['buis'] = (up, dn)
    d['sight'] = (0, rear, top + BUIS_HS)
    d['optic'] = (0, (y0 + y1) / 2 if mount is None else mount, top)
    d['rail'] = (y0, y1, top)

# ---------------------------------------------------------------- tangan orang pertama
HAND_R = Vector((0.026, -0.010, 0.004))  # pusat telapak kanan relatif origin senjata (titik genggam)


def finger(B, pts, r0, mat='glove'):
    """Jari bersarung: ruas meruncing, buku jari sedikit menonjol, ujung membulat."""
    n = len(pts)
    radii = [r0 * (1.0 - 0.2 * i / (n - 1)) for i in range(n)]
    put(B, p_chain(pts, radii, 8, False, False), mat)
    for k, (q, r) in enumerate(zip(pts, radii)):
        if k:
            put(B, p_sphere(r * (1.08 if k < n - 1 else 1.0), 8, 5), mat, T(*q))


def sleeve_bm(wrist, d, length=0.31, r0=0.0345, r1=0.047, segs=18, rings=16, seed=0.0):
    """Lengan baju kain: tabung meruncing dengan keriput melingkar dekat manset (kain terdorong) dan lipatan memanjang."""
    d = Vector(d).normalized()
    u = d.orthogonal().normalized()
    v = d.cross(u)
    wrist = Vector(wrist)
    rr = []
    for i in range(rings + 1):
        t = i / rings
        r = r0 + (r1 - r0) * (t ** 0.8)
        comp = 0.0032 * math.sin(t * 44.0 + seed) * max(0.0, 1.0 - t * 2.4) + 0.0018 * math.sin(t * 17.0 + seed * 1.7)
        ring = []
        for k in range(segs):
            a = 2 * pi * k / segs
            fold = 0.0024 * math.sin(3 * a + t * 8.0 + seed) + 0.0015 * math.sin(7 * a - t * 21.0 + seed * 2.1)
            ring.append(wrist + d * (length * t) + (u * math.cos(a) + v * math.sin(a)) * (r + comp + fold * (0.35 + 0.65 * t)))
        rr.append(ring)
    return p_loft(rr)


def arm_parts(B, wrist, d, seed=0.0, length=0.31):
    """Pergelangan → siku: manset sarung tangan bertali, kulit pergelangan, manset emas, lengan baju ungu berlipat."""
    wrist, d = Vector(wrist), Vector(d).normalized()
    put(B, p_tube(wrist - d * 0.012, wrist + d * 0.030, 0.0262, 0.0286, 14), 'glove')
    put(B, p_tube(wrist + d * 0.006, wrist + d * 0.021, 0.0296, 0.0303, 14), 'poly')   # tali pergelangan
    put(B, p_tube(wrist + d * 0.0215, wrist + d * 0.0245, 0.0307, 0.0307, 14), 'gold')  # jahitan emas
    put(B, p_tube(wrist + d * 0.029, wrist + d * 0.049, 0.0258, 0.0272, 14), 'skin')    # kulit di antara sarung tangan & manset
    put(B, p_tube(wrist + d * 0.046, wrist + d * 0.059, 0.0338, 0.0348, 16), 'cuff')
    put(B, sleeve_bm(wrist + d * 0.057, d, length, 0.0348, 0.047, seed=seed), 'sleeve')


def build_hand_r():
    """Tangan kanan menggenggam gagang (koordinat senjata, lalu digeser ke pusat telapak)."""
    B = bmesh.new()
    # telapak/punggung tangan: kotak membulat di sisi kanan gagang, condong mengikuti gagang
    palm = p_box(0.026, 0.07, 0.086, 0.011, 2)
    put(B, palm, 'glove', T(0.027, -0.006, 0.002) @ Rx(-18) @ Ry(8))
    # jari tengah, manis, kelingking melingkari depan gagang ke sisi kiri
    for z, sc in ((0.016, 1.0), (-0.008, 0.97), (-0.032, 0.86)):
        y0 = yc(z)
        finger(B, [(0.031, y0 + 0.020, z + 0.003), (0.016, y0 + 0.035, z + 0.001), (-0.006, y0 + 0.034, z - 0.001), (-0.018, y0 + 0.018 * sc, z - 0.003)], 0.0098 * sc)
        put(B, p_box(0.007, 0.017, 0.017, 0.003, 2), 'poly', T(0.0405, y0 + 0.014, z + 0.003) @ Rz(-20))  # pelindung buku jari
    # telunjuk di pelatuk
    finger(B, [(0.029, 0.026, 0.040), (0.017, 0.043, 0.044), (0.007, 0.051, 0.042), (0.003, 0.051, 0.035)], 0.0092)
    put(B, p_box(0.007, 0.017, 0.016, 0.003, 2), 'poly', T(0.0385, 0.018, 0.040) @ Rz(-20))
    # ibu jari di sisi kiri, mengarah ke depan
    finger(B, [(0.020, -0.020, 0.036), (0.002, -0.012, 0.055), (-0.017, 0.010, 0.058), (-0.020, 0.034, 0.056)], 0.0108)
    # panel punggung tangan (karet) + pergelangan & lengan ke belakang-bawah-kanan
    put(B, p_box(0.004, 0.040, 0.050, 0.0015, 1), 'grip', T(0.0412, -0.012, 0.0) @ Rx(-18) @ Ry(8))
    arm_parts(B, (0.03, -0.052, -0.028), (0.24, -0.88, -0.41), seed=0.7)
    for v in B.verts:
        v.co -= HAND_R
    return B


def build_hand_l():
    """Tangan kiri menyangga dari bawah: telapak menghadap atas, jari melingkar naik di sisi kanan pelindung tangan,
    ibu jari sepanjang sisi kiri. Origin = pusat telapak; sumbu pelindung tangan ±0,04 m di atasnya."""
    B = bmesh.new()
    put(B, p_box(0.07, 0.074, 0.024, 0.01, 2), 'glove', T(0.0, 0.0, -0.004) @ Ry(-14))
    for i, y in enumerate((0.027, 0.009, -0.009, -0.027)):
        sc = (1.0, 1.0, 0.95, 0.84)[i]
        finger(B, [(0.032, y, 0.002), (0.046, y + 0.002, 0.018), (0.042, y + 0.004, 0.038), (0.031, y + 0.004, 0.052 * sc)], 0.0095 * sc)
        put(B, p_box(0.016, 0.016, 0.007, 0.003, 2), 'poly', T(0.040, y, -0.007) @ Ry(-32))  # pelindung buku jari
    finger(B, [(-0.030, -0.014, 0.004), (-0.038, 0.014, 0.018), (-0.033, 0.040, 0.030), (-0.027, 0.058, 0.035)], 0.0105)
    put(B, p_box(0.044, 0.046, 0.004, 0.0015, 1), 'grip', T(0.0, -0.004, -0.0165) @ Ry(-14))  # panel punggung tangan (menghadap bawah)
    arm_parts(B, (-0.024, -0.048, -0.006), (-0.33, -0.84, -0.43), seed=2.3)
    return B


def build_forearm():
    """Lengan bawah satuan untuk rig obat/granat (weapons.js placeLimb): panjang 1 sepanjang +Z desain (= +Y glTF),
    siku di −0,5, pergelangan di +0,5. Hanya sumbu panjang yang diskala di game (±0,3–0,45), jadi jari-jari tetap."""
    B = bmesh.new()
    d = Vector((0, 0, -1))
    w = Vector((0, 0, 0.5))
    put(B, p_tube(w, w + d * 0.06, 0.0258, 0.0272, 14), 'skin')
    put(B, p_tube(w + d * 0.05, w + d * 0.09, 0.0338, 0.0348, 16), 'cuff')
    put(B, sleeve_bm(w + d * 0.085, d, 0.915, 0.0348, 0.047, segs=18, rings=20, seed=1.1), 'sleeve')
    return B


def build_hand_open():
    """Tangan terbuka bersarung (rig obat/granat): telapak di bidang XY desain, jari ke +Y (= −Z glTF), ibu jari di +X,
    pergelangan di −Y. Origin = pusat telapak."""
    B = bmesh.new()
    put(B, p_box(0.075, 0.085, 0.027, 0.011, 2), 'glove')
    for i, x in enumerate((-0.027, -0.009, 0.009, 0.027)):
        sc = (0.86, 0.97, 1.0, 0.95)[i]
        finger(B, [(x, 0.038, 0.0), (x, 0.064 * sc + 0.006, -0.003), (x, 0.086 * sc + 0.006, -0.010), (x, 0.102 * sc + 0.006, -0.020)], 0.0092 * (0.9 + 0.1 * sc))
        put(B, p_box(0.016, 0.016, 0.006, 0.003, 2), 'poly', T(x, 0.036, 0.0125))
    finger(B, [(0.036, -0.012, 0.0), (0.052, 0.012, -0.004), (0.060, 0.034, -0.010), (0.062, 0.052, -0.016)], 0.0105)
    put(B, p_box(0.046, 0.046, 0.004, 0.0015, 1), 'grip', T(0.0, -0.004, 0.0142))
    put(B, p_tube((0, -0.036, 0), (0, -0.066, 0), 0.0286, 0.0262, 14), 'glove')
    put(B, p_tube((0, -0.044, 0), (0, -0.058, 0), 0.0303, 0.0296, 14), 'poly')
    put(B, p_tube((0, -0.0585, 0), (0, -0.0615, 0), 0.0307, 0.0307, 14), 'gold')
    return B


FRAG_PROF = [(-0.05, 0.0), (-0.049, 0.014), (-0.042, 0.025), (-0.028, 0.031), (-0.008, 0.0325), (0.012, 0.031), (0.028, 0.026), (0.039, 0.018), (0.043, 0.012)]


def frag_r(z):  # jari-jari badan granat pada ketinggian z
    for (z0, r0), (z1, r1) in zip(FRAG_PROF, FRAG_PROF[1:]):
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return 0.0


def build_hand_nade():
    """Tangan kanan menggenggam granat (koordinat granat: origin = pusat badan, tuas di +X, cincin di −X atas):
    telapak di sisi kanan menekan tuas, empat jari melingkari depan ke sisi kiri, ibu jari melintang di sisi kamera (−Y)."""
    B = bmesh.new()
    put(B, p_box(0.024, 0.074, 0.086, 0.011, 2), 'glove', T(0.046, 0.003, -0.006) @ Ry(-7))

    def arc(z0, z1, R, a0, a1, n=5):
        return [(R * math.cos(math.radians(a0 + (a1 - a0) * i / (n - 1))), R * math.sin(math.radians(a0 + (a1 - a0) * i / (n - 1))), z0 + (z1 - z0) * i / (n - 1)) for i in range(n)]
    for z, sc, a1 in ((0.025, 1.0, 168), (0.005, 1.0, 162), (-0.016, 0.96, 154), (-0.035, 0.85, 140)):
        r0 = 0.0098 * sc
        finger(B, arc(z, z - 0.003, frag_r(z) + r0 + 0.0012, 38, a1), r0)
    put(B, p_box(0.02, 0.03, 0.07, 0.009, 2), 'glove', T(0.04, -0.03, 0.0) @ Rz(-40))  # pangkal ibu jari
    finger(B, arc(0.012, 0.03, frag_r(0.02) + 0.0118, -48, -132), 0.0108)
    arm_parts(B, (0.05, -0.012, -0.05), (0.32, -0.42, -0.85), seed=4.1)
    return B


# ---------------------------------------------------------------- v5: tangan kiri dipaskan per senjata
# fp_hand_l (satu genggaman untuk semua senjata) tetap diekspor untuk rig obat & granat. Senjata memakai fp_hand_l_<kind>:
# telapak menempel di bawah-kiri pelindung tangan, empat jari mengikuti kontur sisi kanannya (penampang diukur dengan
# sinar ke rakitan senjata yang sudah jadi), ibu jari rebah di sisi kiri mengarah ke depan. Pistol & revolver memakai
# fp_hand_l_pistol: tangan penyangga dua tangan (jari membungkus jari tangan kanan di depan gagang, ibu jari di bawah ibu
# jari kanan). Origin = pusat telapak (= titik <kind>_guard baru). Lengan bawah selalu searah ARM_L seperti fp_hand_l,
# jadi sumbu lengan di web/game/weapons.js (AX_L) tetap berlaku untuk animasi isi ulang/periksa.
ARM_L = (-0.33, -0.84, -0.43)
FIT_HOLD = {'shotgun': ('shotgun_pump',), 'dbs': ('dbs_brk',)}  # bagian bergerak yang ikut digenggam
FIT_ONLY = {'shotgun'}  # hanya bagian bergerak itu (pompa, bukan laras di atasnya)
HAND_L_OF = {'revolver': 'pistol'}  # senjata yang memakai tangan kiri senjata lain (gagang sama)
FINGERS_L = (  # (y relatif pusat telapak, ruas [proksimal, tengah, distal], jari-jari pangkal); telunjuk paling depan
    (0.0265, (0.040, 0.023, 0.019), 0.0094),
    (0.0085, (0.044, 0.026, 0.020), 0.0097),
    (-0.0095, (0.041, 0.025, 0.019), 0.0093),
    (-0.0265, (0.033, 0.020, 0.017), 0.0083),
)
PALM_L = (0.066, 0.076, 0.023)  # lebar (sampai pangkal jari), panjang (sepanjang laras), tebal
SLEEVE_FIT = 0.46  # lengan baju lebih panjang dari fp_hand_l: ujungnya selalu di luar layar (juga saat membidik DMR/runduk)


def hold_bvh(objs):
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    V_, P_ = [], []
    for ob in objs:
        M = ob.matrix_world
        o0 = len(V_)
        V_ += [M @ v.co for v in ob.data.vertices]
        P_ += [tuple(i + o0 for i in p.vertices) for p in ob.data.polygons]
    return BVHTree.FromPolygons(V_, P_, all_triangles=False, epsilon=0.0)


class Hull:
    """Kulit cembung penampang senjata di bidang y (titik dari sinar luar → pusat c), lewat fungsi tumpu per 1°."""

    def __init__(self, bvh, y, c, zcap, xtop=0.01, R=0.14):
        self.y, self.c = y, c
        pts = []
        for k in range(180):
            a = k * 2.0 * D2R
            u = Vector((math.cos(a), 0.0, math.sin(a)))
            h = bvh.ray_cast(Vector((c[0], y, c[1])) + u * R, -u, R)[0]
            if h is not None and h.z <= zcap:
                pts.append(Vector((h.x, y, h.z)))
        if len(pts) < 8:
            raise RuntimeError('penampang kosong di y=%.3f' % y)
        # punggung pelindung tangan (rel/rusuk sempit di tengah diabaikan): ujung jari harus tetap di bawahnya
        self.top = max((p.z for p in pts if abs(p.x - c[0]) >= xtop), default=max(p.z for p in pts))
        self.n, self.h, self.s = [], [], []
        for k in range(360):
            n = Vector((math.cos(k * D2R), 0.0, math.sin(k * D2R)))
            p = max(pts, key=lambda q: q.dot(n))
            self.n.append(n)
            self.h.append(p.dot(n))
            self.s.append(p)

    def at(self, a, rho):  # titik pada lengkung offset (kulit + rho) di sudut normal a (derajat)
        k = int(round(a)) % 360
        return self.s[k] + self.n[k] * rho

    def dist(self, x):  # jarak titik di luar ke kulit (≤ 0 = di dalam)
        return max(x.dot(n) - h for n, h in zip(self.n, self.h))

    def ang(self, p):
        return math.degrees(math.atan2(p.z - self.c[1], p.x - self.c[0]))


def walk_poly(poly, p, L):
    """Titik pertama pada polyline [(sudut, titik)] — mulai dari proyeksi p padanya, maju — yang berjarak L dari p.
    Lengkung offset melompat di sisi datar (normal sama), jadi segmen lurus antar titik = sisi datar itu sendiri."""
    best, i0, t0 = None, 0, 0.0
    for i in range(min(len(poly) - 1, 60)):  # p ada di dekat awal polyline (sudut sendi sebelumnya − 25°)
        A, Bv = poly[i][1], poly[i + 1][1]
        D = Bv - A
        dd = D.dot(D)
        t = 0.0 if dd < 1e-14 else min(1.0, max(0.0, (p - A).dot(D) / dd))
        e = (A + D * t - p).length
        if best is None or e < best - 1e-9:
            best, i0, t0 = e, i, t
    for i in range(i0, len(poly) - 1):
        A, Bv = poly[i][1], poly[i + 1][1]
        D = Bv - A
        a_, b_, c_ = D.dot(D), (A - p).dot(D), (A - p).dot(A - p) - L * L
        ts = t0 if i == i0 else 0.0
        if a_ > 1e-14:
            disc = b_ * b_ - a_ * c_
            if disc >= 0.0:
                for t in sorted(((-b_ - math.sqrt(disc)) / a_, (-b_ + math.sqrt(disc)) / a_)):
                    if ts - 1e-9 <= t <= 1.0:
                        return A + D * t, poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t
    return poly[-1][1], poly[-1][0]


def wrap_chain(hull, p0, a0, lens, radii, gap=0.0008, amax=250.0):
    """Ruas jari kaku yang melingkari kulit: tiap sendi di lengkung offset, berjarak tepat sepanjang ruas dari sendi
    sebelumnya (sudut naik = ke atas di sisi kanan); sendi diangkat seperlunya supaya tengah ruas tidak masuk senjata."""
    pts, prev, a = [Vector(p0)], Vector(p0), a0
    for k, L in enumerate(lens):
        r0, r1 = radii[k], radii[k + 1]
        lift = 0.0
        for _ in range(5):
            rho = r1 + gap + lift
            poly = [(aa, hull.at(aa, rho)) for aa in (a - 25.0 + i for i in range(int(min(amax, a + 170.0) - a + 26.0)))]
            q, aq = walk_poly(poly, prev, L)
            worst = max(r0 + (r1 - r0) * t + gap - hull.dist(prev.lerp(q, t)) for t in (0.3, 0.5, 0.7))
            if worst <= 0.0004:
                break
            lift += worst * 1.7
        pts.append(q)
        prev, a = q, aq
    return pts, a


def frame_m(ex, ey, ez):
    return Matrix(((ex.x, ey.x, ez.x, 0), (ex.y, ey.y, ez.y, 0), (ex.z, ey.z, ez.z, 0), (0, 0, 0, 1)))


def ellipsoid(B, center, ax, rx, ry, rz, mat='glove'):
    """Elipsoid (pangkal ibu jari): sumbu panjang ry searah ax."""
    ay = Vector(ax).normalized()
    ax_ = ay.orthogonal().normalized()
    az = ax_.cross(ay)
    M = T(*center) @ frame_m(ax_, ay, az) @ Matrix.Diagonal((rx, ry, rz, 1.0))
    put(B, p_sphere(1.0, 12, 7), mat, M)


def build_hand_l_fit(kind, bvh, guard):
    """Tangan kiri yang dipaskan ke pelindung tangan/pompa senjata kind (koordinat senjata). Kembali: (bmesh di koordinat
    senjata, pusat telapak). Telapak dimiringkan beta (normal menghadap kanan-atas) lalu ditempel ke kulit penampang;
    beta disetel sampai ujung jari tengah berhenti di sisi kanan atas (± 30–55°), tidak melewati punggung pelindung."""
    gy = guard.y
    # penampang: dasar pelindung tangan tepat di atas titik guard; pusat = tengah pita terlebar; batas atas (zcap) dari
    # sinar tegak di samping garis tengah (rel atas, pegangan angkut, dsb. di tengah tidak ikut digenggam)
    zb = bvh.ray_cast(Vector((0, gy, guard.z - 0.06)), Vector((0, 0, 1)), 0.2)[0].z
    widths = []
    for k in range(1, 18):
        z = zb + 0.004 * k
        w_ = 0.0
        for sx in (-1, 1):
            h = bvh.ray_cast(Vector((sx * 0.15, gy, z)), Vector((-sx, 0, 0)), 0.3)[0]
            w_ = max(w_, abs(h.x) if h is not None and abs(h.x) < 0.06 else 0.0)
        widths.append((z, w_))
    hw = max(max(w for _, w in widths), 0.015)
    band = [z for z, w in widths if w >= 0.97 * hw] or [zb + hw]
    c = (0.0, 0.5 * (band[0] + band[-1]))
    tops = [h.z for h in (bvh.ray_cast(Vector((sx * 0.6 * hw, gy, c[1] + 0.25)), Vector((0, 0, -1)), 0.3)[0] for sx in (-1, 1)) if h is not None]
    zcap = (min(tops) + 0.012) if tops else c[1] + 1.6 * hw
    W, Lp, Tp = PALM_L
    hulls = {}

    def hull(y):
        k = round(y, 4)
        if k not in hulls:
            hulls[k] = Hull(bvh, k, c, zcap, 0.5 * hw)
        return hulls[k]

    foot = []
    for dy in (-0.034, -0.017, 0.0, 0.017, 0.034):
        foot += hull(gy + dy).s
    Hc = hull(gy)

    def pose(beta, uc):
        """Telapak datar miring beta, menyentuh kulit di titik terendahnya (searah normal) pada x-lokal uc."""
        b = beta * D2R
        ex, ey, ez = Vector((math.cos(b), 0, -math.sin(b))), Vector((0, 1, 0)), Vector((math.sin(b), 0, math.cos(b)))
        h0 = min(foot, key=lambda p: p.dot(ez))
        P = ex * (h0.dot(ex) - uc) + ez * (h0.dot(ez) - Tp / 2 - 0.0012) + Vector((0, gy, 0))
        return P, ex, ey, ez

    def fingers_of(P, ex, ey, ez, which=range(4)):
        out = []
        for i in which:
            oy, lens, r0 = FINGERS_L[i]
            radii = [r0, r0 * 0.94, r0 * 0.87, r0 * 0.8]
            mcp = P + ex * (W / 2 - 0.007) + ey * oy + ez * 0.001
            H = hull(gy + oy)
            pts, a_tip = wrap_chain(H, mcp, H.ang(mcp), lens, radii)
            out.append((pts, radii, a_tip))
        return out

    # cari kemiringan & letak telapak: ujung jari (telunjuk & tengah) berhenti di sisi kanan, bonggolnya tetap di bawah
    # punggung pelindung tangan (tidak mengait/menyembul di atasnya); pangkal jari & pangkal ibu jari dekat permukaan;
    # telapak tidak terlalu miring. Pelindung tipis (SMG/PDW) → telapak lebih memutar ke kiri-bawah.
    def over_top(fs):
        e = 0.0
        for (pts, radii, a_tip), i in zip(fs, (0, 1)):
            H = hull(gy + FINGERS_L[i][0])
            e = max(e, pts[3].z + radii[3] - (H.top - 0.003), pts[2].z + radii[2] * 1.07 - (H.top - 0.002))
        return e

    def floating(fs):  # sendi jari yang menjauh dari permukaan (ruas terangkat melewati sudut pelindung)
        e = 0.0
        for (pts, radii, a_tip), i in zip(fs, (0, 1)):
            H = hull(gy + FINGERS_L[i][0])
            e = max([e] + [H.dist(pts[k]) - radii[k] for k in (1, 2, 3)])
        return e

    best = None
    for beta in range(-10, 60, 5):
        for uc in (-0.012, -0.006, 0.0, 0.006, 0.012, 0.018, 0.024, 0.03):
            P, ex, ey, ez = pose(beta, uc)
            fs = fingers_of(P, ex, ey, ez, (0, 1))
            pts, radii, a_tip = fs[1]
            mcp = pts[0]
            cmc = P + ex * (-W / 2 + 0.012) + ey * (-0.017) + ez * 0.002
            d_m = Hc.dist(mcp) - radii[0]
            d_c = Hc.dist(cmc) - 0.0118
            sc = ((a_tip - 35.0) / 15.0) ** 2 + (30.0 if not 0.0 <= a_tip <= 60.0 else 0.0)
            sc += 12.0 * (max(0.0, over_top(fs)) / 0.003) ** 2 + 4.0 * (max(0.0, floating(fs) - 0.003) / 0.003) ** 2
            sc += ((d_m - 0.003) / 0.006) ** 2 + (max(0.0, d_c - 0.012) / 0.006) ** 2 + (beta / 40.0) ** 2
            if best is None or sc < best[0]:
                best = (sc, beta, uc)
    _, beta, uc = best
    P, ex, ey, ez = pose(beta, uc)
    fingers = fingers_of(P, ex, ey, ez)
    R = frame_m(ex, ey, ez)
    B = bmesh.new()
    put(B, p_box(W, Lp, Tp, 0.0095, 2), 'glove', T(*P) @ R)
    put(B, p_box(0.044, 0.046, 0.004, 0.0015, 1), 'grip', T(*(P - ez * (Tp / 2 + 0.0005) - ex * 0.004)) @ R)  # punggung
    for (pts, radii, a_tip), (oy, lens, r0) in zip(fingers, FINGERS_L):
        put(B, p_chain(pts, radii, 8, False, False), 'glove')
        for k in range(1, 4):
            put(B, p_sphere(radii[k] * (1.07 if k < 3 else 1.0), 8, 5), 'glove', T(*pts[k]))
        kn = P + ex * (W / 2 - 0.009) + ey * oy - ez * (Tp / 2 - 0.0015)  # pelindung buku jari (punggung, pangkal jari)
        put(B, p_box(0.016, 0.016, 0.007, 0.003, 2), 'poly', T(*kn) @ R @ Ry(-24))
    # ibu jari: pangkal di sisi kiri-belakang telapak, ruas rebah di sisi kiri pelindung tangan menghadap depan
    cmc = P + ex * (-W / 2 + 0.012) + ey * (-0.017) + ez * 0.002
    # ibu jari: sinar radial dari pusat penampang (stabil di sisi tegak, tidak melompat ke bagian lain), sudut mulai sedikit
    # di atas pangkal ibu jari lalu naik pelan ke depan; 180° = sisi kiri setinggi pusat
    am = min(205.0, max(160.0, Hc.ang(cmc) % 360.0 - 10.0))
    rt = (0.0118, 0.0112, 0.0103, 0.0094)

    def side(y, a, rho):
        u = Vector((math.cos(a * D2R), 0.0, math.sin(a * D2R)))
        o = Vector((c[0], y, c[1]))
        hit, nrm = bvh.ray_cast(o + u * 0.14, -u, 0.14)[:2]
        if hit is None:
            return o + u * (hw + rho)
        nrm = Vector((nrm.x, 0.0, nrm.z)).normalized() if nrm is not None and (nrm.x or nrm.z) else u
        if nrm.dot(u) < 0.0:
            nrm = -nrm
        return Vector((hit.x, y, hit.z)) + nrm.lerp(u, 0.5).normalized() * rho
    mcp_t = side(gy - 0.004, am, rt[1] + 0.0015)
    ip_t = side(gy + 0.027, am - 6.0, rt[2] + 0.0012)
    tip_t = side(gy + 0.051, am - 10.0, rt[3] + 0.0008)
    put(B, p_chain([cmc, mcp_t, ip_t, tip_t], list(rt), 9, False, False), 'glove')
    for p_, r_ in ((mcp_t, rt[1] * 1.06), (ip_t, rt[2] * 1.06), (tip_t, rt[3])):
        put(B, p_sphere(r_, 9, 5), 'glove', T(*p_))
    ellipsoid(B, cmc.lerp(mcp_t, 0.42) - ez * 0.002, mcp_t - cmc, 0.0125, 0.024, 0.0135)  # pangkal ibu jari (tenar)
    wrist = P + ex * (-0.019) + ey * (-0.047) + ez * (-0.007)
    arm_parts(B, wrist, ARM_L, seed=2.3, length=SLEEVE_FIT)
    log('tangan kiri', kind, 'beta %.0f uc %.3f' % (beta, uc), 'ujung jari tengah %.0f°' % fingers[1][2],
        'lewat punggung %.1f mm' % (1000 * over_top(fingers[:2])), 'ibu jari %.0f°' % am, 'telapak', tuple(round(v, 4) for v in P))
    return B, P


def pistol_palm():  # pusat telapak tangan kiri penyangga (sisi kiri gagang)
    return Vector((-0.0315, yc(-0.012) - 0.004, -0.012))


def build_hand_l_pistol():
    """Tangan kiri penyangga pistol/revolver (gagang sama untuk semua senjata): telapak menempel di sisi kiri gagang,
    empat jari membungkus jari tangan kanan di depan gagang (ujungnya di buku jari kanan), ibu jari menghadap depan di
    bawah ibu jari kanan. Koordinat senjata; kembali (bmesh, pusat telapak)."""
    B = bmesh.new()
    s, c_ = math.sin(TILT), math.cos(TILT)
    f = Vector((0.0, c_, -s))   # pergelangan → pangkal jari (depan, sedikit turun mengikuti gagang condong)
    t = Vector((0.0, s, c_))    # sisi ibu jari (atas, sejajar gagang)
    n = Vector((1.0, 0.0, 0.0))  # normal telapak (menghadap gagang)
    R = frame_m(f, t, n)
    P = pistol_palm()
    put(B, p_box(0.066, 0.074, 0.022, 0.0095, 2), 'glove', T(*P) @ R)
    put(B, p_box(0.044, 0.046, 0.004, 0.0015, 1), 'grip', T(*(P - n * 0.0115)) @ R)  # punggung tangan (menghadap kiri)
    # jari: pangkal di tepi depan telapak, melingkar ke depan jari tangan kanan, ujung di sisi kanan
    for i, (oz, sc) in enumerate(((0.0255, 1.0), (0.0075, 1.04), (-0.0105, 0.98), (-0.0275, 0.84))):
        r0 = 0.0093 * (1.0 if i < 3 else 0.9)
        mcp = P + f * 0.027 + t * oz + n * 0.002
        z = mcp.z
        y0 = yc(z)
        pts = [mcp, Vector((-0.0155, y0 + 0.0535, z + 0.001)), Vector((0.0075 * sc, y0 + 0.0585, z + 0.0015)),
               Vector((0.0255 * sc, y0 + 0.0495 * sc, z + 0.002))]
        finger(B, pts, r0)
        put(B, p_box(0.016, 0.016, 0.007, 0.003, 2), 'poly', T(*(mcp - n * 0.0095 - f * 0.003)) @ R)  # pelindung buku jari
    # ibu jari di bawah ibu jari kanan, sejajar slide, ujung di depan pelatuk
    rt = (0.0118, 0.0112, 0.0103, 0.0094)
    cmc = P + f * (-0.012) + t * 0.022 + n * 0.0
    th = [cmc, Vector((-0.0285, 0.004, 0.0255)), Vector((-0.0215, 0.033, 0.0365)), Vector((-0.0195, 0.0575, 0.0395))]
    put(B, p_chain(th, list(rt), 9, False, False), 'glove')
    for p_, r_ in ((th[1], rt[1] * 1.06), (th[2], rt[2] * 1.06), (th[3], rt[3])):
        put(B, p_sphere(r_, 9, 5), 'glove', T(*p_))
    ellipsoid(B, cmc.lerp(th[1], 0.4) - n * 0.003, th[1] - cmc, 0.0125, 0.023, 0.0135)
    wrist = P - f * 0.044 - n * 0.004 - t * 0.008
    arm_parts(B, wrist, ARM_L, seed=2.3, length=SLEEVE_FIT)
    return B, P


# ---------------------------------------------------------------- LOD1 (≤ 350 segitiga, warna verteks)
def build_lod1(kind):
    L = bmesh.new()

    def bx(sx, sy, sz, m, x=0, y=0, z=0, rx=0):
        put(L, p_box(sx, sy, sz), m, T(x, y, z) @ Rx(rx), smooth=False)

    def cy(r, d, m, y, z, segs=6, x=0):
        put(L, p_cyly(r, d, segs), m, T(x, y, z), smooth=False)
    if kind not in ('frag', 'smoke'):
        bx(0.03, 0.05, 0.112, 'grip' if kind not in ('revolver', 'dbs') else 'wood', 0, -0.002, -0.004, -18)
    if kind == 'pistol':
        bx(0.026, 0.182, 0.032, 'dark', 0, 0.045, 0.078)
        bx(0.023, 0.17, 0.012, 'poly', 0, 0.045, 0.056)
        bx(0.004, 0.06, 0.016, 'poly', 0, 0.055, 0.03)
        bx(0.034, 0.05, 0.007, 'poly', 0, -0.022, -0.066)
        bx(0.004, 0.02, 0.002, 'gold', 0.0134, 0.06, 0.071)
    elif kind == 'smg':
        bx(0.044, 0.28, 0.056, 'dark', 0, 0.064, 0.092)
        bx(0.04, 0.21, 0.02, 'poly', 0, 0.035, 0.056)
        cy(0.021, 0.095, 'poly', 0.2525, 0.092, 6)
        cy(0.011, 0.07, 'metal', 0.335, 0.092, 6)
        bx(0.023, 0.032, 0.17, 'dark', 0, 0.12, -0.028, 6)
        bx(0.012, 0.21, 0.035, 'metal', -0.031, 0.03, 0.089)
        bx(0.022, 0.012, 0.024, 'dark', 0, -0.055, 0.135)
        cy(0.0215, 0.006, 'gold', 0.209, 0.092, 6)
    elif kind == 'ar':
        bx(0.046, 0.28, 0.056, 'dark', 0, 0.035, 0.09)
        bx(0.022, 0.56, 0.009, 'dark', 0, 0.177, 0.122)
        bx(0.042, 0.23, 0.032, 'poly', 0, 0.02, 0.048)
        cy(0.027, 0.285, 'poly', 0.3185, 0.088, 8)
        cy(0.0275, 0.006, 'gold', 0.452, 0.088, 8)
        cy(0.009, 0.115, 'dark', 0.512, 0.088, 6)
        cy(0.012, 0.062, 'metal', 0.597, 0.088, 6)
        cy(0.015, 0.17, 'metal', -0.19, 0.088, 6)
        bx(0.042, 0.19, 0.12, 'poly', 0, -0.27, 0.058)
        bx(0.026, 0.065, 0.2, 'dark', 0, 0.12, -0.04, 10)
        bx(0.03, 0.05, 0.012, 'dark', 0, 0.034, 0.133)
        put(L, p_torus(0.02, 0.0035, 8, 4, 'Y'), 'dark', T(0, 0.036, 0.163), smooth=False)
    elif kind == 'shotgun':
        bx(0.044, 0.278, 0.068, 'dark', 0, 0.077, 0.084)
        cy(0.0125, 0.45, 'dark', 0.441, 0.102, 6)
        cy(0.0112, 0.385, 'dark', 0.4075, 0.068, 6)
        cy(0.026, 0.176, 'poly', 0.335, 0.068, 8)
        cy(0.0122, 0.016, 'gold', 0.606, 0.068, 6)
        bx(0.042, 0.33, 0.1, 'poly', 0, -0.225, 0.05, -4)
        bx(0.008, 0.1, 0.042, 'poly', -0.026, 0.09, 0.084)
    elif kind == 'sniper':
        bx(0.042, 0.33, 0.04, 'dark', 0, 0.045, 0.066)
        cy(0.0175, 0.25, 'metal', 0.035, 0.09, 6)
        cy(0.027, 0.3, 'olive', 0.365, 0.086, 8)
        cy(0.0118, 0.36, 'dark', 0.69, 0.09, 6)
        cy(0.017, 0.08, 'metal', 0.905, 0.09, 6)
        bx(0.045, 0.32, 0.12, 'olive', 0, -0.27, 0.06)
        cy(0.016, 0.3, 'dark', 0.06, SN_ZS, 8)
        cy(0.031, 0.06, 'dark', 0.24, SN_ZS, 8)
        cy(0.021, 0.04, 'dark', -0.13, SN_ZS, 8)
        bx(0.014, 0.16, 0.06, 'dark', 0, 0.04, 0.13)
        bx(0.025, 0.07, 0.06, 'dark', 0, 0.075, 0.035)
        bx(0.03, 0.01, 0.02, 'gold', 0.04, -0.035, 0.07)
    elif kind == 'lmg':
        bx(0.058, 0.33, 0.08, 'dark', 0, 0.035, 0.09)
        bx(0.05, 0.2, 0.012, 'metal', 0, 0.02, 0.137)
        cy(0.024, 0.34, 'dark', 0.37, 0.094, 8)
        cy(0.012, 0.2, 'dark', 0.64, 0.094, 6)
        cy(0.016, 0.07, 'metal', 0.765, 0.094, 6)
        bx(0.072, 0.12, 0.11, 'olive', 0, 0.09, 0.044)
        bx(0.044, 0.22, 0.1, 'poly', 0, -0.29, 0.07)
        bx(0.012, 0.16, 0.05, 'grip', 0, 0.33, 0.14)
        bx(0.09, 0.012, 0.16, 'metal', 0, 0.6, 0.0, 30)
    elif kind == 'revolver':
        bx(0.03, 0.12, 0.055, 'metal', 0, 0.015, 0.078)
        cy(0.0195, 0.044, 'metal', 0.031, 0.072, 8)
        cy(0.0105, 0.16, 'metal', 0.155, 0.088, 6)
        bx(0.02, 0.16, 0.02, 'metal', 0, 0.155, 0.074)
        bx(0.028, 0.012, 0.01, 'gold', 0, -0.055, 0.112)
    elif kind == 'burst':
        bx(0.05, 0.28, 0.066, 'poly', 0, 0.04, 0.09)
        bx(0.044, 0.22, 0.026, 'dark', 0, 0.02, 0.047)
        cy(0.029, 0.27, 'poly', 0.315, 0.088, 6)
        cy(0.0295, 0.006, 'gold', 0.448, 0.088, 6)
        cy(0.0088, 0.1, 'dark', 0.5, 0.088, 6)
        cy(0.0135, 0.06, 'metal', 0.578, 0.088, 6)
        bx(0.042, 0.24, 0.09, 'poly', 0, -0.22, 0.075)
        bx(0.045, 0.05, 0.04, 'dark', 0, 0.02, 0.155)
        bx(0.026, 0.065, 0.17, 'dark', 0, 0.11, -0.03, 6)
    elif kind == 'pdw':
        bx(0.046, 0.22, 0.064, 'dark', 0, 0.04, 0.09)
        bx(0.048, 0.1, 0.064, 'yellow', 0, 0.03, 0.089)
        cy(0.019, 0.08, 'poly', 0.2, 0.09, 6)
        cy(0.014, 0.1, 'dark', 0.29, 0.09, 6)
        bx(0.023, 0.03, 0.17, 'dark', 0, 0.1, -0.03, 4)
        bx(0.012, 0.19, 0.045, 'metal', 0, -0.16, 0.075)
        bx(0.012, 0.014, 0.065, 'yellow', 0, -0.258, 0.063)
    elif kind == 'dbs':
        bx(0.044, 0.1, 0.06, 'metal', 0, 0.01, 0.082)
        cy(0.0128, 0.56, 'dark', 0.34, 0.092, 6, x=-0.0128)
        cy(0.0128, 0.56, 'dark', 0.34, 0.092, 6, x=0.0128)
        bx(0.046, 0.22, 0.034, 'wood', 0, 0.22, 0.07)
        bx(0.043, 0.32, 0.1, 'wood', 0, -0.2, 0.05, -4)
    elif kind == 'frag':
        L.free()
        L = bmesh.new()
        put(L, p_cyl(0.031, 0.026, 0.085, 8), 'olive', T(0, 0, 0.0), smooth=False)
        put(L, p_cyl(0.011, 0.011, 0.02, 6), 'metal', T(0, 0, 0.05), smooth=False)
        put(L, p_box(0.006, 0.006, 0.06), 'gold', T(0.03, 0, 0.025), smooth=False)
    elif kind == 'smoke':
        L.free()
        L = bmesh.new()
        put(L, p_cyl(0.029, 0.029, 0.11, 8), 'canister', T(0, 0, 0), smooth=False)
        put(L, p_cyl(0.0295, 0.0295, 0.018, 8), 'olive', T(0, 0, 0.02), smooth=False)
        put(L, p_cyl(0.011, 0.011, 0.016, 6), 'metal', T(0, 0, 0.063), smooth=False)
    else:  # dmr
        bx(0.046, 0.338, 0.057, 'metal', 0, 0.043, 0.092)
        bx(0.022, 0.675, 0.009, 'dark', 0, 0.212, 0.125)
        bx(0.042, 0.25, 0.032, 'poly', 0, 0.015, 0.05)
        cy(0.029, 0.34, 'poly', 0.382, 0.092, 8)
        cy(0.01, 0.235, 'dark', 0.6675, 0.092, 6)
        cy(0.0135, 0.07, 'metal', 0.81, 0.092, 6)
        bx(0.044, 0.245, 0.13, 'poly', 0, -0.32, 0.04)
        bx(0.024, 0.07, 0.08, 'dark', 0, 0.10, 0.022)
        cy(0.0165, 0.26, 'dark', 0.06, DMR_ZS, 8)
        cy(0.025, 0.06, 'dark', 0.21, DMR_ZS, 8)
        cy(0.0205, 0.035, 'dark', -0.085, DMR_ZS, 8)
        bx(0.014, 0.14, 0.03, 'dark', 0, 0.065, 0.141)
        cy(0.0228, 0.006, 'gold', 0.226, DMR_ZS, 8)
    return L


# ---------------------------------------------------------------- objek & ekspor
def gl(p):  # Blender → glTF
    return [round(p[0], 5), round(p[2], 5), round(-p[1], 5)]


def micro_bevel(bm, width=0.00055, ang=33.0):
    """Bevel mikro pada semua tepi tajam (segmen 1): tepi menangkap kilau seperti logam/polimer sungguhan, dan bidang
    bevelnya ditandai sebagai daerah aus. Mengembalikan himpunan face bevel."""
    bm.normal_update()
    es = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > ang * D2R and e.calc_length() > width * 2.5
          and e.link_faces[0].material_index == e.link_faces[1].material_index]
    if not es:
        return set()
    try:
        r = bmesh.ops.bevel(bm, geom=es, offset=width, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    except Exception as e:
        log('bevel mikro gagal', e)
        return set()
    new = set(f for f in r.get('faces', []) if f.is_valid)
    # v6: bidang bevel mewarisi material tetangganya (Blender 5 memberi indeks 0 = 'metal' → cincin terang di optik)
    for _ in range(3):
        for f in new:
            for e in f.edges:
                o = next((g for g in e.link_faces if g is not f and g not in new), None)
                if o is not None:
                    f.material_index = o.material_index
                    break
    return new


def face_width(f):
    """Lebar pita face (2 × luas / sisi terpanjang): kecil → bidang bevel."""
    L = max((e.calc_length() for e in f.edges), default=0.0)
    return 2.0 * f.calc_area() / L if L > 1e-9 else 0.0


def make_obj(name, bm, origin=(0, 0, 0), ang=50, fin=True):
    """Objek model orang pertama. fin: bevel mikro di tepi tajam, normal berbobot luas face, dan tanda aus (atribut face
    'wear') pada bidang bevel — dipanggang ke TEXCOORD_0 oleh bake_vwx()."""
    o = Vector(origin)
    for v in bm.verts:
        v.co = v.co - o
    wl = bm.faces.layers.int.new('wear')
    if fin and not opt('--no-bevel'):
        micro_bevel(bm)
        # daerah aus = pita sempit (bidang bevel ≤ ±1,5 mm); bmesh.ops.bevel melaporkan juga face tetangga yang dibangun ulang,
        # jadi yang dipakai kriteria geometri saja
        for f in bm.faces:
            f[wl] = 1 if face_width(f) < 0.0016 else 0
    bm.normal_update()
    autosmooth(bm, ang)
    tris = tris_bm(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    used = sorted({p.material_index for p in me.polygons})
    remap = {old: k for k, old in enumerate(used)}
    for p in me.polygons:
        p.material_index = remap[p.material_index]
    for old in used:
        me.materials.append(MATS[MAT_NAMES[old]])
    ob = bpy.data.objects.new(name, me)
    ob.location = o
    bpy.context.scene.collection.objects.link(ob)
    if fin:
        try:
            md = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
            md.keep_sharp = True
            md.weight = 70
            md.mode = 'FACE_AREA'
        except Exception as e:
            log('weighted normal gagal', e)
    return ob, tris


def bake_vwx(objs, maxd=0.03, rays=12, occ=(), hot=None):
    """Oklusi ambien (sinar ke belahan bola, seluruh rakitan senjata sebagai penghalang) + tanda aus → lapisan UV 'vwx'
    (u = AO, v = aus). Diekspor sebagai TEXCOORD_0 dan dibaca web/game/weapons.js sebagai atribut `vwx`; sengaja BUKAN
    warna verteks supaya material GLB (ikon HUD, game/icons.js) tidak ikut berubah warna. occ: penghalang tambahan yang
    tidak ikut dipanggang (mis. senjata untuk tangan kiri yang menggenggamnya).
    v6 M2: aus kontinu = bidang bevel × keterbukaan (tepi yang tersembunyi di cekungan jarang tergesek) × bobot titik panas.
    hot = [((x, y, z), jari-jari)] titik yang sering tergesek (moncong, lubang lontar, liang magasin, tuas); tanpa hot
    bobotnya rata 0,8."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    V_, P_ = [], []
    for ob in list(objs) + list(occ):
        M = ob.matrix_world
        names = [m.name.split('.')[0] if m else '' for m in ob.data.materials]
        o0 = len(V_)
        V_ += [M @ v.co for v in ob.data.vertices]
        P_ += [tuple(i + o0 for i in p.vertices) for p in ob.data.polygons if names[p.material_index] != 'glass']
    bvh = BVHTree.FromPolygons(V_, P_, all_triangles=False, epsilon=0.0)
    dirs = []
    for i in range(rays):
        u = (i + 0.5) / rays
        ph = 2 * pi * ((i * 0.6180339887) % 1.0)
        r = math.sqrt(u)
        dirs.append(Vector((r * math.cos(ph), r * math.sin(ph), math.sqrt(max(0.0, 1 - u)))))
    hot = [(Vector(p), r) for p, r in hot] if hot else None

    def hotw(q):
        if hot is None:
            return 0.8
        m = 0.0
        for p, r in hot:
            t = max(0.0, 1.0 - (q - p).length / r)
            m = max(m, t * t * (3 - 2 * t))
        return 0.5 + 0.5 * m
    for ob in objs:
        me = ob.data
        M = ob.matrix_world
        N3 = M.to_3x3()
        uv = me.uv_layers.get('vwx') or me.uv_layers.new(name='vwx')
        wear = me.attributes.get('wear')
        cn = me.corner_normals
        cache = {}
        for p in me.polygons:
            w = float(wear.data[p.index].value) if wear else 0.0
            for li in p.loop_indices:
                vi = me.loops[li].vertex_index
                n = cn[li].vector
                key = (vi, round(n.x * 5), round(n.y * 5), round(n.z * 5))
                ao = cache.get(key)
                if ao is None:
                    nw = (N3 @ n).normalized()
                    q = M @ me.vertices[vi].co + nw * 0.0006
                    t = nw.orthogonal().normalized()
                    bt = nw.cross(t)
                    occ = 0.0
                    for d in dirs:
                        hit = bvh.ray_cast(q, t * d.x + bt * d.y + nw * d.z, maxd)
                        if hit[0] is not None:
                            occ += 1.0 - (hit[3] / maxd) ** 2
                    ao = (max(0.08, 1.0 - 0.9 * occ / rays), hotw(q))
                    cache[key] = ao
                uv.data[li].uv = (ao[0], w * (0.3 + 0.7 * ao[0] ** 1.5) * ao[1])


def make_vc_obj(name, bm):
    """LOD1: warna verteks (linear) dari warna material tiap face, tanpa material."""
    bm.normal_update()
    for f in bm.faces:
        f.smooth = False
    tris = tris_bm(bm)
    cols = {i: (*srgb(MAT[n]['col']), 1.0) for i, n in enumerate(MAT_NAMES)}
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for p in me.polygons:
        c = cols[p.material_index]
        for li in p.loop_indices:
            attr.data[li].color = c
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
    me.materials.clear()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, tris


def make_empty(name, p):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.02
    e.location = Vector(p)
    bpy.context.scene.collection.objects.link(e)
    return e


BUILD = {'pistol': build_pistol, 'smg': build_smg, 'ar': build_ar, 'shotgun': build_shotgun, 'dmr': build_dmr,
         'sniper': build_sniper, 'lmg': build_lmg, 'revolver': build_revolver, 'burst': build_burst, 'pdw': build_pdw, 'dbs': build_dbs}
NAMES = {'pistol': 'P9', 'smg': 'Kilat', 'ar': 'Garuda', 'shotgun': 'Badai', 'dmr': 'Elang',
         'sniper': 'Rajawali', 'lmg': 'Gempa', 'revolver': 'Kobra', 'burst': 'Petir', 'pdw': 'Lebah', 'dbs': 'Gada', 'frag': 'Granat', 'smoke': 'Asap'}


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    REST.clear()
    make_materials()
    objs, meta, fit_hands = [], {'weapons': [], 'hands': {}}, []
    only = opt('--kinds')  # iterasi cepat: --kinds ar,pistol (ekspor akhir harus tanpa opsi ini)
    only = only.split(',') if isinstance(only, str) else None
    for kind, fn in BUILD.items():
        if only and kind not in only:
            continue
        t0 = time.time()
        d = fn()
        n0 = len(objs)
        ob, tris = make_obj(kind, d['body'])
        objs.append(ob)
        w = dict(kind=kind, name=NAMES[kind], node=kind, tris=tris)
        if 'mag' in d:
            mb, top = d['mag']
            mo, mt = make_obj(kind + '_mag', mb)
            mo.location = top
            objs.append(mo)
            w['tris'] += mt
            w['mag'] = dict(node=kind + '_mag', pos=gl(top), tris=mt)
        if 'pump' in d:
            pb, pc = d['pump']
            po, pt = make_obj('shotgun_pump', pb)
            po.location = pc
            objs.append(po)
            w['tris'] += pt
            w['pump'] = dict(node='shotgun_pump', pos=gl(pc), tris=pt, travel=0.06)
        for (pn, pb, po_) in d.get('parts', []):  # bagian bergerak lain (bolt, silinder, laras patah-buka)
            ob2, t2 = make_obj(pn, pb)
            ob2.location = Vector(po_)
            objs.append(ob2)
            w['tris'] += t2
            w.setdefault('parts', []).append(dict(node=pn, pos=gl(po_), tris=t2))
        bake_vwx(objs[n0:], hot=d.get('wear'))  # AO + aus untuk seluruh rakitan senjata ini (badan, magasin, pompa, bolt, …)
        if 'buis' in d:  # v6: daun pisir lipat tegak / rebah (dipanggang dengan badan sebagai penghalang)
            for nm, bb in zip(('_buis_up', '_buis_dn'), d['buis']):
                bo_, bt_ = make_obj(kind + nm, bb)
                bake_vwx([bo_], occ=[objs[n0]])
                objs.append(bo_)
                w.setdefault('buis', {})[nm[1:]] = dict(node=kind + nm, tris=bt_)
        # tangan kiri yang dipaskan ke senjata ini (v5); <kind>_guard pindah ke pusat telapaknya
        hold = [o for o in objs[n0:] if (o.name == kind and kind not in FIT_ONLY) or o.name in FIT_HOLD.get(kind, ())]
        hl_name = 'fp_hand_l_' + HAND_L_OF.get(kind, kind)
        if kind in HAND_L_OF:  # revolver: gagang sama dengan pistol → tangan penyangga yang sama
            d['guard'] = tuple(pistol_palm())
        else:
            hb, hc = build_hand_l_pistol() if kind == 'pistol' else build_hand_l_fit(kind, hold_bvh(hold), Vector(d['guard']))
            d['guard'] = tuple(hc)
            hlo, hlt = make_obj(hl_name, hb, origin=hc, ang=50, fin=False)
            bake_vwx([hlo], maxd=0.02, rays=10, occ=hold)
            fit_hands.append(hlo)
            meta['hands'][hl_name] = dict(tris=hlt, note='tangan kiri menggenggam ' + ('gagang (dua tangan)' if kind == 'pistol' else 'pelindung tangan') + '; letakkan di <kind>_guard')
        w['handL'] = hl_name
        lo, lt = make_vc_obj(kind + '_lod1', build_lod1(kind))
        objs.append(lo)
        w['lod1'] = kind + '_lod1'
        w['lod1Tris'] = lt
        for k in ('muzzle', 'sight', 'guard'):
            objs.append(make_empty(kind + '_' + k, d[k]))
            w[k] = gl(d[k])
        w['handR'] = gl(HAND_R)
        w['sightIron'] = gl(d['sight'])
        if d.get('ironD'):  # jarak mata pisir besi (bawaan runtime 0,46: mata di belakang popor) → mata di atas sisir popor
            w['ironD'] = d['ironD']
        w['grip'] = dict(r=gl(HAND_R), l=w['guard'], lNode=hl_name)
        if 'optic' in d:  # v6: titik pasang optik di puncak rel (tengah)
            objs.append(make_empty(kind + '_optic', d['optic']))
            w['optic'] = dict(pos=gl(d['optic']), default=OPTIC_DEFAULT.get(kind), rail=[round(d['rail'][0], 4), round(d['rail'][1], 4)])
        meta['weapons'].append(w)
        log(kind, 'tris', w['tris'], 'lod1', lt, '%.1fs' % (time.time() - t0))
    for kind, fn in NADES.items():  # granat: model genggam + LOD1 (origin = pusat badan)
        d = fn()
        ob, tris = make_obj(kind, d['body'])
        objs.append(ob)
        bake_vwx([ob])
        lo, lt = make_vc_obj(kind + '_lod1', build_lod1(kind))
        objs.append(lo)
        meta.setdefault('nades', []).append(dict(kind=kind, name=NAMES[kind], node=kind, tris=tris, lod1=kind + '_lod1', lod1Tris=lt))
        log(kind, 'tris', tris, 'lod1', lt)
    if not (only and 'optics' not in only):  # v6: optik terpasang (asal = titik pasang di rel)
        meta['optics'] = {}
        for oid, fn in OPTICS.items():
            d = fn()
            ob, tris = make_obj('opt_' + oid, d['body'])
            group = [ob]
            o = dict(node='opt_' + oid, eye=gl(d['eye']), obj=gl(d['obj']), lensR=d['lensR'], objR=d['objR'], axisH=OPT_H[oid],
                     fill=d.get('fill'), relief=d.get('relief'), tris=tris)
            if d.get('win'):
                o['win'] = list(d['win'])
            if d.get('ring'):
                rb, rp = d['ring']
                ro, rt = make_obj('opt_' + oid + '_ring', rb)
                ro.location = Vector(rp)
                group.append(ro)
                o['ring'] = dict(node='opt_' + oid + '_ring', pos=gl(rp), tris=rt)
                o['tris'] += rt
            bake_vwx(group)
            objs += group
            for k in ('eye', 'obj'):
                objs.append(make_empty('opt_%s_%s' % (oid, k), d[k]))
            lo, lt = make_vc_obj('opt_' + oid + '_lod1', fn(lo=True)['body'])
            objs.append(lo)
            o['lod1'], o['lod1Tris'] = 'opt_' + oid + '_lod1', lt
            meta['optics'][oid] = o
            log('optik', oid, 'tris', o['tris'], 'lod1', lt)
    hr, tr = make_obj('fp_hand_r', build_hand_r(), ang=50)
    hr.location = HAND_R
    hl, tl = make_obj('fp_hand_l', build_hand_l(), ang=50)
    hl.location = Vector((0, 0.33, 0.044))  # contoh: di guard AR
    hn, tn = make_obj('fp_hand_nade', build_hand_nade(), ang=50)
    fa, tf = make_obj('fp_forearm', build_forearm(), ang=50)  # lengan bawah satuan (rig obat & granat di weapons.js)
    ho, to_ = make_obj('fp_hand_open', build_hand_open(), ang=50)
    for h_ in (hr, hl, hn, fa, ho):
        bake_vwx([h_], maxd=0.02, rays=10)
    objs += [hr, hl, hn, fa, ho] + fit_hands
    meta['hands'].update({'fp_hand_r': dict(tris=tr, pos=gl(HAND_R), note='letakkan node di posisi ini relatif origin senjata (sama untuk semua senjata)'),
                          'fp_hand_l': dict(tris=tl, note='genggaman umum (rig obat & granat); senjata memakai fp_hand_l_<kind> (weapons[].handL)'),
                          'fp_hand_nade': dict(tris=tn, note='tangan kanan menggenggam granat; origin = pusat badan granat'),
                          'fp_forearm': dict(tris=tf, note='lengan bawah 1 m sepanjang +Y glTF (pergelangan di +0,5), diskala ke panjang lengan'),
                          'fp_hand_open': dict(tris=to_, note='tangan terbuka: jari ke −Z glTF, ibu jari +X; origin = pusat telapak')})
    log('tangan', 'kanan', tr, 'kiri', tl, 'kiri per senjata', sum(meta['hands'][o.name]['tris'] for o in fit_hands))
    meta['version'] = 6
    meta['axes'] = 'glTF: +Y atas, laras −Z, kanan +X; origin senjata = titik genggam gagang pistol (condong 18°)'
    return objs, meta


def export(objs, meta):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, 'weapons.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_normals=True,
                              export_texcoords=True, export_tangents=False, export_cameras=False, export_lights=False,
                              export_animations=False, export_extras=False,
                              # v6: Draco (±10 MB → ±2 MB); runtime memakai DRACOLoader (CDN jsdelivr, sama dengan three)
                              export_draco_mesh_compression_enable=not opt('--no-draco'), export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=10, export_draco_color_quantization=8)
    with open(os.path.join(OUT, 'weapons.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    log('ekspor', path, os.path.getsize(path), 'byte')


# ---------------------------------------------------------------- render
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def new_mat(name, col, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(col), 1) if isinstance(col, str) else (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


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


def cam_look(loc, target, lens=50):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.sensor_width = 36
    cam = link(bpy.data.objects.new('cam', cd))
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def cycles(samples, w, h):
    """Pratinjau Cycles: CPU saja (2 thread), paling lebar 960 px, 16–32 sampel + denoise — mesin dipakai bersama pemain.
    Jalankan Blender dengan: taskpolicy -b nice -n 19 Blender -b -t 2 … (OMP_NUM_THREADS=2)."""
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.render.threads_mode = 'FIXED'
    scn.render.threads = 2
    samples = max(16, min(32, samples))
    if w > 960:
        h = int(round(h * 960 / w))
        w = 960
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.cycles.transparent_max_bounces = 16
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


def world(col=(0.05, 0.055, 0.07), strength=1.0):
    w = bpy.data.worlds.new('w')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*col, 1)
    bg.inputs['Strength'].default_value = strength
    return w


def floor_plane(col, rough=0.35, size=8):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size)
    me = bpy.data.meshes.new('floor')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(new_mat('floor', col, rough, 0.0))
    return link(bpy.data.objects.new('floor', me))


def collect(kind):
    obs = [bpy.data.objects[kind]]
    for n in (kind + '_mag', 'shotgun_pump' if kind == 'shotgun' else None, 'sniper_bolt' if kind == 'sniper' else None, 'pistol_slide' if kind == 'pistol' else None,
              'revolver_cyl' if kind == 'revolver' else None, 'dbs_brk' if kind == 'dbs' else None):
        if n and n in bpy.data.objects:
            obs.append(bpy.data.objects[n])
    return obs


REST = {}


def place(kind, M):
    """Pindahkan senjata (+ magasin/pompa) dengan matriks M (relatif origin senjata); posisi asli diingat."""
    for ob in collect(kind):
        if ob.name not in REST:
            REST[ob.name] = ob.location.copy()
        ob.matrix_world = M @ Matrix.Translation(REST[ob.name])


def place_on_floor(kind, M):
    """Rebahkan senjata (sisi kanan ke atas) lalu angkat sampai titik terendahnya menyentuh lantai z = 0."""
    place(kind, M)
    bpy.context.view_layer.update()
    zmin = min((o.matrix_world @ Vector(c)).z for o in collect(kind) for c in o.bound_box)
    place(kind, T(0, 0, -zmin + 0.0005) @ M)


def quick():
    eevee(1100, 620)
    world((0.5, 0.53, 0.6), 0.7)
    floor_plane('#6d7078', 0.6)
    area('key', (0.6, -0.9, 1.0), (0, 0.2, 0.05), 0.8, 50)
    area('fill', (-0.8, 0.4, 0.6), (0, 0.2, 0.05), 0.8, 25)
    os.makedirs(QDIR, exist_ok=True)
    for o in bpy.data.objects:
        if o.name.startswith('fp_') or o.name.endswith('_lod1'):
            o.hide_render = True
    kinds = list(BUILD)
    for k in kinds:
        place(k, T(0, 0, 0.3))
    for k in kinds:
        for o in bpy.data.objects:
            if o.type == 'MESH' and not o.name.endswith('_lod1') and not o.name.startswith('fp_hand') and o.name != 'floor':
                o.hide_render = not (o in collect(k))
        L = {'pistol': 0.25, 'smg': 0.5, 'ar': 1.0, 'shotgun': 1.1, 'dmr': 1.3}[k]
        for nm, az, el in (('side', 90, 3), ('34', 40, 22), ('rear', 160, 12)):
            a, e = az * D2R, el * D2R
            tgt = Vector((0, 0.13 * L, 0.33))
            cam_look(tgt + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * L * 1.15, tgt, 50)
            bpy.context.scene.render.filepath = os.path.join(QDIR, 'q_%s_%s.png' % (k, nm))
            bpy.ops.render.render(write_still=True)
    log('quick', QDIR)


def lineup():
    cycles(SAMPLES, 1920, 1080)
    world((0.02, 0.022, 0.03), 1.0)
    fl = floor_plane('#15161a', 0.28, 10)
    hide = [o for o in bpy.data.objects if o.name.startswith('fp_hand') or o.name.endswith('_lod1')]
    for o in hide:
        o.hide_render = True
    # senjata rebah miring di permukaan gelap (sisi kanan menghadap kamera), dua baris
    lay = {'dmr': (-0.20, 0.66, 0), 'ar': (-0.12, 0.40, 0), 'shotgun': (-0.14, 0.15, 0), 'smg': (-0.30, -0.12, 0), 'pistol': (0.22, -0.12, 0)}
    for k, (x, y, rz) in lay.items():
        place_on_floor(k, T(x, y, 0.0) @ Rz(-90 + rz) @ Ry(-90))
    area('top', (0.0, 0.2, 2.2), (0, 0.2, 0), 2.2, 220, (1, 0.97, 0.93), 1.2)
    area('key', (1.6, -1.2, 1.2), (0, 0.2, 0), 1.0, 140, (1.0, 0.92, 0.82))
    area('rim', (-1.4, 1.4, 0.8), (0, 0.2, 0), 1.6, 110, (0.75, 0.82, 1.0))
    area('gold', (-1.6, -0.8, 0.35), (0, 0.2, 0.0), 0.6, 45, (1.0, 0.75, 0.4))
    cam_look((0.02, -1.0, 1.32), (0.02, 0.24, 0.0), 40)
    os.makedirs(PREV, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'lineup.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('lineup %.1fs' % (time.time() - t0))


def lineup_v3():
    """Jajaran 11 senjata + 2 granat (preview/weapons/lineup-v3.png)."""
    cycles(SAMPLES, 2200, 1240)
    world((0.02, 0.022, 0.03), 1.0)
    floor_plane('#15161a', 0.28, 14)
    for o in bpy.data.objects:
        if o.name.startswith('fp_') or o.name.endswith('_lod1'):
            o.hide_render = True
    lay = {'sniper': (-0.95, 1.12), 'lmg': (-0.9, 0.80), 'dmr': (-0.9, 0.50), 'ar': (-0.82, 0.22), 'burst': (-0.82, -0.06),
           'shotgun': (0.5, 1.12), 'dbs': (0.5, 0.82), 'smg': (0.62, 0.50), 'pdw': (0.62, 0.22), 'pistol': (0.6, -0.06), 'revolver': (0.92, -0.06)}
    for k, (x, y) in lay.items():
        place_on_floor(k, T(x, y, 0.0) @ Rz(-90) @ Ry(-90))
    for k, (x, y) in (('frag', (1.18, 0.5)), ('smoke', (1.18, 0.24))):
        ob = bpy.data.objects[k]
        ob.matrix_world = T(x, y, 0.0) @ Ry(90) @ Matrix.Translation((0, 0, 0))
        bpy.context.view_layer.update()
        zmin = min((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
        ob.matrix_world = T(0, 0, -zmin + 0.0005) @ ob.matrix_world
    area('top', (0.0, 0.5, 2.6), (0, 0.5, 0), 2.6, 260, (1, 0.97, 0.93), 1.4)
    area('key', (1.8, -1.0, 1.4), (0, 0.5, 0), 1.2, 160, (1.0, 0.92, 0.82))
    area('rim', (-1.6, 1.8, 0.9), (0, 0.5, 0), 1.8, 120, (0.75, 0.82, 1.0))
    area('gold', (-1.8, -0.6, 0.4), (0, 0.5, 0.0), 0.7, 50, (1.0, 0.75, 0.4))
    cam_look((0.05, -1.25, 2.55), (0.05, 0.53, 0.0), 34)
    os.makedirs(PREV, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'v4-lineup.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('lineup-v3 %.1fs' % (time.time() - t0))


def fp_ar():
    """Pandangan orang pertama: AR + tangan, kamera di mata, latar luar ruang sederhana."""
    cycles(SAMPLES, 1600, 900)
    w = world((0.55, 0.68, 0.88), 1.0)
    try:  # langit fisik kalau tersedia
        nt = w.node_tree
        sky = nt.nodes.new('ShaderNodeTexSky')
        nt.links.new(sky.outputs['Color'], nt.nodes['Background'].inputs['Color'])
        nt.nodes['Background'].inputs['Strength'].default_value = 0.35
    except Exception as e:
        log('sky', e)
    g = floor_plane('#7d8a52', 0.9, 200)
    for i, (x, y, sx, sy, h, col) in enumerate(((-14, 40, 10, 8, 9, '#d8d2c4'), (12, 55, 14, 10, 14, '#c9ccd2'), (-30, 70, 12, 12, 7, '#e2dccb'),
                                               (28, 32, 8, 8, 6, '#cfc6b4'), (2, 90, 20, 10, 22, '#9fa8b8'))):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        me = bpy.data.meshes.new('b%d' % i)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(new_mat('bm%d' % i, col, 0.8))
        o = link(bpy.data.objects.new('b%d' % i, me))
        o.scale = (sx, sy, h)
        o.location = (x, y, h / 2)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4.0
    sun.angle = 0.04
    so = link(bpy.data.objects.new('sun', sun))
    so.rotation_euler = (50 * D2R, 0, 35 * D2R)
    cam = cam_look((0, 0, 1.62), (0, 10, 1.55), 30)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 24
    cam.data.lens = 24 / (2 * math.tan(54 * D2R / 2))  # FOV vertikal 54° seperti kamera senjata di game
    cam.data.clip_start = 0.01
    bpy.context.view_layer.update()
    # ruang senjata (Blender: laras +Y, atas +Z) → ruang kamera (x kanan, y atas, −z depan) = Rx(−90)
    for o in bpy.data.objects:
        if o.name.endswith('_lod1') or (o.type == 'MESH' and o.name in BUILD and o.name != 'ar') or (o.name.endswith('_mag') and o.name != 'ar_mag') or o.name == 'shotgun_pump':
            o.hide_render = True
    from mathutils import Euler
    base = cam.matrix_world @ T(0.105, -0.185, -0.50) @ Euler((0.03, 0.07, -0.04), 'XYZ').to_matrix().to_4x4() @ Rx(-90)
    place('ar', base)
    hr, hl = bpy.data.objects['fp_hand_r'], bpy.data.objects['fp_hand_l']
    hr.hide_render = hl.hide_render = False
    hr.matrix_world = base @ Matrix.Translation(HAND_R)
    hl.matrix_world = base @ Matrix.Translation((0, 0.33, 0.044))
    # lampu isi lembut dari belakang kamera supaya senjata tidak terlalu gelap
    area('fpfill', cam.matrix_world @ Vector((0.3, 0.4, 0.6)), cam.matrix_world @ Vector((0.13, -0.15, -0.4)), 0.6, 12, (1, 0.96, 0.9))
    bpy.context.scene.render.filepath = os.path.join(PREV, 'v4-fp-ar.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('fp_ar %.1fs' % (time.time() - t0))


# ---------------------------------------------------------------- v6: lembar kontak (EEVEE, cepat)
SHEET = os.path.abspath(opt('--sheet-dir', os.path.join(ROOT, 'preview', 'weapons', 'sheet')))


def sheet_setup(w=900, h=560):
    eevee(w, h)
    world((0.42, 0.44, 0.48), 0.55)
    area('key', (0.9, -1.2, 1.1), (0, 0, 0), 1.2, 60, (1, 0.97, 0.92))
    area('fill', (-1.2, -0.3, 0.5), (0, 0, 0), 1.2, 22, (0.85, 0.9, 1.0))
    area('rim', (-0.4, 1.4, 0.9), (0, 0, 0), 1.0, 40)
    os.makedirs(SHEET, exist_ok=True)


def sheet_shot(show, path, az, el, k=1.0, lens=60):
    """Render hanya objek `show` (sudah di tempatnya); kamera membidik pusat kotak batasnya dari azimut/elevasi (derajat;
    az 0 = dari belakang −Y, 90 = dari kanan +X)."""
    names = {o.name for o in show}
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o.name not in names
    bpy.context.view_layer.update()
    a, e = az * D2R, el * D2R
    fw = Vector((-math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), -math.sin(e)))  # arah pandang
    rt = fw.cross(Vector((0, 0, 1))).normalized()
    up_ = rt.cross(fw)
    pts = [o.matrix_world @ v.co for o in show for v in o.data.vertices]
    us, vs = [p.dot(rt) for p in pts], [p.dot(up_) for p in pts]
    ws = [p.dot(fw) for p in pts]
    c = rt * ((min(us) + max(us)) / 2) + up_ * ((min(vs) + max(vs)) / 2) + fw * ((min(ws) + max(ws)) / 2)
    scn = bpy.context.scene
    asp = scn.render.resolution_x / scn.render.resolution_y
    half = max((max(us) - min(us)) / 2, (max(vs) - min(vs)) / 2 * asp) * 1.06 * k  # setengah lebar bingkai
    dist = half / (18 / lens) + (max(ws) - min(ws)) / 2
    for o in [o for o in bpy.data.objects if o.type == 'CAMERA']:
        bpy.data.objects.remove(o)
    cam_look(c - fw * dist, c, lens)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def sheet_optics():
    sheet_setup()
    for oid in OPTICS:
        show = [o for o in bpy.data.objects if o.name == 'opt_' + oid or o.name == 'opt_' + oid + '_ring']
        for nm, az, el in (('34', 145, 18), ('rear', -35, 14), ('side', 90, 4)):
            sheet_shot(show, os.path.join(SHEET, 'opt_%s_%s.png' % (oid, nm)), az, el)
        lod = [o for o in bpy.data.objects if o.name == 'opt_' + oid + '_lod1']
        sheet_shot(lod, os.path.join(SHEET, 'opt_%s_lod1.png' % oid), 145, 18)
    log('lembar optik', SHEET)


def sheet_guns(kinds, optic_of=None):
    """Senjata (+ optik terpasang di titik <kind>_optic & BUIS yang sesuai): kiri, kanan, 3/4 depan, atas."""
    sheet_setup(1000, 520)
    optic_of = optic_of or {}
    for kind in kinds:
        if kind not in bpy.data.objects:
            continue
        for oid in [optic_of.get(kind)] + ([None] if optic_of.get(kind) else []):
            show = collect(kind) + [o for o in bpy.data.objects if o.name == kind + ('_buis_dn' if oid else '_buis_up')]
            if oid and kind + '_optic' in bpy.data.objects:
                mp = bpy.data.objects[kind + '_optic'].location
                for o in bpy.data.objects:
                    if o.name in ('opt_' + oid, 'opt_' + oid + '_ring'):
                        if o.name not in REST:
                            REST[o.name] = o.location.copy()
                        o.location = REST[o.name] + mp
                        show.append(o)
            tag = kind + ('_' + oid if oid else '')
            for nm, az, el in (('L', -90, 2), ('R', 90, 2), ('34', 40, 20), ('F34', 142, 16), ('top', 90, 80)):
                sheet_shot(show, os.path.join(SHEET, 'gun_%s_%s.png' % (tag, nm)), az, el, 1.0, 80)
            for o in bpy.data.objects:  # optik kembali ke asal
                if o.name.startswith('opt_') and o.name in REST:
                    o.location = REST[o.name]
    log('lembar senjata', SHEET)


def main():
    objs, meta = build_all()
    if not opt('--no-export'):
        export(objs, meta)
    if opt('--quick'):
        quick()
    if opt('--sheet'):  # v6: lembar kontak EEVEE → --sheet-dir (bawaan preview/weapons/sheet)
        what = opt('--sheet')
        what = what if isinstance(what, str) else 'optics,guns'
        if 'optics' in what:
            sheet_optics()
        if 'guns' in what:
            ks = opt('--kinds')
            ks = ks.split(',') if isinstance(ks, str) else list(BUILD)
            sheet_guns([k for k in ks if k in BUILD], {'ar': 'rds', 'burst': 'holo', 'dmr': 's8', 'sniper': 's8', 'smg': 's2', 'lmg': 's4', 'pdw': 's2'})
    if opt('--shots4'):  # pratinjau v4: preview/weapons/v4-lineup.png + v4-fp-ar.png
        objs, meta = build_all()
        lineup_v3()
        objs, meta = build_all()
        fp_ar()
    if opt('--shots3'):
        objs, meta = build_all()
        lineup_v3()
    if opt('--shots') or opt('--fp'):
        if not opt('--fp'):
            objs, meta = build_all()
            lineup()
        objs, meta = build_all()
        fp_ar()


main()
