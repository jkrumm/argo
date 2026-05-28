import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

describe('GET /usage/headline', () => {
  afterEach(async () => {
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
    expect(body.costUsd30d).toBe(1.23)
    expect(body.costMaxBilling30d).toBe(1.23)
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
})
