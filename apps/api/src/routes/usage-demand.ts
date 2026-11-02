import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../db/index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import { PAYERS, PAYER_EXPR, RangeEnum, resolveRange, toArray } from '../lib/usage-query.js'
import { buildFilterSql, payerFilter } from '../lib/usage-filters.js'

// The Demand column of the usage page (spec docs/design/usage-tracking.md v7, D1–D2): which workflows,
// steps, models, origins, callers and repos draw the gateway's spend, split by purpose and payer.

const rowsOf = <T>(result: unknown) => result as unknown as T[]

export const PURPOSES = ['prod', 'eval', 'verify', 'other'] as const
type Purpose = (typeof PURPOSES)[number]

/** `prod` / `eval` / `verify` as stored; `drift`, any other value and an absent purpose are `other`. */
const PURPOSE_SQL = sql.raw(`(CASE lane_detail->>'purpose'
  WHEN 'prod' THEN 'prod' WHEN 'eval' THEN 'eval' WHEN 'verify' THEN 'verify' ELSE 'other' END)`)
const COST_SQL = sql.raw(`COALESCE(cost_usd, (lane_detail->>'costEstimatedUsd')::float8, 0)`)
const FRESH_SQL = sql.raw(
  'input_tokens::bigint + output_tokens::bigint + cache_write_tokens::bigint + reasoning_tokens::bigint',
)

const BY = ['workflow', 'step', 'model', 'origin', 'caller', 'repo'] as const

/** A closed list of key expressions, so no query value reaches the SQL text. */
const KEY_SQL: Record<(typeof BY)[number], SQL> = {
  workflow: sql.raw(`COALESCE(NULLIF(lane_detail->>'workflow', ''), '(unset)')`),
  step: sql.raw(`COALESCE(NULLIF(lane_detail->>'step', ''), '(unset)')`),
  model: sql.raw(`COALESCE(NULLIF(model_norm, ''), '(unknown model)')`),
  // agw's own rows carry who asked as their `caller`; a gateway row has `origin` once agw forwards it.
  origin: sql.raw(`COALESCE(NULLIF(lane_detail->>'origin', ''),
    CASE WHEN source = 'agent-workflows' THEN NULLIF(lane_detail->>'caller', '') END, '(unknown)')`),
  caller: sql.raw(`COALESCE(NULLIF(lane_detail->>'caller', ''), '(unset)')`),
  repo: sql.raw(`COALESCE(NULLIF(project, ''), '(unset)')`),
}

/**
 * The rows demand reads: the gateway's, plus agent-workflows' own rows (media, tools, and the steps it wrote
 * before the gateway existed) except the ones the gateway recorded too (Gap 6). An agent-workflows row is
 * that duplicate when a gateway row has the same run (`lane_detail.run_id`, else its `run_id` column; the
 * agent-workflows row keeps its run in the `run_id` column, which the projection does not carry), the
 * same model (`model` or `model_raw` of either side equal: the two writers normalise a model id differently,
 * `openai.gpt-6.1-terra` against `gpt-6.1-terra`) and, when both rows carry one, the same step (a run's other
 * step on the same model is not the twin). Both CTEs read the requested range widened by a day on each side,
 * so a call never scans the whole history. Athena team rows are never demand.
 */
const TWIN_MARGIN_MS = 86_400_000
function twinsCte(fromIso: string, toIso: string): SQL {
  const lo = new Date(Date.parse(fromIso) - TWIN_MARGIN_MS).toISOString()
  const hi = new Date(Date.parse(toIso) + TWIN_MARGIN_MS).toISOString()
  return sql`
  WITH gateway_runs AS (
    SELECT DISTINCT COALESCE(g.lane_detail->>'run_id', g.run_id) AS run_id, g.model AS model,
           g.model_raw AS model_raw, NULLIF(g.lane_detail->>'step', '') AS step
    FROM usage.records_unique g
    WHERE g.source = 'gateway' AND COALESCE(g.lane_detail->>'run_id', g.run_id) IS NOT NULL
      AND g.ts >= ${lo}::timestamptz AND g.ts <= ${hi}::timestamptz
  ), twins AS (
    SELECT a.source_id
    FROM usage.records_unique a
    JOIN gateway_runs g ON g.run_id = a.run_id
      AND (a.model IN (g.model, g.model_raw) OR a.model_raw IN (g.model, g.model_raw))
      AND (g.step IS NULL OR NULLIF(a.lane_detail->>'step', '') IS NULL
           OR g.step = NULLIF(a.lane_detail->>'step', ''))
    WHERE a.source = 'agent-workflows'
      AND a.ts >= ${lo}::timestamptz AND a.ts <= ${hi}::timestamptz
  )`
}
const DEMAND_ROWS_SQL = sql`
  (source = 'gateway'
    OR (source = 'agent-workflows' AND source_id NOT IN (SELECT source_id FROM twins)))
  AND iu_key IS DISTINCT FROM 'athena-team'`

