// Parses raw Hermes SSE bytes (`POST /api/sessions/{id}/chat/stream`) into a typed
// `HermesEvent` stream. This module only PARSES the wire protocol — it does not map
// events to AI SDK chunks and does not touch routing; those live in other modules.
//
// Wire format (verified by live capture against Hermes v0.19.1): frames are exactly
// `event: <name>\ndata: <compact single-line JSON>\n\n`. No `id:` line, no `retry:`
// line. Idle keepalives arrive as SSE comment frames (`: keepalive\n\n`) and are
// dropped without disturbing framing.
//
// Termination has three distinct shapes the caller must be able to tell apart:
//   1. Success  — assistant.completed -> run.completed -> done -> stream closes.
//   2. Failure  — error -> done -> stream closes.
//   3. Silent close — upstream ends with NEITHER `done` NOR `error` (e.g. an
//      upstream write-loop exception). This parser never invents a terminal event
//      for that case — it just ends the output stream. A missing `done` is the
//      CONSUMER's signal to treat the run as failed, not this module's.

export type HermesEnvelope = {
  sessionId: string
  runId: string
  seq: number
  ts: number
}

export type HermesToolCallRecord = {
  id: string
  name: string
  argumentsJson: string
}

export type HermesToolResultRecord = {
  toolCallId: string
  toolName: string
  content: string
}

export type HermesUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type HermesEvent =
  | { type: 'run.started'; env: HermesEnvelope }
  | { type: 'message.started'; env: HermesEnvelope; messageId: string }
  | { type: 'assistant.delta'; env: HermesEnvelope; messageId: string; delta: string }
  | {
      type: 'tool.started'
      env: HermesEnvelope
      messageId: string
      toolName: string
      preview: string | null
      args: Record<string, unknown> | null
    }
  | { type: 'tool.completed'; env: HermesEnvelope; messageId: string; toolName: string }
  | {
      type: 'tool.failed'
      env: HermesEnvelope
      messageId: string
      toolName: string
      error: string | null
    }
  | {
      type: 'tool.progress'
      env: HermesEnvelope
      messageId: string
      toolName: string
      delta: string
    }
  | {
      type: 'assistant.completed'
      env: HermesEnvelope
      messageId: string
      content: string
      partial: boolean
      interrupted: boolean
    }
  | {
      type: 'run.completed'
      env: HermesEnvelope
      messageId: string
      // toolCalls/toolResults are flattened from `messages[]` in traversal order.
      // Downstream (hermes-chunks.ts) no longer correlates positionally — it
      // matches each result to the OLDEST still-open call sharing the same
      // toolName (per-name FIFO), because this parser silently drops a
      // malformed `messages[]` entry, which used to shift every later result
      // one slot under pure positional (index) correlation. This traversal
      // order is preserved for forensic value only; nothing downstream
      // depends on it positionally anymore.
      toolCalls: HermesToolCallRecord[]
      toolResults: HermesToolResultRecord[]
      usage: HermesUsage | null
      model: string | null
    }
  | { type: 'error'; env: HermesEnvelope; message: string }
  | { type: 'done'; env: HermesEnvelope }
  | { type: 'unknown'; name: string; data: unknown }
  | { type: 'parseError'; raw: string; reason: string }

/** Thrown internally when a required field is missing or wrong-typed; always caught. */
class HermesFieldError extends Error {}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new HermesFieldError(`"${field}" is not a string`)
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new HermesFieldError(`"${field}" is not a number`)
  }
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new HermesFieldError(`"${field}" is not a boolean`)
  return value
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HermesFieldError(`"${field}" is not an object`)
  }
  return value as Record<string, unknown>
}

function optionalStringOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return requireString(value, field)
}

function optionalObjectOrNull(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  return requireObject(value, field)
}

function parseEnvelope(data: Record<string, unknown>): HermesEnvelope {
  return {
    sessionId: requireString(data['session_id'], 'session_id'),
    runId: requireString(data['run_id'], 'run_id'),
    seq: requireNumber(data['seq'], 'seq'),
    ts: requireNumber(data['ts'], 'ts'),
  }
}

