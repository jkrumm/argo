import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  parseAgentPart,
  type AgentOutcome,
  type AgentPart,
  type AgentThread,
  type ChatMessage,
  type ThreadStatus,
  type ThreadsStore,
} from 'basalt-ui/agent'
import { hermesQueries } from '../../lib/queries/hermes'
import type { HermesMessage, HermesThread } from '../../lib/queries/hermes'

// A DIRECT ThreadsStore implementation over Argo's React Query cache — see
// docs/HERMES-CHAT-V2.md for the ruling this replaces (`createAdapterThreadsStore`
// over a Postgres-backed ThreadsStoreAdapter). That adapter's write half was
// entirely no-ops (the server already persists every message — see
// `apps/api/src/routes/hermes.ts`) and `listThreads` returned `messages: []` for
// every row, which violates the adapter contract's own conformance suite
// ("listThreads returned a STALE message list" — node_modules/basalt-ui/src/
// agent/adapter.ts:907) and produced three measured defects in a real browser: a
// race where the post-write "proving" GET beat the POST that lazily creates the
// thread (blanking the feed for a whole turn), the user's own just-sent message
// staying invisible for the whole turn, and resume-after-reload never firing
// because `useAgentThreadRuns`'s mount-only reconcile effect saw an empty list.
//
// This file owns none of that adapter machinery. It keeps ONE local map of
// AgentThreads, mutated synchronously and locally by every ThreadsStore method
// (mirroring `createThreadsStore`'s own localStorage reference implementation —
// node_modules/basalt-ui/src/agent/thread.ts — since Argo's server, not this
// store, is the system of record for writes), and merges in server truth in two
// places only: the threads LIST (title/summary/pin/archive — this store never
// guesses those) and, for a thread the caller has open, its message TRANSCRIPT
// (see `mergeOptimisticMessages`, consumed by hermes-row.tsx). Thread ids are
// stable across the optimistic/confirmed boundary — `create()` mints the id
// client-side and the server's `ensureThread` (hermes.ts) ADOPTS it verbatim on
// the first `POST /hermes/chat` — so the threads-list merge below is a plain
// upsert-by-id, no revalidate-and-prune dance required.
//
// Message ids ARE now stable across that boundary (R1 — MIGRATING.md's `AgentTransport.stream`
// `ctx.messageId`): `aiSdkTransport` sends the SAME id `useAgentThreadRuns.start()` minted for the
// optimistic `ChatMessage` as the wire UIMessage.id, so the server's `client_message_id` for a
// confirmed user turn literally equals the overlay entry's own `id` — see `mergeOptimisticMessages`.

// ── server row → basalt shape conversion (unchanged from the retired adapter) ──

/** ai-sdk v5 wire part shapes (as persisted by the server) → basalt's AgentPart.
 *
 * Two gaps between what's stored and what `parseAgentPart` validates:
 *  - a stored part has no `id` (ai-sdk keys parts by position within the message,
 *    not by a per-part id) — basalt requires one, so one is synthesized.
 *  - a completed/streaming tool call is stored as `{ type: 'dynamic-tool', ... }`
 *    (the ai-sdk wire name); basalt's AgentPart union names the same shape `tool`.
 *
 * Once those two are normalized, `parseAgentPart` does the actual validation
 * (state-machine narrowing, optional-field handling) instead of hand-rolling it
 * again here — its state vocabulary (input-available/output-available/…) is the
 * same AI-SDK-v7 vocabulary the server already writes.
 */
