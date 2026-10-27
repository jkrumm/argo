/**
 * Pure derivations for the v2 usage page (docs/design/usage-tracking.md): the IU cap and subscription
 * state words, freshness, the vocabulary lines, and the aggregation of `/usage/flow` rows for
 * the IU API detail lists. No React, no queries. A missing reading is a state of its own, never headroom.
 */
import { formatDuration, withUnit } from '../../lib/format'
import type { FlowLens, FlowRow, IuBudget, QuotaLatest } from '../../lib/queries/usage'
import { USAGE_ACCOUNTS } from './accounts'
import { EM_DASH, OTHER_KEY, fmtShare, fmtUsdWhole } from './model'

// ── State words and freshness ────────────────────────────────────────────────────────────────

export type CapState = 'ok' | 'warn' | 'over'
export type PortalFreshness = 'fresh' | 'stale' | 'dead' | 'empty'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
export const FRESH_MAX_MS = 8 * HOUR_MS
export const DEAD_AFTER_MS = 48 * HOUR_MS
export const QUOTA_STALE_AFTER_MS = 30 * 60_000
const QUOTA_WINDOW_MS = 7 * DAY_MS
const WARN_AT_PCT = 80

/** The shared vocabulary: `ok` below 80 % of the limit, `warn` from 80 %, `over` strictly above 100 %. */
function stateOf(value: number, limit: number): CapState {
  if (value > limit) return 'over'
  if (value * 100 >= limit * WARN_AT_PCT) return 'warn'
  return 'ok'
}

/** The rolling 30-day IU spend against its cap. */
export const capState = (rolling: number, limit: number): CapState => stateOf(rolling, limit)

/** A weekly quota percentage (0–100) in the same words at 80 / 100. */
export const quotaState = (pct: number): CapState => stateOf(pct, 100)

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (iso === null || iso === undefined) return null
  const ts = Date.parse(iso)
  return Number.isNaN(ts) ? null : Math.max(0, now - ts)
}

/**
 * Age of the portal fetch: `fresh` up to 8 h, `stale` past it, `dead` past 48 h. No fetch (the API
 * sends `null` with zeroed figures) is `empty`: the zeros are not headroom.
 */
export function freshness(fetchedAt: string | null | undefined, now: number): PortalFreshness {
  const age = ageMs(fetchedAt, now)
  if (age === null) return 'empty'
  if (age > DEAD_AFTER_MS) return 'dead'
  if (age > FRESH_MAX_MS) return 'stale'
  return 'fresh'
}

/** `12 min`, `2 h`, `3 d`: minutes below an hour, hours below 48, days beyond. */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return EM_DASH
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return withUnit(minutes, 'min')
  const hours = Math.round(minutes / 60)
  if (hours < 48) return withUnit(hours, 'h')
  return withUnit(Math.round(hours / 24), 'd')
}

// ── Subscription meters (Q2) ─────────────────────────────────────────────────────────────────

/** The latest quota reading of one account: an entry of `GET /usage/quota-latest`. */
export type QuotaSample = Pick<
  QuotaLatest,
  'sampledAt' | 'sevenDayPct' | 'sevenDayResetsAt' | 'authOk'
>

/**
 * How far into the 7-day window `now` is (0..1), derived from the reset instant: the pace tick. A
 * reset already passed reads 1; no reset instant, no tick.
 */
export function paceFraction(
  sevenDayResetsAt: string | null | undefined,
  now: number,
): number | null {
  if (sevenDayResetsAt === null || sevenDayResetsAt === undefined) return null
  const resetsAt = Date.parse(sevenDayResetsAt)
  if (Number.isNaN(resetsAt)) return null
  const elapsed = now - (resetsAt - QUOTA_WINDOW_MS)
  return Math.min(1, Math.max(0, elapsed / QUOTA_WINDOW_MS))
}

export type QuotaReading = {
  status: 'ok' | 'stale' | 'auth-failed' | 'no-reading'
  /** What replaces or annotates the meter (`no reading`, `auth failed`, `stale 2 h`); `null` when ok. */
  note: string | null
  /** The weekly percentage to draw: `null` when there is nothing trustworthy to show. */
  pct: number | null
  state: CapState | null
  pace: number | null
  /** `resets in 2 d 4 h`, or `null` without a reset still ahead. */
  resets: string | null
}

const NO_READING: QuotaReading = {
  status: 'no-reading',
  note: 'no reading',
  pct: null,
  state: null,
  pace: null,
  resets: null,
}

