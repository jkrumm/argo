import { describe, it, expect, beforeEach } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import {
  clearLorenzAtlasCache,
  fetchLightPollution,
  fetchLpTile,
  fetchSkyglow,
  type FetchImpl,
} from './lorenz-atlas.js'
import { renderLpTilePng } from '../lib/lp-tile.js'

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

  it('answers in full once every tile the march reaches is available', async () => {
    // Munich's 120 km march crosses ~0.04° into tile 38:23, west of its own
    // 39:23 — both are now committed fixtures (see the README), so a healthy
    // upstream resolves the whole march.
    const { fetchImpl } = fixtureFetch()
    const result = await fetchSkyglow({ ...MUNICH, ...core }, { fetchImpl })

    expect(result).not.toBeNull()
    expect(result?.zenith.mpsas).toBeCloseTo(18.44, 2)
    expect(result?.profile.azimuths).toHaveLength(72)
    expect(result?.profile.mpsas).toHaveLength(result?.profile.altitudes.length ?? 0)
    expect(result?.core.domePenaltyMag).toBeGreaterThan(0)
  })

  it('refuses a partial march instead of scoring a missing sector as darkness', async () => {
    // Serves every fixture EXCEPT tile 38:23 — the one neighbour Munich's march
    // needs beyond its own site tile. A pre-fix `fetchSkyglow` would silently
    // skip the NaN samples from the missing tile and answer anyway, reading the
    // unfetched sector as pristine sky rather than as a failed upstream.
    const { fetchImpl: base } = fixtureFetch()
    const fetchImpl: FetchImpl = async (input) => {
      if (hrefOf(input).includes('binary_tile_38_23'))
        return new Response('not found', { status: 404 })
      return base(input)
    }

    expect(await fetchSkyglow({ ...MUNICH, ...core }, { fetchImpl })).toBeNull()
  })

  it('returns null instead of throwing when the upstream errors', async () => {
    expect(await fetchSkyglow({ ...MUNICH, ...core }, { fetchImpl: throwingFetch })).toBeNull()
  })

  it('returns null outside atlas coverage', async () => {
    const { fetchImpl } = fixtureFetch()
    expect(await fetchSkyglow({ lat: -80, lon: 11, ...core }, { fetchImpl })).toBeNull()
  })
})

