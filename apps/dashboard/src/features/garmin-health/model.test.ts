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
  lastDaysRange,
  windowDayCount,
  mean,
  recoveryFact,
  signed,
  sleepFact,
  stressFact,
  summarySentence,
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

describe('summarySentence', () => {
  test('carries three live numbers with units', () => {
    expect(summarySentence({ recovery: 62.4, acwr: 0.62, rhrDelta: -2, hrvDelta: 3 })).toBe(
      'Recovery 62/100 · load 0.62 ACWR, under the 0.8 floor · RHR −2 bpm and HRV +3 ms over 14 d',
    )
  })

  test('a missing reading is an em dash in place', () => {
    expect(summarySentence({ recovery: null, acwr: null, rhrDelta: null, hrvDelta: null })).toBe(
      'Recovery —/100 · load — · RHR — bpm and HRV — ms over 14 d',
    )
  })

  test('acwrRelation follows the API cut-offs', () => {
    expect(acwrRelation(0.79)).toContain('under')
    expect(acwrRelation(0.8)).toContain('optimal')
    expect(acwrRelation(1.3)).toContain('optimal')
    expect(acwrRelation(1.31)).toContain('ceiling')
    expect(acwrRelation(1.51)).toContain('danger')
  })
})

describe('contributorItems', () => {
  test('rows are points of their weight and an unmeasured component is left out', () => {
    expect(contributorItems({ hrv: 31.2, sleep: null, rhr: 20 })).toEqual([
      { label: 'HRV', value: 31.2, weight: 40, secondary: '/ 40 pts', key: 'HRV' },
      { label: 'RHR', value: 20, weight: 25, secondary: '/ 25 pts', key: 'RHR' },
    ])
  })
})

describe('facts headers', () => {
  test('every header has a value, a unit and a comparison', () => {
    const facts = [
      activitiesFact({ sessions: 12, totalMin: 600, dayCount: 30 }),
      acwrFact({ acwr: 1.1, zoneLabel: 'Optimal', inZone: 20, dayCount: 30 }),
      divergenceFact({ divergence: -4.26 }),
      recoveryFact({ mean: 61.5, high: 9, dayCount: 30 }),
      sleepFact({ hours: 7.25, score: 81, meanHours: 7.1, dayCount: 30 }),
      bodyBatteryFact({ net: -3, mean: 5, high: 90, low: 12, dayCount: 30 }),
      stressFact({ stress: 28, rest: 4, dayCount: 30 }),
      activityScoreFact({ score: 300, mean: 450, dayCount: 30 }),
    ]
    for (const f of facts) {
      expect(f.value).not.toBe('')
      expect(f.unit).toBeTruthy()
      expect(f.context.length).toBeGreaterThan(0)
    }
  })

  test('activity score states the share of the 600 target', () => {
    expect(activityScoreFact({ score: 300, mean: 450, dayCount: 30 }).context[0]).toBe(
      '50 % of the 600 target',
    )
  })

  test('null readings become em dashes in the header', () => {
    const f = activityScoreFact({ score: null, mean: null, dayCount: 0 })
    expect(f.value).toBe('—')
    expect(f.context.join(' ')).toContain('—')
    expect(sleepFact({ hours: null, score: null, meanHours: null, dayCount: 0 }).value).toBe('—')
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
    const f = activityScoreFact({ score: null, mean: 410, dayCount: 20 })
    expect(f.value).toBe('—')
    expect(f.context[0]).toBe('— % of the 600 target')
  })

  test('body battery uses one minus glyph and dashes for a missing day', () => {
    const f = bodyBatteryFact({ net: -12, mean: -3, high: null, low: null, dayCount: 9 })
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
