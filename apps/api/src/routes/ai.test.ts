import { describe, it, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import {
  createAiRoutes,
  aiComplete,
  AI_DEFAULT_MAX_COMPLETION_TOKENS,
  type FetchImpl,
  type AiRouteDeps,
} from './ai.js'
import { authGuard } from '../lib/auth-guard.js'
import { recordAiUsage, normalizeDeepseekModel } from '../lib/ai-usage.js'
import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'
// General AI gateway. Tests run entirely against mocked upstreams.
// Auth is exercised through the real shared `authGuard`.

const DEEPSEEK_KEY = 'DEEPSEEK_SECRET_KEY'
const DEEPSEEK_BASE = 'https://deepseek-eu.bridge.test/v1'

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

function buildDeps(fetchImpl: FetchImpl): Partial<AiRouteDeps> {
  return {
    deepseekBaseURL: DEEPSEEK_BASE,
    deepseekApiKey: DEEPSEEK_KEY,
    deepseekModel: 'DeepSeek-V4-Flash',
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

  it('records an error-outcome row (zero tokens, real durationMs) when the upstream returns non-2xx', async () => {
    const captured: Parameters<AiRouteDeps['recordUsage']>[0][] = []
    const fetchImpl: FetchImpl = () => Promise.resolve(new Response('bad request', { status: 400 }))

    await expect(
      aiComplete('Make a title', {
        deps: {
          ...buildDeps(fetchImpl),
          recordUsage: async (p) => {
            captured.push(p)
          },
        },
      }),
    ).rejects.toThrow('AI completion failed: 400')

    expect(captured).toHaveLength(1)
    const rec = captured[0]!
    expect(rec.outcome).toBe('error')
    expect(rec.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
    expect(rec.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does not record when the upstream is never called (pre-call failure)', async () => {
    const captured: unknown[] = []
    const { fetchImpl } = fakeUpstream()
    await expect(
      aiComplete('x', {
        deps: {
          ...buildDeps(fetchImpl),
          deepseekBaseURL: '',
          recordUsage: async (p) => {
            captured.push(p)
          },
        },
      }),
    ).rejects.toThrow()
    expect(captured).toHaveLength(0)
  })

  it('a throwing recordUsage does not mask the original upstream error', async () => {
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(new Response('server error', { status: 500 }))

    await expect(
      aiComplete('Make a title', {
        deps: {
          ...buildDeps(fetchImpl),
          recordUsage: async () => {
            throw new Error('DB write failed')
          },
        },
      }),
    ).rejects.toThrow('AI completion failed: 500')
  })

  it('retries once with doubled max_completion_tokens when the first response is empty, and returns the second attempt', async () => {
    const calls: Captured[] = []
    let attempt = 0
    const fetchImpl: FetchImpl = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers ?? {}),
        body: init?.body,
      })
      attempt++
      const content = attempt === 1 ? '' : 'Second attempt content'
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content }, finish_reason: attempt === 1 ? 'length' : 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    }

    const out = await aiComplete('Make a title', { deps: buildDeps(fetchImpl) })
    expect(out).toBe('Second attempt content')
    expect(calls).toHaveLength(2)
    const firstBody = JSON.parse(String(calls[0]?.body)) as { max_completion_tokens: number }
    const secondBody = JSON.parse(String(calls[1]?.body)) as { max_completion_tokens: number }
    expect(firstBody.max_completion_tokens).toBe(AI_DEFAULT_MAX_COMPLETION_TOKENS)
    expect(secondBody.max_completion_tokens).toBe(AI_DEFAULT_MAX_COMPLETION_TOKENS * 2)
  })

  it('throws when two attempts in a row return truncated content', async () => {
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    await expect(aiComplete('Make a title', { deps: buildDeps(fetchImpl) })).rejects.toThrow(
      'AI completion returned no usable content',
    )
  })

  it('records the discarded truncated attempt as outcome "error", never "ok"', async () => {
    const captured: Parameters<AiRouteDeps['recordUsage']>[0][] = []
    let attempt = 0
    const fetchImpl: FetchImpl = () => {
      attempt++
      const content = attempt === 1 ? '' : 'Recovered content'
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content }, finish_reason: attempt === 1 ? 'length' : 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    }

    const out = await aiComplete('Make a title', {
      deps: {
        ...buildDeps(fetchImpl),
        recordUsage: async (p) => {
          captured.push(p)
        },
      },
    })

    expect(out).toBe('Recovered content')
    expect(captured).toHaveLength(2)
    expect(captured[0]?.outcome).toBe('error')
    expect(captured[1]?.outcome ?? 'ok').toBe('ok')
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

  it('defaults billing to "iu" and outcome to "ok" when both are omitted', async () => {
    await recordAiUsage({
      model: 'DeepSeek-V4-Flash',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      startedAt: new Date().toISOString(),
      durationMs: 100,
    })

    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source, 'argo'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.billing).toBe('iu')
    expect(rows[0]!.outcome).toBe('ok')
  })

  it('honours an explicit billing/outcome override', async () => {
    await recordAiUsage({
      model: 'audio-gateway/tts',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      startedAt: new Date().toISOString(),
      durationMs: 250,
      billing: 'unknown',
      outcome: 'error',
    })

    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source, 'argo'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.billing).toBe('unknown')
    expect(rows[0]!.outcome).toBe('error')
  })

  it('splits cached_tokens out of input_tokens into cache_read_tokens, and records reasoning_tokens', async () => {
    await recordAiUsage({
      model: 'deepseek-v4.1-flash',
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        cached_tokens: 300,
        reasoning_tokens: 50,
      },
      startedAt: new Date().toISOString(),
      durationMs: 400,
    })

    const rows = await db.select().from(usageRecord).where(eq(usageRecord.source, 'argo'))
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.input_tokens).toBe(700)
    expect(row.cache_read_tokens).toBe(300)
    expect(row.output_tokens).toBe(200)
    expect(row.reasoning_tokens).toBe(50)
    // 700 uncached @ $0.50 + 300 cached @ $0.05 + 200 output @ $1.50, per 1M tokens
    expect(row.cost_usd).toBeCloseTo((700 * 0.3 + 300 * 0.006 + 200 * 1.2) / 1_000_000, 10)
  })
})
