/**
 * Direction-resolved artificial skyglow, by ray-marching the Lorenz LPI field.
 *
 * Zenith brightness is the wrong number for this feature: from 48°N the
 * galactic core peaks at 12–13°, due south, and every frame points at the 8–14°
 * band in the S/SSE–SSW arc — the part of the sky a zenith map never describes.
 * Marching the atlas outward along an azimuth and weighting each ground cell by
 * how much of it scatters into a line of sight at that elevation re-orders the
 * shipped sites: Bayerischer Wald has the darkest zenith of the four and loses
 * that lead entirely where the camera points (`docs/ASTRO-MAP-RESEARCH.md` §2.5).
 *
 * This is "model B" of the two estimators in §2.2. Model A — a GeoNames
 * population kernel — was deliberately dropped: it needs a 13 MB dump, it breaks
 * inside cities, and it exists only to bound this model's error, which it did
 * (dominant azimuth agrees to 0–10° at the two dark sites, correlation 0.94–0.97).
 *
 * Everything here is pure and synchronous. The LPI sampler is injected because
 * the client pre-decodes every tile the march can reach before it starts — a
 * lazy per-sample fetch inside the loop would either serialise 60 round trips
 * or silently truncate the march, which biases the dome toward the site.
 *
 * Absolute dome penalties move ±0.35 mag across nine kernel variants (§2.4);
 * the site ORDERING is invariant across all nine. Read the number as soft and
 * the ranking as solid.
 */

import { mpsasFromLpi } from './lorenz-decode.js'

/** Synchronous LPI lookup — the client pre-decodes every tile the march can touch. NaN = no data. */
export type LpiSampler = (lat: number, lon: number) => number

export type SkyglowModel = {
  /** Scattering scale height, km. One number standing in for the Rayleigh (~8 km) and aerosol (~1–2 km) heights; 5 km reproduces the observed 10–20° dome peak for a city at ~50 km (§2.3). */
  hScatKm: number
  /** How far the march reaches, km. 60 and 200 give identical answers — everything that matters is inside 60 (§2.4). */
  rangeKm: number
  stepKm: number
  /** The `r0` in `1 + (r/r0)^falloff`: keeps the site's own cell from behaving like a point source overhead. */
  coreRadiusKm: number
  falloffExponent: number
}

export const SKYGLOW_MODEL: SkyglowModel = {
  hScatKm: 5,
  rangeKm: 120,
  stepKm: 2,
  coreRadiusKm: 10,
  falloffExponent: 1.5,
}

/** Azimuth resolution of the profile, degrees. */
const PROFILE_AZIMUTH_STEP = 5

/** The altitudes worth reporting: the 8–14° core band, bracketed either side. */
export const PROFILE_ALTITUDES = [5, 8, 10, 13, 15, 20, 30] as const

/** The altitude the dominant-direction call is made at — the light-dome peak (§2.3). */
const DOMINANT_ALTITUDE_DEG = 10

// `skyglowProfile`'s `dominant` search below only fires on an EXACT altitude
// match against this constant, so retuning `PROFILE_ALTITUDES` without keeping
// this row in it would silently leave `dominant.mpsas` at its `Infinity` seed
// forever — `JSON.stringify` turns that into `null`, and the route's response
// schema (`z.number()`) then 500s on a one-line constant edit. Asserted here,
// at module load, instead of tracking the max over the nearest altitude row:
// "dominant direction" is defined as the reading AT the light-dome peak
// altitude, not at whichever row happens to be closest, so silently
// substituting a neighbour would change the figure's meaning, not just its
// availability.
if (!(PROFILE_ALTITUDES as readonly number[]).includes(DOMINANT_ALTITUDE_DEG)) {
  throw new Error(
    `DOMINANT_ALTITUDE_DEG (${DOMINANT_ALTITUDE_DEG}) must be one of PROFILE_ALTITUDES`,
  )
}

/**
 * Kilometres per degree of latitude. Exported because `../clients/lorenz-atlas.ts`
 * uses the SAME figure to decide which tiles to prefetch for the exact march this
 * module performs — a private, drifted copy there would silently stop covering
 * the march path (a retune here would then read as a missing-tile bug, not a
 * one-line constant edit).
 */
export const KM_PER_DEG_LAT = 111.32
const EARTH_RADIUS_KM = 6371
const AIRGLOW_LAYER_KM = 90

