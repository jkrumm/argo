/**
 * The candidate drive-to observing sites for the astro window planner, with
 * their MEASURED sky and terrain, plus two lookups over them. Pure data — no
 * I/O, no upstream calls.
 *
 * Every number below was measured, not judged: light pollution and the
 * direction-resolved dome come from David J. Lorenz's binary-tile atlas
 * (`../clients/lorenz-atlas.ts`, `./skyglow.ts`), the horizon from AWS terrarium
 * DEM tiles at z11 (`./terrain-horizon.ts`). They are produced by
 * `scripts/gen-astro-sites.ts` and pasted here with the date they were computed
 * (`ASTRO_SITE_MEASUREMENTS`), because they change on a yearly cadence — the
 * atlas publishes once a year, mountains never — so a per-request computation
 * would re-download an atlas tile to observe a number that cannot have moved.
 * Re-run the generator when a new vintage lands; it self-checks against the
 * acceptance table in `docs/ASTRO-MAP-RESEARCH.md`.
 *
 * The hand-typed subjective sky class this table used to carry is GONE,
 * deliberately (§1.3): that scale is about the WHOLE sky, driven mostly by
 * light domes near the horizon, a zenith map cannot produce it, and the atlas
 * author asks explicitly that the two not be conflated. The old numbers were
 * also demonstrably inconsistent with the measurement — Bayerischer Wald and
 * Walchensee sat one class apart while measuring the same zenith brightness to
 * 0.02 mag. `mpsas` and `coreDirectionMpsas` say what that class was reaching
 * for, in units something can actually be checked against.
 */

/** Provenance of every measured field on `ASTRO_SITES`. Re-run the generator to move it. */
export const ASTRO_SITE_MEASUREMENTS = {
  atlasYear: 2025,
  computedOn: '2026-08-18',
  generator: 'apps/api/scripts/gen-astro-sites.ts',
} as const

export type AstroSite = {
  /** Stable kebab-case id used as the `site` query param. */
  id: string
  name: string
  lat: number
  lon: number
  /** IANA timezone. */
  timeZone: string
  /** Approximate drive time from Munich, minutes. 0 for Munich itself. */
  driveMinutes: number
  /** Zenith sky brightness, mag/arcsec² — higher is darker. Treat as ±0.2 absolute. */
  mpsas: number
  /** Lorenz Light Pollution Index: artificial over natural zenith brightness. */
  lpi: number
  /** Lorenz zone band, `0a`..`7b`. Deliberately not a subjective whole-sky class. */
  zone: string
  /** Percent change in LPI from the 2016 atlas to `ASTRO_SITE_MEASUREMENTS.atlasYear`. */
  trend10yPercent: number
  /** Sky brightness where the galactic core sits, mag/arcsec² — the number a frame actually sees. */
  coreDirectionMpsas: number
  /** How much darker the zenith reads than the core direction, magnitudes. */
  domePenaltyMag: number
  /** Highest terrain horizon across the 150–215° arc the core crosses, degrees. */
  southHorizonDeg: number
  /**
   * The committed skyline: far-band horizon altitude in degrees at each of the 72
   * azimuths, ascending from 0° in `HORIZON_AZIMUTH_STEP_DEG` steps. Two decimals.
   */
  horizonDeg: readonly number[]
  /** DEM elevation of the site, metres. */
  siteElevationM: number
  /** One line on why this site is on the list. */
  note: string
}

