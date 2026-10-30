import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { runMigrations } from '../db/index.js'
import { deleteUsageBySource, seedUsageRecords, type SeedRecord } from '../test/usage-seed.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)

// Everything this file writes carries this source and the two accounts below, so cleanup and
// assertions stay scoped to it.
const SOURCE = 'account-test'
const A = 'zz-test-a'
const B = 'zz-test-b'

function payload(sourceId: string, account: string | null, costUsd = 1): SeedRecord {
  return {
    source: SOURCE,
    source_id: sourceId,
    ts: new Date().toISOString(),
    machine: 'm1',
    billing: 'max',
    account,
    cost_usd: costUsd,
  }
}

const ingest = (records: SeedRecord[]) => seedUsageRecords(records)

async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

describe('usage account attribution', () => {
  afterEach(async () => {
    await deleteUsageBySource(SOURCE)
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
