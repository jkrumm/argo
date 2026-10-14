export interface HermesTraceIds {
  threadId: string
  streamId: string
  sessionId: string
}

/**
 * Span attributes shared by the Hermes client span and `hermes.stream-lifecycle`.
 * `basalt.chat.thread_id` mirrors the dashboard's basalt `chat.turn` event
 * attribute (the id passed to `useAgentThreadRuns`, sent as `body.threadId`),
 * so API and browser spans join on one key.
 */
export function hermesTraceAttributes({ threadId, streamId, sessionId }: HermesTraceIds) {
  return {
    'argo.hermes.thread_id': threadId,
    'basalt.chat.thread_id': threadId,
    'argo.hermes.stream_id': streamId,
    'argo.hermes.session_id': sessionId,
  }
}
