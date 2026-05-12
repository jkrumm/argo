/**
 * Garmin health analytics — pure functions.
 *
 * Ported from the old argo-old client (utils.ts). Magic numbers documented
 * inline with the constant they're derived from (Compendium of Physical
 * Activities for MET multipliers, Hulin et al. 2017 for ACWR EWMA half-lives,
 * Gabbett 2016 BJSM for ACWR zones).
 *
 * All formulas null-safe: pass nulls through, return null when insufficient
 * data, redistribute weights when components missing.
 */

// ─── Activity Score (MET-minutes) ────────────────────────────────────────────

/** Daily MET-min target for a "100%" day. */
export const ACTIVITY_TARGET_SCORE = 600
/** Each intensity minute consumes ~100 steps (de-double-counting walking). */
export const STEPS_PER_INTENSITY_MIN = 100
/** Walking MET contribution (≈3 MET / 100 steps). */
export const STEPS_MET_PER_STEP = 0.03
/** Moderate-intensity MET multiplier. */
export const MODERATE_MET = 4
/** Vigorous-intensity MET multiplier. */
export const VIGOROUS_MET = 8

export function activityScore(input: {
  vigorousMin: number | null
  moderateMin: number | null
  steps: number | null
}): number | null {
  const vig = input.vigorousMin ?? 0
  const mod = input.moderateMin ?? 0
  const steps = input.steps ?? 0
  if (vig === 0 && mod === 0 && steps === 0) return null

  const vigorousScore = vig * VIGOROUS_MET
  const moderateScore = mod * MODERATE_MET
  const walkingSteps = Math.max(0, steps - (mod + vig) * STEPS_PER_INTENSITY_MIN)
  const walkingScore = walkingSteps * STEPS_MET_PER_STEP
  return Math.round((vigorousScore + moderateScore + walkingScore) * 10) / 10
}

// ─── Recovery Score ──────────────────────────────────────────────────────────

/** Floor on strain-debt anchor (80% of ACTIVITY_TARGET_SCORE). */
export const STRAIN_DEBT_MIN_CEILING = 500
/** Max proportional penalty (30% shave on raw recovery score). */
export const STRAIN_DEBT_MAX_PENALTY = 0.3

/** Recovery component weights — sum to 1.0. */
export const RECOVERY_WEIGHT_HRV = 0.4
export const RECOVERY_WEIGHT_SLEEP = 0.35
export const RECOVERY_WEIGHT_RHR = 0.25

export type RecoveryInput = {
  hrv: number | null
  avgHrv: number | null
  sleepScore: number | null
  restingHr: number | null
  minRhr: number | null
  maxRhr: number | null
  /** Yesterday's activity score (drives strain-debt penalty). */
  yesterdayActivityScore?: number | null
  /** 90th percentile of recent activity scores (floored at STRAIN_DEBT_MIN_CEILING). */
  ceiling?: number | null
}

export type RecoveryResult = {
  recovery: number | null
  components: {
    hrv: number | null
    sleep: number | null
    rhr: number | null
  }
  strainDebt: number
  penalty: number
}

export function recoveryScore(input: RecoveryInput): RecoveryResult {
  let totalWeight = 0
  let weightedSum = 0
  const components: RecoveryResult['components'] = { hrv: null, sleep: null, rhr: null }

  // HRV component: pct of personal average (capped at 100).
  if (input.hrv !== null && input.avgHrv !== null && input.avgHrv > 0) {
    const hrvComp = Math.min(100, (input.hrv / input.avgHrv) * 100) * RECOVERY_WEIGHT_HRV
    components.hrv = Math.round(hrvComp * 10) / 10
    weightedSum += hrvComp
    totalWeight += RECOVERY_WEIGHT_HRV
  }

  // Sleep component: raw sleep score.
  if (input.sleepScore !== null) {
    const sleepComp = input.sleepScore * RECOVERY_WEIGHT_SLEEP
    components.sleep = Math.round(sleepComp * 10) / 10
    weightedSum += sleepComp
    totalWeight += RECOVERY_WEIGHT_SLEEP
  }

  // RHR component: inverted percentile (lower is better).
  if (
    input.restingHr !== null &&
    input.minRhr !== null &&
    input.maxRhr !== null &&
    input.maxRhr > input.minRhr
  ) {
    const rhrPct = (1 - (input.restingHr - input.minRhr) / (input.maxRhr - input.minRhr)) * 100
    const rhrComp = Math.max(0, Math.min(100, rhrPct)) * RECOVERY_WEIGHT_RHR
    components.rhr = Math.round(rhrComp * 10) / 10
    weightedSum += rhrComp
    totalWeight += RECOVERY_WEIGHT_RHR
  }

  if (totalWeight === 0) {
    return { recovery: null, components, strainDebt: 0, penalty: 0 }
  }

  // Redistribute missing weight (don't average — re-weight valid components).
  const rawScore = weightedSum / totalWeight

  // Strain-debt penalty from yesterday's activity score.
  let strainDebt = 0
  let penalty = 0
  if (
    input.yesterdayActivityScore !== undefined &&
    input.yesterdayActivityScore !== null &&
    input.ceiling !== undefined &&
    input.ceiling !== null &&
    input.ceiling > 0
  ) {
    strainDebt = Math.max(0, Math.min(1, input.yesterdayActivityScore / input.ceiling))
    penalty = strainDebt * STRAIN_DEBT_MAX_PENALTY
  }

  const finalScore = Math.round(rawScore * (1 - penalty))
  return {
    recovery: finalScore,
    components,
    strainDebt: Math.round(strainDebt * 1000) / 1000,
    penalty: Math.round(penalty * 1000) / 1000,
  }
}

