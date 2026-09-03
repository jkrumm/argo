import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  Bars,
  ChartCard,
  TooltipRow,
  VX,
  type BarsBar,
  type BarsLine,
  type CartesianTooltipRowContext,
} from 'basalt-ui/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { SERIES } from '../../../lib/series'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'

/**
 * Daily activity target in MET-minutes — matches the WHO weekly floor at 86/day,
 * rounded to 600 to align with the server-side aggregate target.
 */
const ACTIVITY_TARGET_SCORE = 600

/** MET multipliers — must mirror server-side `garmin-formulas.ts`. */
const VIGOROUS_MET = 8
const MODERATE_MET = 4
const STEPS_PER_INTENSITY_MIN = 100
const STEPS_MET_PER_STEP = 0.03

/**
 * Trailing simple moving average. Returns null when fewer than `min` non-null
 * samples are in the window so early days don't render a misleading flat line.
 */
function movingAverage(
  values: (number | null)[],
  window: number,
  min = Math.min(3, window),
): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1)
    let sum = 0
    let count = 0
    for (let j = start; j <= i; j++) {
      const v = values[j]
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        sum += v
        count += 1
      }
    }
    out.push(count >= min ? sum / count : null)
  }
  return out
}

type ActivityPoint = {
  date: string
  vigorousMin: number | null
  moderateMin: number | null
  steps: number | null
  walkingSteps: number
  walkingScore: number
  moderateScore: number
  vigorousScore: number
  score: number | null
  scoreMA: number | null
}

/**
 * The three bands carry `tooltip: false`: the tooltip reports the underlying minutes and steps
 * (`prependRows`), not the MET-minute values the bars are drawn from — stating both would print
 * every intensity twice.
 */
const POSITIVE_BARS: BarsBar<ActivityPoint>[] = [
  { key: 'walkingScore', label: 'Walking', color: SERIES.intensityWalking, tooltip: false },
  { key: 'moderateScore', label: 'Moderate', color: SERIES.intensityModerate, tooltip: false },
  { key: 'vigorousScore', label: 'Vigorous', color: SERIES.intensityVigorous, tooltip: false },
]

const LINES: BarsLine<ActivityPoint>[] = [
  {
    key: 'scoreMA',
    label: '30d avg',
    color: VX.line2,
    dashed: true,
    strokeWidth: 1.5,
    formatValue: (v) => `${Math.round(v)} · ${Math.round((v / ACTIVITY_TARGET_SCORE) * 100)}%`,
  },
]

function getActivityValue(d: ActivityPoint, key: string): number | null {
  switch (key) {
    case 'walkingScore':
      return d.walkingScore
    case 'moderateScore':
      return d.moderateScore
    case 'vigorousScore':
      return d.vigorousScore
    case 'scoreMA':
      return d.scoreMA
    default:
      return null
  }
}

export default function ActivityScoreChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))

  const chartData = useMemo<ActivityPoint[]>(() => {
    const scores = data.points.map((p) => p.activityScore)
    const ma = movingAverage(scores, 30)
    const all: ActivityPoint[] = data.points.map((p, i) => {
      const vig = p.vigorousIntensityMin ?? 0
      const mod = p.moderateIntensityMin ?? 0
      const steps = p.steps ?? 0
      const walkingSteps = Math.max(0, steps - (vig + mod) * STEPS_PER_INTENSITY_MIN)
      return {
        date: p.date,
        vigorousMin: p.vigorousIntensityMin,
        moderateMin: p.moderateIntensityMin,
        steps: p.steps,
        walkingSteps,
        walkingScore: walkingSteps * STEPS_MET_PER_STEP,
        moderateScore: mod * MODERATE_MET,
        vigorousScore: vig * VIGOROUS_MET,
        score: p.activityScore,
        scoreMA: ma[i] ?? null,
      }
    })
    return applyVisibilityFilter(all, (p) => p.date)
  }, [data])

  const hasData = chartData.some((d) => d.score !== null)

  const latest = chartData[chartData.length - 1]

  return (
    <ChartCard
      title="Daily Activity"
      subtitle="Am I moving enough?"
      info={METRIC_TOOLTIPS.activityScore}
      actions={
        latest?.score !== null && latest?.score !== undefined ? (
          <span style={{ fontSize: VX.text.xs }}>
            <span
              style={{
                fontSize: VX.text.md,
                fontWeight: 600,
                color: latest.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : VX.muted,
              }}
            >
              {Math.round(latest.score)}
            </span>
            <span style={{ opacity: 0.5 }}> MET-min</span>
          </span>
        ) : null
      }
      state={{ empty: !hasData }}
      placeholderHeight={280}
    >
      <Bars
        ariaLabel="Daily activity score by intensity with 30-day average"
        data={chartData}
        height={280}
        chartId="activity-score"
        getX={(d) => d.date}
        getValue={getActivityValue}
        positiveBars={POSITIVE_BARS}
        lines={LINES}
        zones={[{ from: ACTIVITY_TARGET_SCORE, to: Infinity, fill: VX.goodSoft, axisSide: 'left' }]}
        refLines={[{ value: ACTIVITY_TARGET_SCORE, color: VX.goodRef, dashed: true }]}
        // basalt-ui 1.17 clamps autoMaxFloor before padding (not after), so the floor no longer
        // needs its own hand-added headroom above the target ref line — the framework's autoPad
        // (1.1) now supplies it. Keeping the old `* 1.2` here would double-pad to 1.32x the target.
        y={{ autoMaxFloor: ACTIVITY_TARGET_SCORE, ticks: 5 }}
        tooltip={{
          label: (d: ActivityPoint) => {
            if (d.score === null) return null
            const pct = Math.round((d.score / ACTIVITY_TARGET_SCORE) * 100)
            return {
              text: `${Math.round(d.score)} · ${pct}%`,
              color: d.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : VX.muted,
            }
          },
          prependRows: (d: ActivityPoint, ctx: CartesianTooltipRowContext<ActivityPoint>) => (
            <>
              {!ctx.hidden.has('vigorousScore') && (
                <TooltipRow
                  color={SERIES.intensityVigorous}
                  label="Vigorous"
                  value={`${d.vigorousMin ?? 0} min`}
                  shape="bar"
                />
              )}
              {!ctx.hidden.has('moderateScore') && (
                <TooltipRow
                  color={SERIES.intensityModerate}
                  label="Moderate"
                  value={`${d.moderateMin ?? 0} min`}
                  shape="bar"
                />
              )}
              {!ctx.hidden.has('walkingScore') && (
                <TooltipRow
                  color={SERIES.intensityWalking}
                  label="Walking"
                  value={`${d.walkingSteps.toLocaleString()} steps`}
                  shape="bar"
                />
              )}
            </>
          ),
        }}
      />
    </ChartCard>
  )
}
