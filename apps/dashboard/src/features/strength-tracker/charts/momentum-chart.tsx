import { useMemo } from 'react'
import { Group, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, DualPanel, type DualPanelLine } from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { localDay } from '../../garmin-health/charts/local-day'
import { METRIC_TOOLTIPS } from '../constants'
import { directionArrow, directionColor, exerciseLabel } from '../formulas'
import { exerciseColor } from './exercise-helpers'
import { withUnit } from '../../../lib/format'
import { DELTA_DAYS, fmtMonthly, perMonthRaw } from '../model'
import { directionFromVelocity, rollingVelocityPctPerDay } from './momentum-data'

/** A per-chart select is store state like any filter (law C3) — a LOCAL store, because which lift
 * this one card plots is not worth a query param. Persisted, so it survives a reload. */
const local = createLocalStore({
  key: 'strength:momentum',
  fields: { exercise: field.enum(EXERCISE_KEYS, 'bench_press') },
})

const HEIGHT = 360
/** Top pane share of the inner plot: the lower pane keeps room for a −, 0 and + tick apart. */
const TOP_FRACTION = 0.62
/** Zero-noise floor, in %/mo, so a flat velocity plateau doesn't amplify the bottom pane to full height. */
const BOTTOM_MAX_ABS_FLOOR = 3

type MomentumPoint = {
  day: Date
  e1rm: number | null
  e1rmMA: number | null
  velocity: number | null
}

const fmtE1rm = (v: number) => `${v.toFixed(1)} kg`
const fmtTop = (v: number) => `${Math.round(v)} kg`
/** The bars read in the page's one velocity unit, `%/mo`, like the header beside them. */
const fmtVelocity = (v: number, unit: string) => `${fmtMonthly(v)}${unit}`

export default function MomentumChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.seriesDetailed(params))
  const [selectedExercise] = local.field.exercise.use()

  // Render-time guard: the stored lift may not be in this window's data at all.
  const activeExercise =
    query.data?.byExercise.find((e) => e.exercise_id === selectedExercise) ??
    query.data?.byExercise[0]

  const chartData = useMemo<MomentumPoint[]>(() => {
    if (!activeExercise) return []
    const base = activeExercise.points.map((p) => ({ day: localDay(p.date), e1rm: p.e1rm }))
    const velocity = rollingVelocityPctPerDay(base, 28)
    return activeExercise.points.map((p, i) => ({
      day: base[i]!.day,
      e1rm: p.e1rm,
      e1rmMA: p.ma30,
      velocity: velocity[i] ?? null,
    }))
  }, [activeExercise])

  const hasData = chartData.filter((d) => d.e1rm !== null && !Number.isNaN(d.e1rm)).length >= 2

  // Colour follows the lift actually plotted — the stored pick may not be in this window's data.
  const lineColor = exerciseColor(activeExercise?.exercise_id ?? selectedExercise)

  const series: DualPanelLine<MomentumPoint>[] = [
    {
      key: 'e1rm',
      label: 'e1RM',
      color: lineColor,
      strokeOpacity: 0.5,
      strokeWidth: 1.5,
      getValue: (d) => d.e1rm,
      formatValue: fmtE1rm,
      getMarker: (d) =>
        d.e1rm === null ? null : { r: 2.5, color: lineColor, ring: false, fillOpacity: 0.7 },
    },
    {
      key: 'ma30',
      label: '30 d average',
      color: lineColor,
      strokeWidth: 2.25,
      dash: 'dashed',
      getValue: (d) => d.e1rmMA,
      formatValue: fmtE1rm,
    },
  ]

  const latestVel = [...chartData].reverse().find((d) => d.velocity !== null)?.velocity ?? null
  const dir = directionFromVelocity(latestVel)
  const monthly = latestVel === null ? null : perMonthRaw(latestVel)

  const selectOptions = (query.data?.byExercise ?? []).map((e) => ({
    value: e.exercise_id,
    label: exerciseLabel(e.exercise_id),
  }))

  return (
    <ChartCard
      title="Momentum"
      info={METRIC_TOOLTIPS.momentum}
      actions={
        <Group gap="xs" wrap="nowrap">
          {monthly !== null ? (
            <Group gap={4} align="baseline" wrap="nowrap">
              <Text span fw={600} size="md" c={directionColor(dir)}>
                {fmtMonthly(monthly)}
              </Text>
              <Text span size="xs" c="dimmed">
                %/mo, {withUnit(DELTA_DAYS, 'd')} velocity
              </Text>
              <Text span fw={600} size="xs" c={directionColor(dir)}>
                {directionArrow(dir)}
              </Text>
            </Group>
          ) : null}
          {selectOptions.length > 1 && (
            <SelectFilter field={local.field.exercise} label="Exercise" options={selectOptions} />
          )}
        </Group>
      }
      state={chartStateOf(query, !hasData ? 'Need at least 2 sessions per exercise' : undefined)}
      placeholderHeight={HEIGHT}
    >
      <DualPanel
        ariaLabel="Estimated 1RM trend with its trailing regression, over a velocity histogram of percent change per month"
        data={chartData}
        height={HEIGHT}
        x={(d) => d.day}
        series={series}
        topFraction={TOP_FRACTION}
        top={{ format: fmtTop }}
        bar={{
          label: 'Velocity',
          getValue: (d) => (d.velocity === null ? null : perMonthRaw(d.velocity)),
          positive: VX.goodSolid,
          negative: VX.badSolid,
          format: (v) => fmtVelocity(v, '%'),
          tooltipFormat: (v) => fmtVelocity(v, ' %/mo'),
          maxAbsFloor: BOTTOM_MAX_ABS_FLOOR,
        }}
      />
    </ChartCard>
  )
}
