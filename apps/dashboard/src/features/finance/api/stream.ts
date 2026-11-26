import { focusManager } from '@tanstack/react-query'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { EUR_LINE_MIC } from '../lib/depot-live'
import { emptyTable, liveQuotes, readEvents, takeEvent } from '../lib/depot-stream'
import { financeStream } from './client'
import type { StreamQuote } from './types'

/**
 * The reader of `market/stream`. `EventSource` cannot send the bearer header, so the stream is read from a `fetch`
 * body, with what EventSource would have done: reconnect after a break, and give a silent connection up.
 */

/** The service sends a comment every 15 s: three missed and the connection is dead. */
const IDLE_MS = 45_000
const RETRY_MS = 10_000
const RETRY_MAX_MS = 60_000
/** Ticks are shown at most this often, so a long list does not redraw the page for each of them. */
const FLUSH_MS = 1000

export type StreamTimings = { idleMs: number; retryMs: number; flushMs: number }

/** Resolves after `ms`, at once when `signal` aborts; leaves no listener behind either way. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

/**
 * Keeps one stream of `symbols` open until the answered function is called. `onQuotes` gets the quotes of the symbols
 * that are live, an empty map as soon as the connection is lost.
 */
export function openQuoteStream({
  symbols,
  onQuotes,
  connect = (signal) => financeStream('/market/stream', { symbols, mic: EUR_LINE_MIC }, signal),
  timings = { idleMs: IDLE_MS, retryMs: RETRY_MS, flushMs: FLUSH_MS },
}: {
  symbols: string
  onQuotes: (quotes: Map<string, StreamQuote>) => void
  connect?: (signal: AbortSignal) => Promise<Response>
  timings?: StreamTimings
}): () => void {
  const stopped = new AbortController()
  let table = emptyTable()
  let flush: ReturnType<typeof setTimeout> | undefined
  let flushedAt = 0

  const publish = () => {
    clearTimeout(flush)
    flush = undefined
    flushedAt = Date.now()
    onQuotes(liveQuotes(table))
  }
  const publishSoon = () => {
    flush ??= setTimeout(publish, Math.max(0, flushedAt + timings.flushMs - Date.now()))
  }

  /** One connection until it ends: whether it answered with a stream, and whether asking again can help. */
  async function once(): Promise<{ read: boolean; again: boolean }> {
    const connection = new AbortController()
    const signal = AbortSignal.any([stopped.signal, connection.signal])
    let idle: ReturnType<typeof setTimeout> | undefined
    const heard = () => {
      clearTimeout(idle)
      idle = setTimeout(() => connection.abort(), timings.idleMs)
    }
    let read = false
    try {
      heard()
      const response = await connect(signal)
      if (!response.ok || response.body === null) {
        await response.body?.cancel()
        // A refused symbol list or token will be refused again.
        return { read, again: response.status !== 400 && response.status !== 401 }
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done || signal.aborted) break
        read = true
        heard()
        const { events, rest } = readEvents(buffer + value)
        buffer = rest
        for (const event of events) takeEvent(table, event)
        if (events.length > 0) publishSoon()
      }
    } catch {
      // A network failure or the watchdog: the next connection says whether it persists.
    } finally {
      clearTimeout(idle)
    }
    return { read, again: true }
  }

  async function run() {
    let wait = timings.retryMs
    while (!stopped.signal.aborted) {
      const { read, again } = await once()
      if (stopped.signal.aborted) return
      table = emptyTable()
      publish()
      if (!again) return
      wait = read ? timings.retryMs : Math.min(wait * 2, RETRY_MAX_MS)
      await pause(wait, stopped.signal)
    }
  }

  void run()
  return () => {
    stopped.abort()
    clearTimeout(flush)
  }
}

const NOTHING: ReadonlyMap<string, StreamQuote> = new Map()

const subscribeFocus = (onChange: () => void) => focusManager.subscribe(onChange)
const isVisible = () => focusManager.isFocused()

/**
 * ING Direkthandel's pushed quotes of `symbols` (their euro lines), by symbol: only those the stream says are live,
 * and only while the tab is visible. Everything else is the polled quote's.
 */
export function useQuoteStream(symbols: readonly string[]): ReadonlyMap<string, StreamQuote> {
  const wanted = symbols.join(',')
  const visible = useSyncExternalStore(subscribeFocus, isVisible)
  const [pushed, setPushed] = useState<{
    symbols: string
    quotes: ReadonlyMap<string, StreamQuote>
  } | null>(null)
  useEffect(() => {
    if (wanted === '' || !visible) return
    const stop = openQuoteStream({
      symbols: wanted,
      onQuotes: (quotes) => setPushed({ symbols: wanted, quotes }),
    })
    return () => {
      stop()
      setPushed(null)
    }
  }, [wanted, visible])
  return pushed?.symbols === wanted ? pushed.quotes : NOTHING
}
