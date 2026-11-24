# Kostum karakter Sutera Royale → web/game/assets/costumes/<id>/{costume.json, <varian>.glb, <varian>_{albedo,normal,orm}.webp, thumb.webp}
# Rancangan: docs/rancangan/2026-11-24/kostum.md. Dibaca runtime oleh web/map/rig.js loadCostume / setCostume.
#
# Kostum = mesh ber-kulit pengganti tubuh v3 pada kerangka 17 tulang yang sama:
#   lapisan pakaian MakeHuman CC0 (.mhclo, dari aset sistem atau paket komunitas CC0) yang dipasang ke tubuh tiap varian,
#   + bagian buatan sendiri [BL] (tools/blender/costume_parts.py: blangkon, jarik, keris, plate carrier, sayap, …),
#   + kulit yang tersisa (wajah, leher, tangan, kaki telanjang), semuanya dalam SATU mesh + SATU atlas per varian.
# Warna/motif TIDAK diambil dari tekstur sumber: tiap bagian punya fungsi bahan (tools/blender/costume_tex.py) yang dihitung
# per texel atlas dari posisi pose diam; tekstur sumber hanya menyumbang bayangan lipatan, AO, dan normal.
# Atlas: albedo 2048² (kulit netral × 0,5 seperti tubuh v3; pakaian sudah berwarna × 0,5), normal 1024², ORM 1024²
# (R = AO, G = kekasaran, B = LOGAM). Slot: 0 kulit, 1 tangan (sarung tangan = warna slot), 7 tetap (pakaian).
#
# Sumber (unduh sekali, simpan di luar repo; lihat tools/blender/characters3.py untuk --mpfb dan --assets):
#   paket komunitas CC0: http://files.makehumancommunity.org/asset_packs/<paket>/<paket>_cc0.zip
#   (suits02, masks01, shoes01, pants01) → diekstrak masing-masing ke <packs>/<paket>_cc0/
#
# Pakai:
#   Blender -b --factory-startup -P tools/blender/costumes.py -- --mpfb <…/data> --assets <…/pack> --packs <folder paket> \
#       --out web/game/assets/costumes --work <folder kerja> [--only char_malam,char_batik] [--variants m1,f1] \
#       [--stage all|mesh|sheet] [--sheet <folder png>]
#   --stage all   : tekstur + mesh + costume.json (+ lembar kontak & thumb bila --sheet diberikan)
#   --stage mesh  : mesh + costume.json saja (tekstur tidak dihitung ulang)
#   --stage sheet : hanya lembar kontak/thumb dari hasil "all" yang masih ada di --work
import bpy, sys, os, json, math, glob, time, argparse, shutil, subprocess
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mhdata  # noqa: E402
import characters3 as C3  # noqa: E402
import costume_tex as TX  # noqa: E402
import costume_parts as BLP  # noqa: E402

log = C3.log
BI, BONES, SI = C3.BI, C3.BONES, C3.SI
RES = 2048

# ---------- Katalog (M2: tiga perintis) ----------
# layers: urutan dalam → luar. src 'SYS:<nama>' (aset sistem) | 'PK:<nama>' (paket komunitas). keep: 'top' | 'pants' | None.
# delete: 'all' (hapus tubuh di bawah pakaian) | 'above_hip' | 'none'. pre: decimate awal (segitiga) untuk sumber padat.
# bl(B) → daftar Mesh buatan sendiri. glove: warna sarung tangan (None = tangan telanjang).
M = lambda name, **kw: (name, kw)


def _malam(B):
    return (BLP.nvg(B, M('flat', col='#2c2f35', rough=0.5, metal=0.3), M('flat', col='#0c2216', rough=0.1, metal=0.7), M('nylon', col='#1c1e22'))
            + BLP.plate_carrier(B, M('nylon', col='#33373e'), M('nylon', col='#3a3e46', col_web='#23262b', web=0.05), M('nylon', col='#2b2e34'), M('flat', col='#d18a1f', rough=0.6))
            + BLP.belt_pockets(B, M('nylon', col='#1d1f23'), M('ripstop', col='#2a2d33', cell=0.014), M('steel', col='#3a3c40'))
            + BLP.knee_pads(B, M('flat', col='#26282d', rough=0.6), M('nylon', col='#1b1c20')))


def _batik(B):
    # blangkon: batik gelap bermotif kecil; pita tepi polos berlipat miring. Jarik: parang besar berlatar krem (kontras dengan kemeja)
    blang = M('batik_parang', latar='#1f140e', motif='#8a6a3a', gelap='#0b0807', emas='#b98a3a', period=0.022, prada=0.2, rough=0.8, coords=lambda c: (c['P'][:, 0] + c['P'][:, 2] * 0.6, c['P'][:, 1]))
    band = M('satin', col='#1c120d', rough=0.72, pleat=30)
    kain = M('batik_parang', latar='#dccb9f', motif='#55300f', period=0.085, prada=0.55, coords=lambda c: (c['q'][:, 0] * 1.19, c['P'][:, 1]))
    wir = M('batik_parang', latar='#dccb9f', motif='#55300f', period=0.085, prada=0.55, k=0.3, coords=lambda c: (c['q'][:, 0] * 0.03, c['P'][:, 1]))
    gold = M('gold', rough=0.32)
    return (BLP.blangkon(B, blang, band) + BLP.jarik(B, kain, wir)
            + BLP.stagen(B, M('cloth', col='#2b1810', weave=0.012, rough=0.85), M('satin', col='#6b1a14', rough=0.5), gold)
            + BLP.keris_kecil(B, M('wood', col='#5b3a1f'), M('gold', rough=0.3, engrave='feather'), M('wood', col='#2b1a10', rough=0.4))
            + BLP.selop(B, M('leather', col='#231510', rough=0.45), M('leather', col='#120c09', rough=0.7)))


