import { describe, it, expect } from 'bun:test'
import {
  ASTRO_SITES,
  ASTRO_SITE_MEASUREMENTS,
  DEFAULT_SITE,
  distanceKm,
  findSite,
  nearestSite,
} from './astro-sites.js'

/**
 * The published acceptance table (`docs/ASTRO-MAP-RESEARCH.md` §1.4, §2.5, §3),
 * repeated here so a hand-edit to the site table fails CI.
 *
 * This is NOT the same check the generator runs: `scripts/gen-astro-sites.ts`
 * verifies the PIPELINE still measures these numbers off the live atlas and the
 * DEM, which needs the network. This one verifies the COMMITTED constants still
 * say what the paper says, offline, in the suite CI actually runs.
 */
const PUBLISHED = {
  munich: {
    mpsas: 18.44,
    lpi: 25.49,
    zone: '6b',
    trend10yPercent: 8,
    coreDirectionMpsas: 17.31,
    domePenaltyMag: 1.09,
    southHorizonDeg: 1.0,
    siteElevationM: 525,
  },
  alpenvorland: {
    mpsas: 21.14,
    lpi: 1.22,
    zone: '4a',
    trend10yPercent: 27,
    coreDirectionMpsas: 19.7,
    domePenaltyMag: 1.04,
    southHorizonDeg: 3.8,
    siteElevationM: 599,
  },
  'bayerischer-wald': {
    mpsas: 21.57,
    lpi: 0.48,
    zone: '3a',
    trend10yPercent: 6,
    coreDirectionMpsas: 19.76,
    domePenaltyMag: 1.34,
    southHorizonDeg: 0.6,
    siteElevationM: 809,
  },
  walchensee: {
    mpsas: 21.55,
    lpi: 0.51,
    zone: '3a',
    trend10yPercent: 25,
    coreDirectionMpsas: 19.98,
    domePenaltyMag: 1.03,
    southHorizonDeg: 5.7,
    siteElevationM: 801,
  },
} as const

describe('ASTRO_SITES', () => {
  it('carries the four published sites, in ranking-relevant order', () => {
    expect(ASTRO_SITES.map((site) => site.id)).toEqual([
      'munich',
      'alpenvorland',
      'bayerischer-wald',
      'walchensee',
    ])
    expect(DEFAULT_SITE.id).toBe('munich')
  })

  for (const [id, want] of Object.entries(PUBLISHED)) {
    it(`matches the published measurement for ${id}`, () => {
      const site = findSite(id)
      expect(site).toBeDefined()
      expect({
        mpsas: site!.mpsas,
        lpi: site!.lpi,
        zone: site!.zone,
        trend10yPercent: site!.trend10yPercent,
        coreDirectionMpsas: site!.coreDirectionMpsas,
        domePenaltyMag: site!.domePenaltyMag,
        southHorizonDeg: site!.southHorizonDeg,
        siteElevationM: site!.siteElevationM,
      }).toEqual(want)
    })
  }

  // The field set is pinned, not just spot-checked: the whole point of the
  // rebuild is that every sky number on a site is measured, so a hand-assigned
  // subjective class reappearing as an extra key has to fail here.
  it('exposes exactly the measured field set — nothing hand-assigned slipped back in', () => {
    const expected = [
      'coreDirectionMpsas',
      'domePenaltyMag',
      'driveMinutes',
      'id',
      'lat',
      'lon',
      'lpi',
      'mpsas',
      'name',
      'note',
      'siteElevationM',
      'southHorizonDeg',
      'timeZone',
      'trend10yPercent',
      'zone',
    ]
    for (const site of ASTRO_SITES) {
      expect(Object.keys(site).toSorted()).toEqual(expected)
    }
  })

  it('records where its numbers came from', () => {
    expect(ASTRO_SITE_MEASUREMENTS.atlasYear).toBe(2025)
    expect(ASTRO_SITE_MEASUREMENTS.computedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ASTRO_SITE_MEASUREMENTS.generator).toBe('apps/api/scripts/gen-astro-sites.ts')
  })

  it('keeps the finding the whole rebuild turned on: the darkest zenith is not the best core direction', () => {
    const darkestZenith = ASTRO_SITES.toSorted((a, b) => b.mpsas - a.mpsas)[0]!
    const darkestCore = ASTRO_SITES.toSorted(
      (a, b) => b.coreDirectionMpsas - a.coreDirectionMpsas,
    )[0]!
    expect(darkestZenith.id).toBe('bayerischer-wald')
    expect(darkestCore.id).toBe('walchensee')
    expect(darkestCore.driveMinutes).toBeLessThan(darkestZenith.driveMinutes)
  })
})

describe('findSite', () => {
  it('resolves a known id and returns undefined otherwise', () => {
    expect(findSite('walchensee')?.name).toBe('Walchensee')
    expect(findSite('atacama')).toBeUndefined()
  })
})

describe('nearestSite', () => {
  it('snaps a coordinate to the closest candidate', () => {
    // Bad Tölz town centre — closer to Alpenvorland than to Walchensee.
    expect(nearestSite(47.76, 11.56).id).toBe('alpenvorland')
    // Passau — the Bayerischer Wald corner.
    expect(nearestSite(48.57, 13.45).id).toBe('bayerischer-wald')
    // Munich city centre.
    expect(nearestSite(48.14, 11.58).id).toBe('munich')
  })

  it('still answers for a coordinate nowhere near any of them', () => {
    // The caller (routes/astro.ts) is what decides a distance is too far to
    // inherit from; this function must always return something.
    expect(nearestSite(28.29, -16.51).id).toBeString()
  })
})

describe('distanceKm', () => {
  it('is zero for a point against itself and symmetric otherwise', () => {
    const munich = { lat: 48.1374, lon: 11.5755 }
    const walchensee = { lat: 47.6, lon: 11.33 }
    expect(distanceKm(munich, munich)).toBe(0)
    expect(distanceKm(munich, walchensee)).toBeCloseTo(distanceKm(walchensee, munich), 9)
    // Straight-line Munich → Walchensee is ~62 km.
    expect(distanceKm(munich, walchensee)).toBeCloseTo(62, 0)
  })
})
