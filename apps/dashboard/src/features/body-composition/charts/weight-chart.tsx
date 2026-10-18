import { useMemo } from 'react'
import { Box } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { weightLogQueries, type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import { NBSP } from '../../../lib/format'
import { METRIC_TOOLTIPS } from '../constants'
import { weightHeaderFact, windowLabel, windowDays, withKg } from '../model'
import {
  axisDateFormat,
  markerRadiusFor,
  toWeightChartPoints,
  type WeightChartPoint,
} from './series-data'

// 280 px on desktop, 220 px below the regular container class.
const CHART_HEIGHT = { base: 220, regular: 280 }
const PLACEHOLDER_HEIGHT = 280

const fmtKg = (v: number): string => withKg(v, 1)

export default function WeightChart({
  params,
  goal,
}: {
  params: WeightLogWindowParams
  goal: number | null
}) {
  const query = useQuery(weightLogQueries.series(params))
  const apiPoints = query.data?.points

  const span = windowDays(params)
  const chartData = useMemo(() => toWeightChartPoints(apiPoints ?? [], span), [apiPoints, span])
  // The strip and headline carry the current weight and its age; the header adds what they do not.
  const headerFact = useMemo(() => weightHeaderFact(apiPoints ?? []), [apiPoints])
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
      label: `7${NBSP}d${NBSP}mean`,
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
        {...(headerFact !== null && {
          facts: { value: headerFact.value, unit: 'kg', period: headerFact.period },
        })}
        state={{ pending: query.isPending, error: query.isError ? query.error : undefined, empty }}
        placeholderHeight={PLACEHOLDER_HEIGHT}
      >
        <Lines
          ariaLabel="Body weight trend over time"
          data={chartData}
          height={CHART_HEIGHT}
          x={(d) => d.date}
          formatX={axisDateFormat(chartData.map((d) => d.date))}
          series={series}
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
          y={{ domain: yDomain, format: (v) => withKg(v, 0) }}
        />
      </ChartCard>
    </Box>
  )
}