def _garuda(B):
    fe = M('feather', base=None, tip='#7a1420')
    gold = M('gold', rough=0.28)
    hem = lambda c: np.minimum(c['q'][:, 1], 1 - c['q'][:, 1]) * 0.5
    return (BLP.garuda_helm(B, M('gold', rough=0.26, engrave='feather'), M('flat', col='#7a1420', rough=0.3, metal=0.2), M('feather', base=None, tip='#8a1826'))
            + BLP.garuda_wings(B, fe, gold)
            + BLP.dodot(B, M('satin', col='#6e1220', border=lambda c: (1 - c['q'][:, 1]) * 0.5, border_w=0.06), M('satin', col='#7c1624', pleat=8, border=lambda c: (1 - c['q'][:, 1]) * 0.55, border_w=0.05), gold))


COSTUMES = {
    'char_malam': dict(
        name='Operator Malam',
        # celana kargo paket pants01 (cortu_cargo_pants) hanya 392 segitiga dan meninggalkan celah di pinggang → dipakai cadangan
        # rancangan: bawahan aset sistem (celana setelan) + kantong kargo, sabuk, dan sarung pistol buatan sendiri
        layers=[dict(src='SYS:male_casualsuit01', mat=M('ripstop', col='#2b2e35'), tris=3600),
                dict(src='SYS:shoes03', kind='shoe', mat=M('leather', col='#17171a', rough=0.5), tris=1300),
                dict(src='PK:culturalibre_hero-heroine_hood_1', mat=M('knit', col='#23252b'), tris=900, prio=1.5)],
        bl=_malam, glove='#0e0e11', hideHair=True, hideHelmet=True, hideVest=True, hidePack=False,
        far=dict(shirt='#1b1c20', sleeve='#1b1c20', pants='#15161a', glove='#0e0e11', cuff='#1b1c20', inner='#1f2126')),
    'char_batik': dict(
        name='Batik Parang',
        layers=[dict(src='SYS:male_casualsuit01', keep='top', delete='above_hip', mat=M('batik_parang', latar='#43240f', motif='#dcc693', period=0.05, prada=0.45), tris=3000, prio=1.15)],
        bl=_batik, glove=None, sole=0.012, hideHair=True, hideHelmet=True, hideVest=False, hidePack=False,
        far=dict(shirt='#6b3e1e', sleeve='#6b3e1e', pants='#5a3115', glove=None, cuff='#D29F52', inner='#e6d3a3')),
    'char_garuda': dict(
        name='Garuda Emas',
        layers=[dict(src='PK:matcreator_mc-bodysuit-2021', mat=M('satin', col='#5e101c', rough=0.5), tris=2800, pre=12000),
                dict(src='PK:matcreator_mc-scifi-armor_helios', mat=M('gold', rough=0.3, engrave='feather', dark=0.42), tris=5200, pre=20000, offset=0.006, prio=1.2)],
        bl=_garuda, glove='#5a0f1a', hideHair=True, hideHelmet=True, hideVest=True, hidePack=True,
        far=dict(shirt='#d9a23a', sleeve='#d9a23a', pants='#6e1220', glove='#5a0f1a', cuff='#d9a23a', inner='#6e1220')),
}


# ---------- Lapisan mhclo ----------
def find_asset(a, src):
    kind, name = src.split(':', 1)
    if kind == 'SYS':
        d = os.path.join(a.assets, 'clothes', name)
        return d if os.path.isdir(d) else None
    hits = sorted(glob.glob(os.path.join(a.packs, '*', 'clothes', name)))
    return hits[0] if hits else None


def weld_uv(tri, luv):
    """(tri (n,3) indeks verteks, luv (n,3,2)) → faces [(3,2)], uv: indeks uv dibagi oleh sudut ber-(verteks, uv) sama → pulau UV utuh"""
    q = np.round(luv.reshape(-1, 2) * 65536).astype(np.int64)
    key = tri.ravel() * (1 << 40) + q[:, 0] * (1 << 20) + (q[:, 1] & ((1 << 20) - 1))
    _, first, inv = np.unique(key, return_index=True, return_inverse=True)
    uv = luv.reshape(-1, 2)[first]
    ti = inv.reshape(-1, 3)
    return [np.stack([tri[i], ti[i]], axis=1) for i in range(len(tri))], uv


def bary_transfer(src_pos, src_tri, vals, pts):
    """nilai per verteks sumber diinterpolasi ke titik terdekat di permukaan sumber"""
    tree = BVHTree.FromPolygons([tuple(v) for v in src_pos], [tuple(int(i) for i in t) for t in src_tri])
    out = np.zeros((len(pts), vals.shape[1]), dtype=np.float64)
    for i, v in enumerate(pts):
        loc, _, fi, _ = tree.find_nearest(Vector(v))
        ga, gb, gc = src_tri[fi]
        a, b, c = src_pos[ga], src_pos[gb], src_pos[gc]
        v0, v1, v2 = b - a, c - a, np.array(loc) - a
        d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
        den = max(d00 * d11 - d01 * d01, 1e-18)
        w1 = (d11 * d20 - d01 * d21) / den; w2 = (d00 * d21 - d01 * d20) / den
        out[i] = vals[ga] * (1 - w1 - w2) + vals[gb] * w1 + vals[gc] * w2
    return out


def load_layer(a, mh, L, P):
    folder = find_asset(a, L['src'])
    if not folder:
        raise RuntimeError(f"aset {L['src']} tidak ditemukan (periksa --assets / --packs)")
    info = mh.read_mhclo(glob.glob(os.path.join(folder, '*.mhclo'))[0])
    V, UV, F, _ = mhdata.read_obj(info['obj'])
    pos, W = mh.fit(info, P)
    if len(pos) != len(V):
        raise RuntimeError(f"{L['src']}: jumlah verteks mhclo {len(pos)} != obj {len(V)}")
    mat = mhdata.read_mhmat(info['material']) if info.get('material') and os.path.exists(info['material']) else {}
    faces = F
    ntri = sum(len(f) - 2 for f in F)
    if L.get('pre') and ntri > L['pre'] * 1.15:  # sumber padat: decimate dulu di pose-A, bobot rig diinterpolasi dari mesh asli
        tris, _ = C3.tri_faces(F)
        T = tris[:, :, 0]; luv = UV[tris[:, :, 1]]
        dp, dtri, duv = C3.decimate('pre_' + info.get('name', 'x'), pos, T, luv, L['pre'] / ntri)
        W = bary_transfer(pos, T, W.astype(np.float64), dp).astype(np.float32)
        W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
        pos = dp; faces, UV = weld_uv(dtri, duv)
        log(f"   pra-decimate {L['src']}: {ntri} → {len(dtri)} segitiga")
    return dict(name=L['src'].split(':', 1)[1], src=L['src'], kind=L.get('kind', 'cloth'), pos=pos, W=W, uv=UV, faces=faces, srcmat=mat, mat=L['mat'],
                delete=np.array(sorted(set(info['delete'])), dtype=np.int64), spec=L, folder=folder, budget=L.get('tris', 2000), prio=L.get('prio', 1.0))


