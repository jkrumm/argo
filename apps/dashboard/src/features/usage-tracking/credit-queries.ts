import { queryOptions } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../../lib/eden'
import type { Range } from '../../lib/queries/usage'

// The Credits tab's three reads (`/usage/credits/*`), kept beside the tab that owns them.

const fetchPools = async () => unwrap(await api.usage.credits.pools.get())
const fetchPicks = async (query: { range: Range }) =>
  unwrap(await api.usage.credits.picks.get({ query }))
const fetchCache = async (query: { range: Range }) =>
  unwrap(await api.usage.credits.cache.get({ query }))

export type CreditPoolsResponse = Awaited<ReturnType<typeof fetchPools>>
export type CreditPool = CreditPoolsResponse['pools'][number]
export type CreditPoint = CreditPool['points'][number]
export type CreditPicksResponse = Awaited<ReturnType<typeof fetchPicks>>
export type CreditCacheResponse = Awaited<ReturnType<typeof fetchCache>>
export type CreditCacheCaller = CreditCacheResponse['callers'][number]

export const creditQueries = {
  /** The pools are cycle-based: no range, always the current cycle. */
  pools: () =>
    queryOptions({
      queryKey: ['usage', 'credits', 'pools'] as const,
      queryFn: fetchPools,
      refetchInterval: 5 * 60_000,
    }),
  picks: (range: Range) =>
    queryOptions({
      queryKey: ['usage', 'credits', 'picks', range] as const,
      queryFn: () => fetchPicks({ range }),
    }),
  cache: (range: Range) =>
    queryOptions({
      queryKey: ['usage', 'credits', 'cache', range] as const,
      queryFn: () => fetchCache({ range }),
    }),
}
