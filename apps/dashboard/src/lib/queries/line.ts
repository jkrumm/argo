import { queryOptions } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../eden'

export type LineWindow = '24h' | '7d' | '30d' | '90d'

const fetchNow = async () => unwrap(await api.line.now.get())
const fetchUptime = async (window: LineWindow) =>
  unwrap(await api.line.uptime.get({ query: { window } }))
const fetchLatency = async (window: LineWindow) =>
  unwrap(await api.line.latency.get({ query: { window } }))
const fetchRouter = async (window: LineWindow) =>
  unwrap(await api.line.router.get({ query: { window } }))
const fetchSpeedtests = async (window: LineWindow) =>
  unwrap(await api.line.speedtests.get({ query: { window } }))

export type LineNow = Awaited<ReturnType<typeof fetchNow>>
export type LineUptime = Awaited<ReturnType<typeof fetchUptime>>
export type LineLatency = Awaited<ReturnType<typeof fetchLatency>>
export type LineRouter = Awaited<ReturnType<typeof fetchRouter>>
export type LineSpeedtests = Awaited<ReturnType<typeof fetchSpeedtests>>

/** One card, one query: a ClickHouse failure on one of them is that card's error state and nothing else's. */
export const lineQueries = {
  all: () => ['line'] as const,

  now: () =>
    queryOptions({
      queryKey: [...lineQueries.all(), 'now'] as const,
      queryFn: fetchNow,
      refetchInterval: 60_000,
    }),

  uptime: (window: LineWindow) =>
    queryOptions({
      queryKey: [...lineQueries.all(), 'uptime', window] as const,
      queryFn: () => fetchUptime(window),
      refetchInterval: 300_000,
    }),

  latency: (window: LineWindow) =>
    queryOptions({
      queryKey: [...lineQueries.all(), 'latency', window] as const,
      queryFn: () => fetchLatency(window),
      refetchInterval: 300_000,
    }),

  router: (window: LineWindow) =>
    queryOptions({
      queryKey: [...lineQueries.all(), 'router', window] as const,
      queryFn: () => fetchRouter(window),
      refetchInterval: 300_000,
    }),

  speedtests: (window: LineWindow) =>
    queryOptions({
      queryKey: [...lineQueries.all(), 'speedtests', window] as const,
      queryFn: () => fetchSpeedtests(window),
      refetchInterval: 300_000,
    }),
}
