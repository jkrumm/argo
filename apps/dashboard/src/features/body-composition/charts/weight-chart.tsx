import { useMemo } from 'react'
import { Box } from '@mantine/core'
import { DeltaBadge } from 'basalt-ui'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { weightLogQueries, type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import stripClasses from '../components/body-strip.module.css'
import { METRIC_TOOLTIPS } from '../constants'
import { ageLabel, deltaFromMean, fixed, isStale, weightDeltaPolarity, windowLabel } from '../model'
import type { WeightSummary, WeightWindowStats } from '../types'
import {
  localDay,
  markerRadiusFor,
  toWeightChartPoints,
  type WeightChartPoint,
} from './series-data'

// 280 px on desktop, 220 px below the regular container class.
const CHART_HEIGHT = { base: 220, regular: 280 }
const PLACEHOLDER_HEIGHT = 280

const fmtKg = (v: number): string => `${v.toFixed(2)} kg`

export default function WeightChart({
  params,
  summary,
  stats,
  goal,
  ageDays,
  todayKey,
}: {
  params: WeightLogWindowParams
  summary: WeightSummary
  stats: WeightWindowStats
  goal: number | null
  ageDays: number | null
  todayKey: string
}) {
  const query = useQuery(weightLogQueries.series(params))
  const apiPoints = query.data?.points

  const chartData = useMemo(() => toWeightChartPoints(apiPoints ?? []), [apiPoints])
  const delta = deltaFromMean(summary.current, stats.mean30)
  // Drawn to today, so a stale last entry shows as empty plot rather than a line that just stops.
  const first = chartData[0]
  const xDomain: [Date, Date] | null =
    first === undefined || !isStale(ageDays) ? null : [first.date, localDay(todayKey)]
  const dotR = markerRadiusFor(chartData.length)

  const series: ChartSeries<WeightChartPoint>[] = [
    {
      key: 'weight',
      label: 'Weight',
      color: VX.line,
      strokeWidth: 2.25,
      getValue: (d) => d.weightKg,
      formatValue: fmtKg,
      getMarker: () => ({ color: VX.line, r: dotR }),
    },
    {
      key: 'ma',
      label: '7-day avg',
      color: VX.line,
      dash: 'dashed',
      strokeWidth: 1.5,
      role: 'overlay',
      parent: 'weight',
      getValue: (d) => d.ma,
      formatValue: fmtKg,
    },
  ]

  // Fixed domain over weight/MA/goal: 'auto' floors at a zero baseline unless told otherwise, which
  // would flatten a 70–90 kg line against the top of the plot.
  const yDomain = useMemo<[number, number]>(() => {
    const values = chartData.flatMap((d) => [d.weightKg, d.ma])
    if (goal !== null) values.push(goal)
    if (values.length === 0) return [0, 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max((max - min) * 0.1, 0.5)
    return [min - pad, max + pad]
  }, [chartData, goal])

  const empty =
    chartData.length === 0
      ? 'No entries in this window — log a weight to start the trend.'
      : undefined

  return (
    <Box data-shot="weight-chart">
      <ChartCard
        title={`Body weight, ${windowLabel(params)}`}
        info={goal === null ? METRIC_TOOLTIPS.bodyWeight : METRIC_TOOLTIPS.bodyWeightGoal}
        actions={
          summary.current === null ? null : (
            <Box className={stripClasses.facts}>
              <span className={stripClasses.factValue}>{fixed(summary.current)} kg</span>
              {delta !== null && (
                <DeltaBadge
                  value={delta}
                  polarity={weightDeltaPolarity(summary.current, goal)}
                  format={(v) => `${Math.abs(v).toFixed(1)} kg`}
                  period="vs 30 d mean"
                />
              )}
              <span className={stripClasses.factContext}>7 d mean {fixed(stats.mean7)} kg</span>
              <span className={stripClasses.factContext}>{chartData.length} entries</span>
              {ageDays !== null && (
                <span className={isStale(ageDays) ? stripClasses.stale : stripClasses.factContext}>
                  last entry {ageLabel(ageDays)}
                </span>
              )}
            </Box>
          )
        }
        state={{ pending: query.isPending, error: query.isError ? query.error : undefined, empty }}
        placeholderHeight={PLACEHOLDER_HEIGHT}
      >
        <Lines
          ariaLabel="Body weight trend over time"
          data={chartData}
          height={CHART_HEIGHT}
          x={(d) => d.date}
          series={series}
          tooltip={{ formatHeader: (x) => format(x, 'EEE d MMM yyyy') }}
          {...(xDomain !== null && { xDomain })}
          {...(goal !== null && {
            refLines: [
              {
                value: goal,
                color: VX.muted,
                dashed: false,
                legend: { label: `goal ${goal.toFixed(1)}` },
              },
            ],
          })}
          y={{ domain: yDomain, format: (v) => `${v.toFixed(0)} kg` }}
        />
      </ChartCard>
    </Box>
  )
}
