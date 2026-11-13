"""Unduh tekstur PBR & langit HDR (Poly Haven, lisensi CC0) untuk mode realistis game.
Pakai: python3 -I tools/realism/fetch_assets.py <dir_pbr> <dir_sky> <dir_tmp>
Hanya mengunduh file gambar publik; tidak mengirim data apa pun."""
import json, sys, os, urllib.request

PBR, SKY, TMP = sys.argv[1], sys.argv[2], sys.argv[3]
TEX = ['asphalt_04', 'pavement_03', 'concrete_pavement', 'leafy_grass', 'forrest_ground_01', 'painted_plaster_wall', 'clay_roof_tiles_02']
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough'}
HDRI = 'kloofendal_48d_partly_cloudy_puresky'
UA = {'User-Agent': 'curl/8.7.1'}

def get(url, path=None):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if path:
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)
    return data

meta = json.loads(get('https://api.polyhaven.com/assets?t=textures'))
out = {}
for t in TEX:
    files = json.loads(get('https://api.polyhaven.com/files/' + t))
    dims = meta.get(t, {}).get('dimensions')
    out[t] = {'dimensions_mm': dims}
    for key, short in MAPS.items():
        k = key if key in files else next((x for x in files if x.lower() == key.lower()), None)
        if not k:
            print('  ! tidak ada peta', key, 'untuk', t, '→', list(files.keys()))
            continue
        url = files[k]['1k']['jpg']['url']
        n = get(url, os.path.join(PBR, f'{t}_{short}.jpg'))
        print(f'{t}_{short}.jpg', n // 1024, 'KB')
files = json.loads(get('https://api.polyhaven.com/files/' + HDRI))
print('hdri keys:', list(files.keys()))
n = get(files['hdri']['1k']['hdr']['url'], os.path.join(SKY, 'sky_1k.hdr'))
print('sky_1k.hdr', n // 1024, 'KB')
tm = files.get('tonemapped')
if tm:
    n = get(tm['url'], os.path.join(TMP, 'sky_tonemapped.jpg'))
    print('sky_tonemapped.jpg', n // 1024, 'KB')
json.dump(out, open(os.path.join(PBR, 'sets.json'), 'w'), indent=1)
print(json.dumps(out))
