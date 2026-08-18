/**
 * The astro instantiation of the {@link scoreWindow} engine — the thresholds
 * and weights that turn "the sky at Munich tonight" into a go / no-go.
 *
 * Every number here is traceable to the operator's own notes
 * (`brain/Areas/Photography/Astro/Night Workflow.md` §1), not to a general
 * astrophotography heuristic. The constraint that sets all of them: the
 * galactic core sits at declination −29°, so at 48.14°N it never climbs past
 * ~12.9°. A clear southern horizon matters more than a dark sky, and low haze
 * is the enemy rather than the light dome.
 *
 * The marine config in phase 4 is a second instantiation of the same engine —
 * nothing astro-specific belongs in `window-score.ts`.
 */

import { FRAMING_MARGIN_DEG, type AstroNight, type NightSample } from './astro-night.js'
import { bandScore, linearScore, type WindowConfig } from './window-score.js'

/**
 * Core altitude floor. Below 8° the core sits inside the Munich light dome and
 * whatever haze is on the horizon, whatever the forecast says.
 */
export const MIN_CORE_ALTITUDE = 8

/**
 * Moon illumination ceiling. "Anything past first quarter kills the core" —
 * first quarter is 50%, so 25% is the conservative working limit that keeps
 * new-moon ±5 days in and everything else out.
 */
export const MAX_MOON_ILLUMINATION = 0.25

/**
 * 7Timer's transparency scale runs 1 (best) to 8 (worst). Its `seeing` band is
 * deliberately unused: seeing is arcsecond-scale atmospheric turbulence, which
 * is invisible at 12 mm.
 */
export const WORST_TRANSPARENCY_BAND = 8

/**
 * The darkness ramp, in mag/arcsec² **in the direction the core sits** — not at
 * the zenith, which is the half of the sky a Milky Way frame never contains.
 *
 * Both ends are measured rather than round (`docs/ASTRO-MAP-RESEARCH.md` §2.5):
 * `good: 21.0` is beyond anything in reach of Munich, since the darkest of the
 * four sites still only reads 19.98 where the camera points; `bad: 17.3` is
 * Munich's own core direction, i.e. the floor of what is worth driving away
 * from. Note the reversed scale — higher mpsas is darker, so `good > bad` and
 * {@link linearScore} inverts accordingly.
 */
export const CORE_DARKNESS_RANGE = { good: 21.0, bad: 17.3 } as const

/**
 * Core clearance ramp, degrees of sky between the measured ridge and the core
 * at its peak.
 *
 * `bad: 0` is the physical floor rather than a measured one — zero clearance is
 * the core sitting exactly on the ridge, and anything under it was hard-gated
 * out before the factors ever ran. `good: 10` is a SATURATION point, not the
 * observed maximum: past ~10° of sky above the ridge the ridge has stopped
 * being a consideration, and the frame's composition is the constraint.
 *
 * That deliberately flattens the top of the range. Of the eight candidates the
 * gate was validated against (`docs/ASTRO-HORIZON-RESEARCH.md` §4.1), five —
 * Munich 12.5°, Bayerischer Wald 11.9°, Herzogstand 11.8°, Eng 10.9°,
 * Alpenvorland 10.5° — all clamp to 1.0 and this factor says nothing between
 * them, which is correct: they all have plenty of sky. It separates the ones
 * that do not, Walchensee at 8.5° and Sylvenstein at 3.9°, and it is doing its
 * real work on a scouted coordinate the site table has never seen.
 */
export const CORE_CLEARANCE_RANGE = { good: 10, bad: 0 } as const

/**
 * Cloud cover, in percent, at which each layer has effectively taken the night.
 *
 * Low cloud is not linear in its damage: a 13° target is behind more air than a
 * zenith one, so 55% low cover already means the core is gone even though the
 * sky overhead may look workable. Mid cloud is nearly as bad; high cirrus only
 * costs contrast on long subs, so it grades all the way to 100%.
 */
export const CLOUD_RUINS_AT = { low: 55, mid: 80, high: 100 } as const

/**
 * Relative weights. Ratios are what matter — the engine normalises.
 *
 * Low cloud is heaviest because it kills a low target first; transparency is
 * second because "low haze is the enemy rather than the light dome";
 * `coreDarkness` sits below both for the same reason — the drive south buys
 * darkness, but darkness is not the binding constraint at 48°N. It holds the
 * weight the old hand-typed sky class had: the input got better, the reasoning
 * about its importance did not change.
 *
 * `coreClearance` sits level with `cloudMid`: both are "the core is basically
 * gone" factors rather than "some contrast is lost" ones, and clearance is the
 * one input here that is CERTAIN — geometry measured once from a DEM, not a
 * forecast that can be wrong tomorrow. It is not weighted above `cloudLow`,
 * because a night the ridge takes outright never reaches the factors at all;
 * this only grades how comfortable the clearance is on a night already through
 * the gate.
 */
