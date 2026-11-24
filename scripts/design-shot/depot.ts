/**
 * Synthetic shots of /finance/depot: `bun scripts/design-shot/depot.ts [--out <dir>]`.
 *
 * Serves the built dashboard (`apps/dashboard/dist`) on a loopback port together with an in-memory
 * stand-in for `fin serve`: an unlocked vault, a watchlist with seeded random-walk candles (a world
 * ETF with a 16-month savings plan and partial sells, a semiconductor ETF, a US stock on its dollar
 * listing, Bitcoin in dollars with a euro ETP charted as it), the positions and trades of those, open
 * orders and drawing documents that the page's writes change. Nothing leaves the machine and no real
 * data is involved, so these shots may be attached to a ship. It then drives Chrome through light/dark
 * x desktop (1440) / mobile (390): the chart is checked for candles, the visible range at the timeframes,
 * the distance between bars at day, week and month, and horizontal overflow; lines are drawn (a red one with
 * a label set to a typed price, a green one with a label, a vertical one) and a price range drawn with the
 * mouse; Bitcoin is read from 2011 on a log scale without turnover; a fund's history opens with its index and
 * a launch marker; "Compare with…" turns the scale to percent (6M and 1Y read differently, the chip's x removes it);
 * the toolbar's tooltips, the line editor and the pointer coming back after one drawing, the all-time high in the header, the
 * US stock's hand-kept sell order on its dollar chart; an instrument is searched, added to a list,
 * renamed and removed; a trade card is pinned; and PNGs per combination are written (default
 * `.design-shots/depot`).
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'

const ROOT = resolve(import.meta.dirname, '../..')
const DIST = join(ROOT, 'apps/dashboard/dist')
const DAY_S = 86_400

// ---- Synthetic market ---------------------------------------------------------------------

type Bar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  units: number | null
  turnover: number | null
  /** Flat bars of the tracked index before a fund's first bar. */
  source?: 'index'
}
type Instrument = {
  isin: string
  name: string
  kind: string
  start: number
  drift: number
  vol: number
  /** The currency of the bars; the watchlist row says it. */
  currency?: string
  /** The MIC of the US listing a stored dollar series belongs to. */
  usMic?: string
  /** The ISINs charted as this row (`--chart-as`). */
  chartedAs?: string[]
  /** How many calendar days of bars it has; a fund that launched recently has few. Default 1800. */
  days?: number
  /** The series id of the index an ETF tracks: its history can be asked for with that index in front. */
  index?: string
  /** On no list and not held: only the search finds it. */
  unlisted?: boolean
}

const RATE = 1.08 // synthetic USD per EUR
const US_STOCK = 'US0000000001'
const BTC_ETP = 'XX0000000005'
const ALL_CAP = 'XX0000000006'
const EM_ETF = 'XX0000000007'
const ENERGY_ETF = 'XX0000000008'
const FTSE = 'ftse-global-all-cap-usd'

const INSTRUMENTS: Instrument[] = [
  {
    isin: 'XX0000000001',
    name: 'World equity ETF',
    kind: 'etf',
    start: 68,
    drift: 0.0004,
    vol: 0.009,
  },
  {
    isin: 'XX0000000002',
    name: 'Semiconductor ETF',
    kind: 'etf',
    start: 7.4,
    drift: 0.0007,
    vol: 0.016,
  },
  {
    // A global all-cap fund launched about four months ago: its history is short, its index is old.
    isin: ALL_CAP,
    name: 'Global all-cap ETF',
    kind: 'etf',
    start: 100,
    drift: 0.0005,
    vol: 0.008,
    days: 100,
    index: FTSE,
  },
  {
    isin: EM_ETF,
    name: 'Emerging markets ETF',
    kind: 'etf',
    start: 28,
    drift: 0.0003,
    vol: 0.011,
    days: 900,
    unlisted: true,
  },
  {
    isin: ENERGY_ETF,
    name: 'Clean energy ETF',
    kind: 'etf',
    start: 9,
    drift: 0.0001,
    vol: 0.014,
    days: 900,
    unlisted: true,
  },
  { isin: 'XX0000000003', name: 'Dividend ETF', kind: 'etf', start: 31, drift: 0.0002, vol: 0.007 },
  {
    isin: 'XX0000000004',
    name: 'Euro bond ETF',
    kind: 'etf',
    start: 112,
    drift: 0.00005,
    vol: 0.003,
  },
  {
    isin: US_STOCK,
    name: 'US chip stock',
    kind: 'stock',
    start: 105,
    drift: 0.0009,
    vol: 0.02,
    usMic: 'XNAS',
  },
  {
    isin: 'BTC-USD',
    name: 'Bitcoin',
    kind: 'coin',
    // Daily bars from September 2011 (about 5,500 days): five dollars to tens of thousands, so the log scale earns its place.
    start: 5,
    drift: 0.0017,
    vol: 0.028,
    days: Math.round(
      (Math.floor(Date.now() / 1000 / DAY_S) * DAY_S - Date.UTC(2011, 8, 13) / 1000) / DAY_S,
    ),
    currency: 'USD',
    chartedAs: [BTC_ETP],
  },
]

/** The names of what the depot holds, charted or not. */
const NAMES = new Map<string, string>([
  ...INSTRUMENTS.map((i): [string, string] => [i.isin, i.name]),
  [BTC_ETP, 'Bitcoin ETP'],
])

/** Every series the stand-in draws: the rows, and the dollar listing of the US stock. */
const SERIES: Instrument[] = [
  ...INSTRUMENTS,
  {
    isin: `${US_STOCK}:XNAS`,
    name: 'US chip stock (USD)',
    kind: 'stock',
    start: 114,
    drift: 0.0009,
    vol: 0.02,
  },
]

