import { useQuery } from '@tanstack/react-query'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { toLastWalk, type LastWalk } from './model'

/** The newest walk ever recorded, whatever the window: one read for the headline and the empty state. */
export function useLastWalk(): LastWalk {
  const query = useQuery(walkingPadQueries.list({ page: 1, limit: 1 }))
  return toLastWalk({
    isPending: query.isPending,
    isError: query.isError,
    endedAt: query.data?.data[0]?.ended_at,
  })
}
