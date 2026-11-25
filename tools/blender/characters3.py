# Karakter v3 (realistis, ber-kulit/skinned) untuk Sutera Royale → web/game/assets/characters/{people3.json, <varian>.glb, *.webp}
#
# Sumber: data MakeHuman (CC0) — mesh dasar hm08 + target morf + rig/bobot (dari arsip ekstensi MPFB, HANYA folder data/),
# dan paket aset sistem MakeHuman (pakaian, sepatu, rambut, kulit, mata, alis; semuanya CC0). Tidak ada add-on yang
# dipasang/dijalankan: semua dibaca oleh tools/blender/mhdata.py. Unduh sekali (simpan di luar repo, ±330 MB):
#   https://extensions.blender.org → MPFB (zip) → ekstrak folder data/                      → --mpfb <…/data>
#   http://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip → --assets <…>
#
# Alur per varian tubuh (VARIANTS: m1, f1, m2, f2):
#   1. bentuk tubuh dari target makro (gender/usia/otot/berat/ras) → skala seragam ke tinggi game (puncak kepala 1,85 m)
#   2. pakaian/sepatu/mata/alis/rambut dipasang lewat ikatan .mhclo; bagian tubuh yang tertutup pakaian dibuang
#   3. RETARGET: mesh dipindah dari pose-A MakeHuman ke pose diam kerangka game (web/map/rig.js: lengan lurus ke bawah;
#      sendi siku/pergelangan/lutut/mata kaki tepat di poros tulang game) memakai bobot rig MakeHuman (game_engine)
#   4. bobot kulit untuk 17 tulang game diturunkan dari bobot MakeHuman (+ pembagian badan/leher menurut tinggi)
#   5. slot warna per verteks (kulit, tangan, atasan, lengan, manset, celana, dalaman, tetap) → diwarnai per karakter di shader
#   6. atlas tekstur dirakit dengan numpy (tanpa bake Cycles): albedo netral, normal, ORM (AO, kekasaran, topeng kulit)
#   7. LOD0–3 (Decimate) → GLB ber-skin (JOINTS_0 = urutan BONES) + rambut (2 LOD) + helm/rompi 1–3 + ransel yang pas di tubuh
#
# Pakai (prioritas rendah bila ada yang sedang main di mesin yang sama):
#   OMP_NUM_THREADS=2 taskpolicy -b nice -n 19 Blender -b -t 2 --factory-startup -P tools/blender/characters3.py -- \
#       --mpfb <…/data> --assets <…/pack> --out web/game/assets/characters --work <folder kerja> \
#       [--only m1,f1] [--stage all|mesh|preview|geo] [--preview <folder png>]
#   --stage all     : peta tekstur + mesh + manifest (lengkap)
#   --stage mesh    : mesh + manifest saja (peta tekstur tidak dihitung ulang)
#   --stage preview : tidak mengekspor; hanya render pratinjau (butuh peta PNG hasil "all" di --work)
#   --stage geo     : render abu-abu geometri pose diam (cek retarget)
# Pratinjau: Cycles CPU 2 thread, 16 sampel, ≤ 800 px.
import bpy, bmesh, sys, os, json, math, struct, time, argparse
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mhdata  # noqa: E402



