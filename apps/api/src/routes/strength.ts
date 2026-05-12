/**
 * Strength-tracker summary endpoints.
 *
 * Pure read endpoints under `/workouts/summary/*` that consume
 * `apps/api/src/lib/strength-formulas.ts`. Kept in a separate file from the
 * CRUD workouts routes so this 12-endpoint surface can grow independently.
 *
 * Endpoints follow §2 of `docs/strength-tracker-port/backend-audit.md`.
 */

import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics, exercises, userProfile, workouts, workoutSets } from '../db/schema.js'
import { computeMetrics, loadBodyweightResolver } from '../lib/formulas.js'
import {
  buildAlignmentMatrix,
  buildCompositeSeries,
  buildOneRmSeries,
  buildReadinessSeries,
  buildRelativeProgressionSeries,
  buildSparklineRow,
  buildWeeklyVolumeSeries,
  computeAcwrSeries,
  computeBalanceComposite,
  computeLoadQuality,
  computeStrengthDirectionHero,
  computeStrengthRatios,
  deloadSignal,
  findPRPoints,
  volumeLandmarks,
  type DailyMetricRow,
  type WorkoutWithSets,
} from '../lib/strength-formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const DEFAULT_EXERCISES = ['bench_press', 'deadlift', 'squat', 'pull_ups']

// Elysia's query parser splits comma-separated values into an array, so accept both shapes.
const ExercisesField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe('Comma-separated exercise IDs; default: bench_press,deadlift,squat,pull_ups')

const ExercisesQuerySchema = WindowQuerySchema.extend({ exercises: ExercisesField })

const ExercisesOnlyQuerySchema = z.object({ exercises: ExercisesField })

