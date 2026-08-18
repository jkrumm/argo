/* eslint-disable no-console */
/**
 * Script-local DEM reader: a disk-cached terrarium elevation sampler over
 * AWS's `elevation-tiles-prod` bucket, for the generator that runs on a
 * laptop once per atlas vintage.
 *
 * The PNG decoder used to live only here, on the argument that nothing Argo
 * serves ever reads a PNG. That argument is no longer true — `GET
 * /astro/horizon` now decodes the same tiles at request time, so the decoder
 * moved to `../src/lib/png-decode.ts` and both this script and
 * `../src/clients/terrarium-dem.ts` import it from there. What stays script-
 * local is the DISK cache and the prefetch loop: the runtime client caches
 * decoded elevations in memory only (`clients/terrarium-dem.ts`'s own
 * docstring explains why), while this generator writes the raw PNG bytes to a
 * plain directory so the second run of `gen-astro-sites.ts` is fully
 * offline — which is what makes its acceptance check a real regression test
 * rather than a network probe.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, type DecodedPng } from '../src/lib/png-decode.js'
import { lonToTileX, latToTileY } from '../src/lib/lp-tile.js'
import { terrariumElevation, type ElevationSampler } from '../src/lib/terrain-horizon.js'

// ── Tiles ────────────────────────────────────────────────────────────────

const TERRARIUM_BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const REQUEST_TIMEOUT_MS = 40_000

export type TerrariumDem = {
  sampler: ElevationSampler
  /** Tiles the sampler had to reach for, and how many of those came off disk. */
  stats: () => { tiles: number; fromCache: number; missing: number }
}

/**
 * A DEM sampler at one zoom, backed by a directory of cached tile PNGs.
 *
 * `prefetch` must cover every coordinate the caller will sample: the sampler
 * itself is synchronous (that is what `horizonProfile` takes) and reads NaN for
 * anything not already on disk — the same "no data" contract the horizon maths
 * floors to −90°, so a missed tile can never masquerade as flat ground.
 */
export async function terrariumDem(args: {
  zoom: number
  cacheDir: string
}): Promise<TerrariumDem & { prefetch: (boxes: TileBox[]) => Promise<void> }> {
  const { zoom, cacheDir } = args
  mkdirSync(cacheDir, { recursive: true })

  const grids = new Map<string, DecodedPng | null>()
  let fromCache = 0

  async function load(tx: number, ty: number): Promise<void> {
    const key = `${tx}/${ty}`
    if (grids.has(key)) return

    const path = join(cacheDir, `${zoom}_${tx}_${ty}.png`)
    if (existsSync(path)) {
      try {
        grids.set(key, decodePng(new Uint8Array(readFileSync(path))))
        fromCache += 1
        return
      } catch (error) {
        // A cached tile that will not decode is a poisoned cache, not a bad
        // atlas: drop it and fall through to the network. Left in place it
        // would fail every future run identically, with no way out but a
        // hand-typed `rm`.
        console.warn(`  ! cached terrarium tile ${key} unreadable, refetching: ${String(error)}`)
        rmSync(path, { force: true })
      }
    }

    const url = `${TERRARIUM_BASE_URL}/${zoom}/${tx}/${ty}.png`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!res.ok) {
        console.warn(`  ! terrarium tile ${key} returned ${res.status}`)
        grids.set(key, null)
        return
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      // Decode before writing, then rename into place: only tiles that are
      // known-good and complete ever become cache entries, so a Ctrl-C or a
      // full disk mid-prefetch cannot leave a half-written PNG behind.
      const decoded = decodePng(bytes)
      const staging = `${path}.${process.pid}.tmp`
      writeFileSync(staging, bytes)
      renameSync(staging, path)
      grids.set(key, decoded)
    } catch (error) {
      console.warn(`  ! terrarium tile ${key} failed: ${String(error)}`)
      grids.set(key, null)
    }
  }

  const sampler: ElevationSampler = (lat, lon) => {
    const x = lonToTileX(lon, zoom)
    const y = latToTileY(lat, zoom)
    const grid = grids.get(`${Math.floor(x)}/${Math.floor(y)}`)
    if (!grid) return Number.NaN

    const column = clamp(Math.floor((x - Math.floor(x)) * grid.width), 0, grid.width - 1)
    const row = clamp(Math.floor((y - Math.floor(y)) * grid.height), 0, grid.height - 1)
    const at = (row * grid.width + column) * 3
    return terrariumElevation(grid.rgb[at]!, grid.rgb[at + 1]!, grid.rgb[at + 2]!)
  }

  return {
    sampler,
    stats: () => ({
      tiles: grids.size,
      fromCache,
      missing: [...grids.values()].filter((grid) => grid === null).length,
    }),
    async prefetch(boxes) {
      const wanted = new Set<string>()
      for (const box of boxes) {
        for (const tile of tilesInBox(box, zoom)) wanted.add(`${tile.tx}/${tile.ty}`)
      }
      // Ten at a time: enough to hide the round trips, gentle enough that a
      // public bucket never rate-limits a one-off generator run.
      const pending = [...wanted]
      while (pending.length > 0) {
        await Promise.all(
          pending.splice(0, 10).map((key) => {
            const [tx, ty] = key.split('/')
            return load(Number(tx), Number(ty))
          }),
        )
      }
    },
  }
}

export type TileBox = { lat: number; lon: number; radiusM: number }

/** Every tile at `zoom` inside a square of `radiusM` around a point. */
function tilesInBox(box: TileBox, zoom: number): { tx: number; ty: number }[] {
  const padLat = box.radiusM / 111_320
  const padLon = padLat / Math.cos((box.lat * Math.PI) / 180)

  const xs = [lonToTileX(box.lon - padLon, zoom), lonToTileX(box.lon + padLon, zoom)]
  const ys = [latToTileY(box.lat - padLat, zoom), latToTileY(box.lat + padLat, zoom)]

  const tiles: { tx: number; ty: number }[] = []
  for (let tx = Math.floor(Math.min(...xs)); tx <= Math.floor(Math.max(...xs)); tx++) {
    for (let ty = Math.floor(Math.min(...ys)); ty <= Math.floor(Math.max(...ys)); ty++) {
      tiles.push({ tx, ty })
    }
  }
  return tiles
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
