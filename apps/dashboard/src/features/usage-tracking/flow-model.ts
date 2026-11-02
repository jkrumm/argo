/**
 * The Flow tab's pure model: the verdict sentence and the facts strip over `/usage/pace`, the node
 * readings (a pool, the router, a workflow) and the money and date words. No React, no queries: every
 * number a node card shows and the detail below it shows comes through the same function over the
 * same response, so the two cannot disagree (spec pass criterion 4). Dates are UTC days, like the API.
 */
import type {
  DemandResponse,
  DemandRow,
  InsightsResponse,
  LaneSplitResponse,
  PacePool,
  PaceResponse,
  RouterResponse,
} from '../../lib/queries/usage'
import type { PayerValue } from './accounts'
import { PAYER_LABELS, USAGE_ACCOUNTS } from './accounts'
import { formatAge } from './budget-model'

export const EM_DASH = '—'

// ── Money, dates ─────────────────────────────────────────────────────────────────────────────

const wholeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

/**
 * The page's money: whole dollars below $1,000 and with a thousands separator above, cents only under
 * $10, `<$1` below one dollar (zero reads `$0`). Never compacted. A missing figure is a dash.
 */
export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH
  const value = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (value === 0) return '$0'
  if (value < 1) return `${sign}<$1`
  if (value < 10) return `${sign}$${value.toFixed(2)}`
  return `${sign}$${wholeFormat.format(Math.round(value))}`
}

/** An axis tick: whole dollars from ten up, cents below ten so the ticks stay distinct (`$0.50`, never `<$1`). */
export function fmtAxisUsd(n: number): string {
  if (!Number.isFinite(n)) return EM_DASH
  if (n === 0) return '$0'
  if (Math.abs(n) >= 10) return fmtUsd(n)
  return `$${n.toFixed(2)}`
}

