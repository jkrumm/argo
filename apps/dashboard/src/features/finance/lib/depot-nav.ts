import type {
  Backfill,
  ChartBar,
  DepotPosition,
  MarketKind,
  WatchList,
  WatchListEntry,
  WatchlistEntry,
} from '../api/types'
import { heldRows, instrumentsOf, mergedPosition } from './depot-chart'
import type { DepotInterval } from './depot-chart'

// ---- The instrument model: a kind, and the group it sits in -------------------------------------

export type KindGroup = MarketKind | 'other'

/** The order of the groups in a list and in the search results. */
export const KIND_ORDER: readonly KindGroup[] = [
  'stock',
  'etf',
  'etc',
  'index',
  'coin',
  'series',
  'other',
]

export const GROUP_HEADER: Record<KindGroup, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  etc: 'ETCs and ETNs',
  index: 'Indices',
  coin: 'Crypto',
  series: 'Series',
  other: 'Other',
}

/** One word for a kind, on a search result. */
export const KIND_WORD: Record<KindGroup, string> = {
  stock: 'Stock',
  etf: 'ETF',
  etc: 'ETC',
  index: 'Index',
  coin: 'Coin',
  series: 'Series',
  other: 'Other',
}

export const kindGroup = (kind: MarketKind | null | undefined): KindGroup => kind ?? 'other'

export type Grouped<T> = { group: KindGroup; header: string; items: T[] }

/** The items under their group headers in the fixed group order, each group in the order it came; empty groups are left out. */
export function groupByKind<T>(
  items: readonly T[],
  kindOf: (item: T) => MarketKind | null | undefined,
): Grouped<T>[] {
  return KIND_ORDER.map((group) => ({
    group,
    header: GROUP_HEADER[group],
    items: items.filter((item) => kindGroup(kindOf(item)) === group),
  })).filter((g) => g.items.length > 0)
}

// ---- Tabs: two built-in views and the owner's lists -----------------------------------------

export const DEPOT_TAB = 'depot'
export const CRYPTO_TAB = 'crypto'
export const BUILT_IN_TABS = [DEPOT_TAB, CRYPTO_TAB] as const

export type NavTab = {
  id: string
  label: string
  /** The market-store list behind it; null for a built-in view. */
  listId: number | null
}

export const listTabId = (listId: number): string => `list-${listId}`

/** The DOM ids that tie a tab to the panel it controls. */
export const TAB_PANEL_ID = 'depot-tab-panel'
export const tabDomId = (id: string): string => `depot-tab-${id}`

const BUILT_IN_LABEL: Record<string, string> = { [DEPOT_TAB]: 'In depot', [CRYPTO_TAB]: 'Crypto' }

const builtIn = (id: string): NavTab => ({ id, label: BUILT_IN_LABEL[id] ?? id, listId: null })

/** The tabs in their order: In depot, the owner's lists in their order, Crypto; a hidden built-in is left out. */
export function navTabs(lists: readonly WatchList[], hidden: readonly string[]): NavTab[] {
  const shown = (id: string): NavTab[] => (hidden.includes(id) ? [] : [builtIn(id)])
  return [
    ...shown(DEPOT_TAB),
    ...lists
      .toSorted((a, b) => a.position - b.position)
      .map((list) => ({ id: listTabId(list.id), label: list.name, listId: list.id })),
    ...shown(CRYPTO_TAB),
  ]
}

/** The built-in tabs that are hidden, to offer them back. */
export const hiddenTabs = (hidden: readonly string[]): NavTab[] =>
  BUILT_IN_TABS.filter((id) => hidden.includes(id)).map(builtIn)

/** The tab a page opens on: the depot when anything is held and it is shown, else the first tab. */
export function defaultTabId(tabs: readonly NavTab[], anyHeld: boolean): string {
  if (anyHeld && tabs.some((tab) => tab.id === DEPOT_TAB)) return DEPOT_TAB
  return tabs.find((tab) => tab.listId !== null)?.id ?? tabs[0]?.id ?? DEPOT_TAB
}

/** The tab that is shown: the one asked for when it exists, else the default (a stale id in the URL). */
export function resolveTab(tabs: readonly NavTab[], requested: string, fallback: string): string {
  return tabs.some((tab) => tab.id === requested) ? requested : fallback
}

