import { describe, expect, it } from 'bun:test'
import {
  decodeMpsas,
  latToTileY,
  lonToTileX,
  LP_TILE_SIZE,
  renderLpTile,
  renderLpTilePng,
  tileBounds,
  tileToLatLon,
} from './lp-tile.js'

/** The z8 tile containing Walchensee (47.60°N, 11.33°E) — the reference site of the whole feature. */
const WALCHENSEE = { lat: 47.6, lon: 11.33 }

function tileOf(point: { lat: number; lon: number }, z: number) {
  return { x: Math.floor(lonToTileX(point.lon, z)), y: Math.floor(latToTileY(point.lat, z)), z }
}

function pixel(rows: Uint8Array[], px: number, py: number): [number, number, number] {
  const row = rows[py]!
  return [row[px * 3]!, row[px * 3 + 1]!, row[px * 3 + 2]!]
}

describe('tileToLatLon', () => {
  it('puts the z0 origin at the top-left corner of the Web Mercator world', () => {
    const { lat, lon } = tileToLatLon({ x: 0, y: 0, z: 0 })
    expect(lat).toBeCloseTo(85.0511, 3)
    expect(lon).toBe(-180)
  })

  it('puts the centre of the z0 tile at null island', () => {
    const { lat, lon } = tileToLatLon({ x: 0.5, y: 0.5, z: 0 })
    expect(lat).toBeCloseTo(0, 9)
    expect(lon).toBeCloseTo(0, 9)
  })

  it('is inverted by lonToTileX / latToTileY', () => {
    for (const z of [5, 7, 9]) {
      for (const point of [WALCHENSEE, { lat: -33.9, lon: 18.4 }, { lat: 60.2, lon: -140.7 }]) {
        const x = lonToTileX(point.lon, z)
        const y = latToTileY(point.lat, z)
        const back = tileToLatLon({ x, y, z })
        expect(back.lat).toBeCloseTo(point.lat, 9)
        expect(back.lon).toBeCloseTo(point.lon, 9)
      }
    }
  })
})

describe('tileBounds', () => {
  it('matches the four corners the fractional coordinates give', () => {
    const tile = tileOf(WALCHENSEE, 8)
    const bounds = tileBounds(tile)
    const topLeft = tileToLatLon({ x: tile.x, y: tile.y, z: tile.z })
    const bottomRight = tileToLatLon({ x: tile.x + 1, y: tile.y + 1, z: tile.z })
    expect(bounds.maxLat).toBeCloseTo(topLeft.lat, 12)
    expect(bounds.minLon).toBeCloseTo(topLeft.lon, 12)
    expect(bounds.minLat).toBeCloseTo(bottomRight.lat, 12)
    expect(bounds.maxLon).toBeCloseTo(bottomRight.lon, 12)
  })

  it('contains the point the tile was derived from, north edge above south', () => {
    const tile = tileOf(WALCHENSEE, 8)
    const b = tileBounds(tile)
    expect(b.maxLat).toBeGreaterThan(b.minLat)
    expect(b.maxLon).toBeGreaterThan(b.minLon)
    expect(WALCHENSEE.lat).toBeGreaterThanOrEqual(b.minLat)
    expect(WALCHENSEE.lat).toBeLessThanOrEqual(b.maxLat)
    expect(WALCHENSEE.lon).toBeGreaterThanOrEqual(b.minLon)
    expect(WALCHENSEE.lon).toBeLessThanOrEqual(b.maxLon)
  })
})

describe('renderLpTile', () => {
  const tile = tileOf(WALCHENSEE, 8)

  it('returns 256 rows of 768 bytes', () => {
    const rows = renderLpTile({ ...tile, sampler: () => 21.5 })
    expect(rows.length).toBe(LP_TILE_SIZE)
    expect(rows.every((row) => row.length === LP_TILE_SIZE * 3)).toBe(true)
  })

  it('round-trips a swept brightness range to within 0.005 mag', () => {
    for (let mpsas = 16; mpsas <= 22; mpsas += 0.017) {
      const rows = renderLpTile({ ...tile, sampler: () => mpsas })
      const [r, g, b] = pixel(rows, 0, 0)
      expect(b).toBe(0)
      expect(decodeMpsas(r, g, b)).toBeCloseTo(mpsas, 2)
      expect(Math.abs(decodeMpsas(r, g, b) - mpsas)).toBeLessThanOrEqual(0.005)
    }
  })

  it('encodes a NaN sample as exactly 22.00 — the natural sky, not black', () => {
    const rows = renderLpTile({ ...tile, sampler: () => Number.NaN })
    const [r, g, b] = pixel(rows, 137, 42)
    expect(decodeMpsas(r, g, b)).toBe(22)
    expect(b).toBe(0)
  })

  it('clamps a pathological value instead of wrapping it onto a plausible brightness', () => {
    const high = renderLpTile({ ...tile, sampler: () => 1e6 })
    expect(pixel(high, 0, 0)).toEqual([255, 255, 0])
    const low = renderLpTile({ ...tile, sampler: () => -1e6 })
    expect(pixel(low, 0, 0)).toEqual([0, 0, 0])
  })

  it('samples pixel CENTRES — every sampled point falls strictly inside the tile bounds', () => {
    const seen: { lat: number; lon: number }[] = []
    renderLpTile({
      ...tile,
      sampler: (lat, lon) => {
        seen.push({ lat, lon })
        return 21
      },
    })
    expect(seen.length).toBe(LP_TILE_SIZE * LP_TILE_SIZE)
    const b = tileBounds(tile)
    for (const point of [seen[0]!, seen.at(-1)!]) {
      expect(point.lat).toBeLessThan(b.maxLat)
      expect(point.lat).toBeGreaterThan(b.minLat)
      expect(point.lon).toBeGreaterThan(b.minLon)
      expect(point.lon).toBeLessThan(b.maxLon)
    }
    // Half a pixel in from the north-west corner, not on it.
    const halfPixelLon = (b.maxLon - b.minLon) / (2 * LP_TILE_SIZE)
    expect(seen[0]!.lon).toBeCloseTo(b.minLon + halfPixelLon, 9)
  })

  it('varies across the tile when the sampler does', () => {
    const rows = renderLpTile({ ...tile, sampler: (lat) => 22 - (lat - 47) })
    expect(pixel(rows, 0, 0)).not.toEqual(pixel(rows, 0, LP_TILE_SIZE - 1))
    // Latitude falls as py rises, so brightness (22 - (lat-47)) rises southward.
    expect(decodeMpsas(...pixel(rows, 0, LP_TILE_SIZE - 1))).toBeGreaterThan(
      decodeMpsas(...pixel(rows, 0, 0)),
    )
  })
})

describe('renderLpTilePng', () => {
  it('produces a PNG carrying the rendered scanlines', () => {
    const tile = tileOf(WALCHENSEE, 8)
    const png = renderLpTilePng({ ...tile, sampler: () => 21.5 })
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.length).toBeGreaterThan(50)
  })
})
