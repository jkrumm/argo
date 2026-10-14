import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Group, Text } from '@mantine/core'
import { Bars, ChartCard, type BarsBar, type BarsLine } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { SERIES } from '../../../lib/series'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from './chart-state'
import { latestWith } from './latest'
import { localDay } from './local-day'
import { movingAverage } from './moving-average'

/**
 * Daily activity target in MET-minutes — matches the WHO weekly floor at 86/day,
 * rounded to 600 to align with the server-side aggregate target.
 */
const ACTIVITY_TARGET_SCORE = 600
const CHART_HEIGHT = 280

/** MET multipliers — must mirror server-side `garmin-formulas.ts`. */
const VIGOROUS_MET = 8
const MODERATE_MET = 4
const STEPS_PER_INTENSITY_MIN = 100
const STEPS_MET_PER_STEP = 0.03

type ActivityPoint = {
  day: Date
  vigorousMin: number | null
  moderateMin: number | null
  walkingSteps: number
  /** `null` on a day with no reading at all, so it is a gap rather than a zero-height bar. */
  walkingScore: number | null
  moderateScore: number | null
  vigorousScore: number | null
  score: number | null
  scoreMA: number | null
}

/**
 * The three bands carry `tooltip: false`: the tooltip reports the underlying minutes and steps
 * (`rows`), not the MET-minute values the bars are drawn from — stating both would print every
 * intensity twice.
 */
const BARS: BarsBar<ActivityPoint>[] = [
  {
    key: 'walkingScore',
    label: 'Walking',
    color: SERIES.intensityWalking,
    getValue: (d) => d.walkingScore,
    tooltip: false,
  },
  {
    key: 'moderateScore',
    label: 'Moderate',
    color: SERIES.intensityModerate,
    getValue: (d) => d.moderateScore,
    tooltip: false,
  },
  {
    key: 'vigorousScore',
    label: 'Vigorous',
    color: SERIES.intensityVigorous,
    getValue: (d) => d.vigorousScore,
    tooltip: false,
  },
]

const LINES: BarsLine<ActivityPoint>[] = [
  {
    key: 'scoreMA',
    label: '30d avg',
    color: VX.line2,
    dash: 'dashed',
    strokeWidth: 1.5,
    getValue: (d) => d.scoreMA,
    formatValue: (v) => `${Math.round(v)} · ${Math.round((v / ACTIVITY_TARGET_SCORE) * 100)}%`,
  },
]

export default function ActivityScoreChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))

  const chartData = useMemo<ActivityPoint[]>(() => {
    const points = query.data?.points ?? []
    const scores = points.map((p) => p.activityScore)
    const ma = movingAverage(scores, 30)
    const all = points.map((p, i) => {
      const measured =
        p.steps !== null || p.moderateIntensityMin !== null || p.vigorousIntensityMin !== null
      const vig = p.vigorousIntensityMin ?? 0
      const mod = p.moderateIntensityMin ?? 0
      const steps = p.steps ?? 0
      const walkingSteps = Math.max(0, steps - (vig + mod) * STEPS_PER_INTENSITY_MIN)
      const point: ActivityPoint = {
        day: localDay(p.date),
        vigorousMin: p.vigorousIntensityMin,
        moderateMin: p.moderateIntensityMin,
        walkingSteps,
        walkingScore: measured ? walkingSteps * STEPS_MET_PER_STEP : null,
        moderateScore: measured ? mod * MODERATE_MET : null,
        vigorousScore: measured ? vig * VIGOROUS_MET : null,
        score: p.activityScore,
        scoreMA: ma[i] ?? null,
      }
      return { date: p.date, point }
    })
    return applyVisibilityFilter(all, (p) => p.date).map((p) => p.point)
  }, [query.data])

  const hasData = chartData.some((d) => d.score !== null)

  const latest = latestWith(chartData, (d) => d.score)

  return (
    <ChartCard
      title="Daily Activity"
      subtitle="Am I moving enough?"
      info={METRIC_TOOLTIPS.activityScore}
      actions={
        latest?.score !== null && latest?.score !== undefined ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text
              span
              fw={600}
              size="md"
              c={latest.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : 'dimmed'}
            >
              {Math.round(latest.score)}
            </Text>
            <Text span size="xs" c="dimmed">
              MET-min
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(query, !hasData && 'No activity in this window')}
      placeholderHeight={CHART_HEIGHT}
    >
      <Bars
        ariaLabel="Daily activity score by intensity with 30-day average"
        data={chartData}
        height={CHART_HEIGHT}
        cursorResolution="leading"
        x={(d) => d.day}
        bars={BARS}
        lines={LINES}
        zones={[{ from: ACTIVITY_TARGET_SCORE, to: Infinity, fill: VX.goodSoft, axisSide: 'left' }]}
        refLines={[{ value: ACTIVITY_TARGET_SCORE, color: VX.goodRef, dashed: true }]}
        y={{ autoMaxFloor: ACTIVITY_TARGET_SCORE, ticks: 5 }}
        tooltip={{
          rows: (d, ctx) => {
            const hidden = new Set(ctx.hidden.map((s) => s.key))
            const rows = []
            if (d.score !== null) {
              const pct = Math.round((d.score / ACTIVITY_TARGET_SCORE) * 100)
              rows.push({
                label: 'Score',
                value: `${Math.round(d.score)} · ${pct}%`,
                color: d.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : VX.muted,
              })
            }
            if (!hidden.has('vigorousScore'))
              rows.push({
                label: 'Vigorous',
                value: `${d.vigorousMin ?? 0} min`,
                color: SERIES.intensityVigorous,
              })
            if (!hidden.has('moderateScore'))
              rows.push({
                label: 'Moderate',
                value: `${d.moderateMin ?? 0} min`,
                color: SERIES.intensityModerate,
              })
            if (!hidden.has('walkingScore'))
              rows.push({
                label: 'Walking',
                value: `${d.walkingSteps.toLocaleString()} steps`,
                color: SERIES.intensityWalking,
              })
            return rows
          },
        }}
      />
    </ChartCard>
  )
}
