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
 * a launch marker; the weekly compare of a young fund reads one continuous splice with about 5 % free on the right; the
 * order and cost labels sit at the left edge and the toolbar's "Beschriftung" hides them; "Compare with…" turns the scale to percent (6M and 1Y read differently, the chip's x removes it);
 * the toolbar's tooltips, the line editor and the pointer coming back after one drawing, the all-time high in the header, the
 * US stock's hand-kept sell order on its dollar chart; the live layer (quote line and status per market, bid and ask,
 * the venue switch, an in-place candle update, the live Board, the order form's prefill); an instrument is searched, added to a list,
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
  /** A series that sends closes only: the bar is built from them. */
  derived_from_close?: true
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
const CBBI = 'cbbi-confidence'
const AMD = 'US0079031078'
/** The instruments the service has no history of yet: the search finds them, adding one starts the load. */
const pending = new Set<string>([AMD])

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

INSTRUMENTS.push({
  // Not on any list and without stored bars: the add flow finds it by its ticker and loads its history.
  isin: AMD,
  name: 'Advanced Micro Devices',
  kind: 'stock',
  start: 60,
  drift: 0.0008,
  vol: 0.022,
  days: 1500,
  unlisted: true,
})

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
  // The stored history ends before today: the running day is the live layer's (see "The live layer").
  for (let t = today - (instrument.days ?? 1800) * DAY_S; t < today; t += DAY_S) {
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
  // The Colin Talks Crypto Bitcoin Bull Run Index: 0 to 100, as the service serves it.
  { id: CBBI, title: 'CBBI', first: '2011-09-13', start: 40, drift: 0, vol: 0 },
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
    if (row.id === CBBI) {
      value = Math.min(98, Math.max(2, value + (random() - 0.5) * 3 + (50 - value) * 0.004))
    } else {
      value *= 1 + row.drift + (random() - 0.5) * 2 * row.vol
    }
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
    ...(group.some((b) => b.derived_from_close === true) && { derived_from_close: true as const }),
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
 * The daily bars of a fund with the index it tracks in front of its first bar: the index's own open, high, low and
 * close (no turnover), scaled so the last level before the fund's first day equals its first close.
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
  const real = new Map((SERIES_BARS.get(series ?? '') ?? []).map((b) => [b.time, b]))
  const spliced = before.map((l): Bar => {
    const bar = real.get(l.time)
    const scaled = (value: number) => round(value * scale, 4)
    return {
      time: l.time,
      open: scaled(bar?.open ?? l.value),
      high: scaled(bar?.high ?? l.value),
      low: scaled(bar?.low ?? l.value),
      close: scaled(l.value),
      units: null,
      turnover: null,
      source: 'index',
    }
  })
  return [...spliced, ...own]
}

/**
 * The bars of a stored series: real open, high and low for the FTSE index, the close four times (flagged) for every
 * other one, as the service answers.
 */
function seriesBars(row: IndexRow): Bar[] {
  const levels = INDEX_LEVELS.get(row.id) ?? []
  const random = rng(8000)
  return levels.map((level, n): Bar => {
    if (row.id !== FTSE) {
      return {
        time: level.time,
        open: level.value,
        high: level.value,
        low: level.value,
        close: level.value,
        units: null,
        turnover: null,
        derived_from_close: true,
      }
    }
    const open = levels[n - 1]?.value ?? level.value
    const top = Math.max(open, level.value)
    const bottom = Math.min(open, level.value)
    return {
      time: level.time,
      open,
      high: round(top * (1 + random() * 0.004), 2),
      low: round(bottom * (1 - random() * 0.004), 2),
      close: level.value,
      units: null,
      turnover: null,
    }
  })
}

const SERIES_BARS = new Map(INDEX_ROWS.map((row) => [row.id, seriesBars(row)]))

/** The daily bars behind a symbol: an instrument, a stored series, nothing while its history is still loading. */
const barsOf = (isin: string): Bar[] =>
  pending.has(isin) ? [] : (DAILY.get(isin) ?? SERIES_BARS.get(isin) ?? [])

