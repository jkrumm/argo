import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { db } from '../db/index.js'
import {
  hermesMessage,
  hermesThread,
  HERMES_THREAD_TYPES,
  type Attachment,
  type HermesThreadType,
  type MessageParts,
  type MessagePayload,
} from '../db/schema.js'
import { tracedFetch } from '../lib/traced-fetch.js'
import { filterToolProgress, type ToolProgressData } from '../lib/hermes-sse.js'
import { aiComplete } from './ai.js'
import { recordAiUsage, type RecordUsageFn } from '../lib/ai-usage.js'
import { env } from '../env.js'
import { log } from '../telemetry.js'

// Hermes Chat — thread-first chat surface backed by the Hermes agent core over
// its OpenAI-compatible API. Argo owns the verbatim transcript (hermes_thread +
// hermes_message); Hermes owns compressed agent state per X-Hermes-Session-Id.
//
// POST /hermes/chat streams a Vercel-AI-SDK UIMessageStream to the client while
// proxying to Hermes /v1/chat/completions over Tailscale (bearer stays
// server-side). The raw upstream SSE is filtered for Hermes' custom
// `hermes.tool.progress` events, which are injected as transient UI data parts.
// On finish the user + assistant UIMessages are persisted to Postgres.
// See docs/HERMES-CHAT-PRD.md.

const threadIdGen = createIdGenerator({ prefix: 'thr', size: 16 })
const sessionIdGen = createIdGenerator({ prefix: 'ses', size: 24 })
const messageIdGen = createIdGenerator({ prefix: 'msg', size: 16 })

/**
 * Minimal fetch shape (no `preconnect`) — matches both `tracedFetch` and the AI
 * SDK's `FetchFunction`, so the proxy and the provider share one transport type.
 */
export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Generate a short thread title from the first user+assistant exchange. */
export type GenerateTitle = (input: { userText: string; assistantText: string }) => Promise<string>

/** Generate a one-line summary + type classification from the first exchange. */
export type GenerateSummary = (input: {
  userText: string
  assistantText: string
}) => Promise<{ summary: string; type: string }>

/** Injectable upstream config so tests can point at a fake Hermes SSE server. */
export interface HermesRouteDeps {
  baseURL: string
  apiKey: string
  sessionKey: string
  model: string
  /** Underlying transport the proxy wraps (defaults to the OTel-traced fetch). */
  fetchImpl: FetchImpl
  /**
   * Titler for fresh threads (DeepSeek v4 Flash via the AI gateway by default).
   * Injectable so tests title against a mock without a live bridge.
   */
  generateTitle: GenerateTitle
  /**
   * Summarizer+classifier for fresh threads. Injectable so tests stub it without
   * a live bridge.
   */
  generateSummary: GenerateSummary
  /**
   * Records token usage for the proxied chat turn into argo.usage_record.
   * Injectable so tests don't write usage rows. Defaults to `recordAiUsage`.
   */
  recordUsage: RecordUsageFn
}

const TITLE_SYSTEM =
  `You write concise titles for chat threads. Reply with ONLY the title: 2-6 words, ` +
  `no surrounding quotes, no trailing punctuation, in the language of the conversation.`

/** Default titler: a single non-streaming DeepSeek completion via `aiComplete`. */
const deepseekTitle: GenerateTitle = ({ userText, assistantText }) =>
  aiComplete(
    [
      'Summarize this exchange as a short thread title.',
      `User: ${userText.slice(0, 500)}`,
      `Assistant: ${assistantText.slice(0, 500)}`,
    ].join('\n'),
    { system: TITLE_SYSTEM, temperature: 0.3, maxTokens: 24, sub_tool: 'titling' },
  )

const SUMMARIZE_SYSTEM =
  `You classify chat threads. Reply with ONLY a JSON object (no markdown, no code fences): ` +
  `{"summary":"one sentence summarizing the thread","type":"<type>"}. ` +
  `Allowed types: ${HERMES_THREAD_TYPES.join(', ')}. Use "general" when unsure.`

