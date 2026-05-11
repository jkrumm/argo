import { Elysia } from 'elysia'
import { z } from 'zod'
import { asc, count, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { weightLog } from '../db/schema.js'

const WeightLogSchema = z.object({
  id: z.number(),
  date: z.string(),
  weight_kg: z.number(),
  created_at: z.string().nullable(),
})

export const weightLogRoutes = new Elysia({ prefix: '/weight-log' })
  .get(
    '/',
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
        page: z.number().int().min(1).default(1).optional(),
        limit: z.number().int().min(1).max(200).default(50).optional(),
        sort: z.enum(['date', 'weight_kg']).optional(),
        order: z.enum(['asc', 'desc']).default('desc').optional(),
      }),
      response: z.object({
        data: z.array(WeightLogSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Weight Log'],
        summary: 'List weight entries',
        description:
          'Returns paginated weight log entries. `page` is 1-indexed, `limit` ≤ 200. Sort: date (default), weight_kg.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, set }) => {
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
        tags: ['Weight Log'],
        summary: 'Add a weight entry',
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
        tags: ['Weight Log'],
        summary: 'Delete a weight entry',
        security: [{ BearerAuth: [] }],
      },
    },
  )
