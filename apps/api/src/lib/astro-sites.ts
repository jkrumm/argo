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
