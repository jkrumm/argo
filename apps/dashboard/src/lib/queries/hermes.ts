import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

// Hermes Chat data hooks. Thread list + verbatim transcript read through the
// Group 4 read-CRUD routes (`GET /hermes/threads`, `GET /hermes/threads/:id/messages`);
// "new chat" / rename / archive via the mutations below. The live chat turn does
// NOT go through Eden — it streams via useChat → /api/hermes/chat (see
// features/hermes-chat/transport.ts). See docs/HERMES-CHAT-PRD.md.

export type ThreadStatusFilter = 'active' | 'archived' | 'all'

/** A chat thread row (mirrors the API ThreadSchema). */
export type HermesThread = {
  id: string
  session_id: string
  session_key: string
  title: string | null
  status: 'active' | 'archived'
  pinned: number
  archived_at: string | null
  created_at: string
  updated_at: string
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
}

export const hermesQueries = {
  all: () => ['hermes'] as const,

  threads: (status: ThreadStatusFilter = 'active') =>
    queryOptions({
      queryKey: [...hermesQueries.all(), 'threads', status] as const,
      queryFn: async (): Promise<{ data: HermesThread[]; total: number }> =>
        unwrap(await api.hermes.threads.get({ query: { status } })),
      staleTime: 10_000,
    }),

  messages: (threadId: string) =>
    queryOptions({
      queryKey: [...hermesQueries.all(), 'threads', threadId, 'messages'] as const,
      queryFn: async (): Promise<{ data: HermesMessage[]; total: number }> =>
        unwrap(await api.hermes.threads({ id: threadId }).messages.get()),
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

export type PatchThreadBody = {
  id: string
  title?: string
  pinned?: boolean
  archived?: boolean
}

export const hermesMutations = {
  createThread: () => ({
    mutationFn: (body: CreateThreadBody = {}): Promise<HermesThread> =>
      api.hermes.threads.post(body).then(unwrap),
  }),
  patchThread: () => ({
    mutationFn: ({ id, ...body }: PatchThreadBody): Promise<HermesThread> =>
      api.hermes.threads({ id }).patch(body).then(unwrap),
  }),
}
