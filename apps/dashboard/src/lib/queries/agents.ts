import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

// Agent observation — the sideclaw overview snapshot Argo stores (see
// apps/api/src/routes/agents.ts). The feed is a push from the mini, so the
// page polls Argo on a one-minute cadence rather than the producer.

const POLL_MS = 60_000

async function fetchLatest() {
  return unwrap(await api.agents.overview.get({ query: {} }))
}

async function fetchHistory(hours: number) {
  return unwrap(await api.agents.overview.history.get({ query: { hours } }))
}

async function fetchNarratives() {
  return unwrap(await api.agents.narratives.get())
}

export type OverviewRecord = NonNullable<Awaited<ReturnType<typeof fetchLatest>>['latest']>
export type OverviewSnapshot = OverviewRecord['snapshot']
export type OverviewSummary = NonNullable<OverviewSnapshot['summary']>
export type OverviewProject = NonNullable<OverviewSnapshot['projects']>[number]
export type OverviewAgent = OverviewProject['agents'][number]
export type HumanQueueItem = NonNullable<OverviewSnapshot['humanQueue']>[number]
export type HistoryPoint = Awaited<ReturnType<typeof fetchHistory>>['data'][number]
export type Narrative = Awaited<ReturnType<typeof fetchNarratives>>['data'][number]

export const agentsQueries = {
  all: () => ['agents'] as const,
  latest: () =>
    queryOptions({
      queryKey: [...agentsQueries.all(), 'latest'] as const,
      queryFn: fetchLatest,
      refetchInterval: POLL_MS,
    }),
  history: (hours: number) =>
    queryOptions({
      queryKey: [...agentsQueries.all(), 'history', hours] as const,
      queryFn: () => fetchHistory(hours),
      refetchInterval: POLL_MS,
    }),
  narratives: () =>
    queryOptions({
      queryKey: [...agentsQueries.all(), 'narratives'] as const,
      queryFn: fetchNarratives,
      refetchInterval: POLL_MS,
    }),
}