function toAgentPart(raw: unknown, fallbackId: string): AgentPart | null {
  if (raw === null || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const type = obj.type === 'dynamic-tool' ? 'tool' : obj.type
  const id =
    typeof obj.id === 'string'
      ? obj.id
      : typeof obj.toolCallId === 'string'
        ? obj.toolCallId
        : fallbackId
  return parseAgentPart({ ...obj, type, id })
}

/** The four `MessageSchema.status` values that map onto `ChatMessage.finish`.
 * 'streaming' is declared on the server schema but never actually written by the
 * route (see argo-server-contract survey) — it falls through to `undefined`. */
function toFinish(status: HermesMessage['status']): 'complete' | 'stopped' | 'error' | undefined {
  switch (status) {
    case 'complete':
      return 'complete'
    case 'interrupted':
      return 'stopped'
    case 'error':
      return 'error'
    default:
      return undefined
  }
}

/** A server message row → a basalt ChatMessage. Returns null for a 'system' row —
 * ChatMessage.role is 'user' | 'assistant' only; system rows (if any ever land in
 * this table) have nowhere to go in the transcript. */
export type HermesChatMessage = ChatMessage<AgentPart> & {
  /** The server's `client_message_id` for a user-role row — R1 (MIGRATING.md's `AgentTransport.stream`
   * `ctx.messageId`) means this is the SAME id `useAgentThreadRuns.start()` minted for the optimistic
   * `ChatMessage` this row confirms. `undefined` for an assistant row (server-minted, no client id). */
  readonly clientMessageId?: string
}

export function toChatMessage(row: HermesMessage): HermesChatMessage | null {
  if (row.role === 'system') return null
  const parts = row.parts
    .map((raw, index) => toAgentPart(raw, `${row.id}:${index}`))
    .filter((part): part is AgentPart => part !== null)
  const finish = row.role === 'assistant' ? toFinish(row.status) : undefined
  return {
    id: row.id,
    role: row.role,
    parts,
    createdAt: new Date(row.created_at).getTime(),
    ...(finish ? { finish } : {}),
    ...(row.client_message_id !== null ? { clientMessageId: row.client_message_id } : {}),
  }
}

/** Server-only fields `AgentThread` has no typed slot for — the render layer
 * (hermes-row.tsx) reads these directly off `thread.meta`. */
function toMeta(row: HermesThread): Record<string, unknown> {
  return {
    pinned: row.pinned !== 0,
    archived: row.status === 'archived',
    title: row.title,
    summary: row.summary,
    sessionId: row.session_id,
    sessionKey: row.session_key,
    type: row.type,
  }
}

/**
 * A freshly-seen server thread row → AgentThread, for a thread this store has
 * never held locally before. `status`/`resumeToken` are derived from
 * `row.streaming` (server-side `active_stream_id !== null`) so a reload mid-turn
 * still reports the thread as resumable — see `useAgentThreadRuns`'s mount-time
 * reconcile effect, which requires both a `'pending'`/`'streaming'` status AND a
 * defined `resumeToken` to attempt a resume. The token's VALUE is never read as a
 * real credential (Argo's actual resume path is its own SSE-offset mechanism in
 * hermes-transport.ts, keyed by thread id) — `row.id` is reused rather than
 * inventing a second identifier. `read: true` avoids a false "unread" flash on
 * every thread on every load (the server has no unread concept at all); a
 * freshly `create()`d thread (never loaded from the server) starts `read: false`
 * instead, matching basalt's own local reference store.
 */
function rowToThread(
  row: HermesThread,
  messages: ChatMessage<AgentPart>[],
): AgentThread<AgentPart> {
  return {
    id: row.id,
    messages,
    outcome: null,
    status: row.streaming ? 'streaming' : 'done',
    read: true,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    ...(row.streaming ? { resumeToken: row.id } : {}),
    meta: toMeta(row),
  }
}

// ── pure state-transition helpers (exported for unit testing) ──────────────────
//
// Every ThreadsStore method below is a thin useCallback wrapping one of these —
// kept as free functions, not inlined, so the merge/dedupe logic that matters
// (mergeServerThreads' upsert-by-id, mergeOptimisticMessages' id/count filter)
// is testable without a React rendering harness.

export type ThreadsMap = ReadonlyMap<string, AgentThread<AgentPart>>

export function createThreadEntry(
  id: string,
  opts?: { readonly meta?: Record<string, unknown> },
): AgentThread<AgentPart> {
  const now = Date.now()
  return {
    id,
    messages: [],
    outcome: null,
    status: 'pending',
    read: false,
    createdAt: now,
    updatedAt: now,
    ...(opts?.meta !== undefined ? { meta: opts.meta } : {}),
  }
}

export function insertThread(map: ThreadsMap, thread: AgentThread<AgentPart>): ThreadsMap {
  const next = new Map(map)
  next.set(thread.id, thread)
  return next
}

/**
 * Appends a message to a thread already known to this store; a true no-op for an
 * unknown id (never reachable in practice — every caller of `appendMessage`
 * chains behind a `create()` on the same store instance, see `useAgentThreadRuns`).
 *
 * SAFE TO CALL WITHOUT A FOLLOW-UP SERVER FETCH: every call site
 * (`useAgentThreadRuns`'s `start()`/`consumeAndFinalize`/`finalizeStop`) appends
 * only once the write it represents has either already committed server-side
 * (the assistant/stopped message — appended only after the SSE stream has fully
 * closed, i.e. after the server's own persist-on-finish already ran) or is about
 * to be sent in the SAME sequence (the user message — appended synchronously
 * before the POST is even issued). The former is always read-after-write safe;
 * the latter is covered by `mergeOptimisticMessages`' id-based filter instead
 * of a forced fetch, precisely to avoid the exact race this design replaces (a
 * "proving" GET beating the POST that lazily creates the thread).
 */
export function appendMessageToMap(
  map: ThreadsMap,
  id: string,
  message: ChatMessage<AgentPart>,
): ThreadsMap {
  const thread = map.get(id)
  if (thread === undefined) return map
  const next = new Map(map)
  next.set(id, { ...thread, messages: [...thread.messages, message], updatedAt: Date.now() })
  return next
}

export function setOutcomeInMap(map: ThreadsMap, id: string, outcome: AgentOutcome): ThreadsMap {
  const thread = map.get(id)
  if (thread === undefined) return map
  const next = new Map(map)
  next.set(id, { ...thread, outcome, updatedAt: Date.now() })
  return next
}

export function setStatusInMap(map: ThreadsMap, id: string, status: ThreadStatus): ThreadsMap {
  const thread = map.get(id)
  if (thread === undefined) return map
  const next = new Map(map)
  next.set(id, { ...thread, status, updatedAt: Date.now() })
  return next
}

export function setResumeTokenInMap(
  map: ThreadsMap,
  id: string,
  token: string | undefined,
): ThreadsMap {
  const thread = map.get(id)
  if (thread === undefined) return map
  const next = new Map(map)
  // exactOptionalPropertyTypes: drop the key entirely to clear it rather than
  // assigning `resumeToken: undefined` — same idiom as basalt's own thread.ts.
  const { resumeToken: _resumeToken, ...rest } = thread
  next.set(id, {
    ...rest,
    ...(token !== undefined ? { resumeToken: token } : {}),
    updatedAt: Date.now(),
  })
  return next
}

export function markReadInMap(map: ThreadsMap, id: string): ThreadsMap {
  const thread = map.get(id)
  if (thread === undefined || thread.read) return map
  const next = new Map(map)
  next.set(id, { ...thread, read: true })
  return next
}

/**
 * Drops the newest optimistic USER message of a thread — the rollback for a turn the server
 * rejected outright (409 `stream_in_progress` / `duplicate_turn`): nothing was stored, so no
 * server row will ever confirm that id and `mergeOptimisticMessages` would keep the bubble
 * forever. Only the last user message is touched; assistant parts are never rolled back here.
 */
export function removeLastUserMessageFromMap(map: ThreadsMap, id: string): ThreadsMap {
  const thread = map.get(id)
  if (thread === undefined) return map
  let idx = -1
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    if (thread.messages[i]?.role === 'user') {
      idx = i
      break
    }
  }
  if (idx === -1) return map
  const next = new Map(map)
  next.set(id, { ...thread, messages: thread.messages.filter((_, i) => i !== idx) })
  return next
}

