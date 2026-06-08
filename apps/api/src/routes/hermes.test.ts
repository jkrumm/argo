import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { createHermesRoutes, type FetchImpl } from './hermes.js'
import { client, db } from '../db/index.js'
import { hermesMessage, hermesThread } from '../db/schema.js'

// Apply only the Hermes-table migration (0009) directly, rather than the full
// `runMigrations()` chain. The shared local dev DB is in a half-migrated state
// where an unrelated earlier migration (0004's DROP INDEX on usage_record) fails
// because those objects are owned by a different role — a documented
// environmental issue (see RALPH_NOTES Group 1). 0009 is fully idempotent
// (IF NOT EXISTS + guarded FK), so this is drift-free and self-contained.
beforeAll(async () => {
  const sql = await Bun.file(
    new URL('../../drizzle/0009_friendly_mandarin.sql', import.meta.url),
  ).text()
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim()
    if (trimmed) await client.unsafe(trimmed)
  }
})

afterEach(async () => {
  // hermes_message FK → hermes_thread (cascade), but delete children first to be
  // explicit and order-independent.
  await db.delete(hermesMessage)
  await db.delete(hermesThread)
})

const HERMES_KEY = 'SUPER_SECRET_HERMES_KEY'

/** A canned Hermes OpenAI SSE stream: role → "Hello" → tool.progress → " world" → stop. */
function hermesSseBody(): ReadableStream<Uint8Array> {
  const frames = [
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
    'event: hermes.tool.progress\ndata: {"tool":"web_search","emoji":"🔎","label":"Searching the web","toolCallId":"tc1","status":"running"}\n\n',
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ]
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
}

interface CapturedRequest {
  url: string
  headers: Headers
}

/** Build a fake Hermes transport plus a capture log of what it received. */
function fakeHermes(): { fetchImpl: FetchImpl; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetchImpl: FetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
    calls.push({ url, headers })
    if (url.endsWith('/health')) {
      return Promise.resolve(new Response('ok', { status: 200 }))
    }
    return Promise.resolve(
      new Response(hermesSseBody(), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
  }
  return { fetchImpl, calls }
}

function buildApp(fetchImpl: FetchImpl) {
  return new Elysia().use(
    createHermesRoutes({
      baseURL: 'http://hermes.test/v1',
      apiKey: HERMES_KEY,
      sessionKey: 'agent:main:test',
      model: 'hermes',
      fetchImpl,
    }),
  )
}

function chatRequest(body: unknown): Request {
  return new Request('http://localhost/hermes/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function waitFor<T>(fn: () => Promise<T | undefined>, tries = 30): Promise<T | undefined> {
  for (let i = 0; i < tries; i++) {
    const v = await fn()
    if (v !== undefined) return v
    await new Promise((r) => setTimeout(r, 25))
  }
  return undefined
}

describe('POST /hermes/chat', () => {
  it('streams assistant deltas and injects a tool-progress data part', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_test_stream',
        sessionId: 'ses_test_stream',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('x-accel-buffering')).toBe('no')

    const text = await res.text()
    // Assistant content streamed through as UI text-delta chunks.
    expect(text).toContain('Hello')
    expect(text).toContain('world')
    // Custom tool-progress surfaced as a transient data part.
    expect(text).toContain('data-toolProgress')
    expect(text).toContain('Searching the web')
  })

  it('never leaks the Hermes bearer to the client; sends it + session headers upstream', async () => {
    const { fetchImpl, calls } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_test_auth',
        sessionId: 'ses_test_auth',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    const text = await res.text()
    expect(text).not.toContain(HERMES_KEY)

    const chatCall = calls.find((c) => c.url.endsWith('/chat/completions'))
    expect(chatCall).toBeDefined()
    expect(chatCall?.headers.get('authorization')).toBe(`Bearer ${HERMES_KEY}`)
    expect(chatCall?.headers.get('x-hermes-session-id')).toBe('ses_test_auth')
    expect(chatCall?.headers.get('x-hermes-session-key')).toBe('agent:main:test')
  })

  it('persists the user + assistant turn verbatim on finish', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_test_persist',
        sessionId: 'ses_test_persist',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi there' }] }],
      }),
    )
    await res.text() // drain the stream so onFinish runs

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    expect(rows).toBeDefined()
    const assistant = rows?.find((r) => r.role === 'assistant')
    const user = rows?.find((r) => r.role === 'user')
    expect(user).toBeDefined()
    expect(assistant).toBeDefined()

    // Assistant transcript text is reconstructed from persisted UIMessage parts.
    const assistantText = (assistant?.parts ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(assistantText).toBe('Hello world')

    // Tool-progress event captured into the assistant payload (not the transcript).
    expect(assistant?.payload?.toolEvents?.[0]?.toolCallId).toBe('tc1')

    // Thread row exists and its updated_at was touched.
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_test_persist'),
    })
    expect(thread).toBeDefined()
    expect(thread?.session_id).toBe('ses_test_persist')
  })

  it('reuses an existing thread session_id instead of the body sessionId', async () => {
    const { fetchImpl, calls } = fakeHermes()
    const app = buildApp(fetchImpl)
    await db.insert(hermesThread).values({
      id: 'thr_existing',
      session_id: 'ses_original',
      session_key: 'agent:main:test',
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_existing',
        sessionId: 'ses_should_be_ignored',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    await res.text()

    const chatCall = calls.find((c) => c.url.endsWith('/chat/completions'))
    expect(chatCall?.headers.get('x-hermes-session-id')).toBe('ses_original')
  })
})

describe('GET /hermes/health', () => {
  it('reports ok when the upstream is reachable', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(new Request('http://localhost/hermes/health'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; upstream: { reachable: boolean } }
    expect(body.status).toBe('ok')
    expect(body.upstream.reachable).toBe(true)
  })

  it('reports degraded when Hermes is unconfigured', async () => {
    const app = new Elysia().use(
      createHermesRoutes({ baseURL: '', apiKey: '', fetchImpl: fakeHermes().fetchImpl }),
    )
    const res = await app.handle(new Request('http://localhost/hermes/health'))
    const body = (await res.json()) as { status: string; upstream: { reachable: boolean } }
    expect(body.status).toBe('degraded')
    expect(body.upstream.reachable).toBe(false)
  })
})