function candles(
  isin: string,
  interval: string,
  from: string | null,
  to: string | null,
  splice = false,
): Bar[] {
  const daily = splice ? splicedDaily(isin) : barsOf(isin)
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
  // The young all-cap fund, bought twice: its trades and its open order show on the index it tracks.
  made.push(
    { isin: ALL_CAP, side: 'buy', daysAgo: 55, quantity: 12, source: 'document' },
    { isin: ALL_CAP, side: 'buy', daysAgo: 20, quantity: 8, source: 'document' },
  )
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
  // A buy limit on the fund that tracks the FTSE index, a little below its last close.
  const allCap = DAILY.get(ALL_CAP)?.at(-1)?.close ?? 100
  orders.push({
    id: nextOrder++,
    account_id: null,
    isin: ALL_CAP,
    name: NAMES.get(ALL_CAP) ?? null,
    side: 'buy',
    type: 'limit',
    limit_price: round(allCap * 0.97),
    stop_price: null,
    quantity: 25,
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

const HELD = new Set([WORLD, SEMIS, ALL_CAP, US_STOCK, 'BTC-USD'])

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
    entries: [WORLD, SEMIS, ALL_CAP, 'XX0000000003', 'XX0000000004', US_STOCK, FTSE].map(entryOf),
  },
  { id: 2, name: 'Chips', position: 1, is_default: false, entries: [SEMIS, US_STOCK].map(entryOf) },
]
let lists = freshLists()
let nextList = 3

const rowOf = (i: Instrument) => {
  if (pending.has(i.isin)) {
    // No bars yet: the row says so, and the page shows the history loading.
    return {
      isin: i.isin,
      name: i.name,
      kind: i.kind,
      currency: 'EUR',
      last_close: null,
      last_day: null,
      first_day: null,
      day_change: null,
      day_change_pct: null,
      us_mic: null,
      instruments: [i.isin],
      chart_as: null,
      index: null,
    }
  }
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

/** The MSCI and FTSE levels are indices; the rate and the CBBI are plain series. */
const seriesKind = (id: string): 'index' | 'series' =>
  id === 'eur-usd' || id === CBBI ? 'series' : 'index'
const seriesCurrency = (id: string): string | null =>
  id === FTSE ? 'USD' : seriesKind(id) === 'index' ? 'EUR' : null

/** A stored series as a list entry's quote: its last two levels. */
function seriesRow(id: string) {
  const row = INDEX_ROWS.find((r) => r.id === id)!
  const levels = INDEX_LEVELS.get(id) ?? []
  const last = levels.at(-1)!
  const before = levels.at(-2)!
  return {
    isin: id,
    name: row.title,
    kind: seriesKind(id),
    currency: seriesCurrency(id),
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
  entries: list.entries
    .toSorted((a, b) => a.position - b.position)
    .map((e) => ({ ...e, kind: quoteOf(e.symbol).kind, quote: quoteOf(e.symbol) })),
})

/** A list or an entry moved to `position`: the others shift and every position is contiguous again. */
function moveTo<T extends { position: number }>(items: T[], item: T, position: number): void {
  const ordered = items.toSorted((a, b) => a.position - b.position).filter((x) => x !== item)
  ordered.splice(Math.min(Math.max(position, 0), ordered.length), 0, item)
  ordered.forEach((x, n) => {
    x.position = n
  })
}

// ---- Board figures, the history load and the stats of one instrument ------------------------

type Close = { day: string; close: number }

const closesOf = (symbol: string): Close[] => {
  if (pending.has(symbol)) return []
  const levels = INDEX_LEVELS.get(symbol)
  if (levels !== undefined) return levels.map((l) => ({ day: l.day, close: l.value }))
  return (DAILY.get(symbol) ?? []).map((b) => ({ day: dayOf(b.time), close: b.close }))
}

function figuresOf(points: Close[]) {
  const last = points.at(-1)
  if (last === undefined) return null
  const at = Date.parse(`${last.day}T00:00:00Z`)
  const onOrBefore = (day: string): number | null =>
    points.findLast((p) => p.day <= day)?.close ?? null
  const change = (ref: number | null): number | null =>
    ref === null || ref === 0 ? null : last.close / ref - 1
  const weekAgo = dayOf(at / 1000 - 7 * DAY_S)
  const yearAgo = dayOf(at / 1000 - 365 * DAY_S)
  const monthAgo = new Date(at)
  monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1)
  const previousYear =
    points.findLast((p) => p.day < `${last.day.slice(0, 4)}-01-01`)?.close ?? null
  const high = points.reduce((best, p) => (p.close > best.close ? p : best), points[0]!)
  const lastYear = points.filter((p) => p.day > yearAgo).map((p) => p.close)
  return {
    last_close: last.close,
    last_day: last.day,
    day_pct: change(points.at(-2)?.close ?? null),
    week_pct: change(onOrBefore(weekAgo)),
    month_pct: change(onOrBefore(monthAgo.toISOString().slice(0, 10))),
    ytd_pct: change(previousYear),
    year_pct: change(onOrBefore(yearAgo)),
    ath: { value: high.close, day: high.day },
    ath_pct: last.close / high.close - 1,
    low_52w: Math.min(...lastYear),
    high_52w: Math.max(...lastYear),
  }
}

function boardOf(list: List) {
  return {
    list_id: list.id,
    name: list.name,
    entries: list.entries
      .toSorted((a, b) => a.position - b.position)
      .map((e) => {
        const quote = quoteOf(e.symbol)
        const cbbi = e.symbol === 'BTC-USD' ? (INDEX_LEVELS.get(CBBI)?.at(-1) ?? null) : null
        return {
          symbol: e.symbol,
          display_name: e.display_name,
          name: quote.name,
          kind: quote.kind,
          currency: quote.currency,
          figures: figuresOf(closesOf(e.symbol)),
          cbbi: cbbi === null ? null : { value: cbbi.value, day: cbbi.day },
        }
      }),
  }
}

/** Where the history load of a symbol stands: `running` grows by a step at every read until the shot finishes it. */
const backfills = new Map<string, { state: 'running' | 'done'; reads: number }>()

function backfillOf(symbol: string) {
  const load = backfills.get(symbol)
  const bars = DAILY.get(symbol) ?? []
  if (load === undefined) return { symbol, state: 'none', from: null, bars: 0, error: null }
  if (load.state === 'done') {
    return {
      symbol,
      state: 'done',
      from: bars[0] === undefined ? null : dayOf(bars[0].time),
      bars: bars.length,
      error: null,
    }
  }
  load.reads += 1
  const stored = Math.min(load.reads * 140, Math.max(bars.length - 1, 0))
  return {
    symbol,
    state: 'running',
    from:
      stored === 0 || bars[bars.length - stored] === undefined
        ? null
        : dayOf(bars[bars.length - stored]!.time),
    bars: stored,
    error: null,
  }
}

/** What one instrument has made over the whole time, from the stand-in's trades. */
function statsOf(isin: string) {
  const rows = tradeRows(isin)
  if (rows.length === 0) return null
  const instruments = INSTRUMENTS.find((i) => i.isin === isin)?.chartedAs ?? [isin]
  const held = instruments.map(position)
  const sum = (pick: (r: (typeof rows)[number]) => number): number =>
    rows.reduce((n, r) => n + pick(r), 0)
  const invested = sum((r) => (r.side === 'buy' ? r.amount_cents : 0))
  const sold = sum((r) => (r.side === 'sell' ? r.amount_cents : 0))
  const value = held.reduce((n, p) => n + p.value_cents, 0)
  const unrealised = held.reduce((n, p) => n + p.unrealised_fifo_cents, 0)
  let units = 0
  let peak = 0
  let peakOn: string | null = null
  for (const r of rows.toSorted((a, b) => a.booked_on.localeCompare(b.booked_on))) {
    units += r.side === 'buy' ? (r.quantity ?? 0) : -(r.quantity ?? 0)
    if (units > peak + 1e-9) {
      peak = units
      peakOn = r.booked_on
    }
  }
  const closes = closesOf(dollarSeries(instruments[0]!) ?? isin)
  const high = closes.reduce((best, p) => (p.close > best.close ? p : best), closes[0]!)
  const last = closes.at(-1)!
  const first = rows.map((r) => r.booked_on).toSorted()[0]!
  return {
    isin,
    name: NAMES.get(isin) ?? null,
    invested_cents: invested,
    sold_cents: sold,
    realised_gain_cents: sum((r) => r.realised_fifo_cents ?? 0),
    unrealised_gain_cents: unrealised,
    total_gain_cents: sold + value - invested,
    fees_cents: sum((r) => r.fee_cents),
    tax_cents: 0,
    first_buy: first,
    last_trade:
      rows
        .map((r) => r.booked_on)
        .toSorted()
        .at(-1) ?? null,
    closed_on: null,
    holding_days: Math.round((Date.now() - Date.parse(`${first}T00:00:00Z`)) / (DAY_S * 1000)),
    peak_quantity: round(peak, 4),
    peak_on: peakOn,
    quantity: round(
      held.reduce((n, p) => n + p.quantity, 0),
      4,
    ),
    value_cents: value,
    all_time_high: {
      value: high.close,
      day: high.day,
      currency: dollarSeries(instruments[0]!) === null ? 'EUR' : 'USD',
      last_close: last.close,
      last_day: last.day,
      pct_from_high: last.close / high.close - 1,
    },
  }
}

/** The sync set: everything on a list plus what the depot holds. */
const onSomeList = (isin: string): boolean =>
  HELD.has(isin) || lists.some((l) => l.entries.some((e) => e.symbol === isin))

const SEARCHABLE = [
  ...INSTRUMENTS.map((i) => ({
    kind: i.kind,
    symbol: i.isin,
    name: i.name,
    ticker: i.isin === AMD ? 'AMD' : null,
    mnemonic: i.isin === AMD ? 'AMD' : null,
  })),
  ...INDEX_ROWS.map((r) => ({
    kind: seriesKind(r.id),
    symbol: r.id,
    name: r.title,
    ticker: null,
    mnemonic: null,
  })),
]

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// ---- The live layer ----------------------------------------------------------------------------

/** How far today's price stands from the last stored close; `/__tick` moves it, so a shot can watch a candle change. */
let move = 1.03
const DIRECT = 'ING-DH'
/** Direkthandel has only a short stored history. */
const DIRECT_DAYS = 14

const isSeries = (symbol: string): boolean => INDEX_ROWS.some((row) => row.id === symbol)

/** Today's bar of a line: a US listing has none (its market is shut), a series never. */
function todayBar(key: string, mic: string | null) {
  const last = barsOf(key).at(-1)
  if (last === undefined || isSeries(key) || key.includes(':')) return null
  // Direkthandel trades live; the exchange's day is a quarter of an hour behind and a little off its price.
  const delayed = mic !== DIRECT && key !== 'BTC-USD'
  const close = round(last.close * (delayed ? move - 0.002 : move), 4)
  return {
    time: midnight(Date.now()),
    open: round(last.close * 1.004, 4),
    high: round(Math.max(close, last.close * 1.036), 4),
    low: round(last.close * 0.998, 4),
    close,
    units: null,
    turnover: Math.round((last.turnover ?? 0) * 0.4),
    provisional: true,
    as_of: new Date(Date.now() - (delayed ? 900_000 : 0)).toISOString(),
    delay_seconds: delayed ? 900 : 0,
  }
}

/** One quote as the service answers it; `eurLine` is `mic=XETR`. */
function quoteRow(symbol: string, eurLine: boolean) {
  const us = symbol === US_STOCK && !eurLine
  const coin = symbol === 'BTC-USD'
  const series = isSeries(symbol)
  const stored =
    symbol === BTC_ETP
      ? undefined
      : (barsOf(us ? `${symbol}:XNAS` : symbol) as { time: number; close: number }[]).at(-1)
  const close =
    symbol === BTC_ETP ? priceOn(BTC_ETP, dayOf(Date.now() / 1000 - DAY_S)) : stored?.close
  const running = !us && !series && close !== undefined
  const before = (barsOf(us ? `${symbol}:XNAS` : symbol) as { close: number }[]).at(-2)?.close
  // A shut market's price is the last close, its change the one that day made.
  const prev = running ? close : (before ?? close)
  const last = close === undefined ? null : round(running ? close * move : close, 4)
  const quoted = running && !coin && last !== null
  const tomorrow = new Date((midnight(Date.now()) + DAY_S + 14.5 * 3600) * 1000).toISOString()
  return {
    symbol,
    currency: us || coin ? 'USD' : series ? seriesCurrency(symbol) : 'EUR',
    last,
    day: running ? dayOf(Date.now() / 1000) : stored === undefined ? null : dayOf(stored.time),
    bid: quoted ? round(last * 0.9985, 3) : null,
    ask: quoted ? round(last * 1.0015, 3) : null,
    spread: quoted ? round(last * 0.003, 3) : null,
    spread_bps: quoted ? 30 : null,
    quoted_at: quoted ? new Date().toISOString() : null,
    prev_close: prev ?? null,
    prev_close_day: stored === undefined ? null : dayOf(stored.time),
    change: last === null || prev === undefined ? null : round(last - prev, 4),
    change_pct: last === null || prev === undefined ? null : last / prev - 1,
    as_of: running ? new Date().toISOString() : null,
    delay_seconds: running ? 0 : null,
    source: coin ? 'bitstamp' : us ? 'nasdaq' : 'ing',
    venue: series ? null : coin ? 'Bitstamp' : us ? 'NASDAQ-GS' : 'ING Direkthandel',
    session: running ? 'open' : 'closed',
    next_open: coin || series ? null : tomorrow,
    today: null,
    error: null,
  }
}

/** The candles route's answer, with `today=1`, `limit` and ING Direkthandel's short history. */
function candleAnswer(q: URLSearchParams) {
  const isin = q.get('isin') ?? ''
  const interval = q.get('interval') ?? '1d'
  const mic = q.get('mic')
  const direct = mic === DIRECT
  const listing = mic === null || direct ? null : mic
  const key = listing === null ? isin : `${isin}:${listing}`
  const index = INSTRUMENTS.find((i) => i.isin === isin)?.index ?? null
  const splice = q.get('splice') === 'index' && index !== null && mic === null
  let bars: object[] = candles(key, interval, q.get('from'), q.get('to'), splice)
  if (direct) {
    bars = (bars as Bar[]).slice(-DIRECT_DAYS).map((bar) => ({
      ...bar,
      close: round(bar.close * 1.006, 4),
      high: round(bar.high * 1.008, 4),
      source: 'ing',
    }))
  }
  const today = q.get('today') === '1' ? todayBar(key, mic) : null
  if (today !== null && interval === '1d') bars = [...bars, today]
  const limit = q.get('limit')
  if (limit !== null) bars = bars.slice(-Number(limit))
  return {
    isin,
    interval,
    currency: isSeries(isin)
      ? seriesCurrency(isin)
      : listing !== null || isin === 'BTC-USD'
        ? 'USD'
        : 'EUR',
    mic,
    candles: bars,
    more: false,
    index: splice ? index : null,
    notes: [],
  }
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, '')
  const q = url.searchParams
  if (path === '/__reset') {
    move = 1.03
    orders.length = 0
    nextOrder = 1
    seedOrders()
    drawings.clear()
    lists = freshLists()
    nextList = 3
    pending.add(AMD)
    backfills.clear()
    return json({ ok: true })
  }
  if (path === '/__tick') {
    move = Number(q.get('move') ?? '1.03')
    return json({ ok: true })
  }
  if (path === '/__finish') {
    // The shot lets the history load of every started instrument end.
    for (const symbol of backfills.keys()) {
      pending.delete(symbol)
      backfills.set(symbol, { state: 'done', reads: 0 })
    }
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
    if (rest === '/market/lists') {
      return json(lists.toSorted((a, b) => a.position - b.position).map(listJson))
    }
    if (rest === '/market/search') {
      const term = (q.get('q') ?? '').toLowerCase()
      return json(
        SEARCHABLE.filter((s) =>
          [s.name, s.symbol, s.ticker, s.mnemonic].some((text) =>
            text?.toLowerCase().includes(term),
          ),
        ).map((s) => ({ ...s, wkn: null, detail: null })),
      )
    }
    if (rest === '/market/backfill') return json(backfillOf(q.get('symbol') ?? ''))
    const board = /^\/market\/lists\/(\d+)\/board$/.exec(rest)
    if (board !== null) {
      const list = lists.find((l) => l.id === Number(board[1]))
      return list === undefined ? json({ error: 'unknown list' }, 404) : json(boardOf(list))
    }
    if (rest === '/depot/stats') {
      const found = statsOf(q.get('isin') ?? '')
      return found === null ? json({ error: 'no trade of this instrument' }, 404) : json(found)
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
              unit: row.id === CBBI ? '0 to 100' : 'index points',
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
        unit: row.id === CBBI ? '0 to 100' : 'index points',
        frequency: 'daily',
        points: (INDEX_LEVELS.get(id) ?? []).filter((p) => p.day >= from && p.day <= to),
      })
    }
    if (rest === '/market/candles') return json(candleAnswer(q))
    if (rest === '/market/quote') {
      const eurLine = q.get('mic') === 'XETR'
      return json({
        quotes: (q.get('symbols') ?? '').split(',').map((symbol) => quoteRow(symbol, eurLine)),
      })
    }
    if (rest === '/depot/positions') {
      const rows = [WORLD, SEMIS, ALL_CAP, US_STOCK, BTC_ETP].map(position)
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
        if (typeof body['position'] === 'number') moveTo(lists, list, body['position'])
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
        // An instrument with no history starts its load at once.
        if (pending.has(added) && !backfills.has(added)) {
          backfills.set(added, { state: 'running', reads: 0 })
        }
        return json({ ...listJson(list), backfill: backfillOf(added) })
      }
      if (deleteEntry !== undefined) {
        list.entries = list.entries.filter((e) => e.symbol !== symbol)
        return json(listJson(list))
      }
      const entry = list.entries.find((e) => e.symbol === symbol)
      if (entry === undefined) return json({ error: 'unknown entry' }, 404)
      if ('display_name' in body)
        entry.display_name = (body['display_name'] as string | null) ?? null
      if (typeof body['position'] === 'number') moveTo(list.entries, entry, body['position'])
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