def parse_args(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--mpfb', required=True)
    ap.add_argument('--assets', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--work', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--stage', default='all')
    ap.add_argument('--preview', default='')
    return ap.parse_args(argv if argv is not None else (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []))


np.set_printoptions(precision=4, suppress=True)
T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


# ---------- Kerangka game (harus sama dengan makeBones() di web/map/rig.js) ----------
BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'armL': 'chest', 'foreL': 'armL', 'handL': 'foreL', 'armR': 'chest',
          'foreR': 'armR', 'handR': 'foreR', 'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}
PIVOT = {'hips': (0, 0.98, 0), 'spine': (0, 1.08, 0), 'chest': (0, 1.28, 0), 'neck': (0, 1.55, 0), 'head': (0, 1.62, 0)}
for s, k in ((1, 'L'), (-1, 'R')):
    PIVOT['arm' + k] = (0.2 * s, 1.49, 0); PIVOT['fore' + k] = (0.2 * s, 1.21, 0); PIVOT['hand' + k] = (0.2 * s, 0.96, 0)
    PIVOT['thigh' + k] = (0.1 * s, 0.93, 0); PIVOT['shin' + k] = (0.1 * s, 0.5, 0); PIVOT['foot' + k] = (0.1 * s, 0.08, 0)
BI = {b: i for i, b in enumerate(BONES)}

# posisi sendi MESH pada pose diam (bahu & pinggul mesh boleh sedikit di bawah/atas poros tulang: lihat catatan proporsi)
HIP_Y, SHOULDER_Y, SHOULDER_X, TOP_Y = 0.945, 1.475, 0.195, 1.85


def nrm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / max(np.linalg.norm(v), 1e-12)


def frame(y, xref):
    y = nrm(y); x = np.asarray(xref, dtype=np.float64); x = nrm(x - y * x.dot(y)); z = np.cross(x, y)
    return np.stack([x, y, z], axis=1)


def rot_axis(axis, ang):
    a = nrm(axis); c, s = math.cos(ang), math.sin(ang); x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


class Aff:
    """x' = L x + t"""
    def __init__(self, L=None, t=None):
        self.L = np.eye(3) if L is None else np.asarray(L, dtype=np.float64)
        self.t = np.zeros(3) if t is None else np.asarray(t, dtype=np.float64)

    @staticmethod
    def about(L, src, dst):
        L = np.asarray(L, dtype=np.float64)
        return Aff(L, np.asarray(dst) - L @ np.asarray(src))

    def __matmul__(self, o):  # self ∘ o
        return Aff(self.L @ o.L, self.L @ o.t + self.t)

    def apply(self, P):
        return P @ self.L.T + self.t


def limb(a, b, A, B, n0, N, radial=1.0):
    F0, F1 = frame(np.subtract(b, a), n0), frame(np.subtract(B, A), N)
    s = np.linalg.norm(np.subtract(B, A)) / np.linalg.norm(np.subtract(b, a))
    return Aff.about(F1 @ np.diag([radial, s, radial]) @ F0.T, a, A)


def limb_min(a, b, A, B, n0, N):
    """rotasi terkecil arah (a→b) ke (A→B) + skala panjang; → (Aff, sudut puntir sisa supaya n0 jatuh di N)"""
    d0, d1 = nrm(np.subtract(b, a)), nrm(np.subtract(B, A))
    ax = np.cross(d0, d1); sn = np.linalg.norm(ax)
    R = rot_axis(ax, math.atan2(sn, float(d0.dot(d1)))) if sn > 1e-9 else np.eye(3)
    s = np.linalg.norm(np.subtract(B, A)) / np.linalg.norm(np.subtract(b, a))
    L = R @ (np.eye(3) + (s - 1) * np.outer(d0, d0))
    n1 = R @ nrm(np.asarray(n0, dtype=np.float64) - d0 * np.dot(n0, d0)); Nn = nrm(np.asarray(N, dtype=np.float64) - d1 * np.dot(N, d1))
    return Aff.about(L, a, A), math.atan2(float(np.dot(np.cross(n1, Nn), d1)), float(np.dot(n1, Nn)))


# ---------- Retarget: pose-A MakeHuman → pose diam kerangka game ----------
class Retarget:
    def __init__(self, mh, P, opts=None):
        """P: mesh dasar (meter, sudah diskala). Menyiapkan transformasi per tulang MakeHuman."""
        o = dict(curl=(0.42, 0.55, 0.35), thumb=(0.12, 0.2, 0.15), sole=0.0, hand_tilt=0.0)
        o.update(opts or {})
        self.mh, self.o = mh, o
        J = mh.joints(P)
        self.J = J
        M, self.twist = {}, {}
        ys, yh = J['l-shoulder'][1], J['l-upper-leg'][1]
        z0 = 0.5 * (J['l-upper-leg'][2] + J['l-shoulder'][2])  # badan digeser supaya bahu & pinggul mengapit z = 0
        st = (SHOULDER_Y - HIP_Y) / (ys - yh)
        self.torso_stretch = st
        torso = Aff(np.diag([1, st, 1]), [0, HIP_Y - st * yh, -z0])
        for b in ('Root', 'pelvis', 'spine_01', 'spine_02', 'spine_03'):
            M[b] = torso
        up = Aff(np.eye(3), [0, SHOULDER_Y - ys, -z0])
        M['neck_01'] = M['head'] = up
        self.z0, self.up = z0, up
        for side, sg in (('l', 1.0), ('r', -1.0)):
            sh, el, ha = J[f'{side}-shoulder'], J[f'{side}-elbow'], J[f'{side}-hand']
            hip, kn, an = J[f'{side}-upper-leg'], J[f'{side}-knee'], J[f'{side}-ankle']
            # tulang selangka: ikut badan, melebar/menyempit supaya sendi bahu jatuh di SHOULDER_X
            sx = SHOULDER_X / abs(sh[0])
            M[f'clavicle_{side}'] = Aff(np.diag([sx, st, 1]), [0, HIP_Y - st * yh, -z0])
            Tsh = np.array([sg * SHOULDER_X, SHOULDER_Y, sh[2] - z0])
            Tel, Twr = np.array(PIVOT['fore' + side.upper()], dtype=np.float64), np.array(PIVOT['hand' + side.upper()], dtype=np.float64)
            u0, f0 = nrm(el - sh), nrm(ha - el)
            n0 = nrm(np.cross(u0, f0))  # sumbu engsel siku (menekuk = memutar + di sekitar n0)
            N = np.array([-1.0, 0, 0])
            M[f'upperarm_{side}'], tw = limb_min(sh, el, Tsh, Tel, n0, N)  # puntiran lengan atas disebar bahu → siku
            self.twist[f'upperarm_{side}'] = (Tsh, Tel, tw, 0.25, 0.7)
            Lf = limb(el, ha, Tel, Twr, n0, N)
            # tangan: arah jari ke bawah, telapak menghadap badan
            k2, k5 = J[f'{side}-finger-2-1'], J[f'{side}-finger-5-1']
            h0 = nrm(0.5 * (J[f'{side}-finger-3-1'] + J[f'{side}-finger-4-1']) - ha)
            p0 = nrm(np.cross(k2 - ha, k5 - ha)) * sg  # normal telapak (keluar dari telapak); kiri/kanan dicerminkan
            # pastikan p0 menunjuk ke sisi telapak: jari menekuk ke arah p0 (ujung jari diam sedikit melengkung ke telapak)
            tip = J[f'{side}-finger-3-4'] - J[f'{side}-finger-3-1']
            if np.dot(tip - h0 * tip.dot(h0), p0) < 0:
                p0 = -p0
            Pn = np.array([-sg, 0.0, 0.0])
            Hd = nrm(rot_axis([1, 0, 0], -o['hand_tilt']) @ np.array([0.0, -1.0, 0.0]))
            F0h, F1h = frame(h0, p0), frame(Hd, Pn)
            Mh = Aff.about(F1h @ F0h.T, ha, Twr)
            M[f'hand_{side}'] = Mh
            # puntiran lengan bawah: beda orientasi telapak antara "ikut lengan bawah" dan target, disebar siku → pergelangan
            pf = Lf.L @ p0; pf = nrm(pf - np.array([0, -1.0, 0]) * pf.dot([0, -1.0, 0]))
            ang = math.atan2(np.dot(np.cross(pf, Pn), [0, -1.0, 0]), np.dot(pf, Pn))
            self.twist[f'lowerarm_{side}'] = (Tel, Twr, ang, 0.12, 0.8)
            M[f'lowerarm_{side}'] = Lf
            # jari: melengkung santai (kaku di game) — rotasi di ruang diam lalu ikut tangan
            for fi, name in ((1, 'thumb'), (2, 'index'), (3, 'middle'), (4, 'ring'), (5, 'pinky')):
                C = Aff()
                for k in (1, 2, 3):
                    j0, j1 = J[f'{side}-finger-{fi}-{k}'], J[f'{side}-finger-{fi}-{k + 1}']
                    d = nrm(j1 - j0)
                    ax = nrm(np.cross(d, p0))
                    a = (o['thumb'] if fi == 1 else o['curl'])[k - 1] * (1.0 + 0.08 * (fi - 3) if fi > 1 else 1.0)
                    C = C @ Aff.about(rot_axis(ax, a), j0, j0)
                    M[f'{name}_0{k}_{side}'] = Mh @ C
            # kaki
            Thip = np.array([sg * 0.1, HIP_Y, hip[2] - z0])
            Tkn, Tan = np.array(PIVOT['shin' + side.upper()], dtype=np.float64), np.array(PIVOT['foot' + side.upper()], dtype=np.float64)
            M[f'thigh_{side}'] = limb(hip, kn, Thip, Tkn, [1, 0, 0], [1, 0, 0])
            M[f'calf_{side}'] = limb(kn, an, Tkn, Tan, [1, 0, 0], [1, 0, 0])
            # telapak kaki: lurus ke depan, tinggi disesuaikan supaya sol tepat di y = 0
            toe = nrm((J[f'{side}-toe-2-4'] - an) * [1, 0, 1])
            yaw = math.atan2(toe[0], toe[2])
            sy = Tan[1] / max(1e-6, an[1] + o['sole'])
            M[f'foot_{side}'] = M[f'ball_{side}'] = Aff.about(np.diag([1, sy, 1]) @ rot_axis([0, 1, 0], -yaw), an, Tan)
        self.M = M
        self.Ls = np.stack([M[b].L for b in mh.bones]); self.ts = np.stack([M[b].t for b in mh.bones])

    def apply(self, pos, W):
        """LBS dengan transformasi afin per tulang MakeHuman (+ puntiran lengan bawah yang disebar)"""
        out = np.zeros_like(pos)
        nz = np.nonzero(W.sum(axis=0) > 0)[0]
        for bi in nz:
            b = self.mh.bones[bi]
            w = W[:, bi]
            sel = np.nonzero(w > 0)[0]
            p = pos[sel] @ self.Ls[bi].T + self.ts[bi]
            if b in self.twist:
                A, B, ang, t0, tl = self.twist[b]
                ax = nrm(B - A); L = np.linalg.norm(B - A)
                t = np.clip(((p - A) @ ax) / L, 0, 1)
                t = np.clip((t - t0) / tl, 0, 1); t = t * t * (3 - 2 * t)
                th = ang * t
                r = p - A; al = (r @ ax)[:, None] * ax; pr = r - al
                c, s = np.cos(th)[:, None], np.sin(th)[:, None]
                p = A + al + pr * c + np.cross(ax, pr) * s
            out[sel] += p * w[sel, None]
        return out

    def our_weights(self, pos1, W):
        """bobot 17 tulang game dari bobot MakeHuman + tinggi verteks pada pose diam (pos1)"""
        mh = self.mh
        col = lambda n: W[:, mh.bi[n]].astype(np.float64)
        O = np.zeros((len(pos1), len(BONES)))
        for side in ('l', 'r'):
            S = side.upper()
            O[:, BI['arm' + S]] = col(f'upperarm_{side}')
            O[:, BI['fore' + S]] = col(f'lowerarm_{side}')
            O[:, BI['hand' + S]] = col(f'hand_{side}') + sum(col(f'{n}_0{k}_{side}') for n in ('thumb', 'index', 'middle', 'ring', 'pinky') for k in (1, 2, 3))
            O[:, BI['thigh' + S]] = col(f'thigh_{side}')
            O[:, BI['shin' + S]] = col(f'calf_{side}')
            O[:, BI['foot' + S]] = col(f'foot_{side}') + col(f'ball_{side}')
        y = pos1[:, 1]
        sm = lambda c, d: (lambda t: t * t * (3 - 2 * t))(np.clip((y - (c - d)) / (2 * d), 0, 1))
        ax = col('Root') + col('pelvis') + col('spine_01') + col('spine_02') + col('spine_03') + col('clavicle_l') + col('clavicle_r')
        s1, s2 = sm(1.08, 0.075), sm(1.28, 0.085)
        O[:, BI['hips']] += ax * (1 - s1)
        O[:, BI['spine']] += ax * (s1 - s1 * s2)
        O[:, BI['chest']] += ax * s1 * s2
        nk = col('neck_01'); hd = sm(1.635, 0.06)  # leher dibagi dada ↔ kepala di sekitar poros kepala (1,62)
        O[:, BI['chest']] += nk * (1 - hd)
        O[:, BI['head']] += nk * hd + col('head')
        tot = O.sum(axis=1, keepdims=True)
        bad = tot[:, 0] < 1e-4
        O[bad, BI['chest']] = 1.0
        O /= np.maximum(O.sum(axis=1, keepdims=True), 1e-9)
        return O.astype(np.float32)


# ---------- Varian tubuh & perakitan bagian ----------
RACE = {'asian': 0.62, 'caucasian': 0.28, 'african': 0.10}
VARIANTS = {
    # pria: jaket di atas kemeja + jins + sepatu bot
    'm1': dict(macros=dict(gender=1.0, age=0.5, muscle=0.66, weight=0.5, height=0.5, proportions=0.62, race=RACE),
               skin='young_asian_male', eyes='brown', brows='eyebrow001', clothes=['male_casualsuit05'], shoes='shoes03', hair=['short02', 'short04']),
    # wanita: kaus + jins + sepatu bot
    'f1': dict(macros=dict(gender=0.0, age=0.5, muscle=0.55, weight=0.42, height=0.5, proportions=0.66, race=RACE, cup=0.42, firmness=0.7),
               skin='young_asian_female', eyes='brown', brows='eyebrow006', clothes=['female_casualsuit01'], shoes='shoes03', hair=['bob01', 'ponytail01']),
    # pria: kaus lengan pendek + jins + sepatu kets
    'm2': dict(macros=dict(gender=1.0, age=0.5, muscle=0.74, weight=0.56, height=0.5, proportions=0.55, race=RACE),
               skin='young_asian_male', eyes='brown', brows='eyebrow003', clothes=['male_casualsuit06'], shoes='shoes02', hair=['short04', 'short02']),
    # wanita: kemeja lengan panjang + jins + sepatu kets
    'f2': dict(macros=dict(gender=0.0, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.6, race=RACE, cup=0.5, firmness=0.65),
               skin='young_asian_female', eyes='brown', brows='eyebrow006', clothes=['male_casualsuit01'], shoes='shoes05', hair=['ponytail01', 'bob01']),
}


def compact(pos, W, uv, faces):
    """buang verteks/uv yang tidak dipakai; faces: list array (k,2) → indeks baru"""
    vi = np.unique(np.concatenate([f[:, 0] for f in faces])); ti = np.unique(np.concatenate([f[:, 1] for f in faces]))
    vm = -np.ones(len(pos), dtype=np.int64); vm[vi] = np.arange(len(vi))
    tm = -np.ones(len(uv), dtype=np.int64); tm[ti] = np.arange(len(ti))
    return pos[vi], W[vi], uv[ti], [np.stack([vm[f[:, 0]], tm[f[:, 1]]], axis=1) for f in faces], vi


def build_variant(mh, key):
    V = VARIANTS[key]
    P = mh.build(V['macros'])
    J = mh.joints(P)
    top = P[:mh.nbody, 1].max()
    k = (TOP_Y - SHOULDER_Y) / (top - J['l-shoulder'][1])
    P *= k
    log(key, f'tinggi asli {top:.3f} m → skala {k:.3f}')
    parts = []
    clothes = [mh.asset('clothes', n, P) for n in V['clothes']] + [mh.asset('clothes', V['shoes'], P)]
    dele = np.zeros(len(P), dtype=bool)
    for c in clothes:
        dele[c['delete']] = True
    body_faces = [f for f, g in zip(mh.F, mh.G) if g == 'body' and not dele[f[:, 0]].all()]
    pos, W, uv, faces, _ = compact(P, mh.W, mh.UV, body_faces)
    skin_mat = mhdata.read_mhmat(os.path.join(mh.assets, 'skins', V['skin'], V['skin'] + '.mhmat'))
    parts.append(dict(name='skin', kind='skin', pos=pos, W=W, uv=uv, faces=faces, mat=skin_mat))
    for c in clothes:
        parts.append(dict(name=c['name'], kind='shoe' if c['name'].startswith('shoes') else 'cloth', pos=c['pos'], W=c['W'], uv=c['uv'], faces=c['faces'], mat=c['material']))
    eyes = mh.asset('eyes', 'low-poly', P)
    eyes['material'] = mhdata.read_mhmat(os.path.join(mh.assets, 'eyes', 'materials', V['eyes'] + '.mhmat'))
    parts.append(dict(name='eyes', kind='eye', pos=eyes['pos'], W=eyes['W'], uv=eyes['uv'], faces=eyes['faces'], mat=eyes['material']))
    br = mh.asset('eyebrows', V['brows'], P)
    parts.append(dict(name='brows', kind='brow', pos=br['pos'], W=br['W'], uv=br['uv'], faces=br['faces'], mat=br['material']))
    for h in V['hair']:
        a = mh.asset('hair', h, P)
        parts.append(dict(name='hair_' + h, kind='hair', pos=a['pos'], W=a['W'], uv=a['uv'], faces=a['faces'], mat=a['material']))
    sole = max(0.0, -min(p['pos'][:, 1].min() for p in parts if p['kind'] == 'shoe'))
    rt = Retarget(mh, P, dict(sole=sole))
    log(key, f'regang badan ×{rt.torso_stretch:.3f}, sol {sole * 100:.1f} cm, puntir lengan atas {math.degrees(rt.twist["upperarm_l"][2]):.0f}°, lengan bawah {math.degrees(rt.twist["lowerarm_l"][2]):.0f}°')
    for p in parts:
        p['rest'] = rt.apply(p['pos'], p['W'])
        p['ow'] = rt.our_weights(p['rest'], p['W'])
    # cek: sendi MakeHuman harus jatuh di poros tulang game
    chk = {'l-elbow': ('lowerarm_l', PIVOT['foreL']), 'l-hand': ('hand_l', PIVOT['handL']), 'l-knee': ('calf_l', PIVOT['shinL']), 'l-ankle': ('foot_l', PIVOT['footL']),
           'r-elbow': ('lowerarm_r', PIVOT['foreR']), 'l-shoulder': ('upperarm_l', (SHOULDER_X, SHOULDER_Y, None)), 'l-upper-leg': ('thigh_l', (0.1, HIP_Y, None))}
    for j, (b, tgt) in chk.items():
        q = rt.M[b].apply(rt.J[j][None])[0]
        err = max(abs(q[i] - tgt[i]) for i in range(3) if tgt[i] is not None)
        if err > 1e-6:
            log('  PERINGATAN sendi', j, q, tgt)
    return dict(key=key, parts=parts, rt=rt, P=P, k=k)


# ---------- Blender: mesh dari bagian (koordinat game → Blender: x, −z, y) ----------
def to_bl(p):
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_object(name, pos, faces, uv=None, color=None):
    me = bpy.data.meshes.new(name)
    vb = to_bl(pos)
    me.from_pydata([tuple(v) for v in vb], [], [tuple(int(i) for i in f[:, 0]) for f in faces])
    if uv is not None:
        ul = me.uv_layers.new(name='src')
        flat = np.concatenate([uv[f[:, 1]] for f in faces]).astype(np.float32)
        ul.data.foreach_set('uv', flat.ravel())
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if color is not None:
        m = bpy.data.materials.new(name + '_m'); m.use_nodes = True
        bs = m.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = (*color, 1); bs.inputs['Roughness'].default_value = 0.7
        me.materials.append(m)
    return ob


def setup_render(w=900, h=900, samples=24):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    wd = bpy.data.worlds.new('w'); sc.world = wd; wd.use_nodes = True
    bg = wd.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.55, 0.6, 0.68, 1); bg.inputs[1].default_value = 0.9
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = 0.05
    so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(52), 0, math.radians(35))
    return sc


def ortho_cam(name, loc, look, scale):
    cam = bpy.data.cameras.new(name); cam.type = 'ORTHO'; cam.ortho_scale = scale
    ob = bpy.data.objects.new(name, cam); bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(look) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


KIND_COL = {'skin': (0.8, 0.55, 0.42), 'cloth': (0.3, 0.35, 0.5), 'shoe': (0.08, 0.08, 0.09), 'eye': (0.9, 0.9, 0.9), 'brow': (0.1, 0.07, 0.05), 'hair': (0.12, 0.09, 0.07)}


