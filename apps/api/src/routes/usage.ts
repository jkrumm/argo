import { Elysia } from 'elysia'
import { z } from 'zod'
import { count, max, min, sql, SQL } from 'drizzle-orm'
import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'
import {
  RangeEnum,
  GrainEnum,
  MetricEnum,
  TimeseriesGroupByEnum,
  BreakdownMetricEnum,
  BreakdownDimensionEnum,
  resolveRange,
} from '../lib/usage-query.js'

const UsageRecordInputSchema = z.object({
  source: z.string(),
  source_id: z.string(),
  grain: z.string(),
  ts: z.string().describe('ISO 8601 timestamp'),
  model: z.string().nullable(),
  model_norm: z.string().nullable(),
  project: z.string().nullable(),
  sub_tool: z.string().nullable(),
  machine: z.string().nullable(),
  billing: z.string(),
  outcome: z.string().default('ok'),
  input_tokens: z.number().int().default(0),
  output_tokens: z.number().int().default(0),
  cache_read_tokens: z.number().int().default(0),
  cache_write_tokens: z.number().int().default(0),
  reasoning_tokens: z.number().int().default(0),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  cost_source: z.string().default('none'),
  raw: z.unknown().nullable(),
  ingested_at: z.string().describe('Source-local ingest time, ISO 8601'),
})

function groupColumnSql(groupBy: string) {
  switch (groupBy) {
    case 'source':
      return sql.raw('source')
    case 'machine':
      return sql.raw('machine')
    case 'model_norm':
      return sql.raw('model_norm')
    case 'sub_tool':
      return sql.raw('sub_tool')
    case 'project':
      return sql.raw('project')
    case 'billing':
      return sql.raw('billing')
    case 'outcome':
      return sql.raw('outcome')
    default:
      return sql.raw('source')
  }
}

function metricExpr(metric: string) {
  switch (metric) {
    case 'cost':
      return sql`COALESCE(SUM(cost_usd), 0)`
    case 'tokens':
      return sql`COALESCE(SUM(input_tokens::bigint + output_tokens::bigint + cache_read_tokens::bigint + cache_write_tokens::bigint + reasoning_tokens::bigint), 0)`
    case 'errors':
      return sql`COALESCE(SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END), 0)`
    case 'latency_p95':
      return sql`percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL)`
    case 'cache_ratio':
      return sql`SUM(cache_read_tokens::bigint)::float / NULLIF(SUM(cache_read_tokens::bigint + input_tokens::bigint), 0)`
    default:
      return sql`COALESCE(SUM(cost_usd), 0)`
  }
}

function metricExprBreakdown(metric: string) {
  switch (metric) {
    case 'cost':
      return sql`COALESCE(SUM(cost_usd), 0)`
    case 'tokens':
      return sql`COALESCE(SUM(input_tokens::bigint + output_tokens::bigint + cache_read_tokens::bigint + cache_write_tokens::bigint + reasoning_tokens::bigint), 0)`
    case 'errors':
      return sql`COALESCE(SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END), 0)`
    default:
      return sql`COALESCE(SUM(cost_usd), 0)`
  }
}

function buildFilterSql(sources?: string[], machines?: string[], billing?: string[]) {
  const parts: SQL[] = []
  if (sources && sources.length > 0) {
    parts.push(sql`source = ANY(${sources})`)
  }
  if (machines && machines.length > 0) {
    parts.push(sql`machine = ANY(${machines})`)
  }
  if (billing && billing.length > 0) {
    parts.push(sql`billing = ANY(${billing})`)
  }
  if (parts.length === 0) return sql``
  return sql`AND ${sql.join(parts, sql` AND `)}`
}

