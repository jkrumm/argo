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

const MS_PER_MINUTE = 60_000

/** Sun altitude defining astronomical night. */
export const ASTRO_DARK_SUN_ALTITUDE = -18

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
}

export type NightSample = {
  time: Date
  /** Apparent galactic-core altitude, degrees. */
  coreAltitude: number
  /** Core azimuth, degrees from north through east. */
  coreAzimuth: number
  /** Geometric sun altitude, degrees — the quantity twilight is defined on. */
  sunAltitude: number
  /** Apparent (refracted, topocentric) moon altitude, degrees. */
  moonAltitude: number
  /** True when the sun is below −18°. */
  astroDark: boolean
  /** True when the core clears `minCoreAltitude`. */
  coreUp: boolean
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
 * Geometric sun altitude in degrees — no refraction, which is the convention
 * every twilight definition uses.
 */
export function sunAltitudeDeg(time: Date, observer: Observer): number {
  const astroObserver = toAstroObserver(observer)
  const equatorial = Equator(Body.Sun, time, astroObserver, true, true)
  return Horizon(time, astroObserver, equatorial.ra, equatorial.dec).altitude
}

/** Apparent topocentric moon altitude in degrees, refraction included. */
export function moonAltitudeDeg(time: Date, observer: Observer): number {
  const astroObserver = toAstroObserver(observer)
  const equatorial = Equator(Body.Moon, time, astroObserver, true, true)
  return Horizon(time, astroObserver, equatorial.ra, equatorial.dec, 'normal').altitude
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
  const stepMinutes = options.stepMinutes ?? 5
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
    const sunAltitude = sunAltitudeDeg(time, observer)
    const moonAltitude = moonAltitudeDeg(time, observer)
    const inDark =
      darkStart !== null &&
      darkEnd !== null &&
      time.getTime() >= darkStart.getTime() &&
      time.getTime() <= darkEnd.getTime()
    samples.push({
      time,
      coreAltitude: core.altitude,
      coreAzimuth: core.azimuth,
      sunAltitude,
      moonAltitude,
      astroDark: inDark,
      coreUp: core.altitude > minCoreAltitude,
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
  }
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
  for (let i = run.startIndex; i <= run.endIndex; i++) {
    const sample = samples[i]!
    if (sample.coreAltitude > peak.coreAltitude) peak = sample
    if (sample.moonAltitude > maxMoonAltitude) maxMoonAltitude = sample.moonAltitude
  }
  return {
    start: run.start,
    end: run.end,
    minutes: Math.round((run.end.getTime() - run.start.getTime()) / MS_PER_MINUTE),
    peakCoreAltitude: peak.coreAltitude,
    peakTime: peak.time,
    peakCoreAzimuth: peak.coreAzimuth,
    maxMoonAltitude,
  }
}

/** Re-export so callers need not import both modules for the common case. */
export type { Observer }
export { coreTransit, maxCoreAltitude }
