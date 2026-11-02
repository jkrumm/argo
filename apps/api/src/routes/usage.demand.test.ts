import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { runMigrations } from '../db/index.js'
import { deleteUsageBySource, seedUsageRecords, type SeedRecord } from '../test/usage-seed.js'

// Integration tests for GET /usage/demand. They need the scratch Postgres of `bun test:api`.

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const get = async <T>(path: string) => {
  const res = await app.handle(new Request(`http://localhost/usage${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

interface Demand {
  rows: Array<{
    key: string
    usd: number
    freshTokens: number
    cacheReadTokens: number
    requests: number
    runs: number
    byPurpose: Record<'prod' | 'eval' | 'verify' | 'other', number>
    byPayer: Record<string, number>
  }>
  totals: { usd: number; requests: number }
}
const keys = (d: Demand) => d.rows.map((r) => r.key)
const row = (d: Demand, key: string) => d.rows.find((r) => r.key === key)!

let seq = 0
/** A gateway row: `pool` is the credit pool, or `iu-api` for the IU key. */
function gw(
  over: Partial<SeedRecord> & { pool?: string; detail?: Record<string, unknown> } = {},
): SeedRecord {
  seq += 1
  const { pool = 'iu', detail, ...rest } = over
  const ts = over.ts ?? ago(1)
  return {
    source: 'gateway',
    source_id: `dm-${seq}`,
    ts,
    model: 'claude-sonnet-5-5',
    model_norm: 'claude-sonnet-5-5',
    billing: pool === 'iu-api' ? 'iu' : 'api_credit',
    account: pool === 'iu-api' ? null : pool,
    iu_key: pool === 'iu-api' ? 'personal' : null,
    lane: 'agw_workflow',
    lane_detail: {
      caller: 'agw',
      pool,
      workflow: 'review',
      step: 'synthesis',
      purpose: 'prod',
      ...detail,
    },
    cost_usd: 1,
    ingested_at: ts,
    ...rest,
  }
}

/** One of agent-workflows' own rows: billed to the IU key, its run in the `run_id` column. */
function agw(over: Partial<SeedRecord> & { detail?: Record<string, unknown> } = {}): SeedRecord {
  seq += 1
  const { detail, ...rest } = over
  const ts = over.ts ?? ago(1)
  return {
    source: 'agent-workflows',
    source_id: `dm-agw-${seq}`,
    ts,
    model: 'openai.gpt-6.1-terra',
    model_norm: 'openai.gpt-6.1-terra',
    billing: 'iu',
    iu_key: 'personal',
    lane: 'agw_workflow',
    lane_detail: {
      caller: 'claude-code',
      workflow: 'review',
      step: 'adversary',
      purpose: 'prod',
      ...detail,
    },
    cost_usd: 0.5,
    ingested_at: ts,
    ...rest,
  }
}

async function clean() {
  for (const source of ['gateway', 'agent-workflows', 'claude-code'])
    await deleteUsageBySource(source)
}
beforeEach(clean)
afterAll(clean)

describe('GET /usage/demand grouping', () => {
  beforeEach(async () => {
    await seedUsageRecords([
      gw({
        cost_usd: 3,
        project: 'argo',
        input_tokens: 10,
        output_tokens: 5,
        cache_write_tokens: 3,
        cache_read_tokens: 100,
        detail: { run_id: 'r1', origin: 'claude-code' },
      }),
      gw({
        cost_usd: 2,
        detail: { run_id: 'r1', step: 'route', origin: 'hermes' },
        model_norm: 'claude-haiku-5-5',
      }),
      gw({
        cost_usd: 4,
        detail: { run_id: 'r2', workflow: 'research', step: 'plan', caller: 'agw-opencode' },
      }),
      gw({
        cost_usd: 0.5,
        pool: 'iu-api',
        detail: { workflow: null, step: null, purpose: null, caller: 'oc', run_id: null },
      }),
    ])
  })

  it('groups by workflow, ranked by cost, with tokens, requests and distinct runs', async () => {
    const body = await get<Demand>('/demand?range=7d&by=workflow')
    expect(keys(body)).toEqual(['review', 'research', '(unset)'])
    expect(row(body, 'review')).toMatchObject({
      usd: 5,
      freshTokens: 18,
      cacheReadTokens: 100,
      requests: 2,
      runs: 1,
    })
    expect(body.totals).toEqual({ usd: 9.5, requests: 4 })
  })

  it('groups by step, narrowed to one workflow', async () => {
    const body = await get<Demand>('/demand?range=7d&by=step&workflow=review')
    expect(body.rows.map((r) => [r.key, r.usd])).toEqual([
      ['synthesis', 3],
      ['route', 2],
    ])
  })

  it('groups by model, repo, caller and origin', async () => {
    const model = await get<Demand>('/demand?range=7d&by=model')
    expect(model.rows.map((r) => [r.key, r.usd])).toEqual([
      ['claude-sonnet-5-5', 7.5],
      ['claude-haiku-5-5', 2],
    ])
    const repo = await get<Demand>('/demand?range=7d&by=repo')
    expect(repo.rows.map((r) => [r.key, r.usd])).toEqual([
      ['(unset)', 6.5],
      ['argo', 3],
    ])
    const caller = await get<Demand>('/demand?range=7d&by=caller')
    expect(caller.rows.map((r) => [r.key, r.usd])).toEqual([
      ['agw', 5],
      ['agw-opencode', 4],
      ['oc', 0.5],
    ])
    const origin = await get<Demand>('/demand?range=7d&by=origin')
    expect(origin.rows.map((r) => [r.key, r.usd])).toEqual([
      ['(unknown)', 4.5],
      ['claude-code', 3],
      ['hermes', 2],
    ])
  })

  it('reads an agent-workflows row’s caller as its origin', async () => {
    await seedUsageRecords([
      agw({ model: 'tts-1', model_norm: 'tts-1', detail: { caller: 'iris' }, cost_usd: 9 }),
    ])
    const origin = await get<Demand>('/demand?range=7d&by=origin')
    expect(origin.rows[0]).toMatchObject({ key: 'iris', usd: 9 })
    const caller = await get<Demand>('/demand?range=7d&by=caller')
    expect(row(caller, 'iris').usd).toBe(9)
  })

  it('answers the empty shape without traffic', async () => {
    await clean()
    expect(await get<Demand>('/demand?range=7d&by=origin')).toEqual({
      rows: [],
      totals: { usd: 0, requests: 0 },
    })
  })
})

describe('GET /usage/demand purpose and payer', () => {
  beforeEach(async () => {
    await seedUsageRecords([
      gw({ cost_usd: 1 }),
      gw({ cost_usd: 2, detail: { purpose: 'eval' } }),
      gw({ cost_usd: 4, detail: { purpose: 'verify' } }),
      gw({ cost_usd: 8, detail: { purpose: 'drift' } }),
      gw({ cost_usd: 16, detail: { purpose: null } }),
      gw({ cost_usd: 32, pool: 'me', detail: { purpose: 'eval' } }),
      gw({ cost_usd: 64, pool: 'iu-api' }),
    ])
  })

  it('buckets purposes (drift and absent are other) and splits cost by payer', async () => {
    const body = await get<Demand>('/demand?range=7d&by=workflow')
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0]).toMatchObject({
      key: 'review',
      usd: 127,
      requests: 7,
      byPurpose: { prod: 65, eval: 34, verify: 4, other: 24 },
      byPayer: { 'iu-credit': 31, 'me-credit': 32, 'iu-api': 64 },
    })
  })

  it('filters by purpose[]', async () => {
    const one = await get<Demand>('/demand?range=7d&by=workflow&purpose=eval')
    expect(one.totals).toEqual({ usd: 34, requests: 2 })
    expect(one.rows[0]!.byPurpose).toEqual({ prod: 0, eval: 34, verify: 0, other: 0 })
    const two = await get<Demand>('/demand?range=7d&by=workflow&purpose=verify&purpose=other')
    expect(two.totals).toEqual({ usd: 28, requests: 3 })
  })

  it('filters by payer[]', async () => {
    const body = await get<Demand>('/demand?range=7d&by=workflow&payer=me-credit&payer=iu-api')
    expect(body.totals).toEqual({ usd: 96, requests: 2 })
    expect(Object.keys(body.rows[0]!.byPayer).toSorted()).toEqual(['iu-api', 'me-credit'])
  })

  it('keeps rows out of the window', async () => {
    await seedUsageRecords([gw({ cost_usd: 1000, ts: ago(20) })])
    expect((await get<Demand>('/demand?range=7d')).totals.usd).toBe(127)
    expect((await get<Demand>('/demand?range=30d')).totals.usd).toBe(1127)
  })
})

describe('GET /usage/demand sources', () => {
  it('counts an agent-workflows row the gateway recorded once (Gap 6)', async () => {
    await seedUsageRecords([
      // The gateway's record of the call, then agent-workflows' own record of the same call.
      gw({
        pool: 'iu-api',
        model: 'gpt-6.1-terra',
        model_norm: 'openai.gpt-6.1-terra',
        cost_usd: 0.4,
        detail: { run_id: 'run-a', step: 'adversary' },
      }),
      agw({ run_id: 'run-a', cost_usd: 0.5 }),
      // Same run, the two writers spell the model differently on the other axis.
      gw({
        pool: 'iu-api',
        model: 'deepseek/deepseek-v4.1-flash',
        model_norm: 'deepseek-v4.1-flash',
        cost_usd: 0.01,
        detail: { run_id: 'run-a', step: 'verify' },
      }),
      agw({
        run_id: 'run-a',
        model: 'deepseek/deepseek-v4.1-flash',
        model_norm: 'deepseek/deepseek-v4.1-flash',
        cost_usd: 0.02,
        detail: { step: 'verify' },
      }),
      // A media row of the same run has no gateway twin (another model) and stays;
      // so does a step written before the gateway recorded anything of its run.
      agw({
        run_id: 'run-a',
        model: 'voxtral-mini-transcribe-3-0',
        model_norm: 'voxtral-mini-transcribe-3-0',
        cost_usd: 0.06,
        detail: { step: 'request', workflow: 'door.transcriptions' },
      }),
      agw({ run_id: 'run-old', cost_usd: 0.3 }),
      // Not demand: Claude Code's own rows, Athena's key.
      {
        source: 'claude-code',
        source_id: 'dm-cc',
        ts: ago(1),
        billing: 'max',
        account: 'iu',
        cost_usd: 500,
        ingested_at: ago(1),
      },
      agw({ iu_key: 'athena-team', run_id: 'run-x', cost_usd: 700 }),
      gw({ pool: 'iu-api', iu_key: 'athena-team', cost_usd: 900 }),
    ])
    const body = await get<Demand>('/demand?range=7d&by=workflow')
    expect(body.totals.requests).toBe(4)
    expect(body.totals.usd).toBeCloseTo(0.4 + 0.01 + 0.06 + 0.3, 9)
    expect(body.rows.map((r) => [r.key, r.requests])).toEqual([
      ['review', 3],
      ['door.transcriptions', 1],
    ])
  })

  it('does not drop an agent-workflows row for a gateway row of another run or model', async () => {
    await seedUsageRecords([
      gw({
        pool: 'iu-api',
        model: 'gpt-6.1-terra',
        model_norm: 'openai.gpt-6.1-terra',
        detail: { run_id: 'run-1' },
      }),
      agw({ run_id: 'run-2' }),
      agw({ run_id: 'run-1', model: 'claude-opus-5-5', model_norm: 'claude-opus-5-5' }),
    ])
    expect((await get<Demand>('/demand?range=7d')).totals.requests).toBe(3)
  })

  it('drops only the step the gateway recorded when a run has two on the same model', async () => {
    await seedUsageRecords([
      gw({
        pool: 'iu-api',
        model: 'gpt-6.1-terra',
        model_norm: 'openai.gpt-6.1-terra',
        cost_usd: 0.4,
        detail: { run_id: 'run-s', step: 'adversary' },
      }),
      agw({ run_id: 'run-s', cost_usd: 0.5, detail: { step: 'adversary' } }),
      // Same run, same model, a step the gateway has no row for: not a twin.
      agw({ run_id: 'run-s', cost_usd: 0.25, detail: { step: 'synthesis' } }),
    ])
    const body = await get<Demand>('/demand?range=7d&by=step')
    expect(body.rows.map((r) => [r.key, r.usd, r.requests])).toEqual([
      ['adversary', 0.4, 1],
      ['synthesis', 0.25, 1],
    ])
  })

  it('reads twins only within the range widened by a day', async () => {
    await seedUsageRecords([
      // The gateway row is 20 days old: out of reach of a 7 d call, so the agw row of the same run stays.
      gw({
        pool: 'iu-api',
        model: 'gpt-6.1-terra',
        model_norm: 'openai.gpt-6.1-terra',
        ts: ago(20),
        detail: { run_id: 'run-far', step: 'adversary' },
      }),
      agw({ run_id: 'run-far', cost_usd: 0.5 }),
    ])
    expect((await get<Demand>('/demand?range=7d')).totals).toEqual({ usd: 0.5, requests: 1 })
  })
})

describe('GET /usage/demand top', () => {
  it('folds the tail into (other), keeps (unset) and leaves totals whole', async () => {
    await seedUsageRecords([
      gw({ cost_usd: 8, detail: { workflow: 'w1', run_id: 'r1' } }),
      gw({ cost_usd: 4, detail: { workflow: 'w2', run_id: 'r2' } }),
      gw({ cost_usd: 2, detail: { workflow: 'w3', run_id: 'r3' } }),
      gw({ cost_usd: 1, detail: { workflow: 'w4', run_id: 'r3' }, pool: 'me' }),
      gw({ cost_usd: 0.5, detail: { workflow: 'w5', run_id: 'r5', purpose: 'eval' } }),
      gw({ cost_usd: 0.25, detail: { workflow: null, run_id: null } }),
    ])
    const full = await get<Demand>('/demand?range=7d&by=workflow')
    expect(keys(full)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', '(unset)'])

    const body = await get<Demand>('/demand?range=7d&by=workflow&top=3')
    expect(keys(body)).toEqual(['w1', 'w2', '(unset)', '(other)'])
    expect(row(body, '(other)')).toMatchObject({
      usd: 3.5,
      requests: 3,
      // r3 spans w3 and w4: one run, not two.
      runs: 2,
      byPurpose: { prod: 3, eval: 0.5, verify: 0, other: 0 },
      byPayer: { 'iu-credit': 2.5, 'me-credit': 1 },
    })
    expect(body.totals).toEqual(full.totals)
    expect(body.totals.usd).toBe(15.75)
  })
})
