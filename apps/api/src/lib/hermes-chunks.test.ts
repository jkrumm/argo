import { describe, expect, it } from 'bun:test'

// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5; this test only exercises hermes-chunks.ts's own ai@5 UIMessageChunk output (docs/HERMES-CHAT-V2.md).
import type { UIMessageChunk } from 'ai'
import { createHermesChunkMapper } from './hermes-chunks.js'
import type { HermesEnvelope, HermesEvent } from './hermes-events.js'

// Pure unit tests — no DB, no network. `HermesEvent` literals only.

const RUN_ID = 'run_1'
const SESSION_ID = 'ses_1'
const MESSAGE_ID = 'msg_1'

function env(seq: number): HermesEnvelope {
  return { sessionId: SESSION_ID, runId: RUN_ID, seq, ts: 1000 + seq }
}

function runStarted(seq: number): HermesEvent {
  return { type: 'run.started', env: env(seq) }
}

function messageStarted(seq: number, messageId = MESSAGE_ID): HermesEvent {
  return { type: 'message.started', env: env(seq), messageId }
}

function delta(seq: number, text: string, messageId = MESSAGE_ID): HermesEvent {
  return { type: 'assistant.delta', env: env(seq), messageId, delta: text }
}

function toolStarted(
  seq: number,
  toolName: string,
  args: Record<string, unknown> | null = {},
  preview: string | null = null,
  messageId = MESSAGE_ID,
): HermesEvent {
  return { type: 'tool.started', env: env(seq), messageId, toolName, preview, args }
}

function toolCompleted(seq: number, toolName: string, messageId = MESSAGE_ID): HermesEvent {
  return { type: 'tool.completed', env: env(seq), messageId, toolName }
}

function toolFailed(
  seq: number,
  toolName: string,
  error: string | null,
  messageId = MESSAGE_ID,
): HermesEvent {
  return { type: 'tool.failed', env: env(seq), messageId, toolName, error }
}

function toolProgress(
  seq: number,
  toolName: string,
  text: string,
  messageId = MESSAGE_ID,
): HermesEvent {
  return { type: 'tool.progress', env: env(seq), messageId, toolName, delta: text }
}

function assistantCompleted(
  seq: number,
  content: string,
  opts: { partial?: boolean; interrupted?: boolean; messageId?: string } = {},
): HermesEvent {
  return {
    type: 'assistant.completed',
    env: env(seq),
    messageId: opts.messageId ?? MESSAGE_ID,
    content,
    partial: opts.partial ?? false,
    interrupted: opts.interrupted ?? false,
  }
}

function runCompleted(
  seq: number,
  opts: {
    toolCalls?: { id: string; name: string; argumentsJson: string }[]
    toolResults?: { toolCallId: string; toolName: string; content: string }[]
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number } | null
    model?: string | null
    messageId?: string
  } = {},
): HermesEvent {
  return {
    type: 'run.completed',
    env: env(seq),
    messageId: opts.messageId ?? MESSAGE_ID,
    toolCalls: opts.toolCalls ?? [],
    toolResults: opts.toolResults ?? [],
    usage: opts.usage ?? null,
    model: opts.model ?? null,
  }
}

function errorEvent(seq: number, message: string): HermesEvent {
  return { type: 'error', env: env(seq), message }
}

function doneEvent(seq: number): HermesEvent {
  return { type: 'done', env: env(seq) }
}

function unknownEvent(name: string, data: unknown = {}): HermesEvent {
  return { type: 'unknown', name, data }
}

function parseErrorEvent(raw: string, reason: string): HermesEvent {
  return { type: 'parseError', raw, reason }
}

function chunksOf(type: string, chunks: UIMessageChunk[]): UIMessageChunk[] {
  return chunks.filter((c) => c.type === type)
}

// `UIMessageChunk`'s `data-${string}` member is a template-literal type, so
// `Extract<UIMessageChunk, { type: 'data-toolProgress' }>` resolves to `never`
// (a specific literal doesn't satisfy `extends` against the general
// template-literal union member). Read `.data` off a `data-*` chunk by hand
// instead of trying to narrow via `Extract`.
function dataOf(chunks: UIMessageChunk[], type: string): unknown {
  const found = chunks.find((c) => c.type === type)
  return found && 'data' in found ? (found as { data: unknown }).data : undefined
}

