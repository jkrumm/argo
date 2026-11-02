import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import { utcBucket } from '../lib/usage-query.js'
import { capState } from '../lib/iu-budget.js'
import { DEFAULT_IU_KEY, IU_KEY_LIMIT_USD } from '../lib/iu-keys.js'
import {
  buildPace,
  poolAccounts,
  POOL_REGISTRY,
  RATE_WINDOW_MS,
  rateOf,
  round4,
  selectCycles,
  utcDay,
  type CycleInput,
  type DaySpend,
  type PoolInput,
} from '../lib/usage-pace.js'
import { loadIuBudget } from './usage-portal.js'

// GET /usage/pace: will the Claude API credit be spent before it expires? Spec:
// docs/design/usage-tracking.md §Pace model and §Endpoints. The arithmetic is pure (`lib/usage-pace.ts`);
// this file reads. `credit_cycles`, `platform_cost` and `gateway_picks` belong to usage-tracker and may
// not exist (or be readable) yet: each of those reads is guarded (`tableReadable`, a try/catch around the
// report) and degrades to the decided empty shape. The gateway-row reads go through `USAGE_ROWS`, like every
// usage route. The personal key degrades like `/usage/iu-budget` does without portal data: zero, state ok,
// `fetchedAt` null, which is how the page reads "no portal report".

const rowsOf = <T>(result: unknown) => result as unknown as T[]

/** `YYYY-MM-DDTHH:MM:SS.mmmZ` straight from SQL, so no driver or session setting decides how an instant reads. */
const isoSql = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)

/** An instant from SQL's ISO text; null when absent or not a date (never an Invalid Date). */
function parseInstant(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}
const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value)

type CreditTable = 'credit_cycles' | 'platform_cost' | 'gateway_picks'

/** Whether a usage-tracker table exists and the app role may read it. */
async function tableReadable(table: CreditTable): Promise<boolean> {
  const [row] = rowsOf<{ readable: boolean }>(
    await db.execute(sql`
      SELECT CASE WHEN to_regclass(${`usage.${table}`}::text) IS NULL THEN false
                  ELSE has_table_privilege(to_regclass(${`usage.${table}`}::text), 'SELECT') END AS readable
    `),
  )
  return row?.readable === true
}

interface CycleRow extends CycleInput {
  account: string
}

async function readCycles(): Promise<CycleRow[]> {
  const rows = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT account, ${isoSql('cycle_start')} AS cycle_start, ${isoSql('cycle_end')} AS cycle_end,
             grant_usd::float8 AS grant_usd, reconciled_usd::float8 AS reconciled_usd,
             unspent_usd::float8 AS unspent_usd, ${isoSql('closed_at')} AS closed_at
      FROM usage.credit_cycles
      ORDER BY account, cycle_start DESC
    `),
  )
  return rows.flatMap((r): CycleRow[] => {
    const start = parseInstant(r['cycle_start'])
    if (start === null) return []
    return [
      {
        account: String(r['account']),
        start,
        end: parseInstant(r['cycle_end']),
        grantUsd: Number(r['grant_usd']),
        closedAt: parseInstant(r['closed_at']),
        reconciledUsd: numberOrNull(r['reconciled_usd']),
        unspentUsd: numberOrNull(r['unspent_usd']),
      },
    ]
  })
}

/** The gateway's api_credit spend of one pool per UTC day from `from` (the cycle start) to `now`. */
async function readMetered(account: string, from: Date, now: Date): Promise<DaySpend[]> {
  const rows = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT to_char(${utcBucket('day', sql`ts`)}, 'YYYY-MM-DD') AS day,
             COALESCE(SUM(COALESCE(cost_usd, (lane_detail->>'costEstimatedUsd')::float8)), 0)::float8 AS usd
      FROM ${USAGE_ROWS}
      WHERE source = 'gateway' AND billing = 'api_credit' AND account = ${account}
        AND ts >= ${from.toISOString()}::timestamptz AND ts <= ${now.toISOString()}::timestamptz
      GROUP BY 1
      ORDER BY 1
    `),
  )
  return rows.map((r) => ({ day: String(r['day']), usd: Number(r['usd']) }))
}

