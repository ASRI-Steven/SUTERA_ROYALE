#!/usr/bin/env python3
"""Bangun data benda lingkungan Sutera Royale: menara SUTET + kabel, BTS, lampu jalan, tiang listrik + kabel, halte,
gerbang cluster (palang pintu, pilar, pos satpam, papan nama), lampu lalu lintas, papan reklame & videotron, SPBU,
perlengkapan lapangan olahraga, proyek konstruksi (crane, kontainer, pagar seng), bangku, tempat sampah, hidran,
gazebo, menara air.

  python3 -I tools/build_props.py data/osm/alsut.geojsonseq web/data/alsut-map.json web/data/alsut-props.json

Sumber: titik & garis OSM (jalur SUTET, menara telekomunikasi, halte, gerbang & palang, lampu lalu lintas, SPBU,
lapangan, konstruksi, papan reklame) + penempatan prosedural dari data peta game (alsut-map.json). Tiap titik dicek:
di dalam kawasan, tidak di aspal/gedung/air, tidak terlalu dekat pohon atau benda lain. Menara SUTET & BTS OSM di luar
kawasan (≤ RING_M) ikut sebagai pemandangan saja (bendera 1 = di dalam kawasan → punya tabrakan).

Keluaran (koordinat sama dengan alsut-map.json, desimeter): t[jenis] = [x, y, a, v, z, s, …] (stride 6):
a = arah depan benda (sumbu +Z model) dalam 0,1° dari timur, berlawanan jarum jam; v = varian (jenis iklan, nama,
fase, bendera); z = tinggi alas (dm); s = skala sumbu X model (persen). Garis: kabel (rantai tiang/menara), pagar.
Hanya pustaka standar Python.
"""
import argparse
import json
import math
import os
import sys
from datetime import date

sys.dont_write_bytecode = True  # jangan tinggalkan __pycache__ di tools/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_map as bm  # noqa: E402  (proyeksi & fungsi bantu yang sama)

M = 0.1
RING_M = 1000.0          # benda besar OSM di luar kawasan sampai sejauh ini (sama dengan alsut-context.json)
MAIN = ('motorway', 'motorway_link', 'trunk', 'primary', 'secondary', 'tertiary')
MINOR = ('unclassified', 'residential', 'living_street')
SIDEWALK = {'trunk': 2.4, 'primary': 2.6, 'secondary': 2.4, 'tertiary': 2.0, 'unclassified': 1.4, 'residential': 1.4,
            'living_street': 1.0}  # = world.js
LAMP_STEP = 34.0         # jarak lampu jalan (m)
POLE_STEP = 38.0         # jarak tiang listrik (m)
BOARD_STEP = 280.0       # jarak minimum papan reklame di satu jalan (m)
STRIDE = 6


def h01(*v):
    return bm.hash01(*v)


def frange(a, b, s):
    x = a
    while x <= b + 1e-9:
        yield x
        x += s


def ang(dx, dy):
    return math.atan2(dy, dx)


# ---------------------------------------------------------------- indeks ruang
class Grid:
    def __init__(self, cell):
        self.c = cell
        self.cells = {}

    def keys(self, x0, y0, x1, y1):
        c = self.c
        for gx in range(int(math.floor(x0 / c)), int(math.floor(x1 / c)) + 1):
            for gy in range(int(math.floor(y0 / c)), int(math.floor(y1 / c)) + 1):
                yield (gx, gy)

    def add(self, item, x0, y0, x1, y1):
        for k in self.keys(x0, y0, x1, y1):
            self.cells.setdefault(k, []).append(item)

    def query(self, x, y, r):
        seen = set()
        for k in self.keys(x - r, y - r, x + r, y + r):
            for it in self.cells.get(k, ()):
                if id(it) not in seen:
                    seen.add(id(it))
                    yield it


def seg_dist(x, y, ax, ay, bx, by):
    ex, ey = bx - ax, by - ay
    L = ex * ex + ey * ey
    t = max(0.0, min(1.0, ((x - ax) * ex + (y - ay) * ey) / L)) if L > 1e-12 else 0.0
    px, py = ax + ex * t, ay + ey * t
    return math.hypot(x - px, y - py), t, px, py


class Roads:
    def __init__(self, D):
        self.g = Grid(25.0)
        self.segs = []
        self.lines = []
        for i, r in enumerate(D['roads']['r']):
            cls = D['classes'][D['roads']['c'][i]]
            w = D['roads']['w'][i] * M
            pts = [(r[j] * M, r[j + 1] * M) for j in range(0, len(r) - 1, 2)]
            self.lines.append({'i': i, 'cls': cls, 'w': w, 'pts': pts, 'name': D['roads']['n'].get(str(i))})
            for j in range(len(pts) - 1):
                (ax, ay), (bx, by) = pts[j], pts[j + 1]
                s = {'a': (ax, ay), 'b': (bx, by), 'w': w, 'ri': i, 'cls': cls}
                self.segs.append(s)
                pad = w / 2 + 1
                self.g.add(s, min(ax, bx) - pad, min(ay, by) - pad, max(ax, bx) + pad, max(ay, by) + pad)

    def clearance(self, x, y, r=30.0, skip=None):
        """Jarak ke tepi aspal terdekat (negatif = di atas aspal); dibatasi r."""
        best = r
        for s in self.g.query(x, y, r):
            if skip is not None and s['ri'] == skip:
                continue
            d = seg_dist(x, y, *s['a'], *s['b'])[0] - s['w'] / 2
            if d < best:
                best = d
        return best

    def nearest(self, x, y, r=30.0, pred=None):
        best, bs = None, r
        for s in self.g.query(x, y, r):
            if pred and not pred(s):
                continue
            d, t, px, py = seg_dist(x, y, *s['a'], *s['b'])
            if d < bs:
                bs, best = d, (s, t, px, py, d)
        return best


class Polys:
    def __init__(self, cell=50.0):
        self.g = Grid(cell)

    def add(self, ring, tag=None):
        bb = bm.bbox(ring)
        it = {'r': ring, 'bb': bb, 'tag': tag}
        self.g.add(it, *bb)
        return it

    def clearance(self, x, y, r=20.0, pred=None):
        """Jarak ke tepi poligon terdekat, negatif bila di dalam; dibatasi r."""
        best = r
        for it in self.g.query(x, y, r):
            if pred and not pred(it):
                continue
            b = it['bb']
            if x < b[0] - best or x > b[2] + best or y < b[1] - best or y > b[3] + best:
                continue
            ring = it['r']
            if bm.pip(x, y, ring):
                return -1.0
            n = len(ring)
            for k in range(n):
                d = seg_dist(x, y, *ring[k - 1], *ring[k])[0]
                if d < best:
                    best = d
        return best

    def inside(self, x, y, pred=None):
        for it in self.g.query(x, y, 0.1):
            if pred and not pred(it):
                continue
            b = it['bb']
            if b[0] <= x <= b[2] and b[1] <= y <= b[3] and bm.pip(x, y, it['r']):
                return it
        return None


