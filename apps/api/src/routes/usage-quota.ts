import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../db/index.js'
import { ACCOUNT_PATTERN, toArray } from '../lib/usage-query.js'
import { laneSpills, snapshotOf, windowSummary, type QuotaWindow } from '../lib/routing.js'

const HoursSchema = z.coerce.number().int().min(1).max(8760).default(168)

/**
 * Quota series bucket width, widening with the window so a long range stays a few thousand points:
 * 15 min (the sampler's cadence) up to 72 h, 1 h up to 30 d, 1 d beyond.
 */
export function quotaBucketMinutes(hours: number): number {
  if (hours <= 72) return 15
  if (hours <= 720) return 60
  return 1440
}
/** A picks series up to this many hours is hourly, longer is daily. */
const HOURLY_PICKS_MAX_HOURS = 72

// date_bin needs an origin; any fixed instant works, the buckets align to it.
const BIN_ORIGIN = sql`timestamptz '2001-01-01 00:00:00+00'`

function epochToIso(epoch: unknown): string {
  return new Date(Number(epoch) * 1000).toISOString()
}

/** A Postgres timestamptz in string mode (`2026-10-26 10:00:00+00`) as the canonical ISO instant. */
const stringToIso = (value: string): string => new Date(value).toISOString()

const QuotaPoint = z.object({
  at: z.string().describe('ISO 8601 bucket start (UTC)'),
  fiveHourPct: z.number().nullable(),
  sevenDayPct: z.number().nullable(),
})

