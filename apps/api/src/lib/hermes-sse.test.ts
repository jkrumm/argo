import { describe, it, expect } from 'bun:test'
import { filterToolProgress, type ToolProgressData } from './hermes-sse.js'

// Pure unit tests — no database, no network. `filterToolProgress` wraps a
// plain ReadableStream<Uint8Array>, so every fixture below is a hand-built
// upstream stream (never a real Hermes response).

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

/** Drain a filtered stream to a decoded string. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

/** Run `filterToolProgress` over `chunks`, collecting forwarded text + progress events. */
async function run(chunks: Uint8Array[]): Promise<{ text: string; progress: ToolProgressData[] }> {
  const progress: ToolProgressData[] = []
  const filtered = filterToolProgress(upstreamFromChunks(chunks), (data) => progress.push(data))
  const text = await drain(filtered)
  return { text, progress }
}

describe('filterToolProgress — framing and buffering', () => {
  it('forwards whole frames verbatim when each frame is one chunk', async () => {
    const frames = ['data: {"a":1}\n\n', 'data: {"a":2}\n\n']
    const { text, progress } = await run(frames.map((f) => encoder.encode(f)))
    expect(text).toBe(frames.join(''))
    expect(progress).toEqual([])
  })

  it('reassembles a frame split across two chunks at an arbitrary byte', async () => {
    const frame = 'data: {"hello":"world"}\n\n'
    const chunks = encodeSplit(frame, 10)
    const { text } = await run(chunks)
    expect(text).toBe(frame)
  })

  it('reassembles a frame whose split falls inside the \\n\\n delimiter', async () => {
    const frame = 'data: {"a":1}\n\n'
    // Split between the two '\n' bytes of the delimiter itself.
    const chunks = encodeSplit(frame, frame.length - 1)
    const { text } = await run(chunks)
    expect(text).toBe(frame)
  })

  it('reassembles a frame whose split falls inside a multi-byte UTF-8 character', async () => {
    const frame = 'data: {"emoji":"🎉"}\n\n'
    // "🎉" (U+1F389) encodes to 4 bytes; find its start and split mid-character.
    const emojiStart = encoder.encode('data: {"emoji":"').length
    const chunks = encodeSplit(frame, emojiStart + 2)
    const { text } = await run(chunks)
    expect(text).toBe(frame)
  })

  it('splits CRLF-delimited frames (\\r\\n\\r\\n) the same as LF-delimited ones', async () => {
    const frame = 'data: {"a":1}\r\n\r\n'
    const { text } = await run([encoder.encode(frame)])
    // Re-emitted without the CR, re-terminated with a plain \n\n.
    expect(text).toBe('data: {"a":1}\n\n')
  })

  it('flushes a trailing frame that has no terminating blank line', async () => {
    const chunks = [encoder.encode('data: {"a":1}\n\n'), encoder.encode('data: {"a":2}')]
    const { text } = await run(chunks)
    expect(text).toBe('data: {"a":1}\n\ndata: {"a":2}\n\n')
  })

  it('re-emits non-progress frames byte-identically, re-terminated with \\n\\n', async () => {
    const frame = 'id: 42\nevent: message\ndata: {"a":1}'
    const { text } = await run([encoder.encode(`${frame}\n\n`)])
    expect(text).toBe(`${frame}\n\n`)
  })
})

