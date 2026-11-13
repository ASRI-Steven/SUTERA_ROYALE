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


MAT_NAMES = ['metal', 'dark', 'poly', 'grip', 'gold', 'glass', 'dot', 'glove', 'sleeve', 'cuff', 'wood', 'olive', 'yellow', 'red', 'canister', 'skin']
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
        m.use_backface_culling = n not in ('glass',)
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


def trigger_group(B, y0=0.0):  # y0 < 0: pelindung lebih pendek (senapan dengan liang magasin di depan pelatuk)
    """Pelindung pelatuk + pelatuk emas di depan gagang (y0 = geser depan untuk senjata panjang)."""
    put(B, p_chain([(0, 0.024, 0.048), (0, 0.030, 0.022), (0, 0.072 + y0, 0.019), (0, 0.082 + y0, 0.032), (0, 0.083 + y0, 0.050)],
                   [0.0033] * 5, 6), 'poly')
    put(B, p_chain([(0, 0.053, 0.054), (0, 0.050, 0.044), (0, 0.044, 0.036)], [0.0032, 0.0028, 0.0024], 6), 'gold')


# ---------------------------------------------------------------- P9: pistol polimer ringkas
def build_pistol():
    B = bmesh.new()
    # slide (dark) dengan alur tarik belakang
    put(B, p_prof([(-0.047, 0.062), (0.134, 0.062), (0.137, 0.068), (0.137, 0.088), (0.132, 0.094), (-0.043, 0.094), (-0.047, 0.088)],
                  0.026, 0.003, 2), 'dark')
    for i in range(6):
        put(B, p_box(0.0272, 0.0018, 0.022), 'metal', T(0, -0.040 + i * 0.0052, 0.079))
    # lubang lontar kanan (+X) & tudung laras
    put(B, p_box(0.002, 0.032, 0.013, 0.0006), 'metal', T(0.0127, 0.028, 0.087))
    put(B, p_box(0.0012, 0.03, 0.0012), 'gold', T(0.0134, 0.06, 0.071))  # garis emas tipis di sisi slide
    put(B, p_box(0.0012, 0.03, 0.0012), 'gold', T(-0.0134, 0.06, 0.071))
    # pisir: takik belakang (2 blok), pejera depan bertitik emas
    for sx in (-1, 1):
        put(B, p_box(0.0068, 0.008, 0.0075, 0.0012), 'dark', T(sx * 0.0067, -0.040, 0.0975))
    put(B, p_box(0.0042, 0.0065, 0.0065, 0.001), 'dark', T(0, 0.127, 0.0965))
    put(B, p_sphere(0.0012, 6, 4), 'gold', T(0, 0.1235, 0.0982))
    # laras & mulut laras
    put(B, p_cyly(0.0062, 0.006, 14), 'metal', T(0, 0.140, 0.078))
    put(B, p_cyly(0.0042, 0.0006, 10), 'dark', T(0, 0.1432, 0.078))
    # rangka polimer (dust cover + rel)
    put(B, p_prof([(-0.040, 0.050), (0.132, 0.050), (0.132, 0.062), (-0.040, 0.062)], 0.0235, 0.002, 1), 'poly')
    put(B, p_prof([(0.085, 0.043), (0.128, 0.043), (0.128, 0.050), (0.085, 0.050)], 0.018, 0.001, 1), 'dark')
    for i in range(3):
        put(B, p_box(0.019, 0.003, 0.003), 'poly', T(0, 0.092 + i * 0.012, 0.0425))
    put(B, p_box(0.004, 0.012, 0.005, 0.001), 'gold', T(-0.0128, 0.036, 0.064))  # tuas slide
    put(B, grip_bm(), 'grip')
    trigger_group(B)
    # magasin (di dalam gagang; alas terlihat di bawah)
    top = Vector((0, yc(0.045), 0.045))
    M = bmesh.new()
    rings = [superellipse(0, yc(z), z, 0.0105, 0.016, 0.017, 12, 3) for z in (-0.064, 0.045)]
    merge(M, p_loft(rings), 'dark')
    put(M, p_box(0.033, 0.058, 0.007, 0.0025), 'poly', T(0, yc(-0.066) - 0.001, -0.066))
    put(M, p_box(0.0336, 0.004, 0.0074), 'gold', T(0, yc(-0.066) + 0.027, -0.066))
    for v in M.verts:
        v.co -= top
    return dict(body=B, mag=(M, top), muzzle=(0, 0.1435, 0.078), sight=(0, -0.040, 0.101), guard=(-0.026, 0.008, -0.034))


# ---------------------------------------------------------------- Kilat: SMG ringkas, popor lipat di kiri
def build_smg():
    B = bmesh.new()
    zb = 0.092
    put(B, p_prof([(-0.078, 0.064), (0.205, 0.064), (0.205, 0.116), (0.19, 0.12), (-0.07, 0.12), (-0.078, 0.112)], 0.044, 0.005, 2), 'dark')
    put(B, p_box(0.0015, 0.05, 0.016, 0.0005), 'metal', T(0.0225, 0.04, 0.096))  # lubang lontar
    side_panel(B, 0.085, 0.195, 0.071, 0.111, 0.0225, 'poly')
    side_panel(B, -0.07, -0.015, 0.074, 0.110, 0.0225, 'poly')
    put(B, p_box(0.0012, 0.105, 0.0012), 'gold', T(0.0242, 0.14, 0.069), mirror=True)
    engrave(B, 'KILAT', -0.0242, 0.14, 0.091, 0.008)
    # rel atas + alur
    put(B, p_box(0.02, 0.27, 0.007, 0.001), 'dark', T(0, 0.065, 0.1235))
    for i in range(12):
        put(B, p_box(0.021, 0.003, 0.003), 'metal', T(0, -0.06 + i * 0.022, 0.1255))
    # pisir lubang belakang & pejera depan bertelinga
    put(B, p_box(0.014, 0.008, 0.016, 0.002), 'dark', T(0, -0.055, 0.132))
    put(B, p_torus(0.0058, 0.0019, 14, 6, 'Y'), 'dark', T(0, -0.055, 0.142))
    put(B, p_box(0.018, 0.008, 0.012, 0.002), 'dark', T(0, 0.190, 0.130))
    for sx in (-1, 1):
        put(B, p_box(0.003, 0.007, 0.016, 0.0008), 'dark', T(sx * 0.0072, 0.190, 0.140))
    put(B, p_box(0.0026, 0.004, 0.012, 0.0006), 'dark', T(0, 0.190, 0.137))
    put(B, p_sphere(0.0011, 6, 4), 'gold', T(0, 0.1875, 0.1415))
    # rangka bawah polimer + liang magasin
    put(B, p_prof([(-0.07, 0.045), (0.14, 0.045), (0.14, 0.066), (-0.07, 0.066)], 0.04, 0.003, 1), 'poly')
    put(B, p_prof([(0.085, 0.02), (0.138, 0.024), (0.138, 0.066), (0.085, 0.066)], 0.038, 0.003, 1), 'poly')
    # selubung laras (8 sisi) + cincin emas, laras, kompensator
    put(B, p_cyly(0.021, 0.095, 8, flat=True), 'poly', T(0, 0.2525, zb))
    put(B, p_cyly(0.0215, 0.006, 8, flat=True), 'gold', T(0, 0.209, zb))
    for i in range(3):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.016, 0.006), 'dark', T(sx * 0.0195, 0.232 + i * 0.024, zb))
    put(B, p_cyly(0.0072, 0.045, 12), 'dark', T(0, 0.3225, zb))
    put(B, p_cyly(0.011, 0.032, 12), 'metal', T(0, 0.346, zb))
    for i in range(2):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.006, 0.006), 'dark', T(sx * 0.0095, 0.338 + i * 0.011, zb + 0.004))
    put(B, p_cyly(0.0062, 0.0008, 10), 'dark', T(0, 0.3625, zb))
    # tuas kokang kiri (emas)
    put(B, p_box(0.004, 0.06, 0.004), 'dark', T(-0.0225, 0.11, 0.103))
    put(B, p_cylx(0.0045, 0.012, 10), 'gold', T(-0.030, 0.13, 0.103))
    # popor lipat di sisi kiri (−X)
    x = -0.031
    put(B, p_box(0.012, 0.02, 0.03, 0.003), 'dark', T(-0.024, -0.072, 0.09))
    put(B, p_chain([(x, -0.07, 0.074), (x, 0.13, 0.074)], [0.0042, 0.0042], 8, False), 'metal')
    put(B, p_chain([(x, -0.07, 0.104), (x, 0.13, 0.104)], [0.0042, 0.0042], 8, False), 'metal')
    put(B, p_box(0.012, 0.016, 0.05, 0.004), 'grip', T(x, 0.138, 0.089))
    put(B, grip_bm(), 'grip')
    trigger_group(B)
    # magasin lurus, sedikit condong ke depan
    top = Vector((0, 0.111, 0.058))
    M = bmesh.new()
    rings = [superellipse(0.111 * 0 + 0, 0.111 + (0.058 - z) * math.tan(6 * D2R), z, 0.0115, 0.0165, 0.0165, 12, 3.2) for z in (-0.112, 0.058)]
    merge(M, p_loft(rings), 'dark')
    put(M, p_box(0.027, 0.04, 0.008, 0.0025), 'poly', T(0, 0.111 + 0.17 * math.tan(6 * D2R), -0.115))
    put(M, p_box(0.0276, 0.0042, 0.0084), 'gold', T(0, 0.111 + 0.17 * math.tan(6 * D2R) + 0.02, -0.115))
    for v in M.verts:
        v.co -= top
    guard = (0, 0.258, zb - 0.021 - 0.017)
    return dict(body=B, mag=(M, top), muzzle=(0, 0.3632, zb), sight=(0, -0.055, 0.142), guard=guard)


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


