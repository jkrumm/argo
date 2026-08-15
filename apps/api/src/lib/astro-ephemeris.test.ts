import {
  Horizon,
  MakeTime,
  Observer as AstroObserver,
  RotateVector,
  Rotation_EQJ_EQD,
  Spherical,
  VectorFromSphere,
  EquatorFromVector,
} from 'astronomy-engine'
import { describe, expect, it } from 'bun:test'
import {
  coreTransit,
  equatorialToHorizontal,
  GALACTIC_CORE_J2000,
  galacticCorePosition,
  greenwichMeanSiderealTime,
  julianDate,
  maxCoreAltitude,
  normalizeDegrees,
  normalizeSignedDegrees,
  precessFromJ2000,
  refractionDegrees,
} from './astro-ephemeris.js'

/** Munich city centre — the observer every number in the brief is anchored to. */
const MUNICH = { lat: 48.1374, lon: 11.5755 }

/** The brief's acceptance tolerance against Stellarium / PhotoPills. */
const TOLERANCE_DEG = 0.5

/**
 * Independent reference: `astronomy-engine`'s own J2000→of-date rotation and
 * horizontal transform. It shares no code with `astro-ephemeris.ts` — different
 * precession implementation, different sidereal-time series, different
 * refraction model — so agreement between the two is real evidence, not a
 * tautology.
 */
function referenceCore(date: Date, refracted: boolean) {
  const time = MakeTime(date)
  const observer = new AstroObserver(MUNICH.lat, MUNICH.lon, 0)
  const j2000 = new Spherical(GALACTIC_CORE_J2000.decDeg, GALACTIC_CORE_J2000.raDeg, 1)
  const ofDate = EquatorFromVector(
    RotateVector(Rotation_EQJ_EQD(time), VectorFromSphere(j2000, time)),
  )
  return Horizon(time, observer, ofDate.ra, ofDate.dec, refracted ? 'normal' : undefined)
}

/**
 * Committed fixtures, spread across a year. Values are the independently
 * computed reference above, recorded to four decimals so a regression shows up
 * as a literal diff rather than only as a tolerance failure.
 *
 * Altitudes are apparent (refraction included) above the horizon, which is what
 * Stellarium and PhotoPills display by default; the last fixture is far below
 * the horizon, where refraction is not defined, so it is compared geometrically.
 */
const CORE_FIXTURES = [
  { at: '2026-03-21T03:30:00Z', altitude: 9.9648, azimuth: 158.7608, refracted: true },
  { at: '2026-06-21T23:00:00Z', altitude: 12.9151, azimuth: 179.9001, refracted: true },
  { at: '2026-08-15T20:40:00Z', altitude: 11.0644, azimuth: 196.8592, refracted: true },
  { at: '2026-09-10T20:00:00Z', altitude: 6.965, azimuth: 210.007, refracted: true },
  { at: '2026-12-01T05:00:00Z', altitude: -34.2463, azimuth: 96.87, refracted: false },
] as const

describe('galacticCorePosition — fixtures', () => {
  for (const fixture of CORE_FIXTURES) {
    it(`matches the reference at ${fixture.at} within ${TOLERANCE_DEG}°`, () => {
      const date = new Date(fixture.at)
      const ours = galacticCorePosition(MUNICH, date)
      const altitude = fixture.refracted ? ours.altitude : ours.altitudeGeometric
      expect(Math.abs(altitude - fixture.altitude)).toBeLessThan(TOLERANCE_DEG)
      expect(Math.abs(ours.azimuth - fixture.azimuth)).toBeLessThan(TOLERANCE_DEG)
    })
  }

  it('agrees with a live independent ephemeris across a full year', () => {
    let worstAltitude = 0
    let worstAzimuth = 0
    for (let day = 0; day < 365; day += 7) {
      for (const hour of [0, 6, 12, 18]) {
        const date = new Date(Date.UTC(2026, 0, 1 + day, hour))
        const ours = galacticCorePosition(MUNICH, date)
        // Compare geometric altitude: the two refraction models legitimately
        // diverge below the horizon, where refraction has no physical meaning.
        const reference = referenceCore(date, false)
        worstAltitude = Math.max(
          worstAltitude,
          Math.abs(ours.altitudeGeometric - reference.altitude),
        )
        worstAzimuth = Math.max(worstAzimuth, Math.abs(ours.azimuth - reference.azimuth))
      }
    }
    expect(worstAltitude).toBeLessThan(0.01)
    expect(worstAzimuth).toBeLessThan(0.01)
  })
})

describe('core altitude ceiling at Munich', () => {
  it('never exceeds ~13° across a full simulated year', () => {
    let peak = -90
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 10 * 60_000) {
      const altitude = galacticCorePosition(MUNICH, new Date(t)).altitude
      if (altitude > peak) peak = altitude
    }
    // Geometric ceiling is 90 − (lat − dec) = 12.85°; refraction adds ~0.07°.
    expect(peak).toBeGreaterThan(12.8)
    expect(peak).toBeLessThan(13)
  })

  it('has a closed form matching the sampled peak', () => {
    const closedForm = maxCoreAltitude(MUNICH, new Date('2026-08-15T00:00:00Z'))
    expect(closedForm).toBeCloseTo(12.846, 2)
  })

  it('rises higher the further south the observer', () => {
    const date = new Date('2026-08-15T00:00:00Z')
    expect(maxCoreAltitude({ lat: 28.3, lon: -16.5 }, date)).toBeGreaterThan(
      maxCoreAltitude(MUNICH, date),
    )
  })
})

