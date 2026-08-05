import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { createHermesRoutes, type FetchImpl, type HermesRouteDeps } from './hermes.js'
import type { HermesStreaming } from '../lib/resumable.js'
import { client, db } from '../db/index.js'
import { hermesMessage, hermesThread } from '../db/schema.js'
import { authGuard } from '../lib/auth-guard.js'
import { buildApp as buildFullApp } from '../app.js'

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
    '../../drizzle/0017_nice_wilson_fisk.sql',
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

// ── Attachment budget (defect 18 / C2) ───────────────────────────────────────
//
// The cap is validated by hand in the handler (`attachmentBudgetError`), not by
// the Zod body schema — a schema-level `.max()`/`.refine()` on `attachments`
// made Elysia echo the ENTIRE request body (base64 payloads included) back in
// the 422's `found` field, roughly doubling peak memory on exactly the request
// the cap exists to reject. These pin both halves: the reject itself, and that
// the response never contains the attachment payload. Mirrors the constants in
// hermes.ts (MAX_ATTACHMENTS = 8, MAX_ATTACHMENT_BYTES_TOTAL = 24MB).
describe('attachment budget (defect 18 / C2)', () => {
  it('rejects more than 8 attachments with 422, without echoing them, before any upstream call or write', async () => {
    const { fetchImpl, calls } = fakeHermes()
    const app = buildApp(fetchImpl)
    const attachments = Array.from({ length: 9 }, (_, i) => ({
      type: 'text',
      content: `attachment-payload-marker-${i}`,
    }))

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_attach_count',
        sessionId: 'ses_attach_count',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        attachments,
      }),
    )
    expect(res.status).toBe(422)
    const bodyText = await res.text()
    expect(JSON.parse(bodyText)).toMatchObject({ error: 'attachment_limit_exceeded' })
    // The whole point of the fix: the offending payload never comes back.
    expect(bodyText).not.toContain('attachment-payload-marker')

    expect(calls.find((c) => c.url.endsWith('/chat/completions'))).toBeUndefined()
    expect(await db.query.hermesMessage.findMany()).toHaveLength(0)
  })

  it('rejects attachments whose combined content size exceeds the 24MB budget, without echoing them', async () => {
    const { fetchImpl, calls } = fakeHermes()
    const app = buildApp(fetchImpl)
    // Two text attachments whose content alone sums past the 24MB budget.
    const bigContent = 'x'.repeat(13 * 1024 * 1024)
    const attachments = [
      { type: 'text', content: bigContent },
      { type: 'text', content: bigContent },
    ]

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_attach_content_size',
        sessionId: 'ses_attach_content_size',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        attachments,
      }),
    )
    expect(res.status).toBe(422)
    const bodyText = await res.text()
    expect(JSON.parse(bodyText)).toMatchObject({ error: 'attachment_limit_exceeded' })
    expect(bodyText.length).toBeLessThan(1000)
    expect(bodyText).not.toContain('xxxxxxxxxx')

    expect(calls.find((c) => c.url.endsWith('/chat/completions'))).toBeUndefined()
    expect(await db.query.hermesMessage.findMany()).toHaveLength(0)
  })

  it('rejects a dataUrl attachment whose base64 payload exceeds the 24MB budget (the byte-estimate branch), without echoing it', async () => {
    const { fetchImpl, calls } = fakeHermes()
    const app = buildApp(fetchImpl)
    // Decoded size deliberately just over the 24MB budget; base64 length derived
    // from the same (bytes * 4/3) relationship attachmentByteEstimate decodes.
    const oversizedB64Length = Math.ceil(((24 * 1024 * 1024 + 1024) * 4) / 3)
    const marker = 'ATTACHMENT_PAYLOAD_MARKER'
    const dataUrl = `data:image/png;base64,${marker}${'A'.repeat(oversizedB64Length)}`

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_attach_dataurl_size',
        sessionId: 'ses_attach_dataurl_size',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        attachments: [{ type: 'image', mimeType: 'image/png', dataUrl }],
      }),
    )
    expect(res.status).toBe(422)
    const bodyText = await res.text()
    expect(JSON.parse(bodyText)).toMatchObject({ error: 'attachment_limit_exceeded' })
    expect(bodyText).not.toContain(marker)
    expect(bodyText.length).toBeLessThan(1000)

    expect(calls.find((c) => c.url.endsWith('/chat/completions'))).toBeUndefined()
    expect(await db.query.hermesMessage.findMany()).toHaveLength(0)
  })

  it('accepts attachments within the budget unchanged (regression guard)', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_attach_ok',
        sessionId: 'ses_attach_ok',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        attachments: [{ type: 'text', content: 'small and fine' }],
      }),
    )
    expect(res.status).toBe(200)
    await res.text()
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
    has(streamId) {
      return registry.has(streamId)
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
    // Pin the "every terminal path unregisters exactly once" invariant directly
    // on the NORMAL successful-finish path — every existing 409/leak test only
    // exercises the failure paths (loser cleanup, thrown-claim cleanup); nothing
    // asserted the abort registry is cleared after a plain successful finish.
    const [streamId] = streaming.streams.keys()
    expect(streamId).toBeDefined()
    expect(streaming.has(streamId!)).toBe(false)
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

// ── Plugin-level auth (defect 17, half one) ──────────────────────────────────
//
// `buildApp()` above builds a bare, unguarded Elysia instance so the
// streaming/persist tests in this file don't need a bearer token — which
// means nothing in this file has ever exercised auth on the Hermes plugin
// itself. This mirrors ai.test.ts's guarded-app pattern
// (`new Elysia().use(authGuard).use(createXRoutes(...))`) to close that gap
// for every route/method the plugin exposes.

function buildGuardedApp(fetchImpl: FetchImpl, extra: Partial<HermesRouteDeps> = {}) {
  return new Elysia().use(authGuard).use(
    createHermesRoutes({
      baseURL: 'http://hermes.test/v1',
      apiKey: HERMES_KEY,
      sessionKey: 'agent:main:test',
      model: 'hermes',
      fetchImpl,
      generateTitle: async () => '',
      generateSummary: async () => ({ summary: '', type: 'general' }),
      recordUsage: async () => {},
      streaming: null,
      ...extra,
    }),
  )
}

describe('plugin-level auth (every Hermes route requires a bearer token)', () => {
  // Enumerated directly from createHermesRoutes' method chain in hermes.ts —
  // GET /health, POST /chat, GET /chat/:id/stream, POST /chat/:id/stop, POST
  // /threads, GET /threads, GET /threads/:id/messages, PATCH /threads/:id,
  // DELETE /threads/:id.
  const HERMES_ROUTE_CASES: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/hermes/health' },
    { method: 'POST', path: '/hermes/chat', body: {} },
    { method: 'GET', path: '/hermes/chat/thr_x/stream' },
    { method: 'POST', path: '/hermes/chat/thr_x/stop' },
    { method: 'POST', path: '/hermes/threads', body: {} },
    { method: 'GET', path: '/hermes/threads' },
    { method: 'GET', path: '/hermes/threads/thr_x/messages' },
    { method: 'PATCH', path: '/hermes/threads/thr_x', body: {} },
    { method: 'DELETE', path: '/hermes/threads/thr_x' },
  ]

  for (const { method, path, body } of HERMES_ROUTE_CASES) {
    it(`401s ${method} ${path} without a bearer token`, async () => {
      const { fetchImpl } = fakeHermes()
      const app = buildGuardedApp(fetchImpl)
      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          ...(body !== undefined
            ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
        }),
      )
      expect(res.status).toBe(401)
    })
  }
})