def build_ar():
    B = bmesh.new()
    zb = 0.088
    put(B, p_prof([(-0.106, 0.062), (0.176, 0.062), (0.176, 0.112), (0.165, 0.118), (-0.098, 0.118), (-0.106, 0.11)], 0.046, 0.004, 2), 'dark')
    put(B, p_box(0.0015, 0.058, 0.017, 0.0005), 'metal', T(0.0235, 0.045, 0.096))  # penutup lubang lontar
    put(B, p_cylx(0.0055, 0.012, 10), 'metal', T(0.028, -0.01, 0.103))  # forward assist
    put(B, p_box(0.022, 0.565, 0.0085, 0.001), 'dark', T(0, 0.1775, 0.1222))  # rel atas menerus
    for i in range(14):
        put(B, p_box(0.0225, 0.003, 0.003), 'metal', T(0, -0.09 + i * 0.04, 0.124))
    # rangka bawah + liang magasin melebar
    put(B, p_prof([(-0.092, 0.040), (-0.06, 0.032), (0.135, 0.032), (0.135, 0.064), (-0.092, 0.064)], 0.042, 0.003, 2), 'dark')
    put(B, p_prof([(0.06, 0.004), (0.132, 0.010), (0.134, 0.064), (0.06, 0.064)], 0.038, 0.003, 2), 'dark')
    put(B, p_prof([(0.056, -0.003), (0.137, 0.003), (0.137, 0.011), (0.056, 0.006)], 0.042, 0.002, 1), 'dark')  # bibir liang magasin
    put(B, p_box(0.0012, 0.05, 0.0012), 'gold', T(0.0212, 0.098, 0.016))
    lower_details(B, 0.021)
    # pelindung tangan 8 sisi + celah M-LOK + aksen emas
    put(B, p_cyly(0.027, 0.285, 8, flat=True), 'poly', T(0, 0.3185, zb))
    for i in range(4):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.032, 0.007), 'dark', T(sx * 0.0255, 0.21 + i * 0.062, zb - 0.004))
        put(B, p_box(0.009, 0.032, 0.004), 'dark', T(0, 0.21 + i * 0.062, zb - 0.0265))
    put(B, p_cyly(0.0275, 0.005, 8, flat=True), 'gold', T(0, 0.452, zb))
    put(B, p_box(0.0012, 0.2, 0.0012), 'gold', T(0.0262, 0.31, zb + 0.008))
    put(B, p_box(0.0012, 0.2, 0.0012), 'gold', T(-0.0262, 0.31, zb + 0.008))
    # laras, blok gas, rem moncong
    put(B, p_cyly(0.0085, 0.115, 12), 'dark', T(0, 0.512, zb))
    put(B, p_cyly(0.012, 0.062, 14), 'metal', T(0, 0.597, zb))
    put(B, p_cyly(0.0124, 0.004, 14), 'gold', T(0, 0.567, zb))
    for i in range(3):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.008, 0.007), 'dark', T(sx * 0.0105, 0.585 + i * 0.013, zb + 0.003))
    put(B, p_cyly(0.0065, 0.0008, 10), 'dark', T(0, 0.6285, zb))
    # tabung buffer + popor polimer dengan sandaran pipi + bantalan
    put(B, p_cyly(0.0155, 0.17, 14), 'metal', T(0, -0.19, zb))
    # popor teleskopik rangka terbuka: cangkang pipi di atas tabung, penyangga bawah miring, bantalan
    put(B, loft_y([(-0.205, zb + 0.004, 0.024, 0.021, 0.0175), (-0.235, zb + 0.008, 0.029, 0.024, 0.0195), (-0.33, zb + 0.010, 0.031, 0.026, 0.0205),
                   (-0.352, zb + 0.008, 0.031, 0.028, 0.0205)]), 'poly')
    put(B, p_chain([(0, -0.232, zb - 0.02), (0, -0.300, 0.030), (0, -0.348, 0.004)], [0.0085, 0.009, 0.0095], 10, True), 'poly')
    put(B, p_box(0.040, 0.016, 0.132, 0.006, 2), 'grip', T(0, -0.360, zb - 0.032))
    put(B, p_box(0.041, 0.003, 0.128), 'gold', T(0, -0.3515, zb - 0.032))
    put(B, p_box(0.008, 0.03, 0.006, 0.002), 'gold', T(0, -0.236, zb - 0.026))  # tuas pengatur panjang
    for sx in (-1, 1):
        put(B, p_cylx(0.006, 0.003, 12), 'metal', T(sx * 0.0205, -0.30, zb + 0.008))  # dudukan tali QD
    # tuas kokang T emas
    put(B, p_box(0.03, 0.012, 0.007, 0.002), 'gold', T(0, -0.1, 0.1145))
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.025)
    red_dot(B, 0.032, AR_DOT[2])
    engrave(B, 'GARUDA', -0.0216, 0.03, 0.047)
    # magasin melengkung (pisang)
    top = Vector((0, 0.097, 0.060))
    M = bmesh.new()
    rings = []
    for k in range(7):
        t = k / 6
        z = 0.060 - 0.205 * t
        rings.append(superellipse(0, 0.097 + 0.05 * t ** 1.6, z, 0.0122, 0.0315 + 0.003 * t, 0.0305, 12, 3.4))
    merge(M, p_loft(rings), 'dark')
    put(M, p_box(0.030, 0.07, 0.009, 0.003), 'poly', T(0, 0.097 + 0.05 + 0.002, -0.149))
    put(M, p_box(0.0305, 0.004, 0.0094), 'gold', T(0, 0.097 + 0.05 + 0.032, -0.149))
    for k in range(4):
        put(M, p_box(0.0254, 0.0025, 0.004), 'dark', T(0, 0.097 + 0.05 * ((k + 1) / 5) ** 1.6 - 0.031, 0.04 - k * 0.045))
    for v in M.verts:
        v.co -= top
    return dict(body=B, mag=(M, top), muzzle=(0, 0.6289, zb), sight=AR_DOT, guard=(0, 0.33, zb - 0.027 - 0.017))


