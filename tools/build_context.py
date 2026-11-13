#!/usr/bin/env python3
"""Bangun data lingkungan sekitar Alam Sutera (di luar batas kawasan) untuk game.

Hasilnya hanya tampilan: bangunan, jalan, sungai, air, taman, tata guna lahan, dan pohon OSM sampai RING_M
meter dari batas kawasan, supaya dari darat peta tidak berakhir di tebing kosong. Tidak bisa dilewati pemain.

  python3 -I tools/build_context.py data/osm/alsut.geojsonseq web/data/alsut-map.json web/data/alsut-context.json

Koordinat sama dengan alsut-map.json (meter lokal dari titik tengah kawasan, disimpan desimeter).
Cakupan dibatasi kotak ekstrak osmium (lihat build_map.py); di luar itu game mengisi sendiri (pengisi prosedural).
Hanya pakai pustaka standar Python.
"""
import argparse
import json
import math
import os
import sys
from datetime import date

sys.dont_write_bytecode = True  # jangan tinggalkan __pycache__ di tools/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_map as bm  # noqa: E402  (fungsi bantu & tabel jenis/tinggi bangunan yang sama)

RING_M = 1000          # jarak maksimum dari batas kawasan
CELL = 10.0            # resolusi raster jarak (m)
TREE_CAP = 5000
EXTRACT_BBOX = (106.636, -6.272, 106.680, -6.212)  # sama dengan perintah osmium extract di build_map.py
LAND = {  # tata guna lahan → kelas warna di map/context.js
    'residential': 'residential', 'commercial': 'commercial', 'retail': 'commercial', 'industrial': 'industrial',
    'cemetery': 'cemetery', 'grass': 'grass', 'meadow': 'grass', 'recreation_ground': 'grass', 'village_green': 'grass',
    'farmland': 'farmland', 'orchard': 'forest', 'forest': 'forest', 'sand': 'sand', 'construction': 'construction',
    'religious': 'commercial', 'military': 'industrial', 'landfill': 'sand', 'plant_nursery': 'grass',
}
LAND_TYPES = ['residential', 'commercial', 'industrial', 'cemetery', 'grass', 'farmland', 'forest', 'sand', 'construction']


class DistField:
    """Jarak (m) dari kawasan, raster CELL m, transformasi chamfer dua lintasan (galat < 8%)."""
    def __init__(self, outer, box):
        self.x0, self.y0 = box[0] - CELL, box[1] - CELL
        self.nx = int((box[2] - self.x0) / CELL) + 2
        self.ny = int((box[3] - self.y0) / CELL) + 2
        big = 1e9
        d = [big] * (self.nx * self.ny)
        mask = bm.InsideMask(outer, [], CELL)
        for j in range(self.ny):
            y = self.y0 + (j + 0.5) * CELL
            for i in range(self.nx):
                if mask.inside(self.x0 + (i + 0.5) * CELL, y):
                    d[j * self.nx + i] = 0.0
        nx, ny, a, b = self.nx, self.ny, CELL, CELL * math.sqrt(2)
        for j in range(ny):
            for i in range(nx):
                k = j * nx + i
                v = d[k]
                if i > 0 and d[k - 1] + a < v: v = d[k - 1] + a
                if j > 0:
                    if d[k - nx] + a < v: v = d[k - nx] + a
                    if i > 0 and d[k - nx - 1] + b < v: v = d[k - nx - 1] + b
                    if i < nx - 1 and d[k - nx + 1] + b < v: v = d[k - nx + 1] + b
                d[k] = v
        for j in range(ny - 1, -1, -1):
            for i in range(nx - 1, -1, -1):
                k = j * nx + i
                v = d[k]
                if i < nx - 1 and d[k + 1] + a < v: v = d[k + 1] + a
                if j < ny - 1:
                    if d[k + nx] + a < v: v = d[k + nx] + a
                    if i < nx - 1 and d[k + nx + 1] + b < v: v = d[k + nx + 1] + b
                    if i > 0 and d[k + nx - 1] + b < v: v = d[k + nx - 1] + b
                d[k] = v
        self.d = d

    def at(self, x, y):
        i, j = int((x - self.x0) / CELL), int((y - self.y0) / CELL)
        if 0 <= i < self.nx and 0 <= j < self.ny:
            return self.d[j * self.nx + i]
        return 1e9