/** The rows of the Board (cards on a phone): one per entry of the tab. */
const boardRows = (page: Page) =>
  page.locator('[data-shot="depot-board"]').locator('tbody tr, [data-activatable="true"]')

const boardRowCount = (page: Page): Promise<number> => boardRows(page).count()

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
 * The page's navigation as the owner meets it: the tabs across the top (no Indices tab), the sidebar grouped by kind with a
 * handle on every row, the menu of a row, a reorder, the add flow that finds AMD and loads its history in front of the
 * reader, a rename and a removal.
 */
async function checkNavigation(
  page: Page,
  origin: string,
  out: string,
  scheme: string,
  device: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  const desktop = device === 'desktop'
  const shot = (name: string) => join(out, `depot--${scheme}--${device}--${name}.png`)
  const order = async (): Promise<string[]> =>
    ((await (await fetch(`${origin}/api/finance/api/market/lists`)).json()) as List[])
      .find((l) => l.id === 1)!
      .entries.toSorted((a, b) => a.position - b.position)
      .map((e) => e.symbol)
  await page.goto(`${origin}/finance/depot?tab=depot`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor()
  const tab = (name: string) => page.getByRole('tab', { name, exact: true })
  for (const name of ['In depot', 'Watchlist', 'Chips', 'Crypto']) {
    if ((await tab(name).count()) === 0) failures.push(`${where}: no "${name}" tab`)
  }
  if ((await tab('Indices').count()) > 0) failures.push(`${where}: an Indices tab is offered`)
  if ((await tab('In depot').getAttribute('aria-selected')) !== 'true') {
    failures.push(`${where}: the depot tab is not the one open`)
  }
  const panel = page.getByRole('tabpanel')
  for (const text of ['units', '%']) {
    if ((await panel.getByText(text).count()) === 0) {
      failures.push(`${where}: the depot tab shows no ${text}`)
    }
  }
  const tabBox = await tab('In depot').boundingBox()
  if (tabBox === null || tabBox.height > 40) {
    failures.push(`${where}: the tabs are not a slim strip (${tabBox?.height}px)`)
  }

  // A list: its rows under kind headers, a handle on each.
  await tab('Watchlist').click()
  for (const header of ['Stocks', 'ETFs', 'Indices']) {
    if ((await panel.getByRole('group', { name: header }).count()) === 0) {
      failures.push(`${where}: no "${header}" group in the list`)
    }
  }
  const handles = await page.locator('[title="Drag to reorder"]').count()
  if (handles === 0) failures.push(`${where}: the rows have no drag handle`)
  await page.waitForTimeout(300)
  await panel.screenshot({ path: shot('sidebar') })

  // The menu of a row: right-click, or its button where there is no mouse.
  const semis = panel.getByRole('button', { name: /^Semiconductor ETF/ }).first()
  if (desktop) await semis.click({ button: 'right' })
  else await panel.getByRole('button', { name: 'Options for Semiconductor ETF' }).click()
  for (const item of [
    'Rename',
    'Move to list',
    'Move up',
    'Move down',
    'Open in board',
    'Remove from list',
  ]) {
    if ((await page.getByRole('menuitem', { name: item }).count()) === 0) {
      failures.push(`${where}: the row menu has no "${item}"`)
    }
  }
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot('menu') })
  // Moving a row down puts it behind the next fund of its group, and the order is the service's.
  const before = await order()
  await page.getByRole('menuitem', { name: 'Move down' }).click()
  await page.waitForTimeout(500)
  const moved = await order()
  if (moved.indexOf(SEMIS) <= before.indexOf(SEMIS)) {
    failures.push(`${where}: "Move down" left the order at ${moved.join(', ')}`)
  }
  if (desktop) {
    // And back by dragging the handle onto the row it passed.
    const rowOf = (name: string) => page.locator('[data-row]').filter({ hasText: name })
    await rowOf('Semiconductor ETF')
      .locator('[title="Drag to reorder"]')
      .dragTo(rowOf('Global all-cap ETF'))
    await page.waitForTimeout(500)
    const dragged = await order()
    if (dragged.indexOf(SEMIS) >= moved.indexOf(SEMIS)) {
      failures.push(`${where}: dragging the handle left the order at ${dragged.join(', ')}`)
    }
  }

  // The add flow: AMD is found by its ticker, added to this list, its history loads in the entry and in the main area.
  await page.keyboard.press('/')
  const search = page.getByRole('combobox', { name: 'Search instruments' })
  await search.type('amd', { delay: 20 })
  const option = page.getByRole('option', { name: /Advanced Micro Devices/ })
  await option.waitFor({ timeout: 4000 })
  const optionText = await option.innerText()
  for (const part of ['Stock', 'AMD', AMD]) {
    if (!optionText.includes(part))
      failures.push(`${where}: the AMD hit lacks "${part}": ${optionText}`)
  }
  await page.screenshot({ path: shot('search') })
  await page.keyboard.press('Enter')
  const loading = page.locator('[data-shot="depot-loading"]')
  await loading.waitFor({ timeout: 4000 })
  await panel
    .getByText(/Loading history/)
    .first()
    .waitFor({ timeout: 4000 })
  await page.waitForTimeout(3200)
  if ((await loading.innerText()).match(/days since/) === null) {
    failures.push(`${where}: the loading card shows no progress: ${await loading.innerText()}`)
  }
  await page.screenshot({ path: shot('backfill') })
  await fetch(`${origin}/api/__finish`)
  await page.locator('canvas').first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(900)
  if ((await loading.count()) > 0)
    failures.push(`${where}: the loading card stays after the bars exist`)
  if (
    (await page.locator('[data-shot="depot-chart"]').innerText()).includes(
      'Advanced Micro Devices',
    ) === false
  ) {
    failures.push(`${where}: the chart did not open on the added instrument`)
  }
  await page.screenshot({ path: shot('added') })

  // A rename and a removal, from the menu.
  const amd = panel.getByRole('button', { name: /^Advanced Micro Devices/ }).first()
  if (desktop) await amd.click({ button: 'right' })
  else await panel.getByRole('button', { name: 'Options for Advanced Micro Devices' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const name = page.getByLabel('Name of Advanced Micro Devices')
  await name.fill('AMD core')
  await name.press('Enter')
  await panel
    .getByRole('button', { name: /^AMD core/ })
    .first()
    .waitFor({ timeout: 4000 })
  if (desktop)
    await panel
      .getByRole('button', { name: /^AMD core/ })
      .first()
      .click({ button: 'right' })
  else await panel.getByRole('button', { name: 'Options for AMD core' }).click()
  await page.getByRole('menuitem', { name: 'Remove from list' }).click()
  await panel
    .getByRole('button', { name: /^AMD core/ })
    .waitFor({ state: 'detached', timeout: 4000 })
    .catch(() => failures.push(`${where}: the removed entry is still listed`))
}

/**
 * The three views and the built-in tabs: a board of the list that sorts and opens a chart, the details of the US stock
 * with its statistics and its order (and no "FIFO" outside one tooltip), the FTSE index as candles from its first stored
 * day, a close-only series as a line with its hint, and Crypto with Bitcoin and the CBBI.
 */
async function checkViews(
  page: Page,
  origin: string,
  out: string,
  scheme: string,
  device: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  const shot = (name: string) => join(out, `depot--${scheme}--${device}--${name}.png`)
  const open = async (query: string) => {
    await page.goto(`${origin}/finance/depot?${query}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
  }

  // Board: the list as a table, sortable, a click opens the chart.
  await open('tab=list-1&view=board')
  const board = page.locator('[data-shot="depot-board"]')
  await board.waitFor()
  await page.waitForTimeout(500)
  const boardText = await board.innerText()
  for (const part of [
    ...(device === 'desktop' ? ['Day', 'Week', 'Month', 'YTD', '1Y', 'From high'] : []),
    'Semiconductor ETF',
    'FTSE Global All Cap',
  ]) {
    if (!boardText.toLowerCase().includes(part.toLowerCase()))
      failures.push(`${where}: the board lacks "${part}"`)
  }
  if (/FIFO/.test(await page.evaluate(() => document.body.innerText))) {
    failures.push(`${where}: "FIFO" is on the board`)
  }
  await page.screenshot({ path: shot('board') })
  // Every entry of the list is a row: seven on the default list, FTSE and the US stock among them.
  const listRows = await boardRowCount(page)
  if (listRows !== 7) failures.push(`${where}: the list board has ${listRows} rows, expected 7`)
  await board.getByText('Semiconductor ETF').first().click()
  await page.locator('canvas').first().waitFor()
  if ((await page.locator('[data-shot="depot-board"]').count()) > 0) {
    failures.push(`${where}: a board row did not open the chart`)
  }

  // In depot: every held row, also Bitcoin, which sits on no list (its figures come from its own bars).
  await open('tab=depot&view=board')
  await board.waitFor()
  await page.waitForTimeout(900)
  const depotRows = await boardRowCount(page)
  if (depotRows !== 5) failures.push(`${where}: the depot board has ${depotRows} rows, expected 5`)
  const depotText = await board.innerText()
  for (const part of [
    'World equity ETF',
    'Semiconductor ETF',
    'Global all-cap ETF',
    'US chip stock',
    'Bitcoin',
  ]) {
    if (!depotText.includes(part)) failures.push(`${where}: the depot board lacks "${part}"`)
  }
  if ((await boardRows(page).filter({ hasText: 'Bitcoin' }).first().innerText()).includes('—')) {
    failures.push(`${where}: the Bitcoin row has no figures`)
  }
  await page.screenshot({ path: shot('board-depot') })
  await open('tab=crypto&view=board')
  await board.waitFor()
  await page.waitForTimeout(900)
  const coinRows = await boardRowCount(page)
  if (coinRows !== 1) failures.push(`${where}: the Crypto board has ${coinRows} rows, expected 1`)

  // Details of the US stock: position, statistics, trades, the open order.
  await open(`isin=${US_STOCK}&view=details`)
  const details = page.locator('[data-shot="depot-stats"]')
  await details.waitFor()
  await page.waitForTimeout(600)
  const detailsText = await page.evaluate(() => document.body.innerText)
  for (const part of [
    'Average cost',
    'Gain with this instrument',
    'Realised gain',
    'Largest holding',
    'From the high',
    'Trades',
    'Open orders',
    'Sell limit',
    ...(device === 'desktop' ? ['Price (USD)'] : []),
  ]) {
    if (!detailsText.toLowerCase().includes(part.toLowerCase()))
      failures.push(`${where}: the details lack "${part}"`)
  }
  if (/FIFO/.test(detailsText)) failures.push(`${where}: "FIFO" is on the page outside its tooltip`)
  await page.screenshot({ path: shot('details'), fullPage: true })

  // FTSE Global All Cap: real candles from the first stored day.
  await open(`isin=${FTSE}&tab=list-1`)
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(700)
  const reported = await timeframe(page, 'Max')
  if (reported !== 'Max') failures.push(`${where}: the index on Max reads as "${reported}"`)
  await page.waitForTimeout(500)
  const first = await hostAttr(page, 'firstDay')
  if (first !== '2013-03-01')
    failures.push(`${where}: the index starts on ${first}, not 2013-03-01`)
  if ((await page.locator('[data-shot="depot-line-hint"]').count()) > 0) {
    failures.push(`${where}: the FTSE index has real bars and is drawn as a line`)
  }
  if ((await hostAttr(page, 'spliceShape')) === 'line') {
    failures.push(`${where}: the FTSE index has real bars and the chart is in line mode`)
  }
  await page.screenshot({ path: shot('index-candles') })
  // The same index at month bars: candles too.
  await open(`isin=${FTSE}&tab=list-1&ivl=1mo`)
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(700)
  await timeframe(page, 'Max')
  if ((await page.locator('[data-shot="depot-line-hint"]').count()) > 0) {
    failures.push(`${where}: the FTSE index is a line at month bars`)
  }
  await page.screenshot({ path: shot('index-candles-1mo') })

  // A series with closes only: a line, and it says so.
  await open('isin=msci-world-net-eur&tab=list-1')
  await page
    .locator('canvas')
    .first()
    .waitFor()
    .catch(() => undefined)
  const hint = page.locator('[data-shot="depot-line-hint"]')
  if ((await hint.count()) > 0) await page.screenshot({ path: shot('index-line') })

  // Crypto: Bitcoin in dollars and the CBBI, nothing more.
  await open('tab=crypto')
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(900)
  const rows = await page
    .getByRole('tabpanel')
    .getByRole('button', { name: /^Bitcoin/ })
    .count()
  if (rows !== 1) failures.push(`${where}: Crypto lists ${rows} Bitcoin rows`)
  const cbbi = page.locator('[data-shot="depot-cbbi"]')
  await cbbi.waitFor()
  const cbbiText = await cbbi.innerText()
  if (!/\d+\s*of 100/.test(cbbiText.replace(/\n/g, ' '))) {
    failures.push(`${where}: the CBBI panel shows no reading out of 100: ${cbbiText}`)
  }
  if ((await page.getByRole('combobox', { name: 'Search instruments' }).count()) > 0) {
    failures.push(`${where}: Crypto offers a search`)
  }
  await page.screenshot({ path: shot('crypto') })
  const toggle = cbbi.getByRole('switch', { name: 'Line' })
  await toggle.click({ force: true })
  await page.waitForTimeout(300)
  if ((await cbbi.getByText('The line is hidden').count()) === 0) {
    failures.push(`${where}: the CBBI switch does not hide the line`)
  }
  await toggle.click({ force: true })
}

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

/** The share of the visible width empty right of the newest bar, off the host. */
const rightGap = async (page: Page) => Number(await hostAttr(page, 'rightGap'))

/**
 * A weekly comparison of the young fund over its whole history: the splice is continuous (one percent base: the unit test
 * holds the data to one series, the shot shows the splice) and about 5 % of the width stays free right of the newest bar after the load, a
 * timeframe button, the interval change and back.
 */
async function checkCompareWeekly(
  page: Page,
  origin: string,
  scheme: string,
  device: string,
  out: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  await page.goto(`${origin}/finance/depot?isin=${ALL_CAP}&ivl=1w&cmp=msci-acwi-imi-net-eur`, {
    waitUntil: 'networkidle',
  })
  await page.locator('canvas').first().waitFor()
  await page.locator('[data-shot="depot-compare-chip"]').waitFor()
  await page.waitForTimeout(900)
  const gaps: Record<string, number> = { load: await rightGap(page) }
  await timeframe(page, 'Max')
  await page.waitForTimeout(500)
  gaps['Max'] = await rightGap(page)
  await timeframe(page, '1Y')
  await page.waitForTimeout(500)
  gaps['1Y'] = await rightGap(page)
  await timeframe(page, 'Max')
  await page.waitForTimeout(500)
  for (const [name, gap] of Object.entries(gaps)) {
    if (!(gap > 0.04 && gap < 0.06)) {
      failures.push(`${where}: the right margin after ${name} is ${gap}, not about 0.05`)
    }
  }
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--compare-young-1w.png`),
  })
}

