import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { runMigrations } from '../db/index.js'
import { deleteAllUsageRecords, seedUsageRecords, type SeedRecord } from '../test/usage-seed.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const get = async <T>(path: string) =>
  (await (await app.handle(new Request(`http://localhost/usage${path}`))).json()) as T

let seq = 0
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

function row(over: Partial<SeedRecord>) {
  seq += 1
  const ts = over.ts ?? ago(1)
  return {
    source: 'agent-gateway-iu',
    source_id: `flow-${seq}`,
    grain: 'event',
    ts,
    billing: 'iu',
    iu_key: 'personal',
    ingested_at: ts,
    ...over,
  } satisfies SeedRecord
}

beforeEach(async () => {
  await deleteAllUsageRecords()
})
afterAll(async () => {
  await deleteAllUsageRecords()
})

interface Flow {
  total: number
  rows: Array<{
    source: string
    subTool: string
    model: string
    cost: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
    calls: number
  }>
}

describe('GET /usage/flow', () => {
  const seed = () =>
    seedUsageRecords([
      row({
        sub_tool: 'review_ocr',
        model_norm: 'deepseek-v4.1-flash',
        cost_usd: 5,
        input_tokens: 10,
        output_tokens: 20,
        cache_read_tokens: 1000,
      }),
      row({
        sub_tool: 'review_ocr',
        model_norm: 'deepseek-v4.1-flash',
        cost_usd: 3,
        input_tokens: 5,
        cache_read_tokens: 500,
        reasoning_tokens: 7,
      }),
      row({
        sub_tool: 'review:adversary',
        model_norm: 'gpt-5.6-terra',
        cost_usd: 6,
        input_tokens: 300,
      }),
      row({ sub_tool: null, model_norm: null, cost_usd: 1 }),
      row({
        billing: 'max',
        account: 'iu',
        source: 'claude-code',
        cost_usd: 900,
        sub_tool: 'interactive',
      }),
    ])

  it('aggregates per source, tool and model with the token classes split', async () => {
    await seed()
    const f = await get<Flow>('/flow?payer=iu-api')
    expect(f.total).toBe(15)
    expect(f.rows[0]).toMatchObject({
      subTool: 'review_ocr',
      model: 'deepseek-v4.1-flash',
      cost: 8,
      input: 15,
      output: 20,
      cacheRead: 1500,
      reasoning: 7,
      calls: 2,
    })
    // A record always has a lane, so a row without a tool reads as interactive.
    expect(f.rows.map((r) => r.subTool)).toEqual(['review_ocr', 'review:adversary', 'interactive'])
    expect(f.rows[2]?.model).toBe('(unknown model)')
  })

  it('ranks the tokens lens by every class, cache-read included', async () => {
    await seed()
    const f = await get<Flow>('/flow?payer=iu-api&lens=tokens')
    expect(f.rows[0]?.subTool).toBe('review_ocr')
    expect(f.total).toBe(15 + 20 + 1500 + 7 + 300)
  })

  it('folds the tail into one other row that keeps the totals whole', async () => {
    await seed()
    const f = await get<Flow>('/flow?payer=iu-api&top=2')
    expect(f.rows).toHaveLength(2)
    expect(f.rows[1]).toMatchObject({ source: 'other', subTool: 'other', cost: 7, calls: 2 })
    expect(f.rows.reduce((s, r) => s + r.cost, 0)).toBe(f.total)
  })

  it('is empty for an empty scope', async () => {
    expect(await get<Flow>('/flow')).toEqual({ total: 0, rows: [] })
  })
})

