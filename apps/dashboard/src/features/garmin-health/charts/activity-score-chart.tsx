import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, type BarsBar } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import { toChartFact } from '../chart-facts'
import { RefetchDim } from '../refetch-dim'
import { ACTIVITY_TARGET_SCORE, activityScoreFact, dayLabel, fmtNum, mean } from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { shotState } from '../../../lib/shot-state'
import { localDay } from './local-day'

const CHART_HEIGHT = 280

type ActivityPoint = {
  day: Date
  date: string
  vigorousMin: number | null
  moderateMin: number | null
  steps: number | null
  /** MET-min; `null` on a day with no reading at all, so it is a gap rather than a zero-height bar. */
  score: number | null
}

/** One measure in one neutral series — the three-way intensity split carried no decision. */
const BARS: BarsBar<ActivityPoint>[] = [
  {
    key: 'score',
    label: 'Activity score',
    color: VX.line2,
    getValue: (d) => d.score,
    formatValue: (v) => `${Math.round(v)} MET-min`,
  },
]

export default function ActivityScoreChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))
  // `basalt-ui shot`'s `empty` state renders the chart's own empty branch.
  const data = shotState() === 'empty' ? undefined : query.data

  const chartData = useMemo<ActivityPoint[]>(
    () =>
      applyVisibilityFilter(data?.points ?? [], (p) => p.date).map((p) => ({
        day: localDay(p.date),
        date: p.date,
        vigorousMin: p.vigorousIntensityMin,
        moderateMin: p.moderateIntensityMin,
        steps: p.steps,
        score: p.activityScore,
      })),
    [data],
  )

  const hasData = chartData.some((d) => d.score !== null)
  const measured = chartData.filter((d) => d.score !== null)
  // The final visible row, so a null last day reads "—" instead of borrowing an older day's score.
  const fact = activityScoreFact({
    when: dayLabel(chartData.at(-1)?.date),
    score: chartData.at(-1)?.score ?? null,
    mean: mean(chartData.map((d) => d.score)),
    dayCount: measured.length,
  })

  return (
    <ChartCard
      title="Daily activity"
      info={METRIC_TOOLTIPS.activityScore}
      state={chartStateOf(query, !hasData ? 'No activity in this window' : undefined)}
      placeholderHeight={CHART_HEIGHT}
      facts={toChartFact(fact)}
    >
      <RefetchDim active={query.isPlaceholderData}>
        <Bars
          ariaLabel={`Daily activity score in MET-minutes against the ${ACTIVITY_TARGET_SCORE} target`}
          cursorResolution="leading"
          data={chartData}
          height={CHART_HEIGHT}
          x={(d) => d.day}
          bars={BARS}
          refLines={[{ value: ACTIVITY_TARGET_SCORE, color: VX.muted, dashed: true }]}
          y={{ autoMaxFloor: ACTIVITY_TARGET_SCORE, ticks: 5 }}
          tooltip={{
            rows: (d) => [
              { label: 'Vigorous', value: `${fmtNum(d.vigorousMin)} min`, color: VX.muted },
              { label: 'Moderate', value: `${fmtNum(d.moderateMin)} min`, color: VX.muted },
              {
                label: 'Steps',
                value: d.steps === null ? '—' : d.steps.toLocaleString(),
                color: VX.muted,
              },
            ],
          }}
        />
      </RefetchDim>
    </ChartCard>
  )
}
