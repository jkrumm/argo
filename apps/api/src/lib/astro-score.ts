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

import type { AstroNight, NightSample } from './astro-night.js'
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

/** Bortle runs 1 (pristine) to 9 (inner city). Munich is 8; the Alpenvorland is 4. */
export const WORST_BORTLE_CLASS = 9

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
 * second because "low haze is the enemy rather than the light dome"; Bortle
 * sits below both for the same reason — the drive south buys darkness, but
 * darkness is not the binding constraint at 48°N.
 */
export const ASTRO_WEIGHTS = {
  cloudLow: 5,
  transparency: 3,
  cloudMid: 2,
  bortle: 1.5,
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
  /** Bortle class of the observing site, 1 (pristine) to 9 (inner city). */
  bortle: number | null
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
        const peak = peakCoreAltitudeInDarkness(night)
        if (peak !== null && peak > MIN_CORE_ALTITUDE) return { passes: true }
        return {
          passes: false,
          reason:
            peak === null
              ? 'the core never rises while it is dark'
              : `core peaks at ${round1(peak)}° during darkness, below the ${MIN_CORE_ALTITUDE}° floor`,
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
        const peak = peakMoonAltitude(night)
        // A bright moon is survivable if it is under the horizon the whole time.
        if (peak !== null && peak < 0) return { passes: true }
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
      id: 'bortle',
      label: 'Sky darkness',
      weight: ASTRO_WEIGHTS.bortle,
      value: (input) => bandScore(input.bortle, WORST_BORTLE_CLASS),
      detail: (input) => (input.bortle === null ? undefined : `Bortle ${input.bortle}`),
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
