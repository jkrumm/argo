import {
  focusManager,
  keepPreviousData,
  queryOptions,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import { FINANCE_DATA, FinanceApiError, financeGet } from './client'
import { EUR_LINE_MIC, LIVE_POLL_MS, pollDelay } from '../lib/depot-live'
import type {
  CandlesResponse,
  CategoryMonth,
  ChartDrawings,
  DepotOrder,
  DepotPositions,
  DepotStats,
  DepotTrade,
  WatchlistEntry,
  Holdings,
  MerchantQuery,
  MerchantTotal,
  Meta,
  Month,
  MonthStatus,
  NetWorth,
  Overview,
  QuotesResponse,
  RangeQuery,
  RecurringRow,
  SeriesInfo,
  SeriesResponse,
  TaxYearRow,
  TxList,
  TxQuery,
  TxRow,
} from './types'

/** Vault rows change only through a sync or an edit (the layout / the writes invalidate `FINANCE_DATA`), so a fetched answer stays good until then. */
const SESSION = { staleTime: Number.POSITIVE_INFINITY, placeholderData: keepPreviousData } as const

/** The cache family of every transaction list; the writes patch rows inside it. */
export const TX_KEY = [...FINANCE_DATA, 'transactions'] as const

export const metaOptions = queryOptions({
  queryKey: [...FINANCE_DATA, 'meta'],
  queryFn: () => financeGet<Meta>('/meta'),
  staleTime: Number.POSITIVE_INFINITY,
})

export const useMeta = () => useQuery(metaOptions)

/** `month` `''` asks for the service's current budget month. */
export const useMonthStatus = (month: Month | '') =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'month-status', month],
    queryFn: () => financeGet<MonthStatus>('/month-status', { month }),
    // Today moves the projection; a minute keeps a tab left open honest without hammering the vault.
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

export const useOverview = (range: RangeQuery | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'overview', range],
    queryFn: () => financeGet<Overview>('/overview', { ...range }),
    enabled: range !== null,
    ...SESSION,
  })

export const useCategoryMonths = (range: RangeQuery | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'categories', range],
    queryFn: () => financeGet<CategoryMonth[]>('/categories', { ...range }),
    enabled: range !== null,
    ...SESSION,
  })

export const useMerchants = (query: MerchantQuery | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'merchants', query],
    queryFn: () => financeGet<MerchantTotal[]>('/merchants', { ...query }),
    enabled: query !== null,
    ...SESSION,
  })

/** Active series; `all` adds the cancelled and the excluded ones. */
export const useRecurring = (all: boolean) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'recurring', all],
    queryFn: () => financeGet<RecurringRow[]>('/recurring', all ? { all: 1 } : {}),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const useNetWorth = () =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'net-worth'],
    queryFn: () => financeGet<NetWorth>('/net-worth'),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const useHoldings = () =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'holdings'],
    queryFn: () => financeGet<Holdings>('/holdings'),
    staleTime: Number.POSITIVE_INFINITY,
  })

/** One page of the ledger plus the number of matches. */
export const useTransactions = (query: TxQuery | null) =>
  useQuery({
    queryKey: [...TX_KEY, 'page', query],
    queryFn: () => financeGet<TxList>('/transactions', { ...query }),
    enabled: query !== null,
    ...SESSION,
  })

const PAGE = 500
/** A month of bookings is a few hundred rows; this keeps a runaway range from fetching without end. */
const MAX_ROWS = 5000

/** Every booking matching `query`, fetched page by page: the month page sums them by day. */
export async function fetchAllTransactions(query: TxQuery): Promise<TxRow[]> {
  const rows: TxRow[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await financeGet<TxList>('/transactions', { ...query, offset, limit: PAGE })
    rows.push(...page.rows)
    if (rows.length >= page.total || page.rows.length < PAGE) break
  }
  return rows
}

