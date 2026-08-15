import { beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { AstroUpstreams, CloudSeries, TransparencySeries } from '../clients/astro-upstreams.js'
import { authGuard } from '../lib/auth-guard.js'
import { clearAstroSummaryCache, createAstroRoutes, type AstroRouteDeps } from './astro.js'

const SECRET = process.env['API_SECRET'] ?? 'x'

/**
 * Every case pins the clock. A route whose answer is literally "tonight" is
 * otherwise a different test every day — and the August/December split is what
 * separates a usable night from a gated one at this latitude.
 */
const AUGUST = new Date('2026-08-15T12:00:00Z')
const DECEMBER = new Date('2026-12-15T12:00:00Z')

function cloudSeries(from: Date, hours: number, value: { low: number; mid: number; high: number }) {
  const series: CloudSeries = new Map()
  const start = Math.floor(from.getTime() / 3_600_000) * 3_600_000
  for (let i = 0; i < hours; i++) {
    series.set(start + i * 3_600_000, { ...value })
  }
  return series
}

function transparencySeries(from: Date, slots: number, band: number) {
  const series: TransparencySeries = new Map()
  const start = Math.floor(from.getTime() / 3_600_000) * 3_600_000
  for (let i = 0; i < slots; i++) {
    series.set(start + i * 3 * 3_600_000, band)
  }
  return series
}

function upstreams(overrides: Partial<AstroUpstreams> = {}): AstroUpstreams {
  return {
    cloud: cloudSeries(new Date('2026-08-14T00:00:00Z'), 24 * 20, { low: 5, mid: 10, high: 20 }),
    transparency: transparencySeries(new Date('2026-08-14T00:00:00Z'), 8 * 20, 2),
    health: { dwdIcon: true, globalForecast: true, sevenTimer: true },
    ...overrides,
  }
}

type Calls = { upstreams: number; complete: number }

function build(deps: Partial<AstroRouteDeps> = {}) {
  const calls: Calls = { upstreams: 0, complete: 0 }
  const app = new Elysia().use(authGuard).use(
    createAstroRoutes({
      now: () => AUGUST,
      fetchUpstreams: async () => {
        calls.upstreams++
        return upstreams()
      },
      complete: async () => {
        calls.complete++
        return 'Saturday 22:35 — core 11°, moon 13%, low cloud 5%.'
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
 * Re-declaring that shape here would only create a second copy to keep in sync.
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
  clearAstroSummaryCache()
})

describe('GET /astro/sites', () => {
  it('lists every candidate site with its Bortle baseline', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/astro/sites')
    expect(status).toBe(200)
    expect(body.total).toBe(body.data.length)
    expect(body.data.length).toBeGreaterThanOrEqual(4)
    const ids = body.data.map((site: { id: string }) => site.id)
    expect(ids).toContain('munich')
    expect(ids).toContain('alpenvorland')
    for (const site of body.data) {
      expect(site.bortle).toBeGreaterThanOrEqual(1)
      expect(site.bortle).toBeLessThanOrEqual(9)
      expect(typeof site.note).toBe('string')
    }
  })

  it('requires a bearer token', async () => {
    const { app } = build()
    expect((await get(app, '/astro/sites', false)).status).toBe(401)
  })
})

describe('GET /astro/window — location resolution', () => {
  it('defaults to Munich', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/astro/window')
    expect(status).toBe(200)
    expect(body.location.siteId).toBe('munich')
    expect(body.location.bortle).toBe(8)
    expect(body.location.bortleSource).toBe('site')
    expect(body.nights).toHaveLength(10)
  })

  it('uses a named site’s coordinates and Bortle', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?site=alpenvorland&nights=3')
    expect(body.location.siteId).toBe('alpenvorland')
    expect(body.location.bortle).toBe(4)
    expect(body.location.lat).toBeCloseTo(47.8167, 3)
    expect(body.nights).toHaveLength(3)
  })

  it('404s on an unknown site rather than silently falling back', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/astro/window?site=atlantis')
    expect(status).toBe(404)
    expect(String(body)).toContain('atlantis')
  })

  it('infers Bortle from the nearest site for a raw lat/lon', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?lat=47.60&lon=11.33&nights=1')
    expect(body.location.siteId).toBeNull()
    expect(body.location.bortleSource).toBe('nearest-site')
    expect(body.location.nearestSiteId).toBe('walchensee')
    expect(body.location.nearestSiteKm).toBeLessThan(5)
  })

  it('lets an explicit bortle override the inference', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?lat=47.60&lon=11.33&bortle=2&nights=1')
    expect(body.location.bortle).toBe(2)
    expect(body.location.bortleSource).toBe('query')
  })
})

