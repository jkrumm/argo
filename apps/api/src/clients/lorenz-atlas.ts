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
 * and asks only that no subjective whole-sky darkness class be conflated with
 * his maps — which is why this module and its routes report measured zenith
 * brightness and a zone band, and never a class (`docs/ASTRO-MAP-RESEARCH.md`
 * §1.3).
 */

import { SpanKind, SpanStatusCode, type AttributeValue } from '@opentelemetry/api'
import { createHash } from 'node:crypto'
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
  LP_TILE_MAX_ZOOM,
  LP_TILE_MIN_ZOOM,
  renderLpTilePng,
  tileBounds,
  type MpsasSampler,
} from '../lib/lp-tile.js'
import {
  computeCalibration,
  coreDirectionGlow,
  KM_PER_DEG_LAT,
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

/**
 * Each grid is 1.44 MB, so 32 entries is ~46 MB.
 *
 * Sized for the WORST SINGLE RENDER, not for point lookups. A z5 map tile spans
 * ~11° of longitude and could touch up to 16 atlas tiles (measured maximum over
 * every tile on the globe, before `tileSpanSamples` stopped sampling exactly ON
 * a 5° boundary — see its own docstring; the fix only ever REDUCES a box's tile
 * count, so 16 stays a safe upper bound even though it is no longer the exact
 * post-fix maximum). A cap of 16 or less would let one low-zoom `fetchLpTile`
 * flush the handful of tiles `fetchLightPollution` / `fetchSkyglow` live on —
 * sending Argo's own astro endpoints back to cold-fetching 118 KB from a
 * bandwidth-capped host (see the docstring above, §8) — and would evict its own
 * tiles before the next, heavily-overlapping map tile could reuse them. Twice the
 * worst render leaves both working sets resident.
 */
const CACHE_MAX_ENTRIES = 32

/**
 * Rendered tiles measure 7 KB (z9) to ~69 KB (z5) over real atlas data, and the
 * busiest zooms sit at 40–70 KB — so 512 of them is a ~23 MB working set and a
 * ~35 MB ceiling, alongside the 46 MB of grids above. Budget against those
 * numbers, not against a compressed-PNG intuition.
 */
const TILE_CACHE_MAX_ENTRIES = 512

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

/**
 * Rendered PNG bytes, keyed `year:z:x:y`. A SECOND cache on purpose: the grid
 * cache above is keyed by 5° atlas tile and holds 1.44 MB float grids, so it
 * can never answer "give me this map tile's PNG". Rendering is cheap (~65 k
 * samples), but re-doing it for every pan of a map that is mostly re-requesting
 * the same tiles is pure waste.
 */
type TileCacheEntry = {
  expiresAt: number
  png: Uint8Array<ArrayBuffer>
  tiles: number
  etag: string
}

const tileCache = new Map<string, TileCacheEntry>()

function getCachedTile(key: string): TileCacheEntry | undefined {
  const entry = tileCache.get(key)
  if (entry === undefined) return undefined
  if (entry.expiresAt <= Date.now()) {
    tileCache.delete(key)
    return undefined
  }
  return entry
}

function setCachedTile(
  key: string,
  png: Uint8Array<ArrayBuffer>,
  tiles: number,
  etag: string,
): void {
  if (!tileCache.has(key) && tileCache.size >= TILE_CACHE_MAX_ENTRIES) {
    const oldestKey = tileCache.keys().next().value
    if (oldestKey !== undefined) tileCache.delete(oldestKey)
  }
  tileCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, png, tiles, etag })
}

/**
 * The route's ETag, computed ONCE per distinct PNG rather than once per
 * request. A panning map re-requests the same handful of tiles constantly —
 * including `If-None-Match` 304s, which still need a validator — so hashing
 * the (up to ~70 KB) PNG body on every hit made the hot path pay for a SHA-256
 * that a cache hit's bytes never change.
 */
function lpTileEtag(png: Uint8Array<ArrayBuffer>): string {
  return `"${createHash('sha256').update(png).digest('hex').slice(0, 32)}"`
}

/** Exported for tests only — drops every cached grid AND every rendered tile. */
export function clearLorenzAtlasCache(): void {
  cache.clear()
  tileCache.clear()
}

// ── Tiles ────────────────────────────────────────────────────────────────

