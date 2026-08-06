import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { SpanStatusCode, type Span } from '@opentelemetry/api'
// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5 and imports no basalt-ui; the v5/v7 skew is neutralized producer-side by hermes-chunks.ts (which only ever emits legal ai@5 finish reasons) and defensively by finish-reason-transform.ts, never by upgrading apps/api (docs/HERMES-CHAT-V2.md).
import {
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  UI_MESSAGE_STREAM_HEADERS,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { db } from '../db/index.js'
import {
  hermesMessage,
  hermesThread,
  HERMES_THREAD_TYPES,
  type Attachment,
  type HermesThreadType,
  type MessageParts,
  type MessagePayload,
  type ToolEvent,
} from '../db/schema.js'
import { tracedFetch } from '../lib/traced-fetch.js'
import {
  ensureHermesSession,
  openHermesChatStream,
  buildHermesMessageContent,
  type FetchImpl,
} from '../lib/hermes-upstream.js'
import { parseHermesEvents } from '../lib/hermes-events.js'
import { createHermesChunkMapper } from '../lib/hermes-chunks.js'
import {
  clearActiveStream,
  turnAlreadyPersisted,
  resumeOrDead,
  claimActiveStream,
  createDrizzleThreadPointerStore,
  createDrizzleTurnLedger,
} from '../lib/hermes-streams.js'
import { getHermesStreaming, type HermesStreaming } from '../lib/resumable.js'
import { rewriteUnknownFinishReason } from '../lib/finish-reason-transform.js'
import { aiComplete } from './ai.js'
import { recordAiUsage, type RecordUsageFn } from '../lib/ai-usage.js'
import { env } from '../env.js'
import { log, tracer } from '../telemetry.js'

// Hermes Chat — thread-first chat surface backed by the Hermes agent core over
// its named-event SSE API (`POST /api/sessions/{id}/chat/stream`). Argo owns
// the verbatim transcript (hermes_thread + hermes_message); Hermes owns
// compressed agent state per session id.
//
// POST /hermes/chat streams a Vercel-AI-SDK UIMessageStream to the client
// while proxying to Hermes' named-event stream over Tailscale (bearer stays
// server-side). Hermes' own wire protocol is parsed by hermes-events.ts and
// translated to AI SDK chunks by hand via hermes-chunks.ts — there is no
// OpenAI-compatible provider in this path anymore. On finish the user +
// assistant UIMessages are persisted to Postgres. See docs/HERMES-CHAT-V2.md.

const threadIdGen = createIdGenerator({ prefix: 'thr', size: 16 })
const sessionIdGen = createIdGenerator({ prefix: 'ses', size: 24 })
const messageIdGen = createIdGenerator({ prefix: 'msg', size: 16 })
// Resumable-stream id — unique per assistant turn; stored on hermes_thread.active_stream_id.
const streamIdGen = createIdGenerator({ prefix: 'strm', size: 24 })

// `FetchImpl` is defined in lib/hermes-upstream.js (shared with `ensureHermesSession` /
// `openHermesChatStream`) and re-exported here so existing call sites/tests keep importing it
// from this module.
export type { FetchImpl }

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
  /**
   * Durable streaming backend (Valkey-backed resumable-stream + abort registry).
   * `null` disables durability (REDIS_URL unset / tests) — POST /hermes/chat then
   * returns a plain non-resumable stream and a client disconnect persists an
   * interrupted turn (v1 behavior). Injectable so tests can exercise the durable
   * path (resume + stop) with an in-memory fake instead of a live Valkey.
   */
  streaming: HermesStreaming | null
}

const TITLE_SYSTEM =
  `You write concise titles for chat threads. Reply with ONLY the title: 2-6 words, ` +
  `no surrounding quotes, no trailing punctuation, in the language of the conversation.`

/**
 * Injected as the `system` prompt on every POST /hermes/chat turn so the
 * dashboard gets structured audio cards instead of spoken-text prose.
 * Only active on the dashboard path — Slack and other Hermes surfaces are unaffected.
 */
const HERMES_DASHBOARD_SYSTEM_PROMPT =
  'You are answering inside a web dashboard. For any request to be spoken or heard ' +
  '(podcast, voice memo, "read me…", "make a podcast about…"), DO NOT call the ' +
  'text_to_speech tool and DO NOT print the spoken text as prose. Instead reply with ' +
  'a one-line lead-in sentence followed by a fenced card:\n\n' +
  '```card\n' +
  '{"type":"audio","title":"<short title>","script":"<full spoken text>"}\n' +
  '```\n\n' +
  'Put the entire narration in the `script` field. Keep the visible message to one ' +
  'short sentence — never paste the script as prose.'

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
    streaming: getHermesStreaming(),
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

// Per-turn attachment budget (defect 18's app-level half — the global
// maxRequestBodySize backstop wired elsewhere only rejects an oversize body
// before Elysia ever runs; it can't shape a JSON error). 8 attachments covers
// "several photos from one shoot" with headroom. 7MB decoded total (~9.3MB
// base64 on the wire) keeps every turn under Hermes' own 10MB request cap
// (A2) — the prior 24MB budget exceeded it and could turn an Argo-accepted
// turn into an upstream 413. The only current client (the dashboard) caps a
// single attachment at 2MB client-side
// (apps/dashboard/src/features/hermes-chat/chat-conversation.tsx), so 8
// attachments tops out at 16MB from that path already above this budget —
// the cap here is the binding constraint, not the dashboard's own limit. It
// also bounds worst-case memory for a payload stored verbatim in a jsonb
// column and echoed back on every transcript read.
const MAX_ATTACHMENTS = 8
const MAX_ATTACHMENT_BYTES_TOTAL = 7 * 1024 * 1024