def debug_render(var, path, which='rest', hair=0):
    reset_scene()
    sc = setup_render(1500, 900, 16)
    hi = 0
    for p in var['parts']:
        if p['kind'] == 'hair':
            hi += 1
            if hi - 1 != hair:
                continue
        if p['kind'] == 'brow':
            continue
        mesh_object(p['name'], p[which], p['faces'], color=KIND_COL[p['kind']])
    fl = bpy.data.meshes.new('floor'); fl.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('floor', fl); sc.collection.objects.link(fo)
    # tiga pandangan berdampingan: depan, samping, belakang → tiga render digabung dengan kamera berbeda
    outs = []
    for i, (nm, loc) in enumerate((('front', (0, -6, 0.95)), ('side', (6, 0, 0.95)), ('back', (0, 6, 0.95)), ('q', (4, -4.5, 1.2)))):
        cam = ortho_cam(nm, loc, (0, 0, 0.95), 2.05)
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = 520, 900
        sc.render.filepath = path.replace('.png', f'-{nm}.png')
        bpy.ops.render.render(write_still=True)
        outs.append(sc.render.filepath)
    return outs


# ---------- Geometri bantu ----------
def tri_faces(faces):
    out, src = [], []
    for fi, f in enumerate(faces):
        for k in range(1, len(f) - 1):
            out.append(f[[0, k, k + 1]]); src.append(fi)
    return np.array(out, dtype=np.int64).reshape(-1, 3, 2), np.array(src, dtype=np.int64)


def components(n, faces, col=0):
    """label komponen terhubung (lewat indeks kolom col: 0 = posisi, 1 = uv) per face"""
    par = np.arange(n)

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    for f in faces:
        r = find(int(f[0, col]))
        for v in f[1:, col]:
            q = find(int(v))
            if q != r:
                par[q] = r
    lab = np.array([find(int(f[0, col])) for f in faces])
    _, inv = np.unique(lab, return_inverse=True)
    return inv


def face_geo(pos, faces):
    c = np.array([pos[f[:, 0]].mean(axis=0) for f in faces])
    n = np.array([np.cross(pos[f[1, 0]] - pos[f[0, 0]], pos[f[2, 0]] - pos[f[0, 0]]) if len(f) == 3 else np.cross(pos[f[2, 0]] - pos[f[0, 0]], pos[f[3, 0]] - pos[f[1, 0]]) for f in faces])
    ar = np.linalg.norm(n, axis=1) * 0.5
    return c, n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12), ar


def bvh(parts, key, kinds):
    V, F, off = [], [], 0
    for p in parts:
        if p['kind'] not in kinds:
            continue
        V.append(p[key]); F += [tuple(int(i) + off for i in f[:, 0]) for f in p['faces']]; off += len(p[key])
    return BVHTree.FromPolygons([tuple(v) for v in np.concatenate(V)], F)


_HEMI = None


def hemi_dirs():
    global _HEMI
    if _HEMI is None:
        d = [(0, 1, 0)]
        for el, n in ((60, 5), (28, 8)):
            for i in range(n):
                a = 2 * math.pi * (i + 0.5 * (el < 40)) / n
                d.append((math.cos(a) * math.cos(math.radians(el)), math.sin(math.radians(el)), math.sin(a) * math.cos(math.radians(el))))
        _HEMI = np.array(d)
    return _HEMI


def cull_hidden(parts, rings=2, dist=0.14):
    """buang face kulit/pakaian yang tertutup pakaian lain (di pose-A maupun pose diam), sisakan beberapa cincin tepi"""
    trees = {k: bvh(parts, k, ('cloth', 'shoe')) for k in ('pos', 'rest')}
    H = hemi_dirs()
    for p in parts:
        if p['kind'] not in ('skin', 'cloth', 'shoe'):
            continue
        nf = len(p['faces'])
        hidden = np.ones(nf, dtype=bool)
        for key in ('pos', 'rest'):
            c, n, _ = face_geo(p[key], p['faces'])
            t = trees[key]
            for i in range(nf):
                if not hidden[i]:
                    continue
                y = n[i]; x = nrm(np.cross(y, [0.3, 0.5, 0.81])); z = np.cross(x, y)
                o = Vector(c[i] + y * 0.004)
                for d in H:
                    v = x * d[0] + y * d[1] + z * d[2]
                    if t.ray_cast(o, Vector(v), dist)[0] is None:
                        hidden[i] = False; break
        vis = ~hidden
        for _ in range(rings):  # face tersembunyi yang bertetangga dengan yang terlihat tetap disimpan
            vv = np.zeros(len(p['pos']), dtype=bool)
            for f, k in zip(p['faces'], vis):
                if k:
                    vv[f[:, 0]] = True
            vis = np.array([k or vv[f[:, 0]].any() for f, k in zip(p['faces'], vis)])
        keep = [f for f, k in zip(p['faces'], vis) if k]
        before = len(p['faces'])
        pos, W, uv, faces, vi = compact(p['pos'], p['W'], p['uv'], keep)
        p.update(pos=pos, W=W, uv=uv, faces=faces, rest=p['rest'][vi], ow=p['ow'][vi])
        log(f"   cull {p['name']}: {before} → {len(faces)} face")


# ---------- Slot warna (diwarnai per karakter di shader) ----------
SLOTS = ['skin', 'hand', 'top', 'sleeve', 'cuff', 'pants', 'inner', 'fixed']
SI = {n: i for i, n in enumerate(SLOTS)}
ROUGH = {'skin': 0.5, 'hand': 0.55, 'top': 0.86, 'sleeve': 0.86, 'cuff': 0.8, 'pants': 0.9, 'inner': 0.84, 'fixed': 0.5}


def classify(parts):
    for p in parts:
        n = len(p['pos']); ow = p['ow']; y = p['rest'][:, 1]
        fore = ow[:, BI['foreL']] + ow[:, BI['handL']] + ow[:, BI['foreR']] + ow[:, BI['handR']]
        hand = ow[:, BI['handL']] + ow[:, BI['handR']]
        arm = fore + ow[:, BI['armL']] + ow[:, BI['armR']]
        slot = np.full(n, SI['fixed'], dtype=np.int64)
        if p['kind'] == 'skin':
            slot[:] = SI['skin']; slot[hand > 0.5] = SI['hand']
        elif p['kind'] == 'cloth':
            # per PULAU UV (setelan yang menyatu pun punya pulau terpisah untuk atasan/celana/saku/kerah)
            lab = components(len(p['uv']), p['faces'], col=1)
            img = load_img(p['mat']['diffuseTexture'])
            fuv = np.array([p['uv'][f[:, 1]].mean(axis=0) for f in p['faces']])
            fcol = s2l(sample(img, fuv[:, 0], fuv[:, 1])[:, :3])
            fc, fn, far = face_geo(p['rest'], p['faces'])
            # tertutup lapisan lain? (kemeja di bawah jaket): sinar keluar dari tiap face mengenai pulau LAIN dalam 6 cm
            tree = BVHTree.FromPolygons([tuple(v) for v in p['rest']], [tuple(int(i) for i in f[:, 0]) for f in p['faces']])
            covered = np.zeros(len(p['faces']), dtype=bool)
            for i in range(len(p['faces'])):
                o = Vector(fc[i] + fn[i] * 0.002); d = Vector(fn[i]); left = 0.06
                for _ in range(4):
                    loc, _n, fi, dd = tree.ray_cast(o, d, left)
                    if loc is None:
                        break
                    if lab[fi] != lab[i]:
                        covered[i] = True; break
                    o = loc + d * 0.001; left -= dd + 0.001
                    if left <= 0:
                        break
            info = []
            for L in range(lab.max() + 1):
                fm = lab == L
                vi = np.unique(np.concatenate([f[:, 0] for f, k in zip(p['faces'], fm) if k]))
                info.append(dict(L=L, fm=fm, vi=vi, y0=y[vi].min(), y1=y[vi].max(), arms=float((arm[vi] > 0.5).mean()), area=float(far[fm].sum()),
                                 cov=float(far[fm & covered].sum() / max(far[fm].sum(), 1e-9)),
                                 col=(fcol[fm] * far[fm][:, None]).sum(axis=0) / max(far[fm].sum(), 1e-9)))
            legs = [c for c in info if c['y1'] < 1.15 and c['y0'] < 0.8]
            outer = [c for c in info if c['arms'] > 0.3 and c['y1'] > 1.2]
            wmean = lambda cs: sum(c['col'] * c['area'] for c in cs) / max(sum(c['area'] for c in cs), 1e-9) if cs else None
            pc, oc = wmean(legs), wmean(outer)
            if oc is None:
                oc = wmean([c for c in info if c['y1'] > 1.3])
            dist = lambda a, b: 9.0 if b is None else float(np.abs(a - b).max())
            fslot = np.full(len(p['faces']), SI['fixed'], dtype=np.int64)
            for c in info:
                dt_, dp_ = dist(c['col'], oc), dist(c['col'], pc)
                if c in legs:
                    sl_ = 'pants'
                elif c['y1'] >= 1.15:
                    sl_ = 'inner' if (c['cov'] > 0.45 and c['arms'] <= 0.3 and outer) else 'top'
                else:  # pulau kecil di sekitar pinggang: saku, ikat pinggang
                    sl_ = 'fixed' if min(dt_, dp_) > 0.12 else ('top' if dt_ < dp_ else 'pants')
                fslot[c['fm']] = SI[sl_]
            for pri in ('fixed', 'pants', 'inner', 'top'):  # verteks bersama: atasan menang
                for f, k in zip(p['faces'], fslot == SI[pri]):
                    if k:
                        slot[f[:, 0]] = SI[pri]
            log('      pulau → slot:', {n_: int((fslot == SI[n_]).sum()) for n_ in SLOTS if (fslot == SI[n_]).any()})
            top = slot == SI['top']
            sl = top & (fore > 0.5)
            slot[sl] = SI['sleeve']
            for sg in (1, -1):
                m = sl & (p['rest'][:, 0] * sg > 0)
                if m.any() and y[m].min() < 1.06:  # lengan panjang: 3 cm terakhir = manset
                    slot[m & (y < y[m].min() + 0.032)] = SI['cuff']
        p['slot'] = slot


# ---------- Atlas tekstur ----------
RES = 2048


def load_img(path):
    im = bpy.data.images.load(path, check_existing=False)
    im.alpha_mode = 'CHANNEL_PACKED'
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)


def save_img(path, arr):
    h, w = arr.shape[:2]
    a = np.ones((h, w, 4), dtype=np.float32); a[:, :, :arr.shape[2]] = arr
    im = bpy.data.images.new('out', w, h, alpha=arr.shape[2] == 4)
    im.pixels.foreach_set(np.clip(a, 0, 1).ravel())
    im.filepath_raw = path; im.file_format = 'PNG'
    sc = bpy.context.scene
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA' if arr.shape[2] == 4 else 'RGB'; sc.render.image_settings.compression = 20
    sc.view_settings.view_transform = 'Standard'
    im.save_render(path, scene=sc) if False else im.save()
    bpy.data.images.remove(im)


def sample(img, u, v):
    h, w = img.shape[:2]
    x = np.clip(u * w - 0.5, 0, w - 1.001); y = np.clip(v * h - 0.5, 0, h - 1.001)
    x0 = x.astype(np.int64); y0 = y.astype(np.int64); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    return (img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx) * (1 - fy) + (img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx) * fy


