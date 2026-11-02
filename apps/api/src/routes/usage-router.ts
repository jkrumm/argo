import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import { RangeEnum, resolveRange, utcBucket } from '../lib/usage-query.js'

// The Router column of the usage page (spec docs/design/usage-tracking.md v7, R1–R3): where the
// inference gateway sent each request and why (`usage.gateway_picks`), what reached the IU key and
// for what cause (the gateway's `billing = api_key` rows), and whether the prompt cache works per
// caller and target. `gateway_picks` belongs to usage-tracker and may not exist (or be readable)
// yet: its read is guarded and degrades to empty, never a 404 or 500.

const rowsOf = <T>(result: unknown) => result as unknown as T[]

/** The IU passthrough target of a pick, and the cache table's target for a row billed to the IU key. */
const IU_API = 'iu-api'

/** Whether `usage.gateway_picks` exists and the app role may read it. */
async function picksReadable(): Promise<boolean> {
  const [row] = rowsOf<{ readable: boolean }>(
    await db.execute(sql`
      SELECT CASE WHEN to_regclass('usage.gateway_picks') IS NULL THEN false
                  ELSE has_table_privilege(to_regclass('usage.gateway_picks'), 'SELECT') END AS readable
    `),
  )
  return row?.readable === true
}

// ── The IU cause rule ─────────────────────────────────────────────────────────────────────────

export const IU_CAUSES = [
  'design',
  'eval',
  'claude-code',
  'forced',
  'credit-fallback',
  'route-fallback',
] as const
export type IuCause = (typeof IU_CAUSES)[number]

/**
 * Why a gateway row ended up on the IU key.
 *
 * 1. A row carrying `lane_detail.routeFallback` replaced a refused Claude call: `route-fallback`.
 * 2. A non-Claude model is on IU by design (the seats that were never on credit): `design`, or `eval` when
 *    its purpose is eval. The row has no request path, so "Anthropic" is decided from the model name.
 * 3. A Claude model takes the reason of its pick: `claude-code` and `forced` as they are; `no-pool`,
 *    `drained-retry` and any other reason (a Claude call on IU that nobody forced) are `credit-fallback`.
 *    An `eval-` prefix (`eval-claude-code`, `eval-forced`, `eval-reserve`) reads like its plain reason;
 *    a row without a pick (table missing, row not matched) is `credit-fallback` by elimination.
 */
export function iuCause(input: {
  claude: boolean
  evalPurpose: boolean
  routeFallback: boolean
  reason: string | null
}): IuCause {
  if (input.routeFallback) return 'route-fallback'
  if (!input.claude) return input.evalPurpose ? 'eval' : 'design'
  const reason = (input.reason ?? '').replace(/^eval-/, '')
  if (reason === 'claude-code') return 'claude-code'
  if (reason === 'forced') return 'forced'
  return 'credit-fallback'
}

/** A model id the Anthropic API serves: `claude-…`, optionally behind a vendor prefix (`anthropic/…`, `anthropic.…`). */
const CLAUDE_MODEL_SQL = sql.raw(
  `(lower(COALESCE(NULLIF(model_norm, ''), model, '')) ~ '(^|[/.])claude')`,
)
const COST_SQL = sql.raw(`COALESCE(cost_usd, (lane_detail->>'costEstimatedUsd')::float8, 0)`)
const ROUTE_FALLBACK_SQL = sql.raw(`(NULLIF(lane_detail->>'routeFallback', '') IS NOT NULL)`)
/** Rows billed to an API key: the IU key (`iu`) or, with no IU key stored, `openrouter`. */
const API_KEY_BILLING_SQL = sql.raw(`billing IN ('iu', 'openrouter')`)
/** Athena Teamchat's key never counts in any total (spec pass criterion 5). */
const NOT_ATHENA_SQL = sql.raw(`iu_key IS DISTINCT FROM 'athena-team'`)

const codeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const PickSchema = z.object({
  day: z.string().describe('UTC date, YYYY-MM-DD'),
  target: z
    .string()
    .describe(
      'Where the gateway sent the request: a credit pool id (iu | me | me2), iu-api (the IU passthrough) or refused',
    ),
  reason: z
    .string()
    .describe(
      "The gateway's reason: bound, soonest-expiry, claude-code, forced, no-pool, drained-retry, eval-reserve, eval-forced, eval-claude-code, …",
    ),
  n: z
    .number()
    .int()
    .describe('Picks of this day, target and reason; a drained retry writes two picks'),
})

