import { describe, expect, it } from 'bun:test'
import type { DepotPosition, WatchList, WatchListEntry, WatchlistEntry } from '../api/types'
import {
  addTargetList,
  cryptoRows,
  defaultTabId,
  depotLines,
  entryLabel,
  listTabId,
  resolveTab,
  watchTabs,
} from './watch-panel'

const row = (over: Partial<WatchlistEntry> & { isin: string }): WatchlistEntry => ({
  name: null,
  kind: null,
  currency: 'EUR',
  last_close: null,
  last_day: null,
  first_day: null,
  day_change: null,
  day_change_pct: null,
  us_mic: null,
  instruments: [],
  chart_as: null,
  index: null,
  ...over,
})

const position = (over: Partial<DepotPosition> & { isin: string }): DepotPosition => ({
  name: null,
  quantity: 1,
  price: null,
  price_on: null,
  value_cents: null,
  cost_fifo_cents: 0,
  cost_average_cents: 0,
  unrealised_fifo_cents: null,
  unrealised_average_cents: null,
  unrealised_fifo_pct: null,
  share: null,
  quantity_source: 'document',
  lots: [],
  ...over,
})

const list = (id: number, name: string, is_default = false): WatchList => ({
  id,
  name,
  position: id,
  is_default,
  entries: [],
})

const listEntry = (display_name: string | null, name: string | null): WatchListEntry => ({
  symbol: 'IE00B4L5Y983',
  display_name,
  position: 0,
  added_at: '2026-01-01T00:00:00Z',
  quote: row({ isin: 'IE00B4L5Y983', name }),
})

describe('watchTabs', () => {
  it('orders depot, the user lists, crypto, indices', () => {
    expect(watchTabs([list(1, 'Core', true), list(7, 'Watch')]).map((t) => t.id)).toEqual([
      'depot',
      'list-1',
      'list-7',
      'crypto',
      'indices',
    ])
  })

  it('labels a list tab by its name', () => {
    expect(watchTabs([list(3, 'Dividends')])[1]).toEqual({ id: 'list-3', label: 'Dividends' })
  })
})

describe('defaultTabId', () => {
  it('opens the depot when anything is held', () => {
    expect(defaultTabId([list(1, 'Core', true)], true)).toBe('depot')
  })

  it('opens the first list when nothing is held', () => {
    expect(defaultTabId([list(4, 'Watch'), list(1, 'Core', true)], false)).toBe('list-4')
  })

  it('falls back to the depot without any list', () => {
    expect(defaultTabId([], false)).toBe('depot')
  })
})

describe('resolveTab', () => {
  const tabs = watchTabs([list(2, 'Watch')])

  it('keeps a tab that exists', () => {
    expect(resolveTab(tabs, 'crypto', 'depot')).toBe('crypto')
  })

  it('falls back when the tab is gone or unset', () => {
    expect(resolveTab(tabs, 'list-99', 'depot')).toBe('depot')
    expect(resolveTab(tabs, '', 'list-2')).toBe('list-2')
  })
})

describe('entryLabel', () => {
  it('prefers the display name, then the instrument name, then the symbol', () => {
    expect(entryLabel(listEntry('My ETF', 'iShares Core'))).toBe('My ETF')
    expect(entryLabel(listEntry(null, 'iShares Core'))).toBe('iShares Core')
    expect(entryLabel(listEntry(null, null))).toBe('IE00B4L5Y983')
  })
})

describe('addTargetList', () => {
  const lists = [list(1, 'Core', true), list(2, 'Watch')]

  it('adds to the active user list', () => {
    expect(addTargetList(lists, listTabId(2))?.id).toBe(2)
  })

  it('adds to the default list from any other tab', () => {
    expect(addTargetList(lists, 'depot')?.id).toBe(1)
    expect(addTargetList(lists, 'crypto')?.id).toBe(1)
  })
})

describe('cryptoRows', () => {
  it('keeps the coin rows only', () => {
    const rows = [row({ isin: 'IE00B4L5Y983' }), row({ isin: 'BTC-USD', kind: 'coin' })]
    expect(cryptoRows(rows).map((r) => r.isin)).toEqual(['BTC-USD'])
  })
})

describe('depotLines', () => {
  it('lists held rows by value, largest first, and drops sold-out ones', () => {
    const entries = [
      row({ isin: 'AAA', name: 'Small' }),
      row({ isin: 'BBB', name: 'Big' }),
      row({ isin: 'CCC', name: 'Sold' }),
    ]
    const positions = [
      position({ isin: 'AAA', quantity: 2, value_cents: 10_000, share: 0.1 }),
      position({ isin: 'BBB', quantity: 5, value_cents: 90_000, share: 0.9 }),
      position({ isin: 'CCC', quantity: 0, value_cents: 0, share: 0 }),
    ]
    const lines = depotLines(entries, positions)
    expect(lines.map((l) => l.key)).toEqual(['BBB', 'AAA'])
    expect(lines[0]).toEqual({
      key: 'BBB',
      name: 'Big',
      quantity: 5,
      value_cents: 90_000,
      share: 0.9,
    })
  })

  it('sums the instruments a coin row stands for and their shares', () => {
    const entries = [
      row({ isin: 'BTC-USD', kind: 'coin', name: 'Bitcoin', instruments: ['ETP1', 'ETP2'] }),
    ]
    const positions = [
      position({ isin: 'ETP1', quantity: 0.5, value_cents: 3_000, share: 0.2 }),
      position({ isin: 'ETP2', quantity: 0.25, value_cents: 1_000, share: 0.1 }),
    ]
    const [line] = depotLines(entries, positions)
    expect(line?.key).toBe('BTC-USD')
    expect(line?.quantity).toBe(0.75)
    expect(line?.value_cents).toBe(4_000)
    expect(line?.share).toBeCloseTo(0.3)
  })

  it('has no share when one position has none', () => {
    const entries = [row({ isin: 'AAA' })]
    const positions = [position({ isin: 'AAA', value_cents: 500, share: null })]
    expect(depotLines(entries, positions)[0]?.share).toBeNull()
  })
})
