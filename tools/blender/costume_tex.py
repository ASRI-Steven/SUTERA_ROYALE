# Bahan & motif kostum (tools/blender/costumes.py) — murni numpy, dihitung per texel atlas. Semua motif buatan sendiri
# (parang, bulu, rajut, ripstop, anyaman): tidak ada tekstur pihak ketiga selain peta sumber aset MakeHuman CC0 (dipakai
# hanya sebagai bayangan lipatan / AO / normal; warnanya ditentukan ulang di sini).
#
# Fungsi bahan: fn(ctx, **param) → dict(alb (n,3) linear, rough (n,), metal (n,), h (n,) tinggi relief dalam meter [opsional],
# nor (n,3) normal tangen dari peta sumber [opsional]). ctx (per texel):
#   P, N   : posisi & normal pada pose diam game (meter; +Y atas, +Z depan, +X kiri karakter)
#   uv     : uv sumber bagian itu (bagian buatan sendiri: uv dalam METER), q: parameter ternormalkan bagian buatan (atau None)
#   ao     : oklusi sekitar per verteks (0..1), arm: bobot lengan (0..1), src(nama) → sampel peta sumber ('diffuse', 'normal', 'ao')
import math
import numpy as np


def lin(h):
    h = h.lstrip('#'); c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t)
    if t.ndim == 1 and np.ndim(a) + np.ndim(b) > 1:
        t = t[:, None]
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


# ---------- derau ----------
def _hash(i, j, k=0, seed=0):
    n = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 974711) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, y, z=None, seed=0):
    """derau nilai halus 2D/3D → 0..1"""
    z = np.zeros_like(x) if z is None else z
    xi, yi, zi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), np.floor(z).astype(np.int64)
    fx, fy, fz = x - xi, y - yi, z - zi
    fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    out = 0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy) * (fz if dz else 1 - fz)
                out = out + w * _hash(xi + dx, yi + dy, zi + dz, seed)
    return out


def fbm(P, scale, octaves=4, seed=0):
    x, y, z = P[:, 0] * scale, P[:, 1] * scale, P[:, 2] * scale
    a, s, out, tot = 0.5, 1.0, 0, 0
    for o in range(octaves):
        out = out + a * vnoise(x * s, y * s, z * s, seed + o * 17); tot += a; a *= 0.5; s *= 2.03
    return out / tot


# ---------- koordinat permukaan ----------
def wrap_coords(ctx, R=0.17, arm_r=0.05):
    """(a, y): a = busur keliling (m) — badan/kaki mengelilingi sumbu Y; lengan mengelilingi sumbu lengannya sendiri"""
    P = ctx['P']
    a_body = np.arctan2(P[:, 0], P[:, 2]) * R
    sx = np.sign(P[:, 0])
    a_arm = np.arctan2((P[:, 0] - sx * 0.2) * sx, P[:, 2]) * arm_r * 1.6 + sx * 0.3
    arm = ctx.get('arm')
    if arm is None:
        return a_body, P[:, 1]
    return np.where(arm > 0.5, a_arm, a_body), P[:, 1]


def shade(ctx, k=0.6, norm=True):
    """bayangan lipatan dari kecerahan diffuse sumber (dinormalkan ke rata-rata 1) × AO; tanpa sumber → AO saja"""
    s = ctx['src']('diffuse')
    ao = ctx['ao']
    if s is None:
        return 0.55 + 0.45 * ao
    lum = s[:, :3] @ np.array([0.2126, 0.7152, 0.0722])
    lum = lum / max(float(np.median(lum)), 1e-3) if norm else lum
    return (1 - k + k * np.clip(lum, 0.25, 1.6)) * (0.55 + 0.45 * ao)


def _out(ctx, alb, rough, metal=0.0, h=None, use_src_normal=True):
    n = len(ctx['P'])
    o = dict(alb=np.clip(alb, 0, 1), rough=np.broadcast_to(np.asarray(rough, dtype=np.float64), (n,)).copy(), metal=np.broadcast_to(np.asarray(metal, dtype=np.float64), (n,)).copy())
    if h is not None:
        o['h'] = h
    if use_src_normal:
        sn = ctx['src']('normal')
        if sn is not None:
            o['nor'] = sn[:, :3]
    return o