const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/** 16-point compass label for an azimuth in degrees from north through east. */
export function compassPoint(azimuthDeg: number): string {
  const normalized = ((azimuthDeg % 360) + 360) % 360
  return COMPASS_POINTS[Math.round(normalized / 22.5) % 16]!
}

/**
 * How much ground brightness at range `r` reaches a line of sight at elevation
 * `alt`: the ray climbs out of the scattering layer as `r·tan(alt)`, and the
 * usual inverse-square-ish falloff takes over beyond the core radius.
 *
 * Altitude is floored at the horizon because the kernel is only defined above
 * it: a negative `alt` flips the sign of the exponent, so the weight GROWS with
 * range instead of decaying (at −30° a cell 120 km out counts 2.4e4×) and the
 * march ends up dominated by its farthest samples. Callers must not ask for a
 * below-horizon direction — the route gates on it — but the kernel refuses to
 * return a number that is worse than useless if one ever does.
 */
export function rayWeight(rangeKm: number, altitudeDeg: number, model: SkyglowModel): number {
  const rayHeightKm = rangeKm * Math.tan(toRadians(Math.max(altitudeDeg, 0)))
  return (
    Math.exp(-rayHeightKm / model.hScatKm) /
    (1 + Math.pow(rangeKm / model.coreRadiusKm, model.falloffExponent))
  )
}

/**
 * Sum of weighted LPI along one azimuth/altitude ray, in the atlas's own units
 * before calibration.
 *
 * A cell the sampler has no data for contributes nothing — which, in a bare sum,
 * reads exactly like darkness. There is no honest alternative inside the loop
 * (inventing a value would be worse), so the guarantee lives one level up: the
 * client pre-fetches EVERY tile the march can reach, so a NaN here means a tile
 * the upstream failed to serve, not a sector nobody asked for.
 */
export function marchRay(args: {
  sampler: LpiSampler
  site: { lat: number; lon: number }
  azimuthDeg: number
  altitudeDeg: number
  model?: SkyglowModel
}): number {
  const model = args.model ?? SKYGLOW_MODEL
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(toRadians(args.site.lat))
  const azimuth = toRadians(args.azimuthDeg)
  let total = 0

  for (let r = 0; r <= model.rangeKm; r += model.stepKm) {
    const lat = args.site.lat + (r * Math.cos(azimuth)) / KM_PER_DEG_LAT
    const lon = args.site.lon + (r * Math.sin(azimuth)) / kmPerDegLon
    const lpi = args.sampler(lat, lon)
    if (!Number.isFinite(lpi)) continue
    total += lpi * rayWeight(r, args.altitudeDeg, model)
  }

  return total
}

/**
 * Van Rhijn factor — how much more of the ~90 km airglow layer a slanted line of
 * sight passes through than a vertical one. In LPI units the natural background
 * is 1 at zenith, so this is the natural term to add to the artificial glow.
 */
export function vanRhijnAirglow(altitudeDeg: number, layerKm = AIRGLOW_LAYER_KM): number {
  const zenithAngle = toRadians(90 - altitudeDeg)
  const ratio = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + layerKm)
  return 1 / Math.sqrt(1 - Math.pow(ratio * Math.sin(zenithAngle), 2))
}

export type SkyglowProfile = {
  azimuths: number[]
  altitudes: number[]
  /** mpsas per [altitudeIndex][azimuthIndex] of the ARTIFICIAL glow alone. */
  mpsas: number[][]
  calibration: number
  dominant: { azimuthDeg: number; compass: string; mpsas: number }
}

/**
 * Calibrate the march so the zenith ray reproduces the atlas point value
 * exactly, which is what makes every direction commensurable with the published
 * zenith number.
 *
 * With the shipped kernel this evaluates to exactly 1: `tan(90°)` is ~1.6e16, so
 * every `r > 0` term underflows to zero and only the `r = 0` sample survives —
 * which is the site's own atlas cell. It is kept anyway because it states the
 * intent and stays correct if the kernel ever changes. It is a no-op, not a bug;
 * do not "fix" it away.
 *
 * Exported so a caller that needs BOTH `skyglowProfile` and `coreDirectionGlow`
 * for the same site — `fetchSkyglow` does, every request — can compute this
 * once and hand the result to both instead of re-marching the (degenerate but
 * not free) zenith ray twice.
 */
