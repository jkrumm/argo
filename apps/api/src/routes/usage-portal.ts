import { Elysia } from 'elysia'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { USAGE_ROWS } from '../lib/usage-source.js'
import {
  IU_WINDOW_DAYS,
  addDays,
  computeBudget,
  mergeModels,
  reconcileDays,
  type PortalCell,
} from '../lib/iu-budget.js'
import { DEFAULT_IU_KEY, IU_KEY_LIMIT_USD, IuKeyEnum, type IuKey } from '../lib/iu-keys.js'
import { utcBucket } from '../lib/usage-query.js'

// IU's own cost report, read from `usage.iu_portal_cost` (written by usage-tracker). The cap,
// can-spend-today and the portal-vs-tracked reconciliation are computed from it, never from our own
// price estimate (`cost_usd` on the usage rows).

const rowsOf = <T>(result: unknown) => result as unknown as T[]

/** Newest portal day of one key, or null when nothing has been synced for it. */
async function latestPortalDay(iuKey: IuKey): Promise<{ day: string; fetchedAt: string } | null> {
  const [row] = rowsOf<{ day: string | null; fetched_at: string | null }>(
    await db.execute(sql`
      SELECT max(day)::text AS day, max(fetched_at)::text AS fetched_at FROM usage.iu_portal_cost
      WHERE iu_key = ${iuKey}
    `),
  )
  return row?.day && row.fetched_at ? { day: row.day, fetchedAt: row.fetched_at } : null
}

/** First day the portal reported for one key; earlier days cannot be reconciled. */
async function earliestPortalDay(iuKey: IuKey): Promise<string | null> {
  const [row] = rowsOf<{ day: string | null }>(
    await db.execute(
      sql`SELECT min(day)::text AS day FROM usage.iu_portal_cost WHERE iu_key = ${iuKey}`,
    ),
  )
  return row?.day ?? null
}

export const usagePortalRoutes = new Elysia()
  .get(
    '/iu-budget',
    async ({ query }) => {
      const iuKey = query.iuKey ?? DEFAULT_IU_KEY
      const limitUsd = IU_KEY_LIMIT_USD[iuKey]
      const latest = await latestPortalDay(iuKey)
      if (!latest) {
        return {
          ...computeBudget([], new Date().toISOString().slice(0, 10), limitUsd),
          iuKey,
          fetchedAt: null,
        }
      }
      const cells = rowsOf<{ day: string; label: string; usd: number }>(
        await db.execute(sql`
          SELECT day::text AS day, label, SUM(cost_usd)::float AS usd
          FROM usage.iu_portal_cost
          WHERE iu_key = ${iuKey} AND day > ${addDays(latest.day, -(IU_WINDOW_DAYS + 1))}::date
          GROUP BY day, label
        `),
      ).map((r): PortalCell => ({ day: r.day, label: r.label, usd: Number(r.usd) }))
      return {
        ...computeBudget(cells, latest.day, limitUsd),
        iuKey,
        fetchedAt: new Date(latest.fetchedAt).toISOString(),
      }
    },
    {
      query: z.object({ iuKey: IuKeyEnum.optional() }),
      response: {
        200: z.object({
          iuKey: IuKeyEnum,
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
          "?iuKey=personal|athena-team (default personal; no `all`: each key has its own independent cap) picks the IU API key; everything below is computed from that key's portal rows only and the key is echoed in `iuKey`. The IU employee cap (limitUsd 500) is a rolling window of windowDays (30): the newest portal day and the 29 days before, as measured by IU's portal. canSpendTodayUsd = limit − the 29 days before the newest day (negative = over). dropoffNext7[i].freesUsd is what leaves the window i+1 days from now; headroomUsd the headroom once it has. burn7dUsdPerDay is the mean of the last 7 portal days; projected7dUsd the rolling total in 7 days at that burn. fetchedAt is the newest portal fetch (null = no portal data yet; the arithmetic then runs over zero). Reads `usage.iu_portal_cost`. Same numbers as `make budget` in usage-tracker.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/iu-reconcile',
    async ({ query }) => {
      const days = query.days
      const iuKey = query.iuKey ?? DEFAULT_IU_KEY
      const latest = await latestPortalDay(iuKey)
      const today = latest?.day ?? new Date().toISOString().slice(0, 10)
      // Days before the portal's first report have no portal figure to compare against.
      const earliest = latest ? await earliestPortalDay(iuKey) : null
      const requested = addDays(today, -(days - 1))
      const from = earliest && earliest > requested ? earliest : requested
      const span = Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000) + 1

      const [portalDays, portalModels, trackedDays, trackedModels, unpriced] = await Promise.all([
        db.execute(sql`
          SELECT day::text AS key, SUM(cost_usd)::float AS usd FROM usage.iu_portal_cost
          WHERE iu_key = ${iuKey} AND day BETWEEN ${from}::date AND ${today}::date GROUP BY day
        `),
        db.execute(sql`
          SELECT COALESCE(model, label) AS key, SUM(cost_usd)::float AS usd FROM usage.iu_portal_cost
          WHERE iu_key = ${iuKey} AND day BETWEEN ${from}::date AND ${today}::date GROUP BY 1
        `),
        // Portal days are UTC, so tracked rows bucket on the UTC day too.
        db.execute(sql`
          SELECT (${utcBucket('day', sql`ts`)})::date::text AS key, COALESCE(SUM(cost_usd), 0)::float AS usd
          FROM ${USAGE_ROWS}
          WHERE billing = 'iu' AND iu_key = ${iuKey}
            AND (${utcBucket('day', sql`ts`)})::date BETWEEN ${from}::date AND ${today}::date
          GROUP BY 1
        `),
        db.execute(sql`
          SELECT COALESCE(model_norm, model, '(unknown model)') AS key, COALESCE(SUM(cost_usd), 0)::float AS usd
          FROM ${USAGE_ROWS}
          WHERE billing = 'iu' AND iu_key = ${iuKey}
            AND (${utcBucket('day', sql`ts`)})::date BETWEEN ${from}::date AND ${today}::date
          GROUP BY 1
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS n FROM ${USAGE_ROWS}
          WHERE billing = 'iu' AND iu_key = ${iuKey} AND cost_usd IS NULL
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
        iuKey,
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
      query: z.object({
        days: z.coerce.number().int().min(1).max(90).default(30),
        iuKey: IuKeyEnum.optional(),
      }),
      response: {
        200: z.object({
          iuKey: IuKeyEnum,
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
          'For one IU API key (?iuKey=personal|athena-team, default personal, echoed in `iuKey`; no `all`), per UTC day over the last ?days (default 30, ending on the newest portal day, never earlier than the first portal day): portal cost vs our tracked estimate (`SUM(cost_usd) WHERE billing = iu AND iu_key = ?iuKey`). deltaUsd = tracked − portal; flagged when |delta| > max($1, 20 % of portal), the `make budget` rule; the newest day is partial. models joins portal labels with tracked model_norm on their alphanumerics; a model seen on one side keeps its own label. unpricedRows counts IU rows with a NULL cost in the window. With no portal data days is empty. Reads `usage.iu_portal_cost` and the `usage` records.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
