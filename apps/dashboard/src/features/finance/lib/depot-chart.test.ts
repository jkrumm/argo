import { describe, expect, it } from 'bun:test'
import type { ChartBar, DepotPosition, DepotTrade } from '../api/types'
import {
  barOfDay,
  activeTimeframe,
  buildDrawingsDocument,
  allTimeHigh,
  candleWindow,
  changeFrom,
  changeOf,
  costLine,
  costLineUsd,
  dayToSeconds,
  defaultViewStart,
  depotInterval,
  distanceFromHigh,
  firstBarFrom,
  hasTurnover,
  heldRows,
  historyCandles,
  instrumentsOf,
  launchTime,
  logByDefault,
  markGroups,
  marksByBar,
  mergedPosition,
  pickInstrument,
  rangeStart,
  rightMarginBars,
  levelsAtBars,
  signedPercent,
  splitSpliced,
  storedEntries,
  storedRoles,
  timeframeFits,
  timeframeStart,
  tradeCards,
  tradeMarks,
  unreadEntries,
  volumeByDefault,
} from './depot-chart'

const bar = (time: number, close = 10): ChartBar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  units: null,
  turnover: null,
  source: null,
})
const day = (d: string) => dayToSeconds(d)

const trade = (id: number, booked_on: string, over: Partial<DepotTrade> = {}): DepotTrade =>
  ({ id, booked_on, side: 'buy', quantity_source: 'document', ...over }) as DepotTrade

const buy = (id: number, booked_on: string, quantity: number, price_usd: number | null) =>
  trade(id, booked_on, { quantity, price_usd })

const heldPosition = (isin: string, quantity: number, value: number, cost: number) =>
  ({
    isin,
    quantity,
    value_cents: value,
    cost_fifo_cents: cost,
    cost_average_cents: cost,
    unrealised_fifo_cents: value - cost,
    unrealised_average_cents: value - cost,
    quantity_source: 'document',
    lots: [],
  }) as unknown as DepotPosition

describe('candleWindow', () => {
  it('counts back from today at day; week and month load the whole history', () => {
    expect(candleWindow('1y', '1d', '2026-11-22')).toEqual({ from: '2025-11-21', to: '2026-11-22' })
    expect(candleWindow('1m', '1w', '2026-11-22')).toEqual({ to: '2026-11-22' })
    expect(candleWindow('1y', '1mo', '2026-11-22')).toEqual({ to: '2026-11-22' })
  })
  it('keeps a daily request under the 20,000 bars the service allows', () => {
    expect(candleWindow('max', '1d', '2026-11-22').from).toBe('1972-02-29')
    expect(candleWindow('5y', '1d', '2026-11-22').from).toBe('2021-11-21')
  })
  it('offers day, week and month only', () => {
    expect(depotInterval('1w', '1d')).toBe('1w')
    expect(depotInterval('15m', '1d')).toBe('1d')
    expect(depotInterval('1h', '1d')).toBe('1d')
    expect(depotInterval(undefined, '1mo')).toBe('1mo')
  })
})

describe('barOfDay', () => {
  const daily = [day('2026-11-18'), day('2026-11-19'), day('2026-11-20'), day('2026-11-23')].map(
    (t) => bar(t),
  )
  it('finds the bar of the day, or the last one before a weekend booking', () => {
    expect(barOfDay(daily, '2026-11-19', '1d')).toBe(day('2026-11-19'))
    expect(barOfDay(daily, '2026-11-22', '1d')).toBe(day('2026-11-20'))
  })
  it('has no bar before the chart starts', () => {
    expect(barOfDay(daily, '2026-11-01', '1d')).toBeNull()
  })
  it('puts a booking on the week or month that contains it', () => {
    const weeks = [day('2026-11-09'), day('2026-11-16')].map((t) => bar(t))
    expect(barOfDay(weeks, '2026-11-19', '1w')).toBe(day('2026-11-16'))
    const months = [day('2026-10-01'), day('2026-11-01')].map((t) => bar(t))
    expect(barOfDay(months, '2026-10-30', '1mo')).toBe(day('2026-10-01'))
  })
})

