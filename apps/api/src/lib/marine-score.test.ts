import { describe, expect, it } from 'bun:test'
import {
  GLASSY_WIND_KN,
  MARINE_WEIGHTS,
  marineWindowConfig,
  MIN_SWELL_PERIOD_S,
  RIDEABLE_HEIGHT_M,
  windQuality,
  type MarineScoreInput,
} from './marine-score.js'
import { classifyWind, findSpot, MARINE_SPOTS, swellAlignment } from './marine-spots.js'
import { angularDistance, peakScore, scoreWindow } from './window-score.js'

/** Hossegor faces WNW, so dead offshore is wind FROM 110°. */
const HOSSEGOR = findSpot('hossegor')!

function input(overrides: Partial<MarineScoreInput> = {}): MarineScoreInput {
  return {
    spot: { shoreNormal: HOSSEGOR.shoreNormal },
    swellHeight: 1.5,
    swellPeriod: 13,
    swellDirection: 290,
    windSpeed: 8,
    windDirection: 110,
    waveHeight: 1.6,
    ...overrides,
  }
}

describe('the engine is genuinely shared', () => {
  it('scores a clean offshore groundswell day near the top', () => {
    const result = scoreWindow(marineWindowConfig, input())
    expect(result.gated).toBe(false)
    expect(result.score).toBeGreaterThan(80)
    expect(result.verdict).toBe('excellent')
    expect(result.coverage).toBe(1)
  })

  it('uses the same missing-data contract as astro', () => {
    const result = scoreWindow(marineWindowConfig, input({ swellDirection: null }))
    expect(result.coverage).toBeLessThan(1)
    expect(result.factors.find((f) => f.id === 'swell-alignment')!.value).toBeNull()
    expect(result.gated).toBe(false)
  })
})

describe('hard gates', () => {
  it('rules out windsea, however big it is', () => {
    const result = scoreWindow(marineWindowConfig, input({ swellPeriod: 5, swellHeight: 2 }))
    expect(result.verdict).toBe('out')
    expect(result.score).toBe(0)
    expect(result.killers.map((k) => k.id)).toContain('swell-period')
    expect(result.killers[0]!.reason).toContain('windsea')
  })

  it('lets a marginal period through at exactly the threshold', () => {
    expect(scoreWindow(marineWindowConfig, input({ swellPeriod: MIN_SWELL_PERIOD_S })).gated).toBe(
      false,
    )
  })

  it('rules out flat', () => {
    const result = scoreWindow(marineWindowConfig, input({ waveHeight: 0.2, swellHeight: 0.2 }))
    expect(result.killers.map((k) => k.id)).toContain('wave-height')
    expect(result.killers.find((k) => k.id === 'wave-height')!.reason).toContain('flat')
  })

  it('rules out oversized', () => {
    const result = scoreWindow(marineWindowConfig, input({ waveHeight: 5.5 }))
    expect(result.killers.find((k) => k.id === 'wave-height')!.reason).toContain(
      `${RIDEABLE_HEIGHT_M.max} m ceiling`,
    )
  })

  it('rules out onshore wind', () => {
    // Hossegor's shore normal is 290, so onshore wind comes FROM ~290.
    const result = scoreWindow(marineWindowConfig, input({ windDirection: 290, windSpeed: 18 }))
    expect(result.verdict).toBe('out')
    expect(result.killers.find((k) => k.id === 'wind-direction')!.reason).toContain('onshore')
  })

  it('forgives any direction when the wind is barely there', () => {
    const glassy = input({ windDirection: 290, windSpeed: GLASSY_WIND_KN - 1 })
    expect(scoreWindow(marineWindowConfig, glassy).gated).toBe(false)
  })

  it('does not forgive a strong onshore just under the cross-shore boundary', () => {
    // 60° off is the boundary and passes; 61° does not.
    expect(scoreWindow(marineWindowConfig, input({ windDirection: 170 })).gated).toBe(false)
    expect(scoreWindow(marineWindowConfig, input({ windDirection: 172 })).gated).toBe(true)
  })

  it('treats a missing reading as unknown, not as a failure', () => {
    const blind = input({
      swellPeriod: null,
      waveHeight: null,
      swellHeight: null,
      windDirection: null,
    })
    expect(scoreWindow(marineWindowConfig, blind).gated).toBe(false)
  })
})

