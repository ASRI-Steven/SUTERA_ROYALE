"""Sutera Royale: pesawat angkut penerjun orisinal (4 mesin turboprop, sayap tinggi), Blender headless.

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/plane.py -- [opsi]

Opsi:
  --no-export      lewati ekspor GLB + JSON
  --quick          render cek cepat (EEVEE) ke --qdir
  --shots          render preview Cycles preview/weapons/plane.png
  --samples N      sampel Cycles (default 128)

Kontrak (web/game/assets/plane/plane.glb):
  - glTF: +Y atas, hidung menghadap +Z, origin di tengah badan pesawat (Blender: hidung −Y).
  - node 'plane' (badan, sayap, ekor, nacelle, ramp terbuka) + 'prop_1'..'prop_4' (origin di hub, berputar pada
    sumbu Z lokal), material body, white, gold, dark, glass, metal.
Model dibuat di ruang desain (hidung +Y) lalu diputar 180° di sumbu Z.
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
OUT = os.path.abspath(opt('--out', os.path.join(ROOT, 'web', 'game', 'assets', 'plane')))
PREV = os.path.abspath(opt('--preview', os.path.join(ROOT, 'preview', 'weapons')))
QDIR = os.path.abspath(opt('--qdir', os.path.join(PREV, 'quick')))
SAMPLES = int(opt('--samples', 128))
pi = math.pi
D2R = pi / 180
ROT = Matrix.Rotation(pi, 4, 'Z')


def log(*a):
    print('[plane]', *a, flush=True)


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MAT_NAMES = ['body', 'white', 'gold', 'dark', 'glass', 'metal']
MI = {n: i for i, n in enumerate(MAT_NAMES)}
MAT = {'body': dict(col='#4a3db0', metal=0.15, rough=0.42), 'white': dict(col='#ecebf4', metal=0.1, rough=0.4),
       'gold': dict(col='#D29F52', metal=0.55, rough=0.32), 'dark': dict(col='#1f2433', metal=0.2, rough=0.55),
       'glass': dict(col='#16202e', metal=0.1, rough=0.08), 'metal': dict(col='#a3a8b2', metal=0.6, rough=0.32)}
MATS = {}


def make_materials():
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
        m.diffuse_color = (*srgb(d['col']), 1)
        MATS[n] = m


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Rx(d):
    return Matrix.Rotation(d * D2R, 4, 'X')


def Ry(d):
    return Matrix.Rotation(d * D2R, 4, 'Y')


def Rz(d):
    return Matrix.Rotation(d * D2R, 4, 'Z')


def merge(dst, src, mat=None, M=None, smooth=True):
    flip = M is not None and M.to_3x3().determinant() < 0
    vmap = {v: dst.verts.new(M @ v.co if M is not None else v.co.copy()) for v in src.verts}
    for f in src.faces:
        vs = [vmap[v] for v in f.verts]
        if flip:
            vs.reverse()
        try:
            nf = dst.faces.new(vs)
        except ValueError:
            continue
        nf.material_index = f.material_index if mat is None else MI[mat]
        nf.smooth = smooth
    src.free()


def p_box(sx, sy, sz, bevel=0.0, segs=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, sx * .49, sy * .49, sz * .49), offset_type='OFFSET', segments=segs,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def p_cyly(r1, r2, depth, segs=16):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    bmesh.ops.transform(bm, matrix=Rx(-90), verts=bm.verts)
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


def p_text(body, size, font=None):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = 1
    cu.extrude = 0.012
    if font and os.path.exists(font):
        cu.font = bpy.data.fonts.load(font, check_existing=True)
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


FONT_BOLD = next((f for f in ('/System/Library/Fonts/Supplemental/Arial Black.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf')
                  if os.path.exists(f)), None)


def boolean(bm_target, cutters):
    """Kurangi bm_target (EXACT) dengan daftar bmesh pemotong."""
    def tmp(name, bm):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for n in MAT_NAMES:
            me.materials.append(MATS[n])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob
    tgt = tmp('tgt', bm_target)
    cuts = []
    for k, cb in enumerate(cutters):
        co = tmp('cut%d' % k, cb)
        md = tgt.modifiers.new('b%d' % k, 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.solver = 'EXACT'
        md.object = co
        cuts.append(co)
    me = bpy.data.meshes.new_from_object(tgt.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    names = [m.name.split('.')[0] if m else 'body' for m in me.materials]
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.material_index = MI.get(names[f.material_index] if f.material_index < len(names) else 'body', 0)
    for ob in [tgt] + cuts:
        d = ob.data
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(d)
    bpy.data.meshes.remove(me)
    return bm


# ---------------------------------------------------------------- badan pesawat
R = 2.1          # jari-jari badan
LEN = 30.0


def section(y):
    """(pusat z, jari-jari atas, jari-jari bawah, setengah lebar) sepanjang badan (hidung +Y = 15)."""
    if y > 10.5:  # hidung membulat
        t = (y - 10.5) / 4.5
        k = math.sqrt(max(0.0, 1 - t ** 2.1))
        return (-0.15 * t, R * (0.25 + 0.75 * k) * (1 - 0.12 * t), R * (0.2 + 0.8 * k), R * (0.18 + 0.82 * k))
    if y > -5.5:
        return (0.0, R, R, R)
    t = (-5.5 - y) / 9.5  # ekor naik
    zc = 1.35 * t ** 1.4
    return (zc, R * (1 - 0.55 * t ** 1.2), R * (1 - 0.86 * t ** 1.1), R * (1 - 0.8 * t ** 1.3))


def ring(y, n=36):
    zc, rt, rb, hw = section(y)
    pts = []
    for i in range(n):
        a = 2 * pi * i / n
        c, s = math.cos(a), math.sin(a)
        z = zc + (rt if s > 0 else rb) * s
        pts.append((hw * c * (1.0 if s > -0.2 else 0.97), y, z))
    return pts


def build_body():
    ys = [15.0, 14.85, 14.6, 14.2, 13.6, 12.8, 11.8, 10.5, 8.0, 4.0, 0.0, -3.0, -5.5, -7.5, -9.5, -11.5, -13.2, -14.6, -15.0]
    B = p_loft([ring(y) for y in ys], cap0=False, cap1=True)
    nose = B.verts.new((0, 15.02, -0.15))
    # tutup hidung (kerucut kecil)
    bmesh.ops.remove_doubles(B, verts=B.verts, dist=1e-5)
    B.verts.ensure_lookup_table()
    first = [v for v in B.verts if abs(v.co.y - 15.0) < 1e-4]
    first.sort(key=lambda v: math.atan2(v.co.z + 0.15, v.co.x))
    for i in range(len(first)):
        try:
            B.faces.new((first[i], first[(i + 1) % len(first)], nose))
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(B, faces=B.faces)
    # warna: atas putih, bawah ungu, list emas = tepat satu baris segmen (20°–30°) di batas, jendela kokpit
    for f in B.faces:
        c = f.calc_center_median()
        zc, rt, rb, hw = section(c.y)
        rel = (c.z - zc) / max(rt, 0.01)
        ang = math.degrees(math.atan2(rel, abs(c.x) / max(hw, 0.01)))
        f.material_index = MI['white'] if ang > 30 else MI['body']
        if 20 < ang <= 30 and -12 < c.y < 13.6:
            f.material_index = MI['gold']
        if 12.3 < c.y < 14.3 and 0.22 < rel < 0.78 and abs(c.x) < hw * 0.95:
            f.material_index = MI['glass']
    # ramp belakang: buka bagian bawah ekor (pemotong kotak)
    cut = p_box(4.6, 5.2, 2.6)
    bmesh.ops.transform(cut, matrix=T(0, -8.6, -1.6) @ Rx(-12), verts=cut.verts)
    B = boolean(B, [cut])
    # rongga kargo gelap (terlihat lewat bukaan)
    inner = p_loft([[(x * 0.93, y, z * 0.93) for (x, _, z) in ring(y, 16)] for y in (-3.5, -6.0, -8.5, -10.6)], True, True)
    for f in inner.faces:
        f.material_index = MI['dark']
    bmesh.ops.reverse_faces(inner, faces=inner.faces)
    merge(B, inner, 'dark')
    # lantai ramp diturunkan (engsel di y −6.2)
    ramp = p_box(3.1, 4.6, 0.22, 0.05)
    merge(B, ramp, 'body', T(0, -6.2, -1.55) @ Rx(-22) @ T(0, -2.3, 0))
    for sx in (-1, 1):  # lengan hidrolik ramp
        merge(B, p_box(0.12, 0.12, 1.6), 'metal', T(sx * 1.35, -7.0, -1.65) @ Rx(-55))
    # sponson roda pendarat
    for sx in (-1, 1):
        sp = p_loft([[(sx * (1.88 + w * math.cos(a)), y, -1.45 + h * math.sin(a)) for a in [2 * pi * i / 12 for i in range(12)]]
                     for y, w, h in ((3.9, 0.12, 0.2), (3.0, 0.34, 0.42), (-2.4, 0.34, 0.42), (-3.6, 0.1, 0.18))])
        merge(B, sp, 'body')
    # jendela kabin kecil
    for sx in (-1, 1):
        for i in range(6):
            w = p_cyly(0.17, 0.17, 0.08, 10)
            bmesh.ops.transform(w, matrix=T(sx * (R - 0.02), 7.5 - i * 1.6, 0.25) @ Rz(90), verts=w.verts)
            merge(B, w, 'glass')
    return B


# ---------------------------------------------------------------- sayap, ekor, nacelle
WING_Y, WING_Z = 2.2, 1.95


def wing_part(span_dir, root_x, tip_x, chord_r, chord_t, thick_r, thick_t, y0, z0, sweep=0.6, dihedral=0.0, n=10):
    """Panel sayap: penampang airfoil sederhana (elips pipih, depan tumpul) dari pangkal ke ujung."""
    rings = []
    for x, c, t in ((root_x, chord_r, thick_r), (tip_x, chord_t, thick_t)):
        k = abs(x - root_x) / max(1e-6, abs(tip_x - root_x))
        yy = y0 - sweep * k
        zz = z0 + dihedral * abs(x - root_x)
        pts = []
        for i in range(n):
            a = 2 * pi * i / n
            cy, sz = math.cos(a), math.sin(a)
            fy = (0.42 if cy > 0 else 0.58) * c * cy
            pts.append((span_dir * x, yy + fy, zz + t * 0.5 * sz * (1.0 if cy > -0.3 else 0.55)))
        rings.append(pts)
    return p_loft(rings)


def build_wings(B):
    for s in (-1, 1):
        merge(B, wing_part(s, 0.0, 18.0, 4.3, 2.5, 0.55, 0.26, WING_Y, WING_Z, 0.7, 0.012), 'white')
        tip = p_box(0.15, 1.6, 0.18, 0.06)  # ujung sayap emas
        merge(B, tip, 'gold', T(s * 18.02, WING_Y - 0.75, WING_Z + 0.2))
        for x in (5.2, 10.4):  # nacelle mesin
            ny = WING_Y + 2.0
            nac = p_loft([[(s * x + 0.55 * k * math.cos(a), ny + yy, WING_Z - 0.35 + 0.7 * k * math.sin(a) * (1.0 if math.sin(a) > 0 else 1.15))
                           for a in [2 * pi * i / 14 for i in range(14)]] for yy, k in ((1.9, 0.62), (1.4, 1.0), (-1.5, 1.0), (-3.2, 0.55), (-3.9, 0.25))])
            merge(B, nac, 'body')
            merge(B, p_cyly(0.64, 0.64, 0.12, 14), 'gold', T(s * x, ny + 1.25, WING_Z - 0.35))  # cincin emas
            merge(B, p_box(0.32, 0.5, 0.18, 0.05), 'dark', T(s * x + s * 0.5, ny + 0.2, WING_Z - 0.75))  # knalpot
    # ekor tegak + stabilisator
    fin = [[(0.34 * k * math.sin(a) * (1.0 if math.cos(a) > -0.3 else 0.6), y + 0.5 * w * math.cos(a), z) for a in [2 * pi * i / 12 for i in range(12)]]
           for (y, z, w, k) in ((-11.2, 1.0, 5.6, 1.0), (-12.4, 4.4, 4.0, 0.85), (-13.7, 7.6, 2.4, 0.65))]
    merge(B, p_loft(fin), 'body')
    merge(B, p_box(0.70, 2.6, 0.5, 0.15), 'gold', T(0, -13.7, 7.65))
    for s in (-1, 1):
        merge(B, wing_part(s, 0.0, 6.6, 3.2, 1.7, 0.32, 0.16, -12.9, 2.15, 0.9, 0.0, 10), 'white')
    # logo SR emas di sirip
    for s in (-1, 1):
        t = p_text('SR', 1.3, FONT_BOLD)
        merge(B, t, 'gold', T(s * 0.31, -12.5, 4.4) @ Rz(90 * s) @ Rx(90), smooth=False)


def build_text(B):
    for s in (-1, 1):
        t = p_text('SUTERA ROYALE', 0.85, FONT_BOLD)
        merge(B, t, 'white', T(s * (R + 0.012), 2.0, -0.5) @ Rz(90 * s) @ Rx(90), smooth=False)


def build_prop():
    P = bmesh.new()
    merge(P, p_cyly(0.42, 0.0, 1.0, 14), 'white', T(0, 0.55, 0))  # spinner (kerucut menghadap depan)
    merge(P, p_cyly(0.44, 0.44, 0.3, 14), 'metal', T(0, -0.05, 0))
    for i in range(6):
        a = i * 60
        secs = []
        for r, chord, twist, sweep in ((0.32, 0.20, 40, 0.0), (0.7, 0.32, 33, 0.02), (1.2, 0.33, 24, 0.06), (1.65, 0.27, 17, 0.14), (2.0, 0.17, 12, 0.24),
                                       (2.12, 0.06, 10, 0.3)):
            ring = []
            for k in range(8):
                ang = 2 * pi * k / 8
                cx, cy = 0.5 * chord * math.cos(ang), 0.028 * (chord / 0.33) * math.sin(ang)
                tw = twist * D2R
                ring.append((sweep + cx * math.cos(tw) - cy * math.sin(tw), cx * math.sin(tw) + cy * math.cos(tw), r))
            secs.append(ring)
        blade = p_loft(secs)
        for f in blade.faces:
            f.material_index = MI['gold'] if f.calc_center_median().z > 1.85 else MI['dark']
        bmesh.ops.transform(blade, matrix=Ry(a), verts=blade.verts)
        merge(P, blade, None)
    return P


def make_obj(name, bm, loc=(0, 0, 0)):
    for v in bm.verts:
        v.co = ROT @ v.co
    bm.normal_update()
    for f in bm.faces:  # halus, tepi bersudut > 38° tetap tegas
        f.smooth = True
    for e in bm.edges:
        if not e.is_manifold or e.calc_face_angle(pi) > 38 * D2R:
            e.smooth = False
    tris = sum(len(f.verts) - 2 for f in bm.faces)
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
    ob.location = ROT @ Vector(loc)
    bpy.context.scene.collection.objects.link(ob)
    return ob, tris


PROPS = []


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    t0 = time.time()
    B = build_body()
    build_wings(B)
    build_text(B)
    ob, tris = make_obj('plane', B)
    objs = [ob]
    PROPS.clear()
    for i, (sx, x) in enumerate(((-1, 10.4), (-1, 5.2), (1, 5.2), (1, 10.4))):
        hub = Vector((sx * x, WING_Y + 2.0 + 2.05, WING_Z - 0.35))
        po, pt = make_obj('prop_%d' % (i + 1), build_prop(), hub)
        objs.append(po)
        tris += pt
        PROPS.append(hub)
    log('dibangun %.1fs' % (time.time() - t0), 'tris', tris)
    return objs, tris


def gl(p):
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


def export(objs, tris):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, 'plane.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=False, export_cameras=False, export_lights=False, export_animations=False,
                              export_extras=False, export_draco_mesh_compression_enable=False)
    meta = dict(length=LEN, span=36.2, tris=tris, props=[gl(ROT @ p) for p in PROPS], spinAxis='Z lokal',
                note='glTF: +Y atas, hidung +Z, origin tengah badan; ramp belakang terbuka')
    with open(os.path.join(OUT, 'plane.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    log('ekspor', path, os.path.getsize(path), 'byte')


# ---------------------------------------------------------------- render
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cam_look(loc, target, lens=50):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.clip_end = 20000
    cam = link(bpy.data.objects.new('cam', cd))
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def sky_world(strength=1.0):
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bg = nt.nodes['Background']
    try:
        sky = nt.nodes.new('ShaderNodeTexSky')
        try:
            sky.sun_elevation = 38 * D2R
            sky.sun_rotation = 200 * D2R
        except Exception:
            pass
        nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = 0.22 * strength
    except Exception as e:
        log('sky', e)
        bg.inputs['Color'].default_value = (0.45, 0.62, 0.9, 1)
    return w


def grad_world(bottom, top, light, strength):
    """Latar gradien layar (bawah → atas) untuk sinar kamera; warna 'light' sebagai cahaya lingkungan."""
    w = bpy.data.worlds.new('grad')
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bl = nt.nodes['Background']
    bl.inputs['Color'].default_value = (*srgb(light), 1)
    bl.inputs['Strength'].default_value = strength
    bc = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*srgb(bottom), 1)
    ramp.color_ramp.elements[1].color = (*srgb(top), 1)
    nt.links.new(tc.outputs['Window'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bc.inputs['Color'])
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs[0])
    nt.links.new(bl.outputs[0], mix.inputs[1])
    nt.links.new(bc.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes['World Output'].inputs['Surface'])
    return w


def quick():
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x, scn.render.resolution_y = 1200, 700
    sky_world(1.0)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4
    so = link(bpy.data.objects.new('sun', sun))
    so.rotation_euler = (45 * D2R, 10 * D2R, 30 * D2R)
    os.makedirs(QDIR, exist_ok=True)
    for nm, loc, tgt in (('34', (34, 30, 12), (0, 0, 0)), ('rear', (-18, -42, -8), (0, 0, 0)), ('side', (55, 0, 2), (0, 0, 0)),
                         ('ramp', (9, 34, -11), (0, 8, -1.5))):
        cam_look(loc, tgt, 50)
        scn.render.filepath = os.path.join(QDIR, 'p_%s.png' % nm)
        bpy.ops.render.render(write_still=True)
    log('quick', QDIR)


def shot():
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
        log('GPU', e)
    scn.cycles.samples = SAMPLES
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = 1920, 1080
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    grad_world('#e6edf5', '#5a8bd3', '#a7c1e6', 0.75)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.4
    sun.angle = 0.02
    so = link(bpy.data.objects.new('sun', sun))
    so.rotation_euler = (50 * D2R, 0, 30 * D2R)  # dari depan-kiri-atas (sisi kamera)
    # pesawat sedikit miring (belok)
    for o in [bpy.data.objects['plane']] + [bpy.data.objects['prop_%d' % i] for i in range(1, 5)]:
        o.matrix_world = Matrix.Rotation(7 * D2R, 4, 'Y') @ Matrix.Rotation(-3 * D2R, 4, 'X') @ o.matrix_world
    # baling-baling berputar: kunci rotasi per frame + motion blur
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    for i in range(1, 5):
        p = bpy.data.objects['prop_%d' % i]
        e0 = p.rotation_euler.copy()
        for fr in (0, 1, 2):
            e = e0.copy()
            e.rotate_axis('Y', (i * 23 + fr * 45) * D2R)
            p.rotation_euler = e
            p.keyframe_insert('rotation_euler', frame=fr)
    scn.frame_set(1)
    scn.render.use_motion_blur = True
    scn.render.motion_blur_shutter = 0.5
    cam_look((36, -39, 7.5), (0.5, -1.8, 0.4), 50)
    os.makedirs(PREV, exist_ok=True)
    scn.render.filepath = os.path.join(PREV, 'plane.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('shot %.1fs' % (time.time() - t0))


def main():
    objs, tris = build_all()
    if not opt('--no-export'):
        export(objs, tris)
    if opt('--quick'):
        quick()
    if opt('--shots'):
        shot()


main()
