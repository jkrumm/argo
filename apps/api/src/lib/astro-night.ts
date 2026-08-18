/**
 * One night, resolved: darkness, moon, and where the galactic core sits
 * through it. Pure computation — no I/O, no weather, no model.
 *
 * The shape of the problem at 48°N is not "when is it dark" but "does the
 * short window where the core is up overlap the short window where it is
 * actually dark, without the moon in it". In mid-August those two windows
 * barely touch: the core transits ~21:25 CEST and astronomical night does not
 * start until ~22:35, so the core is already sinking WSW by the time the sky
 * is usable. Shoot the first hour of darkness, not the last.
 *
 * Window detection is sampled on a 5-minute grid rather than solved
 * analytically — ~250 evaluations of cheap trigonometry per night, and it
 * sidesteps every "does this event happen twice tonight / not at all / on the
 * wrong side of the date line" special case that closed-form rise/set code
 * spends its life on. The *named* events (dark start/end, moonrise/set) come
 * from `astronomy-engine`'s own search routines instead, because those are the
 * numbers checked against USNO to the minute.
 *
 * Solar and lunar positions come from `astronomy-engine`, not `suncalc`. That
 * is a deliberate reversal of the brief — see `docs/ASTRO-WINDOW-PROGRESS.md`,
 * decision D2: suncalc's moonrise/set is 3–11 minutes off USNO at Munich,
 * against a 2-minute acceptance bar, while astronomy-engine lands inside one
 * minute. The galactic-core geometry stays hand-rolled in `astro-ephemeris.ts`.
 */

import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MoonPhase,
  Observer as AstroObserver,
  SearchAltitude,
  SearchRiseSet,
} from 'astronomy-engine'
import {
  coreTransit,
  galacticCorePosition,
  maxCoreAltitude,
  type Observer,
} from './astro-ephemeris.js'
import { horizonDegAt } from './terrain-horizon.js'

const MS_PER_MINUTE = 60_000

/** Sun altitude defining astronomical night. */
export const ASTRO_DARK_SUN_ALTITUDE = -18

/**
 * Sky the frame needs above the ridge, degrees, added to the measured skyline
 * to get the per-sample core floor. This is a PHOTOGRAPHIC judgement, not a
 * measurement (`docs/ASTRO-HORIZON-RESEARCH.md` §7) — the ridge altitude
 * itself is geometry, but how much clear sky a frame needs above it is taste.
 */
export const FRAMING_MARGIN_DEG = 2

/**
 * Observer elevation fed to the ephemeris, metres. Kept at sea level: the API
 * contract carries lat/lon only, and the horizon dip from a few hundred metres
 * moves rise/set by a couple of minutes — inside the noise of "is tonight
 * worth driving for".
 */
const OBSERVER_HEIGHT_M = 0

export type NightOptions = {
  observer: Observer
  /** IANA timezone used to bucket samples into a calendar night, e.g. `Europe/Berlin`. */
  timeZone: string
  /** Local calendar date the night *starts* on, `YYYY-MM-DD`. */
  date: string
  /** Core altitude floor, degrees, defining "the core is usable". */
  minCoreAltitude: number
  /** Sample spacing in minutes. Default 5. */
  stepMinutes?: number
  /**
   * The site's committed skyline, degrees per azimuth ascending from 0°. When present
   * the core floor becomes `max(minCoreAltitude, skyline(coreAzimuth) + framingMarginDeg)`
   * per sample, and the moon counts as down when it is below the skyline at its own azimuth.
   */
  horizonDeg?: readonly number[] | undefined
  /** Sky the frame needs above the ridge, degrees. Default {@link FRAMING_MARGIN_DEG}. */
  framingMarginDeg?: number | undefined
}

