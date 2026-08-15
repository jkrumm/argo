/**
 * The two weather inputs the marine window scorer needs
 * (`../lib/marine-score.ts`): Open-Meteo's marine model (swell/wave) and its
 * global forecast model (wind). Fetches both in parallel and — like
 * `astro-upstreams.ts`, whose shape this mirrors — never throws. A dead or
 * degraded upstream flips a `health` flag instead; `coverage` in the score is
 * what actually reflects the gap to the caller.
 *
 * Two upstreams, both keyless:
 *
 *   - Open-Meteo Marine (`marine-api.open-meteo.com/v1/marine`) — significant
 *     wave height, swell height/period/direction. Real horizon is 7 days.
 *   - Open-Meteo global forecast (`api.open-meteo.com/v1/forecast`) — wind
 *     speed/direction/gusts, requested with `wind_speed_unit=kn` because
 *     `marine-score.ts`'s wind thresholds (`GLASSY_WIND_KN`, `RUINOUS_WIND_KN`)
 *     are in knots and Open-Meteo defaults to km/h. Getting this wrong
 *     silently rescales every wind judgement in the scorer.
 *
 * Both upstreams' `timezone=UTC` hourly `time` strings arrive zone-less
 * (`"2026-08-15T20:00"`) — parsed the same way `astro-upstreams.ts` does,
 * by appending `:00Z` rather than handing the bare string to `new Date()`,
 * which would read it as machine-local.
 *
 * Caching is the same plain module-scope `Map` with a 60-minute TTL that
 * `astro-upstreams.ts` uses, for the same reason: Argo is a single-instance
 * deploy, forecasts refresh hourly upstream at best, and this keeps real
 * request volume against Open-Meteo's free tier trivial.
 */

import { SpanKind, SpanStatusCode, type AttributeValue } from '@opentelemetry/api'
import type { FetchImpl } from './astro-upstreams.js'
import { tracedFetch } from '../lib/traced-fetch.js'
import { log, tracer } from '../telemetry.js'

export type { FetchImpl }

/** A single hour of swell/wave conditions. `null` = the upstream had no value for that hour. */
export type MarineReading = {
  /** Total significant wave height, metres. */
  waveHeight: number | null
  /** Significant swell height, metres. */
  swellHeight: number | null
  /** Swell period, seconds. */
  swellPeriod: number | null
  /** Degrees the swell comes FROM. */
  swellDirection: number | null
}

/** A single hour of wind. */
export type WindReading = {
  /** Knots — requested with `wind_speed_unit=kn`, never the km/h default. */
  speedKn: number | null
  /** Degrees the wind comes FROM (meteorological convention). */
  directionDeg: number | null
  gustKn: number | null
}

/** Both keyed by epoch-ms of the UTC hour the value applies to. */
export type MarineSeries = Map<number, MarineReading>
export type WindSeries = Map<number, WindReading>

export type MarineUpstreamHealth = { marine: boolean; wind: boolean }

export type MarineUpstreams = {
  marine: MarineSeries
  wind: WindSeries
  /** Which upstreams answered. A false here is why `coverage` in the score drops. */
  health: MarineUpstreamHealth
}

const MIN_DAYS = 1
/** The marine model's real horizon — beyond this the forecast is not meaningful. */
const MAX_DAYS = 7
const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

function clampDays(days: number): number {
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(days)))
}

// ── Cache ────────────────────────────────────────────────────────────────

type UpstreamSource = 'marine' | 'wind'
type CacheValue = MarineSeries | WindSeries
type CacheEntry = { expiresAt: number; value: CacheValue }

// Insertion order == FIFO eviction order for a `Map`, which is what the
// eviction rule below relies on (delete the first key once the cap is hit).
const cache = new Map<string, CacheEntry>()

