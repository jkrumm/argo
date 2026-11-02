import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import { RangeEnum, resolveRange, utcBucket } from '../lib/usage-query.js'
import {
  burndown,
  cacheHitRate,
  cycleWindow,
  DAY_MS,
  isFallback,
  projectUnspent,
  round4,
  utcDay,
  type DaySpend,
} from './usage-credits-math.js'

// The Credits tab: the Claude API credit pools the inference gateway spends from (accounts `iu`, `me`,
// `me2`), read from `usage.credit_cycles`, `usage.platform_cost`, `usage.gateway_picks` and the gateway's
// `billing = 'api_credit'` rows. Spec: docs/design/usage-tracking.md §Credits.

const rowsOf = <T>(result: unknown) => result as unknown as T[]

/** A Postgres timestamptz in string mode (`2026-10-26 10:00:00+00`) as an instant. */
const instant = (value: unknown): Date => new Date(String(value))
const instantOrNull = (value: unknown): Date | null =>
  value === null || value === undefined ? null : instant(value)
const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value)

/** Pools in the order the dashboard lists them; an account outside this list follows alphabetically. */
const POOL_ORDER = ['iu', 'me', 'me2']
const poolRank = (account: string): number => {
  const i = POOL_ORDER.indexOf(account)
  return i === -1 ? POOL_ORDER.length : i
}

/** How far back a pool with spend but no cycle row is looked for. */
const POOL_DISCOVERY_DAYS = 62

