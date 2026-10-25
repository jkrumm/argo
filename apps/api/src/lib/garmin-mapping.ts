// Pure raw-DTO → DB-row mappers for the Garmin Connect Personal API. No I/O: the client
// (clients/garmin.ts) fetches, this file shapes. Integer columns are rounded defensively —
// Postgres rejects a fractional value for an `integer` column and would fail the whole row.

import type {
  DailyHeartRateDto,
  DailySleepDto,
  HrvChartDto,
  SummarizedActivityDto,
  UserDailySummaryDto,
} from '../generated/garmin/types.gen.js'
import type { ActivityRecord, DailyMetric } from '../clients/garmin.js'

/** Activity types the sync skips (the old collector's ACTIVITY_SKIP_TYPES default). */
const ACTIVITY_SKIP_TYPES: ReadonlySet<string> = new Set(['walking'])

function real(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function int(value: unknown): number | null {
  const n = real(value)
  return n === null ? null : Math.round(n)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function mapUserSummary(raw: UserDailySummaryDto): Omit<DailyMetric, 'date'> {
  return {
    steps: int(raw.totalSteps),
    distance_m: int(raw.totalDistanceMeters),
    total_kcal: real(raw.totalKilocalories),
    active_kcal: real(raw.activeKilocalories),
    floors_ascended: real(raw.floorsAscended),
    moderate_intensity_min: int(raw.moderateIntensityMinutes),
    vigorous_intensity_min: int(raw.vigorousIntensityMinutes),
    avg_stress: int(raw.averageStressLevel),
    max_stress: int(raw.maxStressLevel),
    bb_highest: int(raw.bodyBatteryHighestValue),
    bb_lowest: int(raw.bodyBatteryLowestValue),
    bb_charged: int(raw.bodyBatteryChargedValue),
    bb_drained: int(raw.bodyBatteryDrainedValue),
    avg_waking_respiration: real(raw.avgWakingRespirationValue),
    avg_spo2: real(raw.averageSpo2),
    lowest_spo2: real(raw.lowestSpo2),
  }
}

export function mapHeartRate(raw: DailyHeartRateDto): Omit<DailyMetric, 'date'> {
  return {
    resting_hr: int(raw.restingHeartRate),
    max_hr: int(raw.maxHeartRate),
    min_hr: int(raw.minHeartRate),
  }
}

export function mapHrv(raw: HrvChartDto): Omit<DailyMetric, 'date'> {
  const summary = raw.hrvSummary
  return {
    hrv_last_night_avg: int(summary?.lastNightAvg),
    hrv_last_night_5min_high: int(summary?.lastNight5MinHigh),
    hrv_weekly_avg: int(summary?.weeklyAvg),
    hrv_status: text(summary?.status),
  }
}

/** The live service answers with the sleep DTO at top level; older docs wrap it in `dailySleepDTO`. */
export function mapSleep(
  raw: DailySleepDto | { dailySleepDTO?: DailySleepDto },
): Omit<DailyMetric, 'date'> {
  const dto =
    'dailySleepDTO' in raw && raw.dailySleepDTO ? raw.dailySleepDTO : (raw as DailySleepDto)
  return {
    sleep_score: int(dto.sleepScores?.['overall']?.value),
    sleep_duration_sec: int(dto.sleepTimeSeconds),
    deep_sleep_sec: int(dto.deepSleepSeconds),
    light_sleep_sec: int(dto.lightSleepSeconds),
    rem_sleep_sec: int(dto.remSleepSeconds),
    awake_sleep_sec: int(dto.awakeSleepSeconds),
    avg_sleep_stress: real(dto.avgSleepStress),
    avg_sleep_hr: real(dto.avgHeartRate),
    avg_sleep_respiration: real(dto.averageRespirationValue),
  }
}

/** True when a partial metric carries at least one real value (nothing to upsert otherwise). */
export function hasValues(metric: Omit<DailyMetric, 'date'>): boolean {
  return Object.values(metric).some((v) => v !== null && v !== undefined)
}

/** One activity-list row → ActivityRecord; null for skipped types and rows without identity/time. */
export function mapActivity(raw: SummarizedActivityDto): ActivityRecord | null {
  const activityId = real(raw.activityId)
  const startTimeLocal = text(raw.startTimeLocal)
  if (activityId === null || startTimeLocal === null) return null

  const typeKey = text(raw.activityType?.typeKey)
  if (typeKey !== null && ACTIVITY_SKIP_TYPES.has(typeKey)) return null

  return {
    activity_id: activityId,
    date: startTimeLocal.slice(0, 10),
    start_time_local: startTimeLocal,
    type_key: typeKey ?? 'unknown',
    activity_name: text(raw.activityName),
    duration_sec: real(raw.duration),
    distance_m: real(raw.distance),
    calories: int(raw.calories),
    avg_hr: real(raw.averageHR),
    max_hr: int(raw.maxHR),
    aerobic_te: real(raw.aerobicTrainingEffect),
    anaerobic_te: real(raw.anaerobicTrainingEffect),
    training_effect_label: text(raw.trainingEffectLabel),
    training_load: real(raw.activityTrainingLoad),
    moderate_intensity_min: int(raw.moderateIntensityMinutes),
    vigorous_intensity_min: int(raw.vigorousIntensityMinutes),
    hr_zone_1_sec: real(raw.hrTimeInZone_1),
    hr_zone_2_sec: real(raw.hrTimeInZone_2),
    hr_zone_3_sec: real(raw.hrTimeInZone_3),
    hr_zone_4_sec: real(raw.hrTimeInZone_4),
    hr_zone_5_sec: real(raw.hrTimeInZone_5),
    bb_delta: int(raw.differenceBodyBattery),
    steps: int(raw.steps),
    vo2_max: real(raw.vO2MaxValue),
  }
}

/** Maps a page of activity rows, dropping skipped/invalid ones and ids already in `seen`. */
export function mapActivities(
  rows: readonly SummarizedActivityDto[],
  seen: Set<number> = new Set(),
): ActivityRecord[] {
  const out: ActivityRecord[] = []
  for (const row of rows) {
    const record = mapActivity(row)
    if (record === null || seen.has(record.activity_id)) continue
    seen.add(record.activity_id)
    out.push(record)
  }
  return out
}

/** Decodes the `exp` claim (ms epoch) of a JWT; null when the token is not a decodable JWT. */
export function jwtExpiryMs(jwt: string): number | null {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown
    }
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : null
  } catch {
    return null
  }
}
