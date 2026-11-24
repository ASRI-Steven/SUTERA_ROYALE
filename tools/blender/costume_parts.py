# Bagian kostum buatan sendiri [BL] (tools/blender/costumes.py): dibangkitkan prosedural di POSE DIAM game dari ukuran tubuh
# tiap varian (cincin badan, elipsoid tengkorak, telapak kaki), jadi pas di m1/f1/m2/f2 tanpa disetel tangan.
# Koordinat: meter, +Y atas, +Z depan, +X = kiri karakter. Semua desain orisinal (tanpa merek/IP, tanpa lambang negara/agama).
#
# Mesh.finish() → dict bagian: rest/pos (n,3), faces [(k,2) → (verteks, uv)], uv (meter), q (parameter ternormalkan untuk bahan),
# nrm (normal halus per kisi), wspec (cara bobot), mat (nama bahan, param), budget (anggaran segitiga LOD0), prio (kerapatan texel).
# wspec: ('bone', nama) kaku 100 % · ('near', titik) kaku ke campuran bobot tubuh di titik itu · ('skin',) bobot tubuh terdekat
#        per verteks · ('fn', f(P) → (n, 17)) rumus sendiri.
import math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import characters3 as C3

BI = C3.BI
nrm = C3.nrm


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Mesh:
    def __init__(self, name, mat, wspec, tris=None, prio=1.0):
        self.name, self.mat, self.wspec, self.tris, self.prio = name, mat, wspec, tris, prio
        self.P, self.UV, self.Q, self.T, self.G, self.n, self.ng = [], [], [], [], [], 0, 0

    def _add(self, P, UV, T, Q=None):
        P = np.asarray(P, dtype=np.float64)
        self.P.append(P); self.UV.append(np.asarray(UV, dtype=np.float64)); self.T.append(np.asarray(T, dtype=np.int64) + self.n)
        self.Q.append(np.zeros((len(P), 2)) if Q is None else np.asarray(Q, dtype=np.float64))
        self.G.append(np.full(len(P), self.ng)); self.n += len(P); self.ng += 1

    def grid(self, pts, wrap=False, mask=None, q=None):
        """pts (m, n, 3) baris × kolom. wrap: kolom menyambung (kolom pertama digandakan di jahitan → uv utuh).
        uv = panjang busur rata-rata (meter). q (m, n, 2) opsional; kalau kosong q = (u, v) ternormalkan 0..1."""
        pts = np.asarray(pts, dtype=np.float64)
        if wrap:
            pts = np.concatenate([pts, pts[:, :1]], axis=1)
            if q is not None:
                q = np.concatenate([q, q[:, :1]], axis=1)
            if mask is not None:
                mask = np.asarray(mask)
        m, n = pts.shape[:2]
        du = np.linalg.norm(pts[:, 1:] - pts[:, :-1], axis=2).mean(axis=0); dv = np.linalg.norm(pts[1:] - pts[:-1], axis=2).mean(axis=1)
        u = np.concatenate([[0], np.cumsum(du)]); v = np.concatenate([[0], np.cumsum(dv)])
        UV = np.stack(np.meshgrid(u, v), axis=2).reshape(-1, 2)
        if q is None:
            q = np.stack(np.meshgrid(u / max(u[-1], 1e-9), v / max(v[-1], 1e-9)), axis=2)
        tri = []
        for i in range(m - 1):
            for j in range(n - 1):
                if mask is not None and not mask[i][j]:
                    continue
                a, b, c, d = i * n + j, i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j
                tri += [(a, b, c), (a, c, d)]
        if tri:
            self._add(pts.reshape(-1, 3), UV, tri, np.asarray(q).reshape(-1, 2))

    def box(self, c, ax, ay, az, taper=1.0, taper_y=None):
        """kotak bersisi rata: pusat c, setengah-sumbu ax, ay, az; taper mengecilkan sisi +az (taper_y: khusus arah ay)"""
        c, ax, ay, az = (np.asarray(v, dtype=np.float64) for v in (c, ax, ay, az))
        ty = taper if taper_y is None else taper_y
        V = [c + sx * ax * (taper if sz > 0 else 1) + sy * ay * (ty if sz > 0 else 1) + sz * az for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
        for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            qd = np.array([V[k] for k in f])
            if np.dot(np.cross(qd[1] - qd[0], qd[3] - qd[0]), qd.mean(axis=0) - c) < 0:
                qd = qd[::-1]
            self.grid(np.array([[qd[0], qd[1]], [qd[3], qd[2]]]))

    def tube(self, path, radius, n=8, caps=True, up=(0, 1, 0)):
        """tabung mengikuti jalur (k, 3); radius skalar atau (k,)"""
        path = np.asarray(path, dtype=np.float64); k = len(path)
        rad = np.broadcast_to(np.asarray(radius, dtype=np.float64), (k,))
        tang = np.gradient(path, axis=0); tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
        ref = np.asarray(up, dtype=np.float64)
        rows = []
        for i in range(k):
            x = np.cross(ref, tang[i])
            if np.linalg.norm(x) < 1e-3:
                x = np.cross([1.0, 0, 0], tang[i])
            x = nrm(x); y = np.cross(tang[i], x)
            th = np.arange(n) / n * 2 * math.pi
            rows.append(path[i] + rad[i] * (np.cos(th)[:, None] * x + np.sin(th)[:, None] * y))
        rows = np.array(rows)
        self.grid(rows, wrap=True)
        if caps:
            for row, ctr in ((rows[0], path[0]), (rows[-1], path[-1])):
                self.grid(np.stack([row, np.tile(ctr, (n, 1))]), wrap=True)

    def ellipsoid(self, c, rx, ry, rz, nu=10, nv=6, v0=-math.pi / 2, v1=math.pi / 2, R=None):
        """elipsoid (atau potongannya v0..v1 = lintang); R (3×3) opsional memutar sumbu"""
        uu = np.arange(nu) / nu * 2 * math.pi; vv = np.linspace(v0, v1, nv)
        rows = np.zeros((nv, nu, 3))
        for i, v in enumerate(vv):
            rows[i, :, 0] = rx * math.cos(v) * np.sin(uu); rows[i, :, 1] = ry * math.sin(v); rows[i, :, 2] = rz * math.cos(v) * np.cos(uu)
        if R is not None:
            rows = rows @ np.asarray(R).T
        self.grid(rows + np.asarray(c, dtype=np.float64), wrap=True)

    def leaf(self, root, d, nor, L, w, nu=3, nv=6, bend=0.0, cup=0.0, tip=0.55, base=0.35):
        """bilah berbentuk daun/bulu: dari root sepanjang d (panjang L), lebar maks w, normal bidang nor; bend melengkungkan
        ujung ke arah nor, cup mencekungkan penampang. q = (u −1..1, v 0..1)"""
        root, d, nor = np.asarray(root, dtype=np.float64), nrm(d), np.asarray(nor, dtype=np.float64)
        nor = nrm(nor - d * nor.dot(d)); side = np.cross(d, nor)
        vs = np.linspace(0, 1, nv); us = np.linspace(-1, 1, nu)
        prof = np.where(vs < tip, base + (1 - base) * np.sin(np.clip(vs / tip, 0, 1) * math.pi / 2) ** 0.8, np.sqrt(np.clip(1 - ((vs - tip) / (1 - tip)) ** 2, 0, 1)) * 0.98 + 0.02)
        pts = np.zeros((nv, nu, 3)); q = np.zeros((nv, nu, 2))
        for i, v in enumerate(vs):
            for j, u in enumerate(us):
                pts[i, j] = root + d * (L * v) + side * (0.5 * w * prof[i] * u) + nor * (bend * L * v * v - cup * w * (1 - u * u) * prof[i])
                q[i, j] = (u, v)
        self.grid(pts, q=q)

    def empty(self):
        return self.n == 0

    def finish(self):
        P = np.concatenate(self.P); UV = np.concatenate(self.UV); Q = np.concatenate(self.Q); T = np.concatenate(self.T); G = np.concatenate(self.G)
        # normal halus per kisi (verteks kembar di jahitan satu kisi dilas; antar-kisi tetap tajam)
        key = np.concatenate([G[:, None], np.round(P * 1e5)], axis=1)
        _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
        fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
        acc = np.zeros((inv.max() + 1, 3))
        for k in range(3):
            np.add.at(acc, inv[T[:, k]], fn)
        N = acc[inv]; N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
        faces = [np.stack([t, t], axis=1) for t in T]
        return dict(name=self.name, kind='cloth', bl=True, rest=P, pos=P.copy(), faces=faces, uv=UV, q=Q, nrm=N, wspec=self.wspec, mat=self.mat,
                    budget=self.tris or len(T), prio=self.prio)


# ---------- konteks ukuran tubuh ----------
class Body:
    def __init__(self, var):
        self.var = var
        self.top, self.a, self.zc, self.b, self.yc = C3.head_metrics(var)
        self.crv = 0.112
        P, O = [], []
        for p in var['parts']:
            if p['kind'] in ('skin', 'cloth', 'shoe'):
                P.append(p['rest']); O.append(p['ow'])
        self.P = np.concatenate(P); self.O = np.concatenate(O)
        self.arms = self.O[:, [BI[b] for b in ('armL', 'foreL', 'handL', 'armR', 'foreR', 'handR')]].sum(axis=1)
        V, F, off = [], [], 0
        for p in var['parts']:
            if p['kind'] in ('skin', 'cloth', 'shoe'):
                V.append(p['rest']); F += [tuple(int(i) + off for i in f[:, 0]) for f in p['faces']]; off += len(p['rest'])
        self.tree = BVHTree.FromPolygons([tuple(v) for v in np.concatenate(V)], F)
        self.skin = next(p for p in var['parts'] if p['kind'] == 'skin')

    def hull(self, ys, nb=64, band=0.03, arms=False, xmax=0.3):
        """selubung cembung (fungsi penopang) tubuh tanpa lengan di tiap tinggi → (zc (k,), R (k, nb), th (nb,)); sudut 0 = depan"""
        th = -math.pi + (np.arange(nb) + 0.5) * 2 * math.pi / nb
        D = np.stack([np.sin(th), np.cos(th)], axis=1)
        Pb = self.P if arms else self.P[self.arms < 0.35]
        zc = np.zeros(len(ys)); R = np.zeros((len(ys), nb))
        for k, y in enumerate(ys):
            q = Pb[(np.abs(Pb[:, 1] - y) < band) & (np.abs(Pb[:, 0]) < xmax)]
            if len(q) < 4:
                zc[k] = zc[k - 1] if k else 0.0; R[k] = R[k - 1] if k else 0.1
                continue
            zc[k] = 0.5 * (q[:, 2].min() + q[:, 2].max())
            R[k] = (np.stack([q[:, 0], q[:, 2] - zc[k]], axis=1) @ D.T).max(axis=0)
        zc = np.convolve(np.pad(zc, 2, mode='edge'), [0.1, 0.2, 0.4, 0.2, 0.1], mode='valid')
        for _ in range(2):
            R = (np.roll(R, 1, axis=1) + 2 * R + np.roll(R, -1, axis=1)) / 4
            R = np.concatenate([R[:1], (R[:-2] + 2 * R[1:-1] + R[2:]) / 4, R[-1:]])
        return zc, R, th

    def ring_pts(self, ys, zc, R, th, off=0.0):
        rows = np.zeros((len(ys), len(th), 3))
        for k, y in enumerate(ys):
            r = R[k] + (off[k] if np.ndim(off) else off)
            rows[k, :, 0] = r * np.sin(th); rows[k, :, 1] = y; rows[k, :, 2] = zc[k] + r * np.cos(th)
        return rows

    def onto(self, pts, lift, ref=None):
        out, nor = [], []
        for q in np.asarray(pts, dtype=np.float64):
            loc, n, _, _ = self.tree.find_nearest(Vector(q))
            loc = np.array(loc); n = np.array(n)
            if ref is not None and np.dot(n, loc - np.asarray(ref)) < 0:
                n = -n
            out.append(loc + n * lift); nor.append(n)
        return np.array(out), np.array(nor)

    def ray(self, o, d, dist=1.0):
        loc, n, _, _ = self.tree.ray_cast(Vector(o), Vector(d), dist)
        return (None, None) if loc is None else (np.array(loc), np.array(n))

    def around(self, cx, y, cz=0.0, n=14, lift=0.005, rmax=0.2):
        """cincin mengelilingi anggota badan di sumbu (cx, y, cz): sinar dari sumbu ke luar → (titik, normal keluar)"""
        pp, nn = [], []
        for a in np.arange(n) / n * 2 * math.pi:
            d = np.array([math.sin(a), 0.0, math.cos(a)])
            hit, _ = self.ray((cx, y, cz), d, rmax)
            r = 0.07 if hit is None else float(np.linalg.norm(hit - np.array([cx, y, cz])))
            pp.append(np.array([cx, y, cz]) + d * (r + lift)); nn.append(d)
        return np.array(pp), np.array(nn)

    def skull(self, th, ph, t):
        """titik pada elipsoid tengkorak yang ditebalkan t: th = sudut keliling (0 = depan), ph = sudut dari puncak"""
        return np.stack([(self.a + t) * np.sin(ph) * np.sin(th), self.yc + (self.crv + t) * np.cos(ph), self.zc + (self.b + t) * np.sin(ph) * np.cos(th)], axis=-1)

    def skull_shell(self, t, brim, nt=32, nr=8, squash=1.0):
        """kubah mengikuti tengkorak dari puncak sampai garis tepi brim(th) → y; → rows (nr, nt, 3), th"""
        th = (np.arange(nt) + 0.5) / nt * 2 * math.pi - math.pi
        yb = brim(th)
        ph_max = np.arccos(np.clip((yb - self.yc) / (self.crv + t), -1, 1))
        rows = np.zeros((nr, nt, 3))
        for i in range(nr):
            ph = ph_max * (i / (nr - 1)) if i else np.full(nt, 0.03)
            rows[i] = self.skull(th, ph, t)
            rows[i, :, 1] = self.yc + (rows[i, :, 1] - self.yc) * (squash if i < nr - 1 else 1.0) if squash != 1.0 else rows[i, :, 1]
        return rows, th

    def foot(self, side):
        b = BI['foot' + side]
        F = self.skin['rest'][self.skin['ow'][:, b] > 0.5]
        if len(F) < 8:  # kaki tertutup sepatu: pakai semua bagian
            F = self.P[self.O[:, b] > 0.5]
        return F


def leg_weights(P):
    """bobot kain bawah (jarik, dodot): pinggul di atas, lalu paha/betis kiri-kanan; bagian tengah depan/belakang = campuran
    kedua kaki (rig tanpa tulang rok)"""
    y, x = P[:, 1], P[:, 0]
    O = np.zeros((len(P), len(C3.BONES)))
    hip = sstep(0.78, 0.96, y)
    wl = sstep(-0.075, 0.075, x)
    s = sstep(0.40, 0.58, y)
    f = sstep(0.05, 0.16, y)  # paling bawah tetap ikut betis (bukan telapak)
    O[:, BI['hips']] = hip
    O[:, BI['thighL']] = (1 - hip) * wl * s; O[:, BI['shinL']] = (1 - hip) * wl * (1 - s)
    O[:, BI['thighR']] = (1 - hip) * (1 - wl) * s; O[:, BI['shinR']] = (1 - hip) * (1 - wl) * (1 - s)
    return O.astype(np.float32)


def tail_weights(P):
    O = leg_weights(P) * 0.5
    O[:, BI['hips']] += 0.5
    return O


def drape_radii(R, off, taper=0.992, flare=0.0):
    """kain jatuh dari bagian terlebar: jari-jari tiap baris (atas → bawah) tidak menyempit lebih cepat dari `taper` per baris"""
    out = np.zeros_like(R); n = len(R)
    for k in range(n):
        base = R[k] + off
        out[k] = base if k == 0 else np.maximum(base, out[k - 1] * taper)
        out[k] = out[k] + flare * (k / max(n - 1, 1)) ** 2
    return out


# ============================================================ BATIK PARANG ============================================================
def blangkon(B, mat_body, mat_band):
    """blangkon: kubah kain mengikuti kepala, pita wiron di sekeliling tepi, mondolan (simpul) di belakang-bawah"""
    out = []
    t = 0.013
    brim = lambda th: B.yc + np.where(np.cos(th) >= 0, 0.004 + 0.040 * np.clip(np.cos(th), 0, 1) ** 1.2, 0.004 - 0.062 * np.clip(-np.cos(th), 0, 1) ** 0.9)
    m = Mesh('blangkon', mat_body, ('bone', 'head'), prio=1.5)
    rows, th = B.skull_shell(t, brim, nt=36, nr=9)
    # puncak agak rata (khas blangkon) + lipatan tengah sedikit menonjol ke depan
    yt = B.yc + (B.crv + t)
    rows[:, :, 1] = np.minimum(rows[:, :, 1], yt - 0.010 - 0.0 * rows[:, :, 0])
    m.grid(rows, wrap=True)
    # tepi dalam (ketebalan kain)
    rim = np.stack([rows[-1], rows[-1] * [0.93, 1, 1] + [0, -0.004, 0]]); rim[1, :, 2] = B.zc + (rows[-1, :, 2] - B.zc) * 0.93
    m.grid(rim, wrap=True)
    # mondolan
    m.ellipsoid([0, B.yc - 0.048, B.zc - B.b - 0.016], 0.036, 0.027, 0.03, nu=12, nv=6)
    out.append(m)
    # wiron: pita lipatan melingkar di atas tepi, lebih tinggi di depan
    w = Mesh('blangkon_wiron', mat_band, ('bone', 'head'), prio=1.5)
    nt = len(th)
    yb = rows[-1, :, 1]
    hgt = 0.02 + 0.014 * np.clip(np.cos(th), 0, 1) ** 2
    ring = np.zeros((4, nt, 3)); q = np.zeros((4, nt, 2))
    for i, (f, tt) in enumerate(((0.0, t + 0.002), (0.12, t + 0.0075), (0.9, t + 0.0075), (1.0, t + 0.002))):
        y = yb - 0.003 + hgt * f
        ph = np.arccos(np.clip((y - B.yc) / (B.crv + tt), -1, 1))
        ring[i] = B.skull(th, ph, tt); ring[i, :, 1] = y
        q[i, :, 0] = (th + math.pi) / (2 * math.pi); q[i, :, 1] = f
    w.grid(ring, wrap=True, q=q)
    out.append(w)
    return out


def jarik(B, mat, mat_wiron, y_top=1.045, y_hem=0.135):
    """jarik semata kaki: selubung kain jatuh dari pinggul, wiron (lipatan akordeon) di depan agak ke kiri"""
    ys = np.linspace(y_top, y_hem, 34)
    zc, R, th = B.hull(ys, nb=64)
    Rd = drape_radii(R, 0.014, taper=0.990)
    rows = B.ring_pts(ys, zc, Rd, th)
    q = np.zeros(rows.shape[:2] + (2,)); q[:, :, 0] = (th + math.pi) / (2 * math.pi); q[:, :, 1] = np.linspace(0, 1, len(ys))[:, None]
    m = Mesh('jarik', mat, ('fn', leg_weights), tris=2400, prio=1.0)
    m.grid(rows, wrap=True, q=q)
    # wiron: jalur selebar 6 → 10 cm, 5 lipatan, menonjol 1 cm; berpusat di sudut +0,22 rad (kiri-depan)
    w = Mesh('jarik_wiron', mat_wiron, ('fn', leg_weights), tris=700, prio=1.0)
    npl, nc = 5, 11
    th0 = 0.2
    pts = np.zeros((len(ys), nc, 3)); qq = np.zeros((len(ys), nc, 2))
    for k, y in enumerate(ys):
        f = k / (len(ys) - 1)
        half = 0.030 + 0.022 * f
        for j in range(nc):
            u = j / (nc - 1) * 2 - 1
            tj = th0 + u * half / 0.17
            r = np.interp(tj, th, Rd[k]) + 0.004 + (0.011 if j % 2 else 0.002) + 0.004 * f
            pts[k, j] = (r * math.sin(tj) + 0.004 * (j % 2), y, zc[k] + r * math.cos(tj))
            qq[k, j] = (j / (nc - 1) * npl, f)
    w.grid(pts, q=qq)
    return [m, w]


def stagen(B, mat_sash, mat_epek, mat_gold):
    """stagen (ikat pinggang kain lebar) + epek + timang (kepala sabuk emas)"""
    out = []
    ys = np.linspace(0.985, 1.125, 6)
    zc, R, th = B.hull(ys, nb=48)
    m = Mesh('stagen', mat_sash, ('skin',), tris=500)
    off = 0.019 + 0.003 * np.sin(np.linspace(0, math.pi, len(ys)))
    m.grid(B.ring_pts(ys, zc, R, th, off), wrap=True)
    out.append(m)
    e = Mesh('epek', mat_epek, ('skin',), tris=300)
    ye = np.linspace(1.03, 1.08, 3)
    Re = np.stack([np.array([np.interp(yy, ys, R[:, j]) for j in range(len(th))]) for yy in ye]); ze = np.interp(ye, ys, zc)
    zc2, R2 = ze, Re
    e.grid(B.ring_pts(ye, ze, Re, th, np.array([0.0275, 0.031, 0.0275])), wrap=True)
    out.append(e)
    j0 = int(np.argmin(np.abs(th)))
    zf = zc2[1] + R2[1][j0] + 0.031
    g = Mesh('timang', mat_gold, ('near', (0.0, 1.055, zf)), prio=2.0)
    g.box([0, 1.055, zf + 0.004], [0.03, 0, 0], [0, 0.022, 0], [0, 0, 0.006], taper=0.8)
    g.box([0, 1.055, zf + 0.011], [0.016, 0, 0], [0, 0.012, 0], [0, 0, 0.003], taper=0.7)
    out.append(g)
    return out


def keris_kecil(B, mat_wood, mat_gold, mat_hilt):
    """keris kecil terselip di stagen belakang, hulu ke kanan-atas (dilihat dari belakang)"""
    ys = np.array([1.06]); zc, R, th = B.hull(ys, nb=48)
    jb = int(np.argmax(np.abs(th)))
    zb = zc[0] - R[0][jb] - 0.034
    o = np.array([-0.012, 1.085, zb])
    down = nrm([0.50, -0.86, -0.06]); side = nrm(np.cross(down, [0, 0, -1.0])); back = np.cross(side, down)
    out = []
    w = Mesh('keris_warangka', mat_wood, ('near', (0.0, 1.06, zb + 0.03)), prio=1.6)
    # gandar (batang sarung) bagian atas kayu
    w.box(o + down * 0.05, side * 0.017, back * 0.0095, down * 0.05, taper=0.92)
    # warangka (melintang, bentuk perahu): elipsoid pipih
    Rm = np.stack([side, down, back], axis=1)
    w.ellipsoid(o - down * 0.012 + side * 0.008, 0.062, 0.02, 0.012, nu=10, nv=5, R=Rm)
    out.append(w)
    g = Mesh('keris_pendok', mat_gold, ('near', (0.0, 1.06, zb + 0.03)), prio=1.6)
    g.box(o + down * 0.185, side * 0.0155, back * 0.009, down * 0.09, taper=0.55)
    g.tube([o - down * 0.03, o - down * 0.04], 0.012, n=8)  # mendak
    out.append(g)
    h = Mesh('keris_hulu', mat_hilt, ('near', (0.0, 1.06, zb + 0.03)), prio=1.6)
    p0 = o - down * 0.04
    path = [p0, p0 - down * 0.03 - back * 0.002, p0 - down * 0.058 + side * 0.006 - back * 0.008, p0 - down * 0.078 + side * 0.02 - back * 0.012]
    h.tube(path, [0.0105, 0.012, 0.0125, 0.009], n=8)
    out.append(h)
    return out


def selop(B, mat_upper, mat_sole, sole=0.012):
    """selop: sol tipis + penutup depan (jari sampai punggung kaki); tumit terbuka"""
    out = []
    for S, sg in (('L', 1), ('R', -1)):
        F = B.foot(S)
        z0, z1 = F[:, 2].min(), F[:, 2].max(); L = z1 - z0
        zs = np.linspace(z0 - 0.004, z1 + 0.008, 12)
        xc = np.zeros(len(zs)); hw = np.zeros(len(zs)); ht = np.zeros(len(zs))
        for i, z in enumerate(zs):
            q = F[np.abs(F[:, 2] - z) < 0.016]
            if len(q) < 3:
                q = F[np.argsort(np.abs(F[:, 2] - z))[:6]]
            lo = q[q[:, 1] < 0.05]
            lo = lo if len(lo) >= 2 else q
            xc[i] = 0.5 * (lo[:, 0].min() + lo[:, 0].max()); hw[i] = 0.5 * (lo[:, 0].max() - lo[:, 0].min()) + 0.009
            ht[i] = q[:, 1].max()
        hw = np.convolve(np.pad(hw, 1, mode='edge'), [0.25, 0.5, 0.25], mode='valid'); xc = np.convolve(np.pad(xc, 1, mode='edge'), [0.25, 0.5, 0.25], mode='valid')
        end = np.sqrt(np.clip(1 - np.clip(np.abs((zs - 0.5 * (z0 + z1)) / (0.5 * L + 0.008)), 0, 1) ** 4, 0.03, 1))
        hw = np.maximum(hw * end, 0.01)
        so = Mesh('selop_sol_' + S, mat_sole, ('bone', 'foot' + S))
        ring = np.stack([np.stack([xc - hw, np.zeros(len(zs)), zs], axis=1), np.stack([xc + hw, np.zeros(len(zs)), zs], axis=1)], axis=1)  # (k, 2, 3)
        top = ring + [0, sole, 0]
        so.grid(top); so.grid(ring[:, ::-1])
        so.grid(np.stack([ring[:, 0], top[:, 0]], axis=1)); so.grid(np.stack([top[:, 1], ring[:, 1]], axis=1))
        out.append(so)
        up = Mesh('selop_atas_' + S, mat_upper, ('bone', 'foot' + S), prio=1.3)
        sel = zs > z0 + 0.42 * L
        zz = zs[sel]; nphi = 9
        pts = np.zeros((len(zz), nphi, 3))
        for i, z in enumerate(zz):
            k = np.nonzero(sel)[0][i]
            f = (z - zz[0]) / max(zz[-1] - zz[0], 1e-6)
            h = max(ht[k] + 0.013 - sole, 0.02) * (1.0 if f < 0.75 else math.sqrt(max(1 - ((f - 0.75) / 0.25) ** 2, 0.04)))
            for j in range(nphi):
                phi = j / (nphi - 1) * math.pi
                pts[i, j] = (xc[k] + (hw[k] + 0.003) * math.cos(phi) * sg, sole + h * math.sin(phi) ** 0.7, z)
        up.grid(pts)
        out.append(up)
    return out


# ============================================================ OPERATOR MALAM ============================================================
def nvg(B, mat_body, mat_lens, mat_strap, t=0.012):
    """NVG dua tabung terangkat di dahi: pita kepala, dudukan, lengan, tabung + lensa, kotak baterai di belakang"""
    out = []
    s = Mesh('nvg_strap', mat_strap, ('bone', 'head'))
    nt = 32
    th = (np.arange(nt) + 0.5) / nt * 2 * math.pi - math.pi
    yb = B.yc + 0.034 + 0.016 * np.cos(th)
    ring = np.zeros((2, nt, 3))
    for i, dy in enumerate((0.0, 0.026)):
        ph = np.arccos(np.clip((yb + dy - B.yc) / (B.crv + t), -1, 1))
        ring[i] = B.skull(th, ph, t + 0.002)
    s.grid(ring, wrap=True)
    # pita atas kepala (depan → belakang)
    ph = np.linspace(-1.25, 1.25, 11)
    top = np.stack([B.skull(np.where(ph >= 0, 0.0, math.pi), np.abs(ph), t + 0.002) + [dx, 0, 0] for dx in (-0.011, 0.011)], axis=1)
    s.grid(top)
    out.append(s)
    m = Mesh('nvg', mat_body, ('bone', 'head'), prio=1.6)
    zf = B.zc + B.b + t
    yf = B.yc + 0.05
    m.box([0, yf, zf + 0.008], [0.024, 0, 0], [0, 0.02, 0], [0, 0, 0.008])                       # pelat dudukan
    m.box([0, yf + 0.028, zf + 0.014], [0.011, 0, 0], [0, 0.02, 0.004], [0, -0.003, 0.009])      # lengan engsel
    ax = nrm([0, 0.94, 0.34])
    c0 = np.array([0, yf + 0.052, zf + 0.018])
    m.box(c0 + ax * 0.012, [0.036, 0, 0], np.cross(ax, [1, 0, 0]) * 0.014, ax * 0.016)          # jembatan antar-tabung
    for sx in (1, -1):
        p0 = c0 + [sx * 0.033, 0, 0] - ax * 0.012
        m.tube([p0, p0 + ax * 0.042, p0 + ax * 0.044, p0 + ax * 0.07], [0.0185, 0.0185, 0.0215, 0.0215], n=10, caps=False)
        m.tube([p0 - ax * 0.012, p0], [0.014, 0.0185], n=10, caps=False)
    m.box([0, B.yc + 0.02, B.zc - B.b - t - 0.014], [0.03, 0, 0], [0, 0.02, 0], [0, 0, 0.012])    # baterai (penyeimbang)
    out.append(m)
    le = Mesh('nvg_lens', mat_lens, ('bone', 'head'), prio=2.0)
    for sx in (1, -1):
        p0 = c0 + [sx * 0.033, 0, 0] - ax * 0.012
        for pe, rr in ((p0 + ax * 0.068, 0.0195), (p0 - ax * 0.0115, 0.0125)):
            x = np.array([1.0, 0, 0]); y = np.cross(ax, x)
            a = np.arange(10) / 10 * 2 * math.pi
            rim = pe + rr * (np.cos(a)[:, None] * x + np.sin(a)[:, None] * y)
            le.grid(np.stack([rim, np.tile(pe, (10, 1))]), wrap=True)
    out.append(le)
    return out


def plate_carrier(B, mat_body, mat_web, mat_pouch, mat_accent):
    """plate carrier: panel depan/belakang berpita MOLLE, tali bahu, cummerbund, 3 kantong magasin, radio, kantong admin, tanda amber"""
    out = []
    ys = np.linspace(1.045, 1.47, 13); nb = 48
    zc, R, th = B.hull(ys, nb=nb, band=0.028, xmax=0.24)
    t = 0.024
    rows = B.ring_pts(ys, zc, R, th, t)
    mask = np.zeros((len(ys) - 1, nb + 1), dtype=bool)
    side = np.zeros_like(mask)
    for k in range(len(ys) - 1):
        ym = 0.5 * (ys[k] + ys[k + 1])
        for j in range(nb):
            tj = 0.5 * (th[j] + th[(j + 1) % nb]) if j < nb - 1 else math.pi
            af = abs(tj); ab = math.pi - af
            if af < 0.98:
                ok = 1.07 < ym < 1.445 - 0.075 * max(0.0, 1 - af / 0.42)
            elif ab < 0.98:
                ok = 1.07 < ym < 1.46 - 0.03 * max(0.0, 1 - ab / 0.35)
            else:
                ok = False
                side[k, j] = 1.075 < ym < 1.25
            mask[k, j] = ok
    m = Mesh('carrier', mat_web, ('bone', 'chest'), tris=1500, prio=1.15)
    m.grid(rows, wrap=True, mask=mask)
    inner = B.ring_pts(ys, zc, R, th, 0.004)
    K, J = mask.shape
    edge = Mesh('carrier_tepi', mat_body, ('bone', 'chest'), tris=700)
    rw = np.concatenate([rows, rows[:, :1]], axis=1); iw = np.concatenate([inner, inner[:, :1]], axis=1)
    for k in range(K):
        for j in range(nb):
            if not mask[k, j]:
                continue
            j1 = j + 1
            for (dk, dj, e) in ((-1, 0, ((k, j), (k, j1))), (1, 0, ((k + 1, j1), (k + 1, j))), (0, -1, ((k + 1, j), (k, j))), (0, 1, ((k, j1), (k + 1, j1)))):
                kk, jj = k + dk, (j + dj) % nb
                if 0 <= kk < K and mask[kk, jj]:
                    continue
                (a0, b0), (a1, b1) = e
                edge.grid(np.array([[rw[a0, b0], rw[a1, b1]], [iw[a0, b0], iw[a1, b1]]]))
    # cummerbund (sabuk sisi) sedikit lebih tipis
    cb = B.ring_pts(ys, zc, R, th, 0.014)
    edge.grid(cb, wrap=True, mask=side)
    fr = lambda th_, y_: rows[int(np.argmin(np.abs(ys - y_))), int(np.argmin(np.abs(th - th_)))]
    for sx in (1, -1):  # tali bahu
        u = np.linspace(0, 1, 13)[:, None]
        p0 = fr(sx * 0.6, 1.43); p1 = fr(sx * (math.pi - 0.6), 1.45)
        mid = np.array([sx * 0.118, 1.61, 0.5 * (p0[2] + p1[2])])
        path = p0 * (1 - u) ** 2 + mid * 2 * u * (1 - u) + p1 * u ** 2
        pp, nn = B.onto(path, 0.017, ref=np.array([0, 1.38, 0.5 * (p0[2] + p1[2])]))
        tang = np.gradient(pp, axis=0); tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
        sd = np.cross(nn, tang); sd /= np.maximum(np.linalg.norm(sd, axis=1, keepdims=True), 1e-9)
        edge.grid(np.stack([pp - sd * 0.03, pp + nn * 0.006 - sd * 0.026, pp + nn * 0.006 + sd * 0.026, pp + sd * 0.03], axis=1))
    out += [m, edge]
    p = Mesh('carrier_kantong', mat_pouch, ('bone', 'chest'), tris=500, prio=1.2)

    def pouch(mesh, th_, y_, w, h, d, taper=0.9):
        c = fr(th_, y_); n_ = nrm(np.array([math.sin(th_), 0, math.cos(th_)])); tx = np.cross([0, 1, 0], n_)
        mesh.box(c + n_ * d * 0.5, tx * w * 0.5, np.array([0, h * 0.5, 0]), n_ * d * 0.5, taper=taper)
        return c, n_, tx
    for q in range(3):  # magasin: badan + tutup
        c, n_, tx = pouch(p, (q - 1) * 0.40, 1.17, 0.068, 0.12, 0.04)
        p.box(c + n_ * 0.043 + [0, 0.035, 0], tx * 0.036, np.array([0, 0.028, 0]), n_ * 0.004)
    pouch(p, 0.36, 1.36, 0.05, 0.09, 0.032)        # radio
    c, n_, tx = pouch(p, 0.36, 1.36, 0.012, 0.012, 0.012)
    p.tube([c + [0.012, 0.045, 0] + n_ * 0.02, c + [0.014, 0.13, 0] + n_ * 0.022], 0.0035, n=5)  # antena
    pouch(p, -0.3, 1.345, 0.09, 0.052, 0.02)       # admin
    for sx in (1, -1):
        pouch(p, sx * 1.42, 1.16, 0.085, 0.11, 0.032)
    out.append(p)
    a = Mesh('carrier_tanda', mat_accent, ('bone', 'chest'), prio=2.0)
    c, n_, tx = pouch(a, -0.3, 1.405, 0.055, 0.02, 0.006, taper=1.0)  # tanda regu amber di dada kanan
    out.append(a)
    return out


def knee_pads(B, mat_pad, mat_strap):
    out = []
    for S, sg in (('L', 1), ('R', -1)):
        cx, cy = 0.1 * sg, 0.505
        nu, nv = 7, 8
        pts = np.zeros((nv, nu, 3)); ok = True
        for i in range(nv):
            for j in range(nu):
                u, v = j / (nu - 1) * 2 - 1, i / (nv - 1) * 2 - 1
                x, y = cx + u * 0.052 * math.sqrt(max(1 - 0.35 * v * v, 0)), cy + v * 0.078
                hit, n = B.ray((x, y, 0.5), (0, 0, -1), 1.0)
                if hit is None:
                    ok = False; hit = np.array([x, y, 0.06])
                dome = (1 - u * u) * (1 - v * v)
                pts[i, j] = hit + np.array([0, 0, 0.007 + 0.016 * dome ** 0.6])
        m = Mesh('lutut_' + S, mat_pad, ('bone', 'shin' + S), prio=1.2)
        m.grid(pts)
        out.append(m)
        s = Mesh('lutut_tali_' + S, mat_strap, ('bone', 'shin' + S))
        for yy in (cy - 0.06, cy - 0.025):
            pp, nn = B.around(cx, yy, 0.0, lift=0.005)
            s.grid(np.stack([pp + [0, -0.011, 0], pp + nn * 0.003, pp + [0, 0.011, 0]], axis=0), wrap=True)
        out.append(s)
    return out


def belt_pockets(B, mat_belt, mat_pocket, mat_buckle):
    """sabuk taktis + kantong kargo di paha luar + sarung pistol paha kanan (tali melingkari paha)"""
    out = []
    ys = np.linspace(0.975, 1.03, 3)
    zc, R, th = B.hull(ys, nb=48)
    b = Mesh('sabuk_taktis', mat_belt, ('skin',), tris=300)
    b.grid(B.ring_pts(ys, zc, R, th, np.array([0.011, 0.014, 0.011])), wrap=True)
    out.append(b)
    j0 = int(np.argmin(np.abs(th)))
    k = Mesh('sabuk_gesper', mat_buckle, ('near', (0.0, 1.0, zc[1] + R[1][j0])), prio=1.5)
    k.box([0, 1.002, zc[1] + R[1][j0] + 0.017], [0.026, 0, 0], [0, 0.021, 0], [0, 0, 0.005], taper=0.85)
    out.append(k)
    for S, sg in (('L', 1), ('R', -1)):
        p = Mesh('kargo_' + S, mat_pocket, ('bone', 'thigh' + S), prio=1.1)
        hit, n = B.ray((sg * 0.5, 0.70, 0.0), (-sg, 0, 0), 1.0)
        if hit is None:
            continue
        if S == 'L':   # kantong kargo: badan + tutup
            p.box(hit + [sg * 0.014, 0, 0], [0, 0, 0.055], [0, 0.07, 0], [sg * 0.016, 0, 0], taper=0.9)
            p.box(hit + [sg * 0.032, 0.045, 0], [0, 0, 0.058], [0, 0.026, 0], [sg * 0.004, 0, 0])
        else:          # sarung pistol paha: pelat + sarung + gagang
            hit2, _ = B.ray((sg * 0.5, 0.76, 0.0), (-sg, 0, 0), 1.0)
            hit = hit if hit2 is None else hit2
            p.box(hit + [sg * 0.008, 0, 0], [0, 0, 0.05], [0, 0.075, 0], [sg * 0.006, 0, 0])
            p.box(hit + [sg * 0.03, -0.012, 0.004], [0, 0.012, 0.03], [0, 0.07, -0.012], [sg * 0.016, 0, 0], taper=0.85)
            p.box(hit + [sg * 0.03, 0.075, -0.016], [0, 0.008, 0.016], [0, 0.03, -0.01], [sg * 0.012, 0, 0], taper=0.8)
            s = Mesh('kargo_tali_' + S, mat_belt, ('bone', 'thigh' + S))
            for yy in (0.80, 0.71):
                pp, nn = B.around(0.1 * sg, yy, 0.0, lift=0.004)
                s.grid(np.stack([pp + [0, -0.013, 0], pp + nn * 0.003, pp + [0, 0.013, 0]], axis=0), wrap=True)
            # tali gantung dari sabuk ke pelat
            s.box([hit[0] + sg * 0.012, 0.9, 0.0], [0, 0, 0.016], [0, 0.085, 0], [sg * 0.003, 0, 0])
            out.append(s)
        out.append(p)
    return out


# ============================================================ GARUDA EMAS ============================================================
def garuda_helm(B, mat_gold, mat_red, mat_feather):
    """helm-mahkota berparuh (burung pemangsa bergaya, desain sendiri): kubah emas, pelindung pipi, paruh-visor di atas
    hidung, jambul bilah bulu menyapu ke belakang, pita dahi merah hati. BUKAN lambang negara: tanpa perisai/pita/simbol."""
    out = []
    t = 0.02
    brim = lambda th: B.yc + np.where(np.cos(th) >= 0.3, 0.040, np.where(np.cos(th) >= -0.2, 0.040 - 0.13 * (0.3 - np.cos(th)) / 0.5, -0.090 + 0.015 * np.clip(-np.cos(th) - 0.2, 0, 1)))
    h = Mesh('helm', mat_gold, ('bone', 'head'), tris=700, prio=1.5)
    rows, th = B.skull_shell(t, brim, nt=36, nr=9)
    h.grid(rows, wrap=True)
    rim = np.stack([rows[-1], rows[-1] * [0.9, 1, 1]]); rim[1, :, 2] = B.zc + (rows[-1, :, 2] - B.zc) * 0.9
    h.grid(rim, wrap=True)
    # paruh: punggung melengkung dari dahi ke depan-bawah, penampang V terbalik, menyempit ke ujung kait
    zf = B.zc + B.b + t; y0 = B.yc + 0.058
    ns, ncol = 8, 5
    pts = np.zeros((ns, ncol, 3))
    for i in range(ns):
        s = i / (ns - 1)
        ctr = np.array([0, y0 - 0.006 * s - 0.062 * s ** 2.4, zf - 0.012 + 0.082 * s - 0.016 * s ** 3])
        w = 0.05 * (1 - s) ** 0.75 + 0.002
        drop = 0.032 * (1 - 0.55 * s)
        for j, u in enumerate(np.linspace(-1, 1, ncol)):
            pts[i, j] = ctr + [u * w, -abs(u) ** 1.3 * drop, -abs(u) * 0.014 * (1 - s)]
    bk = Mesh('paruh', mat_gold, ('bone', 'head'), prio=1.8)
    bk.grid(pts)
    out += [h, bk]
    # pita dahi merah hati (email) + permata dahi
    r = Mesh('helm_pita', mat_red, ('bone', 'head'), prio=1.5)
    nt = 36
    th2 = (np.arange(nt) + 0.5) / nt * 2 * math.pi - math.pi
    yb = brim(th2)
    ring = np.zeros((2, nt, 3))
    for i, dy in enumerate((0.004, 0.024)):
        ph = np.arccos(np.clip((yb + dy - B.yc) / (B.crv + t + 0.003), -1, 1))
        ring[i] = B.skull(th2, ph, t + 0.003)
    r.grid(ring, wrap=True, mask=(np.cos(np.concatenate([th2, th2[:1]])) > -0.25)[None, :].repeat(1, axis=0))
    out.append(r)
    # jambul: 5 bilah di garis tengah menyapu ke belakang + 2×2 bilah samping dari pelipis
    f = Mesh('jambul', mat_feather, ('bone', 'head'), tris=260, prio=1.3)
    for k, (ph, L, w) in enumerate(((0.55, 0.13, 0.05), (0.2, 0.17, 0.056), (-0.15, 0.2, 0.06), (-0.5, 0.2, 0.058), (-0.85, 0.17, 0.052))):
        root = B.skull(0.0 if ph >= 0 else math.pi, abs(ph), t - 0.004)
        d = nrm([0, 0.62 + 0.25 * ph, -0.78 + 0.1 * ph])
        f.leaf(root, d, [1.0, 0, 0], L, w, nu=3, nv=5, bend=0.0, cup=0.0)
    for sx in (1, -1):
        for k, (dy, L, yaw) in enumerate(((0.035, 0.17, 0.25), (0.005, 0.14, 0.05))):
            root = B.skull(sx * 1.25, 1.2 - dy * 6, t - 0.003)
            d = nrm([sx * 0.22, 0.28 + yaw, -0.93])
            f.leaf(root, d, [sx * 1.0, 0.25, 0.2], L, 0.05, nu=3, nv=5, bend=0.06, cup=0.08)
    out.append(f)
    return out


def garuda_wings(B, mat_feather, mat_gold):
    """sayap terlipat di punggung (statis untuk M2): tiap sisi 3 ruas (pangkal → siku → pergelangan → ujung) dengan bulu
    penutup, sekunder, dan primer menjuntai ke bawah. Lebar total ≤ 0,4 m, puncak ≤ kepala + 0,25 m."""
    out = []
    ys = np.array([1.40]); zc, R, th = B.hull(ys, nb=48, xmax=0.24)
    zb = zc[0] - R[0][int(np.argmax(np.abs(th)))]
    fe = Mesh('sayap_bulu', mat_feather, ('bone', 'chest'), tris=1500, prio=1.0)
    bo = Mesh('sayap_rangka', mat_gold, ('bone', 'chest'), tris=300, prio=1.2)
    for sg in (1, -1):
        root = np.array([sg * 0.07, 1.40, zb - 0.015])
        elbow = np.array([sg * 0.115, 1.585, zb - 0.085])
        wrist = np.array([sg * 0.165, 1.44, zb - 0.12])
        tipj = np.array([sg * 0.17, 1.22, zb - 0.135])
        bo.tube([root, 0.5 * (root + elbow) + [0, 0.01, -0.01], elbow], [0.02, 0.017, 0.015], n=6)
        bo.tube([elbow, 0.5 * (elbow + wrist) + [sg * 0.008, 0.012, -0.004], wrist], [0.015, 0.013, 0.012], n=6)
        bo.tube([wrist, tipj], [0.012, 0.007], n=6)
        bo.ellipsoid(elbow, 0.021, 0.021, 0.021, nu=8, nv=5)
        bo.ellipsoid(root + [0, 0.0, 0.004], 0.034, 0.04, 0.02, nu=8, nv=5)  # dudukan di punggung
        back = np.array([-sg * 0.10, 0.0, -1.0])
        # primer: dari pergelangan → ujung jari, menjuntai ke bawah; makin ke luar makin panjang
        npr = 8
        for k in range(npr):
            f = k / (npr - 1)
            r0 = wrist * (1 - f) + tipj * f + [0, 0, -0.004 - 0.003 * k]
            d = nrm([sg * (0.03 - 0.07 * f), -1.0, -0.10 + 0.05 * f])
            fe.leaf(r0, d, back, 0.40 + 0.14 * f, 0.062, nu=3, nv=6, bend=-0.02, cup=0.06)
        # sekunder: sepanjang siku → pergelangan
        nse = 7
        for k in range(nse):
            f = (k + 0.5) / nse
            r0 = elbow * (1 - f) + wrist * f + [0, -0.004, -0.010 - 0.002 * k]
            d = nrm([-sg * (0.22 - 0.2 * f), -1.0, -0.06])
            fe.leaf(r0, d, back, 0.36 - 0.05 * abs(f - 0.6), 0.066, nu=3, nv=6, bend=-0.02, cup=0.06)
        # penutup (covert): baris pendek menutupi pangkal bulu, dua lapis
        for lay, (L, off) in enumerate(((0.17, -0.022), (0.11, -0.03))):
            nco = 8
            for k in range(nco):
                f = (k + 0.5) / nco
                seg = (root * (1 - f * 2) + elbow * f * 2) if f < 0.5 else (elbow * (2 - f * 2) + wrist * (f * 2 - 1))
                r0 = seg + [0, 0.012 - 0.012 * lay, off]
                d = nrm([-sg * 0.16 * (1 - f), -1.0, -0.12])
                fe.leaf(r0, d, back, L, 0.058, nu=3, nv=4, bend=-0.03, cup=0.08, tip=0.5)
        # bulu bahu (skapular) menutup pangkal ke arah tulang belakang
        for k in range(4):
            r0 = root + [-sg * 0.012 * k, 0.03 - 0.03 * k, -0.02]
            fe.leaf(r0, nrm([-sg * 0.25, -1.0, -0.05]), back, 0.2 - 0.02 * k, 0.06, nu=3, nv=4, bend=-0.02, cup=0.08)
    out += [fe, bo]
    return out


def dodot(B, mat, mat_tail, mat_gold, y_top=1.04, y_low=0.56):
    """kain dodot di pinggang: belakang & samping selutut, terbuka meninggi di depan, ekor wiron menjuntai di tengah depan,
    sabuk emas dengan kepala sabuk bundar"""
    out = []
    nb = 56; nrow = 14
    zc0, R0, th = B.hull(np.linspace(y_top, y_low, nrow), nb=nb)
    hem = y_low + (0.88 - y_low) * np.exp(-(th / 0.62) ** 2)
    pts = np.zeros((nrow, nb, 3)); q = np.zeros((nrow, nb, 2))
    for j in range(nb):
        ys = np.linspace(y_top, hem[j], nrow)
        for k, y in enumerate(ys):
            kk = (y_top - y) / (y_top - y_low) * (nrow - 1)
            k0 = int(min(math.floor(kk), nrow - 2)); fr = kk - k0
            r_h = R0[:k0 + 2, j].max() if k0 > 0 else R0[0, j]   # jatuh dari bagian terlebar di atasnya
            r = max(R0[k0, j] * (1 - fr) + R0[k0 + 1, j] * fr, r_h * (0.985 ** (kk - np.argmax(R0[:k0 + 2, j])))) + 0.024 + 0.035 * (k / (nrow - 1)) ** 2
            z = zc0[k0] * (1 - fr) + zc0[k0 + 1] * fr
            pts[k, j] = (r * math.sin(th[j]), y, z + r * math.cos(th[j]))
            q[k, j] = ((th[j] + math.pi) / (2 * math.pi), k / (nrow - 1))
    m = Mesh('dodot', mat, ('fn', leg_weights), tris=1500)
    m.grid(pts, wrap=True, q=q)
    out.append(m)
    # ekor wiron depan
    w = Mesh('dodot_ekor', mat_tail, ('fn', lambda P: tail_weights(P)), tris=400)
    ysw = np.linspace(y_top - 0.02, 0.50, 12); nc = 9
    zc1, R1, _ = B.hull(ysw, nb=nb)
    Rd = drape_radii(R1, 0.03, taper=0.99)
    pw = np.zeros((len(ysw), nc, 3)); qw = np.zeros((len(ysw), nc, 2))
    for k, y in enumerate(ysw):
        f = k / (len(ysw) - 1)
        half = 0.04 + 0.03 * f
        for j in range(nc):
            u = j / (nc - 1) * 2 - 1
            tj = u * half / 0.17
            r = np.interp(tj, th, Rd[k]) + 0.012 + (0.012 if j % 2 else 0.0) + 0.01 * f
            pw[k, j] = (r * math.sin(tj), y - 0.02 * f * (1 - abs(u)), zc1[k] + r * math.cos(tj))
            qw[k, j] = (j / (nc - 1) * 4, f)
    w.grid(pw, q=qw)
    out.append(w)
    # sabuk
    yb = np.linspace(y_top - 0.035, y_top + 0.03, 3)
    zc2, R2, _ = B.hull(yb, nb=nb)
    g = Mesh('sabuk', mat_gold, ('skin',), tris=350, prio=1.3)
    g.grid(B.ring_pts(yb, zc2, R2, th, np.array([0.03, 0.034, 0.03])), wrap=True)
    j0 = int(np.argmin(np.abs(th)))
    zf = zc2[1] + R2[1][j0] + 0.036
    out.append(g)
    b = Mesh('sabuk_kepala', mat_gold, ('near', (0.0, y_top, zf - 0.03)), prio=2.0)
    b.ellipsoid([0, y_top - 0.002, zf], 0.04, 0.04, 0.012, nu=12, nv=5)
    out.append(b)
    return out
