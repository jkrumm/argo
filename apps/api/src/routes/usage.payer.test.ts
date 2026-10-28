import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { eq, sql } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { utcBucket } from '../lib/usage-query.js'
import { db, runMigrations } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const SOURCE = 'payer-test'

function payload(
  sourceId: string,
  billing: string,
  account: string | null,
  costUsd: number,
  iuKey?: string | null,
) {
  const ts = new Date().toISOString()
  return {
    source: SOURCE,
    source_id: sourceId,
    grain: 'event',
    ts,
    model: null,
    model_norm: null,
    project: null,
    sub_tool: null,
    machine: 'm1',
    billing,
    account,
    ...(iuKey === undefined ? {} : { iu_key: iuKey }),
    duration_ms: null,
    cost_usd: costUsd,
    raw: null,
    ingested_at: ts,
  }
}

async function ingest(records: ReturnType<typeof payload>[]) {
  const res = await app.handle(
    new Request('http://localhost/usage/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    }),
  )
  expect(res.status).toBe(200)
}

async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

type Rows = { total: number; rows: Array<{ key: string; value: number }> }

describe('usage payer', () => {
  afterEach(async () => {
    await db.delete(usageRecord).where(eq(usageRecord.source, SOURCE))
  })

  it('derives the payer from billing and account, on breakdown and timeseries', async () => {
    await ingest([
      payload('p1', 'max', 'iu', 1),
      payload('p2', 'max', 'me', 2),
      payload('p3', 'iu', null, 4),
      payload('p4', 'openrouter', null, 8),
      payload('p5', 'max', null, 16),
      payload('p6', 'unknown', null, 32),
    ])
    const scope = `sources=${SOURCE}`

    const grouped = await getJson<Rows>(
      `/usage/breakdown?range=7d&metric=cost&dimension=payer&${scope}`,
    )
    expect(Object.fromEntries(grouped.rows.map((r) => [r.key, r.value]))).toEqual({
      'iu-sub': 1,
      'me-sub': 2,
      'iu-api': 4,
      'me-api': 8,
      unknown: 48,
    })

    const series = await getJson<{ groupKeys: string[] }>(
      `/usage/timeseries?range=7d&grain=day&metric=cost&groupBy=payer&${scope}`,
    )
    expect(series.groupKeys.toSorted()).toEqual(['iu-api', 'iu-sub', 'me-api', 'me-sub', 'unknown'])
  })

  it('filters by one or several payers, and billing and account still work', async () => {
    await ingest([
      payload('f1', 'max', 'iu', 1),
      payload('f2', 'max', 'me', 2),
      payload('f3', 'iu', null, 4),
    ])
    const base = `/usage/breakdown?range=7d&metric=cost&dimension=source&sources=${SOURCE}`

    expect((await getJson<Rows>(`${base}&payer=me-sub`)).total).toBe(2)
    expect((await getJson<Rows>(`${base}&payer=me-sub&payer=iu-api`)).total).toBe(6)
    expect((await getJson<Rows>(`${base}&billing=max`)).total).toBe(3)
    expect((await getJson<Rows>(`${base}&account=iu`)).total).toBe(1)
  })

  it('derives iu-team-api from the athena-team key; an iu row of unknown key is unknown', async () => {
    await ingest([
      payload('k1', 'iu', null, 4),
      payload('k2', 'iu', null, 8, 'athena-team'),
      payload('k3', 'iu', null, 16, 'not-registered'),
    ])
    const grouped = await getJson<Rows>(
      `/usage/breakdown?range=7d&metric=cost&dimension=payer&sources=${SOURCE}`,
    )
    expect(Object.fromEntries(grouped.rows.map((r) => [r.key, r.value]))).toEqual({
      'iu-api': 4,
      'iu-team-api': 8,
      unknown: 16,
    })
    const base = `/usage/breakdown?range=7d&metric=cost&dimension=source&sources=${SOURCE}`
    expect((await getJson<Rows>(`${base}&payer=iu-team-api`)).total).toBe(8)
  })

  it('leaves iu-api totals exactly as they were when athena-team rows exist', async () => {
    const iuApi = async () => {
      const r = await getJson<Rows>(
        `/usage/breakdown?range=7d&metric=cost&dimension=payer&sources=${SOURCE}&payer=iu-api`,
      )
      return r.rows.find((x) => x.key === 'iu-api')?.value ?? 0
    }
    await ingest([payload('u1', 'iu', null, 4), payload('u2', 'iu', null, 2, 'personal')])
    const before = await iuApi()
    expect(before).toBe(6)

    await ingest([payload('u3', 'iu', null, 100, 'athena-team')])
    expect(await iuApi()).toBe(before)
    const series = await getJson<{ groupKeys: string[] }>(
      `/usage/timeseries?range=7d&grain=day&metric=cost&groupBy=payer&sources=${SOURCE}&payer=iu-api`,
    )
    expect(series.groupKeys).toEqual(['iu-api'])
  })

  it('rejects an unknown payer', async () => {
    const res = await app.handle(
      new Request('http://localhost/usage/breakdown?range=7d&metric=cost&dimension=source&payer=x'),
    )
    expect(res.status).toBe(422)
  })

  it('headline carries the per-payer 30 d cost and honours the payer filter', async () => {
    await ingest([payload('h1', 'max', 'iu', 1), payload('h2', 'openrouter', null, 8)])
    type Head = {
      costIuSub30d: number
      costMeSub30d: number
      costIuApi30d: number
      costMeApi30d: number
      costUsd30d: number
    }
    const all = await getJson<Head>('/usage/headline')
    expect(all.costIuSub30d).toBeGreaterThanOrEqual(1)
    expect(all.costMeApi30d).toBeGreaterThanOrEqual(8)

    const only = await getJson<Head>('/usage/headline?payer=me-api')
    expect(only.costIuSub30d).toBe(0)
    expect(only.costUsd30d).toBe(only.costMeApi30d)
  })

  it('buckets days in UTC whatever the database session timezone is', async () => {
    // 23:30 UTC two days ago is already the next calendar day in Europe/Berlin.
    const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    const p = { ...payload('tz1', 'max', 'iu', 7), ts: `${day}T23:30:00.000Z` }
    await ingest([p])
    const series = await getJson<{
      buckets: Array<{ bucket: string; groups: Record<string, number | null> }>
    }>(`/usage/timeseries?range=7d&grain=day&metric=cost&groupBy=payer&sources=${SOURCE}`)
    const hit = series.buckets.filter((b) => (b.groups['iu-sub'] ?? 0) > 0)
    expect(hit.map((b) => b.bucket)).toEqual([day])
  })

  it('utcBucket ignores the session timezone', async () => {
    class Rollback extends Error {}
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL TIME ZONE 'Europe/Berlin'`)
        const [tz] = (await tx.execute(sql`SHOW TIME ZONE`)) as unknown as Array<{
          TimeZone: string
        }>
        expect(tz?.TimeZone).toBe('Europe/Berlin')
        // 23:30 UTC is already the next day, and the next ISO week's Monday, in Berlin.
        const instant = sql`${'2026-10-25T23:30:00Z'}::timestamptz`
        const [row] = (await tx.execute(
          sql`SELECT ${utcBucket('day', instant)}::date::text AS day, ${utcBucket('week', instant)}::date::text AS week`,
        )) as unknown as Array<{ day: string; week: string }>
        expect(row).toEqual({ day: '2026-10-25', week: '2026-10-19' })
        throw new Rollback()
      }),
    ).rejects.toBeInstanceOf(Rollback)
  })
})
