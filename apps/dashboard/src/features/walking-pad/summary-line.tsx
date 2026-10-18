import { useQuery } from '@tanstack/react-query'
import { PageSummary } from '../../components/upstream/page-summary'
import { useNow } from '../../lib/use-now'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { walkingStore } from '../../lib/window-stores'
import { priorLabel, windowQualifier, summaryParts, weekSummary } from './model'
import { weekDaysSeries } from './week-queries'

/** The page's headline and facts; every figure is the one its strip cell shows. */
export function SummaryLine({ params }: { params: WalkingPadWindowParams }) {
  const now = useNow()
  const { window: preset } = walkingStore.useValues()
  const week = useQuery(weekDaysSeries(now))
  const heroes = useQuery(walkingPadQueries.heroes(params))
  if (week.isPending || heroes.isPending) return <PageSummary sentence="" loading />
  const thisWeek = week.data === undefined ? null : weekSummary(week.data.points, now)
  return (
    <PageSummary
      {...summaryParts({
        weekDistanceM: thisWeek?.distanceM ?? null,
        weekSessions: thisWeek?.sessions ?? null,
        streakDays: heroes.data?.streak.currentDays ?? null,
        paceKmh: heroes.data?.pace.currentAvgKmh ?? null,
        paceDeltaKmh: heroes.data?.pace.deltaKmh ?? null,
        prior: priorLabel(preset),
        period: windowQualifier(preset),
      })}
    />
  )
}
