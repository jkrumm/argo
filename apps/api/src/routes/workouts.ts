import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workouts, workoutSets, exercises, weightLog, userProfile } from '../db/schema.js'
import { SetTypeSchema, WorkoutSetSchema } from './schemas.js'

const WorkoutWithSetsSchema = z.object({
  id: z.number(),
  date: z.string(),
  exercise_id: z.string(),
  exercise_name: z.string().nullable(),
  is_bodyweight: z.number().nullable(),
  notes: z.string().nullable(),
  created_at: z.string().nullable(),
  sets: z.array(WorkoutSetSchema),
  estimated_1rm_epley: z.number().nullable(),
  estimated_1rm_brzycki: z.number().nullable(),
  estimated_1rm: z.number().nullable(),
  total_volume: z.number(),
})

// Bodyweight resolution for pull-ups: weight_log latest-on-or-before the workout date,
// then earliest weight_log entry (so a recent first entry still applies to backfilled
// historical workouts), then user_profile.goal_weight_kg, then 80 kg.
const HARD_FALLBACK_BW = 80

type WeightEntry = { date: string; weight_kg: number }

function makeBodyweightResolver(
  entries: WeightEntry[],
  profileFallback: number,
): (date: string) => number {
  if (entries.length === 0) return () => profileFallback
  // entries arrive sorted asc by date
  const earliest = entries[0]!.weight_kg
  return (date: string) => {
    let latest: number | null = null
    for (const e of entries) {
      if (e.date <= date) latest = e.weight_kg
      else break
    }
    return latest ?? earliest
  }
}

async function loadBodyweightResolver(): Promise<(date: string) => number> {
  const entries = await db
    .select({ date: weightLog.date, weight_kg: weightLog.weight_kg })
    .from(weightLog)
    .orderBy(asc(weightLog.date))
  const [profile] = await db
    .select({ goal_weight_kg: userProfile.goal_weight_kg })
    .from(userProfile)
    .where(eq(userProfile.id, 1))
  const profileFallback = profile?.goal_weight_kg ?? HARD_FALLBACK_BW
  return makeBodyweightResolver(entries, profileFallback)
}

function computeMetrics(
  sets: Array<{ set_type: string; weight_kg: number; reps: number }>,
  exercise_id: string,
  bodyweightKg: number,
) {
  const isPullUps = exercise_id === 'pull_ups'
  let totalVolume = 0
  let maxEpley: number | null = null
  let maxBrzycki: number | null = null

  for (const s of sets) {
    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    totalVolume += ew * s.reps
  }

  for (const s of sets) {
    const eligible =
      (s.set_type === 'work' || s.set_type === 'amrap') && s.reps >= 1 && s.reps <= 12
    if (!eligible) continue

    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    const epley = ew * (1 + s.reps / 30)
    maxEpley = maxEpley === null ? epley : Math.max(maxEpley, epley)

    if (s.reps <= 10) {
      const brzycki = (ew * 36) / (37 - s.reps)
      maxBrzycki = maxBrzycki === null ? brzycki : Math.max(maxBrzycki, brzycki)
    }
  }

  const e = maxEpley !== null ? Math.round(maxEpley * 10) / 10 : null
  const b = maxBrzycki !== null ? Math.round(maxBrzycki * 10) / 10 : null

  let e1rm: number | null = null
  if (e !== null && b !== null) e1rm = Math.round(((e + b) / 2) * 10) / 10
  else if (b !== null) e1rm = b
  else if (e !== null) e1rm = e

  return {
    estimated_1rm_epley: e,
    estimated_1rm_brzycki: b,
    estimated_1rm: e1rm,
    total_volume: Math.round(totalVolume * 10) / 10,
  }
}

function orderColumn(field: string) {
  if (field === 'exercise_id' || field === 'exercise') return workouts.exercise_id
  if (field === 'id') return workouts.id
  if (field === 'created_at') return workouts.created_at
  return workouts.date
}

