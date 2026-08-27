import { useSuspenseQuery } from '@tanstack/react-query'
import {
  alpha,
  CartesianChart,
  ChartCard,
  curveMonotoneX,
  LinePath,
  VX,
  type ChartSeries,
  type PlotContext,
  type ZoneSpec,
} from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { acwrZoneColor, acwrZoneLabel, exerciseLabel } from '../formulas'
import { ChartEmpty } from './empty'

type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'

type ExerciseSeries = {
  exercise_id: string
  exercise_name: string
  points: {
    date: string
    acute: number
    chronic: number
    acwr: number | null
    zone: AcwrZone | null
  }[]
}

type MergedPoint = {
  date: string
  per: Record<
    string,
    { acute: number; chronic: number; acwr: number | null; zone: AcwrZone | null }
  >
}

const HEIGHT = 280
const STROKE_WIDTH = 2.5

function mergePoints(series: ExerciseSeries[]): MergedPoint[] {
  const byDate = new Map<string, MergedPoint>()
  for (const s of series) {
    for (const p of s.points) {
      let row = byDate.get(p.date)
      if (!row) {
        row = { date: p.date, per: {} }
        byDate.set(p.date, row)
      }
      row.per[s.exercise_id] = {
        acute: p.acute,
        chronic: p.chronic,
        acwr: p.acwr,
        zone: p.zone,
      }
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

const exerciseColor = (ex: string): string =>
  EXERCISE_COLORS[ex as ExerciseKey] ?? SERIES.benchPress

export default function TrainingLoadChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.trainingLoad(params))

  const series = data.byExercise as ExerciseSeries[]
  const exercises = series.map((s) => s.exercise_id)
  const merged = mergePoints(series)

  // Need at least 2 ACWR points across any exercise to render.
  const totalAcwrPoints = series.reduce(
    (sum, s) => sum + s.points.filter((p) => p.acwr !== null).length,
    0,
  )
  const enoughData = totalAcwrPoints >= 2 && merged.length >= 2

  // yDomain: floor 2.0, expanded if any acwr exceeds 1.8.
  let acwrMax = 0
  for (const s of series) {
    for (const p of s.points) {
      if (p.acwr !== null && p.acwr > acwrMax) acwrMax = p.acwr
    }
  }
  const yMax = Math.max(2.0, acwrMax + 0.2)

  // Pick the strongest-signal exercise (most ACWR points) for the header extra.
  let leaderId: string | null = null
  let leaderCount = -1
  for (const s of series) {
    const c = s.points.filter((p) => p.acwr !== null).length
    if (c > leaderCount) {
      leaderCount = c
      leaderId = s.exercise_id
    }
  }
  const leaderLast =
    leaderId !== null
      ? ([...(series.find((s) => s.exercise_id === leaderId)?.points ?? [])]
          .reverse()
          .find((p) => p.acwr !== null) ?? null)
      : null

  // The four zone bands ride the legend as swatches only — they draw no mark and own no tooltip
  // row, so `getValue` is null everywhere.
  const chartSeries: ChartSeries<MergedPoint>[] = [
    ...exercises.map(
      (ex): ChartSeries<MergedPoint> => ({
        key: ex,
        label: exerciseLabel(ex),
        color: exerciseColor(ex),
        mark: 'line',
        strokeWidth: STROKE_WIDTH,
        getValue: (d) => d.per[ex]?.acwr ?? null,
        formatValue: (v, d) => {
          const row = d.per[ex]
          const zoneStr = row?.zone ? ` · ${acwrZoneLabel(row.zone)}` : ''
          return `${v.toFixed(2)}${zoneStr} · A ${row?.acute.toFixed(1) ?? '—'} / C ${row?.chronic.toFixed(1) ?? '—'}`
        },
      }),
    ),
    {
      key: 'zone-under',
      label: 'Undertrained',
      color: SERIES.benchPress,
      fillOpacity: 0.4,
      mark: 'bar',
      tooltip: false,
      getValue: () => null,
    },
    {
      key: 'zone-opt',
      label: 'Optimal',
      color: VX.goodSolid,
      mark: 'bar',
      tooltip: false,
      getValue: () => null,
    },
    {
      key: 'zone-caut',
      label: 'Caution',
      color: VX.warnSolid,
      mark: 'bar',
      tooltip: false,
      getValue: () => null,
    },
    {
      key: 'zone-danger',
      label: 'Danger',
      color: VX.badSolid,
      mark: 'bar',
      tooltip: false,
      getValue: () => null,
    },
  ]

  const zones: ZoneSpec[] = [
    { from: 0, to: 0.8, fill: alpha(SERIES.benchPress, 0.08) },
    { from: 0.8, to: 1.3, fill: VX.good },
    { from: 1.3, to: 1.5, fill: VX.warn },
    { from: 1.5, to: yMax, fill: VX.bad },
  ]

  const refLines = [
    { value: 1.0, color: VX.grid, dashed: true },
    { value: 0.8, color: VX.goodRef, dashed: true },
    { value: 1.3, color: VX.warnRef, dashed: true },
    { value: 1.5, color: VX.badRef, dashed: true },
  ]

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Am I loading smart?"
      info={METRIC_TOOLTIPS.trainingLoad}
      actions={
        leaderLast && leaderLast.acwr !== null ? (
          <span style={{ fontSize: VX.text.xs }}>
            <span
              style={{
                fontSize: VX.text.md,
                fontWeight: 600,
                color: acwrZoneColor(leaderLast.zone),
              }}
            >
              {leaderLast.acwr.toFixed(2)}
            </span>
            <span style={{ opacity: 0.5 }}> ACWR · </span>
            <span style={{ fontWeight: 600, color: acwrZoneColor(leaderLast.zone) }}>
              {acwrZoneLabel(leaderLast.zone)}
            </span>
          </span>
        ) : null
      }
    >
      {enoughData ? (
        <CartesianChart
          data={merged}
          chartId="training-load"
          getX={(d) => d.date}
          // Keys are Monday week-starts (`weeklyTonnageSeries` -> `weekStart`), i.e. a bucket's
          // LEADING edge, so a back-half hover must not resolve to the following week.
          cursorResolution="leading"
          series={chartSeries}
          y={{ domain: [0, yMax], ticks: 5, format: (v) => v.toFixed(1) }}
          zones={zones}
          refLines={refLines}
          height={HEIGHT}
          ariaLabel="Acute:chronic workload ratio per exercise"
        >
          {({ data: rows, visible, xScale, yScale, highlighted }: PlotContext<MergedPoint>) =>
            visible.map((s) => {
              const pts = rows.filter((d) => s.getValue(d) !== null)
              if (pts.length < 2) return null
              return (
                <LinePath<MergedPoint>
                  key={s.key}
                  data={pts}
                  x={(d) => xScale(d.date) ?? 0}
                  y={(d) => yScale(s.getValue(d) ?? 0)}
                  stroke={s.color}
                  strokeWidth={s.strokeWidth ?? STROKE_WIDTH}
                  strokeOpacity={highlighted === null || highlighted === s.key ? 1 : 0.12}
                  curve={curveMonotoneX}
                />
              )
            })
          }
        </CartesianChart>
      ) : (
        <ChartEmpty height={HEIGHT} message="Not enough data — need at least 2 weeks of sessions" />
      )}
    </ChartCard>
  )
}
