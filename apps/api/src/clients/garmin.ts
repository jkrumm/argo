// Garmin Connect Personal API client (https://personal.connectapi.garmin.com). A personal API
// key (GARMIN_API_KEY) is exchanged for a 24 h JWT, cached in memory and re-minted before it
// lapses. The typed SDK under src/generated/garmin is generated from the vendored official spec
// (`bun run gen:garmin`); the token endpoint is not in that spec and is called directly.

import { env } from '../env.js'
import {
  hasValues,
  jwtExpiryMs,
  mapActivities,
  mapHeartRate,
  mapHrv,
  mapSleep,
  mapUserSummary,
} from '../lib/garmin-mapping.js'
import { tracedFetch } from '../lib/traced-fetch.js'
import { log } from '../telemetry.js'
import { createClient, createConfig } from '../generated/garmin/client'
import {
  getActivitylistServiceActivitiesSearchActivities,
  getHrvServiceHrvByCalendarDate,
  getSleepServiceSleepDailySleep,
  getUsersummaryServiceUsersummaryDaily,
  getWellnessServiceWellnessDailyHeartRate,
} from '../generated/garmin/sdk.gen'

// Mirrors the columns we upsert into daily_metrics. All optional — a day's call can fail or
// come back empty, and the upsert only overwrites with non-null values.
export type DailyMetric = {
  date: string
  steps?: number | null
  distance_m?: number | null
  total_kcal?: number | null
  active_kcal?: number | null
  floors_ascended?: number | null
  moderate_intensity_min?: number | null
  vigorous_intensity_min?: number | null
  resting_hr?: number | null
  max_hr?: number | null
  min_hr?: number | null
  hrv_last_night_avg?: number | null
  hrv_last_night_5min_high?: number | null
  hrv_weekly_avg?: number | null
  hrv_status?: string | null
  sleep_score?: number | null
  sleep_duration_sec?: number | null
  deep_sleep_sec?: number | null
  light_sleep_sec?: number | null
  rem_sleep_sec?: number | null
  awake_sleep_sec?: number | null
  avg_sleep_stress?: number | null
  avg_sleep_hr?: number | null
  avg_sleep_respiration?: number | null
  avg_stress?: number | null
  max_stress?: number | null
  bb_highest?: number | null
  bb_lowest?: number | null
  bb_charged?: number | null
  bb_drained?: number | null
  avg_waking_respiration?: number | null
  avg_spo2?: number | null
  lowest_spo2?: number | null
  vo2_max?: number | null
}

export type ActivityRecord = {
  activity_id: number
  date: string
  start_time_local: string
  type_key: string
  activity_name?: string | null
  duration_sec?: number | null
  distance_m?: number | null
  calories?: number | null
  avg_hr?: number | null
  max_hr?: number | null
  aerobic_te?: number | null
  anaerobic_te?: number | null
  training_effect_label?: string | null
  training_load?: number | null
  moderate_intensity_min?: number | null
  vigorous_intensity_min?: number | null
  hr_zone_1_sec?: number | null
  hr_zone_2_sec?: number | null
  hr_zone_3_sec?: number | null
  hr_zone_4_sec?: number | null
  hr_zone_5_sec?: number | null
  bb_delta?: number | null
  steps?: number | null
  vo2_max?: number | null
}

const BASE_URL = 'https://personal.connectapi.garmin.com'
const TOKEN_URL = `${BASE_URL}/personalapitoken-service/personal-api/personal-api-key/token`
const REQUEST_TIMEOUT_MS = 60_000
const REMINT_WITHIN_MS = 60 * 60 * 1000 // re-mint when the JWT has < 1 h left
const FALLBACK_LIFETIME_MS = 23 * 60 * 60 * 1000 // undecodable JWT: assume 23 h of the 24 h
// The live service answers HTTP 500 once a search window exceeds ~50 results — keep pages small.
const ACTIVITY_PAGE_SIZE = 20

/** The key was rejected or no token could be minted — the whole sync must record an error. */
export class GarminAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GarminAuthError'
  }
}

const client = createClient(
  createConfig({
    baseUrl: BASE_URL,
    // Type-cast: same reason as clients/ticktick.ts — tracedFetch lacks lib.dom's static `preconnect`.
    fetch: tracedFetch as unknown as typeof fetch,
  }),
)

let cachedToken: { jwt: string; expiresAt: number } | null = null

/** Drops the cached JWT so the next call mints a fresh one (used by tests). */
export function resetGarminToken(): void {
  cachedToken = null
}