export type RecoverySeriesInputRow = {
  date: string
  hrv: number | null
  sleepScore: number | null
  restingHr: number | null
  /** Pre-computed activity score for the day (for strain-debt of next day). */
  activityScore: number | null
  /** Highest body battery of the day, used for chart context. */
  bbHighest: number | null
}

export type RecoverySeriesPoint = {
  date: string
  recovery: number | null
  sleepScore: number | null
  bbHigh: number | null
}

/**
 * Compute recovery score for each day in a window.
 * Uses window-wide avgHrv/minRhr/maxRhr as the personal baseline,
 * and 90th-percentile ceiling for strain-debt. yesterday's activity
 * score is taken from the previous day in the same series.
 */
export function recoveryScoreSeries(rows: RecoverySeriesInputRow[]): RecoverySeriesPoint[] {
  if (rows.length === 0) return []

  // Sort ascending by date for series.
  const sorted = rows.toSorted((a, b) => a.date.localeCompare(b.date))

  const hrvValues = sorted.map((r) => r.hrv).filter((v): v is number => v !== null)
  const rhrValues = sorted.map((r) => r.restingHr).filter((v): v is number => v !== null)
  const activityValues = sorted.map((r) => r.activityScore).filter((v): v is number => v !== null)

  const avgHrv =
    hrvValues.length > 0 ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null
  const minRhr = rhrValues.length > 0 ? Math.min(...rhrValues) : null
  const maxRhr = rhrValues.length > 0 ? Math.max(...rhrValues) : null
  const p90Activity = percentile(activityValues, 0.9)
  const ceiling = p90Activity !== null ? Math.max(STRAIN_DEBT_MIN_CEILING, p90Activity) : null

  return sorted.map((row, i) => {
    const yesterday = i > 0 ? (sorted[i - 1]?.activityScore ?? null) : null
    const result = recoveryScore({
      hrv: row.hrv,
      avgHrv,
      sleepScore: row.sleepScore,
      restingHr: row.restingHr,
      minRhr,
      maxRhr,
      yesterdayActivityScore: yesterday,
      ceiling,
    })
    return {
      date: row.date,
      recovery: result.recovery,
      sleepScore: row.sleepScore,
      bbHigh: row.bbHighest,
    }
  })
}

// ─── Training Load (ACWR — Acute : Chronic Workload Ratio) ───────────────────

/** Acute EWMA smoothing factor — 2/(7+1), ~7-day half-life (Hulin et al. 2017). */
export const LAMBDA_ACUTE = 0.25
/** Chronic EWMA smoothing factor — 1 - exp(-1/28), ~28-day half-life. */
export const LAMBDA_CHRONIC = 1 - Math.exp(-1 / 28) // ≈ 0.0350

// NOTE: spec in old-formulas.md states λ_chronic = 2/(28+1) ≈ 0.069. Implement
// using 2/(N+1) form to match old-formulas.md and prior client behaviour.
export const LAMBDA_CHRONIC_LEGACY = 2 / (28 + 1) // ≈ 0.0689

export type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'

export function classifyAcwrZone(acwr: number | null): AcwrZone | null {
  if (acwr === null) return null
  if (acwr < 0.8) return 'undertrained'
  if (acwr <= 1.3) return 'optimal'
  if (acwr <= 1.5) return 'caution'
  return 'danger'
}

export type TrainingLoadInputRow = {
  date: string
  dailyLoad: number | null
}