function cacheKey(source: UpstreamSource, lat: number, lon: number, days: number): string {
  // 2 dp ≈ 1 km, matching astro-upstreams.ts's cache key precision.
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
export function clearMarineUpstreamCache(): void {
  cache.clear()
}

// ── Upstream response shapes ────────────────────────────────────────────

type OpenMeteoMarineResponse = {
  hourly: {
    time: string[]
    wave_height: (number | null)[]
    swell_wave_height: (number | null)[]
    swell_wave_period: (number | null)[]
    swell_wave_direction: (number | null)[]
  }
}

type OpenMeteoWindResponse = {
  hourly: {
    time: string[]
    wind_speed_10m: (number | null)[]
    wind_direction_10m: (number | null)[]
    wind_gusts_10m: (number | null)[]
  }
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

function parseMarine(json: OpenMeteoMarineResponse): MarineSeries {
  const series: MarineSeries = new Map()
  const { time, wave_height, swell_wave_height, swell_wave_period, swell_wave_direction } =
    json.hourly
  for (let i = 0; i < time.length; i++) {
    const t = time[i]
    if (t === undefined) continue
    series.set(parseOpenMeteoHour(t), {
      waveHeight: wave_height[i] ?? null,
      swellHeight: swell_wave_height[i] ?? null,
      swellPeriod: swell_wave_period[i] ?? null,
      swellDirection: swell_wave_direction[i] ?? null,
    })
  }
  return series
}

function parseWind(json: OpenMeteoWindResponse): WindSeries {
  const series: WindSeries = new Map()
  const { time, wind_speed_10m, wind_direction_10m, wind_gusts_10m } = json.hourly
  for (let i = 0; i < time.length; i++) {
    const t = time[i]
    if (t === undefined) continue
    series.set(parseOpenMeteoHour(t), {
      speedKn: wind_speed_10m[i] ?? null,
      directionDeg: wind_direction_10m[i] ?? null,
      gustKn: wind_gusts_10m[i] ?? null,
    })
  }
  return series
}

// ── Fetch ────────────────────────────────────────────────────────────────

function toAttributeValue(error: unknown): AttributeValue {
  return error instanceof Error ? error.message : String(error)
}

async function fetchMarine(opts: {
  lat: number
  lon: number
  days: number
  fetchImpl: FetchImpl
}): Promise<MarineSeries | null> {
  const key = cacheKey('marine', opts.lat, opts.lon, opts.days)
  const cached = getCached<MarineSeries>(key)
  if (cached !== undefined) return cached

  const url = new URL('https://marine-api.open-meteo.com/v1/marine')
  url.searchParams.set('latitude', String(opts.lat))
  url.searchParams.set('longitude', String(opts.lon))
  url.searchParams.set(
    'hourly',
    'wave_height,swell_wave_height,swell_wave_period,swell_wave_direction',
  )
  url.searchParams.set('forecast_days', String(opts.days))
  url.searchParams.set('timezone', 'UTC')

  try {
    const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      log.warn('marine-upstreams: marine returned non-OK status', { status: res.status })
      return null
    }
    const json = (await res.json()) as OpenMeteoMarineResponse
    const series = parseMarine(json)
    setCached(key, series)
    return series
  } catch (error) {
    log.warn('marine-upstreams: marine fetch failed', { error: toAttributeValue(error) })
    return null
  }
}

async function fetchWind(opts: {
  lat: number
  lon: number
  days: number
  fetchImpl: FetchImpl
}): Promise<WindSeries | null> {
  const key = cacheKey('wind', opts.lat, opts.lon, opts.days)
  const cached = getCached<WindSeries>(key)
  if (cached !== undefined) return cached

  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(opts.lat))
  url.searchParams.set('longitude', String(opts.lon))
  url.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,wind_gusts_10m')
  url.searchParams.set('forecast_days', String(opts.days))
  url.searchParams.set('timezone', 'UTC')
  // Load-bearing: Open-Meteo defaults to km/h, but marine-score.ts's wind
  // thresholds are in knots. Getting this wrong silently rescales every
  // wind judgement in the scorer.
  url.searchParams.set('wind_speed_unit', 'kn')

  try {
    const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      log.warn('marine-upstreams: wind returned non-OK status', { status: res.status })
      return null
    }
    const json = (await res.json()) as OpenMeteoWindResponse
    const series = parseWind(json)
    setCached(key, series)
    return series
  } catch (error) {
    log.warn('marine-upstreams: wind fetch failed', { error: toAttributeValue(error) })
    return null
  }
}

