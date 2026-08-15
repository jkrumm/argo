/**
 * The two weather inputs the astro window scorer needs (`../lib/astro-score.ts`):
 * layered cloud cover and 7Timer atmospheric transparency. Fetches all three
 * upstreams in parallel, merges the two cloud sources, and — critically —
 * never throws. A dead or degraded upstream flips a `health` flag instead;
 * the scorer's `coverage` factor is what actually reflects the gap to the
 * caller, so a network blip degrades a score rather than 500ing the route.
 *
 * Three upstreams, all keyless:
 *
 *   - DWD ICON (`/v1/dwd-icon`) — primary cloud cover, 2.2 km resolution over
 *     Bavaria. Real horizon is ~7.5 days even when `forecast_days` asks for
 *     more (the tail comes back `null`), which is exactly why the global
 *     forecast exists as a fallback.
 *   - Open-Meteo global forecast (`/v1/forecast`) — same params, coarser
 *     model, but a genuine 16-day horizon. Fills the holes ICON leaves.
 *   - 7Timer ASTRO (`7timer.info`) — `transparency` only. Its `seeing` field
 *     is arcsecond-scale atmospheric turbulence, irrelevant at a 12 mm focal
 *     length, and must never be surfaced; `cloudcover` is dropped too since
 *     DWD's layered values are strictly better.
 *
 * Caching is a plain module-scope `Map` with a 60-minute TTL, one entry per
 * upstream per (lat, lon, days) — deliberately not Valkey. Argo is a
 * single-instance deploy and `REDIS_URL` is unset in tests; `../routes/
 * walking-pad.ts`'s in-memory live-snapshot store is the house precedent for
 * this call. The TTL is what keeps real request volume in the dozens/day
 * against Open-Meteo's 10 000/day non-commercial free tier — forecasts only
 * refresh hourly upstream anyway, so anything tighter buys nothing.
 */

import { SpanKind, SpanStatusCode, type AttributeValue } from '@opentelemetry/api'
import { tracedFetch, type TraceOptions } from '../lib/traced-fetch.js'
import { log, tracer } from '../telemetry.js'

/**
 * Minimal fetch shape matching `tracedFetch` — deliberately NOT `typeof
 * fetch`: Bun's global `fetch` type carries a Bun-specific `preconnect`
 * property that `tracedFetch` doesn't (and can't sanely) implement, so
 * `typeof fetch` rejects it as an assignment target. Mirrors `FetchImpl` in
 * `../routes/ai.ts`'s `AiRouteDeps`, the existing injection seam this one
 * copies the shape of.
 */
export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
  traceOptions?: TraceOptions,
) => Promise<Response>

/** Cloud cover by layer, percent 0–100. `null` = the upstream had no value for that hour. */
export type CloudCover = { low: number | null; mid: number | null; high: number | null }

/** Keyed by epoch-ms of the UTC hour the value applies to. */
export type CloudSeries = Map<number, CloudCover>

/** Keyed by epoch-ms of the 3-hourly slot. Value is a 7Timer transparency band, 1 (best) to 8. */
export type TransparencySeries = Map<number, number>

export type UpstreamHealth = {
  dwdIcon: boolean
  globalForecast: boolean
  sevenTimer: boolean
}

export type AstroUpstreams = {
  cloud: CloudSeries
  transparency: TransparencySeries
  /** Which upstreams answered. A false here is why `coverage` in the score drops. */
  health: UpstreamHealth
}

const MIN_DAYS = 1
const MAX_DAYS = 16
const ICON_MAX_FORECAST_DAYS = 10
const GLOBAL_MAX_FORECAST_DAYS = 16
const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

function clampDays(days: number): number {
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(days)))
}

// ── Cache ────────────────────────────────────────────────────────────────

type UpstreamSource = 'dwd-icon' | 'global-forecast' | 'seven-timer'
type CacheValue = CloudSeries | TransparencySeries

type CacheEntry = { expiresAt: number; value: CacheValue }

// Insertion order == FIFO eviction order for a `Map`, which is what the
// eviction rule below relies on (delete the first key once the cap is hit).
const cache = new Map<string, CacheEntry>()