/** One account's weekly reading: no sample, failed auth, a sample past 30 min, or the value. */
export function quotaReading(sample: QuotaSample | null | undefined, now: number): QuotaReading {
  if (!sample) return NO_READING
  if (!sample.authOk) return { ...NO_READING, status: 'auth-failed', note: 'auth failed' }
  const age = ageMs(sample.sampledAt, now)
  if (age === null || sample.sevenDayPct === null || !Number.isFinite(sample.sevenDayPct)) {
    return NO_READING
  }
  const resetsAt =
    sample.sevenDayResetsAt === null ? Number.NaN : Date.parse(sample.sevenDayResetsAt)
  const untilReset = resetsAt - now
  const isStale = age > QUOTA_STALE_AFTER_MS
  return {
    status: isStale ? 'stale' : 'ok',
    note: isStale ? `stale ${formatAge(age)}` : null,
    pct: sample.sevenDayPct,
    state: quotaState(sample.sevenDayPct),
    pace: paceFraction(sample.sevenDayResetsAt, now),
    resets: untilReset > 0 ? `resets in ${formatDuration(untilReset)}` : null,
  }
}

/** `iu 20x`: an account as the quota meters name it; an id outside the registry reads as itself. */
export function accountTitle(id: string): string {
  const account = USAGE_ACCOUNTS.find((a) => a.id === id)
  return account === undefined ? id : `${account.label} ${account.plan}`
}

// ── Money, tokens and the vocabulary lines ───────────────────────────────────────────────────

/** Whole dollars with a thousands separator; a negative amount reads `over by $66`. */
export function fmtMoney(n: number | null | undefined): string {
  if (n !== null && n !== undefined && n < 0) return `over by ${fmtUsdWhole(-n)}`
  return fmtUsdWhole(n)
}

/** `$573 / $500 (115 %)`. */
export const capLine = (rolling: number, limit: number): string =>
  `${fmtUsdWhole(rolling)} / ${fmtUsdWhole(limit)} (${fmtShare(rolling / limit)})`

/** `can spend today $12`; a negative amount reads `over by $66`. */
export const canSpendLine = (canSpendUsd: number): string =>
  canSpendUsd < 0 ? fmtMoney(canSpendUsd) : `can spend today ${fmtMoney(canSpendUsd)}`

/**
 * What a failed top-band query shows as its cause. The API's raw body (`NOT_FOUND`, a stack) is never
 * a sentence; the HTTP status, when the error carries one, is the only detail worth keeping.
 */
export function loadFailure(error: unknown, cause: string): Error {
  const status = typeof error === 'object' && error !== null ? Reflect.get(error, 'status') : null
  return new Error(typeof status === 'number' ? `${cause} (HTTP ${status})` : cause)
}

export const NO_PORTAL_DATA = 'No portal data yet'
export const PORTAL_DEAD_NOTE = 'portal session expired — run make iu-portal-login in usage-tracker'
export const NO_CACHE_DATA = 'no cache data'
export const UNKNOWN_MODEL = '(unknown model)'

export const staleNote = (fetchedAgeMs: number): string =>
  `stale · fetched ${formatAge(fetchedAgeMs)}`

export type FreshnessBadge = { text: string; tone: 'muted' | 'warn' | 'bad' }

/** The badge Q1 wears: `fresh · 2 h`, `stale · fetched 9 h` (warn), `dead · fetched 3 d` (bad); none while empty. */
export function freshnessBadge(
  fetchedAt: string | null | undefined,
  now: number,
): FreshnessBadge | null {
  const fresh = freshness(fetchedAt, now)
  if (fresh === 'empty') return null
  const age = ageMs(fetchedAt, now) ?? 0
  if (fresh === 'stale') return { text: staleNote(age), tone: 'warn' }
  if (fresh === 'dead') return { text: `dead · fetched ${formatAge(age)}`, tone: 'bad' }
  return { text: `fresh · ${formatAge(age)}`, tone: 'muted' }
}

export type BudgetReading = {
  freshness: PortalFreshness
  /** `null` while there is no portal data: the API's zeroed figures are not a state. */
  state: CapState | null
  cap: string | null
  canSpend: string | null
  /** `stale · fetched 9 h`, the dead-session note, or `null` when fresh or empty. */
  note: string | null
}