/**
 * Fetches the marine (swell/wave) and wind upstreams in one
 * `Promise.allSettled` — one parent INTERNAL span here, two parallel CLIENT
 * spans underneath from `tracedFetch` (or the injected `fetchImpl`), no
 * waterfall. Both calls are kicked off synchronously before anything is
 * awaited, so the OTel context propagates correctly to both as children of
 * this span.
 *
 * Never throws: a rejected or non-OK upstream just flips its `health` flag
 * to `false` and contributes nothing — the caller (the marine window route)
 * degrades its `coverage` factor rather than erroring the whole request
 * over one flaky upstream.
 */
export async function fetchMarineUpstreams(
  input: { lat: number; lon: number; days: number },
  deps?: { fetchImpl?: FetchImpl },
): Promise<MarineUpstreams> {
  const fetchImpl: FetchImpl = deps?.fetchImpl ?? tracedFetch
  const days = clampDays(input.days)
  const { lat, lon } = input

  return tracer.startActiveSpan(
    'fetchMarineUpstreams',
    {
      kind: SpanKind.INTERNAL,
      attributes: { 'marine.lat': lat, 'marine.lon': lon, 'marine.days': days },
    },
    async (span) => {
      try {
        const [marineResult, windResult] = await Promise.allSettled([
          fetchMarine({ lat, lon, days, fetchImpl }),
          fetchWind({ lat, lon, days, fetchImpl }),
        ])

        // `Promise.allSettled` never rejects its own entries into a throw —
        // each settled result is unwrapped here rather than re-thrown, which
        // is what makes "never throws" hold even if a fetch* helper above
        // somehow rejects instead of resolving to `null`.
        const marine = marineResult.status === 'fulfilled' ? marineResult.value : null
        const wind = windResult.status === 'fulfilled' ? windResult.value : null

        if (marineResult.status === 'rejected') {
          log.warn('marine-upstreams: marine rejected', {
            error: toAttributeValue(marineResult.reason),
          })
        }
        if (windResult.status === 'rejected') {
          log.warn('marine-upstreams: wind rejected', {
            error: toAttributeValue(windResult.reason),
          })
        }

        const health: MarineUpstreamHealth = { marine: marine !== null, wind: wind !== null }
        span.setAttributes({
          'marine.health.marine': health.marine,
          'marine.health.wind': health.wind,
        })

        return { marine: marine ?? new Map(), wind: wind ?? new Map(), health }
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error as Error)
        // Belt-and-braces — every branch above already degrades instead of
        // throwing, but if something upstream of that ever changes, this is
        // the backstop that keeps the "never throws" contract true.
        return { marine: new Map(), wind: new Map(), health: { marine: false, wind: false } }
      } finally {
        span.end()
      }
    },
  )
}

// ── Lookups ──────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000

/** The reading for the UTC hour containing `at` (floored). `null` when absent — never interpolated. */
export function marineAt(series: MarineSeries, at: Date): MarineReading | null {
  const hourStart = Math.floor(at.getTime() / HOUR_MS) * HOUR_MS
  return series.get(hourStart) ?? null
}

/** The reading for the UTC hour containing `at` (floored). `null` when absent — never interpolated. */
export function windAt(series: WindSeries, at: Date): WindReading | null {
  const hourStart = Math.floor(at.getTime() / HOUR_MS) * HOUR_MS
  return series.get(hourStart) ?? null
}