describe('filterToolProgress — tool-progress channel', () => {
  it('peels off a hermes.tool.progress frame, firing the callback and not forwarding it', async () => {
    const frame =
      'event: hermes.tool.progress\ndata: {"tool":"web_search","emoji":"🔎","label":"Searching","toolCallId":"tc1","status":"running"}\n\n'
    const { text, progress } = await run([encoder.encode(frame)])
    expect(text).toBe('')
    expect(progress).toEqual([
      { tool: 'web_search', emoji: '🔎', label: 'Searching', toolCallId: 'tc1', status: 'running' },
    ])
  })

  it('swallows a malformed-JSON progress payload without breaking the main stream', async () => {
    const malformed = 'event: hermes.tool.progress\ndata: {not valid json\n\n'
    const good = 'data: {"a":1}\n\n'
    const { text, progress } = await run([encoder.encode(malformed), encoder.encode(good)])
    expect(progress).toEqual([])
    expect(text).toBe(good)
  })

  it('ignores a `:`-prefixed comment line mixed into a tool-progress block', async () => {
    const frame =
      'event: hermes.tool.progress\n: keepalive\ndata: {"tool":"a","label":"b","toolCallId":"t","status":"s"}\n\n'
    const { text, progress } = await run([encoder.encode(frame)])
    expect(text).toBe('')
    expect(progress).toEqual([{ tool: 'a', label: 'b', toolCallId: 't', status: 's' }])
  })

  it('reassembles a multi-line data: payload (joined with \\n) at a token boundary', async () => {
    // A JSON payload wrapped across two `data:` lines, as a real SSE writer might do.
    const frame =
      'event: hermes.tool.progress\ndata: {"tool":"a","label":"b","toolCallId":"t",\ndata: "status":"s"}\n\n'
    const { progress } = await run([encoder.encode(frame)])
    expect(progress).toEqual([{ tool: 'a', label: 'b', toolCallId: 't', status: 's' }])
  })

  it('a multi-line split mid-token proves \\n (not empty-string) is the join separator', async () => {
    // Splitting the number literal "12" across two `data:` lines is only valid
    // JSON if the lines are concatenated with NO separator ("12"); joining with
    // "\n" (the actual, correct behavior) produces a syntax error, so this frame
    // must be swallowed. If the implementation ever joined with '' instead of
    // '\n', this frame would silently parse as `"extra":12` and the callback
    // WOULD fire — that is exactly the regression this test pins against.
    const frame =
      'event: hermes.tool.progress\ndata: {"tool":"a","label":"b","toolCallId":"t","status":"s","extra":1\ndata: 2}\n\n'
    const { progress, text } = await run([encoder.encode(frame)])
    expect(progress).toEqual([])
    expect(text).toBe('')
  })

  it('strips at most one leading space after `data:` (0, 1, or 2 spaces all parse identically)', async () => {
    const payload = '{"tool":"a","label":"exact","toolCallId":"t","status":"s"}'
    const variants = [
      `event: hermes.tool.progress\ndata:${payload}\n\n`,
      `event: hermes.tool.progress\ndata: ${payload}\n\n`,
      `event: hermes.tool.progress\ndata:  ${payload}\n\n`,
    ]
    for (const frame of variants) {
      const { progress } = await run([encoder.encode(frame)])
      expect(progress).toEqual([{ tool: 'a', label: 'exact', toolCallId: 't', status: 's' }])
    }
  })

  it('preserves forwarding order across interleaved progress and data frames', async () => {
    const frames = [
      'data: {"n":1}\n\n',
      'event: hermes.tool.progress\ndata: {"tool":"a","label":"b","toolCallId":"t1","status":"running"}\n\n',
      'data: {"n":2}\n\n',
      'event: hermes.tool.progress\ndata: {"tool":"a","label":"b","toolCallId":"t1","status":"done"}\n\n',
      'data: {"n":3}\n\n',
    ]
    const { text, progress } = await run(frames.map((f) => encoder.encode(f)))
    expect(text).toBe('data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n')
    expect(progress.map((p) => p.status)).toEqual(['running', 'done'])
  })
})

describe('filterToolProgress — error and cancel propagation', () => {
  it('propagates an upstream error via controller.error', async () => {
    let pulled = false
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true
          controller.enqueue(encoder.encode('data: {"a":1}\n\n'))
          return
        }
        controller.error(new Error('upstream exploded'))
      },
    })
    const filtered = filterToolProgress(upstream, () => {})
    const reader = filtered.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    await expect(reader.read()).rejects.toThrow('upstream exploded')
  })

  it('propagates cancel(reason) to the upstream reader', async () => {
    let cancelReason: unknown
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"a":1}\n\n'))
      },
      cancel(reason) {
        cancelReason = reason
      },
    })
    const filtered = filterToolProgress(upstream, () => {})
    await filtered.cancel('client-gone')
    expect(cancelReason).toBe('client-gone')
  })
})

describe('filterToolProgress — backpressure', () => {
  /** An upstream that counts how many times its source `pull()` was invoked. */
  function countingUpstream(frameCount: number): {
    stream: ReadableStream<Uint8Array>
    pullCount: () => number
  } {
    let pulls = 0
    let i = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (i >= frameCount) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(`data: {"n":${i}}\n\n`))
        i++
      },
    })
    return { stream, pullCount: () => pulls }
  }

  it('reading only the first forwarded frame does not drain the whole upstream', async () => {
    const FRAME_COUNT = 20
    const { stream: upstream, pullCount } = countingUpstream(FRAME_COUNT)
    const filtered = filterToolProgress(upstream, () => {})
    const reader = filtered.getReader()

    const { value } = await reader.read()
    expect(value).toBeDefined()

    // Let any default-hwm=1 auto-refill pull settle (the framework eagerly
    // enqueues once more to fill the queue back to its highWaterMark of 1),
    // but nothing beyond that — the consumer never asked for more.
    await new Promise((r) => setTimeout(r, 20))

    expect(pullCount()).toBeLessThanOrEqual(3)
    expect(pullCount()).toBeLessThan(FRAME_COUNT)
  })
})
