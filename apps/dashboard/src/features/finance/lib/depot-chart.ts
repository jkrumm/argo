import type {
  ChartBar,
  DepotPosition,
  DepotTrade,
  SeriesResponse,
  WatchlistEntry,
} from '../api/types'
import { dayDe, eurDe, moneyDe, percentDe, priceDe, quantityDe, signedEurDe } from './depot-number'

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

/** The service refuses a request of more than 20,000 bars (about 80 years of days); only the overlay card asks for a window. */
const DAILY_MAX_DAYS = 19_990

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
  // Week and month bars are few: they load the whole history.
  if (interval !== '1d') return { to: today }
  const days = range === 'max' ? undefined : RANGE_DAYS[range]
  const span = Math.min(days ?? DAILY_MAX_DAYS, DAILY_MAX_DAYS)
  return { from: isoDay(Date.parse(`${today}T00:00:00Z`) - span * DAY_MS), to: today }
}

/** The first day a range shows, `YYYY-MM-DD`; undefined for the whole stored history. */
export function rangeStart(range: DepotRange, today: string): string | undefined {
  if (range === 'max') return undefined
  return isoDay(Date.parse(`${today}T00:00:00Z`) - RANGE_DAYS[range] * DAY_MS)
}

/** `YYYY-MM-DD` of a day `days` before `day`. */
export const daysBefore = (day: string, days: number): string =>
  isoDay(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS)

/** How old an index level may be and still stand for a day: a holiday gap, not a stale series. */
const MAX_STALE_DAYS = 10

/** One point of the compared index, on a bar time of the chart. */
export type LevelPoint = { time: number; value: number }

/**
 * The compared index as a line on the chart's own bar times: each bar takes the last level on or before its day
 * (an exchange holiday is not an index holiday and the other way round), as long as that level is at most ten
 * days old. A line on bar times keeps week and month charts evenly spaced. `points` ascend by day.
 */
export function levelsAtBars(
  bars: readonly { time: number }[],
  points: SeriesResponse['points'],
): LevelPoint[] {
  const out: LevelPoint[] = []
  let at = -1
  for (const bar of bars) {
    const day = isoDay(bar.time * 1000)
    while (points[at + 1] !== undefined && (points[at + 1]?.day ?? '') <= day) at++
    const level = points[at]
    if (level === undefined || level.day < daysBefore(day, MAX_STALE_DAYS)) continue
    out.push({ time: bar.time, value: level.value })
  }
  return out
}

/** How a comparison reads over the visible range: each side's change from its first visible value to the newest. */
export type RangeChange = { own: number | null; other: number | null }

/** The change of a series over the points from `from` on, as a fraction; null with fewer than two points or a zero start. */
export function changeFrom(
  points: readonly { time: number; value: number }[],
  from: number,
): number | null {
  const visible = points.filter((point) => point.time >= from)
  const first = visible[0]
  const last = visible.at(-1)
  if (first === undefined || last === undefined || visible.length < 2 || first.value === 0) {
    return null
  }
  return last.value / first.value - 1
}

/** The highest price of an instrument's own history and the day it was reached. */
export type AllTimeHigh = { price: number; time: number }

/** The all-time high of the day bars' highs, own bars only (a spliced index does not count); the first day it was reached. */
export function allTimeHigh(bars: readonly ChartBar[]): AllTimeHigh | null {
  let best: AllTimeHigh | null = null
  for (const bar of bars) {
    if (bar.source === 'index') continue
    if (best === null || bar.high > best.price) best = { price: bar.high, time: bar.time }
  }
  return best
}

/** The distance of the last close from the all-time high, as a fraction (negative below it). */
export const distanceFromHigh = (close: number, high: number): number | null =>
  high > 0 ? close / high - 1 : null

// ---- Timeframes, the spliced history, defaults ---------------------------------------------------