# ---------------------------------------------------------------- Badai: shotgun pompa
def build_shotgun():
    B = bmesh.new()
    zb = 0.094
    put(B, p_prof([(-0.062, 0.050), (0.216, 0.050), (0.216, 0.108), (0.205, 0.118), (-0.05, 0.118), (-0.062, 0.108)], 0.044, 0.005, 2), 'dark')
    put(B, p_box(0.0015, 0.06, 0.02, 0.0005), 'metal', T(0.0225, 0.07, 0.09))  # lubang lontar
    side_panel(B, 0.115, 0.2, 0.058, 0.11, 0.0225, 'poly')
    engrave(B, 'BADAI', -0.0252, 0.158, 0.084, 0.0085)
    put(B, p_box(0.0012, 0.08, 0.0012), 'gold', T(0.0242, 0.158, 0.06), mirror=True)
    # pelindung panas (setengah tabung berlubang) di atas laras depan pompa
    hs = p_lathe_y([(0.0165, 0.0), (0.0165, 0.17)], 12, 0.0, 1.0, 1.0)
    for v in hs.verts:
        if v.co.z < -0.002:
            v.co.z = -0.002
    put(B, hs, 'dark', T(0, 0.445, zb + 0.008))
    for i in range(5):
        put(B, p_box(0.024, 0.016, 0.004, 0.001), 'metal', T(0, 0.462 + i * 0.032, zb + 0.008 + 0.0165))
    # rusuk atas (dari penerima sampai ujung laras), manik emas
    put(B, p_box(0.009, 0.262, 0.004, 0.001), 'dark', T(0, 0.085, 0.1200))
    put(B, p_box(0.008, 0.434, 0.004, 0.001), 'dark', T(0, 0.433, 0.1165))
    put(B, p_sphere(0.0023, 8, 6), 'gold', T(0, 0.646, 0.1208))
    # laras + tabung magasin + klem + tutup emas
    put(B, p_cyly(0.0125, 0.45, 16), 'dark', T(0, 0.441, zb + 0.008))
    put(B, p_cyly(0.0092, 0.0008, 12), 'dark', T(0, 0.6665, zb + 0.008))
    put(B, p_cyly(0.0112, 0.385, 14), 'dark', T(0, 0.4075, 0.068))
    put(B, p_cyly(0.0122, 0.016, 14), 'gold', T(0, 0.606, 0.068))
    put(B, p_box(0.027, 0.014, 0.045, 0.004), 'metal', T(0, 0.585, 0.084))
    # popor dengan sisir + bantalan
    put(B, loft_y([(-0.058, 0.083, 0.031, 0.029, 0.0205), (-0.10, 0.075, 0.034, 0.041, 0.0198), (-0.20, 0.066, 0.041, 0.058, 0.0188),
                   (-0.30, 0.059, 0.047, 0.07, 0.019), (-0.386, 0.055, 0.049, 0.073, 0.0195)], 16, 2.4), 'poly')
    put(B, p_box(0.040, 0.016, 0.122, 0.006, 2), 'grip', T(0, -0.396, 0.043))
    put(B, p_box(0.041, 0.003, 0.118), 'gold', T(0, -0.3875, 0.043))
    for sx in (-1, 1):
        put(B, p_cylx(0.006, 0.003, 12), 'metal', T(sx * 0.019, -0.34, 0.03))
    # pemegang peluru samping kiri: 4 peluru (badan merah tua, pangkal kuningan)
    put(B, p_box(0.008, 0.10, 0.042, 0.003), 'poly', T(-0.026, 0.09, 0.084))
    for i in range(4):
        put(B, p_cylx(0.0085, 0.012, 10), 'gold', T(-0.0335, 0.054 + i * 0.024, 0.084))
    put(B, grip_bm(), 'grip')
    trigger_group(B)
    # pompa (bergaris), origin di tengahnya
    pc = Vector((0, 0.335, 0.068))
    P = bmesh.new()
    prof = []
    for k in range(13):
        y = -0.088 + 0.176 * k / 12
        r = 0.0215 if k in (0, 12) else (0.0245 if k % 2 else 0.0228)
        prof.append((r, y))
    merge(P, p_lathe_y([(0.0115, -0.088)] + prof + [(0.0115, 0.088)], 14, 0.0, 1.0, 1.18), 'poly')
    put(P, p_box(0.0012, 0.15, 0.0012), 'gold', T(0.0248, 0.0, 0.0))
    put(P, p_box(0.0012, 0.15, 0.0012), 'gold', T(-0.0248, 0.0, 0.0))
    return dict(body=B, pump=(P, pc), muzzle=(0, 0.6672, zb + 0.008), sight=(0, -0.045, 0.1222), guard=(0, 0.335, 0.068 - 0.029 - 0.016))


# ---------------------------------------------------------------- Elang: DMR bertropong, bipod terlipat
DMR_ZS = 0.164


