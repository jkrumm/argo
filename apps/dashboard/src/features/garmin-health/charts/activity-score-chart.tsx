import { useElementSize } from '@mantine/hooks'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Bars, ChartCard, ChartLegend, TooltipRow, useVxTheme, VX } from '@argo/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'

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

const activityGetValue = (d: ActivityPoint, key: string): number | null => {
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
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line2, tooltipMuted } = useVxTheme()
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const chartData = useMemo<ActivityPoint[]>(() => {
    const scores = data.points.map((p) => p.activityScore)
    const ma = movingAverage(scores, 30)
    return data.points.map((p, i) => {
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
  }, [data])

  const latest = chartData[chartData.length - 1]

  return (
    <ChartCard
      title="Daily Activity"
      subtitle="Am I moving enough?"
      tooltip={METRIC_TOOLTIPS.activityScore}
      extra={
        latest?.score !== null && latest?.score !== undefined ? (
          <span style={{ fontSize: 12 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: latest.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : tooltipMuted,
              }}
            >
              {Math.round(latest.score)}
            </span>
            <span style={{ opacity: 0.5 }}> MET-min</span>
          </span>
        ) : null
      }
    >
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {width > 0 && (
          <Bars<ActivityPoint>
            data={chartData}
            width={Math.max(width, 200)}
            height={280}
            chartId="activity-score"
            getX={(d) => d.date}
            getValue={activityGetValue}
            positiveBars={[
              { key: 'walkingScore', label: 'Walking', color: VX.series.intensityWalking },
              { key: 'moderateScore', label: 'Moderate', color: VX.series.intensityModerate },
              { key: 'vigorousScore', label: 'Vigorous', color: VX.series.intensityVigorous },
            ]}
            barLayout="stacked"
            lines={[
              {
                key: 'scoreMA',
                label: '30d avg',
                color: line2,
                axisSide: 'left',
                dashed: true,
                strokeWidth: 1.5,
                formatValue: (v) =>
                  `${Math.round(v)} · ${Math.round((v / ACTIVITY_TARGET_SCORE) * 100)}%`,
              },
            ]}
            zones={[
              { from: ACTIVITY_TARGET_SCORE, to: Infinity, fill: VX.goodSoft, axisSide: 'left' },
            ]}
            refLines={[
              {
                value: ACTIVITY_TARGET_SCORE,
                color: VX.goodRef,
                dashed: true,
                axisSide: 'left',
              },
            ]}
            leftAxis={{
              domain: 'auto',
              autoMaxFloor: ACTIVITY_TARGET_SCORE * 1.2,
              numTicks: 5,
            }}
            tooltipLabel={(d) => {
              if (d.score === null) return null
              const pct = Math.round((d.score / ACTIVITY_TARGET_SCORE) * 100)
              return {
                text: `${Math.round(d.score)} · ${pct}%`,
                color: d.score >= ACTIVITY_TARGET_SCORE ? VX.goodSolid : tooltipMuted,
              }
            }}
            hideBarTooltipRows
            renderPrefixTooltipRows={(d) => (
              <>
                <TooltipRow
                  color={VX.series.intensityVigorous}
                  label="Vigorous"
                  value={`${d.vigorousMin ?? 0} min`}
                  shape="bar"
                />
                <TooltipRow
                  color={VX.series.intensityModerate}
                  label="Moderate"
                  value={`${d.moderateMin ?? 0} min`}
                  shape="bar"
                />
                <TooltipRow
                  color={VX.series.intensityWalking}
                  label="Walking"
                  value={`${d.walkingSteps.toLocaleString()} steps`}
                  shape="bar"
                />
                {d.scoreMA !== null && (
                  <TooltipRow
                    color={line2}
                    label="30d avg"
                    value={`${Math.round(d.scoreMA)} · ${Math.round(
                      (d.scoreMA / ACTIVITY_TARGET_SCORE) * 100,
                    )}%`}
                    shape="line"
                    strokeWidth={1.5}
                    dashed
                  />
                )}
              </>
            )}
            highlightedKey={highlighted}
          />
        )}
      </div>
      <ChartLegend
        items={[
          {
            key: 'walkingScore',
            label: 'Walking',
            color: VX.series.intensityWalking,
            shape: 'bar',
          },
          {
            key: 'moderateScore',
            label: 'Moderate',
            color: VX.series.intensityModerate,
            shape: 'bar',
          },
          {
            key: 'vigorousScore',
            label: 'Vigorous',
            color: VX.series.intensityVigorous,
            shape: 'bar',
          },
          {
            key: 'scoreMA',
            label: '30d avg',
            color: line2,
            strokeWidth: 1.5,
            dashed: true,
          },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