// ── Conformance: structural key allowlist per chunk `type` ──────────────────
//
// GUARD FOR CONSTRAINT (a): the dashboard's ai@7 client validates every chunk
// with a `z.strictObject` and THROWS on an unknown key (verified:
// apps/dashboard/node_modules/ai/dist/index.js:6228-6412, enforced at
// :16325). `uiMessageChunkSchema` is exported from ai@7 (dashboard) — but
// apps/api's own `ai` resolves to v5 (bun installs one nested node_modules
// per workspace package at a pinned version; there is no root-hoisted `ai`,
// confirmed via `bun -e "require.resolve('ai')"` from apps/api, which
// resolves to `.bun/ai@5.0.196.../node_modules/ai`). Reaching into
// apps/dashboard's node_modules via a relative import path would work
// mechanically but bypasses normal package resolution and is not what "the
// dashboard's ai@7 schema is importable from apps/api's test context" means —
// so per the brief this test asserts structurally instead, using the exact
// per-`type` key sets from the frozen chunk union documented in the brief
// (verified independently against apps/api's own installed ai@5
// node_modules/ai/dist/index.d.ts:1847-1951, which matches).
const ALLOWED_KEYS: Record<string, Set<string>> = {
  start: new Set(['type', 'messageId', 'messageMetadata']),
  'data-hermesRun': new Set(['type', 'id', 'data', 'transient']),
  'data-toolProgress': new Set(['type', 'id', 'data', 'transient']),
  'data-hermesThinking': new Set(['type', 'id', 'data', 'transient']),
  'text-start': new Set(['type', 'id', 'providerMetadata']),
  'text-delta': new Set(['type', 'id', 'delta', 'providerMetadata']),
  'text-end': new Set(['type', 'id', 'providerMetadata']),
  'tool-input-start': new Set(['type', 'toolCallId', 'toolName', 'providerExecuted', 'dynamic']),
  'tool-input-available': new Set([
    'type',
    'toolCallId',
    'toolName',
    'input',
    'providerExecuted',
    'providerMetadata',
    'dynamic',
  ]),
  'tool-output-available': new Set([
    'type',
    'toolCallId',
    'output',
    'providerExecuted',
    'dynamic',
    'preliminary',
  ]),
  'tool-output-error': new Set(['type', 'toolCallId', 'errorText', 'providerExecuted', 'dynamic']),
  error: new Set(['type', 'errorText']),
  abort: new Set(['type']),
  finish: new Set(['type', 'finishReason', 'messageMetadata']),
}

function assertConformant(chunk: UIMessageChunk): void {
  const allowed = ALLOWED_KEYS[chunk.type]
  expect(allowed, `no allowlist registered for chunk type "${chunk.type}"`).toBeDefined()
  for (const key of Object.keys(chunk)) {
    expect(allowed?.has(key), `chunk type "${chunk.type}" carries unexpected key "${key}"`).toBe(
      true,
    )
  }
}

