import { queryOptions } from '@tanstack/react-query'
import { EdenFetchError } from '@elysiajs/eden'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

function isNotFoundError(error: unknown): boolean {
  return error instanceof EdenFetchError && error.status === 404
}

// Hermes Chat data hooks. Thread list + verbatim transcript read through the
// Group 4 read-CRUD routes (`GET /hermes/threads`, `GET /hermes/threads/:id/messages`);
// "new chat" / rename / archive via the mutations below. The live chat turn does
// NOT go through Eden — it streams via useChat → /api/hermes/chat (see
// features/hermes-chat/transport.ts). See docs/HERMES-CHAT-PRD.md.

export type ThreadStatusFilter = 'active' | 'archived' | 'all'

export type HermesThreadType = 'todo' | 'podcast' | 'infra' | 'note' | 'research' | 'general'

/** A chat thread row (mirrors the API ThreadSchema). */
export type HermesThread = {
  id: string
  session_id: string
  session_key: string
  title: string | null
  summary: string | null
  type: HermesThreadType | null
  status: 'active' | 'archived'
  pinned: number
  archived_at: string | null
  created_at: string
  updated_at: string
  /** True while an assistant turn is generating for this thread (derived
   * server-side from `hermes_thread.active_stream_id`). */
  streaming: boolean
}

/** A persisted message row (mirrors the API MessageSchema). */
export type HermesMessage = {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  parts: unknown[]
  payload: unknown
  status: 'complete' | 'streaming' | 'interrupted' | 'error'
  created_at: string
  /** Client-supplied idempotency key for a user turn (the outbound AI SDK
   * UIMessage.id) — null for every server-originated (assistant) row. */
  client_message_id: string | null
}

export const hermesQueries = {
  all: () => ['hermes'] as const,

  threads: (status: ThreadStatusFilter = 'active', opts?: { limit?: number }) =>
    queryOptions({
      queryKey: [...hermesQueries.all(), 'threads', status, opts?.limit ?? null] as const,
      queryFn: async (): Promise<{ data: HermesThread[]; total: number }> =>
        unwrap(
          await api.hermes.threads.get({
            query: { status, ...(opts?.limit !== undefined ? { limit: opts.limit } : {}) },
          }),
        ),
      staleTime: 10_000,
    }),

  messages: (threadId: string) =>
    queryOptions({
      queryKey: [...hermesQueries.all(), 'threads', threadId, 'messages'] as const,
      // A 404 (the thread hasn't been lazily created server-side yet — e.g. a
      // just-`create()`d local thread that hasn't had a first turn sent) reads as
      // "no messages yet", not a query error: the caller (threads-store.ts's
      // `useHermesThreads`, hermes-row.tsx) always has an optimistic overlay to
      // show regardless, and surfacing this as a thrown error would flip the
      // whole view into an error state for what is normal, expected timing.
      queryFn: async (): Promise<{ data: HermesMessage[]; total: number }> => {
        const result = await api.hermes.threads({ id: threadId }).messages.get()
        if (result.error && isNotFoundError(result.error)) return { data: [], total: 0 }
        return unwrap(result)
      },
      enabled: threadId.length > 0,
      // Live state lives in useChat; this is only re-read on (re)mount, so a short
      // staleTime is enough to pick up a just-finished turn's persisted rows.
      staleTime: 5_000,
    }),

  health: () =>
    queryOptions({
      queryKey: [...hermesQueries.all(), 'health'] as const,
      queryFn: async () => unwrap(await api.hermes.health.get()),
      staleTime: 30_000,
    }),
}

export type CreateThreadBody = {
  title?: string
  sessionId?: string
  sessionKey?: string
}

export const hermesMutations = {
  createThread: () => ({
    mutationFn: (body: CreateThreadBody = {}): Promise<HermesThread> =>
      api.hermes.threads.post(body).then(unwrap),
  }),
  deleteThread: () => ({
    mutationFn: (id: string): Promise<{ id: string }> =>
      api.hermes.threads({ id }).delete().then(unwrap),
  }),
}
