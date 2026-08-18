import { describe, it, expect, beforeEach } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import {
  clearLorenzAtlasCache,
  fetchLightPollution,
  fetchSkyglow,
  type FetchImpl,
} from './lorenz-atlas.js'

// ── Fixtures ─────────────────────────────────────────────────────────────

const FIXTURE_DIR = `${import.meta.dir}/../lib/__fixtures__/lorenz`

/** Munich — 11.58°E is 1.6° from the western edge of tile 39, so its march crosses into tile 38. */
const MUNICH = { lat: 48.1374, lon: 11.5755 }

/**
 * The four shipped sites with the core peak they see on the §2.5 anchor night
 * (2026-07-15, swept ±6 h around transit) and the numbers that fall out of it.
 *
 * The peaks are hard-coded rather than recomputed here: the ephemeris is pinned
 * in `../lib/astro-ephemeris.test.ts`, and pinning it again would make this file
 * fail for two unrelated reasons. What it does pin is `docs/ASTRO-MAP-RESEARCH.md`
 * §2.5 exactly — including the finding the whole feature exists for, that
 * Bayerischer Wald has the darkest zenith and still loses to Walchensee where
 * the camera points.
 */
const REFERENCE_SITES = [
  {
    name: 'Munich',
    lat: 48.1374,
    lon: 11.5755,
    coreAzimuthDeg: 180.9,
    coreAltitudeDeg: 12.91,
    zenith: 18.44,
    core: 17.31,
    penalty: 1.09,
    dominant: { azimuthDeg: 15, compass: 'NNE' },
  },
  {
    name: 'Alpenvorland',
    lat: 47.8167,
    lon: 11.4667,
    coreAzimuthDeg: 180.8,
    coreAltitudeDeg: 13.23,
    zenith: 21.14,
    core: 19.7,
    penalty: 1.04,
    dominant: { azimuthDeg: 10, compass: 'N' },
  },
  {
    name: 'Bayerischer Wald',
    lat: 48.9333,
    lon: 13.4167,
    coreAzimuthDeg: 179.2,
    coreAltitudeDeg: 12.12,
    zenith: 21.57,
    core: 19.76,
    penalty: 1.34,
    dominant: { azimuthDeg: 185, compass: 'S' },
  },
  {
    name: 'Walchensee',
    lat: 47.6,
    lon: 11.33,
    coreAzimuthDeg: 180.7,
    coreAltitudeDeg: 13.45,
    zenith: 21.55,
    core: 19.98,
    penalty: 1.03,
    dominant: { azimuthDeg: 15, compass: 'NNE' },
  },
] as const

function hrefOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/**
 * Serves the committed tiles and 404s everything else, which is also the real
 * upstream's behaviour for a tile that was never published (ocean, or outside
 * coverage). Records every requested URL so the tests can assert on fetch counts
 * and on how many distinct tiles a march asked for.
 */
function fixtureFetch(): { fetchImpl: FetchImpl; calls: string[] } {
  const calls: string[] = []
  const fetchImpl: FetchImpl = async (input) => {
    const href = hrefOf(input)
    calls.push(href)
    const match = /binary_tiles\/(\d{4})\/binary_tile_(\d+)_(\d+)\.dat\.gz$/.exec(href)
    if (!match) return new Response('not found', { status: 404 })
    const [, year, tx, ty] = match
    const file = `${FIXTURE_DIR}/binary_tile_${tx}_${ty}.${year}.dat.gz`
    if (!existsSync(file)) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(readFileSync(file)), { status: 200 })
  }
  return { fetchImpl, calls }
}

const notFoundFetch: FetchImpl = async () => new Response('gone', { status: 404 })
const throwingFetch: FetchImpl = async () => {
  throw new Error('connection reset')
}