/** A dollars-a-day rate: `$8.65/d`. */
export const fmtRate = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? EM_DASH : `${fmtUsd(n)}/d`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `4 Nov`, the UTC day of an instant or a `YYYY-MM-DD` day. */
export function fmtDay(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return EM_DASH
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** `2 Nov 16:00 UTC`. */
export function fmtInstant(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return EM_DASH
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${fmtDay(d)} ${hh}:${mm} UTC`
}

/** Whole days: `16 days`, `1 day`. */
export const fmtDays = (n: number): string =>
  `${Math.round(n)} ${Math.round(n) === 1 ? 'day' : 'days'}`

/** A 0–1 share as a whole percentage with a thin space glue: `98 %`. */
export const fmtPct = (ratio: number | null | undefined): string =>
  ratio === null || ratio === undefined || !Number.isFinite(ratio)
    ? EM_DASH
    : `${Math.round(ratio * 100)} %`

export const DAY_MS = 86_400_000

// ── Pools ────────────────────────────────────────────────────────────────────────────────────

export const enabledPools = (pace: PaceResponse): PacePool[] => pace.pools.filter((p) => p.enabled)

const accountOf = (account: string) => USAGE_ACCOUNTS.find((a) => a.id === account)

/** `IU credit · Ultra`, `Me credit · Max`: the pool by its payer name and its plan. */
export function poolTitle(account: string): string {
  const entry = accountOf(account)
  if (entry === undefined) return `${account} credit`
  return `${PAYER_LABELS[entry.creditPayer]} · ${entry.plan === 'ultra' ? 'Ultra' : 'Max'}`
}

/** The payer id of a pool's credit, for colour and the `payer[]` filter. */
export const poolPayer = (account: string): PayerValue =>
  accountOf(account)?.creditPayer ?? 'unknown'

export interface PoolReading {
  account: string
  title: string
  enabled: boolean
  /** The state words of a pool that cannot be drawn: `not enabled · …`, `cycle unknown · …`. */
  note: string | null
  leftUsd: number | null
  grantUsd: number
  outsideUsd: number
  throughUsd: number
  /** Where an even pace would have the spend by now (grant − eval reserve); null without a known cycle. */
  evenSpentUsd: number | null
  /** The one line under the meter: expiry, the pace needed, the dry date, the lead on an even pace. */
  line: string
  /** Spending faster than an even pace by this much (negative: slower). */
  aheadUsd: number | null
  dryAt: string | null
}

export function poolReading(pool: PacePool, asOf: string): PoolReading {
  const title = poolTitle(pool.account)
  const base = {
    account: pool.account,
    title,
    enabled: pool.enabled,
    grantUsd: pool.grantUsd,
    dryAt: pool.projection.dryAt,
  }
  if (!pool.enabled) {
    const awaiting = pool.note === 'awaiting reconcile'
    return {
      ...base,
      note: awaiting ? 'awaiting reconcile' : 'not enabled · key not claimed · cycle unknown',
      leftUsd: null,
      outsideUsd: 0,
      throughUsd: 0,
      evenSpentUsd: null,
      line: awaiting
        ? 'cycle ended, awaiting the provider’s final figure'
        : 'key not claimed · cycle unknown',
      aheadUsd: null,
    }
  }
  const throughUsd = Math.max(0, pool.spentUsd - pool.outsideUsd)
  const evenSpentUsd = pool.evalReserveUsd === null ? null : pool.grantUsd - pool.evalReserveUsd
  const aheadUsd =
    pool.evalReserveUsd === null || pool.leftUsd === null
      ? null
      : pool.evalReserveUsd - pool.leftUsd
  const parts: string[] = []
  if (pool.cycle.end === null) {
    parts.push('cycle unknown · last 31 d')
  } else {
    parts.push(`expires ${fmtDay(pool.cycle.end)}`)
    if (pool.daysLeft !== null) parts.push(`${Math.round(pool.daysLeft)} d`)
  }
  if (pool.requiredUsdPerDay !== null) parts.push(`needs ${fmtRate(pool.requiredUsdPerDay)}`)
  const { drawsFrom, dryAt } = pool.projection
  if (drawsFrom !== null && new Date(drawsFrom).getTime() > new Date(asOf).getTime()) {
    parts.push(`draws from ${fmtDay(drawsFrom)}`)
  }
  if (dryAt !== null) parts.push(`dry ${fmtDay(dryAt)}`)
  else if (pool.projection.unspentAtEndUsd !== null && pool.projection.unspentAtEndUsd > 0.5) {
    parts.push(`≈ ${fmtUsd(pool.projection.unspentAtEndUsd)} unspent at expiry`)
  }
  if (aheadUsd !== null && Math.abs(aheadUsd) >= 1) {
    parts.push(`${fmtUsd(Math.abs(aheadUsd))} ${aheadUsd > 0 ? 'ahead of' : 'behind'} even pace`)
  }
  return {
    ...base,
    note: pool.cycle.status === 'unknown-end' ? 'cycle unknown · last 31 d' : null,
    leftUsd: pool.leftUsd,
    outsideUsd: pool.outsideUsd,
    throughUsd,
    evenSpentUsd,
    line: parts.join(' · '),
    aheadUsd,
  }
}

// ── The verdict ──────────────────────────────────────────────────────────────────────────────

export type VerdictState = PaceResponse['verdict']
export interface SentencePart {
  text: string
  /** `warn` inks the part: the louder (dry) state and a Claude cost on IU. */
  tone?: 'warn'
}
export interface Verdict {
  state: VerdictState
  badge: string
  /** `rate from 16 h`, null when the rate rests on a day or more. */
  thin: string | null
  sentence: SentencePart[]
  /** The independent second clause, as its own sentence. */
  iuClause: SentencePart
  /** `state now, 2 Nov 16:00 UTC`. */
  asOf: string
}

const BADGE: Record<VerdictState, string> = {
  over: 'Over pace',
  under: 'Under pace',
  'on-pace': 'On pace',
  'no-pool': 'No pool',
}

/** The pool whose cycle end is the spill's end: the one that renews first. */
function renewingPool(pace: PaceResponse): string | null {
  if (pace.spill === null) return null
  const until = new Date(pace.spill.until).getTime()
  return (
    enabledPools(pace).find(
      (p) => p.cycle.end !== null && new Date(p.cycle.end).getTime() === until,
    )?.account ?? null
  )
}

/** The largest credit that expires unspent past the verdict's threshold: max($5, 5 % of the grant). */
function unspentPool(pace: PaceResponse): PacePool | null {
  let best: PacePool | null = null
  for (const pool of enabledPools(pace)) {
    const unspent = pool.projection.unspentAtEndUsd
    if (unspent === null || unspent <= Math.max(5, pool.grantUsd * 0.05)) continue
    if (best === null || unspent > (best.projection.unspentAtEndUsd ?? 0)) best = pool
  }
  return best
}

export function verdictOf(pace: PaceResponse): Verdict {
  const iuClause: SentencePart = {
    text: `Claude on IU since the cutover: ${fmtUsd(pace.claudeOnIuUsd)}.`,
    ...(pace.claudeOnIuUsd > 1 ? { tone: 'warn' as const } : {}),
  }
  const thin = pace.thin ? `rate from ${Math.max(1, Math.round(pace.rate.windowHours))} h` : null
  const head = { state: pace.verdict, badge: BADGE[pace.verdict], thin, iuClause }
  const asOf = `state now, ${fmtInstant(pace.asOf)}`

  switch (pace.verdict) {
    case 'over': {
      const spill = pace.spill
      const renews = renewingPool(pace)
      const lead = spill === null ? EM_DASH : fmtDay(spill.from)
      const before =
        spill === null
          ? ''
          : `, ${fmtDays(spill.days)} before ${renews === null ? 'renewal' : `${renews} renews`}`
      return {
        ...head,
        asOf,
        sentence: [
          { text: 'Credit runs ' },
          { text: `dry on ${lead}`, tone: 'warn' },
          { text: ` at today’s rate${before}.` },
        ],
      }
    }
    case 'under': {
      const pool = unspentPool(pace)
      const usd = pool?.projection.unspentAtEndUsd ?? 0
      return {
        ...head,
        asOf,
        sentence: [
          { text: 'Credit expires unspent: ' },
          {
            text: `≈ ${fmtUsd(usd)} on ${pool?.cycle.end == null ? EM_DASH : fmtDay(pool.cycle.end)}`,
          },
          { text: '.' },
        ],
      }
    }
    case 'on-pace':
      return {
        ...head,
        asOf,
        sentence: [{ text: 'Credit is on pace to be spent before it expires.' }],
      }
    case 'no-pool':
      return { ...head, asOf, sentence: [{ text: 'No credit pool enabled.' }] }
  }
}

// ── The facts strip ──────────────────────────────────────────────────────────────────────────

export interface FactCell {
  key: string
  caption: string
  value: string
  tone?: 'warn' | 'bad'
  footer: string
}

const sum = (values: readonly (number | null)[]): number =>
  values.reduce<number>((acc, v) => acc + (v ?? 0), 0)

/** The provider-report age note when any enabled pool's report is older than 6 h. */
export function reportAgeNote(pace: PaceResponse, now: number): string | null {
  let oldest = 0
  for (const pool of enabledPools(pace)) {
    if (pool.reportedAt === null) continue
    oldest = Math.max(oldest, now - new Date(pool.reportedAt).getTime())
  }
  return oldest > 6 * 3_600_000 ? `provider report ${formatAge(oldest)} old` : null
}

/** Gateway silence the Router and Demand headers call out (spec §Empty and stale). */
export const GATEWAY_STALE_MS = 30 * 60_000

/** "last request {age} ago" once the newest gateway row is older than 30 min; null while fresh or without rows. */
export function lastRequestNote(lastRequestAt: string | null, now: number): string | null {
  if (lastRequestAt === null) return null
  const age = now - new Date(lastRequestAt).getTime()
  return age > GATEWAY_STALE_MS ? `last request ${formatAge(age)} ago` : null
}

export function factsOf(pace: PaceResponse, now: number): FactCell[] {
  const enabled = enabledPools(pace)
  const off = pace.pools.filter((p) => !p.enabled)
  const left = sum(enabled.map((p) => p.leftUsd))
  const grant = sum(enabled.map((p) => p.grantUsd))
  const required = enabled.filter((p) => p.requiredUsdPerDay !== null)
  const key = pace.personalKey
  const stale = reportAgeNote(pace, now)

  const leftFooter = [
    enabled.length === 0 ? 'no pool enabled' : `of ${fmtUsd(grant)} enabled`,
    ...off.map((p) => `${p.account} not enabled`),
    ...(stale === null ? [] : [stale]),
  ].join(' · ')

  const keyFooter =
    key.fetchedAt === null
      ? 'no portal report yet'
      : [
          `of ${fmtUsd(key.capUsd)} cap`,
          key.underCapOn === null ? null : `under it around ${fmtDay(key.underCapOn)}`,
        ]
          .filter((s) => s !== null)
          .join(' · ')

  const claude = pace.claudeOnIuUsd
  const iuFooter = claude > 0.005 ? 'fallback or Claude Code shaped' : 'no fallback · all by design'

  return [
    {
      key: 'left',
      caption: 'Credit left',
      value: enabled.length === 0 ? EM_DASH : fmtUsd(left),
      footer: leftFooter,
    },
    {
      key: 'required',
      caption: 'Pace to spend it all',
      value:
        required.length === 0 ? EM_DASH : fmtRate(sum(required.map((p) => p.requiredUsdPerDay))),
      footer:
        required.map((p) => `${p.account} ${fmtUsd(p.requiredUsdPerDay)}`).join(' · ') || EM_DASH,
    },
    {
      key: 'production',
      caption: 'Production on credit',
      value: fmtRate(pace.rate.productionUsdPerDay),
      ...(pace.verdict === 'over' ? { tone: 'warn' as const } : {}),
      footer: `evals ${fmtRate(pace.rate.evalUsdPerDay)} apart`,
    },
    {
      key: 'iu',
      caption: 'IU since the cutover',
      value: fmtUsd(claude),
      ...(claude > 1 ? { tone: 'warn' as const } : {}),
      footer: iuFooter,
    },
    {
      key: 'key',
      caption: 'IU personal key',
      value: key.fetchedAt === null ? EM_DASH : fmtUsd(key.rolling30Usd),
      ...(key.state === 'over'
        ? { tone: 'bad' as const }
        : key.state === 'warn'
          ? { tone: 'warn' as const }
          : {}),
      footer: keyFooter,
    },
  ]
}

// ── The router ───────────────────────────────────────────────────────────────────────────────

export const IU_CAUSE_LABEL = {
  design: 'non-Claude seats',
  eval: 'eval arms',
  'claude-code': 'Claude Code shaped',
  forced: 'forced (probes)',
  'credit-fallback': 'credit fallback',
  'route-fallback': 'route fallback',
} as const
export type IuCause = keyof typeof IU_CAUSE_LABEL
const IU_CAUSE_ORDER = Object.keys(IU_CAUSE_LABEL) as IuCause[]

/** Causes that are Claude work on the IU key: drawn in the warn ink once they carry a dollar. */
export const CLAUDE_ON_IU_CAUSES: readonly IuCause[] = [
  'claude-code',
  'credit-fallback',
  'route-fallback',
]

export interface TargetCount {
  target: string
  n: number
}

/** Picks per target over the range, most first (`iu`, `me`, `iu-api`, `refused`). */
export function picksByTarget(picks: RouterResponse['picks']): TargetCount[] {
  const counts = new Map<string, number>()
  for (const p of picks) counts.set(p.target, (counts.get(p.target) ?? 0) + p.n)
  return [...counts].map(([target, n]) => ({ target, n })).toSorted((a, b) => b.n - a.n)
}

export const totalPicks = (picks: RouterResponse['picks']): number => sum(picks.map((p) => p.n))

/** Picks per reason over the range, optionally of one target; most first. */
export function picksByReason(
  picks: RouterResponse['picks'],
  target?: string,
): { reason: string; n: number }[] {
  const counts = new Map<string, number>()
  for (const p of picks) {
    if (target !== undefined && p.target !== target) continue
    counts.set(p.reason, (counts.get(p.reason) ?? 0) + p.n)
  }
  return [...counts].map(([reason, n]) => ({ reason, n })).toSorted((a, b) => b.n - a.n)
}

export interface CauseRow {
  cause: IuCause
  label: string
  usd: number
  requests: number
  /** Claude work on the IU key with a cost: the row takes the warn ink. */
  warn: boolean
}

/** IU spend over the range per cause, every cause present (zero when none), in the spec's order. */
export function iuByCause(iu: RouterResponse['iu']): CauseRow[] {
  return IU_CAUSE_ORDER.map((cause) => {
    const rows = iu.filter((r) => r.cause === cause)
    const usd = sum(rows.map((r) => r.usd))
    return {
      cause,
      label: IU_CAUSE_LABEL[cause],
      usd,
      requests: sum(rows.map((r) => r.requests)),
      warn: CLAUDE_ON_IU_CAUSES.includes(cause) && usd > 0,
    }
  })
}

export interface RouterTotals {
  picks: number
  refused: number
  iuUsd: number
}

/** The router node's figures: the card and its detail both read these. */
export function routerTotals(router: RouterResponse): RouterTotals {
  return {
    picks: totalPicks(router.picks),
    refused: sum(router.picks.filter((p) => p.target === 'refused').map((p) => p.n)),
    iuUsd: sum(router.iu.map((r) => r.usd)),
  }
}

/** Why a router figure is unverified or unmeasured, if it is. */
export function routerNotes(router: RouterResponse): string[] {
  const notes: string[] = []
  if (!router.picksAvailable) {
    notes.push('The picks table is not readable: the IU causes are unverified.')
  }
  if (!router.routeFallbackMeasured) {
    notes.push('Route fallback is not measured yet: agw does not mark it, so it reads as zero.')
  }
  return notes
}

export interface CacheRow {
  key: string
  caller: string
  target: string
  requests: number
  hitRate: number | null
}

/** Cache hit per caller and target, ranked by requests. */
export function cacheRows(cache: RouterResponse['cache']): CacheRow[] {
  return cache
    .map((c) => ({ key: `${c.caller}|${c.target}`, ...c }))
    .toSorted((a, b) => b.requests - a.requests)
}

/** The first caller with real volume and almost no cache read, named in a note under the list. */
export function coldCaller(rows: readonly CacheRow[]): CacheRow | null {
  return rows.find((r) => r.requests >= 100 && r.hitRate !== null && r.hitRate < 0.05) ?? null
}

export const targetLabel = (target: string): string =>
  target === 'iu-api' ? 'IU' : target === 'refused' ? 'refused' : target

// ── Demand ───────────────────────────────────────────────────────────────────────────────────

/** The payers of the API credit: the "agw on credit" card and its workflow detail read these. */
export const CREDIT_PAYERS: PayerValue[] = USAGE_ACCOUNTS.map((a) => a.creditPayer)
/** The Claude subscriptions: the lanes' list value. */
export const SUB_PAYERS: PayerValue[] = USAGE_ACCOUNTS.map((a) => a.payer)

export interface DemandTotals {
  usd: number
  evalUsd: number
  /** Everything that is not an eval: the production rate's numerator. */
  productionUsd: number
}

export function demandTotals(demand: DemandResponse): DemandTotals {
  const evalUsd = sum(demand.rows.map((r) => r.byPurpose.eval))
  return {
    usd: demand.totals.usd,
    evalUsd,
    productionUsd: Math.max(0, demand.totals.usd - evalUsd),
  }
}

/** The workflow row of a key, for the card's figure and the detail's header to share. */
export const workflowRow = (demand: DemandResponse, workflow: string): DemandRow | undefined =>
  demand.rows.find((r) => r.key === workflow)

/** The cost per run of a row, null without a run. */
export const costPerRun = (row: DemandRow): number | null =>
  row.runs > 0 ? row.usd / row.runs : null

/** Cache-read tokens as a share of every token the row processed. */
export function cacheShare(row: DemandRow): number | null {
  const processed = row.freshTokens + row.cacheReadTokens
  return processed > 0 ? row.cacheReadTokens / processed : null
}

export const UNSET_KEYS = ['(unset)', '(unknown)', '(unknown model)', '(other)']

/** A lane key as a name: `wave_mother` reads `wave mother`. */
export const laneLabel = (key: string): string => key.replaceAll('_', ' ')

export interface LaneRow {
  key: string
  label: string
  listUsd: number
}

/** The Claude Code lanes with list value on the subscriptions, most first; lanes with none are dropped. */
export function laneRows(split: LaneSplitResponse): LaneRow[] {
  return split.rows
    .filter((r) => r.cost > 0)
    .map((r) => ({ key: r.key, label: laneLabel(r.key), listUsd: r.cost }))
    .toSorted((a, b) => b.listUsd - a.listUsd)
}

/** Whether `/usage/demand?by=origin` can say who asked: it cannot while every row is unset. */
export function originKnown(demand: DemandResponse): boolean {
  return demand.rows.some((r) => !UNSET_KEYS.includes(r.key))
}

/** The purposes a gateway row is bucketed into: the keys of `DemandRow.byPurpose`, so a bar over them sums to the row. */
export const PURPOSES = ['prod', 'verify', 'eval', 'other'] as const
export type Purpose = (typeof PURPOSES)[number]

/** The share of a row's cost by purpose, for a stacked segment bar. */
export function purposeSegments(row: DemandRow): { key: Purpose; usd: number }[] {
  return PURPOSES.map((key) => ({ key, usd: row.byPurpose[key] })).filter((s) => s.usd > 0)
}

// ── Per-day series for the router detail ─────────────────────────────────────────────────────

export interface DayCounts {
  day: string
  values: Record<string, number>
}

/** One row per UTC day with a value per key, days ascending; a missing key reads zero at the chart. */
function perDay<T extends { day: string }>(
  rows: readonly T[],
  key: (r: T) => string,
  value: (r: T) => number,
): DayCounts[] {
  const days = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const values = days.get(r.day) ?? {}
    values[key(r)] = (values[key(r)] ?? 0) + value(r)
    days.set(r.day, values)
  }
  return [...days]
    .map(([day, values]) => ({ day, values }))
    .toSorted((a, b) => a.day.localeCompare(b.day))
}

export const picksPerDay = (picks: RouterResponse['picks']): DayCounts[] =>
  perDay(
    picks,
    (r) => r.target,
    (r) => r.n,
  )

export const iuPerDay = (iu: RouterResponse['iu']): DayCounts[] =>
  perDay(
    iu,
    (r) => r.cause,
    (r) => r.usd,
  )

// ── Athena ───────────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000

/**
 * agw's own rows on the Athena team key from an hourly cost timeseries of that key by source: what they
 * cost since `sinceMs` (the first gateway row, `pace.cutover`; the hour that holds it counts) and the hour
 * of the last one. The timeseries zero-fills empty hours, so a bucket is an agw row when its cost is above
 * zero or null (a row of unknown cost); a zero is no row. A key agw has left reads `$0` and the hour it
 * stopped; `lastRowAt` is null when no agw row is in the series at all.
 */
export function agwOnKey(
  buckets: ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>,
  sinceMs: number,
): { sinceUsd: number; lastRowAt: string | null } {
  let sinceUsd = 0
  let lastRowAt: string | null = null
  for (const b of buckets) {
    const agw = Object.entries(b.groups).filter(([source]) => source.includes('agent-workflows'))
    if (!agw.some(([, v]) => v === null || v > 0)) continue
    lastRowAt = b.bucket
    if (new Date(b.bucket).getTime() + HOUR_MS > sinceMs) {
      sinceUsd += agw.reduce((acc, [, v]) => acc + (v ?? 0), 0)
    }
  }
  return { sinceUsd, lastRowAt }
}

/** An agw row on the team key newer than this still counts as agw billing it; older is a key agw has left. */
export const AGW_STALE_MS = 6 * HOUR_MS

/**
 * How the Athena card reads agw: `bills` (warn ink, "still bills this key") only while an agw row is newer
 * than 6 h; `quiet` (neutral, the $ since the cutover as a quiet figure) for a key agw has left, rows before
 * the cutover included; `none` when there is no agw row at all.
 */
export function agwReading(
  lastRowAt: string | null,
  now: number,
): { state: 'bills' | 'quiet' | 'none' } {
  if (lastRowAt === null) return { state: 'none' }
  return { state: now - new Date(lastRowAt).getTime() < AGW_STALE_MS ? 'bills' : 'quiet' }
}

// ── Insights ─────────────────────────────────────────────────────────────────────────────────

/** The periods `/usage/insights` reads; the page Range maps onto the nearest one it offers. */
export const insightsPeriodOf = (range: '7d' | '30d' | '90d' | 'all'): '7d' | '30d' =>
  range === '7d' ? '7d' : '30d'

/** The sources `/usage/insights` names as unreadable, in words. */
export function sourceLabel(source: string): string {
  if (source === 'pace') return 'the credit pace'
  if (source === 'router') return 'the router'
  if (source === 'demand') return 'demand'
  if (source.startsWith('iu-budget:')) {
    const key = source.slice('iu-budget:'.length)
    return key === 'personal' ? 'the IU personal key' : `the ${key} key`
  }
  return source
}

export interface InsightsView {
  /** The ranked items, at most five, best first. */
  items: InsightsResponse['items']
  /** What the strip says when it has no item to show: nothing stands out, or which sources were not read. */
  note: string | null
}

/**
 * The strip's content. Empty means "nothing stands out" only when every source was read; a non-empty
 * `unavailable` names what could not be, instead, whether or not some detectors still fired.
 */
export function insightsView(data: InsightsResponse): InsightsView {
  const items = data.items.toSorted((a, b) => a.rank - b.rank).slice(0, 5)
  if (data.unavailable.length > 0) {
    return { items, note: `Could not read ${data.unavailable.map(sourceLabel).join(', ')}.` }
  }
  return { items, note: items.length === 0 ? 'Nothing stands out.' : null }
}
