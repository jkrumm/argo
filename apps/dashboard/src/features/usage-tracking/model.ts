/**
 * Pure derivations for the Usage Tracking page: every figure the summary sentence, the strip and the
 * chart headers print. No React, no queries — a null reading is handled once (always `—`, never 0).
 */
import type { TimePoint } from './types'

export const EM_DASH = '—'
/** Minus sign (U+2212) so a signed figure aligns with `+` in tabular numerals. */
const MINUS = '−'

/** Cache hit ratio the page calls good — the tick on the ring (`>60%` in the old zone chart). */
export const CACHE_HIT_TARGET = 0.6
/** Daily error-rate bands: below 1 % ok, 1–3 % warn, above 3 % bad. Proposed, not an SLO. */
export const ERROR_WARN_FROM = 0.01
export const ERROR_BAD_ABOVE = 0.03
/** A feed with no record for this long is stale. */
export const STALE_AFTER_MIN = 30
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

function signedText(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits)
  if (Number(text) === 0) return text
  return `${value > 0 ? '+' : MINUS}${text}`
}

/** Relative change against a prior value; `null` when the prior is missing or zero. */
export function pctChange(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null
  return (current - prior) / Math.abs(prior)
}

export function deltaPctText(current: number | null, prior: number | null): string | null {
  const change = pctChange(current, prior)
  return change === null ? null : `${signedText(change * 100, 0)}%`
}

/** Seconds delta between two millisecond readings, e.g. `+0.3 s`. */
export function deltaSecondsText(current: number | null, prior: number | null): string | null {
  if (current === null || prior === null) return null
  return `${signedText((current - prior) / 1000, 1)} s`
}

/** Percentage-point delta between two ratios, e.g. `+0.2 pp`. */
export function deltaPointsText(current: number | null, prior: number | null): string | null {
  if (current === null || prior === null) return null
  return `${signedText((current - prior) * 100, 1)} pp`
}

// ── Prior-window comparisons ─────────────────────────────────────────────────────────────────

/** `undefined`: the API did not send the field; `null`: no comparable prior window exists. */
export type Prior = number | null | undefined

/**
 * The comparison line for a strip cell. An absent field and an absent window are different facts:
 * the first says the reading is unavailable, the second that there is nothing to compare against.
 */
export function priorLine(
  current: number | null | undefined,
  prior: Prior,
  delta: (current: number | null, prior: number | null) => string | null,
): string {
  if (prior === undefined) return 'prior unavailable'
  if (prior === null) return 'no comparable prior 30 d'
  const text = delta(current ?? null, prior)
  return text === null ? 'prior 30 d had no base to compare' : `${text} vs prior 30 d`
}

/** The error rate comparison, stated as the prior window's own rate. */
export function priorErrorLine(prior: Prior): string {
  if (prior === undefined) return 'prior unavailable'
  if (prior === null) return 'no comparable prior 30 d'
  return `vs ${fmtPct(prior)} prior 30 d`
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

// ── Freshness ────────────────────────────────────────────────────────────────────────────────

export function ageMinutes(iso: string | null | undefined, now: number): number | null {
  if (iso === null || iso === undefined) return null
  const ts = new Date(iso).getTime()
  return Number.isNaN(ts) ? null : Math.max(0, (now - ts) / 60_000)
}

export function isStale(iso: string | null | undefined, now: number): boolean {
  const age = ageMinutes(iso, now)
  return age !== null && age > STALE_AFTER_MIN
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

/** `$X over 30 days, $Y in the last 7 · ZB tokens · R% errors in 30 d · last event {age}`. */
export function summarySentence(s: SummaryInput): string {
  const parts = [
    `${fmtUsdWhole(s.cost30d)} over 30 days, ${fmtUsdWhole(s.cost7d)} in the last 7 days`,
    `${fmtTokens(s.tokens30d)} tokens`,
    `${fmtPct(s.errorRate30d)} errors in 30 d`,
    s.lastEvent === null ? 'no events recorded' : `last event ${s.lastEvent}`,
  ]
  return parts.join(' · ')
}

export function periodNoun(range: '7d' | '30d' | '90d' | 'all'): string {
  return range === 'all' ? 'all time' : range.replace('d', ' d')
}

export function footerLine(input: {
  records: number
  sources: number
  lastEvent: string | null
}): string {
  const parts = [
    `${input.records.toLocaleString('en-GB')} records in total`,
    `${input.sources} sources active in 30 d`,
    input.lastEvent === null ? 'no events recorded' : `last event ${input.lastEvent}`,
  ]
  return parts.join(' · ')
}
