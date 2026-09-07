import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { app } from '../app.js'
import { db } from '../db/index.js'
import { agentNarrative, agentOverviewSnapshot } from '../db/schema.js'

const AUTH = { Authorization: `Bearer ${process.env['API_SECRET']}` }
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' }

const NOW = Date.now()

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  machine: 'mini',
  generatedAt: NOW,
  staleAfterHours: 24,
  summary: { needsYou: 1, working: 2, idle: 0, stale: 0, done: 1, dispatch: 0 },
  projects: [
    {
      name: 'argo',
      cwd: '/Users/x/SourceRoot/argo',
      git: { branch: 'master', dirty: true, ahead: 0, behind: 0, lastCommit: null },
      agents: [
        {
          id: 's1',
          source: 'herdr',
          state: 'needs_you',
          title: 'argo agents page',
          lastActivityAt: NOW - 60_000,
          recommendation: 'answer',
          standing: 'waiting on a permission prompt',
          blocker: null,
          confidence: 'high',
          futureField: { nested: true },
        },
      ],
    },
  ],
  overview: { generatedAt: NOW - 120_000, model: 'claude-haiku', backend: 'iu', ageMs: 120_000 },
  humanQueue: [
    { id: '20260907T100000-1', text: 'run make secrets-seed', cmd: 'make secrets-seed' },
  ],
  warnings: [],
  ...overrides,
})

async function post(path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  )
}

async function get(path: string) {
  return app.handle(new Request(`http://localhost${path}`, { headers: AUTH }))
}

beforeEach(async () => {
  await db.delete(agentOverviewSnapshot)
  await db.delete(agentNarrative)
})
afterEach(async () => {
  await db.delete(agentOverviewSnapshot)
  await db.delete(agentNarrative)
})

