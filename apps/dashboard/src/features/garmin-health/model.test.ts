import { describe, expect, test } from 'bun:test'
import { ACWR_ZONE_NAME, acwrMeterZones, acwrZoneLabel } from './formulas'
import { recoveryMeterProps } from './recovery-meter'
import {
  activitiesFact,
  activityScoreFact,
  ACWR_LEGEND,
  acwrFact,
  acwrRelation,
  bodyBatteryFact,
  contributorItems,
  countWhere,
  dayLabel,
  divergenceFact,
  firstToLast,
  FITNESS_DAYS,
  fitnessRange,
  fmtMinutes,
  fmtNum,
  hoursFromSec,
  lastDaysRange,
  lastScored,
  loadGap,
  chartEmpty,
  mean,
  missingInputs,
  recoveryFact,
  recoveryGap,
  recoveryVerdict,
  recoverySentence,
  shortDate,
  signed,
  sleepFact,
  stressFact,
  summaryParts,
  vo2Hero,
  windowDayCount,
} from './model'

describe('number formatting', () => {
  test('a null reading is an em dash, never 0', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(undefined, 1)).toBe('—')
    expect(fmtNum(Number.NaN)).toBe('—')
    expect(fmtNum(0)).toBe('0')
    expect(signed(null)).toBe('—')
  })

  test('signed uses a real minus and drops the sign on zero', () => {
    expect(signed(3)).toBe('+3')
    expect(signed(-2.4, 1)).toBe('−2.4')
    expect(signed(0)).toBe('0')
    expect(signed(-0.04, 1)).toBe('0.0')
  })

  test('minutes read as h and m', () => {
    expect(fmtMinutes(45)).toBe('45m')
    expect(fmtMinutes(120)).toBe('2h')
    expect(fmtMinutes(80)).toBe('1h 20m')
  })
})

describe('aggregates', () => {
  test('mean skips nulls and is null when nothing measured', () => {
    expect(mean([2, null, 4])).toBe(3)
    expect(mean([null, null])).toBeNull()
    expect(mean([])).toBeNull()
  })

  test('countWhere counts only measured days', () => {
    expect(countWhere([80, null, 50, 71], (v) => v >= 70)).toEqual({ hits: 2, days: 3 })
  })

  test('firstToLast is last minus first present value', () => {
    expect(firstToLast([null, 50, 52, null, 49])).toBe(-1)
    expect(firstToLast([null, null])).toBeNull()
  })
})

describe('summaryParts', () => {
  test('the sentence carries recovery and the load verdict, nothing else', () => {
    expect(summaryParts({ recovery: 62.4, acwr: 0.62 })).toEqual({
      sentence: 'Recovery 62/100, load under the 0.8 floor',
    })
  })

  test('a present recovery with no ACWR keeps the sentence short', () => {
    expect(summaryParts({ recovery: 80, acwr: null })).toEqual({ sentence: 'Recovery 80/100' })
  })

  test('a missing recovery leads with the load and states its reason', () => {
    expect(summaryParts({ recovery: null, recoveryDate: '2026-01-05', acwr: 0.62 }).sentence).toBe(
      'Load under the 0.8 floor; no recovery score for Jan 5',
    )
  })

  test('a missing recovery and ACWR is the reason alone', () => {
    expect(summaryParts({ recovery: null, acwr: null })).toEqual({
      sentence: 'No recovery score for the latest day',
    })
  })

  test('acwrRelation follows the API cut-offs', () => {
    expect(acwrRelation(0.79)).toContain('under')
    expect(acwrRelation(0.8)).toContain('optimal')
    expect(acwrRelation(1.3)).toContain('optimal')
    expect(acwrRelation(1.31)).toContain('ceiling')
    expect(acwrRelation(1.51)).toContain('danger')
  })
})

