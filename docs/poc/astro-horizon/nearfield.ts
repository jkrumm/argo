/* eslint-disable no-console */
/**
 * P2b — where does the z11↔z12 disagreement live, and can bilinear sampling
 * close it without fetching four times the tiles?
 *
 * Bayerischer Wald moves 0.65° between z11 and z12 while every other site moves
 * ≤0.07°. Either the responsible ridge is near (so pixel size dominates) or the
 * shipped NEAREST-neighbour sampler is aliasing a slope it could interpolate.
 */

import { CACHE_DIR, demFor, SITES } from './sites.js'
import { lonToTileX, latToTileY } from '../../../apps/api/src/lib/lp-tile.js'
import { terrariumElevation } from '../../../apps/api/src/lib/terrain-horizon.js'

const M_PER_DEG_LAT = 111_320
const R_EFF = 6_371_000 / (1 - 0.13)
const rad = (d: number) => (d * Math.PI) / 180

type Grid = { width: number; height: number; rgb: Uint8Array }

/** Bilinear terrarium sampler over the same cached tiles the nearest one reads. */
function bilinearSampler(grids: Map<string, Grid | null>, zoom: number) {
  const at = (tx: number, ty: number, col: number, row: number): number => {
    const grid = grids.get(`${tx}/${ty}`)
    if (!grid) return Number.NaN
    const c = Math.min(Math.max(col, 0), grid.width - 1)
    const r = Math.min(Math.max(row, 0), grid.height - 1)
    const i = (r * grid.width + c) * 3
    return terrariumElevation(grid.rgb[i]!, grid.rgb[i + 1]!, grid.rgb[i + 2]!)
  }
  return (lat: number, lon: number): number => {
    const x = lonToTileX(lon, zoom)
    const y = latToTileY(lat, zoom)
    const tx = Math.floor(x)
    const ty = Math.floor(y)
    const grid = grids.get(`${tx}/${ty}`)
    if (!grid) return Number.NaN
    // Pixel coordinates within the tile, offset to pixel CENTRES.
    const px = (x - tx) * grid.width - 0.5
    const py = (y - ty) * grid.height - 0.5
    const c0 = Math.floor(px)
    const r0 = Math.floor(py)
    const fx = px - c0
    const fy = py - r0
    // Neighbours may fall into the adjacent tile; resolve each independently.
    const sample = (c: number, r: number): number => {
      let ttx = tx
      let tty = ty
      let cc = c
      let rr = r
      if (cc < 0) {
        ttx -= 1
        cc += grid.width
      }
      if (cc >= grid.width) {
        ttx += 1
        cc -= grid.width
      }
      if (rr < 0) {
        tty -= 1
        rr += grid.height
      }
      if (rr >= grid.height) {
        tty += 1
        rr -= grid.height
      }
      const v = at(ttx, tty, cc, rr)
      return Number.isFinite(v)
        ? v
        : at(
            tx,
            ty,
            Math.min(Math.max(c, 0), grid.width - 1),
            Math.min(Math.max(r, 0), grid.height - 1),
          )
    }
    const v00 = sample(c0, r0)
    const v10 = sample(c0 + 1, r0)
    const v01 = sample(c0, r0 + 1)
    const v11 = sample(c0 + 1, r0 + 1)
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
  }
}

function march(
  sampler: (lat: number, lon: number) => number,
  site: { lat: number; lon: number },
  stepM: number,
  rangeM: number,
) {
  const elevationM = sampler(site.lat, site.lon)
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(rad(site.lat))
  const points: { azimuthDeg: number; altitudeDeg: number; rangeM: number; summitM: number }[] = []
  for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += 5) {
    const az = rad(azimuthDeg)
    let best = { azimuthDeg, altitudeDeg: -90, rangeM: 0, summitM: Number.NaN }
    for (let r = stepM; r <= rangeM; r += stepM) {
      const lat = site.lat + (r * Math.cos(az)) / M_PER_DEG_LAT
      const lon = site.lon + (r * Math.sin(az)) / mPerDegLon
      const summitM = sampler(lat, lon)
      const drop = (r * r) / (2 * R_EFF)
      const a =
        Number.isFinite(summitM) && Number.isFinite(elevationM)
          ? (Math.atan2(summitM - elevationM - drop, r) * 180) / Math.PI
          : -90
      if (a > best.altitudeDeg) best = { azimuthDeg, altitudeDeg: a, rangeM: r, summitM }
    }
    points.push(best)
  }
  return { elevationM, points }
}

const south = (p: { azimuthDeg: number; altitudeDeg: number; rangeM: number }[]) =>
  p
    .filter((x) => x.azimuthDeg >= 150 && x.azimuthDeg <= 215)
    .reduce((a, b) => (b.altitudeDeg > a.altitudeDeg ? b : a))

// The generator's DEM exposes only a nearest sampler, so re-read the cached
// tiles here to build the bilinear one over exactly the same bytes.
import { readFileSync, readdirSync } from 'node:fs'
import { decodePng } from '../../../apps/api/scripts/terrarium-dem.js'

function loadGrids(zoom: number): Map<string, Grid | null> {
  const dir = `${CACHE_DIR}/z${zoom}`
  const grids = new Map<string, Grid | null>()
  for (const name of readdirSync(dir)) {
    const m = /^(\d+)_(\d+)_(\d+)\.png$/.exec(name)
    if (!m || Number(m[1]) !== zoom) continue
    grids.set(`${m[2]}/${m[3]}`, decodePng(new Uint8Array(readFileSync(`${dir}/${name}`))))
  }
  return grids
}

for (const zoom of [11, 12]) await demFor(SITES, zoom)

const g11 = loadGrids(11)
const g12 = loadGrids(12)
const bl11 = bilinearSampler(g11, 11)
const bl12 = bilinearSampler(g12, 12)
const nn11 = (await demFor(SITES, 11)).sampler
const nn12 = (await demFor(SITES, 12)).sampler

console.log('site               z11-nn   z11-bilin  z12-nn   z12-bilin   |  range of the z12 max')
for (const site of SITES) {
  const a = south(march(nn11, site, 150, 60_000).points)
  const b = south(march(bl11, site, 150, 60_000).points)
  const c = south(march(nn12, site, 75, 60_000).points)
  const d = south(march(bl12, site, 75, 60_000).points)
  console.log(
    `${site.id.padEnd(18)} ${a.altitudeDeg.toFixed(2).padStart(6)}  ${b.altitudeDeg.toFixed(2).padStart(9)}  ${c.altitudeDeg.toFixed(2).padStart(6)}  ${d.altitudeDeg.toFixed(2).padStart(9)}   |  ${(c.rangeM / 1000).toFixed(1)} km at az ${c.azimuthDeg}°`,
  )
}