/** The list a picked search hit is added to: the active list, else the default one. */
export function addTargetList(lists: readonly WatchList[], tab: string): WatchList | undefined {
  return lists.find((list) => listTabId(list.id) === tab) ?? lists.find((list) => list.is_default)
}

/** The position a list takes one place to the left or right of where it is; null at either end. */
export function neighbourListPosition(
  lists: readonly WatchList[],
  id: number,
  step: -1 | 1,
): number | null {
  const ordered = lists.toSorted((a, b) => a.position - b.position)
  const at = ordered.findIndex((list) => list.id === id)
  return ordered[at + step]?.position ?? null
}

// ---- Entries: labels, order, and what a row shows -------------------------------------------

/** A list entry's name: the user's own, else the instrument's, else its symbol. */
export const entryLabel = (entry: WatchListEntry): string =>
  entry.display_name ?? entry.quote.name ?? entry.symbol

/** The entries of a list as they stand after `symbol` moved to `position` (0-based; the others shift). */
export function movedEntries(
  entries: readonly WatchListEntry[],
  symbol: string,
  position: number,
): WatchListEntry[] {
  const ordered = entries.toSorted((a, b) => a.position - b.position)
  const moving = ordered.find((entry) => entry.symbol === symbol)
  if (moving === undefined) return ordered
  const rest = ordered.filter((entry) => entry !== moving)
  rest.splice(Math.min(Math.max(position, 0), rest.length), 0, moving)
  return rest.map((entry, position) => ({ ...entry, position }))
}

/**
 * The position an entry takes when moved one place up or down among the entries of its own kind group (the
 * group is derived, so an entry never leaves it); null at the end of the group.
 */
export function neighbourPosition(
  entries: readonly WatchListEntry[],
  symbol: string,
  step: -1 | 1,
): number | null {
  const own = entries.find((entry) => entry.symbol === symbol)
  if (own === undefined) return null
  const group = entries
    .filter((entry) => kindGroup(entry.kind) === kindGroup(own.kind))
    .toSorted((a, b) => a.position - b.position)
  const at = group.findIndex((entry) => entry.symbol === symbol)
  return group[at + step]?.position ?? null
}

/** Whether a row stands for an instrument whose bars the service is still fetching. */
export const awaitsHistory = (quote: Pick<WatchlistEntry, 'last_close' | 'kind'>): boolean =>
  quote.last_close === null &&
  quote.kind !== 'coin' &&
  quote.kind !== 'series' &&
  quote.kind !== 'index'

/** What the history load says, in the entry and in the card of the main area. */
export function backfillText(backfill: Backfill | undefined): string {
  if (backfill === undefined) return 'Loading history'
  switch (backfill.state) {
    case 'queued':
      return 'Waiting to load history'
    case 'running':
      return backfill.bars > 0 && backfill.from !== null
        ? `Loading history: ${backfill.bars.toLocaleString('de-DE')} days since ${backfill.from}`
        : 'Loading history'
    case 'failed':
      return backfill.error ?? 'The history could not be loaded'
    case 'done':
      return backfill.bars > 0 ? 'History loaded' : 'No history found'
    case 'none':
      return 'No history stored'
  }
}

export const loadingHistory = (backfill: Backfill | undefined): boolean =>
  backfill?.state === 'queued' || backfill?.state === 'running'

// ---- What a row of a tab is -------------------------------------------------------------------

export type SidebarItem = {
  /** What `?isin=` names: an ISIN, a coin symbol or a series id. */
  symbol: string
  label: string
  kind: MarketKind | null
  quote: WatchlistEntry
  held: boolean
  /** The list entry behind the row; null on the derived tabs, which cannot be reordered. */
  entry: WatchListEntry | null
  /** In depot: what is held. */
  line: DepotLine | null
}

export function listItems(list: WatchList, held: ReadonlySet<string>): SidebarItem[] {
  return list.entries
    .toSorted((a, b) => a.position - b.position)
    .map((entry) => ({
      symbol: entry.symbol,
      label: entryLabel(entry),
      kind: entry.kind ?? entry.quote.kind,
      quote: entry.quote,
      held: held.has(entry.quote.isin),
      entry,
      line: null,
    }))
}