export type NightSample = {
  time: Date
  /** Apparent galactic-core altitude, degrees. */
  coreAltitude: number
  /** Core azimuth, degrees from north through east. */
  coreAzimuth: number
  /** Geometric sun altitude, degrees — the quantity twilight is defined on. */
  sunAltitude: number
  /** Sun azimuth, degrees from north through east. */
  sunAzimuth: number
  /** Apparent (refracted, topocentric) moon altitude, degrees. */
  moonAltitude: number
  /** Moon azimuth, degrees from north through east. */
  moonAzimuth: number
  /** True when the sun is below −18°. */
  astroDark: boolean
  /** True when the core clears the per-sample floor (`minCoreAltitude`, or the measured ridge plus framing margin when a profile was supplied). */
  coreUp: boolean
  /** Skyline altitude at `coreAzimuth`, degrees. NaN when no profile was supplied. */
  terrainAtCore: number
  /** `coreAltitude − terrainAtCore`. NaN without a profile. */
  coreClearance: number
  /** Skyline altitude at `moonAzimuth`, degrees. NaN without a profile. */
  terrainAtMoon: number
  /** True when the moon is ABOVE 0° but BELOW the skyline at its own azimuth. */
  moonBehindTerrain: boolean
}

export type ShootingWindow = {
  start: Date
  end: Date
  minutes: number
  /** Highest core altitude reached inside the window, degrees. */
  peakCoreAltitude: number
  /** Instant of `peakCoreAltitude`. */
  peakTime: Date
  /** Core azimuth at `peakTime`, degrees. */
  peakCoreAzimuth: number
  /** Highest moon altitude inside the window, degrees. Negative = moon down throughout. */
  maxMoonAltitude: number
  /** Tightest `coreClearance` inside the window, degrees — how close the ridge came. NaN without a profile. */
  minCoreClearance: number
}

export type AstroNight = {
  /** Local calendar date the night starts on. */
  date: string
  observer: Observer
  timeZone: string
  /** Start of astronomical night, or null when it never gets that dark. */
  darkStart: Date | null
  /** End of astronomical night, or null. */
  darkEnd: Date | null
  /** Duration of astronomical night in minutes. 0 when there is none. */
  darkMinutes: number
  /** Core upper transit nearest local midnight. */
  transit: Date
  /** Core altitude at transit, geometric, degrees — the ~12.8° ceiling at Munich. */
  maxCoreAltitude: number
  /** Moon illuminated fraction, 0..1, at local midnight. */
  moonIllumination: number
  /** Moon phase 0..360°: 0 = new, 90 = first quarter, 180 = full. */
  moonPhase: number
  /** Moonrise inside the sampled span, or null. */
  moonRise: Date | null
  /** Moonset inside the sampled span, or null. */
  moonSet: Date | null
  /**
   * Best contiguous stretch that is simultaneously astronomically dark and has
   * the core above `minCoreAltitude`. Null when no such stretch exists.
   */
  window: ShootingWindow | null
  /** The full sampling grid, for charting and for the caller to downsample. */
  samples: NightSample[]
  /** Highest `coreClearance` across samples that are astronomically dark. Null without a profile. */
  peakCoreClearance: number | null
}

/** Offset of `timeZone` from UTC, in minutes, at `date`. */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] === 24 ? 0 : (parts['hour'] ?? 0),
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  )
  return (asUtc - date.getTime()) / MS_PER_MINUTE
}

/**
 * Instant for a wall-clock time in `timeZone`. Two passes so a DST transition
 * on the target day resolves to the right offset rather than the one an hour
 * either side of it.
 */
export function zonedTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const firstGuess = new Date(
    naive - timeZoneOffsetMinutes(new Date(naive), timeZone) * MS_PER_MINUTE,
  )
  return new Date(naive - timeZoneOffsetMinutes(firstGuess, timeZone) * MS_PER_MINUTE)
}