function cacheKey(source: UpstreamSource, lat: number, lon: number, days: number): string {
  // 2 dp ≈ 1 km, and Open-Meteo snaps to its own grid anyway (it has echoed
  // back 48.14/11.58 for a 48.1374/11.5755 request) — finer keys would just
  // fragment the cache without buying real precision.
  return `${source}:${lat.toFixed(2)}:${lon.toFixed(2)}:${days}`
}

function getCached<T extends CacheValue>(key: string): T | undefined {
  const entry = cache.get(key)
  if (entry === undefined) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.value as T
}

function setCached(key: string, value: CacheValue): void {
  // A failed fetch must never reach here — see each fetch* function below,
  // which only calls setCached on the success path. Otherwise one blip would
  // black the feature out for a full TTL.
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value })
}

/** Exported for tests only — drops every cached entry. */
export function clearAstroUpstreamCache(): void {
  cache.clear()
}

// ── Upstream response shapes ────────────────────────────────────────────

type OpenMeteoCloudResponse = {
  hourly: {
    time: string[]
    cloud_cover_low: (number | null)[]
    cloud_cover_mid: (number | null)[]
    cloud_cover_high: (number | null)[]
  }
}

type SevenTimerResponse = {
  /** `YYYYMMDDHH`, UTC. */
  init: string
  dataseries: Array<{
    /** Hours after `init`. */
    timepoint: number
    transparency: number
    // `seeing` / `cloudcover` are present on the wire but deliberately unread
    // — see the module docstring.
  }>
}

// ── Parsing ──────────────────────────────────────────────────────────────

/**
 * Open-Meteo's `timezone=UTC` hourly `time` strings arrive zone-less
 * (`"2026-08-15T20:00"`). Appending `:00Z` and parsing that is the only safe
 * route to a UTC epoch — a bare `new Date(t)` would read the string as
 * machine-local time, silently shifting every value by the host's UTC offset.
 */
function parseOpenMeteoHour(time: string): number {
  return new Date(`${time}:00Z`).getTime()
}

function parseOpenMeteoCloud(json: OpenMeteoCloudResponse): CloudSeries {
  const series: CloudSeries = new Map()
  const { time, cloud_cover_low, cloud_cover_mid, cloud_cover_high } = json.hourly
  for (let i = 0; i < time.length; i++) {
    const t = time[i]
    if (t === undefined) continue
    series.set(parseOpenMeteoHour(t), {
      low: cloud_cover_low[i] ?? null,
      mid: cloud_cover_mid[i] ?? null,
      high: cloud_cover_high[i] ?? null,
    })
  }
  return series
}

/**
 * 7Timer's `init` is a bare `YYYYMMDDHH` UTC string with no separators and no
 * zone marker — handing it to `new Date()` either fails to parse or (on some
 * engines) reads it as local time. Slicing the fields out and building via
 * `Date.UTC` is the only unambiguous route to the right absolute instant.
 */
function parseSevenTimerInit(init: string): number {
  const year = Number(init.slice(0, 4))
  const month = Number(init.slice(4, 6))
  const day = Number(init.slice(6, 8))
  const hour = Number(init.slice(8, 10))
  return Date.UTC(year, month - 1, day, hour)
}

function parseSevenTimer(json: SevenTimerResponse): TransparencySeries {
  const series: TransparencySeries = new Map()
  const initMs = parseSevenTimerInit(json.init)
  for (const entry of json.dataseries) {
    series.set(initMs + entry.timepoint * 60 * 60 * 1000, entry.transparency)
  }
  return series
}

// ── Merge ────────────────────────────────────────────────────────────────

/**
 * ICON wins per-hour-PER-LAYER wherever it has a non-null number; the global
 * forecast fills only the holes. Merging at layer granularity (not whole-hour)
 * matters because a single ICON hour is commonly null on one layer and
 * populated on the other two near the edge of its ~7.5-day real horizon —
 * falling back whole-hour would throw away two perfectly good ICON readings
 * to patch one missing one.
 */
