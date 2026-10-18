/**
 * Pure derivations for the Usage Tracking page: every figure the summary sentence, the strip and the
 * chart headers print. No React, no queries — a null reading is handled once (always `—`, never 0).
 */
import { format as formatDate } from 'date-fns'
import { NBSP, withUnit } from '../../lib/format'
import type { CostGroupBy, TimePoint, TokensGroupBy } from './types'

export const EM_DASH = '—'

/** `30 d` that never splits across lines. */
export const D30 = withUnit(30, 'd')
export const D7 = withUnit(7, 'd')
export const PRIOR_30D = `prior ${D30}`

/** Cache hit ratio the page calls good — the tick on the ring (`>60%` in the old zone chart). */
export const CACHE_HIT_TARGET = 0.6
/** Daily error-rate bands: below 1 % ok, 1–3 % warn, above 3 % bad. Proposed, not an SLO. */
export const ERROR_WARN_FROM = 0.01
export const ERROR_BAD_ABOVE = 0.03
/** A feed with no event for this many minutes is stale; past `STALE_IN_HOURS_FROM_MIN` it reads in hours and turns bad. */
const STALE_AFTER_MIN = 30
const STALE_IN_HOURS_FROM_MIN = 120
/** Series kept in a stacked chart before the rest fold into "Other". */
const FOLD_TOP_N = 6
/** The fold widens past `FOLD_TOP_N` up to this many named series while `Other` outweighs the smallest one; the rank palette has at least this many hues. */
export const FOLD_MAX_N = 8
export const ERROR_FOLD_TOP_N = 3
export const OTHER_KEY = 'Other'

const usdFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

/** Whole dollars with a thousands separator, never compacted; sub-dollar totals read `<$1`. */
export function fmtUsdWhole(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH
  if (n <= 0) return '$0'
  if (n < 0.5) return '<$1'
  return `$${usdFormat.format(Math.round(n))}`
}

/** A 0–1 share as a whole percentage; a non-zero share under 1 % reads `<1%`. */
export function fmtShare(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return EM_DASH
  if (ratio > 0 && ratio < 0.005) return '<1%'
  return `${Math.round(ratio * 100)}%`
}

export type Quantity = { value: string; unit: string }

/** Token count as a number plus the unit that scales it (`B`, `M`, `k`, or none). */
export function tokensQuantity(n: number | null | undefined): Quantity {
  if (n === null || n === undefined || !Number.isFinite(n)) return { value: EM_DASH, unit: '' }
  const abs = Math.abs(n)
  if (abs >= 1e9) return { value: (n / 1e9).toFixed(1), unit: 'B' }
  if (abs >= 1e6) return { value: (n / 1e6).toFixed(1), unit: 'M' }
  if (abs >= 1e3) return { value: (n / 1e3).toFixed(1), unit: 'k' }
  return { value: n.toFixed(0), unit: '' }
}

export function fmtTokens(n: number | null | undefined): string {
  const q = tokensQuantity(n)
  return q.unit === '' ? q.value : `${q.value}${NBSP}${q.unit}`
}

/** A 0–1 ratio as a percentage with `digits` decimals. */
export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return EM_DASH
  return `${(ratio * 100).toFixed(digits)}%`
}

/** Latency in seconds with one decimal, as a value + unit pair. */
export function secondsQuantity(ms: number | null | undefined): Quantity {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return { value: EM_DASH, unit: '' }
  return { value: (ms / 1000).toFixed(1), unit: 's' }
}

/** Relative change against a prior value; `null` when the prior is missing or zero. */
export function pctChange(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null
  return (current - prior) / Math.abs(prior)
}

/** The one guarded difference: `null` unless both readings are finite, else `(current - prior) * scale`. */
function difference(current: number | null, prior: number | null, scale: number): number | null {
  if (current === null || prior === null) return null
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null
  return (current - prior) * scale
}

