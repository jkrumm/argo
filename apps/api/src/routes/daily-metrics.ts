import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics, syncControl } from '../db/schema.js'
import { computeStats } from '../lib/formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const DailyMetricSchema = z.object({
  date: z.string(),
  steps: z.number().nullable(),
  distance_m: z.number().nullable(),
  total_kcal: z.number().nullable(),
  active_kcal: z.number().nullable(),
  floors_ascended: z.number().nullable(),
  moderate_intensity_min: z.number().nullable(),
  vigorous_intensity_min: z.number().nullable(),
  resting_hr: z.number().nullable(),
  max_hr: z.number().nullable(),
  min_hr: z.number().nullable(),
  hrv_last_night_avg: z.number().nullable(),
  hrv_last_night_5min_high: z.number().nullable(),
  hrv_weekly_avg: z.number().nullable(),
  hrv_status: z.string().nullable(),
  sleep_score: z.number().nullable(),
  sleep_duration_sec: z.number().nullable(),
  deep_sleep_sec: z.number().nullable(),
  light_sleep_sec: z.number().nullable(),
  rem_sleep_sec: z.number().nullable(),
  awake_sleep_sec: z.number().nullable(),
  avg_sleep_stress: z.number().nullable(),
  avg_sleep_hr: z.number().nullable(),
  avg_sleep_respiration: z.number().nullable(),
  avg_stress: z.number().nullable(),
  max_stress: z.number().nullable(),
  bb_highest: z.number().nullable(),
  bb_lowest: z.number().nullable(),
  bb_charged: z.number().nullable(),
  bb_drained: z.number().nullable(),
  avg_waking_respiration: z.number().nullable(),
  avg_spo2: z.number().nullable(),
  lowest_spo2: z.number().nullable(),
  vo2_max: z.number().nullable(),
  completed: z.number().nullable(),
  synced_at: z.string().nullable(),
})

const SyncStatusSchema = z.object({
  refresh_requested: z.boolean(),
  in_progress: z.boolean(),
  last_started_at: z.string().nullable(),
  last_completed_at: z.string().nullable(),
  last_status: z.string().nullable(),
  last_message: z.string().nullable(),
})

const MetricStatsSchema = z.object({
  current: z.number().nullable().describe('Most recent non-null value in window'),
  ma7: z
    .number()
    .nullable()
    .describe('Average of up to 7 most-recent non-null values; fewer when window < 7 days'),
  ma30: z
    .number()
    .nullable()
    .describe('Average of up to 30 most-recent non-null values; fewer when window < 30 days'),
  trend: z
    .enum(['up', 'down', 'flat'])
    .describe('up = ma7 > ma30 by >0.5%; down = ma7 < ma30 by >0.5%; flat = otherwise'),
})

const DailyMetricsSummarySchema = z.object({
  hrv: MetricStatsSchema.describe(
    'HRV last night avg (ms). Higher is generally better — trend "up" means improving recovery.',
  ),
  restingHr: MetricStatsSchema.describe(
    'Resting heart rate (bpm). Lower is generally better — trend "down" means improving fitness.',
  ),
  sleep: MetricStatsSchema.describe(
    'Sleep score (0–100). Higher is better — trend "up" means improving sleep quality.',
  ),
  stress: MetricStatsSchema.describe(
    'Average stress level (0–100). Lower is generally better — trend "down" means less stress.',
  ),
})

const DailyMetricsSeriesPointSchema = z.object({
  date: z.string().describe('YYYY-MM-DD'),
  hrv: z.number().nullable(),
  restingHr: z.number().nullable(),
  sleepScore: z.number().nullable(),
  stress: z.number().nullable(),
  steps: z.number().nullable(),
  activeKcal: z.number().nullable(),
  sleepDurationSec: z.number().nullable(),
})

async function readSyncStatus() {
  const [row] = await db.select().from(syncControl).where(eq(syncControl.id, 1))
  return {
    refresh_requested: Boolean(row?.refresh_requested),
    in_progress: Boolean(row?.in_progress),
    last_started_at: row?.last_started_at ?? null,
    last_completed_at: row?.last_completed_at ?? null,
    last_status: row?.last_status ?? null,
    last_message: row?.last_message ?? null,
  }
}

