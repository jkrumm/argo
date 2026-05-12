import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workoutSets } from '../db/schema.js'
import { SetTypeSchema, WorkoutSetSchema } from './schemas.js'

export const workoutSetRoutes = new Elysia({ prefix: '/workout-sets' })
  .get(
    '/',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const order = query.order ?? 'asc'
      const offset = (page - 1) * limit

      const conds = []
      if (query.workout_id) conds.push(eq(workoutSets.workout_id, Number(query.workout_id)))
      const where = conds.length > 0 ? and(...conds) : undefined

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(workoutSets)
          .where(where)
          .orderBy(
            order === 'desc' ? desc(workoutSets.workout_id) : asc(workoutSets.workout_id),
            order === 'desc' ? desc(workoutSets.set_number) : asc(workoutSets.set_number),
          )
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(workoutSets).where(where),
      ])

      return { data: rows, total: Number(countResult[0]?.count ?? 0) }
    },
    {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
        order: z.enum(['asc', 'desc']).default('asc').optional(),
        workout_id: z.string().optional(),
      }),
      response: z.object({
        data: z.array(WorkoutSetSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Workout Sets'],
        summary: 'List workout sets',
        description:
          'Returns paginated workout sets. `page` is 1-indexed, `limit` ≤ 200. Filter by workout_id. Ordered by workout_id then set_number.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, set }) => {
      const [row] = await db
        .insert(workoutSets)
        .values({
          workout_id: body.workout_id,
          set_number: body.set_number,
          set_type: body.set_type,
          weight_kg: body.weight_kg,
          reps: body.reps,
        })
        .returning()
      set.status = 201
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return row! as any
    },
    {
      body: z.object({
        workout_id: z.number().min(1),
        set_number: z.number().min(1),
        set_type: SetTypeSchema,
        weight_kg: z.number().min(0),
        reps: z.number().int().min(1),
      }),
      response: { 201: WorkoutSetSchema },
      detail: {
        tags: ['Workout Sets'],
        summary: 'Create a workout set',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, set }) => {
      const [existing] = await db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      const updateData: Partial<typeof workoutSets.$inferInsert> = {}
      if (body.set_number !== undefined) updateData.set_number = body.set_number
      if (body.set_type !== undefined) updateData.set_type = body.set_type
      if (body.weight_kg !== undefined) updateData.weight_kg = body.weight_kg
      if (body.reps !== undefined) updateData.reps = body.reps

      if (Object.keys(updateData).length > 0) {
        await db
          .update(workoutSets)
          .set(updateData)
          .where(eq(workoutSets.id, Number(params.id)))
      }

      const [updated] = await db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.id, Number(params.id)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return updated! as any
    },
    {
      params: z.object({ id: z.string() }),
      body: z.object({
        set_number: z.number().min(1).optional(),
        set_type: SetTypeSchema.optional(),
        weight_kg: z.number().min(0).optional(),
        reps: z.number().int().min(1).optional(),
      }),
      response: {
        200: WorkoutSetSchema,
        404: z.string(),
      },
      detail: {
        tags: ['Workout Sets'],
        summary: 'Update a workout set',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, set }) => {
      const [existing] = await db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      await db.delete(workoutSets).where(eq(workoutSets.id, Number(params.id)))
      return { id: Number(params.id) }
    },
    {
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({ id: z.number() }),
        404: z.string(),
      },
      detail: {
        tags: ['Workout Sets'],
        summary: 'Delete a workout set',
        security: [{ BearerAuth: [] }],
      },
    },
  )
