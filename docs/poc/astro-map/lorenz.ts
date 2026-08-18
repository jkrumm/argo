/**
 * POC: sample the David J. Lorenz light-pollution atlas binary tiles.
 * Algorithm transcribed verbatim from djlorenz.github.io/astronomy/lp/overlay/dark.html
 * Grid: 1/120 deg (30 arcsec). Tiles 5x5 deg = 600x600 points, origin lat -65, lon -180.
 */
import { gunzipSync } from 'node:zlib'

const mod = (n: number, m: number) => ((n % m) + m) % m
const compressed2full = (x: number) => (5.0 / 195.0) * (Math.exp(0.0195 * x) - 1.0)

const cache = new Map<string, Int8Array>()

async function tile(year: number, tx: number, ty: number): Promise<Int8Array> {
  const key = `${year}/${tx}/${ty}`
  const hit = cache.get(key)
  if (hit) return hit
  const url = `https://djlorenz.github.io/astronomy/binary_tiles/${year}/binary_tile_${tx}_${ty}.dat.gz`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  const buf = gunzipSync(Buffer.from(await res.arrayBuffer()))
  const arr = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  cache.set(key, arr)
  return arr
}

export type LorenzSample = {
  /** Artificial brightness as a ratio of the natural sky background (Lorenz "LP Index"). */
  ratio: number
  /** Total zenith sky brightness, mag/arcsec^2. */
  mpsas: number
  zone: string
}

const ZONES: [number, string][] = [
  [0.01, '0'],
  [0.06, '1a'],
  [0.11, '1b'],
  [0.19, '2a'],
  [0.33, '2b'],
  [0.58, '3a'],
  [1.0, '3b'],
  [1.73, '4a'],
  [3.0, '4b'],
  [5.2, '5a'],
  [9.0, '5b'],
  [15.59, '6a'],
  [27.0, '6b'],
  [46.77, '7a'],
]
const zoneOf = (r: number) => ZONES.find(([t]) => r < t)?.[1] ?? '7b'

export async function sampleLorenz(year: number, lat: number, lon: number): Promise<LorenzSample> {
  const lonFromDateLine = mod(lon + 180.0, 360.0)
  const latFromStart = lat + 65.0
  const tilex = Math.floor(lonFromDateLine / 5.0) + 1
  const tiley = Math.floor(latFromStart / 5.0) + 1
  if (tiley < 1 || tiley > 28) throw new Error('out of bounds (65S..75N)')

  const ix = Math.round(120 * (lonFromDateLine - 5.0 * (tilex - 1) + 1 / 240))
  const iy = Math.round(120 * (latFromStart - 5.0 * (tiley - 1) + 1 / 240))

  const d = await tile(year, tilex, tiley)
  const first = 128 * Number(d[0]) + Number(d[1])
  let change = 0
  for (let i = 1; i < iy; i++) change += Number(d[600 * i + 1])
  for (let i = 1; i < ix; i++) change += Number(d[600 * (iy - 1) + 1 + i])

  const ratio = compressed2full(first + change)
  return { ratio, mpsas: 22.0 - (5.0 * Math.log(1.0 + ratio)) / Math.log(100), zone: zoneOf(ratio) }
}

// ── run ──────────────────────────────────────────────────────────────────
const SITES = [
  { id: 'munich', name: 'Munich', lat: 48.1374, lon: 11.5755, bortleClaim: 8 },
  {
    id: 'alpenvorland',
    name: 'Alpenvorland (Bad Tölz)',
    lat: 47.8167,
    lon: 11.4667,
    bortleClaim: 4,
  },
  { id: 'bayerischer-wald', name: 'Bayerischer Wald', lat: 48.9333, lon: 13.4167, bortleClaim: 3 },
  { id: 'walchensee', name: 'Walchensee', lat: 47.6, lon: 11.33, bortleClaim: 4 },
  // external references for sanity-checking
  { id: 'ref-mauna-kea', name: 'REF Mauna Kea', lat: 19.8207, lon: -155.4681, bortleClaim: 1 },
  { id: 'ref-times-sq', name: 'REF Times Square', lat: 40.758, lon: -73.9855, bortleClaim: 9 },
  { id: 'ref-westhavelland', name: 'REF Westhavelland IDSP', lat: 52.7, lon: 12.4, bortleClaim: 2 },
  { id: 'ref-eifel', name: 'REF Nationalpark Eifel IDSP', lat: 50.55, lon: 6.4, bortleClaim: 4 },
  { id: 'ref-rhoen', name: 'REF Rhön IDSR', lat: 50.5, lon: 9.95, bortleClaim: 3 },
]
const YEARS = [2016, 2020, 2022, 2023, 2024, 2025]

const rows: string[] = []
rows.push(['site', ...YEARS.map(String), 'zone25', 'trend16→25'].join('\t'))
for (const s of SITES) {
  const vals: LorenzSample[] = []
  for (const y of YEARS) vals.push(await sampleLorenz(y, s.lat, s.lon))
  const first = vals[0]!.ratio,
    last = vals.at(-1)!.ratio
  rows.push(
    [
      s.name,
      ...vals.map(
        (v) => `${v.mpsas.toFixed(2)}/${v.ratio < 3 ? v.ratio.toFixed(2) : v.ratio.toFixed(1)}`,
      ),
      vals.at(-1)!.zone,
      `${(((last - first) / Math.max(first, 1e-6)) * 100).toFixed(0)}%`,
    ].join('\t'),
  )
}
console.log(rows.join('\n'))
