import { describe, expect, it } from 'bun:test'
import { annualVisibility } from './astro-visibility.js'
import { ASTRO_SITES, findSite } from './astro-sites.js'

const YEAR = 2027

function site(id: string) {
  const found = findSite(id)
  if (!found) throw new Error(`Unknown fixture site "${id}"`)
  return found
}

/** Minutes -> hours, one decimal, matching the doc's h/yr figures. */
function hours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}

/** Absolute h/yr difference against a published figure. */
function within1hr(actualMinutes: number, expectedHours: number): void {
  expect(Math.abs(hours(actualMinutes) - expectedHours)).toBeLessThanOrEqual(1)
}

describe('annualVisibility — committed sites reproduce docs/ASTRO-HORIZON-RESEARCH.md §4', () => {
  it('Walchensee: flat 134.2, terrain 134.2, terrainMoon 163.8, dark 2794.7 h/yr', () => {
    const walchensee = site('walchensee')
    const result = annualVisibility({
      observer: { lat: walchensee.lat, lon: walchensee.lon },
      year: YEAR,
      horizonDeg: walchensee.horizonDeg,
    })
    within1hr(result.darkMinutes, 2794.7)
    within1hr(result.flat.minutes, 134.2)
    within1hr(result.terrain.minutes, 134.2)
    within1hr(result.terrainMoon.minutes, 163.8)
  })

  it('Munich: flat 113.8, terrainMoon 114.5 h/yr', () => {
    const munich = site('munich')
    const result = annualVisibility({
      observer: { lat: munich.lat, lon: munich.lon },
      year: YEAR,
      horizonDeg: munich.horizonDeg,
    })
    within1hr(result.flat.minutes, 113.8)
    within1hr(result.terrainMoon.minutes, 114.5)
  })

  it('Bayerischer Wald: flat 76.0, terrainMoon 81.3 h/yr', () => {
    const wald = site('bayerischer-wald')
    const result = annualVisibility({
      observer: { lat: wald.lat, lon: wald.lon },
      year: YEAR,
      horizonDeg: wald.horizonDeg,
    })
    within1hr(result.flat.minutes, 76.0)
    within1hr(result.terrainMoon.minutes, 81.3)
  })
})

describe('annualVisibility — no skyline', () => {
  it('terrain and terrainMoon collapse to flat, and peakClearanceDeg is null', () => {
    const munich = site('munich')
    const result = annualVisibility({
      observer: { lat: munich.lat, lon: munich.lon },
      year: YEAR,
    })
    expect(result.terrain.minutes).toBe(result.flat.minutes)
    expect(result.terrainMoon.minutes).toBe(result.flat.minutes)
    expect(result.terrain.byMonth).toEqual(result.flat.byMonth)
    expect(result.terrainMoon.byMonth).toEqual(result.flat.byMonth)
    expect(result.peakClearanceDeg).toBeNull()
    expect(result.peakClearanceDate).toBeNull()
    expect(result.terrainBindsFraction).toBe(0)
  })
})

describe('annualVisibility — a uniform wall (the Wallberg regime)', () => {
  it('collapses terrain to a small fraction of flat and drives terrainBindsFraction near 1', () => {
    const walchensee = site('walchensee')
    const wall = Array.from({ length: 72 }, () => 20)
    const result = annualVisibility({
      observer: { lat: walchensee.lat, lon: walchensee.lon },
      year: YEAR,
      horizonDeg: wall,
    })
    expect(result.flat.minutes).toBeGreaterThan(0)
    expect(result.terrain.minutes).toBeLessThan(result.flat.minutes * 0.1)
    expect(result.terrainBindsFraction).toBeGreaterThan(0.9)
  })
})

