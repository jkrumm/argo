import { useMemo, useState } from 'react'
import { Select } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  alpha,
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
import { DEFAULT_EXERCISES, EXERCISE_COLORS, METRIC_TOOLTIPS, type ExerciseKey } from '../constants'
import { exerciseLabel, inolDotColor } from '../formulas'
import { ChartEmpty } from './empty'

const MARGIN = { top: 16, right: 24, bottom: 32, left: 56 }
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

function InolChartInner({
  data,
  exerciseColor,
  width,
  height,
  chartId,
}: {
  data: InolPoint[]
  exerciseColor: string
  width: number
  height: number
  chartId: string
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom
  const { line: themeLine } = useVxTheme()

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )

  const yScale = useMemo(() => {
    const vals = data.map((d) => d.inol).filter((v): v is number => v !== null && !Number.isNaN(v))
    const maxV = vals.length ? Math.max(...vals, 1.5) : 2
    const upper = Math.max(2, maxV) * 1.1
    return scaleLinear<number>({ domain: [0, upper], range: [yMax, 0], nice: true })
  }, [data, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<InolPoint>({
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

  const validDots = data.filter((d) => d.inol !== null) as (InolPoint & { inol: number })[]
  const validMA = data.filter((d) => d.ma10 !== null) as (InolPoint & { ma10: number })[]

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <ZoneRects zones={INOL_ZONES} width={xMax} leftScale={yScale} />
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {[0.6, 1.0, 1.5].map((v) => (
            <line
              key={v}
              x1={0}
              x2={xMax}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke={v === 0.6 ? VX.goodRef : v === 1.0 ? VX.warnRef : VX.badRef}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          ))}

          {validDots.length >= 2 && (
            <LinePath<InolPoint & { inol: number }>
              data={validDots}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScale(d.inol)}
              stroke={exerciseColor}
              strokeOpacity={0.35}
              strokeWidth={1.25}
              curve={curveMonotoneX}
            />
          )}

          {validDots.map((d) => {
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

          {validMA.length >= 2 && (
            <LinePath<InolPoint & { ma10: number }>
              data={validMA}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScale(d.ma10)}
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
                y2={yMax}
                stroke={VX.crosshair}
                strokeWidth={1}
              />
              {syncedPoint.inol !== null && (
                <circle
                  cx={xScale(syncedPoint.date) ?? 0}
                  cy={yScale(syncedPoint.inol)}
                  r={5}
                  fill={inolDotColor(syncedPoint.inol)}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                />
              )}
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={5} tickFormat={(v) => Number(v).toFixed(1)} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />

          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader
              date={tip.data.date}
              {...(tip.data.inol !== null
                ? { label: inolZoneLabel(tip.data.inol), labelColor: inolDotColor(tip.data.inol) }
                : {})}
            />
            <TooltipBody>
              {tip.data.inol !== null && (
                <TooltipRow
                  color={inolDotColor(tip.data.inol)}
                  label="INOL"
                  value={tip.data.inol.toFixed(2)}
                  shape="bar"
                />
              )}
              {tip.data.ma10 !== null && (
                <TooltipRow
                  color={exerciseColor}
                  label="10-session MA"
                  value={tip.data.ma10.toFixed(2)}
                  shape="line"
                  dashed
                  strokeWidth={2.25}
                />
              )}
              {tip.data.inol === null && (
                <TooltipRow color={themeLine} label="INOL" value="—" shape="bar" />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export default function InolChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.seriesDetailed(params))
  const { ref, width } = useElementSize<HTMLDivElement>()

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

  const exerciseColor = EXERCISE_COLORS[selectedExercise as ExerciseKey] ?? VX.series.benchPress

  const selectOptions = data.byExercise.map((e) => ({
    value: e.exercise_id,
    label: exerciseLabel(e.exercise_id),
  }))

  const headerExtra = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {latest && latest.inol !== null ? (
        <span style={{ fontSize: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: inolDotColor(latest.inol) }}>
            {latest.inol.toFixed(2)}
          </span>
          <span style={{ marginLeft: 6, color: inolDotColor(latest.inol) }}>
            {inolZoneLabel(latest.inol)}
          </span>
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
      title="INOL — Session Quality"
      subtitle="Intensity × Number of Lifts"
      tooltip={METRIC_TOOLTIPS.inol}
      extra={headerExtra}
    >
      <div ref={ref} style={{ height: HEIGHT, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={HEIGHT} message="No sessions in this window" />
        ) : width > 0 ? (
          <InolChartInner
            data={chartData}
            exerciseColor={exerciseColor}
            width={Math.max(width, 200)}
            height={HEIGHT}
            chartId="inol"
          />
        ) : null}
      </div>
      <ChartLegend
        items={[
          { key: 'session', label: 'Session', color: VX.goodSolid, shape: 'bar' },
          {
            key: 'ma',
            label: '10-session MA',
            color: exerciseColor,
            strokeWidth: 2.25,
            dashed: true,
          },
          { key: 'opt', label: 'Optimal (0.6–1.0)', color: VX.goodSolid, shape: 'bar' },
          { key: 'hard', label: 'Hard (1.0–1.5)', color: VX.series.calories, shape: 'bar' },
          { key: 'exc', label: 'Excessive (>1.5)', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}