/** Signed percent change (`12` = +12 %) for a `DeltaBadge`; `null` without a base. */
export function pctDelta(current: number | null, prior: number | null): number | null {
  const change = pctChange(current, prior)
  return change === null ? null : change * 100
}

/** Signed seconds between two millisecond readings. */
export const secondsDelta = (current: number | null, prior: number | null) =>
  difference(current, prior, 1 / 1000)

/** Signed percentage points between two 0–1 ratios. */
export const pointsDelta = (current: number | null, prior: number | null) =>
  difference(current, prior, 100)

// ── Badge and readout formatters ─────────────────────────────────────────────────────────────

/** Badge magnitudes: the glyph carries the sign, so these print the absolute value. */
export const fmtPctBadge = (v: number) => `${Math.abs(v).toFixed(1)}%`
export const fmtPointsBadge = (v: number) => `${Math.abs(v).toFixed(1)} pp`
export const fmtSecondsBadge = (v: number) => `${Math.abs(v).toFixed(1)} s`

/** Sparkline readouts, each with its unit. */
export const fmtUsdDay = (v: number) => `$${v.toFixed(2)}`
export const fmtTokensDay = (v: number) => `${fmtTokens(v)} tokens`
export const fmtSecondsDay = (v: number) => {
  const q = secondsQuantity(v)
  return q.unit === '' ? q.value : `${q.value} ${q.unit}`
}

/** Every space unbreakable: a phrase that must never split across lines. */
const glue = (text: string): string => text.replaceAll(' ', NBSP)

/** `18 Oct`, unbreakable so a date never splits: a daily bucket's tooltip header and axis caption. */
export const shortDay = (d: Date): string => glue(formatDate(d, 'd MMM'))

// ── Prior-window comparisons ─────────────────────────────────────────────────────────────────

/** `undefined`: the API did not send the field; `null`: no comparable prior window exists. */
export type Prior = number | null | undefined

/**
 * The cell footer's note when the delta badge cannot show: an absent field and an absent window are
 * different facts, and a prior of zero has no base to compare. `null` when the badge shows.
 */
export function priorNote(
  current: number | null | undefined,
  prior: Prior,
  delta: (current: number | null, prior: number | null) => number | null,
): string | null {
  if (prior === undefined) return 'prior unavailable'
  if (prior === null) return `no comparable ${PRIOR_30D}`
  return delta(current ?? null, prior) === null ? `${PRIOR_30D} had no base to compare` : null
}

/**
 * The error-rate comparison as one result: the badge's point delta and the footer note derive from
 * the same inputs, so they cannot disagree. With a delta the note states the prior rate itself.
 */
export function errorComparison(input: {
  current: number | null | undefined
  prior: Prior
  calls: number | null | undefined
}): { value: number | null; note: string } {
  const { current, prior, calls } = input
  if (prior === undefined) return { value: null, note: 'prior unavailable' }
  if (prior === null) return { value: null, note: `no comparable ${PRIOR_30D}` }
  if (calls === 0) return { value: null, note: 'no calls to rate' }
  const value = pointsDelta(current ?? null, prior)
  return value === null
    ? { value, note: `${PRIOR_30D} had no base to compare` }
    : { value, note: `vs ${fmtPct(prior)} ${PRIOR_30D}` }
}

/** The 30 d error rate, or `—` when the window had no calls (the API reports 0 there, not a rate). */
export function errorRateReading(
  rate: number | null | undefined,
  calls: number | null | undefined,
): string {
  if (calls === 0) return EM_DASH
  return fmtPct(rate)
}

export function meanOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v))
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
}

const DAY_MS = 86_400_000

/** Epoch ms of the UTC midnight a bucket date names (`dayToDate` keeps the bucket's year-month-day as local fields). */
const bucketStartMs = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * A chart's complete buckets: a day or week bucket still running at `now` would draw as a drop
 * against full ones. Buckets are UTC calendar days (a week bucket starts on its date), so they are
 * measured against the UTC clock, whatever the browser's offset. With fewer than two complete
 * buckets (a 7 d window at week grain) dropping the running one would leave nothing to draw, so
 * all of them stay. Whether a figure includes the running bucket is the call site's choice.
 */
