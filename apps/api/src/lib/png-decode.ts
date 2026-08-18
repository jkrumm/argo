/**
 * An 8-bit truecolour PNG decoder — the read half of `./png.ts`'s writer.
 *
 * Lives in `src/lib` because two callers now need it: `scripts/terrarium-dem.ts`
 * (a disk-cached DEM reader used once per atlas vintage by
 * `scripts/gen-astro-sites.ts`) and `../clients/terrarium-dem.ts` (the runtime
 * client behind `GET /astro/horizon`, `docs/ASTRO-HORIZON-RESEARCH.md`). Both
 * decode the same AWS terrarium tiles, so the decoder is shared rather than
 * forked.
 */

import { inflateSync } from 'node:zlib'

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
 * (palette, greyscale, 16-bit, interlaced) throws rather than guessing: both
 * callers are reading a DEM into a measurement, and a wrong-but-silent decode
 * would corrupt every downstream number.
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