export function removeFromMap(map: ThreadsMap, id: string): ThreadsMap {
  if (!map.has(id)) return map
  const next = new Map(map)
  next.delete(id)
  return next
}

/**
 * Upserts server thread rows into the local map BY ID — safe because thread ids
 * are stable across the optimistic/confirmed boundary (see this file's header
 * doc). A thread already known locally keeps its LOCAL `status`/`resumeToken`/
 * `messages`/`outcome`/`read` (this store owns those once created — the server
 * has no run-lifecycle vocabulary to defer to) and only adopts the server's
 * `meta` (title/summary/pin/archive — server-owned) and the more recent of the
 * two `updatedAt`s. A thread not yet known locally is seeded fresh via
 * `rowToThread`, with `messages` from `messagesByThread` when supplied (used
 * only for the initial hydration's eager fetch of currently-streaming threads —
 * see `useHermesThreads`).
 */
export function mergeServerThreads(
  map: ThreadsMap,
  rows: readonly HermesThread[],
  messagesByThread: ReadonlyMap<string, ChatMessage<AgentPart>[]> = new Map(),
): ThreadsMap {
  const next = new Map(map)
  for (const row of rows) {
    const existing = next.get(row.id)
    if (existing === undefined) {
      next.set(row.id, rowToThread(row, messagesByThread.get(row.id) ?? []))
      continue
    }
    next.set(row.id, {
      ...existing,
      meta: toMeta(row),
      updatedAt: Math.max(existing.updatedAt, new Date(row.updated_at).getTime()),
    })
  }
  return next
}

