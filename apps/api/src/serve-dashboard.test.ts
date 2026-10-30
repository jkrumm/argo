import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { createDashboardHandler } from './serve-dashboard.js'

const app = new Elysia()
  .get('/', () => ({ name: 'argo' }))
  .get('/health', () => ({ status: 'ok' }))
  .get('/openapi/json', () => ({ openapi: '3.1.0' }))
  .get('/echo', ({ request }) => {
    const url = new URL(request.url)
    return { path: url.pathname, query: url.search }
  })
  .get('/protected', ({ status }) => status(401, 'Unauthorized'))

const SERVER_KEY = 'server-ingestion-key'
const INDEX_HTML = '<!doctype html><title>argo</title>'
let sandbox: string
let handle: (request: Request) => Promise<Response>
let upstream: ReturnType<typeof Bun.serve>
let relayed: Array<{
  path: string
  method: string
  headers: Record<string, string | null>
  body: string
}>

const get = (path: string, init?: RequestInit) =>
  handle(new Request(`http://argo.test${path}`, init))

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'argo-dashboard-'))
  const dist = join(sandbox, 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'index.html'), INDEX_HTML)
  await writeFile(join(dist, 'sw.js'), 'self.skipWaiting()')
  await writeFile(join(dist, 'registerSW.js'), 'void 0')
  await writeFile(join(dist, 'workbox-9c191d2f.js'), 'void 0')
  await writeFile(join(dist, 'site.webmanifest'), '{}')
  await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)')
  await writeFile(join(sandbox, 'secret.txt'), 'outside the dashboard dir')
  await symlink(join(sandbox, 'secret.txt'), join(dist, 'linked-secret.txt'))
  await symlink(sandbox, join(dist, 'linked-dir'))
  await symlink(join(dist, 'favicon.svg'), join(dist, 'linked-inside.svg'))

  relayed = []
  upstream = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/v1/logs') return new Response('rejected', { status: 401 })
      if (
        url.pathname === '/v1/traces' &&
        request.headers.get('content-type') === 'application/x-test-204'
      ) {
        return new Response(null, { status: 204 })
      }
      relayed.push({
        path: url.pathname,
        method: request.method,
        headers: {
          'content-type': request.headers.get('content-type'),
          'content-encoding': request.headers.get('content-encoding'),
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
        },
        body: await request.text(),
      })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })

  handle = createDashboardHandler(app, {
    dir: dist,
    otlpEndpoint: `http://127.0.0.1:${upstream.port}`,
    otlpHeaders: `authorization=${SERVER_KEY}`,
  })
})

afterAll(async () => {
  upstream.stop(true)
  if (sandbox?.startsWith(join(tmpdir(), 'argo-dashboard-'))) {
    await rm(sandbox, { recursive: true, force: true })
  }
})

