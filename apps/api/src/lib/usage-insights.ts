import { CREDIT_PAYERS } from './usage-query.js'
import { capState } from './iu-budget.js'
import type { IuKey } from './iu-keys.js'

// The rule-based observations under the usage page's verdict (spec docs/design/usage-tracking.md v7,
// §Insights). Every detector is a pure function over the figures `/usage/demand`, `/usage/router`,
// `/usage/iu-budget` and `/usage/pace` already produce; it fires only past its threshold, and its sentence is a
// template filled from the facts it returns. No model writes a number or a word of fact.
//
// A detector returns zero, one or (cap-near, one per key) insights. `detectInsights` ranks them by the money
// they are about and keeps the top five. A source that could not be read arrives as null: its detectors do not
// fire, nothing throws.

export const PERIODS = ['7d', '30d', '90d'] as const
export type Period = (typeof PERIODS)[number]
export const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 }

export const MAX_INSIGHTS = 5

const DAY_MS = 86_400_000
/** Under this much gateway data inside a window, an insight built on it is `thin` (spec vocabulary). */
const THIN_MS = DAY_MS

// ── Thresholds ────────────────────────────────────────────────────────────────────────────────────
/** top-share fires when one workflow is at least this share of production credit spend. */
export const TOP_SHARE_MIN = 0.5
/** mover fires at a spend change of at least this many dollars … */
export const MOVER_MIN_USD = 5
/** … and at least this fraction of the previous period's spend. */
export const MOVER_MIN_CHANGE = 0.3
/** cost-per-run fires when a workflow's cost per run moved by at least this fraction … */
export const COST_PER_RUN_MIN_CHANGE = 0.3
/** … with at least this many runs in each period. */
export const COST_PER_RUN_MIN_RUNS = 5
/** pool-split fires when one pool carries at least this share of eval spend and another of production spend. */
export const POOL_SPLIT_MIN_SHARE = 0.9
/** claude-on-iu warns above this many dollars of Claude work on IU in the period … */
export const CLAUDE_ON_IU_WARN_USD = 1
/** … and reassures below this: "$0" is whole cents, so the fractions of a cent a verify probe costs still read $0. */
export const CLAUDE_ON_IU_ZERO_USD = 0.005
/** cache-drop fires when a caller × target hit rate fell by at least this many points (0–1) … */
export const CACHE_DROP_MIN_POINTS = 0.15
/** … on at least this many requests in each period. */
export const CACHE_DROP_MIN_REQUESTS = 50

// ── Input shapes (structural; the loaders' outputs satisfy them) ───────────────────────────────────

export interface DemandRowLike {
  key: string
  usd: number
  runs: number
  byPayer: Record<string, number>
}
export interface DemandLike {
  rows: readonly DemandRowLike[]
  totals: { usd: number }
}
export interface RouterLike {
  iu: readonly { cause: string; usd: number }[]
  cache: readonly { caller: string; target: string; requests: number; hitRate: number | null }[]
  picksAvailable: boolean
  routeFallbackMeasured: boolean
}
export interface BudgetLike {
  limitUsd: number
  rolling30Usd: number
  underCapOn: string | null
  fetchedAt: string | null
}

export interface InsightInputs {
  asOf: Date
  period: Period
  /** The first gateway row (pace's `cutover`); null when unknown or none. Decides `thin`. */
  gatewaySince: Date | null
  /** All payers, all purposes, by workflow, over the current period and the previous equal one. */
  demand: DemandLike | null
  demandPrevious: DemandLike | null
  /** By workflow, credit payers only, purpose ≠ eval (what pace calls production), current period. */
  productionCredit: DemandLike | null
  /** By workflow, credit payers only, purpose eval, current period. */
  evalCredit: DemandLike | null
  /** By caller, all payers, current period: the spend a degraded cache hit rate is about. */
  demandByCaller: DemandLike | null
  router: RouterLike | null
  routerPrevious: RouterLike | null
  /** Portal budget per IU key; a key whose portal could not be read is null. */
  budgets: Partial<Record<IuKey, BudgetLike | null>>
}

export interface InsightDraft {
  id: string
  node: string
  sentence: string
  facts: Record<string, number | string | null>
  usdMoved: number
  thin: boolean
}
export interface Insight extends InsightDraft {
  rank: number
}

// ── Windows, thin ────────────────────────────────────────────────────────────────────────────────

