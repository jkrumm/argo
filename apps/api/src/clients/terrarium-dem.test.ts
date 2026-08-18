import { beforeEach, describe, expect, it } from 'bun:test'
import { latToTileY, lonToTileX } from '../lib/lp-tile.js'
import { encodeRgbPng } from '../lib/png.js'
import { HORIZON_DEM_ZOOM, HORIZON_RANGE_M } from '../lib/terrain-horizon.js'
import {
  clearTerrariumCache,
  fetchHorizonProfile,
  horizonTileCount,
  horizonTiles,
  MAX_HORIZON_TILES,
  type FetchImpl,
} from './terrarium-dem.js'

// ── Synthetic tiles ──────────────────────────────────────────────────────

const TILE_SIZE = 2

function elevationRgb(elevationM: number): [number, number, number] {
  const enc = Math.round(elevationM) + 32768
  return [(enc >> 8) & 0xff, enc & 0xff, 0]
}

/** A uniform-elevation terrarium tile. Tiny (2×2) — every test here only cares about one value per tile. */
function flatTile(elevationM: number): Uint8Array {
  const [r, g, b] = elevationRgb(elevationM)
  const row = Uint8Array.from([r, g, b, r, g, b])
  return encodeRgbPng({ width: TILE_SIZE, height: TILE_SIZE, rows: [row, row] })
}

function hrefOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** Serves a flat `elevationM` plane for every tile, 404ing any tile `fail` says to. */
function flatFetch(
  elevationM: number,
  fail?: (tx: number, ty: number) => boolean,
): { fetchImpl: FetchImpl; calls: string[] } {
  const calls: string[] = []
  const bytes = flatTile(elevationM)
  const fetchImpl: FetchImpl = async (input) => {
    const href = hrefOf(input)
    calls.push(href)
    const match = /terrarium\/\d+\/(\d+)\/(\d+)\.png$/.exec(href)
    if (!match) return new Response('not found', { status: 404 })
    const [, tx, ty] = match
    if (fail?.(Number(tx), Number(ty))) return new Response('not found', { status: 404 })
    return new Response(bytes.slice(), { status: 200 })
  }
  return { fetchImpl, calls }
}

const SITE = { lat: 48, lon: 11 }
const centerTx = Math.floor(lonToTileX(SITE.lon, HORIZON_DEM_ZOOM))
const centerTy = Math.floor(latToTileY(SITE.lat, HORIZON_DEM_ZOOM))

const farTile = horizonTiles(SITE, HORIZON_RANGE_M).find(
  (tile) => tile.tx !== centerTx || tile.ty !== centerTy,
)!

beforeEach(() => {
  clearTerrariumCache()
})

describe('fetchHorizonProfile', () => {
  it('reads a flat plane as a slightly NEGATIVE horizon everywhere — refraction, not zero', async () => {
    const { fetchImpl } = flatFetch(0)
    const result = await fetchHorizonProfile(SITE, { fetchImpl })

    expect(result).not.toBeNull()
    expect(result!.complete).toBe(true)
    expect(result!.elevationM).toBe(0)
    // If any of these ever read exactly 0.0, the curvature/refraction term
    // stopped being applied — see `horizonProfile`'s own docstring.
    for (const point of result!.profile.points) {
      expect(point.altitudeDeg).toBeLessThan(0)
      expect(point.nearAltitudeDeg).toBeLessThan(0)
    }
    expect(result!.south.maxDeg).toBeLessThan(0)
  })

  it('returns null when the site’s own tile is missing', async () => {
    const { fetchImpl } = flatFetch(0, (tx, ty) => tx === centerTx && ty === centerTy)
    const result = await fetchHorizonProfile(SITE, { fetchImpl })
    expect(result).toBeNull()
  })

  it('sets complete: false, but still returns a profile, when a far tile is missing', async () => {
    const { fetchImpl } = flatFetch(0, (tx, ty) => tx === farTile.tx && ty === farTile.ty)
    const result = await fetchHorizonProfile(SITE, { fetchImpl })

    expect(result).not.toBeNull()
    expect(result!.complete).toBe(false)
    expect(result!.tilesResolved).toBeLessThan(result!.tilesRequested)
    // A degraded profile, not an empty one — the missing sector floors to −90°
    // and every OTHER azimuth is unaffected.
    expect(result!.profile.points.length).toBeGreaterThan(0)
  })

  it('serves the second call from cache without touching the network', async () => {
    const { fetchImpl, calls } = flatFetch(0)
    await fetchHorizonProfile(SITE, { fetchImpl })
    const firstRunCalls = calls.length
    expect(firstRunCalls).toBeGreaterThan(0)

    await fetchHorizonProfile(SITE, { fetchImpl })
    expect(calls.length).toBe(firstRunCalls)
  })

  it('evicts rather than growing past CACHE_MAX_ENTRIES', async () => {
    // Three sites far enough apart that their 60 km march boxes cannot
    // overlap — together they pull well over the 256-entry cap.
    const sites = [
      { lat: 48, lon: 11 },
      { lat: 0, lon: 11 },
      { lat: -48, lon: 11 },
    ]
    const { fetchImpl, calls } = flatFetch(0)

    for (const site of sites) await fetchHorizonProfile(site, { fetchImpl })
    expect(calls.length).toBeGreaterThan(256)

    calls.length = 0
    // If the cache had simply grown unbounded, the first site's tiles would
    // still be resident and this would touch the network zero times.
    await fetchHorizonProfile(sites[0]!, { fetchImpl })
    expect(calls.length).toBeGreaterThan(0)
  })
})

