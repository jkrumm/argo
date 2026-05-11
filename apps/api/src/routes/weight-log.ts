import { Elysia } from 'elysia'
import { z } from 'zod'
import { asc, desc, eq, sql } from 'drizzle-orm'
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
    async ({ query, set }) => {
      const countResult = await db.select({ count: sql<number>`count(*)` }).from(weightLog)
      const count = countResult[0]?.count ?? 0

      set.headers['x-total-count'] = String(count)

      const rows = await db
        .select()
        .from(weightLog)
        .orderBy(query._order === 'asc' ? asc(weightLog.date) : desc(weightLog.date))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows as any
    },
    {
      query: z.object({
        _order: z.string().optional(),
      }),
      response: z.array(WeightLogSchema),
      detail: {
        tags: ['Weight Log'],
        summary: 'List all weight entries',
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