/** `YYYY-MM-DD` for an instant in `timeZone`. */
export function formatLocalDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** `HH:MM` for an instant in `timeZone`. */
export function formatLocalTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Add whole days to a `YYYY-MM-DD` string, staying in the calendar. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseIsoDate(date)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function toAstroObserver(observer: Observer): AstroObserver {
  return new AstroObserver(observer.lat, observer.lon, OBSERVER_HEIGHT_M)
}

/**
 * Geometric sun horizontal coordinates — altitude AND azimuth from one
 * `Horizon()` call, no refraction, which is the convention every twilight
 * definition uses. Same rationale as {@link moonHorizontal}: a caller needing
 * both must not get them from two separate evaluations.
 */
export function sunHorizontal(
  time: Date,
  observer: Observer,
): { altitude: number; azimuth: number } {
  const astroObserver = toAstroObserver(observer)
  const equatorial = Equator(Body.Sun, time, astroObserver, true, true)
  const horizontal = Horizon(time, astroObserver, equatorial.ra, equatorial.dec)
  return { altitude: horizontal.altitude, azimuth: horizontal.azimuth }
}

/**
 * Geometric sun altitude in degrees — no refraction, which is the convention
 * every twilight definition uses.
 */
export function sunAltitudeDeg(time: Date, observer: Observer): number {
  return sunHorizontal(time, observer).altitude
}

/**
 * Apparent topocentric moon horizontal coordinates, refraction included —
 * altitude AND azimuth from the same `Horizon()` call, so a caller that needs
 * both (comparing the moon against the terrain at its own azimuth) never
 * risks the two coming from different instants.
 */
export function moonHorizontal(
  time: Date,
  observer: Observer,
): { altitude: number; azimuth: number } {
  const astroObserver = toAstroObserver(observer)
  const equatorial = Equator(Body.Moon, time, astroObserver, true, true)
  const horizontal = Horizon(time, astroObserver, equatorial.ra, equatorial.dec, 'normal')
  return { altitude: horizontal.altitude, azimuth: horizontal.azimuth }
}

/** Apparent topocentric moon altitude in degrees, refraction included. */
export function moonAltitudeDeg(time: Date, observer: Observer): number {
  return moonHorizontal(time, observer).altitude
}

/**
 * Next moonrise and next moonset at or after `from`, each within `limitDays`.
 *
 * Exposed because "when does the moon clear the horizon" is asked both by
 * {@link resolveNight} (bounded to one night's span) and by tests that check
 * the ephemeris against a published almanac day, which starts at 00:00 UTC.
 */
export function moonEvents(
  observer: Observer,
  from: Date,
  limitDays = 1,
): { rise: Date | null; set: Date | null } {
  const astroObserver = toAstroObserver(observer)
  return {
    rise: SearchRiseSet(Body.Moon, astroObserver, 1, from, limitDays)?.date ?? null,
    set: SearchRiseSet(Body.Moon, astroObserver, -1, from, limitDays)?.date ?? null,
  }
}

/** Moon illuminated fraction, 0..1. */
export function moonIlluminationFraction(time: Date): number {
  return Illumination(Body.Moon, time).phase_fraction
}

/**
 * Moon phase in degrees of ecliptic elongation: 0 = new, 90 = first quarter,
 * 180 = full, 270 = last quarter. Note this is *not* astronomy-engine's
 * `phase_angle`, which runs the other way (180 at new, 0 at full).
 */
export function moonPhaseDeg(time: Date): number {
  return MoonPhase(time)
}

/**
 * Resolve one night into darkness, moon and core geometry.
 *
 * The sampled span runs from 15:00 local on `date` to 11:00 local the next
 * day — wide enough to contain the whole of any astronomical night at the
 * latitudes this is used at, and cheap enough not to care.
 */
