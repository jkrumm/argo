import { asc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { weightLog, userProfile } from '../db/schema.js'

export const HARD_FALLBACK_BW = 80

export type WeightEntry = { date: string; weight_kg: number }

/**
 * One weigh-in per date, averaging same-day entries. `weightLog` has no unique index on `date`
 * (two weigh-ins in a day are storable), and every consumer of these rows — the series chart's
 * categorical x axis, the summary's moving averages, the resolver below — is wrong in its own way
 * without this: the chart silently drops one, the averages double-weight the day, and the resolver
 * picks whichever row the DB happened to return last. Repeated same-day weigh-ins are noise around
 * one true value, so averaging is the reading; insertion order is preserved so callers may pass
 * rows ascending or descending.
 */
export function foldWeightByDate<T extends WeightEntry>(rows: T[]): WeightEntry[] {
  const byDate = new Map<string, number[]>()
  for (const r of rows) {
    const existing = byDate.get(r.date)
    if (existing) existing.push(r.weight_kg)
    else byDate.set(r.date, [r.weight_kg])
  }
  return Array.from(byDate, ([date, values]) => ({
    date,
    weight_kg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
  }))
}

export function makeBodyweightResolver(
  rawEntries: WeightEntry[],
  profileFallback: number,
): (date: string) => number {
  const entries = foldWeightByDate(rawEntries)
  if (entries.length === 0) return () => profileFallback
  const earliest = entries[0]!.weight_kg
  return (date: string) => {
    let latest: number | null = null
    for (const e of entries) {
      if (e.date <= date) latest = e.weight_kg
      else break
    }
    return latest ?? earliest
  }
}

export async function loadBodyweightResolver(): Promise<(date: string) => number> {
  const entries = await db
    .select({ date: weightLog.date, weight_kg: weightLog.weight_kg })
    .from(weightLog)
    .orderBy(asc(weightLog.date))
  const [profile] = await db
    .select({ goal_weight_kg: userProfile.goal_weight_kg })
    .from(userProfile)
    .where(eq(userProfile.id, 1))
  const profileFallback = profile?.goal_weight_kg ?? HARD_FALLBACK_BW
  return makeBodyweightResolver(entries, profileFallback)
}

/**
 * Highest rep count for which a rep-based 1RM estimate is trusted.
 *
 * Epley and Brzycki cross at exactly 10 reps — solving `1 + R/30 = 36/(37−R)` gives
 * `R² − 7R − 30 = 0`, whose positive root is 10. Below 10 Brzycki is the conservative of the two;
 * above 10 it overtakes Epley and runs away toward its pole at R = 37. Estimating past 10 therefore
 * means depending on which formula you picked, with no agreement to anchor it. See
 * `docs/STRENGTH-ANALYTICS.md` §2.2.
 */
export const E1RM_MAX_REPS = 10

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * The two component estimates for a single set, or null when the set is outside the trusted rep
 * range. Both formulas are always valid together (they share the [1, {@link E1RM_MAX_REPS}] window),
 * so this returns both or neither.
 */
export function estimate1RMParts(
  weight: number,
  reps: number,
): { epley: number; brzycki: number } | null {
  if (reps < 1 || reps > E1RM_MAX_REPS) return null
  return { epley: weight * (1 + reps / 30), brzycki: (weight * 36) / (37 - reps) }
}

/** Epley + Brzycki average for one set. Null outside [1, {@link E1RM_MAX_REPS}]. */
export function estimate1RM(weight: number, reps: number): number | null {
  const parts = estimate1RMParts(weight, reps)
  return parts === null ? null : (parts.epley + parts.brzycki) / 2
}

export function computeMetrics(
  sets: Array<{ set_type: string; weight_kg: number; reps: number }>,
  exercise_id: string,
  bodyweightKg: number,
) {
  const isPullUps = exercise_id === 'pull_ups'
  let totalVolume = 0

  for (const s of sets) {
    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    totalVolume += ew * s.reps
  }

  // Session e1RM is the best SINGLE set: score each set, then take the winner — never the max of
  // each formula taken separately, which blends two different sets into an estimate of neither.
  let best: { e1rm: number; epley: number; brzycki: number; weight: number } | null = null

  for (const s of sets) {
    if (s.set_type !== 'work' && s.set_type !== 'amrap') continue
    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    const parts = estimate1RMParts(ew, s.reps)
    if (parts === null) continue

    const e1rm = (parts.epley + parts.brzycki) / 2
    // Ties break toward the heavier set — the heavier lift is the more reliable estimate.
    const wins = best === null || e1rm > best.e1rm || (e1rm === best.e1rm && ew > best.weight)
    if (wins) best = { e1rm, epley: parts.epley, brzycki: parts.brzycki, weight: ew }
  }

  return {
    estimated_1rm_epley: best === null ? null : round1(best.epley),
    estimated_1rm_brzycki: best === null ? null : round1(best.brzycki),
    estimated_1rm: best === null ? null : round1(best.e1rm),
    total_volume: round1(totalVolume),
  }
}

// ma7 > ma30 by >0.5% = 'up'; ma7 < ma30 by >0.5% = 'down'; otherwise 'flat'
export function deriveTrend(ma7: number | null, ma30: number | null): 'up' | 'down' | 'flat' {
  if (ma7 === null || ma30 === null || ma30 === 0) return 'flat'
  const delta = (ma7 - ma30) / ma30
  if (delta > 0.005) return 'up'
  if (delta < -0.005) return 'down'
  return 'flat'
}

// Computes rolling stats over an array of values ordered most-recent-first.
// ma7 = avg of first 7 non-null values, ma30 = avg of first 30 non-null values.
export function computeStats(values: (number | null)[]): {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: 'up' | 'down' | 'flat'
} {
  const valid = values.filter((v): v is number => v !== null)
  if (valid.length === 0) return { current: null, ma7: null, ma30: null, trend: 'flat' }
  const current = valid[0] ?? null
  const slice7 = valid.slice(0, 7)
  const slice30 = valid.slice(0, 30)
  const ma7 = Math.round((slice7.reduce((a, b) => a + b, 0) / slice7.length) * 10) / 10
  const ma30 = Math.round((slice30.reduce((a, b) => a + b, 0) / slice30.length) * 10) / 10
  return { current, ma7, ma30, trend: deriveTrend(ma7, ma30) }
}
