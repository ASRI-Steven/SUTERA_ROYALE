# Pembaca data MakeHuman (CC0) untuk tools/blender/characters3.py — murni numpy, tidak butuh add-on apa pun.
# Sumber data (unduh sekali, simpan di luar repo):
#   MPFB  : arsip ekstensi mpfb dari extensions.blender.org → hanya folder data/ yang dipakai (mesh dasar hm08, target
#           morf, rig + bobot kulit). Kode add-on-nya TIDAK dijalankan.
#   ASSETS: makehuman_system_assets_cc0.zip (pakaian, sepatu, rambut, kulit, mata, alis) dari makehumancommunity.org.
# Koordinat keluaran: meter, +Y atas, +Z depan, +X = kiri karakter (sama dengan konvensi glTF game ini).
import os, json, gzip
import numpy as np

SCALE = 0.1  # satuan MakeHuman = desimeter


def read_obj(path):
    """→ verts (N,3) float64, uvs (M,2), faces [np.int32 (k,2) → (indeks verteks, indeks uv)], groups [nama per face]"""
    V, T, F, G = [], [], [], []
    g = ''
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if line.startswith('v '):
                p = line.split(); V.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith('vt '):
                p = line.split(); T.append((float(p[1]), float(p[2])))
            elif line.startswith('f '):
                c = []
                for tok in line.split()[1:]:
                    a = tok.split('/')
                    c.append((int(a[0]) - 1, int(a[1]) - 1 if len(a) > 1 and a[1] else -1))
                F.append(np.array(c, dtype=np.int32)); G.append(g)
            elif line.startswith('g '):
                g = line[2:].strip()
    return np.array(V, dtype=np.float64), np.array(T, dtype=np.float64).reshape(-1, 2), F, G


