/**
 * Strength tracker analytics — pure functions.
 *
 * All functions are pure: data is loaded by the route layer and passed in.
 * No DB calls. No external date library — plain Date arithmetic with the
 * helpers at the bottom of this file. Formula reference: `docs/STRENGTH-ANALYTICS.md`.
 */

import {
  recoveryScore,
  activityScore,
  fitnessDirection,
  STRAIN_DEBT_MIN_CEILING,
} from './garmin-formulas.js'
import {
  computeMetrics,
  estimate1RM,
  makeBodyweightResolver,
  loadBodyweightResolver,
  E1RM_MAX_REPS,
} from './formulas.js'
import { weekStart } from './week.js'

export {
  computeMetrics,
  estimate1RM,
  makeBodyweightResolver,
  loadBodyweightResolver,
  E1RM_MAX_REPS,
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type SetRow = {
  set_type: string
  weight_kg: number
  reps: number
}

export type WorkoutWithSets = {
  id: number
  date: string
  exercise_id: string
  exercise_name: string
  sets: SetRow[]
  estimated_1rm: number | null
  total_volume: number
}

export type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'
export type StrengthDirection = 'improving' | 'stable' | 'declining'
export type MetricKey =
  | 'max_weight'
  | 'estimated_1rm'
  | 'total_volume'
  | 'total_reps'
  | 'work_sets'
  | 'avg_intensity'
export type RatioStatus = 'balanced' | 'imbalanced' | 'critical'

export type BestSet = { weight_kg: number; reps: number; e1rm: number }

export type DailyMetricRow = {
  date: string
  hrv_last_night_avg: number | null
  sleep_score: number | null
  resting_hr: number | null
  steps: number | null
  moderate_intensity_min: number | null
  vigorous_intensity_min: number | null
  vo2_max: number | null
}

// ─── Date helpers (private) ──────────────────────────────────────────────────

function parseDate(yyyyMmDd: string): Date {
  // Use UTC midnight to keep arithmetic timezone-agnostic.
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(yyyyMmDd: string, n: number): string {
  const d = parseDate(yyyyMmDd)
  d.setUTCDate(d.getUTCDate() + n)
  return formatDate(d)
}

function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86_400_000)
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ─── Per-set / per-workout math (§1.1, §1.5, §1.16) ─────────────────────────

/** §1.5 — Intensity × Number Of Lifts for a single workout. */
export function sessionInol(workout: WorkoutWithSets, bw: number): number | null {
  const best1rm = workout.estimated_1rm
  if (best1rm === null || best1rm <= 0) return null
  const isPullUps = workout.exercise_id === 'pull_ups'
  let total = 0
  let count = 0
  for (const s of workout.sets) {
    if (s.set_type !== 'work' && s.set_type !== 'amrap') continue
    // Deliberately wider than E1RM_MAX_REPS: INOL measures training load, and an 11–12 rep set is
    // real work even where it's too high-rep to *estimate* a 1RM from. Not drift — see §2.3.
    if (s.reps < 1 || s.reps > 12) continue
    const ew = isPullUps ? s.weight_kg + bw : s.weight_kg
    // Cap intensity at 40..99 % to avoid blowing up the divisor near 1RM.
    const pct = clamp((ew / best1rm) * 100, 40, 99)
    total += s.reps / (100 - pct)
    count++
  }
  return count > 0 ? total : null
}

/** Best e1RM set in a session (used in §1.12 e1RM chart tooltips). */
export function bestSet(workout: WorkoutWithSets, bw: number): BestSet | null {
  if (workout.estimated_1rm === null) return null
  const isPullUps = workout.exercise_id === 'pull_ups'
  let bestE1rm: number | null = null
  let bestWeight = 0
  let bestReps = 0
  // Must select the same set `computeMetrics` scored as the session best — including its
  // heavier-set tie-break — or the tooltip names a set that doesn't match the headline number.
  for (const s of workout.sets) {
    if (s.set_type !== 'work' && s.set_type !== 'amrap') continue
    const ew = isPullUps ? s.weight_kg + bw : s.weight_kg
    const e1rm = estimate1RM(ew, s.reps)
    if (e1rm === null) continue
    if (bestE1rm === null || e1rm > bestE1rm || (e1rm === bestE1rm && ew > bestWeight)) {
      bestE1rm = e1rm
      bestWeight = ew
      bestReps = s.reps
    }
  }
  if (bestE1rm === null) return null
  return {
    weight_kg: round1(bestWeight),
    reps: bestReps,
    e1rm: round1(bestE1rm),
  }
}

/** §1.16 — generic metric extraction for PR detection + charts. */
export function extractMetric(
  workout: WorkoutWithSets,
  metric: MetricKey,
  bw: number,
): number | null {
  const isPullUps = workout.exercise_id === 'pull_ups'
  switch (metric) {
    case 'max_weight': {
      const ws = workout.sets.filter((s) => s.set_type === 'work')
      if (ws.length === 0) return null
      const heaviest = Math.max(...ws.map((s) => s.weight_kg))
      return isPullUps ? heaviest + bw : heaviest
    }
    case 'estimated_1rm':
      return workout.estimated_1rm
    case 'total_volume':
      return workout.total_volume
    case 'total_reps':
      return workout.sets.reduce((sum, s) => sum + s.reps, 0)
    case 'work_sets':
      return workout.sets.filter((s) => s.set_type === 'work').length
    case 'avg_intensity': {
      if (workout.estimated_1rm === null || workout.estimated_1rm <= 0) return null
      const ws = workout.sets.filter((s) => s.set_type === 'work')
      if (ws.length === 0) return null
      const heaviest = Math.max(...ws.map((s) => s.weight_kg))
      const ew = isPullUps ? heaviest + bw : heaviest
      return (ew / workout.estimated_1rm) * 100
    }
    default:
      return null
  }
}

// ─── Series builders — single exercise (§1.6–§1.15) ──────────────────────────

/** OLS slope. Returns null when fewer than 2 points or zero variance in x. */
function linearSlope(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null
  const n = pairs.length
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n
  const my = pairs.reduce((a, p) => a + p[1], 0) / n
  let num = 0
  let den = 0
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my)
    den += (x - mx) ** 2
  }
  if (den === 0) return null
  return num / den
}

/**
 * §1.6 — e1RM velocity as %/day from latest reference, regressed over `windowDays`.
 * `workouts` should already be filtered to a single exercise.
 */
export function velocityPctPerDay(workouts: WorkoutWithSets[], windowDays = 28): number | null {
  const filtered = workouts
    .filter((w) => w.estimated_1rm !== null)
    .toSorted((a, b) => a.date.localeCompare(b.date))
  if (filtered.length < 2) return null
  const latest = filtered[filtered.length - 1]!
  const windowStart = addDays(latest.date, -windowDays)
  const inWindow = filtered.filter((w) => w.date >= windowStart)
  if (inWindow.length < 2) return null
  const pairs: Array<[number, number]> = inWindow.map((w) => [
    diffDays(w.date, windowStart),
    w.estimated_1rm!,
  ])
  const slope = linearSlope(pairs)
  if (slope === null) return null
  return latest.estimated_1rm! > 0 ? (slope / latest.estimated_1rm!) * 100 : null
}

/**
 * §1.6 anchored at a specific date — used by composite + momentum series.
 * `workouts` should already be filtered to a single exercise.
 */
