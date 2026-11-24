/**
 * The long-run index series the depot page lists as its Indices group: the official MSCI net-return
 * series (euros, daily levels; before 2000-12-29 month ends) of the market store (finances
 * `docs/market.md` §D). The ids are `fin market series list` ids; a series the store has not synced is
 * left out of the watchlist.
 */
export const INDEX_IDS = [
  'msci-acwi-imi-net-eur',
  'msci-world-net-eur',
  'msci-em-net-eur',
  'msci-world-small-cap-net-eur',
  'msci-europe-net-eur',
] as const

export type IndexId = (typeof INDEX_IDS)[number]

export type IndexSeries = {
  id: IndexId
  name: string
}

export const INDEX_SERIES: readonly IndexSeries[] = [
  { id: 'msci-acwi-imi-net-eur', name: 'MSCI ACWI IMI' },
  { id: 'msci-world-net-eur', name: 'MSCI World' },
  { id: 'msci-em-net-eur', name: 'MSCI Emerging Markets' },
  { id: 'msci-world-small-cap-net-eur', name: 'MSCI World Small Cap' },
  { id: 'msci-europe-net-eur', name: 'MSCI Europe' },
]

/** The index a URL names (`?isin=`), or undefined for an ISIN. */
export const indexById = (id: string): IndexSeries | undefined =>
  INDEX_SERIES.find((series) => series.id === id.toLowerCase())

/** What the page says about every one of them, so a card names its source. */
export const INDEX_SOURCE = 'MSCI · net return · EUR'

/** The index an ETF is read against until the owner picks another: the stand-in for a global all-cap fund. */
export const DEFAULT_COMPARISON: IndexId = 'msci-acwi-imi-net-eur'
