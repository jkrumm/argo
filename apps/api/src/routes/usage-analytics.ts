import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import {
  API_PAYERS,
  PayerEnum,
  RangeEnum,
  USAGE_DATA_FLOOR_ISO,
  resolveRange,
  toArray,
} from '../lib/usage-query.js'
import {
  accountFilter,
  billingFilter,
  buildFilterSql,
  iuKeyFilter,
  payerFilter,
  stringFilter,
  workspaceFilter,
} from '../lib/usage-filters.js'

// Aggregates the usage page reads instead of pulling rows: `flow` (tool · model split of cost and
// the four token classes) and `movers` (what changed most week over week).

const UNKNOWN_MODEL = '(unknown model)'
const UNSET_TOOL = '(unset)'
/** Pairs under this total in both windows are noise, not movers. */
const MOVER_FLOOR_USD = 2
const MAX_FLOW_ROWS = 200

const rowsOf = <T>(result: unknown) => result as unknown as T[]

interface FlowRow {
  source: string
  subTool: string
  model: string
  cost: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  calls: number
}

const FlowRowSchema = z.object({
  source: z.string(),
  subTool: z.string(),
  model: z.string(),
  cost: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  calls: z.number().int(),
})

const FOLD_LABEL = 'other'

/** What the lens ranks by: dollars, or every token class (the volume view, cache-read included). */
const lensValue = (r: FlowRow, lens: 'cost' | 'tokens') =>
  lens === 'cost' ? r.cost : r.input + r.output + r.cacheRead + r.cacheWrite + r.reasoning

/** Largest `top` rows by the lens, the tail summed into one `other` row so totals stay whole. */
export function foldFlow(rows: FlowRow[], lens: 'cost' | 'tokens', top: number): FlowRow[] {
  const sorted = rows.toSorted((a, b) => lensValue(b, lens) - lensValue(a, lens))
  if (sorted.length <= top) return sorted
  const tail = sorted.slice(top - 1)
  const other: FlowRow = {
    source: FOLD_LABEL,
    subTool: FOLD_LABEL,
    model: FOLD_LABEL,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    calls: 0,
  }
  for (const r of tail) {
    other.cost += r.cost
    other.input += r.input
    other.output += r.output
    other.cacheRead += r.cacheRead
    other.cacheWrite += r.cacheWrite
    other.reasoning += r.reasoning
    other.calls += r.calls
  }
  return [...sorted.slice(0, top - 1), other]
}

