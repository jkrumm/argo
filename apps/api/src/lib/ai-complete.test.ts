import { describe, it, expect } from 'bun:test'
import {
  aiComplete,
  AI_DEFAULT_MAX_COMPLETION_TOKENS,
  type FetchImpl,
  type AiCompleteDeps,
} from './ai-complete.js'
// aiComplete: tests run entirely against mocked upstreams.

const DEEPSEEK_KEY = 'DEEPSEEK_SECRET_KEY'
const DEEPSEEK_BASE = 'https://deepseek-eu.bridge.test/v1'

interface Captured {
  url: string
  method: string
  headers: Headers
  body: RequestInit['body']
}

/** Fake OpenAI-compatible upstream + a log of what it received. */
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

function buildDeps(fetchImpl: FetchImpl): Partial<AiCompleteDeps> {
  return {
    deepseekBaseURL: DEEPSEEK_BASE,
    deepseekApiKey: DEEPSEEK_KEY,
    deepseekModel: 'DeepSeek-V4-Flash',
    // No-op by default; usage-specific tests
    // override this with a capturing recorder.
    recordUsage: async () => {},
    fetchImpl,
  }
}

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
    const captured: Parameters<AiCompleteDeps['recordUsage']>[0][] = []
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
    const captured: Parameters<AiCompleteDeps['recordUsage']>[0][] = []
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
    const captured: Parameters<AiCompleteDeps['recordUsage']>[0][] = []
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
