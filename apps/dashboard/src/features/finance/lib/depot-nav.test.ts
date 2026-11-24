import { describe, expect, it } from 'bun:test'
import type {
  Backfill,
  ChartBar,
  DepotPosition,
  WatchList,
  WatchListEntry,
  WatchlistEntry,
} from '../api/types'
import {
  addTargetList,
  awaitsHistory,
  backfillText,
  closeOnlyDaily,
  defaultTabId,
  depotLines,
  entryLabel,
  groupByKind,
  hiddenTabs,
  listTabId,
  movedEntries,
  navTabs,
  neighbourListPosition,
  neighbourPosition,
  pickSymbol,
  resolveTab,
  tabHolding,
  tabItems,
} from './depot-nav'
import type { SidebarItem } from './depot-nav'

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

const list = (
  id: number,
  name: string,
  is_default = false,
  entries: WatchListEntry[] = [],
): WatchList => ({ id, name, position: id, is_default, entries })

const listEntry = (
  symbol: string,
  position: number,
  kind: WatchlistEntry['kind'],
  display_name: string | null = null,
  name: string | null = null,
): WatchListEntry => ({
  symbol,
  kind,
  display_name,
  position,
  added_at: '2026-01-01T00:00:00Z',
  quote: row({ isin: symbol, name, kind }),
})

describe('navTabs', () => {
  it('orders depot, the owner lists by position, crypto', () => {
    const lists = [list(7, 'Watch'), list(1, 'Core', true)]
    expect(navTabs(lists, []).map((t) => t.id)).toEqual(['depot', 'list-1', 'list-7', 'crypto'])
  })

  it('leaves a hidden built-in out and offers it back', () => {
    expect(navTabs([list(1, 'Core', true)], ['crypto']).map((t) => t.id)).toEqual([
      'depot',
      'list-1',
    ])
    expect(hiddenTabs(['crypto', 'unknown']).map((t) => t.label)).toEqual(['Crypto'])
  })

  it('labels a list tab by its name and carries its id', () => {
    expect(navTabs([list(3, 'Dividends')], [])[1]).toEqual({
      id: 'list-3',
      label: 'Dividends',
      listId: 3,
    })
  })
})

describe('defaultTabId', () => {
  const lists = [list(4, 'Watch'), list(5, 'Core', true)]

  it('opens the depot when anything is held', () => {
    expect(defaultTabId(navTabs(lists, []), true)).toBe('depot')
  })

  it('opens the first list when nothing is held or the depot is hidden', () => {
    expect(defaultTabId(navTabs(lists, []), false)).toBe('list-4')
    expect(defaultTabId(navTabs(lists, ['depot']), true)).toBe('list-4')
  })
})

describe('resolveTab', () => {
  const tabs = navTabs([list(2, 'Watch')], [])

  it('keeps a tab that exists and falls back from a stale one', () => {
    expect(resolveTab(tabs, 'crypto', 'depot')).toBe('crypto')
    expect(resolveTab(tabs, 'list-99', 'depot')).toBe('depot')
    expect(resolveTab(tabs, '', 'list-2')).toBe('list-2')
  })
})

describe('addTargetList', () => {
  const lists = [list(1, 'Core', true), list(2, 'Watch')]

  it('adds to the active list, else the default one', () => {
    expect(addTargetList(lists, listTabId(2))?.id).toBe(2)
    expect(addTargetList(lists, 'depot')?.id).toBe(1)
  })
})

describe('neighbourListPosition', () => {
  const lists = [list(1, 'A', true), list(2, 'B'), list(3, 'C')]

  it('names the position of the neighbour, null at the ends', () => {
    expect(neighbourListPosition(lists, 2, -1)).toBe(1)
    expect(neighbourListPosition(lists, 2, 1)).toBe(3)
    expect(neighbourListPosition(lists, 1, -1)).toBeNull()
    expect(neighbourListPosition(lists, 3, 1)).toBeNull()
  })
})

describe('entryLabel', () => {
  it('prefers the display name, then the instrument name, then the symbol', () => {
    expect(entryLabel(listEntry('IE1', 0, 'etf', 'My ETF', 'iShares Core'))).toBe('My ETF')
    expect(entryLabel(listEntry('IE1', 0, 'etf', null, 'iShares Core'))).toBe('iShares Core')
    expect(entryLabel(listEntry('IE1', 0, 'etf'))).toBe('IE1')
  })
})

describe('groupByKind', () => {
  it('puts the groups in the fixed order and drops the empty ones', () => {
    const groups = groupByKind(
      [
        { id: 'a', kind: 'index' as const },
        { id: 'b', kind: 'stock' as const },
        { id: 'c', kind: null },
        { id: 'd', kind: 'index' as const },
      ],
      (item) => item.kind,
    )
    expect(groups.map((g) => [g.header, g.items.map((i) => i.id)])).toEqual([
      ['Stocks', ['b']],
      ['Indices', ['a', 'd']],
      ['Other', ['c']],
    ])
  })
})

