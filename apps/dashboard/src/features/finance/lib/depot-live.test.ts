import { describe, expect, it } from 'bun:test'
import type { BoardFigures, ChartBar, DepotOrder, MarketQuote } from '../api/types'
import {
  asOfText,
  barChange,
  candleNote,
  CLOSED_POLL_MS,
  isRunning,
  LIVE_POLL_MS,
  liveFigures,
  mergeTail,
  orderLine,
  pollDelay,
  quoteLines,
  quoteStatus,
  spreadText,
  staleQuote,
  suggestedLimit,
} from './depot-live'

const NOW = Date.parse('2026-11-26T10:00:00Z')

const quote = (over: Partial<MarketQuote> = {}): MarketQuote => ({
  symbol: 'IE00BK5BQT80',
  currency: 'EUR',
  last: 4.22,
  day: '2026-11-26',
  bid: 4.21,
  ask: 4.23,
  spread: 0.02,
  spread_bps: 47.4,
  quoted_at: '2026-11-26T09:59:00.000Z',
  prev_close: 4.1,
  prev_close_day: '2026-11-25',
  change: 0.12,
  change_pct: 0.029,
  as_of: '2026-11-26T09:59:00.000Z',
  delay_seconds: 0,
  source: 'ing',
  venue: 'ING Direkthandel',
  session: 'open',
  next_open: '2026-11-27T08:00:00.000Z',
  error: null,
  ...over,
})

const order = (over: Partial<DepotOrder> = {}): DepotOrder =>
  ({
    id: 1,
    side: 'buy',
    type: 'limit',
    status: 'open',
    limit_price: 4.21,
    stop_price: null,
    ...over,
  }) as DepotOrder

const bar = (time: number, close: number, over: Partial<ChartBar> = {}): ChartBar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  units: null,
  turnover: null,
  source: 'xetra',
  ...over,
})

describe('pollDelay', () => {
  it('asks every minute while a session is open, before or after hours', () => {
    for (const session of ['open', 'pre', 'extended'] as const) {
      expect(pollDelay([quote({ session })], NOW, true)).toBe(LIVE_POLL_MS)
    }
    expect(pollDelay([quote({ session: 'closed' }), quote()], NOW, true)).toBe(LIVE_POLL_MS)
    expect(pollDelay(undefined, NOW, true)).toBe(LIVE_POLL_MS)
  })
  it('asks nothing while the tab is hidden', () => {
    expect(pollDelay([quote()], NOW, false)).toBe(false)
    expect(pollDelay(undefined, NOW, false)).toBe(false)
  })
  it('waits for the next open when every session is closed, a quarter of an hour at most', () => {
    const closed = (next_open: string | null) => quote({ session: 'closed', next_open })
    expect(pollDelay([closed('2026-11-27T08:00:00.000Z')], NOW, true)).toBe(CLOSED_POLL_MS)
    expect(pollDelay([closed('2026-11-26T10:05:00.000Z')], NOW, true)).toBe(5 * 60_000)
    expect(pollDelay([closed('2026-11-26T09:00:00.000Z')], NOW, true)).toBe(LIVE_POLL_MS)
    expect(pollDelay([closed(null)], NOW, true)).toBe(false)
  })
})

describe('the running candle', () => {
  const history = [bar(1, 10), bar(2, 11), bar(3, 12, { provisional: true })]

  it('takes the tail over the history from its first bar on', () => {
    expect(mergeTail(history, [bar(3, 13), bar(4, 14)]).map((b) => b.close)).toEqual([
      10, 11, 13, 14,
    ])
    expect(mergeTail(history, [])).toEqual(history)
    expect(mergeTail([], [bar(4, 14)])).toEqual([bar(4, 14)])
  })
  it('updates the newest candle in place', () => {
    const next = mergeTail(history, [bar(3, 12.5, { provisional: true })])
    expect(barChange(history, next)).toEqual({ kind: 'tail', bars: [next[2]!] })
  })
  it('appends a new day in place', () => {
    const next = [...history, bar(4, 14)]
    expect(barChange(history, next)).toEqual({ kind: 'tail', bars: [bar(4, 14)] })
  })
  it('does nothing for the same bars', () => {
    expect(barChange(history, mergeTail(history, [bar(3, 12)]))).toEqual({ kind: 'same' })
  })
  it('draws again when something older changed or the series is another', () => {
    expect(barChange(history, mergeTail(history, [bar(2, 99), bar(3, 12)]))).toEqual({
      kind: 'replace',
    })
    expect(barChange(history, [bar(1, 10)])).toEqual({ kind: 'replace' })
    expect(barChange([], history)).toEqual({ kind: 'replace' })
  })
})

describe('the status of a quote', () => {
  it('reads live, delayed, after hours and closed', () => {
    expect(quoteStatus(quote()).label).toBe('live')
    expect(quoteStatus(quote({ delay_seconds: 900 })).label).toBe('15 Min. verzögert')
    expect(quoteStatus(quote({ session: 'extended' })).label).toBe(
      'nachbörslich (ING Direkthandel)',
    )
    expect(quoteStatus(quote({ session: 'closed', venue: 'Xetra' })).label).toBe(
      'Börse geschlossen · Schluss 17:30',
    )
    // 09:30 New York is 15:30 German time on this day, so the close is 22:00.
    const us = quote({
      session: 'closed',
      venue: 'NASDAQ-GS',
      currency: 'USD',
      next_open: '2026-11-27T14:30:00.000Z',
    })
    expect(quoteStatus(us).label).toBe('Börse geschlossen · Schluss 22:00')
    expect(quoteStatus(quote({ session: 'closed', error: 'HTTP 500' })).label).toBe(
      'Kein Live-Kurs',
    )
  })
  it('says when the price was made and, for a coin, when its day starts', () => {
    expect(asOfText(quote(), false)).toBe('Stand 26.11., 10:59 · ING Direkthandel')
    expect(asOfText(quote({ venue: 'Bitstamp' }), true)).toContain('ab 00:00 UTC')
  })
  it('names a running candle that lags the price', () => {
    expect(candleNote(bar(1, 1, { provisional: true, delay_seconds: 900 }))).toBe(
      'Kerze 15 Min. verzögert',
    )
    expect(candleNote(bar(1, 1, { provisional: true, delay_seconds: 0 }))).toBeNull()
    expect(candleNote(bar(1, 1))).toBeNull()
  })
})

