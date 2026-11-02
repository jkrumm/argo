import { Elysia } from 'elysia'
import { z } from 'zod'
import { log } from '../telemetry.js'
import { CREDIT_PAYERS } from '../lib/usage-query.js'
import { IU_KEYS } from '../lib/iu-keys.js'
import {
  detectInsights,
  periodWindows,
  PERIODS,
  type InsightInputs,
  type Period,
  type Window,
} from '../lib/usage-insights.js'
import { loadPace } from './usage-pace.js'
import { loadRouter } from './usage-router.js'
import { loadDemand, type DemandParams } from './usage-demand.js'
import { loadIuBudget } from './usage-portal.js'

// GET /usage/insights: three to five ranked observations under the verdict (spec
// docs/design/usage-tracking.md v7, §Insights). The detectors are pure (`lib/usage-insights.ts`); this file
// reads what they need through the same loaders the endpoints use and never lets one unreadable source fail
// the response: a source that throws is logged, becomes null, and the detectors that need it do not fire.

/** Rows a `top` this high never folds a workflow into `(other)` (the endpoint caps it at 200). */
const ALL_KEYS = 200
/** purpose ≠ eval, the pace model's production. */
const PRODUCTION_PURPOSES = ['prod', 'verify', 'other'] as const

async function guarded<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    log.warn(
      `usage insights: ${what} unreadable: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    return null
  }
}

const iso = (window: Window) => ({
  fromIso: window.from.toISOString(),
  toIso: window.to.toISOString(),
})

/** The insights of one period as of `now` (a parameter so a test can pin the clock). */
export async function loadInsights(period: Period, now: Date) {
  const { current, previous } = periodWindows(now, period)
  const demand = (what: string, window: Window, params: Partial<DemandParams> = {}) =>
    guarded(`demand ${what}`, () =>
      loadDemand({ ...iso(window), by: 'workflow', top: ALL_KEYS, ...params }),
    )

  const [
    pace,
    router,
    routerPrevious,
    demandAll,
    demandPrevious,
    productionCredit,
    evalCredit,
    demandByCaller,
    ...budgets
  ] = await Promise.all([
    guarded('pace', () => loadPace(now)),
    guarded('router', () => loadRouter(iso(current))),
    guarded('router (previous)', () => loadRouter(iso(previous))),
    demand('all', current),
    demand('all (previous)', previous),
    demand('production credit', current, { payer: CREDIT_PAYERS, purpose: PRODUCTION_PURPOSES }),
    demand('eval credit', current, { payer: CREDIT_PAYERS, purpose: ['eval'] }),
    demand('by caller', current, { by: 'caller' }),
    ...IU_KEYS.map((key) => guarded(`iu budget ${key}`, () => loadIuBudget(key, now))),
  ])

  const inputs: InsightInputs = {
    asOf: now,
    period,
    // pace reports `asOf` as its cutover while the gateway has written nothing: no data, so thin either way.
    gatewaySince: pace === null ? null : new Date(pace.cutover),
    demand: demandAll,
    demandPrevious,
    productionCredit,
    evalCredit,
    demandByCaller,
    router,
    routerPrevious,
    budgets: Object.fromEntries(IU_KEYS.map((key, i) => [key, budgets[i] ?? null])),
  }
  return { asOf: now.toISOString(), period, items: detectInsights(inputs) }
}

const InsightSchema = z.object({
  id: z
    .string()
    .describe(
      'Detector id: top-share | mover | cost-per-run | pool-split | claude-on-iu | cache-drop | cap-near',
    ),
  rank: z.number().int().describe('1 = first; ranked by usdMoved descending, ties by id'),
  node: z
    .string()
    .describe(
      'The Flow node the observation is about: pool:<account>, sub:<account>, key:personal, key:athena-team, router or demand:<workflow>',
    ),
  sentence: z
    .string()
    .describe('A template sentence; every number in it comes from `facts`, no model wrote it'),
  facts: z
    .record(z.string(), z.union([z.number(), z.string(), z.null()]))
    .describe('The figures the sentence is built from, for a view that wants to draw them'),
  usdMoved: z
    .number()
    .describe(
      'The money the observation is about, in dollars (list price for Claude work); the ranking key. 0 for a reassurance',
    ),
  thin: z
    .boolean()
    .describe(
      'true when the observation rests on under 24 h of gateway data in a window it reads (pace’s thin, generalised to the period); portal-based observations are never thin',
    ),
})

// No prefix of its own: mounted inside `usageRoutes`, which supplies `/usage`.
export const usageInsightsRoutes = new Elysia().get(
  '/insights',
  async ({ query }) => loadInsights(query.period, new Date()),
  {
    query: z.object({
      period: z
        .enum(PERIODS)
        .default('7d')
        .describe(
          'Rolling window the observations are about; the previous equal period is the comparison',
        ),
    }),
    response: {
      200: z.object({
        asOf: z.string().describe('ISO 8601 instant the figures were read'),
        period: z.enum(PERIODS).describe('The period the observations cover'),
        items: z
          .array(InsightSchema)
          .describe(
            'The detectors that fired, ranked, at most 5; empty means nothing stands out (the view says so)',
          ),
      }),
    },
    detail: {
      tags: ['Usage Tracking'],
      summary: 'Ranked observations about the money flow, by rules',
      description:
        'The observations under the usage page verdict over ?period=7d|30d (default 7d), the previous equal period being the comparison. Seven deterministic detectors read the same figures as /usage/demand, /usage/router, /usage/iu-budget and /usage/pace; each fires only past its threshold, its `sentence` is a template filled from its `facts` (no model writes a number or a word), and the top 5 are returned ranked by `usdMoved`, ties by id. Detectors: top-share (a workflow is ≥ 50 % of production credit spend, purpose ≠ eval on a credit pool); mover (a workflow spend changed ≥ $5 and ≥ 30 % against the previous period, which needs spend then); cost-per-run (a workflow cost per run changed ≥ 30 % with ≥ 5 runs in each period); pool-split (one pool carries ≥ 90 % of eval spend and a different one ≥ 90 % of production spend); claude-on-iu (Claude work on the IU key, causes claude-code | credit-fallback | route-fallback: above $1 a warning, at $0 (under half a cent) with gateway traffic the reassurance with usdMoved 0; silent while gateway_picks is unreadable); cache-drop (a caller × target cache hit rate fell ≥ 15 points on ≥ 50 requests in each period; usdMoved is the caller’s spend); cap-near (an IU key at ≥ 80 % of its rolling 30-day cap: its headroom, and the day it is back under when over; the Athena team key has its own sentence and is never summed with the personal key). `thin` marks an observation resting on under 24 h of gateway data. Any source that cannot be read makes its detectors silent, never an error; an empty `items` means nothing stands out. Use /usage/pace for the verdict itself, /usage/demand and /usage/router for the figures behind a node.',
      security: [{ BearerAuth: [] }],
    },
  },
)
