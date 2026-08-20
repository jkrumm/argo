import { describe, it, expect, beforeEach } from 'bun:test'
import {
  clearAstroUpstreamCache,
  cloudAt,
  fetchAstroUpstreams,
  transparencyAt,
  type CloudSeries,
  type FetchImpl,
  type TransparencySeries,
} from './astro-upstreams.js'
import { distanceKm, nearestSite } from '../lib/astro-sites.js'

// ── Fixtures ─────────────────────────────────────────────────────────────

const LAT = 48.1374
const LON = 11.5755

type UpstreamKind = 'icon' | 'global' | 'seven-timer' | 'unknown'

function kindOf(url: string | URL | Request): UpstreamKind {
  const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
  if (href.includes('/v1/dwd-icon')) return 'icon'
  if (href.includes('/v1/forecast')) return 'global'
  if (href.includes('7timer.info')) return 'seven-timer'
  return 'unknown'
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function iconPayload(opts: {
  times: string[]
  low: (number | null)[]
  mid: (number | null)[]
  high: (number | null)[]
}): unknown {
  return {
    hourly: {
      time: opts.times,
      cloud_cover_low: opts.low,
      cloud_cover_mid: opts.mid,
      cloud_cover_high: opts.high,
    },
  }
}

function sevenTimerPayload(opts: {
  init: string
  entries: Array<{ timepoint: number; transparency: number }>
}): unknown {
  return {
    init: opts.init,
    dataseries: opts.entries.map((e) => ({
      timepoint: e.timepoint,
      transparency: e.transparency,
      seeing: 9, // present on the wire, must never be read
      cloudcover: 9, // present on the wire, must never be read
    })),
  }
}

/**
 * A fetch double keyed by upstream kind. Each entry is either a fixed
 * `Response`-producing factory or `'reject'` to simulate a network failure.
 * Records every call (by kind) so tests can assert invocation counts and
 * inspect the exact requested URL (for clamping assertions).
 */
function createFakeFetch(handlers: Partial<Record<UpstreamKind, (() => Response) | 'reject'>>): {
  fetchImpl: FetchImpl
  calls: Array<{ kind: UpstreamKind; url: string }>
  countOf: (kind: UpstreamKind) => number
} {
  const calls: Array<{ kind: UpstreamKind; url: string }> = []
  const fetchImpl: FetchImpl = async (input) => {
    const kind = kindOf(input)
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ kind, url: href })
    const handler = handlers[kind]
    if (handler === undefined) throw new Error(`unexpected upstream call: ${kind} ${href}`)
    if (handler === 'reject') throw new Error(`simulated network failure: ${kind}`)
    return handler()
  }

  return {
    fetchImpl,
    calls,
    countOf: (kind: UpstreamKind) => calls.filter((c) => c.kind === kind).length,
  }
}

// A trivially valid response for upstreams a given test doesn't care about.
function emptyIconResponse(): Response {
  return jsonResponse(iconPayload({ times: [], low: [], mid: [], high: [] }))
}
function emptySevenTimerResponse(): Response {
  return jsonResponse(sevenTimerPayload({ init: '2026081500', entries: [] }))
}

beforeEach(() => {
  clearAstroUpstreamCache()
})

// ── Merge ────────────────────────────────────────────────────────────────

describe('fetchAstroUpstreams — cloud merge', () => {
  it('ICON wins per-layer where present; global fills only the null holes', async () => {
    const times = ['2026-08-15T20:00', '2026-08-15T21:00']
    const { fetchImpl } = createFakeFetch({
      icon: () =>
        jsonResponse(
          iconPayload({
            times,
            // hour0: low/high present, mid null (a hole global should fill)
            // hour1: entirely null (beyond ICON's real horizon)
            low: [10, null],
            mid: [null, null],
            high: [5, null],
          }),
        ),
      global: () =>
        jsonResponse(
          iconPayload({
            times,
            low: [99, 20],
            mid: [50, 30],
            high: [99, 40],
          }),
        ),
      'seven-timer': emptySevenTimerResponse,
    })

    const result = await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl })

    const hour0 = result.cloud.get(Date.UTC(2026, 7, 15, 20))
    const hour1 = result.cloud.get(Date.UTC(2026, 7, 15, 21))

    expect(hour0).toEqual({ low: 10, mid: 50, high: 5 })
    expect(hour1).toEqual({ low: 20, mid: 30, high: 40 })
    expect(result.health).toEqual({ dwdIcon: true, globalForecast: true, sevenTimer: true })
  })
})

