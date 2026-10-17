import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box, Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { alpha, VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { localDay } from '../../garmin-health/charts/local-day'
import { EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { exerciseLabel, inolDotColor } from '../formulas'
import { pickActiveExercise } from './active-exercise'
import { trailingMA } from './trailing-ma'

/** Per-card select → a local store field, not `useState` (law C3). Persisted per chart. */
const local = createLocalStore({
  key: 'strength:inol',
  fields: { exercise: field.enum(EXERCISE_KEYS, 'bench_press') },
})

const HEIGHT = 280
const MA_WINDOW = 10

type InolPoint = {
  day: Date
  inol: number | null
  ma: number | null
}

function inolZoneLabel(v: number): string {
  if (v < 0.4) return 'Too Light'
  if (v < 0.6) return 'Recovery'
  if (v <= 1.0) return 'Optimal'
  if (v <= 1.5) return 'Hard'
  return 'Excessive'
}

export default function InolChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.seriesDetailed(params))
  const byExercise = query.data?.byExercise
  const [selectedExercise] = local.field.exercise.use()

  const activeExercise = pickActiveExercise(byExercise, selectedExercise)

  const chartData = useMemo<InolPoint[]>(() => {
    if (!activeExercise) return []
    const ma = trailingMA(
      activeExercise.points.map((p) => p.inol),
      MA_WINDOW,
    )
    return activeExercise.points.map((p, i) => ({
      day: localDay(p.date),
      inol: p.inol,
      ma: ma[i] ?? null,
    }))
  }, [activeExercise])

  const latest = chartData.findLast((d) => d.inol !== null)
  const exerciseColor =
    EXERCISE_COLORS[(activeExercise?.exercise_id ?? selectedExercise) as ExerciseKey] ??
    SERIES.benchPress

  const series = useMemo<ChartSeries<InolPoint>[]>(
    () => [
      {
        key: 'session',
        label: 'Session',
        color: exerciseColor,
        // A faint connector; the per-point zone colour rides on the marker.
        strokeWidth: 1.25,
        strokeOpacity: 0.35,
        getValue: (d) => d.inol,
        formatValue: (v) => v.toFixed(2),
        getMarker: (d) => (d.inol === null ? null : { color: inolDotColor(d.inol), r: 4 }),
      },
      {
        key: 'ma',
        label: `${MA_WINDOW}-session MA`,
        color: exerciseColor,
        dash: 'dashed',
        strokeWidth: 2.25,
        getValue: (d) => d.ma,
        formatValue: (v) => v.toFixed(2),
      },
      // Legend-only zone keys: `getValue` is always null, so they draw nothing and own no tooltip row.
      {
        key: 'opt',
        label: 'Optimal (0.6–1.0)',
        color: VX.goodSolid,
        mark: 'bar',
        role: 'reference',
        getValue: () => null,
      },
      {
        key: 'hard',
        label: 'Hard (1.0–1.5)',
        color: SERIES.calories,
        mark: 'bar',
        role: 'reference',
        getValue: () => null,
      },
      {
        key: 'exc',
        label: 'Excessive (>1.5)',
        color: VX.badSolid,
        mark: 'bar',
        role: 'reference',
        getValue: () => null,
      },
    ],
    [exerciseColor],
  )

  const selectOptions = (byExercise ?? []).map((e) => ({
    value: e.exercise_id,
    label: exerciseLabel(e.exercise_id),
  }))

  return (
    <ChartCard
      title="INOL per session"
      info={METRIC_TOOLTIPS.inol}
      actions={
        <Group gap="xs" wrap="nowrap">
          {latest?.inol != null && (
            <Group gap={6} align="baseline" wrap="nowrap">
              <Box component="span" w={8} h={8} bdrs="50%" bg={inolDotColor(latest.inol)} />
              <Text span fw={600} size="md">
                {latest.inol.toFixed(2)}
              </Text>
              <Text span size="xs" c="dimmed">
                {inolZoneLabel(latest.inol)}
              </Text>
            </Group>
          )}
          {selectOptions.length > 1 && (
            <SelectFilter field={local.field.exercise} label="Exercise" options={selectOptions} />
          )}
        </Group>
      }
      state={chartStateOf(query, latest === undefined ? 'No sessions in this window' : undefined)}
      placeholderHeight={HEIGHT}
    >
      <Lines
        cursorResolution="exact"
        ariaLabel={`INOL per session with a ${MA_WINDOW}-session moving average`}
        data={chartData}
        height={HEIGHT}
        x={(d) => d.day}
        series={series}
        // Floors the domain at 2.0 so the 1.5 "Excessive" ref line always has headroom.
        y={{ domain: 'auto', autoMaxFloor: 2, ticks: 5, format: (v) => v.toFixed(1), nice: true }}
        zones={[
          { from: 0, to: 0.4, fill: alpha(VX.status.neutral, 0.06) },
          { from: 0.4, to: 0.6, fill: alpha(VX.status.good, 0.06) },
          { from: 0.6, to: 1.0, fill: alpha(VX.status.excellent, 0.08) },
          { from: 1.0, to: 1.5, fill: alpha(VX.status.warn, 0.08) },
          { from: 1.5, to: Infinity, fill: alpha(VX.status.bad, 0.08) },
        ]}
        refLines={[
          { value: 0.6, color: VX.goodRef, dashed: true },
          { value: 1.0, color: VX.warnRef, dashed: true },
          { value: 1.5, color: VX.badRef, dashed: true },
        ]}
        tooltip={{
          rows: (d) =>
            d.inol === null
              ? []
              : [{ label: 'Zone', value: inolZoneLabel(d.inol), color: inolDotColor(d.inol) }],
        }}
      />
    </ChartCard>
  )
}
