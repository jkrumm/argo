import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { env } from '../env.js'
import { garmin, GarminAuthError, resetGarminToken } from '../clients/garmin.js'

type Call = { url: string; auth: string | null; method: string }

const originalFetch = globalThis.fetch
const originalKey = env.GARMIN_API_KEY

function jwt(expSeconds: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`
}

const farFuture = () => jwt(Math.floor(Date.now() / 1000) + 24 * 3600)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function install(handler: (url: URL, call: Call) => Response): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const call = {
      url: req.url,
      auth: req.headers.get('authorization'),
      method: req.method,
    }
    calls.push(call)
    return handler(new URL(req.url), call)
  }) as typeof fetch
  return calls
}

const row = (id: number, typeKey = 'running') => ({
  activityId: id,
  startTimeLocal: '2026-01-02 08:00:00',
  activityType: { typeKey },
})

const isToken = (url: URL) => url.pathname.endsWith('/personal-api-key/token')

beforeEach(() => {
  env.GARMIN_API_KEY = 'test-key'
  resetGarminToken()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  env.GARMIN_API_KEY = originalKey
})

describe('garmin client', () => {
  it('mints a token with the ApiKey header, caches it, and merges the four daily calls', async () => {
    let minted = 0
    const calls = install((url) => {
      if (isToken(url)) {
        minted += 1
        return new Response(farFuture())
      }
      if (url.pathname.endsWith('/usersummary/daily')) return json({ totalSteps: 1000 })
      if (url.pathname.endsWith('/dailyHeartRate')) return json({ restingHeartRate: 50 })
      if (url.pathname.includes('/hrv-service/hrv/')) return new Response(null, { status: 204 })
      if (url.pathname.endsWith('/dailySleep')) return json({ sleepTimeSeconds: 100 })
      throw new Error(`unexpected ${url.pathname}`)
    })

    const metrics = await garmin.dailyMetrics({ from: '2026-01-01', to: '2026-01-02' })

    expect(metrics.map((m) => m.date)).toEqual(['2026-01-01', '2026-01-02'])
    expect(metrics[0]).toMatchObject({ steps: 1000, resting_hr: 50, sleep_duration_sec: 100 })
    expect(metrics[0]?.hrv_status).toBeUndefined()
    expect(minted).toBe(1) // cached across both days
    expect(calls.find((c) => isToken(new URL(c.url)))).toMatchObject({
      method: 'POST',
      auth: 'ApiKey test-key',
    })
    const data = calls.filter((c) => !isToken(new URL(c.url)))
    expect(data).toHaveLength(8)
    expect(data.every((c) => c.auth?.startsWith('Bearer h.'))).toBe(true)
  })

  it('re-mints once and retries once on a 401', async () => {
    let dataCalls = 0
    install((url) => {
      if (isToken(url)) return new Response(farFuture())
      dataCalls += 1
      return dataCalls === 1 ? new Response('expired', { status: 401 }) : json([])
    })

    expect(await garmin.activities({ from: '2026-01-01', to: '2026-01-02' })).toEqual([])
    expect(dataCalls).toBe(2)
  })

  it('throws GarminAuthError when the 401 persists after the retry', async () => {
    install((url) => (isToken(url) ? new Response(farFuture()) : new Response('', { status: 401 })))
    await expect(
      garmin.dailyMetrics({ from: '2026-01-01', to: '2026-01-01' }),
    ).rejects.toBeInstanceOf(GarminAuthError)
  })

  it('tolerates a failing daily call but keeps the other fields', async () => {
    install((url) => {
      if (isToken(url)) return new Response(farFuture())
      if (url.pathname.endsWith('/usersummary/daily')) return new Response('boom', { status: 500 })
      if (url.pathname.endsWith('/dailyHeartRate')) return json({ restingHeartRate: 48 })
      return new Response(null, { status: 204 })
    })

    const metrics = await garmin.dailyMetrics({ from: '2026-01-01', to: '2026-01-01' })
    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({ date: '2026-01-01', resting_hr: 48 })
    expect(metrics[0]?.steps).toBeUndefined()
  })

  it('pages activities with limit=20 until a short page and filters walking', async () => {
    const starts: string[] = []
    install((url) => {
      if (isToken(url)) return new Response(farFuture())
      expect(url.searchParams.get('limit')).toBe('20')
      const start = Number(url.searchParams.get('start'))
      starts.push(String(start))
      if (start === 0)
        return json(
          Array.from({ length: 20 }, (_, i) => row(i + 1, i === 0 ? 'walking' : 'running')),
        )
      return json([row(21), row(5)])
    })

    const records = await garmin.activities({ from: '2026-01-01', to: '2026-01-02' })
    expect(starts).toEqual(['0', '20'])
    expect(records).toHaveLength(20) // 19 running + id 21; walking dropped, id 5 deduped
    expect(records.some((r) => r.type_key === 'walking')).toBe(false)
  })

  it('throws GarminAuthError when the token mint fails', async () => {
    install((url) => {
      if (isToken(url)) return new Response('forbidden', { status: 403 })
      throw new Error('data call must not happen')
    })
    await expect(
      garmin.dailyMetrics({ from: '2026-01-01', to: '2026-01-01' }),
    ).rejects.toBeInstanceOf(GarminAuthError)
  })
})
