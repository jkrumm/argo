// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5 and this module only maps Hermes' own wire protocol to ai@5's UIMessageChunk union (never imports ai@7); the v5/v7 skew is neutralized producer-side elsewhere (finish-reason-transform.ts), never by upgrading apps/api (docs/HERMES-CHAT-V2.md).
import type { UIMessageChunk } from 'ai'
import type { HermesEvent, HermesToolCallRecord, HermesUsage } from './hermes-events.js'
import type { ToolEvent } from '../db/schema.js'

// Pure, synchronous translation of Hermes' named-event stream into AI SDK v5
// UIMessageChunks. No I/O — the route lane (hermes.ts) owns wiring this into
// the actual SSE tap and persisting `state.toolEvents`. See docs/HERMES-CHAT-V2.md
// for the phase A2 brief this implements.

/**
 * `ToolEvent` (db/schema.ts) is the persisted shape — this widens it with
 * forensic fields (raw args, preview text, the wire seq, and the real
 * upstream tool-call id/arguments once `run.completed` reveals them). This is
 * a type-only widening scoped to this file: `ToolEvent` lives in a jsonb
 * column, so extra keys need no migration, and every `EnrichedToolEvent` is
 * still structurally a `ToolEvent` (never assigned as an object literal
 * directly into a `ToolEvent`-typed slot, so no excess-property check ever
 * fires) — `MapperState.toolEvents` below stays declared as `ToolEvent[]`
 * per the frozen public API.
 */
export type EnrichedToolEvent = ToolEvent & {
  args?: Record<string, unknown> | null
  preview?: string | null
  seq?: number
  upstreamToolCallId?: string
  upstreamArgumentsJson?: string
}

export type MapperState = {
  runId: string | null
  sessionId: string | null
  messageId: string | null
  usage: HermesUsage | null
  model: string | null
  toolEvents: ToolEvent[]
  sawDone: boolean
  errored: boolean
  lastSeq: number
  unknownCount: number
  parseErrorCount: number
  /**
   * Count of `run.completed.toolResults[]` entries whose `toolName` had no
   * open (unconsumed) `tool.started` call to correlate against — see
   * `reconcileToolOutputs`. Each such result is DROPPED (no chunk emitted for
   * it); this only ever undercounts a turn's outputs, never mis-attaches one
   * tool's output onto another tool's chip.
   */
  correlationMismatchCount: number
  /** Accumulated assistant delta text (all segments concatenated). */
  deltaText: string
  /** `assistant.completed`'s content, verbatim. */
  finalContent: string | null
  /**
   * True once a terminal `finish` chunk has actually been emitted (from
   * `run.completed`, `error`, or `finalize('upstream-ended-without-done')`).
   * The single source of truth for "this turn is already over" — read by
   * `finalize('aborted')` (a no-op once true: a stop landing AFTER
   * `run.completed` but before Hermes' separate `done` frame must not
   * relabel a genuinely completed turn as aborted) and by the route's read
   * loop (to prefer a buffered `run.completed` read over a concurrently-won
   * abort race). Was a private closure variable before this field replaced
   * it — promoted to `state` precisely so the route can read it too.
   */
  finished: boolean
}

type ToolResultClassification =
  | { kind: 'error'; errorText: string }
  | { kind: 'output'; output: unknown }

/**
 * Classify one `run.completed.toolResults[].content` string. Only two
 * documented branches: parses to an object (check `error`/`exit_code`), or
 * does not parse at all (wrap as `{ raw: content }`). A value that parses but
 * isn't an object (a bare string/number/array) is passed through as-is —
 * not explicitly covered by the brief, but the more honest choice than
 * wrapping an already-successfully-parsed value in `{ raw }`.
 */
function classifyToolResultContent(content: string): ToolResultClassification {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { kind: 'output', output: { raw: content } }
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as { error?: unknown; exit_code?: unknown }
    const hasError = obj.error !== null && obj.error !== undefined
    const hasBadExit = typeof obj.exit_code === 'number' && obj.exit_code !== 0
    if (hasError || hasBadExit) {
      const errorText =
        typeof obj.error === 'string' && obj.error.length > 0
          ? obj.error
          : `tool exited with code ${String(obj.exit_code)}`
      return { kind: 'error', errorText }
    }
  }
  return { kind: 'output', output: parsed }
}

