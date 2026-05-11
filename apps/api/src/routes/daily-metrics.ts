import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics, syncControl } from '../db/schema.js'

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
    '/',
    async ({ query, set }) => {
      const conds = []
      if (query.date_from) conds.push(gte(dailyMetrics.date, query.date_from))
      if (query.date_to) conds.push(lte(dailyMetrics.date, query.date_to))
      const where = conds.length > 0 ? and(...conds) : undefined

      const rows = await db
        .select()
        .from(dailyMetrics)
        .where(where)
        .orderBy(query._order === 'desc' ? desc(dailyMetrics.date) : asc(dailyMetrics.date))

      set.headers['x-total-count'] = String(rows.length)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows as any
    },
    {
      query: z.object({
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        _order: z.string().optional(),
      }),
      response: z.array(DailyMetricSchema),
      detail: {
        tags: ['Daily Metrics'],
        summary: 'List daily Garmin metrics with optional date range filter',
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
      // Set the flag — garmin-sync polls sync_control every ~30s and runs immediately.
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
