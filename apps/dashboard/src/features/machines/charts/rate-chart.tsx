import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { machinesQueries, type Machine } from '../../../lib/queries/machines'
import { machinesStore } from '../../../lib/window-stores'
import { RANGE_NOUN, formatRate } from '../model'
import { silentBands, timeAxis } from './shared'

type Point = { x: Date; inBps: number | null; outBps: number | null }

const HEIGHT = 96

const KINDS = {
  network: {
    title: 'Network',
    inLabel: 'In',
    outLabel: 'Out',
    inArrow: '↓',
    outArrow: '↑',
  },
  disk: {
    title: 'Disk IO',
    inLabel: 'Read',
    outLabel: 'Write',
    inArrow: 'read',
    outArrow: 'write',
  },
} as const

const series = (kind: keyof typeof KINDS): readonly ChartSeries<Point>[] => [
  {
    key: 'in',
    label: KINDS[kind].inLabel,
    color: VX.line,
    getValue: (d) => d.inBps,
    formatValue: formatRate,
    strokeWidth: 1.5,
  },
  {
    key: 'out',
    label: KINDS[kind].outLabel,
    color: VX.line2,
    getValue: (d) => d.outBps,
    formatValue: formatRate,
    strokeWidth: 1.5,
  },
]

/** Bytes per second in two neutral lines, summed over physical interfaces (network) or devices (disk IO). */
export function RateChart({ machine, kind }: { machine: Machine; kind: keyof typeof KINDS }) {
  const { range } = machinesStore.useValues()
  const detail = useQuery(machinesQueries.detail(machine.host, range))
  const k = KINDS[kind]
  const raw = detail.data?.points ?? []
  const points: Point[] = raw.map((p) => ({
    x: new Date(p.t * 1000),
    inBps: kind === 'network' ? p.netInBps : p.diskReadBps,
    outBps: kind === 'network' ? p.netOutBps : p.diskWriteBps,
  }))
  const newest = points.findLast((p) => p.inBps !== null || p.outBps !== null)
  const nowIn =
    machine.state === 'silent'
      ? null
      : kind === 'network'
        ? machine.netInBps
        : (newest?.inBps ?? null)
  const nowOut =
    machine.state === 'silent'
      ? null
      : kind === 'network'
        ? machine.netOutBps
        : (newest?.outBps ?? null)
  const empty =
    detail.isSuccess && points.every((p) => p.inBps === null && p.outBps === null)
      ? 'No samples in this range'
      : undefined

  return (
    <ChartCard
      title={k.title}
      state={chartStateOf(detail, empty)}
      onRetry={() => void detail.refetch()}
      retrying={detail.isFetching}
      placeholderHeight={HEIGHT}
      facts={[
        {
          value: formatRate(nowIn),
          unit: k.inArrow,
          period: `${formatRate(nowOut)} ${k.outArrow} · now · ${RANGE_NOUN[range]}`,
        },
      ]}
    >
      <Lines
        ariaLabel={`${machine.host} ${k.title}: ${k.inLabel} and ${k.outLabel} in bytes per second, ${RANGE_NOUN[range]}`}
        data={points}
        height={HEIGHT}
        x={(d: Point) => d.x}
        series={series(kind)}
        y={{ ticks: 3, format: formatRate }}
        xZones={silentBands(detail.data)}
        legend={false}
        {...timeAxis(detail.data)}
      />
    </ChartCard>
  )
}