def keep_region(p, keep):
    """saring pulau UV setelan: 'top' = atasan (pulau yang naik ke atas pinggang), 'pants' = sisanya"""
    lab = C3.components(len(p['uv']), p['faces'], col=1)
    y = p['rest'][:, 1]
    sel = np.zeros(len(p['faces']), dtype=bool)
    for Lb in range(lab.max() + 1):
        fm = lab == Lb
        vi = np.unique(np.concatenate([f[:, 0] for f, k in zip(p['faces'], fm) if k]))
        legs = y[vi].max() < 1.15
        sel[fm] = (not legs) if keep == 'top' else legs
    faces = [f for f, k in zip(p['faces'], sel) if k]
    pos, W, uv, faces, vi = C3.compact(p['pos'], p['W'], p['uv'], faces)
    p.update(pos=pos, W=W, uv=uv, faces=faces, rest=p['rest'][vi], ow=p['ow'][vi])


def push_out(p, inner, offset):
    """verteks lapisan luar yang menembus / terlalu dekat lapisan dalam (pose diam) digeser keluar sepanjang normal lapisan dalam.
    Zirah bercangkang ganda: sisi yang menghadap tubuh (normal berlawanan) cukup di offset/3 supaya tetap di bawah sisi luarnya."""
    V, F, off = [], [], 0
    for q in inner:
        V.append(q['rest']); F += [tuple(int(i) + off for i in f[:, 0]) for f in q['faces']]; off += len(q['rest'])
    tree = BVHTree.FromPolygons([tuple(v) for v in np.concatenate(V)], F)
    tris, _ = C3.tri_faces(p['faces'])
    N = C3.vnormals(p['rest'], tris[:, :, 0])
    n = 0; deep = 0.0
    R = p['rest']
    for i, v in enumerate(R.copy()):
        loc, nr, _, d = tree.find_nearest(Vector(v), 0.03)
        if loc is None:
            continue
        nr = np.array(nr); loc = np.array(loc)
        sd = float(np.dot(v - loc, nr))
        want = offset if float(np.dot(N[i], nr)) > -0.2 else offset / 3
        if sd < want:
            R[i] = v + nr * (want - sd); n += 1; deep = max(deep, -sd)
    log(f"   dorong keluar {p['name']}: {n}/{len(R)} verteks ({100 * n / max(len(R), 1):.1f} %), tembus terdalam {deep * 1000:.1f} mm")
    return n / max(len(R), 1), deep


def build_base(a, mh, cid, key):
    """tubuh varian + lapisan mhclo, di-retarget ke pose diam (tanpa bagian buatan)"""
    S = COSTUMES[cid]; Vd = C3.VARIANTS[key]
    P = mh.build(Vd['macros'])
    J = mh.joints(P)
    top = P[:mh.nbody, 1].max()
    k = (C3.TOP_Y - C3.SHOULDER_Y) / (top - J['l-shoulder'][1])
    P *= k
    J = mh.joints(P)
    layers = [load_layer(a, mh, L, P) for L in S['layers']]
    dele = np.zeros(len(P), dtype=bool)
    hip_y = J['l-upper-leg'][1]
    for c in layers:
        mode = c['spec'].get('delete', 'all')
        if mode == 'none':
            continue
        d = c['delete']
        if mode == 'above_hip':
            d = d[P[d, 1] > hip_y + 0.03]
        dele[d] = True
    body_faces = [f for f, g in zip(mh.F, mh.G) if g == 'body' and not dele[f[:, 0]].all()]
    pos, W, uv, faces, _ = C3.compact(P, mh.W, mh.UV, body_faces)
    skin_mat = mhdata.read_mhmat(os.path.join(mh.assets, 'skins', Vd['skin'], Vd['skin'] + '.mhmat'))
    parts = [dict(name='skin', kind='skin', pos=pos, W=W, uv=uv, faces=faces, srcmat=skin_mat, mat=None)]
    parts += layers
    eyes = mh.asset('eyes', 'low-poly', P)
    parts.append(dict(name='eyes', kind='eye', pos=eyes['pos'], W=eyes['W'], uv=eyes['uv'], faces=eyes['faces'], mat=None,
                      srcmat=mhdata.read_mhmat(os.path.join(mh.assets, 'eyes', 'materials', Vd['eyes'] + '.mhmat'))))
    br = mh.asset('eyebrows', Vd['brows'], P)
    parts.append(dict(name='brows', kind='brow', pos=br['pos'], W=br['W'], uv=br['uv'], faces=br['faces'], mat=br['material'], srcmat=br['material']))
    shoes = [p for p in parts if p['kind'] == 'shoe']
    sole = max(0.0, -min(p['pos'][:, 1].min() for p in shoes)) if shoes else S.get('sole', 0.0)
    rt = C3.Retarget(mh, P, dict(sole=sole))
    for p in parts:
        p['rest'] = rt.apply(p['pos'], p['W']); p['ow'] = rt.our_weights(p['rest'], p['W'])
    for p in layers:
        if p['spec'].get('keep'):
            keep_region(p, p['spec']['keep'])
    fit = {}
    for i, p in enumerate(layers):
        if p['spec'].get('offset'):
            fit[p['name']] = push_out(p, [q for q in parts if q['kind'] == 'skin'] + layers[:i], p['spec']['offset'])
    for p in parts:
        n = len(p['rest'])
        p['slot'] = np.full(n, SI['fixed'], dtype=np.int64)
        if p['kind'] == 'skin':
            hand = p['ow'][:, BI['handL']] + p['ow'][:, BI['handR']]
            p['slot'][:] = SI['skin']; p['slot'][hand > 0.5] = SI['hand']
    log(cid, key, f'skala {k:.3f}, sol {sole * 100:.1f} cm, lapisan: ' + ', '.join(f"{p['name']} {sum(len(f) - 2 for f in p['faces'])}" for p in layers))
    return dict(key=key, cid=cid, parts=parts, rt=rt, P=P, k=k, fit=fit)


