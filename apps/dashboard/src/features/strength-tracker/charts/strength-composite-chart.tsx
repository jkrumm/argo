import { useMemo } from 'react'
import { Group, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries, type ChartTooltipRow } from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { alpha, VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { localDay } from '../../garmin-health/charts/local-day'
import { EXERCISES, METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'
import { parseExercises } from './exercise-helpers'

/**
 * Per-card select → a local store field, not `useState` (law C3). Persisted per chart.
 *
 * The default is not a constant: it is the strength-direction leader with enough sessions to draw a
 * trend, computed by `CompositeChartSlot` and handed down as `exerciseId`. The store is therefore
 * built per leader (same persistence key, so a pick is shared and survives a reload) with the
 * leader as the fallback: until the user picks, the field follows the leader; the first pick wins.
 */
function createExerciseStore(fallback: (typeof EXERCISE_KEYS)[number]) {
  return createLocalStore({
    key: 'strength:composite',
    fields: { exercise: field.enum(EXERCISE_KEYS, fallback) },
  })
}

const HEIGHT = 280

type CompositePoint = {
  day: Date
  velocityRaw: number | null
  tonnageGrowthRaw: number | null
  inolRaw: number | null
  velocityZ: number | null
  tonnageGrowthZ: number | null
  inolZ: number | null
  velocityZma: number | null
  tonnageGrowthZma: number | null
  inolZma: number | null
}

// Distinct semantic colors per metric (NOT exercise colors — three metrics across one exercise).
const COMPOSITE_COLORS = {
  velocity: SERIES.hrv,
  tonnage: SERIES.calories,
  inol: SERIES.acwr,
} as const

const Y_DOMAIN: [number, number] = [-3, 3]
const STROKE_WIDTH = 2.5

function fmtSigma(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`
}

function clamp(v: number | null): number | null {
  if (v === null) return null
  return Math.min(Y_DOMAIN[1], Math.max(Y_DOMAIN[0], v))
}

// The plotted value is the clamped trailing ZMA; the tooltip reports the raw metric plus its own
// unsmoothed z-score, so those rows are authored (`tooltip: false` here) instead of derived.
const COMPOSITE_SERIES: ChartSeries<CompositePoint>[] = [
  {
    key: 'velocity',
    label: 'Velocity',
    color: COMPOSITE_COLORS.velocity,
    strokeWidth: STROKE_WIDTH,
    tooltip: false,
    getValue: (d) => clamp(d.velocityZma),
  },
  {
    key: 'tonnage',
    label: 'Tonnage Growth',
    color: COMPOSITE_COLORS.tonnage,
    strokeWidth: STROKE_WIDTH,
    tooltip: false,
    getValue: (d) => clamp(d.tonnageGrowthZma),
  },
  {
    key: 'inol',
    label: 'INOL Quality',
    color: COMPOSITE_COLORS.inol,
    strokeWidth: STROKE_WIDTH,
    tooltip: false,
    getValue: (d) => clamp(d.inolZma),
  },
]

/** Gated on `ctx.visible` so a row disappears the moment the legend hides its series. */
function tooltipRows(
  d: CompositePoint,
  ctx: { visible: readonly ChartSeries<CompositePoint>[] },
): ChartTooltipRow[] {
  const shown = (key: string) => ctx.visible.some((s) => s.key === key)
  const rows: ChartTooltipRow[] = []
  if (shown('velocity') && d.velocityZ !== null) {
    rows.push({
      label: 'Velocity',
      color: COMPOSITE_COLORS.velocity,
      value: `${d.velocityRaw !== null ? `${d.velocityRaw.toFixed(3)}%/d` : '—'} · ${fmtSigma(d.velocityZ)}`,
    })
  }
  if (shown('tonnage') && d.tonnageGrowthZ !== null) {
    rows.push({
      label: 'Tonnage',
      color: COMPOSITE_COLORS.tonnage,
      value: `${d.tonnageGrowthRaw !== null ? `×${d.tonnageGrowthRaw.toFixed(2)}` : '—'} · ${fmtSigma(d.tonnageGrowthZ)}`,
    })
  }
  if (shown('inol') && d.inolZ !== null) {
    rows.push({
      label: 'INOL',
      color: COMPOSITE_COLORS.inol,
      value: `${d.inolRaw !== null ? d.inolRaw.toFixed(2) : '—'} · ${fmtSigma(d.inolZ)}`,
    })
  }
  return rows
}

export default function StrengthCompositeChart({
  params,
  exerciseId,
}: {
  params: StrengthQueryParams
  exerciseId: (typeof EXERCISE_KEYS)[number]
}) {
  const local = useMemo(() => createExerciseStore(exerciseId), [exerciseId])
  const [selected] = local.field.exercise.use()

  const query = useQuery(
    strengthQueries.composite({
      exerciseId: selected,
      window: params.window,
      from: params.from,
      to: params.to,
    }),
  )

  const points = useMemo<CompositePoint[]>(
    () => (query.data?.points ?? []).map((p) => ({ ...p, day: localDay(p.date) })),
    [query.data],
  )

  // A point only draws a line where its trailing ZMA is non-null. An exercise with < 3 sessions
  // yields points but zero ZMA, which would render as blank axes — say why instead.
  const hasLines = points.some(
    (p) => p.velocityZma !== null || p.tonnageGrowthZma !== null || p.inolZma !== null,
  )

  const activeOptions = useMemo(() => {
    const active = parseExercises(params.exercises)
    return EXERCISES.filter((e) => active.includes(e.value))
  }, [params.exercises])

  // Latest non-null z-score per metric for the header.
  const latest = useMemo(() => {
    let v: number | null = null
    let t: number | null = null
    let i: number | null = null
    for (let idx = points.length - 1; idx >= 0; idx--) {
      const p = points[idx]!
      if (v === null && p.velocityZ !== null) v = p.velocityZ
      if (t === null && p.tonnageGrowthZ !== null) t = p.tonnageGrowthZ
      if (i === null && p.inolZ !== null) i = p.inolZ
      if (v !== null && t !== null && i !== null) break
    }
    return { v, t, i }
  }, [points])

  const sigma = (v: number | null) => (v !== null ? fmtSigma(v) : '—')

  return (
    <ChartCard
      title="Strength Composite"
      subtitle="Three signals on one σ axis"
      info={METRIC_TOOLTIPS.strengthComposite}
      actions={
        <Group gap="xs" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            <Text span fw={600} size="xs" c={COMPOSITE_COLORS.velocity}>
              v {sigma(latest.v)}
            </Text>
            <Text span fw={600} size="xs" c={COMPOSITE_COLORS.tonnage}>
              t {sigma(latest.t)}
            </Text>
            <Text span fw={600} size="xs" c={COMPOSITE_COLORS.inol}>
              i {sigma(latest.i)}
            </Text>
          </Group>
          <SelectFilter field={local.field.exercise} label="Exercise" options={activeOptions} />
        </Group>
      }
      state={chartStateOf(
        query,
        !hasLines &&
          (points.length === 0
            ? `No composite data for ${exerciseLabel(selected)}`
            : `Not enough sessions for ${exerciseLabel(selected)} yet — needs at least 3`),
      )}
      placeholderHeight={HEIGHT}
    >
      <Lines
        ariaLabel="Strength composite z-scores"
        data={points}
        height={HEIGHT}
        x={(d) => d.day}
        series={COMPOSITE_SERIES}
        y={{ domain: Y_DOMAIN, ticks: 7, format: fmtSigma }}
        zones={[{ from: -1, to: 1, fill: alpha(VX.grid, 0.5) }]}
        refLines={[{ value: 0, color: alpha(VX.axis, 0.6), dashed: true }]}
        tooltip={{ rows: tooltipRows }}
      />
    </ChartCard>
  )
}
