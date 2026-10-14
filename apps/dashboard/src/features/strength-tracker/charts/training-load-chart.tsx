import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_COLORS, METRIC_TOOLTIPS, ZONE_COLORS, type ExerciseKey } from '../constants'
import { acwrZoneLabel, exerciseLabel, type AcwrZone } from '../formulas'
import { mergePoints, type ExerciseSeries, type MergedPoint } from './merge-acwr'

const HEIGHT = 280
const STROKE_WIDTH = 2.5

const exerciseColor = (ex: string): string =>
  EXERCISE_COLORS[ex as ExerciseKey] ?? SERIES.benchPress

// One source for the zone bands, the legend swatches and the header badge. Undertrained is
// neutral, not an exercise hue and not amber: it is "under-loaded", not a warning.
const ZONES: { key: AcwrZone; label: string; color: string }[] = [
  { key: 'undertrained', label: 'Undertrained', color: ZONE_COLORS.neutral },
  { key: 'optimal', label: 'Optimal', color: VX.goodSolid },
  { key: 'caution', label: 'Caution', color: VX.warnSolid },
  { key: 'danger', label: 'Danger', color: VX.badSolid },
]

const zoneColor = (zone: AcwrZone | null): string =>
  ZONES.find((z) => z.key === zone)?.color ?? ZONE_COLORS.neutral

// The zone keys ride the legend as swatches only — `getValue` is null everywhere, so they draw
// nothing and own no tooltip row.
const ZONE_SERIES: ChartSeries<MergedPoint>[] = ZONES.map((z) => ({
  key: `zone-${z.key}`,
  label: z.label,
  color: z.color,
  mark: 'bar',
  role: 'reference',
  getValue: () => null,
}))

export default function TrainingLoadChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.trainingLoad(params))

  const exerciseSeries = useMemo(
    () => (query.data?.byExercise ?? []) as ExerciseSeries[],
    [query.data],
  )
  const merged = useMemo(() => mergePoints(exerciseSeries), [exerciseSeries])

  // Need at least 2 ACWR points across any exercise to render.
  const totalAcwrPoints = exerciseSeries.reduce(
    (sum, s) => sum + s.points.filter((p) => p.acwr !== null).length,
    0,
  )
  const enoughData = totalAcwrPoints >= 2 && merged.length >= 2

  // Pick the strongest-signal exercise (most ACWR points) for the header badge.
  let leader: ExerciseSeries | null = null
  let leaderCount = -1
  for (const s of exerciseSeries) {
    const c = s.points.filter((p) => p.acwr !== null).length
    if (c > leaderCount) {
      leaderCount = c
      leader = s
    }
  }
  const leaderLast = leader?.points.findLast((p) => p.acwr !== null) ?? null

  const series = useMemo<ChartSeries<MergedPoint>[]>(
    () => [
      ...exerciseSeries.map(({ exercise_id: ex }): ChartSeries<MergedPoint> => ({
        key: ex,
        label: exerciseLabel(ex),
        color: exerciseColor(ex),
        strokeWidth: STROKE_WIDTH,
        getValue: (d) => d.per[ex]?.acwr ?? null,
        formatValue: (v, d) => {
          const row = d.per[ex]
          const zoneStr = row?.zone ? ` · ${acwrZoneLabel(row.zone)}` : ''
          return `${v.toFixed(2)}${zoneStr} · A ${row?.acute.toFixed(1) ?? '—'} / C ${row?.chronic.toFixed(1) ?? '—'}`
        },
      })),
      ...ZONE_SERIES,
    ],
    [exerciseSeries],
  )

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Am I loading smart?"
      info={METRIC_TOOLTIPS.trainingLoad}
      actions={
        leaderLast && leaderLast.acwr !== null ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={zoneColor(leaderLast.zone)}>
              {leaderLast.acwr.toFixed(2)}
            </Text>
            <Text span size="xs" c="dimmed">
              ACWR ·
            </Text>
            <Text span fw={600} size="xs" c={zoneColor(leaderLast.zone)}>
              {acwrZoneLabel(leaderLast.zone)}
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(
        query,
        !enoughData && 'Not enough data — need at least 2 weeks of sessions',
      )}
      placeholderHeight={HEIGHT}
    >
      <Lines
        // Keys are Monday week-starts (`weeklyTonnageSeries` -> `weekStart`), i.e. a bucket's
        // LEADING edge, so a back-half hover must not resolve to the following week.
        cursorResolution="leading"
        ariaLabel="Acute:chronic workload ratio per exercise with training-load zones"
        data={merged}
        height={HEIGHT}
        x={(d) => d.day}
        series={series}
        y={{ domain: 'auto', autoMaxFloor: 2, ticks: 5, format: (v) => v.toFixed(1) }}
        zones={[
          { from: 0, to: 0.8, fill: alpha(ZONE_COLORS.neutral, 0.08) },
          { from: 0.8, to: 1.3, fill: VX.good },
          { from: 1.3, to: 1.5, fill: VX.warn },
          { from: 1.5, to: Infinity, fill: VX.bad },
        ]}
        refLines={[
          { value: 1.0, color: VX.grid, dashed: true },
          { value: 0.8, color: VX.goodRef, dashed: true },
          { value: 1.3, color: VX.warnRef, dashed: true },
          { value: 1.5, color: VX.badRef, dashed: true },
        ]}
      />
    </ChartCard>
  )
}
