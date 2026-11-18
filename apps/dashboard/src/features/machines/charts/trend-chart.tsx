import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { machinesQueries, type Machine } from '../../../lib/queries/machines'
import { machinesStore } from '../../../lib/window-stores'
import { LIMITS, RANGE_NOUN, formatPct, toneOf } from '../model'
import { silentBands, timeAxis } from './shared'

type Point = { x: Date; value: number | null }

const HEIGHT = 96

/** CPU (mean over all cores) or used memory of the selected machine, 0 to 100 %, silent stretches shaded. */
export function TrendChart({ machine, metric }: { machine: Machine; metric: 'cpu' | 'memory' }) {
  const { range } = machinesStore.useValues()
  const detail = useQuery(machinesQueries.detail(machine.host, range))
  const title = metric === 'cpu' ? 'CPU' : 'Memory'
  const read = (p: { cpuPct: number | null; memPct: number | null }) =>
    metric === 'cpu' ? p.cpuPct : p.memPct
  const points: Point[] = (detail.data?.points ?? []).map((p) => ({
    x: new Date(p.t * 1000),
    value: read(p),
  }))
  const peak = points.reduce<number | null>(
    (max, p) => (p.value !== null && (max === null || p.value > max) ? p.value : max),
    null,
  )
  const now = metric === 'cpu' ? machine.cpuPct : machine.memPct
  const tone = toneOf(now, metric === 'cpu' ? LIMITS.cpu : LIMITS.memory)
  const series: readonly ChartSeries<Point>[] = [
    {
      key: 'value',
      label: metric === 'cpu' ? 'CPU, all cores' : 'Memory used',
      color: VX.line,
      getValue: (d) => d.value,
      formatValue: (v) => `${v.toFixed(1)} %`,
      strokeWidth: 1.5,
      area: true,
    },
  ]
  const empty = detail.isSuccess && points.length === 0 ? 'No samples in this range' : undefined

  return (
    <ChartCard
      title={title}
      state={chartStateOf(detail, empty)}
      onRetry={() => void detail.refetch()}
      retrying={detail.isFetching}
      placeholderHeight={HEIGHT}
      facts={[
        {
          value: formatPct(now),
          unit: '%',
          period: `now · peak ${formatPct(peak)} % · ${RANGE_NOUN[range]}`,
          ...(tone && { tone }),
        },
      ]}
    >
      <Lines
        ariaLabel={`${machine.host} ${title}: percent, ${RANGE_NOUN[range]}`}
        data={points}
        height={HEIGHT}
        x={(d: Point) => d.x}
        series={series}
        y={{ domain: [0, 100], ticks: 3, format: (v) => `${v}%` }}
        xZones={silentBands(detail.data)}
        legend={false}
        {...timeAxis(detail.data)}
      />
    </ChartCard>
  )
}
