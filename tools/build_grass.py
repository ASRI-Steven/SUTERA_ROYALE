#!/usr/bin/env python3
"""Peta rumput tinggi (ilalang) untuk Sutera Royale.

Sumber, karena citra satelit tidak tersedia:
  1. Tata guna lahan OSM yang di lapangan biasanya berupa rumput liar/semak: landuse grass (yang luas), meadow,
     farmland, brownfield, greenfield, construction, sand (lahan urug), landfill; natural scrub/grassland/heath/wood.
  2. Lahan kosong besar di dalam kawasan: tidak ada bangunan, jalan, air, lapangan/taman/parkir di dekatnya.
     Di Alam Sutera ini umumnya kavling yang belum dibangun. Di dalam landuse=residential syaratnya lebih ketat
     supaya cluster yang bangunannya belum lengkap di OSM tidak ikut jadi ilalang.

  python3 -I tools/build_grass.py data/osm/alsut.geojsonseq web/data/alsut-map.json web/data/alsut-grass.json [--png pratinjau.png]

Keluaran: raster bit sel CELL meter (baris dari selatan ke utara, kolom barat ke timur), koordinat sama dengan
alsut-map.json (meter lokal; JSON peta menyimpan desimeter). Hanya pustaka standar Python.
"""
import argparse
import base64
import json
import math
import os
import struct
import sys
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_map as bm  # noqa: E402

CELL = 3.0
M = 0.1
TALL = {('landuse', 'meadow'), ('landuse', 'farmland'), ('landuse', 'brownfield'), ('landuse', 'greenfield'), ('landuse', 'construction'),
        ('landuse', 'sand'), ('landuse', 'landfill'), ('natural', 'scrub'), ('natural', 'grassland'), ('natural', 'heath'), ('natural', 'wood'),
        ('landuse', 'forest')}
TALL_IF_BIG = {('landuse', 'grass')}  # rumput OSM kecil biasanya taman/median yang dipangkas
BLOCK = {('amenity', 'parking'), ('leisure', 'pitch'), ('leisure', 'park'), ('leisure', 'golf_course'), ('leisure', 'playground'),
         ('leisure', 'sports_centre'), ('leisure', 'swimming_pool'), ('leisure', 'track'), ('landuse', 'cemetery'), ('landuse', 'religious'),
         ('natural', 'water'), ('landuse', 'retail'), ('landuse', 'commercial'), ('amenity', 'school'), ('amenity', 'university')}
VACANT_MIN = 2500      # m², lahan kosong biasa
VACANT_MIN_RES = 6000  # m², lahan kosong di dalam landuse=residential


