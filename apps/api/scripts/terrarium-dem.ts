/* eslint-disable no-console */
/**
 * Script-local DEM reader: an 8-bit PNG decoder plus a disk-cached terrarium
 * elevation sampler over AWS's `elevation-tiles-prod` bucket.
 *
 * This lives in `scripts/` and NOT in `src/` on purpose. Nothing Argo serves
 * ever reads a PNG — `src/lib/png.ts` only writes them — so a decoder in the
 * shipped tree would be dead weight the API has to carry and a reviewer has to
 * trust. The one consumer is `gen-astro-sites.ts`, which runs on a laptop, once
 * per atlas vintage, and prints numbers a human pastes into `astro-sites.ts`.
 *
 * The tile cache is a plain directory of the raw PNG bytes, so the second run
 * of the generator is fully offline — which is what makes the acceptance check
 * in `gen-astro-sites.ts` a real regression test rather than a network probe.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { lonToTileX, latToTileY } from '../src/lib/lp-tile.js'
import { terrariumElevation, type ElevationSampler } from '../src/lib/terrain-horizon.js'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export type DecodedPng = {
  width: number
  height: number
  /** Row-major RGB, 3 bytes per pixel — alpha is dropped when the source has it. */
  rgb: Uint8Array
}

/**
 * Decode an 8-bit, non-interlaced, truecolour PNG (colour type 2 or 6).
 *
 * All five scanline filters are implemented, because a real encoder picks per
 * scanline and AWS's tiles do use more than `None` — a decoder that handled
 * only the filters a sample tile happened to carry would silently produce
 * garbage elevations on the next tile. Everything outside that envelope
 * (palette, greyscale, 16-bit, interlaced) throws rather than guessing: the
 * caller is a generator whose whole job is to be checkable.
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  for (const [index, expected] of PNG_SIGNATURE.entries()) {
    if (bytes[index] !== expected) throw new Error('not a PNG: bad signature')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []

  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const data = bytes.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      const bitDepth = bytes[offset + 16]
      const colourType = bytes[offset + 17]
      const interlace = bytes[offset + 20]
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}, expected 8`)
      if (colourType !== 2 && colourType !== 6) {
        throw new Error(`unsupported PNG colour type ${colourType}, expected 2 (RGB) or 6 (RGBA)`)
      }
      if (interlace !== 0) throw new Error('unsupported interlaced PNG')
      channels = colourType === 6 ? 4 : 3
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset += 12 + length
  }

  if (width === 0 || height === 0 || idat.length === 0) throw new Error('PNG has no image data')

  const raw = new Uint8Array(inflateSync(concat(idat)))
  const stride = width * channels
  const expected = height * (stride + 1)
  if (raw.byteLength < expected) {
    throw new Error(`PNG data truncated: ${raw.byteLength} bytes, expected ${expected}`)
  }

  const pixels = new Uint8Array(height * stride)

  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]!
    const source = row * (stride + 1) + 1
    const target = row * stride
    const above = target - stride

    for (let index = 0; index < stride; index++) {
      const value = raw[source + index]!
      const left = index >= channels ? pixels[target + index - channels]! : 0
      const up = row > 0 ? pixels[above + index]! : 0
      const upLeft = row > 0 && index >= channels ? pixels[above + index - channels]! : 0
      pixels[target + index] = (value + reconstruct(filter, left, up, upLeft)) & 0xff
    }
  }

  if (channels === 3) return { width, height, rgb: pixels }

  const rgb = new Uint8Array(width * height * 3)
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgb[pixel * 3] = pixels[pixel * 4]!
    rgb[pixel * 3 + 1] = pixels[pixel * 4 + 1]!
    rgb[pixel * 3 + 2] = pixels[pixel * 4 + 2]!
  }
  return { width, height, rgb }
}

/** The PNG filter predictors, all five of them (RFC 2083 §6). */
function reconstruct(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  if (filter === 4) return paeth(left, up, upLeft)
  throw new Error(`unknown PNG filter type ${filter}`)
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.byteLength
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

// ── Tiles ────────────────────────────────────────────────────────────────

const TERRARIUM_BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const REQUEST_TIMEOUT_MS = 40_000

export type TerrariumDem = {
  sampler: ElevationSampler
  /** Tiles the sampler had to reach for, and how many of those came off disk. */
  stats: () => { tiles: number; fromCache: number; missing: number }
}

/**
 * A DEM sampler at one zoom, backed by a directory of cached tile PNGs.
 *
 * `prefetch` must cover every coordinate the caller will sample: the sampler
 * itself is synchronous (that is what `horizonProfile` takes) and reads NaN for
 * anything not already on disk — the same "no data" contract the horizon maths
 * floors to −90°, so a missed tile can never masquerade as flat ground.
 */
export async function terrariumDem(args: {
  zoom: number
  cacheDir: string
}): Promise<TerrariumDem & { prefetch: (boxes: TileBox[]) => Promise<void> }> {
  const { zoom, cacheDir } = args
  mkdirSync(cacheDir, { recursive: true })

  const grids = new Map<string, DecodedPng | null>()
  let fromCache = 0

  async function load(tx: number, ty: number): Promise<void> {
    const key = `${tx}/${ty}`
    if (grids.has(key)) return

    const path = join(cacheDir, `${zoom}_${tx}_${ty}.png`)
    if (existsSync(path)) {
      try {
        grids.set(key, decodePng(new Uint8Array(readFileSync(path))))
        fromCache += 1
        return
      } catch (error) {
        // A cached tile that will not decode is a poisoned cache, not a bad
        // atlas: drop it and fall through to the network. Left in place it
        // would fail every future run identically, with no way out but a
        // hand-typed `rm`.
        console.warn(`  ! cached terrarium tile ${key} unreadable, refetching: ${String(error)}`)
        rmSync(path, { force: true })
      }
    }

    const url = `${TERRARIUM_BASE_URL}/${zoom}/${tx}/${ty}.png`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!res.ok) {
        console.warn(`  ! terrarium tile ${key} returned ${res.status}`)
        grids.set(key, null)
        return
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      // Decode before writing, then rename into place: only tiles that are
      // known-good and complete ever become cache entries, so a Ctrl-C or a
      // full disk mid-prefetch cannot leave a half-written PNG behind.
      const decoded = decodePng(bytes)
      const staging = `${path}.${process.pid}.tmp`
      writeFileSync(staging, bytes)
      renameSync(staging, path)
      grids.set(key, decoded)
    } catch (error) {
      console.warn(`  ! terrarium tile ${key} failed: ${String(error)}`)
      grids.set(key, null)
    }
  }

  const sampler: ElevationSampler = (lat, lon) => {
    const x = lonToTileX(lon, zoom)
    const y = latToTileY(lat, zoom)
    const grid = grids.get(`${Math.floor(x)}/${Math.floor(y)}`)
    if (!grid) return Number.NaN

    const column = clamp(Math.floor((x - Math.floor(x)) * grid.width), 0, grid.width - 1)
    const row = clamp(Math.floor((y - Math.floor(y)) * grid.height), 0, grid.height - 1)
    const at = (row * grid.width + column) * 3
    return terrariumElevation(grid.rgb[at]!, grid.rgb[at + 1]!, grid.rgb[at + 2]!)
  }

  return {
    sampler,
    stats: () => ({
      tiles: grids.size,
      fromCache,
      missing: [...grids.values()].filter((grid) => grid === null).length,
    }),
    async prefetch(boxes) {
      const wanted = new Set<string>()
      for (const box of boxes) {
        for (const tile of tilesInBox(box, zoom)) wanted.add(`${tile.tx}/${tile.ty}`)
      }
      // Ten at a time: enough to hide the round trips, gentle enough that a
      // public bucket never rate-limits a one-off generator run.
      const pending = [...wanted]
      while (pending.length > 0) {
        await Promise.all(
          pending.splice(0, 10).map((key) => {
            const [tx, ty] = key.split('/')
            return load(Number(tx), Number(ty))
          }),
        )
      }
    },
  }
}

export type TileBox = { lat: number; lon: number; radiusM: number }

/** Every tile at `zoom` inside a square of `radiusM` around a point. */
function tilesInBox(box: TileBox, zoom: number): { tx: number; ty: number }[] {
  const padLat = box.radiusM / 111_320
  const padLon = padLat / Math.cos((box.lat * Math.PI) / 180)

  const xs = [lonToTileX(box.lon - padLon, zoom), lonToTileX(box.lon + padLon, zoom)]
  const ys = [latToTileY(box.lat - padLat, zoom), latToTileY(box.lat + padLat, zoom)]

  const tiles: { tx: number; ty: number }[] = []
  for (let tx = Math.floor(Math.min(...xs)); tx <= Math.floor(Math.max(...xs)); tx++) {
    for (let ty = Math.floor(Math.min(...ys)); ty <= Math.floor(Math.max(...ys)); ty++) {
      tiles.push({ tx, ty })
    }
  }
  return tiles
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