/** The buttons under the chart: they only set the visible range, the whole history is loaded. */
export const TIMEFRAMES = ['1M', '3M', '6M', '1Y', '5Y', 'Max'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

const TIMEFRAME_DAYS: Record<Exclude<Timeframe, 'Max'>, number> = {
  '1M': 31,
  '3M': 92,
  '6M': 183,
  '1Y': 366,
  '5Y': 1827,
}

/** Calendar days one bar of an interval stands for, on average (a day bar skips the weekend). */
const BAR_DAYS: Record<DepotInterval, number> = { '1d': 7 / 5, '1w': 7, '1mo': 30.5 }

/** Bars a week or month chart opens on: as many as a trading year of day bars, so the candles are as wide. */
const DEFAULT_VIEW_BARS = 252

/** The first day (epoch seconds) a timeframe shows, counted back from the newest bar; null is the whole history. */
export function timeframeStart(timeframe: Timeframe, lastTime: number): number | null {
  return timeframe === 'Max' ? null : lastTime - TIMEFRAME_DAYS[timeframe] * DAY_S
}

/** Whether a timeframe holds enough bars at this interval to draw (one month of week bars is four). */
export const timeframeFits = (timeframe: Timeframe, interval: DepotInterval): boolean =>
  timeframe === 'Max' || TIMEFRAME_DAYS[timeframe] / BAR_DAYS[interval] >= 6

/** The first day the chart opens on: the last year of day bars, else a year's worth of bars. */
export function defaultViewStart(
  bars: readonly { time: number }[],
  interval: DepotInterval,
): number | null {
  const last = bars.at(-1)
  if (last === undefined) return null
  if (interval === '1d') return timeframeStart('1Y', last.time)
  return bars[Math.max(0, bars.length - 1 - DEFAULT_VIEW_BARS)]?.time ?? null
}

/** Index of the first bar at or after `time` (the length when none is); `null` is the first bar. */
export function firstBarFrom(bars: readonly { time: number }[], time: number | null): number {
  if (time === null) return 0
  const at = bars.findIndex((bar) => bar.time >= time)
  return at < 0 ? bars.length : at
}

/** Which button the visible range matches, within a tenth: it reads the chart, so a zoom clears it. */
export function activeTimeframe(
  from: number | null,
  last: number,
  first: number,
): Timeframe | null {
  if (from === null || from <= first) return 'Max'
  const days = (last - from) / DAY_S
  for (const timeframe of TIMEFRAMES) {
    if (timeframe === 'Max') continue
    if (Math.abs(days / TIMEFRAME_DAYS[timeframe] - 1) <= 0.1) return timeframe
  }
  return null
}

/** The bars of the instrument itself and the ones the tracked index stands in for before its first. */
export function splitSpliced(bars: readonly ChartBar[]): { own: ChartBar[]; spliced: ChartBar[] } {
  const own: ChartBar[] = []
  const spliced: ChartBar[] = []
  for (const bar of bars) (bar.source === 'index' ? spliced : own).push(bar)
  return { own, spliced }
}

/** One candle as the chart takes it; the colours override the series' own for that bar. */
export type HistoryCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  color?: string
  borderColor?: string
  wickColor?: string
}

/**
 * The whole history as ONE series: the spliced index bars wear the muted colours, the instrument's own bars the
 * series' colours. One series means one percent base (its first visible bar), so a comparison reads the splice
 * seamlessly: two series would each start at 0 % on their own first bar and the ETF would jump back at the launch.
 */
export function historyCandles(
  bars: readonly ChartBar[],
  muted: { up: string; down: string },
): HistoryCandle[] {
  return bars.map((bar) => {
    const candle = {
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }
    if (bar.source !== 'index') return candle
    const color = bar.close >= bar.open ? muted.up : muted.down
    return { ...candle, color, borderColor: color, wickColor: color }
  })
}

/** The share of the visible width left empty right of the newest bar. */
export const RIGHT_MARGIN = 0.05

