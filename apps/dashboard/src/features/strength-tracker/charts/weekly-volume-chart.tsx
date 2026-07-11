import { Select, Stack, Text } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Bars, ChartCard, ChartLegend, VX } from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { exerciseLabel } from '../formulas'

type WeeklyVolumePoint = {
  date: string
  warmup: number
  work: number
  drop: number
  amrap: number
  total: number
  ma: number | null
}

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
  const [selectedExercise, setSelectedExercise] = useState<string>(
    () => availableExercises[0] ?? 'bench_press',
  )

  // If the active exercise filter changes and our selection is no longer
  // available, fall back to the first option. Reading during render is fine
  // (React Compiler will keep it stable when inputs don't change).
  const effectiveSelected = availableExercises.includes(selectedExercise)
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
      <Select
        size="xs"
        value={effectiveSelected}
        onChange={(v) => v && setSelectedExercise(v)}
        data={availableExercises.map((ex) => ({ value: ex, label: exerciseLabel(ex) }))}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true, width: 'target' }}
        style={{ minWidth: 130 }}
      />
    ) : null

  return (
    <ChartCard
      title="Weekly Volume"
      subtitle="Is my training load sustainable?"
      tooltip={METRIC_TOOLTIPS.weeklyVolume}
      extra={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {hasData && latest && latest.total > 0 ? (
            <span style={{ fontSize: 12, color: exColor, fontWeight: 600 }}>
              {fmtTonnage(latest.total)} this week
            </span>
          ) : null}
          {selectorNode}
        </span>
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
          leftAxis={{ domain: 'auto', formatTick: fmtTonnage, numTicks: 5 }}
          formatValue={fmtTonnage}
        />
      )}
      {/* MEV/MAV/MRV are refLines, not part of the bar/line series — Bars' derived legend can't
       * express them. The kind keeps its own interactive legend for bars + MA; this supplementary
       * static row only carries the landmark chips, styled to match the dashed refLines. */}
      <ChartLegend
        items={[
          { key: 'mev', label: 'MEV', color: VX.goodRef, shape: 'line', dashed: true },
          { key: 'mav', label: 'MAV', color: VX.warnRef, shape: 'line', dashed: true },
          { key: 'mrv', label: 'MRV', color: VX.badRef, shape: 'line', dashed: true },
        ]}
      />
    </ChartCard>
  )
}
