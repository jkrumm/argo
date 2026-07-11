import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  Crosshair,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  SeriesDot,
  Threshold,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  curveMonotoneX,
  scaleLinear,
  scalePoint,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
} from 'basalt-ui/charts'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

const MARGIN = VX.margin
const CHART_HEIGHT = 280
const CHART_ID = 'divergence'

type Point = {
  date: string
  acute: number
  chronic: number
  divergence: number
}

type RawPoint = {
  date: string
  acute: number | null
  chronic: number | null
  divergence: number | null
}

function formatDivergence(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

/**
 * Bespoke composition (dual-pane line + signed-histogram with a DIVERGING two-tone fill-between —
 * `basalt-ui`'s `DualPanel.fillBetween` only accepts a single fill color, so it can't express
 * "green when acute < chronic, red when acute > chronic". Composes `ChartFrame` + `useHoverSync`
 * directly, the sanctioned escape hatch for a shape no shipped kind's config surface covers.
 */
function DivergenceChartInner({
  data,
  width,
  height,
  highlighted,
}: {
  data: Point[]
  width: number
  height: number
  highlighted: string | null
}) {
  const gap = 12
  const topH = Math.round((height - gap) * 0.7)
  const bottomH = height - topH - gap
  const xMax = width - MARGIN.left - MARGIN.right
  const yMaxTop = topH - MARGIN.top - 4
  const yMaxBottom = bottomH - 4 - MARGIN.bottom

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )

  const loadMax = useMemo(
    () => Math.max(...data.map((d) => Math.max(d.acute, d.chronic)), 1),
    [data],
  )
  const yScaleTop = useMemo(
    () => scaleLinear<number>({ domain: [0, loadMax * 1.1], range: [yMaxTop, 0], nice: true }),
    [loadMax, yMaxTop],
  )

  const divExtent = useMemo(() => Math.max(...data.map((d) => Math.abs(d.divergence)), 1), [data])
  const yScaleBottom = useMemo(
    () =>
      scaleLinear<number>({ domain: [-divExtent, divExtent], range: [yMaxBottom, 0], nice: true }),
    [divExtent, yMaxBottom],
  )

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<Point>({
      data,
      chartId: CHART_ID,
      getKey: (d) => d.date,
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

  const acuteOpacity = highlighted === null || highlighted === 'acute' ? 0.7 : 0.1
  const chronicOpacity = highlighted === null || highlighted === 'chronic' ? 0.85 : 0.1
  const divergenceOpacity = highlighted === null || highlighted === 'divergence' ? 0.6 : 0.1

  const barWidth = data.length > 0 ? Math.max((xMax / data.length) * 0.6, 2) : 2

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        {/* Top pane: acute + chronic load with fill-between */}
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScaleTop} width={xMax} stroke={VX.grid} numTicks={4} />

          <Threshold<Point>
            id="divergence-signal-fill"
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y0={(d) => yScaleTop(d.chronic)}
            y1={(d) => yScaleTop(d.acute)}
            clipAboveTo={0}
            clipBelowTo={yMaxTop}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: VX.good }}
            aboveAreaProps={{ fill: VX.bad }}
          />

          <LinePath<Point>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTop(d.acute)}
            stroke={VX.goodSolid}
            strokeWidth={2}
            strokeOpacity={acuteOpacity}
            curve={curveMonotoneX}
          />

          <LinePath<Point>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTop(d.chronic)}
            stroke={VX.badSolid}
            strokeWidth={3}
            strokeOpacity={chronicOpacity}
            curve={curveMonotoneX}
          />

          {syncedPoint && (
            <>
              <Crosshair x={xScale(syncedPoint.date) ?? 0} top={0} bottom={yMaxTop} />
              <SeriesDot
                cx={xScale(syncedPoint.date) ?? 0}
                cy={yScaleTop(syncedPoint.acute)}
                color={VX.goodSolid}
              />
              <SeriesDot
                cx={xScale(syncedPoint.date) ?? 0}
                cy={yScaleTop(syncedPoint.chronic)}
                color={VX.badSolid}
              />
            </>
          )}

          <AxisLeftNumeric scale={yScaleTop} numTicks={4} />
          <HoverOverlay width={xMax} height={yMaxTop} onMove={handleMouse} onLeave={handleLeave} />
        </Group>

        {/* Bottom pane: divergence histogram */}
        <Group left={MARGIN.left} top={topH + gap}>
          <GridRows scale={yScaleBottom} width={xMax} stroke={VX.grid} numTicks={3} />

          {data.map((d) => {
            const x = xScale(d.date) ?? 0
            const y0 = yScaleBottom(0)
            const yVal = yScaleBottom(d.divergence)
            const barH = Math.abs(yVal - y0)
            return (
              <rect
                key={d.date}
                x={x - barWidth / 2}
                y={d.divergence >= 0 ? yVal : y0}
                width={barWidth}
                height={barH}
                fill={d.divergence >= 0 ? VX.goodSolid : VX.badSolid}
                fillOpacity={divergenceOpacity}
                rx={1}
              />
            )
          })}

          <line x1={0} x2={xMax} y1={yScaleBottom(0)} y2={yScaleBottom(0)} stroke={VX.grid} />

          {syncedPoint && (
            <Crosshair x={xScale(syncedPoint.date) ?? 0} top={0} bottom={yMaxBottom} />
          )}

          <AxisLeftNumeric scale={yScaleBottom} numTicks={3} />
          <AxisBottomDate top={yMaxBottom} scale={xScale} tickValues={tickValues} />
          <HoverOverlay
            width={xMax}
            height={yMaxBottom}
            onMove={handleMouse}
            onLeave={handleLeave}
          />
        </Group>
      </svg>

      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader
              date={tip.data.date}
              label={formatDivergence(tip.data.divergence)}
              labelColor={tip.data.divergence >= 0 ? VX.goodSolid : VX.badSolid}
            />
            <TooltipBody>
              <TooltipRow
                color={VX.goodSolid}
                label="Short-term (7d)"
                value={tip.data.acute.toFixed(1)}
                shape="line"
                strokeWidth={2}
              />
              <TooltipRow
                color={VX.badSolid}
                label="Long-term (28d)"
                value={tip.data.chronic.toFixed(1)}
                shape="line"
                strokeWidth={3}
              />
              <TooltipRow
                color={tip.data.divergence >= 0 ? VX.goodSolid : VX.badSolid}
                label="Divergence"
                value={formatDivergence(tip.data.divergence)}
              />
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