export const usageRoutes = new Elysia({ prefix: '/usage' })
  .post(
    '/records',
    async ({ body }) => {
      const records = body.records
      const now = new Date().toISOString()

      await db
        .insert(usageRecord)
        .values(records)
        .onConflictDoUpdate({
          target: [usageRecord.source, usageRecord.source_id, usageRecord.machine],
          set: {
            grain: sql`excluded.grain`,
            ts: sql`excluded.ts`,
            model: sql`excluded.model`,
            model_norm: sql`excluded.model_norm`,
            project: sql`excluded.project`,
            sub_tool: sql`excluded.sub_tool`,
            billing: sql`excluded.billing`,
            outcome: sql`excluded.outcome`,
            input_tokens: sql`excluded.input_tokens`,
            output_tokens: sql`excluded.output_tokens`,
            cache_read_tokens: sql`excluded.cache_read_tokens`,
            cache_write_tokens: sql`excluded.cache_write_tokens`,
            reasoning_tokens: sql`excluded.reasoning_tokens`,
            duration_ms: sql`excluded.duration_ms`,
            cost_usd: sql`excluded.cost_usd`,
            cost_source: sql`excluded.cost_source`,
            raw: sql`excluded.raw`,
            ingested_at: sql`excluded.ingested_at`,
            updated_at: now,
          },
        })

      return { upserted: records.length }
    },
    {
      body: z.object({
        records: z.array(UsageRecordInputSchema).min(1).max(1000),
      }),
      response: {
        200: z.object({ upserted: z.number() }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Batch upsert usage records',
        description:
          'Idempotent batch insert-or-update for usage records. Keyed on (source, source_id, machine) so the same logical event from different machines stays distinct. A matching triple overwrites all mutable columns (tokens, cost, duration, raw, …). Called by the usage-tracker LaunchAgent every 15 min to sync local SQLite rows into Argo. Accepts 1–1000 records per call (client batches at 500).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary',
    async () => {
      const [totalRow, bySourceRows, maxTsRow] = await Promise.all([
        db.select({ count: count() }).from(usageRecord),
        db
          .select({ source: usageRecord.source, count: count() })
          .from(usageRecord)
          .groupBy(usageRecord.source),
        db.select({ maxTs: max(usageRecord.ts) }).from(usageRecord),
      ])

      return {
        total: Number(totalRow[0]?.count ?? 0),
        bySource: bySourceRows.map((r) => ({
          source: r.source,
          count: Number(r.count),
        })),
        maxTs: maxTsRow[0]?.maxTs ?? null,
      }
    },
    {
      response: {
        200: z.object({
          total: z.number().int(),
          bySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
          maxTs: z.string().nullable(),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Usage record summary',
        description:
          'High-level stats: total row count, breakdown per source, and the newest timestamp in the table.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/headline',
    async () => {
      const now = new Date()
      const d7 = new Date(now.getTime() - 7 * 86_400_000).toISOString()
      const d30 = new Date(now.getTime() - 30 * 86_400_000).toISOString()

      const [row] = await db.execute(sql`
        SELECT
          COALESCE(SUM(cost_usd) FILTER (WHERE ts >= ${d30}), 0)::float AS cost_usd_30d,
          COALESCE(SUM(cost_usd) FILTER (WHERE ts >= ${d7}), 0)::float AS cost_usd_7d,
          COALESCE(SUM(cost_usd) FILTER (WHERE billing = 'max' AND ts >= ${d30}), 0)::float AS cost_max_billing_30d,
          COALESCE(SUM(cost_usd) FILTER (WHERE billing = 'iu' AND ts >= ${d30}), 0)::float AS cost_iu_billing_30d,
          COALESCE(SUM(input_tokens::bigint + output_tokens::bigint + cache_read_tokens::bigint + cache_write_tokens::bigint + reasoning_tokens::bigint) FILTER (WHERE ts >= ${d30}), 0)::bigint AS tokens_30d,
          COALESCE(
            COUNT(*) FILTER (WHERE outcome = 'error' AND ts >= ${d30})::float
            / NULLIF(COUNT(*) FILTER (WHERE ts >= ${d30}), 0),
            0
          )::float AS error_rate_30d,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
            FILTER (WHERE duration_ms IS NOT NULL AND ts >= ${d30}) AS p95_ms_30d,
          SUM(cache_read_tokens::bigint) FILTER (WHERE ts >= ${d30})::float
            / NULLIF(SUM(cache_read_tokens::bigint + input_tokens::bigint) FILTER (WHERE ts >= ${d30}), 0) AS cache_hit_ratio_30d,
          COUNT(DISTINCT source) FILTER (WHERE ts >= ${d30})::int AS sources_active,
          MAX(ts) AS max_ts,
          COUNT(*)::bigint AS records_total
        FROM argo.usage_record
      `)

      const r = row as Record<string, unknown>

      return {
        costUsd30d: Number(r['cost_usd_30d'] ?? 0),
        costUsd7d: Number(r['cost_usd_7d'] ?? 0),
        costMaxBilling30d: Number(r['cost_max_billing_30d'] ?? 0),
        costIuBilling30d: Number(r['cost_iu_billing_30d'] ?? 0),
        tokens30d: Number(r['tokens_30d'] ?? 0),
        errorRate30d: Number(r['error_rate_30d'] ?? 0),
        p95Ms30d:
          r['p95_ms_30d'] !== null && r['p95_ms_30d'] !== undefined
            ? Number(r['p95_ms_30d'])
            : null,
        cacheHitRatio30d:
          r['cache_hit_ratio_30d'] !== null && r['cache_hit_ratio_30d'] !== undefined
            ? Number(r['cache_hit_ratio_30d'])
            : null,
        sourcesActive: Number(r['sources_active'] ?? 0),
        maxTs: r['max_ts'] !== null && r['max_ts'] !== undefined ? String(r['max_ts']) : null,
        recordsTotal: Number(r['records_total'] ?? 0),
      }
    },
    {
      response: {
        200: z.object({
          costUsd30d: z.number(),
          costUsd7d: z.number(),
          costMaxBilling30d: z.number(),
          costIuBilling30d: z.number(),
          tokens30d: z.number().int(),
          errorRate30d: z.number(),
          p95Ms30d: z.number().nullable(),
          cacheHitRatio30d: z.number().nullable(),
          sourcesActive: z.number().int(),
          maxTs: z.string().nullable(),
          recordsTotal: z.number().int(),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Usage headline KPIs',
        description:
          'One-shot KPI bundle for the Usage Tracking dashboard. All windowed fields use a 30-day lookback unless suffixed (e.g. costUsd7d). p95Ms uses percentile_cont; cacheHitRatio is the weighted ratio sum(cache_read) / sum(cache_read + input).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/timeseries',
    async ({ query }) => {
      const range = query.range
      const grain = query.grain
      const metric = query.metric
      const groupBy = query.groupBy
      const { fromIso: rangeFrom, toIso } = resolveRange(range)
      let fromIso = rangeFrom
      if (!fromIso) {
        const [minRow] = await db.select({ minTs: min(usageRecord.ts) }).from(usageRecord)
        fromIso = minRow?.minTs ?? toIso
      }

      const interval = grain === 'day' ? sql`interval '1 day'` : sql`interval '1 week'`
      const filterSql = buildFilterSql(query.sources, query.machines, query.billing)
      const mExpr = metricExpr(metric)

      if (groupBy === 'none') {
        const rows = await db.execute(sql`
          WITH buckets AS (
            SELECT generate_series(
              date_trunc(${grain}, ${fromIso}::timestamptz),
              date_trunc(${grain}, ${toIso}::timestamptz),
              ${interval}
            )::date AS bucket
          ),
          data AS (
            SELECT
              date_trunc(${grain}, ts)::date AS bucket,
              ${mExpr} AS value
            FROM argo.usage_record
            WHERE ts >= ${fromIso} AND ts <= ${toIso}
              ${filterSql}
            GROUP BY 1
          )
          SELECT b.bucket::text, d.value
          FROM buckets b
          LEFT JOIN data d ON d.bucket = b.bucket
          ORDER BY b.bucket
        `)

        const defaultsToZero = metric !== 'latency_p95' && metric !== 'cache_ratio'
        const buckets = (rows as unknown as Array<{ bucket: string; value: unknown }>).map((r) => ({
          bucket: r.bucket,
          groups: {
            value:
              r.value !== null && r.value !== undefined
                ? Number(r.value)
                : defaultsToZero
                  ? 0
                  : null,
          } as Record<string, number | null>,
        }))

        return { buckets, groupKeys: ['value'] as string[] }
      }

      const col = groupColumnSql(groupBy)
      const rows = await db.execute(sql`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc(${grain}, ${fromIso}::timestamptz),
            date_trunc(${grain}, ${toIso}::timestamptz),
            ${interval}
          )::date AS bucket
        ),
        data AS (
          SELECT
            date_trunc(${grain}, ts)::date AS bucket,
            COALESCE(${col}, '(unset)') AS group_key,
            ${mExpr} AS value
          FROM argo.usage_record
          WHERE ts >= ${fromIso} AND ts <= ${toIso}
            ${filterSql}
          GROUP BY 1, 2
        )
        SELECT b.bucket::text, d.group_key, d.value
        FROM buckets b
        LEFT JOIN data d ON d.bucket = b.bucket
        ORDER BY b.bucket, d.group_key
      `)

      const defaultsToZero = metric !== 'latency_p95' && metric !== 'cache_ratio'
      const bucketMap = new Map<string, Map<string, number | null>>()
      const groupKeyTotals = new Map<string, number>()
      const allGroupKeys = new Set<string>()

      for (const r of rows as unknown as Array<{
        bucket: string
        group_key: string | null
        value: unknown
      }>) {
        const bucket = r.bucket
        const groupKey = r.group_key ?? '(unset)'

        if (!bucketMap.has(bucket)) {
          bucketMap.set(bucket, new Map())
        }
        const groups = bucketMap.get(bucket)!

        if (
          (r.group_key === null || r.group_key === undefined) &&
          (r.value === null || r.value === undefined)
        ) {
          continue
        }

        const value =
          r.value !== null && r.value !== undefined ? Number(r.value) : defaultsToZero ? 0 : null
        groups.set(groupKey, value)
        allGroupKeys.add(groupKey)
        groupKeyTotals.set(groupKey, (groupKeyTotals.get(groupKey) ?? 0) + (value ?? 0))
      }

      const sortedGroupKeys = Array.from(allGroupKeys).toSorted(
        (a, b) => (groupKeyTotals.get(b) ?? 0) - (groupKeyTotals.get(a) ?? 0),
      )

      const buckets = Array.from(bucketMap.keys())
        .toSorted()
        .map((bucket) => {
          const groups = bucketMap.get(bucket)!
          const filled: Record<string, number | null> = {}
          for (const gk of sortedGroupKeys) {
            filled[gk] = groups.has(gk) ? groups.get(gk)! : defaultsToZero ? 0 : null
          }
          return { bucket, groups: filled }
        })

      return { buckets, groupKeys: sortedGroupKeys }
    },
    {
      query: z.object({
        range: RangeEnum.default('30d'),
        grain: GrainEnum.default('day'),
        metric: MetricEnum,
        groupBy: TimeseriesGroupByEnum.default('none'),
        sources: z.array(z.string()).optional(),
        machines: z.array(z.string()).optional(),
        billing: z.array(z.enum(['max', 'iu', 'unknown'])).optional(),
      }),
      response: {
        200: z.object({
          buckets: z.array(
            z.object({
              bucket: z.string(),
              groups: z.record(z.string(), z.number().nullable()),
            }),
          ),
          groupKeys: z.array(z.string()),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Usage timeseries',
        description:
          'Bucketed usage timeseries. ?range=7d|30d|90d|all, ?grain=day|week, ?metric=cost|tokens|errors|latency_p95|cache_ratio, ?groupBy=source|machine|model_norm|sub_tool|project|billing|outcome|none. Filter via sources[]/machines[]/billing[]. Empty buckets are emitted as 0 (or null for latency_p95/cache_ratio where there is no data). NULL group keys bucket as the literal "(unset)". groupKeys is sorted by descending total over the window.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/breakdown',
    async ({ query }) => {
      const range = query.range
      const metric = query.metric
      const dimension = query.dimension
      const limit = query.limit
      const { fromIso: rangeFrom, toIso } = resolveRange(range)
      let fromIso = rangeFrom
      if (!fromIso) {
        const [minRow] = await db.select({ minTs: min(usageRecord.ts) }).from(usageRecord)
        fromIso = minRow?.minTs ?? toIso
      }

      const col = groupColumnSql(dimension)
      const mExpr = metricExprBreakdown(metric)
      const filterSql = buildFilterSql(undefined, undefined, undefined)

      const [totalResult, rowsResult] = await Promise.all([
        db.execute(sql`
          SELECT ${mExpr} AS total
          FROM argo.usage_record
          WHERE ts >= ${fromIso} AND ts <= ${toIso}
            ${filterSql}
        `),
        db.execute(sql`
          SELECT
            COALESCE(${col}, '(unset)') AS key,
            ${mExpr} AS value
          FROM argo.usage_record
          WHERE ts >= ${fromIso} AND ts <= ${toIso}
            ${filterSql}
          GROUP BY COALESCE(${col}, '(unset)')
          ORDER BY value DESC
          LIMIT ${limit}
        `),
      ])

      const totalRow = (totalResult as unknown as Array<{ total: unknown }>)[0]
      const total = Number(totalRow?.total ?? 0)

      const rows = (rowsResult as unknown as Array<{ key: string; value: unknown }>).map((r) => ({
        key: r.key,
        value: Number(r.value),
        share: total > 0 ? Number(r.value) / total : 0,
      }))

      return { total, rows }
    },
    {
      query: z.object({
        range: RangeEnum.default('30d'),
        metric: BreakdownMetricEnum,
        dimension: BreakdownDimensionEnum,
        limit: z.coerce.number().int().min(1).max(100).default(10),
      }),
      response: {
        200: z.object({
          total: z.number(),
          rows: z.array(
            z.object({
              key: z.string(),
              value: z.number(),
              share: z.number(),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Usage breakdown',
        description:
          'Top-N grouped aggregate for a single metric over a window. share is value / total over the window (so the displayed top-N can sum to less than 1).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
