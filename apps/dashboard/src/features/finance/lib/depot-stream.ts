import type { MarketQuote, StreamQuote, StreamState } from '../api/types'
import { DIRECT_VENUE } from './depot-live'

/**
 * The pushed side of the live layer (finances `docs/service.md` §Chart routes: `market/stream`): reading the event
 * stream, and what a pushed quote changes on the polled one. The polled quote stays the base: the stream carries no
 * previous close, no session and no running day.
 */

/** The most symbols the stream takes at once. */
export const STREAM_SYMBOLS = 50

/** The symbols of one stream, in the order given (what matters most first), each once; sorted, so the same set is the same stream. */
export function streamSymbols(wanted: readonly string[]): string[] {
  return [...new Set(wanted)].slice(0, STREAM_SYMBOLS).toSorted()
}

export type StreamEvent = ({ type: 'state' } & StreamState) | { type: 'quote'; quote: StreamQuote }

function parseBlock(block: string): StreamEvent | null {
  let name = ''
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if ((name !== 'state' && name !== 'quote') || data.length === 0) return null
  try {
    const value = JSON.parse(data.join('\n')) as unknown
    if (typeof value !== 'object' || value === null || !('symbol' in value)) return null
    return name === 'state'
      ? { type: 'state', ...(value as StreamState) }
      : { type: 'quote', quote: value as StreamQuote }
  } catch {
    return null
  }
}

/** The complete events at the front of what has arrived, and the unfinished rest. Comments and `retry` are dropped. */
export function readEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''
  return { events: blocks.map(parseBlock).filter((event) => event !== null), rest }
}

/** What the stream has said: which symbols are pushed, and the newest quote of each. */
export type PushTable = {
  live: Set<string>
  quotes: Map<string, StreamQuote>
}

export const emptyTable = (): PushTable => ({ live: new Set(), quotes: new Map() })

/** Takes one event in. A symbol that stops being live loses its quote: it must not go on reading as pushed. */
export function takeEvent(table: PushTable, event: StreamEvent): void {
  if (event.type === 'quote') {
    table.quotes.set(event.quote.symbol, event.quote)
    return
  }
  if (event.live) {
    table.live.add(event.symbol)
    return
  }
  table.live.delete(event.symbol)
  table.quotes.delete(event.symbol)
}

/** The quotes of the symbols that are live. */
export const liveQuotes = (table: PushTable): Map<string, StreamQuote> =>
  new Map([...table.quotes].filter(([symbol]) => table.live.has(symbol)))

const berlinDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const round = (value: number): number => Math.round(value * 1e8) / 1e8

/**
 * The polled quote with the pushed price, bid and ask laid over it, and the change counted again against its previous
 * close. Left as polled where the push is not about it: another venue or currency (a US listing in dollars), a closed or
 * stale quote, another day (the previous close would be the wrong one until the next poll), or an older price than the
 * polled one.
 */
export function withPush(quote: MarketQuote, push: StreamQuote | undefined): MarketQuote {
  const last = push?.last ?? push?.valuation ?? null
  if (
    push === undefined ||
    last === null ||
    push.quoted_at === null ||
    quote.stale === true ||
    quote.session === 'closed' ||
    quote.venue !== DIRECT_VENUE ||
    quote.currency !== push.currency ||
    quote.day !== berlinDay.format(Date.parse(push.quoted_at)) ||
    (quote.quoted_at !== null && Date.parse(push.quoted_at) < Date.parse(quote.quoted_at))
  ) {
    return quote
  }
  const change = quote.prev_close === null ? null : round(last - quote.prev_close)
  return {
    ...quote,
    last,
    bid: push.bid,
    ask: push.ask,
    spread: push.spread,
    spread_bps: push.spread_bps,
    quoted_at: push.quoted_at,
    as_of: push.quoted_at,
    delay_seconds: push.delay_seconds,
    source: push.source,
    change,
    change_pct:
      change === null || quote.prev_close === null || quote.prev_close === 0
        ? null
        : round(change / quote.prev_close),
  }
}

/** Every quote of a map with what the stream pushed laid over it; the map itself where nothing is pushed. */
export function pushedOver(
  quotes: ReadonlyMap<string, MarketQuote>,
  pushed: ReadonlyMap<string, StreamQuote>,
): ReadonlyMap<string, MarketQuote> {
  if (pushed.size === 0) return quotes
  return new Map(
    [...quotes].map(([symbol, quote]) => [symbol, withPush(quote, pushed.get(symbol))] as const),
  )
}
