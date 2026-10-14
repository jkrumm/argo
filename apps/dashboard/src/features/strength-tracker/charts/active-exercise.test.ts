import { describe, expect, test } from 'bun:test'
import { pickActiveExercise } from './active-exercise'

const ex = (exercise_id: string, n: number) => ({ exercise_id, points: Array(n).fill(0) })

describe('pickActiveExercise', () => {
  test('keeps the selection when it has points', () => {
    expect(pickActiveExercise([ex('squat', 2), ex('bench_press', 3)], 'squat')?.exercise_id).toBe(
      'squat',
    )
  })
  test('falls back when the selection is present but empty', () => {
    expect(pickActiveExercise([ex('squat', 0), ex('bench_press', 3)], 'squat')?.exercise_id).toBe(
      'bench_press',
    )
  })
  test('is undefined when nothing has points or data is missing', () => {
    expect(pickActiveExercise([ex('squat', 0)], 'squat')).toBeUndefined()
    expect(pickActiveExercise(undefined, 'squat')).toBeUndefined()
  })
})
