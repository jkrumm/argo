/**
 * Pure derivations for the Usage Tracking page: every figure the summary sentence, the strip and the
 * chart headers print. No React, no queries — a null reading is handled once (always `—`, never 0).
 */
import { format as formatDate } from 'date-fns'
import { NBSP, withUnit } from '../../lib/format'
import type { CostGroupBy, TimePoint, TokensGroupBy } from './types'
import type { Daily } from './usage-visuals'

export const EM_DASH = '—'

/** `30 d` that never splits across lines. */
export const D30 = withUnit(30, 'd')
export const D7 = withUnit(7, 'd')
export const PRIOR_30D = `prior ${D30}`

/** The usage-tracker LaunchAgent's push cadence (the API route's description names it). */
const TRACKER_PUSH_EVERY = withUnit(15, 'min')
/**
 * One gap, two forms (docs/design/README.md § One form for a repeated gap): the full sentence names
 * cause and step, the short form is its leading clause, verbatim. A filter that matched nothing is a
 * different gap from "nothing ingested", so it keeps its own pair.
 */
const NO_USAGE_SHORT = 'No usage ingested'
const noUsageFull = (widen: boolean) =>
  `${NO_USAGE_SHORT} in this window — the usage-tracker pushes every ${TRACKER_PUSH_EVERY}${widen ? ', or widen the range' : ''}`
const NO_MATCH_SHORT = 'No usage matches these filters'
const noMatchFull = (widen: boolean) =>
  `${NO_MATCH_SHORT} in this window — clear a filter${widen ? ' or widen the range' : ''}`

/** Whether a billing or workspace filter is active; an empty selection is no constraint. */
export const isFiltered = (
  billing: readonly unknown[] | undefined,
  workspace: readonly unknown[] | undefined,
): boolean => (billing?.length ?? 0) > 0 || (workspace?.length ?? 0) > 0

/** The 30 d strip speaks for a chart only when the chart's range lies inside it. */
export const stripCoversRange = (range: '7d' | '30d' | '90d' | 'all'): boolean =>
  range === '7d' || range === '30d'

/**
 * The wording for a surface whose window holds no usage. A filtered window always keeps the match
 * pair: the filter may be the cause (the strip ignores filters). `stripEmpty` (the 30 d strip is
 * empty AND covers this range, see `stripCoversRange`) collapses only the unfiltered pair to the
 * short form. Otherwise the leading chart carries the full sentence, the rest the short form; a
 * range of `all` has nothing wider, so its sentence carries no "widen the range".
 */
export function noUsageWindow(o: {
  filtered: boolean
  stripEmpty: boolean
  leading: boolean
  range: '7d' | '30d' | '90d' | 'all'
}): string {
  const widen = o.range !== 'all'
  if (o.filtered) return o.leading ? noMatchFull(widen) : NO_MATCH_SHORT
  if (o.stripEmpty) return NO_USAGE_SHORT
  return o.leading ? noUsageFull(widen) : NO_USAGE_SHORT
}
/** The health card is one empty state only when the window has no calls and no latency line to show: a real line is never hidden. */
export const noHealthReading = (hasCalls: boolean, p95Points: number): boolean =>
  !hasCalls && p95Points === 0
/** The strip's cells carry the short form; the billing footer beneath them is the screen's leading surface (cause and step). */
export const NO_USAGE_CELL = NO_USAGE_SHORT
export const NO_USAGE_STRIP = `${NO_USAGE_SHORT} in the last ${D30} — the usage-tracker pushes every ${TRACKER_PUSH_EVERY}; check it is running`

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

/** A 0–1 share as a whole percentage, glued (`62 %`); a non-zero share under 1 % reads `<1 %`. */
export function fmtShare(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return EM_DASH
  if (ratio > 0 && ratio < 0.005) return withUnit('<1', '%')
  return withUnit(Math.round(ratio * 100), '%')
}

export type Quantity = { value: string; unit: string }

const TOKEN_UNITS = [
  { unit: 'B', size: 1e9 },
  { unit: 'M', size: 1e6 },
  { unit: 'k', size: 1e3 },
  { unit: '', size: 1 },
] as const

