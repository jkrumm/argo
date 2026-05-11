import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'

export const exerciseQueries = {
  all: () => ['exercises'] as const,
  list: () =>
    queryOptions({
      queryKey: [...exerciseQueries.all(), 'list'] as const,
      queryFn: async () => {
        const { data, error } = await api.exercises.get()
        if (error) throw error
        return data
      },
    }),
}
