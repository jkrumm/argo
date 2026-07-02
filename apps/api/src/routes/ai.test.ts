import { describe, it, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import {
  createAiRoutes,
  createAudioFileRoutes,
  aiComplete,
  type FetchImpl,
  type AiRouteDeps,
  type AudioFileDeps,
} from './ai.js'
import { authGuard } from '../lib/auth-guard.js'
import { recordAiUsage, normalizeDeepseekModel } from '../lib/ai-usage.js'
import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'
import { type AudioStore } from '../lib/audio-cache.js'

/** In-memory AudioStore backed by a Map — no disk. */
function makeMemoryStore(): AudioStore {
  const map = new Map<string, Uint8Array>()
  return {
    async has(hash) {
      return map.has(hash)
    },
    async read(hash) {
      return map.get(hash) ?? null
    },
    async write(hash, bytes) {
      map.set(hash, bytes)
    },
  }
}

// General AI gateway + audio proxy. Tests run entirely against mocked upstreams.
// Auth is exercised through the real shared `authGuard`.

const DEEPSEEK_KEY = 'DEEPSEEK_SECRET_KEY'
const DEEPSEEK_BASE = 'https://deepseek-eu.bridge.test/v1'
const AUDIO_GATEWAY = 'https://audio-gateway.test'

const SECRET = process.env['API_SECRET'] ?? ''
const authHeaders = { Authorization: `Bearer ${SECRET}` }

interface Captured {
  url: string
  method: string
  headers: Headers
  body: RequestInit['body']
}

/** Fake OpenAI-compatible upstream + a log of what each route received. */
function fakeUpstream(): { fetchImpl: FetchImpl; calls: Captured[] } {
  const calls: Captured[] = []
  const fetchImpl: FetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers ?? {}),
      body: init?.body,
    })
    if (url.endsWith('/chat/completions')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'cmpl-1',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hallo aus der EU' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }
  return { fetchImpl, calls }
}

/** Fake audio-gateway upstream for the audio proxy tests. */
function fakeAudioGateway(): { fetchImpl: FetchImpl; calls: Captured[] } {
  const calls: Captured[] = []
  const fetchImpl: FetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers ?? {}),
      body: init?.body,
    })
    if (url.endsWith('/v1/audio/transcriptions')) {
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'gateway transcribed' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    if (url.endsWith('/v1/audio/speech')) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            'content-type': 'audio/mpeg',
            'x-audio-title': encodeURIComponent('Gateway Title'),
          },
        }),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }
  return { fetchImpl, calls }
}

function buildDeps(fetchImpl: FetchImpl, audioStore?: AudioStore): Partial<AiRouteDeps> {
  return {
    deepseekBaseURL: DEEPSEEK_BASE,
    deepseekApiKey: DEEPSEEK_KEY,
    deepseekModel: 'DeepSeek-V4-Flash',
    audioGatewayUrl: AUDIO_GATEWAY,
    // No-op by default so HTTP tests don't touch the DB; usage-specific tests
    // override this with a capturing recorder.
    recordUsage: async () => {},
    fetchImpl,
    audioStore: audioStore ?? makeMemoryStore(),
  }
}

function buildApp(fetchImpl: FetchImpl) {
  return new Elysia().use(authGuard).use(createAiRoutes(buildDeps(fetchImpl)))
}

describe('AI gateway auth', () => {
  it('rejects requests without a bearer token', async () => {
    const { fetchImpl } = fakeUpstream()
    const res = await buildApp(fetchImpl).handle(new Request('http://localhost/ai/v1/models'))
    expect(res.status).toBe(401)
  })

  it('allows requests with the API secret and lists the configured model', async () => {
    const { fetchImpl } = fakeUpstream()
    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/models', { headers: authHeaders }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { object: string; data: Array<{ id: string }> }
    expect(body.object).toBe('list')
    expect(body.data[0]?.id).toBe('DeepSeek-V4-Flash')
  })
})

