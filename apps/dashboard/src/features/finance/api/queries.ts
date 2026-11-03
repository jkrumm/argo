import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { FINANCE_DATA, financeGet } from './client'
import type {
  EventTotal,
  MerchantQuery,
  MerchantTotal,
  Meta,
  Month,
  MonthDetail,
  NetWorth,
  RangeQuery,
  Report,
  RecurringRow,
  TaxYearRow,
  TxQuery,
  TxRow,
} from './types'

/** Vault rows change only through a sync (the layout invalidates `FINANCE_DATA` when one finishes), so a fetched answer stays good until then. */
const SESSION = { staleTime: Number.POSITIVE_INFINITY, placeholderData: keepPreviousData } as const

const metaOptions = queryOptions({
  queryKey: [...FINANCE_DATA, 'meta'],
  queryFn: () => financeGet<Meta>('/meta'),
  staleTime: Number.POSITIVE_INFINITY,
})

export const useMeta = () => useQuery(metaOptions)

export const useReport = (range: RangeQuery | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'report', range],
    queryFn: () => financeGet<Report>('/report', { ...range }),
    enabled: range !== null,
    ...SESSION,
  })

export const useMonth = (month: Month | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'month', month],
    queryFn: () => financeGet<MonthDetail>('/month', { month: month ?? undefined }),
    enabled: month !== null,
    ...SESSION,
  })

export const useEvents = () =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'events'],
    queryFn: () => financeGet<EventTotal[]>('/events'),
    ...SESSION,
  })

export const useMerchants = (query: MerchantQuery | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'merchants', query],
    queryFn: () => financeGet<MerchantTotal[]>('/merchants', { ...query }),
    enabled: query !== null,
    ...SESSION,
  })

export const useRecurring = () =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'recurring'],
    queryFn: () => financeGet<RecurringRow[]>('/recurring'),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const useNetWorth = () =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'net-worth'],
    queryFn: () => financeGet<NetWorth>('/net-worth'),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const useTransactions = (query: TxQuery | null) =>
  useQuery({
    queryKey: [...FINANCE_DATA, 'transactions', query],
    queryFn: () => financeGet<TxRow[]>('/transactions', { ...query }),
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
