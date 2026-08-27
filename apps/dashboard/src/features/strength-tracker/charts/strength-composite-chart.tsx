import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Flex } from '@mantine/core'
import {
  CartesianChart,
  ChartCard,
  LinePath,
  TooltipRow,
  VX,
  alpha,
  type ChartSeries,
  curveMonotoneX,
} from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { DEFAULT_EXERCISES, EXERCISES, METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'
import { ChartEmpty } from './empty'

/** Per-card select → a local store field, not `useState` (law C3). Persisted per chart. */
const local = createLocalStore({
  key: 'strength:composite',
  fields: { exercise: field.enum(EXERCISE_KEYS, 'bench_press') },
})

type CompositePoint = {
  date: string
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

// Distinct semantic colors per metric (NOT exercise colors — three metrics
// across one exercise).
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
  if (v < Y_DOMAIN[0]) return Y_DOMAIN[0]
  if (v > Y_DOMAIN[1]) return Y_DOMAIN[1]
  return v
}

// The plotted value is the trailing ZMA; the tooltip reports the raw metric plus
// its own z-score, so those rows are authored rather than derived.
const COMPOSITE_SERIES: ChartSeries<CompositePoint>[] = [
  {
    key: 'velocity',
    label: 'Velocity',
    color: COMPOSITE_COLORS.velocity,
    mark: 'line',
    strokeWidth: STROKE_WIDTH,
    tooltip: false,
    getValue: (d) => clamp(d.velocityZma),
  },
  {
    key: 'tonnage',
    label: 'Tonnage Growth',
    color: COMPOSITE_COLORS.tonnage,
    mark: 'line',
    strokeWidth: STROKE_WIDTH,
    tooltip: false,
    getValue: (d) => clamp(d.tonnageGrowthZma),
  },
  {
    key: 'inol',
    label: 'INOL Quality',
    color: COMPOSITE_COLORS.inol,
    mark: 'line',
    strokeWidth: STROKE_WIDTH,
    tooltip: false,
    getValue: (d) => clamp(d.inolZma),
  },
]

function parseExercises(exercises: string | undefined): string[] {
  if (!exercises) return [...DEFAULT_EXERCISES]
  return exercises
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Hand-authored, not `formatValue`-derived: each row reports the RAW metric and its own unsmoothed
// z-score, which is a different quantity — and a different null-gate — than the plotted (clamped)
// ZMA `getValue` returns. Gated on `ctx.hidden` so a row disappears the moment the legend hides its
// series, instead of naming a line the plot no longer draws.
function tooltipRows(d: CompositePoint, ctx: { hidden: ReadonlySet<string> }) {
  return (
    <>
      {!ctx.hidden.has('velocity') && d.velocityZ !== null && (
        <TooltipRow
          color={COMPOSITE_COLORS.velocity}
          label="Velocity"
          value={`${d.velocityRaw !== null ? `${d.velocityRaw.toFixed(3)}%/d` : '—'} · ${fmtSigma(d.velocityZ)}`}
          shape="line"
          strokeWidth={STROKE_WIDTH}
        />
      )}
      {!ctx.hidden.has('tonnage') && d.tonnageGrowthZ !== null && (
        <TooltipRow
          color={COMPOSITE_COLORS.tonnage}
          label="Tonnage"
          value={`${d.tonnageGrowthRaw !== null ? `×${d.tonnageGrowthRaw.toFixed(2)}` : '—'} · ${fmtSigma(d.tonnageGrowthZ)}`}
          shape="line"
          strokeWidth={STROKE_WIDTH}
        />
      )}
      {!ctx.hidden.has('inol') && d.inolZ !== null && (
        <TooltipRow
          color={COMPOSITE_COLORS.inol}
          label="INOL"
          value={`${d.inolRaw !== null ? d.inolRaw.toFixed(2) : '—'} · ${fmtSigma(d.inolZ)}`}
          shape="line"
          strokeWidth={STROKE_WIDTH}
        />
      )}
    </>
  )
}

export default function StrengthCompositeChart({
  params,
  exerciseId: initialExerciseId,
}: {
  params: StrengthQueryParams
  exerciseId: string
}) {
  // The store's own fallback is a CONSTANT, and this chart's default is COMPUTED by the caller (the
  // strength-direction leader with enough sessions). `readStored()` is what tells the two apart: a
  // field never written is absent from the record, so a first visit still lands on the leader, and
  // a lift the reader picked wins from then on — until it drops out of the active filter.
  const [stored] = local.field.exercise.use()
  const everPicked = local.readStored().exercise !== undefined
  const selected = everPicked ? stored : initialExerciseId

  const compositeParams = {
    exerciseId: selected,
    window: params.window,
    from: params.from,
    to: params.to,
  }
  const { data } = useSuspenseQuery(strengthQueries.composite(compositeParams))

  const points = data.points as CompositePoint[]

  // A point only draws a line where its trailing ZMA is non-null. An exercise
  // with < 3 sessions yields points but zero ZMA, which would render as blank
  // axes — treat that as empty so the user sees why instead of nothing.
  const hasLines = useMemo(
    () =>
      points.some(
        (p) => p.velocityZma !== null || p.tonnageGrowthZma !== null || p.inolZma !== null,
      ),
    [points],
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

  const headerExtra = (
    <Flex display="inline-flex" align="center" gap="xs">
      <span style={{ fontSize: VX.text.xs }}>
        <span style={{ color: COMPOSITE_COLORS.velocity, fontWeight: 600 }}>
          v {latest.v !== null ? fmtSigma(latest.v) : '—'}
        </span>
        <span style={{ opacity: 0.4 }}> · </span>
        <span style={{ color: COMPOSITE_COLORS.tonnage, fontWeight: 600 }}>
          t {latest.t !== null ? fmtSigma(latest.t) : '—'}
        </span>
        <span style={{ opacity: 0.4 }}> · </span>
        <span style={{ color: COMPOSITE_COLORS.inol, fontWeight: 600 }}>
          i {latest.i !== null ? fmtSigma(latest.i) : '—'}
        </span>
      </span>
      <SelectFilter field={local.field.exercise} label="Exercise" options={activeOptions} />
    </Flex>
  )

  return (
    <ChartCard
      title="Strength Composite"
      subtitle="Three signals on one σ axis"
      info={METRIC_TOOLTIPS.strengthComposite}
      actions={headerExtra}
    >
      {hasLines ? (
        <CartesianChart
          data={points}
          chartId="strength-composite"
          getX={(d) => d.date}
          series={COMPOSITE_SERIES}
          y={{ domain: Y_DOMAIN, ticks: 7, format: fmtSigma }}
          zones={[{ from: -1, to: 1, fill: alpha(VX.grid, 0.5) }]}
          refLines={[{ value: 0, color: alpha(VX.axis, 0.6), dashed: true }]}
          tooltip={{ prependRows: tooltipRows }}
          height={280}
          ariaLabel="Strength composite z-scores"
        >
          {({ visible, xScale, yScale, highlighted }) =>
            visible.map((s) => (
              <LinePath<CompositePoint>
                key={s.key}
                data={points.filter((d) => s.getValue(d) !== null)}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(s.getValue(d) ?? 0)}
                stroke={s.color}
                strokeWidth={STROKE_WIDTH}
                strokeOpacity={highlighted === null || highlighted === s.key ? 1 : 0.15}
                curve={curveMonotoneX}
              />
            ))
          }
        </CartesianChart>
      ) : (
        <ChartEmpty
          height={280}
          message={
            points.length === 0
              ? `No composite data for ${exerciseLabel(selected)}`
              : `Not enough sessions for ${exerciseLabel(selected)} yet — needs at least 3`
          }
        />
      )}
    </ChartCard>
  )
}
