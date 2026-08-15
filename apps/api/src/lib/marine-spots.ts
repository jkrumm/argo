/**
 * Candidate surf spots, and the one number that makes a wind reading meaningful.
 *
 * **`shoreNormal` is the bearing you face when you stand on the beach and look
 * out to sea**, in degrees from true north. Everything about wind quality is
 * derived from it: offshore wind blows from the land toward the water, so it
 * arrives *from* `shoreNormal + 180°`, and onshore wind arrives *from*
 * `shoreNormal`. Get this number wrong and the endpoint confidently recommends
 * the worst days of the week.
 *
 * These four are a **starting set, not the operator's actual break list** —
 * unlike the astro sites, whose Bortle classes come from the operator's own
 * field notes, no surf note exists in the vault. They are picked for being real,
 * well-documented European breaks reachable from Munich, ordered by drive time.
 * The `shoreNormal` values are read off the coastline orientation and are
 * approximate; they are the first thing to correct once someone has actually
 * stood on the beach. `/marine/window` also accepts a raw `lat`/`lon` +
 * `shoreNormal`, so the list is a convenience, never a constraint.
 *
 * Deliberately NOT in this list: the Eisbach standing wave in Munich, which is
 * the actual home break of every Munich surfer. It is fed by a river, not by
 * swell, so every gate and factor in `marine-score.ts` is meaningless there —
 * including it would produce confident nonsense.
 */

export type MarineSpot = {
  /** Stable kebab-case id used as the `spot` query param. */
  id: string
  name: string
  country: string
  lat: number
  lon: number
  /** IANA timezone. */
  timeZone: string
  /**
   * Bearing, in degrees from true north, that the beach faces out to sea.
   * 290 means "the open water is to the WNW".
   */
  shoreNormal: number
  /** Approximate drive time from Munich, minutes. */
  driveMinutes: number
  /** One line on why this spot is on the list. */
  note: string
}

export const MARINE_SPOTS: readonly MarineSpot[] = [
  {
    id: 'levanto',
    name: 'Levanto',
    country: 'Italy',
    lat: 44.17,
    lon: 9.61,
    timeZone: 'Europe/Rome',
    shoreNormal: 200,
    driveMinutes: 420,
    note: 'The closest real wave to Munich at ~7 h. Ligurian, so it needs a proper SW blow — small windows, but no flight.',
  },
  {
    id: 'zarautz',
    name: 'Zarautz',
    country: 'Spain',
    lat: 43.287,
    lon: -2.172,
    timeZone: 'Europe/Madrid',
    shoreNormal: 350,
    driveMinutes: 900,
    note: 'Basque beach break facing almost due north — works on the same Atlantic swell as Hossegor but handles more size.',
  },
  {
    id: 'hossegor',
    name: 'Hossegor (La Gravière)',
    country: 'France',
    lat: 43.664,
    lon: -1.438,
    timeZone: 'Europe/Paris',
    shoreNormal: 290,
    driveMinutes: 780,
    note: "Europe's reference beach break. Exposed WNW, so it picks up everything — and closes out when it is too big.",
  },
  {
    id: 'peniche',
    name: 'Peniche (Supertubos)',
    country: 'Portugal',
    lat: 39.352,
    lon: -9.363,
    timeZone: 'Europe/Lisbon',
    shoreNormal: 225,
    driveMinutes: 1500,
    note: 'A flight rather than a drive, but the most consistent of the set — the Atlantic almost always has something.',
  },
] as const

/** Levanto — the nearest spot, and the default when a request names none. */
export const DEFAULT_SPOT: MarineSpot = MARINE_SPOTS[0]!

/** Looks up a spot by its `id`. Returns `undefined` on no match — callers decide the fallback. */
export function findSpot(id: string): MarineSpot | undefined {
  return MARINE_SPOTS.find((spot) => spot.id === id)
}

/**
 * Classification of the wind relative to the shore, and how good that is.
 *
 * Offshore wind holds a wave face up and grooms it; onshore wind knocks it down
 * into mush. Cross-shore sits between the two. The quality number is what the
 * scorer consumes: 1 when the wind is dead offshore, 0 when it is dead onshore,
 * linear through cross-shore.
 */
export type WindQuality = {
  /** `offshore` | `cross-shore` | `onshore`. */
  kind: 'offshore' | 'cross-shore' | 'onshore'
  /** 0..1, 1 = dead offshore. */
  quality: number
  /** Degrees away from dead offshore, 0..180. */
  offAxis: number
}

/**
 * Classify a meteorological wind direction against a spot's shore normal.
 *
 * `windFromDeg` follows the meteorological convention Open-Meteo uses: the
 * direction the wind blows **from**. Dead offshore is therefore
 * `shoreNormal + 180`, which is the single most common sign error in surf
 * forecasting code.
 */
export function classifyWind(windFromDeg: number, shoreNormal: number): WindQuality {
  const deadOffshore = (shoreNormal + 180) % 360
  const diff = Math.abs(((windFromDeg - deadOffshore) % 360) + 360) % 360
  const offAxis = diff > 180 ? 360 - diff : diff
  const quality = 1 - offAxis / 180
  const kind = offAxis <= 60 ? 'offshore' : offAxis >= 120 ? 'onshore' : 'cross-shore'
  return { kind, quality, offAxis }
}

/**
 * How well a swell direction lines up with a spot's exposure.
 *
 * `swellFromDeg` is also "the direction it comes from", so a swell arriving
 * straight into the beach comes from `shoreNormal`. Returns 1 for a straight-on
 * swell, falling to 0 at 90° off — past that the headland is in the way and the
 * spot is simply not exposed to it.
 */
export function swellAlignment(swellFromDeg: number, shoreNormal: number): number {
  const diff = Math.abs(((swellFromDeg - shoreNormal) % 360) + 360) % 360
  const offAxis = diff > 180 ? 360 - diff : diff
  return Math.max(0, 1 - offAxis / 90)
}
