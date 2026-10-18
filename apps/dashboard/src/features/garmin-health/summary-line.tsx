import { useQuery } from '@tanstack/react-query'
import { PageSummary } from '../../components/upstream/page-summary'
import {
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { fitnessRange, summaryParts } from './model'
import { RefetchDim } from './refetch-dim'
import type { SummaryParams } from './types'
import { applyVisibilityFilter } from './visibility'

/**
 * The page's opening headline: recovery and the load verdict, with ACWR and the fitness deltas as
 * facts. A failed query leaves its figure as `—` rather than holding the skeleton; a refetch dims
 * the previous line.
 */
export function SummaryLine({ params }: { params: SummaryParams }) {
  const recovery = useQuery(recoveryQueries.summary(params))
  const load = useQuery(trainingLoadQueries.summary(params))
  // The deltas are "over 14 d", so they come from a fixed 14-day window, not the page selector.
  const fitness = useQuery(fitnessDirectionQueries.summary(fitnessRange()))

  if (recovery.isPending || load.isPending || fitness.isPending)
    return <PageSummary sentence="" loading />

  const acwr =
    applyVisibilityFilter(load.data?.points ?? [], (p) => p.date).findLast((p) => p.acwr !== null)
      ?.acwr ?? null
  return (
    <RefetchDim active={recovery.isPlaceholderData || load.isPlaceholderData}>
      <PageSummary
        {...summaryParts({
          recovery: recovery.data?.recovery ?? null,
          recoveryDate: recovery.data?.date ?? null,
          acwr,
          rhrDelta: fitness.data?.rhrDelta ?? null,
          hrvDelta: fitness.data?.hrvDelta ?? null,
        })}
      />
    </RefetchDim>
  )
}
