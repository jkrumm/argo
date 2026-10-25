import { describe, it, expect } from 'bun:test'
import {
  hasValues,
  jwtExpiryMs,
  mapActivities,
  mapActivity,
  mapHeartRate,
  mapHrv,
  mapSleep,
  mapUserSummary,
} from './garmin-mapping.js'

// Synthetic DTOs shaped like the Personal API responses (no real health data).
const userSummary = {
  totalSteps: 8123,
  totalDistanceMeters: 6500,
  totalKilocalories: 2300,
  activeKilocalories: 410,
  floorsAscended: 0.78,
  moderateIntensityMinutes: 30,
  vigorousIntensityMinutes: 5,
  averageStressLevel: 31,
  maxStressLevel: 90,
  bodyBatteryHighestValue: 95,
  bodyBatteryLowestValue: 20,
  bodyBatteryChargedValue: 60,
  bodyBatteryDrainedValue: 75,
  avgWakingRespirationValue: 13,
  averageSpo2: 96.5,
  lowestSpo2: 88,
}

const sleep = {
  id: 1,
  calendarDate: '2026-01-02',
  sleepTimeSeconds: 27000,
  deepSleepSeconds: 5400,
  lightSleepSeconds: 14400,
  remSleepSeconds: 6000,
  awakeSleepSeconds: 1200,
  avgSleepStress: 14.5,
  avgHeartRate: 49.2,
  averageRespirationValue: 14.1,
  sleepScores: { overall: { value: 82, qualifierKey: 'GOOD' } },
}

const activity = {
  activityId: 9_876_543_210,
  activityName: 'Morning Ride',
  startTimeLocal: '2026-01-02 07:15:30',
  activityType: { typeId: 2, typeKey: 'cycling' },
  duration: 3600.5,
  distance: 25000.2,
  calories: 640,
  averageHR: 141.6,
  maxHR: 172,
  aerobicTrainingEffect: 3.4,
  anaerobicTrainingEffect: 0.6,
  trainingEffectLabel: 'AEROBIC_BASE',
  activityTrainingLoad: 120.4,
  moderateIntensityMinutes: 40,
  vigorousIntensityMinutes: 10,
  hrTimeInZone_1: 100,
  hrTimeInZone_2: 1200.5,
  hrTimeInZone_3: 1500,
  hrTimeInZone_4: 700,
  hrTimeInZone_5: 99.5,
  differenceBodyBattery: -18,
  steps: 0,
  vO2MaxValue: 52,
}

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = obj
  return rest
}

describe('mapUserSummary', () => {
  it('maps the usersummary fields onto daily_metrics columns', () => {
    expect(mapUserSummary(userSummary)).toEqual({
      steps: 8123,
      distance_m: 6500,
      total_kcal: 2300,
      active_kcal: 410,
      floors_ascended: 0.78,
      moderate_intensity_min: 30,
      vigorous_intensity_min: 5,
      avg_stress: 31,
      max_stress: 90,
      bb_highest: 95,
      bb_lowest: 20,
      bb_charged: 60,
      bb_drained: 75,
      avg_waking_respiration: 13,
      avg_spo2: 96.5,
      lowest_spo2: 88,
    })
  })

  it('yields null for absent fields and rounds integer columns', () => {
    const mapped = mapUserSummary({ totalSteps: 100.4 })
    expect(mapped.steps).toBe(100)
    expect(mapped.avg_spo2).toBeNull()
  })
})

describe('mapHeartRate', () => {
  it('maps resting/max/min from the dailyHeartRate endpoint', () => {
    expect(mapHeartRate({ restingHeartRate: 46, maxHeartRate: 131, minHeartRate: 44 })).toEqual({
      resting_hr: 46,
      max_hr: 131,
      min_hr: 44,
    })
  })
})

