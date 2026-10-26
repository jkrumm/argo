import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, desc, inArray, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/index.js'
import { accountPick, quotaSample } from '../db/schema.js'
import { ACCOUNT_PATTERN, toArray } from '../lib/usage-query.js'

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

// Rows are validated one by one in the handler: the body schema only fixes the envelope, so one
// malformed sample or pick is dropped and counted instead of 422-ing the whole batch.
const BatchBodyItems = z.array(z.unknown()).min(1).max(1000)

const IngestResponse = z.object({
  received: z.number().int(),
  inserted: z.number().int(),
  rejected: z.number().int(),
})

const trimmed = z.string().transform((s) => s.trim())
const nonEmpty = trimmed.pipe(z.string().min(1))

/** An ISO 8601 instant with an explicit zone; a zone-less value would read in the server's timezone. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

/**
 * The canonical `toISOString()` form of the instant, or null when the value is not a zoned ISO
 * string or does not survive the round trip. Equal instants in different spellings (`+02:00`, `Z`,
 * with or without milliseconds) land on one string, so the unique keys dedupe them.
 */
function canonicalIso(value: string): string | null {
  if (!ISO_WITH_ZONE.test(value)) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  try {
    const iso = new Date(ms).toISOString()
    return Date.parse(iso) === ms ? iso : null
  } catch {
    return null
  }
}

const isoTime = nonEmpty.transform(canonicalIso).pipe(z.string())
const pct = z.number().finite().nullable()
const optionalIso = isoTime.nullable()

const QuotaSampleRow = z.object({
  account: nonEmpty.pipe(z.string().regex(ACCOUNT_PATTERN)),
  sampledAt: isoTime,
  machine: nonEmpty,
  fiveHourPct: pct,
  sevenDayPct: pct,
  fiveHourResetsAt: optionalIso,
  sevenDayResetsAt: optionalIso,
  authOk: z.boolean(),
  exhaustedUntil: optionalIso,
  source: trimmed.nullable(),
})

const AccountPickRow = z.object({
  ts: isoTime,
  lane: nonEmpty,
  picked: nonEmpty,
  reason: nonEmpty,
  stale: z.boolean(),
  snapshot: z.record(z.string(), z.unknown()),
  machine: nonEmpty,
})

