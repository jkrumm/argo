import { describe, expect, test } from 'bun:test'
import { mergePoints } from './merge-acwr'

const pt = (date: string, acwr: number | null) => ({
  date,
  acute: 1,
  chronic: 1,
  acwr,
  zone: null,
})

describe('mergePoints', () => {
  test('joins exercises on date, sorted ascending', () => {
    const merged = mergePoints([
      {
        exercise_id: 'squat',
        exercise_name: 'Squat',
        points: [pt('2026-10-12', 1.1), pt('2026-10-05', 0.9)],
      },
      { exercise_id: 'bench_press', exercise_name: 'Bench', points: [pt('2026-10-05', 1.0)] },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]?.day).toEqual(new Date(2026, 9, 5))
    expect(Object.keys(merged[0]?.per ?? {}).toSorted()).toEqual(['bench_press', 'squat'])
    expect(merged[1]?.per.squat?.acwr).toBe(1.1)
  })
})
