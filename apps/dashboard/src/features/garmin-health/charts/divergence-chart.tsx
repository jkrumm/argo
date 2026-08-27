import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Group as MantineGroup } from '@mantine/core'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartFrame,
  ChartLegend,
  ChartTooltipFloat,
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
  autoMargin,
  curveMonotoneX,
  deriveLegend,
  deriveTooltipRows,
  fmtAxisDate,
  probeAxisLabels,
  scaleLinear,
  scalePoint,
  smartTicks,
  useChartCursor,
  type ChartSeries,
  type LegendEntry,
  type PlotRect,
} from 'basalt-ui/charts'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

const CHART_HEIGHT = 280
const CHART_ID = 'divergence'
const PANE_GAP = 12
const TOP_FRACTION = 0.7
const ARIA_LABEL = 'Short-term vs long-term training load, with the divergence between them'

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

const formatLoad = (v: number): string => v.toFixed(1)

const DIVERGENCE_SERIES: ChartSeries<Point>[] = [
  {
    key: 'acute',
    label: 'Short-term (7d)',
    color: VX.goodSolid,
    mark: 'line',
    strokeWidth: 2,
    getValue: (d) => d.acute,
    formatValue: formatLoad,
  },
  {
    key: 'chronic',
    label: 'Long-term (28d)',
    color: VX.badSolid,
    mark: 'line',
    strokeWidth: 3,
    getValue: (d) => d.chronic,
    formatValue: formatLoad,
  },
]

// `split` shape + `secondColor` have no `SeriesStyle`/`mark` equivalent (deriveLegend can only
// emit 'line' | 'bar' swatches), so the diverging-color entry is authored directly as a
// `LegendEntry` and appended after the two `deriveLegend`-derived series entries.
const DIVERGENCE_SPLIT_ENTRY: LegendEntry = {
  key: 'divergence',
  label: 'Divergence',
  color: VX.goodSolid,
  secondColor: VX.badSolid,
  shape: 'split',
}

const DIVERGENCE_LEGEND_ITEMS: LegendEntry[] = [
  ...deriveLegend(DIVERGENCE_SERIES),
  DIVERGENCE_SPLIT_ENTRY,
]

/**
 * theme-allow-file hand-rolled-plot — TWO panes over one x scale is not a single cartesian plot,
 * so `CartesianChart` (one plot rect, one or two y axes) cannot express it. File scope, not node
 * scope: this file is that one chart and every assembly primitive in it belongs to the same
 * decision — there is no second, properly-composed chart here for a narrower waiver to protect.
 *
 * Bespoke composition (dual-pane line + signed-histogram with a DIVERGING two-tone fill-between —
 * `basalt-ui`'s `DualPanel.fillBetween` only accepts a single fill color, so it can't express
 * "green when acute < chronic, red when acute > chronic". Composes `ChartFrame` + `useChartCursor`
 * directly, assembled from the same parts every other chart gets — `autoMargin` +
 * `probeAxisLabels`, `useChartCursor`, `ChartTooltipFloat`.
 */