/**
 * The provider's daily figures of one account from `fromDay`. A table of another shape than expected
 * (a column renamed upstream) degrades to "no report" instead of failing the endpoint.
 */
async function readReported(
  account: string,
  fromDay: string,
): Promise<{ days: DaySpend[]; refreshedAt: Date | null } | null> {
  try {
    const [days, refreshed] = await Promise.all([
      db.execute(sql`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(cost_usd)::float8 AS usd
        FROM usage.platform_cost
        WHERE account = ${account} AND day >= ${fromDay}::date
        GROUP BY day
        ORDER BY day
      `),
      db.execute(
        sql`SELECT ${isoSql('max(refreshed_at)')} AS refreshed_at FROM usage.platform_cost WHERE account = ${account}`,
      ),
    ])
    return {
      days: rowsOf<Record<string, unknown>>(days).map((r) => ({
        day: String(r['day']),
        usd: Number(r['usd']),
      })),
      refreshedAt: parseInstant(rowsOf<Record<string, unknown>>(refreshed)[0]?.['refreshed_at']),
    }
  } catch (error) {
    console.warn(
      `pace: usage.platform_cost unreadable for ${account}: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    return null
  }
}

/** The first gateway row (the cutover); null while the gateway has written nothing. */
async function readCutover(): Promise<Date | null> {
  const [row] = rowsOf<Record<string, unknown>>(
    await db.execute(
      sql`SELECT ${isoSql('min(ts)')} AS first_ts FROM ${USAGE_ROWS} WHERE source = 'gateway'`,
    ),
  )
  return parseInstant(row?.['first_ts'])
}

/**
 * IU rows the router sent to the passthrough for one of these pick reasons (a request id can carry two
 * picks: a drained retry writes the pool pick first, hence EXISTS and not a join).
 */
const iuPickWithReason = (reasons: readonly string[]) => sql`
  billing = 'iu' AND EXISTS (
    SELECT 1 FROM usage.gateway_picks p
    WHERE p.request_id = source_id AND p.picked = 'iu-api'
      AND p.reason IN (${sql.join(
        reasons.map((r) => sql`${r}`),
        sql`, `,
      )})
  )`

const cost = sql`COALESCE(cost_usd, (lane_detail->>'costEstimatedUsd')::float8, 0)`

/**
 * Production and eval list-price spend of credit-eligible Claude demand over the last 7 days: gateway
 * rows billed to a pool, or to IU by fallback (`no-pool` / `drained-retry`). Purpose `eval` is E,
 * everything else R. The gateway rows are all Claude on `/anthropic` paths when they are billed that way.
 */
async function readDemand(now: Date, picksReadable: boolean) {
  const eligible = picksReadable
    ? sql`(billing = 'api_credit' OR (${iuPickWithReason(['no-pool', 'drained-retry'])}))`
    : sql`billing = 'api_credit'`
  const [row] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT
        COALESCE(SUM(${cost}) FILTER (WHERE COALESCE(lane_detail->>'purpose', '') <> 'eval'), 0)::float8 AS production_usd,
        COALESCE(SUM(${cost}) FILTER (WHERE lane_detail->>'purpose' = 'eval'), 0)::float8 AS eval_usd
      FROM ${USAGE_ROWS}
      WHERE source = 'gateway' AND ${eligible}
        AND ts >= ${new Date(now.getTime() - RATE_WINDOW_MS).toISOString()}::timestamptz
        AND ts <= ${now.toISOString()}::timestamptz
    `),
  )
  return {
    productionUsd: Number(row?.['production_usd'] ?? 0),
    evalUsd: Number(row?.['eval_usd'] ?? 0),
  }
}

