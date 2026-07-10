import { Redis } from 'ioredis'
import { createResumableStreamContext } from 'resumable-stream/ioredis'
import { env } from '../env.js'
import { log } from '../telemetry.js'

// Durable/resumable streaming backend for Hermes chat.
//
// Two collaborating pieces behind one interface:
//   1. A `resumable-stream` context (Valkey pub/sub + a 24h sentinel key) that
//      decouples generation from the HTTP response — the producer buffers chunks
//      IN-PROCESS and keeps running even if the client disconnects, so a
//      reconnecting client re-attaches and replays buffered + live output.
//   2. An in-process registry of the AbortController driving each active
//      generation, so an explicit stop (POST /hermes/chat/:id/stop) can cancel
//      the underlying work — client disconnect must NOT (Vercel AI SDK #8390:
//      resume treats aborts as disconnects, so true cancellation needs its own path).
//
// Single-instance only: producer and consumer share this process. Durability
// therefore survives client disconnect/reconnect, NOT a server restart (the
// in-process buffer is lost on redeploy). Acceptable for personal chat.

export interface HermesStreaming {
  /**
   * Publish a new resumable stream from the SSE text stream. The producer drains
   * `make()` to completion regardless of whether a client is attached.
   */
  createNewResumableStream(streamId: string, make: () => ReadableStream<string>): Promise<void>
  /**
   * Resume a live stream; `null` when it is gone or already finished. May REJECT
   * when the producer is gone after a server restart — the sentinel outlives the
   * process (24h TTL) with no one to answer the resume request, so the underlying
   * library rejects with a ~1s ack timeout. Callers must treat a rejection the
   * same as `null` ("nothing to resume") and reap the stale pointer.
   */
  resumeExistingStream(streamId: string): Promise<ReadableStream<string> | null>
  /** Track the AbortController driving `streamId`'s generation (for explicit stop). */
  register(streamId: string, controller: AbortController): void
  /** Abort the generation behind `streamId` if still live. Returns whether it aborted. */
  abort(streamId: string): boolean
  /** Drop `streamId`'s registry entry (on finish). */
  unregister(streamId: string): void
  /** Close the underlying Redis connections (graceful shutdown / test teardown). */
  close(): Promise<void>
}

let singleton: HermesStreaming | null | undefined

/**
 * The process-wide streaming backend, or `null` when `REDIS_URL` is unset — in
 * which case POST /hermes/chat falls back to a plain non-resumable stream. Lazily
 * built once and cached (including the `null`).
 */
export function getHermesStreaming(): HermesStreaming | null {
  if (singleton !== undefined) return singleton
  singleton = env.REDIS_URL ? buildRedisStreaming(env.REDIS_URL) : null
  return singleton
}

function buildRedisStreaming(url: string): HermesStreaming {
  // Two SEPARATE connections: a subscribed ioredis client cannot also publish.
  // maxRetriesPerRequest: null keeps commands queued across reconnects rather than
  // failing after the default retry cap. lazyConnect defers the socket until the
  // first command, so building the context (e.g. at import, or in a test whose deps
  // never actually stream) opens nothing. Raw instances are auto-wrapped by the
  // resumable-stream/ioredis entry (it detects `.defineCommand` and applies its
  // EX-translating adapter), so no adapter code is needed here.
  const publisher = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
  const subscriber = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
  // ioredis logs unhandled 'error' events noisily; attach handlers so a transient
  // Valkey blip degrades a single stream instead of spamming/leaking.
  publisher.on('error', (err) => log.error('resumable-stream publisher redis error', err))
  subscriber.on('error', (err) => log.error('resumable-stream subscriber redis error', err))

  // waitUntil: null → the lib awaits the producer inline (correct for a
  // long-running server; the `after`/keep-alive shim is serverless-only).
  const ctx = createResumableStreamContext({ waitUntil: null, publisher, subscriber })
  const registry = new Map<string, AbortController>()

  return {
    async createNewResumableStream(streamId, make) {
      await ctx.createNewResumableStream(streamId, make)
    },
    async resumeExistingStream(streamId) {
      // undefined (never existed) + null (done) both collapse to null → 204. A
      // rejection (crashed-producer ack timeout) is intentionally NOT swallowed
      // here — the route catches it and reaps the stale pointer.
      const stream = await ctx.resumeExistingStream(streamId)
      return stream ?? null
    },
    register(streamId, controller) {
      registry.set(streamId, controller)
    },
    abort(streamId) {
      const controller = registry.get(streamId)
      if (!controller) return false
      controller.abort()
      return true
    },
    unregister(streamId) {
      registry.delete(streamId)
    },
    async close() {
      registry.clear()
      publisher.disconnect()
      subscriber.disconnect()
    },
  }
}
