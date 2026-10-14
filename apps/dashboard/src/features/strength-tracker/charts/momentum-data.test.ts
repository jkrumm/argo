import { describe, expect, test } from 'bun:test'
import { directionFromVelocity, rollingVelocityPctPerDay } from './momentum-data'

const day = (i: number) => new Date(2026, 0, 1 + i)

describe('rollingVelocityPctPerDay', () => {
  test('null until three points sit in the window', () => {
    const out = rollingVelocityPctPerDay([
      { day: day(0), e1rm: 100 },
      { day: day(1), e1rm: 101 },
    ])
    expect(out).toEqual([null, null])
  })

  test('a linear +1 kg/day on a 100 kg mean is about +1 %/day at the anchor', () => {
    const rows = [0, 1, 2].map((i) => ({ day: day(i), e1rm: 100 + i }))
    const out = rollingVelocityPctPerDay(rows)
    expect(out[2]).toBeCloseTo((1 / 101) * 100, 6)
  })

  test('a null e1RM yields null and is skipped by neighbours', () => {
    const rows = [
      { day: day(0), e1rm: 100 },
      { day: day(1), e1rm: null },
      { day: day(2), e1rm: 100 },
      { day: day(3), e1rm: 100 },
    ]
    const out = rollingVelocityPctPerDay(rows)
    expect(out[1]).toBeNull()
    expect(out[3]).toBeCloseTo(0, 9)
  })
})

describe('directionFromVelocity', () => {
  test('thresholds at ±0.07 %/day', () => {
    expect(directionFromVelocity(0.1)).toBe('improving')
    expect(directionFromVelocity(-0.1)).toBe('declining')
    expect(directionFromVelocity(0.05)).toBe('stable')
    expect(directionFromVelocity(null)).toBeNull()
  })
})