function parseExercises(s: string | string[] | undefined): string[] {
  if (Array.isArray(s)) return s.filter(Boolean)
  return (s ?? DEFAULT_EXERCISES.join(',')).split(',').filter(Boolean)
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const AcwrZoneEnum = z.enum(['undertrained', 'optimal', 'caution', 'danger'])
const StrengthDirectionEnum = z.enum(['improving', 'stable', 'declining'])
const MomentumSignEnum = z.enum(['accelerating', 'linear', 'decelerating'])
const VerdictEnum = z.enum(['Quality', 'Adequate', 'Poor'])
const DragComponentEnum = z.enum(['INOL', 'ACWR', 'Volume'])
const RatioStatusEnum = z.enum(['balanced', 'imbalanced', 'critical'])
const ReadinessVerdictEnum = z.enum(['Push', 'Normal', 'Rest'])
const MetricKeyEnum = z.enum([
  'max_weight',
  'estimated_1rm',
  'total_volume',
  'total_reps',
  'work_sets',
  'avg_intensity',
])
const MetricUnitEnum = z.enum(['kg', 'reps', 'sets', '%'])
const RecoveryRowEnum = z.enum(['high', 'normal', 'low'])
const AcwrColEnum = z.enum(['under', 'optimal', 'caution'])
const VerdictTypeEnum = z.enum(['good', 'warn', 'bad'])
const DeloadVerdictEnum = z.enum(['deload', 'monitor', 'progress'])

const RatioPairSchema = z.object({
  label: z.string(),
  ratio: z.number().nullable(),
  range: z.tuple([z.number(), z.number()]),
  status: RatioStatusEnum.nullable(),
  scaleMax: z.number(),
})

const BestSetSchema = z
  .object({
    weight_kg: z.number(),
    reps: z.number().int(),
    e1rm: z.number(),
  })
  .nullable()

const DetailedPointSchema = z.object({
  date: z.string(),
  e1rm: z.number().nullable(),
  ma30: z.number().nullable(),
  volume: z.number(),
  maxWeight: z.number(),
  inol: z.number().nullable(),
  bestSet: BestSetSchema,
})

const WeeklyVolumePointSchema = z.object({
  date: z.string(),
  warmup: z.number(),
  work: z.number(),
  drop: z.number(),
  amrap: z.number(),
  total: z.number(),
  ma: z.number().nullable(),
})

const TrainingLoadPointSchema = z.object({
  date: z.string(),
  acute: z.number(),
  chronic: z.number(),
  acwr: z.number().nullable(),
  zone: AcwrZoneEnum.nullable(),
})

const CompositePointSchema = z.object({
  date: z.string(),
  velocityRaw: z.number().nullable(),
  tonnageGrowthRaw: z.number().nullable(),
  inolRaw: z.number().nullable(),
  velocityZ: z.number().nullable(),
  tonnageGrowthZ: z.number().nullable(),
  inolZ: z.number().nullable(),
  velocityZma: z.number().nullable(),
  tonnageGrowthZma: z.number().nullable(),
  inolZma: z.number().nullable(),
})

const PRRecordSchema = z.object({
  date: z.string(),
  exercise_id: z.string(),
  exercise_name: z.string(),
  metric: MetricKeyEnum,
  value: z.number(),
  unit: MetricUnitEnum,
})

const SparklineRowSchema = z.object({
  exercise_id: z.string(),
  exercise_name: z.string(),
  e1rm: z.array(z.number()),
  volume: z.array(z.number()),
  inol: z.array(z.number()),
  vel: z.number().nullable(),
  dir: StrengthDirectionEnum,
})

const ReadinessPointSchema = z.object({
  date: z.string(),
  readiness: z.number().nullable(),
  garminRecovery: z.number().nullable(),
  fatigueDept: z.number(),
  driver: z.string().nullable(),
})

const AlignmentCellSchema = z.object({
  recoveryRow: RecoveryRowEnum,
  acwrCol: AcwrColEnum,
  verdict: z.string(),
  verdictType: VerdictTypeEnum,
  dates: z.array(z.string()),
  count: z.number().int(),
  isToday: z.boolean(),
})

const HeroesResponseSchema = z.object({
  strengthDirection: z.object({
    direction: StrengthDirectionEnum,
    leaderExercise: z.string().nullable(),
    leaderVelocityPctPerMonth: z.number().nullable(),
    momentumSign: MomentumSignEnum,
  }),
  loadQuality: z.object({
    score: z.number(),
    verdict: VerdictEnum,
    dragComponent: DragComponentEnum.nullable(),
    latestInol: z.number().nullable(),
    latestAcwr: z.number().nullable(),
  }),
  balance: z.object({
    status: RatioStatusEnum.nullable(),
    worstPair: z
      .object({
        label: z.string(),
        ratio: z.number(),
        range: z.tuple([z.number(), z.number()]),
        scaleMax: z.number(),
      })
      .nullable(),
    ratios: z.array(RatioPairSchema),
  }),
  readiness: z
    .object({
      score: z.number().nullable(),
      verdict: ReadinessVerdictEnum,
      driver: z.string().nullable(),
    })
    .nullable(),
})

// ─── Shared loader ───────────────────────────────────────────────────────────

type LoadedWorkout = WorkoutWithSets & { notes: string | null }

async function loadWorkoutsRange(fromStr: string, toStr: string): Promise<LoadedWorkout[]> {
  const rows = await db
    .select({
      id: workouts.id,
      date: workouts.date,
      exercise_id: workouts.exercise_id,
      exercise_name: exercises.name,
      notes: workouts.notes,
    })
    .from(workouts)
    .leftJoin(exercises, eq(workouts.exercise_id, exercises.id))
    .where(and(gte(workouts.date, fromStr), lte(workouts.date, toStr)))
    .orderBy(asc(workouts.date))

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const sets = await db.select().from(workoutSets).where(inArray(workoutSets.workout_id, ids))

  const setMap = new Map<number, typeof sets>()
  for (const s of sets) {
    const list = setMap.get(s.workout_id) ?? []
    list.push(s)
    setMap.set(s.workout_id, list)
  }

  const bwAt = await loadBodyweightResolver()
  return rows.map((r) => {
    const wSets = setMap.get(r.id) ?? []
    const metrics = computeMetrics(wSets, r.exercise_id, bwAt(r.date))
    return {
      id: r.id,
      date: r.date,
      exercise_id: r.exercise_id,
      exercise_name: r.exercise_name ?? r.exercise_id,
      notes: r.notes,
      sets: wSets,
      estimated_1rm: metrics.estimated_1rm,
      total_volume: metrics.total_volume,
    }
  })
}

function groupByExercise(rows: LoadedWorkout[]): Map<string, LoadedWorkout[]> {
  const m = new Map<string, LoadedWorkout[]>()
  for (const w of rows) {
    const list = m.get(w.exercise_id) ?? []
    list.push(w)
    m.set(w.exercise_id, list)
  }
  return m
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

const METRIC_UNITS: Record<z.infer<typeof MetricKeyEnum>, z.infer<typeof MetricUnitEnum>> = {
  max_weight: 'kg',
  estimated_1rm: 'kg',
  total_volume: 'kg',
  total_reps: 'reps',
  work_sets: 'sets',
  avg_intensity: '%',
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const strengthRoutes = new Elysia({ prefix: '/workouts' })
  .get(
    '/summary/heroes',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)
      const exIds = parseExercises(query.exercises)

      const rows = await loadWorkoutsRange(fromStr, toStr)
      const byEx = groupByExercise(rows)
      const bwAt = await loadBodyweightResolver()
      const todayBw = bwAt(todayStr())

      const [profile] = await db
        .select({ gender: userProfile.gender })
        .from(userProfile)
        .where(eq(userProfile.id, 1))
      const gender: 'male' | 'female' = profile?.gender === 'female' ? 'female' : 'male'

      const strengthDirectionRes = computeStrengthDirectionHero(byEx, exIds)
      const loadQualityRes = computeLoadQuality(byEx, exIds, bwAt)
      const ratios = computeStrengthRatios(byEx, todayBw, gender)
      const balance = computeBalanceComposite(ratios)
      const worstPairOut =
        balance.worstPair && balance.worstPair.ratio !== null
          ? {
              label: balance.worstPair.label,
              ratio: balance.worstPair.ratio,
              range: balance.worstPair.range,
              scaleMax: balance.worstPair.scaleMax,
            }
          : null

      // Readiness: load up to 90d of daily metrics, only return when >= 7 rows.
      const dmCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
      const dailyRows = await db
        .select({
          date: dailyMetrics.date,
          hrv_last_night_avg: dailyMetrics.hrv_last_night_avg,
          sleep_score: dailyMetrics.sleep_score,
          resting_hr: dailyMetrics.resting_hr,
          steps: dailyMetrics.steps,
          moderate_intensity_min: dailyMetrics.moderate_intensity_min,
          vigorous_intensity_min: dailyMetrics.vigorous_intensity_min,
          vo2_max: dailyMetrics.vo2_max,
        })
        .from(dailyMetrics)
        .where(gte(dailyMetrics.date, dmCutoff))
        .orderBy(asc(dailyMetrics.date))

      let readiness: z.infer<typeof HeroesResponseSchema>['readiness'] = null
      if (dailyRows.length >= 7) {
        const readinessSeries = buildReadinessSeries(dailyRows as DailyMetricRow[], rows, bwAt)
        const last = readinessSeries[readinessSeries.length - 1] ?? null
        if (last) {
          const score = last.readiness
          const verdict: 'Push' | 'Normal' | 'Rest' =
            score === null ? 'Normal' : score >= 70 ? 'Push' : score >= 40 ? 'Normal' : 'Rest'
          readiness = { score, verdict, driver: last.driver }
        }
      }

      return {
        strengthDirection: strengthDirectionRes,
        loadQuality: loadQualityRes,
        balance: {
          status: balance.status,
          worstPair: worstPairOut,
          ratios: ratios.pairs,
        },
        readiness,
      }
    },
    {
      query: ExercisesQuerySchema,
      response: HeroesResponseSchema,
      detail: {
        tags: ['Strength'],
        summary: 'Strength tracker hero composites',
        description:
          'Composite hero metrics: strength direction, load quality, balance ratios, and readiness ' +
          '(readiness is null when fewer than 7 daily-metric rows in the last 90 days). ' +
          'Accepts `?exercises=` comma list (default bench_press,deadlift,squat,pull_ups) and standard window params.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/series-detailed',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const exIds = parseExercises(query.exercises)
      const rows = await loadWorkoutsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      )
      const byEx = groupByExercise(rows)
      const bwAt = await loadBodyweightResolver()

      const byExercise = exIds.map((exId) => {
        const list = byEx.get(exId) ?? []
        const points = buildOneRmSeries(list, bwAt)
        const name = list[0]?.exercise_name ?? exId
        return { exercise_id: exId, exercise_name: name, points }
      })
      return { byExercise }
    },
    {
      query: ExercisesQuerySchema,
      response: z.object({
        byExercise: z.array(
          z.object({
            exercise_id: z.string(),
            exercise_name: z.string(),
            points: z.array(DetailedPointSchema),
          }),
        ),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'Per-exercise detailed strength series',
        description:
          'Per session: e1RM, date-based 30-day MA, INOL, max weight, best set, volume. ' +
          'Mirrors the old buildOneRmChartData + INOL chart + best-set tooltip in a single payload.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/weekly-volume',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const exIds = parseExercises(query.exercises)
      const rows = await loadWorkoutsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      )
      const byEx = groupByExercise(rows)
      const bwAt = await loadBodyweightResolver()

      const byExercise = exIds.map((exId) => {
        const list = byEx.get(exId) ?? []
        return {
          exercise_id: exId,
          exercise_name: list[0]?.exercise_name ?? exId,
          landmarks: volumeLandmarks(list),
          points: buildWeeklyVolumeSeries(list, bwAt),
        }
      })
      return { byExercise }
    },
    {
      query: ExercisesQuerySchema,
      response: z.object({
        byExercise: z.array(
          z.object({
            exercise_id: z.string(),
            exercise_name: z.string(),
            landmarks: z.object({ mev: z.number(), mav: z.number(), mrv: z.number() }),
            points: z.array(WeeklyVolumePointSchema),
          }),
        ),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'Per-exercise weekly volume breakdown + MEV/MAV/MRV landmarks',
        description:
          'Weekly tonnage broken down by set_type (warmup/work/drop/amrap) with a 4-week trailing MA. ' +
          'Landmarks (MEV/MAV/MRV) are p25/p50/p90 of the trailing 90 days of weekly tonnage.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/training-load',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const exIds = parseExercises(query.exercises)
      const rows = await loadWorkoutsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      )
      const byEx = groupByExercise(rows)

      const byExercise = exIds.map((exId) => {
        const list = byEx.get(exId) ?? []
        return {
          exercise_id: exId,
          exercise_name: list[0]?.exercise_name ?? exId,
          points: computeAcwrSeries(list).map((p) => ({
            date: p.date,
            acute: Math.round(p.acute * 10) / 10,
            chronic: Math.round(p.chronic * 10) / 10,
            acwr: p.acwr !== null ? Math.round(p.acwr * 100) / 100 : null,
            zone: p.zone,
          })),
        }
      })
      return { byExercise }
    },
    {
      query: ExercisesQuerySchema,
      response: z.object({
        byExercise: z.array(
          z.object({
            exercise_id: z.string(),
            exercise_name: z.string(),
            points: z.array(TrainingLoadPointSchema),
          }),
        ),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'Per-exercise ACWR training-load series',
        description:
          'ACWR = EWMA(4) / EWMA(16) of weekly tonnage per exercise. Zones: undertrained (<0.8), optimal ' +
          '(0.8..1.3), caution (1.3..1.5), danger (>1.5).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/records',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const exIds = parseExercises(query.exercises)
      const rows = await loadWorkoutsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      )
      const byEx = groupByExercise(rows)
      const bwAt = await loadBodyweightResolver()

      const metricsRequested: Array<z.infer<typeof MetricKeyEnum>> =
        query.metric && query.metric !== 'all'
          ? [query.metric]
          : ['max_weight', 'estimated_1rm', 'total_volume', 'total_reps', 'work_sets']

      const records: Array<{
        date: string
        exercise_id: string
        exercise_name: string
        metric: z.infer<typeof MetricKeyEnum>
        value: number
        unit: z.infer<typeof MetricUnitEnum>
      }> = []
      for (const exId of exIds) {
        const list = (byEx.get(exId) ?? []).toSorted((a, b) => a.date.localeCompare(b.date))
        if (list.length === 0) continue
        const exName = list[0]!.exercise_name
        for (const m of metricsRequested) {
          const prs = findPRPoints(list, m, bwAt)
          for (const p of prs) {
            records.push({
              date: p.date,
              exercise_id: p.exercise_id,
              exercise_name: exName,
              metric: m,
              value: Math.round(p.value * 10) / 10,
              unit: METRIC_UNITS[m],
            })
          }
        }
      }
      records.sort((a, b) => b.date.localeCompare(a.date))
      return { records }
    },
    {
      query: ExercisesQuerySchema.extend({
        metric: z
          .enum(['all', 'max_weight', 'estimated_1rm', 'total_volume', 'total_reps', 'work_sets'])
          .optional()
          .describe('Filter by a single metric; default = all'),
      }),
      response: z.object({ records: z.array(PRRecordSchema) }),
      detail: {
        tags: ['Strength'],
        summary: 'Running-max personal records',
        description:
          'Per exercise + metric, emits a PR every time the running max is beaten. The very first session per ' +
          'metric is skipped (it would always be a PR by definition). Sorted by date descending.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/composite/:exerciseId',
    async ({ params, query }) => {
      const { from, to } = parseWindow(query)
      const rows = await loadWorkoutsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      )
      const exRows = rows.filter((w) => w.exercise_id === params.exerciseId)
      const bwAt = await loadBodyweightResolver()
      const points = buildCompositeSeries(exRows, bwAt)
      return { points }
    },
    {
      params: z.object({ exerciseId: z.string() }),
      query: WindowQuerySchema,
      response: z.object({ points: z.array(CompositePointSchema) }),
      detail: {
        tags: ['Strength'],
        summary: 'Z-scored composite signals for a single exercise',
        description:
          'Velocity / tonnage-growth / INOL z-scored against a 90-day baseline (SD floors 0.05 / 0.02 / 0.1) ' +
          'plus a 7-entry trailing ZMA per component.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/relative-progression',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const exIds = parseExercises(query.exercises)
      const rows = await loadWorkoutsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      )
      const byEx = groupByExercise(rows)
      const points = buildRelativeProgressionSeries(byEx, exIds)
      return { points }
    },
    {
      query: ExercisesQuerySchema,
      response: z.object({
        points: z.array(
          z.object({
            date: z.string(),
            pct: z.record(z.string(), z.number().nullable()),
          }),
        ),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'Relative progression % from first e1RM baseline',
        description:
          'Per exercise: percent change of best-of-day e1RM from the first available e1RM in window.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/sparklines',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const exIds = parseExercises(query.exercises)
      const rows = await loadWorkoutsRange(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      )
      const byEx = groupByExercise(rows)
      const bwAt = await loadBodyweightResolver()

      const byExercise = exIds.map((exId) => {
        const list = byEx.get(exId) ?? []
        const row = buildSparklineRow(list, bwAt)
        return {
          exercise_id: exId,
          exercise_name: list[0]?.exercise_name ?? exId,
          ...row,
        }
      })
      return { byExercise }
    },
    {
      query: ExercisesQuerySchema,
      response: z.object({ byExercise: z.array(SparklineRowSchema) }),
      detail: {
        tags: ['Strength'],
        summary: 'Compact sparkline arrays per exercise',
        description:
          'Last 20 e1RM, last 10 weekly volume totals, last 15 INOL values. ' +
          '`vel` = latest %/day velocity. `dir` = strength direction.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/readiness',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)
      const dailyRows = await db
        .select({
          date: dailyMetrics.date,
          hrv_last_night_avg: dailyMetrics.hrv_last_night_avg,
          sleep_score: dailyMetrics.sleep_score,
          resting_hr: dailyMetrics.resting_hr,
          steps: dailyMetrics.steps,
          moderate_intensity_min: dailyMetrics.moderate_intensity_min,
          vigorous_intensity_min: dailyMetrics.vigorous_intensity_min,
          vo2_max: dailyMetrics.vo2_max,
        })
        .from(dailyMetrics)
        .where(and(gte(dailyMetrics.date, fromStr), lte(dailyMetrics.date, toStr)))
        .orderBy(asc(dailyMetrics.date))
      if (dailyRows.length < 7) return { points: [] }

      const rows = await loadWorkoutsRange(fromStr, toStr)
      const bwAt = await loadBodyweightResolver()
      const points = buildReadinessSeries(dailyRows as DailyMetricRow[], rows, bwAt)
      return { points }
    },
    {
      query: WindowQuerySchema,
      response: z.object({ points: z.array(ReadinessPointSchema) }),
      detail: {
        tags: ['Strength'],
        summary: 'Per-day strength readiness from Garmin recovery + fatigue debt',
        description:
          'Garmin recovery score (HRV/Sleep/RHR) penalised by recent strength-session INOL within 48h. ' +
          'Returns empty points when fewer than 7 daily-metric rows in the window.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/alignment',
    async ({ query }) => {
      const today = todayStr()
      const fromStr = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
      const exIds = parseExercises(query.exercises)

      const dailyRows = await db
        .select({
          date: dailyMetrics.date,
          hrv_last_night_avg: dailyMetrics.hrv_last_night_avg,
          sleep_score: dailyMetrics.sleep_score,
          resting_hr: dailyMetrics.resting_hr,
          steps: dailyMetrics.steps,
          moderate_intensity_min: dailyMetrics.moderate_intensity_min,
          vigorous_intensity_min: dailyMetrics.vigorous_intensity_min,
          vo2_max: dailyMetrics.vo2_max,
        })
        .from(dailyMetrics)
        .where(gte(dailyMetrics.date, fromStr))
        .orderBy(asc(dailyMetrics.date))

      const rows = await loadWorkoutsRange(fromStr, today)
      const bwAt = await loadBodyweightResolver()
      const byEx = groupByExercise(rows)
      const readiness = buildReadinessSeries(dailyRows as DailyMetricRow[], rows, bwAt)
      const grid = buildAlignmentMatrix(readiness, byEx, exIds, today)
      return { grid }
    },
    {
      query: ExercisesOnlyQuerySchema,
      response: z.object({
        grid: z.array(z.array(AlignmentCellSchema)),
      }),
      detail: {
        tags: ['Strength'],
        summary: '3×3 training-recovery alignment matrix',
        description:
          'Buckets each session of the active exercises by (recovery score row, ACWR column) using a 90-day ' +
          'lookback dataset. Returns a 3×3 grid (high/normal/low × under/optimal/caution).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/summary/deload-signal',
    async ({ query }) => {
      const today = todayStr()
      const fromStr = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
      const exIds = parseExercises(query.exercises)

      const rows = await loadWorkoutsRange(fromStr, today)
      const byEx = groupByExercise(rows)
      const dailyRows = await db
        .select({
          date: dailyMetrics.date,
          hrv_last_night_avg: dailyMetrics.hrv_last_night_avg,
          sleep_score: dailyMetrics.sleep_score,
          resting_hr: dailyMetrics.resting_hr,
          steps: dailyMetrics.steps,
          moderate_intensity_min: dailyMetrics.moderate_intensity_min,
          vigorous_intensity_min: dailyMetrics.vigorous_intensity_min,
          vo2_max: dailyMetrics.vo2_max,
        })
        .from(dailyMetrics)
        .where(gte(dailyMetrics.date, fromStr))
        .orderBy(asc(dailyMetrics.date))

      const res = deloadSignal(byEx, dailyRows as DailyMetricRow[], exIds, today)
      return res
    },
    {
      query: ExercisesOnlyQuerySchema,
      response: z.object({
        verdict: DeloadVerdictEnum,
        activeSignals: z.array(z.string()),
        physioAvailable: z.boolean(),
      }),
      detail: {
        tags: ['Strength'],
        summary: 'Deload signal verdict + active signal list',
        description:
          'Combines stall, overload, fatigue, and physio signals over the trailing 90 days. >=2 active → deload, ' +
          '=1 → monitor, =0 → progress.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