# ---------- kain polos ----------
def cloth(ctx, col='#333333', col2=None, rough=0.9, k=0.6, grain=0.08, weave=0.0, seed=0):
    P = ctx['P']
    c = lin(col)
    f = fbm(P, 9.0, 3, seed)
    alb = c[None] * (1 - grain + 2 * grain * f)[:, None]
    if col2 is not None:  # belang lembut (kain pudar / dua warna benang)
        alb = mix(alb, lin(col2)[None] * np.ones((len(P), 1)), sstep(0.45, 0.75, fbm(P, 3.0, 3, seed + 5)) * 0.6)
    alb = alb * shade(ctx, k)[:, None]
    h = None
    if weave > 0:
        a, y = wrap_coords(ctx)
        h = 0.00025 * (np.sin(a * 2 * math.pi / weave) * np.sin(y * 2 * math.pi / weave))
    return _out(ctx, alb, rough + 0.06 * (f - 0.5), 0.0, h)


def ripstop(ctx, col='#1b1c20', rough=0.88, cell=0.012, seed=0, camo=None, camo_scale=9.0):
    """kain taktis: kisi benang penguat tipis. camo = [warna, warna]: loreng bercak (dua lapis derau) di atas warna dasar"""
    a, y = wrap_coords(ctx)
    g = np.maximum(np.abs(((a / cell) % 1) - 0.5), np.abs(((y / cell) % 1) - 0.5))
    line = sstep(0.40, 0.48, g)
    f = fbm(ctx['P'], 11.0, 3, seed)
    base = np.repeat(lin(col)[None], len(f), axis=0)
    for k, c in enumerate(camo or []):
        n = fbm(ctx['P'] * np.array([1.0, 0.55, 1.0]), camo_scale * (1 + 0.45 * k), 3, seed + 31 + 13 * k)
        base = mix(base, lin(c)[None], sstep(0.52 + 0.03 * k, 0.56 + 0.03 * k, n))
    alb = base * (0.9 + 0.2 * f)[:, None] * (1 + 0.22 * line)[:, None] * shade(ctx, 0.65)[:, None]
    return _out(ctx, alb, rough - 0.05 * line, 0.0, 0.00035 * line)


def knit(ctx, col='#17181b', rough=0.95, rib=0.009, center=(0.0, 0.0), seed=0):
    """rajut berusuk (balaclava): rusuk tegak mengelilingi kepala"""
    P = ctx['P']
    th = np.arctan2(P[:, 0] - center[0], P[:, 2] - center[1]) * 0.1
    r = 0.5 + 0.5 * np.sin(th * 2 * math.pi / rib)
    st = 0.5 + 0.5 * np.sin(P[:, 1] * 2 * math.pi / (rib * 0.6))
    f = fbm(P, 20.0, 2, seed)
    alb = lin(col)[None] * ((0.72 + 0.4 * r) * (0.93 + 0.1 * st) * (0.9 + 0.2 * f))[:, None] * (0.6 + 0.4 * ctx['ao'])[:, None]
    return _out(ctx, alb, rough, 0.0, 0.0007 * r + 0.00015 * st, use_src_normal=False)


def leather(ctx, col='#1a1614', rough=0.55, k=0.5, seed=0):
    P = ctx['P']
    f = fbm(P, 35.0, 3, seed); g = fbm(P, 140.0, 2, seed + 3)
    alb = lin(col)[None] * (0.85 + 0.3 * f)[:, None] * shade(ctx, k)[:, None]
    return _out(ctx, alb, rough + 0.2 * (f - 0.5), 0.0, 0.0002 * g)


def nylon(ctx, col='#1f2126', col_web='#15161a', rough=0.82, web=0.0, seed=0):
    """cordura rompi; web > 0: pita MOLLE mendatar tiap `web` meter (lebar separuhnya), dijahit tegak tiap 3,8 cm"""
    P = ctx['P']
    f = fbm(P, 60.0, 2, seed)
    wv = np.sin(P[:, 0] * 2 * math.pi / 0.004) * np.sin(P[:, 1] * 2 * math.pi / 0.004)
    alb = lin(col)[None] * (0.86 + 0.28 * f)[:, None]
    h = 0.00012 * wv
    if web > 0:
        band = sstep(0.0, 0.08, 0.25 - np.abs(((P[:, 1] / web) % 1) - 0.5))
        a = np.arctan2(P[:, 0], P[:, 2]) * 0.17
        stitch = sstep(0.42, 0.47, np.abs(((a / 0.038) % 1) - 0.5)) * band
        alb = mix(alb, lin(col_web)[None] * (0.9 + 0.2 * f)[:, None], band)
        alb = alb * (1 - 0.45 * stitch)[:, None]
        h = h + 0.0012 * band - 0.0008 * stitch
    alb = alb * (0.5 + 0.5 * ctx['ao'])[:, None]
    return _out(ctx, alb, rough, 0.0, h, use_src_normal=False)