export function createHermesChunkMapper(): {
  next(event: HermesEvent): UIMessageChunk[]
  finalize(reason: 'aborted' | 'upstream-ended-without-done'): UIMessageChunk[]
  state: MapperState
} {
  const state: MapperState = {
    runId: null,
    sessionId: null,
    messageId: null,
    usage: null,
    model: null,
    toolEvents: [],
    sawDone: false,
    errored: false,
    lastSeq: 0,
    unknownCount: 0,
    parseErrorCount: 0,
    correlationMismatchCount: 0,
    deltaText: '',
    finalContent: null,
    finished: false,
  }

  // Private bookkeeping — NOT part of the frozen public MapperState contract.
  //
  // CONSTRAINT (b) enforcement point: text part ids are single-use.
  // `processUIMessageStream` (ai/dist/index.mjs:3618-3641) stores the open
  // text part in `state.activeTextParts[id]` on `text-start` and DELETES the
  // entry on `text-end`; a later `text-delta` against that same id then
  // dereferences `undefined.text`, throwing inside the stream (which also
  // means `onFinish` never runs, so the turn is never persisted). Every
  // reopen after a close therefore MUST mint a fresh id — `nextSegmentIndex`
  // only ever increments, never resets, so `${messageId}#0`, `#1`, ... never
  // repeat within one mapper's lifetime.
  let openTextId: string | null = null
  let nextSegmentIndex = 0
  // Per-tool-name FIFO queues of provisional toolCallIds still awaiting an
  // output — the correlation key for `run.completed.toolResults[]`. See
  // `reconcileToolOutputs`'s doc for why this replaced pure positional
  // (wire-order) correlation.
  const openToolCalls = new Map<string, string[]>()

  function closeOpenText(chunks: UIMessageChunk[]): void {
    if (openTextId === null) return
    chunks.push({ type: 'text-end', id: openTextId })
    openTextId = null
  }

  function findToolEvent(toolCallId: string): EnrichedToolEvent | undefined {
    return state.toolEvents.find((e) => e.toolCallId === toolCallId) as
      | EnrichedToolEvent
      | undefined
  }

  /** Push a freshly-started call's provisional id onto its name's FIFO queue. */
  function pushOpenToolCall(toolName: string, toolCallId: string): void {
    const queue = openToolCalls.get(toolName)
    if (queue) queue.push(toolCallId)
    else openToolCalls.set(toolName, [toolCallId])
  }

  /**
   * Shift (consume) the oldest still-open id for `toolName`, or `undefined`
   * if none is open. This is the ONE place a queued id is permanently
   * removed — `run.completed` (via `reconcileToolOutputs`) and `tool.failed`
   * both call this, and each id is popped at most once, so the two paths
   * can never double-consume the same call.
   */
  function popOpenToolCall(toolName: string): string | undefined {
    const queue = openToolCalls.get(toolName)
    if (!queue || queue.length === 0) return undefined
    const id = queue.shift()
    if (queue.length === 0) openToolCalls.delete(toolName)
    return id
  }

  /**
   * Read (without consuming) the oldest still-open id for `toolName`. Used by
   * `tool.completed`'s live-progress chip — the queue is only ever consumed
   * by `popOpenToolCall` (at `run.completed`/`tool.failed`), so peeking here
   * can never race or double-consume it.
   */
  function peekOpenToolCall(toolName: string): string | undefined {
    return openToolCalls.get(toolName)?.[0]
  }

  /**
   * Legacy `data-toolProgress` payload — the shape the CURRENT dashboard
   * renderer (`chat-conversation.tsx` / `types.ts`'s `ToolProgress`) expects:
   * `{ tool, emoji?, label, toolCallId, status }`, mirroring the shape the old
   * SSE tap emitted (removed in A2). Every field is sourced from
   * `tool.started`/`tool.completed`/`tool.failed`, never fabricated: `label`
   * is the tool's own `preview` (recorded on the matching `toolEvents` entry
   * at `tool.started`), falling back to the tool name when no preview was
   * given. `emoji` is intentionally omitted — the new protocol carries none.
   */
  function toolProgressPayload(
    toolName: string,
    toolCallId: string,
    status: 'running' | 'completed' | 'failed',
  ): { tool: string; label: string; toolCallId: string; status: string } {
    const record = findToolEvent(toolCallId)
    return {
      tool: toolName,
      label: record?.label ?? toolName,
      toolCallId,
      status,
    }
  }

  /**
   * Per-tool-name FIFO reconciliation at `run.completed`.
   * `toolResults[]` entries each carry their own `toolName` — the correlation
   * key. For each result, in order, the OLDEST still-open `tool.started` call
   * for that same name is popped off its queue and gets the output; there is
   * no assumption that tool calls of DIFFERENT names interleave in any
   * particular order.
   *
   * A result whose name has no open queue (empty or absent) is DROPPED — no
   * chunk is synthesized for it (an output for an id with no preceding
   * `tool-input-available` throws in `processUIMessageStream`,
   * ai/dist/index.mjs:3510-3520) — and counted in
   * `state.correlationMismatchCount`. Any call left in any queue once every
   * result has been processed never got an output; it's closed generically
   * with `{ status: 'completed' }` so its chip doesn't hang open forever.
   *
   * WHY THIS REPLACED POSITIONAL CORRELATION: the parser (hermes-events.ts)
   * silently skips malformed entries inside `run.completed.messages[]`. Under
   * pure wire-order (index) correlation, one dropped `role:'tool'` entry
   * shifts `toolResults[]` and mis-attaches EVERY later call's output onto
   * the wrong chip. Per-name FIFO only loses the dropped tool's own output —
   * every other tool (any different name) still attaches correctly, because
   * each name's queue is independent of every other name's.
   *
   * RESIDUAL LIMITATION (documented, unverified, and — unlike the positional
   * scheme's — the ONLY one left): two concurrent calls to the SAME tool
   * name returning out of execution order still swap outputs, because FIFO
   * has no way to tell two same-named calls apart without an upstream id.
   * No live capture of that case exists yet.
   */
  function reconcileToolOutputs(
    chunks: UIMessageChunk[],
    event: Extract<HermesEvent, { type: 'run.completed' }>,
  ): void {
    // Forensic upstream linkage (toolCalls[] -> toolEvents.upstreamToolCallId
    // / upstreamArgumentsJson) is keyed by name too, for the same reason as
    // the toolResults correlation above — trusting a positional index here
    // would reintroduce exactly the drift this scheme replaces.
    const upstreamByName = new Map<string, HermesToolCallRecord[]>()
    for (const upstream of event.toolCalls) {
      const queue = upstreamByName.get(upstream.name)
      if (queue) queue.push(upstream)
      else upstreamByName.set(upstream.name, [upstream])
    }

    for (const result of event.toolResults) {
      const toolCallId = popOpenToolCall(result.toolName)
      if (!toolCallId) {
        state.correlationMismatchCount += 1
        continue
      }
      const classified = classifyToolResultContent(result.content)
      if (classified.kind === 'error') {
        chunks.push({
          type: 'tool-output-error',
          toolCallId,
          errorText: classified.errorText,
          dynamic: true,
        })
      } else {
        chunks.push({
          type: 'tool-output-available',
          toolCallId,
          output: classified.output,
          dynamic: true,
        })
      }
      const record = findToolEvent(toolCallId)
      if (record) {
        record.status = classified.kind === 'error' ? 'failed' : 'completed'
        const upstream = upstreamByName.get(result.toolName)?.shift()
        if (upstream) {
          record.upstreamToolCallId = upstream.id
          record.upstreamArgumentsJson = upstream.argumentsJson
        }
      }
    }

    for (const ids of openToolCalls.values()) {
      for (const toolCallId of ids) {
        chunks.push({
          type: 'tool-output-available',
          toolCallId,
          output: { status: 'completed' },
          dynamic: true,
        })
        const record = findToolEvent(toolCallId)
        if (record) record.status = 'completed'
      }
    }
    openToolCalls.clear()
  }

  function next(event: HermesEvent): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    if ('env' in event) state.lastSeq = event.env.seq

    switch (event.type) {
      case 'run.started': {
        state.runId = event.env.runId
        state.sessionId = event.env.sessionId
        chunks.push({ type: 'start' })
        // CONSTRAINT (a) enforcement point: never hang seq/runId/etc. on a
        // standard chunk — the dashboard's ai@7 client validates every chunk
        // with `z.strictObject` and throws on an unknown key
        // (ai/dist/index.js:6228-6412, enforced at :16325). Envelope metadata
        // rides only a `data-*` chunk (its `data` is `z.unknown()`), never a
        // bare extra key on `start`.
        chunks.push({
          type: 'data-hermesRun',
          data: { runId: event.env.runId, sessionId: event.env.sessionId },
          transient: true,
        })
        break
      }
      case 'message.started': {
        state.messageId = event.messageId
        break
      }
      case 'assistant.delta': {
        state.deltaText += event.delta
        if (state.messageId === null) state.messageId = event.messageId
        if (openTextId === null) {
          // Lazy text-start: a tool-only turn never opens an (empty) text part.
          openTextId = `${state.messageId}#${nextSegmentIndex}`
          nextSegmentIndex += 1
          chunks.push({ type: 'text-start', id: openTextId })
        }
        chunks.push({ type: 'text-delta', id: openTextId, delta: event.delta })
        break
      }
      case 'tool.started': {
        closeOpenText(chunks)
        if (state.messageId === null) state.messageId = event.messageId
        const provisionalId = `${event.env.runId}:${event.env.seq}`
        pushOpenToolCall(event.toolName, provisionalId)
        const input: unknown = event.args ?? {}
        chunks.push({
          type: 'tool-input-start',
          toolCallId: provisionalId,
          toolName: event.toolName,
          dynamic: true,
        })
        chunks.push({
          type: 'tool-input-available',
          toolCallId: provisionalId,
          toolName: event.toolName,
          input,
          dynamic: true,
        })
        const enriched: EnrichedToolEvent = {
          tool: event.toolName,
          label: event.preview ?? event.toolName,
          toolCallId: provisionalId,
          status: 'started',
          args: event.args,
          preview: event.preview,
          seq: event.env.seq,
        }
        state.toolEvents.push(enriched)
        // Legacy live-progress channel the CURRENT dashboard renderer reads
        // (chat-conversation.tsx / types.ts's `ToolProgress`) — every field
        // comes from this event, none fabricated (see `toolProgressPayload`).
        chunks.push({
          type: 'data-toolProgress',
          data: {
            tool: event.toolName,
            label: event.preview ?? event.toolName,
            toolCallId: provisionalId,
            status: 'running',
          },
          transient: true,
        })
        break
      }
      case 'tool.completed': {
        // No SDK-part chunk — this event carries no result, so the durable
        // dynamic-tool part is left open (still queued); the real
        // output/error only arrives on `run.completed` (see
        // `reconcileToolOutputs`). It DOES still drive the legacy
        // live-progress channel (chip flips to 'completed'): PEEK (never pop)
        // the oldest still-open id for this name — the queue is only ever
        // consumed at `run.completed`/`tool.failed`, so this can't
        // double-consume it.
        const toolCallId = peekOpenToolCall(event.toolName)
        if (toolCallId) {
          chunks.push({
            type: 'data-toolProgress',
            data: toolProgressPayload(event.toolName, toolCallId, 'completed'),
            transient: true,
          })
        }
        break
      }
      case 'tool.failed': {
        // Dead code upstream today — no known Hermes producer emits
        // `tool.failed` (per the brief). Implemented and tested anyway so the
        // branch is correct if/when Hermes starts emitting it. Pops (not
        // peeks) the oldest open id for this name — this call is now closed
        // for good, so it must not also be consumed again by
        // `reconcileToolOutputs` (or left to hang as a "leftover, never
        // closed" queue entry).
        const toolCallId = popOpenToolCall(event.toolName)
        if (toolCallId) {
          chunks.push({
            type: 'tool-output-error',
            toolCallId,
            errorText: event.error ?? 'tool failed',
            dynamic: true,
          })
          chunks.push({
            type: 'data-toolProgress',
            data: toolProgressPayload(event.toolName, toolCallId, 'failed'),
            transient: true,
          })
          const record = findToolEvent(toolCallId)
          if (record) record.status = 'failed'
        }
        break
      }
      case 'tool.progress': {
        // `_thinking` progress. Deliberately NOT mapped to reasoning-* — a
        // live capture showed the `_thinking` delta was verbatim the final
        // reply text, so a reasoning chunk would render the answer twice.
        //
        // Its own distinct transient type (`data-hermesThinking`), NOT
        // `data-toolProgress`: the legacy `ToolProgress` shape lives on
        // `tool.started`/`tool.completed`/`tool.failed` above (the events
        // that actually carry toolName/preview/toolCallId-worthy data);
        // `tool.progress` only ever carries `{ toolName, delta, messageId }`,
        // so reusing the legacy channel here would mean fabricating a status/
        // label/toolCallId that don't exist. Keeping it a separate type also
        // means it can never collide with the legacy channel's own semantics
        // (e.g. its `status` strings, or `TERMINAL_TOOL_STATUS` checks).
        chunks.push({
          type: 'data-hermesThinking',
          data: { toolName: event.toolName, delta: event.delta, messageId: event.messageId },
          transient: true,
        })
        break
      }
      case 'assistant.completed': {
        closeOpenText(chunks)
        state.finalContent = event.content
        break
      }
      case 'run.completed': {
        state.usage = event.usage
        state.model = event.model
        reconcileToolOutputs(chunks, event)
        if (!state.finished) {
          chunks.push({ type: 'finish', finishReason: 'stop' })
          state.finished = true
        }
        break
      }
      case 'error': {
        // Defect 3: close any still-open text part BEFORE the error/finish
        // pair. The documented upstream failure shape is `error -> done ->
        // close`; `done` sets `state.sawDone = true`, and the route's own
        // `finalize` call is gated on `!sawDone`, so if this doesn't close
        // the text part here, NOTHING downstream ever will — the part is
        // persisted to Postgres stuck at `state: 'streaming'` forever.
        closeOpenText(chunks)
        state.errored = true
        chunks.push({ type: 'error', errorText: event.message })
        if (!state.finished) {
          chunks.push({ type: 'finish', finishReason: 'error' })
          state.finished = true
        }
        break
      }
      case 'done': {
        state.sawDone = true
        break
      }
      case 'unknown': {
        state.unknownCount += 1
        break
      }
      case 'parseError': {
        state.parseErrorCount += 1
        break
      }
    }
    return chunks
  }

  function finalize(reason: 'aborted' | 'upstream-ended-without-done'): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    if (reason === 'aborted') {
      // Defect 1: a stop can land AFTER `run.completed` (which already
      // emitted `finish` and set `state.finished`) but BEFORE Hermes' own
      // separate `done` frame — durable streaming decouples generation from
      // the client connection, so the server routinely finishes well before
      // a client-side Stop click resolves. Once the turn already finished,
      // this is a hard no-op: emitting nothing here (rather than an `abort`
      // chunk) is what keeps `handleUIMessageStreamFinish`'s `isAborted`
      // false, so `onFinish` persists the turn as `complete`, not
      // `interrupted` — a genuinely completed turn must never be relabeled.
      if (state.finished) return chunks
      closeOpenText(chunks)
      // LOAD-BEARING: `handleUIMessageStreamFinish` sets `isAborted` ONLY
      // from an `abort` chunk (ai/dist/index.mjs:3963-3965) — that flag is
      // what persists a stopped turn as `interrupted` rather than
      // `complete`. `streamText` used to emit this for free; this hand-rolled
      // producer does not unless we do it here.
      chunks.push({ type: 'abort' })
      return chunks
    }
    // 'upstream-ended-without-done' — a real upstream failure mode: a
    // write-loop exception ends the stream with no `done` and no `error`.
    closeOpenText(chunks)
    if (!state.finished) {
      chunks.push({ type: 'error', errorText: 'Hermes stream ended without done' })
      chunks.push({ type: 'finish', finishReason: 'error' })
      state.finished = true
    }
    return chunks
  }

  return { next, finalize, state }
}
