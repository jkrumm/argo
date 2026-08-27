import { Flex, Stack, Text } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Bars, ChartCard, ChartLegend, deriveLegend, VX, type SeriesStyle } from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { exerciseLabel } from '../formulas'

/** Per-card select → a local store field, not `useState` (law C3). Persisted per chart. */
const local = createLocalStore({
  key: 'strength:weekly-volume',
  fields: { exercise: field.enum(EXERCISE_KEYS, 'bench_press') },
})

type WeeklyVolumePoint = {
  date: string
  warmup: number
  work: number
  drop: number
  amrap: number
  total: number
  ma: number | null
}

/** The volume landmarks (MEV/MAV/MRV) drawn as dashed refLines by the Bars kind. */
const LANDMARK_LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'mev', label: 'MEV', color: VX.goodRef, mark: 'line', dash: 'dashed' },
  { key: 'mav', label: 'MAV', color: VX.warnRef, mark: 'line', dash: 'dashed' },
  { key: 'mrv', label: 'MRV', color: VX.badRef, mark: 'line', dash: 'dashed' },
]

const fmtTonnage = (v: number): string =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}`

const getValue = (d: WeeklyVolumePoint, key: string): number | null => {
  switch (key) {
    case 'warmup':
      return d.warmup > 0 ? d.warmup : null
    case 'work':
      return d.work > 0 ? d.work : null
    case 'drop':
      return d.drop > 0 ? d.drop : null
    case 'amrap':
      return d.amrap > 0 ? d.amrap : null
    case 'ma':
      return d.ma
    default:
      return null
  }
}

const barOpacityFor = (_: WeeklyVolumePoint, key: string): number => {
  if (key === 'warmup') return 0.3
  if (key === 'drop') return 0.6
  if (key === 'amrap') return 0.95
  return 0.9
}

function ChartEmpty({ height = 280, label }: { height?: number; label: string }) {
  return (
    <Stack justify="center" align="center" h={height} gap={4}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Stack>
  )
}

export default function WeeklyVolumeChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.weeklyVolume(params))

  const availableExercises = data.byExercise.map((b) => b.exercise_id)
  const [selectedExercise] = local.field.exercise.use()

  // If the active exercise filter changes and our selection is no longer
  // available, fall back to the first option. Reading during render is fine
  // (React Compiler will keep it stable when inputs don't change).
  const effectiveSelected: string = availableExercises.includes(selectedExercise)
    ? selectedExercise
    : (availableExercises[0] ?? selectedExercise)

  const selectedBlock = data.byExercise.find((b) => b.exercise_id === effectiveSelected) ?? null
  const points = (selectedBlock?.points ?? []) as WeeklyVolumePoint[]
  const landmarks = selectedBlock?.landmarks ?? { mev: 0, mav: 0, mrv: 0 }
  const exColor = EXERCISE_COLORS[effectiveSelected as ExerciseKey] ?? SERIES.benchPress

  const hasData = points.some((p) => p.total > 0)
  const latest = points[points.length - 1]
  const exLabel = exerciseLabel(effectiveSelected)

  const selectorNode =
    availableExercises.length > 1 ? (
      <SelectFilter
        field={local.field.exercise}
        label="Exercise"
        options={availableExercises.map((ex) => ({ value: ex, label: exerciseLabel(ex) }))}
      />
    ) : null

  return (
    <ChartCard
      title="Weekly Volume"
      subtitle="Is my training load sustainable?"
      info={METRIC_TOOLTIPS.weeklyVolume}
      actions={
        <Flex display="inline-flex" align="center" gap="xs">
          {hasData && latest && latest.total > 0 ? (
            <span style={{ fontSize: VX.text.xs, color: exColor, fontWeight: 600 }}>
              {fmtTonnage(latest.total)} this week
            </span>
          ) : null}
          {selectorNode}
        </Flex>
      }
    >
      {!hasData ? (
        <ChartEmpty height={280} label={`No volume data for ${exLabel}`} />
      ) : (
        <Bars
          ariaLabel={`Weekly volume for ${exLabel}`}
          data={points}
          height={280}
          chartId="weekly-volume"
          getX={(d) => d.date}
          cursorResolution="leading"
          getValue={getValue}
          positiveBars={[
            { key: 'warmup', label: 'Warm-up', color: exColor },
            { key: 'work', label: 'Work', color: exColor },
            { key: 'drop', label: 'Drop', color: exColor },
            { key: 'amrap', label: 'AMRAP', color: VX.warnSolid },
          ]}
          barLayout="stacked"
          barOpacity={barOpacityFor}
          lines={[
            {
              key: 'ma',
              label: '4w MA',
              color: VX.line2,
              dashed: true,
              strokeWidth: 1.5,
              formatValue: fmtTonnage,
            },
          ]}
          refLines={[
            { value: landmarks.mev, color: VX.goodRef, dashed: true },
            { value: landmarks.mav, color: VX.warnRef, dashed: true },
            { value: landmarks.mrv, color: VX.badRef, dashed: true },
          ]}
          y={{ domain: 'auto', format: fmtTonnage, ticks: 5 }}
        />
      )}
      {/* MEV/MAV/MRV are refLines, not part of the bar/line series — Bars' derived legend can't
       * express them. The kind keeps its own interactive legend for bars + MA; this supplementary
       * static row only carries the landmark chips, styled to match the dashed refLines. */}
      <ChartLegend items={deriveLegend(LANDMARK_LEGEND_SERIES)} />
    </ChartCard>
  )
}
