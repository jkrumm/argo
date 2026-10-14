import { useMemo } from 'react'
import { Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { userProfileQueries } from '../../../lib/queries/user-profile'
import { weightLogQueries, type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import { METRIC_TOOLTIPS } from '../constants'
import {
  markerRadiusFor,
  thirtyDayMean,
  toWeightChartPoints,
  type WeightChartPoint,
} from './series-data'

const CHART_HEIGHT = 240

// A change inside ±this many kg of the 30-day mean reads as flat.
const FLAT_DELTA_KG = 0.05

function deltaColor(delta: number): string {
  if (delta < -FLAT_DELTA_KG) return VX.goodSolid
  if (delta > FLAT_DELTA_KG) return VX.warnSolid
  return 'inherit'
}

const fmtKg = (v: number): string => `${v.toFixed(2)} kg`
const fmtGoalKg = (v: number): string => `${v.toFixed(1)} kg`

export default function WeightChart({ params }: { params: WeightLogWindowParams }) {
  const query = useQuery(weightLogQueries.series(params))
  const { data: profile } = useQuery(userProfileQueries.detail())

  const apiPoints = query.data?.points
  const goal = profile?.goal_weight_kg ?? null

  const chartData = useMemo(() => toWeightChartPoints(apiPoints ?? []), [apiPoints])
  const latest = chartData[chartData.length - 1] ?? null
  const ma30 = useMemo(() => thirtyDayMean(apiPoints ?? []), [apiPoints])
  const delta = latest !== null && ma30 !== null ? latest.weightKg - ma30 : null
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
  if (goal !== null) {
    series.push({
      key: 'goal',
      label: 'Goal',
      color: VX.goodSolid,
      dash: 'dashed',
      role: 'reference',
      getValue: () => goal,
      formatValue: fmtGoalKg,
    })
  }

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
      ? 'No entries yet — log your first weight to start the trend.'
      : undefined

  return (
    <ChartCard
      title="Body Weight"
      subtitle="Am I trending toward my goal?"
      info={METRIC_TOOLTIPS.bodyWeight}
      actions={
        latest ? (
          <Text span size="xs">
            <Text span size="md" fw={600}>
              {latest.weightKg.toFixed(1)} kg
            </Text>
            {delta !== null && (
              <>
                <Text
                  span
                  ml={8}
                  fw={600}
                  c={deltaColor(delta)}
                  opacity={Math.abs(delta) < FLAT_DELTA_KG ? 0.6 : 1}
                >
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(2)} kg
                </Text>
                <Text span ml={4} opacity={0.5}>
                  vs 30d
                </Text>
              </>
            )}
          </Text>
        ) : null
      }
      state={{ pending: query.isPending, error: query.isError ? query.error : undefined, empty }}
      placeholderHeight={CHART_HEIGHT}
    >
      <Lines
        ariaLabel="Body weight trend over time"
        data={chartData}
        height={CHART_HEIGHT}
        x={(d) => d.date}
        series={series}
        y={{ domain: yDomain, format: (v) => v.toFixed(0) }}
      />
    </ChartCard>
  )
}