function DivergenceChartFrame({
  data,
  highlighted,
}: {
  data: Point[]
  highlighted: string | null
}) {
  return (
    <ChartFrame
      series={[]}
      chartId={CHART_ID}
      height={CHART_HEIGHT}
      legend={false}
      ariaLabel="Short-term vs long-term training load, with the divergence between them"
    >
      {(plot) => (
        <DivergenceChartInner
          data={data}
          width={plot.width}
          height={plot.height}
          highlighted={highlighted}
        />
      )}
    </ChartFrame>
  )
}

export default function DivergenceChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(trainingLoadQueries.summary(params))
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const points = useMemo<Point[]>(() => {
    const out: Point[] = []
    for (const p of data.points as RawPoint[]) {
      if (p.acute === null || p.chronic === null || p.divergence === null) continue
      out.push({
        date: p.date,
        acute: p.acute,
        chronic: p.chronic,
        divergence: p.divergence,
      })
    }
    return applyVisibilityFilter(out, (p) => p.date)
  }, [data.points])

  const latest = points.length > 0 ? points[points.length - 1] : null

  const headerExtra = latest ? (
    <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: latest.divergence >= 0 ? VX.goodSolid : VX.badSolid,
        }}
      >
        {formatDivergence(latest.divergence)}
      </span>
      <span style={{ opacity: 0.55 }}>
        {latest.divergence >= 0
          ? `+${latest.divergence.toFixed(0)} ahead`
          : `${latest.divergence.toFixed(0)} behind`}
      </span>
    </span>
  ) : null

  return (
    <ChartCard
      title="Short vs Long Load"
      subtitle="Is load spiking or tapering?"
      tooltip={METRIC_TOOLTIPS.loadBalance}
      extra={headerExtra}
    >
      {points.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} />
      ) : (
        <DivergenceChartFrame data={points} highlighted={highlighted} />
      )}
      <ChartLegend
        items={[
          {
            key: 'acute',
            label: 'Short-term (7d)',
            color: VX.goodSolid,
            strokeWidth: 2,
            shape: 'line',
          },
          {
            key: 'chronic',
            label: 'Long-term (28d)',
            color: VX.badSolid,
            strokeWidth: 3,
            shape: 'line',
          },
          {
            key: 'divergence',
            label: 'Divergence',
            color: VX.goodSolid,
            secondColor: VX.badSolid,
            shape: 'split',
          },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
