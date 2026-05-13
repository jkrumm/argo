import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { clearToken, isUnauthorizedError } from './auth'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isUnauthorizedError(error)) clearToken()
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isUnauthorizedError(error)) clearToken()
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isUnauthorizedError(error)) return false
        return failureCount < 1
      },
    },
  },
})
