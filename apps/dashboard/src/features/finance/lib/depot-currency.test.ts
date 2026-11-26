import { describe, expect, it } from 'bun:test'
import type { ChartBar } from '../api/types'
import { aggregateBars, eurBars, euroTitle, nativeCurrency, scaleDrawings } from './depot-currency'

const at = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000

const bar = (day: string, close: number, extra: Partial<ChartBar> = {}): ChartBar => ({
  time: at(day),
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  units: null,
  turnover: null,
  source: 'nasdaq',
  ...extra,
})

const rate = (day: string, value: number) => ({ day, time: at(day), value })

describe('eurBars', () => {
  const rates = [rate('2026-11-19', 1.25), rate('2026-11-23', 1.1)]

  it('converts each bar at the rate of its own day', () => {
    const [first, second] = eurBars([bar('2026-11-19', 100), bar('2026-11-23', 110)], rates)
    expect(first).toMatchObject({ open: 99 / 1.25, high: 102 / 1.25, low: 98 / 1.25, close: 80 })
    expect(second?.close).toBeCloseTo(100)
  })

  it('takes the latest earlier rate where the ECB has none for the day', () => {
    expect(eurBars([bar('2026-11-20', 100)], rates)[0]?.close).toBe(80)
    expect(eurBars([bar('2026-11-30', 110)], rates)[0]?.close).toBeCloseTo(100)
  })

  it('leaves out a bar before the first rate and converts turnover', () => {
    const out = eurBars([bar('2026-11-18', 100), bar('2026-11-19', 100, { turnover: 500 })], rates)
    expect(out.map((b) => b.time)).toEqual([at('2026-11-19')])
    expect(out[0]?.turnover).toBe(400)
  })
})

describe('aggregateBars', () => {
  // 2026-11-19 is a Thursday, 2026-11-23 the Monday after.
  const days = [bar('2026-11-19', 100), bar('2026-11-20', 105), bar('2026-11-23', 90)]

  it('builds week candles dated on their Monday', () => {
    expect(aggregateBars(days, '1w')).toEqual([
      expect.objectContaining({
        time: at('2026-11-16'),
        open: 99,
        high: 107,
        low: 98,
        close: 105,
        days: 2,
      }),
      expect.objectContaining({ time: at('2026-11-23'), open: 89, close: 90, days: 1 }),
    ])
  })

  it('builds month candles dated on the first', () => {
    const [month] = aggregateBars(days, '1mo')
    expect(month).toMatchObject({ time: at('2026-11-01'), open: 99, high: 107, low: 88, close: 90 })
  })

  it('marks a bar built from closes and sums turnover only when every day has it', () => {
    const [week] = aggregateBars(
      [
        bar('2026-11-23', 90, { turnover: 5, derived_from_close: true }),
        bar('2026-11-24', 91, { turnover: null }),
      ],
      '1w',
    )
    expect(week).toMatchObject({ turnover: null, derived_from_close: true })
  })
})

describe('nativeCurrency', () => {
  const entry = { isin: 'x', currency: null, us_mic: null, kind: 'index' as const }

  it('reads a US listing in dollars and an index id that ends in -usd', () => {
    expect(nativeCurrency({ ...entry, currency: 'EUR', us_mic: 'XNAS', kind: 'stock' })).toBe('USD')
    expect(nativeCurrency({ ...entry, isin: 'msci-world-net-usd' })).toBe('USD')
  })

  it('keeps what the row says and calls no other series dollars', () => {
    expect(nativeCurrency({ ...entry, currency: 'EUR' })).toBe('EUR')
    expect(nativeCurrency({ ...entry, isin: 'eur-usd', kind: 'series' })).toBeNull()
  })
})

describe('euroTitle', () => {
  it('drops the dollars a name says, however it says them', () => {
    expect(euroTitle('Bitcoin in USD')).toBe('Bitcoin · EUR')
    expect(euroTitle('FTSE Global All Cap, price return, USD')).toBe(
      'FTSE Global All Cap, price return · EUR',
    )
    expect(euroTitle('NVIDIA Corp.')).toBe('NVIDIA Corp. · EUR')
  })
})

describe('scaleDrawings', () => {
  const document = {
    v: 1,
    drawings: [{ id: 'a', points: [{ time: 1, price: 110 }] }],
    foreign: [{ id: 'b', points: [{ time: 2, price: 220 }] }],
    roles: { a: 'sell' },
  }

  it('multiplies every price and gives them back on the inverse', () => {
    const shown = scaleDrawings(document, 1 / 1.1) as typeof document
    expect(shown.drawings[0]?.points[0]?.price).toBeCloseTo(100)
    expect(shown.foreign[0]?.points[0]?.price).toBeCloseTo(200)
    expect(shown.roles).toEqual({ a: 'sell' })
    const back = scaleDrawings(shown, 1.1) as typeof document
    expect(back.drawings[0]?.points[0]?.price).toBeCloseTo(110)
  })

  it('leaves a document alone at factor 1 and anything that is no drawing', () => {
    expect(scaleDrawings(document, 1)).toBe(document)
    expect(scaleDrawings({}, 2)).toEqual({})
    expect(scaleDrawings(undefined, 2)).toBeUndefined()
  })
})