/** Keys that stand for "none": never folded into the tail, so their share stays visible (as in /usage/split). */
const NEVER_FOLDED: ReadonlySet<string> = new Set(['(unset)', '(unknown)', '(unknown model)'])
const FOLD_KEY = '(other)'

const PurposeFilter = z
  .union([z.enum(PURPOSES), z.array(z.enum(PURPOSES))])
  .optional()
  .describe('Keep only these purpose buckets')

const ByPurposeSchema = z.object({
  prod: z.number().describe('Cost of rows with purpose prod'),
  eval: z.number().describe('Cost of rows with purpose eval'),
  verify: z.number().describe('Cost of rows with purpose verify'),
  other: z.number().describe('Cost of rows with any other purpose (drift, probes) or none'),
})

const RowSchema = z.object({
  key: z
    .string()
    .describe('The ?by value of this row; "(unset)" / "(unknown)" / "(unknown model)" without one'),
  usd: z
    .number()
    .describe('Cost: cost_usd, else the gateway estimate lane_detail.costEstimatedUsd, else 0'),
  freshTokens: z.number().describe('input + output + cache-write + reasoning tokens'),
  cacheReadTokens: z.number().describe('Tokens re-read from the prompt cache'),
  requests: z.number().int().describe('Rows (one per upstream request for gateway rows)'),
  runs: z
    .number()
    .int()
    .describe(
      'Distinct lane_detail.run_id among the rows; rows without one (agent-workflows media, oc) add none',
    ),
  byPurpose: ByPurposeSchema.describe('Cost per purpose bucket'),
  byPayer: z
    .record(z.string(), z.number())
    .describe(
      'Cost per payer (iu-credit, me-credit, me2-credit, iu-api, …); payers with no cost are absent',
    ),
})