export function sortThreadsNewestFirst(map: ThreadsMap): AgentThread<AgentPart>[] {
  return Array.from(map.values()).toSorted((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * The message-level dedupe: confirmed server messages, plus any optimistic overlay
 * entries not yet covered by the confirmed fetch.
 *
 * USER overlay messages are matched by ID (R1 — MIGRATING.md's `AgentTransport.stream`
 * `ctx.messageId`): `aiSdkTransport` now sends the SAME id `useAgentThreadRuns.start()` minted
 * for the optimistic `ChatMessage` as the wire UIMessage.id, so a user overlay entry is dropped
 * once its `id` equals either a confirmed server message's own `id` (the reload/cross-tab/resume
 * case — `useHermesThreads`'s first-hydration effect seeds `AgentThread.messages` with the full
 * confirmed transcript via `toChatMessage`, so the seeded entry carries the SAME id as the server
 * row it came from) OR a confirmed server message's `clientMessageId` (the live-send case — the
 * server persists the wire id as `client_message_id`, exposed on `HermesChatMessage`). A user
 * message that matches neither is always kept — never hidden.
 *
 * ASSISTANT overlay messages have no client id at all (the server mints their row id), so they're
 * matched by COUNT instead: the Nth assistant-role overlay entry is dropped once `serverMessages`
 * holds more than N confirmed assistant rows. This is safe (not a race) only because every call
 * site that appends one already waited for the server to durably persist it first — see this
 * file's header doc.
 */
export function mergeOptimisticMessages(
  serverMessages: readonly HermesChatMessage[],
  overlay: readonly ChatMessage<AgentPart>[],
): ChatMessage<AgentPart>[] {
  const serverMessageIds = new Set(serverMessages.map((message) => message.id))
  const confirmedClientMessageIds = new Set(
    serverMessages
      .map((message) => message.clientMessageId)
      .filter((id): id is string => id !== undefined),
  )
  const dedupedOverlay = overlay.filter(
    (message) => !serverMessageIds.has(message.id) && !confirmedClientMessageIds.has(message.id),
  )

  const confirmedAssistantCount = serverMessages.filter(
    (message) => message.role === 'assistant',
  ).length
  let assistantIndex = 0
  const pending = dedupedOverlay.filter((message) => {
    if (message.role === 'user') return true
    const index = assistantIndex
    assistantIndex += 1
    return index >= confirmedAssistantCount
  })
  return [...serverMessages, ...pending]
}

// ── hydration helper (imperative fetch, not a hook — see the mount effect) ────

async function fetchThreadMessages(
  queryClient: QueryClient,
  threadId: string,
): Promise<ChatMessage<AgentPart>[]> {
  try {
    const page = await queryClient.fetchQuery(hermesQueries.messages(threadId))
    return page.data
      .map((row) => toChatMessage(row))
      .filter((message): message is ChatMessage<AgentPart> => message !== null)
  } catch {
    return []
  }
}

// ── useHermesThreads ─────────────────────────────────────────────────────────

const THREADS_LIST_OPTS = { limit: 200 } as const

export type HermesThreadsStore = ThreadsStore<AgentPart> & {
  /** Rollback for a server-rejected turn — see `removeLastUserMessageFromMap`. */
  removeLastUserMessage: (id: string) => void
}

export function useHermesThreads(): HermesThreadsStore {
  const queryClient = useQueryClient()
  const listQuery = useQuery(hermesQueries.threads('all', THREADS_LIST_OPTS))

  const [threadsMap, setThreadsMap] = useState<ThreadsMap>(() => new Map())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [error, setError] = useState<unknown>(undefined)
  // Mirrors `hydrated` synchronously — the hydration effect below reads this to
  // decide "first load" vs "later refetch" without depending on a state value
  // that only updates on the NEXT render.
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (listQuery.isError) setError(listQuery.error)
    else if (listQuery.isSuccess) setError(undefined)
  }, [listQuery.isError, listQuery.error, listQuery.isSuccess])

  // Merges the threads list into local state. The FIRST successful load also
  // eagerly fetches messages for any currently-streaming thread(s) — normally
  // zero or one — so `useAgentThreadRuns`'s mount-only reconcile effect (gated
  // on `hydrated`, see chat-page.tsx) finds a real last-user-message to resume
  // from. Every later refetch only merges metadata (see `mergeServerThreads`).
  useEffect(() => {
    const rows = listQuery.data?.data
    if (rows === undefined) return

    if (hydratedRef.current) {
      setThreadsMap((prev) => mergeServerThreads(prev, rows))
      return
    }

    let cancelled = false
    void (async (): Promise<void> => {
      const streamingRows = rows.filter((row) => row.streaming)
      const entries = await Promise.all(
        streamingRows.map(
          async (row) => [row.id, await fetchThreadMessages(queryClient, row.id)] as const,
        ),
      )
      if (cancelled) return
      setThreadsMap((prev) => mergeServerThreads(prev, rows, new Map(entries)))
      hydratedRef.current = true
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [listQuery.data, queryClient])

  const create = useCallback((opts?: { readonly meta?: Record<string, unknown> }): string => {
    const id = crypto.randomUUID()
    const thread = createThreadEntry(id, opts)
    setThreadsMap((prev) => insertThread(prev, thread))
    return id
  }, [])

  const select = useCallback((id: string | null): void => setActiveId(id), [])

  const appendMessage = useCallback((id: string, message: ChatMessage<AgentPart>): void => {
    setThreadsMap((prev) => appendMessageToMap(prev, id, message))
  }, [])

  const removeLastUserMessage = useCallback((id: string): void => {
    setThreadsMap((prev) => removeLastUserMessageFromMap(prev, id))
  }, [])

  const setOutcome = useCallback((id: string, outcome: AgentOutcome): void => {
    setThreadsMap((prev) => setOutcomeInMap(prev, id, outcome))
  }, [])

  const setStatus = useCallback((id: string, status: ThreadStatus): void => {
    setThreadsMap((prev) => setStatusInMap(prev, id, status))
  }, [])

  const setResumeToken = useCallback((id: string, token: string | undefined): void => {
    setThreadsMap((prev) => setResumeTokenInMap(prev, id, token))
  }, [])

  const markRead = useCallback((id: string): void => {
    setThreadsMap((prev) => markReadInMap(prev, id))
  }, [])

  const remove = useCallback((id: string): void => {
    setThreadsMap((prev) => removeFromMap(prev, id))
    setActiveId((prev) => (prev === id ? null : prev))
  }, [])

  const clear = useCallback((): void => {
    setThreadsMap(new Map())
    setActiveId(null)
  }, [])

  const threads = useMemo(() => sortThreadsNewestFirst(threadsMap), [threadsMap])

  return {
    threads,
    activeId,
    select,
    create,
    appendMessage,
    removeLastUserMessage,
    setOutcome,
    setStatus,
    setResumeToken,
    markRead,
    remove,
    clear,
    hydrated,
    error,
  }
}
