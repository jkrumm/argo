/**
 * Decoder for David J. Lorenz's Light Pollution Atlas binary tiles — the
 * numeric half of the atlas, which nobody documents.
 *
 * Each tile is a 5°×5° block of 600×600 points (1/120° = 30 arcsec), coverage
 * 65°S–75°N, published per year as a gzipped stream of signed 1-byte deltas.
 * Decoding one into a dense `Float32Array(360000)` makes every subsequent point
 * lookup O(1), which is what makes the per-request ray-march in `skyglow.ts`
 * cheap enough to run inline (see `docs/ASTRO-MAP-RESEARCH.md` §1.2, §2.2).
 *
 * This module is deliberately pure: no fetch, no fs, no cache. Fetching,
 * gunzipping and caching live in `../clients/lorenz-atlas.ts`.
 *
 * The unit is LPI — Lorenz's Light Pollution Index, the ratio of artificial to
 * natural zenith brightness. There is intentionally no Bortle anywhere in this
 * file or its callers: Bortle is a subjective whole-sky scale, a zenith map
 * cannot produce it, and the atlas author asks explicitly that the two not be
 * conflated (§1.3).
 */

/** Atlas vintages published as binary tiles. */
export const LORENZ_YEARS = [2016, 2020, 2022, 2023, 2024, 2025] as const

export type LorenzYear = (typeof LORENZ_YEARS)[number]

export const LATEST_LORENZ_YEAR: LorenzYear = 2025

/** Points per tile edge — 600 × 1/120° = 5°, i.e. 30 arcsec per cell. */
export const TILE_POINTS = 600

/** First atlas year, and therefore the fixed baseline of the 10-year trend. */
export const BASELINE_LORENZ_YEAR: LorenzYear = 2016

/** Tile grid origin: the atlas starts at 65°S and at the date line. */
const LAT_START_DEG = 65

/** Degrees covered by one tile edge. Exported because the ray-march has to enumerate whole tiles. */
export const TILE_SPAN_DEG = 5

const MAX_TILE_Y = 28
/** Tiles per row of the globe — 360° / 5°. The grid wraps at the date line. */
const TILE_X_COUNT = 72

export type TileCoord = { tx: number; ty: number }

export type TilePoint = TileCoord & { ix: number; iy: number }

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/**
 * The atlas's own compression curve: stored values are a log-ish encoding of
 * LPI, inverted here back to the ratio.
 */
function compressedToFull(value: number): number {
  return (5.0 / 195.0) * (Math.exp(0.0195 * value) - 1.0)
}

/**
 * null when the coordinate falls outside the atlas coverage (65°S..75°N).
 *
 * The reference walk's half-cell offset pushes the last ~0.008° below every 5°
 * graticule onto index 600, which is one past the tile's last row/column. That
 * point is not uncovered — it belongs to the FIRST cell of the neighbouring
 * tile, so it rolls over there instead of reporting a coverage hole ~0.6 km
 * wide along every tile boundary (a real map click, near Linz for instance).
 */
export function locateTile(lat: number, lon: number): TilePoint | null {
  const lonFromDateLine = mod(lon + 180.0, 360.0)
  const latFromStart = lat + LAT_START_DEG
  let tx = Math.floor(lonFromDateLine / TILE_SPAN_DEG) + 1
  let ty = Math.floor(latFromStart / TILE_SPAN_DEG) + 1

  let ix = Math.round(120 * (lonFromDateLine - TILE_SPAN_DEG * (tx - 1) + 1 / 240))
  let iy = Math.round(120 * (latFromStart - TILE_SPAN_DEG * (ty - 1) + 1 / 240))
  if (ix >= TILE_POINTS) {
    ix -= TILE_POINTS
    tx = mod(tx, TILE_X_COUNT) + 1
  }
  if (iy >= TILE_POINTS) {
    iy -= TILE_POINTS
    ty += 1
  }
  if (ty < 1 || ty > MAX_TILE_Y) return null
  if (ix < 0 || iy < 0) return null

  return { tx, ty, ix, iy }
}

/**
 * Decode one gunzipped 5°×5° tile into a dense 600×600 LPI grid, row-major
 * (`iy * 600 + ix`).
 *
 * This reproduces the reference walk in Lorenz's own `lp/overlay/dark.html`
 * EXACTLY, including its two off-by-one quirks — both of which look like bugs
 * and are not ours to fix, because the grid they produce is the one every
 * published atlas number was measured against:
 *
 *   1. The latitude anchor sum runs `i = 1..iy-1`, so row `iy` uses the running
 *      total BEFORE adding its own delta.
 *   2. The longitude walk for row `iy` reads the deltas of row `iy - 1`
 *      (`src = max(0, iy - 1)`), and its sum runs `i = 1..ix-1` — so `g[iy][0]`
 *      and `g[iy][1]` BOTH equal the row anchor.
 *
 * Deviating from either shifts the whole grid by one 30-arcsec cell, which is
 * ~0.1 mag on a steep gradient such as a city edge.
 */
