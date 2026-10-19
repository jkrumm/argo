import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'
import {
  FITNESS_HRV_SLOPE_THRESHOLD,
  FITNESS_RHR_SLOPE_THRESHOLD,
  fitnessDirection,
} from '../lib/garmin-formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const FitnessDirectionResponseSchema = z.object({
  signal: z.enum(['improving', 'stable', 'declining']),
  label: z.string(),
  symbol: z.string(),
  color: z.string(),
  rhrSlope: z.number().nullable(),
  hrvSlope: z.number().nullable(),
  rhrChange: z
    .number()
    .nullable()
    .describe(
      'Fitted RHR change in bpm: the regression slope × the index span of the 14-row slice between its first and last reading (rows, not calendar days — the same fit the label uses). Rounded to 3 decimals. Null with fewer than 3 readings.',
    ),
  hrvChange: z
    .number()
    .nullable()
    .describe(
      'Fitted HRV change in ms: the regression slope × the index span of the 14-row slice between its first and last reading (rows, not calendar days — the same fit the label uses). Rounded to 3 decimals. Null with fewer than 3 readings.',
    ),
  rhrFlat: z
    .boolean()
    .nullable()
    .describe(
      `True when the RHR slope is inside ±${FITNESS_RHR_SLOPE_THRESHOLD} bpm/row and so does not move the label. Null with fewer than 3 readings.`,
    ),
  hrvFlat: z
    .boolean()
    .nullable()
    .describe(
      `True when the HRV slope is inside ±${FITNESS_HRV_SLOPE_THRESHOLD} ms/row and so does not move the label. Null with fewer than 3 readings.`,
    ),
  rhrDelta: z
    .number()
    .nullable()
    .describe(
      'Last valid RHR reading minus the first in the slice, in bpm. Not the fitted change.',
    ),
  hrvDelta: z
    .number()
    .nullable()
    .describe('Last valid HRV reading minus the first in the slice, in ms. Not the fitted change.'),
  vo2max: z.number().nullable(),
})

export const fitnessDirectionRoutes = new Elysia({ prefix: '/fitness-direction' }).get(
  '',
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
      tags: ['Garmin Health'],
      summary: 'Fitness direction signal (3-level) from 14-day RHR + HRV regression',
      description:
        'Computes linear-regression slope over the most recent 14 days of resting HR and HRV. ' +
        'RHR slope < −0.05 bpm/day → improving (RHR going down); HRV slope > +0.10 ms/day → improving. ' +
        'Combines into Improving / Stable / Declining signal with symbol + color. ' +
        '`rhrChange` / `hrvChange` are the fitted change over the slice (slope × index span) and `rhrFlat` / `hrvFlat` say whether that slope is inside its threshold — the same fit and comparison the label uses; `rhrDelta` / `hrvDelta` are last minus first reading. ' +
        'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (slice trims to last 14 days).',
      security: [{ BearerAuth: [] }],
    },
  },
)