/** A seeded generator, so every run draws the same market. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const dayOf = (time: number): string => new Date(time * 1000).toISOString().slice(0, 10)
const midnight = (ms: number): number => Math.floor(ms / 1000 / DAY_S) * DAY_S
const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places

function dailyBars(instrument: Instrument, seed: number): Bar[] {
  const random = rng(seed)
  const today = midnight(Date.now())
  const days: number[] = []
  for (let t = today - (instrument.days ?? 1800) * DAY_S; t <= today; t += DAY_S) {
    const weekday = new Date(t * 1000).getUTCDay()
    if (instrument.kind === 'coin' || (weekday !== 0 && weekday !== 6)) days.push(t)
  }
  let price = instrument.start
  return days.map((time) => {
    const open = price
    const move = instrument.drift + (random() - 0.5) * 2 * instrument.vol
    const close = open * (1 + move)
    const high = Math.max(open, close) * (1 + random() * instrument.vol * 0.5)
    const low = Math.min(open, close) * (1 - random() * instrument.vol * 0.5)
    price = close
    const units = Math.round(20_000 + random() * 80_000)
    return {
      time,
      open: round(open, 4),
      high: round(high, 4),
      low: round(low, 4),
      close: round(close, 4),
      units,
      turnover: Math.round(units * close),
    }
  })
}

const DAILY = new Map(SERIES.map((i, n) => [i.isin, dailyBars(i, 1000 + n)]))

// ---- Synthetic long-run index series -----------------------------------------------------------

type IndexRow = {
  id: string
  title: string
  first: string
  start: number
  drift: number
  vol: number
}

/** The stored MSCI series of the market store (net return, euros), with the day each one starts on; the ECB rate is one too. */
const INDEX_ROWS: IndexRow[] = [
  // USD per EUR: the page converts a euro order of a dollar-charted stock with its latest value.
  {
    id: 'eur-usd',
    title: 'ECB EUR/USD reference rate',
    first: '1999-01-04',
    start: 1.1,
    drift: 0,
    vol: 0.0012,
  },
  {
    id: 'msci-acwi-imi-net-eur',
    title: 'MSCI ACWI IMI, net, EUR',
    first: '1998-12-31',
    start: 100,
    drift: 0.00032,
    vol: 0.0095,
  },
  {
    id: 'msci-world-net-eur',
    title: 'MSCI World, net, EUR',
    first: '1998-12-31',
    start: 100,
    drift: 0.00033,
    vol: 0.0095,
  },
  {
    id: 'msci-em-net-eur',
    title: 'MSCI Emerging Markets, net, EUR',
    first: '2000-12-29',
    start: 100,
    drift: 0.00036,
    vol: 0.011,
  },
  {
    id: 'msci-world-small-cap-net-eur',
    title: 'MSCI World Small Cap, net, EUR',
    first: '2000-12-29',
    start: 100,
    drift: 0.00038,
    vol: 0.01,
  },
  {
    id: 'msci-europe-net-eur',
    title: 'MSCI Europe, net, EUR',
    first: '1998-12-31',
    start: 100,
    drift: 0.00026,
    vol: 0.0105,
  },
  // The index a young global all-cap fund tracks (USD): a fund's history can be asked for with it in front.
  {
    id: FTSE,
    title: 'FTSE Global All Cap, USD',
    first: '2013-03-01',
    start: 1000,
    drift: 0.00035,
    vol: 0.0095,
  },
]

type Level = { day: string; time: number; value: number }

function indexLevels(row: IndexRow, seed: number): Level[] {
  const random = rng(seed)
  const today = midnight(Date.now())
  const levels: Level[] = []
  let value = row.start
  for (let t = Date.parse(`${row.first}T00:00:00Z`) / 1000; t <= today; t += DAY_S) {
    const weekday = new Date(t * 1000).getUTCDay()
    if (weekday === 0 || weekday === 6) continue
    value *= 1 + row.drift + (random() - 0.5) * 2 * row.vol
    levels.push({ day: dayOf(t), time: t, value: round(value, 2) })
  }
  return levels
}

const INDEX_LEVELS = new Map(INDEX_ROWS.map((row, n) => [row.id, indexLevels(row, 7000 + n)]))

function aggregate(bars: Bar[], keyOf: (time: number) => number): Bar[] {
  const groups = new Map<number, Bar[]>()
  for (const bar of bars) groups.set(keyOf(bar.time), [...(groups.get(keyOf(bar.time)) ?? []), bar])
  return [...groups.entries()].map(([time, group]) => ({
    time,
    open: group[0]!.open,
    high: Math.max(...group.map((b) => b.high)),
    low: Math.min(...group.map((b) => b.low)),
    close: group.at(-1)!.close,
    units: group.some((b) => b.units === null)
      ? null
      : group.reduce((n, b) => n + (b.units ?? 0), 0),
    turnover: group.some((b) => b.turnover === null)
      ? null
      : group.reduce((n, b) => n + (b.turnover ?? 0), 0),
    // A bar is an index bar when every day in it is one.
    ...(group.every((b) => b.source === 'index') && { source: 'index' as const }),
  }))
}