describe('annualVisibility — byMonth shape', () => {
  it('is always length 12, sums to the total, and is zero Oct–Feb at these latitudes', () => {
    const walchensee = site('walchensee')
    const result = annualVisibility({
      observer: { lat: walchensee.lat, lon: walchensee.lon },
      year: YEAR,
      horizonDeg: walchensee.horizonDeg,
    })
    for (const gate of [result.flat, result.terrain, result.terrainMoon]) {
      expect(gate.byMonth).toHaveLength(12)
      expect(gate.byMonth.reduce((sum, m) => sum + m, 0)).toBe(gate.minutes)
      // Oct (9) .. Feb (1), wrapping across the year boundary.
      for (const month of [9, 10, 11, 0, 1]) {
        expect(gate.byMonth[month]).toBe(0)
      }
    }
  })
})

describe('annualVisibility — structural ordering', () => {
  it('terrainMoon >= terrain and terrain <= flat, for every committed site', () => {
    for (const id of ['munich', 'alpenvorland', 'bayerischer-wald', 'walchensee']) {
      const candidate = site(id)
      const result = annualVisibility({
        observer: { lat: candidate.lat, lon: candidate.lon },
        year: YEAR,
        horizonDeg: candidate.horizonDeg,
      })
      expect(result.terrain.minutes).toBeLessThanOrEqual(result.flat.minutes)
      expect(result.terrainMoon.minutes).toBeGreaterThanOrEqual(result.terrain.minutes)
    }
  })
})

describe('peak clearance', () => {
  it('reproduces §4.1 peak clearance at every committed site', () => {
    // These are the figures the terrain gate was validated against, and they
    // only match because the peak is conditioned on the atmospheric floor.
    const expected: Record<string, number> = {
      munich: 12.5,
      alpenvorland: 10.5,
      'bayerischer-wald': 11.9,
      walchensee: 8.5,
    }
    for (const site of ASTRO_SITES) {
      const result = annualVisibility({
        observer: { lat: site.lat, lon: site.lon },
        year: 2027,
        horizonDeg: site.horizonDeg,
      })
      expect(result.peakClearanceDeg).toBeCloseTo(expected[site.id]!, 0)
    }
  })

  it('ignores a wide margin the core reached below the atmospheric floor', () => {
    /*
     * A uniform wall would not test this: clearance is then maximised at core
     * transit, which is also its highest altitude, so conditioning changes
     * nothing. It takes a DIRECTIONAL skyline — here a 12° wall with a notch
     * cut out at azimuth 130–145°, where at this latitude the core only ever
     * reaches 2.6–7.4° and is unusable regardless.
     *
     * Unconditioned, the year's widest margin is that notch: ~7° of clearance
     * at an altitude the atmosphere already ruled out. Conditioned, the peak
     * comes from transit against the full wall, ~1.4°. Wallberg summit is the
     * real-world instance — 4.0° unconditioned against the published 3.3°.
     */
    const observer = { lat: 47.6631, lon: 11.7736 }
    const notched = Array.from({ length: 72 }, (_, i) => (i >= 26 && i <= 29 ? 0 : 12))

    const conditioned = annualVisibility({ observer, year: 2027, horizonDeg: notched })
    const unconditioned = annualVisibility({
      observer,
      year: 2027,
      horizonDeg: notched,
      atmosphericFloorDeg: -90,
    })

    expect(unconditioned.peakClearanceDeg).toBeGreaterThan(5)
    expect(conditioned.peakClearanceDeg).toBeLessThan(3)
    expect(conditioned.peakClearanceDeg!).toBeLessThan(unconditioned.peakClearanceDeg!)
  })

  it('is null when the core never clears the floor all year, not a stale sentinel', () => {
    // Tromsø: at 69.6°N the core's −29° declination never gets near the floor.
    const result = annualVisibility({
      observer: { lat: 69.65, lon: 18.96 },
      year: 2027,
      horizonDeg: Array.from({ length: 72 }, () => 0),
    })
    expect(result.peakClearanceDeg).toBeNull()
    expect(result.peakClearanceDate).toBeNull()
  })
})