/** The figure a unit prints, rounded the way it prints (whole tokens, else one decimal). */
const roundedIn = (abs: number, index: number): number => {
  const { unit, size } = TOKEN_UNITS[index] ?? TOKEN_UNITS[TOKEN_UNITS.length - 1]!
  return Number((abs / size).toFixed(unit === '' ? 0 : 1))
}

/**
 * Roll up while the ROUNDED figure would print as 1000 of its unit: 999.96 M is `1.0 B`, 999.5 is
 * `1.0 k`, never `1000.0 M` / `1000`.
 */
function rollUp(abs: number, from: number): number {
  let index = from
  while (index > 0 && roundedIn(abs, index) >= 1000) index--
  return index
}

/** The one unit ladder: the largest unit the value reaches, judged on the rounded figure. */
function tokenUnitIndex(abs: number): number {
  const reached = TOKEN_UNITS.findIndex((u) => abs >= u.size)
  return rollUp(abs, reached === -1 ? TOKEN_UNITS.length - 1 : reached)
}

/** Token count as a number plus the unit that scales it (`B`, `M`, `k`, or none). */
export function tokensQuantity(n: number | null | undefined): Quantity {
  if (n === null || n === undefined || !Number.isFinite(n)) return { value: EM_DASH, unit: '' }
  const step = TOKEN_UNITS[tokenUnitIndex(Math.abs(n))]!
  return { value: (n / step.size).toFixed(step.unit === '' ? 0 : 1), unit: step.unit }
}

/** Whole tokens, never a false zero: a fraction of a token reads `<1`. */
function wholeText(n: number): string {
  if (n === 0) return '0'
  if (Math.round(n) !== 0) return n.toFixed(0)
  return n > 0 ? '<1' : '>-1'
}

/** A figure in a fixed unit: one decimal from 1 up, two decimals below (one rule per column), never a false zero. */
function scaledText(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs < 0.01) return v > 0 ? '<0.01' : '>-0.01'
  // Decimal-safe: `toFixed` misrounds binary ties (0.95 → `0.9`), so round the tenth by hand.
  const tenth = (Math.sign(v) * Math.round(abs * 10)) / 10
  return Math.abs(tenth) >= 1 ? tenth.toFixed(1) : v.toFixed(2)
}

/**
 * A token formatter fixed to the magnitude of `reference` (a surface's largest value), so every
 * number on one tooltip, axis or list reads in the same unit and can be compared by eye. A value
 * that would round to 1000 of that unit rolls up to the next one instead.
 */
export function tokensFormatterFor(reference: number): (n: number) => string {
  const start = tokenUnitIndex(Math.abs(reference))
  return (n) => {
    if (!Number.isFinite(n)) return EM_DASH
    const step = TOKEN_UNITS[rollUp(Math.abs(n), start)]!
    if (step.unit === '') return wholeText(n)
    return `${scaledText(n / step.size)}${NBSP}${step.unit}`
  }
}

/** The tallest stacked bucket of a series: the reference a chart's unit is chosen from. */
export function peakBucketTotal(points: readonly TimePoint[]): number {
  return points.reduce((peak, p) => {
    const total = Object.values(p.groups).reduce<number>((sum, v) => sum + (v ?? 0), 0)
    return Math.max(peak, total)
  }, 0)
}

export function fmtTokens(n: number | null | undefined): string {
  const q = tokensQuantity(n)
  return q.unit === '' ? q.value : `${q.value}${NBSP}${q.unit}`
}

/** A 0–1 ratio as a percentage with `digits` decimals, glued (`87.2 %`). */
export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return EM_DASH
  return withUnit((ratio * 100).toFixed(digits), '%')
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
export const fmtPctBadge = (v: number) => withUnit(Math.abs(v).toFixed(1), '%')
export const fmtPointsBadge = (v: number) => withUnit(Math.abs(v).toFixed(1), 'pp')
export const fmtSecondsBadge = (v: number) => withUnit(Math.abs(v).toFixed(1), 's')

