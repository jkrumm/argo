import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { garminActivities } from '../db/schema.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const ActivitySchema = z.object({
  activity_id: z.number(),
  date: z.string(),
  start_time_local: z.string(),
  type_key: z.string(),
  activity_name: z.string().nullable(),
  duration_sec: z.number().nullable(),
  distance_m: z.number().nullable(),
  calories: z.number().nullable(),
  avg_hr: z.number().nullable(),
  max_hr: z.number().nullable(),
  aerobic_te: z.number().nullable(),
  anaerobic_te: z.number().nullable(),
  training_effect_label: z.string().nullable(),
  training_load: z.number().nullable(),
  moderate_intensity_min: z.number().nullable(),
  vigorous_intensity_min: z.number().nullable(),
  hr_zone_1_sec: z.number().nullable(),
  hr_zone_2_sec: z.number().nullable(),
  hr_zone_3_sec: z.number().nullable(),
  hr_zone_4_sec: z.number().nullable(),
  hr_zone_5_sec: z.number().nullable(),
  bb_delta: z.number().nullable(),
  steps: z.number().nullable(),
  vo2_max: z.number().nullable(),
  synced_at: z.string().nullable(),
})

const ActivitiesSummarySchema = z.object({
  weeklyMinutes: z
    .number()
    .int()
    .describe('Total active minutes in the 7 days up to the window end date'),
  weeklyByType: z
    .record(z.string(), z.number())
    .describe('Minutes per activity type_key in the last 7 days of the window'),
  totalsWindow: z.object({
    sessions: z.number().int().describe('Total number of activities in window'),
    minutes: z.number().int().describe('Total active minutes in window'),
    distanceKm: z.number().describe('Total distance in km in window'),
    calories: z.number().int().describe('Total calories in window'),
  }),
})

export const activitiesRoutes = new Elysia({ prefix: '/activities' })
  .get(
    '/summary',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      // Last 7 days relative to window end for "weekly" breakdown
      const sevenDaysAgo = new Date(to.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)

      const [windowRows, weeklyRows] = await Promise.all([
        db
          .select({
            type_key: garminActivities.type_key,
            duration_sec: garminActivities.duration_sec,
            distance_m: garminActivities.distance_m,
            calories: garminActivities.calories,
          })
          .from(garminActivities)
          .where(and(gte(garminActivities.date, fromStr), lte(garminActivities.date, toStr))),
        db
          .select({
            type_key: garminActivities.type_key,
            duration_sec: garminActivities.duration_sec,
          })
          .from(garminActivities)
          .where(and(gte(garminActivities.date, sevenDaysAgo), lte(garminActivities.date, toStr))),
      ])

      const weeklyMinutes = Math.round(
        weeklyRows.reduce((sum, r) => sum + (r.duration_sec ?? 0), 0) / 60,
      )

      const weeklyByType: Record<string, number> = {}
      for (const r of weeklyRows) {
        const mins = Math.round((r.duration_sec ?? 0) / 60)
        weeklyByType[r.type_key] = (weeklyByType[r.type_key] ?? 0) + mins
      }

      const totalsWindow = {
        sessions: windowRows.length,
        minutes: Math.round(windowRows.reduce((sum, r) => sum + (r.duration_sec ?? 0), 0) / 60),
        distanceKm:
          Math.round(windowRows.reduce((sum, r) => sum + (r.distance_m ?? 0), 0) / 100) / 10,
        calories: windowRows.reduce((sum, r) => sum + (r.calories ?? 0), 0),
      }

      return { weeklyMinutes, weeklyByType, totalsWindow }
    },
    {
      query: WindowQuerySchema,
      response: ActivitiesSummarySchema,
      detail: {
        tags: ['Summaries'],
        summary: 'Activity summary',
        description:
          'Server-computed activity totals. ' +
          '`weeklyMinutes` and `weeklyByType` cover the 7 days up to the window end date. ' +
          '`totalsWindow` covers the full requested window. ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. ' +
          'Example: GET /activities/summary?window=30d',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const sort = query.sort ?? 'start_time_local'
      const order = query.order ?? 'desc'
      const offset = (page - 1) * limit

      const conds = []
      if (query.date_from) conds.push(gte(garminActivities.date, query.date_from))
      if (query.date_to) conds.push(lte(garminActivities.date, query.date_to))
      const where = conds.length > 0 ? and(...conds) : undefined

      const sortCol =
        sort === 'date'
          ? garminActivities.date
          : sort === 'duration_sec'
            ? garminActivities.duration_sec
            : sort === 'calories'
              ? garminActivities.calories
              : garminActivities.start_time_local

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(garminActivities)
          .where(where)
          .orderBy(order === 'asc' ? asc(sortCol) : desc(sortCol))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(garminActivities).where(where),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { data: rows as any, total: Number(countResult[0]?.count ?? 0) }
    },
    {
      query: z.object({
        page: z.number().int().min(1).default(1).optional(),
        limit: z.number().int().min(1).max(200).default(50).optional(),
        sort: z.enum(['start_time_local', 'date', 'duration_sec', 'calories']).optional(),
        order: z.enum(['asc', 'desc']).default('desc').optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      }),
      response: z.object({
        data: z.array(ActivitySchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Activities'],
        summary: 'List Garmin activities',
        description:
          'Returns paginated Garmin activities. `page` is 1-indexed, `limit` ≤ 200. Filter by date_from/date_to (YYYY-MM-DD). Sort: start_time_local (default), date, duration_sec, calories.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