const IuSchema = z.object({
  day: z.string().describe('UTC date, YYYY-MM-DD'),
  cause: z
    .enum(IU_CAUSES)
    .describe('Why the request was on the IU key; see the route description for the rule'),
  usd: z
    .number()
    .describe('Cost: cost_usd, else the gateway estimate lane_detail.costEstimatedUsd, else 0'),
  requests: z.number().int().describe('Gateway rows of this day and cause'),
})

const CacheSchema = z.object({
  caller: z
    .string()
    .describe(
      'lane_detail.caller of the gateway row (agw, agw-opencode, hermes, oc, modelpick, …); "(unset)" without one',
    ),
  target: z
    .string()
    .describe(
      'The credit pool that paid (iu | me | me2) or iu-api for rows billed to the IU key; unknown without either',
    ),
  requests: z.number().int().describe('Gateway rows of this caller and target'),
  hitRate: z
    .number()
    .nullable()
    .describe(
      'cache-read ÷ (fresh input + cache-read + cache-write), 0–1; null when the group has no input tokens',
    ),
})

// No prefix of its own: mounted inside `usageRoutes`, which supplies `/usage`.
export const usageRouterRoutes = new Elysia().get(
  '/router',
  async ({ query }) => {
    const { fromIso, toIso } = resolveRange(query.range)
    const inRange = sql`ts >= ${fromIso}::timestamptz AND ts <= ${toIso}::timestamptz`
    const hasPicks = await picksReadable()

    const [pickRows, iuRows, cacheRows, measured] = await Promise.all([
      hasPicks
        ? db.execute(sql`
            SELECT to_char(${utcBucket('day', sql`ts`)}, 'YYYY-MM-DD') AS day, picked, reason, COUNT(*)::int AS n
            FROM usage.gateway_picks
            WHERE ${inRange}
            GROUP BY 1, 2, 3
          `)
        : Promise.resolve([]),
      // One pick per request is the reason: a request refused by a pool and re-picked has two, and the IU one is the
      // outcome that put the row on the key.
      db.execute(sql`
        SELECT to_char(${utcBucket('day', sql`ts`)}, 'YYYY-MM-DD') AS day,
               ${CLAUDE_MODEL_SQL} AS claude,
               (lane_detail->>'purpose' = 'eval') AS eval_purpose,
               ${ROUTE_FALLBACK_SQL} AS route_fallback,
               ${hasPicks ? sql`pick.reason` : sql`NULL::text`} AS reason,
               COALESCE(SUM(${COST_SQL}), 0)::float8 AS usd,
               COUNT(*)::int AS requests
        FROM ${USAGE_ROWS}
        ${
          hasPicks
            ? sql`LEFT JOIN LATERAL (
                SELECT p.reason FROM usage.gateway_picks p
                WHERE p.request_id = usage_record.source_id
                ORDER BY (p.picked = ${IU_API}) DESC, p.ts DESC
                LIMIT 1
              ) pick ON true`
            : sql``
        }
        WHERE usage_record.source = 'gateway' AND ${API_KEY_BILLING_SQL} AND ${NOT_ATHENA_SQL}
          AND ${inRange}
        GROUP BY 1, 2, 3, 4, 5
      `),
      db.execute(sql`
        SELECT COALESCE(NULLIF(lane_detail->>'caller', ''), '(unset)') AS caller,
               (CASE WHEN billing = 'api_credit' THEN COALESCE(account, 'unknown')
                     WHEN ${API_KEY_BILLING_SQL} THEN ${IU_API}
                     ELSE 'unknown' END) AS target,
               COUNT(*)::int AS requests,
               COALESCE(SUM(input_tokens::bigint), 0)::float8 AS input,
               COALESCE(SUM(cache_read_tokens::bigint), 0)::float8 AS cache_read,
               COALESCE(SUM(cache_write_tokens::bigint), 0)::float8 AS cache_write
        FROM ${USAGE_ROWS}
        WHERE source = 'gateway' AND ${NOT_ATHENA_SQL} AND ${inRange}
        GROUP BY 1, 2
      `),
      db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM ${USAGE_ROWS} WHERE source = 'gateway' AND jsonb_exists(lane_detail, 'routeFallback')
        ) AS measured
      `),
    ])

    const picks = rowsOf<Record<string, unknown>>(pickRows)
      .map((r) => ({
        day: String(r['day']),
        target: String(r['target'] ?? r['picked']),
        reason: String(r['reason']),
        n: Number(r['n']),
      }))
      .toSorted(
        (a, b) =>
          codeUnit(a.day, b.day) || codeUnit(a.target, b.target) || codeUnit(a.reason, b.reason),
      )

    const iuByKey = new Map<
      string,
      { day: string; cause: IuCause; usd: number; requests: number }
    >()
    for (const r of rowsOf<Record<string, unknown>>(iuRows)) {
      const day = String(r['day'])
      const cause = iuCause({
        claude: r['claude'] === true,
        evalPurpose: r['eval_purpose'] === true,
        routeFallback: r['route_fallback'] === true,
        reason: r['reason'] === null || r['reason'] === undefined ? null : String(r['reason']),
      })
      const key = `${day}\u0000${cause}`
      const cell = iuByKey.get(key) ?? { day, cause, usd: 0, requests: 0 }
      cell.usd += Number(r['usd'])
      cell.requests += Number(r['requests'])
      iuByKey.set(key, cell)
    }
    const iu = [...iuByKey.values()].toSorted(
      (a, b) => codeUnit(a.day, b.day) || IU_CAUSES.indexOf(a.cause) - IU_CAUSES.indexOf(b.cause),
    )

    const cache = rowsOf<Record<string, unknown>>(cacheRows)
      .map((r) => {
        const input = Number(r['input'])
        const cacheRead = Number(r['cache_read'])
        const total = input + cacheRead + Number(r['cache_write'])
        return {
          caller: String(r['caller']),
          target: String(r['target']),
          requests: Number(r['requests']),
          hitRate: total > 0 ? cacheRead / total : null,
        }
      })
      .toSorted(
        (a, b) =>
          b.requests - a.requests || codeUnit(a.caller, b.caller) || codeUnit(a.target, b.target),
      )

    return {
      picks,
      iu,
      cache,
      routeFallbackMeasured: rowsOf<{ measured: boolean }>(measured)[0]?.measured === true,
    }
  },
  {
    query: z.object({ range: RangeEnum.default('7d') }),
    response: {
      200: z.object({
        picks: z
          .array(PickSchema)
          .describe(
            "The gateway's routing decisions per UTC day, target and reason; empty when usage.gateway_picks is missing",
          ),
        iu: z.array(IuSchema).describe('What the gateway sent to the IU key per UTC day and cause'),
        cache: z
          .array(CacheSchema)
          .describe('Prompt-cache hit rate per caller and target, ranked by requests'),
        routeFallbackMeasured: z
          .boolean()
          .describe(
            'true once any gateway row in the store carries lane_detail.routeFallback (the key present, even null); false = the route-fallback cause reads 0 because it is not measured yet',
          ),
      }),
    },
    detail: {
      tags: ['Usage Tracking'],
      summary: 'Inference gateway router: picks, IU spend by cause, cache hit',
      description:
        "The Router column of the usage page over the rolling ?range window (7d | 30d | 90d | all, default 7d). `picks`: usage.gateway_picks counted per UTC day, target (a credit pool id iu | me | me2, `iu-api` for the IU passthrough, or `refused`) and reason; a drained retry writes two picks. `iu`: the gateway rows billed to the IU key (billing api_key; the Athena team key never counts) per UTC day and cause, with cost (cost_usd, else the gateway's lane_detail.costEstimatedUsd) and request count; its total equals the gateway's api_key rows over the range. Cause rule, in order: a row with lane_detail.routeFallback is `route-fallback` (a GPT call that replaced a refused Claude call); a model that is not a Claude model (decided from the model name, the row has no request path) is `design`, or `eval` when lane_detail.purpose is eval; a Claude model takes its pick's reason (matched by request_id = the row's source_id): `claude-code` and `forced` as they are, `no-pool`, `drained-retry` and anything else `credit-fallback` (an `eval-` prefix reads like the plain reason). `cache`: per lane_detail.caller and target (the paying pool, or iu-api) the gateway request count and `hitRate` = cache-read ÷ (fresh input + cache-read + cache-write), null without input. `routeFallbackMeasured` is true once any gateway row carries the routeFallback key; until then `route-fallback` reads 0 because it is not measured, not because it did not happen. A missing usage.gateway_picks degrades to empty `picks` and `credit-fallback` for every Claude row on IU. Use /usage/demand for who asked and what they spent, /usage/credits/pools for the pool balances and /usage/account-picks for the Claude Max account picker, a different router.",
      security: [{ BearerAuth: [] }],
    },
  },
)