// No prefix of its own: mounted inside `usageRoutes`, which supplies `/usage`.
export const usageDemandRoutes = new Elysia().get(
  '/demand',
  async ({ query }) => {
    const { fromIso, toIso } = resolveRange(query.range)
    const purposes = toArray(query.purpose)
    const workflow = query.workflow
    const where = sql`
      WHERE ts >= ${fromIso}::timestamptz AND ts <= ${toIso}::timestamptz
        AND ${DEMAND_ROWS_SQL}
        ${workflow === undefined ? sql`` : sql`AND lane_detail->>'workflow' = ${workflow}`}
        ${
          purposes && purposes.length > 0
            ? sql`AND ${PURPOSE_SQL} IN (${sql.join(
                purposes.map((p) => sql`${p}`),
                sql`, `,
              )})`
            : sql``
        }
        ${buildFilterSql({ payer: toArray(query.payer) })}`
    const cte = twinsCte(fromIso, toIso)
    const payerColumns = PAYERS.map(
      (p, i) =>
        sql`COALESCE(SUM(${COST_SQL}) FILTER (WHERE ${PAYER_EXPR} = ${p}), 0)::float8 AS ${sql.raw(`payer_${i}`)}`,
    )
    const purposeColumns = PURPOSES.map(
      (p) =>
        sql`COALESCE(SUM(${COST_SQL}) FILTER (WHERE ${PURPOSE_SQL} = ${p}), 0)::float8 AS ${sql.raw(`purpose_${p}`)}`,
    )

    const raw = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        ${cte}
        SELECT ${KEY_SQL[query.by]} AS key,
               COALESCE(SUM(${COST_SQL}), 0)::float8 AS usd,
               COALESCE(SUM(${FRESH_SQL}), 0)::float8 AS fresh,
               COALESCE(SUM(cache_read_tokens::bigint), 0)::float8 AS cache_read,
               COUNT(*)::int AS requests,
               COUNT(DISTINCT NULLIF(lane_detail->>'run_id', ''))::int AS runs,
               ${sql.join(purposeColumns, sql`, `)},
               ${sql.join(payerColumns, sql`, `)}
        FROM ${USAGE_ROWS}
        ${where}
        GROUP BY 1
      `),
    )

    const all = raw
      .map((r) => {
        const byPurpose = Object.fromEntries(
          PURPOSES.map((p) => [p, Number(r[`purpose_${p}`])]),
        ) as Record<Purpose, number>
        const byPayer: Record<string, number> = {}
        PAYERS.forEach((p, i) => {
          const usd = Number(r[`payer_${i}`])
          if (usd !== 0) byPayer[p] = usd
        })
        return {
          key: String(r['key']),
          usd: Number(r['usd']),
          freshTokens: Number(r['fresh']),
          cacheReadTokens: Number(r['cache_read']),
          requests: Number(r['requests']),
          runs: Number(r['runs']),
          byPurpose,
          byPayer,
        }
      })
      .toSorted((a, b) => b.usd - a.usd || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

    // Past ?top the tail is one `(other)` row (the unset buckets stay); totals are the sum of every row.
    const cut = all.length <= query.top ? all : all.slice(0, query.top - 1)
    const rest = all.length <= query.top ? [] : all.slice(query.top - 1)
    const rows = [...cut, ...rest.filter((r) => NEVER_FOLDED.has(r.key))]
    const tail = rest.filter((r) => !NEVER_FOLDED.has(r.key))
    if (tail.length > 0) {
      // Distinct runs do not add up across keys (a run spans models and steps): count them over the tail's rows.
      const [folded] = rowsOf<{ runs: number }>(
        await db.execute(sql`
          ${cte}
          SELECT COUNT(DISTINCT NULLIF(lane_detail->>'run_id', ''))::int AS runs
          FROM ${USAGE_ROWS}
          ${where}
            AND ${KEY_SQL[query.by]} IN (${sql.join(
              tail.map((r) => sql`${r.key}`),
              sql`, `,
            )})
        `),
      )
      const other = {
        key: FOLD_KEY,
        usd: 0,
        freshTokens: 0,
        cacheReadTokens: 0,
        requests: 0,
        runs: Number(folded?.runs ?? 0),
        byPurpose: { prod: 0, eval: 0, verify: 0, other: 0 } as Record<Purpose, number>,
        byPayer: {} as Record<string, number>,
      }
      for (const r of tail) {
        other.usd += r.usd
        other.freshTokens += r.freshTokens
        other.cacheReadTokens += r.cacheReadTokens
        other.requests += r.requests
        for (const p of PURPOSES) other.byPurpose[p] += r.byPurpose[p]
        for (const [payer, usd] of Object.entries(r.byPayer)) {
          other.byPayer[payer] = (other.byPayer[payer] ?? 0) + usd
        }
      }
      rows.push(other)
    }

    return {
      rows,
      totals: {
        usd: all.reduce((acc, r) => acc + r.usd, 0),
        requests: all.reduce((acc, r) => acc + r.requests, 0),
      },
    }
  },
  {
    query: z.object({
      range: RangeEnum.default('7d'),
      by: z.enum(BY).default('workflow'),
      top: z.coerce.number().int().min(2).max(200).default(25),
      workflow: z.string().optional().describe('Keep only rows of this lane_detail.workflow'),
      purpose: PurposeFilter,
      payer: payerFilter,
    }),
    response: {
      200: z.object({
        rows: z
          .array(RowSchema)
          .describe(
            'One row per ?by key, ranked by cost; past ?top the tail is one trailing "(other)" row',
          ),
        totals: z
          .object({
            usd: z.number().describe("Sum of the rows' cost"),
            requests: z.number().int().describe("Sum of the rows' requests"),
          })
          .describe('Over every key, folded or not, so the rows add up to it'),
      }),
    },
    detail: {
      tags: ['Usage Tracking'],
      summary: 'Gateway demand by workflow, step, model, origin, caller or repo',
      description:
        'Who and what draws the inference gateway\'s spend over the rolling ?range window (7d | 30d | 90d | all, default 7d), one row per ?by key (workflow | step | model | origin | caller | repo; default workflow) ranked by cost: `usd` (cost_usd, else the gateway\'s lane_detail.costEstimatedUsd), fresh and cache-read tokens, `requests`, `runs` (distinct lane_detail.run_id), cost `byPurpose` (prod | eval | verify | other; `drift`, probes and an absent purpose are `other`, nothing is assumed prod) and cost `byPayer` (iu-credit | me-credit | me2-credit | iu-api | … the payer of /usage/split). `origin` groups on lane_detail.origin (who asked agw: claude-code, hermes, iris, macwhisper, cli, …; agent-workflows\' own rows read their caller, a gateway row without it is "(unknown)" until agw forwards x-agw-origin); `caller` groups on lane_detail.caller (the door: agw, agw-opencode, oc, hermes, …); `repo` on the project. Reads the gateway\'s rows (source gateway) plus agent-workflows\' own rows (media, tools, and steps written before the gateway existed), never both for one call: an agent-workflows row is left out when a gateway row has the same run, the same model and, when both carry a step, the same step. The Athena team key is never demand. Filters: ?workflow=<name> (use with by=step), purpose[] (prod | eval | verify | other) and payer[]. Past ?top (default 25) the tail is one trailing "(other)" row ("(unset)", "(unknown)" and "(unknown model)" are never folded, so up to top + 1 rows); `totals` sums every key. Use /usage/router for where the requests were sent and what reached IU, /usage/split for Claude Code and every other source by project, tool, model or lane.',
      security: [{ BearerAuth: [] }],
    },
  },
)
