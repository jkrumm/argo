/**
 * Terrain horizon profiles — how high the ground stands around a site, per
 * azimuth, from a digital elevation model.
 *
 * At 48°N the galactic core peaks at 12–13° and every frame points into the
 * 8–14° band due south, so a 6° ridge is not scenery: it is a hard gate the
 * scorer had no input for at all. This module answers "how much of that band
 * does the ground already occupy", once per site — light pollution moves
 * yearly, mountains do not move at all, so the result is a committed constant
 * (`docs/ASTRO-MAP-RESEARCH.md` §3), not a per-request computation.
 *
 * Pure geometry with an INJECTED elevation sampler. The tile fetching, the PNG
 * decode and the disk cache live in `../../scripts/gen-astro-sites.ts`, which
 * is the only thing that ever needs them — nothing that ships reads a DEM tile.
 * That seam is also what makes the maths testable against a synthetic ridge
 * instead of against the Alps.
 *
 * The reference implementation this ports is `docs/poc/astro-map/horizon.py`,
 * which produced every number in §3.
 */

/**
 * Mapzen/AWS terrarium encoding: elevation in metres from one RGB triple.
 *
 * The `B/256` term is a genuine fractional part, not a rounding artifact — the
 * encoding carries 1/256 m of precision — and the `-32768` offset is what lets
 * it represent bathymetry. Dropping either silently shifts every summit.
 */
export function terrariumElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

/** Ground elevation in metres at a coordinate. NaN where the model has no data. */
export type ElevationSampler = (lat: number, lon: number) => number

/**
 * DEM zoom the profile is measured at — ~76 m/px at 48°N, matching the
 * reference run. Higher zoom resolves a ridge line no better than the source
 * SRTM/EU-DEM data behind it does, and multiplies the tiles to fetch by four.
 */
export const HORIZON_DEM_ZOOM = 11

/** How far a ray reaches, metres. Beyond ~60 km curvature has buried everything below 1 km. */
export const HORIZON_RANGE_M = 60_000

/** Sampling step along a ray, metres — about two DEM pixels at z11. */
export const HORIZON_STEP_M = 150

/** Azimuth resolution of the profile, degrees. 72 rays around the compass. */
export const HORIZON_AZIMUTH_STEP_DEG = 5

/**
 * Standard atmospheric refraction coefficient. Light bends toward the ground,
 * so the effective earth radius is larger than the geometric one:
 * `R_eff = R_earth / (1 - k)`. Ignoring it under-reports distant summits.
 */
export const REFRACTION_K = 0.13

const EARTH_RADIUS_M = 6_371_000
const EFFECTIVE_EARTH_RADIUS_M = EARTH_RADIUS_M / (1 - REFRACTION_K)

/** Metres per degree of latitude — the reference's own figure, kept for bit-comparability. */
const M_PER_DEG_LAT = 111_320

/**
 * The altitude an unsampled cell contributes. NOT zero: a NaN dropped as 0°
 * would read as a wall exactly at eye level and win every `max`, so a hole in
 * the DEM would manufacture the highest horizon at the site. −90° is the one
 * value that can never win, i.e. "this sample tells us nothing".
 */
const NO_DATA_ALTITUDE_DEG = -90

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}

export type HorizonPoint = {
  azimuthDeg: number
  /** Apparent altitude of the highest obstruction along this azimuth, degrees. */
  altitudeDeg: number
  /** Range to the obstruction that set `altitudeDeg`, metres. */
  rangeM: number
  /** Elevation of that obstruction, metres. */
  summitM: number
}

export type HorizonProfile = {
  /** DEM elevation of the site itself, metres. */
  elevationM: number
  /** One entry per azimuth, ascending from 0°. */
  points: HorizonPoint[]
}

/**
 * The full horizon profile around a site.
 *
 *   drop(r)     = r² / (2·R_eff)                    — curvature, refraction-corrected
 *   angle(r)    = atan2(h(r) − h₀ − drop(r), r)     — apparent altitude of that sample
 *   horizon(az) = max over r of angle(r)
 *
 * A flat plane therefore reports a slightly NEGATIVE horizon rather than 0°,
 * which is correct: from any height the true horizon is depressed below the
 * astronomical one. If this ever reads exactly 0.0 on flat ground, the
 * curvature term has stopped being applied.
 */
export function horizonProfile(args: {
  sampler: ElevationSampler
  site: { lat: number; lon: number }
}): HorizonProfile {
  const { sampler, site } = args
  const elevationM = sampler(site.lat, site.lon)
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(toRadians(site.lat))

  const points: HorizonPoint[] = []

  for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += HORIZON_AZIMUTH_STEP_DEG) {
    const azimuth = toRadians(azimuthDeg)
    let best: HorizonPoint = {
      azimuthDeg,
      altitudeDeg: NO_DATA_ALTITUDE_DEG,
      rangeM: 0,
      summitM: Number.NaN,
    }

    for (let rangeM = HORIZON_STEP_M; rangeM <= HORIZON_RANGE_M; rangeM += HORIZON_STEP_M) {
      const lat = site.lat + (rangeM * Math.cos(azimuth)) / M_PER_DEG_LAT
      const lon = site.lon + (rangeM * Math.sin(azimuth)) / mPerDegLon
      const summitM = sampler(lat, lon)

      const drop = (rangeM * rangeM) / (2 * EFFECTIVE_EARTH_RADIUS_M)
      const altitudeDeg =
        Number.isFinite(summitM) && Number.isFinite(elevationM)
          ? toDegrees(Math.atan2(summitM - elevationM - drop, rangeM))
          : NO_DATA_ALTITUDE_DEG

      if (altitudeDeg > best.altitudeDeg) best = { azimuthDeg, altitudeDeg, rangeM, summitM }
    }

    points.push(best)
  }

  return { elevationM, points }
}

/**
 * The southern arc the core actually crosses at this latitude — it rises in the
 * SE, transits due south and sets in the SW, and the usable part of that path
 * lives between these two bearings. A whole-compass max would be dominated by
 * ridges the camera never points at (Walchensee's 34° NW wall is *good* news
 * here: it eats the Munich dome).
 */
export const SOUTH_ARC = { fromDeg: 150, toDeg: 215 } as const

/**
 * Max and mean horizon altitude over `SOUTH_ARC`. Max is the gate — it is the
 * ridge that can hide the core outright — and mean describes how walled-in the
 * whole southern sweep is.
 */
export function southernHorizon(profile: HorizonProfile): { maxDeg: number; meanDeg: number } {
  const arc = profile.points.filter(
    (point) => point.azimuthDeg >= SOUTH_ARC.fromDeg && point.azimuthDeg <= SOUTH_ARC.toDeg,
  )
  if (arc.length === 0) return { maxDeg: Number.NaN, meanDeg: Number.NaN }

  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  for (const point of arc) {
    if (point.altitudeDeg > max) max = point.altitudeDeg
    sum += point.altitudeDeg
  }

  return { maxDeg: max, meanDeg: sum / arc.length }
}
