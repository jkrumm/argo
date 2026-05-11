import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, desc, gte, lte } from 'drizzle-orm'
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
  async ({ query, set }) => {
    const conds = []
    if (query.date_from) conds.push(gte(garminActivities.date, query.date_from))
    if (query.date_to) conds.push(lte(garminActivities.date, query.date_to))
    const where = conds.length > 0 ? and(...conds) : undefined

    const rows = await db
      .select()
      .from(garminActivities)
      .where(where)
      .orderBy(
        query._order === 'desc'
          ? desc(garminActivities.start_time_local)
          : asc(garminActivities.start_time_local),
      )

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
    response: z.array(ActivitySchema),
    detail: {
      tags: ['Activities'],
      summary: 'List Garmin activities (workouts) with optional date range filter',
      security: [{ BearerAuth: [] }],
    },
  },
)