export const workoutRoutes = new Elysia({ prefix: '/workouts' })
  .get(
    '/',
    async ({ query, set }) => {
      const start = Math.max(0, Number(query._start ?? 0))
      const end = Number(query._end ?? start + 10)
      const limit = Math.max(0, end - start)

      const conds = []
      if (query.exercise) conds.push(eq(workouts.exercise_id, query.exercise))
      if (query.date_from) conds.push(gte(workouts.date, query.date_from))
      if (query.date_to) conds.push(lte(workouts.date, query.date_to))
      const where = conds.length > 0 ? and(...conds) : undefined

      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(workouts)
        .where(where)
      const count = countResult[0]?.count ?? 0

      set.headers['x-total-count'] = String(count)

      if (limit === 0) return []

      const col = orderColumn(query._sort ?? 'date')
      const rows = await db
        .select({
          id: workouts.id,
          date: workouts.date,
          exercise_id: workouts.exercise_id,
          exercise_name: exercises.name,
          is_bodyweight: exercises.is_bodyweight,
          notes: workouts.notes,
          created_at: workouts.created_at,
        })
        .from(workouts)
        .leftJoin(exercises, eq(workouts.exercise_id, exercises.id))
        .where(where)
        .orderBy((query._order ?? 'desc') === 'asc' ? asc(col) : desc(col))
        .limit(limit)
        .offset(start)

      if (rows.length === 0) return []

      const ids = rows.map((w) => w.id)
      const allSets = await db
        .select()
        .from(workoutSets)
        .where(inArray(workoutSets.workout_id, ids))

      const setMap = new Map<number, typeof allSets>()
      for (const s of allSets) {
        const list = setMap.get(s.workout_id) ?? []
        list.push(s)
        setMap.set(s.workout_id, list)
      }

      const bwAt = await loadBodyweightResolver()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((w) => {
        const wSets = setMap.get(w.id) ?? []
        return { ...w, sets: wSets, ...computeMetrics(wSets, w.exercise_id, bwAt(w.date)) }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    },
    {
      query: z.object({
        _start: z.string().optional(),
        _end: z.string().optional(),
        _sort: z.string().optional(),
        _order: z.string().optional(),
        exercise: z.string().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      }),
      response: z.array(WorkoutWithSetsSchema),
      detail: {
        tags: ['Workouts'],
        summary: 'List workouts',
        description:
          'Refine-compatible pagination (_start/_end), sorting (_sort/_order), filtering (exercise, date_from, date_to). Returns x-total-count header.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      const [row] = await db
        .select({
          id: workouts.id,
          date: workouts.date,
          exercise_id: workouts.exercise_id,
          exercise_name: exercises.name,
          is_bodyweight: exercises.is_bodyweight,
          notes: workouts.notes,
          created_at: workouts.created_at,
        })
        .from(workouts)
        .leftJoin(exercises, eq(workouts.exercise_id, exercises.id))
        .where(eq(workouts.id, Number(params.id)))
      if (!row) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }
      const sets = await db.select().from(workoutSets).where(eq(workoutSets.workout_id, row.id))
      const bwAt = await loadBodyweightResolver()
      const metrics = computeMetrics(sets, row.exercise_id, bwAt(row.date))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ...row, sets, ...metrics } as any
    },
    {
      params: z.object({ id: z.string() }),
      response: {
        200: WorkoutWithSetsSchema,
        404: z.string(),
      },
      detail: {
        tags: ['Workouts'],
        summary: 'Get workout by ID with sets and computed 1RM metrics',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, set }) => {
      const [exists] = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(eq(exercises.id, body.exercise_id))
      if (!exists) {
        set.status = 400
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return `Unknown exercise_id: ${body.exercise_id}` as any
      }
      const result = await db.transaction(async (tx) => {
        const [workout] = await tx
          .insert(workouts)
          .values({
            date: body.date,
            exercise_id: body.exercise_id,
            notes: body.notes ?? null,
          })
          .returning()
        if (body.sets.length > 0) {
          await tx.insert(workoutSets).values(
            body.sets.map((s) => ({
              workout_id: workout!.id,
              set_number: s.set_number,
              set_type: s.set_type,
              weight_kg: s.weight_kg,
              reps: s.reps,
            })),
          )
        }
        return workout!
      })
      set.status = 201
      return { id: result.id }
    },
    {
      body: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('YYYY-MM-DD'),
        exercise_id: z.string(),
        notes: z.string().optional(),
        sets: z.array(
          z.object({
            set_number: z.number().min(1),
            set_type: SetTypeSchema,
            weight_kg: z.number().min(0),
            reps: z.number().int().min(1),
          }),
        ),
      }),
      response: {
        201: z.object({ id: z.number() }),
        400: z.string(),
      },
      detail: {
        tags: ['Workouts'],
        summary: 'Create workout with sets (transactional)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, set }) => {
      const [existing] = await db
        .select()
        .from(workouts)
        .where(eq(workouts.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      if (body.exercise_id !== undefined) {
        const [ok] = await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(eq(exercises.id, body.exercise_id))
        if (!ok) {
          set.status = 400
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return `Unknown exercise_id: ${body.exercise_id}` as any
        }
      }

      await db.transaction(async (tx) => {
        const updateData: Partial<typeof workouts.$inferInsert> = {}
        if (body.date !== undefined) updateData.date = body.date
        if (body.exercise_id !== undefined) updateData.exercise_id = body.exercise_id
        if (body.notes !== undefined) updateData.notes = body.notes

        if (Object.keys(updateData).length > 0) {
          await tx
            .update(workouts)
            .set(updateData)
            .where(eq(workouts.id, Number(params.id)))
        }

        if (body.sets !== undefined) {
          await tx.delete(workoutSets).where(eq(workoutSets.workout_id, Number(params.id)))
          if (body.sets.length > 0) {
            await tx.insert(workoutSets).values(
              body.sets.map((s) => ({
                workout_id: Number(params.id),
                set_number: s.set_number,
                set_type: s.set_type,
                weight_kg: s.weight_kg,
                reps: s.reps,
              })),
            )
          }
        }
      })

      return { id: existing.id }
    },
    {
      params: z.object({ id: z.string() }),
      body: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        exercise_id: z.string().optional(),
        notes: z.string().nullable().optional(),
        sets: z
          .array(
            z.object({
              set_number: z.number().min(1),
              set_type: SetTypeSchema,
              weight_kg: z.number().min(0),
              reps: z.number().int().min(1),
            }),
          )
          .optional(),
      }),
      response: {
        200: z.object({ id: z.number() }),
        400: z.string(),
        404: z.string(),
      },
      detail: {
        tags: ['Workouts'],
        summary: 'Update workout (exercise_id, date, notes, sets)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, set }) => {
      const [existing] = await db
        .select()
        .from(workouts)
        .where(eq(workouts.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }

      await db.transaction(async (tx) => {
        await tx.delete(workoutSets).where(eq(workoutSets.workout_id, Number(params.id)))
        await tx.delete(workouts).where(eq(workouts.id, Number(params.id)))
      })

      return { id: Number(params.id) }
    },
    {
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({ id: z.number() }),
        404: z.string(),
      },
      detail: {
        tags: ['Workouts'],
        summary: 'Delete workout and cascade delete all its sets',
        security: [{ BearerAuth: [] }],
      },
    },
  )
