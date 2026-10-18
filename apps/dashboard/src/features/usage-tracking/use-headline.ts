import { useQuery } from '@tanstack/react-query'
import { shotState } from '../../lib/shot-state'
import { usageQueries } from '../../lib/queries/usage'

/**
 * The 30 d headline the summary and the strip both read. `basalt-ui shot`'s `empty` state
 * substitutes a window with no ingested usage, so both empty with the charts, as production does
 * when nothing was pushed.
 */
export function useUsageHeadline() {
  const query = useQuery(usageQueries.headline())
  if (shotState() !== 'empty' || query.data === undefined) return query
  return {
    ...query,
    data: {
      ...query.data,
      costUsd30d: 0,
      costUsd7d: 0,
      costMaxBilling30d: 0,
      costIuBilling30d: 0,
      costOpenrouterBilling30d: 0,
      tokens30d: 0,
      errorRate30d: 0,
      p95Ms30d: null,
      cacheHitRatio30d: null,
      sourcesActive: 0,
      maxTs: null,
      calls30d: 0,
    },
  }
}
