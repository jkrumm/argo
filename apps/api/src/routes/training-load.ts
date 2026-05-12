import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, asc, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'
import { activityScore, trainingLoad } from '../lib/garmin-formulas.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const ZoneSchema = z.enum(['undertrained', 'optimal', 'caution', 'danger'])

const TrainingLoadPointSchema = z.object({
  date: z.string(),
  dailyLoad: z.number().nullable(),
  acute: z.number().nullable(),
  chronic: z.number().nullable(),
  acwr: z.number().nullable(),
  zone: ZoneSchema.nullable(),
  divergence: z.number().nullable(),
  divPos: z.number().nullable(),
  divNeg: z.number().nullable(),
})

export const trainingLoadRoutes = new Elysia({ prefix: '/training-load' }).get(
  '',
  async ({ query }) => {
    const { from, to } = parseWindow(query)
    const fromStr = from.toISOString().slice(0, 10)
    const toStr = to.toISOString().slice(0, 10)

    const rows = await db
      .select({
        date: dailyMetrics.date,
        vigorousMin: dailyMetrics.vigorous_intensity_min,
        moderateMin: dailyMetrics.moderate_intensity_min,
        steps: dailyMetrics.steps,
      })
      .from(dailyMetrics)
      .where(and(gte(dailyMetrics.date, fromStr), lte(dailyMetrics.date, toStr)))
      .orderBy(asc(dailyMetrics.date))

    const input = rows.map((r) => ({
      date: r.date,
      dailyLoad: activityScore({
        vigorousMin: r.vigorousMin,
        moderateMin: r.moderateMin,
        steps: r.steps,
      }),
    }))

    return { points: trainingLoad(input) }
  },
  {
    query: WindowQuerySchema,
    response: z.object({ points: z.array(TrainingLoadPointSchema) }),
    detail: {
      tags: ['Garmin Health'],
      summary: 'Training load (ACWR) series with zones and divergence',
      description:
        'Daily activity score (MET-min) → EWMA acute (λ=0.25, ~7d half-life) + chronic (λ≈0.069, ~28d half-life). ' +
        'ACWR = acute / chronic, zones from Gabbett 2016 (BJSM): <0.8 undertrained, 0.8–1.3 optimal, 1.3–1.5 caution, >1.5 danger. ' +
        'Divergence = acute − chronic with pos/neg split for stacked-bar charting. ' +
        'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`.',
      security: [{ BearerAuth: [] }],
    },
  },
)
