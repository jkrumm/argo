/**
 * Galactic-core ephemeris — pure spherical trigonometry, no dependencies.
 *
 * The one target that matters for Munich nightscapes is Sagittarius A*, the
 * galactic centre. Its J2000 position is fixed, so "where is the core?" reduces
 * to precession + sidereal time + a horizontal-coordinate rotation. That is
 * about sixty lines of arithmetic and needs neither Skyfield nor Astropy, both
 * of which would drag Python into a Bun stack.
 *
 * Accuracy budget, against Stellarium/PhotoPills for a 2020s date:
 *
 * | Term | Magnitude | Handled |
 * |-|-|-|
 * | Precession J2000 → date | ~0.4° by 2026 | yes, IAU 1976 ζ/z/θ rotation |
 * | Atmospheric refraction near the horizon | ~0.1° at 13° alt | yes, Bennett |
 * | Nutation | ≤ 0.006° | no — 80× under tolerance |
 * | Annual aberration | ≤ 0.006° | no — 80× under tolerance |
 * | Diurnal parallax | 0° (infinitely distant) | n/a |
 *
 * The acceptance tolerance is 0.5°, so the two omitted terms together are two
 * orders of magnitude below it.
 */

/**
 * Sagittarius A*, J2000.0. RA 17h45m40.04s, Dec −29°00′28.1″.
 * Source: VLBI position, the standard galactic-centre reference.
 */
export const GALACTIC_CORE_J2000 = {
  /** Right ascension, degrees. 17h45m40.04s × 15°/h. */
  raDeg: (17 + 45 / 60 + 40.04 / 3600) * 15,
  /** Declination, degrees. −29°00′28.1″ — the arcminute term is zero. */
  decDeg: -(29 + 28.1 / 3600),
} as const

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
/** Julian date of J2000.0 (2000-01-01T12:00:00 TT). */
const JD_J2000 = 2451545.0
const MS_PER_DAY = 86_400_000

export type EquatorialCoords = {
  /** Right ascension, degrees, 0..360. */
  raDeg: number
  /** Declination, degrees, −90..90. */
  decDeg: number
}

export type Observer = {
  /** Latitude, degrees, north positive. */
  lat: number
  /** Longitude, degrees, **east positive**. */
  lon: number
}

export type HorizontalCoords = {
  /** Apparent altitude above the horizon in degrees, refraction included. */
  altitude: number
  /** Geometric (airless) altitude in degrees. */
  altitudeGeometric: number
  /** Azimuth in degrees, measured from north through east, 0..360. */
  azimuth: number
  /** Hour angle in degrees, −180..180. Negative = east of the meridian. */
  hourAngle: number
}

/** Julian Date for an instant. */
export function julianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + 2440587.5
}

/** Julian centuries since J2000.0. */
function julianCenturies(jd: number): number {
  return (jd - JD_J2000) / 36525
}