def runs(pts, keep, step=8.0):
    """Potong garis jadi bagian-bagian yang titiknya memenuhi keep(x, y) (dicek tiap ±step m)."""
    out, cur = [], []
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) / step))
        for s in range(n):
            t = s / n
            x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
            if keep(x, y):
                cur.append((x, y))
            elif cur:
                if len(cur) > 1:
                    out.append(cur)
                cur = []
    if keep(*pts[-1]):
        cur.append(pts[-1])
    if len(cur) > 1:
        out.append(cur)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src', help='GeoJSON sequence dari osmium export (sama dengan build_map.py)')
    ap.add_argument('map', help='alsut-map.json (titik tengah, proyeksi, batas kawasan)')
    ap.add_argument('out', help='berkas JSON keluaran')
    ap.add_argument('--ring', type=float, default=RING_M, help='jarak maksimum dari batas kawasan (m)')
    a = ap.parse_args()

    D = json.load(open(a.map, encoding='utf-8'))
    lat0, lon0 = D['meta']['center']
    kx, ky = D['meta']['kx'], D['meta']['ky']

    def xy(lon, lat):
        return ((lon - lon0) * kx, (lat - lat0) * ky)

    def ring_xy(coords):
        pts = [xy(c[0], c[1]) for c in coords]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        return pts

    outer = [(D['boundary'][i] / 10, D['boundary'][i + 1] / 10) for i in range(0, len(D['boundary']), 2)]
    cov = xy(EXTRACT_BBOX[0], EXTRACT_BBOX[1]) + xy(EXTRACT_BBOX[2], EXTRACT_BBOX[3])
    dist = DistField(outer, cov)
    R = a.ring

    def in_cov(x, y):
        return cov[0] <= x <= cov[2] and cov[1] <= y <= cov[3]

    def band(x, y, pad=0.0):  # di luar kawasan, dalam cincin, dalam cakupan ekstrak
        d = dist.at(x, y)
        return 0 < d <= R + pad and in_cov(x, y)

    def touches_area(pts):
        for i, (x, y) in enumerate(pts):
            if dist.at(x, y) == 0:
                return True
            if i and dist.at((x + pts[i - 1][0]) / 2, (y + pts[i - 1][1]) / 2) == 0:
                return True
        return False

    feats = bm.read_features(a.src)

    # ---------- bangunan ----------
    B = {'r': [], 'h': [], 'k': []}
    bgrid, brings = bm.Grid(25.0), []
    for f in feats:
        p = f['properties']
        if 'building' not in p or p.get('building') in ('no', 'demolished', 'destroyed'):
            continue
        pls = bm.polygons(f['geometry'])
        if not pls:
            continue
        pl = max(pls, key=lambda q: len(q[0]))
        ring = bm.simplify_ring(ring_xy(pl[0]), 0.5)
        if len(ring) < 3:
            continue
        a_m2 = abs(bm.area(ring))
        if a_m2 < 16:
            continue
        cx, cy = bm.centroid(ring)
        if not band(cx, cy):
            continue
        btype = p.get('building', 'yes')
        levels = bm.parse_num(p.get('building:levels'))
        h = bm.parse_num(p.get('height'))
        if h is None and levels:
            h = levels * 3.3 + 1.2
        if h is None:
            h = bm.DEFAULT_H.get(btype, 6)
            if btype == 'yes':
                h = 16 if a_m2 > 8000 else 11 if a_m2 > 2500 else 8 if a_m2 > 600 else h
            h *= 0.85 + 0.3 * bm.hash01(round(cx, 1), round(cy, 1))
        h = max(2.5, min(h, 220))
        kind = bm.KIND.get(btype, 0)
        if kind in (0, 1) and (h >= 24 or (levels or 0) >= 7):
            kind = 2
        if kind == 0 and btype == 'yes' and a_m2 > 1500:
            kind = 1
        bgrid.add(len(B['r']), bm.bbox(ring))
        brings.append(ring)
        B['r'].append(bm.flat_dm(ring))
        B['h'].append(int(round(h * 10)))
        B['k'].append(kind)

    def in_building(x, y):
        return any(bm.pip(x, y, brings[i]) for i in bgrid.near(x, y))

    # ---------- jalan, sungai, air, hijau, lahan ----------
    Rd = {'r': [], 'c': [], 'w': []}
    Ww = {'r': [], 'w': []}
    tree_lines = []  # (kelas, lebar, titik) termasuk bagian luar jalan yang sudah ada di data utama
    for f in feats:
        p = f['properties']
        g = f['geometry']
        if g['type'] != 'LineString':
            continue
        pts = [xy(c[0], c[1]) for c in g['coordinates']]
        hw = p.get('highway')
        if hw:
            hw = bm.LINK_CLASS.get(hw, hw)
            if hw in bm.ROAD_WIDTH and p.get('area') != 'yes':
                width = bm.parse_num(p.get('width')) or bm.ROAD_WIDTH[hw]
                if p.get('oneway') == 'yes' and hw in ('motorway', 'trunk', 'primary', 'secondary'):
                    width *= 0.55
                parts = runs(pts, lambda x, y: band(x, y, 120))
                for part in parts:
                    tree_lines.append((hw, width, part))
                if not touches_area(pts):  # jalan yang menyentuh kawasan sudah ada (utuh) di alsut-map.json
                    for part in parts:
                        Rd['r'].append(bm.flat_dm(bm.simplify_line(part, 0.8)))
                        Rd['c'].append(bm.ROAD_CLASSES.index(hw))
                        Rd['w'].append(int(round(width * 10)))
        ww = p.get('waterway')
        if ww in bm.WATERWAY_WIDTH and not touches_area(pts):
            for part in runs(pts, lambda x, y: band(x, y, 120)):
                Ww['r'].append(bm.flat_dm(bm.simplify_line(part, 1.0)))
                Ww['w'].append(int(round((bm.parse_num(p.get('width')) or bm.WATERWAY_WIDTH[ww]) * 10)))

    water, green, land = [], {'r': [], 't': []}, {'r': [], 't': []}
    wrings, grings = [], []
    for f in feats:
        p = f['properties']
        pls = bm.polygons(f['geometry'])
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
        lt = LAND.get(p.get('landuse'))
        if not is_water and not gt and not lt:
            continue
        for pl in pls:
            ring = bm.simplify_ring(ring_xy(pl[0]), 1.0)
            if len(ring) < 3:
                continue
            c = bm.centroid(ring)
            near = band(*c, 150) or any(band(x, y, 60) for x, y in ring[::max(1, len(ring) // 12)])
            if not near or dist.at(*c) == 0:
                continue  # yang di dalam kawasan sudah ada di data utama
            if is_water:
                water.append(bm.flat_dm(ring))
                wrings.append(ring)
            elif gt:
                green['r'].append(bm.flat_dm(ring))
                green['t'].append(bm.GREEN_TYPES.index(gt))
                grings.append((gt, ring))
            else:
                land['r'].append(bm.flat_dm(ring))
                land['t'].append(LAND_TYPES.index(lt))

    def in_water(x, y):
        return any(bm.pip(x, y, r) for r in wrings)

    # ---------- pohon (prosedural, lebih jarang dari dalam kawasan) ----------
    trees = []

    def try_tree(x, y, salt, sp):
        if not band(x, y, 40) or in_building(x, y) or in_water(x, y):
            return
        trees.append((x, y, int(bm.hash01(salt, round(x), round(y)) * 3), sp))

    for gt, ring in grings:
        step = {'forest': 9, 'park': 14, 'golf': 24, 'grass': 22, 'pitch': 0, 'cemetery': 16}[gt]
        if not step:
            continue
        b2 = bm.bbox(ring)
        y = b2[1] + step / 2
        while y < b2[3]:
            x = b2[0] + step / 2
            while x < b2[2]:
                jx = (bm.hash01('cjx', round(x), round(y)) - 0.5) * step * 0.8
                jy = (bm.hash01('cjy', round(x), round(y)) - 0.5) * step * 0.8
                if bm.pip(x + jx, y + jy, ring) and bm.hash01('ck', round(x), round(y)) < 0.75:
                    try_tree(x + jx, y + jy, gt, 2 if bm.hash01('csp', round(x), round(y)) < 0.25 else 0)
                x += step
            y += step
    for hw, width, pts in tree_lines:
        if hw not in ('primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'):
            continue
        big = hw in ('primary', 'secondary', 'tertiary')
        spacing, off, carry = (17 if big else 22), width / 2 + 2.4, 0.0
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
                    if bm.hash01('crt', round(tx), round(ty), side) < (0.75 if big else 0.35):
                        try_tree(tx, ty, hw, 1 if big and bm.hash01('cpalm', round(tx), round(ty)) < 0.6 else 0)
                d += spacing
            carry = d - L
    if len(trees) > TREE_CAP:
        trees.sort(key=lambda t: bm.hash01('ccap', round(t[0]), round(t[1])))
        trees = trees[:TREE_CAP]
    tree_flat = []
    for x, y, s, sp in trees:
        tree_flat += [int(round(x * 10)), int(round(y * 10)), s, sp]

    out = {
        'meta': {
            'name': D['meta']['name'] + ' · sekitar', 'center': D['meta']['center'], 'unit': 'dm', 'ring': R,
            'coverage': [int(round(v * 10)) for v in cov], 'treeStride': 4,
            'source': D['meta']['source'], 'generated': date.today().isoformat(),
            'counts': {'buildings': len(B['r']), 'roads': len(Rd['r']), 'waterways': len(Ww['r']), 'water': len(water),
                       'green': len(green['r']), 'land': len(land['r']), 'trees': len(trees)},
        },
        'classes': bm.ROAD_CLASSES, 'greenTypes': bm.GREEN_TYPES, 'landTypes': LAND_TYPES,
        'buildings': B, 'roads': Rd, 'waterways': Ww, 'water': water, 'green': green, 'land': land, 'trees': tree_flat,
    }
    with open(a.out, 'w', encoding='utf-8') as fo:
        json.dump(out, fo, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(out['meta']['counts']), 'coverage m', [round(v) for v in cov])


if __name__ == '__main__':
    main()