def read_target(path):
    idx, off = [], []
    op = gzip.open if path.endswith('.gz') else open
    with op(path, 'rt', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if not line or line[0] == '#':
                continue
            p = line.split()
            if len(p) < 4:
                continue
            idx.append(int(p[0])); off.append((float(p[1]), float(p[2]), float(p[3])))
    return np.array(idx, dtype=np.int64), np.array(off, dtype=np.float64).reshape(-1, 3)


def _tri(v, lo, mid, hi):
    """bobot tiga komponen (min, rata-rata, maks) untuk nilai v ∈ [0,1]"""
    if v < 0.5:
        return {lo: 1 - v * 2, mid: v * 2, hi: 0.0}
    return {lo: 0.0, mid: 1 - (v - 0.5) * 2, hi: (v - 0.5) * 2}


class MakeHuman:
    def __init__(self, mpfb_data, assets):
        self.d, self.assets = mpfb_data, assets
        self.V0, self.UV, self.F, self.G = read_obj(os.path.join(mpfb_data, '3dobjs', 'base.obj'))
        vg = json.load(open(os.path.join(mpfb_data, 'mesh_metadata', 'basemesh_vertex_groups.json')))
        self.vgroups = vg
        self.cubes = {k: np.concatenate([np.arange(a, b + 1) for a, b in v]) for k, v in vg.items() if k.startswith('joint-')}
        self.nbody = vg['body'][0][1] + 1
        self.rig = json.load(open(os.path.join(mpfb_data, 'rigs', 'standard', 'rig.game_engine.json')))
        w = json.load(open(os.path.join(mpfb_data, 'rigs', 'standard', 'weights.game_engine.json')))['weights']
        self.bones = sorted(self.rig.keys())
        self.bi = {b: i for i, b in enumerate(self.bones)}
        W = np.zeros((len(self.V0), len(self.bones)), dtype=np.float32)
        for b, lst in w.items():
            if lst:
                a = np.array(lst, dtype=np.float64)
                W[a[:, 0].astype(np.int64), self.bi[b]] = a[:, 1]
        self.W = W
        self._tc = {}

    def target(self, rel):
        if rel not in self._tc:
            p = os.path.join(self.d, 'targets', rel + '.target.gz')
            if not os.path.exists(p):
                p = os.path.join(self.d, 'targets', rel + '.target')
            self._tc[rel] = read_target(p) if os.path.exists(p) else None
        return self._tc[rel]

    def macro_list(self, gender=1.0, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5, race=None, cup=0.5, firmness=0.5):
        race = race or {'asian': 1 / 3, 'caucasian': 1 / 3, 'african': 1 / 3}
        gen = {'male': gender, 'female': 1 - gender}
        if age < 0.1875:
            ag = {'baby': 1 - age / 0.1875, 'child': age / 0.1875}
        elif age < 0.5:
            k = (age - 0.1875) / (0.5 - 0.1875); ag = {'child': 1 - k, 'young': k}
        else:
            ag = {'young': 1 - (age - 0.5) * 2, 'old': (age - 0.5) * 2}
        mu = _tri(muscle, 'minmuscle', 'averagemuscle', 'maxmuscle')
        we = _tri(weight, 'minweight', 'averageweight', 'maxweight')
        he = {'minheight': max(0.0, (0.5 - height) * 2), 'maxheight': max(0.0, (height - 0.5) * 2)}
        pr = {'uncommonproportions': max(0.0, (0.5 - proportions) * 2), 'idealproportions': max(0.0, (proportions - 0.5) * 2)}
        cu = _tri(cup, 'mincup', 'averagecup', 'maxcup')
        fi = _tri(firmness, 'minfirmness', 'averagefirmness', 'maxfirmness')
        out = []
        for g, gw in gen.items():
            for a, aw in ag.items():
                if gw * aw <= 1e-6:
                    continue
                for r, rw in race.items():
                    out.append((f'macrodetails/{r}-{g}-{a}', gw * aw * rw))
                for m, mw in mu.items():
                    for w, ww in we.items():
                        k = gw * aw * mw * ww
                        if k <= 1e-6:
                            continue
                        out.append((f'macrodetails/universal-{g}-{a}-{m}-{w}', k))
                        for h, hw in he.items():
                            out.append((f'macrodetails/height/{g}-{a}-{m}-{w}-{h}', k * hw))
                        for p, pw in pr.items():
                            out.append((f'macrodetails/proportions/{g}-{a}-{m}-{w}-{p}', k * pw))
                        if g == 'female':
                            for c, cw in cu.items():
                                for f, fw in fi.items():
                                    if c == 'averagecup' and f == 'averagefirmness':
                                        continue
                                    out.append((f'breast/female-{a}-{m}-{w}-{c}-{f}', k * cw * fw))
        return [(n, w) for n, w in out if w > 1e-6]

    def build(self, macros, extra=()):
        """→ P (N,3) meter, kaki di y = 0 (kubus joint-ground)"""
        P = self.V0.copy()
        missing = []
        for name, w in list(self.macro_list(**macros)) + list(extra):
            t = self.target(name)
            if t is None:
                missing.append(name); continue
            P[t[0]] += t[1] * w
        if missing:
            print('  target tidak ada:', missing[:8], '…' if len(missing) > 8 else '')
        P *= SCALE
        P[:, 1] -= P[self.cubes['joint-ground']].mean(axis=0)[1]
        return P

    def joints(self, P):
        return {k[6:]: P[v].mean(axis=0) for k, v in self.cubes.items()}

    def bone_heads(self, P):
        J = self.joints(P)
        out = {}
        for b, d in self.rig.items():
            def pos(e):
                if e.get('strategy') == 'CUBE':
                    return J[e['cube_name'][6:]]
                return P[e['vertex_indices']].mean(axis=0)
            out[b] = (pos(d['head']), pos(d['tail']))
        return out

    # ---------- aset yang diikat ke mesh dasar (.mhclo): pakaian, sepatu, rambut, mata, alis ----------
    def read_mhclo(self, path):
        base = os.path.dirname(path)
        info = {'scales': {}, 'delete': [], 'path': path}
        rows, mode = [], None
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            for line in fh:
                s = line.strip()
                if not s or s[0] == '#':
                    continue
                p = s.split()
                if mode == 'verts' and (p[0].lstrip('-').isdigit()):
                    if len(p) == 1:
                        rows.append((int(p[0]), int(p[0]), int(p[0]), 1.0, 0.0, 0.0, 0.0, 0.0, 0.0))
                    else:
                        rows.append((int(p[0]), int(p[1]), int(p[2]), float(p[3]), float(p[4]), float(p[5]), float(p[6]), float(p[7]), float(p[8])))
                    continue
                if mode == 'delete' and (p[0].isdigit()):
                    i = 0
                    while i < len(p):
                        if i + 2 < len(p) and p[i + 1] == '-':
                            info['delete'].extend(range(int(p[i]), int(p[i + 2]) + 1)); i += 3
                        else:
                            info['delete'].append(int(p[i])); i += 1
                    continue
                # baris kata kunci (boleh muncul di tengah bagian verts, mis. "material" pada beberapa rambut)
                if p[0] == 'verts':
                    mode = 'verts'
                elif p[0] == 'delete_verts':
                    mode = 'delete'
                elif p[0] in ('x_scale', 'y_scale', 'z_scale'):
                    info['scales'][p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
                elif p[0] == 'obj_file':
                    info['obj'] = os.path.join(base, p[1])
                elif p[0] == 'material':
                    info['material'] = os.path.normpath(os.path.join(base, p[1]))
                elif p[0] == 'name':
                    info['name'] = ' '.join(p[1:])
        a = np.array(rows, dtype=np.float64)
        info['idx'] = a[:, :3].astype(np.int64); info['w'] = a[:, 3:6]; info['off'] = a[:, 6:9]
        return info

    def fit(self, info, P, Wsrc=None):
        """posisi aset di atas mesh dasar P (pose asli MakeHuman) + bobot rig hasil interpolasi"""
        i, w = info['idx'], info['w']
        sc = np.ones(3)
        for k, ax in (('x', 0), ('y', 1), ('z', 2)):
            if k in info['scales']:
                a, b, den = info['scales'][k]
                sc[ax] = abs(P[a, ax] - P[b, ax]) / (den * SCALE)
        pos = P[i[:, 0]] * w[:, 0:1] + P[i[:, 1]] * w[:, 1:2] + P[i[:, 2]] * w[:, 2:3] + info['off'] * SCALE * sc
        Wsrc = self.W if Wsrc is None else Wsrc
        wc = np.clip(w, 0, None); wc /= np.maximum(wc.sum(axis=1, keepdims=True), 1e-9)
        Wm = Wsrc[i[:, 0]] * wc[:, 0:1] + Wsrc[i[:, 1]] * wc[:, 1:2] + Wsrc[i[:, 2]] * wc[:, 2:3]
        return pos, Wm.astype(np.float32)

    def asset(self, kind, name, P, Wsrc=None, obj=None):
        folder = os.path.join(self.assets, kind, name)
        mh = [f for f in os.listdir(folder) if f.endswith('.mhclo')]
        info = self.read_mhclo(os.path.join(folder, mh[0]))
        V, UV, F, _ = read_obj(obj or info['obj'])
        pos, Wm = self.fit(info, P, Wsrc)
        if len(pos) != len(V):
            raise RuntimeError(f'{name}: jumlah verteks mhclo {len(pos)} != obj {len(V)}')
        return {'name': name, 'kind': kind, 'pos': pos, 'W': Wm, 'uv': UV, 'faces': F, 'delete': np.array(sorted(set(info['delete'])), dtype=np.int64),
                'material': read_mhmat(info['material']) if info.get('material') and os.path.exists(info['material']) else {}, 'info': info}


def read_mhmat(path):
    out = {'path': path}
    base = os.path.dirname(path)
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            s = line.strip()
            if not s or s[0] in '#/':
                continue
            p = s.split()
            if p[0].endswith('Texture') and len(p) > 1:
                out[p[0]] = os.path.normpath(os.path.join(base, p[1]))
            elif p[0] in ('diffuseColor', 'specularColor') and len(p) >= 4:
                out[p[0]] = tuple(float(x) for x in p[1:4])
            elif p[0] in ('shininess', 'opacity') and len(p) > 1:
                out[p[0]] = float(p[1])
            elif p[0] in ('transparent', 'backfaceCull') and len(p) > 1:
                out[p[0]] = p[1].lower() == 'true'
    return out
