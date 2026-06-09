import type { UIMessage } from 'ai'

// Hermes' custom tool-progress event, tapped from the raw SSE by the Argo proxy
// and injected as a transient `data-toolProgress` UI part (delivered via
// useChat's `onData`, never persisted into message.parts). Mirrors the server's
// ToolProgressData (apps/api/src/lib/hermes-sse.ts).
export type ToolProgress = {
  tool: string
  emoji?: string
  label: string
  toolCallId: string
  status: string
}

/** Persisted audio ref from a message payload — hydrated into metadata on load. */
export type AudioRefMeta = {
  url?: string
  title?: string
  durationMs?: number
}

/** Optional non-transcript metadata we carry on hydrated messages. */
export type HermesMessageMetadata = {
  /** DB lifecycle status (e.g. 'interrupted') for a persisted message. */
  status?: string
  /** Audio refs persisted on this message (voice input or generated speech). */
  audio?: AudioRefMeta[]
}

/**
 * The app's UIMessage shape: typed metadata + the single transient data part
 * (`data-toolProgress`). Used to type `useChat` and the transport so `onData`
 * narrows the tool-progress payload.
 */
export type HermesUIMessage = UIMessage<HermesMessageMetadata, { toolProgress: ToolProgress }>
