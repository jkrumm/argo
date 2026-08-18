/**
 * AWS `elevation-tiles-prod` terrarium DEM — the runtime half.
 *
 * Keyless, unauthenticated, S3-hosted raster tiles:
 *
 *   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *
 * The same bucket `scripts/gen-astro-sites.ts` already reads through
 * `scripts/terrarium-dem.ts` to produce the four committed site constants —
 * this module exists because `GET /astro/horizon` (`docs/ASTRO-HORIZON-
 * RESEARCH.md`) needs the same march for an ARBITRARY coordinate, at request
 * time, which a laptop-only generator with a disk cache cannot serve. The
 * decoder is shared (`../lib/png-decode.ts`); the geometry is shared
 * (`../lib/terrain-horizon.ts`); only the fetch-and-cache I/O is new here.
 *
 * Shape follows `./lorenz-atlas.ts` deliberately — module-scope `Map` with a
 * TTL and FIFO eviction, an injectable `FetchImpl` seam, one OTel span per
 * public entry point, and it NEVER throws: a dead upstream yields `null` and a
 * `log.warn`, and the route degrades to a 502 rather than a 500.
 *
 * Two things differ from that file, both on purpose:
 *
 *   - The cache holds DECODED ELEVATIONS as `Int16Array` (metres, rounded),
 *     never the PNG bytes and never `Float32Array`. 256×256 Int16 is 131 KB
 *     per tile; `Float32Array` would double that to 262 KB, and the 0.5 m
 *     rounding loss from storing metres as an integer is an order of
 *     magnitude under the DEM's own ±5–15 m vertical error. That argument
 *     holds for the SKYLINE band and not for the near one: at 150 m a half
 *     metre subtends 0.19°, which is why `nearAltitudeDeg` moves ~0.1° against
 *     an unrounded march. It stays inside the ±0.96° the near band is unstable
 *     by anyway (`docs/ASTRO-HORIZON-RESEARCH.md` §3), and nothing scores that
 *     band. `CACHE_MAX_ENTRIES = 256` is therefore a ~33 MB resident cap —
 *     sized because one cold coordinate pulls roughly 100 tiles (the 60 km
 *     march needs a ~120 km box, and a z11 tile is ~13 km wide at 48°N), and
 *     nearby coordinates share almost all of them.
 *   - The TTL is 7 days, not 24 h. Terrain does not move; the TTL exists only
 *     to bound a poisoned entry (a bad decode, a transient upstream glitch
 *     that somehow still returned 200), not to track change — contrast the
 *     Lorenz atlas's 24 h, which tracks an annually revised dataset.
 */

import { SpanKind, SpanStatusCode, type AttributeValue } from '@opentelemetry/api'
import { decodePng } from '../lib/png-decode.js'
import { latToTileY, lonToTileX } from '../lib/lp-tile.js'
import {
  horizonProfile,
  southernHorizon,
  terrariumElevation,
  HORIZON_DEM_ZOOM,
  HORIZON_RANGE_M,
  type ElevationSampler,
  type HorizonProfile,
} from '../lib/terrain-horizon.js'
import { tracedFetch } from '../lib/traced-fetch.js'
import { log, tracer } from '../telemetry.js'
import type { FetchImpl } from './astro-upstreams.js'

export type { FetchImpl }

const TERRARIUM_BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const REQUEST_TIMEOUT_MS = 20_000

/** Terrain does not move — see the module docstring for why this differs from the Lorenz atlas's 24 h. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 256 tiles × ~131 KB (256×256 Int16) is a ~33 MB resident cap. See the module docstring for the sizing. */
const CACHE_MAX_ENTRIES = 256

/** The source label the route hands back. */
const SOURCE_LABEL = 'Terrarium DEM (SRTM/NED blend), AWS elevation-tiles-prod'

// ── Cache ────────────────────────────────────────────────────────────────

type TileGrid = { width: number; height: number; elevations: Int16Array }
type CacheEntry = { expiresAt: number; grid: TileGrid }