def s2l(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def island_prio(p, vi):
    q = p['rest'][vi]
    if p['kind'] == 'skin':
        return 2.0 if q[:, 1].mean() > 1.5 else 1.25
    if p['kind'] == 'eye':
        return 2.6
    if p['kind'] == 'shoe':
        return 0.85
    return 1.0


def build_atlas(parts, res=RES, margin=10):
    """tata letak atlas: tiap pulau UV sumber digeser + diskala seragam (tanpa rotasi → peta normal tetap sah)"""
    isl = []
    for pi, p in enumerate(parts):
        if p['kind'] not in ('skin', 'cloth', 'shoe', 'eye'):
            continue
        tris, src = tri_faces(p['faces'])
        lab = components(len(p['uv']), p['faces'], col=1)[src]
        P3 = p['rest'][tris[:, :, 0]]; U = p['uv'][tris[:, :, 1]]
        a3 = 0.5 * np.linalg.norm(np.cross(P3[:, 1] - P3[:, 0], P3[:, 2] - P3[:, 0]), axis=1)
        e1, e2 = U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]
        au = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
        p['tris'], p['tri_isl'] = tris, np.zeros(len(tris), dtype=np.int64)
        for L in range(lab.max() + 1):
            m = lab == L
            if au[m].sum() < 1e-12 or a3[m].sum() < 1e-9:
                continue
            uvs = U[m].reshape(-1, 2)
            lo, hi = uvs.min(axis=0), uvs.max(axis=0)
            sc = math.sqrt(a3[m].sum() / au[m].sum()) * island_prio(p, np.unique(tris[m][:, :, 0]))
            p['tri_isl'][m] = len(isl)
            isl.append(dict(part=pi, lo=lo, size=(hi - lo) * sc, sc=sc))
    order = sorted(range(len(isl)), key=lambda i: -isl[i]['size'][1])

    def pack(L):
        mg = margin * L / res
        x = y = mg; row = 0.0
        for i in order:
            w, h = isl[i]['size']
            if w + 2 * mg > L:
                return False
            if x + w + mg > L:
                x = mg; y += row + mg; row = 0.0
            if y + h + mg > L:
                return False
            isl[i]['org'] = (x, y); x += w + mg; row = max(row, h)
        return True
    lo, hi = 0.2, 8.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if pack(mid):
            hi = mid
        else:
            lo = mid
    pack(hi)
    for p in parts:
        if 'tris' not in p or p['kind'] not in ('skin', 'cloth', 'shoe', 'eye'):
            continue
        # uv atlas per sudut segitiga
        A = np.zeros((len(p['tris']), 3, 2))
        for ii in np.unique(p['tri_isl']):
            I = isl[ii]; m = p['tri_isl'] == ii
            A[m] = ((p['uv'][p['tris'][m][:, :, 1]] - I['lo']) * I['sc'] + I['org']) / hi
        p['auv'] = A
    log(f'   atlas: {len(isl)} pulau, sisi {hi:.3f} m → {hi / res * 1000:.2f} mm/texel')
    return hi


def raster(parts, res=RES):
    """peta id segitiga + barisentrik per texel"""
    tid = -np.ones((res, res), dtype=np.int64); bar = np.zeros((res, res, 2), dtype=np.float32); pid = -np.ones((res, res), dtype=np.int16)
    base = 0
    for pi, p in enumerate(parts):
        if 'auv' not in p:
            continue
        p['tri_base'] = base
        A = p['auv'] * res
        for ti in range(len(A)):
            a, b, c = A[ti]
            x0 = max(int(math.floor(min(a[0], b[0], c[0]) - 1)), 0); x1 = min(int(math.ceil(max(a[0], b[0], c[0]) + 1)), res - 1)
            y0 = max(int(math.floor(min(a[1], b[1], c[1]) - 1)), 0); y1 = min(int(math.ceil(max(a[1], b[1], c[1]) + 1)), res - 1)
            if x1 < x0 or y1 < y0:
                continue
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            w0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den
            w1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den
            w2 = 1 - w0 - w1
            # toleransi ±0,75 texel di tiap sisi (jarak ke sisi = w · tinggi segitiga)
            la, lb, lc = np.linalg.norm(b - c), np.linalg.norm(c - a), np.linalg.norm(a - b)
            ar2 = abs(den)
            m = (w0 >= -0.75 * la / ar2) & (w1 >= -0.75 * lb / ar2) & (w2 >= -0.75 * lc / ar2)
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            sub = tid[y0:y1 + 1, x0:x1 + 1]
            m &= inside | (sub < 0)  # tepi longgar hanya mengisi texel kosong
            if not m.any():
                continue
            sub[m] = base + ti
            bar[y0:y1 + 1, x0:x1 + 1, 0][m] = w0[m]; bar[y0:y1 + 1, x0:x1 + 1, 1][m] = w1[m]
            pid[y0:y1 + 1, x0:x1 + 1][m] = pi
        base += len(A)
    return tid, bar, pid


def dilate(img, mask, n=8):
    img = img.copy(); mask = mask.copy()
    for _ in range(n):
        acc = np.zeros_like(img); cnt = np.zeros(mask.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sm = np.roll(mask, (dy, dx), axis=(0, 1)); si = np.roll(img, (dy, dx), axis=(0, 1))
            acc += si * sm[..., None]; cnt += sm
        new = (~mask) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        mask |= new
    return img


def head_metrics(var):
    """elipsoid tengkorak pada pose diam → (puncak, setengah lebar, pusat z, setengah dalam, pusat y)"""
    skin = next(p for p in var['parts'] if p['kind'] == 'skin')
    H = skin['rest'][skin['ow'][:, BI['head']] > 0.95]
    top = H[:, 1].max()
    cr = H[H[:, 1] > top - 0.10]
    return top, np.abs(cr[:, 0]).max(), 0.5 * (cr[:, 2].min() + cr[:, 2].max()), 0.5 * (cr[:, 2].max() - cr[:, 2].min()), top - 0.112


def mark_scalp(var):
    """bobot 'kulit kepala berambut' per verteks kulit: di atas garis rambut (dahi tinggi, pelipis di atas telinga, tengkuk rendah)"""
    top, a, zc, b, yc = head_metrics(var)
    skin = next(p for p in var['parts'] if p['kind'] == 'skin')
    P = skin['rest']
    th = np.arctan2(P[:, 0], P[:, 2] - zc); c = np.cos(th)
    front, side, back = yc + 0.058, yc + 0.004, yc - 0.078
    line = np.where(c >= 0, side + (front - side) * np.clip(c, 0, 1) ** 1.3, side + (back - side) * np.clip(-c, 0, 1) ** 0.8)
    t = np.clip((P[:, 1] - (line - 0.004)) / 0.016, 0, 1)
    skin['scalp'] = (t * t * (3 - 2 * t)) * (skin['ow'][:, BI['head']] > 0.5)


def compose(var, res=RES):
    parts = var['parts']
    tid, bar, pid = raster(parts, res)
    cov = tid >= 0
    alb = np.zeros((res, res, 3), dtype=np.float32); nor = np.zeros((res, res, 3), dtype=np.float32); nor[:] = (0.5, 0.5, 1.0)
    ao = np.ones((res, res), dtype=np.float32); rough = np.full((res, res), 0.8, dtype=np.float32); slotmap = -np.ones((res, res), dtype=np.int16)
    skinm = np.zeros((res, res), dtype=np.float32); scalp = np.zeros((res, res), dtype=np.float32)
    ys, xs = np.nonzero(cov)
    for pi, p in enumerate(parts):
        if 'auv' not in p:
            continue
        sel = pid[ys, xs] == pi
        if not sel.any():
            continue
        y, x = ys[sel], xs[sel]
        t = tid[y, x] - p['tri_base']; b0 = bar[y, x, 0][:, None]; b1 = bar[y, x, 1][:, None]; b2 = 1 - b0 - b1
        U = p['uv'][p['tris'][t][:, :, 1]]
        uv = U[:, 0] * b0 + U[:, 1] * b1 + U[:, 2] * b2
        mat = p['mat']
        d = load_img(mat['diffuseTexture'])
        alb[y, x] = s2l(sample(d, uv[:, 0], uv[:, 1])[:, :3])
        if mat.get('normalmapTexture') and os.path.exists(mat['normalmapTexture']):
            nor[y, x] = sample(load_img(mat['normalmapTexture']), uv[:, 0], uv[:, 1])[:, :3]
        if mat.get('aomapTexture') and os.path.exists(mat['aomapTexture']):
            ao[y, x] = sample(load_img(mat['aomapTexture']), uv[:, 0], uv[:, 1])[:, 0]
        sl = p['slot'][p['tris'][t][:, :, 0]]
        # slot texel = slot sudut berbobot terbesar
        w = np.concatenate([b0, b1, b2], axis=1); s = sl[np.arange(len(sl)), np.argmax(w, axis=1)]
        slotmap[y, x] = s
        r = np.array([ROUGH[n] for n in SLOTS])[s]
        if p['kind'] == 'eye':
            r[:] = 0.07
        elif p['kind'] == 'shoe':
            r[:] = 0.46
        rough[y, x] = r
        if p['kind'] == 'skin':
            skinm[y, x] = 1.0
            if 'scalp' in p:
                scalp[y, x] = (p['scalp'][p['tris'][t][:, :, 0]] * w).sum(axis=1)
    var['maps'] = dict(alb=alb, nor=nor, ao=ao, rough=rough, slot=slotmap, cov=cov, skin=skinm, scalp=scalp, tid=tid, bar=bar, pid=pid)
    return var['maps']


C_NEUTRAL = 0.5  # albedo netral disimpan × 0,5 (linear); shader mengalikan warna slot / 0,5


def finish_maps(var, out_prefix, res=RES):
    M = var['maps']; alb, slot, cov = M['alb'].copy(), M['slot'], M['cov']
    lum = alb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    stats = {}
    sk = (slot == SI['skin']) | (slot == SI['hand'])
    if sk.any():
        ls = lum[sk]; lo, hi = np.percentile(ls, [45, 92])  # hanya kulit terang-sedang: rambut kepala, alis & lipatan tidak ikut
        mean = alb[sk][(ls >= lo) & (ls <= hi)].mean(axis=0); stats['skin'] = [float(v) for v in mean]
        alb[sk] = alb[sk] / mean * C_NEUTRAL
        # kulit kepala di bawah rambut: gelap seperti rambut cepak (terlihat di sela kartu rambut & di bawah helm)
        sc = M['scalp'][..., None] * (0.82 + 0.18 * np.random.default_rng(7).random(M['scalp'].shape)[..., None])
        dark = np.minimum(alb, C_NEUTRAL * 1.1) * np.array([0.30, 0.27, 0.26], dtype=np.float32)
        alb = np.where(sk[..., None], alb * (1 - sc) + dark * sc, alb)
    for n in ('top', 'sleeve', 'cuff', 'pants', 'inner'):
        m = slot == SI[n]
        if not m.any():
            continue
        base = (slot == SI['top']) | (slot == SI['sleeve']) | (slot == SI['cuff']) if n in ('top', 'sleeve', 'cuff') else m
        ml = float(lum[base].mean()); stats[n] = ml
        alb[m] = (lum[m] / ml * C_NEUTRAL)[:, None]
    fx = slot == SI['fixed']
    alb[fx] *= C_NEUTRAL
    alb = dilate(np.clip(alb, 0, 1), cov, 10)
    nor = dilate(M['nor'], cov, 10)
    rough = M['rough'] * (1 - M['scalp']) + 0.72 * M['scalp']
    orm = np.stack([M['ao'], rough, M['skin'] * (1 - M['scalp'])], axis=2)
    orm = dilate(orm, cov, 10)
    save_img(out_prefix + '_albedo.png', l2s(alb))
    save_img(out_prefix + '_normal.png', nor)
    save_img(out_prefix + '_orm.png', orm)
    var['stats'] = stats
    log('   peta disimpan', out_prefix, stats)


# ---------- Alis: kartu alfa diproyeksikan ke atlas kulit ----------
def composite_brows(var, res=RES):
    parts = var['parts']; M = var['maps']
    skin = next(p for p in parts if p['kind'] == 'skin'); brow = next((p for p in parts if p['kind'] == 'brow'), None)
    if brow is None:
        return
    tris = skin['tris']
    tree = BVHTree.FromPolygons([tuple(v) for v in skin['rest']], [tuple(int(i) for i in t[:, 0]) for t in tris])
    # uv atlas kulit di tiap verteks alis = titik terdekat di permukaan kulit
    auv = np.zeros((len(brow['rest']), 2))
    for i, v in enumerate(brow['rest']):
        loc, _, fi, _ = tree.find_nearest(Vector(v))
        a, b, c = skin['rest'][tris[fi][:, 0]]
        v0, v1, v2 = b - a, c - a, np.array(loc) - a
        d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
        den = d00 * d11 - d01 * d01
        w1 = (d11 * d20 - d01 * d21) / den; w2 = (d00 * d21 - d01 * d20) / den
        auv[i] = skin['auv'][fi][0] * (1 - w1 - w2) + skin['auv'][fi][1] * w1 + skin['auv'][fi][2] * w2
    img = load_img(brow['mat']['diffuseTexture'])
    bt, _ = tri_faces(brow['faces'])
    alb = M['alb']
    for t in bt:
        A = auv[t[:, 0]] * res; U = brow['uv'][t[:, 1]]
        a, b, c = A
        x0, x1 = int(math.floor(A[:, 0].min())), int(math.ceil(A[:, 0].max())); y0, y1 = int(math.floor(A[:, 1].min())), int(math.ceil(A[:, 1].max()))
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12 or x1 - x0 > 400 or y1 - y0 > 400:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den; w1 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den; w2 = 1 - w0 - w1
        m = (w0 >= -1e-3) & (w1 >= -1e-3) & (w2 >= -1e-3)
        if not m.any():
            continue
        uv = U[0] * w0[m][:, None] + U[1] * w1[m][:, None] + U[2] * w2[m][:, None]
        tx = sample(img, uv[:, 0], uv[:, 1])
        al = np.clip(tx[:, 3] * 0.92, 0, 1)[:, None]
        yy, xx = Y[m].astype(np.int64), X[m].astype(np.int64)
        alb[yy, xx] = alb[yy, xx] * (1 - al) + np.array([0.012, 0.009, 0.007], dtype=np.float32) * al  # alis gelap apa pun warna kulitnya
    log('   alis diproyeksikan')


# ---------- LOD (Decimate) ----------
LOD_TARGET = {  # jumlah segitiga per jenis bagian: (lod0, lod1, lod2, lod3 = jauh); lengan telanjang menambah jatah 'hand'
    'head': (3500, 1250, 310, 64), 'hand': (1500, 400, 130, 24), 'cloth': (4300, 1500, 520, 124), 'shoe': (1300, 400, 140, 28), 'eye': (172, 86, 0, 0),
}
ARM_EXTRA = (7000, 2200, 700, 110)  # segitiga per m² kulit di luar tangan (lengan baju pendek)
NLOD = 4
HAIR_TARGET = (2200, 600)


def vnormals(pos, tris):
    """normal halus per verteks posisi (berbobot luas)"""
    n = np.zeros_like(pos)
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, tris[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def decimate(name, pos, tri, luv, ratio, weights=None):
    """Decimate (collapse) pada mesh terlas; uv atlas disimpan per sudut (jahitan UV ditangani Blender).
    → (pos, tri (n,3) indeks verteks, luv (n,3,2))"""
    if ratio >= 0.999:
        return pos, tri, luv
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in to_bl(pos)], [], [tuple(int(i) for i in t) for t in tri])
    ul = me.uv_layers.new(name='atlas')
    ul.data.foreach_set('uv', luv.reshape(-1, 2).astype(np.float32).ravel())
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new('dec', 'DECIMATE'); md.decimate_type = 'COLLAPSE'; md.ratio = ratio; md.use_collapse_triangulate = True
    if weights is not None:
        vg = ob.vertex_groups.new(name='w')
        for i, w in enumerate(weights):
            if w > 0.001:
                vg.add([i], float(w), 'REPLACE')
        md.vertex_group = 'w'; md.vertex_group_factor = 1.0; md.invert_vertex_group = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg); m2 = ev.to_mesh()
    m2.calc_loop_triangles()
    nv, nl, nt = len(m2.vertices), len(m2.loops), len(m2.loop_triangles)
    co = np.empty(nv * 3, dtype=np.float32); m2.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    lv = np.empty(nl, dtype=np.int32); m2.loops.foreach_get('vertex_index', lv)
    uvs = np.empty(nl * 2, dtype=np.float32); m2.uv_layers['atlas'].data.foreach_get('uv', uvs); uvs = uvs.reshape(-1, 2)
    tl = np.empty(nt * 3, dtype=np.int32); m2.loop_triangles.foreach_get('loops', tl)
    out_tri = lv[tl].reshape(-1, 3).astype(np.int64); out_uv = uvs[tl].reshape(-1, 3, 2).astype(np.float64)
    pos2 = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1).astype(np.float64)
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return pos2, out_tri, out_uv


