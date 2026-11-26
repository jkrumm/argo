import type { BoardFigures, ChartBar, DepotOrder, MarketQuote, TradeSide } from '../api/types'
import { figuresFromBars } from './depot-board'
import type { PriceLine } from './depot-chart'
import { dayDe, moneyDe, percentDe } from './depot-number'

/** A quote the page marks `stale` when its refresh failed; the service never sends the field. */
export type PageQuote = MarketQuote & { stale?: true }

/**
 * The live layer of the depot page (finances `docs/service.md` §Chart routes: `market/quote` and `candles?today=1`):
 * when to poll, how a refreshed candle goes into the history, and what the live price says.
 */

export const DIRECT_VENUE = 'ING Direkthandel'
/** The `mic` of ING Direkthandel's own daily bars. */
export const DIRECT_MIC = 'ING-DH'
/** The `mic` of a quote's euro line. */
export const EUR_LINE_MIC = 'XETR'

// ---- Polling ------------------------------------------------------------------------------------

export const LIVE_POLL_MS = 60_000
/** The longest a closed market waits: Direkthandel's pre-market starts before the regular session `next_open` names. */
export const CLOSED_POLL_MS = 15 * 60_000

/**
 * How long until the next quote request: every minute while any of the quoted sessions is not closed, nothing while the
 * tab is hidden. All closed: once at the next open, after a quarter of an hour at the latest; never where nothing opens
 * again (a series).
 */
export function pollDelay(
  quotes: readonly Pick<MarketQuote, 'session' | 'next_open'>[] | undefined,
  now: number,
  visible: boolean,
): number | false {
  if (!visible) return false
  if (quotes === undefined) return LIVE_POLL_MS
  if (quotes.some((quote) => quote.session !== 'closed')) return LIVE_POLL_MS
  const opens = quotes.flatMap((quote) =>
    quote.next_open === null ? [] : [Date.parse(quote.next_open)],
  )
  if (opens.length === 0) return false
  return Math.min(Math.max(Math.min(...opens) - now, LIVE_POLL_MS), CLOSED_POLL_MS)
}

/**
 * A quote whose refresh failed: the price stays to be read with its time, but it is no live price, has no bid or ask to
 * measure or fill in, and says so.
 */
export const staleQuote = (quote: MarketQuote): PageQuote => ({
  ...quote,
  stale: true,
  session: 'closed',
  bid: null,
  ask: null,
  spread: null,
  spread_bps: null,
  error: 'Kurs nicht aktualisiert',
})

// ---- The running candle --------------------------------------------------------------------------

/** The history with the newest bars of a later request in place of its own from the first of them on. */
export function mergeTail(history: readonly ChartBar[], tail: readonly ChartBar[]): ChartBar[] {
  const first = tail[0]
  if (first === undefined) return [...history]
  return [...history.filter((bar) => bar.time < first.time), ...tail]
}

const sameBar = (a: ChartBar, b: ChartBar): boolean =>
  a.time === b.time &&
  a.open === b.open &&
  a.high === b.high &&
  a.low === b.low &&
  a.close === b.close &&
  a.turnover === b.turnover &&
  a.source === b.source

/**
 * What a new set of bars changes on a drawn chart: nothing, its newest bar and what follows it (the chart updates those
 * in place and keeps its view), or something older (it is drawn again).
 */
export type BarChange = { kind: 'same' } | { kind: 'tail'; bars: ChartBar[] } | { kind: 'replace' }

export function barChange(drawn: readonly ChartBar[], next: readonly ChartBar[]): BarChange {
  const newest = drawn.length - 1
  if (newest < 0 || next.length < drawn.length) return { kind: 'replace' }
  for (let at = 0; at < newest; at++) {
    const before = drawn[at]
    const after = next[at]
    if (before === undefined || after === undefined || !sameBar(before, after)) {
      return { kind: 'replace' }
    }
  }
  const last = drawn[newest]
  const same = next[newest]
  if (last === undefined || same === undefined || same.time !== last.time) {
    return { kind: 'replace' }
  }
  const bars = next.slice(sameBar(last, same) ? newest + 1 : newest)
  return bars.length === 0 ? { kind: 'same' } : { kind: 'tail', bars }
}

// ---- What the live price says --------------------------------------------------------------------

