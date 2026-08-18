/**
 * The annual visibility budget — "is this spot worth the drive AT ALL", as
 * opposed to `astro-night.ts`'s "is tonight worth going out for". Deterministic
 * and weather-free: given a latitude, an optional skyline and a year, this
 * integrates a whole year of samples under three progressively honest gates
 * and returns how many minutes the galactic core was actually shootable.
 * Pure computation — no I/O.
 *
 * Port of `docs/poc/astro-horizon/visibility.ts` and `binding.ts`, not a new
 * derivation — every number in `docs/ASTRO-HORIZON-RESEARCH.md` §4 reproduces
 * from those two scripts. The gate is `max(atmosphericFloor, skyline(coreAz) +
 * framingMargin)` (`binding.ts`), and the refraction convention is theirs too:
 * the sun altitude is geometric (every twilight definition is), the moon
 * carries `'normal'` refraction, and the skyline already carries terrestrial
 * refraction at k = 0.13 (`terrain-horizon.ts`). Comparing a refracted moon
 * against a refracted ridge is the consistent pair (§4.2).
 *
 * Sun altitude is checked FIRST and the loop `continue`s on a bright sky: only
 * ~31% of a year's samples are astronomically dark, and computing the moon,
 * its illumination and the core for the other 69% would triple the cost of an
 * integral that already walks 52,560 samples a year at the shipped 10-minute
 * grid. Measured in Bun: a whole year at 10 minutes runs 373 ms and lands
 * within 0.4% of a 2-minute reference grid (Munich 113.8 vs 113.3 h/yr,
 * Walchensee 134.2 vs 134.2 h/yr), where a 30-minute grid drifts ~2.7% — 10
 * minutes is the shipped tradeoff (§4.3).
 */

import { galacticCorePosition, type Observer } from './astro-ephemeris.js'
import {
  ASTRO_DARK_SUN_ALTITUDE,
  FRAMING_MARGIN_DEG,
  moonHorizontal,
  moonIlluminationFraction,
  sunAltitudeDeg,
} from './astro-night.js'
import { MAX_MOON_ILLUMINATION, MIN_CORE_ALTITUDE } from './astro-score.js'
import { horizonDegAt } from './terrain-horizon.js'

const MS_PER_MINUTE = 60_000

/** Sample spacing for the annual integral, minutes — within 0.4% of a 2-minute reference grid. */
export const VISIBILITY_STEP_MINUTES = 10

/**
 * Same ceiling `astro-score.ts` gates a single night on, re-exported under its
 * own name so a caller of this module never has to import astro-score just for
 * one constant.
 */
export const VISIBILITY_MAX_MOON_ILLUMINATION = MAX_MOON_ILLUMINATION

export type VisibilityGate = {
  /** Total minutes in the year meeting this gate. */
  minutes: number
  /** Minutes per calendar month, index 0 = January. Always length 12. */
  byMonth: number[]
}

export type AnnualVisibility = {
  year: number
  /** Minutes of astronomical night in the year — the ceiling everything else sits under. */
  darkMinutes: number
  /** Core above the flat atmospheric floor, moon down at 0° or under the illumination ceiling. */
  flat: VisibilityGate
  /** …and above `max(atmosphericFloor, skyline(coreAz) + framingMargin)`. Equals `flat` without a skyline. */
  terrain: VisibilityGate
  /** …and the moon also counts as down when it sits behind the skyline at its own azimuth. */
  terrainMoon: VisibilityGate
  /** Highest core altitude reached during darkness, degrees. */
  peakCoreAltitudeDeg: number
  /**
   * Highest core clearance above the skyline, degrees, measured only at moments
   * the core ALSO clears `atmosphericFloorDeg` — a wide margin over the ridge at
   * an altitude the atmosphere has already ruled out is not a usable margin, and
   * every other figure here counts usable time. Null without a skyline, or when
   * the core never cleared the floor during darkness all year.
   */
  peakClearanceDeg: number | null
  /** ISO date of `peakClearanceDeg`. Null on the same conditions. */
  peakClearanceDate: string | null
  /** Share of flat-gate minutes where the skyline plus margin was the tighter floor, 0..1. */
  terrainBindsFraction: number
}

function emptyMonths(): number[] {
  return Array.from({ length: 12 }, () => 0)
}

/**
 * Integrate one calendar year of `stepMinutes` samples into the three gates
 * described on {@link AnnualVisibility}.
 *
 * Observer ELEVATION is deliberately not an input. `sunAltitudeDeg` and
 * `moonHorizontal` fix the observer at sea level by design (astro-night.ts:
 * "the API contract carries lat/lon only"), so an elevation argument here
 * would be one a caller could pass and never affect the answer. The skyline
 * carries the site's height already — every altitude in `horizonDeg` was
 * measured relative to the observer's own DEM elevation.
 */
