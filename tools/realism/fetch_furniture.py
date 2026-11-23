"""Unduh tekstur sumber perabot interior (Poly Haven, lisensi CC0): serat kayu (venir ek), tenunan linen.
Pakai: python3 -I tools/realism/fetch_furniture.py [dir_cache]   (bawaan ~/.cache/senara-digital-twin/furniture)
Lalu tools/blender/furniture.py --detail membuat tekstur detail abu-abu web/game/assets/furniture/detail_wood.jpg,
detail_fabric.jpg (dari dua foto ini) dan detail_marble.jpg (marmer prosedural).
Hanya mengunduh file gambar publik; tidak mengirim data apa pun."""
import json, sys, os, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.cache/senara-digital-twin/furniture')
TEX = {'oak_veneer_01': 'wood', 'rough_linen': 'fabric'}
UA = {'User-Agent': 'curl/8.7.1'}


def get(url, path=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        data = r.read()
    if path:
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)
    return data


os.makedirs(OUT, exist_ok=True)
for t, short in TEX.items():
    files = json.loads(get('https://api.polyhaven.com/files/' + t))
    k = 'Diffuse' if 'Diffuse' in files else next((x for x in files if x.lower() in ('diffuse', 'diff', 'albedo')), None)
    if not k:
        print('  ! tidak ada peta diffuse untuk', t, '→', list(files.keys()))
        continue
    n = get(files[k]['1k']['jpg']['url'], os.path.join(OUT, short + '.jpg'))
    print(short + '.jpg', '←', t, n // 1024, 'KB')
