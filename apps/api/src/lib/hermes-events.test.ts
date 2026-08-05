import { describe, it, expect } from 'bun:test'
import { parseHermesEvents, type HermesEvent } from './hermes-events.js'

// Pure unit tests — no database, no network. `parseHermesEvents` wraps a plain
// ReadableStream<Uint8Array>, so every fixture below is a hand-built upstream
// stream (never a real Hermes response). Fixtures use neutral values (/tmp/x,
// generic ids) — never the real filesystem paths/usernames seen in the live
// capture this parser was built against.

const encoder = new TextEncoder()

/** A plain upstream that emits each `chunks` entry as its own `read()` result. */
function upstreamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[i]!)
      i++
    },
  })
}

/** Encode `text` and split the resulting bytes at the given byte offsets. */
function encodeSplit(text: string, ...splitPoints: number[]): Uint8Array[] {
  const bytes = encoder.encode(text)
  const points = [0, ...splitPoints, bytes.length]
  const chunks: Uint8Array[] = []
  for (let i = 0; i < points.length - 1; i++) {
    chunks.push(bytes.slice(points[i]!, points[i + 1]!))
  }
  return chunks
}

/** Drain a parsed stream to an array of events. */
async function drain(stream: ReadableStream<HermesEvent>): Promise<HermesEvent[]> {
  const reader = stream.getReader()
  const events: HermesEvent[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

/** Run `parseHermesEvents` over `chunks`, collecting every emitted event. */
async function run(chunks: Uint8Array[]): Promise<HermesEvent[]> {
  return drain(parseHermesEvents(upstreamFromChunks(chunks)))
}

/** Build one `event: <name>\ndata: <json>\n\n` frame. */
function frame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const ENV = { session_id: 'ses-1', run_id: 'run_abc123', seq: 1, ts: 1785923224.68 }
const ENVELOPE = { sessionId: 'ses-1', runId: 'run_abc123', seq: 1, ts: ENV.ts }

describe('parseHermesEvents — event shapes', () => {
  it('parses run.started', async () => {
    const payload = {
      user_message: { role: 'user', content: 'hi' },
      runtime: {
        provider: '',
        model: '',
        route_source: 'global',
        requested: { provider: '', model: '' },
      },
      ...ENV,
    }
    const events = await run([encoder.encode(frame('run.started', payload))])
    expect(events).toEqual([{ type: 'run.started', env: ENVELOPE }])
  })

  it('parses message.started', async () => {
    const payload = { message: { id: 'msg_1', role: 'assistant' }, ...ENV, seq: 2 }
    const events = await run([encoder.encode(frame('message.started', payload))])
    expect(events).toEqual([
      { type: 'message.started', env: { ...ENVELOPE, seq: 2 }, messageId: 'msg_1' },
    ])
  })

  it('parses assistant.delta', async () => {
    const payload = { message_id: 'msg_1', delta: 'Hello', ...ENV, seq: 3 }
    const events = await run([encoder.encode(frame('assistant.delta', payload))])
    expect(events).toEqual([
      { type: 'assistant.delta', env: { ...ENVELOPE, seq: 3 }, messageId: 'msg_1', delta: 'Hello' },
    ])
  })

  it('parses tool.started', async () => {
    const payload = {
      message_id: 'msg_1',
      tool_name: 'terminal',
      preview: 'ls /tmp/x',
      args: { command: 'ls /tmp/x' },
      ...ENV,
      seq: 4,
    }
    const events = await run([encoder.encode(frame('tool.started', payload))])
    expect(events).toEqual([
      {
        type: 'tool.started',
        env: { ...ENVELOPE, seq: 4 },
        messageId: 'msg_1',
        toolName: 'terminal',
        preview: 'ls /tmp/x',
        args: { command: 'ls /tmp/x' },
      },
    ])
  })

  it('parses tool.completed (preview/args are dropped — not part of the frozen shape)', async () => {
    const payload = {
      message_id: 'msg_1',
      tool_name: 'terminal',
      preview: null,
      args: null,
      ...ENV,
      seq: 5,
    }
    const events = await run([encoder.encode(frame('tool.completed', payload))])
    expect(events).toEqual([
      {
        type: 'tool.completed',
        env: { ...ENVELOPE, seq: 5 },
        messageId: 'msg_1',
        toolName: 'terminal',
      },
    ])
  })

  it('parses tool.failed (specified upstream, not observed in the live capture)', async () => {
    const payload = { message_id: 'msg_1', tool_name: 'terminal', error: 'boom', ...ENV, seq: 6 }
    const events = await run([encoder.encode(frame('tool.failed', payload))])
    expect(events).toEqual([
      {
        type: 'tool.failed',
        env: { ...ENVELOPE, seq: 6 },
        messageId: 'msg_1',
        toolName: 'terminal',
        error: 'boom',
      },
    ])
  })

  it('parses tool.progress (tool_name is the literal `_thinking`)', async () => {
    const payload = {
      message_id: 'msg_1',
      tool_name: '_thinking',
      delta: '3 items found.',
      ...ENV,
      seq: 9,
    }
    const events = await run([encoder.encode(frame('tool.progress', payload))])
    expect(events).toEqual([
      {
        type: 'tool.progress',
        env: { ...ENVELOPE, seq: 9 },
        messageId: 'msg_1',
        toolName: '_thinking',
        delta: '3 items found.',
      },
    ])
  })

  it('parses assistant.completed', async () => {
    const payload = {
      session_id: 'ses-1',
      message_id: 'msg_1',
      content: 'Done.',
      completed: true,
      partial: false,
      interrupted: false,
      runtime: {},
      run_id: 'run_abc123',
      seq: 10,
      ts: 1785923224.9,
    }
    const events = await run([encoder.encode(frame('assistant.completed', payload))])
    expect(events).toEqual([
      {
        type: 'assistant.completed',
        env: { sessionId: 'ses-1', runId: 'run_abc123', seq: 10, ts: 1785923224.9 },
        messageId: 'msg_1',
        content: 'Done.',
        partial: false,
        interrupted: false,
      },
    ])
  })

  it('parses error', async () => {
    const payload = { message: 'something went wrong', ...ENV, seq: 11 }
    const events = await run([encoder.encode(frame('error', payload))])
    expect(events).toEqual([
      { type: 'error', env: { ...ENVELOPE, seq: 11 }, message: 'something went wrong' },
    ])
  })

  it('parses done', async () => {
    const payload = { ...ENV, seq: 12 }
    const events = await run([encoder.encode(frame('done', payload))])
    expect(events).toEqual([{ type: 'done', env: { ...ENVELOPE, seq: 12 } }])
  })

  it('emits unknown for an unrecognized event name', async () => {
    const payload = { foo: 'bar', ...ENV }
    const events = await run([encoder.encode(frame('future.event', payload))])
    expect(events).toEqual([{ type: 'unknown', name: 'future.event', data: payload }])
  })
})

describe('parseHermesEvents — run.completed message flattening', () => {
  it('flattens messages[] into ordered toolCalls/toolResults, keeping argumentsJson/content raw strings', async () => {
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'toolu_1',
            call_id: 'toolu_1',
            response_item_id: 'fc_1',
            type: 'function',
            function: { name: 'terminal', arguments: '{"command":"ls /tmp/x"}' },
          },
        ],
        finish_reason: 'tool_calls',
        reasoning: null,
      },
      {
        role: 'tool',
        content: '{"output":"a\\nb","exit_code":0,"error":null}',
        tool_call_id: 'toolu_1',
        tool_name: 'terminal',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'toolu_2',
            call_id: 'toolu_2',
            response_item_id: 'fc_2',
            type: 'function',
            function: { name: 'terminal', arguments: '{"command":"pwd"}' },
          },
        ],
        finish_reason: 'tool_calls',
        reasoning: null,
      },
      {
        role: 'tool',
        content: '{"output":"/tmp/x","exit_code":0,"error":null}',
        tool_call_id: 'toolu_2',
        tool_name: 'terminal',
      },
      { role: 'assistant', content: 'Done.', finish_reason: 'stop', reasoning: null },
    ]
    const payload = {
      session_id: 'ses-1',
      message_id: 'msg_1',
      completed: true,
      messages,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        runtime: { model: 'claude-sonnet-4-6-eu' },
      },
      runtime: {},
      run_id: 'run_abc123',
      seq: 13,
      ts: 1785923225.0,
    }
    const events = await run([encoder.encode(frame('run.completed', payload))])
    expect(events).toEqual([
      {
        type: 'run.completed',
        env: { sessionId: 'ses-1', runId: 'run_abc123', seq: 13, ts: 1785923225.0 },
        messageId: 'msg_1',
        toolCalls: [
          { id: 'toolu_1', name: 'terminal', argumentsJson: '{"command":"ls /tmp/x"}' },
          { id: 'toolu_2', name: 'terminal', argumentsJson: '{"command":"pwd"}' },
        ],
        toolResults: [
          {
            toolCallId: 'toolu_1',
            toolName: 'terminal',
            content: '{"output":"a\\nb","exit_code":0,"error":null}',
          },
          {
            toolCallId: 'toolu_2',
            toolName: 'terminal',
            content: '{"output":"/tmp/x","exit_code":0,"error":null}',
          },
        ],
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        model: 'claude-sonnet-4-6-eu',
      },
    ])
  })

  it('produces empty arrays (not null) when messages[] has no tool calls, falling back to top-level runtime.model', async () => {
    const messages = [
      { role: 'assistant', content: 'Hi there.', finish_reason: 'stop', reasoning: null },
    ]
    const payload = {
      session_id: 'ses-1',
      message_id: 'msg_1',
      completed: true,
      messages,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, runtime: {} },
      runtime: { model: 'claude-sonnet-4-6-eu' },
      run_id: 'run_abc123',
      seq: 14,
      ts: 1785923225.1,
    }
    const events = await run([encoder.encode(frame('run.completed', payload))])
    const event = events[0]
    expect(event?.type).toBe('run.completed')
    if (event?.type !== 'run.completed') throw new Error('unreachable')
    expect(event.toolCalls).toEqual([])
    expect(event.toolResults).toEqual([])
    expect(event.model).toBe('claude-sonnet-4-6-eu')
  })

  it('produces null usage (not zero-filled) when usage is absent', async () => {
    const payload = {
      session_id: 'ses-1',
      message_id: 'msg_1',
      completed: true,
      messages: [],
      runtime: {},
      run_id: 'run_abc123',
      seq: 15,
      ts: 1785923225.2,
    }
    const events = await run([encoder.encode(frame('run.completed', payload))])
    const event = events[0]
    expect(event?.type).toBe('run.completed')
    if (event?.type !== 'run.completed') throw new Error('unreachable')
    expect(event.usage).toBeNull()
    expect(event.model).toBeNull()
  })
})

