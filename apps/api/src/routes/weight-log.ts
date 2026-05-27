import { Elysia } from 'elysia'
import { z } from 'zod'
import { asc, count, desc, eq, gte, lte, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { weightLog } from '../db/schema.js'
import { computeStats } from '../lib/formulas.js'
import { trailingRateKgPerWeek, classifyWeightPhase } from '../lib/strength-formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const WeightLogSchema = z.object({
  id: z.number(),
  date: z.string(),
  weight_kg: z.number(),
  created_at: z.string().nullable(),
})

const WeightLogSummarySchema = z.object({
  current: z.number().nullable().describe('Most recent weight entry in window (kg)'),
  ma7: z
    .number()
    .nullable()
    .describe('Average of up to 7 most-recent entries; fewer when window < 7 entries'),
  ma30: z
    .number()
    .nullable()
    .describe('Average of up to 30 most-recent entries; fewer when window < 30 entries'),
  trend: z
    .enum(['up', 'down', 'flat'])
    .describe(
      'up = ma7 > ma30 by >0.5% (gaining); down = ma7 < ma30 by >0.5% (losing); flat = otherwise',
    ),
  weeklyDelta: z
    .number()
    .nullable()
    .describe(
      'Weight change (kg) between most recent and oldest entry in last 7 entries. Positive = gaining.',
    ),
  monthlyDelta: z
    .number()
    .nullable()
    .describe(
      'Weight change (kg) between most recent and oldest entry in last 30 entries. Positive = gaining.',
    ),
  kgPerWeek: z
    .number()
    .nullable()
    .describe('Trailing 28-day linear-regression rate of weight change (kg/week).'),
  phase: z
    .enum(['losing', 'gaining', 'maintaining'])
    .describe('Classification of |kgPerWeek|: <0.1 maintenance, else losing or gaining.'),
  intensity: z
    .string()
    .describe(
      'Intensity tier label — e.g. "Lean cut", "Standard bulk", "Maintenance", "Aggressive cut".',
    ),
})

