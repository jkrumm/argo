import { describe, expect, test } from 'bun:test'
import { buildFitnessData, type SeriesPoint } from './fitness-data'

const day = (i: number, over: Partial<SeriesPoint> = {}): SeriesPoint => ({
  date: `2026-05-${String(i + 1).padStart(2, '0')}`,
  restingHr: null,
  hrv: null,
  vo2Max: null,
  ...over,
})

describe('buildFitnessData', () => {
  test('keeps a row that has only a VO2 reading while both averages are still null', () => {
    const out = buildFitnessData([day(0, { vo2Max: 52 }), day(1)])
    expect(out).toHaveLength(1)
    expect(out[0]?.vo2max).toBe(52)
    expect(out[0]?.rhrMA).toBeNull()
    expect(out[0]?.hrvMA).toBeNull()
  })

  test('drops a row with no reading at all', () => {
    expect(buildFitnessData([day(0), day(1)])).toHaveLength(0)
  })

  test('keeps null z-scores as gaps, never zeros', () => {
    const out = buildFitnessData([day(0, { vo2Max: 52 })])
    expect(out[0]?.rhrZ).toBeNull()
    expect(out[0]?.hrvZ).toBeNull()
  })

  test('averages start once three samples exist; earlier all-null rows drop', () => {
    const rows = [0, 1, 2].map((i) => day(i, { restingHr: 60 + i }))
    const out = buildFitnessData(rows)
    expect(out.map((r) => r.rhrMA)).toEqual([61])
  })
})