describe('tradeMarks', () => {
  const bars = [day('2026-11-19'), day('2026-11-20')].map((t) => bar(t))
  it('draws one mark per trade that has a bar, flags estimated quantities, groups by bar', () => {
    const marks = tradeMarks(
      [
        trade(2, '2026-11-20', { side: 'sell' }),
        trade(1, '2026-11-19', { quantity_source: 'estimated' }),
        trade(3, '2026-11-20'),
        trade(4, '2026-01-01'),
      ],
      bars,
      '1d',
    )
    expect(marks.map((x) => [x.trade.id, x.side, x.estimated])).toEqual([
      [1, 'buy', true],
      [2, 'sell', false],
      [3, 'buy', false],
    ])
    expect(marksByBar(marks).get(day('2026-11-20'))).toHaveLength(2)
  })
})

describe('markGroups', () => {
  const bars = [day('2026-11-02'), day('2026-11-09')].map((t) => bar(t))
  const marks = tradeMarks(
    [
      trade(1, '2026-11-03'),
      trade(2, '2026-11-05'),
      trade(3, '2026-11-06', { side: 'sell' }),
      trade(4, '2026-11-10', { quantity_source: 'estimated' }),
    ],
    bars,
    '1w',
  )
  it('draws one marker per bar and side, with the number of trades in it', () => {
    expect(markGroups(marks)).toEqual([
      { time: day('2026-11-02'), side: 'buy', count: 2, estimated: false },
      { time: day('2026-11-02'), side: 'sell', count: 1, estimated: false },
      { time: day('2026-11-09'), side: 'buy', count: 1, estimated: true },
    ])
  })
  it('is a circle only when every quantity in it is a guess', () => {
    const mixed = tradeMarks(
      [trade(1, '2026-11-03', { quantity_source: 'estimated' }), trade(2, '2026-11-04')],
      bars,
      '1w',
    )
    expect(markGroups(mixed)[0]?.estimated).toBe(false)
  })
})

describe('tradeCards', () => {
  const bars = [bar(day('2026-11-02'))]
  const cards = (trades: DepotTrade[], usd = false) =>
    tradeCards(tradeMarks(trades, bars, '1w'), usd)
  const value = (rows: { label: string; value: string }[], label: string) =>
    rows.find((row) => row.label === label)?.value
  it('names day, side, units, price, amount and fee, with the dollar price on a dollar chart', () => {
    const [card] = cards(
      [
        trade(1, '2026-11-03', {
          quantity: 0.5,
          price: 64_000,
          amount_cents: 3_200_000,
          fee_cents: 490,
          price_usd: 67_200,
        }),
      ],
      true,
    )
    expect(card?.title).toBe('Bought · 03.11.2026')
    expect(value(card?.rows ?? [], 'Units')).toBe('0,5')
    expect(value(card?.rows ?? [], 'Price')).toBe('64.000 €')
    expect(value(card?.rows ?? [], 'Price (USD)')).toBe('67.200 $')
    expect(value(card?.rows ?? [], 'Amount')).toBe('32.000,00 €')
    expect(value(card?.rows ?? [], 'Fee')).toBe('4,90 €')
    expect(value(card?.rows ?? [], 'Realised gain')).toBeUndefined()
  })
  it('marks an estimated quantity and shows the realised gain of a sale with its tone', () => {
    const [card] = cards([
      trade(2, '2026-11-04', {
        side: 'sell',
        quantity: 3,
        quantity_source: 'estimated',
        price: 51,
        amount_cents: 15_300,
        fee_cents: null,
        realised_fifo_cents: -1_250,
      }),
    ])
    expect(card?.title).toBe('Sold · 04.11.2026')
    expect(value(card?.rows ?? [], 'Units')).toBe('≈ 3')
    expect(card?.rows.some((row) => row.label === 'Fee')).toBe(false)
    expect(card?.rows.find((row) => row.label === 'Realised gain')).toMatchObject({ tone: 'bad' })
  })
  it('says so when the quantity is unknown, a card per trade', () => {
    const list = cards([
      trade(1, '2026-11-03', { quantity: null, price: null, fee_cents: null, amount_cents: 100 }),
      trade(2, '2026-11-04', { quantity: 1, price: 100, fee_cents: null, amount_cents: 100 }),
    ])
    expect(list).toHaveLength(2)
    expect(value(list[0]?.rows ?? [], 'Units')).toBe('unknown')
  })
})