export function dropPartialBucket<T extends { date: Date }>(
  points: readonly T[],
  now: number,
  grain: 'day' | 'week',
): T[] {
  const span = (grain === 'day' ? 1 : 7) * DAY_MS
  const complete = points.filter((p) => bucketStartMs(p.date) + span <= now)
  return complete.length < 2 ? [...points] : complete
}

/** How many of the readings are strictly above (`above`) or strictly below (`below`) a line; gaps do not count. */
export function countAgainst(
  values: readonly (number | null)[],
  line: number,
  side: 'above' | 'below',
): { count: number; of: number } {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v))
  const count = present.filter((v) => (side === 'above' ? v > line : v < line)).length
  return { count, of: present.length }
}

/**
 * The mean of the last `n` daily readings: the cache cell's recent figure, because the headline
 * carries no prior-30 d cache ratio. Slots are calendar days, so a trailing gap (`null`) shortens the
 * window rather than reaching further back. Compare it with the printed 30 d ratio via `pointsDelta`.
 */
export function recentMean(values: readonly (number | null)[], n = 7): number | null {
  return meanOf(values.slice(-n))
}

// ── Billing split ────────────────────────────────────────────────────────────────────────────

export type BillingCosts = { max: number; iu: number; openrouter: number; total: number }

export type BillingPart = {
  key: 'max' | 'iu' | 'other'
  label: string
  value: number
  share: number
}

/** Max / IU / Other (OpenRouter plus any untagged cost), parts that sum to the 30 d total. */
export function billingParts(c: BillingCosts): BillingPart[] {
  const other = Math.max(0, c.total - c.max - c.iu)
  const share = (v: number) => (c.total > 0 ? v / c.total : 0)
  return [
    { key: 'max', label: 'Max', value: c.max, share: share(c.max) },
    { key: 'iu', label: 'IU', value: c.iu, share: share(c.iu) },
    { key: 'other', label: 'Other', value: other, share: share(other) },
  ]
}

// ── Series fold ──────────────────────────────────────────────────────────────────────────────

export type FoldedSeries = {
  /** Kept keys in rank order, then `Other` when anything folded. */
  keys: string[]
  points: TimePoint[]
  /** Total per kept key (and `Other`) over the window, rank order. */
  totals: { key: string; value: number }[]
  total: number
  /** How many series folded into Other. */
  folded: number
}

/**
 * Keep the top group keys by their total over the whole window and sum the rest into `Other`. At
 * least `n` are kept; up to `max` while `Other` would outweigh the smallest kept series. The kept
 * set is chosen once and held for every bucket, so series identity is stable over time and matches
 * the adjacent list. `Other` is only added when something folded.
 */
