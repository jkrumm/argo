import { describe, it, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createAiRoutes, aiComplete, type FetchImpl, type AiRouteDeps } from './ai.js'
import { authGuard } from '../lib/auth-guard.js'
import { recordAiUsage, normalizeDeepseekModel } from '../lib/ai-usage.js'
import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

// Group 3 — General AI gateway. Tests run entirely against mocked upstreams
// (DeepSeek EU bridge + audio-proxy); no live cross-machine services. Auth is
// exercised through the real shared `authGuard`.

const DEEPSEEK_KEY = 'DEEPSEEK_SECRET_KEY'
const AUDIO_KEY = 'AUDIO_PROXY_SECRET_KEY'
const DEEPSEEK_BASE = 'https://deepseek-eu.bridge.test/v1'
const AUDIO_BASE = 'http://audio-proxy.test/v1'

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
    if (url.endsWith('/audio/transcriptions')) {
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'transcribed words' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    if (url.endsWith('/audio/speech')) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4, 5]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }
  return { fetchImpl, calls }
}

function buildDeps(fetchImpl: FetchImpl): Partial<AiRouteDeps> {
  return {
    deepseekBaseURL: DEEPSEEK_BASE,
    deepseekApiKey: DEEPSEEK_KEY,
    deepseekModel: 'DeepSeek-V4-Flash',
    audioBaseURL: AUDIO_BASE,
    audioApiKey: AUDIO_KEY,
    fetchImpl,
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

describe('POST /ai/v1/audio/transcriptions', () => {
  it('forwards multipart audio to the audio-proxy with the right shape', async () => {
    const { fetchImpl, calls } = fakeUpstream()
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'clip.webm', { type: 'audio/webm' }))
    form.append('model', 'gpt-4o-transcribe')
    form.append('response_format', 'json')

    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/audio/transcriptions', {
        method: 'POST',
        headers: authHeaders,
        body: form,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { text: string }
    expect(body.text).toBe('transcribed words')
    expect(JSON.stringify(body)).not.toContain(AUDIO_KEY)

    const call = calls.find((c) => c.url.endsWith('/audio/transcriptions'))
    expect(call?.url).toBe(`${AUDIO_BASE}/audio/transcriptions`)
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('authorization')).toBe(`Bearer ${AUDIO_KEY}`)
    const forwarded = call?.body as FormData
    expect(forwarded).toBeInstanceOf(FormData)
    expect(forwarded.get('model')).toBe('gpt-4o-transcribe')
    expect(forwarded.get('file')).toBeInstanceOf(Blob)
  })
})

describe('POST /ai/v1/audio/speech', () => {
  it('forwards JSON and returns audio bytes', async () => {
    const { fetchImpl, calls } = fakeUpstream()
    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/audio/speech', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-tts', input: 'Hallo Welt', voice: 'Charon' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/mpeg')
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.length).toBe(5)

    const call = calls.find((c) => c.url.endsWith('/audio/speech'))
    expect(call?.url).toBe(`${AUDIO_BASE}/audio/speech`)
    expect(call?.headers.get('authorization')).toBe(`Bearer ${AUDIO_KEY}`)
    const sent = JSON.parse(String(call?.body)) as { input: string }
    expect(sent.input).toBe('Hallo Welt')
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
