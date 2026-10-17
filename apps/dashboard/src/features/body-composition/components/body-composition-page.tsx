import { Box, Button, Paper, Stack } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { overlays } from 'basalt-ui/commands'
import { skinfoldLogQueries, type SkinfoldWindowParams } from '../../../lib/queries/skinfold-log'
import { userProfileQueries } from '../../../lib/queries/user-profile'
import { weightLogQueries, type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import { useNow } from '../../../lib/use-now'
import SkinfoldChart from '../charts/skinfold-chart'
import WeightChart from '../charts/weight-chart'
import {
  dayKey,
  entryAgeDays,
  latestDate,
  rateDays,
  siteRows,
  summarySentence,
  weightWindowStats,
  windowDays,
} from '../model'
import { compareByDate, type SkinfoldPoint } from '../charts/series-data'
import type { SkinfoldSummary, WeightSummary } from '../types'
import { EmptyRow, Strip } from './body-strip'
import stripClasses from './body-strip.module.css'
import { SkinfoldHistoryTable } from './skinfold-history-table'
import { RateCell, SkinfoldCell, WeightCell } from './strip-cells'

type Params = WeightLogWindowParams & SkinfoldWindowParams

export function BodyCompositionPage({ params }: { params: Params }) {
  const now = useNow()
  const { data: weight } = useSuspenseQuery(weightLogQueries.summary(params))
  const { data: weightSeries } = useSuspenseQuery(weightLogQueries.series(params))
  const { data: skinfold } = useSuspenseQuery(skinfoldLogQueries.summary(params))
  const { data: skinfoldSeries } = useSuspenseQuery(skinfoldLogQueries.series(params))
  const { data: profile } = useSuspenseQuery(userProfileQueries.detail())

  const summary = weight as WeightSummary
  const skinfoldSummary = skinfold as SkinfoldSummary
  const weightPoints = weightSeries.points
  const sessions = skinfoldSeries.points as SkinfoldPoint[]

  const goal = profile.goal_weight_kg
  const todayKey = dayKey(now)
  const ageDays = entryAgeDays(weightPoints, todayKey)
  const stats = weightWindowStats(weightPoints, windowDays(params))
  const startPoint = weightPoints.toSorted(compareByDate)[0] ?? null
  const rows = siteRows(sessions, skinfoldSummary.perSite)
  const hasSkinfold = sessions.length > 0

  return (
    <Stack gap="md">
      <Box component="p" className={stripClasses.summary}>
        {summarySentence({
          current: summary.current,
          kgPerWeek: summary.kgPerWeek,
          rateDays: rateDays(windowDays(params)),
          goal,
          ageDays,
        })}
      </Box>

      <Strip>
        <WeightCell
          summary={summary}
          stats={stats}
          goal={goal}
          startWeight={startPoint?.weightKg ?? null}
          startDate={startPoint?.date ?? null}
          latestDate={latestDate(weightPoints)}
        />
        <RateCell
          summary={summary}
          stats={stats}
          rateDays={rateDays(windowDays(params))}
          latestDate={latestDate(weightPoints)}
        />
        {hasSkinfold && (
          <SkinfoldCell summary={skinfoldSummary} rows={rows} latestDate={latestDate(sessions)} />
        )}
      </Strip>

      <WeightChart
        params={params}
        summary={summary}
        stats={stats}
        goal={goal}
        ageDays={ageDays}
        todayKey={todayKey}
      />

      {sessions.length >= 2 ? (
        <SkinfoldChart params={params} />
      ) : (
        <Paper py="sm" px="md">
          <EmptyRow
            text={
              sessions.length === 0
                ? 'No caliper session in this window — log abdominal and suprailiac to start a baseline.'
                : 'One caliper session in this window — a second session draws the trend.'
            }
            action={
              <Button
                variant="default"
                size="compact-sm"
                onClick={() => overlays.open('body-comp:log-skinfold', {})}
              >
                Log skinfold
              </Button>
            }
          />
        </Paper>
      )}

      <SkinfoldHistoryTable />
    </Stack>
  )
}
