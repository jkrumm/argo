import { MutationCache, QueryCache } from '@tanstack/react-query'
import { createBasaltRouter } from 'basalt-ui'
import { clearToken, isUnauthorizedError, safeRedirect } from './auth'
import { routeTree } from '../routeTree.gen'

const onUnauthorized = (error: unknown): void => {
  if (!isUnauthorizedError(error)) return
  clearToken()
  // `router` is assigned below; the handler only runs after a request fails, long after module init.
  const { pathname, href } = router.state.location
  if (pathname === '/login') return
  void router.navigate({ to: '/login', search: { redirect: safeRedirect(href) } })
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