def build_dmr():
    B = bmesh.new()
    zb = 0.092
    put(B, p_prof([(-0.126, 0.064), (0.212, 0.064), (0.212, 0.116), (0.2, 0.121), (-0.118, 0.121), (-0.126, 0.113)], 0.046, 0.004, 2), 'metal')
    put(B, p_box(0.0015, 0.06, 0.018, 0.0005), 'dark', T(0.0235, 0.05, 0.097))
    put(B, p_cylx(0.0055, 0.016, 10), 'gold', T(0.03, 0.12, 0.102))  # kenop kokang kanan
    put(B, p_box(0.022, 0.675, 0.0085, 0.001), 'dark', T(0, 0.212, 0.1252))
    for i in range(15):
        put(B, p_box(0.0225, 0.003, 0.003), 'metal', T(0, -0.11 + i * 0.045, 0.127))
    engrave(B, 'ELANG', -0.0216, 0.03, 0.05)
    put(B, p_prof([(-0.11, 0.044), (-0.08, 0.034), (0.14, 0.034), (0.14, 0.066), (-0.11, 0.066)], 0.042, 0.003, 2), 'dark')
    put(B, p_prof([(0.062, 0.016), (0.135, 0.018), (0.137, 0.066), (0.062, 0.066)], 0.038, 0.003, 2), 'dark')
    lower_details(B, 0.021)
    # pelindung tangan panjang 10 sisi + aksen
    put(B, p_cyly(0.029, 0.34, 10, flat=True), 'poly', T(0, 0.382, zb))
    for i in range(5):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.034, 0.007), 'dark', T(sx * 0.0278, 0.245 + i * 0.062, zb - 0.002))
    put(B, p_cyly(0.0295, 0.005, 10, flat=True), 'gold', T(0, 0.548, zb))
    # laras beralur (6 sisi) + rem moncong
    put(B, p_cyly(0.0098, 0.235, 6), 'dark', T(0, 0.6675, zb))
    put(B, p_cyly(0.0135, 0.07, 14), 'metal', T(0, 0.81, zb))
    put(B, p_cyly(0.0139, 0.004, 14), 'gold', T(0, 0.777, zb))
    for i in range(3):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.01, 0.008), 'dark', T(sx * 0.012, 0.795 + i * 0.016, zb + 0.003))
    put(B, p_cyly(0.007, 0.0008, 10), 'dark', T(0, 0.8454, zb))
    # popor presisi: sandaran pipi bisa diatur + bantalan
    put(B, p_cyly(0.016, 0.1, 14), 'metal', T(0, -0.176, zb))
    put(B, loft_y([(-0.188, zb - 0.004, 0.026, 0.026, 0.020), (-0.24, zb - 0.010, 0.026, 0.05, 0.0205), (-0.33, zb - 0.018, 0.026, 0.083, 0.021),
                   (-0.428, zb - 0.022, 0.028, 0.092, 0.0215)], 16, 2.5), 'poly')
    for yy in (-0.27, -0.37):  # tiang sandaran pipi (bisa diatur)
        put(B, p_cyl(0.0042, 0.0042, 0.03, 10), 'metal', T(0, yy, zb + 0.022))
    put(B, loft_y([(-0.245, zb + 0.040, 0.008, 0.007, 0.017), (-0.27, zb + 0.042, 0.010, 0.008, 0.0185), (-0.39, zb + 0.042, 0.010, 0.008, 0.0185),
                   (-0.405, zb + 0.040, 0.008, 0.007, 0.017)], 14, 2.4), 'poly')
    put(B, p_cylx(0.0055, 0.008, 12), 'gold', T(0.024, -0.32, zb + 0.004))  # kenop pengatur
    put(B, p_box(0.044, 0.016, 0.13, 0.006, 2), 'grip', T(0, -0.438, zb - 0.052))
    put(B, p_box(0.045, 0.003, 0.126), 'gold', T(0, -0.4295, zb - 0.052))
    # teropong: tabung, lonceng objektif, okuler, kenop (tutup emas), cincin dudukan, lensa
    zs = DMR_ZS
    put(B, p_lathe_y([(0.0, -0.104), (0.0185, -0.104), (0.021, -0.098), (0.021, -0.072), (0.0155, -0.052), (0.0155, 0.150), (0.0255, 0.205), (0.0262, 0.236), (0.0, 0.236)], 18, zs), 'dark')
    put(B, p_cyly(0.0182, 0.002, 16), 'glass', T(0, -0.1047, zs))
    put(B, p_cyly(0.0235, 0.002, 18), 'glass', T(0, 0.2367, zs))
    put(B, p_cyly(0.0228, 0.006, 18), 'gold', T(0, 0.226, zs))
    for (px, pz, rot) in ((0, zs + 0.021, None), (0.021, zs, 'x')):
        if rot:
            put(B, p_cylx(0.0115, 0.014, 14), 'dark', T(px + 0.002, 0.07, pz))
            put(B, p_cylx(0.0118, 0.004, 14), 'gold', T(px + 0.010, 0.07, pz))
        else:
            put(B, p_cyl(0.0115, 0.0115, 0.014, 14), 'dark', T(0, 0.07, pz))
            put(B, p_cyl(0.0118, 0.0118, 0.004, 14), 'gold', T(0, 0.07, pz + 0.008))
    put(B, p_cylx(0.0085, 0.01, 12), 'dark', T(-0.019, 0.07, zs))
    for yy in (0.0, 0.13):
        put(B, p_torus(0.0175, 0.0035, 16, 5, 'Y'), 'dark', T(0, yy, zs))
        put(B, p_box(0.014, 0.014, zs - 0.13, 0.002), 'dark', T(0, yy, (zs + 0.13) / 2 - 0.004))
        put(B, p_box(0.03, 0.016, 0.008, 0.002), 'dark', T(0, yy, 0.1335))
    # bipod terlipat ke depan di bawah pelindung tangan
    put(B, p_box(0.028, 0.024, 0.014, 0.003), 'dark', T(0, 0.50, zb - 0.033))
    for sx in (-1, 1):
        put(B, p_chain([(sx * 0.010, 0.50, zb - 0.040), (sx * 0.010, 0.745, zb - 0.036)], [0.0045, 0.0040], 6, False), 'metal')
        put(B, p_sphere(0.0062, 6, 4), 'grip', T(sx * 0.010, 0.75, zb - 0.036))
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.025)
    # magasin pendek 10 butir
    top = Vector((0, 0.10, 0.062))
    M = bmesh.new()
    merge(M, p_loft([superellipse(0, 0.10, z, 0.0122, 0.035, 0.034, 12, 3.6) for z in (-0.02, 0.062)]), 'dark')
    put(M, p_box(0.030, 0.076, 0.008, 0.003), 'poly', T(0, 0.10, -0.022))
    put(M, p_box(0.0305, 0.004, 0.0084), 'gold', T(0, 0.135, -0.022))
    for v in M.verts:
        v.co -= top
    return dict(body=B, mag=(M, top), muzzle=(0, 0.8458, zb), sight=(0, -0.104, zs), guard=(0, 0.39, zb - 0.029 - 0.017))



# ================================================================ v3: senjata tambahan (Rajawali, Gempa, Kobra, Petir, Lebah, Gada)
# + granat (Granat, Asap). Kontrak sama: origin = titik genggam gagang pistol; bagian bergerak sebagai node terpisah
# (<kind>_mag, sniper_bolt, revolver_cyl, dbs_brk) dengan origin di titik putar/geraknya.
SN_ZS = 0.172


def shift(bm, o):
    for v in bm.verts:
        v.co -= Vector(o)
    return bm


