import { describe, it, expect, beforeAll, beforeEach, afterAll, spyOn } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { iuPortalCost, iuPortalTotal, usageRecord } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const SOURCE = 'iukey-test'
const TEAMCHAT = 'athena-teamchat'
const FETCHED = '2026-10-26T12:00:00.000Z'

type Over = Record<string, unknown>

function payload(sourceId: string, over: Over = {}) {
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
    billing: 'iu',
    duration_ms: null,
    cost_usd: 1,
    raw: null,
    ingested_at: ts,
    ...over,
  }
}

const post = (path: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost/usage${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
const ingest = (records: Array<ReturnType<typeof payload>>) => post('/records', { records })
async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost/usage${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}
const storedKey = async (sourceId: string) =>
  (await db.select().from(usageRecord).where(eq(usageRecord.source_id, sourceId)))[0]?.iu_key

type Rows = { total: number; rows: Array<{ key: string; value: number }> }

const clean = async () => {
  await db.delete(usageRecord)
  await db.delete(iuPortalCost)
  await db.delete(iuPortalTotal)
}
beforeEach(clean)
afterAll(clean)

describe('POST /usage/records iu_key', () => {
  it('files an iu row without a key under personal, whether absent, null or blank', async () => {
    await ingest([
      payload('a1'),
      payload('a2', { iu_key: null }),
      payload('a3', { iu_key: '' }),
      payload('a4', { iu_key: '  ' }),
    ])
    for (const id of ['a1', 'a2', 'a3', 'a4']) expect(await storedKey(id)).toBe('personal')
  })

  it('keeps a registered key', async () => {
    await ingest([payload('b1', { iu_key: 'athena-team' }), payload('b2', { iu_key: 'personal' })])
    expect(await storedKey('b1')).toBe('athena-team')
    expect(await storedKey('b2')).toBe('personal')
  })

  it('stores NULL for an unregistered key, warns once per batch and never rejects it', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await ingest([
        payload('c1', { iu_key: 'future-key' }),
        payload('c2', { iu_key: 'Not A Key!' }),
        payload('c3', { iu_key: 'athena-team' }),
      ])
      expect(res.status).toBe(200)
      expect(await storedKey('c1')).toBeNull()
      expect(await storedKey('c2')).toBeNull()
      expect(await storedKey('c3')).toBe('athena-team')
      const warnings = warn.mock.calls.filter((c) => String(c[0]).includes('iu_key'))
      expect(warnings).toHaveLength(1)
      expect(String(warnings[0]?.[0])).toContain('2 iu record(s)')
    } finally {
      warn.mockRestore()
    }
  })

  it('stores NULL for every non-iu billing, whatever the producer sent', async () => {
    await ingest([
      payload('d1', { billing: 'max', account: 'iu', iu_key: 'athena-team' }),
      payload('d2', { billing: 'openrouter', iu_key: 'personal' }),
    ])
    expect(await storedKey('d1')).toBeNull()
    expect(await storedKey('d2')).toBeNull()
  })

  it('overwrites the key on a re-post of the same row', async () => {
    await ingest([payload('e1', { iu_key: 'personal' })])
    await ingest([payload('e1', { iu_key: 'athena-team' })])
    expect(await storedKey('e1')).toBe('athena-team')
  })
})

