import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { env } from '../env.js'
import { authGuard } from '../lib/auth-guard.js'
import { createModelsRoutes } from './models.js'

// DB-free: the route talks to a fake modelpick server on a loopback port (in `make check`).

type Seen = { method: string; path: string; auth: string | null }

let seen: Seen[] = []
let reply: () => Response = () => Response.json({ variants: [] })
let fake: ReturnType<typeof Bun.serve>

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname,
        auth: request.headers.get('authorization'),
      })
      return reply()
    },
  })
})

afterAll(() => {
  void fake.stop(true)
})

beforeEach(() => {
  seen = []
  reply = () => Response.json({ variants: [] })
})

const appFor = (baseUrl = `http://127.0.0.1:${fake.port}`) =>
  new Elysia().use(authGuard).use(createModelsRoutes({ baseUrl }))

const get = (path: string, headers: Record<string, string> = {}, app = appFor()) =>
  app.handle(new Request(`http://localhost${path}`, { headers }))

const bearer = { Authorization: `Bearer ${env.API_SECRET}` }

describe('GET /models/efficiency', () => {
  it('401s without the Argo bearer, before reaching the service', async () => {
    const res = await get('/models/efficiency')
    expect(res.status).toBe(401)
    expect(seen).toHaveLength(0)
  })

  it('relays modelpick /api/efficiency without forwarding Argo’s bearer', async () => {
    reply = () => Response.json({ capturedAt: null, variants: [{ slug: 'a' }] })
    const res = await get('/models/efficiency', bearer)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ capturedAt: null, variants: [{ slug: 'a' }] })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(seen).toEqual([{ method: 'GET', path: '/api/efficiency', auth: null }])
  })

  it('passes the service status through', async () => {
    reply = () => Response.json({ error: 'snapshot missing' }, { status: 500 })
    const res = await get('/models/efficiency', bearer)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'snapshot missing' })
  })

  it('answers 503 when the service is down', async () => {
    const down = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('x') })
    const baseUrl = `http://127.0.0.1:${down.port}`
    await down.stop(true)
    const res = await get('/models/efficiency', bearer, appFor(baseUrl))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'models service unavailable' })
  })
})
