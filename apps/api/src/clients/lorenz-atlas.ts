/**
 * David J. Lorenz's Light Pollution Atlas — the binary-tile half.
 *
 * Keyless, unauthenticated, and republished roughly once a year:
 *
 *   https://djlorenz.github.io/astronomy/binary_tiles/{YEAR}/binary_tile_{tx}_{ty}.dat.gz
 *
 * 5°×5° tiles, 600×600 points (30 arcsec), ~118 KB gzipped, coverage 65°S–75°N.
 * The wire format and its two off-by-one quirks are decoded in
 * `../lib/lorenz-decode.ts`; the direction-resolved model that consumes the grid
 * is `../lib/skyglow.ts`. This module is the I/O half only: fetch, gunzip,
 * decode once, cache, and hand a synchronous sampler to the ray-march.
 *
 * Shape follows `./astro-upstreams.ts` deliberately — module-scope `Map` with a
 * TTL and FIFO eviction, an injectable `FetchImpl` seam, one OTel span per
 * public entry point, and it NEVER throws: a dead upstream yields `null` and a
 * `log.warn`, and the route degrades to a 502 rather than a 500.
 *
 * Two things differ from that file, both on purpose:
 *
 *   - The TTL is 24 h, not 60 min. The atlas changes once a year, so an hourly
 *     TTL would re-download 118 KB per site per hour to observe a number that
 *     cannot have moved.
 *   - Only the DECODED grid is cached, never the raw bytes. Raw is ~360 KB
 *     inflated and the grid 1.44 MB; keeping both doubles memory for nothing,
 *     and nothing downstream ever wants the bytes again.
 *
 * Attribution: the atlas carries no licence. The author grants use on request
 * and asks only that Bortle not be conflated with his maps — which is why there
 * is no `bortle` field anywhere in this module or its routes.
 */

import { SpanKind, SpanStatusCode, type AttributeValue } from '@opentelemetry/api'
import { gunzipSync } from 'node:zlib'
import { tracedFetch } from '../lib/traced-fetch.js'
import {
  BASELINE_LORENZ_YEAR,
  LATEST_LORENZ_YEAR,
  decodeTile,
  locateTile,
  lorenzZone,
  mpsasFromLpi,
  sampleGrid,
  trendPercent,
  TILE_SPAN_DEG,
  type LorenzYear,
  type TileCoord,
} from '../lib/lorenz-decode.js'
import {
  coreDirectionGlow,
  skyglowProfile,
  SKYGLOW_MODEL,
  type CoreDirection,
  type LpiSampler,
  type SkyglowModel,
  type SkyglowProfile,
} from '../lib/skyglow.js'
import { log, tracer } from '../telemetry.js'
import type { FetchImpl } from './astro-upstreams.js'

export type { FetchImpl }

const ATLAS_BASE_URL = 'https://djlorenz.github.io/astronomy/binary_tiles'
const REQUEST_TIMEOUT_MS = 20_000

/** One year, one publication. See the module docstring for why this is not 60 minutes. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Each grid is 1.44 MB, so 12 entries is ~17 MB — enough for every German site plus neighbours. */
const CACHE_MAX_ENTRIES = 12

/** Kilometres per degree of latitude — the same figure `../lib/skyglow.ts` marches with. */
const KM_PER_DEG_LAT = 111.32

// ── Cache ────────────────────────────────────────────────────────────────

type CacheEntry = { expiresAt: number; grid: Float32Array }

// Insertion order == FIFO eviction order for a `Map`, which is what the
// eviction rule below relies on (delete the first key once the cap is hit).
const cache = new Map<string, CacheEntry>()

function cacheKey(year: LorenzYear, tile: TileCoord): string {
  return `${year}:${tile.tx}:${tile.ty}`
}

function getCached(key: string): Float32Array | undefined {
  const entry = cache.get(key)
  if (entry === undefined) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.grid
}

function setCached(key: string, grid: Float32Array): void {
  // Only the success path reaches here — otherwise one blip would black the
  // feature out for a full 24-hour TTL.
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, grid })
}

/** Exported for tests only — drops every cached grid. */
export function clearLorenzAtlasCache(): void {
  cache.clear()
}

// ── Tiles ────────────────────────────────────────────────────────────────

function toAttributeValue(error: unknown): AttributeValue {
  return error instanceof Error ? error.message : String(error)
}

