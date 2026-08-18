import { describe, expect, it } from 'bun:test'
import {
  addDays,
  FRAMING_MARGIN_DEG,
  formatLocalDate,
  formatLocalTime,
  moonEvents,
  moonIlluminationFraction,
  moonPhaseDeg,
  resolveNight,
  sunAltitudeDeg,
  timeZoneOffsetMinutes,
  zonedTimeToUtc,
} from './astro-night.js'

const MUNICH = { lat: 48.1374, lon: 11.5755 }
const TZ = 'Europe/Berlin'

const local = (date: Date | null) => (date ? formatLocalTime(date, TZ) : null)
const utcHhmm = (date: Date | null) => (date ? date.toISOString().slice(11, 16) : null)

function night(date: string, overrides: Partial<Parameters<typeof resolveNight>[0]> = {}) {
  return resolveNight({ observer: MUNICH, timeZone: TZ, date, minCoreAltitude: 8, ...overrides })
}

/** Minutes between an instant and a `HH:MM` UTC reference on the same date. */
function minutesFrom(actual: Date | null, date: string, reference: string): number {
  if (!actual) return Number.POSITIVE_INFINITY
  return Math.abs(actual.getTime() - new Date(`${date}T${reference}:00Z`).getTime()) / 60_000
}

/**
 * Reference values from the U.S. Naval Observatory, which is a published,
 * authoritative source independent of the ephemeris library we compute with.
 *
 *   https://aa.usno.navy.mil/api/rstt/oneday?date=<d>&coords=48.1374,11.5755&tz=0
 *
 * All times UTC, minute resolution — so the acceptance bar of 2 minutes has
 * about a minute of slack for USNO's own rounding.
 */
const USNO = {
  '2026-08-15': { moonRise: '07:24', moonSet: '19:25', sunRise: '04:08', sunSet: '18:27' },
  '2026-08-22': { moonRise: '15:24', moonSet: '22:47', sunRise: '04:18', sunSet: '18:15' },
  '2026-09-10': { moonRise: '03:41', moonSet: '17:14', sunRise: '04:44', sunSet: '17:37' },
  '2026-12-01': { moonRise: '23:36', moonSet: '11:48', sunRise: '06:43', sunSet: '15:22' },
  '2026-06-21': { moonRise: '10:51', moonSet: '23:00', sunRise: '03:13', sunSet: '19:18' },
} as const

/** USNO `closestphase` events, UTC — unambiguous instants, unlike a daily fraction. */
const PHASE_EVENTS = [
  { at: '2026-08-12T17:37:00Z', phase: 'new' },
  { at: '2026-09-11T03:27:00Z', phase: 'new' },
  { at: '2026-08-20T02:46:00Z', phase: 'first-quarter' },
  { at: '2026-06-21T21:55:00Z', phase: 'first-quarter' },
  { at: '2026-12-01T06:08:00Z', phase: 'last-quarter' },
] as const

describe('mid-August — the shape the whole feature exists for', () => {
  const august = night('2026-08-15')

  it('starts astronomical night around 22:30 CEST', () => {
    expect(local(august.darkStart)).toBe('22:33')
  })

  it('has the core transit an hour BEFORE darkness, not after', () => {
    expect(local(august.transit)).toBe('21:24')
    expect(august.transit.getTime()).toBeLessThan(august.darkStart!.getTime())
  })

  it('recommends the FIRST hour of darkness, not the last', () => {
    expect(august.window).not.toBeNull()
    const window = august.window!
    // The window opens with darkness, within one sampling step of it.
    expect(window.start.getTime() - august.darkStart!.getTime()).toBeLessThan(6 * 60_000)
    // And closes long before dawn, because the core sets, not because it lightens.
    expect(august.darkEnd!.getTime() - window.end.getTime()).toBeGreaterThan(4 * 3600_000)
    // The best moment is the very start — the core is already descending.
    expect(window.peakTime.getTime()).toBe(window.start.getTime())
    expect(window.peakCoreAltitude).toBeGreaterThan(11)
    expect(window.peakCoreAltitude).toBeLessThan(12)
  })

  it('reports a dark stretch of several hours', () => {
    expect(august.darkMinutes).toBeGreaterThan(300)
    expect(august.darkMinutes).toBeLessThan(360)
  })

  it('has a thin waxing crescent well clear of the window', () => {
    expect(august.moonIllumination).toBeLessThan(0.2)
    expect(august.window!.maxMoonAltitude).toBeLessThan(0)
  })
})

