import { useMemo } from 'react'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  Crosshair,
  curveMonotoneX,
  deriveLegend,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  scaleBand,
  scaleLinear,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  useHoverSync,
  useTooltipStyles,
  VX,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import { fmtPercent100 } from '../formulas'
import type { HourlyPoint } from '../types'
import { ChartEmpty } from './empty'

const MARGIN = VX.margin
const CHART_ID = 'astro-cloud-layers'
// The 0 gridline is not the plot floor — a series pinned at 0% (a common outcome for "low cloud")
// draws as a visible line above the axis rule instead of merging with it.
const Y_DOMAIN: [number, number] = [-4, 100]
const Y_TICKS = 6

type CloudSeriesKey = 'cloudLow' | 'cloudMid' | 'cloudHigh'
type CloudSeriesDef = { key: CloudSeriesKey; label: string; strokeWidth: number; dash?: 'dashed' }

/**
 * Styled as a severity ramp, not three peers: low cloud is the thickest solid line (it ends a
 * night outright), mid a thinner solid line, high a dashed line (cirrus only costs contrast).
 * Distinct DASH, not just hue, so severity reads in greyscale too — the two near-identical
 * oranges the critic flagged were indistinguishable by shape alone.
 */
const SERIES_DEFS: CloudSeriesDef[] = [
  { key: 'cloudLow', label: 'Low cloud', strokeWidth: 2.5 },
  { key: 'cloudMid', label: 'Mid cloud', strokeWidth: 1.5 },
  { key: 'cloudHigh', label: 'High cloud', strokeWidth: 1.5, dash: 'dashed' },
]

function toSeriesStyle(def: CloudSeriesDef): SeriesStyle {
  return {
    key: def.key,
    label: def.label,
    color: SERIES[def.key],
    mark: 'line',
    strokeWidth: def.strokeWidth,
    ...(def.dash !== undefined && { dash: def.dash }),
  }
}

/**
 * The single value a series holds for the entire night, or null when it varies (or has any gap).
 * Used to move a flat line's story out of the plot and into the legend.
 */
function constantValue(hourly: HourlyPoint[], key: CloudSeriesDef['key']): number | null {
  const first = hourly[0]?.[key]
  if (first === null || first === undefined) return null
  return hourly.every((d) => d[key] === first) ? first : null
}

/**
 * Uses `d.localTime` as the x category, drawn with the SAME `scaleBand` construction and the SAME
 * tick-stride formula as `night-timeline-chart` (not the `MultiLine` kind's `scalePoint`, and not
 * an independent tick count) — the two charts must land a vertical line on the same instant, which
 * a differently-spaced band scale would silently break even given an identical domain array.
 *
 * A series with no data for the whole night is dropped from both the plot and the legend, rather
 * than drawn as an invisible line at a value no one asked about.
 */
export default function CloudLayersChart({ hourly }: { hourly: HourlyPoint[] }) {
  const presentDefs = SERIES_DEFS.filter((def) => hourly.some((d) => d[def.key] !== null))
  const legendDefs = presentDefs.map((def) => {
    const flat = constantValue(hourly, def.key)
    // A layer that holds one value all night draws as a straight line sitting on
    // a gridline, which reads as chart furniture rather than data — and for low
    // cloud, "0% all night" is the single best piece of news on the page. State
    // it in the legend instead of expecting the eye to find the line.
    return flat === null ? def : { ...def, label: `${def.label} — ${flat}% all night` }
  })

  return (
    <ChartCard title="Cloud Layers" tooltip={METRIC_TOOLTIPS.cloudLayers}>
      {presentDefs.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} message="No cloud data for this night" />
      ) : (
        <CloudLayersFrame hourly={hourly} presentDefs={presentDefs} />
      )}
      {presentDefs.length > 0 && (
        <ChartLegend items={deriveLegend(legendDefs.map(toSeriesStyle))} chartId={CHART_ID} />
      )}
    </ChartCard>
  )
}

function CloudLayersFrame({
  hourly,
  presentDefs,
}: {
  hourly: HourlyPoint[]
  presentDefs: CloudSeriesDef[]
}) {
  return (
    <ChartFrame
      series={presentDefs.map(toSeriesStyle)}
      chartId={CHART_ID}
      height={CHART_HEIGHT}
      legend={false}
      ariaLabel="Low, mid and high cloud cover across the night"
    >
      {(plot) => (
        <CloudLayersInner
          hourly={hourly}
          presentDefs={presentDefs}
          width={plot.width}
          height={plot.height}
        />
      )}
    </ChartFrame>
  )
}

function CloudLayersInner({
  hourly,
  presentDefs,
  width,
  height,
}: {
  hourly: HourlyPoint[]
  presentDefs: CloudSeriesDef[]
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () =>
      scaleBand<string>({ domain: hourly.map((h) => h.localTime), range: [0, xMax], padding: 0 }),
    [hourly, xMax],
  )
  const yScale = useMemo(() => scaleLinear<number>({ domain: Y_DOMAIN, range: [yMax, 0] }), [yMax])

  const bandwidth = xScale.bandwidth()
  const bandCenter = (localTime: string) => (xScale(localTime) ?? 0) + bandwidth / 2

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<HourlyPoint>({
      data: hourly,
      chartId: CHART_ID,
      getKey: (d) => d.localTime,
      xScale: bandCenter,
      marginLeft: MARGIN.left,
    })

  // Same stride formula as `night-timeline-chart`, over the same `hourly` array — identical tick
  // positions and tick count, so a vertical line through both charts lands on the same instant.
  const tickStride = Math.max(1, Math.round(hourly.length / 7))
  const tickValues = hourly.filter((_, i) => i % tickStride === 0).map((h) => h.localTime)

  const seriesPoints = presentDefs.map((def) => ({
    def,
    points: hourly.filter((d) => d[def.key] !== null),
  }))

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={Y_TICKS} />

          {seriesPoints.map(({ def, points }) => (
            <LinePath<HourlyPoint>
              key={def.key}
              data={points}
              x={(d) => bandCenter(d.localTime)}
              y={(d) => yScale(d[def.key] ?? 0)}
              stroke={SERIES[def.key]}
              strokeWidth={def.strokeWidth}
              strokeDasharray={def.dash === 'dashed' ? VX.dashArray : undefined}
              curve={curveMonotoneX}
            />
          ))}

          {syncedPoint && (
            <>
              <Crosshair x={bandCenter(syncedPoint.localTime)} top={0} bottom={yMax} />
              {presentDefs.map((def) => {
                const v = syncedPoint[def.key]
                if (v === null) return null
                return (
                  <circle
                    key={def.key}
                    cx={bandCenter(syncedPoint.localTime)}
                    cy={yScale(v)}
                    r={4}
                    fill={SERIES[def.key]}
                    stroke={VX.dotStroke}
                    strokeWidth={2}
                  />
                )
              })}
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={Y_TICKS} tickFormat={(v) => `${v}%`} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />

          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.localTime} />
            <TooltipBody>
              {presentDefs.map((def) => (
                <TooltipRow
                  key={def.key}
                  color={SERIES[def.key]}
                  label={def.label}
                  value={fmtPercent100(tip.data[def.key])}
                  shape="line"
                  strokeWidth={def.strokeWidth}
                  dashed={def.dash === 'dashed'}
                />
              ))}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}