describe('fetchLpTile', () => {
  /**
   * The atlas is one real 5° tile; this hands the SAME bytes back for every
   * coordinate, so an enumeration test can resolve all 16 of them instead of
   * 404ing on the 15 that were never committed.
   */
  function anyTileFetch(): { fetchImpl: FetchImpl; calls: string[] } {
    const bytes = new Uint8Array(readFileSync(`${FIXTURE_DIR}/binary_tile_39_23.2025.dat.gz`))
    const calls: string[] = []
    const fetchImpl: FetchImpl = async (input) => {
      calls.push(hrefOf(input))
      return new Response(bytes.slice(), { status: 200 })
    }
    return { fetchImpl, calls }
  }

  it('enumerates the tile across a graticule that real pixels sample into', async () => {
    /*
     * Regression: a z9 map tile whose EAST edge lands exactly on the Greenwich
     * meridian. `locateTile` rolls the last ~0.00417° below every 5° graticule
     * onto the NEXT atlas tile, so the final 3 pixel columns of this tile really
     * do sample tile 37:23 — while the old 0.01° endpoint nudge enumerated only
     * 36:23. Those 3 columns read NaN, rendered as 22.00 (the ramp's deepest
     * "pristine sky"), and cached as complete for 30 days: a false-dark seam
     * down the meridian.
     *
     * Asserting the tile COUNT is the honest check. A pixel assertion would pass
     * on this fixture either way, because the harness serves the same bytes for
     * every coordinate.
     */
    const { fetchImpl, calls } = anyTileFetch()
    const tile = await fetchLpTile({ x: 255, y: 177, z: 9 }, { fetchImpl })

    expect(tile?.tilesRequested).toBe(2)
    expect(tile?.tilesResolved).toBe(2)
    expect(new Set(calls).size).toBe(2)
    expect(calls.some((url) => url.includes('binary_tile_37_23'))).toBe(true)
    expect(calls.some((url) => url.includes('binary_tile_36_23'))).toBe(true)
  })

  it('enumerates every atlas tile a z5 map tile touches, not just its corners', async () => {
    const { fetchImpl, calls } = anyTileFetch()
    // x=3 y=16: a z5 tile spans ~11° of longitude, which is more than two 5°
    // atlas tiles, so a corner-only enumeration (at most 4 distinct tiles) would
    // silently drop the columns in between. Its northern edge sits exactly on
    // the equator — a 5° atlas graticule — and at z5 half a pixel is ~0.02° of
    // latitude, well clear of `locateTile`'s ~0.00417° rollover band, so the
    // pixel-centre inset keeps every sample south of it: 9 tiles, not 16.
    const tile = await fetchLpTile({ x: 3, y: 16, z: 5 }, { fetchImpl })

    expect(tile?.tilesRequested).toBe(9)
    expect(tile?.tilesResolved).toBe(9)
    expect(new Set(calls).size).toBe(9)
    expect([...(tile?.png.subarray(0, 8) ?? [])]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
  })

  it('does not request the tile on the far side of the date line for the easternmost z5 column', async () => {
    const { fetchImpl, calls } = anyTileFetch()
    // x=31 is the LAST column at z5 (n = 2^5 = 32): `tileBounds` puts its
    // `maxLon` at exactly 180, which `locateTile` resolves to tx=1 — the tile
    // bordering the date line from the WEST, on the far side from this tile's
    // real span of [168.75°, 180°). y=18 is picked to avoid the equator's own
    // coincidental 5°-graticule alignment, so this pins the longitude fix in
    // isolation.
    const tile = await fetchLpTile({ x: 31, y: 18, z: 5 }, { fetchImpl })

    expect(tile?.tilesRequested).toBe(9)
    expect(tile?.tilesResolved).toBe(9)
    expect(new Set(calls).size).toBe(9)
    expect(calls.some((href) => /binary_tile_1_\d+\.dat\.gz$/.test(href))).toBe(false)
  })

  it('serves a repeat render from the PNG cache without re-reading a single grid', async () => {
    const { fetchImpl, calls } = anyTileFetch()
    const first = await fetchLpTile({ x: 3, y: 16, z: 5 }, { fetchImpl })
    const afterFirst = calls.length
    expect(afterFirst).toBe(9)

    const second = await fetchLpTile({ x: 3, y: 16, z: 5 }, { fetchImpl })
    expect(calls.length).toBe(afterFirst)
    expect(second?.png).toBe(first!.png)
    expect(second?.tilesResolved).toBe(second?.tilesRequested)
  })

  it('does NOT cache a partial render, so the missing tiles get another chance', async () => {
    // The committed fixture set covers 39:23 and 40:23 (the latter added for the
    // skyglow march fixtures), so this Munich z5 tile resolves 2 of 6 — still
    // exactly the partial case.
    const { fetchImpl, calls } = fixtureFetch()
    const first = await fetchLpTile({ x: 17, y: 11, z: 5 }, { fetchImpl })
    expect(first?.tilesRequested).toBe(6)
    expect(first?.tilesResolved).toBe(2)

    calls.length = 0
    const second = await fetchLpTile({ x: 17, y: 11, z: 5 }, { fetchImpl })
    // The 4 that failed are retried; the 2 that worked are still grid-cached.
    expect(calls).toHaveLength(4)
    expect(second?.tilesResolved).toBe(2)
  })

  it('one low-zoom render does not evict the grids the point lookups live on', async () => {
    const { fetchImpl, calls } = anyTileFetch()
    await fetchSkyglow({ ...MUNICH, coreAzimuthDeg: 180, coreAltitudeDeg: 13 }, { fetchImpl })
    calls.length = 0

    // 9 grids at once — a render this size used to flush the astro engine's own
    // tiles under the old 12-entry cap, sending /astro/skyglow back to the
    // network; CACHE_MAX_ENTRIES=32 is sized to keep both working sets resident.
    await fetchLpTile({ x: 3, y: 16, z: 5 }, { fetchImpl })
    calls.length = 0

    await fetchSkyglow({ ...MUNICH, coreAzimuthDeg: 180, coreAltitudeDeg: 13 }, { fetchImpl })
    expect(calls).toHaveLength(0)
  })

  it('coalesces concurrent callers onto one download per atlas tile', async () => {
    const { fetchImpl, calls } = anyTileFetch()
    // Four adjacent z5 tiles overlap heavily; without in-flight sharing each
    // one re-downloads the neighbours the others are already fetching.
    const tiles = await Promise.all([
      fetchLpTile({ x: 3, y: 16, z: 5 }, { fetchImpl }),
      fetchLpTile({ x: 4, y: 16, z: 5 }, { fetchImpl }),
      fetchLpTile({ x: 3, y: 17, z: 5 }, { fetchImpl }),
      fetchLpTile({ x: 4, y: 17, z: 5 }, { fetchImpl }),
    ])

    const distinct = new Set(calls).size
    const asked = tiles.reduce((sum, tile) => sum + (tile?.tilesRequested ?? 0), 0)
    // Guards against a vacuous assertion: the four boxes must genuinely share
    // atlas tiles, or deduping them would prove nothing.
    expect(asked).toBeGreaterThan(distinct)
    expect(calls.length).toBe(distinct)
  })

  it('renders flat no-data outside the 65°S–75°N band instead of erroring', async () => {
    const { fetchImpl, calls } = anyTileFetch()
    // z5 rows 0..4 sit entirely above 75°N. 416 of the 1024 tiles a z5 world
    // view requests are like this — a permanent answer, not an outage, so it
    // must not cost a 502 and a warn each time.
    const tile = await fetchLpTile({ x: 17, y: 0, z: 5 }, { fetchImpl })

    expect(tile).not.toBeNull()
    expect(tile?.tilesRequested).toBe(0)
    expect(tile?.tilesResolved).toBe(0)
    expect(calls).toHaveLength(0)
    // Byte-identical to a tile whose sampler answers NaN everywhere — i.e. every
    // pixel carries the same 22.00 an uncovered pixel gets on a partial tile.
    // Asserting on the bytes avoids shipping a PNG decoder just for a test.
    expect(tile?.png).toEqual(renderLpTilePng({ x: 17, y: 0, z: 5, sampler: () => Number.NaN }))
  })

  it('returns null — a real failure — when tiles exist but none of them resolve', async () => {
    expect(await fetchLpTile({ x: 17, y: 11, z: 5 }, { fetchImpl: throwingFetch })).toBeNull()
    expect(await fetchLpTile({ x: 17, y: 11, z: 5 }, { fetchImpl: notFoundFetch })).toBeNull()
  })

  it('returns null outside the served zoom range without touching the network', async () => {
    const { fetchImpl, calls } = anyTileFetch()
    expect(await fetchLpTile({ x: 4, y: 5, z: 4 }, { fetchImpl })).toBeNull()
    expect(await fetchLpTile({ x: 540, y: 356, z: 10 }, { fetchImpl })).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