/** Q1's words for one `iu-budget` response; an empty portal yields no figure at all. */
export function budgetReading(b: IuBudget, now: number): BudgetReading {
  const fresh = freshness(b.fetchedAt, now)
  if (fresh === 'empty')
    return { freshness: fresh, state: null, cap: null, canSpend: null, note: null }
  const age = ageMs(b.fetchedAt, now) ?? 0
  const notes: Record<Exclude<PortalFreshness, 'empty'>, string | null> = {
    fresh: null,
    stale: staleNote(age),
    dead: PORTAL_DEAD_NOTE,
  }
  return {
    freshness: fresh,
    state: capState(b.rolling30Usd, b.limitUsd),
    cap: capLine(b.rolling30Usd, b.limitUsd),
    canSpend: canSpendLine(b.canSpendTodayUsd),
    note: notes[fresh],
  }
}

/** `$0.42` per million tokens; `—` without tokens, `<$0.01` for a fraction of a cent. */
export function fmtUsdPerMillion(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH
  if (n > 0 && n < 0.005) return '<$0.01'
  return `$${n.toFixed(2)}`
}

type DeltaDirection = 'up' | 'down' | 'flat'

/** Changes that round to under a dollar are flat: a glyph on `+<$1` would claim a move. */
export function deltaDirection(deltaUsd: number): DeltaDirection {
  if (!Number.isFinite(deltaUsd) || Math.abs(deltaUsd) < 0.5) return 'flat'
  return deltaUsd > 0 ? 'up' : 'down'
}

// ── Token accounting ─────────────────────────────────────────────────────────────────────────

type TokenClasses = Pick<FlowRow, 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning'>

export type TokenTrio = {
  /** What the model newly processed: input + output + cache-write + reasoning. */
  fresh: number
  cacheRead: number
  /** Fresh + cache-read: gross context handled, a tooltip total, never the headline. */
  processed: number
}

export function tokenTrio(r: TokenClasses): TokenTrio {
  const fresh = r.input + r.output + r.cacheWrite + r.reasoning
  return { fresh, cacheRead: r.cacheRead, processed: fresh + r.cacheRead }
}

/** Cache-read as a 0–1 share of everything processed; `null` without tokens. */
export function cacheReadShare(r: TokenClasses): number | null {
  const { cacheRead, processed } = tokenTrio(r)
  return processed > 0 ? cacheRead / processed : null
}

/** Dollars per million processed tokens; `null` without tokens. */
export const usdPerMillion = (costUsd: number, processedTokens: number): number | null =>
  processedTokens > 0 ? (costUsd / processedTokens) * 1e6 : null

// ── Flow aggregation (B and C) ───────────────────────────────────────────────────────────────

const PAIR_TOP_N = 12
const TOOL_TOP_N = 10
const TOOL_MIN_TOKENS = 1_000_000
/** The API folds rows past its `top` into one row named this in every field. */
const API_FOLD = 'other'

const isApiFold = (r: FlowRow) => r.source === API_FOLD && r.subTool === API_FOLD

type Sums = TokenClasses & { cost: number; calls: number }

const emptySums = (): Sums => ({
  cost: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  calls: 0,
})

function addTo(sums: Sums, r: Sums): void {
  sums.cost += r.cost
  sums.input += r.input
  sums.output += r.output
  sums.cacheRead += r.cacheRead
  sums.cacheWrite += r.cacheWrite
  sums.reasoning += r.reasoning
  sums.calls += r.calls
}

const lensValue = (s: Sums, lens: FlowLens): number =>
  lens === 'cost' ? s.cost : tokenTrio(s).processed

export type PairRow = Sums & {
  key: string
  subTool: string
  model: string
  label: string
  /** The lens figure this row is ranked and sized by. */
  value: number
  /** The figure the lens does not rank by, shown muted beside it. */
  secondary: number
  cacheReadShare: number | null
  /** How many (tool, model) pairs the row stands for: 1, or the folded count of `Other`. */
  pairs: number
}

const pairKey = (subTool: string, model: string) => `${subTool}\u0000${model}`

function toPairRow(
  base: Pick<PairRow, 'key' | 'subTool' | 'model' | 'label' | 'pairs'>,
  sums: Sums,
  lens: FlowLens,
): PairRow {
  const tokens = tokenTrio(sums).processed
  return {
    ...base,
    ...sums,
    value: lensValue(sums, lens),
    secondary: lens === 'cost' ? tokens : sums.cost,
    cacheReadShare: cacheReadShare(sums),
  }
}