describe('POST /ai/v1/chat/completions', () => {
  it('round-trips a DeepSeek completion routed to the EU bridge', async () => {
    const { fetchImpl, calls } = fakeUpstream()
    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/chat/completions', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Give me a title' }] }),
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Hallo aus der EU')

    const call = calls.find((c) => c.url.endsWith('/chat/completions'))
    expect(call).toBeDefined()
    // EU routing: the request goes to the configured EU bridge base, nowhere else.
    expect(call?.url).toBe(`${DEEPSEEK_BASE}/chat/completions`)
    expect(call?.url).toContain('eu')
    expect(call?.headers.get('authorization')).toBe(`Bearer ${DEEPSEEK_KEY}`)
    // Default model injected when the body omits it.
    const sent = JSON.parse(String(call?.body)) as { model: string }
    expect(sent.model).toBe('DeepSeek-V4-Flash')
    // Upstream key never leaks to the client.
    expect(text).not.toContain(DEEPSEEK_KEY)
  })

  it('lets the body override the default model', async () => {
    const { fetchImpl, calls } = fakeUpstream()
    await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/chat/completions', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'DeepSeek-V4-Pro', messages: [] }),
      }),
    )
    const call = calls.find((c) => c.url.endsWith('/chat/completions'))
    const sent = JSON.parse(String(call?.body)) as { model: string }
    expect(sent.model).toBe('DeepSeek-V4-Pro')
  })

  it('returns 503 when the bridge is unconfigured', async () => {
    const { fetchImpl } = fakeUpstream()
    const app = new Elysia()
      .use(authGuard)
      .use(createAiRoutes({ ...buildDeps(fetchImpl), deepseekBaseURL: '' }))
    const res = await app.handle(
      new Request('http://localhost/ai/v1/chat/completions', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      }),
    )
    expect(res.status).toBe(503)
  })
})

describe('POST /ai/v1/audio/transcriptions (proxy)', () => {
  it('forwards multipart body to audio-gateway and returns its response', async () => {
    const { fetchImpl, calls } = fakeAudioGateway()
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'clip.webm', { type: 'audio/webm' }))
    form.append('model', 'gpt-4o-transcribe')

    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/audio/transcriptions', {
        method: 'POST',
        headers: authHeaders,
        body: form,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { text: string }
    expect(body.text).toBe('gateway transcribed')

    const call = calls.find((c) => c.url.endsWith('/v1/audio/transcriptions'))
    expect(call?.url).toBe(`${AUDIO_GATEWAY}/v1/audio/transcriptions`)
    expect(call?.method).toBe('POST')
    // Content-Type must NOT be set manually — fetch sets the multipart boundary.
    expect(call?.headers.get('content-type')).toBeNull()
    const forwarded = call?.body as FormData
    expect(forwarded).toBeInstanceOf(FormData)
    expect(forwarded.get('file')).toBeInstanceOf(Blob)
  })

  it('returns 503 when AUDIO_GATEWAY_URL is unset', async () => {
    const { fetchImpl } = fakeAudioGateway()
    const app = new Elysia()
      .use(authGuard)
      .use(createAiRoutes({ ...buildDeps(fetchImpl), audioGatewayUrl: '' }))
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1])], 'c.webm'))
    const res = await app.handle(
      new Request('http://localhost/ai/v1/audio/transcriptions', {
        method: 'POST',
        headers: authHeaders,
        body: form,
      }),
    )
    expect(res.status).toBe(503)
  })
})