export const useAllTransactions = (query: TxQuery | null) =>
  useQuery({
    queryKey: [...TX_KEY, 'all', query],
    queryFn: () => fetchAllTransactions(query ?? {}),
    enabled: query !== null,
    ...SESSION,
  })

export const useTaxYear = (year: number | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'tax-year', year],
    queryFn: () => financeGet<TaxYearRow[]>('/tax-year', { year: year ?? undefined }),
    enabled: year !== null,
    ...SESSION,
  })

// ---- The depot chart (finances `docs/service.md` §Chart routes) ----

/** The market routes answer while the vault is locked; the depot and drawing routes need it open. */
export const DEPOT_KEY = [...FINANCE_DATA, 'depot'] as const

/** Instruments with their last close and day change. A new close arrives with the day's sync, so a minute is fresh enough. */
export const useWatchlist = () =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'watchlist'],
    queryFn: () => financeGet<WatchlistEntry[]>('/market/watchlist'),
    staleTime: 60_000,
  })

export type CandleQuery = {
  isin: string
  interval: string
  /** No `from` and no `to`: every stored bar (the service answers up to 20,000). */
  from?: string | undefined
  to?: string | undefined
  /** The US listing to read (USD bars), for a row that has one. */
  mic?: string | undefined
  /** `index`: an ETF's history starts with the index it tracks (flagged bars). */
  splice?: 'index' | undefined
  /** Appends the running day as a provisional bar. */
  today?: 1 | undefined
  /** Only the newest bars. */
  limit?: number | undefined
}

/** A whole history is read once: its running day is kept current by `useTail`, never by asking for it again. */
const HISTORY_STALE_MS = 3_600_000

export const useCandles = (query: CandleQuery | null) =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'candles', query],
    queryFn: () => financeGet<CandlesResponse>('/market/candles', { ...query }),
    enabled: query !== null,
    staleTime: HISTORY_STALE_MS,
    placeholderData: keepPreviousData,
  })

/** The bars a tail request asks for: enough to close the gap of a chart left open over a few days. */
const TAIL_BARS = 5

/**
 * The newest bars of a history with its running day, asked again on the quote's schedule (`pollDelay`): the chart's
 * running candle, in the bar interval and venue of its history. A hidden tab asks nothing.
 */
export const useTail = (query: CandleQuery | null, every: number | false) =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'candles-tail', query],
    queryFn: () =>
      financeGet<CandlesResponse>('/market/candles', { ...query, today: 1, limit: TAIL_BARS }),
    enabled: query !== null,
    staleTime: LIVE_POLL_MS / 2,
    refetchInterval: every,
    refetchOnWindowFocus: 'always',
  })

/** The most symbols the quote route takes at once. */
const QUOTE_BATCH = 50

/**
 * The live quote of each symbol, by symbol; `mic` `XETR` asks every ISIN's euro line. Asked every minute while a session
 * of the batch is not closed and the tab is visible; answers while the vault is locked.
 */
export function useQuotes(symbols: readonly string[], mic?: typeof EUR_LINE_MIC) {
  const wanted = [...new Set(symbols)].toSorted()
  const batches = Array.from({ length: Math.ceil(wanted.length / QUOTE_BATCH) }, (_, at) =>
    wanted.slice(at * QUOTE_BATCH, (at + 1) * QUOTE_BATCH).join(','),
  )
  const results = useQueries({
    queries: batches.map((batch) => ({
      queryKey: [...DEPOT_KEY, 'quote', batch, mic ?? ''],
      queryFn: () => financeGet<QuotesResponse>('/market/quote', { symbols: batch, mic }),
      staleTime: LIVE_POLL_MS / 2,
      refetchInterval: (query: { state: { data?: QuotesResponse | undefined } }) =>
        pollDelay(query.state.data?.quotes, Date.now(), focusManager.isFocused()),
      refetchOnWindowFocus: 'always' as const,
    })),
  })
  const quotes = results.flatMap((result) => result.data?.quotes ?? [])
  return {
    quotes: new Map(quotes.map((quote) => [quote.symbol, quote] as const)),
    /** When the next request is due, for a request that follows the same sessions. */
    every: pollDelay(
      quotes.length === 0 ? undefined : quotes,
      results[0]?.dataUpdatedAt ?? 0,
      true,
    ),
  }
}