describe('weighted factors', () => {
  it('weights period above everything else', () => {
    expect(MARINE_WEIGHTS.swellPeriod).toBeGreaterThan(MARINE_WEIGHTS.windDirection)
    expect(MARINE_WEIGHTS.windDirection).toBeGreaterThan(MARINE_WEIGHTS.swellHeight)
  })

  it('prefers a long-period small swell to a short-period big one', () => {
    const clean = scoreWindow(marineWindowConfig, input({ swellPeriod: 14, swellHeight: 1 }))
    const messy = scoreWindow(marineWindowConfig, input({ swellPeriod: 9, swellHeight: 2 }))
    expect(clean.score).toBeGreaterThan(messy.score)
  })

  it('punishes an onshore-leaning cross-shore wind more than a strong offshore one', () => {
    const crossShore = scoreWindow(marineWindowConfig, input({ windDirection: 200, windSpeed: 8 }))
    const strongOffshore = scoreWindow(marineWindowConfig, input({ windSpeed: 20 }))
    expect(crossShore.score).toBeLessThan(strongOffshore.score)
  })

  it('treats over- and under-sized swell asymmetrically', () => {
    // 1.1 m below ideal is a total loss; 2.5 m above is the equivalent.
    const under = scoreWindow(marineWindowConfig, input({ swellHeight: 0.6 }))
    const over = scoreWindow(marineWindowConfig, input({ swellHeight: 3.0, waveHeight: 3.2 }))
    expect(under.factors.find((f) => f.id === 'swell-height')!.value).toBeLessThan(0.2)
    expect(over.factors.find((f) => f.id === 'swell-height')!.value).toBeGreaterThan(0.3)
  })

  it('carries a readable detail per factor', () => {
    const result = scoreWindow(marineWindowConfig, input())
    const byId = Object.fromEntries(result.factors.map((f) => [f.id, f.detail]))
    expect(byId['swell-period']).toBe('13 s')
    expect(byId['swell-height']).toBe('1.5 m')
    expect(byId['wind-speed']).toBe('8 kn')
    expect(byId['wind-direction']).toContain('offshore')
  })
})

describe('classifyWind', () => {
  it('calls wind from the land offshore, and wind from the sea onshore', () => {
    // Shore normal 290 → dead offshore is FROM 110.
    expect(classifyWind(110, 290).kind).toBe('offshore')
    expect(classifyWind(110, 290).quality).toBe(1)
    expect(classifyWind(290, 290).kind).toBe('onshore')
    expect(classifyWind(290, 290).quality).toBe(0)
    expect(classifyWind(20, 290).kind).toBe('cross-shore')
  })

  it('wraps correctly across north', () => {
    // Shore normal 170 → dead offshore FROM 350. Wind from 010 is 20° off.
    expect(classifyWind(10, 170).offAxis).toBeCloseTo(20, 6)
    expect(classifyWind(340, 170).offAxis).toBeCloseTo(10, 6)
  })

  it('is symmetric either side of the axis', () => {
    expect(classifyWind(80, 290).offAxis).toBeCloseTo(classifyWind(140, 290).offAxis, 6)
  })
})

describe('swellAlignment', () => {
  it('is 1 for a swell straight into the beach and 0 at 90° off', () => {
    expect(swellAlignment(290, 290)).toBe(1)
    expect(swellAlignment(200, 290)).toBe(0)
    expect(swellAlignment(20, 290)).toBe(0)
  })

  it('degrades linearly and never goes negative', () => {
    expect(swellAlignment(245, 290)).toBeCloseTo(0.5, 6)
    expect(swellAlignment(110, 290)).toBe(0)
  })
})

describe('spots', () => {
  it('has a unique id, a plausible shore normal and a note for every entry', () => {
    const ids = new Set<string>()
    for (const spot of MARINE_SPOTS) {
      expect(ids.has(spot.id)).toBe(false)
      ids.add(spot.id)
      expect(spot.shoreNormal).toBeGreaterThanOrEqual(0)
      expect(spot.shoreNormal).toBeLessThan(360)
      expect(spot.note.length).toBeGreaterThan(20)
      expect(Math.abs(spot.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(spot.lon)).toBeLessThanOrEqual(180)
    }
  })

  it('does not include the Eisbach — a river wave has no swell to score', () => {
    expect(MARINE_SPOTS.some((s) => /eisbach/i.test(s.id) || /eisbach/i.test(s.name))).toBe(false)
  })

  it('returns undefined for an unknown id rather than a default', () => {
    expect(findSpot('nowhere')).toBeUndefined()
  })
})

describe('engine primitives added for marine', () => {
  it('peakScore is 1 at the ideal and 0 beyond the tolerance', () => {
    expect(peakScore(1.5, IDEAL)).toBe(1)
    expect(peakScore(0.4, IDEAL)).toBe(0)
    expect(peakScore(4.0, IDEAL)).toBe(0)
  })

  it('peakScore respects an asymmetric tolerance', () => {
    expect(peakScore(1.0, IDEAL)).toBeCloseTo(1 - 0.5 / 1.1, 6)
    expect(peakScore(2.0, IDEAL)).toBeCloseTo(1 - 0.5 / 2.5, 6)
  })

  it('peakScore returns null for missing data', () => {
    expect(peakScore(null, IDEAL)).toBeNull()
    expect(peakScore(undefined, IDEAL)).toBeNull()
  })

  it('angularDistance wraps and is symmetric', () => {
    expect(angularDistance(10, 350)).toBe(20)
    expect(angularDistance(350, 10)).toBe(20)
    expect(angularDistance(0, 180)).toBe(180)
    expect(angularDistance(90, 90)).toBe(0)
  })
})

const IDEAL = { ideal: 1.5, below: 1.1, above: 2.5 }

describe('windQuality', () => {
  it('is null when the direction is unknown', () => {
    expect(windQuality(input({ windDirection: null }))).toBeNull()
  })
})
