import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export const readingQueries = {
  all: () => ['reading'] as const,
  shelf: () =>
    queryOptions({
      queryKey: [...readingQueries.all(), 'shelf'] as const,
      queryFn: async () => unwrap(await api.reading.get()),
    }),
  unmatched: () =>
    queryOptions({
      queryKey: [...readingQueries.all(), 'unmatched'] as const,
      queryFn: async () => unwrap(await api.reading.unmatched.get()),
    }),
}
