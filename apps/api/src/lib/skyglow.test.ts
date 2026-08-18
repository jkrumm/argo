import { describe, it, expect } from 'bun:test'
import {
  coreDirectionGlow,
  compassPoint,
  marchRay,
  rayWeight,
  skyglowProfile,
  vanRhijnAirglow,
  SKYGLOW_MODEL,
  type LpiSampler,
} from './skyglow.js'

const SITE = { lat: 48, lon: 11 }
const KM_PER_DEG_LAT = 111.32
const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos((SITE.lat * Math.PI) / 180)

/** Faint but non-zero, so the calibration ray has something to divide by. */
const DARK_LPI = 1e-4

/**
 * One bright town 40 km NNE of the site and nothing else — the shape the model
 * is supposed to resolve. Everything outside the town's 3 km radius is a
 * pristine field, so any direction the profile calls dominant other than NNE is
 * the march losing its bearing.
 */
function oneTownSampler(azimuthDeg: number, rangeKm = 40): LpiSampler {
  const azimuth = (azimuthDeg * Math.PI) / 180
  const townLat = SITE.lat + (rangeKm * Math.cos(azimuth)) / KM_PER_DEG_LAT
  const townLon = SITE.lon + (rangeKm * Math.sin(azimuth)) / KM_PER_DEG_LON

  return (lat, lon) => {
    const dLatKm = (lat - townLat) * KM_PER_DEG_LAT
    const dLonKm = (lon - townLon) * KM_PER_DEG_LON
    return Math.hypot(dLatKm, dLonKm) < 3 ? 500 : DARK_LPI
  }
}

const uniformSampler: LpiSampler = () => DARK_LPI

describe('rayWeight', () => {
  it('falls off with range at a fixed altitude', () => {
    const near = rayWeight(10, 10, SKYGLOW_MODEL)
    const far = rayWeight(50, 10, SKYGLOW_MODEL)
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
  })

  it('falls off with altitude at a fixed range — a light dome sits low', () => {
    const low = rayWeight(30, 5, SKYGLOW_MODEL)
    const mid = rayWeight(30, 13, SKYGLOW_MODEL)
    const high = rayWeight(30, 30, SKYGLOW_MODEL)
    expect(low).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(high)
  })

  it('keeps only the site itself at the zenith, which is what makes the calibration exact', () => {
    expect(rayWeight(0, 90, SKYGLOW_MODEL)).toBe(1)
    expect(rayWeight(2, 90, SKYGLOW_MODEL)).toBe(0)
  })

  it('floors at the horizon instead of amplifying the far field below it', () => {
    // Without the floor the exponent flips sign and a cell 120 km out counts
    // 2.4e4x at -30 degrees, so the march reads as brightest where it sees least.
    for (const alt of [-1, -8.67, -30]) {
      expect(rayWeight(120, alt, SKYGLOW_MODEL)).toBe(rayWeight(120, 0, SKYGLOW_MODEL))
      expect(rayWeight(120, alt, SKYGLOW_MODEL)).toBeLessThan(rayWeight(0, alt, SKYGLOW_MODEL))
    }
  })
})

describe('marchRay', () => {
  it('finds far more light toward the town than away from it', () => {
    const sampler = oneTownSampler(22.5)
    const toward = marchRay({ sampler, site: SITE, azimuthDeg: 22.5, altitudeDeg: 10 })
    const away = marchRay({ sampler, site: SITE, azimuthDeg: 202.5, altitudeDeg: 10 })
    expect(toward).toBeGreaterThan(away * 100)
  })

  it('skips cells the sampler has no data for rather than reading them as dark', () => {
    const withHole: LpiSampler = (lat, lon) =>
      lat === SITE.lat && lon === SITE.lon ? DARK_LPI : Number.NaN
    // Only the r = 0 sample survives, so the ray equals that one weighted cell.
    expect(marchRay({ sampler: withHole, site: SITE, azimuthDeg: 0, altitudeDeg: 10 })).toBeCloseTo(
      DARK_LPI,
      10,
    )
  })
})

describe('skyglowProfile', () => {
  it('puts the dominant direction on the town', () => {
    const profile = skyglowProfile({
      sampler: oneTownSampler(22.5),
      site: SITE,
      zenithLpi: DARK_LPI,
    })
    expect(profile.dominant.compass).toBe('NNE')
    expect(compassPoint(profile.dominant.azimuthDeg)).toBe('NNE')
  })

  it('covers the full circle at 5 degree steps and the seven reported altitudes', () => {
    const profile = skyglowProfile({ sampler: uniformSampler, site: SITE, zenithLpi: DARK_LPI })
    expect(profile.azimuths.length).toBe(72)
    expect(profile.altitudes).toEqual([5, 8, 10, 13, 15, 20, 30])
    expect(profile.mpsas.length).toBe(profile.altitudes.length)
    expect(profile.mpsas[0]?.length).toBe(profile.azimuths.length)
  })

  it('calibrates the zenith ray to exactly the atlas value', () => {
    const profile = skyglowProfile({ sampler: uniformSampler, site: SITE, zenithLpi: DARK_LPI })
    expect(profile.calibration).toBeCloseTo(1, 10)
  })

  it('still resolves the dome when the site cell itself reads exactly 0', () => {
    // A pristine cell is 0 LPI (63% of the Mauna Kea tile is), which leaves
    // nothing to calibrate against. Falling back to 0 rather than the identity
    // would flatten every direction to the 22.0 baseline and erase a real dome.
    const pristine: LpiSampler = (lat, lon) =>
      lat === SITE.lat && lon === SITE.lon ? 0 : oneTownSampler(22.5)(lat, lon)
    const profile = skyglowProfile({ sampler: pristine, site: SITE, zenithLpi: 0 })

    expect(profile.calibration).toBe(1)
    expect(profile.dominant.compass).toBe('NNE')
    expect(profile.dominant.mpsas).toBeLessThan(21)
  })
})

describe('coreDirectionGlow', () => {
  it('charges no dome penalty on a uniformly dark field', () => {
    const core = coreDirectionGlow({
      sampler: uniformSampler,
      site: SITE,
      zenithLpi: DARK_LPI,
      coreAzimuthDeg: 180,
      coreAltitudeDeg: 13,
    })
    expect(core.domePenaltyMag).toBeCloseTo(0, 2)
  })

  it('charges a real penalty when the town sits where the core does', () => {
    const behind = coreDirectionGlow({
      sampler: oneTownSampler(0),
      site: SITE,
      zenithLpi: DARK_LPI,
      coreAzimuthDeg: 180,
      coreAltitudeDeg: 13,
    })
    const infront = coreDirectionGlow({
      sampler: oneTownSampler(180),
      site: SITE,
      zenithLpi: DARK_LPI,
      coreAzimuthDeg: 180,
      coreAltitudeDeg: 13,
    })
    expect(infront.domePenaltyMag).toBeGreaterThan(behind.domePenaltyMag + 1)
    // Brighter sky is a LOWER magnitude — the scale runs backwards.
    expect(infront.mpsas).toBeLessThan(behind.mpsas)
  })
})

describe('atmosphere helpers', () => {
  it('adds airglow path length toward the horizon and none at the zenith', () => {
    expect(vanRhijnAirglow(90)).toBeCloseTo(1, 6)
    expect(vanRhijnAirglow(13)).toBeGreaterThan(1)
    expect(vanRhijnAirglow(13)).toBeGreaterThan(vanRhijnAirglow(30))
  })
})