/**
 * Claude work that reached IU since the cutover: gateway rows picked onto the passthrough with reason
 * `claude-code`, `no-pool` or `drained-retry`, plus rows carrying `lane_detail.routeFallback` (agw's
 * route fallback onto GPT; the marker lands with agent-workflows' change and reads 0 until then).
 */
async function readClaudeOnIu(picksReadable: boolean): Promise<number> {
  const byPick = picksReadable
    ? sql`(${iuPickWithReason(['claude-code', 'no-pool', 'drained-retry'])})`
    : sql`false`
  const [row] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT COALESCE(SUM(${cost}), 0)::float8 AS usd
      FROM ${USAGE_ROWS}
      WHERE source = 'gateway'
        AND (${byPick} OR COALESCE(lane_detail->>'routeFallback', '') <> '')
    `),
  )
  return Number(row?.['usd'] ?? 0)
}

/** `/usage/iu-budget?iuKey=personal`, reduced to what the verdict band needs; the empty shape if unreadable. */
async function readPersonalKey(now: Date) {
  const capUsd = IU_KEY_LIMIT_USD[DEFAULT_IU_KEY]
  try {
    const budget = await loadIuBudget(DEFAULT_IU_KEY, now)
    return {
      rolling30Usd: budget.rolling30Usd,
      capUsd: budget.limitUsd,
      state: capState(budget.rolling30Usd, budget.limitUsd),
      underCapOn: budget.underCapOn,
      fetchedAt: budget.fetchedAt,
    }
  } catch (error) {
    console.warn(
      `pace: iu portal unreadable: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    return { rolling30Usd: 0, capUsd, state: 'ok' as const, underCapOn: null, fetchedAt: null }
  }
}

/** `/usage/pace` as of `now` (a parameter so a test can pin the clock). */
export async function loadPace(now: Date) {
  const [cyclesReadable, platformReadable, picksReadable] = await Promise.all([
    tableReadable('credit_cycles'),
    tableReadable('platform_cost'),
    tableReadable('gateway_picks'),
  ])
  const cycleRows = cyclesReadable ? await readCycles() : []

  const [cutover, demand, claudeOnIuUsd, personalKey, pools] = await Promise.all([
    readCutover(),
    readDemand(now, picksReadable),
    readClaudeOnIu(picksReadable),
    readPersonalKey(now),
    Promise.all(
      poolAccounts(cycleRows.map((c) => c.account)).map(async (account): Promise<PoolInput> => {
        const cycles = cycleRows.filter((c) => c.account === account)
        const current = selectCycles(cycles, now).current
        const registryGrantUsd = POOL_REGISTRY.find((p) => p.account === account)?.grantUsd ?? 0
        const base = {
          account,
          registryGrantUsd,
          cyclesNewestFirst: cycles,
          reported: null,
          reportedAt: null,
        }
        // Not enabled, or ended and awaiting its reconcile: no balance, so nothing to read.
        if (!current || selectCycles(cycles, now).status === 'awaiting-reconcile') {
          return { ...base, metered: [] }
        }
        const [metered, reported] = await Promise.all([
          readMetered(account, current.start, now),
          platformReadable ? readReported(account, utcDay(current.start)) : Promise.resolve(null),
        ])
        return {
          ...base,
          metered,
          reported: reported?.days ?? null,
          reportedAt: reported?.refreshedAt ?? null,
        }
      }),
    ),
  ])

  const rate = rateOf({ now, cutover, ...demand })
  const pace = buildPace({ now, pools, rate })
  return {
    asOf: now.toISOString(),
    cutover: (cutover ?? now).toISOString(),
    ...pace,
    claudeOnIuUsd: round4(claudeOnIuUsd),
    personalKey,
  }
}

const Iso = (what: string) => z.string().describe(`ISO 8601 instant: ${what}`)