def add_bl(var):
    S = COSTUMES[var['cid']]
    if not S.get('bl'):
        return
    B = BLP.Body(var)
    meshes = [m for m in S['bl'](B) if not m.empty()]
    for m in meshes:
        p = m.finish()
        P = p['rest']; ws = p['wspec']
        if ws[0] == 'bone':
            ow = np.zeros((len(P), len(BONES)), dtype=np.float32); ow[:, BI[ws[1]]] = 1
        elif ws[0] == 'fn':
            ow = ws[1](P)
        else:
            # sabuk/ikat pinggang & benda yang menempel padanya: bobot badan menurut tinggi (pinggul ↔ perut ↔ dada), sama dengan
            # pembagian C3.Retarget.our_weights. (Bobot "verteks tubuh terdekat" membuat cincin sabuk berduri saat jongkok/lari.)
            y = P[:, 1] if ws[0] == 'skin' else np.full(len(P), float(ws[1][1]))
            sm = lambda c, d: (lambda t: t * t * (3 - 2 * t))(np.clip((y - (c - d)) / (2 * d), 0, 1))
            s1, s2 = sm(1.08, 0.075), sm(1.28, 0.085)
            ow = np.zeros((len(P), len(BONES)), dtype=np.float32)
            ow[:, BI['hips']] = 1 - s1; ow[:, BI['spine']] = s1 - s1 * s2; ow[:, BI['chest']] = s1 * s2
        p['ow'] = ow.astype(np.float32); p['slot'] = np.full(len(P), SI['fixed'], dtype=np.int64); p['srcmat'] = {}
        var['parts'].append(p)
    log('   bagian buatan:', ', '.join(f"{m.name} {len(np.concatenate(m.T))}" for m in meshes))


# ---------- Buang yang tertutup ----------
def _tree(parts, key, pred):
    V, F, off = [], [], 0
    for p in parts:
        if not pred(p):
            continue
        V.append(p[key]); F += [tuple(int(i) + off for i in f[:, 0]) for f in p['faces']]; off += len(p[key])
    return BVHTree.FromPolygons([tuple(v) for v in np.concatenate(V)], F) if V else None


def cull_hidden(parts, rings=2, dist=0.14):
    """seperti C3.cull_hidden, tetapi bagian buatan (hanya ada di pose diam) ikut menutupi: face dibuang bila tertutup di pose
    diam DAN (tertutup pakaian mhclo di pose-A, atau di pose diam ia hanya tertutup berkat bagian buatan)"""
    cl = lambda p: p['kind'] in ('cloth', 'shoe')
    t_rest = _tree(parts, 'rest', cl); t_rest0 = _tree(parts, 'rest', lambda p: cl(p) and not p.get('bl')); t_pos = _tree(parts, 'pos', lambda p: cl(p) and not p.get('bl'))
    H = C3.hemi_dirs()

    def hidden(p, key, t):
        c, n, _ = C3.face_geo(p[key], p['faces'])
        out = np.ones(len(c), dtype=bool)
        if t is None:
            out[:] = False; return out
        for i in range(len(c)):
            y = n[i]; x = C3.nrm(np.cross(y, [0.3, 0.5, 0.81])); z = np.cross(x, y)
            o = Vector(c[i] + y * 0.004)
            for d in H:
                if t.ray_cast(o, Vector(x * d[0] + y * d[1] + z * d[2]), dist)[0] is None:
                    out[i] = False; break
        return out
    for p in parts:
        if p['kind'] not in ('skin', 'cloth', 'shoe') or p.get('bl'):
            continue
        A = hidden(p, 'rest', t_rest); B0 = hidden(p, 'rest', t_rest0); Cc = hidden(p, 'pos', t_pos)
        vis = ~(A & (Cc | ~B0))
        for _ in range(rings):
            vv = np.zeros(len(p['pos']), dtype=bool)
            for f, k in zip(p['faces'], vis):
                if k:
                    vv[f[:, 0]] = True
            vis = np.array([k or vv[f[:, 0]].any() for f, k in zip(p['faces'], vis)])
        keep = [f for f, k in zip(p['faces'], vis) if k]
        before = len(p['faces'])
        if not keep:
            p['faces'] = []; continue
        pos, W, uv, faces, vi = C3.compact(p['pos'], p['W'], p['uv'], keep)
        p.update(pos=pos, W=W, uv=uv, faces=faces, rest=p['rest'][vi], ow=p['ow'][vi], slot=p['slot'][vi])
        log(f"   cull {p['name']}: {before} → {len(faces)} face")


def part_normals(p):
    if 'nrm' in p:
        return p['nrm']
    tris, _ = C3.tri_faces(p['faces'])
    return C3.vnormals(p['rest'], tris[:, :, 0])