describe('lines', () => {
  it('puts the average cost per unit on an open position only', () => {
    const position = { quantity: 4, cost_average_cents: 20_000 } as DepotPosition
    expect(costLine(position)).toMatchObject({ price: 50, kind: 'cost' })
    expect(costLine({ ...position, quantity: 0 })).toBeNull()
    expect(costLine(undefined)).toBeNull()
  })
})

describe('costLineUsd', () => {
  const position = {
    quantity: 3,
    lots: [
      { acquired_on: '2026-10-01', quantity: 1, cost_cents: 0 },
      { acquired_on: '2026-11-03', quantity: 2, cost_cents: 0 },
    ],
  } as DepotPosition
  it('prices every open lot at the dollar price of its buy', () => {
    const line = costLineUsd(position, [
      buy(1, '2026-10-01', 1, 60_000),
      buy(2, '2026-11-03', 2, 69_000),
    ])
    expect(line?.price).toBeCloseTo(66_000)
    expect(line?.title).toBe('Average cost 66.000 $')
  })
  it('has no line when a lot has no dollar price, or the position no lots', () => {
    expect(
      costLineUsd(position, [buy(1, '2026-10-01', 1, 60_000), buy(2, '2026-11-03', 2, null)]),
    ).toBeNull()
    expect(costLineUsd({ ...position, lots: [] }, [])).toBeNull()
    expect(costLineUsd(undefined, [])).toBeNull()
  })
})

describe('instruments charted as one row', () => {
  it('is its own instrument unless the row lists others', () => {
    expect(instrumentsOf({ isin: 'A', instruments: [] })).toEqual(['A'])
    expect(instrumentsOf({ isin: 'BTC-USD', instruments: ['E1', 'E2'] })).toEqual(['E1', 'E2'])
  })
  it('marks a row held through any of its instruments', () => {
    const entries = [
      { isin: 'BTC-USD', instruments: ['E1'] },
      { isin: 'A', instruments: ['A'] },
    ]
    expect([
      ...heldRows(entries, [heldPosition('E1', 2, 1, 1), heldPosition('A', 0, 0, 0)]),
    ]).toEqual(['BTC-USD'])
  })
  it('adds the money of several positions and keeps one as it is', () => {
    const a = heldPosition('E1', 2, 300, 200)
    expect(mergedPosition([a])).toBe(a)
    expect(mergedPosition([])).toBeUndefined()
    const sum = mergedPosition([a, heldPosition('E2', 1, 100, 100)])
    expect(sum).toMatchObject({
      value_cents: 400,
      cost_fifo_cents: 300,
      unrealised_fifo_cents: 100,
      price: null,
    })
    expect(sum?.unrealised_fifo_pct).toBeCloseTo(1 / 3)
  })
})

describe('pickInstrument', () => {
  const list = [{ isin: 'A' }, { isin: 'B' }, { isin: 'C' }]
  it('keeps the one the URL names, else the first held, else the first listed', () => {
    expect(pickInstrument('c', list, new Set(['B']))).toBe('C')
    expect(pickInstrument('', list, new Set(['B', 'C']))).toBe('B')
    expect(pickInstrument('X', list, new Set())).toBe('A')
    expect(pickInstrument('', [], new Set())).toBeNull()
  })
})

describe('changeOf', () => {
  it('compares the close with the close before', () => {
    const bars = [bar(1, 100), bar(2, 110)]
    expect(changeOf(bars, 1)).toBeCloseTo(0.1)
    expect(changeOf(bars, 0)).toBeNull()
  })
})

