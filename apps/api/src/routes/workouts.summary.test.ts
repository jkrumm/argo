import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { workoutRoutes } from './workouts.js'
import { db, runMigrations } from '../db/index.js'
import { workouts, workoutSets } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

describe('GET /workouts/summary/strength', () => {
  afterEach(async () => {
    await db.delete(workoutSets)
    await db.delete(workouts)
  })

  it('returns empty byExercise when no workouts in window', async () => {
    const app = new Elysia().use(workoutRoutes)
    const res = await app.handle(
      new Request('http://localhost/workouts/summary/strength?from=2025-01-01&to=2025-01-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { byExercise: unknown[] }
    expect(body.byExercise).toHaveLength(0)
  })

  it('computes e1rm and session volume for a bench press session', async () => {
    const [workout] = await db
      .insert(workouts)
      .values({ date: '2025-01-15', exercise_id: 'bench_press' })
      .returning()

    await db.insert(workoutSets).values([
      // work set: weight=100, reps=5 → e1rm=114.6, volume=500
      { workout_id: workout!.id, set_number: 1, set_type: 'work', weight_kg: 100, reps: 5 },
      // warmup: excluded from e1rm but adds to volume
      { workout_id: workout!.id, set_number: 2, set_type: 'warmup', weight_kg: 60, reps: 10 },
    ])

    const app = new Elysia().use(workoutRoutes)
    const res = await app.handle(
      new Request('http://localhost/workouts/summary/strength?from=2025-01-01&to=2025-01-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      byExercise: Array<{
        exercise_id: string
        exercise_name: string
        sessionCountWindow: number
        bestE1RM: number | null
        currentE1RM: number | null
        totalVolumeWindow: number
      }>
    }
    expect(body.byExercise).toHaveLength(1)
    const item = body.byExercise[0]!
    expect(item.exercise_id).toBe('bench_press')
    expect(item.exercise_name).toBe('Bench Press')
    expect(item.sessionCountWindow).toBe(1)
    // Epley=116.7, Brzycki=112.5, avg=114.6
    expect(item.bestE1RM).toBe(114.6)
    expect(item.currentE1RM).toBe(114.6)
    // volume: 100×5 + 60×10 = 1100
    expect(item.totalVolumeWindow).toBe(1100)
  })

  it('tracks PR date and aggregates multiple sessions', async () => {
    const [w1] = await db
      .insert(workouts)
      .values({ date: '2025-01-10', exercise_id: 'bench_press' })
      .returning()
    const [w2] = await db
      .insert(workouts)
      .values({ date: '2025-01-20', exercise_id: 'bench_press' })
      .returning()

    await db.insert(workoutSets).values([
      { workout_id: w1!.id, set_number: 1, set_type: 'work', weight_kg: 90, reps: 5 },
      { workout_id: w2!.id, set_number: 1, set_type: 'work', weight_kg: 100, reps: 5 },
    ])

    const app = new Elysia().use(workoutRoutes)
    const res = await app.handle(
      new Request('http://localhost/workouts/summary/strength?from=2025-01-01&to=2025-01-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      byExercise: Array<{
        sessionCountWindow: number
        prDate: string | null
        bestE1RM: number | null
      }>
    }
    expect(body.byExercise[0]!.sessionCountWindow).toBe(2)
    expect(body.byExercise[0]!.prDate).toBe('2025-01-20')
    // best e1rm from 100×5 = 114.6
    expect(body.byExercise[0]!.bestE1RM).toBe(114.6)
  })
})