/** Default summarizer: one DeepSeek call returning { summary, type } parsed from JSON. */
const deepseekSummarize: GenerateSummary = async ({ userText, assistantText }) => {
  const raw = await aiComplete(
    [
      'Classify this exchange and write a one-sentence summary.',
      `User: ${userText.slice(0, 500)}`,
      `Assistant: ${assistantText.slice(0, 500)}`,
    ].join('\n'),
    { system: SUMMARIZE_SYSTEM, temperature: 0.3, maxTokens: 64, sub_tool: 'summarization' },
  )
  // Strip optional code fences then parse defensively.
  const stripped = raw.replace(/^```(?:json)?\n?|\n?```$/g, '').trim()
  let parsed: { summary?: unknown; type?: unknown } = {}
  try {
    parsed = JSON.parse(stripped) as { summary?: unknown; type?: unknown }
  } catch {
    log.error('hermes summarize: malformed model JSON', raw)
    // Malformed response — caller's null guard will skip the DB write.
  }
  const summary = String(parsed.summary ?? '')
    .slice(0, 200)
    .trim()
  const type = HERMES_THREAD_TYPES.includes(parsed.type as HermesThreadType)
    ? (parsed.type as HermesThreadType)
    : 'general'
  return { summary, type }
}

function defaultDeps(): HermesRouteDeps {
  return {
    baseURL: env.HERMES_BASE_URL,
    apiKey: env.HERMES_API_KEY,
    sessionKey: env.HERMES_SESSION_KEY,
    model: env.HERMES_MODEL,
    fetchImpl: tracedFetch,
    generateTitle: deepseekTitle,
    generateSummary: deepseekSummarize,
    recordUsage: recordAiUsage,
  }
}

