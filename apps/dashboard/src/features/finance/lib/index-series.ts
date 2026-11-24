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
  id: string
  name: string
  /** A stored series outside the MSCI group (the owner added it from the search): what the store says of it. */
  other?: { unit: string }
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

/** A stored series by its id: one of the MSCI group, else any series the store holds levels of. */
export function seriesOf(
  id: string,
  catalog: readonly { id: string; title: string; unit: string; points: number }[],
): IndexSeries | undefined {
  const known = indexById(id)
  if (known !== undefined) return known
  const info = catalog.find((entry) => entry.id === id.toLowerCase() && entry.points > 0)
  return info === undefined
    ? undefined
    : { id: info.id, name: info.title, other: { unit: info.unit } }
}

/** What the page says about every one of them, so a card names its source. */
export const INDEX_SOURCE = 'MSCI · net return · EUR'
