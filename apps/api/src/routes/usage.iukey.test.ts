import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { runMigrations } from '../db/index.js'
import {
  deleteAllUsageRecords,
  deleteIuPortal,
  seedIuPortal,
  seedUsageRecords,
  type SeedRecord,
} from '../test/usage-seed.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const SOURCE = 'iukey-test'
const TEAMCHAT = 'athena-teamchat'
const FETCHED = '2026-10-26T12:00:00.000Z'

type Over = Partial<SeedRecord>

// An iu row without an explicit key is the personal key.
function payload(sourceId: string, over: Over = {}): SeedRecord {
  const billing = over.billing ?? 'iu'
  return {
    source: SOURCE,
    source_id: sourceId,
    ts: new Date().toISOString(),
    machine: 'm1',
    billing,
    iu_key: billing === 'iu' ? 'personal' : null,
    cost_usd: 1,
    ...over,
  }
}

const ingest = (records: SeedRecord[]) => seedUsageRecords(records)
async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost/usage${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

type Rows = { total: number; rows: Array<{ key: string; value: number }> }

const clean = async () => {
  await deleteAllUsageRecords()
  await deleteIuPortal()
}
beforeEach(clean)
afterAll(clean)

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

  it('groups by iu_key; non-iu rows bucket as (unset)', async () => {
    await seed()
    const grouped = await getJson<Rows>(
      `/breakdown?range=7d&metric=cost&dimension=iu_key&sources=${SOURCE}`,
    )
    expect(Object.fromEntries(grouped.rows.map((r) => [r.key, r.value]))).toEqual({
      personal: 3,
      'athena-team': 4,
      '(unset)': 8,
    })
    const series = await getJson<{ groupKeys: string[] }>(
      `/timeseries?range=7d&metric=cost&groupBy=iu_key&sources=${SOURCE}`,
    )
    expect(series.groupKeys.toSorted()).toEqual(['(unset)', 'athena-team', 'personal'])
  })
})

describe('iu-budget and iu-reconcile per iuKey', () => {
  const cost = (over: { costUsd?: number; day?: string; iuKey?: string; label?: string } = {}) => ({
    iu_key: over.iuKey ?? 'personal',
    day: over.day ?? '2026-10-26',
    label: over.label ?? 'GPT 5.6 Terra',
    row: 0,
    model: 'gpt-5.6-terra',
    cost_usd: over.costUsd ?? 10,
    fetched_at: FETCHED,
  })
  const portal = (body: { costs: ReturnType<typeof cost>[]; totals: [] }) => seedIuPortal(body)

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

    await seedIuPortal({
      costs: [
        {
          iu_key: 'athena-team',
          day: '2026-10-26',
          label: 'Claude Opus',
          row: 0,
          model: 'claude-opus',
          cost_usd: 5,
          fetched_at: FETCHED,
        },
      ],
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