def transfer(p, tree, T, hn, pos2):
    """atribut verteks hasil decimate diambil dari titik terdekat di mesh penuh bagian itu"""
    P = p['rest']
    n = len(pos2)
    ow = np.zeros((n, p['ow'].shape[1]), dtype=np.float32); nor = np.zeros((n, 3)); slot = np.zeros(n, dtype=np.int64)
    for i, v in enumerate(pos2):
        loc, _, fi, _ = tree.find_nearest(Vector(v))
        ga, gb, gc = T[fi]
        a, b, c = P[ga], P[gb], P[gc]
        v0, v1, v2 = b - a, c - a, np.array(loc) - a
        d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
        den = max(d00 * d11 - d01 * d01, 1e-18)
        w1 = (d11 * d20 - d01 * d21) / den; w2 = (d00 * d21 - d01 * d20) / den; w0 = 1 - w1 - w2
        ow[i] = p['ow'][ga] * w0 + p['ow'][gb] * w1 + p['ow'][gc] * w2
        nor[i] = hn[ga] * w0 + hn[gb] * w1 + hn[gc] * w2
        slot[i] = p['slot'][(ga, gb, gc)[int(np.argmax((w0, w1, w2)))]]
    return ow, nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-12), slot


def to_gl(pos, tri, luv, attrs):
    """verteks GL = pasangan unik (verteks, uv); attrs: dict array per verteks posisi"""
    q = np.round(luv.reshape(-1, 2) * 16384).astype(np.int64)
    key = tri.ravel() * (1 << 30) + q[:, 0] * (1 << 15) + q[:, 1]
    _, first, inv = np.unique(key, return_index=True, return_inverse=True)
    vi = tri.ravel()[first]
    out = dict(pos=pos[vi], uv=luv.reshape(-1, 2)[first], tri=inv.reshape(-1, 3))
    for k, a in attrs.items():
        out[k] = a[vi]
    return out


def build_lods(var):
    """→ list LOD; tiap LOD = dict(pos, nor, uv, ow, slot, tri) gabungan semua bagian tubuh"""
    lods = [[] for _ in range(NLOD)]
    for p in var['parts']:
        if 'auv' not in p:
            continue
        T = p['tris'][:, :, 0]; P = p['rest']
        hn = vnormals(P, T)
        tree = BVHTree.FromPolygons([tuple(v) for v in P], [tuple(int(i) for i in t) for t in T])
        groups = [(p['kind'], np.ones(len(T), dtype=bool), None)]
        if p['kind'] == 'skin':  # kepala & tangan dipisah (rasio berbeda); wajah depan + telinga dilindungi
            ishead = P[T].mean(axis=1)[:, 1] > 1.3
            z = P[:, 2]; y = P[:, 1]
            prot = np.clip((z - 0.0) / 0.07, 0, 1) * np.clip((y - 1.6) / 0.03, 0, 1) * np.clip((1.80 - y) / 0.03, 0, 1)
            groups = [('head', ishead, 1 - 0.7 * prot), ('hand', ~ishead, None)]
        for kind, tm, wts in groups:
            if not tm.any():
                continue
            used = np.unique(T[tm]); rm = -np.ones(len(P), dtype=np.int64); rm[used] = np.arange(len(used))
            sp, st, su = P[used], rm[T[tm]], p['auv'][tm]
            a3 = P[T[tm]]; area = float((0.5 * np.linalg.norm(np.cross(a3[:, 1] - a3[:, 0], a3[:, 2] - a3[:, 0]), axis=1)).sum())
            for li in range(NLOD):
                tgt = LOD_TARGET[kind][li] + (ARM_EXTRA[li] * max(0.0, area - 0.11) if kind == 'hand' else 0)
                r = min(1.0, tgt / len(st))
                if r <= 0:
                    continue
                dp, dtri, duv = decimate(f"{p['name']}_{kind}_{li}", sp, st, su, r, None if wts is None else wts[used])
                ow, nor, slot = transfer(p, tree, T, hn, dp)
                G = to_gl(dp, dtri, duv, dict(ow=ow, nor=nor, slot=slot))
                G['kind'] = kind
                lods[li].append(G)
    out = []
    for li, chunks in enumerate(lods):
        off = 0; tri = []
        for c in chunks:
            tri.append(c['tri'] + off); off += len(c['pos'])
        L = dict(pos=np.concatenate([c['pos'] for c in chunks]), nor=np.concatenate([c['nor'] for c in chunks]), uv=np.concatenate([c['uv'] for c in chunks]),
                 ow=np.concatenate([c['ow'] for c in chunks]), slot=np.concatenate([c['slot'] for c in chunks]), tri=np.concatenate(tri))
        log(f"   LOD{li}: {len(L['pos'])} verteks, {len(L['tri'])} segitiga  (" + ', '.join(f"{c['kind']} {len(c['tri'])}" for c in chunks) + ')')
        out.append(L)
    return out


# ---------- Perlengkapan kaku (helm, rompi, ransel): dibentuk mengikuti tubuh tiap varian ----------
def lin(hexs):
    h = hexs.lstrip('#'); return s2l(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]))


class GearMesh:
    def __init__(self):
        self.P, self.N, self.C, self.T, self.n = [], [], [], [], 0

    def grid(self, pts, color, mask=None, wrap=False):
        """pts (m, n, 3): baris × kolom; normal halus; mask (m−1, n[−1]) sel yang ada; wrap = kolom menyambung"""
        m, n = pts.shape[:2]
        P = pts.reshape(-1, 3); tri = []
        nc = n if wrap else n - 1
        for i in range(m - 1):
            for j in range(nc):
                if mask is not None and not mask[i][j]:
                    continue
                a, b, c, d = i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j
                tri += [(a, b, c), (a, c, d)]
        if not tri:
            return
        tri = np.array(tri)
        N = vnormals(P, tri)
        col = np.broadcast_to(np.asarray(color, dtype=np.float64), (len(P), 3)) if np.ndim(color) == 1 else np.asarray(color).reshape(-1, 3)
        self.P.append(P); self.N.append(N); self.C.append(col); self.T.append(tri + self.n); self.n += len(P)

    def box(self, c, ax, ay, az, color, taper=1.0):
        """kotak (normal rata per sisi): pusat c, setengah-sumbu ax, ay, az; taper mengecilkan sisi +az"""
        c, ax, ay, az = (np.asarray(v, dtype=np.float64) for v in (c, ax, ay, az))
        V = [c + sx * ax * (taper if sz > 0 else 1) + sy * ay * (taper if sz > 0 else 1) + sz * az for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
        F = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        for f in F:
            q = np.array([V[k] for k in f]); nn = nrm(np.cross(q[1] - q[0], q[3] - q[0]))
            if np.dot(nn, q.mean(axis=0) - c) < 0:
                q = q[::-1]; nn = -nn
            self.P.append(q); self.N.append(np.tile(nn, (4, 1))); self.C.append(np.tile(np.asarray(color, dtype=np.float64), (4, 1)))
            self.T.append(np.array([(0, 1, 2), (0, 2, 3)]) + self.n); self.n += 4

    def ribbon(self, path, normals, width, color, thick=0.004):
        """pita mengikuti jalur (k, 3) dengan normal permukaan; dua sisi (atas + tepi)"""
        path, normals = np.asarray(path), np.asarray(normals)
        tang = np.gradient(path, axis=0); tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
        side = np.cross(normals, tang); side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-9)
        top = path + normals * thick
        rows = np.stack([path - side * width * 0.5, top - side * width * 0.5, top + side * width * 0.5, path + side * width * 0.5], axis=1)  # (k, 4, 3)
        self.grid(rows, color)

    def result(self):
        return np.concatenate(self.P), np.concatenate(self.N), np.concatenate(self.C), np.concatenate(self.T)


def body_probe(var):
    """→ (BVH permukaan tubuh+pakaian pose diam, fungsi proyeksi titik ke permukaan + jarak)"""
    V, F, off = [], [], 0
    for p in var['parts']:
        if p['kind'] not in ('skin', 'cloth'):
            continue
        V.append(p['rest']); F += [tuple(int(i) + off for i in f[:, 0]) for f in p['faces']]; off += len(p['rest'])
    V = np.concatenate(V)
    tree = BVHTree.FromPolygons([tuple(v) for v in V], F)

    def onto(pts, lift, ref=None):
        out, nor = [], []
        for q in pts:
            loc, n, _, _ = tree.find_nearest(Vector(q))
            loc = np.array(loc); n = np.array(n)
            d = np.asarray(q) - loc
            if np.linalg.norm(d) > 1e-6 and np.dot(d, n) < 0:
                n = -n
            if ref is not None and np.dot(n, np.asarray(q) - ref) < 0:  # normal harus menjauhi sumbu tubuh
                n = -n
            out.append(loc + n * lift); nor.append(n)
        return np.array(out), np.array(nor)
    return tree, onto