// No prefix of its own: mounted inside `usageRoutes`, which supplies `/usage`.
export const usageQuotaRoutes = new Elysia()
  .get(
    '/quota',
    async ({ query }) => {
      const hours = query.hours
      const fromIso = new Date(Date.now() - hours * 3_600_000).toISOString()
      const accounts = toArray(query.account)
      const accountSql =
        accounts && accounts.length > 0
          ? sql`AND account IN (${sql.join(
              accounts.map((a) => sql`${a}`),
              sql`, `,
            )})`
          : sql``
      const bucketMinutes = quotaBucketMinutes(hours)
      const width = `${bucketMinutes} minutes`
      const bin = (column: SQL) => sql`date_bin(${width}::interval, ${column}, ${BIN_ORIGIN})`

      const [pointRows, resetRows] = await Promise.all([
        db.execute(sql`
          SELECT account,
                 extract(epoch FROM bucket)::bigint AS epoch,
                 five_hour_pct,
                 seven_day_pct
          FROM (
            SELECT DISTINCT ON (account, bucket) account, bucket, five_hour_pct, seven_day_pct
            FROM (
              SELECT account, ${bin(sql`sampled_at`)} AS bucket, sampled_at, five_hour_pct, seven_day_pct
              FROM usage.quota_samples
              WHERE sampled_at >= ${fromIso}::timestamptz AND sampled_at <= now() ${accountSql}
            ) s
            ORDER BY account, bucket, sampled_at DESC
          ) last
          ORDER BY account, bucket
        `),
        db.execute(sql`
          SELECT DISTINCT account, win, extract(epoch FROM at)::bigint AS epoch
          FROM (
            SELECT account, 'five_hour' AS win,
                   ${bin(sql`five_hour_resets_at`)} AS at,
                   five_hour_resets_at AS raw
            FROM usage.quota_samples
            WHERE sampled_at >= ${fromIso}::timestamptz AND sampled_at <= now() ${accountSql}
              AND five_hour_resets_at IS NOT NULL
            UNION ALL
            SELECT account, 'seven_day' AS win,
                   ${bin(sql`seven_day_resets_at`)} AS at,
                   seven_day_resets_at AS raw
            FROM usage.quota_samples
            WHERE sampled_at >= ${fromIso}::timestamptz AND sampled_at <= now() ${accountSql}
              AND seven_day_resets_at IS NOT NULL
          ) r
          WHERE raw >= ${fromIso}::timestamptz AND raw <= now()
          ORDER BY epoch, account, win
        `),
      ])

      const byAccount = new Map<string, z.infer<typeof QuotaPoint>[]>()
      for (const r of pointRows as unknown as Array<{
        account: string
        epoch: unknown
        five_hour_pct: number | null
        seven_day_pct: number | null
      }>) {
        const points = byAccount.get(r.account) ?? []
        points.push({
          at: epochToIso(r.epoch),
          fiveHourPct: r.five_hour_pct === null ? null : Number(r.five_hour_pct),
          sevenDayPct: r.seven_day_pct === null ? null : Number(r.seven_day_pct),
        })
        byAccount.set(r.account, points)
      }

      return {
        bucketMinutes,
        series: Array.from(byAccount, ([account, points]) => ({ account, points })),
        resets: (
          resetRows as unknown as Array<{ account: string; win: string; epoch: unknown }>
        ).map((r) => ({
          account: r.account,
          window: r.win === 'five_hour' ? ('five_hour' as const) : ('seven_day' as const),
          at: epochToIso(r.epoch),
        })),
      }
    },
    {
      query: z.object({
        hours: HoursSchema,
        account: z
          .union([z.string().regex(ACCOUNT_PATTERN), z.array(z.string().regex(ACCOUNT_PATTERN))])
          .optional(),
      }),
      response: {
        200: z.object({
          bucketMinutes: z.number().int(),
          series: z.array(z.object({ account: z.string(), points: z.array(QuotaPoint) })),
          resets: z.array(
            z.object({
              account: z.string(),
              window: z.enum(['five_hour', 'seven_day']),
              at: z.string().describe('ISO 8601 reset instant, binned to the bucket width'),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Claude account quota history',
        description:
          'Per-account 5-hour and weekly quota utilisation (percent, read from `usage.quota_samples`) over the last ?hours=1..8760 (default 168), bucketed taking the last sample in each bucket (15 minutes up to 72 h, 1 hour up to 30 d, 1 day beyond; `bucketMinutes` says which) (several machines sampling one account collapse to the latest). A null percent is a sample without a reading (auth failed), not zero. Buckets without any sample are absent, not zero-filled. `resets` lists window resets that fell inside the range (distinct reset instants reported by the samples, binned to the same bucket width), per account and window. Filter with account[]. Samples stamped in the future are ignored. Series are ordered by account, points by time.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/quota-latest',
    async ({ query }) => {
      const accounts = toArray(query.account)
      const accountSql =
        accounts && accounts.length > 0
          ? sql`AND account IN (${sql.join(
              accounts.map((a) => sql`${a}`),
              sql`, `,
            )})`
          : sql``
      // The newest sample per account; the key has no row id, so machine breaks a same-instant tie.
      const rows = (await db.execute(sql`
        SELECT DISTINCT ON (account)
               account,
               sampled_at AS "sampledAt",
               five_hour_pct AS "fiveHourPct",
               seven_day_pct AS "sevenDayPct",
               seven_day_resets_at AS "sevenDayResetsAt",
               auth_ok AS "authOk"
        FROM usage.quota_samples
        WHERE sampled_at <= now() ${accountSql}
        ORDER BY account, sampled_at DESC, machine DESC
      `)) as unknown as Array<{
        account: string
        sampledAt: string
        fiveHourPct: number | null
        sevenDayPct: number | null
        sevenDayResetsAt: string | null
        authOk: boolean | null
      }>

      return {
        accounts: rows.map((r) => ({
          account: r.account,
          sampledAt: stringToIso(r.sampledAt),
          fiveHourPct: r.fiveHourPct === null ? null : Number(r.fiveHourPct),
          sevenDayPct: r.sevenDayPct === null ? null : Number(r.sevenDayPct),
          sevenDayResetsAt: r.sevenDayResetsAt === null ? null : stringToIso(r.sevenDayResetsAt),
          authOk: r.authOk ?? false,
        })),
      }
    },
    {
      query: z.object({
        account: z
          .union([z.string().regex(ACCOUNT_PATTERN), z.array(z.string().regex(ACCOUNT_PATTERN))])
          .optional(),
      }),
      response: {
        200: z.object({
          accounts: z.array(
            z.object({
              account: z.string(),
              sampledAt: z.string().describe('ISO 8601 instant of the sample'),
              fiveHourPct: z.number().nullable(),
              sevenDayPct: z.number().nullable(),
              sevenDayResetsAt: z
                .string()
                .nullable()
                .describe('ISO 8601 instant the weekly window resets'),
              authOk: z.boolean(),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Latest Claude account quota sample',
        description:
          'The newest quota sample per account, unbucketed (read from `usage.quota_samples`): sampledAt, the 5-hour and weekly percent, the weekly reset instant and whether auth worked (a failed auth carries null percentages, not zero). Several machines sampling one account collapse to the latest. Samples stamped in the future are ignored. Filter with account[]. No samples (or no match) is `{ accounts: [] }`. Ordered by account. The usage page reads it for the weekly meter and its pace tick.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/account-picks/summary',
    async ({ query }) => {
      const hours = query.hours
      const fromIso = new Date(Date.now() - hours * 3_600_000).toISOString()
      const bucketHours = hours <= HOURLY_PICKS_MAX_HOURS ? 1 : 24
      const width = `${bucketHours} hours`

      const [countRows, seriesRows] = await Promise.all([
        db.execute(sql`
          SELECT lane, picked, reason, count(*)::int AS n, count(*) FILTER (WHERE stale)::int AS stale_n
          FROM usage.account_picks
          WHERE ts >= ${fromIso}::timestamptz AND ts <= now()
          GROUP BY lane, picked, reason
          ORDER BY lane, picked, reason
        `),
        db.execute(sql`
          SELECT extract(epoch FROM date_bin(${width}::interval, ts, ${BIN_ORIGIN}))::bigint AS epoch,
                 ${query.groupBy === 'reason' ? sql.raw('reason') : sql.raw('picked')} AS picked,
                 count(*)::int AS n
          FROM usage.account_picks
          WHERE ts >= ${fromIso}::timestamptz AND ts <= now()
          GROUP BY 1, 2
          ORDER BY 1, 2
        `),
      ])

      const counts = (
        countRows as unknown as Array<{
          lane: string
          picked: string
          reason: string
          n: number
          stale_n: number
        }>
      ).map((r) => ({
        lane: r.lane,
        picked: r.picked,
        reason: r.reason,
        count: Number(r.n),
        staleCount: Number(r.stale_n),
      }))

      const buckets = new Map<string, Record<string, number>>()
      const pickedKeys = new Set<string>()
      for (const r of seriesRows as unknown as Array<{
        epoch: unknown
        picked: string
        n: number
      }>) {
        const at = epochToIso(r.epoch)
        const row = buckets.get(at) ?? {}
        row[r.picked] = Number(r.n)
        buckets.set(at, row)
        pickedKeys.add(r.picked)
      }

      return {
        total: counts.reduce((sum, c) => sum + c.count, 0),
        bucketHours,
        counts,
        lanes: laneSpills(counts),
        pickedKeys: Array.from(pickedKeys).toSorted(),
        series: Array.from(buckets, ([at, picks]) => ({ at, picks })),
      }
    },
    {
      query: z.object({
        hours: HoursSchema,
        groupBy: z.enum(['picked', 'reason']).default('picked'),
      }),
      response: {
        200: z.object({
          total: z.number().int(),
          bucketHours: z.number().int(),
          lanes: z.array(
            z.object({
              lane: z.string(),
              total: z.number().int(),
              spills: z.number().int(),
              spillRate: z.number(),
            }),
          ),
          counts: z.array(
            z.object({
              lane: z.string(),
              picked: z.string(),
              reason: z.string(),
              count: z.number().int(),
              staleCount: z.number().int(),
            }),
          ),
          pickedKeys: z.array(z.string()),
          series: z.array(
            z.object({
              at: z.string().describe('ISO 8601 bucket start (UTC)'),
              picks: z.record(z.string(), z.number().int()),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Claude account picker summary',
        description:
          'Picker decisions (from `usage.account_picks`) over the last ?hours=1..8760 (default 168). `counts` is the lane × picked × reason breakdown (staleCount = decisions made on a sample older than 10 minutes). `series` counts picks per bucket (hourly up to 72 h, daily beyond; buckets with no pick are absent) keyed by ?groupBy=picked (default: the account id or `spill`) or reason (home | pace | session | spill | no-eligible-account | …); `pickedKeys` is every key seen, sorted. `lanes` is per lane: total picks, spills (picked or reason = `spill`) and spillRate = spills / total. `picked` is opaque: an account id or `spill`.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/account-picks',
    async ({ query }) => {
      const fromIso = new Date(Date.now() - query.hours * 3_600_000).toISOString()
      const rows = await db.execute(sql`
        SELECT ts, lane, picked, reason, stale, snapshot
        FROM usage.account_picks
        WHERE ts >= ${fromIso}::timestamptz AND ts <= now()
        ORDER BY ts
      `)
      return {
        picks: (
          rows as unknown as Array<{
            ts: string | Date
            lane: string
            picked: string
            reason: string
            stale: boolean
            snapshot: unknown
          }>
        ).map((r) => ({
          ts: new Date(r.ts).toISOString(),
          lane: r.lane,
          picked: r.picked,
          reason: r.reason,
          stale: r.stale,
          snapshot: snapshotOf(r.snapshot),
        })),
      }
    },
    {
      query: z.object({ hours: z.coerce.number().int().min(1).max(504).default(168) }),
      response: {
        200: z.object({
          picks: z.array(
            z.object({
              ts: z.string().describe('ISO 8601'),
              lane: z.string(),
              picked: z.string(),
              reason: z.string(),
              stale: z.boolean(),
              snapshot: z.record(
                z.string(),
                z.object({ s: z.number().nullable(), w: z.number().nullable() }),
              ),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Claude account picker decisions',
        description:
          'Every picker decision (from `usage.account_picks`) over the last ?hours=1..504 (21 days, default 168), oldest first: lane, picked (an account id or `spill`), reason, stale (made on a sample older than 10 minutes) and the snapshot the picker saw, per account `{s, w}` = 5-hour and weekly percent used (null when unknown). For aggregates use /usage/account-picks/summary.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/routing/windows',
    async ({ query }) => {
      const fromIso = new Date(Date.now() - query.hours * 3_600_000).toISOString()
      const rows = await db.execute(sql`
        WITH w AS (
          SELECT account, 'five_hour' AS win, date_trunc('minute', five_hour_resets_at) AS reset_at,
                 (array_agg(five_hour_pct ORDER BY sampled_at DESC) FILTER (WHERE five_hour_pct IS NOT NULL))[1] AS pct,
                 max(sampled_at) FILTER (WHERE five_hour_pct IS NOT NULL) AS last_sample
          FROM usage.quota_samples
          WHERE five_hour_resets_at >= ${fromIso}::timestamptz AND five_hour_resets_at <= now()
            AND sampled_at < five_hour_resets_at
            AND sampled_at >= ${fromIso}::timestamptz - interval '5 hours'
          GROUP BY 1, 2, 3
          UNION ALL
          SELECT account, 'seven_day', date_trunc('minute', seven_day_resets_at),
                 (array_agg(seven_day_pct ORDER BY sampled_at DESC) FILTER (WHERE seven_day_pct IS NOT NULL))[1],
                 max(sampled_at) FILTER (WHERE seven_day_pct IS NOT NULL)
          FROM usage.quota_samples
          WHERE seven_day_resets_at >= ${fromIso}::timestamptz AND seven_day_resets_at <= now()
            AND sampled_at < seven_day_resets_at
            AND sampled_at >= ${fromIso}::timestamptz - interval '7 days'
          GROUP BY 1, 2, 3
        )
        , n AS (
          SELECT w.*, lead(w.reset_at) OVER (PARTITION BY w.account, w.win ORDER BY w.reset_at) AS next_reset
          FROM w
        )
        SELECT n.account, n.win, n.reset_at, n.pct, n.last_sample,
               CASE WHEN n.win = 'five_hour' THEN (
                 SELECT min(p.ts) FROM usage.account_picks p
                 WHERE p.picked = n.account AND p.ts >= n.reset_at
                   AND p.ts < COALESCE(n.next_reset, now())
               ) END AS first_pick
        FROM n
        ORDER BY n.reset_at, n.account, n.win
      `)
      const iso = (v: unknown) =>
        v === null || v === undefined ? null : new Date(v as string).toISOString()
      const windows: QuotaWindow[] = (rows as unknown as Array<Record<string, unknown>>).map(
        (r) => {
          const resetAt = iso(r['reset_at'])!
          const pct = r['pct'] === null || r['pct'] === undefined ? null : Number(r['pct'])
          const firstPickAt = iso(r['first_pick'])
          return {
            account: String(r['account']),
            window: r['win'] === 'five_hour' ? 'five_hour' : 'seven_day',
            resetAt,
            pctAtReset: pct,
            unusedPct: pct === null ? null : Math.max(0, 100 - pct),
            lastSampleAt: iso(r['last_sample']),
            firstPickAt,
            minutesToFirstPick:
              firstPickAt === null
                ? null
                : (Date.parse(firstPickAt) - Date.parse(resetAt)) / 60_000,
          }
        },
      )
      return { windows, summary: windowSummary(windows) }
    },
    {
      query: z.object({ hours: z.coerce.number().int().min(1).max(2160).default(504) }),
      response: {
        200: z.object({
          windows: z.array(
            z.object({
              account: z.string(),
              window: z.enum(['five_hour', 'seven_day']),
              resetAt: z.string().describe('ISO 8601 reset instant (minute)'),
              pctAtReset: z.number().nullable(),
              unusedPct: z.number().nullable(),
              lastSampleAt: z.string().nullable(),
              firstPickAt: z.string().nullable(),
              minutesToFirstPick: z.number().nullable(),
            }),
          ),
          summary: z.array(
            z.object({
              account: z.string(),
              window: z.enum(['five_hour', 'seven_day']),
              resets: z.number().int(),
              medianUnusedPct: z.number().nullable(),
              meanUnusedPct: z.number().nullable(),
              medianMinutesToFirstPick: z.number().nullable(),
              neverPickedAfter: z.number().int(),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Claude quota windows: unused capacity and pick-back time',
        description:
          'One row per account and quota window (from `usage.quota_samples` and `usage.account_picks`) (five_hour | seven_day) that reset in the last ?hours=1..2160 (default 504 = 21 d): pctAtReset is the percent used in the last sample before the reset (lastSampleAt says how old it was), unusedPct = 100 − pctAtReset (capacity that expired unused). For five_hour windows, firstPickAt / minutesToFirstPick is the first picker decision for that account at or after the reset and before the account’s next 5 h reset (null: not picked in that span), so one pick never counts for two windows. `summary` aggregates per account and window: resets, median/mean unused percent, median minutes to the first pick, and five-hour resets never picked after. A window only appears once a sample reported its reset instant.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