export function foldTopN(
  points: readonly TimePoint[],
  groupKeys: readonly string[],
  n: number,
  max: number = n,
): FoldedSeries {
  const sums = new Map<string, number>()
  for (const key of groupKeys) sums.set(key, 0)
  for (const p of points) {
    for (const key of groupKeys) sums.set(key, (sums.get(key) ?? 0) + (p.groups[key] ?? 0))
  }
  const ranked = [...groupKeys].toSorted((a, b) => (sums.get(b) ?? 0) - (sums.get(a) ?? 0))
  const sumOf = (keys: readonly string[]) =>
    keys.reduce((acc, key) => acc + (sums.get(key) ?? 0), 0)
  // `Other` must never be the largest bucket: widen the named set (up to `max`) while the remainder
  // outweighs the smallest named series.
  let keep = n
  while (keep < Math.min(max, ranked.length)) {
    const smallestKept = sums.get(ranked[keep - 1] ?? '') ?? 0
    const remainder = sumOf(ranked.slice(keep))
    if (remainder <= smallestKept) break
    keep++
  }
  const kept = ranked.slice(0, keep)
  const rest = ranked.slice(keep)
  const keys = rest.length > 0 ? [...kept, OTHER_KEY] : kept
  const folded = points.map((p): TimePoint => {
    const groups: Record<string, number | null> = {}
    for (const key of kept) groups[key] = p.groups[key] ?? 0
    if (rest.length > 0) {
      groups[OTHER_KEY] = rest.reduce((acc, key) => acc + (p.groups[key] ?? 0), 0)
    }
    return { date: p.date, groups }
  })
  const totals = kept.map((key) => ({ key, value: sums.get(key) ?? 0 }))
  if (rest.length > 0) totals.push({ key: OTHER_KEY, value: sumOf(rest) })
  return {
    keys,
    points: folded,
    totals,
    total: totals.reduce((acc, t) => acc + t.value, 0),
    folded: rest.length,
  }
}

// ── Error days ───────────────────────────────────────────────────────────────────────────────

export type ErrorDayState = 'ok' | 'warn' | 'bad' | 'none'

/** `none` for a day with no calls; `bad` strictly above 3 %, `warn` from 1 %. */
export function errorDayState(rate: number | null): ErrorDayState {
  if (rate === null || !Number.isFinite(rate)) return 'none'
  if (rate > ERROR_BAD_ABOVE) return 'bad'
  if (rate >= ERROR_WARN_FROM) return 'warn'
  return 'ok'
}

/** The error-bar series a day's bucket lands in: its verdict, or `null` for a day with no calls and no events (nothing to draw). */
export function barStateOf(day: {
  state: ErrorDayState
  count: number
}): 'ok' | 'warn' | 'bad' | null {
  if (day.state !== 'none') return day.state
  return day.count > 0 ? 'ok' : null
}

export function badDayCount(rates: readonly (number | null)[]): number {
  return rates.filter((r) => errorDayState(r) === 'bad').length
}

const days = (n: number) => (n === 1 ? 'day' : 'days')

/**
 * The error cell's second channel for warn vs bad: a word and a count, so the two never differ by
 * hue alone. Only the kinds that occurred are named; with neither, a plain fact.
 */
export function errorDaysLine(rates: readonly (number | null)[]): string {
  if (rates.every((r) => errorDayState(r) === 'none')) return 'no daily reading yet'
  const bad = badDayCount(rates)
  const warn = rates.filter((r) => errorDayState(r) === 'warn').length
  const parts = [
    warn > 0
      ? `${warn} warn ${days(warn)} (${fmtPct(ERROR_WARN_FROM, 0)}–${fmtPct(ERROR_BAD_ABOVE, 0)})`
      : null,
    bad > 0 ? `${bad} bad ${days(bad)} (> ${fmtPct(ERROR_BAD_ABOVE, 0)})` : null,
  ]
    .filter((p): p is string => p !== null)
    .map(glue)
  return parts.length === 0 ? `no day above ${fmtPct(ERROR_WARN_FROM, 0)}` : parts.join(', ')
}

/** The day with the highest reading, or `null` without a reading. */
export function peakOf<T extends { value: number | null }>(series: readonly T[]): T | null {
  let peak: T | null = null
  let max = Number.NEGATIVE_INFINITY
  for (const d of series) {
    if (d.value === null || !Number.isFinite(d.value) || d.value <= max) continue
    peak = d
    max = d.value
  }
  return peak
}

/** What the error-events label's percentage is of: `{pct} from {source}` (events, not calls). */
export function topSourceNote(source: string, value: number, total: number): string {
  return total > 0 ? `${fmtShare(value / total)} from ${source}` : source
}