// Insertion order == FIFO eviction order for a `Map`, same rule as lorenz-atlas.ts.
const cache = new Map<string, CacheEntry>()

function tileKey(tx: number, ty: number): string {
  return `${tx}:${ty}`
}

function getCached(key: string): TileGrid | undefined {
  const entry = cache.get(key)
  if (entry === undefined) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.grid
}

function setCached(key: string, grid: TileGrid): void {
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, grid })
}

/** Exported for tests only — drops every cached tile. */
export function clearTerrariumCache(): void {
  cache.clear()
}

function toAttributeValue(error: unknown): AttributeValue {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Downloads currently in flight, keyed exactly like the grid cache — the same
 * dedupe rationale as `lorenz-atlas.ts`'s `inFlight`: a 60 km march's ~100
 * tiles all fire from one `Promise.allSettled`, so without this a re-entrant
 * caller (a second concurrent request for a nearby coordinate) would refetch
 * tiles the first request already has in flight.
 */
const inFlight = new Map<string, Promise<TileGrid | null>>()

async function loadTile(tx: number, ty: number, fetchImpl: FetchImpl): Promise<TileGrid | null> {
  const key = tileKey(tx, ty)
  const cached = getCached(key)
  if (cached !== undefined) return cached

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = fetchTile(tx, ty, fetchImpl, key)
  inFlight.set(key, request)
  try {
    return await request
  } finally {
    inFlight.delete(key)
  }
}

async function fetchTile(
  tx: number,
  ty: number,
  fetchImpl: FetchImpl,
  key: string,
): Promise<TileGrid | null> {
  const url = `${TERRARIUM_BASE_URL}/${HORIZON_DEM_ZOOM}/${tx}/${ty}.png`

  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      log.warn('terrarium-dem: tile returned non-OK status', { url, status: res.status })
      return null
    }
    const decoded = decodePng(new Uint8Array(await res.arrayBuffer()))
    const elevations = new Int16Array(decoded.width * decoded.height)
    for (let pixel = 0; pixel < elevations.length; pixel++) {
      const at = pixel * 3
      elevations[pixel] = Math.round(
        terrariumElevation(decoded.rgb[at]!, decoded.rgb[at + 1]!, decoded.rgb[at + 2]!),
      )
    }
    const grid: TileGrid = { width: decoded.width, height: decoded.height, elevations }
    setCached(key, grid)
    return grid
  } catch (error) {
    log.warn('terrarium-dem: tile fetch failed', { url, error: toAttributeValue(error) })
    return null
  }
}

/** Tiles across the world at `HORIZON_DEM_ZOOM`. The x axis is cyclic; the y axis is not. */
const TILE_COUNT = 2 ** HORIZON_DEM_ZOOM

/** Concurrent tile downloads. The generator uses 10; a request path can afford more, not unbounded. */
const FETCH_CONCURRENCY = 16

/**
 * Ceiling on how many DEM tiles one profile may pull.
 *
 * The march needs a ~120 km box, whose tile count grows as `1/cos(lat)²` — 110
 * tiles at 48°N, 169 at 60°N, 361 at 70°N, and 122 MILLION at 89.99°N, where
 * `padLon = padLat / cos(lat)` wraps the box around the whole world several
 * times. Without this cap that request enumerates and fires every one of them
 * in a single `Promise.allSettled`.
 *
 * 512 admits everything up to ~73°N. Beyond that a 60 km march at z11 is not a
 * horizon measurement any more, and PVGIS — the reference this model is
 * validated against — stops at 75°N regardless.
 */
export const MAX_HORIZON_TILES = 512

/** x wraps at the antimeridian; a request at lon 179.9 must read tile 0, not tile 2048. */
function wrapTileX(tx: number): number {
  return ((tx % TILE_COUNT) + TILE_COUNT) % TILE_COUNT
}

/**
 * The tile box a march covers, as spans rather than as tiles.
 *
 * Counting has to be possible WITHOUT materialising the box: at 89.99°N the box
 * wraps the world and names 2048² tiles, so building the array to measure it
 * allocates four million objects before anyone can decide it is too many. This
 * returns the arithmetic; {@link horizonTiles} does the materialising, and only
 * after a caller has looked at the count.
 */