export function resolveNight(options: NightOptions): AstroNight {
  const { observer, timeZone, date, minCoreAltitude } = options
  /*
   * Length-checked, not truthiness-checked: `[]` is truthy, `horizonDegAt`
   * returns NaN for it, and `Math.max(floor, NaN)` is NaN — so every
   * `coreAltitude > coreFloor` would read false and the site would silently
   * report no usable night, ever, with no error anywhere.
   */
  const horizonDeg =
    options.horizonDeg !== undefined && options.horizonDeg.length > 0
      ? options.horizonDeg
      : undefined
  const stepMinutes = options.stepMinutes ?? 5
  const framingMarginDeg = options.framingMarginDeg ?? FRAMING_MARGIN_DEG
  const { year, month, day } = parseIsoDate(date)
  const astroObserver = toAstroObserver(observer)

  const spanStart = zonedTimeToUtc({ year, month, day, hour: 15, minute: 0 }, timeZone)
  const spanEnd = new Date(spanStart.getTime() + 20 * 60 * MS_PER_MINUTE)

  // Named events, from astronomy-engine's own searches — these are the numbers
  // held to USNO's minute, so they must not come off the sampling grid.
  const descending = clampToSpan(
    SearchAltitude(Body.Sun, astroObserver, -1, spanStart, 1, ASTRO_DARK_SUN_ALTITUDE)?.date ??
      null,
    spanStart,
    spanEnd,
  )
  const ascending = descending
    ? clampToSpan(
        SearchAltitude(Body.Sun, astroObserver, 1, descending, 1, ASTRO_DARK_SUN_ALTITUDE)?.date ??
          null,
        spanStart,
        spanEnd,
      )
    : null
  /*
   * Right at the no-night latitude (48.56°N on the solstice) the sun grazes
   * −18° and immediately climbs again, so the two searches return the same
   * instant. A zero-length night is no night: collapse it, rather than shipping
   * a `darkStart` that pairs with a null `darkEnd`.
   */
  const hasNight =
    descending !== null &&
    ascending !== null &&
    ascending.getTime() - descending.getTime() >= MS_PER_MINUTE
  const darkStart = hasNight ? descending : null
  const darkEnd = hasNight ? ascending : null
  const darkMinutes = hasNight
    ? Math.round((darkEnd!.getTime() - darkStart!.getTime()) / MS_PER_MINUTE)
    : 0

  const moon = moonEvents(observer, spanStart)
  const moonRise = clampToSpan(moon.rise, spanStart, spanEnd)
  const moonSet = clampToSpan(moon.set, spanStart, spanEnd)

  const samples: NightSample[] = []
  for (let t = spanStart.getTime(); t <= spanEnd.getTime(); t += stepMinutes * MS_PER_MINUTE) {
    const time = new Date(t)
    const core = galacticCorePosition(observer, time)
    const sun = sunHorizontal(time, observer)
    const sunAltitude = sun.altitude
    const moon = moonHorizontal(time, observer)
    const inDark =
      darkStart !== null &&
      darkEnd !== null &&
      time.getTime() >= darkStart.getTime() &&
      time.getTime() <= darkEnd.getTime()

    // Terrain-aware fields are NaN whole-night when no profile was supplied —
    // `horizonDegAt` never runs, so there is nothing to compare against.
    const terrainAtCore = horizonDeg ? horizonDegAt(horizonDeg, core.azimuth) : Number.NaN
    const coreClearance = horizonDeg ? core.altitude - terrainAtCore : Number.NaN
    const terrainAtMoon = horizonDeg ? horizonDegAt(horizonDeg, moon.azimuth) : Number.NaN
    // Strictly ABOVE 0° and below the ridge — below 0° the earth already did
    // the work, and crediting terrain there would count something it did not do.
    const moonBehindTerrain = horizonDeg
      ? moon.altitude > 0 && moon.altitude < terrainAtMoon
      : false

    const coreFloor = horizonDeg
      ? Math.max(minCoreAltitude, terrainAtCore + framingMarginDeg)
      : minCoreAltitude

    samples.push({
      time,
      coreAltitude: core.altitude,
      coreAzimuth: core.azimuth,
      sunAltitude,
      sunAzimuth: sun.azimuth,
      moonAltitude: moon.altitude,
      moonAzimuth: moon.azimuth,
      astroDark: inDark,
      coreUp: core.altitude > coreFloor,
      terrainAtCore,
      coreClearance,
      terrainAtMoon,
      moonBehindTerrain,
    })
  }

  const localMidnight = zonedTimeToUtc({ year, month, day: day + 1, hour: 0, minute: 0 }, timeZone)
  const shootRun = longestRun(samples, (s) => s.astroDark && s.coreUp)
  const transit = coreTransit(observer, localMidnight)

  return {
    date,
    observer,
    timeZone,
    darkStart,
    darkEnd,
    darkMinutes,
    transit,
    maxCoreAltitude: maxCoreAltitude(observer, transit),
    moonIllumination: moonIlluminationFraction(localMidnight),
    moonPhase: moonPhaseDeg(localMidnight),
    moonRise,
    moonSet,
    window: shootRun ? summarizeWindow(samples, shootRun) : null,
    samples,
    peakCoreClearance: peakCoreClearanceInDarkness(samples),
  }
}

