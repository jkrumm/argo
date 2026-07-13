import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Box, Flex, Select } from '@mantine/core'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  deriveLegend,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  curveMonotoneX,
  scaleLinear,
  scalePoint,
  type SeriesStyle,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
} from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { SERIES } from '../../../lib/series'
import { DEFAULT_EXERCISES, EXERCISES, METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'
import { ChartEmpty } from './empty'

type CompositePoint = {
  date: string
  velocityRaw: number | null
  tonnageGrowthRaw: number | null
  inolRaw: number | null
  velocityZ: number | null
  tonnageGrowthZ: number | null
  inolZ: number | null
  velocityZma: number | null
  tonnageGrowthZma: number | null
  inolZma: number | null
}

// Distinct semantic colors per metric (NOT exercise colors — three metrics
// across one exercise).
const COMPOSITE_COLORS = {
  velocity: SERIES.hrv,
  tonnage: SERIES.calories,
  inol: SERIES.acwr,
} as const

const Y_DOMAIN: [number, number] = [-3, 3]

function fmtSigma(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`
}

function clamp(v: number | null): number | null {
  if (v === null) return null
  if (v < Y_DOMAIN[0]) return Y_DOMAIN[0]
  if (v > Y_DOMAIN[1]) return Y_DOMAIN[1]
  return v
}

function parseExercises(exercises: string | undefined): string[] {
  if (!exercises) return [...DEFAULT_EXERCISES]
  return exercises
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function CompositeInner({
  data,
  width,
  height,
  highlighted,
}: {
  data: CompositePoint[]
  width: number
  height: number
  highlighted: string | null
}) {
  const dim = (key: string): number => (highlighted === null || highlighted === key ? 1 : 0.15)

  const MARGIN_LOCAL = useMemo(() => ({ ...VX.margin, left: Math.max(VX.margin.left, 48) }), [])
  const xMax = width - MARGIN_LOCAL.left - MARGIN_LOCAL.right
  const yMax = height - MARGIN_LOCAL.top - MARGIN_LOCAL.bottom

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )

  const yScale = useMemo(() => scaleLinear<number>({ domain: Y_DOMAIN, range: [yMax, 0] }), [yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<CompositePoint>({
      data,
      chartId: 'strength-composite',
      getKey: (d) => d.date,
      xScale,
      marginLeft: MARGIN_LOCAL.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const velValid = data.filter(
    (d): d is CompositePoint & { velocityZma: number } => d.velocityZma !== null,
  )
  const tonValid = data.filter(
    (d): d is CompositePoint & { tonnageGrowthZma: number } => d.tonnageGrowthZma !== null,
  )
  const inolValid = data.filter(
    (d): d is CompositePoint & { inolZma: number } => d.inolZma !== null,
  )

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN_LOCAL.left} top={MARGIN_LOCAL.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={7} />

          {/* ±1σ subtle bands */}
          <rect
            x={0}
            y={yScale(1)}
            width={xMax}
            height={Math.max(0, yScale(-1) - yScale(1))}
            fill={VX.grid}
            opacity={0.5}
          />

          {/* Zero baseline */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke={VX.axis}
            strokeWidth={1}
            strokeDasharray="2 4"
            strokeOpacity={0.6}
          />

          <LinePath<CompositePoint & { velocityZma: number }>
            data={velValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(clamp(d.velocityZma) ?? 0)}
            stroke={COMPOSITE_COLORS.velocity}
            strokeWidth={2.5}
            strokeOpacity={dim('velocity')}
            curve={curveMonotoneX}
          />
          <LinePath<CompositePoint & { tonnageGrowthZma: number }>
            data={tonValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(clamp(d.tonnageGrowthZma) ?? 0)}
            stroke={COMPOSITE_COLORS.tonnage}
            strokeWidth={2.5}
            strokeOpacity={dim('tonnage')}
            curve={curveMonotoneX}
          />
          <LinePath<CompositePoint & { inolZma: number }>
            data={inolValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(clamp(d.inolZma) ?? 0)}
            stroke={COMPOSITE_COLORS.inol}
            strokeWidth={2.5}
            strokeOpacity={dim('inol')}
            curve={curveMonotoneX}
          />

          {syncedPoint !== null &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  {syncedPoint.velocityZma !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(clamp(syncedPoint.velocityZma) ?? 0)}
                      r={4}
                      fill={COMPOSITE_COLORS.velocity}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.tonnageGrowthZma !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(clamp(syncedPoint.tonnageGrowthZma) ?? 0)}
                      r={4}
                      fill={COMPOSITE_COLORS.tonnage}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.inolZma !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(clamp(syncedPoint.inolZma) ?? 0)}
                      r={4}
                      fill={COMPOSITE_COLORS.inol}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                </>
              )
            })()}

          <AxisLeftNumeric scale={yScale} numTicks={7} tickFormat={(v) => fmtSigma(Number(v))} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {tip.data.velocityZ !== null && (
                <TooltipRow
                  color={COMPOSITE_COLORS.velocity}
                  label="Velocity"
                  value={`${tip.data.velocityRaw !== null ? `${tip.data.velocityRaw.toFixed(3)}%/d` : '—'} · ${fmtSigma(tip.data.velocityZ)}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.tonnageGrowthZ !== null && (
                <TooltipRow
                  color={COMPOSITE_COLORS.tonnage}
                  label="Tonnage"
                  value={`${tip.data.tonnageGrowthRaw !== null ? `×${tip.data.tonnageGrowthRaw.toFixed(2)}` : '—'} · ${fmtSigma(tip.data.tonnageGrowthZ)}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.inolZ !== null && (
                <TooltipRow
                  color={COMPOSITE_COLORS.inol}
                  label="INOL"
                  value={`${tip.data.inolRaw !== null ? tip.data.inolRaw.toFixed(2) : '—'} · ${fmtSigma(tip.data.inolZ)}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export default function StrengthCompositeChart({
  params,
  exerciseId: initialExerciseId,
}: {
  params: StrengthQueryParams
  exerciseId: string
}) {
  const [selected, setSelected] = useState(initialExerciseId)

  const compositeParams = {
    exerciseId: selected,
    window: params.window,
    from: params.from,
    to: params.to,
  }
  const { data } = useSuspenseQuery(strengthQueries.composite(compositeParams))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const points = data.points as CompositePoint[]

  // A point only draws a line where its trailing ZMA is non-null. An exercise
  // with < 3 sessions yields points but zero ZMA, which would render as blank
  // axes — treat that as empty so the user sees why instead of nothing.
  const hasLines = useMemo(
    () =>
      points.some(
        (p) => p.velocityZma !== null || p.tonnageGrowthZma !== null || p.inolZma !== null,
      ),
    [points],
  )

  const activeOptions = useMemo(() => {
    const active = parseExercises(params.exercises)
    return EXERCISES.filter((e) => active.includes(e.value))
  }, [params.exercises])

  // Latest non-null z-score per metric for the header.
  const latest = useMemo(() => {
    let v: number | null = null
    let t: number | null = null
    let i: number | null = null
    for (let idx = points.length - 1; idx >= 0; idx--) {
      const p = points[idx]!
      if (v === null && p.velocityZ !== null) v = p.velocityZ
      if (t === null && p.tonnageGrowthZ !== null) t = p.tonnageGrowthZ
      if (i === null && p.inolZ !== null) i = p.inolZ
      if (v !== null && t !== null && i !== null) break
    }
    return { v, t, i }
  }, [points])

  const headerExtra = (
    <Flex display="inline-flex" align="center" gap="xs">
      <span style={{ fontSize: 12 }}>
        <span style={{ color: COMPOSITE_COLORS.velocity, fontWeight: 600 }}>
          v {latest.v !== null ? fmtSigma(latest.v) : '—'}
        </span>
        <span style={{ opacity: 0.4 }}> · </span>
        <span style={{ color: COMPOSITE_COLORS.tonnage, fontWeight: 600 }}>
          t {latest.t !== null ? fmtSigma(latest.t) : '—'}
        </span>
        <span style={{ opacity: 0.4 }}> · </span>
        <span style={{ color: COMPOSITE_COLORS.inol, fontWeight: 600 }}>
          i {latest.i !== null ? fmtSigma(latest.i) : '—'}
        </span>
      </span>
      <Select
        size="xs"
        w={140}
        value={selected}
        onChange={(value) => {
          if (value) setSelected(value)
        }}
        data={activeOptions}
        allowDeselect={false}
        aria-label="Exercise"
      />
    </Flex>
  )

  const legendSeries: readonly SeriesStyle[] = [
    {
      key: 'velocity',
      label: 'Velocity',
      color: COMPOSITE_COLORS.velocity,
      mark: 'line',
      strokeWidth: 2.5,
    },
    {
      key: 'tonnage',
      label: 'Tonnage Growth',
      color: COMPOSITE_COLORS.tonnage,
      mark: 'line',
      strokeWidth: 2.5,
    },
    {
      key: 'inol',
      label: 'INOL Quality',
      color: COMPOSITE_COLORS.inol,
      mark: 'line',
      strokeWidth: 2.5,
    },
  ]

  return (
    <ChartCard
      title="Strength Composite"
      subtitle="Three signals on one σ axis"
      tooltip={METRIC_TOOLTIPS.strengthComposite}
      extra={headerExtra}
    >
      <Box ref={ref} h={280} w="100%">
        {!hasLines ? (
          <ChartEmpty
            height={280}
            message={
              points.length === 0
                ? `No composite data for ${exerciseLabel(selected)}`
                : `Not enough sessions for ${exerciseLabel(selected)} yet — needs at least 3`
            }
          />
        ) : width > 0 ? (
          <CompositeInner
            data={points}
            width={Math.max(width, 200)}
            height={280}
            highlighted={highlighted}
          />
        ) : null}
      </Box>
      <ChartLegend
        items={deriveLegend(legendSeries)}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