export const ASTRO_WEIGHTS = {
  cloudLow: 5,
  transparency: 3,
  cloudMid: 2,
  coreClearance: 2,
  coreDarkness: 1.5,
  cloudHigh: 1,
} as const

export type AstroScoreInput = {
  night: AstroNight
  /** Mean low-cloud cover across the shooting window, percent. */
  cloudLow: number | null
  /** Mean mid-cloud cover across the shooting window, percent. */
  cloudMid: number | null
  /** Mean high-cloud cover across the shooting window, percent. */
  cloudHigh: number | null
  /** 7Timer transparency band, 1 (best) to 8 (worst). */
  transparency: number | null
  /**
   * Sky brightness where the galactic core sits, mag/arcsec² — higher is
   * darker. Measured per site, not judged; null when no site is close enough
   * for the number to mean anything about these coordinates.
   */
  coreDirectionMpsas: number | null
  /**
   * The night's peak core clearance above the measured ridge, degrees — mirrors
   * `AstroNight.peakCoreClearance`. Null when no terrain profile was supplied,
   * which drops the factor out of the score exactly like a missing weather
   * upstream — a flat gate has nothing certain to say about clearance.
   */
  coreClearanceDeg: number | null
}

/** Samples inside the recommended window, or inside darkness when there is no window. */
export function evaluationSamples(night: AstroNight): NightSample[] {
  if (night.window) {
    const { start, end } = night.window
    return night.samples.filter((s) => s.time >= start && s.time <= end)
  }
  return night.samples.filter((s) => s.astroDark)
}

/** Highest core altitude reached while it is astronomically dark. */
export function peakCoreAltitudeInDarkness(night: AstroNight): number | null {
  let peak: number | null = null
  for (const sample of night.samples) {
    if (!sample.astroDark) continue
    if (peak === null || sample.coreAltitude > peak) peak = sample.coreAltitude
  }
  return peak
}

/**
 * The measured ridge at the core's own azimuth, at the SAME instant
 * {@link peakCoreAltitudeInDarkness} reports — the core's best shot during
 * darkness, and what stood in its way. Null without a profile (`terrainAtCore`
 * is NaN on every sample) or with no dark samples at all.
 */
function terrainAtPeakCoreInDarkness(night: AstroNight): number | null {
  let peakAltitude = Number.NEGATIVE_INFINITY
  let ridge: number | null = null
  for (const sample of night.samples) {
    if (!sample.astroDark) continue
    if (sample.coreAltitude > peakAltitude) {
      peakAltitude = sample.coreAltitude
      ridge = Number.isNaN(sample.terrainAtCore) ? null : sample.terrainAtCore
    }
  }
  return ridge
}