const timeDe = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
})
const instantDe = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
/** US regular hours are 6 h 30 min, so the close follows from the next open. */
const US_SESSION_MS = 6.5 * 3_600_000

/** When the regular day of a quote's venue ends, German time; null where nothing closes or the venue is unknown. */
export function closeTime(
  quote: Pick<MarketQuote, 'venue' | 'next_open' | 'currency'>,
): string | null {
  if (quote.venue === DIRECT_VENUE) return '23:00'
  if (quote.venue === 'Xetra') return '17:30'
  if (quote.venue === 'Tradegate') return '22:00'
  if (quote.venue === null || quote.next_open === null || quote.currency !== 'USD') return null
  return timeDe.format(Date.parse(quote.next_open) + US_SESSION_MS)
}

export type QuoteStatus = { label: string; live: boolean }

const delayText = (seconds: number): string => `${Math.round(seconds / 60)} Min. verzögert`

/** The small status beside the live price. */
export function quoteStatus(quote: MarketQuote): QuoteStatus {
  if (quote.session === 'closed') {
    if (quote.error !== null) return { label: 'Kein Live-Kurs', live: false }
    const close = closeTime(quote)
    return {
      label: close === null ? 'Börse geschlossen' : `Börse geschlossen · Schluss ${close}`,
      live: false,
    }
  }
  if ((quote.delay_seconds ?? 0) > 0) {
    return { label: delayText(quote.delay_seconds ?? 0), live: true }
  }
  const venue = quote.venue === null ? '' : ` (${quote.venue})`
  if (quote.session === 'extended') return { label: `nachbörslich${venue}`, live: true }
  if (quote.session === 'pre') return { label: `vorbörslich${venue}`, live: true }
  return { label: 'live', live: true }
}

/** The note beside the status when the chart's running candle lags the price (Xetra's day is 15 minutes behind). */
export function candleNote(bar: ChartBar | undefined): string | null {
  return bar?.provisional === true && (bar.delay_seconds ?? 0) > 0
    ? `Kerze ${delayText(bar.delay_seconds ?? 0)}`
    : null
}

/** What the status says on hover: when the price was made and where; for a coin, when its day starts. */
export function asOfText(quote: MarketQuote, coin: boolean): string {
  const made =
    quote.as_of === null
      ? quote.day === null
        ? 'Kein Kurs'
        : `Schlusskurs ${dayDe(Date.parse(`${quote.day}T00:00:00Z`) / 1000)}`
      : `Stand ${instantDe.format(Date.parse(quote.as_of))}`
  return [made, quote.venue, coin ? 'die Tageskerze läuft ab 00:00 UTC' : null, quote.error]
    .filter((part) => part !== null)
    .join(' · ')
}

export const clockTime = (iso: string): string => instantDe.format(Date.parse(iso))

// ---- Orders against the quote ---------------------------------------------------------------------

const SIDE_WORD = { buy: 'Kauf', sell: 'Verkauf' } as const
const TYPE_WORD = { limit: 'Limit', stop: 'Stop', market: 'Market' } as const

/**
 * The price an open order has to meet: a buy limit the ask (Brief), a sell limit the bid (Geld), a stop the last price.
 * Null where the quote has none.
 */
export function sideToMeet(
  order: Pick<DepotOrder, 'side' | 'type'>,
  quote: PageQuote | undefined,
): { word: 'Brief' | 'Geld' | 'Kurs'; price: number } | null {
  if (quote === undefined || quote.stale === true || quote.currency !== 'EUR') return null
  const side =
    order.type === 'stop'
      ? ({ word: 'Kurs', price: quote.last } as const)
      : order.side === 'buy'
        ? ({ word: 'Brief', price: quote.ask } as const)
        : ({ word: 'Geld', price: quote.bid } as const)
  return side.price === null || side.price <= 0 ? null : { word: side.word, price: side.price }
}

/** A euro amount, followed by its dollar figure on a dollar chart. */
const amountText = (euros: number, usdPerEur: number | null): string =>
  usdPerEur === null
    ? moneyDe(euros, 'EUR')
    : `${moneyDe(euros, 'EUR')} (${moneyDe(euros * usdPerEur, 'USD')})`

/**
 * An open order as a line; a market order has no price and so no line. Prices are euros: with `usdPerEur` the line sits
 * at the converted dollar price of a dollar chart and its label names both amounts. With a quote the label names the
 * side the order has to meet and how far the order's price is from it.
 */