export const usageAnalyticsRoutes = new Elysia()
  .get(
    '/flow',
    async ({ query }) => {
      const { fromIso, toIso } = resolveRange(query.range)
      const filterSql = buildFilterSql({
        sources: toArray(query.sources),
        machines: toArray(query.machines),
        billing: toArray(query.billing),
        workspace: toArray(query.workspace),
        account: toArray(query.account),
        iuKey: toArray(query.iuKey),
        payer: toArray(query.payer),
        project: toArray(query.project),
      })
      const raw = rowsOf<Record<string, unknown>>(
        await db.execute(sql`
          SELECT
            source,
            COALESCE(sub_tool, ${UNSET_TOOL}) AS sub_tool,
            COALESCE(model_norm, ${UNKNOWN_MODEL}) AS model,
            COALESCE(SUM(cost_usd), 0)::float AS cost,
            COALESCE(SUM(input_tokens::bigint), 0)::float AS input,
            COALESCE(SUM(output_tokens::bigint), 0)::float AS output,
            COALESCE(SUM(cache_read_tokens::bigint), 0)::float AS cache_read,
            COALESCE(SUM(cache_write_tokens::bigint), 0)::float AS cache_write,
            COALESCE(SUM(reasoning_tokens::bigint), 0)::float AS reasoning,
            COUNT(*)::int AS calls
          FROM ${USAGE_ROWS}
          WHERE ts >= ${fromIso} AND ts <= ${toIso}
            ${filterSql}
          GROUP BY source, 2, 3
        `),
      )
      const rows: FlowRow[] = raw.map((r) => ({
        source: String(r['source']),
        subTool: String(r['sub_tool']),
        model: String(r['model']),
        cost: Number(r['cost']),
        input: Number(r['input']),
        output: Number(r['output']),
        cacheRead: Number(r['cache_read']),
        cacheWrite: Number(r['cache_write']),
        reasoning: Number(r['reasoning']),
        calls: Number(r['calls']),
      }))
      const total = rows.reduce((sum, r) => sum + lensValue(r, query.lens), 0)
      return { total, rows: foldFlow(rows, query.lens, query.top) }
    },
    {
      query: z.object({
        range: RangeEnum.default('30d'),
        lens: z.enum(['cost', 'tokens']).default('cost'),
        top: z.coerce.number().int().min(2).max(MAX_FLOW_ROWS).default(MAX_FLOW_ROWS),
        sources: stringFilter,
        machines: stringFilter,
        billing: billingFilter,
        workspace: workspaceFilter,
        account: accountFilter,
        iuKey: iuKeyFilter,
        payer: payerFilter,
        project: stringFilter,
      }),
      response: { 200: z.object({ total: z.number(), rows: z.array(FlowRowSchema) }) },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Usage by tool and model',
        description:
          'One row per (source, sub_tool, model_norm) with cost, the four token classes (input is fresh uncached input, output excludes reasoning, cache-read and cache-write are separate) and call count. ?lens=cost|tokens picks the ranking and `total`: dollars, or all token classes including cache-read. At most ?top rows (default 200): the tail is summed into one trailing row named "other" so the rows still add up to the total. A NULL sub_tool reads "(unset)", a NULL model "(unknown model)". Filters as /usage/timeseries (incl. iuKey[]).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/movers',
    async ({ query }) => {
      const days = query.days
      const now = Date.now()
      const floor = Date.parse(USAGE_DATA_FLOOR_ISO)
      const iso = (ms: number) => new Date(ms).toISOString()
      const current = { from: iso(now - days * 86_400_000), to: iso(now) }
      const prior = { from: iso(now - 2 * days * 86_400_000), to: current.from }
      const payer = toArray(query.payer) ?? [...API_PAYERS]
      const filterSql = buildFilterSql({ payer, iuKey: toArray(query.iuKey) })

      const empty = { current, prior, rows: [] }
      // A prior window reaching before the data floor is not comparable: every pair would read as growth.
      if (Date.parse(prior.from) < floor) return empty

      const raw = rowsOf<Record<string, unknown>>(
        await db.execute(sql`
          SELECT
            COALESCE(sub_tool, ${UNSET_TOOL}) AS sub_tool,
            COALESCE(model_norm, ${UNKNOWN_MODEL}) AS model,
            COALESCE(SUM(cost_usd) FILTER (WHERE ts >= ${current.from} AND ts <= ${current.to}), 0)::float AS cost,
            COALESCE(SUM(cost_usd) FILTER (WHERE ts >= ${prior.from} AND ts < ${prior.to}), 0)::float AS prior_cost
          FROM ${USAGE_ROWS}
          WHERE ts >= ${prior.from} AND ts <= ${current.to}
            ${filterSql}
          GROUP BY 1, 2
        `),
      )
      const rows = raw
        .map((r) => {
          const costUsd = Number(r['cost'])
          const priorCostUsd = Number(r['prior_cost'])
          return {
            subTool: String(r['sub_tool']),
            model: String(r['model']),
            costUsd,
            priorCostUsd,
            deltaUsd: costUsd - priorCostUsd,
          }
        })
        .filter((r) => r.costUsd >= MOVER_FLOOR_USD || r.priorCostUsd >= MOVER_FLOOR_USD)
        .toSorted((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd))
        .slice(0, query.limit)

      return { current, prior, rows }
    },
    {
      query: z.object({
        days: z.coerce.number().int().min(1).max(30).default(7),
        limit: z.coerce.number().int().min(1).max(20).default(3),
        payer: z.union([PayerEnum, z.array(PayerEnum)]).optional(),
        iuKey: iuKeyFilter,
      }),
      response: {
        200: z.object({
          current: z.object({ from: z.string(), to: z.string() }),
          prior: z.object({ from: z.string(), to: z.string() }),
          rows: z.array(
            z.object({
              subTool: z.string(),
              model: z.string(),
              costUsd: z.number(),
              priorCostUsd: z.number(),
              deltaUsd: z.number(),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Biggest spend movers',
        description:
          'Top ?limit (default 3) (sub_tool, model_norm) pairs by |change| in dollars between the last ?days (default 7) and the ?days before that, for ?payer (default iu-api, iu-team-api and me-api: Max rows carry list value, not spend). Optional ?iuKey[] narrows to IU rows of those API keys. Pairs under $2 in both windows are dropped. rows is empty when nothing moved, or when the prior window reaches before the data floor (not comparable).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
