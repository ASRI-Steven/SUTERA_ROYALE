"""Sutera Royale: kendaraan gelombang 2, dimodelkan prosedural di Blender (headless).

  loop        trem Sutera Loop (shuttle kawasan Alam Sutera) — menggantikan bus lama, id tetap 'loop'
  halilintar  supercar baji (desain orisinal, tanpa logo/nama merek)
  jawara      motor cruiser V-twin (desain orisinal, tanpa logo/nama merek)

Jalankan dari root proyek:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/vehicles2.py -- [opsi]

Opsi:
  --only loop,halilintar   hanya kendaraan tertentu
  --no-export              lewati ekspor GLB + manifest
  --quick                  render cek cepat (EEVEE, 5 sudut) ke --qdir
  --shots                  render preview Cycles ke preview/vehicles/v2-<id>.png
  --lineup                 render preview/vehicles/v2-lineup.png (dari GLB yang sudah diekspor)
  --samples N              sampel Cycles (default 160)

Kontrak GLB, pustaka geometri, material, dan render sama dengan tools/blender/vehicles.py (diimpor sebagai modul):
ruang desain depan +Y, kanan +X, atas +Z; diputar 180° di Z saat jadi objek → depan = +Z glTF. Kiri kendaraan = −X desain.
v3 (roda, lampu, pelat, AO per verteks, LOD1, celah panel, opsi --tag/--preview-only/--fast): lihat docstring vehicles.py.
"""
import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vehicles as V  # noqa: E402  (pustaka; main() vehicles.py hanya jalan bila dieksekusi langsung)
from vehicles import (D2R, MI, MX, T, Rx, Ry, Rz, boolean, expand_keys, headliner, interp, log, make_obj, merge,  # noqa: E402
                      opt, orient, p_box, p_cyl, p_cylx, p_cyly, p_lathe, p_loft, p_path, p_sphere, p_text, p_torus,
                      p_tube, pi, put, ring_body, ring_ellipse, ring_gh, ring_plan, wheel_bm)

FONT_SCRIPT = next((f for f in ('/System/Library/Fonts/Supplemental/Brush Script.ttf',
                                '/System/Library/Fonts/Supplemental/Apple Chancery.ttf') if os.path.exists(f)), None)
FONT_BOLD = V.FONT_BOLD
ONLY = V.ONLY
SAMPLES = V.SAMPLES

# teks menghadap ke luar: sisi kanan (+X), kiri (−X), depan (+Y), belakang (−Y); huruf terbaca dari luar
M_RIGHT = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
M_LEFT = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
M_FRONT = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
M_BACK = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


# ---------------------------------------------------------------- bantuan geometri
def rrect(u0, u1, v0, v1, rt, rb=0.0, n=6):
    """Persegi panjang membulat di bidang (u, v): rt = jari-jari sudut atas, rb = bawah. Urut CCW."""
    pts = []

    def arc(cu, cv, r, a0, a1):
        if r <= 1e-4:
            pts.append((cu, cv))
            return
        for k in range(n + 1):
            a = a0 + (a1 - a0) * k / n
            pts.append((cu + r * math.cos(a), cv + r * math.sin(a)))
    arc(u1 - rb, v0 + rb, rb, -pi / 2, 0)
    arc(u1 - rt, v1 - rt, rt, 0, pi / 2)
    arc(u0 + rt, v1 - rt, rt, pi / 2, pi)
    arc(u0 + rb, v0 + rb, rb, pi, 3 * pi / 2)
    return pts


def prism(pts_uv, w0, w1, axis):
    """Prisma tertutup dari poligon (u, v) diekstrusi sepanjang sumbu: 'x' → (w, u, v); 'y' → (u, w, v)."""
    bm = bmesh.new()

    def P(u, v, w):
        return (w, u, v) if axis == 'x' else (u, w, v)
    a = [bm.verts.new(P(u, v, w0)) for (u, v) in pts_uv]
    b = [bm.verts.new(P(u, v, w1)) for (u, v) in pts_uv]
    n = len(pts_uv)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ribbon_side(center, half, x, s, n_out=None):
    """Pita datar di sisi samping (bidang y,z) pada x = s·x, menghadap ±X. center = [(y, z)], half = setengah lebar."""
    bm = bmesh.new()
    m = len(center)
    A, B = [], []
    for i, (y, z) in enumerate(center):
        y0, z0 = center[max(0, i - 1)]
        y1, z1 = center[min(m - 1, i + 1)]
        ty, tz = y1 - y0, z1 - z0
        L = math.hypot(ty, tz) or 1.0
        ny, nz = -tz / L, ty / L
        w = half[i]
        A.append(bm.verts.new((s * x, y + ny * w, z + nz * w)))
        B.append(bm.verts.new((s * x, y - ny * w, z - nz * w)))
    for i in range(m - 1):
        try:
            bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
        except ValueError:
            pass
    orient(bm, lambda c: Vector((s, 0, 0)))
    return bm


def side_text(dst, text, size, font, x, y, z, s, mat, res=3):
    tx = p_text(text, size, font, res=res)
    merge(dst, tx, mat, T(s * x, y, z) @ (M_RIGHT if s > 0 else M_LEFT))


def hexagon(r, depth):
    """Prisma segienam (sumbu Z)."""
    return p_cyl(r, r, depth, 6)


def disc_dish(r0, r1, x, side, segs):
    """Piringan datar (cincin r0..r1) di bidang YZ pada x, menghadap ±X."""
    d = p_lathe([(r0, x), (r1, x)], segs)
    orient(d, lambda c: Vector((side, 0, 0)))
    return d


def recolor(bm, src, dst):
    for f in bm.faces:
        if f.material_index == MI[src]:
            f.material_index = MI[dst]


def wheel_obj(name, center, bm, ang=40):
    bmesh.ops.transform(bm, matrix=T(*center), verts=bm.verts)
    return make_obj(name, bm, origin=center, ang=ang)


# ================================================================ SUTERA LOOP (trem)
LOOP = dict(wb=3.9, R=0.44, track=1.96, hw=1.15, floor=0.98, sill=1.45, band=2.30, roof=2.58)


def wheel_trolley(R, W, rim_r, side):
    """Roda trem: velg emas berjari-jari 10 + cincin, dop krom (roda v3: ban ber-UV, tong velg, cakram rem)."""
    return V.wheel_v3(R, W, rim_r, side, 'trolley', segs=32)


