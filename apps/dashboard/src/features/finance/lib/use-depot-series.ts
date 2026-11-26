import { useCandles, useIndexSeries, useTail } from '../api/queries'
import type { CandleQuery } from '../api/queries'
import type { CandlesResponse, ChartBar, WatchlistEntry } from '../api/types'
import { depotInterval } from './depot-chart'
import type { DepotInterval } from './depot-chart'
import { aggregateBars, EUR_USD, eurBars, nativeCurrency } from './depot-currency'
import { DIRECT_MIC, mergeTail } from './depot-live'
import { splicedHistory } from './depot-nav'
import { useViewPrefs } from './view-prefs'

/** The history with the tail's newer bars in it, when both are of the same instrument, interval and venue. */
const withTail = (
  history: CandlesResponse | undefined,
  tail: CandlesResponse | undefined,
): ChartBar[] | undefined => {
  if (history === undefined) return undefined
  if (
    tail === undefined ||
    tail.isin !== history.isin ||
    tail.interval !== history.interval ||
    tail.mic !== history.mic
  ) {
    return history.candles
  }
  return mergeTail(history.candles, tail.candles)
}

/** Whether the venue switch is offered: a share or fund trades on ING Direkthandel, a coin or an index does not. */
export const tradesDirect = (entry: WatchlistEntry | undefined): boolean =>
  entry !== undefined && ['stock', 'etf', 'etc', null].includes(entry.kind)

/**
 * The bars behind the chart of one row, in the currency the owner reads it in: the stored bars, or, for a dollar chart
 * switched to euros, every day converted at its ECB rate (week and month candles built from the converted days). The
 * venue is one at a time: the exchange of the long history, or ING Direkthandel's own days. The running candle is the
 * venue's own, refreshed every `every` milliseconds without asking for the history again.
 */
export function useDepotSeries({
  entry,
  isin,
  interval,
  charting,
  today,
  every,
}: {
  entry: WatchlistEntry | undefined
  isin: string | null
  interval: DepotInterval
  charting: boolean
  today: string
  every: number | false
}) {
  const [prefs] = useViewPrefs(isin ?? '')
  const direct = prefs.venue === 'direct' && tradesDirect(entry)
  const mic = direct ? DIRECT_MIC : (entry?.us_mic ?? undefined)
  // Every stored daily bar at once (the timeframes only move the view); an ETF with a tracked index
  // comes with that index in front of its first bar on its exchange.
  const query: CandleQuery | null =
    isin === null || !charting
      ? null
      : {
          isin,
          interval,
          mic,
          splice: !direct && splicedHistory(entry) ? 'index' : undefined,
          today: 1,
        }
  const candles = useCandles(query)
  // The daily history, for the all-time high, the index level of an ETF's orders and the converted week and month
  // candles: the chart's own bars at day, one more request at week and month.
  const daily = useCandles(
    isin === null || !charting || interval === '1d'
      ? null
      : { isin, interval: '1d', mic, today: 1 },
  )
  const answered = candles.data?.isin === isin ? candles.data.currency : null
  // The currency the instrument is stored in (drawings are kept in it), and the one of the venue's bars.
  const own = (entry === undefined ? null : nativeCurrency(entry)) ?? (direct ? null : answered)
  const native = direct ? 'EUR' : own
  const converting = native === 'USD' && prefs.currency === 'EUR'
  // An index series of the store answers with no currency of its own: it is in the one its id names.
  const stored =
    candles.data?.currency ?? (candles.data?.isin === isin && native === 'USD' ? native : null)
  const rates = useIndexSeries(own === 'USD' ? EUR_USD : null, { to: today })
  const rate = own === 'USD' ? rates.data?.points.at(-1) : undefined

  // One tail: the days where they are converted here, else the bars of the chart's interval.
  const tail = useTail(
    query === null ? null : { isin: query.isin, interval: converting ? '1d' : interval, mic },
    every,
  )
  // The daily history of a week or month chart has its own tail: the high and the last price hang on it.
  const sharesTail = interval === '1d' || converting
  const dailyTail = useTail(
    query === null || sharesTail ? null : { isin: query.isin, interval: '1d', mic },
    every,
  )
  const dailyQuery = interval === '1d' ? candles : daily
  const dailyRaw = dailyQuery.isPlaceholderData
    ? undefined
    : withTail(dailyQuery.data, sharesTail ? tail.data : dailyTail.data)
  const dailyBars: readonly ChartBar[] | undefined = !converting
    ? dailyRaw
    : dailyRaw === undefined || rates.data === undefined
      ? undefined
      : eurBars(dailyRaw, rates.data.points)

  const bars: readonly ChartBar[] = !converting
    ? ((candles.isPlaceholderData ? candles.data?.candles : withTail(candles.data, tail.data)) ??
      [])
    : dailyBars === undefined
      ? []
      : interval === '1d'
        ? dailyBars
        : aggregateBars(dailyBars, interval)

  const shownCurrency = converting || direct ? 'EUR' : stored
  // A dollar instrument on a euro chart needs the rate for its drawings: without it they would be read and saved as euros,
  // so the chart waits (or fails) with them.
  const unrated = own === 'USD' && shownCurrency === 'EUR' && rate === undefined
  return {
    /** ING Direkthandel's own days are on screen. */
    direct,
    native,
    /** The currency the bars are in; null for a series of points. */
    currency: shownCurrency,
    converting,
    bars,
    /** Undefined until the daily history of this row is here. */
    dailyBars,
    /** The interval the bars are: the last request's while the next one loads. */
    interval: converting ? interval : depotInterval(candles.data?.interval, interval),
    pending: unrated
      ? rates.error === null
      : converting
        ? dailyBars === undefined
        : candles.isPending,
    error:
      candles.error ??
      (converting ? (dailyQuery.error ?? rates.error) : unrated ? rates.error : null),
    refetch: () => {
      void candles.refetch()
      void tail.refetch()
      if (own === 'USD') void rates.refetch()
      if (converting && interval !== '1d') void daily.refetch()
    },
    notes: candles.data?.notes ?? [],
    /** The latest ECB rate and its day, for a dollar instrument. */
    rate: rate === undefined ? null : { usdPerEur: rate.value, day: rate.day },
    /** What a stored drawing price is multiplied by to be drawn. */
    drawScale: own === 'USD' && shownCurrency === 'EUR' && rate !== undefined ? 1 / rate.value : 1,
  }
}

export type DepotSeries = ReturnType<typeof useDepotSeries>
