import { describe, expect, test } from 'bun:test'
import {
  acwrFact,
  acwrRelation,
  activitiesFact,
  activityScoreFact,
  bodyBatteryFact,
  contributorItems,
  countWhere,
  divergenceFact,
  firstToLast,
  fmtMinutes,
  fmtNum,
  dayLabel,
  FITNESS_DAYS,
  fitnessRange,
  hoursFromSec,
  shortDate,
  vo2Hero,
  lastDaysRange,
  windowDayCount,
  mean,
  recoveryFact,
  signed,
  sleepFact,
  stressFact,
  recoveryGap,
  summaryParts,
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
  test('the sentence carries recovery and the load verdict, the facts the figures with units', () => {
    expect(summaryParts({ recovery: 62.4, acwr: 0.62, rhrDelta: -2, hrvDelta: 3 })).toEqual({
      sentence: 'Recovery 62/100, load under the 0.8 floor',
      facts: ['ACWR 0.62', 'RHR −2 bpm over 14 d', 'HRV +3 ms over 14 d'],
    })
  })

  test('a non-finite ACWR renders as a dash', () => {
    expect(
      summaryParts({ recovery: 80, acwr: Number.NaN, rhrDelta: 0, hrvDelta: 0 }).facts[0],
    ).toBe('ACWR —')
  })

  test('a present recovery with no ACWR keeps the sentence short and the fact a dash', () => {
    expect(summaryParts({ recovery: 80, acwr: null, rhrDelta: 1, hrvDelta: -4 })).toEqual({
      sentence: 'Recovery 80/100',
      facts: ['ACWR —', 'RHR +1 bpm over 14 d', 'HRV −4 ms over 14 d'],
    })
  })

  test('a missing recovery leads with the load and states its reason', () => {
    expect(
      summaryParts({
        recovery: null,
        recoveryDate: '2026-01-05',
        acwr: 0.62,
        rhrDelta: 0,
        hrvDelta: 0,
      }).sentence,
    ).toBe(
      'Load under the 0.8 floor; no recovery score, since there is not enough HRV, sleep or resting HR data for Jan 5',
    )
  })

  test('a missing recovery and ACWR is the reason alone, facts stay dashes', () => {
    expect(summaryParts({ recovery: null, acwr: null, rhrDelta: null, hrvDelta: null })).toEqual({
      sentence:
        'No recovery score, since there is not enough HRV, sleep or resting HR data for the latest day',
      facts: ['ACWR —', 'RHR — bpm over 14 d', 'HRV — ms over 14 d'],
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
  test('names the day, the missing readings and when it fills', () => {
    const gap = recoveryGap('2026-01-05')
    expect(gap.reason).toBe('Not enough HRV, sleep or resting HR data for Jan 5.')
    expect(gap.fills).toContain('every 6 h')
  })
})

describe('recovery load states', () => {
  test('pending has no copy, error never claims a data gap, success-null does', () => {
    expect(recoveryGap('2026-01-05', 'pending').headline).toBe('')
    expect(recoveryGap('2026-01-05', 'error').reason).toBe('The recovery score failed to load.')
    expect(recoveryGap('2026-01-05', 'success').reason).toContain('Not enough')
  })
  test('a failed recovery query keeps the load and says so in the headline', () => {
    const { sentence } = summaryParts({
      recovery: null,
      recoveryStatus: 'error',
      acwr: 1,
      rhrDelta: 0,
      hrvDelta: 0,
    })
    expect(sentence).toBe('Load inside the 0.8–1.3 optimal band; the recovery score failed to load')
    expect(sentence).not.toContain('HRV, sleep')
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

  test('the summary names the fitness window by the constant', () => {
    expect(
      summaryParts({ recovery: 1, acwr: 1, rhrDelta: 0, hrvDelta: 0 }).facts.join(' · '),
    ).toContain(`over ${FITNESS_DAYS} d`)
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
