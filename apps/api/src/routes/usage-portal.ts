import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { iuPortalCost, iuPortalTotal } from '../db/schema.js'
import {
  IU_WINDOW_DAYS,
  addDays,
  computeBudget,
  mergeModels,
  reconcileDays,
  type PortalCell,
} from '../lib/iu-budget.js'
import { utcBucket } from '../lib/usage-query.js'

// IU's own cost report. usage-tracker scrapes the portal and POSTs it here; the cap, can-spend-today
// and the portal-vs-tracked reconciliation are computed from these tables, never from our own
// price estimate (`usage_record.cost_usd`).

const MAX_COSTS = 1000
const MAX_TOTALS = 24
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

const trimmed = z.string().transform((s) => s.trim())
const nonEmpty = trimmed.pipe(z.string().min(1))
const isoInstant = nonEmpty
  .refine((s) => Number.isFinite(Date.parse(s)), 'not an instant')
  .transform((s) => new Date(s).toISOString())
const calendarDay = nonEmpty.pipe(z.string().regex(DAY_RE)).refine((s) => {
  const ms = Date.parse(`${s}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(s)
}, 'not a calendar day')

const CostRow = z.object({
  day: calendarDay,
  label: nonEmpty,
  row: z.number().int().min(0),
  model: trimmed.nullable().optional(),
  costUsd: z.number().finite().min(0),
  fetchedAt: isoInstant,
})

const TotalRow = z.object({
  month: nonEmpty.pipe(z.string().regex(MONTH_RE)),
  totalUsd: z.number().finite().min(0),
  fetchedAt: isoInstant,
})

/** Valid rows of an untrusted batch plus how many were dropped. */
function validRows<S extends z.ZodType>(schema: S, items: readonly unknown[]) {
  const rows: Array<z.output<S>> = []
  for (const item of items) {
    const parsed = schema.safeParse(item)
    if (parsed.success) rows.push(parsed.data)
  }
  return { rows, rejected: items.length - rows.length }
}

/** Last row wins on a repeated natural key, so one multi-row INSERT never conflicts with itself. */
function lastPerKey<T>(rows: readonly T[], key: (r: T) => string): T[] {
  return [...new Map(rows.map((r) => [key(r), r])).values()]
}

const rowsOf = <T>(result: unknown) => result as unknown as T[]

/** Newest portal day, or null when nothing has been synced. */
async function latestPortalDay(): Promise<{ day: string; fetchedAt: string } | null> {
  const [row] = rowsOf<{ day: string | null; fetched_at: string | null }>(
    await db.execute(sql`
      SELECT max(day)::text AS day, max(fetched_at)::text AS fetched_at FROM argo.iu_portal_cost
    `),
  )
  return row?.day && row.fetched_at ? { day: row.day, fetchedAt: row.fetched_at } : null
}

/** First day the portal reported; earlier days cannot be reconciled. */
async function earliestPortalDay(): Promise<string | null> {
  const [row] = rowsOf<{ day: string | null }>(
    await db.execute(sql`SELECT min(day)::text AS day FROM argo.iu_portal_cost`),
  )
  return row?.day ?? null
}

export const usagePortalRoutes = new Elysia()
  .post(
    '/iu-portal',
    async ({ body }) => {
      const costs = validRows(CostRow, body.costs)
      const totals = validRows(TotalRow, body.totals)
      const rejected = costs.rejected + totals.rejected
      if (rejected > 0) console.warn(`iu-portal ingest: ${rejected} invalid row(s) dropped`)

      const costRows = lastPerKey(costs.rows, (r) => `${r.day}|${r.label}|${r.row}`)
      const totalRows = lastPerKey(totals.rows, (r) => r.month)

      // One transaction per batch, and a row only moves forward in time: a retry that delivers an
      // older report after a newer one must not roll the cap's inputs back.
      await db.transaction(async (tx) => {
        if (costRows.length > 0) {
          await tx
            .insert(iuPortalCost)
            .values(
              costRows.map((r) => ({
                day: r.day,
                label: r.label,
                row: r.row,
                model: r.model ? r.model : null,
                cost_usd: r.costUsd,
                fetched_at: r.fetchedAt,
              })),
            )
            .onConflictDoUpdate({
              target: [iuPortalCost.day, iuPortalCost.label, iuPortalCost.row],
              set: {
                model: sql`excluded.model`,
                cost_usd: sql`excluded.cost_usd`,
                fetched_at: sql`excluded.fetched_at`,
              },
              setWhere: sql`excluded.fetched_at >= ${iuPortalCost.fetched_at}`,
            })
        }
        if (totalRows.length > 0) {
          await tx
            .insert(iuPortalTotal)
            .values(
              totalRows.map((r) => ({
                month: r.month,
                total_usd: r.totalUsd,
                fetched_at: r.fetchedAt,
              })),
            )
            .onConflictDoUpdate({
              target: iuPortalTotal.month,
              set: { total_usd: sql`excluded.total_usd`, fetched_at: sql`excluded.fetched_at` },
              setWhere: sql`excluded.fetched_at >= ${iuPortalTotal.fetched_at}`,
            })
        }
      })

      return { costs: costRows.length, totals: totalRows.length, rejected }
    },
    {
      body: z.object({
        costs: z.array(z.unknown()).max(MAX_COSTS),
        totals: z.array(z.unknown()).max(MAX_TOTALS),
      }),
      response: {
        200: z.object({
          costs: z.number().int(),
          totals: z.number().int(),
          rejected: z.number().int(),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'Upsert the IU portal cost report',
        description:
          'Idempotent upsert of IU self-service portal cells: costs [{day YYYY-MM-DD, label, row, model|null, costUsd, fetchedAt ISO}] (≤ 1000) keyed on (day, label, row), totals [{month YYYY-MM, totalUsd, fetchedAt}] (≤ 24) keyed on month. The portal re-posts a day as it settles, so a matching key is overwritten and a replay is a no-op. A row that fails validation is dropped and counted in `rejected`, never failing the batch. Returns the accepted row counts. Same auth as POST /usage/records.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/iu-budget',
    async () => {
      const latest = await latestPortalDay()
      if (!latest) {
        return { ...computeBudget([], new Date().toISOString().slice(0, 10)), fetchedAt: null }
      }
      const cells = rowsOf<{ day: string; label: string; usd: number }>(
        await db.execute(sql`
          SELECT day::text AS day, label, SUM(cost_usd)::float AS usd
          FROM argo.iu_portal_cost
          WHERE day > ${addDays(latest.day, -(IU_WINDOW_DAYS + 1))}::date
          GROUP BY day, label
        `),
      ).map((r): PortalCell => ({ day: r.day, label: r.label, usd: Number(r.usd) }))
      return {
        ...computeBudget(cells, latest.day),
        fetchedAt: new Date(latest.fetchedAt).toISOString(),
      }
    },
    {
      response: {
        200: z.object({
          limitUsd: z.number(),
          windowDays: z.number().int(),
          fetchedAt: z.string().nullable(),
          windowFrom: z.string(),
          windowTo: z.string(),
          rolling30Usd: z.number(),
          canSpendTodayUsd: z.number(),
          burn7dUsdPerDay: z.number(),
          projected7dUsd: z.number(),
          daily: z.array(z.object({ day: z.string(), usd: z.number() })),
          dropoffNext7: z.array(
            z.object({ day: z.string(), freesUsd: z.number(), headroomUsd: z.number() }),
          ),
          topModels: z.array(z.object({ label: z.string(), usd: z.number() })),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'IU API cap: rolling 30-day budget',
        description:
          "The IU employee cap (limitUsd 500) is a rolling window of windowDays (30): the newest portal day and the 29 days before, as measured by IU's portal. canSpendTodayUsd = limit − the 29 days before the newest day (negative = over). dropoffNext7[i].freesUsd is what leaves the window i+1 days from now; headroomUsd the headroom once it has. burn7dUsdPerDay is the mean of the last 7 portal days; projected7dUsd the rolling total in 7 days at that burn. fetchedAt is the newest portal fetch (null = no portal data yet; the arithmetic then runs over zero). Same numbers as `make budget` in usage-tracker.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/iu-reconcile',
    async ({ query }) => {
      const days = query.days
      const latest = await latestPortalDay()
      const today = latest?.day ?? new Date().toISOString().slice(0, 10)
      // Days before the portal's first report have no portal figure to compare against.
      const earliest = latest ? await earliestPortalDay() : null
      const requested = addDays(today, -(days - 1))
      const from = earliest && earliest > requested ? earliest : requested
      const span = Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000) + 1

      const [portalDays, portalModels, trackedDays, trackedModels, unpriced] = await Promise.all([
        db.execute(sql`
          SELECT day::text AS key, SUM(cost_usd)::float AS usd FROM argo.iu_portal_cost
          WHERE day BETWEEN ${from}::date AND ${today}::date GROUP BY day
        `),
        db.execute(sql`
          SELECT COALESCE(model, label) AS key, SUM(cost_usd)::float AS usd FROM argo.iu_portal_cost
          WHERE day BETWEEN ${from}::date AND ${today}::date GROUP BY 1
        `),
        // Portal days are UTC, so tracked rows bucket on the UTC day too.
        db.execute(sql`
          SELECT (${utcBucket('day', sql`ts`)})::date::text AS key, COALESCE(SUM(cost_usd), 0)::float AS usd
          FROM argo.usage_record
          WHERE billing = 'iu'
            AND (${utcBucket('day', sql`ts`)})::date BETWEEN ${from}::date AND ${today}::date
          GROUP BY 1
        `),
        db.execute(sql`
          SELECT COALESCE(model_norm, model, '(unknown model)') AS key, COALESCE(SUM(cost_usd), 0)::float AS usd
          FROM argo.usage_record
          WHERE billing = 'iu'
            AND (${utcBucket('day', sql`ts`)})::date BETWEEN ${from}::date AND ${today}::date
          GROUP BY 1
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS n FROM argo.usage_record
          WHERE billing = 'iu' AND cost_usd IS NULL
            AND (${utcBucket('day', sql`ts`)})::date BETWEEN ${from}::date AND ${today}::date
        `),
      ])

      type Keyed = Array<{ key: string; usd: number }>
      const toMap = (result: unknown) =>
        new Map(rowsOf<Keyed[number]>(result).map((r) => [r.key, Number(r.usd)]))
      const portalByDay = toMap(portalDays)
      const trackedByDay = toMap(trackedDays)
      const sumOf = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
      const round2 = (n: number) => Math.round(n * 100) / 100

      return {
        days: latest ? reconcileDays(portalByDay, trackedByDay, today, span) : [],
        models: mergeModels(toMap(portalModels), toMap(trackedModels)),
        unpricedRows: Number(rowsOf<{ n: number }>(unpriced)[0]?.n ?? 0),
        windowTotals: {
          portalUsd: round2(sumOf(portalByDay)),
          trackedUsd: round2(sumOf(trackedByDay)),
        },
      }
    },
    {
      query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
      response: {
        200: z.object({
          days: z.array(
            z.object({
              day: z.string(),
              portalUsd: z.number(),
              trackedUsd: z.number(),
              deltaUsd: z.number(),
              ratio: z.number().nullable(),
              flagged: z.boolean(),
              partial: z.boolean(),
            }),
          ),
          models: z.array(
            z.object({ label: z.string(), portalUsd: z.number(), trackedUsd: z.number() }),
          ),
          unpricedRows: z.number().int(),
          windowTotals: z.object({ portalUsd: z.number(), trackedUsd: z.number() }),
        }),
      },
      detail: {
        tags: ['Usage Tracking'],
        summary: 'IU portal vs tracked spend',
        description:
          'Per UTC day over the last ?days (default 30, ending on the newest portal day, never earlier than the first portal day): portal cost vs our tracked estimate (`SUM(cost_usd) WHERE billing = iu`). deltaUsd = tracked − portal; flagged when |delta| > max($1, 20 % of portal), the `make budget` rule; the newest day is partial. models joins portal labels with tracked model_norm on their alphanumerics; a model seen on one side keeps its own label. unpricedRows counts IU rows with a NULL cost in the window. With no portal data days is empty. Same auth as GET /usage/*.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
