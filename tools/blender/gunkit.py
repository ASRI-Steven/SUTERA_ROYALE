"""Toolkit bentuk senjata & optik (dipakai tools/blender/weapons.py v6). Semua fungsi mengembalikan bmesh TANPA material
(kecuali yang mengembalikan daftar (bmesh, nama_material)); weapons.py yang memasang material lewat put().

Koordinat Blender seperti weapons.py: +Y = arah laras, +Z = atas, +X = kanan. Satuan meter.

Isi:
  fillet2d(pts, r, n)        sudut poligon 2D dibulatkan
  ext_x(outline_yz, w)       siluet samping 2D diekstrusi sepanjang X (dasar plate)
  plate(outline_yz, w, r, chamfer)  pelat bersiluet: sudut membulat + tepi tutup dibevel bertingkat (bevel bentuk)
  prof_y(section_xz, y0, y1) penampang XZ diekstrusi sepanjang Y (rel, alur)
  lathe(prof, segs)          profil [(r, y)] diputar mengelilingi sumbu Y (tertutup bila titik terakhir = titik pertama)
  loft_se(secs, n)           badan membulat sepanjang Y, eksponen superelips per penampang
  frame_y(outer, inner, y0, y1)  bingkai berlubang (kontur luar & dalam di bidang XZ) sepanjang Y
  picatinny(L)               rel aksesori: lebar 21,2 mm, ekor burung 45°, alur 5,35 mm tiap 10 mm, dalam 3 mm
  knurl(r, h, n, depth)      silinder bergerigi lurus (kenop turret), sumbu Z
  screw(kind, d, h)          kepala baut hex/torx/slot (sumbu Z, puncak di z = 0)
  lens(r, bulge)             cakram lensa cembung (menghadap −Y), untuk material 'lens'
  ring_mount(tube_r, h, w)   cincin teropong di rel: dudukan + penjepit ekor burung + cincin terbelah + 4 baut
"""
import bmesh
import math
from mathutils import Matrix, Vector

pi = math.pi
D2R = pi / 180


def _T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def merge_into(dst, src, M=None):
    flip = M is not None and M.to_3x3().determinant() < 0
    vmap = {v: dst.verts.new(M @ v.co if M is not None else v.co.copy()) for v in src.verts}
    for f in src.faces:
        vs = [vmap[v] for v in f.verts]
        if flip:
            vs.reverse()
        try:
            nf = dst.faces.new(vs)
            nf.smooth = f.smooth
        except ValueError:
            pass
    src.free()
    return dst


def xf(bm, M):
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm


# ---------------------------------------------------------------- 2D
def fillet2d(pts, r, n=3):
    """Bulatkan sudut poligon tertutup [(a, b)]: r = jari-jari (angka, atau daftar per titik; 0 = sudut tajam)."""
    m = len(pts)
    rs = r if isinstance(r, (list, tuple)) else [r] * m
    out = []
    for i in range(m):
        p, a, b = Vector(pts[i]), Vector(pts[i - 1]), Vector(pts[(i + 1) % m])
        rr = rs[i]
        if rr <= 0:
            out.append((p.x, p.y))
            continue
        u, w = (a - p), (b - p)
        la, lb = u.length, w.length
        if la < 1e-9 or lb < 1e-9:
            out.append((p.x, p.y))
            continue
        u.normalize()
        w.normalize()
        ang = math.acos(max(-1.0, min(1.0, u.dot(w))))
        if ang < 1e-3 or ang > pi - 1e-3:
            out.append((p.x, p.y))
            continue
        t = rr / math.tan(ang / 2)
        t = min(t, la * 0.49, lb * 0.49)
        rr = t * math.tan(ang / 2)
        p0, p1 = p + u * t, p + w * t
        bis = (u + w).normalized()
        c = p + bis * (rr / math.sin(ang / 2))
        a0 = math.atan2(p0.y - c.y, p0.x - c.x)
        a1 = math.atan2(p1.y - c.y, p1.x - c.x)
        da = a1 - a0
        while da > pi:
            da -= 2 * pi
        while da < -pi:
            da += 2 * pi
        for k in range(n + 1):
            aa = a0 + da * k / n
            out.append((c.x + rr * math.cos(aa), c.y + rr * math.sin(aa)))
    return out