describe('iuKey filter and dimension', () => {
  const seed = () =>
    ingest([
      payload('f1', { cost_usd: 1, model_norm: 'm-a' }),
      payload('f2', { cost_usd: 2, iu_key: 'personal', model_norm: 'm-a' }),
      payload('f3', { cost_usd: 4, iu_key: 'athena-team', model_norm: 'm-a' }),
      payload('f4', { cost_usd: 8, billing: 'openrouter', model_norm: 'm-a' }),
    ])

  it('filters breakdown, timeseries, split, rhythm and flow, scalar or array', async () => {
    await seed()
    const b = (q: string) =>
      getJson<Rows>(`/breakdown?range=7d&metric=cost&dimension=source&sources=${SOURCE}&${q}`)
    expect((await b('iuKey=athena-team')).total).toBe(4)
    expect((await b('iuKey=personal')).total).toBe(3)
    expect((await b('iuKey=personal&iuKey=athena-team')).total).toBe(7)

    const series = await getJson<{ buckets: Array<{ groups: Record<string, number> }> }>(
      `/timeseries?range=7d&metric=cost&groupBy=source&sources=${SOURCE}&iuKey=athena-team`,
    )
    const sum = series.buckets.reduce((n, x) => n + (x.groups[SOURCE] ?? 0), 0)
    expect(sum).toBe(4)

    const split = await getJson<{ totals: Array<{ payer: string; cost: number }> }>(
      '/split?by=model_norm&range=7d&iuKey=athena-team',
    )
    expect(split.totals).toEqual([expect.objectContaining({ payer: 'iu-team-api', cost: 4 })])

    const rhythm = await getJson<{ cells: Array<{ value: number }> }>(
      '/rhythm?range=7d&iuKey=athena-team',
    )
    expect(rhythm.cells.reduce((n, c) => n + c.value, 0)).toBe(4)

    const flow = await getJson<{ total: number }>('/flow?range=7d&iuKey=athena-team')
    expect(flow.total).toBe(4)
  })

  it('rejects an unregistered iuKey filter', async () => {
    const res = await app.handle(new Request('http://localhost/usage/flow?iuKey=nope'))
    expect(res.status).toBe(422)
  })

  it('groups by iu_key; non-iu and unknown-key rows bucket as (unset)', async () => {
    await seed()
    await ingest([payload('f5', { cost_usd: 16, iu_key: 'unregistered' })])
    const grouped = await getJson<Rows>(
      `/breakdown?range=7d&metric=cost&dimension=iu_key&sources=${SOURCE}`,
    )
    expect(Object.fromEntries(grouped.rows.map((r) => [r.key, r.value]))).toEqual({
      personal: 3,
      'athena-team': 4,
      '(unset)': 24,
    })
    const series = await getJson<{ groupKeys: string[] }>(
      `/timeseries?range=7d&metric=cost&groupBy=iu_key&sources=${SOURCE}`,
    )
    expect(series.groupKeys.toSorted()).toEqual(['(unset)', 'athena-team', 'personal'])
  })
})

describe('POST /usage/iu-portal iuKey', () => {
  const cost = (over: Over = {}) => ({
    day: '2026-10-26',
    label: 'GPT 5.6 Terra',
    row: 0,
    model: 'gpt-5.6-terra',
    costUsd: 10,
    fetchedAt: FETCHED,
    ...over,
  })
  const portal = (body: unknown) => post('/iu-portal', body)

  it('never lets an athena-team cell overwrite the personal cell of the same day and label', async () => {
    await portal({ costs: [cost({ costUsd: 10 })], totals: [] })
    const res = await portal({
      costs: [cost({ iuKey: 'athena-team', costUsd: 99, fetchedAt: '2026-10-26T16:00:00.000Z' })],
      totals: [],
    })
    expect(await res.json()).toEqual({ costs: 1, totals: 0, rejected: 0 })
    const rows = await db.select().from(iuPortalCost)
    expect(rows).toHaveLength(2)
    const byKey = Object.fromEntries(rows.map((r) => [r.iu_key, r.cost_usd]))
    expect(byKey).toEqual({ personal: 10, 'athena-team': 99 })
  })

  it('keeps both keys of one natural key in a single batch', async () => {
    const res = await portal({
      costs: [cost({ costUsd: 1 }), cost({ iuKey: 'athena-team', costUsd: 2 })],
      totals: [
        { month: '2026-10', totalUsd: 1, fetchedAt: FETCHED },
        { iuKey: 'athena-team', month: '2026-10', totalUsd: 2, fetchedAt: FETCHED },
      ],
    })
    expect(await res.json()).toEqual({ costs: 2, totals: 2, rejected: 0 })
    const totals = await db.select().from(iuPortalTotal)
    expect(Object.fromEntries(totals.map((t) => [t.iu_key, t.total_usd]))).toEqual({
      personal: 1,
      'athena-team': 2,
    })
  })

  it('drops a row with an unregistered key and counts it, never filing it elsewhere', async () => {
    const res = await portal({
      costs: [cost(), cost({ iuKey: 'future-key', row: 1 }), cost({ iuKey: '', row: 2 })],
      totals: [{ iuKey: 'future-key', month: '2026-10', totalUsd: 5, fetchedAt: FETCHED }],
    })
    expect(await res.json()).toEqual({ costs: 1, totals: 0, rejected: 3 })
    expect(await db.select().from(iuPortalTotal)).toHaveLength(0)
  })

  it('computes budget and reconcile from the requested key only', async () => {
    await portal({
      costs: [
        cost({ day: '2026-10-26', costUsd: 100 }),
        cost({ iuKey: 'athena-team', day: '2026-10-25', costUsd: 40, label: 'Team' }),
      ],
      totals: [],
    })
    type Budget = {
      iuKey: string
      rolling30Usd: number
      windowTo: string
      fetchedAt: string | null
    }
    const personal = await getJson<Budget>('/iu-budget')
    expect(personal).toMatchObject({ iuKey: 'personal', rolling30Usd: 100, windowTo: '2026-10-26' })
    expect(await getJson<Budget>('/iu-budget?iuKey=personal')).toEqual(personal)

    const team = await getJson<Budget & { canSpendTodayUsd: number }>(
      '/iu-budget?iuKey=athena-team',
    )
    expect(team).toMatchObject({ iuKey: 'athena-team', rolling30Usd: 40, windowTo: '2026-10-25' })
    expect(team.canSpendTodayUsd).toBe(500)

    const empty = await app.handle(new Request('http://localhost/usage/iu-budget?iuKey=all'))
    expect(empty.status).toBe(422)

    type Rec = {
      iuKey: string
      days: Array<{ day: string; portalUsd: number; trackedUsd: number }>
      windowTotals: { portalUsd: number; trackedUsd: number }
    }
    await ingest([
      payload('r1', { ts: '2026-10-26T10:00:00Z', cost_usd: 25, model_norm: 'm-a' }),
      payload('r2', { ts: '2026-10-25T11:00:00Z', cost_usd: 30, iu_key: 'athena-team' }),
    ])
    const rt = await getJson<Rec>('/iu-reconcile?iuKey=athena-team&days=3')
    expect(rt.iuKey).toBe('athena-team')
    expect(rt.windowTotals).toEqual({ portalUsd: 40, trackedUsd: 30 })
    const rp = await getJson<Rec>('/iu-reconcile?days=3')
    expect(rp.iuKey).toBe('personal')
    expect(rp.windowTotals).toEqual({ portalUsd: 100, trackedUsd: 25 })
  })
})