/**
 * The daily bars of several instruments, each by its own request, for rows no board route covers (a held instrument on no
 * list). Same cache entries as the chart's own daily request where it asks the same way (no `mic`, no `splice`).
 */
export function useDailyBars(queries: readonly (CandleQuery & { isin: string })[]) {
  const results = useQueries({
    queries: queries.map((query) => ({
      queryKey: [...DEPOT_KEY, 'candles', query],
      queryFn: () => financeGet<CandlesResponse>('/market/candles', { ...query }),
      staleTime: HISTORY_STALE_MS,
    })),
  })
  return {
    pending: results.some((result) => result.isPending),
    bars: new Map(
      queries.map((query, at) => [query.isin, results[at]?.data?.candles ?? []] as const),
    ),
  }
}

/** What the market store holds of its long-run series; the Indices group lists the ones it has. */
export const useSeriesCatalog = () =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'series-catalog'],
    queryFn: () => financeGet<SeriesInfo[]>('/market/series'),
    staleTime: 300_000,
  })

/** One stored series from `from` (no `from`: everything). At most 20,000 points: about 80 years of days. */
export const useIndexSeries = (
  id: string | null,
  window: { from?: string | undefined; to: string },
) =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'series', id, window],
    queryFn: () => financeGet<SeriesResponse>('/market/series', { id: id ?? undefined, ...window }),
    enabled: id !== null,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  })

export const usePositions = () =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'positions'],
    queryFn: () => financeGet<DepotPositions>('/depot/positions'),
    staleTime: 60_000,
  })

/** Every trade of the depot: an index entry reads the ones of the ETFs that track it out of them. */
export const useAllTrades = (enabled: boolean) =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'trades', 'all'],
    queryFn: () => financeGet<DepotTrade[]>('/depot/trades'),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })

export const useDepotTrades = (isin: string | null) =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'trades', isin],
    queryFn: () => financeGet<DepotTrade[]>('/depot/trades', { isin: isin ?? undefined }),
    enabled: isin !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })

/** What an instrument has made over all time. A 404 is an instrument with no trade: the page says so, it is no failure. */
export const useDepotStats = (isin: string | null) =>
  useQuery({
    queryKey: [...DEPOT_KEY, 'stats', isin],
    queryFn: () => financeGet<DepotStats>('/depot/stats', { isin: isin ?? undefined }),
    enabled: isin !== null,
    staleTime: 60_000,
    retry: (count, error) =>
      !(error instanceof FinanceApiError && error.status === 404) && count < 2,
  })

export const ORDERS_KEY = [...DEPOT_KEY, 'orders'] as const

export const useOpenOrders = (isin: string | null) =>
  useQuery({
    queryKey: [...ORDERS_KEY, isin],
    queryFn: () =>
      financeGet<DepotOrder[]>('/depot/orders', { status: 'open', isin: isin ?? undefined }),
    enabled: isin !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })

/** Every open order, for an index entry; under `ORDERS_KEY`, so a write refetches it too. */
export const useAllOpenOrders = (enabled: boolean) =>
  useQuery({
    queryKey: [...ORDERS_KEY, 'all'],
    queryFn: () => financeGet<DepotOrder[]>('/depot/orders', { status: 'open' }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })

/** The stored drawing document of one instrument; the chart owns it after the first read, so it never refetches by itself. */
export const drawingsOptions = (isin: string) =>
  queryOptions({
    queryKey: [...DEPOT_KEY, 'drawings', isin],
    queryFn: () => financeGet<ChartDrawings>(`/chart/drawings/${isin}`),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  })

export const useDrawings = (isin: string | null) =>
  useQuery({ ...drawingsOptions(isin ?? ''), enabled: isin !== null })