function horizonBox(
  site: { lat: number; lon: number },
  radiusM: number,
): { xFrom: number; xSpan: number; yFrom: number; yTo: number; count: number } {
  const padLat = radiusM / 111_320
  const padLon = padLat / Math.cos((site.lat * Math.PI) / 180)

  const xs = [
    lonToTileX(site.lon - padLon, HORIZON_DEM_ZOOM),
    lonToTileX(site.lon + padLon, HORIZON_DEM_ZOOM),
  ]
  const ys = [
    latToTileY(site.lat - padLat, HORIZON_DEM_ZOOM),
    latToTileY(site.lat + padLat, HORIZON_DEM_ZOOM),
  ]

  const xFrom = Math.floor(Math.min(...xs))
  // A box wider than the world contributes every column exactly once, no more.
  const xSpan = Math.min(Math.floor(Math.max(...xs)) - xFrom, TILE_COUNT - 1)
  // Rows past the Mercator limit are CLAMPED AWAY, not wrapped: there is no row
  // to read there, and wrapping would sample the opposite hemisphere.
  const yFrom = Math.max(0, Math.floor(Math.min(...ys)))
  const yTo = Math.min(TILE_COUNT - 1, Math.floor(Math.max(...ys)))

  const rows = Math.max(0, yTo - yFrom + 1)
  return { xFrom, xSpan, yFrom, yTo, count: (xSpan + 1) * rows }
}

/**
 * Every DEM tile a `HORIZON_RANGE_M` march can reach from a site. Mirrors
 * `scripts/terrarium-dem.ts`'s `tilesInBox`, plus the x wrap a laptop generator
 * over four fixed Bavarian sites never needed: near the antimeridian the
 * unwrapped box names `tx = 2051`, which 404s, which reports a permanently
 * partial profile that can never be cached.
 */
export function horizonTiles(
  site: { lat: number; lon: number },
  radiusM: number,
): { tx: number; ty: number }[] {
  const box = horizonBox(site, radiusM)
  const tiles: { tx: number; ty: number }[] = []
  for (let step = 0; step <= box.xSpan; step++) {
    const tx = wrapTileX(box.xFrom + step)
    for (let ty = box.yFrom; ty <= box.yTo; ty++) tiles.push({ tx, ty })
  }
  return tiles
}

/**
 * How many DEM tiles a profile at this coordinate would need — the route's 422
 * guard reads this. Arithmetic only: it must stay cheap at exactly the
 * coordinates that make {@link horizonTiles} expensive.
 */
export function horizonTileCount(site: { lat: number; lon: number }): number {
  return horizonBox(site, HORIZON_RANGE_M).count
}

/**
 * A synchronous sampler over already-decoded grids, nearest-neighbour —
 * matching the generator's own sampling rule exactly. Anything not resolved —
 * a failed tile, or a coordinate the march never requested — reads NaN, which
 * `horizonProfile` floors to −90°, so a missing tile can never masquerade as
 * flat ground.
 */
