/* eslint-disable no-console */
/**
 * P6 — can "how much sky does the ground leave where the core goes" be painted
 * as a raster, at tile cost?
 *
 * The map's job is finding a spot, and light pollution alone cannot do it: the
 * binding run showed a 1134 m summit losing 94% of its core hours to the wall
 * south of it, at a light-pollution level indistinguishable from the valley
 * next door. A clearance field is the missing half of the map.
 *
 * Measures both halves of the cost: the DEM footprint a tile needs (the march
 * reaches 60 km past the tile edge) and the marching itself.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { decodePng } from '../../../apps/api/scripts/terrarium-dem.js'
import { terrariumElevation } from '../../../apps/api/src/lib/terrain-horizon.js'
import { lonToTileX, latToTileY } from '../../../apps/api/src/lib/lp-tile.js'
import { maxCoreAltitude } from '../../../apps/api/src/lib/astro-ephemeris.js'
import { CACHE_DIR, demFor } from './sites.js'

const ZOOM = 11
const RANGE_M = 60_000
const STEP_M = 300
const ARC = { from: 150, to: 215, step: 5 }
const M_PER_DEG_LAT = 111_320
const R_EFF = 6_371_000 / (1 - 0.13)
const rad = (d: number) => (d * Math.PI) / 180

/** A 60 × 60 km sample region centred on the pre-alpine edge, plus its 60 km march skirt. */
const REGION = { minLat: 47.4, maxLat: 47.95, minLon: 11.0, maxLon: 11.85 }
const GRID_N = Number(process.env.N ?? 60)

const corners = [
  { lat: REGION.minLat, lon: REGION.minLon },
  { lat: REGION.minLat, lon: REGION.maxLon },
  { lat: REGION.maxLat, lon: REGION.minLon },
  { lat: REGION.maxLat, lon: REGION.maxLon },
]
const t0 = performance.now()
const dem = await demFor(corners, ZOOM, RANGE_M)
console.log(
  `DEM prefetch: ${JSON.stringify(dem.stats())} in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
)

// Re-read the cached tiles into a flat index so the hot loop never touches fs.
const grids = new Map<string, { width: number; height: number; rgb: Uint8Array }>()
for (const name of readdirSync(`${CACHE_DIR}/z${ZOOM}`)) {
  const m = /^(\d+)_(\d+)_(\d+)\.png$/.exec(name)
  if (!m || Number(m[1]) !== ZOOM) continue
  grids.set(
    `${m[2]}/${m[3]}`,
    decodePng(new Uint8Array(readFileSync(`${CACHE_DIR}/z${ZOOM}/${name}`))),
  )
}
console.log(
  `${grids.size} tiles resident (~${((grids.size * 256 * 256 * 3) / 1e6).toFixed(0)} MB raw RGB)\n`,
)

function sample(lat: number, lon: number): number {
  const x = lonToTileX(lon, ZOOM)
  const y = latToTileY(lat, ZOOM)
  const grid = grids.get(`${Math.floor(x)}/${Math.floor(y)}`)
  if (!grid) return Number.NaN
  const col = Math.min(grid.width - 1, Math.max(0, Math.floor((x - Math.floor(x)) * grid.width)))
  const row = Math.min(grid.height - 1, Math.max(0, Math.floor((y - Math.floor(y)) * grid.height)))
  const i = (row * grid.width + col) * 3
  return terrariumElevation(grid.rgb[i]!, grid.rgb[i + 1]!, grid.rgb[i + 2]!)
}

/** Max terrain altitude over the arc the core crosses — the field the map paints. */
function arcMax(lat: number, lon: number): number {
  const h0 = sample(lat, lon)
  if (!Number.isFinite(h0)) return Number.NaN
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(rad(lat))
  let max = -90
  for (let azDeg = ARC.from; azDeg <= ARC.to; azDeg += ARC.step) {
    const az = rad(azDeg)
    const dLat = Math.cos(az) / M_PER_DEG_LAT
    const dLon = Math.sin(az) / mPerDegLon
    for (let r = STEP_M; r <= RANGE_M; r += STEP_M) {
      const h = sample(lat + r * dLat, lon + r * dLon)
      if (!Number.isFinite(h)) continue
      const a = (Math.atan2(h - h0 - (r * r) / (2 * R_EFF), r) * 180) / Math.PI
      if (a > max) max = a
    }
  }
  return max
}

const t1 = performance.now()
const field = new Float32Array(GRID_N * GRID_N)
for (let iy = 0; iy < GRID_N; iy++) {
  const lat = REGION.maxLat - ((REGION.maxLat - REGION.minLat) * iy) / (GRID_N - 1)
  for (let ix = 0; ix < GRID_N; ix++) {
    const lon = REGION.minLon + ((REGION.maxLon - REGION.minLon) * ix) / (GRID_N - 1)
    field[iy * GRID_N + ix] =
      maxCoreAltitude({ lat, lon }, new Date('2026-08-22T21:00:00Z')) - arcMax(lat, lon)
  }
}
const ms = performance.now() - t1
const cells = GRID_N * GRID_N
const raysPerCell = ((ARC.to - ARC.from) / ARC.step + 1) * (RANGE_M / STEP_M)
console.log(
  `${cells} cells in ${ms.toFixed(0)} ms  →  ${(ms / cells).toFixed(2)} ms/cell, ${((cells * raysPerCell) / (ms / 1000) / 1e6).toFixed(1)} M samples/s`,
)
console.log(
  `a 256×256 tile would be ${((65536 * ms) / cells / 1000).toFixed(1)} s at this resolution\n`,
)

const finite = [...field].filter(Number.isFinite).sort((a, b) => a - b)
const q = (p: number) => finite[Math.floor(p * (finite.length - 1))]!.toFixed(1)
console.log(
  `clearance over the region: min ${q(0)}°  p10 ${q(0.1)}°  median ${q(0.5)}°  p90 ${q(0.9)}°  max ${q(1)}°`,
)

// A coarse ASCII field — the point is whether the structure is legible, not pretty.
const ramp = ' .:-=+*#%@'
console.log('\nclearance field (N up, @ = most open):')
for (let iy = 0; iy < GRID_N; iy += 2) {
  let line = ''
  for (let ix = 0; ix < GRID_N; ix++) {
    const v = field[iy * GRID_N + ix]!
    line += Number.isFinite(v)
      ? ramp[Math.max(0, Math.min(9, Math.round(((v + 4) / 18) * 9)))]
      : '?'
  }
  console.log('  ' + line)
}