const weekStart = (time: number): number => {
  const weekday = (new Date(time * 1000).getUTCDay() + 6) % 7
  return time - weekday * DAY_S
}
const monthStart = (time: number): number => {
  const d = new Date(time * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
}

/**
 * The daily bars of a fund with the index it tracks in front of its first bar: flat bars (open = high =
 * low = close, no turnover) scaled so the last level before the fund's first day equals its first close.
 */
function splicedDaily(isin: string): Bar[] {
  const own = DAILY.get(isin) ?? []
  const first = own[0]
  const series = INSTRUMENTS.find((i) => i.isin === isin)?.index
  const levels = series === undefined ? [] : (INDEX_LEVELS.get(series) ?? [])
  const before = first === undefined ? [] : levels.filter((l) => l.time < first.time)
  const anchor = before.at(-1)
  if (first === undefined || anchor === undefined) return own
  const scale = first.close / anchor.value
  const flat = before.map((l): Bar => {
    const level = round(l.value * scale, 4)
    return {
      time: l.time,
      open: level,
      high: level,
      low: level,
      close: level,
      units: null,
      turnover: null,
      source: 'index',
    }
  })
  return [...flat, ...own]
}

function candles(
  isin: string,
  interval: string,
  from: string | null,
  to: string | null,
  splice = false,
): Bar[] {
  const daily = splice ? splicedDaily(isin) : (DAILY.get(isin) ?? [])
  const all =
    interval === '1w'
      ? aggregate(daily, weekStart)
      : interval === '1mo'
        ? aggregate(daily, monthStart)
        : daily
  const lo = from === null ? 0 : Date.parse(`${from}T00:00:00Z`) / 1000
  const hi = to === null ? Infinity : Date.parse(`${to}T00:00:00Z`) / 1000 + DAY_S
  return all.filter((b) => b.time >= lo && b.time < hi)
}

// ---- Synthetic depot ----------------------------------------------------------------------

const closeOn = (key: string, day: string): number =>
  (DAILY.get(key) ?? []).findLast((b) => b.time <= Date.parse(`${day}T00:00:00Z`) / 1000)?.close ??
  0

const WORLD = 'XX0000000001'
const SEMIS = 'XX0000000002'

/** The dollar series a held instrument is charted on, when it is charted in dollars. */
const dollarSeries = (isin: string): string | null =>
  isin === BTC_ETP ? 'BTC-USD' : isin === US_STOCK ? `${US_STOCK}:XNAS` : null
const usdOn = (isin: string, day: string): number | null => {
  const key = dollarSeries(isin)
  return key === null ? null : closeOn(key, day)
}
/** The euro price of a held instrument: the dollar listing at the synthetic rate, else its own bars. */
const priceOn = (isin: string, day: string): number => {
  const usd = usdOn(isin, day)
  return usd === null ? closeOn(isin, day) : round(usd / RATE, 4)
}

type Trade = {
  id: number
  isin: string
  side: 'buy' | 'sell'
  daysAgo: number
  quantity: number
  source: 'document' | 'derived' | 'estimated'
}

/**
 * The depot of the stand-in: a world ETF bought by a monthly savings plan for 16 months (one buy
 * estimated, one top-up and one sell in the week of a plan buy) with four partial sells, a
 * semiconductor ETF, one US stock buy, and a Bitcoin ETP in euros that is charted as BTC-USD.
 */
function buildTrades(): Trade[] {
  const made: Omit<Trade, 'id'>[] = []
  const dayAgo = (n: number): string => dayOf(midnight(Date.now()) - n * DAY_S)
  for (let k = 0; k < 16; k++) {
    const daysAgo = 12 + 30 * k
    made.push({
      isin: WORLD,
      side: 'buy',
      daysAgo,
      quantity: round(150 / closeOn(WORLD, dayAgo(daysAgo)), 4),
      source: k === 9 ? 'estimated' : 'derived',
    })
  }
  made.push(
    { isin: WORLD, side: 'buy', daysAgo: 12 + 30 * 5 + 2, quantity: 1, source: 'document' },
    { isin: WORLD, side: 'sell', daysAgo: 12 + 30 * 5 - 2, quantity: 1, source: 'document' },
  )
  for (const [daysAgo, quantity] of [
    [100, 1.5],
    [190, 2],
    [280, 1],
    [370, 2.5],
  ] as const) {
    made.push({ isin: WORLD, side: 'sell', daysAgo, quantity, source: 'document' })
  }
  made.push(
    { isin: SEMIS, side: 'buy', daysAgo: 250, quantity: 90, source: 'document' },
    { isin: SEMIS, side: 'buy', daysAgo: 60, quantity: 40, source: 'document' },
    { isin: US_STOCK, side: 'buy', daysAgo: 40, quantity: 3, source: 'document' },
  )
  for (const [daysAgo, quantity] of [
    [200, 0.02],
    [171, 0.03],
    [140, 0.025],
    [52, 0.04],
    [50, 0.02],
  ] as const) {
    made.push({ isin: BTC_ETP, side: 'buy', daysAgo, quantity, source: 'document' })
  }
  made.push({ isin: BTC_ETP, side: 'sell', daysAgo: 20, quantity: 0.01, source: 'document' })
  return made.toSorted((a, b) => b.daysAgo - a.daysAgo).map((t, n) => ({ ...t, id: n + 1 }))
}

type Lot = { acquired_on: string; quantity: number; cost_cents: number }

/** The trades as the service reads them, and the lots each instrument still holds (FIFO). */
function buildDepot() {
  const lots = new Map<string, Lot[]>()
  const rows = buildTrades().map((t) => {
    const day = dayOf(midnight(Date.now()) - t.daysAgo * DAY_S)
    const price = priceOn(t.isin, day)
    const amount = Math.round(price * t.quantity * 100)
    const held = lots.get(t.isin) ?? []
    let realised: number | null = null
    if (t.side === 'buy') held.push({ acquired_on: day, quantity: t.quantity, cost_cents: amount })
    else {
      let left = t.quantity
      let cost = 0
      while (left > 1e-9 && held[0] !== undefined) {
        const lot = held[0]
        const take = Math.min(left, lot.quantity)
        const part = Math.round((lot.cost_cents * take) / lot.quantity)
        cost += part
        left -= take
        lot.quantity = round(lot.quantity - take, 4)
        lot.cost_cents -= part
        if (lot.quantity <= 1e-9) held.shift()
      }
      realised = amount - cost
    }
    lots.set(t.isin, held)
    const usd = usdOn(t.isin, day)
    return {
      id: t.id,
      account_id: 'depot',
      isin: t.isin,
      name: NAMES.get(t.isin) ?? null,
      side: t.side,
      booked_on: day,
      amount_cents: amount,
      settlement_ref: `ref-${t.id}`,
      transaction_id: null,
      quantity: t.quantity,
      quantity_source: t.source,
      price,
      fee_cents: 100,
      tax_cents: null,
      costs_source: 'document',
      reading: null,
      note: null,
      updated_at: day,
      realised_fifo_cents: realised,
      price_usd: usd === null ? null : round(usd, 2),
    }
  })
  return { rows, lots }
}
const DEPOT = buildDepot()

/** `isin` may be a row that other instruments are charted as: then it is theirs. */
function tradeRows(isin: string | null) {
  const wanted =
    isin === null ? null : (INSTRUMENTS.find((i) => i.isin === isin)?.chartedAs ?? [isin])
  return DEPOT.rows.filter((t) => wanted === null || wanted.includes(t.isin))
}

function position(isin: string) {
  const lots = DEPOT.lots.get(isin) ?? []
  const quantity = round(
    lots.reduce((n, lot) => n + lot.quantity, 0),
    4,
  )
  const costFifo = lots.reduce((n, lot) => n + lot.cost_cents, 0)
  const last = DAILY.get(dollarSeries(isin) ?? isin)?.at(-1)
  const price = last === undefined ? 0 : priceOn(isin, dayOf(last.time))
  const value = Math.round(price * quantity * 100)
  return {
    isin,
    name: NAMES.get(isin) ?? null,
    quantity,
    price,
    price_on: last === undefined ? null : dayOf(last.time),
    value_cents: value,
    cost_fifo_cents: costFifo,
    cost_average_cents: costFifo,
    unrealised_fifo_cents: value - costFifo,
    unrealised_average_cents: value - costFifo,
    unrealised_fifo_pct: costFifo === 0 ? null : (value - costFifo) / costFifo,
    share: null,
    quantity_source: 'mixed',
    lots,
  }
}

type Order = {
  id: number
  account_id: null
  isin: string
  name: string | null
  side: 'buy' | 'sell'
  type: 'limit' | 'stop' | 'market'
  limit_price: number | null
  stop_price: number | null
  quantity: number
  valid_until: string | null
  status: 'open' | 'executed' | 'cancelled' | 'expired'
  note: string | null
  opened_at: string
  closed_at: string | null
  overdue: boolean
}
const orders: Order[] = []
let nextOrder = 1

/** The hand-kept sell order of the US stock: a limit about 15 % above its last euro close. */
function seedOrders(): void {
  const last = DAILY.get(US_STOCK)?.at(-1)?.close ?? 100
  orders.push({
    id: nextOrder++,
    account_id: null,
    isin: US_STOCK,
    name: NAMES.get(US_STOCK) ?? null,
    side: 'sell',
    type: 'limit',
    limit_price: Math.round(last * 1.15),
    stop_price: null,
    quantity: 10,
    valid_until: null,
    status: 'open',
    note: null,
    opened_at: new Date().toISOString(),
    closed_at: null,
    overdue: false,
  })
}
seedOrders()
const drawings = new Map<string, { isin: string; document: unknown; updated_at: string }>()

// ---- The lists of the stand-in -------------------------------------------------------------

type ListEntry = { symbol: string; display_name: string | null; position: number; added_at: string }
type List = {
  id: number
  name: string
  position: number
  is_default: boolean
  entries: ListEntry[]
}

const HELD = new Set([WORLD, SEMIS, US_STOCK, 'BTC-USD'])

const entryOf = (symbol: string, position: number): ListEntry => ({
  symbol,
  display_name: null,
  position,
  added_at: '2026-11-01T08:00:00Z',
})

/** The default list holds the funds, a second one the chips; every instrument on either is in the sync set. */
const freshLists = (): List[] => [
  {
    id: 1,
    name: 'Watchlist',
    position: 0,
    is_default: true,
    entries: [WORLD, SEMIS, ALL_CAP, 'XX0000000003', 'XX0000000004', US_STOCK].map(entryOf),
  },
  { id: 2, name: 'Chips', position: 1, is_default: false, entries: [SEMIS, US_STOCK].map(entryOf) },
]
let lists = freshLists()
let nextList = 3

const rowOf = (i: Instrument) => {
  const bars = DAILY.get(i.isin) ?? []
  const last = bars.at(-1)!
  const before = bars.at(-2)!
  return {
    isin: i.isin,
    name: i.name,
    kind: i.kind,
    currency: i.currency ?? 'EUR',
    last_close: last.close,
    last_day: dayOf(last.time),
    first_day: dayOf(bars[0]!.time),
    day_change: round(last.close - before.close, 4),
    day_change_pct: last.close / before.close - 1,
    us_mic: i.usMic ?? null,
    instruments: i.chartedAs ?? [i.isin],
    chart_as: null,
    index: i.index ?? null,
  }
}

/** A stored series as a list entry's quote: its last two levels. */
function seriesRow(id: string) {
  const row = INDEX_ROWS.find((r) => r.id === id)!
  const levels = INDEX_LEVELS.get(id) ?? []
  const last = levels.at(-1)!
  const before = levels.at(-2)!
  return {
    isin: id,
    name: row.title,
    kind: 'index',
    currency: null,
    last_close: last.value,
    last_day: last.day,
    first_day: levels[0]?.day ?? null,
    day_change: round(last.value - before.value, 4),
    day_change_pct: last.value / before.value - 1,
    us_mic: null,
    instruments: [id],
    chart_as: null,
    index: null,
  }
}

const quoteOf = (symbol: string) => {
  const instrument = INSTRUMENTS.find((i) => i.isin === symbol)
  return instrument === undefined ? seriesRow(symbol) : rowOf(instrument)
}

const listJson = (list: List) => ({
  ...list,
  entries: list.entries.map((e) => ({ ...e, quote: quoteOf(e.symbol) })),
})

/** The sync set: everything on a list plus what the depot holds. */
const onSomeList = (isin: string): boolean =>
  HELD.has(isin) || lists.some((l) => l.entries.some((e) => e.symbol === isin))

const SEARCHABLE = [
  ...INSTRUMENTS.map((i) => ({
    kind: i.kind === 'coin' ? 'coin' : 'instrument',
    symbol: i.isin,
    name: i.name,
  })),
  ...INDEX_ROWS.map((r) => ({ kind: 'series', symbol: r.id, name: r.title })),
]

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, '')
  const q = url.searchParams
  if (path === '/__reset') {
    orders.length = 0
    nextOrder = 1
    seedOrders()
    drawings.clear()
    lists = freshLists()
    nextList = 3
    return json({ ok: true })
  }
  if (path === '/finance/status') {
    return json({
      locked: false,
      unlocked_at: new Date().toISOString(),
      idle_lock_at: new Date(Date.now() + 3_600_000).toISOString(),
      syncing: false,
      last_sync: null,
    })
  }
  if (path === '/finance/sync-runs') return json([])
  const rest = path.replace(/^\/finance\/api/, '')
  if (rest === path) return json({ error: 'not found' }, 404)
  if (req.method === 'GET') {
    if (rest === '/market/watchlist') {
      return json(INSTRUMENTS.filter((i) => onSomeList(i.isin)).map(rowOf))
    }
    if (rest === '/market/lists') return json(lists.map(listJson))
    if (rest === '/market/search') {
      const term = (q.get('q') ?? '').toLowerCase()
      return json(
        SEARCHABLE.filter(
          (s) => s.name.toLowerCase().includes(term) || s.symbol.toLowerCase().includes(term),
        ).map((s) => ({ ...s, wkn: null, ticker: null, detail: null })),
      )
    }
    if (rest === '/market/series') {
      const id = q.get('id')
      if (id === null) {
        return json(
          INDEX_ROWS.map((row) => {
            const levels = INDEX_LEVELS.get(row.id) ?? []
            return {
              id: row.id,
              title: row.title,
              unit: 'index points',
              frequency: 'daily',
              first_day: levels[0]?.day ?? null,
              last_day: levels.at(-1)?.day ?? null,
              points: levels.length,
            }
          }),
        )
      }
      const row = INDEX_ROWS.find((r) => r.id === id)
      if (row === undefined) return json({ error: `unknown series ${id}` }, 400)
      const from = q.get('from') ?? '0000-00-00'
      const to = q.get('to') ?? '9999-99-99'
      return json({
        id,
        title: row.title,
        unit: 'index points',
        frequency: 'daily',
        points: (INDEX_LEVELS.get(id) ?? []).filter((p) => p.day >= from && p.day <= to),
      })
    }
    if (rest === '/market/candles') {
      // The US listing is a second series, in dollars; a coin listing is in dollars too.
      const isin = q.get('isin') ?? ''
      const mic = q.get('mic')
      const index = INSTRUMENTS.find((i) => i.isin === isin)?.index ?? null
      const splice = q.get('splice') === 'index' && index !== null && mic === null
      return json({
        isin,
        interval: q.get('interval'),
        currency: mic !== null || isin === 'BTC-USD' ? 'USD' : 'EUR',
        mic,
        candles: candles(
          mic === null ? isin : `${isin}:${mic}`,
          q.get('interval') ?? '1d',
          q.get('from'),
          q.get('to'),
          splice,
        ),
        more: false,
        index: splice ? index : null,
        notes: [],
      })
    }
    if (rest === '/depot/positions') {
      const rows = [WORLD, SEMIS, US_STOCK, BTC_ETP].map(position)
      const total = rows.reduce((n, p) => n + p.value_cents, 0)
      const held = rows.map((p) => ({ ...p, share: total === 0 ? null : p.value_cents / total }))
      return json({
        value_cents: total,
        cost_fifo_cents: held.reduce((n, p) => n + p.cost_fifo_cents, 0),
        unrealised_fifo_cents: held.reduce((n, p) => n + p.unrealised_fifo_cents, 0),
        positions: held,
        unresolved: [],
      })
    }
    if (rest === '/depot/trades') return json(tradeRows(q.get('isin')))
    if (rest === '/depot/orders') {
      return json(
        orders.filter(
          (o) =>
            (q.get('status') === null || o.status === q.get('status')) &&
            (q.get('isin') === null || o.isin === q.get('isin')),
        ),
      )
    }
    const drawing = /^\/chart\/drawings\/([A-Za-z0-9-]+)$/.exec(rest)
    if (drawing !== null) {
      const isin = drawing[1]!
      return json(drawings.get(isin) ?? { isin, document: {}, updated_at: null })
    }
    return json({ error: 'not found' }, 404)
  }
  if (req.method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    const drawing = /^\/chart\/drawings\/([A-Za-z0-9-]+)$/.exec(rest)
    if (drawing !== null) {
      const saved = { isin: drawing[1]!, document: body, updated_at: new Date().toISOString() }
      drawings.set(saved.isin, saved)
      return json(saved)
    }
    const listPath =
      /^\/market\/lists(?:\/(\d+))?(?:\/(delete)|\/entries(?:\/([A-Za-z0-9-]+)(?:\/(delete))?)?)?$/.exec(
        rest,
      )
    if (listPath !== null) {
      const [, id, deleteList, symbol, deleteEntry] = listPath
      if (id === undefined) {
        const name = String(body['name'] ?? '').trim()
        if (name === '' || lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
          return json({ error: 'the name is empty or taken' }, 400)
        }
        const created: List = {
          id: nextList++,
          name,
          position: lists.length,
          is_default: false,
          entries: [],
        }
        lists.push(created)
        return json(listJson(created))
      }
      const list = lists.find((l) => l.id === Number(id))
      if (list === undefined) return json({ error: 'unknown list' }, 404)
      if (deleteList !== undefined) {
        if (list.is_default) return json({ error: 'the default list cannot be deleted' }, 400)
        lists = lists.filter((l) => l !== list)
        return json({ deleted: list.id })
      }
      if (symbol === undefined && !rest.endsWith('/entries')) {
        if (typeof body['name'] === 'string') list.name = body['name'].trim()
        return json(listJson(list))
      }
      if (symbol === undefined) {
        const added = String(body['symbol'])
        if (!list.entries.some((e) => e.symbol === added)) {
          list.entries.push({
            ...entryOf(added, list.entries.length),
            added_at: new Date().toISOString(),
          })
        }
        const entry = list.entries.find((e) => e.symbol === added)!
        if (typeof body['display_name'] === 'string') entry.display_name = body['display_name']
        return json(listJson(list))
      }
      if (deleteEntry !== undefined) {
        list.entries = list.entries.filter((e) => e.symbol !== symbol)
        return json(listJson(list))
      }
      const entry = list.entries.find((e) => e.symbol === symbol)
      if (entry === undefined) return json({ error: 'unknown entry' }, 404)
      if ('display_name' in body)
        entry.display_name = (body['display_name'] as string | null) ?? null
      return json(listJson(list))
    }
    if (rest === '/depot/orders') {
      const isin = String(body['isin'])
      const order: Order = {
        id: nextOrder++,
        account_id: null,
        isin,
        name: NAMES.get(isin) ?? null,
        side: body['side'] as Order['side'],
        type: body['type'] as Order['type'],
        limit_price: (body['limit_price'] as number | undefined) ?? null,
        stop_price: (body['stop_price'] as number | undefined) ?? null,
        quantity: Number(body['quantity']),
        valid_until: (body['valid_until'] as string | undefined) ?? null,
        status: 'open',
        note: (body['note'] as string | undefined) ?? null,
        opened_at: new Date().toISOString(),
        closed_at: null,
        overdue: false,
      }
      orders.push(order)
      return json(order)
    }
    const close = /^\/depot\/orders\/(\d+)\/close$/.exec(rest)
    if (close !== null) {
      const order = orders.find((o) => o.id === Number(close[1]))
      if (order === undefined) return json({ error: 'unknown order' }, 404)
      order.status = body['as'] as Order['status']
      order.closed_at = new Date().toISOString()
      return json(order)
    }
  }
  return json({ error: 'not found' }, 404)
}

