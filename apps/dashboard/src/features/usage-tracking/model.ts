/**
 * Pure derivations for the Usage Tracking page: every figure the summary sentence, the strip and the
 * chart headers print. No React, no queries — a null reading is handled once (always `—`, never 0).
 */
import type { TimePoint } from './types'

export const EM_DASH = '—'

/** Cache hit ratio the page calls good — the tick on the ring (`>60%` in the old zone chart). */
export const CACHE_HIT_TARGET = 0.6
/** Daily error-rate bands: below 1 % ok, 1–3 % warn, above 3 % bad. Proposed, not an SLO. */
export const ERROR_WARN_FROM = 0.01
export const ERROR_BAD_ABOVE = 0.03
/** A feed with no event for this many minutes is stale; past `STALE_IN_HOURS_FROM_MIN` it reads in hours and turns bad. */
const STALE_AFTER_MIN = 30
const STALE_IN_HOURS_FROM_MIN = 120
/** Series kept in a stacked chart before the rest fold into "Other". */
export const FOLD_TOP_N = 6
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
  return q.unit === '' ? q.value : `${q.value}${q.unit}`
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
export const fmtTokensDay = (v: number) => {
  const q = tokensQuantity(v)
  return `${q.value}${q.unit} tokens`
}
export const fmtSecondsDay = (v: number) => {
  const q = secondsQuantity(v)
  return q.unit === '' ? q.value : `${q.value} ${q.unit}`
}

/** `18 Oct`: a daily bucket's tooltip header and axis caption. */
export const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

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
  if (prior === null) return 'no comparable prior 30 d'
  return delta(current ?? null, prior) === null ? 'prior 30 d had no base to compare' : null
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
  if (prior === null) return { value: null, note: 'no comparable prior 30 d' }
  if (calls === 0) return { value: null, note: 'no calls to rate' }
  const value = pointsDelta(current ?? null, prior)
  return value === null
    ? { value, note: 'prior 30 d had no base to compare' }
    : { value, note: `vs ${fmtPct(prior)} prior 30 d` }
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
 * Keep the top `n` group keys by their total over the whole window and sum the rest into `Other`.
 * The top `n` are chosen once and kept for every bucket, so series identity is stable over time and
 * matches the adjacent list. `Other` is only added when something folded.
 */
export function foldTopN(
  points: readonly TimePoint[],
  groupKeys: readonly string[],
  n: number,
): FoldedSeries {
  const sums = new Map<string, number>()
  for (const key of groupKeys) sums.set(key, 0)
  for (const p of points) {
    for (const key of groupKeys) sums.set(key, (sums.get(key) ?? 0) + (p.groups[key] ?? 0))
  }
  const ranked = [...groupKeys].toSorted((a, b) => (sums.get(b) ?? 0) - (sums.get(a) ?? 0))
  const kept = ranked.slice(0, n)
  const rest = ranked.slice(n)
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
  if (rest.length > 0) {
    totals.push({ key: OTHER_KEY, value: rest.reduce((acc, key) => acc + (sums.get(key) ?? 0), 0) })
  }
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
  ].filter((p): p is string => p !== null)
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
  return `The ${FOLD_TOP_N === 6 ? 'six' : FOLD_TOP_N} largest ${noun}s in the window are named, the rest are grouped as Other.`
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
  cost7d: number | null
  tokens30d: number | null
  errorRate30d: number | null
  /** Pre-formatted age from `relativeTime`, or `null` when the feed has no record. */
  lastEvent: string | null
}

/** `{$} spent in 30 days, {$} in the last 7 days` — the page's answer, always with a live number. */
export function summarySentence(s: Pick<SummaryInput, 'cost30d' | 'cost7d'>): string {
  return `${fmtUsdWhole(s.cost30d)} spent in 30 days, ${fmtUsdWhole(s.cost7d)} in the last 7 days`
}

/** The facts line under the sentence: tokens, error rate, active sources, last event. */
export function summaryFacts(
  s: Pick<SummaryInput, 'tokens30d' | 'errorRate30d' | 'lastEvent'> & { sources: number | null },
): string[] {
  return [
    `${fmtTokens(s.tokens30d)} tokens`,
    `${fmtPct(s.errorRate30d)} errors`,
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

export function periodNoun(range: '7d' | '30d' | '90d' | 'all'): string {
  return range === 'all' ? 'all time' : range.replace('d', ' d')
}