describe('the drawings document', () => {
  it('reads an empty, a wrapped and a bare stored document', () => {
    expect(storedEntries({})).toEqual([])
    expect(storedEntries(null)).toEqual([])
    expect(storedEntries({ v: 1, drawings: [{ id: 'a' }], foreign: [{ id: 'b' }] })).toEqual([
      { id: 'a' },
      { id: 'b' },
    ])
    expect(storedEntries([{ id: 'c' }])).toEqual([{ id: 'c' }])
  })
  it('keeps a document of a shape it does not know as one unread entry', () => {
    expect(storedEntries({ layers: [1] })).toEqual([{ layers: [1] }])
  })
  it('names the entries the library did not take back, among them one without an id', () => {
    const entries = [{ id: 'a' }, { id: 'b', kind: 'from-the-future' }, { kind: 'no-id' }]
    expect(unreadEntries(entries, new Set(['a']))).toEqual([
      { id: 'b', kind: 'from-the-future' },
      { kind: 'no-id' },
    ])
  })
  it('writes the exported drawings and every unread entry back', () => {
    const doc = buildDrawingsDocument(JSON.stringify([{ id: 'a' }]), [{ id: 'b' }])
    expect(doc).toEqual({ v: 1, drawings: [{ id: 'a' }], foreign: [{ id: 'b' }], roles: {} })
  })
  it('keeps the colour of a line, and only of a line that still exists', () => {
    const doc = buildDrawingsDocument(JSON.stringify([{ id: 'a' }]), [], {
      a: 'sell',
      gone: 'buy',
    })
    expect(doc.roles).toEqual({ a: 'sell' })
    expect(storedRoles(doc)).toEqual({ a: 'sell' })
  })
  it('keeps the colour of an entry the library could not read', () => {
    const doc = buildDrawingsDocument(JSON.stringify([]), [{ id: 'f' }], { f: 'buy' })
    expect(doc.roles).toEqual({ f: 'buy' })
  })
  it('reads no colour from a document without one, and drops a role it does not know', () => {
    expect(storedRoles({})).toEqual({})
    expect(storedRoles(null)).toEqual({})
    expect(storedRoles({ roles: { a: 'buy', b: 'purple' } })).toEqual({ a: 'buy' })
  })
})

describe('rangeStart', () => {
  it('reads one year back for 1y and everything for max', () => {
    expect(rangeStart('1y', '2026-11-24')).toBe('2025-11-23')
    expect(rangeStart('max', '2026-11-24')).toBeUndefined()
  })
})

describe('levelsAtBars', () => {
  const point = (d: string, value: number) => ({ day: d, time: day(d), value })

  it('gives each bar the last index level on or before its day', () => {
    const bars = [bar(day('2026-08-18')), bar(day('2026-08-19')), bar(day('2026-08-20'))]
    const points = [point('2026-08-14', 1000), point('2026-08-19', 1100), point('2026-08-20', 1200)]
    expect(levelsAtBars(bars, points)).toEqual([
      { time: day('2026-08-18'), value: 1000 },
      { time: day('2026-08-19'), value: 1100 },
      { time: day('2026-08-20'), value: 1200 },
    ])
  })

  it('carries a level over a day it has none (an exchange holiday)', () => {
    const bars = [bar(day('2026-08-18')), bar(day('2026-08-21'))]
    const points = [point('2026-08-18', 100), point('2026-08-19', 104)]
    expect(levelsAtBars(bars, points)[1]?.value).toBe(104)
  })

  it('skips the bars before the index starts', () => {
    const bars = [bar(day('2026-08-10')), bar(day('2026-08-18'))]
    expect(levelsAtBars(bars, [point('2026-08-18', 500)])).toEqual([
      { time: day('2026-08-18'), value: 500 },
    ])
  })

  it('does not stand a stale level in for a day', () => {
    expect(levelsAtBars([bar(day('2026-09-30'))], [point('2026-08-18', 500)])).toEqual([])
  })

  it('is empty without bars or levels', () => {
    expect(levelsAtBars([], [point('2026-08-18', 500)])).toEqual([])
    expect(levelsAtBars([bar(day('2026-08-18'))], [])).toEqual([])
  })
})