/**
 * Rough decoded-byte estimate for one attachment: a `dataUrl`'s base64 payload
 * (image/file attachments) or a `content` string's UTF-8 length (text
 * attachments). Reads only these two known field names — the full `Attachment`
 * union is deliberately not modeled here (same opaque-parse precedent as
 * `messages` below). Fails CLOSED for anything else: a shape matching neither
 * field falls back to the JSON-serialized byte length of the whole attachment,
 * rather than contributing 0. Zero was a real bypass — `attachments` is only
 * validated as `z.array(z.unknown())` and persisted via a raw cast (see
 * `buildMessagePayload`), so any bearer-token holder could send an
 * unrecognized shape (`{"type":"file","blob":"<huge base64>"}`) and have it
 * contribute nothing to the budget while being stored verbatim in the jsonb
 * `payload` column.
 */
function attachmentByteEstimate(a: unknown): number {
  if (typeof a !== 'object' || a === null) return 0
  const dataUrl = (a as { dataUrl?: unknown }).dataUrl
  if (typeof dataUrl === 'string') {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return Math.floor((b64.length * 3) / 4)
  }
  const content = (a as { content?: unknown }).content
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8')
  try {
    return Buffer.byteLength(JSON.stringify(a), 'utf8')
  } catch {
    // Only reachable for a non-JSON-serializable value (e.g. a BigInt field) —
    // can't happen for a body Elysia already parsed as JSON, but fail closed
    // with a non-zero estimate rather than 0 if it ever does.
    return MAX_ATTACHMENT_BYTES_TOTAL + 1
  }
}

/**
 * Validate the attachment budget (count + total decoded bytes) OUTSIDE the Zod
 * body schema, deliberately. `attachments` used to carry a `.max()` + `.refine()`
 * on the schema itself — but Elysia's validation-error response echoes the
 * offending VALUE back in `found`, and for a body-level array field that is the
 * entire request body, base64 data URLs included. A caller posting 9
 * attachments (or an oversize total) got rejected AND had ~2x its payload
 * echoed straight back in the 422 — inverting the whole point of the cap. This
 * function runs by hand, in the handler, before any side effect — a violation
 * returns a small, declared, machine-readable error that never includes the
 * attachments themselves.
 */
function attachmentBudgetError(attachments: unknown[] | undefined): string | null {
  if (!attachments) return null
  if (attachments.length > MAX_ATTACHMENTS) {
    return `At most ${MAX_ATTACHMENTS} attachments per turn.`
  }
  const totalBytes = attachments.reduce((sum: number, a) => sum + attachmentByteEstimate(a), 0)
  if (totalBytes > MAX_ATTACHMENT_BYTES_TOTAL) {
    return `Attachments exceed the ${Math.floor(MAX_ATTACHMENT_BYTES_TOTAL / (1024 * 1024))}MB total budget.`
  }
  return null
}

// Bound on the client-supplied UIMessage.id, persisted as `client_message_id`
// for write idempotency (defect 4). `messages` below stays opaque `z.unknown()`
// (the SDK validates the full UIMessage shape downstream) — this is a targeted
// parse of just the one field Argo itself uses as an index key, so it needs its
// own bound rather than trusting an arbitrary caller-supplied string.
const ClientMessageIdSchema = z.string().trim().min(1).max(128)

/** Extract and bound-validate a UIMessage's client-supplied id, or null when
 * absent/invalid (an API-agent caller sending no id is a legal, supported case). */
