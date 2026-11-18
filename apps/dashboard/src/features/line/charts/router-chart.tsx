import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { chartStateOf } from '../../../lib/chart-state'
import { lineQueries, type LineRouter } from '../../../lib/queries/line'
import { SERIES } from '../../../lib/series'
import { lineStore } from '../../../lib/window-stores'
import { WINDOW_NOUN, formatDb, formatMbit } from '../model'
import { outageBands, timeAxis } from './shared'

type Point = LineRouter['points'][number] & { x: number }

const HEIGHT = 96

const SYNC_SERIES: readonly ChartSeries<Point>[] = [
  {
    key: 'down',
    label: 'Down',
    color: SERIES.lineDown,
    getValue: (d) => d.syncDownMbit,
    formatValue: (v) => `${formatMbit(v)} Mbit/s`,
    strokeWidth: 1.5,
  },
  {
    key: 'up',
    label: 'Up',
    color: SERIES.lineUp,
    getValue: (d) => d.syncUpMbit,
    formatValue: (v) => `${formatMbit(v)} Mbit/s`,
    strokeWidth: 1.5,
  },
]

const NOISE_SERIES: readonly ChartSeries<Point>[] = [
  {
    key: 'down',
    label: 'Down',
    color: SERIES.lineDown,
    getValue: (d) => d.noiseDownDb,
    formatValue: (v) => `${formatDb(v)} dB`,
    strokeWidth: 1.5,
  },
  {
    key: 'up',
    label: 'Up',
    color: SERIES.lineUp,
    getValue: (d) => d.noiseUpDb,
    formatValue: (v) => `${formatDb(v)} dB`,
    strokeWidth: 1.5,
  },
]

type Metric = 'sync' | 'noise'

const COPY = {
  sync: {
    title: 'Sync rate',
    unit: 'Mbit/s',
    fact: (p: Point | undefined) => formatMbit(p?.syncDownMbit ?? null),
    aria: 'Router G.fast sync rate down and up in megabits per second',
    series: SYNC_SERIES,
    format: (v: number) => String(Math.round(v)),
  },
  noise: {
    title: 'Noise margin',
    unit: 'dB',
    fact: (p: Point | undefined) => formatDb(p?.noiseDownDb ?? null),
    aria: 'Router G.fast noise margin down and up in decibels',
    series: NOISE_SERIES,
    format: (v: number) => String(Math.round(v * 10) / 10),
  },
} as const

/** The line as the router measures it: sync rate or noise margin, down and up, outages shaded. */
export function RouterChart({ metric }: { metric: Metric }) {
  const { window } = lineStore.useValues()
  const router = useQuery(lineQueries.router(window))
  const uptime = useQuery(lineQueries.uptime(window))
  const copy = COPY[metric]
  const points: Point[] = (router.data?.points ?? []).map((p) => ({ ...p, x: p.t * 1000 }))
  const latest = points.findLast(
    (p) => (metric === 'sync' ? p.syncDownMbit : p.noiseDownDb) !== null,
  )
  const axis = timeAxis(router.data, window)
  const empty =
    router.isSuccess && points.length === 0 ? 'No router readings in this window' : undefined

  return (
    <ChartCard
      title={copy.title}
      state={chartStateOf(router, empty)}
      onRetry={() => void router.refetch()}
      retrying={router.isFetching}
      placeholderHeight={HEIGHT}
      facts={{
        value: copy.fact(latest),
        unit: copy.unit,
        period: 'down, latest reading',
      }}
    >
      <Lines
        ariaLabel={`${copy.aria}, ${WINDOW_NOUN[window]}`}
        data={points}
        height={HEIGHT}
        x={(d: Point) => d.x}
        series={copy.series}
        y={{
          ticks: 3,
          format: copy.format,
          autoMinCeil: 0,
        }}
        xDomain={axis.xDomain}
        xTicks={axis.xTicks}
        formatX={axis.formatX}
        cursorGroup={axis.cursorGroup}
        tooltip={axis.tooltip}
        xZones={outageBands(uptime.data)}
        legend={{ placement: 'header' }}
      />
    </ChartCard>
  )
}