def bake_ao(parts, dist=0.22):
    """oklusi sekitar per verteks (pose diam): sinar setengah bola ke semua bagian; bagian buatan (dua sisi) = sisi yang lebih terbuka"""
    t = _tree(parts, 'rest', lambda p: p['kind'] in ('skin', 'cloth', 'shoe'))
    H = C3.hemi_dirs(); wsum = H[:, 1].sum()
    for p in parts:
        if p['kind'] not in ('skin', 'cloth', 'shoe'):
            continue
        N = part_normals(p); P = p['rest']
        ao = np.ones(len(P))

        def one(sign):
            out = np.ones(len(P))
            for i in range(len(P)):
                y = N[i] * sign; x = C3.nrm(np.cross(y, [0.3, 0.5, 0.81])); z = np.cross(x, y)
                o = Vector(P[i] + y * 0.006); occ = 0.0
                for d in H:
                    loc, _n, _f, dd = t.ray_cast(o, Vector(x * d[0] + y * d[1] + z * d[2]), dist)
                    if loc is not None:
                        occ += d[1] * (1 - dd / dist) ** 0.5
                out[i] = 1 - occ / wsum
            return out
        ao = one(1.0)
        if p.get('bl'):
            ao = np.maximum(ao, one(-1.0))
        p['ao'] = np.clip(ao, 0, 1)


# ---------- Atlas & peta ----------
def island_prio(p, vi):
    q = p['rest'][vi]
    if p['kind'] == 'skin':
        return 2.0 if q[:, 1].mean() > 1.5 else 1.25
    if p['kind'] == 'eye':
        return 2.6
    return p.get('prio', 1.0) * (0.85 if p['kind'] == 'shoe' else 1.0)


_IMG = {}


def src_img(path):
    if path not in _IMG:
        _IMG[path] = C3.load_img(path)
    return _IMG[path]


def compose(var, res=RES):
    parts = var['parts']
    tid, bar, pid = C3.raster(parts, res)
    cov = tid >= 0
    alb = np.zeros((res, res, 3), dtype=np.float32); nor = np.zeros((res, res, 3), dtype=np.float32); nor[:] = (0.5, 0.5, 1.0)
    ao = np.ones((res, res), dtype=np.float32); rough = np.full((res, res), 0.8, dtype=np.float32); metal = np.zeros((res, res), dtype=np.float32)
    hgt = np.zeros((res, res), dtype=np.float32); mpt = np.ones((res, res), dtype=np.float32)
    slotmap = -np.ones((res, res), dtype=np.int16); skinm = np.zeros((res, res), dtype=np.float32); scalp = np.zeros((res, res), dtype=np.float32)
    ys, xs = np.nonzero(cov)
    side = var['atlas_side']
    for pi, p in enumerate(parts):
        if 'auv' not in p:
            continue
        sel = pid[ys, xs] == pi
        if not sel.any():
            continue
        y, x = ys[sel], xs[sel]
        t = tid[y, x] - p['tri_base']; b0 = bar[y, x, 0][:, None].astype(np.float64); b1 = bar[y, x, 1][:, None].astype(np.float64); b2 = 1 - b0 - b1
        w = np.concatenate([b0, b1, b2], axis=1)
        tv = p['tris'][t][:, :, 0]
        U = p['uv'][p['tris'][t][:, :, 1]]
        uv = U[:, 0] * b0 + U[:, 1] * b1 + U[:, 2] * b2
        sm = p.get('srcmat') or {}
        tex = {'diffuse': sm.get('diffuseTexture'), 'normal': sm.get('normalmapTexture'), 'ao': sm.get('aomapTexture')}

        def src(name, tex=tex, uv=uv):
            f = tex.get(name)
            if not f or not os.path.exists(f):
                return None
            s = C3.sample(src_img(f), uv[:, 0] % 1.0, uv[:, 1] % 1.0)
            return C3.s2l(s) if name == 'diffuse' else s
        sl = p['slot'][tv]; s = sl[np.arange(len(sl)), np.argmax(w, axis=1)]
        slotmap[y, x] = s
        if p['kind'] in ('skin', 'eye'):
            alb[y, x] = src('diffuse')[:, :3]
            sn = src('normal')
            if sn is not None:
                nor[y, x] = sn[:, :3]
            r = np.array([C3.ROUGH[n] for n in C3.SLOTS])[s]
            if p['kind'] == 'eye':
                r[:] = 0.07
            rough[y, x] = r
            if p['kind'] == 'skin':
                skinm[y, x] = 1.0
                ao[y, x] = 0.6 + 0.4 * (p['ao'][tv] * w).sum(axis=1)
                if 'scalp' in p:
                    scalp[y, x] = (p['scalp'][tv] * w).sum(axis=1)
            continue
        N = part_normals(p)
        Pt = (p['rest'][tv] * w[:, :, None]).sum(axis=1); Nt = (N[tv] * w[:, :, None]).sum(axis=1)
        Nt /= np.maximum(np.linalg.norm(Nt, axis=1, keepdims=True), 1e-9)
        aot = (p['ao'][tv] * w).sum(axis=1)
        sa = src('ao')
        if sa is not None:
            aot = aot * (0.35 + 0.65 * sa[:, 0])
        armw = p['ow'][:, [BI[b] for b in ('armL', 'foreL', 'handL', 'armR', 'foreR', 'handR')]].sum(axis=1)
        ctx = dict(P=Pt, N=Nt, uv=uv, q=(p['q'][tv] * w[:, :, None]).sum(axis=1) if 'q' in p else None, ao=aot, arm=(armw[tv] * w).sum(axis=1), src=src)
        name, kw = p['mat']
        o = TX.MATS[name](ctx, **kw)
        alb[y, x] = o['alb']; rough[y, x] = np.clip(o['rough'], 0.04, 1); metal[y, x] = np.clip(o['metal'], 0, 1); ao[y, x] = aot
        if 'h' in o and o['h'] is not None:
            hgt[y, x] = o['h']
        if 'nor' in o:
            nor[y, x] = o['nor']
        # meter per texel pulau ini (skala seragam per pulau = sisi atlas / res / prioritas)
        mpt[y, x] = side / res / np.array([island_prio(p, np.unique(p['tris'][p['tri_isl'] == ii][:, :, 0])) for ii in np.unique(p['tri_isl'])])[np.searchsorted(np.unique(p['tri_isl']), p['tri_isl'][t])]
    # relief → normal tangen (x = u, y = v pada larik; gaya OpenGL), ditambahkan ke normal sumber
    dx = np.zeros_like(hgt); dy = np.zeros_like(hgt)
    okx = (pid[:, 2:] == pid[:, :-2]) & (pid[:, 1:-1] >= 0); oky = (pid[2:, :] == pid[:-2, :]) & (pid[1:-1, :] >= 0)
    dx[:, 1:-1] = np.where(okx, (hgt[:, 2:] - hgt[:, :-2]) * 0.5, 0); dy[1:-1, :] = np.where(oky, (hgt[2:, :] - hgt[:-2, :]) * 0.5, 0)
    n = nor * 2 - 1
    n[:, :, 0] -= dx / mpt; n[:, :, 1] -= dy / mpt
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-9)
    nor = n * 0.5 + 0.5
    var['maps'] = dict(alb=alb, nor=nor, ao=ao, rough=rough, metal=metal, slot=slotmap, cov=cov, skin=skinm, scalp=scalp, tid=tid, bar=bar, pid=pid)
    return var['maps']


