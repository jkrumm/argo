import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { Elysia } from 'elysia'
import { env } from '../env.js'
import { authGuard } from '../lib/auth-guard.js'
import { createFinanceRoutes } from './finance.js'

// DB-free: the routes under test talk to a fake `fin serve` on a loopback port, so this file runs in
// `make check` (it is listed next to src/lib/ there).

const SERVICE_TOKEN = 'fake-service-token'
// A distinctive 64-hex stand-in for the vault key; the assertions grep for it everywhere.
const VAULT_KEY = 'c0ffee'.repeat(10) + 'beef'.repeat(1) + 'ab'

type Seen = { method: string; path: string; search: string; auth: string | null; body: string }

let seen: Seen[] = []
let reply: () => Response = () => Response.json({ locked: true, unlock_blocked_until: null })
let fake: ReturnType<typeof Bun.serve>

const exporter = new InMemorySpanExporter()

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url)
      seen.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        auth: request.headers.get('authorization'),
        body: await request.text(),
      })
      return reply()
    },
  })
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  )
})

afterAll(() => {
  void fake.stop(true)
})

beforeEach(() => {
  seen = []
  exporter.reset()
  reply = () => Response.json({ locked: true, unlock_blocked_until: null })
})

const baseUrl = () => `http://127.0.0.1:${fake.port}`
const bearer = { Authorization: `Bearer ${env.API_SECRET}` }

const appFor = (config = { baseUrl: baseUrl(), token: SERVICE_TOKEN }) =>
  new Elysia().use(authGuard).use(createFinanceRoutes(config))

const call = (path: string, init: RequestInit = {}, app = appFor()) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { ...bearer, ...(init.headers as Record<string, string> | undefined) },
    }),
  )

describe('auth', () => {
  it('401s every finance route without Argo bearer, before reaching the service', async () => {
    const app = appFor()
    for (const [method, path] of [
      ['GET', '/finance/status'],
      ['POST', '/finance/unlock'],
      ['POST', '/finance/lock'],
      ['POST', '/finance/sync'],
      ['GET', '/finance/sync-runs'],
      ['GET', '/finance/api/meta'],
    ] as const) {
      const res = await app.handle(new Request(`http://localhost${path}`, { method }))
      expect(res.status).toBe(401)
    }
    expect(seen).toHaveLength(0)
  })
})

describe('relay', () => {
  it('forwards GET /finance/status with the service bearer, not Argo’s', async () => {
    const res = await call('/finance/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ locked: true, unlock_blocked_until: null })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      method: 'GET',
      path: '/status',
      auth: `Bearer ${SERVICE_TOKEN}`,
    })
  })

  it('passes /finance/api/* through with the query string intact', async () => {
    reply = () => Response.json([{ month: '2026-10' }])
    const res = await call(
      '/finance/api/transactions?from=2026-01&to=2026-10&search=a%20b&limit=50',
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ month: '2026-10' }])
    expect(seen[0]).toMatchObject({
      path: '/api/transactions',
      search: '?from=2026-01&to=2026-10&search=a%20b&limit=50',
    })
  })

  it('passes nested /finance/api/* paths through', async () => {
    await call('/finance/api/month?month=2026-10')
    expect(seen[0]).toMatchObject({ path: '/api/month', search: '?month=2026-10' })
  })

  it('never lets a /finance/api/* request reach a service path outside /api/', async () => {
    // URL parsing folds `%2e%2e/` into the real /finance/status route; the encoded slash variant
    // reaches the wildcard, which must refuse it (or leave it under /api/).
    await call('/finance/api/%2e%2e/status')
    const res = await call('/finance/api/..%2fstatus')
    expect([200, 400, 404]).toContain(res.status)
    const wildcardCalls = seen.slice(1)
    expect(wildcardCalls.every((s) => s.path.startsWith('/api/'))).toBe(true)
  })

  it('forwards GET /finance/sync-runs with ?limit', async () => {
    reply = () => Response.json([])
    await call('/finance/sync-runs?limit=5')
    expect(seen[0]).toMatchObject({ path: '/sync-runs', search: '?limit=5' })
  })

  it.each([
    ['423', 423, { error: 'locked' }],
    ['409', 409, { error: 'sync already running' }],
    ['429', 429, { error: 'too many attempts', unlock_blocked_until: '2026-11-03T12:00:00Z' }],
  ])('passes %s and its JSON body through unchanged', async (_name, status, body) => {
    reply = () => Response.json(body, { status })
    const res = await call('/finance/api/report?from=2026-01&to=2026-10')
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(body)
  })

  it('relays 202 for POST /finance/sync and 204 for POST /finance/lock', async () => {
    reply = () => Response.json({ started: true }, { status: 202 })
    const sync = await call('/finance/sync', { method: 'POST' })
    expect(sync.status).toBe(202)
    expect(seen[0]).toMatchObject({ method: 'POST', path: '/sync' })

    reply = () => new Response(null, { status: 204 })
    const lock = await call('/finance/lock', { method: 'POST' })
    expect(lock.status).toBe(204)
    expect(await lock.text()).toBe('')
    expect(seen[1]).toMatchObject({ method: 'POST', path: '/lock' })
  })
})