describe('athena-teamchat rows without a model', () => {
  it('shows a reported-cost row with model null in split, flow and reconcile for athena-team', async () => {
    const ts = '2026-10-26T09:00:00.000Z'
    await ingest([
      payload('t1', {
        source: TEAMCHAT,
        ts,
        model: null,
        model_norm: null,
        sub_tool: 'chat-turn:chat',
        cost_usd: 3.25,
        cost_source: 'reported',
        raw: { iuKey: 'athena-team' },
        iu_key: 'athena-team',
      }),
    ])
    const [stored] = await db.select().from(usageRecord).where(eq(usageRecord.source_id, 't1'))
    expect(stored).toMatchObject({ iu_key: 'athena-team', cost_usd: 3.25, cost_source: 'reported' })

    // 'all' reaches back to the data floor; the fixture instant sits inside it.
    const split = await getJson<{
      totals: Array<{ payer: string; cost: number }>
      rows: Array<{ key: string; cost: number }>
    }>('/split?by=model_norm&range=all&iuKey=athena-team')
    expect(split.rows).toEqual([expect.objectContaining({ key: '(unknown model)', cost: 3.25 })])
    expect(split.totals).toEqual([expect.objectContaining({ payer: 'iu-team-api', cost: 3.25 })])

    const flow = await getJson<{
      total: number
      rows: Array<{ source: string; subTool: string; model: string; cost: number }>
    }>('/flow?range=all&iuKey=athena-team')
    expect(flow.total).toBe(3.25)
    expect(flow.rows).toEqual([
      expect.objectContaining({
        source: TEAMCHAT,
        subTool: 'chat-turn:chat',
        model: '(unknown model)',
        cost: 3.25,
      }),
    ])

    await post('/iu-portal', {
      costs: [
        {
          iuKey: 'athena-team',
          day: '2026-10-26',
          label: 'Claude Opus',
          row: 0,
          model: 'claude-opus',
          costUsd: 5,
          fetchedAt: FETCHED,
        },
      ],
      totals: [],
    })
    const rec = await getJson<{
      windowTotals: { portalUsd: number; trackedUsd: number }
      models: Array<{ label: string; portalUsd: number; trackedUsd: number }>
      days: Array<{ day: string; trackedUsd: number }>
    }>('/iu-reconcile?iuKey=athena-team&days=2')
    expect(rec.windowTotals).toEqual({ portalUsd: 5, trackedUsd: 3.25 })
    expect(rec.days.find((d) => d.day === '2026-10-26')?.trackedUsd).toBe(3.25)
    // Tracked without a model stays one-sided next to the portal's model.
    expect(rec.models).toEqual([
      { label: 'claude-opus', portalUsd: 5, trackedUsd: 0 },
      { label: '(unknown model)', portalUsd: 0, trackedUsd: 3.25 },
    ])
    // And it is invisible to the personal key.
    const personal = await getJson<{ windowTotals: { trackedUsd: number } }>('/iu-reconcile?days=2')
    expect(personal.windowTotals.trackedUsd).toBe(0)
  })
})
