import { aiSdkTransport } from 'basalt-ui/agent'
import type { AgentPart, OutcomeResolver, ResumableAgentTransport } from 'basalt-ui/agent'
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
  // See the "outbound client-message-id tracking" block below — this is the ONE seam that sees
  // the real wire id aiSdkTransport minted, so it's recorded here for threads-store.ts's dedupe.
  const outboundId = extractMessageId(rewritten.messages[0])
  if (threadId !== undefined && outboundId !== undefined) {
    recordOutboundClientMessageId(threadId, outboundId)
  }
  try {
    const res = await fetch(input, { ...init, headers, body: JSON.stringify(rewritten) })
    // A non-ok response (409 stream_in_progress/duplicate_turn, 503, 401, …) means the server
    // never persisted this turn — record it as failed so mergeOptimisticMessages can drop the
    // orphaned optimistic bubble (see the "rejected-turn" block below). Recorded here, not in
    // notifyHermesChatError, because that fires from AI SDK's own thrown Error, downstream of
    // this response — this is the one place that still has the real Response in hand.
    if (!res.ok && threadId !== undefined && outboundId !== undefined) {
      recordFailedClientMessageId(threadId, outboundId)
    }
    return res
  } catch (err) {
    // A network throw (offline, DNS failure, …) is equally "never persisted" — EXCEPT an abort,
    // which is a deliberate cancellation (Stop), not a rejection; see notifyHermesChatError's own
    // identical guard.
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (!isAbort && threadId !== undefined && outboundId !== undefined) {
      recordFailedClientMessageId(threadId, outboundId)
    }
    throw err
  }
}

// ── outbound client-message-id tracking (exact-key optimistic dedupe) ──────────
//
// `aiSdkTransport.stream()` mints its OWN random id for the wire UIMessage.id, INSIDE its own
// module (node_modules/basalt-ui/src/agent/ai-sdk-transport.ts, the `mintMessageId()` call in
// `stream()`) — a SEPARATE id from the one `useAgentThreadRuns.start()` mints for the ChatMessage
// it appends to the store (use-agent-thread-runs.ts, also `mintMessageId()`, called independently).
// `start()` calls `transport.stream(input, signal)` with only the raw input STRING — never the
// ChatMessage it just appended — so neither basalt internal ever surfaces its id to the other, and
// threads-store.ts's optimistic overlay message can NEVER carry the same id the server ends up
// persisting as `client_message_id`. `hermesFetch` above is the one place in Argo's own code that
// sees the real wire id before it goes out, so it's recorded here, per thread, in SEND ORDER —
// threads-store.ts's `mergeOptimisticMessages` pairs it 1:1, by position, against the confirmed
// server transcript's `client_message_id`s (turns are strictly sequential per thread — the server
// itself refuses a second concurrent turn with 409 `stream_in_progress` — so order is exact).
const outboundClientMessageIdsByThread = new Map<string, readonly string[]>()
// Same shape and lifecycle as the outbound map above, keyed by the same wire id — a turn whose
// POST/GET was rejected (409/503/401/a network throw, never an abort) lands here instead of ever
// reaching `confirmedClientMessageIds`, so `mergeOptimisticMessages` can drop its orphaned
// optimistic bubble rather than keeping it forever (see threads-store.ts's "never confirmed →
// always keep" rule, which is exactly the trap a rejected turn falls into without this).
const failedClientMessageIdsByThread = new Map<string, readonly string[]>()
const EMPTY_IDS: readonly string[] = []

// Both maps above are module-level and per-tab — nothing ever shrinks them on their own. A
// single send appends via `[...prev, id]` (a full copy of the thread's history), so an
// uncapped, never-cleared thread is O(n) work per send and O(n) retained memory over the tab's
// whole lifetime. This cap bounds both: each append copies at most this many entries, and a
// thread can never retain more than this many ids regardless of how long the tab stays open.
// SAFE only because it evicts from the FRONT (oldest first) while `mergeOptimisticMessages`
// pairs ids to overlay entries by POSITION, starting from index 0 — evicting from the front
// re-numbers every still-tracked id relative to the (unbounded, append-only) optimistic overlay
// array in threads-store.ts, so a thread that both (a) never reloads AND (b) sends more than this
// many turns in one uninterrupted tab session could see a stale-but-still-resident overlay entry
// mispaired. 300 turns in one tab session with zero reloads is far outside realistic usage for
// this app (a handful of short chats per day) — see the A3-follow-up brief's own "cap ... at
// something sane" framing — but this is a real, documented trade, not a proven-safe bound.
const MAX_TRACKED_IDS_PER_THREAD = 300

