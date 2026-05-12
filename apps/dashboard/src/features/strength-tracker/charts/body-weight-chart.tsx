import { useMemo } from 'react'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  curveMonotoneX,
  scaleLinear,
  scalePoint,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
  useVxTheme,
  type LegendEntry,
} from '@argo/charts'
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

const MARGIN = { top: 16, right: 24, bottom: 32, left: 56 }
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
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1))
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

function BodyWeightInner({
  data,
  width,
  height,
  goal,
}: {
  data: ChartPoint[]
  width: number
  height: number
  goal: number | null
}) {
  const { line } = useVxTheme()
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.4 }),
    [data, xMax],
  )

  const yScale = useMemo(() => {
    const vals: number[] = []
    for (const pt of data) {
      vals.push(pt.weightKg)
      if (pt.ma !== null) vals.push(pt.ma)
    }
    if (goal !== null) vals.push(goal)
    if (vals.length === 0) return scaleLinear<number>({ domain: [0, 100], range: [yMax, 0] })
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.2, 0.5)
    return scaleLinear<number>({ domain: [min - pad, max + pad], range: [yMax, 0], nice: true })
  }, [data, goal, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<ChartPoint>({
      data,
      chartId: 'body-weight',
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const dotR = data.length > 60 ? 2.5 : data.length > 20 ? 3.5 : 4.5

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {goal !== null && (
            <line
              x1={0}
              x2={xMax}
              y1={yScale(goal)}
              y2={yScale(goal)}
              stroke={VX.goodSolid}
              strokeWidth={1.5}
              strokeDasharray="6 6"
              strokeOpacity={0.55}
            />
          )}

          {/* 7-day centered MA */}
          {data.some((d) => d.ma !== null) && (
            <LinePath<ChartPoint>
              data={data.filter((d) => d.ma !== null)}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScale(d.ma as number)}
              stroke={line}
              strokeWidth={1.5}
              strokeDasharray="5 5"
              strokeOpacity={0.55}
              curve={curveMonotoneX}
            />
          )}

          {/* Raw weight line */}
          <LinePath<ChartPoint>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.weightKg)}
            stroke={line}
            strokeWidth={2.25}
            curve={curveMonotoneX}
          />

          {/* Dot per entry */}
          {data.map((d) => (
            <circle
              key={`dot-${d.date}`}
              cx={xScale(d.date) ?? 0}
              cy={yScale(d.weightKg)}
              r={dotR}
              fill={line}
              stroke={VX.dotStroke}
              strokeWidth={1.5}
            />
          ))}

          {syncedPoint !== null && (
            <>
              <line
                x1={xScale(syncedPoint.date) ?? 0}
                x2={xScale(syncedPoint.date) ?? 0}
                y1={0}
                y2={yMax}
                stroke={VX.crosshair}
                strokeWidth={1}
              />
              <circle
                cx={xScale(syncedPoint.date) ?? 0}
                cy={yScale(syncedPoint.weightKg)}
                r={VX.dotR}
                fill={line}
                stroke={VX.dotStroke}
                strokeWidth={2}
              />
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={5} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              <TooltipRow
                color={line}
                label="Weight"
                value={`${tip.data.weightKg.toFixed(2)} kg`}
                shape="line"
                strokeWidth={2.25}
              />
              {tip.data.ma !== null && (
                <TooltipRow
                  color={line}
                  label="7-day avg"
                  value={`${tip.data.ma.toFixed(2)} kg`}
                  shape="line"
                  strokeWidth={1.5}
                />
              )}
              {goal !== null && (
                <TooltipRow
                  color={VX.goodSolid}
                  label="Goal"
                  value={`${goal.toFixed(1)} kg`}
                  shape="line"
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export default function BodyWeightChart({ params }: { params: WeightLogWindowParams }) {
  const { data } = useSuspenseQuery(weightLogQueries.series(params))
  const { data: profile } = useQuery(userProfileQuery)
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line } = useVxTheme()

  const apiPoints = data.points as ApiPoint[]
  const goal = profile?.goal_weight_kg ?? null

  const chartData = useMemo<ChartPoint[]>(() => {
    const sorted = [...apiPoints].sort((a, b) => (a.date < b.date ? -1 : 1))
    const ma = centeredMA(sorted)
    return sorted.map((e) => ({
      date: e.date,
      weightKg: e.weightKg,
      ma: ma.get(e.date) ?? null,
    }))
  }, [apiPoints])

  const latest = chartData[chartData.length - 1] ?? null
  const ma30 = useMemo(() => thirtyDayMA(apiPoints), [apiPoints])

  const headerExtra = latest
    ? (() => {
        const delta = ma30 !== null ? latest.weightKg - ma30 : null
        return (
          <span style={{ fontSize: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{latest.weightKg.toFixed(1)} kg</span>
            {delta !== null && (
              <span
                style={{
                  marginLeft: 8,
                  color: delta < -0.05 ? VX.goodSolid : delta > 0.05 ? VX.warnSolid : undefined,
                  opacity: Math.abs(delta) < 0.05 ? 0.6 : 1,
                  fontWeight: 600,
                }}
              >
                {delta >= 0 ? '+' : ''}
                {delta.toFixed(2)} kg
              </span>
            )}
            {delta !== null && <span style={{ marginLeft: 4, opacity: 0.5 }}>vs 30d</span>}
          </span>
        )
      })()
    : null

  const legendItems: LegendEntry[] = [
    { key: 'weight', label: 'Weight', color: line, strokeWidth: 2.25, shape: 'line' },
  ]
  if (chartData.some((d) => d.ma !== null)) {
    legendItems.push({
      key: 'ma',
      label: '7-day avg',
      color: line,
      strokeWidth: 1.5,
      shape: 'line',
      dashed: true,
    })
  }
  if (goal !== null) {
    legendItems.push({
      key: 'goal',
      label: 'Goal',
      color: VX.goodSolid,
      strokeWidth: 1.5,
      shape: 'line',
      dashed: true,
    })
  }

  return (
    <ChartCard
      title="Body Weight"
      subtitle="Am I trending toward my goal?"
      tooltip={METRIC_TOOLTIPS.bodyWeight}
      extra={headerExtra}
    >
      <div ref={ref} style={{ height: CHART_HEIGHT, width: '100%' }}>
        {chartData.length === 0 ? (
          <ChartEmpty
            height={CHART_HEIGHT}
            message="No entries yet — log your first weight to start the trend."
          />
        ) : width > 0 ? (
          <BodyWeightInner
            data={chartData}
            width={Math.max(width, 200)}
            height={CHART_HEIGHT}
            goal={goal}
          />
        ) : null}
      </div>
      <ChartLegend items={legendItems} highlighted={null} onHighlight={() => {}} />
    </ChartCard>
  )
}
