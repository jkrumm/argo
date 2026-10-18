/**
 * Pure derivations for the body-composition page. Every figure a sentence repeats is computed here
 * once, so the summary line, the strip cells and the chart header read the same number.
 */
import { NBSP, withUnit } from '../../lib/format'
import type { SkinfoldSite } from '../../lib/queries/skinfold-log'
import { compareByDate, MEAN_DAYS, trailingMean, type SkinfoldPoint } from './charts/series-data'
import { SKINFOLD_SITES } from './constants'
import type { WeightWindowStats } from './types'

/** The API's trailing-rate lookback. */
const RATE_LOOKBACK_DAYS = 28

/** A last weigh-in this many days old (or older) reads as stale. */
const STALE_DAYS = 14

/** The rate meter spans ±this many kg/week; the neutral zone is ±RATE_NEUTRAL_KG_WK. */
export const RATE_SCALE_KG_WK = 0.5
export const RATE_NEUTRAL_KG_WK = 0.1

/** Within this many kg of the goal counts as at it. */
const GOAL_TOLERANCE_KG = 0.05

const MINUS = '−'

const dayNumber = (key: string): number =>
  Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) /
  86_400_000

/** A timestamp as the LOCAL `YYYY-MM-DD` calendar day. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Whole calendar days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round(dayNumber(toKey) - dayNumber(fromKey))
}

/** The newest `date` in a series, or `null` when it is empty. */
export function latestDate(points: readonly { date: string }[]): string | null {
  return points.reduce<string | null>((m, p) => (m === null || p.date > m ? p.date : m), null)
}

/** Days since the newest entry; `null` when there is none. Never negative. */
export function entryAgeDays(points: readonly { date: string }[], todayKey: string): number | null {
  const last = latestDate(points)
  return last === null ? null : Math.max(0, daysBetween(last, todayKey))
}

export const isStale = (ageDays: number | null): boolean =>
  ageDays !== null && ageDays >= STALE_DAYS

/** "today" / "1 day ago" / "{n} days ago". */
export function ageLabel(ageDays: number): string {
  if (ageDays === 0) return 'today'
  return ageDays === 1 ? '1 day ago' : `${ageDays} days ago`
}

/** A signed fixed-point figure with a real minus sign; `null` is `—`, never 0. */
export function signed(value: number | null, digits = 1): string {
  if (value === null) return '—'
  const fixed = Math.abs(value).toFixed(digits)
  if (Number(fixed) === 0) return fixed
  return `${value < 0 ? MINUS : '+'}${fixed}`
}

export const fixed = (value: number | null, digits = 1): string =>
  value === null ? '—' : value.toFixed(digits)

/** `80.1 kg` / `0.4 kg/wk`: the value never parts from its unit. */
export const withKg = (value: number, digits = 1, unit = 'kg'): string =>
  `${value.toFixed(digits)}\u00a0${unit}`

export type GoalProgress = {
  /** Kilograms still to go, always >= 0. */
  toGo: number
  /** Kilograms from the window's first weight to the goal. */
  span: number
  /** Kilograms moved toward the goal, clamped to [0, span]. */
  moved: number
}

/** Progress from the window's first weight to the goal; `null` when there is no span to measure. */
export function goalProgress({
  start,
  current,
  goal,
}: {
  start: number | null
  current: number | null
  goal: number | null
}): GoalProgress | null {
  if (start === null || current === null || goal === null) return null
  const span = Math.abs(start - goal)
  if (span < GOAL_TOLERANCE_KG) return null
  const direction = Math.sign(goal - start)
  const moved = Math.min(Math.max((current - start) * direction, 0), span)
  return { toGo: Math.abs(current - goal), span, moved }
}

/** Which way a weight change must go to read as progress: a verdict for the delta polarity. */
export function weightDeltaPolarity(
  current: number | null,
  goal: number | null,
): 'up-good' | 'up-bad' | 'neutral' {
  if (current === null || goal === null || Math.abs(goal - current) < GOAL_TOLERANCE_KG)
    return 'neutral'
  return goal > current ? 'up-good' : 'up-bad'
}

