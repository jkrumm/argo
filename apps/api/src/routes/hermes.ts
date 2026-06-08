import { Elysia } from 'elysia'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
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
  type MessageParts,
  type MessagePayload,
} from '../db/schema.js'
import { tracedFetch } from '../lib/traced-fetch.js'
import { filterToolProgress, type ToolProgressData } from '../lib/hermes-sse.js'
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

/** Injectable upstream config so tests can point at a fake Hermes SSE server. */
export interface HermesRouteDeps {
  baseURL: string
  apiKey: string
  sessionKey: string
  model: string
  /** Underlying transport the proxy wraps (defaults to the OTel-traced fetch). */
  fetchImpl: FetchImpl
}

function defaultDeps(): HermesRouteDeps {
  return {
    baseURL: env.HERMES_BASE_URL,
    apiKey: env.HERMES_API_KEY,
    sessionKey: env.HERMES_SESSION_KEY,
    model: env.HERMES_MODEL,
    fetchImpl: tracedFetch,
  }
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
})

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

/** Persist the user + assistant turn and bump the thread's updated_at. */
async function persistTurn(args: {
  threadId: string
  messages: UIMessage[]
  toolEvents: ToolProgressData[]
  aborted: boolean
}): Promise<void> {
  const rows = args.messages.map((m) => ({
    id: messageIdGen(),
    thread_id: args.threadId,
    role: m.role,
    parts: (m.parts ?? []) as MessageParts,
    payload:
      m.role === 'assistant' && args.toolEvents.length
        ? ({ toolEvents: args.toolEvents } satisfies MessagePayload)
        : null,
    status: m.role === 'assistant' && args.aborted ? 'interrupted' : 'complete',
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

  return new Elysia({ prefix: '/hermes' })
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
      ({ body, request, server }) => {
        // Disable Bun's idle timeout for this connection — long streams must not
        // be cut off mid-response. (No-op if the server handle is unavailable.)
        server?.timeout(request, 0)

        const uiMessages = body.messages as unknown as UIMessage[]
        const newTurn = uiMessages[uiMessages.length - 1]
        if (!newTurn) throw new Error('No message in request')

        const toolEvents: ToolProgressData[] = []

        // Resolved inside execute (after ensureThread) and read in onFinish.
        let resolvedThreadId = ''

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

            const result = streamText({
              model: provider.chatModel(deps.model),
              messages: convertToModelMessages([newTurn]),
              headers: {
                'X-Hermes-Session-Id': sessionId,
                'X-Hermes-Session-Key': body.sessionKey ?? deps.sessionKey,
              },
              abortSignal: request.signal,
            })
            writer.merge(result.toUIMessageStream())
          },
          onError: (error) => {
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
              })
            } catch (error) {
              log.error('hermes transcript persist failed', error)
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
}

export const hermesRoutes = createHermesRoutes()
