import type { DepotPosition, WatchList, WatchListEntry, WatchlistEntry } from '../api/types'
import { heldRows, instrumentsOf, mergedPosition } from './depot-chart'

export type WatchTab = { id: string; label: string }

export const DEPOT_TAB = 'depot'
export const CRYPTO_TAB = 'crypto'
export const INDICES_TAB = 'indices'

export const listTabId = (listId: number): string => `list-${listId}`

/** The tabs in their order: In depot, the user's lists, Crypto, Indices. */
export function watchTabs(lists: readonly WatchList[]): WatchTab[] {
  return [
    { id: DEPOT_TAB, label: 'In depot' },
    ...lists.map((list) => ({ id: listTabId(list.id), label: list.name })),
    { id: CRYPTO_TAB, label: 'Crypto' },
    { id: INDICES_TAB, label: 'Indices' },
  ]
}

/** The tab a panel opens on: the depot when anything is held, else the first list. */
export function defaultTabId(lists: readonly WatchList[], anyHeld: boolean): string {
  const [first] = lists
  if (anyHeld || first === undefined) return DEPOT_TAB
  return listTabId(first.id)
}

/** The tab that is shown: the one asked for when it exists, else the default (a stale id in the URL). */
export function resolveTab(tabs: readonly WatchTab[], requested: string, fallback: string): string {
  return tabs.some((tab) => tab.id === requested) ? requested : fallback
}

/** A list entry's name: the user's own, else the instrument's, else its symbol. */
export const entryLabel = (entry: WatchListEntry): string =>
  entry.display_name ?? entry.quote.name ?? entry.symbol

/** The list a picked search hit is added to: the active user list, else the default one. */
export function addTargetList(lists: readonly WatchList[], tab: string): WatchList | undefined {
  return lists.find((list) => listTabId(list.id) === tab) ?? lists.find((list) => list.is_default)
}

/** The watchlist rows of the Crypto tab: the coins (`BTC-USD`). */
export const cryptoRows = (entries: readonly WatchlistEntry[]): WatchlistEntry[] =>
  entries.filter((entry) => entry.kind === 'coin')

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