def torso_rings(var, ys, nb=48):
    """profil radial badan (tanpa lengan) di tiap tinggi ys → (pusat z, r[k][j]); sudut 0 = depan (+z), + ke arah +x"""
    P, O = [], []
    for p in var['parts']:
        if p['kind'] in ('skin', 'cloth'):
            P.append(p['rest']); O.append(p['ow'])
    P = np.concatenate(P); O = np.concatenate(O)
    arms = O[:, [BI[b] for b in ('armL', 'foreL', 'handL', 'armR', 'foreR', 'handR')]].sum(axis=1)
    P = P[arms < 0.35]
    zc = np.zeros(len(ys)); R = np.zeros((len(ys), nb))
    for k, y in enumerate(ys):
        q = P[np.abs(P[:, 1] - y) < 0.028]
        q = q[np.abs(q[:, 0]) < 0.24]
        zc[k] = 0.5 * (q[:, 2].min() + q[:, 2].max())
        th = np.arctan2(q[:, 0], q[:, 2] - zc[k]); rr = np.hypot(q[:, 0], q[:, 2] - zc[k])
        b = np.floor((th + math.pi) / (2 * math.pi) * nb).astype(int) % nb
        r = np.zeros(nb)
        np.maximum.at(r, b, rr)
        for _ in range(3):  # isi bin kosong dari tetangga
            e = r <= 0
            if not e.any():
                break
            r[e] = np.maximum(np.roll(r, 1), np.roll(r, -1))[e]
        R[k] = r
    zc = np.convolve(np.pad(zc, 1, mode='edge'), [0.25, 0.5, 0.25], mode='valid')
    for _ in range(2):
        R = (np.roll(R, 1, axis=1) + 2 * R + np.roll(R, -1, axis=1)) / 4
        R = np.concatenate([R[:1], (R[:-2] + 2 * R[1:-1] + R[2:]) / 4, R[-1:]])
    # bin j ↔ sudut: th = −π + (j + 0,5)·2π/nb
    return zc, R


def build_gear(var):
    """→ list dict(name, bone, tint, P, N, C, T) pada pose diam"""
    out = []
    tree, onto = body_probe(var)
    skin = next(p for p in var['parts'] if p['kind'] == 'skin')
    H = skin['rest'][skin['ow'][:, BI['head']] > 0.95]
    top, a, zc, b, yc = head_metrics(var)
    crv = 0.112
    DARK, STRAP = lin('#1c1d20'), lin('#26272b')
    # ---- helm
    HELM = {1: dict(col=lin('#b8a98a'), band=lin('#3a3528'), t=0.017, low=0.022, rise=0.060, peak=True),
            2: dict(col=lin('#4c5340'), band=lin('#2e3327'), t=0.021, low=0.048, rise=0.088, rails=True, strap=True),
            3: dict(col=lin('#2b2d31'), band=lin('#17181b'), t=0.025, low=0.070, rise=0.108, rails=True, strap=True, goggles=True)}
    for lv, hp in HELM.items():
        g = GearMesh(); t = hp['t']; nt, nr = 36, 9
        th = (np.arange(nt) + 0.5) / nt * 2 * math.pi - math.pi  # 0 = depan
        wf = np.clip(np.cos(th), 0, 1) ** 1.5
        yb = yc - hp['low'] + hp['rise'] * wf
        ph_max = np.arccos(np.clip((yb - yc) / (crv + t), -1, 1))
        rows = np.zeros((nr, nt, 3)); cols = np.zeros((nr, nt, 3))
        for i in range(nr):
            ph = ph_max * (i / (nr - 1)) if i else np.full(nt, 0.02)
            rows[i, :, 0] = (a + t) * np.sin(ph) * np.sin(th); rows[i, :, 1] = yc + (crv + t) * np.cos(ph); rows[i, :, 2] = zc + (b + t) * np.sin(ph) * np.cos(th)
            cols[i] = hp['band'] if i == nr - 1 else hp['col']
        g.grid(rows, cols.reshape(-1, 3), wrap=True)
        rim = np.stack([rows[-1], rows[-1] * [1, 1, 1]], axis=0)  # tepi: cincin luar → cincin dalam (tebal helm)
        rim[1, :, 0] = (a + t - 0.013) / (a + t) * rows[-1, :, 0]; rim[1, :, 2] = zc + (b + t - 0.013) / (b + t) * (rows[-1, :, 2] - zc); rim[1, :, 1] -= 0.002
        g.grid(rim, hp['band'], wrap=True)
        if hp.get('peak'):  # lidah depan
            sel = np.abs(th) < 0.75
            pk = np.stack([rows[-1][sel], rows[-1][sel] + np.stack([np.sin(th[sel]) * 0.02, np.full(sel.sum(), -0.008), np.cos(th[sel]) * 0.038], axis=1) * (np.cos(th[sel] * 2.0)[:, None] * 0.5 + 0.5)], axis=0)
            g.grid(pk, hp['band']); g.grid(pk[::-1], hp['band'])
        if hp.get('rails'):
            for sx in (1, -1):
                g.box([sx * (a + t + 0.004), yc - 0.012, zc - 0.01], [0.006, 0, 0], [0, 0.012, 0], [0, 0, 0.045], DARK)
            g.box([0, yc + (crv + t) * 0.52, zc + (b + t) * 0.86], [0.022, 0, 0], [0, 0.016, 0.009], [0, -0.006, 0.01], DARK)
        if hp.get('goggles'):
            for sx in (1, -1):
                g.box([sx * 0.036, yc + (crv + t) * 0.36, zc + (b + t) * 0.955], [0.028, 0, 0], [0, 0.02, 0.006], [0, -0.004, 0.012], lin('#0c0d10'))
            g.box([0, yc + (crv + t) * 0.36, zc + (b + t) * 0.95], [0.07, 0, 0], [0, 0.007, 0.002], [0, -0.002, 0.008], STRAP)
        if hp.get('strap'):  # tali dagu: telinga kiri → bawah dagu → telinga kanan, menempel di kulit
            jaw = H[(H[:, 2] > zc + 0.02) & (np.abs(H[:, 0]) < 0.03)]
            chin = np.array([0, jaw[:, 1].min() - 0.004, jaw[jaw[:, 1] < jaw[:, 1].min() + 0.012][:, 2].mean() - 0.012])
            ear = np.array([a + 0.004, yc - hp['low'] + 0.006, zc + 0.012])
            u = np.linspace(0, 1, 15)[:, None]
            pathL = ear * (1 - u) ** 2 + np.array([a * 0.93, chin[1] + 0.02, zc + 0.045]) * 2 * u * (1 - u) + chin * u ** 2
            path = np.concatenate([pathL, (pathL * [-1, 1, 1])[::-1][1:]])
            pp, nn = onto(path, 0.004, ref=np.array([0, yc - 0.05, zc]))
            g.ribbon(pp, nn, 0.014, STRAP, 0.003)
        P, N, C, T = g.result()
        out.append(dict(name=f'helmet{lv}', bone='head', tint=None, P=P, N=N, C=C, T=T))
    # ---- rompi
    ys = np.linspace(1.04, 1.47, 12); nb = 48
    zc_t, R = torso_rings(var, ys, nb)
    tb = -math.pi + (np.arange(nb) + 0.5) * 2 * math.pi / nb
    VEST = {1: dict(col=lin('#6f7684'), trim=lin('#2a2c33'), t=0.013, y0=1.10, pouches=0),
            2: dict(col=lin('#4f5642'), trim=lin('#2b2f24'), t=0.019, y0=1.07, pouches=3),
            3: dict(col=lin('#26282c'), trim=lin('#141518'), t=0.025, y0=1.05, pouches=3, collar=True, sides=True)}
    for lv, vp in VEST.items():
        g = GearMesh(); t = vp['t']
        rows = np.zeros((len(ys), nb, 3))
        for k, y in enumerate(ys):
            r = R[k] + t
            rows[k, :, 0] = r * np.sin(tb); rows[k, :, 1] = y; rows[k, :, 2] = zc_t[k] + r * np.cos(tb)
        mask = np.zeros((len(ys) - 1, nb), dtype=bool)
        for k in range(len(ys) - 1):
            ym = 0.5 * (ys[k] + ys[k + 1])
            for j in range(nb):
                tj = 0.5 * (tb[j] + tb[(j + 1) % nb]) if j < nb - 1 else math.pi
                af = abs(tj); ab = math.pi - af
                if ym < vp['y0']:
                    continue
                if af < 1.02:   # panel depan (garis leher melengkung)
                    ok = ym < 1.445 - 0.07 * max(0.0, 1 - af / 0.42)
                elif ab < 1.02:  # panel belakang
                    ok = ym < 1.46 - 0.03 * max(0.0, 1 - ab / 0.35)
                else:            # sisi: sampai bawah ketiak
                    ok = ym < 1.285
                mask[k, j] = ok
        colr = np.tile(vp['col'], (len(ys) * nb, 1)).reshape(len(ys), nb, 3)
        g.grid(rows, colr.reshape(-1, 3), mask=mask, wrap=True)
        # tepi tebal di batas sel
        inner = rows.copy(); inner[:, :, 0] *= 1; 
        for k, y in enumerate(ys):
            r = R[k] + 0.003
            inner[k, :, 0] = r * np.sin(tb); inner[k, :, 2] = zc_t[k] + r * np.cos(tb)
        K, J = mask.shape
        for k in range(K):
            for j in range(J):
                if not mask[k, j]:
                    continue
                j1 = (j + 1) % nb
                for (dk, dj, e) in ((-1, 0, ((k, j), (k, j1))), (1, 0, ((k + 1, j1), (k + 1, j))), (0, -1, ((k + 1, j), (k, j))), (0, 1, ((k, j1), (k + 1, j1)))):
                    kk, jj = k + dk, (j + dj) % nb
                    if 0 <= kk < K and mask[kk, jj]:
                        continue
                    (a0, b0), (a1, b1) = e
                    q = np.array([[rows[a0, b0], rows[a1, b1]], [inner[a0, b0], inner[a1, b1]]])
                    g.grid(q, vp['trim'])
        fr = lambda th_, y_: (lambda k_, j_: rows[k_, j_])(int(np.argmin(np.abs(ys - y_))), int(np.argmin(np.abs(tb - th_))))
        # tali bahu: panel depan → lewat bahu → panel belakang
        for sx in (1, -1):
            u = np.linspace(0, 1, 13)[:, None]
            p0 = fr(sx * 0.62, 1.43); p1 = fr(sx * (math.pi - 0.62), 1.45)
            mid = np.array([sx * 0.118, 1.60, 0.5 * (p0[2] + p1[2])])
            path = p0 * (1 - u) ** 2 + mid * 2 * u * (1 - u) + p1 * u ** 2
            pp, nn = onto(path, t * 0.75, ref=np.array([0, 1.38, 0.5 * (p0[2] + p1[2])]))
            g.ribbon(pp, nn, 0.055 if lv > 1 else 0.045, vp['col'], 0.006)
        # kantong magasin di perut + radio
        def pouch(th_, y_, w, h, d, col):
            c = fr(th_, y_); n_ = nrm(np.array([math.sin(th_), 0, math.cos(th_)])); tx = np.cross([0, 1, 0], n_)
            g.box(c + n_ * d * 0.5, tx * w * 0.5, np.array([0, h * 0.5, 0]), n_ * d * 0.5, col, taper=0.9)
        for q in range(vp['pouches']):
            pouch((q - 1) * 0.42, 1.165, 0.07, 0.115, 0.036, vp['trim'] * 0.9 + vp['col'] * 0.25)
        if lv >= 2:
            pouch(0.36, 1.355, 0.05, 0.085, 0.03, DARK)       # radio
            pouch(-0.3, 1.34, 0.085, 0.05, 0.018, vp['trim'])  # kantong admin
        if vp.get('sides'):
            for sx in (1, -1):
                pouch(sx * 1.45, 1.16, 0.085, 0.11, 0.03, vp['trim'])
        if vp.get('collar'):  # pelindung leher
            u = np.linspace(-1, 1, 15)[:, None]
            ang = (math.pi - 1.25 * np.abs(u)) * np.sign(u + 1e-9)
            base = np.concatenate([np.sin(ang) * 0.085, np.full_like(u, 1.50), -0.025 + np.cos(ang) * 0.085], axis=1)
            pp, nn = onto(base, 0.012, ref=np.array([0, 1.5, 0.0]))
            ring = np.stack([pp, pp + [0, 0.05, 0] + nn * 0.008], axis=0)
            g.grid(ring, vp['col']); g.grid(ring[::-1], vp['trim'])
        P, N, C, T = g.result()
        out.append(dict(name=f'vest{lv}', bone='chest', tint=None, P=P, N=N, C=C, T=T))
    # ---- ransel (diwarnai warna ransel karakter: putih = ikut warna)
    g = GearMesh(); W1 = np.ones(3)
    kb = [int(np.argmin(np.abs(ys - y_))) for y_ in (1.16, 1.28, 1.40)]
    jb = int(np.argmin(np.abs(np.abs(tb) - math.pi)))
    zback = min(zc_t[k] - R[k][jb] for k in kb)
    hx, hy, hz = 0.135, 0.19, 0.078
    cpk = np.array([0, 1.275, zback - hz - 0.028])
    nu, nv = 14, 8
    uu = (np.arange(nu) + 0.5) / nu * 2 * math.pi; vv = np.linspace(-math.pi / 2, math.pi / 2, nv)
    se = lambda x, e: np.sign(x) * np.abs(x) ** e
    rows = np.zeros((nv, nu, 3))
    for i, v_ in enumerate(vv):
        rows[i, :, 0] = cpk[0] + hx * se(np.cos(v_), 0.42) * se(np.sin(uu), 0.5)
        rows[i, :, 1] = cpk[1] + hy * se(np.sin(v_), 0.5)
        rows[i, :, 2] = cpk[2] + hz * se(np.cos(v_), 0.42) * se(np.cos(uu), 0.5) * (1.0 - 0.18 * (np.sin(v_) > 0) * np.sin(v_))
    g.grid(rows, W1, wrap=True)
    rows2 = rows.copy()  # kantong depan (sisi belakang ransel)
    rows2[:, :, 0] = cpk[0] + (rows[:, :, 0] - cpk[0]) * 0.74; rows2[:, :, 1] = cpk[1] - 0.045 + (rows[:, :, 1] - cpk[1]) * 0.55
    rows2[:, :, 2] = cpk[2] - hz * 0.72 + (rows[:, :, 2] - cpk[2]) * 0.5
    g.grid(rows2, W1 * 0.82, wrap=True)
    g.box(cpk + [0, hy * 0.62, -hz * 0.2], [hx * 0.93, 0, 0], [0, 0.012, 0], [0, 0, hz * 0.85], W1 * 0.7)  # tutup atas
    for sx in (1, -1):
        u = np.linspace(0, 1, 15)[:, None]
        p0 = np.array([sx * 0.085, 1.21, 0.5]); p1 = np.array([sx * 0.085, 1.43, cpk[2] + hz * 0.9])
        mid = np.array([sx * 0.10, 1.66, 0.02])
        path = p0 * (1 - u) ** 2 + mid * 2 * u * (1 - u) + p1 * u ** 2
        pp, nn = onto(path, 0.03, ref=np.array([0, 1.36, 0.0]))
        g.ribbon(pp, nn, 0.042, STRAP, 0.006)
    P, N, C, T = g.result()
    out.append(dict(name='pack', bone='chest', tint='pack', P=P, N=N, C=C, T=T))
    return out


