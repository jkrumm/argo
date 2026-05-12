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
  score: number | null
  scoreMA: number | null
}

const activityGetValue = (d: ActivityPoint, key: string): number | null => {
  switch (key) {
    case 'score':
      return d.score
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
    return data.points.map((p, i) => ({
      date: p.date,
      score: p.activityScore,
      scoreMA: ma[i] ?? null,
    }))
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
            positiveBars={[{ key: 'score', label: 'Activity', color: VX.series.intensityMin }]}
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
                  color={VX.series.intensityMin}
                  label="Activity"
                  value={d.score === null ? '–' : `${Math.round(d.score)} MET-min`}
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
          { key: 'score', label: 'Activity', color: VX.series.intensityMin, shape: 'bar' },
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
