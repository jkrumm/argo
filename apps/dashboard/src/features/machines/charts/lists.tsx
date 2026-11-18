import { useQuery } from '@tanstack/react-query'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { chartStateOf } from '../../../lib/chart-state'
import { machinesQueries, type Machine } from '../../../lib/queries/machines'
import { machinesStore } from '../../../lib/window-stores'
import { LIMITS, formatMemory, formatPct, toneOf } from '../model'

/** Fill of every mount now, fullest first; the card's headline is the fullest, coloured when it needs the eye. */
export function FilesystemsCard({ machine }: { machine: Machine }) {
  const { range } = machinesStore.useValues()
  const detail = useQuery(machinesQueries.detail(machine.host, range))
  const mounts = detail.data?.filesystems ?? []
  const fullest = mounts[0]
  const tone = toneOf(fullest?.pct ?? null, LIMITS.disk)
  const empty = detail.isSuccess && mounts.length === 0 ? 'No filesystem reading' : undefined

  return (
    <ChartCard
      title="Filesystems"
      state={chartStateOf(detail, empty)}
      onRetry={() => void detail.refetch()}
      retrying={detail.isFetching}
      placeholderHeight={96}
      facts={[
        {
          value: formatPct(fullest?.pct ?? null),
          unit: '%',
          period: fullest ? `fullest · ${fullest.mount}` : 'fullest',
          ...(tone && { tone }),
        },
      ]}
    >
      <BarList
        label={`${machine.host} filesystem fill in percent`}
        max={100}
        items={mounts.map((m) => ({ key: m.mount, label: m.mount, value: m.pct }))}
        format={(v) => `${Math.round(v)} %`}
      />
    </ChartCard>
  )
}

/** The top containers by CPU over the last 5 minutes, with memory beside; the card exists on Docker hosts only. */
export function ContainersCard({ machine }: { machine: Machine }) {
  const { range } = machinesStore.useValues()
  const detail = useQuery(machinesQueries.detail(machine.host, range))
  const containers = detail.data?.containers ?? []
  if (detail.isSuccess && containers.length === 0) return null

  return (
    <ChartCard
      title="Containers"
      state={chartStateOf(detail, undefined)}
      onRetry={() => void detail.refetch()}
      retrying={detail.isFetching}
      placeholderHeight={96}
      facts={[{ value: String(containers.length), period: 'top by CPU · last 5 min' }]}
    >
      <BarList
        label={`${machine.host} containers by CPU in percent`}
        items={containers.map((c) => ({
          key: c.name,
          label: c.name,
          value: c.cpuPct,
          secondary: formatMemory(c.memBytes),
        }))}
        format={(v) => `${v.toFixed(1)} %`}
      />
    </ChartCard>
  )
}