export function velocityAtDate(
  workouts: WorkoutWithSets[],
  dateStr: string,
  windowDays = 28,
): number | null {
  // One point per DATE, not per row: the slope below is a regression over (day, e1RM) pairs, so
  // two same-day sessions would sit at the identical x and silently double-weight that date.
  // (Unlike tonnage, which legitimately sums both sessions — a sum is not a fit.)
  const filtered = Array.from(
    bestWorkoutPerDate(
      workouts.filter((w) => w.estimated_1rm !== null && w.date <= dateStr),
    ).values(),
  ).toSorted((a, b) => a.date.localeCompare(b.date))
  if (filtered.length < 2) return null
  const latest = filtered[filtered.length - 1]!
  const windowStart = addDays(dateStr, -windowDays)
  const inWindow = filtered.filter((w) => w.date >= windowStart)
  if (inWindow.length < 2) return null
  const pairs: Array<[number, number]> = inWindow.map((w) => [
    diffDays(w.date, windowStart),
    w.estimated_1rm!,
  ])
  const slope = linearSlope(pairs)
  if (slope === null) return null
  return latest.estimated_1rm! > 0 ? (slope / latest.estimated_1rm!) * 100 : null
}

export function strengthDirection(velocity: number | null): StrengthDirection {
  if (velocity === null) return 'stable'
  if (velocity > 0.1) return 'improving'
  if (velocity < -0.05) return 'declining'
  return 'stable'
}

/** §1.7 — Weekly tonnage with zero-filled missing weeks. Filtered exercise input. */
export function weeklyTonnageSeries(
  workouts: WorkoutWithSets[],
): Array<{ date: string; tonnage: number }> {
  if (workouts.length === 0) return []
  const sorted = workouts.toSorted((a, b) => a.date.localeCompare(b.date))
  const byWeek = new Map<string, number>()
  for (const w of sorted) {
    const wk = weekStart(w.date)
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + w.total_volume)
  }
  const sortedKeys = Array.from(byWeek.keys()).toSorted()
  const first = sortedKeys[0]!
  const last = sortedKeys[sortedKeys.length - 1]!
  const result: Array<{ date: string; tonnage: number }> = []
  let cur = first
  while (cur <= last) {
    result.push({ date: cur, tonnage: byWeek.get(cur) ?? 0 })
    cur = addDays(cur, 7)
  }
  return result
}

/**
 * Total volume in the calendar week starting `weekStartIso` (Mon–Sun). When
 * `upTo` is given, only counts workouts on or before that date — keeps the
 * current week's running total causal as it builds.
 */
function calendarWeekVolume(
  workouts: WorkoutWithSets[],
  weekStartIso: string,
  upTo?: string,
): number {
  return workouts
    .filter((w) => weekStart(w.date) === weekStartIso && (upTo === undefined || w.date <= upTo))
    .reduce((sum, w) => sum + w.total_volume, 0)
}

/**
 * Current calendar week's volume (so far) vs. the mean of the prior 4 complete
 * calendar weeks. Anchored to Mon–Sun weeks, not a trailing 7 days.
 */
function tonnageGrowthRatio(workouts: WorkoutWithSets[], date: string): number | null {
  const thisWeekStart = weekStart(date)
  let priorSum = 0
  for (let i = 1; i <= 4; i++) {
    priorSum += calendarWeekVolume(workouts, addDays(thisWeekStart, -7 * i))
  }
  const priorAvg = priorSum / 4
  if (priorAvg <= 0) return null
  return calendarWeekVolume(workouts, thisWeekStart, date) / priorAvg
}

/** §1.8 — EWMA over a number series with N as the time constant (α = 2/(N+1)). */
function ewmaSeries(values: number[], N: number): number[] {
  if (values.length === 0) return []
  const alpha = 2 / (N + 1)
  const seedCount = Math.min(N, values.length)
  const seed = values.slice(0, seedCount).reduce((a, b) => a + b, 0) / seedCount
  const result: number[] = []
  let prev = seed
  for (const v of values) {
    const next = alpha * v + (1 - alpha) * prev
    result.push(next)
    prev = next
  }
  return result
}

export function classifyAcwrZone(acwr: number | null): AcwrZone | null {
  if (acwr === null) return null
  if (acwr < 0.8) return 'undertrained'
  if (acwr <= 1.3) return 'optimal'
  if (acwr <= 1.5) return 'caution'
  return 'danger'
}

/** §1.8 — Per-exercise ACWR via EWMA(4) / EWMA(16) of weekly tonnage. */
export function computeAcwrSeries(workouts: WorkoutWithSets[]): Array<{
  date: string
  acute: number
  chronic: number
  acwr: number | null
  zone: AcwrZone | null
}> {
  const series = weeklyTonnageSeries(workouts)
  if (series.length < 2) return []
  const tonnages = series.map((p) => p.tonnage)
  const acute = ewmaSeries(tonnages, 4)
  const chronic = ewmaSeries(tonnages, 16)
  return series.map((p, i) => {
    const a = acute[i]!
    const c = chronic[i]!
    const acwr = c > 0 ? a / c : null
    return { date: p.date, acute: a, chronic: c, acwr, zone: classifyAcwrZone(acwr) }
  })
}

/** Linear interpolation percentile over a sorted (asc) array. p in [0,100]. */
function sortedPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (idx - lo) * (sorted[hi]! - sorted[lo]!)
}

/** §1.9 — MEV/MAV/MRV from the p25/p50/p90 of last `windowDays` of weekly tonnage. */
export function volumeLandmarks(
  workouts: WorkoutWithSets[],
  windowDays = 90,
): { mev: number; mav: number; mrv: number } {
  const series = weeklyTonnageSeries(workouts)
  if (series.length === 0) return { mev: 0, mav: 0, mrv: 0 }
  // Cutoff is `windowDays` before the latest week-end in the series.
  const latest = series[series.length - 1]!.date
  const cutoff = addDays(latest, -windowDays)
  const inWindow = series.filter((p) => p.date >= cutoff && p.tonnage > 0)
  const sorted = inWindow.map((p) => p.tonnage).toSorted((a, b) => a - b)
  return {
    mev: sortedPercentile(sorted, 25),
    mav: sortedPercentile(sorted, 50),
    mrv: sortedPercentile(sorted, 90),
  }
}