const PoolSchema = z.object({
  account: z
    .string()
    .describe('Claude account id of the pool: iu | me | me2 (or another with a cycle row)'),
  enabled: z
    .boolean()
    .describe(
      'true = a running cycle (start ≤ now < end, or the end unknown). false = not enabled: no cycle row, or the newest one already ended and awaits its reconcile; such a pool draws nothing and has no balance',
    ),
  note: z
    .string()
    .nullable()
    .describe(
      "'not enabled' | 'awaiting reconcile' | 'cycle unknown'; null for a running cycle with an end",
    ),
  grantUsd: z
    .number()
    .describe(
      'Credit granted per cycle: the cycle row’s grant_usd, else the registry figure (iu 200, me 100, me2 100)',
    ),
  cycle: z.object({
    start: Iso('the cycle start; for status none (no cycle row) the instant of the request'),
    end: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 cycle end (the next cycle’s start); null while the billing day is unknown or there is no cycle',
      ),
    status: z
      .enum(['open', 'unknown-end', 'awaiting-reconcile', 'none'])
      .describe(
        'open = running with an end; unknown-end = running, billing day unknown (no projection); awaiting-reconcile = newest unclosed cycle already ended; none = no cycle row',
      ),
  }),
  spentUsd: z
    .number()
    .describe(
      'Σ over the cycle’s UTC days of max(metered_day, reported_day); 0 for a pool that is not enabled',
    ),
  meteredUsd: z
    .number()
    .describe(
      'Σ gateway spend we metered (cost_usd, else lane_detail.costEstimatedUsd) since the cycle start',
    ),
  reportedUsd: z
    .number()
    .nullable()
    .describe(
      'Σ provider-reported spend (usage.platform_cost) since the cycle start; null when the pool has no report',
    ),
  outsideUsd: z
    .number()
    .describe(
      'What the report holds on days the gateway carried nothing (spend made outside the gateway)',
    ),
  reportedAt: z
    .string()
    .nullable()
    .describe(
      'ISO 8601 newest refresh of the pool’s platform_cost rows (lags by hours); null without a report',
    ),
  leftUsd: z.number().nullable().describe('grant − spent; null unless the pool is enabled'),
  daysLeft: z
    .number()
    .nullable()
    .describe(
      'Fractional days from now to the cycle end; null when the end is unknown or the pool is not enabled',
    ),
  requiredUsdPerDay: z
    .number()
    .nullable()
    .describe(
      'left ÷ days left, the even pace that spends the credit exactly at expiry; null without days left',
    ),
  evalReserveUsd: z
    .number()
    .nullable()
    .describe(
      'What production keeps: grant × days left ÷ cycle days (the gateway’s formula; the whole grant while the cycle is unknown); null when not enabled',
    ),
  evalAvailableUsd: z
    .number()
    .nullable()
    .describe(
      'max(0, left − $2 gateway headroom − eval reserve): what evals may still draw; null when not enabled',
    ),
  projection: z.object({
    drawsFrom: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 instant the waterfall starts drawing on this pool; null when it is never reached or nothing is drawn',
      ),
    dryAt: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 instant the pool runs dry at the production rate; null when it expires with credit left',
      ),
    unspentAtEndUsd: z
      .number()
      .nullable()
      .describe(
        'Credit left at expiry; 0 when it runs dry first; null when the pool has no projection',
      ),
  }),
  days: z
    .array(
      z.object({
        day: z.string().describe('UTC date, YYYY-MM-DD'),
        meteredUsd: z.number().describe('Gateway spend metered that day'),
        reportedUsd: z
          .number()
          .nullable()
          .describe('Provider-reported spend that day; null without a figure'),
        leftUsd: z
          .number()
          .describe('Credit left at the end of that day: grant − Σ max(metered, reported) so far'),
      }),
    )
    .describe(
      'The burn-down: one entry per UTC day of the cycle so far, oldest first; empty when not enabled',
    ),
  previous: z
    .object({
      start: z.string().describe('ISO 8601'),
      end: z.string().describe('ISO 8601'),
      grantUsd: z.number(),
      reconciledUsd: z
        .number()
        .nullable()
        .describe('Spend usage-tracker reconciled at close; null before it'),
      unspentUsd: z
        .number()
        .nullable()
        .describe('Credit that expired unspent; null before the reconcile'),
    })
    .nullable()
    .describe('The pool’s newest closed cycle; null when there is none'),
})