class Points:
    def __init__(self, cell=6.0):
        self.g = Grid(cell)

    def add(self, x, y, r, tag=None):
        it = (x, y, r, tag)
        self.g.add(it, x - r, y - r, x + r, y + r)

    def clearance(self, x, y, r=10.0):
        best = r
        for (px, py, pr, _) in self.g.query(x, y, r):
            d = math.hypot(x - px, y - py) - pr
            if d < best:
                best = d
        return best


def min_rect(ring):
    """Persegi panjang terkecil yang memuat poligon (sisi searah salah satu sisi hull): pusat, panjang, lebar, sudut."""
    pts = sorted(set(ring))
    if len(pts) < 3:
        return None

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    hull = lo[:-1] + hi[:-1]
    best = None
    for i in range(len(hull)):
        ax, ay = hull[i]
        bx, by = hull[(i + 1) % len(hull)]
        L = math.hypot(bx - ax, by - ay)
        if L < 1e-6:
            continue
        ux, uy = (bx - ax) / L, (by - ay) / L
        us = [p[0] * ux + p[1] * uy for p in hull]
        vs = [-p[0] * uy + p[1] * ux for p in hull]
        a = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or a < best[0]:
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (a, cu * ux - cv * uy, cu * uy + cv * ux, max(us) - min(us), max(vs) - min(vs), math.atan2(uy, ux))
    _, cx, cy, du, dv, th = best
    if dv > du:  # panjang = sumbu u
        du, dv, th = dv, du, th + math.pi / 2
    return cx, cy, du, dv, th


