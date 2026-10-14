import { queryOptions } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../eden'

export const userProfileQueries = {
  all: () => ['user-profile'] as const,
  detail: () =>
    queryOptions({
      queryKey: userProfileQueries.all(),
      queryFn: async () => unwrap(await api['user-profile'].get()),
    }),
}
