import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createClickHouse, type ClickHouse } from '../clients/clickhouse.js'
import { env } from '../env.js'
import { authGuard } from '../lib/auth-guard.js'
import { createMachinesRoutes } from './machines.js'

// DB-free: the routes read from a fake ClickHouse HTTP server on a loopback port (in `make check`).

const NOW = 1_794_986_800
let bodies: string[] = []
let urls: string[] = []
let status = 200
let fake: ReturnType<typeof Bun.serve>

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const sql = await request.text()
      bodies.push(sql)
      urls.push(request.url)
      if (status !== 200) return new Response('Code: 241. DB::Exception: Memory limit', { status })
      if (sql.includes('GROUP BY host\nORDER BY host\nLIMIT 100'))
        return Response.json({ data: [{ host: 'vps', last_seen: NOW - 20 }] })
      if (sql.includes('GROUP BY host, t\nORDER BY host, t'))
        return Response.json({
          data: [{ host: 'vps', t: NOW - 300, idle: 0.5, mem_used: 0.25, load1: 1 }],
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
  urls = []
  status = 200
})

const chFor = (): ClickHouse =>
  createClickHouse({ url: `http://127.0.0.1:${fake.port}`, user: 'argo_ro', password: 'pw' })

const appFor = (ch: ClickHouse = chFor()) =>
  new Elysia().use(authGuard).use(createMachinesRoutes({ ch, now: () => NOW }))

const bearer = { Authorization: `Bearer ${env.API_SECRET}` }

const get = (path: string, headers: Record<string, string> = bearer, app = appFor()) =>
  app.handle(new Request(`http://localhost${path}`, { headers }))

describe('/machines/*', () => {
  it.each(['overview', 'detail?host=vps'])(
    '401s /machines/%s without the bearer, before any query',
    async (path) => {
      const res = await get(`/machines/${path}`, {})
      expect(res.status).toBe(401)
      expect(bodies).toHaveLength(0)
    },
  )

  it('serves the overview with the default range and no caching', async () => {
    const res = await get('/machines/overview')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as {
      range: string
      step: number
      machines: { host: string; state: string; cpuPct: number }[]
    }
    expect(body.range).toBe('24h')
    expect(body.step).toBe(300)
    expect(body.machines).toHaveLength(1)
    expect(body.machines[0]).toMatchObject({ host: 'vps', state: 'reporting' })
  })

  it('rejects a range outside the closed set and a host that is not a plain name, without a query', async () => {
    expect((await get('/machines/overview?range=1y')).status).toBe(422)
    expect((await get("/machines/detail?host=a'%20OR%201=1&range=24h")).status).toBe(422)
    expect((await get('/machines/detail?range=24h')).status).toBe(422)
    expect(bodies).toHaveLength(0)
  })

  it('answers 404 for a host that has not reported in 24 h', async () => {
    const res = await get('/machines/detail?host=ghost&range=1h')
    expect(res.status).toBe(404)
  })

  it('passes the host to ClickHouse as a placeholder value, never as SQL text', async () => {
    await get('/machines/detail?host=vps&range=7d')
    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies.every((sql) => !sql.includes("'vps'"))).toBe(true)
    expect(urls.some((u) => u.includes('param_host=vps'))).toBe(true)
  })

  it('never lets a request choose SQL: the query text does not depend on the query string', async () => {
    await get('/machines/overview?range=7d')
    const first = bodies.slice()
    bodies = []
    await get("/machines/overview?range=7d&metric=x'%3B%20DROP%20TABLE%20a&table=otel_logs")
    // The queries run side by side, so they arrive in any order: the same texts, not the same sequence.
    expect(bodies.toSorted()).toEqual(first.toSorted())
  })

  it('503s with the same error on both endpoints when ClickHouse errors', async () => {
    status = 500
    for (const path of ['/machines/overview', '/machines/detail?host=vps']) {
      const res = await get(path)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'machine data unavailable' })
    }
  })

  it('503s without a configured ClickHouse and makes no request', async () => {
    const off = createClickHouse({ url: '', user: 'u', password: '' })
    const res = await get('/machines/overview', bearer, appFor(off))
    expect(res.status).toBe(503)
    expect(bodies).toHaveLength(0)
  })

  it('503s when ClickHouse is unreachable', async () => {
    const dead = createClickHouse({ url: 'http://127.0.0.1:1', user: 'u', password: 'p' })
    expect((await get('/machines/detail?host=vps', bearer, appFor(dead))).status).toBe(503)
  })
})
