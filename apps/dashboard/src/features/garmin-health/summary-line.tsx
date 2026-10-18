import { useQuery } from '@tanstack/react-query'
import { PageSummary } from 'basalt-ui'
import { recoveryQueries, trainingLoadQueries } from '../../lib/queries/daily-metrics'
import { summaryParts } from './model'
import { RefetchDim } from './refetch-dim'
import type { SummaryParams } from './types'
import { applyVisibilityFilter } from './visibility'

/**
 * The page's opening headline: recovery and the load verdict. A failed query leaves its figure as
 * `—` rather than holding the skeleton; a refetch dims the previous line.
 */
export function SummaryLine({ params }: { params: SummaryParams }) {
  const recovery = useQuery(recoveryQueries.summary(params))
  const load = useQuery(trainingLoadQueries.summary(params))

  if (recovery.isPending || load.isPending) return <PageSummary sentence="" loading />

  const acwr =
    applyVisibilityFilter(load.data?.points ?? [], (p) => p.date).findLast((p) => p.acwr !== null)
      ?.acwr ?? null
  return (
    <RefetchDim active={recovery.isPlaceholderData || load.isPlaceholderData}>
      <PageSummary
        {...summaryParts({
          recovery: recovery.data?.recovery ?? null,
          recoveryDate: recovery.data?.date ?? null,
          recoveryStatus: recovery.status,
          acwr,
        })}
      />
    </RefetchDim>
  )
}
