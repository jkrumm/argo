import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, count, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workouts, workoutSets, exercises } from '../db/schema.js'
import { SetTypeSchema, WorkoutSetSchema } from './schemas.js'
import { computeMetrics, loadBodyweightResolver } from '../lib/formulas.js'
import { detectAchievements, type WorkoutWithSets } from '../lib/strength-formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const AchievementSchema = z.object({
  type: z.enum([
    'first_workout',
    'weight_milestone',
    'max_weight_pr',
    'estimated_1rm_pr',
    'volume_pr',
  ]),
  title: z.string(),
  description: z.string(),
  confetti: z.boolean(),
})

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

const StrengthSummaryItemSchema = z.object({
  exercise_id: z.string(),
  exercise_name: z.string(),
  currentE1RM: z.number().nullable(),
  bestE1RM: z.number().nullable(),
  prDate: z.string().nullable().describe('YYYY-MM-DD date of best e1RM in window'),
  totalVolumeWindow: z.number().describe('Sum of all set volumes (weight × reps) in window'),
  sessionCountWindow: z.number().int().describe('Number of workout sessions in window'),
})

const SeriesPointSchema = z.object({
  date: z.string().describe('YYYY-MM-DD'),
  e1rm: z.number().nullable().describe('Estimated 1RM (average of Epley and Brzycki)'),
  volume: z.number().describe('Total session volume (weight × reps)'),
  maxWeight: z.number().describe('Heaviest weight lifted (effective weight including bodyweight)'),
})

type WorkoutSort = 'date' | 'id' | 'exercise_id' | 'created_at'

function orderColumn(sort: WorkoutSort) {
  if (sort === 'exercise_id') return workouts.exercise_id
  if (sort === 'id') return workouts.id
  if (sort === 'created_at') return workouts.created_at
  return workouts.date
}

