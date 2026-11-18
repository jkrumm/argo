import { Elysia } from 'elysia'
import { z } from 'zod'
import { clickhouse, type ClickHouse } from '../clients/clickhouse.js'
import { log } from '../telemetry.js'
import {
  LINE_WINDOWS,
  latencyByTarget,
  lineNow,
  routerLine,
  speedTests,
  uptime,
  windowRange,
} from '../lib/line-queries.js'

/**
 * `/line/*` — the internet line's history (probe loss and round-trip time per target, router sync rate
 * and noise margin, speed tests, outages), read from ClickStack's ClickHouse where linewatch exports it.
 * One endpoint per card of the dashboard's Line page, so one failing query is one error card. Every
 * query is a named function in `lib/line-queries.ts`; a request picks a `window` from a closed set and
 * nothing else. ClickHouse unconfigured, unreachable or erroring answers 503.
 */

const UNAVAILABLE = { error: 'line data unavailable' }

const ErrorSchema = z.object({ error: z.string() })

const WindowQuery = z.object({
  window: z.enum(LINE_WINDOWS).default('7d').describe('Look-back from now: 24h, 7d, 30d or 90d.'),
})

const RangeShape = {
  window: z.enum(LINE_WINDOWS),
  from: z.number().int().describe('Unix seconds, snapped down to a bucket edge.'),
  to: z.number().int().describe('Unix seconds, now.'),
  step: z.number().int().describe('Bucket width in seconds.'),
}

const NowSchema = z.object({
  state: z
    .enum(['up', 'down', 'stale'])
    .describe(
      'down: an exported outage is open. stale: no probe sample for 3 minutes, state unknown.',
    ),
  probeAt: z.number().int().nullable().describe('Unix seconds of the newest probe sample.'),
  ongoingSince: z.number().int().nullable(),
  lastOutage: z
    .object({ start: z.number().int(), end: z.number().int(), durationS: z.number() })
    .nullable(),
  router: z
    .object({
      at: z.number().int(),
      syncDownMbit: z.number().nullable(),
      syncUpMbit: z.number().nullable(),
      noiseDownDb: z.number().nullable(),
      noiseUpDb: z.number().nullable(),
    })
    .nullable(),
  speedTest: z
    .object({
      at: z.number().int(),
      downloadMbit: z.number().nullable(),
      uploadMbit: z.number().nullable(),
      pingMs: z.number().nullable(),
    })
    .nullable(),
})

const UptimeSchema = z.object({
  ...RangeShape,
  uptimePct: z.number(),
  downtimeS: z.number(),
  outages: z.array(
    z.object({
      start: z.number().int(),
      end: z.number().int(),
      durationS: z.number(),
      ongoing: z.boolean(),
    }),
  ),
})

const LatencySchema = z.object({
  ...RangeShape,
  targets: z.array(
    z.object({
      target: z.string(),
      scope: z.enum(['gateway', 'wan']),
      lossPct: z.number().nullable(),
      rttMs: z.number().nullable(),
      points: z.array(
        z.object({
          t: z.number().int(),
          lossPct: z.number().nullable(),
          rttMs: z.number().nullable(),
        }),
      ),
    }),
  ),
})

const RouterSchema = z.object({
  ...RangeShape,
  points: z.array(
    z.object({
      t: z.number().int(),
      syncDownMbit: z.number().nullable(),
      syncUpMbit: z.number().nullable(),
      noiseDownDb: z.number().nullable(),
      noiseUpDb: z.number().nullable(),
    }),
  ),
})

const SpeedSchema = z.object({
  ...RangeShape,
  runs: z.array(
    z.object({
      t: z.number().int(),
      downloadMbit: z.number().nullable(),
      uploadMbit: z.number().nullable(),
      pingMs: z.number().nullable(),
    }),
  ),
})

