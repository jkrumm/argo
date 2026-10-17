import { useMemo } from 'react'
import { Box } from '@mantine/core'
import { DeltaBadge } from 'basalt-ui'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { weightLogQueries, type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import { METRIC_TOOLTIPS } from '../constants'
import {
  ageLabel,
  deltaFromMean,
  fixed,
  isStale,
  weightDeltaPolarity,
  windowLabel,
  windowDays,
} from '../model'
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

  const span = windowDays(params)
  const chartData = useMemo(() => toWeightChartPoints(apiPoints ?? [], span), [apiPoints, span])
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
      label: '7 d mean',
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
    const values = chartData.flatMap((d) => (d.ma === null ? [d.weightKg] : [d.weightKg, d.ma]))
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
        {...(summary.current !== null && {
          facts: {
            value: fixed(summary.current),
            unit: 'kg',
            period: `7 d mean ${fixed(stats.mean7)} kg · ${chartData.length} entries`,
            ...(delta !== null && {
              comparison: (
                <DeltaBadge
                  value={delta}
                  polarity={weightDeltaPolarity(summary.current, goal)}
                  format={(v) => `${Math.abs(v).toFixed(1)} kg`}
                  period="30 d mean"
                />
              ),
            }),
          },
          // `ChartCard facts` has no warn tone, so staleness is spelled out as a word.
          ...(ageDays !== null && {
            subtitle: `last entry ${ageLabel(ageDays)}${isStale(ageDays) ? ' · stale' : ''}`,
          }),
        })}
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