/** Normalise to [0, 360). */
export function normalizeDegrees(deg: number): number {
  const wrapped = deg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/** Normalise to (−180, 180]. */
export function normalizeSignedDegrees(deg: number): number {
  const wrapped = normalizeDegrees(deg)
  return wrapped > 180 ? wrapped - 360 : wrapped
}

/**
 * Precess equatorial coordinates from J2000.0 to the equinox of `date`, using
 * the IAU 1976 ζ/z/θ Euler angles (Meeus, *Astronomical Algorithms*, ch. 21).
 *
 * Ignoring this is the single largest avoidable error in the chain: by 2026 it
 * has moved the core's RA by ~0.41°, which shows up directly in azimuth and,
 * away from the meridian, in altitude.
 */
export function precessFromJ2000(coords: EquatorialCoords, date: Date): EquatorialCoords {
  const t = julianCenturies(julianDate(date))
  const t2 = t * t
  const t3 = t2 * t

  // Arcseconds → degrees.
  const zeta = (2306.2181 * t + 0.30188 * t2 + 0.017998 * t3) / 3600
  const z = (2306.2181 * t + 1.09468 * t2 + 0.018203 * t3) / 3600
  const theta = (2004.3109 * t - 0.42665 * t2 - 0.041833 * t3) / 3600

  const ra0 = coords.raDeg * DEG
  const dec0 = coords.decDeg * DEG
  const zetaR = zeta * DEG
  const thetaR = theta * DEG

  const cosDec0 = Math.cos(dec0)
  const sinDec0 = Math.sin(dec0)
  const cosRaZeta = Math.cos(ra0 + zetaR)
  const sinRaZeta = Math.sin(ra0 + zetaR)

  const a = cosDec0 * sinRaZeta
  const b = Math.cos(thetaR) * cosDec0 * cosRaZeta - Math.sin(thetaR) * sinDec0
  const c = Math.sin(thetaR) * cosDec0 * cosRaZeta + Math.cos(thetaR) * sinDec0

  return {
    raDeg: normalizeDegrees(Math.atan2(a, b) * RAD + z),
    decDeg: Math.asin(Math.max(-1, Math.min(1, c))) * RAD,
  }
}

/**
 * Greenwich Mean Sidereal Time in degrees (IAU 1982 series, Meeus ch. 12).
 * Good to well under an arcsecond over the century around J2000.
 */
export function greenwichMeanSiderealTime(date: Date): number {
  const jd = julianDate(date)
  const d = jd - JD_J2000
  const t = julianCenturies(jd)
  const gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38_710_000
  return normalizeDegrees(gmst)
}

/** Local Mean Sidereal Time in degrees, for an east-positive longitude. */
export function localSiderealTime(date: Date, lonEastDeg: number): number {
  return normalizeDegrees(greenwichMeanSiderealTime(date) + lonEastDeg)
}

/**
 * Bennett's refraction formula (Meeus ch. 16), in degrees, for a standard
 * atmosphere. Takes *apparent* altitude in the strict form; fed geometric
 * altitude here, which is the usual practical simplification and costs well
 * under an arcminute above ~5°.
 *
 * Returns 0 below −1° — refraction is meaningless for a target well under the
 * horizon and the formula diverges there.
 */
export function refractionDegrees(altitudeDeg: number): number {
  if (altitudeDeg < -1) return 0
  const arcminutes = 1 / Math.tan((altitudeDeg + 7.31 / (altitudeDeg + 4.4)) * DEG)
  return arcminutes / 60
}

/**
 * Rotate equatorial coordinates *of date* into the observer's horizontal frame.
 *
 * Uses the direction-cosine form rather than the classic `atan2(sin H, …)`
 * azimuth formula: the vector version has no quadrant ambiguity and no
 * south-vs-north convention trap, which is where hand-rolled alt/az code
 * usually goes wrong.
 */
export function equatorialToHorizontal(
  coords: EquatorialCoords,
  observer: Observer,
  date: Date,
): HorizontalCoords {
  const lst = localSiderealTime(date, observer.lon)
  const hourAngle = normalizeSignedDegrees(lst - coords.raDeg)

  const ha = hourAngle * DEG
  const dec = coords.decDeg * DEG
  const lat = observer.lat * DEG

  const cosDec = Math.cos(dec)
  const sinDec = Math.sin(dec)
  const cosHa = Math.cos(ha)
  const sinHa = Math.sin(ha)
  const cosLat = Math.cos(lat)
  const sinLat = Math.sin(lat)

  // North / East / Up components of the unit vector to the target.
  const north = -cosDec * cosHa * sinLat + sinDec * cosLat
  const east = -cosDec * sinHa
  const up = cosDec * cosHa * cosLat + sinDec * sinLat

  const altitudeGeometric = Math.asin(Math.max(-1, Math.min(1, up))) * RAD
  const azimuth = normalizeDegrees(Math.atan2(east, north) * RAD)

  return {
    altitude: altitudeGeometric + refractionDegrees(altitudeGeometric),
    altitudeGeometric,
    azimuth,
    hourAngle,
  }
}

/**
 * Where the galactic core is, for an observer, at an instant.
 *
 * This is the function the whole astro surface is built on: every altitude in
 * a `/astro/window` response comes from here, never from a model.
 */
export function galacticCorePosition(observer: Observer, date: Date): HorizontalCoords {
  return equatorialToHorizontal(precessFromJ2000(GALACTIC_CORE_J2000, date), observer, date)
}

/**
 * Instant of the core's upper transit (maximum altitude) on the UTC day
 * containing `date`, found by solving for hour angle 0.
 *
 * Sidereal days are ~4 minutes short of solar days, so a transit can fall
 * twice or not at all within a given 24 h span; this returns the one nearest
 * to `date`, which is what a "tonight" question actually wants.
 */
export function coreTransit(observer: Observer, date: Date): Date {
  // Hour angle advances at one sidereal rate: 360.98564736629°/day.
  const rateDegPerMs = 360.98564736629 / MS_PER_DAY
  let instant = date
  // Two Newton steps converge to well under a second; the rate is essentially
  // constant so there is nothing to iterate away beyond rounding.
  for (let i = 0; i < 3; i++) {
    const coords = precessFromJ2000(GALACTIC_CORE_J2000, instant)
    const ha = normalizeSignedDegrees(localSiderealTime(instant, observer.lon) - coords.raDeg)
    instant = new Date(instant.getTime() - ha / rateDegPerMs)
  }
  return instant
}

/**
 * Maximum altitude the core reaches for an observer, ignoring refraction.
 *
 * Closed form: at transit the target sits due south (northern hemisphere,
 * dec < lat) at `90° − |lat − dec|`. Exposed because it is the number the
 * operator's own notes anchor on — ~13° at Munich, which is why a clear
 * southern horizon beats a dark sky.
 */
export function maxCoreAltitude(observer: Observer, date: Date): number {
  const coords = precessFromJ2000(GALACTIC_CORE_J2000, date)
  return 90 - Math.abs(observer.lat - coords.decDeg)
}
