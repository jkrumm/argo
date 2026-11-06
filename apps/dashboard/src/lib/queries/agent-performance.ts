import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

// Agent performance — what the subagents, factory workers and Issues cost (read from Argo's usage
// read model) and how good the reviews are (an `agw review stats` snapshot agent-workflows pushes).
// Both change slowly, so the page polls Argo every five minutes.

const POLL_MS = 5 * 60_000

async function fetchUsage(weeks: number) {
  return unwrap(await api.agents.kpis.usage.get({ query: { weeks } }))
}

async function fetchReviewStats() {
  return unwrap(await api.agents['review-stats'].get({ query: {} }))
}

export type UsageKpis = Awaited<ReturnType<typeof fetchUsage>>
export type ReviewStatsRecord = NonNullable<Awaited<ReturnType<typeof fetchReviewStats>>['latest']>

export const agentPerformanceQueries = {
  all: () => ['agent-performance'] as const,
  usage: (weeks: number) =>
    queryOptions({
      queryKey: [...agentPerformanceQueries.all(), 'usage', weeks] as const,
      queryFn: () => fetchUsage(weeks),
      refetchInterval: POLL_MS,
    }),
  reviewStats: () =>
    queryOptions({
      queryKey: [...agentPerformanceQueries.all(), 'review-stats'] as const,
      queryFn: fetchReviewStats,
      refetchInterval: POLL_MS,
    }),
}