describe('createHermesChunkMapper', () => {
  it('text-only turn: start, lazy text-start, deltas, text-end, finish', () => {
    const mapper = createHermesChunkMapper()
    const all: UIMessageChunk[] = []
    all.push(...mapper.next(runStarted(1)))
    all.push(...mapper.next(messageStarted(2)))
    all.push(...mapper.next(delta(3, 'Hello ')))
    all.push(...mapper.next(delta(4, 'world')))
    all.push(...mapper.next(assistantCompleted(5, 'Hello world')))
    all.push(...mapper.next(runCompleted(6)))
    all.push(...mapper.next(doneEvent(7)))

    expect(chunksOf('start', all)).toHaveLength(1)
    expect(chunksOf('text-start', all)).toHaveLength(1)
    expect(chunksOf('text-delta', all)).toHaveLength(2)
    expect(chunksOf('text-end', all)).toHaveLength(1)
    expect(chunksOf('finish', all)).toHaveLength(1)

    const textStart = chunksOf('text-start', all)[0] as Extract<
      UIMessageChunk,
      { type: 'text-start' }
    >
    const deltas = chunksOf('text-delta', all) as Extract<UIMessageChunk, { type: 'text-delta' }>[]
    const textEnd = chunksOf('text-end', all)[0] as Extract<UIMessageChunk, { type: 'text-end' }>
    expect(deltas.every((d) => d.id === textStart.id)).toBe(true)
    expect(textEnd.id).toBe(textStart.id)

    expect(mapper.state.deltaText).toBe('Hello world')
    expect(mapper.state.finalContent).toBe('Hello world')
    expect(mapper.state.sawDone).toBe(true)
    expect(mapper.state.runId).toBe(RUN_ID)
    expect(mapper.state.sessionId).toBe(SESSION_ID)

    for (const c of all) assertConformant(c)
  })

  it('tool-only turn: no empty text part is emitted', () => {
    const mapper = createHermesChunkMapper()
    const all: UIMessageChunk[] = []
    all.push(...mapper.next(runStarted(1)))
    all.push(...mapper.next(messageStarted(2)))
    all.push(...mapper.next(toolStarted(3, 'search', { q: 'x' })))
    all.push(...mapper.next(toolCompleted(4, 'search')))
    all.push(
      ...mapper.next(
        runCompleted(5, {
          toolCalls: [{ id: 'upstream-1', name: 'search', argumentsJson: '{"q":"x"}' }],
          toolResults: [
            { toolCallId: 'upstream-1', toolName: 'search', content: '{"output":"ok"}' },
          ],
        }),
      ),
    )

    expect(chunksOf('text-start', all)).toHaveLength(0)
    expect(chunksOf('text-end', all)).toHaveLength(0)
    expect(chunksOf('tool-input-start', all)).toHaveLength(1)
  })

  it('interleaved text -> tool -> text: the second text segment uses a DIFFERENT id', () => {
    // Regression guard for constraint (b): reusing a text id after text-end
    // dereferences `undefined.text` inside processUIMessageStream and throws
    // (see the doc comment on `nextSegmentIndex` in hermes-chunks.ts).
    const mapper = createHermesChunkMapper()
    const all: UIMessageChunk[] = []
    all.push(...mapper.next(runStarted(1)))
    all.push(...mapper.next(messageStarted(2)))
    all.push(...mapper.next(delta(3, 'Let me check that.')))
    all.push(...mapper.next(toolStarted(4, 'search', { q: 'x' })))
    all.push(...mapper.next(toolCompleted(5, 'search')))
    all.push(...mapper.next(delta(6, 'Found it.')))
    all.push(...mapper.next(assistantCompleted(7, 'Let me check that. Found it.')))

    const starts = chunksOf('text-start', all) as Extract<UIMessageChunk, { type: 'text-start' }>[]
    const ends = chunksOf('text-end', all) as Extract<UIMessageChunk, { type: 'text-end' }>[]
    expect(starts).toHaveLength(2)
    expect(ends).toHaveLength(2)
    expect(starts[0]!.id).not.toBe(starts[1]!.id)
    expect(ends[0]!.id).toBe(starts[0]!.id)
    expect(ends[1]!.id).toBe(starts[1]!.id)
  })

  it('tool.started emits input-start + input-available with dynamic:true', () => {
    const mapper = createHermesChunkMapper()
    const chunks = mapper.next(toolStarted(1, 'search', { q: 'x' }, 'Searching…'))
    const inputStart = chunks.find((c) => c.type === 'tool-input-start') as Extract<
      UIMessageChunk,
      { type: 'tool-input-start' }
    >
    const inputAvailable = chunks.find((c) => c.type === 'tool-input-available') as Extract<
      UIMessageChunk,
      { type: 'tool-input-available' }
    >
    expect(inputStart.dynamic).toBe(true)
    expect(inputStart.toolName).toBe('search')
    expect(inputAvailable.dynamic).toBe(true)
    expect(inputAvailable.input).toEqual({ q: 'x' })
    expect(inputAvailable.toolCallId).toBe(inputStart.toolCallId)
  })

  it('run.completed with a successful tool result -> tool-output-available with the parsed object', () => {
    const mapper = createHermesChunkMapper()
    mapper.next(toolStarted(1, 'search', { q: 'x' }))
    const chunks = mapper.next(
      runCompleted(2, {
        toolCalls: [{ id: 'up-1', name: 'search', argumentsJson: '{"q":"x"}' }],
        toolResults: [
          { toolCallId: 'up-1', toolName: 'search', content: '{"output":"result text"}' },
        ],
      }),
    )
    const out = chunks.find((c) => c.type === 'tool-output-available') as Extract<
      UIMessageChunk,
      { type: 'tool-output-available' }
    >
    expect(out.output).toEqual({ output: 'result text' })
    expect(out.dynamic).toBe(true)
  })

  it('run.completed with {"output":"","exit_code":1,"error":"boom"} -> tool-output-error', () => {
    const mapper = createHermesChunkMapper()
    mapper.next(toolStarted(1, 'bash', { cmd: 'x' }))
    const chunks = mapper.next(
      runCompleted(2, {
        toolResults: [
          {
            toolCallId: 'up-1',
            toolName: 'bash',
            content: JSON.stringify({ output: '', exit_code: 1, error: 'boom' }),
          },
        ],
      }),
    )
    const out = chunks.find((c) => c.type === 'tool-output-error') as Extract<
      UIMessageChunk,
      { type: 'tool-output-error' }
    >
    expect(out).toBeDefined()
    expect(out.errorText).toBe('boom')
    expect(out.dynamic).toBe(true)
    expect(chunks.some((c) => c.type === 'tool-output-available')).toBe(false)
  })

  it('run.completed with exit_code: 0, error: null -> tool-output-available, NOT an error', () => {
    const mapper = createHermesChunkMapper()
    mapper.next(toolStarted(1, 'bash', { cmd: 'x' }))
    const chunks = mapper.next(
      runCompleted(2, {
        toolResults: [
          {
            toolCallId: 'up-1',
            toolName: 'bash',
            content: JSON.stringify({ output: 'ok', exit_code: 0, error: null }),
          },
        ],
      }),
    )
    expect(chunks.some((c) => c.type === 'tool-output-error')).toBe(false)
    const out = chunks.find((c) => c.type === 'tool-output-available') as Extract<
      UIMessageChunk,
      { type: 'tool-output-available' }
    >
    expect(out).toBeDefined()
    expect(out.output).toEqual({ output: 'ok', exit_code: 0, error: null })
  })

  it('run.completed with unparseable tool content -> tool-output-available with {raw: ...}', () => {
    const mapper = createHermesChunkMapper()
    mapper.next(toolStarted(1, 'weird', {}))
    const chunks = mapper.next(
      runCompleted(2, {
        toolResults: [{ toolCallId: 'up-1', toolName: 'weird', content: 'not json {' }],
      }),
    )
    const out = chunks.find((c) => c.type === 'tool-output-available') as Extract<
      UIMessageChunk,
      { type: 'tool-output-available' }
    >
    expect(out.output).toEqual({ raw: 'not json {' })
  })

  it("two DIFFERENT tool names -> each result attaches to its own name's provisional id", () => {
    const mapper = createHermesChunkMapper()
    const startedChunks1 = mapper.next(toolStarted(1, 'toolA', { a: 1 }))
    mapper.next(toolCompleted(2, 'toolA'))
    const startedChunks2 = mapper.next(toolStarted(3, 'toolB', { b: 2 }))
    mapper.next(toolCompleted(4, 'toolB'))

    const idA = (
      startedChunks1.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId
    const idB = (
      startedChunks2.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId
    expect(idA).not.toBe(idB)

    const chunks = mapper.next(
      runCompleted(5, {
        toolResults: [
          { toolCallId: 'up-a', toolName: 'toolA', content: '{"output":"A"}' },
          { toolCallId: 'up-b', toolName: 'toolB', content: '{"output":"B"}' },
        ],
      }),
    )
    const outputs = chunks.filter((c) => c.type === 'tool-output-available') as Extract<
      UIMessageChunk,
      { type: 'tool-output-available' }
    >[]
    expect(outputs).toHaveLength(2)
    const forA = outputs.find((o) => o.toolCallId === idA)
    const forB = outputs.find((o) => o.toolCallId === idB)
    expect(forA?.output).toEqual({ output: 'A' })
    expect(forB?.output).toEqual({ output: 'B' })
    expect(mapper.state.correlationMismatchCount).toBe(0)
  })

  it('two calls to the SAME tool name -> FIFO order, first result attaches to first id', () => {
    const mapper = createHermesChunkMapper()
    const started1 = mapper.next(toolStarted(1, 'search', { q: 'first' }))
    const started2 = mapper.next(toolStarted(2, 'search', { q: 'second' }))
    const firstId = (
      started1.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId
    const secondId = (
      started2.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId
    expect(firstId).not.toBe(secondId)

    const chunks = mapper.next(
      runCompleted(3, {
        toolResults: [
          { toolCallId: 'up-1', toolName: 'search', content: '{"output":"result one"}' },
          { toolCallId: 'up-2', toolName: 'search', content: '{"output":"result two"}' },
        ],
      }),
    )
    const outputs = chunks.filter((c) => c.type === 'tool-output-available') as Extract<
      UIMessageChunk,
      { type: 'tool-output-available' }
    >[]
    expect(outputs).toHaveLength(2)
    // FIFO: the first result in wire order goes to the first (oldest) started id.
    expect(outputs.find((o) => o.toolCallId === firstId)?.output).toEqual({
      output: 'result one',
    })
    expect(outputs.find((o) => o.toolCallId === secondId)?.output).toEqual({
      output: 'result two',
    })
    expect(mapper.state.correlationMismatchCount).toBe(0)
  })

  it('a tool.started with no matching result is still closed with {status: completed}', () => {
    const mapper = createHermesChunkMapper()
    const started = mapper.next(toolStarted(1, 'orphan', {}))
    const provisionalId = (
      started.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId

    const chunks = mapper.next(runCompleted(2, { toolResults: [] }))
    const out = chunks.find(
      (c) => c.type === 'tool-output-available' && c.toolCallId === provisionalId,
    ) as Extract<UIMessageChunk, { type: 'tool-output-available' }>
    expect(out).toBeDefined()
    expect(out.output).toEqual({ status: 'completed' })
  })

  it('a toolResult whose toolName matches no open call is DROPPED and counted, no chunk emitted', () => {
    const mapper = createHermesChunkMapper()
    // No tool.started at all — only a toolResult in run.completed.
    const chunks = mapper.next(
      runCompleted(1, {
        toolResults: [{ toolCallId: 'ghost', toolName: 'ghost-tool', content: '{}' }],
      }),
    )
    expect(chunks.some((c) => c.type === 'tool-output-available')).toBe(false)
    expect(chunks.some((c) => c.type === 'tool-output-error')).toBe(false)
    expect(mapper.state.correlationMismatchCount).toBe(1)
  })

  it('tool.started emits the legacy data-toolProgress chip with all five fields (status: running)', () => {
    const mapper = createHermesChunkMapper()
    const chunks = mapper.next(toolStarted(1, 'terminal', { cmd: 'ls /tmp/x' }, 'ls /tmp/x'))
    const inputStart = chunks.find((c) => c.type === 'tool-input-start') as Extract<
      UIMessageChunk,
      { type: 'tool-input-start' }
    >
    expect(chunks.some((c) => c.type === 'data-toolProgress')).toBe(true)
    expect(dataOf(chunks, 'data-toolProgress')).toEqual({
      tool: 'terminal',
      label: 'ls /tmp/x',
      toolCallId: inputStart.toolCallId,
      status: 'running',
    })
  })

  it('tool.completed emits the legacy data-toolProgress chip (status: completed)', () => {
    const mapper = createHermesChunkMapper()
    const started = mapper.next(toolStarted(1, 'terminal', { cmd: 'ls' }, 'ls /tmp/x'))
    const provisionalId = (
      started.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId

    const chunks = mapper.next(toolCompleted(2, 'terminal'))
    expect(chunks.some((c) => c.type === 'data-toolProgress')).toBe(true)
    expect(dataOf(chunks, 'data-toolProgress')).toEqual({
      tool: 'terminal',
      label: 'ls /tmp/x',
      toolCallId: provisionalId,
      status: 'completed',
    })
  })

  it('tool.failed emits both tool-output-error AND the legacy data-toolProgress chip (status: failed)', () => {
    const mapper = createHermesChunkMapper()
    const started = mapper.next(toolStarted(1, 'flaky', {}, 'run flaky'))
    const provisionalId = (
      started.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId

    const chunks = mapper.next(toolFailed(2, 'flaky', 'connection reset'))
    const out = chunks.find((c) => c.type === 'tool-output-error') as Extract<
      UIMessageChunk,
      { type: 'tool-output-error' }
    >
    expect(out).toBeDefined()
    expect(out.toolCallId).toBe(provisionalId)
    expect(out.errorText).toBe('connection reset')
    expect(chunks.some((c) => c.type === 'data-toolProgress')).toBe(true)
    expect(dataOf(chunks, 'data-toolProgress')).toEqual({
      tool: 'flaky',
      label: 'run flaky',
      toolCallId: provisionalId,
      status: 'failed',
    })
  })

  it('_thinking tool.progress -> data-hermesThinking only; NEVER data-toolProgress or reasoning-*', () => {
    const mapper = createHermesChunkMapper()
    const chunks = mapper.next(toolProgress(1, '_thinking', 'the final answer text'))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('data-hermesThinking')
    expect(chunks.some((c) => c.type === 'data-toolProgress')).toBe(false)
    expect(chunks.some((c) => c.type.startsWith('reasoning'))).toBe(false)
    expect(dataOf(chunks, 'data-hermesThinking')).toEqual({
      toolName: '_thinking',
      delta: 'the final answer text',
      messageId: MESSAGE_ID,
    })
  })

  it('a dropped messages[] entry only loses ITS OWN tool output — every other name still attaches correctly', () => {
    // Simulates Lane P's parser silently skipping one malformed role:'tool'
    // entry: two tool.started events fire ("alpha" then "beta"), but only
    // beta's toolResult survives in run.completed (alpha's was the one
    // dropped upstream). This is the whole point of per-name FIFO over
    // positional correlation: beta's real output must land on BETA's id
    // (positional correlation would have wrongly put it on alpha's, since
    // beta's result is the only — and therefore first — entry in
    // toolResults). alpha, having no surviving result, closes generically.
    const mapper = createHermesChunkMapper()
    const startedAlpha = mapper.next(toolStarted(1, 'alpha', { a: 1 }))
    const startedBeta = mapper.next(toolStarted(2, 'beta', { b: 1 }))
    const alphaId = (
      startedAlpha.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId
    const betaId = (
      startedBeta.find((c) => c.type === 'tool-input-start') as Extract<
        UIMessageChunk,
        { type: 'tool-input-start' }
      >
    ).toolCallId
    expect(alphaId).not.toBe(betaId)

    const chunks = mapper.next(
      runCompleted(3, {
        toolResults: [{ toolCallId: 'up-beta', toolName: 'beta', content: '{"output":"B"}' }],
      }),
    )

    // No mismatch counted: beta's result DID find its open queue (its own
    // name's), it just wasn't alpha's. Only a result with NO open queue for
    // its name counts as a mismatch (see the sibling "dropped and counted" test).
    expect(mapper.state.correlationMismatchCount).toBe(0)

    const outputs = chunks.filter((c) => c.type === 'tool-output-available') as Extract<
      UIMessageChunk,
      { type: 'tool-output-available' }
    >[]
    // beta gets its REAL output — this is what positional correlation could not do.
    const forBeta = outputs.find((o) => o.toolCallId === betaId)
    expect(forBeta).toBeDefined()
    expect(forBeta?.output).toEqual({ output: 'B' })
    // alpha never received a result at all — closes generically, not with beta's data.
    const forAlpha = outputs.find((o) => o.toolCallId === alphaId)
    expect(forAlpha).toBeDefined()
    expect(forAlpha?.output).toEqual({ status: 'completed' })
    expect(outputs).toHaveLength(2)
  })

  it("finalize('aborted') emits {type: 'abort'} and closes an open text segment", () => {
    const mapper = createHermesChunkMapper()
    mapper.next(runStarted(1))
    mapper.next(messageStarted(2))
    mapper.next(delta(3, 'partial'))

    const chunks = mapper.finalize('aborted')
    expect(chunksOf('text-end', chunks)).toHaveLength(1)
    expect(chunksOf('abort', chunks)).toHaveLength(1)
    expect(chunks[chunks.length - 1]?.type).toBe('abort')
  })

  it("finalize('upstream-ended-without-done') emits error then finish", () => {
    const mapper = createHermesChunkMapper()
    mapper.next(runStarted(1))
    const chunks = mapper.finalize('upstream-ended-without-done')
    expect(chunksOf('error', chunks)).toHaveLength(1)
    expect(chunksOf('finish', chunks)).toHaveLength(1)
    const errorChunk = chunks.find((c) => c.type === 'error') as Extract<
      UIMessageChunk,
      { type: 'error' }
    >
    expect(errorChunk.errorText).toBe('Hermes stream ended without done')
    const finishChunk = chunks.find((c) => c.type === 'finish') as Extract<
      UIMessageChunk,
      { type: 'finish' }
    >
    expect(finishChunk.finishReason).toBe('error')
  })

  it('finalize is idempotent-safe: a second finish is never emitted once one landed', () => {
    const mapper = createHermesChunkMapper()
    mapper.next(runStarted(1))
    mapper.next(runCompleted(2)) // emits the one and only finish
    const finalizeChunks = mapper.finalize('upstream-ended-without-done')
    expect(finalizeChunks.some((c) => c.type === 'finish')).toBe(false)
    expect(finalizeChunks.some((c) => c.type === 'error')).toBe(false)
  })

  // Defect 1 (A2 fix round): a stop landing AFTER run.completed but BEFORE
  // Hermes' separate `done` frame must not relabel a genuinely completed turn
  // as aborted.
  it("finalize('aborted') is a no-op once run.completed already finished the turn", () => {
    const mapper = createHermesChunkMapper()
    mapper.next(runStarted(1))
    mapper.next(messageStarted(2))
    mapper.next(delta(3, 'Hello world'))
    mapper.next(assistantCompleted(4, 'Hello world'))
    mapper.next(runCompleted(5)) // sets state.finished = true, emits finish
    expect(mapper.state.finished).toBe(true)

    const chunks = mapper.finalize('aborted')
    expect(chunks).toHaveLength(0)
    expect(chunks.some((c) => c.type === 'abort')).toBe(false)
  })

  it("finalize('aborted') still emits {type: 'abort'} for a turn that has NOT finished", () => {
    const mapper = createHermesChunkMapper()
    mapper.next(runStarted(1))
    expect(mapper.state.finished).toBe(false)
    const chunks = mapper.finalize('aborted')
    expect(chunksOf('abort', chunks)).toHaveLength(1)
  })

  // Defect 3 (A2 fix round): an error arriving while a text part is open must
  // close it, or the part is persisted to Postgres stuck at state: 'streaming'.
  it('error event with an open text part closes it before emitting error + finish', () => {
    const mapper = createHermesChunkMapper()
    mapper.next(runStarted(1))
    mapper.next(messageStarted(2))
    const deltaChunks = mapper.next(delta(3, 'partial answer'))
    const textStart = deltaChunks.find((c) => c.type === 'text-start') as Extract<
      UIMessageChunk,
      { type: 'text-start' }
    >
    expect(textStart).toBeDefined()

    const chunks = mapper.next(errorEvent(4, 'upstream exploded mid-generation'))
    const textEnd = chunks.find((c) => c.type === 'text-end') as Extract<
      UIMessageChunk,
      { type: 'text-end' }
    >
    expect(textEnd).toBeDefined()
    expect(textEnd.id).toBe(textStart.id)

    const order = chunks.map((c) => c.type)
    expect(order.indexOf('text-end')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('text-end')).toBeLessThan(order.indexOf('error'))
    expect(chunksOf('error', chunks)).toHaveLength(1)
    expect(chunksOf('finish', chunks)).toHaveLength(1)
  })

  it('usage is captured from run.completed into state', () => {
    const mapper = createHermesChunkMapper()
    mapper.next(
      runCompleted(1, {
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        model: 'hermes-core',
      }),
    )
    expect(mapper.state.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 })
    expect(mapper.state.model).toBe('hermes-core')
  })

  it('unknown and parseError events are counted and produce no wire chunks', () => {
    const mapper = createHermesChunkMapper()
    const chunksA = mapper.next(unknownEvent('hermes.custom.thing', { foo: 1 }))
    const chunksB = mapper.next(parseErrorEvent('not json', 'SyntaxError'))
    expect(chunksA).toHaveLength(0)
    expect(chunksB).toHaveLength(0)
    expect(mapper.state.unknownCount).toBe(1)
    expect(mapper.state.parseErrorCount).toBe(1)
  })

  it('error event emits error then finish, and sets state.errored', () => {
    const mapper = createHermesChunkMapper()
    const chunks = mapper.next(errorEvent(1, 'upstream exploded'))
    expect(mapper.state.errored).toBe(true)
    const errorChunk = chunks.find((c) => c.type === 'error') as Extract<
      UIMessageChunk,
      { type: 'error' }
    >
    const finishChunk = chunks.find((c) => c.type === 'finish') as Extract<
      UIMessageChunk,
      { type: 'finish' }
    >
    expect(errorChunk.errorText).toBe('upstream exploded')
    expect(finishChunk.finishReason).toBe('error')
  })

  it('conformance: every chunk emitted across a full mixed scenario passes the strict key allowlist', () => {
    const mapper = createHermesChunkMapper()
    const all: UIMessageChunk[] = []
    all.push(...mapper.next(runStarted(1)))
    all.push(...mapper.next(messageStarted(2)))
    all.push(...mapper.next(delta(3, 'Checking… ')))
    all.push(...mapper.next(toolStarted(4, 'search', { q: 'x' }, 'Searching')))
    all.push(...mapper.next(toolProgress(5, '_thinking', 'reasoning text')))
    all.push(...mapper.next(toolCompleted(6, 'search')))
    all.push(...mapper.next(delta(7, 'Done.')))
    all.push(...mapper.next(assistantCompleted(8, 'Checking…  Done.')))
    all.push(
      ...mapper.next(
        runCompleted(9, {
          toolCalls: [{ id: 'up-1', name: 'search', argumentsJson: '{"q":"x"}' }],
          toolResults: [{ toolCallId: 'up-1', toolName: 'search', content: '{"output":"ok"}' }],
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          model: 'hermes-core',
        }),
      ),
    )
    all.push(...mapper.next(doneEvent(10)))
    expect(all.length).toBeGreaterThan(0)
    for (const chunk of all) assertConformant(chunk)

    // Also cover the abort/error finalize + tool.failed shapes in the same pass.
    const abortMapper = createHermesChunkMapper()
    abortMapper.next(runStarted(1))
    abortMapper.next(delta(2, 'partial'))
    for (const c of abortMapper.finalize('aborted')) assertConformant(c)

    const failMapper = createHermesChunkMapper()
    failMapper.next(toolStarted(1, 'flaky', {}))
    for (const c of failMapper.next(toolFailed(2, 'flaky', 'boom'))) assertConformant(c)

    const upstreamEndMapper = createHermesChunkMapper()
    for (const c of upstreamEndMapper.finalize('upstream-ended-without-done')) {
      assertConformant(c)
    }
  })
})