def build_sniper():
    """Rajawali: senapan runduk bolt-action, sasis gelap + popor zaitun, laras berat beralur, teropong 8×."""
    B = bmesh.new()
    zb = 0.090
    put(B, p_cyly(0.0175, 0.25, 18), 'metal', T(0, 0.035, zb))  # penerima bulat
    put(B, p_box(0.0015, 0.07, 0.016, 0.0005), 'dark', T(0.0172, 0.07, zb + 0.004))  # lubang lontar kanan
    put(B, p_prof([(-0.118, 0.046), (0.215, 0.046), (0.215, 0.082), (-0.118, 0.082)], 0.042, 0.004, 2), 'dark')  # sasis
    put(B, p_box(0.0012, 0.30, 0.0012), 'gold', T(0.0212, 0.05, 0.05), mirror=True)
    engrave(B, 'RAJAWALI', -0.0216, 0.06, 0.064, 0.0075)
    put(B, p_box(0.022, 0.32, 0.008, 0.001), 'dark', T(0, 0.04, zb + 0.022))  # rel atas
    for i in range(11):
        put(B, p_box(0.0225, 0.003, 0.003), 'metal', T(0, -0.11 + i * 0.03, zb + 0.0255))
    # forend 8 sisi zaitun + celah + cincin emas
    put(B, p_cyly(0.027, 0.30, 8, flat=True), 'olive', T(0, 0.365, zb - 0.004))
    for i in range(4):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.042, 0.008), 'dark', T(sx * 0.0255, 0.265 + i * 0.066, zb - 0.006))
    put(B, p_cyly(0.0275, 0.005, 8, flat=True), 'gold', T(0, 0.514, zb - 0.004))
    # laras berat beralur (6 alur) + rem moncong berlubang
    put(B, p_cyly(0.0118, 0.36, 18), 'dark', T(0, 0.69, zb))
    for k in range(6):
        a = k * pi / 3
        put(B, p_box(0.0032, 0.24, 0.0032), 'metal', T(0.0112 * math.cos(a), 0.70, zb + 0.0112 * math.sin(a)))
    put(B, p_cyly(0.017, 0.08, 14), 'metal', T(0, 0.905, zb))
    put(B, p_cyly(0.0174, 0.004, 14), 'gold', T(0, 0.868, zb))
    for i in range(3):
        for sx in (-1, 1):
            put(B, p_box(0.004, 0.012, 0.01), 'dark', T(sx * 0.0155, 0.886 + i * 0.019, zb + 0.002))
    put(B, p_cyly(0.0075, 0.0008, 10), 'dark', T(0, 0.9455, zb))
    # popor: leher ke gagang, badan zaitun, sandaran pipi dapat diatur, bantalan karet
    put(B, loft_y([(-0.11, zb - 0.012, 0.03, 0.03, 0.021), (-0.16, zb - 0.014, 0.034, 0.05, 0.022), (-0.29, zb - 0.02, 0.036, 0.085, 0.0225),
                   (-0.43, zb - 0.024, 0.038, 0.095, 0.023)], 16, 2.6), 'olive')
    for yy in (-0.25, -0.36):
        put(B, p_cyl(0.0042, 0.0042, 0.03, 10), 'metal', T(0, yy, zb + 0.026))
    put(B, loft_y([(-0.225, zb + 0.044, 0.008, 0.007, 0.018), (-0.25, zb + 0.047, 0.011, 0.008, 0.0195), (-0.38, zb + 0.047, 0.011, 0.008, 0.0195),
                   (-0.395, zb + 0.044, 0.008, 0.007, 0.018)], 14, 2.4), 'dark')
    put(B, p_box(0.047, 0.018, 0.14, 0.006, 2), 'grip', T(0, -0.442, zb - 0.058))
    put(B, p_box(0.048, 0.003, 0.136), 'gold', T(0, -0.4325, zb - 0.058))
    put(B, p_chain([(0, -0.31, zb - 0.105), (0, -0.33, zb - 0.135)], [0.006, 0.006], 8, True), 'metal')  # monopod belakang
    # teropong 8× (tabung panjang, lonceng objektif besar, okuler, turet + tutup emas, cincin)
    zs = SN_ZS
    put(B, p_lathe_y([(0.0, -0.15), (0.019, -0.15), (0.022, -0.142), (0.022, -0.105), (0.0158, -0.08), (0.0158, 0.17), (0.031, 0.235),
                      (0.032, 0.27), (0.0, 0.27)], 20, zs), 'dark')
    put(B, p_cyly(0.0188, 0.002, 18), 'glass', T(0, -0.1505, zs))
    put(B, p_cyly(0.029, 0.002, 20), 'glass', T(0, 0.2705, zs))
    put(B, p_cyly(0.0325, 0.007, 20), 'gold', T(0, 0.258, zs))
    put(B, p_cyl(0.012, 0.012, 0.016, 14), 'dark', T(0, 0.04, zs + 0.022))
    put(B, p_cyl(0.0123, 0.0123, 0.004, 14), 'gold', T(0, 0.04, zs + 0.031))
    put(B, p_cylx(0.012, 0.016, 14), 'dark', T(0.023, 0.04, zs))
    put(B, p_cylx(0.0123, 0.004, 14), 'gold', T(0.032, 0.04, zs))
    put(B, p_cylx(0.009, 0.012, 12), 'dark', T(-0.021, 0.04, zs))
    for yy in (-0.035, 0.12):
        put(B, p_torus(0.018, 0.0036, 16, 5, 'Y'), 'dark', T(0, yy, zs))
        put(B, p_box(0.014, 0.014, zs - zb - 0.024, 0.002), 'dark', T(0, yy, (zs + zb + 0.026) / 2))
        put(B, p_box(0.03, 0.016, 0.008, 0.002), 'dark', T(0, yy, zb + 0.03))
    # bipod terlipat
    put(B, p_box(0.03, 0.026, 0.014, 0.003), 'dark', T(0, 0.48, zb - 0.036))
    for sx in (-1, 1):
        put(B, p_chain([(sx * 0.011, 0.48, zb - 0.043), (sx * 0.011, 0.74, zb - 0.038)], [0.0047, 0.0042], 6, False), 'metal')
        put(B, p_sphere(0.0064, 6, 4), 'grip', T(sx * 0.011, 0.745, zb - 0.038))
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.02)
    # bolt (node terpisah): badan di dalam penerima + tuas kanan berkenop; origin di sumbu bolt (titik putar & geser)
    bo = (0, -0.02, zb)
    BO = bmesh.new()
    put(BO, p_cyly(0.0105, 0.09, 14), 'metal', T(0, -0.035, zb))
    put(BO, p_cyly(0.0125, 0.02, 14), 'dark', T(0, -0.085, zb))
    put(BO, p_chain([(0.006, -0.025, zb), (0.03, -0.03, zb - 0.006), (0.044, -0.036, zb - 0.02)], [0.0042, 0.0038, 0.0034], 8, False), 'metal')
    put(BO, p_sphere(0.0085, 12, 8), 'gold', T(0.046, -0.037, zb - 0.023))
    shift(BO, bo)
    # magasin pendek 5 butir
    top = Vector((0, 0.075, 0.062))
    M = bmesh.new()
    merge(M, p_loft([superellipse(0, 0.075, z, 0.0125, 0.033, 0.032, 12, 3.6) for z in (0.0, 0.062)]), 'dark')
    put(M, p_box(0.031, 0.072, 0.008, 0.003), 'olive', T(0, 0.075, -0.003))
    put(M, p_box(0.0315, 0.004, 0.0084), 'gold', T(0, 0.106, -0.003))
    shift(M, top)
    return dict(body=B, mag=(M, top), parts=[('sniper_bolt', BO, bo)], muzzle=(0, 0.9455, zb), sight=(0, -0.15, zs),
                guard=(0, 0.37, zb - 0.004 - 0.027 - 0.017))


