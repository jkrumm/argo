import { aiSdkTransport } from 'basalt-ui/agent'
import type { AgentPart, OutcomeResolver } from 'basalt-ui/agent'
import { emit } from 'basalt-ui/notifications'
import { getToken } from '../../lib/auth'
import { apiBase } from '../../lib/api-base'

// The chat transport for every Hermes thread — one shared `aiSdkTransport` instance, bound
// per-thread via `.forThread(threadId)` (see useAgentThreadRuns's per-thread factory form).
// `AiSdkTransportOptions` exposes no request-body/dynamic-header hook of its own (unlike
// `HttpChatTransportInitOptions`, which the old hand-rolled `DefaultChatTransport` used for
// `prepareSendMessagesRequest`/`prepareReconnectToStreamRequest`/a resolvable `headers` fn) — its
// only extension seam is `fetch`, so `hermesFetch` below does everything those three used to:
// inject a FRESH bearer per call (never a token baked in at construction), and rewrite the POST
// body to match Argo's `ChatBodySchema` (`threadId`, and only the new turn — AI SDK's default
// body sends the full `messages` history plus a generic `id` field, neither of which matches).
// The GET reconnect has no body, so the body-rewrite branch is a no-op for it — but it still gets
// a fresh bearer, unifying what used to be two separate injection points into one.
// Typed as a plain callable rather than `typeof globalThis.fetch` — Bun's global `fetch` type
// additionally carries a static `preconnect` member this wrapper never needs to implement; cast at
// the `aiSdkTransport({ fetch: ... })` call site below instead of widening this function's shape.
const hermesFetch = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> => {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  if (typeof init?.body !== 'string') return fetch(input, { ...init, headers })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(init.body) as Record<string, unknown>
  } catch {
    return fetch(input, { ...init, headers })
  }
  const threadId = typeof body.id === 'string' ? body.id : undefined
  const messages = Array.isArray(body.messages) ? body.messages : []
  const rewritten = {
    ...body,
    ...(threadId !== undefined ? { threadId } : {}),
    // Hermes holds history server-side via the thread/session id — only the new turn is sent.
    messages: messages.slice(-1),
  }
  return fetch(input, { ...init, headers, body: JSON.stringify(rewritten) })
}

// One shared `aiSdkTransport` instance for every Hermes thread. `aiSdkTransport` itself now sends
// `ctx.messageId` (the id `useAgentThreadRuns.start()`/`retry()` already minted for the turn's
// optimistic ChatMessage) as the wire UIMessage.id instead of minting its own — R1, MIGRATING.md's
// `AgentTransport.stream` third param — so this file no longer needs to track outbound/failed
// wire ids for threads-store.ts's dedupe (see `mergeOptimisticMessages`, which now compares
// directly against the server's `client_message_id`).
export const hermesTransport = aiSdkTransport<AgentPart>({
  api: `${apiBase}/hermes/chat`,
  fetch: hermesFetch as typeof globalThis.fetch,
})

// ── surfacing a rejected turn to the user ──────────────────────────────────────
//
// `useAgentThreadRuns({ onError })` (basalt 1.29 — MIGRATING.md's R2) fires from the SAME catch
// branch that sets the thread's failure status, for any genuine (non-abort) stream failure — a
// 409 (already generating / duplicate turn), a 503 (Hermes not configured), a 401 — so chat-page.tsx
// wires it straight to `notifyHermesChatError` below instead of this file wrapping the transport
// itself to intercept the throw.

/** The `{ error, message }` body every structured Hermes-chat error response
 * carries (409 stream_in_progress/duplicate_turn, 503 hermes_unconfigured, 422
 * attachment_limit_exceeded — see ChatBodySchema's `response` map in hermes.ts).
 * AI SDK's `DefaultChatTransport` throws `new Error(await response.text())` on a
 * non-ok response (node_modules/ai's http-chat-transport.ts), so the raw JSON
 * body arrives as the thrown Error's `message` — this re-parses it. */
type HermesChatErrorBody = { readonly error: string; readonly message: string }

