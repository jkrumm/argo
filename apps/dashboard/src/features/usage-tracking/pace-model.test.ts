import { describe, expect, it } from 'bun:test'
import { paceAt, weekCurve } from './pace-model'

const RESET = Date.parse('2026-10-31T12:00:00Z')
const WEEK = 7 * 86_400_000
const START = RESET - WEEK
const iso = (ms: number) => new Date(ms).toISOString()
const NOW = START + 3 * 86_400_000

describe('paceAt', () => {
  it('runs 0 at the window start to 100 at the reset and clamps outside', () => {
    expect(paceAt(START, START)).toBe(0)
    expect(paceAt(START + WEEK / 2, START)).toBe(50)
    expect(paceAt(START + WEEK, START)).toBe(100)
    expect(paceAt(START - 1000, START)).toBe(0)
    expect(paceAt(START + 2 * WEEK, START)).toBe(100)
  })
})

describe('weekCurve', () => {
  const samples = [
    { at: iso(START - 3_600_000), sevenDayPct: 99 },
    { at: iso(START + 3_600_000), sevenDayPct: 2 },
    { at: iso(START + 86_400_000), sevenDayPct: 20 },
    { at: iso(NOW + 3_600_000), sevenDayPct: 90 },
  ]

  it('spans the whole window with two bare endpoints and drops samples outside it or in the future', () => {
    const curve = weekCurve(samples, iso(RESET), NOW)
    expect(curve?.data.map((p) => p.pct)).toEqual([null, 2, 20, null])
    expect(curve?.data[0]?.pace).toBe(0)
    expect(curve?.data.at(-1)?.pace).toBe(100)
    expect(curve?.start.getTime()).toBe(START)
  })

  it('puts the diagonal under every sample', () => {
    const curve = weekCurve(samples, iso(RESET), NOW)
    expect(curve?.data[2]?.pace).toBeCloseTo(100 / 7, 6)
  })

  it('has full coverage when the first sample opens the window, partial coverage otherwise', () => {
    expect(weekCurve(samples, iso(RESET), NOW)?.coverageFrom).toBeNull()
    const late = [{ at: iso(START + 2 * 86_400_000), sevenDayPct: 10 }]
    expect(weekCurve(late, iso(RESET), NOW)?.coverageFrom?.getTime()).toBe(START + 2 * 86_400_000)
  })

  it('is null without a usable reset instant', () => {
    expect(weekCurve(samples, null, NOW)).toBeNull()
    expect(weekCurve(samples, 'nope', NOW)).toBeNull()
  })
})
