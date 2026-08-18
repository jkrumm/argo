import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  decodeTile,
  locateTile,
  lorenzZone,
  mpsasFromLpi,
  sampleGrid,
  trendPercent,
  TILE_POINTS,
} from './lorenz-decode.js'

/**
 * Pins the decoder against real atlas bytes. Every expected value below is the
 * measured table in `docs/ASTRO-MAP-RESEARCH.md` §1.4 — if one of these moves,
 * the walk in `decodeTile` has drifted off Lorenz's reference implementation and
 * every downstream skyglow number is silently wrong.
 */

const FIXTURE_DIR = `${import.meta.dir}/__fixtures__/lorenz`

function loadGrid(name: string): Float32Array {
  return decodeTile(new Uint8Array(gunzipSync(readFileSync(`${FIXTURE_DIR}/${name}`))))
}

const BAVARIA_2025 = loadGrid('binary_tile_39_23.2025.dat.gz')
const BAVARIA_2016 = loadGrid('binary_tile_39_23.2016.dat.gz')
const MAUNA_KEA_2025 = loadGrid('binary_tile_5_17.2025.dat.gz')
const TIMES_SQUARE_2025 = loadGrid('binary_tile_22_22.2025.dat.gz')

function lpiAt(grid: Float32Array, lat: number, lon: number): number {
  const point = locateTile(lat, lon)
  if (!point) throw new Error(`no tile for ${lat}, ${lon}`)
  return sampleGrid(grid, point.ix, point.iy)
}

const GERMAN_SITES = [
  { name: 'Munich', lat: 48.1374, lon: 11.5755, mpsas: 18.44, zone: '6b', trend: 8 },
  { name: 'Walchensee', lat: 47.6, lon: 11.33, mpsas: 21.55, zone: '3a', trend: 25 },
  { name: 'Alpenvorland', lat: 47.8167, lon: 11.4667, mpsas: 21.14, zone: '4a', trend: 27 },
  { name: 'Bayerischer Wald', lat: 48.9333, lon: 13.4167, mpsas: 21.57, zone: '3a', trend: 6 },
] as const

describe('decodeTile', () => {
  it('produces a dense 600x600 grid', () => {
    expect(BAVARIA_2025.length).toBe(TILE_POINTS * TILE_POINTS)
  })

  it('reproduces the published 2025 zenith brightness for every German site', () => {
    for (const site of GERMAN_SITES) {
      expect(mpsasFromLpi(lpiAt(BAVARIA_2025, site.lat, site.lon))).toBeCloseTo(site.mpsas, 2)
    }
  })

  it('reproduces the dark and bright sanity references', () => {
    expect(mpsasFromLpi(lpiAt(MAUNA_KEA_2025, 19.8207, -155.4681))).toBeCloseTo(21.86, 2)
    expect(mpsasFromLpi(lpiAt(TIMES_SQUARE_2025, 40.758, -73.9855))).toBeCloseTo(16.74, 2)
  })
})

describe('lorenzZone', () => {
  it('assigns the published zone band to every German site', () => {
    for (const site of GERMAN_SITES) {
      expect(lorenzZone(lpiAt(BAVARIA_2025, site.lat, site.lon))).toBe(site.zone)
    }
  })

  it('clamps at 7b rather than inventing a band the atlas legend has no colour for', () => {
    // Times Square computes 8a raw.
    expect(lorenzZone(lpiAt(TIMES_SQUARE_2025, 40.758, -73.9855))).toBe('7b')
  })

  it('floors at 0a for a pristine or zero cell', () => {
    expect(lorenzZone(0)).toBe('0a')
  })
})

describe('trendPercent', () => {
  it('reproduces the published 2016 to 2025 change for every German site', () => {
    for (const site of GERMAN_SITES) {
      const older = lpiAt(BAVARIA_2016, site.lat, site.lon)
      const newer = lpiAt(BAVARIA_2025, site.lat, site.lon)
      expect(Math.round(trendPercent(older, newer) ?? Number.NaN)).toBe(site.trend)
    }
  })

  it('reports null, not zero, when the baseline cell was pristine', () => {
    // 0 would be a positive claim of "no change" over a cell that went from dark
    // to lit, and the caller cannot tell it apart from a real measurement.
    expect(trendPercent(0, 5)).toBeNull()
    expect(trendPercent(Number.NaN, 5)).toBeNull()
  })
})

describe('locateTile', () => {
  it('puts every German site in tile 39/23', () => {
    for (const site of GERMAN_SITES) {
      expect(locateTile(site.lat, site.lon)).toMatchObject({ tx: 39, ty: 23 })
    }
  })

  it('returns null outside the 65S..75N coverage', () => {
    expect(locateTile(-80, 11)).toBeNull()
    expect(locateTile(80, 11)).toBeNull()
  })

  it('rolls the last sliver below a tile boundary into the neighbour instead of reporting a hole', () => {
    // The half-cell offset pushes ~0.008° below every 5° graticule onto index
    // 600. That is a real, covered coordinate (this one is near Linz), not a gap.
    expect(locateTile(48.1, 14.996)).toMatchObject({ tx: 40, ix: 0 })
    expect(locateTile(49.996, 11)).toMatchObject({ ty: 24, iy: 0 })
  })
})

describe('decodeTile', () => {
  it('throws on a truncated payload rather than yielding a NaN-poisoned grid', () => {
    // A short tile reads past its own end as `undefined`, which silently NaNs
    // the running accumulator — and the client would cache that grid for a day.
    expect(() => decodeTile(new Uint8Array(1000))).toThrow(/truncated/)
  })
})

describe('sampleGrid', () => {
  it('returns NaN for indices outside the tile rather than reading a neighbouring row', () => {
    expect(sampleGrid(BAVARIA_2025, -1, 0)).toBeNaN()
    expect(sampleGrid(BAVARIA_2025, 0, TILE_POINTS)).toBeNaN()
  })
})
