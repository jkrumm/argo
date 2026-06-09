import { describe, it, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createAiRoutes, aiComplete, type FetchImpl, type AiRouteDeps } from './ai.js'
import { mapWithConcurrency } from '../lib/tts/audio.js'
import { authGuard } from '../lib/auth-guard.js'
import { recordAiUsage, normalizeDeepseekModel } from '../lib/ai-usage.js'
import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

// General AI gateway + native audio. Tests run entirely against mocked upstreams
// (the IU unified endpoint — OpenAI dialect for chat/STT/TTS-prep, and the native
// Gemini generateContent for TTS synth); no live cross-machine services and no
// ffmpeg (the transcoder is stubbed). Auth is exercised through the real shared
// `authGuard`. The IU OpenAI base/key are shared by chat, STT and the TTS prep LLM.

const DEEPSEEK_KEY = 'DEEPSEEK_SECRET_KEY'
const DEEPSEEK_BASE = 'https://deepseek-eu.bridge.test/v1'
const GEMINI_BASE = 'https://gemini.iu.test/v1beta'

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
        new Response(JSON.stringify({ text: 'transcribed words', language: 'de' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }
  return { fetchImpl, calls }
}

/** Fake IU upstreams for the Gemini TTS path: prep LLM (/chat/completions) + synth. */
function fakeTtsUpstream(prepChunks?: Array<{ style: string; text: string }>): {
  fetchImpl: FetchImpl
  calls: Captured[]
} {
  const calls: Captured[] = []
  const chunks = prepChunks ?? [{ style: 'ruhig', text: 'Hallo Welt' }]
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
        Response.json({
          choices: [
            { message: { content: JSON.stringify({ lang: 'de', title: 'Kurzer Titel', chunks }) } },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 12, total_tokens: 15 },
        }),
      )
    }
    if (url.includes(':generateContent')) {
      const pcm = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64')
      return Promise.resolve(
        Response.json({
          candidates: [
            {
              content: { parts: [{ inlineData: { data: pcm, mimeType: 'audio/L16;rate=24000' } }] },
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
        }),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }
  return { fetchImpl, calls }
}

/** Deterministic transcode stub — avoids any ffmpeg dependency in tests. */
const stubTranscode: AiRouteDeps['transcodePcm'] = (_pcm, _sr, opus) =>
  Promise.resolve({
    bytes: new Uint8Array([9, 9, 9]).buffer,
    contentType: opus ? 'audio/ogg' : 'audio/mpeg',
  })

function buildDeps(fetchImpl: FetchImpl): Partial<AiRouteDeps> {
  return {
    deepseekBaseURL: DEEPSEEK_BASE,
    deepseekApiKey: DEEPSEEK_KEY,
    deepseekModel: 'DeepSeek-V4-Flash',
    geminiBaseURL: GEMINI_BASE,
    transcodePcm: stubTranscode,
    // No-op by default so HTTP tests don't touch the DB; usage-specific tests
    // override this with a capturing recorder.
    recordUsage: async () => {},
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
  it('transcribes multipart audio against the IU endpoint and injects language steering', async () => {
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
    expect(JSON.stringify(body)).not.toContain(DEEPSEEK_KEY)

    const call = calls.find((c) => c.url.endsWith('/audio/transcriptions'))
    // STT targets the IU OpenAI base directly with the IU key (no audio-proxy hop).
    expect(call?.url).toBe(`${DEEPSEEK_BASE}/audio/transcriptions`)
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('authorization')).toBe(`Bearer ${DEEPSEEK_KEY}`)
    const forwarded = call?.body as FormData
    expect(forwarded).toBeInstanceOf(FormData)
    expect(forwarded.get('model')).toBe('gpt-4o-transcribe')
    expect(forwarded.get('file')).toBeInstanceOf(Blob)
    expect(forwarded.get('response_format')).toBe('json')
    // No client prompt → default German/English steering is injected upstream.
    expect(String(forwarded.get('prompt'))).toContain('Deutsch')
  })

  it('returns 503 when the IU base is unconfigured', async () => {
    const { fetchImpl } = fakeUpstream()
    const app = new Elysia()
      .use(authGuard)
      .use(createAiRoutes({ ...buildDeps(fetchImpl), deepseekBaseURL: '' }))
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

describe('POST /ai/v1/audio/speech (Gemini expressive)', () => {
  it('runs prep + synth + transcode and returns titled audio', async () => {
    const { fetchImpl, calls } = fakeTtsUpstream()
    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/audio/speech', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        // No model → defaults to the Gemini TTS model → expressive pipeline.
        body: JSON.stringify({ input: 'Hallo Welt' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/mpeg')
    expect(res.headers.get('x-audio-title')).toBe(encodeURIComponent('Kurzer Titel'))
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.length).toBe(3) // from the transcode stub

    // Prep LLM hit the IU OpenAI base with the prep model.
    const prep = calls.find((c) => c.url.endsWith('/chat/completions'))
    expect(prep?.url).toBe(`${DEEPSEEK_BASE}/chat/completions`)
    expect((JSON.parse(String(prep?.body)) as { model: string }).model).toBe('DeepSeek-V4-Pro')

    // Synth hit the native Gemini generateContent base with the IU key, style+text joined.
    const synth = calls.find((c) => c.url.includes(':generateContent'))
    expect(synth?.url).toBe(`${GEMINI_BASE}/models/gemini-3.1-flash-tts-preview:generateContent`)
    expect(synth?.headers.get('authorization')).toBe(`Bearer ${DEEPSEEK_KEY}`)
    const synthBody = JSON.parse(String(synth?.body)) as {
      contents: Array<{ parts: Array<{ text: string }> }>
    }
    expect(synthBody.contents[0]?.parts[0]?.text).toBe('ruhig: Hallo Welt')
  })

  it('returns 503 when the Gemini base is unconfigured', async () => {
    const { fetchImpl } = fakeTtsUpstream()
    const app = new Elysia()
      .use(authGuard)
      .use(createAiRoutes({ ...buildDeps(fetchImpl), geminiBaseURL: '' }))
    const res = await app.handle(
      new Request('http://localhost/ai/v1/audio/speech', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'Hallo' }),
      }),
    )
    expect(res.status).toBe(503)
  })

  it('synthesizes every chunk of long input', async () => {
    const { fetchImpl, calls } = fakeTtsUpstream([
      { style: 's', text: 'one' },
      { style: 's', text: 'two' },
      { style: 's', text: 'three' },
    ])
    const res = await buildApp(fetchImpl).handle(
      new Request('http://localhost/ai/v1/audio/speech', {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'long input goes here' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(calls.filter((c) => c.url.includes(':generateContent'))).toHaveLength(3)
  })
})

describe('mapWithConcurrency()', () => {
  it('preserves input order in the result regardless of completion order', async () => {
    // Item 0 resolves slowest, item 2 fastest — result must still be [0,1,2].
    const out = await mapWithConcurrency([30, 15, 1], 3, async (ms, i) => {
      await Bun.sleep(ms)
      return i
    })
    expect(out).toEqual([0, 1, 2])
  })

  it('bounds concurrency to the limit', async () => {
    let active = 0
    let peak = 0
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        active++
        peak = Math.max(peak, active)
        await Bun.sleep(5)
        active--
      },
    )
    expect(peak).toBeLessThanOrEqual(3)
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