function DivergencePlot({
  data,
  plot,
  highlighted,
}: {
  data: Point[]
  plot: PlotRect
  highlighted: string | null
}) {
  const topDomain = useMemo<[number, number]>(() => {
    const loadMax = Math.max(...data.map((d) => Math.max(d.acute, d.chronic)), 1)
    return [0, loadMax * 1.1]
  }, [data])

  const bottomDomain = useMemo<[number, number]>(() => {
    const extent = Math.max(...data.map((d) => Math.abs(d.divergence)), 1)
    return [-extent, extent]
  }, [data])

  const { labels: topLabels, format: topFormat } = useMemo(
    () => probeAxisLabels({ domain: topDomain, ticks: 4, nice: true }),
    [topDomain],
  )
  const { labels: bottomLabels, format: bottomFormat } = useMemo(
    () => probeAxisLabels({ domain: bottomDomain, ticks: 3, nice: true }),
    [bottomDomain],
  )
  const xLabels = useMemo(() => data.map((d) => fmtAxisDate(d.date)), [data])

  const margin = useMemo(
    () => autoMargin({ left: [...topLabels, ...bottomLabels], bottom: xLabels }),
    [topLabels, bottomLabels, xLabels],
  )

  const xMax = Math.max(plot.width - margin.left - margin.right, 0)
  const paneH = plot.height - margin.top - margin.bottom - PANE_GAP
  const topH = Math.max(Math.round(paneH * TOP_FRACTION), 1)
  const bottomH = Math.max(paneH - topH, 1)

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )
  const topYScale = useMemo(
    () => scaleLinear<number>({ domain: topDomain, range: [topH, 0], nice: true }),
    [topDomain, topH],
  )
  const bottomYScale = useMemo(
    () => scaleLinear<number>({ domain: bottomDomain, range: [bottomH, 0], nice: true }),
    [bottomDomain, bottomH],
  )

  const cursor = useChartCursor<Point>({
    data,
    chartId: CHART_ID,
    getKey: (d) => d.date,
    xScale,
    marginLeft: margin.left,
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

  const point = cursor.point
  const sx = point === null ? 0 : (xScale(point.date) ?? 0)

  return (
    <>
      <svg width={plot.width} height={plot.height}>
        {/* Top pane: acute + chronic load with fill-between */}
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={topYScale} width={xMax} stroke={VX.grid} numTicks={4} />

          <Threshold<Point>
            id="divergence-signal-fill"
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y0={(d) => topYScale(d.chronic)}
            y1={(d) => topYScale(d.acute)}
            clipAboveTo={0}
            clipBelowTo={topH}
            curve={curveMonotoneX}
            belowAreaProps={{ fill: VX.good }}
            aboveAreaProps={{ fill: VX.bad }}
          />

          <LinePath<Point>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => topYScale(d.acute)}
            stroke={VX.goodSolid}
            strokeWidth={2}
            strokeOpacity={acuteOpacity}
            curve={curveMonotoneX}
          />

          <LinePath<Point>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => topYScale(d.chronic)}
            stroke={VX.badSolid}
            strokeWidth={3}
            strokeOpacity={chronicOpacity}
            curve={curveMonotoneX}
          />

          {point !== null && (
            <>
              <Crosshair x={sx} top={0} bottom={topH} />
              <SeriesDot cx={sx} cy={topYScale(point.acute)} color={VX.goodSolid} />
              <SeriesDot cx={sx} cy={topYScale(point.chronic)} color={VX.badSolid} />
            </>
          )}

          <AxisLeftNumeric scale={topYScale} numTicks={4} tickFormat={topFormat} />
          <HoverOverlay
            width={xMax}
            height={topH + PANE_GAP}
            onMove={cursor.onPointerMove}
            onLeave={cursor.onPointerLeave}
            onKeyDown={cursor.onKeyDown}
            onBlur={cursor.onBlur}
            ariaLabel={ARIA_LABEL}
            valueMax={Math.max(data.length - 1, 0)}
            {...(point !== null && {
              valueNow: data.indexOf(point),
              valueText: fmtAxisDate(point.date),
            })}
          />
        </Group>

        {/* Bottom pane: divergence histogram */}
        <Group left={margin.left} top={margin.top + topH + PANE_GAP}>
          <GridRows scale={bottomYScale} width={xMax} stroke={VX.grid} numTicks={3} />

          {data.map((d) => {
            const x = xScale(d.date) ?? 0
            const y0 = bottomYScale(0)
            const yVal = bottomYScale(d.divergence)
            return (
              <rect
                key={d.date}
                x={x - barWidth / 2}
                y={d.divergence >= 0 ? yVal : y0}
                width={barWidth}
                height={Math.abs(yVal - y0)}
                fill={d.divergence >= 0 ? VX.goodSolid : VX.badSolid}
                fillOpacity={divergenceOpacity}
                rx={1}
              />
            )
          })}

          <line x1={0} x2={xMax} y1={bottomYScale(0)} y2={bottomYScale(0)} stroke={VX.grid} />

          {point !== null && <Crosshair x={sx} top={0} bottom={bottomH} />}

          <AxisLeftNumeric scale={bottomYScale} numTicks={3} tickFormat={bottomFormat} />
          <AxisBottomDate top={bottomH} scale={xScale} tickValues={tickValues} />
          {/* Pointer only — the top overlay owns the keyboard, so one chart is one tab stop. */}
          <HoverOverlay
            width={xMax}
            height={bottomH + margin.bottom}
            onMove={cursor.onPointerMove}
            onLeave={cursor.onPointerLeave}
          />
        </Group>
      </svg>

      {cursor.isSource && point !== null && (
        <ChartTooltipFloat anchor={cursor.anchor}>
          <TooltipHeader
            date={point.date}
            label={formatDivergence(point.divergence)}
            labelColor={point.divergence >= 0 ? VX.goodSolid : VX.badSolid}
          />
          <TooltipBody>
            {deriveTooltipRows(DIVERGENCE_SERIES, point, formatLoad).map((row) => (
              <TooltipRow
                key={row.key}
                color={row.color}
                label={row.label}
                value={row.value}
                shape={row.shape}
                dashed={row.dashed}
                {...(row.strokeWidth !== undefined && { strokeWidth: row.strokeWidth })}
              />
            ))}
            <TooltipRow
              color={point.divergence >= 0 ? VX.goodSolid : VX.badSolid}
              label="Divergence"
              value={formatDivergence(point.divergence)}
            />
          </TooltipBody>
        </ChartTooltipFloat>
      )}
    </>
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
    <MantineGroup gap={6} align="baseline" wrap="nowrap" style={{ fontSize: VX.text.xs }}>
      <span
        style={{
          fontSize: VX.text.md,
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
    </MantineGroup>
  ) : null

  return (
    <ChartCard
      title="Short vs Long Load"
      subtitle="Is load spiking or tapering?"
      info={METRIC_TOOLTIPS.loadBalance}
      actions={headerExtra}
    >
      {points.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} />
      ) : (
        <ChartFrame
          series={DIVERGENCE_SERIES}
          chartId={CHART_ID}
          height={CHART_HEIGHT}
          legend={false}
          ariaLabel={ARIA_LABEL}
        >
          {(plot) => <DivergencePlot data={points} plot={plot} highlighted={highlighted} />}
        </ChartFrame>
      )}
      <ChartLegend
        items={DIVERGENCE_LEGEND_ITEMS}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