/** Best-effort extraction of one `tool_calls[]` entry. Invalid entries are skipped, never thrown. */
function tryExtractToolCall(value: unknown): HermesToolCallRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const tc = value as Record<string, unknown>
  const id = tc['id']
  const fn = tc['function']
  if (typeof id !== 'string' || typeof fn !== 'object' || fn === null) return null
  const fnObj = fn as Record<string, unknown>
  const name = fnObj['name']
  const argumentsJson = fnObj['arguments']
  if (typeof name !== 'string' || typeof argumentsJson !== 'string') return null
  return { id, name, argumentsJson }
}

/** Best-effort extraction of one `role: 'tool'` message. Invalid entries are skipped, never thrown. */
function tryExtractToolResult(message: Record<string, unknown>): HermesToolResultRecord | null {
  const toolCallId = message['tool_call_id']
  const toolName = message['tool_name']
  const content = message['content']
  if (
    typeof toolCallId !== 'string' ||
    typeof toolName !== 'string' ||
    typeof content !== 'string'
  ) {
    return null
  }
  return { toolCallId, toolName, content }
}

/**
 * Flattens `run.completed.messages[]` in a single pass, preserving traversal order:
 * every `tool_calls[]` entry across all assistant messages into `toolCalls`, and
 * every `role: 'tool'` message into `toolResults`. Missing/malformed `messages`
 * yields empty arrays, never null.
 */
function flattenMessages(value: unknown): {
  toolCalls: HermesToolCallRecord[]
  toolResults: HermesToolResultRecord[]
} {
  const toolCalls: HermesToolCallRecord[] = []
  const toolResults: HermesToolResultRecord[] = []
  if (!Array.isArray(value)) return { toolCalls, toolResults }

  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const message = entry as Record<string, unknown>
    const role = message['role']

    if (role === 'assistant' && Array.isArray(message['tool_calls'])) {
      for (const tc of message['tool_calls'] as unknown[]) {
        const record = tryExtractToolCall(tc)
        if (record) toolCalls.push(record)
      }
    }

    if (role === 'tool') {
      const record = tryExtractToolResult(message)
      if (record) toolResults.push(record)
    }
  }

  return { toolCalls, toolResults }
}

/** `usage` is null when absent or malformed — never zero-filled. */
function parseUsage(value: unknown): HermesUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const usage = value as Record<string, unknown>
  const inputTokens = usage['input_tokens']
  const outputTokens = usage['output_tokens']
  const totalTokens = usage['total_tokens']
  if (
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    typeof totalTokens !== 'number'
  ) {
    return null
  }
  return { inputTokens, outputTokens, totalTokens }
}

/** `model` comes from `usage.runtime.model`, falling back to top-level `runtime.model`, else null. */
function resolveModel(usageValue: unknown, runtimeValue: unknown): string | null {
  if (typeof usageValue === 'object' && usageValue !== null) {
    const runtime = (usageValue as Record<string, unknown>)['runtime']
    if (typeof runtime === 'object' && runtime !== null) {
      const model = (runtime as Record<string, unknown>)['model']
      if (typeof model === 'string') return model
    }
  }
  if (typeof runtimeValue === 'object' && runtimeValue !== null) {
    const model = (runtimeValue as Record<string, unknown>)['model']
    if (typeof model === 'string') return model
  }
  return null
}