/** §1.11 — Weekly volume breakdown per set type, with 4-week trailing MA. */
export function buildWeeklyVolumeSeries(
  workouts: WorkoutWithSets[],
  bwAt: (date: string) => number,
): Array<{
  date: string
  warmup: number
  work: number
  drop: number
  amrap: number
  total: number
  ma: number | null
}> {
  if (workouts.length === 0) return []
  const sorted = workouts.toSorted((a, b) => a.date.localeCompare(b.date))
  const byWeek = new Map<string, { warmup: number; work: number; drop: number; amrap: number }>()
  for (const w of sorted) {
    const isPullUps = w.exercise_id === 'pull_ups'
    const bw = bwAt(w.date)
    const wk = weekStart(w.date)
    const entry = byWeek.get(wk) ?? { warmup: 0, work: 0, drop: 0, amrap: 0 }
    for (const s of w.sets) {
      const ew = isPullUps ? s.weight_kg + bw : s.weight_kg
      const t = ew * s.reps
      if (s.set_type === 'warmup') entry.warmup += t
      else if (s.set_type === 'work') entry.work += t
      else if (s.set_type === 'drop') entry.drop += t
      else if (s.set_type === 'amrap') entry.amrap += t
    }
    byWeek.set(wk, entry)
  }

  const sortedKeys = Array.from(byWeek.keys()).toSorted()
  const first = sortedKeys[0]!
  const last = sortedKeys[sortedKeys.length - 1]!
  const raw: Array<{
    date: string
    warmup: number
    work: number
    drop: number
    amrap: number
    total: number
  }> = []
  let cur = first
  while (cur <= last) {
    const entry = byWeek.get(cur) ?? { warmup: 0, work: 0, drop: 0, amrap: 0 }
    raw.push({
      date: cur,
      warmup: round1(entry.warmup),
      work: round1(entry.work),
      drop: round1(entry.drop),
      amrap: round1(entry.amrap),
      total: round1(entry.warmup + entry.work + entry.drop + entry.amrap),
    })
    cur = addDays(cur, 7)
  }

  return raw.map((p, i) => {
    const start = Math.max(0, i - 3)
    const slice = raw.slice(start, i + 1).filter((r) => r.total > 0)
    const ma =
      slice.length >= 2 ? round1(slice.reduce((sum, r) => sum + r.total, 0) / slice.length) : null
    return { ...p, ma }
  })
}

/**
 * The `workouts` table has no unique index on (date, exercise_id) and two
 * sessions of the same lift on one calendar day are storable and do occur.
 * Fold them down to one workout per date — the best (highest e1RM) session —
 * so every date-keyed series downstream agrees on what "a day" means. Shared
 * by `buildOneRmSeries` and `buildCompositeSeries`, which both run over the
 * same workout rows.
 */
function bestWorkoutPerDate(workouts: WorkoutWithSets[]): Map<string, WorkoutWithSets> {
  const byDate = new Map<string, WorkoutWithSets>()
  for (const w of workouts) {
    const cur = byDate.get(w.date)
    if (!cur) {
      byDate.set(w.date, w)
      continue
    }
    const e = w.estimated_1rm ?? -Infinity
    const curE = cur.estimated_1rm ?? -Infinity
    // `loadWorkoutsRange` orders by date alone, so two same-date rows arrive in whatever order
    // Postgres returns them. Break an e1RM tie on `id` so the representative is the row, not the
    // query plan — the same determinism `foldWeightByDate` gets from averaging.
    if (e > curE || (e === curE && w.id > cur.id)) byDate.set(w.date, w)
  }
  return byDate
}

/**
 * §1.12 — Per-exercise e1RM series with date-based 30-day MA, INOL, max weight,
 * best set, and volume. Input must already be filtered to one exercise.
 */
export function buildOneRmSeries(
  workouts: WorkoutWithSets[],
  bwAt: (date: string) => number,
): Array<{
  date: string
  e1rm: number | null
  ma30: number | null
  volume: number
  maxWeight: number
  inol: number | null
  bestSet: BestSet | null
}> {
  if (workouts.length === 0) return []
  // Pick the best workout per date (highest e1RM).
  const byDate = bestWorkoutPerDate(workouts)
  const dates = Array.from(byDate.keys()).toSorted()

  // Date-based 30-day MA: at each date, average of e1RM values in [d-30, d].
  const ma30: (number | null)[] = dates.map((d) => {
    const cutoff = addDays(d, -30)
    const inWin: number[] = []
    for (const k of dates) {
      if (k < cutoff || k > d) continue
      const v = byDate.get(k)?.estimated_1rm
      if (v !== null && v !== undefined) inWin.push(v)
    }
    return inWin.length >= 3 ? round1(inWin.reduce((a, b) => a + b, 0) / inWin.length) : null
  })

  return dates.map((d, i) => {
    const w = byDate.get(d)!
    const bw = bwAt(d)
    const isPullUps = w.exercise_id === 'pull_ups'
    const maxWeight = w.sets.reduce((max, s) => {
      const ew = isPullUps ? s.weight_kg + bw : s.weight_kg
      return Math.max(max, ew)
    }, 0)
    const inol = sessionInol(w, bw)
    return {
      date: d,
      e1rm: w.estimated_1rm,
      ma30: ma30[i] ?? null,
      volume: round1(w.total_volume),
      maxWeight: round1(maxWeight),
      inol: inol !== null ? round1(inol) : null,
      bestSet: bestSet(w, bw),
    }
  })
}

