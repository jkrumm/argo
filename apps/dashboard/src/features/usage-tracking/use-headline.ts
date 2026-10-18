import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { shotState } from '../../lib/shot-state'
import { usageQueries } from '../../lib/queries/usage'
import { noUsageWindow } from './model'

const useHeadlineQuery = () => useQuery(usageQueries.headline())
type Headline = NonNullable<ReturnType<typeof useHeadlineQuery>['data']>

/**
 * The 30 d headline the summary and the strip both read. `basalt-ui shot`'s `empty` state
 * substitutes a window with no ingested usage, so both empty with the charts, as production does
 * when nothing was pushed.
 */
export function useUsageHeadline(): Pick<UseQueryResult<Headline>, 'data' | 'isPending'> {
  const query = useHeadlineQuery()
  if (shotState() !== 'empty' || query.data === undefined) return query
  return {
    isPending: query.isPending,
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
      recordsTotal: 0,
      costUsdPrior30d: 0,
      tokensPrior30d: 0,
      errorRatePrior30d: null,
      p95MsPrior30d: null,
    },
  }
}

/** The wording for an empty window on one chart surface; see `noUsageWindow`. */
export function useNoUsageWindow({
  filtered,
  leading,
}: {
  filtered: boolean
  /** This surface is the first chart card in reading order, so it carries the full sentence. */
  leading: boolean
}): string {
  const { data } = useUsageHeadline()
  return noUsageWindow({ filtered, stripEmpty: data?.calls30d === 0, leading })
}