describe('GET /astro/window — the verdict', () => {
  it('recommends the first hour of darkness on a clear August night', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?site=alpenvorland&nights=5')
    expect(body.bestWindow).not.toBeNull()
    expect(['excellent', 'good']).toContain(body.verdict)
    expect(body.score).toBeGreaterThan(60)
    expect(body.killers).toEqual([])
    // The core transits before dark in mid-August, so the window opens with it.
    expect(body.bestWindow.peakTime).toBe(body.bestWindow.start)
    expect(body.bestWindow.peakCoreAltitude).toBeGreaterThan(8)
  })

  it('starts the range tonight, in the location’s own timezone', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?nights=3')
    expect(body.nights[0].date).toBe('2026-08-15')
    expect(body.nights[1].date).toBe('2026-08-16')
    expect(body.nights[2].date).toBe('2026-08-17')
  })

  it('headlines the BEST night in the range, not tonight', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?site=alpenvorland&nights=10')
    const best = body.nights.reduce(
      (top: { score: number }, night: { score: number }) => (night.score > top.score ? night : top),
      body.nights[0],
    )
    expect(body.score).toBe(best.score)
    expect(body.verdict).toBe(best.verdict)
  })

  it('gates a December range out, with a named reason and a zero score', async () => {
    const { app } = build({ now: () => DECEMBER })
    const { body } = await get(app, '/astro/window?nights=5')
    expect(body.verdict).toBe('out')
    expect(body.score).toBe(0)
    expect(body.bestWindow).toBeNull()
    expect(body.killers.length).toBeGreaterThan(0)
    expect(body.killers.map((k: { id: string }) => k.id)).toContain('core-altitude')
    for (const night of body.nights) {
      expect(night.verdict).toBe('out')
      expect(night.window).toBeNull()
    }
  })

  it('carries the full factor breakdown per night', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?site=alpenvorland&nights=1')
    const ids = body.nights[0].factors.map((f: { id: string }) => f.id)
    expect(ids).toEqual(['cloud-low', 'transparency', 'cloud-mid', 'bortle', 'cloud-high'])
    expect(ids).not.toContain('seeing')
    expect(body.nights[0].coverage).toBe(1)
  })

  it('drops coverage instead of the score when an upstream is missing', async () => {
    const { app } = build({
      fetchUpstreams: async () => ({
        cloud: new Map(),
        transparency: new Map(),
        health: { dwdIcon: false, globalForecast: false, sevenTimer: false },
      }),
    })
    const { body } = await get(app, '/astro/window?site=alpenvorland&nights=1')
    expect(body.sources).toEqual({ dwdIcon: false, globalForecast: false, sevenTimer: false })
    expect(body.nights[0].coverage).toBeLessThan(1)
    expect(body.nights[0].weather.cloudLow).toBeNull()
    expect(body.nights[0].weather.transparency).toBeNull()
  })

  it('fetches the upstreams exactly once for the whole range', async () => {
    const { app, calls } = build()
    await get(app, '/astro/window?nights=10')
    expect(calls.upstreams).toBe(1)
  })
})