function buildEvent(name: string, data: Record<string, unknown>): HermesEvent {
  const env = parseEnvelope(data)

  switch (name) {
    case 'run.started':
      return { type: 'run.started', env }

    case 'message.started': {
      const message = requireObject(data['message'], 'message')
      const messageId = requireString(message['id'], 'message.id')
      return { type: 'message.started', env, messageId }
    }

    case 'assistant.delta': {
      const messageId = requireString(data['message_id'], 'message_id')
      const delta = requireString(data['delta'], 'delta')
      return { type: 'assistant.delta', env, messageId, delta }
    }

    case 'tool.started': {
      const messageId = requireString(data['message_id'], 'message_id')
      const toolName = requireString(data['tool_name'], 'tool_name')
      const preview = optionalStringOrNull(data['preview'], 'preview')
      const args = optionalObjectOrNull(data['args'], 'args')
      return { type: 'tool.started', env, messageId, toolName, preview, args }
    }

    case 'tool.completed': {
      const messageId = requireString(data['message_id'], 'message_id')
      const toolName = requireString(data['tool_name'], 'tool_name')
      return { type: 'tool.completed', env, messageId, toolName }
    }

    case 'tool.failed': {
      const messageId = requireString(data['message_id'], 'message_id')
      const toolName = requireString(data['tool_name'], 'tool_name')
      const error = optionalStringOrNull(data['error'], 'error')
      return { type: 'tool.failed', env, messageId, toolName, error }
    }

    case 'tool.progress': {
      const messageId = requireString(data['message_id'], 'message_id')
      const toolName = requireString(data['tool_name'], 'tool_name')
      const delta = requireString(data['delta'], 'delta')
      return { type: 'tool.progress', env, messageId, toolName, delta }
    }

    case 'assistant.completed': {
      const messageId = requireString(data['message_id'], 'message_id')
      const content = requireString(data['content'], 'content')
      const partial = requireBoolean(data['partial'], 'partial')
      const interrupted = requireBoolean(data['interrupted'], 'interrupted')
      return { type: 'assistant.completed', env, messageId, content, partial, interrupted }
    }

    case 'run.completed': {
      const messageId = requireString(data['message_id'], 'message_id')
      const { toolCalls, toolResults } = flattenMessages(data['messages'])
      const usage = parseUsage(data['usage'])
      const model = resolveModel(data['usage'], data['runtime'])
      return { type: 'run.completed', env, messageId, toolCalls, toolResults, usage, model }
    }

    case 'error': {
      const message = requireString(data['message'], 'message')
      return { type: 'error', env, message }
    }

    case 'done':
      return { type: 'done', env }

    default:
      return { type: 'unknown', name, data }
  }
}

/** Parse a single SSE block (no trailing blank line) into a HermesEvent, or null for a dropped comment/keepalive block. */
function parseFrame(block: string): HermesEvent | null {
  let eventName: string | undefined
  const dataLines: string[] = []
  let sawContentLine = false

  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue // comment / keepalive line
    sawContentLine = true
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }

  if (!sawContentLine) return null // pure comment frame (keepalive) — dropped, framing undisturbed

  if (!eventName) return { type: 'parseError', raw: block, reason: 'missing event name' }
  if (dataLines.length === 0) return { type: 'parseError', raw: block, reason: 'missing data' }

  const rawData = dataLines.join('\n')
  let parsed: unknown
  try {
    parsed = JSON.parse(rawData)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON error'
    return { type: 'parseError', raw: rawData, reason: `invalid JSON: ${message}` }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { type: 'parseError', raw: rawData, reason: 'payload is not an object' }
  }

  try {
    return buildEvent(eventName, parsed as Record<string, unknown>)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown parse error'
    return { type: 'parseError', raw: rawData, reason }
  }
}

/**
 * Wrap a raw Hermes SSE byte stream into a stream of typed `HermesEvent`s.
 *
 * Pull-driven: all reading from `upstream` happens inside `pull`, never in an
 * eager `start()` loop, so a slow consumer applies real backpressure to the
 * upstream socket. A single
 * upstream chunk may contain zero, one, or many complete frames (or a partial
 * frame, or a keepalive comment that yields nothing); `pull` drains buffered
 * frames and reads further upstream chunks until it enqueues exactly one event
 * or upstream reports `done` (at which point it flushes the tail buffer and
 * closes — see the termination-shapes note at the top of this file).
 */
export function parseHermesEvents(
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<HermesEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  // Structural type: dashboard (DOM lib) and api (bun-types) disagree on the
  // reader interface, and ReturnType<typeof getReader> picks the BYOB overload.
  let reader:
    | {
        read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>
        cancel(reason?: unknown): Promise<void>
      }
    | undefined

  const dispatch = (
    block: string,
    controller: ReadableStreamDefaultController<HermesEvent>,
  ): boolean => {
    const event = parseFrame(block)
    if (event === null) return false
    controller.enqueue(event)
    return true
  }

  return new ReadableStream<HermesEvent>({
    start() {
      reader = upstream.getReader()
    },
    async pull(controller) {
      try {
        for (;;) {
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            if (block.length && dispatch(block, controller)) return
          }

          const { done, value } = await reader!.read()
          if (done) {
            // Strip CR so both `\n\n` and `\r\n\r\n` frame delimiters split cleanly.
            buffer += decoder.decode().replace(/\r/g, '')
            const rest = buffer.trim()
            buffer = ''
            if (rest.length) dispatch(rest, controller)
            controller.close()
            return
          }
          buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
        }
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason)
    },
  })
}