def build_loop():
    P = LOOP
    wb, R, hw, FL = P['wb'], P['R'], P['hw'], P['floor']
    SIDE = [round(2.9 - 0.58 * k, 3) for k in range(11)]  # 2.9 … −2.9 (di dalam bagian lurus semua cincin)
    FRONT, REAR = [0.25, 0.50], [0.25, 0.50]
    LV = [  # z, yF, yR, hw, rcF, rcR
        (0.34, 3.48, -3.48, 1.100, 0.40, 0.40), (0.40, 3.54, -3.54, 1.140, 0.44, 0.44),
        (0.48, 3.56, -3.56, 1.150, 0.45, 0.45), (1.44, 3.56, -3.56, 1.150, 0.45, 0.45),
        (1.47, 3.555, -3.555, 1.150, 0.45, 0.45), (2.30, 3.50, -3.52, 1.140, 0.44, 0.44),
        (2.46, 3.48, -3.50, 1.130, 0.43, 0.43), (2.52, 3.44, -3.46, 1.100, 0.40, 0.40),
        (2.555, 3.38, -3.40, 1.040, 0.36, 0.36), (2.58, 3.30, -3.32, 0.960, 0.30, 0.30)]
    solid, _, _ = p_loft([ring_plan(z, a, b, h, rf, rr, SIDE, FRONT, REAR) for (z, a, b, h, rf, rr) in LV])
    for f in solid.faces:
        f.material_index = MI['paint']
    cut = []
    cab = p_box(2.20, 6.86, 2.48 - FL)
    bmesh.ops.transform(cab, matrix=T(0, -0.015, FL + (2.48 - FL) / 2), verts=cab.verts)
    cut.append((cab, 'interior'))
    WIN_Y = [-2.65, -1.75, -0.85, 0.05, 0.95, 1.85]
    for s in (1, -1):
        x0, x1 = s * 0.92, s * 1.40
        for yc in WIN_Y:
            cut.append((prism(rrect(yc - 0.39, yc + 0.39, 1.50, 2.22, 0.17, 0.04), min(x0, x1), max(x0, x1), 'x'), 'trim'))
        if s > 0:  # jendela sopir (kanan)
            cut.append((prism(rrect(2.36, 3.02, 1.50, 2.22, 0.17, 0.04), 0.92, 1.40, 'x'), 'trim'))
        else:  # pintu penumpang (kiri depan): sampai ke tangga
            cut.append((prism(rrect(2.34, 3.06, 0.50, 2.22, 0.17, 0.0), -1.40, -0.52, 'x'), 'trim'))
    for x0, x1 in ((-1.00, -0.05), (0.05, 1.00)):  # kaca depan terbelah
        cut.append((prism(rrect(x0, x1, 1.52, 2.26, 0.17, 0.03), 3.25, 3.80, 'y'), 'trim'))
    for x0, x1 in ((-0.95, -0.08), (0.08, 0.95)):  # jendela belakang
        cut.append((prism(rrect(x0, x1, 1.58, 2.22, 0.15, 0.03), -3.80, -3.25, 'y'), 'trim'))
    for y in (wb / 2, -wb / 2):
        for s in (1, -1):
            a = p_cylx(R + 0.06, 0.46, 30)
            bmesh.ops.transform(a, matrix=T(s * 1.0, y, R), verts=a.verts)
            cut.append((a, 'tire'))
    shell = boolean(solid, cut)
    for f in shell.faces:
        c, n = f.calc_center_median(), f.normal
        m = V.MAT_NAMES[f.material_index]
        if m == 'paint':
            if n.z < -0.5:
                m = 'tire'
            elif c.z > 2.47 or (n.z > 0.5 and c.z > 2.3):
                m = 'plate'
            elif c.z >= P['sill']:
                m = 'trim'
        elif m == 'interior':
            if n.z > 0.5:
                m = 'interior'
            elif n.z < -0.5:
                m = 'plate'
            elif c.z < P['sill']:
                m = 'seat'
            else:
                m = 'trim'
        f.material_index = MI[m]
    body = bmesh.new()
    merge(body, shell)

    # ---- atap: lantera (clerestory) + jendela kecil + rel atap
    put(body, p_box(1.50, 5.70, 0.26, bevel=0.06, segs=2), 'plate', T(0, -0.05, 2.58 + 0.12))
    for s in (1, -1):
        for k in range(8):
            put(body, p_box(0.012, 0.50, 0.10, bevel=0.01), 'glass', T(s * 0.752, -2.55 + k * 0.70, 2.72))
        rail = [(s * 0.98, 2.9, 2.585), (s * 0.98, 2.9, 2.66), (s * 0.98, -2.9, 2.66), (s * 0.98, -2.9, 2.585)]
        put(body, p_path(rail, 0.018, 8), 'plate')
        for y in (1.45, 0.0, -1.45):
            put(body, p_tube((s * 0.98, y, 2.585), (s * 0.98, y, 2.66), 0.014, 6), 'plate')
        put(body, p_box(0.06, 0.06, 0.035, bevel=0.01), 'light_ind', T(s * 0.85, 3.32, 2.585))  # lampu sein atap
    # ---- garis krem & lengkung spakbor
    for s in (1, -1):
        put(body, p_box(0.008, 6.30, 0.028), 'paint2', T(s * 1.153, 0, 1.415))
        for (y0, y1) in ((-3.05, -2.52), (-1.38, 1.38), (2.52, 3.05)):
            put(body, p_box(0.008, y1 - y0, 0.024), 'paint2', T(s * 1.153, (y0 + y1) / 2, 0.53))
        for y in (wb / 2, -wb / 2):
            fl = p_lathe([(R + 0.06, 1.146), (R + 0.06, 1.160), (R + 0.105, 1.160), (R + 0.105, 1.146)], 18,
                         a0=-4 * D2R, a1=184 * D2R, closed_prof=True, cap_ends=True)
            bmesh.ops.recalc_face_normals(fl, faces=fl.faces)
            merge(body, fl, 'paint2', T(0, y, R) @ (MX() if s < 0 else Matrix()))
    # ---- swoosh krem dengan tulisan "Sutera Loop" (kedua sisi)
    for s in (1, -1):
        sw, hf = [], []
        for k in range(46):  # pita: dari belakang (gulungan) ke depan, menipis
            t = k / 45
            y = -2.30 + 4.35 * t
            z = 0.93 + 0.13 * math.sin(t * pi * 1.15 - 0.35) - 0.05 * t
            sw.append((y, z))
            bump = max(0.0, math.sin(pi * min(1.0, t / 0.86))) ** 0.7
            hf.append((0.04 + 0.16 * bump * (1 - 0.45 * t)) * (1 - 0.85 * max(0.0, (t - 0.9) / 0.1)))
        put(body, ribbon_side(sw, hf, 1.156, s), 'paint2')
        loop_c, loop_h = [], []
        for k in range(30):  # gulungan "loop" di ujung belakang
            a = pi * 0.5 + k / 29 * 1.75 * pi
            r = 0.23 - 0.07 * k / 29
            loop_c.append((-2.30 + r * math.cos(a) * 1.05, 0.98 + r * math.sin(a)))
            loop_h.append(0.045 - 0.02 * k / 29)
        put(body, ribbon_side(loop_c, loop_h, 1.157, s), 'paint2')
        side_text(body, 'Sutera Loop', 0.44, FONT_SCRIPT, 1.163, -0.30, 1.015, s, 'paint', res=4)
    # ---- depan
    for s in (1, -1):
        V.round_lamp(body, (s * 0.80, 3.565, 0.98), 0.145, depth=0.075, segs=24)  # lampu klasik: ember krom + kaca cembung
        V.round_lamp(body, (s * 0.80, 3.565, 0.70), 0.055, depth=0.03, kind='ind', segs=14)
        mir = [(s * 1.12, 3.20, 2.12), (s * 1.30, 3.48, 2.06), (s * 1.36, 3.60, 1.84)]
        put(body, p_path(mir, 0.018, 8), 'chrome')
        put(body, p_box(0.12, 0.05, 0.28, bevel=0.03), 'tire', T(s * 1.36, 3.62, 1.70))
        put(body, p_box(0.10, 0.006, 0.24), 'chrome', T(s * 1.36, 3.592, 1.70))
    put(body, p_box(0.64, 0.05, 0.48, bevel=0.035, segs=2), 'chrome', T(0, 3.57, 0.94))
    put(body, p_box(0.55, 0.05, 0.40), 'tire', T(0, 3.585, 0.94))
    for k in range(9):
        put(body, p_box(0.018, 0.04, 0.40), 'chrome', T(-0.24 + k * 0.06, 3.60, 0.94))
    put(body, p_box(0.92, 0.02, 0.17, bevel=0.01), 'paint2', T(0, 3.568, 0.585))
    tx = p_text('Sutera Loop', 0.15, FONT_SCRIPT, res=4)
    merge(body, tx, 'paint', T(0, 3.582, 0.585) @ M_FRONT)
    put(body, p_box(2.22, 0.14, 0.12, bevel=0.045, segs=2), 'chrome', T(0, 3.62, 0.44))
    put(body, p_box(2.10, 0.08, 0.10, bevel=0.02), 'tire', T(0, 3.55, 0.36))
    put(body, p_box(1.30, 0.05, 0.17, bevel=0.015), 'tire', T(0, 3.505, 2.38))
    tx = p_text('SUTERA LOOP', 0.10, FONT_BOLD, res=2)
    merge(body, tx, 'light_ind', T(0, 3.532, 2.38) @ M_FRONT)
    for s in (1, -1):  # kaca depan
        put(body, p_box(0.93, 0.02, 0.72), 'glass', T(s * 0.525, 3.47, 1.89))
        put(body, p_box(0.50, 0.012, 0.012), 'tire', T(s * 0.50, 3.53, 1.58) @ Ry(s * 8))
    # ---- belakang
    for s in (1, -1):
        V.round_lamp(body, (s * 0.85, -3.565, 0.98), 0.11, depth=0.05, back=True, kind='tail', segs=20)
        V.round_lamp(body, (s * 0.85, -3.565, 0.72), 0.048, depth=0.028, back=True, kind='ind', segs=14)
        put(body, p_box(0.85, 0.02, 0.62), 'glass', T(s * 0.515, -3.47, 1.90))
    tx = p_text('Sutera Loop', 0.22, FONT_SCRIPT, res=4)
    merge(body, tx, 'paint2', T(0, -3.575, 1.20) @ M_BACK)
    put(body, p_box(2.22, 0.14, 0.12, bevel=0.045, segs=2), 'chrome', T(0, -3.62, 0.44))
    merge(body, V.plate_bm('B 7001 SLP', 0.46, 0.125), M=T(0, -3.587, 0.62) @ Rz(180))
    put(body, p_tube((-0.75, -3.30, 0.36), (-0.75, -3.66, 0.36), 0.045, 12), 'chrome')
    # ---- pintu kiri: anak tangga + pegangan
    put(body, p_box(0.30, 0.70, 0.04), 'tire', T(-1.00, 2.70, 0.64))
    put(body, p_box(0.34, 0.70, 0.04), 'tire', T(-0.72, 2.70, 0.81))
    put(body, p_box(0.62, 0.72, 0.12), 'interior', T(-0.85, 2.70, 0.56))
    for y in (2.38, 3.02):
        put(body, p_tube((-0.98, y, 1.00), (-0.98, y, 2.15), 0.018, 8), 'chrome')
    # ---- interior: kursi sopir, dasbor, kemudi, bangku kayu, tiang & pegangan
    put(body, p_box(2.10, 0.30, 0.34, bevel=0.04), 'interior', T(0, 3.28, FL + 0.55))
    merge(body, V.steering_bm(0.21, 0.022), M=T(0.62, 3.14, 1.82) @ Rx(35))
    put(body, p_tube((0.62, 3.30, 1.55), (0.62, 3.16, 1.80), 0.03, 8), 'tire')
    put(body, p_box(0.50, 0.46, 0.08, bevel=0.02), 'seat', T(0.62, 2.80, 1.36))
    put(body, p_box(0.50, 0.08, 0.62, bevel=0.02), 'seat', T(0.62, 2.55, 1.70) @ Rx(10))
    put(body, p_box(0.36, 0.36, 0.38), 'interior', T(0.62, 2.80, 1.13))
    ROWS = [1.55, 0.70, -0.15, -1.00, -1.85, -2.70]

    def bench(x, y, w):
        put(body, p_box(w, 0.42, 0.06, bevel=0.015), 'seat', T(x, y, 1.37))
        for k in range(3):
            put(body, p_box(w, 0.035, 0.085, bevel=0.01), 'seat', T(x, y - 0.205 - k * 0.012, 1.50 + k * 0.13) @ Rx(-8))
        for dx in (-w / 2 + 0.08, w / 2 - 0.08):
            put(body, p_box(0.05, 0.36, 0.36), 'tire', T(x + dx, y, FL + 0.19))
        put(body, p_box(w, 0.025, 0.025), 'chrome', T(x, y - 0.24, 1.87))
    for y in ROWS:
        bench(0.66, y, 0.86)
        if y < 2.3:
            bench(-0.66, y, 0.86)
    put(body, p_box(1.66, 0.40, 0.06, bevel=0.015), 'seat', T(0, -3.12, 1.37))
    for k in range(3):
        put(body, p_box(1.66, 0.035, 0.085, bevel=0.01), 'seat', T(0, -3.33 - k * 0.012, 1.50 + k * 0.13) @ Rx(-8))
    put(body, p_box(1.66, 0.40, 0.40), 'interior', T(0, -3.12, FL + 0.19))
    for x in (0.26, -0.26):
        put(body, p_tube((x, 2.15, FL), (x, 2.15, 2.48), 0.02, 8), 'chrome')
        put(body, p_tube((x, -3.0, 2.24), (x, 2.2, 2.24), 0.016, 6), 'chrome')
    for y in (2.0, 0.6, -0.8, -2.2):
        put(body, p_box(0.50, 0.30, 0.03, bevel=0.01), 'light_head', T(0, y, 2.465))
    objs = [make_obj('body', body)]
    for nm, x, y in (('wheel_fl', -P['track'] / 2, wb / 2), ('wheel_fr', P['track'] / 2, wb / 2),
                     ('wheel_rl', -P['track'] / 2, -wb / 2), ('wheel_rr', P['track'] / 2, -wb / 2)):
        objs.append(wheel_obj(nm, (x, y, R), wheel_trolley(R, 0.26, 0.30, 1 if x > 0 else -1)))
    E = {'seat_driver': (0.62, 2.80, 1.45), 'eye_driver': (0.62, 2.70, 2.15), 'exit_l': (-2.05, 2.70, 0.0),
         'exit_r': (2.05, 2.80, 0.0), 'exhaust': (-0.75, -3.68, 0.36), 'light_fl': (-0.80, 3.60, 0.98),
         'light_fr': (0.80, 3.60, 0.98)}
    k = 1
    for y in ROWS[:5]:
        for x in (0.66, -0.66):
            E['seat_p%d' % k] = (x, y + 0.02, 1.45)
            k += 1
    E['seat_p%d' % k] = (0.0, -3.10, 1.45)
    return objs, E, dict(wheelbase=wb, track=P['track'], wheelRadius=R)