def build_lmg():
    """Gempa: senapan mesin ringan, penerima tebal, tutup pengisi, selubung laras berlubang, bipod terbuka, kotak amunisi."""
    B = bmesh.new()
    zb = 0.094
    put(B, p_prof([(-0.13, 0.05), (0.2, 0.05), (0.2, 0.124), (0.185, 0.13), (-0.12, 0.13), (-0.13, 0.12)], 0.058, 0.005, 2), 'dark')
    side_panel(B, -0.10, 0.17, 0.06, 0.118, 0.029, 'poly')
    put(B, p_box(0.0012, 0.26, 0.0012), 'gold', T(0.0302, 0.035, 0.063), mirror=True)
    engrave(B, 'GEMPA', -0.0305, 0.06, 0.09, 0.0095)
    # tutup pengisi (atas) + engsel + pisir lubang belakang
    put(B, p_box(0.05, 0.2, 0.012, 0.003), 'metal', T(0, 0.02, 0.137))
    put(B, p_cylx(0.006, 0.054, 12), 'dark', T(0, -0.08, 0.137))
    put(B, p_box(0.016, 0.01, 0.022, 0.002), 'dark', T(0, -0.06, 0.153))
    put(B, p_torus(0.0062, 0.002, 14, 6, 'Y'), 'dark', T(0, -0.06, 0.163))
    # pegangan angkut di atas laras
    put(B, p_chain([(0, 0.25, 0.115), (0, 0.27, 0.165), (0, 0.39, 0.165), (0, 0.41, 0.115)], [0.006, 0.0065, 0.0065, 0.006], 8, True), 'grip')
    # selubung laras berlubang + laras + peredam kilat + pejera depan
    put(B, p_cyly(0.024, 0.34, 14), 'dark', T(0, 0.37, zb))
    for i in range(6):
        for a in (0.6, 2.54):
            put(B, p_cylx(0.0055, 0.006, 8), 'metal', T(0.0238 * math.cos(a), 0.24 + i * 0.05, zb + 0.0238 * math.sin(a)) @ Rz(0))
    put(B, p_cyly(0.0245, 0.006, 14), 'gold', T(0, 0.205, zb))
    put(B, p_cyly(0.012, 0.2, 14), 'dark', T(0, 0.64, zb))
    put(B, p_cyly(0.016, 0.07, 12), 'metal', T(0, 0.765, zb))
    for k in range(4):
        a = k * pi / 2 + pi / 4
        put(B, p_box(0.004, 0.05, 0.004), 'dark', T(0.014 * math.cos(a), 0.775, zb + 0.014 * math.sin(a)))
    put(B, p_box(0.004, 0.008, 0.035, 0.001), 'dark', T(0, 0.70, zb + 0.03))
    put(B, p_sphere(0.0013, 6, 4), 'gold', T(0, 0.70, zb + 0.048))
    # bipod terbuka (kaki menyerong ke depan-bawah)
    put(B, p_box(0.034, 0.03, 0.016, 0.003), 'dark', T(0, 0.55, zb - 0.032))
    for sx in (-1, 1):
        put(B, p_chain([(sx * 0.012, 0.55, zb - 0.04), (sx * 0.06, 0.62, zb - 0.2)], [0.005, 0.0045], 8, False), 'metal')
        put(B, p_sphere(0.007, 8, 5), 'grip', T(sx * 0.06, 0.62, zb - 0.2))
    # pegangan depan (tangan kiri)
    put(B, p_prof([(0.2, 0.05), (0.33, 0.05), (0.33, 0.07), (0.2, 0.07)], 0.05, 0.004, 2), 'poly')
    # popor rangka
    put(B, p_cyly(0.017, 0.09, 14), 'metal', T(0, -0.17, zb))
    put(B, loft_y([(-0.19, zb, 0.026, 0.03, 0.02), (-0.24, zb + 0.004, 0.028, 0.05, 0.021), (-0.37, zb + 0.004, 0.03, 0.075, 0.022),
                   (-0.395, zb + 0.004, 0.03, 0.078, 0.022)], 14, 2.5), 'poly')
    put(B, p_box(0.046, 0.016, 0.112, 0.006, 2), 'grip', T(0, -0.403, zb - 0.023))
    put(B, p_box(0.047, 0.003, 0.108), 'gold', T(0, -0.3945, zb - 0.023))
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.02)
    # kotak amunisi 75 butir di bawah penerima (node mag) + sabuk peluru masuk ke sisi kiri
    top = Vector((0, 0.09, 0.05))
    M = bmesh.new()
    put(M, p_box(0.072, 0.12, 0.11, 0.006, 2), 'olive', T(0, 0.09, -0.006))
    put(M, p_box(0.074, 0.004, 0.11), 'gold', T(0, 0.15, -0.006))
    put(M, p_box(0.03, 0.05, 0.012, 0.003), 'dark', T(0, 0.09, 0.054))
    for i in range(5):
        put(M, p_cylx(0.0045, 0.016, 8), 'gold', T(-0.04, 0.068 + i * 0.011, 0.045))
    shift(M, top)
    return dict(body=B, mag=(M, top), muzzle=(0, 0.80, zb), sight=(0, -0.06, 0.163), guard=(0, 0.265, 0.05 - 0.017))


def build_revolver():
    """Kobra: revolver magnum, laras berlug penuh, silinder berkanal (node terpisah, origin di sumbunya)."""
    B = bmesh.new()
    zbo = 0.088  # sumbu laras = kamar atas silinder
    zc = 0.072   # sumbu silinder
    # rangka (profil samping) + jembatan atas
    put(B, p_prof([(-0.045, 0.05), (0.075, 0.05), (0.075, 0.104), (-0.035, 0.108), (-0.05, 0.096)], 0.03, 0.004, 2), 'metal')
    put(B, p_box(0.031, 0.05, 0.022), 'dark', T(0, 0.031, 0.072))  # jendela silinder (gelap, silinder di depannya)
    put(B, p_box(0.0012, 0.1, 0.0012), 'gold', T(0.0156, 0.02, 0.098), mirror=True)
    # palu + tuas pelepas silinder kiri
    put(B, p_chain([(0, -0.04, 0.1), (0, -0.056, 0.114), (0, -0.064, 0.12)], [0.005, 0.0045, 0.0055], 8, True), 'dark')
    put(B, p_box(0.004, 0.014, 0.008, 0.001), 'gold', T(-0.0165, -0.02, 0.09))
    # laras + lug penuh + rusuk berventilasi + pejera
    put(B, p_cyly(0.0105, 0.16, 16), 'metal', T(0, 0.155, zbo))
    put(B, p_box(0.02, 0.16, 0.022, 0.005), 'metal', T(0, 0.155, zbo - 0.014))
    put(B, p_box(0.008, 0.16, 0.006, 0.001), 'dark', T(0, 0.155, zbo + 0.012))
    for i in range(5):
        put(B, p_box(0.0085, 0.012, 0.003), 'metal', T(0, 0.09 + i * 0.03, zbo + 0.0155))
    put(B, p_box(0.004, 0.012, 0.012, 0.001), 'dark', T(0, 0.226, zbo + 0.018))
    put(B, p_sphere(0.0015, 6, 4), 'gold', T(0, 0.222, zbo + 0.025))
    for sx in (-1, 1):
        put(B, p_box(0.004, 0.008, 0.008, 0.001), 'dark', T(sx * 0.005, -0.03, 0.111))
    put(B, p_cyly(0.0065, 0.0008, 10), 'dark', T(0, 0.2355, zbo))
    engrave(B, 'KOBRA', -0.0156, 0.15, zbo - 0.014, 0.0075)
    put(B, grip_bm(), 'wood')
    put(B, p_box(0.0315, 0.012, 0.012, 0.002), 'gold', T(0, yc(-0.06), -0.062))  # dop gagang
    trigger_group(B)
    # silinder 6 kamar berkanal (node terpisah)
    co = (0, 0.031, zc)
    C = bmesh.new()
    put(C, p_cyly(0.0195, 0.044, 24), 'metal', T(0, 0.031, zc))
    for k in range(6):
        a = k * pi / 3 + pi / 6
        put(C, p_box(0.004, 0.03, 0.004), 'dark', T(0.0188 * math.cos(a), 0.031, zc + 0.0188 * math.sin(a)))
        b = k * pi / 3 + pi / 2
        put(C, p_cyly(0.0048, 0.002, 10), 'dark', T(0.0118 * math.cos(b), 0.0535, zc + 0.0118 * math.sin(b)))
        put(C, p_cyly(0.0042, 0.002, 10), 'gold', T(0.0118 * math.cos(b), 0.0085, zc + 0.0118 * math.sin(b)))
    shift(C, co)
    return dict(body=B, parts=[('revolver_cyl', C, co)], muzzle=(0, 0.2355, zbo), sight=(0, -0.03, 0.111), guard=(-0.026, 0.008, -0.034))


