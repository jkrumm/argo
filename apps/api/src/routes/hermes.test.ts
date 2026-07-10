import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { createHermesRoutes, type FetchImpl, type HermesRouteDeps } from './hermes.js'
import type { HermesStreaming } from '../lib/resumable.js'
import { client, db } from '../db/index.js'
import { hermesMessage, hermesThread } from '../db/schema.js'

// Apply Hermes-table migrations directly rather than the full `runMigrations()`
// chain. The shared local dev DB is in a half-migrated state where an unrelated
// earlier migration (0004's DROP INDEX on usage_record) fails because those
// objects are owned by a different role — a documented environmental issue (see
// RALPH_NOTES Group 1). All Hermes migrations are fully idempotent
// (IF NOT EXISTS + guarded FK), so this is drift-free and self-contained.
beforeAll(async () => {
  for (const file of [
    '../../drizzle/0009_friendly_mandarin.sql',
    '../../drizzle/0010_far_george_stacy.sql',
    '../../drizzle/0014_fixed_hercules.sql',
  ]) {
    const sql = await Bun.file(new URL(file, import.meta.url)).text()
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim()
      if (trimmed) await client.unsafe(trimmed)
    }
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

function buildApp(fetchImpl: FetchImpl, extra: Partial<HermesRouteDeps> = {}) {
  return new Elysia().use(
    createHermesRoutes({
      baseURL: 'http://hermes.test/v1',
      apiKey: HERMES_KEY,
      sessionKey: 'agent:main:test',
      model: 'hermes',
      fetchImpl,
      // Default to no-ops so the env-based DeepSeek path isn't exercised
      // (no live bridge in the loop); titling/summarization tested explicitly below.
      generateTitle: async () => '',
      generateSummary: async () => ({ summary: '', type: 'general' }),
      // No-op so streaming tests don't write rows into argo.usage_record.
      recordUsage: async () => {},
      // Deterministic default: the v1 non-durable path (a client disconnect
      // interrupts). Durable-path tests inject a fake via `extra.streaming`. This
      // pins behavior regardless of whether REDIS_URL leaks into the test env.
      streaming: null,
      ...extra,
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

  it('persists user-supplied attachments in the user message payload', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const attachment = { type: 'text', title: 'Context', content: 'Some context here' }

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_test_attach',
        sessionId: 'ses_test_attach',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        attachments: [attachment],
      }),
    )
    await res.text()

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    const user = rows?.find((r) => r.role === 'user')
    expect(user?.payload?.attachments).toHaveLength(1)
    expect(user?.payload?.attachments?.[0]).toMatchObject(attachment)
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

describe('auto-titling', () => {
  it('titles a fresh thread from the first exchange (via the mocked gateway)', async () => {
    const { fetchImpl } = fakeHermes()
    let received: { userText: string; assistantText: string } | undefined
    const app = buildApp(fetchImpl, {
      // Stand-in for the DeepSeek gateway; returns a quoted/padded title to also
      // exercise the cleanup (quote strip + whitespace collapse + trim).
      generateTitle: async (input) => {
        received = input
        return '  "Weather in Berlin"  '
      },
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_test_title',
        sessionId: 'ses_test_title',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi there' }] }],
      }),
    )
    await res.text()

    const titled = await waitFor(async () => {
      const t = await db.query.hermesThread.findFirst({
        where: eq(hermesThread.id, 'thr_test_title'),
      })
      return t?.title ? t : undefined
    })
    expect(titled?.title).toBe('Weather in Berlin')
    // The titler saw the persisted first user + assistant text.
    expect(received?.userText).toBe('hi there')
    expect(received?.assistantText).toBe('Hello world')
  })

  it('does not retitle a thread that already has a title', async () => {
    const { fetchImpl } = fakeHermes()
    let calls = 0
    const app = buildApp(fetchImpl, {
      generateTitle: async () => {
        calls++
        return 'Should not be used'
      },
    })
    await db.insert(hermesThread).values({
      id: 'thr_already_titled',
      session_id: 'ses_already_titled',
      session_key: 'agent:main:test',
      title: 'Existing title',
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_already_titled',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    await res.text()

    // Give any (incorrect) background titling a chance to run, then assert it didn't.
    await new Promise((r) => setTimeout(r, 100))
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_already_titled'),
    })
    expect(thread?.title).toBe('Existing title')
    expect(calls).toBe(0)
  })
})

/**
 * A fake Hermes whose stream emits the assistant role + partial content, then
 * aborts the client request signal and keeps trickling deltas (never sending a
 * finish) — simulating a client disconnect mid-response (the v1 "interrupted"
 * path). The trickle matters: streamText only observes the abort the next time
 * its upstream `reader.read()` resolves, so the stream must stay live.
 */
function abortingHermes(abort: () => void): FetchImpl {
  const encoder = new TextEncoder()
  const delta = (content: string) =>
    encoder.encode(
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"content":${JSON.stringify(content)}},"finish_reason":null}]}\n\n`,
    )
  return (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/health')) return Promise.resolve(new Response('ok', { status: 200 }))
    let timer: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
          ),
        )
        controller.enqueue(delta('Partial answer'))
        setTimeout(abort, 30)
        // Keep the stream live (and unfinished) so the abort is observed.
        timer = setInterval(() => {
          try {
            controller.enqueue(delta('.'))
          } catch {
            // controller closed once the abort tore the stream down
          }
        }, 10)
      },
      cancel() {
        if (timer) clearInterval(timer)
      },
    })
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
  }
}

describe('interrupted streams', () => {
  it("persists the partial assistant message with status:'interrupted' on client abort", async () => {
    const controller = new AbortController()
    const app = buildApp(abortingHermes(() => controller.abort()))

    const req = new Request('http://localhost/hermes/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'thr_test_interrupt',
        sessionId: 'ses_test_interrupt',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'tell me a story' }] }],
      }),
      signal: controller.signal,
    })

    const res = await app.handle(req)
    await res.text().catch(() => undefined) // drain; the abort may cut it short

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    const assistant = rows?.find((r) => r.role === 'assistant')
    const user = rows?.find((r) => r.role === 'user')
    expect(user?.status).toBe('complete')
    expect(assistant).toBeDefined()
    expect(assistant?.status).toBe('interrupted')
  })
})

/** A Hermes whose chat call rejects — simulates an upstream network failure. */
function erroringHermes(): FetchImpl {
  return (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/health')) return Promise.resolve(new Response('ok', { status: 200 }))
    return Promise.reject(new Error('upstream exploded'))
  }
}

describe('failed streams', () => {
  it("persists the assistant turn with status:'error' when the upstream fails", async () => {
    const app = buildApp(erroringHermes())
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_test_error',
        sessionId: 'ses_test_error',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    await res.text().catch(() => undefined) // drain; the error may cut it short

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    const assistant = rows?.find((r) => r.role === 'assistant')
    const user = rows?.find((r) => r.role === 'user')
    expect(user?.status).toBe('complete')
    expect(assistant).toBeDefined()
    expect(assistant?.status).toBe('error')
  })

  it('returns 503 without streaming when the upstream is unconfigured', async () => {
    const app = new Elysia().use(
      createHermesRoutes({ baseURL: '', apiKey: '', fetchImpl: fakeHermes().fetchImpl }),
    )
    const res = await app.handle(
      chatRequest({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('hermes_unconfigured')
    // Nothing is persisted on the short-circuit.
    const rows = await db.query.hermesMessage.findMany()
    expect(rows.length).toBe(0)
  })
})

describe('thread read CRUD', () => {
  it('creates a thread, minting a session_id and defaulting the session_key', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      new Request('http://localhost/hermes/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'My thread' }),
      }),
    )
    expect(res.status).toBe(200)
    const row = (await res.json()) as {
      id: string
      session_id: string
      session_key: string
      title: string | null
      status: string
      pinned: number
    }
    expect(row.id.startsWith('thr-')).toBe(true)
    expect(row.session_id.startsWith('ses-')).toBe(true)
    expect(row.session_key).toBe('agent:main:test')
    expect(row.title).toBe('My thread')
    expect(row.status).toBe('active')
    expect(row.pinned).toBe(0)
  })

  it('lists threads pinned-first then newest, excluding archived by default', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    await db.insert(hermesThread).values([
      {
        id: 'thr_old',
        session_id: 's1',
        session_key: 'k',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'thr_new',
        session_id: 's2',
        session_key: 'k',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'thr_pinned',
        session_id: 's3',
        session_key: 'k',
        pinned: 1,
        updated_at: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'thr_archived',
        session_id: 's4',
        session_key: 'k',
        status: 'archived',
        updated_at: '2026-06-05T00:00:00.000Z',
      },
    ])

    const res = await app.handle(new Request('http://localhost/hermes/threads'))
    const body = (await res.json()) as { data: Array<{ id: string }>; total: number }
    expect(body.total).toBe(3) // archived excluded
    expect(body.data.map((t) => t.id)).toEqual(['thr_pinned', 'thr_new', 'thr_old'])

    // ?status=all includes the archived one.
    const allRes = await app.handle(new Request('http://localhost/hermes/threads?status=all'))
    const all = (await allRes.json()) as { total: number }
    expect(all.total).toBe(4)
  })

  it('returns a thread transcript in verbatim order', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    await app
      .handle(
        chatRequest({
          threadId: 'thr_transcript',
          sessionId: 'ses_transcript',
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi there' }] }],
        }),
      )
      .then((r) => r.text())

    await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })

    const res = await app.handle(
      new Request('http://localhost/hermes/threads/thr_transcript/messages'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>
      total: number
    }
    expect(body.total).toBe(2)
    // User precedes assistant (deterministic created_at stamping).
    expect(body.data.map((m) => m.role)).toEqual(['user', 'assistant'])
    const assistantText = (body.data[1]?.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(assistantText).toBe('Hello world')
  })

  it('404s the transcript of a missing thread', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(new Request('http://localhost/hermes/threads/thr_nope/messages'))
    expect(res.status).toBe(404)
  })

  it('renames, pins, and archives a thread via PATCH', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    await db.insert(hermesThread).values({
      id: 'thr_patch',
      session_id: 'ses_patch',
      session_key: 'k',
    })

    const patch = (body: unknown) =>
      app.handle(
        new Request('http://localhost/hermes/threads/thr_patch', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )

    const renamed = (await (await patch({ title: 'Renamed', pinned: true })).json()) as {
      title: string
      pinned: number
    }
    expect(renamed.title).toBe('Renamed')
    expect(renamed.pinned).toBe(1)

    const archived = (await (await patch({ archived: true })).json()) as {
      status: string
      archived_at: string | null
    }
    expect(archived.status).toBe('archived')
    expect(archived.archived_at).not.toBeNull()

    const unarchived = (await (await patch({ archived: false })).json()) as {
      status: string
      archived_at: string | null
    }
    expect(unarchived.status).toBe('active')
    expect(unarchived.archived_at).toBeNull()
  })

  it('404s a PATCH to a missing thread', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      new Request('http://localhost/hermes/threads/thr_nope', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      }),
    )
    expect(res.status).toBe(404)
  })

  it('deletes a thread and cascades its messages via DELETE', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    await db.insert(hermesThread).values({
      id: 'thr_del',
      session_id: 'ses_del',
      session_key: 'k',
    })
    await db.insert(hermesMessage).values({
      id: 'msg_del',
      thread_id: 'thr_del',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
      status: 'complete',
    })

    const res = await app.handle(
      new Request('http://localhost/hermes/threads/thr_del', { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { id: string }).id).toBe('thr_del')

    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_del'),
    })
    expect(thread).toBeUndefined()
    const message = await db.query.hermesMessage.findFirst({
      where: eq(hermesMessage.id, 'msg_del'),
    })
    expect(message).toBeUndefined()
  })

  it('404s a DELETE to a missing thread', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      new Request('http://localhost/hermes/threads/thr_nope', { method: 'DELETE' }),
    )
    expect(res.status).toBe(404)
  })

  it('returns summary and type as null for a fresh thread', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    await db.insert(hermesThread).values({
      id: 'thr_nullfields',
      session_id: 'ses_nullfields',
      session_key: 'k',
    })

    const res = await app.handle(new Request('http://localhost/hermes/threads'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<{ id: string; summary: unknown; type: unknown }>
      total: number
    }
    const row = body.data.find((t) => t.id === 'thr_nullfields')
    expect(row).toBeDefined()
    expect(row?.summary).toBeNull()
    expect(row?.type).toBeNull()
  })
})

describe('auto-summarization', () => {
  it('writes summary and type on the first finished turn', async () => {
    const { fetchImpl } = fakeHermes()
    let received: { userText: string; assistantText: string } | undefined
    const app = buildApp(fetchImpl, {
      generateSummary: async (input) => {
        received = input
        return { summary: 'A discussion about weather', type: 'research' }
      },
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_sum_first',
        sessionId: 'ses_sum_first',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi there' }] }],
      }),
    )
    await res.text()

    const summarized = await waitFor(async () => {
      const t = await db.query.hermesThread.findFirst({
        where: eq(hermesThread.id, 'thr_sum_first'),
      })
      return t?.summary ? t : undefined
    })
    expect(summarized?.summary).toBe('A discussion about weather')
    expect(summarized?.type).toBe('research')
    expect(received?.userText).toBe('hi there')
    expect(received?.assistantText).toBe('Hello world')
  })

  it('does not re-summarize a thread that already has a summary', async () => {
    const { fetchImpl } = fakeHermes()
    let calls = 0
    const app = buildApp(fetchImpl, {
      generateSummary: async () => {
        calls++
        return { summary: 'Should not be written', type: 'general' }
      },
    })
    await db.insert(hermesThread).values({
      id: 'thr_sum_existing',
      session_id: 'ses_sum_existing',
      session_key: 'agent:main:test',
      summary: 'Existing summary',
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_sum_existing',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    await res.text()

    await new Promise((r) => setTimeout(r, 100))
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_sum_existing'),
    })
    expect(thread?.summary).toBe('Existing summary')
    expect(calls).toBe(0)
  })

  it('coerces an unknown type to "general"', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl, {
      generateSummary: async () => ({ summary: 'A summary', type: 'unknown_type' }),
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_sum_coerce',
        sessionId: 'ses_sum_coerce',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    await res.text()

    const thread = await waitFor(async () => {
      const t = await db.query.hermesThread.findFirst({
        where: eq(hermesThread.id, 'thr_sum_coerce'),
      })
      return t?.summary ? t : undefined
    })
    expect(thread?.type).toBe('general')
    expect(thread?.summary).toBe('A summary')
  })

  it('swallows errors from the summarizer (fire-and-forget; malformed JSON case)', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl, {
      generateSummary: async () => {
        throw new Error('simulated malformed JSON parse failure')
      },
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_sum_throw',
        sessionId: 'ses_sum_throw',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    // Stream completes successfully — the summarizer error is swallowed.
    expect(res.status).toBe(200)
    await res.text()

    await new Promise((r) => setTimeout(r, 100))
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_sum_throw'),
    })
    expect(thread).toBeDefined()
    expect(thread?.summary).toBeNull()
  })

  it('skips summarization on an aborted turn', async () => {
    const controller = new AbortController()
    let calls = 0
    const app = buildApp(
      abortingHermes(() => controller.abort()),
      {
        generateSummary: async () => {
          calls++
          return { summary: 'Should not be written', type: 'general' }
        },
      },
    )

    const req = new Request('http://localhost/hermes/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'thr_sum_abort',
        sessionId: 'ses_sum_abort',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
      signal: controller.signal,
    })
    const res = await app.handle(req)
    await res.text().catch(() => undefined)

    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toBe(0)
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

// ── Durable streaming (resumable-stream + abort registry) ────────────────────
//
// These exercise OUR wiring around the durable path with an in-memory fake
// standing in for the Valkey-backed resumable-stream context: the active-stream
// pointer lifecycle, decoupled generation surviving a client disconnect, the
// resume endpoint, and the explicit-stop → interrupted path. The real
// resumable-stream/ioredis library is third-party (verified separately); here we
// test the boundary our code owns.

interface FakeEntry {
  buffer: string
  done: boolean
}

/** In-memory stand-in for `HermesStreaming`: buffers the SSE the producer emits
 *  (draining it drives generation with no client attached) and replays it on resume. */
function fakeStreaming(): HermesStreaming & { streams: Map<string, FakeEntry> } {
  const streams = new Map<string, FakeEntry>()
  const registry = new Map<string, AbortController>()
  return {
    streams,
    async createNewResumableStream(streamId, make) {
      const entry: FakeEntry = { buffer: '', done: false }
      streams.set(streamId, entry)
      const reader = make().getReader()
      // Background drain — drives generation (and thus persistence) to completion
      // even when no client is reading the HTTP response (the disconnect case).
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            entry.buffer += value
          }
        } catch {
          // stream torn down by an abort — stop buffering
        } finally {
          entry.done = true
        }
      })()
    },
    async resumeExistingStream(streamId) {
      const entry = streams.get(streamId)
      if (!entry) return null
      const { buffer } = entry
      return new ReadableStream<string>({
        start(controller) {
          if (buffer) controller.enqueue(buffer)
          controller.close()
        },
      })
    },
    register(streamId, controller) {
      registry.set(streamId, controller)
    },
    abort(streamId) {
      const controller = registry.get(streamId)
      if (!controller) return false
      controller.abort()
      return true
    },
    unregister(streamId) {
      registry.delete(streamId)
    },
    async close() {
      streams.clear()
      registry.clear()
    },
  }
}

/** A Hermes stream that emits role + a partial delta then trickles forever until
 *  aborted — keeps a turn "live" so active_stream_id stays set for the stop test. */
function infiniteHermes(): FetchImpl {
  const encoder = new TextEncoder()
  const delta = (content: string) =>
    encoder.encode(
      `data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"content":${JSON.stringify(content)}},"finish_reason":null}]}\n\n`,
    )
  return (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/health')) return Promise.resolve(new Response('ok', { status: 200 }))
    let timer: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
          ),
        )
        controller.enqueue(delta('Partial answer'))
        timer = setInterval(() => {
          try {
            controller.enqueue(delta('.'))
          } catch {
            // controller closed once the abort tore the stream down
          }
        }, 10)
      },
      cancel() {
        if (timer) clearInterval(timer)
      },
    })
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
  }
}

describe('durable streaming', () => {
  it('sets active_stream_id for a turn and clears it on finish (persists complete)', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(fakeHermes().fetchImpl, { streaming })
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_durable_finish',
        sessionId: 'ses_durable_finish',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    await res.text()

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    expect(rows?.find((r) => r.role === 'assistant')?.status).toBe('complete')
    // A resumable stream was registered, and the thread pointer was cleared on finish.
    expect(streaming.streams.size).toBe(1)
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_durable_finish'),
    })
    expect(thread?.active_stream_id).toBeNull()
  })

  it('keeps generating after a client disconnect and still persists the completed turn', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(fakeHermes().fetchImpl, { streaming })
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_disconnect',
        sessionId: 'ses_disconnect',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    // Drop the client connection immediately — generation must NOT be tied to it.
    await res.body?.cancel()

    const assistant = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.find((m) => m.role === 'assistant')
    })
    // The decoupled producer finished the turn regardless of the dropped client.
    expect(assistant?.status).toBe('complete')
    const text = (assistant?.parts ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(text).toBe('Hello world')
  })

  it('resumes buffered output via GET /chat/:id/stream, and 204s when nothing is active', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(fakeHermes().fetchImpl, { streaming })

    await db.insert(hermesThread).values({
      id: 'thr_resume',
      session_id: 'ses_resume',
      session_key: 'k',
    })
    // No active stream → 204.
    const none = await app.handle(new Request('http://localhost/hermes/chat/thr_resume/stream'))
    expect(none.status).toBe(204)

    // Seed an in-flight stream and point the thread at it → resume replays the buffer.
    streaming.streams.set('strm_seed', { buffer: 'data: {"type":"text-delta"}\n\n', done: false })
    await db
      .update(hermesThread)
      .set({ active_stream_id: 'strm_seed' })
      .where(eq(hermesThread.id, 'thr_resume'))
    const resumed = await app.handle(new Request('http://localhost/hermes/chat/thr_resume/stream'))
    expect(resumed.status).toBe(200)
    // Carries the AI SDK UI-message-stream marker so the client parses it correctly.
    expect(resumed.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
    expect(await resumed.text()).toContain('text-delta')
  })

  it('204s the resume endpoint when durability is disabled', async () => {
    const app = buildApp(fakeHermes().fetchImpl) // streaming: null
    await db.insert(hermesThread).values({
      id: 'thr_nodur',
      session_id: 'ses_nodur',
      session_key: 'k',
      active_stream_id: 'strm_orphan',
    })
    const res = await app.handle(new Request('http://localhost/hermes/chat/thr_nodur/stream'))
    expect(res.status).toBe(204)
  })

  it('POST /chat/:id/stop aborts an in-flight turn → interrupted persist + cleared pointer', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(infiniteHermes(), { streaming })

    // Kick off a long-running turn and drop the client — the fake's background
    // drain keeps generation alive until we explicitly stop it.
    void app
      .handle(
        chatRequest({
          threadId: 'thr_stop',
          sessionId: 'ses_stop',
          messages: [
            { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'tell me a story' }] },
          ],
        }),
      )
      .then((r) => r.body?.cancel())
      .catch(() => undefined)

    const active = await waitFor(async () => {
      const t = await db.query.hermesThread.findFirst({ where: eq(hermesThread.id, 'thr_stop') })
      return t?.active_stream_id ?? undefined
    })
    expect(active).toBeDefined()

    const stopRes = await app.handle(
      new Request('http://localhost/hermes/chat/thr_stop/stop', { method: 'POST' }),
    )
    expect(stopRes.status).toBe(200)
    expect(await stopRes.json()).toEqual({ ok: true, stopped: true })

    // The abort drives onFinish → interrupted persist + pointer cleared.
    const assistant = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.find((m) => m.role === 'assistant')
    })
    expect(assistant?.status).toBe('interrupted')
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_stop'),
    })
    expect(thread?.active_stream_id).toBeNull()
  })

  it('404s a stop to a missing thread; no-op success when nothing is in-flight', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(fakeHermes().fetchImpl, { streaming })
    const missing = await app.handle(
      new Request('http://localhost/hermes/chat/thr_nope/stop', { method: 'POST' }),
    )
    expect(missing.status).toBe(404)

    await db.insert(hermesThread).values({
      id: 'thr_idle',
      session_id: 'ses_idle',
      session_key: 'k',
    })
    const idle = await app.handle(
      new Request('http://localhost/hermes/chat/thr_idle/stop', { method: 'POST' }),
    )
    expect(idle.status).toBe(200)
    expect(await idle.json()).toMatchObject({ stopped: false })
  })

  // A pointer left dangling by a crashed/restarted producer (its onFinish cleanup
  // never ran). resume must NOT 500 on it — it reaps the pointer and 204s.

  it('reaps a stale active_stream_id and 204s when resume finds nothing (gone/finished)', async () => {
    const streaming = fakeStreaming() // no entry for the seeded id → resume returns null
    const app = buildApp(fakeHermes().fetchImpl, { streaming })
    await db.insert(hermesThread).values({
      id: 'thr_stale_gone',
      session_id: 'ses_stale_gone',
      session_key: 'k',
      active_stream_id: 'strm_orphan',
    })
    const res = await app.handle(new Request('http://localhost/hermes/chat/thr_stale_gone/stream'))
    expect(res.status).toBe(204)
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_stale_gone'),
    })
    expect(thread?.active_stream_id).toBeNull()
  })

  it('reaps a stale active_stream_id and 204s when resume rejects (crashed-producer timeout)', async () => {
    // Simulate the ~1s ack timeout the real library throws when no producer answers.
    const streaming: HermesStreaming = {
      ...fakeStreaming(),
      resumeExistingStream: () => Promise.reject(new Error('Timeout waiting for ack')),
    }
    const app = buildApp(fakeHermes().fetchImpl, { streaming })
    await db.insert(hermesThread).values({
      id: 'thr_stale_throw',
      session_id: 'ses_stale_throw',
      session_key: 'k',
      active_stream_id: 'strm_orphan',
    })
    const res = await app.handle(new Request('http://localhost/hermes/chat/thr_stale_throw/stream'))
    expect(res.status).toBe(204)
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_stale_throw'),
    })
    expect(thread?.active_stream_id).toBeNull()
  })

  it('stop reaps a stale pointer that cannot be aborted (registry empty after restart)', async () => {
    const streaming = fakeStreaming() // nothing registered → abort() returns false
    const app = buildApp(fakeHermes().fetchImpl, { streaming })
    await db.insert(hermesThread).values({
      id: 'thr_stale_stop',
      session_id: 'ses_stale_stop',
      session_key: 'k',
      active_stream_id: 'strm_orphan',
    })
    const res = await app.handle(
      new Request('http://localhost/hermes/chat/thr_stale_stop/stop', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ stopped: false })
    const thread = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, 'thr_stale_stop'),
    })
    expect(thread?.active_stream_id).toBeNull()
  })
})