# ================================================================ HALILINTAR (supercar baji)
def subsurf(bm, levels=1):
    """Halus-kan bmesh dengan Catmull-Clark (material per face dipertahankan)."""
    ob = V.tmp_obj('tmp_ss', bm)
    md = ob.modifiers.new('ss', 'SUBSURF')
    md.levels = md.render_levels = levels
    md.quality = 3
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    names = [(m.name.split('.')[0] if m else 'paint') for m in me.materials]
    out = bmesh.new()
    out.from_mesh(me)
    for f in out.faces:
        f.material_index = MI.get(names[f.material_index] if f.material_index < len(names) else 'paint', 0)
    m0 = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(m0)
    bpy.data.meshes.remove(me)
    out.normal_update()
    return out


def wheel_super(R, W, rim_r, side):
    """Velg gelap cekung 5 jari-jari bercabang (Y), mur tengah segienam krom, cakram rem besar (roda v3)."""
    return V.wheel_v3(R, W, rim_r, side, 'super', segs=36)


def build_halilintar():
    """Supercar baji: badan di-loft lalu dihaluskan (Catmull-Clark), detail dipotong boolean (intake, lampu, pintu)."""
    wb, R, rim_r = 2.62, 0.345, 0.255
    trf, trr = 1.67, 1.62
    BODY = [  # y, hw, zb, zt, rb, rt, tuck, tumble, crown
        (2.30, 0.62, 0.20, 0.36, 0.04, 0.04, 0.03, 0.05, 0.000),
        (2.26, 0.82, 0.15, 0.43, 0.05, 0.05, 0.03, 0.07, 0.000),
        (2.16, 0.92, 0.125, 0.49, 0.05, 0.06, 0.03, 0.09, 0.006),
        (1.98, 0.955, 0.115, 0.585, 0.05, 0.07, 0.03, 0.10, -0.040),  # spakbor depan lebih tinggi dari kap (crown negatif)
        (1.70, 0.965, 0.11, 0.690, 0.05, 0.08, 0.03, 0.11, -0.080),
        (1.31, 0.965, 0.11, 0.765, 0.05, 0.08, 0.03, 0.11, -0.100),
        (1.05, 0.955, 0.11, 0.780, 0.05, 0.08, 0.03, 0.12, -0.060),
        (0.70, 0.940, 0.11, 0.790, 0.05, 0.08, 0.03, 0.13, -0.020),
        (0.20, 0.930, 0.11, 0.80, 0.05, 0.08, 0.03, 0.13, 0.000),
        (-0.40, 0.945, 0.11, 0.83, 0.05, 0.08, 0.03, 0.12, 0.000),
        (-0.95, 0.968, 0.115, 0.87, 0.05, 0.08, 0.03, 0.11, 0.000),
        (-1.31, 0.968, 0.125, 0.905, 0.05, 0.08, 0.03, 0.10, 0.000),
        (-1.70, 0.958, 0.16, 0.935, 0.05, 0.07, 0.03, 0.09, 0.000),
        (-1.98, 0.930, 0.22, 0.950, 0.05, 0.06, 0.03, 0.07, 0.000),
        (-2.13, 0.875, 0.28, 0.940, 0.04, 0.05, 0.02, 0.05, 0.000),
        (-2.20, 0.800, 0.33, 0.910, 0.03, 0.04, 0.02, 0.04, 0.000),
    ]
    keys = expand_keys(BODY, 0.08)  # loft rapat (tanpa subdivisi: subdivisi menyusutkan garis pinggang di bawah kabin)
    lower, _, _ = p_loft([ring_body(*k, narc=6, nside=5) for k in keys])
    for f in lower.faces:
        f.material_index = MI['paint']
    cut = []
    arches = bmesh.new()
    for y in (wb / 2, -wb / 2):  # lengkung roda hanya di sisi (tidak memotong kap)
        for s in (1, -1):
            merge(arches, p_cylx(R + 0.05, 0.56, 36), M=T(s * 0.86, y, R))
    cut.append((arches, 'trim'))
    for s in (1, -1):
        # intake depan besar (trapesium) di sudut bumper
        cut.append((prism([(s * x, z) for (x, z) in ((0.30, 0.15), (0.92, 0.15), (0.90, 0.36), (0.36, 0.31))][::s], 2.02, 2.70, 'y'), 'trim'))
        # celah lampu LED di sudut atas muka (mengikuti tepi kap)
        cut.append((prism([(s * x, z) for (x, z) in ((0.36, 0.385), (0.86, 0.425), (0.88, 0.475), (0.34, 0.43))][::s], 2.06, 2.70, 'y'), 'paint2'))
        # intake samping memanjang miring di depan roda belakang
        cut.append((prism([(-0.48, 0.40), (-0.98, 0.42), (-1.00, 0.76), (-0.66, 0.73)], s * 0.78 if s > 0 else -1.30, 1.30 if s > 0 else -0.78, 'x'), 'trim'))
        # alur garis pintu (2 pintu) + gagang
        for bx in ((0.10, 0.008, 0.50, 0.96, 0.46, 0), (0.10, 1.40, 0.008, 0.26, 0.24, 0), (0.10, 0.008, 0.48, -0.44, 0.47, 12)):
            g = p_box(bx[0], bx[1], bx[2])
            bmesh.ops.transform(g, matrix=T(s * 0.965, bx[3], bx[4]) @ Rx(bx[5]), verts=g.verts)
            cut.append((g, 'paint2'))
        g = p_box(0.10, 0.16, 0.026)
        bmesh.ops.transform(g, matrix=T(s * 0.955, -0.32, 0.66), verts=g.verts)
        cut.append((g, 'trim'))
    cut.append((prism(rrect(-0.28, 0.28, 0.15, 0.27, 0.03, 0.02), 2.06, 2.70, 'y'), 'trim'))
    lower = boolean(lower, cut)
    for f in lower.faces:
        if f.material_index != MI['paint']:
            continue
        c, n = f.calc_center_median(), f.normal
        if n.z < -0.55:
            f.material_index = MI['trim']
        elif c.z < 0.20 and abs(n.x) > 0.6:
            f.material_index = MI['paint2']  # rok samping hitam
        elif c.y < -1.98 and c.z < 0.38 and n.y < -0.25:
            f.material_index = MI['paint2']  # muka bawah belakang hitam (diffuser menyatu), batas lurus
        elif c.y > 2.05 and c.z < 0.20:
            f.material_index = MI['paint2']
        elif n.z > 0.8 and -1.55 < c.y < 1.05 and abs(c.x) < 0.78 and c.z > 0.70:
            f.material_index = MI['interior']
    body = bmesh.new()
    merge(body, lower)
    GH = [(1.05, None, 0.80, 0.78, 'ws'), (0.85, 0.85, 0.80, 0.74, 'ws'), (0.62, 0.95, 0.795, 0.68, 'ws'),
          (0.40, 1.04, 0.79, 0.625, 'ws'), (0.16, 1.12, 0.785, 0.585, 'ws'), (0.00, 1.165, 0.785, 0.57, 'door'),
          (-0.25, 1.180, 0.785, 0.565, 'door'), (-0.48, 1.170, 0.79, 0.565, 'door'), (-0.66, 1.140, 0.80, 0.575, 'cpil'),
          (-0.90, 1.080, 0.82, 0.595, 'eng'), (-1.15, 1.020, 0.84, 0.615, 'eng'), (-1.40, 0.975, 0.86, 0.635, 'eng'),
          (-1.55, None, 0.87, 0.65, None)]
    STYLE = {'ws': dict(side='glass', corner='paint2', roof='glass'),
             'door': dict(side='glass', corner='paint2', roof='paint'),
             'cpil': dict(side='paint', corner='paint2', roof='paint'),
             'eng': dict(side='paint', corner='paint2', roof='glass')}
    rings, labels = [], None
    for (y, zt, w0, w1, _) in GH:
        belt = interp(BODY, y, 3) + 0.004
        rg, labels = ring_gh(y, 0.70, belt, zt if zt else belt + 0.06, w0, w1, rc=0.05)
        rings.append(rg)
    gh, grid, caps = p_loft(rings)
    inner = []
    for i, row in enumerate(grid):
        st = STYLE[GH[i][4]]
        for j, f in enumerate(row):
            lab = labels[j]
            m = {'bottom': 'interior', 'belt': 'paint2'}.get(lab) or st[lab]
            f.material_index = MI[m]
            if m not in ('glass', 'interior'):
                inner.append(f)
    caps[0].material_index = MI['paint2']
    caps[1].material_index = MI['paint']
    headliner(gh, inner, 0.012)
    merge(body, gh)
    # ---- depan: LED bentuk Y di dalam celah lampu, kisi sarang lebah di intake, splitter menempel
    for s in (1, -1):
        put(body, p_box(0.46, 0.02, 0.028, bevel=0.006), 'light_head', T(s * 0.60, 2.14, 0.42) @ Ry(-s * 4.6))
        put(body, p_box(0.028, 0.02, 0.06, bevel=0.006), 'light_head', T(s * 0.68, 2.14, 0.40))
        put(body, p_box(0.15, 0.02, 0.028, bevel=0.006), 'light_head', T(s * 0.76, 2.14, 0.385) @ Ry(s * 35))
        put(body, p_box(0.08, 0.025, 0.02, bevel=0.005), 'light_ind', T(s * 0.82, 2.13, 0.45))
        for k in range(4):
            put(body, p_box(0.56, 0.012, 0.012), 'paint2', T(s * 0.62, 2.07, 0.18 + k * 0.045) @ Ry(s * 6))
        for k in range(5):
            put(body, p_box(0.012, 0.012, 0.19), 'paint2', T(s * (0.40 + k * 0.11), 2.07, 0.245) @ Ry(18 if k % 2 else -18))
    for k in range(3):
        put(body, p_box(0.52, 0.012, 0.012), 'paint2', T(0, 2.10, 0.18 + k * 0.035))
    put(body, p_box(1.74, 0.30, 0.03, bevel=0.01), 'paint2', T(0, 2.13, 0.125))  # splitter (atas = dasar badan)
    put(body, p_box(0.50, 0.012, 0.012), 'trim', T(0.18, 1.10, 0.745) @ Rz(6))  # wiper tunggal
    # ---- samping: kisi di intake memanjang, spion, bilah aero rok (menempel)
    for s in (1, -1):
        for k in range(5):
            put(body, p_box(0.02, 0.44, 0.012), 'paint2', T(s * 0.80, -0.76, 0.47 + k * 0.06) @ Rx(-3))
        put(body, p_tube((s * 0.84, 0.74, 0.79), (s * 0.95, 0.78, 0.84), 0.016, 6), 'trim')
        put(body, p_box(0.16, 0.10, 0.075, bevel=0.03, segs=2), 'paint', T(s * 1.00, 0.80, 0.85) @ Rz(-s * 8))
        put(body, p_box(0.14, 0.006, 0.06), 'chrome', T(s * 1.00, 0.748, 0.85) @ Rz(-s * 8))
        put(body, p_box(0.05, 1.50, 0.04, bevel=0.012), 'paint2', T(s * 0.935, -0.02, 0.145))
    # ---- belakang: lampu Y, kisi hitam, knalpot segienam, sirip diffuser menempel di bawah badan, spoiler bibir
    for s in (1, -1):
        put(body, p_box(0.44, 0.03, 0.034, bevel=0.008), 'light_tail', T(s * 0.56, -2.205, 0.835) @ Ry(s * 10))
        put(body, p_box(0.034, 0.03, 0.15, bevel=0.008), 'light_tail', T(s * 0.40, -2.21, 0.75))
        put(body, p_box(0.26, 0.03, 0.034, bevel=0.008), 'light_tail', T(s * 0.56, -2.205, 0.68) @ Ry(-s * 14))
        put(body, p_box(0.07, 0.03, 0.03, bevel=0.006), 'light_ind', T(s * 0.76, -2.19, 0.835))
    put(body, p_box(1.16, 0.04, 0.24, bevel=0.02), 'trim', T(0, -2.195, 0.57))
    for k in range(6):
        put(body, p_box(1.10, 0.012, 0.012), 'paint2', T(0, -2.218, 0.47 + k * 0.038))
    merge(body, V.plate_bm('B 1 HLR', 0.34, 0.105), M=T(0, -2.222, 0.59) @ Rz(180))
    ex = hexagon(0.075, 0.16)
    merge(body, ex, 'chrome', T(0, -2.21, 0.40) @ Rx(90) @ Rz(30))
    ex = hexagon(0.055, 0.17)
    merge(body, ex, 'tire', T(0, -2.215, 0.40) @ Rx(90) @ Rz(30))
    put(body, p_box(1.40, 0.36, 0.09, bevel=0.025), 'paint2', T(0, -2.03, 0.275))  # diffuser padat, rata dengan badan
    for k in range(5):  # sirip pendek di dalam diffuser (tidak menggantung)
        put(body, p_box(0.018, 0.30, 0.07), 'paint2', T(-0.56 + k * 0.28, -2.07, 0.235))
    put(body, p_box(1.46, 0.12, 0.024, bevel=0.008), 'paint2', T(0, -2.10, 0.955) @ Rx(-8))
    for k in range(5):  # kisi kap mesin
        y = -0.98 - k * 0.11
        put(body, p_box(1.02, 0.028, 0.02), 'trim', T(0, y, interp([(g[0], g[1] or 0.9) for g in GH], y, 1) + 0.006))
    # ---- interior: kursi bucket rendah & rebah, dasbor, kemudi
    merge(body, V.dash_bm(1.46, 0.34, 0.15, 0.40), M=T(0, 0.70, 0.66))
    merge(body, V.steering_bm(0.16, 0.02), M=T(0.40, 0.47, 0.70) @ Rx(68))
    put(body, p_box(0.08, 0.03, 0.05), 'light_ind', T(0.40, 0.60, 0.76))
    put(body, p_box(0.24, 0.90, 0.18, bevel=0.04), 'interior', T(0, 0.0, 0.28))
    for s in (1, -1):
        merge(body, V.seat_bm(0.46, 0.50, 0.58, 27), M=T(s * 0.40, 0.14, 0.29))  # bucket rendah & rebah
    # ---- kaliper rem biru (statis di badan, di balik jari-jari)
    for y in (wb / 2, -wb / 2):
        for s in (1, -1):
            tr = trf if y > 0 else trr
            w_ = 0.245 if y > 0 else 0.305
            V.add_calipers(body, [(s * tr / 2, y, s)], R, w_, rim_r, 'super', mat='caliper')
    objs = [make_obj('body', body)]
    for nm, x, y, w in (('wheel_fl', -trf / 2, wb / 2, 0.245), ('wheel_fr', trf / 2, wb / 2, 0.245),
                        ('wheel_rl', -trr / 2, -wb / 2, 0.305), ('wheel_rr', trr / 2, -wb / 2, 0.305)):
        objs.append(wheel_obj(nm, (x, y, R), wheel_super(R, w, rim_r, 1 if x > 0 else -1)))
    # duduk rendah & rebah (pose 'recline' di game): panggul di jok, kepala di bawah atap
    E = {'seat_driver': (0.40, 0.10, 0.30), 'eye_driver': (0.40, -0.22, 0.97), 'exit_l': (-1.95, -0.05, 0.0),
         'exit_r': (1.95, -0.05, 0.0), 'exhaust': (0.0, -2.26, 0.40), 'light_fl': (-0.62, 2.16, 0.42),
         'light_fr': (0.62, 2.16, 0.42), 'seat_p1': (-0.40, 0.10, 0.30)}
    return objs, E, dict(wheelbase=wb, track=trf, wheelRadius=R)