export const dailyMetricsRoutes = new Elysia({ prefix: '/daily-metrics' })
  .get(
    '/summary',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      // Ordered most-recent-first so slice(0, N) gives the N most recent values
      const rows = await db
        .select({
          hrv_last_night_avg: dailyMetrics.hrv_last_night_avg,
          resting_hr: dailyMetrics.resting_hr,
          sleep_score: dailyMetrics.sleep_score,
          avg_stress: dailyMetrics.avg_stress,
        })
        .from(dailyMetrics)
        .where(and(gte(dailyMetrics.date, fromStr), lte(dailyMetrics.date, toStr)))
        .orderBy(desc(dailyMetrics.date))

      return {
        hrv: computeStats(rows.map((r) => r.hrv_last_night_avg)),
        restingHr: computeStats(rows.map((r) => r.resting_hr)),
        sleep: computeStats(rows.map((r) => r.sleep_score)),
        stress: computeStats(rows.map((r) => r.avg_stress)),
      }
    },
    {
      query: WindowQuerySchema,
      response: DailyMetricsSummarySchema,
      detail: {
        tags: ['Summaries'],
        summary: 'Daily metrics health summary',
        description:
          'Server-computed rolling stats for HRV, resting HR, sleep score, and stress. ' +
          'ma7 = average of the 7 most-recent non-null values in the window; ma30 = 30 most-recent. ' +
          'Trend: ma7 vs ma30 — if ma7 > ma30 by >0.5% → "up"; if ma7 < ma30 by >0.5% → "down"; else "flat". ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. ' +
          'Example: GET /daily-metrics/summary?window=30d',
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
        .select({
          date: dailyMetrics.date,
          hrv_last_night_avg: dailyMetrics.hrv_last_night_avg,
          resting_hr: dailyMetrics.resting_hr,
          sleep_score: dailyMetrics.sleep_score,
          avg_stress: dailyMetrics.avg_stress,
          steps: dailyMetrics.steps,
          active_kcal: dailyMetrics.active_kcal,
          sleep_duration_sec: dailyMetrics.sleep_duration_sec,
        })
        .from(dailyMetrics)
        .where(and(gte(dailyMetrics.date, fromStr), lte(dailyMetrics.date, toStr)))
        .orderBy(asc(dailyMetrics.date))

      return {
        points: rows.map((r) => ({
          date: r.date,
          hrv: r.hrv_last_night_avg,
          restingHr: r.resting_hr,
          sleepScore: r.sleep_score,
          stress: r.avg_stress,
          steps: r.steps,
          activeKcal: r.active_kcal,
          sleepDurationSec: r.sleep_duration_sec,
        })),
      }
    },
    {
      query: WindowQuerySchema,
      response: z.object({ points: z.array(DailyMetricsSeriesPointSchema) }),
      detail: {
        tags: ['Summaries'],
        summary: 'Daily metrics time series',
        description:
          'One data point per day for charting HRV, resting HR, sleep score, stress, steps, active kcal, and sleep duration. ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. ' +
          'Example: GET /daily-metrics/series?window=90d',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const order = query.order ?? 'desc'
      const offset = (page - 1) * limit

      const conds = []
      if (query.date_from) conds.push(gte(dailyMetrics.date, query.date_from))
      if (query.date_to) conds.push(lte(dailyMetrics.date, query.date_to))
      const where = conds.length > 0 ? and(...conds) : undefined

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(dailyMetrics)
          .where(where)
          .orderBy(order === 'desc' ? desc(dailyMetrics.date) : asc(dailyMetrics.date))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(dailyMetrics).where(where),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { data: rows as any, total: Number(countResult[0]?.count ?? 0) }
    },
    {
      query: z.object({
        page: z.number().int().min(1).default(1).optional(),
        limit: z.number().int().min(1).max(200).default(50).optional(),
        order: z.enum(['asc', 'desc']).default('desc').optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      }),
      response: z.object({
        data: z.array(DailyMetricSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Daily Metrics'],
        summary: 'List daily Garmin metrics',
        description:
          'Returns paginated daily metrics. `page` is 1-indexed, `limit` ≤ 200. Filter by date_from/date_to (YYYY-MM-DD). Ordered by date descending by default.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get('/sync-status', async () => readSyncStatus(), {
    response: SyncStatusSchema,
    detail: {
      tags: ['Daily Metrics'],
      summary: 'Get garmin-sync state (last run, in-progress, queued refresh)',
      security: [{ BearerAuth: [] }],
    },
  })
  .post(
    '/refresh',
    async () => {
      await db
        .update(syncControl)
        .set({ refresh_requested: 1, requested_at: new Date().toISOString() })
        .where(eq(syncControl.id, 1))
      return readSyncStatus()
    },
    {
      response: SyncStatusSchema,
      detail: {
        tags: ['Daily Metrics'],
        summary: 'Queue an on-demand garmin-sync refresh (picked up within ~30s)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
