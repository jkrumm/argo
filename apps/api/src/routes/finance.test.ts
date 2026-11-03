import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { Elysia } from 'elysia'
import { env } from '../env.js'
import { authGuard } from '../lib/auth-guard.js'
import { tracer } from '../telemetry.js'
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

/**
 * Every span `tracedFetch` opens, with the attributes it was created with and each call made on it
 * afterwards (setAttribute, recordException, setStatus). Recorded by wrapping `tracer.startActiveSpan`
 * rather than by installing a global provider: that is first-come across test files in one bun
 * process, and the tracer caches its delegate.
 */
type SpanRecord = { name: string; attributes: unknown; calls: unknown[][] }
let spans: SpanRecord[] = []
let spanSpy: ReturnType<typeof spyOn>
const startActiveSpan = tracer.startActiveSpan.bind(tracer) as (...args: unknown[]) => unknown

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
})

afterAll(() => {
  void fake.stop(true)
})

afterEach(() => spanSpy.mockRestore())

beforeEach(() => {
  seen = []
  spans = []
  spanSpy = spyOn(tracer, 'startActiveSpan').mockImplementation(((
    name: string,
    options: { attributes?: unknown },
    fn: (span: object) => unknown,
  ) => {
    const record: SpanRecord = { name, attributes: options.attributes, calls: [] }
    spans.push(record)
    return startActiveSpan(name, options, (span: object) =>
      fn(
        new Proxy(span, {
          get(target, prop) {
            const value = Reflect.get(target, prop) as unknown
            if (typeof value !== 'function') return value
            return (...args: unknown[]) => {
              record.calls.push([String(prop), ...args])
              return (value as (...a: unknown[]) => unknown).apply(target, args)
            }
          },
        }),
      ),
    )
  }) as never)
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

  it('refuses encoded dots and slashes in /finance/api/* before they reach the service', async () => {
    for (const path of [
      '/finance/api/..%2fstatus',
      '/finance/api/%5c..%5cstatus',
      '/finance/api/a%2fb',
    ]) {
      const res = await call(path)
      expect([path, res.status]).toEqual([path, 400])
    }
    expect(seen).toHaveLength(0)
    // URL parsing folds a literal `%2e%2e/` into the real /finance/status route; that is still the
    // service's own /status, never a path outside /api/ or the mapped routes.
    const folded = await call('/finance/api/%2e%2e/status')
    expect(folded.status).toBe(200)
    expect(seen.map((s) => s.path)).toEqual(['/status'])
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

  it('maps a non-"wrong key" 401 on /unlock (a refused service token) to 503, not to a wrong key', async () => {
    reply = () => Response.json({ error: 'unauthorized' }, { status: 401 })
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await call('/finance/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'x' }),
      })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'finance service unavailable' })
    } finally {
      error.mockRestore()
    }
  })

  it('measures the cap in bytes: a multibyte body under 4096 characters but over 4096 bytes is refused', async () => {
    const res = await call('/finance/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ü'.repeat(3000) }),
    })
    expect(res.status).toBe(413)
    expect(seen).toHaveLength(0)
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

    expect(spans.length).toBeGreaterThan(0)
    const everything = JSON.stringify({
      logs: sink.map((args) =>
        args.map((a) => (a instanceof Error ? { message: a.message, stack: a.stack } : a)),
      ),
      spans,
    })
    expect(everything).not.toContain(VAULT_KEY)
    expect(everything).not.toContain(SERVICE_TOKEN)
  })

  it('keeps /finance/api/* query strings out of every log line, on every failure path', async () => {
    const sink: unknown[][] = []
    const spies = (['debug', 'info', 'warn', 'error', 'log'] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        sink.push(args)
      }),
    )
    try {
      const path = '/finance/api/transactions?search=landlord&merchant=Grocer'
      reply = () => Response.json({ error: 'unauthorized' }, { status: 401 })
      await call(path)
      await call(path, {}, appFor({ baseUrl: 'http://127.0.0.1:1', token: SERVICE_TOKEN }))
      await call(path, {}, appFor({ baseUrl: baseUrl(), token: '' }))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    expect(sink.length).toBeGreaterThan(0)
    const logged = JSON.stringify(
      sink.map((args) => args.map((a) => (a instanceof Error ? a.message : a))),
    )
    expect(logged).not.toContain('landlord')
    expect(logged).not.toContain('Grocer')
  })

  it('keeps the query string off the span of a failed call too', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await call(
        '/finance/api/transactions?search=landlord&merchant=Grocer',
        {},
        appFor({ baseUrl: 'http://127.0.0.1:1', token: SERVICE_TOKEN }),
      )
    } finally {
      warn.mockRestore()
    }
    const text = JSON.stringify(spans)
    expect(text).toContain('recordException')
    expect(text).not.toContain('landlord')
    expect(text).not.toContain('Grocer')
  })

  it('keeps query strings off the upstream span', async () => {
    await call('/finance/api/transactions?search=landlord')
    const span = spans.find((s) => s.name.startsWith('finance '))
    expect(span).toBeDefined()
    expect(JSON.stringify(span)).not.toContain('landlord')
  })
})

