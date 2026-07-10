import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

describe('GET /usage/timeseries', () => {
  afterEach(async () => {
    await db.delete(usageRecord)
  })

  it('returns zero-filled buckets for empty window metric=cost groupBy=none', async () => {
    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request('http://localhost/usage/timeseries?range=7d&grain=day&metric=cost&groupBy=none'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      buckets: Array<{ bucket: string; groups: Record<string, number | null> }>
      groupKeys: string[]
    }
    expect(body.groupKeys).toEqual(['value'])
    expect(body.buckets.length).toBeGreaterThanOrEqual(7)
    expect(body.buckets[0]?.groups['value']).toBe(0)
  })

  it('aggregates cost per day across 3 rows on 2 days', async () => {
    const t1 = new Date().toISOString()
    const t2 = new Date(Date.now() - 86_400_000).toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts: t1,
      billing: 'max',
      cost_usd: 1,
      ingested_at: t1,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-2',
      grain: 'event',
      ts: t1,
      billing: 'max',
      cost_usd: 2,
      ingested_at: t1,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-3',
      grain: 'event',
      ts: t2,
      billing: 'max',
      cost_usd: 3,
      ingested_at: t2,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request('http://localhost/usage/timeseries?range=7d&grain=day&metric=cost&groupBy=none'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      buckets: Array<{ bucket: string; groups: Record<string, number | null> }>
    }
    const todayBucket = new Date().toISOString().slice(0, 10)
    const yesterdayBucket = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const today = body.buckets.find((b) => b.bucket === todayBucket)
    const yesterday = body.buckets.find((b) => b.bucket === yesterdayBucket)
    expect(today?.groups['value']).toBe(3)
    expect(yesterday?.groups['value']).toBe(3)
  })

  it('groupBy=source returns both sources sorted by descending total', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'alpha',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      cost_usd: 5,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'beta',
      source_id: 'id-2',
      grain: 'event',
      ts,
      billing: 'max',
      cost_usd: 1,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/timeseries?range=7d&grain=day&metric=cost&groupBy=source',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      buckets: Array<{ bucket: string; groups: Record<string, number | null> }>
      groupKeys: string[]
    }
    expect(body.groupKeys).toEqual(['alpha', 'beta'])
  })

  it('filters by sources array', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'foo',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      cost_usd: 1,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'bar',
      source_id: 'id-2',
      grain: 'event',
      ts,
      billing: 'max',
      cost_usd: 2,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/timeseries?range=7d&grain=day&metric=cost&groupBy=source&sources=foo',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      buckets: Array<{ bucket: string; groups: Record<string, number | null> }>
      groupKeys: string[]
    }
    expect(body.groupKeys).toEqual(['foo'])
  })

  it('metric=tokens sums the counted token columns, excluding cache_read', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      input_tokens: 1,
      output_tokens: 2,
      cache_read_tokens: 3,
      cache_write_tokens: 4,
      reasoning_tokens: 5,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/timeseries?range=7d&grain=day&metric=tokens&groupBy=none',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      buckets: Array<{ bucket: string; groups: Record<string, number | null> }>
    }
    // input(1) + output(2) + cache_write(4) + reasoning(5) = 12; cache_read(3) is
    // excluded (Anthropic reports it as an accumulated total, so summing re-counts it).
    const today = body.buckets.find((b) => b.groups['value'] === 12)
    expect(today).toBeDefined()
  })

  it('metric=cache_ratio returns weighted ratio per bucket', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      cache_read_tokens: 400,
      input_tokens: 600,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(
      new Request(
        'http://localhost/usage/timeseries?range=7d&grain=day&metric=cache_ratio&groupBy=none',
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      buckets: Array<{ bucket: string; groups: Record<string, number | null> }>
    }
    const today = body.buckets.find((b) => {
      const v = b.groups['value']
      return v !== null && v !== undefined && Math.abs(v - 0.4) < 0.001
    })
    expect(today).toBeDefined()
  })
})
