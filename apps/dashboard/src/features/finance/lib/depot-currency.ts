import type { ChartBar, SeriesResponse, WatchlistEntry } from '../api/types'

/** Rates of the ECB reference series: US dollars per euro, ascending by day. */
export type Rates = SeriesResponse['points']

export type ChartCurrency = 'USD' | 'EUR'

/** The series id of the ECB reference rate. */
export const EUR_USD = 'eur-usd'

/**
 * The currency an instrument's chart is natively in: dollars for a US listing, else what its row says. An index series
 * of the store names no currency of its own and carries it in its id (`msci-world-net-usd`).
 */
export function nativeCurrency(
  entry: Pick<WatchlistEntry, 'isin' | 'currency' | 'us_mic' | 'kind'>,
): string | null {
  if (entry.us_mic !== null) return 'USD'
  if (entry.currency !== null) return entry.currency
  return entry.kind === 'index' && entry.isin.endsWith('-usd') ? 'USD' : null
}

/** The title of a dollar chart read in euros: a name that says dollars ("Bitcoin in USD", "…, USD") drops it. */
export const euroTitle = (name: string): string => `${name.replace(/(,| in)? USD$/, '')} · EUR`

const dayOf = (time: number): string => new Date(time * 1000).toISOString().slice(0, 10)

/**
 * Dollar bars in euros, each at the ECB rate of its day (the latest earlier day where the ECB has none). A bar before
 * the first rate has no euro price and is left out. `bars` and `rates` ascend.
 */
export function eurBars(bars: readonly ChartBar[], rates: Rates): ChartBar[] {
  const out: ChartBar[] = []
  let at = -1
  for (const bar of bars) {
    const day = dayOf(bar.time)
    while ((rates[at + 1]?.day ?? '9999') <= day) at++
    const rate = rates[at]?.value
    if (rate === undefined || rate <= 0) continue
    out.push({
      ...bar,
      open: bar.open / rate,
      high: bar.high / rate,
      low: bar.low / rate,
      close: bar.close / rate,
      turnover: bar.turnover === null ? null : bar.turnover / rate,
    })
  }
  return out
}

/** The first day of the week (Monday) or month a day bar belongs to, as the service dates its week and month bars. */
function periodStart(time: number, interval: '1w' | '1mo'): number {
  const date = new Date(time * 1000)
  if (interval === '1mo') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000
  return time - ((date.getUTCDay() + 6) % 7) * 86_400
}

const sumOrNull = (values: readonly (number | null)[]): number | null =>
  values.reduce<number | null>((sum, v) => (sum === null || v === null ? null : sum + v), 0)

/**
 * Week or month candles built from day bars: needed where the days are converted first, so that a candle's open and
 * close each carry the rate of their own day.
 */
export function aggregateBars(daily: readonly ChartBar[], interval: '1w' | '1mo'): ChartBar[] {
  const groups = new Map<number, ChartBar[]>()
  for (const bar of daily) {
    const start = periodStart(bar.time, interval)
    const group = groups.get(start)
    if (group === undefined) groups.set(start, [bar])
    else group.push(bar)
  }
  return [...groups].flatMap(([time, days]) => {
    const first = days[0]
    const last = days.at(-1)
    if (first === undefined || last === undefined) return []
    return [
      {
        time,
        open: first.open,
        high: Math.max(...days.map((d) => d.high)),
        low: Math.min(...days.map((d) => d.low)),
        close: last.close,
        units: sumOrNull(days.map((d) => d.units)),
        turnover: sumOrNull(days.map((d) => d.turnover)),
        source: days.every((d) => d.source === first.source) ? first.source : 'mixed',
        days: days.length,
        ...(days.some((d) => d.derived_from_close === true) && {
          derived_from_close: true as const,
        }),
      },
    ]
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function scaleEntry(entry: unknown, factor: number): unknown {
  if (!isRecord(entry) || !Array.isArray(entry['points'])) return entry
  return {
    ...entry,
    points: entry['points'].map((point: unknown) =>
      isRecord(point) && typeof point['price'] === 'number'
        ? { ...point, price: point['price'] * factor }
        : point,
    ),
  }
}

/**
 * A stored drawing document with every price multiplied by `factor`. Drawings are kept in the instrument's own
 * currency: a euro view of a dollar chart shows them at the latest rate and saves them back divided by it.
 */
export function scaleDrawings(stored: unknown, factor: number): unknown {
  if (factor === 1) return stored
  if (Array.isArray(stored)) return stored.map((entry) => scaleEntry(entry, factor))
  if (!isRecord(stored)) return stored
  const scaled = { ...stored }
  for (const key of ['drawings', 'foreign']) {
    const list = stored[key]
    if (Array.isArray(list)) scaled[key] = list.map((entry) => scaleEntry(entry, factor))
  }
  return scaled
}