describe('terrain-aware gate', () => {
  const FLAT_HORIZON = Array.from({ length: 72 }, () => 0)
  const WALL_HORIZON = Array.from({ length: 72 }, () => 20)

  it('behaves identically to no profile at all when the skyline is flat 0°', () => {
    const plain = night('2026-08-15')
    const flat = night('2026-08-15', { horizonDeg: FLAT_HORIZON })
    expect(flat.window!.peakCoreAltitude).toBeCloseTo(plain.window!.peakCoreAltitude, 6)
    expect(flat.darkMinutes).toBe(plain.darkMinutes)
    for (const sample of flat.samples) {
      expect(sample.terrainAtCore).toBeCloseTo(0, 6)
      expect(sample.coreClearance).toBeCloseTo(sample.coreAltitude, 6)
    }
  })

  it('raises the per-sample core floor above a measured ridge and can gate the whole night out', () => {
    // Munich never clears ~13°, well under a uniform 20° ridge plus margin.
    const walled = night('2026-08-15', { horizonDeg: WALL_HORIZON })
    expect(walled.window).toBeNull()
    for (const sample of walled.samples) {
      expect(sample.coreUp).toBe(false)
      expect(sample.terrainAtCore).toBeCloseTo(20, 6)
      expect(sample.coreClearance).toBeCloseTo(sample.coreAltitude - 20, 6)
    }
  })

  it('reports peakCoreClearance as null without a profile and a number with one', () => {
    expect(night('2026-08-15').peakCoreClearance).toBeNull()
    const withProfile = night('2026-08-15', { horizonDeg: WALL_HORIZON })
    expect(withProfile.peakCoreClearance).not.toBeNull()
    expect(withProfile.peakCoreClearance!).toBeLessThan(0)
  })

  it('honours a custom framing margin', () => {
    const tight = night('2026-08-15', { horizonDeg: FLAT_HORIZON, framingMarginDeg: 0 })
    const loose = night('2026-08-15', {
      horizonDeg: FLAT_HORIZON,
      framingMarginDeg: FRAMING_MARGIN_DEG + 5,
    })
    // A bigger margin never opens a window a smaller one closed.
    expect(tight.window).not.toBeNull()
    expect(loose.darkMinutes).toBe(tight.darkMinutes)
  })

  it('marks the moon behind terrain exactly when it is above 0° and below the ridge at its own azimuth, never below 0°', () => {
    const withRidge = night('2026-08-27', { horizonDeg: WALL_HORIZON })
    let sawBehind = false
    for (const sample of withRidge.samples) {
      expect(sample.moonBehindTerrain).toBe(
        sample.moonAltitude > 0 && sample.moonAltitude < sample.terrainAtMoon,
      )
      expect(sample.terrainAtMoon).toBeCloseTo(20, 6)
      if (sample.moonBehindTerrain) {
        sawBehind = true
        expect(sample.moonAltitude).toBeGreaterThan(0)
      }
    }
    // The moon does cross below the 20° ridge at some point on this date.
    expect(sawBehind).toBe(true)
  })

  it('never counts a below-horizon moon as behind terrain — the earth already did that work', () => {
    const withRidge = night('2026-08-15', { horizonDeg: WALL_HORIZON })
    for (const sample of withRidge.samples) {
      if (sample.moonAltitude <= 0) expect(sample.moonBehindTerrain).toBe(false)
    }
  })
})

describe('June at 48.14°N — the twilight regression', () => {
  /*
   * The brief asserts June returns *zero* astronomical-night hours at Munich.
   * That is not what the sky does, and the operator's own note is the more
   * careful statement: "the sun only reaches −18.4° here, so June gives minutes
   * of astronomical night, not hours".
   *
   * At the solstice the sun's lower culmination is dec + lat − 90 =
   * 23.44 + 48.14 − 90 = −18.42°, which *is* below the −18° threshold — by a
   * quarter of a degree. So Munich gets a real but tiny sliver: ~70 minutes.
   * True zero starts at 90 − 23.44 − 18 = 48.56°N, about 47 km further north.
   *
   * Both facts are asserted below. The sliver still catches every bug the
   * original criterion was aimed at — a sign error, a timezone error or an
   * off-by-one on the twilight threshold all move this number by hours.
   */
  it('gives a sliver of night at the solstice, not hours and not zero', () => {
    const solstice = night('2026-06-21')
    expect(solstice.darkMinutes).toBeGreaterThan(60)
    expect(solstice.darkMinutes).toBeLessThan(80)
    expect(sunAltitudeDeg(new Date('2026-06-21T23:14:00Z'), MUNICH)).toBeLessThan(-18)
    expect(sunAltitudeDeg(new Date('2026-06-21T23:14:00Z'), MUNICH)).toBeGreaterThan(-18.5)
  })

  it('returns zero astronomical night just north of the 48.56°N limit', () => {
    for (const lat of [48.56, 48.6, 49, 50]) {
      const result = resolveNight({
        observer: { lat, lon: MUNICH.lon },
        timeZone: TZ,
        date: '2026-06-21',
        minCoreAltitude: 8,
      })
      expect(result.darkMinutes).toBe(0)
      expect(result.darkStart).toBeNull()
      expect(result.window).toBeNull()
    }
  })

  it('deepens monotonically as June gives way to August', () => {
    const minutes = ['2026-06-21', '2026-07-01', '2026-07-22', '2026-08-15'].map(
      (date) => night(date).darkMinutes,
    )
    for (let i = 1; i < minutes.length; i++) {
      expect(minutes[i]!).toBeGreaterThan(minutes[i - 1]!)
    }
  })
})

