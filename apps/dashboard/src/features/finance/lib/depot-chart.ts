import type { ChartBar, DepotOrder, DepotPosition, DepotTrade, WatchlistEntry } from '../api/types'
import { eurExact } from './format'

/** The bar intervals the page offers and the service knows: there is no intraday. */
export type DepotInterval = '1d' | '1w' | '1mo'
export type DepotRange = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max'

const DAY_MS = 86_400_000
const DAY_S = 86_400

const RANGE_DAYS: Record<Exclude<DepotRange, 'max'>, number> = {
  '1m': 31,
  '3m': 92,
  '6m': 183,
  '1y': 366,
  '2y': 731,
  '5y': 1827,
}

/** The service refuses a request of more than 5,000 bars; only daily bars of a long history can reach it. */
const DAILY_MAX_DAYS = 4990

const OFFERED = new Set<string>(['1d', '1w', '1mo'])

/** The interval an answer carries, when the page offers it; else `fallback`. */
export const depotInterval = (value: string | undefined, fallback: DepotInterval): DepotInterval =>
  value !== undefined && OFFERED.has(value) ? (value as DepotInterval) : fallback

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** `YYYY-MM-DD` as epoch seconds at UTC midnight, the time of a daily bar. */
export const dayToSeconds = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000

/** The `from` / `to` days of a candle request; no `from` means the whole history. */
export function candleWindow(
  range: DepotRange,
  interval: DepotInterval,
  today: string,
): { from?: string; to: string } {
  // Week and month bars are few and drawn as wide as a day: they load the whole history and open at the
  // newest bar, so the chart is full and the owner scrolls back instead of the range deciding what exists.
  if (interval !== '1d') return { to: today }
  const days = range === 'max' ? undefined : RANGE_DAYS[range]
  const span = Math.min(days ?? DAILY_MAX_DAYS, DAILY_MAX_DAYS)
  return { from: isoDay(Date.parse(`${today}T00:00:00Z`) - span * DAY_MS), to: today }
}

/** How far a bar reaches past its own time (daily: a weekend or a holiday): a booking inside it belongs to it. */
const BAR_SPAN_S: Record<DepotInterval, number> = {
  '1d': 4 * DAY_S,
  '1w': 7 * DAY_S,
  '1mo': 31 * DAY_S,
}

/** Index of the last bar with `time <= at`, or -1. `bars` ascend by time. */
function lastBarAtOrBefore(bars: readonly ChartBar[], at: number): number {
  let lo = 0
  let hi = bars.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((bars[mid]?.time ?? Number.POSITIVE_INFINITY) <= at) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/**
 * The bar a trade booked on `day` is drawn on: on a daily chart the bar of that day (the last one
 * before it when the day has none, a weekend booking), on a weekly or monthly chart the bar that
 * contains it. `null` when the chart does not reach back to it.
 */
export function barOfDay(
  bars: readonly ChartBar[],
  day: string,
  interval: DepotInterval,
): number | null {
  const start = dayToSeconds(day)
  const bar = bars[lastBarAtOrBefore(bars, start)]
  return bar !== undefined && bar.time > start - BAR_SPAN_S[interval] ? bar.time : null
}

export type TradeMark = {
  time: number
  side: DepotTrade['side']
  /** The quantity is a guess (`estimated`), not read from a document or derived. */
  estimated: boolean
  trade: DepotTrade
}

/** Every trade that has a bar on this chart, oldest first. */
export function tradeMarks(
  trades: readonly DepotTrade[],
  bars: readonly ChartBar[],
  interval: DepotInterval,
): TradeMark[] {
  const marks: TradeMark[] = []
  for (const trade of trades) {
    const time = barOfDay(bars, trade.booked_on, interval)
    if (time === null) continue
    marks.push({
      time,
      side: trade.side,
      estimated: trade.quantity_source === 'estimated',
      trade,
    })
  }
  return marks.toSorted((a, b) => a.time - b.time || a.trade.id - b.trade.id)
}

/** The trades drawn on each bar, by the bar's time. */
export function marksByBar(marks: readonly TradeMark[]): Map<number, TradeMark[]> {
  const byBar = new Map<number, TradeMark[]>()
  for (const mark of marks) byBar.set(mark.time, [...(byBar.get(mark.time) ?? []), mark])
  return byBar
}

/** One marker on the chart: the trades of one side on one bar, so a week of savings-plan buys is one arrow with a count. */
export type MarkGroup = {
  time: number
  side: DepotTrade['side']
  count: number
  /** Every quantity in it is a guess: drawn as a circle. */
  estimated: boolean
}

/** The markers to draw, oldest first: one per bar and side. */
export function markGroups(marks: readonly TradeMark[]): MarkGroup[] {
  const groups = new Map<string, MarkGroup>()
  for (const mark of marks) {
    const key = `${mark.time}:${mark.side}`
    const group = groups.get(key)
    groups.set(
      key,
      group === undefined
        ? { time: mark.time, side: mark.side, count: 1, estimated: mark.estimated }
        : { ...group, count: group.count + 1, estimated: group.estimated && mark.estimated },
    )
  }
  return [...groups.values()].toSorted((a, b) => a.time - b.time)
}

const quantityOf = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 4 })

