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
    prepareSendMessagesRequest: ({ messages, body }) => {
      const audioMs = args.getPendingAudio?.() ?? null
      return {
        body: {
          ...body,
          threadId: args.threadId,
          sessionId: args.sessionId,
          ...(args.sessionKey ? { sessionKey: args.sessionKey } : {}),
          // Only the latest message — the user's new turn.
          messages: messages.slice(-1),
          ...(audioMs !== null ? { userAudioDurationMs: audioMs } : {}),
        },
      }
    },
  })
}
