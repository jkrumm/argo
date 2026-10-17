import { describe, it, expect, beforeAll, afterEach, setSystemTime } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { usageRecord } from '../db/schema.js'
import { USAGE_DATA_FLOOR_ISO } from '../lib/usage-query.js'

beforeAll(async () => {
  await runMigrations()
})

describe('GET /usage/headline', () => {
  afterEach(async () => {
    setSystemTime()
    await db.delete(usageRecord)
  })

  it('returns zeros and nulls when table is empty', async () => {
    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      costUsd30d: number
      costUsd7d: number
      costMaxBilling30d: number
      costIuBilling30d: number
      tokens30d: number
      errorRate30d: number
      p95Ms30d: number | null
      cacheHitRatio30d: number | null
      sourcesActive: number
      maxTs: string | null
      recordsTotal: number
    }
    expect(body.costUsd30d).toBe(0)
    expect(body.costUsd7d).toBe(0)
    expect(body.costMaxBilling30d).toBe(0)
    expect(body.costIuBilling30d).toBe(0)
    expect(body.tokens30d).toBe(0)
    expect(body.errorRate30d).toBe(0)
    expect(body.p95Ms30d).toBeNull()
    expect(body.cacheHitRatio30d).toBeNull()
    expect(body.sourcesActive).toBe(0)
    expect(body.maxTs).toBeNull()
    expect(body.recordsTotal).toBe(0)
  })

  it('populates fields from one ok row', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 1.23,
      duration_ms: 100,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      costUsd30d: number
      costMaxBilling30d: number
      tokens30d: number
      errorRate30d: number
      p95Ms30d: number | null
      recordsTotal: number
    }
    // cost_usd is a single-precision `real` column, so 1.23 round-trips as
    // 1.2300000190734863 — compare to cent precision, not float-bit-exact.
    expect(body.costUsd30d).toBeCloseTo(1.23, 2)
    expect(body.costMaxBilling30d).toBeCloseTo(1.23, 2)
    expect(body.tokens30d).toBe(1500)
    expect(body.errorRate30d).toBe(0)
    expect(body.p95Ms30d).toBe(100)
    expect(body.recordsTotal).toBe(1)
  })

  it('computes error rate at 0.5', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'iu',
      outcome: 'ok',
      cost_usd: 0.1,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-2',
      grain: 'event',
      ts,
      billing: 'iu',
      outcome: 'error',
      cost_usd: 0.1,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { errorRate30d: number }
    expect(body.errorRate30d).toBe(0.5)
  })

  it('computes p95 from two durations', async () => {
    const ts = new Date().toISOString()
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-1',
      grain: 'event',
      ts,
      billing: 'max',
      duration_ms: 100,
      ingested_at: ts,
    })
    await db.insert(usageRecord).values({
      source: 'test',
      source_id: 'id-2',
      grain: 'event',
      ts,
      billing: 'max',
      duration_ms: 500,
      ingested_at: ts,
    })

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { p95Ms30d: number | null }
    expect(body.p95Ms30d).not.toBeNull()
    expect(body.p95Ms30d).toBeGreaterThan(100)
  })

  it('computes cache hit ratio', async () => {
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
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cacheHitRatio30d: number | null }
    expect(body.cacheHitRatio30d).not.toBeNull()
    expect(body.cacheHitRatio30d).toBeCloseTo(0.4, 5)
  })

  it('reports the prior 30 d window separately from the current one', async () => {
    const now = Date.now()
    const current = new Date(now - 5 * 86_400_000).toISOString()
    const prior = new Date(now - 40 * 86_400_000).toISOString()
    await db.insert(usageRecord).values([
      {
        source: 'test',
        source_id: 'cur',
        grain: 'event',
        ts: current,
        billing: 'max',
        cost_usd: 2,
        input_tokens: 100,
        duration_ms: 1000,
        ingested_at: current,
      },
      {
        source: 'test',
        source_id: 'prior-ok',
        grain: 'event',
        ts: prior,
        billing: 'max',
        cost_usd: 5,
        input_tokens: 400,
        duration_ms: 3000,
        ingested_at: prior,
      },
      {
        source: 'test',
        source_id: 'prior-err',
        grain: 'event',
        ts: prior,
        billing: 'max',
        outcome: 'error',
        cost_usd: 0,
        input_tokens: 0,
        ingested_at: prior,
      },
    ])

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      costUsd30d: number
      costUsdPrior30d: number | null
      tokensPrior30d: number | null
      errorRatePrior30d: number | null
      p95MsPrior30d: number | null
    }
    expect(body.costUsd30d).toBeCloseTo(2, 2)
    expect(body.costUsdPrior30d).toBeCloseTo(5, 2)
    expect(body.tokensPrior30d).toBe(400)
    expect(body.errorRatePrior30d).toBeCloseTo(0.5, 5)
    expect(body.p95MsPrior30d).toBe(3000)
  })

  it('counts the calls behind the error rate and returns null priors before the data floor', async () => {
    // 40 days after the floor, the 60-day lookback starts before it: the prior window is partial.
    const now = new Date(Date.parse(USAGE_DATA_FLOOR_ISO) + 40 * 86_400_000)
    setSystemTime(now)
    const ts = new Date(now.getTime() - 86_400_000).toISOString()
    await db.insert(usageRecord).values([
      { source: 'test', source_id: 'a', grain: 'event', ts, billing: 'max', ingested_at: ts },
      {
        source: 'test',
        source_id: 'b',
        grain: 'event',
        ts,
        billing: 'max',
        outcome: 'error',
        ingested_at: ts,
      },
    ])

    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, number | null>
    expect(body['calls30d']).toBe(2)
    expect(body['errorRate30d']).toBeCloseTo(0.5, 5)
    expect(body['costUsdPrior30d']).toBeNull()
    expect(body['tokensPrior30d']).toBeNull()
    expect(body['errorRatePrior30d']).toBeNull()
    expect(body['p95MsPrior30d']).toBeNull()
  })

  it('reports zero calls on an empty window', async () => {
    const app = new Elysia().use(usageRoutes)
    const res = await app.handle(new Request('http://localhost/usage/headline'))
    const body = (await res.json()) as { calls30d: number; errorRate30d: number }
    expect(body.calls30d).toBe(0)
    expect(body.errorRate30d).toBe(0)
  })
})