interface CycleRow {
  account: string
  start: Date
  end: Date | null
  grantUsd: number
  meteredUsd: number
  reconciledUsd: number | null
  unspentUsd: number | null
  closedAt: Date | null
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

const PoolPoint = z.object({
  day: z.string().describe('UTC date, YYYY-MM-DD'),
  meteredUsd: z
    .number()
    .nullable()
    .describe('Cumulative gateway spend we metered; null after today'),
  reportedUsd: z
    .number()
    .nullable()
    .describe(
      "Cumulative spend the provider's Admin API reports; null when it has no figure or after today",
    ),
  creditLeftUsd: z
    .number()
    .nullable()
    .describe('grant − max(metered, reported) to date; null after today or without a grant'),
})

const PoolSchema = z.object({
  account: z.string().describe('Claude account id of the pool: iu | me | me2'),
  grantUsd: z
    .number()
    .nullable()
    .describe('The cycle grant (credit_cycles.grant_usd); null when no cycle row exists'),
  cycle: z.object({
    known: z
      .boolean()
      .describe(
        'false = the cycle end is unknown and the axis is the last 31 days ("cycle unknown")',
      ),
    start: z.string().nullable().describe('ISO 8601 cycle start; null without a cycle row'),
    end: z
      .string()
      .nullable()
      .describe('ISO 8601 cycle end (the next cycle start); null while the billing day is unknown'),
  }),
  points: z
    .array(PoolPoint)
    .describe('One point per UTC day of the axis, the days after today with null figures'),
  meteredUsd: z.number().describe('Gateway spend metered in the window (estimates included)'),
  meteredEstimatedUsd: z
    .number()
    .describe(
      'Part of meteredUsd that is an estimate (rows with no cost_usd, lane_detail.costEstimatedUsd)',
    ),
  meteredEstimatedRows: z.number().int(),
  reported: z.object({
    available: z
      .boolean()
      .describe('false = usage.platform_cost does not exist (or is unreadable) yet'),
    usd: z
      .number()
      .nullable()
      .describe('Provider-reported spend in the window; null without a figure'),
    refreshedAt: z
      .string()
      .nullable()
      .describe(
        "ISO 8601 newest refresh of the account's platform_cost rows; the figure lags by hours",
      ),
  }),
  spentUsd: z.number().describe('max(metered, reported) to date'),
  creditLeftUsd: z.number().nullable(),
  dailyRateUsd: z.number().describe('Mean daily spend over the last 7 days'),
  daysLeft: z.number().nullable().describe('Days until the cycle end; null when it is unknown'),
  projectedUnspentUsd: z
    .number()
    .nullable()
    .describe(
      'grant − spent − daily rate × days left, floored at 0; null without a grant or a known cycle end',
    ),
  previous: z
    .object({
      cycleStart: z.string(),
      cycleEnd: z.string().nullable(),
      grantUsd: z.number(),
      meteredUsd: z.number(),
      reconciledUsd: z.number().nullable(),
      unspentUsd: z.number().nullable(),
    })
    .nullable()
    .describe('The newest closed cycle of the pool'),
})

const WindowSchema = z.object({ from: z.string(), to: z.string() })

/** Whether `usage.platform_cost` exists and the app role may read it (usage-tracker owns and creates it). */
async function platformCostReadable(): Promise<boolean> {
  const [row] = rowsOf<{ readable: boolean }>(
    await db.execute(sql`
      SELECT CASE WHEN to_regclass('usage.platform_cost') IS NULL THEN false
                  ELSE has_table_privilege(to_regclass('usage.platform_cost'), 'SELECT') END AS readable
    `),
  )
  return row?.readable === true
}

/** Every credit pool as of `now` (a parameter so a test can pin the clock). */
export async function loadCreditPools(now: Date) {
  const today = utcDay(now)
  const readable = await platformCostReadable()

  const cycleRows = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT account, cycle_start, cycle_end, grant_usd::float8 AS grant_usd, metered_usd::float8 AS metered_usd,
             reconciled_usd::float8 AS reconciled_usd, unspent_usd::float8 AS unspent_usd, closed_at
      FROM usage.credit_cycles
      ORDER BY account, cycle_start DESC
    `),
  ).map((r): CycleRow => ({
    account: String(r['account']),
    start: instant(r['cycle_start']),
    end: instantOrNull(r['cycle_end']),
    grantUsd: Number(r['grant_usd']),
    meteredUsd: Number(r['metered_usd']),
    reconciledUsd: numberOrNull(r['reconciled_usd']),
    unspentUsd: numberOrNull(r['unspent_usd']),
    closedAt: instantOrNull(r['closed_at']),
  }))
  const spendAccounts = rowsOf<{ account: string }>(
    await db.execute(sql`
      SELECT DISTINCT account
      FROM ${USAGE_ROWS}
      WHERE billing = 'api_credit' AND account IS NOT NULL
        AND ts >= ${new Date(now.getTime() - POOL_DISCOVERY_DAYS * DAY_MS).toISOString()}::timestamptz
    `),
  ).map((r) => String(r.account))
  const accounts = [...new Set([...cycleRows.map((c) => c.account), ...spendAccounts])].toSorted(
    (a, b) => poolRank(a) - poolRank(b) || a.localeCompare(b),
  )

  const pools = await Promise.all(
    accounts.map(async (account) => {
      const cycles = cycleRows.filter((c) => c.account === account)
      // Newest first. The current cycle is the newest one not yet closed; the previous the newest closed.
      const current = cycles.find((c) => c.closedAt === null && c.start <= now) ?? null
      const previous = cycles.find((c) => c.closedAt !== null && c !== current) ?? null
      // A closed cycle's grant has expired: without an open cycle there is nothing to count down from.
      const grantUsd = current?.grantUsd ?? null
      const window = cycleWindow(current, now)
      const firstDay = utcDay(window.fromTs)
      const lastDay = window.days.at(-1) ?? today

      const [meteredRows, reportedRows, refreshed] = await Promise.all([
        db.execute(sql`
          SELECT to_char(${utcBucket('day', sql`ts`)}, 'YYYY-MM-DD') AS day,
                 COALESCE(SUM(COALESCE(cost_usd, (lane_detail->>'costEstimatedUsd')::float8)), 0)::float8 AS usd,
                 COALESCE(SUM((lane_detail->>'costEstimatedUsd')::float8) FILTER (WHERE cost_usd IS NULL), 0)::float8 AS estimated_usd,
                 (COUNT(*) FILTER (WHERE cost_usd IS NULL AND lane_detail->>'costEstimatedUsd' IS NOT NULL))::int AS estimated_rows
          FROM ${USAGE_ROWS}
          WHERE billing = 'api_credit' AND account = ${account}
            AND ts >= ${window.fromTs.toISOString()}::timestamptz
            AND ts <= ${now.toISOString()}::timestamptz
            ${window.toTs ? sql`AND ts < ${window.toTs.toISOString()}::timestamptz` : sql``}
          GROUP BY 1
          ORDER BY 1
        `),
        readable
          ? db.execute(sql`
              SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(cost_usd)::float8 AS usd
              FROM usage.platform_cost
              WHERE account = ${account} AND day >= ${firstDay}::date AND day <= ${lastDay}::date
              GROUP BY day
              ORDER BY day
            `)
          : Promise.resolve([]),
        readable
          ? db.execute(
              sql`SELECT max(refreshed_at) AS refreshed_at FROM usage.platform_cost WHERE account = ${account}`,
            )
          : Promise.resolve([]),
      ])

      const meteredRaw = rowsOf<Record<string, unknown>>(meteredRows)
      const metered: DaySpend[] = meteredRaw.map((r) => ({
        day: String(r['day']),
        usd: Number(r['usd']),
      }))
      const reportedDays: DaySpend[] = rowsOf<Record<string, unknown>>(reportedRows).map((r) => ({
        day: String(r['day']),
        usd: Number(r['usd']),
      }))
      // No row in the window = no figure (never a reported zero); the series stays null.
      const reported = readable && reportedDays.length > 0 ? reportedDays : null
      const refreshedAt = instantOrNull(
        rowsOf<{ refreshed_at: unknown }>(refreshed)[0]?.refreshed_at,
      )

      const points = burndown({ days: window.days, today, grantUsd, metered, reported })
      const projection = projectUnspent({
        points,
        today,
        grantUsd,
        cycleEnd: window.known ? (current?.end ?? null) : null,
        now,
      })
      const sum = (key: string) => meteredRaw.reduce((acc, r) => acc + Number(r[key]), 0)
      return {
        account,
        grantUsd,
        cycle: {
          known: window.known,
          start: iso(current?.start ?? null),
          end: iso(window.known ? (current?.end ?? null) : null),
        },
        points,
        meteredUsd: round4(sum('usd')),
        meteredEstimatedUsd: round4(sum('estimated_usd')),
        meteredEstimatedRows: Math.round(sum('estimated_rows')),
        reported: {
          available: readable,
          usd: reported ? round4(reported.reduce((acc, d) => acc + d.usd, 0)) : null,
          refreshedAt: iso(refreshedAt),
        },
        spentUsd: projection.spentUsd,
        creditLeftUsd: grantUsd === null ? null : round4(grantUsd - projection.spentUsd),
        dailyRateUsd: projection.dailyRateUsd,
        daysLeft: projection.daysLeft,
        projectedUnspentUsd: projection.projectedUnspentUsd,
        previous: previous
          ? {
              cycleStart: previous.start.toISOString(),
              cycleEnd: iso(previous.end),
              grantUsd: previous.grantUsd,
              meteredUsd: previous.meteredUsd,
              reconciledUsd: previous.reconciledUsd,
              unspentUsd: previous.unspentUsd,
            }
          : null,
      }
    }),
  )
  return { generatedAt: now.toISOString(), pools }
}

// No prefix of its own: mounted inside `usageRoutes`, which supplies `/usage`.
export const usageCreditsRoutes = new Elysia()
  .get('/credits/pools', async () => loadCreditPools(new Date()), {
    response: { 200: z.object({ generatedAt: z.string(), pools: z.array(PoolSchema) }) },
    detail: {
      tags: ['Usage Tracking'],
      summary: 'Claude API credit pools: burn-down and projected unspent credit',
      description:
        "One entry per Claude API credit pool (account iu | me | me2; those with a usage.credit_cycles row or gateway spend in the last 62 days, iu first), read-only, no parameters. Each has the current cycle (cycle_start..cycle_end; with no end the axis is the last 31 days and `cycle.known` is false), a daily burn-down `points` (cumulative `meteredUsd` from the gateway's api_credit rows, estimates included when cost_usd is null; cumulative `reportedUsd` from usage.platform_cost, the provider's own list-price figure including spend made outside the gateway and lagging hours, with `reported.refreshedAt`; `creditLeftUsd` = grant − max of the two), `projectedUnspentUsd` (grant − spent − mean daily spend of the last 7 days × days left, floored at 0, null without a grant or a known end) and the newest closed cycle as `previous` (reconciled and unspent). Use /usage/credits/picks for the routing decisions and /usage/credits/cache for the cache-hit rate; /usage/split?payer=iu-credit gives the credit spend by project, tool or model.",
      security: [{ BearerAuth: [] }],
    },
  })
  .get(
    '/credits/picks',
    async ({ query }) => {
      const { fromIso, toIso } = resolveRange(query.range)
      const rows = rowsOf<Record<string, unknown>>(
        await db.execute(sql`
          SELECT to_char(${utcBucket('day', sql`ts`)}, 'YYYY-MM-DD') AS day, picked, reason, COUNT(*)::int AS count
          FROM usage.gateway_picks
          WHERE ts >= ${fromIso}::timestamptz AND ts <= ${toIso}::timestamptz
          GROUP BY 1, 2, 3
          ORDER BY 1, 2, 3
        `),
      )
      const daily = rows.map((r) => ({
        day: String(r['day']),
        picked: String(r['picked']),
        reason: String(r['reason']),
        count: Number(r['count']),
      }))
      const cellsByKey = new Map<string, { picked: string; reason: string; count: number }>()
      for (const d of daily) {
        const key = `${d.picked}\u0000${d.reason}`
        const cell = cellsByKey.get(key) ?? { picked: d.picked, reason: d.reason, count: 0 }
        cell.count += d.count
        cellsByKey.set(key, cell)
      }
      const cells = [...cellsByKey.values()]
        .map((c) => ({ ...c, fallback: isFallback(c.picked, c.reason) }))
        .toSorted(
          (a, b) =>
            b.count - a.count ||
            a.picked.localeCompare(b.picked) ||
            a.reason.localeCompare(b.reason),
        )
      const total = cells.reduce((acc, c) => acc + c.count, 0)
      const fallbacks = cells.filter((c) => c.fallback).reduce((acc, c) => acc + c.count, 0)
      const refused = cells
        .filter((c) => c.picked === 'refused')
        .reduce((acc, c) => acc + c.count, 0)
      return { window: { from: fromIso, to: toIso }, total, fallbacks, refused, cells, daily }
    },
    {
      query: z.object({ range: RangeEnum.default('30d') }),
      response: {
        200: z.object({
          window: WindowSchema,
          total: z.number().int(),
          fallbacks: z.number().int().describe('Picks of iu-api for a reason other than forced'),
          refused: z.number().int().describe('Picks the gateway refused (picked = refused)'),
          cells: z.array(
            z.object({
              picked: z.string(),
              reason: z.string(),
              count: z.number().int(),
              fallback: z
                .boolean()
                .describe('The pick left the credit pools for a reason other than forced'),
            }),
          ),
          daily: z.array(
            z.object({
              day: z.string().describe('UTC date, YYYY-MM-DD'),
              picked: z.string(),
              reason: z.string(),
              count: z.number().int(),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Inference gateway routing decisions by target and reason',
        description:
          'Counts of usage.gateway_picks over the rolling ?range window (7d | 30d | 90d | all, default 30d): `cells` per (picked, reason) ranked by count, `daily` per UTC day, picked and reason, plus `total`. `picked` is a pool id (iu | me | me2), `iu-api` (the IU passthrough; reasons such as forced, claude-code, no-pool, drained) or `refused`. `fallbacks` counts the picks that left the credit pools for any reason other than forced (picked = iu-api, reason != forced); `refused` counts refusals separately, a refusal serves nothing. A drained retry writes two picks. Use /usage/credits/pools for the balances and /usage/account-picks for the Claude Max account picker, a different router.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/credits/cache',
    async ({ query }) => {
      const { fromIso, toIso } = resolveRange(query.range)
      const rows = rowsOf<Record<string, unknown>>(
        await db.execute(sql`
          SELECT COALESCE(NULLIF(lane_detail->>'caller', ''), '(unset)') AS caller,
                 COUNT(*)::int AS requests,
                 COALESCE(SUM(input_tokens::bigint), 0)::float8 AS input,
                 COALESCE(SUM(cache_read_tokens::bigint), 0)::float8 AS cache_read,
                 COALESCE(SUM(cache_write_tokens::bigint), 0)::float8 AS cache_write
          FROM ${USAGE_ROWS}
          WHERE source = 'gateway' AND ts >= ${fromIso}::timestamptz AND ts <= ${toIso}::timestamptz
          GROUP BY 1
          ORDER BY requests DESC
        `),
      )
      const callers = rows
        .map((r) => {
          const tokens = {
            input: Number(r['input']),
            cacheRead: Number(r['cache_read']),
            cacheWrite: Number(r['cache_write']),
          }
          return {
            caller: String(r['caller']),
            requests: Number(r['requests']),
            ...tokens,
            hitRate: cacheHitRate(tokens),
          }
        })
        // Ties by code unit, not the database collation: the order never depends on the server's locale.
        .toSorted(
          (a, b) =>
            b.requests - a.requests || (a.caller < b.caller ? -1 : a.caller > b.caller ? 1 : 0),
        )
      return { window: { from: fromIso, to: toIso }, callers }
    },
    {
      query: z.object({ range: RangeEnum.default('30d') }),
      response: {
        200: z.object({
          window: WindowSchema,
          callers: z.array(
            z.object({
              caller: z
                .string()
                .describe(
                  'lane_detail.caller of the gateway row (agw, agw-opencode, hermes, oc, modelpick, …); "(unset)" without one',
                ),
              requests: z.number().int(),
              input: z.number(),
              cacheRead: z.number(),
              cacheWrite: z.number(),
              hitRate: z
                .number()
                .nullable()
                .describe(
                  'cacheRead / (input + cacheRead + cacheWrite), 0–1; null when the caller has no input tokens',
                ),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Prompt-cache hit rate per gateway caller',
        description:
          'Per caller (lane_detail.caller) of the inference gateway over the rolling ?range window (7d | 30d | 90d | all, default 30d): request count, input, cache-read and cache-write tokens, and `hitRate` = cacheRead / (input + cacheRead + cacheWrite). Counts every gateway row (source = gateway), credit-paid or IU passthrough, because the cache is a property of the caller. Ranked by requests. Use /usage/credits/pools for the credit balances and /usage/rhythm?metric=tokens_cache_read for cache reads over the week.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
