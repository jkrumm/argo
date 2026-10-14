import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { walkingPadQueries } from '../../lib/queries/walking-pad'

// Same key the live card's idle state uses, so this is one shared cache entry, not a new request.
const LAST_WALK = walkingPadQueries.list({ page: 1, limit: 1 })

/** `ended_at` of the newest session; `null` when the list is empty (a fetched fact). */
const selectLastEndedAt = (list: { data: { ended_at: string }[] }): string | null =>
  list.data[0]?.ended_at ?? null

/** Newest session regardless of the window: a string, `null` for none ever, `undefined` while unknown. */
export function useLastWalkEndedAt(): string | null | undefined {
  return useQuery({ ...LAST_WALK, select: selectLastEndedAt }).data
}

export function useLastWalkEndedAtSuspense(): string | null {
  return useSuspenseQuery({ ...LAST_WALK, select: selectLastEndedAt }).data
}