def flat(ctx, col='#808080', rough=0.5, metal=0.0, edge=0.0, seed=0):
    """bahan keras polos (plastik, logam cat, kaca gelap): sedikit variasi + AO"""
    f = fbm(ctx['P'], 30.0, 3, seed)
    alb = lin(col)[None] * (0.92 + 0.16 * f)[:, None] * (0.6 + 0.4 * ctx['ao'])[:, None]
    return _out(ctx, alb, rough + 0.12 * (f - 0.5), metal, None, use_src_normal=False)


# ---------- logam ----------
GOLD = np.array([1.0, 0.72, 0.29])


def gold(ctx, tint=None, rough=0.3, dark=0.5, engrave=None, k=0.55, seed=0, accent=None, accent_at=None):
    """emas (logam = 1): warna dasar F0 emas; celah (AO rendah / diffuse sumber gelap) digelapkan seperti patina.
    engrave='feather' → ukiran sisik bulu bertumpuk; accent (heks) + accent_at(ctx) → topeng 0..1 email berwarna (non-logam)"""
    P = ctx['P']
    c = GOLD if tint is None else lin(tint)
    f = fbm(P, 22.0, 3, seed)
    s = ctx['src']('diffuse')
    cav = ctx['ao'].copy()
    if s is not None:  # diffuse sumber zirah: panel terang, celah & alur gelap → dipakai sebagai topeng alur
        lum = s[:, :3] @ np.array([0.2126, 0.7152, 0.0722])
        lum = lum / max(float(np.percentile(lum, 75)), 1e-3)
        cav = cav * np.clip(0.35 + 0.65 * np.clip(lum, 0, 1.15), 0, 1)
    h = None
    r = rough + 0.16 * (f - 0.5)
    alb = c[None] * (0.9 + 0.14 * f)[:, None]
    if engrave == 'feather':
        a, y = wrap_coords(ctx, 0.2)
        sc = 0.034
        row = np.floor(y / (sc * 0.62)); u = a / sc + 0.5 * (row % 2)
        fx = (u % 1) - 0.5; fy = (y / (sc * 0.62)) % 1
        d = np.sqrt(fx * fx * 4 + (fy - 1.0) ** 2 * 0.9)  # sisik: busur setengah lingkaran membuka ke bawah
        scale = sstep(0.95, 0.8, d); rim = sstep(0.62, 0.8, d) * scale
        quill = sstep(0.06, 0.02, np.abs(fx)) * sstep(0.2, 0.5, fy)
        h = 0.0011 * scale * (1 - 0.6 * fy) + 0.0005 * rim + 0.0004 * quill
        alb = alb * (0.78 + 0.22 * scale + 0.1 * rim)[:, None]
        r = r + 0.1 * (1 - scale) - 0.06 * rim
    alb = alb * (dark + (1 - dark) * np.clip(cav, 0, 1))[:, None]
    metal = np.ones(len(P))
    if accent is not None and accent_at is not None:
        m = np.clip(accent_at(ctx), 0, 1)
        ca = lin(accent)[None] * (0.85 + 0.3 * f)[:, None] * (0.55 + 0.45 * ctx['ao'])[:, None]
        alb = mix(alb, ca, m); metal = 1 - m; r = mix(r, 0.34, m)
    return _out(ctx, alb, r + 0.25 * (1 - np.clip(cav, 0, 1)) * (0 if s is None else 1), metal, h, use_src_normal=False)


def steel(ctx, col='#2a2c30', rough=0.42, metal=0.85, seed=0):
    f = fbm(ctx['P'], 40.0, 3, seed)
    alb = lin(col)[None] * (0.85 + 0.3 * f)[:, None] * (0.55 + 0.45 * ctx['ao'])[:, None]
    return _out(ctx, alb, rough + 0.2 * (f - 0.5), metal, None, use_src_normal=False)