describe('recoveryGap', () => {
  const today = new Date(2026, 0, 6)
  const last = { value: 61.6, date: '2026-01-01' }
  const settled = { status: 'success', settled: true, last, windowDays: 30, today } as const

  test('the headline names the day a missing score is missing for', () => {
    expect(recoveryGap({ date: '2026-01-06', today }).headline).toBe('no recovery score for today')
    expect(recoveryGap({ date: '2026-01-01', today }).headline).toBe('no recovery score for Jan 1')
    expect(recoveryGap({ date: null, today }).headline).toBe('no recovery score for the latest day')
  })

  test('pending has no copy, error never claims a data gap', () => {
    expect(recoveryGap({ status: 'pending' })).toEqual({ headline: 'recovery loading', line: null })
    expect(recoveryGap({ status: 'error' })).toEqual({
      headline: 'the recovery score failed to load',
      line: 'The recovery score failed to load',
    })
  })

  test('the cell line names the unscored day and what it could not score from', () => {
    expect(recoveryGap({ ...settled, date: '2026-01-06', missing: ['HRV', 'sleep'] }).line).toBe(
      'Last scored 62/100 on Jan\u00a01\u00a0· today: HRV, sleep not scored — Garmin syncs every 6\u00a0h',
    )
    expect(recoveryGap({ ...settled, date: '2026-01-02', last: null, missing: ['RHR'] }).line).toBe(
      'No score in this 30\u00a0d window\u00a0· Jan\u00a02: RHR not scored — Garmin syncs every 6\u00a0h',
    )
  })

  test('with no date or nothing missing the line names no subject', () => {
    expect(recoveryGap({ ...settled, missing: ['HRV'] }).line).toBe(
      'Last scored 62/100 on Jan\u00a01 — Garmin syncs every 6\u00a0h',
    )
    expect(recoveryGap({ ...settled, date: '2026-01-06', missing: [] }).line).toBe(
      'Last scored 62/100 on Jan\u00a01 — Garmin syncs every 6\u00a0h',
    )
    expect(missingInputs({ hrv: null, sleep: 30, rhr: null })).toEqual(['HRV', 'RHR'])
    expect(missingInputs({ hrv: 1, sleep: 2, rhr: 3 })).toEqual([])
  })

  test('the cell line waits for the reads to settle', () => {
    expect(recoveryGap({ ...settled, settled: false }).line).toBeNull()
  })
  test('the last scored day carries its value and day, unit unspaced', () => {
    expect(recoveryGap(settled).line).toBe(
      'Last scored 62/100 on Jan\u00a01 — Garmin syncs every 6\u00a0h',
    )
  })
  test('no scored day states the window, or none when its length is unknown', () => {
    expect(recoveryGap({ ...settled, last: null }).line).toBe(
      'No score in this 30\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(recoveryGap({ ...settled, last: null, windowDays: 0 }).line).toBe(
      'No score in this window — Garmin syncs every 6\u00a0h',
    )
  })
})

describe('recovery load states', () => {
  test('a failed recovery query keeps the load and says so in the headline', () => {
    const { sentence } = summaryParts({
      recovery: null,
      recoveryStatus: 'error',
      acwr: 1,
    })
    expect(sentence).toBe('Load inside the 0.8–1.3 optimal band; the recovery score failed to load')
    expect(sentence).not.toContain('HRV, sleep')
  })
})

describe('recoverySentence', () => {
  test('a pending recovery with no ACWR is never an empty headline', () => {
    expect(recoverySentence({ recovery: null, recoveryStatus: 'pending', load: null })).toBe(
      'Recovery loading',
    )
  })
  test('a score leads, its absence yields to the load', () => {
    expect(recoverySentence({ recovery: 70, load: 'load x' })).toBe('Recovery 70/100, load x')
    expect(recoverySentence({ recovery: null, recoveryStatus: 'error', load: 'load x' })).toBe(
      'Load x; the recovery score failed to load',
    )
  })
})

describe('contributorItems', () => {
  test('rows are points of their weight and an unmeasured component is left out', () => {
    expect(contributorItems({ hrv: 31.2, sleep: null, rhr: 20 })).toEqual([
      { label: 'HRV', value: 31.2, max: 40, key: 'HRV' },
      { label: 'RHR', value: 20, max: 25, key: 'RHR' },
    ])
  })
})