function toAttributeValue(error: unknown): AttributeValue {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Downloads currently in flight, keyed exactly like the grid cache.
 *
 * The cache alone only dedupes SEQUENTIAL callers: a viewport that asks for four
 * adjacent z5 tiles at once fires all four before any of them has finished
 * decoding, and adjacent map tiles overlap heavily — measured, four concurrent
 * z5 renders issued 30 requests for 20 distinct URLs. Sharing the promise makes
 * the second caller wait on the first instead of duplicating a 118 KB download
 * from a bandwidth-capped host.
 */
const inFlight = new Map<string, Promise<Float32Array | null>>()

async function loadTileGrid(opts: {
  year: LorenzYear
  tile: TileCoord
  fetchImpl: FetchImpl
}): Promise<Float32Array | null> {
  const key = cacheKey(opts.year, opts.tile)
  const cached = getCached(key)
  if (cached !== undefined) return cached

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = fetchTileGrid(opts, key)
  inFlight.set(key, request)
  try {
    return await request
  } finally {
    inFlight.delete(key)
  }
}

async function fetchTileGrid(
  opts: { year: LorenzYear; tile: TileCoord; fetchImpl: FetchImpl },
  key: string,
): Promise<Float32Array | null> {
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

/**
 * Nudges an endpoint below itself, so `locateTile` never resolves it to the
 * tile on the FAR side of a boundary it lands exactly on. The one case that
 * matters in practice: the easternmost map-tile column has `maxLon` exactly
 * `180`, and `locateTile` treats `180` as the date line's WEST side
 * (`mod(180+180,360) === 0`) — the tile the map tile does not overlap.
 *
 * The nudge must be LARGER than `locateTile`'s own half-cell reference-walk
 * offset (~0.0083°, `lorenz-decode.ts`'s "pushes the last ~0.008° below every
 * 5° graticule onto index 600" quirk) — a microscopic epsilon (1e-9 was tried
 * first) still lands INSIDE that rollover band, and `locateTile` rolls it
 * straight back to the wrapped tile, reproducing the exact bug this exists to
 * fix. `0.01°` clears that band with margin while staying far short of one
 * `TILE_SPAN_DEG`, so it can never cross into a genuinely different tile for
 * any endpoint that wasn't already sitting on a boundary.
 */
const TILE_BOUNDARY_EPSILON_DEG = 0.01

/** `from`..`to` sampled at less than one tile span, endpoints included — so no tile in between is missed. */
function tileSpanSamples(from: number, to: number): number[] {
  const samples: number[] = []
  for (let value = from; value < to; value += TILE_SPAN_DEG) samples.push(value)
  samples.push(to - TILE_BOUNDARY_EPSILON_DEG)
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
  /** Lorenz zone band, `0a`..`7b`. Deliberately not a subjective whole-sky class. */
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

        // A partial march is not a measurement: `marchRay` can only drop a
        // missing sector from its sum, which reads as "no artificial light
        // there" — a confidently wrong DARKER core, silently. Refuse to score
        // one; a 502 is honest, a biased number is not.
        if (grids.size < tiles.length) {
          log.warn('lorenz-atlas: skyglow march incomplete, refusing a partial result', {
            lat,
            lon,
            tilesRequested: tiles.length,
            tilesResolved: grids.size,
          })
          return null
        }

        const sampler = buildSampler(grids, year)
        const zenithLpi = sampler(lat, lon)
        // The site's own tile is the one tile that cannot be missing: without it
        // there is no calibration and every direction would be meaningless.
        if (!Number.isFinite(zenithLpi)) return null

        // Both calls below need the same zenith calibration; compute it once
        // rather than having each re-march the (degenerate but not free) zenith ray.
        const calibration = computeCalibration({ sampler, site, zenithLpi })

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
            calibration,
          }),
          profile: skyglowProfile({ sampler, site, zenithLpi, calibration }),
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

export type LpTileImage = {
  /** Terrarium-encoded PNG bytes: `mpsas = (R*256 + G + B/256 - 32768) / 100`. */
  png: Uint8Array<ArrayBuffer>
  year: LorenzYear
  tilesRequested: number
  tilesResolved: number
  /** Pre-computed over `png` — see `lpTileEtag`'s docstring for why this isn't left to the route. */
  etag: string
}

/**
 * Every 5° atlas tile a map tile's bounding box touches.
 *
 * Enumerated across the whole box rather than from its four corners: at z5 a
 * tile spans ~11° of longitude, which is more than two atlas tiles, so the
 * corners miss the column in the middle entirely. `tileSpanSamples` walks in
 * steps smaller than one atlas tile and always includes both endpoints, so
 * nothing between them can be skipped.
 */
function boxTiles(bounds: {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}): TileCoord[] {
  const seen = new Map<string, TileCoord>()
  for (const lat of tileSpanSamples(bounds.minLat, bounds.maxLat)) {
    for (const lon of tileSpanSamples(bounds.minLon, bounds.maxLon)) {
      const point = locateTile(lat, lon)
      if (point) seen.set(`${point.tx}:${point.ty}`, { tx: point.tx, ty: point.ty })
    }
  }
  return [...seen.values()]
}

/**
 * One terrarium-encoded light-pollution raster tile, rendered from the atlas.
 *
 * The point of serving our own tiles rather than hot-linking the atlas author's
 * image tiles is twofold (`docs/ASTRO-MAP-RESEARCH.md` §6.3, §8): his images
 * carry HIS colour scheme, and they sit on a personal GitHub Pages site with a
 * soft 100 GB/month cap. This returns DATA — the dashboard applies Argo's own
 * ramp with MapLibre's `color-relief` layer.
 *
 * `null` only when the atlas was REACHABLE-and-failed: tiles exist for this box
 * and not one of them came back. A PARTIAL result still renders — the unresolved
 * region samples NaN and encodes as 22.00 mag, the natural sky, which is the
 * honest reading of "no data" on a light-pollution map and what the reference
 * encoder does — where failing the whole tile would blank a view that is 90%
 * correct. A tile with no atlas coverage AT ALL is not a failure and renders
 * flat 22.00; only the caller's `tilesRequested === 0` distinguishes it.
 */
export async function fetchLpTile(
  input: { x: number; y: number; z: number; year?: LorenzYear | undefined },
  deps?: { fetchImpl?: FetchImpl | undefined },
): Promise<LpTileImage | null> {
  const fetchImpl: FetchImpl = deps?.fetchImpl ?? tracedFetch
  const year = input.year ?? LATEST_LORENZ_YEAR
  const { x, y, z } = input

  return tracer.startActiveSpan(
    'fetchLpTile',
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'lorenz.tile_z': z,
        'lorenz.tile_x': x,
        'lorenz.tile_y': y,
        'lorenz.year': year,
      },
    },
    async (span) => {
      try {
        if (z < LP_TILE_MIN_ZOOM || z > LP_TILE_MAX_ZOOM) {
          log.warn('lorenz-atlas: tile zoom outside the served range', { z })
          return null
        }

        // The rendered bytes depend on nothing but (year, z, x, y), so a hit
        // here skips the grid lookups and the 65 k-sample render entirely.
        const key = `${year}:${z}:${x}:${y}`
        const cached = getCachedTile(key)
        if (cached) {
          span.setAttributes({
            'lorenz.tiles_requested': cached.tiles,
            'lorenz.tiles_ok': cached.tiles,
            'lorenz.tile_cached': true,
          })
          return {
            png: cached.png,
            year,
            tilesRequested: cached.tiles,
            tilesResolved: cached.tiles,
            etag: cached.etag,
          }
        }

        const tiles = boxTiles(tileBounds({ x, y, z }))
        // Above 75°N and below 65°S the atlas publishes nothing and never will,
        // so this is a PERMANENT, knowable answer — not an upstream failure. At
        // z5 that is 416 of the 1024 tiles a world view requests. Rendering the
        // no-data value gives them the same 22.00 an uncovered PIXEL already
        // gets on a partially covered tile, and unlike a `null` (which the route
        // turns into a 502) it caches, so the client asks once.
        if (tiles.length === 0) {
          const empty = renderLpTilePng({ x, y, z, sampler: () => Number.NaN })
          const etag = lpTileEtag(empty)
          setCachedTile(key, empty, 0, etag)
          span.setAttributes({ 'lorenz.tiles_requested': 0, 'lorenz.tiles_ok': 0 })
          return { png: empty, year, tilesRequested: 0, tilesResolved: 0, etag }
        }

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

        // Nothing resolved means there is no data at all behind this tile — a
        // flat 22.00 image there would be a confident claim of pristine sky.
        if (grids.size === 0) return null
        if (grids.size < tiles.length) {
          log.warn('lorenz-atlas: rendering a partially covered tile', {
            z,
            x,
            y,
            year,
            tilesRequested: tiles.length,
            tilesResolved: grids.size,
          })
        }

        const lpi = buildSampler(grids, year)
        const sampler: MpsasSampler = (lat, lon) => {
          const value = lpi(lat, lon)
          return Number.isFinite(value) ? mpsasFromLpi(value) : Number.NaN
        }

        const png = renderLpTilePng({ x, y, z, sampler })
        const etag = lpTileEtag(png)
        // Only a complete render is worth caching for a day; a partial one
        // should re-try the missing atlas tiles on the next request.
        if (grids.size === tiles.length) setCachedTile(key, png, tiles.length, etag)
        return { png, year, tilesRequested: tiles.length, tilesResolved: grids.size, etag }
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
