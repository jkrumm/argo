import { useQuery } from '@tanstack/react-query'
import { Skeleton, Text } from '@mantine/core'
import { useNow } from '../../lib/use-now'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { walkingStore } from '../../lib/window-stores'
import { priorLabel, windowQualifier, summarySentence, weekSummary } from './model'
import { THIS_WEEK_SERIES } from './week-queries'

/** The page's one-line answer; every figure is the one its strip cell shows. */
export function SummaryLine({ params }: { params: WalkingPadWindowParams }) {
  const now = useNow()
  const { window: preset } = walkingStore.useValues()
  const week = useQuery(THIS_WEEK_SERIES)
  const heroes = useQuery(walkingPadQueries.heroes(params))
  if (week.isPending || heroes.isPending) return <Skeleton height={20} width="60%" radius="sm" />
  const thisWeek = week.data === undefined ? null : weekSummary(week.data.points, now)
  return (
    <Text size="sm" c="dimmed" data-shot="summary">
      {summarySentence({
        weekDistanceM: thisWeek?.distanceM ?? null,
        weekSessions: thisWeek?.sessions ?? null,
        streakDays: heroes.data?.streak.currentDays ?? 0,
        paceKmh: heroes.data?.pace.currentAvgKmh ?? null,
        paceDeltaKmh: heroes.data?.pace.deltaKmh ?? null,
        prior: priorLabel(preset),
        period: windowQualifier(preset),
      })}
    </Text>
  )
}