// ── Time parsing ─────────────────────────────────────────────────────────

describe('time parsing', () => {
  it('maps a 7Timer init + timepoint pair to the right absolute UTC instant', async () => {
    const { fetchImpl } = createFakeFetch({
      icon: emptyIconResponse,
      global: emptyIconResponse,
      'seven-timer': () =>
        jsonResponse(
          sevenTimerPayload({
            init: '2026081512', // 2026-08-15 12:00 UTC
            entries: [{ timepoint: 3, transparency: 4 }],
          }),
        ),
    })

    const result = await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl })

    const expectedEpoch = Date.UTC(2026, 7, 15, 15) // init 12:00 + 3h
    expect(result.transparency.get(expectedEpoch)).toBe(4)
    expect(result.transparency.size).toBe(1)
  })

  it('parses hourly time strings as UTC, not machine-local', async () => {
    const { fetchImpl } = createFakeFetch({
      icon: () =>
        jsonResponse(
          iconPayload({
            times: ['2026-08-15T20:00'],
            low: [42],
            mid: [null],
            high: [null],
          }),
        ),
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    const result = await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl })

    // A bare `new Date("2026-08-15T20:00")` misparse would land on a
    // different epoch on any host not in UTC — this pins the exact value.
    const exactUtcEpoch = Date.UTC(2026, 7, 15, 20, 0, 0)
    expect(result.cloud.get(exactUtcEpoch)?.low).toBe(42)
  })
})

// ── Failure handling ─────────────────────────────────────────────────────

describe('failure handling', () => {
  it('never throws when every upstream rejects', async () => {
    const { fetchImpl } = createFakeFetch({
      icon: 'reject',
      global: 'reject',
      'seven-timer': 'reject',
    })

    const result = await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl })

    expect(result.cloud.size).toBe(0)
    expect(result.transparency.size).toBe(0)
    expect(result.health).toEqual({ dwdIcon: false, globalForecast: false, sevenTimer: false })
  })

  it('never throws when every upstream returns a 500', async () => {
    const { fetchImpl } = createFakeFetch({
      icon: () => jsonResponse({ error: 'boom' }, 500),
      global: () => jsonResponse({ error: 'boom' }, 500),
      'seven-timer': () => jsonResponse({ error: 'boom' }, 500),
    })

    const result = await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl })

    expect(result.cloud.size).toBe(0)
    expect(result.transparency.size).toBe(0)
    expect(result.health).toEqual({ dwdIcon: false, globalForecast: false, sevenTimer: false })
  })

  it('leaves the other two upstreams intact when one fails', async () => {
    const { fetchImpl } = createFakeFetch({
      icon: 'reject',
      global: () =>
        jsonResponse(
          iconPayload({ times: ['2026-08-15T20:00'], low: [15], mid: [null], high: [null] }),
        ),
      'seven-timer': () =>
        jsonResponse(
          sevenTimerPayload({ init: '2026081500', entries: [{ timepoint: 0, transparency: 2 }] }),
        ),
    })

    const result = await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl })

    expect(result.health).toEqual({ dwdIcon: false, globalForecast: true, sevenTimer: true })
    expect(result.cloud.get(Date.UTC(2026, 7, 15, 20))?.low).toBe(15)
    expect(result.transparency.get(Date.UTC(2026, 7, 15, 0))).toBe(2)
  })
})

// ── Caching ──────────────────────────────────────────────────────────────