describe('changeFrom', () => {
  const pts = [
    { time: 1, value: 100 },
    { time: 2, value: 110 },
    { time: 3, value: 90 },
  ]
  it('measures from the first point at or after the left edge to the newest', () => {
    expect(changeFrom(pts, 1)).toBeCloseTo(-0.1)
    expect(changeFrom(pts, 2)).toBeCloseTo(90 / 110 - 1)
  })
  it('is null with fewer than two points in view', () => {
    expect(changeFrom(pts, 3)).toBeNull()
    expect(changeFrom([], 0)).toBeNull()
  })
})

describe('allTimeHigh', () => {
  const ohlc = (time: number, high: number, source?: 'index'): ChartBar => ({
    ...bar(time, high),
    high,
    ...(source !== undefined && { source }),
  })
  it('is the highest high of the own bars and the day it was reached', () => {
    const high = allTimeHigh([ohlc(1, 10), ohlc(2, 30), ohlc(3, 20), ohlc(4, 30)])
    expect(high).toEqual({ price: 30, time: 2 })
  })
  it('ignores the spliced index bars', () => {
    expect(allTimeHigh([ohlc(1, 99, 'index'), ohlc(2, 10)])).toEqual({ price: 10, time: 2 })
  })
  it('is null without own bars', () => {
    expect(allTimeHigh([])).toBeNull()
    expect(allTimeHigh([ohlc(1, 5, 'index')])).toBeNull()
  })
})

describe('distanceFromHigh and signedPercent', () => {
  it('reads below the high as a negative fraction', () => {
    expect(distanceFromHigh(82, 100)).toBeCloseTo(-0.18)
    expect(distanceFromHigh(100, 100)).toBe(0)
    expect(distanceFromHigh(1, 0)).toBeNull()
  })
  it('writes a percent the German way with a real minus', () => {
    expect(signedPercent(-0.183)).toBe('−18,3 %')
    expect(signedPercent(0.0512)).toBe('+5,1 %')
    expect(signedPercent(null)).toBe('—')
  })
})

describe('timeframes', () => {
  const last = day('2026-11-20')
  it('counts back from the newest bar; Max is the whole history', () => {
    expect(timeframeStart('Max', last)).toBeNull()
    expect(timeframeStart('1Y', last)).toBe(last - 366 * 86_400)
  })
  it('hides a timeframe that would hold fewer than six bars at the interval', () => {
    expect(timeframeFits('1M', '1d')).toBe(true)
    expect(timeframeFits('1M', '1w')).toBe(false)
    expect(timeframeFits('3M', '1mo')).toBe(false)
    expect(timeframeFits('Max', '1mo')).toBe(true)
  })
  it('opens on the last year of day bars, else a trading year of bars', () => {
    const days = Array.from({ length: 900 }, (_, i) => bar(day('2024-01-01') + i * 86_400))
    expect(defaultViewStart(days, '1d')).toBe(days.at(-1)!.time - 366 * 86_400)
    const weeks = Array.from({ length: 600 }, (_, i) => bar(day('2015-01-05') + i * 7 * 86_400))
    expect(defaultViewStart(weeks, '1w')).toBe(weeks[600 - 1 - 252]?.time ?? 0)
    expect(defaultViewStart([], '1d')).toBeNull()
  })
  it('finds the first bar at or after a time', () => {
    const bars = [bar(10), bar(20), bar(30)]
    expect(firstBarFrom(bars, null)).toBe(0)
    expect(firstBarFrom(bars, 20)).toBe(1)
    expect(firstBarFrom(bars, 21)).toBe(2)
    expect(firstBarFrom(bars, 99)).toBe(3)
  })
  it('reads which button the visible range matches, within a tenth', () => {
    const first = day('2011-01-01')
    expect(activeTimeframe(last - 366 * 86_400, last, first)).toBe('1Y')
    expect(activeTimeframe(last - 90 * 86_400, last, first)).toBe('3M')
    expect(activeTimeframe(last - 800 * 86_400, last, first)).toBeNull()
    expect(activeTimeframe(first - 10, last, first)).toBe('Max')
    expect(activeTimeframe(null, last, first)).toBe('Max')
  })
})

