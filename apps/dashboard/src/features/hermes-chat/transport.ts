import { DefaultChatTransport } from 'ai'
import { getToken } from '../../lib/auth'
import type { HermesUIMessage } from './types'

// useChat streams outside Eden Treaty, so the bearer must be injected here
// (resolved fresh per request from the auth store — never bundled). The proxy at
// /api/hermes/chat keeps the Hermes upstream bearer server-side. See
// docs/HERMES-CHAT-PRD.md.

export const apiBase = import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`

export type TransportArgs = {
  threadId: string
  sessionId: string
  sessionKey?: string
  /**
   * Returns the duration (ms) of a voice recording that was transcribed and used
   * to fill the input before this message was sent. Called synchronously inside
   * prepareSendMessagesRequest, so a stable useRef callback is safe here.
   */
  getPendingAudio?: () => number | null
  /**
   * Returns pending user attachments to carry on the user message payload.
   * Called synchronously inside prepareSendMessagesRequest.
   */
  getPendingAttachments?: () => unknown[] | null
}

/**
 * Build the chat transport for one thread. `prepareSendMessagesRequest` sends
 * only the new turn (Hermes holds history via the session id) plus the thread's
 * ids, matching the proxy's ChatBodySchema.
 */
export function createHermesTransport(args: TransportArgs): DefaultChatTransport<HermesUIMessage> {
  return new DefaultChatTransport<HermesUIMessage>({
    api: `${apiBase}/hermes/chat`,
    headers: () => {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      return headers
    },
    // Reconnect (resume) path for `useChat({ resume: true })`: GET the thread's
    // in-flight stream. Same bearer injection as sends — the `headers` callback
    // above does not apply to the reconnect request, so inject here too.
    prepareReconnectToStreamRequest: ({ id }) => {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      return { api: `${apiBase}/hermes/chat/${id}/stream`, headers }
    },
    prepareSendMessagesRequest: ({ messages, body }) => {
      const audioMs = args.getPendingAudio?.() ?? null
      const attachments = args.getPendingAttachments?.() ?? null
      return {
        body: {
          ...body,
          threadId: args.threadId,
          sessionId: args.sessionId,
          ...(args.sessionKey ? { sessionKey: args.sessionKey } : {}),
          // Only the latest message — the user's new turn.
          messages: messages.slice(-1),
          ...(audioMs !== null ? { userAudioDurationMs: audioMs } : {}),
          ...(attachments?.length ? { attachments } : {}),
        },
      }
    },
  })
}

/**
 * Genuinely cancel the thread's in-flight generation server-side. With `resume`
 * enabled, a client-side `stop()` is only a disconnect — the server keeps
 * generating so the stream can be resumed — so the UI must call this first to
 * actually abort the work and persist the partial turn as `interrupted`. Best
 * effort: a failed stop leaves the stream resumable, which is the safe default.
 */
export async function stopHermesStream(threadId: string): Promise<void> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  await fetch(`${apiBase}/hermes/chat/${threadId}/stop`, { method: 'POST', headers }).catch(
    () => undefined,
  )
}
