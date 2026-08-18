import { gunzipSync } from 'node:zlib'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const CACHE_DIR = `${import.meta.dir}/.cache/tiles`
mkdirSync(CACHE_DIR, { recursive: true })
const mem = new Map<string, Int8Array>()

export const mod = (n: number, m: number) => ((n % m) + m) % m
export const compressed2full = (x: number) => (5.0 / 195.0) * (Math.exp(0.0195 * x) - 1.0)

async function tile(year: number, tx: number, ty: number): Promise<Int8Array> {
  const key = `${year}_${tx}_${ty}`
  const hit = mem.get(key)
  if (hit) return hit
  const file = `${CACHE_DIR}/${key}.bin`
  let buf: Buffer
  if (existsSync(file)) buf = readFileSync(file)
  else {
    const url = `https://djlorenz.github.io/astronomy/binary_tiles/${year}/binary_tile_${tx}_${ty}.dat.gz`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    buf = gunzipSync(Buffer.from(await res.arrayBuffer()))
    writeFileSync(file, buf)
  }
  const arr = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  mem.set(key, arr)
  return arr
}

/**
 * Pre-decode a tile into a dense 600x600 Float32 grid of LPI, so per-point lookup is O(1).
 * Reproduces the reference walk in `lp/overlay/dark.html` EXACTLY, including its two
 * off-by-one quirks: the latitude sum runs i = 1..iy-1, and the longitude sum reads row
 * `iy - 1`, not row `iy`. Deviating from either shifts the whole grid by one 30" cell,
 * which is ~0.1 mag on a steep gradient like a city edge.
 */
const grids = new Map<string, Float32Array>()
export async function grid(year: number, tx: number, ty: number): Promise<Float32Array> {
  const key = `${year}_${tx}_${ty}`
  const hit = grids.get(key)
  if (hit) return hit
  const d = await tile(year, tx, ty)
  const g = new Float32Array(600 * 600)
  const first = 128 * Number(d[0]) + Number(d[1])

  // rowAnchor[iy] = first + sum of d[600i+1] for i = 1..iy-1
  const rowAnchor = new Float64Array(600)
  let acc = first
  rowAnchor[0] = first
  for (let iy = 1; iy < 600; iy++) {
    rowAnchor[iy] = acc
    acc += Number(d[600 * iy + 1])
  }

  for (let iy = 0; iy < 600; iy++) {
    const src = Math.max(0, iy - 1) // the reference walks the PREVIOUS row for longitude
    let v = rowAnchor[iy]!
    // g[0] and g[1] share the anchor: the reference's longitude sum runs i = 1..ix-1,
    // so it is empty for both ix = 0 and ix = 1.
    g[iy * 600] = compressed2full(v)
    g[iy * 600 + 1] = compressed2full(v)
    for (let ix = 2; ix < 600; ix++) {
      v += Number(d[600 * src + ix])
      g[iy * 600 + ix] = compressed2full(v)
    }
  }
  grids.set(key, g)
  return g
}

export async function lpi(year: number, lat: number, lon: number): Promise<number> {
  const lonFromDateLine = mod(lon + 180.0, 360.0)
  const latFromStart = lat + 65.0
  const tx = Math.floor(lonFromDateLine / 5.0) + 1
  const ty = Math.floor(latFromStart / 5.0) + 1
  if (ty < 1 || ty > 28) return Number.NaN
  const ix = Math.round(120 * (lonFromDateLine - 5.0 * (tx - 1) + 1 / 240))
  const iy = Math.round(120 * (latFromStart - 5.0 * (ty - 1) + 1 / 240))
  if (ix < 0 || ix > 599 || iy < 0 || iy > 599) return Number.NaN
  const g = await grid(year, tx, ty)
  return g[iy * 600 + ix]!
}

export const mpsas = (ratio: number) => 22.0 - (5.0 * Math.log(1.0 + ratio)) / Math.log(100)

const R = 6371
const rad = (d: number) => (d * Math.PI) / 180
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat),
    dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
export function bearingDeg(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  const y = Math.sin(rad(to.lon - from.lon)) * Math.cos(rad(to.lat))
  const x =
    Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) -
    Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lon - from.lon))
  return mod((Math.atan2(y, x) * 180) / Math.PI, 360)
}

export type City = { name: string; lat: number; lon: number; pop: number; cc: string }
export function loadCities(minPop = 500): City[] {
  const out: City[] = []
  for (const line of readFileSync(`${import.meta.dir}/.cache/cities500.txt`, 'utf8').split('\n')) {
    if (!line) continue
    const f = line.split('\t')
    const pop = Number(f[14])
    if (!Number.isFinite(pop) || pop < minPop) continue
    out.push({ name: f[1]!, lat: Number(f[4]), lon: Number(f[5]), pop, cc: f[8]! })
  }
  return out
}
