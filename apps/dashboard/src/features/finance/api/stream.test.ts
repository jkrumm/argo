import { describe, expect, it } from 'bun:test'
import { openQuoteStream } from './stream'
import type { StreamQuote } from './types'

const TIMINGS = { idleMs: 80, retryMs: 5, flushMs: 5 }
const LIVE = 'event: state\ndata: {"symbol":"X","live":true,"reason":null}\n\n'
const TICK = 'event: quote\ndata: {"symbol":"X","last":2}\n\n'

/** A connection that sends `text` and then stays open until `end` or the caller's abort. */
function connection(text: string, signal: AbortSignal) {
  let end = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      end = () => controller.close()
      signal.addEventListener('abort', () => controller.error(signal.reason))
    },
  })
  return { response: new Response(body), end: () => end() }
}

function until(met: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const look = () => {
      if (met()) return resolve()
      if (Date.now() - started > 2000) return reject(new Error('timed out'))
      setTimeout(look, 2)
    }
    look()
  })
}

function start(answer: (signal: AbortSignal, attempt: number) => Response) {
  const seen: Map<string, StreamQuote>[] = []
  const signals: AbortSignal[] = []
  const stop = openQuoteStream({
    symbols: 'X',
    onQuotes: (quotes) => seen.push(quotes),
    connect: async (signal) => {
      signals.push(signal)
      return answer(signal, signals.length)
    },
    timings: TIMINGS,
  })
  return { seen, signals, stop }
}

describe('openQuoteStream', () => {
  it('hands on the live quotes, empties them when the stream ends and connects again', async () => {
    let first: { end: () => void } | undefined
    const { seen, signals, stop } = start((signal, attempt) => {
      const open = connection(attempt === 1 ? LIVE + TICK : ': keepalive\n\n', signal)
      if (attempt === 1) first = open
      return open.response
    })
    await until(() => seen.at(-1)?.get('X')?.last === 2)
    first?.end()
    await until(() => seen.at(-1)?.size === 0)
    await until(() => signals.length === 2)
    stop()
    expect(signals[1]?.aborted).toBe(true)
  })

  it('gives a silent connection up and opens another', async () => {
    const { signals, stop } = start((signal) => connection(LIVE, signal).response)
    await until(() => signals.length >= 2)
    expect(signals[0]?.aborted).toBe(true)
    stop()
  })

  it('does not ask again after a refusal that would only repeat', async () => {
    const { signals, stop } = start(() => Response.json({ error: 'bad' }, { status: 400 }))
    await Bun.sleep(60)
    expect(signals).toHaveLength(1)
    stop()
  })

  it('asks again after an unavailable service, and no more once stopped', async () => {
    const { signals, stop } = start(() => new Response(null, { status: 503 }))
    await until(() => signals.length >= 2)
    stop()
    const asked = signals.length
    await Bun.sleep(60)
    expect(signals).toHaveLength(asked)
  })
})