// ── Order-level auth (defect 17, half two) ───────────────────────────────────
//
// The plugin-level suite above proves the Hermes plugin 401s in isolation —
// it says nothing about WHERE the plugin is mounted relative to authGuard in
// the real composed app. This drives the actual `buildApp()` from app.ts: the
// thing that would keep passing the suite above while some domain route (or
// Hermes itself) sat above the guard, exposing the whole surface with a green
// test file. One representative path per domain-route group mounted BELOW
// authGuard in app.ts's .use() chain must 401 unauthenticated; the
// deliberately public groups mounted ABOVE authGuard (healthRoute,
// oauthRoutes, audioFileRoutes) must NOT.
//
// `buildFullApp()` (aliased from `buildApp` in app.ts) is side-effect-free on
// call — no migrations, no .listen(), no port — so this needs no DB fixture
// beyond what the rest of this file already sets up.

const GUARDED_ROUTE_CASES: Array<{
  group: string
  method: string
  path: string
  body?: unknown
}> = [
  { group: 'ticktickRoutes', method: 'GET', path: '/ticktick/projects' },
  { group: 'uptimeKumaRoutes', method: 'GET', path: '/uptime-kuma/monitors' },
  { group: 'dockerHomelabRoutes', method: 'GET', path: '/docker/homelab/containers' },
  { group: 'dockerVpsRoutes', method: 'GET', path: '/docker/vps/containers' },
  { group: 'slackRoutes', method: 'GET', path: '/slack/channels' },
  { group: 'gmailRoutes', method: 'GET', path: '/gmail/emails' },
  { group: 'calendarRoutes', method: 'GET', path: '/calendar' },
  { group: 'm365Routes', method: 'GET', path: '/m365/tools' },
  { group: 'jiraRoutes', method: 'GET', path: '/atlassian/jira/me' },
  { group: 'confluenceRoutes', method: 'GET', path: '/atlassian/confluence/spaces' },
  { group: 'gitlabRoutes', method: 'GET', path: '/gitlab/me' },
  { group: 'weatherRoutes', method: 'GET', path: '/weather/forecast' },
  { group: 'summaryRoute', method: 'GET', path: '/summary' },
  { group: 'queryRoute', method: 'POST', path: '/query', body: { sql: 'SELECT 1' } },
  { group: 'exerciseRoutes', method: 'GET', path: '/exercises' },
  { group: 'workoutRoutes', method: 'GET', path: '/workouts/summary/strength' },
  { group: 'strengthRoutes', method: 'GET', path: '/workouts/summary/heroes' },
  { group: 'workoutSetRoutes', method: 'GET', path: '/workout-sets' },
  { group: 'dailyMetricsRoutes', method: 'GET', path: '/daily-metrics' },
  { group: 'recoveryRoutes', method: 'GET', path: '/recovery' },
  { group: 'trainingLoadRoutes', method: 'GET', path: '/training-load' },
  { group: 'fitnessDirectionRoutes', method: 'GET', path: '/fitness-direction' },
  { group: 'activitiesRoutes', method: 'GET', path: '/activities' },
  { group: 'weightLogRoutes', method: 'GET', path: '/weight-log' },
  { group: 'skinfoldLogRoutes', method: 'GET', path: '/skinfold-log' },
  { group: 'userProfileRoutes', method: 'GET', path: '/user-profile' },
  { group: 'gymRoutes', method: 'GET', path: '/gym' },
  { group: 'workoutDraftRoutes', method: 'GET', path: '/workout-draft' },
  { group: 'walkingPadRoutes', method: 'GET', path: '/walking-pad/sessions' },
  { group: 'usageRoutes', method: 'GET', path: '/usage/summary' },
  { group: 'readingRoutes', method: 'GET', path: '/reading' },
  { group: 'hermesRoutes', method: 'GET', path: '/hermes/threads' },
  { group: 'aiRoutes', method: 'GET', path: '/ai/v1/models' },
]