/** How many (fractional) empty bars right of the newest one make the margin `RIGHT_MARGIN` of the visible width for `visible` bars. */
export const rightMarginBars = (visible: number): number =>
  (visible * RIGHT_MARGIN) / (1 - RIGHT_MARGIN)

/** The day the instrument's own history starts, when an index fills the time before it. */
export function launchTime(bars: readonly ChartBar[]): number | null {
  const { own, spliced } = splitSpliced(bars)
  return spliced.length === 0 ? null : (own[0]?.time ?? null)
}

/** Whether any bar traded: an index, a coin on some feeds and a spliced history carry no turnover. */
export const hasTurnover = (bars: readonly ChartBar[]): boolean =>
  bars.some((bar) => (bar.turnover ?? 0) > 0)

/** The turnover pane is on by default where the instrument has turnover and is not a coin or an index. */
export const volumeByDefault = (kind: string | null, bars: readonly ChartBar[]): boolean =>
  kind !== 'coin' && kind !== 'index' && hasTurnover(bars)

/** A coin runs through orders of magnitude: its chart opens logarithmic. */
export const logByDefault = (kind: string | null): boolean => kind === 'coin'

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
  /** The price the marker sits at, where it does not sit above or below its bar (an ETF's trade on its index). */
  level?: number | undefined
}

/** Every trade that has a bar on this chart, oldest first; `levelOf` places a marker at a price of the chart. */
export function tradeMarks(
  trades: readonly DepotTrade[],
  bars: readonly ChartBar[],
  interval: DepotInterval,
  levelOf?: (trade: DepotTrade) => number | undefined,
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
      ...(levelOf !== undefined && { level: levelOf(trade) }),
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
  /** The mean of the trades' levels; absent for a marker above or below its bar. */
  level?: number
}

/** The markers to draw, oldest first: one per bar and side. */
export function markGroups(marks: readonly TradeMark[]): MarkGroup[] {
  const groups = new Map<string, TradeMark[]>()
  for (const mark of marks) {
    const key = `${mark.time}:${mark.side}`
    groups.set(key, [...(groups.get(key) ?? []), mark])
  }
  return [...groups.values()]
    .flatMap((group): MarkGroup[] => {
      const [first] = group
      if (first === undefined) return []
      const levels = group.flatMap((mark) => (mark.level === undefined ? [] : [mark.level]))
      return [
        {
          time: first.time,
          side: first.side,
          count: group.length,
          estimated: group.every((mark) => mark.estimated),
          ...(levels.length > 0 && { level: levels.reduce((a, b) => a + b, 0) / levels.length }),
        },
      ]
    })
    .toSorted((a, b) => a.time - b.time)
}

const quantityOf = quantityDe

/** One line of a trade card: a caption, its value and, where the figure is good or bad news, its tone. */
export type TradeCardRow = { label: string; value: string; tone?: 'good' | 'bad' }

/** What the trade tooltip shows for one trade: the side and day as the title, then the figures. */
export type TradeCard = {
  id: number
  side: DepotTrade['side']
  title: string
  rows: TradeCardRow[]
}

/** The most trades a card lists; a savings plan has one a week, a bar of months can hold dozens. */
export const CARD_LIMIT = 4

/**
 * The tooltip cards of the trades on one bar, oldest first: date, side, units (≈ when estimated),
 * price (the dollar price on a dollar chart too), amount, fee and, for a sale, the realised gain.
 */
