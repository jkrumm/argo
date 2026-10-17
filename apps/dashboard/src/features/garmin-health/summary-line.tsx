import { useQuery } from '@tanstack/react-query'
import { Skeleton, Text } from '@mantine/core'
import {
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { summarySentence } from './model'
import type { SummaryParams } from './types'

/** The page's one-line answer: recovery, load and fitness direction, each with unit and scale. */
export function SummaryLine({ params }: { params: SummaryParams }) {
  const recovery = useQuery(recoveryQueries.summary(params))
  const load = useQuery(trainingLoadQueries.summary(params))
  const fitness = useQuery(fitnessDirectionQueries.summary(params))

  if (recovery.data === undefined || load.data === undefined || fitness.data === undefined) {
    return <Skeleton height={20} width="60%" radius="sm" />
  }

  const acwr = load.data.points.findLast((p) => p.acwr !== null)?.acwr ?? null
  return (
    <Text size="sm" c="dimmed">
      {summarySentence({
        recovery: recovery.data.recovery,
        acwr,
        rhrDelta: fitness.data.rhrDelta,
        hrvDelta: fitness.data.hrvDelta,
      })}
    </Text>
  )
}
