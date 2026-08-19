import { useMemo, useState } from 'react'
import { Box, Flex, Select } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  alpha,
  CartesianChart,
  ChartCard,
  type ChartSeries,
  curveMonotoneX,
  LinePath,
  TooltipRow,
  VX,
  type ZoneSpec,
} from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { DEFAULT_EXERCISES, EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { exerciseLabel, inolDotColor } from '../formulas'
import { ChartEmpty } from './empty'

const HEIGHT = 280

type InolPoint = {
  date: string
  inol: number | null
  ma10: number | null
}

function inolZoneLabel(v: number): string {
  if (v < 0.4) return 'Too Light'
  if (v < 0.6) return 'Recovery'
  if (v <= 1.0) return 'Optimal'
  if (v <= 1.5) return 'Hard'
  return 'Excessive'
}

const INOL_ZONES: ZoneSpec[] = [
  { from: 0, to: 0.4, fill: alpha(VX.status.neutral, 0.06) },
  { from: 0.4, to: 0.6, fill: alpha(VX.status.good, 0.06) },
  { from: 0.6, to: 1.0, fill: alpha(VX.status.excellent, 0.08) },
  { from: 1.0, to: 1.5, fill: alpha(VX.status.warn, 0.08) },
  { from: 1.5, to: Infinity, fill: alpha(VX.status.bad, 0.08) },
]

const INOL_REF_LINES = [
  { value: 0.6, color: VX.goodRef, dashed: true },
  { value: 1.0, color: VX.warnRef, dashed: true },
  { value: 1.5, color: VX.badRef, dashed: true },
]

/** Trailing moving average; null until `min` non-null values are present. */
function trailingMA(values: (number | null)[], window: number, min = 3): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1)
    let sum = 0
    let count = 0
    for (let j = start; j <= i; j++) {
      const v = values[j]
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        sum += v
        count += 1
      }
    }
    out.push(count >= min ? sum / count : null)
  }
  return out
}

/** Floors the domain at 2.0 so the 1.5 "Excessive" refLine always has headroom — `nice: true` on
 * the axis rounds the resulting bound. */
function inolDomain(data: readonly InolPoint[]): [number, number] {
  const vals = data.map((d) => d.inol).filter((v): v is number => v !== null && !Number.isNaN(v))
  return [0, Math.max(2, ...vals) * 1.1]
}