describe('moves', () => {
  const entries = [
    listEntry('A', 0, 'etf'),
    listEntry('S', 1, 'stock'),
    listEntry('B', 2, 'etf'),
    listEntry('C', 3, 'etf'),
  ]

  it('moves an entry to a position and renumbers the others', () => {
    expect(movedEntries(entries, 'A', 2).map((e) => [e.symbol, e.position])).toEqual([
      ['S', 0],
      ['B', 1],
      ['A', 2],
      ['C', 3],
    ])
    expect(movedEntries(entries, 'C', 0).map((e) => e.symbol)).toEqual(['C', 'A', 'S', 'B'])
  })

  it('moves by one place inside the kind group, never across it', () => {
    expect(neighbourPosition(entries, 'B', -1)).toBe(0)
    expect(neighbourPosition(entries, 'B', 1)).toBe(3)
    expect(neighbourPosition(entries, 'A', -1)).toBeNull()
    expect(neighbourPosition(entries, 'C', 1)).toBeNull()
    expect(neighbourPosition(entries, 'S', 1)).toBeNull()
  })
})

describe('tabItems and pickSymbol', () => {
  const lists = [
    list(1, 'Core', true, [
      listEntry('ETF1', 0, 'etf', null, 'World ETF'),
      listEntry('STK1', 1, 'stock', null, 'Chip stock'),
    ]),
  ]
  const entries = [row({ isin: 'ETF1', kind: 'etf' }), row({ isin: 'BTC-USD', kind: 'coin' })]

  it('lists a list tab in list order and the crypto tab by its coin', () => {
    const tabs = navTabs(lists, [])
    const core = tabs.find((t) => t.listId === 1)
    expect(tabItems(core, lists, entries, []).map((i) => i.symbol)).toEqual(['ETF1', 'STK1'])
    expect(tabItems(tabs.at(-1), lists, entries, []).map((i) => i.symbol)).toEqual(['BTC-USD'])
  })

  it('picks the requested symbol when the tab has it, else the first row by group', () => {
    const items: SidebarItem[] = tabItems(navTabs(lists, [])[1], lists, entries, [])
    expect(pickSymbol('stk1', items, false)).toBe('STK1')
    expect(pickSymbol('', items, false)).toBe('STK1')
    expect(pickSymbol('', items, true)).toBe('ETF1')
    expect(pickSymbol('nope', [], false)).toBeNull()
  })
})

const backfill = (over: Partial<Backfill>): Backfill => ({
  symbol: 'X',
  state: 'running',
  from: null,
  bars: 0,
  error: null,
  ...over,
})

describe('tabHolding', () => {
  it('names the first tab that lists the symbol, null when none does', () => {
    const lists = [list(1, 'Core', true, [listEntry('ETF1', 0, 'etf')])]
    const entries = [row({ isin: 'ETF1', kind: 'etf' })]
    const tabs = navTabs(lists, [])
    expect(tabHolding(tabs, 'etf1', lists, entries, [])).toBe('list-1')
    expect(tabHolding(tabs, 'nope', lists, entries, [])).toBeNull()
  })
})

describe('history', () => {
  it('awaits history only for an instrument without a close', () => {
    expect(awaitsHistory({ last_close: null, kind: 'stock' })).toBe(true)
    expect(awaitsHistory({ last_close: 10, kind: 'stock' })).toBe(false)
    expect(awaitsHistory({ last_close: null, kind: 'series' })).toBe(false)
  })

  it('says where the load stands', () => {
    expect(backfillText(undefined)).toBe('Loading history')
    expect(backfillText(backfill({ state: 'queued' }))).toBe('Waiting to load history')
    expect(backfillText(backfill({ bars: 1240, from: '2019-05-02' }))).toBe(
      'Loading history: 1.240 days since 2019-05-02',
    )
    expect(backfillText(backfill({ state: 'failed', error: 'no source has history' }))).toBe(
      'no source has history',
    )
  })
})

const bar = (derived: boolean): ChartBar => ({
  time: 1,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  units: null,
  turnover: null,
  source: null,
  ...(derived && { derived_from_close: true as const }),
})

describe('closeOnlyDaily', () => {
  it('is a line only for daily bars that all carry the close alone', () => {
    expect(closeOnlyDaily([bar(true), bar(true)], '1d')).toBe(true)
    expect(closeOnlyDaily([bar(true), bar(false)], '1d')).toBe(false)
    expect(closeOnlyDaily([bar(true)], '1w')).toBe(false)
    expect(closeOnlyDaily([], '1d')).toBe(false)
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
