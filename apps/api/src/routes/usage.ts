import { Elysia } from 'elysia'
import { z } from 'zod'
import { count, max, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { usageRecord } from '../db/schema.js'

const UsageRecordInputSchema = z.object({
  source: z.string(),
  source_id: z.string(),
  grain: z.string(),
  ts: z.string().describe('ISO 8601 timestamp'),
  model: z.string().nullable(),
  model_norm: z.string().nullable(),
  project: z.string().nullable(),
  machine: z.string().nullable(),
  billing: z.string(),
  outcome: z.string().default('ok'),
  input_tokens: z.number().int().default(0),
  output_tokens: z.number().int().default(0),
  cache_read_tokens: z.number().int().default(0),
  cache_write_tokens: z.number().int().default(0),
  reasoning_tokens: z.number().int().default(0),
  cost_usd: z.number().nullable(),
  cost_source: z.string().default('none'),
  raw: z.unknown().nullable(),
  ingested_at: z.string().describe('Source-local ingest time, ISO 8601'),
})

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
          target: [usageRecord.source, usageRecord.source_id],
          set: {
            grain: sql`excluded.grain`,
            ts: sql`excluded.ts`,
            model: sql`excluded.model`,
            model_norm: sql`excluded.model_norm`,
            project: sql`excluded.project`,
            billing: sql`excluded.billing`,
            machine: sql`excluded.machine`,
            outcome: sql`excluded.outcome`,
            input_tokens: sql`excluded.input_tokens`,
            output_tokens: sql`excluded.output_tokens`,
            cache_read_tokens: sql`excluded.cache_read_tokens`,
            cache_write_tokens: sql`excluded.cache_write_tokens`,
            reasoning_tokens: sql`excluded.reasoning_tokens`,
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
          'Idempotent batch insert-or-update for usage records. Keyed on (source, source_id). A duplicate pair overwrites all mutable columns. Called by the usage-tracker LaunchAgent to sync local SQLite rows into Argo. Accepts 1–1000 records per call.',
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