class Raster:
    def __init__(self, x0, y0, nx, ny):
        self.x0, self.y0, self.nx, self.ny = x0, y0, nx, ny
        self.rows = [bytearray(nx) for _ in range(ny)]

    def fill(self, ring, val=1):
        n = len(ring)
        ys = [p[1] for p in ring]
        j0 = max(0, int((min(ys) - self.y0) / CELL) - 1)
        j1 = min(self.ny - 1, int((max(ys) - self.y0) / CELL) + 1)
        for j in range(j0, j1 + 1):
            y = self.y0 + (j + 0.5) * CELL
            xs = []
            for i in range(n):
                x1, y1 = ring[i]
                x2, y2 = ring[(i + 1) % n]
                if (y1 > y) != (y2 > y):
                    xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            row = self.rows[j]
            for k in range(0, len(xs) - 1, 2):
                a = max(0, int(math.ceil((xs[k] - self.x0) / CELL - 0.5)))
                b = min(self.nx - 1, int(math.floor((xs[k + 1] - self.x0) / CELL - 0.5)))
                if b >= a:
                    row[a:b + 1] = bytes([val]) * (b - a + 1)

    def band(self, ax, ay, bx, by, half, val=1):  # sel dalam jarak 'half' dari ruas
        i0 = max(0, int((min(ax, bx) - half - self.x0) / CELL))
        i1 = min(self.nx - 1, int((max(ax, bx) + half - self.x0) / CELL))
        j0 = max(0, int((min(ay, by) - half - self.y0) / CELL))
        j1 = min(self.ny - 1, int((max(ay, by) + half - self.y0) / CELL))
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        for j in range(j0, j1 + 1):
            y = self.y0 + (j + 0.5) * CELL
            row = self.rows[j]
            for i in range(i0, i1 + 1):
                x = self.x0 + (i + 0.5) * CELL
                t = ((x - ax) * dx + (y - ay) * dy) / L if L > 0 else 0
                t = 0 if t < 0 else 1 if t > 1 else t
                if (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2 <= half * half:
                    row[i] = val

    def dilate(self, r):
        for _ in range(r):
            new = [bytearray(r_) for r_ in self.rows]
            for j in range(self.ny):
                row, out = self.rows[j], new[j]
                up = self.rows[j + 1] if j + 1 < self.ny else None
                dn = self.rows[j - 1] if j > 0 else None
                for i in range(self.nx):
                    if row[i]:
                        continue
                    if (i > 0 and row[i - 1]) or (i + 1 < self.nx and row[i + 1]) or (up and up[i]) or (dn and dn[i]):
                        out[i] = 1
            self.rows = new


def ring_m(flat):
    return [(flat[i] * M, flat[i + 1] * M) for i in range(0, len(flat) - 1, 2)]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src', help='GeoJSON sequence OSM (osmium export)')
    ap.add_argument('map', help='web/data/alsut-map.json')
    ap.add_argument('out', help='berkas JSON keluaran')
    ap.add_argument('--png', help='simpan pratinjau PNG')
    a = ap.parse_args()

    D = json.load(open(a.map, encoding='utf-8'))
    lat0, lon0 = D['meta']['center']
    kx, ky = D['meta']['kx'], D['meta']['ky']
    proj = lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)  # noqa: E731
    outer = ring_m(D['boundary'])
    xs, ys = [p[0] for p in outer], [p[1] for p in outer]
    x0, y0 = min(xs) - CELL, min(ys) - CELL
    nx, ny = int((max(xs) - x0) / CELL) + 2, int((max(ys) - y0) / CELL) + 2
    inside = Raster(x0, y0, nx, ny)
    inside.fill(outer)  # enclave sudah termasuk kawasan main (lihat world.js)

    core = Raster(x0, y0, nx, ny)  # tidak pernah berumput: tapak bangunan, badan jalan, air
    occ = Raster(x0, y0, nx, ny)   # + halaman, bahu jalan, taman/lapangan/parkir (untuk deteksi lahan kosong)
    B = D['buildings']
    for r in B['r']:
        core.fill(ring_m(r))
        occ.fill(ring_m(r))
    occ.dilate(1)  # halaman/teras ±3 m
    for ri, r in enumerate(D['roads']['r']):
        w2 = D['roads']['w'][ri] * M / 2
        pts = ring_m(r)
        for k in range(len(pts) - 1):
            occ.band(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], w2 + 3.0)
            core.band(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], w2 + 0.6)
    for r in D['water']:
        occ.fill(ring_m(r))
        core.fill(ring_m(r))
    for r in D['green']['r']:
        occ.fill(ring_m(r))  # taman/lapangan/makam: rumput pendek

    tall = Raster(x0, y0, nx, ny)
    resid = Raster(x0, y0, nx, ny)
    n_tall = 0
    for f in bm.read_features(a.src):
        p, geom = f.get('properties', {}), f.get('geometry') or {}
        if geom.get('type') not in ('Polygon', 'MultiPolygon'):
            continue
        tags = {(k, p[k]) for k in ('landuse', 'natural', 'leisure', 'amenity') if k in p}
        if not tags:
            continue
        for poly in bm.polygons(geom):
            ring = [proj(c[0], c[1]) for c in poly[0]]
            if len(ring) < 3:
                continue
            rx = [q[0] for q in ring]
            ry = [q[1] for q in ring]
            if max(rx) < x0 or min(rx) > x0 + nx * CELL or max(ry) < y0 or min(ry) > y0 + ny * CELL:
                continue
            if tags & BLOCK:
                occ.fill(ring)
            elif tags & TALL or (tags & TALL_IF_BIG and abs(bm.area(ring)) > 1500):
                tall.fill(ring)
                n_tall += 1
            elif ('landuse', 'residential') in tags:
                resid.fill(ring)

    # lahan kosong: komponen terhubung sel bebas
    vac = Raster(x0, y0, nx, ny)
    seen = [bytearray(nx) for _ in range(ny)]
    min_c, min_c_res = VACANT_MIN / CELL ** 2, VACANT_MIN_RES / CELL ** 2
    for j in range(ny):
        for i in range(nx):
            if seen[j][i] or not inside.rows[j][i] or occ.rows[j][i]:
                continue
            stack, comp, res = [(i, j)], [], 0
            seen[j][i] = 1
            while stack:
                ci, cj = stack.pop()
                comp.append((ci, cj))
                res += resid.rows[cj][ci]
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ni, nj = ci + di, cj + dj
                    if 0 <= ni < nx and 0 <= nj < ny and not seen[nj][ni] and inside.rows[nj][ni] and not occ.rows[nj][ni]:
                        seen[nj][ni] = 1
                        stack.append((ni, nj))
            need = min_c_res if res > len(comp) * 0.5 else min_c
            if len(comp) >= need:
                for ci, cj in comp:
                    vac.rows[cj][ci] = 1

    out = Raster(x0, y0, nx, ny)
    c_osm = c_vac = 0
    for j in range(ny):
        for i in range(nx):
            if not inside.rows[j][i] or core.rows[j][i]:
                continue
            if tall.rows[j][i]:
                out.rows[j][i] = 1
                c_osm += 1
            elif vac.rows[j][i]:
                out.rows[j][i] = 1
                c_vac += 1
    bits = bytearray((nx * ny + 7) // 8)
    k = 0
    for j in range(ny):
        row = out.rows[j]
        for i in range(nx):
            if row[i]:
                bits[k >> 3] |= 1 << (k & 7)
            k += 1
    area_in = sum(sum(r) for r in inside.rows) * CELL * CELL
    stats = {'osm_ha': round(c_osm * CELL * CELL / 1e4, 1), 'vacant_ha': round(c_vac * CELL * CELL / 1e4, 1),
             'area_ha': round(area_in / 1e4, 1), 'osm_polys': n_tall}
    stats['share'] = round((c_osm + c_vac) * CELL * CELL / area_in, 3)
    doc = {'cell': CELL, 'x0': round(x0, 2), 'y0': round(y0, 2), 'nx': nx, 'ny': ny, 'bits': base64.b64encode(bytes(bits)).decode('ascii'),
           'stats': stats, 'source': 'OSM (tata guna lahan) + lahan kosong besar tanpa bangunan/jalan; ' + D['meta'].get('source', '')}
    with open(a.out, 'w', encoding='utf-8') as fo:
        json.dump(doc, fo, separators=(',', ':'))
    print(json.dumps(stats), '→', a.out, os.path.getsize(a.out), 'byte')

    if a.png:  # pratinjau: hijau = rumput tinggi, abu = terisi, krem = kawasan, putih = luar
        raw = bytearray()
        for j in range(ny - 1, -1, -1):
            raw.append(0)
            for i in range(nx):
                if out.rows[j][i]:
                    raw += bytes((70, 140, 50)) if tall.rows[j][i] else bytes((150, 170, 60))
                elif not inside.rows[j][i]:
                    raw += b'\xff\xff\xff'
                elif occ.rows[j][i]:
                    raw += bytes((175, 175, 180))
                else:
                    raw += bytes((236, 231, 218))

        def chunk(t, d):
            return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', nx, ny, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
        open(a.png, 'wb').write(png)
        print('pratinjau', a.png)


if __name__ == '__main__':
    main()