export interface Window {
  from: Date
  to: Date
}

/** The period ending at `asOf` and the equal one before it. */
export function periodWindows(asOf: Date, period: Period): { current: Window; previous: Window } {
  const span = PERIOD_DAYS[period] * DAY_MS
  const mid = new Date(asOf.getTime() - span)
  return {
    current: { from: mid, to: asOf },
    previous: { from: new Date(mid.getTime() - span), to: mid },
  }
}

/**
 * True when any of the windows holds under 24 h of gateway data. This is pace's `thin` (the 7-day rate window
 * clipped to the first gateway row) generalised to the windows an insight reads: a period shorter than the data
 * it asks for is thin. Without a known first row nothing can be called solid.
 */
export function isThin(gatewaySince: Date | null, ...windows: Window[]): boolean {
  if (gatewaySince === null) return true
  return windows.some(
    (w) => w.to.getTime() - Math.max(w.from.getTime(), gatewaySince.getTime()) < THIN_MS,
  )
}

// ── Formatting (spec §Carried from v6 › Vocabulary) ───────────────────────────────────────────────

/** Whole dollars below $1,000 (grouped above), cents only under $10, `<$1` below one dollar. */
export function usd(value: number): string {
  if (value <= 0) return '$0'
  if (value < 1) return '<$1'
  // Round to whole cents first: 9.996 is `$10`, never `$10.00`.
  if (Math.round(value * 100) < 1000) return `$${(Math.round(value * 100) / 100).toFixed(2)}`
  return `$${Math.round(value).toLocaleString('en-US')}`
}
/** A cost per run: cents below $10 down to one cent, because "<$1 to <$1" says nothing about a cost per review. */
export function usdPerRun(value: number): string {
  if (value <= 0) return '$0'
  if (value < 0.005) return '<$0.01'
  if (Math.round(value * 100) < 1000) return `$${(Math.round(value * 100) / 100).toFixed(2)}`
  return `$${Math.round(value).toLocaleString('en-US')}`
}
const pct = (fraction: number) => `${Math.round(fraction * 100)} %`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `2026-11-12` → `12 Nov`. */
function shortDate(day: string): string {
  const [, month, date] = day.split('-')
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? month}`
}
const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10_000) / 10_000
const lastDays = (period: Period) => `the last ${PERIOD_DAYS[period]} days`
const previousDays = (period: Period) => `the previous ${PERIOD_DAYS[period]} days`
const codeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A named workflow, not an `(unset)` / `(other)` bucket: only a name can be a node and a subject. */
const named = (row: DemandRowLike) => !row.key.startsWith('(')

function mapByKey(rows: readonly DemandRowLike[]): Map<string, DemandRowLike> {
  return new Map(rows.filter(named).map((r) => [r.key, r]))
}

/** Dollars of the whole slice per pool (`iu`, `me`, `me2`), from the credit payers of its rows. */
function perPool(slice: DemandLike): Map<string, number> {
  const pools = new Map<string, number>()
  for (const row of slice.rows) {
    for (const [payer, value] of Object.entries(row.byPayer)) {
      if (!(CREDIT_PAYERS as readonly string[]).includes(payer)) continue
      const pool = payer.replace(/-credit$/, '')
      pools.set(pool, (pools.get(pool) ?? 0) + value)
    }
  }
  return pools
}

/** The largest entry; ties go to the lexically first key so the result is stable. */
function topEntry(map: Map<string, number>): { key: string; usd: number } | null {
  let best: { key: string; usd: number } | null = null
  for (const [key, value] of map) {
    if (best === null || value > best.usd || (value === best.usd && key < best.key)) {
      best = { key, usd: value }
    }
  }
  return best
}

// ── Detectors ────────────────────────────────────────────────────────────────────────────────────

/**
 * top-share. The named workflow with the biggest share of production credit spend in the period; fires at
 * ≥ 50 %. Production = purpose ≠ eval on a credit pool, as in /usage/pace.
 */
export function topShare(input: InsightInputs): InsightDraft[] {
  const slice = input.productionCredit
  if (slice === null || slice.totals.usd <= 0) return []
  const top = slice.rows
    .filter(named)
    .reduce<DemandRowLike | null>((best, r) => (best === null || r.usd > best.usd ? r : best), null)
  if (top === null) return []
  const share = top.usd / slice.totals.usd
  if (share < TOP_SHARE_MIN) return []
  const { current } = periodWindows(input.asOf, input.period)
  return [
    {
      id: 'top-share',
      node: `demand:${top.key}`,
      sentence: `${top.key} is ${pct(share)} of production credit in ${lastDays(input.period)} (${usd(top.usd)} of ${usd(slice.totals.usd)}).`,
      facts: {
        workflow: top.key,
        share: round4(share),
        usd: round2(top.usd),
        totalUsd: round2(slice.totals.usd),
        periodDays: PERIOD_DAYS[input.period],
      },
      usdMoved: round2(top.usd),
      thin: isThin(input.gatewaySince, current),
    },
  ]
}

/**
 * mover. The workflow whose spend (all payers, all purposes) changed most, in dollars, against the previous
 * equal period; fires at ≥ $5 and ≥ 30 % of the previous spend. A workflow with no spend before has nothing to
 * be compared with and is left to top-share.
 */
export function mover(input: InsightInputs): InsightDraft[] {
  if (input.demand === null || input.demandPrevious === null) return []
  const previous = mapByKey(input.demandPrevious.rows)
  const current = mapByKey(input.demand.rows)
  // Every workflow of either period; one that stopped has no current row and reads $0 now.
  const candidates = [...new Set([...current.keys(), ...previous.keys()])].map((key) => {
    const now = current.get(key)?.usd ?? 0
    const before = previous.get(key)?.usd ?? 0
    return { key, now, before, delta: now - before }
  })
  let best: (typeof candidates)[number] | null = null
  for (const c of candidates) {
    if (c.before <= 0 || Math.abs(c.delta) < MOVER_MIN_USD) continue
    // Basis points, so a change sitting exactly on 30 % does not depend on float noise.
    if (Math.round((Math.abs(c.delta) / c.before) * 10_000) < MOVER_MIN_CHANGE * 10_000) continue
    if (
      best === null ||
      Math.abs(c.delta) > Math.abs(best.delta) ||
      (Math.abs(c.delta) === Math.abs(best.delta) && c.key < best.key)
    ) {
      best = c
    }
  }
  if (best === null) return []
  const change = Math.abs(best.delta) / best.before
  const windows = periodWindows(input.asOf, input.period)
  return [
    {
      id: 'mover',
      node: `demand:${best.key}`,
      sentence: `${best.key} spend ${best.delta > 0 ? 'rose' : 'fell'} ${pct(change)}, from ${usd(best.before)} to ${usd(best.now)}, against ${previousDays(input.period)}.`,
      facts: {
        workflow: best.key,
        usd: round2(best.now),
        previousUsd: round2(best.before),
        deltaUsd: round2(best.delta),
        change: round4(best.delta / best.before),
        periodDays: PERIOD_DAYS[input.period],
      },
      usdMoved: round2(Math.abs(best.delta)),
      thin: isThin(input.gatewaySince, windows.current, windows.previous),
    },
  ]
}

/**
 * cost-per-run. A workflow whose cost per run (spend ÷ distinct runs) changed ≥ 30 % against the previous
 * period, with ≥ 5 runs in each. The pick is the one that moved the most money: |Δ per run| × current runs.
 */
export function costPerRun(input: InsightInputs): InsightDraft[] {
  if (input.demand === null || input.demandPrevious === null) return []
  const previous = mapByKey(input.demandPrevious.rows)
  let best: {
    key: string
    now: number
    before: number
    runs: number
    runsBefore: number
    moved: number
  } | null = null
  for (const [key, row] of mapByKey(input.demand.rows)) {
    const before = previous.get(key)
    if (!before || row.runs < COST_PER_RUN_MIN_RUNS || before.runs < COST_PER_RUN_MIN_RUNS) continue
    const perRun = row.usd / row.runs
    const perRunBefore = before.usd / before.runs
    if (perRunBefore <= 0) continue
    // Whole cents of change, so a change sitting exactly on the threshold does not depend on float noise.
    if (
      Math.round((Math.abs(perRun - perRunBefore) / perRunBefore) * 10_000) <
      COST_PER_RUN_MIN_CHANGE * 10_000
    )
      continue
    const moved = Math.abs(perRun - perRunBefore) * row.runs
    if (best === null || moved > best.moved || (moved === best.moved && key < best.key)) {
      best = {
        key,
        now: perRun,
        before: perRunBefore,
        runs: row.runs,
        runsBefore: before.runs,
        moved,
      }
    }
  }
  if (best === null) return []
  const { current, previous: prevWindow } = periodWindows(input.asOf, input.period)
  return [
    {
      id: 'cost-per-run',
      node: `demand:${best.key}`,
      sentence: `the cost per ${best.key} ${best.now < best.before ? 'fell' : 'rose'} from ${usdPerRun(best.before)} to ${usdPerRun(best.now)} (${best.runsBefore} runs before, ${best.runs} now).`,
      facts: {
        workflow: best.key,
        perRunUsd: round4(best.now),
        previousPerRunUsd: round4(best.before),
        runs: best.runs,
        previousRuns: best.runsBefore,
        change: round4((best.now - best.before) / best.before),
      },
      usdMoved: round2(best.moved),
      thin: isThin(input.gatewaySince, current, prevWindow),
    },
  ]
}

/** A share that rounds to the whole: "every" reads better than "100 %". */
const every = (share: number) => share >= 0.995

/**
 * pool-split. One credit pool carries ≥ 90 % of eval spend and a different one ≥ 90 % of production spend:
 * the eval reserve doing its job, or a pool starved. usdMoved is what the two pools carry of it.
 */
export function poolSplit(input: InsightInputs): InsightDraft[] {
  if (input.evalCredit === null || input.productionCredit === null) return []
  const evalPools = perPool(input.evalCredit)
  const prodPools = perPool(input.productionCredit)
  const evalTotal = [...evalPools.values()].reduce((a, b) => a + b, 0)
  const prodTotal = [...prodPools.values()].reduce((a, b) => a + b, 0)
  const evalTop = topEntry(evalPools)
  const prodTop = topEntry(prodPools)
  if (evalTop === null || prodTop === null || evalTotal <= 0 || prodTotal <= 0) return []
  const evalShare = evalTop.usd / evalTotal
  const prodShare = prodTop.usd / prodTotal
  if (evalTop.key === prodTop.key) return []
  if (evalShare < POOL_SPLIT_MIN_SHARE || prodShare < POOL_SPLIT_MIN_SHARE) return []
  const evalPhrase = every(evalShare) ? 'every eval' : `${pct(evalShare)} of eval spend`
  const prodPhrase = every(prodShare)
    ? 'every production call'
    : `${pct(prodShare)} of production spend`
  const { current } = periodWindows(input.asOf, input.period)
  return [
    {
      id: 'pool-split',
      node: `pool:${prodTop.key}`,
      sentence: `${evalTop.key} carries ${evalPhrase}, ${prodTop.key} ${prodPhrase}.`,
      facts: {
        evalPool: evalTop.key,
        evalShare: round4(evalShare),
        evalUsd: round2(evalTop.usd),
        productionPool: prodTop.key,
        productionShare: round4(prodShare),
        productionUsd: round2(prodTop.usd),
      },
      usdMoved: round2(evalTop.usd + prodTop.usd),
      thin: isThin(input.gatewaySince, current),
    },
  ]
}

const CLAUDE_ON_IU_CAUSES = ['claude-code', 'credit-fallback', 'route-fallback'] as const
const CAUSE_LABEL: Record<(typeof CLAUDE_ON_IU_CAUSES)[number], string> = {
  'claude-code': 'Claude Code',
  'credit-fallback': 'credit fallback',
  'route-fallback': 'route fallback',
}
const CAUSE_FACT: Record<(typeof CLAUDE_ON_IU_CAUSES)[number], string> = {
  'claude-code': 'claudeCodeUsd',
  'credit-fallback': 'creditFallbackUsd',
  'route-fallback': 'routeFallbackUsd',
}

/**
 * claude-on-iu. Claude work on the IU key in the period (causes claude-code, credit-fallback, route-fallback):
 * above $1 a warning; at $0 (under half a cent) with gateway traffic the reassurance, with usdMoved 0 so it ranks last. Does not
 * fire while the picks are unreadable (the causes are then guesses) and says so when the route fallback is not
 * measured yet.
 */
export function claudeOnIu(input: InsightInputs): InsightDraft[] {
  const router = input.router
  if (router === null || !router.picksAvailable) return []
  const byCause = new Map<string, number>()
  for (const row of router.iu) {
    if (!(CLAUDE_ON_IU_CAUSES as readonly string[]).includes(row.cause)) continue
    byCause.set(row.cause, (byCause.get(row.cause) ?? 0) + row.usd)
  }
  const total = [...byCause.values()].reduce((a, b) => a + b, 0)
  const traffic = router.cache.reduce((acc, r) => acc + r.requests, 0) > 0
  const { current } = periodWindows(input.asOf, input.period)
  const thin = isThin(input.gatewaySince, current)
  const facts = Object.fromEntries(
    CLAUDE_ON_IU_CAUSES.map((c) => [CAUSE_FACT[c], round2(byCause.get(c) ?? 0)]),
  )
  if (total > CLAUDE_ON_IU_WARN_USD) {
    const parts = CLAUDE_ON_IU_CAUSES.filter((c) => (byCause.get(c) ?? 0) > 0).map(
      (c) => `${CAUSE_LABEL[c]} ${usd(byCause.get(c) ?? 0)}`,
    )
    return [
      {
        id: 'claude-on-iu',
        node: 'router',
        sentence: `Claude work reached IU: ${usd(total)} in ${lastDays(input.period)} (${parts.join(', ')}), in Claude list dollars.`,
        facts: {
          ...facts,
          totalUsd: round2(total),
          routeFallbackMeasured: String(router.routeFallbackMeasured),
        },
        usdMoved: round2(total),
        thin,
      },
    ]
  }
  if (total < CLAUDE_ON_IU_ZERO_USD && traffic) {
    return [
      {
        id: 'claude-on-iu',
        node: 'router',
        sentence: router.routeFallbackMeasured
          ? `no Claude work fell back to IU in ${lastDays(input.period)}.`
          : `no Claude work fell back to IU in ${lastDays(input.period)} (route fallback is not measured yet).`,
        facts: {
          ...facts,
          totalUsd: round4(total),
          routeFallbackMeasured: String(router.routeFallbackMeasured),
        },
        usdMoved: 0,
        thin,
      },
    ]
  }
  return []
}

const targetLabel = (target: string) => (target === 'iu-api' ? 'the IU key' : target)

/**
 * cache-drop. A caller × target whose cache hit rate fell ≥ 15 points against the previous period, on ≥ 50
 * requests in each. The cache table carries no dollars, so usdMoved is the caller's spend in the period; the
 * pick is the caller with the most spend behind it.
 */
export function cacheDrop(input: InsightInputs): InsightDraft[] {
  if (input.router === null || input.routerPrevious === null) return []
  const previous = new Map(
    input.routerPrevious.cache.map((r) => [`${r.caller}\u0000${r.target}`, r]),
  )
  const spend = new Map((input.demandByCaller?.rows ?? []).map((r) => [r.key, r.usd]))
  let best: {
    caller: string
    target: string
    now: number
    before: number
    requests: number
    requestsBefore: number
    usd: number
  } | null = null
  for (const row of input.router.cache) {
    const before = previous.get(`${row.caller}\u0000${row.target}`)
    if (!before || row.hitRate === null || before.hitRate === null) continue
    if (row.requests < CACHE_DROP_MIN_REQUESTS || before.requests < CACHE_DROP_MIN_REQUESTS)
      continue
    // Tenths of a point, so a fall sitting exactly on 15 points does not depend on float noise.
    if (Math.round((before.hitRate - row.hitRate) * 1000) < CACHE_DROP_MIN_POINTS * 1000) continue
    const callerUsd = spend.get(row.caller) ?? 0
    const drop = before.hitRate - row.hitRate
    const bestDrop = best === null ? 0 : best.before - best.now
    if (
      best === null ||
      callerUsd > best.usd ||
      (callerUsd === best.usd && drop > bestDrop) ||
      (callerUsd === best.usd &&
        drop === bestDrop &&
        codeUnit(`${row.caller}${row.target}`, `${best.caller}${best.target}`) < 0)
    ) {
      best = {
        caller: row.caller,
        target: row.target,
        now: row.hitRate,
        before: before.hitRate,
        requests: row.requests,
        requestsBefore: before.requests,
        usd: callerUsd,
      }
    }
  }
  if (best === null) return []
  const { current, previous: prevWindow } = periodWindows(input.asOf, input.period)
  return [
    {
      id: 'cache-drop',
      node: 'router',
      sentence: `${best.caller}'s cache hit rate on ${targetLabel(best.target)} fell from ${pct(best.before)} to ${pct(best.now)} against ${previousDays(input.period)}.`,
      facts: {
        caller: best.caller,
        target: best.target,
        hitRate: round4(best.now),
        previousHitRate: round4(best.before),
        requests: best.requests,
        previousRequests: best.requestsBefore,
        callerUsd: round2(best.usd),
      },
      usdMoved: round2(best.usd),
      thin: isThin(input.gatewaySince, current, prevWindow),
    },
  ]
}

