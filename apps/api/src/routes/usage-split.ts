import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  PAYER_EXPR,
  RangeEnum,
  USAGE_DATA_FLOOR_ISO,
  resolveRange,
  toArray,
} from '../lib/usage-query.js'
import {
  buildFilterSql,
  iuKeyFilter,
  payerFilter,
  stringFilter,
  workspaceFilter,
} from '../lib/usage-filters.js'
import {
  SPLIT_UNKNOWN_MODEL_KEY,
  SPLIT_UNSET_KEY,
  foldSplit,
  type SplitCell,
} from '../lib/usage-split.js'

// The usage page's wallet aggregates: `split` (a dimension's keys, each split by payer, with the
// equally long window before) and `rhythm` (weekday × hour of day in the reader's time zone).

const DAY_MS = 86_400_000
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, all: null } as const

/** The dimension columns `split` may group by: a closed list, so the raw column name is safe. */
const SPLIT_COLUMN = { project: 'project', sub_tool: 'sub_tool', model_norm: 'model_norm' } as const

const FRESH_SQL = sql.raw(
  'input_tokens::bigint + output_tokens::bigint + cache_write_tokens::bigint + reasoning_tokens::bigint',
)

const rowsOf = <T>(result: unknown) => result as unknown as T[]

const MeasuresSchema = {
  cost: z.number(),
  fresh: z.number(),
  cacheRead: z.number(),
  output: z.number(),
  calls: z.number().int(),
}
const PriorSchema = z.object({ cost: z.number(), fresh: z.number() }).nullable()
const WindowSchema = z.object({ from: z.string(), to: z.string() })

/** A time zone Postgres and the runtime both know; anything else reads as UTC. */
function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

const RHYTHM_METRIC = {
  cost: sql.raw('COALESCE(SUM(cost_usd), 0)'),
  tokens: sql`COALESCE(SUM(${FRESH_SQL}), 0)`,
  tokens_cache_read: sql.raw('COALESCE(SUM(cache_read_tokens::bigint), 0)'),
} as const