def build_burst():
    """Petir: senapan semburan 3 butir, cangkang bersudut, pisir holografik berbingkai."""
    B = bmesh.new()
    zb = 0.088
    put(B, p_prof([(-0.1, 0.058), (0.18, 0.058), (0.19, 0.1), (0.17, 0.124), (-0.08, 0.124), (-0.1, 0.112)], 0.05, 0.006, 2), 'poly')
    put(B, p_prof([(-0.09, 0.034), (0.135, 0.034), (0.135, 0.06), (-0.09, 0.06)], 0.044, 0.003, 2), 'dark')
    put(B, p_prof([(0.06, 0.004), (0.132, 0.01), (0.134, 0.06), (0.06, 0.06)], 0.04, 0.003, 2), 'dark')
    side_panel(B, 0.0, 0.15, 0.07, 0.112, 0.0255, 'dark')
    put(B, p_box(0.0012, 0.2, 0.0012), 'gold', T(0.0262, 0.06, 0.066), mirror=True)
    engrave(B, 'PETIR', -0.0266, 0.07, 0.092, 0.0085)
    put(B, p_box(0.022, 0.26, 0.008, 0.001), 'dark', T(0, 0.04, 0.128))
    for i in range(8):
        put(B, p_box(0.0225, 0.003, 0.003), 'metal', T(0, -0.07 + i * 0.03, 0.130))
    # pelindung tangan heksagonal + aksen emas zig-zag (petir)
    put(B, p_cyly(0.029, 0.27, 6, flat=True), 'poly', T(0, 0.315, zb))
    for i in range(3):
        put(B, p_box(0.0012, 0.05, 0.0012), 'gold', T(0.0282, 0.22 + i * 0.07, zb + (0.008 if i % 2 else -0.008)) @ Rx(18 if i % 2 else -18), mirror=True)
    put(B, p_cyly(0.0295, 0.006, 6, flat=True), 'gold', T(0, 0.448, zb))
    put(B, p_cyly(0.0088, 0.1, 12), 'dark', T(0, 0.5, zb))
    put(B, p_cyly(0.0135, 0.06, 6), 'metal', T(0, 0.578, zb))
    put(B, p_cyly(0.0068, 0.0008, 10), 'dark', T(0, 0.6085, zb))
    # popor tetap bersudut
    put(B, p_prof([(-0.1, 0.06), (-0.1, 0.12), (-0.33, 0.118), (-0.35, 0.03), (-0.31, 0.02), (-0.2, 0.055)], 0.042, 0.006, 2), 'poly')
    put(B, p_box(0.044, 0.016, 0.1, 0.005, 2), 'grip', T(0, -0.352, 0.072))
    put(B, p_box(0.045, 0.003, 0.096), 'gold', T(0, -0.344, 0.072))
    # pisir holografik: alas, kotak bingkai terbuka, kaca, titik
    zs = 0.165
    put(B, p_box(0.03, 0.06, 0.012, 0.002), 'dark', T(0, 0.02, 0.137))
    for sx in (-1, 1):
        put(B, p_box(0.006, 0.05, 0.034, 0.002), 'dark', T(sx * 0.0195, 0.02, zs - 0.004))
    put(B, p_box(0.045, 0.05, 0.006, 0.002), 'dark', T(0, 0.02, zs + 0.016))
    put(B, p_box(0.028, 0.002, 0.026), 'glass', T(0, 0.042, zs))
    put(B, p_sphere(0.0011, 8, 4), 'dot', T(0, 0.042, zs))
    put(B, grip_bm(), 'grip')
    trigger_group(B, -0.025)
    top = Vector((0, 0.097, 0.060))
    M = bmesh.new()
    merge(M, p_loft([superellipse(0, 0.097 + 0.02 * t, 0.06 - 0.17 * t, 0.012, 0.031, 0.03, 12, 3.4) for t in (0, 0.5, 1)]), 'dark')
    put(M, p_box(0.03, 0.068, 0.009, 0.003), 'poly', T(0, 0.117, -0.112))
    put(M, p_box(0.0305, 0.004, 0.0094), 'gold', T(0, 0.146, -0.112))
    shift(M, top)
    return dict(body=B, mag=(M, top), muzzle=(0, 0.6085, zb), sight=(0, 0.042, zs), guard=(0, 0.31, zb - 0.029 - 0.017))


def build_pdw():
    """Lebah: senjata pertahanan diri ringkas, garis kuning-hitam, pisir refleks mungil, popor kawat."""
    B = bmesh.new()
    zb = 0.09
    put(B, p_prof([(-0.07, 0.056), (0.15, 0.056), (0.165, 0.09), (0.15, 0.12), (-0.06, 0.12), (-0.07, 0.11)], 0.046, 0.007, 2), 'dark')
    for i in range(3):
        put(B, p_box(0.0475, 0.018, 0.064, 0.002), 'yellow', T(0, -0.02 + i * 0.05, 0.089))
    put(B, p_box(0.02, 0.2, 0.007, 0.001), 'dark', T(0, 0.04, 0.124))
    put(B, p_cyly(0.019, 0.08, 8, flat=True), 'poly', T(0, 0.2, zb))
    put(B, p_cyly(0.0195, 0.005, 8, flat=True), 'yellow', T(0, 0.162, zb))
    put(B, p_cyly(0.014, 0.1, 14), 'dark', T(0, 0.29, zb))  # peredam pendek
    for i in range(3):
        put(B, p_cyly(0.0145, 0.004, 14), 'yellow' if i == 1 else 'metal', T(0, 0.255 + i * 0.03, zb))
    put(B, p_cyly(0.007, 0.0008, 10), 'dark', T(0, 0.3405, zb))
    put(B, p_prof([(-0.06, 0.04), (0.13, 0.04), (0.13, 0.058), (-0.06, 0.058)], 0.04, 0.003, 1), 'poly')
    put(B, p_prof([(0.07, 0.018), (0.128, 0.022), (0.128, 0.058), (0.07, 0.058)], 0.036, 0.003, 1), 'poly')
    # pisir refleks mungil
    zs = 0.145
    put(B, p_box(0.024, 0.04, 0.01, 0.002), 'dark', T(0, 0.01, 0.13))
    put(B, p_torus(0.0145, 0.0026, 22, 6, 'Y'), 'dark', T(0, 0.012, zs))
    put(B, p_cyly(0.0145, 0.002, 22), 'glass', T(0, 0.012, zs))
    put(B, p_sphere(0.001, 8, 4), 'dot', T(0, 0.012, zs))
    # popor kawat lipat
    for zz0, zz1 in ((0.07, 0.045), (0.11, 0.085)):  # popor kawat menurun ke bahu (tidak menghalangi bidikan)
        put(B, p_chain([(0, -0.07, zz0), (0, -0.25, zz1)], [0.004, 0.004], 8, False), 'metal')
    put(B, p_box(0.012, 0.014, 0.065, 0.004), 'yellow', T(0, -0.258, 0.063))
    put(B, grip_bm(), 'grip')
    trigger_group(B)
    top = Vector((0, 0.1, 0.056))
    M = bmesh.new()
    merge(M, p_loft([superellipse(0, 0.1 + (0.056 - z) * math.tan(4 * D2R), z, 0.0115, 0.016, 0.016, 12, 3.2) for z in (-0.12, 0.056)]), 'dark')
    put(M, p_box(0.027, 0.04, 0.008, 0.0025), 'yellow', T(0, 0.1 + 0.176 * math.tan(4 * D2R), -0.123))
    shift(M, top)
    return dict(body=B, mag=(M, top), muzzle=(0, 0.3405, zb), sight=(0, 0.012, zs), guard=(0, 0.2, zb - 0.019 - 0.017))