describe('caching', () => {
  it('does not re-issue requests for a second call inside the TTL', async () => {
    const fake = createFakeFetch({
      icon: emptyIconResponse,
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl: fake.fetchImpl })
    await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl: fake.fetchImpl })

    expect(fake.countOf('icon')).toBe(1)
    expect(fake.countOf('global')).toBe(1)
    expect(fake.countOf('seven-timer')).toBe(1)
  })

  it('clearAstroUpstreamCache resets the TTL guard', async () => {
    const fake = createFakeFetch({
      icon: emptyIconResponse,
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl: fake.fetchImpl })
    clearAstroUpstreamCache()
    await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl: fake.fetchImpl })

    expect(fake.countOf('icon')).toBe(2)
    expect(fake.countOf('global')).toBe(2)
    expect(fake.countOf('seven-timer')).toBe(2)
  })

  it('does not cache a failed fetch — the next call retries', async () => {
    let iconCalls = 0
    const fake = createFakeFetch({
      icon: () => {
        iconCalls++
        return iconCalls === 1 ? jsonResponse({}, 500) : emptyIconResponse()
      },
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    const first = await fetchAstroUpstreams(
      { lat: LAT, lon: LON, days: 3 },
      { fetchImpl: fake.fetchImpl },
    )
    expect(first.health.dwdIcon).toBe(false)

    const second = await fetchAstroUpstreams(
      { lat: LAT, lon: LON, days: 3 },
      { fetchImpl: fake.fetchImpl },
    )
    expect(second.health.dwdIcon).toBe(true)

    // icon was retried (2 calls); the always-succeeding upstreams were cached (1 call each).
    expect(fake.countOf('icon')).toBe(2)
    expect(fake.countOf('global')).toBe(1)
    expect(fake.countOf('seven-timer')).toBe(1)
  })
})

// ── days clamping ────────────────────────────────────────────────────────

describe('days clamping', () => {
  it('clamps below the floor up to 1 and caps ICON/global forecast_days at their own ceilings', async () => {
    const fake = createFakeFetch({
      icon: emptyIconResponse,
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 0 }, { fetchImpl: fake.fetchImpl })

    const iconUrl = new URL(fake.calls.find((c) => c.kind === 'icon')?.url ?? '')
    const globalUrl = new URL(fake.calls.find((c) => c.kind === 'global')?.url ?? '')
    expect(iconUrl.searchParams.get('forecast_days')).toBe('1')
    expect(globalUrl.searchParams.get('forecast_days')).toBe('1')
  })

  it('clamps above the ceiling down to 16, but caps ICON at its own 10-day horizon', async () => {
    const fake = createFakeFetch({
      icon: emptyIconResponse,
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 100 }, { fetchImpl: fake.fetchImpl })

    const iconUrl = new URL(fake.calls.find((c) => c.kind === 'icon')?.url ?? '')
    const globalUrl = new URL(fake.calls.find((c) => c.kind === 'global')?.url ?? '')
    expect(iconUrl.searchParams.get('forecast_days')).toBe('10')
    expect(globalUrl.searchParams.get('forecast_days')).toBe('16')
  })
})

// ── Self-hosted Open-Meteo (METEO_SELFHOSTED_URL) ──────────────────────────

