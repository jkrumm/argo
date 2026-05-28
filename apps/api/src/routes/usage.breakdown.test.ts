import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

describe('GET /usage/breakdown', () => {
  afterEach(async () => {
    await db.delete(usageRecord)
  })

  it('returns empty rows and total 0 for empty window', async () => {
    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/breakdown?range=7d&metric=cost&dimension=project&limit=2',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      total: number
      rows: Array<{ key: string; value: number; share: number }>
    }
    expect(body.total).toBe(0)
    expect(body.rows).toHaveLength(0)
  })

  it('returns top 2 rows with share based on full total of 3', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      project: 'p1',
      cost_usd: 1,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-2',
      grain: 'event',
      ts,
      billing: 'max',
      project: 'p2',
      cost_usd: 2,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-3',
      grain: 'event',
      ts,
      billing: 'max',
      project: 'p3',
      cost_usd: 3,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/breakdown?range=7d&metric=cost&dimension=project&limit=2',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      total: number
      rows: Array<{ key: string; value: number; share: number }>
    }

    expect(body.total).toBe(6)
    expect(body.rows).toHaveLength(2)
    expect(body.rows[0]!.share).toBeCloseTo(3 / 6, 5)
    expect(body.rows[1]!.share).toBeCloseTo(2 / 6, 5)
  })

  it('buckets NULL project as (unset)', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      project: null,
      cost_usd: 1,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/breakdown?range=7d&metric=cost&dimension=project&limit=2',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: Array<{ key: string }> }
    expect(body.rows[0]!.key).toBe('(unset)')
  })

  it('metric=errors counts only error rows', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      outcome: 'ok',
      cost_usd: 1,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-2',
      grain: 'event',
      ts,
      billing: 'max',
      outcome: 'error',
      cost_usd: 1,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-3',
      grain: 'event',
      ts,
      billing: 'max',
      outcome: 'error',
      cost_usd: 1,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/breakdown?range=7d&metric=errors&dimension=source&limit=2',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      total: number
      rows: Array<{ key: string; value: number }>
    }
    expect(body.total).toBe(2)
    expect(body.rows[0]!.value).toBe(2)
  })
})