function buildSampler(grids: Map<string, TileGrid>): ElevationSampler {
  return (lat, lon) => {
    const x = lonToTileX(lon, HORIZON_DEM_ZOOM)
    const y = latToTileY(lat, HORIZON_DEM_ZOOM)
    const ty = Math.floor(y)
    if (ty < 0 || ty >= TILE_COUNT) return Number.NaN
    // Wrapped exactly as `horizonTiles` wrapped it, or a march that crosses the
    // antimeridian would look up a key nothing was ever fetched under.
    const grid = grids.get(tileKey(wrapTileX(Math.floor(x)), ty))
    if (!grid) return Number.NaN

    const column = clamp(Math.floor((x - Math.floor(x)) * grid.width), 0, grid.width - 1)
    const row = clamp(Math.floor((y - Math.floor(y)) * grid.height), 0, grid.height - 1)
    return grid.elevations[row * grid.width + column]!
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ── Public API ───────────────────────────────────────────────────────────

export type HorizonResult = {
  lat: number
  lon: number
  elevationM: number
  profile: HorizonProfile
  south: { maxDeg: number; meanDeg: number }
  tilesRequested: number
  tilesResolved: number
  /** False when any tile failed — the profile is then a partial measurement. */
  complete: boolean
  source: string
}

/**
 * The full terrain horizon profile around an arbitrary coordinate.
 *
 * Every tile the march can reach is fetched up front in ONE
 * `Promise.allSettled` (the march itself is synchronous over decoded grids —
 * fetching lazily inside `horizonProfile`'s loop would serialise ~100 round
 * trips), then `horizonProfile`/`southernHorizon` run over the assembled
 * sampler exactly as the generator's does.
 *
 * Returns `null` — never a partial — when the site's OWN tile is missing:
 * without the observer's elevation every altitude in the profile is
 * meaningless, the same refusal `fetchSkyglow` makes for a missing zenith
 * tile in `lorenz-atlas.ts`.
 */
export async function fetchHorizonProfile(
  input: { lat: number; lon: number },
  deps?: { fetchImpl?: FetchImpl | undefined },
): Promise<HorizonResult | null> {
  const fetchImpl: FetchImpl = deps?.fetchImpl ?? tracedFetch
  const { lat, lon } = input
  const site = { lat, lon }

  return tracer.startActiveSpan(
    'fetchHorizonProfile',
    { kind: SpanKind.INTERNAL, attributes: { 'terrarium.lat': lat, 'terrarium.lon': lon } },
    async (span) => {
      try {
        // Counted before enumerating — see `horizonBox`. Building the array
        // first is what the near-pole case must not be allowed to do.
        const needed = horizonTileCount(site)
        if (needed > MAX_HORIZON_TILES) {
          log.warn('terrarium-dem: coordinate needs more DEM tiles than the ceiling allows', {
            lat,
            lon,
            tiles: needed,
            max: MAX_HORIZON_TILES,
          })
          return null
        }
        const tiles = horizonTiles(site, HORIZON_RANGE_M)

        // Batched rather than one `Promise.allSettled` over every tile: at 48°N
        // that is ~110 sockets opened at once, and the cap above allows 512.
        const settled: PromiseSettledResult<TileGrid | null>[] = []
        for (let from = 0; from < tiles.length; from += FETCH_CONCURRENCY) {
          settled.push(
            ...(await Promise.allSettled(
              tiles
                .slice(from, from + FETCH_CONCURRENCY)
                .map((tile) => loadTile(tile.tx, tile.ty, fetchImpl)),
            )),
          )
        }

        const grids = new Map<string, TileGrid>()
        let resolved = 0
        for (const [index, result] of settled.entries()) {
          const tile = tiles[index]
          if (!tile) continue
          if (result.status === 'rejected') {
            log.warn('terrarium-dem: tile rejected', {
              tile: `${tile.tx}:${tile.ty}`,
              error: toAttributeValue(result.reason),
            })
            continue
          }
          if (result.value) {
            grids.set(tileKey(tile.tx, tile.ty), result.value)
            resolved += 1
          }
        }

        span.setAttributes({
          'terrarium.tiles_requested': tiles.length,
          'terrarium.tiles_ok': resolved,
        })

        const sampler = buildSampler(grids)
        const profile = horizonProfile({ sampler, site })

        if (!Number.isFinite(profile.elevationM)) {
          log.warn(
            'terrarium-dem: the site’s own tile is missing, refusing a meaningless profile',
            {
              lat,
              lon,
            },
          )
          return null
        }

        return {
          lat,
          lon,
          elevationM: profile.elevationM,
          profile,
          south: southernHorizon(profile),
          tilesRequested: tiles.length,
          tilesResolved: resolved,
          complete: resolved === tiles.length,
          source: SOURCE_LABEL,
        }
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error as Error)
        return null
      } finally {
        span.end()
      }
    },
  )
}
