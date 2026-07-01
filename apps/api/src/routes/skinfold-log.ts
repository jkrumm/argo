import { Elysia } from 'elysia'
import { z } from 'zod'
import { asc, desc, eq, count, and, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { skinfoldLog } from '../db/schema.js'
import { computeStats } from '../lib/formulas.js'
import {
  sessionAverage,
  trailingRatePerWeek,
  classifySkinfoldDirection,
} from '../lib/skinfold-formulas.js'
import { SKINFOLD_SITES, type SkinfoldSite } from '../lib/skinfold-sites.js'
import { WindowQuerySchema, parseWindow } from '../lib/window.js'

const SkinfoldSiteEnum = z.enum(SKINFOLD_SITES)

const SkinfoldLogSchema = z.object({
  id: z.number(),
  date: z.string(),
  site: z.string(),
  value_mm: z.number(),
  created_at: z.string().nullable(),
})

const SkinfoldSummarySchema = z.object({
  current: z
    .number()
    .nullable()
    .describe('Most recent date-average skinfold thickness (mm) in window'),
  ma7: z
    .number()
    .nullable()
    .describe('Average of up to 7 most-recent date-averages; fewer when window < 7 dates'),
  ma30: z
    .number()
    .nullable()
    .describe('Average of up to 30 most-recent date-averages; fewer when window < 30 dates'),
  trend: z
    .enum(['up', 'down', 'flat'])
    .describe(
      'up = ma7 > ma30 by >0.5% (thicker/fatter); down = ma7 < ma30 by >0.5% (leaner, the good direction); flat = otherwise',
    ),
  weeklyDelta: z
    .number()
    .nullable()
    .describe(
      'Skinfold change (mm) between most recent and oldest date-average in last 7 dated averages. Positive = increasing.',
    ),
  monthlyDelta: z
    .number()
    .nullable()
    .describe(
      'Skinfold change (mm) between most recent and oldest date-average in last 30 dated averages. Positive = increasing.',
    ),
  mmPerWeek: z
    .number()
    .nullable()
    .describe('Trailing 28-day linear-regression rate of skinfold change (mm/week).'),
  direction: z
    .enum(['reducing', 'increasing', 'stable'])
    .describe(
      'Classification of |mmPerWeek|: <0.1 stable, negative (reducing body fat) is the good direction, positive is increasing.',
    ),
  perSite: z
    .array(
      z.object({
        site: SkinfoldSiteEnum,
        current: z.number().nullable().describe('Latest reading (mm) for this site in window'),
      }),
    )
    .describe('Latest reading per site within the window, one entry per registered site.'),
})

export const skinfoldLogRoutes = new Elysia({ prefix: '/skinfold-log' })
  .get(
    '/summary',
    async ({ query }) => {
      const { from, to } = parseWindow(query)
      const fromStr = from.toISOString().slice(0, 10)
      const toStr = to.toISOString().slice(0, 10)

      // Ascending for grouping + per-site latest lookup.
      const rows = await db
        .select({ date: skinfoldLog.date, site: skinfoldLog.site, value_mm: skinfoldLog.value_mm })
        .from(skinfoldLog)
        .where(and(gte(skinfoldLog.date, fromStr), lte(skinfoldLog.date, toStr)))
        .orderBy(asc(skinfoldLog.date))

      const latestBySite = new Map<string, number>()
      for (const r of rows) latestBySite.set(r.site, r.value_mm)
      const perSite = SKINFOLD_SITES.map((site) => ({
        site,
        current: latestBySite.get(site) ?? null,
      }))

      if (rows.length === 0) {
        return {
          current: null,
          ma7: null,
          ma30: null,
          trend: 'flat' as const,
          weeklyDelta: null,
          monthlyDelta: null,
          mmPerWeek: null,
          direction: 'stable' as const,
          perSite,
        }
      }

      const byDate = new Map<string, { value_mm: number }[]>()
      for (const r of rows) {
        const readings = byDate.get(r.date) ?? []
        readings.push({ value_mm: r.value_mm })
        byDate.set(r.date, readings)
      }
      // Ascending by date (rows were fetched ascending, so map insertion order matches).
      const datedAverages = [...byDate.entries()].map(([date, readings]) => ({
        date,
        average: sessionAverage(readings),
      }))
      const mostRecentFirst = datedAverages.toReversed()

      const stats = computeStats(mostRecentFirst.map((d) => d.average))

      const last7 = mostRecentFirst.slice(0, 7)
      const weeklyDelta =
        last7.length >= 2
          ? Math.round((last7[0]!.average - last7[last7.length - 1]!.average) * 10) / 10
          : null

      const last30 = mostRecentFirst.slice(0, 30)
      const monthlyDelta =
        last30.length >= 2
          ? Math.round((last30[0]!.average - last30[last30.length - 1]!.average) * 10) / 10
          : null

      const rate = trailingRatePerWeek(
        datedAverages.map((d) => ({ date: d.date, value: d.average })),
      )
      const mmPerWeek = rate !== null ? Math.round(rate * 100) / 100 : null
      const direction = classifySkinfoldDirection(mmPerWeek)

      return { ...stats, weeklyDelta, monthlyDelta, mmPerWeek, direction, perSite }
    },
    {
      query: WindowQuerySchema,
      response: SkinfoldSummarySchema,
      detail: {
        tags: ['Garmin Health'],
        summary: 'Skinfold caliper summary',
        description:
          'Server-computed rolling skinfold-thickness stats from manual caliper readings. ' +
          'Each date is reduced to a session average across sites before rolling stats are computed. ' +
          'ma7/ma30 = average of most-recent 7/30 dated averages. ' +
          'weeklyDelta = latest − oldest within last 7 dated averages (positive = increasing/fatter). ' +
          'monthlyDelta = latest − oldest within last 30 dated averages. ' +
          'Trend: ma7 vs ma30 — down (>0.5% lower) is the good direction (leaner). ' +
          'direction classifies the trailing 28-day mm/week slope: reducing (good), increasing, or stable. ' +
          'perSite returns the latest reading per registered site within the window. ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. ' +
          'For raw per-date readings use GET /skinfold-log/series; for pagination use GET /skinfold-log. ' +
          'Example: GET /skinfold-log/summary?window=90d',
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
        .select({ date: skinfoldLog.date, site: skinfoldLog.site, value_mm: skinfoldLog.value_mm })
        .from(skinfoldLog)
        .where(and(gte(skinfoldLog.date, fromStr), lte(skinfoldLog.date, toStr)))
        .orderBy(asc(skinfoldLog.date))

      const byDate = new Map<string, { site: string; value_mm: number }[]>()
      for (const r of rows) {
        const readings = byDate.get(r.date) ?? []
        readings.push({ site: r.site, value_mm: r.value_mm })
        byDate.set(r.date, readings)
      }

      const points = [...byDate.entries()].map(([date, readings]) => ({
        date,
        average: sessionAverage(readings),
        readings: readings.map((r) => ({ site: r.site as SkinfoldSite, valueMm: r.value_mm })),
      }))

      return { points }
    },
    {
      query: WindowQuerySchema,
      response: z.object({
        points: z.array(
          z.object({
            date: z.string().describe('YYYY-MM-DD'),
            average: z.number().describe('Session average across all sites recorded that date'),
            readings: z.array(
              z.object({
                site: SkinfoldSiteEnum,
                valueMm: z.number(),
              }),
            ),
          }),
        ),
      }),
      detail: {
        tags: ['Garmin Health'],
        summary: 'Skinfold caliper time series',
        description:
          'One data point per date with caliper readings, including the per-site breakdown and the session average, for charting body-fat trend lines (one line per site plus the average). ' +
          'Accept `?window=7d|30d|90d|all` (default 30d) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. ' +
          'For rolling stats and trend classification use GET /skinfold-log/summary. ' +
          'Example: GET /skinfold-log/series?window=all',
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

      const sortCol =
        sort === 'site'
          ? skinfoldLog.site
          : sort === 'value_mm'
            ? skinfoldLog.value_mm
            : skinfoldLog.date

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(skinfoldLog)
          .orderBy(order === 'asc' ? asc(sortCol) : desc(sortCol))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(skinfoldLog),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { data: rows as any, total: Number(countResult[0]?.count ?? 0) }
    },
    {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
        sort: z.enum(['date', 'site', 'value_mm']).optional(),
        order: z.enum(['asc', 'desc']).default('desc').optional(),
      }),
      response: z.object({
        data: z.array(SkinfoldLogSchema),
        total: z.number().int(),
      }),
      detail: {
        tags: ['Garmin Health'],
        summary: 'List skinfold readings',
        description:
          'Returns paginated raw caliper readings (manual input), one row per site per date. `page` is 1-indexed, `limit` ≤ 200. Sort: date (default, newest first), site, value_mm. For rolling averages and trend classification use GET /skinfold-log/summary; for per-date charting use GET /skinfold-log/series.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '',
    async ({ body, set }) => {
      for (const reading of body.readings) {
        const [existing] = await db
          .select({ id: skinfoldLog.id })
          .from(skinfoldLog)
          .where(and(eq(skinfoldLog.date, body.date), eq(skinfoldLog.site, reading.site)))
          .orderBy(desc(skinfoldLog.id))
          .limit(1)

        if (existing) {
          await db
            .update(skinfoldLog)
            .set({ value_mm: reading.value_mm })
            .where(eq(skinfoldLog.id, existing.id))
        } else {
          await db.insert(skinfoldLog).values({
            date: body.date,
            site: reading.site,
            value_mm: reading.value_mm,
          })
        }
      }

      set.status = 201
      return { date: body.date, upserted: body.readings.length }
    },
    {
      body: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        readings: z
          .array(
            z.object({
              site: SkinfoldSiteEnum,
              value_mm: z.number().min(1).max(100),
            }),
          )
          .min(1),
      }),
      response: { 201: z.object({ date: z.string(), upserted: z.number() }) },
      detail: {
        tags: ['Garmin Health'],
        summary: 'Add or replace a skinfold caliper session',
        description:
          'Records one or more caliper readings for the given day, one per site. `date` is YYYY-MM-DD, `value_mm` is 1–100. ' +
          'If a reading already exists for a given (date, site), its value is overwritten; otherwise a new row is inserted ' +
          '(one reading per date+site; later submits replace earlier ones). Returns the date and the number of readings upserted.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, set }) => {
      const [existing] = await db
        .select()
        .from(skinfoldLog)
        .where(eq(skinfoldLog.id, Number(params.id)))
      if (!existing) {
        set.status = 404
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return 'Not found' as any
      }
      await db.delete(skinfoldLog).where(eq(skinfoldLog.id, Number(params.id)))
      return { id: Number(params.id) }
    },
    {
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({ id: z.number() }),
        404: z.string(),
      },
      detail: {
        tags: ['Garmin Health'],
        summary: 'Delete a skinfold reading',
        description:
          'Removes a single skinfold caliper reading by id. Returns 404 if no reading with that id exists, 200 with the deleted id on success. Deletes are hard — there is no soft-delete column.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