/** Highest moon altitude across the evaluation window. */
export function peakMoonAltitude(night: AstroNight): number | null {
  const samples = evaluationSamples(night)
  if (samples.length === 0) return null
  return samples.reduce((max, s) => (s.moonAltitude > max ? s.moonAltitude : max), -90)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export const astroWindowConfig: WindowConfig<AstroScoreInput> = {
  gates: [
    {
      id: 'darkness',
      label: 'Astronomical darkness',
      evaluate: ({ night }) => {
        if (night.darkMinutes > 0) return { passes: true }
        return {
          passes: false,
          reason:
            'no astronomical night — the sun never drops below −18° at this latitude on this date',
        }
      },
    },
    {
      id: 'core-altitude',
      label: 'Core altitude',
      evaluate: ({ night }) => {
        // A missing dark stretch is the darkness gate's problem, not this one.
        if (night.darkMinutes === 0) return { passes: true }
        // `sample.coreUp` already carries the terrain-aware per-sample floor
        // (`astro-night.ts`'s `resolveNight`) when a profile was supplied — this
        // gate reads that flag rather than re-deriving `MIN_CORE_ALTITUDE`
        // itself, so it never disagrees with the samples the rest of the
        // response is built from.
        if (night.samples.some((sample) => sample.astroDark && sample.coreUp)) {
          return { passes: true }
        }
        const peak = peakCoreAltitudeInDarkness(night)
        if (peak === null) {
          return { passes: false, reason: 'the core never rises while it is dark' }
        }
        /*
         * Name the ridge ONLY when the ridge is what actually blocked the core.
         * A profile being present is not enough: at all four committed sites the
         * southern skyline is under 6°, so the 8° atmospheric floor is the
         * tighter one, and every December night — where the core peaks around
         * −20° and is nowhere near up — would otherwise be reported as "the
         * ridge to the south stands at 0.2°", which is false twice over.
         */
        const ridge = terrainAtPeakCoreInDarkness(night)
        const ridgeBinds =
          ridge !== null &&
          ridge + FRAMING_MARGIN_DEG > MIN_CORE_ALTITUDE &&
          peak > MIN_CORE_ALTITUDE
        if (ridgeBinds) {
          return {
            passes: false,
            reason: `the ridge to the south stands at ${round1(ridge)}° — the core peaks at ${round1(peak)}° and never clears it`,
          }
        }
        return {
          passes: false,
          reason: `core peaks at ${round1(peak)}° during darkness, below the ${MIN_CORE_ALTITUDE}° floor`,
        }
      },
    },
    {
      id: 'moon',
      label: 'Moon',
      evaluate: ({ night }) => {
        // Same short-circuit as the core gate: with no darkness at all there is
        // no window for the moon to be in, and listing it is noise on top of a
        // night that is already over.
        if (night.darkMinutes === 0) return { passes: true }
        const illumination = night.moonIllumination
        if (illumination < MAX_MOON_ILLUMINATION) return { passes: true }
        // A bright moon is survivable if it stays under the horizon OR behind
        // the measured ridge the whole window — `moonBehindTerrain || altitude
        // < 0`, not `altitude < 0` alone, so a ridge that blocks the moon gets
        // the same credit the earth's own curvature already got.
        const troublesome = evaluationSamples(night).some(
          (sample) => sample.moonAltitude >= 0 && !sample.moonBehindTerrain,
        )
        if (!troublesome) return { passes: true }
        const peak = peakMoonAltitude(night)
        const percent = Math.round(illumination * 100)
        return {
          passes: false,
          reason:
            peak === null
              ? `moon ${percent}% illuminated`
              : `moon ${percent}% illuminated and up to ${round1(peak)}° above the horizon during the window`,
        }
      },
    },
  ],
  factors: [
    {
      id: 'cloud-low',
      label: 'Low cloud',
      weight: ASTRO_WEIGHTS.cloudLow,
      value: (input) => linearScore(input.cloudLow, { good: 0, bad: CLOUD_RUINS_AT.low }),
      detail: (input) => (input.cloudLow === null ? undefined : `${Math.round(input.cloudLow)}%`),
    },
    {
      id: 'transparency',
      label: 'Transparency',
      weight: ASTRO_WEIGHTS.transparency,
      value: (input) => bandScore(input.transparency, WORST_TRANSPARENCY_BAND),
      detail: (input) => (input.transparency === null ? undefined : `band ${input.transparency}/8`),
    },
    {
      id: 'cloud-mid',
      label: 'Mid cloud',
      weight: ASTRO_WEIGHTS.cloudMid,
      value: (input) => linearScore(input.cloudMid, { good: 0, bad: CLOUD_RUINS_AT.mid }),
      detail: (input) => (input.cloudMid === null ? undefined : `${Math.round(input.cloudMid)}%`),
    },
    {
      id: 'core-clearance',
      label: 'Core clearance',
      weight: ASTRO_WEIGHTS.coreClearance,
      value: (input) => linearScore(input.coreClearanceDeg, CORE_CLEARANCE_RANGE),
      detail: (input) =>
        input.coreClearanceDeg === null ? undefined : `${round1(input.coreClearanceDeg)}° clear`,
    },
    {
      id: 'core-darkness',
      label: 'Core darkness',
      weight: ASTRO_WEIGHTS.coreDarkness,
      value: (input) => linearScore(input.coreDirectionMpsas, CORE_DARKNESS_RANGE),
      detail: (input) =>
        input.coreDirectionMpsas === null
          ? undefined
          : `${input.coreDirectionMpsas.toFixed(2)} mag/arcsec²`,
    },
    {
      id: 'cloud-high',
      label: 'High cloud',
      weight: ASTRO_WEIGHTS.cloudHigh,
      value: (input) => linearScore(input.cloudHigh, { good: 0, bad: CLOUD_RUINS_AT.high }),
      detail: (input) => (input.cloudHigh === null ? undefined : `${Math.round(input.cloudHigh)}%`),
    },
  ],
}