async function mintToken(): Promise<string> {
  if (!env.GARMIN_API_KEY) throw new GarminAuthError('GARMIN_API_KEY not configured')

  let res: Response
  try {
    res = await tracedFetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${env.GARMIN_API_KEY}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    throw new GarminAuthError(`garmin token request failed: ${(e as Error).message}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GarminAuthError(`garmin token mint → ${res.status}: ${body.slice(0, 200)}`)
  }

  // The body is the raw JWT string, not JSON.
  const jwt = (await res.text()).trim()
  if (!jwt) throw new GarminAuthError('garmin token mint returned an empty body')
  cachedToken = { jwt, expiresAt: jwtExpiryMs(jwt) ?? Date.now() + FALLBACK_LIFETIME_MS }
  return jwt
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() >= REMINT_WITHIN_MS) return cachedToken.jwt
  return mintToken()
}

// `response` is undefined when the transport itself failed (the generated client swallows it into `error`).
type SdkResult<T> = { data?: T; error?: unknown; response?: Response }

/**
 * Runs one SDK call with the cached bearer. A 401 drops the token, re-mints once and retries
 * once; a second 401 is an auth failure. Returns undefined for 204 (no data). Any other
 * non-2xx or transport error throws a plain Error (callers treat those as per-call failures).
 */
async function call<T>(
  label: string,
  run: (headers: { Authorization: string }) => Promise<SdkResult<T>>,
): Promise<T | undefined> {
  let result = await run({ Authorization: `Bearer ${await getToken()}` })
  if (result.response?.status === 401) {
    cachedToken = null
    result = await run({ Authorization: `Bearer ${await getToken()}` })
    if (result.response?.status === 401) {
      throw new GarminAuthError(`garmin ${label} → 401 after re-mint`)
    }
  }

  const { response } = result
  if (!response) throw new Error(`garmin ${label} failed: ${String(result.error)}`)
  if (!response.ok) {
    throw new Error(
      `garmin ${label} → ${response.status}: ${JSON.stringify(result.error).slice(0, 200)}`,
    )
  }
  if (response.status === 204) return undefined
  return result.data
}

/** One independent per-day call: a failure logs a warning and yields nothing, auth failures propagate. */
async function tolerate<T>(date: string, label: string, run: () => Promise<T | undefined>) {
  try {
    return await run()
  } catch (e) {
    if (e instanceof GarminAuthError) throw e
    log.warn(`garmin: ${label} failed for ${date}`, { error: (e as Error).message })
    return undefined
  }
}

/** Narrows a response to a non-empty body (the client yields `{}` for 204). */
function hasBody<T extends object>(data: T | void | undefined): data is T {
  return typeof data === 'object' && data !== null && Object.keys(data).length > 0
}

function eachDay(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  const count = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000) + 1
  return Array.from({ length: Math.max(count, 0) }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  )
}

async function dailyMetricsForDay(date: string): Promise<DailyMetric | null> {
  const summary = await tolerate(date, 'usersummary', () =>
    call('usersummary/daily', (headers) =>
      getUsersummaryServiceUsersummaryDaily({ client, headers, query: { calendarDate: date } }),
    ),
  )
  const heartRate = await tolerate(date, 'dailyHeartRate', () =>
    call('wellness/dailyHeartRate', (headers) =>
      getWellnessServiceWellnessDailyHeartRate({ client, headers, query: { date } }),
    ),
  )
  const hrv = await tolerate(date, 'hrv', () =>
    call('hrv', (headers) =>
      getHrvServiceHrvByCalendarDate({ client, headers, path: { calendarDate: date } }),
    ),
  )
  const sleep = await tolerate(date, 'dailySleep', () =>
    call('sleep/dailySleep', (headers) =>
      getSleepServiceSleepDailySleep({ client, headers, query: { date } }),
    ),
  )

  // vo2_max stays undefined: the Personal API has no daily max-metrics endpoint, and the
  // upsert preserves an existing non-null value.
  const fields: Omit<DailyMetric, 'date'> = {
    ...(hasBody(summary) ? mapUserSummary(summary) : {}),
    ...(hasBody(heartRate) ? mapHeartRate(heartRate) : {}),
    ...(hasBody(hrv) ? mapHrv(hrv) : {}),
    ...(hasBody(sleep) ? mapSleep(sleep) : {}),
  }
  return hasValues(fields) ? { date, ...fields } : null
}

export const garmin = {
  /** Daily metrics for an inclusive YYYY-MM-DD window, one day at a time (rate limits are unpublished). */
  async dailyMetrics(opts: { from: string; to: string }): Promise<DailyMetric[]> {
    const metrics: DailyMetric[] = []
    for (const date of eachDay(opts.from, opts.to)) {
      const metric = await dailyMetricsForDay(date)
      if (metric) metrics.push(metric)
    }
    return metrics
  },

  /** Activities for an inclusive YYYY-MM-DD window, paged until a short page. */
  async activities(opts: { from: string; to: string }): Promise<ActivityRecord[]> {
    const records: ActivityRecord[] = []
    const seenRecords = new Set<number>()
    const seenRaw = new Set<number | undefined>()
    for (let start = 0; ; start += ACTIVITY_PAGE_SIZE) {
      const page = await call('activities/search', (headers) =>
        getActivitylistServiceActivitiesSearchActivities({
          client,
          headers,
          query: { startDate: opts.from, endDate: opts.to, start, limit: ACTIVITY_PAGE_SIZE },
        }),
      )
      const rows = Array.isArray(page) ? page : []
      records.push(...mapActivities(rows, seenRecords))

      // A short page is the last one. A full page with no unseen id means the service ignored
      // `start` — stop rather than loop forever.
      const sizeBefore = seenRaw.size
      for (const row of rows) seenRaw.add(row.activityId)
      if (rows.length < ACTIVITY_PAGE_SIZE || seenRaw.size === sizeBefore) break
    }
    return records
  },
}
