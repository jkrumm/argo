import { Box, Button, Paper, Stack } from '@mantine/core'
import { StatGroup, type StatStripCell, PageSummary } from 'basalt-ui'
import { useSuspenseQuery } from '@tanstack/react-query'
import { overlays } from 'basalt-ui/commands'
import { skinfoldLogQueries, type SkinfoldWindowParams } from '../../../lib/queries/skinfold-log'
import { userProfileQueries } from '../../../lib/queries/user-profile'
import { weightLogQueries, type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import { shotState } from '../../../lib/shot-state'
import { useNow } from '../../../lib/use-now'
import SkinfoldChart from '../charts/skinfold-chart'
import WeightChart from '../charts/weight-chart'
import {
  dayKey,
  entryAgeDays,
  latestDate,
  NO_WEIGHT_POINTS,
  NO_WEIGHT_SUMMARY,
  rateDays,
  siteRows,
  summaryParts,
  weightWindowStats,
  windowDays,
} from '../model'
import { compareByDate, type SkinfoldPoint } from '../charts/series-data'
import type { SkinfoldSummary, WeightSummary } from '../types'

import classes from './body-composition.module.css'
import { SkinfoldHistoryTable } from './skinfold-history-table'
import { rateCell, skinfoldCell, weightCell } from './strip-cells'

type Params = WeightLogWindowParams & SkinfoldWindowParams

export function BodyCompositionPage({ params }: { params: Params }) {
  const now = useNow()
  const { data: weight, status: weightStatus } = useSuspenseQuery(weightLogQueries.summary(params))
  const { data: weightSeries } = useSuspenseQuery(weightLogQueries.series(params))
  const { data: skinfold } = useSuspenseQuery(skinfoldLogQueries.summary(params))
  const { data: skinfoldSeries } = useSuspenseQuery(skinfoldLogQueries.series(params))
  const { data: profile } = useSuspenseQuery(userProfileQueries.detail())

  const isEmpty = shotState() === 'empty'
  const summary = isEmpty ? NO_WEIGHT_SUMMARY : (weight as WeightSummary)
  const skinfoldSummary = skinfold as SkinfoldSummary
  const weightPoints = isEmpty ? NO_WEIGHT_POINTS : weightSeries.points
  const loggedSessions: SkinfoldPoint[] = skinfoldSeries.points
  const sessions: SkinfoldPoint[] = isEmpty ? [] : loggedSessions

  const goal = profile.goal_weight_kg
  const todayKey = dayKey(now)
  const days = windowDays(params)
  const ageDays = entryAgeDays(weightPoints, todayKey)
  const stats = weightWindowStats(weightPoints, days)
  const startPoint = weightPoints.toSorted(compareByDate)[0] ?? null
  const rows = siteRows(sessions, skinfoldSummary.perSite)
  const headline = summaryParts({
    current: summary.current,
    kgPerWeek: summary.kgPerWeek,
    rateDays: rateDays(days),
    goal,
    ageDays,
    latestKey: latestDate(weightPoints),
    entries: weightPoints.length,
    windowDays: days,
  })
  const cells: StatStripCell[] = [
    weightCell({
      summary,
      stats,
      goal,
      startWeight: startPoint?.weightKg ?? null,
      startDate: startPoint?.date ?? null,
      latestDate: latestDate(weightPoints),
    }),
    rateCell({
      summary,
      rateDays: rateDays(days),
      latestDate: latestDate(weightPoints),
      entries: weightPoints.length,
      status: weightStatus,
    }),
    ...(sessions.length > 0
      ? [skinfoldCell({ summary: skinfoldSummary, rows, latestDate: latestDate(sessions) })]
      : []),
  ]

  return (
    <Stack gap="md">
      <PageSummary sentence={headline.sentence} facts={headline.facts} />

      <StatGroup
        variant="strip"
        label="Body composition at a glance"
        cols={sessions.length > 0 ? 3 : 2}
        cells={cells}
      />

      <WeightChart params={params} goal={goal} />

      {sessions.length >= 2 ? (
        <SkinfoldChart params={params} />
      ) : (
        <Paper>
          <Box className={classes.emptyRow} data-shot="empty-row">
            <span>
              {sessions.length === 0
                ? 'No caliper session in this window — log abdominal and suprailiac to start a baseline.'
                : 'One caliper session in this window — a second session draws the trend.'}
            </span>
            <Button
              variant="default"
              size="compact-sm"
              onClick={() => overlays.open('body-comp:log-skinfold', {})}
            >
              Log skinfold
            </Button>
          </Box>
        </Paper>
      )}

      <SkinfoldHistoryTable />
    </Stack>
  )
}