describe('orders against the quote', () => {
  it('measures a buy limit against the ask, a sell limit against the bid, a stop against the last', () => {
    expect(orderLine(order(), null, quote())?.title).toBe(
      'Kauf Limit 4,21 € · Brief 4,23 € · −0,5 %',
    )
    expect(orderLine(order({ side: 'sell', limit_price: 4.3 }), null, quote())?.title).toBe(
      'Verkauf Limit 4,3 € · Geld 4,21 € · +2,1 %',
    )
    expect(
      orderLine(
        order({ side: 'sell', type: 'stop', stop_price: 4, limit_price: null }),
        null,
        quote(),
      )?.title,
    ).toBe('Verkauf Stop 4 € · Kurs 4,22 € · −5,2 %')
  })
  it('keeps the plain label without a quote, converts a dollar chart and skips what has no price', () => {
    expect(orderLine(order())).toMatchObject({ price: 4.21, title: 'Kauf Limit 4,21 €' })
    const dollar = orderLine(order({ side: 'sell', limit_price: 182 }), 1.08)
    expect(dollar?.price).toBeCloseTo(196.56)
    expect(dollar?.title).toBe('Verkauf Limit 182 € (196,56 $)')
    expect(orderLine(order({ type: 'market', limit_price: null }))).toBeNull()
    expect(orderLine(order({ status: 'cancelled' }))).toBeNull()
  })
  it('draws bid and ask while Direkthandel trades only', () => {
    expect(quoteLines(quote()).map((line) => line.title)).toEqual(['Geld 4,21 €', 'Brief 4,23 €'])
    expect(quoteLines(quote(), 2).map((line) => line.price)).toEqual([8.42, 8.46])
    expect(quoteLines(quote({ session: 'closed' }))).toEqual([])
    expect(quoteLines(quote({ currency: 'USD' }))).toEqual([])
  })
  it('starts a limit at the ask to buy and the bid to sell, and names the spread', () => {
    expect(suggestedLimit('buy', quote())).toBe(4.23)
    expect(suggestedLimit('sell', quote())).toBe(4.21)
    expect(suggestedLimit('buy', undefined)).toBeNull()
    expect(spreadText(quote())).toContain('Geld 4,21 € · Brief 4,23 € · Spread 0,02 €')
    expect(spreadText(quote({ bid: null }))).toBeNull()
  })
})

describe('staleQuote', () => {
  it('keeps the price but is not live, draws nothing, measures nothing and fills nothing in', () => {
    const old = staleQuote(quote())
    expect(old.last).toBe(4.22)
    expect(quoteStatus(old)).toEqual({ label: 'Kein Live-Kurs', live: false })
    expect(quoteLines(old)).toEqual([])
    expect(suggestedLimit('buy', old)).toBeNull()
    expect(orderLine(order(), null, old)?.title).toBe('Kauf Limit 4,21 €')
    expect(orderLine(order({ type: 'stop', stop_price: 4 }), null, old)?.title).toBe(
      'Kauf Stop 4 €',
    )
  })
})

describe('liveFigures', () => {
  const at = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000
  const bars = [
    bar(at('2025-12-31'), 80),
    bar(at('2026-11-19'), 100),
    bar(at('2026-11-20'), 102),
    bar(at('2026-11-25'), 104),
  ]
  const stored: BoardFigures = {
    last_close: 104,
    last_day: '2026-11-25',
    day_pct: 0.0196,
    week_pct: 0,
    month_pct: null,
    ytd_pct: 0.3,
    year_pct: null,
    ath: { value: 120, day: '2024-03-01' },
    ath_pct: -0.133333,
    low_52w: 80,
    high_52w: 104,
  }
  const running = quote({ last: 110, day: '2026-11-26', change_pct: 0.0577 })

  it('is running only for a day the stored figures do not have', () => {
    expect(isRunning(running, stored.last_day)).toBe(true)
    expect(isRunning(quote({ day: '2026-11-25' }), stored.last_day)).toBe(false)
    expect(isRunning(undefined, stored.last_day)).toBe(false)
  })
  it('counts the changes from the live price, a week back from its day, the stored high kept', () => {
    const figures = liveFigures(stored, bars, running as never)
    expect(figures).toMatchObject({
      last_close: 110,
      last_day: '2026-11-26',
      day_pct: 0.0577,
      week_pct: 0.1,
      ytd_pct: 0.375,
      ath: { value: 120 },
      high_52w: 110,
    })
    expect(figures?.ath_pct).toBeCloseTo(110 / 120 - 1, 5)
  })
  it('takes a price above the high as the high, and has nothing without earlier bars', () => {
    const above = { ...running, last: 130 } as never
    expect(liveFigures(stored, bars, above)).toMatchObject({
      ath: { value: 130, day: '2026-11-26' },
      ath_pct: 0,
    })
    expect(liveFigures(stored, [], running as never)).toBeNull()
  })
})
