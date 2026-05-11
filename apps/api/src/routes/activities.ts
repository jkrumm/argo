import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { garminActivities } from '../db/schema.js'

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

export const activitiesRoutes = new Elysia({ prefix: '/activities' }).get(
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