// ---- The server ---------------------------------------------------------------------------

const missing = new Set<string>()

function serve(): { origin: string; stop: () => void } {
  const seed = `<script>localStorage.setItem("argo-auth",${JSON.stringify(JSON.stringify({ state: { token: 'fixture' }, version: 0 }))})</script>`
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.startsWith('/api/')) {
        const response = await handleApi(req, url)
        if (response.status === 404 && !missing.has(url.pathname)) {
          missing.add(url.pathname)
          console.log(`fixture has no ${req.method} ${url.pathname}`)
        }
        return response
      }
      const file = normalize(join(DIST, decodeURIComponent(url.pathname)))
      if (file.startsWith(DIST + sep) && existsSync(file) && statSync(file).isFile()) {
        return new Response(Bun.file(file))
      }
      const html = await Bun.file(join(DIST, 'index.html')).text()
      return new Response(html.replace('<head>', `<head>${seed}`), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    },
  })
  return { origin: `http://127.0.0.1:${server.port}`, stop: () => void server.stop(true) }
}

// ---- The shots ----------------------------------------------------------------------------

const VIEWPORTS = {
  desktop: { width: 1440, height: 1500, mobile: false },
  mobile: { width: 390, height: 2600, mobile: true },
} as const

const CHART = '[aria-label="Candlestick chart of the selected instrument"]'
const CARD = '[data-shot="depot-trade-card"]'