def area2d(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


# ---------------------------------------------------------------- ekstrusi & bubut
def ext_x(outline, w, x0=0.0):
    """Poligon tertutup [(y, z)] diekstrusi setebal w di sumbu X (berpusat x0). Mengembalikan (bm, tutup kiri, tutup kanan)."""
    if area2d(outline) < 0:
        outline = list(reversed(outline))
    bm = bmesh.new()
    a = [bm.verts.new((x0 - w / 2, y, z)) for y, z in outline]
    b = [bm.verts.new((x0 + w / 2, y, z)) for y, z in outline]
    n = len(outline)
    ca = bm.faces.new(list(reversed(a)))
    cb = bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, ca, cb


def plate(outline, w, r=0.0, chamfer=0.0, x0=0.0, n=3, segs=2, tri=True):
    """Pelat bersiluet: sudut siluet dibulatkan (r: angka / daftar per titik), lalu tepi kedua tutup dibevel (bevel bentuk
    `chamfer`, `segs` segmen). Tutup dipecah segitiga (poligon cekung aman untuk ekspor)."""
    pts = fillet2d(outline, r, n) if (r if not isinstance(r, (list, tuple)) else max(r)) > 0 else list(outline)
    bm, ca, cb = ext_x(pts, w, x0)
    if chamfer > 0:
        es = [e for e in bm.edges if ca in e.link_faces or cb in e.link_faces]
        try:
            bmesh.ops.bevel(bm, geom=es, offset=min(chamfer, w * 0.45), offset_type='OFFSET', segments=segs, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        except Exception:
            pass
    if tri:
        big = [f for f in bm.faces if len(f.verts) > 4]
        if big:
            bmesh.ops.triangulate(bm, faces=big, quad_method='BEAUTY', ngon_method='EAR_CLIP')
    return bm


def prof_y(sec, y0, y1, caps=True):
    """Penampang tertutup [(x, z)] diekstrusi dari y0 ke y1."""
    if area2d(sec) < 0:
        sec = list(reversed(sec))
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in sec]
    b = [bm.verts.new((x, y1, z)) for x, z in sec]
    n = len(sec)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    big = [f for f in bm.faces if len(f.verts) > 4]
    if big:
        bmesh.ops.triangulate(bm, faces=big, quad_method='BEAUTY', ngon_method='EAR_CLIP')
    return bm


def lathe(prof, segs=24, phase=0.0, sx=1.0, sz=1.0):
    """Profil [(r, y)] diputar di sumbu Y (z = 0). Titik dengan r = 0 menutup sendiri. Profil tertutup (titik terakhir =
    titik pertama) menghasilkan benda berongga (tabung berdinding)."""
    bm = bmesh.new()
    closed = len(prof) > 2 and abs(prof[0][0] - prof[-1][0]) < 1e-9 and abs(prof[0][1] - prof[-1][1]) < 1e-9
    P = prof[:-1] if closed else prof
    grid = []
    for i in range(segs):
        a = 2 * pi * i / segs + phase
        c, s = math.cos(a), math.sin(a)
        grid.append([bm.verts.new((r * c * sx, y, r * s * sz)) for r, y in P])
    n = len(P)
    for i in range(segs):
        A, B = grid[i], grid[(i + 1) % segs]
        for k in range(n if closed else n - 1):
            k2 = (k + 1) % n
            try:
                bm.faces.new((A[k], B[k], B[k2], A[k2]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def se_ring(cx, y, cz, hx, ht, hb, e, n):
    pts = []
    for i in range(n):
        a = 2 * pi * i / n + pi / n
        c, s = math.cos(a), math.sin(a)
        pts.append((cx + hx * math.copysign(abs(c) ** (2 / e), c), y, cz + (ht if s > 0 else hb) * math.copysign(abs(s) ** (2 / e), s)))
    return pts


def loft_se(secs, n=24, cap0=True, cap1=True):
    """secs = [(y, zc, tinggi_atas, tinggi_bawah, setengah_lebar, eksponen)] → badan sepanjang Y; eksponen 2 = elips,
    makin besar makin persegi."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in se_ring(0.0, y, zc, hx, ht, hb, e, n)] for (y, zc, ht, hb, hx, e) in secs]
    for i in range(len(rings) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]))
    if cap0:
        bm.faces.new(rings[0])
    if cap1:
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    big = [f for f in bm.faces if len(f.verts) > 4]
    if big:
        bmesh.ops.triangulate(bm, faces=big, quad_method='BEAUTY', ngon_method='EAR_CLIP')
    return bm


def rrect(hw, hh, r, n=4, cx=0.0, cz=0.0):
    """Persegi panjang membulat di bidang XZ (kontur, berlawanan jarum jam), titik sudut n per busur."""
    pts = []
    for qx, qz, a0 in ((1, 1, 0.0), (-1, 1, 90.0), (-1, -1, 180.0), (1, -1, 270.0)):
        ccx, ccz = cx + qx * (hw - r), cz + qz * (hh - r)
        for k in range(n + 1):
            a = (a0 + 90.0 * k / n) * D2R
            pts.append((ccx + r * math.cos(a), ccz + r * math.sin(a)))
    return pts


def frame_y(outer, inner, y0, y1):
    """Bingkai berlubang: kontur luar & dalam (jumlah titik sama, arah sama) di bidang XZ, diekstrusi dari y0 ke y1."""
    bm = bmesh.new()
    O0 = [bm.verts.new((x, y0, z)) for x, z in outer]
    O1 = [bm.verts.new((x, y1, z)) for x, z in outer]
    I0 = [bm.verts.new((x, y0, z)) for x, z in inner]
    I1 = [bm.verts.new((x, y1, z)) for x, z in inner]
    n = len(outer)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((O0[i], O0[j], O1[j], O1[i]))
        bm.faces.new((I0[j], I0[i], I1[i], I1[j]))
        bm.faces.new((O0[j], O0[i], I0[i], I0[j]))
        bm.faces.new((O1[i], O1[j], I1[j], I1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------- rel aksesori
RAIL_W = 0.0212  # lebar puncak ekor burung


def rail_section(top=0.0, slot=False, base=-0.007, base_w=0.0165):
    """Penampang rel (x, z), puncak di z = top. slot = penampang di alur (puncak turun 3 mm)."""
    t = top
    h = RAIL_W / 2
    if slot:
        return [(-base_w / 2, t + base), (base_w / 2, t + base), (0.0082, t - 0.0052), (h - 0.0004, t - 0.0030),
                (-(h - 0.0004), t - 0.0030), (-0.0082, t - 0.0052)]
    return [(-base_w / 2, t + base), (base_w / 2, t + base), (0.0082, t - 0.0052), (h, t - 0.0026), (h, t - 0.0021),
            (h - 0.0017, t - 0.0004), (h - 0.0021, t), (-(h - 0.0021), t), (-(h - 0.0017), t - 0.0004), (-h, t - 0.0021),
            (-h, t - 0.0026), (-0.0082, t - 0.0052)]


def picatinny(L, y0=0.0, top=0.0, base=-0.007, base_w=0.0165, pitch=0.010, slot_w=0.00535, end=0.004):
    """Rel aksesori dari y0 sepanjang L (puncak di z = top): gigi & alur bergantian (alur dalam 3 mm), ujung tanpa alur.
    base = kedalaman tulang rel di bawah puncak (perpanjang untuk menutup celah ke badan)."""
    bm = bmesh.new()
    segs = []
    y = y0
    y1 = y0 + L
    segs.append((y, y + end, False))
    y += end
    while y + pitch <= y1 - end + 1e-9:
        tooth = pitch - slot_w
        segs.append((y, y + tooth / 2, False))
        segs.append((y + tooth / 2, y + tooth / 2 + slot_w, True))
        segs.append((y + tooth / 2 + slot_w, y + pitch, False))
        y += pitch
    segs.append((y, y1, False))
    # gabung potongan gigi bersebelahan
    out = []
    for a, b, s in segs:
        if out and out[-1][2] == s and abs(out[-1][1] - a) < 1e-9:
            out[-1] = (out[-1][0], b, s)
        elif b - a > 1e-6:
            out.append((a, b, s))
    for a, b, s in out:
        merge_into(bm, prof_y(rail_section(top, s, base, base_w), a, b, caps=True))
    return bm


def rail_ref(top, base=-0.007):
    return top + base


# ---------------------------------------------------------------- kenop, baut, lensa
def knurl(r, h, n=40, depth=0.0006, z0=0.0, chamfer=0.0008):
    """Silinder bergerigi lurus (sumbu Z, dari z0 ke z0 + h), tepi atas dibevel tipis, tutup atas datar."""
    bm = bmesh.new()
    ring = lambda z, rr: [bm.verts.new(((rr - (depth if k % 2 else 0.0)) * math.cos(2 * pi * k / n), (rr - (depth if k % 2 else 0.0)) * math.sin(2 * pi * k / n), z)) for k in range(n)]
    A = ring(z0, r)
    B = ring(z0 + h - chamfer, r)
    C = [bm.verts.new((v.co.x * (1 - chamfer / r), v.co.y * (1 - chamfer / r), z0 + h)) for v in B]
    for R0, R1 in ((A, B), (B, C)):
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((R0[k], R0[k2], R1[k2], R1[k]))
    bm.faces.new(list(reversed(A)))
    top = bm.faces.new(C)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method='BEAUTY', ngon_method='EAR_CLIP')
    return bm


def cyl(r, h, n=24, z0=0.0, r2=None, caps=True):
    """Silinder/kerucut sumbu Z dari z0 ke z0 + h."""
    bm = bmesh.new()
    r2 = r if r2 is None else r2
    A = [bm.verts.new((r * math.cos(2 * pi * k / n), r * math.sin(2 * pi * k / n), z0)) for k in range(n)]
    B = [bm.verts.new((r2 * math.cos(2 * pi * k / n), r2 * math.sin(2 * pi * k / n), z0 + h)) for k in range(n)]
    for k in range(n):
        k2 = (k + 1) % n
        bm.faces.new((A[k], A[k2], B[k2], B[k]))
    if caps:
        bm.faces.new(list(reversed(A)))
        bm.faces.new(B)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def cap_turret(r, h, n=28, z0=0.0, knurled=True, lip=0.0008):
    """Kenop turret: badan bergerigi + bibir halus di dasar + tutup atas sedikit cekung (sumbu Z)."""
    bm = bmesh.new()
    merge_into(bm, cyl(r + lip, h * 0.18, n, z0))
    if knurled:
        merge_into(bm, knurl(r, h * 0.82, n * 2, 0.00055, z0 + h * 0.18))
    else:
        hh = h * 0.82
        merge_into(bm, lathe([(0.0, 0.0), (r, 0.0), (r, hh - 0.0008), (r - 0.0008, hh), (r * 0.8, hh), (r * 0.74, hh - 0.0005), (0.0, hh - 0.0005)], n), _T(0, 0, z0 + h * 0.18) @ Matrix.Rotation(pi / 2, 4, 'X'))
    return bm


def screw(kind='hex', d=0.004, h=0.0016, n=12):
    """Kepala baut silinder (sumbu Z, puncak di z = 0, dasar z = −h) dengan ceruk hex/torx/slot di puncak."""
    r = d / 2
    bm = bmesh.new()
    if kind == 'slot':
        merge_into(bm, lathe([(0.0, -h), (r, -h), (r, -0.0003), (r * 0.8, 0.0), (0.0, 0.0)], n), Matrix.Rotation(pi / 2, 4, 'X'))
        merge_into(bm, prof_y([(-r * 0.85, -0.0009), (r * 0.85, -0.0009), (r * 0.85, 0.0002), (-r * 0.85, 0.0002)], -r * 0.16, r * 0.16))
        return bm
    k = 6 if kind == 'hex' else 12
    rin = r * 0.48
    # kepala: cincin luar + ceruk poligon (dinding & dasar ceruk)
    outer = [(r * math.cos(2 * pi * i / n), r * math.sin(2 * pi * i / n)) for i in range(n)]
    A = [bm.verts.new((x, y, -h)) for x, y in outer]
    B = [bm.verts.new((x * 0.86, y * 0.86, 0.0)) for x, y in outer]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((A[i], A[j], B[j], B[i]))
    bm.faces.new(list(reversed(A)))
    hole = []
    for i in range(n):
        a = 2 * pi * i / n
        if kind == 'hex':
            seg = 2 * pi / 6
            aa = (a % seg) - seg / 2
            rr = rin * math.cos(pi / 6) / math.cos(aa)
        else:  # torx: bintang 6 lengkung
            rr = rin * (0.8 + 0.2 * math.cos(6 * a))
        hole.append((rr * math.cos(a), rr * math.sin(a)))
    C = [bm.verts.new((x, y, 0.0)) for x, y in hole]
    Dd = [bm.verts.new((x, y, -h * 0.7)) for x, y in hole]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((B[i], B[j], C[j], C[i]))
        bm.faces.new((C[i], C[j], Dd[j], Dd[i]))
    bm.faces.new(list(reversed(Dd)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method='BEAUTY', ngon_method='EAR_CLIP')
    return bm


def screw_on(bm_dst, kind, d, pos, normal, h=0.0016):
    """Pasang kepala baut di pos dengan puncaknya menghadap `normal` (vektor)."""
    nrm = Vector(normal).normalized()
    q = Vector((0, 0, 1)).rotation_difference(nrm)
    M = _T(*pos) @ q.to_matrix().to_4x4()
    return merge_into(bm_dst, screw(kind, d, h), M)


def lens(r, bulge=0.0012, n=32, rings=3):
    """Cakram lensa cembung di bidang XZ, menonjol ke −Y (ke belakang); puncak kubah y = −bulge."""
    prof = [(r * (1 - i / rings), -bulge * math.sin(pi / 2 * i / rings)) for i in range(rings + 1)]
    return lathe([(r, 0.0002)] + prof, n)


# ---------------------------------------------------------------- dudukan cincin
def rail_clamp(y0, y1, w=0.026, z_top=0.004):
    """Rahang penjepit di rel (z = 0 = puncak rel): blok di atas rel + dua bibir yang memeluk ekor burung."""
    out = []
    sec = [(-w / 2, z_top), (-w / 2, -0.0036), (-RAIL_W / 2 + 0.0006, -0.0052), (-RAIL_W / 2 + 0.0016, -0.0030),
           (RAIL_W / 2 - 0.0016, -0.0030), (RAIL_W / 2 - 0.0006, -0.0052), (w / 2, -0.0036), (w / 2, z_top)]
    out.append(prof_y(sec, y0, y1))
    return out


def ring_mount(tube_r, h, w=0.014, base_w=0.026, screws=True, n=32, wall=0.0032):
    """Satu cincin teropong pada rel (y = 0 = tengah cincin; z = 0 = puncak rel; sumbu tabung z = h).
    → [(bm, material)]: badan cincin + tiang 'dark', baut 'steel'."""
    parts = []
    R = tube_r + wall
    body = bmesh.new()
    # cincin (dinding tebal) dengan celah belah di atas & bawah sumbu samping (tutup terpisah, garis belah)
    ring = lathe([(tube_r, -w / 2), (R - 0.0006, -w / 2), (R, -w / 2 + 0.0006), (R, w / 2 - 0.0006), (R - 0.0006, w / 2), (tube_r, w / 2), (tube_r, -w / 2)], n)
    xf(ring, _T(0, 0, h))
    merge_into(body, ring)
    # telinga baut di kiri-kanan garis belah
    for sx in (-1, 1):
        ear = plate([(-w / 2, -0.004), (w / 2, -0.004), (w / 2, 0.004), (-w / 2, 0.004)], 0.006, 0.0012, 0.0006, x0=sx * (R + 0.0018))
        xf(ear, _T(0, 0, h))
        merge_into(body, ear)
    # tiang: siluet samping meruncing dari dasar ke cincin
    zb = h - tube_r - wall * 0.6
    stem = plate([(-w / 2 - 0.003, 0.0035), (w / 2 + 0.003, 0.0035), (w / 2, zb + 0.002), (-w / 2, zb + 0.002)], 0.017, [0.0015, 0.0015, 0.0, 0.0], 0.0008)
    merge_into(body, stem)
    for b in rail_clamp(-w / 2 - 0.003, w / 2 + 0.003, base_w):
        merge_into(body, b)
    parts.append((body, 'dark'))
    if screws:
        S = bmesh.new()
        for sx in (-1, 1):
            for yy in (-w * 0.27, w * 0.27):
                screw_on(S, 'torx', 0.0034, (sx * (R + 0.0018), yy, h + 0.004), (0, 0, 1))
        # baut silang penjepit: kepala kiri, mur kanan
        screw_on(S, 'hex', 0.006, (-base_w / 2 - 0.0002, 0.0, -0.0012), (-1, 0, 0), 0.0022)
        nut = cyl(0.0042, 0.003, 6, 0.0)
        xf(nut, _T(base_w / 2, 0.0, -0.0012) @ Matrix.Rotation(pi / 2, 4, 'Y'))
        merge_into(S, nut)
        parts.append((S, 'steel'))
    return parts


# ---------------------------------------------------------------- boolean
def cut(bm, cutters, solver='EXACT'):
    """Kurangi bm dengan daftar bmesh pemotong (boolean DIFFERENCE, EXACT). Mengembalikan bmesh baru; pemotong dibebaskan.
    Material index dari face bm dipertahankan; face hasil potongan memakai material face terdekat (urusan Blender)."""
    import bpy
    if not cutters:
        return bm
    me = bpy.data.meshes.new('_cut_src')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('_cut_src', me)
    bpy.context.scene.collection.objects.link(ob)
    cme = bpy.data.meshes.new('_cut_tool')
    cb = bmesh.new()
    for c in cutters:
        merge_into(cb, c)
    cb.to_mesh(cme)
    cb.free()
    co = bpy.data.objects.new('_cut_tool', cme)
    bpy.context.scene.collection.objects.link(co)
    md = ob.modifiers.new('cut', 'BOOLEAN')
    md.operation = 'DIFFERENCE'
    md.solver = solver
    md.object = co
    dg = bpy.context.evaluated_depsgraph_get()
    out = bmesh.new()
    out.from_object(ob, dg)
    bpy.data.objects.remove(ob)
    bpy.data.objects.remove(co)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(cme)
    return out


def box(sx, sy, sz, cx=0.0, cy=0.0, cz=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((cx + v.co.x * sx, cy + v.co.y * sy, cz + v.co.z * sz))
    return bm


def slot_x(y0, y1, z, h, w=0.02, r=None, n=4):
    """Pemotong celah lonjong (stadium) menembus sumbu X: panjang y0..y1, tinggi h, lebar tembus w."""
    r = h / 2 if r is None else r
    pts = fillet2d([(y0, z - h / 2), (y1, z - h / 2), (y1, z + h / 2), (y0, z + h / 2)], r, n)
    bm, _, _ = ext_x(pts, w)
    return bm


def slot_z(y0, y1, x, w, depth=0.04, z=0.0, n=4):
    """Pemotong celah lonjong vertikal (menembus sumbu Z) di x, panjang y0..y1, lebar w."""
    bm = slot_x(y0, y1, 0.0, w, depth, None, n)
    return xf(bm, _T(x, 0, z) @ Matrix.Rotation(pi / 2, 4, 'Y'))


def loft_shell(secs, n=24, wall=0.0025):
    """Cangkang berongga sepanjang Y (pelindung tangan): penampang superelips seperti loft_se, dinding setebal `wall`,
    ujung berupa cincin. Rongga memperlihatkan laras lewat celah yang dipotong boolean."""
    bm = bmesh.new()
    O = [[bm.verts.new(p) for p in se_ring(0.0, y, zc, hx, ht, hb, e, n)] for (y, zc, ht, hb, hx, e) in secs]
    I = [[bm.verts.new(p) for p in se_ring(0.0, y, zc, hx - wall, ht - wall, hb - wall, e, n)] for (y, zc, ht, hb, hx, e) in secs]
    m = len(secs)
    for i in range(m - 1):
        for j in range(n):
            j2 = (j + 1) % n
            bm.faces.new((O[i][j], O[i][j2], O[i + 1][j2], O[i + 1][j]))
            bm.faces.new((I[i][j2], I[i][j], I[i + 1][j], I[i + 1][j2]))
    for j in range(n):
        j2 = (j + 1) % n
        bm.faces.new((O[0][j2], O[0][j], I[0][j], I[0][j2]))
        bm.faces.new((O[-1][j], O[-1][j2], I[-1][j2], I[-1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def radial_slots(y0, y1, r0, r1, w, angles, zc=0.0):
    """Pemotong celah memanjang di sekeliling sumbu Y (peredam kilat sangkar, rem moncong): satu kotak per sudut (derajat,
    0 = atas, searah jarum jam dilihat dari belakang)."""
    out = []
    for a in angles:
        b = box(w, y1 - y0, r1 - r0, 0.0, (y0 + y1) / 2, (r0 + r1) / 2)
        out.append(xf(b, _T(0, 0, zc) @ Matrix.Rotation(-a * D2R, 4, 'Y')))
    return out
