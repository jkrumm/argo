import { beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { AstroUpstreams, CloudSeries, TransparencySeries } from '../clients/astro-upstreams.js'
import type { LightPollutionPoint, LpTileImage, SkyglowResult } from '../clients/lorenz-atlas.js'
import { authGuard } from '../lib/auth-guard.js'
import { renderLpTilePng } from '../lib/lp-tile.js'
import { PROFILE_ALTITUDES, SKYGLOW_MODEL } from '../lib/skyglow.js'
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

/**
 * Stand-in atlas values. The real decode and the ray-march are pinned against
 * committed tiles in `../lib/lorenz-decode.test.ts` and
 * `../clients/lorenz-atlas.test.ts`; these tests own the layer above — location
 * precedence, the ephemeris meeting the atlas, rounding, and the error branches.
 */
function lightPollutionPoint(overrides: Partial<LightPollutionPoint> = {}): LightPollutionPoint {
  return {
    lat: 48.1374,
    lon: 11.5755,
    year: 2025,
    lpi: 25.4941,
    mpsas: 18.4421,
    zone: '6b',
    trend10yPercent: 8.14,
    source: 'Light Pollution Atlas 2025, David J. Lorenz',
    ...overrides,
  }
}

function skyglowResult(overrides: Partial<SkyglowResult> = {}): SkyglowResult {
  const azimuths = [0, 90, 180, 270]
  return {
    lat: 47.6,
    lon: 11.33,
    year: 2025,
    zenith: { lpi: 0.5114, mpsas: 21.5515, zone: '3a' },
    core: { azimuthDeg: 180.72, altitudeDeg: 13.451, mpsas: 19.9794, domePenaltyMag: 1.0294 },
    profile: {
      azimuths,
      altitudes: [...PROFILE_ALTITUDES],
      mpsas: PROFILE_ALTITUDES.map(() => azimuths.map(() => 21.4444)),
      calibration: 1,
      dominant: { azimuthDeg: 15, compass: 'NNE', mpsas: 19.8341 },
    },
    model: SKYGLOW_MODEL,
    source: 'Light Pollution Atlas 2025, David J. Lorenz',
    ...overrides,
  }
}

/**
 * A real rendered tile, not a byte stub: the route's ETag, its 304 branch and
 * the PNG signature assertion are only meaningful over bytes an encoder
 * actually produced. The encoding itself is pinned in `../lib/lp-tile.test.ts`.
 */
function lpTileImage(overrides: Partial<LpTileImage> = {}): LpTileImage {
  return {
    png: renderLpTilePng({ x: 135, y: 89, z: 8, sampler: () => 21.55 }),
    year: 2025,
    tilesRequested: 4,
    tilesResolved: 4,
    ...overrides,
  }
}

type Calls = {
  upstreams: number
  complete: number
  lightPollution: Parameters<AstroRouteDeps['lightPollution']>[0][]
  lpTile: Parameters<AstroRouteDeps['lpTile']>[0][]
  skyglow: Parameters<AstroRouteDeps['skyglow']>[0][]
}

function build(deps: Partial<AstroRouteDeps> = {}) {
  const calls: Calls = { upstreams: 0, complete: 0, lightPollution: [], lpTile: [], skyglow: [] }
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
      // Defaulted so no test can reach the real atlas over the network.
      lightPollution: async (input) => {
        calls.lightPollution.push(input)
        return lightPollutionPoint({ lat: input.lat, lon: input.lon })
      },
      lpTile: async (input) => {
        calls.lpTile.push(input)
        return lpTileImage()
      },
      skyglow: async (input) => {
        calls.skyglow.push(input)
        return skyglowResult({ lat: input.lat, lon: input.lon })
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

describe('GET /astro/light-pollution', () => {
  it('rounds the atlas values and credits the source', async () => {
    const { app } = build()
    const { status, body } = await get(app, '/astro/light-pollution')

    expect(status).toBe(200)
    expect(body).toMatchObject({
      siteId: 'munich',
      year: 2025,
      lpi: 25.494,
      mpsas: 18.44,
      zone: '6b',
      trend10yPercent: 8.1,
      source: 'Light Pollution Atlas 2025, David J. Lorenz',
    })
    expect(body.attribution).toContain('David J. Lorenz')
  })

  it('resolves site over lat/lon over the default', async () => {
    const { app, calls } = build()

    await get(app, '/astro/light-pollution?site=walchensee')
    await get(app, '/astro/light-pollution?lat=19.82&lon=-155.47')
    await get(app, '/astro/light-pollution')

    expect(calls.lightPollution.map((call) => [call.lat, call.lon])).toEqual([
      [47.6, 11.33],
      [19.82, -155.47],
      [48.1374, 11.5755],
    ])
    const raw = await get(app, '/astro/light-pollution?lat=19.82&lon=-155.47')
    expect(raw.body.siteId).toBeNull()
  })

  it('passes the requested atlas vintage through as a number', async () => {
    const { app, calls } = build()
    await get(app, '/astro/light-pollution?year=2016')
    expect(calls.lightPollution.at(-1)?.year).toBe(2016)
  })

  it('rejects a vintage the atlas never published', async () => {
    const { app } = build()
    expect((await get(app, '/astro/light-pollution?year=2019')).status).toBe(422)
  })

  it('serves null rather than a zero when the trend is unmeasurable', async () => {
    const { app } = build({
      lightPollution: async () => lightPollutionPoint({ trend10yPercent: null }),
    })
    expect((await get(app, '/astro/light-pollution')).body.trend10yPercent).toBeNull()
  })

  it('404s on an unknown site rather than silently falling back', async () => {
    const { app, calls } = build()
    const { status, body } = await get(app, '/astro/light-pollution?site=nowhere')
    expect(status).toBe(404)
    expect(body).toContain('nowhere')
    expect(calls.lightPollution).toHaveLength(0)
  })

  it('502s when the atlas is unreachable — there is nothing to degrade to', async () => {
    const { app } = build({ lightPollution: async () => null })
    const { status, body } = await get(app, '/astro/light-pollution')
    expect(status).toBe(502)
    expect(body).toContain('Light Pollution Atlas')
  })

  it('requires a bearer token', async () => {
    const { app } = build()
    expect((await get(app, '/astro/light-pollution', false)).status).toBe(401)
  })
})

describe('GET /astro/skyglow', () => {
  it('hands the atlas the core peak the ephemeris found for tonight', async () => {
    const { app, calls } = build()
    const { status, body } = await get(app, '/astro/skyglow?site=walchensee')

    expect(status).toBe(200)
    const call = calls.skyglow.at(0)
    // August at 47.6°N: the core peaks a little over 13°, due south.
    expect(call?.coreAltitudeDeg).toBeGreaterThan(12)
    expect(call?.coreAltitudeDeg).toBeLessThan(15)
    expect(call?.coreAzimuthDeg).toBeGreaterThan(170)
    expect(call?.coreAzimuthDeg).toBeLessThan(190)
    // Defaulted to today in the site's own timezone, and reported as UTC.
    expect(body.coreTime).toMatch(/^2026-08-1[56]T\d{2}:\d{2}:\d{2}/)
  })

  it('honours an explicit date', async () => {
    const { app, calls } = build()
    await get(app, '/astro/skyglow?site=walchensee&date=2026-07-15')
    expect(calls.skyglow.at(0)?.coreAltitudeDeg).toBeCloseTo(13.45, 1)
  })

  it('rounds the rose and echoes the kernel so a result is reproducible', async () => {
    const { app } = build()
    const { body } = await get(app, '/astro/skyglow?site=walchensee')

    expect(body.zenith).toMatchObject({ lpi: 0.511, mpsas: 21.55, zone: '3a' })
    expect(body.core).toMatchObject({
      azimuthDeg: 180.7,
      altitudeDeg: 13.5,
      mpsas: 19.98,
      domePenaltyMag: 1.03,
    })
    expect(body.profile.dominant).toMatchObject({ azimuthDeg: 15, compass: 'NNE', mpsas: 19.83 })
    expect(body.profile.mpsas[0]?.[0]).toBe(21.44)
    expect(body.model).toEqual({ ...SKYGLOW_MODEL })
  })

  it('rejects a malformed date', async () => {
    const { app } = build()
    expect((await get(app, '/astro/skyglow?date=15-07-2026')).status).toBe(422)
  })

  it('refuses to measure a direction that is under the ground', async () => {
    // Tromsø: the core's -29° declination never clears the horizon above ~61°N,
    // and the scattering kernel is only defined above it.
    const { app, calls } = build()
    const { status, body } = await get(app, '/astro/skyglow?lat=69.65&lon=18.96')

    expect(status).toBe(422)
    expect(body).toContain('below the horizon')
    expect(calls.skyglow).toHaveLength(0)
  })

  it('404s on an unknown site', async () => {
    const { app } = build()
    expect((await get(app, '/astro/skyglow?site=nowhere')).status).toBe(404)
  })

  it('502s when the atlas is unreachable', async () => {
    const { app } = build({ skyglow: async () => null })
    expect((await get(app, '/astro/skyglow')).status).toBe(502)
  })

  it('requires a bearer token', async () => {
    const { app } = build()
    expect((await get(app, '/astro/skyglow', false)).status).toBe(401)
  })
})

describe('GET /astro/tiles/lp/{year}/{z}/{x}/{y}.png', () => {
  const TILE = '/astro/tiles/lp/2025/8/135/89.png'

  /** The JSON `get` helper is useless here — this route's body is binary. */
  async function raw(app: TestApp, path: string, headers: Record<string, string> = {}) {
    return app.handle(
      new Request(`http://localhost${path}`, {
        headers: { Authorization: `Bearer ${SECRET}`, ...headers },
      }),
    )
  }

  it('serves a PNG, and strips the .png suffix before reaching the client', async () => {
    const { app, calls } = build()
    const res = await raw(app, TILE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(calls.lpTile).toEqual([{ x: 135, y: 89, z: 8, year: 2025 }])
  })

  it('caches hard and PRIVATELY — the route is bearer-guarded', async () => {
    const { app } = build()
    const res = await raw(app, TILE)
    // `public` is the exact directive RFC 9111 §3.5 requires before a shared
    // cache may store an Authorization-bearing response — i.e. it would let the
    // Cloudflare Tunnel replay this tile to a caller with no token.
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=2592000, stale-while-revalidate=86400',
    )
    const etag = res.headers.get('etag')
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
  })

  it('refuses to let a partially covered render be cached at all', async () => {
    // The client already declines to keep this in-process so the next request
    // re-tries the missing atlas tiles; a 30-day copy downstream would pin the
    // very bytes it refused, and the unresolved region reads 22.00 — "pristine
    // sky" — over whatever city was missing.
    const { app } = build({
      lpTile: async () => lpTileImage({ tilesRequested: 6, tilesResolved: 1 }),
    })
    const res = await raw(app, TILE)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('caches a fully covered render, including one with no atlas coverage at all', async () => {
    const { app } = build({
      lpTile: async () => lpTileImage({ tilesRequested: 0, tilesResolved: 0 }),
    })
    const res = await raw(app, TILE)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=2592000, stale-while-revalidate=86400',
    )
  })

  it('answers a matching If-None-Match with a bodiless 304', async () => {
    const { app } = build()
    const etag = (await raw(app, TILE)).headers.get('etag') ?? ''
    const res = await raw(app, TILE, { 'if-none-match': etag })
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(etag)
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })

  it('still sends the body when the ETag does not match', async () => {
    const { app } = build()
    const res = await raw(app, TILE, { 'if-none-match': '"deadbeef"' })
    expect(res.status).toBe(200)
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  it('422s outside the served z5..z9 range', async () => {
    const { app, calls } = build()
    expect((await raw(app, '/astro/tiles/lp/2025/4/8/5.png')).status).toBe(422)
    expect((await raw(app, '/astro/tiles/lp/2025/10/540/356.png')).status).toBe(422)
    expect(calls.lpTile).toHaveLength(0)
  })

  it('422s on an atlas year that was never published', async () => {
    const { app, calls } = build()
    expect((await raw(app, '/astro/tiles/lp/2019/8/135/89.png')).status).toBe(422)
    expect(calls.lpTile).toHaveLength(0)
  })

  it('422s on an x or y outside 0..2^z-1 rather than serving a wrong tile', async () => {
    const { app, calls } = build()
    expect((await raw(app, '/astro/tiles/lp/2025/8/256/89.png')).status).toBe(422)
    expect((await raw(app, '/astro/tiles/lp/2025/8/135/256.png')).status).toBe(422)
    expect((await raw(app, '/astro/tiles/lp/2025/8/-1/89.png')).status).toBe(422)
    expect(calls.lpTile).toHaveLength(0)
  })

  it('422s when the .png suffix is missing — the tile URL has one shape', async () => {
    const { app } = build()
    expect((await raw(app, '/astro/tiles/lp/2025/8/135/89')).status).toBe(422)
  })

  it('422s every non-canonical spelling of the same tile, so one tile has one URL', async () => {
    const { app, calls } = build()
    // `z.coerce.number()` runs `Number()`, which reads all four of these as 135
    // — four extra URLs a browser and Cloudflare would each cache separately.
    for (const alias of [
      '/astro/tiles/lp/2025/8/0135/89.png', // leading zero
      '/astro/tiles/lp/2025/8/0x87/89.png', // hex
      '/astro/tiles/lp/2025/8/1e2/89.png', // exponent
      '/astro/tiles/lp/2025/8/%20135/89.png', // leading whitespace
      '/astro/tiles/lp/2025/8/135/089.png', // leading zero on the row
      '/astro/tiles/lp/2025/08/135/89.png', // leading zero on the zoom
      '/astro/tiles/lp/2025/8.0/135/89.png', // decimal zoom
    ]) {
      expect((await raw(app, alias)).status).toBe(422)
    }
    expect(calls.lpTile).toHaveLength(0)
  })

  it('502s when the atlas is unreachable', async () => {
    const { app } = build({ lpTile: async () => null })
    expect((await raw(app, TILE)).status).toBe(502)
  })

  it('requires a bearer token — the dashboard passes it via MapLibre transformRequest', async () => {
    const { app } = build()
    const res = await app.handle(new Request(`http://localhost${TILE}`))
    expect(res.status).toBe(401)
  })
})
