import { useMemo } from 'react'
import { Flex } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, type ChartSeries, DualPanel, VX } from 'basalt-ui/charts'
import { SelectFilter } from 'basalt-ui/controls'
import { createLocalStore, field } from 'basalt-ui/state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { EXERCISE_COLORS, METRIC_TOOLTIPS } from '../constants'
import { directionArrow, directionColor, exerciseLabel, type StrengthDirection } from '../formulas'

/** A per-chart select is store state like any filter (law C3) — a LOCAL store, because which lift
 * this one card plots is not worth a query param. Persisted, so it survives a reload. */
const local = createLocalStore({
  key: 'strength:momentum',
  fields: { exercise: field.enum(EXERCISE_KEYS, 'bench_press') },
})

const HEIGHT = 260
/** Top pane share of the inner plot — keeps the e1RM line dominant over the velocity histogram. */
const TOP_FRACTION = 0.83

type MomentumPoint = {
  date: string
  e1rm: number | null
  e1rmMA: number | null
  velocity: number | null
}

const fmtE1rm = (v: number) => `${v.toFixed(1)} kg`
const fmtTop = (v: number) => `${Math.round(v)}`
const fmtVelocity = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const fmtVelocityBar = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)} %/day`
/** Zero-noise floor so a flat velocity plateau doesn't amplify the bottom pane to full height. */
const BOTTOM_MAX_ABS_FLOOR = 0.1

/**
 * Linear regression slope over a trailing window of up to `windowDays` days
 * relative to each point. Returns slope as %/day (slope / mean × 100).
 */
function rollingVelocityPctPerDay(
  data: { date: string; e1rm: number | null }[],
  windowDays = 28,
): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    const anchor = data[i]
    if (!anchor || anchor.e1rm === null) {
      out.push(null)
      continue
    }
    const anchorMs = Date.parse(anchor.date)
    const cutoffMs = anchorMs - windowDays * 86_400_000
    const pts: { t: number; y: number }[] = []
    for (let j = i; j >= 0; j--) {
      const p = data[j]
      if (!p || p.e1rm === null) continue
      const tMs = Date.parse(p.date)
      if (tMs < cutoffMs) break
      pts.push({ t: (tMs - anchorMs) / 86_400_000, y: p.e1rm })
    }
    if (pts.length < 3) {
      out.push(null)
      continue
    }
    const n = pts.length
    let sumT = 0
    let sumY = 0
    let sumTT = 0
    let sumTY = 0
    for (const { t, y } of pts) {
      sumT += t
      sumY += y
      sumTT += t * t
      sumTY += t * y
    }
    const meanT = sumT / n
    const meanY = sumY / n
    const denom = sumTT - n * meanT * meanT
    if (denom === 0 || meanY === 0) {
      out.push(null)
      continue
    }
    const slope = (sumTY - n * meanT * meanY) / denom
    out.push((slope / meanY) * 100)
  }
  return out
}

function directionFromVelocity(velPctPerDay: number | null): StrengthDirection | null {
  if (velPctPerDay === null) return null
  // ≈ 0.07%/day ≈ 2%/month threshold for "stable"
  if (velPctPerDay > 0.07) return 'improving'
  if (velPctPerDay < -0.07) return 'declining'
  return 'stable'
}

export default function MomentumChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.seriesDetailed(params))

  const [selectedExercise] = local.field.exercise.use()

  // Render-time guard, unchanged: the stored lift may not be in this window's data at all.
  const activeExercise =
    data.byExercise.find((e) => e.exercise_id === selectedExercise) ?? data.byExercise[0]

  const chartData = useMemo<MomentumPoint[]>(() => {
    if (!activeExercise) return []
    const base = activeExercise.points.map((p) => ({ date: p.date, e1rm: p.e1rm }))
    const velocity = rollingVelocityPctPerDay(base, 28)
    return activeExercise.points.map((p, i) => ({
      date: p.date,
      e1rm: p.e1rm,
      e1rmMA: p.ma30,
      velocity: velocity[i] ?? null,
    }))
  }, [activeExercise])

  const e1rmVals = chartData
    .map((d) => d.e1rm)
    .filter((v): v is number => v !== null && !Number.isNaN(v))
  const hasData = e1rmVals.length >= 2

  const exerciseColor = EXERCISE_COLORS[selectedExercise] ?? SERIES.benchPress

  const series: ChartSeries<MomentumPoint>[] = [
    {
      key: 'e1rm',
      label: 'e1RM',
      color: exerciseColor,
      strokeOpacity: 0.5,
      mark: 'line',
      strokeWidth: 1.5,
      getValue: (d) => d.e1rm,
      formatValue: fmtE1rm,
      getMarker: (d) =>
        d.e1rm === null ? null : { r: 2.5, color: exerciseColor, ring: false, fillOpacity: 0.7 },
    },
    {
      key: 'ma30',
      label: '30d MA',
      color: exerciseColor,
      mark: 'line',
      strokeWidth: 2.25,
      dash: 'dashed',
      getValue: (d) => d.e1rmMA,
      formatValue: fmtE1rm,
    },
  ]

  const latestVel = [...chartData].reverse().find((d) => d.velocity !== null)?.velocity ?? null
  const dir = directionFromVelocity(latestVel)
  const monthly = latestVel !== null ? latestVel * 30 : null

  const selectOptions = data.byExercise.map((e) => ({
    value: e.exercise_id,
    label: exerciseLabel(e.exercise_id),
  }))

  const headerExtra = (
    <Flex display="inline-flex" align="center" gap={8}>
      {monthly !== null ? (
        <span style={{ fontSize: VX.text.xs }}>
          <span style={{ fontWeight: 600, fontSize: VX.text.md, color: directionColor(dir) }}>
            {monthly >= 0 ? '+' : ''}
            {monthly.toFixed(2)}%
          </span>
          <span style={{ opacity: 0.55 }}>/mo </span>
          <span style={{ fontWeight: 600, color: directionColor(dir) }}>{directionArrow(dir)}</span>
        </span>
      ) : null}
      {selectOptions.length > 1 && (
        <SelectFilter field={local.field.exercise} label="Exercise" options={selectOptions} />
      )}
    </Flex>
  )

  return (
    <ChartCard
      title="Momentum"
      subtitle="Is the trend accelerating?"
      info={METRIC_TOOLTIPS.momentum}
      actions={headerExtra}
      state={{ empty: !hasData && 'Need at least 2 sessions per exercise' }}
      placeholderHeight={HEIGHT}
    >
      <DualPanel<MomentumPoint>
        data={chartData}
        height={HEIGHT}
        chartId="momentum"
        getX={(d) => d.date}
        series={series}
        topFraction={TOP_FRACTION}
        getBar={(d) => d.velocity}
        barLabel="Velocity"
        barColorPositive={VX.goodSolid}
        barColorNegative={VX.badSolid}
        formatTop={fmtTop}
        formatBottom={fmtVelocity}
        formatBar={fmtVelocityBar}
        bottomYDomain="auto"
        bottomMaxAbsFloor={BOTTOM_MAX_ABS_FLOOR}
        ariaLabel="Estimated 1RM trend with its trailing regression, over a velocity histogram of percent change per day"
      />
    </ChartCard>
  )
}
