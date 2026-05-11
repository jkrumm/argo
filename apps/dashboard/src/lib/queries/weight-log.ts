import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export type WeightLogWindowParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

export const weightLogQueries = {
  all: () => ['weight-log'] as const,
  summary: (params: WeightLogWindowParams) =>
    queryOptions({
      queryKey: [...weightLogQueries.all(), 'summary', params] as const,
      queryFn: async () => unwrap(await api['weight-log'].summary.get({ query: params })),
    }),
  series: (params: WeightLogWindowParams) =>
    queryOptions({
      queryKey: [...weightLogQueries.all(), 'series', params] as const,
      queryFn: async () => unwrap(await api['weight-log'].series.get({ query: params })),
    }),
}

export function useCreateWeightLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { date: string; weight_kg: number }) =>
      api['weight-log'].post(body).then(unwrap),
    onSuccess: () => void qc.invalidateQueries({ queryKey: weightLogQueries.all() }),
  })
}

export function useDeleteWeightLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api['weight-log']({ id: String(id) })
        .delete()
        .then(unwrap),
    onSuccess: () => void qc.invalidateQueries({ queryKey: weightLogQueries.all() }),
  })
}