export const usageSplitRoutes = new Elysia()
  .get(
    '/split',
    async ({ query }) => {
      const current = resolveRange(query.range)
      const days = RANGE_DAYS[query.range]
      const priorFrom =
        days === null ? null : new Date(Date.parse(current.fromIso) - days * DAY_MS).toISOString()
      // A prior window reaching before the data floor is not comparable: every key would read as growth.
      const hasPrior = priorFrom !== null && priorFrom >= USAGE_DATA_FLOOR_ISO
      const from = hasPrior && priorFrom !== null ? priorFrom : current.fromIso
      const col = sql.raw(SPLIT_COLUMN[query.by])
      const filterSql = buildFilterSql({
        workspace: toArray(query.workspace),
        iuKey: toArray(query.iuKey),
        payer: toArray(query.payer),
        project: toArray(query.project),
      })
      // A model-less row (Athena teamchat reports cost without a model) reads like the flow's "(unknown model)".
      const emptyKey = query.by === 'model_norm' ? SPLIT_UNKNOWN_MODEL_KEY : SPLIT_UNSET_KEY
      const cur = sql`ts >= ${current.fromIso}`
      const raw = rowsOf<Record<string, unknown>>(
        await db.execute(sql`
          SELECT
            COALESCE(NULLIF(${col}, ''), ${emptyKey}) AS key,
            ${PAYER_EXPR} AS payer,
            COALESCE(SUM(cost_usd) FILTER (WHERE ${cur}), 0)::float AS cost,
            COALESCE(SUM(${FRESH_SQL}) FILTER (WHERE ${cur}), 0)::float AS fresh,
            COALESCE(SUM(cache_read_tokens::bigint) FILTER (WHERE ${cur}), 0)::float AS cache_read,
            COALESCE(SUM(output_tokens::bigint + reasoning_tokens::bigint) FILTER (WHERE ${cur}), 0)::float AS output,
            (COUNT(*) FILTER (WHERE ${cur}))::int AS calls,
            COALESCE(SUM(cost_usd) FILTER (WHERE ts < ${current.fromIso}), 0)::float AS prior_cost,
            COALESCE(SUM(${FRESH_SQL}) FILTER (WHERE ts < ${current.fromIso}), 0)::float AS prior_fresh
          FROM argo.usage_record
          WHERE ts >= ${from} AND ts <= ${current.toIso}
            ${filterSql}
          GROUP BY 1, 2
        `),
      )
      const cells: SplitCell[] = raw.map((r) => ({
        key: String(r['key']),
        payer: String(r['payer']),
        cost: Number(r['cost']),
        fresh: Number(r['fresh']),
        cacheRead: Number(r['cache_read']),
        output: Number(r['output']),
        calls: Number(r['calls']),
        priorCost: Number(r['prior_cost']),
        priorFresh: Number(r['prior_fresh']),
      }))
      return {
        window: { from: current.fromIso, to: current.toIso },
        prior: hasPrior && priorFrom !== null ? { from: priorFrom, to: current.fromIso } : null,
        ...foldSplit({ cells, lens: query.lens, top: query.top, hasPrior }),
      }
    },
    {
      query: z.object({
        by: z.enum(['project', 'sub_tool', 'model_norm']).default('project'),
        range: RangeEnum.default('30d'),
        lens: z.enum(['cost', 'tokens']).default('cost'),
        top: z.coerce.number().int().min(2).max(50).default(12),
        workspace: workspaceFilter,
        iuKey: iuKeyFilter,
        payer: payerFilter,
        project: stringFilter,
      }),
      response: {
        200: z.object({
          window: WindowSchema,
          prior: WindowSchema.nullable(),
          totals: z.array(z.object({ payer: z.string(), ...MeasuresSchema, prior: PriorSchema })),
          rows: z.array(
            z.object({
              key: z.string(),
              ...MeasuresSchema,
              prior: PriorSchema,
              payers: z.array(z.object({ payer: z.string(), ...MeasuresSchema })),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Usage by project, tool or model, split by payer',
        description:
          'One row per ?by key (project | sub_tool | model_norm; empty or NULL reads "(unset)", a model-less model_norm row "(unknown model)") over the rolling ?range window, each with cost (USD; list value for the Max payers), fresh tokens (input + output + cache-write + reasoning), cache-read tokens, output tokens (incl. reasoning), call count, its per-payer split (iu-sub | me-sub | me2-sub | iu-api | iu-team-api | me-api | unknown) and `prior` = {cost, fresh} over the equally long window before (null for range=all or when that window predates the data floor). Ranked by ?lens=cost|tokens (tokens = fresh); keys with nothing in the window are dropped; past ?top (default 12) the tail is one trailing "(other)" row; "(unset)" and "(unknown model)" are never folded, so it can follow the top rows out of rank order (up to top + 1 rows). `totals` is per payer over every key, so it is also the headline. Filter by workspace[], iuKey[] (IU API key: personal | athena-team), payer[] and project[] (normalized names).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/rhythm',
    async ({ query }) => {
      const { fromIso, toIso } = resolveRange(query.range)
      const tz = safeTimeZone(query.tz)
      const local = sql`(ts AT TIME ZONE ${tz})`
      const filterSql = buildFilterSql({
        workspace: toArray(query.workspace),
        iuKey: toArray(query.iuKey),
        payer: toArray(query.payer),
        project: toArray(query.project),
      })
      const raw = rowsOf<Record<string, unknown>>(
        await db.execute(sql`
          SELECT
            (extract(isodow FROM ${local})::int - 1) AS dow,
            extract(hour FROM ${local})::int AS hour,
            ${RHYTHM_METRIC[query.metric]}::float AS value
          FROM argo.usage_record
          WHERE ts >= ${fromIso} AND ts <= ${toIso}
            ${filterSql}
          GROUP BY 1, 2
        `),
      )
      const values = new Map(raw.map((r) => [`${r['dow']}:${r['hour']}`, Number(r['value'])]))
      const cells = Array.from({ length: 7 * 24 }, (_, i) => {
        const dow = Math.floor(i / 24)
        const hour = i % 24
        return { dow, hour, value: values.get(`${dow}:${hour}`) ?? 0 }
      })
      return { tz, window: { from: fromIso, to: toIso }, cells }
    },
    {
      query: z.object({
        range: RangeEnum.default('30d'),
        metric: z.enum(['cost', 'tokens', 'tokens_cache_read']).default('cost'),
        tz: z.string().max(64).default('Europe/Berlin'),
        workspace: workspaceFilter,
        iuKey: iuKeyFilter,
        payer: payerFilter,
        project: stringFilter,
      }),
      response: {
        200: z.object({
          tz: z.string(),
          window: WindowSchema,
          cells: z.array(
            z.object({ dow: z.number().int(), hour: z.number().int(), value: z.number() }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Usage by weekday and hour of day',
        description:
          'Sum of ?metric (cost USD | tokens = fresh tokens | tokens_cache_read) per weekday (dow 0 = Monday … 6 = Sunday) and hour of day (0–23) in the IANA time zone ?tz (default Europe/Berlin; an unknown zone reads as UTC, echoed in `tz`) over the rolling ?range window. Always 168 cells, empty ones 0. Filter by payer[], workspace[], iuKey[] and project[].',
        security: [{ BearerAuth: [] }],
      },
    },
  )