/** §1.14 — Momentum series: e1RM + 8-entry trailing MA + per-date velocity. */
export function buildMomentumSeries(
  workouts: WorkoutWithSets[],
): Array<{ date: string; e1rm: number | null; e1rmMA: number | null; velocity: number | null }> {
  const sorted = workouts
    .filter((w) => w.estimated_1rm !== null)
    .toSorted((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return []
  return sorted.map((w, i) => {
    const start = Math.max(0, i - 7)
    const slice = sorted.slice(start, i + 1)
    const ma =
      slice.length >= 3
        ? round1(slice.reduce((s, x) => s + (x.estimated_1rm ?? 0), 0) / slice.length)
        : null
    return {
      date: w.date,
      e1rm: w.estimated_1rm,
      e1rmMA: ma,
      velocity: velocityAtDate(workouts, w.date),
    }
  })
}

export type CompositePoint = {
  date: string
  velocityRaw: number | null
  tonnageGrowthRaw: number | null
  inolRaw: number | null
  velocityZ: number | null
  tonnageGrowthZ: number | null
  inolZ: number | null
  velocityZma: number | null
  tonnageGrowthZma: number | null
  inolZma: number | null
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const m = values.reduce((a, b) => a + b, 0) / values.length
  const sq = values.reduce((a, v) => a + (v - m) ** 2, 0)
  return Math.sqrt(sq / (values.length - 1))
}

function trailingMean(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1)
    const slice = values.slice(start, i + 1).filter((v): v is number => v !== null)
    if (slice.length < Math.min(3, window)) return null
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

/**
 * §1.15 — Composite z-scored chart data over a 90-day baseline window with
 * SD floors of 0.05 (velocity), 0.02 (tonnage growth), 0.1 (INOL). 7-entry
 * trailing ZMA.
 */
export function buildCompositeSeries(
  workouts: WorkoutWithSets[],
  bwAt: (date: string) => number,
): CompositePoint[] {
  const sorted = workouts.toSorted((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return []

  // Fold to one workout per date (highest e1RM) before deriving anything — mirrors
  // buildOneRmSeries so the two series stop disagreeing about what "a day" means.
  // `sorted` (all rows, not deduped) still feeds velocity/tonnage below: those
  // aggregate by date internally, and tonnage in particular needs the real sum of
  // same-day sessions, not just the best-e1RM one.
  const byDate = bestWorkoutPerDate(sorted)
  const dedupedDates = Array.from(byDate.keys()).toSorted()

  const raw = dedupedDates.map((date) => {
    const w = byDate.get(date)!
    return {
      date,
      velocity: velocityAtDate(sorted, date),
      tonnageGrowth: tonnageGrowthRatio(sorted, date),
      inol: sessionInol(w, bwAt(date)),
    }
  })

  const lastDate = sorted[sorted.length - 1]!.date
  const cutoff = addDays(lastDate, -90)
  const window90 = raw.filter((p) => p.date >= cutoff)

  const velVals = window90.map((p) => p.velocity).filter((v): v is number => v !== null)
  const tonVals = window90.map((p) => p.tonnageGrowth).filter((v): v is number => v !== null)
  const inolVals = window90.map((p) => p.inol).filter((v): v is number => v !== null)

  const velMean = velVals.length ? velVals.reduce((a, b) => a + b, 0) / velVals.length : null
  const tonMean = tonVals.length ? tonVals.reduce((a, b) => a + b, 0) / tonVals.length : null
  const inolMean = inolVals.length ? inolVals.reduce((a, b) => a + b, 0) / inolVals.length : null

  // SD floors prevent tiny variance windows from inflating z-scores.
  const velSd = Math.max(sampleStdDev(velVals) ?? 0, 0.05)
  const tonSd = Math.max(sampleStdDev(tonVals) ?? 0, 0.02)
  const inolSd = Math.max(sampleStdDev(inolVals) ?? 0, 0.1)

  const z = (v: number | null, mean: number | null, sd: number): number | null => {
    if (v === null || mean === null) return null
    return (v - mean) / sd
  }

  const zPoints = raw.map((p) => ({
    date: p.date,
    velocityRaw: p.velocity,
    tonnageGrowthRaw: p.tonnageGrowth,
    inolRaw: p.inol,
    velocityZ: z(p.velocity, velMean, velSd),
    tonnageGrowthZ: z(p.tonnageGrowth, tonMean, tonSd),
    inolZ: z(p.inol, inolMean, inolSd),
  }))

  const velZma = trailingMean(
    zPoints.map((p) => p.velocityZ),
    7,
  )
  const tonZma = trailingMean(
    zPoints.map((p) => p.tonnageGrowthZ),
    7,
  )
  const inolZma = trailingMean(
    zPoints.map((p) => p.inolZ),
    7,
  )

  return zPoints.map((p, i) => ({
    ...p,
    velocityZma: velZma[i] ?? null,
    tonnageGrowthZma: tonZma[i] ?? null,
    inolZma: inolZma[i] ?? null,
  }))
}

/** Sparkline arrays per exercise: last 20 e1RM, last 10 weekly volume, last 15 INOL. */
export function buildSparklineRow(
  workouts: WorkoutWithSets[],
  bwAt: (date: string) => number,
): {
  e1rm: number[]
  volume: number[]
  inol: number[]
  vel: number | null
  dir: StrengthDirection
} {
  const sorted = workouts.toSorted((a, b) => a.date.localeCompare(b.date))

  const e1rmAll = sorted.map((w) => w.estimated_1rm).filter((v): v is number => v !== null)
  const e1rm = e1rmAll.slice(-20).map(round1)

  const weekly = weeklyTonnageSeries(sorted)
  const volume = weekly.slice(-10).map((p) => round1(p.tonnage))

  const inolAll = sorted
    .map((w) => sessionInol(w, bwAt(w.date)))
    .filter((v): v is number => v !== null)
  const inol = inolAll.slice(-15).map((v) => round2(v))

  const vel = velocityPctPerDay(sorted)
  return { e1rm, volume, inol, vel, dir: strengthDirection(vel) }
}

// ─── PRs & relative progression (§1.19, §2.5) ────────────────────────────────

/** §1.19 — Running-max PRs over a metric. Skip the very first session. */
export function findPRPoints(
  workoutsForExerciseSorted: WorkoutWithSets[],
  metric: MetricKey,
  bw: (date: string) => number,
): Array<{ date: string; exercise_id: string; value: number }> {
  const points: Array<{ date: string; exercise_id: string; value: number }> = []
  let runningMax = -Infinity
  for (let i = 0; i < workoutsForExerciseSorted.length; i++) {
    const w = workoutsForExerciseSorted[i]!
    const value = extractMetric(w, metric, bw(w.date))
    if (value !== null && value > runningMax) {
      runningMax = value
      if (i > 0) points.push({ date: w.date, exercise_id: w.exercise_id, value })
    }
  }
  return points
}

/** §2.5 — Per-exercise % progression from first e1RM baseline in range. */
export function buildRelativeProgressionSeries(
  workoutsByExercise: Map<string, WorkoutWithSets[]>,
  exerciseIds: string[],
): Array<{ date: string; pct: Record<string, number | null> }> {
  const baselines: Record<string, number> = {}
  const allDates = new Set<string>()
  const bestByDate: Record<string, Map<string, number>> = {}

  for (const exId of exerciseIds) {
    const list = (workoutsByExercise.get(exId) ?? [])
      .filter((w) => w.estimated_1rm !== null)
      .toSorted((a, b) => a.date.localeCompare(b.date))
    if (list.length === 0) continue
    baselines[exId] = list[0]!.estimated_1rm!
    for (const w of list) {
      allDates.add(w.date)
      const m = bestByDate[w.date] ?? new Map<string, number>()
      const cur = m.get(exId)
      const v = w.estimated_1rm!
      if (cur === undefined || v > cur) m.set(exId, v)
      bestByDate[w.date] = m
    }
  }

  const sortedDates = Array.from(allDates).toSorted()
  return sortedDates.map((date) => {
    const dayMap = bestByDate[date]
    const pct: Record<string, number | null> = {}
    for (const exId of exerciseIds) {
      const baseline = baselines[exId]
      const val = dayMap?.get(exId)
      if (baseline !== undefined && val !== undefined && baseline > 0) {
        pct[exId] = round1(((val - baseline) / baseline) * 100)
      } else {
        pct[exId] = null
      }
    }
    return { date, pct }
  })
}

// ─── DOTS (§2.1) ─────────────────────────────────────────────────────────────

/** IPF 2020 DOTS constants — male. */
export const DOTS_MALE = {
  A: -307.75076,
  B: 24.0900756,
  C: -0.1918759221,
  D: 0.0007391293,
  E: -0.000001093,
} as const

/** IPF 2020 DOTS constants — female. */
export const DOTS_FEMALE = {
  A: -57.96288,
  B: 13.6175032,
  C: -0.1126655495,
  D: 0.0005158568,
  E: -0.0000010706,
} as const

export function dotsCoefficient(bw: number, gender: 'male' | 'female'): number {
  const c = gender === 'female' ? DOTS_FEMALE : DOTS_MALE
  const denom = c.A + c.B * bw + c.C * bw ** 2 + c.D * bw ** 3 + c.E * bw ** 4
  return denom > 0 ? 500 / denom : 0
}

export function dotsAdjusted(e1rm: number, bw: number, gender: 'male' | 'female'): number {
  return e1rm * dotsCoefficient(bw, gender)
}

// ─── Strength ratios + balance (§2.2) ────────────────────────────────────────

export type RatioPair = {
  label: string
  ratio: number | null
  range: [number, number]
  status: RatioStatus | null
  scaleMax: number
}

function computeRatioStatus(ratio: number, [lo, hi]: [number, number]): RatioStatus {
  if (ratio >= lo && ratio <= hi) return 'balanced'
  const deviation = ratio < lo ? (lo - ratio) / lo : (ratio - hi) / hi
  if (deviation > 0.3) return 'critical'
  if (deviation > 0.15) return 'imbalanced'
  return 'balanced'
}

function bestE1RMs(
  workoutsByExercise: Map<string, WorkoutWithSets[]>,
  exerciseIds: string[],
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const exId of exerciseIds) {
    for (const w of workoutsByExercise.get(exId) ?? []) {
      if (w.estimated_1rm === null) continue
      const cur = result[exId]
      result[exId] = cur === undefined ? w.estimated_1rm : Math.max(cur, w.estimated_1rm)
    }
  }
  return result
}

function maxPullUpAdded(workouts: WorkoutWithSets[] | undefined): number | null {
  if (!workouts) return null
  let best: number | null = null
  for (const w of workouts) {
    for (const s of w.sets) {
      if (s.set_type !== 'work' && s.set_type !== 'amrap') continue
      if (best === null || s.weight_kg > best) best = s.weight_kg
    }
  }
  return best
}

export function computeStrengthRatios(
  workoutsByExercise: Map<string, WorkoutWithSets[]>,
  bw: number,
  gender: 'male' | 'female',
): { pairs: RatioPair[]; hasData: boolean } {
  const bests = bestE1RMs(workoutsByExercise, ['bench_press', 'deadlift', 'squat'])
  const pullUpAdded = maxPullUpAdded(workoutsByExercise.get('pull_ups'))

  const dotsFor = (id: string): number | null => {
    const e1rm = bests[id]
    return e1rm !== undefined ? dotsAdjusted(e1rm, bw, gender) : null
  }
  const dl = dotsFor('deadlift')
  const sq = dotsFor('squat')
  const bp = dotsFor('bench_press')

  function pair(
    label: string,
    num: number | null,
    den: number | null,
    range: [number, number],
    scaleMax: number,
  ): RatioPair {
    const ratio = num !== null && den !== null && den > 0 ? num / den : null
    return {
      label,
      ratio: ratio !== null ? round2(ratio) : null,
      range,
      status: ratio !== null ? computeRatioStatus(ratio, range) : null,
      scaleMax,
    }
  }

  // Pull-up ratio uses raw added weight / BW. Null when no added weight.
  const pullUpNum = pullUpAdded !== null && pullUpAdded > 0 ? pullUpAdded : null

  const pairs: RatioPair[] = [
    pair('DL / Squat', dl, sq, [1.0, 1.25], 2.0),
    pair('Squat / Bench', sq, bp, [1.2, 1.5], 2.2),
    pair('DL / Bench', dl, bp, [1.5, 2.0], 3.0),
    pair('Pull-up / BW', pullUpNum, bw, [0.4, 0.7], 1.2),
  ]

  return { pairs, hasData: pairs.some((p) => p.ratio !== null) }
}

export function computeBalanceComposite(ratios: { pairs: RatioPair[]; hasData: boolean }): {
  status: RatioStatus | null
  worstPair: RatioPair | null
} {
  const withData = ratios.pairs.filter((p) => p.status !== null)
  if (withData.length === 0) return { status: null, worstPair: null }
  const order: Record<RatioStatus, number> = { balanced: 0, imbalanced: 1, critical: 2 }
  const worst = withData.reduce<RatioPair>((best, p) => {
    if (p.status === null) return best
    if (best.status === null) return p
    return order[p.status] >= order[best.status] ? p : best
  }, withData[0]!)
  return { status: worst.status, worstPair: worst }
}

// ─── Load quality composite (§2.3) ───────────────────────────────────────────

function clamp01x100(v: number): number {
  return Math.max(0, Math.min(100, v))
}

function inolZoneScore(inol: number): number {
  if (inol < 0.4) return 0
  if (inol < 0.6) return clamp01x100(((inol - 0.4) / 0.2) * 100)
  if (inol <= 1.0) return 100
  if (inol <= 1.5) return clamp01x100(((1.5 - inol) / 0.5) * 100)
  return 0
}

function acwrZoneScore(acwr: number): number {
  if (acwr < 0.8) return clamp01x100((acwr / 0.8) * 100)
  if (acwr <= 1.3) return 100
  if (acwr <= 1.5) return clamp01x100(((1.5 - acwr) / 0.2) * 100)
  return 0
}

function volLandmarkScore(vol: number, mev: number, mav: number, mrv: number): number {
  if (mrv <= 0 || mav <= mev) return 50
  if (vol < mev) return clamp01x100((vol / mev) * 100)
  if (vol <= mav) return 100
  if (vol <= mrv) return clamp01x100(((mrv - vol) / (mrv - mav)) * 100)
  return 0
}

export type DragComponent = 'INOL' | 'ACWR' | 'Volume'

export function computeLoadQuality(
  workoutsByExercise: Map<string, WorkoutWithSets[]>,
  exerciseIds: string[],
  bwAt: (date: string) => number,
): {
  score: number
  verdict: 'Quality' | 'Adequate' | 'Poor'
  dragComponent: DragComponent | null
  latestInol: number | null
  latestAcwr: number | null
} {
  const inolScores: number[] = []
  const acwrScores: number[] = []
  const volScores: number[] = []
  let latestInol: number | null = null
  let latestAcwr: number | null = null

  for (const exId of exerciseIds) {
    const list = (workoutsByExercise.get(exId) ?? []).toSorted((a, b) =>
      a.date.localeCompare(b.date),
    )
    if (list.length === 0) continue

    // INOL: last ma10 or last raw INOL.
    const inolSeries = list.map((w) => sessionInol(w, bwAt(w.date)))
    const ma10 = trailingMean(inolSeries, 10)
    const lastIdx = list.length - 1
    const lastInol = ma10[lastIdx] ?? inolSeries[lastIdx] ?? null
    if (lastInol !== null) {
      inolScores.push(inolZoneScore(lastInol))
      if (latestInol === null) latestInol = lastInol
    }

    // ACWR: last value.
    const acwrData = computeAcwrSeries(list)
    if (acwrData.length > 0) {
      const lastAcwr = acwrData[acwrData.length - 1]!.acwr
      if (lastAcwr !== null) {
        acwrScores.push(acwrZoneScore(lastAcwr))
        if (latestAcwr === null) latestAcwr = lastAcwr
      }
    }

    // Volume: last weekly tonnage vs landmarks.
    const lm = volumeLandmarks(list)
    const tonSeries = weeklyTonnageSeries(list)
    if (tonSeries.length > 0 && lm.mrv > 0) {
      const lastTon = tonSeries[tonSeries.length - 1]!.tonnage
      volScores.push(volLandmarkScore(lastTon, lm.mev, lm.mav, lm.mrv))
    }
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 50)
  const inolAvg = avg(inolScores)
  const acwrAvg = avg(acwrScores)
  const volAvg = avg(volScores)
  const score = Math.round(0.4 * inolAvg + 0.4 * acwrAvg + 0.2 * volAvg)
  const verdict: 'Quality' | 'Adequate' | 'Poor' =
    score >= 75 ? 'Quality' : score >= 50 ? 'Adequate' : 'Poor'

  const components: Array<{ name: DragComponent; score: number }> = [
    { name: 'INOL', score: inolAvg },
    { name: 'ACWR', score: acwrAvg },
    { name: 'Volume', score: volAvg },
  ]
  const drag = components.reduce<{ name: DragComponent; score: number } | null>(
    (worst, c) => (worst === null || c.score < worst.score ? c : worst),
    null,
  )

  return {
    score,
    verdict,
    dragComponent: drag !== null && drag.score < 90 ? drag.name : null,
    latestInol: latestInol !== null ? round2(latestInol) : null,
    latestAcwr: latestAcwr !== null ? round2(latestAcwr) : null,
  }
}

// ─── Strength direction hero (§2.4) ──────────────────────────────────────────

export function computeStrengthDirectionHero(
  workoutsByExercise: Map<string, WorkoutWithSets[]>,
  exerciseIds: string[],
): {
  direction: StrengthDirection
  leaderExercise: string | null
  leaderVelocityPctPerMonth: number | null
  momentumSign: 'accelerating' | 'linear' | 'decelerating'
} {
  let bestVelocity: number | null = null
  let leaderExercise: string | null = null
  for (const exId of exerciseIds) {
    const vel = velocityPctPerDay(workoutsByExercise.get(exId) ?? [])
    if (vel !== null && (bestVelocity === null || vel > bestVelocity)) {
      bestVelocity = vel
      leaderExercise = exId
    }
  }
  const direction = strengthDirection(bestVelocity)

  let momentumSign: 'accelerating' | 'linear' | 'decelerating' = 'linear'
  if (leaderExercise !== null) {
    const series = buildMomentumSeries(workoutsByExercise.get(leaderExercise) ?? [])
    if (series.length >= 2) {
      const latest = series[series.length - 1]!.velocity
      const prev = series[series.length - 2]!.velocity
      if (latest !== null && prev !== null) {
        const diff = latest - prev
        if (diff > 0.005) momentumSign = 'accelerating'
        else if (diff < -0.005) momentumSign = 'decelerating'
      }
    }
  }

  return {
    direction,
    leaderExercise,
    leaderVelocityPctPerMonth: bestVelocity !== null ? round2(bestVelocity * 30) : null,
    momentumSign,
  }
}

// ─── Readiness × Strain (§2.6) ───────────────────────────────────────────────

export type ReadinessPoint = {
  date: string
  readiness: number | null
  garminRecovery: number | null
  fatigueDept: number
  driver: string | null
}

function p90ofArray(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].toSorted((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.9 * sorted.length) - 1))
  return sorted[idx] ?? null
}

/**
 * §2.6 — Per-day readiness scores with strength-fatigue penalty.
 *
 * 1. Base: Garmin recovery (HRV×0.4 + sleep×0.35 + RHR×0.25, w/ strain-debt).
 * 2. Strength fatigue: × (1 − fatigueDept × 0.25), max 25% shave.
 * 3. Heavy session (sessionInol > 1.2 within 48h): × 0.9.
 */
export function buildReadinessSeries(
  dailyMetrics: DailyMetricRow[],
  workoutsAll: WorkoutWithSets[],
  bwAt: (date: string) => number,
): ReadinessPoint[] {
  if (dailyMetrics.length === 0) return []
  const sorted = dailyMetrics.toSorted((a, b) => a.date.localeCompare(b.date))

  const hrvValues = sorted.map((d) => d.hrv_last_night_avg).filter((v): v is number => v !== null)
  const rhrValues = sorted.map((d) => d.resting_hr).filter((v): v is number => v !== null)
  const avgHrv =
    hrvValues.length > 0 ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null
  const minRhr = rhrValues.length > 0 ? Math.min(...rhrValues) : null
  const maxRhr = rhrValues.length > 0 ? Math.max(...rhrValues) : null

  const dailyActivityScores = sorted.map((d) =>
    activityScore({
      vigorousMin: d.vigorous_intensity_min,
      moderateMin: d.moderate_intensity_min,
      steps: d.steps,
    }),
  )
  const validActivity = dailyActivityScores.filter((v): v is number => v !== null)
  const p90Activity = p90ofArray(validActivity)
  const garminCeiling = p90Activity !== null ? Math.max(STRAIN_DEBT_MIN_CEILING, p90Activity) : null

  const allInols = workoutsAll
    .map((w) => sessionInol(w, bwAt(w.date)))
    .filter((v): v is number => v !== null)
  const fatigueCeiling = Math.max(1.0, p90ofArray(allInols) ?? 0)

  return sorted.map((d, i) => {
    const result = recoveryScore({
      hrv: d.hrv_last_night_avg,
      avgHrv,
      sleepScore: d.sleep_score,
      restingHr: d.resting_hr,
      minRhr,
      maxRhr,
      yesterdayActivityScore: i > 0 ? (dailyActivityScores[i - 1] ?? null) : null,
      ceiling: garminCeiling,
    })
    const garminRecovery = result.recovery
    if (garminRecovery === null) {
      return { date: d.date, readiness: null, garminRecovery: null, fatigueDept: 0, driver: null }
    }

    const cutoff48 = addDays(d.date, -2)
    const recentWorkouts = workoutsAll
      .filter((w) => w.date >= cutoff48 && w.date < d.date)
      .toSorted((a, b) => b.date.localeCompare(a.date))
    const recent = recentWorkouts[0]
    const yesterdayInol = recent ? sessionInol(recent, bwAt(recent.date)) : null
    const fatigueDept = yesterdayInol !== null ? clamp(yesterdayInol / fatigueCeiling, 0, 1) : 0

    let readiness = garminRecovery * (1 - fatigueDept * 0.25)
    const isHeavySession = yesterdayInol !== null && yesterdayInol > 1.2
    if (isHeavySession) readiness *= 0.9

    const driver = isHeavySession
      ? `Fatigue debt ${fatigueDept.toFixed(2)} · heavy session yesterday`
      : fatigueDept > 0.25
        ? `Fatigue debt ${fatigueDept.toFixed(2)} · recent session`
        : null

    return {
      date: d.date,
      readiness: Math.round(clamp(readiness, 0, 100)),
      garminRecovery,
      fatigueDept: round2(fatigueDept),
      driver,
    }
  })
}

// ─── Training-Recovery Alignment Matrix (§2.7) ───────────────────────────────

export type RecoveryRow = 'high' | 'normal' | 'low'
export type AcwrCol = 'under' | 'optimal' | 'caution'
export type VerdictType = 'good' | 'warn' | 'bad'

export type AlignmentCellData = {
  recoveryRow: RecoveryRow
  acwrCol: AcwrCol
  verdict: string
  verdictType: VerdictType
  dates: string[]
  count: number
  isToday: boolean
}

const CELL_VERDICTS: Record<
  RecoveryRow,
  Record<AcwrCol, { verdict: string; verdictType: VerdictType }>
> = {
  high: {
    under: { verdict: 'Waste', verdictType: 'warn' },
    optimal: { verdict: 'Aligned · Push', verdictType: 'good' },
    caution: { verdict: 'Misaligned · Risk', verdictType: 'bad' },
  },
  normal: {
    under: { verdict: 'Light', verdictType: 'warn' },
    optimal: { verdict: 'Aligned', verdictType: 'good' },
    caution: { verdict: 'Overload · Risk', verdictType: 'bad' },
  },
  low: {
    under: { verdict: 'Aligned · Rest', verdictType: 'good' },
    optimal: { verdict: 'Misaligned', verdictType: 'warn' },
    caution: { verdict: 'Critical · Risk', verdictType: 'bad' },
  },
}

function recoveryRowFor(score: number): RecoveryRow {
  if (score >= 70) return 'high'
  if (score >= 40) return 'normal'
  return 'low'
}

function acwrColFor(acwr: number): AcwrCol {
  if (acwr < 0.8) return 'under'
  if (acwr <= 1.3) return 'optimal'
  return 'caution'
}

function latestAcwrBefore(
  series: Array<{ date: string; acwr: number | null }>,
  targetDate: string,
): number | null {
  const candidates = series.filter((p) => p.date <= targetDate && p.acwr !== null)
  return candidates.length > 0 ? (candidates[candidates.length - 1]!.acwr ?? null) : null
}

export function buildAlignmentMatrix(
  readinessSeries: ReadinessPoint[],
  workoutsByExercise: Map<string, WorkoutWithSets[]>,
  exerciseIds: string[],
  today: string,
): AlignmentCellData[][] {
  const ROWS: RecoveryRow[] = ['high', 'normal', 'low']
  const COLS: AcwrCol[] = ['under', 'optimal', 'caution']

  const allAcwrSeries = exerciseIds.map((ex) => computeAcwrSeries(workoutsByExercise.get(ex) ?? []))

  const readinessByDate = new Map<string, number>()
  for (const r of readinessSeries) {
    if (r.readiness !== null) readinessByDate.set(r.date, r.readiness)
  }

  const grid: AlignmentCellData[][] = ROWS.map((row) =>
    COLS.map((col) => ({
      recoveryRow: row,
      acwrCol: col,
      verdict: CELL_VERDICTS[row][col].verdict,
      verdictType: CELL_VERDICTS[row][col].verdictType,
      dates: [],
      count: 0,
      isToday: false,
    })),
  )

  const sessionDates = new Set<string>()
  for (const exId of exerciseIds) {
    for (const w of workoutsByExercise.get(exId) ?? []) sessionDates.add(w.date)
  }

  for (const date of sessionDates) {
    const recovery = readinessByDate.get(date)
    if (recovery === undefined) continue
    const acwrValues = allAcwrSeries
      .map((series) => latestAcwrBefore(series, date))
      .filter((v): v is number => v !== null)
    if (acwrValues.length === 0) continue
    const avgAcwr = acwrValues.reduce((a, b) => a + b, 0) / acwrValues.length
    const rowIdx = ROWS.indexOf(recoveryRowFor(recovery))
    const colIdx = COLS.indexOf(acwrColFor(avgAcwr))
    if (rowIdx >= 0 && colIdx >= 0) {
      grid[rowIdx]![colIdx]!.dates.push(date)
      grid[rowIdx]![colIdx]!.count++
    }
  }

  const todayRecovery = readinessByDate.get(today)
  const todayAcwrValues = allAcwrSeries
    .map((series) => latestAcwrBefore(series, today))
    .filter((v): v is number => v !== null)
  if (todayRecovery !== undefined && todayAcwrValues.length > 0) {
    const todayAvgAcwr = todayAcwrValues.reduce((a, b) => a + b, 0) / todayAcwrValues.length
    const rowIdx = ROWS.indexOf(recoveryRowFor(todayRecovery))
    const colIdx = COLS.indexOf(acwrColFor(todayAvgAcwr))
    if (rowIdx >= 0 && colIdx >= 0) grid[rowIdx]![colIdx]!.isToday = true
  }

  return grid
}

// ─── Deload Signal (§2.8) ────────────────────────────────────────────────────

export function deloadSignal(
  workoutsByExercise: Map<string, WorkoutWithSets[]>,
  dailyMetrics: DailyMetricRow[],
  exerciseIds: string[],
  today: string,
): {
  verdict: 'deload' | 'monitor' | 'progress'
  activeSignals: string[]
  physioAvailable: boolean
} {
  const physioAvailable = dailyMetrics.length >= 7
  const signals: string[] = []

  // Signal 1: Stall — velocity ≤ 0 on ≥ 2 key lifts with a session in last 21d.
  const cutoff21 = addDays(today, -21)
  let stalledLifts = 0
  for (const exId of exerciseIds) {
    const list = workoutsByExercise.get(exId) ?? []
    const vel = velocityPctPerDay(list)
    const hasRecent = list.some((w) => w.date >= cutoff21)
    if (vel !== null && vel <= 0 && hasRecent) stalledLifts++
  }
  if (stalledLifts >= 2) signals.push(`stall on ${stalledLifts} lifts`)

  // Signal 2: Overload — last 2 ACWR weekly points > 1.3 on any key lift.
  let signaled = false
  for (const exId of exerciseIds) {
    if (signaled) break
    const acwrData = computeAcwrSeries(workoutsByExercise.get(exId) ?? [])
    if (acwrData.length >= 2) {
      const last2 = acwrData.slice(-2)
      if (last2.every((p) => p.acwr !== null && p.acwr > 1.3)) {
        signals.push(`overload (${exId} ACWR ${last2[last2.length - 1]!.acwr!.toFixed(2)})`)
        signaled = true
      }
    }
  }

  // Signal 3: Fatigue — avg INOL > 1.1 over last 10 sessions of active exercises (≥5 sessions).
  const allActive: WorkoutWithSets[] = []
  for (const exId of exerciseIds) {
    for (const w of workoutsByExercise.get(exId) ?? []) allActive.push(w)
  }
  const recent = allActive.toSorted((a, b) => b.date.localeCompare(a.date)).slice(0, 10)
  if (recent.length >= 5) {
    // No bw resolver here — caller side, but we approximate with 80 since the
    // verdict only consumes a binary > 1.1 cutoff and INOL is bw-invariant for
    // non-pull-up sessions. For pull-ups bw shifts the value mildly, but the
    // old impl used the default 80 too.
    const inols = recent.map((w) => sessionInol(w, 80)).filter((v): v is number => v !== null)
    if (inols.length > 0) {
      const avgInol = inols.reduce((a, b) => a + b, 0) / inols.length
      if (avgInol > 1.1) signals.push(`fatigue (INOL avg ${avgInol.toFixed(2)})`)
    }
  }

  // Signal 4: Physio — fitness declining OR HRV 7d MA < 0.85 × HRV 28d MA.
  if (physioAvailable) {
    const sortedM = dailyMetrics.toSorted((a, b) => a.date.localeCompare(b.date))
    const fitness = fitnessDirection(
      sortedM.map((m) => ({
        date: m.date,
        restingHr: m.resting_hr,
        hrv: m.hrv_last_night_avg,
        vo2Max: m.vo2_max,
      })),
    )
    if (fitness.label === 'Declining') {
      signals.push('physio (fitness declining)')
    } else {
      const last7Hrv = sortedM
        .slice(-7)
        .map((d) => d.hrv_last_night_avg)
        .filter((v): v is number => v !== null)
      const last28Hrv = sortedM
        .slice(-28)
        .map((d) => d.hrv_last_night_avg)
        .filter((v): v is number => v !== null)
      if (last7Hrv.length >= 3 && last28Hrv.length >= 7) {
        const h7 = last7Hrv.reduce((a, b) => a + b, 0) / last7Hrv.length
        const h28 = last28Hrv.reduce((a, b) => a + b, 0) / last28Hrv.length
        if (h28 > 0 && h7 < h28 * 0.85) {
          signals.push(`physio (HRV down ${Math.round((1 - h7 / h28) * 100)}%)`)
        }
      }
    }
  }

  const count = signals.length
  const verdict: 'deload' | 'monitor' | 'progress' =
    count >= 2 ? 'deload' : count === 1 ? 'monitor' : 'progress'
  return { verdict, activeSignals: signals, physioAvailable }
}

// ─── Achievements (§3) ───────────────────────────────────────────────────────

export type Achievement = {
  type: 'first_workout' | 'weight_milestone' | 'max_weight_pr' | 'estimated_1rm_pr' | 'volume_pr'
  title: string
  description: string
  confetti: boolean
}

const EXERCISE_LABELS: Record<string, string> = {
  bench_press: 'Bench Press',
  deadlift: 'Deadlift',
  squat: 'Squat',
  pull_ups: 'Pull-ups',
}

function exerciseLabel(id: string): string {
  return EXERCISE_LABELS[id] ?? id
}

/**
 * §3 — Detect achievements for a newly-saved workout. `history` must be the
 * exercise's prior workouts EXCLUDING the just-saved one. `bw` is the body
 * weight on the workout's date.
 */
export function detectAchievements(
  exercise_id: string,
  newSets: SetRow[],
  history: WorkoutWithSets[],
  bw: number,
): Achievement[] {
  const achievements: Achievement[] = []
  const exLabel = exerciseLabel(exercise_id)
  const exHistory = history.filter((w) => w.exercise_id === exercise_id)
  const metrics = computeMetrics(newSets, exercise_id, bw)
  const isPullUps = exercise_id === 'pull_ups'

  // computeMetrics doesn't return maxWeight directly; recompute it the same way.
  const eligibleSets = newSets.filter(
    (s) => (s.set_type === 'work' || s.set_type === 'amrap') && s.reps >= 1 && s.reps <= 12,
  )
  const maxWeight =
    eligibleSets.length > 0
      ? Math.max(...eligibleSets.map((s) => (isPullUps ? s.weight_kg + bw : s.weight_kg)))
      : 0
  const estimated1rm = metrics.estimated_1rm
  const totalVolume = metrics.total_volume

  if (maxWeight === 0) return achievements

  // First workout for this exercise — single combined celebration.
  if (exHistory.length === 0) {
    const parts = [`${round1(maxWeight)}kg top set`]
    if (estimated1rm !== null && estimated1rm > 0)
      parts.push(`${estimated1rm.toFixed(1)}kg est. 1RM`)
    parts.push(`${Math.round(totalVolume).toLocaleString()}kg volume`)
    achievements.push({
      type: 'first_workout',
      title: `First ${exLabel} Workout!`,
      description: parts.join(', '),
      confetti: true,
    })
    return achievements
  }

  // Historical bests — pull-ups use weight_kg + bw on the historical session's date.
  // For simplicity we use the supplied bw (current); the old code used a static 80.
  const prevMaxWeight = Math.max(
    0,
    ...exHistory.map((w) => {
      const ws = w.sets.filter((s) => s.set_type === 'work')
      if (ws.length === 0) return 0
      return Math.max(...ws.map((s) => (isPullUps ? s.weight_kg + bw : s.weight_kg)))
    }),
  )
  const prevMax1rm = Math.max(
    0,
    ...exHistory.filter((w) => w.estimated_1rm !== null).map((w) => w.estimated_1rm!),
  )
  const prevMaxVolume = Math.max(0, ...exHistory.map((w) => w.total_volume))

  // Weight milestones (crossing round number boundaries).
  const step = isPullUps ? 5 : 10
  const prevMilestone = Math.floor(prevMaxWeight / step) * step
  const newMilestone = Math.floor(maxWeight / step) * step
  if (newMilestone > prevMilestone) {
    achievements.push({
      type: 'weight_milestone',
      title: `${newMilestone}kg Milestone!`,
      description: `${exLabel} crossed the ${newMilestone}kg mark`,
      confetti: newMilestone % 50 === 0,
    })
  }

  if (maxWeight > prevMaxWeight && prevMaxWeight > 0) {
    achievements.push({
      type: 'max_weight_pr',
      title: 'New Max Weight PR!',
      description: `${exLabel} — ${round1(maxWeight)}kg (prev ${round1(prevMaxWeight)}kg)`,
      confetti: true,
    })
  }

  if (estimated1rm !== null && estimated1rm > prevMax1rm && prevMax1rm > 0) {
    achievements.push({
      type: 'estimated_1rm_pr',
      title: 'New Estimated 1RM!',
      description: `${exLabel} — ${estimated1rm}kg (prev ${prevMax1rm.toFixed(1)}kg)`,
      confetti: true,
    })
  }

  if (totalVolume > prevMaxVolume && prevMaxVolume > 0) {
    achievements.push({
      type: 'volume_pr',
      title: 'New Volume Record!',
      description: `${exLabel} — ${Math.round(totalVolume).toLocaleString()}kg total (prev ${Math.round(prevMaxVolume).toLocaleString()}kg)`,
      confetti: false,
    })
  }

  return achievements
}

// ─── Body weight phase (§4.2) ────────────────────────────────────────────────

export type WeightPhase = 'losing' | 'gaining' | 'maintaining'

/**
 * Linear regression slope (kg/day) over weight entries. Returns null if fewer
 * than 2 points or the span is < 3 days (insufficient signal).
 */
function bodyWeightSlope(entries: Array<{ date: string; weight_kg: number }>): number | null {
  if (entries.length < 2) return null
  const sorted = [...entries].toSorted((a, b) => a.date.localeCompare(b.date))
  const base = sorted[0]!.date
  const span = diffDays(sorted[sorted.length - 1]!.date, base)
  if (span < 3) return null
  const pairs: Array<[number, number]> = sorted.map((e) => [diffDays(e.date, base), e.weight_kg])
  return linearSlope(pairs)
}

/**
 * §4.2 — Trailing 28-day rate (kg/week). Falls back to all-time slope when
 * the trailing window has fewer than 2 points.
 */
export function trailingRateKgPerWeek(
  entries: Array<{ date: string; weight_kg: number }>,
): number | null {
  if (entries.length < 2) return null
  const sorted = [...entries].toSorted((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]!.date
  const cutoff = addDays(last, -28)
  const window = sorted.filter((e) => e.date >= cutoff)
  const slope = bodyWeightSlope(window.length >= 2 ? window : sorted)
  return slope === null ? null : slope * 7
}

/** §4.2 — Phase classification by absolute |kg/week|. */
export function classifyWeightPhase(kgPerWeek: number | null): {
  phase: WeightPhase
  intensity: string
} {
  if (kgPerWeek === null) return { phase: 'maintaining', intensity: 'No trend' }
  const abs = Math.abs(kgPerWeek)
  if (abs < 0.1) return { phase: 'maintaining', intensity: 'Maintenance' }
  if (kgPerWeek < 0) {
    if (abs < 0.4) return { phase: 'losing', intensity: 'Lean cut' }
    if (abs < 0.8) return { phase: 'losing', intensity: 'Standard cut' }
    return { phase: 'losing', intensity: 'Aggressive cut' }
  }
  if (abs < 0.3) return { phase: 'gaining', intensity: 'Lean bulk' }
  if (abs < 0.6) return { phase: 'gaining', intensity: 'Standard bulk' }
  return { phase: 'gaining', intensity: 'Aggressive bulk' }
}