def build_dbs():
    """Gada: shotgun laras ganda berdampingan, kayu & baja berukir; laras+forend patah-buka (node dbs_brk, origin di engsel)."""
    B = bmesh.new()
    zb = 0.092
    # rangka aksi (baja, ukiran emas), tuas atas
    put(B, p_prof([(-0.04, 0.052), (0.06, 0.052), (0.06, 0.112), (-0.03, 0.112), (-0.04, 0.1)], 0.044, 0.006, 2), 'metal')
    for sx in (-1, 1):
        put(B, p_torus(0.012, 0.0012, 18, 4, 'X'), 'gold', T(sx * 0.0222, 0.01, 0.08))
    put(B, p_box(0.008, 0.035, 0.006, 0.002), 'dark', T(0.006, -0.025, 0.115) @ Rz(-12))
    engrave(B, 'GADA', -0.0222, 0.035, 0.068, 0.0085)
    # popor kayu lurus + pelat pantat
    put(B, loft_y([(-0.04, 0.08, 0.026, 0.03, 0.021), (-0.1, 0.072, 0.026, 0.045, 0.021), (-0.24, 0.058, 0.028, 0.075, 0.0215),
                   (-0.36, 0.05, 0.03, 0.085, 0.022)], 16, 2.6), 'wood')  # popor menurun (pipi di bawah garis bidik)
    put(B, p_box(0.045, 0.012, 0.115, 0.005, 2), 'dark', T(0, -0.366, 0.0075))
    put(B, grip_bm(), 'wood')
    trigger_group(B)
    # laras ganda + rusuk + manik + forend kayu (node patah-buka, origin di engsel)
    ho = (0, 0.058, 0.06)
    BR = bmesh.new()
    for sx in (-1, 1):
        put(BR, p_cyly(0.0128, 0.56, 18), 'dark', T(sx * 0.0128, 0.34, zb))
        put(BR, p_cyly(0.0095, 0.0008, 12), 'dark', T(sx * 0.0128, 0.6205, zb))
    put(BR, p_box(0.006, 0.56, 0.006, 0.001), 'metal', T(0, 0.34, zb + 0.0125))
    put(BR, p_sphere(0.0022, 8, 5), 'gold', T(0, 0.612, zb + 0.017))
    put(BR, p_box(0.03, 0.04, 0.03, 0.004), 'metal', T(0, 0.08, zb - 0.01))  # blok sungsang
    put(BR, loft_y([(0.11, zb - 0.02, 0.012, 0.022, 0.023), (0.16, zb - 0.022, 0.012, 0.026, 0.025), (0.3, zb - 0.022, 0.012, 0.026, 0.025),
                    (0.33, zb - 0.02, 0.012, 0.02, 0.022)], 14, 2.6), 'wood')
    put(BR, p_cyly(0.0262, 0.006, 16), 'gold', T(0, 0.48, zb))
    shift(BR, ho)
    return dict(body=B, parts=[('dbs_brk', BR, ho)], muzzle=(0, 0.6205, zb), sight=(0, -0.02, 0.124), guard=(0, 0.23, zb - 0.022 - 0.026 - 0.017))


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
    return set(f for f in r.get('faces', []) if f.is_valid)


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


def bake_vwx(objs, maxd=0.03, rays=12):
    """Oklusi ambien (sinar ke belahan bola, seluruh rakitan senjata sebagai penghalang) + tanda aus → lapisan UV 'vwx'
    (u = AO, v = aus). Diekspor sebagai TEXCOORD_0 dan dibaca web/game/weapons.js sebagai atribut `vwx`; sengaja BUKAN
    warna verteks supaya material GLB (ikon HUD, game/icons.js) tidak ikut berubah warna."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    V_, P_ = [], []
    for ob in objs:
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
                    ao = max(0.08, 1.0 - 0.9 * occ / rays)
                    cache[key] = ao
                uv.data[li].uv = (ao, w)


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
    objs, meta = [], {'weapons': [], 'hands': {}}
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
        bake_vwx(objs[n0:])  # AO + aus untuk seluruh rakitan senjata ini (badan, magasin, pompa, bolt, …)
        lo, lt = make_vc_obj(kind + '_lod1', build_lod1(kind))
        objs.append(lo)
        w['lod1'] = kind + '_lod1'
        w['lod1Tris'] = lt
        for k in ('muzzle', 'sight', 'guard'):
            objs.append(make_empty(kind + '_' + k, d[k]))
            w[k] = gl(d[k])
        w['handR'] = gl(HAND_R)
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
    hr, tr = make_obj('fp_hand_r', build_hand_r(), ang=50)
    hr.location = HAND_R
    hl, tl = make_obj('fp_hand_l', build_hand_l(), ang=50)
    hl.location = Vector((0, 0.33, 0.044))  # contoh: di guard AR
    hn, tn = make_obj('fp_hand_nade', build_hand_nade(), ang=50)
    fa, tf = make_obj('fp_forearm', build_forearm(), ang=50)  # lengan bawah satuan (rig obat & granat di weapons.js)
    ho, to_ = make_obj('fp_hand_open', build_hand_open(), ang=50)
    for h_ in (hr, hl, hn, fa, ho):
        bake_vwx([h_], maxd=0.02, rays=10)
    objs += [hr, hl, hn, fa, ho]
    meta['hands'] = {'fp_hand_r': dict(tris=tr, pos=gl(HAND_R), note='letakkan node di posisi ini relatif origin senjata (sama untuk semua senjata)'),
                     'fp_hand_l': dict(tris=tl, note='letakkan di <kind>_guard (pusat telapak)'),
                     'fp_hand_nade': dict(tris=tn, note='tangan kanan menggenggam granat; origin = pusat badan granat'),
                     'fp_forearm': dict(tris=tf, note='lengan bawah 1 m sepanjang +Y glTF (pergelangan di +0,5), diskala ke panjang lengan'),
                     'fp_hand_open': dict(tris=to_, note='tangan terbuka: jari ke −Z glTF, ibu jari +X; origin = pusat telapak')}
    log('tangan', 'kanan', tr, 'kiri', tl)
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
                              export_animations=False, export_extras=False, export_draco_mesh_compression_enable=False)
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
    for n in (kind + '_mag', 'shotgun_pump' if kind == 'shotgun' else None, 'sniper_bolt' if kind == 'sniper' else None,
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


def main():
    objs, meta = build_all()
    if not opt('--no-export'):
        export(objs, meta)
    if opt('--quick'):
        quick()
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
