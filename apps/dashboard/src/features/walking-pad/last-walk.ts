import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { walkingPadQueries } from '../../lib/queries/walking-pad'

// Same key the live card's idle state uses, so this is one shared cache entry, not a new request.
const LAST_WALK = walkingPadQueries.list({ page: 1, limit: 1 })

/** `ended_at` of the newest session regardless of the selected window; `undefined` if none/unloaded. */
export function useLastWalkEndedAt(): string | undefined {
  return useQuery(LAST_WALK).data?.data[0]?.ended_at
}

export function useLastWalkEndedAtSuspense(): string | undefined {
  return useSuspenseQuery(LAST_WALK).data.data[0]?.ended_at
}