describe('facts headers', () => {
  test('every header has a value, a unit and a comparison', () => {
    const facts = [
      activitiesFact({ sessions: 12, totalMin: 600, dayCount: 30 }),
      acwrFact({ acwr: 1.1, zoneLabel: 'Optimal', inZone: 20, dayCount: 30 }),
      divergenceFact({ divergence: -4.26, when: 'today' }),
      recoveryFact({ mean: 61.5, high: 9, dayCount: 30 }),
      sleepFact({ when: 'last night', hours: 7.25, score: 81, meanHours: 7.1, dayCount: 30 }),
      bodyBatteryFact({ when: 'today', net: -3, mean: 5, high: 90, low: 12, dayCount: 30 }),
      stressFact({ stress: 28, rest: 4, dayCount: 30 }),
      activityScoreFact({ when: 'today', score: 300, mean: 450, dayCount: 30 }),
    ]
    for (const f of facts) {
      expect(f.value).not.toBe('')
      expect(f.unit).toBeTruthy()
      expect(f.context.length).toBeGreaterThan(0)
    }
  })

  test('activity score states the share of the 600 target', () => {
    expect(
      activityScoreFact({ when: 'today', score: 300, mean: 450, dayCount: 30 }).context[0],
    ).toBe('50 % of the 600 target')
  })

  test('null readings become em dashes in the header', () => {
    const f = activityScoreFact({ when: '—', score: null, mean: null, dayCount: 0 })
    expect(f.value).toBe('—')
    expect(f.context.join(' ')).toContain('—')
    expect(
      sleepFact({ when: '—', hours: null, score: null, meanHours: null, dayCount: 0 }).value,
    ).toBe('—')
  })

  test('acwr names the zone and the days in it', () => {
    expect(acwrFact({ acwr: 1.1, zoneLabel: 'Optimal', inZone: 20, dayCount: 30 })).toEqual({
      value: '1.10',
      unit: 'ACWR',
      context: ['optimal', '20 of 30 d in the optimal zone'],
    })
  })

  test('singular session', () => {
    expect(activitiesFact({ sessions: 1, totalMin: 30, dayCount: 7 }).unit).toBe('session')
  })
})

describe('rounding and non-finite readings', () => {
  test('fmtMinutes rounds once before splitting, never "1h 60m" or "60m"', () => {
    expect(fmtMinutes(59.6)).toBe('1h')
    expect(fmtMinutes(119.5)).toBe('2h')
    expect(fmtMinutes(59.4)).toBe('59m')
    expect(fmtMinutes(0)).toBe('0m')
  })

  test('countWhere and firstToLast skip NaN and Infinity like mean does', () => {
    expect(countWhere([Number.NaN, 80, Number.POSITIVE_INFINITY, 50], (v) => v >= 70)).toEqual({
      hits: 1,
      days: 2,
    })
    expect(firstToLast([Number.NaN, 50, 54, Number.NaN])).toBe(4)
    expect(firstToLast([Number.NaN, Number.NaN])).toBeNull()
  })
})

describe('windows', () => {
  const today = new Date(2026, 9, 17)

  test('lastDaysRange is the last N calendar days ending today, independent of the selector', () => {
    expect(lastDaysRange(14, today)).toEqual({ from: '2026-10-04', to: '2026-10-17' })
    expect(lastDaysRange(1, today)).toEqual({ from: '2026-10-17', to: '2026-10-17' })
    expect(lastDaysRange(180, new Date(2026, 2, 1)).from).toBe('2025-09-03')
  })

  test('windowDayCount counts calendar days in the window, inclusive', () => {
    expect(windowDayCount({ dateFrom: '2026-10-11', dateTo: undefined }, '2026-04-15', today)).toBe(
      7,
    )
    expect(
      windowDayCount({ dateFrom: '2026-10-01', dateTo: '2026-10-10' }, '2026-04-15', today),
    ).toBe(10)
  })

  test('windowDayCount clips at the visible floor and runs an open start from it', () => {
    expect(
      windowDayCount({ dateFrom: '2026-01-01', dateTo: '2026-04-20' }, '2026-04-15', today),
    ).toBe(6)
    expect(windowDayCount({}, '2026-10-10', today)).toBe(8)
  })

  test('windowDayCount is 0, not negative, for an empty window', () => {
    expect(
      windowDayCount({ dateFrom: '2026-11-01', dateTo: '2026-10-10' }, '2026-04-15', today),
    ).toBe(0)
  })
})

