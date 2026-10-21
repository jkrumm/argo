import { useMemo } from 'react'
import { Group, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, type BarsBar, type BarsLine } from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { localDay } from '../../garmin-health/charts/local-day'
import { dayLabel, fmtTonnes } from '../model'
import { METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'
import { exerciseColor } from './exercise-helpers'
import { drawnSeries } from './volume-series'

/** Per-card select → a local store field, not `useState` (law C3). Persisted per chart. */
const local = createLocalStore({
  key: 'strength:weekly-volume',
  fields: { exercise: field.enum(EXERCISE_KEYS, 'bench_press') },
})

const HEIGHT = 280

type WeeklyVolumePoint = {
  week: Date
  iso: string
  warmup: number
  work: number
  drop: number
  amrap: number
  total: number
  ma: number | null
}

const positive = (v: number): number | null => (v > 0 ? v : null)

const barOpacityFor = (_: WeeklyVolumePoint, key: string): number => {
  if (key === 'warmup') return 0.55
  if (key === 'drop') return 0.55
  if (key === 'amrap') return 0.95
  return 0.9
}

export default function WeeklyVolumeChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.weeklyVolume(params))
  const byExercise = query.data?.byExercise

  const availableExercises = (byExercise ?? []).map((b) => b.exercise_id)
  const [selectedExercise] = local.field.exercise.use()

  // The stored lift may not be in this window's data: fall back to the first option.
  const effectiveSelected: string = availableExercises.includes(selectedExercise)
    ? selectedExercise
    : (availableExercises[0] ?? selectedExercise)

  const selectedBlock = byExercise?.find((b) => b.exercise_id === effectiveSelected) ?? null
  const landmarks = selectedBlock?.landmarks ?? null
  const exColor = exerciseColor(effectiveSelected)

  const points = useMemo<WeeklyVolumePoint[]>(
    () =>
      (selectedBlock?.points ?? []).map((p) => ({
        week: localDay(p.date),
        iso: p.date,
        warmup: p.warmup,
        work: p.work,
        drop: p.drop,
        amrap: p.amrap,
        total: p.total,
        ma: p.ma,
      })),
    [selectedBlock],
  )

  const allBars: BarsBar<WeeklyVolumePoint>[] = [
    { key: 'warmup', label: 'Warm-up', color: VX.neutral, getValue: (d) => positive(d.warmup) },
    { key: 'work', label: 'Work', color: exColor, getValue: (d) => positive(d.work) },
    { key: 'drop', label: 'Drop', color: exColor, getValue: (d) => positive(d.drop) },
    { key: 'amrap', label: 'AMRAP', color: VX.warnSolid, getValue: (d) => positive(d.amrap) },
  ]

  const bars = drawnSeries(allBars, points)

  const lines: BarsLine<WeeklyVolumePoint>[] = [
    {
      key: 'ma',
      label: '4 wk average',
      color: VX.line2,
      dash: 'dashed',
      strokeWidth: 1.5,
      role: 'overlay',
      getValue: (d) => d.ma,
      formatValue: fmtTonnes,
    },
  ]

  const hasData = points.some((p) => p.total > 0)
  const latest = points.at(-1)
  const exLabel = exerciseLabel(effectiveSelected)

  return (
    <ChartCard
      title="Weekly volume"
      info={METRIC_TOOLTIPS.weeklyVolume}
      actions={
        <Group gap="xs" wrap="nowrap">
          {hasData && latest && latest.total > 0 ? (
            <Text span size="xs" c="dimmed">
              {fmtTonnes(latest.total)} week of {dayLabel(latest.iso)}
            </Text>
          ) : null}
          {availableExercises.length > 1 ? (
            <SelectFilter
              field={local.field.exercise}
              label="Exercise"
              options={availableExercises.map((ex) => ({ value: ex, label: exerciseLabel(ex) }))}
            />
          ) : null}
        </Group>
      }
      state={chartStateOf(query, !hasData ? `No volume data for ${exLabel}` : undefined)}
      placeholderHeight={HEIGHT}
    >
      <Bars
        ariaLabel={`Weekly volume for ${exLabel}`}
        data={points}
        height={HEIGHT}
        x={(d) => d.week}
        cursorResolution="leading"
        bars={bars}
        layout="stacked"
        barOpacity={barOpacityFor}
        lines={lines}
        refLines={
          landmarks
            ? [
                { value: landmarks.mev, color: VX.goodRef, dashed: true, legend: { label: 'MEV' } },
                {
                  value: landmarks.mav,
                  color: VX.warnRef,
                  dashed: true,
                  legend: { label: 'MAV' },
                },
                { value: landmarks.mrv, color: VX.badRef, dashed: true, legend: { label: 'MRV' } },
              ]
            : []
        }
        y={{ domain: 'auto', format: fmtTonnes, ticks: 5 }}
      />
    </ChartCard>
  )
}