describe('the spliced history as one series', () => {
  const index = (time: number, close: number): ChartBar => ({
    ...bar(time, close),
    source: 'index',
  })
  const muted = { up: 'up-muted', down: 'down-muted' }
  // The index runs from 100 to 164 (+64 %) and the ETF's own history starts at its scaled price.
  const bars = [index(10, 100), index(20, 120), index(30, 160), bar(40, 164), bar(50, 172)]
  const percent = (closes: readonly number[]) => closes.map((close) => close / closes[0]! - 1)

  it('is one ascending series over index and own bars', () => {
    const candles = historyCandles(bars, muted)
    expect(candles.map((c) => c.time)).toEqual([10, 20, 30, 40, 50])
  })
  it('colours only the index bars, from their own direction', () => {
    const rising: ChartBar = { ...index(5, 100), open: 90, close: 100 }
    const falling: ChartBar = { ...index(6, 100), open: 110, close: 100 }
    const [up, down, own] = historyCandles([rising, falling, bar(7)], muted)
    expect(up).toMatchObject({ color: 'up-muted', borderColor: 'up-muted', wickColor: 'up-muted' })
    expect(down).toMatchObject({ color: 'down-muted', wickColor: 'down-muted' })
    expect(own).not.toHaveProperty('color')
  })
  it('has one base: the first own bar continues the index percent, it does not restart at 0', () => {
    const closes = historyCandles(bars, muted).map((c) => c.close)
    const pct = percent(closes)
    const firstOwn = pct[3]!
    // The day before sits at +60 %; the first own bar adds that day's change on the same base.
    expect(pct[2]).toBeCloseTo(0.6, 10)
    expect(firstOwn).toBeCloseTo(0.64, 10)
    expect(firstOwn).toBeCloseTo((1 + pct[2]!) * (164 / 160) - 1, 10)
    expect(firstOwn).not.toBeCloseTo(0, 2)
  })
  it('keeps about 5 % of the visible width empty right of the newest bar', () => {
    for (const visible of [30, 252, 1000, 4000]) {
      const offset = rightMarginBars(visible)
      expect(offset / (visible + offset)).toBeGreaterThan(0.045)
      expect(offset / (visible + offset)).toBeLessThan(0.055)
    }
  })
})

describe('the spliced history and the view defaults', () => {
  const index = (time: number): ChartBar => ({ ...bar(time), source: 'index' })
  const bars = [index(10), index(20), bar(30), bar(40)]
  it("splits the index bars from the instrument's own and names the launch", () => {
    const { own, spliced } = splitSpliced(bars)
    expect(spliced.map((b) => b.time)).toEqual([10, 20])
    expect(own.map((b) => b.time)).toEqual([30, 40])
    expect(launchTime(bars)).toBe(30)
    expect(launchTime(own)).toBeNull()
  })
  it('shows turnover by default only where there is some and it is not a coin or an index', () => {
    const traded = [{ ...bar(1), turnover: 5 }]
    expect(hasTurnover(traded)).toBe(true)
    expect(hasTurnover([bar(1)])).toBe(false)
    expect(volumeByDefault('etf', traded)).toBe(true)
    expect(volumeByDefault('coin', traded)).toBe(false)
    expect(volumeByDefault('index', traded)).toBe(false)
    expect(volumeByDefault('etf', [bar(1)])).toBe(false)
  })
  it('opens a coin on the logarithmic scale', () => {
    expect(logByDefault('coin')).toBe(true)
    expect(logByDefault('etf')).toBe(false)
    expect(logByDefault(null)).toBe(false)
  })
})