export const workoutRoutes = new Elysia({ prefix: '/workouts' })
  .get(
    '/summary/strength',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      const allWorkouts = await db
        .select({
          id: workouts.id,
          date: workouts.date,
          exercise_id: workouts.exercise_id,
          exercise_name: exercises.name,
        })
        .from(workouts)
        .leftJoin(exercises, eq(workouts.exercise_id, exercises.id))
        .where(and(gte(workouts.date, fromStr), lte(workouts.date, toStr)))
        .orderBy(asc(workouts.date))

      if (allWorkouts.length === 0) return { byExercise: [] }

      const ids = allWorkouts.map((w) => w.id)
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

      type ExerciseAgg = {
        exercise_id: string
        exercise_name: string
        sessions: Array<{ date: string; e1rm: number | null; volume: number }>
      }
      const exerciseMap = new Map<string, ExerciseAgg>()

      for (const w of allWorkouts) {
        const wSets = setMap.get(w.id) ?? []
        const metrics = computeMetrics(wSets, w.exercise_id, bwAt(w.date))
        let entry = exerciseMap.get(w.exercise_id)
        if (!entry) {
          entry = {
            exercise_id: w.exercise_id,
            exercise_name: w.exercise_name ?? w.exercise_id,
            sessions: [],
          }
          exerciseMap.set(w.exercise_id, entry)
        }
        entry.sessions.push({
          date: w.date,
          e1rm: metrics.estimated_1rm,
          volume: metrics.total_volume,
        })
      }

      const byExercise = Array.from(exerciseMap.values()).map(
        ({ exercise_id, exercise_name, sessions }) => {
          const currentE1RM = sessions.at(-1)?.e1rm ?? null
          let bestE1RM: number | null = null
          let prDate: string | null = null
          let totalVolumeWindow = 0

          for (const s of sessions) {
            totalVolumeWindow += s.volume
            if (s.e1rm !== null && (bestE1RM === null || s.e1rm > bestE1RM)) {
              bestE1RM = s.e1rm
              prDate = s.date
            }
          }

          return {
            exercise_id,
            exercise_name,
            currentE1RM: currentE1RM !== null ? Math.round(currentE1RM * 10) / 10 : null,
            bestE1RM: bestE1RM !== null ? Math.round(bestE1RM * 10) / 10 : null,
            prDate,
            totalVolumeWindow: Math.round(totalVolumeWindow * 10) / 10,
            sessionCountWindow: sessions.length,
          }
        },
      )

      return { byExercise }
    },
    {
      query: WindowQuerySchema,
      response: z.object({ byExercise: z.array(StrengthSummaryItemSchema) }),
      detail: {
        tags: ['Strength'],
        summary: 'Strength summary by exercise',
        description:
          'Server-computed aggregates per exercise for the given window. ' +
          '`currentE1RM` = e1RM of the most recent session; `bestE1RM` = highest e1RM in window; ' +
          '`prDate` = date that best e1RM was achieved. ' +
          'e1RM = average of Epley (w × (1 + reps/30)) and Brzycki (w × 36 / (37 - reps)), work/amrap sets only, reps 1–12. ' +
          'Volume = Σ(effective_weight × reps) across all sets. ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/series',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      const allWorkouts = await db
        .select({
          id: workouts.id,
          date: workouts.date,
          exercise_id: workouts.exercise_id,
          exercise_name: exercises.name,
        })
        .from(workouts)
        .leftJoin(exercises, eq(workouts.exercise_id, exercises.id))
        .where(and(gte(workouts.date, fromStr), lte(workouts.date, toStr)))
        .orderBy(asc(workouts.date))

      if (allWorkouts.length === 0) return { byExercise: [] }

      const ids = allWorkouts.map((w) => w.id)
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

      type SeriesAgg = {
        exercise_id: string
        exercise_name: string
        points: Array<{ date: string; e1rm: number | null; volume: number; maxWeight: number }>
      }
      const exerciseMap = new Map<string, SeriesAgg>()

      for (const w of allWorkouts) {
        const wSets = setMap.get(w.id) ?? []
        const bw = bwAt(w.date)
        const metrics = computeMetrics(wSets, w.exercise_id, bw)
        const isPullUps = w.exercise_id === 'pull_ups'
        const maxWeight = wSets.reduce((max, s) => {
          const ew = isPullUps ? s.weight_kg + bw : s.weight_kg
          return Math.max(max, ew)
        }, 0)

        let entry = exerciseMap.get(w.exercise_id)
        if (!entry) {
          entry = {
            exercise_id: w.exercise_id,
            exercise_name: w.exercise_name ?? w.exercise_id,
            points: [],
          }
          exerciseMap.set(w.exercise_id, entry)
        }
        entry.points.push({
          date: w.date,
          e1rm: metrics.estimated_1rm,
          volume: metrics.total_volume,
          maxWeight: Math.round(maxWeight * 10) / 10,
        })
      }

      const byExercise = Array.from(exerciseMap.values()).map(
        ({ exercise_id, exercise_name, points }) => ({
          exercise_id,
          exercise_name,
          points,
        }),
      )

      return { byExercise }
    },
    {
      query: WindowQuerySchema,
      response: z.object({
        byExercise: z.array(
          z.object({
            exercise_id: z.string(),
            exercise_name: z.string(),
            points: z.array(SeriesPointSchema),
          }),
        ),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'Strength time series by exercise',
        description:
          'One data point per workout session per exercise for charting e1RM and volume trends. ' +
          '`maxWeight` is the heaviest effective weight lifted in that session (includes bodyweight for pull-ups). ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const sort = query.sort ?? 'date'
      const order = query.order ?? 'desc'
      const offset = (page - 1) * limit

      const conds = []
      if (query.exercise) conds.push(eq(workouts.exercise_id, query.exercise))
      if (query.dateFrom) conds.push(gte(workouts.date, query.dateFrom))
      if (query.dateTo) conds.push(lte(workouts.date, query.dateTo))
      const where = conds.length > 0 ? and(...conds) : undefined

      const col = orderColumn(sort)
      const [rows, countResult] = await Promise.all([
        db
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
          .orderBy(order === 'asc' ? asc(col) : desc(col))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(workouts).where(where),
      ])

      const total = Number(countResult[0]?.count ?? 0)

      if (rows.length === 0) return { data: [], total }

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

      const data = rows.map((w) => {
        const wSets = setMap.get(w.id) ?? []
        return { ...w, sets: wSets, ...computeMetrics(wSets, w.exercise_id, bwAt(w.date)) }
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { data, total } as any
    },
    {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
        sort: z.enum(['date', 'id', 'exercise_id', 'created_at']).optional(),
        order: z.enum(['asc', 'desc']).default('desc').optional(),
        exercise: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
      response: z.object({
        data: z.array(WorkoutWithSetsSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'List workouts',
        description:
          'Returns paginated workout sessions with their sets and server-computed Epley/Brzycki 1RM estimates. `page` is 1-indexed, `limit` ≤ 200. Filters: `exercise` (an exercise_id from GET /exercises), `dateFrom`/`dateTo` (YYYY-MM-DD). Sort: date (default), id, exercise_id, created_at. For aggregates use /workouts/summary/*; for a single session use GET /workouts/{id}.',
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
        tags: ['Strength'],
        summary: 'Get workout by ID',
        description:
          'Returns a single workout session with its sets and computed 1RM metrics (Epley, Brzycki, average). Bodyweight resolves to the most recent weight-log entry on or before the workout date — used for adjusting pull-up effective weight. Returns 404 if no workout with that id exists.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '',
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

      // Load history BEFORE inserting — achievements compare against prior sessions only.
      // Filter by date so backfilled workouts don't see future sessions as "prior".
      const priorWorkouts = await db
        .select({
          id: workouts.id,
          date: workouts.date,
          exercise_id: workouts.exercise_id,
        })
        .from(workouts)
        .where(and(eq(workouts.exercise_id, body.exercise_id), lte(workouts.date, body.date)))
      const priorIds = priorWorkouts.map((w) => w.id)
      const priorSets = priorIds.length
        ? await db.select().from(workoutSets).where(inArray(workoutSets.workout_id, priorIds))
        : []
      const priorSetMap = new Map<number, typeof priorSets>()
      for (const s of priorSets) {
        const list = priorSetMap.get(s.workout_id) ?? []
        list.push(s)
        priorSetMap.set(s.workout_id, list)
      }
      const bwAt = await loadBodyweightResolver()
      const history: WorkoutWithSets[] = priorWorkouts.map((w) => {
        const wSets = priorSetMap.get(w.id) ?? []
        const metrics = computeMetrics(wSets, w.exercise_id, bwAt(w.date))
        return {
          id: w.id,
          date: w.date,
          exercise_id: w.exercise_id,
          exercise_name: w.exercise_id,
          sets: wSets,
          estimated_1rm: metrics.estimated_1rm,
          total_volume: metrics.total_volume,
        }
      })
      const achievements = detectAchievements(body.exercise_id, body.sets, history, bwAt(body.date))

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
      return { id: result.id, achievements }
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
        201: z.object({ id: z.number(), achievements: z.array(AchievementSchema) }),
        400: z.string(),
      },
      detail: {
        tags: ['Strength'],
        summary: 'Create a workout with sets',
        description:
          'Creates a workout session and its sets atomically (single transaction). 400 if exercise_id is unknown. Response includes any achievements detected against prior history: first_workout, weight_milestone (e.g. crossing 100 kg), max_weight_pr, estimated_1rm_pr, volume_pr — each with a `confetti` flag for the UI.',
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
        tags: ['Strength'],
        summary: 'Update workout fields and replace sets',
        description:
          'Partial update of a workout. Pass only the fields you want to change. If `sets` is provided, the existing sets are deleted and replaced wholesale in a single transaction (not merged). 400 on unknown exercise_id, 404 on missing workout id.',
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
        tags: ['Strength'],
        summary: 'Delete a workout',
        description:
          'Deletes a workout and all of its sets in a single transaction. There is no soft-delete — hard delete only. Returns 404 if no workout with that id exists.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
