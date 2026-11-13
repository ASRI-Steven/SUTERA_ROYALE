"""Sutera Royale: kendaraan orisinal, dimodelkan prosedural di Blender (headless).

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/vehicles.py -- [opsi]

Opsi:
  --only lintas,walet   hanya kendaraan tertentu (lintas, banteng, walet, loop)
  --no-export           lewati ekspor GLB + manifest
  --quick               render cek cepat (EEVEE, 4 sudut) ke --qdir
  --shots               render preview per kendaraan (Cycles) ke preview/vehicles/<id>.png
  --lineup              render preview/vehicles/lineup.png + colors.png (dari GLB yang sudah diekspor)
  --turntable           render preview/vehicles/turntable.mp4 (EEVEE)
  --samples N           sampel Cycles (default 160)

Kontrak GLB (dipakai web/game/vehicles.js):
  - depan = +Z glTF (−Y Blender), atas = +Y, kanan kendaraan = −X, kiri = +X;
  - origin di tanah (bawah ban y=0), tengah kiri-kanan, tengah antara as depan dan belakang;
  - node: body, wheel_fl/wheel_fr/wheel_rl/wheel_rr (skuter: wheel_f, wheel_r, steer) dengan origin di pusat roda,
    rotasi 0, skala 1, as roda = sumbu X lokal;
  - empty: seat_driver (panggul pengemudi), eye_driver, exit_l (+X), exit_r (−X), exhaust, light_fl/light_fr
    (skuter: light_f), seat_p1.. (penumpang);
  - material: paint, paint2, glass, tire, rim, chrome, trim, interior, seat, light_head, light_tail, light_ind, plate.
Mobil Indonesia setir kanan: kursi pengemudi di sisi kanan (−X), jadi pintu pengemudi = exit_r.

Semua geometri ditulis di "ruang desain" (depan +Y, kanan +X, atas +Z) lalu diputar 180° di sumbu Z saat dijadikan
objek, sehingga hasilnya menghadap −Y Blender (= +Z glTF).

v3 (model realistis; dipakai juga oleh vehicles2.py):
  - roda v3 (wheel_v3): ban ber-UV (peta normal tapak di game), tong velg, jari-jari berbevel, cakram rem, mur roda;
    kaliper statis di badan (add_calipers); lampu sungguhan (round_lamp: ember + reflektor + kaca cembung; lamp_cut /
    lamp_fill / skin_patch: rongga krom berkaca mengikuti bodi); pelat nomor berhuruf (plate_bm); kabin (seat_bm,
    steering_bm, dash_bm). Material tambahan: lens, lens_red, disc, caliper, text, screen.
  - make_obj(): normal berbobot luas face; finish_v3(): oklusi ambien per sudut face → COLOR_0 (R = AO), dibaca
    web/game/vehicles.js sebagai atribut `vao`.
  - make_lod1(): seluruh kendaraan disederhanakan (±5.000 segitiga) → node lod1_paint, lod1_glass, lod1_rest (warna
    verteks = albedo × AO); di game digabung jadi SATU mesh dan dipakai > ±60 m.
  - Manifest: lod1, trisLod1, cabin, dirt, gaps (garis celah panel: bidang di ruang objek, digambar shader game —
    lihat gaps_gl()).
  - Opsi tambahan: --fast (AO kasar untuk iterasi), --no-lod, --preview-only (tanpa AO/LOD, hanya untuk --shots),
    --tag v3 (nama berkas pratinjau v3-<id>.png). Render: Cycles CPU 2 thread, ≤ 960 px, 16–32 sampel.
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
OUT = os.path.abspath(opt('--out', os.path.join(ROOT, 'web', 'game', 'assets', 'vehicles')))
PREV = os.path.abspath(opt('--preview', os.path.join(ROOT, 'preview', 'vehicles')))
QDIR = os.path.abspath(opt('--qdir', PREV))
ONLY = opt('--only')
ONLY = ONLY.split(',') if isinstance(ONLY, str) else None
SAMPLES = int(opt('--samples', 160))

pi = math.pi
D2R = pi / 180
ROT = Matrix.Rotation(pi, 4, 'Z')  # ruang desain → kontrak


def log(*a):
    print('[veh]', *a, flush=True)


# ---------------------------------------------------------------- material
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MAT_NAMES = ['paint', 'paint2', 'glass', 'tire', 'rim', 'chrome', 'trim', 'interior', 'seat', 'light_head', 'light_tail',
             'light_ind', 'plate', 'lens', 'lens_red', 'disc', 'caliper', 'text', 'screen']
MI = {n: i for i, n in enumerate(MAT_NAMES)}
BASE = {
    'paint': dict(col='#b3202a', metal=0.2, rough=0.35, coat=0.7),
    'paint2': dict(col='#141418', metal=0.1, rough=0.4, coat=0.5),
    'glass': dict(col='#0a0f15', metal=0.0, rough=0.3, coat=1.0, alpha=0.72),
    'tire': dict(col='#161617', metal=0.0, rough=0.8),
    'rim': dict(col='#c3c7cd', metal=0.85, rough=0.32),
    'chrome': dict(col='#e6e8ec', metal=1.0, rough=0.3),
    'trim': dict(col='#1b1c20', metal=0.05, rough=0.6),
    'interior': dict(col='#232328', metal=0.0, rough=0.8),
    'seat': dict(col='#38333f', metal=0.0, rough=0.8),
    'light_head': dict(col='#f5f5f5', metal=0.0, rough=0.3, em='#fff3d8', ems=2.0),
    'light_tail': dict(col='#5c0a0a', metal=0.0, rough=0.3, em='#ff2a1e', ems=1.6),
    'light_ind': dict(col='#a86400', metal=0.0, rough=0.3, em='#ff9c1a', ems=1.3),
    'plate': dict(col='#e7e7e2', metal=0.0, rough=0.5),
    # v3: kaca lampu bening / merah, cakram rem, kaliper, huruf pelat
    'lens': dict(col='#eef2f5', metal=0.0, rough=0.04, coat=1.0, alpha=0.16),
    'lens_red': dict(col='#a80f0f', metal=0.0, rough=0.06, coat=1.0, alpha=0.62),
    'disc': dict(col='#8f9196', metal=1.0, rough=0.36),
    'caliper': dict(col='#c8102e', metal=0.2, rough=0.35, coat=0.6),
    'text': dict(col='#0f0f11', metal=0.0, rough=0.6),
    'screen': dict(col='#0b1a24', metal=0.0, rough=0.15, em='#49c6ff', ems=0.9),  # layar panel instrumen / hiburan
}
MATS = {}


def make_materials(over):
    MATS.clear()
    for n in MAT_NAMES:
        d = dict(BASE[n])
        d.update(over.get(n, {}))
        m = bpy.data.materials.new(n)
        try:
            m.use_nodes = True
        except Exception:
            pass
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (*srgb(d['col']), 1)
        b.inputs['Metallic'].default_value = d['metal']
        b.inputs['Roughness'].default_value = d['rough']
        b.inputs['Coat Weight'].default_value = d.get('coat', 0.0)
        b.inputs['Coat Roughness'].default_value = 0.06
        if 'alpha' in d:
            b.inputs['Alpha'].default_value = d['alpha']
            m.surface_render_method = 'BLENDED'
        if 'em' in d:
            b.inputs['Emission Color'].default_value = (*srgb(d['em']), 1)
            b.inputs['Emission Strength'].default_value = d['ems']
        m.use_backface_culling = True
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


def MX():  # cermin kiri-kanan
    return Matrix.Diagonal((-1, 1, 1, 1))


# ---------------------------------------------------------------- bmesh helpers
UV_NAME = 'UVMap'


def uv_layer(bm):
    return bm.loops.layers.uv.get(UV_NAME) or bm.loops.layers.uv.new(UV_NAME)


def merge(dst, src, mat=None, M=None, smooth=None):
    """Salin geometri src ke dst (src dibebaskan). mat = nama material untuk semua face (kalau None, ikut src).
    UV (kalau src punya) ikut disalin: dipakai ban (peta normal tapak)."""
    flip = M is not None and M.to_3x3().determinant() < 0
    suv = src.loops.layers.uv.active
    duv = uv_layer(dst) if suv is not None else None
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(M @ v.co if M is not None else v.co.copy())
    mi = MI[mat] if mat else None
    out = []
    for f in src.faces:
        vs = [vmap[v] for v in f.verts]
        uvs = [l[suv].uv.copy() for l in f.loops] if suv is not None else None
        if flip:
            vs.reverse()
            if uvs:
                uvs.reverse()
        try:
            nf = dst.faces.new(vs)
        except ValueError:
            continue
        if uvs:
            for l, q in zip(nf.loops, uvs):
                l[duv].uv = q
        nf.material_index = f.material_index if mi is None else mi
        nf.smooth = f.smooth if smooth is None else smooth
        out.append(nf)
    src.free()
    return out


def put(dst, src, mat, M=None, mirror=False, smooth=True):
    """merge + opsional salinan cermin (−X)."""
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
    """Silinder/kerucut di sumbu Z, berpusat di origin."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    return bm


def p_cylx(r, depth, segs=16, caps=True):
    """Silinder di sumbu X."""
    bm = p_cyl(r, r, depth, segs, caps)
    bmesh.ops.transform(bm, matrix=Ry(90), verts=bm.verts)
    return bm


def p_cyly(r, depth, segs=16, caps=True):
    bm = p_cyl(r, r, depth, segs, caps)
    bmesh.ops.transform(bm, matrix=Rx(90), verts=bm.verts)
    return bm


def p_sphere(r, u=12, v=6):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    return bm