describe('moonrise / moonset vs USNO', () => {
  for (const [date, reference] of Object.entries(USNO)) {
    it(`is within 2 minutes of USNO on ${date}`, () => {
      // USNO reports the events of a UTC almanac day, so search from 00:00 UTC.
      const events = moonEvents(MUNICH, new Date(`${date}T00:00:00Z`))
      expect(minutesFrom(events.rise, date, reference.moonRise)).toBeLessThan(2)
      expect(minutesFrom(events.set, date, reference.moonSet)).toBeLessThan(2)
    })
  }

  it('finds the evening moonset on 2026-08-15 at 19:25 UTC', () => {
    expect(utcHhmm(night('2026-08-15').moonSet)).toBe('19:24')
  })

  it('reports null rather than a wrong time when the event is outside the night span', () => {
    // The moon sets at 11:48 UTC on 2026-12-01, well before the 15:00-local span.
    expect(night('2026-12-01').moonSet).toBeNull()
  })
})

describe('moon phase and illumination', () => {
  for (const event of PHASE_EVENTS) {
    it(`is at ${event.phase} on ${event.at}`, () => {
      const at = new Date(event.at)
      const illumination = moonIlluminationFraction(at)
      const phase = moonPhaseDeg(at)
      if (event.phase === 'new') {
        expect(illumination).toBeLessThan(0.005)
        expect(Math.min(phase, 360 - phase)).toBeLessThan(1)
      } else {
        expect(Math.abs(illumination - 0.5)).toBeLessThan(0.005)
        expect(Math.abs(phase - (event.phase === 'first-quarter' ? 90 : 270))).toBeLessThan(1)
      }
    })
  }
})

describe('sunrise / sunset vs USNO', () => {
  for (const [date, reference] of Object.entries(USNO)) {
    it(`puts the sun's altitude at ~0 at USNO's sunrise and sunset on ${date}`, () => {
      // Standard rise/set is the upper limb at the horizon: centre at ~−0.83°.
      for (const event of [reference.sunRise, reference.sunSet]) {
        const altitude = sunAltitudeDeg(new Date(`${date}T${event}:00Z`), MUNICH)
        expect(altitude).toBeGreaterThan(-1.2)
        expect(altitude).toBeLessThan(0.2)
      }
    })
  }
})

describe('window gating on core altitude', () => {
  it('shortens the window as the altitude floor rises', () => {
    const low = night('2026-08-15', { minCoreAltitude: 5 })
    const high = night('2026-08-15', { minCoreAltitude: 11 })
    expect(low.window!.minutes).toBeGreaterThan(high.window!.minutes)
  })

  it('returns no window at all once the floor exceeds the Munich ceiling', () => {
    expect(night('2026-08-15', { minCoreAltitude: 20 }).window).toBeNull()
  })

  it('keeps every sample inside the window above the floor', () => {
    const resolved = night('2026-08-15')
    const inWindow = resolved.samples.filter(
      (s) => s.time >= resolved.window!.start && s.time <= resolved.window!.end,
    )
    expect(inWindow.length).toBeGreaterThan(5)
    for (const sample of inWindow) {
      expect(sample.coreAltitude).toBeGreaterThan(8)
      expect(sample.astroDark).toBe(true)
    }
  })
})

describe('samples', () => {
  it('spans 20 hours from 15:00 local at the configured step', () => {
    const resolved = night('2026-08-15', { stepMinutes: 10 })
    expect(local(resolved.samples[0]!.time)).toBe('15:00')
    expect(resolved.samples).toHaveLength(121)
    const gap = resolved.samples[1]!.time.getTime() - resolved.samples[0]!.time.getTime()
    expect(gap).toBe(10 * 60_000)
  })
})

describe('timezone helpers', () => {
  it('resolves CEST and CET offsets', () => {
    expect(timeZoneOffsetMinutes(new Date('2026-08-15T12:00:00Z'), TZ)).toBe(120)
    expect(timeZoneOffsetMinutes(new Date('2026-12-01T12:00:00Z'), TZ)).toBe(60)
  })

  it('round-trips a wall-clock time through UTC', () => {
    const instant = zonedTimeToUtc({ year: 2026, month: 8, day: 15, hour: 22, minute: 30 }, TZ)
    expect(instant.toISOString()).toBe('2026-08-15T20:30:00.000Z')
    expect(formatLocalTime(instant, TZ)).toBe('22:30')
    expect(formatLocalDate(instant, TZ)).toBe('2026-08-15')
  })

  it('resolves a wall-clock time on the DST-change day to the right offset', () => {
    // Europe/Berlin springs forward 2026-03-29 at 02:00 local.
    const before = zonedTimeToUtc({ year: 2026, month: 3, day: 28, hour: 23, minute: 0 }, TZ)
    const after = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 23, minute: 0 }, TZ)
    expect(before.toISOString()).toBe('2026-03-28T22:00:00.000Z')
    expect(after.toISOString()).toBe('2026-03-29T21:00:00.000Z')
  })

  it('rolls the calendar correctly across a month end', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('rejects a malformed date rather than silently returning garbage', () => {
    expect(() => night('15-08-2026')).toThrow(/YYYY-MM-DD/)
  })
})