/** Highest `coreClearance` across samples that are astronomically dark. Null without a profile. */
function peakCoreClearanceInDarkness(samples: NightSample[]): number | null {
  let peak: number | null = null
  for (const sample of samples) {
    if (!sample.astroDark || Number.isNaN(sample.coreClearance)) continue
    if (peak === null || sample.coreClearance > peak) peak = sample.coreClearance
  }
  return peak
}

function clampToSpan(date: Date | null, start: Date, end: Date): Date | null {
  if (!date) return null
  if (date.getTime() < start.getTime() || date.getTime() > end.getTime()) return null
  return date
}

type Run = { startIndex: number; endIndex: number; start: Date; end: Date }

/** Longest contiguous stretch of samples satisfying `predicate`. */
function longestRun(samples: NightSample[], predicate: (s: NightSample) => boolean): Run | null {
  let best: Run | null = null
  let runStart = -1
  for (let i = 0; i <= samples.length; i++) {
    const inRun = i < samples.length && predicate(samples[i]!)
    if (inRun && runStart === -1) runStart = i
    if (inRun || runStart === -1) continue
    const endIndex = i - 1
    if (!best || endIndex - runStart > best.endIndex - best.startIndex) {
      best = {
        startIndex: runStart,
        endIndex,
        start: samples[runStart]!.time,
        end: samples[endIndex]!.time,
      }
    }
    runStart = -1
  }
  return best
}

function summarizeWindow(samples: NightSample[], run: Run): ShootingWindow {
  let peak = samples[run.startIndex]!
  let maxMoonAltitude = -90
  // Sentinel stays +Infinity, converted to NaN below, when every sample in
  // the run has NaN clearance (no profile) — `NaN < Infinity` is false, so
  // it never gets overwritten by a real comparison.
  let minCoreClearance = Number.POSITIVE_INFINITY
  for (let i = run.startIndex; i <= run.endIndex; i++) {
    const sample = samples[i]!
    if (sample.coreAltitude > peak.coreAltitude) peak = sample
    if (sample.moonAltitude > maxMoonAltitude) maxMoonAltitude = sample.moonAltitude
    if (sample.coreClearance < minCoreClearance) minCoreClearance = sample.coreClearance
  }
  return {
    start: run.start,
    end: run.end,
    minutes: Math.round((run.end.getTime() - run.start.getTime()) / MS_PER_MINUTE),
    peakCoreAltitude: peak.coreAltitude,
    peakTime: peak.time,
    peakCoreAzimuth: peak.coreAzimuth,
    maxMoonAltitude,
    minCoreClearance: Number.isFinite(minCoreClearance) ? minCoreClearance : Number.NaN,
  }
}

/** Re-export so callers need not import both modules for the common case. */
export type { Observer }
export { coreTransit, maxCoreAltitude }