# ================================================================ JAWARA (cruiser V-twin)
def disc_wheel(R, W, rim_r, segs=28):
    """Roda cakram pejal (kedua sisi tertutup), ban gemuk."""
    bm = bmesh.new()
    V.uv_layer(bm)
    merge(bm, V.tire_v3(R, W, rim_r, 0.0, max(32, segs), 0.0, True))  # ban motor ber-UV (peta normal tapak)
    for side in (1, -1):
        fx = side * W / 2 * 0.62
        lip = side * W / 2 * 0.86
        d = p_lathe([(0.075, fx - side * 0.01), (rim_r * 0.55, fx), (rim_r * 0.60, fx + side * 0.006),
                     (rim_r * 0.92, fx), (rim_r * 0.995, lip)], segs)
        orient(d, lambda c, s=side: Vector((s, 0, 0)))
        for f in d.faces:
            c = f.calc_center_median()
            r = math.hypot(c.y, c.z)
            f.material_index = MI['chrome'] if r < rim_r * 0.57 else MI['rim']
        merge(bm, d)
        for k in range(8):  # alur mesin halus
            a = k * 2 * pi / 8
            merge(bm, p_box(0.006, 0.05, 0.012), 'trim', T(fx + side * 0.004, rim_r * 0.78 * math.cos(a), rim_r * 0.78 * math.sin(a)) @ Rx(a * 180 / pi))
        merge(bm, p_cylx(0.075, 0.02, 18), 'chrome', T(fx - side * 0.004, 0, 0))
        merge(bm, p_cyl(0.045, 0.02, 0.05, 12), 'chrome', T(fx + side * 0.02, 0, 0) @ Ry(90 * side))
    return bm


