import { useMemo } from 'react'
import { Box } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AreaClosed,
  AreaGradient,
  areaFillUrl,
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
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
  smartTicks,
  useChartSize,
  useHoverSync,
  useTooltipStyles,
  type LegendEntry,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import {
  skinfoldLogQueries,
  type SkinfoldSite,
  type SkinfoldWindowParams,
} from '../../../lib/queries/skinfold-log'
import { METRIC_TOOLTIPS, SKINFOLD_SITES } from '../constants'
import { skinfoldSiteLabel } from '../formulas'
import { ChartEmpty } from './empty'

type ApiPoint = {
  date: string
  average: number
  readings: { site: SkinfoldSite; valueMm: number }[]
}

type ChartPoint = {
  date: string
  average: number
  bySite: Partial<Record<SkinfoldSite, number>>
}

const MARGIN = { top: 16, right: 24, bottom: 32, left: 44 }
const CHART_HEIGHT = 260
const AREA_ID = 'skinfold-average-area'

const SITE_COLORS: Record<SkinfoldSite, string> = {
  abdominal: SERIES.skinfoldAbdominal,
  suprailiac: SERIES.skinfoldSuprailiac,
}

function toChartPoints(points: ApiPoint[]): ChartPoint[] {
  return points
    .toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((p) => {
      const bySite: Partial<Record<SkinfoldSite, number>> = {}
      for (const r of p.readings) bySite[r.site] = r.valueMm
      return { date: p.date, average: p.average, bySite }
    })
}

function SkinfoldChartInner({
  data,
  width,
  height,
}: {
  data: ChartPoint[]
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.4 }),
    [data, xMax],
  )

  const yScale = useMemo(() => {
    const vals: number[] = []
    for (const pt of data) {
      vals.push(pt.average)
      for (const site of SKINFOLD_SITES) {
        const v = pt.bySite[site.key]
        if (v !== undefined) vals.push(v)
      }
    }
    if (vals.length === 0) return scaleLinear<number>({ domain: [0, 50], range: [yMax, 0] })
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.2, 1)
    return scaleLinear<number>({
      domain: [Math.max(min - pad, 0), max + pad],
      range: [yMax, 0],
      nice: true,
    })
  }, [data, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<ChartPoint>({
      data,
      chartId: 'skinfold',
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

  const dotR = data.length > 60 ? 2.5 : data.length > 20 ? 3.5 : 4.5

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <defs>
            <AreaGradient id={AREA_ID} color={VX.line} />
          </defs>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          <AreaClosed<ChartPoint>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.average)}
            yScale={yScale}
            curve={curveMonotoneX}
            fill={areaFillUrl(AREA_ID)}
          />

          {/* Per-site lines — thinner, distinct categorical colors */}
          {SKINFOLD_SITES.map((site) => {
            const pts = data.filter((d) => d.bySite[site.key] !== undefined)
            if (pts.length === 0) return null
            return (
              <LinePath<ChartPoint>
                key={site.key}
                data={pts}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.bySite[site.key] as number)}
                stroke={SITE_COLORS[site.key]}
                strokeWidth={1.75}
                curve={curveMonotoneX}
              />
            )
          })}

          {/* Bold average line — the belly-fat trend, primary emphasis */}
          <LinePath<ChartPoint>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.average)}
            stroke={VX.line}
            strokeWidth={3}
            curve={curveMonotoneX}
          />

          {/* Dots per data point */}
          {SKINFOLD_SITES.map((site) =>
            data
              .filter((d) => d.bySite[site.key] !== undefined)
              .map((d) => (
                <circle
                  key={`dot-${site.key}-${d.date}`}
                  cx={xScale(d.date) ?? 0}
                  cy={yScale(d.bySite[site.key] as number)}
                  r={dotR - 1}
                  fill={SITE_COLORS[site.key]}
                  stroke={VX.dotStroke}
                  strokeWidth={1}
                />
              )),
          )}
          {data.map((d) => (
            <circle
              key={`dot-average-${d.date}`}
              cx={xScale(d.date) ?? 0}
              cy={yScale(d.average)}
              r={dotR}
              fill={VX.line}
              stroke={VX.dotStroke}
              strokeWidth={1.5}
            />
          ))}

          {syncedPoint !== null && (
            <>
              <line
                x1={xScale(syncedPoint.date) ?? 0}
                x2={xScale(syncedPoint.date) ?? 0}
                y1={0}
                y2={yMax}
                stroke={VX.crosshair}
                strokeWidth={1}
              />
              <circle
                cx={xScale(syncedPoint.date) ?? 0}
                cy={yScale(syncedPoint.average)}
                r={VX.dotR}
                fill={VX.line}
                stroke={VX.dotStroke}
                strokeWidth={2}
              />
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={5} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              <TooltipRow
                color={VX.line}
                label="Average"
                value={`${tip.data.average.toFixed(1)} mm`}
                shape="line"
                strokeWidth={3}
              />
              {SKINFOLD_SITES.map((site) => {
                const v = tip.data.bySite[site.key]
                if (v === undefined) return null
                return (
                  <TooltipRow
                    key={site.key}
                    color={SITE_COLORS[site.key]}
                    label={site.label}
                    value={`${v.toFixed(1)} mm`}
                    shape="line"
                    strokeWidth={1.75}
                  />
                )
              })}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

export default function SkinfoldChart({ params }: { params: SkinfoldWindowParams }) {
  const { data } = useSuspenseQuery(skinfoldLogQueries.series(params))
  const { ref, width } = useChartSize()

  const apiPoints = data.points as ApiPoint[]
  const chartData = useMemo(() => toChartPoints(apiPoints), [apiPoints])
  const latest = chartData[chartData.length - 1] ?? null

  const headerExtra = latest ? (
    <span style={{ fontSize: VX.text.xs }}>
      <span style={{ fontWeight: 600, fontSize: VX.text.md }}>{latest.average.toFixed(1)} mm</span>
      <Box component="span" ml={4} style={{ opacity: 0.5 }}>
        avg
      </Box>
    </span>
  ) : null

  const legendItems: LegendEntry[] = [
    { key: 'average', label: 'Average', color: VX.line, strokeWidth: 3, shape: 'line' },
    ...SKINFOLD_SITES.map((site) => ({
      key: site.key,
      label: skinfoldSiteLabel(site.key),
      color: SITE_COLORS[site.key],
      strokeWidth: 1.75,
      shape: 'line' as const,
    })),
  ]

  return (
    <ChartCard
      title="Skinfold / Belly Fat"
      subtitle="Am I trending leaner?"
      tooltip={METRIC_TOOLTIPS.skinfoldChart}
      extra={headerExtra}
    >
      <Box ref={ref} h={CHART_HEIGHT} w="100%">
        {chartData.length === 0 ? (
          <ChartEmpty
            height={CHART_HEIGHT}
            message="No readings yet — log your first caliper session to start the trend."
          />
        ) : width > 0 ? (
          <SkinfoldChartInner data={chartData} width={Math.max(width, 200)} height={CHART_HEIGHT} />
        ) : null}
      </Box>
      <ChartLegend items={legendItems} highlighted={null} onHighlight={() => {}} />
    </ChartCard>
  )
}