/** Concatenate the text of a message's `text` parts (ignores cards/tool parts). */
function partsText(parts: MessageParts): string {
  return parts
    .filter((p): p is Extract<MessageParts[number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/** Trim, strip wrapping quotes, collapse whitespace, cap length for a title. */
function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim()
}

/**
 * Fetch the thread row and the text of its first user and first assistant
 * message. Returns null when the thread is missing or the first exchange is
 * absent — callers skip their work without error.
 */
async function getFirstExchange(threadId: string): Promise<{
  thread: typeof hermesThread.$inferSelect
  userText: string
  assistantText: string
} | null> {
  const thread = await db.query.hermesThread.findFirst({
    where: eq(hermesThread.id, threadId),
  })
  if (!thread) return null

  const msgs = await db
    .select()
    .from(hermesMessage)
    .where(eq(hermesMessage.thread_id, threadId))
    .orderBy(asc(hermesMessage.created_at), asc(hermesMessage.id))
  const firstUser = msgs.find((m) => m.role === 'user')
  const firstAssistant = msgs.find((m) => m.role === 'assistant')
  if (!firstUser || !firstAssistant) return null

  const userText = partsText(firstUser.parts)
  const assistantText = partsText(firstAssistant.parts)
  if (!userText && !assistantText) return null

  return { thread, userText, assistantText }
}

/**
 * Auto-title a fresh thread from its first user+assistant exchange. Best-effort
 * and non-blocking: skips threads that already have a title (the `isNull` guard
 * also makes the write idempotent under concurrent turns) and swallows nothing —
 * the caller fire-and-forgets and logs failures.
 */
async function titleThreadIfNeeded(threadId: string, generateTitle: GenerateTitle): Promise<void> {
  const exchange = await getFirstExchange(threadId)
  if (!exchange || exchange.thread.title) return

  const title = cleanTitle(
    await generateTitle({ userText: exchange.userText, assistantText: exchange.assistantText }),
  )
  if (!title) return

  await db
    .update(hermesThread)
    .set({ title })
    .where(and(eq(hermesThread.id, threadId), isNull(hermesThread.title)))
}

/**
 * Auto-summarize and classify a fresh thread from its first user+assistant
 * exchange. Same fire-and-forget, idempotent pattern as `titleThreadIfNeeded`:
 * the `isNull` guard on `summary` prevents overwriting an existing value and
 * makes concurrent calls safe. Unknown types from the model are coerced to
 * 'general' before the write.
 */
async function summarizeThreadIfNeeded(
  threadId: string,
  generateSummary: GenerateSummary,
): Promise<void> {
  const exchange = await getFirstExchange(threadId)
  if (!exchange || exchange.thread.summary) return

  const { summary, type: rawType } = await generateSummary({
    userText: exchange.userText,
    assistantText: exchange.assistantText,
  })
  if (!summary) return

  const type: HermesThreadType = HERMES_THREAD_TYPES.includes(rawType as HermesThreadType)
    ? (rawType as HermesThreadType)
    : 'general'

  await db
    .update(hermesThread)
    .set({ summary, type })
    .where(and(eq(hermesThread.id, threadId), isNull(hermesThread.summary)))
}

const ChatBodySchema = z.object({
  threadId: z
    .string()
    .describe('Existing thread id to continue; omit to start a fresh thread.')
    .optional(),
  sessionId: z
    .string()
    .describe('X-Hermes-Session-Id for a new thread (ignored if the thread exists).')
    .optional(),
  sessionKey: z
    .string()
    .describe('Override the long-term-memory X-Hermes-Session-Key for a new thread.')
    .optional(),
  // AI SDK UIMessage[]; only the new turn is sent (Hermes holds history). Parts
  // are validated by the SDK downstream, so they stay opaque to Zod here.
  messages: z.array(z.unknown()).min(1).describe('UIMessage[] — the new user turn.'),
  // Present when the user recorded voice and the browser sent it to STT before
  // this message. Stored as an audio ref on the user message payload.
  userAudioDurationMs: z
    .number()
    .describe('Duration in ms of the voice recording that produced this message.')
    .optional(),
  // User-supplied attachments (text/image/file) to carry on the user message payload.
  attachments: z
    .array(z.unknown())
    .describe('Attachments to persist on the user message payload.')
    .optional(),
})

// ── Read-CRUD schemas (thread/message reads, create, patch) ──────────────────

const ThreadSchema = z.object({
  id: z.string().describe('App-generated thread id (thr_…).'),
  session_id: z.string().describe('X-Hermes-Session-Id — Hermes thread continuity.'),
  session_key: z.string().describe('X-Hermes-Session-Key — long-term memory scope.'),
  title: z.string().nullable().describe('DeepSeek-generated title; null until titled.'),
  summary: z.string().nullable().describe('DeepSeek one-line summary; null until generated.'),
  type: z
    .enum(HERMES_THREAD_TYPES)
    .nullable()
    .describe('Thread type badge; null until classified.'),
  status: z.enum(['active', 'archived']),
  pinned: z.number().int().describe('1 if pinned, else 0.'),
  archived_at: z.string().nullable().describe('ISO timestamp when archived, else null.'),
  created_at: z.string().describe('ISO 8601 creation timestamp.'),
  updated_at: z.string().describe('ISO 8601 timestamp of the last turn.'),
})

const MessageSchema = z.object({
  id: z.string().describe('App-generated message id (msg_…).'),
  thread_id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  // Opaque AI SDK UIMessage parts, stored + returned verbatim.
  parts: z.array(z.unknown()).describe('AI SDK UIMessage parts (text/cards/etc.), verbatim.'),
  payload: z
    .unknown()
    .nullable()
    .describe('Non-transcript extension data (audio refs, attachments, tool events).'),
  status: z.enum(['complete', 'streaming', 'interrupted', 'error']),
  created_at: z.string().describe('ISO 8601 creation timestamp.'),
})

const ThreadListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  status: z
    .enum(['active', 'archived', 'all'])
    .default('active')
    .describe('Filter by lifecycle status; "all" includes archived. Default: active.')
    .optional(),
})