# ---------- batik parang (motif buatan) ----------
def parang_field(a, y, period=0.075, ang=math.radians(45)):
    """→ topeng 0..1: lidah (pita bergelombang menerus di tiap jalur miring, bertakik tiap gelombang seperti deret kait
    parang), inti (garis tengah pita), mata (titik di tiap perut gelombang), mlinjon (belah ketupat di jalur pemisah),
    garis (tepi jalur). Jalur miring `ang` dari mendatar, lebar `period`."""
    ca, sa = math.cos(ang), math.sin(ang)
    u = (a * ca + y * sa) / period          # melintang jalur
    v = (-a * sa + y * ca)                  # sepanjang jalur (m)
    ui = np.floor(u); uf = u - ui
    strip = 0.2
    sm = uf < strip
    L2 = period * 0.36
    dv = ((v / L2 + 0.5 * (ui % 2)) % 1) - 0.5
    du = (uf / strip) - 0.5
    dia = sstep(0.5, 0.38, np.abs(dv) + np.abs(du)) * sm
    dia_in = sstep(0.2, 0.1, np.abs(dv) + np.abs(du)) * sm
    edge = sstep(0.035, 0.012, np.abs(uf - strip)) + sstep(0.035, 0.012, np.minimum(uf, 1 - uf))
    w = (uf - strip) / (1 - strip)          # 0..1 melintang jalur utama
    L = period * 0.95
    tv = v / L + 0.5 * (ui % 2)
    tf = tv % 1
    cx = 0.5 + 0.2 * np.sin(tv * 2 * math.pi)
    th = 0.2 + 0.05 * np.cos(tv * 4 * math.pi)
    d = np.abs(w - cx)
    body = sstep(th, th * 0.72, d)
    # takik miring tiap gelombang → pita terputus jadi deret kait
    notch = sstep(0.055, 0.03, np.abs(tf - 0.5 + (w - 0.5) * 0.35))
    body = body * (1 - notch) * (~sm)
    core = sstep(0.05, 0.02, d) * (1 - notch) * (~sm)
    ex, ey = w - (0.5 + 0.2 * np.sin(2 * math.pi * 0.25) * np.where(tf < 0.5, 1, -1)), (tf - np.where(tf < 0.5, 0.25, 0.75)) * (L / (period * (1 - strip)))
    eye = sstep(0.085, 0.05, np.sqrt(ex * ex + ey * ey)) * (~sm)
    return dict(lidah=np.clip(body, 0, 1), inti=np.clip(core, 0, 1), mata=eye, mlinjon=dia, mlinjon_in=dia_in, garis=np.clip(edge, 0, 1), t=v, jalur=ui)


def batik_parang(ctx, latar='#4a2812', motif='#e2cfa0', gelap='#1c1210', emas='#c8963c', period=0.075, rough=0.78, k=0.55, coords=None, prada=0.5, seed=0):
    """batik parang: latar (sogan atau krem), pita kait `motif` bertepi gelap dengan mata, mlinjon di jalur pemisah, garis jalur
    & inti pita berprada emas (prada = kadar 0..1)"""
    a, y = coords(ctx) if coords else wrap_coords(ctx)
    F = parang_field(a, y, period)
    P = ctx['P']
    f = fbm(P, 14.0, 3, seed)
    n = len(P)
    cl, cm, cg = lin(latar), lin(motif), lin(gelap)
    alb = np.tile(cl, (n, 1)) * (0.86 + 0.28 * f)[:, None]
    outline = np.clip(sstep(0.0, 0.45, F['lidah']) - sstep(0.55, 0.95, F['lidah']), 0, 1)
    alb = mix(alb, cm[None] * (0.9 + 0.18 * f)[:, None], sstep(0.55, 0.95, F['lidah']))
    alb = mix(alb, np.tile(cg, (n, 1)), outline * 0.9)
    alb = mix(alb, np.tile(cg, (n, 1)), F['mata'] * 0.95)
    alb = mix(alb, np.tile(cm, (n, 1)), F['mlinjon'] * 0.92)
    alb = mix(alb, np.tile(cg, (n, 1)), F['mlinjon_in'])
    g = np.clip(F['garis'] + F['inti'] * 0.9, 0, 1) * prada
    alb = mix(alb, np.tile(lin(emas), (n, 1)), g)
    alb = alb * shade(ctx, k)[:, None]
    return _out(ctx, alb, rough - 0.4 * g + 0.08 * (f - 0.5), g * 0.9, 0.00035 * g + 0.00012 * F['lidah'])