const PUBLIC_ROUTE_CASES: Array<{ group: string; method: string; path: string }> = [
  { group: 'healthRoute', method: 'GET', path: '/health' },
  { group: 'oauthRoutes', method: 'GET', path: '/oauth/google/init' },
  { group: 'audioFileRoutes', method: 'GET', path: `/ai/v1/audio/file/${'a'.repeat(64)}` },
]

describe('order-level auth (composed app.ts — mount order, not the plugin)', () => {
  const orderApp = buildFullApp()

  for (const { group, method, path, body } of GUARDED_ROUTE_CASES) {
    it(`401s ${group} (${method} ${path}) unauthenticated`, async () => {
      const res = await orderApp.handle(
        new Request(`http://localhost${path}`, {
          method,
          ...(body !== undefined
            ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
        }),
      )
      expect(res.status).toBe(401)
    })
  }

  for (const { group, method, path } of PUBLIC_ROUTE_CASES) {
    it(`does not 401 the deliberately public ${group} (${method} ${path})`, async () => {
      const res = await orderApp.handle(new Request(`http://localhost${path}`, { method }))
      expect(res.status).not.toBe(401)
    })
  }
})

// ── Persist-at-start (defects 2, 8, 9) ───────────────────────────────────────

/** A fake Hermes SSE stream that emits the assistant role + partial content,
 *  then blocks until `release()` is called before sending the finish frame —
 *  lets a test observe DB state while the turn is still generating. */
function holdableHermes(): { fetchImpl: FetchImpl; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const encoder = new TextEncoder()
  const fetchImpl: FetchImpl = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/health')) return Promise.resolve(new Response('ok', { status: 200 }))
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
          ),
        )
        controller.enqueue(
          encoder.encode(
            'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
          ),
        )
        await gate
        controller.enqueue(
          encoder.encode(
            'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          ),
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
  }
  return { fetchImpl, release }
}