export function orderLine(
  order: DepotOrder,
  usdPerEur: number | null = null,
  quote?: MarketQuote,
): PriceLine | null {
  const price = order.type === 'stop' ? order.stop_price : order.limit_price
  if (order.status !== 'open' || price === null) return null
  const side = sideToMeet(order, quote)
  const distance =
    side === null
      ? ''
      : ` · ${side.word} ${moneyDe(side.price, 'EUR')} · ${percentDe(price / side.price - 1, true)}`
  return {
    id: `order-${order.id}`,
    price: usdPerEur === null ? price : price * usdPerEur,
    title: `${SIDE_WORD[order.side]} ${TYPE_WORD[order.type]} ${amountText(price, usdPerEur)}${distance}`,
    kind: order.side === 'buy' ? 'order-buy' : 'order-sell',
  }
}

/** Bid and ask as two thin lines while Direkthandel trades; with `usdPerEur` at their dollar price on a dollar chart. */
export function quoteLines(
  quote: MarketQuote | undefined,
  usdPerEur: number | null = null,
): PriceLine[] {
  if (quote === undefined || quote.currency !== 'EUR' || quote.session === 'closed') return []
  const line = (kind: 'bid' | 'ask', word: string, price: number | null): PriceLine[] =>
    price === null
      ? []
      : [
          {
            id: kind,
            price: usdPerEur === null ? price : price * usdPerEur,
            title: `${word} ${amountText(price, usdPerEur)}`,
            kind,
          },
        ]
  return [...line('bid', 'Geld', quote.bid), ...line('ask', 'Brief', quote.ask)]
}

/** The limit an order form starts with: the ask to buy at, the bid to sell at. */
export function suggestedLimit(side: TradeSide, quote: MarketQuote | undefined): number | null {
  if (quote === undefined || quote.currency !== 'EUR') return null
  return side === 'buy' ? quote.ask : quote.bid
}

const pointsDe = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** "Geld 4,21 € · Brief 4,23 € · Spread 0,02 € (4,7 bp)"; null without both sides. */
export function spreadText(quote: MarketQuote | undefined): string | null {
  if (quote === undefined || quote.bid === null || quote.ask === null) return null
  const points = quote.spread_bps === null ? '' : ` (${pointsDe.format(quote.spread_bps)} bp)`
  return `Geld ${moneyDe(quote.bid, 'EUR')} · Brief ${moneyDe(quote.ask, 'EUR')} · Spread ${moneyDe(quote.ask - quote.bid, 'EUR')}${points}`
}

// ---- Board figures with the running price --------------------------------------------------------

/** Whether a quote has a price for a day the stored figures do not: the row is then read with it. */
export const isRunning = (
  quote: MarketQuote | undefined,
  lastDay: string | undefined,
): quote is MarketQuote & { last: number; day: string } =>
  quote !== undefined &&
  quote.last !== null &&
  quote.day !== null &&
  lastDay !== undefined &&
  quote.day > lastDay

const round = (value: number): number => Math.round(value * 1e6) / 1e6

/**
 * The figures of a row with the running price as its newest close: the changes are counted from the stored bars before
 * the quote's day (a year of them is enough), the all-time high stays the stored one unless the price is above it.
 * Null where no bar precedes the day.
 */
export function liveFigures(
  stored: BoardFigures,
  bars: readonly ChartBar[],
  quote: MarketQuote & { last: number; day: string },
): BoardFigures | null {
  const time = Date.parse(`${quote.day}T00:00:00Z`) / 1000
  const before = bars.filter((bar) => bar.time < time)
  const newest = before.at(-1)
  if (newest === undefined) return null
  const figures = figuresFromBars([...before, { ...newest, time, close: quote.last }])
  if (figures === null) return null
  const ath =
    stored.ath !== null && stored.ath.value >= quote.last
      ? stored.ath
      : { value: quote.last, day: quote.day }
  return {
    ...figures,
    day_pct: quote.change_pct ?? figures.day_pct,
    ath,
    ath_pct: round(quote.last / ath.value - 1),
    low_52w: stored.low_52w === null ? quote.last : Math.min(stored.low_52w, quote.last),
    high_52w: stored.high_52w === null ? quote.last : Math.max(stored.high_52w, quote.last),
  }
}
