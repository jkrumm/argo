"""
Encode the Lorenz LPI grid as terrarium-style PNG tiles carrying mpsas x 100,
so MapLibre's color-relief layer can apply an app-owned ramp to real data.
    terrarium: v = R*256 + G + B/256 - 32768      here v = mpsas * 100  (1650..2200)
"""
import gzip, math, os, urllib.request, struct, zlib
CACHE = os.path.join(os.path.dirname(__file__), '.cache/lp-bin')
OUT = os.path.join(os.path.dirname(__file__), '.cache/lp-tiles')
os.makedirs(CACHE, exist_ok=True)
YEAR = 2025
_g = {}

def raw(tx, ty):
    k = (tx, ty)
    if k in _g: return _g[k]
    p = f'{CACHE}/{tx}_{ty}.bin'
    if not os.path.exists(p):
        url = f'https://djlorenz.github.io/astronomy/binary_tiles/{YEAR}/binary_tile_{tx}_{ty}.dat.gz'
        try: d = gzip.decompress(urllib.request.urlopen(url, timeout=40).read())
        except Exception: _g[k] = None; return None
        open(p, 'wb').write(d)
    d = open(p, 'rb').read()
    b = [x - 256 if x > 127 else x for x in d]          # signed bytes
    first = 128 * b[0] + b[1]
    anchor = [0.0] * 600
    acc = first; anchor[0] = first
    for iy in range(1, 600):
        anchor[iy] = acc
        acc += b[600 * iy + 1]
    grid = [[0.0] * 600 for _ in range(600)]
    for iy in range(600):
        src = max(0, iy - 1)
        v = anchor[iy]
        row = grid[iy]
        row[0] = v; row[1] = v
        base = 600 * src
        for ix in range(2, 600):
            v += b[base + ix]
            row[ix] = v
    _g[k] = grid
    return grid

def lpi(lat, lon):
    lfd = (lon + 180.0) % 360.0
    lfs = lat + 65.0
    tx = int(lfd // 5) + 1; ty = int(lfs // 5) + 1
    if not (1 <= ty <= 28): return None
    ix = round(120 * (lfd - 5 * (tx - 1) + 1 / 240)); iy = round(120 * (lfs - 5 * (ty - 1) + 1 / 240))
    if not (0 <= ix < 600 and 0 <= iy < 600): return None
    g = raw(tx, ty)
    if g is None: return None
    c = g[iy][ix]
    return (5.0 / 195.0) * (math.exp(0.0195 * c) - 1.0)

def png(rows, w, h):
    raw_b = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw_b, 6))
            + chunk(b'IEND', b''))

def num2deg(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon

SIZE = 256
BOX = (46.0, 51.5, 7.5, 14.5)   # latMin latMax lonMin lonMax
made = 0
for z in range(5, 10):
    n = 2 ** z
    x0 = int((BOX[2] + 180) / 360 * n); x1 = int((BOX[3] + 180) / 360 * n)
    def ytile(lat): return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    y0 = ytile(BOX[1]); y1 = ytile(BOX[0])
    for xt in range(x0, x1 + 1):
        for yt in range(y0, y1 + 1):
            d = f'{OUT}/{z}/{xt}'; os.makedirs(d, exist_ok=True)
            rows = []
            for py in range(SIZE):
                lat, _ = num2deg(xt, yt + (py + 0.5) / SIZE, z)
                row = bytearray()
                for px in range(SIZE):
                    _, lon = num2deg(xt + (px + 0.5) / SIZE, yt, z)
                    v = lpi(lat, lon)
                    m = 22.0 if v is None else 22.0 - 5.0 * math.log10(1.0 + v) / 2.0
                    enc = int(round(m * 100)) + 32768
                    row += bytes((enc >> 8 & 0xff, enc & 0xff, 0))
                rows.append(row)
            open(f'{d}/{yt}.png', 'wb').write(png(rows, SIZE, SIZE))
            made += 1
    print(f'z{z}: x {x0}-{x1}  y {y0}-{y1}  total {made}')
print('tiles', made)
