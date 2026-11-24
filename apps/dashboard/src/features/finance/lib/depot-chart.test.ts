import { describe, expect, it } from 'bun:test'
import type { ChartBar, DepotOrder, DepotPosition, DepotTrade } from '../api/types'
import {
  barOfDay,
  buildDrawingsDocument,
  candleWindow,
  changeOf,
  costLine,
  costLineUsd,
  dayToSeconds,
  depotInterval,
  heldRows,
  instrumentsOf,
  markGroups,
  marksByBar,
  mergedPosition,
  orderLine,
  pickInstrument,
  storedEntries,
  tradeMarks,
  tradeReadout,
  unreadEntries,
} from './depot-chart'

const bar = (time: number, close = 10): ChartBar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  units: null,
  turnover: null,
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

const order = (over: Partial<DepotOrder>): DepotOrder =>
  ({
    id: 7,
    side: 'buy',
    type: 'limit',
    limit_price: 41.5,
    stop_price: null,
    quantity: 10,
    status: 'open',
    ...over,
  }) as DepotOrder

describe('candleWindow', () => {
  it('counts back from today at day; week and month load the whole history', () => {
    expect(candleWindow('1y', '1d', '2026-11-22')).toEqual({ from: '2025-11-21', to: '2026-11-22' })
    expect(candleWindow('1m', '1w', '2026-11-22')).toEqual({ to: '2026-11-22' })
    expect(candleWindow('1y', '1mo', '2026-11-22')).toEqual({ to: '2026-11-22' })
  })
  it('keeps a daily request under the 5,000 bars the service allows', () => {
    expect(candleWindow('max', '1d', '2026-11-22').from).toBe('2013-03-25')
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

describe('tradeReadout', () => {
  const bars = [bar(day('2026-11-02'))]
  const readout = (trades: DepotTrade[], usd = false) =>
    tradeReadout(tradeMarks(trades, bars, '1w'), usd)
  it('writes a trade per line, with the dollar price on a dollar chart', () => {
    const one = trade(1, '2026-11-03', {
      quantity: 0.5,
      amount_cents: 3_200_000,
      price_usd: 67_200,
    })
    expect(readout([one])).toEqual(['Bought 0.5 · €32,000.00'])
    expect(readout([one], true)).toEqual(['Bought 0.5 · €32,000.00 · at $67,200.00'])
  })
  it('sums the trades of one side into one line', () => {
    const lines = readout([
      trade(1, '2026-11-03', { quantity: 2, amount_cents: 10_000 }),
      trade(2, '2026-11-04', { quantity: 1.5, amount_cents: 7_500, quantity_source: 'estimated' }),
      trade(3, '2026-11-05', { side: 'sell', quantity: 1, amount_cents: 5_100 }),
    ])
    expect(lines).toEqual(['Bought 2 trades · ≈ 3.5 · €175.00', 'Sold 1 · €51.00'])
  })
  it('says so when a quantity is unknown', () => {
    const lines = readout([
      trade(1, '2026-11-03', { quantity: null, amount_cents: 100 }),
      trade(2, '2026-11-04', { quantity: 1, amount_cents: 100 }),
    ])
    expect(lines).toEqual(['Bought 2 trades · quantity unknown · €2.00'])
  })
})

describe('lines', () => {
  it('puts a limit order at its limit and a stop order at its stop', () => {
    expect(orderLine(order({}))).toMatchObject({
      price: 41.5,
      kind: 'order-buy',
      title: 'Buy 10 limit',
    })
    expect(
      orderLine(order({ type: 'stop', side: 'sell', stop_price: 38, limit_price: null })),
    ).toMatchObject({ price: 38, kind: 'order-sell', title: 'Sell 10 stop' })
  })
  it('draws no line for a market order or a closed one', () => {
    expect(orderLine(order({ type: 'market', limit_price: null }))).toBeNull()
    expect(orderLine(order({ status: 'cancelled' }))).toBeNull()
  })
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
    expect(line?.title).toBe('Average cost $66,000')
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
    expect(doc).toEqual({ v: 1, drawings: [{ id: 'a' }], foreign: [{ id: 'b' }] })
  })
})