function parseHermesChatErrorBody(raw: string): HermesChatErrorBody | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>)['error'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['message'] === 'string'
    ) {
      return parsed as HermesChatErrorBody
    }
  } catch {
    // Not JSON — e.g. authGuard's plain-text 401 body ("Unauthorized"). Falls
    // through to the generic branch in notifyHermesChatError.
  }
  return null
}

const HERMES_CHAT_ERROR_TITLES: Record<string, string> = {
  stream_in_progress: 'Already generating',
  duplicate_turn: 'Message already sent',
  hermes_unconfigured: 'Hermes unavailable',
  attachment_limit_exceeded: 'Attachment too large',
}

/** A turn the server refused before storing anything (another run is active, or the same
 * client message id was already taken) — the optimistic user bubble must be rolled back locally
 * because no server row will ever confirm it. */
export function isRejectedTurnError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err)
  const body = parseHermesChatErrorBody(raw)
  return body?.error === 'stream_in_progress' || body?.error === 'duplicate_turn'
}

/** Surfaces a genuine (non-abort) Hermes chat-stream failure as a toast. Wired via
 * `useAgentThreadRuns({ onError: ({ error }) => notifyHermesChatError(error) })` in chat-page.tsx. */
export function notifyHermesChatError(err: unknown): void {
  // An abort is a deliberate cancellation (the user's own Stop, or a superseding
  // run) — not a rejection to surface. `useAgentThreadRuns`'s `onError` never fires
  // for one (see consumeAndFinalize's own guard), but this stays defensive.
  if (err instanceof Error && err.name === 'AbortError') return
  const raw = err instanceof Error ? err.message : String(err)
  const body = parseHermesChatErrorBody(raw)
  if (body) {
    emit(
      'chat:error',
      { message: body.message },
      { title: HERMES_CHAT_ERROR_TITLES[body.error] ?? 'Chat error' },
    )
    return
  }
  emit(
    'chat:error',
    {
      message:
        raw === 'Unauthorized'
          ? 'Your session has expired — sign in again.'
          : raw || 'The chat request failed.',
    },
    { title: 'Chat error' },
  )
}

// Argo's thread title/summary are computed server-side, asynchronously, by Hermes' own
// auto-title/auto-summarize pass after a turn finishes (apps/api/src/routes/hermes.ts) — never
// guessed client-side. threads-store.ts's `setOutcome`/`useHermesThreads` never PATCHes a title
// from this resolver at all (the direct store, unlike the retired adapter, has no server-write
// half — pin/rename/archive are driven out-of-band, server-side, instead), so this resolver
// deliberately always returns an empty title/summary: it exists only to satisfy
// `useAgentThreadRuns`'s mandatory arg and to set a terminal `status`, never to author copy the
// server already owns. Do NOT swap this for `heuristicOutcome` — that WOULD render a truncated
// guess in `thread.outcome` even though nothing here ever reads it (hermes-row.tsx reads the
// server's own title/summary off `thread.meta` instead).
export const resolveHermesOutcome: OutcomeResolver<AgentPart> = (thread) => {
  const last = thread.messages.at(-1)
  return { title: '', summary: '', status: last?.finish === 'error' ? 'error' : 'done' }
}

// D-A: the server stop response is `{ ok: true, stopped: boolean }` and MUST be inspected — a
// durable stream routinely finishes generating before the client finishes rendering, so
// `stopped: false` is the common case, not a rare race (see hermes.ts's `abort()` return and the
// A3 brief). Callers use this to decide whether to run the local `useAgentThreadRuns.stop()`
// (which truncates to whatever partial parts have arrived) or leave the live stream alone so it
// reaches its own, already-decided, complete end.
export async function stopHermesThread(threadId: string): Promise<{ stopped: boolean } | null> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`${apiBase}/hermes/chat/${threadId}/stop`, { method: 'POST', headers })
    if (!res.ok) return null
    const body = (await res.json()) as { ok: boolean; stopped: boolean }
    return { stopped: body.stopped }
  } catch {
    return null
  }
}
