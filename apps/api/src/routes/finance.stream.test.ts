import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { env } from '../env.js'
import { authGuard } from '../lib/auth-guard.js'
import { createDashboardHandler } from '../serve-dashboard.js'
import { createFinanceRoutes } from './finance.js'

// The event stream over real sockets: the fake `fin serve` on one port, Argo behind the production
// dashboard handler on another. What matters here (frames as they come, the upstream ending with the
// client) does not show through `app.handle`.

const SERVICE_TOKEN = 'fake-service-token'
const FRAME = 'event: state\ndata: {"symbol":"IE00BK5BQT80","live":true,"reason":null}\n\n'

type Upstream = { search: string; auth: string | null; gone: Promise<void>; end: () => void }

let opened: Upstream[] = []
let refusal: Response | null = null
let service: ReturnType<typeof Bun.serve>
let argo: ReturnType<typeof Bun.serve>

beforeAll(() => {
  service = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      if (refusal !== null) return refusal
      const gone = Promise.withResolvers<void>()
      let end = (): void => {}
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(FRAME))
          end = () => controller.close()
        },
        cancel: () => gone.resolve(),
      })
      request.signal.addEventListener('abort', () => gone.resolve())
      opened.push({
        search: new URL(request.url).search,
        auth: request.headers.get('authorization'),
        gone: gone.promise,
        end: () => end(),
      })
      return new Response(body, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      })
    },
  })
  const app = new Elysia().use(authGuard).use(
    createFinanceRoutes({
      baseUrl: `http://127.0.0.1:${service.port}`,
      token: SERVICE_TOKEN,
    }),
  )
  argo = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: createDashboardHandler(app, { dir: '/nonexistent', otlpEndpoint: 'http://127.0.0.1:1' }),
  })
})

afterAll(() => {
  void argo.stop(true)
  void service.stop(true)
})

beforeEach(() => {
  opened = []
  refusal = null
})

const open = (signal?: AbortSignal, auth = true): Promise<Response> =>
  fetch(
    `http://127.0.0.1:${argo.port}/api/finance/api/market/stream?symbols=IE00BK5BQT80&mic=XETR`,
    {
      headers: auth ? { Authorization: `Bearer ${env.API_SECRET}` } : {},
      ...(signal && { signal }),
    },
  )

const firstText = async (response: Response) => {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const { value } = await reader.read()
  return { reader, text: new TextDecoder().decode(value) }
}

describe('GET /finance/api/market/stream', () => {
  it('relays the first event while the stream is still open, with the service bearer and the query', async () => {
    const abort = new AbortController()
    const response = await open(abort.signal)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toStartWith('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await firstText(response)).text).toBe(FRAME)
    expect(opened[0]?.search).toBe('?symbols=IE00BK5BQT80&mic=XETR')
    expect(opened[0]?.auth).toBe(`Bearer ${SERVICE_TOKEN}`)
    abort.abort()
  })

  it('ends the upstream request when its own client goes', async () => {
    const abort = new AbortController()
    await firstText(await open(abort.signal))
    abort.abort()
    await opened[0]?.gone
  })

  it('ends its answer when the service ends the stream', async () => {
    const { reader } = await firstText(await open())
    opened[0]?.end()
    expect((await reader.read()).done).toBe(true)
  })

  it('401s without the Argo bearer, before reaching the service', async () => {
    expect((await open(undefined, false)).status).toBe(401)
    expect(opened).toHaveLength(0)
  })

  it('relays a refused symbol list, and maps a refused service token to 503', async () => {
    refusal = Response.json({ error: 'symbols is required' }, { status: 400 })
    const bad = await open()
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'symbols is required' })
    refusal = Response.json({ error: 'unauthorized' }, { status: 401 })
    expect((await open()).status).toBe(503)
  })
})