export const ASTRO_SITES: readonly AstroSite[] = [
  {
    id: 'munich',
    name: 'Munich',
    lat: 48.1374,
    lon: 11.5755,
    timeZone: 'Europe/Berlin',
    driveMinutes: 0,
    mpsas: 18.44,
    lpi: 25.49,
    zone: '6b',
    trend10yPercent: 8,
    coreDirectionMpsas: 17.31,
    domePenaltyMag: 1.09,
    southHorizonDeg: 1.0,
    horizonDeg: [
      -0.02, -0.1, -0.1, -0.14, -0.15, -0.06, -0.2, -0.11, -0.14, -0.08, -0.1, -0.05, 0.05, 0.05,
      0.06, 0.11, 0.16, 0.18, 0.27, 0.21, 0.23, 0.26, 0.34, 0.37, 0.32, 0.28, 0.37, 0.33, 0.33,
      0.85, 0.56, 0.93, 0.79, 0.82, 0.97, 0.86, 0.42, 0.88, 0.67, 0.71, 0.41, 0.33, 0.44, 0.45, 0.4,
      0.38, 0.34, 0.32, 0.28, 0.2, 0.21, 0.16, 0.13, 0.2, 0.17, 0.23, 0.32, 0.35, 0.27, 0.25, -0.01,
      -0.02, 0.06, 0.02, 0.17, 0.02, -0.06, 0.14, -0.01, -0.11, -0.05, -0.01,
    ],
    siteElevationM: 525,
    note: 'Home, and 25× the natural sky brightness — 18.4 at zenith, 17.3 where the core sits. Flat all round, so nothing but the brightest targets survives.',
  },
  {
    id: 'alpenvorland',
    name: 'Alpenvorland (Bad Tölz)',
    lat: 47.8167,
    lon: 11.4667,
    timeZone: 'Europe/Berlin',
    driveMinutes: 45,
    mpsas: 21.14,
    lpi: 1.22,
    zone: '4a',
    trend10yPercent: 27,
    coreDirectionMpsas: 19.7,
    domePenaltyMag: 1.04,
    southHorizonDeg: 3.8,
    horizonDeg: [
      0.37, 0.5, 0.47, 0.26, 0.32, 0.42, 0.48, 0.74, 0.99, 1.11, 1.19, 1.08, 0.98, 1.3, 1.14, 1.13,
      1.38, 1.69, 1.73, 2.01, 2.21, 2.47, 2.42, 2.53, 2.64, 2.69, 2.63, 2.6, 2.4, 2.38, 2.2, 2.06,
      3.28, 3.51, 3.83, 3.62, 3.58, 2.74, 2.05, 2.02, 1.56, 1.79, 1.99, 2.05, 1.58, 1.32, 1.36,
      1.25, 0.94, 0.85, 0.45, 0.42, 0.47, 0.54, 0.68, 0.84, 1.02, 1.01, 0.68, 0.77, 0.88, 0.94, 0.8,
      0.86, 0.79, 0.75, 0.82, 0.64, 0.64, 0.55, 0.58, 0.47,
    ],
    siteElevationM: 599,
    note: '45 min south and 2.7 mag darker than home. The Benediktenwand puts a 3.8° ridge across the core arc, and its LPI has risen 27% since 2016 — the fastest of the four.',
  },
  {
    id: 'bayerischer-wald',
    name: 'Bayerischer Wald',
    lat: 48.9333,
    lon: 13.4167,
    timeZone: 'Europe/Berlin',
    driveMinutes: 150,
    mpsas: 21.57,
    lpi: 0.48,
    zone: '3a',
    trend10yPercent: 6,
    coreDirectionMpsas: 19.76,
    domePenaltyMag: 1.34,
    southHorizonDeg: 0.6,
    horizonDeg: [
      5.42, 6.04, 6.33, 5.67, 6.11, 6.85, 7.18, 7.78, 7.58, 6.95, 7.03, 6.57, 6.16, 5.31, 4.69,
      4.48, 4.2, 4.69, 4.01, 3.93, 4.15, 4.11, 3.65, 3.07, 1.74, 1.05, 0.45, 0.27, 0.26, 0.01,
      -0.03, 0.26, 0.34, 0.08, 0.07, 0.09, 0.11, 0.06, 0.21, 0.55, 0.61, 0.36, -0.14, 0.14, 0.39,
      0.41, 0.7, 0.93, 1.38, 1.59, 1.51, 1.27, 1.39, 1.7, 2.07, 2.1, 1.75, 1.88, 2.45, 2.43, 2.56,
      2.38, 3.1, 4.03, 4.74, 5.28, 5.88, 6.38, 6.27, 5.44, 4.91, 5.06,
    ],
    siteElevationM: 809,
    note: 'The darkest zenith of the four and the flattest southern terrain (0.6°) — and it still loses the direction that matters: Spiegelau, Grafenau and Neuschönau all sit S/SSW, so it pays the largest dome penalty of the set (1.34 mag). The "treed horizon" in the field notes is a 2–5° canopy the DEM cannot see, not terrain.',
  },
  {
    id: 'walchensee',
    name: 'Walchensee',
    lat: 47.6,
    lon: 11.33,
    timeZone: 'Europe/Berlin',
    driveMinutes: 70,
    mpsas: 21.55,
    lpi: 0.51,
    zone: '3a',
    trend10yPercent: 25,
    coreDirectionMpsas: 19.98,
    domePenaltyMag: 1.03,
    southHorizonDeg: 5.7,
    horizonDeg: [
      23.89, 21.4, 17.07, 12.85, 10.59, 7.33, 2.68, 3.69, 6.25, 8.76, 9.02, 8.78, 7.19, 5.66, 4.25,
      3.52, 2.25, 2.41, 4.26, 3.32, 3.54, 4.57, 3.64, 2.84, 3.55, 4.06, 4.37, 4.81, 4.73, 4.51,
      4.93, 5.13, 5.29, 5.68, 5.46, 5.72, 5.65, 5.18, 4.46, 3.53, 3.0, 2.2, 3.64, 3.68, 4.09, 5.38,
      6.87, 7.96, 7.31, 8.05, 7.69, 7.49, 9.65, 12.78, 15.06, 17.81, 21.23, 23.71, 26.55, 29.2,
      30.5, 32.87, 33.56, 34.16, 33.76, 32.79, 33.05, 32.65, 31.66, 30.21, 29.46, 26.14,
    ],
    siteElevationM: 801,
    note: 'Second-darkest zenith (21.55 to the Wald’s 21.57) but the darkest sky where the camera points, at half the drive. It is walled to the N/NW at 24–34°, and that ridge eats the brightest part of the Munich dome. The price is a 5.7° southern ridge and a closed foreground — the lake is the compensation.',
  },
] as const

/** Munich — the default site when a request specifies none. */
export const DEFAULT_SITE: AstroSite = ASTRO_SITES[0]!

/** Looks up a site by its `id`. Returns `undefined` on no match — callers decide the fallback. */
export function findSite(id: string): AstroSite | undefined {
  return ASTRO_SITES.find((site) => site.id === id)
}

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Great-circle distance between two coordinates, in km. Standard haversine
 * over a spherical-earth approximation (radius 6371 km) — plenty accurate at
 * the tens-of-km scale these four sites span.
 */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/**
 * Nearest candidate site by great-circle distance — used to resolve a raw
 * lat/lon (e.g. a geocoded city) to a darkness baseline when the caller didn't
 * pick one of the four ids directly.
 */
export function nearestSite(lat: number, lon: number): AstroSite {
  let nearest: AstroSite = ASTRO_SITES[0]!
  let nearestDistance = distanceKm({ lat, lon }, nearest)

  for (const site of ASTRO_SITES.slice(1)) {
    const distance = distanceKm({ lat, lon }, site)
    if (distance < nearestDistance) {
      nearest = site
      nearestDistance = distance
    }
  }

  return nearest
}
