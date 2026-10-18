import { useQuery } from '@tanstack/react-query'
import { PageSummary } from '../../components/upstream/page-summary'
import { useNow } from '../../lib/use-now'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { walkingStore } from '../../lib/window-stores'
import { emptyWindowParts, priorLabel, windowQualifier, summaryParts, weekSummary } from './model'
import { weekDaysSeries } from './week-queries'

/** The page's headline and facts; every figure is the one its strip cell shows. */
export function SummaryLine({
  params,
  empty,
}: {
  params: WalkingPadWindowParams
  /** The window holds no walks: the headline names the last walk instead of this week's figures. */
  empty: boolean
}) {
  const now = useNow()
  const { window: preset } = walkingStore.useValues()
  const week = useQuery(weekDaysSeries(now))
  const heroes = useQuery(walkingPadQueries.heroes(params))
  const last = useQuery(walkingPadQueries.list({ page: 1, limit: 1 }))
  if (empty) {
    if (last.isPending) return <PageSummary sentence="" loading />
    return (
      <PageSummary
        {...emptyWindowParts({
          preset,
          // A failed lookup is `undefined` (window only), never "no walks recorded".
          lastEndedAt: last.isError ? undefined : (last.data?.data[0]?.ended_at ?? null),
          nowMs: now,
        })}
      />
    )
  }
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
