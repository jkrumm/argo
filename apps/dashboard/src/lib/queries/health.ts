import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'

export const healthQueries = {
  all: () => ['health'] as const,
  status: () =>
    queryOptions({
      queryKey: [...healthQueries.all(), 'status'] as const,
      queryFn: async () => {
        const { data, error } = await api.health.get()
        if (error) throw error
        return data
      },
    }),
}