/** Kilograms above (+) or below (−) the mean; `null` when either side is unknown. */
export function deltaFromMean(current: number | null, mean: number | null): number | null {
  return current === null || mean === null ? null : current - mean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "3 Jun" from a `YYYY-MM-DD` key; "3 Jun 2025" when the year is not the current one. */
export function shortDay(key: string, now: Date = new Date()): string {
  const day = `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1] ?? ''}`.trim()
  return Number(key.slice(0, 4)) === now.getFullYear() ? day : `${day} ${key.slice(0, 4)}`
}

/** The direction word for a trailing rate; inside the maintenance band the weight is holding. */
function trend(kgPerWeek: number): string {
  if (Math.abs(kgPerWeek) < RATE_NEUTRAL_KG_WK) return 'holding steady'
  return kgPerWeek < 0 ? 'falling' : 'rising'
}

/**
 * Headline: direction over a stated window, then the distance to the goal. The rate figure and the
 * current weight live in their strip cells and are not repeated. The window ends at the last
 * weigh-in, so it is dated whenever that weigh-in is not today or yesterday.
 * Facts: the weigh-in count and the last weigh-in's age.
 */
export function summaryParts({
  current,
  kgPerWeek,
  rateDays,
  goal,
  ageDays,
  latestKey,
  entries,
  windowDays: windowSpan,
}: {
  current: number | null
  kgPerWeek: number | null
  /** Days the rate covers, see {@link rateDays}. */
  rateDays: number
  goal: number | null
  ageDays: number | null
  /** The newest weigh-in's day; dates the rate window when the weigh-in is not recent. */
  latestKey?: string | null
  /** Weigh-ins in the selected window; a fact the strip does not show. */
  entries: number
  /** Days the selected window spans; `null` for all time. */
  windowDays: number | null
}): { sentence: string; facts: string[] } {
  if (current === null) return { sentence: 'No weigh-ins in this window', facts: [] }
  const span =
    ageDays !== null && ageDays > 1 && latestKey != null
      ? `the ${rateDays} d to ${shortDay(latestKey)}`
      : `${rateDays} d`
  const rate = rateClause({ kgPerWeek, span })
  const sentence =
    goal === null
      ? rate
      : `${rate}, ${fixed(Math.abs(current - goal))} kg ${Math.abs(current - goal) < GOAL_TOLERANCE_KG ? 'at' : 'from'} the ${fixed(goal)} kg goal`
  return {
    sentence,
    facts: [
      entriesFact(entries, windowSpan),
      ...(ageDays === null
        ? []
        : [`last weigh-in ${ageLabel(ageDays)}${isStale(ageDays) ? ' · stale' : ''}`]),
    ],
  }
}

/** "12 weigh-ins in 30 d": the count and the window it was counted over. */
const entriesFact = (entries: number, span: number | null): string =>
  `${entries} ${entries === 1 ? 'weigh-in' : 'weigh-ins'} in ${span === null ? 'all time' : withUnit(span, 'd')}`

/** The headline's opening clause: the trend over its window, or that there is none yet. */
function rateClause({ kgPerWeek, span }: { kgPerWeek: number | null; span: string }): string {
  if (kgPerWeek === null) return 'Weight trend not available yet'
  return `Weight ${trend(kgPerWeek)} over ${span}`
}

/**
 * The weight chart header's fact, one the strip does not show: the net change across the window's
 * entries, stated with both ends of its span; a single entry shows that weight and its day. `null` with no entries.
 */
export function weightHeaderFact(
  points: readonly { date: string; weightKg: number }[],
  { now = new Date() }: { now?: Date } = {},
): { value: string; period: string } | null {
  const sorted = points.toSorted(compareByDate)
  const first = sorted[0]
  const last = sorted.at(-1)
  if (first === undefined || last === undefined) return null
  if (first === last) {
    return { value: fixed(first.weightKg), period: `single entry on ${shortDay(first.date, now)}` }
  }
  return {
    value: signed(last.weightKg - first.weightKg, 1),
    period: `net change, ${shortDay(first.date, now)} to ${shortDay(last.date, now)}`,
  }
}

/** The API's trailing rate looks back 28 d but only sees rows in the selected window. */
export function rateDays(span: number | null): number {
  return span === null ? RATE_LOOKBACK_DAYS : Math.min(RATE_LOOKBACK_DAYS, span)
}

export type WindowParams = { window?: string; from?: string; to?: string }

/** "90 days" / "all time" / "{from} to {to}" for the chart title. */
export function windowLabel(params: WindowParams): string {
  if (params.window === 'all') return 'all time'
  const days = params.window?.match(/^(\d+)d$/)?.[1]
  if (days !== undefined) return `${days} days`
  if (params.from !== undefined && params.to !== undefined) return `${params.from} to ${params.to}`
  return 'selected window'
}

export type SiteRow = {
  site: SkinfoldSite
  label: string
  current: number | null
  /** Chronological readings for the sparkline. */
  values: number[]
  /** Latest reading minus the previous session's; `null` with fewer than two readings. */
  delta: number | null
  /** The previous session's date, the period the delta is measured against. */
  priorDate: string | null
}

/** One row per caliper site: its sparkline values and the change since the previous session. */
export function siteRows(
  points: readonly SkinfoldPoint[],
  perSite: readonly { site: SkinfoldSite; current: number | null }[],
): SiteRow[] {
  const sorted = points.toSorted(compareByDate)
  return SKINFOLD_SITES.map(({ key, label }) => {
    const readings = sorted.flatMap((p) => {
      const reading = p.readings.find((r) => r.site === key)
      return reading === undefined ? [] : [{ date: p.date, valueMm: reading.valueMm }]
    })
    const values = readings.map((r) => r.valueMm)
    const last = values.at(-1)
    const prev = values.at(-2)
    return {
      site: key,
      label,
      current: perSite.find((s) => s.site === key)?.current ?? last ?? null,
      values,
      delta: last === undefined || prev === undefined ? null : last - prev,
      priorDate: readings.at(-2)?.date ?? null,
    }
  })
}

type DatedWeight = { date: string; weightKg: number }

/** Days the selected window spans; `null` for "all". A period longer than this cannot be stated. */
export function windowDays(params: WindowParams): number | null {
  if (params.window === 'all') return null
  const days = params.window?.match(/^(\d+)d$/)?.[1]
  if (days !== undefined) return Number(days)
  if (params.from !== undefined && params.to !== undefined) {
    return daysBetween(params.from, params.to) + 1
  }
  return null
}

/** Mean weight of the last `days` days up to the newest entry; `null` when not covered. */
export function meanOverDays(
  points: readonly DatedWeight[],
  days: number,
  span: number | null,
): number | null {
  const last = latestDate(points)
  return last === null ? null : trailingMean(points, last, days, span)
}

/**
 * The RATE cell footer: the pace class and its range, or why there is no rate. One window per cell, and a
 * loading or failed summary never reads as a data gap.
 */
export function rateFooter(input: {
  rate: number | null
  /** Weigh-ins in the window. */
  entries: number
  status?: 'pending' | 'error' | 'success'
}): string {
  const { rate, entries, status = 'success' } = input
  if (status === 'pending') return 'Loading the rate'
  if (status === 'error') return 'The rate failed to load'
  if (rate !== null) return paceFooter(rate)
  return entries === 0
    ? 'No weigh-ins in this window'
    : 'A rate needs two weigh-ins at least 3 days apart'
}

export type IntensityTier = {
  tier: 'maintenance' | 'lean' | 'standard' | 'aggressive'
  /** The kg/week range the tier covers, absolute; an open end is `null`. */
  lo: number | null
  hi: number | null
}

const TIER_NAME: Record<IntensityTier['tier'], string> = {
  maintenance: 'Maintenance',
  lean: 'Lean',
  standard: 'Standard',
  aggressive: 'Aggressive',
}

/**
 * The intensity tier for a rate and the kg/week range it covers, decided from the number. The
 * thresholds mirror the API's `classifyWeightPhase`; `model.test.ts` pins them to its labels.
 */
export function intensityTier(rate: number): IntensityTier {
  const abs = Math.abs(rate)
  if (abs < RATE_NEUTRAL_KG_WK) return { tier: 'maintenance', lo: null, hi: RATE_NEUTRAL_KG_WK }
  const [lean, standard]: readonly [number, number] = rate < 0 ? [0.4, 0.8] : [0.3, 0.6]
  if (abs < lean) return { tier: 'lean', lo: RATE_NEUTRAL_KG_WK, hi: lean }
  if (abs < standard) return { tier: 'standard', lo: lean, hi: standard }
  return { tier: 'aggressive', lo: standard, hi: null }
}

/**
 * `0.1–0.3 kg/wk` / `≥ 0.6 kg/wk`, built from its bounds. The unit stays on its value (NBSP) and a
 * word joiner after the dash keeps the range in one piece when it wraps.
 */
export function formatRange(lo: number | null, hi: number | null, unit: string): string {
  if (lo === null) return `< ${hi}${NBSP}${unit}`
  if (hi === null) return `\u2265${NBSP}${lo}${NBSP}${unit}`
  return `${lo}\u2013\u2060${hi}${NBSP}${unit}`
}

/**
 * The pace class in plain words: `Lean pace, gaining 0.1–0.3 kg/wk`. The meter's zone already names
 * cut/bulk/maintenance, so the footer carries the class and the range it covers instead.
 */
function paceFooter(rate: number): string {
  const { tier, lo, hi } = intensityTier(rate)
  if (tier === 'maintenance') return `Under ${RATE_NEUTRAL_KG_WK}${NBSP}kg/wk either way`
  return `${TIER_NAME[tier]} pace, ${rate < 0 ? 'losing' : 'gaining'} ${formatRange(lo, hi, 'kg/wk')}`
}

/** The day-based means and slopes the strip and the chart header both state. */
export function weightWindowStats(
  points: readonly DatedWeight[],
  span: number | null,
): WeightWindowStats {
  return {
    mean7: meanOverDays(points, MEAN_DAYS, span),
    mean30: meanOverDays(points, 30, span),
  }
}
