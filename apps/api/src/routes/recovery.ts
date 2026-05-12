import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'
import {
  activityScore,
  recoveryScore,
  recoveryScoreSeries,
  percentile,
  STRAIN_DEBT_MIN_CEILING,
} from '../lib/garmin-formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const RecoveryComponentsSchema = z.object({
  hrv: z.number().nullable(),
  sleep: z.number().nullable(),
  rhr: z.number().nullable(),
})

const RecoverySnapshotSchema = z.object({
  date: z.string().nullable(),
  recovery: z.number().nullable(),
  components: RecoveryComponentsSchema,
  yesterdayActivityScore: z.number().nullable(),
  ceiling: z.number().nullable(),
  strainDebt: z.number(),
  penalty: z.number(),
})

const RecoverySeriesPointSchema = z.object({
  date: z.string(),
  recovery: z.number().nullable(),
  sleepScore: z.number().nullable(),
  bbHigh: z.number().nullable(),
})

export const recoveryRoutes = new Elysia({ prefix: '/recovery' })
  .get(
    '',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      const rows = await db
        .select({
          date: dailyMetrics.date,
          hrv: dailyMetrics.hrv_last_night_avg,
          sleepScore: dailyMetrics.sleep_score,
          restingHr: dailyMetrics.resting_hr,
          vigorousMin: dailyMetrics.vigorous_intensity_min,
          moderateMin: dailyMetrics.moderate_intensity_min,
          steps: dailyMetrics.steps,
        })
        .from(dailyMetrics)
        .where(and(gte(dailyMetrics.date, fromStr), lte(dailyMetrics.date, toStr)))
        .orderBy(asc(dailyMetrics.date))

      if (rows.length === 0) {
        return {
          date: null,
          recovery: null,
          components: { hrv: null, sleep: null, rhr: null },
          yesterdayActivityScore: null,
          ceiling: null,
          strainDebt: 0,
          penalty: 0,
        }
      }

      const hrvValues = rows.map((r) => r.hrv).filter((v): v is number => v !== null)
      const rhrValues = rows.map((r) => r.restingHr).filter((v): v is number => v !== null)
      const activityScores = rows.map((r) =>
        activityScore({
          vigorousMin: r.vigorousMin,
          moderateMin: r.moderateMin,
          steps: r.steps,
        }),
      )
      const validActivity = activityScores.filter((v): v is number => v !== null)

      const avgHrv =
        hrvValues.length > 0 ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null
      const minRhr = rhrValues.length > 0 ? Math.min(...rhrValues) : null
      const maxRhr = rhrValues.length > 0 ? Math.max(...rhrValues) : null
      const p90 = percentile(validActivity, 0.9)
      const ceiling = p90 !== null ? Math.max(STRAIN_DEBT_MIN_CEILING, p90) : null

      const lastIdx = rows.length - 1
      const last = rows[lastIdx]!
      const yesterdayScore = lastIdx > 0 ? (activityScores[lastIdx - 1] ?? null) : null

      const result = recoveryScore({
        hrv: last.hrv,
        avgHrv,
        sleepScore: last.sleepScore,
        restingHr: last.restingHr,
        minRhr,
        maxRhr,
        yesterdayActivityScore: yesterdayScore,
        ceiling,
      })

      return {
        date: last.date,
        recovery: result.recovery,
        components: result.components,
        yesterdayActivityScore: yesterdayScore,
        ceiling,
        strainDebt: result.strainDebt,
        penalty: result.penalty,
      }
    },
    {
      query: WindowQuerySchema,
      response: RecoverySnapshotSchema,
      detail: {
        tags: ['Garmin Health'],
        summary: 'Recovery score snapshot for most recent date in window',
        description:
          "Weighted composite: HRV (40%) + Sleep (35%) + RHR (25%), with strain-debt penalty from yesterday's activity score. " +
          'Ceiling = 90th percentile of activity scores in window (floored at 500). ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/series',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      const rows = await db
        .select({
          date: dailyMetrics.date,
          hrv: dailyMetrics.hrv_last_night_avg,
          sleepScore: dailyMetrics.sleep_score,
          restingHr: dailyMetrics.resting_hr,
          vigorousMin: dailyMetrics.vigorous_intensity_min,
          moderateMin: dailyMetrics.moderate_intensity_min,
          steps: dailyMetrics.steps,
          bbHighest: dailyMetrics.bb_highest,
        })
        .from(dailyMetrics)
        .where(and(gte(dailyMetrics.date, fromStr), lte(dailyMetrics.date, toStr)))
        .orderBy(asc(dailyMetrics.date))

      const input = rows.map((r) => ({
        date: r.date,
        hrv: r.hrv,
        sleepScore: r.sleepScore,
        restingHr: r.restingHr,
        activityScore: activityScore({
          vigorousMin: r.vigorousMin,
          moderateMin: r.moderateMin,
          steps: r.steps,
        }),
        bbHighest: r.bbHighest,
      }))

      return { points: recoveryScoreSeries(input) }
    },
    {
      query: WindowQuerySchema,
      response: z.object({ points: z.array(RecoverySeriesPointSchema) }),
      detail: {
        tags: ['Garmin Health'],
        summary: 'Daily recovery score series for charting',
        description:
          'One recovery score per day in the window. Uses window-wide HRV/RHR baselines and 90th-percentile ' +
          'activity ceiling for strain-debt. Includes sleep score and body battery high for chart context.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
