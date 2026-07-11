import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
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
  type LegendEntry,
} from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { DEFAULT_EXERCISES, EXERCISE_COLORS, METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'
import { ChartEmpty } from './empty'

type RelPoint = {
  date: string
  pct: Record<string, number | null>
}

const MARGIN = { top: 16, right: 24, bottom: 32, left: 56 }

function colorFor(exId: string): string {
  return EXERCISE_COLORS[exId as keyof typeof EXERCISE_COLORS] ?? SERIES.benchPress
}

function parseExercises(exercises: string | undefined): string[] {
  if (!exercises) return [...DEFAULT_EXERCISES]
  return exercises
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function RelativeProgressionInner({
  data,
  width,
  height,
  activeExercises,
  highlighted,
}: {
  data: RelPoint[]
  width: number
  height: number
  activeExercises: string[]
  highlighted: string | null
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const dim = (key: string): number => {
    if (highlighted === null || highlighted === key) return 1
    if (!activeExercises.includes(highlighted)) return 1
    return 0.15
  }

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }),
    [data, xMax],
  )

  const yScale = useMemo(() => {
    const vals: number[] = []
    for (const d of data) {
      for (const ex of activeExercises) {
        const v = d.pct[ex]
        if (v !== null && v !== undefined) vals.push(v)
      }
    }
    if (!vals.length) return scaleLinear<number>({ domain: [-20, 20], range: [yMax, 0] })
    const maxAbs = Math.max(10, Math.max(...vals.map(Math.abs)) * 1.15)
    return scaleLinear<number>({ domain: [-maxAbs, maxAbs], range: [yMax, 0], nice: true })
  }, [data, yMax, activeExercises])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<RelPoint>({
      data,
      chartId: 'relative-progression',
      getKey: (d) => d.date,
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

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Zero baseline */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke={VX.axis}
            strokeWidth={1}
            strokeDasharray="2 4"
            strokeOpacity={0.6}
          />

          {activeExercises.map((ex) => {
            const valid = data.filter((d) => {
              const v = d.pct[ex]
              return v !== null && v !== undefined
            })
            if (valid.length < 1) return null
            return (
              <LinePath<RelPoint>
                key={ex}
                data={valid}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.pct[ex] as number)}
                stroke={colorFor(ex)}
                strokeWidth={2.5}
                strokeOpacity={dim(ex)}
                curve={curveMonotoneX}
              />
            )
          })}

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
              {activeExercises.map((ex) => {
                const v = syncedPoint.pct[ex]
                if (v === null || v === undefined) return null
                return (
                  <circle
                    key={ex}
                    cx={xScale(syncedPoint.date) ?? 0}
                    cy={yScale(v)}
                    r={4}
                    fill={colorFor(ex)}
                    stroke={VX.dotStroke}
                    strokeWidth={2}
                  />
                )
              })}
            </>
          )}

          <AxisLeftNumeric
            scale={yScale}
            numTicks={5}
            tickFormat={(v) => `${Number(v).toFixed(0)}%`}
          />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {activeExercises.map((ex) => {
                const v = tip.data.pct[ex]
                if (v === null || v === undefined) return null
                return (
                  <TooltipRow
                    key={ex}
                    color={colorFor(ex)}
                    label={exerciseLabel(ex)}
                    value={`${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                    shape="line"
                    strokeWidth={2.5}
                  />
                )
              })}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export default function RelativeProgressionChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.relativeProgression(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const activeExercises = useMemo(() => parseExercises(params.exercises), [params.exercises])

  const points = useMemo<RelPoint[]>(
    () =>
      data.points.map((p) => ({
        date: p.date,
        pct: p.pct as Record<string, number | null>,
      })),
    [data.points],
  )

  const hasAny = useMemo(
    () =>
      points.some((p) =>
        activeExercises.some((ex) => {
          const v = p.pct[ex]
          return v !== null && v !== undefined
        }),
      ),
    [points, activeExercises],
  )

  // Header extra: leader % at latest date among active exercises.
  const leader = useMemo<{ ex: string; pct: number } | null>(() => {
    let best: { ex: string; pct: number } | null = null
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i]!
      for (const ex of activeExercises) {
        const v = p.pct[ex]
        if (v !== null && v !== undefined) {
          if (best === null || v > best.pct) best = { ex, pct: v }
        }
      }
      if (best !== null) break
    }
    return best
  }, [points, activeExercises])

  const headerExtra = leader ? (
    <span style={{ fontSize: 12 }}>
      <span
        style={{
          fontWeight: 600,
          fontSize: 14,
          color: leader.pct >= 0 ? VX.goodSolid : VX.badSolid,
        }}
      >
        {leader.pct >= 0 ? '+' : ''}
        {leader.pct.toFixed(1)}%
      </span>
      <span style={{ marginLeft: 6, opacity: 0.6 }}>{exerciseLabel(leader.ex)}</span>
    </span>
  ) : null

  const legendItems: LegendEntry[] = activeExercises.map((ex) => ({
    key: ex,
    label: exerciseLabel(ex),
    color: colorFor(ex),
    shape: 'line',
    strokeWidth: 2.5,
  }))

  return (
    <ChartCard
      title="Relative Progression"
      subtitle="Which lifts are gaining most?"
      tooltip={METRIC_TOOLTIPS.relativeProgression}
      extra={headerExtra}
    >
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {!hasAny ? (
          <ChartEmpty height={280} />
        ) : width > 0 ? (
          <RelativeProgressionInner
            data={points}
            width={Math.max(width, 200)}
            height={280}
            activeExercises={activeExercises}
            highlighted={highlighted}
          />
        ) : null}
      </div>
      <ChartLegend items={legendItems} highlighted={highlighted} onHighlight={setHighlighted} />
    </ChartCard>
  )
}