def build_jawara():
    wb, Rf, Rr = 1.665, 0.33, 0.335
    fy, ry = wb / 2, -wb / 2
    pivot = (0.0, fy, 0.95)
    body = bmesh.new()
    # ---- rangka (hitam)
    head = (0.0, 0.47, 0.93)
    put(body, p_path([head, (0, 0.20, 0.86), (0, -0.20, 0.72)], 0.03, 10), 'trim')
    for s in (1, -1):
        put(body, p_path([(s * 0.05, 0.47, 0.88), (s * 0.09, 0.30, 0.50), (s * 0.11, 0.22, 0.24), (s * 0.12, -0.40, 0.24),
                          (s * 0.12, -0.55, 0.36), (s * 0.11, -0.80, 0.60)], 0.02, 8), 'trim')
        put(body, p_tube((s * 0.11, -0.20, 0.72), (s * 0.11, -0.80, 0.60), 0.018, 8), 'trim')
        put(body, p_tube((s * 0.135, -0.36, 0.30), (s * 0.15, ry, Rr), 0.024, 10), 'chrome')  # lengan ayun
        put(body, p_tube((s * 0.15, ry + 0.02, Rr + 0.02), (s * 0.13, -0.95, 0.66), 0.016, 8), 'chrome')  # penyangga spakbor
    put(body, p_cyl(0.045, 0.045, 0.16, 14), 'trim', T(*head) @ Rx(-29))
    # ---- tangki tetes air (krom/cat)
    TK = [(0.43, 0.84, 0.92, 0.06), (0.40, 0.80, 0.975, 0.12), (0.30, 0.77, 1.00, 0.165), (0.15, 0.76, 1.00, 0.175),
          (0.00, 0.76, 0.975, 0.165), (-0.08, 0.76, 0.935, 0.13), (-0.12, 0.77, 0.885, 0.07)]
    rings = [ring_ellipse(0.5 * (zb + zt), y, 0, hw, 0.5 * (zt - zb), n=22, e=2.6, plane='XZ') for (y, zb, zt, hw) in TK]
    tk, _, _ = p_loft(rings)
    merge(body, tk, 'paint')
    put(body, p_box(0.07, 0.42, 0.014, bevel=0.006), 'chrome', T(0, 0.16, 1.005))
    put(body, p_cyl(0.035, 0.035, 0.02, 14), 'chrome', T(0.0, 0.33, 1.003))
    for s in (1, -1):
        put(body, p_box(0.004, 0.30, 0.008), 'paint2', T(s * 0.172, 0.17, 0.905))
    # ---- jok: pengendara rendah + boncengan (kulit hitam)
    SE = [(-0.08, 0.735, 0.79, 0.09), (-0.14, 0.70, 0.79, 0.16), (-0.24, 0.67, 0.765, 0.19), (-0.36, 0.665, 0.77, 0.19),
          (-0.46, 0.69, 0.83, 0.16), (-0.52, 0.74, 0.865, 0.13), (-0.62, 0.765, 0.875, 0.125), (-0.72, 0.77, 0.865, 0.11),
          (-0.78, 0.775, 0.84, 0.07)]
    rings = [ring_ellipse(0.5 * (zb + zt), y, 0, hw, 0.5 * (zt - zb), n=18, e=2.8, plane='XZ') for (y, zb, zt, hw) in SE]
    se, _, _ = p_loft(rings)
    merge(body, se, 'seat')
    for k in range(5):
        put(body, p_box(0.30, 0.008, 0.006), 'paint2', T(0, -0.16 - k * 0.06, 0.785 - k * 0.004))
    # ---- spakbor belakang + lampu
    fen = p_lathe([(Rr + 0.035, -0.15), (Rr + 0.035, 0.15), (Rr + 0.052, 0.152), (Rr + 0.052, -0.152)], 20,
                  a0=40 * D2R, a1=205 * D2R, closed_prof=True, cap_ends=True)
    bmesh.ops.recalc_face_normals(fen, faces=fen.faces)
    merge(body, fen, 'paint', T(0, ry, Rr))
    put(body, p_box(0.10, 0.05, 0.045, bevel=0.018), 'light_tail', T(0, -1.128, 0.62) @ Rx(-30))
    put(body, p_box(0.11, 0.012, 0.05, bevel=0.005), 'lens_red', T(0, -1.158, 0.605) @ Rx(-30))
    merge(body, V.plate_bm('B 4466 JWR', 0.20, 0.12), M=T(0, -1.222, 0.43) @ Rx(-10) @ Rz(180))  # di luar spakbor belakang
    put(body, p_box(0.03, 0.05, 0.02, bevel=0.006), 'trim', T(0, -1.20, 0.48))
    for s in (1, -1):
        put(body, p_tube((s * 0.09, -1.06, 0.58), (s * 0.19, -1.06, 0.58), 0.008, 6), 'chrome')
        put(body, p_cyl(0.022, 0.03, 0.06, 10), 'light_ind', T(s * 0.21, -1.07, 0.58) @ Rx(90))
    # ---- mesin V-twin: bak, dua silinder bersirip, kepala krom
    put(body, p_box(0.26, 0.40, 0.24, bevel=0.07, segs=2), 'trim', T(0, 0.03, 0.38))
    for yc, tilt in ((0.17, -22), (-0.11, 22)):
        for k in range(8):
            r = 0.092 - 0.004 * (k % 2)
            put(body, p_cyl(r, r, 0.022, 18), 'chrome' if k % 2 == 0 else 'trim', T(0, yc, 0.47) @ Rx(tilt) @ T(0, 0, 0.03 + k * 0.032))
        put(body, p_box(0.20, 0.17, 0.09, bevel=0.035, segs=2), 'chrome', T(0, yc, 0.47) @ Rx(tilt) @ T(0, 0, 0.32))
        put(body, p_box(0.11, 0.10, 0.04, bevel=0.012), 'chrome', T(0, yc, 0.47) @ Rx(tilt) @ T(0, 0, 0.385))
    put(body, p_cylx(0.118, 0.065, 30), 'chrome', T(0.165, 0.04, 0.665))  # saringan udara bulat (kanan)
    put(body, p_cylx(0.085, 0.07, 26), 'rim', T(0.172, 0.04, 0.665))
    put(body, p_cylx(0.02, 0.08, 10), 'chrome', T(0.18, 0.04, 0.665))
    pc = p_cylx(0.15, 0.05, 28)
    bmesh.ops.transform(pc, matrix=Matrix.Diagonal((1, 1.55, 1, 1)), verts=pc.verts)
    put(body, pc, 'chrome', T(-0.14, -0.17, 0.37))  # tutup primer (kiri)
    put(body, p_cylx(0.06, 0.06, 18), 'rim', T(-0.165, -0.06, 0.37))
    put(body, p_box(0.22, 0.30, 0.20, bevel=0.05), 'trim', T(0, -0.32, 0.38))
    put(body, p_box(0.03, 0.72, 0.08, bevel=0.015), 'trim', T(-0.15, -0.50, 0.36) @ Rx(4))  # pelindung sabuk
    for s in (1, -1):  # tutup oli/aki krom di bawah jok
        put(body, p_box(0.035, 0.26, 0.20, bevel=0.03), 'chrome', T(s * 0.13, -0.40, 0.54))
    # ---- knalpot kembar krom (kanan)
    lo = [(0.07, 0.25, 0.52), (0.15, 0.24, 0.42), (0.19, 0.12, 0.31), (0.20, -0.10, 0.29), (0.20, -0.72, 0.30)]
    hi = [(0.07, -0.18, 0.56), (0.16, -0.22, 0.47), (0.215, -0.34, 0.43), (0.215, -0.72, 0.43)]
    put(body, p_path(lo, 0.03, 12), 'chrome')
    put(body, p_path(hi, 0.03, 12), 'chrome')
    for y0, z in ((-0.72, 0.30), (-0.72, 0.43)):
        x = 0.20 if z < 0.4 else 0.215
        put(body, p_tube((x, y0, z), (x, -1.06, z + 0.01), 0.043, 16), 'chrome')
        put(body, p_cyly(0.033, 0.02, 14), 'tire', T(x, -1.07, z + 0.01))
    # ---- papan kaki, standar samping, pijakan boncengan
    for s in (1, -1):
        put(body, p_box(0.13, 0.30, 0.03, bevel=0.01), 'trim', T(s * 0.30, 0.30, 0.31))
        put(body, p_box(0.14, 0.31, 0.012, bevel=0.004), 'chrome', T(s * 0.30, 0.30, 0.296))
        put(body, p_tube((s * 0.14, 0.30, 0.30), (s * 0.24, 0.30, 0.31), 0.014, 6), 'chrome')
        put(body, p_tube((s * 0.13, -0.62, 0.40), (s * 0.25, -0.64, 0.40), 0.013, 6), 'chrome')
    put(body, p_tube((-0.12, -0.05, 0.25), (-0.30, 0.05, 0.03), 0.014, 6), 'trim')
    objs = [make_obj('body', body)]

    # ---- setang (berputar): garpu krom gemuk, lampu bulat, setang lebar, spion, spakbor depan
    st = bmesh.new()
    for s in (1, -1):
        put(st, p_tube((s * 0.105, fy + 0.004, Rf), (s * 0.105, 0.69, 0.62), 0.046, 14), 'chrome')
        put(st, p_tube((s * 0.105, 0.70, 0.60), (s * 0.105, 0.52, 0.92), 0.034, 12), 'chrome')
        put(st, p_cyl(0.024, 0.032, 0.055, 10), 'light_ind', T(s * 0.20, 0.60, 0.90) @ Rx(90))
        put(st, p_tube((s * 0.13, 0.58, 0.90), (s * 0.19, 0.60, 0.90), 0.008, 6), 'chrome')
        put(st, p_path([(s * 0.30, 0.44, 1.10), (s * 0.34, 0.43, 1.22), (s * 0.37, 0.41, 1.30)], 0.008, 6), 'chrome')
        put(st, p_cyly(0.058, 0.02, 18), 'chrome', T(s * 0.375, 0.405, 1.335))
        put(st, p_cyly(0.050, 0.006, 18), 'glass', T(s * 0.375, 0.392, 1.335))
        put(st, p_tube((s * 0.30, 0.40, 1.10), (s * 0.46, 0.33, 1.10), 0.019, 10), 'trim')  # grip
        put(st, p_box(0.14, 0.02, 0.012), 'chrome', T(s * 0.32, 0.46, 1.105) @ Rz(-s * 16))
    put(st, p_box(0.31, 0.10, 0.045, bevel=0.015), 'chrome', T(0, 0.515, 0.93) @ Rx(-29))
    put(st, p_box(0.31, 0.10, 0.045, bevel=0.015), 'chrome', T(0, 0.545, 0.86) @ Rx(-29))
    put(st, p_box(0.27, 0.26, 0.15, bevel=0.06, segs=2), 'paint', T(0, 0.585, 0.885) @ Rx(-29))  # nacelle
    bar = [(-0.45, 0.34, 1.10), (-0.40, 0.40, 1.115), (-0.26, 0.47, 1.08), (0.0, 0.49, 1.055), (0.26, 0.47, 1.08),
           (0.40, 0.40, 1.115), (0.45, 0.34, 1.10)]
    put(st, p_path(bar, 0.016, 8), 'chrome')
    for s in (1, -1):
        put(st, p_tube((s * 0.06, 0.50, 0.97), (s * 0.06, 0.49, 1.055), 0.018, 8), 'chrome')
    hl = p_sphere(0.115, 20, 10)
    bmesh.ops.transform(hl, matrix=Matrix.Diagonal((1, 1.15, 1, 1)), verts=hl.verts)
    put(st, hl, 'chrome', T(0, 0.665, 0.975))
    V.round_lamp(st, (0, 0.735, 0.975), 0.10, depth=0.06, segs=22, shell=None)  # reflektor krom + kaca cembung (ember = bola krom)
    fen = p_lathe([(Rf + 0.03, -0.085), (Rf + 0.03, 0.085), (Rf + 0.045, 0.087), (Rf + 0.045, -0.087)], 16,
                  a0=8 * D2R, a1=150 * D2R, closed_prof=True, cap_ends=True)
    bmesh.ops.recalc_face_normals(fen, faces=fen.faces)
    merge(st, fen, 'paint', T(0, fy, Rf))
    objs.append(make_obj('steer', st, origin=pivot))
    wf = disc_wheel(Rf, 0.15, 0.225)
    rotor = p_cylx(0.15, 0.006, 26)  # cakram rem depan (ikut berputar)
    merge(rotor, p_cylx(0.06, 0.012, 14), 'chrome')
    merge(wf, rotor, 'chrome', T(-0.085, 0, 0))
    objs.append(wheel_obj('wheel_f', (0, fy, Rf), wf))
    objs.append(wheel_obj('wheel_r', (0, ry, Rr), disc_wheel(Rr, 0.24, 0.225)))
    E = {'seat_driver': (0.0, -0.30, 0.80), 'eye_driver': (0.0, -0.18, 1.50), 'exit_l': (-1.30, -0.30, 0.0),
         'exit_r': (1.30, -0.30, 0.0), 'exhaust': (0.215, -1.08, 0.36), 'light_f': (0.0, 0.80, 0.975),
         'seat_p1': (0.0, -0.66, 0.92)}
    return objs, E, dict(wheelbase=wb, track=0.0, wheelRadius=Rr)