function readClientMessageId(message: UIMessage): string | null {
  const result = ClientMessageIdSchema.safeParse(message.id)
  return result.success ? result.data : null
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
  // User-supplied attachments (text/image/file) to carry on the user message
  // payload. Deliberately NOT bounded on this schema (no `.max()`/`.refine()`) —
  // see `attachmentBudgetError`'s doc for why a schema-level check here is the
  // wrong place to enforce the cap.
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
  streaming: z
    .boolean()
    .describe(
      'True while an assistant turn is generating for this thread (derived from the internal ' +
        'active-stream pointer). A client that reloads mid-turn can use this to decide whether to ' +
        'call GET /hermes/chat/{id}/stream to resume, instead of calling it unconditionally on every mount.',
    ),
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
  client_message_id: z
    .string()
    .nullable()
    .describe(
      'Client-supplied idempotency key for a user turn (the outbound AI SDK UIMessage.id) — ' +
        'null for every server-originated (assistant) row. A dashboard client uses this to match ' +
        'its own optimistically-rendered user message against the confirmed server row instead ' +
        'of a timing heuristic.',
    ),
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
 * Row → public `ThreadResponse`: reconciles the DB's plain-text `status` column
 * with the response schema's literal union (same pattern as the comment above),
 * and derives `streaming` from the internal `active_stream_id` pointer rather
 * than exposing that pointer itself — a browser has no legitimate use for the
 * raw stream id, only for whether one is live. Every route returning a thread
 * row goes through this one function so a future field never has to be added
 * at more than one call site — grep `toThreadResponse` to find them all.
 */
function toThreadResponse(row: typeof hermesThread.$inferSelect): ThreadResponse {
  const { active_stream_id, ...rest } = row
  return {
    ...rest,
    status: rest.status as ThreadResponse['status'],
    streaming: active_stream_id !== null,
  }
}

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
  toolEvents: ToolEvent[],
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

/**
 * Row spec for one persisted hermes_message — shared by the early user-turn write
 * (claimed at stream start, before generation) and the turn-finish write
 * (onFinish), so ordering/payload logic lives in one place instead of forking
 * into two near-duplicate persist functions.
 */
interface MessageEntry {
  message: UIMessage
  /** Explicit per-row timestamp (ms). Callers splitting a turn across two writes
   * must pick this so ordering holds across the split — see `persistMessages`. */
  createdAtMs: number
  status: 'complete' | 'streaming' | 'interrupted' | 'error'
  /** Client-supplied UIMessage.id for a user turn (idempotency key); null for
   * every server-originated row, which the partial index never matches. */
  clientMessageId: string | null
}

/**
 * Insert one or more hermes_message rows and bump the thread's updated_at in one
 * transaction. `entries` carries an explicit `createdAtMs` per row (rather than
 * deriving one internally) precisely so a caller splitting a turn across two
 * separate calls — the early user-row write, then the later assistant-row write
 * in onFinish — can guarantee "user sorts before assistant" by construction, which
 * two independent `Date.now()` stamps cannot reliably do within the same
 * millisecond (see the onFinish call site for how the offset is derived).
 *
 * A `client_message_id` conflict (the SAME request's early-write and its own
 * onFinish fallback both firing, or two truly-concurrent requests racing the
 * insert) is absorbed at the ROW level via `ON CONFLICT DO NOTHING` against the
 * partial unique index `uq_hermes_message_thread_client_id` (schema.ts) — the
 * `where` predicate here must mirror the index's own predicate exactly, or
 * Postgres can't infer the partial index and the INSERT throws at runtime (not a
 * type error). Rows with a null `client_message_id` (every server-originated row)
 * never match that predicate, so they're unaffected by the conflict clause. This
 * is defense-in-depth only, NOT the turn-level idempotency guarantee: it stops a
 * duplicate ROW, but on its own would let a retried POST arriving after the
 * original turn finished still silently no-op its user-row insert and then call
 * Hermes again for a second assistant reply. The route itself is what refuses
 * that retry outright (`turnAlreadyPersisted` → `409 duplicate_turn`), before
 * this function — or Hermes — is ever reached for that request.
 */
async function persistMessages(args: {
  threadId: string
  entries: MessageEntry[]
  toolEvents: ToolEvent[]
  userAudioDurationMs?: number
  attachments?: unknown[]
}): Promise<void> {
  // Empty is reachable from onFinish: an errored/aborted turn that produced no
  // assistant message, combined with the early-persist having already succeeded
  // (`userPersisted` true), filters the user message back out too (it's already
  // written) — leaving nothing to insert. Skipping the transaction here also
  // skips its `updated_at` bump, but that bump already happened on the SAME
  // request via the early-persist's own `persistMessages` call (see the
  // `userCreatedAtMs` call site) — so this is a no-op, not a dropped write.
  if (args.entries.length === 0) return
  const rows = args.entries.map((e) => ({
    id: messageIdGen(),
    thread_id: args.threadId,
    role: e.message.role,
    client_message_id: e.clientMessageId,
    parts: (e.message.parts ?? []) as MessageParts,
    payload: buildMessagePayload(
      e.message,
      args.toolEvents,
      args.userAudioDurationMs,
      args.attachments,
    ),
    status: e.status,
    created_at: new Date(e.createdAtMs).toISOString(),
  }))
  await db.transaction(async (tx) => {
    await tx
      .insert(hermesMessage)
      .values(rows)
      .onConflictDoNothing({
        target: [hermesMessage.thread_id, hermesMessage.client_message_id],
        where: sql`${hermesMessage.client_message_id} IS NOT NULL`,
      })
    await tx
      .update(hermesThread)
      .set({ updated_at: new Date().toISOString() })
      .where(eq(hermesThread.id, args.threadId))
  })
}

// The CAS-claim / liveness-probe / resume-or-dead helpers (`clearActiveStream`,
// `turnAlreadyPersisted`, `resumeOrDead`, `isStreamLive`, `claimActiveStream`)
// moved to lib/hermes-streams.js (Phase A1) so they can be exercised in memory
// without Postgres — see that module's doc comments for the multi-process
// honesty argument and the register-before-CAS ordering. Imported above.

export function createHermesRoutes(overrides: Partial<HermesRouteDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides }
  const threadPointerStore = createDrizzleThreadPointerStore(db)
  const turnLedger = createDrizzleTurnLedger(db)

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
      async ({ body, request, server, status }) => {
        // Unconfigured upstream → fail clean. Without this, an empty baseURL lets
        // `ensureHermesSession`/`openHermesChatStream` try to connect to an invalid
        // URL, surfacing as a mid-stream error and persisting a broken (empty)
        // assistant turn. Mirrors /health.
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

        const audioDurationMs = body.userAudioDurationMs
        const sentAttachments = body.attachments
        const clientMessageId = readClientMessageId(newTurn)

        // Attachment budget (defect 18's app-level half) — checked by hand, not by
        // the Zod body schema; see `attachmentBudgetError`'s doc for why. Runs
        // before any DB write or upstream call.
        const attachmentError = attachmentBudgetError(sentAttachments)
        if (attachmentError) {
          return status(422, { error: 'attachment_limit_exceeded', message: attachmentError })
        }

        // Set by onError so onFinish persists a failed turn as 'error' rather
        // than the default 'complete' on an empty assistant message.
        let streamErrored = false

        // Durable streaming decouples generation from the HTTP response: the
        // producer is driven by the Redis buffer (via consumeSseStream) rather
        // than the client connection, so a dropped connection no longer loses the
        // turn — a reconnect resumes via GET /hermes/chat/:id/stream. Because of
        // that, the abort must NOT come from the request signal (Bun #6758:
        // cancel() is unreliable on disconnect, so response-lifecycle cleanup is
        // off-limits); a dedicated controller is aborted only by an explicit stop.
        // When durability is off (no REDIS_URL / tests) we keep v1 semantics: the
        // request signal is the abort, so a client disconnect persists an
        // interrupted turn.
        const durable = deps.streaming
        const streamId = durable ? streamIdGen() : ''
        const abortController = new AbortController()
        const abortSignal = durable ? abortController.signal : request.signal

        // Thread resolution, the durable claim, and the early user-turn write all
        // happen BEFORE the UIMessageStream/Response is constructed — a 409 (or
        // any other rejection) must be a real HTTP status, not something spliced
        // into an SSE body after headers are already committed.
        const { threadId, sessionId } = await ensureThread(body, deps.sessionKey)

        if (durable) {
          // Register the AbortController in-process BEFORE the CAS write, not
          // after. This is the fix for the 100%-reproducible race this ordering
          // used to have: the CAS is a Postgres round trip and the durable
          // backend only learns about the stream several awaits later (in
          // consumeSseStream, below) — a second POST landing in that window used
          // to see the pointer as set but the stream as not-yet-live, and could
          // re-claim it. Registering first means `isStreamLive`'s in-process tier
          // (see its doc) already answers "live" for this streamId the instant
          // the pointer becomes visible to anyone else. Do not move this back
          // below claimActiveStream.
          durable.register(streamId, abortController)
          // Liveness-gated CAS claim (defects 5/6): reject rather than supersede
          // a genuinely live turn — see the standing ruling and claimActiveStream's
          // own doc for the multi-process caveat.
          //
          // The `try` here is load-bearing, not defensive filler: `claimActiveStream`
          // does a SELECT then a CAS UPDATE over Postgres, and either can throw on a
          // transient error. Only the `!claimed` branch used to unregister — a THROW
          // skipped it entirely, leaking the registry entry. That leak is not merely
          // "one AbortController lost": if the CAS UPDATE already committed
          // server-side before the connection dropped (so `active_stream_id` now
          // points at this `streamId`), `isStreamLive`'s tier-1 `has()` check keeps
          // answering "live" for it forever (nothing ever calls `unregister`), so
          // every future POST on this thread 409s permanently — the exact "a leak
          // 409s a thread forever" failure mode this phase was told to avoid. Any
          // thrown error must unregister, same as an explicit `!claimed` loss; the
          // success path below is the only path that must NOT unregister.
          let claimed: boolean
          try {
            claimed = await claimActiveStream(
              { store: threadPointerStore, streaming: durable },
              threadId,
              streamId,
            )
          } catch (error) {
            durable.unregister(streamId)
            throw error
          }
          if (!claimed) {
            // Losing claimant: this streamId never became the thread's active
            // stream, so its registration must be dropped here — otherwise it
            // leaks forever and `has()` keeps answering "live" for a stream
            // nothing is generating, permanently 409ing every future POST on
            // this thread once the actual winner finishes and clears its own.
            durable.unregister(streamId)
            return status(409, {
              error: 'stream_in_progress',
              message:
                'A turn is already generating for this thread. Stop it (POST /hermes/chat/{id}/stop) before starting a new one.',
            })
          }
        }

        // Turn-level idempotency (BLOCKING 2 / the turn half of defect 4):
        // `persistMessages`'s own ON CONFLICT DO NOTHING only dedupes the user
        // ROW — once the original turn has finished and cleared active_stream_id,
        // a retry carrying the same client_message_id passes the live-stream gate
        // above, silently no-ops the duplicate user row, and would still call
        // Hermes again, producing a second assistant reply for one logical turn.
        // Reject it here instead. Deliberately checked AFTER the live-stream 409
        // above, not before: a retry arriving WHILE the original is still
        // generating already has its user row persisted by the ORIGINAL request's
        // own early-write below, so checking client_message_id existence first
        // would misclassify that in-flight retry as "duplicate" when it must
        // instead answer `stream_in_progress` — the live-stream CAS above has to
        // win that race. Only a retry that arrives once the turn has genuinely
        // finished (or was never claimed, durability off) reaches here. Skipped
        // entirely when no client id was supplied (`readClientMessageId` already
        // narrows that to a real, present id) — an API-agent caller sending none
        // behaves exactly as it does today. Replaying the prior turn's result is
        // explicitly out of scope: the caller re-reads the transcript.
        if (
          clientMessageId &&
          (await turnAlreadyPersisted(turnLedger, threadId, clientMessageId))
        ) {
          // This request's own CAS claim above (if durable) already staked
          // active_stream_id on `streamId` — release both sides of that claim
          // before bailing, or it leaks exactly like BLOCKING 1's unhandled-throw
          // case (a pointer nothing will ever clear, permanently 409ing the thread).
          if (durable) {
            durable.unregister(streamId)
            try {
              await clearActiveStream(threadPointerStore, threadId, streamId)
            } catch (error) {
              log.error('hermes duplicate-turn claim release failed', error, {
                threadId,
                streamId,
                runId: undefined,
              })
            }
          }
          return status(409, {
            error: 'duplicate_turn',
            message:
              'A turn with this client_message_id has already been persisted on this thread. Re-read the transcript (GET /hermes/threads/{id}/messages) instead of retrying.',
          })
        }

        // Persist the user turn now, before generation starts (defects 2/8/9): a
        // reload mid-stream, or a crash before onFinish runs, must not lose it.
        // A failed early write is NOT retried here and does NOT fail the request —
        // `userPersisted` stays false, and onFinish's write below still includes
        // the user row as a fallback. That covers the case where the INSERT itself
        // never committed. It does NOT cover every failure mode: the INSERT can
        // commit here and the connection can still fail before this `try` returns
        // (or before `userPersisted = true` is even reached) — `userPersisted`
        // then stays false even though the row exists, and onFinish's fallback
        // fires anyway. With a non-null `clientMessageId` that second insert is
        // absorbed by the partial unique index's `ON CONFLICT DO NOTHING`
        // (persistMessages' own doc) — so the guarantee is "written once, possibly
        // late" only when a client id was supplied. With `clientMessageId` null
        // (any API-agent caller, or a client id that failed the bound in
        // `readClientMessageId`) that index predicate never matches, so this exact
        // race produces two user rows, not one late one. Killing the turn over a
        // write hiccup the user can't even see would still be strictly worse than
        // that — this stays a deliberate, bounded tradeoff, not a bug to close here.
        const userCreatedAtMs = Date.now()
        let userPersisted = false
        try {
          await persistMessages({
            threadId,
            entries: [
              {
                message: newTurn,
                createdAtMs: userCreatedAtMs,
                status: 'complete',
                clientMessageId,
              },
            ],
            toolEvents: [],
            ...(audioDurationMs !== undefined ? { userAudioDurationMs: audioDurationMs } : {}),
            ...(sentAttachments?.length ? { attachments: sentAttachments } : {}),
          })
          userPersisted = true
        } catch (error) {
          log.error(
            'hermes user turn early persist failed (falling back to turn-finish write)',
            error,
            { threadId, streamId, runId: undefined },
          )
        }

        // Set once the mapper is created inside `execute` — read by `onError`
        // (a sibling callback, not nested inside `execute`) and by `onFinish`'s
        // log calls so every log line on this turn can carry `runId` once it's
        // known, without threading it through as a separate mutable variable.
        const mapperRef: { current: ReturnType<typeof createHermesChunkMapper> | undefined } = {
          current: undefined,
        }
        const runIdFor = (): string | undefined => mapperRef.current?.state.runId ?? undefined

        const stream = createUIMessageStream({
          originalMessages: [newTurn],
          generateId: messageIdGen,
          execute: async ({ writer }) => {
            // Defensive no-op post-A2: hermes-chunks.ts's mapper only ever emits
            // finishReason 'stop' (run.completed) or 'error' (error/upstream-ended-
            // without-done) — both already legal in ai@7's accepted set — so this
            // rewrite can never actually fire against this producer. Kept wired
            // (locked decision, see finish-reason-transform.ts) in case that ever
            // changes; there is no stream to `.pipeThrough(...)` anymore since
            // chunks are written one at a time, so it's applied per-chunk instead.
            const writeChunk = (chunk: UIMessageChunk): void => {
              writer.write(rewriteUnknownFinishReason(chunk))
            }

            const hermesMessageContent = buildHermesMessageContent(newTurn.parts)

            // Created BEFORE any upstream call (defect 2) — this is a pure,
            // synchronous constructor with no side effects, so creating it
            // early costs nothing. The AbortController is registered at the
            // CAS claim, well before this point, so a stop can genuinely land
            // while `ensureHermesSession`/`openHermesChatStream` are still in
            // flight; the mapper must already exist so that window can be
            // reported as an abort (see the catch below) instead of falling
            // through `createUIMessageStream`'s own catch as a generic
            // `{type:'error'}` — which would persist a deliberate stop as
            // status `error` rather than `interrupted`.
            const mapper = createHermesChunkMapper()
            mapperRef.current = mapper

            const traceAttributes = {
              'argo.hermes.thread_id': threadId,
              'argo.hermes.stream_id': streamId,
              'argo.hermes.session_id': sessionId,
            }
            let hermesSpan: Span | undefined
            const usageStartedAt = new Date().toISOString()
            const usageStartMs = Date.now()

            let response: Response
            try {
              await ensureHermesSession({
                fetchImpl: deps.fetchImpl,
                baseURL: deps.baseURL,
                apiKey: deps.apiKey,
                sessionId,
              })

              response = await openHermesChatStream({
                fetchImpl: deps.fetchImpl,
                baseURL: deps.baseURL,
                apiKey: deps.apiKey,
                sessionId,
                sessionKey: body.sessionKey ?? deps.sessionKey,
                message: hermesMessageContent,
                systemMessage: HERMES_DASHBOARD_SYSTEM_PROMPT,
                model: deps.model,
                signal: abortSignal,
                traceOptions: {
                  attributes: traceAttributes,
                  onSpan: (span) => {
                    hermesSpan = span
                  },
                  // Opt in to the stream-lifecycle span (defect 4/C4): this is
                  // the one Hermes call that genuinely streams a body the
                  // caller drains over minutes, unlike `ensureHermesSession`
                  // (see its own doc comment for why that one stays default).
                  streamLifecycle: true,
                },
              })
            } catch (error) {
              // Defect 2: an abort landing anywhere in the two calls above
              // (session-open or the chat-stream open) throws — most commonly
              // an AbortError once `openHermesChatStream`'s own `signal`
              // fires — before the mapper's read loop below ever starts.
              // Treat it as the deliberate stop it is rather than rethrowing
              // into `onError` (which would mark the turn `error`).
              if (abortSignal.aborted) {
                for (const chunk of mapper.finalize('aborted')) writeChunk(chunk)
                return
              }
              throw error
            }
            if (!response.body) throw new Error('Hermes chat stream returned no body')

            // Manual span covering the STREAM LIFECYCLE of the turn: the client
            // span (tracedFetch, above) already spans header-to-drain of the raw
            // HTTP body, but an Elysia route handler's own span still closes at
            // TTFB once it returns the streaming Response — without this, the
            // server side would record a multi-second Hermes turn as a few ms.
            await tracer.startActiveSpan(
              'hermes.stream-lifecycle',
              { attributes: traceAttributes },
              async (lifecycleSpan) => {
                try {
                  const reader = parseHermesEvents(response.body!).getReader()
                  const abortWait = new Promise<void>((resolve) => {
                    if (abortSignal.aborted) {
                      resolve()
                      return
                    }
                    abortSignal.addEventListener('abort', () => resolve(), { once: true })
                  })

                  for (;;) {
                    const outcome = await Promise.race([
                      reader.read().then((r) => ({ kind: 'read' as const, r })),
                      abortWait.then(() => ({ kind: 'abort' as const })),
                    ])
                    // Defect 1: ALWAYS fully process a `read` outcome when it's
                    // the one that actually won the race, even if the abort
                    // signal also happened to fire around the same tick — a
                    // buffered `run.completed` (or `done`) sitting in the
                    // reader must never be silently dropped just because a
                    // stop request landed concurrently. Only take the abort
                    // branch when the abort itself is what settled the race.
                    if (outcome.kind === 'read') {
                      const { done, value } = outcome.r
                      if (done) {
                        if (!mapper.state.sawDone) {
                          for (const chunk of mapper.finalize('upstream-ended-without-done')) {
                            writeChunk(chunk)
                          }
                        }
                        break
                      }
                      if (value.type === 'run.started') {
                        hermesSpan?.setAttribute('argo.hermes.run_id', value.env.runId)
                      }
                      for (const chunk of mapper.next(value)) writeChunk(chunk)
                      if (value.type === 'done') {
                        hermesSpan?.setAttribute('argo.hermes.seq_last', mapper.state.lastSeq)
                      }
                      continue
                    }
                    // `mapper.finalize('aborted')` is itself a no-op once the
                    // turn already finished (`run.completed` landed in a prior
                    // iteration) — see its own doc comment. That safety net is
                    // what makes this branch correct even though the abort
                    // race can keep winning on every subsequent iteration once
                    // it has fired once (an already-settled Promise always
                    // wins a fresh `Promise.race`).
                    for (const chunk of mapper.finalize('aborted')) writeChunk(chunk)
                    await reader.cancel().catch(() => {})
                    break
                  }
                  lifecycleSpan.setStatus({ code: SpanStatusCode.OK })
                } catch (error) {
                  lifecycleSpan.recordException(error as Error)
                  lifecycleSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
                  throw error
                } finally {
                  // Defect C6: a turn that silently dropped a tool output
                  // (correlationMismatchCount) or hit malformed/unrecognized
                  // upstream frames (parseErrorCount/unknownCount) produced
                  // zero observable signal before this — surface it both as
                  // span attributes and a warn log, same shape as the
                  // existing 'hermes proxy usage missing' pattern below.
                  const { correlationMismatchCount, parseErrorCount, unknownCount } = mapper.state
                  if (correlationMismatchCount > 0 || parseErrorCount > 0 || unknownCount > 0) {
                    lifecycleSpan.setAttribute(
                      'argo.hermes.correlation_mismatch_count',
                      correlationMismatchCount,
                    )
                    lifecycleSpan.setAttribute('argo.hermes.parse_error_count', parseErrorCount)
                    lifecycleSpan.setAttribute('argo.hermes.unknown_count', unknownCount)
                    log.warn('hermes stream had diagnostic anomalies', {
                      threadId,
                      streamId,
                      runId: runIdFor(),
                      correlationMismatchCount,
                      parseErrorCount,
                      unknownCount,
                    })
                  }
                  lifecycleSpan.end()
                }
              },
            )

            // Record proxied-turn token usage into argo.usage_record
            // (source='argo', sub_tool='hermes-proxy'), sourced from the mapper's
            // `run.completed` state rather than an SDK onFinish callback. A
            // missing usage is logged (not silently skipped) — a silent stop in
            // usage_record rows would otherwise be invisible.
            if (mapper.state.usage) {
              const usage = mapper.state.usage
              void deps
                .recordUsage({
                  model: mapper.state.model ?? deps.model,
                  usage: {
                    prompt_tokens: usage.inputTokens,
                    completion_tokens: usage.outputTokens,
                    total_tokens: usage.totalTokens,
                  },
                  subTool: 'hermes-proxy',
                  startedAt: usageStartedAt,
                  durationMs: Date.now() - usageStartMs,
                })
                .catch((err: unknown) =>
                  log.error('hermes proxy usage record failed', err, {
                    threadId,
                    streamId,
                    runId: runIdFor(),
                  }),
                )
            } else {
              log.debug('hermes proxy usage missing at turn end', {
                threadId,
                streamId,
                runId: runIdFor(),
              })
            }
          },
          onError: (error) => {
            streamErrored = true
            log.error('hermes chat stream failed', error, {
              threadId,
              streamId,
              runId: runIdFor(),
            })
            return 'Hermes stream error'
          },
          onFinish: async ({ messages, isAborted }) => {
            const toolEvents = mapperRef.current?.state.toolEvents ?? []
            let persisted = false
            try {
              // Anchor the assistant row(s) strictly after the user row even if
              // both land in the same wall-clock millisecond (Math.max over a
              // fresh Date.now() vs userCreatedAtMs+1), then offset further
              // entries to preserve the SDK's own relative order among them.
              const assistantBaseMs = Math.max(Date.now(), userCreatedAtMs + 1)
              let offset = 0
              const entries: MessageEntry[] = messages
                .filter((m) => !(userPersisted && m.role === 'user'))
                .map((m): MessageEntry => {
                  if (m.role === 'user') {
                    return {
                      message: m,
                      createdAtMs: userCreatedAtMs,
                      status: 'complete',
                      clientMessageId,
                    }
                  }
                  const createdAtMs = assistantBaseMs + offset
                  offset += 1
                  return {
                    message: m,
                    createdAtMs,
                    status:
                      m.role === 'assistant' ? turnStatus(isAborted, streamErrored) : 'complete',
                    clientMessageId: null,
                  }
                })
              await persistMessages({
                threadId,
                entries,
                toolEvents,
                ...(audioDurationMs !== undefined ? { userAudioDurationMs: audioDurationMs } : {}),
                ...(sentAttachments?.length ? { attachments: sentAttachments } : {}),
              })
              persisted = true
            } catch (error) {
              if (userPersisted) {
                // The user's message is ALREADY durably saved (the early-persist
                // above succeeded) — this failure is what drops the ASSISTANT's
                // reply, permanently: no retry, no dead-letter, a new failure
                // window opened by splitting the turn into two writes. Distinct
                // message + a `dataLoss` attribute (no higher severity than
                // `error` exists on this logger) so this specific shape is
                // greppable/alertable apart from the generic case below, where
                // the user row would also still be missing and is a strictly
                // less surprising loss.
                log.error(
                  'hermes transcript persist failed: assistant reply lost forever (user message was already persisted; no retry, no dead-letter)',
                  error,
                  { dataLoss: true, threadId, streamId, runId: runIdFor() },
                )
              } else {
                log.error('hermes transcript persist failed', error, {
                  threadId,
                  streamId,
                  runId: runIdFor(),
                })
              }
            } finally {
              // Release the durable stream regardless of persist outcome: drop the
              // abort-registry entry and clear the thread pointer, but only if it
              // still points at this stream (a newer turn may have superseded it).
              if (durable) {
                durable.unregister(streamId)
                try {
                  await clearActiveStream(threadPointerStore, threadId, streamId)
                } catch (error) {
                  log.error('hermes active_stream_id clear failed', error, {
                    threadId,
                    streamId,
                    runId: runIdFor(),
                  })
                }
              }
            }
            if (!persisted) return
            // Auto-title and summarize a fresh thread off the response path:
            // fire-and-forget so they never delay the stream; rows update when
            // DeepSeek answers. Skip on failed turns — there's no real assistant
            // text to work from.
            if (!isAborted && !streamErrored) {
              titleThreadIfNeeded(threadId, deps.generateTitle).catch((error) =>
                log.error('hermes auto-title failed', error, {
                  threadId,
                  streamId,
                  runId: runIdFor(),
                }),
              )
              summarizeThreadIfNeeded(threadId, deps.generateSummary).catch((error) =>
                log.error('hermes auto-summarize failed', error, {
                  threadId,
                  streamId,
                  runId: runIdFor(),
                }),
              )
            }
          },
        })

        // Durable: tee the serialized SSE into the resumable producer so it
        // buffers + coordinates independent of the client connection. Plain:
        // v1 behavior — the stream lives and dies with the response.
        if (durable) {
          return createUIMessageStreamResponse({
            stream,
            headers: { 'X-Accel-Buffering': 'no' },
            consumeSseStream: async ({ stream: sse }) => {
              await durable.createNewResumableStream(streamId, () => sse)
            },
          })
        }
        return createUIMessageStreamResponse({
          stream,
          headers: { 'X-Accel-Buffering': 'no' },
        })
      },
      {
        body: ChatBodySchema,
        response: {
          503: z.object({
            error: z.literal('hermes_unconfigured'),
            message: z.string(),
          }),
          409: z.object({
            error: z
              .enum(['stream_in_progress', 'duplicate_turn'])
              .describe(
                '`stream_in_progress`: a turn is already generating for this thread. `duplicate_turn`: this client_message_id was already persisted on a completed turn — re-read the transcript instead of retrying.',
              ),
            message: z.string(),
          }),
          422: z.object({
            error: z.literal('attachment_limit_exceeded'),
            message: z.string(),
          }),
        },
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Stream a chat turn through the Hermes agent core',
          description:
            "Proxies the new user turn to Hermes' named-event chat stream (`POST /api/sessions/{id}/chat/stream`, SSE) over Tailscale with the bearer kept server-side, and streams back a Vercel-AI-SDK UIMessageStream. Hermes holds conversation history per session, so only the latest turn is forwarded (the session is created idempotently on every turn). Hermes' own `tool.started`/`tool.completed`/`tool.failed` events drive both durable tool-call parts and a transient `data-toolProgress` part mirroring the legacy live-progress channel; a `tool.progress` (`_thinking`) event drives a distinct `data-hermesThinking` transient part. The user turn is persisted immediately (before generation starts); the assistant turn on completion. Pass `threadId` to continue a thread; omit it to start a fresh one. Response is `text/event-stream`, not JSON. When durable streaming is enabled the generation is decoupled from this connection — a dropped client can resume via `GET /hermes/chat/{id}/stream`. Returns `409 stream_in_progress` if a turn is already generating for the thread — stop it first. Returns `409 duplicate_turn` when the request's UIMessage id (used as `client_message_id`) was already persisted on a completed turn on this thread — the turn is not replayed; re-read it via GET /hermes/threads/{id}/messages. Returns `422 attachment_limit_exceeded` when `attachments` exceeds the per-turn count or total-size budget — the response never echoes the offending attachments back.",
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/chat/:id/stream',
      async ({ params }) => {
        // Resume an in-flight assistant turn after a dropped connection (the AI
        // SDK's `useChat({ resume: true })` fires this GET on mount). 204 = nothing
        // to resume: durability off, no active stream on the thread, or the stream
        // already finished. Otherwise replay buffered + live SSE from Valkey.
        const streaming = deps.streaming
        if (!streaming) return new Response(null, { status: 204 })
        const thread = await db.query.hermesThread.findFirst({
          where: eq(hermesThread.id, params.id),
          columns: { active_stream_id: true },
        })
        const activeStreamId = thread?.active_stream_id
        if (!activeStreamId) return new Response(null, { status: 204 })
        // A dead pointer (finished/gone stream, or a crashed producer whose
        // sentinel outlives it — 24h TTL, nobody left to answer) means there is
        // nothing to resume: reap it so the next reopen 204s instantly instead of
        // re-hitting the ~1s ack timeout, then 204. `resumeOrDead` is the exact
        // same dead/live classification the POST claim uses (see its doc) — this
        // reap and that 409 can't independently disagree on "is this stream alive".
        const resumed = await resumeOrDead(streaming, activeStreamId)
        if (!resumed) {
          await clearActiveStream(threadPointerStore, params.id, activeStreamId)
          return new Response(null, { status: 204 })
        }
        return new Response(resumed, {
          headers: { ...UI_MESSAGE_STREAM_HEADERS, 'X-Accel-Buffering': 'no' },
        })
      },
      {
        params: z.object({ id: z.string().describe('Thread id (thr_…).') }),
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Resume an in-flight chat stream',
          description:
            'Resumes the assistant turn currently generating for a thread, replaying everything buffered so far plus live output — used by the dashboard to recover a stream after a dropped connection or page reload (AI SDK `useChat({ resume: true })`). Returns `204 No Content` when there is nothing to resume (durable streaming disabled, no active stream, or the turn already finished — read the finished transcript via GET /hermes/threads/{id}/messages instead). An active stream is returned as a `text/event-stream` UIMessageStream. Does not start generation; `POST /hermes/chat` does that.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/chat/:id/stop',
      async ({ params, status }) => {
        const thread = await db.query.hermesThread.findFirst({
          where: eq(hermesThread.id, params.id),
          columns: { active_stream_id: true },
        })
        if (!thread) return status(404, 'Thread not found')
        // Idempotent: no in-flight stream is a no-op success. Aborting drives the
        // stream's onFinish, which persists the partial turn as 'interrupted' and
        // clears active_stream_id. With resume enabled a client-side stop() is only
        // a disconnect, so the dashboard calls this first to truly cancel.
        const activeStreamId = thread.active_stream_id
        const stopped = activeStreamId ? (deps.streaming?.abort(activeStreamId) ?? false) : false
        // A non-null pointer that couldn't be aborted is stale — the producer is
        // gone after a restart (the in-process registry is empty), so no onFinish
        // will ever clear it. Reap it so resume/stop stop tripping over it. A live
        // abort instead clears the pointer via its own onFinish.
        if (activeStreamId && !stopped) {
          await clearActiveStream(threadPointerStore, params.id, activeStreamId)
        }
        return { ok: true, stopped }
      },
      {
        params: z.object({ id: z.string().describe('Thread id (thr_…).') }),
        response: {
          200: z.object({
            ok: z.boolean().describe('Always true — the request was accepted.'),
            stopped: z
              .boolean()
              .describe('True if a live generation was aborted; false if nothing was in-flight.'),
          }),
          404: z.string(),
        },
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Stop an in-flight chat stream',
          description:
            "Cancels the assistant turn currently generating for a thread. Unlike a client disconnect (which, with durable streaming, keeps generating so it can be resumed), this genuinely aborts the underlying work; the partial assistant message is persisted with status `interrupted` and the thread's active stream is cleared. Idempotent — returns `{ ok: true, stopped: false }` when nothing is in-flight. The dashboard calls this before its local stop. Returns 404 if the thread does not exist.",
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
        return toThreadResponse(row!)
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
        return { data: rows.map(toThreadResponse), total: Number(countRow?.count ?? 0) }
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
        if (Object.keys(set).length === 0) return toThreadResponse(existing)

        const [row] = await db
          .update(hermesThread)
          .set(set)
          .where(eq(hermesThread.id, params.id))
          .returning()
        return toThreadResponse(row!)
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
    .delete(
      '/threads/:id',
      async ({ params, status }) => {
        const existing = await db.query.hermesThread.findFirst({
          where: eq(hermesThread.id, params.id),
        })
        if (!existing) return status(404, 'Thread not found')

        // Messages cascade via the hermes_message → hermes_thread FK (onDelete: cascade).
        await db.delete(hermesThread).where(eq(hermesThread.id, params.id))
        return { id: params.id }
      },
      {
        params: z.object({ id: z.string().describe('Thread id (thr_…).') }),
        response: { 200: z.object({ id: z.string() }), 404: z.string() },
        detail: {
          tags: ['Hermes Chat'],
          summary: 'Delete a thread',
          description:
            'Permanently deletes a thread and all of its messages (cascade). Intended for cleaning up empty/abandoned threads (e.g. a "New chat" that never received a turn). For a reversible hide, PATCH `archived: true` instead. Returns 404 if the thread does not exist.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
}

export const hermesRoutes = createHermesRoutes()