describe('/agents/overview', () => {
  it('rejects a missing bearer with 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/agents/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot()),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns latest: null before the first ingest', async () => {
    const res = await get('/agents/overview')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ latest: null })
  })

  it('stores the snapshot verbatim, unknown fields included, and serves it back as latest', async () => {
    const created = await post('/agents/overview', snapshot())
    expect(created.status).toBe(201)
    const { id, receivedAt } = (await created.json()) as { id: number; receivedAt: string }
    expect(typeof id).toBe('number')
    expect(Number.isFinite(Date.parse(receivedAt))).toBe(true)

    const res = await get('/agents/overview')
    const body = (await res.json()) as { latest: Record<string, unknown> }
    expect(body.latest['machine']).toBe('mini')
    expect(body.latest['generatedAt']).toBe(new Date(NOW).toISOString())
    const stored = body.latest['snapshot'] as Record<string, unknown>
    expect(stored['generatedAt']).toBe(NOW)
    expect(stored['machine']).toBeUndefined()
    expect(stored['summary']).toEqual({
      needsYou: 1,
      working: 2,
      idle: 0,
      stale: 0,
      done: 1,
      dispatch: 0,
    })
    const agent = (stored['projects'] as { agents: Record<string, unknown>[] }[])[0]!.agents[0]!
    expect(agent['futureField']).toEqual({ nested: true })
    expect((stored['humanQueue'] as unknown[]).length).toBe(1)
  })

  it('accepts an ISO generatedAt and rejects an unparsable one', async () => {
    const iso = await post('/agents/overview', snapshot({ generatedAt: '2026-09-07T10:00:00Z' }))
    expect(iso.status).toBe(201)
    const bad = await post('/agents/overview', snapshot({ generatedAt: 'yesterday-ish' }))
    expect(bad.status).toBe(400)
    const outOfRange = await post('/agents/overview', snapshot({ generatedAt: 1e20 }))
    expect(outOfRange.status).toBe(400)
  })

  it('rejects a snapshot over 1 MB with 413', async () => {
    const res = await post('/agents/overview', snapshot({ warnings: ['x'.repeat(1_000_001)] }))
    expect(res.status).toBe(413)
    expect(await db.select().from(agentOverviewSnapshot)).toHaveLength(0)
  })

  it('rejects a snapshot with no machine', async () => {
    const { machine: _machine, ...noMachine } = snapshot()
    const res = await post('/agents/overview', noMachine)
    expect(res.status).toBe(422)
  })

  it('keeps the latest per machine and pins one with ?machine=', async () => {
    await post('/agents/overview', snapshot({ machine: 'mini' }))
    await post('/agents/overview', snapshot({ machine: 'iumac' }))

    const latest = (await (await get('/agents/overview')).json()) as { latest: { machine: string } }
    expect(latest.latest.machine).toBe('iumac')
    const pinned = (await (await get('/agents/overview?machine=mini')).json()) as {
      latest: { machine: string }
    }
    expect(pinned.latest.machine).toBe('mini')
  })

  it('prunes snapshots older than 7 days on ingest', async () => {
    await db.insert(agentOverviewSnapshot).values({
      machine: 'mini',
      generated_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      received_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      raw: { generatedAt: NOW - 9 * 86_400_000 },
    })
    await db.insert(agentOverviewSnapshot).values({
      machine: 'mini',
      generated_at: new Date(NOW - 2 * 86_400_000).toISOString(),
      received_at: new Date(NOW - 2 * 86_400_000).toISOString(),
      raw: { generatedAt: NOW - 2 * 86_400_000 },
    })
    await post('/agents/overview', snapshot())
    const rows = await db.select().from(agentOverviewSnapshot)
    expect(rows.length).toBe(2)
  })

  it("keeps another machine's newest snapshot even when it is older than 7 days", async () => {
    await db.insert(agentOverviewSnapshot).values({
      machine: 'iumac',
      generated_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      received_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      raw: { generatedAt: NOW - 9 * 86_400_000 },
    })
    await post('/agents/overview', snapshot({ machine: 'mini' }))
    const pinned = (await (await get('/agents/overview?machine=iumac')).json()) as {
      latest: { machine: string } | null
    }
    expect(pinned.latest?.machine).toBe('iumac')
  })

  it('serves summary counts over time, oldest first, within the requested window', async () => {
    await db.insert(agentOverviewSnapshot).values({
      machine: 'mini',
      generated_at: new Date(NOW - 30 * 3_600_000).toISOString(),
      received_at: new Date(NOW - 30 * 3_600_000).toISOString(),
      raw: {
        generatedAt: NOW - 30 * 3_600_000,
        summary: { needsYou: 9, working: 0, idle: 0, stale: 0, done: 0, dispatch: 0 },
      },
    })
    await db.insert(agentOverviewSnapshot).values({
      machine: 'mini',
      generated_at: new Date(NOW - 3_600_000).toISOString(),
      received_at: new Date(NOW - 3_600_000).toISOString(),
      raw: { generatedAt: NOW - 3_600_000 },
    })
    await post('/agents/overview', snapshot())

    const day = (await (await get('/agents/overview/history?hours=24')).json()) as {
      data: { summary: { needsYou: number } | null }[]
    }
    expect(day.data.length).toBe(2)
    expect(day.data[0]!.summary).toBeNull()
    expect(day.data[1]!.summary?.needsYou).toBe(1)

    const twoDays = (await (await get('/agents/overview/history?hours=48')).json()) as {
      data: { summary: { needsYou: number } | null }[]
    }
    expect(twoDays.data.length).toBe(3)
    expect(twoDays.data[0]!.summary?.needsYou).toBe(9)

    const tooLong = await get('/agents/overview/history?hours=999')
    expect(tooLong.status).toBe(422)
  })
})

describe('/agents/narratives', () => {
  it('upserts by project and lists most recently revised first', async () => {
    const first = await post('/agents/narratives', {
      project: 'argo',
      summary: 'Building the agents page.',
      revisedAt: NOW - 3_600_000,
      page: 'wiki/agents/argo.md',
    })
    expect(first.status).toBe(200)
    await post('/agents/narratives', {
      project: 'sideclaw',
      summary: 'Overview job shipped.',
      revisedAt: NOW - 7_200_000,
    })
    const replaced = await post('/agents/narratives', {
      project: 'argo',
      summary: 'Agents page shipped.',
      revisedAt: new Date(NOW).toISOString(),
    })
    expect(replaced.status).toBe(200)
    const replacedBody = (await replaced.json()) as { summary: string; page: string | null }
    expect(replacedBody.summary).toBe('Agents page shipped.')
    expect(replacedBody.page).toBeNull()

    const list = (await (await get('/agents/narratives')).json()) as {
      data: { project: string; summary: string }[]
    }
    expect(list.data.map((n) => n.project)).toEqual(['argo', 'sideclaw'])
    expect(list.data[0]!.summary).toBe('Agents page shipped.')
  })

  it('rejects an unparsable or out-of-range revisedAt', async () => {
    const res = await post('/agents/narratives', {
      project: 'argo',
      summary: 'x',
      revisedAt: 'not a date',
    })
    expect(res.status).toBe(400)
    const outOfRange = await post('/agents/narratives', {
      project: 'argo',
      summary: 'x',
      revisedAt: -1e17,
    })
    expect(outOfRange.status).toBe(400)
  })
})