export function decodeTile(bytes: Uint8Array): Float32Array {
  // A short payload would read past the end as `undefined` and poison the whole
  // grid with NaN — silently, and then the caller caches that grid for a day.
  // Fail loudly instead: the client turns a throw into a log.warn and a retry
  // on the next request.
  if (bytes.byteLength < TILE_POINTS * TILE_POINTS) {
    throw new Error(
      `lorenz tile truncated: ${bytes.byteLength} bytes, expected at least ${TILE_POINTS * TILE_POINTS}`,
    )
  }

  // The deltas are SIGNED bytes; reading them unsigned turns every -1 into 255.
  const d = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const grid = new Float32Array(TILE_POINTS * TILE_POINTS)

  // 2-byte anchor at the SW corner of the tile.
  const first = 128 * Number(d[0]) + Number(d[1])

  // rowAnchor[iy] = first + Σ d[600i + 1] for i = 1..iy-1 (quirk 1).
  const rowAnchor = new Float64Array(TILE_POINTS)
  rowAnchor[0] = first
  let acc = first
  for (let iy = 1; iy < TILE_POINTS; iy++) {
    rowAnchor[iy] = acc
    acc += Number(d[TILE_POINTS * iy + 1])
  }

  for (let iy = 0; iy < TILE_POINTS; iy++) {
    const src = Math.max(0, iy - 1) // quirk 2: the PREVIOUS row carries the longitude deltas
    const row = iy * TILE_POINTS
    let value = rowAnchor[iy]!
    grid[row] = compressedToFull(value)
    grid[row + 1] = compressedToFull(value)
    for (let ix = 2; ix < TILE_POINTS; ix++) {
      value += Number(d[TILE_POINTS * src + ix])
      grid[row + ix] = compressedToFull(value)
    }
  }

  return grid
}

/** LPI at a grid cell. NaN when the indices fall outside the tile. */
export function sampleGrid(grid: Float32Array, ix: number, iy: number): number {
  if (ix < 0 || ix >= TILE_POINTS || iy < 0 || iy >= TILE_POINTS) return Number.NaN
  return grid[iy * TILE_POINTS + ix] ?? Number.NaN
}

/**
 * Total zenith brightness in mag/arcsec² from the artificial/natural ratio.
 *
 * The 22.0 natural baseline is a convention, not a constant — airglow varies
 * night to night and rises at solar maximum — so treat any absolute value as
 * ±0.2 mag before this model's own error (§1.3).
 */
export function mpsasFromLpi(lpi: number): number {
  return 22.0 - (5.0 * Math.log10(1.0 + lpi)) / Math.log10(100)
}

/**
 * Lorenz's `0a`..`7b` zone bands: each whole step is ×3 in LPI, each half-step
 * ×√3.
 *
 * The formula below was **fitted against the four published zone values** in
 * `docs/ASTRO-MAP-RESEARCH.md` §1.4 (Munich 6b, Alpenvorland 4a, Walchensee 3a,
 * Bayerischer Wald 3a) — it is not read off a spec, because there is none. The
 * bands stop at `7b`, so anything brighter clamps there rather than inventing
 * an `8a` the atlas legend has no colour for.
 */
export function lorenzZone(lpi: number): string {
  const u = Math.log(lpi) / Math.log(3) + 4
  if (!Number.isFinite(u) || u < 0) return '0a'
  const zoneIndex = Math.floor(u)
  if (zoneIndex > 7) return '7b'
  return `${zoneIndex}${u - zoneIndex < 0.5 ? 'a' : 'b'}`
}

/**
 * Percent change in LPI between two atlas years. Null when the change is not
 * measurable.
 *
 * A zero or negative baseline has no meaningful ratio, and the atlas floors at 0
 * in genuinely pristine cells — 63% of the Mauna Kea tile, so this is the common
 * case exactly where this feature's audience lives. Reporting 0 there would be a
 * positive claim of "no change" over a cell that may well have gone from dark to
 * lit, so it degrades to null, the same unknown the caller already handles for a
 * missing baseline tile.
 */
export function trendPercent(older: number, newer: number): number | null {
  if (!(older > 0)) return null
  return ((newer - older) / older) * 100
}