export type TrainingLoadPoint = {
  date: string
  dailyLoad: number | null
  acute: number | null
  chronic: number | null
  acwr: number | null
  zone: AcwrZone | null
  divergence: number | null
  divPos: number | null
  divNeg: number | null
}

/**
 * Compute full ACWR series with acute/chronic EWMA + divergence.
 * Seed EWMA with the first day's load (so series starts at parity).
 */
export function trainingLoad(rows: TrainingLoadInputRow[]): TrainingLoadPoint[] {
  if (rows.length === 0) return []
  const sorted = rows.toSorted((a, b) => a.date.localeCompare(b.date))

  const lambdaA = LAMBDA_ACUTE
  const lambdaC = LAMBDA_CHRONIC_LEGACY

  let ewmaA: number | null = null
  let ewmaC: number | null = null

  return sorted.map((row, i) => {
    const load = row.dailyLoad
    if (load === null) {
      // Carry previous EWMA forward when no load (rest day still has load 0 if known,
      // but null is treated as "no data" — keep recursion unchanged).
      return {
        date: row.date,
        dailyLoad: null,
        acute: ewmaA !== null ? Math.round(ewmaA * 10) / 10 : null,
        chronic: ewmaC !== null ? Math.round(ewmaC * 10) / 10 : null,
        acwr:
          ewmaA !== null && ewmaC !== null && ewmaC > 0
            ? Math.round((ewmaA / ewmaC) * 100) / 100
            : null,
        zone:
          ewmaA !== null && ewmaC !== null && ewmaC > 0 ? classifyAcwrZone(ewmaA / ewmaC) : null,
        divergence: ewmaA !== null && ewmaC !== null ? Math.round((ewmaA - ewmaC) * 10) / 10 : null,
        divPos:
          ewmaA !== null && ewmaC !== null
            ? Math.max(0, Math.round((ewmaA - ewmaC) * 10) / 10)
            : null,
        divNeg:
          ewmaA !== null && ewmaC !== null
            ? Math.min(0, Math.round((ewmaA - ewmaC) * 10) / 10)
            : null,
      }
    }

    let nextA: number
    let nextC: number
    if (i === 0 || ewmaA === null || ewmaC === null) {
      nextA = load
      nextC = load
    } else {
      nextA = load * lambdaA + ewmaA * (1 - lambdaA)
      nextC = load * lambdaC + ewmaC * (1 - lambdaC)
    }
    ewmaA = nextA
    ewmaC = nextC

    const acute = Math.round(nextA * 10) / 10
    const chronic = Math.round(nextC * 10) / 10
    const acwr = nextC > 0 ? Math.round((nextA / nextC) * 100) / 100 : null
    const zone = classifyAcwrZone(acwr)
    const div = Math.round((nextA - nextC) * 10) / 10

    return {
      date: row.date,
      dailyLoad: Math.round(load * 10) / 10,
      acute,
      chronic,
      acwr,
      zone,
      divergence: div,
      divPos: Math.max(0, div),
      divNeg: Math.min(0, div),
    }
  })
}

// ─── Fitness Direction (3-level signal) ──────────────────────────────────────

/** RHR slope threshold (bpm/day). Lower RHR over time = improving. */
export const FITNESS_RHR_SLOPE_THRESHOLD = 0.05
/** HRV slope threshold (ms/day). Higher HRV over time = improving. */
export const FITNESS_HRV_SLOPE_THRESHOLD = 0.1
/** Regression window for fitness direction (days). */
export const FITNESS_REGRESSION_WINDOW = 14

export type FitnessDirectionInputRow = {
  date: string
  restingHr: number | null
  hrv: number | null
  vo2Max: number | null
}

export type FitnessDirectionSignal = 'improving' | 'stable' | 'declining'

export type FitnessDirectionResult = {
  signal: FitnessDirectionSignal
  label: string
  symbol: string
  color: string
  rhrSlope: number | null
  hrvSlope: number | null
  rhrDelta: number | null
  hrvDelta: number | null
  vo2max: number | null
}