describe('POST /finance/api/* (typed writes)', () => {
  const json = { 'Content-Type': 'application/json' }
  const post = (path: string, body: string, app = appFor()) =>
    call(path, { method: 'POST', headers: json, body }, app)

  it.each([
    ['/finance/api/transactions/ab12cd34ef/category', '/api/transactions/ab12cd34ef/category'],
    ['/finance/api/transactions/ab12cd34ef/tag', '/api/transactions/ab12cd34ef/tag'],
    ['/finance/api/recurring/overrides', '/api/recurring/overrides'],
    ['/finance/api/merchant-rules', '/api/merchant-rules'],
  ])('relays %s with the body verbatim and the service bearer', async (path, upstream) => {
    reply = () => Response.json({ ok: true }, { status: 200 })
    const body = JSON.stringify({ category: 'food/groceries', note: 'Müller ✓' })
    const res = await post(path, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: upstream,
      search: '',
      auth: `Bearer ${SERVICE_TOKEN}`,
      body,
    })
  })

  it('refuses every other POST path without reaching the service', async () => {
    for (const path of [
      '/finance/api/transactions',
      '/finance/api/transactions/ab12/amount',
      '/finance/api/transactions/ab12/category/extra',
      '/finance/api/transactions//tag',
      '/finance/api/recurring',
      '/finance/api/recurring/overrides/x',
      '/finance/api/meta',
      '/finance/api/sync',
      '/finance/api/transactions/ab..12/tag/../../merchant-rules',
      '/finance/api/transactions/%2e%2e/tag',
      '/finance/api/transactions/a%2fb/category',
    ]) {
      const res = await post(path, '{}')
      expect([path, res.status]).toEqual([path, 400])
    }
    expect(seen).toHaveLength(0)
  })

  it('does not open a write path for other methods', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await call('/finance/api/merchant-rules', { method, headers: json, body: '{}' })
      expect([method, res.status === 404 || res.status === 405]).toEqual([method, true])
    }
    expect(seen).toHaveLength(0)
  })

  it('401s a write without Argo bearer, before reaching the service', async () => {
    const res = await appFor().handle(
      new Request('http://localhost/finance/api/merchant-rules', { method: 'POST', body: '{}' }),
    )
    expect(res.status).toBe(401)
    expect(seen).toHaveLength(0)
  })

  it('caps the body at 16 KB, measured in bytes', async () => {
    const just = JSON.stringify({ pattern: 'a'.repeat(16 * 1024 - 15) })
    expect(new TextEncoder().encode(just).byteLength).toBeLessThanOrEqual(16 * 1024)
    expect((await post('/finance/api/merchant-rules', just)).status).toBe(200)

    const long = JSON.stringify({ pattern: 'a'.repeat(16 * 1024) })
    expect((await post('/finance/api/merchant-rules', long)).status).toBe(413)
    // Multibyte: under 16384 characters, over 16384 bytes.
    const multibyte = JSON.stringify({ pattern: 'ü'.repeat(9000) })
    expect(multibyte.length).toBeLessThan(16 * 1024)
    expect((await post('/finance/api/merchant-rules', multibyte)).status).toBe(413)
    expect(seen).toHaveLength(1)
  })

  it.each([
    [400, { error: 'unknown category' }],
    [404, { error: 'unknown booking' }],
    [423, { error: 'locked' }],
  ])('passes the service’s %s and its body through', async (status, body) => {
    reply = () => Response.json(body, { status })
    const res = await post('/finance/api/transactions/ab12/category', '{"category":"x"}')
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(body)
  })

  it('maps a refused service token to 503, never a 401 the dashboard would read as logged out', async () => {
    reply = () => Response.json({ error: 'unauthorized' }, { status: 401 })
    const error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await post('/finance/api/merchant-rules', '{"pattern":"x"}')
      expect(res.status).toBe(503)
    } finally {
      error.mockRestore()
    }
  })

  it('keeps write bodies and ids out of logs and span attributes on every path', async () => {
    const sink: unknown[][] = []
    const spies = (['debug', 'info', 'warn', 'error', 'log'] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        sink.push(args)
      }),
    )
    const secret = JSON.stringify({ pattern: 'landlord-gmbh', note: 'private-note-xyz' })
    try {
      const path = '/finance/api/merchant-rules'
      for (const status of [200, 400, 423, 500]) {
        reply = () => Response.json({ error: 'x' }, { status })
        await post(path, secret)
      }
      reply = () => Response.json({ error: 'unauthorized' }, { status: 401 })
      await post(path, secret)
      await post(path, secret, appFor({ baseUrl: 'http://127.0.0.1:1', token: SERVICE_TOKEN }))
      await post(path, secret, appFor({ baseUrl: baseUrl(), token: '' }))
      await post(path, JSON.stringify({ pattern: 'a'.repeat(20_000) }))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    expect(spans.length).toBeGreaterThan(0)
    const everything = JSON.stringify({
      logs: sink.map((args) => args.map((a) => (a instanceof Error ? a.message : a))),
      spans,
    })
    expect(everything).not.toContain('landlord-gmbh')
    expect(everything).not.toContain('private-note-xyz')
    expect(everything).not.toContain(SERVICE_TOKEN)
  })

  it('masks the booking id in span attributes and log lines, on every path that logs', async () => {
    const sink: unknown[][] = []
    const spies = (['debug', 'info', 'warn', 'error', 'log'] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        sink.push(args)
      }),
    )
    const id = 'f00dfacecafe1234'
    try {
      for (const kind of ['category', 'tag']) {
        const path = `/finance/api/transactions/${id}/${kind}`
        reply = () => Response.json({ ok: true })
        await post(path, '{}')
        reply = () => Response.json({ error: 'unauthorized' }, { status: 401 })
        await post(path, '{}')
        await post(path, '{}', appFor({ baseUrl: 'http://127.0.0.1:1', token: SERVICE_TOKEN }))
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    const spanText = JSON.stringify(spans)
    expect(spanText).toContain('/api/transactions/:id/category')
    expect(spanText).not.toContain(id)
    const logged = JSON.stringify(
      sink.map((args) => args.map((a) => (a instanceof Error ? a.message : a))),
    )
    expect(sink.length).toBeGreaterThan(0)
    expect(logged).not.toContain(id)
  })

  it('keeps the query string of a write off the upstream span', async () => {
    await call('/finance/api/merchant-rules?search=landlord', {
      method: 'POST',
      headers: json,
      body: '{}',
    })
    const span = spans.find((s) => s.name.startsWith('finance '))
    expect(span).toBeDefined()
    expect(JSON.stringify(span)).not.toContain('landlord')
  })
})