# ---------- Penulis GLB ----------
def top4(ow):
    idx = np.argsort(-ow, axis=1)[:, :4]
    w = np.take_along_axis(ow, idx, axis=1).astype(np.float64)
    w /= np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
    q = np.floor(w * 255 + 0.5).astype(np.int64)
    q[:, 0] += 255 - q.sum(axis=1)  # jumlah tepat 255
    idx = np.where(q > 0, idx, 0)
    return idx.astype(np.uint8), np.clip(q, 0, 255).astype(np.uint8)


class GLB:
    def __init__(self):
        self.bin = bytearray(); self.views = []; self.acc = []; self.meshes = []; self.nodes = []; self.skins = []

    def _view(self, data, target=None, stride=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        self.bin += data; self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, typ, normalized=False, target=34962, minmax=False):
        n = len(arr)
        comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[typ]
        a2 = arr.reshape(n, comps)
        size = a2.dtype.itemsize * comps
        if target == 34962 and size % 4:  # atribut verteks: sejajarkan ke 4 byte
            pad = np.zeros((n, (4 - size % 4) // a2.dtype.itemsize), dtype=a2.dtype)
            data = np.concatenate([a2, pad], axis=1).tobytes(); stride = size + (4 - size % 4)
        else:
            data = a2.tobytes(); stride = None
        acc = {'bufferView': self._view(data, target, stride), 'componentType': ctype, 'count': n, 'type': typ}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [float(v) for v in a2.min(axis=0)]; acc['max'] = [float(v) for v in a2.max(axis=0)]
        self.acc.append(acc)
        return len(self.acc) - 1

    def mesh(self, name, pos, nor, uv, tri, joints=None, weights=None, slot=None, skin=None, color=None):
        at = {'POSITION': self.accessor(pos.astype(np.float32), 5126, 'VEC3', minmax=True),
              'NORMAL': self.accessor(np.clip(np.round(nor * 127), -127, 127).astype(np.int8), 5120, 'VEC3', normalized=True)}
        if uv is not None:
            at['TEXCOORD_0'] = self.accessor(np.clip(np.round(np.stack([uv[:, 0], 1 - uv[:, 1]], axis=1) * 65535), 0, 65535).astype(np.uint16), 5123, 'VEC2', normalized=True)
        if color is not None:  # warna verteks linear
            c4 = np.concatenate([np.clip(color, 0, 1), np.ones((len(color), 1))], axis=1)
            at['COLOR_0'] = self.accessor(np.round(c4 * 255).astype(np.uint8), 5121, 'VEC4', normalized=True)
        if joints is not None:
            at['JOINTS_0'] = self.accessor(joints, 5121, 'VEC4'); at['WEIGHTS_0'] = self.accessor(weights, 5121, 'VEC4', normalized=True)
        if slot is not None:
            at['_SLOT'] = self.accessor(slot.astype(np.uint8), 5121, 'SCALAR')
        ia = tri.astype(np.uint16 if len(pos) < 65536 else np.uint32).ravel()
        ind = self.accessor(ia, 5123 if len(pos) < 65536 else 5125, 'SCALAR', target=34963)
        self.meshes.append({'name': name, 'primitives': [{'attributes': at, 'indices': ind}]})
        node = {'name': name, 'mesh': len(self.meshes) - 1}
        if skin is not None:
            node['skin'] = skin
        self.nodes.append(node)
        return len(self.nodes) - 1

    def skeleton(self):
        base = len(self.nodes); idx = {}
        for b in BONES:
            par = PARENT[b]
            t = np.array(PIVOT[b], dtype=np.float64) - (np.array(PIVOT[par]) if par else 0)
            idx[b] = len(self.nodes); self.nodes.append({'name': b, 'translation': [float(v) for v in t]})
        for b in BONES:
            ch = [idx[c] for c in BONES if PARENT[c] == b]
            if ch:
                self.nodes[idx[b]]['children'] = ch
        ibm = np.zeros((len(BONES), 16), dtype=np.float32)
        for i, b in enumerate(BONES):
            m = np.eye(4, dtype=np.float32); m[:3, 3] = -np.array(PIVOT[b]); ibm[i] = m.T.ravel()
        self.skins.append({'joints': [idx[b] for b in BONES], 'skeleton': idx['hips'], 'inverseBindMatrices': self.accessor(ibm, 5126, 'MAT4', target=None)})
        self.root_bone = idx['hips']
        return len(self.skins) - 1

    def write(self, path):
        roots = [i for i, n in enumerate(self.nodes) if 'mesh' in n] + ([self.root_bone] if self.skins else [])
        js = {'asset': {'version': '2.0', 'generator': 'characters3.py'}, 'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
              'scene': 0, 'scenes': [{'nodes': roots}], 'nodes': self.nodes, 'meshes': self.meshes, 'accessors': self.acc, 'bufferViews': self.views}
        if self.skins:
            js['skins'] = self.skins
        while len(self.bin) % 4:
            self.bin.append(0)
        js['buffers'] = [{'byteLength': len(self.bin)}]
        jb = json.dumps(js, separators=(',', ':')).encode()
        jb += b' ' * ((4 - len(jb) % 4) % 4)
        with open(path, 'wb') as fh:
            fh.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(self.bin)))
            fh.write(struct.pack('<I4s', len(jb), b'JSON')); fh.write(jb)
            fh.write(struct.pack('<I4s', len(self.bin), b'BIN\x00')); fh.write(bytes(self.bin))
        return os.path.getsize(path)


def export_variant(var, lods, out_dir):
    key = var['key']
    g = GLB(); sk = g.skeleton()
    meta = dict(key=key, glb=f'{key}.glb', lods=[], tris=[], verts=[], hair=[], albedo=f'{key}_albedo.webp', normal=f'{key}_normal.webp', orm=f'{key}_orm.webp', skinMean=var.get('stats', {}).get('skin'))
    for li, L in enumerate(lods):
        j, w = top4(L['ow'])
        g.mesh(f'{key}_lod{li}', L['pos'], L['nor'], L['uv'], L['tri'], j, w, L['slot'], sk)
        meta['lods'].append(f'{key}_lod{li}'); meta['tris'].append(int(len(L['tri']))); meta['verts'].append(int(len(L['pos'])))
    for p in var['parts']:
        if p['kind'] != 'hair':
            continue
        tris, _ = tri_faces(p['faces'])
        T = tris[:, :, 0]; luv = p['uv'][tris[:, :, 1]]
        hn = vnormals(p['rest'], T)
        tree = BVHTree.FromPolygons([tuple(v) for v in p['rest']], [tuple(int(i) for i in t) for t in T])
        h = dict(style=p['name'][5:], bone='head', map=f"hair_{p['name'][5:]}.webp", lods=[], tris=[])
        for li, tgt in enumerate(HAIR_TARGET):
            dp, dtri, duv = decimate(f"{p['name']}_{li}", p['rest'], T, luv, min(1.0, tgt / len(T)))
            nor = np.zeros((len(dp), 3))
            for i, v in enumerate(dp):
                loc, _, fi, _ = tree.find_nearest(Vector(v))
                nor[i] = hn[T[fi]].mean(axis=0)
            # normal rambut: campur dengan arah keluar dari pusat kepala (kartu rambut berlapis → sorot halus, tidak belang)
            ctr = np.array([0.0, 1.74, 0.02]); rad = dp - ctr; rad /= np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-9)
            nor = nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-9) * 0.35 + rad * 0.65
            G = to_gl(dp, dtri, duv, dict(nor=nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-9)))
            nm = f"{key}_{p['name']}_{li}"
            g.mesh(nm, G['pos'], G['nor'], G['uv'], G['tri'])
            h['lods'].append(nm); h['tris'].append(int(len(G['tri'])))
        meta['hair'].append(h)
    meta['gear'] = []
    for G in var['gear']:
        nm = f"{key}_{G['name']}"
        g.mesh(nm, G['P'], G['N'], None, G['T'], color=G['C'])
        meta['gear'].append(dict(name=G['name'], mesh=nm, bone=G['bone'], tint=G['tint'], tris=int(len(G['T']))))
    size = g.write(os.path.join(out_dir, f'{key}.glb'))
    log(f'   {key}.glb {size / 1024:.0f} KB')
    return meta


# ---------- Pratinjau Cycles (CPU) dari mesh LOD + atlas ----------
PREVIEW_PAL = {  # warna per slot (sRGB heks) untuk pratinjau: pemain (ungu) & contoh bot
    'player': dict(skin='#c68c66', hand='#25232c', top='#503EBA', sleeve='#503EBA', cuff='#D29F52', pants='#2b2940', inner='#d8d4cc'),
    'bot1': dict(skin='#e0ac85', hand='#e0ac85', top='#5b6b4a', sleeve='#5b6b4a', cuff='#5b6b4a', pants='#3b3a33', inner='#b9b2a2'),
    'bot2': dict(skin='#8a5a3c', hand='#8a5a3c', top='#6b3f3f', sleeve='#6b3f3f', cuff='#6b3f3f', pants='#26292f', inner='#8d8f96'),
    'bot3': dict(skin='#f1c7a5', hand='#f1c7a5', top='#3f5468', sleeve='#3f5468', cuff='#3f5468', pants='#4a4535', inner='#c9c1b0'),
}


