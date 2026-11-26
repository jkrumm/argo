/**
 * An index entry has nothing to hold: its depot is that of the ETFs that track it (the rows whose `index` is the
 * series). Their orders and trades are drawn on the index chart at the equivalent level.
 */
import type { WatchlistEntry } from '../api/types'
import type { PriceLine } from './depot-chart'

/** The rows that track the series `symbol`. */
export const trackersOf = (entries: readonly WatchlistEntry[], symbol: string): WatchlistEntry[] =>
  entries.filter(
    (entry) => entry.index === symbol && entry.kind !== 'index' && entry.kind !== 'series',
  )

type Close = { time: number; close: number }

/**
 * What one euro of the ETF's price is on the index chart: the index close (in the chart's currency) over the ETF's euro
 * close, on the latest day both have one. A price at this factor sits as far from the index close as it does from the
 * ETF close. Null while the two share no day. Both ascend.
 */
export function indexFactor(index: readonly Close[], etf: readonly Close[]): number | null {
  const closes = new Map(etf.map((bar) => [bar.time, bar.close]))
  for (let at = index.length - 1; at >= 0; at--) {
    const bar = index[at]
    if (bar === undefined) continue
    const own = closes.get(bar.time)
    if (own !== undefined && own > 0) return bar.close / own
  }
  return null
}

/** The ETF's order line moved to its index level; the label keeps the ETF's own price, and its name when there are several. */
export const atIndexLevel = (line: PriceLine, factor: number, name?: string): PriceLine => ({
  ...line,
  price: line.price * factor,
  title: name === undefined ? line.title : `${line.title} · ${name}`,
})
