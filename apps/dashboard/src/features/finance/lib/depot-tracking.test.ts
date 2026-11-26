import { describe, expect, it } from 'bun:test'
import type { WatchlistEntry } from '../api/types'
import type { PriceLine } from './depot-chart'
import { atIndexLevel, indexFactor, trackersOf } from './depot-tracking'

const day = (n: number, close: number) => ({ time: n * 86_400, close })

describe('indexFactor', () => {
  it('takes the closes of the latest day both have', () => {
    // The index has a newer day than the ETF: day 2 is the latest common one.
    expect(indexFactor([day(1, 1000), day(2, 1200), day(3, 1500)], [day(1, 4), day(2, 4)])).toBe(
      300,
    )
  })

  it('is null with no common day', () => {
    expect(indexFactor([day(1, 1000)], [day(2, 4)])).toBeNull()
    expect(indexFactor([], [day(2, 4)])).toBeNull()
  })
})

describe('atIndexLevel', () => {
  const line: PriceLine = {
    id: 'order-1',
    price: 4.2,
    title: 'Buy limit 4,20 €',
    kind: 'order-buy',
  }

  it('moves the price to the index and keeps the ETF price in the label', () => {
    // An order 5 % above the ETF close sits 5 % above the index close.
    const factor = indexFactor([day(1, 1000)], [day(1, 4)]) ?? 0
    expect(atIndexLevel(line, factor)).toEqual({ ...line, price: 1050 })
  })

  it('names the ETF when there are several', () => {
    expect(atIndexLevel(line, 1, 'All-cap ETF').title).toBe('Buy limit 4,20 € · All-cap ETF')
  })
})

describe('trackersOf', () => {
  const row = (isin: string, index: string | null, kind: WatchlistEntry['kind']) =>
    ({ isin, index, kind }) as WatchlistEntry

  it('lists the funds whose index is the series, not series themselves', () => {
    const rows = [
      row('A', 'ftse', 'etf'),
      row('B', 'msci', 'etf'),
      row('C', null, 'stock'),
      row('D', 'ftse', 'etc'),
      row('ftse', 'ftse', 'index'),
    ]
    expect(trackersOf(rows, 'ftse').map((r) => r.isin)).toEqual(['A', 'D'])
  })
})
