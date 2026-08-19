import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { ChartCard, MultiLine, VX, type ChartSeries } from 'basalt-ui/charts'
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

const LINE_WIDTH = 2.5
const MA_LINE_WIDTH = 1.5
const PR_MARKER_R = 6

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

/** Padded envelope over every plotted e1RM and 30d-MA value — `nice: true` on the axis rounds it. */
function yDomain(
  rows: readonly MergedPoint[],
  visible: readonly ChartSeries<MergedPoint>[],
): [number, number] {
  const vals: number[] = []
  for (const pt of rows) {
    for (const s of visible) {
      const v = s.getValue(pt)
      if (v !== null) vals.push(v)
    }
  }
  if (!vals.length) return [0, 200]
  return [Math.min(...vals) * 0.92, Math.max(...vals) * 1.08]
}

export default function OneRmTrendChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.seriesDetailed(params))

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

  const series = useMemo<ChartSeries<MergedPoint>[]>(() => {
    const byExercise = data.byExercise as ApiSeriesByExercise[]
    const out: ChartSeries<MergedPoint>[] = []
    for (const ex of activeExercises) {
      out.push({
        key: ex,
        label: `${exerciseLabel(ex)} ${directionArrow(trendArrow(byExercise, ex))}`,
        color: colorFor(ex),
        mark: 'line',
        strokeWidth: LINE_WIDTH,
        getValue: (d) => d.e1rm[ex] ?? null,
        formatValue: (v, d) => {
          const bs = d.bestSets[ex]
          const setStr = bs ? ` (${bs.weight_kg.toFixed(1)} kg × ${bs.reps})` : ''
          return `${v.toFixed(1)} kg${setStr}`
        },
        getMarker: (d) => (d.prSet.has(ex) ? { r: PR_MARKER_R } : null),
      })
      out.push({
        key: `ma-${ex}`,
        label: '30d MA',
        color: colorFor(ex),
        strokeOpacity: 0.5,
        mark: 'line',
        dash: 'dashed',
        strokeWidth: MA_LINE_WIDTH,
        legend: false,
        tooltip: false,
        parent: ex,
        getValue: (d) => d.ma[ex] ?? null,
      })
    }
    return out
  }, [data.byExercise, activeExercises])

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

  return (
    <ChartCard
      title="Estimated 1RM"
      subtitle="Am I getting stronger?"
      tooltip={METRIC_TOOLTIPS.oneRmTrend}
      extra={headerExtra}
    >
      {!hasAnyPoint ? (
        <ChartEmpty height={280} />
      ) : (
        <MultiLine<MergedPoint>
          data={merged}
          chartId="one-rm-trend"
          getX={(d) => d.date}
          series={series}
          y={{ domain: yDomain, nice: true }}
          height={280}
          ariaLabel="Estimated 1RM trend per exercise"
        />
      )}
    </ChartCard>
  )
}