def hex_lin(h):
    h = h.lstrip('#'); c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return s2l(c)


def preview_object(name, L, maps_prefix, pal, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in to_bl(L['pos'])], [], [tuple(int(i) for i in t) for t in L['tri']])
    ul = me.uv_layers.new(name='atlas'); ul.data.foreach_set('uv', L['uv'][L['tri'].ravel()].astype(np.float32).ravel())
    cols = np.ones((len(SLOTS), 4)); 
    for n, i in SI.items():
        cols[i, :3] = (hex_lin(pal[n]) if n in pal else np.ones(3)) / C_NEUTRAL * 0.5  # node Multiply × 2 di material
    ca = me.color_attributes.new(name='tint', type='FLOAT_COLOR', domain='POINT')
    ca.data.foreach_set('color', cols[L['slot']].astype(np.float32).ravel())
    nb = to_bl(L['nor'])
    me.normals_split_custom_set_from_vertices([tuple(v) for v in nb])
    for pl in me.polygons:
        pl.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.location = loc
    m = bpy.data.materials.new(name + '_m'); m.use_nodes = True
    nt = m.node_tree; bs = nt.nodes.get('Principled BSDF')

    def tex(path, cs):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(path, check_existing=True); n.image.colorspace_settings.name = cs
        return n
    ta, tn, to = tex(maps_prefix + '_albedo.png', 'sRGB'), tex(maps_prefix + '_normal.png', 'Non-Color'), tex(maps_prefix + '_orm.png', 'Non-Color')
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'tint'
    mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'
    nt.links.new(ta.outputs['Color'], mul.inputs[0]); nt.links.new(vc.outputs['Color'], mul.inputs[1])
    sc2 = nt.nodes.new('ShaderNodeVectorMath'); sc2.operation = 'SCALE'; sc2.inputs['Scale'].default_value = 2.0
    nt.links.new(mul.outputs['Vector'], sc2.inputs[0])
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    aom = nt.nodes.new('ShaderNodeVectorMath'); aom.operation = 'SCALE'
    nt.links.new(sc2.outputs['Vector'], aom.inputs[0])
    mix = nt.nodes.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'; mix.inputs[1].default_value = 0.55; mix.inputs[2].default_value = 0.45
    nt.links.new(sep.outputs['Red'], mix.inputs[0]); nt.links.new(mix.outputs['Value'], aom.inputs['Scale'])
    nt.links.new(aom.outputs['Vector'], bs.inputs['Base Color'])
    nt.links.new(sep.outputs['Green'], bs.inputs['Roughness'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'atlas'; nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    if 'Subsurface Weight' in bs.inputs:
        sss = nt.nodes.new('ShaderNodeMath'); sss.operation = 'MULTIPLY'; sss.inputs[1].default_value = 0.25
        nt.links.new(sep.outputs['Blue'], sss.inputs[0]); nt.links.new(sss.outputs['Value'], bs.inputs['Subsurface Weight'])
        bs.inputs['Subsurface Radius'].default_value = (0.012, 0.005, 0.003)
    me.materials.append(m)
    return ob


def preview_gear(name, G, loc, tint=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in to_bl(G['P'])], [], [tuple(int(i) for i in t) for t in G['T']])
    col = np.concatenate([G['C'] * (hex_lin(tint) if tint else 1.0), np.ones((len(G['C']), 1))], axis=1)
    ca = me.color_attributes.new(name='col', type='FLOAT_COLOR', domain='POINT'); ca.data.foreach_set('color', col.astype(np.float32).ravel())
    me.normals_split_custom_set_from_vertices([tuple(v) for v in to_bl(G['N'])])
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.location = loc
    m = bpy.data.materials.new(name + '_m'); m.use_nodes = True; nt = m.node_tree; bs = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'col'; nt.links.new(vc.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.78
    me.materials.append(m)
    return ob


def preview_hair(name, p, work, loc, color):
    tris, _ = tri_faces(p['faces'])
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in to_bl(p['rest'])], [], [tuple(int(i) for i in t) for t in tris[:, :, 0]])
    ul = me.uv_layers.new(name='uv'); ul.data.foreach_set('uv', p['uv'][tris[:, :, 1].ravel()].astype(np.float32).ravel())
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.location = loc
    m = bpy.data.materials.new(name + '_m'); m.use_nodes = True; nt = m.node_tree; bs = nt.nodes.get('Principled BSDF')
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bpy.data.images.load(os.path.join(work, f"hair_{p['name'][5:]}.png"), check_existing=True)
    mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = tuple(hex_lin(color) / C_NEUTRAL)
    nt.links.new(tx.outputs['Color'], mul.inputs[0]); nt.links.new(mul.outputs['Vector'], bs.inputs['Base Color']); nt.links.new(tx.outputs['Alpha'], bs.inputs['Alpha'])
    bs.inputs['Roughness'].default_value = 0.6
    me.materials.append(m)
    return ob


def persp_cam(name, loc, look, lens=70):
    cam = bpy.data.cameras.new(name); cam.lens = lens
    ob = bpy.data.objects.new(name, cam); bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def preview_variant(var, lods, maps_prefix, out_png):
    reset_scene()
    sc = setup_render(800, 600, 16)
    fl = bpy.data.meshes.new('floor'); fl.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('floor', fl); sc.collection.objects.link(fo)
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.33, 0.33, 0.32, 1); fl.materials.append(fm)
    pals = list(PREVIEW_PAL.values())
    for i, L in enumerate(lods):  # LOD0 (pemain), LOD0 bot, LOD1, LOD2 berjajar
        preview_object(f'lod{i}', L, maps_prefix, pals[(i + 1) % len(pals)], loc=((i + 1) * 0.85 - 1.3, 0, 0))
    preview_object('hero', lods[0], maps_prefix, pals[0], loc=(-1.3, 0, 0))
    # perlengkapan & rambut: pemain = rambut + ransel; bot 1 = helm 2 + rompi 2 + ransel; bot 2 = helm 3 + rompi 3; bot 3 (LOD2) = helm 1 + rompi 1
    G = {g_['name']: g_ for g_ in var.get('gear', [])}
    hairs = [p for p in var['parts'] if p['kind'] == 'hair']
    work = os.path.dirname(maps_prefix)
    if hairs:
        preview_hair('hair_hero', hairs[0], work, (-1.3, 0, 0), '#231c18')
    if G:
        preview_gear('pack_hero', G['pack'], (-1.3, 0, 0), '#3a3d34')
        for i, (h, v, pk) in enumerate((('helmet2', 'vest2', True), ('helmet3', 'vest3', False), ('helmet1', 'vest1', True))):
            x = (i + 1) * 0.85 - 1.3
            preview_gear(f'h{i}', G[h], (x, 0, 0)); preview_gear(f'v{i}', G[v], (x, 0, 0))
            if pk:
                preview_gear(f'p{i}', G['pack'], (x, 0, 0), '#4a3f30')
    sc.camera = persp_cam('c1', (0.4, -5.6, 1.25), (0, 0, 0.95), 62)
    sc.render.filepath = out_png.replace('.png', '-lineup.png'); bpy.ops.render.render(write_still=True)
    sc.camera = persp_cam('c2', (-1.02, -1.25, 1.66), (-1.3, 0, 1.6), 75)
    sc.render.resolution_x, sc.render.resolution_y = 480, 480
    sc.render.filepath = out_png.replace('.png', '-face.png'); bpy.ops.render.render(write_still=True)


# ---------- Keluaran tekstur (WebP lewat ImageMagick) ----------
import shutil, subprocess  # noqa: E402
MAGICK = shutil.which('magick')


def to_webp(png, out, size, q=86):
    if not MAGICK:
        shutil.copy(png, out.replace('.webp', '.png')); return
    subprocess.run([MAGICK, png, '-resize', f'{size}x{size}', '-quality', str(q), '-define', 'webp:method=6', out], check=True)


def export_maps(key, work, out_dir):
    to_webp(os.path.join(work, key + '_albedo.png'), os.path.join(out_dir, key + '_albedo.webp'), 2048, 84)
    to_webp(os.path.join(work, key + '_normal.png'), os.path.join(out_dir, key + '_normal.webp'), 1024, 88)
    to_webp(os.path.join(work, key + '_orm.png'), os.path.join(out_dir, key + '_orm.webp'), 1024, 84)


_HAIR_DONE = set()


def export_hair_tex(style, mat, work, out_dir):
    """tekstur rambut netral: RGB = kecerahan helai (dinormalkan, × C_NEUTRAL), A = alfa → diwarnai warna rambut di shader"""
    if style in _HAIR_DONE:
        return
    _HAIR_DONE.add(style)
    img = load_img(mat['diffuseTexture'])
    a = img[:, :, 3]
    lum = s2l(img[:, :, :3]) @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    m = a > 0.6
    mean = float(lum[m].mean()) if m.any() else 0.2
    g = np.clip(lum / mean * C_NEUTRAL, 0, 1)
    g = dilate(g[:, :, None], a > 0.25, 6)[:, :, 0]  # warna di luar helai = warna tepi (tidak ada pinggiran gelap saat mipmap)
    rgba = np.concatenate([np.repeat(l2s(g)[:, :, None], 3, axis=2), a[:, :, None]], axis=2)
    png = os.path.join(work, f'hair_{style}.png')
    save_img(png, rgba)
    to_webp(png, os.path.join(out_dir, f'hair_{style}.webp'), 1024, 88)


# ---------- utama ----------
def main(args):
    os.makedirs(args.work, exist_ok=True)
    mh = mhdata.MakeHuman(args.mpfb, args.assets)
    keys = [k for k in (args.only.split(',') if args.only else VARIANTS.keys()) if k]
    os.makedirs(args.out, exist_ok=True)
    metas = []
    for key in keys:
        var = build_variant(mh, key)
        cull_hidden(var['parts'])
        classify(var['parts'])
        for p in var['parts']:
            log('  ', p['name'], p['kind'], 'verts', len(p['pos']), 'tris', sum(len(f) - 2 for f in p['faces']), 'slot', {SLOTS[i]: int((p['slot'] == i).sum()) for i in np.unique(p['slot'])})
        if args.stage in ('geo',):
            debug_render(var, os.path.join(args.work, f'dbg-{key}-rest.png'), 'rest')
            continue
        build_atlas(var['parts'])
        if args.stage == 'all':
            mark_scalp(var)
            compose(var)
            composite_brows(var)
            finish_maps(var, os.path.join(args.work, key))
        lods = build_lods(var)
        var['gear'] = build_gear(var)
        if args.stage != 'preview':  # 'preview' = hanya render pratinjau dari peta yang sudah ada di --work
            metas.append(export_variant(var, lods, args.out))
            if args.stage == 'all':
                export_maps(key, args.work, args.out)
            for p in var['parts']:
                if p['kind'] == 'hair':
                    export_hair_tex(p['name'][5:], p['mat'], args.work, args.out)
        if args.preview:
            preview_variant(var, lods, os.path.join(args.work, key), os.path.join(args.preview, f'v3-{key}.png'))
    if metas:
        mp = os.path.join(args.out, 'people3.json')
        old = json.load(open(mp)) if os.path.exists(mp) else {}
        byk = {m['key']: m for m in old.get('variants', [])}
        for m in metas:
            byk[m['key']] = m
        man = dict(version=3, bones=BONES, pivots={b: list(PIVOT[b]) for b in BONES}, slots=SLOTS, neutral=C_NEUTRAL, variants=[byk[k] for k in VARIANTS if k in byk],
                   note='glTF: +Y atas, menghadap +Z, kiri = +X. Mesh ber-skin pada pose diam rig.js; JOINTS_0 mengacu urutan "bones". _SLOT = indeks slot warna. Albedo netral × neutral.')
        json.dump(man, open(mp, 'w'), indent=1)
        log('manifest', mp)


# argumen di-parse hanya bila dijalankan langsung, supaya modul ini bisa diimpor (tools/blender/costumes.py)
if __name__ == '__main__':
    main(parse_args())
