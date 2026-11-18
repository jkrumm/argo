import { queryOptions } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../eden'

export type MachineRange = '1h' | '24h' | '7d' | '30d'

const fetchOverview = async (range: MachineRange) =>
  unwrap(await api.machines.overview.get({ query: { range } }))
const fetchDetail = async (host: string, range: MachineRange) =>
  unwrap(await api.machines.detail.get({ query: { host, range } }))

export type MachinesOverview = Awaited<ReturnType<typeof fetchOverview>>
export type Machine = MachinesOverview['machines'][number]
export type MachineDetail = Awaited<ReturnType<typeof fetchDetail>>

/** The list and the selected machine's charts are two queries: one failing is one error state. */
export const machinesQueries = {
  all: () => ['machines'] as const,

  overview: (range: MachineRange) =>
    queryOptions({
      queryKey: [...machinesQueries.all(), 'overview', range] as const,
      queryFn: () => fetchOverview(range),
      refetchInterval: 60_000,
    }),

  detail: (host: string, range: MachineRange) =>
    queryOptions({
      queryKey: [...machinesQueries.all(), 'detail', host, range] as const,
      queryFn: () => fetchDetail(host, range),
      refetchInterval: 60_000,
    }),
}