/** The health card's info text: definitions, with thresholds from the same constants the bars use. */
export function healthInfo(unit: 'day' | 'week'): string {
  const warn = fmtPct(ERROR_WARN_FROM, 0)
  const bad = fmtPct(ERROR_BAD_ABOVE, 0)
  return `p95 latency: 95 % of calls finish faster than this; only calls that report a duration count. Error events: calls that ended in an error. A ${unit}'s error rate is its error events divided by its calls; a ${unit} under ${warn} is fine, ${warn}–${bad} is warn, over ${bad} is bad. The ${ERROR_FOLD_TOP_N === 3 ? 'three' : ERROR_FOLD_TOP_N} sources with the most error events are named, the rest are grouped as Other.`
}

/** The cost and tokens info tail: how many series are named and what they are called. */
export function foldInfo(noun: string): string {
  return `The largest ${noun}s in the window are named (at least ${FOLD_TOP_N}, more while the rest would outweigh the smallest), the rest are grouped as Other.`
}

// ── Tool names ───────────────────────────────────────────────────────────────────────────────

const MCP_PREFIX = 'mcp__'

/** `my_server-name` → `My server name`. */
function plainWords(raw: string): string {
  const words = raw.replace(/[_\-:/.]+/g, ' ').trim()
  return words === '' ? raw : words.charAt(0).toUpperCase() + words.slice(1)
}

/** The group a tool is counted under: every `mcp__{server}__{tool}` joins its server's one bucket. */
function toolGroupKey(raw: string): string {
  if (!raw.startsWith(MCP_PREFIX)) return raw
  const server = raw.slice(MCP_PREFIX.length).split('__')[0] ?? ''
  return server === '' ? raw : `${MCP_PREFIX}${server}`
}

/** A tool identifier in words: `mcp__agent-gateway` → `Agent gateway (MCP)`, `web_search` → `Web search`. */
function toolLabel(raw: string): string {
  if (raw === OTHER_KEY) return raw
  if (!raw.startsWith(MCP_PREFIX)) return plainWords(raw)
  const [server = '', ...tool] = raw.slice(MCP_PREFIX.length).split('__')
  const name = plainWords(server)
  return tool.length === 0 ? `${name} (MCP)` : `${name} · ${plainWords(tool.join(' '))}`
}

/**
 * Re-key a grouped series: buckets whose keys map to the same group add up. Used to fold every tool
 * of one MCP server into a single series before the top-N cut.
 */
function regroup(
  points: readonly TimePoint[],
  groupKeys: readonly string[],
  keyOf: (key: string) => string,
): { points: TimePoint[]; groupKeys: string[] } {
  const keys = [...new Set(groupKeys.map(keyOf))]
  const merged = points.map((p): TimePoint => {
    const groups: Record<string, number | null> = {}
    for (const key of keys) groups[key] = 0
    for (const key of groupKeys) {
      const target = keyOf(key)
      groups[target] = (groups[target] ?? 0) + (p.groups[key] ?? 0)
    }
    return { date: p.date, groups }
  })
  return { points: merged, groupKeys: keys }
}

// ── Freshness ────────────────────────────────────────────────────────────────────────────────

function ageMinutes(iso: string | null | undefined, now: number): number | null {
  if (iso === null || iso === undefined) return null
  const ts = new Date(iso).getTime()
  return Number.isNaN(ts) ? null : Math.max(0, (now - ts) / 60_000)
}

// ── Copy ─────────────────────────────────────────────────────────────────────────────────────

export type SummaryInput = {
  cost30d: number | null
  /** Pre-formatted age from `relativeTime`, or `null` when the feed has no record. */
  lastEvent: string | null
}

/** `{$} spent in the last 30 d` — the page's answer, the same window and figure as the strip's Cost cell. */
export function summarySentence(s: Pick<SummaryInput, 'cost30d'>): string {
  return `${fmtUsdWhole(s.cost30d)} spent in the last ${D30}`
}