export function annualVisibility(args: {
  observer: Observer
  year: number
  horizonDeg?: readonly number[] | undefined
  atmosphericFloorDeg?: number | undefined
  framingMarginDeg?: number | undefined
  stepMinutes?: number | undefined
}): AnnualVisibility {
  const { observer, year } = args
  /*
   * Length-checked, not truthiness-checked — the same reason `resolveNight`
   * guards `horizonDeg` in astro-night.ts: `[]` is truthy, and `horizonDegAt`
   * returns NaN for it, which would poison every floor/clearance comparison
   * for the whole year silently.
   */
  const horizonDeg =
    args.horizonDeg !== undefined && args.horizonDeg.length > 0 ? args.horizonDeg : undefined
  const atmosphericFloorDeg = args.atmosphericFloorDeg ?? MIN_CORE_ALTITUDE
  const framingMarginDeg = args.framingMarginDeg ?? FRAMING_MARGIN_DEG
  const stepMinutes = args.stepMinutes ?? VISIBILITY_STEP_MINUTES

  let darkMinutes = 0
  let flatMinutes = 0
  let terrainMinutes = 0
  let terrainMoonMinutes = 0
  let terrainBindsMinutes = 0
  const flatByMonth = emptyMonths()
  const terrainByMonth = emptyMonths()
  const terrainMoonByMonth = emptyMonths()

  let peakCoreAltitudeDeg = -90
  let peakClearanceDeg = -90
  let peakClearanceDate: string | null = null

  const start = Date.UTC(year, 0, 1)
  const end = Date.UTC(year + 1, 0, 1)
  for (let t = start; t < end; t += stepMinutes * MS_PER_MINUTE) {
    const time = new Date(t)

    // Sun altitude first — see the module docstring for why the other ~69% of
    // samples never reach the moon/core/illumination calls below.
    if (sunAltitudeDeg(time, observer) >= ASTRO_DARK_SUN_ALTITUDE) continue
    darkMinutes += stepMinutes

    const core = galacticCorePosition(observer, time)
    if (core.altitude > peakCoreAltitudeDeg) peakCoreAltitudeDeg = core.altitude

    const ridgeAtCore = horizonDeg ? horizonDegAt(horizonDeg, core.azimuth) : undefined
    const clearance = ridgeAtCore !== undefined ? core.altitude - ridgeAtCore : undefined
    /*
     * Conditioned on the atmospheric floor, matching `binding.ts` — without it a
     * walled site reports its best margin from a moment the core sat below 8°
     * and was unusable anyway. Wallberg summit reads 4.0° unconditioned against
     * the published 3.3° (`docs/ASTRO-HORIZON-RESEARCH.md` §4.1), and it is the
     * heavily-walled sites, where this number carries the most weight, that the
     * unconditioned form flatters.
     */
    if (
      clearance !== undefined &&
      core.altitude >= atmosphericFloorDeg &&
      clearance > peakClearanceDeg
    ) {
      peakClearanceDeg = clearance
      peakClearanceDate = time.toISOString().slice(0, 10)
    }

    const moon = moonHorizontal(time, observer)
    const illuminated = moonIlluminationFraction(time)
    const moonFlatDown = moon.altitude < 0 || illuminated <= VISIBILITY_MAX_MOON_ILLUMINATION

    // Strictly ABOVE 0° and below the ridge — same rule as `resolveNight`'s
    // `moonBehindTerrain` in astro-night.ts. Below 0° the earth already did
    // the work, and crediting terrain there would count something it did not do.
    const ridgeAtMoon = horizonDeg ? horizonDegAt(horizonDeg, moon.azimuth) : undefined
    const moonBehindTerrain =
      ridgeAtMoon !== undefined && moon.altitude > 0 && moon.altitude < ridgeAtMoon
    const moonTerrainDown =
      moon.altitude < 0 || moonBehindTerrain || illuminated <= VISIBILITY_MAX_MOON_ILLUMINATION

    const geometricFloorDeg =
      ridgeAtCore !== undefined ? ridgeAtCore + framingMarginDeg : Number.NEGATIVE_INFINITY
    const floorDeg = Math.max(atmosphericFloorDeg, geometricFloorDeg)

    // UTC month, deliberately — a year boundary in a local timezone is not
    // worth the complexity for an annual statistic (matches the POC).
    const month = time.getUTCMonth()

    if (core.altitude >= atmosphericFloorDeg && moonFlatDown) {
      flatMinutes += stepMinutes
      flatByMonth[month]! += stepMinutes
      if (geometricFloorDeg > atmosphericFloorDeg) terrainBindsMinutes += stepMinutes
    }
    if (core.altitude >= floorDeg && moonFlatDown) {
      terrainMinutes += stepMinutes
      terrainByMonth[month]! += stepMinutes
    }
    if (core.altitude >= floorDeg && moonTerrainDown) {
      terrainMoonMinutes += stepMinutes
      terrainMoonByMonth[month]! += stepMinutes
    }
  }

  return {
    year,
    darkMinutes,
    flat: { minutes: flatMinutes, byMonth: flatByMonth },
    terrain: { minutes: terrainMinutes, byMonth: terrainByMonth },
    terrainMoon: { minutes: terrainMoonMinutes, byMonth: terrainMoonByMonth },
    peakCoreAltitudeDeg,
    // `peakClearanceDate` stays null exactly when nothing ever set the peak,
    // so it is the honest test for "the core never cleared the floor all year".
    peakClearanceDeg: horizonDeg && peakClearanceDate !== null ? peakClearanceDeg : null,
    peakClearanceDate: horizonDeg ? peakClearanceDate : null,
    terrainBindsFraction: flatMinutes > 0 ? terrainBindsMinutes / flatMinutes : 0,
  }
}
