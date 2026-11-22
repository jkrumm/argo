import { describe, expect, it } from 'bun:test'
import type { ChartBar, DepotOrder, DepotPosition, DepotTrade } from '../api/types'
import {
  barOfDay,
  buildDrawingsDocument,
  candleWindow,
  changeOf,
  costLine,
  dayToSeconds,
  marksByBar,
  orderLine,
  pickInstrument,
  storedEntries,
  tradeMarks,
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
  it('counts back from today and leaves the history open for everything', () => {
    expect(candleWindow('1y', '1d', '2026-11-22')).toEqual({ from: '2025-11-21', to: '2026-11-22' })
    expect(candleWindow('max', '1d', '2026-11-22')).toEqual({ to: '2026-11-22' })
  })
  it('caps an intraday request at the days that exist, whatever the range', () => {
    expect(candleWindow('5y', '15m', '2026-11-22').from).toBe('2026-11-12')
    expect(candleWindow('max', '1h', '2026-11-22').from).toBe('2026-10-23')
    expect(candleWindow('1m', '15m', '2026-11-22').from).toBe('2026-11-12')
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
  it('uses the last bar of the day on an intraday chart and none for a day without one', () => {
    const intraday = [
      day('2026-11-19') + 8 * 3600,
      day('2026-11-19') + 9 * 3600,
      day('2026-11-20') + 8 * 3600,
    ].map((t) => bar(t))
    expect(barOfDay(intraday, '2026-11-19', '1h')).toBe(day('2026-11-19') + 9 * 3600)
    expect(barOfDay(intraday, '2026-11-18', '1h')).toBeNull()
    expect(barOfDay(intraday, '2026-11-21', '1h')).toBeNull()
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