def p_tube(a, b, r, segs=8, caps=True):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = p_cyl(r, r, d.length, segs, caps)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=T(*((a + b) / 2)) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def p_path(points, r, segs=8, joints=True):
    bm = bmesh.new()
    for i in range(len(points) - 1):
        merge(bm, p_tube(points[i], points[i + 1], r, segs, caps=(not joints) or i in (0, len(points) - 2)))
    if joints:
        for p in points[1:-1]:
            merge(bm, p_sphere(r * 1.0, segs, max(4, segs // 2)), M=T(*p))
    return bm


def p_torus(R, r, segs=24, rsegs=8):
    """Torus di bidang XY (sumbu Z)."""
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
    return bm


def p_lathe(prof, segs, a0=0.0, a1=2 * pi, closed_prof=False, rfun=None, cap_ends=False):
    """Putar profil [(r, x)] mengelilingi sumbu X. Sudut t: 0 = +Y (depan), 90° = +Z (atas)."""
    bm = bmesh.new()
    full = abs((a1 - a0) - 2 * pi) < 1e-6
    nrow = segs if full else segs + 1
    grid = []
    for i in range(nrow):
        t = a0 + (a1 - a0) * i / segs
        c, s = math.cos(t), math.sin(t)
        row = []
        for k, (r, x) in enumerate(prof):
            rr = rfun(i, k, r) if rfun else r
            row.append(bm.verts.new((x, rr * c, rr * s)))
        grid.append(row)
    n = len(prof)
    kmax = n if closed_prof else n - 1
    for i in range(segs):
        A = grid[i]
        B = grid[(i + 1) % nrow] if full else grid[i + 1]
        for k in range(kmax):
            k2 = (k + 1) % n
            try:
                bm.faces.new((A[k], A[k2], B[k2], B[k]))
            except ValueError:
                pass
    if cap_ends and not full and closed_prof:
        bm.faces.new(grid[0])
        bm.faces.new(list(reversed(grid[-1])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return bm


def orient(bm, fn):
    """Balik face yang normalnya tidak searah fn(center) (untuk permukaan terbuka)."""
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(fn(f.calc_center_median())) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.normal_update()


def p_loft(rings, cap0=True, cap1=True):
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    grid = []
    for i in range(len(rings) - 1):
        row = []
        for j in range(n):
            j2 = (j + 1) % n
            row.append(bm.faces.new((vr[i][j], vr[i][j2], vr[i + 1][j2], vr[i + 1][j])))
        grid.append(row)
    caps = []
    if cap0:
        caps.append(bm.faces.new(vr[0]))
    if cap1:
        caps.append(bm.faces.new(list(reversed(vr[-1]))))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, grid, caps


def p_text(body, size, font=None, res=2):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = res
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
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.z < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    return bm


FONT_BOLD = next((f for f in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                              '/System/Library/Fonts/Supplemental/Arial Bold.ttf') if os.path.exists(f)), None)


def autosmooth(bm, ang=50):
    th = ang * D2R
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            e.smooth = not (e.calc_face_angle(pi) > th)
        else:
            e.smooth = False


def tris_of(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == 'MESH' else 0


def make_obj(name, bm, origin=(0, 0, 0), ang=50):
    o = Vector(origin)
    for v in bm.verts:
        v.co = ROT @ (v.co - o)
    bm.normal_update()
    autosmooth(bm, ang)
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
    ob.location = ROT @ o
    bpy.context.scene.collection.objects.link(ob)
    try:
        md = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        md.keep_sharp = True
        md.weight = 60
        md.mode = 'FACE_AREA'
    except Exception as e:  # tanpa modifier: normal halus biasa
        log('weighted normal gagal', e)
    return ob


def make_empty(name, p):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.12
    e.location = ROT @ Vector(p)
    bpy.context.scene.collection.objects.link(e)
    return e


def tmp_obj(name, bm, mat=None):
    if mat:
        for f in bm.faces:
            f.material_index = MI[mat]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for n in MAT_NAMES:
        me.materials.append(MATS[n])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def boolean(bm_target, cutters, op='DIFFERENCE'):
    """Boolean (EXACT) bm_target dengan daftar (bmesh, material); bawaan = kurangi. Face dari pemotong memakai material pemotong."""
    tgt = tmp_obj('tmp_tgt', bm_target)
    cut_objs = []
    for k, (cb, mat) in enumerate(cutters):
        co = tmp_obj('tmp_cut%d' % k, cb, mat)
        co.hide_render = True
        md = tgt.modifiers.new('b%d' % k, 'BOOLEAN')
        md.operation = op
        md.solver = 'EXACT'
        md.object = co
        md.material_mode = 'TRANSFER'
        cut_objs.append(co)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tgt.evaluated_get(dg))
    names = [(m.name.split('.')[0] if m else 'paint') for m in me.materials]
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.material_index = MI.get(names[f.material_index] if f.material_index < len(names) else 'paint', 0)
    for ob in [tgt] + cut_objs:
        m = ob.data
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(m)
    bpy.data.meshes.remove(me)
    bm.normal_update()
    return bm


# ---------------------------------------------------------------- ring generators
def ring_body(y, hw, zb, zt, rb=0.08, rt=0.10, tuck=0.03, tumble=0.04, crown=0.0, narc=3, nside=3, shoulder=None):
    """Penampang badan (bidang XZ) di posisi y: kotak membulat, sisi sedikit menggembung.
    shoulder = (fraksi tinggi, tonjolan m): garis bahu — sisi di bawahnya hampir tegak, di atasnya masuk ke sabuk kaca
    (patahan ±15° yang menangkap pantulan seperti garis karakter mobil sungguhan)."""
    h = zt - zb
    rb = min(rb, h * 0.45, hw * 0.45)
    rt = min(rt, h * 0.45, hw * 0.45)
    hwb, hwt = hw - tuck, hw - tumble
    pts = [(0.0, zb)]
    cx, cz = hwb - rb, zb + rb
    for k in range(1, narc + 1):
        a = -pi / 2 + (pi / 2) * k / narc
        pts.append((cx + rb * math.cos(a), cz + rb * math.sin(a)))
    P0, P2 = (hwb, zb + rb), (hwt, zt - rt)
    if shoulder and h > 0.3:
        fz, out = shoulder
        S = (hw + out, P0[1] + (P2[1] - P0[1]) * fz)
        n1 = max(1, nside - 1)
        for k in range(1, n1 + 1):  # bawah → bahu: hampir lurus, sedikit cembung
            t = k / (n1 + 1)
            pts.append((P0[0] + (S[0] - P0[0]) * t + 0.006 * math.sin(pi * t), P0[1] + (S[1] - P0[1]) * t))
        pts.append(S)
        pts.append((S[0] - (S[0] - P2[0]) * 0.55, S[1] + (P2[1] - S[1]) * 0.5))  # bahu → sabuk: masuk
    else:
        P1 = (2 * hw - 0.5 * (hwb + hwt), 0.5 * (P0[1] + P2[1]))
        for k in range(1, nside + 1):
            t = k / (nside + 1)
            pts.append(((1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0],
                        (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]))
    cx, cz = hwt - rt, zt - rt
    for k in range(0, narc + 1):
        a = (pi / 2) * k / narc
        pts.append((cx + rt * math.cos(a), cz + rt * math.sin(a)))
    pts.append(((hwt - rt) * 0.5, zt + crown * 0.75))
    pts.append((0.0, zt + crown))
    full = pts + [(-x, z) for (x, z) in reversed(pts[1:-1])]
    return [Vector((x, y, z)) for (x, z) in full]


def expand_keys(keys, step):
    out = []
    for i, k in enumerate(keys):
        if i:
            a = keys[i - 1]
            n = int(abs(a[0] - k[0]) / step)
            for s in range(1, n + 1):
                t = s / (n + 1)
                out.append(tuple(a[j] + (k[j] - a[j]) * t for j in range(len(k))))
        out.append(k)
    return out


def interp(keys, y, idx):
    """keys urut y menurun."""
    if y >= keys[0][0]:
        return keys[0][idx]
    for a, b in zip(keys, keys[1:]):
        if a[0] >= y >= b[0]:
            t = (a[0] - y) / (a[0] - b[0]) if a[0] != b[0] else 0
            return a[idx] + (b[idx] - a[idx]) * t
    return keys[-1][idx]


def ring_gh(y, zb, zbelt, zt, wb, wt, rc=0.07, crown=0.012):
    """Penampang kabin kaca (greenhouse). Label tiap segmen: bottom, belt, side, corner, roof."""
    zt = max(zt, zbelt + rc + 0.01)
    wt = min(wt, wb)
    s45 = math.sin(pi / 4)
    pts = [(0.0, zb), (wb, zb), (wb, zbelt),
           (0.5 * (wb + wt) + 0.006, 0.5 * (zbelt + zt - rc)),
           (wt, zt - rc),
           (wt - rc + rc * s45, zt - rc + rc * s45),
           (wt - rc, zt),
           ((wt - rc) * 0.5, zt + crown * 0.75),
           (0.0, zt + crown)]
    lab = ['bottom', 'belt', 'side', 'side', 'corner', 'corner', 'roof', 'roof']
    full = pts + [(-x, z) for (x, z) in reversed(pts[1:-1])]
    return [Vector((x, y, z)) for (x, z) in full], lab + list(reversed(lab))


def ring_ellipse(cx, cy, z, rx, ry, n=16, e=2.6, plane='XY'):
    """Superelips. plane XY: cincin horizontal di ketinggian z. plane XZ: cincin vertikal di y=cy (cx = pusat z)."""
    pts = []
    for k in range(n):
        a = 2 * pi * k / n
        c, s = math.cos(a), math.sin(a)
        u = math.copysign(abs(c) ** (2 / e), c)
        v = math.copysign(abs(s) ** (2 / e), s)
        if plane == 'XY':
            pts.append(Vector((rx * u, cy + ry * v, z)))
        else:
            pts.append(Vector((rx * u, cy, cx + ry * v)))
    return pts


def headliner(bm, faces, depth=0.015):
    """Duplikat face (dibalik, digeser ke dalam) sebagai lapisan dalam kabin."""
    if not faces:
        return
    ret = bmesh.ops.duplicate(bm, geom=list(faces))
    nf = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMFace)]
    nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
    bm.normal_update()
    acc = {}
    for f in nf:
        for v in f.verts:
            acc.setdefault(v, Vector()).__iadd__(f.normal)
    for v in nv:
        n = acc.get(v)
        if n and n.length > 1e-6:
            v.co -= n.normalized() * depth
    for f in nf:
        f.material_index = MI['interior']
    bmesh.ops.reverse_faces(bm, faces=nf)


# ---------------------------------------------------------------- v3: lampu, pelat nomor, kabin
def lathe_y(prof, segs=20):
    """Putar profil [(r, y)] mengelilingi sumbu Y (benda bulat yang menghadap depan/belakang)."""
    bm = bmesh.new()
    grid = []
    for i in range(segs):
        t = 2 * pi * i / segs
        c, s_ = math.cos(t), math.sin(t)
        grid.append([bm.verts.new((r * c, y, r * s_)) for (r, y) in prof])
    for i in range(segs):
        A, B = grid[i], grid[(i + 1) % segs]
        for k in range(len(prof) - 1):
            try:
                bm.faces.new((A[k], A[k + 1], B[k + 1], B[k]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return bm


def round_lamp(dst, pos, r, depth=None, back=False, kind='head', bezel='chrome', M=None, segs=20, lens=True, shell='chrome'):
    """Lampu bulat sungguhan: ember luar, mangkuk reflektor krom, bohlam berpijar, cincin LED, kaca cembung bening, bezel.
    pos = titik pasang di permukaan bodi; lampu menonjol sedalam `depth` ke +Y (back=True: −Y). kind: head | tail | ind."""
    d = depth or r * 0.55
    base = (M if M is not None else Matrix()) @ T(*pos) @ (Rz(180) if back else Matrix()) @ T(0, d, 0)
    prof = [(r * 0.98, 0.0), (r * 0.86, -d * 0.45), (r * 0.55, -d * 0.85), (r * 0.12, -d)]
    bowl = lathe_y(prof, segs)
    orient(bowl, lambda c: Vector((-c.x, 1.0, -c.z)))
    merge(dst, bowl, 'light_tail' if kind == 'tail' else 'chrome', base, smooth=True)
    if shell:  # ember luar (terlihat dari samping)
        sh = lathe_y([(r * 1.0, 0.0), (r * 0.92, -d * 0.5), (r * 0.62, -d * 0.95), (r * 0.2, -d * 1.08)], segs)
        orient(sh, lambda c: Vector((c.x, -0.6, c.z)))
        merge(dst, sh, shell, base, smooth=True)
    em = {'head': 'light_head', 'tail': 'light_tail', 'ind': 'light_ind'}[kind]
    merge(dst, p_sphere(r * 0.28, 12, 8), em, base @ T(0, -d * 0.55, 0), smooth=True)
    if kind == 'head':  # cincin LED siang di tepi reflektor
        merge(dst, p_torus(r * 0.80, r * 0.04, segs, 6), em, base @ T(0, -d * 0.2, 0) @ Rx(90), smooth=True)
    if lens:
        ln = lathe_y([(r * 0.985, 0.0), (r * 0.80, r * 0.14), (r * 0.45, r * 0.24), (0.0005, r * 0.27)], segs)
        orient(ln, lambda c: Vector((c.x, 1.0, c.z)))
        merge(dst, ln, {'head': 'lens', 'ind': 'lens', 'tail': 'lens_red'}[kind], base, smooth=True)
    if bezel:
        merge(dst, p_torus(r * 1.0, r * 0.085, segs, 8), bezel, base @ Rx(90), smooth=True)


def skin_patch(raw_bm, cutter_bm, mat, lift=0.002):
    """Kulit bodi di dalam volume pemotong (bodi ∩ pemotong, hanya face asal bodi), diangkat ±2 mm: kaca lampu yang rata
    dan melengkung mengikuti bodi. raw_bm & cutter_bm dipakai habis."""
    out = boolean(raw_bm, [(cutter_bm, 'trim')], op='INTERSECT')
    kill = [f for f in out.faces if f.material_index != MI['paint']]
    if kill:
        bmesh.ops.delete(out, geom=kill, context='FACES')
    out.normal_update()
    for v in out.verts:
        v.co += v.normal * lift
    for f in out.faces:
        f.material_index = MI[mat]
        f.smooth = True
    return out


def lamp_cut(w, d, h, M, bevel=0.012):
    """Pemotong rongga lampu (kotak membulat) untuk boolean; M = letak & arah (muka = +Y lokal)."""
    b = p_box(w, d, h, bevel=bevel, segs=2)
    bmesh.ops.transform(b, matrix=M, verts=b.verts)
    return b


def lamp_fill(dst, w, h, M, kind='head', lens_y=0.0, proj=2, drl=True, ind=True, s=1, lens=True):
    """Isi rongga lampu persegi: proyektor berpijar bercincin gelap, bilah LED, sein, dan kaca penutup di lens_y.
    Ruang lokal: lebar X, depan +Y, tinggi Z. s = sisi (+1 kanan desain) → sein di ujung luar."""
    if kind == 'head':
        px = [0.0] if proj == 1 else [-w * 0.2, w * 0.12]
        for x in px[:proj]:
            merge(dst, p_sphere(h * 0.30, 12, 8), 'light_head', M @ T(x * s, lens_y - 0.035, h * 0.06), smooth=True)
            merge(dst, p_torus(h * 0.36, h * 0.07, 16, 6), 'trim', M @ T(x * s, lens_y - 0.028, h * 0.06) @ Rx(90), smooth=True)
        if drl:
            merge(dst, p_box(w * 0.86, 0.01, h * 0.10, bevel=0.003), 'light_head', M @ T(0, lens_y - 0.02, -h * 0.34))
        if ind:
            merge(dst, p_box(w * 0.14, 0.012, h * 0.34, bevel=0.004), 'light_ind', M @ T(s * w * 0.38, lens_y - 0.022, h * 0.1))
        if lens:
            merge(dst, p_box(w * 0.985, 0.007, h * 0.97, bevel=0.003), 'lens', M @ T(0, lens_y, 0))
    else:  # lampu belakang: bilah LED merah di rongga merah, kaca merah mengkilap
        merge(dst, p_box(w * 0.86, 0.012, h * 0.16, bevel=0.004), 'light_tail', M @ T(0, lens_y - 0.022, h * 0.26))
        merge(dst, p_box(w * 0.86, 0.012, h * 0.16, bevel=0.004), 'light_tail', M @ T(0, lens_y - 0.022, -h * 0.26))
        if ind:
            merge(dst, p_box(w * 0.5, 0.012, h * 0.14, bevel=0.004), 'light_ind', M @ T(s * w * 0.12, lens_y - 0.024, 0))
        if lens:
            merge(dst, p_box(w * 0.985, 0.007, h * 0.97, bevel=0.003), 'lens_red', M @ T(0, lens_y, 0))


def plate_bm(text, w=0.46, h=0.135, font=None):
    """Pelat nomor: dasar putih membulat, bingkai hitam, huruf timbul tipis (material 'text'). Muka = +Y, tengah di origin."""
    bm = bmesh.new()
    merge(bm, p_box(w, 0.012, h, bevel=0.006), 'plate')
    for (sx, sz, x, z) in ((w * 0.97, 0.007, 0, h * 0.44), (w * 0.97, 0.007, 0, -h * 0.44), (0.007, h * 0.9, w * 0.47, 0), (0.007, h * 0.9, -w * 0.47, 0)):
        merge(bm, p_box(sx, 0.004, sz), 'text', T(x, 0.0065, z))
    try:
        tx = p_text(text, h * 0.58, font or FONT_BOLD, res=1)
        mx = max((abs(v.co.x) for v in tx.verts), default=0.0)
        k = min(1.0, (w * 0.43) / mx) if mx > 0 else 1.0
        MF = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # teks (XY, normal +Z) → menghadap +Y
        merge(bm, tx, 'text', T(0, 0.0072, 0.002) @ MF @ Matrix.Diagonal((k, 1, 1, 1)), smooth=False)
    except Exception as e:
        log('teks pelat gagal', e)
    return bm


def seat_bm(w=0.48, depth=0.48, back_h=0.62, recline=14.0, head=True):
    """Kursi: bantalan + sandaran berbolster + sandaran kepala bertiang. Origin = tengah bantalan (atas), depan +Y."""
    bm = bmesh.new()
    merge(bm, p_box(w, depth, 0.12, bevel=0.04, segs=2), 'seat', T(0, 0, -0.06))
    for sx in (-1, 1):  # bolster samping bantalan & sandaran
        merge(bm, p_box(0.075, depth * 0.92, 0.075, bevel=0.03, segs=2), 'seat', T(sx * (w / 2 - 0.03), 0.0, 0.012))
    B = T(0, -depth / 2 + 0.03, 0.0) @ Rx(recline)
    merge(bm, p_box(w * 0.96, 0.11, back_h, bevel=0.045, segs=2), 'seat', B @ T(0, -0.02, back_h / 2))
    for sx in (-1, 1):
        merge(bm, p_box(0.07, 0.10, back_h * 0.8, bevel=0.03, segs=2), 'seat', B @ T(sx * (w / 2 - 0.035), 0.03, back_h * 0.45))
    if head:
        merge(bm, p_box(w * 0.55, 0.095, 0.17, bevel=0.04, segs=2), 'seat', B @ T(0, -0.01, back_h + 0.13))
        for sx in (-1, 1):
            merge(bm, p_cyl(0.007, 0.007, 0.08, 6), 'chrome', B @ T(sx * 0.07, -0.01, back_h + 0.03))
    return bm


def steering_bm(r=0.175, rim=0.017):
    """Setir: lingkar, 3 palang, pusat (klakson) — menghadap +Z lokal (dimiringkan pemanggil)."""
    bm = bmesh.new()
    merge(bm, p_torus(r, rim, 24, 8), 'trim', smooth=True)
    merge(bm, p_cyl(r * 0.30, r * 0.26, 0.035, 14), 'trim', T(0, 0, -0.012), smooth=True)
    for a in (0.0, 115.0, 245.0):
        merge(bm, p_box(0.03, r * 0.72, 0.016, bevel=0.005), 'trim', Rz(a) @ T(0, r * 0.62, -0.006))
    merge(bm, p_cyl(0.022, 0.022, 0.006, 10), 'chrome', T(0, 0, 0.008))
    return bm


def dash_bm(w=1.40, depth=0.30, h=0.16, wheel_x=0.36):
    """Dasbor: badan membulat, tudung panel instrumen di depan pengemudi, layar tengah, kisi AC. Origin = tengah."""
    bm = bmesh.new()
    merge(bm, p_box(w, depth, h, bevel=0.04, segs=2), 'interior')
    merge(bm, p_box(0.34, 0.16, 0.07, bevel=0.03, segs=2), 'interior', T(wheel_x, -depth * 0.28, h / 2 + 0.02))  # tudung instrumen
    merge(bm, p_box(0.26, 0.012, 0.075, bevel=0.004), 'screen', T(wheel_x, -depth * 0.5 + 0.006, h / 2 - 0.005) @ Rx(-20))  # panel instrumen (layar)
    for dx in (-0.065, 0.065):
        merge(bm, p_cyly(0.036, 0.006, 14), 'light_ind', T(wheel_x + dx, -depth * 0.5 - 0.002, h / 2 - 0.006) @ Rx(-20))
    merge(bm, p_box(0.27, 0.012, 0.165, bevel=0.006), 'text', T(0, -depth * 0.5 - 0.002, h * 0.2) @ Rx(-12))  # bingkai layar tengah
    merge(bm, p_box(0.245, 0.006, 0.14, bevel=0.002), 'screen', T(0, -depth * 0.5 - 0.0095, h * 0.2 - 0.002) @ Rx(-12))
    for x in (-w * 0.42, -w * 0.16, w * 0.16, w * 0.42):
        merge(bm, p_box(0.11, 0.012, 0.045, bevel=0.004), 'trim', T(x, -depth * 0.5 - 0.002, h * 0.12))
    return bm


# ---------------------------------------------------------------- roda (v3)
def tire_v3(R, W, rim_r, ax0=0.0, segs=32, knob=0.0, round_prof=False):
    """Ban di ruang lokal (as = X): profil membulat (bead, dinding samping menggembung, bahu, tapak sedikit cembung).
    UV: u = keliling × ulangan pola, v = 0–0,25 dinding samping, 0,25–0,75 tapak, 0,75–1 dinding samping
    (dipakai peta normal tapak/dinding di web/game/vehicles.js). knob > 0: kembang kasar (siluet bergerigi)."""
    w, H = W / 2, R - rim_r
    prof = []  # (r, x, v)
    if round_prof:  # ban motor: penampang membulat
        n = 11
        for k in range(n):
            th = pi * k / (n - 1)
            x = -w * math.cos(th) * (0.80 if k in (0, n - 1) else 1.0)
            prof.append((rim_r * 0.985 + (R - rim_r * 0.985) * math.sin(th) ** 0.62, x, k / (n - 1)))
    else:
        sh = min(0.034, W * 0.2, H * 0.42)
        wt = w - sh
        left = [(rim_r * 0.985, 0.84, 0.0), (rim_r + H * 0.14, 0.955, 0.06), (rim_r + H * 0.42, 1.03, 0.14),
                (R - sh * 1.8, 1.0, 0.21)]
        left += [(R - sh + sh * math.sin(a), (wt + sh * math.cos(a)) / w, 0.22 + 0.03 * k)
                 for k, a in enumerate((0.0, pi / 4, pi / 2))]
        for (r, xf, v) in left:
            prof.append((r, -w * xf, v))
        for k in (1, 2):
            x = -wt + 2 * wt * k / 3
            prof.append((R + 0.003 * (1 - (x / wt) ** 2), x, 0.28 + 0.44 * k / 3))
        for (r, xf, v) in reversed(left):
            prof.append((r, w * xf, 1.0 - v))
    reps = segs // 2 if knob else max(6, round(2 * pi * R / 0.2))
    bm = bmesh.new()
    uv = uv_layer(bm)
    n = len(prof)
    grid = []
    for i in range(segs):
        t = 2 * pi * i / segs
        c, s = math.cos(t), math.sin(t)
        row = []
        for (r, x, v) in prof:
            rr = r - (knob if (knob and i % 2 == 0 and 0.235 < v < 0.765) else 0.0)
            row.append(bm.verts.new((x + ax0, rr * c, rr * s)))
        grid.append(row)
    for i in range(segs):
        A, B = grid[i], grid[(i + 1) % segs]
        u0, u1 = i / segs * reps, (i + 1) / segs * reps
        for k in range(n):
            k2 = (k + 1) % n
            f = bm.faces.new((A[k], A[k2], B[k2], B[k]))
            f.material_index = MI['tire']
            f.smooth = True
            for l, q in zip(f.loops, ((u0, prof[k][2]), (u0, prof[k2][2]), (u1, prof[k2][2]), (u1, prof[k][2]))):
                l[uv].uv = q
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def spoke_bm(r0, r1, w0, w1, th, x0=0.0, x1=0.0, dish=0.0, bevel=0.005):
    """Jari-jari velg: balok membulat meruncing dari jari-jari r0 (lebar w0) ke r1 (lebar w1); tebal th di sumbu X,
    arah radial = +Y lokal. x0/x1 = geser muka di pangkal/ujung, dish = cekung di tengah."""
    L = r1 - r0
    wm = 0.5 * (w0 + w1)
    bm = p_box(th, L, wm, bevel=min(bevel, th * 0.3, wm * 0.3), segs=1)
    for v in bm.verts:
        t = min(1.0, max(0.0, (v.co.y + L / 2) / L))
        v.co.z *= (w0 + (w1 - w0) * t) / wm
        v.co.x += x0 + (x1 - x0) * t - dish * math.sin(pi * t)
        v.co.y += r0 + L / 2
    return bm


WHEEL_STYLE = {
    # face: posisi muka jari-jari (× setengah lebar ban); n jari-jari; twin: jari-jari kembar (rad); y: cabang Y (rad)
    'alloy5': dict(face=0.46, n=5, twin=0.20, w0=0.030, w1=0.022, th=0.024, hub=0.064, lug=(5, 0.043, 0.0085), cap=0.024, dish=0.010),
    'steel6': dict(face=0.26, n=6, w0=0.070, w1=0.092, th=0.020, hub=0.088, lug=(6, 0.064, 0.011), cap=0.046, capz=0.055, dish=-0.012),
    'trolley': dict(face=0.44, n=10, w0=0.024, w1=0.018, th=0.020, hub=0.088, lug=(8, 0.068, 0.009), cap=0.05, capz=0.06, ring=0.56),
    'bus': dict(face=0.30, n=8, w0=0.05, w1=0.07, th=0.02, hub=0.12, lug=(8, 0.095, 0.012), cap=0.06, capz=0.07, dish=-0.02),
    'super': dict(face=0.50, n=5, y=0.21, w0=0.036, w1=0.020, th=0.024, hub=0.072, cap=0.036, hexcap=True, dish=0.026),
    'scoot': dict(face=0.42, n=5, w0=0.028, w1=0.020, th=0.016, hub=0.05, cap=0.02, two=True),
    'none': dict(face=0.46, n=0, hub=0.06, cap=0.03),
}


def wheel_v3(R, W, rim_r, side, style='alloy5', segs=32, dual=0.0, knob=0.0, disc=True, round_prof=False):
    """Roda lengkap di ruang lokal (as = X). side = −1 roda kiri (desain −X), +1 kanan; muka velg menghadap luar.
    Velg punya kedalaman sungguhan: bibir + tong, cakram rem ('disc') di balik jari-jari, pelat belakang gelap."""
    S = WHEEL_STYLE.get(style) or WHEEL_STYLE['alloy5']
    bm = bmesh.new()
    uv_layer(bm)
    offs = [0.0] if not dual else [-dual / 2, dual / 2]
    for o in offs:
        merge(bm, tire_v3(R, W, rim_r, o, segs, knob, round_prof))
    two = S.get('two', False)
    for sd in ((1, -1) if two else (side,)):
        outer = offs[-1] if sd > 0 else offs[0]
        inner = offs[0] if sd > 0 else offs[-1]
        lip_x = sd * (W / 2 * 0.84) + outer
        face_x = sd * (W / 2 * S['face']) + outer
        in_x = 0.0 if two else -sd * (W / 2 * 0.78) + inner
        d = p_lathe([(rim_r * 1.0, lip_x), (rim_r * 0.955, lip_x + sd * 0.002), (rim_r * 0.925, lip_x - sd * 0.014),
                     (rim_r * 0.90, face_x - sd * 0.008), (rim_r * 0.885, in_x)], segs)
        orient(d, lambda c, s=sd: Vector((s * 0.35, -c.y, -c.z)))
        merge(bm, d, 'rim', smooth=True)
        if not two:
            d = p_lathe([(0.035, in_x), (rim_r * 0.885, in_x)], segs)  # pelat belakang (tidak tembus pandang)
            orient(d, lambda c, s=sd: Vector((s, 0, 0)))
            merge(bm, d, 'trim')
            if disc:
                xd = face_x - sd * 0.052
                d = p_lathe([(rim_r * 0.30, xd + sd * 0.022), (rim_r * 0.34, xd), (rim_r * 0.80, xd),
                             (rim_r * 0.80, xd - sd * 0.02)], segs)
                orient(d, lambda c, s=sd: Vector((s, c.y * 2.0, c.z * 2.0)))
                for f in d.faces:
                    r = math.hypot(f.calc_center_median().y, f.calc_center_median().z)
                    f.material_index = MI['trim'] if r < rim_r * 0.335 else MI['disc']
                merge(bm, d)
        n = S.get('n', 0)
        hub = S.get('hub', 0.06)
        dish = S.get('dish', 0.0)
        sx = face_x + sd * 0.004
        merge(bm, p_cylx(hub, 0.03, 20), 'rim', T(sx + sd * dish, 0, 0))
        r1 = rim_r * 0.925
        for k in range(n):
            a = k * 2 * pi / n + pi / 2
            if S.get('y'):  # batang + dua cabang ke bibir velg
                rm = rim_r * 0.50
                merge(bm, spoke_bm(hub * 0.7, rm, S['w0'], S['w0'] * 0.8, S['th'], sd * dish, sd * dish * 0.45), 'rim',
                      T(sx, 0, 0) @ Rx(a * 180 / pi - 90))
                pm = Vector((0, rm * math.cos(a), rm * math.sin(a)))
                for da in (-S['y'], S['y']):
                    pr = Vector((0, r1 * math.cos(a + da), r1 * math.sin(a + da)))
                    dv = pr - pm
                    sp = spoke_bm(-0.012, dv.length, S['w0'] * 0.62, S['w1'], S['th'] * 0.9, sd * dish * 0.45, 0.0)
                    merge(bm, sp, 'rim', T(sx, pm.y, pm.z) @ Rx(math.atan2(dv.z, dv.y) * 180 / pi))
            else:
                tw = S.get('twin', 0.0)
                for da in ((-tw / 2, tw / 2) if tw else (0.0,)):
                    sp = spoke_bm(hub * 0.7, r1, S['w0'], S['w1'], S['th'], sd * dish, 0.0)
                    merge(bm, sp, 'rim', T(sx, 0, 0) @ Rx((a + da) * 180 / pi - 90))
        if S.get('ring'):
            merge(bm, p_torus(rim_r * S['ring'], 0.011, 28, 6), 'rim', T(sx + sd * 0.004, 0, 0) @ Ry(90))
        lug = S.get('lug')
        px = sx + sd * (dish + 0.015)
        if lug:
            for k in range(lug[0]):
                a = k * 2 * pi / lug[0] + pi / lug[0]
                merge(bm, p_cylx(lug[2], 0.016, 6), 'chrome', T(px + sd * 0.006, lug[1] * math.cos(a), lug[1] * math.sin(a)))
        cz = S.get('capz', 0.014)
        if S.get('hexcap'):
            merge(bm, p_cylx(S['cap'], 0.03, 6), 'chrome', T(px + sd * 0.012, 0, 0))
            merge(bm, p_cylx(S['cap'] * 0.55, 0.036, 12), 'trim', T(px + sd * 0.014, 0, 0))
        else:
            merge(bm, p_cyl(S.get('cap', 0.025), S.get('cap', 0.025) * (0.55 if cz > 0.03 else 0.9), cz, 16), 'chrome',
                  T(px + sd * cz / 2, 0, 0) @ Ry(90 * sd))
    return bm


def wheel_bm(R, W, rim_r, side, style='alloy5', segs=26, lugs=False, dual=0.0):
    """Antarmuka lama → roda v3. lugs = ban kembang kasar."""
    return wheel_v3(R, W, rim_r, side, style if style in WHEEL_STYLE else 'alloy5', max(30, segs), dual,
                    knob=0.012 if lugs else 0.0, round_prof=(style == 'scoot'))


def add_wheel(name, center, R, W, rim_r, side, **kw):
    bm = wheel_bm(R, W, rim_r, side, **kw)
    bmesh.ops.transform(bm, matrix=T(*center), verts=bm.verts)
    return make_obj(name, bm, origin=center, ang=40)


def add_calipers(body, wheels, R, W, rim_r, style='alloy5', ang=35.0, mat='caliper'):
    """Kaliper rem statis di badan (di balik jari-jari, menjepit cakram). wheels = [(x, y, side)], desain."""
    S = WHEEL_STYLE.get(style) or WHEEL_STYLE['alloy5']
    rc = rim_r * 0.60
    for (x, y, sd) in wheels:
        xd = x + sd * (W / 2 * S['face'] - 0.052)
        a = (ang if y > 0 else 180.0 - ang) * D2R  # depan: di depan-atas as; belakang: di belakang-atas
        put(body, p_box(0.062, rim_r * 0.50, rim_r * 0.30, bevel=0.012, segs=2), mat,
            T(xd, y + rc * math.cos(a), R + rc * math.sin(a)) @ Rx(a * 180 / pi - 90))


# ---------------------------------------------------------------- LINTAS (hatchback)
def build_lintas():
    wb, R, track = 2.50, 0.31, 1.48
    BODY = [  # y, hw, zb, zt, rb, rt, tuck, tumble, crown
        (2.050, 0.640, 0.300, 0.660, 0.09, 0.09, 0.020, 0.030, 0.000),
        (2.035, 0.730, 0.260, 0.730, 0.085, 0.10, 0.030, 0.035, 0.005),
        (1.990, 0.800, 0.225, 0.780, 0.08, 0.09, 0.035, 0.040, 0.010),
        (1.900, 0.840, 0.210, 0.805, 0.08, 0.085, 0.040, 0.040, 0.015),
        (1.740, 0.855, 0.200, 0.830, 0.08, 0.08, 0.040, 0.040, 0.020),
        (1.500, 0.860, 0.190, 0.855, 0.08, 0.075, 0.040, 0.040, 0.022),
        (1.250, 0.860, 0.185, 0.875, 0.08, 0.075, 0.040, 0.040, 0.022),
        (1.000, 0.860, 0.180, 0.900, 0.08, 0.075, 0.040, 0.040, 0.020),
        (0.800, 0.860, 0.175, 0.935, 0.08, 0.075, 0.040, 0.040, 0.000),
        (0.400, 0.860, 0.172, 0.962, 0.08, 0.075, 0.040, 0.040, 0.000),
        (0.000, 0.860, 0.170, 0.975, 0.08, 0.075, 0.040, 0.040, 0.000),
        (-0.500, 0.860, 0.172, 0.990, 0.08, 0.075, 0.040, 0.040, 0.000),
        (-1.000, 0.860, 0.178, 1.005, 0.08, 0.075, 0.040, 0.040, 0.000),
        (-1.250, 0.860, 0.185, 1.012, 0.08, 0.075, 0.040, 0.040, 0.000),
        (-1.500, 0.855, 0.200, 1.020, 0.08, 0.075, 0.040, 0.040, 0.000),
        (-1.700, 0.845, 0.225, 1.030, 0.085, 0.075, 0.040, 0.040, 0.000),
        (-1.820, 0.830, 0.250, 1.034, 0.09, 0.075, 0.040, 0.040, 0.000),
        (-1.900, 0.805, 0.270, 1.025, 0.09, 0.08, 0.035, 0.040, 0.000),
        (-1.935, 0.780, 0.290, 1.000, 0.08, 0.08, 0.030, 0.035, 0.000),
        (-1.950, 0.740, 0.320, 0.960, 0.07, 0.07, 0.025, 0.030, 0.000),
    ]
    keys = expand_keys(BODY, 0.16)
    lower, _, _ = p_loft([ring_body(*k, narc=4, nside=4, shoulder=(0.70, 0.010)) for k in keys])
    arches = bmesh.new()
    for y in (wb / 2, -wb / 2):
        merge(arches, p_cylx(R + 0.055, 2.4, 36), M=T(0, y, R))

    def HL(s):  # letak & arah lampu depan (muka = +Y lokal), membungkus sudut
        return T(s * 0.585, 1.985, 0.738) @ Rz(-s * 26) @ Rx(8)

    def TL(s):  # lampu belakang (muka lokal +Y menghadap belakang-luar)
        return T(s * 0.63, -1.895, 0.905) @ Rz(180 + s * 15)
    pock, tailc = bmesh.new(), bmesh.new()
    lenses = bmesh.new()  # kaca lampu = kulit bodi di atas rongga (rata & melengkung mengikuti bodi)
    for s in (1, -1):
        merge(pock, lamp_cut(0.38, 0.16, 0.092, HL(s)))
        merge(tailc, lamp_cut(0.30, 0.14, 0.15, TL(s)))
        merge(lenses, skin_patch(lower.copy(), lamp_cut(0.38, 0.16, 0.092, HL(s)), 'lens'))
        merge(lenses, skin_patch(lower.copy(), lamp_cut(0.30, 0.14, 0.15, TL(s)), 'lens_red'))
    lower = boolean(lower, [(arches, 'trim'), (pock, 'chrome'), (tailc, 'light_tail'),
                            (lamp_cut(0.72, 0.16, 0.08, T(0, 2.03, 0.652), bevel=0.02), 'trim'),
                            (lamp_cut(1.00, 0.18, 0.15, T(0, 2.02, 0.41), bevel=0.03), 'trim')])
    for f in lower.faces:
        if f.material_index != MI['paint']:
            continue
        c, n = f.calc_center_median(), f.normal
        if n.z < -0.55:
            f.material_index = MI['trim']
        elif c.z < 0.33 and abs(n.x) > 0.8:
            f.material_index = MI['trim']
        elif n.z > 0.8 and -1.80 < c.y < 1.12 and abs(c.x) < 0.73 and c.z > 0.9:
            f.material_index = MI['interior']
    body = bmesh.new()
    merge(body, lower)
    merge(body, lenses)

    # kabin kaca: (y, zt, wb, wt, gaya bentang ke potongan berikutnya)
    GH = [(1.150, None, 0.740, 0.730, 'ws'), (0.980, 1.080, 0.752, 0.705, 'ws'), (0.800, 1.240, 0.760, 0.680, 'ws'),
          (0.620, 1.375, 0.764, 0.658, 'ws'), (0.450, 1.468, 0.766, 0.642, 'door'), (0.200, 1.505, 0.766, 0.635, 'door'),
          (-0.050, 1.515, 0.766, 0.632, 'bpil'), (-0.170, 1.517, 0.766, 0.632, 'door'),
          (-0.550, 1.515, 0.766, 0.630, 'door'), (-0.900, 1.510, 0.764, 0.626, 'door'),
          (-1.150, 1.503, 0.760, 0.620, 'bpil'), (-1.210, 1.500, 0.759, 0.618, 'door'),
          (-1.420, 1.490, 0.754, 0.611, 'cpil'),
          (-1.550, 1.476, 0.748, 0.600, 'hatch'), (-1.640, 1.360, 0.745, 0.606, 'hatch'),
          (-1.720, 1.220, 0.742, 0.625, 'hatch'), (-1.790, 1.075, 0.738, 0.660, 'hatch'),
          (-1.815, None, 0.735, 0.700, None)]
    STYLE = {'ws': dict(side='glass', corner='paint2', roof='glass'),
             'door': dict(side='glass', corner='paint2', roof='paint2'),
             'bpil': dict(side='trim', corner='paint2', roof='paint2'),
             'cpil': dict(side='paint', corner='paint2', roof='paint2'),
             'hatch': dict(side='paint', corner='paint2', roof='glass')}
    rings, labels = [], None
    for (y, zt, w0, w1, _) in GH:
        belt = interp(BODY, y, 3) + 0.004
        rg, labels = ring_gh(y, 0.90, belt, zt if zt else belt + 0.085, w0, w1)
        rings.append(rg)
    gh, grid, caps = p_loft(rings)
    inner = []
    for i, row in enumerate(grid):
        st = STYLE[GH[i][4]]
        for j, f in enumerate(row):
            lab = labels[j]
            m = {'bottom': 'interior', 'belt': 'trim'}.get(lab) or st[lab]
            f.material_index = MI[m]
            if m not in ('glass', 'interior', 'trim') or (m == 'trim' and lab == 'side'):
                inner.append(f)
    caps[0].material_index = MI['trim']
    caps[1].material_index = MI['paint']
    headliner(gh, inner, 0.015)
    merge(body, gh)

    # ---- depan: lampu utama di rongga krom berkaca bening, bilah LED, gril berbilah, intake + lampu kabut
    for s in (1, -1):
        lamp_fill(body, 0.38, 0.092, HL(s), 'head', lens_y=0.012, proj=2, s=s, lens=False)
        round_lamp(body, (s * 0.63, 1.975, 0.40), 0.043, depth=0.03, shell='trim')
    bar = [(x, 2.052 - 0.17 * x * x, 0.752) for x in (-0.38, -0.25, -0.12, 0.0, 0.12, 0.25, 0.38)]
    put(body, p_path(bar, 0.006, 6), 'light_head')
    for k in range(4):  # bilah gril (hitam mengkilap) di rongga
        put(body, p_box(0.70, 0.02, 0.008, bevel=0.003), 'paint2', T(0, 2.035, 0.626 + k * 0.018))
    put(body, p_box(0.62, 0.014, 0.010, bevel=0.004), 'chrome', T(0, 2.054, 0.652))
    for k in range(3):  # kisi intake bawah
        put(body, p_box(0.96, 0.02, 0.010, bevel=0.003), 'paint2', T(0, 2.03, 0.365 + k * 0.045))
    for x in (-0.3, 0.0, 0.3):
        put(body, p_box(0.012, 0.02, 0.13), 'paint2', T(x, 2.028, 0.41))
    put(body, p_box(1.30, 0.08, 0.035, bevel=0.012), 'trim', T(0, 1.995, 0.262))
    merge(body, plate_bm('B 1207 SRA', 0.44, 0.125), M=T(0, 2.07, 0.50))
    # ---- belakang: lampu sudut berkaca merah + bilah merah selebar pintu bagasi
    for s in (1, -1):
        lamp_fill(body, 0.30, 0.15, TL(s), 'tail', lens_y=0.0, s=-s, lens=False)
        put(body, p_box(0.11, 0.02, 0.03, bevel=0.008), 'light_tail', T(s * 0.66, -1.952, 0.40))
        put(body, p_box(0.07, 0.014, 0.05, bevel=0.01), 'light_head', T(s * 0.43, -1.962, 0.905))
    put(body, p_box(0.78, 0.014, 0.034, bevel=0.008), 'light_tail', T(0, -1.962, 0.905))
    put(body, p_box(0.78, 0.008, 0.04, bevel=0.003), 'lens_red', T(0, -1.971, 0.905))
    put(body, p_box(0.54, 0.014, 0.17, bevel=0.012), 'trim', T(0, -1.952, 0.64))
    merge(body, plate_bm('B 1207 SRA', 0.44, 0.125), M=T(0, -1.962, 0.64) @ Rz(180))
    put(body, p_box(0.24, 0.02, 0.028, bevel=0.01), 'chrome', T(0, -1.96, 0.765))
    put(body, p_box(1.36, 0.06, 0.08, bevel=0.02), 'trim', T(0, -1.925, 0.33))
    put(body, p_tube((0.42, -1.80, 0.24), (0.42, -1.975, 0.24), 0.034, 16), 'chrome')
    put(body, p_cyly(0.026, 0.02, 14), 'text', T(0.42, -1.972, 0.24))
    put(body, p_box(1.18, 0.15, 0.028, bevel=0.012), 'paint2', T(0, -1.60, 1.488) @ Rx(-7))
    put(body, p_box(0.30, 0.014, 0.016, bevel=0.005), 'light_tail', T(0, -1.672, 1.468))
    put(body, p_box(0.05, 0.17, 0.06, bevel=0.024, segs=2), 'paint2', T(0, -1.28, 1.535))
    put(body, p_box(0.42, 0.016, 0.014), 'trim', T(0.10, -1.768, 1.14) @ Rz(12) @ Rx(-60))
    # ---- samping: spion, gagang pintu sewarna bodi, bibir spatbor, wiper
    for s in (1, -1):
        put(body, p_box(0.20, 0.10, 0.12, bevel=0.04, segs=2), 'paint', T(s * 0.95, 1.00, 0.985) @ Rz(-s * 8))
        put(body, p_box(0.16, 0.012, 0.085, bevel=0.01), 'chrome', T(s * 0.955, 0.948, 0.985) @ Rz(-s * 8))
        put(body, p_box(0.10, 0.06, 0.04, bevel=0.01), 'trim', T(s * 0.87, 1.02, 0.955))
        put(body, p_box(0.10, 0.012, 0.014), 'light_ind', T(s * 0.96, 1.052, 0.937) @ Rz(-s * 8))
        for y in (0.06, -0.95):
            put(body, p_box(0.03, 0.16, 0.03, bevel=0.012, segs=2), 'paint', T(s * 0.826, y, 0.88))
            put(body, p_box(0.012, 0.11, 0.008), 'chrome', T(s * 0.843, y, 0.88))
        for y in (wb / 2, -wb / 2):  # bibir spatbor hitam
            fl = p_lathe([(R + 0.05, 0.83), (R + 0.05, 0.875), (R + 0.095, 0.872), (R + 0.095, 0.83)], 24,
                         a0=-6 * D2R, a1=186 * D2R, closed_prof=True, cap_ends=True)
            bmesh.ops.recalc_face_normals(fl, faces=fl.faces)
            merge(body, fl, 'trim', T(0, y, R) @ (MX() if s < 0 else Matrix()))
    for s in (1, -1):  # wiper
        put(body, p_box(0.52, 0.014, 0.012), 'trim', T(s * 0.24 - 0.04, 1.175, 0.905) @ Rz(5))
        put(body, p_box(0.03, 0.03, 0.03, bevel=0.01), 'trim', T(s * 0.24 - 0.30, 1.19, 0.90))
    # ---- interior: dasbor bertudung instrumen, setir berpalang, kursi berbolster & sandaran kepala
    merge(body, dash_bm(1.40, 0.30, 0.16, 0.36), M=T(0, 0.88, 0.95))
    merge(body, steering_bm(0.17, 0.016), M=T(0.36, 0.52, 0.99) @ Rx(65))
    put(body, p_tube((0.36, 0.72, 0.93), (0.36, 0.54, 0.985), 0.022, 8), 'trim')
    for s in (1, -1):
        merge(body, seat_bm(0.50, 0.50, 0.66, 14), M=T(s * 0.36, -0.03, 0.46))
    merge(body, seat_bm(1.30, 0.46, 0.62, 12, head=False), M=T(0, -0.98, 0.47))
    for x in (-0.42, 0.0, 0.42):
        put(body, p_box(0.24, 0.085, 0.15, bevel=0.035, segs=2), 'seat', T(x, -1.30, 1.20) @ Rx(10))
    put(body, p_box(0.18, 0.62, 0.20, bevel=0.03), 'interior', T(0, 0.30, 0.40))
    put(body, p_tube((0, 0.42, 0.50), (0, 0.39, 0.60), 0.012, 6), 'trim')
    put(body, p_sphere(0.026, 10, 6), 'chrome', T(0, 0.39, 0.61))
    put(body, p_box(0.22, 0.03, 0.06, bevel=0.012), 'trim', T(0, 0.585, 1.33))  # spion tengah
    put(body, p_box(1.52, 3.0, 0.02), 'interior', T(0, -0.25, 0.235))  # lantai kabin
    add_calipers(body, [(sx * track / 2, sy * wb / 2, sx) for sx in (1, -1) for sy in (1, -1)], R, 0.195, 0.19, 'alloy5')
    objs = [make_obj('body', body)]
    # roda (desain: kiri = −X)
    for nm, x, y in (('wheel_fl', -track / 2, wb / 2), ('wheel_fr', track / 2, wb / 2),
                     ('wheel_rl', -track / 2, -wb / 2), ('wheel_rr', track / 2, -wb / 2)):
        objs.append(add_wheel(nm, (x, y, R), R, 0.195, 0.19, 1 if x > 0 else -1, style='alloy5', segs=22, lugs=False))
    E = {'seat_driver': (0.36, 0.0, 0.52), 'eye_driver': (0.36, -0.08, 1.23), 'exit_l': (-1.76, 0.0, 0.0),
         'exit_r': (1.76, 0.0, 0.0), 'exhaust': (0.42, -1.99, 0.24), 'light_fl': (-0.60, 2.0, 0.742),
         'light_fr': (0.60, 2.0, 0.742), 'seat_p1': (-0.36, 0.0, 0.52), 'seat_p2': (0.40, -0.85, 0.53),
         'seat_p3': (-0.40, -0.85, 0.53)}
    return objs, E, dict(wheelbase=wb, track=track, wheelRadius=R)


# ---------------------------------------------------------------- BANTENG (4x4 terbuka)
def build_banteng():
    wb, R, track = 2.65, 0.42, 1.60
    BODY = [
        (1.955, 0.700, 0.700, 1.070, 0.05, 0.05, 0.010, 0.010, 0.000),
        (1.945, 0.770, 0.665, 1.130, 0.05, 0.05, 0.015, 0.015, 0.000),
        (1.920, 0.795, 0.645, 1.165, 0.05, 0.05, 0.020, 0.020, 0.005),
        (1.840, 0.805, 0.635, 1.180, 0.05, 0.055, 0.020, 0.020, 0.010),
        (1.400, 0.810, 0.625, 1.195, 0.05, 0.055, 0.020, 0.020, 0.012),
        (0.900, 0.815, 0.620, 1.210, 0.05, 0.055, 0.020, 0.020, 0.012),
        (0.740, 0.820, 0.620, 1.220, 0.05, 0.055, 0.020, 0.020, 0.010),
        (0.700, 0.820, 0.620, 1.180, 0.05, 0.050, 0.020, 0.020, 0.000),
        (0.000, 0.820, 0.620, 1.160, 0.05, 0.050, 0.020, 0.020, 0.000),
        (-1.000, 0.820, 0.625, 1.160, 0.05, 0.050, 0.020, 0.020, 0.000),
        (-1.800, 0.820, 0.640, 1.160, 0.05, 0.050, 0.020, 0.020, 0.000),
        (-1.890, 0.810, 0.660, 1.155, 0.05, 0.050, 0.020, 0.020, 0.000),
        (-1.920, 0.785, 0.680, 1.140, 0.05, 0.050, 0.015, 0.015, 0.000),
        (-1.930, 0.730, 0.700, 1.100, 0.05, 0.050, 0.010, 0.010, 0.000),
    ]
    keys = expand_keys(BODY, 0.45)
    lower, _, _ = p_loft([ring_body(*k, narc=2, nside=2) for k in keys])
    arches = bmesh.new()
    for y in (wb / 2, -wb / 2):
        merge(arches, p_cylx(0.52, 2.4, 24), M=T(0, y, R))
    tub = p_box(1.47, 2.49, 0.9)
    bmesh.ops.transform(tub, matrix=T(0, -0.585, 0.74 + 0.45), verts=tub.verts)
    doors = bmesh.new()
    for s in (1, -1):  # 4 bukaan pintu (depan + belakang tiap sisi) = 4 kursi
        merge(doors, p_box(0.4, 0.78, 0.6), M=T(s * 0.80, 0.17, 0.99 + 0.3))
        merge(doors, p_box(0.4, 0.38, 0.6), M=T(s * 0.80, -0.59, 0.99 + 0.3))
    lower = boolean(lower, [(arches, 'trim'), (tub, 'interior'), (doors, 'paint')])
    for f in lower.faces:
        if f.material_index != MI['paint']:
            continue
        c, n = f.calc_center_median(), f.normal
        if n.z < -0.55:
            f.material_index = MI['trim']
        elif c.z < 0.74 and (abs(n.x) > 0.45 or abs(n.y) > 0.6):
            f.material_index = MI['trim']
    body = bmesh.new()
    merge(body, lower)
    # spatbor lebar (flare)
    for y in (wb / 2, -wb / 2):
        a0 = math.asin((0.66 - R) / 0.52)
        for s in (1, -1):
            fl = p_lathe([(0.515, 0.76), (0.515, 0.955), (0.60, 0.94), (0.625, 0.76)], 8, a0=a0, a1=pi - a0,
                         closed_prof=True, cap_ends=True)
            bmesh.ops.recalc_face_normals(fl, faces=fl.faces)
            merge(body, fl, 'trim', T(0, y, R) @ (MX() if s < 0 else Matrix()))
            put(body, p_box(0.22, 0.02, 0.24, bevel=0.008), 'trim', T(s * 0.80, y - 0.585, 0.46))
    # kap mesin
    put(body, p_box(0.92, 1.05, 0.035, bevel=0.015, segs=2), 'paint', T(0, 1.32, 1.205))
    for s in (1, -1):
        put(body, p_box(0.04, 0.10, 0.06, bevel=0.01), 'trim', T(s * 0.80, 1.80, 1.12))
        put(body, p_box(0.12, 0.30, 0.012), 'trim', T(s * 0.30, 1.30, 1.225))
    # muka depan
    put(body, p_box(1.00, 0.03, 0.30, bevel=0.01), 'trim', T(0, 1.962, 0.885))
    for k in range(4):
        put(body, p_box(0.86, 0.035, 0.032, bevel=0.008), 'paint', T(0, 1.978, 0.79 + k * 0.064))
    for s in (1, -1):
        put(body, p_box(0.25, 0.04, 0.25, bevel=0.02), 'trim', T(s * 0.53, 1.965, 0.95))
        round_lamp(body, (s * 0.53, 1.984, 0.95), 0.092, depth=0.05, shell='trim')  # lampu bulat: reflektor krom + kaca cembung
        round_lamp(body, (s * 0.53, 1.976, 0.775), 0.034, depth=0.02, kind='ind', shell='trim')
    put(body, p_box(1.84, 0.20, 0.19, bevel=0.02), 'trim', T(0, 2.05, 0.615))  # bumper depan menempel ke dasar badan
    for s in (1, -1):
        put(body, p_box(0.10, 0.22, 0.14, bevel=0.01), 'trim', T(s * 0.62, 1.94, 0.66))  # dudukan bumper
    put(body, p_path([(-0.46, 2.10, 0.69), (-0.40, 2.12, 1.00), (0.40, 2.12, 1.00), (0.46, 2.10, 0.69)], 0.03, 10),
        'trim')
    put(body, p_cylx(0.07, 0.42, 12), 'trim', T(0, 2.02, 0.74))
    put(body, p_box(0.20, 0.04, 0.03), 'chrome', T(0, 2.10, 0.74))
    for s in (1, -1):
        put(body, p_box(0.05, 0.09, 0.10, bevel=0.015), 'paint2', T(s * 0.62, 2.17, 0.58))
    merge(body, plate_bm('B 9014 BTG', 0.36, 0.11), M=T(0, 2.158, 0.595))
    # kaca depan (rangka tegak, bisa dilipat)
    ws = bmesh.new()
    merge(ws, p_box(1.56, 0.06, 0.06, bevel=0.012), 'paint', T(0, 0, 0.03))
    merge(ws, p_box(1.56, 0.06, 0.06, bevel=0.012), 'paint', T(0, 0, 0.53))
    for s in (1, -1):
        merge(ws, p_box(0.06, 0.06, 0.56, bevel=0.012), 'paint', T(s * 0.75, 0, 0.28))
        merge(ws, p_cylx(0.025, 0.08, 10), 'trim', T(s * 0.62, 0.02, 0.0))
    merge(ws, p_box(1.44, 0.012, 0.44), 'glass', T(0, 0, 0.28))
    merge(ws, p_box(0.50, 0.012, 0.012), 'trim', T(-0.20, 0.016, 0.10) @ Rz(0) @ Ry(14))
    merge(ws, p_box(0.50, 0.012, 0.012), 'trim', T(0.30, 0.016, 0.10) @ Ry(14))
    merge(body, ws, M=T(0, 0.70, 1.215) @ Rx(10))
    for s in (1, -1):
        put(body, p_tube((s * 0.78, 0.69, 1.42), (s * 0.92, 0.66, 1.44), 0.012, 6), 'trim')
        put(body, p_box(0.16, 0.04, 0.11, bevel=0.02), 'trim', T(s * 0.95, 0.66, 1.44))
        put(body, p_box(0.14, 0.006, 0.09), 'chrome', T(s * 0.95, 0.638, 1.44))
    # snorkel (kiri depan)
    put(body, p_path([(-0.875, 1.10, 0.95), (-0.875, 0.86, 1.15), (-0.86, 0.66, 1.78)], 0.045, 10), 'trim')
    put(body, p_box(0.10, 0.17, 0.09, bevel=0.025), 'trim', T(-0.86, 0.71, 1.82))
    # roll bar + lampu sorot
    hoop = [(-0.72, -0.36, 1.10), (-0.70, -0.36, 1.78), (-0.62, -0.36, 1.85), (0.62, -0.36, 1.85),
            (0.70, -0.36, 1.78), (0.72, -0.36, 1.10)]
    put(body, p_path(hoop, 0.035, 10), 'trim')
    for s in (1, -1):
        put(body, p_tube((s * 0.69, -0.38, 1.79), (s * 0.72, -1.75, 1.17), 0.03, 10), 'trim')
    put(body, p_box(1.00, 0.08, 0.08, bevel=0.015), 'trim', T(0, -0.32, 1.925))
    for x in (-0.36, -0.12, 0.12, 0.36):
        round_lamp(body, (x, -0.282, 1.925), 0.036, depth=0.03, bezel='trim', segs=14, shell='trim')
    # tangga samping
    for s in (1, -1):
        put(body, p_box(0.12, 1.30, 0.05, bevel=0.01), 'trim', T(s * 0.83, 0.0, 0.56))
    # belakang
    for s in (1, -1):
        put(body, p_box(0.10, 0.03, 0.19, bevel=0.01), 'light_tail', T(s * 0.68, -1.936, 0.97))
        put(body, p_box(0.13, 0.02, 0.22, bevel=0.01), 'trim', T(s * 0.68, -1.928, 0.97))
        put(body, p_box(0.11, 0.008, 0.20, bevel=0.003), 'lens_red', T(s * 0.68, -1.957, 0.97))
    put(body, p_box(1.70, 0.14, 0.16, bevel=0.02), 'trim', T(0, -1.985, 0.635))  # bumper belakang menempel ke dasar badan
    for s in (1, -1):
        put(body, p_box(0.10, 0.22, 0.14, bevel=0.01), 'trim', T(s * 0.62, -1.90, 0.66))  # dudukan bumper
    put(body, p_box(0.08, 0.18, 0.07), 'chrome', T(0, -2.10, 0.60))
    put(body, p_sphere(0.035, 10, 6), 'chrome', T(0, -2.17, 0.66))
    merge(body, plate_bm('B 9014 BTG', 0.30, 0.10), M=T(0.55, -2.06, 0.635) @ Rz(180))
    put(body, p_box(0.30, 0.08, 0.30, bevel=0.02), 'trim', T(0, -1.96, 1.08))
    spare = wheel_bm(R, 0.27, 0.215, 1, style='steel6', segs=24, lugs=True)
    merge(body, spare, M=T(0, -2.075, 1.08) @ Rz(-90))
    put(body, p_tube((0.66, -1.88, 0.62), (0.88, -1.88, 0.62), 0.03, 10), 'chrome')
    # interior terbuka
    put(body, p_box(1.44, 0.22, 0.20, bevel=0.03), 'interior', T(0, 0.585, 1.10))
    for x in (0.30, 0.48):
        put(body, p_cyly(0.05, 0.01, 14), 'light_ind', T(x, 0.472, 1.13))
    merge(body, steering_bm(0.19, 0.02), M=T(0.40, 0.32, 1.22) @ Rx(60))
    put(body, p_tube((0.40, 0.50, 1.10), (0.40, 0.34, 1.21), 0.025, 8), 'trim')
    for s in (1, -1):
        merge(body, seat_bm(0.48, 0.48, 0.58, 10), M=T(s * 0.40, -0.03, 0.98))
    merge(body, seat_bm(1.30, 0.44, 0.44, 8, head=False), M=T(0, -0.97, 0.96))
    put(body, p_box(0.20, 0.50, 0.18, bevel=0.03), 'interior', T(0, 0.05, 0.83))
    put(body, p_tube((0.0, 0.22, 0.90), (0.0, 0.16, 1.08), 0.012, 6), 'trim')
    put(body, p_sphere(0.03, 10, 6), 'chrome', T(0.0, 0.16, 1.09))
    put(body, p_tube((0.07, 0.10, 0.90), (0.08, 0.06, 1.03), 0.01, 6), 'trim')
    put(body, p_sphere(0.022, 8, 6), 'paint2', T(0.08, 0.06, 1.04))
    put(body, p_box(0.17, 0.34, 0.46, bevel=0.025), 'paint2', T(0.55, -1.56, 0.97))
    put(body, p_box(0.17, 0.34, 0.46, bevel=0.025), 'trim', T(0.35, -1.56, 0.97))
    add_calipers(body, [(sx * track / 2, sy * wb / 2, sx) for sx in (1, -1) for sy in (1, -1)], R, 0.27, 0.215, 'steel6', mat='trim')
    objs = [make_obj('body', body)]
    for nm, x, y in (('wheel_fl', -track / 2, wb / 2), ('wheel_fr', track / 2, wb / 2),
                     ('wheel_rl', -track / 2, -wb / 2), ('wheel_rr', track / 2, -wb / 2)):
        objs.append(add_wheel(nm, (x, y, R), R, 0.27, 0.215, 1 if x > 0 else -1, style='steel6', segs=24, lugs=True))
    E = {'seat_driver': (0.40, 0.02, 1.00), 'eye_driver': (0.40, -0.06, 1.72), 'exit_l': (-1.85, 0.0, 0.0),
         'exit_r': (1.85, 0.0, 0.0), 'exhaust': (0.90, -1.88, 0.62), 'light_fl': (-0.53, 1.99, 0.95),
         'light_fr': (0.53, 1.99, 0.95), 'seat_p1': (-0.40, 0.02, 1.00), 'seat_p2': (-0.35, -0.92, 0.98),
         'seat_p3': (0.35, -0.92, 0.98)}
    return objs, E, dict(wheelbase=wb, track=track, wheelRadius=R)


# ---------------------------------------------------------------- WALET (skuter matic)
def build_walet():
    wb, R = 1.30, 0.26
    fy, ry = wb / 2, -wb / 2
    pivot = (0.0, fy, 0.98)
    body = bmesh.new()
    # dek kaki
    put(body, p_box(0.36, 0.48, 0.035, bevel=0.01), 'trim', T(0, 0.12, 0.315))
    for k in range(5):
        put(body, p_box(0.28, 0.012, 0.008), 'trim', T(0, -0.06 + k * 0.08, 0.336))
    put(body, p_box(0.34, 0.50, 0.09, bevel=0.04, segs=2), 'paint', T(0, 0.12, 0.268))
    # pelindung kaki / apron depan (loft horizontal)
    AP = [  # z, y_front, y_back, hw
        (0.24, 0.355, 0.20, 0.200), (0.32, 0.365, 0.215, 0.210), (0.45, 0.395, 0.27, 0.225),
        (0.60, 0.465, 0.345, 0.215), (0.75, 0.535, 0.415, 0.190), (0.86, 0.565, 0.450, 0.160),
        (0.93, 0.565, 0.465, 0.130), (0.965, 0.555, 0.475, 0.100)]
    rings = [ring_ellipse(0, 0.5 * (a + b), z, hw, 0.5 * (a - b), n=20, e=3.2) for (z, a, b, hw) in AP]
    ap, _, _ = p_loft(rings)
    merge(body, ap, 'paint')
    put(body, p_box(0.012, 0.012, 0.17), 'paint2', T(0.035, 0.508, 0.70) @ Rx(-22) @ Ry(-24))
    put(body, p_box(0.012, 0.012, 0.17), 'paint2', T(-0.035, 0.508, 0.70) @ Rx(-22) @ Ry(24))
    for s in (1, -1):
        put(body, p_box(0.06, 0.04, 0.032, bevel=0.01), 'light_ind', T(s * 0.165, 0.535, 0.80) @ Rz(-s * 30))
    put(body, p_box(0.13, 0.012, 0.012, bevel=0.004), 'light_head', T(0, 0.567, 0.865))
    # badan belakang (loft memanjang)
    RB = [  # y, zb, zt, hw
        (-0.08, 0.30, 0.640, 0.130), (-0.12, 0.29, 0.690, 0.150), (-0.25, 0.31, 0.725, 0.180),
        (-0.45, 0.38, 0.735, 0.200), (-0.62, 0.45, 0.735, 0.190), (-0.78, 0.49, 0.728, 0.170),
        (-0.90, 0.52, 0.710, 0.130), (-0.95, 0.55, 0.690, 0.100), (-0.975, 0.57, 0.670, 0.070)]
    rings = [ring_ellipse(0.5 * (zb + zt), y, 0, hw, 0.5 * (zt - zb), n=20, e=3.0, plane='XZ') for (y, zb, zt, hw) in RB]
    rb_, _, _ = p_loft(rings)
    merge(body, rb_, 'paint')
    put(body, p_box(0.012, 0.34, 0.018, bevel=0.005), 'paint2', T(0.199, -0.50, 0.60), mirror=True)
    # jok
    SE = [(-0.04, 0.69, 0.745, 0.130), (-0.07, 0.69, 0.775, 0.150), (-0.15, 0.69, 0.785, 0.165),
          (-0.30, 0.69, 0.785, 0.170), (-0.40, 0.70, 0.797, 0.165), (-0.46, 0.70, 0.815, 0.160),
          (-0.62, 0.70, 0.820, 0.150), (-0.76, 0.69, 0.810, 0.130), (-0.82, 0.68, 0.790, 0.100),
          (-0.845, 0.67, 0.760, 0.070)]
    rings = [ring_ellipse(0.5 * (zb + zt), y, 0, hw, 0.5 * (zt - zb), n=16, e=2.8, plane='XZ') for (y, zb, zt, hw) in SE]
    se, _, _ = p_loft(rings)
    merge(body, se, 'seat')
    # lampu belakang
    put(body, p_box(0.16, 0.04, 0.05, bevel=0.016), 'light_tail', T(0, -0.955, 0.645))
    put(body, p_box(0.17, 0.014, 0.056, bevel=0.006), 'lens_red', T(0, -0.981, 0.645))
    for s in (1, -1):
        put(body, p_box(0.05, 0.04, 0.028, bevel=0.008), 'light_ind', T(s * 0.105, -0.925, 0.612) @ Rz(s * 25))
    put(body, p_path([(0, -0.86, 0.53), (0, -0.95, 0.47), (0, -0.975, 0.38)], 0.02, 8), 'trim')
    merge(body, plate_bm('B 3150 WLT', 0.23, 0.09), M=T(0, -0.987, 0.36) @ Rz(180))
    put(body, p_box(0.04, 0.012, 0.02), 'light_tail', T(0, -0.99, 0.42))
    # mesin + CVT (kiri) + knalpot (kanan)
    put(body, p_box(0.12, 0.56, 0.20, bevel=0.05), 'chrome', T(-0.11, -0.40, 0.29))
    put(body, p_box(0.08, 0.20, 0.08, bevel=0.025), 'trim', T(-0.12, -0.18, 0.42))
    put(body, p_box(0.18, 0.26, 0.15, bevel=0.03), 'trim', T(0.0, -0.28, 0.25))
    put(body, p_tube((0.04, -0.18, 0.20), (0.15, -0.33, 0.31), 0.02, 8), 'trim')
    put(body, p_cyl(0.055, 0.048, 0.42, 14), 'trim', T(0.15, -0.55, 0.34) @ Rx(-98))
    put(body, p_box(0.03, 0.30, 0.08, bevel=0.015), 'chrome', T(0.205, -0.55, 0.352) @ Rx(-8))
    put(body, p_cyl(0.026, 0.026, 0.05, 10), 'chrome', T(0.15, -0.785, 0.372) @ Rx(-98))
    put(body, p_tube((-0.14, -0.64, 0.36), (-0.14, -0.50, 0.60), 0.034, 10), 'paint2')
    put(body, p_tube((-0.14, -0.66, 0.33), (-0.14, -0.48, 0.63), 0.014, 8), 'chrome')
    for s in (1, -1):
        put(body, p_box(0.08, 0.04, 0.02, bevel=0.006), 'trim', T(s * 0.19, -0.42, 0.40))
    rail = [(-0.17, -0.55, 0.765), (-0.18, -0.80, 0.785), (-0.10, -0.90, 0.785), (0.10, -0.90, 0.785),
            (0.18, -0.80, 0.785), (0.17, -0.55, 0.765)]
    put(body, p_path(rail, 0.014, 8), 'trim')
    put(body, p_box(0.10, 0.30, 0.12, bevel=0.03), 'trim', T(0, -0.62, 0.48))
    objs = [make_obj('body', body)]

    # setang (berputar): cowl + lampu + spion + garpu + spakbor depan
    st = bmesh.new()
    put(st, p_box(0.40, 0.21, 0.10, bevel=0.045, segs=2), 'paint', T(0, 0.595, 0.985))
    put(st, p_box(0.26, 0.02, 0.075, bevel=0.012), 'trim', T(0, 0.690, 0.985))
    put(st, p_box(0.225, 0.012, 0.058, bevel=0.01), 'chrome', T(0, 0.698, 0.985))  # reflektor
    for x in (-0.055, 0.055):
        put(st, p_sphere(0.02, 10, 6), 'light_head', T(x, 0.708, 0.985))
    put(st, p_box(0.20, 0.008, 0.008), 'light_head', T(0, 0.708, 0.962))
    put(st, p_box(0.228, 0.008, 0.06, bevel=0.004), 'lens', T(0, 0.722, 0.985))
    put(st, p_box(0.15, 0.07, 0.014, bevel=0.005), 'glass', T(0, 0.535, 1.035) @ Rx(18))
    put(st, p_box(0.16, 0.08, 0.008), 'light_ind', T(0, 0.535, 1.028) @ Rx(18))
    put(st, p_tube((-0.34, 0.48, 1.0), (0.34, 0.48, 1.0), 0.014, 8), 'trim')
    for s in (1, -1):
        put(st, p_cylx(0.02, 0.12, 10), 'trim', T(s * 0.29, 0.48, 1.0))
        put(st, p_cylx(0.022, 0.012, 10), 'chrome', T(s * 0.356, 0.48, 1.0))
        put(st, p_box(0.14, 0.012, 0.012), 'chrome', T(s * 0.26, 0.525, 1.005) @ Rz(-s * 10))
        put(st, p_tube((s * 0.20, 0.50, 1.02), (s * 0.27, 0.47, 1.075), 0.008, 6), 'trim')
        put(st, p_box(0.12, 0.03, 0.062, bevel=0.015), 'trim', T(s * 0.285, 0.465, 1.085))
        put(st, p_box(0.10, 0.004, 0.048), 'chrome', T(s * 0.285, 0.449, 1.085))
        put(st, p_tube((s * 0.065, fy, R), (s * 0.06, 0.47, 0.68), 0.022, 10), 'chrome')
    put(st, p_box(0.03, 0.06, 0.08, bevel=0.01), 'trim', T(-0.075, fy - 0.05, R + 0.06))
    fender = p_lathe([(0.288, -0.055), (0.288, 0.055), (0.302, 0.057), (0.302, -0.057)], 12, a0=24 * D2R,
                     a1=124 * D2R, closed_prof=True, cap_ends=True)
    bmesh.ops.recalc_face_normals(fender, faces=fender.faces)
    merge(st, fender, 'paint', T(0, fy, R))
    objs.append(make_obj('steer', st, origin=pivot))
    objs.append(add_wheel('wheel_f', (0, fy, R), R, 0.09, 0.178, 1, style='scoot', segs=24, lugs=False))
    wr = wheel_bm(R, 0.11, 0.178, -1, style='scoot', segs=24, lugs=False)
    bmesh.ops.transform(wr, matrix=T(0, ry, R), verts=wr.verts)
    objs.append(make_obj('wheel_r', wr, origin=(0, ry, R), ang=40))
    # cakram depan menempel ke roda depan (ikut berputar)
    wf = objs[-2]
    disc = p_cylx(0.11, 0.006, 20)
    merge(disc, p_cylx(0.05, 0.012, 12), 'chrome')
    bm = bmesh.new()
    bm.from_mesh(wf.data)
    for f in disc.faces:
        f.material_index = MI['chrome']
    for v in disc.verts:
        v.co = ROT @ (v.co + Vector((-0.058, 0, 0)))
    used = [m.name for m in wf.data.materials]
    if 'chrome' not in used:
        wf.data.materials.append(MATS['chrome'])
        used.append('chrome')
    for f in disc.faces:
        f.material_index = used.index('chrome')
    merge(bm, disc)
    autosmooth(bm, 40)
    bm.to_mesh(wf.data)
    bm.free()
    E = {'seat_driver': (0.0, -0.20, 0.86), 'eye_driver': (0.0, -0.06, 1.56), 'exit_l': (-1.25, -0.20, 0.0),
         'exit_r': (1.25, -0.20, 0.0), 'exhaust': (0.15, -0.81, 0.375), 'light_f': (0.0, 0.715, 0.985),
         'seat_p1': (0.0, -0.56, 0.90)}
    return objs, E, dict(wheelbase=wb, track=0.0, wheelRadius=R)


# ---------------------------------------------------------------- LOOP (bus)
def ring_plan(z, yF, yR, hw, rcF, rcR, side_st, front_st, rear_st, narc=4):
    """Cincin horizontal (denah) di ketinggian z: persegi panjang membulat dengan titik di stasiun tertentu."""
    pts = [(0.0, yF)]
    pts += [(x, yF) for x in front_st]
    cx, cy = hw - rcF, yF - rcF
    for k in range(narc + 1):
        a = pi / 2 - (pi / 2) * k / narc
        pts.append((cx + rcF * math.cos(a), cy + rcF * math.sin(a)))
    pts += [(hw, y) for y in side_st]
    cx, cy = hw - rcR, yR + rcR
    for k in range(narc + 1):
        a = -(pi / 2) * k / narc
        pts.append((cx + rcR * math.cos(a), cy + rcR * math.sin(a)))
    pts += [(x, yR) for x in reversed(rear_st)]
    pts.append((0.0, yR))
    right = pts
    left = [(-x, y) for (x, y) in reversed(right[1:-1])]
    return [Vector((x, y, z)) for (x, y) in right + left]


def build_loop():
    wb, R = 4.6, 0.48
    trf, trr = 2.0, 1.84
    SIDE = [3.65, 2.95, 2.88, 2.05, 1.98, 1.15, 1.08, 0.25, 0.18, -0.65, -0.72, -1.55, -1.62, -2.45, -2.52, -3.35,
            -3.42, -3.85]
    PIL = [(2.88, 2.95), (1.98, 2.05), (1.08, 1.15), (0.18, 0.25), (-0.72, -0.65), (-1.62, -1.55), (-2.52, -2.45),
           (-3.42, -3.35)]
    FRONT, REAR = [0.30, 0.60], [0.40, 0.75]
    LV = [  # z, yF, yR, hw, rcF, rcR
        (0.40, 4.10, -4.20, 1.160, 0.30, 0.28), (0.46, 4.17, -4.27, 1.190, 0.33, 0.30),
        (0.56, 4.20, -4.30, 1.200, 0.34, 0.30), (1.20, 4.20, -4.30, 1.200, 0.34, 0.30),
        (1.30, 4.19, -4.30, 1.200, 0.34, 0.30), (1.38, 4.18, -4.30, 1.200, 0.34, 0.30),
        (1.50, 4.17, -4.30, 1.200, 0.34, 0.30), (1.55, 4.165, -4.30, 1.200, 0.34, 0.30),
        (2.55, 4.06, -4.28, 1.195, 0.34, 0.30), (2.62, 4.05, -4.27, 1.190, 0.33, 0.30),
        (2.85, 4.02, -4.24, 1.185, 0.32, 0.29), (2.92, 3.99, -4.21, 1.160, 0.30, 0.27),
        (2.955, 3.96, -4.18, 1.110, 0.27, 0.25), (2.975, 3.93, -4.15, 1.040, 0.23, 0.22)]
    shell, _, _ = p_loft([ring_plan(z, a, b, hw, rf, rr, SIDE, FRONT, REAR) for (z, a, b, hw, rf, rr) in LV])
    arches = bmesh.new()
    for y in (wb / 2, -wb / 2):
        merge(arches, p_cylx(R + 0.08, 3.0, 28), M=T(0, y, R))
    shell = boolean(shell, [(arches, 'trim')])

    def is_pillar(y):
        return any(a - 1e-4 <= y <= b + 1e-4 for a, b in PIL)

    inner = []
    for f in shell.faces:
        if f.material_index != MI['paint']:
            continue
        c, n = f.calc_center_median(), f.normal
        m = 'paint'
        if n.z < -0.5:
            m = 'trim'
        elif n.z > 0.5:
            m = 'paint'
        elif abs(n.x) >= abs(n.y):  # sisi
            if c.z < 0.56:
                m = 'trim'
            elif n.x < 0 and 2.95 < c.y < 3.65 and c.z < 2.55:
                m = 'glass'  # pintu depan (kiri)
            elif 1.55 < c.z < 2.55:
                m = 'trim' if is_pillar(c.y) else 'glass'
            elif 1.38 < c.z < 1.50:
                m = 'paint2'
        elif n.y > 0:  # depan
            if c.z < 0.56:
                m = 'trim'
            elif 1.30 < c.z < 2.55:
                m = 'glass'
            elif 2.62 < c.z < 2.85:
                m = 'trim'
        else:  # belakang
            if c.z < 0.56:
                m = 'trim'
            elif 1.55 < c.z < 2.55:
                m = 'glass'
        f.material_index = MI[m]
        if m != 'glass' and c.z > 1.0 and n.z > -0.5:
            inner.append(f)
    headliner(shell, inner, 0.03)
    body = bmesh.new()
    merge(body, shell)
    # pintu depan (kiri): rangka
    for y in (3.65, 3.30, 2.95):
        put(body, p_box(0.03, 0.05, 1.99), 'trim', T(-1.205, y, 1.555))
    put(body, p_box(0.03, 0.70, 0.04), 'trim', T(-1.205, 3.30, 1.20))
    put(body, p_box(0.03, 0.70, 0.04), 'trim', T(-1.205, 3.30, 2.54))
    put(body, p_box(0.024, 0.68, 0.22), 'trim', T(-1.203, 3.30, 0.68))
    # tulisan
    for s in (1, -1):
        tx = p_text('SUTERA LOOP', 0.40, FONT_BOLD, res=2)
        # teks di bidang XY menghadap +Z → putar supaya menghadap ±X dan terbaca dari luar
        if s > 0:
            M = T(1.207, -0.05, 0.95) @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        else:
            M = T(-1.207, -0.05, 0.95) @ Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        merge(body, tx, 'paint2', M)
    put(body, p_box(1.46, 0.03, 0.20, bevel=0.01), 'trim', T(0, 4.045, 2.735))
    tx = p_text('SUTERA LOOP', 0.13, FONT_BOLD, res=2)
    merge(body, tx, 'light_ind', T(0, 4.062, 2.735) @ Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    # depan
    for s in (1, -1):
        put(body, p_box(0.40, 0.03, 0.16, bevel=0.02), 'trim', T(s * 0.60, 4.205, 0.87))
        put(body, p_box(0.36, 0.03, 0.12, bevel=0.02), 'light_head', T(s * 0.60, 4.215, 0.87))
        put(body, p_box(0.20, 0.03, 0.06, bevel=0.015), 'light_ind', T(s * 0.60, 4.212, 0.72))
        put(body, p_box(0.08, 0.03, 0.04, bevel=0.01), 'light_ind', T(s * 0.85, 4.0, 2.90))
        mir = [(s * 1.05, 4.0, 2.50), (s * 1.25, 4.25, 2.44), (s * 1.31, 4.38, 2.12)]
        put(body, p_path(mir, 0.022, 8), 'trim')
        put(body, p_box(0.11, 0.06, 0.30, bevel=0.025), 'trim', T(s * 1.31, 4.40, 1.95))
        put(body, p_box(0.09, 0.006, 0.26), 'chrome', T(s * 1.31, 4.368, 1.95))
        put(body, p_box(0.80, 0.016, 0.016), 'trim', T(s * 0.42, 4.205, 1.37) @ Rz(s * 3))
    put(body, p_box(0.70, 0.03, 0.30, bevel=0.02), 'trim', T(0, 4.21, 0.87))
    for k in range(3):
        put(body, p_box(0.62, 0.02, 0.02), 'chrome', T(0, 4.225, 0.79 + k * 0.08))
    put(body, p_box(2.00, 0.12, 0.18, bevel=0.03), 'trim', T(0, 4.22, 0.50))
    put(body, p_box(0.46, 0.014, 0.12, bevel=0.006), 'plate', T(0, 4.285, 0.50))
    # belakang
    for s in (1, -1):
        put(body, p_box(0.11, 0.04, 0.62, bevel=0.025), 'light_tail', T(s * 0.80, -4.305, 1.05))
        put(body, p_box(0.08, 0.03, 0.04, bevel=0.01), 'light_tail', T(s * 0.85, -4.16, 2.90))
    put(body, p_box(1.00, 0.02, 0.36, bevel=0.01), 'trim', T(0, -4.31, 0.95))
    for k in range(5):
        put(body, p_box(0.92, 0.02, 0.016), 'paint', T(0, -4.325, 0.82 + k * 0.065))
    put(body, p_box(2.00, 0.10, 0.18, bevel=0.03), 'trim', T(0, -4.33, 0.50))
    put(body, p_box(0.46, 0.014, 0.12, bevel=0.006), 'plate', T(0, -4.388, 0.50))
    put(body, p_tube((-0.70, -4.10, 0.36), (-0.70, -4.36, 0.36), 0.04, 12), 'chrome')
    # atap
    put(body, p_box(1.60, 2.40, 0.13, bevel=0.045), 'rim', T(0, 0.30, 3.03))
    for y in (2.6, -2.6):
        put(body, p_box(0.60, 0.60, 0.03, bevel=0.01), 'trim', T(0, y, 2.985))
    # interior
    put(body, p_box(2.30, 8.10, 0.04), 'interior', T(0, -0.05, 0.98))
    put(body, p_box(2.20, 0.32, 0.36, bevel=0.04), 'interior', T(0, 3.95, 1.15))
    put(body, p_torus(0.23, 0.022, 20, 6), 'trim', T(0.65, 3.72, 1.62) @ Rx(30))
    put(body, p_tube((0.65, 3.85, 1.30), (0.65, 3.74, 1.60), 0.03, 8), 'trim')
    put(body, p_box(0.48, 0.45, 0.10), 'seat', T(0.65, 3.30, 1.30))
    put(body, p_box(0.48, 0.10, 0.60), 'seat', T(0.65, 3.05, 1.65) @ Rx(12))
    put(body, p_box(0.26, 0.08, 0.16), 'seat', T(0.65, 2.99, 2.02) @ Rx(12))
    for i, y in enumerate([2.4, 1.6, 0.8, 0.0, -0.8, -1.6, -2.4, -3.2]):
        put(body, p_box(0.90, 0.42, 0.10), 'seat', T(0.70, y, 1.40))
        put(body, p_box(0.90, 0.10, 0.50), 'seat', T(0.70, y - 0.20, 1.62) @ Rx(8))
        put(body, p_box(0.80, 0.025, 0.025), 'chrome', T(0.70, y - 0.24, 1.88))
        if i:
            put(body, p_box(0.45, 0.42, 0.10), 'seat', T(-0.85, y, 1.40))
            put(body, p_box(0.45, 0.10, 0.50), 'seat', T(-0.85, y - 0.20, 1.62) @ Rx(8))
    put(body, p_box(2.10, 0.40, 0.10), 'seat', T(0, -3.75, 1.42))
    put(body, p_box(2.10, 0.12, 0.50), 'seat', T(0, -3.95, 1.64) @ Rx(8))
    for s in (1, -1):
        put(body, p_tube((s * 0.45, 3.0, 2.45), (s * 0.45, -3.6, 2.45), 0.018, 6), 'chrome')
    put(body, p_tube((-0.55, 2.90, 1.0), (-0.55, 2.90, 2.62), 0.02, 8), 'chrome')
    objs = [make_obj('body', body)]
    for nm, x, y, w, dual in (('wheel_fl', -trf / 2, wb / 2, 0.28, 0.0), ('wheel_fr', trf / 2, wb / 2, 0.28, 0.0),
                              ('wheel_rl', -trr / 2, -wb / 2, 0.25, 0.27), ('wheel_rr', trr / 2, -wb / 2, 0.25, 0.27)):
        objs.append(add_wheel(nm, (x, y, R), R, w, 0.29, 1 if x > 0 else -1, style='bus', segs=24, lugs=False, dual=dual))
    E = {'seat_driver': (0.65, 3.25, 1.40), 'eye_driver': (0.65, 3.15, 2.10), 'exit_l': (-2.10, 3.30, 0.0),
         'exit_r': (2.10, 3.20, 0.0), 'exhaust': (-0.70, -4.38, 0.36), 'light_fl': (-0.60, 4.23, 0.87),
         'light_fr': (0.60, 4.23, 0.87)}
    k = 1
    for y in (2.4, 1.6, 0.8, 0.0, -0.8, -1.6):
        for x in (0.48, 0.92):
            if k <= 11:
                E['seat_p%d' % k] = (x, y, 1.50)
                k += 1
    return objs, E, dict(wheelbase=wb, track=trf, wheelRadius=R)


# ---------------------------------------------------------------- daftar kendaraan
VEH = {
    'lintas': dict(name='Sutera Lintas', build=build_lintas, seats=4, width=1.72, driver='right', horn='klakson-1-saya-akan-lawan.mp3',
                   gaps=[('y', 0.84, {'z': (0.335, 0.93), 'x': (0.70, 1.0)}), ('y', -0.11, {'z': (0.335, 0.98), 'x': (0.70, 1.0)}),
                         ('y', -0.86, {'z': (0.60, 1.0), 'x': (0.70, 1.0)}), ('z', 0.335, {'y': (-0.86, 0.84), 'x': (0.72, 1.0)}),
                         ('x', 0.70, {'y': (1.16, 1.92), 'z': (0.76, 1.0)}), ('y', 1.92, {'x': (0.0, 0.70), 'z': (0.70, 1.0)}),
                         ('x', 0.64, {'y': (-2.1, -1.84), 'z': (0.56, 1.0)}), ('z', 0.56, {'x': (0.0, 0.64), 'y': (-2.1, -1.84)})],
                   colors=['#b3202a', '#f2f2ee', '#9aa0a8', '#1f4fa3', '#503EBA', '#D29F52'],
                   mats={'paint2': dict(col='#141418'), 'seat': dict(col='#2f2a36')}),
    'banteng': dict(name='Banteng 4x4', build=build_banteng, seats=4, width=1.91, driver='right', horn='klakson-2-antek-asing.mp3', cabin=False, dirt=0.9,
                    gaps=[('x', 0.60, {'y': (-2.0, -1.88), 'z': (0.76, 1.16)}), ('z', 0.76, {'x': (0.0, 0.60), 'y': (-2.0, -1.88)}),
                          ('y', 0.74, {'z': (0.64, 1.19), 'x': (0.78, 1.0)}), ('y', -1.02, {'z': (0.64, 1.16), 'x': (0.78, 1.0)})],
                    colors=['#5b6b3a', '#c2a26a', '#efefe9', '#26272b', '#503EBA', '#D29F52'],
                    mats={'paint': dict(rough=0.45, coat=0.3), 'paint2': dict(col='#c62828', coat=0.3),
                          'rim': dict(col='#3b3e44', metal=0.6, rough=0.4), 'seat': dict(col='#3b3428'),
                          'interior': dict(col='#2a2b2e'), 'tire': dict(col='#18181a')}),
    'walet': dict(name='Walet 150', build=build_walet, seats=2, width=0.72, driver='center', horn='klakson-1-saya-akan-lawan.mp3', cabin=False, lod_tris=3000,
                  colors=['#f0efe9', '#b71c1c', '#232326', '#1f5fbf', '#503EBA', '#D29F52'],
                  mats={'paint2': dict(col='#D29F52', metal=0.3, rough=0.35, coat=0.6),
                        'rim': dict(col='#2a2c30', metal=0.5, rough=0.4), 'seat': dict(col='#1f1f22'),
                        'trim': dict(col='#1d1e22')}),
    'loop': dict(name='Bus Sutera Loop', build=build_loop, seats=12, width=2.40, driver='right', horn='klakson-2-antek-asing.mp3',
                 colors=['#4a3db0', '#f2f2ee', '#c62828', '#1f5fbf', '#D29F52'],
                 mats={'paint2': dict(col='#D29F52', metal=0.3, rough=0.35, coat=0.6),
                       'rim': dict(col='#c9ccd2'), 'seat': dict(col='#3c3577'), 'interior': dict(col='#3b3c42'),
                       'glass': dict(alpha=0.75)}),
}
ORDER = ['lintas', 'banteng', 'walet']  # bus 'loop' (trem Sutera Loop) kini dibangun tools/blender/vehicles2.py


def gl(p):  # Blender (kontrak) → glTF
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:  # mesin dipakai bersama pemain: paling banyak 2 thread
        bpy.context.scene.render.threads_mode = 'FIXED'
        bpy.context.scene.render.threads = 2
    except Exception:
        pass


# ---------------------------------------------------------------- v3: AO per verteks + LOD1
NO_OCC = ('glass', 'lens', 'lens_red')  # tembus cahaya: tidak menghalangi


def _mat_names(me):
    return [(m.name.split('.')[0] if m else 'paint') for m in me.materials]


def _tris_world(ob, skip=NO_OCC):
    """Segitiga dunia (verts, polys) dari mesh objek, tanpa material tembus cahaya."""
    me = ob.data
    names = _mat_names(me)
    M = ob.matrix_world
    verts = [M @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons if names[p.material_index] not in skip]
    return verts, polys


def _bvh(objs, ground=True, extra=None):
    from mathutils.bvhtree import BVHTree
    V_, P_ = [], []
    for ob in objs:
        v, p = _tris_world(ob)
        o = len(V_)
        V_ += v
        P_ += [tuple(i + o for i in q) for q in p]
    if ground:
        o = len(V_)
        V_ += [Vector((-30, -30, 0)), Vector((30, -30, 0)), Vector((30, 30, 0)), Vector((-30, 30, 0))]
        P_.append((o, o + 1, o + 2, o + 3))
    return BVHTree.FromPolygons(V_, P_, all_triangles=False, epsilon=0.0)


def _ao_dirs(n):
    """Arah belahan bola berbobot kosinus (ruang tangen, z = normal)."""
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        v = (i * 0.6180339887) % 1.0
        r, ph = math.sqrt(u), 2 * pi * v
        out.append(Vector((r * math.cos(ph), r * math.sin(ph), math.sqrt(max(0.0, 1 - u)))))
    return out


def bake_ao(ob, bvh, maxd=0.9, rays=24, gain=1.0, name='Col'):
    """Oklusi ambien per sudut face → atribut warna (linear): R = AO. Dipakai shader kendaraan (lengkung roda, kolong,
    kabin, celah) — web/game/vehicles.js membacanya sebagai atribut `vao`."""
    me = ob.data
    M = ob.matrix_world
    N3 = M.to_3x3()
    dirs = _ao_dirs(rays)
    attr = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'CORNER')
    cn = me.corner_normals
    cache = {}
    loops = me.loops
    for li in range(len(loops)):
        vi = loops[li].vertex_index
        n = cn[li].vector
        key = (vi, round(n.x * 6), round(n.y * 6), round(n.z * 6))
        ao = cache.get(key)
        if ao is None:
            nw = (N3 @ n).normalized()
            p = M @ me.vertices[vi].co + nw * 0.006
            t = nw.orthogonal().normalized()
            b = nw.cross(t)
            occ = 0.0
            for d in dirs:
                dw = t * d.x + b * d.y + nw * d.z
                hit = bvh.ray_cast(p, dw, maxd)
                if hit[0] is not None:
                    occ += 1.0 - (hit[3] / maxd) ** 2
            ao = max(0.04, 1.0 - gain * occ / rays)
            cache[key] = ao
        attr.data[li].color = (ao, ao, ao, 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass


def finish_v3(objs):
    """AO per verteks: badan (+ setang) ditutupi seluruh kendaraan & tanah; roda hanya oleh dirinya (ia berputar)."""
    t0 = time.time()
    bpy.context.view_layer.update()
    whole = _bvh(objs, ground=True)
    fast = bool(opt('--fast'))
    for ob in objs:
        if ob.name.startswith('wheel'):
            bake_ao(ob, _bvh([ob], ground=False), maxd=0.35, rays=8 if fast else 12)
        else:
            bake_ao(ob, whole, rays=8 if fast else 16)
    log('AO %.1fs' % (time.time() - t0))
    return whole


LOD_DROP = ('lens', 'text')
LOD_COL = {  # warna LOD1 'rest' (linear) yang tidak diambil dari material Blender
    'tire': (0.012, 0.012, 0.013), 'chrome': (0.34, 0.37, 0.42), 'light_head': (1.0, 0.96, 0.86), 'light_tail': (0.55, 0.03, 0.02),
    'light_ind': (0.62, 0.30, 0.03), 'plate': (0.80, 0.80, 0.77), 'disc': (0.30, 0.30, 0.32), 'lens_red': (0.30, 0.02, 0.02),
    'text': (0.02, 0.02, 0.02), 'screen': (0.02, 0.05, 0.07),
}


def _mat_lin(n):
    if n in LOD_COL:
        return LOD_COL[n]
    m = MATS.get(n)
    c = m.diffuse_color if m else (0.3, 0.3, 0.3, 1)
    k = 0.42 if n == 'rim' else 1.0  # velg jauh: rata-rata jari-jari + celah gelap
    return (c[0] * k, c[1] * k, c[2] * k)


def make_lod1(objs, bvh, target=5000, cabin=True, min_size=0.085):
    """LOD1 (dipakai > ±60 m dan sebagai pembuat bayangan): seluruh kendaraan digabung, pulau kecil dibuang, disederhanakan
    (Decimate), lalu dipisah jadi 3 mesh: lod1_paint (material paint, AO di warna verteks), lod1_glass, lod1_rest (warna
    verteks = albedo × AO, satu material 'lodvc'). Roda diganti silinder sederhana (statis)."""
    t0 = time.time()
    drop = set(LOD_DROP) | ({'interior', 'seat'} if cabin else set())
    src = bmesh.new()
    wheels = []
    for ob in objs:
        me = ob.data
        if ob.name.startswith('wheel'):
            bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
            mn = Vector((min(c.x for c in bb), min(c.y for c in bb), min(c.z for c in bb)))
            mx = Vector((max(c.x for c in bb), max(c.y for c in bb), max(c.z for c in bb)))
            wheels.append(((mn + mx) / 2, (mx.z - mn.z) / 2, mx.x - mn.x))
            continue
        names = _mat_names(me)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        tmp.transform(ob.matrix_world)
        for f in tmp.faces:
            f.material_index = MI.get(names[f.material_index], 0)
        # pulau: gabungan face yang berbagi verteks
        seen = set()
        kill = []
        for f0 in tmp.faces:
            if f0 in seen:
                continue
            isl, stack = [], [f0]
            seen.add(f0)
            while stack:
                f = stack.pop()
                isl.append(f)
                for v in f.verts:
                    for g in v.link_faces:
                        if g not in seen:
                            seen.add(g)
                            stack.append(g)
            xs = [v.co for f in isl for v in f.verts]
            dg = (Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
                  - Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))).length
            mats = {MAT_NAMES[f.material_index] for f in isl}
            lightish = any(m.startswith('light') for m in mats)
            if (dg < min_size and not lightish) or dg < 0.03:
                kill += isl
        kill += [f for f in tmp.faces if MAT_NAMES[f.material_index] in drop]
        if kill:
            bmesh.ops.delete(tmp, geom=list(set(kill)), context='FACES')
        merge(src, tmp)
    bmesh.ops.remove_doubles(src, verts=src.verts, dist=0.0005)
    bmesh.ops.triangulate(src, faces=src.faces)
    n0 = len(src.faces)
    wtris = len(wheels) * 96
    ratio = max(0.03, min(1.0, (target - wtris) / max(1, n0)))
    ob = tmp_obj('tmp_lod', src)
    md = ob.modifiers.new('dec', 'DECIMATE')
    md.decimate_type = 'COLLAPSE'
    md.ratio = ratio
    md.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    names = _mat_names(me)
    dec = bmesh.new()
    dec.from_mesh(me)
    for f in dec.faces:
        f.material_index = MI.get(names[f.material_index] if f.material_index < len(names) else 'paint', 0)
    m0 = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(m0)
    bpy.data.meshes.remove(me)
    out = []
    lodvc = bpy.data.materials.get('lodvc') or bpy.data.materials.new('lodvc')
    try:
        lodvc.use_nodes = True
    except Exception:
        pass
    for part in ('paint', 'glass', 'rest'):
        bm = bmesh.new()
        vmap = {}
        for f in dec.faces:
            nm = MAT_NAMES[f.material_index]
            key = nm if nm in ('paint', 'glass') else 'rest'
            if key != part:
                continue
            vs = []
            for v in f.verts:
                k = (v.index, 0 if part != 'rest' else f.material_index)
                if k not in vmap:
                    vmap[k] = bm.verts.new(v.co)
                vs.append(vmap[k])
            try:
                nf = bm.faces.new(vs)
            except ValueError:
                continue
            nf.material_index = f.material_index
        if part == 'rest':
            for (c, R, W) in wheels:  # roda sederhana: ban + pelat velg dua sisi
                rim = R * 0.58
                made = []

                def ring(r, x, a):
                    return bm.verts.new((c.x + x, c.y + r * math.cos(a), c.z + r * math.sin(a)))
                for k in range(12):
                    a0, a1 = 2 * pi * k / 12, 2 * pi * (k + 1) / 12
                    for (ra, xa, rb, xb) in ((rim, -W / 2, R, -W / 2 * 0.8), (R, -W / 2 * 0.8, R, W / 2 * 0.8), (R, W / 2 * 0.8, rim, W / 2)):
                        q = bm.faces.new((ring(ra, xa, a0), ring(rb, xb, a0), ring(rb, xb, a1), ring(ra, xa, a1)))
                        q.material_index = MI['tire']
                        made.append(q)
                    for sx in (-1, 1):
                        q = bm.faces.new((bm.verts.new((c.x + sx * W / 2 * 0.7, c.y, c.z)), ring(rim, sx * W / 2 * 0.86, a0), ring(rim, sx * W / 2 * 0.86, a1)))
                        q.material_index = MI['rim']
                        made.append(q)
                for q in made:
                    q.normal_update()
                    if q.normal.dot(q.calc_center_median() - c) < 0:
                        q.normal_flip()
        if not bm.faces:
            bm.free()
            continue
        bm.verts.index_update()
        bm.normal_update()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(pi) < 42 * D2R
        cols = [_mat_lin(MAT_NAMES[f.material_index]) for f in bm.faces] if part == 'rest' else None
        mesh = bpy.data.meshes.new('lod1_' + part)
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(lodvc if part == 'rest' else MATS[part])
        for p_ in mesh.polygons:
            p_.material_index = 0
        o = bpy.data.objects.new('lod1_' + part, mesh)
        bpy.context.scene.collection.objects.link(o)
        bpy.context.view_layer.update()
        if part != 'glass':
            bake_ao(o, bvh, maxd=0.9, rays=12)
        if cols:
            attr = mesh.color_attributes['Col']
            for p_ in mesh.polygons:
                c = cols[p_.index]
                for li in p_.loop_indices:
                    ao = 0.35 + 0.65 * attr.data[li].color[0]
                    attr.data[li].color = (c[0] * ao, c[1] * ao, c[2] * ao, 1.0)
        out.append(o)
    dec.free()
    log('LOD1 %.1fs' % (time.time() - t0), 'sumber', n0, 'rasio %.3f' % ratio, {o.name: tris_of(o) for o in out})
    return out


def gaps_gl(gaps):
    """Garis celah panel (desain: x kanan, y depan, z atas; simetris kiri-kanan) → larik untuk shader three.js:
    [sumbu, posisi, setengah lebar, min1, max1, min2, max2] dengan sumbu 0=|X| 1=Y(tinggi) 2=Z(depan) dan batas pada dua
    sumbu lainnya berurutan. Tiap entri desain: (sumbu 'x'|'y'|'z', posisi, {sumbu lain: (min, max)}, lebar_mm)."""
    AX = {'x': 0, 'z': 1, 'y': 2}
    out = []
    for g in gaps or []:
        ax, pos, bounds = g[0], g[1], g[2]
        w = (g[3] if len(g) > 3 else 5.0) / 2000.0
        a = AX[ax]
        others = [k for k in (0, 1, 2) if k != a]
        inv = {0: 'x', 1: 'z', 2: 'y'}
        row = [a, round(abs(pos) if ax == 'x' else pos, 4), round(w, 5)]
        for k in others:
            lo, hi = bounds.get(inv[k], (-99.0, 99.0))
            row += [round(lo, 4), round(hi, 4)]
        out.append(row)
    return out


def build(vid):
    reset()
    v = VEH[vid]
    over = dict(v['mats'])
    over['paint'] = dict(over.get('paint', {}), col=v['colors'][0])
    make_materials(over)
    t0 = time.time()
    objs, E, info = v['build']()
    for k, p in E.items():
        make_empty(k, p)
    bpy.context.view_layer.update()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    dims = mx - mn
    tris = sum(tris_of(o) for o in objs)
    log(vid, 'dibangun %.1fs' % (time.time() - t0), 'tris', tris, 'dims L%.2f W%.2f H%.2f' % (dims.y, dims.x, dims.z),
        'zmin %.3f' % mn.z, {o.name: tris_of(o) for o in objs})
    pv = bool(opt('--preview-only'))  # hanya untuk render pratinjau: tanpa bake AO & LOD1 (jangan diekspor)
    bvh = None if pv else finish_v3(objs)
    lods = [] if (pv or opt('--no-lod')) else make_lod1(objs, bvh, target=v.get('lod_tris', 5000), cabin=v.get('cabin', True))
    for o in lods:
        o.hide_render = True
    nodes = {}
    for ob in bpy.context.scene.objects:
        if ob.type == 'EMPTY' or ob.name.startswith('wheel') or ob.name == 'steer':
            nodes[ob.name] = gl(ob.location)
    man = dict(id=vid, name=v['name'], glb=vid + '.glb', length=round(dims.y, 3), width=v['width'],
               height=round(dims.z, 3), bbox=[round(dims.x, 3), round(dims.z, 3), round(dims.y, 3)],
               driver=v['driver'], horn=v.get('horn'), wheelbase=info['wheelbase'], track=info['track'],
               wheelRadius=info['wheelRadius'], seats=v['seats'], tris=tris, colors=v['colors'], nodes=nodes,
               materials=sorted({m.name for o in objs for m in o.data.materials}),
               lod1=[o.name for o in lods], trisLod1=sum(tris_of(o) for o in lods), cabin=bool(v.get('cabin', True)),
               gaps=gaps_gl(v.get('gaps')), dirt=v.get('dirt', 0.5))
    return man


def export_glb(vid):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, vid + '.glb')
    for o in bpy.context.scene.objects:  # LOD1 disembunyikan dari render pratinjau, tapi tetap diekspor
        o.hide_render = False
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_animations=False,
                              export_draco_mesh_compression_enable=False, export_texcoords=True, export_extras=False,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True)
    for o in bpy.context.scene.objects:
        if o.name.startswith('lod1'):
            o.hide_render = True
    log('ekspor', path, os.path.getsize(path), 'byte')


# ---------------------------------------------------------------- render
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
    scn.cycles.max_bounces = 8
    scn.cycles.transparent_max_bounces = 16
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    scn.render.film_transparent = False
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        try:
            scn.view_settings.look = 'Medium High Contrast'
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


def new_mat(name, col, rough=0.5, metal=0.0, em=None, ems=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(col), 1) if isinstance(col, str) else (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if em:
        b.inputs['Emission Color'].default_value = (*srgb(em), 1)
        b.inputs['Emission Strength'].default_value = ems
    return m


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cam_at(target, az, el, dist, lens=50):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.sensor_width = 36
    cam = link(bpy.data.objects.new('cam', cd))
    a, e = az * D2R, el * D2R
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    t = Vector(target)
    cam.location = t + d * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def area(name, loc, target, size, power, color=(1, 1, 1), shape='RECTANGLE', sy=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.shape = shape
    ld.size = size
    if sy:
        ld.size_y = sy
    ld.color = color
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = Vector(loc)
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def studio(floor='#2b2d33', world=0.04):
    """Lantai + latar melengkung (cyclorama) dan lampu studio."""
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
    me.materials.append(new_mat('cyc', floor, rough=0.5))
    cyc = link(bpy.data.objects.new('cyc', me))
    cyc.rotation_euler = (0, 0, pi)  # latar di belakang kendaraan (+Y kontrak)
    w = bpy.data.worlds.new('w')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.6, 0.65, 0.75, 1)
    bg.inputs['Strength'].default_value = world
    return cyc


def studio_lights(L, H):
    k = max(1.0, L / 4)
    area('top', (0, 0, 6.5 * k), (0, 0, 0), 7 * k, 1500 * k * k, (1, 1, 1), sy=3.2 * k)
    area('key', (-3.5 * k, -6.5 * k, 3.4 * k), (0, 0, H * 0.45), 4.0 * k, 700 * k * k, (1.0, 0.96, 0.92))
    area('side', (6.5 * k, -0.5 * k, 2.2 * k), (0, 0, H * 0.45), 1.2 * k, 520 * k * k, (1.0, 0.98, 0.95), sy=6 * k)
    area('rim', (1.5 * k, 7.0 * k, 3.0 * k), (0, 0, H * 0.6), 5 * k, 900 * k * k, (1.0, 0.9, 0.8))
    area('rim2', (-6.5 * k, 3.5 * k, 2.6 * k), (0, 0, H * 0.5), 3 * k, 450 * k * k, (0.82, 0.88, 1.0))


def fit_dist(L, W, H, az, lens=50, aspect=1.6, margin=1.34):
    a = az * D2R
    proj = abs(math.sin(a)) * L + abs(math.cos(a)) * W
    hf = 2 * math.atan(18 / lens)
    vf = 2 * math.atan(18 / aspect / lens)
    return max(proj / 2 / math.tan(hf / 2), H * 1.1 / 2 / math.tan(vf / 2)) * margin + L * 0.25


def quick(vid, man):
    eevee(960, 600)
    studio('#8a8d94', 0.6)
    L, W, H = man['length'], man['width'], man['height']
    studio_lights(L, H)
    os.makedirs(QDIR, exist_ok=True)
    for nm, az, el in (('34f', 38, 10), ('side', 90, 4), ('34r', 145, 14), ('top', 20, 70), ('front', 0, 6)):
        cam = cam_at((0, 0, H * 0.42), az, el, fit_dist(L, W, H, az), 50)
        bpy.context.scene.render.filepath = os.path.join(QDIR, 'q_%s_%s.png' % (vid, nm))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam)
    log('quick', vid, QDIR)


def shot(vid, man):
    cycles(SAMPLES, 1600, 1000)
    studio('#34373e', 0.07)
    L, W, H = man['length'], man['width'], man['height']
    studio_lights(L, H)
    az = 36
    cam_at((0, 0.08 * L, H * 0.40), az, 9, fit_dist(L, W, H, az, 55) * 0.98, 55)
    os.makedirs(PREV, exist_ok=True)
    tag = opt('--tag')  # mis. --tag v3 → preview/vehicles/v3-<id>.png
    bpy.context.scene.render.filepath = os.path.join(PREV, ('%s-%s.png' % (tag, vid)) if isinstance(tag, str) else vid + '.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('shot', vid, '%.1fs' % (time.time() - t0))


def import_glb(vid, loc=(0, 0, 0), rotz=0.0, paint=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, vid + '.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    root = link(bpy.data.objects.new('veh_' + vid, None))
    for o in new:
        if o.parent is None:
            o.parent = root
        if o.type == 'EMPTY' and o is not root:
            o.hide_render = True
    root.location = Vector(loc)
    root.rotation_euler = (0, 0, rotz * D2R)
    if paint:
        copies = {}
        for o in new:
            if o.type != 'MESH':
                continue
            for i, m in enumerate(o.data.materials):
                if m and m.name.split('.')[0] == 'paint':
                    if m not in copies:
                        m2 = m.copy()
                        m2.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*srgb(paint), 1)
                        copies[m] = m2
                    o.data.materials[i] = copies[m]
    return root


def plaza_world():
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    for t in ('MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'HOSEK_WILKIE'):
        try:
            sky.sky_type = t
            break
        except Exception:
            continue
    for k, v in (('sun_elevation', 10 * D2R), ('sun_rotation', 215 * D2R), ('sun_disc', False), ('altitude', 0.0),
                 ('air_density', 1.2), ('aerosol_density', 2.2), ('dust_density', 2.2), ('ozone_density', 1.0)):
        try:
            setattr(sky, k, v)
        except Exception:
            pass
    bg = nt.nodes.get('Background')
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.42
    sd = bpy.data.lights.new('sun', 'SUN')
    sd.energy = 4.2
    sd.angle = 2.2 * D2R
    sd.color = (1.0, 0.86, 0.68)
    sun = link(bpy.data.objects.new('sun', sd))
    sun.rotation_euler = (78 * D2R, 0, 215 * D2R + pi)


def asphalt_mat():
    m = bpy.data.materials.new('asphalt')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 180.0
    noise.inputs['Detail'].default_value = 6.0
    big = nt.nodes.new('ShaderNodeTexNoise')
    big.inputs['Scale'].default_value = 3.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*srgb('#1d1f23'), 1)
    ramp.color_ramp.elements[1].color = (*srgb('#3a3c41'), 1)
    mix = nt.nodes.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY_ADD'
    nt.links.new(noise.outputs['Fac'], mix.inputs[0])
    mix.inputs[1].default_value = 0.6
    nt.links.new(big.outputs['Fac'], mix.inputs[2])
    nt.links.new(mix.outputs[0], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    rr = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(big.outputs['Fac'], rr.inputs['Value'])
    rr.inputs['To Min'].default_value = 0.55
    rr.inputs['To Max'].default_value = 0.85
    nt.links.new(rr.outputs['Result'], b.inputs['Roughness'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.25
    bump.inputs['Distance'].default_value = 0.002
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def plaza(lines=True):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=120)
    me = bpy.data.meshes.new('ground')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(asphalt_mat())
    link(bpy.data.objects.new('ground', me))
    if lines:
        white = new_mat('line', '#e9e7df', rough=0.6)
        gold = new_mat('gold', '#D29F52', rough=0.5, metal=0.2)

        def strip(x, y, sx, sy, rot, mat):
            b = p_box(sx, sy, 0.004)
            bmesh.ops.transform(b, matrix=T(x, y, 0.002) @ Rz(rot), verts=b.verts)
            me2 = bpy.data.meshes.new('ln')
            b.to_mesh(me2)
            b.free()
            me2.materials.append(mat)
            link(bpy.data.objects.new('ln', me2))
        return strip, white, gold
    return None


def mesh_ob(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def scenery(seed=7):
    """Latar: gedung jauh berkabut, pohon, pembatas tanaman."""
    import random
    rnd = random.Random(seed)
    haze = [new_mat('far%d' % i, c, rough=0.9) for i, c in enumerate(('#d3dae3', '#cbd3de', '#d9dfe7', '#c6cfdb'))]
    for k in range(46):
        x = -900 + k * 40 + rnd.uniform(-12, 12)
        y = rnd.uniform(650, 820)
        w, d, h = rnd.uniform(30, 60), rnd.uniform(25, 50), rnd.uniform(35, 110) * (1.5 if rnd.random() < 0.2 else 1)
        b = p_box(w, d, h)
        bmesh.ops.transform(b, matrix=T(x, y, h / 2), verts=b.verts)
        mesh_ob('far', b, rnd.choice(haze))
    leaf = [new_mat('leaf%d' % i, c, rough=0.8) for i, c in enumerate(('#3d5f34', '#4a6b3a', '#355a3a'))]
    bark = new_mat('bark', '#4a3a2c', rough=0.9)
    conc = new_mat('conc', '#a8a398', rough=0.7)
    for k in range(12):
        x, y = -34 + k * 6.6, 20.5 + rnd.uniform(-0.6, 0.6)
        b = p_box(5.6, 1.3, 0.48, bevel=0.05)
        bmesh.ops.transform(b, matrix=T(x, y, 0.24), verts=b.verts)
        mesh_ob('pl', b, conc)
        h = p_sphere(1.0, 16, 8)
        bmesh.ops.transform(h, matrix=T(x, y, 0.85) @ Matrix.Diagonal((2.7, 0.62, 0.62, 1)), verts=h.verts)
        mesh_ob('hd', h, rnd.choice(leaf), True)
    for k in range(16):
        x, y = -50 + k * 6.8 + rnd.uniform(-1.5, 1.5), 31 + rnd.uniform(0, 9)
        hh = rnd.uniform(4.2, 6.6)
        tr = p_cyl(0.16, 0.22, hh * 0.55, 8)
        bmesh.ops.transform(tr, matrix=T(x, y, hh * 0.275), verts=tr.verts)
        mesh_ob('trunk', tr, bark)
        for j in range(3):
            c = p_sphere(rnd.uniform(1.4, 2.2), 14, 8)
            bmesh.ops.transform(c, matrix=T(x + rnd.uniform(-0.8, 0.8), y + rnd.uniform(-0.8, 0.8), hh * 0.62 + j * 0.7 + rnd.uniform(0, 0.6)), verts=c.verts)
            mesh_ob('crown', c, rnd.choice(leaf), True)


def lineup():
    reset()
    cycles(SAMPLES, 1920, 1080)
    plaza_world()
    strip, white, gold = plaza()
    big = bpy.data.objects.get('ground')
    big.scale = (14, 14, 1)
    rot = -32
    spots = [('loop', (-4.6, 6.2)), ('banteng', (4.6, 4.6)), ('lintas', (-1.4, -0.6)), ('walet', (3.0, -1.6))]
    for vid, (x, y) in spots:
        import_glb(vid, (x, y, 0), rot)
    a = rot * D2R
    ux, uy = -math.sin(a), math.cos(a)
    for k in range(-2, 5):
        cx, cy = -3.3 + k * 3.5, -0.6 + k * 0.62
        strip(cx, cy, 0.12, 6.0, rot, white)
    for k in range(-2, 4):
        cx, cy = -1.0 + k * 4.8, 6.0 + k * 0.85
        strip(cx, cy, 0.12, 10.0, rot, white)
    strip(-0.8, -4.6, 0.22, 40.0, -90 + 10, gold)
    scenery()
    cd = bpy.data.cameras.new('cam')
    cd.lens = 40
    cd.sensor_width = 36
    cam = link(bpy.data.objects.new('cam', cd))
    tgt = Vector((0.2, 2.3, 1.35))
    a, e = 18 * D2R, 9 * D2R
    cam.location = tgt + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * 19.5
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    cd.dof.use_dof = True
    cd.dof.focus_distance = (cam.location - Vector((-1.4, -0.6, 0.8))).length
    cd.dof.aperture_fstop = 3.2
    os.makedirs(PREV, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'lineup.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('lineup %.1fs' % (time.time() - t0))


def colors_sheet():
    reset()
    cycles(max(96, SAMPLES // 2), 1920, 1080)
    studio('#34373e', 0.07)
    cols = VEH['lintas']['colors']
    for i, c in enumerate(cols):
        r, k = divmod(i, 3)
        import_glb('lintas', (-5.2 + k * 5.2, -2.6 + r * 5.6, 0), -30, paint=c)
    studio_lights(10.0, 1.5)
    cam_at((0.0, 0.6, 0.3), 10, 30, 21.0, 40)
    bpy.context.scene.render.filepath = os.path.join(PREV, 'colors.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('colors %.1fs' % (time.time() - t0))


def turntable():
    reset()
    scn = bpy.context.scene
    eevee(1280, 720)
    try:
        scn.eevee.taa_render_samples = 12
    except Exception:
        pass
    studio('#34373e', 0.15)
    studio_lights(4.0, 1.5)
    root = import_glb('lintas')
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    scn.frame_start, scn.frame_end = 1, 144
    scn.render.fps = 24
    root.rotation_euler = (0, 0, 0)
    root.keyframe_insert('rotation_euler', index=2, frame=1)
    root.rotation_euler = (0, 0, 2 * pi)
    root.keyframe_insert('rotation_euler', index=2, frame=145)
    try:
        for fc in root.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    except Exception:
        try:
            for layer in root.animation_data.action.layers:
                for strip in layer.strips:
                    for cb in strip.channelbags:
                        for fc in cb.fcurves:
                            for kp in fc.keyframe_points:
                                kp.interpolation = 'LINEAR'
        except Exception as e:
            log('interpolasi', e)
    cam_at((0, 0, 0.62), 30, 12, 8.6, 50)
    im = scn.render.image_settings
    try:
        im.media_type = 'VIDEO'
    except Exception:
        pass
    im.file_format = 'FFMPEG'
    scn.render.ffmpeg.format = 'MPEG4'
    scn.render.ffmpeg.codec = 'H264'
    try:
        scn.render.ffmpeg.constant_rate_factor = 'HIGH'
    except Exception:
        pass
    scn.render.filepath = os.path.join(PREV, 'turntable.mp4')
    t0 = time.time()
    bpy.ops.render.render(animation=True)
    log('turntable %.1fs' % (time.time() - t0))


# ---------------------------------------------------------------- main
def main():
    ids = [v for v in ORDER if not ONLY or v in ONLY]
    mans = []
    for vid in ids:
        man = build(vid)
        if not opt('--no-export'):
            export_glb(vid)
        if opt('--quick'):
            quick(vid, man)
        if opt('--shots'):
            shot(vid, man)
        mans.append(man)
    if not opt('--no-export') and mans:
        path = os.path.join(OUT, 'manifest.json')
        old = []
        if os.path.exists(path):
            try:
                old = json.load(open(path))
            except Exception:
                old = []
        byid = {m['id']: m for m in old}
        for m in mans:
            byid[m['id']] = m
        full = [byid[k] for k in ORDER if k in byid] + [m for k, m in byid.items() if k not in ORDER]  # entri vehicles2.py tetap
        with open(path, 'w') as f:
            json.dump(full, f, indent=1)
        log('manifest', path)
    if opt('--lineup'):
        lineup()
        if not opt('--no-colors'):
            colors_sheet()
    if opt('--turntable'):
        turntable()


if __name__ == '__main__':  # bisa diimpor sebagai pustaka (vehicles2.py)
    main()