# ================================================================ daftar
VEH2 = {
    'loop': dict(name='Sutera Loop', build=build_loop, seats=12, width=2.30, driver='right', horn='klakson-2-antek-asing.mp3', cabin=False, lod_tris=6000, dirt=0.45,
                 colors=['#c3262e'],
                 mats={'paint': dict(rough=0.32, coat=0.7), 'paint2': dict(col='#f1e6c9', metal=0.0, rough=0.4, coat=0.5),
                       'trim': dict(col='#1d4a34', metal=0.1, rough=0.42), 'rim': dict(col='#caa24c', metal=0.95, rough=0.28),
                       'plate': dict(col='#f3f0e7', rough=0.45), 'seat': dict(col='#9a6a3c', rough=0.55),
                       'interior': dict(col='#4a3d32', rough=0.7), 'glass': dict(col='#0b1118', alpha=0.55),
                       'tire': dict(col='#141416')}),
    'halilintar': dict(name='Halilintar', build=build_halilintar, seats=2, width=1.93, driver='right', horn='klakson-1-saya-akan-lawan.mp3', dirt=0.22,
                       gaps=[('x', 0.60, {'y': (1.12, 2.02), 'z': (0.36, 0.9)}), ('y', 2.02, {'x': (0.0, 0.60), 'z': (0.36, 0.62)}),
                             ('y', -1.62, {'x': (0.0, 0.86), 'z': (0.86, 1.0)})],
                       colors=['#f7c200', '#1b1c20', '#ecebe6', '#c4161c', '#1f63d6', '#503EBA', '#3d8f3a'],
                       mats={'paint': dict(metal=0.5, rough=0.16, coat=1.0), 'paint2': dict(col='#0d0e11', metal=0.25, rough=0.22, coat=0.8),
                             'trim': dict(col='#141518', rough=0.6), 'rim': dict(col='#2a2c31', metal=0.75, rough=0.32),
                             'caliper': dict(col='#1f5fd6'), 'glass': dict(col='#05070a', alpha=0.8),
                             'interior': dict(col='#2a2a30'), 'seat': dict(col='#3a1c1c', rough=0.5),
                             'light_head': dict(ems=3.0)}),
    'jawara': dict(name='Jawara', build=build_jawara, seats=2, width=0.95, driver='center', horn='klakson-2-antek-asing.mp3', cabin=False, dirt=0.3,
                   colors=['#c9ccd2', '#16171a', '#7a1f1f', '#1f3a5f', '#D29F52', '#2f4f3a'],
                   mats={'paint': dict(metal=0.85, rough=0.2, coat=0.9), 'paint2': dict(col='#D29F52', metal=0.5, rough=0.3),
                         'trim': dict(col='#17181b', rough=0.55), 'rim': dict(col='#b6bbc3', metal=0.9, rough=0.3),
                         'seat': dict(col='#151518', rough=0.55)}),
}
ORDER2 = ['loop', 'halilintar', 'jawara']
ORDER_ALL = ['lintas', 'banteng', 'walet', 'loop', 'halilintar', 'jawara']
V.VEH.update(VEH2)