type StoredDocument = {
  drawings?: {
    id?: string
    kind?: string
    points?: { price: number }[]
    style?: { text?: string }
  }[]
  roles?: Record<string, string>
}

/** The stored drawing document of an instrument, as the service holds it. */
const storedDocument = (page: Page, isin: string): Promise<StoredDocument> =>
  page.evaluate(async (id) => {
    const token = (
      JSON.parse(localStorage.getItem('argo-auth') ?? '{}') as { state?: { token?: string } }
    ).state?.token
    const response = await fetch(`/api/finance/api/chart/drawings/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return ((await response.json()) as { document: StoredDocument }).document
  }, isin)

/** The prices of the horizontal lines in the stored document of an instrument. */
const storedLinePrices = async (page: Page, isin: string): Promise<number[]> =>
  ((await storedDocument(page, isin)).drawings ?? [])
    .filter((d) => d.kind === 'horizontal-line')
    .map((d) => d.points?.[0]?.price ?? Number.NaN)

/** The chart's own readings (the host carries them as data attributes). */
const hostAttr = (page: Page, name: string): Promise<string> =>
  page.locator(CHART).evaluate((el, key) => el.dataset[key] ?? '', name)

/** Clicks a timeframe button and waits for the chart to report it (one more click if the first raced the layout). */
async function timeframe(page: Page, name: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page
      .getByRole('group', { name: 'Timeframe' })
      .getByRole('button', { name, exact: true })
      .click()
    await page
      .waitForFunction(
        ([selector, wanted]) =>
          document.querySelector(selector!)?.getAttribute('data-timeframe') === wanted,
        [CHART, name] as const,
        { timeout: 2500 },
      )
      .catch(() => undefined)
    if ((await hostAttr(page, 'timeframe')) === name) break
  }
  return hostAttr(page, 'timeframe')
}

type Shot = { page: Page; out: string; scheme: string; device: string; failures: string[] }

/** A German number (`1.234,5`) as a JS number. */
const german = (text: string): number =>
  Number.parseFloat(text.replaceAll('.', '').replace(',', '.'))

/**
 * Draws a red horizontal line with a label, selects it again by a click on the line and types its price (with a
 * German comma); then a green one with a label, a blue vertical one and a price range. Every tool must hand the
 * pointer back after one drawing. The typed price is what the service must hold. Returns the typed price.
 */
async function draw({ page, out, scheme, device, failures }: Shot): Promise<number> {
  const where = `${scheme}/${device}`
  const plot = page.locator(CHART)
  const box = await plot.boundingBox()
  if (box === null) throw new Error('the chart has no box')
  const tools = page.getByRole('toolbar', { name: 'Drawing tools' })
  const pointerBack = async (what: string) => {
    await page.waitForTimeout(250)
    const pressed = await tools
      .getByRole('button', { name: 'Pointer' })
      .getAttribute('aria-pressed')
    if (pressed !== 'true') failures.push(`${where}: the pointer does not come back after ${what}`)
  }
  // The tools name themselves in a tooltip.
  if (device === 'desktop') {
    for (const [name, text] of [
      ['Horizontal line', 'Horizontal line: marks a price'],
      ['Vertical line', 'Vertical line: marks a day'],
      ['Price range', 'Price range: measures a move'],
    ] as const) {
      await tools.getByRole('button', { name }).hover()
      const tip = page.getByRole('tooltip').filter({ hasText: text })
      await tip.waitFor({ timeout: 2500 }).catch(() => undefined)
      if ((await tip.count()) === 0) failures.push(`${where}: no tooltip "${text}"`)
      if (name === 'Horizontal line') {
        const bar = await tools.boundingBox()
        if (bar !== null) {
          await page.screenshot({
            path: join(out, `depot--${scheme}--${device}--toolbar.png`),
            clip: {
              x: Math.max(0, bar.x - 160),
              y: Math.max(0, bar.y - 60),
              width: Math.min(bar.width + 200, 1440),
              height: bar.height + 90,
            },
          })
        }
      }
    }
    await page.mouse.move(2, 2)
  }
  await tools.getByRole('button', { name: 'Horizontal line' }).click()
  await tools.getByRole('button', { name: /^Red/ }).click()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3)
  await pointerBack('a horizontal line')
  // Placed, the line is selected; a click on empty plot deselects it, a click on the line selects it again.
  const field = page.getByLabel('Price of the selected line')
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6)
  await page.waitForTimeout(300)
  if ((await field.count()) > 0) throw new Error('the price field stays with nothing selected')
  for (const dy of [0, -3, 3, -6, 6, -9, 9]) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3 + dy)
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3 + dy)
    await page.waitForTimeout(300)
    if ((await field.count()) > 0) break
  }
  await field.waitFor({ timeout: 3000 })
  const typed = Math.round(german(await field.inputValue()) * 97) / 100
  await field.fill(String(typed).replace('.', ','))
  await field.press('Enter')
  await page.waitForTimeout(900)
  const label = page.getByLabel('Label of the selected line')
  await label.fill('Resistance')
  await label.press('Enter')
  await page.waitForTimeout(500)
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--line-editor.png`),
  })
  // A green line with a label, drawn lower on the plot.
  await tools.getByRole('button', { name: 'Horizontal line' }).click()
  await tools.getByRole('button', { name: /^Green/ }).click()
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.72)
  await pointerBack('a second line')
  await label.fill('Buy level')
  await label.press('Enter')
  await page.waitForTimeout(500)
  // A vertical line in the accent.
  await tools.getByRole('button', { name: 'Vertical line' }).click()
  await tools.getByRole('button', { name: /^Blue/ }).click()
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await pointerBack('a vertical line')
  await tools.getByRole('button', { name: 'Price range' }).click()
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.2, { steps: 8 })
  await page.mouse.up()
  await pointerBack('a price range')
  // Nothing selected: the editor is gone.
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9)
  return typed
}