export const weightLogRoutes = new Elysia({ prefix: '/weight-log' })
  .get(
    '/summary',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      // Most-recent-first for computeStats
      const rows = await db
        .select({ date: weightLog.date, weight_kg: weightLog.weight_kg })
        .from(weightLog)
        .where(and(gte(weightLog.date, fromStr), lte(weightLog.date, toStr)))
        .orderBy(desc(weightLog.date))

      if (rows.length === 0) {
        return {
          current: null,
          ma7: null,
          ma30: null,
          trend: 'flat' as const,
          weeklyDelta: null,
          monthlyDelta: null,
          kgPerWeek: null,
          phase: 'maintaining' as const,
          intensity: 'No trend',
        }
      }

      const stats = computeStats(rows.map((r) => r.weight_kg))

      const last7 = rows.slice(0, 7)
      const weeklyDelta =
        last7.length >= 2
          ? Math.round((last7[0]!.weight_kg - last7[last7.length - 1]!.weight_kg) * 10) / 10
          : null

      const last30 = rows.slice(0, 30)
      const monthlyDelta =
        last30.length >= 2
          ? Math.round((last30[0]!.weight_kg - last30[last30.length - 1]!.weight_kg) * 10) / 10
          : null

      const rate = trailingRateKgPerWeek(
        rows.map((r) => ({ date: r.date, weight_kg: r.weight_kg })),
      )
      const { phase, intensity } = classifyWeightPhase(rate)
      const kgPerWeek = rate !== null ? Math.round(rate * 100) / 100 : null

      return { ...stats, weeklyDelta, monthlyDelta, kgPerWeek, phase, intensity }
    },
    {
      query: WindowQuerySchema,
      response: WeightLogSummarySchema,
      detail: {
        tags: ['Garmin Health'],
        summary: 'Body weight summary',
        description:
          'Server-computed rolling weight stats. ' +
          'ma7/ma30 = average of most-recent 7/30 entries. ' +
          'weeklyDelta = latest − oldest within last 7 entries (positive = gaining). ' +
          'monthlyDelta = latest − oldest within last 30 entries. ' +
          'Trend: ma7 vs ma30 — up >0.5% = gaining, down >0.5% = losing. ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. ' +
          'Example: GET /weight-log/summary?window=90d',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/series',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      const rows = await db
        .select({ date: weightLog.date, weight_kg: weightLog.weight_kg })
        .from(weightLog)
        .where(and(gte(weightLog.date, fromStr), lte(weightLog.date, toStr)))
        .orderBy(asc(weightLog.date))

      return { points: rows.map((r) => ({ date: r.date, weightKg: r.weight_kg })) }
    },
    {
      query: WindowQuerySchema,
      response: z.object({
        points: z.array(
          z.object({
            date: z.string().describe('YYYY-MM-DD'),
            weightKg: z.number(),
          }),
        ),
      }),
      detail: {
        tags: ['Garmin Health'],
        summary: 'Body weight time series',
        description:
          'One data point per weight log entry for charting weight trends. ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. ' +
          'Example: GET /weight-log/series?window=all',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const sort = query.sort ?? 'date'
      const order = query.order ?? 'desc'
      const offset = (page - 1) * limit

      const sortCol = sort === 'weight_kg' ? weightLog.weight_kg : weightLog.date

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(weightLog)
          .orderBy(order === 'asc' ? asc(sortCol) : desc(sortCol))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(weightLog),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { data: rows as any, total: Number(countResult[0]?.count ?? 0) }
    },
    {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
        sort: z.enum(['date', 'weight_kg']).optional(),
        order: z.enum(['asc', 'desc']).default('desc').optional(),
      }),
      response: z.object({
        data: z.array(WeightLogSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Garmin Health'],
        summary: 'List weight entries',
        description:
          'Returns paginated body-weight log entries (manual input, not Garmin-synced). `page` is 1-indexed, `limit` ≤ 200. Sort: date (default, newest first), weight_kg. For rolling averages and trend classification use GET /weight-log/summary; for charting use GET /weight-log/series.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '',
    async ({ body, set }) => {
      const [existing] = await db
        .select({ id: weightLog.id })
        .from(weightLog)
        .where(eq(weightLog.date, body.date))
        .orderBy(desc(weightLog.id))
        .limit(1)

      if (existing) {
        await db
          .update(weightLog)
          .set({ weight_kg: body.weight_kg })
          .where(eq(weightLog.id, existing.id))
        set.status = 201
        return { id: existing.id }
      }

      const [result] = await db
        .insert(weightLog)
        .values({ date: body.date, weight_kg: body.weight_kg })
        .returning()
      set.status = 201
      return { id: result!.id }
    },
    {
      body: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weight_kg: z.number().min(30).max(300),
      }),
      response: { 201: z.object({ id: z.number() }) },
      detail: {
        tags: ['Garmin Health'],
        summary: 'Add or replace a weight entry',
        description:
          'Records a body-weight measurement for the given day. `date` is YYYY-MM-DD, `weight_kg` is 30–300. ' +
          'If an entry already exists for that date, its weight is overwritten and the existing row id is returned ' +
          '(one entry per day; later submits replace earlier ones). Otherwise a new row is inserted and its id returned.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, set }) => {
      const [existing] = await db
        .select()
        .from(weightLog)
        .where(eq(weightLog.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }
      await db.delete(weightLog).where(eq(weightLog.id, Number(params.id)))
      return { id: Number(params.id) }
    },
    {
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({ id: z.number() }),
        404: z.string(),
      },
      detail: {
        tags: ['Garmin Health'],
        summary: 'Delete a weight entry',
        description:
          'Removes a weight log entry by id. Returns 404 if no entry with that id exists, 200 with the deleted id on success. Deletes are hard — there is no soft-delete column.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