describe('null today', () => {
  test('a null final-day score renders a dash and no percentage', () => {
    const f = activityScoreFact({ when: 'Oct 14', score: null, mean: 410, dayCount: 20 })
    expect(f.value).toBe('—')
    expect(f.context[0]).toBe('— % of the 600 target')
  })

  test('body battery uses one minus glyph and dashes for a missing day', () => {
    const f = bodyBatteryFact({
      when: 'Oct 14',
      net: -12,
      mean: -3,
      high: null,
      low: null,
      dayCount: 9,
    })
    expect(f.value).toBe('−12')
    expect(f.context.join(' ')).toContain('−3 pts mean over 9 d')
    expect(f.context.join(' ')).toContain('high —/100, low —/100')
    expect(f.value.includes('-')).toBe(false)
  })

  test('activities states no rate and no "last 0 d" without a window length', () => {
    expect(activitiesFact({ sessions: 4, totalMin: 120, dayCount: 0 }).context).toEqual(['2h'])
    expect(activitiesFact({ sessions: 4, totalMin: 120, dayCount: 14 }).context).toEqual([
      '2h',
      '2.0 sessions per week',
      'last 14 d',
    ])
  })
})

describe('headers name the point they show', () => {
  const today = new Date(2026, 9, 17)

  test("dayLabel is derived from the point's own date", () => {
    expect(dayLabel('2026-10-17', 'day', today)).toBe('today')
    expect(dayLabel('2026-10-17', 'night', today)).toBe('last night')
    expect(dayLabel('2026-10-16', 'day', today)).toBe('Oct 16')
    expect(dayLabel('2026-10-16', 'night', today)).toBe('Oct 16')
    expect(dayLabel('2026-03-02', 'day', today)).toBe('Mar 2')
    expect(dayLabel(null, 'day', today)).toBe('—')
    expect(dayLabel(undefined, 'night', today)).toBe('—')
  })

  test('shortDate falls back to the raw key for a malformed month', () => {
    expect(shortDate('2026-13-01')).toBe('2026-13-01')
  })

  test('a header for a historical point never says today or last night', () => {
    const when = dayLabel('2026-10-14', 'night', today)
    expect(sleepFact({ when, hours: 7, score: 80, meanHours: 7, dayCount: 9 }).unit).toBe(
      'h Oct 14',
    )
    const day = dayLabel('2026-10-14', 'day', today)
    expect(activityScoreFact({ when: day, score: 100, mean: 200, dayCount: 9 }).unit).toBe(
      'MET-min Oct 14',
    )
    expect(
      bodyBatteryFact({ when: day, net: 4, mean: 1, high: 90, low: 20, dayCount: 9 }).unit,
    ).toBe('pts net Oct 14')
    expect(divergenceFact({ divergence: 1, when: day }).context).toContain('Oct 14')
  })
})

describe('shared fitness window and hero', () => {
  test('fitnessRange is the fixed 14 day window the loader and the components both read', () => {
    const today = new Date(2026, 9, 17)
    expect(fitnessRange(today)).toEqual(lastDaysRange(FITNESS_DAYS, today))
    expect(fitnessRange(today)).toEqual({ from: '2026-10-04', to: '2026-10-17' })
  })

  test("the VO2max hero takes the trace's last value, else the regression figure, else null", () => {
    expect(vo2Hero([52, 53.2], 50)).toBe(53.2)
    expect(vo2Hero([], 50)).toBe(50)
    expect(vo2Hero([], null)).toBeNull()
    expect(vo2Hero([], undefined)).toBeNull()
  })

  test('non-finite input is a dash or null, never NaN text', () => {
    expect(fmtMinutes(Number.NaN)).toBe('—')
    expect(fmtMinutes(Number.POSITIVE_INFINITY)).toBe('—')
    expect(hoursFromSec(Number.NaN)).toBeNull()
    expect(hoursFromSec(7200)).toBe(2)
    expect(hoursFromSec(null)).toBeNull()
  })
})

describe('lastScored', () => {
  test('is the newest scored day, skipping unscored ones', () => {
    expect(
      lastScored([
        { date: '2026-01-01', recovery: 50 },
        { date: '2026-01-02', recovery: 64 },
        { date: '2026-01-03', recovery: null },
      ]),
    ).toEqual({ value: 64, date: '2026-01-02' })
  })
  test('an unscored window is null', () => {
    expect(lastScored([{ date: '2026-01-01', recovery: null }])).toBeNull()
    expect(lastScored([])).toBeNull()
  })
})

