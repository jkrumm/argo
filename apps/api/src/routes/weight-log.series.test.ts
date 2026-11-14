import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { weightLogRoutes } from './weight-log.js'
import { db, runMigrations } from '../db/index.js'
import { weightLog } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type WeightSeries = {
  points: Array<{ date: string; weightKg: number }>
}

describe('GET /weight-log/series', () => {
  afterEach(async () => {
    await db.delete(weightLog)
  })

  it('returns one point per distinct date', async () => {
    await db.insert(weightLog).values([
      { date: '2025-03-01', weight_kg: 82 },
      { date: '2025-03-08', weight_kg: 81.5 },
      { date: '2025-03-15', weight_kg: 81 },
    ])

    const app = new Elysia().use(weightLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/weight-log/series?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as WeightSeries
    expect(body.points).toEqual([
      { date: '2025-03-01', weightKg: 82 },
      { date: '2025-03-08', weightKg: 81.5 },
      { date: '2025-03-15', weightKg: 81 },
    ])
  })
})