describe('self-hosted DWD ICON upstream', () => {
  it('unset (the default) requests the public API', async () => {
    const fake = createFakeFetch({
      icon: emptyIconResponse,
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    await fetchAstroUpstreams({ lat: LAT, lon: LON, days: 3 }, { fetchImpl: fake.fetchImpl })

    const iconUrl = fake.calls.find((c) => c.kind === 'icon')?.url
    expect(iconUrl).toStartWith('https://api.open-meteo.com/v1/dwd-icon')
  })

  it('set requests the self-hosted instance instead, same /v1/dwd-icon path', async () => {
    const fake = createFakeFetch({
      icon: emptyIconResponse,
      global: emptyIconResponse,
      'seven-timer': emptySevenTimerResponse,
    })

    await fetchAstroUpstreams(
      { lat: LAT, lon: LON, days: 3 },
      { fetchImpl: fake.fetchImpl, selfHostedMeteoUrl: 'https://meteo.mini.jkrumm.com' },
    )

    const iconUrl = fake.calls.find((c) => c.kind === 'icon')?.url
    expect(iconUrl).toStartWith('https://meteo.mini.jkrumm.com/v1/dwd-icon')
  })

  it('a self-hosted failure degrades the health flag without ever calling the public API', async () => {
    const calls: Array<{ kind: UpstreamKind; url: string }> = []
    const fetchImpl: FetchImpl = async (input) => {
      const kind = kindOf(input)
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ kind, url: href })
      if (kind === 'icon') throw new Error('simulated self-hosted failure')
      if (kind === 'global') return emptyIconResponse()
      if (kind === 'seven-timer') return emptySevenTimerResponse()
      throw new Error(`unexpected upstream call: ${kind} ${href}`)
    }

    const result = await fetchAstroUpstreams(
      { lat: LAT, lon: LON, days: 3 },
      { fetchImpl, selfHostedMeteoUrl: 'https://meteo.mini.jkrumm.com' },
    )

    expect(result.health.dwdIcon).toBe(false)
    const iconCalls = calls.filter((c) => c.kind === 'icon')
    expect(iconCalls).toHaveLength(1)
    expect(iconCalls[0]?.url).toStartWith('https://meteo.mini.jkrumm.com/v1/dwd-icon')
    // No fallback call to the public dwd-icon host — the failure is honest, not silently patched.
    expect(calls.some((c) => c.url.startsWith('https://api.open-meteo.com/v1/dwd-icon'))).toBe(
      false,
    )
  })
})

// ── Lookup helpers ───────────────────────────────────────────────────────

describe('cloudAt', () => {
  it('floors to the UTC hour and returns null when that hour is missing', () => {
    const series: CloudSeries = new Map([
      [Date.UTC(2026, 7, 15, 20), { low: 10, mid: 20, high: 30 }],
    ])

    // 20:45 falls inside the 20:00 hour.
    expect(cloudAt(series, new Date(Date.UTC(2026, 7, 15, 20, 45)))).toEqual({
      low: 10,
      mid: 20,
      high: 30,
    })
    // 21:00 has no entry.
    expect(cloudAt(series, new Date(Date.UTC(2026, 7, 15, 21)))).toBeNull()
  })
})

describe('transparencyAt', () => {
  const series: TransparencySeries = new Map([
    [Date.UTC(2026, 7, 15, 12), 3],
    [Date.UTC(2026, 7, 15, 15), 5],
  ])

  it('returns the latest slot at or before `at` when inside the 3-hour reach', () => {
    // 17:00 is 2h after the 15:00 slot — inside reach.
    expect(transparencyAt(series, new Date(Date.UTC(2026, 7, 15, 17)))).toBe(5)
    // Exactly on a slot.
    expect(transparencyAt(series, new Date(Date.UTC(2026, 7, 15, 15)))).toBe(5)
  })

  it('returns null once the nearest slot falls outside the 3-hour reach', () => {
    // 19:00 is 4h after the 15:00 slot — beyond reach.
    expect(transparencyAt(series, new Date(Date.UTC(2026, 7, 15, 19)))).toBeNull()
  })

  it('returns null when `at` is before every slot', () => {
    expect(transparencyAt(series, new Date(Date.UTC(2026, 7, 15, 0)))).toBeNull()
  })
})

// ── astro-sites ──────────────────────────────────────────────────────────

describe('nearestSite / distanceKm', () => {
  it('picks Munich for a Munich-adjacent coordinate', () => {
    expect(nearestSite(48.14, 11.58).id).toBe('munich')
  })

  it('picks Walchensee for a coordinate right at it', () => {
    expect(nearestSite(47.6, 11.33).id).toBe('walchensee')
  })

  it('gives a sane Munich↔Walchensee distance (~60 km)', () => {
    const km = distanceKm({ lat: 48.1374, lon: 11.5755 }, { lat: 47.6, lon: 11.33 })
    expect(km).toBeGreaterThan(50)
    expect(km).toBeLessThan(70)
  })
})