describe('lastScored edge cases', () => {
  test('skips a non-finite score and reads the newest finite one', () => {
    expect(
      lastScored([
        { date: '2026-01-01', recovery: 50 },
        { date: '2026-01-02', recovery: Number.NaN },
      ]),
    ).toEqual({ value: 50, date: '2026-01-01' })
  })
  test('empty, all-null and all-NaN windows have no last score', () => {
    expect(lastScored([])).toBeNull()
    expect(lastScored([{ date: '2026-01-01', recovery: null }])).toBeNull()
    expect(lastScored([{ date: '2026-01-01', recovery: Number.NaN }])).toBeNull()
  })
})

describe('loadGap', () => {
  const settled = { status: 'success', placeholder: false, windowDays: 30 } as const
  test('a ratio needs no copy: the meter names the bands', () => {
    expect(loadGap({ acwr: 1, ...settled })).toBeUndefined()
  })
  test('only a settled read without a ratio states the gap, with the chart cards’ wording', () => {
    expect(loadGap({ acwr: null, ...settled })).toBe(
      'No training load in this 30\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(loadGap({ acwr: null, ...settled, placeholder: true })).toBeUndefined()
  })
  test('loading has no copy and a failure says so', () => {
    expect(loadGap({ acwr: null, ...settled, status: 'pending' })).toBeUndefined()
    expect(loadGap({ acwr: null, ...settled, status: 'error' })).toBe(
      'The training load failed to load',
    )
  })
})

describe('chartEmpty', () => {
  test('names the metric, the window and the sync cadence', () => {
    expect(chartEmpty('sleep', 14)).toBe(
      'No sleep in this 14\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(chartEmpty('sleep', 0)).toBe('No sleep in this window — Garmin syncs every 6\u00a0h')
  })
})

describe('ACWR_LEGEND', () => {
  test('names all four zones with the meter vocabulary and their bounds', () => {
    expect(ACWR_LEGEND).toEqual({
      undertrained: 'Low (< 0.8)',
      optimal: 'Optimal (0.8–1.3)',
      caution: 'Caution (1.3–1.5)',
      danger: 'Danger (> 1.5)',
    })
  })
})

describe('ACWR_ZONE_NAME', () => {
  test('every surface label derives from the one vocabulary', () => {
    const zones = ['undertrained', 'optimal', 'caution', 'danger'] as const
    for (const zone of zones) {
      expect(acwrZoneLabel(zone)).toBe(ACWR_ZONE_NAME[zone])
      expect(ACWR_LEGEND[zone].startsWith(ACWR_ZONE_NAME[zone])).toBe(true)
    }
    expect(ACWR_ZONE_NAME.undertrained).toBe('Low')
    expect(acwrZoneLabel(null)).toBe('')
  })
})

describe('ACWR zone vocabulary', () => {
  test('one builder: full names as labels, `short` only where the name is abbreviated', () => {
    const zones = acwrMeterZones({ floor: 0.8, optimalTo: 1.3, cautionTo: 1.5, max: 2 })
    expect(zones.map((z) => z.label)).toEqual(['Low', 'Optimal', 'Caution', 'Danger'])
    expect(zones.map((z) => z.short)).toEqual([undefined, undefined, 'Caut.', undefined])
    expect(zones.map((z) => [z.from, z.to])).toEqual([
      [0, 0.8],
      [0.8, 1.3],
      [1.3, 1.5],
      [1.5, 2],
    ])
  })
})

describe('recovery verdict', () => {
  test('classifies the displayed (rounded) score', () => {
    const cases: [number, string][] = [
      [0, 'rest'],
      [39.4, 'rest'],
      [39.5, 'normal'],
      [39.9, 'normal'],
      [40, 'normal'],
      [69.4, 'normal'],
      [69.9, 'push'],
      [70, 'push'],
      [100, 'push'],
    ]
    for (const [score, verdict] of cases) {
      expect(recoveryVerdict(score)).toBe(verdict as ReturnType<typeof recoveryVerdict>)
      expect(recoveryVerdict(score)).toBe(recoveryVerdict(Number(fmtNum(score))))
    }
  })

  test('the meter names the verdict and the cut-offs', () => {
    expect(recoveryMeterProps(72).label).toBe('Recovery score, Push zone')
    expect(recoveryMeterProps(null).label).toBe('Recovery score')
    expect(recoveryMeterProps(50).startCaption).toBe('rest < 40 · push ≥ 70')
    expect(recoveryMeterProps(50).zones.map((z) => z.label)).toEqual(['Rest', 'Normal', 'Push'])
  })
})