describe('mapHrv', () => {
  it('reads the hrvSummary block', () => {
    const mapped = mapHrv({
      hrvSummary: {
        weeklyAvg: 106,
        lastNightAvg: 104,
        lastNight5MinHigh: 143,
        status: 'BALANCED',
        createTimeStamp: '2026-01-02T08:00:00.0',
      },
      startTimestampGMT: '',
      endTimestampGMT: '',
      startTimestampLocal: '',
      endTimestampLocal: '',
    })
    expect(mapped).toEqual({
      hrv_last_night_avg: 104,
      hrv_last_night_5min_high: 143,
      hrv_weekly_avg: 106,
      hrv_status: 'BALANCED',
    })
  })

  it('is all-null without a summary (no-HRV night)', () => {
    const mapped = mapHrv({
      startTimestampGMT: '',
      endTimestampGMT: '',
      startTimestampLocal: '',
      endTimestampLocal: '',
    })
    expect(hasValues(mapped)).toBe(false)
  })
})

describe('mapSleep', () => {
  const expected = {
    sleep_score: 82,
    sleep_duration_sec: 27000,
    deep_sleep_sec: 5400,
    light_sleep_sec: 14400,
    rem_sleep_sec: 6000,
    awake_sleep_sec: 1200,
    avg_sleep_stress: 14.5,
    avg_sleep_hr: 49.2,
    avg_sleep_respiration: 14.1,
  }

  it('reads the sleep DTO at top level', () => {
    expect(mapSleep(sleep)).toEqual(expected)
  })

  it('also reads a dailySleepDTO wrapper', () => {
    expect(mapSleep({ dailySleepDTO: sleep })).toEqual(expected)
  })

  it('has no sleep score when sleepScores is missing', () => {
    expect(mapSleep({ sleepTimeSeconds: 100 }).sleep_score).toBeNull()
  })
})

describe('mapActivity', () => {
  it('maps an activity-list row exactly', () => {
    expect(mapActivity(activity)).toEqual({
      activity_id: 9_876_543_210,
      date: '2026-01-02',
      start_time_local: '2026-01-02 07:15:30',
      type_key: 'cycling',
      activity_name: 'Morning Ride',
      duration_sec: 3600.5,
      distance_m: 25000.2,
      calories: 640,
      avg_hr: 141.6,
      max_hr: 172,
      aerobic_te: 3.4,
      anaerobic_te: 0.6,
      training_effect_label: 'AEROBIC_BASE',
      training_load: 120.4,
      moderate_intensity_min: 40,
      vigorous_intensity_min: 10,
      hr_zone_1_sec: 100,
      hr_zone_2_sec: 1200.5,
      hr_zone_3_sec: 1500,
      hr_zone_4_sec: 700,
      hr_zone_5_sec: 99.5,
      bb_delta: -18,
      steps: 0,
      vo2_max: 52,
    })
  })

  it('skips walking and rows without a start time or id', () => {
    expect(mapActivity({ ...activity, activityType: { typeId: 9, typeKey: 'walking' } })).toBeNull()
    expect(mapActivity(omit(activity, 'startTimeLocal'))).toBeNull()
    expect(mapActivity(omit(activity, 'activityId'))).toBeNull()
  })
})

describe('mapActivities', () => {
  it('dedupes by activity_id across pages', () => {
    const seen = new Set<number>()
    const first = mapActivities([activity, { ...activity, activityId: 2 }], seen)
    const second = mapActivities(
      [
        { ...activity, activityId: 2 },
        { ...activity, activityId: 3 },
      ],
      seen,
    )
    expect(first.map((a) => a.activity_id)).toEqual([9_876_543_210, 2])
    expect(second.map((a) => a.activity_id)).toEqual([3])
  })
})

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

describe('jwtExpiryMs', () => {
  it('decodes exp to epoch milliseconds', () => {
    expect(jwtExpiryMs(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000)
  })

  it('returns null for undecodable tokens', () => {
    expect(jwtExpiryMs('not-a-jwt')).toBeNull()
    expect(jwtExpiryMs('h.!!!.s')).toBeNull()
    expect(jwtExpiryMs(jwt({ sub: 'x' }))).toBeNull()
  })
})