describe('tile enumeration', () => {
  const TILE_COUNT = 2 ** HORIZON_DEM_ZOOM

  it('wraps x across the antimeridian instead of naming tiles that do not exist', () => {
    for (const lon of [179.9, -179.9]) {
      const tiles = horizonTiles({ lat: 48, lon }, HORIZON_RANGE_M)
      expect(tiles.length).toBeGreaterThan(0)
      for (const tile of tiles) {
        expect(tile.tx).toBeGreaterThanOrEqual(0)
        expect(tile.tx).toBeLessThan(TILE_COUNT)
      }
      // The box straddles the seam, so both edges of the world must appear.
      expect(tiles.some((t) => t.tx < 5)).toBe(true)
      expect(tiles.some((t) => t.tx > TILE_COUNT - 6)).toBe(true)
    }
  })

  it('drops rows past the Mercator limit rather than wrapping into the other hemisphere', () => {
    for (const tile of horizonTiles({ lat: 84.9, lon: 11 }, HORIZON_RANGE_M)) {
      expect(tile.ty).toBeGreaterThanOrEqual(0)
      expect(tile.ty).toBeLessThan(TILE_COUNT)
    }
  })

  it('counts a near-pole box arithmetically, without materialising four million tiles', () => {
    // The guard's whole value is that it is cheap exactly where enumeration is
    // not. If this ever takes meaningful time, counting started building the box.
    const started = performance.now()
    const count = horizonTileCount({ lat: 89.99, lon: 11 })
    expect(performance.now() - started).toBeLessThan(5)
    expect(count).toBeGreaterThan(MAX_HORIZON_TILES)
    expect(count).toBeLessThanOrEqual(TILE_COUNT * TILE_COUNT)
  })

  it('agrees with the enumerated length wherever enumerating is affordable', () => {
    for (const site of [
      { lat: 48, lon: 11 },
      { lat: 48, lon: 179.9 },
      { lat: 70, lon: 11 },
      { lat: -45, lon: -73 },
    ]) {
      expect(horizonTileCount(site)).toBe(horizonTiles(site, HORIZON_RANGE_M).length)
    }
  })

  it('never enumerates a column twice', () => {
    const tiles = horizonTiles({ lat: 48, lon: 179.9 }, HORIZON_RANGE_M)
    expect(new Set(tiles.map((t) => `${t.tx}:${t.ty}`)).size).toBe(tiles.length)
  })

  it('stays inside the ceiling at the latitudes the model is used at', () => {
    expect(horizonTileCount({ lat: 48, lon: 11 })).toBeLessThanOrEqual(MAX_HORIZON_TILES)
    expect(horizonTileCount({ lat: 70, lon: 11 })).toBeLessThanOrEqual(MAX_HORIZON_TILES)
  })

  it('exceeds the ceiling near the pole, which is what the route rejects on', () => {
    expect(horizonTileCount({ lat: 89.99, lon: 11 })).toBeGreaterThan(MAX_HORIZON_TILES)
  })

  it('refuses a near-pole coordinate without fetching anything', async () => {
    // Not a spy on a working fetch: the point is that NOTHING is requested, so
    // any call at all should fail the test loudly rather than be counted.
    const forbidden: FetchImpl = () => {
      throw new Error('fetched a tile for a coordinate past the ceiling')
    }
    expect(await fetchHorizonProfile({ lat: 89.99, lon: 11 }, { fetchImpl: forbidden })).toBeNull()
  })
})