describe('service down or misconfigured', () => {
  it('answers 503 {error:"finance service unavailable"} when the service refuses the connection', async () => {
    const dead = appFor({ baseUrl: 'http://127.0.0.1:1', token: SERVICE_TOKEN })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await call('/finance/status', {}, dead)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'finance service unavailable' })
    } finally {
      warn.mockRestore()
    }
  })

  it('answers 503 without contacting the service when FIN_SERVICE_TOKEN is empty', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await call('/finance/status', {}, appFor({ baseUrl: baseUrl(), token: '' }))
      expect(res.status).toBe(503)
      expect(seen).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('maps a service 401 on a data path to 503, so it never reads as an expired Argo session', async () => {
    reply = () => Response.json({ error: 'unauthorized' }, { status: 401 })
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await call('/finance/api/meta')
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'finance service unavailable' })
    } finally {
      error.mockRestore()
    }
  })
})

describe('POST /finance/unlock', () => {
  it('forwards the body verbatim and relays 204', async () => {
    reply = () => new Response(null, { status: 204 })
    const body = JSON.stringify({ key: VAULT_KEY })
    const res = await call('/finance/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    expect(res.status).toBe(204)
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/unlock',
      auth: `Bearer ${SERVICE_TOKEN}`,
      body,
    })
  })

  it('relays 401 wrong key and 429 throttling as the caller’s own answer', async () => {
    reply = () => Response.json({ error: 'wrong key' }, { status: 401 })
    const wrong = await call('/finance/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'nope' }),
    })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'wrong key' })

    reply = () => Response.json({ error: 'blocked' }, { status: 429 })
    const blocked = await call('/finance/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'nope' }),
    })
    expect(blocked.status).toBe(429)
  })

  it('rejects an oversized body without forwarding it', async () => {
    const res = await call('/finance/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'x'.repeat(10_000) }),
    })
    expect(res.status).toBe(413)
    expect(seen).toHaveLength(0)
  })

  it('never lets the vault key reach the console, OTel log helper output or any span attribute', async () => {
    const sink: unknown[][] = []
    const spies = (['debug', 'info', 'warn', 'error', 'log'] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        sink.push(args)
      }),
    )
    try {
      const send = (app: ReturnType<typeof appFor>) =>
        call(
          '/finance/unlock',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: VAULT_KEY }),
          },
          app,
        )

      // Success, wrong key, throttled, 5xx and an unreachable service: every path that logs.
      for (const status of [204, 401, 429, 500]) {
        reply = () =>
          status === 204
            ? new Response(null, { status })
            : Response.json({ error: 'x' }, { status })
        await send(appFor())
      }
      await send(appFor({ baseUrl: 'http://127.0.0.1:1', token: SERVICE_TOKEN }))
      await send(appFor({ baseUrl: baseUrl(), token: '' }))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }

    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    const everything = JSON.stringify({
      logs: sink.map((args) =>
        args.map((a) => (a instanceof Error ? { message: a.message, stack: a.stack } : a)),
      ),
      spans: spans.map((s) => ({
        name: s.name,
        attributes: s.attributes,
        events: s.events,
        status: s.status,
      })),
    })
    expect(everything).not.toContain(VAULT_KEY)
    expect(everything).not.toContain(SERVICE_TOKEN)
  })

  it('keeps query strings off the upstream span', async () => {
    await call('/finance/api/transactions?search=landlord')
    const span = exporter.getFinishedSpans().find((s) => s.name.startsWith('finance '))
    expect(span).toBeDefined()
    expect(JSON.stringify(span?.attributes)).not.toContain('landlord')
  })
})