/** The distance between two bars the chart reports, in px. */
async function spacingOf(page: Page): Promise<number> {
  const host = page.locator(CHART)
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute('data-bar-spacing') !== null,
    CHART,
  )
  return Number.parseFloat((await host.getAttribute('data-bar-spacing')) ?? 'NaN')
}

/** Adds a limit buy through the form and waits for it to show in the open-orders table. */
async function addOrder(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add order' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Quantity').fill('5')
  await dialog.getByLabel('Limit price').fill('112')
  await dialog.getByRole('button', { name: 'Add order' }).click()
  await page.getByText('Buy limit').waitFor()
}

/** How many entries the stored drawing document of the first instrument holds. */
const storedCount = async (page: Page): Promise<number> =>
  ((await storedDocument(page, WORLD)).drawings ?? []).length

/**
 * A trade's bar is clicked and its card pinned (a tap does the same on a phone); on a wide page the
 * pointer alone brings the card up by hovering the marker. Returns whether the hover found it.
 */
async function checkTradeCard(
  page: Page,
  out: string,
  scheme: string,
  device: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  const host = page.locator(CHART)
  const box = await host.boundingBox()
  const xs = ((await host.getAttribute('data-mark-x')) ?? '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite)
  const x = xs.find((value) => box !== null && value > 40 && value < box.width - 40)
  if (box === null || x === undefined) {
    failures.push(`${where}: no trade marker is on screen`)
    return
  }
  if (device === 'desktop') {
    let hovered = false
    for (let dy = 40; dy < box.height - 120 && !hovered; dy += 6) {
      await page.mouse.move(box.x + x, box.y + dy)
      hovered = (await page.locator(CARD).count()) > 0
    }
    if (!hovered) failures.push(`${where}: hovering a trade marker shows no card`)
    await page.mouse.move(2, 2)
  }
  await page.mouse.click(box.x + x, box.y + box.height * 0.45)
  await page
    .locator(CARD)
    .waitFor({ timeout: 3000 })
    .catch(() => undefined)
  const card = page.locator(CARD)
  if ((await card.count()) === 0) {
    failures.push(`${where}: a click on a trade's bar pins no card`)
    return
  }
  for (const text of ['Units', 'Price', 'Amount', 'Fee']) {
    if ((await card.getByText(text, { exact: true }).count()) === 0) {
      failures.push(`${where}: the trade card lacks "${text}"`)
    }
  }
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--trade-card.png`),
  })
  // The next click on a bar without a trade puts the card away.
  await page.mouse.click(box.x + box.width * 0.97, box.y + box.height * 0.45)
  await page.waitForTimeout(200)
}

/**
 * The watchlist panel: the tabs, a search that adds an instrument to the active list, a rename that
 * keeps the instrument's own name apart, and the removal of the entry.
 */
async function checkLists(
  page: Page,
  origin: string,
  out: string,
  scheme: string,
  device: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  await page.goto(`${origin}/finance/depot`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor()
  const tab = (name: string) => page.getByRole('tab', { name, exact: true })
  for (const name of ['In depot', 'Watchlist', 'Chips', 'Crypto', 'Indices']) {
    if ((await tab(name).count()) === 0) failures.push(`${where}: no "${name}" tab`)
  }
  if ((await tab('In depot').getAttribute('aria-selected')) !== 'true') {
    failures.push(`${where}: the depot tab is not the one open`)
  }
  for (const text of ['units', '%']) {
    if ((await page.getByRole('tabpanel').getByText(text).count()) === 0) {
      failures.push(`${where}: the depot tab shows no ${text}`)
    }
  }
  await tab('Watchlist').click()
  const search = page.getByRole('combobox', { name: 'Search instruments' })
  await page.keyboard.press('/')
  await search.type('emerging', { delay: 20 })
  const option = page.getByRole('option', { name: /Emerging markets ETF/ })
  await option.waitFor({ timeout: 4000 })
  await page.screenshot({ path: join(out, `depot--${scheme}--${device}--search.png`) })
  await page.keyboard.press('Enter')
  const row = page.getByRole('tabpanel').getByRole('button', { name: /^Emerging markets ETF/ })
  await row.first().waitFor({ timeout: 4000 })
  await page.getByRole('button', { name: 'Rename Emerging markets ETF' }).click()
  const name = page.getByLabel('Name of Emerging markets ETF')
  await name.fill('EM core')
  await name.press('Enter')
  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: /^EM core/ })
    .first()
    .waitFor({ timeout: 4000 })
  await page.screenshot({ path: join(out, `depot--${scheme}--${device}--lists.png`) })
  await page.getByRole('button', { name: /^Remove EM core from list/ }).click()
  await page
    .getByRole('tabpanel')
    .getByRole('button', { name: /^EM core/ })
    .waitFor({ state: 'detached', timeout: 4000 })
    .catch(() => failures.push(`${where}: the removed entry is still listed`))
}

/**
 * The Indices tab, the index line back to 1998 and the comparison of a young fund against its index: the
 * comparison is off until asked for, then checked on the page and shot.
 */
/**
 * What every chart shows: the all-time high in the card header with its day and distance, the drawn lines
 * the page says it has (an order's label), and no English number (`1,234.5`) anywhere on the page.
 */
async function checkFacts(
  page: Page,
  where: string,
  failures: string[],
  expect: { orderLine?: string | RegExp },
): Promise<void> {
  const card = page.locator('[data-shot="depot-chart"]')
  const text = await card.innerText()
  if (!/All-time high/.test(text)) failures.push(`${where}: the header has no all-time high`)
  else if (!/\d{2}\.\d{2}\.\d{4}/.test(text) || !/(−\d+,\d %|at the high)/.test(text)) {
    failures.push(
      `${where}: the all-time high lacks its day or its distance: ${text.slice(0, 160)}`,
    )
  }
  if (expect.orderLine !== undefined) {
    const lines = (await hostAttr(page, 'lines')).split('|')
    const found = lines.some((line) =>
      typeof expect.orderLine === 'string'
        ? line === expect.orderLine
        : expect.orderLine?.test(line),
    )
    if (!found)
      failures.push(
        `${where}: no order line ${String(expect.orderLine)} among: ${lines.join(' | ')}`,
      )
  }
  const body = await page.evaluate(() => document.body.innerText)
  const english = /\d,\d{3}\.\d/.exec(body)
  if (english !== null) failures.push(`${where}: an English number on the page: ${english[0]}`)
}

/**
 * The comparison: "Compare with…" sits in the bottom toolbar, the index draws on the chart's own scale (percent),
 * the chip names it and follows the visible range (6M and 1Y differ), and the x removes it.
 */
async function checkCompare(
  page: Page,
  origin: string,
  scheme: string,
  device: string,
  out: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  await page.goto(`${origin}/finance/depot?isin=${WORLD}`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(800)
  const bar = page.locator('[data-shot="depot-toolbar"]')
  if ((await page.locator('[data-shot="depot-overlay"]').count()) > 0) {
    failures.push(`${where}: a separate comparison card is on the page`)
  }
  await bar.getByRole('button', { name: 'Compare with an index' }).click()
  await page.getByRole('menuitem', { name: 'MSCI World', exact: true }).click()
  const chip = bar.locator('[data-shot="depot-compare-chip"]')
  await chip.waitFor()
  await page.waitForTimeout(900)
  if ((await hostAttr(page, 'scale')) !== 'percent')
    failures.push(`${where}: the scale is not percent`)
  if (!(await bar.getByRole('button', { name: 'Logarithmic price scale' }).isDisabled())) {
    failures.push(`${where}: Log stays enabled while comparing`)
  }
  const seen: string[] = []
  for (const frame of ['6M', '1Y']) {
    const reported = await timeframe(page, frame)
    if (reported !== frame)
      failures.push(`${where}: ${frame} reads as "${reported}" while comparing`)
    await page.waitForTimeout(700)
    const reading = `${await chip.innerText()} | ${await hostAttr(page, 'rangeChange')}`
    seen.push(reading)
    if (!/MSCI World\s+[+−]?\d+,\d %/.test(reading)) {
      failures.push(`${where}: the chip lacks the index and its change: ${reading}`)
    }
    await page.locator('[data-shot="depot-chart"]').screenshot({
      path: join(out, `depot--${scheme}--${device}--compare-${frame.toLowerCase()}.png`),
    })
  }
  if (seen[0] === seen[1])
    failures.push(`${where}: the comparison does not follow the timeframe: ${seen[0]}`)
  await chip.getByRole('button', { name: /^Remove the comparison/ }).click()
  await chip.waitFor({ state: 'detached' })
  await page.waitForTimeout(400)
  if ((await hostAttr(page, 'scale')) !== 'linear')
    failures.push(`${where}: the scale stays percent`)
}

async function checkIndices(
  page: Page,
  origin: string,
  scheme: string,
  device: string,
  out: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  const shoot = async (name: string, shot: string) => {
    const card = page.locator(`[data-shot="${shot}"]`)
    await card.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await card.screenshot({ path: join(out, `depot--${scheme}--${device}--${name}.png`) })
  }
  await page.goto(`${origin}/finance/depot?isin=msci-acwi-imi-net-eur&rng=max`, {
    waitUntil: 'networkidle',
  })
  const index = page.locator('[data-shot="depot-index"]')
  await index.waitFor()
  await page.waitForTimeout(700)
  if ((await page.getByRole('tab', { name: 'Indices', exact: true }).count()) === 0) {
    failures.push(`${where}: the watchlist has no Indices tab`)
  }
  if ((await index.getByText('MSCI ACWI IMI · EUR').count()) === 0) {
    failures.push(`${where}: the index card does not name its series`)
  }
  if ((await index.getByText('MSCI · net return · EUR').count()) === 0) {
    failures.push(`${where}: the index card does not name its source`)
  }
  if ((await index.getByText(/since .*1998/).count()) === 0) {
    failures.push(`${where}: the index line does not start in 1998`)
  }
  if ((await index.locator('path[stroke]').count()) === 0) {
    failures.push(`${where}: the index card draws no line`)
  }
  await shoot('index-max', 'depot-index')

  // A young fund: its history opens with the index it tracks, the comparison waits to be asked for.
  await page.goto(`${origin}/finance/depot?isin=${ALL_CAP}`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(900)
  if (Number(await hostAttr(page, 'spliced')) < 100) {
    failures.push(`${where}: the young fund's history does not open with its index`)
  }
  if ((await page.getByText('Index, scaled to the ETF price').count()) === 0) {
    failures.push(`${where}: the spliced history is not labelled`)
  }
  if ((await hostAttr(page, 'scale')) !== 'linear') {
    failures.push(`${where}: the comparison is on without being asked for`)
  }
  await timeframe(page, 'Max')
  await page.waitForTimeout(500)
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--spliced.png`),
  })
  // The young fund against the index of a similar size, over its whole history.
  await page.goto(`${origin}/finance/depot?isin=${ALL_CAP}&cmp=msci-acwi-imi-net-eur`, {
    waitUntil: 'networkidle',
  })
  await page.locator('canvas').first().waitFor()
  await page.locator('[data-shot="depot-compare-chip"]').waitFor()
  await page.waitForTimeout(900)
  if ((await hostAttr(page, 'scale')) !== 'percent') {
    failures.push(`${where}: the young fund's comparison is not on a percent scale`)
  }
  await timeframe(page, 'Max')
  await page.waitForTimeout(500)
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--compare-young.png`),
  })
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { out: { type: 'string' }, serve: { type: 'boolean' } } })
  if (values.serve === true) {
    // Only the stand-in API and the app, for `basalt-ui shot --dist` and manual checks.
    console.log(serve().origin)
    return await new Promise<number>(() => undefined)
  }
  const out = resolve(values.out ?? join(ROOT, '.design-shots/depot'))
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('build the dashboard first')
  await mkdir(out, { recursive: true })
  const { origin, stop } = serve()
  const browser = await chromium.launch({ channel: 'chrome' })
  const failures: string[] = []
  try {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [device, vp] of Object.entries(VIEWPORTS)) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 2,
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          colorScheme: scheme,
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        })
        await context.addInitScript(
          (value) => localStorage.setItem('mantine-color-scheme-value', value),
          scheme,
        )
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        // A 404 is the stand-in not answering a route of another page of the shell; anything else counts.
        page.on('console', (m) => {
          if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
            errors.push(m.text())
        })
        const where = `${scheme}/${device}`
        await fetch(`${origin}/api/__reset`)
        await page.goto(`${origin}/finance/depot`, { waitUntil: 'networkidle' })
        await page.locator('canvas').first().waitFor()
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        await page.waitForTimeout(600)
        // The chart opens on the last year, with turnover on (an ETF) and a linear scale.
        if ((await hostAttr(page, 'timeframe')) !== '1Y') {
          failures.push(
            `${where}: the chart does not open on the last year (${await hostAttr(page, 'timeframe')})`,
          )
        }
        if (
          (await page
            .getByRole('button', { name: 'Show turnover' })
            .getAttribute('aria-pressed')) !== 'true'
        ) {
          failures.push(`${where}: an ETF opens without turnover`)
        }
        if (
          (await page
            .getByRole('button', { name: 'Logarithmic price scale' })
            .getAttribute('aria-pressed')) !== 'false'
        ) {
          failures.push(`${where}: an ETF opens on the log scale`)
        }
        await checkTradeCard(page, out, scheme, device, failures)
        const typed = await draw({ page, out, scheme, device, failures })
        await addOrder(page)
        await page.waitForTimeout(900)
        const saved = await storedCount(page)
        if (saved !== 4) failures.push(`${where}: ${saved} drawings stored, expected 4`)
        const stored = await storedDocument(page, WORLD)
        const roles = Object.values(stored.roles ?? {}).toSorted()
        if (roles.join() !== 'accent,accent,buy,sell') {
          failures.push(
            `${where}: stored colours are ${roles.join(', ')}, expected accent, accent, buy, sell`,
          )
        }
        const labels = (stored.drawings ?? []).map((d) => d.style?.text).filter((t) => t)
        if (!labels.includes('Resistance') || !labels.includes('Buy level')) {
          failures.push(`${where}: stored labels are ${labels.join(', ')}`)
        }
        // A reload is a second device: the drawings and the order come back from the service.
        await page.reload({ waitUntil: 'networkidle' })
        await page.locator('canvas').first().waitFor()
        await page.waitForTimeout(900)
        const prices = await storedLinePrices(page, WORLD)
        if (!prices.some((price) => Math.abs(price - typed) < 0.005)) {
          failures.push(`${where}: the line holds ${prices.join(', ')}, typed ${typed}`)
        }
        await checkFacts(page, where, failures, { orderLine: 'Buy limit 112 €' })
        const overflow = await page.evaluate(() =>
          Math.max(
            ...[...document.querySelectorAll<HTMLElement>('*')].map(
              (el) => el.scrollWidth - el.clientWidth,
            ),
          ),
        )
        const horizontalScroll = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        )
        if (horizontalScroll) failures.push(`${where}: the page scrolls horizontally`)
        for (const gone of ['15 min', '1 hour']) {
          if ((await page.getByText(gone, { exact: true }).count()) > 0) {
            failures.push(`${where}: an intraday control (${gone}) is offered`)
          }
        }
        const spacings = [await spacingOf(page)]
        await page.screenshot({
          path: join(out, `depot--${scheme}--${device}.png`),
          fullPage: false,
        })
        // The timeframes only move the view: five years, then everything.
        for (const name of ['6M', 'Max']) {
          const reported = await timeframe(page, name)
          if (reported !== name) failures.push(`${where}: ${name} reads as "${reported}"`)
        }
        if (scheme === 'light' && device === 'desktop') {
          // Closing the order takes its row, and with it its line, away.
          await page
            .getByRole('row')
            .filter({ hasText: 'Buy limit' })
            .getByRole('button')
            .last()
            .click()
          await page.getByRole('menuitem', { name: 'Close as cancelled' }).click()
          await page.getByText('Buy limit').waitFor({ state: 'detached' })
        }
        // Week and month open on as many bars as a year of days: about the same distance between two bars.
        const views: [string, string][] = [
          ['1w', '?ivl=1w'],
          ['btc-usd', '?isin=BTC-USD'],
          ['btc-usd--1w', '?isin=BTC-USD&ivl=1w'],
          ['us-stock', `?isin=${US_STOCK}`],
          ...(scheme === 'light' && device === 'desktop'
            ? ([['1mo', '?ivl=1mo']] as [string, string][])
            : []),
        ]
        for (const [name, query] of views) {
          await page.goto(`${origin}/finance/depot${query}`, { waitUntil: 'networkidle' })
          await page.locator('canvas').first().waitFor()
          await page.waitForTimeout(700)
          if ((await page.getByText('No bars stored for this instrument yet.').count()) > 0) {
            failures.push(`${where}: no bars at ${name}`)
          }
          if (name.startsWith('btc-usd') || name === 'us-stock') {
            if ((await page.getByText('USD', { exact: false }).count()) === 0) {
              failures.push(`${where}: ${name} is not charted in USD`)
            }
            const dollars = page.getByText(/Price \(USD\)|\([\d.,]+ \$\)/)
            if ((await dollars.count()) === 0) {
              failures.push(`${where}: ${name} shows no dollar price in the trades`)
            }
          }
          if (
            name === '1w' &&
            (await page.getByRole('button', { name: '1M', exact: true }).isEnabled())
          ) {
            failures.push(`${where}: one month is offered on week bars`)
          }
          if (name === 'btc-usd') {
            // Bitcoin: logarithmic, no turnover, and the whole history on Max, from 2011.
            const reported = await timeframe(page, 'Max')
            if (reported !== 'Max') failures.push(`${where}: Bitcoin on Max reads as "${reported}"`)
            const first = await hostAttr(page, 'firstDay')
            if (!first.startsWith('2011'))
              failures.push(`${where}: Bitcoin starts on ${first}, not in 2011`)
            if (
              (await page
                .getByRole('button', { name: 'Logarithmic price scale' })
                .getAttribute('aria-pressed')) !== 'true'
            ) {
              failures.push(`${where}: Bitcoin opens on the linear scale`)
            }
            if (
              (await page
                .getByRole('button', { name: 'Show turnover' })
                .getAttribute('aria-pressed')) !== 'false'
            ) {
              failures.push(`${where}: Bitcoin opens with turnover`)
            }
            await page.waitForTimeout(400)
          }
          if (name === 'us-stock') {
            // The hand-kept sell order sits on the dollar chart at the latest rate, named in both currencies.
            await checkFacts(page, where, failures, {
              orderLine: /^Sell limit [\d.,]+ € \([\d.,]+ \$\)$/,
            })
          } else {
            await checkFacts(page, where, failures, {})
          }
          if (name === 'btc-usd') {
            // Bitcoin runs into five figures: thousands grouped with a dot, no decimals.
            const read = await page
              .getByText(/^O [\d.,]+ H /)
              .first()
              .innerText()
            if (!/C \d{1,3}(?:\.\d{3})+(?![\d,])/.test(read)) {
              failures.push(`${where}: the Bitcoin readout is not whole German numbers: ${read}`)
            }
          }
          if (name === '1w') spacings.push(await spacingOf(page))
          await page.screenshot({ path: join(out, `depot--${scheme}--${device}--${name}.png`) })
        }
        await checkLists(page, origin, out, scheme, device, failures)
        await checkCompare(page, origin, scheme, device, out, failures)
        await checkIndices(page, origin, scheme, device, out, failures)
        const [day, ...others] = spacings
        if (day === undefined || others.some((other) => Math.abs(other / day - 1) > 0.12)) {
          failures.push(`${where}: bar spacing differs by interval: ${spacings.join(', ')}`)
        }
        if (errors.length > 0) failures.push(`${where}: ${errors.join(' | ')}`)
        console.log(
          `${where}: widest overflow ${overflow}px, bar spacing ${spacings.join('/')}px, errors ${errors.length}`,
        )
        await context.close()
      }
    }
  } finally {
    await browser.close().catch(() => undefined)
    stop()
  }
  for (const failure of failures) console.error(failure)
  return failures.length === 0 ? 0 : 1
}

process.exit(await main())