export function tradeCards(marks: readonly TradeMark[], usd: boolean, named = false): TradeCard[] {
  return marks.map((mark) => {
    const { trade } = mark
    const rows: TradeCardRow[] = [
      ...(named ? [{ label: 'Instrument', value: trade.name ?? trade.isin }] : []),
      {
        label: 'Units',
        value:
          trade.quantity === null
            ? 'unknown'
            : `${mark.estimated ? '≈ ' : ''}${quantityOf(trade.quantity)}`,
      },
      { label: 'Price', value: trade.price === null ? '—' : `${priceText(trade.price)} €` },
      ...(usd && trade.price_usd !== null
        ? [{ label: 'Price (USD)', value: `${priceText(trade.price_usd)} $` }]
        : []),
      { label: 'Amount', value: eurDe(trade.amount_cents, true) },
      ...(trade.fee_cents === null ? [] : [{ label: 'Fee', value: eurDe(trade.fee_cents, true) }]),
      ...(trade.side === 'sell' && trade.realised_fifo_cents !== null
        ? [
            {
              label: 'Realised gain',
              value: signedEurDe(trade.realised_fifo_cents),
              tone: trade.realised_fifo_cents >= 0 ? ('good' as const) : ('bad' as const),
            },
          ]
        : []),
      ...(mark.estimated ? [{ label: 'Note', value: 'quantity is an estimate' }] : []),
    ]
    return {
      id: trade.id,
      side: trade.side,
      title: `${trade.side === 'buy' ? 'Bought' : 'Sold'} · ${dayDe(dayToSeconds(trade.booked_on))}`,
      rows,
    }
  })
}

/** A horizontal line on the chart: an open order at its limit or stop, the average cost, or the live bid or ask. */
export type PriceLine = {
  id: string
  price: number
  title: string
  kind: 'order-buy' | 'order-sell' | 'cost' | 'bid' | 'ask'
}

/** The average cost of an open position per unit, in the instrument's currency (EUR). */
export function costLine(position: DepotPosition | undefined): PriceLine | null {
  if (position === undefined || position.quantity <= 0) return null
  const perUnit = position.cost_average_cents / 100 / position.quantity
  return {
    id: 'cost',
    price: perUnit,
    title: `Average cost ${moneyDe(perUnit, 'EUR')}`,
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
    title: `Average cost ${moneyDe(perUnit, 'USD')}`,
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

/** A fraction as a signed percent with a real minus sign: `+5,1 %`, `−18,3 %`; `—` when there is none. */
export const signedPercent = (fraction: number | null | undefined): string =>
  fraction === null || fraction === undefined ? '—' : percentDe(fraction, true)

/** A price as the chart reads it: by magnitude, German grouping and decimals. */
export const priceText = priceDe

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
export type DrawingsDocument = {
  v: 1
  drawings: unknown[]
  foreign: unknown[]
  /** The colour a line was drawn in, by drawing id; a drawing without one is the accent. */
  roles: Record<string, ColorRole>
}

/** What a drawing's colour means: the accent, a buy level (green) or a sell level or resistance (red). */
export type ColorRole = 'accent' | 'buy' | 'sell'

const isRole = (value: unknown): value is ColorRole =>
  value === 'accent' || value === 'buy' || value === 'sell'

/** The colour roles a stored document holds; an unknown value is dropped. */
export function storedRoles(stored: unknown): Record<string, ColorRole> {
  const roles = isRecord(stored) && isRecord(stored['roles']) ? stored['roles'] : {}
  return Object.fromEntries(
    Object.entries(roles).filter((entry): entry is [string, ColorRole] => isRole(entry[1])),
  )
}

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

/** The document to store: what the library exports now, the entries it never read and the colour of each drawing. */
export function buildDrawingsDocument(
  exported: string,
  foreign: readonly unknown[],
  roles: Readonly<Record<string, ColorRole>> = {},
): DrawingsDocument {
  const parsed: unknown = JSON.parse(exported)
  const drawings = Array.isArray(parsed) ? parsed : []
  // A colour outlives the library not reading its drawing for a while: foreign entries keep theirs.
  const ids = new Set([...drawings, ...foreign].map(idOf))
  return {
    v: 1,
    drawings,
    foreign: [...foreign],
    roles: Object.fromEntries(Object.entries(roles).filter(([id]) => ids.has(id))),
  }
}