describe('persist-at-start (defects 2, 8, 9)', () => {
  it('writes the user row before the assistant turn finishes, then settles to exactly one user + one assistant row, ordered user-before-assistant', async () => {
    const { fetchImpl, release } = holdableHermes()
    const app = buildApp(fetchImpl)

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_persist_start',
        sessionId: 'ses_persist_start',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )

    // The stream is still open (holdableHermes hasn't been released yet). The
    // handler awaits the early user-turn write before ever constructing the
    // UIMessageStream, so by the time the Response comes back the user row
    // must already be committed — and the assistant row must not exist at
    // all yet (only written by onFinish, which the held-open stream hasn't
    // reached).
    const midRows = await db.query.hermesMessage.findMany()
    expect(midRows).toHaveLength(1)
    expect(midRows[0]?.role).toBe('user')
    expect(midRows[0]?.status).toBe('complete')

    release()
    await res.text()

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    // Exactly one user + one assistant row settled — not a duplicate user row
    // from onFinish's own (guarded) write.
    expect(rows).toHaveLength(2)
    const user = rows?.find((r) => r.role === 'user')
    const assistant = rows?.find((r) => r.role === 'assistant')
    expect(user).toBeDefined()
    expect(assistant).toBeDefined()
    // Ordering property, not the specific Math.max(...) expression the
    // implementation uses to guarantee it — onFinish applies that unconditionally
    // on every turn, so this same assertion also exercises the same-millisecond
    // collision path without needing to mock Date.now.
    expect(new Date(assistant!.created_at).getTime()).toBeGreaterThan(
      new Date(user!.created_at).getTime(),
    )
  })

  // Forces the EARLY persistMessages call to throw via a test-only trigger that
  // rejects any insert whose `parts` carries a marker string, then disables the
  // trigger (a genuinely separate DB statement, not touched by the aborted early
  // transaction) before releasing the held-open stream — so onFinish's fallback
  // write lands cleanly. No production code is touched to force this failure.
  it('falls back to onFinish when the early persist throws — the request still streams and settles to exactly one user row', async () => {
    const marker = 'EARLY_PERSIST_FAIL_MARKER'
    await client.unsafe(`
      CREATE OR REPLACE FUNCTION argo.tmp_early_persist_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.parts::text LIKE '%${marker}%' THEN
          RAISE EXCEPTION 'simulated early-persist failure (test-only trigger)';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await client.unsafe(`
      CREATE TRIGGER tmp_early_persist_fail_trigger
      BEFORE INSERT ON argo.hermes_message
      FOR EACH ROW EXECUTE FUNCTION argo.tmp_early_persist_fail()
    `)

    try {
      const { fetchImpl, release } = holdableHermes()
      const app = buildApp(fetchImpl)

      const res = await app.handle(
        chatRequest({
          threadId: 'thr_early_fail',
          sessionId: 'ses_early_fail',
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: marker }] }],
        }),
      )
      expect(res.status).toBe(200)

      // The early write's trigger-forced throw is caught in the route — nothing
      // landed, and the request still returned 200 rather than failing.
      const midRows = await db.query.hermesMessage.findMany()
      expect(midRows).toHaveLength(0)

      // Disable the trigger BEFORE releasing the held-open stream, so onFinish's
      // fallback write (still carrying the same marker text) succeeds.
      await client.unsafe(
        'DROP TRIGGER IF EXISTS tmp_early_persist_fail_trigger ON argo.hermes_message',
      )

      release()
      await res.text()

      const rows = await waitFor(async () => {
        const r = await db.query.hermesMessage.findMany()
        return r.length >= 2 ? r : undefined
      })
      expect(rows).toHaveLength(2)
      const userRows = rows?.filter((r) => r.role === 'user')
      const assistant = rows?.find((r) => r.role === 'assistant')
      // Exactly one user row — the fallback write, not a duplicate.
      expect(userRows).toHaveLength(1)
      expect(userRows?.[0]?.status).toBe('complete')
      expect(assistant).toBeDefined()
      expect(new Date(assistant!.created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(userRows![0]!.created_at).getTime(),
      )
    } finally {
      // Always clean up even if an assertion above throws — this trigger must
      // never leak into later tests/files sharing the dev DB.
      await client.unsafe(
        'DROP TRIGGER IF EXISTS tmp_early_persist_fail_trigger ON argo.hermes_message',
      )
      await client.unsafe('DROP FUNCTION IF EXISTS argo.tmp_early_persist_fail()')
    }
  })
})

// ── Client-message idempotency (defect 4) ────────────────────────────────────
//
// All of these use the default non-durable `buildApp(fetchImpl)` (streaming:
// null). With durability off there is no active-stream claim/CAS at all, so
// two sequential POSTs on the same thread can never race into a 409 — that is
// how these tests stay isolated from the 409/CAS behavior covered separately
// below. Each POST is fully awaited (`await res.text()`) before the next is
// sent, so there is no concurrency to reason about either.

describe('client-message idempotency (defect 4)', () => {
  // BLOCKING 2: a retry carrying the same client_message_id AFTER the original
  // turn has already completed must be rejected as `duplicate_turn` — not
  // silently no-op the user row while still re-invoking Hermes for a second
  // assistant reply. The old assertion here (`userRows.length === 1`) passed
  // even with that bug present, because it never looked at the assistant side
  // or the upstream call count — both are asserted below.
  it('collapses two POSTs carrying the same client message id: the retry after completion is rejected as duplicate_turn, not re-invoked', async () => {
    const { fetchImpl, calls } = fakeHermes()
    const app = buildApp(fetchImpl)
    const body = {
      threadId: 'thr_idem_same',
      sessionId: 'ses_idem_same',
      messages: [{ id: 'client-msg-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    }

    const res1 = await app.handle(chatRequest(body))
    expect(res1.status).toBe(200)
    await res1.text()

    await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    const chatCallsAfterFirst = calls.filter((c) => c.url.endsWith('/chat/completions')).length

    const res2 = await app.handle(chatRequest(body))
    expect(res2.status).toBe(409)
    expect(await res2.json()).toMatchObject({ error: 'duplicate_turn' })

    // Hermes was NOT invoked a second time.
    const chatCallsAfterSecond = calls.filter((c) => c.url.endsWith('/chat/completions')).length
    expect(chatCallsAfterSecond).toBe(chatCallsAfterFirst)

    const rows = await db.query.hermesMessage.findMany()
    const userRows = rows.filter((m) => m.role === 'user')
    const assistantRows = rows.filter((m) => m.role === 'assistant')
    expect(userRows).toHaveLength(1)
    expect(userRows[0]?.client_message_id).toBe('client-msg-1')
    // Exactly one assistant row — not two. This is what BLOCKING 2 fixes.
    expect(assistantRows).toHaveLength(1)
  })

  // Ordering against the live-stream 409 (BLOCKING 2's requirement): a retry
  // carrying the SAME client id must still get `stream_in_progress`, not
  // `duplicate_turn`, while the original turn is still generating — its user
  // row is already persisted by the early-write at that point, so the
  // duplicate-turn check must run AFTER (not instead of) the live-stream gate.
  it('a same-client-id retry arriving WHILE the original is still streaming gets stream_in_progress, not duplicate_turn', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(infiniteHermes(), { streaming })
    const body = {
      threadId: 'thr_idem_live_retry',
      sessionId: 'ses_idem_live_retry',
      messages: [
        { id: 'client-msg-live', role: 'user', parts: [{ type: 'text', text: 'tell me a story' }] },
      ],
    }

    const firstRes = await app.handle(chatRequest(body))
    expect(firstRes.status).toBe(200)

    const secondRes = await app.handle(chatRequest(body))
    expect(secondRes.status).toBe(409)
    expect(await secondRes.json()).toMatchObject({ error: 'stream_in_progress' })

    await app.handle(
      new Request('http://localhost/hermes/chat/thr_idem_live_retry/stop', { method: 'POST' }),
    )
    await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.find((m) => m.role === 'assistant')
    })
  })

  it('writes client_message_id NULL and still works when the client sends no id', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_idem_noid',
        sessionId: 'ses_idem_noid',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    expect(res.status).toBe(200)
    await res.text()

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    const user = rows?.find((r) => r.role === 'user')
    expect(user?.client_message_id).toBeNull()
  })

  it('does NOT collapse two POSTs that both carry no client id — the partial index deliberately never matches NULL (documented behavior, not a bug to fix)', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)
    const body = {
      threadId: 'thr_idem_twonull',
      sessionId: 'ses_idem_twonull',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    }

    const res1 = await app.handle(chatRequest(body))
    await res1.text()
    const res2 = await app.handle(chatRequest(body))
    await res2.text()

    const userRows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      const users = r.filter((m) => m.role === 'user')
      return users.length >= 2 ? users : undefined
    })
    expect(userRows).toHaveLength(2)
    expect(userRows?.every((u) => u.client_message_id === null)).toBe(true)
  })

  it('treats an id over the 128-char bound, and an empty/whitespace id, as absent (NULL) rather than rejecting the request', async () => {
    const { fetchImpl } = fakeHermes()
    const app = buildApp(fetchImpl)

    const overLong = 'x'.repeat(129)
    const res1 = await app.handle(
      chatRequest({
        threadId: 'thr_idem_toolong',
        sessionId: 'ses_idem_toolong',
        messages: [{ id: overLong, role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    expect(res1.status).toBe(200)
    await res1.text()

    const res2 = await app.handle(
      chatRequest({
        threadId: 'thr_idem_whitespace',
        sessionId: 'ses_idem_whitespace',
        messages: [{ id: '   ', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    expect(res2.status).toBe(200)
    await res2.text()

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 4 ? r : undefined
    })
    const longThreadUser = rows?.find(
      (r) => r.thread_id === 'thr_idem_toolong' && r.role === 'user',
    )
    const wsThreadUser = rows?.find(
      (r) => r.thread_id === 'thr_idem_whitespace' && r.role === 'user',
    )
    expect(longThreadUser?.client_message_id).toBeNull()
    expect(wsThreadUser?.client_message_id).toBeNull()
  })
})

// ── 409 / CAS claim (defects 5, 6) ────────────────────────────────────────────

describe('409 / CAS claim (defects 5, 6)', () => {
  // `isStreamLive`'s tier-1 `has()` check is what every OTHER 409 test in this
  // file exercises — they all register in this process's abort registry AND
  // seed `streaming.streams` together (a real POST does both). This is the only
  // test that seeds `streams` WITHOUT registering — the shape of a pointer that
  // is genuinely live in a DIFFERENT process/replica, which tier-1 can never see
  // (has() is in-process only) and only the tier-2 pub/sub probe
  // (`resumeExistingStream`) can answer.
  it('409s via the tier-2 cross-process pub/sub probe when the pointer is live but never registered in this process', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(fakeHermes().fetchImpl, { streaming })

    streaming.streams.set('strm_other_process', { buffer: 'data: {}\n\n', done: false })
    await db.insert(hermesThread).values({
      id: 'thr_tier2_cross_process',
      session_id: 'ses_tier2_cross_process',
      session_key: 'k',
      active_stream_id: 'strm_other_process',
    })
    expect(streaming.has('strm_other_process')).toBe(false)

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_tier2_cross_process',
        sessionId: 'ses_tier2_cross_process',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'stream_in_progress' })
    expect(await db.query.hermesMessage.findMany()).toHaveLength(0)
  })

  it('409s a second POST while the first stream is genuinely live, writing no extra rows', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(infiniteHermes(), { streaming })

    const firstRes = await app.handle(
      chatRequest({
        threadId: 'thr_409_live',
        sessionId: 'ses_409_live',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'tell me a story' }] }],
      }),
    )
    expect(firstRes.status).toBe(200)

    const secondRes = await app.handle(
      chatRequest({
        threadId: 'thr_409_live',
        sessionId: 'ses_409_live',
        messages: [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: 'another one' }] }],
      }),
    )
    expect(secondRes.status).toBe(409)
    expect(await secondRes.json()).toMatchObject({ error: 'stream_in_progress' })

    // Only the first POST's user row exists — the 409'd second POST must not
    // have persisted anything. (Production forensics showed today's behavior
    // writes four rows for one exchange; this pins the fix.)
    const rows = await db.query.hermesMessage.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.role).toBe('user')

    // Cleanup: stop the still-live first turn and wait for its (async) onFinish
    // to actually settle before the test ends — otherwise its background persist
    // can race the next test's afterEach truncation and log a spurious FK error.
    await app.handle(
      new Request('http://localhost/hermes/chat/thr_409_live/stop', { method: 'POST' }),
    )
    await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.find((m) => m.role === 'assistant')
    })
  })

  it('claims successfully (no 409) when the existing active_stream_id pointer is stale/dead', async () => {
    const streaming = fakeStreaming() // no entry for 'strm_dead_pointer' → resume returns null → dead
    const app = buildApp(fakeHermes().fetchImpl, { streaming })
    await db.insert(hermesThread).values({
      id: 'thr_409_stale',
      session_id: 'ses_409_stale',
      session_key: 'k',
      active_stream_id: 'strm_dead_pointer',
    })

    const res = await app.handle(
      chatRequest({
        threadId: 'thr_409_stale',
        sessionId: 'ses_409_stale',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    expect(res.status).toBe(200)
    await res.text()

    const rows = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.length >= 2 ? r : undefined
    })
    expect(rows).toHaveLength(2)
  })

  // Registration happens in-process BEFORE the CAS write (see claimActiveStream's
  // doc + the register() call site in the route) precisely so a second POST
  // landing between the CAS and the durable backend's own registration still
  // observes the winner as live via the in-process registry — closing the
  // window rather than narrowing it. Don't move registration back below the CAS.
  it('genuinely concurrent POSTs on the same thread: exactly one 200 and one 409', async () => {
    const streaming = fakeStreaming()
    const app = buildApp(infiniteHermes(), { streaming })

    const [res1, res2] = await Promise.all([
      app.handle(
        chatRequest({
          threadId: 'thr_409_race',
          sessionId: 'ses_409_race',
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'one' }] }],
        }),
      ),
      app.handle(
        chatRequest({
          threadId: 'thr_409_race',
          sessionId: 'ses_409_race',
          messages: [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: 'two' }] }],
        }),
      ),
    ])

    const statuses = [res1.status, res2.status].toSorted((a, b) => a - b)
    expect(statuses).toEqual([200, 409])

    const loser = res1.status === 200 ? res2 : res1
    expect(await loser.json()).toMatchObject({ error: 'stream_in_progress' })

    // The pointer belongs to exactly one live stream; the loser wrote nothing.
    const thread = await waitFor(async () => {
      const t = await db.query.hermesThread.findFirst({
        where: eq(hermesThread.id, 'thr_409_race'),
      })
      return t?.active_stream_id ? t : undefined
    })
    expect(thread?.active_stream_id).toBeDefined()

    // The loser's cleanup did not disturb the winner's registration: stop must
    // still reach the winner's live stream (not a leaked/unregistered one).
    const stopRes = await app.handle(
      new Request('http://localhost/hermes/chat/thr_409_race/stop', { method: 'POST' }),
    )
    expect(await stopRes.json()).toMatchObject({ ok: true, stopped: true })

    const assistant = await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      return r.find((m) => m.role === 'assistant')
    })
    expect(assistant?.status).toBe('interrupted')
    const settled = await waitFor(async () => {
      const t = await db.query.hermesThread.findFirst({
        where: eq(hermesThread.id, 'thr_409_race'),
      })
      return t?.active_stream_id === null ? t : undefined
    })
    expect(settled?.active_stream_id).toBeNull()

    // A subsequent POST after the winner finishes must succeed, not 409 against
    // a leaked registration left by the loser.
    const thirdRes = await app.handle(
      chatRequest({
        threadId: 'thr_409_race',
        sessionId: 'ses_409_race',
        messages: [{ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'three' }] }],
      }),
    )
    expect(thirdRes.status).toBe(200)
    await app.handle(
      new Request('http://localhost/hermes/chat/thr_409_race/stop', { method: 'POST' }),
    )
    // Wait for the third turn's (async) onFinish to actually settle before the
    // test ends — otherwise its background persist can race the next test's
    // afterEach truncation and log a spurious FK error (same hazard as the
    // "genuinely live" 409 test above).
    await waitFor(async () => {
      const r = await db.query.hermesMessage.findMany()
      const assistants = r.filter((m) => m.role === 'assistant')
      return assistants.length >= 2 ? assistants : undefined
    })
  })
})

// ── finish_reason: null upstream → 'other' end-to-end (defect 1) ─────────────

/** A Hermes SSE stream whose choice.finish_reason stays null on every chunk
 *  (never "stop") — the real reachable trigger for the openai-compatible
 *  provider's mapOpenAICompatibleFinishReason default branch, which resolves
 *  to ai@5's 'unknown' (see finish-reason-transform.ts's citation trail for
 *  the exact source lines). */
function nullFinishReasonHermes(): FetchImpl {
  const encoder = new TextEncoder()
  const frames = [
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"hermes","choices":[{"index":0,"delta":{},"finish_reason":null}]}\n\n',
    'data: [DONE]\n\n',
  ]
  return (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/health')) return Promise.resolve(new Response('ok', { status: 200 }))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f))
        controller.close()
      },
    })
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
  }
}

describe('finish-reason rewrite over a real stream (defect 1)', () => {
  it("rewrites an upstream 'unknown' finish reason (finish_reason stays null throughout) to 'other' end-to-end", async () => {
    const app = buildApp(nullFinishReasonHermes())
    const res = await app.handle(
      chatRequest({
        threadId: 'thr_finish_null',
        sessionId: 'ses_finish_null',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"finishReason":"other"')
    expect(text).not.toContain('unknown')
  })
})