describe('parseHermesEvents — framing and buffering', () => {
  it('reassembles a frame split across chunk boundaries at several byte offsets', async () => {
    const text = frame('assistant.delta', {
      message_id: 'msg_1',
      delta: 'Hello world',
      ...ENV,
      seq: 3,
    })
    for (const splitAt of [1, 10, 25, text.length - 3, text.length - 1]) {
      const chunks = encodeSplit(text, splitAt)
      const events = await run(chunks)
      expect(events).toEqual([
        {
          type: 'assistant.delta',
          env: { ...ENVELOPE, seq: 3 },
          messageId: 'msg_1',
          delta: 'Hello world',
        },
      ])
    }
  })

  it('reassembles a frame split mid-`data:` line', async () => {
    const text = frame('assistant.delta', { message_id: 'msg_1', delta: 'Hi', ...ENV, seq: 3 })
    const dataStart = text.indexOf('data:')
    const chunks = encodeSplit(text, dataStart + 3)
    const events = await run(chunks)
    expect(events).toEqual([
      { type: 'assistant.delta', env: { ...ENVELOPE, seq: 3 }, messageId: 'msg_1', delta: 'Hi' },
    ])
  })

  it('reassembles a frame split mid-JSON', async () => {
    const text = frame('assistant.delta', { message_id: 'msg_1', delta: 'Hi', ...ENV, seq: 3 })
    const jsonStart = text.indexOf('{')
    const chunks = encodeSplit(text, jsonStart + 10)
    const events = await run(chunks)
    expect(events).toEqual([
      { type: 'assistant.delta', env: { ...ENVELOPE, seq: 3 }, messageId: 'msg_1', delta: 'Hi' },
    ])
  })

  it('handles CRLF line endings', async () => {
    const text = `event: done\r\ndata: ${JSON.stringify(ENV)}\r\n\r\n`
    const events = await run([encoder.encode(text)])
    expect(events).toEqual([{ type: 'done', env: ENVELOPE }])
  })

  it('drops `: keepalive` comment frames without disturbing framing — surrounding events still parse', async () => {
    const before = frame('done', ENV)
    const keepalive = ': keepalive\n\n'
    const after = frame('done', { ...ENV, seq: 2 })
    const events = await run([encoder.encode(before + keepalive + after)])
    expect(events).toEqual([
      { type: 'done', env: ENVELOPE },
      { type: 'done', env: { ...ENVELOPE, seq: 2 } },
    ])
  })

  it('parses multiple frames delivered in a single chunk', async () => {
    const text =
      frame('done', ENV) + frame('done', { ...ENV, seq: 2 }) + frame('done', { ...ENV, seq: 3 })
    const events = await run([encoder.encode(text)])
    expect(events.map((e) => (e.type === 'done' ? e.env.seq : -1))).toEqual([1, 2, 3])
  })

  it('reassembles multi-byte UTF-8 (umlaut + emoji) split across a chunk boundary', async () => {
    const text = frame('assistant.delta', { message_id: 'msg_1', delta: 'café 🎉', ...ENV, seq: 3 })
    const emojiStart = encoder.encode(text.slice(0, text.indexOf('🎉'))).length
    const chunks = encodeSplit(text, emojiStart + 2)
    const events = await run(chunks)
    expect(events).toEqual([
      {
        type: 'assistant.delta',
        env: { ...ENVELOPE, seq: 3 },
        messageId: 'msg_1',
        delta: 'café 🎉',
      },
    ])
  })

  it('flushes a tail frame that has no trailing blank line', async () => {
    const withoutTrailer = `event: done\ndata: ${JSON.stringify(ENV)}`
    const events = await run([encoder.encode(withoutTrailer)])
    expect(events).toEqual([{ type: 'done', env: ENVELOPE }])
  })
})

