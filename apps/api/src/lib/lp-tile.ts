/**
 * Web Mercator tile geometry and the terrarium encoding for the light-pollution
 * raster layer.
 *
 * The tiles this renders are DATA, not pictures: each pixel carries a sky
 * brightness in mag/arcsec², and the palette is applied client-side by
 * MapLibre's `color-relief` layer over a `raster-dem` source. That is what buys
 * Argo its own ramp (`docs/ASTRO-MAP-RESEARCH.md` §6.3, §6.6) instead of
 * inheriting the atlas author's colour scheme — and what keeps us off his
 * GitHub Pages bandwidth (§8).
 *
 * Pure by design: the LPI→mpsas lookup arrives as an injected `MpsasSampler`,
 * so every number here is testable with no fetch, no cache and no atlas.
 * Fetching and caching live in `../clients/lorenz-atlas.ts`.
 */

import { encodeRgbPng } from './png.js'

export const LP_TILE_SIZE = 256

/**
 * Zoom range. Below z5 one tile spans more of the globe than the request is
 * worth rendering; above z9 the atlas's own 30-arcsec grid (~0.6 km) is already
 * coarser than the pixels, so more zoom only interpolates the same cells.
 */
export const LP_TILE_MIN_ZOOM = 5
export const LP_TILE_MAX_ZOOM = 9

/** Terrarium offset: the encoding is unsigned, the quantity is not. */
const TERRARIUM_OFFSET = 32768

/** Hundredths of a magnitude — the encoding's unit. */
const MPSAS_SCALE = 100

/**
 * What an uncovered pixel reads as: the natural sky, in mag/arcsec².
 *
 * The same convention the decoder uses (`mpsasFromLpi`), and the same one the
 * reference encoder used. Encoding "no data" as black would paint the ocean and
 * everything above 75°N as the worst light pollution on the map.
 */
const NO_DATA_MPSAS = 22.0

export type MpsasSampler = (lat: number, lon: number) => number

/** Latitude/longitude of a FRACTIONAL tile coordinate (Web Mercator / EPSG:3857). */
export function tileToLatLon(args: { x: number; y: number; z: number }): {
  lat: number
  lon: number
} {
  const n = 2 ** args.z
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * args.y) / n))) * 180) / Math.PI,
    lon: (args.x / n) * 360 - 180,
  }
}

/** Fractional tile column for a longitude. Inverse of `tileToLatLon`'s `lon`. */
export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}

/** Fractional tile row for a latitude. Inverse of `tileToLatLon`'s `lat`. */
export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z
}

/**
 * The lat/lon box one whole tile covers.
 *
 * Note the y axis runs the other way: tile row `y` is the NORTH edge and `y + 1`
 * the south one, so `maxLat` comes from `y` and `minLat` from `y + 1`.
 */
export function tileBounds(args: { x: number; y: number; z: number }): {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
} {
  const topLeft = tileToLatLon({ x: args.x, y: args.y, z: args.z })
  const bottomRight = tileToLatLon({ x: args.x + 1, y: args.y + 1, z: args.z })
  return {
    minLat: bottomRight.lat,
    maxLat: topLeft.lat,
    minLon: topLeft.lon,
    maxLon: bottomRight.lon,
  }
}

/**
 * Terrarium-encode one sky brightness into an RGB triple.
 *
 * `elevation = R*256 + G + B/256 - 32768` is the decoder every terrarium
 * consumer implements, so the value we store is `mpsas * 100`. B is ALWAYS 0:
 * the encoding's fractional byte would buy 1/256 of a unit, and the unit here is
 * already a hundredth of a magnitude — far finer than the atlas's own accuracy.
 * `mpsas * 100` lands in ~1650..2200 for real sky (16.5..22.0 mag), so the
 * stored `enc` sits around 34400..34968 — comfortably inside the 16 bits that R
 * and G span.
 *
 * The clamp is not decoration: a pathological sample (a corrupt grid, a decode
 * regression) would otherwise wrap modulo 65536 and land on a plausible-looking
 * brightness somewhere else on the ramp.
 */
function encodeMpsas(mpsas: number): [number, number, number] {
  const value = Number.isFinite(mpsas) ? mpsas : NO_DATA_MPSAS
  const enc = Math.min(65535, Math.max(0, Math.round(value * MPSAS_SCALE) + TERRARIUM_OFFSET))
  return [(enc >> 8) & 0xff, enc & 0xff, 0]
}

/** Decode a terrarium triple back to mag/arcsec². Exported for tests and for the client-side ramp's sanity. */
export function decodeMpsas(r: number, g: number, b: number): number {
  return (r * 256 + g + b / 256 - TERRARIUM_OFFSET) / MPSAS_SCALE
}

/**
 * Render one 256×256 tile as raw RGB scanlines.
 *
 * Sampling is at PIXEL CENTRES, exactly as the reference encoder: latitude from
 * `y + (py + 0.5)/SIZE` and longitude from `x + (px + 0.5)/SIZE`. Sampling at
 * the corner instead shifts the whole layer half a pixel north-west, which at z9
 * is ~150 m and visibly misaligns a city's core against the basemap.
 */
export function renderLpTile(args: {
  x: number
  y: number
  z: number
  sampler: MpsasSampler
}): Uint8Array[] {
  const { x, y, z, sampler } = args

  // Longitude depends only on the column, so resolve all 256 of them once
  // rather than 65 536 times.
  const longitudes = new Float64Array(LP_TILE_SIZE)
  for (let px = 0; px < LP_TILE_SIZE; px++) {
    longitudes[px] = tileToLatLon({ x: x + (px + 0.5) / LP_TILE_SIZE, y, z }).lon
  }

  const rows: Uint8Array[] = []
  for (let py = 0; py < LP_TILE_SIZE; py++) {
    const { lat } = tileToLatLon({ x, y: y + (py + 0.5) / LP_TILE_SIZE, z })
    const row = new Uint8Array(LP_TILE_SIZE * 3)
    for (let px = 0; px < LP_TILE_SIZE; px++) {
      const [r, g, b] = encodeMpsas(sampler(lat, longitudes[px]!))
      row[px * 3] = r
      row[px * 3 + 1] = g
      row[px * 3 + 2] = b
    }
    rows.push(row)
  }
  return rows
}

/** Render and encode in one step — what the client hands back to the route. */
export function renderLpTilePng(args: {
  x: number
  y: number
  z: number
  sampler: MpsasSampler
}): Uint8Array<ArrayBuffer> {
  return encodeRgbPng({
    width: LP_TILE_SIZE,
    height: LP_TILE_SIZE,
    rows: renderLpTile(args),
  })
}
