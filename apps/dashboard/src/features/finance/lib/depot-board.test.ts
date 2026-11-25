import { describe, expect, it } from 'bun:test'
import type { BoardEntry, ChartBar, DepotPosition, WatchList, WatchlistEntry } from '../api/types'
import { boardRows, figuresFromBars, unboarded } from './depot-board'
import { CRYPTO_TAB, DEPOT_TAB, navTabs, tabItems, viewAfterPick } from './depot-nav'

const day = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 1000

const bar = (iso: string, close: number): ChartBar => ({
  time: day(iso),
  open: close,
  high: close,
  low: close,
  close,
  units: null,
  turnover: null,
  source: 'xetra',
})

const quote = (over: Partial<WatchlistEntry> & { isin: string }): WatchlistEntry => ({
  name: null,
  kind: 'etf',
  currency: 'EUR',
  last_close: 100,
  last_day: '2026-11-24',
  first_day: null,
  day_change: null,
  day_change_pct: null,
  us_mic: null,
  instruments: [over.isin],
  chart_as: null,
  index: null,
  ...over,
})

const position = (isin: string, value_cents: number): DepotPosition =>
  ({ isin, name: isin, quantity: 1, value_cents, share: null }) as DepotPosition

const entry = (symbol: string, position: number) => ({
  symbol,
  kind: 'etf' as const,
  display_name: null,
  position,
  added_at: '2026-01-01',
  quote: quote({ isin: symbol, name: symbol }),
})

const board = (symbol: string): BoardEntry => ({
  symbol,
  display_name: null,
  name: symbol,
  kind: 'etf',
  currency: 'EUR',
  cbbi: null,
  figures: {
    last_close: 1,
    last_day: '2026-11-24',
    day_pct: 0.01,
    week_pct: null,
    month_pct: null,
    ytd_pct: null,
    year_pct: null,
    ath: { value: 2, day: '2025-01-01' },
    ath_pct: -0.5,
    low_52w: 1,
    high_52w: 2,
  },
})

describe('figuresFromBars', () => {
  it('reads the changes against the closes a day, a week, a month, the year end and a year before', () => {
    const bars = [
      bar('2025-11-24', 50),
      bar('2025-12-31', 80),
      bar('2026-10-24', 90),
      bar('2026-11-17', 95),
      bar('2026-11-23', 98),
      bar('2026-11-24', 100),
    ]
    const figures = figuresFromBars(bars)
    expect(figures?.last_close).toBe(100)
    expect(figures?.last_day).toBe('2026-11-24')
    expect(figures?.day_pct).toBeCloseTo(100 / 98 - 1, 6)
    expect(figures?.week_pct).toBeCloseTo(100 / 95 - 1, 6)
    expect(figures?.month_pct).toBeCloseTo(100 / 90 - 1, 6)
    expect(figures?.ytd_pct).toBeCloseTo(100 / 80 - 1, 6)
    expect(figures?.year_pct).toBeCloseTo(100 / 50 - 1, 6)
  })

  it('has no change where the history starts later than the reference', () => {
    const figures = figuresFromBars([bar('2026-11-23', 98), bar('2026-11-24', 100)])
    expect(figures?.week_pct).toBeNull()
    expect(figures?.year_pct).toBeNull()
    expect(figures?.day_pct).toBeCloseTo(100 / 98 - 1, 6)
  })

  it('measures from the highest close and the 52 weeks up to the last day', () => {
    const figures = figuresFromBars([
      bar('2024-01-02', 200),
      bar('2026-01-02', 80),
      bar('2026-11-24', 100),
    ])
    expect(figures?.ath).toEqual({ value: 200, day: '2024-01-02' })
    expect(figures?.ath_pct).toBe(-0.5)
    expect(figures?.low_52w).toBe(80)
    expect(figures?.high_52w).toBe(100)
  })

  it('is null without a bar', () => {
    expect(figuresFromBars([])).toBeNull()
  })
})

describe('the board rows of a tab', () => {
  const lists: WatchList[] = [
    {
      id: 1,
      name: 'Watchlist',
      position: 0,
      is_default: true,
      entries: [entry('B', 1), entry('A', 0), entry('H1', 2)],
    },
  ]
  const watchlist = ['A', 'B', 'H1', 'H2', 'H3'].map((isin) => quote({ isin, name: isin }))
  const positions = [position('H1', 500), position('H2', 900), position('H3', 100)]
  const tabs = navTabs(lists, [])
  const tab = (id: string) => tabs.find((t) => t.id === id)

  it('lists every held row in the depot, the largest first, also those on no list', () => {
    const items = tabItems(tab(DEPOT_TAB), lists, watchlist, positions)
    const rows = boardRows(items, new Map([['H1', board('H1')]]), new Map())
    expect(rows.map((row) => row.symbol)).toEqual(['H2', 'H1', 'H3'])
  })

  it('takes the figures of a row from its list board, else from its own bars, else has none', () => {
    const items = tabItems(tab(DEPOT_TAB), lists, watchlist, positions)
    const boarded = new Map([['H1', board('H1')]])
    expect(unboarded(items, boarded).map((item) => item.symbol)).toEqual(['H2', 'H3'])
    const computed = new Map([['H2', figuresFromBars([bar('2026-11-24', 7)])]])
    const rows = boardRows(items, boarded, computed)
    expect(rows.find((row) => row.symbol === 'H1')?.figures?.day_pct).toBe(0.01)
    expect(rows.find((row) => row.symbol === 'H2')?.figures?.last_close).toBe(7)
    expect(rows.find((row) => row.symbol === 'H3')?.figures).toBeNull()
  })

  it('lists every entry of a list in list order', () => {
    const items = tabItems(tab('list-1'), lists, watchlist, positions)
    const rows = boardRows(items, new Map(), new Map())
    expect(rows.map((row) => row.symbol)).toEqual(['A', 'B', 'H1'])
  })

  it('lists the coins on Crypto', () => {
    const coin = quote({ isin: 'BTC-USD', kind: 'coin', name: 'Bitcoin', instruments: [] })
    const items = tabItems(tab(CRYPTO_TAB), lists, [...watchlist, coin], positions)
    expect(boardRows(items, new Map(), new Map()).map((row) => row.symbol)).toEqual(['BTC-USD'])
  })
})

describe('viewAfterPick', () => {
  it('stays in Chart and Details, and opens the chart from the Board', () => {
    expect(viewAfterPick('chart')).toBe('chart')
    expect(viewAfterPick('details')).toBe('details')
    expect(viewAfterPick('board')).toBe('chart')
  })
})
