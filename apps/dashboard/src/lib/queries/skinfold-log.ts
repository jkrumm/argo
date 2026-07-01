import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export type SkinfoldSite = 'abdominal' | 'suprailiac'

export type SkinfoldWindowParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

export type SkinfoldListParams = {
  page?: number
  limit?: number
  sort?: 'date' | 'site' | 'value_mm'
  order?: 'asc' | 'desc'
}

export type CreateSkinfoldLogInput = {
  date: string
  readings: Array<{ site: SkinfoldSite; value_mm: number }>
}

export const skinfoldLogQueries = {
  all: () => ['skinfold-log'] as const,
  summary: (params: SkinfoldWindowParams) =>
    queryOptions({
      queryKey: [...skinfoldLogQueries.all(), 'summary', params] as const,
      queryFn: async () => unwrap(await api['skinfold-log'].summary.get({ query: params })),
    }),
  series: (params: SkinfoldWindowParams) =>
    queryOptions({
      queryKey: [...skinfoldLogQueries.all(), 'series', params] as const,
      queryFn: async () => unwrap(await api['skinfold-log'].series.get({ query: params })),
    }),
  list: (params: SkinfoldListParams) =>
    queryOptions({
      queryKey: [...skinfoldLogQueries.all(), 'list', params] as const,
      queryFn: async () => unwrap(await api['skinfold-log'].get({ query: params })),
    }),
}

export function useCreateSkinfoldLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSkinfoldLogInput) => api['skinfold-log'].post(body).then(unwrap),
    onSuccess: () => void qc.invalidateQueries({ queryKey: skinfoldLogQueries.all() }),
  })
}

export function useDeleteSkinfoldLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api['skinfold-log']({ id: String(id) })
        .delete()
        .then(unwrap),
    onSuccess: () => void qc.invalidateQueries({ queryKey: skinfoldLogQueries.all() }),
  })
}
