import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
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
import { directionArrow, directionColor, exerciseLabel } from '../formulas'
import { ChartEmpty } from './empty'

type BestSet = { weight_kg: number; reps: number; e1rm: number } | null

type MergedPoint = {
  date: string
  e1rm: Record<string, number | null>
  ma: Record<string, number | null>
  bestSets: Record<string, BestSet>
  prSet: Set<string>
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

type ApiSeriesByExercise = {
  exercise_id: string
  exercise_name: string
  points: Array<{
    date: string
    e1rm: number | null
    ma30: number | null
    volume: number
    maxWeight: number
    inol: number | null
    bestSet: BestSet
  }>
}

function buildMergedPoints(
  byExercise: ApiSeriesByExercise[],
  activeExercises: string[],
): MergedPoint[] {
  // Per-exercise running max for PR detection.
  const dateSet = new Set<string>()
  for (const ex of byExercise) {
    if (!activeExercises.includes(ex.exercise_id)) continue
    for (const p of ex.points) dateSet.add(p.date)
  }
  const dates = [...dateSet].sort()

  // Build per-date lookup per exercise.
  const lookup = new Map<string, Map<string, ApiSeriesByExercise['points'][number]>>()
  for (const ex of byExercise) {
    if (!activeExercises.includes(ex.exercise_id)) continue
    const m = new Map<string, ApiSeriesByExercise['points'][number]>()
    for (const p of ex.points) m.set(p.date, p)
    lookup.set(ex.exercise_id, m)
  }

  // Per-exercise running max in chronological order.
  const runningMax: Record<string, number | null> = {}
  for (const ex of activeExercises) runningMax[ex] = null

  return dates.map((date) => {
    const e1rm: Record<string, number | null> = {}
    const ma: Record<string, number | null> = {}
    const bestSets: Record<string, BestSet> = {}
    const prSet = new Set<string>()

    for (const ex of activeExercises) {
      const p = lookup.get(ex)?.get(date) ?? null
      const v = p?.e1rm ?? null
      e1rm[ex] = v
      ma[ex] = p?.ma30 ?? null
      bestSets[ex] = p?.bestSet ?? null

      if (v !== null) {
        const prev = runningMax[ex] ?? null
        if (prev === null || v > prev + 1e-6) {
          prSet.add(ex)
          runningMax[ex] = v
        }
      }
    }

    return { date, e1rm, ma, bestSets, prSet }
  })
}

function trendArrow(
  byExercise: ApiSeriesByExercise[],
  exId: string,
): 'improving' | 'stable' | 'declining' | null {
  const ex = byExercise.find((e) => e.exercise_id === exId)
  if (!ex) return null
  const maVals = ex.points
    .map((p) => p.ma30)
    .filter((v): v is number => v !== null && Number.isFinite(v))
  if (maVals.length < 2) return null
  const last = maVals[maVals.length - 1]!
  const prev = maVals[maVals.length - 2]!
  const diff = last - prev
  if (Math.abs(diff) < 0.25) return 'stable'
  return diff > 0 ? 'improving' : 'declining'
}

function OneRmInner({
  data,
  width,
  height,
  activeExercises,
  highlighted,
}: {
  data: MergedPoint[]
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
    for (const pt of data) {
      for (const ex of activeExercises) {
        const v = pt.e1rm[ex]
        if (v !== null && v !== undefined) vals.push(v)
        const m = pt.ma[ex]
        if (m !== null && m !== undefined) vals.push(m)
      }
    }
    if (!vals.length) return scaleLinear<number>({ domain: [0, 200], range: [yMax, 0] })
    const lo = Math.min(...vals) * 0.92
    const hi = Math.max(...vals) * 1.08
    return scaleLinear<number>({ domain: [lo, hi], range: [yMax, 0], nice: true })
  }, [data, activeExercises, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<MergedPoint>({
      data,
      chartId: 'one-rm-trend',
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

          {/* 30-day MA dashed overlay */}
          {activeExercises.map((ex) => {
            const maValid = data.filter((d) => d.ma[ex] !== null && d.ma[ex] !== undefined)
            if (maValid.length < 2) return null
            return (
              <LinePath<MergedPoint>
                key={`ma-${ex}`}
                data={maValid}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.ma[ex] as number)}
                stroke={colorFor(ex)}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                strokeOpacity={dim(ex) * 0.5}
                curve={curveMonotoneX}
              />
            )
          })}

          {/* Main e1RM lines */}
          {activeExercises.map((ex) => {
            const valid = data.filter((d) => d.e1rm[ex] !== null && d.e1rm[ex] !== undefined)
            if (!valid.length) return null
            return (
              <LinePath<MergedPoint>
                key={`line-${ex}`}
                data={valid}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.e1rm[ex] as number)}
                stroke={colorFor(ex)}
                strokeWidth={2.5}
                strokeOpacity={dim(ex)}
                curve={curveMonotoneX}
              />
            )
          })}

          {/* PR markers (running-max stars rendered as circles with stroke) */}
          {activeExercises.flatMap((ex) =>
            data
              .filter((d) => d.e1rm[ex] !== null && d.e1rm[ex] !== undefined && d.prSet.has(ex))
              .map((d) => (
                <circle
                  key={`pr-${d.date}-${ex}`}
                  cx={xScale(d.date) ?? 0}
                  cy={yScale(d.e1rm[ex] as number)}
                  r={6}
                  fill={colorFor(ex)}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                  fillOpacity={dim(ex)}
                  strokeOpacity={dim(ex)}
                />
              )),
          )}

          {/* Crosshair + hover dots */}
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
                const v = syncedPoint.e1rm[ex]
                if (v === null || v === undefined) return null
                return (
                  <circle
                    key={`hd-${ex}`}
                    cx={xScale(syncedPoint.date) ?? 0}
                    cy={yScale(v)}
                    r={VX.dotR}
                    fill={colorFor(ex)}
                    stroke={VX.dotStroke}
                    strokeWidth={2}
                  />
                )
              })}
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
              {activeExercises.map((ex) => {
                const v = tip.data.e1rm[ex]
                if (v === null || v === undefined) return null
                const bs = tip.data.bestSets[ex]
                const setStr = bs ? ` (${bs.weight_kg.toFixed(1)} kg × ${bs.reps})` : ''
                return (
                  <TooltipRow
                    key={ex}
                    color={colorFor(ex)}
                    label={exerciseLabel(ex)}
                    value={`${v.toFixed(1)} kg${setStr}`}
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

export default function OneRmTrendChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.seriesDetailed(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const activeExercises = useMemo(() => {
    const requested = parseExercises(params.exercises)
    // Keep only exercises that actually have data.
    const haveData = new Set(
      data.byExercise.filter((e) => e.points.length > 0).map((e) => e.exercise_id),
    )
    const filtered = requested.filter((id) => haveData.has(id))
    return filtered.length > 0 ? filtered : requested
  }, [data.byExercise, params.exercises])

  const merged = useMemo(
    () => buildMergedPoints(data.byExercise as ApiSeriesByExercise[], activeExercises),
    [data.byExercise, activeExercises],
  )

  const hasAnyPoint = merged.some((p) =>
    activeExercises.some((ex) => p.e1rm[ex] !== null && p.e1rm[ex] !== undefined),
  )

  // Leader = active exercise with the latest e1RM value (highest most-recent).
  const leader = useMemo(() => {
    let best: { ex: string; latest: number; date: string } | null = null
    for (const ex of activeExercises) {
      for (let i = merged.length - 1; i >= 0; i--) {
        const v = merged[i]?.e1rm[ex]
        if (v !== null && v !== undefined) {
          if (best === null || v > best.latest) {
            best = { ex, latest: v, date: merged[i]!.date }
          }
          break
        }
      }
    }
    return best
  }, [merged, activeExercises])

  const headerExtra = leader
    ? (() => {
        const dir = trendArrow(data.byExercise as ApiSeriesByExercise[], leader.ex)
        const color = directionColor(dir)
        const arrow = directionArrow(dir)
        return (
          <span style={{ fontSize: VX.text.xs }}>
            <span style={{ fontWeight: 600, fontSize: VX.text.md, color: colorFor(leader.ex) }}>
              {leader.latest.toFixed(1)} kg
            </span>
            <Box component="span" ml={6} style={{ opacity: 0.6 }}>
              {exerciseLabel(leader.ex)}
            </Box>
            <Box component="span" ml={8} style={{ color, fontWeight: 600 }}>
              {arrow}
            </Box>
          </span>
        )
      })()
    : null

  const legendItems: LegendEntry[] = activeExercises.map((ex) => {
    const dir = trendArrow(data.byExercise as ApiSeriesByExercise[], ex)
    const arrow = directionArrow(dir)
    return {
      key: ex,
      label: `${exerciseLabel(ex)} ${arrow}`,
      color: colorFor(ex),
      shape: 'line',
      strokeWidth: 2.5,
    }
  })

  return (
    <ChartCard
      title="Estimated 1RM"
      subtitle="Am I getting stronger?"
      tooltip={METRIC_TOOLTIPS.oneRmTrend}
      extra={headerExtra}
    >
      <Box ref={ref} h={280} w="100%">
        {!hasAnyPoint ? (
          <ChartEmpty height={280} />
        ) : width > 0 ? (
          <OneRmInner
            data={merged}
            width={Math.max(width, 200)}
            height={280}
            activeExercises={activeExercises}
            highlighted={highlighted}
          />
        ) : null}
      </Box>
      <ChartLegend items={legendItems} highlighted={highlighted} onHighlight={setHighlighted} />
    </ChartCard>
  )
}
