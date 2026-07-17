import { createRouter } from '@tanstack/react-router'
import { queryClient } from './query-client'
import { routeTree } from '../routeTree.gen'

/**
 * The app's single router instance. Extracted from `main.tsx` (rather than created inline) so
 * `lib/commands.tsx` can import it and call `router.navigate(...)` imperatively from a command
 * handler — commands run outside the React tree (e.g. from Spotlight), so they have no `useNavigate`
 * hook to call.
 */
export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