const PaceSchema = z.object({
  asOf: Iso('the instant the figures were read'),
  cutover: Iso(
    'the first gateway row, where the rate window is clipped; asOf while the gateway has written nothing',
  ),
  verdict: z
    .enum(['on-pace', 'under', 'over', 'no-pool'])
    .describe(
      'over = the last pool runs dry before the soonest renewal; under = a pool expires with more than max($5, 5 % of grant) unspent; on-pace otherwise; no-pool = none enabled',
    ),
  thin: z.boolean().describe('true when the rate window is under 24 h'),
  rate: z.object({
    productionUsdPerDay: z
      .number()
      .describe(
        'R: credit-eligible Claude demand (purpose ≠ eval, on a pool or on IU by fallback) per day over the window',
      ),
    evalUsdPerDay: z.number().describe('E: the same over purpose = eval'),
    windowHours: z.number().describe('Last 7 × 24 h clipped to the first gateway row'),
  }),
  pools: z.array(PoolSchema).describe('iu, me, me2 first, then any other account with a cycle row'),
  spill: z
    .object({
      from: Iso('the last pool’s dry instant'),
      until: Iso('the soonest renewal: the earliest current-cycle end among the enabled pools'),
      days: z.number(),
      claudeListUsd: z.number().describe('R × days: Claude work at list price, never IU cost'),
    })
    .nullable()
    .describe(
      'The stretch from the last pool running dry to the soonest renewal; null when nothing spills',
    ),
  claudeOnIuUsd: z
    .number()
    .describe(
      'List-price cost since the cutover of Claude work that reached IU: picks claude-code / no-pool / drained-retry plus lane_detail.routeFallback rows',
    ),
  personalKey: z.object({
    rolling30Usd: z.number(),
    capUsd: z.number(),
    state: z
      .enum(['ok', 'warn', 'over'])
      .describe('ok < 80 % of the cap, warn ≥ 80 %, over > 100 %'),
    underCapOn: z
      .string()
      .nullable()
      .describe(
        'UTC date the rolling 30-day sum drops to the cap at the last 7 days’ mean; null when already under or not within 60 days',
      ),
    fetchedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 newest portal fetch; null = no portal data'),
  }),
})

// No prefix of its own: mounted inside `usageRoutes`, which supplies `/usage`.
export const usagePaceRoutes = new Elysia().get('/pace', async () => loadPace(new Date()), {
  response: { 200: PaceSchema },
  detail: {
    tags: ['Usage Tracking'],
    summary: 'Credit pace: will the Claude API credit be spent before it expires',
    description:
      'The verdict band of the usage page, as state (no range): per credit pool (iu, me, me2) the grant, spent (Σ per UTC day of max(our meter, the provider report)), credit left, days left, the even pace that spends it exactly at expiry, the eval reserve, a burn-down (days) and the previous cycle; the production rate R (last 7 days, credit-eligible Claude demand, evals excluded and shown as evalUsdPerDay); the waterfall of pools drained in cycle-end order (projection per pool); the spill onto IU from the last pool running dry to the soonest renewal, in Claude list dollars; the verdict (over | under | on-pace | no-pool) and `thin` when R rests on under 24 h; Claude work that reached IU since the cutover; and the IU personal key cap with the day it falls under. A pool without a running cycle is listed with enabled false. Reads usage.credit_cycles, usage.platform_cost, usage.gateway_picks and the gateway rows; any missing table degrades to the empty shape. For the older per-pool view use /usage/credits/pools; for the IU cap in full /usage/iu-budget.',
    security: [{ BearerAuth: [] }],
  },
})