describe('GET /usage/movers', () => {
  const seed = () =>
    seedUsageRecords([
      row({ sub_tool: 'review_ocr', model_norm: 'm-a', cost_usd: 30, ts: ago(2) }),
      row({ sub_tool: 'review_ocr', model_norm: 'm-a', cost_usd: 10, ts: ago(9) }),
      row({ sub_tool: 'research', model_norm: 'm-b', cost_usd: 1, ts: ago(2) }),
      row({ sub_tool: 'research', model_norm: 'm-b', cost_usd: 25, ts: ago(10) }),
      row({ sub_tool: 'tiny', model_norm: 'm-c', cost_usd: 1.5, ts: ago(3) }),
      row({
        sub_tool: 'sub',
        model_norm: 'm-d',
        cost_usd: 500,
        billing: 'max',
        account: 'iu',
        ts: ago(2),
      }),
    ])

  it('ranks API pairs by absolute dollar change and drops pairs under $2', async () => {
    await seed()
    const m = await get<{
      rows: Array<{ subTool: string; costUsd: number; priorCostUsd: number; deltaUsd: number }>
    }>('/movers')
    expect(m.rows.map((r) => r.subTool)).toEqual(['research', 'review_ocr'])
    expect(m.rows[0]).toMatchObject({ costUsd: 1, priorCostUsd: 25, deltaUsd: -24 })
    expect(m.rows[1]).toMatchObject({ costUsd: 30, priorCostUsd: 10, deltaUsd: 20 })
  })

  it('counts the team key as API spend by default and narrows by iuKey', async () => {
    await seedUsageRecords([
      row({ sub_tool: 'chat-turn:chat', iu_key: 'athena-team', cost_usd: 40, ts: ago(2) }),
      row({ sub_tool: 'review_ocr', model_norm: 'm-a', cost_usd: 30, ts: ago(2) }),
      row({ sub_tool: 'review_ocr', model_norm: 'm-a', cost_usd: 10, ts: ago(9) }),
      row({ sub_tool: 'review_ocr', model_norm: 'm-a', cost_usd: 5, ts: ago(10) }),
    ])
    const all = await get<{ rows: Array<{ subTool: string; model: string }> }>('/movers')
    expect(all.rows.map((r) => r.subTool)).toEqual(['chat-turn:chat', 'review_ocr'])
    expect(all.rows[0]?.model).toBe('(unknown model)')
    const team = await get<{ rows: Array<{ subTool: string }> }>('/movers?iuKey=athena-team')
    expect(team.rows.map((r) => r.subTool)).toEqual(['chat-turn:chat'])
  })

  it('is empty when nothing moved', async () => {
    const m = await get<{ rows: unknown[] }>('/movers')
    expect(m.rows).toEqual([])
  })
})

describe('GET /usage/timeseries token metrics and top fold', () => {
  const seed = () =>
    seedUsageRecords([
      row({
        model_norm: 'a',
        cost_usd: 9,
        input_tokens: 1,
        output_tokens: 2,
        reasoning_tokens: 3,
        cache_read_tokens: 40,
        cache_write_tokens: 5,
      }),
      row({ model_norm: 'b', cost_usd: 5, input_tokens: 10 }),
      row({ model_norm: 'c', cost_usd: 3, input_tokens: 100 }),
      row({ model_norm: 'd', cost_usd: 1, input_tokens: 1000 }),
    ])
  type Series = { buckets: Array<{ groups: Record<string, number | null> }>; groupKeys: string[] }
  const totalOf = (s: Series, key: string) =>
    s.buckets.reduce((n, b) => n + (b.groups[key] ?? 0), 0)

  it('splits the four token classes; output includes reasoning', async () => {
    await seed()
    const q = (metric: string) =>
      get<Series>(`/timeseries?range=7d&metric=${metric}&groupBy=model_norm&payer=iu-api`)
    expect(totalOf(await q('tokens_input'), 'a')).toBe(1)
    expect(totalOf(await q('tokens_output'), 'a')).toBe(5)
    expect(totalOf(await q('tokens_cache_read'), 'a')).toBe(40)
    expect(totalOf(await q('tokens_cache_write'), 'a')).toBe(5)
  })

  it('keeps the legacy tokens metric free of cache-read', async () => {
    await seed()
    const s = await get<Series>(
      '/timeseries?range=7d&metric=tokens&groupBy=model_norm&payer=iu-api',
    )
    expect(totalOf(s, 'a')).toBe(1 + 2 + 3 + 5)
  })

  it('folds the tail into other with top=N', async () => {
    await seed()
    const s = await get<Series>(
      '/timeseries?range=7d&metric=cost&groupBy=model_norm&payer=iu-api&top=2',
    )
    expect(s.groupKeys).toEqual(['a', 'b', 'other'])
    expect(totalOf(s, 'other')).toBe(4)
    const bucket = s.buckets.find((b) => (b.groups['a'] ?? 0) > 0)
    expect(Object.keys(bucket!.groups).toSorted()).toEqual(['a', 'b', 'other'])
  })

  it('leaves the shape alone when there are no more than N keys', async () => {
    await seed()
    const s = await get<Series>(
      '/timeseries?range=7d&metric=cost&groupBy=model_norm&payer=iu-api&top=9',
    )
    expect(s.groupKeys).toEqual(['a', 'b', 'c', 'd'])
  })
})
