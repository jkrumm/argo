import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { app } from '../app.js'
import { db } from '../db/index.js'
import { wardenSnapshot } from '../db/schema.js'

const REAL_SNAPSHOT_PATH = '/tmp/warden-snapshot.json'

const AUTH = { Authorization: `Bearer ${process.env['API_SECRET']}` }
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' }

const NOW = Date.now()

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  machine: 'mini',
  generatedAt: NOW,
  health: {
    ok: true,
    schema_version: 8,
    schema_version_expected: 8,
    pollers: {
      'warden-loop': { age_minutes: 3.1, ok: true },
    },
    checked_at: new Date(NOW).toISOString(),
  },
  metrics: {
    generated_at: new Date(NOW).toISOString(),
    window_days: 7,
    history_since: null,
    verdicts_recorded_disposition: {
      value: 0.72,
      unavailable: null,
      numerator: 13,
      denominator: 18,
    },
    median_needs_human_to_decision_hours: {
      value: null,
      unavailable: 'window start predates history_since',
    },
  },
  board: {
    generated_at: new Date(NOW).toISOString(),
    schema_version: 8,
    counts: { new: 0, needs_human: 8, merge_blocked: 4 },
    items: [
      {
        event_id: 986,
        origin: 'github_issue',
        repo: 'argo',
        state: 'needs_human',
        title: 'flaky test',
        occurrences: 3,
        futureField: { nested: true },
      },
    ],
    terminal_24h: 47,
  },
  budget: {
    usedToday: 15,
    max: 20,
    remaining: 5,
    implementToday: 4,
    implementMax: 5,
    implementRemaining: 1,
    warnings: [],
  },
  items: {
    '986': {
      item: { event_id: 986, brief: 'x' },
      event: { id: 986 },
      dispatches: [],
      operations: [],
      approvals: [],
      transitions: [],
    },
  },
  itemsTruncated: false,
  intents: { pending: 0, rejected: 2, entries: [] },
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
  await db.delete(wardenSnapshot)
})
afterEach(async () => {
  await db.delete(wardenSnapshot)
})

