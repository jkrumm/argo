/**
 * Terrain horizon profiles — how high the ground stands around a site, per
 * azimuth, from a digital elevation model.
 *
 * At 48°N the galactic core peaks at 12–13° and every frame points into the
 * 8–14° band due south, so a 6° ridge is not scenery: it is a hard gate the
 * scorer had no input for at all. This module answers "how much of that band
 * does the ground already occupy". The four shipped sites answer it once and
 * commit the result (`docs/ASTRO-MAP-RESEARCH.md` §3) because mountains do not
 * move and re-computing on every request would be pure waste — but the same
 * question is also answerable for an arbitrary coordinate at request time
 * (`GET /astro/horizon`, `docs/ASTRO-HORIZON-RESEARCH.md`), which is why this
 * module takes no position on caching or committing; that is the caller's call.
 *
 * Pure geometry with an INJECTED elevation sampler — the tile fetching, PNG
 * decode and caching are a separate concern the sampler hides. Two callers use
 * that seam for two different reasons: `../../scripts/gen-astro-sites.ts`
 * reads a disk-cached DEM once per atlas vintage to produce the four committed
 * site constants, and `../clients/terrarium-dem.ts` reads the same AWS tiles
 * at request time to answer `GET /astro/horizon` for an arbitrary coordinate
 * (`docs/ASTRO-HORIZON-RESEARCH.md`). Neither caller's I/O belongs in this
 * file — it is what makes the maths testable against a synthetic ridge
 * instead of against the Alps.
 *
 * The reference implementation this ports is `docs/poc/astro-map/horizon.py`,
 * which produced every number in §3; the near/far split and `horizonAt` below
 * port `docs/poc/astro-horizon/` (§3, §6 of the horizon research doc).
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

/**
 * Ray distance below which a "horizon" is your own hillside plus DEM noise,
 * not a skyline (`docs/ASTRO-HORIZON-RESEARCH.md` §3). At 76 m/px a sample
 * 150 m away is two pixels of your own hillside plus the model's vertical
 * error — z11 and z12 disagree there by up to 0.96°. Beyond 500 m they agree
 * to ≤0.08°. A real cliff at 300 m IS a skyline though, so the near band is
 * not dropped — it ships alongside `altitudeDeg` as `nearAltitudeDeg`,
 * flagged advisory, and nothing scores it.
 */
export const NEAR_FIELD_M = 500

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
  /** Skyline — highest obstruction BEYOND `NEAR_FIELD_M`. The only band anything scores. */
  altitudeDeg: number
  /** Range to the obstruction that set `altitudeDeg`, metres. */
  rangeM: number
  /** Elevation of that obstruction, metres. */
  summitM: number
  /** Highest ground WITHIN `NEAR_FIELD_M`. Advisory: DEM-unstable at this range. */
  nearAltitudeDeg: number
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
    // Two independent maxima over the SAME march: `bestFar` is the skyline
    // everything downstream scores, `bestNear` is advisory local ground. One
    // ray must never contribute to both — a near sample winning `bestFar` (or
    // vice versa) would silently blend the two measurements the split exists
    // to keep apart.
    let bestFar: HorizonPoint = {
      azimuthDeg,
      altitudeDeg: NO_DATA_ALTITUDE_DEG,
      rangeM: 0,
      summitM: Number.NaN,
      nearAltitudeDeg: NO_DATA_ALTITUDE_DEG,
    }
    let bestNearAltitudeDeg = NO_DATA_ALTITUDE_DEG

    for (let rangeM = HORIZON_STEP_M; rangeM <= HORIZON_RANGE_M; rangeM += HORIZON_STEP_M) {
      const lat = site.lat + (rangeM * Math.cos(azimuth)) / M_PER_DEG_LAT
      const lon = site.lon + (rangeM * Math.sin(azimuth)) / mPerDegLon
      const summitM = sampler(lat, lon)

      const drop = (rangeM * rangeM) / (2 * EFFECTIVE_EARTH_RADIUS_M)
      const altitudeDeg =
        Number.isFinite(summitM) && Number.isFinite(elevationM)
          ? toDegrees(Math.atan2(summitM - elevationM - drop, rangeM))
          : NO_DATA_ALTITUDE_DEG

      if (rangeM <= NEAR_FIELD_M) {
        if (altitudeDeg > bestNearAltitudeDeg) bestNearAltitudeDeg = altitudeDeg
      } else if (altitudeDeg > bestFar.altitudeDeg) {
        bestFar = {
          azimuthDeg,
          altitudeDeg,
          rangeM,
          summitM,
          nearAltitudeDeg: NO_DATA_ALTITUDE_DEG,
        }
      }
    }

    points.push({ ...bestFar, nearAltitudeDeg: bestNearAltitudeDeg })
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

/**
 * Skyline altitude at an arbitrary bearing, linearly interpolated between the
 * profile's samples and wrapping across 360°→0°. Every later consumer of a
 * horizon profile (scoring at the core's own azimuth, the panorama chart,
 * click-anywhere map scouting) reads through this rather than re-deriving its
 * own interpolation — port of `docs/poc/astro-horizon/sites.ts`'s `horizonAt`.
 *
 * Does not assume a fixed azimuth step: the span between two neighbours is
 * read from their own `azimuthDeg` values, so a profile with irregular
 * spacing (or a single point) still interpolates correctly.
 */
export function horizonAt(points: readonly HorizonPoint[], azimuthDeg: number): number {
  const az = ((azimuthDeg % 360) + 360) % 360
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    const span = (b.azimuthDeg - a.azimuthDeg + 360) % 360
    const offset = (az - a.azimuthDeg + 360) % 360
    if (offset <= span && span > 0) {
      return a.altitudeDeg + ((b.altitudeDeg - a.altitudeDeg) * offset) / span
    }
  }
  return points[0]!.altitudeDeg
}