# ---------- bagian buatan: bahan berbasis parameter q ----------
def feather(ctx, base='#d9a23a', tip='#7a1420', rough=0.36, metal=1.0, seed=0):
    """bulu sayap (q = (u −1..1 melintang, v 0 pangkal..1 ujung)): tangkai timbul, alur barbula miring, ujung merah hati"""
    q = ctx['q']
    u, v = q[:, 0], q[:, 1]
    P = ctx['P']
    f = fbm(P, 30.0, 3, seed)
    rachis = sstep(0.11, 0.03, np.abs(u))
    barb = 0.5 + 0.5 * np.sin((v * 46.0 - np.abs(u) * 9.0) * math.pi)
    tipm = sstep(0.72, 0.98, v + 0.12 * np.abs(u))
    c = GOLD if base is None else lin(base)
    alb = c[None] * (0.8 + 0.12 * f + 0.14 * barb)[:, None]
    alb = mix(alb, lin(tip)[None] * (0.8 + 0.3 * barb)[:, None], tipm * 0.92)
    alb = mix(alb, (GOLD * 1.0)[None] * np.ones((len(u), 1)), rachis * 0.8)
    edge = sstep(0.75, 1.0, np.abs(u))
    alb = alb * (1 - 0.35 * edge)[:, None] * (0.5 + 0.5 * ctx['ao'])[:, None]
    m = metal * (1 - 0.85 * tipm * (1 - rachis))
    return _out(ctx, alb, rough + 0.12 * (1 - barb) + 0.25 * tipm, m, 0.0012 * rachis + 0.0004 * barb * (1 - rachis), use_src_normal=False)


def satin(ctx, col='#7a1420', rough=0.46, border=None, border_w=0.05, border_col='#c8963c', seed=0, pleat=0.0):
    """satin/sutra; border: fungsi(ctx) → jarak ke tepi kain (m) → pita tepi emas bermotif tumpal (segitiga) buatan"""
    P = ctx['P']
    f = fbm(P, 6.0, 3, seed)
    n = len(P)
    alb = lin(col)[None] * (0.82 + 0.36 * f)[:, None]
    metal = np.zeros(n); r = rough + 0.12 * (f - 0.5); h = np.zeros(n)
    if pleat > 0 and ctx.get('q') is not None:
        pl = np.sin(ctx['q'][:, 0] * math.pi * pleat)
        alb = alb * (0.8 + 0.2 * pl)[:, None]; h = h + 0.0015 * pl
    if border is not None:
        d = border(ctx)
        a, _y = wrap_coords(ctx)
        band = sstep(border_w, border_w * 0.9, d)
        tri = np.abs(((a / (border_w * 0.8)) % 1) - 0.5) * 2          # tumpal: deret segitiga menghadap ke dalam
        tum = sstep(0.0, 0.08, (1 - d / border_w) - tri) * band
        line = sstep(border_w * 1.25, border_w * 1.1, d) * (1 - band) + sstep(0.012, 0.004, d)
        g = np.clip(tum + line, 0, 1)
        alb = mix(alb, lin(border_col)[None] * (0.9 + 0.2 * f)[:, None], g)
        metal = g * 0.95; r = mix(r, 0.34, g); h = h + 0.0004 * g
    alb = alb * shade(ctx, 0.5)[:, None]
    return _out(ctx, alb, r, metal, h, use_src_normal=False)


def wood(ctx, col='#5b3a1f', rough=0.5, seed=0):
    P = ctx['P']
    g = fbm(P * np.array([1.0, 0.18, 1.0]), 90.0, 3, seed)
    ring = 0.5 + 0.5 * np.sin(g * 26.0)
    alb = lin(col)[None] * (0.7 + 0.45 * ring)[:, None] * (0.6 + 0.4 * ctx['ao'])[:, None]
    return _out(ctx, alb, rough + 0.1 * ring, 0.0, 0.0002 * ring, use_src_normal=False)


MATS = dict(cloth=cloth, ripstop=ripstop, knit=knit, leather=leather, nylon=nylon, flat=flat, gold=gold, steel=steel,
            batik_parang=batik_parang, feather=feather, satin=satin, wood=wood)