def shot2(vid, man):
    V.cycles(SAMPLES, 1600, 1000)
    V.studio('#34373e', 0.07)
    L, W, H = man['length'], man['bbox'][0], man['height']
    V.studio_lights(L, H)
    az = 36
    V.cam_at((0, 0.08 * L, H * 0.40), az, 9, V.fit_dist(L, W, H, az, 55) * 0.98, 55)
    os.makedirs(V.PREV, exist_ok=True)
    tag = opt('--tag')
    bpy.context.scene.render.filepath = os.path.join(V.PREV, '%s-%s.png' % (tag if isinstance(tag, str) else 'v2', vid))
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('shot', vid, '%.1fs' % (time.time() - t0))


def lineup2():
    V.reset()
    V.cycles(SAMPLES, 1920, 1080)
    V.plaza_world()
    strip, white, gold = V.plaza()
    bpy.data.objects.get('ground').scale = (14, 14, 1)
    rot = -32
    for vid, (x, y), r in (('loop', (-4.4, 5.6), rot), ('halilintar', (-0.6, -0.4), rot - 12), ('jawara', (3.1, -1.2), rot + 18),
                           ('lintas', (4.4, 5.2), rot)):
        V.import_glb(vid, (x, y, 0), r)
    for k in range(-2, 5):
        strip(-3.3 + k * 3.5, -0.6 + k * 0.62, 0.12, 6.0, rot, white)
    strip(-0.8, -4.6, 0.22, 40.0, -90 + 10, gold)
    V.scenery()
    cd = bpy.data.cameras.new('cam')
    cd.lens = 40
    cd.sensor_width = 36
    cam = V.link(bpy.data.objects.new('cam', cd))
    tgt = Vector((0.2, 2.0, 1.25))
    a, e = 18 * D2R, 9 * D2R
    cam.location = tgt + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * 18.5
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    cd.dof.use_dof = True
    cd.dof.focus_distance = (cam.location - Vector((-0.6, -0.4, 0.6))).length
    cd.dof.aperture_fstop = 3.4
    bpy.context.scene.render.filepath = os.path.join(V.PREV, 'v2-lineup.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('lineup2 %.1fs' % (time.time() - t0))


def main():
    ids = [v for v in ORDER2 if not ONLY or v in ONLY]
    mans = []
    for vid in ids:
        man = V.build(vid)
        if not opt('--no-export'):
            V.export_glb(vid)
        if opt('--quick'):
            V.quick(vid, man)
        if opt('--shots'):
            shot2(vid, man)
        mans.append(man)
    if not opt('--no-export') and mans:
        path = os.path.join(V.OUT, 'manifest.json')
        old = []
        if os.path.exists(path):
            try:
                old = json.load(open(path))
            except Exception:
                old = []
        byid = {m['id']: m for m in old}
        for m in mans:
            byid[m['id']] = m
        full = [byid[k] for k in ORDER_ALL if k in byid] + [m for k, m in byid.items() if k not in ORDER_ALL]
        with open(path, 'w') as f:
            json.dump(full, f, indent=1)
        log('manifest', path, [m['id'] for m in full])
    if opt('--lineup'):
        lineup2()


main()