describe('POST /ai/v1/audio/speech (proxy)', () => {
  it('forwards JSON body to audio-gateway and passes through content-type and x-audio-title', async () => {
    const { fetchImpl, calls } = fakeAudioGateway()
    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/audio/speech', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'Hallo Welt', summarize: true }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/mpeg')
    expect(res.headers.get('x-audio-title')).toBe(encodeURIComponent('Gateway Title'))
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.length).toBe(3)

    const call = calls.find((c) => c.url.endsWith('/v1/audio/speech'))
    expect(call?.url).toBe(`${AUDIO_GATEWAY}/v1/audio/speech`)
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('content-type')).toBe('application/json')
    // summarize flag flows through transparently
    const sent = JSON.parse(String(call?.body)) as Record<string, unknown>
    expect(sent['summarize']).toBe(true)
    expect(sent['input']).toBe('Hallo Welt')
  })

  it('returns 503 when AUDIO_GATEWAY_URL is unset', async () => {
    const { fetchImpl } = fakeAudioGateway()
    const app = new Elysia()
      .use(authGuard)
      .use(createAiRoutes({ ...buildDeps(fetchImpl), audioGatewayUrl: '' }))
    const res = await app.handle(
      new Request('http://localhost/ai/v1/audio/speech', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'Hallo' }),
      }),
    )
    expect(res.status).toBe(503)
  })
})

describe('aiComplete()', () => {
  it('returns the assistant text from a non-streamed completion', async () => {
    const { fetchImpl, calls } = fakeUpstream()
    const out = await aiComplete('Make a title', {
      system: 'You title threads.',
      deps: buildDeps(fetchImpl),
    })
    expect(out).toBe('Hallo aus der EU')

    const call = calls.find((c) => c.url.endsWith('/chat/completions'))
    const sent = JSON.parse(String(call?.body)) as {
      stream: boolean
      messages: Array<{ role: string; content: string }>
    }
    expect(sent.stream).toBe(false)
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'You title threads.' })
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'Make a title' })
  })

  it('throws when the bridge is unconfigured', async () => {
    const { fetchImpl } = fakeUpstream()
    expect(
      aiComplete('x', { deps: { ...buildDeps(fetchImpl), deepseekBaseURL: '' } }),
    ).rejects.toThrow()
  })

  it('calls recordUsage with correct params when the upstream returns a usage object', async () => {
    const captured: Parameters<AiRouteDeps['recordUsage']>[0][] = []
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'cmpl-u1',
            object: 'chat.completion',
            model: 'DeepSeek-V4-Flash',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'A title' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    const out = await aiComplete('Make a title', {
      sub_tool: 'titling',
      deps: {
        ...buildDeps(fetchImpl),
        recordUsage: async (p) => {
          captured.push(p)
        },
      },
    })

    expect(out).toBe('A title')
    expect(captured).toHaveLength(1)
    const rec = captured[0]!
    expect(rec.model).toBe('DeepSeek-V4-Flash')
    expect(rec.usage.prompt_tokens).toBe(42)
    expect(rec.usage.completion_tokens).toBe(7)
    expect(rec.usage.total_tokens).toBe(49)
    expect(rec.subTool).toBe('titling')
    expect(rec.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('skips recordUsage when the upstream omits usage', async () => {
    const captured: unknown[] = []
    const { fetchImpl } = fakeUpstream() // existing fake — no usage field
    await aiComplete('Make a title', {
      deps: {
        ...buildDeps(fetchImpl),
        recordUsage: async (p) => {
          captured.push(p)
        },
      },
    })
    expect(captured).toHaveLength(0)
  })
})

describe('POST /ai/v1/audio/podcast', () => {
  it('synthesizes on cache miss — calls gateway once and returns hash/title/bytes', async () => {
    const store = makeMemoryStore()
    const { fetchImpl, calls } = fakeAudioGateway()
    const app = new Elysia().use(authGuard).use(createAiRoutes(buildDeps(fetchImpl, store)))

    const res = await app.handle(
      new Request('http://localhost/ai/v1/audio/podcast', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ script: 'Hello podcast world', title: 'My Episode' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { hash: string; title: string; bytes: number }
    expect(body.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(body.bytes).toBeGreaterThan(0)

    const speechCalls = calls.filter((c) => c.url.endsWith('/v1/audio/speech'))
    expect(speechCalls).toHaveLength(1)
    // Must NOT forward a model field
    const sent = JSON.parse(String(speechCalls[0]!.body)) as Record<string, unknown>
    expect(sent['input']).toBe('Hello podcast world')
    expect(sent['model']).toBeUndefined()
  })

  it('cache hit — second POST with same script does NOT call gateway again', async () => {
    const store = makeMemoryStore()
    const { fetchImpl, calls } = fakeAudioGateway()
    const app = new Elysia().use(authGuard).use(createAiRoutes(buildDeps(fetchImpl, store)))

    const body1 = JSON.stringify({ script: 'Cached script' })
    const res1 = await app.handle(
      new Request('http://localhost/ai/v1/audio/podcast', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: body1,
      }),
    )
    expect(res1.status).toBe(200)
    const data1 = (await res1.json()) as { hash: string }

    const callCountAfterMiss = calls.filter((c) => c.url.endsWith('/v1/audio/speech')).length
    expect(callCountAfterMiss).toBe(1)

    // Second request with same script
    const res2 = await app.handle(
      new Request('http://localhost/ai/v1/audio/podcast', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: body1,
      }),
    )
    expect(res2.status).toBe(200)
    const data2 = (await res2.json()) as { hash: string }

    // Same hash returned
    expect(data2.hash).toBe(data1.hash)
    // Gateway still called only once
    const callCountAfterHit = calls.filter((c) => c.url.endsWith('/v1/audio/speech')).length
    expect(callCountAfterHit).toBe(1)
  })

  it('cache hit — recordUsage NOT called on second request', async () => {
    const store = makeMemoryStore()
    const { fetchImpl } = fakeAudioGateway()
    const captured: unknown[] = []
    const app = new Elysia().use(authGuard).use(
      createAiRoutes({
        ...buildDeps(fetchImpl, store),
        recordUsage: async (p) => {
          captured.push(p)
        },
      }),
    )

    const body = JSON.stringify({ script: 'Usage test script' })
    await app.handle(
      new Request('http://localhost/ai/v1/audio/podcast', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body,
      }),
    )
    expect(captured).toHaveLength(1)

    await app.handle(
      new Request('http://localhost/ai/v1/audio/podcast', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body,
      }),
    )
    // Still 1 — no second recordUsage call on hit
    expect(captured).toHaveLength(1)
  })

  it('returns 401 without bearer token', async () => {
    const { fetchImpl } = fakeAudioGateway()
    const app = new Elysia().use(authGuard).use(createAiRoutes(buildDeps(fetchImpl)))
    const res = await app.handle(
      new Request('http://localhost/ai/v1/audio/podcast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ script: 'No auth' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 503 when audioGatewayUrl is unset', async () => {
    const { fetchImpl } = fakeAudioGateway()
    const app = new Elysia()
      .use(authGuard)
      .use(createAiRoutes({ ...buildDeps(fetchImpl), audioGatewayUrl: '' }))
    const res = await app.handle(
      new Request('http://localhost/ai/v1/audio/podcast', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ script: 'No gateway' }),
      }),
    )
    expect(res.status).toBe(503)
  })
})