export function fitnessDirection(rows: FitnessDirectionInputRow[]): FitnessDirectionResult {
  // Use the most recent FITNESS_REGRESSION_WINDOW days.
  const sorted = rows.toSorted((a, b) => a.date.localeCompare(b.date))
  const slice = sorted.slice(-FITNESS_REGRESSION_WINDOW)

  const rhrValues = slice.map((r) => r.restingHr)
  const hrvValues = slice.map((r) => r.hrv)

  const rhrSlope = linearRegressionSlope(rhrValues)
  const hrvSlope = linearRegressionSlope(hrvValues)

  const rhrPositive = rhrSlope !== null && rhrSlope < -FITNESS_RHR_SLOPE_THRESHOLD
  const rhrNegative = rhrSlope !== null && rhrSlope > FITNESS_RHR_SLOPE_THRESHOLD
  const hrvPositive = hrvSlope !== null && hrvSlope > FITNESS_HRV_SLOPE_THRESHOLD
  const hrvNegative = hrvSlope !== null && hrvSlope < -FITNESS_HRV_SLOPE_THRESHOLD

  let signal: FitnessDirectionSignal
  let label: string
  let symbol: string
  let color: string

  if ((rhrPositive || hrvPositive) && !(rhrNegative || hrvNegative)) {
    signal = 'improving'
    label = 'Improving'
    symbol = '▲'
    color = '#00c853'
  } else if ((rhrNegative || hrvNegative) && !(rhrPositive || hrvPositive)) {
    signal = 'declining'
    label = 'Declining'
    symbol = '▼'
    color = '#ff3d00'
  } else {
    signal = 'stable'
    label = 'Stable'
    symbol = '▶'
    color = '#78909c'
  }

  // Deltas: last valid - first valid in the slice.
  const firstRhr = slice.find((r) => r.restingHr !== null)?.restingHr ?? null
  const lastRhr = slice.toReversed().find((r) => r.restingHr !== null)?.restingHr ?? null
  const rhrDelta = firstRhr !== null && lastRhr !== null ? lastRhr - firstRhr : null

  const firstHrv = slice.find((r) => r.hrv !== null)?.hrv ?? null
  const lastHrv = slice.toReversed().find((r) => r.hrv !== null)?.hrv ?? null
  const hrvDelta = firstHrv !== null && lastHrv !== null ? lastHrv - firstHrv : null

  const vo2max = sorted.toReversed().find((r) => r.vo2Max !== null)?.vo2Max ?? null

  return {
    signal,
    label,
    symbol,
    color,
    rhrSlope: rhrSlope !== null ? Math.round(rhrSlope * 1000) / 1000 : null,
    hrvSlope: hrvSlope !== null ? Math.round(hrvSlope * 1000) / 1000 : null,
    rhrDelta: rhrDelta !== null ? Math.round(rhrDelta * 10) / 10 : null,
    hrvDelta: hrvDelta !== null ? Math.round(hrvDelta * 10) / 10 : null,
    vo2max: vo2max !== null ? Math.round(vo2max * 10) / 10 : null,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Nearest-rank percentile. p in [0, 1]. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = values.toSorted((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))
  return sorted[idx] ?? null
}

/** Sample standard deviation (n - 1 denominator). Returns null if length < 2. */
export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sq = values.reduce((a, b) => a + (b - mean) ** 2, 0)
  return Math.sqrt(sq / (values.length - 1))
}

/**
 * Ordinary-least-squares slope of values vs. their index.
 * Returns null when fewer than 3 valid points or zero variance in x.
 */
export function linearRegressionSlope(values: (number | null)[]): number | null {
  const valid: Array<{ x: number; y: number }> = []
  values.forEach((v, i) => {
    if (v !== null) valid.push({ x: i, y: v })
  })
  if (valid.length < 3) return null

  const n = valid.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0
  for (const { x, y } of valid) {
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  return (n * sumXY - sumX * sumY) / denom
}

/**
 * Trailing simple moving average over `window` days.
 * For each position i, average of non-null values in [i-window+1, i].
 * Requires at least min(3, window) non-null values in the slice.
 */
export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  if (window <= 0) {
    throw new Error('movingAverage: window must be > 0')
  }
  const minValues = Math.min(3, window)
  return values.map((_, i) => {
    const slice = values
      .slice(Math.max(0, i - window + 1), i + 1)
      .filter((v): v is number => v !== null)
    if (slice.length < minValues) return null
    return Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 10) / 10
  })
}

/**
 * Z-score against the window's mean/sd. Set `flipped=true` for RHR
 * (lower = better) so that "up = improving" across all metrics.
 * `sdFloor` prevents tiny SDs from inflating z-scores.
 */
export function zScore(
  value: number | null,
  values: number[],
  options: { flipped?: boolean; sdFloor?: number } = {},
): number | null {
  if (value === null) return null
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = stdDev(values)
  if (sd === null) return null
  const effectiveSd = Math.max(sd, options.sdFloor ?? 0)
  if (effectiveSd === 0) return null
  const z = (value - mean) / effectiveSd
  return options.flipped ? -z : z
}