describe('/warden/snapshot', () => {
  it('rejects a missing bearer with 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/warden/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot()),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 before the first ingest', async () => {
    const res = await get('/warden/snapshot')
    expect(res.status).toBe(404)
  })

  it('accepts an ISO generatedAt and rejects an unparsable or out-of-range one', async () => {
    const iso = await post('/warden/snapshot', snapshot({ generatedAt: '2026-09-11T00:00:00Z' }))
    expect(iso.status).toBe(201)
    const bad = await post('/warden/snapshot', snapshot({ generatedAt: 'not-a-date' }))
    expect(bad.status).toBe(400)
    const outOfRange = await post('/warden/snapshot', snapshot({ generatedAt: 1e20 }))
    expect(outOfRange.status).toBe(400)
  })

  it('rejects a snapshot over 1 MB with 413', async () => {
    const res = await post(
      '/warden/snapshot',
      snapshot({ intents: { pending: 0, rejected: 0, entries: [], huge: 'x'.repeat(1_000_001) } }),
    )
    expect(res.status).toBe(413)
    expect(await db.select().from(wardenSnapshot)).toHaveLength(0)
  })

  it('stores the snapshot verbatim, unknown fields included, and reads it back', async () => {
    const created = await post('/warden/snapshot', snapshot())
    expect(created.status).toBe(201)
    const { id, receivedAt } = (await created.json()) as { id: number; receivedAt: string }
    expect(typeof id).toBe('number')
    expect(Number.isFinite(Date.parse(receivedAt))).toBe(true)

    const res = await get('/warden/snapshot')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      machine: string
      generatedAt: string
      ageMs: number
      raw: Record<string, unknown>
    }
    expect(body.machine).toBe('mini')
    expect(body.generatedAt).toBe(new Date(NOW).toISOString())
    expect(typeof body.ageMs).toBe('number')
    expect(body.raw['machine']).toBeUndefined()
    const board = body.raw['board'] as { items: Record<string, unknown>[] }
    expect(board.items[0]!['futureField']).toEqual({ nested: true })
  })

  it('keeps a pushed ISO generatedAt unchanged in raw, never rewritten to epoch ms', async () => {
    const iso = '2026-09-11T00:00:00.000Z'
    const created = await post('/warden/snapshot', snapshot({ generatedAt: iso }))
    expect(created.status).toBe(201)

    const res = await get('/warden/snapshot')
    const body = (await res.json()) as { raw: Record<string, unknown> }
    expect(body.raw['generatedAt']).toBe(iso)
  })

  it('rejects a snapshot with no machine', async () => {
    const { machine: _machine, ...noMachine } = snapshot()
    const res = await post('/warden/snapshot', noMachine)
    expect(res.status).toBe(422)
  })

  it('keeps the latest per machine and pins one with ?machine=', async () => {
    await post('/warden/snapshot', snapshot({ machine: 'mini' }))
    await post('/warden/snapshot', snapshot({ machine: 'iumac' }))

    const latest = (await (await get('/warden/snapshot')).json()) as { machine: string }
    expect(latest.machine).toBe('iumac')
    const pinned = (await (await get('/warden/snapshot?machine=mini')).json()) as {
      machine: string
    }
    expect(pinned.machine).toBe('mini')
  })

  it('prunes snapshots older than 7 days on ingest, keeping the newest per machine', async () => {
    await db.insert(wardenSnapshot).values({
      machine: 'mini',
      generated_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      received_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      raw: { generatedAt: NOW - 9 * 86_400_000 },
    })
    await db.insert(wardenSnapshot).values({
      machine: 'mini',
      generated_at: new Date(NOW - 2 * 86_400_000).toISOString(),
      received_at: new Date(NOW - 2 * 86_400_000).toISOString(),
      raw: { generatedAt: NOW - 2 * 86_400_000 },
    })
    await post('/warden/snapshot', snapshot())
    const rows = await db.select().from(wardenSnapshot)
    expect(rows.length).toBe(2)
  })

  it('accepts the composite reverts_and_reopens metric (no top-level value/unavailable)', async () => {
    const res = await post(
      '/warden/snapshot',
      snapshot({
        metrics: {
          reverts_and_reopens: {
            reopen_after_fixed: {
              value: null,
              unavailable: 'window start predates history_since',
              windowed: true,
              window_days: 7,
            },
            reverts: { value: 0, unavailable: null, windowed: true, window_days: 7 },
          },
        },
      }),
    )
    expect(res.status).toBe(201)
  })

  it('accepts the real producer snapshot verbatim', async () => {
    if (!existsSync(REAL_SNAPSHOT_PATH)) {
      console.warn(`skipping: ${REAL_SNAPSHOT_PATH} not present on this host`)
      return
    }
    const real = JSON.parse(readFileSync(REAL_SNAPSHOT_PATH, 'utf8')) as Record<string, unknown>
    const created = await post('/warden/snapshot', real)
    expect(created.status).toBe(201)

    const res = await get(`/warden/snapshot?machine=${real['machine']}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { raw: Record<string, unknown> }
    expect(body.raw['generatedAt']).toBe(real['generatedAt'])
  })

  it("keeps another machine's newest snapshot even when it is older than 7 days", async () => {
    await db.insert(wardenSnapshot).values({
      machine: 'iumac',
      generated_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      received_at: new Date(NOW - 9 * 86_400_000).toISOString(),
      raw: { generatedAt: NOW - 9 * 86_400_000 },
    })
    await post('/warden/snapshot', snapshot({ machine: 'mini' }))
    const pinned = (await (await get('/warden/snapshot?machine=iumac')).json()) as {
      machine: string
    }
    expect(pinned.machine).toBe('iumac')
  })
})
