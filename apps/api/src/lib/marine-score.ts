/**
 * The marine instantiation of the {@link scoreWindow} engine — the second
 * config over the same machinery astro uses, and the proof that the engine is
 * genuinely domain-agnostic. Nothing here imports anything astro; nothing in
 * `window-score.ts` knows about either.
 *
 * The physics the thresholds encode:
 *
 * - **Period is the quality axis, not height.** A 1 m swell at 14 s carries far
 *   more energy and breaks far better than a 1 m sea at 5 s, which is just
 *   local wind chop that happens to be the same height. Everything under ~8 s
 *   is windsea, not groundswell, and is gated out rather than scored low.
 * - **Wind direction beats wind speed.** 15 knots offshore grooms a wave; 15
 *   knots onshore destroys it. The gate is on direction; speed is a factor.
 * - **Height has a sweet spot, not a direction.** Too small is nothing to ride,
 *   too big closes out — which is why the engine needed `peakScore`.
 */

import { classifyWind, swellAlignment, type MarineSpot } from './marine-spots.js'
import { linearScore, peakScore, type WindowConfig } from './window-score.js'

/** Below this the swell is local windsea, not groundswell. Seconds. */
export const MIN_SWELL_PERIOD_S = 8

/** Nothing to ride below, a different sport above. Metres of significant wave height. */
export const RIDEABLE_HEIGHT_M = { min: 0.5, max: 4 } as const

/**
 * How far off dead-offshore the wind may sit before it is disqualifying.
 * 60° is the conventional offshore/cross-shore boundary.
 */
export const MAX_WIND_OFF_AXIS_DEG = 60

/**
 * Below this the wind is not strong enough to matter and its direction stops
 * being disqualifying — the glassy-morning exemption. Knots.
 */
export const GLASSY_WIND_KN = 5

/** Swell height sweet spot. Asymmetric: undersized is worse than oversized. */
export const IDEAL_SWELL_HEIGHT = { ideal: 1.5, below: 1.1, above: 2.5 } as const

/** Period beyond which more is not better in any practical sense. Seconds. */
export const GREAT_SWELL_PERIOD_S = 14

/** Wind speed at which even a perfectly offshore breeze has become a nuisance. Knots. */
export const RUINOUS_WIND_KN = 30

/**
 * Relative weights. Period is heaviest for the reason in the module docstring;
 * wind direction is second because it is the difference between a clean face
 * and mush; height third; raw wind speed and swell alignment behind them.
 */
export const MARINE_WEIGHTS = {
  swellPeriod: 5,
  windDirection: 3.5,
  swellHeight: 2.5,
  windSpeed: 1.5,
  swellAlignment: 1.5,
} as const

export type MarineScoreInput = {
  spot: Pick<MarineSpot, 'shoreNormal'>
  /** Mean significant swell height across the session window, metres. */
  swellHeight: number | null
  /** Mean swell period across the window, seconds. */
  swellPeriod: number | null
  /** Mean swell direction across the window, degrees the swell comes FROM. */
  swellDirection: number | null
  /** Mean wind speed across the window, knots. */
  windSpeed: number | null
  /** Mean wind direction across the window, degrees the wind comes FROM. */
  windDirection: number | null
  /** Mean total significant wave height, metres — used only by the size gate. */
  waveHeight: number | null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Wind quality for an input, or null when either half of the reading is missing. */
export function windQuality(input: MarineScoreInput) {
  if (input.windDirection === null) return null
  return classifyWind(input.windDirection, input.spot.shoreNormal)
}

export const marineWindowConfig: WindowConfig<MarineScoreInput> = {
  gates: [
    {
      id: 'swell-period',
      label: 'Swell period',
      evaluate: (input) => {
        // No reading is not a failure — the factor layer degrades `coverage`
        // instead. Only an actual, measured, too-short period gates.
        if (input.swellPeriod === null) return { passes: true }
        if (input.swellPeriod >= MIN_SWELL_PERIOD_S) return { passes: true }
        return {
          passes: false,
          reason: `${round1(input.swellPeriod)} s period — windsea, not groundswell (needs ${MIN_SWELL_PERIOD_S} s)`,
        }
      },
    },
    {
      id: 'wave-height',
      label: 'Wave height',
      evaluate: (input) => {
        const height = input.waveHeight ?? input.swellHeight
        if (height === null) return { passes: true }
        if (height < RIDEABLE_HEIGHT_M.min) {
          return { passes: false, reason: `${round1(height)} m — flat` }
        }
        if (height > RIDEABLE_HEIGHT_M.max) {
          return {
            passes: false,
            reason: `${round1(height)} m — over the ${RIDEABLE_HEIGHT_M.max} m ceiling`,
          }
        }
        return { passes: true }
      },
    },
    {
      id: 'wind-direction',
      label: 'Wind',
      evaluate: (input) => {
        const wind = windQuality(input)
        if (!wind) return { passes: true }
        // Under the glassy threshold the wind is too weak to shape anything, so
        // its direction stops mattering. This is what keeps a still dawn from
        // being ruled out by a 2-knot onshore drift.
        if (input.windSpeed !== null && input.windSpeed < GLASSY_WIND_KN) return { passes: true }
        if (wind.offAxis <= MAX_WIND_OFF_AXIS_DEG) return { passes: true }
        return {
          passes: false,
          reason: `${wind.kind} wind, ${Math.round(wind.offAxis)}° off offshore${
            input.windSpeed === null ? '' : ` at ${round1(input.windSpeed)} kn`
          }`,
        }
      },
    },
  ],
  factors: [
    {
      id: 'swell-period',
      label: 'Swell period',
      weight: MARINE_WEIGHTS.swellPeriod,
      // good > bad inverts the ramp: more period is better, up to the point
      // where more stops mattering.
      value: (input) =>
        linearScore(input.swellPeriod, { good: GREAT_SWELL_PERIOD_S, bad: MIN_SWELL_PERIOD_S }),
      detail: (input) =>
        input.swellPeriod === null ? undefined : `${round1(input.swellPeriod)} s`,
    },
    {
      id: 'wind-direction',
      label: 'Wind direction',
      weight: MARINE_WEIGHTS.windDirection,
      value: (input) => windQuality(input)?.quality ?? null,
      detail: (input) => {
        const wind = windQuality(input)
        return wind ? `${wind.kind}, ${Math.round(wind.offAxis)}° off` : undefined
      },
    },
    {
      id: 'swell-height',
      label: 'Swell height',
      weight: MARINE_WEIGHTS.swellHeight,
      value: (input) => peakScore(input.swellHeight, IDEAL_SWELL_HEIGHT),
      detail: (input) =>
        input.swellHeight === null ? undefined : `${round1(input.swellHeight)} m`,
    },
    {
      id: 'wind-speed',
      label: 'Wind speed',
      weight: MARINE_WEIGHTS.windSpeed,
      value: (input) => linearScore(input.windSpeed, { good: 0, bad: RUINOUS_WIND_KN }),
      detail: (input) => (input.windSpeed === null ? undefined : `${round1(input.windSpeed)} kn`),
    },
    {
      id: 'swell-alignment',
      label: 'Swell angle',
      weight: MARINE_WEIGHTS.swellAlignment,
      value: (input) =>
        input.swellDirection === null
          ? null
          : swellAlignment(input.swellDirection, input.spot.shoreNormal),
      detail: (input) =>
        input.swellDirection === null ? undefined : `from ${Math.round(input.swellDirection)}°`,
    },
  ],
}