function cappedAppend(prev: readonly string[], id: string): readonly string[] {
  const trimmed = prev.length >= MAX_TRACKED_IDS_PER_THREAD ? prev.slice(1) : prev
  return [...trimmed, id]
}

function extractMessageId(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' ? id : undefined
}

function recordOutboundClientMessageId(threadId: string, id: string): void {
  const prev = outboundClientMessageIdsByThread.get(threadId) ?? EMPTY_IDS
  outboundClientMessageIdsByThread.set(threadId, cappedAppend(prev, id))
}

function recordFailedClientMessageId(threadId: string, id: string): void {
  const prev = failedClientMessageIdsByThread.get(threadId) ?? EMPTY_IDS
  failedClientMessageIdsByThread.set(threadId, cappedAppend(prev, id))
}

/** This thread's outbound user-turn ids, in send order — see the doc block above. */
export function getOutboundClientMessageIds(threadId: string): readonly string[] {
  return outboundClientMessageIdsByThread.get(threadId) ?? EMPTY_IDS
}

/** This thread's REJECTED wire ids (409/503/401/network-throw — never an abort). Read fresh, same
 * non-memoized contract as `getOutboundClientMessageIds` — see its call site in chat-view.tsx. */
export function getFailedClientMessageIds(threadId: string): ReadonlySet<string> {
  return new Set(failedClientMessageIdsByThread.get(threadId) ?? EMPTY_IDS)
}

/** Drops both trackers for a removed thread — the other half of the growth bound above: a cap
 * only bounds a LIVE thread's footprint, it does nothing for a thread that's gone entirely. */
export function clearThreadTransportState(threadId: string): void {
  outboundClientMessageIdsByThread.delete(threadId)
  failedClientMessageIdsByThread.delete(threadId)
}

const baseHermesTransport = aiSdkTransport<AgentPart>({
  api: `${apiBase}/hermes/chat`,
  fetch: hermesFetch as typeof globalThis.fetch,
})

// ── surfacing a rejected turn to the user ──────────────────────────────────────
//
// `useAgentThreadRuns` catches a stream failure internally and only sets the
// thread's `status` to `'error'` (see consumeAndFinalize's catch clause,
// node_modules/basalt-ui/src/agent/use-agent-thread-runs.ts) — it never surfaces
// the actual rejection, so a 409 (already generating / duplicate turn), a 503
// (Hermes not configured), or a 401 would otherwise be COMPLETELY SILENT to the
// user (the composer just clears as if it had succeeded). This wraps the
// transport at the one place that still has the real `Error` in hand.

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

function notifyHermesChatError(err: unknown): void {
  // An abort is a deliberate cancellation (the user's own Stop, or a superseding
  // run) — not a rejection to surface. Mirrors consumeAndFinalize's own guard.
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

async function* withErrorNotification<TPart>(
  generator: AsyncGenerator<TPart>,
): AsyncGenerator<TPart> {
  try {
    yield* generator
  } catch (err) {
    notifyHermesChatError(err)
    throw err
  }
}

/** Wraps one per-thread transport so a rejected `stream()`/`resume()` call
 * notifies before propagating — `useAgentThreadRuns`'s own status handling is
 * unaffected (the error is rethrown, not swallowed here). */
function wrapWithErrorNotification(
  transport: ResumableAgentTransport<AgentPart, string>,
): ResumableAgentTransport<AgentPart, string> {
  return {
    ...transport,
    stream: (input, signal) => withErrorNotification(transport.stream(input, signal)),
    resume: (resumeToken, signal) => withErrorNotification(transport.resume(resumeToken, signal)),
  }
}

export const hermesTransport = {
  ...baseHermesTransport,
  forThread: (threadId: string) =>
    wrapWithErrorNotification(baseHermesTransport.forThread(threadId)),
}

// Argo's thread title/summary are computed server-side, asynchronously, by Hermes' own
// auto-title/auto-summarize pass after a turn finishes (apps/api/src/routes/hermes.ts) — never
// guessed client-side. threads-store.ts's `setOutcome`/`useHermesThreads` never PATCHes a title
// from this resolver at all (the direct store, unlike the retired adapter, has no server-write
// half — pin/rename/archive are driven out-of-band via `hermesMutations.patchThread` instead), so
// this resolver deliberately always returns an empty title/summary: it exists only to satisfy
// `useAgentThreadRuns`'s mandatory arg and to set a terminal `status`, never to author copy the
// server already owns. Do NOT swap this for `heuristicOutcome` — that WOULD render a truncated
// guess in `thread.outcome` even though nothing here ever reads it (thread-feed-row.tsx reads the
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