const CreateThreadBodySchema = z.object({
  title: z.string().min(1).max(200).describe('Optional initial title.').optional(),
  sessionId: z
    .string()
    .describe('X-Hermes-Session-Id to adopt; minted when omitted (fresh context).')
    .optional(),
  sessionKey: z
    .string()
    .describe('Override the long-term-memory X-Hermes-Session-Key; defaults to the configured one.')
    .optional(),
})

const PatchThreadBodySchema = z.object({
  title: z.string().min(1).max(200).describe('Rename the thread.').optional(),
  pinned: z.boolean().describe('Pin/unpin the thread.').optional(),
  archived: z.boolean().describe('Archive/unarchive the thread.').optional(),
})

// DB `status`/`role` are plain text columns (typed `string`); the response
// schemas narrow them to literal unions for the OpenAPI contract. These aliases
// + the casts at each return reconcile the two (runtime is validated by Elysia).
type ThreadResponse = z.infer<typeof ThreadSchema>
type MessageResponse = z.infer<typeof MessageSchema>

/**
 * Resolve the thread for a chat turn: reuse an existing row's session_id, or
 * create a new thread so the message FK holds. Returns the authoritative ids.
 */
async function ensureThread(
  body: {
    threadId?: string | undefined
    sessionId?: string | undefined
    sessionKey?: string | undefined
  },
  fallbackSessionKey: string,
): Promise<{ threadId: string; sessionId: string }> {
  if (body.threadId) {
    const existing = await db.query.hermesThread.findFirst({
      where: eq(hermesThread.id, body.threadId),
    })
    if (existing) return { threadId: existing.id, sessionId: existing.session_id }
  }
  const threadId = body.threadId ?? threadIdGen()
  const sessionId = body.sessionId ?? sessionIdGen()
  await db
    .insert(hermesThread)
    .values({
      id: threadId,
      session_id: sessionId,
      session_key: body.sessionKey ?? fallbackSessionKey,
    })
    .onConflictDoNothing()
  const row = await db.query.hermesThread.findFirst({ where: eq(hermesThread.id, threadId) })
  return { threadId, sessionId: row?.session_id ?? sessionId }
}

function turnStatus(aborted: boolean, errored: boolean): 'interrupted' | 'error' | 'complete' {
  if (aborted) return 'interrupted'
  if (errored) return 'error'
  return 'complete'
}

function buildMessagePayload(
  m: UIMessage,
  toolEvents: ToolProgressData[],
  audioDurationMs: number | undefined,
  sentAttachments: unknown[] | undefined,
): MessagePayload | null {
  if (m.role === 'assistant' && toolEvents.length) return { toolEvents } satisfies MessagePayload
  if (m.role === 'user') {
    const p: MessagePayload = {}
    if (audioDurationMs !== undefined)
      p.audio = [{ title: 'Voice input', durationMs: audioDurationMs }]
    if (sentAttachments?.length) p.attachments = sentAttachments as Attachment[]
    return Object.keys(p).length > 0 ? p : null
  }
  return null
}

/** Persist the user + assistant turn and bump the thread's updated_at. */
async function persistTurn(args: {
  threadId: string
  messages: UIMessage[]
  toolEvents: ToolProgressData[]
  aborted: boolean
  errored: boolean
  userAudioDurationMs?: number
  attachments?: unknown[]
}): Promise<void> {
  // Stamp a distinct, monotonically increasing created_at per message. A single
  // transaction's `now()` is identical for every row, so relying on the column
  // default would make the user→assistant order within a turn non-deterministic
  // on read; an explicit per-index offset preserves the array order verbatim.
  const baseMs = Date.now()
  const rows = args.messages.map((m, i) => ({
    id: messageIdGen(),
    thread_id: args.threadId,
    role: m.role,
    parts: (m.parts ?? []) as MessageParts,
    payload: buildMessagePayload(m, args.toolEvents, args.userAudioDurationMs, args.attachments),
    status: m.role === 'assistant' ? turnStatus(args.aborted, args.errored) : 'complete',
    created_at: new Date(baseMs + i).toISOString(),
  }))
  await db.transaction(async (tx) => {
    await tx.insert(hermesMessage).values(rows)
    await tx
      .update(hermesThread)
      .set({ updated_at: new Date().toISOString() })
      .where(eq(hermesThread.id, args.threadId))
  })
}