export default function InolChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.seriesDetailed(params))

  const availableExercises = data.byExercise.filter((e) => e.points.length > 0)
  const fallback =
    (availableExercises[0]?.exercise_id as ExerciseKey | undefined) ?? DEFAULT_EXERCISES[0]!
  const [selectedExercise, setSelectedExercise] = useState<string>(fallback)

  const activeExercise =
    data.byExercise.find((e) => e.exercise_id === selectedExercise) ?? availableExercises[0]

  const chartData = useMemo<InolPoint[]>(() => {
    if (!activeExercise) return []
    const inolValues = activeExercise.points.map((p) => p.inol)
    const ma = trailingMA(inolValues, 10)
    return activeExercise.points.map((p, i) => ({
      date: p.date,
      inol: p.inol,
      ma10: ma[i] ?? null,
    }))
  }, [activeExercise])

  const hasData = chartData.some((d) => d.inol !== null)
  const latest = [...chartData].reverse().find((d) => d.inol !== null)

  const exerciseColor = EXERCISE_COLORS[selectedExercise as ExerciseKey] ?? SERIES.benchPress

  const selectOptions = data.byExercise.map((e) => ({
    value: e.exercise_id,
    label: exerciseLabel(e.exercise_id),
  }))

  const headerExtra = (
    <Flex display="inline-flex" align="center" gap={8}>
      {latest && latest.inol !== null ? (
        <span style={{ fontSize: VX.text.xs }}>
          <span style={{ fontWeight: 600, fontSize: VX.text.md, color: inolDotColor(latest.inol) }}>
            {latest.inol.toFixed(2)}
          </span>
          <Box component="span" ml={6} style={{ color: inolDotColor(latest.inol) }}>
            {inolZoneLabel(latest.inol)}
          </Box>
        </span>
      ) : null}
      {selectOptions.length > 1 && (
        <Select
          size="xs"
          w={140}
          value={selectedExercise}
          onChange={(v) => v && setSelectedExercise(v)}
          data={selectOptions}
          allowDeselect={false}
        />
      )}
    </Flex>
  )

  const series: ChartSeries<InolPoint>[] = [
    {
      key: 'session',
      label: 'Session',
      color: VX.goodSolid,
      // 'area' keeps the block swatch of the zone entries below while still carrying a cursor dot,
      // whose color `getMarker` resolves per point from the INOL zone.
      mark: 'area',
      tooltip: false,
      getValue: (d) => d.inol,
      getMarker: (d) => (d.inol === null ? null : { color: inolDotColor(d.inol) }),
    },
    {
      key: 'ma',
      label: '10-session MA',
      color: exerciseColor,
      mark: 'line',
      strokeWidth: 2.25,
      dash: 'dashed',
      getValue: (d) => d.ma10,
      formatValue: (v) => v.toFixed(2),
    },
    {
      key: 'opt',
      label: 'Optimal (0.6–1.0)',
      color: VX.goodSolid,
      mark: 'bar',
      tooltip: false,
      getValue: () => null,
    },
    {
      key: 'hard',
      label: 'Hard (1.0–1.5)',
      color: SERIES.calories,
      mark: 'bar',
      tooltip: false,
      getValue: () => null,
    },
    {
      key: 'exc',
      label: 'Excessive (>1.5)',
      color: VX.badSolid,
      mark: 'bar',
      tooltip: false,
      getValue: () => null,
    },
  ]

  return (
    <ChartCard
      title="INOL — Session Quality"
      subtitle="Intensity × Number of Lifts"
      tooltip={METRIC_TOOLTIPS.inol}
      extra={headerExtra}
    >
      <Box h={HEIGHT} w="100%">
        {hasData ? (
          <CartesianChart
            data={chartData}
            chartId="inol"
            getX={(d) => d.date}
            series={series}
            y={{ domain: inolDomain, ticks: 5, format: (v) => v.toFixed(1), nice: true }}
            zones={INOL_ZONES}
            refLines={INOL_REF_LINES}
            height={HEIGHT}
            ariaLabel="INOL per session with a 10-session moving average"
            tooltip={{
              label: (d) =>
                d.inol === null
                  ? null
                  : { text: inolZoneLabel(d.inol), color: inolDotColor(d.inol) },
              // The row's color is per-point (zone-dependent) — `formatValue` can only vary the
              // value text, so this stays hand-authored. Gated on `ctx.hidden` so it disappears
              // along with the 'session' mark when the legend toggles it off.
              prependRows: (d, ctx) => {
                if (ctx.hidden.has('session')) return null
                return d.inol === null ? (
                  <TooltipRow color={VX.line} label="INOL" value="—" shape="bar" />
                ) : (
                  <TooltipRow
                    color={inolDotColor(d.inol)}
                    label="INOL"
                    value={d.inol.toFixed(2)}
                    shape="bar"
                  />
                )
              },
            }}
          >
            {({ data: rows, visible, xScale, yScale }) => {
              const dots = visible.some((s) => s.key === 'session')
                ? rows.filter((d): d is InolPoint & { inol: number } => d.inol !== null)
                : []
              const maPoints = visible.some((s) => s.key === 'ma')
                ? rows.filter((d): d is InolPoint & { ma10: number } => d.ma10 !== null)
                : []
              return (
                <>
                  {dots.length >= 2 && (
                    <LinePath<InolPoint & { inol: number }>
                      data={dots}
                      x={(d) => xScale(d.date) ?? 0}
                      y={(d) => yScale(d.inol)}
                      stroke={exerciseColor}
                      strokeOpacity={0.35}
                      strokeWidth={1.25}
                      curve={curveMonotoneX}
                    />
                  )}

                  {dots.map((d) => {
                    const sx = xScale(d.date)
                    if (sx === undefined) return null
                    return (
                      <circle
                        key={d.date}
                        cx={sx}
                        cy={yScale(d.inol)}
                        r={4}
                        fill={inolDotColor(d.inol)}
                        fillOpacity={0.85}
                        stroke="none"
                      />
                    )
                  })}

                  {maPoints.length >= 2 && (
                    <LinePath<InolPoint & { ma10: number }>
                      data={maPoints}
                      x={(d) => xScale(d.date) ?? 0}
                      y={(d) => yScale(d.ma10)}
                      stroke={exerciseColor}
                      strokeWidth={2.25}
                      strokeDasharray="6 4"
                      curve={curveMonotoneX}
                    />
                  )}
                </>
              )
            }}
          </CartesianChart>
        ) : (
          <ChartEmpty height={HEIGHT} message="No sessions in this window" />
        )}
      </Box>
    </ChartCard>
  )
}
