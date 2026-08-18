/* eslint-disable no-console */
/**
 * A disk-cached LPI sampler over the Lorenz atlas, built from the SHIPPED
 * decode (`lorenz-decode.ts`) but without the app's client — the client pulls
 * in env validation and OTel, neither of which a POC should need to satisfy.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  decodeTile,
  LATEST_LORENZ_YEAR,
  locateTile,
  sampleGrid,
  type LorenzYear,
} from '../../../apps/api/src/lib/lorenz-decode.js'
import { KM_PER_DEG_LAT, type LpiSampler } from '../../../apps/api/src/lib/skyglow.js'
import { CACHE_DIR } from './sites.js'

const BASE = 'https://djlorenz.github.io/astronomy/binary_tiles'

/** Every 5°×5° atlas tile a `rangeKm` march around a point can reach. */
export function tilesAround(
  site: { lat: number; lon: number },
  rangeKm: number,
): { tx: number; ty: number }[] {
  const padLat = rangeKm / KM_PER_DEG_LAT
  const padLon = padLat / Math.cos((site.lat * Math.PI) / 180)
  const seen = new Map<string, { tx: number; ty: number }>()
  // Walk the box on a half-degree lattice; the tile grid is 5°, so this cannot
  // step over one. Endpoints are nudged inward off an exact 5° graticule, which
  // is what `locateTile`'s half-cell rollover would otherwise wrap across.
  for (let lat = site.lat - padLat; lat <= site.lat + padLat + 0.5; lat += 0.5) {
    for (let lon = site.lon - padLon; lon <= site.lon + padLon + 0.5; lon += 0.5) {
      const point = locateTile(Math.min(lat, site.lat + padLat), Math.min(lon, site.lon + padLon))
      if (point) seen.set(`${point.tx}/${point.ty}`, { tx: point.tx, ty: point.ty })
    }
  }
  return [...seen.values()]
}

export async function lorenzSampler(
  site: { lat: number; lon: number },
  rangeKm = 120,
  year: LorenzYear = LATEST_LORENZ_YEAR,
): Promise<LpiSampler> {
  const dir = `${CACHE_DIR}/lorenz`
  mkdirSync(dir, { recursive: true })
  const grids = new Map<string, Float32Array | null>()

  for (const { tx, ty } of tilesAround(site, rangeKm)) {
    const key = `${tx}/${ty}`
    const path = `${dir}/binary_tile_${tx}_${ty}.${year}.dat.gz`
    let bytes: Uint8Array | null = null
    if (existsSync(path)) bytes = new Uint8Array(readFileSync(path))
    else {
      const res = await fetch(`${BASE}/${year}/binary_tile_${tx}_${ty}.dat.gz`, {
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok) {
        bytes = new Uint8Array(await res.arrayBuffer())
        writeFileSync(path, bytes)
      }
    }
    grids.set(key, bytes ? decodeTile(new Uint8Array(gunzipSync(bytes))) : null)
  }

  return (lat, lon) => {
    const point = locateTile(lat, lon)
    if (!point) return Number.NaN
    const grid = grids.get(`${point.tx}/${point.ty}`)
    if (!grid) return Number.NaN
    return sampleGrid(grid, point.ix, point.iy)
  }
}
