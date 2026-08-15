/**
 * Domain-agnostic "is this window worth going out for?" engine.
 *
 * Two mechanisms, deliberately kept separate:
 *
 * - **Hard gates** — binary, physical show-stoppers. Any failing gate kills the
 *   window outright and contributes a *named* reason (a "killer"). A gated
 *   window scores 0; there is no partial credit for a night the core never
 *   clears the horizon on.
 * - **Weighted factors** — continuous 0..1 qualities that trade off against
 *   each other. The score is the weight-normalised mean of the factors that
 *   have data, scaled to 0..100.
 *
 * A factor that returns `null` means *no data*, not *bad*. It drops out of both
 * the numerator and the denominator so a missing upstream degrades confidence
 * rather than silently scoring the night as terrible. `coverage` reports how
 * much of the configured weight actually had data behind it.
 *
 * Astro and marine are two configs over this one engine — nothing in here
 * knows about the sky or the sea. The LLM never touches any of it: this module
 * produces the verdict, and prose is generated *from* the verdict elsewhere.
 */

/** A binary show-stopper. `passes: false` kills the window and names why. */
export type Gate<TInput> = {
  /** Stable machine id, e.g. `core-altitude`. Surfaced in the API response. */
  id: string
  /** Short human label, e.g. `Core altitude`. */
  label: string
  /**
   * Evaluate the gate. `reason` is required when `passes` is false and is what
   * the user actually reads ("core peaks at 6.2°, below the 8° floor").
   */
  evaluate: (input: TInput) => { passes: boolean; reason?: string }
}

/** A continuous 0..1 quality. Higher is always better. */
export type Factor<TInput> = {
  /** Stable machine id, e.g. `cloud-low`. */
  id: string
  /** Short human label, e.g. `Low cloud`. */
  label: string
  /** Relative importance. Only ratios matter; they need not sum to anything. */
  weight: number
  /**
   * 0..1 where 1 is perfect. Return `null` when the underlying data is
   * missing — the factor then drops out of the score instead of scoring 0.
   */
  value: (input: TInput) => number | null
  /** Optional one-line explanation of the current value, for the UI. */
  detail?: (input: TInput) => string | undefined
}

/** Score bands, evaluated top-down; the first whose `min` is met wins. */
export type VerdictBand = {
  verdict: string
  /** Inclusive lower bound on the 0..100 score. */
  min: number
}

export type WindowConfig<TInput> = {
  gates: Gate<TInput>[]
  factors: Factor<TInput>[]
  /** Defaults to {@link DEFAULT_BANDS}. */
  bands?: VerdictBand[]
}

export type FactorContribution = {
  id: string
  label: string
  weight: number
  /** null when the factor had no data. */
  value: number | null
  /** `weight * value`, or null when the factor had no data. */
  weighted: number | null
  detail?: string
}

export type Killer = {
  id: string
  label: string
  reason: string
}

export type ScoredWindow = {
  /** 0..100. Always exactly 0 when `gated` is true. */
  score: number
  /** Band label for `score`, or `'out'` when gated. */
  verdict: string
  /** True when at least one hard gate failed. */
  gated: boolean
  /** Named reasons the window is out. Empty when `gated` is false. */
  killers: Killer[]
  /** Per-factor breakdown, in config order. Empty when gated. */
  factors: FactorContribution[]
  /**
   * Share of the configured factor weight that actually had data, 0..1.
   * 1 means every factor contributed; 0.6 means 40% of the weight was missing
   * and the score is correspondingly less trustworthy.
   */
  coverage: number
}

/**
 * Default bands. `out` is not listed — it is reserved for gated windows and
 * never produced by score alone.
 */
export const DEFAULT_BANDS: VerdictBand[] = [
  { verdict: 'excellent', min: 80 },
  { verdict: 'good', min: 65 },
  { verdict: 'marginal', min: 45 },
  { verdict: 'poor', min: 0 },
]

/** Verdict used for any window that failed a hard gate. */
export const GATED_VERDICT = 'out'

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Evaluate every gate, then every factor, and fold them into one verdict.
 *
 * Gates are all evaluated even after the first failure — the user wants to
 * know that the moon *and* the cloud killed it, not just whichever gate the
 * config happened to list first.
 */
