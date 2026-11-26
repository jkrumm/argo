import { useCandles, useIndexSeries } from '../api/queries'
import type { ChartBar, WatchlistEntry } from '../api/types'
import { depotInterval } from './depot-chart'
import type { DepotInterval } from './depot-chart'
import { aggregateBars, EUR_USD, eurBars, nativeCurrency } from './depot-currency'
import { splicedHistory } from './depot-nav'
import { useViewPrefs } from './view-prefs'

/**
 * The bars behind the chart of one row, in the currency the owner reads it in: the stored bars, or, for a dollar chart
 * switched to euros, every day converted at its ECB rate (week and month candles built from the converted days).
 */
export function useDepotSeries({
  entry,
  isin,
  interval,
  charting,
  today,
}: {
  entry: WatchlistEntry | undefined
  isin: string | null
  interval: DepotInterval
  charting: boolean
  today: string
}) {
  const [prefs] = useViewPrefs(isin ?? '')
  const mic = entry?.us_mic ?? undefined
  // Every stored daily bar at once (the timeframes only move the view); an ETF with a tracked index
  // comes with that index in front of its first bar.
  const candles = useCandles(
    isin === null || !charting
      ? null
      : { isin, interval, mic, splice: splicedHistory(entry) ? 'index' : undefined },
  )
  // The daily history, for the all-time high, the index level of an ETF's orders and the converted week and month
  // candles: the chart's own bars at day, one more request at week and month.
  const daily = useCandles(
    isin === null || !charting || interval === '1d' ? null : { isin, interval: '1d', mic },
  )
  const answered = candles.data?.isin === isin ? candles.data.currency : null
  const native = (entry === undefined ? null : nativeCurrency(entry)) ?? answered
  const converting = native === 'USD' && prefs.currency === 'EUR'
  const rates = useIndexSeries(native === 'USD' ? EUR_USD : null, { to: today })
  const rate = native === 'USD' ? rates.data?.points.at(-1) : undefined

  const dailyQuery = interval === '1d' ? candles : daily
  const dailyRaw = dailyQuery.isPlaceholderData ? undefined : dailyQuery.data?.candles
  const dailyBars: readonly ChartBar[] | undefined = !converting
    ? dailyRaw
    : dailyRaw === undefined || rates.data === undefined
      ? undefined
      : eurBars(dailyRaw, rates.data.points)

  const bars: readonly ChartBar[] = !converting
    ? (candles.data?.candles ?? [])
    : dailyBars === undefined
      ? []
      : interval === '1d'
        ? dailyBars
        : aggregateBars(dailyBars, interval)

  return {
    native,
    /** The currency the bars are in; null for a series of points. */
    currency: converting ? 'EUR' : (candles.data?.currency ?? null),
    converting,
    bars,
    /** Undefined until the daily history of this row is here. */
    dailyBars,
    /** The interval the bars are: the last request's while the next one loads. */
    interval: converting ? interval : depotInterval(candles.data?.interval, interval),
    pending: converting ? dailyBars === undefined : candles.isPending,
    error: candles.error ?? (converting ? (dailyQuery.error ?? rates.error) : null),
    refetch: () => {
      void candles.refetch()
      if (converting) {
        void rates.refetch()
        if (interval !== '1d') void daily.refetch()
      }
    },
    notes: candles.data?.notes ?? [],
    /** The latest ECB rate and its day, for a dollar instrument. */
    rate: rate === undefined ? null : { usdPerEur: rate.value, day: rate.day },
    /** What a stored drawing price is multiplied by to be drawn. */
    drawScale: converting && rate !== undefined ? 1 / rate.value : 1,
  }
}

export type DepotSeries = ReturnType<typeof useDepotSeries>
