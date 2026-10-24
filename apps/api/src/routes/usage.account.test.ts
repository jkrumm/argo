import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)

function payload(sourceId: string, account: string | null | undefined, costUsd = 1) {
  const ts = new Date().toISOString()
  return {
    source: 'test',
    source_id: sourceId,
    grain: 'event',
    ts,
    model: null,
    model_norm: null,
    project: null,
    sub_tool: null,
    machine: 'm1',
    billing: 'max',
    ...(account === undefined ? {} : { account }),
    duration_ms: null,
    cost_usd: costUsd,
    raw: null,
    ingested_at: ts,
  }
}

function ingest(records: ReturnType<typeof payload>[]) {
  return app.handle(
    new Request('http://localhost/usage/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    }),
  )
}

async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

describe('usage account attribution', () => {
  afterEach(async () => {
    await db.delete(usageRecord)
  })

  it('ingest stores account, null and absent both land as NULL', async () => {
    const res = await ingest([payload('a1', 'iu'), payload('a2', null), payload('a3', undefined)])
    expect(res.status).toBe(200)
    const rows = await db.select().from(usageRecord)
    const byId = Object.fromEntries(rows.map((r) => [r.source_id, r.account]))
    expect(byId).toEqual({ a1: 'iu', a2: null, a3: null })
  })

  it('upsert of an existing row updates account', async () => {
    await ingest([payload('u1', null)])
    await ingest([payload('u1', 'me')])
    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source_id, 'u1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.account).toBe('me')
  })

  it('rejects a malformed account', async () => {
    const res = await ingest([payload('bad', 'IU Max!')])
    expect(res.status).toBe(422)
  })

  it('breakdown filters and groups by account', async () => {
    await ingest([payload('b1', 'iu', 3), payload('b2', 'me', 1), payload('b3', null, 2)])

    const grouped = await getJson<{ total: number; rows: Array<{ key: string; value: number }> }>(
      '/usage/breakdown?range=7d&metric=cost&dimension=account',
    )
    expect(grouped.total).toBe(6)
    expect(Object.fromEntries(grouped.rows.map((r) => [r.key, r.value]))).toEqual({
      iu: 3,
      me: 1,
      '(unset)': 2,
    })

    const filtered = await getJson<{ total: number }>(
      '/usage/breakdown?range=7d&metric=cost&dimension=source&account=me',
    )
    expect(filtered.total).toBe(1)

    const both = await getJson<{ total: number }>(
      '/usage/breakdown?range=7d&metric=cost&dimension=source&account=me&account=iu',
    )
    expect(both.total).toBe(4)
  })

  it('timeseries filters and groups by account', async () => {
    await ingest([payload('t1', 'iu', 3), payload('t2', 'me', 1)])

    const split = await getJson<{ groupKeys: string[] }>(
      '/usage/timeseries?range=7d&metric=cost&groupBy=account',
    )
    expect(split.groupKeys.toSorted()).toEqual(['iu', 'me'])

    const filtered = await getJson<{ buckets: Array<{ groups: Record<string, number> }> }>(
      '/usage/timeseries?range=7d&metric=cost&account=iu',
    )
    const sum = filtered.buckets.reduce((acc, b) => acc + (b.groups['value'] ?? 0), 0)
    expect(sum).toBe(3)
  })

  it('headline filters by account', async () => {
    await ingest([payload('h1', 'iu', 3), payload('h2', 'me', 1)])
    const all = await getJson<{ costUsd30d: number }>('/usage/headline')
    const me = await getJson<{ costUsd30d: number }>('/usage/headline?account=me')
    expect(all.costUsd30d).toBe(4)
    expect(me.costUsd30d).toBe(1)
  })
})