/** A price in dollars, the way the chart reads one. */
const usdText = (price: number): string =>
  `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function oneTradeText(mark: TradeMark, usd: boolean): string {
  const { trade } = mark
  const side = trade.side === 'buy' ? 'Bought' : 'Sold'
  const quantity =
    trade.quantity === null
      ? 'quantity unknown'
      : `${mark.estimated ? '≈ ' : ''}${quantityOf(trade.quantity)}`
  const dollars = usd && trade.price_usd !== null ? ` · at ${usdText(trade.price_usd)}` : ''
  return `${side} ${quantity} · ${eurExact(trade.amount_cents)}${dollars}${mark.estimated ? ' · estimated quantity' : ''}`
}

/**
 * The readout lines of the trades on one bar: a line per trade, and a line per side once a side has
 * several (a savings plan and a top-up in one week): count, units and amount together.
 */
export function tradeReadout(marks: readonly TradeMark[], usd: boolean): string[] {
  return (['buy', 'sell'] as const).flatMap((side) => {
    const own = marks.filter((mark) => mark.side === side)
    const [first] = own
    if (first === undefined) return []
    if (own.length === 1) return [oneTradeText(first, usd)]
    const unknown = own.some((mark) => mark.trade.quantity === null)
    const estimated = own.some((mark) => mark.estimated)
    const units = own.reduce((sum, mark) => sum + (mark.trade.quantity ?? 0), 0)
    const amount = own.reduce((sum, mark) => sum + mark.trade.amount_cents, 0)
    return [
      `${side === 'buy' ? 'Bought' : 'Sold'} ${own.length} trades · ${
        unknown ? 'quantity unknown' : `${estimated ? '≈ ' : ''}${quantityOf(units)}`
      } · ${eurExact(amount)}`,
    ]
  })
}

/** A horizontal line on the chart: an open order at its limit or stop, or the average cost. */
export type PriceLine = {
  id: string
  price: number
  title: string
  kind: 'order-buy' | 'order-sell' | 'cost'
}

const trimmed = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 4 })

/** An open order as a line; a market order has no price and so no line. */
export function orderLine(order: DepotOrder): PriceLine | null {
  const price = order.type === 'stop' ? order.stop_price : order.limit_price
  if (order.status !== 'open' || price === null) return null
  return {
    id: `order-${order.id}`,
    price,
    title: `${order.side === 'buy' ? 'Buy' : 'Sell'} ${trimmed(order.quantity)} ${order.type}`,
    kind: order.side === 'buy' ? 'order-buy' : 'order-sell',
  }
}

/** The average cost of an open position per unit, in the instrument's currency (EUR). */
export function costLine(position: DepotPosition | undefined): PriceLine | null {
  if (position === undefined || position.quantity <= 0) return null
  const perUnit = position.cost_average_cents / 100 / position.quantity
  return {
    id: 'cost',
    price: perUnit,
    title: `Average cost ${trimmed(Math.round(perUnit * 100) / 100)}`,
    kind: 'cost',
  }
}

/**
 * The average cost per unit in dollars, for an instrument charted in USD: every open lot is priced
 * at the dollar price of the buy it came from (`price_usd`, the rate of its booking day). `null`
 * when a lot has no such buy, so no line is better than a wrong one.
 */
export function costLineUsd(
  position: DepotPosition | undefined,
  trades: readonly DepotTrade[],
): PriceLine | null {
  if (position === undefined || position.quantity <= 0 || position.lots.length === 0) return null
  let cost = 0
  let quantity = 0
  for (const lot of position.lots) {
    const buys = trades.filter(
      (trade) =>
        trade.side === 'buy' &&
        trade.booked_on === lot.acquired_on &&
        trade.price_usd !== null &&
        (trade.quantity ?? 0) > 0,
    )
    const bought = buys.reduce((sum, trade) => sum + (trade.quantity ?? 0), 0)
    if (bought <= 0) return null
    const average =
      buys.reduce((sum, trade) => sum + (trade.quantity ?? 0) * (trade.price_usd ?? 0), 0) / bought
    cost += lot.quantity * average
    quantity += lot.quantity
  }
  if (quantity <= 0) return null
  const perUnit = cost / quantity
  return {
    id: 'cost',
    price: perUnit,
    title: `Average cost $${trimmed(Math.round(perUnit * 100) / 100)}`,
    kind: 'cost',
  }
}

/** The ISINs a watchlist row stands for: its own, or those charted as it (`BTC-USD`). */
export const instrumentsOf = (entry: Pick<WatchlistEntry, 'isin' | 'instruments'>): string[] =>
  entry.instruments.length > 0 ? entry.instruments : [entry.isin]

/** The rows of the watchlist the owner holds: a row counts through any instrument charted as it. */
export function heldRows(
  entries: readonly Pick<WatchlistEntry, 'isin' | 'instruments'>[],
  positions: readonly DepotPosition[],
): Set<string> {
  const owned = new Set(positions.filter((p) => p.quantity > 0).map((p) => p.isin))
  return new Set(
    entries.filter((e) => instrumentsOf(e).some((isin) => owned.has(isin))).map((e) => e.isin),
  )
}

/**
 * The position behind a chart: the one of the instrument, or the sum of those charted as one row. The
 * money adds up; `price` does not and stays empty for a sum.
 */
export function mergedPosition(positions: readonly DepotPosition[]): DepotPosition | undefined {
  const [first, ...rest] = positions
  if (first === undefined || rest.length === 0) return first
  const sum = (pick: (p: DepotPosition) => number): number =>
    positions.reduce((n, p) => n + pick(p), 0)
  const all = (pick: (p: DepotPosition) => number | null): number | null =>
    positions.some((p) => pick(p) === null) ? null : sum((p) => pick(p) ?? 0)
  const unrealised = all((p) => p.unrealised_fifo_cents)
  const cost = sum((p) => p.cost_fifo_cents)
  return {
    ...first,
    name: null,
    quantity: sum((p) => p.quantity),
    price: null,
    price_on: null,
    value_cents: all((p) => p.value_cents),
    cost_fifo_cents: cost,
    cost_average_cents: sum((p) => p.cost_average_cents),
    unrealised_fifo_cents: unrealised,
    unrealised_average_cents: all((p) => p.unrealised_average_cents),
    unrealised_fifo_pct: unrealised === null || cost === 0 ? null : unrealised / cost,
    share: null,
    quantity_source: positions.every((p) => p.quantity_source === first.quantity_source)
      ? first.quantity_source
      : 'mixed',
    lots: positions.flatMap((p) => p.lots),
  }
}

/** A fraction as a signed percent with a real minus sign; `—` when there is none. */
export const signedPercent = (fraction: number | null | undefined): string =>
  fraction === null || fraction === undefined
    ? '—'
    : `${fraction >= 0 ? '+' : '−'}${(Math.abs(fraction) * 100).toFixed(2)} %`

/** A price as the chart reads it: two decimals, four below 1. */
export const priceText = (price: number): string =>
  price.toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(price) < 1 ? 4 : 2,
    maximumFractionDigits: Math.abs(price) < 1 ? 4 : 2,
  })

/** The change of a bar's close against the close before it, as a fraction. */
export function changeOf(bars: readonly ChartBar[], index: number): number | null {
  const bar = bars[index]
  const before = bars[index - 1]
  if (bar === undefined || before === undefined || before.close === 0) return null
  return bar.close / before.close - 1
}

/**
 * The instrument the chart shows: the one the URL names when the watchlist has it, else the first
 * held one, else the first on the watchlist.
 */
export function pickInstrument(
  requested: string,
  watchlist: readonly { isin: string }[],
  held: ReadonlySet<string>,
): string | null {
  const wanted = requested.toUpperCase()
  if (watchlist.some((entry) => entry.isin === wanted)) return wanted
  return watchlist.find((entry) => held.has(entry.isin))?.isin ?? watchlist[0]?.isin ?? null
}

// ---- The drawings document -------------------------------------------------------------------

/**
 * What is stored per instrument. `drawings` is the library's own export (entries it reads),
 * `foreign` the entries it could not read: kept as they came, offered to the library again at every
 * load, written back on every save, never dropped. The server never looks inside.
 */
export type DrawingsDocument = { v: 1; drawings: unknown[]; foreign: unknown[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The entries a stored document holds, in the order to offer them to the library. */
export function storedEntries(stored: unknown): unknown[] {
  if (Array.isArray(stored)) return stored
  if (!isRecord(stored)) return stored === null || stored === undefined ? [] : [stored]
  const drawings = Array.isArray(stored['drawings']) ? stored['drawings'] : null
  const foreign = Array.isArray(stored['foreign']) ? stored['foreign'] : []
  if (drawings === null) return Object.keys(stored).length === 0 ? [] : [stored]
  return [...drawings, ...foreign]
}

const idOf = (entry: unknown): string | null =>
  isRecord(entry) && typeof entry['id'] === 'string' ? entry['id'] : null

/** The entries the library did not take back: no id among the ones it holds now. */
export function unreadEntries(
  entries: readonly unknown[],
  heldIds: ReadonlySet<string>,
): unknown[] {
  return entries.filter((entry) => {
    const id = idOf(entry)
    return id === null || !heldIds.has(id)
  })
}

/** The document to store: what the library exports now plus the entries it never read. */
export function buildDrawingsDocument(
  exported: string,
  foreign: readonly unknown[],
): DrawingsDocument {
  const parsed: unknown = JSON.parse(exported)
  return { v: 1, drawings: Array.isArray(parsed) ? parsed : [], foreign: [...foreign] }
}
