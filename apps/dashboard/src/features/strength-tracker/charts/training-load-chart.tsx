import { Stack, Text } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
  ZoneRects,
  type ZoneSpec,
} from '@argo/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { acwrZoneColor, acwrZoneLabel, exerciseLabel } from '../formulas'

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

const MARGIN = { top: 16, right: 24, bottom: 32, left: 56 } as const
const HEIGHT = 280

function ChartEmpty({ height = HEIGHT, label }: { height?: number; label: string }) {
  return (
    <Stack justify="center" align="center" h={height} gap={4}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Stack>
  )
}

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

export default function TrainingLoadChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.trainingLoad(params))
  const { ref, width: containerWidth } = useElementSize<HTMLDivElement>()
  const { line } = useVxTheme()
  const tooltipStyles = useTooltipStyles()
  const [highlighted, setHighlighted] = useState<string | null>(null)

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

  const width = Math.max(containerWidth, 200)
  const xMax = width - MARGIN.left - MARGIN.right
  const yPlotMax = HEIGHT - MARGIN.top - MARGIN.bottom

  const xScale = scalePoint<string>({
    domain: merged.map((d) => d.date),
    range: [0, xMax],
    padding: 0.3,
  })
  const yScale = scaleLinear<number>({ domain: [0, yMax], range: [yPlotMax, 0] })

  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<MergedPoint>({
      data: merged,
      chartId: 'training-load',
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = smartTicks(
    merged.map((d) => d.date),
    xMax,
  )

  const zones: ZoneSpec[] = [
    { from: 0, to: 0.8, fill: 'rgba(22, 119, 255, 0.08)' },
    { from: 0.8, to: 1.3, fill: VX.good },
    { from: 1.3, to: 1.5, fill: VX.warn },
    { from: 1.5, to: yMax, fill: VX.bad },
  ]

  const refLines: { value: number; color: string }[] = [
    { value: 1.0, color: VX.grid },
    { value: 0.8, color: VX.goodRef },
    { value: 1.3, color: VX.warnRef },
    { value: 1.5, color: VX.badRef },
  ]

  const opa = (key: string): number => (highlighted === null || highlighted === key ? 1 : 0.12)

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Am I loading smart?"
      tooltip={METRIC_TOOLTIPS.trainingLoad}
      extra={
        leaderLast && leaderLast.acwr !== null ? (
          <span style={{ fontSize: 12 }}>
            <span
              style={{
                fontSize: 14,
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
      <div ref={ref} style={{ height: HEIGHT, width: '100%' }}>
        {!enoughData ? (
          <ChartEmpty height={HEIGHT} label="Not enough data — need at least 2 weeks of sessions" />
        ) : containerWidth > 0 ? (
          <div style={{ position: 'relative' }}>
            <svg width={width} height={HEIGHT}>
              <Group left={MARGIN.left} top={MARGIN.top}>
                <ZoneRects zones={zones} width={xMax} leftScale={yScale} />
                <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />
                {refLines.map((r, i) => (
                  <line
                    key={`ref-${i}`}
                    x1={0}
                    x2={xMax}
                    y1={yScale(r.value)}
                    y2={yScale(r.value)}
                    stroke={r.color}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                ))}
                {exercises.map((ex) => {
                  const exColor = EXERCISE_COLORS[ex as ExerciseKey] ?? line
                  const pts = merged.filter((d) => {
                    const v = d.per[ex]?.acwr
                    return v !== null && v !== undefined
                  })
                  if (pts.length < 2) return null
                  return (
                    <LinePath<MergedPoint>
                      key={ex}
                      data={pts}
                      x={(d) => xScale(d.date) ?? 0}
                      y={(d) => yScale(d.per[ex]!.acwr!)}
                      stroke={exColor}
                      strokeWidth={2.5}
                      strokeOpacity={opa(ex)}
                      curve={curveMonotoneX}
                    />
                  )
                })}
                {syncedPoint !== null &&
                  (() => {
                    const sx = xScale(syncedPoint.date) ?? 0
                    return (
                      <>
                        <line
                          x1={sx}
                          x2={sx}
                          y1={0}
                          y2={yPlotMax}
                          stroke={VX.crosshair}
                          strokeWidth={1}
                        />
                        {exercises.map((ex) => {
                          const v = syncedPoint.per[ex]?.acwr
                          if (v === null || v === undefined) return null
                          const exColor = EXERCISE_COLORS[ex as ExerciseKey] ?? line
                          return (
                            <circle
                              key={ex}
                              cx={sx}
                              cy={yScale(v)}
                              r={4}
                              fill={exColor}
                              stroke={VX.dotStroke}
                              strokeWidth={2}
                              opacity={opa(ex)}
                            />
                          )
                        })}
                      </>
                    )
                  })()}
                <AxisLeftNumeric
                  scale={yScale}
                  numTicks={5}
                  tickFormat={(v) => Number(v).toFixed(1)}
                />
                <AxisBottomDate top={yPlotMax} scale={xScale} tickValues={tickValues} />
                <HoverOverlay
                  width={xMax}
                  height={yPlotMax}
                  onMove={handleMouse}
                  onLeave={handleLeave}
                />
              </Group>
            </svg>
            <ChartTooltip
              tip={isDirectHover ? tip : null}
              tooltipRef={tooltipRef}
              styles={tooltipStyles}
            >
              {tip && isDirectHover && (
                <>
                  <TooltipHeader date={tip.data.date} />
                  <TooltipBody>
                    {exercises.map((ex) => {
                      const row = tip.data.per[ex]
                      if (!row || row.acwr === null) return null
                      const exColor = EXERCISE_COLORS[ex as ExerciseKey] ?? line
                      const zone = row.zone
                      return (
                        <TooltipRow
                          key={ex}
                          color={exColor}
                          label={exerciseLabel(ex)}
                          value={`${row.acwr.toFixed(2)}${
                            zone ? ` · ${acwrZoneLabel(zone)}` : ''
                          } · A ${row.acute.toFixed(1)} / C ${row.chronic.toFixed(1)}`}
                          shape="line"
                          strokeWidth={2.5}
                        />
                      )
                    })}
                  </TooltipBody>
                </>
              )}
            </ChartTooltip>
          </div>
        ) : null}
      </div>
      <ChartLegend
        items={[
          ...exercises.map((ex) => ({
            key: ex,
            label: exerciseLabel(ex),
            color: EXERCISE_COLORS[ex as ExerciseKey] ?? line,
            strokeWidth: 2.5,
          })),
          {
            key: 'zone-under',
            label: 'Undertrained',
            color: 'rgba(22,119,255,0.4)',
            shape: 'bar' as const,
          },
          { key: 'zone-opt', label: 'Optimal', color: VX.goodSolid, shape: 'bar' as const },
          { key: 'zone-caut', label: 'Caution', color: VX.warnSolid, shape: 'bar' as const },
          { key: 'zone-danger', label: 'Danger', color: VX.badSolid, shape: 'bar' as const },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