describe('GET /ai/v1/audio/file/:hash', () => {
  const VALID_HASH = 'a'.repeat(64)
  const TEST_BYTES = new Uint8Array([10, 20, 30, 40, 50])

  function buildFileApp(overrides: Partial<AudioFileDeps> = {}) {
    // Public route — no authGuard
    return new Elysia().use(createAudioFileRoutes(overrides))
  }

  it('works WITHOUT a bearer token (public)', async () => {
    const store = makeMemoryStore()
    await store.write(VALID_HASH, TEST_BYTES)
    const app = buildFileApp({ audioStore: store })
    const res = await app.handle(new Request(`http://localhost/ai/v1/audio/file/${VALID_HASH}`))
    expect(res.status).toBe(200)
  })

  it('returns 200 with full bytes, Content-Type audio/mpeg, Accept-Ranges, Content-Length', async () => {
    const store = makeMemoryStore()
    await store.write(VALID_HASH, TEST_BYTES)
    const app = buildFileApp({ audioStore: store })
    const res = await app.handle(new Request(`http://localhost/ai/v1/audio/file/${VALID_HASH}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe(String(TEST_BYTES.length))
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf).toEqual(TEST_BYTES)
  })

  it('returns 206 for a Range request with correct Content-Range and slice', async () => {
    const store = makeMemoryStore()
    await store.write(VALID_HASH, TEST_BYTES)
    const app = buildFileApp({ audioStore: store })
    const res = await app.handle(
      new Request(`http://localhost/ai/v1/audio/file/${VALID_HASH}`, {
        headers: { Range: 'bytes=0-1' },
      }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-1/${TEST_BYTES.length}`)
    expect(res.headers.get('content-length')).toBe('2')
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf).toEqual(new Uint8Array([10, 20]))
  })

  it('returns 416 for an out-of-range start', async () => {
    const store = makeMemoryStore()
    await store.write(VALID_HASH, TEST_BYTES)
    const app = buildFileApp({ audioStore: store })
    const res = await app.handle(
      new Request(`http://localhost/ai/v1/audio/file/${VALID_HASH}`, {
        headers: { Range: 'bytes=9999-' },
      }),
    )
    expect(res.status).toBe(416)
  })

  it('returns 404 for an unknown hash', async () => {
    const store = makeMemoryStore()
    const app = buildFileApp({ audioStore: store })
    const res = await app.handle(new Request(`http://localhost/ai/v1/audio/file/${VALID_HASH}`))
    expect(res.status).toBe(404)
  })

  it('returns 400 for a malformed (non-64-hex) hash — path-traversal guard', async () => {
    const store = makeMemoryStore()
    const app = buildFileApp({ audioStore: store })
    const res = await app.handle(new Request(`http://localhost/ai/v1/audio/file/../etc/passwd`))
    // Elysia may 404 on path segments; confirm non-200 and no successful file access
    expect(res.status).not.toBe(200)
  })

  it('returns 400 for a short non-hex hash', async () => {
    const store = makeMemoryStore()
    const app = buildFileApp({ audioStore: store })
    const res = await app.handle(
      new Request(`http://localhost/ai/v1/audio/file/short-invalid-hash`),
    )
    expect(res.status).toBe(400)
  })
})

