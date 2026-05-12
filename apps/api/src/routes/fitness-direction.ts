import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'
import { fitnessDirection } from '../lib/garmin-formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const FitnessDirectionResponseSchema = z.object({
  signal: z.enum(['improving', 'stable', 'declining']),
  label: z.string(),
  symbol: z.string(),
  color: z.string(),
  rhrSlope: z.number().nullable(),
  hrvSlope: z.number().nullable(),
  rhrDelta: z.number().nullable(),
  hrvDelta: z.number().nullable(),
  vo2max: z.number().nullable(),
})

export const fitnessDirectionRoutes = new Elysia({ prefix: '/daily-metrics' }).get(
  '/fitness-direction',
  async ({ query }) => {
    const { from, to } = parseWindow(query)
    const fromStr = from.toISOString().slice(0, 10)
    const toStr = to.toISOString().slice(0, 10)

    const rows = await db
      .select({
        date: dailyMetrics.date,
        restingHr: dailyMetrics.resting_hr,
        hrv: dailyMetrics.hrv_last_night_avg,
        vo2Max: dailyMetrics.vo2_max,
      })
      .from(dailyMetrics)
      .where(and(gte(dailyMetrics.date, fromStr), lte(dailyMetrics.date, toStr)))
      .orderBy(asc(dailyMetrics.date))

    return fitnessDirection(rows)
  },
  {
    query: WindowQuerySchema,
    response: FitnessDirectionResponseSchema,
    detail: {
      tags: ['Summaries'],
      summary: 'Fitness direction signal (3-level) from 14-day RHR + HRV regression',
      description:
        'Computes linear-regression slope over the most recent 14 days of resting HR and HRV. ' +
        'RHR slope < −0.05 bpm/day → improving (RHR going down); HRV slope > +0.10 ms/day → improving. ' +
        'Combines into Improving / Stable / Declining signal with symbol + color. ' +
        'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (slice trims to last 14 days).',
      security: [{ BearerAuth: [] }],
    },
  },
)