PY = shutil.which('python3')


def to_webp(png, out, size, q):
    """PNG → WebP lewat Pillow (python3 sistem); tanpa Pillow → PNG disalin apa adanya (lalu costume.json menunjuk .png)"""
    if PY:
        r = subprocess.run([PY, '-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]); s = int(sys.argv[3])\nim = im.resize((s, s), Image.LANCZOS) if im.size[0] != s else im\nim.save(sys.argv[2], "WEBP", quality=int(sys.argv[4]), method=6)',
                            png, out, str(size), str(q)], capture_output=True)
        if r.returncode == 0:
            return os.path.basename(out)
        log('   PERINGATAN: Pillow tidak tersedia, tekstur disimpan PNG:', r.stderr.decode()[-200:])
    alt = out.replace('.webp', '.png'); shutil.copy(png, alt)
    return os.path.basename(alt)


def finish_maps(var, prefix):
    Mp = var['maps']; alb, slot, cov = Mp['alb'].copy(), Mp['slot'], Mp['cov']
    lum = alb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    sk = (slot == SI['skin']) | (slot == SI['hand'])
    if sk.any():
        ls = lum[sk]; lo, hi = np.percentile(ls, [45, 92])
        mean = alb[sk][(ls >= lo) & (ls <= hi)].mean(axis=0)
        alb[sk] = alb[sk] / mean * C3.C_NEUTRAL
        sc = Mp['scalp'][..., None] * (0.82 + 0.18 * np.random.default_rng(7).random(Mp['scalp'].shape)[..., None])
        dark = np.minimum(alb, C3.C_NEUTRAL * 1.1) * np.array([0.30, 0.27, 0.26], dtype=np.float32)
        alb = np.where(sk[..., None], alb * (1 - sc) + dark * sc, alb)
    fx = slot == SI['fixed']
    alb[fx] *= C3.C_NEUTRAL
    alb = C3.dilate(np.clip(alb, 0, 1), cov, 10)
    nor = C3.dilate(Mp['nor'], cov, 10)
    rough = Mp['rough'] * (1 - Mp['scalp']) + 0.72 * Mp['scalp']
    orm = C3.dilate(np.stack([Mp['ao'], rough, Mp['metal']], axis=2), cov, 10)
    C3.save_img(prefix + '_albedo.png', C3.l2s(alb)); C3.save_img(prefix + '_normal.png', nor); C3.save_img(prefix + '_orm.png', orm)
    log('   peta disimpan', prefix)


# ---------- LOD ----------
LOD1 = 0.36


def build_lods(var):
    lods = [[], []]
    for p in var['parts']:
        if 'auv' not in p or not len(p['faces']):
            continue
        T = p['tris'][:, :, 0]; P = p['rest']
        hn = part_normals(p)
        tree = BVHTree.FromPolygons([tuple(v) for v in P], [tuple(int(i) for i in t) for t in T])
        if p['kind'] == 'skin':
            ishead = P[T].mean(axis=1)[:, 1] > 1.3
            z = P[:, 2]; y = P[:, 1]
            prot = np.clip((z - 0.0) / 0.07, 0, 1) * np.clip((y - 1.6) / 0.03, 0, 1) * np.clip((1.80 - y) / 0.03, 0, 1)
            groups = [('head', ishead, 1 - 0.7 * prot, C3.LOD_TARGET['head'][:2]), ('hand', ~ishead, None, None)]
        elif p['kind'] == 'eye':
            groups = [('eye', np.ones(len(T), dtype=bool), None, C3.LOD_TARGET['eye'][:2])]
        else:
            t0 = p.get('budget', 2000)
            groups = [(p['name'], np.ones(len(T), dtype=bool), None, (t0, max(int(t0 * LOD1), 24)))]
        for kind, tm, wts, tg in groups:
            if not tm.any():
                continue
            used = np.unique(T[tm]); rm = -np.ones(len(P), dtype=np.int64); rm[used] = np.arange(len(used))
            sp, st, su = P[used], rm[T[tm]], p['auv'][tm]
            if tg is None:  # tangan + kulit lain yang terbuka (lengan, kaki): jatah menurut luas
                a3 = P[T[tm]]; area = float((0.5 * np.linalg.norm(np.cross(a3[:, 1] - a3[:, 0], a3[:, 2] - a3[:, 0]), axis=1)).sum())
                tg = tuple(C3.LOD_TARGET['hand'][li] + C3.ARM_EXTRA[li] * max(0.0, area - 0.11) * 0.6 for li in (0, 1))
            for li in (0, 1):
                r = min(1.0, tg[li] / len(st))
                dp, dtri, duv = C3.decimate(f"{p['name']}_{kind}_{li}", sp, st, su, r, None if wts is None else wts[used])
                if len(dtri) == 0:
                    continue
                pp = dict(rest=P, ow=p['ow'], slot=p['slot'])
                ow, nor_, slot = C3.transfer(pp, tree, T, hn, dp)
                G = C3.to_gl(dp, dtri, duv, dict(ow=ow, nor=nor_, slot=slot))
                G['kind'] = kind
                lods[li].append(G)
    out = []
    for li, chunks in enumerate(lods):
        off = 0; tri = []
        for c in chunks:
            tri.append(c['tri'] + off); off += len(c['pos'])
        L = dict(pos=np.concatenate([c['pos'] for c in chunks]), nor=np.concatenate([c['nor'] for c in chunks]), uv=np.concatenate([c['uv'] for c in chunks]),
                 ow=np.concatenate([c['ow'] for c in chunks]), slot=np.concatenate([c['slot'] for c in chunks]), tri=np.concatenate(tri))
        log(f"   LOD{li}: {len(L['pos'])} verteks, {len(L['tri'])} segitiga")
        L['detail'] = {c['kind']: int(len(c['tri'])) for c in chunks}
        out.append(L)
    return out


