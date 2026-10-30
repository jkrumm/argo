import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db, runMigrations } from './index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import {
  deleteUsageBySource,
  markUsageDuplicate,
  seedUsageRecords,
  type SeedRecord,
} from '../test/usage-seed.js'

// The contract of the read model itself: `usage.records_unique` projected onto the column names the
// usage queries speak (see the header of lib/usage-source.ts). Needs the usage schema, so it runs
// in the scratch database of `bun test:api`, not in CI.

beforeAll(async () => {
  await runMigrations()
})

const SOURCE = 'projection-test'
afterEach(async () => {
  await deleteUsageBySource(SOURCE)
})

const base = (id: string, over: Partial<SeedRecord> = {}): SeedRecord => ({
  source: SOURCE,
  source_id: id,
  ts: new Date().toISOString(),
  billing: 'max',
  ...over,
})

type Projected = {
  source_id: string
  model: string | null
  model_norm: string | null
  project: string | null
  sub_tool: string
  billing: string
  account: string | null
  iu_key: string | null
  cache_write_tokens: string | number
  cost_usd: number | null
}

async function project(): Promise<Record<string, Projected>> {
  const rows = (await db.execute(
    sql`SELECT source_id, model, model_norm, project, sub_tool, billing, account, iu_key, cache_write_tokens, cost_usd
        FROM ${USAGE_ROWS} WHERE source = ${SOURCE}`,
  )) as unknown as Projected[]
  return Object.fromEntries(rows.map((r) => [r.source_id, r]))
}

describe('USAGE_ROWS projection', () => {
  it('maps billing: api_key with a key is iu, without one openrouter, max and unknown as stored', async () => {
    await seedUsageRecords([
      base('max', { account: 'me' }),
      base('iu', { billing: 'iu', iu_key: 'athena-team' }),
      base('or', { billing: 'openrouter' }),
      base('unk', { billing: 'unknown' }),
    ])
    const r = await project()
    expect(r['max']).toMatchObject({ billing: 'max', account: 'me', iu_key: null })
    expect(r['iu']).toMatchObject({ billing: 'iu', iu_key: 'athena-team' })
    expect(r['or']).toMatchObject({ billing: 'openrouter', iu_key: null })
    expect(r['unk']).toMatchObject({ billing: 'unknown', iu_key: null })
  })

  it('maps the lane to the tool label', async () => {
    await seedUsageRecords([
      base('step', { sub_tool: 'review:adversary' }),
      base('deep-step', { sub_tool: 'agent-gateway:chat:turn' }),
      base('nostep', { lane: 'agw_workflow', lane_detail: { workflow: 'research-gateway' } }),
      base('bare-agw', { lane: 'agw_workflow' }),
      base('sub', { lane: 'subagent', lane_detail: { subagent_type: 'Explore' } }),
      base('bare-sub', { lane: 'subagent' }),
      base('other', { sub_tool: 'headless' }),
      base('inter', { sub_tool: 'interactive' }),
      base('worker', { sub_tool: 'fan_worker' }),
      base('none', { sub_tool: null }),
    ])
    const r = await project()
    expect(Object.fromEntries(Object.entries(r).map(([id, row]) => [id, row.sub_tool]))).toEqual({
      step: 'review:adversary',
      'deep-step': 'agent-gateway:chat:turn',
      nostep: 'research-gateway',
      'bare-agw': 'agw_workflow',
      sub: 'Explore',
      'bare-sub': 'subagent',
      other: 'headless',
      inter: 'interactive',
      worker: 'fan_worker',
      none: 'interactive',
    })
  })

  it('takes the project from repo (iu/ prefix dropped), then a bare project_raw, never a path', async () => {
    await seedUsageRecords([
      base('repo', { repo: 'argo', project_raw: '/Users/x/SourceRoot/argo/apps/api' }),
      base('iu-repo', { repo: 'iu/portal', project_raw: '/Users/x/IuRoot/portal' }),
      base('bare', { repo: null, project_raw: 'hermes-agent' }),
      base('path', { repo: null, project_raw: '/tmp/scratch/foo' }),
      base('rel-path', { repo: null, project_raw: 'a/b' }),
      base('empty', { repo: null, project_raw: '' }),
      base('nothing', { repo: null, project_raw: null }),
    ])
    const r = await project()
    expect(Object.fromEntries(Object.entries(r).map(([id, row]) => [id, row.project]))).toEqual({
      repo: 'argo',
      'iu-repo': 'portal',
      bare: 'hermes-agent',
      path: null,
      'rel-path': null,
      empty: null,
      nothing: null,
    })
  })

  it('renames the model columns, sums both cache writes and returns the cost as a number', async () => {
    await seedUsageRecords([
      base('tok', {
        model: 'Claude-Sonnet-5[1m]',
        model_norm: 'claude-sonnet-5',
        cache_write_tokens: 100,
        cache_write_1h_tokens: 20,
        cost_usd: 1.23,
        cost_source: 'prices',
      }),
    ])
    const row = (await project())['tok']
    expect(row).toMatchObject({ model: 'Claude-Sonnet-5[1m]', model_norm: 'claude-sonnet-5' })
    expect(Number(row?.cache_write_tokens)).toBe(120)
    expect(row?.cost_usd).toBe(1.23)
  })

  it('leaves out the rows marked as duplicates', async () => {
    const [kept, copy, other] = await seedUsageRecords([
      base('kept', { source_id: 'kept', cost_usd: 2 }),
      base('copy', { cost_usd: 2 }),
      base('other', { cost_usd: 3 }),
    ])
    await markUsageDuplicate(copy as number, kept as number)
    expect(other).toBeDefined()
    expect(Object.keys(await project()).toSorted()).toEqual(['kept', 'other'])
  })
})
