import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { app } from '../app.js'
import { runMigrations } from '../db/index.js'
import { deleteUsageBySource, seedUsageRecords, type SeedRecord } from '../test/usage-seed.js'
import { weekStartOf } from '../lib/agent-kpis.js'

// Integration tests for GET /agents/kpis/usage. They need the scratch Postgres of `bun test:api`.

beforeAll(async () => {
  await runMigrations()
})

const SOURCE = 'agent-kpis-test'
afterEach(async () => {
  await deleteUsageBySource(SOURCE)
})

const AUTH = { Authorization: `Bearer ${process.env['API_SECRET']}` }
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

interface Kpis {
  since: string
  weeks: number
  generatedAt: string
  costBasis: string
  subagents: Array<{
    kind: string
    name: string
    runs: number
    requests: number
    costUsd: number
    avgCostUsd: number
  }>
  byWeek: Array<{ weekStart: string; kind: string; name: string; runs: number; costUsd: number }>
  issues: Array<{
    issueId: string
    repo: string | null
    firstTs: string
    lastTs: string
    runs: number
    requests: number
    costUsd: number
    lanes: Array<{ lane: string; name: string; runs: number; requests: number; costUsd: number }>
  }>
}

async function kpis(query = ''): Promise<Kpis> {
  const res = await app.handle(
    new Request(`http://localhost/agents/kpis/usage${query}`, { headers: AUTH }),
  )
  expect(res.status).toBe(200)
  return (await res.json()) as Kpis
}

let seq = 0
function rec(over: Partial<SeedRecord>): SeedRecord {
  seq += 1
  return {
    source: SOURCE,
    source_id: `kpi-${seq}`,
    ts: ago(0.2),
    billing: 'max',
    account: 'me',
    cost_usd: 1,
    ...over,
  }
}

const fixtures = (): SeedRecord[] => [
  rec({ lane: 'lead', session: 'lead-230', issue_id: '230', project: 'argo', cost_usd: 4 }),
  rec({ lane: 'lead', session: 'lead-230', issue_id: '230', project: 'argo', cost_usd: 2 }),
  rec({
    lane: 'subagent',
    lane_detail: { subagent_type: 'Explore' },
    session: 'sub-1',
    issue_id: '230',
    project: 'argo',
    cost_usd: 1,
  }),
  rec({
    lane: 'subagent',
    lane_detail: { subagent_type: 'Explore' },
    session: 'sub-1',
    issue_id: '230',
    project: 'argo',
    cost_usd: 1,
  }),
  rec({ lane: 'subagent', session: 'sub-2', issue_id: '230', project: 'other', cost_usd: 0.5 }),
  rec({
    lane: 'worker',
    lane_detail: { role: 'reviewer' },
    session: 'w-1',
    issue_id: '231',
    project: 'agent-workflows',
    cost_usd: 3,
    ts: ago(0.1),
  }),
  rec({ lane: 'worker', session: 'w-2', cost_usd: 1 }),
  rec({ lane: 'interactive', session: 'chat', cost_usd: 9 }),
  // outside the default window
  rec({
    lane: 'subagent',
    lane_detail: { subagent_type: 'Old' },
    session: 'sub-old',
    issue_id: '99',
    ts: ago(200),
    cost_usd: 7,
  }),
  // inside 26 weeks, outside 8
  rec({
    lane: 'subagent',
    lane_detail: { subagent_type: 'Mid' },
    session: 'sub-mid',
    ts: ago(100),
    cost_usd: 7,
  }),
]

describe('GET /agents/kpis/usage', () => {
  it('rejects a missing bearer with 401', async () => {
    const res = await app.handle(new Request('http://localhost/agents/kpis/usage'))
    expect(res.status).toBe(401)
  })

  it('rejects weeks outside 1..26', async () => {
    for (const weeks of ['0', '27', 'x']) {
      const res = await app.handle(
        new Request(`http://localhost/agents/kpis/usage?weeks=${weeks}`, { headers: AUTH }),
      )
      expect(res.status).toBe(422)
    }
  })

  it('groups subagents and workers by name, with distinct sessions as runs', async () => {
    await seedUsageRecords(fixtures())
    const body = await kpis()
    expect(body.weeks).toBe(8)
    expect(body.costBasis).toContain('list value')
    expect(body.subagents.map((r) => `${r.kind}:${r.name}`)).toEqual([
      'worker:reviewer',
      'subagent:Explore',
      'worker:worker',
      'subagent:unknown',
    ])
    const explore = body.subagents.find((r) => r.name === 'Explore')!
    expect(explore).toMatchObject({ runs: 1, requests: 2, costUsd: 2, avgCostUsd: 2 })
    expect(body.subagents.find((r) => r.name === 'Old')).toBeUndefined()
    expect(body.subagents.find((r) => r.name === 'Mid')).toBeUndefined()
    expect(body.byWeek.every((r) => r.weekStart <= weekStartOf(new Date()))).toBe(true)
  })

  it('widens the window with ?weeks= and echoes since as a Monday', async () => {
    await seedUsageRecords(fixtures())
    const one = await kpis('?weeks=1')
    expect(one.weeks).toBe(1)
    expect(new Date(one.since).getUTCDay()).toBe(1)
    expect(one.since.endsWith('T00:00:00.000Z')).toBe(true)
    const wide = await kpis('?weeks=26')
    expect(wide.subagents.map((r) => r.name)).toContain('Mid')
    expect(wide.subagents.map((r) => r.name)).not.toContain('Old')
  })

  it('folds an Issue across lanes, newest first, with its top-cost repo', async () => {
    await seedUsageRecords(fixtures())
    const body = await kpis()
    expect(body.issues.map((i) => i.issueId)).toEqual(['231', '230'])
    const issue = body.issues.find((i) => i.issueId === '230')!
    expect(issue).toMatchObject({ repo: 'argo', runs: 3, requests: 5, costUsd: 8.5 })
    expect(issue.lanes.map((l) => `${l.lane}:${l.name}`)).toEqual([
      'lead:lead',
      'subagent:Explore',
      'subagent:unknown',
    ])
    expect(issue.lanes[0]).toMatchObject({ runs: 1, requests: 2, costUsd: 6 })
    expect(new Date(issue.lastTs).getTime()).toBeGreaterThanOrEqual(
      new Date(issue.firstTs).getTime(),
    )
  })
})
