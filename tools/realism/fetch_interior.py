"""Unduh tekstur lantai dalam ruangan (Poly Haven, lisensi CC0) untuk interior rumah & toko di mode realistis game.
Pakai: python3 -I tools/realism/fetch_interior.py <dir_keluaran>   (lalu salin *.jpg ke web/game/assets/pbr/)
Hanya mengunduh file gambar publik; tidak mengirim data apa pun."""
import json, sys, os, urllib.request

OUT = sys.argv[1]
TEX = ['laminate_floor_02', 'floor_tiles_08']
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough'}
UA = {'User-Agent': 'curl/8.7.1'}

def get(url, path=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        data = r.read()
    if path:
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)
    return data

for t in TEX:
    files = json.loads(get('https://api.polyhaven.com/files/' + t))
    for key, short in MAPS.items():
        k = key if key in files else next((x for x in files if x.lower() == key.lower()), None)
        if not k:
            print('  ! tidak ada peta', key, 'untuk', t, '→', list(files.keys()))
            continue
        n = get(files[k]['1k']['jpg']['url'], os.path.join(OUT, f'{t}_{short}.jpg'))
        print(f'{t}_{short}.jpg', n // 1024, 'KB')
