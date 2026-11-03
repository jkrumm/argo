import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { FINANCE_DATA, financeGet } from './client'
import type {
  CategoryMonth,
  Holdings,
  MerchantQuery,
  MerchantTotal,
  Meta,
  Month,
  MonthStatus,
  NetWorth,
  Overview,
  RangeQuery,
  RecurringRow,
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