export function depotItems(
  entries: readonly WatchlistEntry[],
  positions: readonly DepotPosition[],
): SidebarItem[] {
  const lines = depotLines(entries, positions)
  return lines.flatMap((line) => {
    const quote = entries.find((entry) => entry.isin === line.key)
    return quote === undefined
      ? []
      : [
          {
            symbol: line.key,
            label: line.name,
            kind: quote.kind,
            quote,
            held: true,
            entry: null,
            line,
          },
        ]
  })
}

/** The coins of the watchlist: Bitcoin in dollars, nothing more is ever listed. */
export const cryptoItems = (
  entries: readonly WatchlistEntry[],
  held: ReadonlySet<string>,
): SidebarItem[] =>
  entries
    .filter((entry) => entry.kind === 'coin')
    .map((quote) => ({
      symbol: quote.isin,
      label: quote.name ?? quote.isin,
      kind: quote.kind,
      quote,
      held: held.has(quote.isin),
      entry: null,
      line: null,
    }))

/** The rows of the active tab as the sidebar draws them, group by group. */
export function tabItems(
  tab: NavTab | undefined,
  lists: readonly WatchList[],
  entries: readonly WatchlistEntry[],
  positions: readonly DepotPosition[],
): SidebarItem[] {
  if (tab === undefined) return []
  const held = heldRows(entries, positions)
  if (tab.id === DEPOT_TAB) return depotItems(entries, positions)
  if (tab.id === CRYPTO_TAB) return cryptoItems(entries, held)
  const list = lists.find((l) => l.id === tab.listId)
  return list === undefined ? [] : listItems(list, held)
}

/**
 * The symbol the page shows: the one the URL names when the tab has it, else the tab's first row. The depot lists by
 * value, so its first row is the largest holding; a list reads by group, so its first row is the one at the top.
 */
export function pickSymbol(
  requested: string,
  items: readonly SidebarItem[],
  byValue: boolean,
): string | null {
  const wanted = requested.toUpperCase()
  const own = items.find((item) => item.symbol.toUpperCase() === wanted)
  if (own !== undefined) return own.symbol
  if (byValue) return items[0]?.symbol ?? null
  return groupByKind(items, (item) => item.kind)[0]?.items[0]?.symbol ?? null
}

/** The first of the tabs that lists `symbol`, for a link that names an instrument but no tab. */
export function tabHolding(
  tabs: readonly NavTab[],
  symbol: string,
  lists: readonly WatchList[],
  entries: readonly WatchlistEntry[],
  positions: readonly DepotPosition[],
): string | null {
  const wanted = symbol.toUpperCase()
  return (
    tabs.find((tab) =>
      tabItems(tab, lists, entries, positions).some((item) => item.symbol.toUpperCase() === wanted),
    )?.id ?? null
  )
}

// ---- Held instruments -------------------------------------------------------------------------

export type DepotLine = {
  /** The watchlist row's key (its ISIN, or the coin symbol). */
  key: string
  name: string
  /** Units held, summed over the instruments the row stands for. */
  quantity: number
  value_cents: number | null
  /** The row's share of the depot as a fraction; null when one of its positions has none. */
  share: number | null
}

/**
 * The rows the owner holds, the largest value first (a row with no value last). A row stands for every
 * instrument charted as it; sold-out instruments do not count.
 */
export function depotLines(
  entries: readonly WatchlistEntry[],
  positions: readonly DepotPosition[],
): DepotLine[] {
  const held = heldRows(entries, positions)
  return entries
    .filter((entry) => held.has(entry.isin))
    .flatMap((entry) => {
      const own = positions.filter((p) => p.quantity > 0 && instrumentsOf(entry).includes(p.isin))
      const merged = mergedPosition(own)
      if (merged === undefined) return []
      const share = own.every((p) => p.share !== null)
        ? own.reduce((sum, p) => sum + (p.share ?? 0), 0)
        : null
      return [
        {
          key: entry.isin,
          name: entry.name ?? entry.isin,
          quantity: merged.quantity,
          value_cents: merged.value_cents,
          share,
        },
      ]
    })
    .toSorted((a, b) => (b.value_cents ?? -1) - (a.value_cents ?? -1))
}

// ---- The chart of a series ----------------------------------------------------------------------

/** A daily series that sends closes only has no candles to draw: its bars are the close four times, so it is a line. */
export const closeOnlyDaily = (bars: readonly ChartBar[], interval: DepotInterval): boolean =>
  interval === '1d' && bars.length > 0 && bars.every((bar) => bar.derived_from_close === true)