export type RankedPairs = {
  /** Top pairs by the lens, then one `Other` row when anything folded. */
  rows: PairRow[]
  /** Lens total over every row, `Other` included. */
  total: number
}

/**
 * (sub_tool, model) pairs ranked by the lens: the flow rows merge across sources, a missing model
 * reads `(unknown model)`, the top `top` stay and the tail (plus the API's own fold row) sums into
 * `Other`. An empty flow ranks nothing.
 */
export function rankPairs(
  rows: readonly FlowRow[],
  lens: FlowLens,
  top: number = PAIR_TOP_N,
): RankedPairs {
  const merged = new Map<string, { subTool: string; model: string; sums: Sums }>()
  const tail = emptySums()
  let folded = 0
  for (const r of rows) {
    if (isApiFold(r)) {
      addTo(tail, r)
      folded++
      continue
    }
    const model = r.model || UNKNOWN_MODEL
    const key = pairKey(r.subTool, model)
    const entry = merged.get(key) ?? { subTool: r.subTool, model, sums: emptySums() }
    addTo(entry.sums, r)
    merged.set(key, entry)
  }
  const ranked = [...merged.entries()]
    .map(([key, e]) =>
      toPairRow(
        { key, subTool: e.subTool, model: e.model, label: `${e.subTool} · ${e.model}`, pairs: 1 },
        e.sums,
        lens,
      ),
    )
    .toSorted((a, b) => b.value - a.value || a.label.localeCompare(b.label))
  const kept = ranked.slice(0, top)
  for (const r of ranked.slice(top)) addTo(tail, r)
  folded += ranked.length - kept.length
  const other =
    folded > 0
      ? [
          toPairRow(
            {
              key: OTHER_KEY,
              subTool: OTHER_KEY,
              model: OTHER_KEY,
              label: OTHER_KEY,
              pairs: folded,
            },
            tail,
            lens,
          ),
        ]
      : []
  const result = [...kept, ...other]
  return { rows: result, total: result.reduce((sum, r) => sum + r.value, 0) }
}

export type ToolSplit = {
  subTool: string
  /** The four classes of the 100 % bar; reasoning is counted inside `output`. */
  cacheRead: number
  cacheWrite: number
  freshInput: number
  output: number
  processed: number
  cost: number
  /** `null` when the tool recorded no cache tokens at all (`no cache data`). */
  cacheReadShare: number | null
  noCacheData: boolean
  usdPerMillion: number | null
}

function toToolSplit(subTool: string, s: Sums): ToolSplit {
  const { processed } = tokenTrio(s)
  const noCacheData = s.cacheRead === 0 && s.cacheWrite === 0
  return {
    subTool,
    cacheRead: s.cacheRead,
    cacheWrite: s.cacheWrite,
    freshInput: s.input,
    output: s.output + s.reasoning,
    processed,
    cost: s.cost,
    cacheReadShare: noCacheData ? null : cacheReadShare(s),
    noCacheData,
    usdPerMillion: usdPerMillion(s.cost, processed),
  }
}

/**
 * Section C: the flow rows aggregated to `sub_tool`, ranked by processed tokens. Tools under 1 M
 * tokens, those past the top 10 and the API's own fold row sum into `Other`.
 */
export function toolSplits(
  rows: readonly FlowRow[],
  { top = TOOL_TOP_N, minTokens = TOOL_MIN_TOKENS }: { top?: number; minTokens?: number } = {},
): ToolSplit[] {
  const byTool = new Map<string, Sums>()
  const tail = emptySums()
  let hasTail = false
  for (const r of rows) {
    if (isApiFold(r)) {
      addTo(tail, r)
      hasTail = true
      continue
    }
    const sums = byTool.get(r.subTool) ?? emptySums()
    addTo(sums, r)
    byTool.set(r.subTool, sums)
  }
  const ranked = [...byTool.entries()]
    .map(([subTool, sums]) => ({ subTool, sums, processed: tokenTrio(sums).processed }))
    .toSorted((a, b) => b.processed - a.processed || a.subTool.localeCompare(b.subTool))
  const kept: ToolSplit[] = []
  for (const [index, tool] of ranked.entries()) {
    if (index < top && tool.processed >= minTokens) {
      kept.push(toToolSplit(tool.subTool, tool.sums))
      continue
    }
    addTo(tail, tool.sums)
    hasTail = true
  }
  return hasTail ? [...kept, toToolSplit(OTHER_KEY, tail)] : kept
}
