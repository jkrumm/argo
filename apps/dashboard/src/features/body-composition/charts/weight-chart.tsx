import { useMemo } from 'react'
import { Box } from '@mantine/core'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, MultiLine, VX, type ChartSeries } from 'basalt-ui/charts'
import { api, unwrap } from '../../../lib/eden'
import { weightLogQueries, type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import { METRIC_TOOLTIPS } from '../constants'
import { ChartEmpty } from './empty'

type ApiPoint = { date: string; weightKg: number }
type ChartPoint = {
  date: string
  weightKg: number
  ma: number | null
}

const CHART_HEIGHT = 240

// Inline user-profile query — single row, used here only.
const userProfileQuery = queryOptions({
  queryKey: ['user-profile'] as const,
  queryFn: async () => unwrap(await api['user-profile'].get()),
})

function daysBetween(a: string, b: string): number {
  const dA = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))
  const dB = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)))
  return Math.round((dA - dB) / 86_400_000)
}

/**
 * Centered 7-day moving average — averages every entry within ±3 days of each
 * entry's date. Sparse-data friendly: a single entry per week still produces a
 * smoothed curve. Mirrors the old body-weight-view.tsx implementation.
 */
function centeredMA(points: ApiPoint[], halfWindowDays = 3): Map<string, number> {
  const out = new Map<string, number>()
  if (points.length === 0) return out
  const sorted = points.toSorted((a, b) => (a.date < b.date ? -1 : 1))
  for (const e of sorted) {
    const window = sorted.filter((x) => {
      const d = daysBetween(x.date, e.date)
      return d >= -halfWindowDays && d <= halfWindowDays
    })
    const sum = window.reduce((acc, x) => acc + x.weightKg, 0)
    out.set(e.date, sum / window.length)
  }
  return out
}

function thirtyDayMA(points: ApiPoint[]): number | null {
  if (points.length === 0) return null
  const last = points[points.length - 1]!
  const lo = -30
  const slice = points.filter((p) => {
    const d = daysBetween(p.date, last.date)
    return d <= 0 && d >= lo
  })
  if (slice.length === 0) return null
  return slice.reduce((acc, p) => acc + p.weightKg, 0) / slice.length
}

const fmtKg = (v: number): string => `${v.toFixed(2)} kg`
const fmtGoalKg = (v: number): string => `${v.toFixed(1)} kg`

export default function WeightChart({ params }: { params: WeightLogWindowParams }) {
  const { data } = useSuspenseQuery(weightLogQueries.series(params))
  const { data: profile } = useQuery(userProfileQuery)

  const apiPoints = data.points as ApiPoint[]
  const goal = profile?.goal_weight_kg ?? null

  const chartData = useMemo<ChartPoint[]>(() => {
    const sorted = apiPoints.toSorted((a, b) => (a.date < b.date ? -1 : 1))
    const ma = centeredMA(sorted)
    return sorted.map((e) => ({
      date: e.date,
      weightKg: e.weightKg,
      ma: ma.get(e.date) ?? null,
    }))
  }, [apiPoints])

  const latest = chartData[chartData.length - 1] ?? null
  const ma30 = useMemo(() => thirtyDayMA(apiPoints), [apiPoints])
  const hasMa = chartData.some((d) => d.ma !== null)
  const dotR = chartData.length > 60 ? 2.5 : chartData.length > 20 ? 3.5 : 4.5

  const headerExtra = latest
    ? (() => {
        const delta = ma30 !== null ? latest.weightKg - ma30 : null
        return (
          <span style={{ fontSize: VX.text.xs }}>
            <span style={{ fontWeight: 600, fontSize: VX.text.md }}>
              {latest.weightKg.toFixed(1)} kg
            </span>
            {delta !== null && (
              <Box
                component="span"
                ml={8}
                style={{
                  color: delta < -0.05 ? VX.goodSolid : delta > 0.05 ? VX.warnSolid : undefined,
                  opacity: Math.abs(delta) < 0.05 ? 0.6 : 1,
                  fontWeight: 600,
                }}
              >
                {delta >= 0 ? '+' : ''}
                {delta.toFixed(2)} kg
              </Box>
            )}
            {delta !== null && (
              <Box component="span" ml={4} style={{ opacity: 0.5 }}>
                vs 30d
              </Box>
            )}
          </span>
        )
      })()
    : null

  const series: ChartSeries<ChartPoint>[] = [
    {
      key: 'weight',
      label: 'Weight',
      color: VX.line,
      mark: 'line',
      strokeWidth: 2.25,
      getValue: (d) => d.weightKg,
      formatValue: fmtKg,
      getMarker: () => ({ color: VX.line, r: dotR }),
    },
  ]
  if (hasMa) {
    series.push({
      key: 'ma',
      label: '7-day avg',
      color: VX.line,
      mark: 'line',
      dash: 'dashed',
      strokeWidth: 1.5,
      role: 'overlay',
      parent: 'weight',
      getValue: (d) => d.ma,
      formatValue: fmtKg,
    })
  }
  if (goal !== null) {
    series.push({
      key: 'goal',
      label: 'Goal',
      color: VX.goodSolid,
      mark: 'line',
      dash: 'dashed',
      role: 'reference',
      getValue: () => goal,
      formatValue: fmtGoalKg,
    })
  }

  // Fixed domain over weight/MA/goal: MultiLine's 'auto' floor is
  // min(safeMin, autoMinCeil) * autoPad, which for a non-zero baseline lands
  // ABOVE the data minimum and clips the low end of the weight line.
  const yDomain = useMemo<[number, number]>(() => {
    const values = chartData.flatMap((d) => (d.ma !== null ? [d.weightKg, d.ma] : [d.weightKg]))
    if (goal !== null) values.push(goal)
    if (values.length === 0) return [0, 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max((max - min) * 0.1, 0.5)
    return [min - pad, max + pad]
  }, [chartData, goal])

  return (
    <ChartCard
      title="Body Weight"
      subtitle="Am I trending toward my goal?"
      info={METRIC_TOOLTIPS.bodyWeight}
      actions={headerExtra}
    >
      {chartData.length === 0 ? (
        <ChartEmpty
          height={CHART_HEIGHT}
          message="No entries yet — log your first weight to start the trend."
        />
      ) : (
        <MultiLine
          ariaLabel="Body weight trend over time"
          data={chartData}
          height={CHART_HEIGHT}
          chartId="body-weight"
          getX={(d) => d.date}
          series={series}
          y={{ domain: yDomain }}
        />
      )}
    </ChartCard>
  )
}