/** The facts line under the sentence: active sources and the last event (the strip owns the rest). */
export function summaryFacts(
  s: Pick<SummaryInput, 'lastEvent'> & { sources: number | null },
): string[] {
  return [
    s.sources === null ? null : `${s.sources} sources active`,
    s.lastEvent === null ? 'no events recorded' : `last event ${s.lastEvent}`,
  ].filter((f): f is string => f !== null)
}

export type Freshness = { word: string; tone: 'ok' | 'warn' | 'bad' | 'none' }

/** The headline aside: `fresh`, `stale 40 min` (warn), `stale 3 h` (bad, past 2 h), or `no events`. */
export function freshness(iso: string | null | undefined, now: number): Freshness {
  const raw = ageMinutes(iso, now)
  if (raw === null) return { word: 'no events', tone: 'none' }
  const age = Math.round(raw)
  if (age <= STALE_AFTER_MIN) return { word: 'fresh', tone: 'ok' }
  if (age < STALE_IN_HOURS_FROM_MIN) return { word: `stale ${age} min`, tone: 'warn' }
  return { word: `stale ${Math.round(age / 60)} h`, tone: 'bad' }
}

const PERIOD_NOUN: Record<'7d' | '30d' | '90d' | 'all', string> = {
  '7d': withUnit(7, 'd'),
  '30d': D30,
  '90d': withUnit(90, 'd'),
  all: 'all time',
}

export function periodNoun(range: '7d' | '30d' | '90d' | 'all'): string {
  return PERIOD_NOUN[range]
}

type FoldGroupBy = CostGroupBy | TokensGroupBy

/** Per dimension: how raw keys join into series before the cut, and how a key reads. */
const GROUPING: Record<
  FoldGroupBy,
  { keyOf: (key: string) => string; labelOf: (key: string) => string }
> = {
  source: { keyOf: (key) => key, labelOf: (key) => key },
  machine: { keyOf: (key) => key, labelOf: (key) => key },
  billing: { keyOf: (key) => key, labelOf: (key) => key },
  model_norm: { keyOf: (key) => key, labelOf: (key) => key },
  project: { keyOf: (key) => key, labelOf: (key) => key },
  // Tools are counted per MCP server and read in words.
  sub_tool: { keyOf: toolGroupKey, labelOf: toolLabel },
}

/** The folded series the chart and list read, per the dimension's grouping. */
export function prepareFolded(input: {
  points: readonly TimePoint[]
  groupKeys: readonly string[]
  groupBy: FoldGroupBy
}): { folded: FoldedSeries; labelOf: (key: string) => string } {
  const { keyOf, labelOf } = GROUPING[input.groupBy]
  const source = regroup(input.points, input.groupKeys, keyOf)
  return { folded: foldTopN(source.points, source.groupKeys, FOLD_TOP_N, FOLD_MAX_N), labelOf }
}

/** `{n} of {m} days slower than the 30 d p95`, or `null` without a window p95 or any full day. */
export function slowerDaysLine(
  days: readonly (number | null)[],
  windowP95: number | null,
): string | null {
  if (windowP95 === null) return null
  const slower = countAgainst(days, windowP95, 'above')
  return slower.of === 0 ? null : `${slower.count} of ${slower.of} days slower than the ${D30} p95`
}

/** `{n} of {m} days under it` (the target), or `null` without a full day. */
export function cacheUnderLine(days: readonly (number | null)[]): string | null {
  const under = countAgainst(days, CACHE_HIT_TARGET, 'below')
  return under.of === 0 ? null : `${under.count} of ${under.of} days under it`
}

/**
 * Whether a card prints its window's total. The strip owns the unfiltered 30 d figures (the headline repeats the
 * spend), so those are not repeated; any filter, 7 d totals, and
 * 90 d / all-time windows have no other home and print it.
 */
export function printTotal(input: {
  range: '7d' | '30d' | '90d' | 'all'
  filtered: boolean
  metric: 'cost' | 'tokens'
}): boolean {
  if (input.filtered) return true
  return input.range !== '30d'
}