async function loadTileGrid(opts: {
  year: LorenzYear
  tile: TileCoord
  fetchImpl: FetchImpl
}): Promise<Float32Array | null> {
  const key = cacheKey(opts.year, opts.tile)
  const cached = getCached(key)
  if (cached !== undefined) return cached

  const url = `${ATLAS_BASE_URL}/${opts.year}/binary_tile_${opts.tile.tx}_${opts.tile.ty}.dat.gz`

  try {
    const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      log.warn('lorenz-atlas: tile returned non-OK status', { url, status: res.status })
      return null
    }
    const grid = decodeTile(new Uint8Array(gunzipSync(new Uint8Array(await res.arrayBuffer()))))
    setCached(key, grid)
    return grid
  } catch (error) {
    log.warn('lorenz-atlas: tile fetch failed', { url, error: toAttributeValue(error) })
    return null
  }
}

/** `from`..`to` sampled at less than one tile span, endpoints included — so no tile in between is missed. */
function tileSpanSamples(from: number, to: number): number[] {
  const samples: number[] = []
  for (let value = from; value < to; value += TILE_SPAN_DEG) samples.push(value)
  samples.push(to)
  return samples
}

/**
 * Every tile the march can touch, enumerated across its bounding box.
 *
 * The reach cannot be a constant: `marchRay` converts kilometres to degrees of
 * longitude at the SITE's latitude, which is 1.6° at 48°N but 3.9° at 74°N —
 * the atlas's own northern edge. A box fitted to 48°N misses whole tiles above
 * ~55.5° of latitude, and above ~65° the box is wider than a tile, so the four
 * corners stop being a complete enumeration too. Both are the same failure: a
 * silently truncated march reads the missing sector as pristine and biases the
 * dome toward the site. Tiles outside atlas coverage drop out here and read as
 * NaN from the sampler.
 */
function marchTiles(site: { lat: number; lon: number }, model: SkyglowModel): TileCoord[] {
  const latReach = model.rangeKm / KM_PER_DEG_LAT
  const lonReach = model.rangeKm / (KM_PER_DEG_LAT * Math.cos((site.lat * Math.PI) / 180))

  const seen = new Map<string, TileCoord>()
  for (const lat of tileSpanSamples(site.lat - latReach, site.lat + latReach)) {
    for (const lon of tileSpanSamples(site.lon - lonReach, site.lon + lonReach)) {
      const point = locateTile(lat, lon)
      if (point) seen.set(`${point.tx}:${point.ty}`, { tx: point.tx, ty: point.ty })
    }
  }
  return [...seen.values()]
}

/**
 * A synchronous sampler over already-decoded grids. Anything not pre-fetched —
 * a failed tile, or a coordinate outside coverage — reads NaN, which `marchRay`
 * can only drop from its sum, i.e. read as darkness. `marchTiles` above is what
 * keeps that case to a genuinely failed upstream.
 */
function buildSampler(grids: Map<string, Float32Array>, year: LorenzYear): LpiSampler {
  return (lat, lon) => {
    const point = locateTile(lat, lon)
    if (!point) return Number.NaN
    const grid = grids.get(cacheKey(year, point))
    if (!grid) return Number.NaN
    return sampleGrid(grid, point.ix, point.iy)
  }
}

// ── Public API ───────────────────────────────────────────────────────────

const sourceLabel = (year: LorenzYear): string => `Light Pollution Atlas ${year}, David J. Lorenz`

export type LightPollutionPoint = {
  lat: number
  lon: number
  year: LorenzYear
  /** Lorenz's Light Pollution Index: artificial over natural zenith brightness. */
  lpi: number
  /** Total zenith brightness, mag/arcsec². */
  mpsas: number
  /** Lorenz zone band, `0a`..`7b`. Deliberately not a Bortle class. */
  zone: string
  /** Percent change in LPI from 2016 to the requested year. null when the 2016 tile is unavailable, or its cell reads 0. */
  trend10yPercent: number | null
  source: string
}

/**
 * Zenith light pollution for one coordinate — a single binary-tile lookup, plus
 * the 2016 tile for the decade trend.
 *
 * Returns `null` when the coordinate is outside atlas coverage or the upstream
 * is unavailable; the trend degrades independently to `null` so a missing
 * baseline tile does not cost the caller the current value.
 */
