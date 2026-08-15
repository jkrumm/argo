import { beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { MarineReading, MarineUpstreams, WindReading } from '../clients/marine-upstreams.js'
import { authGuard } from '../lib/auth-guard.js'
import { clearMarineSummaryCache, createMarineRoutes, type MarineRouteDeps } from './marine.js'

const SECRET = process.env['API_SECRET'] ?? 'x'

/**
 * Every case pins the clock, same reasoning as `astro.test.ts`: a route whose
 * answer depends on "today" is otherwise a different test every day.
 */
const AUGUST = new Date('2026-08-15T12:00:00Z')

/**
 * Hossegor faces WNW (shoreNormal 290), so dead offshore is wind FROM 110 —
 * the same fixture geometry `marine-score.test.ts` uses. A clean groundswell
 * reading applied uniformly to every hour keeps the upstream fixtures simple
 * while still exercising real daylight-hour session detection.
 */
const CLEAN_MARINE: MarineReading = {
  waveHeight: 1.6,
  swellHeight: 1.5,
  swellPeriod: 13,
  swellDirection: 290,
}
const OFFSHORE_WIND: WindReading = { speedKn: 8, directionDeg: 110, gustKn: 12 }
const ONSHORE_WIND: WindReading = { speedKn: 18, directionDeg: 290, gustKn: 25 }

function marineSeries(from: Date, hours: number, reading: MarineReading) {
  const series = new Map<number, MarineReading>()
  const start = Math.floor(from.getTime() / 3_600_000) * 3_600_000
  for (let i = 0; i < hours; i++) series.set(start + i * 3_600_000, { ...reading })
  return series
}

function windSeries(from: Date, hours: number, reading: WindReading) {
  const series = new Map<number, WindReading>()
  const start = Math.floor(from.getTime() / 3_600_000) * 3_600_000
  for (let i = 0; i < hours; i++) series.set(start + i * 3_600_000, { ...reading })
  return series
}

// 20 days of coverage from just before the pinned clock, same margin
// astro.test.ts's cloud/transparency fixtures use.
const FIXTURE_FROM = new Date('2026-08-14T00:00:00Z')
const FIXTURE_HOURS = 24 * 20

function upstreams(
  overrides: Partial<MarineUpstreams> = {},
  wind: WindReading = OFFSHORE_WIND,
): MarineUpstreams {
  return {
    marine: marineSeries(FIXTURE_FROM, FIXTURE_HOURS, CLEAN_MARINE),
    wind: windSeries(FIXTURE_FROM, FIXTURE_HOURS, wind),
    health: { marine: true, wind: true },
    ...overrides,
  }
}

type Calls = { upstreams: number; complete: number }

function build(deps: Partial<MarineRouteDeps> = {}) {
  const calls: Calls = { upstreams: 0, complete: 0 }
  const app = new Elysia().use(authGuard).use(
    createMarineRoutes({
      now: () => AUGUST,
      fetchUpstreams: async () => {
        calls.upstreams++
        return upstreams()
      },
      complete: async () => {
        calls.complete++
        return 'Saturday 09:00 — 1.5m at 13s, offshore 8kn; the pick of the week.'
      },
      ...deps,
    }),
  )
  return { app, calls }
}

/** Just enough of Elysia to drive it — its full generic type is unusable as an annotation. */
type TestApp = { handle: (request: Request) => Promise<Response> }

/**
 * `body` is deliberately `any`: these tests assert against decoded JSON, and the
 * response contract is already pinned by the Zod response schema on the route.
 */
async function get(
  app: TestApp,
  path: string,
  auth = true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; body: any }> {
  const headers = auth ? { Authorization: `Bearer ${SECRET}` } : {}
  const res = await app.handle(new Request(`http://localhost${path}`, { headers }))
  // Error responses are `z.string()` and come back as text/plain, so parse
  // defensively rather than assuming JSON.
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

beforeEach(() => {
  clearMarineSummaryCache()
})

describe('GET /marine/spots', () => {
  it('lists every candidate spot with its shore orientation', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/marine/spots')
    expect(status).toBe(200)
    expect(body.total).toBe(body.data.length)
    expect(body.data.length).toBeGreaterThanOrEqual(4)
    const ids = body.data.map((spot: { id: string }) => spot.id)
    expect(ids).toContain('hossegor')
    expect(ids).toContain('levanto')
    for (const spot of body.data) {
      expect(spot.shoreNormal).toBeGreaterThanOrEqual(0)
      expect(spot.shoreNormal).toBeLessThan(360)
    }
  })

  it('requires a bearer token', async () => {
    const { app } = build()
    expect((await get(app, '/marine/spots', false)).status).toBe(401)
  })
})

describe('GET /marine/window — location resolution', () => {
  it('defaults to Levanto', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/marine/window')
    expect(status).toBe(200)
    expect(body.location.spotId).toBe('levanto')
    expect(body.days).toHaveLength(5)
  })

  it('uses a named spot’s coordinates and shore normal', async () => {
    const { app } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=3')
    expect(body.location.spotId).toBe('hossegor')
    expect(body.location.shoreNormal).toBe(290)
    expect(body.location.country).toBe('France')
    expect(body.days).toHaveLength(3)
  })

  it('404s on an unknown spot rather than silently falling back', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/marine/window?spot=atlantis')
    expect(status).toBe(404)
    expect(String(body)).toContain('atlantis')
  })

  it('400s on a raw lat/lon without shoreNormal', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/marine/window?lat=43.664&lon=-1.438')
    expect(status).toBe(400)
    expect(String(body)).toContain('shoreNormal')
  })

  it('accepts a raw lat/lon with an explicit shoreNormal', async () => {
    const { app } = build()
    const { status, body } = await get(
      app,
      '/marine/window?lat=43.664&lon=-1.438&shoreNormal=290&days=1',
    )
    expect(status).toBe(200)
    expect(body.location.spotId).toBeNull()
    expect(body.location.shoreNormal).toBe(290)
  })
})