def export_glb(var, lods, out_dir):
    key = var['key']
    g = C3.GLB(); sk = g.skeleton()
    names = []
    for li, L in enumerate(lods):
        j, w = C3.top4(L['ow'])
        g.mesh(f'{key}_lod{li}', L['pos'], L['nor'], L['uv'], L['tri'], j, w, L['slot'], sk)
        names.append(f'{key}_lod{li}')
    size = g.write(os.path.join(out_dir, f'{key}.glb'))
    log(f'   {key}.glb {size / 1024:.0f} KB')
    return names, size


# ---------- Kredit ----------
def credit_of(a, p):
    f = glob.glob(os.path.join(p['folder'], '*.mhclo'))[0]
    meta = {}
    with open(f, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            s = line.strip().lstrip('#').strip().split(None, 1)
            if len(s) == 2 and s[0].lower() in ('author', 'license', 'homepage', 'name') and s[0].lower() not in meta:
                meta[s[0].lower()] = s[1]
            if line.startswith('verts'):
                break
    pack = os.path.basename(os.path.dirname(os.path.dirname(p['folder']))) if p['src'].startswith('PK:') else 'makehuman_system_assets_cc0'
    base = pack.replace('_cc0', '')
    return dict(asset=p['name'], author=meta.get('author', 'MakeHuman community'), license=meta.get('license', 'CC0'), pack=pack,
                url=f'http://files.makehumancommunity.org/asset_packs/{base}/{pack}.zip', use='geometri pakaian (warna & motif dibuat ulang)')


def write_credits(out_dir):
    rows = {}
    for f in sorted(glob.glob(os.path.join(out_dir, '*', 'costume.json'))):
        J = json.load(open(f))
        for c in J.get('credits', []):
            rows.setdefault((c['asset'], c['author'], c['license'], c['url']), []).append(J['id'])
    L = ['# Kredit aset kostum', '', 'Dibangkitkan oleh `tools/blender/costumes.py` dari `costume.json` tiap kostum. Semua aset pihak ketiga berlisensi CC0',
         '(domain publik; kredit tidak diwajibkan, dicantumkan sebagai penghargaan). Bentuk tubuh, kulit, mata, dan alis: MakeHuman (CC0).',
         'Semua motif (parang, bulu, rajut), warna, dan bagian khas Nusantara (blangkon, jarik, keris, selop, helm berparuh, sayap, dodot,',
         'plate carrier, NVG) adalah buatan sendiri (`tools/blender/costume_parts.py`, `costume_tex.py`).', '',
         '| Aset | Pembuat | Lisensi | Sumber | Dipakai di |', '|---|---|---|---|---|']
    for (asset, author, lic, url), ids in sorted(rows.items()):
        L.append(f'| {asset} | {author} | {lic} | {url} | {", ".join(sorted(set(ids)))} |')
    open(os.path.join(out_dir, 'CREDITS.md'), 'w').write('\n'.join(L) + '\n')


# ---------- Lembar kontak & thumb (Cycles CPU) ----------
def sheet_object(name, L, prefix, tone='#c68c66', glove=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in C3.to_bl(L['pos'])], [], [tuple(int(i) for i in t) for t in L['tri']])
    ul = me.uv_layers.new(name='atlas'); ul.data.foreach_set('uv', L['uv'][L['tri'].ravel()].astype(np.float32).ravel())
    cols = np.ones((8, 4))
    cols[0, :3] = C3.hex_lin(tone); cols[1, :3] = C3.hex_lin(glove or tone)
    ca = me.color_attributes.new(name='tint', type='FLOAT_COLOR', domain='POINT'); ca.data.foreach_set('color', cols[L['slot']].astype(np.float32).ravel())
    me.normals_split_custom_set_from_vertices([tuple(v) for v in C3.to_bl(L['nor'])])
    for pl in me.polygons:
        pl.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new(name + '_m'); m.use_nodes = True
    nt = m.node_tree; bs = nt.nodes.get('Principled BSDF')

    def tex(path, cs):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(path, check_existing=True); n.image.colorspace_settings.name = cs
        return n
    ta, tn, to = tex(prefix + '_albedo.png', 'sRGB'), tex(prefix + '_normal.png', 'Non-Color'), tex(prefix + '_orm.png', 'Non-Color')
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'tint'
    mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'
    nt.links.new(ta.outputs['Color'], mul.inputs[0]); nt.links.new(vc.outputs['Color'], mul.inputs[1])
    sc2 = nt.nodes.new('ShaderNodeVectorMath'); sc2.operation = 'SCALE'; sc2.inputs['Scale'].default_value = 1 / C3.C_NEUTRAL
    nt.links.new(mul.outputs['Vector'], sc2.inputs[0])
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sc2.outputs['Vector'], bs.inputs['Base Color'])
    nt.links.new(sep.outputs['Green'], bs.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bs.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'atlas'; nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    me.materials.append(m)
    return ob


def render_sheet(var, lods, prefix, out_dir, thumb=None, glove=None):
    C3.reset_scene()
    sc = C3.setup_render(520, 940, 20)
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.64, 0.68, 1)
    fl = bpy.data.meshes.new('floor'); fl.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('floor', fl); sc.collection.objects.link(fo)
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.36, 0.36, 0.36, 1); fl.materials.append(fm)
    sheet_object('cos', lods[0], prefix, glove=glove)
    tag = f"{var['cid']}_{var['key']}"
    outs = []
    for nm, loc in (('depan', (0, -6, 0.96)), ('kiri', (6, 0, 0.96)), ('belakang', (0, 6, 0.96)), ('serong', (-3.6, -4.8, 1.3))):
        sc.camera = C3.ortho_cam(nm, loc, (0, 0, 0.96), 2.08)
        sc.render.filepath = os.path.join(out_dir, f'{tag}_{nm}.png'); bpy.ops.render.render(write_still=True); outs.append(sc.render.filepath)
    sc.render.resolution_x, sc.render.resolution_y = 640, 640
    sc.camera = C3.persp_cam('dekat', (0.85, -1.55, 1.62), (0, 0, 1.5), 60)
    sc.render.filepath = os.path.join(out_dir, f'{tag}_dekat.png'); bpy.ops.render.render(write_still=True); outs.append(sc.render.filepath)
    if thumb:  # gambar toko: tiga perempat badan, latar transparan
        sc.render.film_transparent = True; fo.hide_render = True
        sc.render.resolution_x, sc.render.resolution_y = 512, 512
        sc.render.image_settings.color_mode = 'RGBA'
        sc.camera = C3.ortho_cam('thumb', (2.4, -4.6, 1.5), (0, 0, 1.27), 1.12)
        png = os.path.join(out_dir, f'{tag}_thumb.png')
        sc.render.filepath = png; bpy.ops.render.render(write_still=True)
        to_webp(png, thumb, 256, 88)
    return outs


