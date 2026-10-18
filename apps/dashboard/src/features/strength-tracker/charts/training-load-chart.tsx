import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { date } from 'basalt-ui/format'
import { alpha, VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { ACWR_PARITY, ACWR_ZONE_NAME } from '../bands'
import { EXERCISE_COLORS, METRIC_TOOLTIPS, ZONE_COLORS, type ExerciseKey } from '../constants'
import { acwrZoneLabel, exerciseLabel, type AcwrZone } from '../formulas'
import { fmtLoadPair } from '../model'
import { mergePoints, type ExerciseSeries, type MergedPoint } from './merge-acwr'

const HEIGHT = 280
const STROKE_WIDTH = 2.5

const exerciseColor = (ex: string): string =>
  EXERCISE_COLORS[ex as ExerciseKey] ?? SERIES.benchPress

// One source for the zone bands, the legend swatches and the header badge. Undertrained is
// neutral, not an exercise hue and not amber: it is "under-loaded", not a warning.
const ZONES: { key: AcwrZone; label: string; color: string }[] = [
  { key: 'undertrained', label: ACWR_ZONE_NAME.undertrained, color: ZONE_COLORS.neutral },
  { key: 'optimal', label: ACWR_ZONE_NAME.optimal, color: VX.goodSolid },
  { key: 'caution', label: ACWR_ZONE_NAME.caution, color: VX.warnSolid },
  { key: 'danger', label: ACWR_ZONE_NAME.danger, color: VX.badSolid },
]

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
          return `${v.toFixed(2)}${zoneStr} · ${fmtLoadPair(row?.acute, row?.chronic)}`
        },
      })),
      ...ZONE_SERIES,
    ],
    [exerciseSeries],
  )

  return (
    <ChartCard
      title="ACWR"
      info={METRIC_TOOLTIPS.trainingLoad}
      state={chartStateOf(
        query,
        !enoughData ? 'Not enough data — need at least 2 weeks of sessions' : undefined,
      )}
      placeholderHeight={HEIGHT}
    >
      <Lines
        // Keys are Monday week-starts (`weeklyTonnageSeries` -> `weekStart`), i.e. a bucket's
        // LEADING edge, so a back-half hover must not resolve to the following week.
        cursorResolution="leading"
        ariaLabel="Acute:chronic workload ratio per lift with training-load zones; the headline figure sums all lifts"
        data={merged}
        height={HEIGHT}
        x={(d) => d.day}
        series={series}
        formatX={(d) => date(d, { format: 'medium' })}
        y={{ domain: 'auto', autoMaxFloor: 2, ticks: 5, format: (v) => v.toFixed(1) }}
        zones={[
          { from: 0, to: 0.8, fill: alpha(ZONE_COLORS.neutral, 0.08) },
          { from: 0.8, to: 1.3, fill: VX.good },
          { from: 1.3, to: 1.5, fill: VX.warn },
          { from: 1.5, to: Infinity, fill: VX.bad },
        ]}
        refLines={[
          {
            value: ACWR_PARITY,
            color: VX.axis,
            dashed: true,
            legend: { label: `Acute = chronic (${ACWR_PARITY.toFixed(1)})` },
          },
          { value: 0.8, color: VX.goodRef, dashed: true },
          { value: 1.3, color: VX.warnRef, dashed: true },
          { value: 1.5, color: VX.badRef, dashed: true },
        ]}
      />
    </ChartCard>
  )
}
