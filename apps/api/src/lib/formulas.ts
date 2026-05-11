import { asc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { weightLog, userProfile } from '../db/schema.js'

export const HARD_FALLBACK_BW = 80

export type WeightEntry = { date: string; weight_kg: number }

export function makeBodyweightResolver(
  entries: WeightEntry[],
  profileFallback: number,
): (date: string) => number {
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

export function computeMetrics(
  sets: Array<{ set_type: string; weight_kg: number; reps: number }>,
  exercise_id: string,
  bodyweightKg: number,
) {
  const isPullUps = exercise_id === 'pull_ups'
  let totalVolume = 0
  let maxEpley: number | null = null
  let maxBrzycki: number | null = null

  for (const s of sets) {
    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    totalVolume += ew * s.reps
  }

  for (const s of sets) {
    const eligible =
      (s.set_type === 'work' || s.set_type === 'amrap') && s.reps >= 1 && s.reps <= 12
    if (!eligible) continue

    const ew = isPullUps ? s.weight_kg + bodyweightKg : s.weight_kg
    const epley = ew * (1 + s.reps / 30)
    maxEpley = maxEpley === null ? epley : Math.max(maxEpley, epley)

    if (s.reps <= 10) {
      const brzycki = (ew * 36) / (37 - s.reps)
      maxBrzycki = maxBrzycki === null ? brzycki : Math.max(maxBrzycki, brzycki)
    }
  }

  const e = maxEpley !== null ? Math.round(maxEpley * 10) / 10 : null
  const b = maxBrzycki !== null ? Math.round(maxBrzycki * 10) / 10 : null

  let e1rm: number | null = null
  if (e !== null && b !== null) e1rm = Math.round(((e + b) / 2) * 10) / 10
  else if (b !== null) e1rm = b
  else if (e !== null) e1rm = e

  return {
    estimated_1rm_epley: e,
    estimated_1rm_brzycki: b,
    estimated_1rm: e1rm,
    total_volume: Math.round(totalVolume * 10) / 10,
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