# ---------- utama ----------
def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mpfb', required=True); ap.add_argument('--assets', required=True); ap.add_argument('--packs', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--work', required=True)
    ap.add_argument('--only', default=''); ap.add_argument('--variants', default='m1,f1,m2,f2'); ap.add_argument('--stage', default='all'); ap.add_argument('--sheet', default='')
    return ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def main(a):
    os.makedirs(a.work, exist_ok=True)
    if a.sheet:
        os.makedirs(a.sheet, exist_ok=True)
    C3.island_prio = island_prio  # prioritas texel per bagian kostum
    mh = mhdata.MakeHuman(a.mpfb, a.assets)
    ids = [k for k in (a.only.split(',') if a.only else COSTUMES.keys()) if k]
    keys = [k for k in a.variants.split(',') if k in C3.VARIANTS]
    for cid in ids:
        S = COSTUMES[cid]
        odir = os.path.join(a.out, cid); os.makedirs(odir, exist_ok=True)
        jp = os.path.join(odir, 'costume.json')
        J = json.load(open(jp)) if os.path.exists(jp) else {}
        variants = J.get('variants', {}); fits = J.get('fit', {})
        credits = []
        for key in keys:
            t0 = time.time()
            var = build_base(a, mh, cid, key)
            add_bl(var)
            cull_hidden(var['parts'])
            var['parts'] = [p for p in var['parts'] if len(p['faces'])]
            var['atlas_side'] = C3.build_atlas(var['parts'], res=RES)
            prefix = os.path.join(a.work, f'{cid}_{key}')
            if a.stage == 'all':
                bake_ao(var['parts'])
                C3.mark_scalp(var)
                compose(var)
                C3.composite_brows(var, RES)
                finish_maps(var, prefix)
            lods = build_lods(var)
            if a.stage != 'sheet':
                names, size = export_glb(var, lods, odir)
                mv = variants.get(key, {})
                mv.update(glb=f'{key}.glb', lods=names, tris=[int(len(L['tri'])) for L in lods], verts=[int(len(L['pos'])) for L in lods], detail=lods[0]['detail'], glbBytes=size)
                if a.stage == 'all':
                    mv['albedo'] = to_webp(prefix + '_albedo.png', os.path.join(odir, f'{key}_albedo.webp'), 2048, 84)
                    mv['normal'] = to_webp(prefix + '_normal.png', os.path.join(odir, f'{key}_normal.webp'), 1024, 88)
                    mv['orm'] = to_webp(prefix + '_orm.png', os.path.join(odir, f'{key}_orm.webp'), 1024, 84)
                    mv['texBytes'] = sum(os.path.getsize(os.path.join(odir, mv[k])) for k in ('albedo', 'normal', 'orm'))
                variants[key] = mv
                fits[key] = {n: dict(pushed=round(f[0], 4), deepest_mm=round(f[1] * 1000, 1)) for n, f in var['fit'].items()}
                credits = [credit_of(a, p) for p in var['parts'] if p.get('src')] or credits
            if a.sheet and os.path.exists(prefix + '_albedo.png'):
                render_sheet(var, lods, prefix, a.sheet, thumb=os.path.join(odir, 'thumb.webp') if key == keys[0] and a.stage != 'sheet' else None, glove=S.get('glove'))
            log(f'{cid} {key} selesai dalam {time.time() - t0:.0f} dtk')
        if a.stage != 'sheet':
            J = dict(version=1, id=cid, name=S['name'], bones=BONES, variants={k: variants[k] for k in C3.VARIANTS if k in variants},
                     hideHair=bool(S.get('hideHair')), hideHelmet=bool(S.get('hideHelmet')), hideVest=bool(S.get('hideVest')), hidePack=bool(S.get('hidePack')),
                     glove=S.get('glove'), far=S.get('far'), thumb='thumb.webp' if os.path.exists(os.path.join(odir, 'thumb.webp')) else None,
                     springs=[], mech=[], emis=None, fp=None, fit=fits, credits=credits or J.get('credits', []),
                     note='glTF: +Y atas, menghadap +Z, kiri = +X; mesh ber-skin pada pose diam rig.js (17 tulang "bones"). _SLOT: 0 kulit, 1 tangan, 7 tetap. Albedo × 0,5 (netral tubuh v3); ORM = AO, kekasaran, logam.')
            json.dump(J, open(jp, 'w'), indent=1)
            log('manifest', jp)
    if a.stage != 'sheet':
        write_credits(a.out)


if __name__ == '__main__':
    main(parse_args())