/** Sparkline readouts, each with its unit. */
export const fmtTokensDay = (v: number) => `${fmtTokens(v)} tokens`
export const fmtSeconds = (ms: number) => {
  const q = secondsQuantity(ms)
  return q.unit === '' ? q.value : `${q.value}${NBSP}${q.unit}`
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
    : { value, note: `was ${fmtPct(prior)}` }
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

/** Whether the bucket starting on `date` (a day, or `span` ms) has ended at `now`. The one closed-bucket rule. */
const isClosedDay = (date: Date, now: number, span: number = DAY_MS): boolean =>
  bucketStartMs(date) + span <= now

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
  const complete = points.filter((p) => isClosedDay(p.date, now, span))
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

const compareKeys = (a: string, b: string): number => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
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
  // Ties break on the key by code unit (a total order, whatever the locale), so rank and the
  // hue it assigns are the same on every load.
  const ranked = [...groupKeys].toSorted(
    (a, b) => (sums.get(b) ?? 0) - (sums.get(a) ?? 0) || compareKeys(a, b),
  )
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

/** The ok state's name, as the health legend and the errors band both print it. */
export const ERROR_OK_LABEL = `Under ${fmtPct(ERROR_WARN_FROM, 0)} of calls`

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
  calls30d: number | null
  /** Pre-formatted age from `relativeTime`, or `null` when the feed has no record. */
  lastEvent: string | null
}

/** `{n} calls in the last 30 d` — the strip's window, with the one figure its cells never print (the spend is the Cost cell's). */
export function summarySentence(s: Pick<SummaryInput, 'calls30d'>): string {
  const n = s.calls30d === null ? EM_DASH : s.calls30d.toLocaleString('en-US')
  return `${n} calls in the last ${D30}`
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

/** Window days: days that began inside the rolling window, 30 d unless `spanDays` says otherwise (the partial leading day is left out; the running day is `useDaily`'s to drop). */
export const windowDays = <T extends { date: Date }>(
  days: readonly T[],
  now: number,
  spanDays = 30,
): T[] => days.filter((d) => bucketStartMs(d.date) >= now - spanDays * DAY_MS)

/** Full days: the window days that are closed (today, still running, is left out too). */
export const fullDays = <T extends { date: Date }>(days: readonly T[], now: number): T[] =>
  windowDays(days, now).filter((d) => isClosedDay(d.date, now))

const fullDayValues = (days: readonly Daily[], now: number): (number | null)[] =>
  fullDays(days, now).map((d) => d.value)

/**
 * `{n} of {m} full days slower than the 30 d p95`, or `null` without a window p95 or any full day.
 * Full days are closed days that began inside the window, so `{m}` leaves out today and the partial leading day.
 */
export function slowerDaysLine(
  days: readonly Daily[],
  windowP95: number | null,
  now: number,
): string | null {
  if (windowP95 === null) return null
  const slower = countAgainst(fullDayValues(days, now), windowP95, 'above')
  return slower.of === 0
    ? null
    : `${slower.count} of ${slower.of} full days slower than the ${D30} p95`
}

/** `{n} of {m} full days under it` (the target), or `null` without a full day; full days are closed days that began inside the window. */
export function cacheUnderLine(days: readonly Daily[], now: number): string | null {
  const under = countAgainst(fullDayValues(days, now), CACHE_HIT_TARGET, 'below')
  return under.of === 0 ? null : `${under.count} of ${under.of} full days under it`
}

/**
 * Whether a card prints its window's total. The strip owns the unfiltered 30 d figures (the
 * headline's call count is not repeated), so those are not printed again; any filter, the 7 d
 * window and the 90 d / all-time windows have no other home and print it.
 */
export function printTotal(input: {
  range: '7d' | '30d' | '90d' | 'all'
  filtered: boolean
}): boolean {
  if (input.filtered) return true
  return input.range !== '30d'
}

/**
 * The total a card's footer prints. The strip's headline figure when the card does not print its own
 * total (`printTotal` false), so both round one sum; otherwise, or while the headline is unloaded or
 * the card has no rows (nothing to compare against), the breakdown's own total.
 */
export function footerTotal(input: {
  printTotal: boolean
  headlineCostUsd30d: number | undefined
  breakdownTotal: number
  rowsShown: number
}): number {
  if (input.printTotal || input.headlineCostUsd30d === undefined || input.rowsShown === 0) {
    return input.breakdownTotal
  }
  return input.headlineCostUsd30d
}
