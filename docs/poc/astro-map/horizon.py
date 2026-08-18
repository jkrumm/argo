"""
Terrain horizon profile from AWS terrarium tiles (z11, ~76 m/px at 48N), and
whether the galactic core clears it. Mountains are a hard gate the current
astro scorer has no input for at all.
    elevation = (R*256 + G + B/256) - 32768
"""
import math, os, urllib.request, json
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

Z = 11
CACHE = os.path.join(os.path.dirname(__file__), '.cache/terr'); os.makedirs(CACHE, exist_ok=True)
R_EARTH = 6371000.0
K_REFRACT = 0.13
R_EFF = R_EARTH / (1 - K_REFRACT)

def deg2num(lat, lon, z):
    n = 2 ** z
    return (lon + 180.0) / 360.0 * n, (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n

def fetch(z, xt, yt):
    p = f'{CACHE}/{z}_{xt}_{yt}.png'
    if not os.path.exists(p):
        try:
            d = urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{xt}/{yt}.png', timeout=40).read()
            open(p, 'wb').write(d)
        except Exception:
            return None
    return p

_grid = {}
def load(z, xt, yt):
    k = (z, xt, yt)
    if k in _grid: return _grid[k]
    p = fetch(z, xt, yt)
    if p is None: _grid[k] = None; return None
    a = np.asarray(Image.open(p).convert('RGB'), dtype=np.float64)
    _grid[k] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0
    return _grid[k]

def elevations(lats, lons):
    n = 2 ** Z
    xs = (lons + 180.0) / 360.0 * n
    ys = (1.0 - np.arcsinh(np.tan(np.radians(lats))) / np.pi) / 2.0 * n
    xt = xs.astype(int); yt = ys.astype(int)
    out = np.full(lats.shape, np.nan)
    for key in set(zip(xt.ravel().tolist(), yt.ravel().tolist())):
        g = load(Z, key[0], key[1])
        if g is None: continue
        m = (xt == key[0]) & (yt == key[1])
        h, w = g.shape
        i = np.clip(((xs[m] - key[0]) * w).astype(int), 0, w - 1)
        j = np.clip(((ys[m] - key[1]) * h).astype(int), 0, h - 1)
        out[m] = g[j, i]
    return out

SITES = [('Munich',48.1374,11.5755),('Alpenvorland (Bad Tolz)',47.8167,11.4667),
         ('Bayerischer Wald',48.9333,13.4167),('Walchensee',47.6,11.33)]
COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
compass = lambda az: COMPASS[round((az % 360) / 22.5) % 16]

R_MAX, STEP = 60000, 150
rs = np.arange(STEP, R_MAX + 1, STEP)
azs = np.arange(0, 360, 5)

# warm the tile cache in parallel — one fetch per tile the rays will touch
for name, lat, lon in SITES:
    pad = R_MAX / 111320.0 * 1.6
    x0, y0 = deg2num(lat - pad, lon - pad / math.cos(math.radians(lat)), Z)
    x1, y1 = deg2num(lat + pad, lon + pad / math.cos(math.radians(lat)), Z)
    need = [(int(x), int(y)) for x in range(int(min(x0,x1)), int(max(x0,x1)) + 1)
                             for y in range(int(min(y0,y1)), int(max(y0,y1)) + 1)]
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda t: fetch(Z, t[0], t[1]), need))

result = {}
for name, lat, lon in SITES:
    h0 = float(elevations(np.array([lat]), np.array([lon]))[0])
    A, Rr = np.meshgrid(np.radians(azs), rs, indexing='ij')
    dlat = (Rr * np.cos(A)) / 111320.0
    dlon = (Rr * np.sin(A)) / (111320.0 * math.cos(math.radians(lat)))
    H = elevations(lat + dlat, lon + dlon)
    drop = (Rr ** 2) / (2 * R_EFF)
    ang = np.degrees(np.arctan2(H - h0 - drop, Rr))
    ang = np.where(np.isnan(ang), -90.0, ang)
    best = ang.max(axis=1); bi = ang.argmax(axis=1)
    prof = {int(a): (float(best[k]), float(rs[bi[k]]), float(H[k, bi[k]])) for k, a in enumerate(azs)}
    result[name] = {'h0': h0, 'prof': prof}
    south = [prof[a][0] for a in range(150, 216, 5)]
    wa = max(prof, key=lambda a: prof[a][0])
    print(f'\n=== {name}  (elevation {h0:.0f} m) ===')
    print(f'  highest horizon : {prof[wa][0]:5.1f}° at az {wa:3d}° ({compass(wa)}), {prof[wa][1]/1000:.0f} km away, summit {prof[wa][2]:.0f} m')
    print(f'  southern arc 150-215° : mean {sum(south)/len(south):5.2f}°  max {max(south):5.2f}°  min {min(south):5.2f}°')
    print('  ' + '  '.join(f'{compass(a)} {prof[a][0]:.1f}' for a in range(0, 360, 30)))
json.dump({k: {'h0': v['h0'], 'prof': {str(a): v['prof'][a] for a in v['prof']}} for k, v in result.items()}, open(`${import.meta.dir}/.cache/horizon.json`, 'w'))
print('\nwrote horizon.json')
