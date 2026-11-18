import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { lineQueries } from '../../../lib/queries/line'
import { SERIES } from '../../../lib/series'
import { lineStore } from '../../../lib/window-stores'
import { WINDOW_NOUN, formatLoss, formatMs, targetLabel } from '../model'
import { outageBands, timeAxis } from './shared'

type Point = { x: number; rtt: number | null; loss: number | null }

const HEIGHT = 96

const SERIES_DEF: readonly ChartSeries<Point>[] = [
  {
    key: 'rtt',
    label: 'Round trip',
    color: VX.line,
    getValue: (d) => d.rtt,
    formatValue: (v) => `${formatMs(v)} ms`,
    strokeWidth: 1.5,
  },
  {
    key: 'loss',
    label: 'Packet loss',
    color: SERIES.lineLoss,
    mark: 'bar',
    axis: 'right',
    getValue: (d) => d.loss,
    formatValue: (v) => `${formatLoss(v)} %`,
  },
]

/** One probe target: median round-trip time as a line, packet loss as red bars on the right axis, outages shaded. */
export function TargetChart({ target }: { target: string }) {
  const { window } = lineStore.useValues()
  const latency = useQuery(lineQueries.latency(window))
  const uptime = useQuery(lineQueries.uptime(window))
  const entry = latency.data?.targets.find((t) => t.target === target)
  const points: Point[] = (entry?.points ?? []).map((p) => ({
    x: p.t * 1000,
    rtt: p.rttMs,
    loss: p.lossPct,
  }))
  const loss = entry?.lossPct ?? null
  const axis = timeAxis(latency.data, window)
  const empty =
    latency.isSuccess && points.length === 0 ? 'No probe samples in this window' : undefined

  return (
    <ChartCard
      title={targetLabel(target)}
      state={chartStateOf(latency, empty)}
      onRetry={() => void latency.refetch()}
      retrying={latency.isFetching}
      placeholderHeight={HEIGHT}
      facts={[
        {
          value: formatMs(entry?.rttMs ?? null),
          unit: 'ms',
          period: `median round trip · ${WINDOW_NOUN[window]}`,
        },
        {
          value: formatLoss(loss),
          unit: '%',
          period: 'packet loss, right axis',
          ...(loss !== null && loss >= 1 && { tone: 'bad' as const }),
        },
      ]}
    >
      <Lines
        ariaLabel={`${targetLabel(target)}: median round-trip time in milliseconds and packet loss in percent, ${WINDOW_NOUN[window]}`}
        data={points}
        height={HEIGHT}
        x={(d: Point) => d.x}
        series={SERIES_DEF}
        y={{ ticks: 3, format: (v) => String(Math.round(v * 10) / 10) }}
        y2={{
          domain: 'auto',
          autoMaxFloor: 1,
          ticks: 2,
          format: (v) => `${Number(v.toFixed(1))}%`,
        }}
        xDomain={axis.xDomain}
        xTicks={axis.xTicks}
        formatX={axis.formatX}
        cursorGroup={axis.cursorGroup}
        tooltip={axis.tooltip}
        xZones={outageBands(uptime.data)}
        legend={false}
      />
    </ChartCard>
  )
}