describe('GET /astro/window — hourly detail', () => {
  it('defaults to the best night and steps at 30 minutes', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?site=alpenvorland&nights=5')
    expect(body.detail.date).toBe(body.bestWindow.date)
    expect(body.detail.hourly.length).toBeGreaterThan(10)
    const first = new Date(body.detail.hourly[0].time).getTime()
    const second = new Date(body.detail.hourly[1].time).getTime()
    expect(second - first).toBe(30 * 60_000)
  })

  it('honours an explicit detailDate', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?nights=5&detailDate=2026-08-18')
    expect(body.detail.date).toBe('2026-08-18')
  })

  it('omits broad daylight', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?nights=1')
    for (const point of body.detail.hourly) {
      expect(point.sunAltitude).toBeLessThanOrEqual(5)
    }
  })

  it('carries cloud alongside the geometry so one series can be charted against the other', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?nights=1')
    const point = body.detail.hourly[0]
    expect(point.cloudLow).toBe(5)
    expect(point.cloudMid).toBe(10)
    expect(point.cloudHigh).toBe(20)
    expect(typeof point.coreAltitude).toBe('number')
    expect(typeof point.astroDark).toBe('boolean')
  })
})

describe('GET /astro/window — the model is an enhancement, never a dependency', () => {
  it('returns the generated sentence when the model answers', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?nights=3')
    expect(body.summary).toContain('core 11')
  })

  it('still serves the full verdict when the model throws', async () => {
    const { app } = build({
      complete: async () => {
        throw new Error('upstream 503')
      },
    })
    const { status, body } = await get(app, '/astro/window?site=alpenvorland&nights=3')
    expect(status).toBe(200)
    expect(body.summary).toBeNull()
    expect(body.bestWindow).not.toBeNull()
    expect(body.score).toBeGreaterThan(0)
  })

  it('treats an empty completion as no sentence rather than an empty one', async () => {
    const { app } = build({ complete: async () => '   ' })
    const { body } = await get(app, '/astro/window?nights=1')
    expect(body.summary).toBeNull()
  })

  it('does not call the model at all when summary=false', async () => {
    const { app, calls } = build()
    const { body } = await get(app, '/astro/window?nights=3&summary=false')
    expect(calls.complete).toBe(0)
    expect(body.summary).toBeNull()
  })

  it('reuses a sentence while the verdict is unchanged', async () => {
    const { app, calls } = build()
    await get(app, '/astro/window?nights=3')
    await get(app, '/astro/window?nights=3')
    expect(calls.complete).toBe(1)
  })

  it('regenerates when the verdict moves', async () => {
    const { app, calls } = build()
    await get(app, '/astro/window?site=munich&nights=3')
    await get(app, '/astro/window?site=alpenvorland&nights=3')
    expect(calls.complete).toBe(2)
  })
})

describe('GET /astro/window — contract details', () => {
  it('always credits the upstreams', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?nights=1')
    expect(body.attribution).toContain('Open-Meteo')
    expect(body.attribution).toContain('7Timer')
  })

  it('serialises every instant as ISO 8601 UTC plus a local HH:MM', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/window?site=alpenvorland&nights=1')
    const night = body.nights[0]
    expect(night.darkStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(night.localTransit).toMatch(/^\d{2}:\d{2}$/)
    expect(night.window.localStart).toMatch(/^\d{2}:\d{2}$/)
  })

  it('rejects an out-of-range nights value', async () => {
    const { app } = build()
    expect((await get(app, '/astro/window?nights=99')).status).toBe(422)
    expect((await get(app, '/astro/window?nights=0')).status).toBe(422)
  })

  it('rejects a malformed detailDate', async () => {
    const { app } = build()
    expect((await get(app, '/astro/window?detailDate=15-08-2026')).status).toBe(422)
  })

  it('requires a bearer token', async () => {
    const { app } = build()
    expect((await get(app, '/astro/window', false)).status).toBe(401)
  })
})
