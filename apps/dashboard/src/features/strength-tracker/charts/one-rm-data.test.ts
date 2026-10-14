import { describe, expect, test } from 'bun:test'
import { buildMergedPoints, trendArrow, type ApiSeriesByExercise } from './one-rm-data'

const pt = (date: string, e1rm: number | null, ma30: number | null = null) => ({
  date,
  e1rm,
  ma30,
  bestSet: null,
})

const bench: ApiSeriesByExercise = {
  exercise_id: 'bench_press',
  exercise_name: 'Bench',
  points: [pt('2026-01-01', 100), pt('2026-01-08', 95), pt('2026-01-15', 105)],
}
const squat: ApiSeriesByExercise = {
  exercise_id: 'squat',
  exercise_name: 'Squat',
  points: [pt('2026-01-08', 140)],
}

describe('buildMergedPoints', () => {
  const rows = buildMergedPoints([bench, squat], ['bench_press', 'squat'])

  test('unions dates in order, as local days', () => {
    expect(rows.map((r) => r.day.getDate())).toEqual([1, 8, 15])
    expect(rows[0]!.day.getMonth()).toBe(0)
  })

  test('flags a PR only when the running max is beaten', () => {
    expect(rows.map((r) => r.prSet.has('bench_press'))).toEqual([false, false, true])
  })

  test('the first value in a window is a baseline, never a PR', () => {
    expect(rows.every((r) => !r.prSet.has('squat'))).toBe(true)
  })

  test('a lift missing on a date is null, not zero', () => {
    expect(rows[0]!.e1rm.squat).toBeNull()
  })

  test('ignores lifts that are not active', () => {
    expect(buildMergedPoints([bench, squat], ['squat'])).toHaveLength(1)
  })
})

describe('trendArrow', () => {
  const ex = (a: number, b: number): ApiSeriesByExercise => ({
    ...bench,
    points: [pt('2026-01-01', 1, a), pt('2026-01-08', 1, b)],
  })
  test('thresholds at 0.25 kg', () => {
    expect(trendArrow([ex(100, 100.2)], 'bench_press')).toBe('stable')
    expect(trendArrow([ex(100, 101)], 'bench_press')).toBe('improving')
    expect(trendArrow([ex(100, 99)], 'bench_press')).toBe('declining')
  })
  test('null without two MA values', () => {
    expect(trendArrow([bench], 'bench_press')).toBeNull()
  })
})