export async function fetchLightPollution(
  input: { lat: number; lon: number; year?: LorenzYear | undefined },
  deps?: { fetchImpl?: FetchImpl | undefined },
): Promise<LightPollutionPoint | null> {
  const fetchImpl: FetchImpl = deps?.fetchImpl ?? tracedFetch
  const year = input.year ?? LATEST_LORENZ_YEAR
  const { lat, lon } = input

  return tracer.startActiveSpan(
    'fetchLightPollution',
    {
      kind: SpanKind.INTERNAL,
      attributes: { 'lorenz.lat': lat, 'lorenz.lon': lon, 'lorenz.year': year },
    },
    async (span) => {
      try {
        const point = locateTile(lat, lon)
        if (!point) {
          log.warn('lorenz-atlas: coordinate outside atlas coverage', { lat, lon })
          return null
        }

        const tile: TileCoord = { tx: point.tx, ty: point.ty }
        const [currentResult, baselineResult] = await Promise.allSettled([
          loadTileGrid({ year, tile, fetchImpl }),
          loadTileGrid({ year: BASELINE_LORENZ_YEAR, tile, fetchImpl }),
        ])

        const current = currentResult.status === 'fulfilled' ? currentResult.value : null
        const baseline = baselineResult.status === 'fulfilled' ? baselineResult.value : null
        if (!current) return null

        const lpi = sampleGrid(current, point.ix, point.iy)
        if (!Number.isFinite(lpi)) return null

        const baselineLpi = baseline ? sampleGrid(baseline, point.ix, point.iy) : Number.NaN

        span.setAttributes({ 'lorenz.lpi': lpi, 'lorenz.trend_available': baseline !== null })

        return {
          lat,
          lon,
          year,
          lpi,
          mpsas: mpsasFromLpi(lpi),
          zone: lorenzZone(lpi),
          trend10yPercent: trendPercent(baselineLpi, lpi),
          source: sourceLabel(year),
        }
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error as Error)
        // Belt-and-braces: every branch above already degrades to null, but this
        // keeps the "never throws" contract true if one ever stops doing so.
        return null
      } finally {
        span.end()
      }
    },
  )
}

export type SkyglowResult = {
  lat: number
  lon: number
  year: LorenzYear
  zenith: { lpi: number; mpsas: number; zone: string }
  core: CoreDirection
  profile: SkyglowProfile
  model: SkyglowModel
  source: string
}

/**
 * Direction-resolved skyglow for one coordinate: the full azimuth × altitude
 * rose plus the figure in the galactic core's direction.
 *
 * Every tile the 120 km march can reach is fetched up front in ONE
 * `Promise.allSettled`, then the march runs synchronously over decoded grids.
 * Fetching lazily inside the loop would serialise ~60 round trips per ray.
 */
export async function fetchSkyglow(
  input: {
    lat: number
    lon: number
    year?: LorenzYear | undefined
    coreAzimuthDeg: number
    coreAltitudeDeg: number
  },
  deps?: { fetchImpl?: FetchImpl | undefined },
): Promise<SkyglowResult | null> {
  const fetchImpl: FetchImpl = deps?.fetchImpl ?? tracedFetch
  const year = input.year ?? LATEST_LORENZ_YEAR
  const { lat, lon } = input
  const site = { lat, lon }

  return tracer.startActiveSpan(
    'fetchSkyglow',
    {
      kind: SpanKind.INTERNAL,
      attributes: { 'lorenz.lat': lat, 'lorenz.lon': lon, 'lorenz.year': year },
    },
    async (span) => {
      try {
        const zenithPoint = locateTile(lat, lon)
        if (!zenithPoint) {
          log.warn('lorenz-atlas: coordinate outside atlas coverage', { lat, lon })
          return null
        }

        const tiles = marchTiles(site, SKYGLOW_MODEL)
        const settled = await Promise.allSettled(
          tiles.map((tile) => loadTileGrid({ year, tile, fetchImpl })),
        )

        const grids = new Map<string, Float32Array>()
        for (const [index, result] of settled.entries()) {
          const tile = tiles[index]
          if (!tile) continue
          if (result.status === 'rejected') {
            log.warn('lorenz-atlas: tile rejected', {
              tile: `${tile.tx}:${tile.ty}`,
              error: toAttributeValue(result.reason),
            })
            continue
          }
          if (result.value) grids.set(cacheKey(year, tile), result.value)
        }
        span.setAttributes({
          'lorenz.tiles_requested': tiles.length,
          'lorenz.tiles_ok': grids.size,
        })

        const sampler = buildSampler(grids, year)
        const zenithLpi = sampler(lat, lon)
        // The site's own tile is the one tile that cannot be missing: without it
        // there is no calibration and every direction would be meaningless.
        if (!Number.isFinite(zenithLpi)) return null

        return {
          lat,
          lon,
          year,
          zenith: {
            lpi: zenithLpi,
            mpsas: mpsasFromLpi(zenithLpi),
            zone: lorenzZone(zenithLpi),
          },
          core: coreDirectionGlow({
            sampler,
            site,
            zenithLpi,
            coreAzimuthDeg: input.coreAzimuthDeg,
            coreAltitudeDeg: input.coreAltitudeDeg,
          }),
          profile: skyglowProfile({ sampler, site, zenithLpi }),
          model: SKYGLOW_MODEL,
          source: sourceLabel(year),
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