export function scoreWindow<TInput>(config: WindowConfig<TInput>, input: TInput): ScoredWindow {
  const killers: Killer[] = []
  for (const gate of config.gates) {
    const result = gate.evaluate(input)
    if (result.passes) continue
    killers.push({
      id: gate.id,
      label: gate.label,
      reason: result.reason ?? `${gate.label} failed`,
    })
  }

  if (killers.length > 0) {
    return { score: 0, verdict: GATED_VERDICT, gated: true, killers, factors: [], coverage: 0 }
  }

  const factors: FactorContribution[] = []
  let weightedSum = 0
  let presentWeight = 0
  let totalWeight = 0

  for (const factor of config.factors) {
    totalWeight += factor.weight
    const raw = factor.value(input)
    const value = raw === null ? null : clamp01(raw)
    const weighted = value === null ? null : factor.weight * value
    if (value !== null && weighted !== null) {
      weightedSum += weighted
      presentWeight += factor.weight
    }
    const detail = factor.detail?.(input)
    factors.push({
      id: factor.id,
      label: factor.label,
      weight: factor.weight,
      value,
      weighted,
      // Spread rather than assign: `exactOptionalPropertyTypes` rejects an
      // explicit `undefined` for an optional property.
      ...(detail === undefined ? {} : { detail }),
    })
  }

  const score = presentWeight > 0 ? round1((weightedSum / presentWeight) * 100) : 0
  const coverage = totalWeight > 0 ? round3(presentWeight / totalWeight) : 0
  const bands = config.bands ?? DEFAULT_BANDS
  const verdict = bands.find((band) => score >= band.min)?.verdict ?? 'poor'

  return { score, verdict, gated: false, killers: [], factors, coverage }
}

/**
 * Linear 0..1 ramp with an explicit good/bad end, clamped outside the range.
 *
 * `linearScore(20, { good: 0, bad: 100 })` → 0.8 — the workhorse for "less is
 * better" percentages like cloud cover. Passing `good > bad` inverts it, which
 * is how "more is better" quantities (swell period, say) are expressed.
 */
export function linearScore(
  value: number | null | undefined,
  range: { good: number; bad: number },
): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const span = range.bad - range.good
  if (span === 0) return value <= range.good ? 1 : 0
  return clamp01(1 - (value - range.good) / span)
}

/**
 * Score a quantity that has a *sweet spot* rather than a direction — 1 at
 * `ideal`, falling linearly to 0 once it is `tolerance` away in either
 * direction.
 *
 * `linearScore` cannot express this: swell height is not "more is better" (a
 * 6 m swell closes out) nor "less is better" (a 0.2 m swell is nothing to
 * ride). Astro has no such factor; marine does, which is why this lives in the
 * engine rather than in either config.
 *
 * `tolerance` may be asymmetric — most physical sweet spots are. `swell height
 * 1.5 m ideal, 1.0 below, 2.5 above` says a metre under is as bad as two and a
 * half over.
 */
export function peakScore(
  value: number | null | undefined,
  range: { ideal: number; below: number; above?: number },
): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const spread = value < range.ideal ? range.below : (range.above ?? range.below)
  if (spread <= 0) return value === range.ideal ? 1 : 0
  return clamp01(1 - Math.abs(value - range.ideal) / spread)
}

/**
 * Smallest angle between two compass bearings, in degrees, 0..180.
 * Exported because "how offshore is the wind" is exactly this question and
 * getting the wrap-around wrong is the classic bug.
 */
export function angularDistance(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360
  return diff > 180 ? 360 - diff : diff
}

/**
 * Mean of a set of compass bearings, in degrees, 0..360 — or null when they are
 * too dispersed for a mean to mean anything.
 *
 * The arithmetic mean is **wrong** for bearings and wrong in the worst way: it
 * averages 350° and 10° to 180°, turning a north wind into a south one and
 * inverting an offshore/onshore verdict. The fix is to average the unit vectors
 * and take the angle of the result.
 *
 * The resultant's *length* is the bonus: it falls to 0 as the inputs spread out
 * around the circle. Below `minResultant` (default 0.2 — roughly "the day's
 * wind boxed the compass") there is no meaningful average direction, so this
 * returns null rather than a confident number pointing at nothing. Callers feed
 * that null straight into a factor, which drops it from the score and lowers
 * `coverage` — the honest outcome.
 */
export function circularMean(degrees: number[], minResultant = 0.2): number | null {
  if (degrees.length === 0) return null
  let sumSin = 0
  let sumCos = 0
  for (const deg of degrees) {
    const rad = (deg * Math.PI) / 180
    sumSin += Math.sin(rad)
    sumCos += Math.cos(rad)
  }
  const meanSin = sumSin / degrees.length
  const meanCos = sumCos / degrees.length
  if (Math.sqrt(meanSin * meanSin + meanCos * meanCos) < minResultant) return null
  const deg = (Math.atan2(meanSin, meanCos) * 180) / Math.PI
  return (deg + 360) % 360
}

/**
 * Map a discrete 1..n band (7Timer's transparency and seeing scales are like
 * this) onto 0..1, where band 1 is best.
 */
export function bandScore(band: number | null | undefined, worstBand: number): number | null {
  if (band === null || band === undefined || Number.isNaN(band)) return null
  if (worstBand <= 1) return 1
  return clamp01(1 - (band - 1) / (worstBand - 1))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