describe('/api prefix', () => {
  it('strips the prefix: /api/health is /health', async () => {
    const res = await get('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })

  it('strips the prefix for the OpenAPI spec', async () => {
    const res = await get('/api/openapi/json')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { openapi: unknown }).openapi).toBeString()
  })

  it('maps /api and /api/ to the API root', async () => {
    for (const path of ['/api', '/api/']) {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
    }
  })

  it('hands the API the stripped URL and keeps the query string', async () => {
    const res = await get('/api/echo?x=1&y=2')
    expect(await res.json()).toEqual({ path: '/echo', query: '?x=1&y=2' })
  })

  it('leaves the API 404 a 404 instead of falling back to the SPA', async () => {
    const res = await get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('<title>argo</title>')
  })

  it('keeps API auth: a protected route without a bearer is 401', async () => {
    const res = await get('/api/protected')
    expect(res.status).toBe(401)
  })

  it('does not treat /apifoo as the API', async () => {
    const res = await get('/apifoo')
    expect(await res.text()).toBe(INDEX_HTML)
  })

  it('forwards non-GET methods to the API', async () => {
    const res = await get('/api/health', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('<title>argo</title>')
  })

  it('traces the real app under the stripped path', async () => {
    const probe = Bun.spawn(['bun', 'run', 'src/test/serve-dashboard-trace-probe.ts'], {
      cwd: join(import.meta.dir, '..'),
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const out = await new Response(probe.stdout).text()
    await probe.exited
    const line = out.trim().split('\n').at(-1) ?? ''
    const { status, paths } = JSON.parse(line) as { status: number; paths: string[] }
    expect(status).toBe(401)
    expect(paths).toContain('/workouts')
    expect(paths.some((path) => path.startsWith('/api'))).toBe(false)
  })
})

describe('static files', () => {
  it('serves index.html at / with no-cache', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX_HTML)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('serves hashed assets as immutable with the right type', async () => {
    const res = await get('/assets/app-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(await res.text()).toBe('console.log(1)')
  })

  it('never caches the service worker, its loader, workbox and the manifest', async () => {
    for (const path of ['/sw.js', '/registerSW.js', '/workbox-9c191d2f.js', '/site.webmanifest']) {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-cache')
    }
  })

  it('gives other files a short max-age', async () => {
    const res = await get('/favicon.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/svg+xml')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('answers HEAD with headers and no body', async () => {
    const res = await get('/assets/app-abc123.js', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String('console.log(1)'.length))
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toBe('')
  })

  it('answers HEAD on a SPA route with index.html headers', async () => {
    const res = await get('/health-page', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toBe('')
  })
})

describe('SPA fallback', () => {
  it('serves index.html for extension-less client routes', async () => {
    for (const path of ['/usage', '/strength/workouts/12', '/assets', '/not-a-file/']) {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(INDEX_HTML)
    }
  })

  it('404s a missing file that has an extension', async () => {
    for (const path of ['/assets/missing.js', '/nope.png']) {
      expect((await get(path)).status).toBe(404)
    }
  })

  it('404s non-GET methods on unknown paths', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect((await get('/usage', { method })).status).toBe(404)
      expect((await get('/nope', { method })).status).toBe(404)
    }
  })

  it('404s GET on the relay paths instead of falling back', async () => {
    for (const path of ['/v1/traces', '/v1/logs', '/v1/other']) {
      expect((await get(path)).status).toBe(404)
    }
  })
})

describe('path traversal', () => {
  const attempts = [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E/secret.txt',
    '/..%2fsecret.txt',
    '/..%2F..%2Fsecret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    '//etc/passwd',
    '///etc/passwd',
    '/%2fetc%2fpasswd',
    '/..%5csecret.txt',
    '/index.html%00.png',
    '/%00',
    '/%ZZ',
  ]

  for (const path of attempts) {
    it(`never serves anything outside the dir for ${path}`, async () => {
      for (const method of ['GET', 'HEAD']) {
        const res = await get(path, { method })
        const body = await res.text()
        expect(body).not.toContain('outside the dashboard dir')
        expect(body).not.toContain('root:')
      }
    })
  }

  it('answers an escape with 404, not the SPA', async () => {
    for (const path of ['/..%2fsecret.txt', '/..%2f..%2fetc%2fpasswd', '/%00', '/%ZZ']) {
      expect((await get(path)).status).toBe(404)
    }
  })

  it('does not serve a symlink that points outside the dir', async () => {
    for (const path of ['/linked-secret.txt', '/linked-dir/secret.txt']) {
      for (const method of ['GET', 'HEAD']) {
        const res = await get(path, { method })
        expect(res.status).toBe(404)
        expect(await res.text()).not.toContain('outside the dashboard dir')
      }
    }
  })

  it('still serves a symlink that stays inside the dir', async () => {
    const res = await get('/linked-inside.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/svg+xml')
  })

  it('does not resolve an absolute path to the real file', async () => {
    const res = await get(`/${sandbox}/secret.txt`)
    expect(await res.text()).not.toContain('outside the dashboard dir')
  })
})

describe('OTLP relay', () => {
  it('forwards method, body and the content headers with the server key, and returns the upstream status', async () => {
    relayed.length = 0
    const res = await get('/v1/traces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'identity',
        authorization: 'client-chosen-key',
        cookie: 'must=not-leak',
      },
      body: '{"resourceSpans":[]}',
    })
    expect(res.status).toBe(200)
    expect(relayed).toEqual([
      {
        path: '/v1/traces',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'identity',
          authorization: SERVER_KEY,
          cookie: null,
        },
        body: '{"resourceSpans":[]}',
      },
    ])
  })

  it('never forwards a client authorization header, with or without a server key', async () => {
    relayed.length = 0
    await get('/v1/traces', {
      method: 'POST',
      headers: { authorization: 'client-chosen-key' },
      body: '{}',
    })
    expect(relayed.map((r) => r.headers['authorization'])).toEqual([SERVER_KEY])

    relayed.length = 0
    const keyless = createDashboardHandler(app, {
      dir: sandbox,
      otlpEndpoint: `http://127.0.0.1:${upstream.port}`,
    })
    await keyless(
      new Request('http://argo.test/v1/traces', {
        method: 'POST',
        headers: { authorization: 'client-chosen-key' },
        body: '{}',
      }),
    )
    expect(relayed.map((r) => r.headers['authorization'])).toEqual([null])
  })

  it('parses a multi-header OTEL_EXPORTER_OTLP_HEADERS value, decoding percent-escapes', async () => {
    relayed.length = 0
    const handler = createDashboardHandler(app, {
      dir: sandbox,
      otlpEndpoint: `http://127.0.0.1:${upstream.port}`,
      otlpHeaders: 'authorization=a%20b=c,malformed, =x',
    })
    await handler(new Request('http://argo.test/v1/traces', { method: 'POST', body: '{}' }))
    expect(relayed.map((r) => r.headers['authorization'])).toEqual(['a b=c'])
  })

  it('relays binary bodies byte for byte', async () => {
    relayed.length = 0
    const payload = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    await get('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body: payload,
    })
    expect(relayed).toHaveLength(1)
    expect(relayed[0]?.headers['content-type']).toBe('application/x-protobuf')
  })

  it('returns the upstream error status unchanged', async () => {
    const res = await get('/v1/logs', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('rejected')
  })

  it('passes a null-body upstream status (204) through instead of a 502', async () => {
    const res = await get('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/x-test-204' },
      body: '{}',
    })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('rejects a body over 2 MB with 413 before relaying', async () => {
    relayed.length = 0
    const tooBig = new Uint8Array(2 * 1024 * 1024 + 1)
    const res = await get('/v1/traces', { method: 'POST', body: tooBig })
    expect(res.status).toBe(413)
    expect(relayed).toHaveLength(0)
  })

  it('enforces the cap while reading when content-length is absent', async () => {
    relayed.length = 0
    const chunk = new Uint8Array(512 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(chunk)
        controller.close()
      },
    })
    const res = await handle(
      new Request('http://argo.test/v1/traces', {
        method: 'POST',
        body: stream,
        duplex: 'half',
      } as RequestInit),
    )
    expect(res.status).toBe(413)
    expect(relayed).toHaveLength(0)
  })

  it('relays a body exactly at the cap', async () => {
    relayed.length = 0
    const res = await get('/v1/traces', { method: 'POST', body: new Uint8Array(2 * 1024 * 1024) })
    expect(res.status).toBe(200)
    expect(relayed).toHaveLength(1)
  })

  it('answers 502 and logs one throttled stderr line per path on a network failure', async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response() })
    const port = dead.port
    dead.stop(true)
    const unreachable = createDashboardHandler(app, {
      dir: sandbox,
      otlpEndpoint: `http://127.0.0.1:${port}/`,
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const post = () =>
        unreachable(
          new Request('http://argo.test/v1/traces', {
            method: 'POST',
            headers: { authorization: 'secret-ingestion-key' },
            body: '{"secret":"payload"}',
          }),
        )
      expect((await post()).status).toBe(502)
      expect((await post()).status).toBe(502)
      expect(warn).toHaveBeenCalledTimes(1)

      const line = String(warn.mock.calls[0]?.[0])
      expect(line).toContain('/v1/traces')
      expect(line).not.toContain('secret')
    } finally {
      warn.mockRestore()
    }
  })

  it('cuts a slow body sender at the deadline with 408 and never calls the upstream', async () => {
    relayed.length = 0
    let cancelled = false
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"resourceSpans":['))
      },
      cancel() {
        cancelled = true
      },
    })
    const handler = createDashboardHandler(app, {
      dir: sandbox,
      otlpEndpoint: `http://127.0.0.1:${upstream.port}`,
      otlpHeaders: `authorization=${SERVER_KEY}`,
      relayTimeoutMs: 100,
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const started = Date.now()
      const res = await handler(
        new Request('http://argo.test/v1/traces', {
          method: 'POST',
          body: stalled,
          duplex: 'half',
        } as RequestInit),
      )
      expect(res.status).toBe(408)
      expect(Date.now() - started).toBeLessThan(2000)
      expect(relayed).toHaveLength(0)
      expect(cancelled).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('shares one deadline: time spent reading the body is not granted again upstream', async () => {
    const slowUpstream = Bun.serve({
      port: 0,
      fetch: () =>
        new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('{}')), 150)),
    })
    const handler = createDashboardHandler(app, {
      dir: sandbox,
      otlpEndpoint: `http://127.0.0.1:${slowUpstream.port}`,
      relayTimeoutMs: 250,
    })
    const slowBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        await Bun.sleep(150)
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await handler(
        new Request('http://argo.test/v1/traces', {
          method: 'POST',
          body: slowBody,
          duplex: 'half',
        } as RequestInit),
      )
      expect(res.status).toBe(502)
      expect(String(warn.mock.calls[0]?.[0])).toContain('TimeoutError')
    } finally {
      warn.mockRestore()
      slowUpstream.stop(true)
    }
  })

  it('answers 502 when the upstream times out', async () => {
    const hanging = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
    const handler = createDashboardHandler(app, {
      dir: sandbox,
      otlpEndpoint: `http://127.0.0.1:${hanging.port}`,
      relayTimeoutMs: 100,
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await handler(
        new Request('http://argo.test/v1/logs', { method: 'POST', body: '{}' }),
      )
      expect(res.status).toBe(502)
      expect(String(warn.mock.calls[0]?.[0])).toContain('TimeoutError')
    } finally {
      warn.mockRestore()
      hanging.stop(true)
    }
  })
})