/**
 * The labels of the order and cost lines: at the left edge, and gone (with the lines and the axis prices staying) after
 * the toolbar's "Beschriftung" toggle.
 */
async function checkLineLabels(
  page: Page,
  origin: string,
  scheme: string,
  device: string,
  out: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  await page.goto(`${origin}/finance/depot?isin=${US_STOCK}`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(900)
  const toggle = page.getByRole('button', { name: /text labels of horizontal and vertical lines/ })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click()
    await page.waitForTimeout(300)
  }
  if (Number(await hostAttr(page, 'lineLabels')) < 2) {
    failures.push(`${where}: the order and cost labels are not drawn`)
  }
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--labels-left.png`),
  })
  await toggle.click()
  await page.waitForTimeout(300)
  if (
    (await toggle.getAttribute('aria-pressed')) !== 'false' ||
    (await hostAttr(page, 'lineLabels')) !== '0'
  ) {
    failures.push(`${where}: "Beschriftung" does not hide the labels`)
  }
  if ((await hostAttr(page, 'lines')).split('|').length < 2) {
    failures.push(`${where}: hiding the labels removed the lines`)
  }
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--labels-hidden.png`),
  })
  await toggle.click()
  await page.waitForTimeout(300)
}

/**
 * A young fund: its history opens with the index it tracks, the comparison waits to be asked for, and the same fund
 * against an index of a similar size reads on a percent scale.
 */