describe('coreTransit', () => {
  it('puts the core due south at its own transit', () => {
    const transit = coreTransit(MUNICH, new Date('2026-08-16T00:00:00Z'))
    const position = galacticCorePosition(MUNICH, transit)
    expect(Math.abs(position.azimuth - 180)).toBeLessThan(0.05)
    expect(position.hourAngle).toBeCloseTo(0, 3)
  })

  it('reaches the day’s maximum altitude at transit', () => {
    const transit = coreTransit(MUNICH, new Date('2026-08-16T00:00:00Z'))
    const atTransit = galacticCorePosition(MUNICH, transit).altitude
    for (const offsetMinutes of [-120, -30, -5, 5, 30, 120]) {
      const other = galacticCorePosition(
        MUNICH,
        new Date(transit.getTime() + offsetMinutes * 60_000),
      )
      expect(other.altitude).toBeLessThanOrEqual(atTransit + 1e-9)
    }
  })

  it('lands ~21:24 CEST on 2026-08-15, before astronomical dark', () => {
    const transit = coreTransit(MUNICH, new Date('2026-08-16T00:00:00+02:00'))
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).format(transit)
    expect(local).toBe('21:24')
  })
})

describe('precessFromJ2000', () => {
  it('is a no-op at the J2000 epoch itself', () => {
    const epoch = new Date('2000-01-01T12:00:00Z')
    const precessed = precessFromJ2000(GALACTIC_CORE_J2000, epoch)
    expect(precessed.raDeg).toBeCloseTo(GALACTIC_CORE_J2000.raDeg, 4)
    expect(precessed.decDeg).toBeCloseTo(GALACTIC_CORE_J2000.decDeg, 4)
  })

  it('moves RA by roughly 0.4° between J2000 and 2026', () => {
    const precessed = precessFromJ2000(GALACTIC_CORE_J2000, new Date('2026-01-01T00:00:00Z'))
    const drift = precessed.raDeg - GALACTIC_CORE_J2000.raDeg
    expect(drift).toBeGreaterThan(0.35)
    expect(drift).toBeLessThan(0.45)
    // Declination barely moves near this RA — cos(266°) is almost zero.
    expect(Math.abs(precessed.decDeg - GALACTIC_CORE_J2000.decDeg)).toBeLessThan(0.02)
  })
})

describe('greenwichMeanSiderealTime', () => {
  it('matches the standard value at the J2000 epoch', () => {
    // GMST at 2000-01-01T12:00 UT is 18h 41m 50.55s = 280.46062°.
    expect(greenwichMeanSiderealTime(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(280.46062, 3)
  })

  it('advances one sidereal day, not one solar day, per 24 h', () => {
    const start = new Date('2026-08-15T00:00:00Z')
    const later = new Date(start.getTime() + 86_400_000)
    const advance = normalizeDegrees(
      greenwichMeanSiderealTime(later) - greenwichMeanSiderealTime(start),
    )
    expect(advance).toBeCloseTo(0.98565, 4)
  })
})

describe('equatorialToHorizontal', () => {
  it('puts an object at the zenith when its declination equals the latitude at transit', () => {
    const date = new Date('2026-08-15T21:00:00Z')
    const lst = greenwichMeanSiderealTime(date) + MUNICH.lon
    const result = equatorialToHorizontal(
      { raDeg: normalizeDegrees(lst), decDeg: MUNICH.lat },
      MUNICH,
      date,
    )
    expect(result.altitudeGeometric).toBeCloseTo(90, 4)
  })

  it('puts the celestial pole at due north, at an altitude equal to the latitude', () => {
    const result = equatorialToHorizontal(
      { raDeg: 0, decDeg: 90 },
      MUNICH,
      new Date('2026-08-15T21:00:00Z'),
    )
    expect(result.altitudeGeometric).toBeCloseTo(MUNICH.lat, 6)
    expect(result.azimuth).toBeCloseTo(0, 6)
  })

  it('mirrors azimuth about the meridian for equal hour angles either side', () => {
    const transit = coreTransit(MUNICH, new Date('2026-08-16T00:00:00Z'))
    const before = galacticCorePosition(MUNICH, new Date(transit.getTime() - 90 * 60_000))
    const after = galacticCorePosition(MUNICH, new Date(transit.getTime() + 90 * 60_000))
    expect(before.altitude).toBeCloseTo(after.altitude, 3)
    // Symmetric about due south: (180 − x) + (180 + x) = 360.
    expect(before.azimuth + after.azimuth).toBeCloseTo(360, 1)
  })
})

describe('refractionDegrees', () => {
  it('is about 34 arcminutes at the horizon', () => {
    expect(refractionDegrees(0) * 60).toBeCloseTo(34, 0)
  })

  it('is under 5 arcminutes at the core’s Munich ceiling', () => {
    expect(refractionDegrees(12.85) * 60).toBeLessThan(5)
  })

  it('is zero well below the horizon, where it has no meaning', () => {
    expect(refractionDegrees(-5)).toBe(0)
  })
})

describe('angle normalisation', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeDegrees(-10)).toBe(350)
    expect(normalizeDegrees(370)).toBe(10)
    expect(normalizeDegrees(360)).toBe(0)
  })

  it('wraps into (−180, 180]', () => {
    expect(normalizeSignedDegrees(190)).toBe(-170)
    expect(normalizeSignedDegrees(-190)).toBe(170)
    expect(normalizeSignedDegrees(180)).toBe(180)
  })
})

describe('julianDate', () => {
  it('returns 2451545.0 at the J2000 epoch', () => {
    expect(julianDate(new Date('2000-01-01T12:00:00Z'))).toBe(2451545)
  })
})
