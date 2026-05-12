import { useMemo, useState } from 'react'
import { Select } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  curveMonotoneX,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  scaleLinear,
  scalePoint,
  smartTicks,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  useHoverSync,
  useTooltipStyles,
  useVxTheme,
  VX,
} from '@argo/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { DEFAULT_EXERCISES, EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { directionArrow, directionColor, exerciseLabel, type StrengthDirection } from '../formulas'
import { ChartEmpty } from './empty'

const MARGIN = { top: 16, right: 24, bottom: 32, left: 56 }
const HEIGHT = 260
const PANEL_GAP = 12
const TOP_PANEL = 180
const BOTTOM_PANEL = HEIGHT - TOP_PANEL - PANEL_GAP

type MomentumPoint = {
  date: string
  e1rm: number | null
  e1rmMA: number | null
  velocity: number | null
}

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

function MomentumChartInner({
  data,
  exerciseColor,
  width,
  height,
  chartId,
}: {
  data: MomentumPoint[]
  exerciseColor: string
  width: number
  height: number
  chartId: string
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMaxTop = TOP_PANEL - MARGIN.top - 4
  const yMaxBottom = BOTTOM_PANEL - 4 - MARGIN.bottom

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )

  const e1rmVals = data
    .map((d) => d.e1rm)
    .filter((v): v is number => v !== null && !Number.isNaN(v))

  const yScaleTop = useMemo(() => {
    if (!e1rmVals.length) return scaleLinear<number>({ domain: [0, 200], range: [yMaxTop, 0] })
    const lo = Math.min(...e1rmVals) * 0.92
    const hi = Math.max(...e1rmVals) * 1.08
    return scaleLinear<number>({ domain: [lo, hi], range: [yMaxTop, 0], nice: true })
  }, [e1rmVals, yMaxTop])

  const velVals = data
    .map((d) => d.velocity)
    .filter((v): v is number => v !== null && !Number.isNaN(v))
  const velExtent = velVals.length ? Math.max(...velVals.map(Math.abs), 0.1) : 0.1

  const yScaleBottom = useMemo(
    () =>
      scaleLinear<number>({
        domain: [-velExtent * 1.2, velExtent * 1.2],
        range: [yMaxBottom, 0],
        nice: true,
      }),
    [velExtent, yMaxBottom],
  )

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<MomentumPoint>({
      data,
      chartId,
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const validE1rm = data.filter((d) => d.e1rm !== null) as (MomentumPoint & { e1rm: number })[]
  const validMA = data.filter((d) => d.e1rmMA !== null) as (MomentumPoint & { e1rmMA: number })[]

  const barW = Math.max((xMax / Math.max(data.length, 1)) * 0.55, 2)

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        {/* Top panel: e1RM + MA30 */}
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScaleTop} width={xMax} stroke={VX.grid} numTicks={4} />

          <LinePath<MomentumPoint & { e1rm: number }>
            data={validE1rm}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTop(d.e1rm)}
            stroke={exerciseColor}
            strokeOpacity={0.5}
            strokeWidth={1.5}
            curve={curveMonotoneX}
          />

          {validE1rm.map((d) => {
            const sx = xScale(d.date)
            if (sx === undefined) return null
            return (
              <circle
                key={d.date}
                cx={sx}
                cy={yScaleTop(d.e1rm)}
                r={2.5}
                fill={exerciseColor}
                fillOpacity={0.7}
                stroke="none"
              />
            )
          })}

          {validMA.length >= 2 && (
            <LinePath<MomentumPoint & { e1rmMA: number }>
              data={validMA}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScaleTop(d.e1rmMA)}
              stroke={exerciseColor}
              strokeWidth={2.25}
              strokeDasharray="6 4"
              curve={curveMonotoneX}
            />
          )}

          {syncedPoint && (
            <>
              <line
                x1={xScale(syncedPoint.date) ?? 0}
                x2={xScale(syncedPoint.date) ?? 0}
                y1={0}
                y2={yMaxTop}
                stroke={VX.crosshair}
                strokeWidth={1}
              />
              {syncedPoint.e1rm !== null && (
                <circle
                  cx={xScale(syncedPoint.date) ?? 0}
                  cy={yScaleTop(syncedPoint.e1rm)}
                  r={4}
                  fill={exerciseColor}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                />
              )}
            </>
          )}

          <AxisLeftNumeric
            scale={yScaleTop}
            numTicks={4}
            tickFormat={(v) => `${Math.round(Number(v))}`}
          />
        </Group>

        {/* Bottom panel: velocity bars */}
        <Group left={MARGIN.left} top={MARGIN.top + TOP_PANEL + PANEL_GAP}>
          <GridRows scale={yScaleBottom} width={xMax} stroke={VX.grid} numTicks={3} />

          {/* Zero reference line */}
          <line
            x1={0}
            x2={xMax}
            y1={yScaleBottom(0)}
            y2={yScaleBottom(0)}
            stroke={VX.crosshair}
            strokeWidth={1}
          />

          {data.map((d) => {
            if (d.velocity === null) return null
            const sx = xScale(d.date)
            if (sx === undefined) return null
            const y0 = yScaleBottom(0)
            const y1 = yScaleBottom(d.velocity)
            const barColor =
              d.velocity > 0 ? VX.goodSolid : d.velocity < 0 ? VX.badSolid : VX.crosshair
            return (
              <rect
                key={d.date}
                x={sx - barW / 2}
                y={Math.min(y0, y1)}
                width={barW}
                height={Math.max(Math.abs(y0 - y1), 1)}
                fill={barColor}
                fillOpacity={0.7}
              />
            )
          })}

          {syncedPoint && (
            <line
              x1={xScale(syncedPoint.date) ?? 0}
              x2={xScale(syncedPoint.date) ?? 0}
              y1={0}
              y2={yMaxBottom}
              stroke={VX.crosshair}
              strokeWidth={1}
            />
          )}

          <AxisLeftNumeric
            scale={yScaleBottom}
            numTicks={3}
            tickFormat={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`}
          />
          <AxisBottomDate top={yMaxBottom} scale={xScale} tickValues={tickValues} />

          <HoverOverlay
            width={xMax}
            height={yMaxBottom + MARGIN.bottom}
            onMove={handleMouse}
            onLeave={handleLeave}
          />
        </Group>

        {/* Hover overlay for top panel (so hover works there too) */}
        <Group left={MARGIN.left} top={MARGIN.top}>
          <HoverOverlay
            width={xMax}
            height={yMaxTop + PANEL_GAP}
            onMove={handleMouse}
            onLeave={handleLeave}
          />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {tip.data.e1rm !== null && (
                <TooltipRow
                  color={exerciseColor}
                  label="e1RM"
                  value={`${tip.data.e1rm.toFixed(1)} kg`}
                  shape="line"
                />
              )}
              {tip.data.e1rmMA !== null && (
                <TooltipRow
                  color={exerciseColor}
                  label="30d MA"
                  value={`${tip.data.e1rmMA.toFixed(1)} kg`}
                  shape="line"
                  dashed
                  strokeWidth={2.25}
                />
              )}
              {tip.data.velocity !== null && (
                <TooltipRow
                  color={
                    tip.data.velocity > 0
                      ? VX.goodSolid
                      : tip.data.velocity < 0
                        ? VX.badSolid
                        : VX.crosshair
                  }
                  label="Velocity"
                  value={`${tip.data.velocity >= 0 ? '+' : ''}${tip.data.velocity.toFixed(3)} %/day`}
                  shape="bar"
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export default function MomentumChart({ params }: { params: StrengthQueryParams }) {
  // Reads useVxTheme to keep the reference stable across theme switches (no-op return).
  useVxTheme()
  const { data } = useSuspenseQuery(strengthQueries.seriesDetailed(params))
  const { ref, width } = useElementSize<HTMLDivElement>()

  const eligible = data.byExercise.filter(
    (e) => e.points.filter((p) => p.e1rm !== null).length >= 2,
  )
  const fallback =
    (eligible[0]?.exercise_id as ExerciseKey | undefined) ??
    (data.byExercise[0]?.exercise_id as ExerciseKey | undefined) ??
    DEFAULT_EXERCISES[0]!
  const [selectedExercise, setSelectedExercise] = useState<string>(fallback)

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

  const e1rmCount = chartData.filter((d) => d.e1rm !== null).length
  const hasData = e1rmCount >= 2

  const exerciseColor = EXERCISE_COLORS[selectedExercise as ExerciseKey] ?? VX.series.benchPress

  const latestVel = [...chartData].reverse().find((d) => d.velocity !== null)?.velocity ?? null
  const dir = directionFromVelocity(latestVel)
  const monthly = latestVel !== null ? latestVel * 30 : null

  const selectOptions = data.byExercise.map((e) => ({
    value: e.exercise_id,
    label: exerciseLabel(e.exercise_id),
  }))

  const headerExtra = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {monthly !== null ? (
        <span style={{ fontSize: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: directionColor(dir) }}>
            {monthly >= 0 ? '+' : ''}
            {monthly.toFixed(2)}%
          </span>
          <span style={{ opacity: 0.55 }}>/mo </span>
          <span style={{ fontWeight: 600, color: directionColor(dir) }}>{directionArrow(dir)}</span>
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
    </span>
  )

  return (
    <ChartCard
      title="Momentum"
      subtitle="Is the trend accelerating?"
      tooltip={METRIC_TOOLTIPS.momentum}
      extra={headerExtra}
    >
      <div ref={ref} style={{ height: HEIGHT, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={HEIGHT} message="Need at least 2 sessions per exercise" />
        ) : width > 0 ? (
          <MomentumChartInner
            data={chartData}
            exerciseColor={exerciseColor}
            width={Math.max(width, 200)}
            height={HEIGHT}
            chartId="momentum"
          />
        ) : null}
      </div>
      <ChartLegend
        items={[
          { key: 'e1rm', label: 'e1RM', color: exerciseColor, strokeWidth: 1.5 },
          { key: 'ma30', label: '30d MA', color: exerciseColor, strokeWidth: 2.25, dashed: true },
          { key: 'velUp', label: 'Velocity ▲', color: VX.goodSolid, shape: 'bar' },
          { key: 'velDown', label: 'Velocity ▼', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}