/** The read's result, or null (logged) when ClickHouse is unconfigured, unreachable or errored. */
async function attempt<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    log.warn('line: read failed', {
      endpoint: name,
      'error.message': error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}

const detail = (summary: string, description: string) => ({
  tags: ['Line'],
  summary,
  description,
  security: [{ BearerAuth: [] }],
})
const responses = <S extends z.ZodType>(ok: S) => ({ 200: ok, 503: ErrorSchema })

export type LineRoutesConfig = { ch: ClickHouse; now?: () => number }

export function createLineRoutes({
  ch,
  now = () => Math.floor(Date.now() / 1000),
}: LineRoutesConfig) {
  return new Elysia({ prefix: '/line' })
    .get(
      '/now',
      async ({ status, set }) => {
        set.headers['cache-control'] = 'no-store'
        const result = await attempt('now', () => lineNow(ch, now()))
        return result ?? status(503, UNAVAILABLE)
      },
      {
        response: responses(NowSchema),
        detail: detail(
          'Is the line up now, and when was the last outage',
          "The internet line's state from linewatch's export in ClickHouse. `state` is `up` while a probe sample is under 3 minutes old and no exported outage is open, `down` while one is open, and `stale` when the newest sample is older (the collector, the export or the line itself stopped: unknown, not up). `lastOutage` is the newest internet-scope outage (start, end, seconds); `router` and `speedTest` are the newest router sync/noise reading and speed test. Times are Unix seconds, rates Mbit/s, noise margin dB. 503 when ClickHouse is unavailable.",
        ),
      },
    )
    .get(
      '/uptime',
      async ({ query, status, set }) => {
        set.headers['cache-control'] = 'no-store'
        const result = await attempt('uptime', () => uptime(ch, windowRange(query.window, now())))
        return result ?? status(503, UNAVAILABLE)
      },
      {
        query: WindowQuery,
        response: responses(UptimeSchema),
        detail: detail(
          'Uptime and outages over a window',
          'Internet-scope outages in the window, newest first, and the share of the window without one. An outage straddling the window start is clipped to it; an open outage counts up to now. The percentage is `100 x (1 - downtimeS / window seconds)`. Window: 24h, 7d, 30d or 90d. 503 when ClickHouse is unavailable.',
        ),
      },
    )
    .get(
      '/latency',
      async ({ query, status, set }) => {
        set.headers['cache-control'] = 'no-store'
        const result = await attempt('latency', () =>
          latencyByTarget(ch, windowRange(query.window, now())),
        )
        return result ?? status(503, UNAVAILABLE)
      },
      {
        query: WindowQuery,
        response: responses(LatencySchema),
        detail: detail(
          'Packet loss and round-trip time per probe target',
          "Per target (gateway, cloudflare, google, quad9): the window's loss and median RTT, and one point per bucket (5 min for 24h, 1 h for 7d, 6 h for 30d, 1 UTC day for 90d). Loss is `100 x (1 - received / sent)` over the 30-second probe cycles; RTT is the median of the per-cycle median round-trip time in ms. Window: 24h, 7d, 30d or 90d. 503 when ClickHouse is unavailable.",
        ),
      },
    )
    .get(
      '/router',
      async ({ query, status, set }) => {
        set.headers['cache-control'] = 'no-store'
        const result = await attempt('router', () =>
          routerLine(ch, windowRange(query.window, now())),
        )
        return result ?? status(503, UNAVAILABLE)
      },
      {
        query: WindowQuery,
        response: responses(RouterSchema),
        detail: detail(
          'Router sync rate and noise margin',
          'The G.fast line as the router reports it, averaged per bucket: sync rate down and up in Mbit/s, noise margin down and up in dB. History starts when the router export started, so a long window can be shorter than asked. Window: 24h, 7d, 30d or 90d. 503 when ClickHouse is unavailable.',
        ),
      },
    )
    .get(
      '/speedtests',
      async ({ query, status, set }) => {
        set.headers['cache-control'] = 'no-store'
        const result = await attempt('speedtests', () =>
          speedTests(ch, windowRange(query.window, now())),
        )
        return result ?? status(503, UNAVAILABLE)
      },
      {
        query: WindowQuery,
        response: responses(SpeedSchema),
        detail: detail(
          'Speed test runs',
          'Every successful hourly speed test in the window, oldest first: download and upload in Mbit/s, idle ping in ms. Window: 24h, 7d, 30d or 90d. 503 when ClickHouse is unavailable.',
        ),
      },
    )
}

export const lineRoutes = createLineRoutes({ ch: clickhouse })
