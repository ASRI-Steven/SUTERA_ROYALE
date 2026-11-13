#!/usr/bin/env python3
"""Bangun data peta 3D Alam Sutera dari ekspor osmium (GeoJSON sequence).

Langkah (lihat README.md):
  osmium extract -b 106.636,-6.272,106.680,-6.212 --overwrite \
      -o data/osm/alsut.osm.pbf ~/petacuan/jabodetabek.osm.pbf
  osmium export data/osm/alsut.osm.pbf --overwrite -f geojsonseq \
      -o data/osm/alsut.geojsonseq --geometry-types=point,linestring,polygon
  python3 -I tools/build_map.py data/osm/alsut.geojsonseq web/data/alsut-map.json

Koordinat keluaran: meter lokal (x ke timur, y ke utara) dari titik tengah batas
kawasan, disimpan sebagai bilangan bulat desimeter supaya JSON kecil.
Hanya pakai pustaka standar Python.

Enclave (lubang di batas kawasan, mis. kampung ±10 ha) ikut diisi bangunan/jalan/pohon OSM-nya supaya
peta menyambung. Isinya ditambahkan di belakang data utama (indeks lama tetap); bangunan enclave flag 4.
Lingkungan sekitar untuk game (di luar batas): tools/build_context.py → web/data/alsut-context.json.
"""
import argparse
import json
import math
import sys
from datetime import date

BOUNDARY_NAME = 'Alam Sutera'
MARGIN_M = 40           # hanya isi kawasan; margin kecil untuk jalan yang memotong batas
TREE_CAP = 9000
ENCLAVE_TREE_CAP = 1500  # pohon di enclave (lubang batas kawasan), di luar TREE_CAP supaya data lama tetap

ROAD_CLASSES = ['motorway', 'motorway_link', 'trunk', 'primary', 'secondary', 'tertiary',
                'unclassified', 'residential', 'living_street', 'service', 'pedestrian']
ROAD_WIDTH = {'motorway': 24, 'motorway_link': 8, 'trunk': 16, 'primary': 14, 'secondary': 12,
              'tertiary': 10, 'unclassified': 6, 'residential': 6, 'living_street': 5,
              'service': 4, 'pedestrian': 4}
LINK_CLASS = {'trunk_link': 'motorway_link', 'primary_link': 'tertiary', 'secondary_link': 'tertiary',
              'tertiary_link': 'unclassified'}
WATERWAY_WIDTH = {'river': 22, 'canal': 9, 'stream': 4, 'drain': 2.5, 'ditch': 2}
GREEN_TYPES = ['park', 'pitch', 'forest', 'grass', 'cemetery', 'golf']
POI_CATS = ['belanja', 'kuliner', 'kesehatan', 'pendidikan', 'ibadah', 'hotel', 'rekreasi',
            'layanan', 'kantor', 'transport']

# Jenis bangunan: 0 rumah, 1 komersial, 2 menara/apartemen, 3 publik, 4 industri, 5 atap/lain
KIND = {
    'house': 0, 'residential': 0, 'detached': 0, 'terrace': 0, 'semidetached_house': 0, 'bungalow': 0,
    'yes': 0, 'commercial': 1, 'retail': 1, 'office': 1, 'hotel': 1, 'supermarket': 1, 'kiosk': 1,
    'apartments': 2, 'school': 3, 'university': 3, 'college': 3, 'kindergarten': 3, 'hospital': 3,
    'mosque': 3, 'church': 3, 'temple': 3, 'chapel': 3, 'religious': 3, 'government': 3, 'public': 3,
    'civic': 3, 'industrial': 4, 'warehouse': 4, 'factory': 4, 'roof': 5, 'garage': 5, 'garages': 5,
    'carport': 5, 'construction': 5, 'shed': 5, 'hut': 5,
}
DEFAULT_H = {
    'house': 7, 'residential': 7, 'detached': 7, 'terrace': 7, 'semidetached_house': 7, 'bungalow': 5,
    'apartments': 24, 'commercial': 10, 'retail': 8, 'office': 14, 'hotel': 24, 'supermarket': 9,
    'kiosk': 3.5, 'school': 9, 'university': 14, 'college': 12, 'kindergarten': 5, 'hospital': 16,
    'mosque': 11, 'church': 12, 'temple': 9, 'chapel': 8, 'religious': 9, 'government': 10,
    'public': 9, 'civic': 9, 'industrial': 9, 'warehouse': 9, 'factory': 10, 'roof': 4, 'garage': 3,
    'garages': 3, 'carport': 3, 'construction': 3, 'shed': 3, 'hut': 3, 'yes': 6,
}


