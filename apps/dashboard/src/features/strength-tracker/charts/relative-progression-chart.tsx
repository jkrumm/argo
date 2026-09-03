import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import {
  alpha,
  CartesianChart,
  ChartCard,
  type ChartSeries,
  curveMonotoneX,
  LinePath,
  VX,
} from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { DEFAULT_EXERCISES, EXERCISE_COLORS, METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'

const HEIGHT = 280

type RelPoint = {
  date: string
  pct: Record<string, number | null>
}

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

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

/** Floors the domain at ±10% so a flat window doesn't amplify to a razor-thin band — `nice: true`
 * on the axis rounds the resulting symmetric bound. */
function pctDomain(
  data: readonly RelPoint[],
  visible: readonly ChartSeries<RelPoint>[],
): [number, number] {
  const vals: number[] = []
  for (const d of data) {
    for (const s of visible) {
      const v = s.getValue(d)
      if (v !== null) vals.push(Math.abs(v))
    }
  }
  if (!vals.length) return [-20, 20]
  const maxAbs = Math.max(10, Math.max(...vals) * 1.15)
  return [-maxAbs, maxAbs]
}

export default function RelativeProgressionChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.relativeProgression(params))

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

  const series = useMemo<ChartSeries<RelPoint>[]>(
    () =>
      activeExercises.map((ex) => ({
        key: ex,
        label: exerciseLabel(ex),
        color: colorFor(ex),
        mark: 'line',
        strokeWidth: 2.5,
        getValue: (d: RelPoint) => d.pct[ex] ?? null,
        formatValue: fmtPct,
      })),
    [activeExercises],
  )

  const headerExtra = leader ? (
    <span style={{ fontSize: VX.text.xs }}>
      <span
        style={{
          fontWeight: 600,
          fontSize: VX.text.md,
          color: leader.pct >= 0 ? VX.goodSolid : VX.badSolid,
        }}
      >
        {leader.pct >= 0 ? '+' : ''}
        {leader.pct.toFixed(1)}%
      </span>
      <Box component="span" ml={6} style={{ opacity: 0.6 }}>
        {exerciseLabel(leader.ex)}
      </Box>
    </span>
  ) : null

  return (
    <ChartCard
      title="Relative Progression"
      subtitle="Which lifts are gaining most?"
      info={METRIC_TOOLTIPS.relativeProgression}
      actions={headerExtra}
      state={{ empty: !hasAny }}
      placeholderHeight={HEIGHT}
    >
      <Box h={HEIGHT} w="100%">
        <CartesianChart
          data={points}
          chartId="relative-progression"
          getX={(d) => d.date}
          series={series}
          y={{ domain: pctDomain, ticks: 5, format: (v) => `${v.toFixed(0)}%`, nice: true }}
          refLines={[{ value: 0, color: alpha(VX.axis, 0.6), dashed: true }]}
          height={HEIGHT}
          ariaLabel="Relative progression per lift, in percent from the window start"
        >
          {({ data: rows, visible, xScale, yScale, highlighted }) =>
            visible.map((s) => {
              const valid = rows.filter((d) => s.getValue(d) !== null)
              return (
                <LinePath<RelPoint>
                  key={s.key}
                  data={valid}
                  x={(d) => xScale(d.date) ?? 0}
                  y={(d) => yScale(s.getValue(d) ?? 0)}
                  stroke={s.color}
                  strokeWidth={2.5}
                  strokeOpacity={highlighted === null || highlighted === s.key ? 1 : 0.15}
                  curve={curveMonotoneX}
                />
              )
            })
          }
        </CartesianChart>
      </Box>
    </ChartCard>
  )
}
