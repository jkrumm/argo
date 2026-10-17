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
      { label: 'HRV', value: 31.2, secondary: '/ 40 pts', key: 'HRV' },
      { label: 'RHR', value: 20, secondary: '/ 25 pts', key: 'RHR' },
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
