import { Elysia } from 'elysia'
import { z } from 'zod'
import { clickhouse, type ClickHouse } from '../clients/clickhouse.js'
import { log } from '../telemetry.js'
import {
  MACHINE_RANGES,
  machineDetail,
  machineWindow,
  machinesOverview,
} from '../lib/machines-queries.js'

/**
 * `/machines/*` — host and container metrics of every machine, read from ClickStack's ClickHouse where
 * the host agents export them. Two endpoints: the overview (one entry per machine) and one machine's
 * detail, so one failing query is one error state on the page. Every query is a named function in
 * `lib/machines-queries.ts`; a request picks a `range` from a closed set and a host name that only ever
 * reaches ClickHouse as a placeholder value. ClickHouse unconfigured, unreachable or erroring answers 503.
 */

const UNAVAILABLE = { error: 'machine data unavailable' }

const ErrorSchema = z.object({ error: z.string() })

const RangeQuery = z.object({
  range: z.enum(MACHINE_RANGES).default('24h').describe('Look-back from now: 1h, 24h, 7d or 30d.'),
})

const DetailQuery = RangeQuery.extend({
  host: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .describe('host.name of a machine from the overview.'),
})

const RangeShape = {
  range: z.enum(MACHINE_RANGES),
  from: z.number().int().describe('Unix seconds, snapped down to a bucket edge.'),
  to: z.number().int().describe('Unix seconds, now.'),
  step: z.number().int().describe('Bucket width in seconds.'),
}

const State = z.enum(['reporting', 'silent'])

const PointShape = {
  t: z.number().int().describe('Unix seconds of the bucket start.'),
  cpuPct: z.number().nullable(),
  memPct: z.number().nullable(),
  netInBps: z.number().nullable().describe('Bytes per second received.'),
  netOutBps: z.number().nullable().describe('Bytes per second transmitted.'),
}

const OverviewSchema = z.object({
  ...RangeShape,
  machines: z.array(
    z.object({
      host: z.string(),
      state: State.describe('silent: no sample for 10 minutes; the current values are then null.'),
      lastSeen: z.number().int().describe('Unix seconds of the newest sample.'),
      reportingPct: z
        .number()
        .nullable()
        .describe('Share of buckets with a sample over the range, since the first one in it.'),
      cores: z.number().nullable(),
      cpuPct: z.number().nullable().describe('Mean over all cores, 0-100.'),
      memPct: z.number().nullable().describe('Used memory, 0-100.'),
      load1: z.number().nullable().describe('1-minute load average, not divided by cores.'),
      fullestFilesystem: z.object({ mount: z.string(), pct: z.number() }).nullable(),
      netInBps: z.number().nullable(),
      netOutBps: z.number().nullable(),
      points: z.array(z.object(PointShape)),
    }),
  ),
})

const DetailSchema = z.object({
  ...RangeShape,
  host: z.string(),
  state: State,
  lastSeen: z.number().int(),
  points: z.array(
    z.object({
      ...PointShape,
      diskReadBps: z.number().nullable(),
      diskWriteBps: z.number().nullable(),
    }),
  ),
  gaps: z.array(z.object({ from: z.number().int(), to: z.number().int() })),
  filesystems: z.array(z.object({ mount: z.string(), type: z.string(), pct: z.number() })),
  containers: z.array(
    z.object({ name: z.string(), cpuPct: z.number(), memBytes: z.number().nullable() }),
  ),
})

/** The read's result, or null (logged) when ClickHouse is unconfigured, unreachable or errored. */
async function attempt<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    log.warn('machines: read failed', {
      endpoint: name,
      'error.message': error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}

const detail = (summary: string, description: string) => ({
  tags: ['Machines'],
  summary,
  description,
  security: [{ BearerAuth: [] }],
})

export type MachinesRoutesConfig = { ch: ClickHouse; now?: () => number }

export function createMachinesRoutes({
  ch,
  now = () => Math.floor(Date.now() / 1000),
}: MachinesRoutesConfig) {
  return new Elysia({ prefix: '/machines' })
    .get(
      '/overview',
      async ({ query, status, set }) => {
        set.headers['cache-control'] = 'no-store'
        const result = await attempt('overview', () =>
          machinesOverview(ch, machineWindow(query.range, now())),
        )
        return result ?? status(503, UNAVAILABLE)
      },
      {
        query: RangeQuery,
        response: { 200: OverviewSchema, 503: ErrorSchema },
        detail: detail(
          'Every machine that reported in the last 24 hours',
          "One entry per machine (host.name) with a sample in the last 24 h, by name. `state` is `silent` when its newest sample is 10 minutes old or older: the current values are then null, never zero. Current values are the newest sample: CPU is 100 x (1 - idle) over all cores, memory the used state, load the 1-minute average with `cores` beside it, the fullest filesystem by mount, network the summed rate of physical interfaces in bytes per second. `points` is one bucket per 1 min (1h), 5 min (24h), 30 min (7d) or 2 h (30d), with CPU, memory and network; a bucket without a sample is absent. `reportingPct` is the share of buckets with a sample since the machine's first one in the range. 503 when ClickHouse is unavailable.",
        ),
      },
    )
    .get(
      '/detail',
      async ({ query, status, set }) => {
        set.headers['cache-control'] = 'no-store'
        const result = await attempt('detail', async () => ({
          machine: await machineDetail(ch, query.host, machineWindow(query.range, now())),
        }))
        if (result === null) return status(503, UNAVAILABLE)
        return result.machine ?? status(404, { error: 'machine has not reported in 24 hours' })
      },
      {
        query: DetailQuery,
        response: { 200: DetailSchema, 404: ErrorSchema, 503: ErrorSchema },
        detail: detail(
          "One machine's series, filesystems and containers",
          'CPU, memory, network and disk IO per bucket (rates in bytes per second from the cumulative counters: a counter reset or a hole is a gap, never a spike), `gaps` (stretches of 10 minutes or more without a sample, plus an open one when silent now), the fill of every mount now, fullest first, and the top 6 containers by CPU over the last 5 minutes with memory in bytes (empty on a machine without Docker). 404 for a host that has not reported in 24 h, 503 when ClickHouse is unavailable.',
        ),
      },
    )
}

export const machinesRoutes = createMachinesRoutes({ ch: clickhouse })