beforeEach(() => {
  clearLorenzAtlasCache()
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('fetchLightPollution', () => {
  it('decodes the published Munich values from real tiles', async () => {
    const { fetchImpl } = fixtureFetch()
    const point = await fetchLightPollution(MUNICH, { fetchImpl })

    expect(point).not.toBeNull()
    expect(point?.mpsas).toBeCloseTo(18.44, 2)
    expect(point?.zone).toBe('6b')
    expect(Math.round(point?.trend10yPercent ?? 0)).toBe(8)
    expect(point?.source).toBe('Light Pollution Atlas 2025, David J. Lorenz')
  })

  it('serves the second call from cache without touching the network', async () => {
    const { fetchImpl, calls } = fixtureFetch()

    await fetchLightPollution(MUNICH, { fetchImpl })
    const afterFirst = calls.length
    expect(afterFirst).toBeGreaterThan(0)

    await fetchLightPollution(MUNICH, { fetchImpl })
    expect(calls.length).toBe(afterFirst)
  })

  it('re-fetches after clearLorenzAtlasCache', async () => {
    const { fetchImpl, calls } = fixtureFetch()

    await fetchLightPollution(MUNICH, { fetchImpl })
    const afterFirst = calls.length

    clearLorenzAtlasCache()
    await fetchLightPollution(MUNICH, { fetchImpl })
    expect(calls.length).toBe(afterFirst * 2)
  })

  it('returns null instead of throwing when the upstream 404s', async () => {
    expect(await fetchLightPollution(MUNICH, { fetchImpl: notFoundFetch })).toBeNull()
  })

  it('returns null instead of throwing when the upstream errors', async () => {
    expect(await fetchLightPollution(MUNICH, { fetchImpl: throwingFetch })).toBeNull()
  })

  it('returns null outside atlas coverage without issuing a request', async () => {
    const { fetchImpl, calls } = fixtureFetch()
    expect(await fetchLightPollution({ lat: -80, lon: 11 }, { fetchImpl })).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('fetchSkyglow', () => {
  const core = { coreAzimuthDeg: 180, coreAltitudeDeg: 13 }

  it('pre-fetches every tile the march can reach, not just the site tile', async () => {
    const { fetchImpl, calls } = fixtureFetch()
    await fetchSkyglow({ ...MUNICH, ...core }, { fetchImpl })

    const tiles = new Set(calls.map((href) => href.split('/').pop()))
    // The 120 km march reaches ~1.9° of longitude, which crosses the 10°E tile
    // boundary — a single-tile fetch would silently truncate the western sector.
    expect(tiles.size).toBeGreaterThan(1)
  })

  it('reproduces the published core-direction table from real tiles', async () => {
    for (const site of REFERENCE_SITES) {
      clearLorenzAtlasCache()
      const { fetchImpl } = fixtureFetch()
      const result = await fetchSkyglow(site, { fetchImpl })

      expect(result?.zenith.mpsas).toBeCloseTo(site.zenith, 2)
      expect(result?.core.mpsas).toBeCloseTo(site.core, 2)
      expect(result?.core.domePenaltyMag).toBeCloseTo(site.penalty, 2)
      expect(result?.profile.dominant.azimuthDeg).toBe(site.dominant.azimuthDeg)
      expect(result?.profile.dominant.compass).toBe(site.dominant.compass)
    }
  })

  it('ranks the sites by where the camera points, not by the zenith', async () => {
    const { fetchImpl } = fixtureFetch()
    const results = []
    for (const site of REFERENCE_SITES) results.push(await fetchSkyglow(site, { fetchImpl }))

    const [, , bayerischerWald, walchensee] = results
    // The whole point of the feature: Bayerischer Wald wins the zenith and
    // loses the direction that matters, because its dome sits due south.
    expect(bayerischerWald!.zenith.mpsas).toBeGreaterThan(walchensee!.zenith.mpsas)
    expect(bayerischerWald!.core.mpsas).toBeLessThan(walchensee!.core.mpsas)
  })

  it('widens the tile box with latitude instead of assuming a 48°N reach', async () => {
    const { fetchImpl, calls } = fixtureFetch()
    // Reykjavik: 120 km is 2.47° of longitude there, so the march leaves the box
    // a constant fitted at 48°N would have drawn — and the missing sector would
    // read as pristine sky rather than as a missing tile.
    await fetchSkyglow(
      { lat: 64.14, lon: -21.94, coreAzimuthDeg: 180, coreAltitudeDeg: 5 },
      { fetchImpl },
    )

    const tiles = new Set(calls.map((href) => href.split('/').pop()))
    expect(tiles).toContain('binary_tile_33_26.dat.gz')
    expect(tiles).toContain('binary_tile_32_26.dat.gz')
  })

  it('still answers when a neighbouring tile is unavailable', async () => {
    const { fetchImpl } = fixtureFetch()
    const result = await fetchSkyglow({ ...MUNICH, ...core }, { fetchImpl })

    expect(result).not.toBeNull()
    expect(result?.zenith.mpsas).toBeCloseTo(18.44, 2)
    expect(result?.profile.azimuths).toHaveLength(72)
    expect(result?.profile.mpsas).toHaveLength(result?.profile.altitudes.length ?? 0)
    expect(result?.core.domePenaltyMag).toBeGreaterThan(0)
  })

  it('returns null instead of throwing when the upstream errors', async () => {
    expect(await fetchSkyglow({ ...MUNICH, ...core }, { fetchImpl: throwingFetch })).toBeNull()
  })

  it('returns null outside atlas coverage', async () => {
    const { fetchImpl } = fixtureFetch()
    expect(await fetchSkyglow({ lat: -80, lon: 11, ...core }, { fetchImpl })).toBeNull()
  })
})
