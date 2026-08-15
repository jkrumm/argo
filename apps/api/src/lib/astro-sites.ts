/**
 * The static candidate list of drive-to observing sites for the astro window
 * planner, plus two lookups over it. Pure data — no I/O, no upstream calls.
 *
 * Bortle class is baked in as a static constant on each site, deliberately.
 * Light pollution changes on a yearly cadence (new streetlights, a town's
 * lighting ordinance), not an hourly one, so deriving it live from the EOG
 * VNL (VIIRS Nighttime Lights) GeoTIFF for every request is out of scope for
 * v1 — it would trade a one-line lookup for a raster-fetch-and-sample
 * pipeline to chase a number that barely moves. The classes below come from
 * the operator's own field notes, not a general catalog.
 *
 * A `radiance` field (the raw VNL nW/cm²/sr value a proper Bortle derivation
 * would read) was intentionally NOT added here. This codebase does not fetch
 * the VNL raster anywhere — a hard-coded radiance number nobody actually
 * measured would be worse than no field at all, since it invites a caller to
 * treat it as ground truth. Bortle class alone is the honest granularity.
 */

export type AstroSite = {
  /** Stable kebab-case id used as the `site` query param. */
  id: string
  name: string
  lat: number
  lon: number
  /** IANA timezone. */
  timeZone: string
  /** Bortle class, 1 (pristine) to 9 (inner city). */
  bortle: number
  /** Approximate drive time from Munich, minutes. 0 for Munich itself. */
  driveMinutes: number
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
    bortle: 8,
    driveMinutes: 0,
    note: 'Home. Bortle 8 — usable only for the brightest targets.',
  },
  {
    id: 'alpenvorland',
    name: 'Alpenvorland (Bad Tölz)',
    lat: 47.8167,
    lon: 11.4667,
    timeZone: 'Europe/Berlin',
    bortle: 4,
    driveMinutes: 45,
    note: '45 min south. Bortle 4 and an open southern horizon toward the Alps.',
  },
  {
    id: 'bayerischer-wald',
    name: 'Bayerischer Wald',
    lat: 48.9333,
    lon: 13.4167,
    timeZone: 'Europe/Berlin',
    bortle: 3,
    driveMinutes: 150,
    note: "One of Germany's darkest skies, but 2.5 h east and the horizon is treed.",
  },
  {
    id: 'walchensee',
    name: 'Walchensee',
    lat: 47.6,
    lon: 11.33,
    timeZone: 'Europe/Berlin',
    bortle: 4,
    driveMinutes: 70,
    note: 'Deep south, Bortle 4, foreground water — the best southern horizon of the set.',
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
 * lat/lon (e.g. a geocoded city) to a Bortle baseline when the caller didn't
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
