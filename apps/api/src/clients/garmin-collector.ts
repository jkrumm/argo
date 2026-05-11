// Bearer-authed HTTP client for the homelab garmin-collector at https://garmin.jkrumm.com.
// Stateless query layer over Garmin Connect — owns the OAuth tokens, returns shaped JSON.

const COLLECTOR_URL = process.env['GARMIN_COLLECTOR_URL'] ?? ''
const COLLECTOR_TOKEN = process.env['GARMIN_COLLECTOR_TOKEN'] ?? ''

// Mirrors the columns we upsert into sqlite. All optional — collector returns
// nulls/missing keys when Garmin's API is flaky for that day.
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

async function fetchJson<T>(path: string): Promise<T> {
  if (!COLLECTOR_URL) throw new Error('GARMIN_COLLECTOR_URL not configured')
  if (!COLLECTOR_TOKEN) throw new Error('GARMIN_COLLECTOR_TOKEN not configured')

  const res = await fetch(`${COLLECTOR_URL}${path}`, {
    headers: { Authorization: `Bearer ${COLLECTOR_TOKEN}` },
    signal: AbortSignal.timeout(120_000), // generous — Garmin can be slow
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`garmin-collector ${path} → ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export const garminCollector = {
  /** Fetch daily metrics for an inclusive YYYY-MM-DD window. */
  dailyMetrics(opts: { from: string; to: string }) {
    return fetchJson<DailyMetric[]>(
      `/daily-metrics?from=${encodeURIComponent(opts.from)}&to=${encodeURIComponent(opts.to)}`,
    )
  },

  /** Fetch activities for an inclusive YYYY-MM-DD window. */
  activities(opts: { from: string; to: string }) {
    return fetchJson<ActivityRecord[]>(
      `/activities?from=${encodeURIComponent(opts.from)}&to=${encodeURIComponent(opts.to)}`,
    )
  },

  status() {
    return fetchJson<{ login_at: string | null; logged_in: boolean; token_dir: string }>('/status')
  },
}
