import { describe, it, expect } from 'bun:test'
import {
  HORIZON_AZIMUTH_STEP_DEG,
  HORIZON_RANGE_M,
  HORIZON_STEP_M,
  SOUTH_ARC,
  horizonProfile,
  southernHorizon,
  terrariumElevation,
  type ElevationSampler,
} from './terrain-horizon.js'

const SITE = { lat: 48, lon: 11 }
const M_PER_DEG_LAT = 111_320
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((SITE.lat * Math.PI) / 180)

/** Sea level everywhere — the case where only curvature is left. */
const flatSampler: ElevationSampler = () => 0

const noDataSampler: ElevationSampler = () => Number.NaN

/**
 * One 500 m block due east at exactly 9900 m — a multiple of the 150 m step, so
 * a ray lands on it — and nothing else. The ±50 m window is narrower than the
 * 862 m cross-track offset the neighbouring 5° rays pick up at that range, so
 * exactly one azimuth can see it.
 */
const ridgeSampler: ElevationSampler = (lat, lon) => {
  const eastM = (lon - SITE.lon) * M_PER_DEG_LON
  const northM = (lat - SITE.lat) * M_PER_DEG_LAT
  return Math.abs(eastM - 9900) < 50 && Math.abs(northM) < 50 ? 500 : 0
}

function at(profile: ReturnType<typeof horizonProfile>, azimuthDeg: number) {
  const point = profile.points.find((p) => p.azimuthDeg === azimuthDeg)
  if (!point) throw new Error(`no profile point at ${azimuthDeg}°`)
  return point
}

describe('terrariumElevation', () => {
  it('decodes the Mapzen triple, offset and fractional byte included', () => {
    expect(terrariumElevation(0, 0, 0)).toBe(-32768)
    expect(terrariumElevation(128, 0, 0)).toBe(0)
    expect(terrariumElevation(128, 100, 128)).toBe(100.5)
    // Munich-ish: 128*256 + 525 - 32768 → carries into the red byte.
    expect(terrariumElevation(130, 13, 0)).toBe(525)
  })
})

describe('horizonProfile', () => {
  it('walks the whole compass at the declared azimuth step', () => {
    const profile = horizonProfile({ sampler: flatSampler, site: SITE })
    expect(profile.points).toHaveLength(360 / HORIZON_AZIMUTH_STEP_DEG)
    expect(profile.points[0]!.azimuthDeg).toBe(0)
    expect(profile.points.at(-1)!.azimuthDeg).toBe(360 - HORIZON_AZIMUTH_STEP_DEG)
  })

  it('reports a flat plane as slightly BELOW zero — proof the curvature term is applied', () => {
    const profile = horizonProfile({ sampler: flatSampler, site: SITE })
    expect(profile.elevationM).toBe(0)

    for (const point of profile.points) {
      expect(point.altitudeDeg).toBeLessThan(0)
      // The closest sample is the least depressed one, so it always wins the max.
      expect(point.altitudeDeg).toBeCloseTo(-0.000587, 6)
      expect(point.rangeM).toBe(HORIZON_STEP_M)
    }
  })

  it('measures a single ridge at the angle the geometry says it subtends', () => {
    const profile = horizonProfile({ sampler: ridgeSampler, site: SITE })
    const east = at(profile, 90)

    // R_eff = 6371000 / (1 - 0.13) = 7 323 908.0 m
    // drop   = 9900² / (2 · R_eff)  = 6.6919 m
    // angle  = atan2(500 − 6.6919, 9900) = 2.85264°
    expect(east.altitudeDeg).toBeCloseTo(2.85264, 4)
    expect(east.rangeM).toBe(9900)
    expect(east.summitM).toBe(500)

    // Its 5° neighbours miss the block entirely and stay on the flat plane.
    expect(at(profile, 85).altitudeDeg).toBeLessThan(0)
    expect(at(profile, 95).altitudeDeg).toBeLessThan(0)
  })

  it('never lets a hole in the model read as a horizon at eye level', () => {
    const profile = horizonProfile({ sampler: noDataSampler, site: SITE })
    expect(Number.isNaN(profile.elevationM)).toBe(true)
    for (const point of profile.points) expect(point.altitudeDeg).toBe(-90)
  })

  it('stops at the declared range', () => {
    const seen: number[] = []
    horizonProfile({
      sampler: (lat, lon) => {
        seen.push(Math.hypot((lat - SITE.lat) * M_PER_DEG_LAT, (lon - SITE.lon) * M_PER_DEG_LON))
        return 0
      },
      site: SITE,
    })
    expect(Math.max(...seen)).toBeCloseTo(HORIZON_RANGE_M, 3)
  })
})

describe('southernHorizon', () => {
  it('averages only the arc the core crosses', () => {
    // A 1000 m wall filling the whole southern arc at 20 km, flat elsewhere.
    const sampler: ElevationSampler = (lat, lon) => {
      const eastM = (lon - SITE.lon) * M_PER_DEG_LON
      const northM = (lat - SITE.lat) * M_PER_DEG_LAT
      const rangeM = Math.hypot(eastM, northM)
      const azimuthDeg = ((Math.atan2(eastM, northM) * 180) / Math.PI + 360) % 360
      // Half a degree of slack either side so float error on the arc's own
      // endpoints cannot drop a ray the profile does count.
      const inArc = azimuthDeg >= SOUTH_ARC.fromDeg - 0.5 && azimuthDeg <= SOUTH_ARC.toDeg + 0.5
      return inArc && Math.abs(rangeM - 20_000) < 100 ? 1000 : 0
    }

    const profile = horizonProfile({ sampler, site: SITE })
    const south = southernHorizon(profile)

    // The nearest 150 m sample inside the wall is 19 950 m:
    // drop = 19950² / (2 · 7 323 908) = 27.17 m → atan2(972.83, 19950) = 2.7917°
    expect(south.maxDeg).toBeCloseTo(2.7917, 3)
    expect(south.meanDeg).toBeCloseTo(2.7917, 3)
    // Due north is outside the arc and stays flat.
    expect(at(profile, 0).altitudeDeg).toBeLessThan(0)
  })

  it('reports the flat plane as a marginally negative arc, not zero', () => {
    const south = southernHorizon(horizonProfile({ sampler: flatSampler, site: SITE }))
    expect(south.maxDeg).toBeLessThan(0)
    expect(south.meanDeg).toBeLessThan(0)
    expect(south.maxDeg).toBeCloseTo(south.meanDeg, 6)
  })
})