describe('GET /marine/window — the verdict', () => {
  it('scores a clean offshore groundswell day well', async () => {
    const { app } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=1')
    expect(body.killers).toEqual([])
    expect(['excellent', 'good']).toContain(body.verdict)
    expect(body.score).toBeGreaterThan(60)
    expect(body.bestWindow).not.toBeNull()
    expect(body.days[0].window).not.toBeNull()
  })

  it('gates an onshore day out, with a named killer and a zero score', async () => {
    const { app } = build({
      fetchUpstreams: async () => upstreams({}, ONSHORE_WIND),
    })
    const { body } = await get(app, '/marine/window?spot=hossegor&days=1')
    expect(body.verdict).toBe('out')
    expect(body.score).toBe(0)
    expect(body.bestWindow).toBeNull()
    expect(body.days[0].window).toBeNull()
    expect(body.killers.length).toBeGreaterThan(0)
    expect(body.killers.map((k: { id: string }) => k.id)).toContain('wind-direction')
    expect(body.killers.find((k: { id: string }) => k.id === 'wind-direction').reason).toContain(
      'onshore',
    )
  })

  it('drops coverage instead of the score when both upstreams fail, without throwing', async () => {
    const { app } = build({
      fetchUpstreams: async () => ({
        marine: new Map(),
        wind: new Map(),
        health: { marine: false, wind: false },
      }),
    })
    const { status, body } = await get(app, '/marine/window?spot=hossegor&days=1')
    expect(status).toBe(200)
    expect(body.sources).toEqual({ marine: false, wind: false })
    expect(body.days[0].coverage).toBeLessThan(1)
    expect(body.days[0].conditions.swellHeight).toBeNull()
  })

  it('fetches the upstreams exactly once for the whole range', async () => {
    const { app, calls } = build()
    await get(app, '/marine/window?spot=hossegor&days=5')
    expect(calls.upstreams).toBe(1)
  })
})

describe('GET /marine/window — hourly detail', () => {
  it('honours an explicit detailDate', async () => {
    const { app } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=5&detailDate=2026-08-17')
    expect(body.detail.date).toBe('2026-08-17')
  })

  it('covers daylight hours only, at hourly resolution', async () => {
    const { app } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=1')
    expect(body.detail.hourly.length).toBeGreaterThan(6)
    expect(body.detail.hourly.length).toBeLessThan(20)
    for (const point of body.detail.hourly) {
      const hour = Number(point.localTime.slice(0, 2))
      expect(hour).toBeGreaterThanOrEqual(5)
      expect(hour).toBeLessThanOrEqual(22)
    }
    const first = new Date(body.detail.hourly[0].time).getTime()
    const second = new Date(body.detail.hourly[1].time).getTime()
    expect(second - first).toBe(60 * 60_000)
  })

  it('carries swell/wind alongside the score so one series can be charted against the other', async () => {
    const { app } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=1')
    const point = body.detail.hourly[0]
    expect(point.swellHeight).toBe(1.5)
    expect(point.swellPeriod).toBe(13)
    expect(point.windKind).toBe('offshore')
    expect(typeof point.score).toBe('number')
    expect(typeof point.gated).toBe('boolean')
  })
})

describe('GET /marine/window — the model is an enhancement, never a dependency', () => {
  it('returns the generated sentence when the model answers', async () => {
    const { app } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=1')
    expect(body.summary).toContain('1.5m')
  })

  it('still serves the full verdict when the model throws', async () => {
    const { app } = build({
      complete: async () => {
        throw new Error('upstream 503')
      },
    })
    const { status, body } = await get(app, '/marine/window?spot=hossegor&days=1')
    expect(status).toBe(200)
    expect(body.summary).toBeNull()
    expect(body.bestWindow).not.toBeNull()
  })

  it('does not call the model at all when summary=false', async () => {
    const { app, calls } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=1&summary=false')
    expect(calls.complete).toBe(0)
    expect(body.summary).toBeNull()
  })
})

describe('GET /marine/window — contract details', () => {
  it('always credits Open-Meteo', async () => {
    const { app } = build()
    const { body } = await get(app, '/marine/window?spot=hossegor&days=1')
    expect(body.attribution).toContain('Open-Meteo')
  })

  it('rejects an out-of-range days value', async () => {
    const { app } = build()
    expect((await get(app, '/marine/window?days=8')).status).toBe(422)
    expect((await get(app, '/marine/window?days=0')).status).toBe(422)
  })

  it('rejects a malformed detailDate', async () => {
    const { app } = build()
    expect((await get(app, '/marine/window?detailDate=17-08-2026')).status).toBe(422)
  })

  it('requires a bearer token', async () => {
    const { app } = build()
    expect((await get(app, '/marine/window', false)).status).toBe(401)
  })
})