function mergeCloud(icon: CloudSeries | null, global: CloudSeries | null): CloudSeries {
  const merged: CloudSeries = new Map()
  if (icon === null && global === null) return merged

  const hours = new Set<number>()
  icon?.forEach((_, hour) => hours.add(hour))
  global?.forEach((_, hour) => hours.add(hour))

  for (const hour of hours) {
    const fromIcon = icon?.get(hour)
    const fromGlobal = global?.get(hour)
    merged.set(hour, {
      low: fromIcon?.low ?? fromGlobal?.low ?? null,
      mid: fromIcon?.mid ?? fromGlobal?.mid ?? null,
      high: fromIcon?.high ?? fromGlobal?.high ?? null,
    })
  }
  return merged
}

// ── Fetch ────────────────────────────────────────────────────────────────

function toAttributeValue(error: unknown): AttributeValue {
  return error instanceof Error ? error.message : String(error)
}

async function fetchCloudUpstream(opts: {
  source: 'dwd-icon' | 'global-forecast'
  host: string
  lat: number
  lon: number
  days: number
  maxForecastDays: number
  fetchImpl: FetchImpl
}): Promise<CloudSeries | null> {
  const key = cacheKey(opts.source, opts.lat, opts.lon, opts.days)
  const cached = getCached<CloudSeries>(key)
  if (cached !== undefined) return cached

  const url = new URL(opts.host)
  url.searchParams.set('latitude', String(opts.lat))
  url.searchParams.set('longitude', String(opts.lon))
  url.searchParams.set('hourly', 'cloud_cover_low,cloud_cover_mid,cloud_cover_high')
  url.searchParams.set('forecast_days', String(Math.min(opts.days, opts.maxForecastDays)))
  url.searchParams.set('timezone', 'UTC')

  try {
    const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      log.warn(`astro-upstreams: ${opts.source} returned non-OK status`, {
        source: opts.source,
        status: res.status,
      })
      return null
    }
    const json = (await res.json()) as OpenMeteoCloudResponse
    const series = parseOpenMeteoCloud(json)
    setCached(key, series)
    return series
  } catch (error) {
    log.warn(`astro-upstreams: ${opts.source} fetch failed`, {
      source: opts.source,
      error: toAttributeValue(error),
    })
    return null
  }
}

async function fetchSevenTimer(opts: {
  lat: number
  lon: number
  fetchImpl: FetchImpl
}): Promise<TransparencySeries | null> {
  // 7Timer's request carries no horizon parameter — it always returns its full
  // 72-hour series — so the days component is pinned to 0 rather than the
  // caller's value. Keying it on `days` would fragment the cache and re-fetch
  // the identical response every time the caller asked for a different range.
  const key = cacheKey('seven-timer', opts.lat, opts.lon, 0)
  const cached = getCached<TransparencySeries>(key)
  if (cached !== undefined) return cached

  const url = new URL('https://www.7timer.info/bin/api.pl')
  url.searchParams.set('lon', String(opts.lon))
  url.searchParams.set('lat', String(opts.lat))
  url.searchParams.set('product', 'astro')
  url.searchParams.set('output', 'json')

  try {
    const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      log.warn('astro-upstreams: seven-timer returned non-OK status', { status: res.status })
      return null
    }
    const json = (await res.json()) as SevenTimerResponse
    const series = parseSevenTimer(json)
    setCached(key, series)
    return series
  } catch (error) {
    log.warn('astro-upstreams: seven-timer fetch failed', { error: toAttributeValue(error) })
    return null
  }
}

/**
 * Fetches DWD ICON cloud, the Open-Meteo global-forecast cloud fallback, and
 * 7Timer transparency in one `Promise.allSettled` — one parent CLIENT-adjacent
 * span here, three parallel CLIENT spans underneath from `tracedFetch` (or the
 * injected `fetchImpl`), no waterfall. Each of the three calls is kicked off
 * synchronously before anything is awaited, so the OTel context propagates
 * correctly to all three as children of this span.
 *
 * Never throws: a rejected or non-OK upstream just flips its `health` flag to
 * `false` and contributes nothing to the merge — the caller (the astro window
 * route) degrades its `coverage` factor rather than erroring the whole
 * request over one flaky upstream.
 */
