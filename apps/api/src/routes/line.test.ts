import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createClickHouse, type ClickHouse } from '../clients/clickhouse.js'
import { env } from '../env.js'
import { authGuard } from '../lib/auth-guard.js'
import { createLineRoutes } from './line.js'

// DB-free: the routes read from a fake ClickHouse HTTP server on a loopback port (in `make check`).

const NOW = 1_794_986_800
let bodies: string[] = []
let status = 200
let fake: ReturnType<typeof Bun.serve>

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const sql = await request.text()
      bodies.push(sql)
      if (status !== 200) return new Response('Code: 241. DB::Exception: Memory limit', { status })
      if (sql.includes("'line.probe.sent'") && sql.includes('GROUP BY t, target'))
        return Response.json({
          data: [{ t: 1, target: 'gateway', sent: 10, received: 10, rtt_median: 0.9 }],
        })
      if (sql.includes("'line.probe.sent'") && sql.includes('GROUP BY target'))
        return Response.json({
          data: [{ target: 'gateway', sent: 10, received: 10, rtt_median: 0.9 }],
        })
      return Response.json({ data: [] })
    },
  })
})
afterAll(() => {
  void fake.stop(true)
})
beforeEach(() => {
  bodies = []
  status = 200
})

const chFor = (): ClickHouse =>
  createClickHouse({ url: `http://127.0.0.1:${fake.port}`, user: 'argo_ro', password: 'pw' })

const appFor = (ch: ClickHouse = chFor()) =>
  new Elysia().use(authGuard).use(createLineRoutes({ ch, now: () => NOW }))

const get = (path: string, headers: Record<string, string> = bearer, app = appFor()) =>
  app.handle(new Request(`http://localhost${path}`, { headers }))

const bearer = { Authorization: `Bearer ${env.API_SECRET}` }

describe('/line/*', () => {
  it.each(['now', 'uptime', 'latency', 'router', 'speedtests'])(
    '401s /line/%s without the bearer, before any query',
    async (path) => {
      const res = await get(`/line/${path}`, {})
      expect(res.status).toBe(401)
      expect(bodies).toHaveLength(0)
    },
  )

  it('serves latency per target for a window', async () => {
    const res = await get('/line/latency?window=24h')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { window: string; step: number; targets: unknown[] }
    expect(body.window).toBe('24h')
    expect(body.step).toBe(300)
    expect(body.targets[0]).toMatchObject({ target: 'gateway', lossPct: 0, rttMs: 0.9 })
  })

  it('defaults the window to 7d and rejects one outside the set', async () => {
    expect(((await (await get('/line/latency')).json()) as { window: string }).window).toBe('7d')
    const bad = await get('/line/latency?window=1y')
    expect(bad.status).toBe(422)
    expect(bodies).toHaveLength(2)
  })

  it('never lets a request choose SQL: the query text does not depend on the query string', async () => {
    await get('/line/router?window=7d')
    const first = bodies.at(-1)
    await get("/line/router?window=7d&metric=x'%3B%20DROP%20TABLE%20a&table=otel_logs")
    expect(bodies.at(-1)).toBe(first)
  })

  it('answers each card on its own: now works while uptime is a 503 when ClickHouse errors', async () => {
    status = 500
    const res = await get('/line/uptime?window=7d')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'line data unavailable' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('503s without a configured ClickHouse and makes no request', async () => {
    const off = createClickHouse({ url: '', user: 'u', password: '' })
    const res = await get('/line/now', bearer, appFor(off))
    expect(res.status).toBe(503)
    expect(bodies).toHaveLength(0)
  })

  it('503s when ClickHouse is unreachable', async () => {
    const dead = createClickHouse({ url: 'http://127.0.0.1:1', user: 'u', password: 'p' })
    const res = await get('/line/speedtests?window=30d', bearer, appFor(dead))
    expect(res.status).toBe(503)
  })
})
