import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { shotState } from '../../lib/shot-state'
import { usageQueries } from '../../lib/queries/usage'

const useHeadlineQuery = (account: readonly string[] | undefined) =>
  useQuery(usageQueries.headline(account && account.length > 0 ? [...account] : undefined))
type Headline = NonNullable<ReturnType<typeof useHeadlineQuery>['data']>

/**
 * The 30 d headline the summary and the strip both read for the page's account scope (the strip ignores the billing and workspace filters). `basalt-ui shot`'s `empty` state
 * substitutes a window with no ingested usage, so both empty with the charts, as production does
 * when nothing was pushed.
 */
export function useUsageHeadline(
  account?: readonly string[],
): Pick<UseQueryResult<Headline>, 'data' | 'isPending'> {
  const query = useHeadlineQuery(account)
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