/** Valid rows of an untrusted batch plus how many were dropped. */
function validRows<S extends z.ZodType>(schema: S, items: readonly unknown[]) {
  const rows: Array<z.output<S>> = []
  for (const item of items) {
    const parsed = schema.safeParse(item)
    if (parsed.success) rows.push(parsed.data)
  }
  return { rows, rejected: items.length - rows.length }
}

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
  .post(
    '/quota-samples',
    async ({ body }) => {
      const { rows, rejected } = validRows(QuotaSampleRow, body.samples)
      if (rejected > 0) {
        console.warn(`quota ingest: ${rejected} invalid sample(s) dropped`)
      }
      if (rows.length === 0) return { received: body.samples.length, inserted: 0, rejected }

      const inserted = await db
        .insert(quotaSample)
        .values(
          rows.map((r) => ({
            account: r.account,
            sampled_at: r.sampledAt,
            machine: r.machine,
            five_hour_pct: r.fiveHourPct,
            seven_day_pct: r.sevenDayPct,
            five_hour_resets_at: r.fiveHourResetsAt,
            seven_day_resets_at: r.sevenDayResetsAt,
            auth_ok: r.authOk,
            exhausted_until: r.exhaustedUntil,
            source: r.source === '' ? null : r.source,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: quotaSample.id })

      return { received: body.samples.length, inserted: inserted.length, rejected }
    },
    {
      body: z.object({ samples: BatchBodyItems }),
      response: { 200: IngestResponse },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Batch insert Claude account quota samples',
        description:
          'Idempotent, append-only insert of quota samples keyed on (account, sampledAt, machine); a repeat is skipped (ON CONFLICT DO NOTHING). Each sample: {account, sampledAt ISO, machine, fiveHourPct|null, sevenDayPct|null, fiveHourResetsAt|null, sevenDayResetsAt|null, authOk, exhaustedUntil|null, source|null}. Strings are trimmed; `account` must match `^[a-z][a-z0-9-]{0,15}$`. A sample that fails validation is dropped and counted in `rejected`, never failing the batch. Accepts 1–1000 per call. Same auth as POST /usage/records.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/account-picks',
    async ({ body }) => {
      const { rows, rejected } = validRows(AccountPickRow, body.picks)
      if (rejected > 0) {
        console.warn(`account-pick ingest: ${rejected} invalid pick(s) dropped`)
      }
      if (rows.length === 0) return { received: body.picks.length, inserted: 0, rejected }

      const inserted = await db
        .insert(accountPick)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: accountPick.id })

      return { received: body.picks.length, inserted: inserted.length, rejected }
    },
    {
      body: z.object({ picks: BatchBodyItems }),
      response: { 200: IngestResponse },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Batch insert Claude account picker decisions',
        description:
          'Idempotent, append-only insert of picker decisions keyed on (ts, lane, machine); a repeat is skipped. Each pick: {ts ISO, lane, picked, reason, stale, snapshot object, machine}. `picked` is opaque: an account id, or `spill` when no Max account had headroom. Strings are trimmed; a pick that fails validation is dropped and counted in `rejected`, never failing the batch. Accepts 1–1000 per call. Same auth as POST /usage/records.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
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
              FROM argo.quota_sample
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
            FROM argo.quota_sample
            WHERE sampled_at >= ${fromIso}::timestamptz AND sampled_at <= now() ${accountSql}
              AND five_hour_resets_at IS NOT NULL
            UNION ALL
            SELECT account, 'seven_day' AS win,
                   ${bin(sql`seven_day_resets_at`)} AS at,
                   seven_day_resets_at AS raw
            FROM argo.quota_sample
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
          'Per-account 5-hour and weekly quota utilisation (percent) over the last ?hours=1..8760 (default 168), bucketed taking the last sample in each bucket (15 minutes up to 72 h, 1 hour up to 30 d, 1 day beyond; `bucketMinutes` says which) (several machines sampling one account collapse to the latest). A null percent is a sample without a reading (auth failed), not zero. Buckets without any sample are absent, not zero-filled. `resets` lists window resets that fell inside the range (distinct reset instants reported by the samples, binned to the same bucket width), per account and window. Filter with account[]. Samples stamped in the future are ignored. Series are ordered by account, points by time.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/quota-latest',
    async ({ query }) => {
      const accounts = toArray(query.account)
      const rows = await db
        .selectDistinctOn([quotaSample.account], {
          account: quotaSample.account,
          sampledAt: quotaSample.sampled_at,
          fiveHourPct: quotaSample.five_hour_pct,
          sevenDayPct: quotaSample.seven_day_pct,
          sevenDayResetsAt: quotaSample.seven_day_resets_at,
          authOk: quotaSample.auth_ok,
        })
        .from(quotaSample)
        .where(
          and(
            lte(quotaSample.sampled_at, sql`now()`),
            accounts && accounts.length > 0 ? inArray(quotaSample.account, accounts) : undefined,
          ),
        )
        .orderBy(quotaSample.account, desc(quotaSample.sampled_at), desc(quotaSample.id))

      return {
        accounts: rows.map((r) => ({
          account: r.account,
          sampledAt: stringToIso(r.sampledAt),
          fiveHourPct: r.fiveHourPct,
          sevenDayPct: r.sevenDayPct,
          sevenDayResetsAt: r.sevenDayResetsAt === null ? null : stringToIso(r.sevenDayResetsAt),
          authOk: r.authOk,
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
          'The newest quota sample per account, unbucketed: sampledAt, the 5-hour and weekly percent, the weekly reset instant and whether auth worked (a failed auth carries null percentages, not zero). Several machines sampling one account collapse to the latest. Samples stamped in the future are ignored. Filter with account[]. No samples (or no match) is `{ accounts: [] }`. Ordered by account. The usage page reads it for the weekly meter and its pace tick.',
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
          FROM argo.account_pick
          WHERE ts >= ${fromIso}::timestamptz AND ts <= now()
          GROUP BY lane, picked, reason
          ORDER BY lane, picked, reason
        `),
        db.execute(sql`
          SELECT extract(epoch FROM date_bin(${width}::interval, ts, ${BIN_ORIGIN}))::bigint AS epoch,
                 picked,
                 count(*)::int AS n
          FROM argo.account_pick
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
        pickedKeys: Array.from(pickedKeys).toSorted(),
        series: Array.from(buckets, ([at, picks]) => ({ at, picks })),
      }
    },
    {
      query: z.object({ hours: HoursSchema }),
      response: {
        200: z.object({
          total: z.number().int(),
          bucketHours: z.number().int(),
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
          'Picker decisions over the last ?hours=1..8760 (default 168). `counts` is the lane × picked × reason breakdown (staleCount = decisions made on a sample older than 10 minutes). `series` counts picks per `picked` value per bucket (hourly up to 72 h, daily beyond; buckets with no pick are absent); `pickedKeys` is every picked value seen, sorted. `picked` is opaque: an account id or `spill`.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
