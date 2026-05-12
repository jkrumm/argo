import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workoutSets } from '../db/schema.js'
import { SetTypeSchema, WorkoutSetSchema } from './schemas.js'

export const workoutSetRoutes = new Elysia({ prefix: '/workout-sets' })
  .get(
    '',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const order = query.order ?? 'asc'
      const offset = (page - 1) * limit

      const conds = []
      if (query.workoutId !== undefined) conds.push(eq(workoutSets.workout_id, query.workoutId))
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
        workoutId: z.coerce.number().int().min(1).optional(),
      }),
      response: z.object({
        data: z.array(WorkoutSetSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'List workout sets',
        description:
          'Returns individual workout-set rows (paginated). Most callers should use GET /workouts which already embeds sets — this raw endpoint is for cases where you need set-level filtering across workouts. `page` is 1-indexed, `limit` ≤ 200. Filter by `workoutId` to scope to one session. Ordered by workout_id then set_number.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '',
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
        tags: ['Strength'],
        summary: 'Append a set to a workout',
        description:
          'Inserts a single set into an existing workout. Most callers should send the full set list in POST /workouts (transactional) or PATCH /workouts/{id} (replace-all). This endpoint is for incremental "add one more set" flows. `set_type` values: warmup, work, drop, amrap. No referential check on workout_id — pass a real one.',
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
        tags: ['Strength'],
        summary: 'Update a workout set',
        description:
          'Partial update of a single set (set_number, set_type, weight_kg, reps). 404 if no set with that id exists. Returns the updated row. Note: PATCH /workouts/{id} replaces the whole set list — use that for bulk edits.',
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
        tags: ['Strength'],
        summary: 'Delete a workout set',
        description:
          'Removes a single set by id. Returns 404 if no set with that id exists. To delete an entire workout (and all its sets) use DELETE /workouts/{id} instead.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