const KEY_LABEL: Record<IuKey, string> = {
  personal: 'the personal key',
  'athena-team': 'the Athena key',
}

/** Portal freshness (spec §Vocabulary): fresh ≤ 8 h, stale > 8 h, dead > 48 h. */
export const PORTAL_STALE_HOURS = 8
export const PORTAL_DEAD_HOURS = 48

/** `5 h` below two days, `3 d` from there. */
function ageText(hours: number): string {
  return hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`
}

/**
 * cap-near. An IU key at ≥ 80 % of its rolling 30-day cap, one insight per key and never a sum: the Athena key
 * appears only in its own sentence. Headroom = cap − rolling 30 d; `underCapOn` (set only for a key over its cap)
 * adds the date. Ranked by urgency: usdMoved is the key's rolling 30-day spend, so a key at 99 % outranks one at
 * 81 %. The figures are IU's portal's, not gateway rows, so the thin flag is about the portal's age instead: a
 * report older than 8 h is thin, says how old it is in the sentence, and `facts.freshness` reads fresh | stale |
 * dead (> 48 h). A report with an unparseable fetch time is not trusted: nothing fires.
 */
export function capNear(input: InsightInputs): InsightDraft[] {
  const drafts: InsightDraft[] = []
  for (const key of ['personal', 'athena-team'] as const) {
    const budget = input.budgets[key]
    if (!budget || budget.fetchedAt === null) continue
    const fetched = Date.parse(budget.fetchedAt)
    if (Number.isNaN(fetched)) continue
    if (capState(budget.rolling30Usd, budget.limitUsd) === 'ok') continue
    const ageHours = Math.max(0, (input.asOf.getTime() - fetched) / 3_600_000)
    const freshness =
      ageHours > PORTAL_DEAD_HOURS ? 'dead' : ageHours > PORTAL_STALE_HOURS ? 'stale' : 'fresh'
    const headroom = budget.limitUsd - budget.rolling30Usd
    const label = KEY_LABEL[key]
    let sentence: string
    if (headroom < 0) {
      sentence =
        budget.underCapOn === null
          ? `${label} is ${usd(-headroom)} over its cap and not back under within 60 days`
          : `${label} is ${usd(-headroom)} over its cap until ${shortDate(budget.underCapOn)}`
    } else {
      sentence =
        budget.underCapOn === null
          ? `${label} has ${usd(headroom)} of headroom`
          : `${label} has ${usd(headroom)} of headroom until ${shortDate(budget.underCapOn)}`
    }
    if (freshness !== 'fresh') sentence += ` (portal report ${ageText(ageHours)} old)`
    drafts.push({
      id: 'cap-near',
      node: `key:${key}`,
      sentence: `${sentence}.`,
      facts: {
        key,
        rolling30Usd: round2(budget.rolling30Usd),
        capUsd: round2(budget.limitUsd),
        headroomUsd: round2(headroom),
        underCapOn: budget.underCapOn,
        fetchedAt: budget.fetchedAt,
        freshness,
      },
      usdMoved: round2(budget.rolling30Usd),
      thin: freshness !== 'fresh',
    })
  }
  return drafts
}

export const DETECTORS: readonly ((input: InsightInputs) => InsightDraft[])[] = [
  topShare,
  mover,
  costPerRun,
  poolSplit,
  claudeOnIu,
  cacheDrop,
  capNear,
]

/** Every detector that fires, ranked by money moved (desc), ties by id then node; the top five, rank 1 first. */
export function detectInsights(input: InsightInputs): Insight[] {
  return DETECTORS.flatMap((detect) => detect(input))
    .toSorted((a, b) => b.usdMoved - a.usdMoved || codeUnit(a.id, b.id) || codeUnit(a.node, b.node))
    .slice(0, MAX_INSIGHTS)
    .map((insight, i) => ({ ...insight, rank: i + 1 }))
}
