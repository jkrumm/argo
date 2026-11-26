import { describe, expect, it } from 'bun:test'
import type { MarketQuote, StreamQuote } from '../api/types'
import type { PageQuote } from './depot-live'
import {
  emptyTable,
  liveQuotes,
  pushedOver,
  readEvents,
  STREAM_SYMBOLS,
  streamSymbols,
  takeEvent,
  withPush,
} from './depot-stream'

const ISIN = 'IE00BK5BQT80'

const quote = (over: Partial<PageQuote> = {}): PageQuote => ({
  symbol: ISIN,
  today: null,
  currency: 'EUR',
  last: 4.22,
  day: '2026-11-26',
  bid: 4.21,
  ask: 4.23,
  spread: 0.02,
  spread_bps: 47.4,
  quoted_at: '2026-11-26T09:59:00.000Z',
  prev_close: 4,
  prev_close_day: '2026-11-25',
  change: 0.22,
  change_pct: 0.055,
  as_of: '2026-11-26T09:59:00.000Z',
  delay_seconds: 0,
  source: 'ing',
  venue: 'ING Direkthandel',
  session: 'open',
  next_open: '2026-11-27T08:00:00.000Z',
  error: null,
  ...over,
})

const push = (over: Partial<StreamQuote> = {}): StreamQuote => ({
  symbol: ISIN,
  currency: 'EUR',
  bid: 4.29,
  ask: 4.31,
  spread: 0.02,
  spread_bps: 46.5,
  last: 4.3,
  valuation: 4.3,
  quoted_at: '2026-11-26T10:00:05.000Z',
  delay_seconds: 0,
  source: 'ing',
  venue: 'ING Direkthandel',
  ...over,
})

describe('streamSymbols', () => {
  it('keeps each symbol once, the first ones when there are too many, in a stable order', () => {
    expect(streamSymbols(['b', 'a', 'b'])).toEqual(['a', 'b'])
    const many = Array.from({ length: STREAM_SYMBOLS + 5 }, (_, at) => `s${100 + at}`).toReversed()
    expect(streamSymbols(many)).toEqual(many.slice(0, STREAM_SYMBOLS).toSorted())
  })
})

describe('readEvents', () => {
  const state = `event: state\ndata: {"symbol":"${ISIN}","live":true,"reason":null}\n\n`

  it('reads the finished events and keeps the unfinished one for the next chunk', () => {
    const half = `event: quote\ndata: {"symbol":"${ISIN}",`
    const first = readEvents(`retry: 10000\n\n: keepalive\n\n${state}${half}`)
    expect(first.events).toEqual([{ type: 'state', symbol: ISIN, live: true, reason: null }])
    expect(first.rest).toBe(half)
    const second = readEvents(`${first.rest}"last":4.3}\n\n`)
    expect(second.events).toEqual([
      { type: 'quote', quote: { symbol: ISIN, last: 4.3 } as StreamQuote },
    ])
    expect(second.rest).toBe('')
  })

  it('drops what it cannot read', () => {
    const broken = 'event: quote\ndata: {oops\n\nevent: other\ndata: {"symbol":"x"}\n\ndata: 1\n\n'
    expect(readEvents(broken).events).toEqual([])
  })
})

describe('takeEvent', () => {
  it('shows the quote of a live symbol only, and forgets it when the symbol stops being live', () => {
    const table = emptyTable()
    takeEvent(table, { type: 'quote', quote: push() })
    expect(liveQuotes(table).size).toBe(0)
    takeEvent(table, { type: 'state', symbol: ISIN, live: true, reason: null })
    expect(liveQuotes(table).get(ISIN)?.last).toBe(4.3)
    takeEvent(table, { type: 'state', symbol: ISIN, live: false, reason: 'outside' })
    takeEvent(table, { type: 'state', symbol: ISIN, live: true, reason: null })
    expect(liveQuotes(table).size).toBe(0)
  })
})

describe('withPush', () => {
  it('lays price, bid and ask over the polled quote and counts the change against its previous close', () => {
    expect(withPush(quote(), push())).toEqual(
      quote({
        last: 4.3,
        bid: 4.29,
        ask: 4.31,
        spread_bps: 46.51,
        change: 0.3,
        change_pct: 0.075,
        quoted_at: '2026-11-26T10:00:05.000Z',
        as_of: '2026-11-26T10:00:05.000Z',
      }),
    )
  })

  it('keeps the polled figure where the push only rounds it to three decimals', () => {
    const polled = quote({ last: 4.2245, bid: 4.2105, ask: 4.2245 })
    const merged = withPush(polled, push({ last: 4.225, bid: 4.211, ask: 4.226 }))
    expect([merged.last, merged.bid, merged.ask, merged.spread]).toEqual([
      4.2245, 4.2105, 4.226, 0.0155,
    ])
  })

  it('takes the valuation where there is no last price, and has no change without a previous close', () => {
    const merged = withPush(quote({ prev_close: null }), push({ last: null }))
    expect(merged.last).toBe(4.3)
    expect([merged.change, merged.change_pct]).toEqual([null, null])
  })

  it('leaves the polled quote where the push is not about it', () => {
    const cases: [MarketQuote, StreamQuote | undefined][] = [
      [quote(), undefined],
      [quote({ currency: 'USD', venue: 'NASDAQ-GS' }), push()],
      [quote({ venue: 'Xetra' }), push()],
      [quote({ session: 'closed' }), push()],
      [quote({ stale: true }), push()],
      // The first tick of a new day, before the poll has the new previous close.
      [quote({ day: '2026-11-25' }), push()],
      [quote(), push({ quoted_at: '2026-11-26T09:58:00.000Z' })],
      [quote(), push({ quoted_at: null })],
      [quote(), push({ last: null, valuation: null })],
    ]
    for (const [polled, pushed] of cases) expect(withPush(polled, pushed)).toBe(polled)
  })

  it('counts the day in German time', () => {
    const late = push({ quoted_at: '2026-11-26T23:30:00.000Z' })
    const polled = quote({ day: '2026-11-27', quoted_at: null })
    expect(withPush(polled, late).last).toBe(4.3)
  })
})

describe('pushedOver', () => {
  it('is the polled map itself while nothing is pushed, else the pushed symbols are overlaid', () => {
    const polled = new Map([
      [ISIN, quote()],
      ['BTC-USD', quote({ symbol: 'BTC-USD', currency: 'USD', venue: 'Bitstamp' })],
    ])
    expect(pushedOver(polled, new Map())).toBe(polled)
    const merged = pushedOver(polled, new Map([[ISIN, push()]]))
    expect(merged.get(ISIN)?.last).toBe(4.3)
    expect(merged.get('BTC-USD')).toBe(polled.get('BTC-USD') as MarketQuote)
  })
})