export function computeCalibration(args: {
  sampler: LpiSampler
  site: { lat: number; lon: number }
  zenithLpi: number
  model?: SkyglowModel
}): number {
  const model = args.model ?? SKYGLOW_MODEL
  const zenithRay = marchRay({
    sampler: args.sampler,
    site: args.site,
    azimuthDeg: 0,
    altitudeDeg: 90,
    model,
  })
  // Identity, not zero: the march is already in atlas units, so an uncalibratable
  // site (a genuinely pristine cell reads exactly 0 LPI, and 63% of the Mauna Kea
  // tile does) must fall back to "no rescaling" — scaling by 0 would flatten the
  // whole rose to the 22.0 baseline and report a dome that is not there.
  if (!(zenithRay > 0)) return 1
  return args.zenithLpi / zenithRay
}

/** The full azimuth × altitude rose of artificial skyglow around a site. */
export function skyglowProfile(args: {
  sampler: LpiSampler
  site: { lat: number; lon: number }
  zenithLpi: number
  model?: SkyglowModel
  /** Pre-computed `computeCalibration` result — pass when a caller already has one for this site. */
  calibration?: number
}): SkyglowProfile {
  const model = args.model ?? SKYGLOW_MODEL
  const k = args.calibration ?? computeCalibration({ ...args, model })

  const azimuths: number[] = []
  for (let az = 0; az < 360; az += PROFILE_AZIMUTH_STEP) azimuths.push(az)
  const altitudes = [...PROFILE_ALTITUDES]

  const mpsas: number[][] = []
  let dominant = { azimuthDeg: 0, compass: compassPoint(0), mpsas: Number.POSITIVE_INFINITY }

  for (const altitudeDeg of altitudes) {
    const row: number[] = []
    for (const azimuthDeg of azimuths) {
      const glow =
        k * marchRay({ sampler: args.sampler, site: args.site, azimuthDeg, altitudeDeg, model })
      const brightness = mpsasFromLpi(glow)
      row.push(brightness)
      // Brightest cell = LOWEST mpsas; the scale runs backwards.
      if (altitudeDeg === DOMINANT_ALTITUDE_DEG && brightness < dominant.mpsas) {
        dominant = { azimuthDeg, compass: compassPoint(azimuthDeg), mpsas: brightness }
      }
    }
    mpsas.push(row)
  }

  return { azimuths, altitudes, mpsas, calibration: k, dominant }
}

export type CoreDirection = {
  azimuthDeg: number
  altitudeDeg: number
  /** Sky brightness where the camera actually points, artificial glow plus airglow. */
  mpsas: number
  /** How much darker the zenith reads than the core direction, in magnitudes. */
  domePenaltyMag: number
}

/**
 * The one number this whole module exists for: sky brightness in the direction
 * of the galactic core, and how much worse that is than the zenith figure the
 * atlas publishes.
 *
 * The airglow term is added here and NOWHERE in the profile: the profile is
 * artificial glow alone, so a caller can read it as "what the lights cost me",
 * while the core figure is meant to be compared against a real measurement.
 * The `- 1` removes the zenith-normalised natural background that
 * `mpsasFromLpi` already assumes, so the van Rhijn factor is not double-counted.
 */
export function coreDirectionGlow(args: {
  sampler: LpiSampler
  site: { lat: number; lon: number }
  zenithLpi: number
  coreAzimuthDeg: number
  coreAltitudeDeg: number
  model?: SkyglowModel
  /** Pre-computed `computeCalibration` result — pass when a caller already has one for this site. */
  calibration?: number
}): CoreDirection {
  const model = args.model ?? SKYGLOW_MODEL
  const k = args.calibration ?? computeCalibration({ ...args, model })
  const artificial =
    k *
    marchRay({
      sampler: args.sampler,
      site: args.site,
      azimuthDeg: args.coreAzimuthDeg,
      altitudeDeg: args.coreAltitudeDeg,
      model,
    })

  return {
    azimuthDeg: args.coreAzimuthDeg,
    altitudeDeg: args.coreAltitudeDeg,
    mpsas: mpsasFromLpi(artificial + vanRhijnAirglow(args.coreAltitudeDeg) - 1),
    domePenaltyMag: mpsasFromLpi(args.zenithLpi) - mpsasFromLpi(artificial),
  }
}
