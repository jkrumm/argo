import { useQuery } from '@tanstack/react-query'
import { Skeleton, Text } from '@mantine/core'
import {
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { FITNESS_DAYS, lastDaysRange, summarySentence } from './model'
import { RefetchDim } from './refetch-dim'
import type { SummaryParams } from './types'
import { applyVisibilityFilter } from './visibility'

/**
 * The page's one-line answer: recovery, load and fitness direction, each with unit and scale. A failed
 * query leaves its figure as `—` rather than holding the skeleton; a refetch dims the previous line.
 */
export function SummaryLine({ params }: { params: SummaryParams }) {
  const recovery = useQuery(recoveryQueries.summary(params))
  const load = useQuery(trainingLoadQueries.summary(params))
  // The deltas are "over 14 d", so they come from a fixed 14-day window, not the page selector.
  const fitness = useQuery(fitnessDirectionQueries.summary(lastDaysRange(FITNESS_DAYS)))

  if (recovery.isPending || load.isPending || fitness.isPending) {
    return <Skeleton height={20} width="60%" radius="sm" />
  }

  const acwr =
    applyVisibilityFilter(load.data?.points ?? [], (p) => p.date).findLast((p) => p.acwr !== null)
      ?.acwr ?? null
  return (
    <RefetchDim active={recovery.isPlaceholderData || load.isPlaceholderData}>
      <Text size="sm" c="dimmed">
        {summarySentence({
          recovery: recovery.data?.recovery ?? null,
          acwr,
          rhrDelta: fitness.data?.rhrDelta ?? null,
          hrvDelta: fitness.data?.hrvDelta ?? null,
        })}
      </Text>
    </RefetchDim>
  )
}
