import { MutationCache, QueryCache } from '@tanstack/react-query'
import { createBasaltRouter } from 'basalt-ui'
import { clearToken, isUnauthorizedError } from './auth'
import { routeTree } from '../routeTree.gen'

const onUnauthorized = (error: unknown): void => {
  if (isUnauthorizedError(error)) clearToken()
}

/**
 * The app's single router instance. Extracted from `main.tsx` (rather than created inline) so
 * `lib/commands.tsx` can import it and call `router.navigate(...)` imperatively from a command
 * handler — commands run outside the React tree (e.g. from Spotlight), so they have no `useNavigate`
 * hook to call.
 *
 * `createBasaltRouter` owns the QueryClient; argo layers its 401 handling and retry rules over
 * basalt's defaults through `query`.
 */
export const router = createBasaltRouter({
  routeTree,
  query: {
    queryCache: new QueryCache({
      onError: onUnauthorized,
    }),
    mutationCache: new MutationCache({
      onError: onUnauthorized,
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
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