describe('parseHermesEvents — error resilience', () => {
  it('emits parseError for malformed JSON and keeps parsing later frames', async () => {
    const malformed = 'event: done\ndata: {not valid json\n\n'
    const good = frame('done', { ...ENV, seq: 2 })
    const events = await run([encoder.encode(malformed + good)])
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('parseError')
    expect(events[1]).toEqual({ type: 'done', env: { ...ENVELOPE, seq: 2 } })
  })

  it('emits parseError when an envelope field is missing or wrong-typed', async () => {
    const payload = { session_id: 'ses-1', run_id: 'run_abc123', seq: 'not-a-number', ts: ENV.ts }
    const events = await run([encoder.encode(frame('done', payload))])
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('parseError')
  })
})

describe('parseHermesEvents — termination shapes', () => {
  it('silent close: stream ends after assistant.completed with no `done` — no synthetic terminal event', async () => {
    const text = frame('assistant.completed', {
      session_id: 'ses-1',
      message_id: 'msg_1',
      content: 'partial reply',
      completed: false,
      partial: true,
      interrupted: false,
      runtime: {},
      run_id: 'run_abc123',
      seq: 20,
      ts: 1785923226.0,
    })
    const events = await run([encoder.encode(text)])
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('assistant.completed')
  })

  it('failure shape: error -> done -> close', async () => {
    const text = frame('error', { message: 'boom', ...ENV }) + frame('done', { ...ENV, seq: 2 })
    const events = await run([encoder.encode(text)])
    expect(events.map((e) => e.type)).toEqual(['error', 'done'])
  })
})

describe('parseHermesEvents — cancel and upstream-error propagation', () => {
  it('propagates cancel(reason) to the upstream reader', async () => {
    let cancelReason: unknown
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame('done', ENV)))
      },
      cancel(reason) {
        cancelReason = reason
      },
    })
    const parsed = parseHermesEvents(upstream)
    await parsed.cancel('client-gone')
    expect(cancelReason).toBe('client-gone')
  })

  it('propagates an upstream read error via controller.error', async () => {
    let pulled = false
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true
          controller.enqueue(encoder.encode(frame('done', ENV)))
          return
        }
        controller.error(new Error('upstream exploded'))
      },
    })
    const reader = parseHermesEvents(upstream).getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    await expect(reader.read()).rejects.toThrow('upstream exploded')
  })
})