def read_features(path):
    feats = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.lstrip('\x1e').strip()
            if line:
                feats.append(json.loads(line))
    return feats


def polygons(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def hash01(*vals):
    h = 2166136261
    for v in vals:
        for ch in repr(v):
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h / 0xFFFFFFFF


class Proj:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.ky = 110540.0

    def xy(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def ring(self, coords):
        pts = [self.xy(c[0], c[1]) for c in coords]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        return pts


def area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def centroid(pts):
    a = area(pts)
    if abs(a) < 1e-6:
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    cx = cy = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return (cx / (6 * a), cy / (6 * a))


def simplify_ring(pts, tol):
    """Buang titik yang hampir segaris (jarak ke garis tetangga < tol meter)."""
    pts = list(pts)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        i = 0
        while i < len(pts) and len(pts) > 3:
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            dx, dy = c[0] - a[0], c[1] - a[1]
            L = math.hypot(dx, dy)
            d = abs(dx * (a[1] - b[1]) - (a[0] - b[0]) * dy) / L if L > 1e-9 else math.hypot(b[0] - a[0], b[1] - a[1])
            if d < tol:
                del pts[i]
                changed = True
            else:
                i += 1
    return pts


def simplify_line(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = pts[s]
        bx, by = pts[e]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(s + 1, e):
            px, py = pts[i]
            d = abs(dx * (ay - py) - (ax - px) * dy) / L if L > 1e-9 else math.hypot(px - ax, py - ay)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((s, bi))
            stack.append((bi, e))
    return [p for p, k in zip(pts, keep) if k]


def pip(x, y, ring):
    ins = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            ins = not ins
        j = i
    return ins


def in_poly(x, y, outer, holes=()):
    return pip(x, y, outer) and not any(pip(x, y, h) for h in holes)


def bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def flat_dm(pts):
    out = []
    for x, y in pts:
        out.append(int(round(x * 10)))
        out.append(int(round(y * 10)))
    return out


def parse_num(v):
    if v is None:
        return None
    try:
        return float(str(v).replace(',', '.').split(';')[0].strip().split(' ')[0].rstrip('m'))
    except ValueError:
        return None


def is_rect(pts):
    if len(pts) != 4:
        return False
    for i in range(4):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % 4]
        v1 = (a[0] - b[0], a[1] - b[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        n1, n2 = math.hypot(*v1), math.hypot(*v2)
        if n1 < 1e-6 or n2 < 1e-6:
            return False
        cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)
        if abs(cosang) > 0.26:  # sudut 90 ± 15 derajat
            return False
    return True


class InsideMask:
    """Raster 2 m dari batas kawasan (dikurangi lubangnya): cek 'di dalam kawasan' jadi O(1)."""
    def __init__(self, outer, holes, cell=2.0):
        xs = [p[0] for p in outer]
        ys = [p[1] for p in outer]
        self.cell = cell
        self.x0, self.y0 = min(xs) - cell, min(ys) - cell
        self.nx = int((max(xs) - self.x0) / cell) + 2
        self.ny = int((max(ys) - self.y0) / cell) + 2
        self.rows = [bytearray(self.nx) for _ in range(self.ny)]
        self._fill(outer, 1)
        for h in holes:
            self._fill(h, 0)

    def _fill(self, ring, val):
        n = len(ring)
        for j in range(self.ny):
            y = self.y0 + (j + 0.5) * self.cell
            xs = []
            for i in range(n):
                x1, y1 = ring[i]
                x2, y2 = ring[(i + 1) % n]
                if (y1 > y) != (y2 > y):
                    xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            row = self.rows[j]
            for k in range(0, len(xs) - 1, 2):
                a = max(0, int(math.ceil((xs[k] - self.x0) / self.cell - 0.5)))
                b = min(self.nx - 1, int(math.floor((xs[k + 1] - self.x0) / self.cell - 0.5)))
                if b >= a:
                    row[a:b + 1] = (b'\x01' if val else b'\x00') * (b - a + 1)

    def inside(self, x, y):
        i = int((x - self.x0) / self.cell)
        j = int((y - self.y0) / self.cell)
        return 0 <= j < self.ny and 0 <= i < self.nx and self.rows[j][i] == 1


class Grid:
    """Indeks ruang sederhana: kotak 25 m berisi indeks poligon."""
    def __init__(self, cell=25.0):
        self.cell = cell
        self.cells = {}

    def add(self, idx, bb):
        c = self.cell
        for gx in range(int(math.floor(bb[0] / c)), int(math.floor(bb[2] / c)) + 1):
            for gy in range(int(math.floor(bb[1] / c)), int(math.floor(bb[3] / c)) + 1):
                self.cells.setdefault((gx, gy), []).append(idx)

    def near(self, x, y):
        return self.cells.get((int(math.floor(x / self.cell)), int(math.floor(y / self.cell))), [])


def poi_category(p, levels):
    shop, amen, tour, leis, office = p.get('shop'), p.get('amenity'), p.get('tourism'), p.get('leisure'), p.get('office')
    name = p.get('name', '').lower()
    if amen in ('restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream'):
        return 'kuliner', False
    if shop in ('mall', 'department_store') or (('mall' in name or 'ikea' in name or 'living world' in name) and (shop or p.get('building'))):
        return 'belanja', True
    if shop in ('supermarket', 'hardware', 'electronics', 'furniture', 'car', 'motorcycle'):
        return 'belanja', False
    if amen == 'hospital':
        return 'kesehatan', True
    if amen in ('clinic', 'doctors', 'dentist', 'pharmacy'):
        return 'kesehatan', False
    if amen in ('university', 'college'):
        return 'pendidikan', True
    if amen in ('school', 'kindergarten'):
        return 'pendidikan', False
    if amen == 'place_of_worship':
        return 'ibadah', False
    if tour in ('hotel', 'guest_house', 'apartment'):
        return 'hotel', (levels or 0) >= 8
    if leis in ('park', 'sports_centre', 'stadium', 'fitness_centre', 'golf_course', 'playground', 'water_park'):
        return 'rekreasi', leis in ('golf_course', 'stadium')
    if amen in ('bank', 'police', 'fire_station', 'townhall', 'post_office', 'fuel', 'community_centre') or office == 'government':
        return 'layanan', amen in ('police', 'fire_station')
    if p.get('barrier') == 'toll_booth' or p.get('highway') == 'motorway_junction':
        return 'transport', 'alam sutera' in name
    if p.get('building') in ('office', 'commercial') and (levels or 0) >= 15:
        return 'kantor', True
    if office or p.get('building') == 'office':
        return 'kantor', (levels or 0) >= 15
    if shop:
        return 'belanja', False
    return None, False


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src', help='GeoJSON sequence dari osmium export')
    ap.add_argument('out', help='berkas JSON keluaran untuk web/')
    ap.add_argument('--boundary', default=BOUNDARY_NAME, help='nama polygon batas kawasan di OSM')
    ap.add_argument('--source-label', default='Ekstrak OSM Jabodetabek, 17 Jun 2026')
    a = ap.parse_args()

    feats = read_features(a.src)
    bfeat = [f for f in feats if f['properties'].get('name') == a.boundary and polygons(f['geometry'])]
    if not bfeat:
        sys.exit('Batas "%s" tidak ditemukan di %s' % (a.boundary, a.src))
    bpoly = max(polygons(bfeat[0]['geometry']), key=lambda pl: len(pl[0]))
    lons = [c[0] for c in bpoly[0]]
    lats = [c[1] for c in bpoly[0]]
    lat0, lon0 = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
    P = Proj(lat0, lon0)
    b_outer = simplify_ring(P.ring(bpoly[0]), 1.0)
    b_holes = [simplify_ring(P.ring(h), 1.0) for h in bpoly[1:]]
    bb = bbox(b_outer)
    crop = (bb[0] - MARGIN_M, bb[1] - MARGIN_M, bb[2] + MARGIN_M, bb[3] + MARGIN_M)

    def in_crop(x, y):
        return crop[0] <= x <= crop[2] and crop[1] <= y <= crop[3]

    mask = InsideMask(b_outer, b_holes, 2.0)

    def inside(x, y):
        return mask.inside(x, y)

    def touches(pts):
        """Garis/poligon yang menyentuh kawasan (titik atau tengah ruas di dalam)."""
        for i, (x, y) in enumerate(pts):
            if inside(x, y):
                return True
            if i and inside((x + pts[i - 1][0]) / 2, (y + pts[i - 1][1]) / 2):
                return True
        return False

    # ---------- cluster bernama ----------
    clusters = []
    for f in feats:
        p = f['properties']
        name = p.get('name')
        if not name or name == a.boundary or p.get('landuse') not in ('residential', 'commercial', 'retail', 'construction'):
            continue
        for pl in polygons(f['geometry']):
            ring = simplify_ring(P.ring(pl[0]), 0.8)
            if len(ring) < 3:
                continue
            cx, cy = centroid(ring)
            if not in_crop(cx, cy) or not inside(cx, cy):
                continue
            clusters.append({'name': name, 'kind': p.get('landuse'), 'ring': ring, 'c': (cx, cy),
                             'ha': abs(area(ring)) / 1e4, 'bb': bbox(ring), 'nb': 0})
    clusters.sort(key=lambda c: c['ha'])  # cluster kecil menang saat tumpang tindih

    def cluster_of(x, y):
        for i, c in enumerate(clusters):
            b = c['bb']
            if b[0] <= x <= b[2] and b[1] <= y <= b[3] and pip(x, y, c['ring']):
                return i
        return -1

    # ---------- bangunan ----------
    B = {'r': [], 'h': [], 'k': [], 'f': [], 'l': [], 'c': [], 'n': {}}
    bgrid = Grid(25.0)
    brings = []

    def building_feature(f):
        """Tapak + tinggi + jenis bangunan OSM (tanpa cek kawasan). None kalau bukan bangunan yang dipakai."""
        p = f['properties']
        if 'building' not in p or p.get('building') in ('no', 'demolished', 'destroyed'):
            return None
        pls = polygons(f['geometry'])
        if not pls:
            return None
        pl = max(pls, key=lambda q: len(q[0]))
        ring = simplify_ring(P.ring(pl[0]), 0.25)
        if len(ring) < 3:
            return None
        a_m2 = abs(area(ring))
        if a_m2 < 6:
            return None
        cx, cy = centroid(ring)
        btype = p.get('building', 'yes')
        levels = parse_num(p.get('building:levels'))
        h = parse_num(p.get('height'))
        if h is None and levels:
            h = levels * 3.3 + 1.2
        if h is None:
            h = DEFAULT_H.get(btype, 6)
            if btype == 'yes':
                if a_m2 > 8000:
                    h = 16
                elif a_m2 > 2500:
                    h = 11
                elif a_m2 > 600:
                    h = 8
            h *= 0.85 + 0.3 * hash01(round(cx, 1), round(cy, 1))
        h = max(2.5, min(h, 220))
        kind = KIND.get(btype, 0)
        if kind in (0, 1) and (h >= 24 or (levels or 0) >= 7):
            kind = 2
        if kind == 0 and btype == 'yes' and a_m2 > 1500:
            kind = 1
        return {'ring': ring, 'a': a_m2, 'cx': cx, 'cy': cy, 'h': h, 'kind': kind, 'levels': levels, 'name': p.get('name')}

    def add_building(bf, flags, cluster):
        idx = len(B['r'])
        B['r'].append(flat_dm(bf['ring']))
        B['h'].append(int(round(bf['h'] * 10)))
        B['k'].append(bf['kind'])
        B['f'].append(flags)
        B['l'].append(int(bf['levels']) if bf['levels'] else 0)
        B['c'].append(cluster)
        if bf['name']:
            B['n'][str(idx)] = bf['name']
        brings.append(bf['ring'])
        bgrid.add(idx, bbox(bf['ring']))
        return idx

    for f in feats:
        p = f['properties']
        if 'building' not in p or p.get('building') in ('no', 'demolished', 'destroyed'):
            continue
        pls = polygons(f['geometry'])
        if not pls:
            continue
        pl = max(pls, key=lambda q: len(q[0]))
        ring = simplify_ring(P.ring(pl[0]), 0.25)
        if len(ring) < 3:
            continue
        a_m2 = abs(area(ring))
        if a_m2 < 6:
            continue
        cx, cy = centroid(ring)
        if not inside(cx, cy):
            continue
        btype = p.get('building', 'yes')
        levels = parse_num(p.get('building:levels'))
        h = parse_num(p.get('height'))
        if h is None and levels:
            h = levels * 3.3 + 1.2
        if h is None:
            h = DEFAULT_H.get(btype, 6)
            if btype == 'yes':
                if a_m2 > 8000:
                    h = 16
                elif a_m2 > 2500:
                    h = 11
                elif a_m2 > 600:
                    h = 8
            h *= 0.85 + 0.3 * hash01(round(cx, 1), round(cy, 1))
        h = max(2.5, min(h, 220))
        kind = KIND.get(btype, 0)
        if kind in (0, 1) and (h >= 24 or (levels or 0) >= 7):
            kind = 2
        if kind == 0 and btype == 'yes' and a_m2 > 1500:
            kind = 1
        ins = inside(cx, cy)
        flags = (1 if ins else 0) | (2 if (ins and kind == 0 and a_m2 < 650 and is_rect(ring)) else 0)
        idx = len(B['r'])
        B['r'].append(flat_dm(ring))
        B['h'].append(int(round(h * 10)))
        B['k'].append(kind)
        B['f'].append(flags)
        B['l'].append(int(levels) if levels else 0)
        B['c'].append(cluster_of(cx, cy) if ins else -1)
        if B['c'][-1] >= 0:
            clusters[B['c'][-1]]['nb'] += 1
        if p.get('name'):
            B['n'][str(idx)] = p['name']
        brings.append(ring)
        bgrid.add(idx, bbox(ring))

    def in_building(x, y):
        """Indeks bangunan tertinggi yang memuat titik (podium vs menara: ambil menaranya)."""
        best, best_h = -1, -1
        for i in bgrid.near(x, y):
            if B['h'][i] > best_h and pip(x, y, brings[i]):
                best, best_h = i, B['h'][i]
        return best

    # ---------- jalan & sungai ----------
    R = {'r': [], 'c': [], 'w': [], 'n': {}}
    W = {'r': [], 'w': []}
    road_lines = []
    for f in feats:
        p = f['properties']
        g = f['geometry']
        if g['type'] != 'LineString':
            continue
        hw = p.get('highway')
        if hw:
            hw = LINK_CLASS.get(hw, hw)
            if hw not in ROAD_WIDTH or p.get('area') == 'yes':
                continue
            pts = [P.xy(c[0], c[1]) for c in g['coordinates']]
            if not touches(pts):
                continue
            pts = simplify_line(pts, 0.6)
            width = parse_num(p.get('width')) or ROAD_WIDTH[hw]
            if p.get('oneway') == 'yes' and hw in ('motorway', 'trunk', 'primary', 'secondary'):
                width *= 0.55
            idx = len(R['r'])
            R['r'].append(flat_dm(pts))
            R['c'].append(ROAD_CLASSES.index(hw))
            R['w'].append(int(round(width * 10)))
            if p.get('name') and hw in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary'):
                R['n'][str(idx)] = p['name']
            road_lines.append((hw, width, pts))
        ww = p.get('waterway')
        if ww in WATERWAY_WIDTH:
            pts = [P.xy(c[0], c[1]) for c in g['coordinates']]
            if touches(pts):
                W['r'].append(flat_dm(simplify_line(pts, 0.8)))
                W['w'].append(int(round((parse_num(p.get('width')) or WATERWAY_WIDTH[ww]) * 10)))

    # ---------- air & hijau ----------
    water, green = [], {'r': [], 't': []}
    wrings, grings = [], []
    for f in feats:
        p = f['properties']
        pls = polygons(f['geometry'])
        if not pls or 'building' in p:
            continue
        is_water = p.get('natural') == 'water' or p.get('landuse') in ('reservoir', 'basin') or p.get('waterway') == 'riverbank' or 'water' in p
        gt = None
        if p.get('leisure') in ('park', 'garden', 'playground', 'village_green'):
            gt = 'park'
        elif p.get('leisure') in ('pitch', 'sports_centre', 'stadium', 'track'):
            gt = 'pitch'
        elif p.get('leisure') == 'golf_course':
            gt = 'golf'
        elif p.get('landuse') in ('forest', 'orchard') or p.get('natural') in ('wood', 'scrub'):
            gt = 'forest'
        elif p.get('landuse') in ('grass', 'recreation_ground', 'meadow', 'village_green', 'farmland') or p.get('natural') == 'grassland':
            gt = 'grass'
        elif p.get('landuse') == 'cemetery' or p.get('amenity') == 'grave_yard':
            gt = 'cemetery'
        if not is_water and not gt:
            continue
        for pl in pls:
            ring = simplify_ring(P.ring(pl[0]), 0.8)
            if len(ring) < 3:
                continue
            if not touches(ring) and not inside(*centroid(ring)):
                continue
            if is_water:
                water.append(flat_dm(ring))
                wrings.append(ring)
            else:
                green['r'].append(flat_dm(ring))
                green['t'].append(GREEN_TYPES.index(gt))
                grings.append((gt, ring))

    def in_water(x, y):
        return any(pip(x, y, r) for r in wrings if bbox(r)[0] <= x <= bbox(r)[2] and bbox(r)[1] <= y <= bbox(r)[3])

    # ---------- pohon (prosedural: OSM hampir tidak punya pohon di sini) ----------
    def plant_trees(green_rings, roads, inside_fn):
        out_trees = []

        def try_tree(x, y, salt, sp=0):
            """sp: 0 pohon rindang, 1 palem (boulevard), 2 cemara (taman)."""
            if not inside_fn(x, y) or in_building(x, y) >= 0 or in_water(x, y):
                return
            s = int(hash01(salt, round(x), round(y)) * 3)
            out_trees.append((x, y, s, sp))

        for gt, ring in green_rings:
            step = {'forest': 8, 'park': 13, 'golf': 22, 'grass': 18, 'pitch': 0, 'cemetery': 14}[gt]
            if not step:
                continue
            b2 = bbox(ring)
            y = b2[1] + step / 2
            while y < b2[3]:
                x = b2[0] + step / 2
                while x < b2[2]:
                    jx = (hash01('jx', round(x), round(y)) - 0.5) * step * 0.8
                    jy = (hash01('jy', round(x), round(y)) - 0.5) * step * 0.8
                    if pip(x + jx, y + jy, ring) and hash01('k', round(x), round(y)) < 0.8:
                        conifer = hash01('sp', round(x), round(y)) < {'forest': 0.45, 'park': 0.2, 'cemetery': 0.5}.get(gt, 0.1)
                        try_tree(x + jx, y + jy, gt, 2 if conifer else 0)
                    x += step
                y += step
        for hw, width, pts in roads:
            if hw not in ('primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'):
                continue
            spacing = 15 if hw in ('primary', 'secondary', 'tertiary') else 18
            off = width / 2 + 2.4
            carry = 0.0
            for i in range(len(pts) - 1):
                (x1, y1), (x2, y2) = pts[i], pts[i + 1]
                L = math.hypot(x2 - x1, y2 - y1)
                if L < 1e-6:
                    continue
                ux, uy = (x2 - x1) / L, (y2 - y1) / L
                d = carry
                while d < L:
                    px, py = x1 + ux * d, y1 + uy * d
                    for side in (1, -1):
                        tx, ty = px - uy * off * side, py + ux * off * side
                        prob = 0.85 if hw in ('primary', 'secondary', 'tertiary') else 0.5
                        if hash01('rt', round(tx), round(ty), side) < prob:
                            palm = hw in ('primary', 'secondary', 'tertiary') and hash01('palm', round(tx), round(ty)) < 0.7
                            try_tree(tx, ty, hw, 1 if palm else 0)
                    d += spacing
                carry = d - L
        return out_trees

    trees = plant_trees(grings, road_lines, inside)
    if len(trees) > TREE_CAP:
        trees.sort(key=lambda t: hash01('cap', round(t[0]), round(t[1])))
        trees = trees[:TREE_CAP]
    tree_flat = []
    for x, y, s, sp in trees:
        tree_flat += [int(round(x * 10)), int(round(y * 10)), s, sp]

    # ---------- POI ----------
    pois, seen = [], {}
    for f in feats:
        p = f['properties']
        name = p.get('name')
        if not name or name == a.boundary or p.get('landuse') or p.get('highway') in ('bus_stop',):
            continue
        g = f['geometry']
        if g['type'] == 'Point':
            x, y = P.xy(*g['coordinates'][:2])
            ring = None
        elif polygons(g):
            ring = P.ring(max(polygons(g), key=lambda q: len(q[0]))[0])
            if len(ring) < 3:
                continue
            x, y = centroid(ring)
        else:
            continue
        if not inside(x, y):
            continue
        levels = parse_num(p.get('building:levels'))
        cat, landmark = poi_category(p, levels)
        if not cat:
            continue
        bi = in_building(x, y)
        h = (B['h'][bi] / 10.0) if bi >= 0 else 0.0
        if 'building' in p:
            own = parse_num(p.get('height')) or ((levels * 3.3 + 1.2) if levels else None)
            if own and own > h:
                h = own
        key = name.strip().lower()
        item = {'name': name, 'cat': cat, 'x': int(round(x * 10)), 'y': int(round(y * 10)),
                'h': int(round(h * 10)), 'in': 1 if inside(x, y) else 0}
        if landmark:
            item['lm'] = 1
        if levels:
            item['lv'] = int(levels)
        if bi >= 0:
            item['b'] = bi
        prev = seen.get(key)
        if prev is None or (item['h'] > prev['h']):
            if prev is not None:
                pois.remove(prev)
            pois.append(item)
            seen[key] = item

    # ---------- enclave: lubang di batas kawasan (bukan milik kawasan) ----------
    # Isinya ikut dimasukkan supaya peta menyambung tanpa lubang (game & jelajah bisa lewat). Semua ditambahkan
    # di BELAKANG data utama, jadi indeks bangunan/jalan yang lama tidak berubah. Bangunan enclave: flag 4,
    # cluster −1. boundaryHoles tetap ditulis (batas resmi kawasan memang berlubang).
    enc = {'buildings': 0, 'roads': 0, 'waterways': 0, 'water': 0, 'green': 0, 'trees': 0,
           'ha': round(sum(abs(area(h)) for h in b_holes) / 1e4, 2)}
    if b_holes:
        emasks = [InsideMask(h, [], 2.0) for h in b_holes]

        def in_enclave(x, y):
            return any(m.inside(x, y) for m in emasks)

        def touches_enclave(pts):
            for i, (x, y) in enumerate(pts):
                if in_enclave(x, y):
                    return True
                if i and in_enclave((x + pts[i - 1][0]) / 2, (y + pts[i - 1][1]) / 2):
                    return True
            return False

        for f in feats:
            bf = building_feature(f)
            if not bf or not in_enclave(bf['cx'], bf['cy']):
                continue
            hip = 2 if (bf['kind'] == 0 and bf['a'] < 650 and is_rect(bf['ring'])) else 0
            add_building(bf, 4 | hip, -1)
            enc['buildings'] += 1
        e_roads = []
        for f in feats:
            p = f['properties']
            g = f['geometry']
            if g['type'] != 'LineString':
                continue
            pts = [P.xy(c[0], c[1]) for c in g['coordinates']]
            hw = p.get('highway')
            if hw:
                hw = LINK_CLASS.get(hw, hw)
                if hw in ROAD_WIDTH and p.get('area') != 'yes' and touches_enclave(pts) and not touches(pts):
                    spts = simplify_line(pts, 0.6)
                    width = parse_num(p.get('width')) or ROAD_WIDTH[hw]
                    if p.get('oneway') == 'yes' and hw in ('motorway', 'trunk', 'primary', 'secondary'):
                        width *= 0.55
                    idx = len(R['r'])
                    R['r'].append(flat_dm(spts))
                    R['c'].append(ROAD_CLASSES.index(hw))
                    R['w'].append(int(round(width * 10)))
                    if p.get('name') and hw in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary'):
                        R['n'][str(idx)] = p['name']
                    e_roads.append((hw, width, spts))
                    enc['roads'] += 1
            ww = p.get('waterway')
            if ww in WATERWAY_WIDTH and touches_enclave(pts) and not touches(pts):
                W['r'].append(flat_dm(simplify_line(pts, 0.8)))
                W['w'].append(int(round((parse_num(p.get('width')) or WATERWAY_WIDTH[ww]) * 10)))
                enc['waterways'] += 1
        e_grings = []
        for f in feats:
            p = f['properties']
            pls = polygons(f['geometry'])
            if not pls or 'building' in p:
                continue
            is_water = p.get('natural') == 'water' or p.get('landuse') in ('reservoir', 'basin') or p.get('waterway') == 'riverbank' or 'water' in p
            gt = None
            if p.get('leisure') in ('park', 'garden', 'playground', 'village_green'):
                gt = 'park'
            elif p.get('leisure') in ('pitch', 'sports_centre', 'stadium', 'track'):
                gt = 'pitch'
            elif p.get('leisure') == 'golf_course':
                gt = 'golf'
            elif p.get('landuse') in ('forest', 'orchard') or p.get('natural') in ('wood', 'scrub'):
                gt = 'forest'
            elif p.get('landuse') in ('grass', 'recreation_ground', 'meadow', 'village_green', 'farmland') or p.get('natural') == 'grassland':
                gt = 'grass'
            elif p.get('landuse') == 'cemetery' or p.get('amenity') == 'grave_yard':
                gt = 'cemetery'
            if not is_water and not gt:
                continue
            for pl in pls:
                ring = simplify_ring(P.ring(pl[0]), 0.8)
                if len(ring) < 3:
                    continue
                c = centroid(ring)
                if not (touches_enclave(ring) or in_enclave(*c)) or touches(ring) or inside(*c):
                    continue  # sudah ikut data utama, atau tidak menyentuh enclave
                if is_water:
                    water.append(flat_dm(ring))
                    wrings.append(ring)
                    enc['water'] += 1
                else:
                    green['r'].append(flat_dm(ring))
                    green['t'].append(GREEN_TYPES.index(gt))
                    e_grings.append((gt, ring))
                    enc['green'] += 1
        e_trees = plant_trees(e_grings, e_roads, in_enclave)
        if len(e_trees) > ENCLAVE_TREE_CAP:
            e_trees.sort(key=lambda t: hash01('cap', round(t[0]), round(t[1])))
            e_trees = e_trees[:ENCLAVE_TREE_CAP]
        for x, y, s, sp in e_trees:
            tree_flat += [int(round(x * 10)), int(round(y * 10)), s, sp]
        enc['trees'] = len(e_trees)

    out = {
        'meta': {
            'name': a.boundary, 'center': [round(lat0, 6), round(lon0, 6)], 'kx': round(P.kx, 3), 'ky': P.ky,
            'unit': 'dm', 'crop': [int(round(v * 10)) for v in crop], 'onlyInside': True, 'treeStride': 4,
            'areaHa': round(abs(area(b_outer)) / 1e4 - sum(abs(area(h)) for h in b_holes) / 1e4, 1),
            'source': a.source_label + ' (© OpenStreetMap contributors, ODbL)',
            'generated': date.today().isoformat(),
            'counts': {'buildings': len(B['r']), 'inside': sum(1 for v in B['f'] if v & 1), 'roads': len(R['r']),
                       'clusters': len(clusters), 'trees': len(trees), 'pois': len(pois), 'water': len(water),
                       'green': len(green['r'])},
            # isi enclave (lubang batas kawasan) sudah ikut di data; ditambahkan di belakang, bangunan flag 4
            'enclaves': enc,
        },
        'classes': ROAD_CLASSES, 'greenTypes': GREEN_TYPES, 'poiCats': POI_CATS,
        'boundary': flat_dm(b_outer), 'boundaryHoles': [flat_dm(h) for h in b_holes],
        'clusters': [{'name': c['name'], 'kind': c['kind'], 'r': flat_dm(c['ring']),
                      'c': [int(round(c['c'][0] * 10)), int(round(c['c'][1] * 10))],
                      'ha': round(c['ha'], 1), 'nb': c['nb']} for c in clusters],
        'buildings': B, 'roads': R, 'waterways': W, 'water': water, 'green': green,
        'trees': tree_flat, 'pois': pois,
    }
    with open(a.out, 'w', encoding='utf-8') as fo:
        json.dump(out, fo, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(out['meta']['counts']))


if __name__ == '__main__':
    main()