export async function fetchAstroUpstreams(
  input: { lat: number; lon: number; days: number },
  deps?: { fetchImpl?: FetchImpl },
): Promise<AstroUpstreams> {
  const fetchImpl: FetchImpl = deps?.fetchImpl ?? tracedFetch
  const days = clampDays(input.days)
  const { lat, lon } = input

  return tracer.startActiveSpan(
    'fetchAstroUpstreams',
    {
      kind: SpanKind.INTERNAL,
      attributes: { 'astro.lat': lat, 'astro.lon': lon, 'astro.days': days },
    },
    async (span) => {
      try {
        const [iconResult, globalResult, sevenTimerResult] = await Promise.allSettled([
          fetchCloudUpstream({
            source: 'dwd-icon',
            host: 'https://api.open-meteo.com/v1/dwd-icon',
            lat,
            lon,
            days,
            maxForecastDays: ICON_MAX_FORECAST_DAYS,
            fetchImpl,
          }),
          fetchCloudUpstream({
            source: 'global-forecast',
            host: 'https://api.open-meteo.com/v1/forecast',
            lat,
            lon,
            days,
            maxForecastDays: GLOBAL_MAX_FORECAST_DAYS,
            fetchImpl,
          }),
          fetchSevenTimer({ lat, lon, fetchImpl }),
        ])

        // `Promise.allSettled` never rejects its own entries into a throw —
        // each settled result is unwrapped here rather than re-thrown, which
        // is what makes "never throws" hold even if a fetch* helper above
        // somehow rejects instead of resolving to `null`.
        const icon = iconResult.status === 'fulfilled' ? iconResult.value : null
        const global = globalResult.status === 'fulfilled' ? globalResult.value : null
        const sevenTimer = sevenTimerResult.status === 'fulfilled' ? sevenTimerResult.value : null

        if (iconResult.status === 'rejected') {
          log.warn('astro-upstreams: dwd-icon rejected', {
            error: toAttributeValue(iconResult.reason),
          })
        }
        if (globalResult.status === 'rejected') {
          log.warn('astro-upstreams: global-forecast rejected', {
            error: toAttributeValue(globalResult.reason),
          })
        }
        if (sevenTimerResult.status === 'rejected') {
          log.warn('astro-upstreams: seven-timer rejected', {
            error: toAttributeValue(sevenTimerResult.reason),
          })
        }

        const health: UpstreamHealth = {
          dwdIcon: icon !== null,
          globalForecast: global !== null,
          sevenTimer: sevenTimer !== null,
        }
        span.setAttributes({
          'astro.health.dwd_icon': health.dwdIcon,
          'astro.health.global_forecast': health.globalForecast,
          'astro.health.seven_timer': health.sevenTimer,
        })

        return {
          cloud: mergeCloud(icon, global),
          transparency: sevenTimer ?? new Map(),
          health,
        }
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error as Error)
        // Belt-and-braces — every branch above already degrades instead of
        // throwing, but if something upstream of that ever changes, this is
        // the backstop that keeps the "never throws" contract true.
        return {
          cloud: new Map(),
          transparency: new Map(),
          health: { dwdIcon: false, globalForecast: false, sevenTimer: false },
        }
      } finally {
        span.end()
      }
    },
  )
}

// ── Lookups ──────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000
const TRANSPARENCY_REACH_MS = 3 * HOUR_MS

/** The reading for the UTC hour containing `at` (floored). `null` when absent — never interpolated. */
export function cloudAt(series: CloudSeries, at: Date): CloudCover | null {
  const hourStart = Math.floor(at.getTime() / HOUR_MS) * HOUR_MS
  return series.get(hourStart) ?? null
}

/**
 * The latest 3-hourly transparency slot at or before `at`, but only within a
 * 3-hour reach — beyond that it returns `null` rather than a stale band from
 * a slot that's no longer representative of current conditions.
 */
export function transparencyAt(series: TransparencySeries, at: Date): number | null {
  const target = at.getTime()
  let bestSlot: number | null = null

  for (const slot of series.keys()) {
    if (slot > target) continue
    if (bestSlot === null || slot > bestSlot) bestSlot = slot
  }

  if (bestSlot === null) return null
  if (target - bestSlot > TRANSPARENCY_REACH_MS) return null
  return series.get(bestSlot) ?? null
}
