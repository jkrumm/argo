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

// Everything this file writes carries this source and the two accounts below, so cleanup and
// assertions stay scoped to it and never touch (or depend on) whatever the dev DB already holds.
const SOURCE = 'account-test'
const A = 'zz-test-a'
const B = 'zz-test-b'

function payload(sourceId: string, account: string | null | undefined, costUsd = 1) {
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
    await db.delete(usageRecord).where(eq(usageRecord.source, SOURCE))
  })

  it('ingest stores account, null and absent both land as NULL', async () => {
    const res = await ingest([payload('a1', A), payload('a2', null), payload('a3', undefined)])
    expect(res.status).toBe(200)
    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source, SOURCE))
    const byId = Object.fromEntries(rows.map((r) => [r.source_id, r.account]))
    expect(byId).toEqual({ a1: A, a2: null, a3: null })
  })

  it('upsert fills a missing account and replaces a stored one', async () => {
    await ingest([payload('u1', null)])
    await ingest([payload('u1', B)])
    await ingest([payload('u1', A)])
    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source_id, 'u1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.account).toBe(A)
  })

  it('upsert with a null or absent account never clears a stored one', async () => {
    await ingest([payload('k1', A)])
    await ingest([payload('k1', null)])
    await ingest([payload('k1', undefined)])
    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source_id, 'k1'))
    expect(rows[0]?.account).toBe(A)
  })

  it('re-sending an empty or blank account keeps the stored one', async () => {
    await ingest([payload('e1', A)])
    await ingest([payload('e1', '')])
    await ingest([payload('e1', '  ')])
    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source_id, 'e1'))
    expect(rows[0]?.account).toBe(A)
  })

  it('trims the account and stores a bad value as null without rejecting the batch', async () => {
    const res = await ingest([payload('n1', ` ${A} `), payload('n2', 'IU Max!'), payload('n3', B)])
    expect(res.status).toBe(200)
    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source, SOURCE))
    const byId = Object.fromEntries(rows.map((r) => [r.source_id, r.account]))
    expect(byId).toEqual({ n1: A, n2: null, n3: B })
  })

  it('a malformed account filter is rejected', async () => {
    const res = await app.handle(
      new Request(
        'http://localhost/usage/breakdown?range=7d&metric=cost&dimension=source&account=IU!',
      ),
    )
    expect(res.status).toBe(422)
  })

  it('breakdown filters and groups by account', async () => {
    await ingest([payload('b1', A, 3), payload('b2', B, 1), payload('b3', null, 2)])
    const scope = `sources=${SOURCE}`

    const grouped = await getJson<{ total: number; rows: Array<{ key: string; value: number }> }>(
      `/usage/breakdown?range=7d&metric=cost&dimension=account&${scope}`,
    )
    expect(grouped.total).toBe(6)
    expect(Object.fromEntries(grouped.rows.map((r) => [r.key, r.value]))).toEqual({
      [A]: 3,
      [B]: 1,
      '(unset)': 2,
    })

    const filtered = await getJson<{ total: number }>(
      `/usage/breakdown?range=7d&metric=cost&dimension=source&${scope}&account=${B}`,
    )
    expect(filtered.total).toBe(1)

    const both = await getJson<{ total: number }>(
      `/usage/breakdown?range=7d&metric=cost&dimension=source&${scope}&account=${B}&account=${A}`,
    )
    expect(both.total).toBe(4)
  })

  it('timeseries filters and groups by account', async () => {
    await ingest([payload('t1', A, 3), payload('t2', B, 1)])
    const scope = `sources=${SOURCE}`

    const split = await getJson<{ groupKeys: string[] }>(
      `/usage/timeseries?range=7d&metric=cost&groupBy=account&${scope}`,
    )
    expect(split.groupKeys.toSorted()).toEqual([A, B])

    const filtered = await getJson<{ buckets: Array<{ groups: Record<string, number> }> }>(
      `/usage/timeseries?range=7d&metric=cost&${scope}&account=${A}`,
    )
    const sum = filtered.buckets.reduce((acc, b) => acc + (b.groups['value'] ?? 0), 0)
    expect(sum).toBe(3)
  })

  it('headline filters by account', async () => {
    await ingest([payload('h1', A, 3), payload('h2', B, 1)])
    const a = await getJson<{ costUsd30d: number }>(`/usage/headline?account=${A}`)
    const both = await getJson<{ costUsd30d: number }>(`/usage/headline?account=${A}&account=${B}`)
    expect(a.costUsd30d).toBe(3)
    expect(both.costUsd30d).toBe(4)
  })
})
