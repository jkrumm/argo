import { Elysia } from 'elysia'
import { z } from 'zod'
import { asc, count, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { exercises } from '../db/schema.js'

const ExerciseRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  muscle_group: z.string(),
  is_bodyweight: z.number().nullable(),
  display_order: z.number().nullable(),
})

export const exerciseRoutes = new Elysia({ prefix: '/exercises' }).get(
  '/',
  async ({ query }) => {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const sort = query.sort ?? 'display_order'
    const order = query.order ?? 'asc'
    const offset = (page - 1) * limit

    const sortCol =
      sort === 'name'
        ? exercises.name
        : sort === 'category'
          ? exercises.category
          : exercises.display_order

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(exercises)
        .orderBy(order === 'desc' ? desc(sortCol) : asc(sortCol))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(exercises),
    ])

    return { data: rows, total: Number(countResult[0]?.count ?? 0) }
  },
  {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
      sort: z.enum(['display_order', 'name', 'category']).optional(),
      order: z.enum(['asc', 'desc']).default('asc').optional(),
    }),
    response: z.object({
      data: z.array(ExerciseRowSchema),
      total: z.number().int(),
    }),
    detail: {
      tags: ['Exercises'],
      summary: 'List exercises',
      description:
        'Returns paginated exercises. `page` is 1-indexed, `limit` ≤ 200. Sort: display_order (default), name, category.',
      security: [{ BearerAuth: [] }],
    },
  },
)