async function checkSpliced(
  page: Page,
  origin: string,
  scheme: string,
  device: string,
  out: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  await page.goto(`${origin}/finance/depot?isin=${ALL_CAP}`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(900)
  if (Number(await hostAttr(page, 'spliced')) < 100) {
    failures.push(`${where}: the young fund's history does not open with its index`)
  }
  if ((await page.getByText('Index, scaled to the ETF price').count()) === 0) {
    failures.push(`${where}: the spliced history is not labelled`)
  }
  if ((await hostAttr(page, 'spliceShape')) !== 'candles') {
    failures.push(`${where}: the spliced history is not drawn as candles`)
  }
  if ((await hostAttr(page, 'scale')) !== 'linear') {
    failures.push(`${where}: the comparison is on without being asked for`)
  }
  await timeframe(page, 'Max')
  await page.waitForTimeout(500)
  await page.locator('[data-shot="depot-chart"]').screenshot({
    path: join(out, `depot--${scheme}--${device}--spliced.png`),
  })
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

/**
 * What a pick in the sidebar does: Details and Chart stay where they are; and the chart fills the height under the page bar
 * of a window, taller with the window, with nothing to scroll; a phone keeps a fixed height.
 */
/**
 * An index entry shows the fund that tracks it: its order and trades on the index chart at the index level, in dollars
 * and in euros, its position in Details with the add-order form preselecting it, and a dollar stock in euros, where a
 * typed line is still stored in dollars.
 */
async function checkTracking(
  page: Page,
  origin: string,
  out: string,
  scheme: string,
  device: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  const goto = async (query: string) => {
    await page.goto(`${origin}/finance/depot?${query}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
  }
  const euro = () =>
    page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: 'EUR' })
  const chart = page.locator('[data-shot="depot-chart"]')
  const levelOf = async () => Number((await hostAttr(page, 'markLevels')).split(',')[0])

  await goto(`isin=${FTSE}`)
  await page.locator('canvas').first().waitFor()
  const dollars = await levelOf()
  if (!/^Kauf Limit [\d.,]+ €( · [^|]+)?$/.test(await hostAttr(page, 'lines'))) {
    failures.push(`${where}: the index chart has no order line: "${await hostAttr(page, 'lines')}"`)
  }
  await euro().click()
  await page.waitForTimeout(900)
  const euros = await levelOf()
  // The stand-in's rate is about 1.1 dollars per euro: the same trade sits lower on the euro chart.
  if (!(euros > 0 && euros < dollars)) {
    failures.push(`${where}: the trade marker level is ${dollars} in dollars and ${euros} in euros`)
  }
  if (!(await chart.innerText()).includes('· EUR')) {
    failures.push(`${where}: the euro chart does not say so in its title`)
  }
  await page.screenshot({ path: join(out, `depot--${scheme}--${device}--index-eur.png`) })
  await goto(`isin=${FTSE}&ivl=1w`)
  if ((await euro().getAttribute('aria-pressed')) !== 'true') {
    failures.push(`${where}: the euro choice is not remembered`)
  }
  await goto(`isin=${FTSE}&view=details`)
  await page.locator('[data-shot="depot-tracked"]').waitFor()
  await page.screenshot({
    path: join(out, `depot--${scheme}--${device}--index-details.png`),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Add order' }).first().click()
  const dialog = page.getByRole('dialog')
  const chosen = await dialog
    .getByRole('combobox', { name: 'ETF' })
    .or(dialog.getByRole('textbox', { name: 'ETF' }))
    .first()
    .inputValue()
  if (chosen !== 'Global all-cap ETF') {
    failures.push(`${where}: the order form preselects "${chosen}"`)
  }
  await dialog.getByLabel('Quantity').fill('3')
  await dialog.getByLabel('Limit price (€)').fill('100')
  const note = await dialog.locator('[data-shot="order-usd"]').innerText()
  if (!/^≈ [\d.,]+ \$ at /.test(note)) failures.push(`${where}: the dollar note reads "${note}"`)
  await page.screenshot({ path: join(out, `depot--${scheme}--${device}--index-order-modal.png`) })
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await goto(`isin=${US_STOCK}`)
  await page.locator('canvas').first().waitFor()
  await euro().click()
  await page.waitForTimeout(900)
  if (!/^Verkauf Limit [\d.,]+ €/.test(await hostAttr(page, 'lines'))) {
    failures.push(`${where}: the stock in euros reads "${await hostAttr(page, 'lines')}"`)
  }
  await page.screenshot({ path: join(out, `depot--${scheme}--${device}--us-stock-eur.png`) })
  // A line typed at 100 € is stored in dollars, at the latest rate.
  const box = await page.locator(CHART).boundingBox()
  if (box === null) throw new Error('the chart has no box')
  await page
    .getByRole('toolbar', { name: 'Drawing tools' })
    .getByRole('button', { name: 'Horizontal line' })
    .click()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4)
  const field = page.getByLabel('Price of the selected line')
  await field.waitFor({ timeout: 3000 })
  await field.fill('100')
  await field.press('Enter')
  await page.waitForTimeout(1200)
  const rate = INDEX_LEVELS.get('eur-usd')?.at(-1)?.value ?? 0
  const held = await storedLinePrices(page, US_STOCK)
  if (!held.some((price) => Math.abs(price - 100 * rate) < 0.01)) {
    failures.push(`${where}: a 100 € line is stored as ${held.join(', ')}, rate ${rate}`)
  }
  // Back in dollars the same line reads at its stored price.
  await page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: 'USD' }).click()
  await page.waitForTimeout(900)
  const after = await storedLinePrices(page, US_STOCK)
  if (after.join() !== held.join()) {
    failures.push(`${where}: switching the currency changed the stored line: ${after.join(', ')}`)
  }
}

async function checkLayout(
  page: Page,
  origin: string,
  out: string,
  scheme: string,
  device: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  const goto = async (query: string) => {
    await page.goto(`${origin}/finance/depot?${query}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
  }
  const panel = page.getByRole('tabpanel')

  // Details: another instrument stays in Details.
  await goto(`isin=${WORLD}&view=details`)
  await page.locator('[data-shot="depot-stats"]').waitFor()
  await panel
    .getByRole('button', { name: /^Semiconductor ETF/ })
    .first()
    .click()
  await page.waitForTimeout(500)
  // The address bar drops what is the default; what stays is read off the page: Details, with the picked fund's 130 units.
  const stats = page.locator('[data-shot="depot-stats"]')
  await stats.waitFor()
  if (
    (await page.locator('[data-shot="depot-chart"]').count()) > 0 ||
    !(await stats.innerText()).includes('130')
  ) {
    failures.push(`${where}: a pick in Details did not stay in Details on the picked fund`)
  }
  // Chart: the same pick stays in Chart.
  await goto(`isin=${WORLD}&view=chart`)
  await page.locator('canvas').first().waitFor()
  await panel
    .getByRole('button', { name: /^Semiconductor ETF/ })
    .first()
    .click()
  await page.waitForTimeout(500)
  await page.locator('canvas').first().waitFor()
  if ((await page.locator('[data-shot="depot-stats"]').count()) > 0) {
    failures.push(`${where}: a pick in Chart left it`)
  }

  const measure = () =>
    page.evaluate(() => {
      const card = document.querySelector('[data-shot="depot-chart"]')?.getBoundingClientRect()
      const frame = document.querySelector('[data-depot-frame]')?.getBoundingClientRect()
      const main = document.querySelector('main')
      return {
        bottom: card?.bottom ?? 0,
        frame: frame?.height ?? 0,
        scroll: main === null ? 0 : main.scrollHeight - main.clientHeight,
        window: window.innerHeight,
      }
    })
  if (device === 'mobile') {
    await goto(`isin=${WORLD}`)
    await page.locator('canvas').first().waitFor()
    const { frame } = await measure()
    if (frame < 380 || frame > 760) failures.push(`${where}: the phone chart is ${frame}px tall`)
    return
  }
  const size = page.viewportSize()
  const heights = []
  for (const height of [820, 1100]) {
    await page.setViewportSize({ width: 1440, height })
    await goto(`isin=${WORLD}`)
    await page.locator('canvas').first().waitFor()
    await page.waitForTimeout(600)
    const read = await measure()
    heights.push(read.frame)
    // The card ends inside the window and nothing scrolls: the chart took the height that was left.
    if (read.bottom > read.window + 1) {
      failures.push(`${where}: at ${height}px the chart card ends at ${read.bottom}px`)
    }
    if (read.scroll > 1)
      failures.push(`${where}: at ${height}px the page scrolls by ${read.scroll}px`)
    await page.screenshot({ path: join(out, `depot--${scheme}--${device}--fill-${height}.png`) })
  }
  if (heights[1] === undefined || heights[0] === undefined || heights[1] < heights[0] + 200) {
    failures.push(`${where}: the chart does not follow the window height: ${heights.join(' -> ')}`)
  }
  if (size !== null) await page.setViewportSize(size)
}

/**
 * The live layer: the quote line and its status per market, Direkthandel's bid and ask, the venue switch, a candle that
 * changes in place, the live Board and the order form that starts at the ask.
 */
async function checkLive(
  page: Page,
  origin: string,
  out: string,
  scheme: string,
  device: string,
  failures: string[],
): Promise<void> {
  const where = `${scheme}/${device}`
  const shot = (name: string) => join(out, `depot--${scheme}--${device}--${name}.png`)
  const status = () => page.locator('[data-shot="depot-quote-status"]').innerText()
  const open = async (query: string) => {
    await page.goto(`${origin}/finance/depot?${query}`, { waitUntil: 'networkidle' })
    await page.locator('canvas').first().waitFor()
    await page.waitForTimeout(900)
  }
  await fetch(`${origin}/api/__tick?move=1.03`)

  await open(`isin=${WORLD}`)
  if ((await status()).toLowerCase() !== 'live')
    failures.push(`${where}: the ETF reads "${await status()}"`)
  const lag = await page.locator('[data-shot="depot-candle-lag"]').innerText()
  if (lag !== 'Kerze 15 Min. verzögert')
    failures.push(`${where}: the running candle reads "${lag}"`)
  const lines = await hostAttr(page, 'lines')
  if (!/Geld [\d.,]+ €/.test(lines) || !/Brief [\d.,]+ €/.test(lines)) {
    failures.push(`${where}: no bid and ask lines: "${lines}"`)
  }
  await page.screenshot({ path: shot('live') })
  // A new price: the tab coming back asks at once, and the candle changes where it is.
  const before = [await hostAttr(page, 'bars'), await hostAttr(page, 'logicalFrom')].join('/')
  await fetch(`${origin}/api/__tick?move=1.045`)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await page.waitForTimeout(1200)
  const after = [await hostAttr(page, 'bars'), await hostAttr(page, 'logicalFrom')].join('/')
  if (!(Number(await hostAttr(page, 'updates')) > 0)) {
    failures.push(`${where}: the new price did not update the candle in place`)
  }
  if (before !== after)
    failures.push(`${where}: the view moved on an update: ${before} then ${after}`)

  await page.getByRole('button', { name: 'ING Direkthandel', exact: true }).click()
  await page.locator('[data-shot="depot-direct-hint"]').waitFor()
  await page.waitForTimeout(900)
  const title = await page.locator('[data-shot="depot-chart"]').innerText()
  if (!title.includes('· ING Direkthandel'))
    failures.push(`${where}: the venue is not in the title`)
  const hint = await page.locator('[data-shot="depot-direct-hint"]').innerText()
  if (!/only 1\d stored days/.test(hint))
    failures.push(`${where}: the short history reads "${hint}"`)
  if ((await page.locator('[data-shot="depot-candle-lag"]').count()) !== 0) {
    failures.push(`${where}: Direkthandel's candle is called delayed`)
  }
  await page.screenshot({ path: shot('live-direct') })
  await page.getByRole('button', { name: 'Xetra', exact: true }).click()

  await open(`isin=${US_STOCK}`)
  if (!(await status()).startsWith('Börse geschlossen · Schluss')) {
    failures.push(`${where}: the US stock outside its hours reads "${await status()}"`)
  }
  await page.screenshot({ path: shot('live-us-closed') })

  await open('isin=BTC-USD')
  if ((await status()).toLowerCase() !== 'live')
    failures.push(`${where}: Bitcoin reads "${await status()}"`)
  await page.locator('[data-shot="depot-quote-status"]').hover()
  await page.getByText('ab 00:00 UTC').waitFor()
  await page.screenshot({ path: shot('live-btc') })

  await page.goto(`${origin}/finance/depot?isin=${WORLD}&view=board`, { waitUntil: 'networkidle' })
  await page.locator('[data-shot="depot-board-live"]').first().waitFor()
  await page.waitForTimeout(900)
  await page.screenshot({ path: shot('live-board') })

  await page.goto(`${origin}/finance/depot?isin=${WORLD}&view=details`, {
    waitUntil: 'networkidle',
  })
  await page.getByRole('button', { name: 'Add order' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('[data-shot="order-spread"]').waitFor()
  const spread = await dialog.locator('[data-shot="order-spread"]').innerText()
  const field = dialog.getByLabel('Limit price')
  const ask = german(/Brief ([\d.,]+)/.exec(spread)?.[1] ?? '')
  const bid = german(/Geld ([\d.,]+)/.exec(spread)?.[1] ?? '')
  const filled = async () => Number.parseFloat((await field.inputValue()).replace(',', '.'))
  if (Math.abs((await filled()) - ask) > 0.01) {
    failures.push(`${where}: a buy starts at ${await filled()}, the ask is ${ask}`)
  }
  await page.screenshot({ path: shot('live-order') })
  await dialog.getByLabel('Side').click()
  await page.getByRole('option', { name: 'Sell' }).click()
  await page.waitForTimeout(300)
  if (Math.abs((await filled()) - bid) > 0.01) {
    failures.push(`${where}: a sale starts at ${await filled()}, the bid is ${bid}`)
  }
  await dialog.getByRole('button', { name: 'Cancel' }).click()
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
        await page.goto(`${origin}/finance/depot?isin=${WORLD}`, { waitUntil: 'networkidle' })
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
        // Orders live in the Details view: the drawings save first, then the order is added there and the chart comes back.
        await page.waitForTimeout(900)
        await page.goto(`${origin}/finance/depot?isin=${WORLD}&view=details`, {
          waitUntil: 'networkidle',
        })
        await addOrder(page)
        await page.goto(`${origin}/finance/depot?isin=${WORLD}&view=chart`, {
          waitUntil: 'networkidle',
        })
        await page.locator('canvas').first().waitFor()
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
        await checkFacts(page, where, failures, {
          orderLine: /^Kauf Limit 112 € · Brief [\d.,]+ € · [+−]?[\d.,]+ %$/,
        })
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
          // Closing the order takes its row, and with it its line, away (the orders are in the Details view).
          await page.goto(`${origin}/finance/depot?isin=${WORLD}&view=details`, {
            waitUntil: 'networkidle',
          })
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
          ['1w', `?isin=${WORLD}&ivl=1w`],
          ['btc-usd', '?isin=BTC-USD'],
          ['btc-usd--1w', '?isin=BTC-USD&ivl=1w'],
          ['us-stock', `?isin=${US_STOCK}`],
          ...(scheme === 'light' && device === 'desktop'
            ? ([['1mo', `?isin=${WORLD}&ivl=1mo`]] as [string, string][])
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
              orderLine: /^Verkauf Limit [\d.,]+ € \([\d.,]+ \$\) · Geld /,
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
        await checkCompare(page, origin, scheme, device, out, failures)
        await checkSpliced(page, origin, scheme, device, out, failures)
        await checkCompareWeekly(page, origin, scheme, device, out, failures)
        await checkLineLabels(page, origin, scheme, device, out, failures)
        await checkLayout(page, origin, out, scheme, device, failures)
        await checkViews(page, origin, out, scheme, device, failures)
        await checkNavigation(page, origin, out, scheme, device, failures)
        await fetch(`${origin}/api/__reset`)
        await checkTracking(page, origin, out, scheme, device, failures)
        await fetch(`${origin}/api/__reset`)
        await checkLive(page, origin, out, scheme, device, failures)
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