# ---------------------------------------------------------------- pembangun
class Builder:
    def __init__(self, feats, D):
        self.D = D
        self.feats = feats
        bfeat = [f for f in feats if f['properties'].get('name') == 'Alam Sutera' and bm.polygons(f['geometry'])]
        bpoly = max(bm.polygons(bfeat[0]['geometry']), key=lambda pl: len(pl[0]))
        lons = [c[0] for c in bpoly[0]]
        lats = [c[1] for c in bpoly[0]]
        self.P = bm.Proj((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2)  # = build_map.py
        self.bnd = [(D['boundary'][i] * M, D['boundary'][i + 1] * M) for i in range(0, len(D['boundary']), 2)]
        self.mask = bm.InsideMask(self.bnd, [], 1.0)
        self.roads = Roads(D)
        self.blds = Polys(50.0)
        self.bh = []
        for i, r in enumerate(D['buildings']['r']):
            ring = [(r[j] * M, r[j + 1] * M) for j in range(0, len(r) - 1, 2)]
            self.blds.add(ring, (i, D['buildings']['k'][i], D['buildings']['h'][i] * M))
            self.bh.append(ring)
        self.water = Polys(50.0)
        for r in D['water']:
            self.water.add([(r[j] * M, r[j + 1] * M) for j in range(0, len(r) - 1, 2)])
        self.ways = Grid(30.0)
        for k, r in enumerate(D['waterways']['r']):
            w = D['waterways']['w'][k] * M
            for j in range(0, len(r) - 3, 2):
                a, b = (r[j] * M, r[j + 1] * M), (r[j + 2] * M, r[j + 3] * M)
                s = {'a': a, 'b': b, 'w': w}
                self.ways.add(s, min(a[0], b[0]) - w, min(a[1], b[1]) - w, max(a[0], b[0]) + w, max(a[1], b[1]) + w)
        self.clusters = []
        for c in D['clusters']:
            ring = [(c['r'][j] * M, c['r'][j + 1] * M) for j in range(0, len(c['r']) - 1, 2)]
            self.clusters.append({'name': c['name'], 'kind': c['kind'], 'r': ring, 'bb': bm.bbox(ring), 'ha': c['ha']})
        # pohon: posisi asli + posisi pindahan ke trotoar (map/trees.js memindah pohon di aspal ke lebar/2 + 1,5 m)
        self.trees = Points(6.0)
        T, st = D['trees'], D['meta'].get('treeStride', 4)
        for i in range(0, len(T) - 1, st):
            x, y = T[i] * M, T[i + 1] * M
            self.trees.add(x, y, 0.35)
            nr = self.roads.nearest(x, y, 12.0)
            if nr and nr[4] - nr[0]['w'] / 2 < 1.2:
                s, t, px, py, d = nr
                nx, ny = (x - px, y - py) if d > 0.05 else (-(s['b'][1] - s['a'][1]), s['b'][0] - s['a'][0])
                L = math.hypot(nx, ny) or 1
                for sd in ((1, -1) if d <= 0.05 else (1,)):
                    self.trees.add(px + nx / L * (s['w'] / 2 + 1.5) * sd, py + ny / L * (s['w'] / 2 + 1.5) * sd, 0.35)
        self.props = Points(6.0)
        self.out = {}
        self.cables = []   # rantai kabel: {'k': jenis, 'p': [[x, y, z], …]} (titik gantung, m)
        self.fences = []   # pagar: {'p': [x, y, …] (m), 'h': tinggi, 'closed': bool, 'gap': [indeks sisi]}
        self.hoards = []   # pagar seng proyek: {'p': [...], 'closed': bool}
        self.names = []
        self.stat = {}

    # ---------- uji tempat
    def inside(self, x, y):
        return self.mask.inside(x, y)

    def water_clear(self, x, y, r=12.0):
        best = self.water.clearance(x, y, r)
        for s in self.ways.query(x, y, r):
            d = seg_dist(x, y, *s['a'], *s['b'])[0] - s['w'] / 2
            if d < best:
                best = d
        return best

    def bld_clear(self, x, y, r=12.0, tall=0.0):
        return self.blds.clearance(x, y, r, (lambda it: it['tag'][2] >= tall) if tall else None)

    def ok(self, x, y, r, road=0.3, bld=0.4, water=0.8, tree=0.6, prop=0.5, inside=True, skip_road=None):
        if inside and not self.inside(x, y):
            return False
        if self.roads.clearance(x, y, r + road + 1, skip_road) < r + road:
            return False
        if self.bld_clear(x, y, r + bld + 1) < r + bld:
            return False
        if self.water_clear(x, y, r + water + 1) < r + water:
            return False
        if tree is not None and self.trees.clearance(x, y, r + tree + 1) < r + tree:
            return False
        if prop is not None and self.props.clearance(x, y, r + prop + 1) < r + prop:
            return False
        return True

    def ok_box(self, x, y, a, w, d, **kw):
        """Kotak w (sumbu X model) × d (sumbu Z model) berpusat (x, y), depan = arah a: cek titik sudut, tepi & pusat."""
        fx, fy = math.cos(a), math.sin(a)
        lx, ly = -fy, fx
        r = min(w, d) / 2
        for su in (-1, 0, 1):
            for sv in (-1, 0, 1):
                px = x + lx * su * (w / 2 - r * 0.5) + fx * sv * (d / 2 - r * 0.5)
                py = y + ly * su * (w / 2 - r * 0.5) + fy * sv * (d / 2 - r * 0.5)
                if not self.ok(px, py, r * 0.75, **kw):
                    return False
        return True

    def cluster_at(self, x, y, kinds=('residential',)):
        best = None
        for c in self.clusters:
            b = c['bb']
            if c['kind'] in kinds and b[0] <= x <= b[2] and b[1] <= y <= b[3] and bm.pip(x, y, c['r']):
                if best is None or c['ha'] < best['ha']:
                    best = c
        return best

    def put(self, kind, x, y, a, v=0, z=0.0, s=1.0, r=0.5):
        lst = self.out.setdefault(kind, [])
        lst += [int(round(x * 10)), int(round(y * 10)), int(round(math.degrees(a) * 10)) % 3600, int(v), int(round(z * 10)), int(round(s * 100))]
        if r:
            self.props.add(x, y, r, kind)
        return len(lst) // STRIDE - 1

    def xy(self, coords):
        return self.P.xy(coords[0], coords[1])

    def osm_points(self, pred):
        for f in self.feats:
            p = f['properties']
            g = f['geometry']
            if g['type'] == 'Point' and pred(p):
                yield p, self.xy(g['coordinates'])

    def osm_polys(self, pred):
        for f in self.feats:
            p = f['properties']
            g = f['geometry']
            if g['type'] in ('Polygon', 'MultiPolygon') and pred(p):
                for pl in bm.polygons(g):
                    ring = self.P.ring(pl[0])
                    if len(ring) >= 3:
                        yield p, ring

    def dist_to_area(self, x, y):
        best = 1e18
        n = len(self.bnd)
        for k in range(n):
            best = min(best, seg_dist(x, y, *self.bnd[k - 1], *self.bnd[k])[0])
        return 0.0 if self.inside(x, y) else best

    # ---------- jalan: titik pada garis dengan jarak tetap
    @staticmethod
    def stations(pts, step, phase=0.0):
        carry = phase
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            L = math.hypot(bx - ax, by - ay)
            if L < 1e-6:
                continue
            ux, uy = (bx - ax) / L, (by - ay) / L
            d = carry
            while d < L:
                yield ax + ux * d, ay + uy * d, ux, uy
                d += step
            carry = d - L

    def parallel(self, x, y, ux, uy, ri, w, side, cls=MAIN, maxd=34.0):
        """Jalan utama sejajar di sisi 'side' (median): (celah, jarak as ke as) atau None."""
        nx, ny = -uy * side, ux * side
        best = None
        for s in self.roads.g.query(x + nx * maxd / 2, y + ny * maxd / 2, maxd / 2 + 2):
            if s['ri'] == ri or s['cls'] not in cls:
                continue
            (ax, ay), (bx, by) = s['a'], s['b']
            ex, ey = bx - ax, by - ay
            L = math.hypot(ex, ey)
            if L < 1e-6 or abs((ex * ux + ey * uy) / L) < 0.94:
                continue
            # perpotongan garis tegak lurus dari (x, y) dengan ruas
            den = nx * ey - ny * ex
            if abs(den) < 1e-9:
                continue
            t = ((ax - x) * ey - (ay - y) * ex) / den
            u = ((ax - x) * ny - (ay - y) * nx) / den
            if t <= 0 or t > maxd or u < -0.02 or u > 1.02:
                continue
            gap = t - w / 2 - s['w'] / 2
            if best is None or t < best[1]:
                best = (gap, t)
        return best

    # ---------------------------------------------------------------- SUTET (OSM)
    def sutet(self):
        towers = {}
        for p, (x, y) in self.osm_points(lambda p: p.get('power') == 'tower'):
            towers[(round(x, 1), round(y, 1))] = (x, y)
        n_in = 0
        for f in self.feats:
            p = f['properties']
            if p.get('power') != 'line' or f['geometry']['type'] != 'LineString':
                continue
            pts = [self.xy(c) for c in f['geometry']['coordinates']]
            kv = int(str(p.get('voltage', '150000')).split(';')[0]) // 1000
            chain = []
            last = None
            for k, (x, y) in enumerate(pts):
                if last and math.hypot(x - last[0], y - last[1]) < 25:
                    continue  # dua titik menara berdempetan di OSM (menara sudut ganda): ambil satu
                last = (x, y)
                if self.dist_to_area(x, y) > RING_M:
                    if len(chain) > 1:
                        self.cables.append({'k': 'sutet', 'i': chain})
                    chain = []
                    continue
                # arah menara = garis bagi ruas masuk & keluar (lengan melintang tegak lurus jalur)
                a0 = ang(x - pts[k - 1][0], y - pts[k - 1][1]) if k > 0 else None
                a1 = ang(pts[k + 1][0] - x, pts[k + 1][1] - y) if k + 1 < len(pts) else None
                if a0 is None:
                    a = a1
                elif a1 is None:
                    a = a0
                else:
                    a = math.atan2(math.sin(a0) + math.sin(a1), math.cos(a0) + math.cos(a1))
                ins = self.inside(x, y)
                if ins:  # kaki menara (±6 m) jangan di aspal/gedung: geser sedikit sepanjang jalur bila perlu
                    fx, fy = math.cos(a), math.sin(a)
                    def leg_clear(cx, cy):
                        return min(min(self.roads.clearance(cx + sy * 5.95 * fx + sx * 5.95 * fy, cy + sy * 5.95 * fy - sx * 5.95 * fx, 12),
                                       self.bld_clear(cx + sy * 5.95 * fx + sx * 5.95 * fy, cy + sy * 5.95 * fy - sx * 5.95 * fx, 12))
                                   for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)))
                    best = (leg_clear(x, y), x, y)
                    if best[0] < 1.0:
                        for d in (1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6, 8, -8, 10, -10, 12, -12):
                            for e in (0, 1.5, -1.5):
                                cx, cy = x + fx * d - fy * e, y + fy * d + fx * e
                                c = leg_clear(cx, cy)
                                if c > best[0] + 0.05:
                                    best = (c, cx, cy)
                            if best[0] >= 1.0:
                                break
                        x, y = best[1], best[2]
                n_in += ins
                big = 1 if kv >= 400 else 0
                i = self.put('sutet', x, y, a, (1 if ins else 0) | (2 if big else 0), r=6.0)
                chain.append(i)
            if len(chain) > 1:
                self.cables.append({'k': 'sutet', 'i': chain})
        self.stat['sutet'] = {'n': len(self.out.get('sutet', [])) // STRIDE, 'inside': n_in}

    # ---------------------------------------------------------------- BTS
    def bts(self):
        placed = []
        for p, (x, y) in self.osm_points(lambda p: p.get('man_made') in ('communications_tower', 'mast') or (p.get('man_made') == 'tower' and p.get('tower:type') == 'communication')):
            if self.dist_to_area(x, y) > RING_M:
                continue
            ins = self.inside(x, y)
            self.put('bts', x, y, h01('bts', round(x), round(y)) * 6.283, 1 if ins else 0, r=7.0)
            placed.append((x, y))
            if ins:
                self.compound(x, y, h01('btsa', round(x)) * 6.283)
        n_osm = len(placed)
        # BTS tambahan (masuk akal: lahan kosong dekat jalan, tersebar ≥ 650 m) supaya terlihat sebagai penanda kota
        cands = []
        x0, y0, x1, y1 = bm.bbox(self.bnd)
        for x in frange(x0 + 20, x1 - 20, 24.0):
            for y in frange(y0 + 20, y1 - 20, 24.0):
                jx = x + (h01('bx', round(x), round(y)) - 0.5) * 12
                jy = y + (h01('by', round(x), round(y)) - 0.5) * 12
                if not self.inside(jx, jy):
                    continue
                rc = self.roads.clearance(jx, jy, 40)
                if rc < 9 or rc > 32:
                    continue
                cands.append((jx, jy))
        target = 8
        while len(placed) < n_osm + target and cands:
            best, bd = None, -1
            for (x, y) in cands:
                d = min((math.hypot(x - px, y - py) for px, py in placed), default=1e9)
                d += h01('bs', round(x), round(y)) * 60
                if d > bd:
                    bd, best = d, (x, y)
            if bd < 650:
                break
            x, y = best
            cands.remove(best)
            a = h01('ba', round(x), round(y)) * 6.283
            if not self.ok_box(x, y, a, 14, 14, road=2.0, bld=2.0, water=2.0, tree=1.2, prop=2.0):
                continue
            self.put('bts', x, y, a, 1, r=7.0)
            self.compound(x, y, a)
            placed.append((x, y))
        self.stat['bts'] = {'osm': n_osm, 'extra': len(placed) - n_osm}
        # tiang antena di atap gedung tinggi (≥ 45 m): paling banyak 9, tersebar
        tall = []
        B = self.D['buildings']
        for i, ring in enumerate(self.bh):
            h = B['h'][i] * M
            if B['k'][i] != 2 or h < 45 or not (B['f'][i] & 1):
                continue
            cx, cy = bm.centroid(ring)
            tall.append((h, i, cx, cy))
        tall.sort(reverse=True)
        roof = []
        for h, i, cx, cy in tall:
            if len(roof) >= 9:
                break
            if any(math.hypot(cx - x, cy - y) < 140 for x, y in roof):
                continue
            ring = self.bh[i]
            # di pelat atap antara mahkota (78 %) dan parapet: 88 % dari pusat ke titik sudut terjauh
            far = max(ring, key=lambda p: math.hypot(p[0] - cx, p[1] - cy))
            px, py = cx + (far[0] - cx) * 0.86, cy + (far[1] - cy) * 0.86
            if not bm.pip(px, py, ring):
                continue
            self.put('btsr', px, py, ang(far[0] - cx, far[1] - cy), 0, z=h - 0.9, r=0)
            roof.append((cx, cy))
        self.stat['btsr'] = len(roof)

    def compound(self, x, y, a):
        """Pagar kawat BTS 12 × 12 m dengan pintu di satu sisi."""
        fx, fy = math.cos(a), math.sin(a)
        lx, ly = -fy, fx
        h = 6.0
        pts = []
        for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pts += [x + lx * su * h + fx * sv * h, y + ly * su * h + fy * sv * h]
        self.fences.append({'p': pts, 'h': 2.4, 'closed': True, 'gate': [2, 0.5, 2.4], 'wire': True})

    # ---------------------------------------------------------------- lampu jalan
    def lamps(self):
        n1 = n2 = 0
        self.med = Points(10.0)
        for L in self.roads.lines:
            if L['cls'] not in MAIN or len(L['pts']) < 2:
                continue
            w = L['w']
            k = 0
            for (x, y, ux, uy) in self.stations(L['pts'], LAMP_STEP, (h01('lp', L['i']) * LAMP_STEP) % LAMP_STEP):
                k += 1
                for side in (1, -1):
                    nx, ny = -uy * side, ux * side
                    par = self.parallel(x, y, ux, uy, L['i'], w, side)
                    if par and par[0] < 1.4:
                        continue  # jalan menempel (lajur terpisah): tidak ada trotoar di sisi ini
                    if par and par[0] <= 30:
                        gap = par[0]
                        mx, my = x + nx * (w / 2 + gap / 2), y + ny * (w / 2 + gap / 2)
                        if self.med.clearance(mx, my, 20) < 15:
                            continue
                        if self.ok(mx, my, 0.25, road=0.45, tree=1.0, prop=1.0):
                            self.put('lamp2', mx, my, ang(nx, ny), 0, r=0.4)
                            self.med.add(mx, my, 0.4)
                            n2 += 1
                        continue
                    # trotoar: dua sisi berselang-seling (jalan tanpa median), sisi luar saja kalau ada median di seberang
                    other = self.parallel(x, y, ux, uy, L['i'], w, -side)
                    if not (other and 1.4 <= other[0] <= 30) and (k + (side > 0)) % 2:
                        continue
                    off = w / 2 + 0.7
                    px, py = x + nx * off, y + ny * off
                    if self.ok(px, py, 0.2, road=0.4, tree=0.9, prop=1.2):
                        self.put('lamp', px, py, ang(-nx, -ny), 0, r=0.4)
                        n1 += 1
        self.stat['lamp'] = n1
        self.stat['lamp2'] = n2

    # ---------------------------------------------------------------- tiang listrik + kabel (jalan kampung, di luar cluster)
    def poles(self):
        n = 0
        chains = []
        for L in self.roads.lines:
            if L['cls'] not in MINOR or len(L['pts']) < 2:
                continue
            w = L['w']
            side = 1 if h01('ps', L['i']) < 0.5 else -1
            chain = []
            for (x, y, ux, uy) in self.stations(L['pts'], POLE_STEP, 4.0):
                nx, ny = -uy * side, ux * side
                px, py = x + nx * (w / 2 + 0.55), y + ny * (w / 2 + 0.55)
                if not self.inside(px, py) or self.cluster_at(px, py, ('residential', 'commercial', 'retail', 'construction')):
                    if len(chain) > 1:
                        chains.append(chain)
                    chain = []
                    continue
                if self.ok(px, py, 0.2, road=0.3, tree=0.7, prop=0.8):
                    v = 1 if h01('trafo', round(px), round(py)) < 0.12 else 0
                    i = self.put('pole', px, py, ang(-nx, -ny), v, r=0.35)
                    chain.append((i, px, py))
                    n += 1
                else:
                    if len(chain) > 1:
                        chains.append(chain)
                    chain = []
            if len(chain) > 1:
                chains.append(chain)
        # rantai: putus kalau dua tiang terlalu jauh (tiang di antaranya gagal ditempatkan)
        spans = 0
        for ch in chains:
            run = [ch[0]]
            for p in ch[1:]:
                if math.hypot(p[1] - run[-1][1], p[2] - run[-1][2]) > POLE_STEP * 1.6:
                    if len(run) > 1:
                        self.cables.append({'k': 'pole', 'i': [q[0] for q in run]})
                        spans += len(run) - 1
                    run = []
                run.append(p)
            if len(run) > 1:
                self.cables.append({'k': 'pole', 'i': [q[0] for q in run]})
                spans += len(run) - 1
        # sambungan rumah: dari tiang ke dinding rumah terdekat (≤ 14 m), paling banyak 2 per tiang
        drops = []
        P = self.out.get('pole', [])
        for i in range(0, len(P), STRIDE):
            x, y = P[i] * M, P[i + 1] * M
            got = 0
            cand = []
            for it in self.blds.g.query(x, y, 14):
                bi, kind, h = it['tag']
                if kind not in (0, 1) or h > 14:
                    continue
                ring = it['r']
                best = None
                for k in range(len(ring)):
                    d, t, qx, qy = seg_dist(x, y, *ring[k - 1], *ring[k])
                    if best is None or d < best[0]:
                        best = (d, qx, qy)
                if best and 3 < best[0] < 14:
                    cand.append((best[0], best[1], best[2], min(h - 0.6, 3.6)))
            cand.sort()
            for d, qx, qy, hz in cand:
                if got >= 2:
                    break
                if h01('drop', round(qx, 1), round(qy, 1)) < 0.45:
                    continue
                drops.append([i // STRIDE, round(qx, 2), round(qy, 2), round(hz, 2)])
                got += 1
        self.drops = drops
        self.stat['pole'] = {'n': n, 'spans': spans, 'drops': len(drops)}

    # ---------------------------------------------------------------- halte (OSM)
    def halte(self):
        n = 0
        for p, (x, y) in self.osm_points(lambda p: p.get('highway') == 'bus_stop'):
            if not self.inside(x, y):
                continue
            nr = self.roads.nearest(x, y, 30, lambda s: s['cls'] in MAIN or s['cls'] in ('unclassified', 'residential'))
            if not nr:
                continue
            s, t, px, py, d = nr
            (ax, ay), (bx, by) = s['a'], s['b']
            L = math.hypot(bx - ax, by - ay) or 1
            ux, uy = (bx - ax) / L, (by - ay) / L
            side = 1 if (-uy * (x - px) + ux * (y - py)) >= 0 else -1
            if d < 0.5:
                side = 1 if h01('hs', round(x), round(y)) < 0.5 else -1
            nx, ny = -uy * side, ux * side
            done = False
            for sd in (0, 3, -3, 6, -6, 9, -9, 13, -13):
                cx, cy = px + ux * sd + nx * (s['w'] / 2 + 1.55), py + uy * sd + ny * (s['w'] / 2 + 1.55)
                a = ang(-nx, -ny)  # depan halte menghadap jalan
                if self.ok_box(cx, cy, a, 4.6, 1.9, road=0.35, bld=0.5, tree=0.5, prop=0.8):
                    self.put('halte', cx, cy, a, 0, r=2.4)
                    n += 1
                    done = True
                    break
            if not done:
                self.stat.setdefault('halte_skip', 0)
                self.stat['halte_skip'] += 1
        self.stat['halte'] = n

    # ---------------------------------------------------------------- gerbang cluster
    def gates(self):
        nb = ng = nps = nn = 0
        entrances = []
        for p, (x, y) in self.osm_points(lambda p: p.get('barrier') in ('lift_gate', 'gate', 'swing_gate', 'sliding_gate')):
            if not self.inside(x, y):
                continue
            nr = self.roads.nearest(x, y, 6)
            if not nr:
                continue
            s, t, px, py, d = nr
            (ax, ay), (bx, by) = s['a'], s['b']
            L = math.hypot(bx - ax, by - ay) or 1
            ux, uy = (bx - ax) / L, (by - ay) / L
            w = s['w']
            kind = p.get('barrier')
            if kind == 'lift_gate':
                done = False
                for side in ((1, -1) if h01('bg', round(x), round(y)) < 0.5 else (-1, 1)):
                    nx, ny = -uy * side, ux * side
                    hx, hy = px + nx * (w / 2 + 0.45), py + ny * (w / 2 + 0.45)
                    if self.ok(hx, hy, 0.25, road=0.05, bld=0.2, tree=0.35, prop=0.3):
                        # lengan terangkat: depan (+Z) = melintang jalan ke arah seberang
                        self.put('boom', hx, hy, ang(-nx, -ny), 0, s=1.0, r=0.4)
                        nb += 1
                        done = True
                        break
            else:
                ok = 0
                for side in (1, -1):
                    nx, ny = -uy * side, ux * side
                    hx, hy = px + nx * (w / 2 + 0.45), py + ny * (w / 2 + 0.45)
                    if self.ok(hx, hy, 0.3, road=0.1, bld=0.15, tree=0.4, prop=0.3):
                        self.put('pillar', hx, hy, ang(ux, uy), 0, r=0.45)
                        ok += 1
                ng += ok
            cl = None
            for c in self.clusters:
                if c['kind'] != 'residential':
                    continue
                b = c['bb']
                if not (b[0] - 40 <= x <= b[2] + 40 and b[1] - 40 <= y <= b[3] + 40):
                    continue
                dd = min(seg_dist(x, y, *c['r'][k - 1], *c['r'][k])[0] for k in range(len(c['r'])))
                if dd < 40 and (cl is None or dd < cl[0]):
                    cl = (dd, c)
            if cl:
                entrances.append((x, y, px, py, ux, uy, w, cl[1], s['ri']))
        # pos satpam + papan nama cluster: satu per pintu masuk (gerbang berdekatan ≤ 45 m digabung)
        used = []
        named = set()
        for (x, y, px, py, ux, uy, w, c, ri) in entrances:
            if any(math.hypot(x - qx, y - qy) < 45 for qx, qy in used):
                continue
            used.append((x, y))
            # arah keluar cluster sepanjang jalan
            out = 1 if not bm.pip(px + ux * 15, py + uy * 15, c['r']) else -1
            placed = False
            for side in (1, -1):
                for sd in (-4, -7, -1, -10, 2):
                    nx, ny = -uy * side, ux * side
                    gx = px + ux * sd * out + nx * (w / 2 + 2.0)
                    gy = py + uy * sd * out + ny * (w / 2 + 2.0)
                    a = ang(-nx, -ny)  # jendela depan menghadap jalan
                    if self.ok_box(gx, gy, a, 2.6, 2.4, road=0.5, bld=0.4, tree=0.4, prop=0.4):
                        self.put('guard', gx, gy, a, 0, r=1.9)
                        nps += 1
                        placed = True
                        break
                if placed:
                    break
            if c['name'] in named or len(self.names) >= 40:  # = sel nama di atlas (web/map/envprops.js NM.n)
                continue
            done = False
            for side in (-1, 1):
                for sd, back in ((6, 3.3), (9, 3.3), (4, 4.0), (12, 3.5), (6, 5.0), (15, 4.0)):
                    nx, ny = -uy * side, ux * side
                    sx = px + ux * sd * out + nx * (w / 2 + back)
                    sy = py + uy * sd * out + ny * (w / 2 + back)
                    a = ang(ux * out, uy * out)  # papan menghadap pengunjung yang datang dari luar
                    if self.ok_box(sx, sy, a, 4.2, 0.9, road=0.4, bld=0.4, tree=0.3, prop=0.4):
                        if c['name'] not in self.names:
                            self.names.append(c['name'])
                        self.put('namesign', sx, sy, a, self.names.index(c['name']), r=2.1)
                        named.add(c['name'])
                        nn += 1
                        done = True
                        break
                if done:
                    break
        self.stat['gates'] = {'boom': nb, 'pillar': ng, 'guard': nps, 'namesign': nn, 'entrances': len(used)}

    # ---------------------------------------------------------------- lampu lalu lintas & videotron (OSM)
    def signals(self):
        nodes = []
        for p, (x, y) in self.osm_points(lambda p: p.get('highway') == 'traffic_signals' or p.get('crossing') == 'traffic_signals'):
            if self.inside(x, y) and not any(math.hypot(x - a, y - b) < 25 for a, b in nodes):
                nodes.append((x, y))
        ns = nv = 0
        for jn, (x, y) in enumerate(nodes):
            arms = []
            for s in self.roads.g.query(x, y, 18):
                if s['cls'] not in MAIN and s['cls'] not in ('unclassified', 'residential'):
                    continue
                for (ex, ey), (ox, oy) in ((s['a'], s['b']), (s['b'], s['a'])):
                    if math.hypot(ex - x, ey - y) < 14:
                        L = math.hypot(ox - ex, oy - ey)
                        if L < 1:
                            continue
                        u = ((ox - ex) / L, (oy - ey) / L)  # menjauhi simpang
                        if not any(abs(u[0] * q[0][0] + u[1] * q[0][1]) > 0.94 and u[0] * q[0][0] + u[1] * q[0][1] > 0 for q in arms):
                            arms.append((u, s['w'], (ex, ey)))
            if not arms:
                continue
            wmax = max(a[1] for a in arms)
            for (u, w, (ex, ey)) in arms:
                back = wmax / 2 + 4.0
                # kendaraan mendekat simpang dengan arah −u; lajur kiri → tiang di trotoar kiri kendaraan
                tx, ty = -u[0], -u[1]
                lx, ly = -ty, tx
                px, py = ex + u[0] * back + lx * (w / 2 + 0.8), ey + u[1] * back + ly * (w / 2 + 0.8)
                if self.ok(px, py, 0.25, road=0.3, tree=0.6, prop=0.6):
                    # depan (+Z) = lengan menyeberangi jalan (ke kanan kendaraan)
                    self.put('signal', px, py, ang(-lx, -ly), (jn * 2 + (1 if abs(u[0]) > abs(u[1]) else 0)) % 255, s=min(1.0, max(0.55, (w / 2 + 0.8) / 6.5)), r=0.4)
                    ns += 1
            # videotron di sudut simpang besar (paling banyak 4)
            if nv < 4 and len(arms) >= 3 and wmax >= 9:
                for k in range(len(arms)):
                    u1, u2 = arms[k][0], arms[(k + 1) % len(arms)][0]
                    bx, by = u1[0] + u2[0], u1[1] + u2[1]
                    bl = math.hypot(bx, by)
                    if bl < 0.3:
                        continue
                    bx, by = bx / bl, by / bl
                    dd = wmax / 2 + 9
                    vx, vy = x + bx * dd, y + by * dd
                    if self.ok_box(vx, vy, ang(-bx, -by), 7.0, 1.2, road=1.5, bld=1.5, tree=1.0, prop=1.0):
                        self.put('video', vx, vy, ang(-bx, -by), nv, r=3.5)
                        nv += 1
                        break
        for p, (x, y) in self.osm_points(lambda p: p.get('advertising') and p.get('luminous') == 'yes'):
            nr = self.roads.nearest(x, y, 40)
            if not nr or not self.inside(x, y):
                continue
            s, t, px, py, d = nr
            a = ang(px - x, py - y) if d > 0.5 else 0
            if self.ok_box(x, y, a, 7.0, 1.2, road=1.0, bld=1.0, tree=0.5, prop=1.0):
                self.put('video', x, y, a, nv, r=3.5)
                nv += 1
        self.stat['signal'] = {'nodes': len(nodes), 'poles': ns, 'video': nv}

    # ---------------------------------------------------------------- papan reklame
    def boards(self):
        n = 0
        ad = 0
        placed = []
        for p, (x, y) in self.osm_points(lambda p: p.get('advertising') == 'billboard' and p.get('luminous') != 'yes'):
            nr = self.roads.nearest(x, y, 60)
            if not nr or not self.inside(x, y):
                continue
            s, t, px, py, d = nr
            (ax, ay), (bx, by) = s['a'], s['b']
            a = ang(bx - ax, by - ay)
            if self.ok(x, y, 0.6, road=2.5, bld=2.0, tree=1.5, prop=1.0):
                self.put('board', x, y, a, ad % 8, r=1.2)
                placed.append((x, y))
                ad += 1
                n += 1
        for L in self.roads.lines:
            if L['cls'] not in ('secondary', 'tertiary', 'primary', 'trunk', 'motorway') or len(L['pts']) < 2:
                continue
            w = L['w']
            sw = SIDEWALK.get(L['cls'], 2.0)
            for (x, y, ux, uy) in self.stations(L['pts'], 40.0, (h01('bd', L['i']) * 40) % 40):
                if any(math.hypot(x - qx, y - qy) < BOARD_STEP for qx, qy in placed):
                    continue
                side = 1 if h01('bside', round(x), round(y)) < 0.5 else -1
                for sd in (side, -side):
                    nx, ny = -uy * sd, ux * sd
                    par = self.parallel(x, y, ux, uy, L['i'], w, sd, maxd=26)
                    if par and par[0] < 26:
                        continue  # sisi median / jalan sejajar
                    off = w / 2 + sw + 4.2
                    cx, cy = x + nx * off, y + ny * off
                    if not self.ok(cx, cy, 0.6, road=3.0, bld=3.0, water=2.0, tree=2.0, prop=2.0):
                        continue
                    # muka papan 10 m (melintang jalan) setinggi 12–17 m: tidak menabrak gedung tinggi / pohon besar
                    clear = True
                    for k in frange(-5.0, 5.0, 2.5):
                        qx, qy = cx + nx * k, cy + ny * k
                        if self.bld_clear(qx, qy, 3, tall=9.0) < 1.5 or self.trees.clearance(qx, qy, 3) < 1.0:
                            clear = False
                            break
                    if not clear:
                        continue
                    self.put('board', cx, cy, ang(ux, uy), ad % 8, r=1.2)
                    placed.append((cx, cy))
                    ad += 1
                    n += 1
                    break
        self.stat['board'] = n

    # ---------------------------------------------------------------- SPBU (OSM, kanopi = gedung atap)
    def fuel(self):
        n = 0
        for p, ring in self.osm_polys(lambda p: p.get('amenity') == 'fuel'):
            cx, cy = bm.centroid(ring)
            if not self.inside(cx, cy):
                continue
            R = min_rect(ring)
            if not R:
                continue
            x, y, Lu, Lv, th = R
            ux, uy = math.cos(th), math.sin(th)
            k = max(1, min(4, int(Lu / 7.5)))
            rows = 2 if Lv > 13 else 1
            for i in range(k):
                for j in range(rows):
                    t = (i + 0.5) / k - 0.5
                    v = 0 if rows == 1 else (j - 0.5) * Lv * 0.42
                    px, py = x + ux * Lu * t - uy * v, y + uy * Lu * t + ux * v
                    self.put('pump', px, py, th + math.pi / 2, 0, r=1.2)
                    n += 1
            # tiang harga & merek di tepi jalan terdekat
            nr = self.roads.nearest(x, y, 60, lambda s: s['cls'] in MAIN)
            if nr:
                s, t, px, py, d = nr
                dx, dy = x - px, y - py
                dl = math.hypot(dx, dy) or 1
                for back in (s['w'] / 2 + 3.5, s['w'] / 2 + 5.5, s['w'] / 2 + 8):
                    for sd in (0, 6, -6, 12, -12):
                        (ax, ay), (bx, by) = s['a'], s['b']
                        L = math.hypot(bx - ax, by - ay) or 1
                        qx = px + dx / dl * back + (bx - ax) / L * sd
                        qy = py + dy / dl * back + (by - ay) / L * sd
                        if self.ok(qx, qy, 0.6, road=1.0, bld=0.6, tree=0.6, prop=0.6):
                            self.put('fuelsign', qx, qy, ang(-dx, -dy), 0, r=1.0)
                            n = n
                            break
                    else:
                        continue
                    break
        self.stat['pump'] = n

    # ---------------------------------------------------------------- lapangan olahraga (OSM)
    def pitches(self):
        st = {'goal': 0, 'hoop': 0, 'net': 0, 'fence': 0}
        seen = []
        for p, ring in self.osm_polys(lambda p: p.get('leisure') == 'pitch'):
            cx, cy = bm.centroid(ring)
            if not self.inside(cx, cy) or any(math.hypot(cx - a, cy - b) < 3 for a, b in seen):
                continue
            seen.append((cx, cy))
            R = min_rect(ring)
            if not R:
                continue
            x, y, Lu, Lv, th = R
            if Lu < 8 or Lv < 5:
                continue
            ux, uy = math.cos(th), math.sin(th)
            sport = p.get('sport', '')
            if not sport:
                sport = 'soccer' if Lu > 40 else 'futsal' if Lu > 24 else 'basketball'
            fence = False
            if sport in ('soccer', 'futsal'):
                big = Lu > 60
                for e in (-1, 1):
                    gx, gy = x + ux * e * (Lu / 2 - 0.6), y + uy * e * (Lu / 2 - 0.6)
                    self.put('goal', gx, gy, th + (math.pi if e > 0 else 0), 1 if big else 0, r=0)
                    st['goal'] += 1
                fence = not big and sport == 'futsal'
            elif sport == 'basketball':
                for e in (-1, 1):
                    gx, gy = x + ux * e * (Lu / 2 - 0.2), y + uy * e * (Lu / 2 - 0.2)
                    self.put('hoop', gx, gy, th + (math.pi if e > 0 else 0), 0, r=0)
                    st['hoop'] += 1
                fence = Lu < 40
            elif sport in ('tennis', 'badminton', 'volleyball', 'padel'):
                width = {'tennis': 12.8, 'badminton': 6.7, 'volleyball': 10.0, 'padel': 10.0}[sport]
                width = min(width, Lv + 0.6)
                self.put('net', x, y, th, 0, s=width / 12.8, r=0)
                st['net'] += 1
                fence = sport in ('tennis', 'padel')
            else:
                continue
            if fence:
                pts = []
                hu, hv = Lu / 2 + 1.0, Lv / 2 + 1.0
                for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    pts += [x + ux * su * hu - uy * sv * hv, y + uy * su * hu + ux * sv * hv]
                ok = all(self.bld_clear(pts[k], pts[k + 1], 2) > 0.3 and self.roads.clearance(pts[k], pts[k + 1], 3) > 0.2 for k in range(0, 8, 2))
                if ok:
                    self.fences.append({'p': pts, 'h': 3.2, 'closed': True, 'gate': [1, 0.5, 1.4], 'wire': False})
                    st['fence'] += 1
        self.stat['pitch'] = st

    # ---------------------------------------------------------------- proyek konstruksi: crane, kontainer kantor, pagar seng
    def construction(self):
        n = {'crane': 0, 'site': 0}
        for p, ring in self.osm_polys(lambda p: p.get('landuse') == 'construction'):
            cx, cy = bm.centroid(ring)
            if not self.inside(cx, cy):
                continue
            ha = abs(bm.area(ring)) / 1e4
            n['site'] += 1
            # pagar seng di sepanjang keliling (kecuali sisi yang tertimpa gedung/jalan)
            pts = []
            for (qx, qy) in ring:
                pts += [qx, qy]
            self.hoards.append({'p': pts, 'closed': True})
            want = 2 if ha >= 3 else 1 if ha >= 0.4 else 0
            R = min_rect(ring)
            got = []
            if R and want:
                x, y, Lu, Lv, th = R
                ux, uy = math.cos(th), math.sin(th)
                for t in ((-0.22, 0.12), (0.25, -0.15), (0.0, 0.0), (-0.3, -0.2), (0.3, 0.2)):
                    if len(got) >= want:
                        break
                    px, py = x + ux * Lu * t[0] - uy * Lv * t[1], y + uy * Lu * t[0] + ux * Lv * t[1]
                    if not bm.pip(px, py, ring) or any(math.hypot(px - a, py - b) < 30 for a, b in got):
                        continue
                    if self.ok(px, py, 3.0, road=4.0, bld=2.0, water=3.0, tree=None, prop=1.0):
                        self.put('crane', px, py, h01('cr', round(px)) * 6.283, len(got) + n['crane'], r=3.2)
                        got.append((px, py))
                        n['crane'] += 1
            # kontainer kantor proyek dekat pintu (titik keliling terdekat ke jalan)
            best = None
            for (qx, qy) in ring:
                rc = self.roads.clearance(qx, qy, 40)
                if best is None or rc < best[0]:
                    best = (rc, qx, qy)
            if best:
                _, qx, qy = best
                dx, dy = cx - qx, cy - qy
                dl = math.hypot(dx, dy) or 1
                for k in (6, 9, 12, 16):
                    px, py = qx + dx / dl * k, qy + dy / dl * k
                    a = ang(-dy, dx)
                    if bm.pip(px, py, ring) and self.ok_box(px, py, a, 6.2, 2.6, road=1.0, bld=0.8, tree=0.5, prop=0.8):
                        self.put('cabin', px, py, a, 0, r=3.2)
                        break
        self.stat['construction'] = n

    # ---------------------------------------------------------------- perabot jalan: hidran, bangku + tempat sampah, taman
    def furniture(self):
        nh = nb = nt = ngz = 0
        com = Polys(50.0)
        for i, ring in enumerate(self.bh):
            if self.D['buildings']['k'][i] in (1, 2, 4) and self.D['buildings']['f'][i] & 1:
                com.add(ring)
        for L in self.roads.lines:
            if len(L['pts']) < 2:
                continue
            w = L['w']
            cls = L['cls']
            if cls in ('secondary', 'tertiary', 'primary', 'trunk'):
                for (x, y, ux, uy) in self.stations(L['pts'], 95.0, (h01('hy', L['i']) * 95) % 95):
                    side = 1 if h01('hys', round(x), round(y)) < 0.5 else -1
                    nx, ny = -uy * side, ux * side
                    if self.parallel(x, y, ux, uy, L['i'], w, side, maxd=20):
                        nx, ny = -nx, -ny
                    px, py = x + nx * (w / 2 + 0.45), y + ny * (w / 2 + 0.45)
                    if self.ok(px, py, 0.18, road=0.25, tree=0.5, prop=0.8):
                        self.put('hydrant', px, py, ang(-nx, -ny), 0, r=0.3)
                        nh += 1
            sw = SIDEWALK.get(cls, 0)
            if sw < 1.4:
                continue
            step = 46.0 if cls in MAIN else 64.0
            for (x, y, ux, uy) in self.stations(L['pts'], step, (h01('bn', L['i']) * step) % step):
                for side in (1, -1):
                    nx, ny = -uy * side, ux * side
                    if com.clearance(x + nx * (w / 2 + 6), y + ny * (w / 2 + 6), 30) >= 26:
                        continue  # bukan depan toko/kantor
                    if self.parallel(x, y, ux, uy, L['i'], w, side, maxd=20):
                        continue
                    off = w / 2 + max(1.0, sw - 0.55)
                    bx, by = x + nx * off, y + ny * off
                    a = ang(-nx, -ny)
                    if self.ok_box(bx, by, a, 1.9, 0.7, road=0.3, bld=0.3, tree=0.4, prop=0.6):
                        self.put('bench', bx, by, a, 0, r=1.0)
                        nb += 1
                        tx, ty = bx + ux * 1.55, by + uy * 1.55
                        if self.ok(tx, ty, 0.3, road=0.3, bld=0.2, tree=0.4, prop=0.2):
                            self.put('bin', tx, ty, a, 0, r=0.4)
                            nt += 1
        # taman: bangku menghadap ke dalam di tepi, gazebo di tengah taman besar
        for p, ring in self.osm_polys(lambda p: p.get('leisure') in ('park', 'garden')):
            cx, cy = bm.centroid(ring)
            if not self.inside(cx, cy):
                continue
            area = abs(bm.area(ring))
            if area > 1800 and self.ok_box(cx, cy, 0.0, 4.6, 4.6, road=2.0, bld=2.0, tree=0.6, prop=1.0):
                self.put('gazebo', cx, cy, h01('gz', round(cx)) * 6.283, 0, r=3.0)
                ngz += 1
            per = 0.0
            ccw = bm.area(ring) > 0
            for k in range(len(ring)):
                (ax, ay), (bx, by) = ring[k - 1], ring[k]
                L = math.hypot(bx - ax, by - ay)
                if L < 4:
                    continue
                ux, uy = (bx - ax) / L, (by - ay) / L
                nx, ny = (-uy, ux) if ccw else (uy, -ux)  # ke dalam
                d = 12.0 - per % 26.0
                while d < L - 2:
                    px, py = ax + ux * d + nx * 2.5, ay + uy * d + ny * 2.5
                    if self.ok_box(px, py, ang(nx, ny), 1.9, 0.7, road=1.0, bld=0.5, tree=0.4, prop=0.8):
                        self.put('bench', px, py, ang(nx, ny), 0, r=1.0)
                        nb += 1
                    d += 26.0
                per += L
        spots = [xy for p, xy in self.osm_points(lambda p: p.get('leisure') == 'playground' or p.get('playground'))]
        spots += [bm.centroid(ring) for p, ring in self.osm_polys(lambda p: p.get('leisure') == 'playground')]
        done = []
        for (x0, y0) in spots:
            if not self.inside(x0, y0) or any(math.hypot(x0 - a, y0 - b) < 40 for a, b in done):
                continue
            offs = [(0, 0)] + [(r * math.cos(k * 0.785), r * math.sin(k * 0.785)) for r in (4, 8, 12, 16, 20) for k in range(8)]
            for dx, dy in offs:
                x, y = x0 + dx, y0 + dy
                a = h01('pg', round(x0)) * 6.283
                if self.ok_box(x, y, a, 7, 5, road=0.5, bld=1.0, tree=0.0, prop=1.0):
                    self.put('playset', x, y, a, 0, r=4.5)
                    done.append((x0, y0))
                    break
        self.stat['furniture'] = {'hydrant': nh, 'bench': nb, 'bin': nt, 'gazebo': ngz, 'playset': len(self.out.get('playset', [])) // STRIDE}

    # ---------------------------------------------------------------- menara air
    def water_towers(self):
        placed = []
        B = self.D['buildings']
        cands = []
        for i, ring in enumerate(self.bh):
            if B['k'][i] not in (3, 4) or not (B['f'][i] & 1) or abs(bm.area(ring)) < 300:
                continue
            cx, cy = bm.centroid(ring)
            far = max(ring, key=lambda p: math.hypot(p[0] - cx, p[1] - cy))
            dx, dy = far[0] - cx, far[1] - cy
            dl = math.hypot(dx, dy) or 1
            cands.append((h01('wt', i), cx + dx / dl * (dl + 7), cy + dy / dl * (dl + 7)))
        cands.sort()
        for _, x, y in cands:
            if len(placed) >= 4:
                break
            if any(math.hypot(x - a, y - b) < 600 for a, b in placed):
                continue
            if self.ok_box(x, y, 0.0, 5.5, 5.5, road=2.0, bld=1.0, water=1.0, tree=0.8, prop=1.0):
                self.put('wtower', x, y, h01('wta', round(x)) * 6.283, 0, r=3.2)
                placed.append((x, y))
        self.stat['wtower'] = len(placed)

    def run(self):
        self.sutet()
        self.bts()
        self.signals()
        self.halte()
        self.gates()
        self.fuel()
        self.construction()
        self.pitches()
        self.boards()
        self.lamps()
        self.poles()
        self.furniture()
        self.water_towers()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src', help='GeoJSON sequence dari osmium export (data/osm/alsut.geojsonseq)')
    ap.add_argument('map', help='web/data/alsut-map.json')
    ap.add_argument('out', help='berkas JSON keluaran (web/data/alsut-props.json)')
    a = ap.parse_args()
    feats = bm.read_features(a.src)
    with open(a.map, encoding='utf-8') as f:
        D = json.load(f)
    b = Builder(feats, D)
    b.run()
    counts = {k: len(v) // STRIDE for k, v in sorted(b.out.items())}
    dmr = lambda v: int(round(v * 10))  # noqa: E731
    out = {
        'meta': {
            'generated': date.today().isoformat(), 'unit': 'dm', 'stride': STRIDE,
            'source': D['meta'].get('source', '') + '; penempatan prosedural tools/build_props.py',
            'counts': counts, 'stats': b.stat,
        },
        'names': b.names,
        't': b.out,
        # kabel: k = 'sutet' | 'pole', i = indeks benda berurutan (titik gantung dari manifest model)
        'cables': b.cables,
        # sambungan rumah: [indeks tiang, x, y (m, titik di dinding), tinggi (m)]
        'drops': [[d[0], dmr(d[1]), dmr(d[2]), dmr(d[3])] for d in getattr(b, 'drops', [])],
        'fences': [{'p': [dmr(v) for v in f['p']], 'h': dmr(f['h']), 'gate': f.get('gate'), 'wire': 1 if f.get('wire') else 0} for f in b.fences],
        'hoards': [{'p': [dmr(v) for v in h['p']]} for h in b.hoards],
    }
    with open(a.out, 'w', encoding='utf-8') as fo:
        json.dump(out, fo, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(counts))
    print(json.dumps(b.stat))


if __name__ == '__main__':
    main()