export function createHermesRoutes(overrides: Partial<HermesRouteDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides }

  return new Elysia({ name: 'hermes', prefix: '/hermes' })
    .get(
      '/health',
      async () => {
        if (!deps.baseURL) return { status: 'degraded' as const, upstream: { reachable: false } }
        try {
          const res = await deps.fetchImpl(new URL('/health', deps.baseURL).toString(), {
            method: 'GET',
          })
          return {
            status: res.ok ? ('ok' as const) : ('degraded' as const),
            upstream: { reachable: res.ok, status: res.status },
          }
        } catch {
          return { status: 'degraded' as const, upstream: { reachable: false } }
        }
      },
      {
        response: z.object({
          status: z.enum(['ok', 'degraded']),
          upstream: z.object({
            reachable: z.boolean(),
            status: z.number().int().describe('Upstream HTTP status, if reached').optional(),
          }),
        }),
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Hermes upstream liveness',
          description:
            'Pings the Hermes agent core `/health` over Tailscale and reports reachability. Returns `degraded` (never errors) when Hermes is unconfigured or unreachable, so the dashboard can show a soft "Hermes offline" state rather than a hard failure.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/chat',
      ({ body, request, server, status }) => {
        // Unconfigured upstream → fail clean. Without this, an empty baseURL lets
        // streamText connect to an invalid URL, surfacing as a mid-stream error
        // and persisting a broken (empty) assistant turn. Mirrors /health.
        if (!deps.baseURL) {
          return status(503, {
            error: 'hermes_unconfigured',
            message: 'Hermes chat upstream is not configured (HERMES_BASE_URL unset).',
          })
        }

        // Disable Bun's idle timeout for this connection — long streams must not
        // be cut off mid-response. (No-op if the server handle is unavailable.)
        server?.timeout(request, 0)

        const uiMessages = body.messages as unknown as UIMessage[]
        const newTurn = uiMessages[uiMessages.length - 1]
        if (!newTurn) throw new Error('No message in request')

        const toolEvents: ToolProgressData[] = []
        const audioDurationMs = body.userAudioDurationMs
        const sentAttachments = body.attachments

        // Resolved inside execute (after ensureThread) and read in onFinish.
        let resolvedThreadId = ''
        // Set by onError so onFinish persists a failed turn as 'error' rather
        // than the default 'complete' on an empty assistant message.
        let streamErrored = false

        const stream = createUIMessageStream({
          originalMessages: [newTurn],
          generateId: messageIdGen,
          execute: async ({ writer }) => {
            const { threadId, sessionId } = await ensureThread(body, deps.sessionKey)
            resolvedThreadId = threadId

            // Custom fetch: wrap the transport, filter the custom tool-progress
            // channel out of the SDK-bound branch and into transient data parts.
            const tappingFetch: FetchImpl = async (input, init) => {
              const res = await deps.fetchImpl(input, init)
              if (!res.body || !res.ok) return res
              const filtered = filterToolProgress(res.body, (data) => {
                toolEvents.push(data)
                writer.write({ type: 'data-toolProgress', data, transient: true })
              })
              const headers = new Headers(res.headers)
              // Body was already decoded by fetch; drop encoding/length so the
              // SDK doesn't try to re-decompress the filtered stream.
              headers.delete('content-encoding')
              headers.delete('content-length')
              return new Response(filtered, {
                status: res.status,
                statusText: res.statusText,
                headers,
              })
            }

            const provider = createOpenAICompatible({
              name: 'hermes',
              baseURL: deps.baseURL,
              ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
              // FetchFunction is `typeof globalThis.fetch`; our middleware omits
              // the unused `preconnect` member, so widen at the boundary.
              fetch: tappingFetch as typeof fetch,
            })

            const usageStartedAt = new Date().toISOString()
            const usageStartMs = Date.now()
            const result = streamText({
              model: provider.chatModel(deps.model),
              messages: convertToModelMessages([newTurn]),
              headers: {
                'X-Hermes-Session-Id': sessionId,
                'X-Hermes-Session-Key': body.sessionKey ?? deps.sessionKey,
              },
              abortSignal: request.signal,
              // Record proxied-turn token usage into argo.usage_record
              // (source='argo', sub_tool='hermes-proxy'). Fire-and-forget; skip
              // when the upstream reports no token counts.
              onFinish: ({ usage }) => {
                if (usage.inputTokens === undefined && usage.outputTokens === undefined) return
                const inputTokens = usage.inputTokens ?? 0
                const outputTokens = usage.outputTokens ?? 0
                void deps
                  .recordUsage({
                    model: deps.model,
                    usage: {
                      prompt_tokens: inputTokens,
                      completion_tokens: outputTokens,
                      total_tokens: usage.totalTokens ?? inputTokens + outputTokens,
                    },
                    subTool: 'hermes-proxy',
                    startedAt: usageStartedAt,
                    durationMs: Date.now() - usageStartMs,
                  })
                  .catch((err: unknown) => log.error('hermes proxy usage record failed', err))
              },
            })
            writer.merge(result.toUIMessageStream())
          },
          onError: (error) => {
            streamErrored = true
            log.error('hermes chat stream failed', error)
            return 'Hermes stream error'
          },
          onFinish: async ({ messages, isAborted }) => {
            if (!resolvedThreadId) return
            try {
              await persistTurn({
                threadId: resolvedThreadId,
                messages,
                toolEvents,
                aborted: isAborted,
                errored: streamErrored,
                ...(audioDurationMs !== undefined ? { userAudioDurationMs: audioDurationMs } : {}),
                ...(sentAttachments?.length ? { attachments: sentAttachments } : {}),
              })
            } catch (error) {
              log.error('hermes transcript persist failed', error)
              return
            }
            // Auto-title and summarize a fresh thread off the response path:
            // fire-and-forget so they never delay the stream; rows update when
            // DeepSeek answers. Skip on failed turns — there's no real assistant
            // text to work from.
            if (!isAborted && !streamErrored) {
              titleThreadIfNeeded(resolvedThreadId, deps.generateTitle).catch((error) =>
                log.error('hermes auto-title failed', error),
              )
              summarizeThreadIfNeeded(resolvedThreadId, deps.generateSummary).catch((error) =>
                log.error('hermes auto-summarize failed', error),
              )
            }
          },
        })

        return createUIMessageStreamResponse({
          stream,
          headers: { 'X-Accel-Buffering': 'no' },
        })
      },
      {
        body: ChatBodySchema,
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Stream a chat turn through the Hermes agent core',
          description:
            "Proxies the new user turn to Hermes `/v1/chat/completions` (SSE) over Tailscale with the bearer kept server-side, and streams back a Vercel-AI-SDK UIMessageStream. Hermes holds conversation history per `X-Hermes-Session-Id`, so only the latest turn is forwarded. Hermes' custom `hermes.tool.progress` events are injected as transient `data-toolProgress` parts (live progress; not persisted). On completion the user + assistant messages are written verbatim to Postgres. Pass `threadId` to continue a thread; omit it to start a fresh one. Response is `text/event-stream`, not JSON.",
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/threads',
      async ({ body }) => {
        const [row] = await db
          .insert(hermesThread)
          .values({
            id: threadIdGen(),
            session_id: body.sessionId ?? sessionIdGen(),
            session_key: body.sessionKey ?? deps.sessionKey,
            ...(body.title ? { title: body.title } : {}),
          })
          .returning()
        return row! as ThreadResponse
      },
      {
        body: CreateThreadBodySchema,
        response: ThreadSchema,
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Create a chat thread',
          description:
            'Creates a thread, minting a fresh `session_id` (X-Hermes-Session-Id) for a clean Hermes context and defaulting `session_key` (long-term memory scope) to the configured value. Pass `sessionId`/`sessionKey` to adopt explicit ones. Returns the new row. POST /hermes/chat also lazily creates a thread, so calling this first is optional — use it when the UI needs a thread id before the first message.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/threads',
      async ({ query }) => {
        const { page = 1, limit = 50, status = 'active' } = query
        const where = status === 'all' ? undefined : eq(hermesThread.status, status)
        const [rows, [countRow]] = await Promise.all([
          db
            .select()
            .from(hermesThread)
            .where(where)
            .orderBy(desc(hermesThread.pinned), desc(hermesThread.updated_at))
            .limit(limit)
            .offset((page - 1) * limit),
          db.select({ count: count() }).from(hermesThread).where(where),
        ])
        return { data: rows as ThreadResponse[], total: Number(countRow?.count ?? 0) }
      },
      {
        query: ThreadListQuerySchema,
        response: z.object({ data: z.array(ThreadSchema), total: z.number().int() }),
        detail: {
          tags: ['Hermes Chat'],
          summary: 'List chat threads',
          description:
            "Returns threads ordered pinned-first then by most recent activity (updated_at desc). Excludes archived threads by default; pass `?status=archived` or `?status=all` to change that. `total` is the unfiltered count for the active filter. For a thread's transcript use GET /hermes/threads/{id}/messages.",
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/threads/:id/messages',
      async ({ params, status }) => {
        const thread = await db.query.hermesThread.findFirst({
          where: eq(hermesThread.id, params.id),
        })
        if (!thread) return status(404, 'Thread not found')
        const rows = await db
          .select()
          .from(hermesMessage)
          .where(eq(hermesMessage.thread_id, params.id))
          .orderBy(asc(hermesMessage.created_at), asc(hermesMessage.id))
        return { data: rows as MessageResponse[], total: rows.length }
      },
      {
        params: z.object({ id: z.string().describe('Thread id (thr_…).') }),
        response: {
          200: z.object({ data: z.array(MessageSchema), total: z.number().int() }),
          404: z.string(),
        },
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Get a thread transcript',
          description:
            'Returns the verbatim, chronologically ordered messages of a thread (the display transcript Argo owns; Hermes holds only compressed state). Each message carries its AI SDK `parts` (text/cards/etc.) and `payload` (audio refs, attachments, tool events) exactly as persisted, plus a `status` (`complete`/`interrupted`/…). Returns 404 if the thread does not exist.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .patch(
      '/threads/:id',
      async ({ params, body, status }) => {
        const existing = await db.query.hermesThread.findFirst({
          where: eq(hermesThread.id, params.id),
        })
        if (!existing) return status(404, 'Thread not found')

        const set: Partial<typeof hermesThread.$inferInsert> = {}
        if (body.title !== undefined) set.title = body.title
        if (body.pinned !== undefined) set.pinned = body.pinned ? 1 : 0
        if (body.archived !== undefined) {
          set.status = body.archived ? 'archived' : 'active'
          set.archived_at = body.archived ? new Date().toISOString() : null
        }
        if (Object.keys(set).length === 0) return existing as ThreadResponse

        const [row] = await db
          .update(hermesThread)
          .set(set)
          .where(eq(hermesThread.id, params.id))
          .returning()
        return row! as ThreadResponse
      },
      {
        params: z.object({ id: z.string().describe('Thread id (thr_…).') }),
        body: PatchThreadBodySchema,
        response: { 200: ThreadSchema, 404: z.string() },
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Rename, pin, or archive a thread',
          description:
            'Partially updates a thread: `title` renames it, `pinned` pins/unpins (pinned threads sort first), `archived` archives/unarchives it (archiving stamps `archived_at` and sets status to `archived`, hiding it from the default list). Send only the fields to change. Does not touch `updated_at` (which tracks message activity). Returns 404 if the thread does not exist.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
}

export const hermesRoutes = createHermesRoutes()