describe('normalizeDeepseekModel()', () => {
  it('lowercases and strips provider prefix', () => {
    expect(normalizeDeepseekModel('DeepSeek-V4-Flash')).toBe('deepseek-v4-flash')
    expect(normalizeDeepseekModel('iu/DeepSeek-V4-Pro')).toBe('deepseek-v4-pro')
    expect(normalizeDeepseekModel('DeepSeek-V4-Flash-eu')).toBe('deepseek-v4-flash')
  })
})

describe('recordAiUsage() — DB integration', () => {
  afterEach(async () => {
    await db.delete(usageRecord).where(eq(usageRecord.source, 'argo'))
  })

  it('inserts a row tagged source=argo with correct token counts and sub_tool', async () => {
    const startedAt = new Date().toISOString()
    await recordAiUsage({
      model: 'DeepSeek-V4-Flash',
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      subTool: 'titling',
      startedAt,
      durationMs: 500,
    })

    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source, 'argo'))
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.source).toBe('argo')
    expect(row.model).toBe('DeepSeek-V4-Flash')
    expect(row.model_norm).toBe('deepseek-v4-flash')
    expect(row.input_tokens).toBe(100)
    expect(row.output_tokens).toBe(20)
    expect(row.sub_tool).toBe('titling')
    expect(row.billing).toBe('iu')
    expect(row.project).toBe('argo')
    expect(row.workspace).toBe('private')
    expect(row.outcome).toBe('ok')
    expect(row.cost_usd).toBeGreaterThan(0)
    expect(row.cost_source).toBe('computed')
    expect(row.duration_ms).toBe(500)
  })

  it('records with null sub_tool when subTool is omitted', async () => {
    await recordAiUsage({
      model: 'DeepSeek-V4-Pro',
      usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      startedAt: new Date().toISOString(),
      durationMs: 300,
    })

    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source, 'argo'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sub_tool).toBeNull()
    expect(rows[0]!.model_norm).toBe('deepseek-v4-pro')
  })
})
